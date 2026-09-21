import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachTab, run } from '../../skills/jev-browser-use/bridge.mjs';
import { createFixtureTab } from './tab.mjs';
import { startJevMock } from './jev/mock-server.mjs';

async function envFor(mockUrl) {
  const dir = await mkdtemp(join(tmpdir(), 'jev-e2e-'));
  const path = join(dir, 'jev.env');
  await writeFile(path, `TYPESAFE_API_KEY=test-key\nJEV_API_ENDPOINT=${mockUrl}\n`);
  return path;
}

function fail(assertion, expected, actual) {
  return { status: 'FAIL', failures: [{ scenario: '', assertion, expected, actual }] };
}

function pass(details) {
  return { status: 'PASS', failures: [], ...details };
}

const pages = {
  'basic-click': 'basic-click.html',
  'scroll-find': 'scroll-find.html',
  'multi-action': 'multi-action.html',
  handoff: 'handoff.html',
  'stale-state': 'stale-state.html',
  'action-budget': 'action-budget.html',
  cancellation: 'cancellation.html',
};

export const SCENARIOS = {
  'basic-click': {
    page: pages['basic-click'],
    sequence: [
      '1 button Open details',
      '1 button Open details\n2 text DETAILS_OPEN',
    ],
    script: [
      { step: 0, includes: 'Open details', choice: 'a0' },
      { step: 1, includes: 'DETAILS_OPEN', choice: 'DONE' },
    ],
    task: (origin) => ({
      goal: 'Open details',
      controls: [{ op: 'click', name: 'Open details' }],
      allowedOrigins: [origin],
      maxSteps: 3,
    }),
    assert(outcome, tab, mock) {
      if (mock.unexpected) return fail('unexpected Jev call', 'scripted observations only', mock.unexpected);
      if (!tab.clicks.length) return fail('Jev selects button → browser acts', 'click executed', 'no click');
      if (!outcome.state.includes('DETAILS_OPEN')) return fail('page enters known success state', 'DETAILS_OPEN', outcome.state);
      if (!['needs_verification', 'step_limit'].includes(outcome.status)) {
        return fail('completed verification handoff', 'needs_verification', outcome.status);
      }
      return pass({ applicationStatus: outcome.status, browserActions: tab.clicks.length });
    },
  },
  'scroll-find': {
    page: pages['scroll-find'],
    sequence: [
      '1 text padding',
      '1 text padding\n2 button Show more',
      '1 text padding\n2 button Show more\n3 text SCROLLED_FOUND',
    ],
    script: [
      { step: 0, excludes: 'Show more', choice: 'a0' },
      { step: 1, includes: 'Show more', choice: 'a1' },
      { step: 2, includes: 'SCROLLED_FOUND', choice: 'DONE' },
    ],
    task: (origin) => ({
      goal: 'Show more',
      controls: [{ op: 'scroll', direction: 'down' }, { op: 'click', name: 'Show more' }],
      allowedOrigins: [origin],
      maxSteps: 4,
    }),
    assert(outcome, tab, mock) {
      if (mock.unexpected) return fail('unexpected Jev call', 'scripted observations only', mock.unexpected);
      if (!tab.scrolls.length) return fail('scroll then click', 'scroll executed', 'no scroll');
      if (!tab.clicks.length) return fail('target becomes available then click', 'click executed', 'no click');
      if (!outcome.state.includes('SCROLLED_FOUND')) return fail('known final state', 'SCROLLED_FOUND', outcome.state);
      return pass({ applicationStatus: outcome.status, browserActions: tab.clicks.length + tab.scrolls.length });
    },
  },
  'multi-action': {
    page: pages['multi-action'],
    sequence: [
      '1 button Open section',
      '1 button Open section\n2 button Next',
      '1 button Open section\n2 button Next\n3 button Select target',
      '1 button Open section\n2 button Next\n3 button Select target\n4 text MULTI_DONE',
    ],
    script: [
      { step: 0, includes: 'Open section', choice: 'a0' },
      { step: 1, includes: 'Next', choice: 'a1' },
      { step: 2, includes: 'Select target', choice: 'a2' },
      { step: 3, includes: 'MULTI_DONE', choice: 'DONE' },
    ],
    task: (origin) => ({
      goal: 'Complete the section',
      controls: [
        { op: 'click', name: 'Open section' },
        { op: 'click', name: 'Next' },
        { op: 'click', name: 'Select target' },
      ],
      allowedOrigins: [origin],
      maxSteps: 6,
    }),
    assert(outcome, tab, mock) {
      if (mock.unexpected) return fail('unexpected Jev call', 'scripted observations only', mock.unexpected);
      if (tab.clicks.length !== 3) return fail('three mechanical clicks', 3, tab.clicks.length);
      if (!outcome.state.includes('MULTI_DONE')) return fail('completion marker', 'MULTI_DONE', outcome.state);
      return pass({ applicationStatus: outcome.status, browserActions: tab.clicks.length });
    },
  },
  handoff: {
    page: pages.handoff,
    sequence: ['1 text HANDOFF_ONLY'],
    script: [{ step: 0, includes: 'HANDOFF_ONLY', choice: 'BLOCKED' }],
    task: (origin) => ({
      goal: 'Use the unsupported visual widget',
      controls: [{ op: 'click', name: 'Nonexistent' }],
      allowedOrigins: [origin],
      maxSteps: 2,
    }),
    assert(outcome, tab, mock) {
      if (mock.unexpected) return fail('unexpected Jev call', 'scripted observations only', mock.unexpected);
      if (tab.clicks.length) return fail('unsupported action is never sent to adapter', 0, tab.clicks.length);
      if (outcome.status !== 'blocked') return fail('status = handoff/blocked', 'blocked', outcome.status);
      return pass({ applicationStatus: outcome.status, browserActions: 0 });
    },
  },
  'stale-state': {
    page: pages['stale-state'],
    sequence: [
      '1 button Commit',
      '1 button Commit\n2 text mutated-v2',
    ],
    staleAfterReads: 1,
    script: [
      { step: 0, includes: 'Commit', excludes: 'mutated-v2', choice: 'a0' },
      { step: 1, includes: 'mutated-v2', choice: 'DONE' },
    ],
    task: (origin) => ({
      goal: 'Commit',
      controls: [{ op: 'click', name: 'Commit' }],
      allowedOrigins: [origin],
      maxSteps: 2,
    }),
    assert(outcome, tab, mock) {
      if (mock.unexpected) return fail('unexpected Jev call', 'scripted observations only', mock.unexpected);
      if (tab.clicks.length) return fail('stale action must not execute', 0, tab.clicks.length);
      const stale = outcome.history.some((item) => item.reason === 'stale_state');
      if (!stale) return fail('stale_action_rejection recorded', 'stale_state', outcome.history);
      return pass({ applicationStatus: outcome.status, browserActions: 0, staleRejections: 1 });
    },
  },
  'action-budget': {
    page: pages['action-budget'],
    sequence: [
      '1 button Step one',
      '1 button Step one\n2 button Step two',
      '1 button Step one\n2 button Step two\n3 button Step three',
      '1 button Step one\n2 button Step two\n3 button Step three\n4 text BUDGET_COMPLETE',
    ],
    script: [
      { step: 0, includes: 'Step one', choice: 'a0' },
      { step: 1, includes: 'Step two', choice: 'a1' },
    ],
    task: (origin) => ({
      goal: 'Finish all three steps',
      controls: [
        { op: 'click', name: 'Step one' },
        { op: 'click', name: 'Step two' },
        { op: 'click', name: 'Step three' },
      ],
      allowedOrigins: [origin],
      maxSteps: 2,
    }),
    assert(outcome, tab) {
      if (outcome.status !== 'step_limit') return fail('status = budget_exhausted', 'step_limit', outcome.status);
      if (tab.clicks.length !== 2) return fail('browser action count = 2', 2, tab.clicks.length);
      if (tab.clicks.some((click) => click.index === 3)) return fail('no third action executes', 'no index 3', tab.clicks);
      if (outcome.state.includes('BUDGET_COMPLETE')) return fail('must not complete', 'absent BUDGET_COMPLETE', outcome.state);
      return pass({ applicationStatus: outcome.status, browserActions: tab.clicks.length });
    },
  },
  cancellation: {
    page: pages.cancellation,
    sequence: ['1 button Start wait'],
    abortBeforeRun: true,
    script: [{ step: 0, includes: 'Start wait', choice: 'WAIT' }],
    task: (origin) => ({
      goal: 'Start wait',
      controls: [{ op: 'click', name: 'Start wait' }],
      allowedOrigins: [origin],
      maxSteps: 3,
    }),
    assert(outcome, tab) {
      if (outcome.status !== 'cancelled') return fail('status = cancelled', 'cancelled', outcome.status);
      if (tab.clicks.length) return fail('no additional browser action occurs', 0, tab.clicks.length);
      return pass({ applicationStatus: outcome.status, browserActions: 0 });
    },
  },
};

export async function runScenario(id, { origin, processes }) {
  const spec = SCENARIOS[id];
  if (!spec) throw new Error(`Unknown scenario ${id}`);
  const tab = createFixtureTab({
    origin,
    page: spec.page,
    sequence: spec.sequence,
    staleAfterReads: spec.staleAfterReads,
  });
  const mock = await startJevMock({ scenarioId: id, script: spec.script });
  processes.track({ purpose: `jev-mock-${id}`, handle: mock, stop: mock.stop });
  const envFile = await envFor(mock.url);
  attachTab(tab);
  const controller = new AbortController();
  if (spec.abortBeforeRun) controller.abort();
  const task = {
    ...spec.task(origin),
    envFile,
    provider: 'typesafe',
    profileCacheEnabled: false,
    incrementalStateEnabled: false,
    signal: controller.signal,
    maxMs: 5000,
    decisionTimeoutMs: 2000,
    waitPollMs: 100,
  };
  const outcome = await run(tab, task);
  const result = spec.assert(outcome, tab, mock);
  result.failures = (result.failures ?? []).map((item) => ({ ...item, scenario: id }));
  return {
    id,
    status: result.status,
    durationMs: outcome.elapsedMs,
    applicationStatus: outcome.status,
    browserActions: (tab.clicks.length + tab.scrolls.length),
    staleRejections: result.staleRejections ?? 0,
    failures: result.failures,
  };
}
