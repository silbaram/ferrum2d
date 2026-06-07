#!/usr/bin/env node
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatesRoot = path.join(packageRoot, "templates");
const allowedTools = new Set(["codex", "claude", "gemini"]);
const markerStart = "<!-- ferrum2d-consumer-agents:start -->";
const markerEnd = "<!-- ferrum2d-consumer-agents:end -->";

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }
  await initAgents(options);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(args) {
  const parsed = {
    command: "init",
    dryRun: false,
    force: false,
    help: false,
    instructions: true,
    target: ".",
    tools: ["codex", "claude", "gemini"],
  };

  let index = 0;
  if (args[0] && !args[0].startsWith("-")) {
    parsed.command = args[0];
    index = 1;
  }

  for (; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    if (arg === "--no-instructions") {
      parsed.instructions = false;
      continue;
    }
    if (arg === "--target") {
      parsed.target = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--target=")) {
      parsed.target = arg.slice("--target=".length);
      continue;
    }
    if (arg === "--tools") {
      parsed.tools = parseTools(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--tools=")) {
      parsed.tools = parseTools(arg.slice("--tools=".length));
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (parsed.command !== "init") {
    throw new Error(`Unknown command: ${parsed.command}`);
  }

  return parsed;
}

function requireValue(args, index, optionName) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${optionName}.`);
  }
  return value;
}

function parseTools(value) {
  const tools = value.split(",").map((tool) => tool.trim().toLowerCase()).filter(Boolean);
  const expanded = tools.includes("all") ? ["codex", "claude", "gemini"] : tools;
  for (const tool of expanded) {
    if (!allowedTools.has(tool)) {
      throw new Error(`Unknown tool '${tool}'. Expected one of: codex, claude, gemini, all.`);
    }
  }
  return [...new Set(expanded)];
}

async function initAgents({ dryRun, force, instructions, target, tools }) {
  const targetRoot = path.resolve(process.cwd(), target);
  if (!dryRun) {
    await mkdir(targetRoot, { recursive: true });
  }

  const copyPlans = [
    { from: path.join(templatesRoot, "shared"), tools: ["codex", "claude", "gemini"] },
  ];
  if (tools.includes("codex")) {
    copyPlans.push({ from: path.join(templatesRoot, "codex"), tools: ["codex"] });
  }
  if (tools.includes("claude")) {
    copyPlans.push({ from: path.join(templatesRoot, "claude"), tools: ["claude"] });
  }
  if (tools.includes("gemini")) {
    copyPlans.push({ from: path.join(templatesRoot, "gemini"), tools: ["gemini"] });
  }

  const results = [];
  for (const plan of copyPlans) {
    if (!plan.tools.some((tool) => tools.includes(tool))) continue;
    results.push(...await copyTree(plan.from, targetRoot, { dryRun, force }));
  }

  if (instructions) {
    if (tools.includes("codex")) {
      results.push(await upsertInstructionFile(path.join(targetRoot, "AGENTS.md"), codexInstructions(), { dryRun, force }));
    }
    if (tools.includes("claude")) {
      results.push(await upsertInstructionFile(path.join(targetRoot, "CLAUDE.md"), claudeInstructions(), { dryRun, force }));
    }
    if (tools.includes("gemini")) {
      results.push(await upsertInstructionFile(path.join(targetRoot, "GEMINI.md"), geminiInstructions(), { dryRun, force }));
    }
  }

  reportResults(results, targetRoot, dryRun);
}

async function copyTree(sourceRoot, targetRoot, options, prefix = "") {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const relativePath = path.join(prefix, entry.name);
    const targetPath = path.join(targetRoot, relativePath);
    if (entry.isDirectory()) {
      results.push(...await copyTree(sourcePath, targetRoot, options, relativePath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    results.push(await copyFile(sourcePath, targetPath, options));
  }

  return results;
}

async function copyFile(sourcePath, targetPath, { dryRun, force }) {
  const relativeTarget = path.relative(process.cwd(), targetPath);
  const exists = await fileExists(targetPath);
  if (exists && !force) {
    return { action: "skip", path: relativeTarget, reason: "exists" };
  }
  if (!dryRun) {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, await readFile(sourcePath, "utf8"));
  }
  return { action: exists ? "replace" : "create", path: relativeTarget };
}

async function upsertInstructionFile(filePath, block, { dryRun, force }) {
  const relativePath = path.relative(process.cwd(), filePath);
  const markedBlock = `${markerStart}\n${block.trim()}\n${markerEnd}\n`;
  const exists = await fileExists(filePath);
  if (!exists) {
    if (!dryRun) {
      await writeFile(filePath, `${markedBlock}`);
    }
    return { action: "create", path: relativePath };
  }

  const current = await readFile(filePath, "utf8");
  const start = current.indexOf(markerStart);
  const end = current.indexOf(markerEnd);
  if (start !== -1 && end !== -1 && end > start) {
    if (!force) {
      return { action: "skip", path: relativePath, reason: "instruction block exists" };
    }
    const next = `${current.slice(0, start)}${markedBlock}${current.slice(end + markerEnd.length).replace(/^\n/, "")}`;
    if (!dryRun) {
      await writeFile(filePath, next);
    }
    return { action: "replace", path: relativePath };
  }

  if (!dryRun) {
    const separator = current.endsWith("\n") ? "\n" : "\n\n";
    await writeFile(filePath, `${current}${separator}${markedBlock}`);
  }
  return { action: "append", path: relativePath };
}

async function fileExists(filePath) {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function reportResults(results, targetRoot, dryRun) {
  const summary = new Map();
  for (const result of results) {
    summary.set(result.action, (summary.get(result.action) ?? 0) + 1);
  }
  const prefix = dryRun ? "Dry run complete" : "Ferrum2D consumer agents installed";
  console.log(`${prefix}: ${targetRoot}`);
  for (const [action, count] of summary) {
    console.log(`  ${action}: ${count}`);
  }
  const skipped = results.filter((result) => result.action === "skip");
  if (skipped.length > 0) {
    console.log("");
    console.log("Skipped files:");
    for (const result of skipped) {
      console.log(`  ${result.path} (${result.reason})`);
    }
    console.log("");
    console.log("Pass --force to replace managed files.");
  }
}

function codexInstructions() {
  return `
# Ferrum2D Consumer Development

Use these agents only for games that depend on @ferrum2d/ferrum-web.

- consumer_project_agent: project setup, Vite/TypeScript runtime wiring, package scripts.
- consumer_architecture_agent: module boundaries, bootstrap-only entrypoints, public API seams.
- consumer_game_spec_agent: game.json and Ferrum2D Game Spec changes.
- consumer_asset_agent: public assets, texture/audio manifests, loading paths.
- consumer_gameplay_agent: game-side gameplay integration through public APIs.
- consumer_playtest_agent: local playtest, smoke checks, debug overlay evidence.
- consumer_build_agent: production build, static deploy artifact checks.

Read .agents/harness/ferrum-game-development.md for the shared harness. Prefer npm run ferrum:report, npm run ferrum:validate, and npm run ferrum:smoke when those scripts are available. For data-driven gameplay changes, also prefer npm run ferrum:authoring-report and npm run ferrum:replay-report when the project provides them. Treat report output as evidence after checking format, version, ok, and failure reports with path/message/suggestion.

Do not use these agents for Ferrum2D engine internals, Rust/Wasm core changes, renderer implementation, npm package publishing, or release management.
`;
}

function claudeInstructions() {
  return `
# Ferrum2D Consumer Development

Use the consumer-* project agents and ferrum-consumer-* skills only for games that depend on @ferrum2d/ferrum-web.

- consumer-project-agent: project setup, Vite/TypeScript runtime wiring, package scripts.
- consumer-architecture-agent: module boundaries, bootstrap-only entrypoints, public API seams.
- consumer-game-spec-agent: game.json and Ferrum2D Game Spec changes.
- consumer-asset-agent: public assets, texture/audio manifests, loading paths.
- consumer-gameplay-agent: game-side gameplay integration through public APIs.
- consumer-playtest-agent: local playtest, smoke checks, debug overlay evidence.
- consumer-build-agent: production build, static deploy artifact checks.

Read .agents/harness/ferrum-game-development.md for the shared harness. Prefer npm run ferrum:report, npm run ferrum:validate, and npm run ferrum:smoke when those scripts are available. For data-driven gameplay changes, also prefer npm run ferrum:authoring-report and npm run ferrum:replay-report when the project provides them. Treat report output as evidence after checking format, version, ok, and failure reports with path/message/suggestion.

Do not use these agents for Ferrum2D engine internals, Rust/Wasm core changes, renderer implementation, npm package publishing, or release management.
`;
}

function geminiInstructions() {
  return `
# Ferrum2D Consumer Development

Use GEMINI.md plus the /ferrum:* project commands for games that depend on @ferrum2d/ferrum-web.

Gemini CLI officially discovers project context through GEMINI.md and project commands through .gemini/commands/*.toml. Ferrum2D installs /ferrum:project, /ferrum:architecture, /ferrum:game-spec, /ferrum:assets, /ferrum:gameplay, /ferrum:playtest, and /ferrum:build commands. Shared skill instructions are installed under .agents/skills/ and referenced by those commands; do not add duplicate .gemini/skills wrappers unless Gemini changes its discovery rules.

Read .agents/harness/ferrum-game-development.md for the shared harness. Prefer npm run ferrum:report, npm run ferrum:validate, and npm run ferrum:smoke when those scripts are available. For data-driven gameplay changes, also prefer npm run ferrum:authoring-report and npm run ferrum:replay-report when the project provides them. Treat report output as evidence after checking format, version, ok, and failure reports with path/message/suggestion.

Do not use these agents for Ferrum2D engine internals, Rust/Wasm core changes, renderer implementation, npm package publishing, or release management.
`;
}

function printHelp() {
  console.log(`Usage:
  npx @ferrum2d/agents init [options]

Options:
  --target <dir>             Project root to update. Default: .
  --tools <list>             Comma list: codex,claude,gemini,all. Default: codex,claude,gemini
  --no-instructions          Do not create or update AGENTS.md, CLAUDE.md, GEMINI.md
  --dry-run                  Print what would change without writing files
  --force                    Replace existing managed files
  -h, --help                 Show this help
`);
}
