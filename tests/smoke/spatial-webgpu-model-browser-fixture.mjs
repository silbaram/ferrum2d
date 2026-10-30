import { RuntimeProfiler } from "@ferrum2d/ferrum-web/quality";
import {
  createEngine,
  createRenderer,
  createDataSceneSpatialView,
  loadSpatialGlb,
  captureGameStateSnapshot,
  restoreGameStateSnapshot,
} from "@ferrum2d/ferrum-web/core";
import {
  applyDataSceneAuthoringDocument,
  createSceneInstanceHandleRegistry,
} from "@ferrum2d/ferrum-web/authoring";
import { check, pixels, difference, png } from "/fixture.mjs";

// Distinct valid GLBs for a full next-scene batch; geometry is identical and tiny.
function recoveryVariant(raw,index){
  const original=new DataView(raw),length=original.getUint32(12,true);
  const json=JSON.parse(new TextDecoder().decode(new Uint8Array(raw,20,length)));
  json.asset.extras={recoveryFixture:index};
  const encoded=new TextEncoder().encode(JSON.stringify(json)),padded=(encoded.length+3)&~3;
  const result=new Uint8Array(raw.byteLength-length+padded),view=new DataView(result.buffer);
  result.set(new Uint8Array(raw,0,12));view.setUint32(8,result.byteLength,true);
  view.setUint32(12,padded,true);view.setUint32(16,0x4e4f534a,true);
  result.fill(32,20,20+padded);result.set(encoded,20);result.set(new Uint8Array(raw,20+length),20+padded);
  return result.buffer;
}

async function probe(canvas, backend, projection, recover=false) {
  if (backend === "webgpu") canvas.dataset.spatialGpuTarget = "true";
  const fallback = [],
    renderer = await createRenderer(canvas, {
      preferred: backend,
      fallbackBehavior: "silent",
      onFallback: (info) => fallback.push(String(info.reason)),
      webgl2: { preserveDrawingBuffer: true },
      webgpu: { gpuTiming: true },
    });
  check(
    (typeof renderer.gpuDevice === "function") === (backend === "webgpu"),
    "model renderer fell back",
    fallback,
  );
  const profiler = new RuntimeProfiler();
  const errors = [],
    registry = createSceneInstanceHandleRegistry(),
    options = { instanceHandleRegistry: registry, spatialModelPreparer: renderer };
  if (backend === "webgpu")
    renderer.gpuDevice().addEventListener("uncapturederror", (e) => errors.push(e.error.message));
  let engine,
    request,
    handles,
    lastPacket,
    frames = 0;
  const read = (packet) =>
    new Promise((resolve, reject) => {
      check(!request, "overlapping model readback");
      request = { resolve, reject, packet };
      engine.start();
    });
  try {
    const assets = new Map();
    for (const id of ["rock", "tree", "building", "tree-material"])
      assets.set(id, await loadSpatialGlb(`/${id}.glb`, { materialProfile: "diffuse" }));
    let preloadBytes = 0;
    if (backend === "webgpu")
      preloadBytes = await renderer.preloadSpatialModels([...assets.values()]);
    const components = {
      visual: { kind: "sprite", texture: 1, width: 64, height: 96, originY: 1 },
      collider: { type: "aabb", halfWidth: 2, halfHeight: 2 },
      layer: "player",
      body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 8 } },
    };
    const marker = {
      visual: { kind: "sprite", texture: 0, width: 1, height: 1, color: "#ffffff00" },
      collider: "none",
      layer: "wall",
    };
    const model = (asset, extra = {}) => ({
      asset,
      contentId: assets.get(asset).contentId,
      ...extra,
    });
    const doc = {
      format: "ferrum2d.consumer.scene-authoring",
      version: 1,
      gameplay: { primaryActor: "actor" },
      sceneComposition: {
        initialFragment: "lab",
        prefabs: { object: {} },
        fragments: {
          lab: {
            instances: [
              { id: "actor", prefab: "object", x: 0, y: 8, props: { components } },
              ...[
                ["rock", -80],
                ["tree", 0],
                ["tree-copy", 0],
                ["building", 80],
              ].map(([id, x]) => ({
                id,
                prefab: "object",
                x,
                y: 0,
                props: { components: marker },
              })),
            ],
          },
        },
      },
      behaviorRecipes: { entities: {} },
      spatial: {
        camera: {
          projection,
          position: {
            x: 0,
            y: -Math.max(250, (250 * canvas.clientHeight) / canvas.clientWidth),
            elevation: 48,
          },
          target: { x: 0, y: 0, elevation: 48 },
          height: Math.max(160, (240 * canvas.clientHeight) / canvas.clientWidth),
          fovDegrees: 70,
          near: 0.1,
          far: 2000,
        },
        terrain: [],
        billboards: { actor: {} },
        models: {
          rock: model("rock"),
          tree: model("tree"),
          "tree-copy": model("tree"),
          building: model("building", { scale: 0.5 }),
        },
      },
    };
    const image = document.createElement("canvas");
    image.width = image.height = 4;
    const c = image.getContext("2d");
    c.fillStyle = "#ff2020";
    c.fillRect(0, 0, 4, 4);
    await renderer.loadTexture(1, image.toDataURL());
    engine = await createEngine(
      (state) => {
        if (!handles) return;
        const pending = request;
        request = undefined;
        try {
          const packet = pending?.packet ?? state.renderCommandBuffer;
          const renderStart = performance.now();
          renderer.beginGpuTiming?.();
          renderer.render();
          const stats = renderer.renderCommands(packet);
          renderer.renderPostProcess();
          renderer.endGpuTiming?.();
          const allocation = renderer.resourceStats?.(), timing = renderer.gpuTimingStats?.();
          profiler.recordFrame({ fps: state.frameTimeMs > 0 ? 1000 / state.frameTimeMs : 0, entityCount: state.entityCount, spriteCount: stats.spriteCount, batchCount: stats.batchCount, frameTimeMs: state.frameTimeMs, rustUpdateTimeMs: state.rustUpdateTimeMs,
            renderTimeMs: performance.now() - renderStart, drawCalls: stats.drawCalls,
            ...(allocation ? { gpuTextureCount: allocation.textureCount, gpuBufferCount: allocation.bufferCount,
              gpuProgramCount: allocation.programCount, gpuRenderTargetCount: allocation.renderTargetCount,
              ...(allocation.estimatedBytes === undefined ? {} : { gpuEstimatedBytes: allocation.estimatedBytes }) } : {}),
            ...(timing?.status === "ready" ? { gpuFrameTimeMs: timing.elapsedMs, gpuFrameId: timing.frameId } : {}) });
          check(
            ++frames < 300 && state.rustUpdateTimeMs < 250 && !errors.length,
            "model frame/error budget",
            errors,
          );
          const s = packet.spatial,
            m = s.models,
            values = m.values.slice();
          lastPacket = {
            ...packet,
            buffer: packet.buffer.slice(),
            spatial: {
              ...s,
              camera: s.camera.slice(),
              terrain: s.terrain.slice(),
              terrainDrawRanges: s.terrainDrawRanges?.slice(),
              billboards: s.billboards.slice(),
              models: { ...m, values, words: new Uint32Array(values.buffer) },
            },
          };
          if (pending) {
            engine.stop();
            pixels(renderer, canvas).then(
              (data) => pending.resolve({ data, stats: stats.spatial, packet: lastPacket }),
              pending.reject,
            );
          }
        } catch (e) {
          errors.push(String(e));
          engine.stop();
          pending?.reject(e);
        }
      },
      undefined,
      undefined,
      () => renderer.viewportSize(),
    );
    for (const [id, a] of assets)
      check(engine.registerDataSceneSpatialModel(id, a), "model registration failed", id);
    renderer.resize();
    engine.setViewportSize(renderer.viewportSize().width, renderer.viewportSize().height);
    handles = applyDataSceneAuthoringDocument(engine, doc, options).entityHandles;
    check(engine.pauseDataScene(), "model pause failed");
    const first = await read(),
      warm = await read();
    check(
      warm.stats.modelCount === 4 &&
        warm.stats.visibleModelCount === 4 &&
        warm.stats.modelDrawCalls === 6 &&
        warm.stats.modelInstancedDrawCalls === 2 &&
        warm.stats.modelTriangleCount === 132 &&
        warm.stats.modelUploadBytes === 0,
      "model sharing/culling/draw path wrong",
      warm.stats,
    );
    let failedTextureReplacementPreserved;
    if (backend === "webgpu") {
      const queue = renderer.gpuDevice().queue;
      const descriptor = Object.getOwnPropertyDescriptor(queue, "copyExternalImageToTexture");
      const before = renderer.resourceStats();
      Object.defineProperty(queue, "copyExternalImageToTexture", { configurable: true, value() { throw Error("injected image-copy failure"); } });
      let rejected = false;
      try { await renderer.loadTexture(1, image.toDataURL()); }
      catch (error) { rejected = String(error).includes("injected image-copy failure"); }
      finally {
        if (descriptor) Object.defineProperty(queue, "copyExternalImageToTexture", descriptor);
        else delete queue.copyExternalImageToTexture;
      }
      check(rejected, "texture replacement did not hit the injected copy failure");
      check(JSON.stringify(renderer.resourceStats()) === JSON.stringify(before), "failed texture replacement leaked an allocation", { before, after: renderer.resourceStats() });
      check(difference((await read()).data, warm.data, 1) === 0, "failed texture replacement changed current scene pixels");
      failedTextureReplacementPreserved = true;
    }
    const view = createDataSceneSpatialView(engine, canvas),
      sample = (data, point) => {
        const p = view.project(point, lastPacket.spatial);
        check(p?.visible, "model sample outside view", p);
        const x = Math.round((p.x * canvas.width) / canvas.clientWidth),
          y = Math.round((p.y * canvas.height) / canvas.clientHeight);
        return Array.from(
          data.subarray((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 3),
        );
      };
    const hole = sample(first.data, { x: 4, y: 0, elevation: 60 }),
      solid = sample(first.data, { x: 20, y: 0, elevation: 60 });
    check(hole[0] > hole[1] + 70 && solid[1] > solid[0] + 45, "GLB MASK depth/color wrong", {
      hole,
      solid,
    });
    const mapped = structuredClone(doc);
    mapped.spatial.models.tree = model("tree-material");
    mapped.spatial.models["tree-copy"] = model("tree-material");
    handles = applyDataSceneAuthoringDocument(engine, mapped, options).entityHandles;
    engine.pauseDataScene();
    const emissive = await read();
    const emissionPixel = sample(emissive.data, { x: 20, y: 0, elevation: 60 });
    check(
      Math.max(...emissionPixel.map((v, i) => Math.abs(v - solid[i]))) > 20,
      "emissive material did not affect scene",
      { solid, emissionPixel },
    );
    const saved = JSON.parse(
        JSON.stringify(
          captureGameStateSnapshot(engine, {
            includeDataSceneState: true,
            includeDataSceneProgress: true,
            dataSceneAuthoringDocument: mapped,
          }),
        ),
      ),
      old = handles.actor;
    restoreGameStateSnapshot(engine, saved, { dataSceneAuthoringApplyOptions: options });
    handles = Object.fromEntries(registry.entries().map((e) => [e.instanceId, e.handle]));
    check(
      old.entityId !== handles.actor.entityId ||
        old.entityGeneration !== handles.actor.entityGeneration,
      "model restore retained handle",
    );
    const restored = await read();
    check(
      difference(emissive.data, restored.data) === 0 && restored.stats.modelUploadBytes === 0,
      "model restore pixels/resources changed",
    );
    // Reverse native rows, preserving each row's u32/f32 union. Depth must decide visibility.
    const reversed = {
        ...restored.packet,
        spatial: { ...restored.packet.spatial, models: { ...restored.packet.spatial.models } },
      },
      v = restored.packet.spatial.models.values,
      out = new Float32Array(v.length);
    for (let i = 0; i < v.length; i += 20) out.set(v.subarray(v.length - i - 20, v.length - i), i);
    reversed.spatial.models.values = out;
    reversed.spatial.models.words = new Uint32Array(out.buffer);
    check(
      difference(restored.data, (await read(reversed)).data) === 0,
      "model depth depends on row order",
    );
    let recovery;
    if(recover){
      const raw=await (await fetch('/rock.glb')).arrayBuffer(),nextAssets=[];
      for(let i=0;i<16;i++)nextAssets.push(await loadSpatialGlb(recoveryVariant(raw,i===1?0:i),{materialProfile:'diffuse'}));
      check(new Set(nextAssets.map(a=>a.contentId)).size===15&&nextAssets[0]!==nextAssets[1],'next-scene fixture did not preserve separate same-content handles');
      await renderer.preloadSpatialModels(nextAssets);
      const beforeResources = renderer.resourceStats(), beforeGpuSamples = profiler.snapshot().gpuFrameSampleCount, beforeTimingFrame = renderer.gpuTimingStats().currentFrameId;
      check(beforeResources.textureCount > 0 && beforeResources.bufferCount > 0, "WebGPU resource counters missing", beforeResources);
      const old=renderer.gpuDevice();old.destroy();await old.lost;await Promise.resolve();
      check(renderer.deviceState().status==='lost','model device loss not observed');
      check(renderer.resourceStats().textureCount === 0 && renderer.resourceStats().bufferCount === 0, "lost device retains allocation counters");
      check(renderer.gpuTimingStats().status === "context-lost", "lost timer published stale results");
      await renderer.recoverDevice();
      renderer.gpuDevice().addEventListener('uncapturederror',e=>errors.push(e.error.message));
      const recovered=await read(),diff=difference(recovered.data,restored.data,1);
      check(diff===0,'model/material/texture recovery changed pixels',diff);
      const lease=renderer.prepareSpatialModels(nextAssets);lease.dispose();
      check(difference((await read()).data,restored.data,1)===0,'next-scene preparation evicted the current recovered scene');
      const afterResources = renderer.resourceStats();
      check(afterResources.textureCount > 0 && afterResources.bufferCount > 0, "recovered resource counters missing");
      for (let i = 0; i < 4; i++) await read();
      const timing = renderer.gpuTimingStats(), measurement = profiler.snapshot();
      if (renderer.gpuDevice().features.has("timestamp-query"))
        check(measurement.gpuFrameSampleCount > beforeGpuSamples && timing.frameId > beforeTimingFrame, "recovered timestamp-capable device produced no new profiler samples", { timing, beforeGpuSamples, beforeTimingFrame, measurement });
      else check(timing.status === "unsupported" && measurement.gpuFrameSampleCount === 0, "unsupported timestamp fabricated samples");
      recovery={resources: afterResources, gpuTiming: {status: timing.status, sampleCount: measurement.gpuFrameSampleCount, maxMs: measurement.maxGpuFrameTimeMs}, generation:renderer.deviceState().generation,differentPixels:diff,models:recovered.stats.modelCount,preparedModels:nextAssets.length,preparedContentIds:15,sameHashHandlesRetained:true,currentAndPreparedRetained:true};
    }
    return {
      backend,
      projection,
      recovery,
      restored: true,
      reversed: true,
      preloadBytes,
      failedTextureReplacementPreserved,
      hole,
      solid,
      emissionPixel,
      stats: warm.stats,
      mappedStats: restored.stats,
      frames,
      errors,
      data: restored.data,
      image: png(restored.data, canvas.width, canvas.height),
    };
  } finally {
    const device = backend === "webgpu" ? renderer.gpuDevice() : undefined;
    engine?.destroy();
    renderer.destroy();
    window.disposeSpatialGpuTarget?.(canvas);
    device?.destroy();
  }
}
export async function probeSpatialWebGpuModels() {
  const result = [];
  for (const projection of ["orthographic", "perspective"]) {
    const pair = [];
    for (const backend of ["webgl2", "webgpu"]) {
      const canvas = document.createElement("canvas");
      document.body.replaceChildren(canvas);
      pair.push(await probe(canvas, backend, projection));
    }
    const diff = difference(pair[0].data, pair[1].data, 3),
      count = pair[0].data.length / 4;
    check(diff < count * 0.01, "model WebGL2/WebGPU pixel parity failed", {
      projection,
      diff,
      count,
    });
    result.push({
      projection,
      differentPixels: diff,
      pixelCount: count,
      backends: pair.map(({ data, ...entry }) => entry),
    });
  }
  return result;
}

export async function probeModelRecovery(){
 const canvas=document.createElement('canvas');document.body.replaceChildren(canvas);
 const {data,...result}=await probe(canvas,'webgpu','orthographic',true);return result;
}
