import { smokeTileAssets } from "./tile-assets-smoke.mjs";
import { strict as assert } from "node:assert";
import { preparePlacementTestBuild } from "./placement-test-build.mjs";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright-core";
import {
  encodePngRgba,
  decodePng,
} from "../../scripts/tools/pack-textures.mjs";
import { sha256 } from "../../scripts/tools/sprite-normals-tool.mjs";
import {
  showPlacementBottom,
  showPlacementInspector,
} from "./placement-panel-navigation.mjs";
import { mergeScenePlacementPatch } from "../../packages/ferrum-web/dist/authoring.js";
import { placementNormalGeneratorPlugin } from "../../apps/placement-viewer/server/normalGenerator.mjs";
import { smokeAsepriteNormals } from "./aseprite-normals-smoke.mjs";
import { smokeAsepriteAnimation } from "./aseprite-animation-smoke.mjs";
import { smokeAsepritePaired } from "./aseprite-paired-smoke.mjs";

const tileMode = process.argv.includes("--tiles");
const pairedMode = process.argv.includes("--paired");
const normalMode = pairedMode || process.argv.includes("--normals");
const animationMode = process.argv.includes("--animations");
const artifact = resolve(
  tileMode
    ? "artifacts/tile-assets"
    : pairedMode
      ? "artifacts/aseprite-paired"
      : animationMode
        ? "artifacts/aseprite-animation"
        : normalMode
          ? "artifacts/aseprite-normals"
          : "artifacts/aseprite-assets",
);
let generatorRoute,
  generatorAvailable = true;
if (normalMode)
  placementNormalGeneratorPlugin().configurePreviewServer({
    middlewares: {
      use(prefix, handler) {
        generatorRoute = { prefix, handler };
      },
    },
  });
await mkdir(artifact, { recursive: true });
const run = await mkdtemp(resolve(artifact, "run-")),
  app = await preparePlacementTestBuild(resolve("apps/placement-viewer/dist"), { save: true });
const source = {
  format: "ferrum2d.consumer.scene-authoring",
  version: 1,
  behaviorRecipes: { entities: {} },
  sceneComposition: {
    initialFragment: "main",
    prefabs: { object: {} },
    fragments: {
      main: {
        instances: [
          {
            id: "sprite",
            prefab: "object",
            x: 0,
            y: 0,
            rotationRadians: 0.2,
            scale: 1.1,
            props: {
              components: {
                visual: {
                  kind: "sprite",
                  texture: "crate",
                  width: 64,
                  height: 64,
                  originX: 0.5,
                  originY: 1,
                },
                collider: { type: "aabb", halfWidth: 8, halfHeight: 6 },
                body: { type: "static" },
                layer: "wall",
              },
            },
          },
        ],
      },
    },
  },
};
const spatial = {
  camera: {
    projection: "orthographic",
    position: { x: 0, y: -200, elevation: 80 },
    target: { x: 0, y: 0, elevation: 32 },
    height: 110,
    near: 0.1,
    far: 1200,
  },
  terrain: [
    {
      id: "ground",
      x: -150,
      y: -150,
      width: 300,
      depth: 300,
      elevation: 0,
      render: false,
    },
  ],
  billboards: { sprite: {} },
  environment: {
    lighting: {
      ambient: [0.2, 0.2, 0.2],
      lights: [
        {
          position: { x: 65, y: -80, elevation: 70 },
          radius: 300,
          intensity: 1.5,
        },
      ],
    },
  },
};
let active,
  sceneSaves = 0,
  resume;
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  try {
    if (normalMode && path.startsWith(generatorRoute.prefix + "/")) {
      if (!generatorAvailable) {
        response.writeHead(503).end("Normal generator unavailable");
        return;
      }
      request.url = request.url.slice(generatorRoute.prefix.length);
      generatorRoute.handler(request, response);
      return;
    }
    if (path === "/placement.scene-authoring.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(active));
      return;
    }
    if (path === "/__ferrum-placement-save") {
      sceneSaves++;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ saved: true }));
      return;
    }
    if (path === "/resume.html") {
      response.setHeader("content-type", "text/html");
      response.end(
        tileMode
          ? '<!doctype html><script type="importmap">{"imports":{"@ferrum2d/ferrum-web/authoring":"/engine/dist/authoring.js","@ferrum2d/ferrum-web/starter-scenes":"/engine/dist/starter-scenes.js","@ferrum2d/ferrum-web/core":"/engine/dist/core.js"}}</script><canvas style="width:480px;height:360px"></canvas><script type="module">import {probeTileResume} from "/resume.mjs";try{window.report=await probeTileResume()}catch(error){window.failure=error.stack}</script>'
          : normalMode
            ? '<!doctype html><script type="importmap">{"imports":{"@ferrum2d/ferrum-web/authoring":"/engine/dist/authoring.js","@ferrum2d/ferrum-web/core":"/engine/dist/core.js"}}</script><script type="module">import {probeNormalResume} from "/resume.mjs";try{window.report=await probeNormalResume()}catch(error){window.failure=error.stack}</script>'
            : '<!doctype html><script type="importmap">{"imports":{"@ferrum2d/ferrum-web/authoring":"/engine/dist/authoring.js","@ferrum2d/ferrum-web/core":"/engine/dist/core.js"}}</script><canvas style="width:480px;height:360px"></canvas><script type="module">import {probeAsepriteResume} from "/resume.mjs";try{window.report=await probeAsepriteResume()}catch(error){window.failure=error.stack}</script>',
      );
      return;
    }
    if (path === "/resume.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(resume));
      return;
    }
    if (path.startsWith("/resume/")) {
      const file = resume.bundle.files.find(
        (f) => f.path === decodeURIComponent(path.slice(8)),
      );
      assert(file);
      response.setHeader("content-type", file.mediaType);
      response.end(Buffer.from(file.base64, "base64"));
      return;
    }
    let file;
    if (path === "/aseprite-paired-runtime-fixture.mjs")
      file = resolve("tests/smoke/aseprite-paired-runtime-fixture.mjs");
    else if (path === "/resume.mjs")
      file = resolve(
        tileMode
          ? "tests/smoke/tile-resume-browser-fixture.mjs"
          : normalMode
            ? "tests/smoke/sprite-normal-resume-browser-fixture.mjs"
            : "tests/smoke/aseprite-resume-browser-fixture.mjs",
      );
    else if (path.startsWith("/engine/")) {
      const base = resolve("packages/ferrum-web");
      file = resolve(base, "." + decodeURIComponent(path.slice(7)));
      assert(file.startsWith(base + sep));
    } else {
      file = resolve(
        app,
        "." + (path === "/" ? "/index.html" : decodeURIComponent(path)),
      );
      assert(file.startsWith(app + sep));
    }
    response.setHeader(
      "content-type",
      {
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".html": "text/html",
        ".json": "application/json",
        ".css": "text/css",
        ".png": "image/png",
        ".svg": "image/svg+xml",
      }[extname(file)] ?? "application/octet-stream",
    );
    response.end(await readFile(file));
  } catch (error) {
    response.writeHead(404).end(String(error));
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.FERRUM_BROWSER_EXECUTABLE,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
function fixture(version = 0) {
  const height = version ? 32 : 16,
    pixels = new Uint8Array(32 * height * 4),
    rect = version
      ? { x: 24, y: 20, w: 8, h: 12 }
      : { x: 0, y: 0, w: 16, h: 16 },
    walk = version
      ? { x: 0, y: 0, w: 16, h: 16 }
      : { x: 16, y: 0, w: 16, h: 16 };
  const color =
    version === 0
      ? [220, 30, 20, 255]
      : version === 1
        ? [20, 70, 220, 255]
        : [220, 30, 190, 255];
  for (const [r, c] of [
    [rect, color],
    [walk, [30, 200, 40, 255]],
  ])
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        if (
          !normalMode ||
          ((x - r.x - r.w / 2) / (r.w / 2 - 1)) ** 2 +
            ((y - r.y - r.h / 2) / (r.h / 2 - 1)) ** 2 <
            1
        )
          pixels.set(c, (y * 32 + x) * 4);
      }
  const entry = (r) => ({
    frame: r,
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: r.w, h: r.h },
    sourceSize: { w: r.w, h: r.h },
    duration: 100,
  });
  return {
    png: encodePngRgba(32, height, pixels),
    json: {
      frames: { "hero-idle.png": entry(rect), "hero-walk.png": entry(walk) },
      meta: {
        image: "hero.png",
        size: { w: 32, h: height },
        frameTags: [{ name: "idle", from: 0, to: 1, direction: "forward" }],
      },
    },
  };
}
const results = [];
try {
  for (const mode of ["2d", "hd2d"]) {
    active = structuredClone(source);
    if (mode === "2d") {
      active.sceneComposition.fragments.main.instances[0].x = 800;
      active.sceneComposition.fragments.main.instances[0].y = 480;
    }
    if (mode === "hd2d") active.spatial = spatial;
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        deviceScaleFactor: mode === "hd2d" ? 2 : 1,
        acceptDownloads: true,
      }),
      page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(30000);
    page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
    await page.addInitScript(() => {
      const resources = { urls: new Set(), textures: new Set() };
      const create = URL.createObjectURL.bind(URL),
        revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        const url = create(blob);
        resources.urls.add(url);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        resources.urls.delete(url);
        revoke(url);
      };
      const createTexture = WebGL2RenderingContext.prototype.createTexture,
        deleteTexture = WebGL2RenderingContext.prototype.deleteTexture;
      WebGL2RenderingContext.prototype.createTexture = function () {
        const texture = createTexture.call(this);
        if (texture) resources.textures.add(texture);
        return texture;
      };
      WebGL2RenderingContext.prototype.deleteTexture = function (texture) {
        resources.textures.delete(texture);
        deleteTexture.call(this, texture);
      };
      window.resources = resources;
    });
    const tool = page.locator("[data-placement-aseprite-tool]"),
      action = (name) => tool.locator(`[data-aseprite-action="${name}"]`),
      wait = (fn, arg) => page.waitForFunction(fn, arg),
      snapshot = () =>
        page.evaluate(() => ({
          state: (() => {
            const s = window.ferrumPlacementViewerState;
            return {
              draftPatch: s.draftPatch,
              spatial: s.spatial,
              selectedInstanceIds: s.selectedInstanceIds,
              lockedInstanceIds: s.lockedInstanceIds,
              instances: s.instances.map(({ entity, ...instance }) => instance),
            };
          })(),
          history: window.ferrumPlacementViewerHistory,
          imports:
            window.ferrumPlacementViewerAgentHandoff.asepriteImports ?? [],
        }));
    const resources = () =>
      page.evaluate(() => ({
        urls: window.resources.urls.size,
        textures: window.resources.textures.size,
      }));
    const native = async () => {
      if (mode === "2d") {
        await page.locator('[data-placement-mode="game"]').click();
        await wait(() => window.ferrumPlacementWorkspaceMode === "game");
      }
      const result = await page.evaluate(async () => {
        // Workspace controls change the canvas height. Wait for ResizeObserver,
        // the drawing buffer, and three completed frames to agree before readback.
        let previous = "",
          stable = 0;
        for (let attempt = 0; attempt < 16; attempt++) {
          await new Promise(requestAnimationFrame);
          const canvas = document.querySelector("canvas.demo-canvas"),
            rect = canvas.getBoundingClientRect(),
            size = [canvas.width, canvas.height, rect.width, rect.height].join(
              ",",
            );
          const matches =
            Math.abs(canvas.width - rect.width * devicePixelRatio) <= 1 &&
            Math.abs(canvas.height - rect.height * devicePixelRatio) <= 1;
          stable = matches && size === previous ? stable + 1 : 0;
          previous = size;
          if (stable >= 3) break;
        }
        if (stable < 3) throw Error("Native canvas resize did not settle");
        const canvas = document.querySelector("canvas.demo-canvas"),
          gl = canvas.getContext("webgl2"),
          bytes = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(
          0,
          0,
          canvas.width,
          canvas.height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          bytes,
        );
        if (gl.getError()) throw Error("Native readback failed");
        let red = 0,
          blue = 0,
          magenta = 0;
        for (let i = 0; i < bytes.length; i += 4) {
          const [r, g, b] = bytes.subarray(i, i + 3);
          if (r > g * 2 && r > b * 2) red++;
          if (b > r * 2 && b > g * 1.5) blue++;
          if (r > g * 2 && b > g * 2) magenta++;
        }
        return {
          red,
          blue,
          magenta,
          width: canvas.width,
          height: canvas.height,
          camera: [
            window.ferrumEngine.cameraX(),
            window.ferrumEngine.cameraY(),
          ],
          stats: window.ferrumFrameStats,
          image: canvas.toDataURL(),
        };
      });
      if (mode === "2d") {
        await page.locator('[data-placement-mode="2d"]').click();
        await wait(() => window.ferrumPlacementWorkspaceMode === "2d");
      }
      return result;
    };
    async function stage(data, name = "hero", pngName = "hero.png") {
      await tool.getByRole("tab", { name: "Source", exact: true }).click();
      await tool.getByLabel("Aseprite asset name", { exact: true }).fill(name);
      await tool.getByLabel("Aseprite JSON", { exact: true }).setInputFiles({
        name: "hero.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          typeof data.json === "string" ? data.json : JSON.stringify(data.json),
        ),
      });
      await tool.getByLabel("Aseprite PNG", { exact: true }).setInputFiles({
        name: pngName,
        mimeType: "image/png",
        buffer: data.png,
      });
      await action("inspect").click();
      await wait(
        () =>
          document.querySelector("[data-placement-aseprite-tool]").dataset
            .asepriteBusy === "false",
      );
    }
    const applied = () =>
      wait(() =>
        document
          .querySelector("[data-aseprite-status]")
          .textContent.startsWith("Applied"),
      );
    async function undo() {
      await page
        .locator('[data-placement-action="undo"]:visible')
        .first()
        .click();
    }
    async function redo() {
      await page
        .locator('[data-placement-action="redo"]:visible')
        .first()
        .click();
    }
    try {
      await page.goto(origin);
      await wait(
        () => window.ferrumPlacementViewerState && window.ferrumEngine,
      );
      assert.equal(
        await page.evaluate(() => window.ferrumPlacementViewerSaveEnabled),
        true,
        "Use the save-enabled app build",
      );
      if (tileMode) {
        const result = await smokeTileAssets({
          page,
          mode,
          active,
          wait,
          snapshot,
          native,
          undo,
          redo,
          resources,
          run,
          origin,
          getSaves: () => sceneSaves,
          setResume: (value) => {
            resume = value;
          },
        });
        await page.evaluate(() =>
          window.dispatchEvent(
            new PageTransitionEvent("pagehide", { persisted: false }),
          ),
        );
        const released = await resources();
        assert.deepEqual(released, { urls: 0, textures: 0 });
        assert.deepEqual(errors, []);
        results.push({ mode, ...result, released });
        continue;
      }
      await showPlacementBottom(page, "assets");
      await tool.locator("summary").click();
      const original = await snapshot(),
        first = fixture();
      await stage(first);
      assert.equal(await tool.getAttribute("data-aseprite-ready"), "true");
      assert.deepEqual(
        (await snapshot()).state.draftPatch,
        original.state.draftPatch,
      );
      await tool
        .getByLabel("Aseprite frame", { exact: true })
        .selectOption("hero-walk.png");
      await wait(() => {
        const c = document
          .querySelector(".placement-aseprite-preview")
          .getContext("2d")
          .getImageData(80, 80, 1, 1).data;
        return c[1] > c[0] * 2;
      });
      await tool
        .getByLabel("Aseprite frame", { exact: true })
        .selectOption("hero-idle.png");
      await action("register").click();
      await wait(() =>
        document
          .querySelector("[data-aseprite-status]")
          .textContent.startsWith("Registered"),
      );
      assert.deepEqual(
        (await snapshot()).state.draftPatch,
        original.state.draftPatch,
      );
      assert.equal(
        await page
          .locator("[data-placement-browser-asset]")
          .filter({ hasText: "hero-idle.png" })
          .count(),
        1,
      );
      const beforePlacement = await snapshot();
      await page
        .locator("[data-placement-browser-asset]")
        .filter({ hasText: "hero-idle.png" })
        .click();
      if (mode === "hd2d") {
        await showPlacementInspector(page, "placement");
        await page.locator("[data-placement-spatial-place]").click();
      }
      const placementPoint = await page.evaluate((mode) => {
        if (mode === "hd2d")
          return window.ferrumPlacementSpatialProject({
            x: -35,
            y: -20,
            elevation: 0,
          });
        const rect = document
          .querySelector("canvas.demo-canvas")
          .getBoundingClientRect();
        return { x: rect.x + rect.width * 0.3, y: rect.y + rect.height * 0.5 };
      }, mode);
      await page.mouse.click(placementPoint.x, placementPoint.y);
      await wait(
        () => window.ferrumPlacementViewerState.instances.length === 2,
      );
      // The pointerup transaction commits on the next RAF, after object creation.
      await wait(
        (expected) =>
          window.ferrumPlacementViewerHistory.transactionLabel === undefined &&
          window.ferrumPlacementViewerHistory.undoCount === expected,
        beforePlacement.history.undoCount + 1,
      );
      const placed = await snapshot(),
        placedDocument = mergeScenePlacementPatch(
          active,
          placed.state.draftPatch,
        ).document,
        added = placedDocument.sceneComposition.fragments.main.instances.find(
          (i) => i.id !== "sprite",
        );
      assert.match(
        added.props.components.visual.asset ??
          added.props.components.visual.texture,
        /^aseprite\.hero\./,
      );
      assert.deepEqual(added.props.components.visual.frame, {
        u0: 0,
        v0: 0,
        u1: 0.5,
        v1: 1,
      });
      assert.equal(
        placed.history.undoCount,
        beforePlacement.history.undoCount + 1,
      );
      await undo();
      await wait(
        () => window.ferrumPlacementViewerState.instances.length === 1,
      );
      assert.deepEqual(
        (await snapshot()).state.draftPatch,
        beforePlacement.state.draftPatch,
      );
      await showPlacementBottom(page, "assets");
      await action("apply").click();
      await applied();
      const a = await snapshot(),
        aId = a.imports[0].assetId;
      if (animationMode) {
        const animation = await smokeAsepriteAnimation({
          page,
          active,
          fixture,
          stage,
          tool,
          action,
          snapshot,
          undo,
          redo,
          wait,
          run,
          origin,
          setResume: (value) => {
            resume = value;
          },
        });
        await page.evaluate(() =>
          window.dispatchEvent(
            new PageTransitionEvent("pagehide", { persisted: false }),
          ),
        );
        const released = await resources();
        assert.deepEqual(released, { urls: 0, textures: 0 });
        assert.deepEqual(errors, []);
        results.push({ mode, ...animation, released });
        continue;
      }
      if (normalMode) {
        const normalResult =
          mode === "hd2d"
            ? await (pairedMode ? smokeAsepritePaired : smokeAsepriteNormals)({
                page,
                active,
                fixture,
                stage,
                tool,
                action,
                snapshot,
                native,
                undo,
                redo,
                wait,
                run,
                resources,
                origin,
                setGeneratorAvailable: (value) => {
                  generatorAvailable = value;
                },
                setResume: (value) => {
                  resume = value;
                },
              })
            : {
                twoDimensionalActionsDisabled:
                  (await action(
                    pairedMode ? "paired" : "normals",
                  ).isDisabled()) &&
                  (await action(
                    pairedMode ? "reimport-paired" : "reimport-normals",
                  ).isDisabled()),
              };
        if (mode === "2d")
          assert.equal(normalResult.twoDimensionalActionsDisabled, true);
        await page.evaluate(() =>
          window.dispatchEvent(
            new PageTransitionEvent("pagehide", { persisted: false }),
          ),
        );
        const released = await resources();
        assert.deepEqual(released, { urls: 0, textures: 0 });
        assert.deepEqual(errors, []);
        results.push({ mode, ...normalResult, released });
        continue;
      }
      assert.equal(a.history.undoCount, original.history.undoCount + 1);
      assert.equal(a.imports.length, 1);
      const firstNative = await native();
      await writeFile(
        resolve(run, mode + "-first-native.png"),
        Buffer.from(firstNative.image.split(",")[1], "base64"),
      );
      assert(
        firstNative.red > 100,
        JSON.stringify({ ...firstNative, image: undefined }),
      );
      const components = mergeScenePlacementPatch(active, a.state.draftPatch)
        .document.sceneComposition.fragments.main.instances[0].props.components;
      assert.equal(components.visual.width, 64);
      assert.deepEqual(
        components.collider,
        active.sceneComposition.fragments.main.instances[0].props.components
          .collider,
      );
      await stage(fixture(1));
      assert.match(
        await tool.locator("[data-aseprite-diff]").textContent(),
        /Changed 2/,
      );
      await action("reimport").click();
      await applied();
      const b = await snapshot(),
        bId = b.imports[0].assetId;
      assert.notEqual(aId, bId);
      assert.equal(b.history.undoCount, a.history.undoCount + 1);
      if (mode === "2d") {
        const marker = decodePng(
          await page.locator(".placement-draft-marker").first().screenshot(),
        );
        let blue = 0;
        for (let i = 0; i < marker.pixels.length; i += 4)
          if (
            marker.pixels[i + 2] > marker.pixels[i] * 2 &&
            marker.pixels[i + 2] > marker.pixels[i + 1] * 1.5
          )
            blue++;
        assert(
          blue > 100,
          "2D authoring marker did not crop to the imported frame",
        );
      }
      assert((await native()).blue > 100);
      const bDocument = mergeScenePlacementPatch(
          active,
          b.state.draftPatch,
        ).document,
        bInstance = bDocument.sceneComposition.fragments.main.instances[0];
      assert.deepEqual(bInstance.props.components.visual.frame, {
        u0: 0.75,
        v0: 0.625,
        u1: 1,
        v1: 1,
      });
      for (const field of ["x", "y", "rotationRadians", "scale"])
        assert.equal(
          bInstance[field],
          active.sceneComposition.fragments.main.instances[0][field],
        );
      assert.deepEqual(
        bInstance.props.components.collider,
        components.collider,
      );
      assert.deepEqual(bInstance.props.components.body, components.body);
      assert.equal(bInstance.props.components.visual.width, 64);
      await undo();
      await wait(
        (id) =>
          window.ferrumPlacementViewerAgentHandoff.asepriteImports?.[0]
            ?.assetId === id,
        aId,
      );
      assert((await native()).red > 100);
      await redo();
      await wait(
        (id) =>
          window.ferrumPlacementViewerAgentHandoff.asepriteImports?.[0]
            ?.assetId === id,
        bId,
      );
      assert((await native()).blue > 100);
      const stable = await snapshot(),
        image = (await native()).image,
        missing = fixture(1);
      delete missing.json.frames["hero-idle.png"];
      await stage(missing);
      assert(await action("reimport").isDisabled());
      assert.match(
        await tool.locator("[data-aseprite-diagnostics]").textContent(),
        /Missing frame hero-idle/,
      );
      assert.deepEqual(await snapshot(), stable);
      assert.equal((await native()).image, image);
      const bad = [];
      const rotated = fixture();
      rotated.json.frames["hero-idle.png"].rotated = true;
      bad.push([rotated, /Rotated or trimmed/]);
      const trimmed = fixture();
      trimmed.json.frames["hero-idle.png"].spriteSourceSize.x = 1;
      bad.push([trimmed, /Trimmed/]);
      const bounds = fixture();
      bounds.json.frames["hero-idle.png"].frame.w = 100;
      bad.push([bounds, /bounded integers/]);
      const dimensions = fixture();
      dimensions.json.meta.size.w = 31;
      bad.push([dimensions, /dimensions differ/]);
      bad.push([{ png: first.png, json: "invalid" }, /Inspect failed/]);
      const duplicate = fixture();
      duplicate.json.frames = Array(2).fill({
        ...duplicate.json.frames["hero-idle.png"],
        filename: "same",
      });
      bad.push([duplicate, /duplicate imported frame/]);
      for (const [data, pattern] of bad) {
        await stage(data);
        assert.match(
          await tool.locator("[data-aseprite-status]").textContent(),
          pattern,
        );
        assert(await action("apply").isDisabled());
        assert.deepEqual(await snapshot(), stable);
      }
      await stage(first, "hero", "wrong.png");
      assert.match(
        await tool.locator("[data-aseprite-status]").textContent(),
        /filename differs/,
      );
      await stage({ png: first.png, json: " ".repeat(1_048_577) });
      assert.match(
        await tool.locator("[data-aseprite-status]").textContent(),
        /byte limit/,
      );
      // A failed load after a real GPU upload must release that provisional texture.
      await stage(fixture(2));
      const beforeFailure = await snapshot(),
        beforeResources = await resources();
      await page.evaluate(() => {
        const engine = window.ferrumEngine,
          load = engine.loadAssets.bind(engine);
        engine.loadAssets = async (manifest) => {
          await load(manifest);
          throw Error("Injected atlas upload failure");
        };
        window.restoreUpload = () => {
          engine.loadAssets = load;
        };
      });
      await action("reimport").click();
      await wait(() =>
        document
          .querySelector("[data-aseprite-status]")
          .textContent.includes("Injected atlas upload failure"),
      );
      assert.deepEqual(await snapshot(), beforeFailure);
      assert.deepEqual(await resources(), beforeResources);
      assert.equal((await native()).image, image);
      await page.evaluate(() => window.restoreUpload());
      await action("reimport").click();
      await applied();
      assert((await native()).magenta > 100);
      // Repeat a cancelled upload while the first promise is still pending.
      const changed = fixture(3);
      changed.json.meta.revision = 3;
      await stage(changed);
      await page.evaluate(() => {
        const engine = window.ferrumEngine,
          load = engine.loadAssets.bind(engine);
        engine.loadAssets = async (manifest) => {
          await new Promise((resolve) => {
            window.finishUpload = resolve;
          });
          return load(manifest);
        };
        window.restoreUpload = () => {
          engine.loadAssets = load;
        };
      });
      const beforeCancel = await snapshot();
      await action("reimport").click();
      await wait(() => !!window.finishUpload);
      await action("cancel").focus();
      await page.keyboard.press("Enter");
      assert.deepEqual(await snapshot(), beforeCancel);
      await page.evaluate(() => window.restoreUpload());
      await action("reimport").click();
      await page.evaluate(() => window.finishUpload());
      await applied();
      assert.equal(
        (await snapshot()).history.undoCount,
        beforeCancel.history.undoCount + 1,
      );
      const heroRevision = (await snapshot()).imports[0].assetId;
      const ambiguous = fixture();
      ambiguous.json.frames["hero-alias.png"] = structuredClone(
        ambiguous.json.frames["hero-idle.png"],
      );
      await stage(ambiguous, "ambiguous");
      await action("apply").click();
      await applied();
      const beforeAmbiguous = await snapshot();
      await stage(fixture(1), "ambiguous");
      assert(await action("reimport").isDisabled());
      assert.match(
        await tool.locator("[data-aseprite-diagnostics]").textContent(),
        /Ambiguous/,
      );
      assert.deepEqual(await snapshot(), beforeAmbiguous);
      await undo();
      await wait(
        (id) =>
          window.ferrumPlacementViewerAgentHandoff.asepriteImports?.[0]
            ?.assetId === id,
        heroRevision,
      );
      await stage(changed, "hero");
      // Unsupported animation/normal migrations must be diagnosed before upload.
      for (const kind of mode === "hd2d"
        ? ["animation", "normal"]
        : ["animation"]) {
        const guarded = structuredClone(source);
        if (kind === "animation")
          guarded.sceneComposition.fragments.main.instances[0].props.components.visual.animation =
            { frameCount: 2, fps: 5 };
        else {
          guarded.spatial = structuredClone(spatial);
          const normal = encodePngRgba(
            1,
            1,
            new Uint8Array([128, 128, 255, 255]),
          );
          guarded.spatial.billboards.sprite.normalTextureId =
            await page.evaluate(async (base64) => {
              window.guardNormalUrl = "data:image/png;base64," + base64;
              await window.ferrumEngine.loadAssets({
                textures: { "guard-normal": window.guardNormalUrl },
                textureOptions: { "guard-normal": { colorSpace: "none" } },
              });
              return window.ferrumEngine.textureId("guard-normal");
            }, normal.toString("base64"));
        }
        await page.locator("[data-placement-document-file]").setInputFiles({
          name: kind + "-guard.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(guarded)),
        });
        await wait(
          () =>
            document.querySelectorAll('[data-placement-document-key^="file:"]')
              .length === 1,
        );
        assert.equal(
          await page
            .locator("[data-placement-browser-asset]")
            .filter({ hasText: "hero-idle.png" })
            .count(),
          0,
          "A different document exposed session atlas frames",
        );
        await showPlacementBottom(page, "assets");
        await stage(first);
        assert(await action("apply").isDisabled());
        assert.match(
          await tool.locator("[data-aseprite-diagnostics]").textContent(),
          kind === "animation"
            ? /animation migration/
            : /Detach the normal binding/,
        );
        await page.locator('[data-placement-close-document^="file:"]').click();
        await wait(
          (id) =>
            window.ferrumPlacementViewerAgentHandoff.asepriteImports?.[0]
              ?.assetId === id,
          heroRevision,
        );
        if (kind === "normal")
          await page.evaluate(() => {
            const textures = [
              {
                kind: "texture",
                name: "guard-normal",
                url: window.guardNormalUrl,
              },
            ];
            window.ferrumEngine.releaseAssets({
              entries: textures,
              textures,
              sounds: [],
              json: [],
              total: 1,
            });
          });
      }
      const sceneSaveBefore = sceneSaves;
      await page.evaluate(() => window.ferrumPlacementViewerSaveDraft());
      assert.equal(sceneSaves, sceneSaveBefore);
      assert.match(
        await page.evaluate(() => window.ferrumPlacementViewerLastSaveError),
        /imported atlases/,
      );
      const downloadPromise = page.waitForEvent("download");
      await action("export").click();
      const download = await downloadPromise;
      await download.saveAs(resolve(run, mode + "-assets.json"));
      const bundle = JSON.parse(
        await readFile(resolve(run, mode + "-assets.json")),
      );
      assert.equal(bundle.format, "ferrum2d.aseprite.assets");
      assert.equal(bundle.overwrite, false);
      assert(bundle.revisions.length >= 4);
      for (const file of bundle.files)
        assert.equal(sha256(Buffer.from(file.base64, "base64")), file.sha256);
      for (const rev of bundle.revisions) {
        assert.equal(
          bundle.manifest.textureOptions[rev.assetId].colorSpace,
          "srgb",
        );
        assert.equal(
          sha256(
            Buffer.from(
              bundle.files.find((f) => f.path === rev.assetId + ".json").base64,
              "base64",
            ),
          ),
          rev.jsonSha256,
        );
      }
      await page.evaluate(() => window.ferrumPlacementViewerSaveDraft());
      assert.equal(
        sceneSaves,
        sceneSaveBefore,
        "Export must not count as persistence",
      );
      const final = await snapshot();
      resume = {
        bundle,
        document: mergeScenePlacementPatch(active, final.state.draftPatch)
          .document,
        fragment: "main",
        instance: "sprite",
      };
      await writeFile(
        resolve(run, mode + "-agent-resume.json"),
        JSON.stringify(resume, null, 2) + "\n",
      );
      const restored = await context.newPage();
      restored.on("pageerror", (e) => errors.push(String(e)));
      await restored.goto(origin + "/resume.html");
      await restored.waitForFunction(() => window.report || window.failure);
      const fresh = await restored.evaluate(() => ({
        report: window.report,
        error: window.failure,
      }));
      assert.equal(fresh.error, undefined);
      assert(fresh.report.coloredPixels > 100);
      await restored.close();
      await page.setViewportSize({ width: 640, height: 840 });
      await wait(
        () => document.querySelector(".demo-shell").dataset.compact === "true",
      );
      await showPlacementBottom(page, "assets");
      await tool.getByRole("tab", { name: "Source", exact: true }).focus();
      await page.keyboard.press("End");
      assert.equal(
        await tool
          .getByRole("tab", { name: "Preview", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
      await page.keyboard.press("Home");
      assert.equal(
        await tool
          .getByRole("tab", { name: "Source", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
      assert(await tool.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
      await page.screenshot({
        path: resolve(run, mode + "-compact.png"),
        fullPage: true,
      });
      // Budget is measured using revisions retained by the real scene history.
      const attempts = [];
      for (let i = 0; i < 10; i++) {
        const data = fixture(2);
        data.json.meta.revision = "budget" + i;
        await stage(data);
        const text = await tool.locator("[data-aseprite-status]").textContent();
        attempts.push(text);
        if (text.includes("budget reached")) break;
        await action("reimport").click();
        await applied();
      }
      assert(attempts.at(-1).includes("budget reached"));
      assert(attempts.length > 1 && attempts.length < 10);
      const other = structuredClone(source);
      other.sceneComposition.fragments.main.instances[0].id = "other";
      await page.locator("[data-placement-document-file]").setInputFiles({
        name: "other.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(other)),
      });
      await wait(
        () => window.ferrumPlacementViewerState.selectedInstanceId === "other",
      );
      assert.match(
        await tool.locator("[data-aseprite-source]").textContent(),
        /Choose JSON/,
      );
      const beforeClose = await resources();
      page.once("dialog", (d) => d.accept());
      await page.locator('[data-placement-close-document="sample"]').click();
      const afterClose = await resources();
      assert(afterClose.urls < beforeClose.urls);
      await showPlacementBottom(page, "assets");
      if ((await tool.getAttribute("open")) === null)
        await tool.locator("summary").click();
      await stage(first);
      assert.equal(await tool.getAttribute("data-aseprite-ready"), "true");
      await action("register").click();
      await wait(() =>
        document
          .querySelector("[data-aseprite-status]")
          .textContent.startsWith("Registered"),
      );
      await page.evaluate(() =>
        window.dispatchEvent(
          new PageTransitionEvent("pagehide", { persisted: true }),
        ),
      );
      await page.evaluate(() =>
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true }),
        ),
      );
      assert.equal(await tool.getAttribute("data-aseprite-busy"), "false");
      await page.evaluate(() =>
        window.dispatchEvent(
          new PageTransitionEvent("pagehide", { persisted: false }),
        ),
      );
      const released = await resources();
      assert.deepEqual(released, { urls: 0, textures: 0 });
      assert.deepEqual(errors, []);
      results.push({
        mode,
        dpr: mode === "hd2d" ? 2 : 1,
        inspectDoesNotEdit: true,
        registerDoesNotEdit: true,
        providerFrames: true,
        importedFramePlacement: true,
        previewPixels: true,
        applyOneUndo: true,
        reimportFrameIdentity: true,
        preservedPoseSizeColliderBody: true,
        undoRedoProvenance: true,
        missingFramePreservesScene: true,
        ambiguousFrameRejected: true,
        animationMigrationRejected: true,
        ...(mode === "hd2d" ? { normalMigrationRejected: true } : {}),
        invalidInputs: bad.length + 2,
        partialUploadRollback: true,
        cancelRetry: true,
        saveGuard: true,
        exportHashes: true,
        freshSession: fresh.report,
        keyboardCompact: true,
        budget: {
          entries: 8,
          attempts: attempts.length,
          recoveredAfterClose: true,
        },
        released,
      });
    } catch (error) {
      await page
        .screenshot({
          path: resolve(run, mode + "-failure.png"),
          fullPage: true,
        })
        .catch(() => {});
      console.error(
        mode,
        await tool
          .locator("[data-aseprite-status]")
          .textContent()
          .catch(() => "unavailable"),
        errors,
      );
      throw error;
    } finally {
      await context.close();
    }
  }
  const report = { ok: true, run, browser: browser.version(), results };
  await writeFile(
    resolve(artifact, "verification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
