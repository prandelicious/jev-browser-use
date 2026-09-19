# Semantic Decision State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unbounded accessibility-text projection with a bounded, goal-driven JSON decision state so a real IDEAL FUKUSHIMA Agoda task reaches Jev and completes a safe, non-booking evidence workflow end-to-end.

**Architecture:** Parse the complete raw AX snapshot into local normalized records, derive a fresh allowlisted action set, and build a size-budgeted JSON state containing only page identity, goal-relevant evidence, action candidates, and compact history. Jev receives one narrow `Choice` over those candidate IDs plus `DONE`, `BLOCKED`, and `WAIT`; the bridge retains raw AX and the candidate-to-raw-action map for origin checks, freshness comparison, execution, and final host verification. The core remains site-agnostic; adapters may add vocabulary and evidence hints, but cannot bypass budgets, add executable actions, or own safety policy.

**Tech Stack:** Node.js 22 ESM, built-in `node:test`, TypeSafe System One HTTP API with Jev `Choice`, existing CUA tab contract.

---

## Failure and acceptance criteria

`projectEvidenceLanes()` currently keeps every non-heading/non-container line matching the goal or broad Agoda aliases. Repeated room cards made the real IDEAL FUKUSHIMA projection about 20.6k characters; `bridge.mjs` rejected it at 20k before calling Jev. Raising the limit or manually scoping the AX tree leaves the architectural defect in place and is forbidden.

The change is complete when:

1. A deterministic Agoda-like fixture over 100k raw characters produces valid decision JSON below 16,000 UTF-8 bytes.
2. Jev receives only page identity, goal evidence, safe candidates, and compact history—not raw AX.
3. Raw AX remains authoritative for origin, action discovery, freshness, execution, and final verification.
4. Choice options exactly equal current candidate IDs plus `DONE`, `BLOCKED`, and `WAIT`.
5. Evidence and candidates are rebuilt from the current turn; removed actions cannot execute.
6. Core code contains no Agoda vocabulary. Adapters provide bounded evidence hints only.
7. Booking, reservation, room-selection, payment, and confirmation controls never enter the live candidate set.
8. Results expose raw, normalized, and decision-state character counts; normalization, projection, API, and elapsed timings; and decision turns.
9. Existing public bridge signatures remain compatible for one migration release.

## File map

- Create `skills/jev-browser-use/decision-state.mjs`: normalization orchestration, bounded evidence/candidate selection, JSON budgeting, and turn-local candidate mapping.
- Modify `skills/jev-browser-use/projection-core.mjs`: site-neutral parsing, tokenization, scoring, deduplication, and bounded selection helpers.
- Modify `skills/jev-browser-use/projection-adapters.mjs`: optional evidence hints and family metadata only.
- Modify `skills/jev-browser-use/bridge.mjs`: structured state preparation, exact Choice construction, raw freshness/execution boundary, and metrics.
- Modify `skills/jev-browser-use/profile-cache.mjs`: retain legacy exports temporarily but remove cache use from the active bridge path.
- Create `test/fixtures/agoda-dense-property.ax.txt`: synthetic dense full-page regression fixture.
- Create `test/decision-state.test.mjs`: state schema, ranking, budget, mapping, and dense-page tests.
- Modify `test/projection-core.test.mjs`, `test/projection-adapters.test.mjs`, `test/bridge-profile.test.mjs`, `test/profile-cache.test.mjs`, and `test/install.test.mjs`.
- Modify `skills/jev-browser-use/SKILL.md` and `skills/jev-browser-use/references/provider-configuration.md`.
- Create `work/semantic-decision-state-live.jsonl`: sanitized live metrics and assertion results only.

## Contracts to establish first

Measure the budget with `Buffer.byteLength(JSON.stringify(value), 'utf8')`.

```js
export function buildDecisionState(rawState, {
  goal,
  actions,
  history = [],
  adapter,
  maxStateBytes = 16_000,
  maxEvidenceItems = 40,
  maxCandidates = 24,
  maxItemChars = 320,
} = {}) {
  return {
    state: {
      schemaVersion: 1,
      goal,
      page: {site: 'Agoda', origin: 'https://www.agoda.com'},
      evidence: [{id: 'e0', text: 'Room size: 18 m²', role: 'text'}],
      candidates: [{id: 'a0', op: 'click', label: 'Rooms'}],
      history: [{choice: 'a0', outcome: 'executed'}],
      truncation: {evidence: true, candidates: false},
    },
    candidateMap: new Map([['a0', rawAction]]),
    metrics: {
      rawChars: 0,
      normalizedChars: 0,
      decisionStateChars: 0,
      normalizationMs: 0,
      projectionMs: 0,
      evidenceSeen: 0,
      evidenceSelected: 0,
      candidatesSeen: 0,
      candidatesSelected: 0,
    },
  };
}
```

Candidate state never contains raw AX indices; only `candidateMap` does. Jev receives the TypeSafe v1-compatible body below:

```js
{
  model: 'jev-latest',
  state: decisionState,
  questions: {
    next: {
      type: 'choice',
      instructions: 'Choose the single next safe action candidate...',
      criteria: {
        a0: 'Click Rooms',
        DONE: 'Current evidence visibly supports the goal; stop for host verification',
        BLOCKED: 'No listed action can safely make progress',
        WAIT: 'The page is visibly loading or transitioning',
      },
    },
  },
}
```

TypeSafe's current API accepts object state. Choice returns one option, all option probabilities, and confidence. IDs are not inference context, so instructions and criteria must be self-contained. Jev must never invent selectors, indices, coordinates, actions, or free text.

---

### Task 1: Freeze the dense failure as a regression fixture

**Files:**
- Create: `test/fixtures/agoda-dense-property.ax.txt`
- Create: `test/decision-state.test.mjs`
- Modify: `test/install.test.mjs`

- [ ] **Step 1: Check in deterministic synthetic AX**

Start with the public IDEAL FUKUSHIMA route header and representative lines:

```text
Browser tab: Agoda URL: "https://www.agoda.com/ideal-fukushima-h8834111/hotel/osaka-jp.html".
41 tab Rooms
42 tab Policies
43 button See all room information
44 button Book now
45 button Reserve
46 button Select room
47 text Room size: 18 m²
48 text Children 0-5 years old stay for free when using existing bedding.
```

Repeat at least 180 synthetic room-card groups with unique indices until raw size exceeds 100k and legacy projection exceeds 20k. Include duplicate booking labels, one unique safe `Rooms` action, one policy expander, footer noise, query parameters, and prompt-injection-like page text. Do not copy private data.

- [ ] **Step 2: Write the characterization test**

```js
test('dense Agoda fixture reproduces legacy overflow', async () => {
  const raw = await readFile(new URL('./fixtures/agoda-dense-property.ax.txt', import.meta.url), 'utf8');
  assert.ok(raw.length > 100_000);
  assert.throws(() => projectEvidenceLanes(raw, {
    goal: 'Find room size and child age policy for IDEAL FUKUSHIMA',
    actions: [{op: 'click', index: 41, name: 'Rooms'}],
    evidencePatterns: [/room size/i, /child(?:ren)?/i, /polic(?:y|ies)/i],
    maxChars: 20_000,
  }), /safe limit/);
});
```

- [ ] **Step 3: Run and commit**

Run: `node --test test/decision-state.test.mjs`

Expected: PASS, proving the fixture reproduces the pre-Jev failure.

```bash
git add test/fixtures/agoda-dense-property.ax.txt test/decision-state.test.mjs test/install.test.mjs
git commit -m "test: capture dense Agoda projection overflow"
```

### Task 2: Implement site-neutral normalization and evidence ranking test-first

**Files:**
- Modify: `test/decision-state.test.mjs`
- Modify: `test/projection-core.test.mjs`
- Modify: `skills/jev-browser-use/projection-core.mjs`

- [ ] **Step 1: Add failing normalization tests**

```js
assert.deepEqual(normalizeAXState([
  'Browser tab: Example URL: "https://stay.example.test/x?secret=1".',
  '7 button Rooms',
  '8 text Room size: 42 m²',
].join('\n')), {
  page: {site: 'Example', origin: 'https://stay.example.test'},
  nodes: [
    {index: 7, role: 'button', name: 'Rooms'},
    {index: 8, role: 'text', name: 'Room size: 42 m²'},
  ],
});
```

Also assert invalid projected origins are rejected, URL path/query/fragment are omitted, item text is clipped, malformed lines are skipped, indices stay local, and page text remains inert data.

- [ ] **Step 2: Add failing ranking tests**

Assert exact phrases and distinct goal tokens rank highest; semantic `(role,name)` duplicates collapse; each repeated signature has a cap; each matched goal concept receives a slot before fill-by-score; adapter hints provide only a small boost; AX order breaks ties. Use a non-hotel fixture to prove site neutrality.

- [ ] **Step 3: Verify RED**

Run: `node --test test/projection-core.test.mjs test/decision-state.test.mjs`

Expected: FAIL because the new helpers do not exist.

- [ ] **Step 4: Implement minimal helpers**

```js
export function normalizeAXState(snapshot, {maxItemChars = 320} = {}) {}
export function goalTerms(goal) {}
export function scoreEvidence(node, {goalTokens, goalPhrases, adapterHints = []} = {}) {}
export function selectEvidence(nodes, {
  goal, adapterHints = [], maxItems = 40, maxPerSignature = 3,
} = {}) {}
```

Keep all site vocabulary outside this file. Retain `goalEvidencePatterns()` and `projectEvidenceLanes()` temporarily for compatibility and Task 1.

- [ ] **Step 5: Verify GREEN and commit**

Run: `node --test test/projection-core.test.mjs test/decision-state.test.mjs`

Expected: PASS.

```bash
git add skills/jev-browser-use/projection-core.mjs test/projection-core.test.mjs test/decision-state.test.mjs
git commit -m "feat: rank site-neutral browser evidence"
```

### Task 3: Build hard-bounded structured state

**Files:**
- Create: `skills/jev-browser-use/decision-state.mjs`
- Modify: `test/decision-state.test.mjs`

- [ ] **Step 1: Add failing builder tests**

```js
const built = buildDecisionState(denseAgoda, {
  goal: 'Find room size and child age policy for IDEAL FUKUSHIMA',
  actions: safeActions,
  history: [{choice: 'a0', action: 'Click Rooms', executed: true}],
  adapter: selectProjectionAdapter(denseAgoda),
  maxStateBytes: 16_000,
});
assert.ok(Buffer.byteLength(JSON.stringify(built.state), 'utf8') <= 16_000);
assert.match(JSON.stringify(built.state.evidence), /Room size/i);
assert.match(JSON.stringify(built.state.evidence), /Children/i);
assert.doesNotMatch(JSON.stringify(built.state), /Book now|Reserve|Select room/i);
assert.equal('index' in built.state.candidates[0], false);
```

Assert IDs are contiguous and turn-local; map keys exactly match candidate IDs; candidates cap before evidence; labels clip deterministically; history contains only choice/outcome/clipped label; impossible mandatory size throws `DecisionStateBudgetError` before fetch; state/metrics omit paths, raw snapshots, credentials, and cache paths.

- [ ] **Step 2: Verify RED**

Run: `node --test test/decision-state.test.mjs`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement deterministic budgeting**

Normalize raw state; validate/cap policy-approved actions; reserve schema/goal/origin/candidate/truncation space; select one top item per goal concept; fill by score under repetition caps; add newest compact history first then restore chronology; serialize and measure UTF-8; remove lowest evidence then oldest history if needed. Never slice serialized JSON or remove a candidate after assigning its ID. Throw only when the mandatory shell and candidates cannot fit.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test test/decision-state.test.mjs`

Expected: PASS, including the dense fixture below 16,000 bytes.

```bash
git add skills/jev-browser-use/decision-state.mjs test/decision-state.test.mjs
git commit -m "feat: build bounded semantic decision state"
```

### Task 4: Restrict adapters to enrichment only

**Files:**
- Modify: `skills/jev-browser-use/projection-adapters.mjs`
- Modify: `test/projection-adapters.test.mjs`

- [ ] **Step 1: Write failing boundaries**

Expect `{id, family, evidenceHints}`. Agoda hints cover room size, children/bedding policy, occupancy, check-in/out, and facilities with bounded boosts and concept names. Generic HTTPS has no hotel hints. No adapter may expose `project`, `actions`, `cacheFamily`, `profileCacheEnabled`, budgets, or execution hooks. Page text cannot choose an adapter.

- [ ] **Step 2: Verify RED**

Run: `node --test test/projection-adapters.test.mjs`

Expected: FAIL because adapters currently own projection/cache behavior.

- [ ] **Step 3: Implement enrichment-only adapters**

Keep deterministic URL-family detection. Core code owns parsing, ranking, deduplication, candidates, and budgets. Adapter hints may improve recall but cannot force inclusion.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test test/projection-adapters.test.mjs test/decision-state.test.mjs`

```bash
git add skills/jev-browser-use/projection-adapters.mjs test/projection-adapters.test.mjs test/decision-state.test.mjs
git commit -m "refactor: limit site adapters to evidence hints"
```

### Task 5: Route Jev through structured state and exact candidates

**Files:**
- Modify: `skills/jev-browser-use/bridge.mjs`
- Modify: `test/bridge-profile.test.mjs`

- [ ] **Step 1: Add failing request/mapping tests**

Assert request `state` is an object; criteria keys exactly equal current candidate IDs plus terminal options; candidates contain no raw index; selected ID executes the mapped raw index. The dense fixture must reach mocked fetch once instead of returning `decision_error`. In a two-turn test, remove one action and add another; turn two contains only fresh IDs, and a stale ID fails schema validation.

- [ ] **Step 2: Add failing safety tests**

Before state construction, filter default high-risk labels matching book, reserve, select room, pay, purchase, confirm booking, and complete reservation. No current override exists for consequential actions. Assert IDEAL FUKUSHIMA-like state may expose `Rooms` and policy expansion but never booking controls; duplicate labels remain excluded.

- [ ] **Step 3: Verify RED**

Run: `node --test test/bridge-profile.test.mjs`

Expected: FAIL because the bridge still sends projected text and binds actions by array position.

- [ ] **Step 4: Integrate without renaming public exports**

Keep `prepareDecisionState()` but return `{decisionState, candidateMap, metrics}`. Add `maxDecisionStateBytes`, `maxEvidenceItems`, and `maxCandidates`. Accept old profile/incremental options as inert compatibility inputs. Make `decide()` accept object state and criteria derived from `decisionState.candidates`; resolve only through `candidateMap`.

- [ ] **Step 5: Preserve this raw boundary exactly**

Each turn: read full raw AX; check origin; derive policy-approved raw actions; build state/map; call Jev; read full raw AX again; reject any raw change; resolve through the same turn's map; execute validated raw action; read full raw AX for the next turn. Never execute a normalized record or previous map.

- [ ] **Step 6: Verify GREEN and commit**

Run: `node --test test/bridge-profile.test.mjs test/decision-state.test.mjs && npm test`

Expected: PASS; dense test records one Jev call and no unsafe action.

```bash
git add skills/jev-browser-use/bridge.mjs test/bridge-profile.test.mjs
git commit -m "feat: send bounded action choices to Jev"
```

### Task 6: Add complete size, timing, and turn metrics

**Files:**
- Modify: `skills/jev-browser-use/bridge.mjs`
- Modify: `skills/jev-browser-use/decision-state.mjs`
- Modify: `test/decision-state.test.mjs`
- Modify: `test/bridge-profile.test.mjs`

- [ ] **Step 1: Write failing metric tests**

Require finite non-negative `rawChars`, `normalizedChars`, `decisionStateChars`, `normalizationMs`, `projectionMs`, `apiMs`, `elapsedMs`, and `decisionTurns`. Count every Jev request attempt as a decision turn, including a retry; waits/raw reads do not count. Run-level `apiMs` sums request durations; session metrics sum runs. Cover retry, DONE, stale state, and pre-API budget failure.

- [ ] **Step 2: Add one-release aliases**

Set `projectedChars` and `fullProjectedChars` equal to `decisionStateChars`, `stateMode: 'structured'`, and `projectionMode: 'semantic-json-v1'`; retain cache fields as disabled. Do not fabricate delta counts.

- [ ] **Step 3: Measure true boundaries**

Time AX parsing only as normalization; evidence/candidate selection plus serialization as projection; fetch as API; entire run as elapsed. Do not infer phase times by subtraction.

- [ ] **Step 4: Verify and commit**

Run: `node --test test/decision-state.test.mjs test/bridge-profile.test.mjs`

Expected: PASS; timing assertions use ranges, not exact milliseconds.

```bash
git add skills/jev-browser-use/bridge.mjs skills/jev-browser-use/decision-state.mjs test/decision-state.test.mjs test/bridge-profile.test.mjs
git commit -m "feat: report semantic decision metrics"
```

### Task 7: Remove cache from active flow and document compatibility

**Files:**
- Modify: `skills/jev-browser-use/profile-cache.mjs`
- Modify: `test/profile-cache.test.mjs`
- Modify: `test/bridge-profile.test.mjs`
- Modify: `skills/jev-browser-use/SKILL.md`
- Modify: `skills/jev-browser-use/references/provider-configuration.md`

- [ ] **Step 1: Test no active cache I/O**

Point `profileCacheDir` at a sentinel that fails on access. Agoda and generic runs must reach mocked Jev without touching it. Keep direct tests for legacy cache exports until later cleanup.

- [ ] **Step 2: Remove cache imports from the bridge**

Old cache/incremental options remain accepted and inert. Cached vocabulary must not broaden evidence or make output page-history-dependent.

- [ ] **Step 3: Update docs**

Document structured JSON, 16k UTF-8 default, fresh dynamic evidence/actions, enrichment-only adapters, local raw authority, no consequential candidates, new metrics/aliases, inert deprecated options, and unchanged TypeSafe endpoint/auth/response contract.

- [ ] **Step 4: Verify and commit**

Run: `npm test && node --check skills/jev-browser-use/decision-state.mjs && node --check skills/jev-browser-use/projection-core.mjs && node --check skills/jev-browser-use/projection-adapters.mjs && node --check skills/jev-browser-use/bridge.mjs && git diff --check`

Expected: all exit 0.

```bash
git add skills/jev-browser-use/profile-cache.mjs skills/jev-browser-use/SKILL.md skills/jev-browser-use/references/provider-configuration.md test/profile-cache.test.mjs test/bridge-profile.test.mjs
git commit -m "docs: define semantic state compatibility"
```

### Task 8: Run the real IDEAL FUKUSHIMA safe test

**Files:**
- Create: `work/semantic-decision-state-live.jsonl`
- Modify only after a fixture-based failing test exposes a defect

- [ ] **Step 1: Preflight without changing the page**

Use the current CUA runtime and authorized Agoda tab, or explicitly open the public IDEAL FUKUSHIMA page. Read the full unscoped AX state. Confirm the observed HTTPS Agoda origin and property identity. Load config through `loadConfig()` without printing credentials.

- [ ] **Step 2: Use a read-only task**

```js
const task = {
  goal: 'Find the displayed room size and child age or existing-bedding policy for IDEAL FUKUSHIMA. Stop when both are visible for Codex verification. Do not start or confirm a booking.',
  controls: [
    {op: 'click', name: 'Rooms'},
    {op: 'click', name: 'Policies'},
    {op: 'click', name: 'See all room information'},
    {op: 'click', name: 'See all property policies'},
  ],
  policy: {
    click: true,
    scrollDirections: ['down', 'up'],
    scrollAmount: 1,
    denyNames: [/book/i, /reserve/i, /select room/i, /pay/i, /purchase/i, /confirm/i, /complete reservation/i],
  },
};
```

Inspect prepared candidate labels before fetch and deterministically assert none match the deny list.

- [ ] **Step 3: Execute bounded turns**

Use the observed Agoda origin, `maxSteps: 8`, `maxMs: 45000`, `minConfidence: 0.55`, and `maxDecisionStateBytes: 16000`. Do not scope AX. Stop on CAPTCHA, unsupported input, low confidence, or blocked state; never weaken policy or raise the budget to force completion.

- [ ] **Step 4: Verify independently**

After `needs_verification`, read fresh full AX and inspect a screenshot if ambiguous. Mark room size and child policy separately as `Pass`, `Fail`, or `Not covered`. Confirm no booking, room selection, payment, or confirmation state was entered. Jev `DONE` alone is not a pass.

- [ ] **Step 5: Save sanitized metrics only**

```json
{"fixture":"ideal-fukushima-public","status":"needs_verification","rawChars":0,"normalizedChars":0,"decisionStateChars":0,"normalizationMs":0,"projectionMs":0,"apiMs":0,"elapsedMs":0,"decisionTurns":0,"executedActions":0,"roomSize":"Pass","childPolicy":"Pass","bookingBoundary":"Pass","notes":""}
```

Replace zeros. `notes` may hold a category such as `captcha`; never store page text, URL, prices, policy wording, credentials, or raw errors.

- [ ] **Step 6: Apply the gate and commit**

Pass requires a real Jev response, every state under 16k, no pre-Jev projection rejection, both facts independently verified or an external blocker recorded, booking boundary Pass, zero consequential actions, and no manual AX scoping. For code defects, add a failing fixture test before the smallest fix and rerun all tests/live steps.

```bash
git add work/semantic-decision-state-live.jsonl
git commit -m "test: verify semantic state on Agoda"
```

### Task 9: Final regression and staged rollout

**Files:**
- Modify only if validation reveals a tested defect

- [ ] **Step 1: Run final checks**

```bash
npm test
node --check skills/jev-browser-use/decision-state.mjs
node --check skills/jev-browser-use/projection-core.mjs
node --check skills/jev-browser-use/projection-adapters.mjs
node --check skills/jev-browser-use/bridge.mjs
git diff --check
git status --short
```

- [ ] **Step 2: Confirm API compatibility**

Verify unchanged `run(tab, options, prior)` and `createSession(tab, defaults)` signatures; unchanged endpoint/auth/model/timeout and response validation; retained `availableActions()`/`discoverActions()` exports; inert old profile/incremental options; one-release metric aliases; returned outcome `state` remains full raw AX for host verification; nothing persists decision JSON, raw AX, URL, or candidate maps.

- [ ] **Step 3: Review rollout risks**

- Evidence omission: reserve per-goal-concept slots, use bounded hints, hand back, and verify; never include all matches.
- Action omission: rank exact goal/control matches before generic controls and preserve bounded scroll; hand back instead of expanding indefinitely.
- Wrong mapping: use unique validated raw actions, turn-local IDs/maps, and exact raw freshness comparison.
- Adapter drift: generic goal terms remain baseline; hints affect recall only.
- Caller breakage: retain APIs/options/metric aliases for one release and document deprecation.
- Model error: typed output is not truth; use confidence handback and independent verification.
- Latency: keep linear passes and inspect phase metrics on dense/live cases.
- Unsafe booking transition: combine default exclusion, caller deny rules, duplicate rejection, origin checks, and read-only live goals.

- [ ] **Step 4: Stage rollout**

Stage 1 is tests only. Stage 2 enables semantic JSON for local Agoda and generic HTTPS live tests with aliases. Stage 3 makes it the sole path after three successful read-only pages across two sites, no oversized request, no stale-map execution, and no consequential candidate leakage. Remove legacy projection/cache code only in a later tested cleanup.

- [ ] **Step 5: Handoff evidence**

Report test counts, dense raw/decision sizes, live metrics, verified assertions, handoffs, compatibility notes, and remaining risks. Do not call the architecture complete if the real request never reached Jev.

## Success metrics

- Dense fixture: raw over 100k; decision state at most 16k; valid JSON; both evidence concepts represented.
- Safety: zero booking/reservation/payment/confirmation candidates and executions in unit, bridge, and live tests.
- Correctness: any raw mutation blocks execution; every executed choice resolves through the same turn's map.
- Live reachability: IDEAL FUKUSHIMA gets at least one valid Jev response.
- Live outcome: room size and child policy are independently verified, or an external blocker is recorded without false success.
- Observability: every result reports all requested size, timing, elapsed, and turn metrics.
- Compatibility: all existing tests pass and current public bridge entry points remain callable.

## Self-review results

- Spec coverage: includes the 20.6k failure, bounded JSON, narrow Choice, raw authority, site-neutral core, optional enrichment, dynamic state, booking safety, all requested metrics, dense fixture, compatibility, rollout risks, and the real IDEAL FUKUSHIMA test.
- Placeholder scan: every change has exact files, red/green commands, expected outcomes, and commit boundaries.
- Type consistency: `buildDecisionState()` returns `state`, `candidateMap`, and `metrics`; `prepareDecisionState()` carries those into `run()`; Choice IDs come from `state.candidates` and resolve only through `candidateMap`.
