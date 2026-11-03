import { createRenderer, createFerrumRuntime, createDataSceneView, AssetLoader } from '@ferrum2d/ferrum-web/core';
import { pixels } from './flat-pixel-perfect-fixture.mjs';

const check = (value, message) => { if (!value) throw Error('pixel snap: ' + message); };
const config = { width: 32, height: 24 };
const lighting = { enabled: true, ambient: [.1, .1, .1, 1], pointLights: [{ x: 14, y: 8, radius: 24, height: 12, color: [1, .8, .6, 1], intensity: 1, falloff: 1 }] };
const difference = (a, b) => a.reduce((count, value, index) => count + (value !== b[index] ? 1 : 0), 0);
function texture(normal = false) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
  const data = new Uint8ClampedArray(64);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++)
    data.set(normal ? [(x & 1) ? 200 : 56, (y & 1) ? 180 : 76, 220, 255] : [(x & 1) ? 240 : 30, (y & 1) ? 220 : 20, 100, 255], (y * 4 + x) * 4);
  canvas.getContext('2d').putImageData(new ImageData(data, 4, 4), 0, 0);
  return canvas.toDataURL();
}
async function virtualPixels(renderer, canvas) {
  const data = await pixels(renderer, canvas), p = renderer.pixelPerfectPresentation();
  const result = new Uint8Array(32 * 24 * 4);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
    const at = ((p.y + Math.floor((y + .5) * p.height / 24)) * p.canvasWidth + p.x + Math.floor((x + .5) * p.width / 32)) * 4;
    result.set(data.subarray(at, at + 4), (y * 32 + x) * 4);
  }
  return result;
}
function sprite(phase, zoom = 1, rotation = 0, mapped = false) {
  return { commandCount: 1, floatsPerCommand: 15,
    buffer: new Float32Array([(3 + phase) / zoom, (3 + phase) / zoom, 5.5 / zoom, 5.5 / zoom, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, rotation]),
    ...(mapped ? { spriteNormalMaterials: { version: 1, stride: 2, buffer: new Uint32Array([2, 0]) } } : {}) };
}
export async function probePixelSnap(preferred) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:160px;height:120px'; canvas.dataset.spatialGpuTarget = 'true'; document.body.append(canvas);
  const renderer = await createRenderer(canvas, { preferred, pixelPerfect: config, webgl2: { preserveDrawingBuffer: true } });
  const device = renderer.gpuDevice?.(), errors = [], cases = [], references = {}, coverage = {};
  const remember = (name, data) => { references[name] = btoa(String.fromCharCode(...data)); };
  check((device ? 'webgpu' : 'webgl2') === preferred, 'unexpected renderer fallback');
  device?.addEventListener('uncapturederror', event => errors.push(event.error.message));
  let reference;
  try {
    await renderer.loadTexture(1, texture()); await renderer.loadTexture(2, texture(true), { colorSpace: 'none' });
    const draw = async commands => {
      const before = commands.buffer.slice();
      renderer.render(); renderer.renderCommands(commands); const stats = renderer.renderPostProcess();
      await renderer.gpuDevice?.().queue.onSubmittedWorkDone();
      check(difference(before, commands.buffer) === 0, 'borrowed command buffer mutated');
      check(stats.drawCalls <= 12 && stats.spriteCount === commands.commandCount, 'render cost/count');
      return virtualPixels(renderer, canvas);
    };
    // Warm lazy lighting resources before comparing steady-state allocation.
    renderer.setLighting(lighting);
    await draw(sprite(.1, 1, 0, true));
    renderer.setLighting(false); await draw(sprite(.1));
    const memory = renderer.resourceStats().textureBytes;
    for (const zoom of [.75, 1, 1.25, 1.37, 2]) {
      renderer.setViewportZoom(zoom);
      renderer.setPixelPerfect(config);
      const offA = await draw(sprite(.1, zoom)), offB = await draw(sprite(.4, zoom));
      check(difference(offA, offB) > 0, `fixture must detect unsnapped subpixel movement at zoom ${zoom}`);
      renderer.setPixelPerfect({ ...config, snap: false });
      check(difference(offA, await draw(sprite(.1, zoom))) === 0, 'explicit off changed old output');
      renderer.setPixelPerfect({ ...config, snap: true });
      const a = await draw(sprite(.1, zoom)), b = await draw(sprite(.4, zoom));
      check(difference(a, b) === 0, `subpixel sprite shimmer at zoom ${zoom}`);
      check(difference(a, offA) > 0, 'snap did not affect the rendered image');
      const rotatedA = await draw(sprite(.1, zoom, .37)), rotatedB = await draw(sprite(.4, zoom, .37));
      check(difference(rotatedA, rotatedB) === 0, 'rotated sprite origin shimmer');
      remember(`sprite-${zoom}`, a); remember(`rotation-${zoom}`, rotatedA);
      cases.push({ zoom, offChangedChannels: difference(offA, offB), snappedChangedChannels: difference(a, b), rotatedChangedChannels: difference(rotatedA, rotatedB) });
      reference = a;
    }
    renderer.setViewportZoom(1);
    renderer.setLighting(lighting);
    const mappedA = await draw(sprite(.1, 1, 0, true)), mappedB = await draw(sprite(.4, 1, 0, true));
    check(difference(mappedA, mappedB) === 0, 'normal/color geometry disagree');
    remember('normal-lighting', mappedA);
    // Omitting frame metadata must retain the renderer's configured projection
    // for both the color and normal targets.
    for (const snap of [false, true]) for (const groundYScale of [.25, .5, 1]) {
      renderer.setPixelPerfect({ ...config, snap }); renderer.setGroundYScale(groundYScale);
      const projected = sprite(.1, 1, 0, true); projected.buffer[13] = 4;
      const explicitProjection = await draw({ ...projected, groundYScale });
      const retainedProjection = await draw(projected);
      check(difference(explicitProjection, retainedProjection) === 0, 'normal pass lost retained ground projection');
      remember(`projection-${snap}-${groundYScale}`, retainedProjection);
      // Measure actual coverage with the same projected geometry, independent
      // of normal data/UVs. Legacy rasterizers can disagree at half-pixel edges.
      renderer.setLighting(false);
      const rectangle = { ...projected, buffer: projected.buffer.slice(), spriteNormalMaterials: undefined }; rectangle.buffer[13] = 20;
      const maskPixels = await draw(rectangle), mask = new Uint8Array(32 * 24);
      for (let i = 0; i < mask.length; i++) mask[i] = maskPixels[i * 4] === 255 ? 255 : 0;
      check(mask.some(value => value === 255), 'projected fixture contains no visible sprite');
      if (snap) {
        const left = Math.floor(Math.fround(3.1) + .5), right = Math.floor(Math.fround(3.1) + 5.5 + .5);
        const top = Math.floor(Math.fround(3.1) + 2.75 * (1 - groundYScale) + .5);
        const bottom = Math.floor(Math.fround(3.1) + 2.75 * (1 + groundYScale) + .5);
        for (let i = 0; i < mask.length; i++) {
          const inside = i % 32 >= left && i % 32 < right && Math.floor(i / 32) >= top && Math.floor(i / 32) < bottom;
          check(mask[i] === (inside ? 255 : 0), 'snapped projection disagrees with its pixel rectangle');
        }
      }
      coverage[`projection-${snap}-${groundYScale}`] = btoa(String.fromCharCode(...mask));
      renderer.setLighting(lighting);
    }
    renderer.setGroundYScale(1);
    renderer.setLighting(false);
    for (const rotation of [Math.PI / 2, -Math.PI / 2, Math.PI])
      remember(`quarter-turn-${rotation}`, await draw(sprite(.1, 1, rotation)));
    const flipped = sprite(.1); flipped.buffer.set([1, 1, 0, 0], 4);
    remember('flipped-uv', await draw(flipped));
    const circle = sprite(.1); circle.buffer[13] = 8;
    remember('circle-particle', await draw(circle));
    renderer.setSpriteMaterial({ outline: { thickness: .35, color: [1, .2, .1, 1] } });
    remember('material-offset', await draw(sprite(.1)));
    check(renderer.stats().drawCalls === 6, 'fractional material passes were not exercised');
    renderer.setSpriteMaterial(undefined);
    const canonical = sprite(.1), legacy = { commandCount: 1, floatsPerCommand: 13, buffer: canonical.buffer.slice(0, 13) };
    const legacyPixels = await draw(legacy);
    check(difference(legacyPixels, await draw(canonical)) === 0, 'legacy 13-float commands lost snap compatibility');
    remember('legacy-stride', legacyPixels);
    if (preferred === 'webgl2') {
      renderer.setSpriteScreenOffset(.05, .05); const shakeA = await draw(sprite(.1));
      renderer.setSpriteScreenOffset(.15, .15); const shakeB = await draw(sprite(.1));
      renderer.setSpriteScreenOffset(0, 0);
      check(difference(shakeA, shakeB) === 0, 'screen shake bypassed pixel snapping');
    }
    // Fractional screen-space tile extents exercise shared edges, including offscreen origins.
    for (const zoom of [1, 1.25, 1.37]) for (const phase of [.1, .4, .6, .9]) {
      renderer.setViewportZoom(zoom);
      const words = [];
      for (let y = -1; y < 8; y++) for (let x = -1; x < 12; x++)
        words.push(x * 4.2 - phase, y * 4.2 - phase, 4.2, 4.2, 0, 0, 1, 1, .7, .5, .3, 1, 1, 16, 0);
      const data = await draw({ commandCount: words.length / 15, floatsPerCommand: 15, buffer: new Float32Array(words) });
      for (let i = 0; i < data.length; i += 4) check(data[i] > 100 && data[i + 1] > 50, `tile seam at pixel ${i / 4}, zoom ${zoom}, phase ${phase}`);
    }
    renderer.setViewportZoom(1);
    renderer.setPixelPerfect(config);
    check(renderer.resourceStats().textureBytes === memory, 'snap toggle leaked virtual targets');
    renderer.setPixelPerfect({ ...config, snap: true });
    const before = JSON.stringify(renderer.pixelPerfectPresentation());
    let rejected = false; try { renderer.setPixelPerfect({ ...config, snap: 'on' }); } catch { rejected = true; }
    check(rejected && JSON.stringify(renderer.pixelPerfectPresentation()) === before, 'invalid snap changed live settings');
    if (preferred === 'webgl2') {
      renderer.setPixelPerfect(config); const unsnapped = await draw(sprite(.1));
      renderer.setPixelPerfect({ ...config, snap: true }); const snapped = await draw(sprite(.1));
      const target = renderer.createRenderTexture(50, { width: 32, height: 24, filter: 'nearest' });
      try {
        renderer.render(); renderer.renderToTexture(target, sprite(.1), { viewport: { width: 32, height: 24 }, clearColor: [unsnapped[0] / 255, unsnapped[1] / 255, unsnapped[2] / 255] });
        renderer.renderCommands({ commandCount: 1, floatsPerCommand: 15, buffer: new Float32Array([0, 0, 32, 24, 0, 0, 1, 1, 1, 1, 1, 1, 50, 0, 0]) }); renderer.renderPostProcess();
        check(difference(unsnapped, await virtualPixels(renderer, canvas)) === 0, 'screen snapping leaked into RenderTexture');
        check(difference(snapped, await draw(sprite(.1))) === 0, 'RenderTexture did not restore screen snapping');
      } finally { renderer.destroyRenderTexture(target); }
    }
    const words = []; for (let i = 0; i < 1024; i++) words.push((i % 32) + .2, Math.floor(i / 32) + .2, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 16, 0);
    await draw({ commandCount: 1024, floatsPerCommand: 15, buffer: new Float32Array(words) });
    check(renderer.stats().drawCalls === 2, 'snap broke batching');
    if (device) {
      renderer.setLighting(lighting);
      const beforeLoss = await draw(sprite(.1, 1, 0, true));
      device.destroy(); await device.lost;
      check(await renderer.recoverDevice(), 'device recovery failed');
      renderer.gpuDevice().addEventListener('uncapturederror', event => errors.push(event.error.message));
      check(renderer.pixelPerfectPresentation().settings.snap === true, 'recovery lost snap setting');
      check(difference(beforeLoss, await draw(sprite(.1, 1, 0, true))) === 0, 'recovery changed snapped normal-lit image');
    }
    check(!errors.length, errors.join('\n'));
    return { preferred, ok: true, cases, tileSeamCases: 12, normalAlignment: true, commandBufferUnchanged: true, batchedSprites: 1024,
      renderTextureIsolated: preferred === 'webgl2', deviceRecovery: !!device, retainedGroundProjection: true,
      references, coverage, reference: btoa(String.fromCharCode(...reference)) };
  } finally {
    renderer.destroy(); const left = renderer.resourceStats();
    check(left.textureCount === 0 && left.bufferCount === 0 && left.programCount === 0, 'GPU resources leaked');
    window.disposeSpatialGpuTarget?.(canvas); canvas.remove();
  }
}

export async function probeNativePixelSnap(preferred) {
  const canvas = document.createElement('canvas'); canvas.style.cssText = 'display:block;width:160px;height:120px'; canvas.dataset.spatialGpuTarget = 'true'; document.body.append(canvas);
  const renderer = await createRenderer(canvas, { preferred, webgl2: { preserveDrawingBuffer: true } }), loader = new AssetLoader(renderer);
  await loader.loadAssets({ textures: { hero: texture() } });
  const scene = { format: 'ferrum2d.consumer.scene-authoring', version: 1, display: { pixelPerfect: { ...config, snap: true } }, behaviorRecipes: { entities: {} },
    sceneComposition: { initialFragment: 'main', prefabs: { object: {} }, fragments: { main: { instances: [{ id: 'hero', prefab: 'object', x: 800, y: 480, props: { components: { visual: { kind: 'sprite', texture: 'hero', width: 5.5, height: 5.5 }, collider: 'none', layer: 'wall' } } }] } } } };
  let frame;
  const runtime = await createFerrumRuntime({ canvas, renderer, assetHost: loader, dataScene: scene, autostart: false, onFrame: value => { frame = value.frame; } });
  const raf = requestAnimationFrame, cancel = cancelAnimationFrame, pending = new Map(); let serial = 0, time = 0;
  globalThis.requestAnimationFrame = callback => { pending.set(++serial, callback); return serial; }; globalThis.cancelAnimationFrame = id => pending.delete(id);
  const pump = () => { time += 16; const callbacks = [...pending.values()]; pending.clear(); check(callbacks.length > 0, 'missing native runtime frame'); for (const callback of callbacks) callback(time); };
  try {
    runtime.start(); pump(); pump(); check(runtime.dataScene.state() === 'playing' && frame.entityCount === 1, 'native Playing scene missing');
    runtime.dataScene.pause();
    const view = createDataSceneView(runtime.engine, renderer, canvas);
    const drawCamera = async x => { view.setCamera({ x, y: 480.1 }); pump(); return virtualPixels(renderer, canvas); };
    const a = await drawCamera(800.1), commandX = frame.renderCommandBuffer.buffer[0];
    const b = await drawCamera(800.2);
    check(difference(a, b) === 0, 'native subpixel camera shimmer');
    check(Math.abs(commandX - frame.renderCommandBuffer.buffer[0]) > .05, 'native commands were snapped or camera did not move');
    const signature = () => JSON.stringify({ time: runtime.engine.time(), camera: [runtime.engine.cameraX(), runtime.engine.cameraY()], entities: runtime.engine.entityCount(), state: runtime.dataScene.state(), source: runtime.dataScene.document(), commands: [...frame.renderCommandBuffer.buffer] });
    const original = signature();
    renderer.setPixelPerfect({ ...config, snap: false }); renderer.render(); renderer.renderCommands(frame.renderCommandBuffer); renderer.renderPostProcess();
    check(signature() === original, 'render-only setting changed simulation/source/borrowed commands');
    const offA = await drawCamera(800.1), offB = await drawCamera(800.2);
    check(difference(offA, offB) > 0, 'native fixture cannot detect shimmer');
    return { preferred, nativeCamera: true, nativeCommandDelta: Math.abs(commandX - frame.renderCommandBuffer.buffer[0]), snappedChangedChannels: difference(a, b), offChangedChannels: difference(offA, offB), simulationUnchanged: true };
  } finally {
    runtime.destroy(); renderer.destroy(); globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = cancel;
    window.disposeSpatialGpuTarget?.(canvas); canvas.remove();
  }
}
