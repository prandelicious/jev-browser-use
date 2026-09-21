---
name: jev-browser-e2e
description: Deterministic E2E gate for jev-browser-use. Invoke the runner; treat its JSON verdict as source of truth. Do not manually operate the browser.
---

# Jev Browser E2E

Use this skill when independently verifying implementation changes to jev-browser-use.

Default invocation:

```sh
node skills/jev-browser-e2e/run.mjs --changed-since <base> --json
```

Or:

```sh
node skills/jev-browser-e2e/run.mjs --suite gate --json
```

Treat the runner's structured verdict as the primary test result. stdout is JSON only when `--json` is set.

STATUS meanings:

- **PASS**: selected deterministic E2E suites passed.
- **FAIL**: product behavior violated at least one assertion.
- **INFRA_ERROR**: required test environment was unavailable.
- **RUNNER_ERROR**: the E2E test framework itself failed.

Do not manually substitute browser inspection for a failed deterministic test.
Do not modify production code during QA.
On FAIL, return the failed scenario and assertion to the orchestrator.
On INFRA_ERROR, report the missing prerequisite separately from a product failure.
Run live-smoke only when specifically required.
