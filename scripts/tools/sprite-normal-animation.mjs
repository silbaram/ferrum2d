import { decodePng, encodePngRgba, packMaxRects } from "./pack-textures.mjs";
import { sha256, SpriteNormalsError } from "./sprite-normals-tool.mjs";

const MAX_PIXELS = 4_194_304;
function invalid(message) {
  throw new SpriteNormalsError("FERRUM_NORMAL_ATLAS_INVALID", message);
}
function fields(value, allowed, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    invalid(
      `Invalid ${label}; only full, uniform, unrotated frames are supported`,
    );
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    invalid(`${label} must be an integer in ${min}..${max}`);
  return value;
}

export function parseAnimationOptions(value) {
  fields(
    value,
    ["loop", "clipId", "padding", "maxSize", "powerOfTwo"],
    "animation options",
  );
  if (typeof value.loop !== "boolean")
    invalid(
      "animation.loop must be explicitly true or false; source loop count is not exported",
    );
  if (value.powerOfTwo !== undefined && typeof value.powerOfTwo !== "boolean")
    invalid("powerOfTwo must be boolean");
  return {
    loop: value.loop,
    clipId: integer(
      value.clipId === undefined ? 0 : value.clipId,
      0,
      65535,
      "clipId",
    ),
    padding: integer(
      value.padding === undefined ? 1 : value.padding,
      0,
      8,
      "padding",
    ),
    maxSize: integer(
      value.maxSize === undefined ? 2048 : value.maxSize,
      1,
      4096,
      "maxSize",
    ),
    powerOfTwo: value.powerOfTwo === undefined ? true : value.powerOfTwo,
  };
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}
function timingError(message) {
  throw new SpriteNormalsError("FERRUM_NORMAL_TIMING_UNSUPPORTED", message);
}

/** Exact rational GCD, followed by explicit native f32 timing disclosure. */
export function resolveNormalAnimationTiming(delays) {
  if (!Array.isArray(delays) || !delays.length || delays.length > 256)
    timingError("Expected 1..256 rational millisecond delays");
  const fractions = delays.map((pair) => {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      pair.some((n) => !Number.isInteger(n) || n < 1 || n > 0xffffffff)
    )
      timingError(
        "Each delay must be a positive uint32 numerator/denominator in milliseconds",
      );
    const n = BigInt(pair[0]),
      d = BigInt(pair[1]),
      divisor = gcd(n, d);
    return [n / divisor, d / divisor];
  });
  const denominator = fractions.reduce(
    (lcm, [, d]) => (lcm / gcd(lcm, d)) * d,
    1n,
  );
  const scaled = fractions.map(([n, d]) => n * (denominator / d));
  const numerator = scaled.reduce((a, b) => gcd(a, b));
  const repeatsBig = scaled.map((n) => n / numerator);
  const count = repeatsBig.reduce((a, b) => a + b, 0n);
  if (count > 32n)
    timingError(`Exact timing requires ${count} native frames; maximum is 32`);
  const divisor = gcd(numerator, denominator);
  const tick = [numerator / divisor, denominator / divisor].map(Number);
  if (tick.some((n) => !Number.isSafeInteger(n)))
    timingError("Timing tick exceeds exact JSON integer bounds");
  const fps = (1000 * tick[1]) / tick[0],
    nativeFps = Math.fround(fps);
  if (
    !Number.isFinite(nativeFps) ||
    fps < 0.001 ||
    fps > 1000 ||
    nativeFps < 0.001 ||
    nativeFps > 1000
  )
    timingError("Exact timing FPS must fit the native 0.001..1000 range");
  const repeats = repeatsBig.map(Number);
  const sourceFrameIndices = repeats.flatMap((repeat, index) =>
    Array(repeat).fill(index),
  );
  const sourceCycleMs = (Number(count) * tick[0]) / tick[1];
  const nativeCycleMs = (Number(count) * 1000) / nativeFps;
  return {
    sourceDelaysMs: delays.map((pair) => [...pair]),
    tickMs: tick,
    repeats,
    sourceFrameIndices,
    sourceLoopCount: "not-exported",
    requestedFps: fps,
    nativeFps,
    sourceCycleMs,
    nativeCycleMs,
    nativeCycleErrorMs: nativeCycleMs - sourceCycleMs,
  };
}

export function normalAnimationNames(stem) {
  return {
    color: `${stem}_n.ferrum.color.png`,
    normal: `${stem}_n.ferrum.normal.png`,
    descriptor: `${stem}_n.ferrum.json`,
  };
}

function boundedPng(data) {
  if (
    data.length < 33 ||
    data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    data.toString("ascii", 12, 16) !== "IHDR" ||
    data[24] !== 8 ||
    data[25] !== 6 ||
    data[28] !== 0
  )
    invalid("Expected non-interlaced RGBA8 PNG");
  const width = data.readUInt32BE(16),
    height = data.readUInt32BE(20);
  if (!width || !height || width * height > MAX_PIXELS)
    invalid("Decoded source exceeds 4,194,304 pixels");
  try {
    return decodePng(data, { maxPixels: MAX_PIXELS });
  } catch (error) {
    invalid(`Cannot decode generated PNG: ${error.message}`);
  }
}

/** Offline adapter only: never changes engine simulation or render command ABI. */
export function packNormalAnimation({
  colorPng,
  normalPng,
  metadata,
  names,
  options,
}) {
  options = parseAnimationOptions(options);
  fields(metadata, ["width", "height", "animation"], "frame metadata");
  const animation = metadata.animation;
  fields(
    animation,
    ["frame_width", "frame_height", "columns", "frame_count", "delays_ms"],
    "frame layout",
  );
  const fw = integer(animation.frame_width, 1, 4096, "frame_width"),
    fh = integer(animation.frame_height, 1, 4096, "frame_height"),
    count = integer(animation.frame_count, 1, 256, "frame_count"),
    columns = integer(animation.columns, 1, count, "columns"),
    rows = Math.ceil(count / columns);
  if (
    metadata.width !== fw * columns ||
    metadata.height !== fh * rows ||
    metadata.width * metadata.height > MAX_PIXELS
  )
    invalid("Metadata dimensions must match a bounded full uniform frame grid");
  if (
    !Array.isArray(animation.delays_ms) ||
    animation.delays_ms.length !== count
  )
    invalid("Frame delay count must match frame_count");
  const timing = resolveNormalAnimationTiming(animation.delays_ms);
  const color = boundedPng(colorPng),
    normal = boundedPng(normalPng);
  for (const image of [color, normal])
    if (image.width !== metadata.width || image.height !== metadata.height)
      invalid("Color/normal PNG dimensions differ from metadata");
  for (let y = 0; y < color.height; y++)
    for (let x = 0; x < color.width; x++) {
      const offset = (y * color.width + x) * 4 + 3;
      if (color.pixels[offset] !== normal.pixels[offset])
        invalid("Color/normal alpha differs");
      if (
        Math.floor(y / fh) * columns + Math.floor(x / fw) >= count &&
        color.pixels[offset]
      )
        invalid("Unused source cells must be transparent");
    }
  if (
    (fw + options.padding * 2) * (fh + options.padding * 2) * count >
    MAX_PIXELS
  )
    invalid("Padded frames exceed 4,194,304 pixels");
  const frames = Array.from({ length: count }, (_, index) => ({
    name: `frame-${String(index).padStart(3, "0")}`,
    width: fw,
    height: fh,
    index,
  }));
  let layout;
  try {
    layout = packMaxRects(frames, options);
  } catch (error) {
    invalid(error.message);
  }
  if (layout.width * layout.height > MAX_PIXELS)
    invalid("Packed output exceeds 4,194,304 pixels");
  const colorPixels = new Uint8Array(layout.width * layout.height * 4),
    normalPixels = new Uint8Array(colorPixels.length);
  for (let i = 0; i < normalPixels.length; i += 4)
    normalPixels.set([128, 128, 255, 0], i);
  const placements = layout.placements.map(({ sprite, ...placement }) => {
    const sx = (sprite.index % columns) * fw,
      sy = Math.floor(sprite.index / columns) * fh;
    for (let y = -options.padding; y < fh + options.padding; y++)
      for (let x = -options.padding; x < fw + options.padding; x++) {
        const source =
          ((sy + Math.max(0, Math.min(fh - 1, y))) * color.width +
            sx +
            Math.max(0, Math.min(fw - 1, x))) *
          4;
        const target = ((placement.y + y) * layout.width + placement.x + x) * 4;
        colorPixels.set(color.pixels.subarray(source, source + 4), target);
        normalPixels.set(normal.pixels.subarray(source, source + 4), target);
      }
    return {
      ...placement,
      uv: {
        u0: placement.x / layout.width,
        v0: placement.y / layout.height,
        u1: (placement.x + fw) / layout.width,
        v1: (placement.y + fh) / layout.height,
      },
    };
  });
  const atlasFrames = Object.fromEntries(
    placements.map((p) => [
      p.name,
      { texture: "color", uv: p.uv, size: { width: fw, height: fh } },
    ]),
  );
  const descriptor = {
    format: "ferrum2d.sprite-normal.animation",
    version: 1,
    textures: {
      color: { path: names.color, colorSpace: "srgb" },
      normal: { path: names.normal, colorSpace: "none" },
    },
    atlas: {
      format: "ferrum-texture-atlas-pack",
      version: 1,
      texture: "color",
      image: names.color,
      width: layout.width,
      height: layout.height,
      frames: atlasFrames,
      placements,
    },
    animationSet: {
      initialClip: options.clipId,
      clips: [
        {
          id: options.clipId,
          frames: timing.sourceFrameIndices.map(
            (index) => atlasFrames[frames[index].name].uv,
          ),
          fps: timing.nativeFps,
          loop: options.loop,
        },
      ],
    },
    timing,
    packing: {
      ...options,
      rotated: false,
      trimmed: false,
      paddingMode: "extrude",
      pivot: "unchanged",
    },
    source: {
      colorSha256: sha256(colorPng),
      normalSha256: sha256(normalPng),
      metadataCanonicalSha256: sha256(Buffer.from(JSON.stringify(metadata))),
    },
  };
  return {
    descriptor,
    colorPng: encodePngRgba(layout.width, layout.height, colorPixels),
    normalPng: encodePngRgba(layout.width, layout.height, normalPixels),
  };
}
