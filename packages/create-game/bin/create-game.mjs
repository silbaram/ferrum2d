#!/usr/bin/env node
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatesRoot = path.join(packageRoot, "templates");
const defaultTemplate = "minimal";
const defaultFerrumVersion = "^0.1.0";

try {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (!options.projectDir) {
    console.error("Missing project directory.");
    printHelp();
    process.exit(1);
  }

  await createGameProject(options);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(args) {
  const parsed = {
    ferrumVersion: defaultFerrumVersion,
    force: false,
    help: false,
    projectDir: undefined,
    template: defaultTemplate,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    if (arg === "--template") {
      parsed.template = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--template=")) {
      parsed.template = arg.slice("--template=".length);
      continue;
    }
    if (arg === "--ferrum-version") {
      parsed.ferrumVersion = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--ferrum-version=")) {
      parsed.ferrumVersion = arg.slice("--ferrum-version=".length);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (parsed.projectDir !== undefined) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    parsed.projectDir = arg;
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

async function createGameProject({ ferrumVersion, force, projectDir, template }) {
  const templateRoot = path.join(templatesRoot, template);
  await requireDirectory(templateRoot, `Unknown template '${template}'.`);

  const targetRoot = path.resolve(process.cwd(), projectDir);
  const targetName = path.basename(targetRoot);
  const packageName = toPackageName(targetName);
  const projectTitle = toTitle(targetName);

  await assertWritableTarget(targetRoot, force);
  await copyTemplate(templateRoot, targetRoot, {
    __FERRUM_WEB_VERSION__: ferrumVersion,
    __PROJECT_NAME__: packageName,
    __PROJECT_TITLE__: projectTitle,
  });

  console.log(`Created Ferrum2D game project at ${targetRoot}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  cd ${formatShellPath(targetRoot)}`);
  console.log("  npm install");
  console.log("  npm run dev");
  console.log("");
  console.log("For AI-assisted game development:");
  console.log("  npx @ferrum2d/agents init --tools codex,claude,gemini");
}

function formatShellPath(targetRoot) {
  const relativePath = path.relative(process.cwd(), targetRoot);
  if (!relativePath) return ".";
  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) return targetRoot;
  return relativePath;
}

async function requireDirectory(directoryPath, message) {
  try {
    const stats = await stat(directoryPath);
    if (!stats.isDirectory()) {
      throw new Error(message);
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(message);
    }
    throw error;
  }
}

async function assertWritableTarget(targetRoot, force) {
  try {
    const stats = await stat(targetRoot);
    if (!stats.isDirectory()) {
      throw new Error(`Target exists and is not a directory: ${targetRoot}`);
    }
    const entries = await readdir(targetRoot);
    if (entries.length > 0 && !force) {
      throw new Error(`Target directory is not empty: ${targetRoot}. Pass --force to write into it.`);
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      await mkdir(targetRoot, { recursive: true });
      return;
    }
    throw error;
  }
}

async function copyTemplate(sourceRoot, targetRoot, replacements) {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  await mkdir(targetRoot, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      await copyTemplate(sourcePath, targetPath, replacements);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const source = await readFile(sourcePath, "utf8");
    await writeFile(targetPath, replaceAll(source, replacements));
  }
}

function replaceAll(source, replacements) {
  let output = source;
  for (const [token, value] of Object.entries(replacements)) {
    output = output.split(token).join(value);
  }
  return output;
}

function toPackageName(name) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+/, "")
    .replace(/[._-]+$/, "")
    .replace(/-{2,}/g, "-");
  return slug || "ferrum2d-game";
}

function toTitle(name) {
  const words = toPackageName(name).split(/[-_]+/).filter(Boolean);
  if (words.length === 0) return "Ferrum2D Game";
  return words.map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

function printHelp() {
  console.log(`Usage:
  npm create @ferrum2d/game my-game
  npx @ferrum2d/create-game my-game [options]

Options:
  --template <name>          Template to use. Default: minimal
  --ferrum-version <range>   @ferrum2d/ferrum-web dependency range. Default: ^0.1.0
  --force                    Allow writing into a non-empty target directory
  -h, --help                 Show this help
`);
}
