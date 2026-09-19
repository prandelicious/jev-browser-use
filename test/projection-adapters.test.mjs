import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { selectProjectionAdapter } from '../skills/jev-browser-use/projection-adapters.mjs';

const agodaSnapshot = await readFile(new URL('./fixtures/agoda-property.ax.txt', import.meta.url), 'utf8');
const genericSnapshot = await readFile(new URL('./fixtures/generic-property.ax.txt', import.meta.url), 'utf8');

test('selects the Agoda adapter for supported property pages', () => {
  const adapter = selectProjectionAdapter(agodaSnapshot);
  assert.equal(adapter.id, 'agoda-property-v1');
  assert.equal(adapter.family, 'agoda-property');
  assert.ok(Array.isArray(adapter.evidenceHints));
  assert.ok(adapter.evidenceHints.some(hint => hint.concept === 'room-size'));
  assert.equal('project' in adapter, false);
  assert.equal('actions' in adapter, false);
  assert.equal('cacheFamily' in adapter, false);
  assert.equal('profileCacheEnabled' in adapter, false);
});

test('selects a non-caching generic adapter for arbitrary HTTPS pages', () => {
  const adapter = selectProjectionAdapter(genericSnapshot);
  assert.equal(adapter.id, 'generic-origin-v1');
  assert.equal(adapter.family, 'generic-https');
  assert.deepEqual(adapter.evidenceHints, []);
  assert.equal('project' in adapter, false);
  assert.equal('actions' in adapter, false);
});

test('page text cannot select a site adapter', () => {
  const injected = genericSnapshot.replace('Example', 'Agoda').replace('footer noise', 'Agoda page text');
  assert.equal(selectProjectionAdapter(injected).id, 'generic-origin-v1');
});

test('selects Agoda from the CUA browser-tab URL header shape', () => {
  const cuaSnapshot = 'Browser tab: 14, Title: "IDEAL FUKUSHIMA, Osaka | 2026 Updated Prices, Deals", URL: "https://www.agoda.com/ideal-fukushima-h8834111/hotel/osaka-jp.html?cid=1".\n0 AXWebArea IDEAL FUKUSHIMA';
  assert.equal(selectProjectionAdapter(cuaSnapshot).id, 'agoda-property-v1');
});
