import { spawn, execFileSync } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_CANDIDATES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome',
].filter(Boolean);

function resolveChrome() {
  if (process.env.E2E_CHROME) {
    try {
      accessSync(process.env.E2E_CHROME, fsConstants.X_OK);
      return process.env.E2E_CHROME;
    } catch {
      throw new Error(`chromium harness failed: E2E_CHROME is not executable (${process.env.E2E_CHROME})`);
    }
  }
  for (const candidate of CHROME_CANDIDATES) {
    try {
      if (candidate.startsWith('/')) {
        accessSync(candidate, fsConstants.X_OK);
        return candidate;
      }
      const resolved = execFileSync('which', [candidate], { encoding: 'utf8' }).trim();
      if (resolved) return resolved;
    } catch {
      /* try next */
    }
  }
  throw new Error('chromium harness failed: no chrome/chromium binary');
}

function waitForDevtools(proc, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += String(chunk);
      const match = buf.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/[^\s]+)/);
      if (match) {
        cleanup();
        resolve({ browserWs: match[1], port: Number(match[2]) });
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`chromium DevTools not ready: ${buf.slice(-500)}`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      proc.stderr?.off('data', onData);
    };
    proc.stderr.on('data', onData);
  });
}

async function jsonList(port, attempts = 20) {
  let last = 'empty';
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await response.json();
      const page = list.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
      if (page) return page;
      last = JSON.stringify(list);
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`chromium harness failed: no page target (${last})`);
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let nextId = 0;
    const pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id != null && pending.has(message.id)) {
        const { resolve: ok, reject: fail } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) fail(new Error(message.error.message ?? 'CDP error'));
        else ok(message.result);
      }
    });
    ws.addEventListener('open', () => {
      resolve({
        call(method, params = {}) {
          const id = ++nextId;
          return new Promise((ok, fail) => {
            pending.set(id, { resolve: ok, reject: fail });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          try { ws.close(); } catch { /* ignore */ }
        },
      });
    });
    ws.addEventListener('error', () => reject(new Error('chromium harness failed: CDP websocket error')));
  });
}

const DUMP_AX = `(() => {
  const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'META', 'LINK', 'HTML', 'BODY', 'CANVAS']);
  document.querySelectorAll('[data-e2e-ax]').forEach((el) => el.removeAttribute('data-e2e-ax'));
  const items = [];
  for (const el of document.querySelectorAll('button, a, p, h1, h2, h3, h4, div, span, input, textarea, [role]')) {
    if (skip.has(el.tagName)) continue;
    if (el.hidden || el.hasAttribute('hidden')) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) continue;
    const name = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().split('\\n')[0].trim();
    if (!name) continue;
    let role = 'text';
    const tag = el.tagName;
    if (tag === 'BUTTON' || el.getAttribute('role') === 'button') role = 'button';
    else if (tag === 'A' || el.getAttribute('role') === 'link') role = 'link';
    else if (tag === 'INPUT' && /checkbox/i.test(el.type)) role = 'checkBox';
    else if (tag === 'TEXTAREA') role = 'text area';
    else if (tag === 'INPUT') role = 'text field';
    items.push({ el, role, name });
  }
  return items.map((item, i) => {
    item.el.setAttribute('data-e2e-ax', String(i + 1));
    return { index: i + 1, role: item.role, name: item.name };
  });
})()`;

export async function createChromiumTab({ url, chromePath = resolveChrome() }) {
  const userDataDir = await mkdtemp(join(tmpdir(), 'jev-e2e-chrome-'));
  const proc = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-background-networking',
    '--metrics-recording-only',
    '--mute-audio',
    '--window-size=800,600',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let closed = false;
  const kill = () => {
    if (closed) return;
    closed = true;
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
  };
  proc.on('exit', () => { closed = true; });
  let cdp;
  try {
    const { port } = await waitForDevtools(proc);
    const page = await jsonList(port);
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: 800,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.call('Page.navigate', { url });
    for (let i = 0; i < 40; i++) {
      const ready = await cdp.call('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      });
      if (ready?.result?.value === 'complete') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } catch (error) {
    kill();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    throw error instanceof Error ? error : new Error(String(error));
  }

  async function evaluate(expression) {
    const result = await cdp.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? 'evaluate failed');
    }
    return result?.result?.value;
  }

  const clicks = [];
  const scrolls = [];

  const tab = {
    clicks,
    scrolls,
    async getAXState() {
      const nodes = await evaluate(DUMP_AX) ?? [];
      const body = nodes.map((node) => `${node.index} ${node.role} ${node.name}`).join('\n');
      const snapshot = `Browser tab: Fixture URL: "${url}".\n${body}`;
      await evaluate('window.__mutateAfterAx && window.__mutateAfterAx()');
      return snapshot;
    },
    async click(index) {
      clicks.push({ index });
      const ok = await evaluate(`(() => {
        const el = document.querySelector('[data-e2e-ax="${Number(index)}"]');
        if (!el) return false;
        el.click();
        return true;
      })()`);
      if (!ok) throw new Error(`no element at index ${index}`);
    },
    async scroll() {
      scrolls.push({ at: Date.now() });
      await evaluate('window.scrollBy(0, window.innerHeight)');
    },
    async pressKey(key) {
      if (key === 'PageDown' || key === 'PageUp') {
        scrolls.push({ key });
        await evaluate(`window.scrollBy(0, ${key === 'PageDown' ? 'window.innerHeight' : '-window.innerHeight'})`);
      }
    },
    async reload() {
      await cdp.call('Page.reload');
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
  };

  async function stop() {
    try { cdp?.close(); } catch { /* ignore */ }
    if (!closed) {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      await Promise.race([
        new Promise((resolve) => proc.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 400)),
      ]);
      kill();
    }
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }

  return { tab, stop, kill, pid: proc.pid, backend: 'chromium-harness' };
}
