import { createEngine, createRenderer, captureGameStateSnapshot, restoreGameStateSnapshot, GAME_STATE_CODE } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument, createSceneInstanceHandleRegistry } from "@ferrum2d/ferrum-web/authoring";
import { check, pixels, difference, png } from "/fixture.mjs";
import { ownedSpatial } from "/environment.mjs";

// Only the RAF clock is controlled. Public Engine updates, selection, fades and progress are actual Wasm.
async function probe(backend, projection, colorManagement, pinned) {
  const canvas = document.createElement("canvas");
  canvas.style.width = "min(100vw, 640px)"; canvas.style.height = "min(100vh, 360px)";
  if (backend === "webgpu") canvas.dataset.spatialGpuTarget = "true";
  document.body.replaceChildren(canvas);
  const fallback = [], renderer = await createRenderer(canvas, { preferred: backend, colorManagement,
    fallbackBehavior: "silent", onFallback: value => fallback.push(value.reason), webgl2: { preserveDrawingBuffer: true } });
  check((typeof renderer.gpuDevice === "function") === (backend === "webgpu") && !fallback.length, "selector backend fallback", fallback);
  const errors = [], originalRAF = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
  const pending = new Map(); let serial = 1, clock = 0, packet, frame, engine;
  const engines = [], rows = [], images = [];
  let deviceForCleanup;
  const listen = () => { deviceForCleanup = renderer.gpuDevice?.(); deviceForCleanup?.addEventListener("uncapturederror", e => errors.push(e.error.message)); };
  listen();
  window.requestAnimationFrame = callback => { const id = serial++; pending.set(id, callback); return id; };
  window.cancelAnimationFrame = id => pending.delete(id);
  const step = (ms = 50) => { clock += ms; const callbacks = [...pending.values()]; pending.clear(); for (const cb of callbacks) cb(clock); };
  const makeEngine = async () => {
    const instance = await createEngine(state => {
      frame = state; packet = { ...state.renderCommandBuffer, buffer: state.renderCommandBuffer.buffer.slice(), spatial: ownedSpatial(state.renderCommandBuffer.spatial) };
    }, undefined, undefined, () => renderer.viewportSize());
    instance.configureFixedTimestep(false); engines.push(instance); return instance;
  };
  const camera = x => ({ projection, position: { x, y: -220, elevation: 164 }, target: { x, y: 0, elevation: 64 },
    ...(projection === "orthographic" ? { height: 256 } : { fovDegrees: 55 }), near: .1, far: 1600 });
  const lights = [
    { position: { x: -40, y: 0, elevation: 64 }, radius: 150, intensity: 2, color: [1, .03, .01], lightMask: 1, shadowMask: 1,
      spot: { direction: { x: 0, y: 0, elevation: -1 }, angle: 80, penumbra: .2 } },
    { position: { x: 40, y: 0, elevation: 64 }, radius: 150, intensity: 2, color: [.01, 1, .03], lightMask: 2, shadowMask: 2,
      spot: { direction: { x: 0, y: 0, elevation: -1 }, angle: 70, penumbra: .4 } },
    { position: { x: 0, y: -20, elevation: 100 }, radius: 200, intensity: .05, color: [.1, .1, 1], lightMask: 255, shadowMask: 255 },
    { position: { x: 0, y: 0, elevation: 64 }, radius: 150, intensity: 0 },
    { position: { x: 0, y: 0, elevation: 64 }, radius: 150, intensity: 2, followActor: true },
  ];
  const environment = { composition: "separated", colorGrading: { exposure: -1, toneMapping: "none" }, lighting: {
    ambient: [.03, .03, .03], maxActiveLights: pinned ? 2 : 1, lights, selection: { hysteresis: .15, fadeSeconds: .2, resetDistance: 0 },
    ...(pinned ? { shadows: { lightIndex: 2, resolution: 128, bias: .02 }, shadowFilter: "pcf3" } : {}),
  } };
  const doc = { format: "ferrum2d.consumer.scene-authoring", version: 1,
    sceneComposition: { initialFragment: "lab", prefabs: { body: {} }, fragments: { lab: { instances: [{ id: "hero", prefab: "body", x: 0, y: 0,
      props: { components: { visual: { kind: "sprite", texture: 1, width: 16, height: 32 }, collider: { type: "aabb", halfWidth: 4, halfHeight: 4 }, layer: "player" } } }] } } },
    behaviorRecipes: { entities: {} }, spatial: { camera: camera(-40), terrain: [
      { id: "left", x: -128, y: -80, width: 128, depth: 200, elevation: 0, baseElevation: -8, color: [.5, .5, .5, 1], lightMask: 1, shadowMask: 255 },
      { id: "right", x: 0, y: -80, width: 128, depth: 200, elevation: 0, baseElevation: -8, color: [.5, .5, .5, 1], lightMask: 2, shadowMask: 255 },
      { id: "back", x: -128, y: 120, width: 256, depth: 40, elevation: 0, baseElevation: -8, color: [.5, .5, .5, 1] },
      { id: "caster", x: -12, y: 40, width: 24, depth: 20, floorId: 1, elevation: 32, baseElevation: 0, color: [.4, .4, .4, 1] },
    ], billboards: { hero: {} }, environment } };
  const saveOptions = { includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: doc };
  const save = () => JSON.parse(JSON.stringify(captureGameStateSnapshot(engine, saveOptions)));
  const history = () => save().dataScene.progress.spatial.lightSelection;
  const draw = async (value = packet) => {
    renderer.render(); const stats = renderer.renderCommands(value); renderer.renderPostProcess();
    check(!errors.length && stats.drawCalls < 32 && stats.spatial.terrainTriangleCount >= 12, "selector state/work budget", { stats, errors });
    return { data: await pixels(renderer, canvas), stats: { ...stats.spatial }, resources: renderer.resourceStats() };
  };
  // Independent authored-source reconstruction at native weights, through the existing v7 GPU contract.
  const reference = () => {
    const s = packet.spatial, env = s.environment, v = env.values.slice(0, 576), diagnostics = env.lightSelection;
    if (diagnostics) {
      v.fill(0, 12, 60); v.fill(0, 144, 176); v.fill(0, 545, 549);
      for (let i = 0; i < diagnostics.words.length; i += 6) {
        const source = diagnostics.words[i], slot = diagnostics.words[i + 1];
        if (slot === 0xffffffff) continue;
        const from = 192 + source * 20, to = 12 + slot * 12;
        v.set(env.values.subarray(from, from + 8), to); v[to + 7] = Math.fround(env.values[from + 7] * diagnostics.values[i + 5]);
        if ([6, 9].includes(diagnostics.words[i + 2])) v[to + 7] = 0;
        v.set(env.values.subarray(from + 8, from + 14), 144 + slot * 8); v[545 + slot] = env.values[549 + source];
      }
    }
    return { ...packet, spatial: { ...s, environment: { ...env, version: 7, values: v, lightSelection: undefined } } };
  };
  const row = async name => {
    const advancing = name === "initial" || name === "settled" || name.startsWith("jitter-") || name.startsWith("out-") || name.startsWith("in-");
    check(frame.gameState === GAME_STATE_CODE[advancing ? "playing" : "paused"], "selector lifecycle state", { name, state: frame.gameState });
    const first = await draw(), warm = await draw();
    check(difference(first.data, warm.data) === 0, "selector render-only rebuild changes pixels", name);
    check(warm.stats.terrainUploadBytes === 0 && (!pinned || warm.stats.shadowPassCount === 0), "selector warm geometry/shadow work", warm.stats);
    const expected = await draw(reference());
    const referenceDifference = difference(warm.data, expected.data, 1);
    check(referenceDifference === 0, "selector authored/weight/channel/cone reference mismatch", { name, referenceDifference });
    const env = packet.spatial.environment, d = env.lightSelection;
    const diagnostics = d ? Array.from({ length: d.words.length / 6 }, (_, i) => ({ source: d.words[i * 6], slot: d.words[i * 6 + 1],
      reason: d.words[i * 6 + 2], flags: d.words[i * 6 + 3], score: d.values[i * 6 + 4], weight: d.values[i * 6 + 5] })) : undefined;
    rows.push({ name, state: frame.gameState, stats: warm.stats, resources: warm.resources, diagnostics, referenceDifference }); images.push(warm.data);
    return warm;
  };
  try {
    const texture = document.createElement("canvas"); texture.width = texture.height = 8;
    const ctx = texture.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 8, 8); ctx.clearRect(2, 2, 4, 4);
    await renderer.loadTexture(1, texture.toDataURL());
    engine = await makeEngine(); const registry = createSceneInstanceHandleRegistry();
    const initialHandle = applyDataSceneAuthoringDocument(engine, doc, { instanceHandleRegistry: registry }).entityHandles.hero;
    engine.start(); step(0); step();
    const initial = history(); check(initial.slots[pinned ? 1 : 0].sourceIndex === 0, "selector initial source", initial);
    await row("initial");
    for (const x of [1, -1]) { check(engine.setDataSceneSpatialCamera(camera(x), renderer.viewportSize()), "selector jitter camera"); step(); await row(`jitter-${x}`); }
    check(history().slots[pinned ? 1 : 0].weight === 1 && history().slots[pinned ? 1 : 0].sourceIndex === 0, "selector border jitter faded", history());
    check(rows[1].stats.retainedLightCount === 1, "selector retained reason not reported", rows[1]);
    check(engine.setDataSceneSpatialCamera(camera(40), renderer.viewportSize()), "selector promotion camera");
    step(); await row("out-75"); step(); const mid = await row("out-50");
    const h = history(), slot = h.slots[pinned ? 1 : 0];
    check(slot.phase === "fading-out" && Math.abs(slot.weight - .5) < 1e-6 && slot.pendingSourceIndex === 1, "selector mid-fade state", h);
    check(rows.at(-1).stats.pendingLightCount === 1 && rows.at(-1).stats.fadingLightCount === 1, "selector pending/fading metrics", rows.at(-1));
    engine.pauseDataScene(); const snapshot = save(); engine.stop();
    const sourceHistory = snapshot.dataScene.progress.spatial.lightSelection;
    engine = await makeEngine();
    const destinationRegistry = createSceneInstanceHandleRegistry();
    const priorHandle = applyDataSceneAuthoringDocument(engine, doc, { instanceHandleRegistry: destinationRegistry }).entityHandles.hero;
    check(restoreGameStateSnapshot(engine, snapshot, { dataSceneAuthoringApplyOptions: { instanceHandleRegistry: destinationRegistry } }).dataSceneStateApplied, "selector fresh restore failed");
    check(!engine.gameplayEntityExists(priorHandle), "selector restoration reused old handle", { priorHandle, initialHandle });
    engine.start(); step(0); step();
    check(JSON.stringify(history()) === JSON.stringify(sourceHistory), "selector paused restore history mismatch");
    const restored = await row("restored-out-50");
    check(difference(mid.data, restored.data) === 0, "selector fresh restore pixels differ");
    step(); await row("paused-out-50"); check(JSON.stringify(history()) === JSON.stringify(sourceHistory), "selector pause advances history");
    engine.resumeDataScene();
    for (const name of ["out-25", "in-0", "in-25", "in-50", "in-75", "settled"]) { step(); await row(name); }
    check(history().slots[pinned ? 1 : 0].sourceIndex === 1 && history().slots[pinned ? 1 : 0].weight === 1, "selector does not converge", history());
    engine.pauseDataScene(); const stable = history();
    check(engine.setDataSceneSpatialEnvironment(structuredClone(environment)), "selector equivalent source edit rejected");
    check(JSON.stringify(history()) === JSON.stringify(stable), "selector identical source edit resets history");
    step(0); await row("same-source");
    if (backend === "webgpu") {
      const before = await draw(), device = renderer.gpuDevice(); device.destroy(); await device.lost;
      check(await renderer.recoverDevice(), "selector recovery failed"); listen();
      const after = await draw(); check(difference(before.data, after.data) === 0, "selector recovery pixels differ");
      check(JSON.stringify(history()) === JSON.stringify(stable), "GPU recovery changes native history");
    }
    check(engine.resetDataSceneSpatialLightSelection(), "selector explicit reset failed"); step(0); await row("reset-preview");
    check(history().initialized === false && packet.spatial.environment.lightSelection.words[3] & 4, "selector render seeded reset history");
    const off = structuredClone(environment); off.lighting.enabled = false;
    check(engine.setDataSceneSpatialEnvironment(off), "selector global OFF rejected"); step(0); await row("lighting-off");
    check(rows.at(-1).stats.disabledLightCount === 5 && rows.at(-1).stats.lightCount === 0 && rows.at(-1).stats.shadowPassCount === 0, "selector OFF metrics/work", rows.at(-1));
    const legacy = structuredClone(environment); legacy.lighting.selection.enabled = false;
    check(engine.setDataSceneSpatialEnvironment(legacy), "selector policy OFF rejected"); step(0); await row("policy-off");
    check(rows.at(-1).stats.pendingLightCount === undefined && packet.spatial.environment.lightSelection === undefined, "selector policy OFF invents diagnostics");
    const many = structuredClone(environment); many.lighting.maxActiveLights = 4;
    while (many.lighting.lights.length < 16) many.lighting.lights.push({ position: { x: many.lighting.lights.length * 4, y: 0, elevation: 64 }, radius: 100, intensity: .01 });
    check(engine.setDataSceneSpatialEnvironment(many), "selector sixteen source request rejected"); step(0); await row("sixteen-budget");
    check(rows.at(-1).stats.authoredLightCount === 16 && rows.at(-1).stats.lightCount === 4 && rows.at(-1).stats.droppedLightCount > 0 && rows.at(-1).stats.culledLightCount === 2, "selector diagnostic scale/budget", rows.at(-1));
    canvas.style.width = "300px"; canvas.style.height = "220px"; renderer.resize(); step(0); await row("resize");
    check(!errors.length, "selector GPU errors", errors);
    const result = { backend, projection, colorManagement, pinned, width: images[0].length / 4 / Math.round(Math.min(window.innerHeight, 360) * devicePixelRatio),
      freshHandles: true, restored: true, recovered: backend === "webgpu", errors, rows, images };
    renderer.destroy();
    check(renderer.resourceStats().textureCount === 0 && renderer.resourceStats().bufferCount === 0, "selector resource leak", renderer.resourceStats());
    return result;
  } finally {
    for (const instance of engines) instance.destroy(); renderer.destroy(); deviceForCleanup?.destroy();
    window.requestAnimationFrame = originalRAF; window.cancelAnimationFrame = originalCancel;
  }
}

export async function probeSpatialLightSelection(colorManagement) {
  const result = [];
  for (const projection of ["orthographic", "perspective"]) for (const pinned of [false, true]) {
    const pair = [];
    for (const backend of ["webgl2", "webgpu"]) pair.push(await probe(backend, projection, colorManagement, pinned));
    const comparisons = pair[0].images.map((image, i) => {
      const other = pair[1].images[i], differentPixels = difference(image, other, 3);
      check(differentPixels <= image.length / 4 * .01, "selector backend pixel parity", { name: pair[0].rows[i].name, differentPixels, pixels: image.length / 4 });
      return { name: pair[0].rows[i].name, differentPixels, pixels: image.length / 4 };
    });
    for (const entry of pair) {
      const resized = entry.images.at(-1), initial = entry.images[0];
      for (let i = 0; i < entry.rows.length; i++) {
        const image = entry.images[i], width = i === entry.rows.length - 1 ? Math.round(300 * devicePixelRatio) : Math.round(Math.min(innerWidth, 640) * devicePixelRatio);
        entry.rows[i].image = png(image, width, image.length / 4 / width);
      }
      check(resized.length !== initial.length, "selector resize did not change target"); delete entry.images;
    }
    result.push({ projection, pinned, comparisons, backends: pair });
  }
  return result;
}
