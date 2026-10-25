import {
  SpriteNormalWorkerError,
  SPRITE_NORMAL_WORKER_LIMITS as limits,
  normalRecord,
  normalPngDimensions,
  normalSha256,
  type NormalWorkerJob,
} from "./spriteNormalWorkerProtocol.js";

interface FrameMetadata {
  frame_width: number;
  frame_height: number;
  columns: number;
  frame_count: number;
  delays_ms: [number, number][];
}
function fail(message: string): never {
  throw new SpriteNormalWorkerError("resultInvalid", message);
}
function integer(value: unknown, min: number, max: number): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < min ||
    (value as number) > max
  )
    fail("Invalid frame metadata integer");
  return value as number;
}
function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a;
}
/** Exact delay math mirrors the offline CLI adapter; no engine simulation is executed here. */
export function normalWorkerTiming(delays: readonly (readonly number[])[]) {
  const fractions = delays.map((pair) => {
    if (
      pair.length !== 2 ||
      pair.some((n) => !Number.isInteger(n) || n < 1 || n > 0xffffffff)
    )
      fail("Timing requires positive uint32 millisecond fractions");
    const n = BigInt(pair[0]),
      d = BigInt(pair[1]),
      g = gcd(n, d);
    return [n / g, d / g];
  });
  const denominator = fractions.reduce((a, [, d]) => (a / gcd(a, d)) * d, 1n),
    scaled = fractions.map(([n, d]) => n * (denominator / d)),
    numerator = scaled.reduce(gcd),
    repeatsBig = scaled.map((n) => n / numerator),
    count = repeatsBig.reduce((a, b) => a + b, 0n);
  if (count > 32n) fail("Exact timing exceeds the native 32 frame limit");
  const divisor = gcd(numerator, denominator),
    tick = [Number(numerator / divisor), Number(denominator / divisor)],
    fps = (1000 * tick[1]) / tick[0],
    nativeFps = Math.fround(fps);
  if (
    tick.some((n) => !Number.isSafeInteger(n)) ||
    !Number.isFinite(nativeFps) ||
    fps < 0.001 ||
    fps > 1000 ||
    nativeFps < 0.001 ||
    nativeFps > 1000
  )
    fail("Exact timing exceeds native FPS 0.001..1000");
  const repeats = repeatsBig.map(Number),
    sourceCycleMs = (Number(count) * tick[0]) / tick[1],
    nativeCycleMs = (Number(count) * 1000) / nativeFps;
  return {
    sourceDelaysMs: delays.map((p) => [...p]),
    tickMs: tick,
    repeats,
    sourceFrameIndices: repeats.flatMap((n, i) => Array(n).fill(i)),
    sourceLoopCount: "not-exported",
    requestedFps: fps,
    nativeFps,
    sourceCycleMs,
    nativeCycleMs,
    nativeCycleErrorMs: nativeCycleMs - sourceCycleMs,
  };
}

export function preflightNormalWorkerBytes(
  bytes: Uint8Array,
  job: NormalWorkerJob,
): void {
  const png =
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71;
  const gif =
    bytes.length >= 10 &&
    new TextDecoder().decode(bytes.subarray(0, 6)).match(/^GIF8[79]a$/);
  if (!png && !gif)
    throw new SpriteNormalWorkerError(
      "invalidInput",
      "Only PNG/GIF/APNG bytes are supported",
    );
  if (png) {
    let dimensions: { width: number; height: number };
    try {
      dimensions = normalPngDimensions(bytes.buffer as ArrayBuffer);
    } catch {
      throw new SpriteNormalWorkerError(
        "invalidInput",
        "PNG dimensions exceed input limits",
      );
    }
    const frame = job.settings.frameSize;
    if (
      frame &&
      (dimensions.width % frame.width ||
        dimensions.height % frame.height ||
        (dimensions.width / frame.width) * (dimensions.height / frame.height) >
          limits.frames)
    )
      throw new SpriteNormalWorkerError(
        "invalidInput",
        "PNG frame grid must divide the image with at most 256 cells",
      );
  } else {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      w = view.getUint16(6, true),
      h = view.getUint16(8, true);
    if (!w || !h || w > 4096 || h > 4096 || w * h > limits.pixels)
      throw new SpriteNormalWorkerError(
        "invalidInput",
        "GIF dimensions exceed input limits",
      );
  }
}

export async function createNormalWorkerOutput(
  job: NormalWorkerJob,
  input: Uint8Array,
  normal: Uint8Array,
  color: Uint8Array,
  metadataJson: string,
  generator: Record<string, unknown>,
) {
  if (
    normal.length + color.length > limits.outputBytes ||
    new TextEncoder().encode(metadataJson).length > limits.metadataBytes
  )
    fail("Generated output exceeds byte limits");
  const dimensions = normalPngDimensions(normal.buffer as ArrayBuffer),
    colorDimensions = normalPngDimensions(color.buffer as ArrayBuffer),
    metadata = normalRecord(JSON.parse(metadataJson), "metadata");
  if (
    new Uint8Array(normal.buffer)[24] !== 8 ||
    new Uint8Array(normal.buffer)[25] !== 6 ||
    metadata.width !== dimensions.width ||
    metadata.height !== dimensions.height ||
    colorDimensions.width !== dimensions.width ||
    colorDimensions.height !== dimensions.height
  )
    fail("Color/normal/metadata dimensions differ or normal is not RGBA8");
  let frames: FrameMetadata | undefined;
  if (metadata.animation !== null) {
    const raw = normalRecord(metadata.animation, "animation"),
      fw = integer(raw.frame_width, 1, 4096),
      fh = integer(raw.frame_height, 1, 4096),
      count = integer(raw.frame_count, 1, 256),
      columns = integer(raw.columns, 1, count);
    if (
      fw * columns !== dimensions.width ||
      Math.ceil(count / columns) * fh !== dimensions.height ||
      !Array.isArray(raw.delays_ms) ||
      raw.delays_ms.length !== count ||
      raw.delays_ms.some(
        (pair) =>
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          !Number.isInteger(pair[0]) ||
          pair[0] < 0 ||
          pair[0] > 0xffffffff ||
          !Number.isInteger(pair[1]) ||
          pair[1] < 1 ||
          pair[1] > 0xffffffff,
      )
    )
      fail("Invalid frame layout/timing metadata");
    frames = {
      frame_width: fw,
      frame_height: fh,
      frame_count: count,
      columns,
      delays_ms: raw.delays_ms as [number, number][],
    };
  }
  if (job.animation && !frames)
    fail("animation export requires an animated image or PNG frameSize grid");
  // Static PNG retains original bytes, matching the CLI's source-color provenance contract.
  if (!frames) color = input.slice();
  const inputHash = await normalSha256(input),
    normalHash = await normalSha256(normal),
    colorHash = await normalSha256(color),
    stem = job.name.replace(/\.[^.]+$/u, ""),
    normalName = stem + "_n.png",
    colorName = frames ? stem + "_n.color.png" : job.name;
  const outputs = [
    { path: normalName, sha256: normalHash, bytes: normal.length },
  ];
  if (frames)
    outputs.push(
      { path: colorName, sha256: colorHash, bytes: color.length },
      {
        path: stem + "_n.frames.json",
        sha256: await normalSha256(metadataJson),
        bytes: new TextEncoder().encode(metadataJson).length,
      },
    );
  let descriptor: Record<string, unknown> | undefined,
    descriptorSha256: string | undefined;
  const descriptorName = stem + "_n.ferrum.json";
  if (job.animation && frames) {
    const timing = normalWorkerTiming(frames.delays_ms),
      uvs = Array.from({ length: frames.frame_count }, (_, i) => {
        const x = (i % frames!.columns) * frames!.frame_width,
          y = Math.floor(i / frames!.columns) * frames!.frame_height;
        return {
          name: `frame-${String(i).padStart(3, "0")}`,
          x,
          y,
          width: frames!.frame_width,
          height: frames!.frame_height,
          uv: {
            u0: x / dimensions.width,
            v0: y / dimensions.height,
            u1: (x + frames!.frame_width) / dimensions.width,
            v1: (y + frames!.frame_height) / dimensions.height,
          },
        };
      });
    descriptor = {
      format: "ferrum2d.sprite-normal.animation",
      version: 1,
      textures: {
        color: { path: colorName, colorSpace: "srgb" },
        normal: { path: normalName, colorSpace: "none" },
      },
      atlas: {
        format: "ferrum-texture-atlas-pack",
        version: 1,
        texture: "color",
        image: colorName,
        ...dimensions,
        frames: Object.fromEntries(
          uvs.map((f) => [
            f.name,
            {
              texture: "color",
              uv: f.uv,
              size: { width: f.width, height: f.height },
            },
          ]),
        ),
        placements: uvs,
      },
      animationSet: {
        initialClip: job.animation.clipId,
        clips: [
          {
            id: job.animation.clipId,
            loop: job.animation.loop,
            fps: timing.nativeFps,
            frames: timing.sourceFrameIndices.map((i) => uvs[i].uv),
          },
        ],
      },
      timing,
      packing: {
        padding: 0,
        rotated: false,
        trimmed: false,
        paddingMode: "none",
        layout: "source-grid",
        pivot: "unchanged",
      },
      source: {
        colorSha256: colorHash,
        normalSha256: normalHash,
        metadataCanonicalSha256: await normalSha256(JSON.stringify(metadata)),
      },
    };
    const encoded = JSON.stringify(descriptor, null, 2) + "\n";
    descriptorSha256 = await normalSha256(encoded);
    outputs.push({
      path: descriptorName,
      sha256: descriptorSha256,
      bytes: new TextEncoder().encode(encoded).length,
    });
  }
  const config = {
    name: job.name,
    settings: job.settings,
    ...(job.animation ? { animation: job.animation } : {}),
  };
  const report = {
    format: "ferrum2d.sprite-normals.report",
    version: 1,
    ok: true,
    generator,
    config: {
      path: "worker:" + job.name,
      sha256: await normalSha256(JSON.stringify(config)),
    },
    settings: job.settings,
    ...(job.animation
      ? {
          animation: {
            ...job.animation,
            padding: 0,
            maxSize: 4096,
            powerOfTwo: false,
          },
        }
      : {}),
    normalFormat: "opengl",
    colorSpace: "none",
    results: [
      {
        input: { path: job.name, sha256: inputHash, bytes: input.length },
        normal: normalName,
        color: colorName,
        ...(frames ? { frames: stem + "_n.frames.json" } : {}),
        ...(descriptor
          ? {
              ferrumAnimation: {
                color: colorName,
                normal: normalName,
                descriptor: descriptorName,
              },
            }
          : {}),
        ...dimensions,
        outputs,
      },
    ],
  };
  return {
    normalPng: normal.buffer as ArrayBuffer,
    colorPng: color.buffer as ArrayBuffer,
    metadataJson,
    report,
    ...(descriptor ? { descriptor, descriptorSha256 } : {}),
  };
}
