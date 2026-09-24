# Jev Browser Use — Deterministic E2E Testing Skill Implementation Plan

## 1. Goal

Build a deterministic E2E testing skill for `jev-browser-use` that a testing subagent can invoke as a **single bounded tool**.

The testing subagent should not manually orchestrate:

```text
fixture setup
browser startup
Jev mocking
transport startup
scenario selection
test execution
assertions
cleanup
result interpretation
```

Instead:

```text
Testing Subagent
       │
       │ one invocation
       ▼
jev-browser-e2e skill
       │
       ├─ inspect changed paths
       ├─ select required suites
       ├─ validate environment
       ├─ start controlled fixtures
       ├─ start required processes
       ├─ run scenarios
       ├─ perform assertions
       ├─ collect structured evidence
       ├─ terminate owned processes
       └─ return PASS / FAIL / INFRA_ERROR
       │
       ▼
Testing Subagent reports result
```

Core principle:

> **The testing subagent decides when to test. The E2E skill deterministically decides how to test.**

The skill must be usable by:

```text
Terra/medium routine QA
Luna/xhigh repair verification
Sol/medium difficult failure analysis
humans
CI
future agent harnesses
```

without changing test semantics.

---

# 2. Primary Objective

Convert E2E verification from an agent reasoning task into an executable test contract.

Avoid:

```text
Testing agent
   ↓
inspect diff
   ↓
decide what tests might matter
   ↓
start server
   ↓
open browser
   ↓
perform actions
   ↓
inspect output
   ↓
decide whether it looks correct
```

Prefer:

```text
Testing agent
   ↓
run deterministic E2E skill
   ↓
receive structured verdict
```

The normal testing-agent interaction should require **one tool invocation**.

---

# 3. Definition of Deterministic

For this skill, deterministic means:

1. Test selection follows explicit rules.
2. Test inputs are controlled.
3. Test fixture state is reset for every case.
4. Test assertions are executable code rather than LLM judgment.
5. Randomness is removed or seeded.
6. External websites are not required for gate tests.
7. External LLM/Jev variability is removed from deterministic gate tests.
8. Fixed timeouts and budgets are used.
9. Processes have explicit ownership and cleanup.
10. Results use a stable machine-readable schema.
11. PASS/FAIL does not depend on prose interpretation.
12. Exact latency values are recorded but are not used as correctness assertions unless explicitly required.

This does **not** mean every runtime metric must be identical between runs.

For example:

```text
wall_time_ms
browser_latency_ms
startup_ms
```

may vary.

Correctness must not depend on those values except for broad timeout limits.

---

# 4. Important Separation: Deterministic Gate vs Live Smoke

A real Jev/model service introduces nondeterministic decision behavior.

Therefore separate E2E into two classes.

## Deterministic gate

Required for normal QA:

```text
local fixture website
+
real application stack
+
real transport
+
real browser backend where practical
+
mocked/recorded Jev decision service
```

This suite determines:

```text
PASS / FAIL
```

for implementation gates.

## Live smoke

Optional compatibility verification:

```text
real Jev service
+
real browser backend
+
controlled local fixture pages
```

This validates real deployment integration but must **not** replace the deterministic gate.

Live smoke may report:

```text
PASS
FAIL
SKIPPED
UNAVAILABLE
```

Do not treat transient live-service variability as evidence of a deterministic regression without reproduction.

---

# 5. Core Principle

The E2E skill must be:

```text
thin agent interface
+
deterministic runner
+
controlled fixture environment
+
typed assertions
+
structured report
```

Do not implement the tests themselves in `SKILL.md`.

Correct:

```text
SKILL.md
   │
   ▼
deterministic runner
   │
   ▼
typed test scenarios
```

Avoid:

```text
SKILL.md
   │
   ▼
LLM manually performs browser testing
```

---

# 6. Proposed Repository Shape

```text
jev-browser-use/
│
├── skills/
│   └── jev-browser-e2e/
│       ├── SKILL.md
│       └── run.ts
│
├── tests/
│   └── e2e/
│       ├── runner.ts
│       ├── types.ts
│       ├── report.ts
│       ├── environment.ts
│       ├── selection.ts
│       ├── process-manager.ts
│       │
│       ├── fixtures/
│       │   ├── server.ts
│       │   ├── state.ts
│       │   └── pages/
│       │       ├── basic-click.html
│       │       ├── scroll-find.html
│       │       ├── multi-action.html
│       │       ├── stale-state.html
│       │       ├── handoff.html
│       │       └── cancellation.html
│       │
│       ├── jev/
│       │   ├── mock-server.ts
│       │   └── scenarios.ts
│       │
│       ├── scenarios/
│       │   ├── basic-click.test.ts
│       │   ├── scroll-find.test.ts
│       │   ├── multi-action.test.ts
│       │   ├── stale-state.test.ts
│       │   ├── handoff.test.ts
│       │   ├── cancellation.test.ts
│       │   └── backend-failure.test.ts
│       │
│       └── transports/
│           ├── direct.ts
│           ├── cli.ts
│           └── mcp.ts
│
└── evals/
    └── results/
```

Do not scaffold unused abstractions up front.

Create files only as their corresponding tests are implemented.

---

# 7. Skill Interface

The primary invocation should be:

```bash
bun skills/jev-browser-e2e/run.ts \
  --changed-since <base-commit> \
  --json
```

The skill should:

```text
1. determine changed paths
2. map paths to required suites
3. run those suites
4. emit one structured result
```

Explicit suite invocation should also be supported:

```bash
bun skills/jev-browser-e2e/run.ts \
  --suite gate \
  --json
```

Examples:

```bash
bun skills/jev-browser-e2e/run.ts --suite core --json
bun skills/jev-browser-e2e/run.ts --suite mcp --json
bun skills/jev-browser-e2e/run.ts --suite cli --json
bun skills/jev-browser-e2e/run.ts --suite adapter --json
bun skills/jev-browser-e2e/run.ts --suite cancellation --json
bun skills/jev-browser-e2e/run.ts --suite release --json
```

Optional non-gating suite:

```bash
bun skills/jev-browser-e2e/run.ts \
  --suite live-smoke \
  --json
```

---

# 8. One-Command QA Workflow

Normal testing subagent flow:

```text
Testing Subagent
       │
       ▼
bun skills/jev-browser-e2e/run.ts
    --changed-since <base>
    --json
       │
       ▼
Structured result
       │
   ┌───┴───┐
   │       │
 PASS     FAIL
   │       │
report   report exact
evidence failed scenario
```

The testing subagent should not normally need a second tool call.

---

# 9. Deterministic Test Selection

Do not make the testing LLM infer which suites are relevant.

Implement a fixed path-to-suite mapping.

Example:

```ts
const rules = [
  {
    paths: ["src/core/**", "src/app/**"],
    suites: ["core", "gate"],
  },
  {
    paths: ["src/adapters/browser-adapter.ts"],
    suites: ["core", "adapter", "gate"],
  },
  {
    paths: ["src/adapters/**"],
    suites: ["adapter", "gate"],
  },
  {
    paths: ["src/transports/mcp/**"],
    suites: ["mcp", "gate"],
  },
  {
    paths: ["src/transports/cli/**", "src/main.ts"],
    suites: ["cli", "gate"],
  },
  {
    paths: ["src/runtime/subprocess.ts", "src/runtime/signals.ts"],
    suites: ["cancellation", "backend-failure", "gate"],
  },
  {
    paths: ["package.json", "bun.lock", "tsconfig.json"],
    suites: ["gate", "release"],
  },
];
```

Unknown production-code changes default to:

```text
gate
```

Ambiguous shared changes should select **more testing**, not require agent reasoning.

---

# 10. Selection Report

The tool should record why suites were selected.

Example:

```json
{
  "changedPaths": [
    "src/transports/mcp/server.ts",
    "src/transports/mcp/tools.ts"
  ],
  "selectedSuites": [
    "mcp",
    "gate"
  ],
  "selectionReasons": [
    {
      "rule": "src/transports/mcp/**",
      "suites": ["mcp", "gate"]
    }
  ]
}
```

This allows QA to verify that test selection itself was deterministic.

---

# 11. Stable Exit Codes

Use explicit exit semantics.

```text
0 = PASS

1 = TEST_FAILURE

2 = INFRA_ERROR

3 = RUNNER_ERROR
```

Definitions:

## `PASS`

All selected deterministic assertions passed.

## `TEST_FAILURE`

The product violated an E2E assertion.

Examples:

```text
wrong status
wrong final state
stale action executed
handoff missing
MCP result differs from direct result
process failed to terminate
```

## `INFRA_ERROR`

Required environment was unavailable before meaningful testing.

Examples:

```text
browser executable missing
required test adapter unavailable
port binding unavailable
required credential absent for explicitly requested live-smoke
```

## `RUNNER_ERROR`

The test framework itself failed unexpectedly.

These categories must not be conflated.

---

# 12. Output Contract

When `--json` is used:

```text
stdout = final JSON result only
stderr = human-readable diagnostics
```

Example PASS:

```json
{
  "schemaVersion": 1,
  "status": "PASS",
  "suites": ["mcp", "gate"],
  "summary": {
    "passed": 8,
    "failed": 0,
    "skipped": 0
  },
  "failures": [],
  "artifacts": {
    "report": "..."
  }
}
```

Example failure:

```json
{
  "schemaVersion": 1,
  "status": "FAIL",
  "suites": ["gate"],
  "summary": {
    "passed": 5,
    "failed": 1,
    "skipped": 0
  },
  "failures": [
    {
      "scenario": "stale-state-rejection",
      "assertion": "stale action must not execute",
      "expected": "stale_action_rejection",
      "actual": "action_executed"
    }
  ]
}
```

The testing subagent should not have to parse human prose to determine success.

---

# 13. Controlled Fixture Web Server

Gate tests must not depend on GitHub, Google, or another live website.

Create a local fixture server.

Use:

```text
127.0.0.1
```

with an OS-assigned free port.

Do not hardcode a global port that could conflict with concurrent workers.

Example lifecycle:

```text
start server on 127.0.0.1:0
        ↓
receive assigned port
        ↓
construct allowed test origin
        ↓
run scenario
        ↓
shutdown server
```

The actual port should not form part of semantic assertions.

---

# 14. Fixture Requirements

Fixtures should be deliberately small.

Each fixture exists to validate one behavior.

## Basic click

Page:

```text
button: "Open details"
```

Expected:

```text
Jev selects button
→ browser acts
→ page enters known success state
```

## Scroll and find

Target begins outside the relevant visible/available region.

Expected:

```text
scroll
→ target becomes available
→ click
→ known final state
```

## Multi-action

Example:

```text
open section
→ next
→ select target
→ completion marker
```

Tests multiple internal Jev iterations within one host call.

## Handoff

Fixture requires an intentionally unsupported action.

Expected:

```text
status = handoff
```

## Stale state

Fixture changes browser state between decision and action.

Expected:

```text
stale_action_rejection
```

followed by permitted retry behavior.

## Cancellation

Start bounded work and abort it.

Expected:

```text
status = cancelled
```

and no owned child process remains.

---

# 15. No Generic Fixture Framework Initially

Do not build a generic webpage DSL.

Start with:

```text
small HTML fixtures
+
small TypeScript scenario definitions
```

Example:

```ts
const scenario = defineScenario({
  id: "basic-click",
  fixture: "basic-click.html",
  goal: "Open details",
  expectedStatus: "completed",
});
```

Only introduce a general scenario DSL if repetition later demonstrates a real need.

---

# 16. Deterministic Jev Boundary

The normal E2E gate must not rely on nondeterministic remote model decisions.

Use a controlled test double at the Jev API boundary.

Prefer:

```text
real Jev client code
       │
       ▼
local deterministic Jev test server
```

rather than replacing the whole decision layer inside `runBrowserTask()`.

This exercises more real production wiring.

The local Jev server returns scenario-specific deterministic decisions.

Example:

```text
basic-click:
observation #1 → click element X

scroll-find:
observation #1 → scroll down
observation #2 → click element Y
```

---

# 17. Jev Mock Contract

Define deterministic scripted responses by scenario.

Conceptually:

```ts
interface TestJevScenario {
  id: string;

  decisions: Array<{
    when: ObservationMatcher;
    return: JevDecision;
  }>;
}
```

Avoid fuzzy LLM-style matching.

Prefer exact structured predicates:

```text
URL
state version
available element IDs
capability set
scenario state
```

If the observation does not match an expected state:

```text
FAIL immediately
```

Do not let the mock improvise.

---

# 18. Why the Mock Must Be Strict

Suppose the implementation unexpectedly sends:

```text
observation 1
observation 2
observation 2 again
```

A permissive mock might continue and hide the regression.

Instead, scripted expectations should detect:

```text
unexpected Jev call
unexpected observation
unexpected element set
unexpected state version
unexpected decision sequence
```

and fail.

This turns the Jev boundary into part of the E2E assertion.

---

# 19. Real Browser Backend

Where practical, deterministic gate tests should use a real browser backend.

Preferred initial deterministic backend:

```text
Browser Harness adapter
```

or whichever backend provides the most repeatable local automation.

The gate should exercise:

```text
runBrowserTask()
→ BrowserAdapter
→ real browser backend
→ local fixture page
```

Do not make the first deterministic gate dependent on a proprietary host environment if a local controllable backend exists.

---

# 20. Adapter-Specific E2E

Each production browser adapter should eventually run the common E2E scenarios.

Example:

```text
basic-click
scroll-find
multi-action
stale-state
cancellation
```

against:

```text
Codex CUA
Codex Bridge
Browser Harness
```

where the environment supports that backend.

Adapter-specific unavailability should be reported as:

```text
INFRA_ERROR
```

or:

```text
SKIPPED
```

according to whether that adapter was required by the selected suite.

Never silently convert an unavailable required adapter into PASS.

---

# 21. Transport Equivalence

A central E2E invariant is:

> **Direct, CLI, and MCP invocation must reach the same application behavior.**

Use the same underlying scenario through:

```text
direct → runBrowserTask()
CLI    → jev-browser run
MCP    → jev_browser_run
```

Normalize transport-specific envelopes and compare the semantic result.

Example:

```text
status
reason category
final URL/state
browser action outcome
handoff/cancellation state
```

Do not require byte-identical output if the transports legitimately add metadata.

---

# 22. CLI E2E Suite

For CLI:

```text
start fixture
start deterministic Jev service
invoke jev-browser run
parse machine-readable output
assert result
assert exit status
cleanup
```

Verify:

```text
[ ] command invokes real application API
[ ] valid task exits successfully
[ ] failed task returns expected failure
[ ] cancellation propagates
[ ] JSON output is parseable
[ ] diagnostics do not corrupt JSON mode
```

---

# 23. MCP E2E Suite

For MCP:

```text
start fixture
start deterministic Jev service
spawn jev-browser mcp
perform MCP initialization
discover tools
invoke jev_browser_run
assert returned result
terminate MCP process
```

Verify:

```text
[ ] initialization succeeds
[ ] expected tools discovered
[ ] bounded run succeeds
[ ] tool invokes real application API
[ ] protocol stdout remains clean
[ ] diagnostics remain on stderr
[ ] cancellation propagates
[ ] process exits cleanly
```

This should use an actual MCP client implementation in test code rather than manually inspecting stdout.

---

# 24. Stale-State E2E

This scenario is important enough to have its own deterministic test.

Sequence:

```text
observe V1
   ↓
Jev receives V1
   ↓
fixture mutates to V2
   ↓
implementation re-observes
   ↓
detect V1 != V2
   ↓
reject stale action
```

Assert:

```text
action against V1 was not executed
stale_action_rejection recorded
retry obeyed configured budget
eventual outcome matches scenario
```

The test should not rely only on metrics.

The fixture should expose enough state to prove the stale action never occurred.

---

# 25. Cancellation E2E

Sequence:

```text
start browser task
   ↓
reach controlled waiting point
   ↓
send AbortSignal
   ↓
propagate cancellation
   ↓
stop Jev request
   ↓
stop adapter operation
   ↓
terminate owned child process
```

Assert:

```text
status = cancelled
no additional browser action occurs
owned subprocess exits
runner itself does not hang
```

Use a fixed timeout to detect leaked work.

---

# 26. Backend-Failure E2E

Create a controllable browser bridge that intentionally exits.

Sequence:

```text
task starts
   ↓
bridge receives request
   ↓
bridge exits unexpectedly
   ↓
adapter surfaces backend failure
   ↓
runBrowserTask returns structured failure
```

Assert:

```text
no indefinite hang
failure category is correct
cleanup occurs
```

---

# 27. Action-Budget E2E

Use a fixture that cannot complete within a deliberately low budget.

Example:

```text
maxActions = 2
scenario requires 3 actions
```

Assert:

```text
status = budget_exhausted
browser action count = 2
no third action executes
```

---

# 28. Origin-Policy E2E

Controlled fixture redirects from:

```text
allowed test origin
```

to:

```text
second local origin
```

when the second origin is not allowed.

Assert:

```text
policy prevents prohibited continuation
expected handoff/failure returned
no prohibited action executed
```

Both origins remain local.

No external internet dependency is needed.

---

# 29. Capability E2E

Run a controlled adapter configuration advertising:

```json
{
  "click": true,
  "scroll": false,
  "keypress": false,
  "reload": true
}
```

Fixture requires scrolling.

Assert:

```text
Jev is not offered unsupported action
unsupported action is never sent to adapter
task hands off or fails according to contract
```

---

# 30. Core Gate Suite

The default deterministic gate should contain a small high-value set.

```text
basic-click
scroll-find
multi-action
handoff
stale-state
action-budget
cancellation
```

Potential later additions:

```text
origin-policy
backend-failure
capability restriction
```

Keep the default gate fast enough to run on every meaningful implementation packet.

---

# 31. Suite Definitions

Recommended initial suites:

```text
gate
core
cli
mcp
adapter
cancellation
release
live-smoke
full
```

## `gate`

Small mandatory regression set.

## `core`

Direct `runBrowserTask()` E2E.

## `cli`

CLI transport E2E.

## `mcp`

MCP protocol E2E.

## `adapter`

Reusable backend behavior.

## `cancellation`

Cancellation/subprocess lifecycle.

## `release`

Compiled executable smoke test.

## `live-smoke`

Real Jev service. Non-deterministic integration check.

## `full`

All deterministic suites supported by the environment.

---

# 32. Test Isolation

Every scenario receives fresh:

```text
fixture state
browser context/session
Jev mock scenario
action budget
metrics collector
AbortController
```

Do not allow one scenario's browser state to affect another.

Tests sharing a backend instance may run serially unless isolation is proven.

---

# 33. Concurrency

The runner may parallelize only scenarios with fully isolated:

```text
browser contexts
fixture state
ports
Jev mock sessions
temporary directories
```

Start simple:

```text
serial E2E execution
```

for shared browser backends.

Add concurrent execution only after the deterministic suite is stable.

Do not make concurrency an initial requirement.

---

# 34. Environment Normalization

For gate tests set controlled defaults where applicable:

```text
TZ=UTC
stable locale
fixed viewport
fixed browser configuration
fixed action budget
fixed retry budget
fixed confidence threshold
fixed test data
fixed Jev scenario
```

Do not assert browser-generated values that are irrelevant to correctness.

---

# 35. Timeouts

Every process and scenario needs an explicit timeout.

Example categories:

```text
fixture startup timeout
Jev mock startup timeout
browser startup timeout
scenario timeout
process shutdown timeout
```

Do not use one giant global timeout.

Timeout should return a structured failure showing which stage exceeded its budget.

---

# 36. Process Ownership

Implement one small process manager for E2E-owned children.

Track:

```text
PID/process handle
purpose
start time
stdout
stderr
shutdown method
```

On normal completion or failure:

```text
terminate owned children
wait for shutdown
force terminate after bounded grace period
```

The testing skill must not leave:

```text
browser bridges
MCP servers
fixture servers
mock Jev servers
```

running after it exits.

---

# 37. Evidence Capture

Always record compact structured evidence.

For each scenario:

```json
{
  "id": "stale-state",
  "status": "PASS",
  "durationMs": 431,
  "applicationStatus": "completed",
  "browserActions": 2,
  "staleRejections": 1
}
```

On failure additionally capture:

```text
expected assertion
actual result
normalized action history
relevant final snapshot
child-process stderr
```

Do not store every browser observation by default.

---

# 38. Artifact Policy

Normal PASS:

```text
summary JSON
```

Failure:

```text
summary JSON
scenario result
relevant action trace
relevant process logs
```

Debug mode may additionally keep:

```text
all observations
full process logs
browser traces
screenshots when supported
```

but debug artifacts should not be produced on every successful gate.

---

# 39. Report Schema

Define a versioned schema.

Example:

```ts
interface E2EReport {
  schemaVersion: 1;

  status:
    | "PASS"
    | "FAIL"
    | "INFRA_ERROR"
    | "RUNNER_ERROR";

  selection: {
    changedPaths?: string[];
    requestedSuites?: string[];
    selectedSuites: string[];
    reasons: SelectionReason[];
  };

  environment: {
    bunVersion: string;
    platform: string;
    backend: string;
  };

  summary: {
    passed: number;
    failed: number;
    skipped: number;
    durationMs: number;
  };

  scenarios: ScenarioResult[];

  failures: FailureRecord[];

  artifacts: Record<string, string>;
}
```

Version this contract before changing its meaning.

---

# 40. Assertions Should Be Semantic

Prefer:

```text
status === completed
staleRejections === 1
final state contains completion marker
forbidden action did not execute
process exited
```

Avoid fragile assertions such as:

```text
exact full accessibility tree
exact timing
exact generated IDs
exact browser log ordering
entire raw JSON snapshot equality
```

unless those values are themselves part of the contract.

---

# 41. Testing Skill `SKILL.md`

The skill should be intentionally short.

Its purpose is to tell the testing subagent:

```text
when to run the tool
which command to invoke
how to interpret its status
what not to do
```

Conceptual content:

```markdown
# Jev Browser E2E

Use this skill when independently verifying implementation changes
to jev-browser-use.

Default invocation:

bun skills/jev-browser-e2e/run.ts \
  --changed-since <base> \
  --json

Treat the runner's structured verdict as the primary test result.

STATUS meanings:

PASS:
  selected deterministic E2E suites passed.

FAIL:
  product behavior violated at least one assertion.

INFRA_ERROR:
  required test environment was unavailable.

RUNNER_ERROR:
  the E2E test framework itself failed.

Do not manually substitute browser inspection for a failed deterministic test.

Do not modify production code during QA.

On FAIL, return the failed scenario and assertion to the orchestrator.

On INFRA_ERROR, report the missing prerequisite separately from a product failure.

Run live-smoke only when specifically required.
```

Do not embed lengthy test logic in `SKILL.md`.

---

# 42. Testing Subagent Contract

The orchestrator should instruct the testing subagent:

```text
Use the jev-browser-e2e skill as the source of truth for E2E verification.

Run:

bun skills/jev-browser-e2e/run.ts \
  --changed-since {{BASE_COMMIT}} \
  --json

Do not manually choose a smaller test suite unless the work packet explicitly requires one.

Do not modify production code.

If status is PASS:
return PASS and concise evidence.

If status is FAIL:
return FAIL with:
- failed scenario
- failed assertion
- expected value
- actual value
- artifact/report location

If status is INFRA_ERROR:
return BLOCKED with the missing prerequisite.

If status is RUNNER_ERROR:
report a testing-infrastructure defect.

Do not replace deterministic failures with subjective browser inspection.
```

Routine testing model:

```text
Terra/medium
```

The testing agent's role becomes primarily:

```text
invoke
read structured result
report
```

rather than reason through browser behavior.

---

# 43. Orchestrator Integration

Normal implementation cycle:

```text
Luna/high implementation
        │
        ▼
Terra/medium QA subagent
        │
        ▼
jev-browser-e2e skill
        │
        ▼
deterministic result
```

PASS:

```text
advance gate
```

FAIL:

```text
return exact deterministic failure
        ↓
classify
        ↓
Luna/high localized repair
or
Luna/xhigh reasoning repair
```

Repeated difficult failure:

```text
Sol/medium diagnosis
```

The E2E runner itself does not change models.

It contains no model-routing logic.

---

# 44. Targeted Re-QA

After a repair, the orchestrator may provide the failed scenarios to the QA worker.

Example:

```bash
bun skills/jev-browser-e2e/run.ts \
  --scenario stale-state \
  --scenario cancellation \
  --json
```

Then, before closing the milestone, run:

```text
the normal changed-path gate
```

again.

This prevents a repair from passing only its previously failed case while breaking another affected scenario.

---

# 45. No Automatic Blind Retries

A deterministic assertion failure should not automatically rerun three times.

Default:

```text
1 execution
```

A repeated run is justified only to diagnose:

```text
suspected test-runner instability
environment startup race
backend infrastructure problem
```

If a supposedly deterministic test requires retries to pass consistently:

```text
the test is not deterministic enough
```

Fix the test or product behavior instead of hiding the instability.

---

# 46. Live Smoke Suite

Keep live-service verification separate.

Example:

```bash
bun skills/jev-browser-e2e/run.ts \
  --suite live-smoke \
  --json
```

Use:

```text
real Jev service
controlled local fixture
real browser backend
```

Validate only broad semantics:

```text
task completes
expected final state reached
no safety invariant violated
bounded action limit respected
```

Do not require:

```text
exact action sequence
exact model output
exact token count
exact latency
```

Live smoke results should include:

```text
live: true
```

so nobody mistakes them for deterministic gate evidence.

---

# 47. CI Integration

CI should call the exact same runner as testing agents.

Example:

```bash
bun skills/jev-browser-e2e/run.ts \
  --suite gate \
  --json
```

Do not maintain:

```text
one QA test implementation
+
another CI implementation
```

The same executable test contract should serve:

```text
testing subagents
developers
CI
release validation
```

---

# 48. Release Testing

After standalone compilation:

```text
build jev-browser
        ↓
run fixture environment
        ↓
invoke compiled binary
        ↓
run CLI smoke
        ↓
run MCP smoke
```

This catches errors hidden by:

```text
bun run src/main.ts
```

but introduced by compilation or packaging.

---

# 49. Implementation Phases

Implement the E2E skill incrementally.

Do not build the full testing platform in one pass.

---

# 50. Phase 1 — Runner Contract

## Goal

Create the deterministic command and report contract before implementing many scenarios.

Deliver:

```text
skills/jev-browser-e2e/run.ts
tests/e2e/runner.ts
tests/e2e/types.ts
tests/e2e/report.ts
tests/e2e/selection.ts
```

Support:

```text
--suite
--scenario
--changed-since
--json
```

Implement:

```text
exit codes
stable JSON schema
stdout/stderr rules
path-to-suite selection
```

Use one trivial placeholder test initially.

### Gate

```text
[ ] runner exits 0 on PASS
[ ] runner exits 1 on deterministic failure
[ ] invalid environment classification works
[ ] JSON parses consistently
[ ] changed paths select suites deterministically
```

---

# 51. Phase 2 — Controlled Fixture Environment

## Goal

Remove external websites from gate testing.

Deliver:

```text
local fixture server
fixture state reset
basic-click page
scroll-find page
multi-action page
```

### Gate

```text
[ ] fixture server starts on isolated port
[ ] each scenario starts from clean state
[ ] fixture server always shuts down
[ ] parallel test workers cannot collide on port
```

---

# 52. Phase 3 — Deterministic Jev Service

## Goal

Remove model nondeterminism from the gate.

Deliver:

```text
local Jev mock server
typed scripted scenarios
strict observation matching
unexpected-call failure
```

### Gate

```text
[ ] production Jev client path can target test server
[ ] decisions are scenario-controlled
[ ] unexpected observations fail
[ ] no live Jev credential needed for gate tests
```

Do not introduce test behavior into Jev Core.

Prefer dependency/configuration injection at an existing application/service boundary.

---

# 53. Phase 4 — Core E2E

Implement:

```text
basic-click
scroll-find
multi-action
handoff
stale-state
action-budget
cancellation
```

Run through:

```text
runBrowserTask()
```

with a real controllable browser backend.

### Gate

```text
[ ] all scenarios deterministic
[ ] repeated runs produce same semantic results
[ ] no leaked processes
[ ] failure evidence is actionable
```

---

# 54. Phase 5 — CLI E2E

Run the same semantic scenarios through:

```text
jev-browser run
```

Do not create separate fixture logic.

### Gate

```text
[ ] CLI result semantically matches direct invocation
[ ] JSON output clean
[ ] exit codes correct
[ ] cancellation works
```

---

# 55. Phase 6 — MCP E2E

Run through:

```text
jev-browser mcp
```

using a real MCP test client.

### Gate

```text
[ ] MCP initialization works
[ ] tool discovery works
[ ] jev_browser_run works
[ ] stdout protocol-safe
[ ] result semantically matches direct invocation
[ ] cancellation works
[ ] subprocess exits cleanly
```

---

# 56. Phase 7 — Change-Based Suite Selection

Implement deterministic selection from Git changes.

Input:

```text
base commit
head/current worktree
```

Output:

```text
changed files
selected suites
selection reasons
```

Unknown core/product changes should safely fall back to:

```text
gate
```

### Gate

Test the selector itself with fixture file lists.

Example:

```text
MCP-only change
→ mcp + gate

adapter change
→ adapter + gate

docs-only change
→ no E2E or explicitly SKIPPED

unknown src change
→ gate
```

---

# 57. Phase 8 — Skill Packaging

Create:

```text
skills/jev-browser-e2e/SKILL.md
```

The skill should expose the runner, not duplicate its logic.

### Gate

A testing subagent can receive only:

```text
repo/worktree
base commit
```

and successfully perform E2E QA in one invocation.

---

# 58. Phase 9 — Live Smoke

Only after deterministic E2E is stable.

Implement:

```text
--suite live-smoke
```

Keep it:

```text
optional
clearly labeled
non-gating by default
```

unless a particular release process explicitly requires it.

---

# 59. Phase 10 — Release E2E

Run the compiled executable rather than source.

Verify:

```text
CLI
MCP startup
basic task
doctor
shutdown
```

This suite belongs near release/distribution milestones rather than every code change.

---

# 60. First Implementation Target

Do not implement every scenario first.

Initial target:

> **A testing subagent can invoke one command that deterministically starts a local fixture, runs `runBrowserTask()` through a controlled browser backend and deterministic Jev service, asserts a basic-click scenario, cleans everything up, and returns versioned JSON PASS/FAIL.**

Required:

```text
[ ] skill runner exists
[ ] JSON result contract exists
[ ] deterministic exit codes exist
[ ] fixture server exists
[ ] deterministic Jev service exists
[ ] one real browser backend used
[ ] basic-click executes end-to-end
[ ] all owned processes clean up
[ ] no LLM judgment required
```

Only after this works add more scenarios.

---

# 61. Second Implementation Target

Add:

```text
scroll-find
multi-action
handoff
stale-state
action-budget
cancellation
```

Required:

```text
[ ] each has explicit assertions
[ ] each resets state
[ ] each produces structured evidence
[ ] repeated execution remains semantically stable
```

---

# 62. Third Implementation Target

Add transport equivalence:

```text
direct
CLI
MCP
```

Required:

```text
[ ] same controlled fixtures
[ ] same Jev scenarios
[ ] same semantic expected outcomes
[ ] no duplicated scenario implementation
```

---

# 63. Fourth Implementation Target

Add deterministic changed-path suite selection.

Required:

```text
[ ] changed paths obtained from git
[ ] fixed rules select suites
[ ] reasons recorded
[ ] unknown production changes fall back safely
[ ] testing agent no longer chooses routine suites manually
```

---

# 64. Fifth Implementation Target

Package the runner as the official QA skill.

Target testing interaction:

```text
Terra/medium QA agent
        │
        ▼
one E2E skill invocation
        │
        ▼
PASS / FAIL / INFRA_ERROR
        │
        ▼
concise report to orchestrator
```

At this point the E2E skill becomes the normal deterministic evidence source for milestone QA.

---

# 65. Non-Goals

Do not initially build:

```text
generic browser testing framework
Playwright replacement
visual regression platform
screenshot comparison system
AI test-case generator
LLM judge
fuzzy assertion engine
test-management database
distributed test scheduler
browser farm
record/replay platform
generic fixture DSL
```

Do not use an LLM to decide whether an E2E scenario passed.

---

# 66. Architectural Invariants

### Invariant 1

```text
E2E correctness is determined by executable assertions.
```

### Invariant 2

```text
The testing subagent does not manually execute browser actions.
```

### Invariant 3

```text
The testing subagent does not manually select routine suites when changed-path selection is available.
```

### Invariant 4

```text
Gate tests do not depend on public websites.
```

### Invariant 5

```text
Gate tests do not depend on nondeterministic live Jev decisions.
```

### Invariant 6

```text
Live smoke and deterministic gate results remain distinguishable.
```

### Invariant 7

```text
Every owned process is cleaned up.
```

### Invariant 8

```text
Direct, CLI, and MCP tests reuse the same semantic scenarios.
```

### Invariant 9

```text
Test-specific behavior does not leak into Jev Core.
```

### Invariant 10

```text
A deterministic failure is not hidden by automatic retries.
```

### Invariant 11

```text
PASS/FAIL can be determined from structured output without LLM interpretation.
```

### Invariant 12

```text
The same runner is usable by agents, humans, and CI.
```

---

# 67. Definition of Done

```text
[ ] skills/jev-browser-e2e/SKILL.md exists
[ ] deterministic runner exists

[ ] one-command testing workflow exists
[ ] --changed-since supported
[ ] --suite supported
[ ] --scenario supported
[ ] --json supported

[ ] stable exit codes exist
[ ] versioned report schema exists

[ ] stdout JSON remains clean
[ ] diagnostics use stderr

[ ] path-to-suite mapping deterministic
[ ] selector has its own tests

[ ] local fixture server exists
[ ] fixtures reset between tests
[ ] no public website required

[ ] deterministic Jev test service exists
[ ] no live credential required for normal gate

[ ] real browser backend exercised

[ ] basic-click E2E passes
[ ] scroll-find E2E passes
[ ] multi-action E2E passes
[ ] handoff E2E passes
[ ] stale-state E2E passes
[ ] action-budget E2E passes
[ ] cancellation E2E passes

[ ] CLI E2E passes
[ ] MCP E2E passes
[ ] direct/CLI/MCP semantic equivalence verified

[ ] subprocess cleanup verified
[ ] timeout behavior verified
[ ] backend failure classification verified

[ ] structured failure evidence generated
[ ] failure artifacts retained
[ ] successful runs remain compact

[ ] testing subagent can use skill without manually operating browser

[ ] routine QA uses Terra/medium
[ ] QA reports deterministic runner evidence
[ ] failed assertions feed directly into repair workflow

[ ] live-smoke remains separate
[ ] compiled-release E2E exists when distribution milestone is reached

[ ] same E2E runner usable by CI
```

---

# 68. Desired End State

```text
                   IMPLEMENTATION WORKER
                         Luna/high
                             │
                             ▼
                         commit/diff
                             │
                             ▼
                     TESTING SUBAGENT
                       Terra/medium
                             │
                    one skill invocation
                             │
                             ▼
                 ┌─────────────────────┐
                 │ jev-browser-e2e     │
                 │                     │
                 │ inspect git diff    │
                 │ select suites       │
                 │ start fixtures      │
                 │ start Jev mock      │
                 │ start browser       │
                 │ run scenarios       │
                 │ assert behavior     │
                 │ collect evidence    │
                 │ cleanup             │
                 └──────────┬──────────┘
                            │
                 ┌──────────┴───────────┐
                 │                      │
                PASS                   FAIL
                 │                      │
                 ▼                      ▼
            advance gate        exact failing
                                assertion
                                      │
                                      ▼
                              repair routing
```

The skill should ultimately have one defining property:

> **Testing behavior is encoded in deterministic software rather than delegated to the testing LLM. The testing subagent invokes the test contract, consumes its evidence, and reports the result.**

This keeps routine E2E QA cheap enough for `Terra/medium`, minimizes agent turns, prevents subjective testing behavior, and gives Luna/Sol repair agents precise machine-generated failures instead of prose interpretations.
