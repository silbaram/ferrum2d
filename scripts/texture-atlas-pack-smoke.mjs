import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = await mkdtemp(path.join(tmpdir(), "ferrum-atlas-"));
const inputPath = path.join(root, "sprites.json");
const outputAPath = path.join(root, "atlas-a.json");
const outputBPath = path.join(root, "atlas-b.json");

const sprites = [
  { name: "hero", source: "hero.png", width: 32, height: 16 },
  { name: "crate", source: "crate.png", width: 16, height: 16 },
  { name: "spark", source: "spark.png", width: 8, height: 8 },
];
await writeFile(inputPath, `${JSON.stringify({ sprites }, null, 2)}\n`);

runPack(outputAPath);
await writeFile(inputPath, `${JSON.stringify({ sprites: [...sprites].reverse() }, null, 2)}\n`);
runPack(outputBPath);

const atlasA = JSON.parse(await readFile(outputAPath, "utf8"));
const atlasB = JSON.parse(await readFile(outputBPath, "utf8"));
if (JSON.stringify(atlasA) !== JSON.stringify(atlasB)) {
  throw new Error("texture atlas pack output must be deterministic regardless of input order.");
}
if (atlasA.format !== "ferrum-texture-atlas-pack" || atlasA.frames.hero.texture !== "packed") {
  throw new Error("texture atlas pack output is missing expected format or frame metadata.");
}
if (atlasA.placements.length !== 3 || atlasA.width <= 0 || atlasA.height <= 0) {
  throw new Error("texture atlas pack output is missing placements or dimensions.");
}

console.log(JSON.stringify({
  textureAtlasPackSmoke: {
    width: atlasA.width,
    height: atlasA.height,
    frames: Object.keys(atlasA.frames),
  },
}, null, 2));

function runPack(outputPath) {
  const result = spawnSync(process.execPath, [
    "scripts/texture-atlas-pack.mjs",
    "--input",
    inputPath,
    "--output",
    outputPath,
    "--texture",
    "packed",
    "--image",
    "packed.png",
    "--padding",
    "1",
    "--max-size",
    "128",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`texture atlas pack CLI failed: ${result.stderr || result.stdout}`);
  }
}
