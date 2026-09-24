import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SERVER_CAPS } from './contract.test.mjs';
import {
  actionBindingFingerprint,
  assertHostSafeDecisionSurface,
  assertObservationOriginAllowed,
  assertProjectedStateWithinLimit,
  assessConfidence,
  buildChoiceCriteria,
  buildJevObservationPayload,
  canRetryDecisionTransport,
  captureDecisionWitness,
  evaluatePreActionWitness,
  isMechanicalChoiceId,
  isRawObservationStale,
  mechanicalChoiceId,
  projectDecisionState,
  resolveMechanicalChoice,
  sanitizePublicDecisionStep,
  validateTypedChoiceAnswer,
} from '../src/jev/decision.mjs';

const genericFixture = await readFile(new URL('./fixtures/generic-property.ax.txt', import.meta.url), 'utf8');
const allowedOrigin = 'https://stay.example.test';
const permittedActions = [
  { op: 'click', index: 2, uid: 'uid-book', description: 'Click Book now' },
  { op: 'navigate', description: 'Open house rules' },
];

test('projection keeps origin-only header and goal evidence without query noise', () => {
  const projected = projectDecisionState(genericFixture, {
    goal: 'Find room size and children age policy',
    actions: [{ index: 2, op: 'click', name: 'Book now' }],
    evidencePatterns: [/room size/i, /children/i],
  });
  assert.match(projected, /^Browser tab: Example \(origin https:\/\/stay\.example\.test\)\.$/m);
  assert.match(projected, /^2 button Book now$/m);
  assert.match(projected, /Room size: 42 m²/);
  assert.doesNotMatch(projected, /checkin=|Credentials|footer noise/);
  assertProjectedStateWithinLimit(projected);
});

test('opaque mechanical action ids map to host-held bindings only in criteria', () => {
  const { criteria } = buildChoiceCriteria(permittedActions);
  assert.equal(mechanicalChoiceId(0), 'a0');
  assert.ok(isMechanicalChoiceId('a0'));
  assert.equal(criteria.a0, 'Click Book now');
  assert.equal(criteria.a1, 'Open house rules');
  assert.equal(criteria.DONE, 'Goal fully achieved; stop for independent host verification');
  assert.doesNotMatch(JSON.stringify(criteria), /uid-book|uid:/);
  const resolved = resolveMechanicalChoice('a0', permittedActions);
  assert.equal(resolved.index, 2);
  assert.equal(resolved.uid, 'uid-book');
});

test('stale-state witness rejects raw observation drift before execution', () => {
  const projected = projectDecisionState(genericFixture, {
    goal: 'Find room size',
    actions: [{ index: 2, op: 'click', name: 'Book now' }],
    evidencePatterns: [/room size/i],
  });
  const witness = captureDecisionWitness({
    rawObservation: genericFixture,
    projectedState: projected,
    permittedActions,
  });
  const changedRaw = genericFixture.replace('footer noise', 'footer changed');
  assert.ok(isRawObservationStale(genericFixture, changedRaw));
  const verdict = evaluatePreActionWitness(witness, {
    rawObservation: changedRaw,
    projectedState: projected,
    permittedActions,
  });
  assert.equal(verdict.proceed, false);
  assert.equal(verdict.reason, 'stale_state');
});

test('decision witness rejects swapped uid binding with unchanged snapshot text', () => {
  const projected = projectDecisionState(genericFixture, {
    goal: 'Find room size',
    actions: [{ index: 2, op: 'click', name: 'Book now' }],
    evidencePatterns: [/room size/i],
  });
  const witness = captureDecisionWitness({
    rawObservation: genericFixture,
    projectedState: projected,
    permittedActions,
  });
  const swapped = [
    { ...permittedActions[0], uid: 'uid-attacker' },
    permittedActions[1],
  ];
  const verdict = evaluatePreActionWitness(witness, {
    rawObservation: genericFixture,
    projectedState: projected,
    permittedActions: swapped,
  });
  assert.equal(verdict.proceed, false);
  assert.equal(verdict.reason, 'stale_binding');
  assert.notEqual(
    actionBindingFingerprint(permittedActions[0]),
    actionBindingFingerprint(swapped[0]),
  );
});

test('retry budget allows transport retries only within remaining time', () => {
  assert.ok(
    canRetryDecisionTransport({
      decisionRetries: 0,
      maxDecisionRetries: 1,
      remainingMs: 5000,
      errorMessage: 'typesafe transport failure or timeout',
    }),
  );
  assert.equal(
    canRetryDecisionTransport({
      decisionRetries: 1,
      maxDecisionRetries: 1,
      remainingMs: 5000,
      errorMessage: 'typesafe transport failure or timeout',
    }),
    false,
  );
  assert.equal(
    canRetryDecisionTransport({
      decisionRetries: 0,
      maxDecisionRetries: 2,
      remainingMs: 500,
      errorMessage: 'typesafe transport failure or timeout',
    }),
    false,
  );
});

test('origin check fails closed outside allowed origins', () => {
  assert.equal(assertObservationOriginAllowed(genericFixture, [allowedOrigin]), allowedOrigin);
  assert.throws(
    () => assertObservationOriginAllowed(genericFixture, ['https://evil.example']),
    /authorized origins/,
  );
  assert.throws(
    () => assertObservationOriginAllowed({ url: 'https://evil.example/path' }, [allowedOrigin]),
    /authorized origins/,
  );
});

test('low confidence is rejected at the shared minimum threshold', () => {
  const low = assessConfidence(0.2, SERVER_CAPS.minConfidence);
  assert.equal(low.acceptable, false);
  assert.equal(low.reason, 'low_confidence');
  const ok = assessConfidence(0.9, SERVER_CAPS.minConfidence);
  assert.equal(ok.acceptable, true);
});

test('privacy: public decision surfaces omit raw tree, page text, and secrets', () => {
  const projected = projectDecisionState(genericFixture, {
    goal: 'Find room size',
    actions: [{ index: 2, op: 'click', name: 'Book now' }],
    evidencePatterns: [/room size/i],
  });
  const payload = buildJevObservationPayload({ goal: 'Find room size', projectedState: projected });
  const publicStep = sanitizePublicDecisionStep({
    provider: 'typesafe',
    choice: 'a0',
    confidence: 0.99,
    model: 'jev-latest',
    apiMs: 12,
    action: permittedActions[0],
    executed: false,
    reason: 'stale_state',
  });
  assertHostSafeDecisionSurface(publicStep);
  assert.doesNotMatch(JSON.stringify(publicStep), /Room size: 42|Children 0-5|uid-book|Browser tab:/);
  assert.throws(() => assertHostSafeDecisionSurface(payload), /leaks raw observation/);
  assert.throws(() => assertHostSafeDecisionSurface({ browser: genericFixture }), /leaks raw observation/);
  assert.throws(
    () => assertHostSafeDecisionSurface({ note: 'sk-abcdefghijklmnopqrstuvwxyz' }),
    /leaks raw observation/,
  );
});

test('typed choice validation accepts mechanical ids without exposing bindings in the answer', () => {
  const { criteria } = buildChoiceCriteria(permittedActions);
  const probabilities = {
    a0: 0.94,
    a1: 0.01,
    DONE: 0.02,
    BLOCKED: 0.02,
    WAIT: 0.01,
  };
  const parsed = validateTypedChoiceAnswer(
    { type: 'choice', choice: 'a0', confidence: 0.94, probabilities },
    criteria,
    permittedActions,
  );
  assert.equal(parsed.choice, 'a0');
  assert.equal(parsed.mechanicalAction.uid, 'uid-book');
  assert.throws(
    () =>
      validateTypedChoiceAnswer(
        { type: 'choice', choice: 'a9', confidence: 0.94, probabilities },
        criteria,
        permittedActions,
      ),
    /Invalid decision schema/,
  );
});
