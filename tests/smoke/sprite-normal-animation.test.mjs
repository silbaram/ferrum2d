import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import {
  packNormalAnimation,
  resolveNormalAnimationTiming,
  normalAnimationNames,
} from "../../scripts/tools/sprite-normal-animation.mjs";
import {
  parseNormalConfig,
  generateSpriteNormals,
} from "../../scripts/tools/generate-sprite-normals.mjs";
import {
  decodePng,
  encodePngRgba,
} from "../../scripts/tools/pack-textures.mjs";

const config = {
  format: "ferrum2d.sprite-normals.config",
  version: 1,
  inputs: ["hero.gif"],
  outputDir: "out",
  animation: { loop: false },
};
const metadata = {
  width: 4,
  height: 2,
  animation: {
    frame_width: 2,
    frame_height: 2,
    columns: 2,
    frame_count: 2,
    delays_ms: [
      [50, 1],
      [100, 1],
    ],
  },
};
const colorPixels = Uint8Array.from(
  Array.from({ length: 8 }, (_, i) => [i, 80, 200, i === 0 ? 0 : 255]).flat(),
);
const normalPixels = Uint8Array.from(
  Array.from({ length: 8 }, (_, i) => [
    128 + i,
    128,
    255,
    i === 0 ? 0 : 255,
  ]).flat(),
);
function input(overrides = {}) {
  return {
    colorPng: encodePngRgba(4, 2, colorPixels),
    normalPng: encodePngRgba(4, 2, normalPixels),
    metadata,
    names: normalAnimationNames("hero"),
    options: { loop: false },
    ...overrides,
  };
}

test("exact millisecond and rational delays fit native clips without quantizing", () => {
  const gif = resolveNormalAnimationTiming([
    [50, 1],
    [90, 1],
    [120, 1],
    [60, 1],
  ]);
  assert.deepEqual(gif.repeats, [5, 9, 12, 6]);
  assert.equal(gif.nativeFps, 100);
  assert.equal(gif.sourceFrameIndices.length, 32);
  assert.equal(gif.nativeCycleErrorMs, 0);
  const apng = resolveNormalAnimationTiming([
    [250, 3],
    [50, 1],
    [100, 3],
  ]);
  assert.deepEqual(apng.tickMs, [50, 3]);
  assert.deepEqual(apng.repeats, [5, 3, 2]);
  assert.equal(apng.nativeFps, 60);
  const fractional = resolveNormalAnimationTiming([
    [70, 1],
    [140, 1],
  ]);
  assert.equal(fractional.nativeFps, Math.fround(100 / 7));
  assert.notEqual(fractional.nativeCycleErrorMs, 0);
});

test("unrepresentable delays fail rather than silently changing timing", () => {
  for (const invalid of [
    [],
    [[0, 1]],
    [[1, 0]],
    [[-1, 1]],
    [[1.5, 1]],
    [[1, 1, 1]],
    [[0x100000000, 1]],
    [
      [1, 1],
      [32, 1],
    ],
    [[1, 2]],
    [[1000001, 1]],
    [
      [0xffffffff, 0xfffffffe],
      [0xfffffffe, 0xffffffff],
    ],
  ])
    assert.throws(() => resolveNormalAnimationTiming(invalid), {
      code: "FERRUM_NORMAL_TIMING_UNSUPPORTED",
    });
});

test("config v1 adds explicit loop and rejects ambiguous atlas options", () => {
  assert.equal(
    parseNormalConfig(config, "/tmp/job.json").animation.loop,
    false,
  );
  const old = { ...config };
  delete old.animation;
  assert(!Object.hasOwn(parseNormalConfig(old, "/tmp/job.json"), "animation"));
  for (const animation of [
    null,
    {},
    { loop: 0 },
    { loop: true, rotated: true },
    { loop: true, trimmed: false },
    { loop: true, padding: 9 },
    { loop: true, padding: null },
    { loop: true, clipId: 65536 },
    { loop: true, maxSize: 4097 },
    { loop: true, powerOfTwo: null },
  ])
    assert.throws(
      () => parseNormalConfig({ ...config, animation }, "/tmp/job.json"),
      { code: "FERRUM_NORMAL_CONFIG_INVALID" },
    );
});

test("one layout preserves every color/normal pixel, edge padding and repeated UVs", () => {
  const packed = packNormalAnimation(input());
  const color = decodePng(packed.colorPng),
    normal = decodePng(packed.normalPng),
    d = packed.descriptor;
  assert.equal(d.textures.normal.colorSpace, "none");
  assert.equal(d.animationSet.clips[0].loop, false);
  assert.deepEqual(d.animationSet.clips[0].frames, [
    d.atlas.frames["frame-000"].uv,
    d.atlas.frames["frame-001"].uv,
    d.atlas.frames["frame-001"].uv,
  ]);
  for (const [index, p] of [...d.atlas.placements]
    .sort((a, b) => a.name.localeCompare(b.name))
    .entries()) {
    for (let y = -1; y <= 2; y++)
      for (let x = -1; x <= 2; x++) {
        const source =
            (Math.max(0, Math.min(1, y)) * 4 +
              index * 2 +
              Math.max(0, Math.min(1, x))) *
            4,
          target = ((p.y + y) * color.width + p.x + x) * 4;
        assert.deepEqual(
          color.pixels.slice(target, target + 4),
          colorPixels.slice(source, source + 4),
        );
        assert.deepEqual(
          normal.pixels.slice(target, target + 4),
          normalPixels.slice(source, source + 4),
        );
      }
  }
  assert.deepEqual(packNormalAnimation(input()).colorPng, packed.colorPng);
  const noPadding = packNormalAnimation(
    input({ options: { loop: true, padding: 0, powerOfTwo: false } }),
  );
  assert.equal(noPadding.descriptor.animationSet.clips[0].loop, true);
  const small = packNormalAnimation(
    input({
      options: { loop: true, padding: 0, maxSize: 4, powerOfTwo: false },
    }),
  );
  assert(
    small.descriptor.atlas.width <= 4 && small.descriptor.atlas.height <= 4,
  );
});

test("malformed metadata, alpha, unused cells and packing budgets fail explicitly", () => {
  for (const m of [
    null,
    { ...metadata, rotated: true },
    { ...metadata, width: 3 },
    { ...metadata, animation: { ...metadata.animation, frame_width: 0 } },
    { ...metadata, animation: { ...metadata.animation, columns: 3 } },
    { ...metadata, animation: { ...metadata.animation, delays_ms: [[50, 1]] } },
    { ...metadata, animation: { ...metadata.animation, trimmed: true } },
  ])
    assert.throws(() => packNormalAnimation(input({ metadata: m })), {
      code: "FERRUM_NORMAL_ATLAS_INVALID",
    });
  const alpha = normalPixels.slice();
  alpha[3] = 255;
  assert.throws(
    () => packNormalAnimation(input({ normalPng: encodePngRgba(4, 2, alpha) })),
    { code: "FERRUM_NORMAL_ATLAS_INVALID" },
  );
  assert.throws(
    () => packNormalAnimation(input({ options: { loop: true, maxSize: 2 } })),
    { code: "FERRUM_NORMAL_ATLAS_INVALID" },
  );
  const three = {
    ...metadata,
    height: 4,
    animation: {
      ...metadata.animation,
      frame_count: 3,
      delays_ms: [
        [100, 1],
        [100, 1],
        [100, 1],
      ],
    },
  };
  const full = encodePngRgba(4, 4, new Uint8Array(64).fill(255));
  assert.throws(
    () =>
      packNormalAnimation(
        input({ metadata: three, colorPng: full, normalPng: full }),
      ),
    { code: "FERRUM_NORMAL_ATLAS_INVALID" },
  );
  const huge = {
    ...metadata,
    width: 4096,
    height: 4096,
    animation: { ...metadata.animation, frame_width: 2048, frame_height: 4096 },
  };
  assert.throws(() => packNormalAnimation(input({ metadata: huge })), {
    code: "FERRUM_NORMAL_ATLAS_INVALID",
  });
});

test("PNG decoding bounds inflated bytes and rejects truncated streams", () => {
  const png = input().colorPng;
  assert.throws(() => decodePng(png, { maxPixels: 7 }), /pixel limit/);
  assert.throws(() => decodePng(png.subarray(0, png.length - 2)), /Truncated/);
  // Replace a valid IDAT with too many decompressed rows; CRC is irrelevant to inflate length validation.
  const idat = png.indexOf(Buffer.from("IDAT")),
    extra = deflateSync(Buffer.alloc(1000));
  const fake = Buffer.concat([
    png.subarray(0, idat - 4),
    Buffer.alloc(4),
    Buffer.from("IDAT"),
    extra,
    Buffer.alloc(4),
    png.subarray(png.length - 12),
  ]);
  fake.writeUInt32BE(extra.length, idat - 4);
  assert.throws(() => decodePng(fake), /larger than|maxOutputLength/i);
});

test("adapter transaction publishes all six artifacts and protects derived filenames", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "ferrum-normal-animation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = resolve(root, "job.json"),
    output = resolve(root, "out");
  await writeFile(resolve(root, "hero.gif"), "source");
  await writeFile(file, JSON.stringify(config));
  let calls = 0;
  const deps = {
    installedTool: async () => ({
      binary: "/fake",
      manifest: { revision: "test" },
    }),
    execute: async (_, args) => {
      calls++;
      const dir = args[args.indexOf("--output-dir") + 1];
      await writeFile(resolve(dir, "hero_n.png"), input().normalPng);
      await writeFile(resolve(dir, "hero_n.color.png"), input().colorPng);
      await writeFile(
        resolve(dir, "hero_n.frames.json"),
        JSON.stringify(metadata),
      );
    },
  };
  await mkdir(output);
  await writeFile(resolve(output, "hero_n.ferrum.json"), "keep");
  await assert.rejects(generateSpriteNormals(file, deps), {
    code: "FERRUM_NORMAL_OUTPUT_EXISTS",
  });
  assert.equal(calls, 0);
  await rm(resolve(output, "hero_n.ferrum.json"));
  const report = await generateSpriteNormals(file, deps);
  assert.equal(report.results[0].outputs.length, 6);
  assert.equal((await readdir(output)).length, 7);
  const d = JSON.parse(
    await readFile(
      resolve(output, report.results[0].ferrumAnimation.descriptor),
    ),
  );
  assert.equal(d.animationSet.clips[0].loop, false);
  await rm(output, { recursive: true });
  await writeFile(
    file,
    JSON.stringify({ ...config, animation: { loop: true, maxSize: 2 } }),
  );
  await assert.rejects(generateSpriteNormals(file, deps), {
    code: "FERRUM_NORMAL_ATLAS_INVALID",
  });
  assert.deepEqual(await readdir(output), []);
  await writeFile(file, JSON.stringify(config));
  const raced = {
    ...deps,
    execute: async (...args) => {
      await deps.execute(...args);
      await writeFile(
        resolve(output, "hero_n.ferrum.normal.png"),
        "competing output",
      );
    },
  };
  await assert.rejects(generateSpriteNormals(file, raced), { code: "EEXIST" });
  assert.deepEqual(await readdir(output), ["hero_n.ferrum.normal.png"]);
  assert.equal(
    await readFile(resolve(output, "hero_n.ferrum.normal.png"), "utf8"),
    "competing output",
  );
});

test("invalid generator metadata and unsupported timing leave no partial results", async (t) => {
  const root = await mkdtemp(
    resolve(tmpdir(), "ferrum-normal-timing-failure-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(resolve(root, "hero.gif"), "source");
  const file = resolve(root, "job.json"),
    output = resolve(root, "out");
  await writeFile(file, JSON.stringify(config));
  for (const [value, code] of [
    [null, "FERRUM_NORMAL_OUTPUT_INVALID"],
    [
      {
        ...metadata,
        animation: {
          ...metadata.animation,
          delays_ms: [
            [1, 1],
            [32, 1],
          ],
        },
      },
      "FERRUM_NORMAL_TIMING_UNSUPPORTED",
    ],
    [
      {
        ...metadata,
        animation: {
          ...metadata.animation,
          delays_ms: [
            [0, 1],
            [100, 1],
          ],
        },
      },
      "FERRUM_NORMAL_TIMING_UNSUPPORTED",
    ],
    [undefined, "FERRUM_NORMAL_ATLAS_INVALID"],
  ]) {
    await assert.rejects(
      generateSpriteNormals(file, {
        installedTool: async () => ({ binary: "/fake", manifest: {} }),
        execute: async (_, args) => {
          const dir = args[args.indexOf("--output-dir") + 1];
          await writeFile(resolve(dir, "hero_n.png"), input().normalPng);
          if (value !== undefined) {
            await writeFile(resolve(dir, "hero_n.color.png"), input().colorPng);
            await writeFile(
              resolve(dir, "hero_n.frames.json"),
              JSON.stringify(value),
            );
          }
        },
      }),
      { code },
    );
    assert.deepEqual(await readdir(output), []);
  }
});
