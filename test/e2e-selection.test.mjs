import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSuitesFromPaths, scenariosForSuites, changedPathsSince } from '../tests/e2e/selection.mjs';

test('MCP-unrelated adapter path mapping is not used; skill changes select gate', () => {
  const { selectedSuites, reasons } = selectSuitesFromPaths(['skills/jev-browser-use/bridge.mjs']);
  assert.deepEqual(new Set(selectedSuites), new Set(['core', 'gate']));
  assert.ok(reasons.length);
});

test('docs-only changes skip E2E', () => {
  const { selectedSuites } = selectSuitesFromPaths(['README.md', 'docs/superpowers/plans/x.md']);
  assert.deepEqual(selectedSuites, []);
});

test('unknown production changes fall back to gate', () => {
  const { selectedSuites } = selectSuitesFromPaths(['src/mystery.js']);
  assert.deepEqual(selectedSuites, ['gate']);
});

test('gate suite contains the core scenarios', () => {
  const ids = scenariosForSuites(['gate']);
  for (const id of ['basic-click', 'scroll-find', 'multi-action', 'handoff', 'stale-state', 'action-budget', 'cancellation']) {
    assert.ok(ids.includes(id), id);
  }
});

test('empty change set and --changed-since plumbing select gate', async () => {
  assert.deepEqual(selectSuitesFromPaths([]).selectedSuites, ['gate']);
  const paths = await changedPathsSince('HEAD');
  assert.equal(Array.isArray(paths), true);
});
