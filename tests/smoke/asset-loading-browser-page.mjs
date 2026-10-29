import { createFerrumRuntime, preloadAssetManifest } from '@ferrum2d/ferrum-web/core';
import { applyDataSceneAuthoringDocument } from '@ferrum2d/ferrum-web/authoring';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function rejected(promise, name) {
  try { await promise; } catch (error) {
    assert(name === undefined || error.name === name, `expected ${name}, got ${error}`);
    return String(error);
  }
  throw new Error('expected rejection');
}
async function until(predicate) {
  const deadline = performance.now() + 5000;
  while (!predicate()) {
    assert(performance.now() < deadline, 'timed out waiting for request start');
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

async function run() {
  const originalFetch = globalThis.fetch;
  let active = 0, peak = 0;
  let requests = [];
  // Observe real HTTP requests, including cancellation, without replacing their responses.
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('/asset/')) return originalFetch(url, options);
    requests.push(String(url)); active++; peak = Math.max(peak, active);
    try { return await originalFetch(url, options); } finally { active--; }
  };
  const canvas = document.querySelector('canvas');
  let completeFrame;
  const runtime = await createFerrumRuntime({ canvas,
    webgl2: { preserveDrawingBuffer: true, clearColor: [0, 0, 0, 1] },
    onFrame(frame) { runtime.stop(); completeFrame(frame); },
  });
  const gl = canvas.getContext('webgl2');
  const count = () => runtime.renderer.resourceStats().textureCount;
  const asset = (name, delay = 60) => `/asset/${name}?delay=${delay}`;
  try {
    const initial = count();
    const progress = [];
    const loaded = await runtime.engine.loadAssets({
      textures: { player: asset('player.png'), enemy: asset('enemy.png') },
      sounds: { hit: asset('hit.wav') }, json: { config: asset('config.json') },
    }, p => progress.push(p.loaded), { concurrency: 2 });
    assert(peak === 2 && active === 0 && requests.length === 4, 'shared network concurrency limit');
    assert(progress.join() === '0,1,2,3,4', 'monotonic progress');
    assert(loaded.json.config.ok && runtime.assetHost.hasSound(runtime.engine.soundId('hit')), 'decoded JSON and audio');
    assert(count() === initial + 2, 'two uploaded textures');
    const networkPeak = peak;
    runtime.engine.useDataScene();
    applyDataSceneAuthoringDocument(runtime.engine, {
      format: 'ferrum2d.consumer.scene-authoring', version: 1,
      sceneComposition: { initialFragment: 'main', prefabs: { sprite: {} }, fragments: {
        main: { instances: ['player', 'enemy'].map((texture, i) => ({ id: texture, prefab: 'sprite',
          x: runtime.engine.cameraX() - 24 + i * 48, y: runtime.engine.cameraY(),
          props: { components: { sprite: { texture, width: 32, height: 32 }, collider: 'none', layer: 'wall' } },
        })) },
      } }, behaviorRecipes: { entities: {} },
    }, { activateDataScene: false });
    const frame = await new Promise(resolve => { completeFrame = resolve; runtime.start(); });
    assert(runtime.engine.dataSceneState() === 'playing' && frame.rendererStats.renderCommandCount === 2, 'real Rust scene');
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 100) colored++;
    assert(colored > 100, 'loaded images must actually render');

    requests = []; peak = 0;
    const controller = new AbortController();
    const cancelledProgress = [];
    const manifest = { textures: { cancelA: asset('player.png', 400), cancelB: asset('enemy.png', 400) },
      sounds: { cancelSound: asset('hit.wav', 400) }, json: { queued: asset('config.json', 400) } };
    const baseline = count();
    const cancelled = rejected(runtime.engine.loadAssets(manifest, p => cancelledProgress.push(p.loaded),
      { concurrency: 3, signal: controller.signal }), 'AbortError');
    await until(() => requests.length === 3);
    controller.abort(); await cancelled;
    assert(requests.length === 3 && active === 0 && cancelledProgress.join() === '0', 'cancel queue/progress');
    assert(count() === baseline && !runtime.assetHost.hasSound(runtime.engine.soundId('cancelSound')), 'no late resources');
    await runtime.engine.loadAssets(manifest, undefined, { concurrency: 3 });
    assert(count() === baseline + 2 && runtime.assetHost.hasSound(runtime.engine.soundId('cancelSound')), 'retry same IDs succeeds');

    requests = [];
    const failedProgress = [];
    const beforeFailure = count();
    const failure = await rejected(runtime.engine.loadAssets({ textures: { failA: asset('player.png', 400), failB: asset('enemy.png', 400) },
      json: { broken: asset('fail.json', 0), queued: asset('config.json') } }, p => failedProgress.push(p.loaded), { concurrency: 3 }));
    assert(failure.includes('HTTP 500') && requests.length === 3 && active === 0, 'first error preserved and siblings cancelled');
    assert(count() === beforeFailure && failedProgress.join() === '0', 'failed batch no late upload/progress');

    requests = [];
    const preloadController = new AbortController();
    const preload = rejected(preloadAssetManifest({ json: { a: asset('config.json', 400), b: asset('config.json', 400), c: asset('config.json') } },
      { concurrency: 2, signal: preloadController.signal }), 'AbortError');
    await until(() => requests.length === 2);
    preloadController.abort(); await preload;
    assert(requests.length === 2 && active === 0, 'preload cancellation reaches real fetch');

    requests = [];
    const beforeDestroy = count();
    const destroying = rejected(runtime.engine.loadAssets({ textures: { destroyed: asset('player.png', 400), queued: asset('enemy.png') } }), 'AbortError');
    await until(() => requests.length === 1);
    runtime.engine.destroy(); await destroying;
    assert(requests.length === 1 && active === 0 && count() === beforeDestroy, 'engine destroy cancels without freeing shared host resources');
    runtime.destroy();
    assert(count() === 0, 'runtime cleanup');
    return { status: 'passed', networkPeak, renderCommands: 2, coloredPixels: colored,
      cancelled: true, retried: true, failedBatchCancelled: true, preloadCancelled: true, engineDestroyCancelled: true, finalTextureCount: count() };
  } finally {
    runtime.destroy(); globalThis.fetch = originalFetch;
  }
}
run().then(result => { globalThis.assetLoadingSmoke = result; }, error => { globalThis.assetLoadingSmoke = { error: String(error), stack: error.stack }; });
