#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { decodePng, encodePngRgba } from "../../scripts/tools/pack-textures.mjs";

const root = await mkdtemp(path.join(tmpdir(), "ferrum-pack-textures-"));
const inputDir = path.join(root, "sprites");
const outputImage = path.join(root, "public", "assets", "atlas.png");
const outputJson = path.join(root, "atlas.json");
const gameJson = path.join(root, "public", "game.json");

await writePng(path.join(inputDir, "hero.png"), 4, 2, [255, 0, 0, 255]);
await writePng(path.join(inputDir, "ui", "button.png"), 2, 2, [0, 255, 0, 255]);
await mkdir(path.dirname(gameJson), { recursive: true });
await writeFile(gameJson, `${JSON.stringify({
  world: { width: 320, height: 180 },
  atlas: {
    frames: {
      existing: {
        texture: "legacy",
        uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
        size: { width: 1, height: 1 },
      },
    },
  },
}, null, 2)}\n`);

const result = spawnSync(process.execPath, [
  "scripts/tools/pack-textures.mjs",
  "--input-dir",
  inputDir,
  "--output-image",
  outputImage,
  "--output-json",
  outputJson,
  "--game-json",
  gameJson,
  "--texture",
  "packed",
  "--padding",
  "1",
  "--max-size",
  "64",
], {
  cwd: process.cwd(),
  encoding: "utf8",
});

if (result.status !== 0) {
  throw new Error(`pack-textures CLI failed: ${result.stderr || result.stdout}`);
}

const atlas = decodePng(await readFile(outputImage));
const document = JSON.parse(await readFile(outputJson, "utf8"));
const game = JSON.parse(await readFile(gameJson, "utf8"));
if (atlas.width <= 0 || atlas.height <= 0 || atlas.pixels.length !== atlas.width * atlas.height * 4) {
  throw new Error("pack-textures did not create a valid atlas PNG.");
}
if (document.frames.hero.texture !== "packed" || document.frames["ui/button"].texture !== "packed") {
  throw new Error("pack-textures metadata is missing packed frames.");
}
if (!game.atlas.frames.existing || !game.atlas.frames.hero || !game.atlas.frames["ui/button"]) {
  throw new Error("pack-textures did not merge atlas frames into game.json.");
}
assertPixelColor(atlas, document.frames.hero, [255, 0, 0, 255]);
assertPixelColor(atlas, document.frames["ui/button"], [0, 255, 0, 255]);

const configRoot = path.join(root, "config-case");
const configInputDir = path.join(configRoot, "sprites");
const configOutputImage = path.join(configRoot, "atlas.png");
const configPath = path.join(configRoot, "texture-atlas.config.json");
await writePng(path.join(configInputDir, "odd.png"), 3, 3, [0, 0, 255, 255]);
await mkdir(configRoot, { recursive: true });
await writeFile(configPath, `${JSON.stringify({
  inputDir: configInputDir,
  outputImage: configOutputImage,
  padding: 0,
  powerOfTwo: false,
}, null, 2)}\n`);

const configResult = spawnSync(process.execPath, [
  "scripts/tools/pack-textures.mjs",
  "--config",
  configPath,
], {
  cwd: process.cwd(),
  encoding: "utf8",
});

if (configResult.status !== 0) {
  throw new Error(`pack-textures config CLI failed: ${configResult.stderr || configResult.stdout}`);
}

const configAtlas = decodePng(await readFile(configOutputImage));
if (configAtlas.width !== 3 || configAtlas.height !== 3) {
  throw new Error(`pack-textures config powerOfTwo=false was ignored: ${configAtlas.width}x${configAtlas.height}`);
}

console.log(JSON.stringify({
  packTexturesSmoke: {
    width: atlas.width,
    height: atlas.height,
    frames: Object.keys(document.frames),
  },
}, null, 2));

async function writePng(filePath, width, height, color) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const pixels = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels.set(color, offset);
  }
  await writeFile(filePath, encodePngRgba(width, height, pixels));
}

function assertPixelColor(atlas, frame, expected) {
  const x = Math.floor(frame.uv.u0 * atlas.width);
  const y = Math.floor(frame.uv.v0 * atlas.height);
  const offset = (y * atlas.width + x) * 4;
  for (let channel = 0; channel < 4; channel += 1) {
    if (atlas.pixels[offset + channel] !== expected[channel]) {
      throw new Error(`Unexpected atlas pixel at ${x},${y}: ${Array.from(atlas.pixels.slice(offset, offset + 4))}`);
    }
  }
}
