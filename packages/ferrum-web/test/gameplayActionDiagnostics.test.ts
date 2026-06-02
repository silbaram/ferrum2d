import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  gameplayActionDiagnosticReports,
  suggestionForActionFailureReason,
} from "../src/gameplayActionDiagnostics.js";
import type { ActionFrameDiagnostics } from "../src/engineTypes.js";
import type { GameplayActionFailedEventAction } from "../src/gameplayEventActions.js";
import type { GameplayEventView } from "../src/gameplayEventDecoder.js";

const emptyDiagnostics: ActionFrameDiagnostics = {
  triggerAttempts: 0,
  triggerFailures: 0,
  triggerFailureEventsPushed: 0,
  triggerCommitSkips: 0,
  failureReasonCounts: [],
};

const actionFailedEvent: GameplayEventView = {
  kind: "actionFailed",
  kindCode: 6,
  actorId: 7,
  actorGeneration: 0,
  sourceId: 9,
  sourceGeneration: 2,
  tokenId: 11,
  flags: 0,
  payloadBits: 5,
  once: false,
  consumedThisFrame: false,
  targetRemoved: false,
};

const spawnQueueFullFailure: GameplayActionFailedEventAction = {
  type: "actionFailed",
  actor: { entityId: 7, entityGeneration: 0 },
  source: { entityId: 9, entityGeneration: 2 },
  actionId: 11,
  reasonCode: 5,
  reason: "spawnQueueFull",
  flags: 0,
  payloadBits: 5,
  event: actionFailedEvent,
};

test("gameplayActionDiagnosticReports returns no reports for a clean frame", () => {
  deepEqual(gameplayActionDiagnosticReports(emptyDiagnostics), []);
});

test("gameplayActionDiagnosticReports summarizes failure reason buckets with agent patch paths", () => {
  const reports = gameplayActionDiagnosticReports({
    triggerAttempts: 3,
    triggerFailures: 2,
    triggerFailureEventsPushed: 2,
    triggerCommitSkips: 0,
    lastPreparedTriggerFailureReasonCode: 9,
    failureReasonCounts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
  });

  equal(reports.length, 1);
  deepEqual(reports[0], {
    kind: "gameplay-action",
    code: "FERRUM_GAMEPLAY_ACTION_TRIGGER_FAILURE",
    path: "frame.actionDiagnostics.failureReasonCounts.9",
    message: "Action trigger failed 2 time(s) with reason 'coolingDown'.",
    expected: 0,
    actual: 2,
    suggestion: "Increase trigger interval or reduce the action cooldown.",
    reasonCode: 9,
    reason: "coolingDown",
    count: 2,
  });
});

test("gameplayActionDiagnosticReports treats opt-in reason 0 as no-reason bucket", () => {
  const reports = gameplayActionDiagnosticReports({
    triggerAttempts: 1,
    triggerFailures: 1,
    triggerFailureEventsPushed: 0,
    triggerCommitSkips: 0,
    failureReasonCounts: [1],
  }, {
    includeZeroReasonBucket: true,
  });

  deepEqual(reports[0], {
    kind: "gameplay-action",
    code: "FERRUM_GAMEPLAY_ACTION_TRIGGER_FAILURE",
    path: "frame.actionDiagnostics.failureReasonCounts.0",
    message: "Action trigger failed 1 time(s) without a failure reason code.",
    expected: 0,
    actual: 1,
    suggestion: "Inspect the trigger producer and event sink; reason 0 is the no-reason bucket and should not be used for actionable failures.",
    reasonCode: 0,
    count: 1,
  });
});

test("gameplayActionDiagnosticReports reports dropped actionFailed events and commit skips", () => {
  const reports = gameplayActionDiagnosticReports({
    triggerAttempts: 4,
    triggerFailures: 3,
    triggerFailureEventsPushed: 1,
    triggerCommitSkips: 2,
    failureReasonCounts: [],
  }, {
    path: "state.frames.12.actionDiagnostics",
  });

  deepEqual(reports, [
    {
      kind: "gameplay-action",
      code: "FERRUM_GAMEPLAY_ACTION_TRIGGER_DROPPED_EVENT",
      path: "state.frames.12.actionDiagnostics.triggerFailureEventsPushed",
      message: "Not every action trigger failure was emitted as an actionFailed gameplay event.",
      expected: ">= 3",
      actual: 1,
      suggestion: "Bind/read the gameplay event sink or inspect frame telemetry summary; some failures were only visible in the aggregate bucket.",
      count: 2,
    },
    {
      kind: "gameplay-action",
      code: "FERRUM_GAMEPLAY_ACTION_TRIGGER_COMMIT_SKIPPED",
      path: "state.frames.12.actionDiagnostics.triggerCommitSkips",
      message: "Action trigger commit was skipped 2 time(s).",
      expected: 0,
      actual: 2,
      suggestion: "Avoid mutating action bindings between prepare and commit, or retry the trigger on the next frame.",
      count: 2,
    },
  ]);
});

test("gameplayActionDiagnosticReports enriches decoded actionFailed events with action and entity context", () => {
  const reports = gameplayActionDiagnosticReports(emptyDiagnostics, {
    actionFailures: [spawnQueueFullFailure],
    actionNames: new Map([[11, "summonRunner"]]),
  });

  deepEqual(reports, [
    {
      kind: "gameplay-action",
      code: "FERRUM_GAMEPLAY_ACTION_TRIGGER_FAILURE",
      path: "frame.actionDiagnostics.actionFailures.0.reasonCode",
      message: "Action 11 (summonRunner) failed with reason 'spawnQueueFull'.",
      expected: 0,
      actual: 5,
      suggestion: "Reduce same-frame action spawns or wait for the deferred spawn queue to flush.",
      reasonCode: 5,
      reason: "spawnQueueFull",
      actionId: 11,
      action: "summonRunner",
      actor: { entityId: 7, entityGeneration: 0 },
      source: { entityId: 9, entityGeneration: 2 },
    },
  ]);
});

test("suggestionForActionFailureReason keeps unknown reason actionable for ABI sync", () => {
  equal(
    suggestionForActionFailureReason("unknown"),
    "Check Rust/TypeScript failure reason constant synchronization.",
  );
});
