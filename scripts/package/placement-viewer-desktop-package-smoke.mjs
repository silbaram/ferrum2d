#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const desktopRoot = path.join(repoRoot, "apps/placement-viewer-desktop");
const targetRoot = path.join(desktopRoot, "src-tauri/target/debug");
const options = parseArgs(process.argv.slice(2));

await assertDesktopSecurityConfig();

if (process.platform !== "linux") {
  throw new Error("placement viewer desktop package smoke currently supports the Linux deb artifact only");
}

if (!options.skipBuild) {
  run("pnpm", ["build:wasm"]);
  run("pnpm", ["--filter", "@ferrum2d/ferrum-web", "build"]);
  run("pnpm", [
    "--filter",
    "@ferrum2d/placement-viewer-desktop",
    "exec",
    "tauri",
    "build",
    "--debug",
    "--bundles",
    "deb",
    "--ci",
    "--no-sign",
  ]);
}

const binaryPath = path.join(targetRoot, "ferrum-placement-viewer-desktop");
const frontendRoot = path.join(repoRoot, "apps/placement-viewer/dist");
const debArtifacts = await filesWithSuffix(path.join(targetRoot, "bundle/deb"), ".deb");
const wasmArtifacts = await filesWithSuffix(frontendRoot, ".wasm");
await assertNonEmptyFile(binaryPath, "desktop executable");
await assertNonEmptyFile(path.join(frontendRoot, "index.html"), "packaged frontend index");
if (debArtifacts.length !== 1) {
  throw new Error(`expected exactly one Linux deb artifact, found ${debArtifacts.length}`);
}
await assertNonEmptyFile(debArtifacts[0], "Linux deb artifact");
if (wasmArtifacts.length === 0) {
  throw new Error("packaged frontend must contain at least one Wasm artifact");
}

const debContents = run("dpkg-deb", ["--contents", debArtifacts[0]], { capture: true });
if (!debContents.includes("ferrum-placement-viewer-desktop")) {
  throw new Error("Linux deb artifact does not contain the desktop executable");
}

let launch = { requested: options.launch, status: "not-requested" };
if (options.launch) {
  launch = await launchUnderXvfb(binaryPath, options.launchTimeoutMs);
}

const report = {
  format: "ferrum2d.placement-viewer-desktop.package-smoke",
  version: 1,
  status: "passed",
  platform: process.platform,
  reusedBuildArtifacts: options.skipBuild,
  binary: relativeArtifact(binaryPath),
  bundle: relativeArtifact(debArtifacts[0]),
  frontend: {
    index: relativeArtifact(path.join(frontendRoot, "index.html")),
    wasm: wasmArtifacts.map(relativeArtifact),
  },
  launch,
  manualReleaseGate: {
    required: true,
    checks: [
      "native project/file picker",
      "scene save within selected project",
      "ferrum-asset image rendering",
      "handoff synchronization",
      "nonblank interactive canvas evidence",
    ],
  },
};

if (options.artifactDir !== undefined) {
  const artifactDir = path.resolve(repoRoot, options.artifactDir);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, "placement-viewer-desktop-package-smoke.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

console.log(JSON.stringify(report, null, 2));

function parseArgs(args) {
  const parsed = {
    skipBuild: false,
    launch: false,
    launchTimeoutMs: 8_000,
    artifactDir: undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--") {
      continue;
    }
    if (value === "--skip-build") {
      parsed.skipBuild = true;
    } else if (value === "--launch") {
      parsed.launch = true;
    } else if (value === "--launch-timeout-ms") {
      parsed.launchTimeoutMs = positiveInteger(args[++index], value);
    } else if (value === "--artifact-dir") {
      parsed.artifactDir = requiredValue(args[++index], value);
    } else {
      throw new Error(`unknown argument '${value}'`);
    }
  }
  return parsed;
}

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = capture ? `\n${result.stdout}\n${result.stderr}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}${detail}`);
  }
  return capture ? result.stdout : "";
}

async function launchUnderXvfb(binaryPath, timeoutMs) {
  await access(binaryPath);
  const child = spawn("xvfb-run", ["-a", binaryPath], {
    cwd: desktopRoot,
    detached: true,
    env: {
      ...process.env,
      WEBKIT_DISABLE_COMPOSITING_MODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const earlyExit = await Promise.race([
    exit,
    new Promise((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
  ]);
  if (earlyExit !== undefined) {
    throw new Error(
      `desktop executable exited before ${timeoutMs}ms: ${JSON.stringify(earlyExit)}\n${stdout}\n${stderr}`,
    );
  }
  signalProcessGroup(child, "SIGTERM");
  const terminated = await Promise.race([
    exit,
    new Promise((resolve) => setTimeout(() => resolve(undefined), 2_000)),
  ]);
  if (terminated === undefined) {
    signalProcessGroup(child, "SIGKILL");
    const killed = await Promise.race([
      exit,
      new Promise((resolve) => setTimeout(() => resolve(undefined), 2_000)),
    ]);
    if (killed === undefined) {
      throw new Error("desktop executable process group did not exit after SIGKILL");
    }
  }
  return {
    requested: true,
    status: "stayed-alive",
    timeoutMs,
    termination: "process-group",
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

function signalProcessGroup(child, signal) {
  if (child.pid === undefined) {
    throw new Error(`cannot send ${signal}: desktop launcher has no process id`);
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (!isNodeErrorWithCode(error, "ESRCH")) {
      throw error;
    }
  }
}

function isNodeErrorWithCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

async function assertDesktopSecurityConfig() {
  const configPath = path.join(desktopRoot, "src-tauri/tauri.conf.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const csp = config?.app?.security?.csp;
  if (typeof csp !== "object" || csp === null || Array.isArray(csp)) {
    throw new Error("desktop package requires an explicit object-form CSP");
  }
  const requiredSources = {
    "default-src": ["'self'"],
    "base-uri": ["'none'"],
    "object-src": ["'none'"],
    "connect-src": [
      "'self'",
      "ipc:",
      "http://ipc.localhost",
      "ferrum-asset:",
      "http://ferrum-asset.localhost",
      "https://ferrum-asset.localhost",
    ],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "ferrum-asset:",
      "http://ferrum-asset.localhost",
      "https://ferrum-asset.localhost",
    ],
    "script-src": ["'self'", "'wasm-unsafe-eval'"],
    "style-src": ["'self'", "'unsafe-inline'"],
  };
  for (const [directive, expected] of Object.entries(requiredSources)) {
    const sources = new Set(String(csp[directive] ?? "").split(/\s+/).filter(Boolean));
    for (const source of expected) {
      if (!sources.has(source)) {
        throw new Error(`desktop CSP ${directive} must include ${source}`);
      }
    }
  }
}

async function filesWithSuffix(root, suffix) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await filesWithSuffix(entryPath, suffix));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

async function assertNonEmptyFile(file, label) {
  const info = await stat(file).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.size === 0) {
    throw new Error(`${label} is missing or empty: ${file}`);
  }
}

function relativeArtifact(file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

function requiredValue(value, option) {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function positiveInteger(value, option) {
  const parsed = Number.parseInt(requiredValue(value, option), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive integer`);
  }
  return parsed;
}
