#!/usr/bin/env node
/**
 * Scripted MCP peer for chrome-session tests (not a product backend).
 */
import readline from 'node:readline';
import { serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';

const scenario = process.argv[2] ?? 'default';
const allowedOrigin = process.env.JEV_PEER_ALLOWED_ORIGIN ?? 'https://allowed.test';
const blockedOrigin = process.env.JEV_PEER_BLOCKED_ORIGIN ?? 'https://blocked.test';

const allowlistedTools = [
  'list_pages',
  'select_page',
  'take_snapshot',
  'click',
  'navigate_page',
];

let pages = [
  { pageId: 'page-allowed', url: `${allowedOrigin}/start` },
  { pageId: 'page-blocked', url: `${blockedOrigin}/nope` },
];
let selectedPageId = null;
let initialized = false;
let pageClosureTriggered = false;
let delayMs = scenario === 'timeout' ? 30_000 : 0;
let snapshotCallCount = 0;
let clickDelayMs = scenario === 'task-slow-click' ? 2_000 : 0;

function writeMessage(message) {
  process.stdout.write(serializeMessage(message));
}

function toolResult(payload, { isError = false } = {}) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError,
  };
}

function handleInitialize(id) {
  initialized = true;
  process.stderr.write('scripted-peer-ready\n');
  writeMessage({
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'scripted-chrome-mcp-peer', version: '0.0.0' },
    },
  });
}

function handleToolsList(id) {
  writeMessage({
    jsonrpc: '2.0',
    id,
    result: {
      tools: allowlistedTools.map((name) => ({
        name,
        description: name,
        inputSchema: { type: 'object' },
      })),
    },
  });
}

async function handleToolsCall(id, params) {
  if (scenario === 'child-crash') {
    process.exit(2);
  }
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const name = params?.name;
  const args = params?.arguments ?? {};

  if (scenario === 'tool-error' && name === 'click') {
    writeMessage({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: 'Element not found' }],
        isError: true,
      },
    });
    return;
  }

  if (name === 'list_pages') {
    if (scenario === 'page-closure' && pageClosureTriggered) {
      pages = [];
    }
    writeMessage({ jsonrpc: '2.0', id, result: toolResult({ pages }) });
    return;
  }

  if (name === 'select_page') {
    const page = pages.find((entry) => entry.pageId === args.pageId);
    if (!page) {
      writeMessage({
        jsonrpc: '2.0',
        id,
        result: toolResult({ error: 'unknown page' }, { isError: true }),
      });
      return;
    }
    selectedPageId = page.pageId;
    if (scenario === 'page-closure') {
      pageClosureTriggered = true;
    }
    writeMessage({ jsonrpc: '2.0', id, result: toolResult({ selectedPageId }) });
    return;
  }

  if (name === 'take_snapshot') {
    snapshotCallCount += 1;
    const page = pages.find((p) => p.pageId === args.pageId);
    const url = page?.url ?? 'about:blank';
    let body = `Browser tab: Example (pageId=${args.pageId}) URL: "${url}".\n2 button Continue`;
    if (scenario === 'task-changed-snapshot' && snapshotCallCount > 1) {
      body += '\n99 text unrelated accessibility churn';
    }
    writeMessage({
      jsonrpc: '2.0',
      id,
      result: toolResult({ snapshot: body }),
    });
    return;
  }

  if (name === 'click') {
    if (clickDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, clickDelayMs));
    }
    if (scenario === 'task-secret-error') {
      writeMessage({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: 'Element missing sk-abcdefghijklmnopqrstuvwxyz' }],
          isError: true,
        },
      });
      return;
    }
    writeMessage({ jsonrpc: '2.0', id, result: toolResult({ clicked: args.uid }) });
    return;
  }

  if (name === 'navigate_page') {
    const page = pages.find((entry) => entry.pageId === args.pageId);
    if (page) {
      page.url = scenario === 'task-off-origin' ? `${blockedOrigin}/left` : args.url;
    }
    writeMessage({ jsonrpc: '2.0', id, result: toolResult({ url: page?.url ?? args.url }) });
    return;
  }

  writeMessage({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Unknown tool: ${name}` },
  });
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (method === 'initialize') {
    handleInitialize(id);
    return;
  }
  if (method === 'notifications/initialized') {
    return;
  }
  if (method === 'tools/list') {
    handleToolsList(id);
    return;
  }
  if (method === 'tools/call') {
    void handleToolsCall(id, params);
    return;
  }
  if (id !== undefined) {
    writeMessage({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Unsupported method: ${method}` },
    });
  }
});

process.stdin.on('close', () => {
  process.exit(0);
});
