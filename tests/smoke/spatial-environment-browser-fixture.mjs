import {
  applyDataSceneAuthoringDocument,
  createSceneInstanceHandleRegistry,
} from "@ferrum2d/ferrum-web/authoring";
import {
  captureGameStateSnapshot,
  restoreGameStateSnapshot,
  createEngine,
  WebGL2Renderer,
} from "@ferrum2d/ferrum-web/core";

// Packed public API only. Pixel assertions accompany native state and actual GPU cost checks.
export async function probeSpatialEnvironment(scene, canvas) {
  const { engine, renderer, view } = scene,
    gl = canvas.getContext("webgl2");
  const check = (ok, message, evidence) => {
    if (!ok) throw Error(`${message}: ${JSON.stringify(evidence)}`);
  };
  const wait = async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  };
  const image = () => {
    const p = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      p,
    );
    return p;
  };
  const draw = (spatial = scene.frame.spatial, hud = false) => {
    renderer.render();
    const stats = renderer.renderCommands({
      ...scene.frame.state.renderCommandBuffer,
      spatial,
      buffer: hud
        ? new Float32Array([
            8, 8, 24, 24, 0, 0, 1, 1, 0.9, 0.2, 0.1, 1, 4, 0, 0,
          ])
        : new Float32Array(),
      commandCount: hud ? 1 : 0,
      floatsPerCommand: 15,
    });
    renderer.renderPostProcess();
    check(gl.getError() === gl.NO_ERROR, "environment WebGL error");
    return { stats: { ...stats.spatial }, pixels: image() };
  };
  const sample = (pixels, point, radius = 1) => {
    const screen = view.project(point, scene.frame.spatial),
      dpr = canvas.width / canvas.clientWidth;
    const x = Math.round(screen.x * dpr),
      y = canvas.height - 1 - Math.round(screen.y * dpr),
      sum = [0, 0, 0];
    let count = 0;
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx,
          yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= canvas.width || yy >= canvas.height)
          continue;
        const p = (yy * canvas.width + xx) * 4;
        for (let k = 0; k < 3; k++) sum[k] += pixels[p + k];
        count++;
      }
    check(count > 0 && screen.visible, "environment sample outside viewport", {
      point,
      screen,
    });
    return sum.map((v) => v / count);
  };
  const luma = (rgb) => (rgb[0] + rgb[1] + rgb[2]) / 3;
  const delta = (a, b, tolerance = 3) => {
    let n = 0;
    for (let i = 0; i < a.length; i++)
      if (Math.abs(a[i] - b[i]) > tolerance) n++;
    return n;
  };
  const env = async (settings) => {
    check(
      engine.setDataSceneSpatialEnvironment(settings),
      "environment rejected",
      settings,
    );
    await wait();
    return draw();
  };
  const camera = {
    projection: "orthographic",
    position: { x: 210, y: -240, elevation: 220 },
    target: { x: 20, y: 20, elevation: 0 },
    height: 260,
    near: 0.1,
    far: 1600,
  };
  const ground = {
    id: "ground",
    x: -160,
    y: -100,
    width: 320,
    depth: 240,
    elevation: 0,
    color: [0.6, 0.6, 0.6, 1],
  };
  const bridge = {
    id: "bridge",
    x: -20,
    y: 0,
    width: 40,
    depth: 40,
    elevation: 60,
    baseElevation: 54,
    floorId: 1,
    kind: "bridge",
    color: [0.6, 0.6, 0.6, 1],
  };
  const document = {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    sceneComposition: {
      initialFragment: "environment",
      prefabs: { blank: {} },
      fragments: { environment: { instances: [] } },
    },
    behaviorRecipes: { entities: {} },
    spatial: { camera, terrain: [ground, bridge], billboards: {} },
  };
  const registry = createSceneInstanceHandleRegistry({
    entityExists: (h) => engine.gameplayEntityExists(h),
  });
  const apply = async (doc) => {
    const handles = applyDataSceneAuthoringDocument(engine, doc, {
      instanceHandleRegistry: registry,
    }).entityHandles;
    engine.pauseDataScene();
    await wait();
    return handles;
  };
  await apply(document);
  const baseline = draw().pixels;
  const identity = await env({ colorGrading: {} });
  const receiver = { x: 80, y: 20, elevation: 0 },
    top = { x: 0, y: 20, elevation: 60 };
  check(
    Math.abs(
      luma(sample(baseline, receiver)) -
        luma(sample(identity.pixels, receiver)),
    ) < 3,
    "identity grading changed albedo",
  );
  const lighting = {
    ambient: [0.03, 0.03, 0.03],
    lights: [
      {
        position: { x: -80, y: 20, elevation: 120 },
        radius: 400,
        intensity: 2,
      },
    ],
  };
  const unshadowed = await env({ lighting });
  await window.spatialDebugScreenshot("environment-lit", canvas.toDataURL());
  const shadowed = await env({
    lighting: {
      ...lighting,
      shadows: { lightIndex: 0, resolution: 512, bias: 0.3 },
    },
  });
  await window.spatialDebugScreenshot("environment-shadow", canvas.toDataURL());
  // Internal cube/HDR work ignores caller clipping/masks; the final composite honors them.
  const spatialPacket = scene.frame.spatial,
    commandPacket = scene.frame.state.renderCommandBuffer;
  const drawCommands = (spatial) =>
    renderer.renderCommands({
      ...commandPacket,
      spatial,
      buffer: new Float32Array(),
      commandCount: 0,
    });
  draw({ ...spatialPacket, environment: undefined });
  renderer.render();
  const clearPixels = image(),
    cut = Math.floor(canvas.width / 2);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(cut, 0, canvas.width - cut, canvas.height);
  gl.colorMask(true, false, true, false);
  let clippedPixels;
  try {
    drawCommands(spatialPacket);
    check(
      gl.isEnabled(gl.SCISSOR_TEST) &&
        gl.getParameter(gl.SCISSOR_BOX)[0] === cut &&
        gl.getParameter(gl.COLOR_WRITEMASK).join() === "true,false,true,false",
      "spatial pass did not restore scissor/color mask",
    );
    renderer.renderPostProcess();
    clippedPixels = image();
  } finally {
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
  }
  const fullPixels = draw(spatialPacket).pixels;
  const glState = { compared: 0, pixelDifferences: 0 };
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++)
      for (let k = 0; k < 4; k++) {
        const p = (y * canvas.width + x) * 4 + k,
          expected =
            x >= cut && (k === 0 || k === 2) ? fullPixels[p] : clearPixels[p];
        glState.compared++;
        if (Math.abs(clippedPixels[p] - expected) > 3)
          glState.pixelDifferences++;
      }
  check(
    glState.pixelDifferences === 0,
    "caller crop/color mask changed internal shadow result",
    glState,
  );
  // A failed cube allocation releases its cache so the next frame can retry.
  draw({ ...spatialPacket, environment: undefined });
  const texImage = gl.texImage2D;
  let injected = false,
    rejected = false;
  gl.texImage2D = function (...args) {
    if (!injected && args[0] === gl.TEXTURE_CUBE_MAP_POSITIVE_X) {
      injected = true;
      return;
    }
    return texImage.apply(this, args);
  };
  try {
    renderer.render();
    try {
      drawCommands(spatialPacket);
    } catch (error) {
      rejected = /cube target incomplete/.test(String(error));
    }
  } finally {
    gl.texImage2D = texImage;
  }
  check(
    injected && rejected,
    "cube allocation failure did not reject cleanly",
    { injected, rejected },
  );
  check(
    delta(draw(spatialPacket).pixels, fullPixels) === 0,
    "cube allocation failure remained cached after retry",
  );
  const shadowPixels = {
    lit: sample(unshadowed.pixels, receiver),
    shadow: sample(shadowed.pixels, receiver),
    top: sample(shadowed.pixels, top),
  };
  check(
    luma(shadowPixels.lit) > luma(shadowPixels.shadow) + 35,
    "bridge did not occlude light on the lower floor",
    shadowPixels,
  );
  shadowPixels.maxLitSurfaceLoss = 0;
  shadowPixels.litSurfaceSampleCount = 0;
  for (const x of [-20, 0, 20, 40, 70, 100])
    for (const y of [80, 95, 110]) {
      const point = { x, y, elevation: 0 };
      if (!view.project(point, scene.frame.spatial).visible) continue;
      shadowPixels.litSurfaceSampleCount++;
      shadowPixels.maxLitSurfaceLoss = Math.max(
        shadowPixels.maxLitSurfaceLoss,
        luma(sample(unshadowed.pixels, point, 0)) -
          luma(sample(shadowed.pixels, point, 0)),
      );
    }
  check(
    shadowPixels.maxLitSurfaceLoss <= 3 &&
      shadowPixels.litSurfaceSampleCount >= 6,
    "unoccluded grazing surface has self-shadow acne",
    shadowPixels,
  );
  const below = await env({
    lighting: {
      ...lighting,
      lights: [
        { ...lighting.lights[0], position: { x: 0, y: 20, elevation: 30 } },
      ],
      shadows: { lightIndex: 0, resolution: 256, bias: 0.3 },
    },
  });
  shadowPixels.belowTop = sample(below.pixels, top);
  check(
    luma(shadowPixels.top) > luma(shadowPixels.belowTop) + 30,
    "light height ignored the top surface normal",
    shadowPixels,
  );

  const wallDoc = structuredClone(document);
  wallDoc.spatial.terrain = [
    ground,
    {
      id: "wall",
      x: 80,
      y: -10,
      width: 8,
      depth: 60,
      elevation: 80,
      floorId: 2,
      walkable: false,
      color: [0.6, 0.6, 0.6, 1],
    },
    {
      id: "blocker",
      x: 120,
      y: 10,
      width: 4,
      depth: 20,
      elevation: 60,
      floorId: 3,
      walkable: false,
    },
  ];
  await apply(wallDoc);
  const wallLight = {
      ambient: [0.03, 0.03, 0.03],
      lights: [
        {
          position: { x: 150, y: 20, elevation: 40 },
          radius: 300,
          intensity: 2,
        },
      ],
    },
    wallPoint = { x: 88, y: 20, elevation: 40 };
  const wallLit = await env({ lighting: wallLight }),
    wallShadow = await env({
      lighting: {
        ...wallLight,
        shadows: { lightIndex: 0, resolution: 512, bias: 0.3 },
      },
    });
  shadowPixels.wallLit = sample(wallLit.pixels, wallPoint);
  shadowPixels.wallShadow = sample(wallShadow.pixels, wallPoint);
  check(
    luma(shadowPixels.wallLit) > luma(shadowPixels.wallShadow) + 35,
    "wall did not receive a spatial occluder shadow",
    shadowPixels,
  );
  await apply(document);

  // Six actual cube faces, bounded draw/upload/resource costs and no warm-frame allocations.
  await env({
    lighting: {
      ...lighting,
      shadows: { lightIndex: 0, resolution: 256, bias: 0.3 },
    },
    depthOfField: { focusDistance: 350 },
  });
  const observed = { cubeFaces: 0, draws: 0 },
    original = {
      framebufferTexture2D: gl.framebufferTexture2D,
      drawArrays: gl.drawArrays,
    };
  gl.framebufferTexture2D = function (...args) {
    if (
      args[2] >= gl.TEXTURE_CUBE_MAP_POSITIVE_X &&
      args[2] <= gl.TEXTURE_CUBE_MAP_NEGATIVE_Z
    )
      observed.cubeFaces++;
    return original.framebufferTexture2D.apply(this, args);
  };
  gl.drawArrays = function (...args) {
    observed.draws++;
    return original.drawArrays.apply(this, args);
  };
  let budget;
  try {
    const before = window.spatialGpuResources().created;
    const result = draw();
    const after = window.spatialGpuResources().created;
    budget = {
      ...result.stats,
      observed,
      effectBytes: canvas.width * canvas.height * 12 + 256 * 256 * 24,
    };
    check(
      Object.keys(before).every((k) => before[k] === after[k]),
      "warm environment allocated GPU resources",
      { before, after },
    );
    check(
      budget.shadowPassCount === 6 &&
        observed.cubeFaces === 6 &&
        budget.shadowDrawCalls <= 384 &&
        budget.effectDrawCalls === 1 &&
        budget.dofSampleBudget === 13 &&
        budget.terrainUploadBytes === 0 &&
        budget.effectTextureBytes === budget.effectBytes,
      "environment GPU budget mismatch",
      budget,
    );
    check(
      observed.draws === budget.drawCalls,
      "environment draw statistics do not reflect GPU calls",
      budget,
    );
  } finally {
    Object.assign(gl, original);
  }

  // Camera-facing cutout caster: inspect its ground shadow without the visible sprite hiding the receiver.
  const casterDoc = structuredClone(document);
  casterDoc.spatial.camera = {
    ...camera,
    position: { x: 0, y: -120, elevation: 300 },
    target: { x: 0, y: 30, elevation: 0 },
    height: 220,
  };
  casterDoc.spatial.terrain = [ground];
  casterDoc.sceneComposition.fragments.environment.instances = [
    {
      id: "caster",
      prefab: "blank",
      x: 0,
      y: 0,
      props: {
        components: {
          visual: {
            kind: "sprite",
            texture: 3,
            width: 48,
            height: 48,
            originY: 1,
          },
          collider: {
            type: "aabb",
            halfWidth: 1,
            halfHeight: 1,
            isTrigger: false,
          },
          layer: "player",
          body: {
            type: "kinematic",
            heightSpan: { floorId: 0, elevation: 0, height: 48 },
          },
        },
      },
    },
  ];
  casterDoc.spatial.billboards = { caster: {} };
  const casterLighting = {
    ambient: [0.03, 0.03, 0.03],
    lights: [
      { position: { x: 0, y: -80, elevation: 80 }, radius: 300, intensity: 2 },
    ],
    shadows: { lightIndex: 0, resolution: 512, bias: 0.3 },
  };
  casterDoc.spatial.environment = { lighting: casterLighting };
  const handles = await apply(casterDoc);
  const casterPacket = () => ({
    ...scene.frame.spatial,
    billboards: new Float32Array(),
    billboardVertexCount: 0,
  });
  const alphaImage = draw(casterPacket()).pixels;
  const alpha = {
    hole: sample(alphaImage, { x: 0, y: 34, elevation: 0 }),
    edge: sample(alphaImage, { x: 27, y: 34, elevation: 0 }),
    casterVertices: scene.frame.spatial.environment.shadowCasterVertexCount,
  };
  check(
    luma(alpha.hole) > luma(alpha.edge) + 35 && alpha.casterVertices === 6,
    "alpha cutout did not survive shadow depth",
    alpha,
  );
  check(
    engine.moveDataSceneSpatialBody(handles.caster, 50, 0),
    "caster movement rejected",
  );
  await wait();
  alpha.moved = sample(draw(casterPacket()).pixels, {
    x: 27,
    y: 34,
    elevation: 0,
  });
  check(
    luma(alpha.moved) > luma(alpha.edge) + 35,
    "moving billboard did not update its shadow",
    alpha,
  );
  check(
    engine.moveDataSceneSpatialBody(handles.caster, -50, 0),
    "caster return rejected",
  );
  engine.setDataSceneSpatialCamera(
    {
      ...casterDoc.spatial.camera,
      height: 30,
      target: { x: 0, y: 65, elevation: 0 },
    },
    renderer.viewportSize(),
  );
  await wait();
  const outside = scene.frame.spatial;
  check(
    outside.billboardVertexCount === 0 &&
      outside.environment.shadowCasterVertexCount === 6,
    "offscreen caster was culled from shadow buffer",
    {
      main: outside.billboardVertexCount,
      shadow: outside.environment.shadowCasterVertexCount,
    },
  );
  const offscreenShadow = draw();
  const noShadowLighting = structuredClone(casterLighting);
  delete noShadowLighting.shadows;
  const offscreenLit = await env({ lighting: noShadowLighting });
  alpha.offscreenShadow = sample(offscreenShadow.pixels, {
    x: 0,
    y: 65,
    elevation: 0,
  });
  alpha.offscreenLit = sample(offscreenLit.pixels, {
    x: 0,
    y: 65,
    elevation: 0,
  });
  check(
    luma(alpha.offscreenLit) > luma(alpha.offscreenShadow) + 35 &&
      offscreenShadow.stats.shadowUploadBytes === 264,
    "offscreen caster shadow or upload statistics missing",
    alpha,
  );

  // A striped horizontal sheet makes DOF visible in both orthographic and perspective depth reconstruction.
  const tex = globalThis.document.createElement("canvas");
  tex.width = tex.height = 64;
  const ctx = tex.getContext("2d");
  for (let x = 0; x < 64; x++) {
    ctx.fillStyle = x % 4 < 2 ? "#ffffff" : "#101010";
    ctx.fillRect(x, 0, 1, 64);
  }
  await renderer.loadTexture(7, tex.toDataURL());
  const dofDoc = structuredClone(document);
  dofDoc.spatial.terrain = [{ ...ground, textureId: 7, color: [1, 1, 1, 1] }];
  dofDoc.spatial.camera = {
    ...camera,
    position: { x: 0, y: -200, elevation: 250 },
    target: { x: 0, y: 20, elevation: 0 },
    height: 220,
    fovDegrees: 65,
  };
  const depthAt = (point) => {
    const c = scene.frame.spatial.camera;
    const dx = c[20] - c[17],
      dy = c[21] - c[18],
      dz = c[22] - c[19],
      len = Math.hypot(dx, dy, dz);
    return (
      ((point.x - c[17]) * dx +
        (point.elevation - c[18]) * dy +
        (-point.y - c[19]) * dz) /
      len
    );
  };
  const contrast = (pixels, point) => {
    const s = view.project(point, scene.frame.spatial),
      dpr = canvas.width / canvas.clientWidth,
      cy = canvas.height - 1 - Math.round(s.y * dpr),
      cx = Math.round(s.x * dpr),
      vals = [];
    for (let y = -2; y <= 2; y++)
      for (let x = -Math.round(35 * dpr); x <= Math.round(35 * dpr); x++) {
        const p = ((cy + y) * canvas.width + cx + x) * 4;
        vals.push(pixels[p]);
      }
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Math.sqrt(
      vals.reduce((a, b) => a + (b - avg) ** 2, 0) / vals.length,
    );
  };
  const dof = [];
  for (const projection of ["orthographic", "perspective"]) {
    dofDoc.spatial.camera.projection = projection;
    await apply(dofDoc);
    const near = { x: 0, y: -40, elevation: 0 },
      far = { x: 0, y: 90, elevation: 0 },
      clear = draw().pixels;
    const settings = {
      depthOfField: {
        focusDistance: depthAt(near),
        focusRange: 3,
        aperture: 32,
        maxBlurRadius: 12,
      },
    };
    const focused = await env(settings);
    if (projection === "perspective")
      await window.spatialDebugScreenshot(
        "environment-dof",
        canvas.toDataURL(),
      );
    const entry = {
      projection,
      clearNear: contrast(clear, near),
      focusedNear: contrast(focused.pixels, near),
      clearFar: contrast(clear, far),
      blurredFar: contrast(focused.pixels, far),
      focusDistance: depthAt(near),
    };
    check(
      Math.abs(entry.clearNear - entry.focusedNear) < 8 &&
        entry.blurredFar < entry.clearFar * 0.85,
      "DOF did not preserve focus and blur actual distant depth",
      entry,
    );
    const farFocus = await env({
      depthOfField: { ...settings.depthOfField, focusDistance: depthAt(far) },
    });
    entry.refocusedFar = contrast(farFocus.pixels, far);
    entry.blurredNear = contrast(farFocus.pixels, near);
    check(
      entry.refocusedFar > entry.blurredFar + 8 &&
        entry.blurredNear < entry.clearNear * 0.85,
      "DOF runtime refocus did not change planes",
      entry,
    );
    dof.push(entry);
  }

  // Exposure/tone mapping retain HDR detail; fog uses camera depth and HUD is drawn after all spatial effects.
  await apply(document);
  const neutral = await env({ colorGrading: {} }),
    exposed = await env({ colorGrading: { exposure: 1 } }),
    gray = await env({ colorGrading: { saturation: 0, tint: [1, 0.5, 0.25] } });
  const grading = {
    neutral: sample(neutral.pixels, receiver),
    exposed: sample(exposed.pixels, receiver),
    tinted: sample(gray.pixels, receiver),
  };
  check(
    luma(grading.exposed) > luma(grading.neutral) + 20 &&
      grading.tinted[0] > grading.tinted[1] + 20 &&
      grading.tinted[1] > grading.tinted[2] + 10,
    "color grading controls missing",
    grading,
  );
  const hdrLighting = { ambient: [4, 4, 4], lights: [] };
  const clipped = await env({ lighting: hdrLighting });
  const mapped = await env({
    lighting: hdrLighting,
    colorGrading: { toneMapping: "reinhard" },
  });
  grading.clipped = sample(clipped.pixels, receiver);
  grading.mapped = sample(mapped.pixels, receiver);
  check(
    luma(grading.clipped) > 250 &&
      luma(grading.mapped) < 240 &&
      luma(grading.mapped) > 140,
    "HDR tone mapping did not recover highlight range",
    grading,
  );
  const distance = depthAt(receiver),
    fogged = await env({
      fog: {
        color: [0.02, 0.05, 0.3],
        start: distance - 10,
        end: distance + 10,
      },
    });
  const fog = {
    color: sample(fogged.pixels, receiver),
    clear: sample(neutral.pixels, receiver),
  };
  check(
    fog.color[2] > fog.color[0] + 25 && fog.color[0] < fog.clear[0] - 20,
    "distance fog missing",
    fog,
  );
  const fogCamera = {
    ...camera,
    position: {
      ...camera.position,
      elevation: camera.position.elevation + 120,
    },
  };
  engine.setDataSceneSpatialCamera(fogCamera, renderer.viewportSize());
  await wait();
  fog.moved = sample(draw().pixels, receiver);
  check(
    fog.moved[0] < fog.color[0] - 30,
    "fog ignored actual camera distance",
    fog,
  );
  engine.setDataSceneSpatialCamera(camera, renderer.viewportSize());
  await wait();
  const hudA = draw(undefined, true).pixels;
  await env({
    depthOfField: { focusDistance: 1, maxBlurRadius: 12 },
    colorGrading: { exposure: -4, tint: [0, 1, 0] },
    fog: { color: [0, 0, 1], start: 0, end: 10 },
  });
  const hudB = draw(undefined, true).pixels,
    hudOffset =
      ((canvas.height -
        Math.round((18 * canvas.height) / canvas.clientHeight)) *
        canvas.width +
        Math.round((18 * canvas.width) / canvas.clientWidth)) *
      4;
  const hud = {
    before: [...hudA.slice(hudOffset, hudOffset + 4)],
    after: [...hudB.slice(hudOffset, hudOffset + 4)],
  };
  check(
    hud.before[0] > 150 && hud.before.every((v, i) => v === hud.after[i]),
    "spatial postprocessing affected flat HUD",
    hud,
  );

  // linear-sRGB textures decode exactly once, and the spatial composite targets the renderer's scene FBO.
  const linearDoc = structuredClone(document);
  linearDoc.spatial.terrain = [
    { ...ground, textureId: 7, color: [1, 1, 1, 1] },
  ];
  linearDoc.spatial.environment = { colorGrading: {} };
  await apply(linearDoc);
  const linearCanvas = globalThis.document.createElement("canvas");
  linearCanvas.style.cssText = `width:${canvas.clientWidth}px;height:${canvas.clientHeight}px;position:absolute;left:-10000px`;
  globalThis.document.body.append(linearCanvas);
  const linearRenderer = new WebGL2Renderer(linearCanvas, {
    colorManagement: "linear-srgb",
    preserveDrawingBuffer: true,
  });
  const linear = {};
  try {
    const t = globalThis.document.createElement("canvas");
    t.width = t.height = 8;
    const c = t.getContext("2d");
    c.fillStyle = "#808080";
    c.fillRect(0, 0, 8, 8);
    await linearRenderer.loadTexture(7, t.toDataURL());
    const read = () => {
      linearRenderer.render();
      linearRenderer.renderCommands({
        ...scene.frame.state.renderCommandBuffer,
        buffer: new Float32Array(),
        commandCount: 0,
      });
      linearRenderer.renderPostProcess();
      const g = linearCanvas.getContext("webgl2"),
        p = new Uint8Array(linearCanvas.width * linearCanvas.height * 4);
      g.readPixels(
        0,
        0,
        linearCanvas.width,
        linearCanvas.height,
        g.RGBA,
        g.UNSIGNED_BYTE,
        p,
      );
      check(g.getError() === g.NO_ERROR, "linear environment WebGL error");
      return sample(p, receiver);
    };
    linear.identity = read();
    check(
      Math.abs(linear.identity[0] - 128) < 3,
      "linear environment double decoded or encoded texture",
      linear,
    );
    await env({
      lighting: { ambient: [4, 4, 4], lights: [] },
      colorGrading: { toneMapping: "reinhard" },
    });
    linear.hdr = read();
    const expected = Math.round(
      (1.055 * Math.pow((4 * 0.2158605) / (1 + 4 * 0.2158605), 1 / 2.4) -
        0.055) *
        255,
    );
    check(
      Math.abs(linear.hdr[0] - expected) < 3,
      "linear HDR tone mapping or current FBO composite failed",
      { linear, expected },
    );
  } finally {
    linearRenderer.destroy();
    linearCanvas.remove();
  }

  // Coverage of debug segments above the empty background must survive the HDR composite.
  engine.setDataSceneSpatialDebug({
    floorIds: true,
    billboards: true,
    depthTest: false,
  });
  await apply(casterDoc);
  engine.setDataSceneSpatialDebug({
    floorIds: true,
    billboards: true,
    depthTest: false,
  });
  await wait();
  const debugFrame = scene.frame.spatial;
  const debugOnly = {
    ...debugFrame,
    terrainDrawRanges: new Uint32Array(),
    billboards: new Float32Array(),
    billboardVertexCount: 0,
    environment: {
      ...debugFrame.environment,
      values: new Float32Array(debugFrame.environment.values),
    },
  };
  // Keep environment active with identity grading while excluding all geometry from the main pass.
  debugOnly.environment.values[0] = 8;
  debugOnly.environment.values[1] = 0;
  debugOnly.environment.values[2] = -1;
  debugOnly.environment.values[3] = 0;
  debugOnly.environment.values.fill(0, 12, 60);
  debugOnly.environment.shadowMatrices = new Float32Array();
  debugOnly.environment.shadowCasters = new Float32Array();
  debugOnly.environment.shadowCasterVertexCount = 0;
  const debugPixels = draw(debugOnly).pixels;
  let debugColored = 0;
  for (let i = 0; i < debugPixels.length; i += 4)
    if (
      debugPixels[i] > 70 ||
      debugPixels[i + 1] > 100 ||
      debugPixels[i + 2] > 150
    )
      debugColored++;
  check(
    debugColored > 10 && debugOnly.debug.vertexCount > 0,
    "HDR composite discarded debug coverage on empty depth",
    { debugColored },
  );
  const debugLifecycle = [];
  const diagnosticCanvas = globalThis.document.createElement("canvas");
  diagnosticCanvas.style.cssText = `width:${canvas.clientWidth}px;height:${canvas.clientHeight}px;position:absolute;left:-10000px`;
  globalThis.document.body.append(diagnosticCanvas);
  const diagnosticRenderer = new WebGL2Renderer(diagnosticCanvas, {
    preserveDrawingBuffer: true,
  });
  try {
    const g = diagnosticCanvas.getContext("webgl2");
    for (const stage of ["cold", "warm", "resize"]) {
      if (stage === "resize") {
        diagnosticCanvas.style.width = `${canvas.clientWidth + 16}px`;
        diagnosticRenderer.resize();
      }
      diagnosticRenderer.render();
      diagnosticRenderer.renderCommands({
        ...scene.frame.state.renderCommandBuffer,
        spatial: debugOnly,
        buffer: new Float32Array(),
        commandCount: 0,
      });
      diagnosticRenderer.renderPostProcess();
      const error = g.getError(),
        p = new Uint8Array(
          diagnosticCanvas.width * diagnosticCanvas.height * 4,
        );
      g.readPixels(
        0,
        0,
        diagnosticCanvas.width,
        diagnosticCanvas.height,
        g.RGBA,
        g.UNSIGNED_BYTE,
        p,
      );
      let colored = 0;
      for (let i = 0; i < p.length; i += 4)
        if (p[i] > 100 || p[i + 1] > 100 || p[i + 2] > 150) colored++;
      check(
        error === g.NO_ERROR && colored > 10,
        "cold/resized debug-only HDR draw failed",
        { stage, error, colored },
      );
      debugLifecycle.push({ stage, error, colored });
    }
  } finally {
    diagnosticRenderer.destroy();
    diagnosticCanvas.remove();
  }
  engine.setDataSceneSpatialDebug(null);

  // Version 7 stores runtime environment, and a fresh Engine restores it without scene callbacks.
  await apply(casterDoc);
  const runtime = {
    lighting: casterLighting,
    depthOfField: { focusDistance: 250, focusRange: 20, maxBlurRadius: 6 },
    colorGrading: { toneMapping: "aces", exposure: -0.5 },
    fog: { color: [0.01, 0.02, 0.04], start: 200, end: 800 },
  };
  await env(runtime);
  const saved = JSON.parse(
    JSON.stringify(
      captureGameStateSnapshot(engine, {
        includeDataSceneState: true,
        includeDataSceneProgress: true,
        dataSceneAuthoringDocument: casterDoc,
      }),
    ),
  );
  const savedPixels = draw().pixels,
    values = [...scene.frame.spatial.environment.values];
  check(
    saved.dataScene.version === 7 &&
      saved.dataScene.progress.spatial.environment.depthOfField
        .focusDistance === 250,
    "v7 missing runtime environment",
    saved.dataScene,
  );
  let freshFrame, fresh;
  const freshCanvas = globalThis.document.createElement("canvas");
  freshCanvas.style.cssText = `width:${canvas.clientWidth}px;height:${canvas.clientHeight}px;position:absolute;left:-10000px`;
  globalThis.document.body.append(freshCanvas);
  const freshRenderer = new WebGL2Renderer(freshCanvas, {
    preserveDrawingBuffer: true,
    clearColor: [0.04, 0.07, 0.12, 1],
  });
  try {
    const source = globalThis.document.createElement("canvas");
    source.width = source.height = 32;
    const c = source.getContext("2d");
    c.fillStyle = "#20ff20";
    c.fillRect(0, 0, 32, 32);
    c.clearRect(10, 10, 12, 12);
    await freshRenderer.loadTexture(3, source.toDataURL());
    fresh = await createEngine(
      (state) => {
        freshRenderer.render();
        freshRenderer.renderCommands(state.renderCommandBuffer);
        freshRenderer.renderPostProcess();
        freshFrame = state;
      },
      () => ({
        w: false,
        a: false,
        s: false,
        d: false,
        space: false,
        enter: false,
        mouseLeft: false,
        mouseX: 0,
        mouseY: 0,
      }),
      undefined,
      () => freshRenderer.viewportSize(),
    );
    const result = restoreGameStateSnapshot(fresh, saved);
    fresh.start();
    await wait();
    const bytes = new Uint8Array(freshCanvas.width * freshCanvas.height * 4);
    freshCanvas
      .getContext("webgl2")
      .readPixels(
        0,
        0,
        freshCanvas.width,
        freshCanvas.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bytes,
      );
    check(
      result.dataSceneStateApplied &&
        fresh.dataSceneState() === "paused" &&
        values.every(
          (v, i) =>
            v === freshFrame.renderCommandBuffer.spatial.environment.values[i],
        ) &&
        delta(savedPixels, bytes) === 0,
      "fresh environment save restore changed native parameters/pixels",
      {
        result,
        diff: delta(savedPixels, bytes),
        size: [freshCanvas.width, freshCanvas.height],
      },
    );
  } finally {
    fresh?.destroy();
    freshRenderer.destroy();
    freshCanvas.remove();
  }

  // Malformed borrowed packets fail before any GPU draw; disabling effects frees their targets.
  const valid = scene.frame.spatial,
    bad = [];
  for (const change of [
    (v) => (v[0] = 16),
    (v) => (v[1] = 5),
    (v) => (v[3] = 17),
    (v) => (v[63] = 13),
    (v) => (v[64] = NaN),
  ]) {
    const v = new Float32Array(valid.environment.values);
    change(v);
    bad.push({ ...valid.environment, values: v });
  }
  bad.push(
    { ...valid.environment, version: 2 },
    { ...valid.environment, shadowMatrices: new Float32Array(95) },
    { ...valid.environment, shadowCasterVertexCount: 999999 },
  );
  let invalidPacketsRejected = 0,
    invalidDraws = 0;
  const oldDraw = gl.drawArrays;
  gl.drawArrays = function (...args) {
    invalidDraws++;
    return oldDraw.apply(this, args);
  };
  try {
    for (const environment of bad) {
      try {
        renderer.renderCommands({
          ...scene.frame.state.renderCommandBuffer,
          spatial: { ...valid, environment },
        });
      } catch {
        invalidPacketsRejected++;
      }
    }
  } finally {
    gl.drawArrays = oldDraw;
  }
  check(
    invalidPacketsRejected === bad.length && invalidDraws === 0,
    "invalid environment packet submitted GPU work",
    { invalidPacketsRejected, invalidDraws },
  );
  const enabledResources = window.spatialGpuResources().live;
  // A flat HUD command in the same spatial frame retains resources; a full flat frame releases them.
  renderer.render();
  drawCommands(scene.frame.spatial);
  renderer.renderCommands({
    buffer: new Float32Array(),
    commandCount: 0,
    floatsPerCommand: 15,
  });
  renderer.renderPostProcess();
  check(
    window.spatialGpuResources().live.Texture === enabledResources.Texture,
    "flat HUD released spatial effects in the same frame",
  );
  renderer.render();
  renderer.renderCommands({
    buffer: new Float32Array(),
    commandCount: 0,
    floatsPerCommand: 15,
  });
  renderer.renderPostProcess();
  const flatResources = window.spatialGpuResources().live;
  check(
    flatResources.Texture <= enabledResources.Texture - 3 &&
      flatResources.Framebuffer <= enabledResources.Framebuffer - 2,
    "flat scene transition retained spatial effect targets",
    { enabledResources, flatResources },
  );
  draw();
  await env(null);
  const disabledResources = window.spatialGpuResources().live;
  check(
    disabledResources.Texture <= enabledResources.Texture - 3 &&
      disabledResources.Framebuffer <= enabledResources.Framebuffer - 2,
    "environment disable retained GPU targets",
    { enabledResources, disabledResources },
  );
  await apply(document);
  const disabledPixelDifferences = delta(baseline, draw().pixels);
  check(
    disabledPixelDifferences === 0,
    "disabling environment changed the legacy spatial image",
    { disabledPixelDifferences },
  );
  return {
    shadowPixels,
    alpha,
    dof,
    grading,
    fog,
    hud,
    linear,
    budget,
    debugColored,
    glState,
    debugLifecycle,
    persistence: { version: saved.dataScene.version, pixelDifferences: 0 },
    invalidPacketsRejected,
    invalidDraws,
    disabledPixelDifferences,
    enabledResources,
    disabledResources,
  };
}
