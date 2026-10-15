import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium } from "playwright-core";
import { runReleaseCommand } from "./github-release-command.mjs";
const root = resolve(".");
await mkdir(resolve(root, "artifacts"), { recursive: true });
const output = await mkdtemp(
  resolve(root, "artifacts/spatial-scene-consumer-"),
);
await runReleaseCommand("pnpm", ["pack", "--pack-destination", output], {
  cwd: resolve(root, "packages/ferrum-web"),
});
const tgz = (await readdir(output)).find((f) => f.endsWith(".tgz"));
assert(tgz);
await runReleaseCommand("tar", ["-xzf", resolve(output, tgz), "-C", output]);
const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%}canvas{display:block;width:100%;height:100%}</style><script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/package/dist/core.js","@ferrum2d/ferrum-web/authoring":"/package/dist/authoring.js"}}</script></head><body><canvas id="game"></canvas><script type="module">import{startSpatialScene}from'/recipe.mjs';window.spatialScene=await startSpatialScene(document.querySelector('canvas'));</script></body></html>`;
const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(html);
      return;
    }
    let file;
    if (url.pathname === "/recipe.mjs")
      file = resolve(root, "examples/data-scene-native/spatial.mjs");
    else if (url.pathname === "/visibility-probe.mjs")
      file = resolve(
        root,
        "tests/smoke/spatial-visibility-browser-fixture.mjs",
      );
    else if (url.pathname === "/terrain-chunks-probe.mjs")
      file = resolve(
        root,
        "tests/smoke/spatial-terrain-chunks-browser-fixture.mjs",
      );
    else if (url.pathname === "/spatial-debug-probe.mjs")
      file = resolve(root, "tests/smoke/spatial-debug-browser-fixture.mjs");
    else if (url.pathname === "/spatial-connections-probe.mjs")
      file = resolve(
        root,
        "tests/smoke/spatial-connections-browser-fixture.mjs",
      );
    else if (url.pathname === "/spatial-navigation-probe.mjs")
      file = resolve(
        root,
        "tests/smoke/spatial-navigation-browser-fixture.mjs",
      );
    else if (url.pathname === "/spatial-environment-probe.mjs")
      file = resolve(
        root,
        "tests/smoke/spatial-environment-browser-fixture.mjs",
      );
    else {
      file = resolve(output, "." + decodeURIComponent(url.pathname));
      if (
        !file.startsWith(resolve(output, "package") + sep) ||
        !/\.(js|wasm)$/.test(file)
      ) {
        res.writeHead(403).end();
        return;
      }
    }
    res.setHeader(
      "Content-Type",
      file.endsWith(".wasm") ? "application/wasm" : "application/javascript",
    );
    res.end(await readFile(file));
  })().catch(() => res.writeHead(404).end());
});
let browser;
const report = {
  format: "ferrum2d.spatial-scene.consumer-smoke",
  version: 1,
  status: "running",
  tarball: tgz,
  cases: [],
};
try {
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const launchOptions = {
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  };
  if (process.env.FERRUM_BROWSER_EXECUTABLE) {
    browser = await chromium.launch({
      ...launchOptions,
      executablePath: process.env.FERRUM_BROWSER_EXECUTABLE,
    });
  } else {
    try {
      browser = await chromium.launch({
        ...launchOptions,
        channel: process.env.FERRUM_BROWSER_CHANNEL ?? "chromium",
      });
    } catch (error) {
      if (process.env.FERRUM_BROWSER_CHANNEL) throw error;
      try {
        browser = await chromium.launch({
          ...launchOptions,
          channel: "chrome",
        });
      } catch {
        browser = await chromium.launch(launchOptions);
      }
    }
  }
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ])
    for (const deviceScaleFactor of [1, 2]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor });
      await page.exposeFunction(
        "spatialDebugScreenshot",
        async (mode, data) => {
          if (
            ![
              "depth",
              "overlay",
              "physics-depth",
              "physics-overlay",
              "contacts",
              "environment-lit",
              "environment-shadow",
              "environment-dof",
            ].includes(mode) ||
            !data.startsWith("data:image/png;base64,")
          )
            throw Error("Invalid debug capture");
          const name = `debug-${mode}-${viewport.width}x${viewport.height}-dpr${deviceScaleFactor}.png`;
          await writeFile(
            resolve(output, name),
            Buffer.from(data.split(",")[1], "base64"),
          );
          return name;
        },
      );
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        const live = {},
          created = {};
        for (const kind of [
          "Buffer",
          "Program",
          "Shader",
          "Texture",
          "Framebuffer",
          "Renderbuffer",
          "VertexArray",
          "Sampler",
        ]) {
          const objects = new Set();
          live[kind] = objects;
          created[kind] = 0;
          const proto = WebGL2RenderingContext.prototype,
            create = proto["create" + kind],
            remove = proto["delete" + kind];
          proto["create" + kind] = function (...args) {
            const object = create.apply(this, args);
            if (object) {
              objects.add(object);
              created[kind]++;
            }
            return object;
          };
          proto["delete" + kind] = function (object) {
            objects.delete(object);
            return remove.call(this, object);
          };
        }
        window.spatialGpuResources = () => ({
          live: Object.fromEntries(
            Object.entries(live).map(([k, v]) => [k, v.size]),
          ),
          created: { ...created },
        });
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.spatialScene?.frame?.spatial);
      const result = await page.evaluate(async () => {
        let s = window.spatialScene;
        const canvas = document.querySelector("canvas"),
          gl = canvas.getContext("webgl2");
        const wait = async () => {
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
        };
        s.engine.pauseDataScene();
        await wait();
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
        const initial = image();
        let colored = 0;
        for (let i = 0; i < initial.length; i += 4)
          if (initial[i] > 25 || initial[i + 1] > 35 || initial[i + 2] > 50)
            colored++;
        const sample = (screen) => {
          const b = new Uint8Array(4),
            x = Math.round((screen.x * canvas.width) / canvas.clientWidth),
            y =
              canvas.height -
              1 -
              Math.round((screen.y * canvas.height) / canvas.clientHeight);
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
          return [...b];
        };
        const matrices = [],
          hits = [];
        for (const projection of ["orthographic", "perspective"])
          for (const elevation of [180, 380]) {
            const c = {
              ...s.document.spatial.camera,
              projection,
              fovDegrees: 90,
              position: { x: 160, y: -200, elevation },
            };
            if (!s.setCamera(c)) throw Error("camera rejected");
            await wait();
            const f = s.frame.spatial,
              point = { x: -80, y: -32, elevation: 0 },
              screen = s.view.project(point, f),
              hit = s.view.pick(screen, f);
            if (
              !hit ||
              hit.surfaceId !== "low" ||
              Math.hypot(hit.x - point.x, hit.y - point.y, hit.elevation) > 0.02
            )
              throw Error(
                "terrain picking mismatch " +
                  JSON.stringify({
                    projection,
                    elevation,
                    screen,
                    hit,
                    camera: [...f.camera],
                  }),
              );
            matrices.push([...f.camera]);
            hits.push(hit);
          }
        s.setCamera(s.document.spatial.camera);
        await wait();
        const before = s.view.project(
            { x: -64, y: 0, elevation: 0 },
            s.frame.spatial,
          ),
          old = s.handles.actor;
        if (
          !s.engine.moveDataSceneSpatialBody(old, 128, 0, { maxStepHeight: 16 })
        )
          throw Error("step rejected");
        await wait();
        const body = s.engine.getPhysicsEntity(old),
          after = s.view.project(
            { x: body.x, y: body.y, elevation: body.heightSpan.elevation },
            s.frame.spatial,
          );
        if (body.x !== 64 || body.heightSpan.elevation !== 32)
          throw Error("native step failed");
        const sameGroundLow = s.view.project(
          { x: 64, y: 0, elevation: 0 },
          s.frame.spatial,
        );
        if (after.y >= sameGroundLow.y - 1)
          throw Error("physical elevation did not project");
        const stats = { ...s.frame.stats.spatial };
        if (stats.terrainUploadBytes !== 0)
          throw Error("static terrain reuploaded per frame");
        // JSON -> fresh Engine/renderer: runtime camera, native step height, bridge floor and label anchor.
        s.setCamera({
          ...s.document.spatial.camera,
          height: s.document.spatial.camera.height * 1.03,
          position: { ...s.document.spatial.camera.position, elevation: 640 },
        });
        await wait();
        const saved = JSON.parse(JSON.stringify(s.save()));
        if (
          saved.dataScene.version !== 6 ||
          saved.dataScene.progress.instances.find((p) => p.id === "actor")
            .spatialPose.heightSpan.elevation !== 32
        )
          throw Error("spatial runtime save missing");
        const pixelsBefore = image(),
          cameraBefore = [...s.frame.spatial.camera],
          verticesBefore = [...s.frame.spatial.billboards];
        s.destroy();
        const { startSpatialScene } = await import("/recipe.mjs");
        s = await startSpatialScene(canvas);
        window.spatialScene = s;
        const initialHandle = s.handles.actor;
        const restoreResult = s.restore(saved);
        await wait();
        if (
          !restoreResult.dataSceneStateApplied ||
          s.engine.dataSceneState() !== "paused" ||
          s.engine.getPhysicsEntity(initialHandle) !== undefined
        )
          throw Error("fresh spatial restore lifecycle/handle mismatch");
        const restoredActor = s.engine.getPhysicsEntity(s.handles.actor),
          restoredAbove = s.engine.getPhysicsEntity(s.handles.above);
        if (
          restoredActor.x !== 64 ||
          restoredActor.heightSpan.elevation !== 32 ||
          restoredAbove.heightSpan.floorId !== 1 ||
          restoredAbove.heightSpan.elevation !== 64
        )
          throw Error("fresh spatial body pose mismatch");
        if (
          verticesBefore.some((v, i) => v !== s.frame.spatial.billboards[i]) ||
          cameraBefore.some(
            (v, i) => Math.abs(v - s.frame.spatial.camera[i]) > 0.00001,
          )
        )
          throw Error("fresh spatial camera/geometry mismatch");
        const pixelsAfter = image();
        let pixelDifferences = 0;
        for (let i = 0; i < pixelsBefore.length; i++)
          if (Math.abs(pixelsBefore[i] - pixelsAfter[i]) > 3)
            pixelDifferences++;
        if (pixelDifferences !== 0)
          throw Error(
            "fresh spatial restore changed pixels " + pixelDifferences,
          );
        const persistence = {
          version: saved.dataScene.version,
          actor: restoredActor,
          above: restoredAbove,
          pixelDifferences,
          camera: saved.dataScene.progress.spatial.camera,
          snapshotHash: saved.snapshotHash,
        };
        // Alpha hole must reveal identical background, while opaque border changes a pixel.
        const hole = s.view.project(
          { x: -64, y: 36, elevation: 32 },
          s.frame.spatial,
        );
        const edge = s.view.project(
          { x: -82, y: 36, elevation: 32 },
          s.frame.spatial,
        );
        const withHole = sample(hole),
          withEdge = sample(edge),
          spec = structuredClone(s.document.spatial);
        delete spec.billboards.tree;
        if (!s.reconfigure(spec))
          throw Error("baseline configuration rejected");
        await wait();
        const withoutHole = sample(hole),
          withoutEdge = sample(edge);
        if (withHole.some((v, i) => Math.abs(v - withoutHole[i]) > 3))
          throw Error("alpha hole wrote depth/color");
        if (withEdge.every((v, i) => Math.abs(v - withoutEdge[i]) < 5))
          throw Error("opaque sprite missing");
        if (!s.reconfigure(s.document.spatial))
          throw Error("reconfigure rejected");
        await wait();
        // Nonzero elevation geometry occludes the lower body, independent of instance/layer order.
        const underPoint = s.view.project(
            { x: 80, y: 108, elevation: 16 },
            s.frame.spatial,
          ),
          abovePoint = s.view.project(
            { x: 80, y: 108, elevation: 80 },
            s.frame.spatial,
          );
        const underPixel = sample(underPoint),
          abovePixel = sample(abovePoint);
        if (underPixel[2] > underPixel[0] * 1.5 + 20)
          throw Error("lower blue sprite incorrectly visible through bridge");
        if (abovePixel[0] < abovePixel[1] * 1.5 + 20)
          throw Error("upper red sprite missing");
        const packet = s.frame.state.renderCommandBuffer,
          vertices = s.frame.spatial.billboards;
        const reversed = new Float32Array(vertices.length);
        for (let i = 0; i < vertices.length; i += 66)
          reversed.set(vertices.subarray(i, i + 66), vertices.length - i - 66);
        s.renderer.render();
        s.renderer.renderCommands({
          ...packet,
          spatial: { ...s.frame.spatial, billboards: reversed },
        });
        s.renderer.renderPostProcess();
        if (
          sample(abovePoint).some((v, i) => Math.abs(v - abovePixel[i]) > 3) ||
          sample(underPoint).some((v, i) => Math.abs(v - underPixel[i]) > 3)
        )
          throw Error("submission order changed depth result");
        await wait();
        // Exercise depth attachment on a postprocess FBO, not only the default canvas.
        s.renderer.setPostProcess([{ kind: "fade", opacity: 0.1 }]);
        await wait();
        const postPixel = sample(abovePoint);
        if (postPixel[0] < postPixel[1] * 1.5 + 20)
          throw Error("offscreen depth target failed");
        const postStats = { ...s.frame.stats.spatial };
        if (postStats.depthBufferBytes !== canvas.width * canvas.height * 4)
          throw Error(
            "depth target bytes missing " +
              JSON.stringify({
                postStats,
                width: canvas.width,
                height: canvas.height,
                viewport: [...gl.getParameter(gl.VIEWPORT)],
              }),
          );
        const counts = { ...s.frame.resources };
        s.renderer.setPostProcess(false);
        await wait();
        // Client-coordinate picking must also work when the canvas is offset and CSS-scaled.
        canvas.style.cssText =
          "position:absolute;left:23px;top:31px;transform:scale(0.8);transform-origin:top left";
        const offsetPoint = { x: -80, y: -32, elevation: 0 },
          offsetScreen = s.view.project(offsetPoint, s.frame.spatial),
          offsetHit = s.view.pick(offsetScreen, s.frame.spatial);
        if (
          !offsetHit ||
          offsetHit.surfaceId !== "low" ||
          Math.hypot(offsetHit.x + 80, offsetHit.y + 32) > 0.02
        )
          throw Error("offset canvas picking failed");
        canvas.style.cssText = "";
        const budgets = [],
          beforeBenchHandle = s.handles.actor;
        if (canvas.clientWidth === 1280 && canvas.width === 1280) {
          const { applyDataSceneAuthoringDocument } = await import(
            "@ferrum2d/ferrum-web/authoring"
          );
          for (const count of [100, 500, 1000]) {
            const instances = Array.from({ length: count }, (_, i) => ({
              id: "b" + i,
              prefab: "sprite",
              x: 32 + ((i % 40) - 20) * 4,
              y: 20 + (Math.floor(i / 40) - 12) * 4,
            }));
            const spec = {
              ...structuredClone(s.document.spatial),
              terrain: [
                {
                  id: "floor",
                  x: -96,
                  y: -96,
                  width: 256,
                  depth: 256,
                  elevation: 0,
                },
              ],
              billboards: Object.fromEntries(instances.map((v) => [v.id, {}])),
            };
            delete spec.actor;
            const doc = {
              format: s.document.format,
              version: 1,
              sceneComposition: {
                initialFragment: "bench",
                prefabs: {
                  sprite: {
                    props: {
                      components: {
                        visual: {
                          kind: "sprite",
                          texture: 1,
                          width: 3,
                          height: 6,
                          originY: 1,
                        },
                        collider: "none",
                        layer: "wall",
                      },
                    },
                  },
                },
                fragments: { bench: { instances } },
              },
              behaviorRecipes: { entities: {} },
              spatial: spec,
            };
            applyDataSceneAuthoringDocument(s.engine, doc);
            s.engine.pauseDataScene();
            await wait();
            const commands = s.frame.state.renderCommandBuffer;
            const draw = () => {
              s.renderer.render();
              s.renderer.renderCommands(commands);
              s.renderer.renderPostProcess();
            };
            for (let i = 0; i < 8; i++) draw();
            const allocated = window.spatialGpuResources().created,
              times = [];
            for (let i = 0; i < 20; i++) {
              const start = performance.now();
              draw();
              times.push(performance.now() - start);
            }
            const metrics = s.renderer.stats().spatial;
            const aggregate = s.renderer.stats();
            if (
              s.frame.state.spriteCount !== count ||
              aggregate.spriteCount !== count ||
              aggregate.batchCount !== 1 ||
              aggregate.textureBindCount !== 2 ||
              aggregate.textureSwitchCount !== 1
            )
              throw Error("spatial profiler metrics missing");
            if (
              metrics.billboardCount !== count ||
              metrics.drawCalls !== 2 ||
              metrics.terrainUploadBytes !== 0 ||
              metrics.uploadBytes !== count * 6 * 44
            )
              throw Error("spatial structural budget failed");
            if (
              JSON.stringify(allocated) !==
              JSON.stringify(window.spatialGpuResources().created)
            )
              throw Error("steady frames allocate GPU objects");
            times.sort((a, b) => a - b);
            budgets.push({
              count,
              ...metrics,
              aggregate,
              frameSpriteCount: s.frame.state.spriteCount,
              cpuSubmissionMedianMs: times[10],
              cpuSubmissionP95Ms: times[18],
              resources: s.renderer.resourceStats(),
            });
          }
          applyDataSceneAuthoringDocument(s.engine, s.document);
          s.engine.pauseDataScene();
          await wait();
          if (
            s.engine.getPhysicsEntity(beforeBenchHandle) !== undefined ||
            s.frame.spatial.billboardVertexCount !== 24
          )
            throw Error("scene reset retained stale handles or vertices");
        }
        const { probeSpatialVisibility } = await import(
          "/visibility-probe.mjs"
        );
        const visibility = await probeSpatialVisibility(s, canvas);
        const { probeSpatialTerrainChunks } = await import(
          "/terrain-chunks-probe.mjs"
        );
        const terrainCulling = await probeSpatialTerrainChunks(s, canvas);
        const { probeSpatialDebug } = await import("/spatial-debug-probe.mjs");
        const spatialDebug = await probeSpatialDebug(s, canvas);
        const { probeSpatialConnections } = await import(
          "/spatial-connections-probe.mjs"
        );
        const spatialConnections = await probeSpatialConnections(s, canvas);
        const { probeSpatialNavigation } = await import(
          "/spatial-navigation-probe.mjs"
        );
        const spatialNavigation = await probeSpatialNavigation(s);
        const { probeSpatialEnvironment } = await import(
          "/spatial-environment-probe.mjs"
        );
        const spatialEnvironment = await probeSpatialEnvironment(s, canvas);
        const visibilityRestore = s.restore(saved);
        await wait();
        const visibilityActor = s.engine.getPhysicsEntity(s.handles.actor);
        if (
          !visibilityRestore.dataSceneStateApplied ||
          s.engine.dataSceneState() !== "paused" ||
          visibilityActor?.x !== 64 ||
          visibilityActor?.heightSpan?.elevation !== 32 ||
          s.frame.spatial.billboardVertexCount !== verticesBefore.length / 11 ||
          verticesBefore.some((v, i) => v !== s.frame.spatial.billboards[i]) ||
          cameraBefore.some(
            (v, i) => Math.abs(v - s.frame.spatial.camera[i]) > 0.00001,
          )
        )
          throw Error(
            "visibility fixture did not restore the original spatial scene",
          );
        const visibilityPixels = image();
        let visibilityPixelDifferences = 0;
        for (let i = 0; i < pixelsBefore.length; i++)
          if (Math.abs(pixelsBefore[i] - visibilityPixels[i]) > 3)
            visibilityPixelDifferences++;
        if (visibilityPixelDifferences !== 0)
          throw Error("visibility fixture changed restored framebuffer");
        visibility.restoration = {
          applied: visibilityRestore.dataSceneStateApplied,
          actor: {
            x: visibilityActor.x,
            elevation: visibilityActor.heightSpan.elevation,
          },
          billboardVertexCount: s.frame.spatial.billboardVertexCount,
          pixelDifferences: visibilityPixelDifferences,
        };
        return {
          colored,
          canvas: { width: canvas.width, height: canvas.height },
          hits,
          matrices,
          before,
          after,
          bodyElevation: body.heightSpan.elevation,
          alpha: { withHole, withoutHole, withEdge, withoutEdge },
          underPixel,
          abovePixel,
          postPixel,
          stats,
          postStats,
          counts,
          offsetHit,
          persistence,
          visibility,
          terrainCulling,
          spatialDebug,
          spatialConnections,
          spatialNavigation,
          spatialEnvironment,
          budgets,
          errors: s.errors,
        };
      });
      assert(result.colored > 1000);
      assert.deepEqual(errors, []);
      assert.deepEqual(result.errors, []);
      assert.equal(result.visibility.atlasCases.length, 16);
      assert.equal(result.visibility.clippedCases.length, 5);
      assert.equal(result.visibility.restoration.applied, true);
      assert.equal(result.visibility.restoration.pixelDifferences, 0);
      assert.equal(result.terrainCulling.cases.length, 7);
      assert.equal(result.terrainCulling.invalidPacketsRejected, 9);
      assert.equal(result.terrainCulling.invalidPacketDrawCalls, 0);
      assert.equal(result.spatialDebug.cases.length, 2);
      assert.equal(result.spatialDebug.cameraCases.length, 2);
      assert.equal(result.spatialDebug.invalidPacketsRejected, 10);
      assert.equal(result.spatialDebug.invalidPacketDrawCalls, 0);
      assert.equal(result.spatialDebug.disabledPixelDifferences, 0);
      assert.equal(result.spatialDebug.physicsCases.length, 2);
      assert(result.spatialDebug.contacts.vertexCount > 0);
      assert.equal(result.spatialDebug.contacts.probeIsolation, true);
      assert.equal(result.spatialConnections.trace.length, 9);
      assert.equal(result.spatialConnections.trace.at(-1).floorId, 1);
      assert.equal(result.spatialConnections.under.floorId, 0);
      assert.equal(result.spatialConnections.freshPose.floorId, 1);
      assert.equal(result.spatialConnections.restoredPixelDifferences, 0);
      assert.equal(result.spatialConnections.stopped.floorId, 0);
      assert.equal(result.spatialConnections.invalidRejected, true);
      assert.equal(result.spatialNavigation.bridge.pose.floorId, 1);
      assert.equal(result.spatialNavigation.under.pose.floorId, 0);
      assert.equal(result.spatialNavigation.inputCancelled, true);
      assert.equal(result.spatialNavigation.savedVersion, 6);
      assert.equal(result.spatialNavigation.freshResult.pose.floorId, 1);
      assert.equal(result.spatialNavigation.blocked.status, "blocked");
      assert.equal(result.spatialNavigation.detour.pose.y, 96);
      assert.equal(result.spatialEnvironment.persistence.version, 7);
      assert.equal(result.spatialEnvironment.persistence.pixelDifferences, 0);
      assert.equal(result.spatialEnvironment.dof.length, 2);
      assert.equal(result.spatialEnvironment.invalidPacketsRejected, 8);
      assert.equal(result.spatialEnvironment.invalidDraws, 0);
      assert.equal(result.spatialEnvironment.disabledPixelDifferences, 0);
      assert.equal(result.terrainCulling.farPlaneReference.pixelDifferences, 0);
      assert(result.terrainCulling.farPlaneReference.coloredPixels > 0);
      assert.deepEqual(result.terrainCulling.farPlaneReference.ranges, [0, 36]);
      await page.screenshot({
        path: resolve(
          output,
          `scene-${viewport.width}-dpr${deviceScaleFactor}.png`,
        ),
      });
      const remaining = await page.evaluate(() => {
        window.spatialScene.destroy();
        return window.spatialGpuResources();
      });
      assert(
        Object.values(remaining.live).every((n) => n === 0),
        "GPU resources survived renderer destroy",
      );
      report.cases.push({ viewport, deviceScaleFactor, ...result, remaining });
      await page.close();
    }
  report.status = "passed";
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: report.status,
      cases: report.cases.length,
      output,
    }),
  );
} catch (e) {
  report.status = "failed";
  report.error = String(e);
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  throw e;
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
