import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillPath = join(repoRoot, 'skills/jev-browser-use/SKILL.md');
const installPath = join(repoRoot, 'INSTALL.md');

function countOccurrences(text, needle) {
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

test('SKILL removes blank-IAB capability probe leftovers', async () => {
  const skill = await readFile(skillPath, 'utf8');
  const tabFactory = 'create' + 'BrowserTab';
  assert.doesNotMatch(skill, /Copyable first probe/);
  assert.doesNotMatch(skill, /检查浏览器操作接口/);
  assert.doesNotMatch(
    skill,
    new RegExp(`${tabFactory}\\s*\\(\\s*['"]iab['"]\\s*,\\s*['"]about:blank['"]`),
  );
});

test('SKILL has at most one createBrowserTab call site', async () => {
  const skill = await readFile(skillPath, 'utf8');
  const tabFactory = 'create' + 'BrowserTab';
  const count = countOccurrences(skill, tabFactory);
  assert.ok(count <= 1, `expected at most one createBrowserTab in SKILL, found ${count}`);
});

test('SKILL documents declared mcp__cua_repl.js gate', async () => {
  const skill = await readFile(skillPath, 'utf8');
  assert.match(skill, /declared.*mcp__cua_repl\.js|mcp__cua_repl\.js.*declared/i);
});

test('SKILL does not stop solely because ALL_TOOLS is empty', async () => {
  const skill = await readFile(skillPath, 'utf8');
  assert.doesNotMatch(skill, /stop on that basis/i);
  assert.doesNotMatch(skill, /ALL_TOOLS\.filter\([^)]*\/cua\|browser\//);
});

test('SKILL removes struck host-browser and universal cua_repl slogans', async () => {
  const skill = await readFile(skillPath, 'utf8');
  assert.doesNotMatch(skill, /Use `cua_repl` for every UI action/);
  assert.doesNotMatch(skill, /If only host browser controls are available/);
  assert.doesNotMatch(skill, /computerUse/);
});

test('INSTALL.md does not direct a blank-tab mcp__cua_repl capability probe', async () => {
  const install = await readFile(installPath, 'utf8');
  assert.doesNotMatch(install, /mcp__cua_repl.*probe/i);
  assert.doesNotMatch(install, /about:blank/);
});

test('repo does not describe this work as a Cursor adapter success path', async () => {
  const cursor = 'Cursor';
  const forbidden = [
    new RegExp(`${cursor} adapter`, 'i'),
    new RegExp(`${cursor} success`, 'i'),
  ];
  for (const body of [await readFile(skillPath, 'utf8'), await readFile(installPath, 'utf8')]) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(body, pattern);
    }
  }
  const testDir = join(repoRoot, 'test');
  for (const name of await readdir(testDir)) {
    if (!name.endsWith('.test.mjs') || name.includes('grep')) continue;
    const body = await readFile(join(testDir, name), 'utf8');
    for (const pattern of forbidden) {
      assert.doesNotMatch(body, pattern, `${name} must not claim a Cursor adapter path`);
    }
  }
});
