import type { SpawnFrameDiagnostics } from "./engineTypes.js";

export type GameplaySpawnDiagnosticCode =
  | "FERRUM_GAMEPLAY_SPAWN_FLUSH_ACTIVITY"
  | "FERRUM_GAMEPLAY_SPAWN_FLUSH_EXPECTATION_MISMATCH";

export type GameplaySpawnDiagnosticValue = string | number | boolean;

export type GameplaySpawnDiagnosticMetric = keyof SpawnFrameDiagnostics;

export interface GameplaySpawnDiagnosticExpectation {
  metric: GameplaySpawnDiagnosticMetric;
  expected: number;
  suggestion?: string;
}

export interface GameplaySpawnDiagnosticReport {
  kind: "gameplay-spawn";
  code: GameplaySpawnDiagnosticCode;
  path: string;
  message: string;
  expected: GameplaySpawnDiagnosticValue;
  actual: GameplaySpawnDiagnosticValue;
  suggestion: string;
  metric: GameplaySpawnDiagnosticMetric;
  count?: number;
}

export interface GameplaySpawnDiagnosticReportOptions {
  path?: string;
  expectations?: readonly GameplaySpawnDiagnosticExpectation[];
  includeActivity?: boolean;
}

const SPAWN_DIAGNOSTIC_METRIC_FLAGS = {
  commandsDrained: true,
  projectileSpawns: true,
  projectileArcsApplied: true,
  projectileShootAudioEventsPushed: true,
  prefabSpawns: true,
  prefabSpawnedPayloads: true,
  prefabSpawnedEventsPushed: true,
} as const satisfies Record<GameplaySpawnDiagnosticMetric, true>;
const SPAWN_DIAGNOSTIC_METRICS = Object.keys(
  SPAWN_DIAGNOSTIC_METRIC_FLAGS,
) as readonly GameplaySpawnDiagnosticMetric[];

export function gameplaySpawnDiagnosticReports(
  diagnostics: SpawnFrameDiagnostics,
  options: GameplaySpawnDiagnosticReportOptions = {},
): readonly GameplaySpawnDiagnosticReport[] {
  const basePath = options.path ?? "frame.spawnDiagnostics";
  const reports: GameplaySpawnDiagnosticReport[] = [];

  options.expectations?.forEach((expectation) => {
    const actual = diagnostics[expectation.metric];
    if (actual === expectation.expected) {
      return;
    }
    reports.push({
      kind: "gameplay-spawn",
      code: "FERRUM_GAMEPLAY_SPAWN_FLUSH_EXPECTATION_MISMATCH",
      path: `${basePath}.${expectation.metric}`,
      message: `Spawn flush metric '${expectation.metric}' was ${actual}, expected ${expectation.expected}.`,
      expected: expectation.expected,
      actual,
      suggestion: expectation.suggestion ?? suggestionForSpawnDiagnosticMetric(expectation.metric),
      metric: expectation.metric,
      count: actual,
    });
  });

  if (options.includeActivity === true) {
    for (const metric of SPAWN_DIAGNOSTIC_METRICS) {
      const count = diagnostics[metric];
      if (count <= 0) {
        continue;
      }
      reports.push({
        kind: "gameplay-spawn",
        code: "FERRUM_GAMEPLAY_SPAWN_FLUSH_ACTIVITY",
        path: `${basePath}.${metric}`,
        message: `Spawn flush metric '${metric}' observed ${count}.`,
        expected: 0,
        actual: count,
        suggestion: suggestionForSpawnDiagnosticMetric(metric),
        metric,
        count,
      });
    }
  }

  return reports;
}

export function suggestionForSpawnDiagnosticMetric(
  metric: GameplaySpawnDiagnosticMetric,
): string {
  if (metric === "commandsDrained") {
    return "Check same-frame action triggers, wave spawns, and deferred spawn queue producers.";
  }
  if (metric === "projectileSpawns") {
    return "Inspect projectile action bindings, cooldowns, aim source, and queued projectile trigger frames.";
  }
  if (metric === "projectileArcsApplied") {
    return "Inspect projectile arc authoring on the source entity and height span setup.";
  }
  if (metric === "projectileShootAudioEventsPushed") {
    return "Check shoot sound id, audio event sink, and projectile spawn count for the same frame.";
  }
  if (metric === "prefabSpawns") {
    return "Inspect spawnPrefab action bindings, prefab id support, placement gates, and deferred queue capacity.";
  }
  if (metric === "prefabSpawnedPayloads") {
    return "Check prefab spawn command dispatch; each successful prefab spawn should produce one metadata payload.";
  }
  return "Check gameplay event sink wiring; prefabSpawned payloads should be pushed when the sink is available.";
}
