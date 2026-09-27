# Agent instructions

## JavaScript runtime

Use **Bun 1.4.x** (not Node `@latest`, and not Bun 1.5+) as the default JavaScript runtime for this repository.

- Install dependencies: `bun install`
- Run tests: `bun test`

Node 22+ remains declared in `package.json` `engines` for compatibility with `chrome-devtools-mcp@1.9.0`, but agents should prefer Bun for day-to-day commands on this repo.
