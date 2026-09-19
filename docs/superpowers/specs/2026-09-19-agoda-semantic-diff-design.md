# Agoda Semantic Diff Design

## Goal

Reduce Jev model input after the first Agoda decision by sending a self-contained semantic delta when the current relevant accessibility state is substantially smaller than the normal compact projection.

## Decision

Use a session-local semantic diff with a full-projection fallback.

The first decision in each `run()` call sends the existing compact projection. Later decisions compare the current raw accessibility tree with the previous raw tree held only in memory. The bridge builds a self-contained update containing:

- the current browser-tab header;
- current goal/profile-matching lines;
- current allowed action lines;
- relevant lines added or changed since the previous observation;
- relevant lines removed since the previous observation.

The bridge sends this delta only when it is materially smaller than the full compact projection. If the delta is unavailable, malformed, ambiguous, larger than the configured ratio, or over the model-input limit, it sends the full projection instead.

The delta is not treated as an executable browser state. The fresh raw tree remains authoritative for origin validation, available-action discovery, stale-state comparison, target indices, execution, and final verification.

## Alternatives considered

### Always send raw line diffs

This minimizes the payload but is unsafe for a stateless Jev request: the model cannot reliably reconstruct omitted context from a prior request. Rejected.

### Persist raw snapshots

This would support cross-process reconstruction but would store page content and could retain stale or sensitive information. It also violates the existing cache contract. Rejected.

### Session-local semantic diff with fallback

This preserves the privacy and safety boundaries, gives Jev current goal-relevant context, and fails open to the already-tested full projection. Selected.

## Data flow

1. `run()` captures the fresh raw AX tree.
2. `prepareDecisionState()` builds the normal compact projection and updates the structural Agoda profile as it does today.
3. When an earlier raw tree exists in the same `run()` call, the projection layer derives a semantic delta from the two snapshots.
4. The delta is accepted only if it is self-contained and no larger than the configured fraction of the full projection. Otherwise the full projection is returned.
5. `decide()` receives the selected state. The bridge records the selected mode and size metrics without recording page text, URLs, or cache paths.
6. The bridge re-reads raw state before executing a decision and rejects any raw-state change as `stale_state`, regardless of whether Jev received a full projection or a delta.

## Interface changes

`run()` accepts:

```js
{
  incrementalStateEnabled: true,
  incrementalStateMaxRatio: 0.65
}
```

The feature is enabled by default and can be disabled to restore full-projection behavior. The ratio must be finite and between `0.1` and `1`; invalid values reject the task contract. The delta state is reset at the start of every `run()` call and is never written to disk.

`prepareDecisionState()` returns the existing `decisionState`, `profile`, and metrics, plus:

```js
{
  stateMode: 'full' | 'delta',
  fullProjectedChars: Number,
  deltaAddedChars: Number,
  deltaRemovedChars: Number
}
```

Existing cache metrics remain unchanged. These metrics contain counts only.

## Safety and failure behavior

- Raw state remains in memory only for the active browser task.
- The profile cache never stores snapshots or deltas.
- A delta never supplies click indices to execution.
- A missing previous state, changed page family, malformed line data, projection failure, or oversized mandatory section selects the full projection or returns the existing decision error.
- The delta includes the current header and all current action-target lines needed for Jev’s decision context.
- A delta can never bypass the existing origin, stale-state, confidence, action, step, timeout, or final-verification checks.

## Testing

Add unit tests for:

1. the first observation selecting `full`;
2. a small relevant update selecting `delta`;
3. unchanged goal context remaining in a delta even when it did not change;
4. removed relevant lines being represented without mutating either input snapshot;
5. a large delta falling back to `full`;
6. disabled incremental mode selecting `full`;
7. invalid ratio and malformed input rejection;
8. bridge integration preserving raw-to-raw stale-state rejection when the model receives a delta.

Update the user-facing skill documentation with the opt-out and the distinction between model-state reduction and raw-state safety.

## Success criteria

- Existing tests continue to pass.
- New tests prove that the delta is self-contained and never controls execution.
- On a repeated Agoda interaction with a small state change, the selected model input is at least 35% smaller than the full compact projection.
- On noisy or large changes, the bridge falls back to full projection without changing the action result.
- No cache file contains raw AX state, page text, delta text, URLs, or action history.
