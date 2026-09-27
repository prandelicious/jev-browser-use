import { buildChoiceCriteria } from '../../src/jev/decision.mjs';

function normalizeProbabilities(choice, confidence, criteria) {
  const keys = Object.keys(criteria);
  const floor = 0.01;
  const probabilities = Object.fromEntries(keys.map((key) => [key, floor]));
  probabilities[choice] = confidence;
  const sum = Object.values(probabilities).reduce((total, value) => total + value, 0);
  for (const key of keys) {
    probabilities[key] = probabilities[key] / sum;
  }
  return probabilities;
}

export function buildScriptedDecisionAnswer(choice, confidence, permittedActions, extra = {}) {
  const { criteria } = buildChoiceCriteria(permittedActions);
  return {
    type: 'choice',
    choice,
    confidence,
    probabilities: normalizeProbabilities(choice, confidence, criteria),
    provider: 'scripted',
    model: 'scripted-jev',
    apiMs: 1,
    ...extra,
  };
}

export function createScriptedDecisionSource(sequence) {
  let callIndex = 0;
  return async ({ permittedActions }) => {
    const entry = sequence[callIndex] ?? { choice: 'BLOCKED', confidence: 0.9 };
    callIndex += 1;
    if (entry.throw) {
      throw entry.throw;
    }
    return buildScriptedDecisionAnswer(
      entry.choice,
      entry.confidence ?? 0.9,
      permittedActions,
      entry.extra,
    );
  };
}
