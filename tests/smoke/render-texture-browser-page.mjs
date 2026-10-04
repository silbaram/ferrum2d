import { WebGL2Renderer } from "@ferrum2d/ferrum-web/core";
import { sceneCommands } from "./data-scene-render-fixture.mjs";

const WHITE_ASSET = 1;
const ATLAS_ASSET = 2;
const TARGET_ID = 100;

function assert(value, message) { if (!value) throw new Error(message); }
function rejects(action, pattern) {
  try { action(); } catch (error) { assert(pattern.test(error.message), error.message); return; }
  throw new Error(`Expected error ${pattern}`);
}


function paddedCommands(commands) {
  const stride = commands.floatsPerCommand + 1;
  const buffer = new Float32Array(commands.commandCount * stride);
  for (let i = 0; i < commands.commandCount; i++) {
    buffer.set(commands.buffer.subarray(i * commands.floatsPerCommand, (i + 1) * commands.floatsPerCommand), i * stride);
  }
  return { ...commands, buffer, floatsPerCommand: stride };
}

async function run() {
  const canvas = document.querySelector("#game");
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
  assert(gl, "WebGL2 unavailable");
  const liveTextures = new Set();
  const liveFramebuffers = new Set();
  for (const [kind, live] of [["Texture", liveTextures], ["Framebuffer", liveFramebuffers]]) {
    const create = gl[`create${kind}`].bind(gl);
    const destroy = gl[`delete${kind}`].bind(gl);
    gl[`create${kind}`] = () => { const resource = create(); if (resource) live.add(resource); return resource; };
    gl[`delete${kind}`] = (resource) => { live.delete(resource); destroy(resource); };
  }
  const renderer = new WebGL2Renderer(canvas, {
    preserveDrawingBuffer: true,
    clearColor: [0, 0, 0, 1],
    postProcess: [{ kind: "fade", color: [0, 0, 0], opacity: 0.25 }],
  });
  const white = document.createElement("canvas");
  white.width = white.height = 1;
  const context = white.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 1, 1);
  const url = white.toDataURL();
  const loading = renderer.loadTexture(WHITE_ASSET, url);
  rejects(() => renderer.createRenderTexture(WHITE_ASSET, { width: 8, height: 8 }), /pending load/);
  await loading;
  const atlas = document.createElement("canvas");
  atlas.width = atlas.height = 2;
  const atlasContext = atlas.getContext("2d");
  ["red", "lime", "blue", "yellow"].forEach((color, index) => {
    atlasContext.fillStyle = color;
    atlasContext.fillRect(index % 2, Math.floor(index / 2), 1, 1);
  });
  await renderer.loadTexture(ATLAS_ASSET, atlas.toDataURL());
  rejects(() => renderer.createRenderTexture(WHITE_ASSET, { width: 8, height: 8 }), /already used/);
  let target = renderer.createRenderTexture(TARGET_ID, { width: 32, height: 32 });
  try {
    await renderer.loadTexture(TARGET_ID, url);
    throw new Error("Asset load accepted a render target id");
  } catch (error) { assert(/owned by a RenderTexture/.test(error.message), error.message); }
  rejects(() => renderer.evictTexture(TARGET_ID), /owned by a RenderTexture/);

  // 1024 sprites, four asymmetric quadrants, a single texture-contiguous batch.
  const colors = [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1], [1, 1, 0, 1]];
  const rectangles = [];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const u = x >= 16 ? 0.5 : 0;
    const v = y >= 16 ? 0.5 : 0;
    // Inset within each atlas texel so fractional target sizes cannot sample its neighbour at an edge.
    rectangles.push({ rect: [x * 4, y * 4, 4, 4], uv: [u + 0.125, v + 0.125, u + 0.375, v + 0.375] });
  }
  const source = await sceneCommands(rectangles, ATLAS_ASSET);
  const savedProjection = [...source.groundShadowProjection];
  const otherSun = await sceneCommands([{ rect: [0, 0, 16, 16] }], WHITE_ASSET, undefined, {
    sun: { directionX: 0, directionY: 1, shadowLengthScale: 2 },
  });
  assert(JSON.stringify([...source.groundShadowProjection]) === JSON.stringify(savedProjection),
    `A later engine changed a saved render projection: ${source.groundShadowProjection}`);
  assert(JSON.stringify([...otherSun.groundShadowProjection]) === "[0,1,2]", "custom sun fixture metadata");
  const output = await sceneCommands([{ rect: [0, 0, 128, 128] }], TARGET_ID, target.uv);
  assert(JSON.stringify([...otherSun.groundShadowProjection]) === "[0,1,2]",
    "Engine destruction/reuse invalidated saved sun metadata");
  const mixedOutput = await sceneCommands([
    { rect: [0, 0, 64, 64], uv: [0, 0, 0.5, 0.5] },
    { rect: [64, 0, 64, 64], texture: ATLAS_ASSET, uv: [0.125, 0.625, 0.375, 0.875] },
    { rect: [0, 64, 64, 64], uv: [0.5, 0.5, 1, 1] },
    { rect: [64, 64, 64, 64], texture: WHITE_ASSET },
  ], TARGET_ID + 1);
  assert(source.floatsPerCommand === output.floatsPerCommand, "inconsistent engine ABI");
  const compatibilitySource = paddedCommands(source);
  // Small malformed/alpha fixtures use the stride read from the real engine.
  const commands = (rectangles, textureId = WHITE_ASSET) => {
    const buffer = new Float32Array(rectangles.length * source.floatsPerCommand);
    rectangles.forEach(({ rect, color = [1, 1, 1, 1] }, index) => {
      buffer.set([...rect, 0, 0, 1, 1, ...color, textureId], index * source.floatsPerCommand);
    });
    return { buffer, commandCount: rectangles.length, floatsPerCommand: source.floatsPerCommand };
  };
  let lastUpload;
  const bufferSubData = gl.bufferSubData.bind(gl);
  gl.bufferSubData = (...args) => { lastUpload = args[2]; bufferSubData(...args); };

  const pixel = (x, y) => {
    const value = new Uint8Array(4);
    gl.readPixels(Math.floor(x * canvas.width / 128), Math.floor((128 - y) * canvas.height / 128),
      1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value);
    return [...value];
  };
  const verifyPixels = () => {
    for (const [index, point] of [[0, [16, 16]], [1, [112, 16]], [2, [16, 112]], [3, [112, 112]]]) {
      const actual = pixel(...point);
      const expected = colors[index].map((value, channel) => Math.round(value * (channel === 3 ? 255 : 191.25)));
      assert(actual.every((value, channel) => Math.abs(value - expected[channel]) <= 2),
        `Incorrect quadrant/UV/post-process: ${actual} expected ${expected}`);
    }
  };
  let result;
  const draw = (input = source) => {
    renderer.render();
    const framebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    const readFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    const viewport = [...gl.getParameter(gl.VIEWPORT)];
    const clear = [...gl.getParameter(gl.COLOR_CLEAR_VALUE)];
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, 1, 1);
    gl.colorMask(false, true, false, true);
    const pass = renderer.renderToTexture(target, input, { viewport: { width: 128, height: 128 } });
    assert((lastUpload === input.buffer) === (input === source), "direct/compatibility upload path");
    assert(pass.drawCalls === 1 && pass.renderCommandCount === 1024, "offscreen pass stats");
    assert(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) === framebuffer, "draw framebuffer restoration");
    assert(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) === readFramebuffer, "read framebuffer restoration");
    assert(JSON.stringify([...gl.getParameter(gl.VIEWPORT)]) === JSON.stringify(viewport), "viewport restoration");
    assert(JSON.stringify([...gl.getParameter(gl.COLOR_CLEAR_VALUE)]) === JSON.stringify(clear), "clear restoration");
    assert(JSON.stringify(gl.getParameter(gl.COLOR_WRITEMASK)) === "[false,true,false,true]", "mask restoration");
    assert(gl.isEnabled(gl.SCISSOR_TEST), "scissor restoration");
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    const before = JSON.stringify(renderer.stats());
    rejects(() => renderer.renderToTexture(target, output), /feedback/);
    const missing = commands([{ rect: [0, 0, 8, 8] }], 9999);
    rejects(() => renderer.renderToTexture(target, missing), /Texture lookup/);
    rejects(() => renderer.renderToTexture(target, source, { viewport: { width: 0, height: 1 } }), /viewport/);
    rejects(() => renderer.renderToTexture(target, source, { clearColor: [0, 0, 0, 0] }), /clearColor/);
    rejects(() => renderer.renderToTexture(target, source, { clearColor: new Array(3) }), /clearColor/);
    assert(JSON.stringify(renderer.stats()) === before, "rejected passes changed stats");
    renderer.renderCommands(output);
    assert(lastUpload === output.buffer, "Rust output sprite must use direct upload");
    result = renderer.renderPostProcess();
    assert(result.drawCalls === 3 && result.batchCount === 2 && result.renderCommandCount === 1025
      && result.postProcessDrawCalls === 1 && result.textureSwitchCount === 0, "combined frame stats");
    verifyPixels();
    assert(gl.getError() === gl.NO_ERROR, "WebGL error");
  };
  draw();
  draw(compatibilitySource);
  // Sampling an intermediate target must apply orientation exactly once, including cropped UVs.
  const intermediate = renderer.createRenderTexture(TARGET_ID + 1, { width: 64, height: 64 });
  renderer.render();
  renderer.renderToTexture(target, source);
  renderer.renderToTexture(intermediate, output);
  renderer.renderCommands(mixedOutput);
  renderer.renderPostProcess();
  for (const [point, expected] of [
    [[16, 16], [191, 0, 0, 255]], [[112, 16], [0, 0, 191, 255]],
    [[16, 112], [191, 191, 0, 255]], [[112, 112], [191, 191, 191, 255]],
  ]) {
    const actual = pixel(...point);
    assert(actual.every((value, channel) => Math.abs(value - expected[channel]) <= 2),
      `Mixed/cropped/chained target UV: ${actual} expected ${expected}`);
  }
  renderer.destroyRenderTexture(intermediate);
  // Material command staging must retain the target's orientation too.
  renderer.render();
  renderer.renderToTexture(target, source);
  renderer.setSpriteMaterial({ colorMix: { color: [0.5, 0.5, 0.5, 1], amount: 1 } });
  renderer.renderCommands(output);
  assert(lastUpload !== output.buffer, "material must use staging upload");
  renderer.renderPostProcess();
  assert(pixel(16, 16).every((value, channel) => Math.abs(value - [96, 0, 0, 255][channel]) <= 2),
    "material target orientation/color");
  renderer.setSpriteMaterial("unlit");
  // Retained frame metadata must reach offscreen draws on every upload path.
  const alphaAtlas = document.createElement("canvas");
  alphaAtlas.width = alphaAtlas.height = 2;
  const alphaContext = alphaAtlas.getContext("2d");
  alphaContext.fillStyle = "rgba(0,255,0,0.5)"; alphaContext.fillRect(1, 0, 1, 1);
  alphaContext.fillStyle = "red"; alphaContext.fillRect(0, 1, 1, 1);
  alphaContext.fillStyle = "blue"; alphaContext.fillRect(1, 1, 1, 1);
  const alphaAsset = 3;
  await renderer.loadTexture(alphaAsset, alphaAtlas.toDataURL());
  const alphaCommands = commands([{ rect: [16, 0, 96, 96], color: [0, 0, 0, 0.8] }], alphaAsset);
  alphaCommands.buffer[13] = 36;
  alphaCommands.groundYScale = 0.5;
  const alphaCases = [];
  for (const directionY of [1, -1]) for (const path of ["direct", "compatibility", "material"]) {
    alphaCommands.groundShadowProjection = new Float32Array([0, directionY, 1]);
    const input = path === "compatibility" ? paddedCommands(alphaCommands) : alphaCommands;
    renderer.render();
    if (path === "material") renderer.setSpriteMaterial({ colorMix: { color: [0, 0, 0, 1], amount: 0.5 } });
    const pass = renderer.renderToTexture(target, input, { clearColor: [1, 1, 1] });
    assert(pass.drawCalls === 1 && pass.renderCommandCount === 1, "alpha offscreen draw budget");
    assert((lastUpload === input.buffer) === (path === "direct"), `alpha ${path} upload path`);
    renderer.setSpriteMaterial("unlit");
    const beforeStats = JSON.stringify(renderer.stats());
    const beforeFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    for (const invalid of [undefined, new Float32Array([0, 0, 1]), new Float32Array([0, 1, 0]), new Float32Array([0, 1])]) {
      rejects(() => renderer.renderToTexture(target, { ...input, groundShadowProjection: invalid }, { clearColor: [1, 0, 1] }),
        /groundShadowProjection/);
    }
    assert(JSON.stringify(renderer.stats()) === beforeStats, "rejected alpha passes changed stats");
    assert(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) === beforeFramebuffer, "rejected alpha pass changed framebuffer");
    renderer.renderCommands(output);
    renderer.renderPostProcess();
    // A downward sun flips the mask vertically; an upward sun flips it horizontally.
    // The retained target then receives the existing 25% fade exactly once.
    const expected = directionY === 1 ? [38, 38, 191, 114] : [114, 191, 38, 38];
    const samples = [[40, 36], [88, 36], [40, 60], [88, 60]].map((point, index) => {
      const actual = pixel(...point);
      assert(actual.slice(0, 3).every((value) => Math.abs(value - expected[index]) <= 2) && actual[3] === 255,
        `alpha target ${directionY}/${path}: ${actual}, expected grayscale ${expected[index]}`);
      return actual;
    });
    assert(pixel(40, 16).every((value, channel) => Math.abs(value - (channel === 3 ? 255 : 191)) <= 2),
      "offscreen ground scale or main-pass projection was not restored");
    assert(gl.getError() === gl.NO_ERROR, "alpha offscreen WebGL error");
    alphaCases.push({ directionY, path, samples, rejectedPasses: 4 });
  }
  assert(renderer.evictTexture(alphaAsset), "alpha fixture texture release");
  const baseline = [liveTextures.size, liveFramebuffers.size];
  for (let i = 0; i < 8; i++) {
    renderer.resizeRenderTexture(target, 32 + i * 4, 40 + i * 4);
    assert(target.width === 32 + i * 4, "handle dimensions did not update");
    rejects(() => renderer.resizeRenderTexture(target, 0, 1), /dimensions/);
    draw();
    const retired = target;
    assert(renderer.destroyRenderTexture(retired), "release failed");
    assert(!renderer.destroyRenderTexture(retired), "release not idempotent");
    target = renderer.createRenderTexture(TARGET_ID, { width: 32, height: 32, filter: "linear" });
    rejects(() => renderer.renderToTexture(retired, source), /destroyed/);
    assert(!renderer.destroyRenderTexture(retired), "stale release deleted reused id");
    assert(JSON.stringify([liveTextures.size, liveFramebuffers.size]) === JSON.stringify(baseline), "resource leak");
  }
  // An empty pass clears the image; translucent sprites still produce an opaque image.
  renderer.render();
  renderer.renderToTexture(target, commands([]), { clearColor: [1, 0, 0] });
  renderer.renderCommands(output);
  renderer.renderPostProcess();
  assert(pixel(16, 16)[0] >= 190 && pixel(16, 16)[1] === 0, "empty clear");
  renderer.render();
  renderer.renderToTexture(target, commands([{ rect: [0, 0, 128, 128], color: [1, 0, 0, 0.5] }]), {
    clearColor: [0, 0, 1],
  });
  renderer.renderCommands(output);
  renderer.renderPostProcess();
  const blended = pixel(16, 16);
  assert(Math.abs(blended[0] - 96) <= 2 && Math.abs(blended[2] - 96) <= 2 && blended[3] === 255,
    `opaque alpha contract: ${blended}`);
  // Errors after binding must also restore the caller's state.
  renderer.render();
  const previousFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
  const previousViewport = [...gl.getParameter(gl.VIEWPORT)];
  const drawElements = gl.drawElementsInstanced.bind(gl);
  gl.drawElementsInstanced = () => { throw new Error("injected draw failure"); };
  rejects(() => renderer.renderToTexture(target, source), /injected draw failure/);
  gl.drawElementsInstanced = drawElements;
  assert(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) === previousFramebuffer, "error framebuffer restoration");
  assert(JSON.stringify([...gl.getParameter(gl.VIEWPORT)]) === JSON.stringify(previousViewport), "error viewport restoration");
  draw();
  renderer.destroy();
  renderer.destroy();
  rejects(() => renderer.renderToTexture(target, source), /destroyed/);
  assert(liveTextures.size === 0 && liveFramebuffers.size === 0, "renderer destroy leaked targets");
  assert(gl.getError() === gl.NO_ERROR, "final WebGL error");
  return { status: "passed", commandCount: result.renderCommandCount, drawCalls: result.drawCalls,
    dataSceneState: "playing", floatsPerCommand: source.floatsPerCommand,
    retainedProjection: true, alphaCases,
    uploadPaths: ["direct", "compatibility", "material"],
    liveTextures: liveTextures.size, liveFramebuffers: liveFramebuffers.size };
}

run().then((report) => { globalThis.renderTextureSmoke = report; })
  .catch((error) => { globalThis.renderTextureSmoke = { error: error.stack ?? String(error) }; });
