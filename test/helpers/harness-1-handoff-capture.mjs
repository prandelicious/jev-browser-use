#!/usr/bin/env bun
/**
 * Harness 1 handoff probe: MCP initialize + run_browser_task with handoff-blocked scenario.
 * Writes combined stdout/stderr transcript for work/chrome-devtools-mcp-cloud/.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { HOST_TOOL_NAME, TASK_STATUSES } from '../../src/contract.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const capturePath =
  process.env.JEV_HARNESS_CAPTURE_PATH ??
  join(__dirname, '../../work/chrome-devtools-mcp-cloud/harness-1-handoff-capture.txt');

const allowedOrigin = process.env.JEV_HARNESS_FIXTURE_ORIGIN;
if (!allowedOrigin) {
  console.error('JEV_HARNESS_FIXTURE_ORIGIN is required');
  process.exit(2);
}

const lines = [];
function log(line) {
  const text = String(line);
  lines.push(text);
  process.stdout.write(`${text}\n`);
}

const entry = join(__dirname, 'jev-mcp-server-harness1-entry.mjs');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  env: {
    ...process.env,
    JEV_HARNESS_DECISION_SCENARIO: 'handoff-blocked',
    JEV_HARNESS_NAVIGATE_URL: `${allowedOrigin}/basic-click.html`,
  },
});

const client = new Client({ name: 'harness-1-handoff-capture', version: '0.0.0' });
await client.connect(transport);
log('harness-1: initialize ok');

const tools = await client.listTools();
log(`harness-1: tools=${tools.tools.map((tool) => tool.name).join(',')}`);

const response = await client.callTool({
  name: HOST_TOOL_NAME,
  arguments: {
    goal: 'Open details on the fixture page',
    allowedOrigins: [allowedOrigin],
    page: '1',
    maxActions: 3,
    maxDurationMs: 60_000,
  },
});

const textBlock = response.content?.find((entry) => entry.type === 'text');
const payload = textBlock?.text ? JSON.parse(textBlock.text) : null;
if (!payload || !TASK_STATUSES.includes(payload.status)) {
  log(`harness-1: invalid status payload=${textBlock?.text ?? 'missing'}`);
  writeFileSync(capturePath, `${lines.join('\n')}\n`, 'utf8');
  process.exit(1);
}

log(`harness-1: status=${payload.status} handoffReason=${payload.handoffReason ?? 'none'}`);
log(`harness-1: actionsExecuted=${payload.metrics?.actionsExecuted ?? 0}`);

await client.close();

writeFileSync(capturePath, `${lines.join('\n')}\n`, 'utf8');
if (payload.status !== 'handoff' || payload.handoffReason !== 'model_blocked') {
  process.exit(1);
}
