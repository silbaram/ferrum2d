#!/usr/bin/env node
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

const wasmPackArgs = [
  "build",
  "crates/ferrum-core",
  "--target",
  "web",
  "--out-dir",
  "../../packages/ferrum-web/pkg",
];

const env = { ...process.env };
const rustupRustc = spawnSync("rustup", ["which", "rustc"], {
  encoding: "utf8",
});

if (rustupRustc.status === 0) {
  const rustupBin = dirname(rustupRustc.stdout.trim());
  env.PATH = `${rustupBin}:${env.PATH ?? ""}`;
}

const result = spawnSync("wasm-pack", wasmPackArgs, {
  env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
