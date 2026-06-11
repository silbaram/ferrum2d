import { readdir, readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function listPublicAssets(root, mode) {
  const publicRoot = path.join(root, "public");
  if (!await exists(publicRoot)) return [];
  if (mode === "flat") {
    const entries = await readdir(publicRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  }
  const output = [];
  await walk(publicRoot, output);
  return output
    .map((file) => path.relative(publicRoot, file).split(path.sep).join("/"))
    .filter((file) => file !== "game.json")
    .filter((file) => !file.startsWith("assets/"))
    .sort();
}

export async function runBuild(root) {
  const manager = packageManager();
  const args = manager === "yarn" ? ["build"] : ["run", "build"];
  await new Promise((resolve, reject) => {
    const child = spawn(manager, args, {
      cwd: root,
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Build failed with exit code ${code}.`)));
  });
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

function packageManager() {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm")) return "pnpm";
  if (userAgent.startsWith("yarn")) return "yarn";
  return "npm";
}
