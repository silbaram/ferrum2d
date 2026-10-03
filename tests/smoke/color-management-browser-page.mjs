import { AssetLoader, createRenderer, linearToSrgb, WebGL2Renderer } from "@ferrum2d/ferrum-web/core";
import { sceneCommands } from "./data-scene-render-fixture.mjs";

function assert(value, message) { if (!value) throw new Error(message); }
function close(actual, expected, label, tolerance = 2) {
  assert(actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance),
    `${label}: ${actual} expected ${expected}`);
}
const encodeByte = (linear) => Math.round(linearToSrgb(linear) * 255);

function imageUrl(pixels) {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.length;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels.flat()), pixels.length, 1), 0, 0);
  return canvas.toDataURL();
}

async function run() {
  const one = await sceneCommands([{ rect: [0, 0, 128, 128] }], 1);
  const rectangles = Array.from({ length: 1024 }, (_, i) => ({ rect: [i % 32 * 4, Math.floor(i / 32) * 4, 4, 4] }));
  const many = await sceneCommands(rectangles, 1);
  assert(many.floatsPerCommand === 15, "actual Rust ABI");
  const sprite = (id, color = [1, 1, 1, 1]) => {
    const buffer = one.buffer.slice();
    buffer.set(color, 8);
    buffer[12] = id;
    return { ...one, buffer };
  };
  const empty = { buffer: new Float32Array(), commandCount: 0, floatsPerCommand: one.floatsPerCommand };
  const gray = imageUrl([[128, 128, 128, 255]]);
  const ramp = [0, 8, 16, 32, 64, 128, 192, 255];
  const reports = [];
  let cases = 0;
  for (const mode of ["legacy", "linear-srgb"]) {
    const canvas = document.createElement("canvas");
    canvas.style.width = canvas.style.height = "128px";
    document.body.append(canvas);
    const context = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
    assert(context, "WebGL2 unavailable");
    const liveTextures = new Set();
    const liveFramebuffers = new Set();
    let allocations = 0;
    for (const [kind, live] of [["Texture", liveTextures], ["Framebuffer", liveFramebuffers]]) {
      const create = context[`create${kind}`].bind(context);
      const destroy = context[`delete${kind}`].bind(context);
      context[`create${kind}`] = () => { const resource = create(); if (resource) { live.add(resource); allocations++; } return resource; };
      context[`delete${kind}`] = (resource) => { live.delete(resource); destroy(resource); };
    }
    const renderer = new WebGL2Renderer(canvas, { colorManagement: mode, preserveDrawingBuffer: true, clearColor: [0, 0, 0, 1] });
    const gl = canvas.getContext("webgl2");
    const managed = mode === "linear-srgb";
    const loader = new AssetLoader(renderer);
    const assets = await loader.loadAssets({
      textures: {
        white: imageUrl([[255, 255, 255, 255]]), gray, data: gray, linear: gray,
        translucent: imageUrl([[128, 128, 128, 128]]),
        ramp: imageUrl(ramp.map((v) => [v, v, v, 255])),
      },
      textureOptions: { data: { colorSpace: "none" }, linear: { colorSpace: "linear" } },
    });
    const id = (name) => assets.textures.textureId(name);
    const pixel = (x = 64, y = 64) => {
      const value = new Uint8Array(4);
      gl.readPixels(Math.floor(x * canvas.width / 128), Math.floor(y * canvas.height / 128), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value);
      return [...value];
    };
    const draw = (commands, postProcess = [], lighting = false) => {
      renderer.setPostProcess(postProcess);
      renderer.setLighting(lighting);
      renderer.render();
      renderer.renderCommands(commands);
      return renderer.renderPostProcess();
    };
    const expect = (commands, expected, label, passes = [], lighting = false) => {
      draw(commands, passes, lighting);
      close(pixel(), expected, `${mode} ${label}`);
      cases++;
      assert(gl.getError() === gl.NO_ERROR, `${label} WebGL error`);
    };
    expect(sprite(id("gray")), [128, 128, 128, 255], "sRGB texture roundtrip");
    assert(liveFramebuffers.size === (managed ? 1 : 0), "simple output allocated unused scratch targets");
    const raw = managed ? 188 : 128;
    expect(sprite(id("data")), [raw, raw, raw, 255], "data texture skips decode");
    expect(sprite(id("linear")), [raw, raw, raw, 255], "linear input texture");
    expect(sprite(id("white"), [0.5, 0.5, 0.5, 1]), [raw, raw, raw, 255], "numeric working color");
    renderer.setSpriteMaterial({ colorMix: { color: [0, 0, 0, 1], amount: 0.5 } });
    expect(sprite(id("white")), [raw, raw, raw, 255], "material mixes linear numeric RGB");
    renderer.setSpriteMaterial("unlit");
    expect(sprite(id("white"), [1, 1, 1, 0.5]), [raw, raw, raw, managed ? 255 : 191], "linear alpha blend");
    // Legacy keeps its existing premultiplied ImageBitmap upload behavior.
    const translucent = managed ? 93 : 32;
    expect(sprite(id("translucent")), [translucent, translucent, translucent, managed ? 255 : 191], "image alpha is not gamma encoded");
    const faded = managed ? 137 : 64;
    expect(sprite(id("white")), [faded, faded, faded, 255], "two fades encode only at output", [
      { kind: "fade", color: [0, 0, 0], opacity: 0.5 }, { kind: "fade", color: [0, 0, 0], opacity: 0.5 },
    ]);
    const ambient = managed ? 188 : 128;
    expect(sprite(id("white")), [ambient, ambient, ambient, managed ? 255 : 191], "ambient linear blend", [], { ambient: [0, 0, 0, 0.5] });
    const light = managed ? 137 : 64;
    expect(empty, [light, 0, 0, 255], "point light linear intensity", [], {
      pointLights: [{ x: 64, y: 64, radius: 10000, color: [0.5, 0, 0, 1], intensity: 0.5, falloff: 1 }],
    });
    // sRGB 128 is ~0.216 linear and must remain below a 0.5 bloom threshold.
    expect(sprite(id("gray")), [128, 128, 128, 255], "bloom linear threshold", [
      { kind: "bloom", threshold: 0.5, intensity: 1, radius: 1 },
    ]);
    const bright = 0.6 + 0.6 * 0.104 * 0.5;
    const brightByte = managed ? encodeByte(bright) : Math.round(bright * 255);
    expect(sprite(id("white"), [0.6, 0.6, 0.6, 1]), [brightByte, brightByte, brightByte, 255], "bloom above threshold", [
      { kind: "bloom", threshold: 0.5, intensity: 0.5, radius: 1 },
    ]);
    draw(sprite(id("ramp")));
    ramp.forEach((v, i) => close(pixel(i * 16 + 8), [v, v, v, 255], `${mode} dark ramp ${v}`));
    cases++;
    const target = renderer.createRenderTexture(100, { width: 32, height: 32 });
    renderer.setPostProcess([]);
    renderer.setLighting(false);
    renderer.render();
    renderer.renderToTexture(target, sprite(id("gray")));
    renderer.renderCommands(sprite(target.textureId));
    renderer.renderPostProcess();
    close(pixel(), [128, 128, 128, 255], `${mode} RenderTexture no double decode`);
    renderer.resizeRenderTexture(target, 64, 64);
    renderer.render();
    renderer.renderToTexture(target, empty, { clearColor: [0.25, 0.25, 0.25] });
    renderer.renderCommands(sprite(target.textureId));
    renderer.renderPostProcess();
    close(pixel(), [faded, faded, faded, 255], `${mode} RenderTexture clear after resize`);
    renderer.destroyRenderTexture(target);
    cases += 2;

    // Structural budget plus observed CPU submission timing; GPU completion is not measured here.
    const samples = [];
    const allocationsBefore = allocations;
    let stats;
    for (let i = 0; i < 80; i++) {
      const start = performance.now();
      stats = draw(many);
      if (i >= 20) samples.push(performance.now() - start);
    }
    assert(stats.renderCommandCount === 1024 && stats.drawCalls === (managed ? 2 : 1), "draw budget");
    assert(stats.postProcessDrawCalls === (managed ? 1 : 0), "output conversion cost is visible");
    assert(stats.textureSwitchCount === 0 && stats.batchCount === 1, "sprite batching preserved");
    assert(allocations === allocationsBefore, "frame loop allocated GPU textures/framebuffers");
    samples.sort((a, b) => a - b);
    reports.push({ mode, commandCount: stats.renderCommandCount, drawCalls: stats.drawCalls,
      cpuSubmitMedianMs: samples[Math.floor(samples.length / 2)], cpuSubmitP95Ms: samples[Math.floor(samples.length * 0.95)] });
    renderer.destroy();
    assert(liveTextures.size === 0 && liveFramebuffers.size === 0, "GPU texture/framebuffer leak");
    canvas.remove();
  }
  // Verify fallback before WebGPU claims the canvas and prevents obtaining WebGL2.
  const canvas = document.createElement("canvas");
  canvas.style.width = canvas.style.height = "128px";
  document.body.append(canvas);
  let fallback;
  const renderer = await createRenderer(canvas, { preferred: "webgpu", colorManagement: "linear-srgb",
    fallbackBehavior: "silent", onFallback: (info) => { fallback = info; },
    webgl2: { preserveDrawingBuffer: true, clearColor: [0.25, 0.25, 0.25, 1] } });
  assert(renderer instanceof WebGL2Renderer && renderer.colorManagement === "linear-srgb", "managed WebGL2 fallback");
  assert(String(fallback?.reason).includes("WebGPU linear-srgb"), "explicit fallback diagnostic");
  renderer.render();
  renderer.renderCommands(empty);
  renderer.renderPostProcess();
  const gl = canvas.getContext("webgl2");
  const pixel = new Uint8Array(4);
  gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  close([...pixel], [137, 137, 137, 255], "managed clear/fallback output");
  renderer.destroy();
  canvas.remove();
  cases++;

  // Presentation preserves straight alpha input, linear composition, and premultiplied canvas output.
  const transparentCanvas = document.createElement("canvas");
  transparentCanvas.style.width = transparentCanvas.style.height = "128px";
  document.body.append(transparentCanvas);
  const transparent = new WebGL2Renderer(transparentCanvas, { colorManagement: "linear-srgb",
    preserveDrawingBuffer: true, clearColor: [0, 0, 0, 0] });
  await transparent.loadTexture(1, gray);
  const transparentGl = transparentCanvas.getContext("webgl2");
  for (const passes of [[], [{ kind: "fade", color: [1, 1, 1], opacity: 0.5 }]]) {
    transparent.setPostProcess(passes);
    transparent.render();
    transparent.renderCommands(sprite(1, [1, 1, 1, 0.5]));
    transparent.renderPostProcess();
    transparentGl.readPixels(1, 1, 1, 1, transparentGl.RGBA, transparentGl.UNSIGNED_BYTE, pixel);
    const rgb = passes.length === 0 ? 64 : 102;
    close([...pixel], [rgb, rgb, rgb, 128], "transparent canvas output");
    cases++;
  }
  transparent.setPostProcess([]);
  transparent.setSpriteMaterial("additive");
  transparent.render();
  transparent.renderCommands(sprite(1, [1, 1, 1, 0.5]));
  transparent.renderPostProcess();
  transparentGl.readPixels(1, 1, 1, 1, transparentGl.RGBA, transparentGl.UNSIGNED_BYTE, pixel);
  close([...pixel], [64, 64, 64, 128], "additive transparent canvas coverage");
  cases++;
  transparent.destroy();
  transparentCanvas.remove();
  return { status: "passed", cases, dataSceneState: "playing", floatsPerCommand: many.floatsPerCommand, reports };
}

run().then((report) => { globalThis.colorManagementSmoke = report; })
  .catch((error) => { globalThis.colorManagementSmoke = { error: error.stack ?? String(error) }; });
