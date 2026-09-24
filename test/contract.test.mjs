/**
 * Contract tests for the frozen host-facing task schema (slice 0).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWLISTED_CHROME_DEVTOOLS_TOOLS,
  CHROME_DEVTOOLS_MCP_1_9_0_ALL_TOOL_NAMES,
  CHROME_DEVTOOLS_MCP_PIN,
  DEFAULT_MECHANICAL_ACTIONS,
  NON_GOALS,
  SERVER_CAPS,
  TASK_REQUEST_FIELDS,
  TASK_STATUSES,
  assertMechanicalActionNonGoals,
  assertPinIsExact,
  effectiveMaxActions,
  effectiveMaxDurationMs,
  validateAllowedOrigin,
  validateRunBrowserTaskRequest,
  validateTaskResultSemantics,
  validateTaskStatus,
} from '../src/contract.mjs';

test('pin is exact chrome-devtools-mcp@1.9.0 without @latest', () => {
  assertPinIsExact();
  assert.equal(CHROME_DEVTOOLS_MCP_PIN.version, '1.9.0');
  assert.match(CHROME_DEVTOOLS_MCP_PIN.launchCommand, /chrome-devtools-mcp@1\.9\.0/);
  assert.doesNotMatch(CHROME_DEVTOOLS_MCP_PIN.launchCommand, /@latest/i);
});

test('allowlisted chrome tools exist in verified 1.9.0 tool name set', () => {
  const verified = new Set(CHROME_DEVTOOLS_MCP_1_9_0_ALL_TOOL_NAMES);
  for (const name of ALLOWLISTED_CHROME_DEVTOOLS_TOOLS) {
    assert.ok(verified.has(name), `missing verified tool ${name}`);
  }
});

test('request fields and six statuses are frozen', () => {
  assert.deepEqual(TASK_STATUSES, [
    'completed',
    'handoff',
    'stale_state',
    'policy_denied',
    'timeout',
    'error',
  ]);
  assert.equal(TASK_STATUSES.length, 6);
  assert.ok(TASK_REQUEST_FIELDS.includes('goal'));
  assert.ok(TASK_REQUEST_FIELDS.includes('allowedOrigins'));
});

test('default mechanical actions are semantic click and bounded navigation', () => {
  assert.deepEqual(DEFAULT_MECHANICAL_ACTIONS, ['semantic_click', 'navigate']);
});

test('non-goals include no second adapter and no silent autoConnect', () => {
  assert.ok(NON_GOALS.includes('second_browser_adapter'));
  assert.ok(NON_GOALS.includes('silent_autoConnect'));
  assert.ok(NON_GOALS.includes('routine_evaluate_script'));
});

test('validateTaskStatus rejects unknown statuses', () => {
  assert.throws(() => validateTaskStatus('succeeded'), /Invalid task status/);
  assert.throws(() => validateTaskStatus('completed_pending_user'), /Invalid task status/);
});

test('validateAllowedOrigin accepts HTTPS and loopback HTTP only for tests', () => {
  validateAllowedOrigin('https://example.com');
  validateAllowedOrigin('http://127.0.0.1:4173');
  validateAllowedOrigin('http://localhost:3000');
  assert.throws(() => validateAllowedOrigin('http://example.com'), /HTTPS or loopback/);
  assert.throws(() => validateAllowedOrigin('ftp://127.0.0.1'), /HTTPS or loopback/);
});

test('completed is not treated as final user-task verification', () => {
  assert.throws(
    () =>
      validateTaskResultSemantics({
        status: 'completed',
        mechanicalGoalSatisfied: true,
        finalUserVerification: true,
      }),
    /not final user-task verification/,
  );
  validateTaskResultSemantics({
    status: 'completed',
    mechanicalGoalSatisfied: true,
    finalUserVerification: false,
  });
});

test('server caps cannot be raised above conservative maxima', () => {
  assert.equal(effectiveMaxActions(999), SERVER_CAPS.maxMaxActions);
  assert.equal(effectiveMaxDurationMs(9_999_999), SERVER_CAPS.maxMaxDurationMs);
});

test('pin validation fails closed on @latest', () => {
  assert.throws(
    () =>
      assertPinIsExact({
        version: '1.9.0',
        spec: 'chrome-devtools-mcp@latest',
        launchCommand: 'npx chrome-devtools-mcp@latest',
      }),
    /@latest/,
  );
});

test('validateRunBrowserTaskRequest rejects browse-freely goals', () => {
  assert.throws(
    () =>
      validateRunBrowserTaskRequest({
        goal: 'browse freely across the web',
        allowedOrigins: ['https://example.com'],
      }),
    /browse-freely/,
  );
});

test('routine non-goal mechanical escapes are rejected', () => {
  assert.throws(() => assertMechanicalActionNonGoals('evaluate_script'), /Non-goal/);
  assert.throws(() => assertMechanicalActionNonGoals('click_at'), /Non-goal/);
});
