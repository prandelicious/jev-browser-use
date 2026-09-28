import { performance } from 'node:perf_hooks';
import {
  DEFAULT_MECHANICAL_ACTIONS,
  SERVER_CAPS,
  effectiveMaxActions,
  effectiveMaxDurationMs,
  validateRunBrowserTaskRequest,
  validateTaskResultSemantics,
} from '../contract.mjs';
import { bindPage, clickByUid, navigatePage, takeSnapshot } from '../chrome/actions.mjs';
import { ChromeActionPolicyError } from '../chrome/actions.mjs';
import { ChromeSessionError, originFromUrl } from '../chrome/session.mjs';
import {
  TERMINAL_CHOICE_IDS,
  assertHostSafeDecisionSurface,
  assertObservationOriginAllowed,
  assertProjectedStateWithinLimit,
  assessConfidence,
  buildChoiceCriteria,
  buildJevObservationPayload,
  captureDecisionWitness,
  evaluatePreActionWitness,
  projectDecisionState,
  sanitizePublicDecisionStep,
  validateTypedChoiceAnswer,
} from '../jev/decision.mjs';

const SECRET_PATTERNS = [/\bsk-[a-z0-9]{10,}\b/i, /\bTYPESAFE_API_KEY\b/, /\bpassword\b/i];
const RAW_AX_LINE_RE = /^\d+ (?:button|link|text field|text area|combo box|radio button|menu item|[\w]+)/m;
const RAW_AX_URL_HEADER_RE = /Browser tab:.*\bURL:\s*"/;

export class TaskCancelledError extends Error {
  constructor(message = 'Task cancelled') {
    super(message);
    this.name = 'TaskCancelledError';
  }
}

export class TaskRunError extends Error {
  constructor(message, { code = 'error', cause } = {}) {
    super(message, { cause });
    this.name = 'TaskRunError';
    this.code = code;
  }
}

function nowMs() {
  return performance.now();
}

function remainingMs(deadlineMs, startedAt) {
  return deadlineMs - (nowMs() - startedAt);
}

function assertNotAborted(abortSignal) {
  if (abortSignal?.aborted) {
    throw new TaskCancelledError();
  }
}

function redactPublicErrorText(message) {
  if (typeof message !== 'string' || !message) {
    return 'An error occurred';
  }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(message)) {
      return 'Browser or decision provider error';
    }
  }
  if (RAW_AX_URL_HEADER_RE.test(message) || RAW_AX_LINE_RE.test(message)) {
    return 'Browser or policy error';
  }
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
}

export function sanitizePublicTaskResult(result) {
  const copy = structuredClone(result);
  if (copy.error) {
    copy.error = redactPublicErrorText(copy.error);
  }
  if (Array.isArray(copy.history)) {
    copy.history = copy.history.map((step) => sanitizePublicDecisionStep(step));
  }
  if (copy.status === 'completed') {
    validateTaskResultSemantics(copy);
  } else {
    validateTaskResultSemantics({
      status: copy.status,
      mechanicalGoalSatisfied: copy.mechanicalGoalSatisfied ?? false,
    });
  }
  assertHostSafeDecisionSurface(copy);
  return copy;
}

function mapPolicyCode(code) {
  if (['unbound', 'wrong_origin', 'wrong_page', 'page_closed', 'policy_denied'].includes(code)) {
    return 'policy_denied';
  }
  return 'error';
}

function terminalHandoffReason(choice) {
  if (choice === 'BLOCKED') return 'model_blocked';
  if (choice === 'WAIT') return 'loading';
  return 'handoff';
}

export function buildPermittedActionsFromSnapshot(
  rawObservation,
  { allowedMechanicalActions = DEFAULT_MECHANICAL_ACTIONS, navigateUrl = null } = {},
) {
  const actions = [];
  if (allowedMechanicalActions.includes('semantic_click')) {
    for (const line of rawObservation.split('\n')) {
      const match = line.match(/^(\d+) (button|link)\s+(.+)$/);
      if (match) {
        actions.push({
          op: 'click',
          uid: `uid-${match[1]}`,
          description: `Click ${match[3].trim()}`,
        });
      }
    }
  }
  if (allowedMechanicalActions.includes('navigate') && typeof navigateUrl === 'string' && navigateUrl) {
    actions.push({
      op: 'navigate',
      url: navigateUrl,
      description: 'Navigate to approved URL',
    });
  }
  return actions;
}

async function executeMechanicalAction(session, action, allowedOrigins, abortSignal) {
  assertNotAborted(abortSignal);
  if (action.op === 'click') {
    const pending = clickByUid(session, action.uid, allowedOrigins);
    if (!abortSignal) {
      return pending;
    }
    return Promise.race([
      pending,
      new Promise((_, reject) => {
        abortSignal.addEventListener('abort', () => reject(new TaskCancelledError()), { once: true });
      }),
    ]);
  }
  if (action.op === 'navigate') {
    const targetOrigin = originFromUrl(action.url);
    if (!targetOrigin || !allowedOrigins.includes(targetOrigin)) {
      throw new TaskRunError('Navigation target left authorized origins', { code: 'wrong_origin' });
    }
    return navigatePage(session, action.url, allowedOrigins);
  }
  throw new TaskRunError(`Unsupported mechanical action: ${action.op}`, { code: 'policy_denied' });
}

function mechanicalActionAllowed(action, allowedMechanicalActions) {
  if (!action || typeof action !== 'object') return false;
  if (action.op === 'click') return allowedMechanicalActions.includes('semantic_click');
  if (action.op === 'navigate') return allowedMechanicalActions.includes('navigate');
  return false;
}

function finalizeResult(partial, startedAt) {
  const elapsedMs = Math.round(nowMs() - startedAt);
  const result = {
    metrics: {
      elapsedMs,
      decisions: 0,
      actionsExecuted: 0,
      staleRetries: 0,
      ...(partial.metrics ?? {}),
    },
    history: partial.history ?? [],
    ...partial,
  };
  if (result.binding?.url) {
    delete result.binding.url;
  }
  return sanitizePublicTaskResult(result);
}

/**
 * Bounded one-decision-at-a-time browser task loop.
 */
export async function runBrowserTask(
  request,
  {
    session,
    decide,
    buildPermittedActions = ({ rawObservation, request: taskRequest }) =>
      buildPermittedActionsFromSnapshot(rawObservation, {
        allowedMechanicalActions: taskRequest.allowedMechanicalActions ?? DEFAULT_MECHANICAL_ACTIONS,
        navigateUrl: taskRequest.navigateUrl,
      }),
    abortSignal = null,
    minConfidence = SERVER_CAPS.minConfidence,
    maxStaleRetries = SERVER_CAPS.maxRetries,
  } = {},
) {
  if (!session || typeof decide !== 'function') {
    throw new TaskRunError('Invalid task dependencies', { code: 'error' });
  }
  validateRunBrowserTaskRequest(request);
  const startedAt = nowMs();
  const maxActions = effectiveMaxActions(request.maxActions);
  const maxDurationMs = effectiveMaxDurationMs(request.maxDurationMs);
  const allowedMechanicalActions = request.allowedMechanicalActions ?? DEFAULT_MECHANICAL_ACTIONS;
  const history = [];
  const metrics = { decisions: 0, actionsExecuted: 0, staleRetries: 0 };
  let staleRetries = 0;
  let actionsTaken = 0;

  await session.start();
  try {
    assertNotAborted(abortSignal);
    if (!request.page) {
      const pages = await session.listPages();
      const candidatePages = pages
        .map((page) => ({ pageId: page.pageId, origin: originFromUrl(page.url) }))
        .filter((entry) => entry.origin && request.allowedOrigins.includes(entry.origin));
      return finalizeResult(
        {
          status: 'handoff',
          handoffReason: 'page_selection_required',
          candidatePages,
          history,
          metrics,
        },
        startedAt,
      );
    }

    try {
      await bindPage(session, request.page, request.allowedOrigins);
    } catch (error) {
      const code =
        error instanceof ChromeActionPolicyError || error instanceof ChromeSessionError
          ? error.code
          : 'error';
      return finalizeResult(
        {
          status: mapPolicyCode(code),
          error: redactPublicErrorText(error instanceof Error ? error.message : 'Bind failed'),
          history,
          metrics,
          pageId: request.page,
        },
        startedAt,
      );
    }

    while (actionsTaken < maxActions) {
      assertNotAborted(abortSignal);
      if (remainingMs(maxDurationMs, startedAt) <= 0) {
        return finalizeResult({ status: 'timeout', history, metrics }, startedAt);
      }

      let rawObservation;
      try {
        const snapshot = await takeSnapshot(session, request.allowedOrigins);
        rawObservation = snapshot.snapshot ?? snapshot;
        if (typeof rawObservation !== 'string') {
          throw new TaskRunError('Snapshot missing observation text', { code: 'error' });
        }
        assertObservationOriginAllowed(rawObservation, request.allowedOrigins);
      } catch (error) {
        const code =
          error instanceof ChromeActionPolicyError || error instanceof ChromeSessionError
            ? error.code
            : 'error';
        return finalizeResult(
          {
            status: mapPolicyCode(code),
            error: redactPublicErrorText(error instanceof Error ? error.message : 'Observation failed'),
            history,
            metrics,
            pageId: session.binding?.pageId,
            origin: session.binding?.origin,
          },
          startedAt,
        );
      }

      const permittedActions = buildPermittedActions({
        rawObservation,
        request,
        session,
      });
      const projectedState = projectDecisionState(rawObservation, {
        goal: request.goal,
        actions: permittedActions.map((action, index) => ({ index, op: action.op, name: action.description })),
      });
      assertProjectedStateWithinLimit(projectedState);
      const witness = captureDecisionWitness({ rawObservation, projectedState, permittedActions });
      const { criteria } = buildChoiceCriteria(permittedActions);

      let decisionAnswer;
      try {
        decisionAnswer = await decide({
          goal: request.goal,
          observation: buildJevObservationPayload({ goal: request.goal, projectedState, history }),
          criteria,
          permittedActions,
          signal: abortSignal,
        });
      } catch (error) {
        if (error instanceof TaskCancelledError) {
          return finalizeResult(
            {
              status: 'handoff',
              handoffReason: 'cancelled',
              uncertainAction: true,
              history,
              metrics,
              pageId: session.binding?.pageId,
              origin: session.binding?.origin,
            },
            startedAt,
          );
        }
        return finalizeResult(
          {
            status: 'error',
            error: redactPublicErrorText(error instanceof Error ? error.message : 'Decision failed'),
            history,
            metrics,
            pageId: session.binding?.pageId,
            origin: session.binding?.origin,
          },
          startedAt,
        );
      }
      metrics.decisions += 1;

      let parsed;
      try {
        parsed = validateTypedChoiceAnswer(decisionAnswer, criteria, permittedActions);
      } catch (error) {
        return finalizeResult(
          {
            status: 'error',
            error: redactPublicErrorText(error instanceof Error ? error.message : 'Invalid decision'),
            history,
            metrics,
          },
          startedAt,
        );
      }

      const decisionRecord = sanitizePublicDecisionStep({
        provider: decisionAnswer.provider ?? 'scripted',
        choice: parsed.choice,
        confidence: parsed.confidence,
        model: decisionAnswer.model ?? null,
        apiMs: decisionAnswer.apiMs ?? 0,
        action: parsed.mechanicalAction?.description ?? parsed.choice,
        executed: false,
        reason: null,
      });

      let freshRaw;
      try {
        const freshSnapshot = await takeSnapshot(session, request.allowedOrigins);
        freshRaw = freshSnapshot.snapshot ?? freshSnapshot;
        assertObservationOriginAllowed(freshRaw, request.allowedOrigins);
      } catch (error) {
        return finalizeResult(
          {
            status: mapPolicyCode(error?.code ?? 'error'),
            error: redactPublicErrorText(error instanceof Error ? error.message : 'Refresh failed'),
            history: [...history, decisionRecord],
            metrics,
          },
          startedAt,
        );
      }

      const freshPermitted = buildPermittedActions({
        rawObservation: freshRaw,
        request,
        session,
      });
      const freshProjected = projectDecisionState(freshRaw, {
        goal: request.goal,
        actions: freshPermitted.map((action, index) => ({ index, op: action.op, name: action.description })),
      });
      const witnessVerdict = evaluatePreActionWitness(witness, {
        rawObservation: freshRaw,
        projectedState: freshProjected,
        permittedActions: freshPermitted,
      });
      if (!witnessVerdict.proceed) {
        history.push({
          ...decisionRecord,
          executed: false,
          reason: witnessVerdict.reason,
        });
        staleRetries += 1;
        metrics.staleRetries = staleRetries;
        if (staleRetries > maxStaleRetries) {
          return finalizeResult(
            {
              status: 'stale_state',
              history,
              metrics,
              pageId: session.binding?.pageId,
              origin: session.binding?.origin,
            },
            startedAt,
          );
        }
        continue;
      }

      const confidenceVerdict = assessConfidence(parsed.confidence, minConfidence);
      if (!confidenceVerdict.acceptable) {
        history.push({ ...decisionRecord, executed: false, reason: confidenceVerdict.reason });
        return finalizeResult(
          {
            status: 'handoff',
            handoffReason: confidenceVerdict.reason,
            history,
            metrics,
            pageId: session.binding?.pageId,
            origin: session.binding?.origin,
          },
          startedAt,
        );
      }

      if (TERMINAL_CHOICE_IDS.includes(parsed.choice)) {
        history.push({
          ...decisionRecord,
          executed: false,
          reason: terminalHandoffReason(parsed.choice),
        });
        if (parsed.choice === 'DONE') {
          return finalizeResult(
            {
              status: 'completed',
              mechanicalGoalSatisfied: true,
              finalUserVerification: false,
              history,
              metrics,
              pageId: session.binding?.pageId,
              origin: session.binding?.origin,
            },
            startedAt,
          );
        }
        return finalizeResult(
          {
            status: 'handoff',
            handoffReason: terminalHandoffReason(parsed.choice),
            history,
            metrics,
            pageId: session.binding?.pageId,
            origin: session.binding?.origin,
          },
          startedAt,
        );
      }

      const mechanicalAction = parsed.mechanicalAction;
      if (!mechanicalActionAllowed(mechanicalAction, allowedMechanicalActions)) {
        history.push({ ...decisionRecord, executed: false, reason: 'unsupported_action' });
        return finalizeResult(
          {
            status: 'policy_denied',
            handoffReason: 'unsupported_action',
            history,
            metrics,
            pageId: session.binding?.pageId,
            origin: session.binding?.origin,
          },
          startedAt,
        );
      }

      try {
        await executeMechanicalAction(session, mechanicalAction, request.allowedOrigins, abortSignal);
      } catch (error) {
        if (error instanceof TaskCancelledError) {
          history.push({ ...decisionRecord, executed: false, reason: 'cancelled_uncertain' });
          return finalizeResult(
            {
              status: 'handoff',
              handoffReason: 'cancelled',
              uncertainAction: true,
              history,
              metrics,
              pageId: session.binding?.pageId,
              origin: session.binding?.origin,
            },
            startedAt,
          );
        }
        history.push({ ...decisionRecord, executed: false, reason: 'action_error' });
        const code =
          error instanceof TaskRunError
            ? error.code
            : error instanceof ChromeActionPolicyError || error instanceof ChromeSessionError
              ? error.code
              : 'error';
        return finalizeResult(
          {
            status: mapPolicyCode(code),
            error: redactPublicErrorText(error instanceof Error ? error.message : 'Action failed'),
            history,
            metrics,
            pageId: session.binding?.pageId,
            origin: session.binding?.origin,
          },
          startedAt,
        );
      }

      actionsTaken += 1;
      metrics.actionsExecuted = actionsTaken;
      history.push({ ...decisionRecord, executed: true, reason: 'executed' });
    }

    return finalizeResult(
      {
        status: 'handoff',
        handoffReason: 'action_budget',
        history,
        metrics,
        pageId: session.binding?.pageId,
        origin: session.binding?.origin,
      },
      startedAt,
    );
  } finally {
    await session.stop().catch(() => {});
  }
}
