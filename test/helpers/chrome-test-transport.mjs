import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PEER_SCRIPT = join(__dirname, 'scripted-chrome-mcp-peer.mjs');

/** Spawn the scripted Chrome DevTools MCP peer for tests only. */
export function testPeerTransport(scenario, extraEnv = {}) {
  return {
    command: process.execPath,
    args: [PEER_SCRIPT, scenario],
    env: {
      ...process.env,
      ...extraEnv,
    },
  };
}
