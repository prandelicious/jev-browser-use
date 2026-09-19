import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../skills/jev-browser-use/bridge.mjs';

const fixture = await readFile(new URL('./fixtures/agoda-property.ax.txt', import.meta.url), 'utf8');
const origin = 'https://www.agoda.com';
const goal = 'Find room size and child age policy';

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'jev-bridge-'));
}

async function envFile() {
  const dir = await tempDir();
  const path = join(dir, 'jev.env');
  await writeFile(path, 'TYPESAFE_API_KEY=test-key\n');
  return path;
}

function response(choice = 'DONE') {
  const probabilities = {a0: choice === 'a0' ? 0.95 : 0.01, DONE: choice === 'DONE' ? 0.95 : 0.01, BLOCKED: 0.02, WAIT: 0.02};
  return {ok:true, json:async () => ({model:'jev-latest', answers:{next:{type:'choice',choice,confidence:0.99,probabilities}}})};
}

function tabFor(states) {
  let reads = 0;
  const clicks = [];
  return {
    clicks,
    async getAXState() { return states[Math.min(reads++, states.length - 1)]; },
    async click(index) { clicks.push(index); },
    async scroll() {},
    async pressKey() {},
    async reload() {},
  };
}

async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

test('run sends compact projected state and executes the raw action index', async () => {
  const cacheDir = await tempDir();
  const env = await envFile();
  const bodies = [];
  const tab = tabFor([fixture, fixture, fixture]);
  const outcome = await withFetch(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return response('a0');
  }, () => run(tab, {
    goal,
    controls: [{op:'click', name:'Rooms'}],
    allowedOrigins: [origin],
    envFile: env,
    profileCacheDir: cacheDir,
    maxSteps: 1,
  }));
  assert.equal(tab.clicks[0], 41);
  assert.doesNotMatch(bodies[0].state.browser, /footer noise 29/);
  assert.match(bodies[0].state.browser, /^41 tab Rooms$/m);
  assert.match(bodies[0].state.browser, /^Browser tab: Agoda \(origin https:\/\/www\.agoda\.com\)\.$/m);
  assert.ok(outcome.metrics.projectedChars < outcome.metrics.rawChars);
  assert.equal(outcome.metrics.projectionMode, 'origin-minimized');
  assert.equal(outcome.metrics.active, true);
});

test('a warm run reads the same family profile as a cache hit', async () => {
  const cacheDir = await tempDir();
  const env = await envFile();
  const call = async () => {
    const tab = tabFor([fixture, fixture]);
    return withFetch(async () => response('DONE'), () => run(tab, {
      goal, controls: [{op:'click', name:'Rooms'}], allowedOrigins: [origin], envFile: env,
      profileCacheDir: cacheDir, maxSteps: 1,
    }));
  };
  const cold = await call();
  const warm = await call();
  assert.equal(cold.metrics.cacheHit, false);
  assert.equal(warm.metrics.cacheHit, true);
  assert.equal(warm.metrics.cacheRead, 'hit');
});

test('a recognized Agoda run keeps origin-minimized evidence after a state change', async () => {
  const cacheDir = await tempDir();
  const env = await envFile();
  const expanded = `${fixture}\n${Array.from({length:40}, (_, index) => `${1000 + index} text footer noise ${index}\n${2000 + index} text Room size: ${index + 1} m²\n${3000 + index} text footer noise ${index + 40}`).join('\n')}`;
  const changed = expanded.replace('Children 0-6 years old', 'Children 0-5 years old');
  const bodies = [];
  const tab = tabFor([expanded, expanded, changed, changed, changed]);
  const outcome = await withFetch(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return response(bodies.length === 1 ? 'a0' : 'DONE');
  }, () => run(tab, {
    goal,
    controls: [{op:'click', name:'Rooms'}],
    allowedOrigins: [origin],
    envFile: env,
    profileCacheDir: cacheDir,
    maxSteps: 2,
  }));
  assert.equal(bodies.length, 2);
  assert.doesNotMatch(bodies[0].state.browser, /footer noise/);
  assert.doesNotMatch(bodies[1].state.browser, /footer noise/);
  assert.match(bodies[1].state.browser, /Children 0-5 years old/);
  assert.equal(outcome.metrics.projectionMode, 'origin-minimized');
});

test('an omitted raw line changing between decision and refresh prevents a click', async () => {
  const env = await envFile();
  const changed = fixture.replace('footer noise 29', 'footer changed 29');
  const tab = tabFor([fixture, changed]);
  const outcome = await withFetch(async () => response('a0'), () => run(tab, {
    goal, controls: [{op:'click', name:'Rooms'}], allowedOrigins: [origin], envFile: env,
    profileCacheEnabled: false, incrementalStateEnabled: true, maxSteps: 1,
  }));
  assert.deepEqual(tab.clicks, []);
  assert.equal(outcome.history.at(-1).reason, 'stale_state');
});

test('invalid incremental-state ratios are rejected by the task contract', async () => {
  const env = await envFile();
  const tab = tabFor([fixture]);
  await assert.rejects(() => run(tab, {
    goal,
    controls: [{op:'click', name:'Rooms'}],
    allowedOrigins: [origin],
    envFile: env,
    incrementalStateMaxRatio: 0.05,
  }), /Invalid task contract/);
});

test('disabled incremental mode keeps model requests in full mode', async () => {
  const env = await envFile();
  const bodies = [];
  const expanded = `${fixture}\n${Array.from({length:40}, (_, index) => `${1000 + index} text footer noise ${index}\n${2000 + index} text Room size: ${index + 1} m²\n${3000 + index} text footer noise ${index + 40}`).join('\n')}`;
  const changed = expanded.replace('Children 0-6 years old', 'Children 0-5 years old');
  const tab = tabFor([expanded, expanded, changed, changed, changed]);
  const outcome = await withFetch(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return response(bodies.length === 1 ? 'a0' : 'DONE');
  }, () => run(tab, {
    goal,
    controls: [{op:'click', name:'Rooms'}],
    allowedOrigins: [origin],
    envFile: env,
    profileCacheEnabled: false,
    incrementalStateEnabled: false,
    maxSteps: 2,
  }));
  assert.equal(bodies.length, 2);
  assert.equal(outcome.metrics.stateMode, 'full');
  assert.equal(outcome.metrics.projectedChars, outcome.metrics.fullProjectedChars);
});

test('cache write failures do not prevent a decision and expose only safe metrics', async () => {
  const env = await envFile();
  const dir = await tempDir();
  const cachePath = join(dir, 'not-a-directory');
  await writeFile(cachePath, 'blocked');
  const bodies = [];
  const tab = tabFor([fixture, fixture]);
  const outcome = await withFetch(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return response('DONE');
  }, () => run(tab, {
    goal, controls: [{op:'click', name:'Rooms'}], allowedOrigins: [origin], envFile: env,
    profileCacheDir: cachePath, maxSteps: 1,
  }));
  assert.equal(outcome.status, 'needs_verification');
  assert.equal(outcome.metrics.cacheWrite, 'failed');
  assert.doesNotMatch(JSON.stringify(outcome.metrics), /footer|not-a-directory|https?:\/\//i);
  assert.ok(bodies.length > 0);
});

test('unknown routes use exact raw state without cache activation', async () => {
  const raw = 'Browser tab: Example URL: "https://example.com/foo".\n1 tab Test';
  const env = await envFile();
  const bodies = [];
  const tab = tabFor([raw, raw]);
  const outcome = await withFetch(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return response('DONE');
  }, () => run(tab, {
    goal: 'show test', controls: [{op:'click', name:'Test'}], allowedOrigins: ['https://example.com'], envFile: env, maxSteps: 1,
  }));
  assert.equal(outcome.metrics.active, false);
  assert.equal(bodies[0].state.browser, raw);
});
