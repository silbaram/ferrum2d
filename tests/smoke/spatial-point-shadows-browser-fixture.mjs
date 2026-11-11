import { createEngine, createRenderer, loadSpatialGlb, captureGameStateSnapshot, restoreGameStateSnapshot, GAME_STATE_CODE } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument, createSceneInstanceHandleRegistry } from "@ferrum2d/ferrum-web/authoring";
import { check, pixels, difference, png } from "/fixture.mjs";
import { ownedSpatial } from "/environment.mjs";

function channelOracle(actual, reference, channel, tolerance = 1) {
  check(actual.length === reference.length, "point shadow reference dimensions");
  let different = 0, max = 0;
  for (let i = channel; i < actual.length; i += 4) {
    const delta = Math.abs(actual[i] - reference[i]); max = Math.max(max, delta);
    different += Number(delta > tolerance);
  }
  return { different, max };
}
function shadowCoverage(plain, shadow, channel) {
  let pixels = 0;
  for (let i = channel; i < plain.length; i += 4) pixels += Number(plain[i] - shadow[i] > 8);
  return pixels;
}
function greenEmissiveModel(bytes) {
  const oldSize = new DataView(bytes).getUint32(12, true);
  const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, oldSize)));
  check(doc.materials?.length > 0, "point shadow model materials missing");
  for (const material of doc.materials) material.emissiveFactor = [0, 1, 0];
  const text = new TextEncoder().encode(JSON.stringify(doc)), padded = (text.length + 3) & ~3;
  const tail = new Uint8Array(bytes, 20 + oldSize), result = new ArrayBuffer(20 + padded + tail.length), view = new DataView(result);
  [0x46546c67, 2, result.byteLength, padded, 0x4e4f534a].forEach((n, i) => view.setUint32(i * 4, n, true));
  new Uint8Array(result, 20, padded).fill(32); new Uint8Array(result, 20, text.length).set(text);
  new Uint8Array(result, 20 + padded).set(tail); return result;
}
async function probe(backend, projection, colorManagement) {
  const canvas = document.createElement("canvas"); canvas.style.width = "320px"; canvas.style.height = "240px";
  if (backend === "webgpu") canvas.dataset.spatialGpuTarget = "true";
  document.body.replaceChildren(canvas);
  const fallback = [], errors = [], rows = [], images = [], engines = [];
  const renderer = await createRenderer(canvas, { preferred: backend, colorManagement, fallbackBehavior: "silent",
    onFallback: info => fallback.push(info.reason), webgl2: { preserveDrawingBuffer: true } });
  check((typeof renderer.gpuDevice === "function") === (backend === "webgpu") && fallback.length === 0, "point shadow renderer fallback", fallback);
  let device = renderer.gpuDevice?.();
  const listen = () => device?.addEventListener("uncapturederror", event => errors.push(event.error.message)); listen();
  const originalRAF = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame, pending = new Map();
  let serial = 1, clock = 0, packet, frame, engine, registry, retainTerrain = false, nativeTerrain;
  window.requestAnimationFrame = callback => { const id = serial++; pending.set(id, callback); return id; };
  window.cancelAnimationFrame = id => pending.delete(id);
  const step = () => { clock += 17; const callbacks = [...pending.values()]; pending.clear(); for (const cb of callbacks) cb(clock); };
  try {
  const asset = await loadSpatialGlb(greenEmissiveModel(await (await fetch("/rock.glb")).arrayBuffer()), { materialProfile: "diffuse" });
  const makeEngine = async () => {
    const e = await createEngine(state => {
      frame = state;
      const previous = packet?.spatial, source = state.renderCommandBuffer.spatial;
      packet = { ...state.renderCommandBuffer, buffer: state.renderCommandBuffer.buffer.slice(),
        spatial: source && ownedSpatial(source) };
      if (retainTerrain && previous && source && nativeTerrain?.memory === source.terrain.buffer &&
          nativeTerrain.offset === source.terrain.byteOffset && nativeTerrain.length === source.terrain.length &&
          nativeTerrain.revision === source.terrainRevision) packet.spatial.terrain = previous.terrain;
      nativeTerrain = source && { memory: source.terrain.buffer, offset: source.terrain.byteOffset,
        length: source.terrain.length, revision: source.terrainRevision };
    }, undefined, undefined, () => renderer.viewportSize());
    check(e.registerDataSceneSpatialModel("rock", asset), "point shadow model registration");
    e.configureFixedTimestep(false); engines.push(e); registry = createSceneInstanceHandleRegistry(); return e;
  };
  const lights = [
    { position: { x: 64, y: -40, elevation: 80 }, radius: 320, intensity: 2, color: [0, 0, 1], lightMask: 255, shadowMask: 2 },
    { position: { x: 0, y: -40, elevation: 160 }, radius: 400, intensity: .2, color: [0, 1, 0], lightMask: 255, shadowMask: 4 },
    { position: { x: -64, y: -40, elevation: 80 }, radius: 320, intensity: 2, color: [1, 0, 0], lightMask: 255, shadowMask: 1 },
  ];
  const owners = [{ lightIndex: 2, resolution: 128, bias: .02 }, { lightIndex: 0, resolution: 256, bias: .03, normalBias: .1 }];
  const environment = (shadowFilter, shadows = "dual") => ({ composition: "separated", colorGrading: { exposure: -1, toneMapping: "none" },
    lighting: { ambient: [.04, .08, .04], lights, maxActiveLights: 4, selection: { hysteresis: .15, fadeSeconds: .15 }, shadowFilter,
      ...(shadows === "dual" ? { pointShadows: owners } : shadows === "a" ? { shadows: owners[0] } : shadows === "b" ? { shadows: owners[1] } : {}) } });
  const doc = { format: "ferrum2d.consumer.scene-authoring", version: 1,
    sceneComposition: { initialFragment: "lab", prefabs: { body: {} }, fragments: { lab: { instances: [
      { id: "hero", prefab: "body", x: 0, y: 0, props: { components: { visual: { kind: "sprite", texture: 1, width: 24, height: 40, originY: 1 }, collider: "none", layer: "player" } } },
      { id: "rock", prefab: "body", x: 24, y: 12, props: { components: { visual: { kind: "sprite", texture: 0, width: 1, height: 1, color: "#ffffff00" }, collider: "none", layer: "wall" } } },
      { id: "rock-copy", prefab: "body", x: -48, y: 0, props: { components: { visual: { kind: "sprite", texture: 0, width: 1, height: 1, color: "#ffffff00" }, collider: "none", layer: "wall" } } },
    ] } } }, behaviorRecipes: { entities: {} }, spatial: {
      camera: { projection, position: { x: 0, y: -240, elevation: 180 }, target: { x: 0, y: 12, elevation: 12 },
        ...(projection === "orthographic" ? { height: 200 } : { fovDegrees: 50 }), near: .1, far: 1600 },
      terrain: [
        { id: "floor", x: -128, y: -100, width: 256, depth: 256, elevation: 0, baseElevation: -8, color: [.5, .5, .5, 1] },
        { id: "blocker", x: -24, y: 20, width: 20, depth: 24, elevation: 32, baseElevation: 0, floorId: 1, color: [.5, .5, .5, 1] },
        { id: "no-shadow", x: -90, y: 64, width: 30, depth: 32, elevation: .01, baseElevation: 0, floorId: 2, color: [.5, .5, .5, 1], shadowMask: 0 },
      ], billboards: { hero: {} }, models: { rock: { asset: "rock", contentId: asset.contentId, scale: .7 },
        "rock-copy": { asset: "rock", contentId: asset.contentId, scale: .7 } }, environment: environment("hard") } };
  const options = { includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: doc };
  const history = () => captureGameStateSnapshot(engine, options).dataScene.progress.spatial.lightSelection;
  const draw = async (beginFrame = true) => {
    check(frame.gameState === GAME_STATE_CODE.playing && frame.entityCount >= 3, "point shadow live scene state", frame.gameState);
    if (beginFrame) renderer.render();
    const stats = renderer.renderCommands(packet); renderer.renderPostProcess();
    check(stats.spatial.modelCount === 2 && stats.spatial.modelDrawCalls > 0 && stats.spatial.modelInstancedDrawCalls > 0 && stats.spatial.triangleCount > 0 && !errors.length,
      "point shadow geometry or GPU error", { stats, errors });
    return { data: await pixels(renderer, canvas), stats: { ...stats.spatial }, resources: renderer.resourceStats() };
  };
  const row = async (name, env, expectedPasses, retryCurrentFrame = false, coldReference = false) => {
    window.pointShadowState = { backend, projection, colorManagement, name };
    if (env) { check(engine.setDataSceneSpatialEnvironment(env), "point shadow source rejected", name); step(); }
    const first = await draw(!retryCurrentFrame), warm = await draw();
    check(difference(first.data, warm.data) === 0, "point shadow warm pixels changed", name);
    check(first.stats.shadowPassCount === expectedPasses && warm.stats.shadowPassCount === 0 && warm.stats.shadowUploadBytes === 0,
      "point shadow face/cache budget", { name, first: first.stats, warm: warm.stats });
    const envValues = packet.spatial.environment?.values;
    if (envValues?.length === 592 && envValues[0] & 1) {
      const d = packet.spatial.environment.lightSelection;
      check(d.words[envValues[138] * 6 + 1] === 0 && (d.words[envValues[138] * 6 + 3] & 1), "first shadow owner diagnostics");
      if (envValues[584] >= 0) {
        check(d.words[envValues[584] * 6 + 1] === 1 && (d.words[envValues[584] * 6 + 3] & 1), "second shadow owner diagnostics");
        check(packet.spatial.models.version === 2 && packet.spatial.models.words.some((word, i) => i % 20 === 2 && (word & 0x3f00) !== 0), "second cube model mask missing");
      }
    }
    let cold;
    if (coldReference) {
      // Force all maps cold through the public packet stream boundary, preserving identical geometry.
      packet.spatial.terrain = packet.spatial.terrain.slice();
      const reference = await draw(), expected = packet.spatial.environment.values[92] > 0 ? 13 : 12;
      check(reference.stats.shadowPassCount === expected && difference(reference.data, warm.data) === 0,
        "partial shadow pixels differ from a full cold redraw", { name, stats: reference.stats });
      cold = { stats: reference.stats, image: png(reference.data, canvas.width, canvas.height) };
    }
    rows.push({ name, cold, stats: first.stats, warm: warm.stats, resources: warm.resources, width: canvas.width, height: canvas.height,
      environmentVersion: packet.spatial.environment?.version, modelVersion: packet.spatial.models.version, image: png(warm.data, canvas.width, canvas.height) });
    images.push(warm.data); return warm;
  };
    const texture = document.createElement("canvas"); texture.width = 8; texture.height = 16;
    const c = texture.getContext("2d"); c.fillStyle = "white"; c.fillRect(0, 0, 8, 16); c.clearRect(2, 3, 4, 5);
    await renderer.loadTexture(1, texture.toDataURL());
    if (backend === "webgpu") await renderer.preloadSpatialModels([asset]);
    engine = await makeEngine();
    applyDataSceneAuthoringDocument(engine, doc, { instanceHandleRegistry: registry, spatialModelPreparer: renderer, colorManagement });
    engine.start(); step(); step();
    const oracles = [];
    for (const filter of ["hard", "pcf3"]) {
      const plain = await row(`${filter}-plain`, environment(filter, "none"), 0);
      const a = await row(`${filter}-a`, environment(filter, "a"), 6);
      const b = await row(`${filter}-b`, environment(filter, "b"), 6);
      const dual = await row(`${filter}-dual`, environment(filter), 12);
      const oracle = { filter, red: channelOracle(dual.data, a.data, 0), blue: channelOracle(dual.data, b.data, 2),
        green: channelOracle(dual.data, plain.data, 1), redShadowPixels: shadowCoverage(plain.data, a.data, 0), blueShadowPixels: shadowCoverage(plain.data, b.data, 2) };
      check(oracle.red.different === 0 && oracle.blue.different === 0 && oracle.green.different === 0,
        "independent single-shadow color oracle", oracle);
      check(oracle.redShadowPixels > 16 && oracle.blueShadowPixels > 16, "point shadow reference has no actual shadow signal", oracle);
      oracles.push(oracle);
    }
    const saved = JSON.parse(JSON.stringify(captureGameStateSnapshot(engine, options)));
    check(saved.dataScene.version === 13 && saved.dataScene.progress.spatial.environment.lighting.pointShadows.length === 2, "point shadow state13 serialization");
    engine.stop(); engine = await makeEngine();
    check(restoreGameStateSnapshot(engine, saved, { dataSceneAuthoringApplyOptions: { colorManagement, spatialModelPreparer: renderer, instanceHandleRegistry: registry } }).dataSceneStateApplied, "point shadow fresh restore");
    engine.start(); step(); step(); const restored = await row("fresh-restore", null, 12);
    check(difference(restored.data, images[7], 1) === 0, "point shadow restored pixels");
    const sun = environment("pcf3"); sun.lighting.directional = { direction: { x: .3, y: -.4, elevation: 1 }, intensity: .1,
      color: [1, 1, 1], shadows: { resolution: 128, extent: 200, distance: 400, bias: .02 } };
    await row("dual-plus-sun", sun, 13);
    const many = environment("pcf3");
    while (many.lighting.lights.length < 16) many.lighting.lights = [...many.lighting.lights,
      { position: { x: many.lighting.lights.length * 3, y: 0, elevation: 64 }, radius: 160, intensity: .01, color: [0, 1, 0] }];
    const scaled = await row("sixteen-lights", many, 12);
    check(scaled.stats.authoredLightCount === 16 && scaled.stats.lightCount <= 4 && scaled.stats.droppedLightCount > 0, "point shadow source/active budget", scaled.stats);
    await row("dual-recovery-baseline", environment("hard"), 12);
    let recovered;
    if (backend === "webgpu") {
      const baseline = images[images.length - 1], old = renderer.gpuDevice(); old.destroy(); await old.lost; await Promise.resolve();
      await renderer.recoverDevice(); device = renderer.gpuDevice(); listen();
      const r = await row("recovered", null, 12);
      check(difference(r.data, baseline, 1) === 0, "point shadow device recovery pixels"); recovered = true;
    }
    const beforeOff = rows[rows.length - 1].stats.effectTextureBytes;
    const off = environment("hard"); off.lighting.enabled = false;
    const disabled = await row("off-preserved", off, 0);
    check(beforeOff - disabled.stats.effectTextureBytes === (128 ** 2 + 256 ** 2) * 24, "OFF point shadow targets retained", disabled.stats);
    await row("re-enabled", environment("hard"), 12);
    // A cold source edit invalidates the frame but retains the last native draw metadata.
    check(packet.spatial.models.words.some((word, i) => i % 20 === 2 && word > 255), "cold pose test needs v2 visibility");
    const handles = ["rock", "rock-copy"].map(id => registry.require(id)), poses = handles.map(handle => engine.dataSceneSpatialModelDrawSnapshot(handle));
    check(engine.setDataSceneSpatialEnvironment(environment("hard", "a")), "cold legacy downgrade rejected");
    for (const [i, handle] of handles.entries()) {
      const pose = engine.dataSceneSpatialModelDrawSnapshot(handle), before = poses[i];
      check(pose && before && pose.asset === before.asset && pose.cameraVisible === before.cameraVisible &&
        pose.transform.every((value, j) => value === before.transform[j]), "model pose changed before frame rebuild");
    }
    const single = environment("hard"); single.lighting.pointShadows = [owners[0]];
    await row("array-single", single, 6);
    const legacy = environment("hard", "a"); await row("legacy-single", legacy, 6);
    const resize = structuredClone(environment("hard")); canvas.style.width = "300px"; canvas.style.height = "220px"; renderer.resize();
    check(engine.setDataSceneSpatialEnvironment(resize), "shadow retry baseline rejected"); step();
    await draw(); check((await draw()).stats.shadowCacheHit, "shadow retry baseline cache not primed");
    // Resize only the owned packet's GPU target. Keep geometry/matrices and their
    // buffer identity fixed so an unrelated native frame change cannot hide a stale cache.
    packet.spatial.environment.values[585] = 512;
    let shadowRetryInjected = false;
    if (backend === "webgl2") {
      const gl = canvas.getContext("webgl2"), clear = gl.clear;
      gl.clear = function (...args) {
        if (gl.getParameter(gl.VIEWPORT)[2] === 512) { shadowRetryInjected = true; throw Error("injected secondary shadow redraw failure"); }
        return clear.apply(this, args);
      };
      try { await draw(); } catch (error) { check(String(error).includes("injected secondary shadow redraw failure"), "unexpected shadow retry error", String(error)); }
      finally { gl.clear = clear; }
      check(shadowRetryInjected, "secondary shadow redraw was not interrupted");
    }
    await row("resize", null, 6, shadowRetryInjected);
    const pixel = { ...environment("hard"), pixelArt: { width: 160, height: 120, snapCamera: true }, bloom: { mode: "wide", strength: .3, threshold: .2 } };
    const bloom = await row("pixel-art-wide", pixel, 12);
    check(bloom.stats.bloomDrawCalls > 0 && bloom.stats.bloomTextureBytes > 0, "dual shadows with active wide Bloom/pixelArt", bloom.stats);
    // Keep the owned terrain stream stable exactly while its native pointer/revision stays stable.
    // Light edits and native face-membership changes now exercise per-map cache reuse across real frames.
    const ownerEnv = structuredClone(sun);
    await row("owner-cache-baseline", ownerEnv, 13, false, true); retainTerrain = true;
    ownerEnv.lighting.lights[2].position.x -= 24;
    await row("primary-moved", ownerEnv, 6, false, true);
    ownerEnv.lighting.lights[0].position.x += 24;
    await row("secondary-moved", ownerEnv, 6, false, true);
    ownerEnv.lighting.directional.direction.x += .2;
    await row("sun-moved", ownerEnv, 1, false, true);
    ownerEnv.lighting.pointShadows[1].resolution = 512;
    await row("secondary-resolution", ownerEnv, 6, false, true);
    ownerEnv.lighting.pointShadows[0].bias += .01;
    ownerEnv.lighting.pointShadows[1].normalBias += .01;
    ownerEnv.lighting.shadowFilter = "hard";
    await row("sampling-only", ownerEnv, 0, false, true);
    const directional = ownerEnv.lighting.directional; delete ownerEnv.lighting.directional;
    await row("sun-disabled", ownerEnv, 0, false, true);
    ownerEnv.lighting.directional = directional;
    await row("sun-enabled", ownerEnv, 1, false, true);
    ownerEnv.lighting.pointShadows.reverse();
    await row("owners-swapped", ownerEnv, 12, false, true);
    // An owned packet is also a supported input. Update its common caster geometry and revision together.
    for (let i = 0; i < packet.spatial.environment.shadowCasters.length; i += 11)
      packet.spatial.environment.shadowCasters[i] += 12;
    packet.spatial.environment.shadowSubmission.revision++;
    await row("shared-caster-changed", null, 13, false, true);
    c.fillStyle = "white"; c.fillRect(0, 0, 8, 16); c.clearRect(0, 0, 4, 8);
    await renderer.loadTexture(1, texture.toDataURL());
    await row("alpha-replaced", null, 13, false, true);
    check(!errors.length, "point shadow GPU validation errors", errors);
    renderer.destroy(); check(renderer.resourceStats().textureCount === 0 && renderer.resourceStats().bufferCount === 0, "point shadow resource leak", renderer.resourceStats());
    return { backend, projection, colorManagement, rows, images, oracles, restored: true, coldPoseRetained: true, shadowRetryInjected, recovered, snapshotVersion: saved.dataScene.version, errors };
  } finally {
    for (const e of engines) e.destroy(); renderer.destroy(); device?.destroy(); window.disposeSpatialGpuTarget?.(canvas);
    window.requestAnimationFrame = originalRAF; window.cancelAnimationFrame = originalCancel;
  }
}
export async function probeSpatialPointShadows(colorManagement) {
  const result = [];
  for (const projection of ["orthographic", "perspective"]) {
    const backends = [];
    for (const backend of ["webgl2", "webgpu"]) backends.push(await probe(backend, projection, colorManagement));
    // Recovery has an extra GPU-only row; compare by semantic name rather than row position.
    const comparisons = backends[0].rows.map((row, i) => {
      const j = backends[1].rows.findIndex(other => other.name === row.name);
      check(j >= 0, "missing point shadow backend row", row.name);
      const differentPixels = difference(backends[0].images[i], backends[1].images[j], 3), pixelCount = backends[0].images[i].length / 4;
      check(differentPixels <= pixelCount * .01, "point shadow backend parity", { name: row.name, differentPixels, pixelCount });
      return { name: row.name, differentPixels, pixelCount };
    });
    for (const backend of backends) delete backend.images;
    result.push({ projection, comparisons, backends });
  }
  return result;
}
