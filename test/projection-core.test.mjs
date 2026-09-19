import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { goalEvidencePatterns, projectEvidenceLanes } from '../skills/jev-browser-use/projection-core.mjs';

const snapshot = await readFile(new URL('./fixtures/generic-property.ax.txt', import.meta.url), 'utf8');

test('projects generic evidence lanes with origin-only header and protected actions', () => {
  const projected = projectEvidenceLanes(snapshot, { goal: 'Find room size and children age policy', actions: [{index: 2, op: 'click', name: 'Book now'}], evidencePatterns: [/room size/i, /children/i] });
  assert.match(projected, /^Browser tab: Example \(origin https:\/\/stay\.example\.test\)\.$/m);
  assert.match(projected, /^2 button Book now$/m);
  assert.match(projected, /^4 text Room size: 42 m²$/m);
  assert.match(projected, /^5 text Children 0-5 years old stay for free\.$/m);
  assert.doesNotMatch(projected, /checkin=|footer noise|listing\/quiet-flat|Credentials/);
});

test('accepts arbitrary goal evidence phrases without site vocabulary', () => {
  const projected = projectEvidenceLanes(snapshot, { goal: 'Find square footage and child age policy', actions: [], evidencePatterns: [/square footage/i, /child age/i, /42 m²/i] });
  assert.match(projected, /Room size: 42 m²/);
  assert.match(projected, /Children 0-5 years old/);
});

test('matches both child and children when the goal uses either form', () => {
  const patterns = goalEvidencePatterns('Find child age policy');
  assert.ok(patterns.some(pattern => pattern.test('Children 0-5 years old')));
  assert.ok(patterns.some(pattern => pattern.test('child age')));
});

test('rejects protected action overflow', () => {
  assert.throws(() => projectEvidenceLanes(snapshot, { goal: 'Find room size', actions: [{index: 2, op: 'click', name: 'Book now'}], evidencePatterns: [/room size/i], maxChars: 20 }), /Projection exceeds safe limit/);
});
