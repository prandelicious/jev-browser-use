# Isolated Chrome DevTools MCP install (Jev browser-use)

This guide installs the **pinned** Chrome DevTools MCP child used by `jev-browser-use` in **owned isolated** mode. It matches `src/contract.mjs` (slice 0 pin). Do not use `@latest` for the browser MCP package.

## Requirements

- **Bun 1.4.x** (repo default) or Node **22+** (required by `chrome-devtools-mcp@1.9.0` engines)
- **Google Chrome** current stable or newer
- Network egress to install npm packages (first install only)

## Pin (frozen)

| Field | Value |
| --- | --- |
| Package | `chrome-devtools-mcp` |
| Version | **1.9.0** |
| Spec | `chrome-devtools-mcp@1.9.0` |
| Launch command | `npx chrome-devtools-mcp@1.9.0 --isolated --headless --no-usage-statistics` |

The repo lockfile also pins `chrome-devtools-mcp` **1.9.0** in `package.json` / `bun.lock`.

## Install (cloud agent or second MCP host)

From a clone of this repository:

```sh
bun install
```

That installs `chrome-devtools-mcp@1.9.0` and `@modelcontextprotocol/sdk` locally. The Jev MCP server is started with:

```sh
bun src/mcp/server.mjs
```

Hosts connect over **stdio** and call the `run_browser_task` tool (see `src/contract.mjs` for request fields and statuses). The host must supply task authorization, origins, and a decision provider wired by the host; the stock server entry expects host-side decision configuration in integrated deployments.

## Isolated profile behavior

- `--isolated` — dedicated temporary profile owned by the MCP child (default for tests and first release).
- `--headless` — headless Chrome for VM/cloud agents.
- `--no-usage-statistics` — disables usage statistics in the pinned package.

These flags are the **default** launch argv recorded in `CHROME_DEVTOOLS_MCP_PIN.launchArgv` in `src/contract.mjs`.

## Experimental: `--autoConnect` (disabled)

Connecting to an existing Chrome profile via `--autoConnect` is **experimental** and **not** enabled in this product path. It stays **off** until separate consent and selected-profile scope tests pass. Do not document or script `--autoConnect` as a default install step.

Requirements if you experiment later (upstream CLI): Chrome **144+**, explicit user consent, and profile-scope review. Until then, use **isolated** launch only.

## Out of scope for this install path

Do **not** use these as substitutes for the pinned isolated server:

- `npx chrome-devtools-mcp@latest` (unpinned)
- GUI **Computer Use** desktop Chrome as the Jev browser backend
- `mcp__cua_repl.js` or other Codex CUA REPL bridges for the Chrome DevTools MCP path

The existing Codex skill path remains separate; this document covers the standalone MCP + isolated Chrome DevTools MCP stack only.

## Verify in this repository

```sh
bun test test/harness-1-mcp-cloud.test.mjs
bun test test/chrome-e2e.test.mjs
```

Harness 1 uses the loopback fixture under `test/fixtures/e2e/` (not a live site).
