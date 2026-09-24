# Jev Browser Use — Chrome DevTools MCP Implementation Plan

> **For implementers:** Prefer one owner carrying a working vertical slice through implementation and tests. Use independent review at risk boundaries and before release, not a new agent or approval cycle for every small task. Do not infer permission for live-site actions from this plan.

## Goal and decision

Make Jev's bounded browser-action loop usable from multiple MCP-capable agent harnesses without rebuilding the browser integration for each harness. Pin the standalone product to **Chrome DevTools MCP** as its sole browser interface. The host retains the task goal, authorization, sensitive interactions, unsupported actions, and final verification; Jev chooses only bounded mechanical actions from a fresh observation.

This replaces the former goal of a harness-agnostic engine with interchangeable Codex CUA, Browser Harness, Playwright, WebView, and other browser backends. MCP standardizes how a host invokes this product; Chrome DevTools MCP supplies the one browser implementation. A second browser adapter, native host transport, and generic `BrowserAdapter` interface are **not** milestones.

The existing Codex/CUA skill remains supported and unchanged while the Chrome-backed path is proved. It is a separate integration, not evidence that a separate process can attach to Codex's host-private tab. Do not remove or rewrite it until the new path meets the gates below and a migration is explicitly authorized.

## Product contract

```text
MCP-capable host
  │  one bounded run_browser_task call
  ▼
Jev-side MCP server (task policy, decision loop, audit)
  │  MCP client; owns one child process
  ▼
Pinned Chrome DevTools MCP version
  │  explicit pageId on page-scoped calls
  ▼
Chrome profile selected by connection mode
```

The host may invoke the same Jev MCP server from Codex, Claude Code, Cursor, or another MCP-capable harness **if that host can start or reach a local MCP server**. Cross-harness support means the same server and task schema work in validated hosts. It does **not** mean access to a host-owned browser tab, identical host approval UX, or zero per-host configuration.

### Browser connection modes

1. **Default for tests and first release: owned, isolated Chrome profile.** The Jev-side process starts Chrome DevTools MCP with an explicitly configured temporary profile. The user may sign in manually within that profile if the task requires it. No claim of access to their regular browser state.
2. **Opt-in: running Chrome.** Support Chrome DevTools MCP's documented `--autoConnect` mode only after a separate security and UX gate. It requires a compatible Chrome version, enabling remote debugging, and user approval in Chrome. It can access every open window in the selected profile. The product must display this scope and never silently enable it.
3. **Manual debugging endpoint: development only initially.** A debugging port is a powerful local control surface; do not expose it as an ordinary onboarding path. If later supported, bind locally, use a non-default profile, document the risk, and test lifecycle/cleanup.

Pin the Chrome DevTools MCP package to an exact tested version and record the compatible Chrome and Node versions. Do not use `@latest` in release configuration. The existing [process-boundary probe](../../work/chrome-devtools-mcp-probe/VERDICT.md) passed with `chrome-devtools-mcp@1.9.0` in an isolated local fixture; it is evidence for that version and setup, not a release certification.

### One host-facing tool

Expose `run_browser_task` with a small, versioned request:

- `goal`: the host-approved bounded task, never a general “browse freely” mandate.
- `allowedOrigins`: exact HTTPS origins approved by the host; loopback HTTP only for tests.
- `page`: an optional current-session page ID chosen from `list_pages`; otherwise return candidate pages for host selection rather than guessing.
- `maxActions`, `maxDurationMs`, and an approved mechanical-action set. Server defaults are conservative and server caps cannot be raised by page content.

Return a stable status (`completed`, `handoff`, `stale_state`, `policy_denied`, `timeout`, or `error`), a bounded action history, current page ID and origin when safe to disclose, and metrics. `completed` means the bounded mechanical goal appears satisfied; it is **not** final user-task verification. Do not return raw accessibility trees, page text, secrets, or page-derived exception strings in public result/error fields.

The host owns text entry, uploads, dialogs, account/security settings, payments, deletion, sending/publishing, and final verification. If a task needs one of these, Jev stops and hands off. A future host may explicitly delegate a narrower sensitive action, but that requires a separate policy design and test gate.

## Decision and execution loop

For each permitted step:

1. Resolve the selected page through Chrome DevTools MCP `list_pages`; bind to its current-session `pageId` and verify its URL origin before observing.
2. Call `take_snapshot` for that page. Preserve the raw snapshot locally for binding and validation; send Jev only a bounded projection with opaque action IDs and no unnecessary page data.
3. Have Jev select **one** allowed action ID with confidence. The model never emits raw MCP tool arguments, scripts, URLs, page IDs, or UIDs to execute.
4. Immediately before acting, recheck page identity, origin, and the decision witness (the exact projected choices and their raw UID bindings). If changed, discard the decision and observe again within a bounded retry budget.
5. Map the approved action ID to the currently bound Chrome DevTools MCP `uid`; execute the corresponding allowlisted page-scoped tool with explicit `pageId`.
6. Take a fresh snapshot. Verify the expected local postcondition or hand off when it cannot be established. Repeat only within action, retry, and time budgets.

Do not treat UIDs as durable across snapshots, DOM changes, or reconnects. The probe showed a removed element's old UID was rejected; it did **not** prove that every stale UID is rejected after unrelated churn. Do not assume `pageId` survives a server/browser restart. Re-list and require renewed host selection after reconnect.

Start with semantic clicks and bounded navigation only. Chrome DevTools MCP has no dedicated targeted-scroll tool in the documented reference; keyboard scrolling depends on focus and layout. Admit scrolling only if deterministic tests establish a safe target/focus method, and otherwise hand off. Do not use `evaluate_script`, coordinate clicks, network inspection, or arbitrary CDP as a routine escape hatch: they bypass the intended action contract.

## Safety and lifecycle

- The host grants a task; the Jev-side server enforces origin, page, action, confidence, time, and step policy. A browser connection grant is not per-action authorization.
- Treat accessibility text as untrusted page content. It may describe controls but cannot modify policy, expand origins, ask for secrets, or instruct the server.
- Fail closed on absent/mismatched origin, ambiguous page selection, low confidence, unsupported control, page closure, navigation out of scope, stale binding, and exhausted retries.
- The server owns its Chrome DevTools MCP child and, in isolated mode, its Chrome profile/process. Start lazily, stop on shutdown, and terminate owned children on timeout. Never kill an unrelated Chrome instance.
- Cancellation stops scheduling new actions and closes owned resources. Because MCP cancellation does not guarantee interruption of an in-flight browser operation, record the last known outcome as uncertain and require a fresh observation before resume.
- Keep raw snapshots and provider errors local and redact page-derived content from logs and host-facing errors. Audit both successful results and exception paths.
- Run one task at a time per bound page. If concurrency is added, require explicit page ID routing and tests for independent sessions; do not share a mutable “selected page” global.

## File responsibilities

These are intended ownership seams, not permission to refactor unrelated code. Confirm exact naming against the repo before implementation.

| Path | Responsibility |
| --- | --- |
| `skills/jev-browser-use/bridge.mjs` | Existing Codex/CUA path; preserve behavior and regression tests. Extract only decision logic actually reused by the new path. |
| `src/jev/decision.mjs` | Host- and browser-independent projection, typed Jev choice, confidence, and decision-witness checks. No browser/process imports. |
| `src/chrome/session.mjs` | MCP client and owned Chrome DevTools MCP process lifecycle; version/config validation; current-session page binding. |
| `src/chrome/actions.mjs` | Allowlisted Chrome DevTools MCP snapshot and action calls; explicit `pageId` and UID mapping. |
| `src/task/run.mjs` | Bounded loop, policy enforcement, handoffs, cancellation, metrics, and sanitized result. |
| `src/mcp/server.mjs` | Host-facing `run_browser_task` schema and transport; no browser policy duplicated here. |
| `test/decision.test.mjs` | Pure projection, witness, confidence, and privacy cases. |
| `test/chrome-session.test.mjs` | Protocol and lifecycle cases with a fake MCP peer. |
| `test/task.test.mjs` | Deterministic loop/policy tests with fake Jev and fake Chrome MCP. |
| `test/chrome-e2e.test.mjs` | Owned-profile, local-fixture integration tests, no live site or model call. |

Avoid a public generic browser adapter until two real implementations demand the same interface. A private fake used by tests is not a product backend.

## Implementation slices and gates

These slices describe capabilities and evidence, not mandatory agent handoffs or separate review meetings. One implementer may combine or reorder adjacent slices to deliver a working vertical path sooner, provided the existing skill keeps working and safety tests precede browser actions. Write focused tests for new behavior, run the relevant tests while iterating, and run the full suite at integration and release gates. The owner checks the working tree first and does not revert another contributor's edits.

### 0. Baseline and contract

- Record current `npm test` result and run the [existing probe](../../work/chrome-devtools-mcp-probe/VERDICT.md) from a clean isolated profile.
- Choose the exact Chrome DevTools MCP package version and supported Chrome/Node range. Record a lockfile and launch command.
- Freeze the request/result schema, default action set, origin policy, and explicit non-goals above in contract tests.
- Measure two or three representative existing-browser tasks initially with the current Codex path and plain host browser use. Track verified completion, wall time, host turns, model/provider cost when available, handoffs, retries, and unsafe/wrong-target attempts. Expand to at least five tasks before a replacement claim. Report unavailable metrics as unavailable. Do not promote the README's approximate click-speed ratio to end-to-end evidence.

**Gate:** baseline and contract are reproducible; no production files changed merely to satisfy the probe.

### 1. Pure Jev decision module

- Characterize the current bridge's projection, action vocabulary, stale-state witness, retry, origin, and privacy behavior with tests.
- Extract only the decision code needed by both paths. Keep host/browser state and I/O out of this module.
- Run current bridge/profile/install tests after extraction; preserve existing Codex behavior.

**Gate:** pure module tests and existing `npm test` pass; no new browser dependency in the decision module.

### 2. Chrome DevTools MCP session

- Add a child-process MCP client with exact pinned version, startup timeout, typed tool responses, stderr handling, cancellation cleanup, and isolated profile ownership.
- Support `list_pages`, explicit page selection/binding, `take_snapshot`, and the initial allowlisted UID action calls. Disallow unlisted tools at the application layer even though Chrome DevTools MCP exposes more.
- Test page closure, child crash, reconnect, wrong page ID, wrong origin, tool error, and timeout with a fake peer.

**Gate:** tests prove no action occurs on an unbound or out-of-origin page; owned resources close on every exit path.

### 3. Bounded task loop and host-facing MCP server

- Implement one-decision-at-a-time operation, pre-action witness validation, post-action observation, action/time budgets, handoff, metrics, and sanitized results.
- Expose the versioned `run_browser_task` tool over stdio MCP. Its handler calls the same task loop used by integration tests; no duplicate browser logic.
- Use fake Jev and fake Chrome MCP first. Test a changed snapshot, swapped UID binding, unrelated AX churn, low confidence, off-origin navigation, cancellation during an action, unsupported action, and provider error text containing a secret.

**Gate:** deterministic tests prove fail-closed execution and no page-derived content in any public result/error field.

### 4. Isolated Chrome integration

- Extend the existing local fixture/probe into an automated suite: list/select page, snapshot, click by current UID, fresh postcondition, rejected removed UID, navigation/origin guard, lifecycle cleanup, and nested scrolling if included in the approved action set.
- Run the suite locally first. Add macOS, Linux, and Windows CI before claiming cross-platform support. Record Chrome, Node, Chrome DevTools MCP, and MCP SDK versions with each result.
- Keep live Agoda/Booking or authenticated-site checks manual and explicitly authorized; do not use them as deterministic CI gates.

**Gate:** the local isolated-Chrome suite passes with owned-process cleanup and origin protection. Multi-OS results are required at the cross-platform release gate, not for every local iteration.

### 5. Cross-harness proof and distribution

- Configure the **same** Jev MCP server and schema in two distinct MCP-capable harnesses first. Validate tool discovery, launch, cancellation/handoff, page selection, and host-side final verification. Add a third only after two pass.
- Package a pinned, reproducible local installation and a concise setup guide for isolated mode. Document auto-connect as experimental until its separate consent/profile-scope tests pass.
- Run the representative task benchmark against plain host browser use and the existing Codex path. Require verified completion without a safety regression and a measured end-to-end benefit before calling this a replacement.

**Gate:** two harnesses pass the same fixture and real-task acceptance checklist. A host requiring custom browser logic fails the portability claim; a host-specific setup file is acceptable.

## Acceptance and stop rules

The Chrome-backed product may be called **cross-harness** when the same pinned server, task schema, and browser implementation pass in two real harnesses on supported OSes. It may be called **cross-platform** only after macOS, Linux, and Windows CI plus one manual smoke test per OS pass. It may be called **a replacement for the existing Codex skill** only after equivalent real-task success, safety, and end-to-end benefit are measured; otherwise retain both.

Stop or narrow scope if any of these persist after one targeted repair cycle:

- The host cannot launch/reach the server or preserve the required task authorization.
- The browser cannot safely bind a selected page and origin through an entire action.
- Snapshot/UID behavior cannot support the task set without routine arbitrary script or coordinate fallbacks.
- Common tasks repeatedly hand off, fail verification, or cost more time than the host-only baseline.
- Security review finds that selected-profile access, logs, or result fields expose data outside the host-approved task.

## Development workflow

Use a **single vertical-slice implementer by default**. The same owner may inspect, design the smallest change, write focused tests, implement, run them, and repair failures without handing work to a fresh agent at each step. Keep a short record of changed paths, observed test results, and unresolved risks. The numbered slices above are a capability checklist, not a mandated Superpowers subagent-driven workflow.

Development loop:

1. Choose the smallest user-visible path that can run against the local fixture. Establish its expected result and relevant safety checks.
2. Write a focused failing test when changing behavior; implement the minimum path; rerun that test and nearby regressions. Run `npm test` when integrating slices and before declaring a milestone complete.
3. Continue through adjacent tightly coupled work—Chrome session, decision loop, and MCP handler—under one owner. Avoid intermediate review cycles that cannot evaluate a working end-to-end path.
4. Request **one independent review** when the first complete vertical path works, focused on page/origin binding, stale UID handling, process cleanup, and public-result privacy. Repeat review only after material changes to those risks or before release; repair specific findings and rerun affected tests.
5. Run the fixture E2E and cross-harness acceptance checks before claiming portability. Run multi-OS CI and manual OS smoke checks before claiming cross-platform support. Preserve the existing Codex path until replacement criteria pass.

Optional parallel help should be bounded and genuinely independent—for example, read-only documentation research or a review while the owner runs tests. Do not dispatch parallel implementers into the coupled session/loop/server path, require a fresh agent per microtask, or mandate two-stage review for every change. If no independent reviewer is available during iteration, continue with automated checks and record the pending review; do not claim the release or safety gate passed.

The non-negotiable quality gates are executable policy tests before browser actions, a passing full regression suite and local fixture E2E before integration, independent security-focused review before release, and the acceptance evidence required for any cross-harness, cross-platform, or replacement claim. Record model calls, retries, and engineering time when available, but do not optimize model routing before runtime correctness.

### Budget-aware model routing and failure escalation

The cheapest default is **no extra model call**: keep the current owner and use local tests, logs, and fixture runs first. Do not switch the primary owner's model mid-slice just to follow this table. Delegate only a bounded task whose answer will change the next action, and stop after that answer. Record actual usage before claiming savings.

| Work | Default | When to change |
| --- | --- | --- |
| Routine implementation, fixtures, documentation, and first repair | Current owner; no subagent | Use focused tests and local evidence. Keep one owner across session, loop, and server. |
| Independent, bounded mechanical check that would unblock the owner | GPT-6 Luna, low | Only when parallel work saves wall time; give a narrow question and output limit. Use Luna/high for light research, per the project's separate preference. |
| Repeated failure after a reproduced, targeted repair | Current owner first; optional GPT-6 Luna, medium diagnosis | Send only the failing command, observed/expected result, relevant logs, and competing hypotheses. The owner retains edits. |
| Required security-focused review of the working path | GPT-6 Luna, medium, one pass | Review page/origin binding, stale targets, cleanup, and public-result privacy before release. Use high only for a concrete unresolved finding; repeat review only if those risks materially change. |
| Architectural or security impasse that still changes the project decision | Ask before a stronger-model escalation | Do not automatically invoke Sol or Astra. State the unresolved decision, evidence, and expected benefit of escalation. |

On the first failure, classify it as product code, test/fixture, environment, or unclear. The owner reproduces it, makes one targeted repair, and reruns the relevant test. If it repeats, inspect the evidence locally before deciding whether a bounded diagnostic agent adds value; do not create an automatic escalation chain. An environment failure gets an environment check, not a model upgrade. A wrong-page/origin action, unauthorized action, or data leak stops browser execution immediately and blocks the gate until fixed and independently reviewed; do not retry through it. If an assumption remains false after diagnosis, narrow or stop that capability rather than cycling through stronger models.

Do not change production code, publish a package, or replace the Codex skill merely because this plan is approved. Those are later execution decisions.

## Evidence and sources

- [Chrome DevTools MCP tool reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md): page IDs, snapshots, UIDs, actions, and no dedicated scroll tool in the current reference.
- [Chrome DevTools MCP advanced usage](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md): dedicated profile, existing-Chrome connection, selected-profile scope, and debugging-port warning.
- [Local process-boundary probe](../../work/chrome-devtools-mcp-probe/VERDICT.md): limited fixture evidence for page identity, UID click, removed-element stale UID, and focused nested scroll.
- [Backend assessment](../research/browser-mcp-chrome-devtools.md) and [feasibility assessment](../research/jev-project-feasibility-2026.md): documented versus unverified behavior and the reason to reject speculative browser portability.
