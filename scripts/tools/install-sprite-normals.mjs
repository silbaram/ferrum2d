#!/usr/bin/env node
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
  lstat,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  binaryName,
  execute,
  installedTool,
  printFailure,
  sha256,
  tool,
  toolRoot,
} from "./sprite-normals-tool.mjs";

/** Optional asset tooling only. Engine builds never invoke this installer. */
export async function installSpriteNormals() {
  try {
    await lstat(toolRoot);
    return (await installedTool()).manifest;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(toolRoot), { recursive: true });
  const temporary = await mkdtemp(resolve(dirname(toolRoot), ".install-"));
  const source = resolve(temporary, "source");
  const run = async (command, args, options = {}) => {
    process.stderr.write(`[sprite-normals] ${command} ${args.join(" ")}\n`);
    try {
      const result = await execute(command, args, {
        timeout: 15 * 60_000,
        maxBuffer: 4 * 1024 * 1024,
        ...options,
      });
      process.stderr.write(result.stderr);
      return result.stdout.trim();
    } catch (error) {
      process.stderr.write(error.stderr ?? "");
      throw error;
    }
  };
  try {
    await run("git", ["clone", "--no-checkout", tool.repository, source]);
    await run("git", ["-C", source, "checkout", "--detach", tool.revision]);
    if (
      (await run("git", ["-C", source, "rev-parse", "HEAD"])) !== tool.revision
    )
      throw new Error("Upstream revision differs");
    const license = await readFile(resolve(source, "LICENSE"), "utf8");
    if (!license.startsWith("MIT License") || !license.includes("Hugo Duprez"))
      throw new Error("Upstream license differs; review the pinned source");
    await run("cargo", [
      "build",
      "--release",
      "--locked",
      "--manifest-path",
      resolve(source, "Cargo.toml"),
      "--target-dir",
      resolve(temporary, "target"),
      "--bin",
      tool.name,
    ]);
    const binary = resolve(temporary, "target/release", binaryName);
    const version = await run(binary, ["--version"]);
    if (version !== `${tool.name} ${tool.version}`)
      throw new Error("Generator version differs");
    await mkdir(resolve(temporary, "bin"));
    await copyFile(binary, resolve(temporary, "bin", binaryName));
    await copyFile(resolve(source, "LICENSE"), resolve(temporary, "LICENSE"));
    const manifest = {
      ...tool,
      platform: process.platform,
      arch: process.arch,
      binarySha256: sha256(await readFile(binary)),
      installedAt: new Date().toISOString(),
    };
    await writeFile(
      resolve(temporary, "installation.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    // Keep the reviewed source/lockfile/license; compiled intermediates can be rebuilt.
    await rm(resolve(temporary, "target"), { recursive: true, force: true });
    await rename(temporary, toolRoot);
    return (await installedTool()).manifest;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length > 2)
    printFailure(new Error("Usage: pnpm normals:install"));
  else
    try {
      process.stdout.write(
        JSON.stringify(await installSpriteNormals(), null, 2) + "\n",
      );
    } catch (error) {
      printFailure(error);
    }
}
