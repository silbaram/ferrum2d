import {
  createEngine,
  createFerrumRuntime,
  createRenderer,
  createDataSceneSpatialView,
  captureGameStateSnapshot,
  restoreGameStateSnapshot,
} from "@ferrum2d/ferrum-web/core";
import {
  applyDataSceneAuthoringDocument,
  createSceneInstanceHandleRegistry,
} from "@ferrum2d/ferrum-web/authoring";
export const check = (ok, message, evidence) => {
  if (!ok) throw Error(`${message}: ${JSON.stringify(evidence)}`);
};
const tick = () => new Promise(requestAnimationFrame);

export async function pixels(renderer, canvas) {
  const width = canvas.width,
    height = canvas.height;
  if (typeof renderer.gpuDevice !== "function") {
    const gl = canvas.getContext("webgl2"),
      raw = new Uint8Array(width * height * 4),
      result = raw.slice();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    check(gl.getError() === gl.NO_ERROR, "WebGL read error");
    for (let y = 0; y < height; y++)
      result.set(raw.subarray(y * width * 4, (y + 1) * width * 4), (height - y - 1) * width * 4);
    return result;
  }
  const device = renderer.gpuDevice(),
    row = Math.ceil((width * 4) / 256) * 256;
  const buffer = device.createBuffer({
    size: row * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: canvas.getContext("webgpu").getCurrentTexture() },
      { buffer, bytesPerRow: row },
      [width, height, 1],
    );
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(buffer.getMappedRange()),
      result = new Uint8Array(width * height * 4);
    const bgra = navigator.gpu.getPreferredCanvasFormat().startsWith("bgra");
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const a = y * row + x * 4,
          b = (y * width + x) * 4;
        result[b] = raw[a + (bgra ? 2 : 0)];
        result[b + 1] = raw[a + 1];
        result[b + 2] = raw[a + (bgra ? 0 : 2)];
        result[b + 3] = raw[a + 3];
      }
    buffer.unmap();
    return result;
  } finally {
    buffer.destroy();
  }
}
export const difference = (a, b, tolerance = 0) => {
  check(a.length === b.length, "framebuffer size mismatch");
  let count = 0;
  for (let i = 0; i < a.length; i += 4)
    if ([0, 1, 2, 3].some((c) => Math.abs(a[i + c] - b[i + c]) > tolerance)) count++;
  return count;
};
export const png = (bytes, width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas
    .getContext("2d")
    .putImageData(new ImageData(new Uint8ClampedArray(bytes), width, height), 0, 0);
  return canvas.toDataURL();
};

async function probeNativeDebugGeometry(engine, read, document, applyOptions) {
  const doc = structuredClone(document);
  for (const instance of doc.sceneComposition.fragments.lab.instances) {
    delete instance.props.components.body;
    instance.props.components.collider = { type: "none" };
  }
  applyDataSceneAuthoringDocument(engine, doc, applyOptions);
  check(engine.pauseDataScene(), "pause native debug scene");
  engine.configureUnifiedPhysics({ space: "spatial", gravity: [0, 0, 0], lengthUnit: 100 });
  engine.configureAutoRigidBodyStep(false);
  const off = await read();
  const q = Math.SQRT1_2;
  const box = engine.spawnUnifiedPhysicsBody({
    kind: "dynamic", pose: { position: [24, 24, 0], rotation: [0, q, 0, q] },
    collider: { shape: { type: "box", halfExtents: [3, 5, 4] }, pose: { position: [8, 0, 0], rotation: [0, 0, q, q] } },
    // Render anchors must never replace the native collider pose.
    renderOffset: [300, 100, 0],
  });
  check(engine.setDataSceneSpatialDebug({ colliders: true, depthTest: false }), "enable native collider wires");
  const positions = packet => {
    const debug = packet.spatial?.debug;
    check(debug?.version === 1 && debug.vertexStride === 11 && debug.vertexCount > 0, "missing native debug packet", debug);
    const points = [];
    for (let i = 0; i < debug.vertices.length; i += 11) {
      const point = Array.from(debug.vertices.subarray(i, i + 3));
      check(point.every(Number.isFinite), "non-finite native debug endpoint", point);
      points.push(point);
    }
    return points;
  };
  const bounds = points => [0, 1, 2].map(axis => [Math.min(...points.map(p => p[axis])), Math.max(...points.map(p => p[axis]))]);
  const near = (a, b) => Math.abs(a - b) < 0.002;
  const boxCorners = (packet, minX) => {
    const expected = [[minX, minX + 8], [21, 27], [-13, -3]];
    const points = positions(packet).filter(p => p.every((v, axis) => v >= expected[axis][0] - 0.01 && v <= expected[axis][1] + 0.01));
    check(points.length === 24 && points.every(p => p.every((v, axis) => expected[axis].some(end => near(v, end)))),
      "native box parent/local rotations or offset were lost", { expected, points });
    return bounds(points);
  };
  const first = await read(), firstBounds = boxCorners(first.packet, 20);
  engine.setUnifiedPhysicsPoses(new Uint32Array([box.entityId, box.entityGeneration]), new Float32Array([40, 24, 0, 0, q, 0, q]));
  const moved = await read(), movedBounds = boxCorners(moved.packet, 36);
  const sphere = engine.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: [-30, 30, 0] }, collider: { shape: { type: "sphere", radius: 4 } } });
  engine.spawnUnifiedPhysicsBody({ kind: "kinematic-position", pose: { position: [-20, 48, 15] }, collider: { shape: { type: "capsule", halfHeight: 6, radius: 3 } } });
  const curved = await read(), points = positions(curved.packet);
  const spherePoints = points.filter(p => p[0] >= -34.01 && p[0] <= -25.99 && p[1] >= 25.99 && p[1] <= 34.01 && Math.abs(p[2]) <= 4.01);
  const capsulePoints = points.filter(p => p[0] >= -23.01 && p[0] <= -16.99 && p[1] >= 38.99 && p[1] <= 57.01 && p[2] >= 11.99 && p[2] <= 18.01);
  const sphereBounds = bounds(spherePoints), capsuleBounds = bounds(capsulePoints);
  check(spherePoints.length > 24 && sphereBounds.every((range, axis) => range.every((v, side) => near(v, [[-34, -26], [26, 34], [-4, 4]][axis][side]))), "native sphere wire extents", sphereBounds);
  check(capsulePoints.length > 24 && capsuleBounds.every((range, axis) => range.every((v, side) => near(v, [[-23, -17], [39, 57], [12, 18]][axis][side]))), "native capsule wire extents", capsuleBounds);
  engine.createUnifiedPhysicsJoint({ bodyA: box, bodyB: sphere, kind: { type: "rope", maxLength: 100 }, localFrameA: { position: [0, 6, 0] }, localFrameB: { position: [-4, 0, 0] } });
  engine.setPhysicsDebugLinesEnabled({ joints: true });
  check(engine.setDataSceneSpatialDebug({ depthTest: false }), "joint-only native overlay");
  const joint = await read(), debug = joint.packet.spatial.debug;
  let anchorSegment = false;
  for (let i = 0; i < debug.vertices.length; i += 22) {
    const a = debug.vertices.subarray(i, i + 3), b = debug.vertices.subarray(i + 11, i + 14);
    const same = (p, expected) => expected.every((v, axis) => near(p[axis], v));
    anchorSegment ||= (same(a, [40, 30, 0]) && same(b, [-34, 30, 0])) || (same(b, [40, 30, 0]) && same(a, [-34, 30, 0]));
  }
  check(anchorSegment, "native rope anchor segment not rendered", Array.from(debug.vertices));
  engine.setPhysicsDebugLinesEnabled({ colliders: true, joints: true });
  check(engine.setDataSceneSpatialDebug({ depthTest: true }), "native debug depth testing");
  const depth = await read();
  check(depth.packet.spatial.debug.depthTest && depth.stats.spatial.debugDrawCalls === 1, "native depth debug submission", depth.stats.spatial);
  check(engine.setDataSceneSpatialDebug({ depthTest: false }), "native debug overlay mode");
  const overlay = await read();
  check(!overlay.packet.spatial.debug.depthTest && difference(off.data, overlay.data, 2) > 8, "native debug geometry did not reach framebuffer");
  const warm = await read();
  check(warm.stats.spatial.debugLineCount === overlay.packet.spatial.debug.vertexCount / 2
    && warm.stats.spatial.debugUploadBytes === overlay.packet.spatial.debug.vertices.byteLength
    && warm.stats.spatial.debugDrawCalls === 1, "native debug draw costs disagree with packet", warm.stats.spatial);
  const triangles = new Uint32Array(6000 * 3);
  for (let i = 0; i < triangles.length; i += 3) triangles.set([0, 1, 2], i);
  engine.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: [0, 24, 0] }, collider: { shape: { type: "triangleMesh", vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], triangles } } });
  const capped = await read(), capDebug = capped.packet.spatial.debug;
  check(capDebug.truncated && capDebug.vertexCount > 0 && capDebug.vertexCount <= 32768
    && capped.stats.spatial.debugTruncated && capped.stats.spatial.debugUploadBytes <= 32768 * 44,
    "large native mesh bypassed debug cap", { packet: { count: capDebug.vertexCount, truncated: capDebug.truncated }, stats: capped.stats.spatial });
  check(capped.nativeDebug?.truncated && capped.nativeDebug.workUnits <= 65536 && capped.nativeDebug.unsupportedShapes === 0,
    "native extraction work cap was not observable", capped.nativeDebug);
  const emptyPacket = { ...capped.packet, spatial: { ...capped.packet.spatial, debug: { ...capDebug, vertices: new Float32Array(), vertexCount: 0, truncated: true } } };
  const empty = await read(emptyPacket);
  check(empty.stats.spatial.debugTruncated && empty.stats.spatial.debugDrawCalls === 0 && empty.stats.spatial.debugUploadBytes === 0,
    "empty truncated native packet lost renderer diagnostics", empty.stats.spatial);
  engine.setPhysicsDebugLinesEnabled(false);
  check(engine.setDataSceneSpatialDebug(null), "disable native diagnostics");
  const disabled = await read();
  check(!disabled.packet.spatial.debug && disabled.stats.spatial.debugDrawCalls === 0 && !disabled.stats.spatial.debugTruncated
    && difference(off.data, disabled.data, 1) === 0, "disabled native debug changed framebuffer or retained diagnostics", disabled.stats.spatial);
  return { firstBounds, movedBounds, sphereBounds, capsuleBounds, anchorSegment,
    renderedPixelsChanged: difference(off.data, overlay.data, 2), debugLines: overlay.stats.spatial.debugLineCount,
    cappedVertices: capDebug.vertexCount, nativeWork: capped.nativeDebug, emptyTruncatedPreserved: true, disabledMatches: true };
}

async function probe(canvas, backend, projection, recover=false) {
  if (backend === "webgpu") canvas.dataset.spatialGpuTarget = "true";
  const fallbacks = [];
  const renderer = await createRenderer(canvas, {
    onFallback: (info) => fallbacks.push(String(info.reason)),
    preferred: backend,
    fallbackBehavior: "silent",
    webgl2: { preserveDrawingBuffer: true, clearColor: [0.04, 0.07, 0.12, 1] },
    webgpu: { clearColor: [0.04, 0.07, 0.12, 1] },
  });
  check(
    (typeof renderer.gpuDevice === "function") === (backend === "webgpu"),
    "required renderer was replaced by fallback",
    { backend, fallbacks },
  );
  const errors = [],
    registry = createSceneInstanceHandleRegistry(),
    rows = [],
    applyOptions = { instanceHandleRegistry: registry };
  let engine,
    handles,
    request,
    lastPacket,
    disposing = false, testingLoss = false;
  const components = (texture, floorId, elevation, width = 20, height = 32) => ({
    visual: { kind: "sprite", texture, width, height, originY: 1 },
    collider: { type: "aabb", halfWidth: 2, halfHeight: 2 },
    layer: "player",
    body: { type: "kinematic", heightSpan: { floorId, elevation, height: 8 } },
  });
  const doc = {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    gameplay: { primaryActor: "actor" },
    sceneComposition: {
      initialFragment: "lab",
      prefabs: { sprite: {} },
      fragments: {
        lab: {
          instances: [
            {
              id: "actor",
              prefab: "sprite",
              x: -45,
              y: 22,
              props: { components: components(1, 0, 0) },
            },
            {
              id: "tree",
              prefab: "sprite",
              x: -45,
              y: 20,
              props: { components: components(3, 0, 0, 32, 48) },
            },
            {
              id: "under",
              prefab: "sprite",
              x: 20,
              y: 70,
              props: { components: components(2, 0, 0) },
            },
            {
              id: "above",
              prefab: "sprite",
              x: 20,
              y: 50,
              props: { components: components(1, 1, 48) },
            },
          ],
        },
      },
    },
    behaviorRecipes: { entities: {} },
    spatial: {
      camera: {
        projection,
        position: { x: 120, y: -160, elevation: 240 },
        target: { x: 0, y: 40, elevation: 24 },
        height: Math.max(240, (240 * canvas.clientHeight) / canvas.clientWidth),
        fovDegrees: 70,
        near: 0.1,
        far: 2000,
      },
      terrain: [
        {
          id: "ground",
          x: -128,
          y: -64,
          width: 256,
          depth: 256,
          elevation: 0,
          color: [0.15, 0.2, 0.25, 1],
        },
        {
          id: "bridge",
          x: -20,
          y: 16,
          width: 80,
          depth: 80,
          elevation: 48,
          baseElevation: 40,
          floorId: 1,
          kind: "bridge",
          color: [0.4, 0.3, 0.1, 1],
        },
      ],
      billboards: { actor: {}, tree: {}, under: {}, above: {} },
    },
  };
  const until = async (predicate) => {
    const deadline = performance.now() + 15000;
    while (!predicate()) {
      check(!errors.length && performance.now() < deadline, "WebGPU spatial probe stalled", {
        backend,
        projection,
        errors,
      });
      await tick();
    }
  };
  const read = async (packet) => {
    check(!request, "overlapping readback");
    const result = new Promise((resolve, reject) => {
      request = { resolve, reject, packet };
    });
    engine.start();
    return result;
  };
  if (backend === "webgpu") {
    renderer
      .gpuDevice()
      .addEventListener("uncapturederror", (event) => errors.push(event.error.message));
    renderer.gpuDevice().lost.then((info) => {
      if (!disposing && !testingLoss) errors.push(`device lost (${info.reason}): ${info.message}`);
    });
  }
  try {
    const image = document.createElement("canvas");
    image.width = image.height = 32;
    const ctx = image.getContext("2d");
    for (const [id, color] of [
      [1, "#ff2020"],
      [2, "#2020ff"],
      [3, "#20ff20"],
    ]) {
      ctx.clearRect(0, 0, 32, 32);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 32, 32);
      if (id === 3) ctx.clearRect(8, 8, 16, 16);
      if(recover&&id===3){
        const url=URL.createObjectURL(await(await fetch(image.toDataURL())).blob());
        try{await renderer.loadTexture(id,url);}finally{URL.revokeObjectURL(url);}
      }else await renderer.loadTexture(id, image.toDataURL());
    }
    engine = await createEngine(
      (state) => {
        if (!handles) return;
        const pending = request;
        request = undefined;
        try {
          const packet = pending?.packet ?? state.renderCommandBuffer;
          renderer.render();
          const stats = renderer.renderCommands(packet);
          renderer.renderPostProcess();
          check(
            stats.spatial?.billboardCount === 4 &&
              stats.spatial.triangleCount === 32 &&
              stats.drawCalls > 0,
            "missing depth-tested scene",
            stats,
          );
          rows.push({ rustMs: state.rustUpdateTimeMs, stats });
          check(rows.length < 300, "spatial frame budget exceeded");
          // Capture/restore may grow memory: retain owned copies, never borrowed views across readback.
          const s = packet.spatial;
          lastPacket = {
            ...packet,
            buffer: packet.buffer.slice(),
            spatial: {
              ...s,
              camera: s.camera.slice(),
              terrain: s.terrain.slice(),
              billboards: s.billboards.slice(),
              terrainDrawRanges: s.terrainDrawRanges?.slice(),
              materials: s.materials && {
                ...s.materials,
                terrain: s.materials.terrain.slice(),
                billboards: s.materials.billboards.slice(),
              },
              debug: s.debug && { ...s.debug, vertices: s.debug.vertices.slice() },
            },
          };
          if (pending) {
            engine.stop();
            pixels(renderer, canvas).then(
              (data) => pending.resolve({ data, stats, packet: lastPacket, nativeDebug: state.unifiedPhysics?.debug && { ...state.unifiedPhysics.debug } }),
              (error) => pending.reject(Error(`${error}: ${JSON.stringify(errors)}`)),
            );
          }
        } catch (error) {
          errors.push(String(error));
          engine.stop();
          pending?.reject(error);
        }
      },
      undefined,
      undefined,
      () => renderer.viewportSize(),
      // Request frame extraction, with categories enabled explicitly by each phase.
      { includePhysicsDebugLines: true, physicsDebugOptions: {} },
    );
    renderer.resize();
    const size = renderer.viewportSize();
    engine.setViewportSize(size.width, size.height);
    handles = applyDataSceneAuthoringDocument(engine, doc, applyOptions).entityHandles;
    check(engine.pauseDataScene(), "pause rejected");
    const first = await read(),
      warm = await read();
    check(warm.stats.spatial.terrainUploadBytes === 0, "static terrain reuploaded");
    // Reapply the authored scene without requesting a native physics checkpoint.
    const capture = () =>
      captureGameStateSnapshot(engine, {
        includeDataSceneState: true,
        dataSceneAuthoringDocument: doc,
      });
    const saved = JSON.parse(JSON.stringify(capture())),
      old = handles.actor;
    restoreGameStateSnapshot(engine, saved, { dataSceneAuthoringApplyOptions: applyOptions });
    handles = Object.fromEntries(
      registry.entries().map((entry) => [entry.instanceId, entry.handle]),
    );
    check(
      old.entityId !== handles.actor.entityId ||
        old.entityGeneration !== handles.actor.entityGeneration,
      "restore retained stale handle",
    );
    const restored = await read();
    check(difference(first.data, restored.data) === 0, "fresh restore changed framebuffer");
    const reverse = {
      ...restored.packet,
      spatial: {
        ...restored.packet.spatial,
        billboards: restored.packet.spatial.billboards.slice(),
      },
    };
    const stride = 66,
      vertices = reverse.spatial.billboards;
    for (let i = 0; i < vertices.length; i += stride)
      vertices.set(
        restored.packet.spatial.billboards.subarray(
          vertices.length - i - stride,
          vertices.length - i,
        ),
        i,
      );
    const reversed = await read(reverse);
    check(difference(restored.data, reversed.data) === 0, "depth depends on submission order");
    const colors = { red: 0, green: 0, blue: 0 };
    for (let i = 0; i < first.data.length; i += 4) {
      const [r, g, b] = first.data.subarray(i, i + 3);
      if (r > g + 100 && r > b + 100) colors.red++;
      if (g > r + 100 && g > b + 100) colors.green++;
      if (b > r + 100 && b > g + 100) colors.blue++;
    }
    check(
      colors.red > 10 && colors.green > 10 && colors.blue === 0,
      "billboard/bridge cutout visibility wrong",
      colors,
    );
    const view = createDataSceneSpatialView(engine, canvas),
      point = view.project({ x: 20, y: 50, elevation: 48 }, restored.packet.spatial),
      hit = view.pick(point, restored.packet.spatial);
    check(
      hit?.surfaceId === "bridge" && Math.hypot(hit.x - 20, hit.y - 50) < 0.01,
      "camera/depth/picking disagree",
      hit,
    );
    const sample = (point) => {
      const p = view.project(point, restored.packet.spatial);
      check(p?.visible, "pixel acceptance point is outside camera", p);
      const x = Math.round((p.x * canvas.width) / canvas.clientWidth),
        y = Math.round((p.y * canvas.height) / canvas.clientHeight);
      return Array.from(
        restored.data.subarray((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4),
      );
    };
    const holePixel = sample({ x: -45, y: 20, elevation: 24 }),
      abovePixel = sample({ x: 20, y: 50, elevation: 64 });
    check(
      [holePixel, abovePixel].every((c) => c[0] > c[1] + 100 && c[0] > c[2] + 100),
      "cutout hole or raised actor did not reveal red pixel",
      { holePixel, abovePixel },
    );

    let recovery;
    if(recover){
      const old=renderer.gpuDevice(),generation=renderer.deviceState().generation;
      testingLoss=true;old.destroy();await old.lost;await Promise.resolve();
      check(renderer.deviceState().status==='lost','device loss was not observed');
      renderer.render();renderer.renderPostProcess();
      const first=renderer.recoverDevice();check(first===renderer.recoverDevice(),'concurrent recovery did not coalesce');await first;
      check(renderer.gpuDevice()!==old&&renderer.deviceState().generation===generation+1,'device not replaced');
      const after=await read(lastPacket),diff=difference(after.data,restored.data,1);
      check(diff===0,'recovered textures/depth/cutout changed pixels',diff);
      recovery={status:renderer.deviceState().status,generation:renderer.deviceState().generation,differentPixels:diff,coalesced:true};
    }

    const nativeDebug = await probeNativeDebugGeometry(engine, read, doc, applyOptions);
    check(
      rows.every((row) => row.rustMs < 250) && !errors.length,
      "spatial work/errors exceeded gate",
      errors,
    );
    return {
      backend,
      projection,
      recovery,
      nativeDebug,
      adapter:
        backend === "webgpu"
          ? {
              vendor: renderer.gpuAdapter().info.vendor,
              architecture: renderer.gpuAdapter().info.architecture,
              isFallbackAdapter: renderer.gpuAdapter().info.isFallbackAdapter,
            }
          : undefined,
      colors,
      holePixel,
      abovePixel,
      frames: rows.length,
      restored: true,
      reversed: true,
      picked: hit.surfaceId,
      warmTerrainUpload: warm.stats.spatial.terrainUploadBytes,
      stats: restored.stats.spatial,
      image: png(first.data, canvas.width, canvas.height),
      data: first.data,
      errors,
    };
  } finally {
    disposing = true;
    const device = backend === "webgpu" ? renderer.gpuDevice() : undefined;
    engine?.destroy();
    renderer.destroy();
    window.disposeSpatialGpuTarget?.(canvas);
    device?.destroy();
  }
}

export async function probeSpatialWebGpu() {
  const results = [];
  for (const projection of ["orthographic", "perspective"]) {
    const pair = [];
    for (const backend of ["webgl2", "webgpu"]) {
      const canvas = document.createElement("canvas");
      document.body.replaceChildren(canvas);
      pair.push(await probe(canvas, backend, projection));
    }
    const diff = difference(pair[0].data, pair[1].data, 3),
      pixels = pair[0].data.length / 4;
    check(diff < pixels * 0.01, "WebGL2/WebGPU depth/cutout parity failed", {
      diff,
      pixels,
      projection,
    });
    results.push({
      projection,
      differentPixels: diff,
      pixelCount: pixels,
      backends: pair.map(({ data, ...entry }) => entry),
    });
  }
  return results;
}

export async function probeSpatialFallbacks() {
  const results = [];
  for (const kind of ["postprocess", "adapter"]) {
    const canvas = document.createElement("canvas");
    document.body.replaceChildren(canvas);
    const calls = [];
    const options =
      kind === "postprocess"
        ? {
            webgpu: { postProcess: [{ kind: "bloom", threshold: 2 }] },
            webgl2: { postProcess: [{ kind: "bloom" }] },
          }
        : { colorManagement: "linear-srgb" };
    const gpu=navigator.gpu, original=gpu.requestAdapter;
    let renderer;
    try {
      if(kind==="adapter")gpu.requestAdapter=async()=>{throw Error("injected managed adapter failure");};
      renderer=await createRenderer(canvas, {preferred:"webgpu",fallbackBehavior:"silent",onFallback:info=>calls.push(String(info.reason)),...options});
    } finally { gpu.requestAdapter=original; }
    try {
      check(
        typeof renderer.gpuDevice !== "function" && calls.length === 1,
        "unsupported mode did not fallback before context",
        { kind, calls },
      );
      check(
        canvas.getContext("webgl2") && canvas.getContext("webgpu") === null,
        "fallback committed wrong canvas API",
        kind,
      );
      renderer.render();
      const stats = renderer.renderPostProcess();
      check(canvas.getContext("webgl2").getError() === 0, "fallback produced GL error", kind);
      if (kind === "postprocess")
        check(stats.postProcessPassCount > 0, "fallback lost bloom", stats);
      else check(renderer.colorManagement === "linear-srgb", "fallback lost color-management mode");
      results.push({ kind, backend: "webgl2", calls });
    } finally {
      renderer.destroy();
    }
  }
  const spatial = {
    camera: {
      projection: "orthographic",
      position: { x: 0, y: -100, elevation: 100 },
      target: { x: 0, y: 0, elevation: 0 },
      height: 160,
    },
    terrain: [],
    billboards: {},
    environment: {
      lighting: {
        lights: [{ position: { x: 0, y: 0, elevation: 50 }, radius: 200 }],
        shadows: { lightIndex: 0 },
        directional: { direction: { x: -1, y: -1, elevation: 2 }, shadows: { resolution: 128 } },
      },
    },
  };
  for (const kind of ["spatial", "runtime-spatial"]) {
    const target = document.createElement("canvas");
    target.dataset.spatialGpuTarget = "true";
    document.body.replaceChildren(target);
    let runtime, gpu;
    try {
      if (kind === "spatial")
        gpu = await createRenderer(target, {
          preferred: "webgpu",
          fallbackBehavior: "silent",
          spatial,
        });
      else {
        const doc = {
          format: "ferrum2d.consumer.scene-authoring",
          version: 1,
          sceneComposition: {
            initialFragment: "lab",
            prefabs: {},
            fragments: { lab: { instances: [] } },
          },
          behaviorRecipes: { entities: {} },
          spatial,
        };
        runtime = await createFerrumRuntime({
          canvas: target,
          rendererPreference: "webgpu",
          dataScene: doc,
          autostart: false,
        });
        gpu = runtime.renderer;
      }
      check(
        typeof gpu.gpuDevice === "function" &&
          typeof target.getContext("webgpu")?.getCurrentTexture === "function",
        "supported shadows did not retain WebGPU",
        kind,
      );
      results.push({ kind, backend: "webgpu", authoredRequirements: true, shadows: true });
    } finally {
      const device = gpu?.gpuDevice();
      if (runtime) runtime.destroy();
      else gpu?.destroy();
      window.disposeSpatialGpuTarget?.(target);
      device?.destroy();
    }
  }
  return results;
}

export async function probeSpatialRecovery(){
  const canvas=document.createElement('canvas');document.body.replaceChildren(canvas);
  const {data,...result}=await probe(canvas,'webgpu','orthographic',true);return result;
}

export async function probeFlatFitRecovery() {
  const canvas = document.createElement("canvas");
  if (window.disposeSpatialGpuTarget) canvas.dataset.spatialGpuTarget = "true";
  const resize = (width, height) => {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    window.dispatchEvent(new Event("resize"));
  };
  document.body.replaceChildren(canvas);
  resize(640, 360);
  const fit = { width: 320, height: 180 };
  let frames = 0;
  const runtime = await createFerrumRuntime({
    canvas, rendererPreference: "webgpu", fit, onFrame: () => { frames++; },
    dataScene: {
      format: "ferrum2d.consumer.scene-authoring",
      version: 1,
      sceneComposition: { initialFragment: "main", prefabs: {}, fragments: { main: { instances: [] } } },
      behaviorRecipes: { entities: {} },
    },
  });
  try {
    const renderer = runtime.renderer;
    check(runtime.rendererBackend === "webgpu", "Fit recovery requires a real WebGPU device");
    runtime.start();
    runtime.pause();
    const view = runtime.dataScene.view;
    const center = { x: 37, y: 52 };
    view.setCamera({ ...center, smoothTimeSeconds: 0 });
    const device = renderer.gpuDevice();
    device.destroy();
    await device.lost;
    check(renderer.deviceState().status === "lost", "WebGPU device loss was not observed");
    resize(480, 240);
    const recovered = renderer.recoverDevice();
    check(renderer.deviceState().status === "recovering", "WebGPU recovery was not pending");
    resize(350, 460);
    await recovered;
    const logicalViewport = renderer.viewportSize();
    const camera = { x: runtime.engine.cameraX(), y: runtime.engine.cameraY() };
    const point = view.worldToScreen(center);
    const snapshot = view.snapshot();
    return { generation: renderer.deviceState().generation, frames, camera, point, logicalViewport, zoom: snapshot.zoom };
  } finally {
    runtime.destroy();
    window.disposeSpatialGpuTarget?.(canvas);
    canvas.remove();
  }
}
