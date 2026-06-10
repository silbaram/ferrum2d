#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ASSET_REPORT_FORMAT = "ferrum2d.consumer.asset-pipeline.report";
const TEXTURE_ATLAS_INPUT_FORMAT = "ferrum2d.consumer.texture-atlas-input";
const AUDIO_MANIFEST_FORMAT = "ferrum2d.consumer.audio-manifest";
const LOCALIZATION_MANIFEST_FORMAT = "ferrum2d.consumer.localization-manifest";
const TEXTURE_ATLAS_INPUT_PATH = "public/assets/texture-atlas.input.json";
const AUDIO_MANIFEST_PATH = "public/assets/audio.manifest.json";
const LOCALIZATION_MANIFEST_PATH = "public/assets/localization.manifest.json";
const DEFAULT_OUTPUT_JSON = "public/assets/atlas.json";
const DEFAULT_GAME_SPEC = "public/game.json";

const command = process.argv[2] ?? "report";

try {
  if (command === "report") {
    await printReport();
  } else if (command === "pack-textures") {
    await packTextures();
  } else if (command === "validate") {
    await validateAssets();
  } else if (command === "--help" || command === "-h") {
    printHelp();
  } else {
    throw new Error(`Unknown ferrum asset command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function printReport() {
  const config = await readOptionalConfig();
  const audioManifest = await readOptionalAudioManifest();
  const localizationManifest = await readOptionalLocalizationManifest();
  const gameSpecPath = config?.gameSpec ?? DEFAULT_GAME_SPEC;
  const gameSpec = await readOptionalJson(gameSpecPath);
  printJson(assetPipelineReport({
    config,
    audioManifest,
    localizationManifest,
    gameSpec,
    gameSpecPath,
    packedDocument: await readOptionalJson(config?.outputJson ?? DEFAULT_OUTPUT_JSON),
    packed: false,
    validated: false,
    reports: config === undefined
      ? [diagnostic(
          "asset-pipeline",
          "FERRUM_CONSUMER_TEXTURE_ATLAS_NOT_CONFIGURED",
          TEXTURE_ATLAS_INPUT_PATH,
          "Texture atlas input manifest is not present.",
          `Create ${TEXTURE_ATLAS_INPUT_PATH} or restore the generated scaffold.`,
        )]
      : [],
  }));
}

async function validateAssets() {
  const config = await readOptionalConfig();
  const audioManifest = await readOptionalAudioManifest();
  const localizationManifest = await readOptionalLocalizationManifest();
  const gameSpecPath = config?.gameSpec ?? localizationManifest?.gameSpec ?? DEFAULT_GAME_SPEC;
  const gameSpec = await readOptionalJson(gameSpecPath);
  const {
    AudioAssetLoader,
    LocalizationBundle,
    resolveShooterGameSpec,
  } = await import("@ferrum2d/ferrum-web");
  if (typeof AudioAssetLoader !== "function") {
    throw new Error("AudioAssetLoader must be exported from @ferrum2d/ferrum-web.");
  }
  if (typeof LocalizationBundle !== "function") {
    throw new Error("LocalizationBundle must be exported from @ferrum2d/ferrum-web.");
  }
  if (typeof resolveShooterGameSpec !== "function") {
    throw new Error("resolveShooterGameSpec must be exported from @ferrum2d/ferrum-web.");
  }

  let resolvedGameSpec;
  if (gameSpec !== undefined) {
    resolvedGameSpec = resolveShooterGameSpec(gameSpec);
    if (resolvedGameSpec.content.localization !== undefined) {
      new LocalizationBundle(resolvedGameSpec.content.localization);
    }
  }
  if (localizationManifest !== undefined) {
    for (const document of Object.values(localizationManifest.documents)) {
      new LocalizationBundle(document);
    }
  }

  printJson(assetPipelineReport({
    config,
    audioManifest,
    localizationManifest,
    gameSpec,
    gameSpecPath,
    packedDocument: await readOptionalJson(config?.outputJson ?? DEFAULT_OUTPUT_JSON),
    packed: false,
    validated: true,
    reports: [],
    resolvedGameSpec,
  }));
}

async function packTextures() {
  const config = await readRequiredConfig();
  const {
    packTextureAtlas,
    resolveShooterGameSpec,
    textureAtlasDocumentToShooterAtlas,
  } = await import("@ferrum2d/ferrum-web");
  const document = packTextureAtlas(config.sprites, {
    image: config.image,
    maxSize: config.maxSize,
    padding: config.padding,
    powerOfTwo: config.powerOfTwo,
    texture: config.texture,
  });
  await writeJson(config.outputJson, document);

  const reports = [];
  let gameSpec = await readOptionalJson(config.gameSpec);
  if (config.mergeGameSpec && gameSpec !== undefined) {
    const atlas = textureAtlasDocumentToShooterAtlas(document);
    gameSpec = {
      ...gameSpec,
      atlas: {
        ...(isPlainObject(gameSpec.atlas) ? gameSpec.atlas : {}),
        frames: {
          ...(isPlainObject(gameSpec.atlas?.frames) ? gameSpec.atlas.frames : {}),
          ...atlas.frames,
        },
      },
    };
    resolveShooterGameSpec(gameSpec);
    await writeJson(config.gameSpec, gameSpec);
  } else if (config.mergeGameSpec) {
    reports.push(diagnostic(
      "asset-pipeline",
      "FERRUM_CONSUMER_GAME_SPEC_NOT_PRESENT",
      config.gameSpec,
      "Game Spec was not present, so atlas frames were written only to the atlas JSON document.",
      "Create public/game.json or set mergeGameSpec=false when this project uses app-owned manifests instead.",
    ));
  }

  printJson(assetPipelineReport({
    config,
    audioManifest: await readOptionalAudioManifest(),
    localizationManifest: await readOptionalLocalizationManifest(),
    gameSpec,
    gameSpecPath: config.gameSpec,
    packedDocument: document,
    packed: true,
    validated: true,
    reports,
  }));
}

function assetPipelineReport({
  config,
  audioManifest,
  localizationManifest,
  gameSpec,
  gameSpecPath,
  packedDocument,
  packed,
  validated,
  reports,
  resolvedGameSpec,
}) {
  const spriteCount = config?.sprites.length ?? 0;
  const soundCount = Object.keys(audioManifest?.sounds ?? {}).length;
  const localizationDocumentCount = Object.keys(localizationManifest?.documents ?? {}).length;
  const gameSpecLocalization = resolvedGameSpec?.content.localization ?? gameSpec?.content?.localization;
  return {
    format: ASSET_REPORT_FORMAT,
    version: 1,
    ok: true,
    assetPipeline: {
      textureAtlas: {
        configured: config !== undefined,
        status: config === undefined ? "not-configured" : spriteCount === 0 ? "scaffold" : "configured",
        input: TEXTURE_ATLAS_INPUT_PATH,
        outputJson: config?.outputJson ?? DEFAULT_OUTPUT_JSON,
        texture: config?.texture ?? "atlas",
        image: config?.image ?? "./assets/atlas.png",
        spriteCount,
        sprites: config?.sprites.map((sprite) => ({
          name: sprite.name,
          width: sprite.width,
          height: sprite.height,
          ...(sprite.source === undefined ? {} : { source: sprite.source }),
        })) ?? [],
        packed,
        packedFrameCount: Object.keys(packedDocument?.frames ?? {}).length,
      },
      audio: {
        configured: audioManifest !== undefined,
        status: audioManifest === undefined ? "not-configured" : soundCount === 0 ? "scaffold" : "configured",
        input: AUDIO_MANIFEST_PATH,
        soundCount,
        sounds: Object.entries(audioManifest?.sounds ?? {}).map(([name, url]) => ({ name, url })),
      },
      localization: {
        configured: localizationManifest !== undefined,
        status: localizationManifest === undefined
          ? "not-configured"
          : gameSpecLocalization !== undefined || localizationDocumentCount > 0
            ? "configured"
            : "scaffold",
        input: LOCALIZATION_MANIFEST_PATH,
        gameSpec: localizationManifest?.gameSpec ?? DEFAULT_GAME_SPEC,
        source: localizationManifest?.source ?? "gameSpec.content.localization",
        gameSpecContentPresent: gameSpecLocalization !== undefined,
        documentCount: localizationDocumentCount,
        documents: Object.keys(localizationManifest?.documents ?? {}),
      },
      gameSpec: {
        path: gameSpecPath ?? config?.gameSpec ?? DEFAULT_GAME_SPEC,
        present: gameSpec !== undefined,
        atlasFrameCount: Object.keys(gameSpec?.atlas?.frames ?? {}).length,
        localizationConfigured: gameSpec?.content?.localization !== undefined,
      },
      validation: {
        validated,
        publicEntryPoint: validated ? "@ferrum2d/ferrum-web" : undefined,
      },
      reports,
    },
  };
}

async function readRequiredConfig() {
  const input = await readOptionalJson(TEXTURE_ATLAS_INPUT_PATH);
  if (input === undefined) {
    throw new Error(`Missing ${TEXTURE_ATLAS_INPUT_PATH}.`);
  }
  return normalizeTextureAtlasConfig(input);
}

async function readOptionalConfig() {
  const input = await readOptionalJson(TEXTURE_ATLAS_INPUT_PATH);
  return input === undefined ? undefined : normalizeTextureAtlasConfig(input);
}

function normalizeTextureAtlasConfig(input) {
  const config = objectValue(input, TEXTURE_ATLAS_INPUT_PATH);
  if (config.format !== undefined && config.format !== TEXTURE_ATLAS_INPUT_FORMAT) {
    throw new Error(`${TEXTURE_ATLAS_INPUT_PATH}.format must be ${TEXTURE_ATLAS_INPUT_FORMAT}.`);
  }
  if (config.version !== undefined && config.version !== 1) {
    throw new Error(`${TEXTURE_ATLAS_INPUT_PATH}.version must be 1.`);
  }
  return {
    texture: textureValue(config.texture ?? "atlas", `${TEXTURE_ATLAS_INPUT_PATH}.texture`),
    image: stringValue(config.image ?? "./assets/atlas.png", `${TEXTURE_ATLAS_INPUT_PATH}.image`),
    outputJson: projectPath(config.outputJson ?? DEFAULT_OUTPUT_JSON, `${TEXTURE_ATLAS_INPUT_PATH}.outputJson`),
    gameSpec: projectPath(config.gameSpec ?? DEFAULT_GAME_SPEC, `${TEXTURE_ATLAS_INPUT_PATH}.gameSpec`),
    mergeGameSpec: booleanValue(config.mergeGameSpec ?? true, `${TEXTURE_ATLAS_INPUT_PATH}.mergeGameSpec`),
    padding: nonNegativeInteger(config.padding ?? 2, `${TEXTURE_ATLAS_INPUT_PATH}.padding`),
    maxSize: positiveInteger(config.maxSize ?? 4096, `${TEXTURE_ATLAS_INPUT_PATH}.maxSize`),
    powerOfTwo: booleanValue(config.powerOfTwo ?? true, `${TEXTURE_ATLAS_INPUT_PATH}.powerOfTwo`),
    sprites: arrayValue(config.sprites ?? [], `${TEXTURE_ATLAS_INPUT_PATH}.sprites`).map((sprite, index) =>
      normalizeSprite(sprite, `${TEXTURE_ATLAS_INPUT_PATH}.sprites.${index}`),
    ),
  };
}

async function readOptionalAudioManifest() {
  const input = await readOptionalJson(AUDIO_MANIFEST_PATH);
  return input === undefined ? undefined : normalizeAudioManifest(input);
}

function normalizeAudioManifest(input) {
  const manifest = objectValue(input, AUDIO_MANIFEST_PATH);
  if (manifest.format !== undefined && manifest.format !== AUDIO_MANIFEST_FORMAT) {
    throw new Error(`${AUDIO_MANIFEST_PATH}.format must be ${AUDIO_MANIFEST_FORMAT}.`);
  }
  if (manifest.version !== undefined && manifest.version !== 1) {
    throw new Error(`${AUDIO_MANIFEST_PATH}.version must be 1.`);
  }
  const sounds = recordValue(manifest.sounds ?? {}, `${AUDIO_MANIFEST_PATH}.sounds`);
  const normalizedSounds = {};
  for (const [name, url] of Object.entries(sounds).sort(([left], [right]) => left.localeCompare(right))) {
    const soundName = stringValue(name, `${AUDIO_MANIFEST_PATH}.sounds key`);
    normalizedSounds[soundName] = assetUrl(url, `${AUDIO_MANIFEST_PATH}.sounds.${soundName}`);
  }
  return {
    sounds: normalizedSounds,
  };
}

async function readOptionalLocalizationManifest() {
  const input = await readOptionalJson(LOCALIZATION_MANIFEST_PATH);
  return input === undefined ? undefined : normalizeLocalizationManifest(input);
}

function normalizeLocalizationManifest(input) {
  const manifest = objectValue(input, LOCALIZATION_MANIFEST_PATH);
  if (manifest.format !== undefined && manifest.format !== LOCALIZATION_MANIFEST_FORMAT) {
    throw new Error(`${LOCALIZATION_MANIFEST_PATH}.format must be ${LOCALIZATION_MANIFEST_FORMAT}.`);
  }
  if (manifest.version !== undefined && manifest.version !== 1) {
    throw new Error(`${LOCALIZATION_MANIFEST_PATH}.version must be 1.`);
  }
  const documents = recordValue(manifest.documents ?? {}, `${LOCALIZATION_MANIFEST_PATH}.documents`);
  const normalizedDocuments = {};
  for (const [name, document] of Object.entries(documents).sort(([left], [right]) => left.localeCompare(right))) {
    normalizedDocuments[stringValue(name, `${LOCALIZATION_MANIFEST_PATH}.documents key`)] = objectValue(
      document,
      `${LOCALIZATION_MANIFEST_PATH}.documents.${name}`,
    );
  }
  return {
    gameSpec: projectPath(manifest.gameSpec ?? DEFAULT_GAME_SPEC, `${LOCALIZATION_MANIFEST_PATH}.gameSpec`),
    source: stringValue(manifest.source ?? "gameSpec.content.localization", `${LOCALIZATION_MANIFEST_PATH}.source`),
    documents: normalizedDocuments,
  };
}

function normalizeSprite(input, label) {
  const sprite = objectValue(input, label);
  return {
    name: stringValue(sprite.name, `${label}.name`),
    width: positiveNumber(sprite.width, `${label}.width`),
    height: positiveNumber(sprite.height, `${label}.height`),
    ...(sprite.source === undefined ? {} : { source: stringValue(sprite.source, `${label}.source`) }),
  };
}

async function readOptionalJson(projectRelativePath) {
  try {
    return JSON.parse(await readFile(projectFile(projectRelativePath), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function writeJson(projectRelativePath, value) {
  const filePath = projectFile(projectRelativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function projectFile(projectRelativePath) {
  const filePath = path.resolve(process.cwd(), projectRelativePath);
  const relative = path.relative(process.cwd(), filePath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${projectRelativePath} resolves outside the project root.`);
  }
  return filePath;
}

function diagnostic(kind, code, pathValue, message, suggestion) {
  return {
    kind,
    code,
    path: pathValue,
    message,
    suggestion,
  };
}

function objectValue(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function recordValue(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function arrayValue(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}

function textureValue(value, label) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw new Error(`${label} must be a non-empty string or non-negative integer.`);
}

function stringValue(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assetUrl(value, label) {
  const url = stringValue(value, label);
  if (url.includes("\\")) {
    throw new Error(`${label} must use forward slashes.`);
  }
  return url;
}

function projectPath(value, label) {
  const stringPath = stringValue(value, label);
  const normalized = path.normalize(stringPath);
  if (path.isAbsolute(normalized) || normalized === "." || normalized.startsWith(`..${path.sep}`) || normalized === "..") {
    throw new Error(`${label} must be a project-relative file path.`);
  }
  return normalized.split(path.sep).join("/");
}

function booleanValue(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function positiveNumber(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp() {
  console.log(`Usage:
  node scripts/ferrum-assets.mjs report
  node scripts/ferrum-assets.mjs pack-textures
  node scripts/ferrum-assets.mjs validate

Commands:
  report         Print asset pipeline status without requiring @ferrum2d/ferrum-web.
  pack-textures  Generate atlas metadata with public @ferrum2d/ferrum-web helpers and merge Game Spec frames when present.
  validate       Validate texture, audio, localization, and Game Spec asset metadata through the public package entrypoint.
`);
}
