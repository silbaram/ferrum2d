#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const CARGO_MANIFEST = "crates/ferrum-core/Cargo.toml";
const REPLAY_SEED = 0;
const REPLAY_FRAME = "suite";

const scenarios = [
  {
    id: "physics:stacked-boxes",
    purpose: "stack stability, sleeping island stats, and solver drift regression",
    tests: [
      "physics::tests::rigid_body_sleep_wake::rigid_body_step_puts_idle_dynamic_body_to_sleep",
      "physics::tests::rigid_body_islands::rigid_body_island_stats_reports_active_and_sleeping_islands",
      "physics::tests::contact_block_solver::rigid_body_contact_block_solver_handles_two_point_aabb_face_contact",
    ],
  },
  {
    id: "physics:joint-chain",
    purpose: "joint constraint accumulation and breakage guard rails",
    tests: [
      "physics::tests::rigid_body_joints::rope_joint::rope_joint_clamps_dynamic_body_to_max_length",
      "physics::tests::rigid_body_joints::spring_joint::spring_joint_pulls_stretched_body_toward_rest_length",
      "physics::tests::rigid_body_joints::revolute_joint::revolute_joint_moves_dynamic_anchor_to_static_anchor",
      "physics::tests::rigid_body_joints::prismatic_joint::prismatic_joint_corrects_perpendicular_drift",
      "physics::tests::rigid_body_joints::weld_joint::weld_joint_locks_local_anchor_and_relative_angle",
    ],
  },
  {
    id: "physics:joint-despawn-budget",
    purpose: "high-degree joint graph cascade correctness and cleanup runtime budget",
    tests: [
      "world::tests::joints::high_degree_joint_graph_despawn_stays_within_runtime_budget",
    ],
    requiredBudgetMetrics: [
      {
        metric: "joint-despawn",
        maxElapsedMicros: 250_000,
        jointCount: 32_768,
      },
    ],
  },
  {
    id: "physics:fast-projectile-ccd",
    purpose: "fast body tunneling prevention across supported rigid shapes",
    tests: [
      "physics::tests::rigid_body_ccd::rigid_body_ccd_aabb::rigid_body_step_uses_ccd_for_fast_dynamic_aabb",
      "physics::tests::rigid_body_ccd::rigid_body_ccd_shape_pairs::rigid_body_step_uses_ccd_for_fast_dynamic_circle_against_aabb",
      "physics::tests::rigid_body_ccd::rigid_body_ccd_shape_pairs::rigid_body_step_uses_ccd_for_fast_dynamic_capsule_against_aabb",
      "physics::tests::rigid_body_ccd::rigid_body_ccd_shape_pairs::rigid_body_step_uses_ccd_for_fast_dynamic_oriented_box_against_aabb",
      "physics::tests::rigid_body_ccd::rigid_body_ccd_convex::rigid_body_step_uses_ccd_for_fast_dynamic_convex_polygon_against_aabb",
    ],
  },
  {
    id: "physics:tile-edge-snagging",
    purpose: "edge collider contact and cast regressions used by tile/platformer terrain",
    tests: [
      "collision::tests::pair_filters::build_pairs_supports_edge_colliders",
      "collision::tests::contact_builders::build_contacts_supports_circle_edge_pairs",
      "collision::tests::contact_builders::build_contacts_supports_capsule_edge_pairs",
      "collision::tests::raycasts::segment_cast_returns_edge_hit",
      "collision::tests::shape_cast::shape_cast_supports_capsule_shape_against_stored_edge",
    ],
  },
  {
    id: "physics:moving-platform-character",
    purpose: "moving platform carry and character controller behavior",
    tests: [
      "physics::tests::kinematic_platformer::moving_platforms::carry_moving_platform_moves_grounded_rider_by_platform_delta",
      "physics::tests::kinematic_platformer::controller_state::platformer_controller_with_tilemap_lands_on_tile_obstacle",
      "physics::tests::kinematic_platformer::controller_slope_step::platformer_controller_steps_over_low_tilemap_obstacle",
      "physics::tests::kinematic_platformer::controller_slope_step::platformer_controller_snaps_up_walkable_slope",
    ],
  },
  {
    id: "physics:hd2d-navigation-combat",
    purpose: "HD-2D bridge portal navigation, projectile arc, projectile/tile height filtering, and render ordering",
    tests: [
      "tilemap::tests::navigation::navigation_path_between_height_spans_uses_bridge_portal_floor_edge",
      "engine::tests::physics_queries::engine_query_tilemap_navigation_between_height_spans_uses_bridge_portal",
      "shooter_scene::tests::combat::projectile_arc_updates_bullet_height_span_before_combat",
      "shooter_scene::tests::combat::bullet_tile_collision_requires_overlapping_height_span_when_authored",
      "engine::tests::rendering::render_commands_sort_entities_by_hd2d_floor_elevation_and_foot_y",
    ],
  },
  {
    id: "physics:query-cast-matrix",
    purpose: "overlap, raycast, segment cast, and shape-cast matrix coverage",
    tests: [
      "collision::tests::area_queries::aabb_and_circle_queries_support_convex_polygon_colliders",
      "collision::tests::raycasts::raycast_returns_capsule_side_hit_with_surface_normal",
      "collision::tests::raycasts::raycast_returns_edge_hit_with_surface_normal",
      "collision::tests::shape_cast::shape_cast_supports_convex_polygon_shape_against_stored_capsule",
      "collision::tests::shape_cast::shape_cast_supports_capsule_shape_against_stored_convex_polygon",
    ],
  },
];

const selectedIds = parseArgs(process.argv.slice(2));
if (selectedIds.list) {
  for (const scenario of scenarios) {
    console.log(`${scenario.id} - ${scenario.purpose}`);
  }
  process.exit(0);
}

const selectedScenarios =
  selectedIds.values.length === 0 ? scenarios : scenarios.filter((scenario) => selectedIds.values.includes(scenario.id));
const unknownIds = selectedIds.values.filter((id) => !scenarios.some((scenario) => scenario.id === id));
if (unknownIds.length > 0) {
  fail(`unknown physics smoke scenario(s): ${unknownIds.join(", ")}`);
}

const results = [];
for (const scenario of selectedScenarios) {
  results.push(runScenario(scenario));
}

const failed = results.filter((result) => result.status !== "passed");
const suiteHash = hashReplay({
  seed: REPLAY_SEED,
  frame: REPLAY_FRAME,
  scenarios: results.map((result) => ({
    id: result.id,
    status: result.status,
    tests: result.tests,
    testCount: result.testCount,
    budgetRequirements: result.budgetRequirements,
  })),
});

for (const result of results) {
  const status = result.status === "passed" ? "PASS" : "FAIL";
  console.log(
    `${status} ${result.id} tests=${result.testCount} seed=${REPLAY_SEED} frame=${REPLAY_FRAME} replayHash=${result.replayHash}`,
  );
  for (const metric of result.budgetMetrics) {
    console.log(
      `BUDGET ${result.id} metric=${metric.metric} elapsedMicros=${metric.elapsedMicros} maxElapsedMicros=${metric.maxElapsedMicros} jointCount=${metric.jointCount}`,
    );
  }
  if (result.status !== "passed") {
    console.log(result.output.trim());
  }
}

console.log(`physics smoke suite seed=${REPLAY_SEED} frame=${REPLAY_FRAME} replayHash=${suiteHash}`);

if (failed.length > 0) {
  fail(`${failed.length} physics smoke scenario(s) failed`);
}

function parseArgs(args) {
  const values = [];
  let list = false;
  for (const arg of args) {
    if (arg === "--list") {
      list = true;
    } else {
      values.push(arg);
    }
  }
  return { list, values };
}

function runScenario(scenario) {
  const started = Date.now();
  const testResults = scenario.tests.map((testName) => runCargoTest(testName));
  const durationMs = Date.now() - started;
  const output = testResults.map((testResult) => testResult.output).join("\n");
  const testCount = testResults.reduce((total, testResult) => total + testResult.testCount, 0);
  const budgetMetrics = testResults.flatMap((testResult) => testResult.budgetMetrics);
  const requiredBudgetMetrics = scenario.requiredBudgetMetrics ?? [];
  const requiredBudgetsPassed = requiredBudgetMetrics.every((requirement) =>
    budgetMetrics.some(
      (budget) =>
        budget.metric === requirement.metric &&
        budget.maxElapsedMicros === requirement.maxElapsedMicros &&
        budget.jointCount === requirement.jointCount &&
        budget.elapsedMicros <= requirement.maxElapsedMicros,
    ),
  );
  const reportedBudgetsPassed = budgetMetrics.every(
    (budget) => budget.elapsedMicros <= budget.maxElapsedMicros,
  );
  const status =
    testResults.every((testResult) => testResult.status === "passed") &&
    requiredBudgetsPassed &&
    reportedBudgetsPassed
      ? "passed"
      : "failed";

  return {
    id: scenario.id,
    purpose: scenario.purpose,
    status,
    tests: scenario.tests,
    testCount,
    durationMs,
    budgetMetrics,
    budgetRequirements: requiredBudgetMetrics,
    replayHash: hashReplay({
      seed: REPLAY_SEED,
      frame: REPLAY_FRAME,
      id: scenario.id,
      status,
      tests: scenario.tests,
      testCount,
      budgetRequirements: requiredBudgetMetrics,
    }),
    output,
  };
}

function runCargoTest(testName) {
  const result = spawnSync(
    "cargo",
    ["test", "--manifest-path", CARGO_MANIFEST, testName, "--", "--exact", "--nocapture"],
    {
      encoding: "utf8",
      env: { ...process.env, CARGO_TERM_COLOR: "never" },
    },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const testCount = parsePassedTestCount(output);
  const status = result.status === 0 && testCount > 0 ? "passed" : "failed";

  return {
    testName,
    status,
    testCount,
    budgetMetrics: parseBudgetMetrics(output),
    output,
  };
}

function parseBudgetMetrics(output) {
  const matches = output.matchAll(
    /ferrum2d\.physics-budget metric=([^\s]+) elapsedMicros=([0-9]+) maxElapsedMicros=([0-9]+) jointCount=([0-9]+)/g,
  );
  return [...matches].map((match) => ({
    metric: match[1],
    elapsedMicros: Number(match[2]),
    maxElapsedMicros: Number(match[3]),
    jointCount: Number(match[4]),
  }));
}

function parsePassedTestCount(output) {
  const summaries = [...output.matchAll(/test result: ok\. ([0-9]+) passed;/g)];
  if (summaries.length === 0) {
    return 0;
  }
  return summaries.reduce((total, match) => total + Number(match[1]), 0);
}

function hashReplay(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function fail(message) {
  console.error(`physics smoke failed: ${message}`);
  process.exit(1);
}
