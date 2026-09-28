# Jev Browser Use — Chrome DevTools MCP on Cursor Cloud Agents

> **For implementers:** This is the execution plan for [the Chrome DevTools MCP implementation plan](./jev-mcp-agnostic-implementation.md). The technical scope, invariants, and slice order of that plan stay in force. Execution happens on a **Cursor cloud agent** (a Linux VM), not on a developer laptop. **Grok 4.7** orchestrates the run and performs QA. **Composer 2.5** implements the slice and does exploration. One Composer 2.5 owner carries a working vertical slice through tests and code. Grok 4.7 reviews at the risk boundary and before any release claim. Do not infer permission for live-site actions from this plan.

This document does not change production code, publish a package, or replace the existing Codex skill. Those happen only when a later `/goal` run meets the slice gates below.

## How a `/goal` run uses this plan

A `/goal` run takes the **lowest-numbered slice whose evidence is still open**. It may pull in the next slice only when that work is tightly coupled and the earlier slice's safety tests already pass. It stops when Grok 4.7 has re-run that slice's evidence commands and recorded the outputs, or when a stop rule fires. Passing one gate is not permission to continue into a later slice in the same run.

Completion is command evidence, not a prose claim. Grok 4.7 QA re-runs every evidence command for the slice. A box the implementer checked, without that re-run, is open. `node --test` output for the slice's files must show **0 skipped** and **0 todo**.

Paste this as the run objective, filling in the slice number and its evidence list:

```text
/goal Execute slice N of docs/plans/jev-mcp-agnostic-cursor-cloud.md on this cloud agent.
Composer 2.5 implements and explores. Grok 4.7 orchestrates and re-runs the slice evidence.
Done only when those commands have been re-run and their exit codes match the slice gate,
npm test exits 0 with 0 skipped in the slice files, and the existing Codex skill tests still pass.
Stop at the slice gate. Do not start the next slice.
```

Forbidden completions, for every slice:

- Marking evidence from a reading of the diff, a screenshot, or a summary another agent wrote.
- `it.skip`, `test.todo`, deleted assertions, or a narrowed test name pattern that hides a failing case.
- A canned `completed` (or any other status) returned without the task loop and a real MCP `tools/call`.
- Treating Cursor GUI Computer Use, a desktop screenshot, Playwright, Bun.WebView, or a raw CDP client as Chrome DevTools MCP or as `mcp__cua_repl.js`.
- Rewriting `skills/jev-browser-use/bridge.mjs` onto GUI Computer Use, or attaching `mcp__cua_repl.js` from this VM.
- Pointing the new server at the desktop Chrome that GUI Computer Use drives, or killing that Chrome during cleanup.
- Running Agoda, Booking, or any authenticated site as the deterministic gate.
- Claiming cross-harness, cross-platform, or Codex-skill replacement from this VM alone.
- Switching the implementer off Composer 2.5 mid-slice, or having Grok 4.7 take the editor to finish the slice.

## Goal and decision

Make Jev's bounded browser-action loop usable from multiple MCP-capable agent harnesses without rebuilding the browser integration for each harness. Pin the standalone product to **Chrome DevTools MCP** as its sole browser interface. The host retains the task goal, authorization, sensitive interactions, unsupported actions, and final verification. Jev chooses only bounded mechanical actions from a fresh observation.

This replaces the former goal of a harness-agnostic engine with interchangeable Codex CUA, Browser Harness, Playwright, WebView, and other browser backends. MCP standardizes how a host invokes this product. Chrome DevTools MCP supplies the one browser implementation. A second browser adapter, a native host transport, and a generic `BrowserAdapter` interface are **not** milestones.

The existing Codex/CUA skill remains supported and unchanged while the Chrome-backed path is proved. It is a separate integration. It is not evidence that a separate process can attach to Codex's host-private tab, and it is not Cursor GUI Computer Use. Do not remove or rewrite it until the new path meets the gates below and a migration is explicitly authorized.

## Execution environment

Implementers run as Cursor cloud agents. The machine in every command below is that agent VM.

| Fact | What the run does with it |
| --- | --- |
| The VM is Linux and can spawn processes, bind loopback, and install Node and Chrome. | Slices 0–4 run here. Node must satisfy `package.json` (`>=22`). |
| The VM is not the user's laptop and has no macOS or Windows runtime. | Linux evidence does not prove macOS or Windows. Cross-platform stays open until CI on those OSes, plus one manual smoke per OS, is recorded. |
| The VM is not the user's regular Chrome profile. | The default browser is an owned temporary profile started by the pinned Chrome DevTools MCP child. |
| GUI Computer Use may be present as mouse and keyboard on a desktop Chrome. | That desktop Chrome is an unrelated process. The product never sends actions through Computer Use, never reuses that profile, and never kills it. |
| `mcp__cua_repl.js` is the Codex skill's tool (`getAXState`, `click(index)`). | This plan does not attach, wrap, or imitate it. If it is absent, Codex-path timings are recorded as `unavailable`. |
| A cloud agent can start a stdio MCP server inside the VM. | That is harness 1. A second harness is a different product (Codex or Claude Code) and is not simulated from Cursor. |

```text
Cursor cloud agent, or another MCP-capable host
  │  stdio MCP: one bounded run_browser_task
  ▼
Jev-side MCP server (task policy, decision loop, audit)
  │  MCP client; owns one child process
  ▼
Pinned Chrome DevTools MCP version
  │  explicit pageId on page-scoped calls
  ▼
Owned temporary Chrome profile inside this environment
```

Cursor GUI Computer Use, `mcp__cua_repl.js`, and Chrome DevTools MCP are three different runtimes. This product's browser calls are only the third. The server does not call Cursor computer-use tools, and Computer Use gestures are not evidence for any slice gate.

### MCP is spoken, not substituted

- Protocol tests drive a **scripted MCP peer** that completes MCP initialization and answers `tools/list` and `tools/call`. The peer stands in for the Chrome DevTools MCP child only inside `test/`. It is not a product backend and not a host-facing server.
- Integration tests spawn the **pinned `chrome-devtools-mcp` binary** and an owned Chrome profile.
- Host-facing tests use an **MCP client** against `src/mcp/server.mjs` over stdio. The same task loop serves those tests and the server. There is no second browser implementation behind the tool.
- A decision test may use a **scripted decision source** that returns one typed action id and a confidence. That source is not an MCP server and does not emit tool arguments, scripts, URLs, page ids, or UIDs.
- Stdout string matching, a stub that returns a status without `tools/call`, and a Computer Use click are not MCP evidence. An MCP suite that is skipped because the server does not exist yet stays skipped and uncounted. It is not marked passed.

## Product contract

The host may invoke the same Jev MCP server from Codex, Claude Code, Cursor, or another MCP-capable harness **when that host can start or reach the server**. On a Cursor cloud agent, "reach" means a stdio child inside the VM. Cross-harness support means the same server and task schema work in validated hosts. It does not mean access to a host-owned browser tab, identical host approval UX, or zero per-host configuration.

### Browser connection modes

1. **Default for tests and first release: owned, isolated Chrome profile.** The Jev-side process starts Chrome DevTools MCP with an explicitly configured temporary profile inside the VM. The user may sign in manually within that profile if the task requires it. No claim of access to their regular browser state. This profile is not the desktop Chrome GUI Computer Use drives.
2. **Opt-in: running Chrome.** Support Chrome DevTools MCP's documented `--autoConnect` mode only after a separate security and UX gate. It requires a compatible Chrome version, enabling remote debugging, and user approval in Chrome. It can access every open window in the selected profile. The product must display this scope and never silently enable it. `--autoConnect` is not how cloud-agent tests obtain a browser, and it is not attached to the Computer Use desktop Chrome in this plan.
3. **Manual debugging endpoint: development only initially.** A debugging port is a powerful local control surface. Do not expose it as an ordinary onboarding path. If later supported, bind to loopback inside the VM, use a non-default profile, document the risk, and test lifecycle and cleanup. Do not point it at the Computer Use Chrome's port.

Pin the Chrome DevTools MCP package to an exact tested version and record the compatible Chrome and Node versions. Do not use `@latest` in release configuration. The existing [process-boundary probe](../../work/chrome-devtools-mcp-probe/VERDICT.md) passed with `chrome-devtools-mcp@1.9.0` in an isolated fixture. That result is evidence for that version and setup, not a release certification. The verdict file is not in this repository today. A missing file is recorded as not reproduced. The run does not invent a verdict. Slice 4 re-establishes the fixture evidence with the pinned version.

### One host-facing tool

Expose `run_browser_task` with a small, versioned request:

- `goal`: the host-approved bounded task, never a general "browse freely" mandate.
- `allowedOrigins`: exact HTTPS origins approved by the host; loopback HTTP only for tests.
- `page`: an optional current-session page ID chosen from `list_pages`; otherwise return candidate pages for host selection rather than guessing.
- `maxActions`, `maxDurationMs`, and an approved mechanical-action set. Server defaults are conservative and server caps cannot be raised by page content.

Return a stable status (`completed`, `handoff`, `stale_state`, `policy_denied`, `timeout`, or `error`), a bounded action history, current page ID and origin when safe to disclose, and metrics. `completed` means the bounded mechanical goal appears satisfied. It is **not** final user-task verification. Do not return raw accessibility trees, page text, secrets, or page-derived exception strings in public result or error fields.

The host owns text entry, uploads, dialogs, account and security settings, payments, deletion, sending and publishing, and final verification. If a task needs one of these, Jev stops and hands off. A future host may explicitly delegate a narrower sensitive action, but that requires a separate policy design and test gate.

## Decision and execution loop

For each permitted step:

1. Resolve the selected page through Chrome DevTools MCP `list_pages`. Bind to its current-session `pageId` and verify its URL origin before observing.
2. Call `take_snapshot` for that page. Preserve the raw snapshot in the VM for binding and validation. Send Jev only a bounded projection with opaque action IDs and no unnecessary page data.
3. Have Jev select **one** allowed action ID with confidence. The decision model never emits raw MCP tool arguments, scripts, URLs, page IDs, or UIDs to execute.
4. Immediately before acting, recheck page identity, origin, and the decision witness (the exact projected choices and their raw UID bindings). If changed, discard the decision and observe again within a bounded retry budget.
5. Map the approved action ID to the currently bound Chrome DevTools MCP `uid`. Execute the corresponding allowlisted page-scoped tool with explicit `pageId`.
6. Take a fresh snapshot. Verify the expected local postcondition or hand off when it cannot be established. Repeat only within action, retry, and time budgets.

Do not treat UIDs as durable across snapshots, DOM changes, or reconnects. The probe showed a removed element's old UID was rejected. It did not prove that every stale UID is rejected after unrelated churn. Do not assume `pageId` survives a server or browser restart. Re-list and require renewed host selection after reconnect.

Start with semantic clicks and bounded navigation only. Chrome DevTools MCP has no dedicated targeted-scroll tool in the documented reference. Keyboard scrolling depends on focus and layout. Admit scrolling only if deterministic tests establish a safe target and focus method, and otherwise hand off. Do not use `evaluate_script`, coordinate clicks, network inspection, or arbitrary CDP as a routine escape hatch. They bypass the intended action contract.

## Safety and lifecycle

- The host grants a task. The Jev-side server enforces origin, page, action, confidence, time, and step policy. A browser connection grant is not per-action authorization.
- Treat accessibility text as untrusted page content. It may describe controls but cannot modify policy, expand origins, ask for secrets, or instruct the server.
- Fail closed on absent or mismatched origin, ambiguous page selection, low confidence, unsupported control, page closure, navigation out of scope, stale binding, and exhausted retries.
- The server owns its Chrome DevTools MCP child and, in isolated mode, its Chrome profile and process. Start lazily, stop on shutdown, and terminate owned children on timeout. Never kill an unrelated Chrome instance, including the desktop Chrome used by GUI Computer Use.
- Cancellation stops scheduling new actions and closes owned resources. Because MCP cancellation does not guarantee interruption of an in-flight browser operation, record the last known outcome as uncertain and require a fresh observation before resume.
- Keep raw snapshots and provider errors inside the VM and redact page-derived content from logs, PR bodies, and host-facing errors. Audit both successful results and exception paths.
- Run one task at a time per bound page. If concurrency is added, require explicit page ID routing and tests for independent sessions. Do not share a mutable "selected page" global.

## File responsibilities

These are intended ownership seams, not permission to refactor unrelated code. Confirm exact naming against the repo before implementation. Slice 0 may add `test/contract.test.mjs` for the frozen schema. That test file is part of this plan. It is not a new product backend.

| Path | Responsibility |
| --- | --- |
| `skills/jev-browser-use/bridge.mjs` | Existing Codex/CUA path. Preserve behavior and regression tests. Extract only decision logic actually reused by the new path. |
| `src/jev/decision.mjs` | Host- and browser-independent projection, typed Jev choice, confidence, and decision-witness checks. No browser or process imports. |
| `src/chrome/session.mjs` | MCP client and owned Chrome DevTools MCP process lifecycle. Version and config validation. Current-session page binding. |
| `src/chrome/actions.mjs` | Allowlisted Chrome DevTools MCP snapshot and action calls. Explicit `pageId` and UID mapping. |
| `src/task/run.mjs` | Bounded loop, policy enforcement, handoffs, cancellation, metrics, and sanitized result. |
| `src/mcp/server.mjs` | Host-facing `run_browser_task` schema and stdio transport. No browser policy duplicated here. |
| `test/decision.test.mjs` | Pure projection, witness, confidence, and privacy cases. |
| `test/chrome-session.test.mjs` | Protocol and lifecycle cases against a scripted MCP peer. |
| `test/task.test.mjs` | Deterministic loop and policy tests with a scripted decision source and a scripted Chrome DevTools MCP peer. |
| `test/chrome-e2e.test.mjs` | Owned-profile fixture integration. No live site and no model call. |
| `test/contract.test.mjs` | Frozen request, result, origin, action-set, and non-goal contract. |

Avoid a public generic browser adapter until two real implementations demand the same interface. A scripted peer under `test/` is not a product backend.

## Implementation slices and gates

These slices describe capabilities and evidence, not mandatory agent handoffs or separate review meetings. One Composer 2.5 implementer may combine or reorder adjacent slices to deliver a working vertical path sooner, provided the existing skill keeps working and safety tests precede browser actions. Write focused tests for new behavior, run the relevant tests while iterating, and run the full suite at integration and release gates. The owner checks the working tree first and does not revert another contributor's edits.

Every slice records changed paths, the commands Grok 4.7 re-ran, their exit codes, and unresolved risks in the PR for that run. Metrics that the VM cannot observe are the string `unavailable` plus a reason. They are not filled with Computer Use timings.

Shared evidence, re-run at every slice gate:

```text
node --test
node -e "const p=require('./package.json'); if(!p.engines||!String(p.engines.node).includes('22')) process.exit(1)"
```

`node --test` must exit 0. Once a slice's test file exists, that file's summary must show 0 skipped and 0 todo. After `src/` exists, this command must exit 0 (a match fails the gate):

```text
if [ -d src ]; then if rg -n "mcp__cua_repl|computerUse|cua_repl" src; then exit 1; fi; if rg -n "@latest" package.json src; then exit 1; fi; fi
```

### 0. Baseline and contract

**Objective.** Freeze the task contract and record a reproducible baseline on this VM before any Chrome-backed production behavior exists.

**Deliverables.**

- `test/contract.test.mjs` encoding the request fields, the six statuses, conservative server caps, loopback-HTTP-only-for-tests, the default mechanical-action set (semantic click and bounded navigation), and the non-goals (no second adapter, no generic `BrowserAdapter`, no routine `evaluate_script`, coordinate clicks, network inspection, or arbitrary CDP, no silent `--autoConnect`).
- A written pin inside `test/contract.test.mjs`: exact `chrome-devtools-mcp` version, launch command, and supported Chrome and Node range. `@latest` is not a pin. Slice 2's lockfile must use that same version.
- `work/chrome-devtools-mcp-cloud/baseline.json` for two or three representative existing-browser tasks. Fields per task: `id`, `verifiedCompletion`, `wallTimeMs`, `hostTurns`, `modelCost`, `handoffs`, `retries`, `unsafeAttempts`. Each metric is a number or the string `unavailable`. Expand to at least five tasks before a replacement claim. Do not promote the README's approximate click-speed ratio to end-to-end evidence. Do not browse a live site to fill the file. Codex-path metrics stay `unavailable` unless `mcp__cua_repl.js` is actually attached. GUI Computer Use timings are not written into those fields.

**Evidence.**

```text
[ ] node --test exits 0, including test/contract.test.mjs, with 0 skipped
[ ] The contract test fails if a status outside the six names is accepted, if completed is treated as user-task verification, if a non-HTTPS non-loopback origin is accepted, or if the pinned version matches /latest/
[ ] test -f work/chrome-devtools-mcp-probe/VERDICT.md && echo present || echo absent
    is recorded in the PR; a missing file is not replaced with a new VERDICT.md
[ ] node --input-type=module -e "import fs from 'node:fs'; const b=JSON.parse(fs.readFileSync('work/chrome-devtools-mcp-cloud/baseline.json','utf8')); const keys=['verifiedCompletion','wallTimeMs','hostTurns','modelCost','handoffs','retries','unsafeAttempts']; if(!Array.isArray(b.tasks)||b.tasks.length<2||b.tasks.length>3) process.exit(1); for (const t of b.tasks){ if(!t.id) process.exit(1); for (const k of keys){ const v=t[k]; if(!(typeof v==='number'||v==='unavailable')) process.exit(1);} }"
    exits 0
[ ] git diff --name-only origin/main -- skills src scripts prints nothing
[ ] node --version and (google-chrome --version || google-chrome-stable --version || chromium --version || echo "chrome absent") are pasted in the PR
```

**Gate.** Baseline and contract are reproducible. No production files changed merely to satisfy the probe.

### 1. Pure Jev decision module

**Objective.** Move shared decision logic into a pure module and prove the existing Codex path still passes.

**Deliverables.**

- `src/jev/decision.mjs`
- `test/decision.test.mjs`
- Extraction limited to projection, action vocabulary, stale-state witness, retry, origin, and privacy behavior that both paths use

**Evidence.**

```text
[ ] node --test test/decision.test.mjs exits 0 with 0 skipped
[ ] Tests cover projection, opaque action ids, stale-state witness, retry budget, origin check, low confidence, and privacy (no raw tree, page text, or secret in the decision output)
[ ] rg -n "chrome-devtools-mcp|child_process|playwright|computerUse|cua_repl" src/jev/decision.mjs finds no match
[ ] node --test exits 0, including existing bridge, profile, and install tests
[ ] git diff -- skills/jev-browser-use/bridge.mjs is empty, or every behavior change is covered by an existing bridge test that still passes
```

**Gate.** Pure module tests and existing `npm test` pass. No new browser dependency in the decision module.

### 2. Chrome DevTools MCP session

**Objective.** Own a pinned Chrome DevTools MCP child and prove that unbound or out-of-origin pages receive no action and that owned resources close on every exit.

**Deliverables.**

- `src/chrome/session.mjs` and `src/chrome/actions.mjs`
- Exact version pin and lockfile entry, startup timeout, typed tool responses, stderr handling, cancellation cleanup, isolated profile ownership
- Support for `list_pages`, explicit page selection and binding, `take_snapshot`, and the initial allowlisted UID action calls
- Application-layer rejection of any tool outside that allowlist, including `evaluate_script`
- `test/chrome-session.test.mjs` using a scripted MCP peer (initialize, `tools/list`, `tools/call`)

**Evidence.**

```text
[ ] The lockfile (or package manifest, if no lockfile exists yet) names an exact chrome-devtools-mcp version and does not contain @latest
[ ] node --test test/chrome-session.test.mjs exits 0 with 0 skipped
[ ] Test titles cover: page closure, child crash, reconnect, wrong page ID, wrong origin, tool error, timeout, unbound page, owned-process cleanup
[ ] The wrong-origin and unbound-page tests fail if any allowlisted action tool is called
[ ] Cleanup tests fail if the owned child or owned profile is left running, and they do not signal an unrelated Chrome pid
[ ] A test calls a tool outside the allowlist and asserts the application rejects it before any peer tools/call for that tool
[ ] The scripted peer is under test/ and is not imported by src/mcp/server.mjs
```

**Gate.** Tests prove no action occurs on an unbound or out-of-origin page. Owned resources close on every exit path.

### 3. Bounded task loop and host-facing MCP server

**Objective.** Expose one versioned stdio tool whose handler is the same loop the tests run, and prove fail-closed execution with no page-derived public content.

**Deliverables.**

- `src/task/run.mjs` and `src/mcp/server.mjs`
- One-decision-at-a-time operation, pre-action witness validation, post-action observation, action and time budgets, handoff, metrics, sanitized results
- `test/task.test.mjs` with a scripted decision source and a scripted Chrome DevTools MCP peer
- An MCP-client test that starts the server over stdio, completes initialization, and calls `run_browser_task`

**Evidence.**

```text
[ ] node --test test/task.test.mjs exits 0 with 0 skipped
[ ] Test titles cover: changed snapshot, swapped UID binding, unrelated accessibility churn, low confidence, off-origin navigation, cancellation during an action, unsupported action, provider error text containing a secret
[ ] The secret-in-provider-error test fails if that secret appears in any public result or error string
[ ] The swapped-UID and changed-snapshot tests fail if the action is executed against the pre-change binding
[ ] Cancellation asserts that no further action is scheduled and that the recorded in-flight outcome is uncertain
[ ] An MCP client test performs initialize and tools/call against src/mcp/server.mjs; a stdout substring check is not the assertion
[ ] The server handler calls src/task/run.mjs; rg shows no second action loop under src/mcp/
[ ] Public result fixtures for every status omit raw accessibility trees and page text
```

**Gate.** Deterministic tests prove fail-closed execution and no page-derived content in any public result or error field.

### 4. Isolated Chrome integration

**Objective.** Run the bounded path against a real pinned Chrome DevTools MCP child and an owned profile, on a loopback fixture, inside this VM.

**Deliverables.**

- `test/chrome-e2e.test.mjs`
- A loopback HTTP fixture (not a live site) covering list and select page, snapshot, click by current UID, fresh postcondition, rejected removed UID, navigation and origin guard, lifecycle cleanup, and nested scrolling only if scrolling is in the approved action set
- A version record: Chrome, Node, Chrome DevTools MCP, and MCP SDK, written next to the test result

**Evidence.**

```text
[ ] node --test test/chrome-e2e.test.mjs exits 0 with 0 skipped
[ ] The test log shows the pinned chrome-devtools-mcp version and an owned temporary profile path under the VM temp directory
[ ] The removed-UID case asserts the stale UID is not reused after the element is gone
[ ] The origin-guard case uses a second loopback origin or a non-allowed origin and asserts policy_denied or equivalent fail-closed status with no action on that page
[ ] Process cleanup asserts the owned Chrome and MCP child are gone and the Computer Use desktop Chrome, if running, is still running
[ ] rg -n "agoda|booking\\.com" test/chrome-e2e.test.mjs finds no match
[ ] If Chrome or the pinned binary cannot start, the command exits non-zero and the slice stays open as an environment failure; the suite is not rewritten onto the scripted peer or onto GUI Computer Use
[ ] Linux result is recorded as Linux. macOS and Windows are not checked from this VM
```

**Gate.** The isolated-Chrome suite passes in this VM with owned-process cleanup and origin protection. Multi-OS results are required at the cross-platform release gate, not for this slice. Live Agoda, Booking, and authenticated-site checks stay in [Live smoke](#live-smoke), outside this gate.

### 5. Cross-harness proof and distribution

**Objective.** Show that the same pinned server and schema run in two real MCP hosts, and ship a reproducible isolated-mode install. Do not call the product a Codex-skill replacement in this slice.

**Deliverables.**

- A pinned install and a concise isolated-mode setup guide that a cloud agent and a second host can follow. The guide records the exact package version and launch command from slice 0.
- Harness 1 evidence from this Cursor cloud agent: tool discovery, launch, cancellation or handoff, page selection, and host-side final verification on the same loopback fixture as slice 4.
- Harness 2 evidence from a different MCP-capable product (Codex or Claude Code) using that same server, schema, and fixture. A host-specific setup file is acceptable. Host-specific browser logic is not.
- `--autoConnect` documented as experimental and left disabled until its separate consent and profile-scope tests pass.
- A benchmark record against plain host browser use and the existing Codex path. Fields match slice 0. Replacement stays unauthorized until verified completion, safety, and an end-to-end benefit are measured on at least five tasks.

**Evidence.**

```text
[ ] Harness 1: an MCP client inside this VM completes initialize and a fixture run_browser_task against the installed server, and the JSON result uses a documented status
[ ] Harness 1 cancellation or handoff is demonstrated with command output, not a description
[ ] Harness 2 record names the other product, the server version, and the fixture result; a Cursor-only log does not satisfy this box
[ ] The two harnesses use the same schema; a diff of the request and result fields is empty
[ ] Install guide contains the exact version and does not instruct @latest, --autoConnect, mcp__cua_repl.js, or GUI Computer Use
[ ] Benchmark fields that this VM cannot measure are unavailable; the replacement claim is absent from the README and from the PR
[ ] A third harness is not added in this slice
```

**Gate.** Two harnesses pass the same fixture checklist. The real-task half of the checklist stays open until the measurements exist. A host that needs custom browser logic fails the portability claim. One harness, or a simulated second harness, leaves the gate open.

## Acceptance and stop rules

The Chrome-backed product may be called **cross-harness** when the same pinned server, task schema, and browser implementation pass in two real harnesses. It may be called **cross-platform** only after macOS, Linux, and Windows CI plus one manual smoke test per OS pass. It may be called **a replacement for the existing Codex skill** only after equivalent real-task success, safety, and end-to-end benefit are measured. Until then, retain both.

Linux cloud-agent output satisfies the Linux row only. It does not satisfy macOS, Windows, the second harness, or the replacement claim.

Stop or narrow scope if any of these persist after one targeted repair cycle:

- The host cannot launch or reach the server, or cannot preserve the required task authorization.
- The browser cannot safely bind a selected page and origin through an entire action.
- Snapshot and UID behavior cannot support the task set without routine arbitrary script or coordinate fallbacks.
- Common tasks repeatedly hand off, fail verification, or cost more time than the host-only baseline.
- Security review finds that selected-profile access, logs, or result fields expose data outside the host-approved task.

A wrong-page or wrong-origin action, an unauthorized action, or a data leak stops browser execution immediately and blocks the gate until it is fixed and Grok 4.7 has reviewed the repair. Do not retry through it.

## Development workflow

Grok 4.7 is the orchestrator and the QA reviewer. Composer 2.5 is the single vertical-slice implementer and the explorer. The same Composer 2.5 owner may inspect, design the smallest change, write focused tests, implement, run them, and repair failures without handing work to a fresh agent at each step. Grok 4.7 does not implement the slice and does not explore the repo in place of Composer 2.5. The numbered slices are a capability checklist, not a mandated subagent per microtask.

Development loop:

1. Grok 4.7 selects the lowest open slice, names its expected result and safety checks, and assigns it to Composer 2.5 with that slice's evidence commands.
2. Composer 2.5 writes a focused failing test when changing behavior, implements the minimum path, and reruns that test and nearby regressions. It runs `npm test` (`node --test`) when integrating slices and before declaring a milestone ready for QA.
3. Adjacent tightly coupled work — Chrome session, decision loop, and MCP handler — stays with that one Composer 2.5 owner. Intermediate review that cannot see a working path waits.
4. Grok 4.7 performs **one QA pass** when the first complete vertical path works. The pass re-runs the evidence commands and reviews page and origin binding, stale UID handling, process cleanup, and public-result privacy. Repeat the QA pass only after material changes to those risks or before a release claim. Composer 2.5 repairs specific findings and reruns the affected tests. Grok 4.7 re-runs them.
5. Run the fixture end-to-end and harness-1 checks before talking about portability. Leave harness 2, multi-OS CI, and manual OS smoke open until their evidence exists. Preserve the existing Codex path until replacement criteria pass.

Optional parallel help is bounded and independent: one Composer 2.5 exploration pass (a narrow question, a written answer, then stop) while the owner runs tests. Do not dispatch a second Composer 2.5 implementer into the coupled session, loop, and server path. Do not require a fresh agent per microtask. If QA is not running during iteration, continue with automated checks and record the pending QA pass. Do not claim the release or safety gate passed.

The non-negotiable quality gates are executable policy tests before browser actions, a passing full regression suite and VM fixture end-to-end before integration, a Grok 4.7 security-focused QA pass before a release claim, and the acceptance evidence required for any cross-harness, cross-platform, or replacement claim. Record model calls, retries, and engineering time when available. Do not optimize model routing before runtime correctness.

### Model routing

The cheapest default is **no extra model call**. Composer 2.5 stays the owner and uses `node --test`, logs, and the loopback fixture first. Do not switch the implementer off Composer 2.5 mid-slice. Delegate only a bounded task whose answer changes the next action, and stop after that answer. Record actual usage before claiming savings.

| Work | Who | When to change |
| --- | --- | --- |
| Routine implementation, fixtures, documentation, and the first repair | Composer 2.5, no extra agent | Focused tests and VM evidence. One owner across session, loop, and server. |
| Independent, bounded exploration that would unblock the owner (code search, Chrome DevTools MCP docs, a narrow mechanical check) | Composer 2.5 exploration, one pass | Only when the answer changes the next edit. Narrow question, bounded output, then stop. |
| Repeated failure after a reproduced, targeted repair | Composer 2.5 reproduces and gathers evidence; Grok 4.7 QA reads it | Send only the failing command, observed and expected result, relevant logs, and competing hypotheses. Composer 2.5 retains the edits. |
| Required security-focused review of the working path | Grok 4.7 QA, one pass | Review page and origin binding, stale targets, cleanup, and public-result privacy before a release claim. A second Grok 4.7 pass only for a concrete finding that is still open, or after those risks materially change. |
| Architectural or security impasse that still changes the project decision | Grok 4.7 orchestrator | Record the unresolved decision, the evidence, and whether the capability narrows or stops. No other model family is invoked. |

On the first failure, classify it as product code, test or fixture, environment, or unclear. Composer 2.5 reproduces it, makes one targeted repair, and reruns the relevant test. If it repeats, inspect the evidence before asking for a bounded Composer 2.5 exploration pass. Do not create an escalation chain. An environment failure (missing Chrome, wrong Node, egress, a display the pinned package requires) gets an environment fix, not a different model. If an assumption remains false after diagnosis, narrow or stop that capability.

### Routing replaced from the source plan

The source plan's budget table named GPT models and reasoning effort. This plan uses roles instead. Effort levels are not a routing knob.

| Source plan | This plan |
| --- | --- |
| Routine work left on "the current owner" with no subagent | Composer 2.5 implementer |
| GPT-6 Luna, low, for a bounded mechanical check; Luna/high for light research | Composer 2.5 exploration, one bounded pass |
| GPT-6 Luna, medium, for repeated-failure diagnosis; the owner retains edits | Composer 2.5 gathers the failure evidence and keeps the edits; Grok 4.7 QA reads it |
| GPT-6 Luna, medium, one security-review pass; high only for a concrete unresolved finding | Grok 4.7 QA, one pass; a second Grok 4.7 pass only while a concrete finding is still open |
| Ask before escalating to Sol or Astra | Grok 4.7 records the impasse and narrows or stops the capability. No further model family |

## Live smoke

Live smoke is not a slice gate, not a `/goal` completion check, and not a CI gate.

Agoda, Booking, and any authenticated site run only when a person explicitly authorizes that manual session. They are recorded separately from `node --test` and from `test/chrome-e2e.test.mjs`. A live failure is not, by itself, a deterministic regression. A live success does not close slice 4 or slice 5.

What live smoke may record, when authorized: the site, the bounded goal, the status returned by `run_browser_task`, handoffs, and whether the host accepted the final verification. It does not record raw accessibility trees, credentials, or page text in the PR.

The deterministic gate uses the loopback fixture only.

## Evidence and sources

- [Chrome DevTools MCP tool reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md): page IDs, snapshots, UIDs, actions, and no dedicated scroll tool in the current reference.
- [Chrome DevTools MCP advanced usage](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md): dedicated profile, existing-Chrome connection, selected-profile scope, and debugging-port warning.
- [Process-boundary probe](../../work/chrome-devtools-mcp-probe/VERDICT.md): limited fixture evidence for page identity, UID click, removed-element stale UID, and focused nested scroll, if the file is present. Absence is recorded, not backfilled.
- [Backend assessment](../research/browser-mcp-chrome-devtools.md) and [feasibility assessment](../research/jev-project-feasibility-2026.md): documented versus unverified behavior and the reason to reject speculative browser portability.
- Source plan for scope and sequencing: [jev-mcp-agnostic-implementation.md](./jev-mcp-agnostic-implementation.md).
