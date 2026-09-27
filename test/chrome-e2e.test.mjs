import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME_DEVTOOLS_MCP_PIN } from '../src/contract.mjs';
import { ChromeDevtoolsSession } from '../src/chrome/session.mjs';
import {
  bindPage,
  clickByUid,
  takeSnapshot,
} from '../src/chrome/actions.mjs';
import { ChromeActionPolicyError } from '../src/chrome/actions.mjs';
import { runBrowserTask } from '../src/task/run.mjs';
import { startFixtureServer } from './fixtures/e2e/server.mjs';
import {
  findElementUid,
  isPidAlive,
  recordIsolatedChromeVersions,
  snapshotText,
  spawnDecoyProcess,
  navigateDefaultTab,
} from './helpers/chrome-e2e-helpers.mjs';
import { createScriptedDecisionSource } from './helpers/scripted-decision.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const versionRecordPath = join(__dirname, '../work/chrome-devtools-mcp-cloud/isolated-chrome-linux.json');

const E2E_TIMEOUT_MS = 120_000;

function makeLiveSession(allowedOrigins) {
  return new ChromeDevtoolsSession({
    allowedOrigins,
    startupTimeoutMs: 60_000,
    requestTimeoutMs: 30_000,
  });
}

test(
  'isolated Chrome: version record and pinned child profile',
  { timeout: E2E_TIMEOUT_MS },
  async () => {
    const versions = await recordIsolatedChromeVersions();
    versions.chromeDevtoolsMcpPin = CHROME_DEVTOOLS_MCP_PIN.version;
    await writeFile(versionRecordPath, `${JSON.stringify(versions, null, 2)}\n`, 'utf8');

    const fixture = await startFixtureServer();
    const session = makeLiveSession([fixture.origin]);
    await session.start();
    assert.equal(CHROME_DEVTOOLS_MCP_PIN.version, '1.9.0');
    assert.ok(session.ownedProfileDir?.startsWith(tmpdir()));
    assert.ok(session.isRunning());
    console.log(
      `[chrome-e2e] pin=${CHROME_DEVTOOLS_MCP_PIN.spec} profile=${session.ownedProfileDir} chrome=${versions.chrome}`,
    );
    await session.stop();
    await fixture.stop();
  },
);

test(
  'isolated Chrome: list_pages, select_page, and navigate to loopback fixture',
  { timeout: E2E_TIMEOUT_MS },
  async () => {
    const fixture = await startFixtureServer();
    const session = makeLiveSession([fixture.origin]);
    await session.start();
    await navigateDefaultTab(session, `${fixture.origin}/two-tabs.html`);
    const pages = await session.listPages();
    assert.ok(pages.some((page) => page.url.includes('two-tabs.html')));
    const target = pages.find((page) => page.url.includes('two-tabs.html')) ?? pages[0];
    const bound = await bindPage(session, target.pageId, [fixture.origin]);
    assert.equal(bound.origin, fixture.origin);
    assert.equal(session.binding.pageId, target.pageId);
    await session.stop();
    await fixture.stop();
  },
);

test(
  'isolated Chrome: snapshot, click by current UID, and fresh postcondition',
  { timeout: E2E_TIMEOUT_MS },
  async () => {
    const fixture = await startFixtureServer();
    const session = makeLiveSession([fixture.origin]);
    await session.start();
    await navigateDefaultTab(session, `${fixture.origin}/basic-click.html`);
    const pages = await session.listPages();
    const page = pages.find((entry) => entry.url.includes('basic-click.html')) ?? pages[0];
    await bindPage(session, page.pageId, [fixture.origin]);

    const before = snapshotText(await takeSnapshot(session, [fixture.origin]));
    const openUid = findElementUid(before, { role: 'button', nameIncludes: 'Open details' });
    assert.ok(openUid, 'expected Open details button uid in snapshot');
    assert.doesNotMatch(before, /DETAILS_OPEN/);

    await clickByUid(session, openUid, [fixture.origin]);

    const after = snapshotText(await takeSnapshot(session, [fixture.origin]));
    assert.match(after, /DETAILS_OPEN/);

    await session.stop();
    await fixture.stop();
  },
);

test(
  'isolated Chrome: removed element UID is rejected and not reused',
  { timeout: E2E_TIMEOUT_MS },
  async () => {
    const fixture = await startFixtureServer();
    const session = makeLiveSession([fixture.origin]);
    await session.start();
    await navigateDefaultTab(session, `${fixture.origin}/removed-button.html`);
    const pages = await session.listPages();
    const page = pages[0];
    await bindPage(session, page.pageId, [fixture.origin]);

    const firstSnapshot = snapshotText(await takeSnapshot(session, [fixture.origin]));
    const buttonUid = findElementUid(firstSnapshot, { role: 'button', nameIncludes: 'Remove me' });
    assert.ok(buttonUid);

    await clickByUid(session, buttonUid, [fixture.origin]);

    const afterRemoval = snapshotText(await takeSnapshot(session, [fixture.origin]));
    assert.equal(findElementUid(afterRemoval, { role: 'button', nameIncludes: 'Remove me' }), null);

    await assert.rejects(
      () => clickByUid(session, buttonUid, [fixture.origin]),
      (error) => /not found|tool error|interact/i.test(error.message),
    );

    const clickAttempts = session.callJournal.filter((entry) => entry.name === 'click');
    assert.equal(clickAttempts.length, 2);
    assert.equal(clickAttempts[0].arguments?.uid, buttonUid);
    assert.equal(clickAttempts[1].arguments?.uid, buttonUid);

    await session.stop();
    await fixture.stop();
  },
);

test(
  'isolated Chrome: origin guard fails closed on a non-allowed loopback origin',
  { timeout: E2E_TIMEOUT_MS },
  async () => {
    const allowed = await startFixtureServer();
    const blocked = await startFixtureServer();
    assert.notEqual(allowed.origin, blocked.origin);

    const session = makeLiveSession([allowed.origin]);
    await session.start();
    await navigateDefaultTab(session, `${allowed.origin}/basic-click.html`);
    await bindPage(session, '1', [allowed.origin]);
    await session.callTool('navigate_page', {
      pageId: 1,
      url: `${blocked.origin}/second-origin.html`,
    });
    const pages = await session.listPages();
    const foreign = pages.find((page) => page.url.startsWith(blocked.origin));
    assert.ok(foreign, 'expected foreign-origin tab in list_pages');

    await assert.rejects(
      () => bindPage(session, foreign.pageId, [allowed.origin]),
      (error) => error instanceof ChromeActionPolicyError && error.code === 'wrong_origin',
    );
    assert.ok(!session.callJournal.some((entry) => entry.name === 'click'));

    const decide = createScriptedDecisionSource([{ choice: 'a0', confidence: 0.95 }]);
    const taskResult = await runBrowserTask(
      {
        goal: 'Open the foreign page',
        allowedOrigins: [allowed.origin],
        page: foreign.pageId,
        maxActions: 2,
        maxDurationMs: 30_000,
      },
      { session, decide, maxStaleRetries: 0 },
    );
    assert.equal(taskResult.status, 'policy_denied');
    assert.equal(taskResult.metrics.actionsExecuted, 0);

    await session.stop();
    await allowed.stop();
    await blocked.stop();
  },
);

test(
  'isolated Chrome: owned MCP child and profile cleanup leaves unrelated processes running',
  { timeout: E2E_TIMEOUT_MS },
  async () => {
    const decoy = spawnDecoyProcess();
    const decoyPid = decoy.pid;
    const fixture = await startFixtureServer();
    const session = makeLiveSession([fixture.origin]);
    await session.start();
    await navigateDefaultTab(session, `${fixture.origin}/basic-click.html`);

    const ownedPid = session.ownedChildPid;
    const profileDir = session.ownedProfileDir;
    assert.ok(ownedPid);
    assert.ok(profileDir?.startsWith(tmpdir()));

    await session.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.ok(isPidAlive(decoyPid), 'unrelated decoy process must remain running');
    assert.equal(isPidAlive(ownedPid), false, 'owned MCP child must exit');
    await assert.rejects(() => access(profileDir), /ENOENT|not found/i);

    decoy.kill('SIGTERM');
    await fixture.stop();
  },
);
