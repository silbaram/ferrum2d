#!/usr/bin/env node
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_CONFIG_PATH = "texture-atlas.config.json";
const DEFAULT_TEXTURE_NAME = "atlas";
const DEFAULT_MAX_SIZE = 4096;

if (isMain()) {
  await main(process.argv.slice(2));
}

export async function main(argv) {
  const options = parseArgs(argv);
  const config = await resolveConfig(options);
  if (!config) {
    return;
  }
  const result = await packTexturePngs(config);
  const summary = {
    packTextures: {
      inputDir: config.inputDir,
      outputImage: config.outputImage,
      gameJson: config.gameJson,
      width: result.width,
      height: result.height,
      frames: Object.keys(result.frames),
    },
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

export async function packTexturePngs(config) {
  const inputDir = path.resolve(config.inputDir);
  const outputImage = path.resolve(config.outputImage);
  const texture = config.texture ?? DEFAULT_TEXTURE_NAME;
  const padding = Math.max(0, Math.floor(config.padding ?? 2));
  const maxSize = Math.max(64, Math.floor(config.maxSize ?? DEFAULT_MAX_SIZE));
  const powerOfTwo = config.powerOfTwo ?? true;
  const sprites = await readPngSprites(inputDir);
  if (sprites.length === 0) {
    if (config.ifPresent) {
      return { width: 1, height: 1, frames: {}, placements: [] };
    }
    throw new Error(`No PNG files found in ${inputDir}.`);
  }
  const layout = packMaxRects(sprites, { padding, maxSize, powerOfTwo });
  const pixels = new Uint8Array(layout.width * layout.height * 4);
  for (const placement of layout.placements) {
    copyRgba(
      placement.sprite.pixels,
      placement.sprite.width,
      placement.sprite.height,
      pixels,
      layout.width,
      placement.x,
      placement.y,
    );
  }
  await mkdir(path.dirname(outputImage), { recursive: true });
  await writeFile(outputImage, encodePngRgba(layout.width, layout.height, pixels));

  const frames = {};
  for (const placement of [...layout.placements].sort((a, b) => a.name.localeCompare(b.name))) {
    frames[placement.name] = {
      texture,
      uv: {
        u0: placement.x / layout.width,
        v0: placement.y / layout.height,
        u1: (placement.x + placement.width) / layout.width,
        v1: (placement.y + placement.height) / layout.height,
      },
      size: {
        width: placement.width,
        height: placement.height,
      },
    };
  }

  if (config.outputJson !== undefined) {
    const outputJson = path.resolve(config.outputJson);
    await mkdir(path.dirname(outputJson), { recursive: true });
    await writeFile(outputJson, `${JSON.stringify({
      format: "ferrum-texture-atlas-pack",
      version: 1,
      texture,
      width: layout.width,
      height: layout.height,
      image: path.relative(path.dirname(outputJson), outputImage).split(path.sep).join("/"),
      frames,
      placements: layout.placements.map((placement) => ({
        name: placement.name,
        source: placement.sprite.source,
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
      })),
    }, null, 2)}\n`);
  }

  if (config.gameJson !== undefined) {
    await mergeGameJsonAtlas(path.resolve(config.gameJson), frames);
  }

  return {
    width: layout.width,
    height: layout.height,
    frames,
    placements: layout.placements,
  };
}

export function decodePng(buffer) {
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Invalid PNG signature.");
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette;
  let transparency;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      transparency = data;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  if (bitDepth !== 8 || interlace !== 0) {
    throw new Error("Only 8-bit non-interlaced PNG files are supported.");
  }
  const channels = channelsForColorType(colorType);
  const inflated = inflateSync(Buffer.concat(idat));
  const scanlineBytes = width * channels;
  const raw = unfilterPngScanlines(inflated, width, height, channels);
  if (raw.length !== scanlineBytes * height) {
    throw new Error("PNG scanline length mismatch.");
  }

  return {
    width,
    height,
    pixels: convertToRgba(raw, width, height, colorType, palette, transparency),
  };
}

export function encodePngRgba(width, height, pixels) {
  if (pixels.length !== width * height * 4) {
    throw new Error("RGBA pixel buffer length does not match PNG dimensions.");
  }
  const scanlineBytes = width * 4;
  const raw = Buffer.alloc((scanlineBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (scanlineBytes + 1);
    raw[rowStart] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * scanlineBytes, scanlineBytes)
      .copy(raw, rowStart + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function parseArgs(argv) {
  const options = {
    config: undefined,
    inputDir: undefined,
    outputImage: undefined,
    outputJson: undefined,
    gameJson: undefined,
    texture: undefined,
    padding: undefined,
    maxSize: undefined,
    powerOfTwo: undefined,
    ifPresent: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      options.config = requiredValue(argv, ++index, arg);
    } else if (arg === "--input-dir" || arg === "--input") {
      options.inputDir = requiredValue(argv, ++index, arg);
    } else if (arg === "--output-image" || arg === "--output") {
      options.outputImage = requiredValue(argv, ++index, arg);
    } else if (arg === "--output-json") {
      options.outputJson = requiredValue(argv, ++index, arg);
    } else if (arg === "--game-json") {
      options.gameJson = requiredValue(argv, ++index, arg);
    } else if (arg === "--texture") {
      options.texture = requiredValue(argv, ++index, arg);
    } else if (arg === "--padding") {
      options.padding = Number(requiredValue(argv, ++index, arg));
    } else if (arg === "--max-size") {
      options.maxSize = Number(requiredValue(argv, ++index, arg));
    } else if (arg === "--no-power-of-two") {
      options.powerOfTwo = false;
    } else if (arg === "--if-present") {
      options.ifPresent = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function resolveConfig(options) {
  const configPath = options.config ?? DEFAULT_CONFIG_PATH;
  const hasDirectInput = options.inputDir !== undefined || options.outputImage !== undefined;
  let fileConfig = {};
  if (!hasDirectInput || options.config !== undefined) {
    if (!(await exists(configPath))) {
      if (options.ifPresent) {
        return undefined;
      }
      throw new Error(`Missing texture atlas config: ${configPath}.`);
    }
    fileConfig = JSON.parse(await readFile(configPath, "utf8"));
  }
  const config = {
    ...fileConfig,
    ...dropUndefined({
      inputDir: options.inputDir,
      outputImage: options.outputImage,
      outputJson: options.outputJson,
      gameJson: options.gameJson,
      texture: options.texture,
      padding: options.padding,
      maxSize: options.maxSize,
      powerOfTwo: options.powerOfTwo,
      ifPresent: options.ifPresent,
    }),
  };
  if (config.inputDir === undefined || config.outputImage === undefined) {
    if (options.ifPresent) {
      return undefined;
    }
    throw new Error("Texture packing requires --input-dir and --output-image, or a texture-atlas.config.json file.");
  }
  if (config.ifPresent && !(await exists(config.inputDir))) {
    return undefined;
  }
  return config;
}

async function readPngSprites(inputDir) {
  const files = await listPngFiles(inputDir);
  const sprites = [];
  const seen = new Set();
  for (const file of files) {
    const relative = path.relative(inputDir, file);
    const name = relative
      .slice(0, -path.extname(relative).length)
      .split(path.sep)
      .join("/");
    if (seen.has(name)) {
      throw new Error(`Duplicate sprite name '${name}'.`);
    }
    seen.add(name);
    const image = decodePng(await readFile(file));
    sprites.push({
      name,
      source: relative.split(path.sep).join("/"),
      width: image.width,
      height: image.height,
      pixels: image.pixels,
    });
  }
  sprites.sort((a, b) => a.name.localeCompare(b.name));
  return sprites;
}

async function listPngFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listPngFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
      files.push(fullPath);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function packMaxRects(sprites, options) {
  const rects = sprites
    .map((sprite) => ({
      sprite,
      width: sprite.width,
      height: sprite.height,
      area: sprite.width * sprite.height,
    }))
    .sort((a, b) => b.area - a.area || b.height - a.height || b.width - a.width || a.sprite.name.localeCompare(b.sprite.name));
  let width = Math.max(1, ...rects.map((rect) => rect.width + options.padding * 2));
  let height = Math.max(1, ...rects.map((rect) => rect.height + options.padding * 2));
  if (options.powerOfTwo) {
    width = nextPowerOfTwo(width);
    height = nextPowerOfTwo(height);
  }
  while (width <= options.maxSize && height <= options.maxSize) {
    const placements = tryPack(rects, width, height, options.padding);
    if (placements) {
      const usedWidth = placements.reduce((max, placement) => Math.max(max, placement.x + placement.width + options.padding), 1);
      const usedHeight = placements.reduce((max, placement) => Math.max(max, placement.y + placement.height + options.padding), 1);
      const finalWidth = options.powerOfTwo ? nextPowerOfTwo(usedWidth) : usedWidth;
      const finalHeight = options.powerOfTwo ? nextPowerOfTwo(usedHeight) : usedHeight;
      return {
        width: finalWidth,
        height: finalHeight,
        placements: placements.map((placement) => ({ ...placement })),
      };
    }
    if (width <= height) {
      width = options.powerOfTwo ? width * 2 : width + 256;
    } else {
      height = options.powerOfTwo ? height * 2 : height + 256;
    }
  }
  throw new Error(`Texture packing failed within maxSize=${options.maxSize}.`);
}

function tryPack(rects, width, height, padding) {
  const freeRects = [{ x: 0, y: 0, width, height }];
  const placements = [];
  for (const rect of rects) {
    const outerWidth = rect.width + padding * 2;
    const outerHeight = rect.height + padding * 2;
    const position = findBestFreeRect(freeRects, outerWidth, outerHeight);
    if (!position) {
      return undefined;
    }
    const outer = { x: position.x, y: position.y, width: outerWidth, height: outerHeight };
    splitFreeRects(freeRects, outer);
    pruneContainedRects(freeRects);
    placements.push({
      name: rect.sprite.name,
      sprite: rect.sprite,
      x: outer.x + padding,
      y: outer.y + padding,
      width: rect.width,
      height: rect.height,
    });
  }
  return placements;
}

function findBestFreeRect(freeRects, width, height) {
  let best;
  let bestShortSide = Number.POSITIVE_INFINITY;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const rect of freeRects) {
    if (width > rect.width || height > rect.height) {
      continue;
    }
    const leftoverX = rect.width - width;
    const leftoverY = rect.height - height;
    const shortSide = Math.min(leftoverX, leftoverY);
    const area = rect.width * rect.height - width * height;
    if (
      shortSide < bestShortSide
      || (shortSide === bestShortSide && area < bestArea)
      || (shortSide === bestShortSide && area === bestArea && best && rect.y < best.y)
      || (shortSide === bestShortSide && area === bestArea && best && rect.y === best.y && rect.x < best.x)
    ) {
      best = rect;
      bestShortSide = shortSide;
      bestArea = area;
    }
  }
  return best ? { x: best.x, y: best.y } : undefined;
}

function splitFreeRects(freeRects, used) {
  const next = [];
  for (const free of freeRects) {
    if (!rectsOverlap(free, used)) {
      next.push(free);
      continue;
    }
    if (used.x > free.x) {
      next.push({ x: free.x, y: free.y, width: used.x - free.x, height: free.height });
    }
    const usedRight = used.x + used.width;
    const freeRight = free.x + free.width;
    if (usedRight < freeRight) {
      next.push({ x: usedRight, y: free.y, width: freeRight - usedRight, height: free.height });
    }
    if (used.y > free.y) {
      next.push({ x: free.x, y: free.y, width: free.width, height: used.y - free.y });
    }
    const usedBottom = used.y + used.height;
    const freeBottom = free.y + free.height;
    if (usedBottom < freeBottom) {
      next.push({ x: free.x, y: usedBottom, width: free.width, height: freeBottom - usedBottom });
    }
  }
  freeRects.length = 0;
  freeRects.push(...next.filter((rect) => rect.width > 0 && rect.height > 0));
}

function pruneContainedRects(rects) {
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (containsRect(rects[i], rects[j])) {
        rects.splice(j, 1);
        j -= 1;
      } else if (containsRect(rects[j], rects[i])) {
        rects.splice(i, 1);
        i -= 1;
        break;
      }
    }
  }
}

function mergeGameJsonAtlas(gameJsonPath, frames) {
  return readFile(gameJsonPath, "utf8")
    .then((content) => JSON.parse(content))
    .then((gameJson) => {
      gameJson.atlas = {
        ...(gameJson.atlas ?? {}),
        frames: {
          ...(gameJson.atlas?.frames ?? {}),
          ...frames,
        },
      };
      return writeFile(gameJsonPath, `${JSON.stringify(gameJson, null, 2)}\n`);
    });
}

function copyRgba(source, sourceWidth, sourceHeight, target, targetWidth, targetX, targetY) {
  for (let y = 0; y < sourceHeight; y += 1) {
    const sourceStart = y * sourceWidth * 4;
    const targetStart = ((targetY + y) * targetWidth + targetX) * 4;
    target.set(source.subarray(sourceStart, sourceStart + sourceWidth * 4), targetStart);
  }
}

function unfilterPngScanlines(data, width, height, channels) {
  const rowBytes = width * channels;
  const output = Buffer.alloc(rowBytes * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = data[sourceOffset];
    sourceOffset += 1;
    const rowStart = y * rowBytes;
    const previousRowStart = rowStart - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = data[sourceOffset + x];
      const left = x >= channels ? output[rowStart + x - channels] : 0;
      const up = y > 0 ? output[previousRowStart + x] : 0;
      const upLeft = y > 0 && x >= channels ? output[previousRowStart + x - channels] : 0;
      output[rowStart + x] = (raw + pngFilterPrediction(filter, left, up, upLeft)) & 0xff;
    }
    sourceOffset += rowBytes;
  }
  return output;
}

function pngFilterPrediction(filter, left, up, upLeft) {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return Math.floor((left + up) / 2);
  if (filter === 4) return paeth(left, up, upLeft);
  throw new Error(`Unsupported PNG filter type ${filter}.`);
}

function paeth(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  return pb <= pc ? up : upLeft;
}

function convertToRgba(raw, width, height, colorType, palette, transparency) {
  const pixels = new Uint8Array(width * height * 4);
  const pixelCount = width * height;
  if (colorType === 6) {
    pixels.set(raw);
    return pixels;
  }
  for (let i = 0; i < pixelCount; i += 1) {
    const target = i * 4;
    if (colorType === 2) {
      const source = i * 3;
      pixels[target] = raw[source];
      pixels[target + 1] = raw[source + 1];
      pixels[target + 2] = raw[source + 2];
      pixels[target + 3] = 255;
    } else if (colorType === 0) {
      const value = raw[i];
      pixels[target] = value;
      pixels[target + 1] = value;
      pixels[target + 2] = value;
      pixels[target + 3] = 255;
    } else if (colorType === 4) {
      const source = i * 2;
      const value = raw[source];
      pixels[target] = value;
      pixels[target + 1] = value;
      pixels[target + 2] = value;
      pixels[target + 3] = raw[source + 1];
    } else if (colorType === 3) {
      if (!palette) {
        throw new Error("Palette PNG is missing PLTE chunk.");
      }
      const index = raw[i];
      const paletteOffset = index * 3;
      pixels[target] = palette[paletteOffset] ?? 0;
      pixels[target + 1] = palette[paletteOffset + 1] ?? 0;
      pixels[target + 2] = palette[paletteOffset + 2] ?? 0;
      pixels[target + 3] = transparency?.[index] ?? 255;
    } else {
      throw new Error(`Unsupported PNG color type ${colorType}.`);
    }
  }
  return pixels;
}

function channelsForColorType(colorType) {
  if (colorType === 0 || colorType === 3) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  throw new Error(`Unsupported PNG color type ${colorType}.`);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

var crcTable;

function crcTableValues() {
  if (crcTable !== undefined) {
    return crcTable;
  }
  crcTable = new Uint32Array(256);
  for (let index = 0; index < crcTable.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    crcTable[index] = value >>> 0;
  }
  return crcTable;
}

function crc32(buffer) {
  const table = crcTableValues();
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = table[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function containsRect(outer, inner) {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function nextPowerOfTwo(value) {
  return 2 ** Math.ceil(Math.log2(Math.max(value, 1)));
}

async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function requiredValue(values, index, flag) {
  const value = values[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function dropUndefined(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function isMain() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(fileURLToPath(import.meta.url)).href
    && pathToFileURL(process.argv[1]).href === import.meta.url;
}
