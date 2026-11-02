import {createRenderer, createFerrumRuntime} from '@ferrum2d/ferrum-web/core';
import {pixels} from './flat-pixel-perfect-fixture.mjs';

const check = (value, label) => { if (!value) throw Error(label); };
const config = {width: 320, height: 180};
const empty = {
  format: 'ferrum2d.consumer.scene-authoring', version: 1,
  display: {pixelPerfect: config}, behaviorRecipes: {entities: {}},
  sceneComposition: {initialFragment: 'main', prefabs: {}, fragments: {main: {instances: []}}},
};

/** Fault injection wraps real GPU allocations; scene/camera operations use native Wasm. */
export async function probeFlatPixelEdges(preferred) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:713px;height:471px;display:block';
  canvas.dataset.spatialGpuTarget = 'true'; document.body.append(canvas);
  const renderer = await createRenderer(canvas, {
    preferred, pixelPerfect: config,
    webgl2: {preserveDrawingBuffer: true, clearColor: [.2, .3, .4, .25]},
    webgpu: {clearColor: [.2, .3, .4, .25]},
  });
  const results = [], errors = [];
  const device = preferred === 'webgpu' ? renderer.gpuDevice() : undefined;
  device?.addEventListener('uncapturederror', event => errors.push(event.error.message));
  let runtime;
  async function run(name, callback) {
    try { await callback(); results.push({name, ok: true}); }
    catch (error) { results.push({name, ok: false, error: String(error)}); }
  }
  async function finish() {
    renderer.renderPostProcess(); await device?.queue.onSubmittedWorkDone();
  }
  try {
    await run('opaque transparent-clear presentation', async () => {
      renderer.render(); await finish();
      const p = renderer.pixelPerfectPresentation(), data = await pixels(renderer, canvas);
      const at = (p.y * p.canvasWidth + p.x) * 4;
      check(data[at + 3] === 255, `alpha ${data[at + 3]}, expected 255`);
    });
    await run('repeated finalization does not draw or accumulate fade', async () => {
      renderer.setPostProcess([{kind: 'fade', color: [1, 0, 0, .25]}]);
      renderer.render(); const first = renderer.renderPostProcess(), second = renderer.renderPostProcess();
      check(second.drawCalls === first.drawCalls, `extra post-process draw ${first.drawCalls} -> ${second.drawCalls}`);
      renderer.setPostProcess(undefined);
    });
    renderer.setPostProcess(undefined);
    if (preferred === 'webgl2') {
      // Scene, two scratch targets, final output: fail each allocation in turn.
      renderer.setPostProcess([{kind: 'fade', color: [1, 0, 0, .1]}, {kind: 'fade', color: [0, 0, 1, .1]}]);
      renderer.render(); await finish();
      for (const failAt of [1, 2, 3, 4]) {
        await run(`GL allocation ${failAt} failure preserves the complete old frame`, async () => {
          const gl = canvas.getContext('webgl2');
          const original = {allocate: gl.texImage2D, create: gl.createTexture, remove: gl.deleteTexture,
            framebuffer: gl.createFramebuffer, deleteFramebuffer: gl.deleteFramebuffer};
          const before = JSON.stringify(renderer.pixelPerfectPresentation()), memory = renderer.resourceStats().textureBytes;
          const oldPixels = await pixels(renderer, canvas), textures = new Set(), framebuffers = new Set();
          let allocations = 0, failed = false;
          gl.createTexture = function () { const item = original.create.call(this); textures.add(item); return item; };
          gl.deleteTexture = function (item) { textures.delete(item); return original.remove.call(this, item); };
          gl.createFramebuffer = function () { const item = original.framebuffer.call(this); framebuffers.add(item); return item; };
          gl.deleteFramebuffer = function (item) { framebuffers.delete(item); return original.deleteFramebuffer.call(this, item); };
          gl.texImage2D = function (...args) {
            if (++allocations === failAt) throw Error('injected virtual allocation failure');
            return original.allocate.apply(this, args);
          };
          try { renderer.setPixelPerfect({width: 160, height: 90}); }
          catch (error) { failed = /injected/.test(String(error)); }
          finally {
            gl.texImage2D = original.allocate; gl.createTexture = original.create; gl.deleteTexture = original.remove;
            gl.createFramebuffer = original.framebuffer; gl.deleteFramebuffer = original.deleteFramebuffer;
          }
          check(failed, 'allocation failure was not injected');
          check(JSON.stringify(renderer.pixelPerfectPresentation()) === before, 'display changed after allocation failure');
          check(renderer.resourceStats().textureBytes === memory, 'old resource allocation changed');
          check(textures.size === 0 && framebuffers.size === 0, 'candidate GPU resources leaked');
          const currentPixels = await pixels(renderer, canvas);
          check(currentPixels.every((value, index) => value === oldPixels[index]), 'old image was destroyed');
          renderer.render(); await finish(); check(gl.getError() === 0, 'next frame failed');
        });
        renderer.setPixelPerfect(config);
      }
      renderer.setPostProcess(undefined);
    } else {
      await run('GPU bind group failure preserves old target and settings', async () => {
        const bind = device.createBindGroup, before = JSON.stringify(renderer.pixelPerfectPresentation());
        const memory = renderer.resourceStats().textureBytes; let failed = false;
        device.createBindGroup = () => { throw Error('injected virtual bind group failure'); };
        try { renderer.setPixelPerfect({width: 160, height: 90}); }
        catch (error) { failed = /injected/.test(String(error)); }
        finally { device.createBindGroup = bind; }
        check(failed, 'bind group failure was not injected');
        check(JSON.stringify(renderer.pixelPerfectPresentation()) === before, 'GPU display changed');
        check(renderer.resourceStats().textureBytes === memory, 'GPU candidate texture leaked');
        renderer.render(); await finish();
      });
    }
    await run('maximum one-megapixel virtual target renders within the canvas', async () => {
      renderer.setPixelPerfect({width: 2048, height: 512}); renderer.render(); await finish();
      const p = renderer.pixelPerfectPresentation();
      check(p.width <= canvas.width && p.height <= canvas.height && p.sourceWidth === 2048, 'maximum target layout');
      check(renderer.resourceStats().textureBytes >= 2048 * 512 * 4, 'maximum allocation missing from metrics');
    });
    renderer.setPixelPerfect(config);
    await run('hidden canvas preserves legacy size and enabled presentation stays valid', async () => {
      renderer.setPixelPerfect(false); canvas.style.width = canvas.style.height = '0px'; renderer.resize();
      check(canvas.width === (preferred === 'webgl2' ? 0 : 1), 'legacy hidden backbuffer changed');
      renderer.setPixelPerfect(config); check(canvas.width === 1 && renderer.pixelPerfectPresentation().integerScale === false, 'hidden virtual target');
      canvas.style.width = '713px'; canvas.style.height = '471px'; renderer.resize();
    });
    runtime = await createFerrumRuntime({canvas, renderer, dataScene: empty, autostart: false});
    await run('failed scene display change preserves bounded camera', async () => {
      check(runtime.engine.setDataSceneCamera({x: 830, y: 500, bounds: {minX: 0, minY: 0, maxX: 1000, maxY: 1000}}), 'camera setup rejected');
      const before = {x: runtime.engine.cameraX(), y: runtime.engine.cameraY(), viewport: renderer.viewportSize()};
      const bad = structuredClone(empty); bad.display.pixelPerfect = {width: 800, height: 480}; bad.sceneComposition.initialFragment = 'missing';
      let failed = false; try { runtime.dataScene.reapply(bad); } catch { failed = true; }
      check(failed, 'invalid document accepted');
      check(runtime.engine.cameraX() === before.x && runtime.engine.cameraY() === before.y,
        `camera changed from ${before.x},${before.y} to ${runtime.engine.cameraX()},${runtime.engine.cameraY()}`);
      check(JSON.stringify(renderer.viewportSize()) === JSON.stringify(before.viewport), 'viewport changed');
      check(runtime.dataScene.state() === 'playing' && runtime.dataScene.document().display.pixelPerfect.width === 320, 'previous scene not preserved');
    });
    await run('GPU validation stays clean', async () => { await device?.queue.onSubmittedWorkDone(); check(!errors.length, errors.join('\n')); });
    return {preferred, ok: results.every(item => item.ok), results};
  } finally {
    runtime?.destroy(); renderer.destroy();
    const remaining = renderer.resourceStats();
    check(remaining.textureCount === 0 && remaining.bufferCount === 0 && remaining.programCount === 0, 'edge probe resources leaked');
    window.disposeSpatialGpuTarget?.(canvas); canvas.remove();
  }
}
