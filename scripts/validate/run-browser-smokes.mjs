#!/usr/bin/env node
// Runs the browser smokes that CI no longer runs. CI verifies with unit tests only
// (docs/planning/ci-and-studio-distribution-plan.md, decision 5); these checks need a
// real browser or GPU and are run by hand, for example before a release.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("../../", import.meta.url));
export const steps = JSON.parse(readFileSync(new URL("./browser-smoke-steps.json", import.meta.url), "utf8"));
const groups = ["core", "extended", "all"];

export function parseArgs(args) {
  const options = { group: "core", only: [], list: false, prepare: true, stopOnFailure: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--list") options.list = true;
    else if (arg === "--skip-prepare") options.prepare = false;
    else if (arg === "--stop-on-failure") options.stopOnFailure = true;
    else if (arg === "--group" || arg === "--only") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === "--group") {
        if (!groups.includes(value)) throw new Error(`--group must be one of ${groups.join(", ")}`);
        options.group = value;
      } else {
        options.only.push(value.toLowerCase());
      }
    } else {
      throw new Error(`unknown option ${arg}`);
    }
  }
  return options;
}

export function selectSteps(options) {
  const checks = options.group === "all" ? [...steps.core, ...steps.extended] : steps[options.group];
  const selected = options.only.length === 0
    ? checks
    : checks.filter(step => options.only.some(text => step.name.toLowerCase().includes(text)));
  if (selected.length === 0) throw new Error("no browser smoke matches the selection");
  // Extended matrix entries are self-contained pnpm scripts that build what they need.
  const needsPrepare = options.prepare && selected.some(step => steps.core.includes(step));
  return { prepare: needsPrepare ? steps.prepare : [], checks: selected };
}

function readGithubEnv(path, env) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const separator = line.indexOf("=");
    if (separator > 0) env[line.slice(0, separator)] = line.slice(separator + 1);
  }
}

function run(step, env) {
  const started = Date.now();
  // Same shell flags as a GitHub Actions `run:` step.
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.run], {
    cwd: repository,
    env: { ...env, ...step.env },
    stdio: "inherit",
    timeout: step.timeoutMinutes ? step.timeoutMinutes * 60_000 : undefined,
  });
  readGithubEnv(env.GITHUB_ENV, env);
  const ok = result.status === 0;
  return { name: step.name, ok, minutes: (Date.now() - started) / 60_000, reason: ok ? "" : result.error?.message ?? `exit ${result.status ?? result.signal}` };
}

function usage() {
  return `Usage: pnpm smoke:browser-local [--group core|extended|all] [--only <text>]... [--skip-prepare] [--stop-on-failure] [--list]

Runs the browser smokes removed from CI. Requires Chromium for Playwright
(pnpm exec playwright-core install chromium) and, for the Studio host checks,
the desktop Linux packages that the validate-studio-desktop job in .github/workflows/ci.yml installs.
Extended runs write runtime budget reports to artifacts/browser-smoke-budgets/.
  --group core      the former browser-smoke job (default)
  --group extended  the former extended-browser-smoke matrix
  --only <text>     run steps whose name contains <text> (repeatable)
  --skip-prepare    reuse existing Wasm, SDK and Studio builds`;
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const { prepare, checks } = selectSteps(options);
  if (options.list) {
    for (const step of [...prepare, ...checks]) console.log(step.name);
    return 0;
  }
  const temp = resolve(repository, "artifacts/browser-smoke-local");
  rmSync(temp, { recursive: true, force: true });
  mkdirSync(temp, { recursive: true });
  const env = { ...process.env, RUNNER_TEMP: temp, GITHUB_ENV: join(temp, "github-env") };
  for (const step of prepare) {
    console.log(`\n[browser-smoke-local] prepare: ${step.name}`);
    const result = run(step, env);
    if (!result.ok) {
      console.error(`[browser-smoke-local] prepare failed: ${step.name} (${result.reason})`);
      return 1;
    }
  }
  const results = [];
  for (const step of checks) {
    console.log(`\n[browser-smoke-local] ${step.name}`);
    const result = run(step, env);
    results.push(result);
    if (!result.ok && options.stopOnFailure) break;
  }
  console.log("\n[browser-smoke-local] summary");
  for (const result of results) {
    console.log(`${result.ok ? "pass" : "FAIL"}  ${result.minutes.toFixed(1)}m  ${result.name}${result.ok ? "" : `  (${result.reason})`}`);
  }
  const failed = results.filter(result => !result.ok).length;
  console.log(`${results.length - failed} passed, ${failed} failed, ${checks.length - results.length} not run`);
  return failed === 0 && results.length === checks.length ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`[browser-smoke-local] ${error.message}`);
    process.exitCode = 1;
  }
}
