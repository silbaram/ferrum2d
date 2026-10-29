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
    await renderer.loadTexture(1, image.toDataURL());
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
          position: { x: 120, y: -160, elevation: 240 },
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
              stats.drawCalls < 32 &&
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
    ) => {
      console.log("environment state", backend, projection, name);
      const doc = structuredClone(base);
      if (environment) doc.spatial.environment = environment;
      doc.spatial.models.tree = { asset, contentId: assets.get(asset).contentId };
      if (normal) doc.spatial.billboards.actor.normalTextureId = 4;
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
      check(
        warm.stats.modelCount === 1 &&
          warm.stats.visibleModelCount === 1 &&
          warm.stats.modelDrawCalls === 2 &&
          warm.stats.modelTriangleCount === 14,
        "environment model pass missing",
        warm.stats,
      );
      check(
        warm.stats.effectDrawCalls === (environment ? 1 : 0),
        "missing or unexpected HDR composite",
        { name, stats: warm.stats },
      );
      lastPixels = warm.data;
      if (!neutralPixels) neutralPixels = warm.data;
      const result = {
        name,
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
    const neutral = await configure("neutral"),
      ambient = await configure("ambient", { lighting: { ambient: [0.1, 0.1, 0.1], lights: [] } });
    const hemisphere={skyColor:[0,0,1],groundColor:[1,0,0],intensity:.8},
      hemiUp=await configure("hemisphere-sky",{lighting:{ambient:[0,0,0],lights:[],hemisphere}}),
      hemiDown=await configure("hemisphere-ground",{lighting:{ambient:[0,0,0],lights:[],hemisphere:{...hemisphere,direction:{x:0,y:0,elevation:-1}}}});
    check(hemiUp.spatial.environment.version===3 && hemiUp.spatial.environment.values.length===128,"hemisphere did not use native v3");
    check(hemiUp.ground[2]>hemiUp.ground[0]+25 && hemiDown.ground[0]>hemiDown.ground[2]+25,"sky/ground hemisphere direction ignored",{up:hemiUp.ground,down:hemiDown.ground});
    check(hemiUp.stats.shadowPassCount===0 && hemiUp.stats.shadowDrawCalls===0,"hemisphere allocated shadow work",hemiUp.stats);
    const hemiDisabled=await configure("hemisphere-disabled",{lighting:{ambient:[0,0,0],lights:[],hemisphere:{...hemisphere,enabled:false}}});
    check(hemiDisabled.spatial.environment.values[112]===0 && hemiDisabled.ground.every(value=>value<3),"disabled hemisphere still lights surfaces",hemiDisabled.ground);
    const facingHemisphere={...hemisphere,direction:{x:120,y:-200,elevation:0}},
      hemiFacing=await configure("hemisphere-facing",{lighting:{ambient:[0,0,0],lights:[],hemisphere:facingHemisphere}}),
      hemiNormal=await configure("hemisphere-normal",{lighting:{ambient:[0,0,0],lights:[],hemisphere:facingHemisphere}},"mapped",true);
    check(Math.max(...hemiNormal.actor.map((value,i)=>Math.abs(value-hemiFacing.actor[i])))>10,"hemisphere ignored billboard shading normals",{flat:hemiFacing.actor,mapped:hemiNormal.actor});
    check(neutral.ground[0] > ambient.ground[0] + 40, "ambient lighting did not darken terrain", {
      neutral: neutral.ground,
      ambient: ambient.ground,
    });
    const point = await configure("point4", {
      lighting: {
        ambient: [0.1, 0.1, 0.1],
        lights: [
          { position: { x: -70, y: -30, elevation: 80 }, radius: 240 },
          { position: { x: 40, y: 20, elevation: 70 }, radius: 220, color: [0.2, 0.5, 1] },
          { position: { x: 0, y: 60, elevation: 40 }, radius: 180, color: [1, 0.2, 0.1] },
          { position: { x: -100, y: 80, elevation: 80 }, radius: 140, color: [0.1, 1, 0.1] },
        ],
      },
    });
    check(
      point.stats.lightCount === 4 && point.ground[0] > ambient.ground[0] + 40,
      "point light height/falloff failed",
      point,
    );
    const sunEnvironment = {
      lighting: {
        ambient: [0.05, 0.05, 0.05],
        lights: [],
        directional: { direction: { x: -1, y: -1, elevation: 1 }, intensity: 1 },
      },
    };
    const sun = await configure("sun", sunEnvironment),
      normal = await configure("billboard-normal", sunEnvironment, "scale0", true),
      mapped = await configure("model-normal", sunEnvironment, "mapped");
    check(
      sun.stats.directionalLightCount === 1 && sun.ground[0] > ambient.ground[0] + 20,
      "directional terrain light failed",
      { sun: sun.ground, ambient: ambient.ground },
    );
    check(
      sun.actor[0] > normal.actor[0] + 30,
      "non-color billboard normal did not change light response",
      { sun: sun.actor, normal: normal.actor },
    );
    check(
      Math.max(...sun.leaf.map((v, i) => Math.abs(v - mapped.leaf[i]))) > 10,
      "model tangent/normal scale did not change light response",
      { sun: sun.leaf, mapped: mapped.leaf },
    );
    const unlitDark = await configure(
        "unlit-dark",
        { lighting: { ambient: [0, 0, 0], lights: [] } },
        "unlit",
      ),
      unlitSun = await configure("unlit-sun", sunEnvironment, "unlit");
    const unlitHemi=await configure("unlit-hemisphere",{lighting:{ambient:[0,0,0],lights:[],hemisphere}},"unlit");
    check(unlitHemi.leaf.every((value,i)=>value===unlitDark.leaf[i]),"unlit model changed under hemisphere",{unlit:unlitDark.leaf,hemi:unlitHemi.leaf});
    for(const kind of ["point","sun"]) for(const shadowFilter of ["hard","pcf3"]) {
      const lighting=kind==="point"?{ambient:[.05,.05,.05],lights:[{position:{x:-80,y:20,elevation:120},radius:400,intensity:2}],shadows:{lightIndex:0,resolution:128,bias:.02}}:
        {...sunEnvironment.lighting,directional:{...sunEnvironment.lighting.directional,shadows:{resolution:128,distance:1000,extent:300,bias:.02}}};
      lighting.shadowFilter=shadowFilter;
      const name=kind+(shadowFilter==="pcf3"?"-pcf":"");
      await configure(name+"-offset-zero",{lighting});const before=lastPixels.slice();
      const biased=structuredClone(lighting);
      (kind==="point"?biased.shadows:biased.directional.shadows).normalBias=2;
      check(engine.setDataSceneSpatialEnvironment({lighting:biased}),"normal offset rejected");
      const shifted=await read();
      check(shifted.stats.shadowCacheHit && shifted.stats.shadowPassCount===0 && shifted.stats.shadowUploadBytes===0,"receiver bias regenerated shadow depth",shifted.stats);
      check(difference(before,shifted.data,3)>5,"normal offset did not move shadow lookup",{kind,shadowFilter,diff:difference(before,shifted.data,3)});
      await configure(name+"-offset",{lighting:biased});
    }
    check(
      unlitDark.leaf.every((v, i) => v === unlitSun.leaf[i]),
      "KHR_materials_unlit depends on illumination",
      { dark: unlitDark.leaf, sun: unlitSun.leaf },
    );
    const fog = await configure("fog", { fog: { color: [0.2, 0.3, 1], start: 0, end: 1 } });
    check(fog.ground[2] > fog.ground[0] + 100, "camera-depth fog failed", fog.ground);
    const grade = await configure("grade", {
      colorGrading: {
        exposure: 1,
        contrast: 1.2,
        saturation: 0.25,
        tint: [0.8, 1, 0.7],
        toneMapping: "aces",
      },
    });
    check(grade.differentNeutralPixels > 100, "HDR grading did not change frame");
    const dof = await configure("dof-standard", {
        depthOfField: { focusDistance: 1, focusRange: 0, aperture: 32, maxBlurRadius: 12 },
      }),
      high = await configure("dof-high", {
        depthOfField: {
          focusDistance: 1,
          focusRange: 0,
          aperture: 32,
          maxBlurRadius: 12,
          quality: "high",
        },
      });
    check(
      dof.stats.dofSampleBudget === 13 &&
        high.stats.dofSampleBudget === 25 &&
        dof.differentNeutralPixels > 10 &&
        high.differentNeutralPixels > 10,
      "depth DOF path missing",
      { dof: dof.stats, high: high.stats },
    );
    const focus = await configure("actor-focus", {
      depthOfField: {
        focusDistance: 1,
        focusRange: 2,
        aperture: 32,
        maxBlurRadius: 12,
        focusTarget: "actor",
      },
    });
    check(focus.spatial.environment.values[99] > 0, "native actor focus not available");
    const pixel = await configure("pixel-art", {
      pixelArt: { width: 160, height: 90, snapCamera: true },
      ...sunEnvironment,
    });
    check(
      pixel.spatial.presentation[4] === 160 && pixel.stats.effectTextureBytes === 160 * 90 * 12,
      "pixelArt internal target budget failed",
      pixel.stats,
    );
    const debug = await configure(
      "debug",
      { ...sunEnvironment, colorGrading: { toneMapping: "reinhard" } },
      "mapped",
      false,
      true,
    );
    check(
      debug.stats.debugLineCount > 0 &&
        debug.stats.debugDrawCalls === 1 &&
        debug.stats.debugUploadBytes > 0 &&
        !debug.stats.debugTruncated,
      "spatial debug not rendered",
      debug.stats,
    );
    const brightPoint={position:{x:0,y:0,elevation:120},radius:400,intensity:8,color:[1,.7,.3]};
    const advanced=await configure("advanced-point",{lighting:{ambient:[.02,.02,.02],lights:[brightPoint],maxActiveLights:4}});
    const brightPixels=lastPixels.slice();
    check(advanced.spatial.environment.version===4 && advanced.spatial.environment.values.length===512,"missing v4 environment");
    await configure("bloom-zero",{lighting:{ambient:[.02,.02,.02],lights:[brightPoint],maxActiveLights:4},bloom:{strength:0,radius:12,threshold:.5}});
    check(difference(brightPixels,lastPixels)===0,"zero-strength Bloom must preserve scene and background pixels");
    const spotDown=await configure("spot-down",{lighting:{ambient:[0,0,0],lights:[{...brightPoint,spot:{direction:{x:0,y:0,elevation:-1},angle:60,penumbra:.2}}]}});
    const downPixels=lastPixels.slice();
    const spotUp=await configure("spot-up",{lighting:{ambient:[0,0,0],lights:[{...brightPoint,spot:{direction:{x:0,y:0,elevation:1},angle:60,penumbra:.2}}]}});
    check(spotDown.ground[0]>spotUp.ground[0]+20 && difference(downPixels,lastPixels,3)>30,"spot cone direction ignored");
    await configure("bloom",{lighting:{ambient:[.02,.02,.02],lights:[brightPoint],maxActiveLights:4},bloom:{strength:1,radius:12,threshold:.5}});
    check(difference(brightPixels,lastPixels,3)>30,"scene bloom did not change HDR pixels");
    await configure("ao-baseline",{lighting:{ambient:[.5,.5,.5],lights:[]}});const noAo=lastPixels.slice();
    await configure("ao",{lighting:{ambient:[.5,.5,.5],lights:[]},ambientOcclusion:{strength:1,radius:40,bias:.1}});
    check(difference(noAo,lastPixels,3)>20,"contact occlusion did not change contact pixels");
    const many=await configure("budget-many",{lighting:{ambient:[.05,.05,.05],maxActiveLights:2,lights:Array.from({length:16},(_,i)=>({...brightPoint,position:{x:i*10-80,y:0,elevation:80},intensity:i/4}))}});
    check(many.spatial.environment.values[1]===2 && many.spatial.environment.values[137]===16,"native light budget ignored");
    const combined = await configure(
      "combined",
      {
        ...sunEnvironment,
        lighting:{...sunEnvironment.lighting,lights:[{...brightPoint,position:{x:0,y:0,elevation:80},followActor:true,spot:{direction:{x:0,y:0,elevation:-1},angle:70,penumbra:.3}}],maxActiveLights:2,hemisphere:{skyColor:[.5,.65,1],groundColor:[.2,.15,.1],intensity:.2}},
        bloom:{strength:.4,radius:8,threshold:1},ambientOcclusion:{strength:.4,radius:16,bias:.3},
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
    return { backend, projection, restored: true, frames, errors, rows };
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
export async function probeSpatialWebGpuEnvironment() {
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
