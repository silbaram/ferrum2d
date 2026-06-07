#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const CARGO_MANIFEST = "crates/ferrum-core/Cargo.toml";
const REPORT_PREFIX = "MASS_OBJECT_REPORT ";
const REPORT_FORMAT = "ferrum2d.mass-object-stress.smoke-report";
const REPORT_VERSION = 1;

const scenarios = Object.freeze([
  {
    id: "sparse-visible-horde",
    testName:
      "engine::tests::mass_objects::sparse_visible_horde_updates_one_thousand_enemies_without_pair_growth",
    purpose:
      "1,000 visible enemy entities update through the Shooter Rust frame loop without collision-pair growth.",
  },
  {
    id: "projectile-lane-horde",
    testName:
      "engine::tests::mass_objects::projectile_lane_horde_updates_projectiles_without_pair_growth",
    purpose:
      "1,000 visible enemy entities plus 512 projectile lane entities update without broad collision-pair growth.",
  },
  {
    id: "dense-lifecycle-horde",
    testName:
      "engine::tests::mass_objects::dense_lifecycle_horde_reports_collision_pair_budget",
    purpose:
      "128 overlapping enemy entities report the expected lifecycle collision-pair budget.",
  },
]);

const options = parseArgs(process.argv.slice(2));
if (options.list) {
  for (const scenario of scenarios) {
    console.log(`${scenario.id} - ${scenario.purpose}`);
  }
  process.exit(0);
}

const selected =
  options.scenarios.length === 0
    ? scenarios
    : scenarios.filter((scenario) => options.scenarios.includes(scenario.id));
const unknown = options.scenarios.filter((id) => !scenarios.some((scenario) => scenario.id === id));
if (unknown.length > 0) {
  fail(`unknown mass object stress scenario(s): ${unknown.join(", ")}`);
}

const results = selected.map(runScenario);
const ok = results.every((result) => result.ok);
const report = {
  format: REPORT_FORMAT,
  version: REPORT_VERSION,
  ok,
  scenarios: results,
  replayHash: hashReport(results.map((result) => ({
    id: result.id,
    ok: result.ok,
    metrics: stableMetrics(result.metrics),
  }))),
};

console.log(JSON.stringify(report, null, 2));
if (!ok) {
  process.exitCode = 1;
}

function parseArgs(args) {
  const scenarios = [];
  let list = false;
  for (const arg of args) {
    if (arg === "--list") {
      list = true;
    } else {
      scenarios.push(arg);
    }
  }
  return { list, scenarios };
}

function runScenario(scenario) {
  const started = Date.now();
  const result = spawnSync(
    "cargo",
    [
      "test",
      "--manifest-path",
      CARGO_MANIFEST,
      scenario.testName,
      "--",
      "--exact",
      "--nocapture",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, CARGO_TERM_COLOR: "never" },
    },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const metrics = parseMetrics(output);
  const ok = result.status === 0 && metrics !== undefined;
  return {
    id: scenario.id,
    purpose: scenario.purpose,
    ok,
    durationMs: Date.now() - started,
    metrics,
    ...(ok ? {} : { output: output.trim() }),
  };
}

function parseMetrics(output) {
  for (const line of output.split(/\r?\n/)) {
    if (!line.startsWith(REPORT_PREFIX)) {
      continue;
    }
    return JSON.parse(line.slice(REPORT_PREFIX.length));
  }
  return undefined;
}

function stableMetrics(metrics) {
  if (metrics === undefined) {
    return undefined;
  }
  const { updateMicros, ...stable } = metrics;
  return stable;
}

function hashReport(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function fail(message) {
  console.error(`mass object stress smoke failed: ${message}`);
  process.exit(1);
}
