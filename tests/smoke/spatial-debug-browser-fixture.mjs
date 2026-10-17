import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";
import { captureGameStateSnapshot } from "@ferrum2d/ferrum-web/core";

export async function probeSpatialDebug(scene, canvas) {
  const { engine, renderer, view } = scene;
  const gl = canvas.getContext("webgl2");
  const check = (value, message, evidence) => {
    if (!value) throw Error(`${message}: ${JSON.stringify(evidence)}`);
  };
  const wait = async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  };
  const image = () => {
    const data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    );
    return data;
  };
  // WebGL line coverage may be partially resolved by MSAA; distinguish diagnostic hues from the gray occluder.
  const colors = (data) => {
    const result = { cyan: 0, yellow: 0, magenta: 0 };
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = data.subarray(i, i + 3);
      if (r < 90 && g > 110 && b > 110) result.cyan++;
      if (r > 110 && g > 110 && b < 90) result.yellow++;
      if (r > 110 && g < 90 && b > 110) result.magenta++;
    }
    return result;
  };
  const draw = (packet = scene.frame.spatial) => {
    const observed = { lines: [], uploads: [], otherDraws: 0 };
    const original = {
      drawArrays: gl.drawArrays,
      bufferData: gl.bufferData,
      bufferSubData: gl.bufferSubData,
    };
    gl.drawArrays = function (mode, first, count) {
      if (mode === gl.LINES)
        observed.lines.push({
          first,
          count,
          depthTest: gl.isEnabled(gl.DEPTH_TEST),
          depthWrite: gl.getParameter(gl.DEPTH_WRITEMASK),
        });
      else if (mode !== gl.TRIANGLES) observed.otherDraws++;
      return original.drawArrays.call(this, mode, first, count);
    };
    for (const name of ["bufferData", "bufferSubData"])
      gl[name] = function (...args) {
        const data = args[name === "bufferData" ? 1 : 2];
        observed.uploads.push({
          name,
          bytes: typeof data === "number" ? data : (data?.byteLength ?? 0),
        });
        return original[name].apply(this, args);
      };
    const before = {
      depth: gl.isEnabled(gl.DEPTH_TEST),
      write: gl.getParameter(gl.DEPTH_WRITEMASK),
      func: gl.getParameter(gl.DEPTH_FUNC),
    };
    try {
      renderer.render();
      const stats = {
        ...renderer.renderCommands({
          ...scene.frame.state.renderCommandBuffer,
          spatial: packet,
        }).spatial,
      };
      renderer.renderPostProcess();
      check(
        gl.isEnabled(gl.DEPTH_TEST) === before.depth &&
          gl.getParameter(gl.DEPTH_WRITEMASK) === before.write &&
          gl.getParameter(gl.DEPTH_FUNC) === before.func,
        "debug leaked depth state",
      );
      check(observed.otherDraws === 0, "unexpected debug primitive", observed);
      return { stats, observed, pixels: image() };
    } finally {
      for (const name of Object.keys(original)) gl[name] = original[name];
    }
  };
  const camera = {
    projection: "orthographic",
    position: { x: 0, y: -200, elevation: 32 },
    target: { x: 0, y: 0, elevation: 32 },
    height: 160,
    near: 0.1,
    far: 1000,
  };
  const document = {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    sceneComposition: {
      initialFragment: "debug",
      prefabs: {
        actor: {
          props: {
            components: {
              visual: {
                kind: "sprite",
                texture: 1,
                width: 32,
                height: 32,
                originY: 1,
              },
              collider: {
                type: "aabb",
                halfWidth: 2,
                halfHeight: 2,
                isTrigger: false,
              },
              layer: "player",
              body: {
                type: "kinematic",
                heightSpan: { floorId: 0, elevation: 16, height: 24 },
              },
            },
          },
        },
      },
      fragments: {
        debug: { instances: [{ id: "actor", prefab: "actor", x: 0, y: 0 }] },
      },
    },
    behaviorRecipes: { entities: {} },
    spatial: {
      camera,
      terrain: [
        {
          id: "occluder",
          x: -60,
          y: -40,
          width: 120,
          depth: 80,
          elevation: 64,
          color: [0.2, 0.3, 0.4, 1],
          walkable: false,
        },
      ],
      billboards: { actor: { elevation: 8 } },
    },
  };
  const handles = applyDataSceneAuthoringDocument(
    engine,
    document,
  ).entityHandles;
  engine.pauseDataScene();
  await wait();
  check(
    engine.dataSceneState() === "paused" &&
      scene.frame.spatial.debug === undefined,
    "debug must start disabled",
  );
  const baseline = draw();
  const revision = scene.frame.spatial.terrainRevision;
  const snapshot = () =>
    captureGameStateSnapshot(engine, {
      includeDataSceneState: true,
      includeDataSceneProgress: true,
      dataSceneAuthoringDocument: document,
    });
  const progress = snapshot().dataScene.progress;
  const cases = [];
  for (const depthTest of [true, false]) {
    check(
      engine.setDataSceneSpatialDebug({
        billboards: true,
        heightSpans: true,
        depthTest,
      }),
      "enable spatial diagnostics",
    );
    await wait();
    const packet = scene.frame.spatial;
    const debug = packet.debug;
    const result = draw(packet);
    const palette = colors(result.pixels);
    const screenshot = await window.spatialDebugScreenshot?.(
      depthTest ? "depth" : "overlay",
      canvas.toDataURL("image/png"),
    );
    check(
      debug.vertexCount === 22 &&
        result.stats.debugLineCount === 11 &&
        result.stats.debugDrawCalls === 1,
      "native/debug submission count",
      result.stats,
    );
    check(
      result.observed.lines.length === 1 &&
        result.observed.lines[0].count === debug.vertexCount &&
        result.observed.lines[0].depthTest === depthTest &&
        !result.observed.lines[0].depthWrite,
      "actual debug depth/draw contract",
      result.observed,
    );
    check(
      result.stats.debugUploadBytes === 22 * 44 &&
        result.stats.terrainUploadBytes === 0 &&
        !result.stats.debugTruncated,
      "debug upload contract",
      result.stats,
    );
    check(
      result.observed.uploads.filter(
        (u) =>
          u.name === "bufferSubData" && u.bytes === debug.vertices.byteLength,
      ).length === 1 &&
        !result.observed.uploads.some((u) => u.name === "bufferData"),
      "debug warm buffer upload",
      result.observed,
    );
    check(
      depthTest
        ? palette.yellow === 0 && palette.magenta === 0
        : palette.yellow > 8 && palette.magenta > 8,
      "depth-tested versus occluded line pixels",
      palette,
    );
    check(
      JSON.stringify(snapshot().dataScene.progress) ===
        JSON.stringify(progress),
      "diagnostics changed simulation/progress",
    );
    cases.push({
      depthTest,
      palette,
      stats: result.stats,
      observed: result.observed,
      screenshot,
    });
  }
  // The visual foot offset is eight units; the magenta endpoints must use physical elevation instead.
  const native = scene.frame.spatial.debug.vertices;
  check(
    native[12 * 11 + 1] === 16 && native[13 * 11 + 1] === 40,
    "height marker copied visual offset",
  );
  const created = JSON.stringify(window.spatialGpuResources().created);
  const cameraCases = [];
  for (const next of [
    { ...camera, position: { x: 100, y: -200, elevation: 120 }, height: 200 },
    {
      ...camera,
      projection: "perspective",
      fovDegrees: 60,
      position: { x: 40, y: -160, elevation: 90 },
    },
  ]) {
    check(
      engine.setDataSceneSpatialCamera(next, renderer.viewportSize()),
      "debug camera change",
    );
    check(
      engine.setPhysicsBodyHeightSpan(handles.actor, {
        floorId: 0,
        elevation: 24,
        height: 24,
      }),
      "native height change",
    );
    await wait();
    const result = draw();
    const packet = scene.frame.spatial;
    const at = view.project({ x: 0, y: 0, elevation: 48 }, packet);
    const rect = canvas.getBoundingClientRect();
    const px = Math.round(((at.x - rect.left) * canvas.width) / rect.width);
    const py = Math.round(
      canvas.height - ((at.y - rect.top) * canvas.height) / rect.height,
    );
    let markerPixels = 0;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = px + dx,
          y = py + dy;
        if (x >= 0 && x < canvas.width && y >= 0 && y < canvas.height) {
          const i = (y * canvas.width + x) * 4;
          if (
            result.pixels[i] > 110 &&
            result.pixels[i + 1] < 90 &&
            result.pixels[i + 2] > 110
          )
            markerPixels++;
        }
      }
    check(
      at.visible && markerPixels > 0,
      "physical height/debug projection mismatch",
      { at, markerPixels },
    );
    check(
      packet.debug.vertices[12 * 11 + 1] === 24 &&
        packet.debug.vertices[13 * 11 + 1] === 48,
      "native height endpoints did not move",
    );
    check(
      packet.terrainRevision === revision &&
        result.stats.terrainUploadBytes === 0,
      "debug camera invalidated static terrain",
    );
    cameraCases.push({
      projection: next.projection,
      markerPixels,
      stats: result.stats,
    });
  }
  check(
    engine.setDataSceneSpatialDebug({ terrain: true, depthTest: false }),
    "terrain diagnostic toggle",
  );
  await wait();
  const terrain = draw();
  check(
    terrain.stats.debugLineCount === 12 && colors(terrain.pixels).cyan > 16,
    "terrain bounds pixels",
    terrain.stats,
  );
  check(
    JSON.stringify(window.spatialGpuResources().created) === created,
    "debug toggles allocate GPU objects repeatedly",
  );
  const packet = scene.frame.spatial,
    valid = packet.debug;
  const invalid = [
    { ...valid, version: 2 },
    { ...valid, vertexStride: 7 },
    { ...valid, vertexCount: 1 },
    { ...valid, vertexCount: -2 },
    { ...valid, vertexCount: 32770 },
    { ...valid, vertices: new Uint32Array(valid.vertices.length) },
    { ...valid, depthTest: 1 },
    { ...valid, truncated: "yes" },
    { ...valid, vertices: valid.vertices.slice(1) },
    { ...valid, vertices: valid.vertices.map((v, i) => (i === 0 ? NaN : v)) },
  ];
  let rejected = 0,
    invalidDraws = 0;
  for (const debug of invalid) {
    const original = gl.drawArrays;
    gl.drawArrays = function (...args) {
      invalidDraws++;
      return original.apply(this, args);
    };
    try {
      renderer.renderCommands({
        ...scene.frame.state.renderCommandBuffer,
        spatial: { ...packet, debug },
      });
    } catch (error) {
      check(
        String(error).includes("spatial debug"),
        "unexpected invalid debug error",
        String(error),
      );
      rejected++;
    } finally {
      gl.drawArrays = original;
    }
  }
  check(
    rejected === invalid.length && invalidDraws === 0,
    "invalid debug packet submitted draws",
    { rejected, invalidDraws },
  );
  check(engine.setDataSceneSpatialDebug(null), "disable diagnostics");
  check(
    engine.setDataSceneSpatialCamera(camera, renderer.viewportSize()),
    "restore debug camera",
  );
  check(
    engine.setPhysicsBodyHeightSpan(handles.actor, {
      floorId: 0,
      elevation: 16,
      height: 24,
    }),
    "restore actor elevation",
  );
  await wait();
  const disabled = draw();
  let differences = 0;
  for (let i = 0; i < baseline.pixels.length; i++)
    if (Math.abs(baseline.pixels[i] - disabled.pixels[i]) > 3) differences++;
  check(
    scene.frame.spatial.debug === undefined &&
      disabled.stats.debugDrawCalls === 0 &&
      disabled.stats.debugUploadBytes === 0 &&
      disabled.observed.lines.length === 0 &&
      differences === 0,
    "disabled debug changed scene framebuffer",
    { differences, stats: disabled.stats },
  );
  check(
    engine.setDataSceneSpatialDebug({ terrain: true }),
    "enable before scene reset",
  );
  applyDataSceneAuthoringDocument(engine, document);
  engine.pauseDataScene();
  await wait();
  check(
    scene.frame.spatial.debug === undefined,
    "scene reset retained debug configuration",
  );
  const saveVersion = snapshot().dataScene.version;
  const physicsCases = [];
  const physicsPalette = (pixels) => {
    const result = { green: 0, red: 0, white: 0 };
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i],
        g = pixels[i + 1],
        b = pixels[i + 2];
      if (g > 110 && r < 90 && b < 110) result.green++;
      if (r > 110 && g < 90 && b < 90) result.red++;
      if (r > 150 && g > 150 && b > 150) result.white++;
    }
    return result;
  };
  for (const depthTest of [true, false]) {
    check(
      engine.setDataSceneSpatialDebug({
        colliders: true,
        floorIds: true,
        depthTest,
      }),
      "enable physics diagnostics",
    );
    await wait();
    const packet = scene.frame.spatial,
      v = packet.debug.vertices;
    check(
      packet.debug.vertexCount === 64,
      "physics prism/floor label count",
      packet.debug.vertexCount,
    );
    let footprint = 0;
    for (let i = 0; i < v.length; i += 11)
      if (v[i + 5] < 0.2 && v[i + 6] === 1 && v[i + 7] < 0.3) {
        check(
          Math.abs(v[i]) <= 2 &&
            v[i + 1] >= 16 &&
            v[i + 1] <= 40 &&
            Math.abs(v[i + 2]) <= 2,
          "collider followed visual offset",
          [...v.slice(i, i + 11)],
        );
        footprint++;
      }
    check(footprint === 24, "missing native AABB prism", footprint);
    const result = draw(),
      palette = physicsPalette(result.pixels);
    check(
      depthTest ? palette.green === 0 : palette.green > 8 && palette.white > 8,
      "physics depth/label pixels",
      { depthTest, palette },
    );
    check(
      result.stats.debugUploadBytes === 64 * 44 &&
        result.stats.debugDrawCalls === 1 &&
        result.stats.terrainUploadBytes === 0,
      "physics diagnostic cost",
      result.stats,
    );
    check(
      result.observed.lines.length === 1 &&
        result.observed.lines[0].count === 64 &&
        result.observed.lines[0].depthTest === depthTest,
      "physics GL submission",
      result.observed,
    );
    const screenshot = await window.spatialDebugScreenshot?.(
      depthTest ? "physics-depth" : "physics-overlay",
      canvas.toDataURL("image/png"),
    );
    physicsCases.push({ depthTest, palette, stats: result.stats, screenshot });
  }
  const contactDocument = JSON.parse(JSON.stringify(document));
  contactDocument.sceneComposition.prefabs.actor.props.components.visual.tint =
    "#202020";
  contactDocument.spatial.camera = {
    ...camera,
    position: { x: 0, y: -200, elevation: 120 },
    target: { x: 0, y: 0, elevation: 16 },
  };
  contactDocument.spatial.terrain = [
    {
      id: "ground",
      x: -60,
      y: -40,
      width: 120,
      depth: 80,
      elevation: 16,
      color: [0.2, 0.3, 0.4, 1],
    },
  ];
  contactDocument.spatial.actor = {
    instanceId: "actor",
    speed: 64,
    maxStepHeight: 8,
    maxDropHeight: 8,
  };
  contactDocument.sceneComposition.prefabs.wall = {
    props: {
      components: {
        ...contactDocument.sceneComposition.prefabs.actor.props.components,
        collider: {
          type: "aabb",
          halfWidth: 2,
          halfHeight: 8,
          isTrigger: false,
        },
        layer: "wall",
        body: {
          type: "static",
          heightSpan: { floorId: 0, elevation: 16, height: 24 },
        },
      },
    },
  };
  contactDocument.sceneComposition.fragments.debug.instances.push({
    id: "wall",
    prefab: "wall",
    x: 10,
    y: 0,
  });
  const contacts = applyDataSceneAuthoringDocument(
    engine,
    contactDocument,
  ).entityHandles;
  engine.pauseDataScene();
  check(
    engine.setDataSceneSpatialDebug({ contacts: true, depthTest: false }),
    "enable sweep trace",
  );
  check(
    engine.moveDataSceneSpatialBody(contacts.actor, 16, 0, {
      maxStepHeight: 8,
      maxDropHeight: 8,
    }),
    "sweep contact move",
  );
  await wait();
  const contactPose = engine.getPhysicsEntity(contacts.actor),
    captured = scene.frame.spatial.debug.vertices.slice();
  check(
    contactPose.x <= 6.0001 && captured.length > 0,
    "sweep hit did not stop actor",
    contactPose,
  );
  const contactReference = draw({ ...scene.frame.spatial, debug: undefined });
  const contactDraw = draw(),
    contactPixels = physicsPalette(contactDraw.pixels);
  let addedContactPixels = 0;
  for (let i = 0; i < contactDraw.pixels.length; i += 4) {
    const p = contactDraw.pixels,
      before = contactReference.pixels;
    if (
      p[i] > 110 &&
      p[i + 1] < 90 &&
      p[i + 2] < 90 &&
      (Math.abs(p[i] - before[i]) > 3 ||
        Math.abs(p[i + 1] - before[i + 1]) > 3 ||
        Math.abs(p[i + 2] - before[i + 2]) > 3)
    )
      addedContactPixels++;
  }
  const contactScreenshot = await window.spatialDebugScreenshot?.(
    "contacts",
    canvas.toDataURL("image/png"),
  );
  check(
    addedContactPixels > 8 &&
      contactDraw.stats.debugUploadBytes === captured.byteLength &&
      contactDraw.stats.debugDrawCalls === 1,
    "contact glyph GL/pixels",
    { contactPixels, addedContactPixels, stats: contactDraw.stats },
  );
  check(
    engine.moveDataSceneSpatialActorTo({ x: -16, y: 0, floorId: 0, speed: 32 }),
    "contact isolation route",
  );
  await wait();
  check(
    captured.length === scene.frame.spatial.debug.vertices.length &&
      captured.every((x, i) => x === scene.frame.spatial.debug.vertices[i]),
    "feasibility probes changed committed hit trace",
  );
  const progressBefore = captureGameStateSnapshot(engine, {
    includeDataSceneState: true,
    includeDataSceneProgress: true,
    dataSceneAuthoringDocument: contactDocument,
  }).dataScene.progress;
  check(engine.setDataSceneSpatialDebug(null), "disable physics diagnostics");
  await wait();
  const afterPhysics = draw();
  check(
    !scene.frame.spatial.debug &&
      afterPhysics.stats.debugUploadBytes === 0 &&
      afterPhysics.stats.debugDrawCalls === 0,
    "physics disable retained geometry",
  );
  check(
    JSON.stringify(
      captureGameStateSnapshot(engine, {
        includeDataSceneState: true,
        includeDataSceneProgress: true,
        dataSceneAuthoringDocument: contactDocument,
      }).dataScene.progress,
    ) === JSON.stringify(progressBefore),
    "physics diagnostics changed saved progress",
  );
  return {
    cases,
    cameraCases,
    terrain: { stats: terrain.stats, palette: colors(terrain.pixels) },
    invalidPacketsRejected: rejected,
    invalidPacketDrawCalls: invalidDraws,
    disabledPixelDifferences: differences,
    saveVersion,
    physicsCases,
    contacts: {
      screenshot: contactScreenshot,
      addedContactPixels,
      pose: {
        x: contactPose.x,
        y: contactPose.y,
        floorId: contactPose.heightSpan.floorId,
      },
      vertexCount: captured.length / 11,
      palette: contactPixels,
      stats: contactDraw.stats,
      probeIsolation: true,
    },
  };
}
