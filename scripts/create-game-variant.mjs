#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveShooterGameSpec } from "../packages/ferrum-web/dist/gameSpec.js";

const BASE_SPEC_PATH = "examples/topdown-shooter/public/game.json";

const VARIANTS = {
  "fast-enemies": {
    enemies: {
      speed: 128,
      spawnInterval: 0.55,
      behavior: "chase",
      spawnPattern: "edge",
      health: 2,
      scoreReward: 2,
    },
    weapons: {
      cooldown: 0.1,
      damage: 1,
    },
  },
  "drift-swarm": {
    enemies: {
      speed: 96,
      spawnInterval: 0.35,
      behavior: "drift",
      spawnPattern: "corners",
      health: 1,
      scoreReward: 1,
    },
    prefabs: {
      enemy: {
        width: 18,
        height: 18,
      },
    },
  },
  "static-targets": {
    enemies: {
      speed: 72,
      spawnInterval: 0.45,
      behavior: "static",
      spawnPattern: "center",
      health: 3,
      scoreReward: 3,
    },
    weapons: {
      bulletSpeed: 520,
      cooldown: 0.08,
      damage: 2,
    },
  },
};

const [variantName, outputPath = `examples/topdown-shooter/public/game.${variantName}.json`] =
  process.argv.slice(2);

if (!variantName || !VARIANTS[variantName]) {
  console.error(`Usage: node scripts/create-game-variant.mjs <variant> [output.json]`);
  console.error(`Variants: ${Object.keys(VARIANTS).join(", ")}`);
  process.exit(1);
}

const base = JSON.parse(await readFile(BASE_SPEC_PATH, "utf8"));
const variant = mergeSpec(base, VARIANTS[variantName]);

resolveShooterGameSpec(variant);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(variant, null, 2)}\n`);
console.log(`${outputPath}: created ${variantName}`);

function mergeSpec(base, patch) {
  const result = structuredClone(base);
  for (const [section, values] of Object.entries(patch)) {
    result[section] = {
      ...(result[section] ?? {}),
      ...values,
    };
  }
  return result;
}
