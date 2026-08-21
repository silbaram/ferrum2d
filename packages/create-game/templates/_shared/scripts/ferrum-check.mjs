#!/usr/bin/env node
import { spawn } from "node:child_process";

const REPORT_FORMAT = "ferrum2d.consumer.check.report";
const REPORT_VERSION = 1;
const OUTPUT_LIMIT = 4_000;

const steps = [
  nodeStep("validate", "npm run ferrum:validate", "scripts/ferrum-harness.mjs", "validate"),
  nodeStep("assets", "npm run ferrum:asset-validate", "scripts/ferrum-assets.mjs", "validate"),
  nodeStep("authoring", "npm run ferrum:authoring-report", "scripts/ferrum-harness.mjs", "authoring-report"),
  nodeStep("gameplayReplay", "npm run ferrum:replay-report", "scripts/ferrum-harness.mjs", "replay-report"),
  nodeStep("runtimeReplay", "npm run ferrum:runtime-replay-report", "scripts/ferrum-runtime-replay.mjs", "report"),
  packageStep("build", "npm run build", "build"),
];

const results = [];
for (const step of steps) {
  const result = await runStep(step);
  results.push(result);
  if (result.status === "failed") {
    break;
  }
}

const failed = results.find((result) => result.status === "failed");
const report = {
  format: REPORT_FORMAT,
  version: REPORT_VERSION,
  ok: failed === undefined && results.length === steps.length,
  check: {
    status: failed === undefined && results.length === steps.length ? "passed" : "failed",
    completedStepCount: results.filter((result) => result.status === "passed").length,
    totalStepCount: steps.length,
    steps: results,
    failedStep: failed?.id ?? null,
    nextCommand: failed?.command ?? null,
  },
  recommendedCommands: failed === undefined ? ["npm run dev"] : [failed.command],
  ...(failed === undefined ? {} : {
    reports: [{
      kind: "consumer-check",
      code: "FERRUM_CONSUMER_CHECK_FAILED",
      path: failed.id,
      message: `Ferrum2D project check failed at ${failed.id}.`,
      expected: "all required project checks pass",
      actual: `${failed.command} exited with code ${failed.exitCode}`,
      suggestion: `Run ${failed.command} for the full diagnostic, fix it, then rerun npm run ferrum:check.`,
    }],
  }),
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  process.exitCode = 1;
}

function nodeStep(id, command, script, argument) {
  return {
    id,
    command,
    executable: process.execPath,
    args: [script, argument],
  };
}

function packageStep(id, command, script) {
  const manager = packageManager();
  return {
    id,
    command,
    executable: manager.command,
    args: manager.kind === "yarn" ? [script] : ["run", script],
  };
}

async function runStep(step) {
  const result = await spawnCaptured(step.executable, step.args);
  return {
    id: step.id,
    command: step.command,
    status: result.exitCode === 0 ? "passed" : "failed",
    exitCode: result.exitCode,
    ...(result.exitCode === 0 ? {} : {
      diagnosticCodes: diagnosticCodes(`${result.stdout}\n${result.stderr}`),
      stdout: outputTail(result.stdout),
      stderr: outputTail(result.stderr),
    }),
  };
}

function spawnCaptured(executable, args) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      finish({ exitCode: 1, stdout, stderr: `${stderr}\n${error.message}`.trim() });
    });
    child.once("close", (code, signal) => {
      finish({
        exitCode: Number.isInteger(code) ? code : 1,
        stdout,
        stderr: signal === null ? stderr : `${stderr}\nterminated by ${signal}`.trim(),
      });
    });
  });
}

function diagnosticCodes(output) {
  return [...new Set([...output.matchAll(/"code"\s*:\s*"([A-Z0-9_]+)"/gu)].map((match) => match[1]))];
}

function outputTail(output) {
  const trimmed = output.trim();
  return trimmed.length <= OUTPUT_LIMIT ? trimmed : trimmed.slice(-OUTPUT_LIMIT);
}

function packageManager() {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm")) {
    return { kind: "pnpm", command: process.platform === "win32" ? "pnpm.cmd" : "pnpm" };
  }
  if (userAgent.startsWith("yarn")) {
    return { kind: "yarn", command: process.platform === "win32" ? "yarn.cmd" : "yarn" };
  }
  return { kind: "npm", command: process.platform === "win32" ? "npm.cmd" : "npm" };
}
