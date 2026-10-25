#!/usr/bin/env node
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  execute,
  printFailure,
  repositoryRoot,
  sha256,
  tool,
  toolRoot,
} from "./sprite-normals-tool.mjs";

export const wasmToolRoot = resolve(dirname(toolRoot), "wasm-web");
const patchPath = resolve(
  repositoryRoot,
  "scripts/tools/sprite-normals-wasm.patch",
);
const MEMORY_BYTES = 256 * 1024 * 1024;
const moduleName = "spritefusion_sprite_normals";

/** Read the actual Wasm memory section, without allocating the module's maximum heap. */
export function wasmMemoryLimits(data) {
  if (data.subarray(0, 8).toString("hex") !== "0061736d01000000")
    throw new Error("Invalid Wasm header");
  let offset = 8;
  const uint = () => {
    let value = 0,
      shift = 0;
    for (let i = 0; i < 5; i++) {
      const byte = data[offset++];
      if (byte === undefined) throw new Error("Truncated Wasm integer");
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
      shift += 7;
    }
    throw new Error("Invalid Wasm integer");
  };
  while (offset < data.length) {
    const id = data[offset++],
      length = uint(),
      end = offset + length;
    if (end > data.length) throw new Error("Truncated Wasm section");
    if (id === 5) {
      if (uint() !== 1 || uint() !== 1)
        throw new Error("Expected one bounded unshared memory");
      const initialBytes = uint() * 65536,
        maxBytes = uint() * 65536;
      if (offset !== end || initialBytes > maxBytes || maxBytes > 2 ** 32)
        throw new Error("Invalid Wasm memory limits");
      return { initialBytes, maxBytes };
    }
    offset = end;
  }
  throw new Error("Generator must declare bounded memory");
}

export async function validateSpriteNormalWasmBundle(root = wasmToolRoot) {
  const bytes = await readFile(resolve(root, "manifest.json")),
    manifest = JSON.parse(bytes);
  if (
    manifest.format !== "ferrum2d.sprite-normal.generator" ||
    manifest.version !== 1 ||
    manifest.target !== "wasm32-unknown-unknown" ||
    Object.entries(tool).some(
      ([key, value]) => manifest.generator?.[key] !== value,
    ) ||
    manifest.adapterSha256 !== sha256(await readFile(patchPath)) ||
    manifest.memoryMaxBytes !== MEMORY_BYTES
  )
    throw new Error(
      "Generator Wasm provenance differs; review and remove the managed cache before rebuilding",
    );
  for (const [kind, path] of [
    ["module", moduleName + ".js"],
    ["wasm", moduleName + "_bg.wasm"],
    ["license", "LICENSE"],
  ]) {
    const entry = manifest[kind],
      data = await readFile(resolve(root, path));
    if (
      entry?.path !== path ||
      entry.bytes !== data.length ||
      entry.sha256 !== sha256(data)
    )
      throw new Error(`Generator ${kind} integrity differs`);
    if (kind === "wasm" && wasmMemoryLimits(data).maxBytes !== MEMORY_BYTES)
      throw new Error("Wasm memory maximum differs");
  }
  return { root, manifest, manifestSha256: sha256(bytes) };
}

/** Optional generator build only; never invoked by engine build/package commands. */
export async function buildSpriteNormalsWasm() {
  let exists = true;
  try {
    await lstat(wasmToolRoot);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    exists = false;
  }
  if (exists) return await validateSpriteNormalWasmBundle();
  await mkdir(dirname(wasmToolRoot), { recursive: true });
  const stage = await mkdtemp(resolve(dirname(wasmToolRoot), ".wasm-build-")),
    source = resolve(stage, "source"),
    bundle = resolve(stage, "bundle");
  const run = async (command, args, options = {}) => {
    process.stderr.write(
      `[sprite-normals-wasm] ${command} ${args.join(" ")}\n`,
    );
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
    let origin = tool.repository;
    try {
      await lstat(resolve(toolRoot, "source/.git"));
      origin = resolve(toolRoot, "source");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await run("git", [
      "clone",
      "--no-hardlinks",
      "--no-checkout",
      origin,
      source,
    ]);
    await run("git", ["-C", source, "checkout", "--detach", tool.revision]);
    if (
      (await run("git", ["-C", source, "rev-parse", "HEAD"])) !== tool.revision
    )
      throw new Error("Upstream revision differs");
    const license = await readFile(resolve(source, "LICENSE"));
    if (
      !license.toString().startsWith("MIT License") ||
      !license.toString().includes("Hugo Duprez")
    )
      throw new Error("Upstream MIT notice differs");
    const lockSha256 = sha256(await readFile(resolve(source, "Cargo.lock")));
    await run("git", ["-C", source, "apply", "--check", patchPath]);
    await run("git", ["-C", source, "apply", patchPath]);
    await run("cargo", [
      "fmt",
      "--manifest-path",
      resolve(source, "Cargo.toml"),
      "--",
      "--check",
    ]);
    const rustc = await run("rustup", ["which", "rustc"]);
    const env = {
      ...process.env,
      PATH: dirname(rustc) + ":" + (process.env.PATH ?? ""),
      CARGO_TARGET_DIR: resolve(stage, "target"),
      RUSTFLAGS: "-C link-arg=--max-memory=" + MEMORY_BYTES,
    };
    await run(
      "wasm-pack",
      [
        "build",
        source,
        "--target",
        "web",
        "--out-dir",
        bundle,
        "--no-opt",
        "--no-pack",
        "--",
        "--no-default-features",
        "--locked",
      ],
      { env },
    );
    await copyFile(resolve(source, "LICENSE"), resolve(bundle, "LICENSE"));
    const entry = async (path) => {
      const data = await readFile(resolve(bundle, path));
      return { path, bytes: data.length, sha256: sha256(data) };
    };
    const wasm = await entry(moduleName + "_bg.wasm");
    if (
      wasmMemoryLimits(await readFile(resolve(bundle, wasm.path))).maxBytes !==
      MEMORY_BYTES
    )
      throw new Error("Wasm memory cap not encoded");
    const manifest = {
      format: "ferrum2d.sprite-normal.generator",
      version: 1,
      generator: tool,
      adapterSha256: sha256(await readFile(patchPath)),
      cargoLockSha256: lockSha256,
      target: "wasm32-unknown-unknown",
      memoryMaxBytes: MEMORY_BYTES,
      module: await entry(moduleName + ".js"),
      wasm,
      license: await entry("LICENSE"),
    };
    await writeFile(
      resolve(bundle, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      { flag: "wx" },
    );
    await rename(bundle, wasmToolRoot);
    return await validateSpriteNormalWasmBundle();
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 2)
      throw new Error("Usage: pnpm normals:wasm:build");
    console.log(JSON.stringify(await buildSpriteNormalsWasm(), null, 2));
  } catch (error) {
    printFailure(error);
  }
}
