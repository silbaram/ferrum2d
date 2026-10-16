import { captureGameStateSnapshot, restoreGameStateSnapshot } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";

export async function probeSpatialQuality(scene, canvas) {
  const { engine, renderer, view } = scene, gl = canvas.getContext("webgl2");
  const check = (ok, message, evidence) => { if (!ok) throw Error(`${message}: ${JSON.stringify(evidence)}`); };
  const wait = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); };
  const image = () => { const p = new Uint8Array(canvas.width * canvas.height * 4); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, p); return p; };
  const draw = (spatial = scene.frame.spatial) => {
    renderer.render();
    const stats = renderer.renderCommands({ ...scene.frame.state.renderCommandBuffer, spatial, buffer: new Float32Array(), commandCount: 0 });
    renderer.renderPostProcess(); check(gl.getError() === gl.NO_ERROR, "quality WebGL error");
    return { stats: { ...stats.spatial }, pixels: image() };
  };
  const camera = { projection: "orthographic", position: { x: 0, y: -160, elevation: 160 }, target: { x: 0, y: 0, elevation: 0 }, height: 180, near: 0.1, far: 1200 };
  const ground = { id: "ground", x: -240, y: -240, width: 480, depth: 480, elevation: 0, color: [0.6, 0.6, 0.6, 1] };
  const document = {
    format: "ferrum2d.consumer.scene-authoring", version: 1,
    sceneComposition: { initialFragment: "quality", prefabs: { blank: {} }, fragments: { quality: { instances: [] } } },
    behaviorRecipes: { entities: {} }, spatial: { camera, terrain: [ground], billboards: {} },
  };
  const apply = async doc => {
    const result = applyDataSceneAuthoringDocument(engine, doc); engine.pauseDataScene(); await wait(); return result.entityHandles;
  };
  const environment = async options => { check(engine.setDataSceneSpatialEnvironment(options), "quality environment rejected", options); await wait(); return draw(); };
  await apply(document);
  const pixel = await environment({ pixelArt: { width: 160, height: 90, snapCamera: true } });
  await window.spatialDebugScreenshot("quality-pixel", canvas.toDataURL());
  check(pixel.stats.effectTextureBytes === 160 * 90 * 12, "pixel target is not fixed resolution", pixel.stats);
  const p = scene.frame.spatial.presentation;
  const x0 = Math.round(p[0] * canvas.width), y0 = Math.round((1 - p[1] - p[3]) * canvas.height);
  const scale = Math.round(p[2] * canvas.width / 160);
  let mismatches = 0;
  for (let y = 0; y < 90; y++) for (let x = 0; x < 160; x++) {
    const first = ((y0 + y * scale) * canvas.width + x0 + x * scale) * 4;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const index = first + (dy * canvas.width + dx) * 4;
      for (let c = 0; c < 4; c++) if (pixel.pixels[index + c] !== pixel.pixels[first + c]) mismatches++;
    }
  }
  check(mismatches === 0 && scale >= 1, "nearest integer upscale changed pixel blocks", { mismatches, scale });
  const point = { x: 20, y: 20, elevation: 0 }, screen = view.project(point, scene.frame.spatial), hit = view.pick(screen, scene.frame.spatial);
  check(hit && Math.hypot(hit.x - point.x, hit.y - point.y) < 0.01, "letterboxed picking drifted", { screen, hit });
  if (p[0] > 0.01) check(view.pick({ x: 1, y: canvas.clientHeight / 2 }, scene.frame.spatial) === undefined, "letterbox picked terrain");
  const sourceCamera = { ...camera, position: { ...camera.position, x: 0.001 }, target: { ...camera.target, x: 0.001 } };
  check(engine.setDataSceneSpatialCamera(sourceCamera, renderer.viewportSize()), "snap camera rejected"); await wait();
  const snapped = draw();
  check(pixel.pixels.every((v, i) => v === snapped.pixels[i]), "subpixel camera movement changed snapped pixels");

  // An asymmetric normal atlas tests sprite-local X direction and flip, with the same UVs as color.
  const color = globalThis.document.createElement("canvas"), normal = globalThis.document.createElement("canvas");
  color.width = normal.width = 32; color.height = normal.height = 32;
  const cc = color.getContext("2d"), nc = normal.getContext("2d");
  cc.fillStyle = "#aaaaaa"; cc.fillRect(0, 0, 32, 32);
  nc.fillStyle = "rgb(240,128,190)"; nc.fillRect(0, 0, 32, 32);
  await renderer.loadTexture(71, color.toDataURL()); await renderer.loadTexture(72, normal.toDataURL(), { colorSpace: "none" });
  const normalDoc = structuredClone(document);
  normalDoc.sceneComposition.fragments.quality.instances = [{ id: "sprite", prefab: "blank", x: 0, y: 0,
    props: { components: { visual: { kind: "sprite", texture: 71, width: 32, height: 32, originX: 0.5, originY: 1 }, collider: { type: "none" }, layer: "player" } } }];
  normalDoc.spatial.billboards = { sprite: { normalTextureId: 72 } };
  const handles = await apply(normalDoc);
  const lighting = { ambient: [0.05, 0.05, 0.05], lights: [{ position: { x: 100, y: -80, elevation: 30 }, radius: 300, intensity: 2 }] };
  const lit = await environment({ lighting });
  await window.spatialDebugScreenshot("quality-normal", canvas.toDataURL());
  const sample = (result, point = { x: 0, y: 0, elevation: 16 }) => {
    const q = view.project(point, scene.frame.spatial);
    const index = ((canvas.height - 1 - Math.round(q.y * canvas.height / canvas.clientHeight)) * canvas.width + Math.round(q.x * canvas.width / canvas.clientWidth)) * 4;
    return result.pixels[index];
  };
  const right = sample(lit);
  const opposite = structuredClone(lighting); opposite.lights[0].position.x = -100;
  const left = sample(await environment({ lighting: opposite }));
  check(right > left + 50, "normal atlas did not respond to light direction", { right, left });
  check(engine.configureDataSceneSpriteAnimation(handles.sprite, { clips: [{ id: 0, frames: [{ u0: 0, v0: 0, u1: 1, v1: 1 }], fps: 1 }] }), "normal flip animation setup failed");
  check(engine.updateDataSceneSpriteAnimations([{ entity: handles.sprite, flipX: true }]), "normal flip rejected");
  const flipped = sample(await environment({ lighting }));
  check(right > flipped + 50, "flipX did not flip the normal tangent direction", { right, flipped });
  engine.updateDataSceneSpriteAnimations([{ entity: handles.sprite, flipX: false }]); await wait();
  // Invalid color-space maps fail before any draw, with a diagnostic describing the asset contract.
  await renderer.loadTexture(73, normal.toDataURL());
  const invalidFrame = { ...scene.frame.spatial, materials: { ...scene.frame.spatial.materials, billboards: scene.frame.spatial.materials.billboards.slice() } };
  invalidFrame.materials.billboards[0] = 73;
  let invalid = false; try { draw(invalidFrame); } catch (error) { invalid = /normal atlas/.test(String(error)); }
  check(invalid, "sRGB normal atlas was accepted");
  // A raised bridge casts directional shadows onto a visible receiver outside its footprint.
  const sunDoc = structuredClone(document);
  sunDoc.spatial.terrain.push({ id: "bridge", x: -16, y: -16, width: 32, depth: 32, elevation: 40, baseElevation: 34, floorId: 1, kind: "bridge", color: [0.6, 0.6, 0.6, 1] });
  const sunLighting = { ambient: [0.03, 0.03, 0.03], lights: [], directional: { direction: { x: -1, y: -1, elevation: 2 }, intensity: 2 } };
  await apply(sunDoc);
  const receiver = { x: 20, y: 20, elevation: 0 };
  const sunLit = sample(await environment({ lighting: sunLighting }), receiver);
  const shadowLighting = structuredClone(sunLighting);
  shadowLighting.directional.shadows = { resolution: 256, extent: 256, distance: 400, bias: 0.1 };
  const sunShadowResult = await environment({ lighting: shadowLighting });
  const sunShadow = sample(sunShadowResult, receiver);
  check(sunLit > sunShadow + 40 && sunShadowResult.stats.directionalLightCount === 1 && sunShadowResult.stats.shadowCacheHit, "directional bridge occlusion/cache failed", { sunLit, sunShadow, stats: sunShadowResult.stats });
  const pcf = await environment({ lighting: { ...shadowLighting, shadowFilter: "pcf3" } });
  await window.spatialDebugScreenshot("quality-sun-pcf", canvas.toDataURL());
  const pcfOutside = sample(pcf, { x: 30, y: -20, elevation: 0 });
  check(Math.abs(pcfOutside - sunLit) <= 3, "PCF self-shadow darkened an unobstructed plane", { pcfOutside, sunLit });
  let filteredPixels = 0;
  for (let i = 0; i < pcf.pixels.length; i++) if (Math.abs(pcf.pixels[i] - sunShadowResult.pixels[i]) > 3) filteredPixels++;
  check(filteredPixels > 10 && pcf.stats.effectTextureBytes === sunShadowResult.stats.effectTextureBytes, "PCF changed no shadow edge or allocated extra targets", { filteredPixels });
  sunDoc.spatial.terrain[1].castShadow = false;
  await apply(sunDoc);
  const noCast = sample(await environment({ lighting: shadowLighting }), receiver);
  check(noCast > sunShadow + 40, "castShadow false still occluded directional light", { noCast, sunShadow });
  sunDoc.spatial.terrain[1].castShadow = true;
  sunDoc.spatial.terrain[0].receiveShadow = false;
  await apply(sunDoc);
  const noReceive = sample(await environment({ lighting: shadowLighting }), receiver);
  check(noReceive > sunShadow + 40, "receiveShadow false still darkened receiver", { noReceive, sunShadow });

  const mixedLighting = { ...shadowLighting, shadowFilter: "pcf3", lights: [{ position: { x: 20, y: -80, elevation: 100 }, radius: 300 }], shadows: { lightIndex: 0, resolution: 128, bias: 0.1 } };
  await environment({ lighting: mixedLighting });
  const mixedFrame = scene.frame.spatial;
  const culled = draw({ ...mixedFrame, environment: { ...mixedFrame.environment, shadowSubmission: { ...mixedFrame.environment.shadowSubmission, revision: mixedFrame.environment.shadowSubmission.revision + 1 } } });
  const full = draw({ ...mixedFrame, environment: { ...mixedFrame.environment, shadowSubmission: undefined } });
  check(culled.stats.shadowPassCount === 7 && full.stats.shadowPassCount === 7 && culled.stats.shadowDrawCalls <= 448 && culled.stats.shadowCulledTriangleCount > 0 &&
    culled.pixels.every((v, i) => Math.abs(v - full.pixels[i]) <= 3), "mixed point/sun PCF culling changed pixels or budgets", { culled: culled.stats, full: full.stats });
  // A target recreation and a new texture set in the same frame must be cacheable immediately.
  const coldFrame = { ...mixedFrame, terrain: mixedFrame.terrain.slice(), terrainRevision: mixedFrame.terrainRevision + 1,
    environment: { ...mixedFrame.environment, values: mixedFrame.environment.values.slice() } };
  for (let i = 9; i < coldFrame.terrain.length; i += 11) coldFrame.terrain[i] = 71;
  coldFrame.environment.values[3] = 256;
  const cold = draw(coldFrame), warm = draw(coldFrame);
  check(cold.stats.shadowPassCount === 7 && warm.stats.shadowCacheHit && warm.stats.shadowDrawCalls === 0 && warm.stats.shadowUploadBytes === 0 &&
    cold.pixels.every((v, i) => Math.abs(v - warm.pixels[i]) <= 3), "first rebuilt shadow target did not cache its texture revisions", { cold: cold.stats, warm: warm.stats });
  let rejected = 0, submitted = 0;
  const originalDraw = gl.drawArrays;
  gl.drawArrays = function(...args) { submitted++; return originalDraw.apply(this, args); };
  try {
    for (const ranges of [new Uint32Array([7, 0, 0, 36]), new Uint32Array([0, 2, 0, 36]), new Uint32Array([0, 0, 1, 36]), new Uint32Array([0, 0, 0, 999999]), new Uint32Array([0, 0, 0, 36, 0, 0, 0, 36])]) {
      try { draw({ ...mixedFrame, environment: { ...mixedFrame.environment, shadowSubmission: { ...mixedFrame.environment.shadowSubmission, ranges } } }); }
      catch (error) { if (/shadow submission/.test(String(error))) rejected++; else throw error; }
    }
  } finally { gl.drawArrays = originalDraw; }
  check(rejected === 5 && submitted === 0, "invalid shadow ranges reached GPU", { rejected, submitted });

  // High quality spreads a blurred red foreground over the existing blue background.
  const red = globalThis.document.createElement("canvas"); red.width = red.height = 32;
  const rc = red.getContext("2d"); rc.fillStyle = "#ff0000"; rc.fillRect(0, 0, 32, 32);
  await renderer.loadTexture(74, red.toDataURL());
  const dofDoc = structuredClone(normalDoc);
  dofDoc.spatial.billboards.sprite = {};
  dofDoc.spatial.terrain[0].color = [0.05, 0.05, 0.9, 1];
  const instance = dofDoc.sceneComposition.fragments.quality.instances[0];
  instance.y = -40; instance.props.components.visual.texture = 74; instance.props.components.visual.height = 64;
  await apply(dofDoc);
  const c = scene.frame.spatial.camera;
  const direction = [c[20] - c[17], c[21] - c[18], c[22] - c[19]], length = Math.hypot(...direction);
  const focusDistance = ([0, 0, -100].reduce((sum, v, i) => sum + (v - c[17 + i]) * direction[i] / length, 0));
  const dofSettings = { focusDistance, focusRange: 2, aperture: 32, maxBlurRadius: 12 };
  const standard = await environment({ depthOfField: dofSettings });
  await window.spatialDebugScreenshot("quality-dof-standard", canvas.toDataURL());
  const high = await environment({ depthOfField: { ...dofSettings, quality: "high" } });
  await window.spatialDebugScreenshot("quality-dof-high", canvas.toDataURL());
  let foregroundPixels = 0;
  for (let i = 0; i < high.pixels.length; i += 4) if (standard.pixels[i + 2] > standard.pixels[i] + 50 && high.pixels[i] > standard.pixels[i] + 5 && high.pixels[i + 2] < standard.pixels[i + 2] - 5) foregroundPixels++;
  check(foregroundPixels > 20 && high.stats.dofSampleBudget === 25 && standard.stats.dofSampleBudget === 13 && high.stats.effectTextureBytes === standard.stats.effectTextureBytes,
    "high DOF did not extend foreground coverage with bounded resources", { foregroundPixels, standard: standard.stats, high: high.stats });

  const actorDoc = structuredClone(normalDoc);
  const components = actorDoc.sceneComposition.fragments.quality.instances[0].props.components;
  components.collider = { type: "aabb", halfWidth: 1, halfHeight: 1, isTrigger: false };
  components.body = { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 32 } };
  actorDoc.spatial.actor = { instanceId: "sprite", speed: 64 };
  actorDoc.spatial.environment = { depthOfField: { focusDistance: 500, focusTarget: "actor", focusOffset: 16, quality: "high" } };
  const actorHandles = await apply(actorDoc);
  const focusBefore = scene.frame.spatial.environment.values[99];
  check(engine.moveDataSceneSpatialBody(actorHandles.sprite, 0, 32), "focus actor move rejected"); await wait();
  const focusAfter = scene.frame.spatial.environment.values[99];
  check(focusAfter > focusBefore + 10, "native focus target did not follow actor", { focusBefore, focusAfter });
  const saved = captureGameStateSnapshot(engine, { includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: actorDoc });
  await environment(null);
  const restored = restoreGameStateSnapshot(engine, saved); await wait();
  const focusRestored = scene.frame.spatial.environment.values[99];
  check(restored.dataSceneStateApplied && Math.abs(focusRestored - focusAfter) < 0.01 && draw().stats.dofSampleBudget === 25, "actor focus/quality save restore failed", { restored, focusAfter, focusRestored });
  await apply(document); await environment(null);
  return { pixel: { internal: [160, 90], scale, mismatches, hit: hit.surfaceId }, normal: { right, left, flipped, invalid }, handles: !!handles.sprite, sun: { sunLit, sunShadow, pcfOutside, filteredPixels, noCast, noReceive }, dof: { foregroundPixels, focusBefore, focusAfter, focusRestored }, mixed: { culled: culled.stats, full: full.stats, cold: cold.stats, warm: warm.stats, rejected, submitted } };
}
