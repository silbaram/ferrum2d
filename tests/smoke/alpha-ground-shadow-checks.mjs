// Browser-context functions. They use the packed public-API presentation recipe only.
export function installAlphaShadowTracking() {
  const counters = { textureUploads: 0, readbacks: 0, textures: 0, buffers: 0 };
  window.alphaShadowCosts = counters;
  const patch = (prototype, name, before) => {
    if (!prototype?.[name]) return;
    const original = prototype[name];
    prototype[name] = function (...args) { before(...args); return Reflect.apply(original, this, args); };
  };
  for (const name of ["texImage2D", "texSubImage2D"]) patch(WebGL2RenderingContext.prototype, name, () => counters.textureUploads++);
  patch(WebGL2RenderingContext.prototype, "readPixels", () => counters.readbacks++);
  patch(CanvasRenderingContext2D.prototype, "getImageData", () => counters.readbacks++);
  const track = (prototype, create, destroy, field) => {
    if (!prototype?.[create]) return;
    const live = new WeakSet(), original = prototype[create];
    prototype[create] = function (...args) {
      const resource = Reflect.apply(original, this, args);
      if (resource) { live.add(resource); counters[field]++; }
      return resource;
    };
    if (destroy) patch(prototype, destroy, (resource) => { if (live.delete(resource)) counters[field]--; });
    else {
      const resourcePrototype = field === "textures" ? globalThis.GPUTexture?.prototype : globalThis.GPUBuffer?.prototype;
      const dispose = resourcePrototype?.destroy;
      if (dispose) resourcePrototype.destroy = function (...args) {
        if (live.delete(this)) counters[field]--;
        return Reflect.apply(dispose, this, args);
      };
    }
  };
  track(WebGL2RenderingContext.prototype, "createTexture", "deleteTexture", "textures");
  track(WebGL2RenderingContext.prototype, "createBuffer", "deleteBuffer", "buffers");
  track(globalThis.GPUDevice?.prototype, "createTexture", undefined, "textures");
  track(globalThis.GPUDevice?.prototype, "createBuffer", undefined, "buffers");
  for (const name of ["copyExternalImageToTexture", "writeTexture"]) patch(globalThis.GPUQueue?.prototype, name, () => counters.textureUploads++);
  patch(globalThis.GPUBuffer?.prototype, "mapAsync", () => counters.readbacks++);
}

export async function checkAlphaGroundShadows(color) {
  const s = window.presentation, canvas = document.querySelector("canvas"), gpu = !!window.capturePresentationGpu;
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = async (frames = 2) => { for (let i = 0; i < frames; i++) await new Promise(requestAnimationFrame); };
  const capture = async (points) => {
    if (gpu) return (await window.capturePresentationGpu(points)).pixels;
    const gl = canvas.getContext("webgl2");
    return Object.fromEntries(Object.entries(points).map(([key, point]) => {
      const bytes = new Uint8Array(4);
      gl.readPixels(Math.floor(point.x * canvas.width / canvas.clientWidth), Math.floor((canvas.clientHeight - point.y) * canvas.height / canvas.clientHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      check(!gl.isContextLost(), "alpha shadow lost WebGL context");
      return [key, [...bytes]];
    }));
  };
  const originalResources = { ...window.alphaShadowCosts };
  const atlas = document.createElement("canvas"); atlas.width = 128; atlas.height = 96;
  const ctx = atlas.getContext("2d");
  for (let frame = 0; frame < 2; frame++) {
    const x = frame * 64, y = frame === 0 ? 12 : 60;
    ctx.fillStyle = frame === 0 ? "#ff3300" : "#00ff33"; ctx.fillRect(x, 0, 64, 96);
    ctx.clearRect(x + (frame === 0 ? 4 : 36), y, 24, 24);
    ctx.clearRect(x + (frame === 0 ? 36 : 4), y, 24, 24);
    ctx.fillStyle = "rgba(70,110,250,0.5)"; ctx.fillRect(x + (frame === 0 ? 36 : 4), y, 24, 24);
  }
  await s.renderer.loadTexture(4, atlas.toDataURL());
  const animationSet = { initialClip: 0, clips: [{ id: 0, fps: 8, frames: [
    { u0: 0, v0: 0, u1: 0.5, v1: 1 }, { u0: 0.5, v0: 0, u1: 1, v1: 1 },
  ] }] };
  const instance = (id, x, y, layer, visual, transform = {}, body = false) => ({ id, prefab: "object", x, y, layer, ...transform,
    props: { components: { visual: { kind: "sprite", texture: 4, width: 32, height: 48, ...visual }, layer: "wall",
      collider: body ? { type: "aabb", halfWidth: 4, halfHeight: 4, isTrigger: true } : "none",
      ...(body ? { body: { type: "kinematic" } } : {}) } } });
  const ground = instance("ground", 400, 300, -10, { texture: 1, width: 1800, height: 1600, projection: "ground", tint: "#808080" });
  const matrix = [
    { rotation: 0, scale: 1, originX: 0.5, originY: 1, ground: 1, zoom: 0.75, sun: [1, 0], projection: "upright" },
    { rotation: 0.6, scale: 1.5, originX: 0.2, originY: 0.35, ground: 0.72, zoom: 1.5, sun: [1, 0.5], projection: "upright" },
    { rotation: Math.PI / 2, scale: 1, originX: 0.75, originY: 0.25, ground: 0.72, zoom: 1.5, sun: [-0.5, 1], projection: "upright" },
    { rotation: -0.4, scale: 1.25, originX: 0.5, originY: 1, ground: 1, zoom: 1, sun: [0, -1], projection: "ground" },
  ];
  const evidence = [];
  const ownerAlpha = 204 / 255, opacity = 0.75, sunOpacity = 0.5, length = 1.25;
  const expectedColor = (alpha) => {
    const v = 128 / 255;
    const linear = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    const mixed = linear * (1 - alpha);
    return Math.round(255 * (color === "legacy" ? v * (1 - alpha) : mixed <= 0.0031308 ? mixed * 12.92 : 1.055 * mixed ** (1 / 2.4) - 0.055));
  };
  let previous, resizeProbes;
  for (const config of matrix) {
    // Cover the owner with the background so shadow samples cannot accidentally read its image.
    s.apply([ground, instance("mask", 400, 300, -20, { originX: config.originX, originY: config.originY, projection: config.projection,
      tint: "#ffffffcc", animationSet, shadow: { shape: "alpha", width: 48, height: 64, opacity, layer: 0 } },
    { rotationRadians: config.rotation, scale: config.scale }, true)]);
    const owner = s.handles.mask;
    if (previous) check(s.engine.getPhysicsEntity(previous) === undefined, "alpha reapply kept a stale owner");
    previous = owner;
    s.engine.pauseDataScene(); s.lighting(false); s.debug(false);
    s.view.setGroundYScale(config.ground); s.view.setZoom(config.zoom);
    s.view.setSun({ ...s.sun, directionX: config.sun[0], directionY: config.sun[1], shadowOpacity: sunOpacity, shadowLengthScale: length });
    const norm = Math.hypot(...config.sun), sx = config.sun[0] / norm, sy = config.sun[1] / norm;
    const sin = Math.sin(config.rotation), cos = Math.cos(config.rotation);
    const dx = (0.5 - config.originX) * 32 * config.scale, dy = (1 - config.originY) * 48 * config.scale;
    const foot = { x: 400 + dx * cos - dy * sin, y: 300 + (dx * sin + dy * cos) / (config.projection === "ground" ? 1 : config.ground) };
    const projected = (u, v) => {
      const x = (u - 0.5) * 48 * config.scale, y = (v - 1) * 64 * config.scale;
      const rx = x * cos - y * sin, ry = x * sin + y * cos;
      return { x: foot.x + sy * rx - sx * ry * length, y: foot.y - sx * rx - sy * ry * length };
    };
    s.view.setCamera(projected(0.5, 0.5));
    const beforeBody = JSON.stringify(s.engine.getPhysicsEntity(owner));
    for (const update of [{ frame: 0, flipX: false, flipY: false }, { frame: 1, flipX: false, flipY: false },
      { frame: 0, flipX: true, flipY: false }, { frame: 1, flipX: true, flipY: true }]) {
      check(s.engine.updateDataSceneSpriteAnimations([{ entity: owner, ...update, paused: true }]), "alpha frame transition rejected");
      await wait();
      const beforeCosts = { ...window.alphaShadowCosts };
      await wait(4);
      check(window.alphaShadowCosts.textureUploads === beforeCosts.textureUploads && window.alphaShadowCosts.readbacks === beforeCosts.readbacks,
        "alpha shadow frame required texture upload or CPU readback");
      const q = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
      const points = Object.fromEntries(q.map(([u, v], index) => [index, s.view.worldToScreen(projected(u, v))]));
      const pixels = await capture(points);
      for (let i = 0; i < q.length; i++) {
        const [u, v] = q[i], tu = update.flipX ? 1 - u : u, tv = update.flipY ? 1 - v : v;
        const inCutoutRow = update.frame === 0 ? tv === 0.25 : tv === 0.75;
        const hole = inCutoutRow && (update.frame === 0 ? tu === 0.25 : tu === 0.75);
        const maskAlpha = hole ? 0 : inCutoutRow ? 128 / 255 : 1;
        const alpha = maskAlpha * ownerAlpha * opacity * sunOpacity, expected = expectedColor(alpha), pixel = pixels[i];
        check(pixel.slice(0, 3).every((value) => Math.abs(value - expected) <= 3),
          `alpha silhouette pixel mismatch: ${JSON.stringify({ config, update, i, pixel, expected, points })}`);
        const expectedAlpha = color === "legacy" && !gpu ? Math.round(255 * (1 - alpha + alpha * alpha)) : 255;
        check(Math.abs(pixel[3] - expectedAlpha) <= 2, "alpha shadow changed renderer compositing alpha");
      }
      const command = s.frame.commands.find((c) => (c.effectFlags & 32) !== 0);
      check(command?.textureId === 4 && command.color.slice(0, 3).every((v) => v === 0), "alpha command lost texture or black tint");
      check(s.engine.dataSceneGroundShadowStats().cacheHits === 1, "alpha animation invalidated static geometry cache");
      check(JSON.stringify(s.engine.getPhysicsEntity(owner)) === beforeBody, "alpha animation changed owner physics");
      evidence.push({ config, update, pixels });
      resizeProbes = { world: q.map(([u, v]) => projected(u, v)), pixels };
    }
  }
  // Advance the native clock, rather than relying only on explicit frame seeks.
  const animatedCosts = { ...window.alphaShadowCosts };
  check(s.engine.updateDataSceneSpriteAnimations([{ entity: previous, frame: 0, flipX: false, flipY: false, paused: false }]), "alpha animation start rejected");
  s.engine.resumeDataScene();
  for (let i = 0; i < 100 && s.engine.dataSceneSpriteAnimationState(previous).frame !== 1; i++) await wait(1);
  check(s.engine.dataSceneSpriteAnimationState(previous).frame === 1, "native alpha animation did not advance");
  s.engine.pauseDataScene(); await wait();
  const animatedCommand = s.frame.commands.find((c) => (c.effectFlags & 32) !== 0);
  check(animatedCommand.uv[0] === 0.5 && animatedCommand.uv[2] === 1, "native animation did not update shadow UV");
  check(window.alphaShadowCosts.textureUploads === animatedCosts.textureUploads && window.alphaShadowCosts.readbacks === animatedCosts.readbacks,
    "native shadow animation required upload/readback");
  const animatedPixels = await capture(Object.fromEntries(resizeProbes.world.map((point, i) => [i, s.view.worldToScreen(point)])));
  const animatedAlphas = [1, 1, 128 / 255, 0];
  check(Object.entries(animatedPixels).every(([i, pixel]) => pixel.slice(0, 3).every((v) => Math.abs(v - expectedColor(animatedAlphas[i] * ownerAlpha * opacity * sunOpacity)) <= 3)),
    "native animation frame silhouette pixels mismatch");
  resizeProbes.pixels = animatedPixels;
  // Resizing changes backbuffer/DPR resolution, not the shadow mask or its frame.
  const savedWidth = canvas.style.width, savedHeight = canvas.style.height;
  canvas.style.width = `${canvas.clientWidth - 24}px`; canvas.style.height = `${canvas.clientHeight - 24}px`;
  s.renderer.resize(); await wait();
  const resize = { width: canvas.width, height: canvas.height, casters: s.engine.dataSceneGroundShadowStats().casters };
  check(resize.casters === 1, "resizing dropped the alpha caster");
  resize.pixels = await capture(Object.fromEntries(resizeProbes.world.map((point, i) => [i, s.view.worldToScreen(point)])));
  check(Object.entries(resize.pixels).every(([i, pixel]) => pixel.every((value, channel) => Math.abs(value - resizeProbes.pixels[i][channel]) <= 3)),
    "resize changed alpha silhouette pixels");
  canvas.style.width = savedWidth; canvas.style.height = savedHeight; s.renderer.resize(); await wait();
  const screenshot = gpu ? (await window.capturePresentationGpu({})).png : canvas.toDataURL("image/png");
  const costs = [];
  for (const count of [100, 500, 1000]) {
    const objects = Array.from({ length: count }, (_, i) => instance(`caster${i}`, 370 + i % 32 * 2, 310 + Math.floor(i / 32) * 2, 0,
      { width: 2, height: 4, originY: 1, frame: { u0: 0, v0: 0, u1: 0.5, v1: 1 }, shadow: { shape: "alpha", width: 2, height: 4 } }));
    s.apply([ground, ...objects]); s.view.setCamera({ x: 400, y: 340 }); s.view.setZoom(1); await wait(4);
    const beforeCosts = { ...window.alphaShadowCosts }, render = [], rust = [];
    for (let i = 0; i < 12; i++) { await wait(1); render.push(s.frame.renderMs); rust.push(s.frame.rustUpdateMs); }
    const p95 = (values) => values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
    check(window.alphaShadowCosts.textureUploads === beforeCosts.textureUploads && window.alphaShadowCosts.readbacks === beforeCosts.readbacks,
      "many alpha casters required readback or texture upload");
    const shadow = s.engine.dataSceneGroundShadowStats();
    check(shadow.casters === count && shadow.cacheHits === count && s.frame.commands.length === count * 2 + 1 && s.frame.stats.drawCalls <= 5,
      `alpha caster count/draw budget failed: ${JSON.stringify({ count, shadow, stats: s.frame.stats })}`);
    costs.push({ count, renderP95Ms: p95(render), rustP95Ms: p95(rust), shadow, stats: s.frame.stats, resources: { ...window.alphaShadowCosts } });
  }
  check(costs.every((c) => Number.isFinite(c.renderP95Ms) && Number.isFinite(c.rustP95Ms)
    && c.resources.textures === costs[0].resources.textures && c.resources.buffers === costs[0].resources.buffers), "alpha caster resources grew with caster count");
  s.view.setSun({ ...s.sun, maxCasters: 100 }); await wait();
  const budget = s.engine.dataSceneGroundShadowStats();
  check(budget.casters === 100 && budget.skippedByBudget === 900, "alpha caster budget not enforced");
  s.apply([ground, instance("mask", 400, 300, 0, { originY: 1, shadow: { shape: "alpha" } })]); await wait();
  check(s.engine.despawnPhysicsEntity(s.handles.mask), "alpha owner despawn failed"); await wait();
  check(s.engine.dataSceneGroundShadowStats().casters === 0, "despawn left an alpha shadow");
  s.apply(); await wait();
  check(s.renderer.evictTexture(4), "test atlas could not be released");
  check(window.alphaShadowCosts.textures === originalResources.textures && window.alphaShadowCosts.buffers === originalResources.buffers,
    "alpha reset left additional GPU textures or buffers");
  return { pixels: evidence, animatedPixels, resize, costs, budget, screenshot, resourcesReleased: true };
}
