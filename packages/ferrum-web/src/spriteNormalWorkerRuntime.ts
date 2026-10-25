import {
  createNormalWorkerOutput,
  preflightNormalWorkerBytes,
} from "./spriteNormalWorkerOutput.js";
import {
  NORMAL_GENERATOR_REVISION,
  SPRITE_NORMAL_WORKER_LIMITS as limits,
  SpriteNormalWorkerError,
  normalRecord,
  normalSha256,
  type NormalWorkerRequest,
  type SpriteNormalGeneratorSource,
  type SpriteNormalWorkerResult,
} from "./spriteNormalWorkerProtocol.js";

export interface NormalWasmResult {
  readonly normal_png: Uint8Array;
  readonly color_png: Uint8Array;
  readonly metadata: string;
  free(): void;
}
export interface LoadedNormalGenerator {
  generate(bytes: Uint8Array, settings: string): NormalWasmResult;
  memoryBytes(): number;
  provenance: Record<string, unknown>;
}
async function boundedFetch(url: string, limit: number): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok || !response.body)
    throw new SpriteNormalWorkerError(
      "generatorInvalid",
      `Generator resource unavailable: ${response.status}`,
    );
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit)
        throw new SpriteNormalWorkerError(
          "generatorInvalid",
          "Generator resource exceeds byte limits",
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export async function loadNormalGenerator(
  source: SpriteNormalGeneratorSource,
): Promise<LoadedNormalGenerator> {
  const bytes = await boundedFetch(source.manifestUrl, 65536);
  if ((await normalSha256(bytes)) !== source.manifestSha256)
    throw new SpriteNormalWorkerError(
      "generatorInvalid",
      "Generator manifest SHA-256 differs",
    );
  const manifest = normalRecord(
      JSON.parse(new TextDecoder().decode(bytes)),
      "generator manifest",
    ),
    generator = normalRecord(manifest.generator, "generator provenance");
  if (
    manifest.format !== "ferrum2d.sprite-normal.generator" ||
    manifest.version !== 1 ||
    manifest.memoryMaxBytes !== limits.memoryBytes ||
    manifest.target !== "wasm32-unknown-unknown" ||
    generator.revision !== NORMAL_GENERATOR_REVISION ||
    generator.repository !==
      "https://github.com/Hugo-Dz/spritefusion-sprite-normals.git" ||
    generator.name !== "spritefusion-sprite-normals" ||
    generator.version !== "0.1.0" ||
    generator.license !== "MIT" ||
    typeof manifest.adapterSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.adapterSha256)
  )
    throw new SpriteNormalWorkerError(
      "generatorInvalid",
      "Generator manifest has unsupported provenance or memory limits",
    );
  const resource = async (kind: string, path: string, max: number) => {
    const entry = normalRecord(manifest[kind], kind);
    if (
      entry.path !== path ||
      !Number.isInteger(entry.bytes) ||
      (entry.bytes as number) < 1 ||
      (entry.bytes as number) > max ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    )
      throw new SpriteNormalWorkerError(
        "generatorInvalid",
        `Invalid ${kind} manifest entry`,
      );
    const data = await boundedFetch(
      new URL(path, source.manifestUrl).href,
      max,
    );
    if (
      data.length !== entry.bytes ||
      (await normalSha256(data)) !== entry.sha256
    )
      throw new SpriteNormalWorkerError(
        "generatorInvalid",
        `${kind} SHA-256 differs`,
      );
    return data;
  };
  const [moduleBytes, wasmBytes, license] = await Promise.all([
    resource("module", "spritefusion_sprite_normals.js", 512 * 1024),
    resource("wasm", "spritefusion_sprite_normals_bg.wasm", 8 * 1024 * 1024),
    resource("license", "LICENSE", 8192),
  ]);
  if (!new TextDecoder().decode(license).startsWith("MIT License"))
    throw new SpriteNormalWorkerError(
      "generatorInvalid",
      "Generator MIT notice missing",
    );
  const blob = URL.createObjectURL(
    new Blob([moduleBytes as Uint8Array<ArrayBuffer>], {
      type: "text/javascript",
    }),
  );
  try {
    const module = (await import(/* @vite-ignore */ blob)) as {
      default(options: {
        module_or_path: Uint8Array;
      }): Promise<{ memory: WebAssembly.Memory }>;
      generate_normal_map(
        bytes: Uint8Array,
        settings: string,
      ): NormalWasmResult;
    };
    if (
      typeof module.default !== "function" ||
      typeof module.generate_normal_map !== "function"
    )
      throw new SpriteNormalWorkerError(
        "generatorInvalid",
        "Generator exports differ",
      );
    const initialized = await module.default({ module_or_path: wasmBytes });
    if (
      !(initialized.memory instanceof WebAssembly.Memory) ||
      initialized.memory.buffer.byteLength > limits.memoryBytes
    )
      throw new SpriteNormalWorkerError(
        "generatorInvalid",
        "Generator memory unavailable or over budget",
      );
    return {
      generate: (input, settings) =>
        module.generate_normal_map(input, settings),
      memoryBytes: () => initialized.memory.buffer.byteLength,
      provenance: {
        ...generator,
        platform: "browser",
        arch: "wasm32",
        binarySha256: normalRecord(manifest.wasm, "wasm").sha256,
        manifestSha256: source.manifestSha256,
        adapterSha256: manifest.adapterSha256,
      },
    };
  } finally {
    URL.revokeObjectURL(blob);
  }
}

/** One worker, one generator instance, bounded immutable result cache. No engine or renderer imports. */
export class NormalGeneratorWorkerRuntime {
  private generator?: Promise<LoadedNormalGenerator>;
  private sourceKey?: string;
  private calls = 0;
  private freed = 0;
  private readonly cache = new Map<
    string,
    {
      result: Awaited<ReturnType<typeof createNormalWorkerOutput>>;
      bytes: number;
    }
  >();
  private retainedBytes = 0;
  constructor(
    private readonly load: (
      source: SpriteNormalGeneratorSource,
    ) => Promise<LoadedNormalGenerator> = loadNormalGenerator,
  ) {}

  async run(request: NormalWorkerRequest): Promise<SpriteNormalWorkerResult> {
    const started = performance.now(),
      input = new Uint8Array(request.buffer);
    preflightNormalWorkerBytes(input, request.job);
    while (this.cache.size && this.retainedBytes > request.cacheBytes) {
      const oldest = this.cache.keys().next().value!;
      this.retainedBytes -= this.cache.get(oldest)!.bytes;
      this.cache.delete(oldest);
    }
    const sourceKey = JSON.stringify(request.source);
    if (this.sourceKey && sourceKey !== this.sourceKey)
      throw new SpriteNormalWorkerError(
        "generatorInvalid",
        "A worker cannot change generator identity",
      );
    this.sourceKey = sourceKey;
    this.generator ??= this.load(request.source);
    const generator = await this.generator,
      key = await normalSha256(
        JSON.stringify(request.job) + (await normalSha256(input)),
      );
    const cached = this.cache.get(key);
    let output: Awaited<ReturnType<typeof createNormalWorkerOutput>>;
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      output = cached.result;
    } else {
      const s = request.job.settings;
      const settings = {
        strength: s.normalStrength,
        detail: s.detailStrength,
        smoothing: s.detailScale,
        volume: s.shapeStrength,
        shape_radius: s.shapeRadius,
        shape_softness: s.shapeSoftness,
        alpha_threshold: s.alphaThreshold,
        ...(s.frameSize
          ? { frame_width: s.frameSize.width, frame_height: s.frameSize.height }
          : {}),
      };
      let result: NormalWasmResult | undefined,
        normal: Uint8Array,
        color: Uint8Array,
        metadata: string;
      try {
        this.calls++;
        result = generator.generate(input, JSON.stringify(settings));
        // Getters return owned arrays upstream; copy again before free to keep the ABI contract explicit.
        normal = result.normal_png.slice();
        color = result.color_png.slice();
        metadata = result.metadata;
      } finally {
        if (result) {
          try {
            result.free();
          } finally {
            this.freed++;
          }
        }
      }
      if (generator.memoryBytes() > limits.memoryBytes)
        throw new SpriteNormalWorkerError(
          "generationFailed",
          "Generator linear memory exceeds 256 MiB",
        );
      output = await createNormalWorkerOutput(
        request.job,
        input,
        normal!,
        color!,
        metadata!,
        generator.provenance,
      );
      const size =
        output.normalPng.byteLength +
        output.colorPng.byteLength +
        new TextEncoder().encode(
          JSON.stringify({
            ...output,
            normalPng: undefined,
            colorPng: undefined,
          }),
        ).length;
      if (size <= request.cacheBytes && request.cacheBytes > 0) {
        while (
          this.cache.size &&
          (this.cache.size >= limits.cacheEntries ||
            this.retainedBytes + size > request.cacheBytes)
        ) {
          const oldest = this.cache.keys().next().value!;
          this.retainedBytes -= this.cache.get(oldest)!.bytes;
          this.cache.delete(oldest);
        }
        this.cache.set(key, { result: output, bytes: size });
        this.retainedBytes += size;
      }
    }
    // Transferring these copies never detaches a cache entry or caller-owned bytes.
    return {
      ...output,
      normalPng: output.normalPng.slice(0),
      colorPng: output.colorPng.slice(0),
      elapsedMs: performance.now() - started,
      stats: {
        cacheHit: !!cached,
        cacheEntries: this.cache.size,
        cacheBytes: this.retainedBytes,
        wasmMemoryBytes: generator.memoryBytes(),
        generatorCalls: this.calls,
        freedResults: this.freed,
      },
    };
  }
}
