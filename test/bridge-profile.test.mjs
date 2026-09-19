import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { availableActions, run } from '../skills/jev-browser-use/bridge.mjs';

const fixture = await readFile(new URL('./fixtures/agoda-property.ax.txt', import.meta.url), 'utf8');
const denseFixture = await readFile(new URL('./fixtures/agoda-dense-property.ax.txt', import.meta.url), 'utf8');
const origin = 'https://www.agoda.com';
const goal = 'Find room size and child age policy';

async function tempDir() { return mkdtemp(join(tmpdir(), 'jev-bridge-')); }
async function envFile() {
  const dir = await tempDir();
  const path = join(dir, 'jev.env');
  await writeFile(path, 'TYPESAFE_API_KEY=test-key\n');
  return path;
}
function response(choice = 'DONE', optionKeys = ['a0', 'DONE', 'BLOCKED', 'WAIT']) {
  const probabilities = Object.fromEntries(optionKeys.map(key => [key, key === choice ? 0.95 : 0.05 / (optionKeys.length - 1)]));
  return {ok:true, json:async () => ({model:'jev-latest', answers:{next:{type:'choice',choice,confidence:0.99,probabilities}}})};
}
function tabFor(states) {
  let reads = 0;
  const clicks = [];
  return {clicks, async getAXState() { return states[Math.min(reads++, states.length - 1)]; }, async click(index) { clicks.push(index); }, async scroll() {}, async pressKey() {}, async reload() {}};
}
async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

test('run sends structured state and executes the same-turn raw candidate', async () => {
  const env = await envFile();
  const bodies = [];
  const tab = tabFor([fixture, fixture, fixture]);
  const outcome = await withFetch(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return response('a0');
  }, () => run(tab, {goal, controls:[{op:'click', name:'Rooms'}], allowedOrigins:[origin], envFile:env, maxSteps:1}));
  assert.equal(bodies.length, 1);
  assert.equal(typeof bodies[0].state, 'object');
  assert.equal('browser' in bodies[0].state, false);
  assert.deepEqual(new Set(Object.keys(bodies[0].questions.next.criteria)), new Set(['a0','DONE','BLOCKED','WAIT']));
  assert.equal('index' in bodies[0].state.candidates[0], false);
  assert.equal(tab.clicks[0], 41);
  assert.equal(outcome.status, 'step_limit');
  assert.equal(outcome.metrics.stateMode, 'structured');
  assert.equal(outcome.metrics.projectionMode, 'semantic-json-v1');
});

test('availableActions matches CUA Rooms and FAQ names before metadata suffixes', () => {
  const state = [
    'Browser tab: 14, Title: "IDEAL FUKUSHIMA", URL: "https://www.agoda.com/ideal-fukushima-h8834111/hotel/osaka-jp.html".',
    '221 link Description: Rooms, ID: property-dateless-roomgrid-tab-2',
    "546 button (collapsed) What are the property's policies for children's bedding at IDEAL FUKUSHIMA?, ID: property-faq-12",
  ].join('\n');
  const actions = availableActions(state, [
    {op:'click', name:'Rooms'},
    {op:'click', name:"What are the property's policies for children's bedding at IDEAL FUKUSHIMA?"},
  ]);
  assert.deepEqual(actions.map(action => action.index), [221, 546]);
});

test('dense state reaches mocked Jev without leaking consequential controls', async () => {
  const env = await envFile();
  const bodies = [];
  const tab = tabFor([denseFixture, denseFixture]);
  const outcome = await withFetch(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return response('DONE', Object.keys(bodies[0].questions.next.criteria));
  }, () => run(tab, {goal:'Find room size and child age policy for IDEAL FUKUSHIMA', controls:[{op:'click',name:'Rooms'},{op:'click',name:'Book now'},{op:'click',name:'Policies'}], allowedOrigins:[origin], envFile:env, maxSteps:1}));
  assert.equal(outcome.status, 'needs_verification');
  assert.equal(bodies.length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(bodies[0].state), 'utf8') <= 16_000);
  assert.doesNotMatch(JSON.stringify(bodies[0].state), /Book now|Reserve|Select room|Pay|Confirm/i);
});

test('raw changes between Jev and refresh prevent execution', async () => {
  const env = await envFile();
  const changed = fixture.replace('footer noise 29', 'footer changed 29');
  const tab = tabFor([fixture, changed]);
  const outcome = await withFetch(async (_url, options) => response('a0'), () => run(tab, {goal, controls:[{op:'click',name:'Rooms'}], allowedOrigins:[origin], envFile:env, maxSteps:1}));
  assert.deepEqual(tab.clicks, []);
  assert.equal(outcome.history.at(-1).reason, 'stale_state');
});

test('metrics report sizes, phase timings, aliases, and decision turns', async () => {
  const env = await envFile();
  const tab = tabFor([fixture, fixture]);
  const outcome = await withFetch(async (_url, options) => {
    const body = JSON.parse(options.body);
    return response('DONE', Object.keys(body.questions.next.criteria));
  }, () => run(tab, {goal, controls:[{op:'click',name:'Rooms'}], allowedOrigins:[origin], envFile:env, maxSteps:1}));
  for (const key of ['rawChars','normalizedChars','decisionStateChars','normalizationMs','projectionMs','apiMs','elapsedMs','decisionTurns']) {
    assert.ok(Number.isFinite(outcome.metrics[key]) && outcome.metrics[key] >= 0, key);
  }
  assert.equal(outcome.metrics.decisionTurns, 1);
  assert.equal(outcome.metrics.projectedChars, outcome.metrics.decisionStateChars);
  assert.equal(outcome.metrics.fullProjectedChars, outcome.metrics.decisionStateChars);
});

test('decision turns accumulate across stale-state retries', async () => {
  const env = await envFile();
  const changed = fixture.replace('footer noise 29', 'footer changed 29');
  const tab = tabFor([fixture, changed, changed, changed]);
  let calls = 0;
  const outcome = await withFetch(async (_url, options) => {
    const body = JSON.parse(options.body);
    const keys = Object.keys(body.questions.next.criteria);
    return response(calls++ === 0 ? 'a0' : 'DONE', keys);
  }, () => run(tab, {goal, controls:[{op:'click',name:'Rooms'}], allowedOrigins:[origin], envFile:env, maxSteps:2}));
  assert.equal(outcome.status, 'needs_verification');
  assert.equal(outcome.metrics.decisionTurns, 2);
  assert.ok(outcome.metrics.apiMs >= 0);
});

test('deprecated cache and incremental options are inert', async () => {
  const env = await envFile();
  const sentinel = join(await tempDir(), 'sentinel');
  await writeFile(sentinel, 'do not touch');
  const tab = tabFor([fixture, fixture]);
  const outcome = await withFetch(async (_url, options) => {
    const body = JSON.parse(options.body);
    return response('DONE', Object.keys(body.questions.next.criteria));
  }, () => run(tab, {goal, controls:[{op:'click',name:'Rooms'}], allowedOrigins:[origin], envFile:env, profileCacheDir:sentinel, profileCacheEnabled:true, incrementalStateEnabled:false, incrementalStateMaxRatio:0.05, maxSteps:1}));
  assert.equal(outcome.status, 'needs_verification');
  assert.equal(outcome.metrics.cacheRead, 'disabled');
});
