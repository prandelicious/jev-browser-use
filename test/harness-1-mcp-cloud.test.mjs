import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CHROME_DEVTOOLS_MCP_PIN,
  HOST_TOOL_NAME,
  TASK_STATUSES,
} from '../src/contract.mjs';
import { startFixtureServer } from './fixtures/e2e/server.mjs';
import { recordIsolatedChromeVersions } from './helpers/chrome-e2e-helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workDir = join(__dirname, '../work/chrome-devtools-mcp-cloud');
const harness1RecordPath = join(workDir, 'harness-1-record.json');
const handoffCapturePath = join(workDir, 'harness-1-handoff-capture.txt');
const benchmarkPath = join(workDir, 'benchmark-slice5.json');

const E2E_TIMEOUT_MS = 180_000;

function harnessEntryPath() {
  return join(__dirname, 'helpers/jev-mcp-server-harness1-entry.mjs');
}

async function connectHarnessClient(fixtureOrigin, decisionScenario) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [harnessEntryPath()],
    env: {
      ...process.env,
      JEV_HARNESS_DECISION_SCENARIO: decisionScenario,
      JEV_HARNESS_NAVIGATE_URL: `${fixtureOrigin}/basic-click.html`,
    },
  });
  const client = new Client({ name: 'harness-1-cursor-cloud', version: '0.0.0' });
  await client.connect(transport);
  return { client, transport };
}

test(
  'harness 1: MCP initialize and fixture run_browser_task returns documented status',
  { timeout: E2E_TIMEOUT_MS },
  async () => {
    const fixture = await startFixtureServer();
    const startedAt = performance.now();
    const { client } = await connectHarnessClient(fixture.origin, 'fixture-complete');

    const listed = await client.listTools();
    assert.ok(listed.tools.some((tool) => tool.name === HOST_TOOL_NAME));

    const response = await client.callTool({
      name: HOST_TOOL_NAME,
      arguments: {
        goal: 'Open the details panel on the fixture page',
        allowedOrigins: [fixture.origin],
        page: '1',
        maxActions: 6,
        maxDurationMs: 90_000,
      },
    });
    assert.ok(response.isError !== true);

    const textBlock = response.content?.find((entry) => entry.type === 'text');
    assert.ok(textBlock?.text);
    const payload = JSON.parse(textBlock.text);
    assert.ok(TASK_STATUSES.includes(payload.status), `status must be documented: ${payload.status}`);
    assert.equal(payload.status, 'completed');
    assert.equal(payload.mechanicalGoalSatisfied, true);
    assert.ok(payload.metrics.actionsExecuted >= 1);

    const wallTimeMs = Math.round(performance.now() - startedAt);
    const versions = await recordIsolatedChromeVersions();

    const record = {
      schemaVersion: 1,
      harness: 'cursor-cloud-agent-linux',
      product: 'Cursor Cloud Agent (harness 1)',
      serverEntry: 'src/mcp/server.mjs via test/helpers/jev-mcp-server-harness1-entry.mjs',
      chromeDevtoolsMcpPin: CHROME_DEVTOOLS_MCP_PIN.spec,
      fixture: 'test/fixtures/e2e loopback HTTP (basic-click.html)',
      initialize: 'ok',
      toolDiscovery: listed.tools.map((tool) => tool.name),
      runBrowserTask: {
        requestFields: ['goal', 'allowedOrigins', 'page', 'maxActions', 'maxDurationMs'],
        resultStatus: payload.status,
        metrics: payload.metrics,
      },
      wallTimeMs,
      recordedOn: versions.recordedOn,
      bunVersion: versions.bunVersion,
      nodeVersion: versions.nodeVersion,
      chrome: versions.chrome,
      mcpSdk: versions.mcpSdk,
    };

    await writeFile(harness1RecordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

    const benchmark = {
      schemaVersion: 1,
      recordedOn: versions.recordedOn,
      chromeDevtoolsMcpPin: CHROME_DEVTOOLS_MCP_PIN.spec,
      notes:
        'Slice 5 harness-1 fixture benchmark on loopback only. Codex-path and host-only baselines are not measured on this VM.',
      tasks: [
        {
          id: 'harness-1-loopback-basic-click',
          description:
            'MCP client run_browser_task on basic-click.html via pinned isolated Chrome (harness 1).',
          verifiedCompletion: true,
          wallTimeMs,
          hostTurns: 'unavailable',
          hostTurnsReason: 'No host conversation loop; direct MCP tools/call from test client.',
          modelCost: 'unavailable',
          modelCostReason: 'Scripted decision provider; no billed model API.',
          handoffs: 0,
          retries: payload.metrics?.staleRetries ?? 0,
          unsafeAttempts: 0,
        },
        {
          id: 'generic-property-projection-fixture',
          description: 'Slice 0 placeholder; not re-run on a live site in slice 5.',
          verifiedCompletion: 'unavailable',
          verifiedCompletionReason: 'Not in harness-1 scope.',
          wallTimeMs: 'unavailable',
          wallTimeMsReason: 'Not measured in slice 5.',
          hostTurns: 'unavailable',
          modelCost: 'unavailable',
          handoffs: 'unavailable',
          retries: 'unavailable',
          unsafeAttempts: 'unavailable',
        },
        {
          id: 'host-only-manual-verification-loop',
          description: 'Comparison baseline; not measured on this VM in slice 5.',
          verifiedCompletion: 'unavailable',
          verifiedCompletionReason: 'Requires host-only browser loop.',
          wallTimeMs: 'unavailable',
          hostTurns: 'unavailable',
          modelCost: 'unavailable',
          handoffs: 'unavailable',
          retries: 'unavailable',
          unsafeAttempts: 'unavailable',
        },
      ],
    };
    await writeFile(benchmarkPath, `${JSON.stringify(benchmark, null, 2)}\n`, 'utf8');

    await client.close();
    await fixture.stop();
  },
);

test(
  'harness 1: handoff capture file records model_blocked handoff command output',
  { timeout: E2E_TIMEOUT_MS },
  async () => {
    const fixture = await startFixtureServer();
    const captureScript = join(__dirname, 'helpers/harness-1-handoff-capture.mjs');
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [captureScript], {
        env: {
          ...process.env,
          JEV_HARNESS_FIXTURE_ORIGIN: fixture.origin,
          JEV_HARNESS_CAPTURE_PATH: handoffCapturePath,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', (code) => {
        const combined = [stdout, stderr].filter(Boolean).join('\n');
        const finish = () => resolve({ code: code ?? 1, stdout, stderr });
        if (combined.trim()) {
          writeFile(handoffCapturePath, `${combined.trim()}\n`, 'utf8').then(finish).catch(reject);
        } else {
          finish();
        }
      });
    });

    assert.equal(exitCode.code, 0, `handoff capture failed: ${exitCode.stderr || exitCode.stdout}`);
    const saved = await readFile(handoffCapturePath, 'utf8');
    assert.match(saved, /harness-1: initialize ok/);
    assert.match(saved, /harness-1: status=handoff handoffReason=model_blocked/);
    assert.match(saved, /harness-1: actionsExecuted=0/);

    await fixture.stop();
  },
);
