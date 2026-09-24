import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const bridgePath = join(repoRoot, 'skills/jev-browser-use/bridge.mjs');

async function bridgeSource() {
  return readFile(bridgePath, 'utf8');
}

function attachTabExportBlock(source) {
  const match = source.match(/export\s+function\s+attachTab\s*\([^)]*\)/);
  return match ? match[0] : null;
}

function runOptionsDestructuring(source) {
  const match = source.match(/export\s+async\s+function\s+run\s*\(\s*tab\s*,\s*(\{[\s\S]*?\})\s*[,)]/);
  return match ? match[1] : null;
}

test('bridge.mjs does not implement a JS catalog', async () => {
  const source = await bridgeSource();
  assert.doesNotMatch(source, /\bdeclaredTools\b/);
  assert.doesNotMatch(source, /\bALL_TOOLS\b/);
  assert.doesNotMatch(source, /mcp__cua_repl/);
});

test('bridge.mjs does not open browsers via createBrowserTab', async () => {
  const source = await bridgeSource();
  const tabFactory = 'create' + 'BrowserTab';
  assert.doesNotMatch(source, new RegExp(tabFactory));
});

test('attachTab is exactly attachTab(tab) with no extra parameters', async () => {
  const source = await bridgeSource();
  const block = attachTabExportBlock(source);
  assert.ok(block, 'attachTab must be exported from bridge.mjs');
  assert.match(block, /^export\s+function\s+attachTab\s*\(\s*tab\s*\)\s*$/);
  assert.doesNotMatch(source, /export\s+function\s+attachTab\s*\(\s*tab\s*,/);
  assert.doesNotMatch(source, /export\s+function\s+attachTab\s*\([^)]*\bsnapshot\b/);
});

test('run and createSession do not declare snapshot or declaredTools parameters', async () => {
  const source = await bridgeSource();
  const runHead = source.match(/export\s+async\s+function\s+run\s*\([^)]+\)/)?.[0] ?? '';
  assert.doesNotMatch(runHead, /\bsnapshot\b/);
  assert.doesNotMatch(runHead, /\bdeclaredTools\b/);

  const sessionHead = source.match(/export\s+function\s+createSession\s*\([^)]+\)/)?.[0] ?? '';
  assert.doesNotMatch(sessionHead, /\bsnapshot\b/);
  assert.doesNotMatch(sessionHead, /\bdeclaredTools\b/);
});

test('run options destructuring does not accept snapshot or declaredTools fields', async () => {
  const source = await bridgeSource();
  const destructuring = runOptionsDestructuring(source);
  assert.ok(destructuring, 'run(tab, { ... }) options object must be present');
  assert.doesNotMatch(destructuring, /\bsnapshot\s*[:,=]/);
  assert.doesNotMatch(destructuring, /\bdeclaredTools\s*[:,=]/);
});

test('bridge.mjs does not import Playwright, CDP, WebView, or debug-port helpers', async () => {
  const source = await bridgeSource();
  const importLines = source.split('\n').filter((line) => /^\s*import\b/.test(line)).join('\n');
  assert.doesNotMatch(importLines, /playwright/i);
  assert.doesNotMatch(importLines, /connectOverCDP/);
  assert.doesNotMatch(importLines, /Bun\.WebView/);
  assert.doesNotMatch(importLines, /9222/);
});

test('attachTab does not call createBrowserTab', async () => {
  const source = await bridgeSource();
  const fnBody = source.match(/export\s+function\s+attachTab\s*\(\s*tab\s*\)\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  const tabFactory = 'create' + 'BrowserTab';
  assert.ok(fnBody, 'attachTab body must exist');
  assert.doesNotMatch(fnBody, new RegExp(tabFactory));
});

test('tests do not call createBrowserTab', async () => {
  const testDir = join(repoRoot, 'test');
  const tabFactory = 'create' + 'BrowserTab';
  const pattern = new RegExp(tabFactory);
  const names = await readdir(testDir);
  for (const name of names) {
    if (!name.endsWith('.test.mjs') || name.includes('grep')) continue;
    const text = await readFile(join(testDir, name), 'utf8');
    assert.doesNotMatch(text, pattern, `${name} must not call createBrowserTab`);
  }
});
