import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright-core";
import { runReleaseCommand } from "./github-release-command.mjs";
const root = resolve(".");
await mkdir(process.env.FERRUM_SPATIAL_ARTIFACT_PARENT ?? resolve(root, "artifacts"), { recursive: true });
const output = await mkdtemp(
  resolve(process.env.FERRUM_SPATIAL_ARTIFACT_PARENT ?? resolve(root,"artifacts"), "spatial-scene-consumer-"),
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
    res.setHeader("Access-Control-Allow-Origin","*");
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(html);
      return;
    }
    if (url.pathname === "/gltf/bad-accessor.gltf") {
      const directory=resolve(root,"examples/data-scene-native/assets/gltf/rock");
      const document=JSON.parse(await readFile(resolve(directory,"scene.gltf"),"utf8"));
      const png=await readFile(resolve(directory,"texture-0.png"));
      document.buffers[0].uri="/gltf/rock/scene.bin";
      document.images[0].uri="/gltf-accessor-image.png";
      document.accessors[0].bufferView=document.bufferViews.length;
      document.accessors[0].byteOffset=Math.ceil(png.length/4)*4;
      res.setHeader("Content-Type","model/gltf+json");res.end(JSON.stringify(document));return;
    }
    if (url.pathname === "/gltf-accessor-image.png") {
      const directory=resolve(root,"examples/data-scene-native/assets/gltf/rock");
      const png=await readFile(resolve(directory,"texture-0.png")),bin=await readFile(resolve(directory,"scene.bin"));
      const offset=Math.ceil(png.length/4)*4,bytes=new Uint8Array(offset+72);
      bytes.set(png);bytes.set(bin.subarray(0,72),offset);
      res.setHeader("Content-Type","image/png");res.end(bytes);return;
    }
    if (["/gltf/broken.gltf","/gltf/slow.gltf","/gltf/changed.gltf","/gltf/gzip.gltf"].includes(url.pathname)) {
      const document = JSON.parse(await readFile(resolve(root,"examples/data-scene-native/assets/gltf/building/scene.gltf"),"utf8"));
      document.buffers[0].uri = url.pathname.includes("broken") ? "/gltf/not-found.bin" : url.pathname.includes("slow") ? "/gltf-slow.bin" : url.pathname.includes("gzip") ? "/gltf-gzip.bin" : "/gltf-changed.bin";
      res.setHeader("Content-Type","model/gltf+json");res.end(JSON.stringify(document));return;
    }
    if (["/gltf-slow.bin","/gltf-changed.bin","/gltf-gzip.bin"].includes(url.pathname)) {
      const bytes = await readFile(resolve(root,"examples/data-scene-native/assets/gltf/building/scene.bin"));
      res.setHeader("Content-Type","application/octet-stream");res.setHeader("Content-Length",bytes.length);
      if(url.pathname.includes("gzip")){
        const encoded=gzipSync(bytes,{level:0});assert(encoded.length>bytes.length);
        res.setHeader("Content-Encoding","gzip");res.setHeader("Content-Length",encoded.length);res.end(encoded);return;
      }
      if(url.pathname.includes("changed")){bytes[0]^=1;res.end(bytes);return;}
      res.write(bytes.subarray(0,1));const timer=setTimeout(()=>res.end(bytes.subarray(1)),250);
      res.on("close",()=>clearTimeout(timer));return;
    }
    let file;
    if (url.pathname === "/spatial-gltf-probe.mjs")
      file = resolve(root,"tests/smoke/spatial-gltf-browser-fixture.mjs");
    else if (url.pathname.startsWith("/gltf/")) {
      const directory=resolve(root,"examples/data-scene-native/assets/gltf");
      file=resolve(directory,"."+decodeURIComponent(url.pathname.slice(5)));
      if(!file.startsWith(directory+sep)){res.writeHead(403).end();return;}
    }
    else if (url.pathname === "/recipe.mjs")
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
    else if (url.pathname === "/spatial-model-probe.mjs")
      file = resolve(root, "tests/smoke/spatial-model-browser-fixture.mjs");
    else if (url.pathname === "/rock.glb")
      file = resolve(root, "examples/data-scene-native/assets/rock.glb");
    else if (url.pathname === "/spatial-model-tree-probe.mjs")
      file = resolve(root, "tests/smoke/spatial-model-tree-browser-fixture.mjs");
    else if (url.pathname === "/spatial-model-material-probe.mjs")
      file = resolve(root, "tests/smoke/spatial-model-material-browser-fixture.mjs");
    else if (url.pathname === "/spatial-model-motion-streaming-probe.mjs")
      file = resolve(root, "tests/smoke/spatial-model-motion-streaming-browser-fixture.mjs");
    else if (url.pathname === "/spatial-model-assembly-probe.mjs")
      file = resolve(root, "tests/smoke/spatial-model-assembly-browser-fixture.mjs");
    else if (url.pathname === "/spatial-model-building-probe.mjs")
      file = resolve(root, "tests/smoke/spatial-model-building-browser-fixture.mjs");
    else if (url.pathname === "/spatial-model-instancing-probe.mjs")
      file = resolve(root, "tests/smoke/spatial-model-instancing-browser-fixture.mjs");
    else if (url.pathname === "/spatial-model-preparation-probe.mjs")
      file = resolve(root, "tests/smoke/spatial-model-preparation-browser-fixture.mjs");
    else if (url.pathname === "/building.glb")
      file = resolve(root, "examples/data-scene-native/assets/building.glb");
    else if (url.pathname === "/tree-material.glb")
      file = resolve(root, "examples/data-scene-native/assets/tree-material.glb");
    else if (url.pathname === "/tree.glb")
      file = resolve(root, "examples/data-scene-native/assets/tree.glb");
    else if (url.pathname === "/spatial-quality-probe.mjs")
      file = resolve(root, "tests/smoke/spatial-quality-browser-fixture.mjs");
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
      file.endsWith(".wasm") ? "application/wasm" : file.endsWith(".gltf") ? "model/gltf+json" : file.endsWith(".bin") ? "application/octet-stream" : file.endsWith(".png") ? "image/png" : file.endsWith(".jpg") ? "image/jpeg" : "application/javascript",
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
              "model-gltf", "model-gltf-restored", "model-instancing-1000", "model-instancing-restored", "model-instancing-material", "model-rock", "model-rock-restored", "model-tree-front", "model-tree-back", "model-material-normal", "model-material-emissive", "model-building", "model-building-restored", "model-assembly", "model-assembly-restored", "model-hierarchy", "model-hierarchy-restored", "model-preparation-preserved", "model-preparation-activated", "quality-pixel", "quality-normal", "quality-sun-pcf", "quality-dof-standard", "quality-dof-high",
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
          "Query",
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
        const { probeSpatialQuality } = await import("/spatial-quality-probe.mjs");
        const spatialQuality = await probeSpatialQuality(s, canvas);
        const { probeSpatialModel } = await import("/spatial-model-probe.mjs");
        const spatialModel = await probeSpatialModel(s,canvas);
        const { probeSpatialTree } = await import("/spatial-model-tree-probe.mjs");
        const spatialTree = await probeSpatialTree(s,canvas);
        const { probeSpatialModelMaterials } = await import("/spatial-model-material-probe.mjs");
        const spatialModelMaterials = await probeSpatialModelMaterials(s,canvas);
        const { probeSpatialBuilding } = await import("/spatial-model-building-probe.mjs");
        const spatialBuilding = await probeSpatialBuilding(s,canvas);
        const { probeSpatialModelAssembly } = await import("/spatial-model-assembly-probe.mjs");
        const spatialModelAssembly = await probeSpatialModelAssembly(s,canvas);
        const { probeSpatialModelPreparation } = await import("/spatial-model-preparation-probe.mjs");
        const spatialModelPreparation = await probeSpatialModelPreparation(s,canvas);
        const { probeSpatialModelInstancing } = await import("/spatial-model-instancing-probe.mjs");
        const spatialModelInstancing = await probeSpatialModelInstancing(s,canvas);
        const { probeSpatialGltf } = await import("/spatial-gltf-probe.mjs");
        const spatialGltf = await probeSpatialGltf(s,canvas);
        const {probeSpatialModelMotionStreaming}=await import("/spatial-model-motion-streaming-probe.mjs");
        const spatialModelMotionStreaming=await probeSpatialModelMotionStreaming(s,canvas);
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
          spatialQuality,
          spatialModel,
          spatialTree,
          spatialModelMaterials,
          spatialModelMotionStreaming,
          spatialBuilding,
          spatialModelAssembly,
          spatialModelPreparation,
          spatialModelInstancing,
          spatialGltf,
          budgets,
          errors: s.errors,
        };
      });
      assert(result.colored > 1000);
      assert.equal(result.spatialModel.freshRestore,true);
      assert.equal(result.spatialModelMotionStreaming.freshRestore,true);
      assert.equal(result.spatialModelMotionStreaming.resourceRelease,true);
      assert.equal(result.spatialModel.resourceRelease,true);
      assert.equal(result.spatialModelMaterials.freshRestore,true);
      assert.equal(result.spatialModelMaterials.resourceRelease,true);
      assert.equal(result.spatialModelMaterials.stateRestored,true);
      assert.equal(result.spatialModelMaterials.decodeEvidence.length,12);
      assert.equal(result.spatialModelMaterials.shadowChecks.length,2);
      assert.deepEqual(result.spatialModelInstancing.cases.map(c=>c.count),[100,500,1000]);
      for(const c of result.spatialModelInstancing.cases){assert.equal(c.drawCalls,1);assert.equal(c.triangles,c.count*8);assert.equal(c.matrixUploadBytes,c.count*64);assert.equal(c.assetUploadBytes,0);}
      assert.equal(result.spatialGltf.models,3);
      assert.equal(result.spatialGltf.glbPixelDifference,0);
      assert.equal(result.spatialGltf.restorePixelDifference,0);
      for(const flag of ["missing","aborted","streamStarted","invalidAccessorRejected","encodedBinary","corsEncodedBinary","cacheProtected","sharedCancellation","destroyCancellation","cacheReleased","contentMismatch","oldScenePreserved","freshRestore","resourceRelease"])assert.equal(result.spatialGltf[flag],true);
      assert.equal(result.spatialGltf.cacheRequests,10);
      assert.equal(result.spatialGltf.cached.activeLeaseCount,6);
      assert.equal(result.spatialGltf.cached.entryCount,3);
      assert.equal(result.spatialGltf.first.modelUploadBytes,0);
      assert.equal(result.spatialGltf.warm.modelDrawCalls,11);
      assert.equal(result.spatialGltf.warm.modelTriangleCount,118);
      assert.equal(result.spatialGltf.upperFloor,1);
      assert.equal(result.spatialGltf.blockedX,42);
      assert.equal(result.spatialGltf.pickedSurface,"house/terrain/upper");
      assert.equal(result.spatialModelInstancing.freshRestore,true);
      assert.equal(result.spatialModelInstancing.restorePixelDifference,0);
      assert.equal(result.spatialModelInstancing.materialPixelDifference,0);
      assert.equal(result.spatialModelInstancing.shadowPassCount,7);
      assert.equal(result.spatialModelInstancing.transformedMaterialParity,true);
      assert(result.spatialModelInstancing.shadowInstancedCalls>0);
      assert(result.spatialModelInstancing.shadowMatrixUploadBytes>0);
      assert.equal(result.spatialModelInstancing.resourceRelease,true);
      assert.equal(result.spatialModelPreparation.faults.length,4);
      assert.equal(result.spatialModelPreparation.coldFailures.length,3);
      assert.equal(result.spatialModelPreparation.freshRestore,true);
      assert.equal(result.spatialModelPreparation.resourceRelease,true);
      assert.equal(result.spatialModelPreparation.firstFrame.modelUploadBytes,0);
      assert.equal(result.spatialModelPreparation.firstFrame.modelDrawCalls,10);
      assert.equal(result.spatialModelPreparation.firstFrame.modelTriangleCount,110);
      assert.equal(result.spatialModelPreparation.freshUploadBytes,0);
      assert.equal(result.spatialModelPreparation.restoreRejected,true);
      assert.equal(result.spatialModelAssembly.prototypeIdApplied,"__proto__");
      assert.equal(result.spatialModelAssembly.decimalPlacementApplied,true);
      assert.equal(result.spatialModelAssembly.decimalRejections,2);
      assert.equal(result.spatialModelAssembly.opaqueFrameAssets,true);
      assert.equal(result.spatialModelAssembly.proxyRejections,10);
      assert.equal(result.spatialModelAssembly.uncancelledParentTransform,true);
      assert.equal(result.spatialModelAssembly.flatCommitPreserved,true);
      assert.equal(result.spatialModelAssembly.unusedFlatCommitReleased,true);
      assert.equal(result.spatialModelAssembly.resourceRelease,true);
      assert.equal(result.spatialModelAssembly.cases.length,4);
      assert.equal(result.spatialModelAssembly.hierarchies.length,4);
      for (const placement of [...result.spatialModelAssembly.cases,...result.spatialModelAssembly.hierarchies]) {
        assert.equal(placement.restoreDifferences,0);
        assert.equal(placement.navigation.status,"arrived");
        assert.equal(placement.navigation.pose.floorId,1);
        assert.equal(placement.firstFrame.modelUploadBytes,0);
        assert.equal(placement.firstFrame.modelDrawCalls,8);
        assert.equal(placement.warm.modelUploadBytes,0);
        assert.equal(placement.warm.terrainTriangleCount,0);
        assert.equal(placement.warm.visibleModelCount,1);
        assert.equal(placement.picks.length,2);
      }
      for (const placement of result.spatialModelAssembly.hierarchies) {
        assert.equal(placement.warm.modelCount,3);
        assert.equal(placement.modelId,"village/children/wing/children/house");
        assert(placement.navigation.stats.probeWorkUnits <= 8_000_000);
        assert.equal(placement.warm.modelTriangleCount,96);
      }
      assert.equal(result.spatialBuilding.freshRestore,true);
      assert.equal(result.spatialBuilding.resourceRelease,true);
      assert.equal(result.spatialBuilding.restoreDifferences,0);
      assert.equal(result.spatialBuilding.savedVersion,7);
      assert.equal(result.spatialBuilding.navigation.status,"arrived");
      assert.equal(result.spatialBuilding.navigation.pose.floorId,1);
      assert.equal(result.spatialBuilding.blocked.x,42);
      assert.equal(result.spatialBuilding.under.floorId,0);
      assert.equal(result.spatialBuilding.warm.visibleTerrainChunkCount,0);
      assert.equal(result.spatialBuilding.warm.modelDrawCalls,8);
      assert.equal(result.spatialBuilding.warm.modelTriangleCount,96);
      assert.equal(result.spatialBuilding.warm.modelUploadBytes,0);
      assert.equal(result.spatialBuilding.shadowChecks.length,2);
      assert.equal(result.spatialBuilding.invalidRejected,3);
      assert.equal(result.spatialTree.freshRestore,true);
      assert.equal(result.spatialTree.resourceRelease,true);
      assert.equal(result.spatialTree.shadowChecks.length,4);
      assert.equal(result.spatialTree.aborted,true);
      assert.equal(result.spatialTree.decodeEvidence.length,7);
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
