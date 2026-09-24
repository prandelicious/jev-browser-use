import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { access } from 'node:fs/promises';
import { CHROME_DEVTOOLS_MCP_PIN } from '../src/contract.mjs';
import { ChromeDevtoolsSession, testPeerTransport } from '../src/chrome/session.mjs';
import {
  ChromeActionPolicyError,
  assertToolAllowlisted,
  bindPage,
  clickByUid,
  invokeChromeTool,
  takeSnapshot,
} from '../src/chrome/actions.mjs';

const allowedOrigin = 'https://allowed.test';

function actionCalls(journal) {
  return journal.filter((entry) => !['list_pages'].includes(entry.name));
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function makeSession(scenario, overrides = {}) {
  return new ChromeDevtoolsSession({
    allowedOrigins: [allowedOrigin],
    transportOptions: testPeerTransport(scenario),
    requestTimeoutMs: overrides.requestTimeoutMs ?? 2_000,
    startupTimeoutMs: overrides.startupTimeoutMs ?? 5_000,
    ...overrides,
  });
}

test('lockfile pins chrome-devtools-mcp without @latest', async () => {
  const pkg = await import('../package.json', { with: { type: 'json' } });
  const version =
    pkg.default.devDependencies?.['chrome-devtools-mcp'] ??
    pkg.default.dependencies?.['chrome-devtools-mcp'];
  assert.equal(version, CHROME_DEVTOOLS_MCP_PIN.version);
  assert.doesNotMatch(String(version), /@latest/i);
});

test('session starts against scripted peer with stderr capture and owned profile', async () => {
  const session = makeSession('default');
  await session.start();
  assert.match(session.stderrText, /scripted-peer-ready/);
  assert.ok(session.ownedProfileDir?.startsWith(tmpdir()));
  assert.ok(isPidAlive(session.ownedChildPid));
  await session.stop();
});

test('unbound page: allowlisted click is rejected before any action tool call', async () => {
  const session = makeSession('default');
  await session.start();
  await assert.rejects(
    () => clickByUid(session, 'uid-1', [allowedOrigin]),
    (error) => error instanceof ChromeActionPolicyError && error.code === 'unbound',
  );
  assert.equal(actionCalls(session.callJournal).length, 0);
  await session.stop();
});

test('wrong origin: binding is rejected before select_page or click', async () => {
  const session = makeSession('default');
  await session.start();
  await assert.rejects(
    () => bindPage(session, 'page-blocked', [allowedOrigin]),
    (error) => error instanceof ChromeActionPolicyError && error.code === 'wrong_origin',
  );
  assert.ok(!session.callJournal.some((entry) => entry.name === 'select_page'));
  assert.ok(!session.callJournal.some((entry) => entry.name === 'click'));
  await session.stop();
});

test('wrong page ID: bind fails without action tools', async () => {
  const session = makeSession('default');
  await session.start();
  await assert.rejects(() => bindPage(session, 'missing-page', [allowedOrigin]), /Unknown pageId/);
  assert.equal(actionCalls(session.callJournal).length, 0);
  await session.stop();
});

test('non-allowlisted evaluate_script is rejected before peer tools/call', async () => {
  const session = makeSession('default');
  await session.start();
  assert.throws(() => assertToolAllowlisted('evaluate_script'), /not allowlisted/);
  await assert.rejects(
    () => invokeChromeTool(session, 'evaluate_script', { expression: '1' }),
    /not allowlisted/,
  );
  assert.equal(session.callJournal.length, 0);
  await session.stop();
});

test('bound page: take_snapshot and click use page-scoped tools', async () => {
  const session = makeSession('default');
  await session.start();
  await bindPage(session, 'page-allowed', [allowedOrigin]);
  const snapshot = await takeSnapshot(session, [allowedOrigin]);
  assert.match(snapshot.snapshot, /URL:/);
  await clickByUid(session, 'uid-42', [allowedOrigin]);
  assert.ok(session.callJournal.some((entry) => entry.name === 'take_snapshot'));
  assert.ok(session.callJournal.some((entry) => entry.name === 'click'));
  await session.stop();
});

test('page closure: bound page refresh fails closed without click', async () => {
  const session = makeSession('page-closure');
  await session.start();
  await bindPage(session, 'page-allowed', [allowedOrigin]);
  session.callJournal.length = 0;
  await assert.rejects(
    () => takeSnapshot(session, [allowedOrigin]),
    /no longer available|No page is bound/,
  );
  assert.ok(!session.callJournal.some((entry) => entry.name === 'take_snapshot'));
  await session.stop();
});

test('child crash: reconnect restores list_pages', async () => {
  const session = makeSession('default');
  await session.start();
  await bindPage(session, 'page-allowed', [allowedOrigin]);
  session.transport._process.kill('SIGKILL');
  await new Promise((resolve) => setTimeout(resolve, 100));
  await session.reconnect();
  const pages = await session.listPages();
  assert.ok(pages.length >= 1);
  await session.stop();
});

test('tool error: click surfaces Chrome session tool_error', async () => {
  const session = makeSession('tool-error');
  await session.start();
  await bindPage(session, 'page-allowed', [allowedOrigin]);
  await assert.rejects(() => clickByUid(session, 'uid-missing', [allowedOrigin]), /tool error|Element not found/);
  await session.stop();
});

test('timeout: slow peer tool call fails with timeout', async () => {
  const session = makeSession('timeout', { requestTimeoutMs: 300 });
  await session.start();
  await assert.rejects(() => session.listPages(), /timed out/);
  await session.stop();
});

test('owned-process cleanup stops child and profile without killing unrelated Chrome', async () => {
  const decoy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: false,
    stdio: 'ignore',
  });
  const decoyPid = decoy.pid;
  const session = makeSession('default');
  await session.start();
  const ownedPid = session.ownedChildPid;
  const profileDir = session.ownedProfileDir;
  await session.stop();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(isPidAlive(decoyPid), 'unrelated decoy process must remain running');
  assert.equal(isPidAlive(ownedPid), false, 'owned MCP child must exit');
  await assert.rejects(() => access(profileDir), /ENOENT|not found/i);
  decoy.kill('SIGTERM');
});
