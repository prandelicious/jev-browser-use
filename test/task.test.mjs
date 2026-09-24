import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { HOST_TOOL_NAME, TASK_STATUSES } from '../src/contract.mjs';
import { ChromeDevtoolsSession } from '../src/chrome/session.mjs';
import { runBrowserTask, sanitizePublicTaskResult } from '../src/task/run.mjs';
import { testPeerTransport } from './helpers/chrome-test-transport.mjs';
import { createScriptedDecisionSource, buildScriptedDecisionAnswer } from './helpers/scripted-decision.mjs';

const allowedOrigin = 'https://allowed.test';
const blockedOrigin = 'https://blocked.test';
const __dirname = dirname(fileURLToPath(import.meta.url));

function makeSession(scenario, overrides = {}) {
  return new ChromeDevtoolsSession({
    allowedOrigins: [allowedOrigin],
    transportOptions: testPeerTransport(scenario, {
      JEV_PEER_ALLOWED_ORIGIN: allowedOrigin,
      JEV_PEER_BLOCKED_ORIGIN: blockedOrigin,
    }),
    startupTimeoutMs: 5_000,
    requestTimeoutMs: 5_000,
    ...overrides,
  });
}

function baseRequest(overrides = {}) {
  return {
    goal: 'Continue the fixture flow',
    allowedOrigins: [allowedOrigin],
    page: 'page-allowed',
    maxActions: 4,
    maxDurationMs: 15_000,
    ...overrides,
  };
}

function assertNoBrowserActions(result) {
  assert.equal(result.metrics.actionsExecuted, 0);
}

test('changed snapshot: stale_state without executing click', async () => {
  const session = makeSession('task-changed-snapshot');
  const decide = createScriptedDecisionSource([{ choice: 'a0', confidence: 0.95 }]);
  const result = await runBrowserTask(baseRequest(), { session, decide, maxStaleRetries: 0 });
  assert.equal(result.status, 'stale_state');
  assertNoBrowserActions(result);
});

test('unrelated accessibility churn: stale_state without click', async () => {
  const session = makeSession('task-changed-snapshot');
  const decide = createScriptedDecisionSource([{ choice: 'a0', confidence: 0.95 }]);
  const result = await runBrowserTask(baseRequest(), { session, decide, maxStaleRetries: 0 });
  assert.equal(result.status, 'stale_state');
  assertNoBrowserActions(result);
});

test('swapped UID binding: stale_state without click', async () => {
  const session = makeSession('task-default');
  let builds = 0;
  const buildPermittedActions = ({ rawObservation }) => {
    builds += 1;
    assert.match(rawObservation, /Continue/);
    const uid = builds === 1 ? 'uid-2' : 'uid-attacker';
    return [{ op: 'click', uid, description: 'Click Continue' }];
  };
  const decide = createScriptedDecisionSource([{ choice: 'a0', confidence: 0.95 }]);
  const result = await runBrowserTask(baseRequest(), {
    session,
    decide,
    buildPermittedActions,
    maxStaleRetries: 0,
  });
  assert.equal(result.status, 'stale_state');
  assertNoBrowserActions(result);
});

test('low confidence: handoff without click', async () => {
  const session = makeSession('task-default');
  const decide = createScriptedDecisionSource([{ choice: 'a0', confidence: 0.1 }]);
  const result = await runBrowserTask(baseRequest(), { session, decide });
  assert.equal(result.status, 'handoff');
  assert.equal(result.handoffReason, 'low_confidence');
  assertNoBrowserActions(result);
});

test('off-origin navigation: policy_denied without navigate_page', async () => {
  const session = makeSession('task-off-origin');
  const buildPermittedActions = () => [
    { op: 'navigate', url: `${blockedOrigin}/nope`, description: 'Navigate away' },
  ];
  const decide = createScriptedDecisionSource([{ choice: 'a0', confidence: 0.95 }]);
  const result = await runBrowserTask(baseRequest({ allowedMechanicalActions: ['navigate'] }), {
    session,
    decide,
    buildPermittedActions,
  });
  assert.equal(result.status, 'policy_denied');
  assertNoBrowserActions(result);
});

test('cancellation during an action: uncertain handoff and no further scheduling', async () => {
  const session = makeSession('task-slow-click');
  const decide = createScriptedDecisionSource([
    { choice: 'a0', confidence: 0.95 },
    { choice: 'a0', confidence: 0.95 },
  ]);
  const abortController = new AbortController();
  setTimeout(() => abortController.abort(), 150);
  const result = await runBrowserTask(baseRequest({ maxActions: 3 }), {
    session,
    decide,
    abortSignal: abortController.signal,
  });
  assert.equal(result.status, 'handoff');
  assert.equal(result.handoffReason, 'cancelled');
  assert.equal(result.uncertainAction, true);
  assert.equal(result.metrics.actionsExecuted, 0);
});

test('unsupported action: policy_denied before browser action', async () => {
  const session = makeSession('task-default');
  const buildPermittedActions = () => [{ op: 'scroll', direction: 'down', description: 'Scroll down' }];
  const decide = createScriptedDecisionSource([{ choice: 'a0', confidence: 0.95 }]);
  const result = await runBrowserTask(baseRequest({ allowedMechanicalActions: ['semantic_click'] }), {
    session,
    decide,
    buildPermittedActions,
  });
  assert.equal(result.status, 'policy_denied');
  assertNoBrowserActions(result);
});

test('provider error text containing a secret is redacted from public result', async () => {
  const session = makeSession('task-default');
  const decide = async () => {
    throw new Error('typesafe sk-abcdefghijklmnopqrstuvwxyz transport failure');
  };
  const result = await runBrowserTask(baseRequest(), { session, decide });
  assert.equal(result.status, 'error');
  assert.doesNotMatch(String(result.error), /sk-abcdefghijklmnopqrstuvwxyz/);
});

test('browser tool error containing a secret is redacted from public result', async () => {
  const session = makeSession('task-secret-error');
  const decide = createScriptedDecisionSource([{ choice: 'a0', confidence: 0.95 }]);
  const result = await runBrowserTask(baseRequest(), { session, decide });
  assert.equal(result.status, 'error');
  assert.doesNotMatch(String(result.error), /sk-abcdefghijklmnopqrstuvwxyz/);
});

test('completed path executes one allowlisted click then stops on DONE', async () => {
  const session = makeSession('task-default');
  const decide = createScriptedDecisionSource([
    { choice: 'a0', confidence: 0.95 },
    { choice: 'DONE', confidence: 0.95 },
  ]);
  const result = await runBrowserTask(baseRequest(), { session, decide });
  assert.equal(result.status, 'completed');
  assert.equal(result.mechanicalGoalSatisfied, true);
  assert.equal(result.metrics.actionsExecuted, 1);
});

test('public result fixtures for every status omit raw accessibility trees and page text', () => {
  const fixtures = {
    completed: {
      status: 'completed',
      mechanicalGoalSatisfied: true,
      finalUserVerification: false,
      history: [],
      metrics: { elapsedMs: 1, decisions: 1, actionsExecuted: 1, staleRetries: 0 },
      pageId: 'page-allowed',
      origin: allowedOrigin,
    },
    handoff: {
      status: 'handoff',
      handoffReason: 'model_blocked',
      history: [],
      metrics: { elapsedMs: 1, decisions: 1, actionsExecuted: 0, staleRetries: 0 },
    },
    stale_state: {
      status: 'stale_state',
      history: [],
      metrics: { elapsedMs: 1, decisions: 1, actionsExecuted: 0, staleRetries: 1 },
    },
    policy_denied: {
      status: 'policy_denied',
      history: [],
      metrics: { elapsedMs: 1, decisions: 0, actionsExecuted: 0, staleRetries: 0 },
    },
    timeout: {
      status: 'timeout',
      history: [],
      metrics: { elapsedMs: 1, decisions: 0, actionsExecuted: 0, staleRetries: 0 },
    },
    error: {
      status: 'error',
      error: 'Browser or decision provider error',
      history: [],
      metrics: { elapsedMs: 1, decisions: 0, actionsExecuted: 0, staleRetries: 0 },
    },
  };
  for (const status of TASK_STATUSES) {
    const sanitized = sanitizePublicTaskResult(fixtures[status]);
    assert.equal(sanitized.status, status);
    assert.doesNotMatch(JSON.stringify(sanitized), /Browser tab:|Room size:|uid-/);
  }
});

test('MCP client performs initialize and tools/call run_browser_task', async () => {
  const entry = join(__dirname, 'helpers/jev-mcp-server-test-entry.mjs');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: {
      ...process.env,
      JEV_CHROME_PEER_SCENARIO: 'task-default',
      JEV_PEER_ALLOWED_ORIGIN: allowedOrigin,
    },
  });
  const client = new Client({ name: 'task-test-client', version: '0.0.0' });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === HOST_TOOL_NAME));
  const response = await client.callTool({
    name: HOST_TOOL_NAME,
    arguments: baseRequest(),
  });
  assert.ok(response.isError !== true);
  const textBlock = response.content?.find((entry) => entry.type === 'text');
  assert.ok(textBlock?.text);
  const payload = JSON.parse(textBlock.text);
  assert.equal(payload.status, 'completed');
  await client.close();
});

test('server handler delegates to src/task/run.mjs without a second loop', async () => {
  const serverSource = await readFile(new URL('../src/mcp/server.mjs', import.meta.url), 'utf8');
  assert.match(serverSource, /runBrowserTask/);
  assert.doesNotMatch(serverSource, /while\s*\(/);
});
