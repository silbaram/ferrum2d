#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const command = process.argv[2] ?? "report";

try {
  if (command === "validate") {
    await validateProject();
  } else if (command === "smoke") {
    await validateProject();
    await runBuild();
  } else if (command === "report") {
    await printReport();
  } else {
    throw new Error(`Unknown ferrum harness command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function validateProject() {
  const result = await inspectProject();
  const errors = [];

  if (!result.hasFerrumDependency) {
    errors.push("package.json must depend on @ferrum2d/ferrum-web.");
  }
  if (!result.hasMainSource) {
    errors.push("src/main.ts is required.");
  }
  for (const importPath of result.internalImports) {
    errors.push(`Use the public package entrypoint instead of internal import: ${importPath}`);
  }
  if (result.gameSpec?.ok === false) {
    errors.push(`Game Spec validation failed at ${result.gameSpec.path}: ${result.gameSpec.message}`);
  }

  if (errors.length > 0) {
    console.error("Ferrum2D validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log("Ferrum2D validation ok");
  if (result.gameSpec?.ok === true) {
    console.log(`- game spec: ${result.gameSpec.file}`);
  } else {
    console.log("- game spec: not present, skipped");
  }
}

async function printReport() {
  const result = await inspectProject();
  const report = {
    packageName: result.packageJson.name,
    ferrumWeb: result.packageJson.dependencies?.["@ferrum2d/ferrum-web"] ?? null,
    scripts: result.packageJson.scripts ?? {},
    files: {
      main: result.hasMainSource,
      gameSpec: result.gameSpec?.file ?? null,
      publicAssets: result.publicAssets,
    },
    checks: {
      hasFerrumDependency: result.hasFerrumDependency,
      internalImports: result.internalImports,
      gameSpec: result.gameSpec ?? { ok: null, message: "not present" },
    },
    recommendedCommands: [
      "npm run ferrum:validate",
      "npm run ferrum:smoke",
      "npm run dev",
    ],
  };
  console.log(JSON.stringify(report, null, 2));
}

async function inspectProject() {
  const packageJson = await readJson(path.join(root, "package.json"));
  const mainPath = path.join(root, "src/main.ts");
  const hasMainSource = await exists(mainPath);
  const mainSource = hasMainSource ? await readFile(mainPath, "utf8") : "";
  const internalImports = [...mainSource.matchAll(/from\s+["'](@ferrum2d\/ferrum-web\/(?:dist|pkg|src)\/[^"']*)["']/g)]
    .map((match) => match[1]);
  return {
    packageJson,
    hasFerrumDependency: packageJson.dependencies?.["@ferrum2d/ferrum-web"] !== undefined,
    hasMainSource,
    internalImports,
    gameSpec: await inspectGameSpec(),
    publicAssets: await listPublicAssets(),
  };
}

async function inspectGameSpec() {
  const file = path.join(root, "public/game.json");
  if (!await exists(file)) return undefined;
  try {
    const source = await readFile(file, "utf8");
    const json = JSON.parse(source);
    const { resolveShooterGameSpec } = await import("@ferrum2d/ferrum-web");
    resolveShooterGameSpec(json);
    return { ok: true, file: path.relative(root, file) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const pathMatch = message.match(/path=['"]?([^'"\s]+)['"]?/);
    return {
      ok: false,
      file: path.relative(root, file),
      path: pathMatch?.[1] ?? "public/game.json",
      message,
    };
  }
}

async function listPublicAssets() {
  const publicRoot = path.join(root, "public");
  if (!await exists(publicRoot)) return [];
  const output = [];
  await walk(publicRoot, output);
  return output
    .map((file) => path.relative(publicRoot, file).split(path.sep).join("/"))
    .filter((file) => file !== "game.json")
    .sort();
}

async function walk(directory, output) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(entryPath, output);
    } else if (entry.isFile()) {
      output.push(entryPath);
    }
  }
}

async function runBuild() {
  const manager = packageManager();
  const args = manager === "yarn" ? ["build"] : ["run", "build"];
  await new Promise((resolve, reject) => {
    const child = spawn(manager, args, {
      cwd: root,
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Build failed with exit code ${code}.`));
    });
  });
}

function packageManager() {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm")) return "pnpm";
  if (userAgent.startsWith("yarn")) return "yarn";
  return "npm";
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
