import { normalizeAXState, selectEvidence } from './projection-core.mjs';

const DEFAULT_MAX_STATE_BYTES = 16_000;
const HIGH_RISK = /\b(?:book|reserve|select room|pay|purchase|confirm|complete reservation|reservation)\b/i;

export class DecisionStateBudgetError extends Error {
  constructor(message = 'Decision state mandatory shell exceeds budget') {
    super(message);
    this.name = 'DecisionStateBudgetError';
  }
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function clipped(value, maxChars) {
  return String(value ?? '').slice(0, maxChars);
}

function actionLabel(action) {
  if (typeof action?.description === 'string' && action.description) return action.description;
  if (action?.op === 'scroll') return `Scroll \${action.direction ?? 'down'}`;
  if (action?.op === 'press') return `Press \${action.key ?? ''}`;
  if (action?.op === 'reload') return 'Reload the current page';
  return action?.name ? `Click \${action.name}` : String(action?.op ?? 'Action');
}

function isSafeAction(action, denyNames = []) {
  const text = [action?.name, action?.description, actionLabel(action)].filter(Boolean).join(' ');
  return !HIGH_RISK.test(text) && !denyNames.some(pattern => {
    if (pattern instanceof RegExp) { pattern.lastIndex = 0; return pattern.test(text); }
    return typeof pattern === 'string' && text.includes(pattern);
  });
}

function compactHistory(history, maxItemChars) {
  return (Array.isArray(history) ? history : []).map(item => ({
    choice: clipped(item?.choice, 64),
    outcome: item?.executed ? 'executed' : clipped(item?.reason ?? item?.outcome ?? 'observed', 64),
    ...(item?.action ? {label: clipped(typeof item.action === 'string' ? item.action : item.action.description, maxItemChars)} : {}),
  }));
}

export function buildDecisionState(rawState, {
  goal,
  actions,
  history = [],
  adapter,
  maxStateBytes = DEFAULT_MAX_STATE_BYTES,
  maxEvidenceItems = 40,
  maxCandidates = 24,
  maxItemChars = 320,
  denyNames = [],
} = {}) {
  if (typeof rawState !== 'string' || typeof goal !== 'string' || !Number.isInteger(maxStateBytes) || maxStateBytes < 1) throw new Error('Invalid decision state input');
  const normalized = normalizeAXState(rawState, {maxItemChars});
  const normalizedChars = JSON.stringify(normalized).length;
  const safeActions = (Array.isArray(actions) ? actions : [])
    .filter(action => isSafeAction(action, denyNames))
    .filter((action, index, all) => all.findIndex(other => `${other.op}:${other.index ?? ''}:${other.target ?? ''}:${other.direction ?? ''}:${other.key ?? ''}` === `${action.op}:${action.index ?? ''}:${action.target ?? ''}:${action.direction ?? ''}:${action.key ?? ''}`) === index)
    .slice(0, maxCandidates);
  const candidates = safeActions.map((action, index) => ({
    id: `a${index}`,
    op: action.op,
    label: clipped(actionLabel(action), maxItemChars),
  }));
  const candidateMap = new Map(candidates.map((candidate, index) => [candidate.id, safeActions[index]]));
  const hints = Array.isArray(adapter?.evidenceHints) ? adapter.evidenceHints : [];
  const selected = selectEvidence(normalized.nodes, {goal, adapterHints:hints, maxItems:maxEvidenceItems, maxPerSignature:3});
  const evidence = selected.filter(node => !HIGH_RISK.test(node.name)).map((node, index) => ({id:`e${index}`, text:clipped(node.name, maxItemChars), role:node.role}));
  const compact = compactHistory(history, maxItemChars);
  const state = {
    schemaVersion: 1,
    goal: clipped(goal, maxItemChars),
    page: normalized.page,
    evidence,
    candidates,
    history: compact,
    truncation: {evidence: selected.length < normalized.nodes.length, candidates: safeActions.length < (Array.isArray(actions) ? actions.length : 0)},
  };
  const trim = () => {
    if (state.evidence.length) { state.evidence.pop(); state.truncation.evidence = true; return true; }
    if (state.history.length) { state.history.shift(); return true; }
    return false;
  };
  while (byteLength(state) > maxStateBytes && trim()) {}
  if (byteLength(state) > maxStateBytes) throw new DecisionStateBudgetError();
  const decisionStateChars = byteLength(state);
  return {
    state,
    candidateMap,
    metrics: {
      rawChars: rawState.length,
      normalizedChars,
      decisionStateChars,
      evidenceSeen: normalized.nodes.length,
      evidenceSelected: state.evidence.length,
      candidatesSeen: Array.isArray(actions) ? actions.length : 0,
      candidatesSelected: candidates.length,
      normalizationMs: 0,
      projectionMs: 0,
    },
  };
}
