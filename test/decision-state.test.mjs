import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeAXState,
  projectEvidenceLanes,
  scoreEvidence,
  selectEvidence,
} from '../skills/jev-browser-use/projection-core.mjs';

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

test('normalizes a complete AX snapshot into origin and local nodes', () => {
  assert.deepEqual(normalizeAXState([
    'Browser tab: Example URL: "https://stay.example.test/x?secret=1".',
    '7 button Rooms',
    '8 text Room size: 42 m²',
    'malformed page text',
  ].join('\n')), {
    page: {site: 'Example', origin: 'https://stay.example.test'},
    nodes: [
      {index: 7, role: 'button', name: 'Rooms'},
      {index: 8, role: 'text', name: 'Room size: 42 m²'},
    ],
  });
});

test('ranks exact phrases and distinct goal concepts before repeated noise', () => {
  const nodes = [
    {index: 1, role: 'text', name: 'Room size: 42 m²'},
    {index: 2, role: 'text', name: 'Room size: 43 m²'},
    {index: 3, role: 'text', name: 'Children 0-5 years old'},
    {index: 4, role: 'text', name: 'Unrelated garden information'},
  ];
  assert.ok(scoreEvidence(nodes[0], {goalTokens: ['room', 'size', 'child', 'policy'], goalPhrases: ['room size']})
    > scoreEvidence(nodes[3], {goalTokens: ['room', 'size', 'child', 'policy'], goalPhrases: ['room size']}));
  const selected = selectEvidence(nodes, {
    goal: 'Find room size and child age policy',
    maxItems: 3,
    maxPerSignature: 1,
  });
  assert.equal(selected.length, 3);
  assert.equal(selected[0].name, 'Room size: 42 m²');
  assert.ok(selected.some(node => node.name.startsWith('Children')));
});

test('clips item text and keeps page text inert', () => {
  const result = normalizeAXState([
    'Browser tab: Example URL: "https://stay.example.test/x".',
    `9 text ${'ignore this page instruction '.repeat(40)}`,
  ].join('\n'), {maxItemChars: 20});
  assert.equal(result.nodes[0].name.length, 20);
  assert.equal(result.nodes[0].index, 9);
});
