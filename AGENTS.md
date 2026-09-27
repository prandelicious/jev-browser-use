# Agent instructions

## JavaScript runtime

Use **Bun 1.4.x** (not Node `@latest`, and not Bun 1.5+) as the default JavaScript runtime for this repository.

- Install dependencies: `bun install`
- Run tests: `bun test`

Node 22+ remains declared in `package.json` `engines` for compatibility with `chrome-devtools-mcp@1.9.0`, but agents should prefer Bun for day-to-day commands on this repo.

## Chrome for the e2e suite

`test/chrome-e2e.test.mjs` launches Chrome through `chrome-devtools-mcp`, which by default expects the stable channel at its standard install path. Where Chrome lives elsewhere, point at it:

```sh
CHROME_PATH=/path/to/chrome bun test
```
