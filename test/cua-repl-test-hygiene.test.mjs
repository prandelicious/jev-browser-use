import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const selfBasename = 'cua-repl-test-hygiene.test.mjs';

async function otherTestSources() {
  const names = await readdir(testDir);
  const files = [];
  for (const name of names) {
    if (!name.endsWith('.test.mjs') || name === selfBasename) continue;
    files.push({ name, text: await readFile(join(testDir, name), 'utf8') });
  }
  return files;
}

test('no test treats attachTab or run as accepting a Codex or branded fixture tab', async () => {
  const forbidden = [
    /\balready-authorized\b/i,
    /\bas Codex\b/i,
    /\bbranded tab\b/i,
    /\bauthorized cua_repl\b/i,
    /assert\.doesNotThrow\([^)]*attachTab/,
    /await attachTab\(\s*(?:valid|fixture|codex|acceptable)Tab/i,
  ];
  for (const { name, text } of await otherTestSources()) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${name} must not accept a fixture tab as Codex`);
    }
  }
});

test('no test claims a caller-built declaredTools array authorizes attachTab or run', async () => {
  const forbidden = [
    /declaredTools\s*:\s*\[[^\]]*mcp__cua_repl[^\]]*\][\s\S]{0,120}(?:doesNotThrow|attachTab succeeds|authoriz)/i,
    /fake declaredTools[\s\S]{0,80}authoriz/i,
  ];
  for (const { name, text } of await otherTestSources()) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${name} must not treat declaredTools as authorization`);
    }
  }
});

test('attachTab and run source in tests do not import Playwright, CDP, WebView, or 9222', async () => {
  const forbidden = [/from\s+['"]playwright/i, /connectOverCDP/, /Bun\.WebView/, /\b9222\b/];
  for (const { name, text } of await otherTestSources()) {
    if (!/attachTab|skills\/jev-browser-use\/bridge/.test(text)) continue;
    const importLines = text.split('\n').filter((line) => /^\s*import\b/.test(line)).join('\n');
    for (const pattern of forbidden) {
      assert.doesNotMatch(importLines, pattern, `${name} must not import forbidden browser drivers`);
    }
  }
});
