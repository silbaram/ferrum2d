import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHARED_HARNESS_FILE = "examples/shared/runtimeDemoShell.ts";
const SHARED_STYLE_FILE = "examples/shared/runtimeDemoShell.css";
const LOCAL_BOILERPLATE_PATTERN = /function\s+(?:appendDiagnosticContext|cleanupResources|createButton|renderBootstrapError)\s*\(/g;
const SHARED_HARNESS_IMPORT_PATTERN = /from\s+["'][^"'\n]*shared\/runtimeDemoShell["']/u;
const SHARED_SHELL_CALL_PATTERN = /\bcreateRuntimeDemoShell\s*\(/u;

const SURFACES = [
  {
    id: "starter-runtime",
    file: "examples/starter-runtime/src/main.ts",
    mode: "shared-shell",
    style: "shared-default",
  },
  {
    id: "breakout",
    file: "examples/breakout/src/main.ts",
    mode: "shared-shell",
    style: "shared-theme-override",
  },
  {
    id: "minimal-game",
    file: "examples/minimal-game/src/main.ts",
    mode: "shared-shell",
    style: "shared-theme-override",
  },
  {
    id: "platformer",
    file: "examples/platformer/src/main.ts",
    mode: "shared-shell",
    style: "shared-theme-override",
  },
  {
    id: "physics-sandbox",
    file: "examples/physics-sandbox/src/main.ts",
    mode: "shared-primitives",
    style: "specialized-showcase",
    reason: "scenario, material, debug, query, and step controls require a specialized showcase shell",
  },
  {
    id: "topdown-shooter",
    file: "examples/topdown-shooter/src/main.ts",
    mode: "shared-primitives",
    style: "specialized-showcase",
    reason: "the direct renderer/platform bootstrap and debug panel are part of the showcase contract",
  },
  {
    id: "placement-viewer",
    file: "apps/placement-viewer/src/main.ts",
    mode: "shared-shell",
    style: "pixelforge-authoring-theme",
    reason: "the authoring viewer keeps its Pixelforge IDE CSS while sharing shell behavior",
  },
];

const format = reportFormat(process.argv.slice(2));
const surfaces = await Promise.all(SURFACES.map(readSurface));
const exampleEntrypoints = await discoverConventionalSourceFiles("examples", "main.ts");
const harnessImplementationFiles = [
  ...(existsSync(path.join(REPOSITORY_ROOT, SHARED_HARNESS_FILE)) ? [SHARED_HARNESS_FILE] : []),
  ...await discoverConventionalSourceFiles("examples", "runtimeDemoShell.ts"),
  ...await discoverConventionalSourceFiles("apps", "runtimeDemoShell.ts"),
].sort();
const duplicatedHarnessFiles = harnessImplementationFiles.filter((file) => file !== SHARED_HARNESS_FILE);
const errors = [];

for (const file of duplicatedHarnessFiles) {
  errors.push(`${file} must not duplicate the shared runtime demo shell`);
}
const registeredExampleEntrypoints = new Set(
  SURFACES.filter((surface) => surface.file.startsWith("examples/")).map((surface) => surface.file),
);
for (const file of exampleEntrypoints) {
  if (!registeredExampleEntrypoints.has(file)) {
    errors.push(`${file} must be registered in the example demo harness report`);
  }
}
for (const surface of surfaces) {
  if (!surface.usesSharedHarness) {
    errors.push(`${surface.file} must import ${SHARED_HARNESS_FILE}`);
  }
  if (surface.mode === "shared-shell" && !surface.usesSharedShell) {
    errors.push(`${surface.file} must call createRuntimeDemoShell(...)`);
  }
  if (surface.localBoilerplateFunctionCount !== 0) {
    errors.push(`${surface.file} must not define local demo button/diagnostic/cleanup helpers`);
  }
}

const sharedHarness = await sourceMeasurement(SHARED_HARNESS_FILE);
const sharedStyle = await sourceMeasurement(SHARED_STYLE_FILE);
const report = {
  format: "ferrum2d.example-demo-harness.report",
  version: 1,
  ok: errors.length === 0,
  sharedHarness: {
    implementationCount: existsSync(path.join(REPOSITORY_ROOT, SHARED_HARNESS_FILE)) ? 1 : 0,
    duplicatedImplementationCount: duplicatedHarnessFiles.length,
    implementationFiles: harnessImplementationFiles,
    source: sharedHarness,
    style: sharedStyle,
  },
  surfaces,
  errors,
};

process.stdout.write(format === "json" ? `${JSON.stringify(report, null, 2)}\n` : markdownReport(report));
if (!report.ok) process.exitCode = 1;

async function readSurface(surface) {
  const measurement = await sourceMeasurement(surface.file);
  const source = await readFile(path.join(REPOSITORY_ROOT, surface.file), "utf8");
  return {
    ...surface,
    ...measurement,
    usesSharedHarness: SHARED_HARNESS_IMPORT_PATTERN.test(source),
    usesSharedShell: SHARED_SHELL_CALL_PATTERN.test(source),
    localBoilerplateFunctionCount: [...source.matchAll(LOCAL_BOILERPLATE_PATTERN)].length,
  };
}

async function discoverConventionalSourceFiles(parent, fileName) {
  const parentPath = path.join(REPOSITORY_ROOT, parent);
  const entries = await readdir(parentPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.posix.join(parent, entry.name, "src", fileName))
    .filter((file) => existsSync(path.join(REPOSITORY_ROOT, file)))
    .sort();
}

async function sourceMeasurement(file) {
  const source = await readFile(path.join(REPOSITORY_ROOT, file), "utf8");
  const lines = source.length === 0 ? [] : source.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  return {
    file,
    lines: lines.length,
    nonBlankLines: lines.filter((line) => line.trim().length > 0).length,
  };
}

function reportFormat(args) {
  const argument = args.find((value) => value.startsWith("--format="));
  const value = argument?.slice("--format=".length) ?? "markdown";
  if (value !== "json" && value !== "markdown") {
    throw new Error(`Unsupported report format '${value}'. Use json or markdown.`);
  }
  return value;
}

function markdownReport(report) {
  const lines = [
    "# Example Demo Harness Report",
    "",
    `- status: ${report.ok ? "passed" : "failed"}`,
    `- shared TypeScript implementations: ${report.sharedHarness.implementationCount}`,
    `- duplicated TypeScript implementations: ${report.sharedHarness.duplicatedImplementationCount}`,
    `- shared harness: ${report.sharedHarness.source.lines} lines (${report.sharedHarness.source.nonBlankLines} nonblank)`,
    `- shared style: ${report.sharedHarness.style.lines} lines (${report.sharedHarness.style.nonBlankLines} nonblank)`,
    "",
    "| Surface | Integration | Entrypoint lines | Nonblank | Local boilerplate | Style |",
    "| --- | --- | ---: | ---: | ---: | --- |",
    ...report.surfaces.map((surface) =>
      `| ${surface.id} | ${surface.mode} | ${surface.lines} | ${surface.nonBlankLines} | ${surface.localBoilerplateFunctionCount} | ${surface.style} |`),
  ];
  const reasons = report.surfaces.filter((surface) => surface.reason);
  if (reasons.length > 0) {
    lines.push("", "## Specialized surface reasons", "");
    for (const surface of reasons) lines.push(`- ${surface.id}: ${surface.reason}`);
  }
  if (report.errors.length > 0) {
    lines.push("", "## Errors", "");
    for (const error of report.errors) lines.push(`- ${error}`);
  }
  return `${lines.join("\n")}\n`;
}
