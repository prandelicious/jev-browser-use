import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { selectProjectionAdapter } from '../skills/jev-browser-use/projection-adapters.mjs';

const agodaSnapshot = await readFile(new URL('./fixtures/agoda-property.ax.txt', import.meta.url), 'utf8');
const genericSnapshot = await readFile(new URL('./fixtures/generic-property.ax.txt', import.meta.url), 'utf8');

test('selects the Agoda adapter for supported property pages', () => {
  const adapter = selectProjectionAdapter(agodaSnapshot);
  assert.equal(adapter.id, 'agoda-property-v1');
  assert.equal(adapter.cacheFamily, 'agoda-property-v1');
  assert.equal(typeof adapter.evidencePatterns('Find room size and child age policy'), 'object');
  assert.equal(typeof adapter.project, 'function');
});

test('selects a non-caching generic adapter for arbitrary HTTPS pages', () => {
  const adapter = selectProjectionAdapter(genericSnapshot);
  assert.equal(adapter.id, 'generic-origin-v1');
  assert.equal(adapter.cacheFamily, null);
  assert.equal(typeof adapter.evidencePatterns('Find room size and child age policy'), 'object');
  assert.equal(typeof adapter.project, 'function');
  assert.equal(adapter.profileCacheEnabled, false);
});
