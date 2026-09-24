import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CHROME_DEVTOOLS_MCP_PIN, assertPinIsExact } from '../contract.mjs';

const require = createRequire(import.meta.url);

export class ChromeSessionError extends Error {
  constructor(message, { code = 'error', cause } = {}) {
    super(message, { cause });
    this.name = 'ChromeSessionError';
    this.code = code;
  }
}

function resolveChromeDevtoolsLaunch() {
  assertPinIsExact();
  let binaryPath;
  try {
    binaryPath = require.resolve('chrome-devtools-mcp/package.json');
  } catch {
    binaryPath = null;
  }
  const bin =
    binaryPath
      ? join(dirname(binaryPath), 'build/src/index.js')
      : null;
  if (binaryPath) {
    const binEntry = join(dirname(binaryPath), 'build/src/bin/chrome-devtools-mcp.js');
    return {
      command: process.execPath,
      args: [binEntry, '--isolated', '--headless', '--no-usage-statistics'],
    };
  }
  return {
    command: 'npx',
    args: [...CHROME_DEVTOOLS_MCP_PIN.launchArgv.slice(1)],
  };
}

function collectStderr(transport) {
  const chunks = [];
  const stream = transport.stderr;
  if (!stream) return { chunks, detach: () => {} };
  const onData = (chunk) => {
    chunks.push(chunk.toString('utf8'));
  };
  stream.on('data', onData);
  return {
    chunks,
    detach: () => stream.off('data', onData),
    text: () => chunks.join(''),
  };
}

function parseToolJson(result) {
  const textBlock = result?.content?.find((entry) => entry.type === 'text');
  if (!textBlock?.text) {
    throw new ChromeSessionError('Chrome DevTools MCP returned an empty tool response', {
      code: 'tool_error',
    });
  }
  try {
    return JSON.parse(textBlock.text);
  } catch {
    return { raw: textBlock.text };
  }
}

/**
 * Owns one Chrome DevTools MCP child over stdio and tracks page binding state.
 */
export class ChromeDevtoolsSession {
  constructor({
    allowedOrigins = [],
    startupTimeoutMs = 15_000,
    requestTimeoutMs = 10_000,
    transportOptions = null,
    profileParentDir = tmpdir(),
  } = {}) {
    this.allowedOrigins = allowedOrigins;
    this.startupTimeoutMs = startupTimeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.transportOptions = transportOptions;
    this.profileParentDir = profileParentDir;
    this.#resetRuntimeState();
  }

  #resetRuntimeState() {
    this.client = null;
    this.transport = null;
    this.ownedChildPid = null;
    this.ownedProfileDir = null;
    this.boundPage = null;
    this.callJournal = [];
    this.stderrText = '';
    this.#stderrCollector = null;
  }

  #stderrCollector = null;

  get binding() {
    return this.boundPage;
  }

  isRunning() {
    return Boolean(this.transport?.pid);
  }

  async start() {
    if (this.isRunning()) return;
    this.#resetRuntimeState();
    this.ownedProfileDir = await mkdtemp(join(this.profileParentDir, 'jev-chrome-profile-'));
    const spawnSpec = this.transportOptions ?? resolveChromeDevtoolsLaunch();
    const transport = new StdioClientTransport({
      ...spawnSpec,
      stderr: 'pipe',
      env: {
        ...process.env,
        JEV_OWNED_PROFILE_DIR: this.ownedProfileDir,
      },
    });
    this.#stderrCollector = collectStderr(transport);
    const client = new Client({ name: 'jev-browser-use', version: '0.0.0' });
    const startupTimer = AbortSignal.timeout(this.startupTimeoutMs);
    try {
      await client.connect(transport, { signal: startupTimer });
    } catch (error) {
      this.stderrText = this.#stderrCollector.text();
      await this.stop().catch(() => {});
      if (error?.name === 'TimeoutError') {
        throw new ChromeSessionError('Chrome DevTools MCP startup timed out', {
          code: 'timeout',
          cause: error,
        });
      }
      throw new ChromeSessionError('Chrome DevTools MCP failed to start', {
        code: 'error',
        cause: error,
      });
    }
    this.client = client;
    this.transport = transport;
    this.ownedChildPid = transport._process?.pid ?? null;
    this.stderrText = this.#stderrCollector.text();
  }

  async stop() {
    const pid = this.ownedChildPid;
    try {
      await this.client?.close();
    } catch {
      // ignore close errors while tearing down
    }
    try {
      await this.transport?.close?.();
    } catch {
      // ignore
    }
    if (this.ownedProfileDir) {
      await rm(this.ownedProfileDir, { recursive: true, force: true }).catch(() => {});
    }
    this.#stderrCollector?.detach?.();
    this.#resetRuntimeState();
    return { ownedChildPid: pid };
  }

  async reconnect() {
    await this.stop();
    await this.start();
  }

  async listPages() {
    const result = await this.#callTool('list_pages', {});
    const pages = Array.isArray(result?.pages) ? result.pages : result;
    if (!Array.isArray(pages)) {
      throw new ChromeSessionError('list_pages returned an unexpected shape', { code: 'tool_error' });
    }
    return pages;
  }

  async bindPage(pageId, allowedOrigins = this.allowedOrigins) {
    const pages = await this.listPages();
    const page = pages.find((entry) => entry.pageId === pageId);
    if (!page) {
      throw new ChromeSessionError(`Unknown pageId: ${pageId}`, { code: 'wrong_page' });
    }
    const origin = originFromUrl(page.url);
    if (!origin || !allowedOrigins.includes(origin)) {
      throw new ChromeSessionError('Browser left authorized origins', { code: 'wrong_origin' });
    }
    await this.#callTool('select_page', { pageId });
    this.boundPage = { pageId, url: page.url, origin };
    return this.boundPage;
  }

  clearBinding() {
    this.boundPage = null;
  }

  async refreshBinding(allowedOrigins = this.allowedOrigins) {
    if (!this.boundPage) {
      throw new ChromeSessionError('No page is bound', { code: 'unbound' });
    }
    const pages = await this.listPages();
    const page = pages.find((entry) => entry.pageId === this.boundPage.pageId);
    if (!page) {
      this.clearBinding();
      throw new ChromeSessionError('Bound page is no longer available', { code: 'page_closed' });
    }
    const origin = originFromUrl(page.url);
    if (!origin || !allowedOrigins.includes(origin)) {
      this.clearBinding();
      throw new ChromeSessionError('Browser left authorized origins', { code: 'wrong_origin' });
    }
    this.boundPage = { pageId: page.pageId, url: page.url, origin };
    return this.boundPage;
  }

  async callTool(name, args = {}, { requireBinding = false, allowedOrigins = this.allowedOrigins } = {}) {
    if (requireBinding) {
      if (!this.boundPage) {
        throw new ChromeSessionError('No page is bound', { code: 'unbound' });
      }
      await this.refreshBinding(allowedOrigins);
      args = { ...args, pageId: this.boundPage.pageId };
    }
    return this.#callTool(name, args);
  }

  async #callTool(name, args) {
    if (!this.client) {
      throw new ChromeSessionError('Chrome DevTools MCP session is not started', { code: 'error' });
    }
    const signal = AbortSignal.timeout(this.requestTimeoutMs);
    try {
      const result = await this.client.callTool({ name, arguments: args }, undefined, { signal });
      this.callJournal.push({ name, arguments: args });
      if (result?.isError) {
        throw new ChromeSessionError(
          result.content?.map((entry) => entry.text).join(' ') || 'Chrome DevTools MCP tool error',
          { code: 'tool_error' },
        );
      }
      return parseToolJson(result);
    } catch (error) {
      if (error?.name === 'TimeoutError') {
        throw new ChromeSessionError(`Chrome DevTools MCP tool timed out: ${name}`, {
          code: 'timeout',
          cause: error,
        });
      }
      throw error;
    }
  }
}

export function originFromUrl(urlString) {
  try {
    return new URL(urlString).origin;
  } catch {
    return null;
  }
}
