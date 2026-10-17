import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";
import { captureGameStateSnapshot } from "@ferrum2d/ferrum-web/core";

export async function probeSpatialTerrainChunks(scene, canvas) {
  const { engine, renderer, view } = scene;
  const gl = canvas.getContext("webgl2");
  const check = (ok, message, evidence) => {
    if (!ok) throw Error(`${message}: ${JSON.stringify(evidence)}`);
  };
  const wait = async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  };
  const image = () => {
    const bytes = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      bytes,
    );
    return bytes;
  };
  const renderObserved = (packet) => {
    const observed = {
      draws: [],
      uploadBytes: 0,
      bufferUploads: 0,
      unexpectedDraws: 0,
    };
    const original = {
      drawArrays: gl.drawArrays,
      bufferData: gl.bufferData,
      bufferSubData: gl.bufferSubData,
      drawElements: gl.drawElements,
      drawArraysInstanced: gl.drawArraysInstanced,
      drawElementsInstanced: gl.drawElementsInstanced,
    };
    gl.drawArrays = function (mode, first, count) {
      observed.draws.push({ mode, first, count });
      return original.drawArrays.call(this, mode, first, count);
    };
    for (const name of ["bufferData", "bufferSubData"]) {
      gl[name] = function (...args) {
        const data = args[name === "bufferData" ? 1 : 2];
        observed.bufferUploads++;
        observed.uploadBytes +=
          typeof data === "number" ? data : (data?.byteLength ?? 0);
        return original[name].apply(this, args);
      };
    }
    for (const name of [
      "drawElements",
      "drawArraysInstanced",
      "drawElementsInstanced",
    ]) {
      gl[name] = function (...args) {
        observed.unexpectedDraws++;
        return original[name].apply(this, args);
      };
    }
    try {
      renderer.render();
      const metrics = { ...renderer.renderCommands(packet).spatial };
      renderer.renderPostProcess();
      check(
        observed.unexpectedDraws === 0,
        "unmeasured spatial GL submission",
        observed,
      );
      return { metrics, observed };
    } finally {
      for (const name of Object.keys(original)) gl[name] = original[name];
    }
  };
  const terrain = Array.from({ length: 256 }, (_, i) => ({
    id: `chunk-${i}`,
    x: ((i % 16) - 8) * 96,
    y: (Math.floor(i / 16) - 8) * 96,
    width: 80,
    depth: 80,
    elevation: (i % 4) * 16,
    textureId: i % 2 === 0 ? 1 : 2,
  }));
  const camera = {
    projection: "orthographic",
    position: { x: 220, y: -320, elevation: 320 },
    target: { x: 0, y: 0, elevation: 24 },
    height: 360,
    fovDegrees: 60,
    near: 0.1,
    far: 2500,
  };
  const doc = {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    sceneComposition: {
      initialFragment: "chunks",
      prefabs: {},
      fragments: { chunks: { instances: [] } },
    },
    behaviorRecipes: { entities: {} },
    spatial: { camera, terrain, billboards: {} },
  };
  applyDataSceneAuthoringDocument(engine, doc);
  engine.pauseDataScene();
  await wait();
  const revision = scene.frame.spatial.terrainRevision;
  const staticVertices = scene.frame.spatial.terrainVertexCount;
  const allocated = JSON.stringify(window.spatialGpuResources().created);
  const scenarios = [
    { name: "orthographic", camera },
    { name: "perspective", camera: { ...camera, projection: "perspective" } },
    {
      name: "zoom-move",
      camera: {
        ...camera,
        height: 180,
        position: { x: -180, y: -250, elevation: 160 },
        target: { x: -96, y: 96, elevation: 32 },
      },
    },
    {
      name: "orbit",
      camera: {
        ...camera,
        projection: "perspective",
        position: { x: -360, y: 220, elevation: 220 },
        target: { x: 160, y: 120, elevation: 32 },
        fovDegrees: 75,
      },
    },
    {
      name: "near",
      camera: {
        ...camera,
        projection: "perspective",
        position: { x: 0, y: -100, elevation: 80 },
        target: { x: 0, y: 0, elevation: 32 },
        near: 110,
      },
    },
    {
      name: "empty",
      camera: {
        ...camera,
        position: { x: 5000, y: 4680, elevation: 320 },
        target: { x: 5000, y: 5000, elevation: 24 },
      },
    },
    { name: "return", camera },
  ];
  const cases = [];
  for (const scenario of scenarios) {
    check(scene.setCamera(scenario.camera), "chunk camera rejected", scenario);
    await wait();
    const packet = scene.frame.state.renderCommandBuffer,
      spatial = packet.spatial;
    check(
      spatial.version === 2 && spatial.terrainDrawRanges instanceof Uint32Array,
      "missing actual Wasm terrain ranges",
    );
    const ranges = spatial.terrainDrawRanges.slice();
    const submitted = Array.from(
      { length: ranges.length / 2 },
      (_, i) => ranges[i * 2 + 1],
    ).reduce((sum, n) => sum + n, 0);
    const measured = renderObserved(packet);
    const metrics = measured.metrics;
    check(
      measured.observed.draws.length === metrics.drawCalls &&
        measured.observed.draws.reduce((sum, d) => sum + d.count, 0) ===
          submitted &&
        measured.observed.uploadBytes === 0 &&
        measured.observed.bufferUploads === 0,
      "actual GL submission/upload exceeds native ranges",
      measured,
    );
    check(
      measured.observed.draws.every(
        (d) =>
          d.mode === gl.TRIANGLES &&
          Array.from({ length: ranges.length / 2 }, (_, i) => i * 2).some(
            (i) =>
              d.first >= ranges[i] &&
              d.first + d.count <= ranges[i] + ranges[i + 1],
          ),
      ),
      "GL draw escaped absolute terrain range",
      measured.observed,
    );
    check(
      engine.dataSceneState() === "paused" &&
        staticVertices === 256 * 36 &&
        spatial.terrainVertexCount === staticVertices &&
        spatial.terrainRevision === revision,
      "chunk culling changed scene source",
      { staticVertices, revision, spatialRevision: spatial.terrainRevision },
    );
    check(
      metrics.terrainChunkCount === 256 &&
        metrics.visibleTerrainChunkCount === submitted / 36 &&
        metrics.culledTerrainChunkCount === 256 - submitted / 36 &&
        metrics.terrainTriangleCount === submitted / 3 &&
        metrics.triangleCount === submitted / 3 &&
        metrics.uploadBytes === 0 &&
        metrics.terrainUploadBytes === 0,
      "terrain culling metrics/upload mismatch",
      metrics,
    );
    if (scenario.name === "empty")
      check(
        ranges.length === 0 &&
          metrics.drawCalls === 0 &&
          metrics.triangleCount === 0,
        "empty ranges submitted terrain",
        metrics,
      );
    else
      check(
        metrics.visibleTerrainChunkCount > 0 &&
          metrics.visibleTerrainChunkCount < 256 &&
          metrics.drawCalls <= metrics.visibleTerrainChunkCount &&
          ranges[0] > 0,
        "nonempty chunk culling did not reduce geometry",
        { metrics, ranges: [...ranges] },
      );
    const culledPixels = image();
    // v1 full submission is a reference image against the exact same static mesh and camera.
    const { terrainDrawRanges: _ranges, ...legacy } = spatial;
    const reference = renderObserved({
      ...packet,
      spatial: { ...legacy, version: 1 },
    });
    const full = reference.metrics;
    check(
      reference.observed.draws.reduce((sum, d) => sum + d.count, 0) ===
        staticVertices &&
        reference.observed.draws.length === full.drawCalls &&
        reference.observed.bufferUploads === 0,
      "v1 actual GL reference submission/upload mismatch",
      reference,
    );
    const fullPixels = image();
    let differences = 0;
    for (let i = 0; i < fullPixels.length; i++)
      if (Math.abs(fullPixels[i] - culledPixels[i]) > 3) differences++;
    check(differences === 0, "chunk culling changed reference framebuffer", {
      name: scenario.name,
      differences,
      ranges: [...ranges],
    });
    check(
      full.terrainTriangleCount === 256 * 12 && full.drawCalls === 256,
      "v1 reference did not submit all terrain",
      full,
    );
    check(
      JSON.stringify(window.spatialGpuResources().created) === allocated,
      "camera culling allocated GPU objects",
    );
    let hit;
    if (ranges.length) {
      const index = ranges[0] / 36,
        surface = terrain[index];
      const screen = view.project(
        { x: surface.x + 40, y: surface.y + 40, elevation: surface.elevation },
        spatial,
      );
      if (screen?.visible) {
        hit = view.pick(screen, spatial);
        check(
          hit && terrain.some((t) => t.id === hit.surfaceId),
          "full terrain picking lost stable surface identity",
          { screen, hit },
        );
      }
    }
    cases.push({
      name: scenario.name,
      ranges: [...ranges],
      metrics,
      fullReference: full,
      actualGL: measured.observed,
      referenceGL: reference.observed,
      pixelDifferences: differences,
      hit,
    });
  }
  // Capture remains valid after camera-only culling; draw metadata is transient, never save identity.
  const saved = captureGameStateSnapshot(engine, {
    includeDataSceneState: true,
    includeDataSceneProgress: true,
    dataSceneAuthoringDocument: doc,
  });
  check(
    saved.dataScene.version === 6 &&
      !JSON.stringify(saved).includes("terrainDrawRanges"),
    "draw metadata leaked into spatial progress",
  );
  await wait();
  const packet = scene.frame.state.renderCommandBuffer,
    spatial = packet.spatial;
  const originalDraw = gl.drawArrays;
  let draws = 0,
    rejected = 0;
  gl.drawArrays = function (...args) {
    draws++;
    return originalDraw.apply(this, args);
  };
  try {
    for (const ranges of [
      undefined,
      new Uint32Array([0]),
      new Uint32Array([1, 36]),
      new Uint32Array([0, 35]),
      new Uint32Array([0, 0]),
      new Uint32Array([0, 72, 36, 36]),
      new Uint32Array([36, 36, 0, 36]),
      new Uint32Array([staticVertices, 36]),
      new Float32Array([0, 36]),
    ]) {
      let failed = false;
      try {
        renderer.renderCommands({
          ...packet,
          spatial: { ...spatial, terrainDrawRanges: ranges },
        });
      } catch (e) {
        failed = /spatial terrain draw range/i.test(String(e));
      }
      check(
        failed,
        "invalid range packet was accepted",
        ranges === undefined ? "missing" : [...ranges],
      );
      rejected++;
    }
    check(draws === 0, "invalid range packet partially submitted geometry", {
      draws,
    });
  } finally {
    gl.drawArrays = originalDraw;
  }
  const measuredEmpty = renderObserved({
    ...packet,
    spatial: { ...spatial, terrainDrawRanges: new Uint32Array() },
  });
  const empty = measuredEmpty.metrics;
  check(
    measuredEmpty.observed.draws.length === 0 &&
      measuredEmpty.observed.bufferUploads === 0,
    "empty range issued actual GL work",
    measuredEmpty,
  );
  check(
    empty.drawCalls === 0 &&
      empty.triangleCount === 0 &&
      empty.terrainUploadBytes === 0,
    "explicit empty range fell back to full terrain",
    empty,
  );
  const blank = image();
  check(
    blank.every((value, i) => value === blank[i % 4]),
    "empty range retained terrain pixels",
  );
  // At large depth, GPU f32 clip.z and clip.w may round equal beyond the mathematical far plane.
  const farCamera = {
    ...camera,
    projection: "perspective",
    position: { x: 0, y: 0, elevation: 0 },
    target: { x: 0, y: 1, elevation: 0 },
    near: 0.1,
    far: 10000,
  };
  applyDataSceneAuthoringDocument(engine, {
    ...doc,
    spatial: {
      camera: farCamera,
      terrain: [
        {
          id: "far-roundoff",
          x: -256,
          y: 10047,
          width: 512,
          depth: 1,
          elevation: 64,
          textureId: 1,
        },
      ],
      billboards: {},
    },
  });
  engine.pauseDataScene();
  await wait();
  const farPacket = scene.frame.state.renderCommandBuffer;
  const farCull = renderObserved(farPacket),
    farPixels = image();
  const { terrainDrawRanges: farRanges, ...farLegacy } = farPacket.spatial;
  const farReference = renderObserved({
    ...farPacket,
    spatial: { ...farLegacy, version: 1 },
  });
  const farFull = image();
  let farDifferences = 0,
    farColoredPixels = 0;
  for (let i = 0; i < farFull.length; i++)
    if (Math.abs(farFull[i] - farPixels[i]) > 3) farDifferences++;
  for (let i = 0; i < farFull.length; i += 4)
    if (farFull[i] > 80 && farFull[i] > farFull[i + 2] * 2) farColoredPixels++;
  check(
    farColoredPixels > 0 && farDifferences === 0 && farRanges.length === 2,
    "far-plane cancellation incorrectly culled GPU-visible terrain",
    { farColoredPixels, farDifferences, ranges: [...farRanges] },
  );
  return {
    cases,
    invalidPacketsRejected: rejected,
    invalidPacketDrawCalls: draws,
    staticVertexCount: staticVertices,
    explicitEmpty: empty,
    explicitEmptyGL: measuredEmpty.observed,
    farPlaneReference: {
      pixelDifferences: farDifferences,
      coloredPixels: farColoredPixels,
      ranges: [...farRanges],
      actualGL: farCull.observed,
      referenceGL: farReference.observed,
    },
    saveVersion: saved.dataScene.version,
  };
}
