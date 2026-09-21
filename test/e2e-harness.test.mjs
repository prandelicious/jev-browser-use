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

test('missing chrome is classified as INFRA_ERROR', async () => {
  const previous = process.env.E2E_CHROME;
  process.env.E2E_CHROME = '/tmp/jev-e2e-no-chrome';
  const chunks = [];
  try {
    const code = await runE2E(['--suite', 'gate', '--scenario', 'basic-click', '--json'], {
      stdout: { write: (chunk) => chunks.push(chunk) },
      stderr: { write: () => {} },
    });
    assert.equal(code, 2);
    const report = JSON.parse(chunks.join(''));
    assert.equal(report.status, 'INFRA_ERROR');
  } finally {
    if (previous === undefined) delete process.env.E2E_CHROME;
    else process.env.E2E_CHROME = previous;
  }
});

test('cli and mcp suites skip when transports are absent', async () => {
  const chunks = [];
  const code = await runE2E(['--suite', 'cli', '--json'], {
    stdout: { write: (chunk) => chunks.push(chunk) },
    stderr: { write: () => {} },
  });
  assert.equal(code, 0);
  const report = JSON.parse(chunks.join(''));
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.status, 'PASS');
  assert.equal(report.summary.skipped, 1);
  assert.equal(report.scenarios[0].status, 'SKIPPED');
  assert.match(report.scenarios[0].reason, /not faked/);
});
