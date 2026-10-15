// Runs inside the existing packed-consumer browser gate; all engine access uses public subpaths.
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";

export async function probeSpatialVisibility(scene, canvas) {
  const { engine, renderer, view } = scene;
  const gl = canvas.getContext("webgl2");
  const wait = async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  };
  const check = (ok, message, evidence) => {
    if (!ok) throw Error(`${message}: ${JSON.stringify(evidence)}`);
  };
  const rgb = [
    [
      [240, 32, 32],
      [32, 240, 32],
      [32, 32, 240],
      [240, 240, 32],
    ],
    [
      [32, 240, 240],
      [160, 32, 240],
      [240, 128, 32],
      [240, 240, 240],
    ],
  ];
  const background = [40, 64, 96];
  const atlas = document.createElement("canvas");
  atlas.width = 64;
  atlas.height = 32;
  const paint = atlas.getContext("2d");
  paint.fillStyle = "#ff00ff"; // Poison gutters reveal neighboring-frame samples.
  paint.fillRect(0, 0, 64, 32);
  rgb.forEach((colors, frame) => {
    colors.forEach((color, quadrant) => {
      paint.fillStyle = `rgb(${color.join(",")})`;
      paint.fillRect(
        4 + frame * 32 + (quadrant % 2) * 12,
        4 + Math.floor(quadrant / 2) * 12,
        12,
        12,
      );
    });
    paint.clearRect(4 + frame * 32 + 9, 13, 6, 6);
  });
  await renderer.loadTexture(5, atlas.toDataURL());
  const solid = document.createElement("canvas");
  solid.width = solid.height = 2;
  const fill = solid.getContext("2d");
  fill.fillStyle = `rgb(${background.join(",")})`;
  fill.fillRect(0, 0, 2, 2);
  await renderer.loadTexture(6, solid.toDataURL());
  const animationSet = {
    clips: [
      {
        id: 7,
        fps: 4,
        frames: [0, 1].map((i) => ({
          u0: (4 + i * 32) / 64,
          v0: 4 / 32,
          u1: (28 + i * 32) / 64,
          v1: 28 / 32,
        })),
      },
    ],
    initialClip: 7,
  };
  const camera = {
    projection: "orthographic",
    position: { x: 0, y: -200, elevation: 160 },
    target: { x: 0, y: 0, elevation: 56 },
    height: Math.max(160, (160 * canvas.clientHeight) / canvas.clientWidth),
    fovDegrees: 60,
    near: 0.1,
    far: 1000,
  };
  const makeDocument = (
    nextCamera,
    { width = 64, height = 80, elevation = 16 } = {},
  ) => ({
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    sceneComposition: {
      initialFragment: "visibility",
      prefabs: { object: {} },
      fragments: {
        visibility: {
          instances: [
            {
              id: "back",
              prefab: "object",
              x: 0,
              y: 32,
              props: {
                components: {
                  visual: {
                    kind: "sprite",
                    texture: 6,
                    width: 512,
                    height: 512,
                  },
                  collider: "none",
                  layer: "wall",
                },
              },
            },
            {
              id: "subject",
              prefab: "object",
              x: 0,
              y: 0,
              props: {
                components: {
                  visual: {
                    kind: "sprite",
                    texture: 5,
                    width,
                    height,
                    originX: 0.25,
                    originY: 1,
                    animationSet,
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
                    heightSpan: { floorId: 0, elevation, height: 8 },
                  },
                },
              },
            },
          ],
        },
      },
    },
    behaviorRecipes: { entities: {} },
    spatial: {
      camera: nextCamera,
      terrain: [],
      billboards: { back: { elevation: 56 }, subject: {} },
    },
  });
  const install = async (nextCamera, options) => {
    const handles = applyDataSceneAuthoringDocument(
      engine,
      makeDocument(nextCamera, options),
    ).entityHandles;
    check(engine.pauseDataScene(), "visibility pause rejected");
    await wait();
    return handles;
  };
  const subjectVertices = () => {
    const vertices = scene.frame.spatial.billboards;
    const result = [];
    for (let i = 0; i < vertices.length; i += 66)
      if (vertices[i + 9] === 5) result.push(...vertices.subarray(i, i + 66));
    return result;
  };
  const sample = (point) => {
    const screen = view.project(point, scene.frame.spatial);
    check(
      screen &&
        screen.x >= 0 &&
        screen.x < canvas.clientWidth &&
        screen.y >= 0 &&
        screen.y < canvas.clientHeight,
      "sample outside canvas",
      { point, screen },
    );
    const pixel = new Uint8Array(4);
    gl.readPixels(
      Math.floor((screen.x * canvas.width) / canvas.clientWidth),
      canvas.height -
        1 -
        Math.floor((screen.y * canvas.height) / canvas.clientHeight),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixel,
    );
    return [...pixel];
  };
  const expectPixel = (point, expected, label) => {
    const actual = sample(point);
    check(
      expected.every((n, i) => Math.abs(n - actual[i]) <= 3) &&
        actual[3] === 255,
      label,
      { point, expected, actual },
    );
    return actual;
  };
  const at = (
    u,
    v,
    { x = 0, y = 0, elevation = 16, width = 64, height = 80 } = {},
  ) => ({
    x: x + (u - 0.25) * width,
    y,
    elevation: elevation + (1 - v) * height,
  });
  const atlasCases = [];
  let handles;
  for (const projection of ["orthographic", "perspective"]) {
    handles = await install({ ...camera, projection });
    let originalGeometry;
    for (const frame of [0, 1])
      for (const flipX of [false, true])
        for (const flipY of [false, true]) {
          check(
            engine.updateDataSceneSpriteAnimations([
              {
                entity: handles.subject,
                clip: 7,
                frame,
                flipX,
                flipY,
                paused: true,
              },
            ]),
            "atlas update rejected",
          );
          await wait();
          const vertices = subjectVertices();
          check(vertices.length === 66, "atlas billboard culled", {
            projection,
            frame,
            flipX,
            flipY,
            vertices: vertices.length,
          });
          const geometry = vertices.filter((_, i) => i % 11 < 3);
          originalGeometry ??= geometry;
          check(
            geometry.every((v, i) => v === originalGeometry[i]),
            "atlas frame/flip moved the geometry",
          );
          const bottom = {
            x: vertices[55] + (vertices[22] - vertices[55]) * 0.25,
            elevation: vertices[56],
            y: -vertices[57],
          };
          check(
            Math.hypot(bottom.x, bottom.y, bottom.elevation - 16) < 0.001,
            "foot pivot detached from native anchor",
            bottom,
          );
          const pixels = [];
          // Both interior and near-edge texels must be exact nearest colors, without poison gutters.
          for (const [u, v] of [
            [0.2, 0.2],
            [0.8, 0.2],
            [0.2, 0.8],
            [0.8, 0.8],
            [0.04, 0.2],
            [0.96, 0.8],
          ]) {
            const sourceU = flipX ? 1 - u : u,
              sourceV = flipY ? 1 - v : v;
            const expected =
              rgb[frame][(sourceV >= 0.5 ? 2 : 0) + (sourceU >= 0.5 ? 1 : 0)];
            pixels.push(
              expectPixel(
                at(u, v),
                expected,
                `atlas pixel ${projection}/${frame}/${flipX}/${flipY}`,
              ),
            );
          }
          const hole = expectPixel(
            at(0.5, 0.5),
            background,
            "atlas alpha hole wrote color",
          );
          // Submit the cutout first: writing depth in its hole would now block the later back plane.
          const packet = scene.frame.state.renderCommandBuffer;
          const spatial = packet.spatial;
          const reversed = new Float32Array(spatial.billboards.length);
          for (let i = 0; i < reversed.length; i += 66)
            reversed.set(
              spatial.billboards.subarray(i, i + 66),
              reversed.length - i - 66,
            );
          renderer.render();
          renderer.renderCommands({
            ...packet,
            spatial: { ...spatial, billboards: reversed },
          });
          renderer.renderPostProcess();
          const reverseHole = expectPixel(
            at(0.5, 0.5),
            background,
            "alpha hole wrote depth before back-plane submission",
          );
          const sourceCorner = (flipY ? 2 : 0) + (flipX ? 1 : 0);
          expectPixel(
            at(0.2, 0.2),
            rgb[frame][sourceCorner],
            "reverse order drew background over opaque texels",
          );
          const state = engine.dataSceneSpriteAnimationState(handles.subject);
          check(
            state.clip === 7 &&
              state.frame === frame &&
              state.flipX === flipX &&
              state.flipY === flipY &&
              state.paused,
            "native atlas state mismatch",
            state,
          );
          const metrics = scene.frame.stats.spatial;
          check(
            metrics.billboardCount === 2 &&
              metrics.drawCalls === 2 &&
              metrics.terrainUploadBytes === 0 &&
              metrics.uploadBytes === 2 * 6 * 44,
            "atlas fixture cost mismatch",
            metrics,
          );
          atlasCases.push({
            projection,
            frame,
            flipX,
            flipY,
            pixels,
            hole,
            reverseHole,
            foot: bottom,
            drawCalls: metrics.drawCalls,
          });
        }
  }
  // Native time advancement must reach a different frame, then pause must freeze that exact frame.
  check(
    engine.updateDataSceneSpriteAnimations([
      {
        entity: handles.subject,
        clip: 7,
        frame: 0,
        flipX: false,
        flipY: false,
        paused: false,
      },
    ]),
    "atlas resume rejected",
  );
  engine.resumeDataScene();
  const deadline = performance.now() + 2000;
  while (
    engine.dataSceneSpriteAnimationState(handles.subject).frame !== 1 &&
    performance.now() < deadline
  )
    await wait();
  engine.pauseDataScene();
  check(
    engine.updateDataSceneSpriteAnimations([
      { entity: handles.subject, paused: true },
    ]),
    "atlas freeze rejected",
  );
  await wait();
  const advanced = engine.dataSceneSpriteAnimationState(handles.subject);
  check(
    advanced.frame === 1 && advanced.elapsedSeconds > 0,
    "native atlas did not advance",
    advanced,
  );
  expectPixel(at(0.2, 0.2), rgb[1][0], "advanced native frame not rendered");
  const frozen = advanced.elapsedSeconds;
  await wait();
  check(
    engine.dataSceneSpriteAnimationState(handles.subject).elapsedSeconds ===
      frozen,
    "paused atlas advanced",
  );

  const clippedCases = [];
  const sideCamera = {
    ...camera,
    position: { x: 0, y: -200, elevation: 56 },
    target: { x: 0, y: 0, elevation: 56 },
  };
  for (const edge of ["bottom", "left"]) {
    handles = await install(sideCamera);
    let x = 0,
      elevation = 16;
    if (edge === "bottom") elevation = 56 - sideCamera.height / 2 - 20;
    else
      x =
        (-sideCamera.height * canvas.clientWidth) / canvas.clientHeight / 2 -
        10;
    check(
      engine.setPhysicsBodyPosition(handles.subject, x, 0) &&
        engine.setPhysicsBodyHeightSpan(handles.subject, {
          floorId: 0,
          elevation,
          height: 8,
        }),
      "edge pose rejected",
    );
    await wait();
    const anchor = view.project({ x, y: 0, elevation }, scene.frame.spatial);
    check(
      anchor && !anchor.visible && subjectVertices().length === 66,
      "offscreen anchor hid visible geometry",
      { edge, anchor },
    );
    const pixel = expectPixel(
      at(0.8, 0.2, { x, elevation }),
      rgb[0][1],
      "offscreen-anchor billboard missing",
    );
    clippedCases.push({
      edge,
      anchor,
      pixel,
      billboards: scene.frame.stats.spatial.billboardCount,
    });
  }
  // The near plane crosses the vertical quad inside the viewport; rejected fragments reveal the back plane.
  for (const projection of ["orthographic", "perspective"]) {
    const close = {
      ...camera,
      projection,
      position: { x: 0, y: -96, elevation: 48 },
      target: { x: 0, y: 0, elevation: 40 },
      near: 96,
    };
    handles = await install(close, { elevation: 0 });
    check(
      subjectVertices().length === 66,
      "partly near-clipped quad was discarded",
      { projection },
    );
    const visiblePoint = at(0.2, 0.8, { elevation: 0 });
    const hiddenPoint = at(0.2, 0.2, { elevation: 0 });
    const visible = view.project(visiblePoint, scene.frame.spatial),
      hidden = view.project(hiddenPoint, scene.frame.spatial);
    check(
      visible?.visible && hidden && !hidden.visible && hidden.depth < -1,
      "near-plane fixture does not straddle clip boundary",
      { projection, visible, hidden },
    );
    const kept = expectPixel(
      visiblePoint,
      rgb[0][2],
      "near plane removed visible fragment",
    );
    const cut = expectPixel(
      hiddenPoint,
      background,
      "near plane drew a clipped fragment",
    );
    const sweep = [];
    for (const near of [0.1, 92, 94, 96, 98, 100]) {
      check(scene.setCamera({ ...close, near }), "near-plane camera rejected");
      await wait();
      const vertices = subjectVertices();
      check(
        vertices.length === (near === 100 ? 0 : 66),
        "near-plane cull popped early",
        { projection, near, length: vertices.length },
      );
      check(
        scene.frame.spatial.billboards.every(Number.isFinite),
        "non-finite clipped geometry",
      );
      const metrics = scene.frame.stats.spatial;
      check(
        metrics.billboardCount === (near === 100 ? 1 : 2) &&
          metrics.drawCalls === metrics.billboardCount &&
          metrics.uploadBytes === metrics.billboardCount * 6 * 44,
        "near-plane cost does not match retained geometry",
        metrics,
      );
      if (near === 100)
        expectPixel(
          visiblePoint,
          background,
          "fully clipped sprite retained stale pixels",
        );
      sweep.push({ near, vertices: vertices.length });
    }
    check(scene.setCamera({ ...close, near: 0.1 }), "camera recovery rejected");
    await wait();
    expectPixel(
      hiddenPoint,
      rgb[0][0],
      "near-plane recovery did not restore sprite",
    );
    clippedCases.push({ projection, visible, hidden, kept, cut, sweep });
  }
  // A tilted billboard can cross the eye plane (w=0); GPU clipping must retain the visible lower part.
  const eyeCamera = {
    ...camera,
    projection: "perspective",
    position: { x: 0, y: -16, elevation: 16 },
    target: { x: 0, y: 0, elevation: 0 },
    fovDegrees: 90,
  };
  await install(eyeCamera, { elevation: 0 });
  const behind = view.project(
    at(0.25, 0, { elevation: 0 }),
    scene.frame.spatial,
  );
  check(
    behind === undefined &&
      subjectVertices().length === 66 &&
      scene.frame.spatial.billboards.every(Number.isFinite),
    "eye-plane crossing discarded or corrupted geometry",
    { behind, length: subjectVertices().length },
  );
  const lowerPixel = expectPixel(
    at(0.25, 0.9, { elevation: 0 }),
    rgb[0][2],
    "eye-plane crossing lost the visible lower part",
  );
  clippedCases.push({
    projection: "perspective",
    eyePlane: true,
    lowerPixel,
    vertices: subjectVertices().length,
  });
  return { atlasCases, advanced, clippedCases };
}
