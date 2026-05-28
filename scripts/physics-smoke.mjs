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
  })),
});

for (const result of results) {
  const status = result.status === "passed" ? "PASS" : "FAIL";
  console.log(
    `${status} ${result.id} tests=${result.testCount} seed=${REPLAY_SEED} frame=${REPLAY_FRAME} replayHash=${result.replayHash}`,
  );
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
  const status = testResults.every((testResult) => testResult.status === "passed") ? "passed" : "failed";

  return {
    id: scenario.id,
    purpose: scenario.purpose,
    status,
    tests: scenario.tests,
    testCount,
    durationMs,
    replayHash: hashReplay({
      seed: REPLAY_SEED,
      frame: REPLAY_FRAME,
      id: scenario.id,
      status,
      tests: scenario.tests,
      testCount,
    }),
    output,
  };
}

function runCargoTest(testName) {
  const result = spawnSync("cargo", ["test", "--manifest-path", CARGO_MANIFEST, testName, "--", "--exact"], {
    encoding: "utf8",
    env: { ...process.env, CARGO_TERM_COLOR: "never" },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const testCount = parsePassedTestCount(output);
  const status = result.status === 0 && testCount > 0 ? "passed" : "failed";

  return {
    testName,
    status,
    testCount,
    output,
  };
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
