#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AudioAssetLoader,
  LocalizationBundle,
  importAsepriteAtlas,
  resolveShooterGameSpec,
} from "../../packages/ferrum-web/dist/index.js";
import { decodePng, encodePngRgba } from "../../scripts/tools/pack-textures.mjs";

const root = await mkdtemp(path.join(tmpdir(), "ferrum-asset-pipeline-e2e-"));
const spritesDir = path.join(root, "raw", "sprites");
const audioFile = path.join(root, "raw", "audio", "sfx", "blip.wav");
const localizationFile = path.join(root, "raw", "locales", "ui.json");
const publicDir = path.join(root, "public");
const gameJsonFile = path.join(publicDir, "game.json");
const atlasImageFile = path.join(publicDir, "assets", "atlas.png");
const atlasJsonFile = path.join(root, "artifacts", "atlas.json");

await writePng(path.join(spritesDir, "hero.png"), 4, 2, [240, 52, 74, 255]);
await writePng(path.join(spritesDir, "ui", "button.png"), 2, 2, [38, 214, 168, 255]);
await mkdir(path.dirname(audioFile), { recursive: true });
await writeFile(audioFile, wavFixtureBytes());
await mkdir(path.dirname(localizationFile), { recursive: true });
await writeFile(localizationFile, `${JSON.stringify(localizationDocument(), null, 2)}\n`);

await mkdir(publicDir, { recursive: true });
await writeFile(gameJsonFile, `${JSON.stringify({
  world: { width: 320, height: 180 },
  prefabs: {
    player: { frame: "hero" },
    enemy: { frame: "ui/button" },
  },
  audio: {
    masterVolume: 0.8,
    sfxVolume: 0.65,
    events: {
      shoot: { volume: 0.4, pitch: 1.05 },
    },
  },
  content: {
    localization: JSON.parse(await readFile(localizationFile, "utf8")),
  },
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

const packResult = spawnSync(process.execPath, [
  "scripts/tools/pack-textures.mjs",
  "--input-dir",
  spritesDir,
  "--output-image",
  atlasImageFile,
  "--output-json",
  atlasJsonFile,
  "--game-json",
  gameJsonFile,
  "--texture",
  "pipeline-atlas",
  "--padding",
  "1",
  "--max-size",
  "64",
], {
  cwd: process.cwd(),
  encoding: "utf8",
});

if (packResult.status !== 0) {
  throw new Error(`asset pipeline texture packing failed: ${packResult.stderr || packResult.stdout}`);
}

const atlasPng = decodePng(await readFile(atlasImageFile));
const atlasDocument = JSON.parse(await readFile(atlasJsonFile, "utf8"));
const packedGameSpec = JSON.parse(await readFile(gameJsonFile, "utf8"));
assert(atlasPng.width > 0 && atlasPng.height > 0, "texture packer must emit a non-empty atlas PNG");
assertFrame(atlasDocument.frames.hero, "pipeline-atlas", 4, 2);
assertFrame(atlasDocument.frames["ui/button"], "pipeline-atlas", 2, 2);
assertFrame(packedGameSpec.atlas.frames.hero, "pipeline-atlas", 4, 2);
assertFrame(packedGameSpec.atlas.frames["ui/button"], "pipeline-atlas", 2, 2);

const asepriteImport = importAsepriteAtlas(asepriteDocument(), {
  texture: "aseprite-sheet",
  frameNamePrefix: "aseprite/",
  sizeSource: "source",
});
assertFrame(asepriteImport.atlas.frames["aseprite/laser"], "aseprite-sheet", 6, 2);

const resolvedGameSpec = resolveShooterGameSpec({
  ...packedGameSpec,
  prefabs: {
    ...packedGameSpec.prefabs,
    bullet: { frame: "aseprite/laser" },
  },
  atlas: {
    frames: {
      ...packedGameSpec.atlas.frames,
      ...asepriteImport.atlas.frames,
    },
  },
});
assertFrame(resolvedGameSpec.atlasFrames.hero, "pipeline-atlas", 4, 2);
assertFrame(resolvedGameSpec.atlasFrames["ui/button"], "pipeline-atlas", 2, 2);
assertFrame(resolvedGameSpec.atlasFrames["aseprite/laser"], "aseprite-sheet", 6, 2);
assert(resolvedGameSpec.playerWidth === 4 && resolvedGameSpec.playerHeight === 2, "player prefab must resolve from packed atlas metadata");
assert(resolvedGameSpec.enemyWidth === 2 && resolvedGameSpec.enemyHeight === 2, "enemy prefab must resolve from packed atlas metadata");
assert(resolvedGameSpec.bulletWidth === 6 && resolvedGameSpec.bulletHeight === 2, "bullet prefab must resolve from Aseprite import metadata");

const localization = new LocalizationBundle(resolvedGameSpec.content.localization, "ko-KR");
const localizedReady = localization.t("asset.ready", { values: { name: "Hero" } });
const fallbackTitle = localization.t("asset.pipeline.title");
assert(localizedReady === "Hero 준비됨", `localized asset string mismatch: ${localizedReady}`);
assert(fallbackTitle === "Asset pipeline", `localized fallback mismatch: ${fallbackTitle}`);

const audioResult = await loadAudioFixture(audioFile);

console.log(JSON.stringify({
  assetPipelineE2eSmoke: {
    texturePacking: {
      atlasSize: [atlasPng.width, atlasPng.height],
      frames: Object.keys(atlasDocument.frames),
      gameSpecFrames: Object.keys(resolvedGameSpec.atlasFrames),
    },
    asepriteImport: {
      frames: asepriteImport.frameNames,
      image: asepriteImport.image,
    },
    localization: {
      locale: localization.locale(),
      ready: localizedReady,
      fallbackTitle,
    },
    audio: audioResult,
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

function localizationDocument() {
  return {
    defaultLocale: "en",
    fallbackLocale: "en",
    locales: {
      en: {
        strings: {
          "asset.pipeline.title": "Asset pipeline",
          "asset.ready": "{name} ready",
        },
      },
      ko: {
        strings: {
          "asset.ready": "{name} 준비됨",
        },
      },
    },
  };
}

function asepriteDocument() {
  return {
    frames: {
      "laser.png": {
        frame: { x: 0, y: 0, w: 3, h: 1 },
        rotated: false,
        sourceSize: { w: 6, h: 2 },
      },
    },
    meta: {
      image: "aseprite-sheet.png",
      size: { w: 8, h: 4 },
    },
  };
}

async function loadAudioFixture(filePath) {
  const audioBytes = await readFile(filePath);
  const audioUrl = "https://assets.local/sfx/blip.wav";
  const fetchCalls = [];
  const decodeByteLengths = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    if (String(url) !== audioUrl) {
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () =>
        audioBytes.buffer.slice(audioBytes.byteOffset, audioBytes.byteOffset + audioBytes.byteLength),
    };
  };

  try {
    const loader = new AudioAssetLoader(() => ({
      decodeAudioData: async (buffer) => {
        decodeByteLengths.push(buffer.byteLength);
        return {
          duration: 0.125,
          length: buffer.byteLength,
          numberOfChannels: 1,
          sampleRate: 48000,
        };
      },
    }));
    const decoded = await loader.load(7, audioUrl);
    assert(fetchCalls.length === 1 && fetchCalls[0] === audioUrl, "AudioAssetLoader must fetch the requested URL once");
    assert(decodeByteLengths[0] === audioBytes.byteLength, "AudioAssetLoader must pass fetched bytes to decodeAudioData");
    return {
      soundId: 7,
      url: audioUrl,
      bytes: audioBytes.byteLength,
      decodedDuration: decoded.duration,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function wavFixtureBytes() {
  return Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
    0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
    0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x40, 0x1f, 0x00, 0x00, 0x80, 0x3e, 0x00, 0x00,
    0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61,
    0x00, 0x00, 0x00, 0x00,
  ]);
}

function assertFrame(frame, texture, width, height) {
  assert(frame !== undefined, `missing atlas frame for texture ${texture}`);
  const frameWidth = frame.size?.width ?? frame.width;
  const frameHeight = frame.size?.height ?? frame.height;
  assert(frame.texture === texture, `atlas frame texture mismatch: ${frame.texture}`);
  assert(frameWidth === width, `atlas frame width mismatch: ${frameWidth}`);
  assert(frameHeight === height, `atlas frame height mismatch: ${frameHeight}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
