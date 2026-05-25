#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const CARGO_MANIFEST = "crates/ferrum-core/Cargo.toml";
const REPLAY_SEED = 0;
const REPLAY_FRAME = "rect-edit";

const scenarios = [
  {
    id: "destructible-terrain:tile-rect-edit",
    purpose: "tile occupancy rect edits keep collision queries and render commands synchronized",
    tests: [
      "tilemap::tests::set_tiles_rect_refreshes_collision_cache_and_render_commands",
      "engine::tests::engine_set_shooter_tilemap_tiles_rect_refreshes_queries_and_render_commands",
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
  fail(`unknown destructible terrain smoke scenario(s): ${unknownIds.join(", ")}`);
}

const results = selectedScenarios.map((scenario) => runScenario(scenario));
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

console.log(`destructible terrain smoke suite seed=${REPLAY_SEED} frame=${REPLAY_FRAME} replayHash=${suiteHash}`);

if (failed.length > 0) {
  fail(`${failed.length} destructible terrain smoke scenario(s) failed`);
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
  const testResults = scenario.tests.map((testName) => runCargoTest(testName));
  const output = testResults.map((testResult) => testResult.output).join("\n");
  const testCount = testResults.reduce((total, testResult) => total + testResult.testCount, 0);
  const status = testResults.every((testResult) => testResult.status === "passed") ? "passed" : "failed";

  return {
    id: scenario.id,
    purpose: scenario.purpose,
    status,
    tests: scenario.tests,
    testCount,
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
  console.error(`destructible terrain smoke failed: ${message}`);
  process.exit(1);
}
