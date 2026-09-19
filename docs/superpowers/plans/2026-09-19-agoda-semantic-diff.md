# Agoda Semantic Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session-local semantic accessibility-state diff that reduces Jev input after the first Agoda decision while preserving raw-state safety checks and a deterministic full-projection fallback.

**Architecture:** Keep profile persistence and projection in `profile-cache.mjs`, where the existing structural-term selection already lives. Add a pure `projectIncrementalState()` function that compares the current and previous snapshots, keeps current goal/profile/action context, annotates relevant additions and removals, and returns full projection when the delta is not materially smaller. `bridge.mjs` owns the per-run baseline and passes only the selected state to Jev; raw state remains authoritative for origin, staleness, action discovery, and execution.

**Tech Stack:** Node.js 22 ESM, built-in `node:test`, existing Jev bridge and Agoda profile cache.

---

### Task 1: Add failing semantic-diff unit tests

**Files:**
- Modify: `test/profile-cache.test.mjs`
- Test: `test/profile-cache.test.mjs`

- [ ] **Step 1: Import the new projection helper in the test file**

Add `projectIncrementalState` to the named import from `profile-cache.mjs` before the helper exists.

- [ ] **Step 2: Add a first-observation test**

Add a test that calls `projectIncrementalState(fixture, null, {goal, actions, profile})` and asserts:

```js
assert.equal(result.mode, 'full');
assert.equal(result.state, projectState(fixture, options));
assert.equal(result.deltaAddedChars, 0);
assert.equal(result.deltaRemovedChars, 0);
```

- [ ] **Step 3: Add a small relevant-update test**

Create `changed = fixture.replace('Children 0-6 years old', 'Children 0-5 years old')`, call the helper with `fixture` as the previous snapshot, and assert:

```js
assert.equal(result.mode, 'delta');
assert.ok(result.state.length < result.fullProjectedChars * 0.65);
assert.match(result.state, /Children 0-5 years old/);
assert.match(result.state, /removed|changed|added/i);
assert.match(result.state, /41 tab Rooms/);
```

- [ ] **Step 4: Add unchanged-context and removal tests**

Use a fixture variant that removes the child-policy line and assert that the delta still contains the current goal/action context and an explicit removal marker. Assert that neither input string changed.

- [ ] **Step 5: Add fallback and validation tests**

Assert that a large unrelated change returns `mode: 'full'`, that `incrementalStateEnabled: false` returns `mode: 'full'`, that a ratio outside `0.1..1` throws `Invalid incremental state ratio`, and that non-string snapshots throw `Invalid incremental state input`.

- [ ] **Step 6: Run the focused tests and verify the expected RED state**

Run:

```bash
node --test test/profile-cache.test.mjs
```

Expected: failure because `projectIncrementalState` is not exported yet.

### Task 2: Implement the pure semantic-diff projection

**Files:**
- Modify: `skills/jev-browser-use/profile-cache.mjs`
- Test: `test/profile-cache.test.mjs`

- [ ] **Step 1: Extract reusable projection-line selection**

Refactor the existing `projectState()` selection into a private helper that returns ordered, deduplicated line records while preserving the existing header, protected-action, nearby-line, 500-character line, and 20,000-character safety behavior. Keep `projectState()` output unchanged.

- [ ] **Step 2: Add semantic line identity helpers**

Normalize a line for comparison by removing its numeric AX index and surrounding whitespace. Compare projected lines by normalized identity, while retaining the current raw line for output. Treat the current browser header, current goal/profile matches, and current action-index lines as mandatory current context.

- [ ] **Step 3: Implement `projectIncrementalState()`**

Use this contract:

```js
projectIncrementalState(currentSnapshot, previousSnapshot, {
  goal,
  actions,
  profile,
  maxChars = 20000,
  enabled = true,
  maxRatio = 0.65,
})
```

Return:

```js
{
  state,
  mode: 'full' | 'delta',
  fullProjectedChars,
  deltaAddedChars,
  deltaRemovedChars,
}
```

For a delta, include the current header, current goal/profile/action context, relevant current lines absent or changed from the previous projection, and relevant previous lines absent from the current projection prefixed as removed. Use clear labels such as `[semantic delta]`, `[added or changed]`, and `[removed]`. Return full mode when there is no previous snapshot, incremental mode is disabled, the delta is not smaller than `fullProjectedChars * maxRatio`, or serialization would exceed `maxChars`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
node --test test/profile-cache.test.mjs
```

Expected: all profile/cache/projection tests pass.

- [ ] **Step 5: Commit the pure projection change**

```bash
git add skills/jev-browser-use/profile-cache.mjs test/profile-cache.test.mjs
git commit -m "feat: add Agoda semantic state diff"
```

### Task 3: Add failing bridge integration tests

**Files:**
- Modify: `test/bridge-profile.test.mjs`

- [ ] **Step 1: Add a small-state-change integration test**

Use a tab sequence containing `fixture`, then a changed fixture, then the same changed fixture. Capture request bodies and assert the second Jev request has `stateMode: 'delta'` in returned metrics and a shorter `state.browser` than the first request.

- [ ] **Step 2: Add the raw-safety regression for delta mode**

Change only `footer noise 29` between the decision and fresh verification, enable incremental state explicitly, return `a0`, and assert no click occurs and the history reason is `stale_state`.

- [ ] **Step 3: Add disablement and contract tests**

Assert `incrementalStateEnabled: false` keeps all model requests in full mode. Assert `incrementalStateMaxRatio: 0.05` rejects the task contract before browser actions.

- [ ] **Step 4: Run bridge tests and verify RED**

Run:

```bash
node --test test/bridge-profile.test.mjs
```

Expected: new tests fail because the bridge does not yet accept or expose incremental-state options.

### Task 4: Integrate the diff into the bridge

**Files:**
- Modify: `skills/jev-browser-use/bridge.mjs`
- Test: `test/bridge-profile.test.mjs`

- [ ] **Step 1: Extend `prepareDecisionState()`**

Accept `previousRawState`, `incrementalStateEnabled`, and `incrementalStateMaxRatio`. Keep profile loading, merging, and saving unchanged. Call `projectIncrementalState()` after the current full projection would otherwise be built. Preserve existing cache metrics and add numeric mode/size fields only.

- [ ] **Step 2: Extend the task contract**

In `run()`, accept defaults `incrementalStateEnabled: true` and `incrementalStateMaxRatio: 0.65`. Reject non-boolean enablement, non-finite ratios, and ratios outside `0.1..1` with the existing `Invalid task contract` error.

- [ ] **Step 3: Track a per-run raw baseline**

Initialize `previousRawState = null` at the start of `run()`. Pass it into `prepareDecisionState()` for each decision. After preparing a decision, set `previousRawState = rawState`. Reset it on every new `run()` call; do not put it in `prior` history, the profile cache, metrics text, or disk.

- [ ] **Step 4: Preserve raw-state safety**

Leave the fresh raw read and exact `freshRawState !== rawState` comparison before execution intact. Do not use the delta to discover, resolve, or execute action indices.

- [ ] **Step 5: Run focused bridge tests and then the full suite**

Run:

```bash
node --test test/bridge-profile.test.mjs
npm test
```

Expected: all tests pass, including the omitted-line stale-state regression.

- [ ] **Step 6: Commit the bridge integration**

```bash
git add skills/jev-browser-use/bridge.mjs test/bridge-profile.test.mjs
git commit -m "feat: use semantic Agoda diffs in Jev decisions"
```

### Task 5: Document operation and verify packaging

**Files:**
- Modify: `skills/jev-browser-use/SKILL.md`
- Modify: `work/agoda-ab-report.md` only if a new sanitized experiment is run
- Test: `test/install.test.mjs` if runtime file lists require updates

- [ ] **Step 1: Document incremental mode**

Explain that the first decision uses the compact projection, later decisions may use an in-memory semantic delta, full projection is the automatic fallback, and raw snapshots remain authoritative for safety. Document `incrementalStateEnabled: false` and the ratio option.

- [ ] **Step 2: Update metrics documentation**

Document `stateMode`, `fullProjectedChars`, `deltaAddedChars`, and `deltaRemovedChars` as count-only metrics. State that model-input reduction does not prove task correctness.

- [ ] **Step 3: Run packaging and static checks**

Run:

```bash
npm test
node --check skills/jev-browser-use/profile-cache.mjs
node --check skills/jev-browser-use/bridge.mjs
git diff --check
```

- [ ] **Step 4: Inspect the final diff and working tree**

Confirm no credentials, raw snapshots, cache files, or unrequested files are staged. Preserve the earlier uncommitted A/B report changes unless they overlap this feature.

- [ ] **Step 5: Commit documentation**

```bash
git add skills/jev-browser-use/SKILL.md
git commit -m "docs: explain Agoda semantic diff mode"
```

