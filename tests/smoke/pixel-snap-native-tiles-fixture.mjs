import { createRenderer, createFerrumRuntime } from '@ferrum2d/ferrum-web/core';
import { pixels } from './flat-pixel-perfect-fixture.mjs';

const check = (value, message) => { if (!value) throw Error('native tile snap: ' + message); };
/** Exercise Rust tilemap/rendering.rs; snapshot edits are setup-only and use named ABI accessors. */
export async function probeNativeTileSnap(preferred) {
  const canvas = document.createElement('canvas'); canvas.style.cssText = 'display:block;width:160px;height:120px'; canvas.dataset.spatialGpuTarget = 'true'; document.body.append(canvas);
  const renderer = await createRenderer(canvas, { preferred, pixelPerfect: { width: 32, height: 24, snap: true }, webgl2: { preserveDrawingBuffer: true } });
  const image = document.createElement('canvas'); image.width = image.height = 1;
  const ctx = image.getContext('2d'); ctx.fillStyle = 'rgb(180,140,100)'; ctx.fillRect(0, 0, 1, 1);
  await renderer.loadTexture(3, image.toDataURL());
  let frame;
  const runtime = await createFerrumRuntime({ canvas, renderer, autostart: false, onFrame: value => { frame = value.frame; } });
  const raf = requestAnimationFrame, cancel = cancelAnimationFrame, pending = new Map(); let serial = 0, time = 0;
  globalThis.requestAnimationFrame = callback => { pending.set(++serial, callback); return serial; }; globalThis.cancelAnimationFrame = id => pending.delete(id);
  const pump = () => { time += 16; const callbacks = [...pending.values()]; pending.clear(); check(callbacks.length > 0, 'missing native frame'); for (const callback of callbacks) callback(time); };
  const phases = [];
  try {
    runtime.engine.setGameSpec({ atlas: { frames: { ground: { texture: 3, uv: { u0: 0, v0: 0, u1: 1, v1: 1 }, size: { width: 1, height: 1 } } } }, tilemap: { tileWidth: 8, tileHeight: 8,
      tiles: { '1': { frame: 'ground' } }, layers: [{ columns: 200, rows: 120, data: Array(24000).fill(1) }] } });
    runtime.start(); pump(); pump();
    const baseline = runtime.engine.captureShooterStateSnapshot(); check(baseline, 'missing native snapshot');
    const accessor = runtime.engine.createBuiltInShooterStateAccessor(), commands = runtime.engine.createRenderCommandAccessor();
    for (const zoom of [1, 1.25, 1.37, 2]) for (const phase of [.1, .2, .5, .9]) {
      renderer.setViewportZoom(zoom);
      const viewport = renderer.viewportSize(); runtime.engine.setViewportSize(viewport.width, viewport.height);
      const mutable = { ...baseline, headerFloats: Float32Array.from(baseline.headerFloats), headerU32s: Uint32Array.from(baseline.headerU32s),
        entityFloats: Float32Array.from(baseline.entityFloats), entityU32s: Uint32Array.from(baseline.entityU32s) };
      accessor.bindMutable(mutable); accessor.gameState = 'title'; accessor.cameraX = 800 + phase; accessor.cameraY = 480 + phase;
      // Built-in frames refresh the follow camera even at Title. Move its
      // actual target too, so all reported fractional phases are exercised.
      check(accessor.selectFirst('player'), 'native camera follow target missing');
      accessor.x = 800 + phase; accessor.y = 480 + phase;
      const snapshot = { ...baseline, ...Object.fromEntries(['headerFloats', 'headerU32s', 'entityFloats', 'entityU32s'].map(key => [key, [...mutable[key]]])) };
      check(runtime.engine.restoreShooterStateSnapshot(snapshot), 'restore rejected camera setup');
      pump();
      check(Math.abs(frame.cameraX - (800 + phase)) < .001 && Math.abs(frame.cameraY - (480 + phase)) < .001,
        'native camera did not apply the requested fractional phase: ' + JSON.stringify({ zoom, phase, frameX: frame.cameraX, frameY: frame.cameraY, engineX: runtime.engine.cameraX(), engineY: runtime.engine.cameraY(), state: frame.gameState }));
      const view = frame.renderCommandBuffer; commands.bind(view); const tileWords = [];
      for (let i = 0; i < view.commandCount; i++) { commands.select(i); if (commands.textureId === 3) tileWords.push(...view.buffer.subarray(i * view.floatsPerCommand, (i + 1) * view.floatsPerCommand)); }
      const count = tileWords.length / view.floatsPerCommand;
      check(count >= 4 && count < 100, 'native tile culling/count: ' + count);
      const before = runtime.engine.captureShooterStateSnapshot();
      renderer.render(); renderer.renderCommands({ ...view, commandCount: count, buffer: new Float32Array(tileWords) }); renderer.renderPostProcess();
      const data = await pixels(renderer, canvas), p = renderer.pixelPerfectPresentation();
      for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
        const at = ((p.y + Math.floor((y + .5) * p.height / 24)) * p.canvasWidth + p.x + Math.floor((x + .5) * p.width / 32)) * 4;
        check(data[at] > 100 && data[at + 1] > 80, `seam at ${x},${y}, zoom ${zoom}, phase ${phase}`);
      }
      check(JSON.stringify(runtime.engine.captureShooterStateSnapshot()) === JSON.stringify(before), 'GPU snapping changed native replay snapshot');
      check(renderer.stats().drawCalls === 2, 'native tiles lost batching');
      phases.push({ zoom, phase, nativeCameraX: runtime.engine.cameraX(), visibleTiles: count, seamPixels: 0 });
    }
    return { preferred, nativeTiles: true, phases, snapshotUnchanged: true };
  } finally {
    runtime.destroy(); renderer.destroy(); globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = cancel;
    window.disposeSpatialGpuTarget?.(canvas); canvas.remove();
  }
}
