# Agoda Structural Profile Cache and AX Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-open, user-level cache of non-sensitive Agoda page-family structure so Jev receives compact, goal-relevant AX state across sessions while actions still resolve against fresh raw browser state.

**Architecture:** Add `profile-cache.mjs` for family recognition, strict cache I/O, bounded structural learning, and deterministic projection. `bridge.mjs` retains raw state for origin checks, action discovery, stale-state equality, execution indices, and final verification; only the compact projection goes to `decide()`. Cache failures fall back to an in-memory seed profile, while projection safety failures hand control back instead of sending raw oversized state.

**Tech Stack:** Node.js 22+, ES modules, native `node:test`, `node:fs/promises`, `node:crypto`, and the existing CUA tab interface. No runtime dependency is added.

---

## Scope and non-negotiable invariants

Version 1 supports Agoda property-detail pages only. Unknown sites keep the current raw-state path.

1. Raw AX state never enters the cache. It remains the authority for origin, actions, staleness, execution, and Codex verification.
2. Cache only schema metadata and code-allowlisted structural terms. Never cache URLs, queries, property names, snapshots, prices, availability, policy values, typed text, history, or AX indices.
3. All Agoda property pages share one family ID, `agoda-property-v1`; the filename is `sha256(familyId).json`.
4. Cache errors are misses. Existing callers remain compatible; `run()` gains optional `profileCacheDir` and `profileCacheEnabled` fields only.
5. Projection preserves the browser header, exact action lines, goal/structural matches, and one adjacent line on each side. It never renumbers AX indices.
6. Fresh raw state is still compared byte-for-byte with the raw state used to build the decision projection.

## File map

| Path | Responsibility |
| --- | --- |
| `skills/jev-browser-use/profile-cache.mjs` | Keying, schema, atomic cache I/O, learning, projection |
| `skills/jev-browser-use/bridge.mjs` | Raw/projected separation and run metrics |
| `skills/jev-browser-use/SKILL.md` | User-facing cache contract and opt-out |
| `scripts/install.mjs` | Include the new runtime module |
| `package.json` | Native test command and Node version |
| `test/profile-cache.test.mjs` | Cache and projection unit tests |
| `test/bridge-profile.test.mjs` | Fake-tab integration and safety regressions |
| `test/install.test.mjs` | Installed-runtime completeness |
| `scripts/summarize-agoda-ab.mjs` | Pure JSONL experiment summarizer; no browser driving |
| `test/summarize-agoda-ab.test.mjs` | Summary validation and calculations |
| `test/fixtures/agoda-property.ax.txt` | Synthetic Agoda-shaped AX state |

## Exact design contract

### Family recognition and cache schema

Recognize only `https:` URLs whose host is `agoda.com` or ends with `.agoda.com` and whose pathname matches:

```js
/(?:[a-z]{2}-[a-z]{2}\/)?[^/]+\/hotel\/[^/]+\.html$/i
```

`profileKey(urlOrSnapshot)` accepts a URL or the current `Browser tab:` header. It returns SHA-256 of the fixed family ID, or `null` for an unknown route.

```js
{
  version: 1,
  family: 'agoda-property-v1',
  observedTerms: ['policies', 'rooms'],
  createdAt: '2026-09-19T00:00:00.000Z',
  updatedAt: '2026-09-19T00:00:00.000Z'
}
```

`observedTerms` is a unique, sorted subset of this code-owned vocabulary:

```js
[
  'overview', 'rooms', 'room', 'room size', 'bed', 'beds', 'facilities',
  'reviews', 'location', 'policies', 'property policies', 'children',
  'child', 'infant', 'age', 'guests', 'occupancy', 'check-in',
  'check-out', 'family room'
]
```

Use `~/.cache/jev-browser-use/profiles`, an 8 KiB file limit, a 30-day TTL, directory mode `0o700`, file mode `0o600`, and same-directory temporary-file-plus-`rename()` writes. Read/write/validation failures return safe reason codes and never throw into the browser loop.

### Projection algorithm

Export:

```js
projectState(snapshot, {goal, actions, profile, maxChars = 20000})
```

Apply these rules in order:

1. Split into lines without rewriting them; reserve the `Browser tab:` line.
2. Reserve lines whose numeric AX index equals an action `index` or numeric `target`.
3. Tokenize the goal into lowercase alphanumeric/hyphen terms of at least three characters; remove `the,a,an,to,for,of,and,or,with,check,find,show,open`.
4. Match goal terms, cached terms, and cold seed terms `rooms,room,policies,children,child,age,guests,occupancy,check-in,check-out` case-insensitively.
5. Include one neighboring line before and after every match, keep original order, remove exact duplicate lines, and truncate individual lines to 500 characters.
6. Add `[projection truncated]` before exceeding 20,000 characters. If the header and protected action lines alone exceed the cap, throw `Projection exceeds safe limit`; never omit an allowed action.

Structural learning lowercases an origin-validated raw snapshot once and adds only vocabulary terms visibly present as whole words. It never learns from the goal. Save only when the sorted term set changes.

---

### Task 1: Establish the test harness and fixtures

**Files:** Create `package.json`, `test/fixtures/agoda-property.ax.txt`, `test/profile-cache.test.mjs`.

- [ ] Create `package.json`:

```json
{
  "name": "jev-browser-use",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": { "test": "node --test" }
}
```

- [ ] Create a synthetic fixture containing a valid header, 30 noise lines, and these exact useful lines:

```text
Browser tab: Agoda URL: "https://www.agoda.com/ideal-fukushima-h8834111/hotel/osaka-jp.html".
41 tab Rooms
42 text Deluxe Apartment
43 text Room size: 70 m²/753 ft²
87 tab Policies
88 heading Property policies
89 text Children 0-6 years old stay for free if using existing bedding.
```

- [ ] Write failing tests for: localized URLs sharing a key; search/non-Agoda routes returning `null`; malformed, oversized, expired, or unwritable entries becoming misses; exact schema allowlisting; arbitrary property terms being rejected; sorted/deduplicated terms; and owner-only permissions on non-Windows.

Representative seam:

```js
const key = profileKey(PROPERTY_URL);
assert.match(key, /^[a-f0-9]{64}$/);
assert.equal(profileKey('https://www.agoda.com/search?city=9395'), null);
const loaded = await loadProfile(key, {cacheDir, now: NOW});
assert.equal(loaded.hit, false);
```

- [ ] Run `node --test test/profile-cache.test.mjs`.

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `profile-cache.mjs`.

- [ ] Commit: `git commit -m "test: define Agoda structural profile contract"`.

### Task 2: Implement strict, fail-open profile persistence

**Files:** Create `skills/jev-browser-use/profile-cache.mjs`; modify its unit test.

- [ ] Export exactly:

```js
export const PROFILE_VERSION = 1;
export const PROFILE_FAMILY = 'agoda-property-v1';
export const MAX_PROFILE_BYTES = 8192;
export const PROFILE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export function profileKey(urlOrSnapshot) {}
export function seedProfile(now = new Date()) {}
export function mergeObservedTerms(profile, snapshot, now = new Date()) {}
export function validateProfile(value, now = new Date()) {}
export async function loadProfile(key, options = {}) {}
export async function saveProfile(key, profile, options = {}) {}
```

- [ ] `validateProfile()` returns `null`, never throws. Require exact version/family, ISO timestamps, `createdAt <= updatedAt <= now + 5 minutes`, non-expiry, and the bounded vocabulary subset.
- [ ] `loadProfile()` returns `{profile, hit, reason}` and `saveProfile()` returns `{written, reason?}`. Reject non-hex keys before disk access. On save, validate, create directories, write `<key>.<pid>.<uuid>.tmp` with `wx`, rename atomically, and unlink the temp in `finally`. Reasons expose error codes only, never paths/content.
- [ ] Run `node --test test/profile-cache.test.mjs`; expected PASS.
- [ ] Commit: `git commit -m "feat: add user-level structural profile cache"`.

### Task 3: Implement deterministic compact projection

**Files:** Modify `profile-cache.mjs` and `test/profile-cache.test.mjs`.

- [ ] Write failing tests that prove header/action indices/evidence survive, noise is removed, numeric `target` is protected, duplicates collapse, long lines truncate, the marker fits the cap, protected overflow throws, and input is not mutated.

```js
const projected = projectState(fixture, {
  goal: 'Find room size and child age policy',
  actions: [{index: 41}, {index: 87}],
  profile: seedProfile(NOW),
  maxChars: 2000
});
assert.match(projected, /^41 tab Rooms$/m);
assert.match(projected, /Room size: 70 m²/);
assert.match(projected, /Children 0-6 years old/);
assert.doesNotMatch(projected, /footer noise 29/);
```

- [ ] Run `node --test test/profile-cache.test.mjs --test-name-pattern='project'`; expected RED.
- [ ] Implement the exact algorithm above. Do not invent an `AX 41` syntax; preserve the bridge’s real `41 role name` format.
- [ ] Run `node --test test/profile-cache.test.mjs`; expected PASS.
- [ ] Commit: `git commit -m "feat: add bounded AX projection"`.

### Task 4: Integrate projection without weakening safety

**Files:** Modify `bridge.mjs:1-4`, `42-48`, `160-250`; create `test/bridge-profile.test.mjs`.

- [ ] Create a fake tab returning the fixture and recording `click(index)`. Stub `globalThis.fetch` with a valid Jev choice response and use a temporary dotenv/key. Assert the request body omits noise, retains `41 tab Rooms`, the tab clicks `41`, and the result reports smaller projected state.
- [ ] Run the same task with the same cache directory and assert `cacheHit:true`. Run a non-Agoda snapshot and assert exact raw state reaches `decide()` with `active:false`.
- [ ] Add the critical regression: change only a raw line omitted from both projections between the decision and fresh read. Assert no click and `reason:'stale_state'`. This proves raw-to-raw comparison remains intact.
- [ ] Add a cache-write-failure case and assert the decision still runs, metrics say `cacheWrite:'failed'`, and metrics contain no state text, terms, paths, or URLs.
- [ ] Run `node --test test/bridge-profile.test.mjs`; expected RED.
- [ ] Replace `checkState()` with `checkOrigin(raw, allowedOrigins)` and `checkDecisionState(projected)`. The former retains URL/origin validation only; the latter enforces the current 24,000-character model-input limit.
- [ ] Add private `prepareDecisionState(rawState, options)` returning `{decisionState, profile, metrics}`. Unknown routes return raw state and `{active:false}` without disk I/O. `profileCacheEnabled:false` uses the seed profile and reports disabled read/write.
- [ ] Rename the loop variable to `rawState`. Derive actions from raw; project; pass only `decisionState` to `decide()`; fetch `freshRawState`; compare it byte-for-byte to `rawState`; execute the resolved raw index only afterward. `result().state` remains raw final state.
- [ ] Attach per-run metrics only:

```js
{
  active, family, cacheHit, cacheRead, cacheWrite,
  rawChars, projectedChars, projectionMs
}
```

- [ ] Run `node --test test/bridge-profile.test.mjs && npm test`; expected PASS.
- [ ] Commit: `git commit -m "feat: use structural profiles for Jev decision state"`.

### Task 5: Package and document the runtime module

**Files:** Modify `scripts/install.mjs:8-10`, create `test/install.test.mjs`, modify `SKILL.md`.

- [ ] Write an installer test using a temporary home and assert both `bridge.mjs` and `profile-cache.mjs` exist under `result.target`. Run it; expected FAIL.
- [ ] Change the manifest to:

```js
const runtimeFiles = ['SKILL.md', 'bridge.mjs', 'profile-cache.mjs', 'references'];
```

- [ ] Document: recognized scope, location/TTL, stored/not-stored fields, fail-open I/O, projection handoff behavior, `profileCacheEnabled:false`, raw-state safety authority, and the projection metrics. State that size reduction is not correctness evidence.
- [ ] Run `node --test test/install.test.mjs && npm test`; expected PASS.
- [ ] Commit: `git commit -m "docs: package and explain structural profile cache"`.

### Task 6: Add a deterministic experiment summarizer

**Files:** Create `scripts/summarize-agoda-ab.mjs` and `test/summarize-agoda-ab.test.mjs`.

The script validates and summarizes JSONL captured through CUA. It must not open a browser, import Playwright, call Agoda, or call Jev.

- [ ] Define this safe record schema:

```json
{"property":"ideal-fukushima","variant":"cold","trial":1,"rawChars":42000,"projectedChars":6800,"cacheHit":false,"apiMs":410,"elapsedMs":1120,"executedActions":2,"choice":"DONE","verification":"pass"}
```

- [ ] Test rejection of unknown properties/variants, missing numeric fields, warm cache misses, and invalid verification values. Assert summaries include count, medians, reduction percentage, action counts, choices, and pass/fail/blocked totals.
- [ ] Export `summarize(records)` and support `node scripts/summarize-agoda-ab.mjs work/agoda-ab.jsonl`. Print Markdown only; never output URLs, snapshots, or terms.
- [ ] Run `node --test test/summarize-agoda-ab.test.mjs && npm test`; expected PASS.
- [ ] Commit: `git commit -m "test: add Agoda A B experiment summarizer"`.

### Task 7: Run the live paired A/B experiment in CUA

**Files:** Create locally but do not commit `work/agoda-ab.jsonl` and `work/agoda-ab-report.md`.

This requires declared `mcp__cua_repl.js`, configured Jev access, and an authorized Chrome/in-app tab. If absent, record `blocked`; do not add another browser driver or substitute search-engine text for live AX evidence.

- [ ] Freeze the canonical English URLs. Use:

```text
https://www.agoda.com/ideal-fukushima-h8834111/hotel/osaka-jp.html
```

Use this verified replacement listing for the second property:

```text
https://www.agoda.com/happy-osaka-house/hotel/osaka-jp.html
```

Verify the exact visible title before testing; if unavailable, mark that property blocked and never substitute a similar listing.

- [ ] Use the same read-only goal for every trial:

```text
Open room information and property policies needed to identify one visible room-size/occupancy fact and one visible child-age or child-bedding rule. Stop without entering dates, signing in, changing settings, or starting a booking.
```

- [ ] Permit only unique controls matching `/rooms?|polic(?:y|ies)|children|show more|view details/i`, bounded scrolling, `Escape`, and `PageDown`. Deny/reserve `/book|reserve|select|pay|sign in|log in|accept|agree/i`.
- [ ] For each property run three cold/warm pairs. Cold uses a new empty temporary cache directory; warm reuses it. Reload the same canonical page and starting scroll position. Create a fresh Jev session per trial so history does not bias results. Alternate pair order after explicitly pre-warming any warm-first directory.
- [ ] Capture only the Task 6 metrics. Record browser capture time separately; `apiMs` is model time and `elapsedMs` is bridge-loop time. Do not record URLs, facts, page text, screenshots, cache paths, or action descriptions in JSONL.
- [ ] Independently verify each trial from fresh raw state and screenshot when layout matters. `needs_verification` is not a pass. Use `pass`, `fail`, or `blocked`; never book, pay, accept terms, or enter personal data.
- [ ] Generate the report:

```bash
node scripts/summarize-agoda-ab.mjs work/agoda-ab.jsonl > work/agoda-ab-report.md
```

- [ ] Ship only if: zero safety regressions; every warm trial is a cache hit; cold/warm verification agrees for every non-blocked pair; median projection is at least 60% smaller for both properties; no projection exceeds 20,000 characters; and warm median `apiMs` is no more than 10% slower for either property. Report raw rows and medians only; six pairs do not justify statistical-significance claims. A blocked second listing means the two-property experiment did not pass.
- [ ] Confirm `git status --short` does not stage either live artifact.

## Final verification

```bash
npm test
node --check skills/jev-browser-use/profile-cache.mjs
node --check skills/jev-browser-use/bridge.mjs
node --check scripts/install.mjs
node --check scripts/summarize-agoda-ab.mjs
git diff --check
git status --short
```

Expected: all tests/syntax checks pass; `git diff --check` is empty; only intended files changed; no credentials, cache files, snapshots, or live records are staged.

## Defects corrected from the previous plan

1. Saving a default on miss learned nothing; this plan defines allowlist-only structural learning.
2. Page-family identity was undefined; this plan uses one fixed Agoda property family and excludes URL/property data.
3. Raw versus projected validation was ambiguous; this plan keeps origin/staleness/actions on raw state and size limits on model input.
4. Action preservation was underspecified; this plan protects exact lines by numeric `index`/`target` and refuses unsafe truncation.
5. The sample expected invented `AX 421` syntax and omitted imports; tests now use the bridge’s actual line format and explicit seams.
6. The installer omitted the new module; this plan adds a packaging regression test.
7. Schema, expiry, permissions, atomicity, and corruption behavior were missing; all are specified.
8. A standalone browser harness would violate the skill’s CUA-only boundary; the repository script is now a pure summarizer.
9. The second listing URL was not verified; exact-title resolution is a prerequisite, with no substitution.
10. Trial count, pairing, gates, and blocked-run semantics were absent; all are explicit.

No implementation code is changed by this planning pass.
