import { createKtx2Transcoder, WebGL2Renderer } from "@ferrum2d/ferrum-web/core";
import { sceneCommands } from "./data-scene-render-fixture.mjs";

const root = "/tests/fixtures/ktx2/";
function assert(value, message) { if (!value) throw new Error(message); }
async function aborted(promise) {
  try { await promise; } catch (error) { assert(error.name === "AbortError", error.stack); return; }
  throw new Error("Cancelled texture load unexpectedly succeeded");
}
function psnr(actual, expected) {
  let squared = 0;
  for (let i = 0; i < actual.length; i++) squared += (actual[i] - expected[i]) ** 2;
  return squared === 0 ? 100 : 10 * Math.log10(255 ** 2 / (squared / actual.length));
}

async function run() {
  const liveWorkers = new Set();
  const NativeWorker = globalThis.Worker;
  globalThis.Worker = class extends NativeWorker {
    constructor(...args) { super(...args); liveWorkers.add(this); }
    terminate() { liveWorkers.delete(this); return super.terminate(); }
  };
  const output = await sceneCommands([{ rect: [0, 0, 128, 128] }], 1);
  const dense = await sceneCommands(Array.from({ length: 1024 }, (_, i) => ({ rect: [(i % 32) * 4, Math.floor(i / 32) * 4, 4, 4] })), 1);
  const reports = [];
  try {
    for (const colorManagement of ["legacy", "linear-srgb"]) {
      const canvas = document.createElement("canvas");
      document.body.appendChild(canvas);
      const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
      const compressedUploads = [];
      const upload = gl.compressedTexImage2D.bind(gl);
      gl.compressedTexImage2D = (...args) => { compressedUploads.push({ format: args[2], bytes: args[6].byteLength }); upload(...args); };
      const fallbacks = [];
      const renderer = new WebGL2Renderer(canvas, { colorManagement, preserveDrawingBuffer: true,
        clearColor: [0, 0, 0, 1], onKtx2Fallback: (info) => fallbacks.push(String(info.reason)) });
      const draw = (commands = output) => {
        renderer.render(); renderer.renderCommands(commands); renderer.renderPostProcess();
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        assert(gl.getError() === gl.NO_ERROR, "WebGL error");
        return pixels;
      };
      try {
        const pngStart = performance.now();
        await renderer.loadTexture(1, root + "atlas.png");
        const pngLoadMs = performance.now() - pngStart;
        const reference = draw();
        const pngBytes = renderer.resourceStats().textureBytes;
        for (const variant of ["etc1s", "uastc"]) {
          const before = compressedUploads.length;
          const start = performance.now();
          await renderer.loadTexture(1, root + "atlas.png", { ktx2Url: root + `atlas-${variant}.ktx2` });
          const loadMs = performance.now() - start;
          assert(compressedUploads.length === before + 1, `compressed path not used: ${fallbacks.join("; ")}`);
          const score = psnr(draw(), reference);
          assert(score >= (variant === "uastc" ? 35 : 28), `KTX2 pixel quality/orientation: ${score}`);
          assert(renderer.resourceStats().textureBytes === pngBytes - 512 * 512 * 4 + 512 * 512, "compressed memory estimate");
          const uploaded = compressedUploads[compressedUploads.length - 1];
          assert(uploaded.bytes === 262144, "GPU block bytes");
          draw(dense);
          assert(renderer.stats().renderCommandCount === 1024 && renderer.stats().drawCalls === (colorManagement === "legacy" ? 1 : 2), "render scale/cost");
          reports.push({ colorManagement, variant, pngLoadMs, loadMs, psnr: score, ...uploaded });
        }
        assert(liveWorkers.size === 1, "one shared decoder worker per renderer");
        // Malformed input returns to the ordinary image and releases the old compressed texture.
        await renderer.loadTexture(1, root + "atlas.png", { ktx2Url: "data:application/octet-stream;base64," + btoa("\0".repeat(80)) });
        assert(fallbacks.length === 1, "malformed fallback notification");
        assert(psnr(draw(), reference) === 100, "malformed fallback pixels");
        assert(renderer.resourceStats().textureBytes === pngBytes, "fallback RGBA storage");
        // Simulate a device without compressed texture formats, through the real capability boundary.
        const getParameter = gl.getParameter.bind(gl);
        gl.getParameter = (name) => name === gl.COMPRESSED_TEXTURE_FORMATS ? new Uint32Array() : getParameter(name);
        await renderer.loadTexture(1, root + "atlas.png", { ktx2Url: root + "atlas-uastc.ktx2" });
        gl.getParameter = getParameter;
        assert(fallbacks.length === 2, "unsupported format fallback");
        assert(psnr(draw(), reference) === 100, "unsupported fallback pixels");
        // Managed alpha is compared against the normal PNG in the same color pipeline.
        await renderer.loadTexture(1, root + "alpha.png");
        const alphaReference = draw();
        const beforeAlpha = compressedUploads.length;
        await renderer.loadTexture(1, root + "alpha.png", { ktx2Url: root + "alpha.ktx2" });
        if (colorManagement === "legacy") {
          assert(compressedUploads.length === beforeAlpha && fallbacks.length === 3, "legacy alpha fallback contract");
          assert(psnr(draw(), alphaReference) === 100, "legacy alpha fallback pixels");
        } else {
          assert(compressedUploads.length === beforeAlpha + 1, "managed alpha compressed upload");
          assert(psnr(draw(), alphaReference) > 35, "managed alpha pixels");
        }
        const cancel = new AbortController();
        const pending = renderer.loadTexture(2, root + "atlas.png", { ktx2Url: root + "atlas-uastc.ktx2", signal: cancel.signal });
        cancel.abort();
        await aborted(pending);
        assert(!renderer.evictTexture(2), "cancelled ID must not be registered");
        const late = renderer.loadTexture(3, root + "atlas.png", { ktx2Url: root + "atlas-uastc.ktx2" });
        renderer.destroy();
        await aborted(late);
        renderer.destroy();
        assert(renderer.resourceStats().estimatedBytes === 0, "renderer resources after destroy");
        assert(liveWorkers.size === 0, "renderer decoder worker release");
      } finally { renderer.destroy(); canvas.remove(); }
    }
    // Direct decoder lifecycle uses the real worker and preserves caller input ownership.
    const decoder = createKtx2Transcoder();
    const bytes = new Uint8Array(await (await fetch(root + "atlas-uastc.ktx2")).arrayBuffer());
    const controller = new AbortController();
    const decoding = decoder.transcode(bytes, { format: "bc7", srgb: true, allowAlpha: true, maxDimension: 1024, signal: controller.signal });
    controller.abort();
    await aborted(decoding);
    assert(bytes.byteLength > 0 && liveWorkers.size === 0, "decode cancellation ownership");
    decoder.destroy();
    return { status: "passed", dataSceneState: "playing", floatsPerCommand: output.floatsPerCommand,
      commandCount: dense.commandCount, liveWorkers: liveWorkers.size, reports };
  } finally { for (const worker of liveWorkers) worker.terminate(); globalThis.Worker = NativeWorker; }
}
run().then((report) => { globalThis.ktx2Smoke = report; },
  (error) => { globalThis.ktx2Smoke = { error: error.stack ?? String(error) }; });
