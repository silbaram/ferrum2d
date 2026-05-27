#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { packTextureAtlas } from "../packages/ferrum-web/dist/textureAtlas.js";

const args = process.argv.slice(2);
const options = {
  padding: undefined,
  maxSize: undefined,
  powerOfTwo: true,
  texture: undefined,
  image: undefined,
};
let inputPath;
let outputPath;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--input") {
    inputPath = requiredValue(args, ++index, arg);
  } else if (arg === "--output") {
    outputPath = requiredValue(args, ++index, arg);
  } else if (arg === "--texture") {
    options.texture = requiredValue(args, ++index, arg);
  } else if (arg === "--image") {
    options.image = requiredValue(args, ++index, arg);
  } else if (arg === "--padding") {
    options.padding = Number(requiredValue(args, ++index, arg));
  } else if (arg === "--max-size") {
    options.maxSize = Number(requiredValue(args, ++index, arg));
  } else if (arg === "--no-power-of-two") {
    options.powerOfTwo = false;
  } else {
    throw new Error(`Unknown argument: ${arg}`);
  }
}

if (inputPath === undefined) {
  throw new Error("Missing --input <path>.");
}

const input = JSON.parse(await readFile(inputPath, "utf8"));
const sprites = Array.isArray(input) ? input : input.sprites;
if (!Array.isArray(sprites)) {
  throw new Error("Texture atlas input must be an array or an object with a sprites array.");
}

const document = packTextureAtlas(sprites, cleanOptions(options));
const json = `${JSON.stringify(document, null, 2)}\n`;
if (outputPath === undefined) {
  process.stdout.write(json);
} else {
  await writeFile(outputPath, json);
}

function requiredValue(values, index, flag) {
  const value = values[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function cleanOptions(inputOptions) {
  return Object.fromEntries(
    Object.entries(inputOptions).filter(([, value]) => value !== undefined),
  );
}
