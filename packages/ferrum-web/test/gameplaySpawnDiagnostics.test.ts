import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  gameplaySpawnDiagnosticReports,
  suggestionForSpawnDiagnosticMetric,
} from "../src/gameplaySpawnDiagnostics.js";
import type { SpawnFrameDiagnostics } from "../src/engineTypes.js";

const emptyDiagnostics: SpawnFrameDiagnostics = {
  commandsDrained: 0,
  projectileSpawns: 0,
  projectileArcsApplied: 0,
  projectileShootAudioEventsPushed: 0,
  prefabSpawns: 0,
  prefabSpawnedPayloads: 0,
  prefabSpawnedEventsPushed: 0,
};

test("gameplaySpawnDiagnosticReports returns no reports for a clean frame", () => {
  deepEqual(gameplaySpawnDiagnosticReports(emptyDiagnostics), []);
});

test("gameplaySpawnDiagnosticReports reports expectation mismatches with agent patch paths", () => {
  const reports = gameplaySpawnDiagnosticReports({
    ...emptyDiagnostics,
    prefabSpawns: 0,
    prefabSpawnedEventsPushed: 0,
  }, {
    path: "gameplayReplay.frames.12.spawnDiagnostics",
    expectations: [
      {
        metric: "prefabSpawns",
        expected: 1,
        suggestion: "Fix the state-enter spawnPrefab action or update the expected replay frame.",
      },
      {
        metric: "prefabSpawnedEventsPushed",
        expected: 1,
      },
    ],
  });

  deepEqual(reports, [
    {
      kind: "gameplay-spawn",
      code: "FERRUM_GAMEPLAY_SPAWN_FLUSH_EXPECTATION_MISMATCH",
      path: "gameplayReplay.frames.12.spawnDiagnostics.prefabSpawns",
      message: "Spawn flush metric 'prefabSpawns' was 0, expected 1.",
      expected: 1,
      actual: 0,
      suggestion: "Fix the state-enter spawnPrefab action or update the expected replay frame.",
      metric: "prefabSpawns",
      count: 0,
    },
    {
      kind: "gameplay-spawn",
      code: "FERRUM_GAMEPLAY_SPAWN_FLUSH_EXPECTATION_MISMATCH",
      path: "gameplayReplay.frames.12.spawnDiagnostics.prefabSpawnedEventsPushed",
      message: "Spawn flush metric 'prefabSpawnedEventsPushed' was 0, expected 1.",
      expected: 1,
      actual: 0,
      suggestion: "Check gameplay event sink wiring; prefabSpawned payloads should be pushed when the sink is available.",
      metric: "prefabSpawnedEventsPushed",
      count: 0,
    },
  ]);
});

test("gameplaySpawnDiagnosticReports can include positive spawn activity summaries", () => {
  const reports = gameplaySpawnDiagnosticReports({
    ...emptyDiagnostics,
    commandsDrained: 3,
    projectileSpawns: 2,
    projectileShootAudioEventsPushed: 1,
  }, {
    includeActivity: true,
  });

  deepEqual(reports.map((report) => ({
    code: report.code,
    path: report.path,
    metric: report.metric,
    count: report.count,
  })), [
    {
      code: "FERRUM_GAMEPLAY_SPAWN_FLUSH_ACTIVITY",
      path: "frame.spawnDiagnostics.commandsDrained",
      metric: "commandsDrained",
      count: 3,
    },
    {
      code: "FERRUM_GAMEPLAY_SPAWN_FLUSH_ACTIVITY",
      path: "frame.spawnDiagnostics.projectileSpawns",
      metric: "projectileSpawns",
      count: 2,
    },
    {
      code: "FERRUM_GAMEPLAY_SPAWN_FLUSH_ACTIVITY",
      path: "frame.spawnDiagnostics.projectileShootAudioEventsPushed",
      metric: "projectileShootAudioEventsPushed",
      count: 1,
    },
  ]);
});

test("suggestionForSpawnDiagnosticMetric keeps all spawn counters actionable", () => {
  equal(
    suggestionForSpawnDiagnosticMetric("prefabSpawnedEventsPushed"),
    "Check gameplay event sink wiring; prefabSpawned payloads should be pushed when the sink is available.",
  );
});
