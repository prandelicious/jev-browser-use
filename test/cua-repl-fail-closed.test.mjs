import test from 'node:test';
import assert from 'node:assert/strict';
import { attachTab, run, createSession } from '../skills/jev-browser-use/bridge.mjs';

function tabSurface() {
  return {
    async getAXState() {
      return 'Browser tab: Test (origin https://example.com).\n1 tab Rooms';
    },
    async click() {},
    async scroll() {},
    async pressKey() {},
    async reload() {},
  };
}

function playwrightPageDuck() {
  const tab = tabSurface();
  Object.defineProperty(tab, 'constructor', { value: { name: 'Page' } });
  return tab;
}

function playwrightContextDuck() {
  const tab = tabSurface();
  Object.defineProperty(tab, 'constructor', { value: { name: 'BrowserContext' } });
  return tab;
}

function webViewDuck() {
  const tab = tabSurface();
  Object.defineProperty(tab, 'constructor', { value: { name: 'WebView' } });
  tab.__jevTestWebView = true;
  return tab;
}

function cdpRuntimeDuck() {
  const tab = tabSurface();
  Object.defineProperty(tab, 'constructor', { value: { name: 'Runtime' } });
  return tab;
}

function cdpTargetDuck() {
  const tab = tabSurface();
  Object.defineProperty(tab, 'constructor', { value: { name: 'Target' } });
  return tab;
}

function cdpConnectDuck() {
  return { ...tabSurface(), connectOverCDP: async () => {} };
}

function sneakInWithDeclaredTools() {
  const tab = playwrightPageDuck();
  tab.declaredTools = ['mcp__cua_repl.js'];
  return tab;
}

function minimalRunOptions() {
  return {
    goal: 'noop',
    controls: [{ op: 'click', name: 'Rooms' }],
    allowedOrigins: ['https://example.com'],
    envFile: '/nonexistent/jev.env',
    maxSteps: 1,
    maxMs: 1000,
  };
}

function expectUnsupportedHost(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof Error);
    return true;
  });
}

test('attachTab refuses Playwright-style page duck', () => {
  expectUnsupportedHost(() => attachTab(playwrightPageDuck()));
});

test('attachTab refuses Playwright-style context duck', () => {
  expectUnsupportedHost(() => attachTab(playwrightContextDuck()));
});

test('attachTab refuses WebView-style duck', () => {
  expectUnsupportedHost(() => attachTab(webViewDuck()));
});

test('attachTab refuses CDP Runtime duck', () => {
  expectUnsupportedHost(() => attachTab(cdpRuntimeDuck()));
});

test('attachTab refuses CDP Target duck', () => {
  expectUnsupportedHost(() => attachTab(cdpTargetDuck()));
});

test('attachTab refuses connectOverCDP duck', () => {
  expectUnsupportedHost(() => attachTab(cdpConnectDuck()));
});

test('attachTab refuses sneak-in even when object carries a fake declaredTools array', () => {
  expectUnsupportedHost(() => attachTab(sneakInWithDeclaredTools()));
});

test('attachTab refuses empty object stub', () => {
  expectUnsupportedHost(() => attachTab({}));
});

test('attachTab refuses stub with no tab surface', () => {
  expectUnsupportedHost(() => attachTab({ declaredTools: ['mcp__cua_repl.js'], onlyMetadata: true }));
});

test('failed attachTab leaves run refusing the same tab surface', async () => {
  const tab = tabSurface();
  expectUnsupportedHost(() => attachTab({}));
  await assert.rejects(() => run(tab, minimalRunOptions()));
});

test('run refuses tab that never went through attachTab', async () => {
  await assert.rejects(() => run(tabSurface(), minimalRunOptions()));
});

test('createSession run refuses tab that never went through attachTab', () => {
  expectUnsupportedHost(() => createSession(tabSurface(), {
    allowedOrigins: ['https://example.com'],
    envFile: '/nonexistent/jev.env',
  }));
});
