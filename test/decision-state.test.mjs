import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectEvidenceLanes } from '../skills/jev-browser-use/projection-core.mjs';

const denseAgoda = await readFile(new URL('./fixtures/agoda-dense-property.ax.txt', import.meta.url), 'utf8');

test('dense Agoda fixture reproduces legacy overflow', () => {
  assert.ok(denseAgoda.length > 100_000);
  assert.throws(() => projectEvidenceLanes(denseAgoda, {
    goal: 'Find room size and child age policy for IDEAL FUKUSHIMA',
    actions: [{op: 'click', index: 41, name: 'Rooms'}],
    evidencePatterns: [/room size/i, /child(?:ren)?/i, /polic(?:y|ies)/i],
    maxChars: 20_000,
  }), /safe limit/);
});
