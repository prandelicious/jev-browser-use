import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROFILE_FAMILY,
  PROFILE_VERSION,
  MAX_PROFILE_BYTES,
  profileKey,
  seedProfile,
  mergeObservedTerms,
  validateProfile,
  loadProfile,
  saveProfile,
  projectState,
  projectOriginMinimizedState,
  projectIncrementalState,
} from '../skills/jev-browser-use/profile-cache.mjs';

const PROPERTY_URL = 'https://www.agoda.com/ideal-fukushima-h8834111/hotel/osaka-jp.html';
const LOCALIZED_URL = 'https://www.agoda.com/en-gb/ideal-fukushima-h8834111/hotel/osaka-jp.html';
const NOW = new Date('2026-09-19T00:00:00.000Z');
const fixture = await readFile(new URL('./fixtures/agoda-property.ax.txt', import.meta.url), 'utf8');

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'jev-profile-'));
}

test('Agoda property routes share one fixed profile key', () => {
  const key = profileKey(PROPERTY_URL);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(profileKey(LOCALIZED_URL), key);
  assert.equal(profileKey('https://www.agoda.com/search?city=9395'), null);
  assert.equal(profileKey('https://example.com/foo/hotel/bar.html'), null);
  assert.equal(profileKey('http://www.agoda.com/foo/hotel/bar.html'), null);
});

test('profile schema is strict, bounded, sorted, and allowlisted', () => {
  const seed = seedProfile(NOW);
  assert.deepEqual(seed, {
    version: PROFILE_VERSION,
    family: PROFILE_FAMILY,
    observedTerms: [],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
  const learned = mergeObservedTerms(seed, fixture, NOW);
  assert.deepEqual(learned.observedTerms, ['children', 'policies', 'property policies', 'room', 'room size', 'rooms']);
  assert.equal(validateProfile(learned, NOW), learned);
  assert.equal(validateProfile({...learned, arbitrary: 'no'}, NOW), null);
  assert.equal(validateProfile({...learned, observedTerms: ['property name']}, NOW), null);
  assert.equal(validateProfile({...learned, observedTerms: ['rooms', 'rooms']}, NOW), null);
  assert.equal(validateProfile({...learned, updatedAt: 'not-a-date'}, NOW), null);
  assert.equal(validateProfile({...learned, updatedAt: '2026-10-20T00:00:00.000Z'}, NOW), null);
});

test('cache malformed, oversized, expired, or unwritable entries are misses', async () => {
  const cacheDir = await tempDir();
  const key = profileKey(PROPERTY_URL);
  const path = join(cacheDir, `${key}.json`);
  await writeFile(path, '{bad json');
  assert.deepEqual((await loadProfile(key, {cacheDir, now: NOW})).hit, false);
  await writeFile(path, 'x'.repeat(MAX_PROFILE_BYTES + 1));
  assert.equal((await loadProfile(key, {cacheDir, now: NOW})).hit, false);
  const expired = {...seedProfile(new Date('2026-08-01T00:00:00.000Z')), updatedAt: '2026-08-01T00:00:00.000Z'};
  await writeFile(path, JSON.stringify(expired));
  assert.equal((await loadProfile(key, {cacheDir, now: NOW})).hit, false);
  assert.equal((await loadProfile('not-a-key', {cacheDir, now: NOW})).hit, false);
  const blockedDir = join(cacheDir, 'blocked');
  await writeFile(blockedDir, 'not a directory');
  const result = await saveProfile(key, seedProfile(NOW), {cacheDir: blockedDir});
  assert.equal(result.written, false);
});

test('valid cache entries round-trip with owner-only permissions on non-Windows', async () => {
  const cacheDir = await tempDir();
  const key = profileKey(PROPERTY_URL);
  const profile = mergeObservedTerms(seedProfile(NOW), fixture, NOW);
  const result = await saveProfile(key, profile, {cacheDir});
  assert.equal(result.written, true);
  const loaded = await loadProfile(key, {cacheDir, now: NOW});
  assert.equal(loaded.hit, true);
  assert.deepEqual(loaded.profile, profile);
  if (process.platform !== 'win32') {
    const dirMode = (await (await import('node:fs/promises')).stat(cacheDir)).mode & 0o777;
    const fileMode = (await (await import('node:fs/promises')).stat(join(cacheDir, `${key}.json`))).mode & 0o777;
    assert.equal(dirMode, 0o700);
    assert.equal(fileMode, 0o600);
  }
});

test('projection keeps header, protected actions, useful evidence, and removes noise', () => {
  const projected = projectState(fixture, {
    goal: 'Find room size and child age policy',
    actions: [{index: 41}, {index: 87}],
    profile: seedProfile(NOW),
    maxChars: 2000,
  });
  assert.match(projected, /^Browser tab: Agoda URL:/m);
  assert.match(projected, /^41 tab Rooms$/m);
  assert.match(projected, /Room size: 70 m²/);
  assert.match(projected, /Children 0-6 years old/);
  assert.doesNotMatch(projected, /footer noise 29/);
});

test('projection protects numeric targets, collapses duplicates, truncates long lines, and does not mutate input', () => {
  const input = `${fixture}\n100 text ${'x'.repeat(700)}\n101 text duplicated\n101 text duplicated`;
  const original = input;
  const projected = projectState(input, {
    goal: 'unrelated',
    actions: [{target: 101}],
    profile: seedProfile(NOW),
    maxChars: 2000,
  });
  assert.equal(input, original);
  assert.match(projected, /^101 text duplicated$/m);
  assert.equal(projected.match(/^101 text duplicated$/gm).length, 1);
  assert.doesNotMatch(projected, /x{501}/);
});

test('projection adds a truncation marker within the limit and rejects protected overflow', () => {
  const projected = projectState(fixture, {
    goal: 'room policy children',
    actions: [],
    profile: seedProfile(NOW),
    maxChars: 120,
  });
  assert.ok(projected.length <= 120);
  assert.match(projected, /\[projection truncated\]/);
  assert.throws(() => projectState(fixture, {
    goal: 'nothing',
    actions: [{index: 41}, {index: 87}],
    profile: seedProfile(NOW),
    maxChars: 20,
  }), /Projection exceeds safe limit/);
});

test('origin-minimized projection keeps exact actions and direct evidence with a compact origin header', () => {
  const projected = projectOriginMinimizedState(fixture, {
    goal: 'Find room size and child age policy',
    actions: [{index: 41}, {index: 87}],
    profile: mergeObservedTerms(seedProfile(NOW), fixture, NOW),
  });
  assert.equal(projected, [
    'Browser tab: Agoda (origin https://www.agoda.com).',
    '41 tab Rooms',
    '43 text Room size: 70 m²/753 ft²',
    '87 tab Policies',
    '89 text Children 0-6 years old stay for free if using existing bedding.',
  ].join('\n'));
  assert.doesNotMatch(projected, /footer noise|h8834111|checkIn|Title:/i);
});

test('origin-minimized projection does not expand cached structural vocabulary', () => {
  const projected = projectOriginMinimizedState(fixture, {
    goal: 'Open the property policies and inspect children policy',
    actions: [{index: 87}],
    profile: mergeObservedTerms(seedProfile(NOW), fixture, NOW),
  });
  assert.match(projected, /Browser tab: Agoda \(origin https:\/\/www\.agoda\.com\)\./);
  assert.match(projected, /^87 tab Policies$/m);
  assert.match(projected, /Children 0-6 years old/);
  assert.doesNotMatch(projected, /footer noise|Deluxe Apartment|Room size/);
});

test('incremental projection uses the full state for the first observation', () => {
  const options = {
    goal: 'Find room size and child age policy',
    actions: [{index: 41}, {index: 87}],
    profile: seedProfile(NOW),
  };
  const result = projectIncrementalState(fixture, null, options);
  assert.equal(result.mode, 'full');
  assert.equal(result.state, projectState(fixture, options));
  assert.equal(result.deltaAddedChars, 0);
  assert.equal(result.deltaRemovedChars, 0);
});

test('incremental projection sends a small relevant update as a delta', () => {
  const expanded = `${fixture}\n${Array.from({length:40}, (_, index) => `${1000 + index} text footer noise ${index}\n${2000 + index} text Room size: ${index + 1} m²\n${3000 + index} text footer noise ${index + 40}`).join('\n')}`;
  const options = {
    goal: 'Find room size and child age policy',
    actions: [{index: 41}, {index: 87}],
    profile: seedProfile(NOW),
    maxRatio: 0.65,
  };
  const changed = expanded.replace('Children 0-6 years old', 'Children 0-5 years old');
  const result = projectIncrementalState(changed, expanded, options);
  assert.equal(result.mode, 'delta');
  assert.ok(result.state.length < result.fullProjectedChars * options.maxRatio);
  assert.match(result.state, /Children 0-5 years old/);
  assert.match(result.state, /semantic delta|added or changed/i);
  assert.match(result.state, /41 tab Rooms/);
});

test('incremental projection retains current context and reports removed relevant lines', () => {
  const expanded = `${fixture}\n${Array.from({length:40}, (_, index) => `${1000 + index} text footer noise ${index}\n${2000 + index} text Room size: ${index + 1} m²\n${3000 + index} text footer noise ${index + 40}`).join('\n')}`;
  const options = {
    goal: 'Find room size and child age policy',
    actions: [{index: 41}, {index: 87}],
    profile: seedProfile(NOW),
  };
  const changed = expanded.replace('Children 0-6 years old stay for free if using existing bedding.\n', '');
  const result = projectIncrementalState(changed, expanded, options);
  assert.equal(result.mode, 'delta');
  assert.match(result.state, /Room size: 70 m²/);
  assert.match(result.state, /41 tab Rooms/);
  assert.match(result.state, /\[removed\]/i);
  assert.ok(result.deltaRemovedChars > 0);
  assert.equal(expanded.includes('Children 0-6 years old stay for free if using existing bedding.'), true);
  assert.equal(changed.includes('Children 0-6 years old stay for free if using existing bedding.'), false);
});

test('incremental projection falls back to full state when the delta is too large or disabled', () => {
  const expanded = `${fixture}\n${Array.from({length:40}, (_, index) => `${1000 + index} text footer noise ${index}\n${2000 + index} text Room size: ${index + 1} m²\n${3000 + index} text footer noise ${index + 40}`).join('\n')}`;
  const options = {
    goal: 'Find room size and child age policy',
    actions: [{index: 41}, {index: 87}],
    profile: seedProfile(NOW),
  };
  const noisy = expanded.replaceAll('Room size:', `Room size: ${'x'.repeat(400)}`);
  const large = projectIncrementalState(noisy, expanded, {...options, maxRatio: 0.65});
  assert.equal(large.mode, 'full');
  const disabled = projectIncrementalState(noisy, expanded, {...options, enabled: false});
  assert.equal(disabled.mode, 'full');
  assert.equal(disabled.state, projectState(noisy, options));
});

test('incremental projection validates input and ratio', () => {
  assert.throws(() => projectIncrementalState(null, fixture, {}), /Invalid incremental state input/);
  assert.throws(() => projectIncrementalState(fixture, fixture, {maxRatio: 0.05}), /Invalid incremental state ratio/);
  assert.throws(() => projectIncrementalState(fixture, fixture, {maxRatio: 1.1}), /Invalid incremental state ratio/);
});
