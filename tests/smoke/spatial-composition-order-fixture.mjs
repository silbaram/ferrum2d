import { createEngine, createRenderer } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";
import { check, difference, pixels } from "/fixture.mjs";

/** A one-pixel HDR source falls below Bloom threshold after a four-pixel DOF gather. */
export async function probeSpatialCompositionOrder(backend, colorManagement = "legacy", wide = false, heightFog = false, lightShafts = false) {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;left:0;top:0;width:32px;height:32px";
  canvas.dataset.spatialGpuTarget = "true"; document.body.append(canvas);
  let renderer, engine, pending;
  const errors = [];
  try {
    renderer = await createRenderer(canvas, { preferred: backend, colorManagement, fallbackBehavior: "silent", webgl2: { preserveDrawingBuffer: true } });
    check((typeof renderer.gpuDevice === "function") === (backend === "webgpu"), "composition reference fell back");
    const watch = () => renderer.gpuDevice?.().addEventListener("uncapturederror", event => errors.push(event.error.message));
    watch();
    engine = await createEngine(frame => {
      if (!pending) return;
      const request = pending; pending = undefined;
      try {
        renderer.render(); const stats = renderer.renderCommands(frame.renderCommandBuffer); renderer.renderPostProcess(); engine.stop();
        pixels(renderer, canvas).then(data => request.resolve({ data, stats: { ...stats.spatial }, resources: renderer.resourceStats() }), request.reject);
      } catch (error) { engine.stop(); request.reject(error); }
    });
    const viewport = renderer.viewportSize(); engine.setViewportSize(viewport.width, viewport.height);
    applyDataSceneAuthoringDocument(engine, {
      format: "ferrum2d.consumer.scene-authoring", version: 1,
      sceneComposition: { prefabs: {}, fragments: { main: { instances: [] } } }, behaviorRecipes: { entities: {} },
      spatial: {
        camera: { projection: "orthographic", position: { x: 0, y: -1, elevation: 100 }, target: { x: 0, y: 0, elevation: 0 }, height: 32, near: 1, far: 200 },
        terrain: [
          [-32, -32, 31.5, 64], [0.5, -32, 31.5, 64],
          [-0.5, -32, 1, 31.5], [-0.5, 0.5, 1, 31.5], [-0.5, -0.5, 1, 1],
        ].map(([x, y, width, depth], index) => ({
          id: `surface_${index}`, x, y, width, depth, elevation: 0,
          color: index === 4 ? [1, 1, 1, 1] : [0, 0, 0, 1],
        })), billboards: {},
      },
    });
    engine.pauseDataScene();
    const draw = environment => new Promise((resolve, reject) => {
      check(!pending, "overlapping composition reference frame");
      check(engine.setDataSceneSpatialEnvironment(environment), "composition reference environment rejected");
      const timeout = setTimeout(() => reject(Error("composition reference frame timed out")), 15000);
      pending = { resolve: result => { clearTimeout(timeout); resolve(result); }, reject: error => { clearTimeout(timeout); reject(error); } };
      engine.start();
    });
    const base = { composition: "separated", lighting: { ambient: [4, 4, 4], lights: [] }, ...(heightFog ? {fog: {color: [0, 0, 0], start: 0, end: 200, height: {baseHeight: 20, density: .01, falloff: .02}}} : {}) };
    if (lightShafts) {
      base.lighting.directional = {direction:{x:0,y:0,elevation:1},intensity:.1,shadows:{resolution:128,extent:64,distance:200}};
      base.lightShafts = {intensity:.5,density:.01,maxDistance:150};
    }
    const depthOfField = { focusDistance: 1, focusRange: 0, aperture: 32, maxBlurRadius: 4 };
    const bloom = { strength: 1, radius: 8, threshold: 1, ...(wide ? { mode: "wide" } : {}) };
    const sharp = await draw(base);
    const blurred = await draw({ ...base, depthOfField });
    const peak = data => { let result = 0; for (let i = 0; i < data.length; i += 4) result = Math.max(result, data[i], data[i + 1], data[i + 2]); return result; };
    check(peak(sharp.data) === 255 && peak(blurred.data) > 10 && peak(blurred.data) < 250,
      "reference must contain HDR source and sub-threshold blurred radiance", { sharp: peak(sharp.data), blurred: peak(blurred.data) });
    if (heightFog) {
      const withoutFog = await draw({ ...base, fog: undefined, depthOfField });
      check(difference(blurred.data, withoutFog.data, 3) > 5, "height fog missing before DOF");
    }
    if (lightShafts) {
      const withoutShafts = await draw({...base,lightShafts:undefined,depthOfField});
      check(difference(blurred.data,withoutShafts.data,3)>5,"light shafts missing before post-processing");
    }
    const filtered = await draw({ ...base, depthOfField, bloom });
    check(difference(blurred.data, filtered.data, 2) === 0, "Bloom did not read the post-DOF sub-threshold radiance");
    check(filtered.stats.effectDrawCalls === 2 + filtered.stats.bloomDrawCalls + (lightShafts ? 2 : 0) && (lightShafts ? filtered.stats.effectTextureBytes - blurred.stats.effectTextureBytes - filtered.stats.bloomTextureBytes === canvas.width * canvas.height * 8 : (filtered.stats.effectTextureBytes - filtered.stats.bloomTextureBytes) * 12 === blurred.stats.effectTextureBytes * 20),
      "DOF/Bloom intermediate cost missing", { before: blurred.stats, after: filtered.stats });
    if (!wide && !lightShafts) {
    const legacy = await draw({ ...base, composition: "legacy", depthOfField, bloom });
    check(difference(legacy.data, filtered.data, 3) > 5, "reference did not distinguish legacy pre-DOF Bloom");
    }
    const zero = await draw({ ...base, depthOfField, bloom: { ...bloom, strength: 0 } });
    check(difference(zero.data, blurred.data, 1) === 0 && zero.stats.effectTextureBytes === blurred.stats.effectTextureBytes,
      "zero Bloom changed image or retained intermediate target");
    const visible = await draw({ ...base, depthOfField, bloom: { ...bloom, threshold: 0 } });
    check(difference(visible.data, filtered.data, 3) > 5, "separated Bloom was disabled instead of evaluating threshold");
    const all = { ...base, depthOfField, bloom, ambientOcclusion: { strength: 1, radius: 4, bias: 0.1 } };
    const before = await draw(all), warm = await draw(all);
    check(before.resources.estimatedBytes === warm.resources.estimatedBytes, "composition reference warm resource growth");
    let recovery;
    if (backend === "webgpu") {
      const device = renderer.gpuDevice(); device.destroy(); await device.lost; await Promise.resolve();
      check(await renderer.recoverDevice(), "composition device recovery failed"); watch();
      const restored = await draw(all);
      check(difference(before.data, restored.data, 2) === 0, "separated MRT/DOF recovery changed pixels");
      recovery = { differentPixels: difference(before.data, restored.data, 2), effectDrawCalls: restored.stats.effectDrawCalls };
    }
    canvas.style.width = "40px"; canvas.style.height = "24px"; renderer.resize();
    let size = renderer.viewportSize(); engine.setViewportSize(size.width, size.height); await draw(all);
    canvas.style.width = "32px"; canvas.style.height = "32px"; renderer.resize();
    size = renderer.viewportSize(); engine.setViewportSize(size.width, size.height);
    const resized = await draw(all); check(difference(before.data, resized.data, 2) === 0, "composition resize/DPR restoration changed pixels");
    check(errors.length === 0, "composition reference GPU errors", errors);
    return { backend, colorManagement, wide, heightFog, lightShafts, sharpPeak: peak(sharp.data), blurredPeak: peak(blurred.data), bloomAfterDof: true, zeroIdentity: true, resize: true, recovery };
  } finally {
    engine?.destroy(); renderer?.destroy(); window.disposeSpatialGpuTarget?.(canvas); canvas.remove();
    const resources = renderer?.resourceStats();
    if (resources) for (const key of ["textureCount", "bufferCount", "programCount", "renderTargetCount"]) check(resources[key] === 0, "composition reference resource leak", { key, resources });
  }
}
