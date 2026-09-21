import test from 'node:test';
import assert from 'node:assert/strict';
import { createChromiumTab } from '../tests/e2e/harness.mjs';
import { startFixtureServer } from '../tests/e2e/fixtures/server.mjs';
import { runE2E } from '../tests/e2e/runner.mjs';

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('chromium harness process is killed on stop', async () => {
  const fixture = await startFixtureServer();
  const session = await createChromiumTab({ url: `${fixture.origin}/basic-click.html` });
  assert.equal(typeof session.pid, 'number');
  assert.equal(pidAlive(session.pid), true);
  const state = await session.tab.getAXState();
  assert.match(state, /Open details/);
  await session.stop();
  assert.equal(pidAlive(session.pid), false);
  await fixture.stop();
});

test('cli and mcp suites skip when transports are absent', async () => {
  for (const suite of ['cli', 'mcp']) {
    const chunks = [];
    const code = await runE2E(['--suite', suite, '--json'], {
      stdout: { write: (chunk) => chunks.push(chunk) },
      stderr: { write: () => {} },
    });
    assert.equal(code, 0);
    const stdout = chunks.join('');
    assert.equal(stdout.trim().split('\n').length, 1);
    const report = JSON.parse(stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.status, 'PASS');
    assert.equal(report.summary.skipped, 1);
    assert.equal(report.scenarios[0].id, suite);
    assert.equal(report.scenarios[0].status, 'SKIPPED');
    assert.match(report.scenarios[0].reason, /not faked/);
    assert.match(report.artifacts.report, /report\.json$/);
  }
});

test('INFRA_ERROR retains a report artifact and stderr is separate from JSON', async () => {
  const previous = process.env.E2E_CHROME;
  process.env.E2E_CHROME = '/tmp/jev-e2e-no-chrome';
  const out = [];
  const err = [];
  try {
    const code = await runE2E(['--suite', 'gate', '--scenario', 'basic-click', '--json'], {
      stdout: { write: (chunk) => out.push(chunk) },
      stderr: { write: (chunk) => err.push(chunk) },
    });
    assert.equal(code, 2);
    const report = JSON.parse(out.join(''));
    assert.equal(report.status, 'INFRA_ERROR');
    assert.match(report.artifacts.report, /report\.json$/);
    const { readFile } = await import('node:fs/promises');
    const saved = JSON.parse(await readFile(report.artifacts.report, 'utf8'));
    assert.equal(saved.status, 'INFRA_ERROR');
    assert.match(err.join(''), /INFRA_ERROR/);
  } finally {
    if (previous === undefined) delete process.env.E2E_CHROME;
    else process.env.E2E_CHROME = previous;
  }
});

test('hung Jev decision times out and chrome is still cleaned up', async () => {
  const http = await import('node:http');
  const { attachTab, run } = await import('../skills/jev-browser-use/bridge.mjs');
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const hung = http.createServer(() => {});
  await new Promise((resolve) => hung.listen(0, '127.0.0.1', resolve));
  const { port } = hung.address();
  const fixture = await startFixtureServer();
  const session = await createChromiumTab({ url: `${fixture.origin}/basic-click.html` });
  const dir = await mkdtemp(join(tmpdir(), 'jev-e2e-hang-'));
  const envFile = join(dir, 'jev.env');
  await writeFile(envFile, `TYPESAFE_API_KEY=test-key\nJEV_API_ENDPOINT=http://127.0.0.1:${port}/\n`);
  attachTab(session.tab);
  const outcome = await run(session.tab, {
    goal: 'Open details',
    controls: [{ op: 'click', name: 'Open details' }],
    allowedOrigins: [fixture.origin],
    envFile,
    provider: 'typesafe',
    profileCacheEnabled: false,
    incrementalStateEnabled: false,
    maxSteps: 1,
    maxMs: 3000,
    decisionTimeoutMs: 1000,
    maxDecisionRetries: 0,
    waitPollMs: 100,
  });
  assert.equal(outcome.status, 'decision_error');
  const pid = session.pid;
  await session.stop();
  await fixture.stop();
  await new Promise((resolve, reject) => hung.close((error) => error ? reject(error) : resolve()));
  assert.equal(pidAlive(pid), false);
});

test('process manager force-kills a child that ignores stop', async () => {
  const { createProcessManager } = await import('../tests/e2e/process-manager.mjs');
  let forced = false;
  const processes = createProcessManager();
  processes.track({
    purpose: 'stuck',
    handle: {},
    stop: () => new Promise(() => {}),
    force: () => { forced = true; },
  });
  await processes.shutdown(50);
  assert.equal(forced, true);
});
