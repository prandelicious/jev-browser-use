import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const SUITE_DEFS = {
  gate: ['basic-click', 'scroll-find', 'multi-action', 'handoff', 'stale-state', 'action-budget', 'cancellation'],
  core: ['basic-click', 'scroll-find', 'multi-action', 'handoff', 'stale-state', 'action-budget', 'cancellation'],
  adapter: ['basic-click', 'scroll-find', 'multi-action', 'stale-state', 'cancellation'],
  cancellation: ['cancellation'],
  cli: [],
  mcp: [],
  release: ['basic-click'],
  'live-smoke': [],
  full: ['basic-click', 'scroll-find', 'multi-action', 'handoff', 'stale-state', 'action-budget', 'cancellation'],
};

const RULES = [
  { match: /^skills\/jev-browser-use\//, suites: ['core', 'gate'] },
  { match: /^skills\/jev-browser-e2e\//, suites: ['gate'] },
  { match: /^tests\/e2e\//, suites: ['gate'] },
  { match: /^test\//, suites: ['gate'] },
  { match: /^(package\.json|bun\.lock|tsconfig\.json)$/, suites: ['gate', 'release'] },
];

const DOC_ONLY = /\.(md|svg|png)$/i;

export function selectSuitesFromPaths(changedPaths) {
  const reasons = [];
  const selected = new Set();
  const production = changedPaths.filter((path) => !DOC_ONLY.test(path) && !path.startsWith('docs/'));
  if (!changedPaths.length) {
    return { selectedSuites: ['gate'], reasons: [{ rule: 'empty-change-set', suites: ['gate'] }] };
  }
  if (!production.length) {
    return { selectedSuites: [], reasons: [{ rule: 'docs-only', suites: [] }] };
  }
  for (const path of production) {
    const hits = RULES.filter((rule) => rule.match.test(path));
    if (!hits.length) {
      selected.add('gate');
      reasons.push({ rule: 'unknown-production', path, suites: ['gate'] });
      continue;
    }
    for (const hit of hits) {
      for (const suite of hit.suites) selected.add(suite);
      reasons.push({ rule: String(hit.match), path, suites: hit.suites });
    }
  }
  return { selectedSuites: [...selected], reasons };
}

export async function changedPathsSince(base, cwd = process.cwd()) {
  if (!base) return [];
  const { stdout } = await execFileAsync('git', ['diff', '--name-only', base], { cwd });
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

export function scenariosForSuites(suites) {
  const ids = new Set();
  for (const suite of suites) {
    for (const id of SUITE_DEFS[suite] ?? []) ids.add(id);
  }
  return [...ids];
}
