#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const engineName = "@ferrum2d/ferrum-web";
const installArgs = ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"];

export function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--skip-build") options.skipBuild = true;
    else if (arg === "--help") options.help = true;
    else if (["--project", "--wasm-cache"].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      options[arg === "--project" ? "project" : "wasmCache"] = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.help && !options.project) throw new Error("Use --project <game project directory>");
  return options;
}

export function windowsPath(project) {
  const match = /^\/mnt\/([a-z])\/(.+)$/i.exec(project);
  return match ? `${match[1].toUpperCase()}:\\${match[2].replaceAll("/", "\\")}` : null;
}

export function powershellCommand(command, args, cwd) {
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  const script = `$ErrorActionPreference='Stop'\n$ProgressPreference='SilentlyContinue'\n` +
    `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()\nSet-Location -LiteralPath ${quote(cwd)}\n` +
    `& ${quote(command)} ${args.map(quote).join(" ")}\nexit $LASTEXITCODE`;
  return ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
}

async function exists(file) {
  try { await readFile(file); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function json(file) { return JSON.parse(await readFile(file, "utf8")); }
async function save(file, value) { await writeFile(file, `${JSON.stringify(value, null, 2)}\n`); }

export async function installLocalEngine(options) {
  // Convert a literal Windows argument before resolving symlinks and choosing npm.
  let project = options.project;
  if (process.platform !== "win32" && /^[a-z]:[\\/]/i.test(project)) {
    project = `/mnt/${project[0].toLowerCase()}/${project.slice(3).replaceAll("\\", "/")}`;
  }
  project = await realpath(path.resolve(project));
  if (project === repoRoot || project.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error("Choose an external game project, not the engine workspace");
  }
  const packageFile = path.join(project, "package.json");
  const original = await json(packageFile);
  if (!original.dependencies?.[engineName]) throw new Error(`Project must already depend on ${engineName}`);
  if (await exists(path.join(project, "pnpm-lock.yaml")) || await exists(path.join(project, "yarn.lock"))) {
    throw new Error("This helper supports npm projects; do not mix package managers");
  }
  const nativeWindows = process.platform === "win32";
  const windowsProject = nativeWindows ? project : windowsPath(project);
  const powershell = nativeWindows ? "powershell.exe" : "/mnt/c/windows/System32/WindowsPowerShell/v1.0/powershell.exe";
  const source = path.join(repoRoot, "packages/ferrum-web");
  const metadata = await json(path.join(source, "package.json"));
  const id = `${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${randomUUID().slice(0, 8)}`;
  const output = path.join(repoRoot, "artifacts/local-engine", id);
  await mkdir(output, { recursive: true });
  const report = { format: "ferrum2d.local-engine.install", version: 1, status: "preparing", project,
    build: !options.skipBuild, commands: [], backup: null };
  const reportFile = path.join(output, "report.json");
  const run = async (command, args, cwd, env = process.env, display = `${command} ${args.join(" ")}`) => {
    console.log(`[local-engine] ${display}`);
    const entry = { command, args, cwd, display, exitCode: null };
    report.commands.push(entry);
    const log = path.join(output, `${String(report.commands.length).padStart(2, "0")}.log`);
    let childCommand = command;
    let childArgs = args;
    if (nativeWindows && /\.cmd$/.test(command)) {
      childCommand = powershell;
      childArgs = powershellCommand(command, args, cwd);
    }
    let contents = "";
    const childEnv = { ...env };
    // Node test-runner IPC must not leak into CLI subprocess output.
    delete childEnv.NODE_TEST_CONTEXT;
    await new Promise((resolve, reject) => {
      const child = spawn(childCommand, childArgs, { cwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
      for (const [stream, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
        stream.on("data", (chunk) => {
          contents += chunk.toString();
          if (!process.env.NODE_TEST_CONTEXT) destination.write(chunk);
        });
      }
      child.once("error", reject);
      child.once("close", (code) => { entry.exitCode = code; resolve(); });
    }).finally(async () => { await writeFile(log, contents); await save(reportFile, report); });
    if (entry.exitCode !== 0) throw new Error(`${command} failed (exit ${entry.exitCode}); see ${log}`);
    return contents;
  };
  const npm = async (args) => {
    if (windowsProject) return run(powershell, powershellCommand("npm.cmd", args, windowsProject), repoRoot, process.env, `Windows npm ${args.join(" ")}`);
    return run("npm", args, project);
  };
  const pnpm = nativeWindows ? "pnpm.cmd" : "pnpm";
  const backupEntries = ["package.json", "package-lock.json", "node_modules/.package-lock.json", "node_modules/@ferrum2d/ferrum-web"];
  let mutated = false;
  const present = [];
  try {
    // Preflight interop/npm before any target writes. Never run Linux npm on a Windows project.
    await npm(["--version"]);
    if (!options.skipBuild) {
      const env = { ...process.env };
      if (options.wasmCache) env.XDG_CACHE_HOME = path.resolve(options.wasmCache);
      await run(process.execPath, ["scripts/build/build-wasm.mjs"], repoRoot, env);
      await run(pnpm, ["--filter", engineName, "build"], repoRoot);
    }
    await run(process.execPath, ["scripts/package/check-package-files.mjs", "--require-wasm-pkg", "--verify-pack"], repoRoot);
    const stage = path.join(output, "stage");
    await mkdir(stage);
    for (const entry of metadata.files) {
      if (entry.includes("*") || entry.split(/[\\/]/).includes("..") || path.isAbsolute(entry)) {
        throw new Error(`Unsupported package allowlist: ${entry}`);
      }
      await cp(path.join(source, entry), path.join(stage, entry), { recursive: true });
    }
    const version = `${metadata.version.split("-")[0]}-local.${id.replaceAll("-", ".")}`;
    // Change only staged metadata. Avoid workspace pack lifecycle hooks in the isolated stage.
    await save(path.join(stage, "package.json"), { ...metadata, version, private: true, scripts: {} });
    await run(pnpm, ["pack", "--pack-destination", output], stage);
    const filename = `ferrum2d-ferrum-web-${version}.tgz`;
    const tarball = path.join(output, filename);
    const sha256 = createHash("sha256").update(await readFile(tarball)).digest("hex");
    const backup = path.join(project, ".local-engine-backup", id);
    await mkdir(backup, { recursive: true });
    report.backup = backup;
    for (const entry of backupEntries) {
      try {
        await cp(path.join(project, entry), path.join(backup, entry), { recursive: true });
        present.push(entry);
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    report.package = { version, sha256, file: `vendor/${filename}` };
    await save(reportFile, report);
    // Detect edits while the build was running rather than overwriting them.
    if (JSON.stringify(await json(packageFile)) !== JSON.stringify(original)) {
      throw new Error("Game package.json changed during the build; retry after that edit completes");
    }
    await mkdir(path.join(project, "vendor"), { recursive: true });
    await cp(tarball, path.join(project, "vendor", filename));
    mutated = true;
    await save(packageFile, { ...original,
      dependencies: { ...original.dependencies, [engineName]: `file:vendor/${filename}` },
      ferrumLocalEngine: { version, package: `vendor/${filename}`, sha256, source: repoRoot,
        releaseBaseline: original.ferrumGithubRelease?.version ?? null },
    });
    await npm(installArgs);
    const installed = await json(path.join(project, "node_modules/@ferrum2d/ferrum-web/package.json"));
    if (installed.version !== version) throw new Error("npm retained a stale engine version");
    // Compare installed JS/Wasm bytes, not just npm's version metadata.
    const compare = async (directory) => {
      for (const entry of await readdir(path.join(stage, directory), { withFileTypes: true })) {
        const relative = path.join(directory, entry.name);
        if (entry.isDirectory()) await compare(relative);
        else if (!(await readFile(path.join(stage, relative))).equals(await readFile(path.join(project, "node_modules/@ferrum2d/ferrum-web", relative)))) {
          throw new Error(`Installed engine differs from the build: ${relative}`);
        }
      }
    };
    await compare("dist");
    await compare("pkg");
    // Remove only Vite's dependency cache; the user restarts an already running server.
    await rm(path.join(project, "node_modules/.vite"), { recursive: true, force: true });
    const importArgs = ["--input-type=module", "-e", "await import('@ferrum2d/ferrum-web/core'); await import('@ferrum2d/ferrum-web/authoring'); console.log('Local engine imports OK')"];
    if (windowsProject) await run(powershell, powershellCommand("node.exe", importArgs, windowsProject), repoRoot, process.env, "Windows Node: public import smoke");
    else await run(process.execPath, importArgs, project);
    for (const script of ["ferrum:check", "ferrum:local-check"]) {
      if (original.scripts?.[script]) await npm(["run", script]);
    }
    report.status = "passed";
    await save(path.join(backup, "report.json"), report);
    console.log(`\nInstalled ${version}\nReport: ${reportFile}\nRestart the game dev server: npm run dev -- --force`);
  } catch (error) {
    report.status = "failed";
    report.error = error.message;
    if (mutated) {
      try {
        for (const entry of backupEntries) {
          await rm(path.join(project, entry), { recursive: true, force: true });
          if (present.includes(entry)) await cp(path.join(report.backup, entry), path.join(project, entry), { recursive: true });
        }
        report.rollback = "engine and package metadata restored from backup";
      } catch (rollbackError) { report.rollback = `restore failed: ${rollbackError.message}`; }
    }
    throw error;
  } finally {
    await save(reportFile, report);
    await rm(path.join(output, "stage"), { recursive: true, force: true });
  }
  return { output, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log("pnpm engine:local --project <directory> [--skip-build] [--wasm-cache <XDG cache directory>]");
    else await installLocalEngine(options);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
