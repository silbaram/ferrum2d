import { createRenderer } from "@ferrum2d/ferrum-web/core";

const WIDTH = 96, HEIGHT = 64;
const CLEAR = [16, 24, 32];
const check = (value, message) => { if (!value) throw Error(message); };
const decode = x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
const encode = x => x <= .0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - .055;
const packet = rows => ({ buffer: Float32Array.from(rows.flat()), commandCount: rows.length, floatsPerCommand: 15 });
const sprite = (x, y, w, h, rgb, texture = 1, uv = [0, 0, 1, 1]) => [x, y, w, h, ...uv, ...rgb.map(x => x / 255), 1, texture, 0, 0];

function texture(pixels) {
  const canvas = document.createElement("canvas"); canvas.width = pixels.length; canvas.height = 1;
  canvas.getContext("2d").putImageData(new ImageData(Uint8ClampedArray.from(pixels.flat()), pixels.length, 1), 0, 0);
  return canvas.toDataURL();
}

/** Return top-left RGBA bytes, normalizing actual GL origin and GPU channel order. */
async function readPixels(renderer, canvas) {
  const width = canvas.width, height = canvas.height;
  if (typeof renderer.gpuDevice !== "function") {
    const gl = canvas.getContext("webgl2"), raw = new Uint8Array(width * height * 4), result = new Uint8Array(raw.length);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    check(gl.getError() === 0, "GL pixel readback failed");
    for (let y = 0; y < height; y++) result.set(raw.subarray(y * width * 4, (y + 1) * width * 4), (height - 1 - y) * width * 4);
    return result;
  }
  const device = renderer.gpuDevice(), image = canvas.getContext("webgpu").getCurrentTexture();
  const stride = Math.ceil(width * 4 / 256) * 256;
  const buffer = device.createBuffer({ size: stride * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: image }, { buffer, bytesPerRow: stride, rowsPerImage: height }, { width, height, depthOrArrayLayers: 1 });
    device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(buffer.getMappedRange()), result = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) result.set(raw.subarray(y * stride, y * stride + width * 4), y * width * 4);
    if (image.format.startsWith("bgra")) for (let i = 0; i < result.length; i += 4) [result[i], result[i + 2]] = [result[i + 2], result[i]];
    buffer.unmap(); return result;
  } finally { buffer.destroy(); }
}

/** Current renderer baseline. Proposed lit output is deliberately not rendered here. */
export async function probeFlatLightingContract(preferred, colorManagement = "legacy") {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = `width:${WIDTH}px;height:${HEIGHT}px;display:block`;
  canvas.dataset.spatialGpuTarget = "true"; document.body.append(canvas);
  let renderer, device, backend, output, failure, afterDestroy = null, stage = "setup";
  const errors = [], results = [], observations = {}, cleanupErrors = [];
  const receiverIds = ["black", "grey", "white", "empty", "cutout-hole", "opaque-green", "half-alpha"];
  const cleanup = { rendererCreated: false, rendererDestroyed: false, targetDisposed: false, canvasRemoved: false, errors: cleanupErrors };
  try {
    renderer = await createRenderer(canvas, { preferred, colorManagement, fallbackBehavior: "silent", webgl2: { preserveDrawingBuffer: true, clearColor: [...CLEAR.map(x => x / 255), 1] }, webgpu: { clearColor: [...CLEAR.map(x => x / 255), 1] } });
    cleanup.rendererCreated = true;
    backend = typeof renderer.gpuDevice === "function" ? "webgpu" : "webgl2";
    check(backend === preferred, `Expected actual ${preferred}, got ${backend}`);
    device = backend === "webgpu" ? renderer.gpuDevice() : undefined;
    device?.addEventListener("uncapturederror", event => errors.push(event.error.message));
    check(canvas.width === WIDTH * devicePixelRatio && canvas.height === HEIGHT * devicePixelRatio, "DPR backing size mismatch");
    await renderer.loadTexture(1, texture([[0, 0, 0, 255], [96, 96, 96, 255], [255, 255, 255, 255]]));
    await renderer.loadTexture(2, texture([[255, 0, 0, 0], [0, 255, 0, 255], [0, 0, 255, 128]]));
    await renderer.loadTexture(3, texture([[255, 255, 255, 255]]));
    const scene = packet([...[8, 40, 72].map((x, i) => sprite(x, 16, 16, 16, [255, 255, 255], 1, [i / 3, 0, (i + 1) / 3, 1])), sprite(12, 40, 36, 8, [255, 255, 255], 2)]);
    const points = [[16, 24], [48, 24], [80, 24], [4, 4], [18, 44], [30, 44], [42, 44]];
    const ambient = [0, 0, 0, .5];
    const sample = data => points.map(([x, y]) => Array.from(data.subarray((Math.floor(y * devicePixelRatio) * canvas.width + Math.floor(x * devicePixelRatio)) * 4, (Math.floor(y * devicePixelRatio) * canvas.width + Math.floor(x * devicePixelRatio)) * 4 + 4)));
    const draw = async (name, lighting, commands = scene, hud) => {
      stage = name;
      renderer.setLighting(lighting); renderer.setSpriteMaterial("unlit");
      const started = performance.now(); renderer.render(); const sceneStats = renderer.renderCommands(commands);
      let hudStats;
      if (hud) { renderer.setLighting(false); hudStats = renderer.renderCommands(hud); }
      renderer.renderPostProcess(); const stats = renderer.stats();
      const cpuSubmitMs = performance.now() - started;
      await device?.queue.onSubmittedWorkDone();
      const data = await readPixels(renderer, canvas);
      check(errors.length === 0, errors.join("\n"));
      // Each renderCommands returns its submission stats; the final one also gains presentation work.
      const result = { name, rgba: sample(data), stats, ...(hudStats ? { submissions: { scene: sceneStats, hud: hudStats } } : {}),
        totalDrawCalls: stats.drawCalls + (hudStats ? sceneStats.drawCalls : 0),
        resources: renderer.resourceStats(), cpuSubmitMs, gpuTimeMs: null,
        // Only the blue texture channel differs at upload. Ambient scales that difference;
        // the identical subsequent additive light terms cancel in a backend comparison.
        legacyUploadDeltaRgb: colorManagement === "legacy" ? [0, 0, (128 / 255) * (1 - 128 / 255) * 255 * (lighting ? 1 - lighting.ambient[3] : 1)] : null };
      results.push(result); return { ...result, data };
    };
    const within = (actual, expected, label, tolerance = 3) => check(actual.length === 4 && (expected.length === 3 || expected.length === 4) && expected.every((x, i) => Number.isFinite(actual[i]) && Math.abs(actual[i] - x) <= tolerance), `${label}: ${actual} != ${expected}`);
    const allSame = (a, b, label) => check(a.length === b.length && a.every((x, i) => x === b[i]), label);
    const base = await draw("disabled", false);
    const baselineTargets = base.resources.renderTargetCount;
    const dim = await draw("ambient", { ambient });
    const sun = { directionX: 1, directionY: 0, elevationRadians: Math.PI / 2, color: [.25, .25, .25], intensity: .5 };
    const lit = await draw("ambient-sun", { ambient, directionalLight: sun });
    for (let i = 0; i < 3; i++) {
      // Scalar blend equation, independent of renderer source. Color texture samples decode in linear mode.
      const input = [0, 96, 255][i] / 255, b = colorManagement === "linear-srgb" ? decode(input) : input;
      const display = x => Math.round((colorManagement === "linear-srgb" ? encode(x) : x) * 255);
      within(base.rgba[i], [...Array(3).fill(display(b)), 255], `base ${i}`);
      within(dim.rgba[i], [...Array(3).fill(display(b * .5)), backend === "webgl2" && colorManagement === "legacy" ? 191 : 255], `ambient ${i}`);
      within(lit.rgba[i], [...Array(3).fill(display(b * .5 + .125)), 255], `additive sun ${i}`);
    }
    check(lit.rgba[0][0] - dim.rgba[0][0] > 20, "Legacy illumination on a black surface must be measured, not mislabelled as albedo-lit");
    check(lit.rgba[3][0] > dim.rgba[3][0] + 20 && lit.rgba[4][0] > dim.rgba[4][0] + 20, "Legacy empty/cutout background receives the full-view light");
    within(base.rgba[4], base.rgba[3], "Transparent texel must initially reveal the unchanged background", 0);
    within(base.rgba[5], [0, 255, 0, 255], "Opaque texel color");
    // Documented compatibility: legacy GL sRGB uploads are premultiplied, GPU is straight.
    const sourceBlue = backend === "webgl2" && colorManagement === "legacy" ? 128 / 255 : 1;
    const partial = CLEAR.map((x, i) => (i === 2 ? sourceBlue : 0) * (128 / 255) + (x / 255) * (127 / 255));
    const display = x => Math.round((colorManagement === "linear-srgb" ? encode(x) : x) * 255);
    const baseAlpha = backend === "webgl2" && colorManagement === "legacy" ? (128 / 255) ** 2 + 127 / 255 : 1;
    const dimAlpha = baseAlpha < 1 ? .25 + baseAlpha * .5 : 1;
    for (const [row, factor, additive, alpha] of [[base, 1, 0, baseAlpha], [dim, .5, 0, dimAlpha], [lit, .5, .125, dimAlpha < 1 ? dimAlpha + .25 : 1]]) {
      const expected = [...partial.map(x => display(x * factor + additive)), Math.round(alpha * 255)];
      observations[row.name] = { halfAlphaExpected: expected, halfAlphaActual: row.rgba[6] };
      within(row.rgba[6], expected, `Half-alpha ${row.name}`);
    }
    check(lit.stats.normalDrawCalls === 0 && lit.stats.lightingDrawCalls === 2, "Unmapped default unlit preset still uses ambient + sun overlay");
    check(lit.resources.renderTargetCount === baselineTargets, "Unshadowed legacy lighting allocated an extra target");

    const A = { x: 32, y: 24, radius: 128, falloff: 1, color: [1, 0, 0, 1], intensity: .25 };
    const B = { x: 80, y: 8, radius: 128, falloff: 1, color: [0, 0, 1, 1], intensity: .25 };
    const wall = { x: 48, y: 16, width: 8, height: 16 };
    const settings = (lights, walls = [], opacity = 1) => ({ ambient, pointLights: lights, tileOccluders: walls, shadows: { color: [0, 0, 0, opacity], projectionLength: 512 } });
    const both = await draw("red-blue", settings([A, B]));
    const blocked = await draw("red-blocked-blue-retained", settings([A, B], [wall]));
    const onlyB = await draw("blue-only", settings([B]));
    within(blocked.rgba[2], onlyB.rgba[2], "Blocking red must preserve blue and ambient");
    check(both.rgba[2][0] > blocked.rgba[2][0] + 20 && blocked.rgba[2][2] > dim.rgba[2][2] + 20, "Receiver must have a measured red shadow and blue contribution");
    const half = await draw("half-shadow", settings([A, B], [wall], .5));
    const duplicate = await draw("duplicate-half-shadow", settings([A, B], [wall, { ...wall }], .5));
    within(half.rgba[2], duplicate.rgba[2], "Duplicate occluders must use a union mask", 1);
    check(half.rgba[2][0] > blocked.rgba[2][0] + 5 && half.rgba[2][0] < both.rgba[2][0] - 5, "Half mask must be between no shadow and full shadow");
    const warm = await draw("warm-shadow", settings([A, B], [wall, { ...wall }], .5));
    check(warm.resources.renderTargetCount === duplicate.resources.renderTargetCount && warm.resources.estimatedBytes === duplicate.resources.estimatedBytes, "Warm lighting allocation must plateau");

    // Same public command, rendered after lighting, demonstrates an explicit HUD boundary.
    const hud = packet([sprite(72, 4, 16, 8, [32, 96, 160], 3)]);
    const beforeHud = await draw("pre-hud", { ambient, directionalLight: sun });
    const afterHud = await draw("post-hud", { ambient, directionalLight: sun }, scene, hud);
    const hudData = afterHud.data;
    const hudIndex = (Math.floor(8 * devicePixelRatio) * canvas.width + Math.floor(80 * devicePixelRatio)) * 4;
    const hudExpected = [32, 96, 160].map(x => Math.round((colorManagement === "linear-srgb" ? encode(x / 255) : x / 255) * 255));
    observations.hud = { rgba: Array.from(hudData.subarray(hudIndex, hudIndex + 4)), expected: [...hudExpected, 255] };
    within(observations.hud.rgba, observations.hud.expected, "Explicit post-lighting HUD RGBA");
    allSame(sample(hudData).flat(), beforeHud.rgba.flat(), "Post-lighting HUD changed unrelated scene receivers");
    const restored = await draw("disabled-restored", false);
    allSame(restored.data, base.data, "OFF did not restore the exact initial framebuffer");
    check(restored.stats.lightingDrawCalls === 0 && restored.stats.shadowDrawCalls === 0 && restored.resources.renderTargetCount === baselineTargets, "OFF retained lighting work or shadow targets");
    check(results.every(r => r.totalDrawCalls <= 8), "Fixed small fixture exceeded whole-frame draw budget");
    output = { backend, colorManagement, dpr: devicePixelRatio, implementedProfile: "legacy-overlay", receiverIds, results, observations,
      legacyAlpha: { sample: 6, source: sourceBlue < 1 ? "premultiplied-srgb-upload" : "straight-upload", expectedBaseRgb: partial.map(x => Math.round((colorManagement === "linear-srgb" ? encode(x) : x) * 255)), actualBaseRgba: base.rgba[6] },
      explicitPostLightingHud: true, exactOffRestore: true, allocationPlateau: true, errors };
  } catch (error) { failure = { stage, message: String(error?.message ?? error), stack: String(error?.stack ?? error) }; }
  finally {
    // Preserve the original failure and still attempt every independently owned cleanup.
    try { if (renderer) { renderer.destroy(); cleanup.rendererDestroyed = true; } } catch (error) { cleanupErrors.push(String(error)); }
    try {
      if (renderer) {
        afterDestroy = renderer.resourceStats();
        check([afterDestroy.textureCount, afterDestroy.bufferCount, afterDestroy.programCount, afterDestroy.renderTargetCount].every(x => x === 0), "Destroy leaked tracked resources");
      }
    } catch (error) { cleanupErrors.push(String(error)); }
    try { if (window.disposeSpatialGpuTarget) { window.disposeSpatialGpuTarget(canvas); cleanup.targetDisposed = true; } } catch (error) { cleanupErrors.push(String(error)); }
    canvas.remove(); cleanup.canvasRemoved = !canvas.isConnected;
  }
  return { requestedBackend: preferred, implementedProfile: "legacy-overlay", ...(output ?? { backend, colorManagement, dpr: devicePixelRatio, receiverIds, results, observations, errors }),
    ok: !failure && !cleanupErrors.length && !errors.length, ...(failure ? { failure } : {}), afterDestroy, cleanup };
}
