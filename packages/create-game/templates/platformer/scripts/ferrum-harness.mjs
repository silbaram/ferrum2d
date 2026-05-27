#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const command = process.argv[2] ?? "report";

try {
  if (command === "validate") await validateProject();
  else if (command === "smoke") {
    await validateProject();
    await runBuild();
  } else if (command === "report") {
    console.log(JSON.stringify(await inspectProject(), null, 2));
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
  if (!result.hasFerrumDependency) errors.push("package.json must depend on @ferrum2d/ferrum-web.");
  if (!result.hasMainSource) errors.push("src/main.ts is required.");
  for (const importPath of result.internalImports) {
    errors.push(`Use the public package entrypoint instead of internal import: ${importPath}`);
  }
  if (errors.length > 0) {
    console.error("Ferrum2D validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log("Ferrum2D validation ok");
}

async function inspectProject() {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const mainPath = path.join(root, "src/main.ts");
  const hasMainSource = await exists(mainPath);
  const mainSource = hasMainSource ? await readFile(mainPath, "utf8") : "";
  return {
    packageName: packageJson.name,
    hasFerrumDependency: packageJson.dependencies?.["@ferrum2d/ferrum-web"] !== undefined,
    hasMainSource,
    internalImports: [...mainSource.matchAll(/from\s+["'](@ferrum2d\/ferrum-web\/(?:dist|pkg|src)\/[^"']*)["']/g)]
      .map((match) => match[1]),
  };
}

async function runBuild() {
  const manager = packageManager();
  const args = manager === "yarn" ? ["build"] : ["run", "build"];
  await new Promise((resolve, reject) => {
    const child = spawn(manager, args, { cwd: root, shell: process.platform === "win32", stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Build failed with exit code ${code}.`)));
  });
}

function packageManager() {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm")) return "pnpm";
  if (userAgent.startsWith("yarn")) return "yarn";
  return "npm";
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
