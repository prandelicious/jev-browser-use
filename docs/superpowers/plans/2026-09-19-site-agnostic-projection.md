# Site-Agnostic Browser Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize compact accessibility-state projection beyond Agoda without weakening raw-state safety, action-index validation, or the existing Agoda reduction.

**Architecture:** Extract site-neutral evidence-lane mechanics into a reusable projection core. Add a small adapter registry that selects an optional site/page-family adapter from the current raw origin and route shape; Agoda remains an adapter, while an origin-only generic adapter handles unsupported sites without persistent structural caching. The bridge sends the selected compact state to Jev, but keeps the complete fresh raw AX state authoritative for origin checks, action discovery, stale-state equality, execution, and final verification.

**Tech Stack:** Node.js 22 ESM, built-in `node:test`, existing Jev bridge, current Agoda profile cache.

---

### Task 1: Define the adapter and projection-core contracts with failing tests

**Files:**
- Create: `test/projection-core.test.mjs`
- Create: `test/projection-adapters.test.mjs`
- Test: `test/projection-core.test.mjs`
- Test: `test/projection-adapters.test.mjs`

- [ ] **Step 1: Add a generic non-Agoda fixture in the test file**

Use a small HTTPS example snapshot with a query-bearing URL, two numbered permitted controls, and direct goal evidence such as `Room size: 42 m²` and `Children 0-5 years old`. Keep the fixture free of Agoda-specific names.

- [ ] **Step 2: Write failing core-contract tests**

Import the not-yet-created `projectEvidenceLanes()` and assert it returns a compact origin-only header, preserves all current action lines, retains exact goal evidence, omits unrelated footer noise and query parameters, and rejects protected overflow. Assert that the same function works with arbitrary evidence phrases supplied by the goal rather than an Agoda vocabulary.

- [ ] **Step 3: Write failing adapter-selection tests**

Import the not-yet-created adapter registry and assert:

```js
assert.equal(selectProjectionAdapter(agodaSnapshot).id, 'agoda-property-v1');
assert.equal(selectProjectionAdapter(genericSnapshot).id, 'generic-origin-v1');
```

Assert that adapters expose `id`, `cacheFamily`, `evidencePatterns(goal)`, and `project(snapshot, options)` and that the generic adapter never enables persistent profile caching.

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```bash
node --test test/projection-core.test.mjs test/projection-adapters.test.mjs
```

Expected: failure because the core and adapter modules do not exist.

### Task 2: Implement site-neutral evidence lanes and adapters

**Files:**
- Create: `skills/jev-browser-use/projection-core.mjs`
- Create: `skills/jev-browser-use/projection-adapters.mjs`
- Test: `test/projection-core.test.mjs`
- Test: `test/projection-adapters.test.mjs`

- [ ] **Step 1: Implement the generic projection core**

Export `projectEvidenceLanes(snapshot, {goal, actions, evidencePatterns, siteLabel, maxChars = 20000})`.

The output must contain, in order:

1. A compact header such as `Browser tab: Example (origin https://example.com).` with no query, path, property name, title, or credentials.
2. Every exact raw line whose numeric AX index is required by a current permitted action.
3. Every current `text`, `link`, or other non-structural AX line matching an evidence pattern derived from the goal or adapter.

Exclude headings and containers from direct evidence unless they are action lines. Deduplicate exact semantic lines, preserve input order, and throw a bounded projection error if mandatory output exceeds `maxChars`. Keep the function independent of Agoda names and persistent caches.

- [ ] **Step 2: Implement generic goal evidence patterns**

Derive patterns from meaningful goal phrases and tokens without hardcoded site vocabulary. Prefer exact multiword phrases first, then bounded word matches for values, dates, quantities, and terms of at least four characters. Exclude task verbs and stop words such as `find`, `open`, `show`, and `the`. Do not use every cached structural term as evidence by default.

- [ ] **Step 3: Implement the adapter registry**

Expose:

```js
selectProjectionAdapter(snapshot)
```

The Agoda adapter matches the existing HTTPS Agoda property-detail family, uses the current Agoda evidence aliases where they add recall, and reports `cacheFamily: 'agoda-property-v1'`. The generic adapter matches any valid HTTPS origin, reports `cacheFamily: null`, uses only generic goal evidence, and never writes a profile cache.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
node --test test/projection-core.test.mjs test/projection-adapters.test.mjs
```

Expected: all new core and adapter tests pass.

- [ ] **Step 5: Commit the core and adapter modules**

```bash
git add skills/jev-browser-use/projection-core.mjs skills/jev-browser-use/projection-adapters.mjs test/projection-core.test.mjs test/projection-adapters.test.mjs
git commit -m "feat: add site-agnostic projection adapters"
```

### Task 3: Integrate adapter selection into the bridge

**Files:**
- Modify: `skills/jev-browser-use/bridge.mjs`
- Modify: `skills/jev-browser-use/profile-cache.mjs`
- Modify: `test/bridge-profile.test.mjs`
- Test: `test/bridge-profile.test.mjs`

- [ ] **Step 1: Add adapter metadata to decision preparation**

Select an adapter from the raw snapshot before projection. Use the selected adapter’s projection for recognized Agoda and generic HTTPS pages. Keep the existing Agoda profile load/merge/save path only when `cacheFamily` is `agoda-property-v1`; generic pages must skip profile I/O.

- [ ] **Step 2: Preserve full raw-state safety**

Do not change `checkOrigin()`, raw action discovery, the fresh raw read, exact stale-state comparison, execution indices, confidence thresholds, or final verification. The adapter output is model input only.

- [ ] **Step 3: Extend safe metrics**

Add count-only fields:

```js
projectionAdapter: 'agoda-property-v1' | 'generic-origin-v1' | 'raw',
projectionMode: 'evidence-lanes' | 'raw',
```

Keep existing `rawChars`, `projectedChars`, `fullProjectedChars`, delta counts, and cache metrics. Never include page text, URLs, cache paths, or history in metrics.

- [ ] **Step 4: Add bridge regression tests**

Add tests that:

1. recognize the current Agoda fixture and preserve its exact action index;
2. project an HTTPS non-Agoda fixture through the generic adapter without cache I/O;
3. leave an unsupported/non-HTTPS route on the existing raw-state path;
4. prove an omitted raw line still causes `stale_state` before execution;
5. prove `profileCacheEnabled: false` does not disable generic evidence lanes.

- [ ] **Step 5: Run the bridge and full suites**

Run:

```bash
node --test test/bridge-profile.test.mjs
npm test
```

Expected: all tests pass and existing Agoda behavior remains covered.

- [ ] **Step 6: Commit bridge integration**

```bash
git add skills/jev-browser-use/bridge.mjs skills/jev-browser-use/profile-cache.mjs test/bridge-profile.test.mjs
git commit -m "feat: route decisions through site-agnostic projection"
```

### Task 4: Update documentation, packaging, and live verification harness

**Files:**
- Modify: `skills/jev-browser-use/SKILL.md`
- Modify: `test/install.test.mjs` only if the installer needs to package new runtime files
- Create or modify: `work/site-agnostic-projection-live.jsonl` with sanitized counts only

- [ ] **Step 1: Document the adapter model**

Explain that evidence lanes are site-neutral, adapters provide optional vocabulary and page-family hints, Agoda retains its structural profile cache, and generic HTTPS pages use no persistent page cache. Document raw-state safety and the new metrics.

- [ ] **Step 2: Verify installer packaging**

Ensure `scripts/install.mjs` copies both new runtime modules. Add an installer assertion if needed; do not package scratch files, raw snapshots, credentials, or URLs.

- [ ] **Step 3: Run static and packaging checks**

Run:

```bash
npm test
node --check skills/jev-browser-use/projection-core.mjs
node --check skills/jev-browser-use/projection-adapters.mjs
node --check skills/jev-browser-use/bridge.mjs
git diff --check
```

- [ ] **Step 4: Run the live Agoda micro-experiment**

Using the existing CUA-bound Agoda page and the edited bridge, run one permitted non-consequential control such as the children’s-bedding policy expander. Record only sanitized counts, adapter/mode, action count, result status, and independent verification status. Do not record raw AX text, URLs, property names, credentials, or policy text in the JSONL artifact.

- [ ] **Step 5: Commit documentation and sanitized results**

```bash
git add skills/jev-browser-use/SKILL.md test/install.test.mjs work/site-agnostic-projection-live.jsonl
git commit -m "docs: describe site-agnostic projection"
```

### Task 5: Review, push, and create the pull request

**Files:**
- Review: all commits since `dea8f7e`

- [ ] **Step 1: Run the complete verification command**

```bash
npm test && node --check skills/jev-browser-use/projection-core.mjs && node --check skills/jev-browser-use/projection-adapters.mjs && node --check skills/jev-browser-use/bridge.mjs && git diff --check
```

- [ ] **Step 2: Review the final diff and repository state**

Confirm that only the feature branch contains the new implementation, tests, docs, and sanitized counts. Confirm no raw snapshots, secrets, URLs, property names, or unrelated A/B artifacts are staged.

- [ ] **Step 3: Push the feature branch**

```bash
git push -u origin feat/site-agnostic-projection
```

- [ ] **Step 4: Create the pull request**

```bash
gh pr create --base main --head feat/site-agnostic-projection --title "Generalize compact browser projection across sites" --body "$(cat <<'EOF'
## Summary
- Extract site-neutral evidence-lane projection.
- Route Agoda and generic HTTPS pages through explicit adapters.
- Preserve raw AX safety checks and add cross-site regression coverage.

## Verification
- `npm test`
- Node syntax checks
- Live Agoda policy-control verification
EOF
)"
```

- [ ] **Step 5: Report the PR URL and verification evidence**

Include the final PR URL, test count, live adapter/mode, projected/raw counts, and any remaining limitations.
