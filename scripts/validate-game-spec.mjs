#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolveShooterGameSpec } from "../packages/ferrum-web/dist/gameSpec.js";

const paths = process.argv.slice(2);

if (paths.length === 0) {
  console.error("Usage: node scripts/validate-game-spec.mjs <game.json> [...]");
  process.exitCode = 1;
} else {
  for (const path of paths) {
    try {
      const source = await readFile(path, "utf8");
      const parsed = JSON.parse(source);
      const resolved = resolveShooterGameSpec(parsed);
      console.log(`${path}: ok`);
      console.log(JSON.stringify(resolved, null, 2));
    } catch (error) {
      console.error(`${path}: failed`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
