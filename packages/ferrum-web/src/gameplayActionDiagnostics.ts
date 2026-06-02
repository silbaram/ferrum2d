import type { ActionFrameDiagnostics } from "./engineTypes.js";
import {
  gameplayActionFailureReasonForCode,
  type GameplayActionFailedEventAction,
  type GameplayActionFailureReason,
  type GameplayEventActionNameMap,
} from "./gameplayEventActions.js";

export type GameplayActionDiagnosticCode =
  | "FERRUM_GAMEPLAY_ACTION_TRIGGER_FAILURE"
  | "FERRUM_GAMEPLAY_ACTION_TRIGGER_DROPPED_EVENT"
  | "FERRUM_GAMEPLAY_ACTION_TRIGGER_COMMIT_SKIPPED";

export type GameplayActionDiagnosticValue = string | number | boolean;

export interface GameplayActionDiagnosticReport {
  kind: "gameplay-action";
  code: GameplayActionDiagnosticCode;
  path: string;
  message: string;
  expected: GameplayActionDiagnosticValue;
  actual: GameplayActionDiagnosticValue;
  suggestion: string;
  reasonCode?: number;
  reason?: GameplayActionFailureReason;
  count?: number;
  actionId?: number;
  action?: string;
  actor?: {
    entityId: number;
    entityGeneration: number;
  };
  source?: {
    entityId: number;
    entityGeneration: number;
  };
}

export interface GameplayActionDiagnosticReportOptions {
  path?: string;
  actionFailures?: readonly GameplayActionFailedEventAction[];
  actionNames?: GameplayEventActionNameMap;
  includeZeroReasonBucket?: boolean;
}

export function gameplayActionDiagnosticReports(
  diagnostics: ActionFrameDiagnostics,
  options: GameplayActionDiagnosticReportOptions = {},
): readonly GameplayActionDiagnosticReport[] {
  const basePath = options.path ?? "frame.actionDiagnostics";
  const reports: GameplayActionDiagnosticReport[] = [];

  diagnostics.failureReasonCounts.forEach((count, reasonCode) => {
    if (count <= 0 || (reasonCode === 0 && options.includeZeroReasonBucket !== true)) {
      return;
    }
    if (reasonCode === 0) {
      reports.push({
        kind: "gameplay-action",
        code: "FERRUM_GAMEPLAY_ACTION_TRIGGER_FAILURE",
        path: `${basePath}.failureReasonCounts.0`,
        message: `Action trigger failed ${count} time(s) without a failure reason code.`,
        expected: 0,
        actual: count,
        suggestion: "Inspect the trigger producer and event sink; reason 0 is the no-reason bucket and should not be used for actionable failures.",
        reasonCode,
        count,
      });
      return;
    }
    const reason = gameplayActionFailureReasonForCode(reasonCode);
    reports.push({
      kind: "gameplay-action",
      code: "FERRUM_GAMEPLAY_ACTION_TRIGGER_FAILURE",
      path: `${basePath}.failureReasonCounts.${reasonCode}`,
      message: `Action trigger failed ${count} time(s) with reason '${reason}'.`,
      expected: 0,
      actual: count,
      suggestion: suggestionForActionFailureReason(reason),
      reasonCode,
      reason,
      count,
    });
  });

  if (diagnostics.triggerFailures > diagnostics.triggerFailureEventsPushed) {
    reports.push({
      kind: "gameplay-action",
      code: "FERRUM_GAMEPLAY_ACTION_TRIGGER_DROPPED_EVENT",
      path: `${basePath}.triggerFailureEventsPushed`,
      message: "Not every action trigger failure was emitted as an actionFailed gameplay event.",
      expected: `>= ${diagnostics.triggerFailures}`,
      actual: diagnostics.triggerFailureEventsPushed,
      suggestion: "Bind/read the gameplay event sink or inspect frame telemetry summary; some failures were only visible in the aggregate bucket.",
      count: diagnostics.triggerFailures - diagnostics.triggerFailureEventsPushed,
    });
  }

  if (diagnostics.triggerCommitSkips > 0) {
    reports.push({
      kind: "gameplay-action",
      code: "FERRUM_GAMEPLAY_ACTION_TRIGGER_COMMIT_SKIPPED",
      path: `${basePath}.triggerCommitSkips`,
      message: `Action trigger commit was skipped ${diagnostics.triggerCommitSkips} time(s).`,
      expected: 0,
      actual: diagnostics.triggerCommitSkips,
      suggestion: "Avoid mutating action bindings between prepare and commit, or retry the trigger on the next frame.",
      count: diagnostics.triggerCommitSkips,
    });
  }

  options.actionFailures?.forEach((failure, index) => {
    const action = actionNameForId(failure.actionId, options.actionNames);
    reports.push({
      kind: "gameplay-action",
      code: "FERRUM_GAMEPLAY_ACTION_TRIGGER_FAILURE",
      path: `${basePath}.actionFailures.${index}.reasonCode`,
      message: action === undefined
        ? `Action ${failure.actionId} failed with reason '${failure.reason}'.`
        : `Action ${failure.actionId} (${action}) failed with reason '${failure.reason}'.`,
      expected: 0,
      actual: failure.reasonCode,
      suggestion: suggestionForActionFailureReason(failure.reason),
      reasonCode: failure.reasonCode,
      reason: failure.reason,
      actionId: failure.actionId,
      ...(action === undefined ? {} : { action }),
      actor: failure.actor,
      source: failure.source,
    });
  });

  return reports;
}

export function suggestionForActionFailureReason(reason: GameplayActionFailureReason): string {
  if (reason === "unsupportedPrefab") {
    return "Use a supported prefab id or register the prefab before applying this action.";
  }
  if (reason === "unsupportedAnchor") {
    return "Use anchor 'self' for the current runtime action trigger.";
  }
  if (reason === "unsupportedPhase") {
    return "Use phase 'prePhysics' until additional trigger phases are implemented.";
  }
  if (reason === "missingSourceTransform") {
    return "Ensure the trigger source entity is alive and has a transform before firing the action.";
  }
  if (reason === "spawnQueueFull") {
    return "Reduce same-frame action spawns or wait for the deferred spawn queue to flush.";
  }
  if (reason === "patternMismatch") {
    return "Make the action id point to the expected action pattern for this trigger.";
  }
  if (reason === "blockedPlacement") {
    return "Move the source/offset or choose a prefab footprint that does not overlap blocking tiles.";
  }
  if (reason === "missingActionBinding") {
    return "Install an action binding for the referenced action id before the trigger fires.";
  }
  if (reason === "coolingDown") {
    return "Increase trigger interval or reduce the action cooldown.";
  }
  if (reason === "unsupportedAimSource") {
    return "Use an aim source supported by this trigger, such as targetPlayer for non-player triggers.";
  }
  if (reason === "missingActionTarget") {
    return "Ensure the required target entity exists and is not the source entity.";
  }
  if (reason === "unsupportedCollisionTarget") {
    return "Use a collision target supported by this trigger/runtime path.";
  }
  return "Check Rust/TypeScript failure reason constant synchronization.";
}

function actionNameForId(
  actionId: number,
  actionNames: GameplayEventActionNameMap | undefined,
): string | undefined {
  if (actionNames === undefined) {
    return undefined;
  }
  return isNameMap(actionNames)
    ? actionNames.get(actionId)
    : actionNames[actionId];
}

function isNameMap(value: GameplayEventActionNameMap): value is ReadonlyMap<number, string> {
  return typeof (value as ReadonlyMap<number, string>).get === "function";
}
