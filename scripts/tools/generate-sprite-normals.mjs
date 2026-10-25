#!/usr/bin/env node
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  execute,
  installedTool,
  printFailure,
  sha256,
  SpriteNormalsError,
} from "./sprite-normals-tool.mjs";
import {
  normalAnimationNames,
  packNormalAnimation,
  parseAnimationOptions,
} from "./sprite-normal-animation.mjs";

const MAX_BYTES = 64 * 1024 * 1024;
const REPORT_NAME = "normal-generation.report.json";
const ranges = {
  normalStrength: [0, 8, 1.5],
  detailStrength: [0, 8, 6],
  detailScale: [0.6, 8, 0.6],
  shapeStrength: [0, 8, 1.15],
  shapeRadius: [0.5, 512, 4],
  shapeSoftness: [0, 8, 1.15],
  alphaThreshold: [0, 0.99, 0.03],
};
function fail(code, message) {
  throw new SpriteNormalsError(code, message);
}
function object(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    fail("FERRUM_NORMAL_CONFIG_INVALID", `Invalid ${label} fields`);
}

export function parseNormalConfig(value, file) {
  object(
    value,
    ["format", "version", "inputs", "outputDir", "settings", "animation"],
    "config",
  );
  if (value.format !== "ferrum2d.sprite-normals.config" || value.version !== 1)
    fail(
      "FERRUM_NORMAL_CONFIG_INVALID",
      "Expected ferrum2d.sprite-normals.config version 1",
    );
  if (
    !Array.isArray(value.inputs) ||
    !value.inputs.length ||
    value.inputs.length > 64 ||
    value.inputs.some(
      (input) =>
        typeof input !== "string" ||
        !input.trim() ||
        ![".png", ".gif", ".apng"].includes(extname(input).toLowerCase()),
    )
  )
    fail(
      "FERRUM_NORMAL_CONFIG_INVALID",
      "inputs must contain 1–64 PNG/GIF/APNG paths",
    );
  if (typeof value.outputDir !== "string" || !value.outputDir.trim())
    fail("FERRUM_NORMAL_CONFIG_INVALID", "outputDir is required");
  const raw = value.settings === undefined ? {} : value.settings;
  object(raw, [...Object.keys(ranges), "frameSize"], "settings");
  const settings = {};
  for (const [key, [min, max, fallback]] of Object.entries(ranges)) {
    const number = Object.hasOwn(raw, key) ? raw[key] : fallback;
    if (
      typeof number !== "number" ||
      !Number.isFinite(number) ||
      number < min ||
      number > max
    )
      fail(
        "FERRUM_NORMAL_CONFIG_INVALID",
        `${key} must be finite and within ${min}..${max}`,
      );
    settings[key] = number;
  }
  if (raw.frameSize !== undefined) {
    object(raw.frameSize, ["width", "height"], "frameSize");
    if (
      [raw.frameSize.width, raw.frameSize.height].some(
        (n) => !Number.isSafeInteger(n) || n < 1 || n > 4096,
      )
    )
      fail(
        "FERRUM_NORMAL_CONFIG_INVALID",
        "frameSize width/height must be integers within 1..4096",
      );
    settings.frameSize = { ...raw.frameSize };
  }
  const inputs = value.inputs.map((input) => resolve(dirname(file), input));
  let animation;
  if (value.animation !== undefined) {
    try {
      animation = parseAnimationOptions(value.animation);
    } catch (error) {
      fail("FERRUM_NORMAL_CONFIG_INVALID", error.message);
    }
  }
  const stems = inputs.map((input) => basename(input, extname(input)));
  if (new Set(stems.map((stem) => stem.toLowerCase())).size !== stems.length)
    fail(
      "FERRUM_NORMAL_CONFIG_INVALID",
      "Input stems must be unique, including case",
    );
  return {
    inputs,
    stems,
    outputDir: resolve(dirname(file), value.outputDir),
    settings,
    normalFormat: "opengl",
    colorSpace: "none",
    ...(animation ? { animation } : {}),
  };
}

export function normalArguments(settings) {
  const args = ["--normal-format", "opengl"];
  for (const key of Object.keys(ranges))
    args.push(
      "--" + key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()),
      String(settings[key]),
    );
  if (settings.frameSize)
    args.push(
      "--frame-size",
      `${settings.frameSize.width}x${settings.frameSize.height}`,
    );
  return args;
}

async function bytes(file) {
  const info = await stat(file);
  if (!info.isFile() || info.size > MAX_BYTES)
    fail(
      "FERRUM_NORMAL_INPUT_INVALID",
      `${file} must be a file of at most 64 MiB`,
    );
  const data = await readFile(file);
  if (data.length > MAX_BYTES)
    fail("FERRUM_NORMAL_INPUT_INVALID", `${file} grew beyond 64 MiB`);
  return data;
}
function pngInfo(data) {
  if (
    data.length < 33 ||
    data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    data.toString("ascii", 12, 16) !== "IHDR"
  )
    fail(
      "FERRUM_NORMAL_OUTPUT_INVALID",
      "Generator returned an invalid PNG header",
    );
  const width = data.readUInt32BE(16),
    height = data.readUInt32BE(20);
  if (
    !width ||
    !height ||
    width * height > 4_194_304 ||
    data[24] !== 8 ||
    data[25] !== 6
  )
    fail("FERRUM_NORMAL_OUTPUT_INVALID", "Generator PNG must be bounded RGBA8");
  return { width, height };
}
async function absent(file) {
  try {
    await lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  fail(
    "FERRUM_NORMAL_OUTPUT_EXISTS",
    `Refusing to overwrite ${file}; choose a fresh outputDir`,
  );
}

/** Snapshot inputs; publish verified outputs exclusively and the completion report last. */
export async function generateSpriteNormals(file, dependencies = {}) {
  file = resolve(file);
  const configBytes = await readFile(file);
  if (configBytes.length > 256 * 1024)
    fail("FERRUM_NORMAL_CONFIG_INVALID", "Config exceeds 256 KiB");
  let value;
  try {
    value = JSON.parse(configBytes);
  } catch {
    fail("FERRUM_NORMAL_CONFIG_INVALID", "Config must contain valid JSON");
  }
  const config = parseNormalConfig(value, file);
  const generator = await (dependencies.installedTool ?? installedTool)();
  const invoke = dependencies.execute ?? execute;
  await mkdir(config.outputDir, { recursive: true });
  const output = await realpath(config.outputDir);
  for (const name of [
    REPORT_NAME,
    ...config.stems.flatMap((stem) => [
      `${stem}_n.png`,
      `${stem}_n.color.png`,
      `${stem}_n.frames.json`,
      ...(config.animation ? Object.values(normalAnimationNames(stem)) : []),
    ]),
  ])
    await absent(resolve(output, name));
  const temporary = await mkdtemp(resolve(output, ".normal-stage-"));
  const generated = resolve(temporary, "generated"),
    snapshots = resolve(temporary, "inputs");
  const published = [];
  try {
    await mkdir(generated);
    await mkdir(snapshots);
    const inputs = [];
    for (const input of config.inputs) {
      const data = await bytes(input),
        snapshot = resolve(snapshots, basename(input));
      if (
        config.settings.frameSize &&
        data.length >= 24 &&
        data.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
      ) {
        const width = data.readUInt32BE(16),
          height = data.readUInt32BE(20),
          frame = config.settings.frameSize;
        if (
          !width ||
          !height ||
          width % frame.width ||
          height % frame.height ||
          (width / frame.width) * (height / frame.height) > 256
        )
          fail(
            "FERRUM_NORMAL_INPUT_INVALID",
            "PNG frame grid must divide the image and contain at most 256 cells",
          );
      }
      await writeFile(snapshot, data, { flag: "wx" });
      inputs.push({
        path: await realpath(input),
        sha256: sha256(data),
        bytes: data.length,
        snapshot,
      });
    }
    try {
      await invoke(
        generator.binary,
        [
          ...inputs.map((input) => input.snapshot),
          "--output-dir",
          generated,
          ...normalArguments(config.settings),
        ],
        { timeout: 120_000, maxBuffer: 1024 * 1024 },
      );
    } catch (error) {
      fail(
        "FERRUM_NORMAL_GENERATION_FAILED",
        (error.stderr || error.message).slice(0, 4000),
      );
    }
    const files = await readdir(generated),
      allowed = new Set(
        config.stems.flatMap((stem) => [
          `${stem}_n.png`,
          `${stem}_n.color.png`,
          `${stem}_n.frames.json`,
        ]),
      );
    if (files.some((name) => !allowed.has(name)))
      fail(
        "FERRUM_NORMAL_OUTPUT_INVALID",
        "Generator returned unexpected files",
      );
    const results = [];
    for (const [index, stem] of config.stems.entries()) {
      const normal = `${stem}_n.png`,
        color = `${stem}_n.color.png`,
        metadata = `${stem}_n.frames.json`;
      const normalData = await bytes(resolve(generated, normal)),
        dimensions = pngInfo(normalData);
      const animation = files.includes(metadata);
      if (
        animation !== files.includes(color) ||
        (config.settings.frameSize && !animation)
      )
        fail(
          "FERRUM_NORMAL_OUTPUT_INVALID",
          "Color and frame sidecars are incomplete",
        );
      let info;
      if (animation) {
        if ((await stat(resolve(generated, metadata))).size > 256 * 1024)
          fail(
            "FERRUM_NORMAL_OUTPUT_INVALID",
            "Frame metadata exceeds 256 KiB",
          );
        try {
          info = JSON.parse(
            await readFile(resolve(generated, metadata), "utf8"),
          );
        } catch {
          fail(
            "FERRUM_NORMAL_OUTPUT_INVALID",
            "Frame metadata must contain JSON",
          );
        }
        const count = info?.animation?.frame_count;
        if (
          info?.width !== dimensions.width ||
          info?.height !== dimensions.height ||
          !Number.isInteger(count) ||
          count < 1 ||
          count > 256
        )
          fail(
            "FERRUM_NORMAL_OUTPUT_INVALID",
            "Frame dimensions/count differ or exceed 256",
          );
        const colorInfo = pngInfo(await bytes(resolve(generated, color)));
        if (
          colorInfo.width !== dimensions.width ||
          colorInfo.height !== dimensions.height
        )
          fail(
            "FERRUM_NORMAL_OUTPUT_INVALID",
            "Color/normal atlas dimensions differ",
          );
      }
      let ferrumAnimation;
      if (config.animation) {
        if (!animation)
          fail(
            "FERRUM_NORMAL_ATLAS_INVALID",
            "animation export requires GIF/APNG or a PNG settings.frameSize grid",
          );
        const names = normalAnimationNames(stem);
        const packed = packNormalAnimation({
          colorPng: await bytes(resolve(generated, color)),
          normalPng: normalData,
          metadata: info,
          names,
          options: config.animation,
        });
        await writeFile(resolve(generated, names.color), packed.colorPng, {
          flag: "wx",
        });
        await writeFile(resolve(generated, names.normal), packed.normalPng, {
          flag: "wx",
        });
        await writeFile(
          resolve(generated, names.descriptor),
          JSON.stringify(packed.descriptor, null, 2) + "\n",
          { flag: "wx" },
        );
        ferrumAnimation = names;
      }
      const outputs = [];
      for (const name of [
        normal,
        ...(animation ? [color, metadata] : []),
        ...(ferrumAnimation ? Object.values(ferrumAnimation) : []),
      ]) {
        const data = await bytes(resolve(generated, name));
        outputs.push({ path: name, sha256: sha256(data), bytes: data.length });
      }
      results.push({
        input: {
          path: inputs[index].path,
          sha256: inputs[index].sha256,
          bytes: inputs[index].bytes,
        },
        normal,
        color: animation ? color : inputs[index].path,
        ...(animation ? { frames: metadata } : {}),
        ...(ferrumAnimation ? { ferrumAnimation } : {}),
        ...dimensions,
        outputs,
      });
    }
    for (const input of inputs)
      if (sha256(await bytes(input.path)) !== input.sha256)
        fail(
          "FERRUM_NORMAL_SOURCE_CHANGED",
          `Input changed during generation: ${input.path}`,
        );
    const report = {
      format: "ferrum2d.sprite-normals.report",
      version: 1,
      ok: true,
      generator: generator.manifest,
      config: { path: file, sha256: sha256(configBytes) },
      settings: config.settings,
      ...(config.animation ? { animation: config.animation } : {}),
      normalFormat: config.normalFormat,
      colorSpace: config.colorSpace,
      results,
    };
    await writeFile(
      resolve(generated, REPORT_NAME),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx" },
    );
    for (const name of [
      ...results.flatMap((result) =>
        result.outputs.map((output) => output.path),
      ),
      REPORT_NAME,
    ]) {
      const target = resolve(output, name);
      await copyFile(resolve(generated, name), target, constants.COPYFILE_EXCL);
      published.push(target);
    }
    return { reportPath: resolve(output, REPORT_NAME), ...report };
  } catch (error) {
    await Promise.all(published.map((file) => rm(file)));
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv
    .slice(2)
    .filter((arg, index) => !(index === 0 && arg === "--"));
  try {
    if (args.length !== 2 || args[0] !== "--config")
      fail(
        "FERRUM_NORMAL_CONFIG_INVALID",
        "Usage: pnpm normals:generate -- --config <file.json>",
      );
    process.stdout.write(
      JSON.stringify(await generateSpriteNormals(args[1]), null, 2) + "\n",
    );
  } catch (error) {
    printFailure(error);
  }
}
