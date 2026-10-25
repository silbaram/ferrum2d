import {
  createSpriteNormalWorkerClient,
  createSpriteNormalAssetBinding,
  diagnoseSpriteNormalAssetBinding,
  createSceneSpriteNormalPatch,
  mergeScenePlacementPatch,
  applyDataSceneAuthoringDocument,
  SPRITE_NORMAL_WORKER_LIMITS,
} from "@ferrum2d/ferrum-web/authoring";
import {
  createEngine,
  WebGL2Renderer,
  AssetLoader,
} from "@ferrum2d/ferrum-web/core";

const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const sha256 = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
async function expectCode(promise, code) {
  const error = await promise.then(
    () => undefined,
    (error) => error,
  );
  assert(
    error?.code === code,
    `Expected ${code}, received ${error?.code}: ${error}`,
  );
  return error;
}
const pixels = (canvas) => {
  const gl = canvas.getContext("webgl2"),
    p = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(
    0,
    0,
    canvas.width,
    canvas.height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    p,
  );
  assert(gl.getError() === gl.NO_ERROR, "WebGL error");
  return p;
};
function difference(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i += 4)
    if (
      Math.abs(a[i] - b[i]) +
        Math.abs(a[i + 1] - b[i + 1]) +
        Math.abs(a[i + 2] - b[i + 2]) >
      15
    )
      n++;
  return n;
}
function sourceDocument() {
  return {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    sceneComposition: {
      initialFragment: "normal",
      prefabs: { object: {} },
      fragments: {
        normal: {
          instances: [
            {
              id: "sprite",
              prefab: "object",
              x: 0,
              y: 0,
              props: {
                components: {
                  visual: {
                    kind: "sprite",
                    texture: 0,
                    width: 64,
                    height: 64,
                    originX: 0.5,
                    originY: 1,
                  },
                  collider: "none",
                  layer: "player",
                },
              },
            },
          ],
        },
      },
    },
    behaviorRecipes: { entities: {} },
    spatial: {
      camera: {
        projection: "orthographic",
        position: { x: 0, y: -200, elevation: 80 },
        target: { x: 0, y: 0, elevation: 32 },
        height: 110,
        near: 0.1,
        far: 1200,
      },
      terrain: [],
      billboards: { sprite: {} },
      environment: {
        lighting: {
          ambient: [0.05, 0.05, 0.05],
          lights: [
            {
              position: { x: 65, y: -80, elevation: 70 },
              radius: 300,
              intensity: 2,
            },
          ],
        },
      },
    },
  };
}

export async function probeNormalWorker() {
  const config = await (await fetch("/config.json")).json(),
    NativeWorker = globalThis.Worker;
  let created = 0,
    terminated = 0;
  globalThis.Worker = class extends NativeWorker {
    dead = false;
    constructor(...args) {
      super(...args);
      created++;
    }
    terminate() {
      if (!this.dead) {
        terminated++;
        this.dead = true;
      }
      super.terminate();
    }
  };
  const source = {
    ...config.source,
    manifestUrl: new URL(config.source.manifestUrl, location.href).href,
  };
  const client = createSpriteNormalWorkerClient({ generator: source }),
    others = [],
    urls = [];
  let engine, renderer;
  try {
    assert(created === 0, "Client created an eager Worker");
    const outcomes = [],
      inputs = [];
    for (const [index, entry] of config.cases.entries()) {
      const bytes = new Uint8Array(
          await (await fetch(entry.url)).arrayBuffer(),
        ),
        originalHash = await sha256(bytes);
      const input = {
        name: entry.name,
        bytes,
        ...(entry.settings ? { settings: entry.settings } : {}),
        ...(entry.animation ? { animation: entry.animation } : {}),
      };
      inputs.push(input);
      const result = await client.generate(input);
      assert(
        bytes.byteLength > 0 && (await sha256(bytes)) === originalHash,
        "Worker detached or mutated caller input",
      );
      assert(
        result.stats.generatorCalls === result.stats.freedResults,
        "Native result was not freed",
      );
      const binding = createSpriteNormalAssetBinding({
        report: result.report,
        descriptor: result.descriptor,
        descriptorSha256: result.descriptorSha256,
        colorAsset: `generated.${index}.color`,
        normalAsset: `generated.${index}.normal`,
      });
      const metadata = [];
      for (const [kind, buffer] of [
        ["color", result.colorPng],
        ["normal", result.normalPng],
      ]) {
        const image = await createImageBitmap(
          new Blob([buffer], { type: "image/png" }),
        );
        metadata.push({
          id: binding.textures[kind].asset,
          width: image.width,
          height: image.height,
          colorSpace: binding.textures[kind].colorSpace,
          sha256: await sha256(buffer),
          frames: binding.frames,
        });
        image.close();
      }
      assert(
        diagnoseSpriteNormalAssetBinding(binding, metadata).length === 0,
        "Worker result did not satisfy existing binding metadata",
      );
      const original = sourceDocument(),
        before = JSON.stringify(original),
        patch = createSceneSpriteNormalPatch(original, binding, {
          instanceId: "sprite",
          assets: metadata,
        }).patch;
      assert(
        JSON.stringify(original) === before,
        "Worker result mutated source document",
      );
      const document = mergeScenePlacementPatch(original, patch).document;
      await globalThis.recordWorkerOutput(index, {
        normal: [...new Uint8Array(result.normalPng)],
        color: [...new Uint8Array(result.colorPng)],
        metadata: JSON.parse(result.metadataJson),
        report: result.report,
        descriptor: result.descriptor,
        binding,
      });
      outcomes.push({ result, binding, document, stats: result.stats });
    }
    const hit = await client.generate(inputs[0]);
    assert(hit.stats.cacheHit, "Warm result cache was not reused");
    new Uint8Array(hit.normalPng)[0] = 0;
    const second = await client.generate(inputs[0]);
    assert(
      new Uint8Array(second.normalPng)[0] === 137,
      "Caller mutation corrupted cached PNG bytes",
    );
    const capacities = [];
    for (let i = 0; i < 10; i++) {
      const result = await client.generate({
        ...inputs[0],
        name: `retained-${i}.png`,
      });
      assert(
        result.stats.cacheEntries <= 4 &&
          result.stats.cacheBytes <= SPRITE_NORMAL_WORKER_LIMITS.cacheBytes,
        "Cache exceeded budgets",
      );
      assert(
        result.stats.generatorCalls === result.stats.freedResults,
        "Result ownership leaked",
      );
      capacities.push(result.stats.wasmMemoryBytes);
    }
    assert(
      Math.max(...capacities.slice(-4)) - Math.min(...capacities.slice(-4)) <=
        65536,
      "Repeated fixed workloads keep growing Wasm capacity",
    );

    const canvas = document.querySelector("canvas");
    renderer = new WebGL2Renderer(canvas, {
      preserveDrawingBuffer: true,
      clearColor: [0.02, 0.02, 0.02, 1],
    });
    const loader = new AssetLoader(renderer),
      first = outcomes[0];
    const colorUrl = URL.createObjectURL(
        new Blob([first.result.colorPng], { type: "image/png" }),
      ),
      normalUrl = URL.createObjectURL(
        new Blob([first.result.normalPng], { type: "image/png" }),
      );
    urls.push(colorUrl, normalUrl);
    await loader.loadAssets({
      textures: {
        [first.binding.textures.color.asset]: colorUrl,
        [first.binding.textures.normal.asset]: normalUrl,
      },
      textureOptions: {
        [first.binding.textures.normal.asset]: { colorSpace: "none" },
      },
    });
    let frames = 0,
      failure;
    engine = await createEngine(
      (frame) => {
        try {
          renderer.render();
          renderer.renderCommands(frame.renderCommandBuffer);
          renderer.renderPostProcess();
          frames++;
        } catch (error) {
          failure = error;
        }
      },
      () => ({}),
      loader,
      () => renderer.viewportSize(),
    );
    const viewport = renderer.viewportSize();
    engine.setViewportSize(viewport.width, viewport.height);
    engine.start();
    const capture = async (value) => {
      applyDataSceneAuthoringDocument(engine, value);
      engine.pauseDataScene();
      const before = frames;
      for (let i = 0; frames < before + 2 && i < 120; i++) {
        await new Promise(requestAnimationFrame);
        if (failure) throw failure;
      }
      assert(frames >= before + 2, "Native preview did not render");
      return pixels(canvas);
    };
    const lit = await capture(first.document);
    await globalThis.saveWorkerScreenshot("normal-lit", canvas.toDataURL());
    const flatDoc = structuredClone(first.document);
    delete flatDoc.spatial.billboards.sprite.normalTexture;
    const flat = await capture(flatDoc);
    await globalThis.saveWorkerScreenshot("flat", canvas.toDataURL());
    const changedPixels = difference(lit, flat);
    assert(
      changedPixels > 100,
      "Worker-generated normal did not affect existing native lighting",
    );
    await capture(first.document);

    // Run actual synchronous Wasm work while the native preview and the main event loop continue.
    const heavyBytes = new Uint8Array(
      await (await fetch("/heavy.png")).arrayBuffer(),
    );
    let heartbeats = 0;
    const beforeFrames = frames;
    const timer = setInterval(() => heartbeats++, 5);
    let heavy;
    try {
      heavy = await client.generate({ name: "heavy.png", bytes: heavyBytes });
    } finally {
      clearInterval(timer);
    }
    assert(
      heavy.stats.wasmMemoryBytes <= SPRITE_NORMAL_WORKER_LIMITS.memoryBytes,
      "Wasm memory exceeded hard maximum",
    );
    if (heavy.elapsedMs >= 50)
      assert(
        heartbeats > 0 && frames > beforeFrames,
        "Asset generation blocked the main/native frame loop",
      );

    const controller = new AbortController(),
      aborted = expectCode(
        client.generate(
          { name: "cancel.png", bytes: heavyBytes },
          { signal: controller.signal },
        ),
        "aborted",
      );
    controller.abort();
    await aborted;
    const stale = expectCode(client.generate(inputs[0]), "superseded"),
      latest = client.generate(inputs[0]);
    await stale;
    await latest;
    const beforeClear = created;
    client.clearCache();
    const afterClear = await client.generate(inputs[0]);
    assert(
      created > beforeClear && !afterClear.stats.cacheHit,
      "Cache clear did not recreate generator",
    );
    const beforeFailure = pixels(canvas),
      tooMany = new Uint8Array(
        await (await fetch("/too-many.gif")).arrayBuffer(),
      );
    const frameError = await client
      .generate({ name: "too-many.gif", bytes: tooMany })
      .then(
        () => undefined,
        (error) => error,
      );
    assert(
      frameError && /frame|256/i.test(frameError.message),
      "Generator accepted more than 256 frames",
    );
    await client.generate(inputs[0]);
    assert(
      difference(beforeFailure, pixels(canvas)) === 0,
      "Rejected generation changed the current scene",
    );
    const bad = createSpriteNormalWorkerClient({
      generator: { ...source, manifestSha256: "0".repeat(64) },
    });
    others.push(bad);
    await expectCode(bad.generate(inputs[0]), "generatorInvalid");
    const corrupt = createSpriteNormalWorkerClient({
      generator: {
        ...source,
        manifestUrl: new URL("/corrupt/manifest.json", location.href).href,
      },
    });
    others.push(corrupt);
    await expectCode(corrupt.generate(inputs[0]), "generatorInvalid");
    const hang = URL.createObjectURL(
      new Blob(["self.onmessage=()=>{};"], { type: "text/javascript" }),
    );
    urls.push(hang);
    const timed = createSpriteNormalWorkerClient({
      generator: source,
      workerFactory: () => new Worker(hang, { type: "module" }),
    });
    others.push(timed);
    await expectCode(timed.generate(inputs[0], { timeoutMs: 20 }), "timeout");
    client.destroy();
    for (const other of others) other.destroy();
    await expectCode(client.generate(inputs[0]), "destroyed");
    assert(created === terminated, "Owned workers remain alive after destroy");
    return {
      moduleWorkers: true,
      lazyLoad: true,
      callerBytesPreserved: true,
      cacheOwned: true,
      cacheBounded: true,
      freedResults: true,
      capacities,
      heartbeatCount: heartbeats,
      nativeFramesDuringGeneration: frames - beforeFrames,
      heavyElapsedMs: heavy.elapsedMs,
      heavyMemoryBytes: heavy.stats.wasmMemoryBytes,
      changedPixels,
      cancelled: true,
      superseded: true,
      timeout: true,
      frameLimitRejected: true,
      integrityRejected: true,
      sourceAndScenePreserved: true,
      workersCreated: created,
      workersTerminated: terminated,
      cases: outcomes.map((o) => ({
        stats: o.stats,
        hasDescriptor: !!o.result.descriptor,
      })),
    };
  } finally {
    client.destroy();
    for (const other of others) other.destroy();
    engine?.destroy();
    renderer?.destroy();
    for (const url of urls) URL.revokeObjectURL(url);
    globalThis.Worker = NativeWorker;
  }
}
