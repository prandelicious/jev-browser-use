import { spawn, execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { CHROME_DEVTOOLS_MCP_PIN } from '../../src/contract.mjs';

export function snapshotText(snapshotResult) {
  const text = snapshotResult?.snapshot ?? snapshotResult?.raw ?? snapshotResult;
  if (typeof text !== 'string') {
    throw new TypeError('Expected snapshot text');
  }
  return text;
}

export function findElementUid(snapshot, { role, nameIncludes }) {
  const pattern = new RegExp(`uid=([^\\s]+)\\s+${role}\\s+"([^"]+)"`, 'i');
  for (const line of snapshot.split('\n')) {
    const match = line.match(pattern);
    if (!match) continue;
    if (nameIncludes && !match[2].includes(nameIncludes)) continue;
    return match[1];
  }
  return null;
}

export function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function detectChromeVersion() {
  const candidates = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const binary of candidates) {
    try {
      return execSync(`${binary} --version`, { encoding: 'utf8' }).trim();
    } catch {
      // try next binary
    }
  }
  return 'chrome absent';
}

export async function recordIsolatedChromeVersions() {
  const pkg = await readFile(new URL('../../package.json', import.meta.url), 'utf8').then((raw) =>
    JSON.parse(raw),
  );
  return {
    recordedOn: 'linux-cursor-cloud-agent',
    platform: process.platform,
    bunVersion: process.versions.bun,
    nodeVersion: process.version,
    chrome: detectChromeVersion(),
    chromeDevtoolsMcp: CHROME_DEVTOOLS_MCP_PIN.spec,
    mcpSdk: pkg.dependencies['@modelcontextprotocol/sdk'],
    profileParentDir: tmpdir(),
  };
}

export function spawnDecoyProcess() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: false,
    stdio: 'ignore',
  });
}

/** Navigate the default tab before a page is bound through the action layer. */
export async function navigateDefaultTab(session, url) {
  await session.callTool('navigate_page', { pageId: 1, url });
}
