import { createPixelMaskTerrain } from "@ferrum2d/ferrum-web/labs";
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

function variant(bytes, edit) {
  const size = new DataView(bytes).getUint32(12, true),
    doc = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, size)));
  edit(doc.materials[1], doc);
  const text = new TextEncoder().encode(JSON.stringify(doc)),
    padded = (text.length + 3) & ~3,
    bin = new Uint8Array(bytes, 28 + size),
    out = new ArrayBuffer(28 + padded + bin.length),
    v = new DataView(out);
  [0x46546c67, 2, out.byteLength, padded, 0x4e4f534a].forEach((n, i) =>
    v.setUint32(i * 4, n, true),
  );
  new Uint8Array(out, 20, padded).fill(32);
  new Uint8Array(out, 20, text.length).set(text);
  v.setUint32(20 + padded, bin.length, true);
  v.setUint32(24 + padded, 0x004e4942, true);
  new Uint8Array(out, 28 + padded).set(bin);
  return out;
}
function ownedSpatial(s) {
  const m = s.models,
    values = m?.values.slice();
  return {
    ...s,
    camera: s.camera.slice(),
    presentation: s.presentation?.slice(),
    terrain: s.terrain.slice(),
    terrainDrawRanges: s.terrainDrawRanges?.slice(),
    billboards: s.billboards.slice(),
    materials: s.materials && {
      ...s.materials,
      terrain: s.materials.terrain.slice(),
      billboards: s.materials.billboards.slice(),
    },
    models: m && { ...m, values, words: new Uint32Array(values.buffer) },
    debug: s.debug && { ...s.debug, vertices: s.debug.vertices.slice() },
    environment: s.environment && {
      ...s.environment,
      values: s.environment.values.slice(),
      shadowMatrices: s.environment.shadowMatrices.slice(),
      shadowCasters: s.environment.shadowCasters.slice(),
      shadowSubmission: s.environment.shadowSubmission && {
        ...s.environment.shadowSubmission,
        ranges: s.environment.shadowSubmission.ranges.slice(),
      },
    },
  };
}
async function probe(canvas, backend, projection) {
  if (backend === "webgpu") canvas.dataset.spatialGpuTarget = "true";
  const fallback = [],
    renderer = await createRenderer(canvas, {
      preferred: backend,
      fallbackBehavior: "silent",
      onFallback: (i) => fallback.push(String(i.reason)),
      webgl2: { preserveDrawingBuffer: true },
    });
  check(
    (typeof renderer.gpuDevice === "function") === (backend === "webgpu"),
    "environment renderer was replaced by fallback",
    fallback,
  );
  const errors = [],
    registry = createSceneInstanceHandleRegistry(),
    apply = { instanceHandleRegistry: registry, spatialModelPreparer: renderer };
  if (backend === "webgpu")
    renderer.gpuDevice().addEventListener("uncapturederror", (e) => errors.push(e.error.message));
  const allocationCounts = { textures: 0, buffers: 0, groups: 0 };
  if (backend === "webgpu") {
    const device = renderer.gpuDevice();
    for (const [method, key] of [
      ["createTexture", "textures"],
      ["createBuffer", "buffers"],
      ["createBindGroup", "groups"],
    ]) {
      const original = device[method].bind(device);
      device[method] = (...args) => {
        allocationCounts[key]++;
        return original(...args);
      };
    }
  }
  let engine,
    handles,
    request,
    lastSpatial,
    frames = 0;
  const read = () =>
    new Promise((resolve, reject) => {
      check(!request, "overlapping environment read");
      const timeout = setTimeout(
        () =>
          reject(
            Error(
              `environment read timed out: ${backend}/${projection}, errors=${JSON.stringify(errors)}`,
            ),
          ),
        15000,
      );
      request = {
        resolve: (v) => {
          clearTimeout(timeout);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timeout);
          reject(e);
        },
      };
      engine.start();
    });
  try {
    const source = await (await fetch("/tree-material.glb")).arrayBuffer(),
      assets = new Map();
    for (const [id, bytes] of [
      ["mapped", variant(source, (m) => (m.emissiveFactor = [0, 0, 0]))],
      [
        "scale0",
        variant(source, (m) => {
          m.normalTexture.scale = 0;
          m.emissiveFactor = [0, 0, 0];
        }),
      ],
      [
        "unlit",
        variant(source, (m) => {
          m.extensions = { KHR_materials_unlit: {} };
        }),
      ],
    ])
      assets.set(id, await loadSpatialGlb(bytes, { materialProfile: "diffuse" }));
    if (backend === "webgpu") await renderer.preloadSpatialModels([...assets.values()]);
    const image = document.createElement("canvas");
    image.width = image.height = 32;
    const c = image.getContext("2d");
    c.fillStyle = "#ff4040";
    c.fillRect(0, 0, 32, 32);
    renderer.createPixelMaskTerrainTexture(
      1,
      createPixelMaskTerrain({ width: 32, height: 32, data: new Uint8Array(32 * 32).fill(255) }),
      { color: [255, 64, 64] },
    );
    const data = c.createImageData(32, 32);
    for (let i = 0; i < data.data.length; i += 4) data.data.set([128, 128, 0, 255], i);
    c.putImageData(data, 0, 0);
    await renderer.loadTexture(4, image.toDataURL(), { colorSpace: "none" });
    c.fillStyle = "#fff";
    c.fillRect(0, 0, 32, 32);
    await renderer.loadTexture(5, image.toDataURL());
    const base = {
      format: "ferrum2d.consumer.scene-authoring",
      version: 1,
      gameplay: { primaryActor: "actor" },
      sceneComposition: {
        initialFragment: "lab",
        prefabs: { object: {} },
        fragments: {
          lab: {
            instances: [
              {
                id: "actor",
                prefab: "object",
                x: -45,
                y: 22,
                props: {
                  components: {
                    visual: { kind: "sprite", texture: 1, width: 20, height: 32, originY: 1 },
                    collider: {
                      type: "aabb",
                      halfWidth: 2,
                      halfHeight: 2,
                      enabled: true,
                      isTrigger: false,
                    },
                    layer: "player",
                    body: {
                      type: "kinematic",
                      heightSpan: { floorId: 0, elevation: 0, height: 8 },
                    },
                  },
                },
              },
              {
                id: "tree",
                prefab: "object",
                x: 45,
                y: 40,
                props: {
                  components: {
                    visual: { kind: "sprite", texture: 0, width: 1, height: 1, color: "#ffffff00" },
                    collider: "none",
                    layer: "wall",
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
          projection,
          position:
            projection === "perspective"
              ? { x: 120, y: -160, elevation: 600 }
              : { x: 120, y: -160, elevation: 240 },
          target: { x: 0, y: 40, elevation: 24 },
          height: Math.max(240, (240 * canvas.clientHeight) / canvas.clientWidth),
          fovDegrees: 70,
          near: 0.1,
          far: 2000,
        },
        terrain: [
          {
            id: "ground",
            x: -128,
            y: -64,
            width: 256,
            depth: 256,
            elevation: 0,
            color: [0.5, 0.5, 0.5, 1],
          },
        ],
        billboards: { actor: {} },
        actor: { instanceId: "actor", speed: 96 },
        models: { tree: { asset: "scale0", contentId: assets.get("scale0").contentId } },
      },
    };
    engine = await createEngine(
      (state) => {
        if (!handles) return;
        const pending = request;
        request = undefined;
        try {
          const before = { ...allocationCounts },
            packet = state.renderCommandBuffer;
          // HUD uses the existing public flat render-command ABI after spatial composite.
          const hud = {
            ...packet,
            commandCount: 1,
            floatsPerCommand: 15,
            buffer: new Float32Array([8, 8, 24, 16, 0, 0, 1, 1, 1, 0, 1, 1, 5, 0, 0]),
          };
          renderer.render();
          const stats = renderer.renderCommands(hud);
          renderer.renderPostProcess();
          check(
            ++frames < 400 &&
              state.rustUpdateTimeMs < 250 &&
              stats.drawCalls < 64 &&
              !errors.length,
            "environment work/error budget",
            { stats, errors },
          );
          lastSpatial = ownedSpatial(packet.spatial);
          const gpuAllocations = Object.fromEntries(
            Object.entries(allocationCounts).map(([key, value]) => [key, value - before[key]]),
          );
          if (pending) {
            engine.stop();
            pixels(renderer, canvas).then(
              (data) =>
                pending.resolve({
                  data,
                  stats: stats.spatial,
                  spatial: lastSpatial,
                  gpuAllocations,
                }),
              pending.reject,
            );
          }
        } catch (error) {
          errors.push(String(error));
          engine.stop();
          pending?.reject(error);
        }
      },
      undefined,
      undefined,
      () => renderer.viewportSize(),
    );
    for (const [id, asset] of assets)
      check(
        engine.registerDataSceneSpatialModel(id, asset),
        "environment model registration failed",
        id,
      );
    renderer.resize();
    const size = renderer.viewportSize();
    engine.setViewportSize(size.width, size.height);
    const view = createDataSceneSpatialView(engine, canvas),
      rows = [];
    let neutralPixels, lastPixels;
    const sample = (row, p) => {
      const point = view.project(p, row.spatial);
      check(point?.visible, "environment sample outside view", { p, point });
      const x = Math.round((point.x * canvas.width) / canvas.clientWidth),
        y = Math.round((point.y * canvas.height) / canvas.clientHeight);
      return Array.from(
        row.data.subarray((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 3),
      );
    };
    const ground = { x: -70, y: -30, elevation: 0 },
      actor = { x: -45, y: 22, elevation: 16 },
      leaf = { x: 65, y: 40, elevation: 60 };
    const configure = async (
      name,
      environment,
      asset = "scale0",
      normal = false,
      debug = false,
      edit = () => {},
    ) => {
      console.log("shadow state", backend, projection, name);
      const doc = structuredClone(base);
      if (environment) doc.spatial.environment = environment;
      doc.spatial.models.tree = { asset, contentId: assets.get(asset).contentId };
      if (normal) doc.spatial.billboards.actor.normalTextureId = 4;
      edit(doc);
      handles = applyDataSceneAuthoringDocument(engine, doc, apply).entityHandles;
      engine.pauseDataScene();
      check(
        engine.setDataSceneSpatialDebug(
          debug ? { terrain: true, billboards: true, depthTest: false } : null,
        ),
        "spatial debug configuration rejected",
      );
      const first = await read(),
        warm = await read();
      check(
        warm.stats.terrainUploadBytes === 0 && warm.stats.modelUploadBytes === 0,
        "warm environment resource reupload",
        warm.stats,
      );
      check(
        Object.values(warm.gpuAllocations).every((n) => n === 0),
        "warm environment allocated GPU resources",
        warm.gpuAllocations,
      );
      const hud = Array.from(
        warm.data.subarray(
          (Math.floor((12 * canvas.height) / canvas.clientHeight) * canvas.width +
            Math.floor((12 * canvas.width) / canvas.clientWidth)) *
            4,
          (Math.floor((12 * canvas.height) / canvas.clientHeight) * canvas.width +
            Math.floor((12 * canvas.width) / canvas.clientWidth)) *
            4 +
            3,
        ),
      );
      check(hud[0] === 255 && hud[1] === 0 && hud[2] === 255, "spatial effect changed HUD", {
        name,
        hud,
      });
      const visible = warm.spatial.models.words[2] & 1 ? 1 : 0;
      check(
        warm.stats.modelCount === 1 &&
          warm.stats.visibleModelCount === visible &&
          warm.stats.modelDrawCalls === visible * 2 &&
          warm.stats.modelTriangleCount === visible * 14,
        "environment model pass missing",
        warm.stats,
      );
      check(
        warm.stats.effectDrawCalls === (environment ? 1 : 0),
        "missing or unexpected HDR composite",
        { name, stats: warm.stats },
      );
      const expectedPasses =
        (warm.spatial.environment?.values[2] >= 0 ? 6 : 0) +
        (warm.spatial.environment?.values[92] > 0 ? 1 : 0);
      if (expectedPasses)
        check(
          first.stats.shadowPassCount === expectedPasses &&
            !first.stats.shadowCacheHit &&
            warm.stats.shadowCacheHit &&
            warm.stats.shadowPassCount === 0 &&
            warm.stats.shadowDrawCalls === 0 &&
            warm.stats.shadowUploadBytes === 0,
          "shadow cold/warm/cache path wrong",
          { name, first: first.stats, warm: warm.stats },
        );
      lastPixels = warm.data;
      if (!neutralPixels) neutralPixels = warm.data;
      const result = {
        name,
        firstStats: first.stats,
        stats: warm.stats,
        gpuAllocations: warm.gpuAllocations,
        spatial: warm.spatial,
        ground: sample(warm, ground),
        actor: sample(warm, actor),
        leaf: sample(warm, leaf),
        hud,
        doc,
        differentNeutralPixels: difference(neutralPixels, warm.data, 3),
        image: png(warm.data, canvas.width, canvas.height),
      };
      const { spatial, doc: document, ...evidence } = result;
      rows.push(evidence);
      return result;
    };
    const lighting = {
      ambient: [0.08, 0.08, 0.08],
      lights: [{ position: { x: 30, y: -80, elevation: 160 }, radius: 400, intensity: 2 }],
    };
    const pointEnv = {
      lighting: { ...lighting, shadows: { lightIndex: 0, resolution: 256, bias: 1 } },
    };
    const neutral = await configure("point-neutral", { lighting });
    const neutralImage = lastPixels;
    const point = await configure("point-hard", pointEnv),
      pointImage = lastPixels;
    check(difference(neutralImage, pointImage, 3) > 100, "point shadows did not change frame");
    const hole = sample(
        { data: pointImage, spatial: point.spatial },
        { x: 60.4, y: 112, elevation: 0 },
      ),
      solid = sample({ data: pointImage, spatial: point.spatial }, { x: 86, y: 112, elevation: 0 });
    check(hole[0] > solid[0] + 30, "model MASK did not transmit light through shadow hole", {
      hole,
      solid,
    });
    // The source atlas changes without touching any native scene revision.
    renderer.updatePixelMaskTerrainTexture(
      1,
      { rect: { x: 0, y: 0, width: 32, height: 32 }, alpha: new Uint8Array(32 * 32) },
      { color: [255, 64, 64] },
    );
    const alphaUpdate = await read();
    check(
      !alphaUpdate.stats.shadowCacheHit && alphaUpdate.stats.shadowPassCount === 6,
      "alpha texture patch did not invalidate shadow cache",
      alphaUpdate.stats,
    );
    await renderer.loadTexture(
      1,
      (() => {
        c.fillStyle = "#ff4040";
        c.fillRect(0, 0, 32, 32);
        return image.toDataURL();
      })(),
    );
    const atlasReplace = await read(),
      atlasWarm = await read();
    check(
      atlasReplace.stats.shadowPassCount === 6 && atlasWarm.stats.shadowCacheHit,
      "atlas replacement did not invalidate/reuse cache",
      { first: atlasReplace.stats, warm: atlasWarm.stats },
    );
    c.putImageData(data, 0, 0);
    await renderer.loadTexture(4, image.toDataURL(), { colorSpace: "none" });
    const normalOnly = await read();
    check(
      backend !== "webgpu" || normalOnly.stats.shadowCacheHit,
      "normal-only atlas invalidated WebGPU depth cache",
    );
    check(
      engine.setDataSceneSpatialCamera(
        { ...base.spatial.camera, position: { ...base.spatial.camera.position, x: 125 } },
        renderer.viewportSize(),
      ),
      "camera change failed",
    );
    const cameraOnly = await read(),
      casterChanged =
        cameraOnly.spatial.environment.shadowSubmission.revision !==
        normalOnly.spatial.environment.shadowSubmission.revision;
    check(
      casterChanged
        ? cameraOnly.stats.shadowPassCount === 6 && !cameraOnly.stats.shadowCacheHit
        : cameraOnly.stats.shadowCacheHit,
      "camera movement ignored native caster revision",
      { casterChanged, stats: cameraOnly.stats },
    );
    check((await read()).stats.shadowCacheHit, "camera change did not settle to warm cache");
    const noCast = await configure(
      "model-no-cast",
      pointEnv,
      "scale0",
      false,
      false,
      (d) => (d.spatial.models.tree.castShadow = false),
    );
    check(
      difference(pointImage, lastPixels, 3) > 100,
      "model cast flag did not change shadow coverage",
    );
    const noReceive = await configure(
      "terrain-no-receive",
      pointEnv,
      "scale0",
      false,
      false,
      (d) => (d.spatial.terrain[0].receiveShadow = false),
    );
    check(
      difference(neutralImage, lastPixels, 3) < canvas.width * canvas.height * 0.001,
      "terrain receive flag did not restore unshadowed light",
    );
    const pcfChanges = { point: 0, sun: 0, both: 0 };
    await configure("point-pcf", { lighting: { ...pointEnv.lighting, shadowFilter: "pcf3" } });
    pcfChanges.point = difference(pointImage, lastPixels, 3);
    check(pcfChanges.point > 100, "point PCF produced hard-shadow pixels", pcfChanges);
    const sunLighting = {
      ambient: [0.08, 0.08, 0.08],
      lights: [],
      directional: { direction: { x: -1, y: -1, elevation: 2 }, intensity: 1 },
    };
    const sunEnv = {
      lighting: {
        ...sunLighting,
        directional: {
          ...sunLighting.directional,
          shadows: { resolution: 256, distance: 400, extent: 240, bias: 1 },
        },
      },
    };
    const sunNeutral = await configure("sun-neutral", { lighting: sunLighting }),
      sunNeutralImage = lastPixels;
    await configure("sun-hard", sunEnv);
    const sunHardImage = lastPixels;
    check(difference(sunNeutralImage, lastPixels, 3) > 100, "sun shadow did not change frame");
    await configure("sun-pcf", { lighting: { ...sunEnv.lighting, shadowFilter: "pcf3" } });
    pcfChanges.sun = difference(sunHardImage, lastPixels, 3);
    check(pcfChanges.sun > 100, "sun PCF produced hard-shadow pixels", pcfChanges);
    const both = { lighting: { ...pointEnv.lighting, directional: sunEnv.lighting.directional } };
    await configure("both-hard", both);
    const bothHardImage = lastPixels;
    await configure("both-pcf", { lighting: { ...both.lighting, shadowFilter: "pcf3" } });
    pcfChanges.both = difference(bothHardImage, lastPixels, 3);
    check(pcfChanges.both > 100, "combined PCF produced hard-shadow pixels", pcfChanges);
    const wallDoc = (d) =>
      d.spatial.terrain.push(
        ...[
          ["wall", 0, 120],
          ["wall-actor", -80, 42],
        ].map(([id, y, depth]) => ({
          id,
          floorId: 1,
          x: 100,
          y,
          width: 8,
          depth,
          elevation: 180,
          baseElevation: 0,
          walkable: false,
          color: [0.4, 0.4, 0.4, 1],
        })),
      );
    const wallEnv = {
      lighting: {
        ...pointEnv.lighting,
        lights: [{ position: { x: 200, y: -80, elevation: 160 }, radius: 400, intensity: 2 }],
      },
    };
    const wall = await configure("wall-receive", wallEnv, "scale0", false, false, wallDoc);
    const modelReceive = await configure(
      "wall-no-model-receive",
      wallEnv,
      "scale0",
      false,
      false,
      (d) => {
        wallDoc(d);
        d.spatial.models.tree.receiveShadow = false;
      },
    );
    check(
      modelReceive.leaf[1] > wall.leaf[1] + 20,
      "model receiver flag did not bypass wall shadow",
      { wall: wall.leaf, disabled: modelReceive.leaf },
    );
    const billboardReceive = await configure(
      "wall-no-billboard-receive",
      wallEnv,
      "scale0",
      false,
      false,
      (d) => {
        wallDoc(d);
        d.spatial.billboards.actor.receiveShadow = false;
      },
    );
    check(
      billboardReceive.actor[0] > wall.actor[0] + 20,
      "billboard receiver flag did not bypass wall shadow",
      { wall: wall.actor, disabled: billboardReceive.actor },
    );
    const bridgeDoc = (d) =>
      d.spatial.terrain.push({
        id: "bridge",
        floorId: 1,
        kind: "bridge",
        x: -30,
        y: -10,
        width: 80,
        depth: 80,
        elevation: 72,
        baseElevation: 64,
        walkable: false,
        color: [0.5, 0.5, 0.5, 1],
      });
    const belowEnv = {
      lighting: {
        ...pointEnv.lighting,
        lights: [{ position: { x: 0, y: 20, elevation: 20 }, radius: 200, intensity: 2 }],
      },
    };
    const bridge = await configure(
      "bridge-below-light",
      belowEnv,
      "scale0",
      false,
      false,
      bridgeDoc,
    );
    const top = sample(
        { data: lastPixels, spatial: bridge.spatial },
        { x: 0, y: 20, elevation: 72 },
      ),
      coveredLeaf = sample(
        { data: lastPixels, spatial: bridge.spatial },
        { x: 65, y: 40, elevation: 84 },
      );
    check(
      top[0] >= 30 && top[0] <= 40 && bridge.ground[0] > top[0] + 20,
      "light under bridge illuminated its top or failed to light exposed ground",
      { top, ground: bridge.ground },
    );
    const bridgeNoCast = await configure(
      "bridge-no-cast",
      belowEnv,
      "scale0",
      false,
      false,
      (d) => {
        bridgeDoc(d);
        d.spatial.terrain[1].castShadow = false;
      },
    );
    const uncoveredLeaf = sample(
      { data: lastPixels, spatial: bridgeNoCast.spatial },
      { x: 65, y: 40, elevation: 84 },
    );
    check(
      uncoveredLeaf[1] > coveredLeaf[1] + 20,
      "bridge did not block lower light to the model above its edge",
      { coveredLeaf, uncoveredLeaf },
    );
    const distantEnv = {
      lighting: {
        ambient: [0.02, 0.02, 0.02],
        lights: [{ position: { x: 1500, y: 30, elevation: 80 }, radius: 2000, intensity: 32 }],
        shadows: { lightIndex: 0, resolution: 1024, bias: 1 },
      },
    };
    const distantDoc = (d) => {
      d.sceneComposition.fragments.lab.instances.find((i) => i.id === "tree").x = 1000;
      d.spatial.billboards.actor.castShadow = false;
    };
    const distant = await configure(
        "offscreen-caster",
        distantEnv,
        "scale0",
        false,
        false,
        distantDoc,
      ),
      distantPixels = lastPixels;
    check(
      !(distant.spatial.models.words[2] & 1) && (distant.spatial.models.words[2] & 254) > 0,
      "model was not camera culled with native shadow faces retained",
      Array.from(distant.spatial.models.words.subarray(0, 4)),
    );
    await configure("offscreen-no-cast", distantEnv, "scale0", false, false, (d) => {
      distantDoc(d);
      d.spatial.models.tree.castShadow = false;
    });
    check(
      difference(distantPixels, lastPixels, 3) > 100,
      "camera-culled model did not cast onto visible ground",
    );
    const debug = await configure("debug-shadows", both, "scale0", false, true);
    check(
      debug.stats.debugDrawCalls === 1 && debug.stats.debugLineCount > 0,
      "shadow frame lost debug geometry",
      debug.stats,
    );
    const combined = await configure(
      "combined",
      {
        ...both,
        depthOfField: {
          focusDistance: 1,
          focusRange: 8,
          aperture: 5,
          maxBlurRadius: 6,
          focusTarget: "actor",
          quality: "high",
        },
        colorGrading: { exposure: 0.25, toneMapping: "aces" },
        fog: { color: [0.2, 0.25, 0.35], start: 250, end: 1200 },
      },
      "mapped",
      true,
    );
    const combinedPixels = lastPixels;
    const saved = JSON.parse(
        JSON.stringify(
          captureGameStateSnapshot(engine, {
            includeDataSceneState: true,
            includeDataSceneProgress: true,
            dataSceneAuthoringDocument: combined.doc,
          }),
        ),
      ),
      old = handles.actor;
    restoreGameStateSnapshot(engine, saved, { dataSceneAuthoringApplyOptions: apply });
    handles = Object.fromEntries(registry.entries().map((e) => [e.instanceId, e.handle]));
    check(
      old.entityId !== handles.actor.entityId ||
        old.entityGeneration !== handles.actor.entityGeneration,
      "environment restore kept stale handles",
    );
    const restored = await read();
    check(
      difference(combinedPixels, restored.data) === 0 && restored.stats.modelUploadBytes === 0,
      "environment fresh restore changed frame",
    );
    check(!errors.length, "GPU environment errors", errors);
    return {
      backend,
      projection,
      restored: true,
      frames,
      errors,
      rows,
      pcfChanges,
      alphaUpdate: alphaUpdate.stats,
      atlasReplace: atlasReplace.stats,
      normalOnly: normalOnly.stats,
      cameraOnly: cameraOnly.stats,
      cameraCasterRevisionChanged: casterChanged,
      hole,
      solid,
      bridgeTop: top,
      coveredLeaf,
      uncoveredLeaf,
    };
  } finally {
    const device = backend === "webgpu" ? renderer.gpuDevice() : undefined;
    engine?.destroy();
    renderer.destroy();
    window.disposeSpatialGpuTarget?.(canvas);
    device?.destroy();
  }
}
async function decodePng(url) {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob(), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
      ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  } finally {
    bitmap.close();
  }
}
export async function probeSpatialWebGpuShadows() {
  const result = [];
  for (const projection of ["orthographic", "perspective"]) {
    const pair = [];
    for (const backend of ["webgl2", "webgpu"]) {
      const canvas = document.createElement("canvas");
      document.body.replaceChildren(canvas);
      pair.push(await probe(canvas, backend, projection));
    }
    const comparisons = [];
    for (let i = 0; i < pair[0].rows.length; i++) {
      const a = pair[0].rows[i],
        b = pair[1].rows[i],
        ap = await decodePng(a.image),
        bp = await decodePng(b.image),
        diff = difference(ap, bp, 3),
        count = ap.length / 4;
      const allowedFraction = a.name.startsWith("dof-") ? 0.001 : 0.01;
      check(
        a.name === b.name && diff < count * allowedFraction,
        "spatial environment WebGL2/WebGPU pixel parity failed",
        {
          projection,
          name: a.name,
          diff,
          count,
          ground: [a.ground, b.ground],
          actor: [a.actor, b.actor],
          leaf: [a.leaf, b.leaf],
        },
      );
      comparisons.push({ name: a.name, differentPixels: diff, pixelCount: count, allowedFraction });
    }
    result.push({ projection, comparisons, backends: pair });
  }
  return result;
}
