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
import { placementNormalGeneratorPlugin } from "../../apps/placement-viewer/server/normalGenerator.mjs";
import { showPlacementBottom } from "./placement-panel-navigation.mjs";
import { animatedGif, animatedApng } from "./sprite-normal-media-fixtures.mjs";
import { mergeScenePlacementPatch } from "../../packages/ferrum-web/dist/authoring.js";

const integration = process.argv.includes("--integration");
const artifact = resolve(
  `artifacts/sprite-normal-authoring/${integration ? "phase-6" : "phase-5"}`,
);
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
                collider: "none",
                layer: "wall",
              },
            },
          },
        ],
      },
    },
  },
  spatial: {
    camera: {
      projection: "orthographic",
      position: { x: 0, y: -200, elevation: 80 },
      target: { x: 0, y: 0, elevation: 32 },
      height: 110,
      near: 0.1,
      far: 1200,
    },
    terrain: [],
    billboards: { sprite: {} },
    environment: {
      lighting: {
        ambient: [0.05, 0.05, 0.05],
        lights: [
          {
            position: { x: 65, y: -80, elevation: 70 },
            radius: 300,
            intensity: 2,
          },
        ],
      },
    },
  },
};
let generatorRoute;
placementNormalGeneratorPlugin().configurePreviewServer({
  middlewares: {
    use(prefix, handler) {
      generatorRoute = { prefix, handler };
    },
  },
});
const saved = new Map(),
  requests = new Map();
let sceneSaves = 0,
  resumeData;
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  requests.set(path, (requests.get(path) ?? 0) + 1);
  try {
    if (path === "/resume.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(resumeData));
      return;
    }
    if (path === "/resume.html") {
      response.setHeader("content-type", "text/html");
      response.end(
        '<!doctype html><script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/engine/dist/core.js","@ferrum2d/ferrum-web/authoring":"/engine/dist/authoring.js"}}</script><script type="module">import {probeNormalResume} from "/resume.mjs";try {window.resumeReport=await probeNormalResume()} catch(error){window.resumeError=error.stack}</script>',
      );
      return;
    }
    if (
      path === "/resume.mjs" ||
      path.startsWith("/engine/") ||
      path.startsWith("/resume/")
    ) {
      let file;
      if (path === "/resume.mjs")
        file = resolve("tests/smoke/sprite-normal-resume-browser-fixture.mjs");
      else if (path.startsWith("/resume/")) {
        const entry = resumeData.bundle.files.find(
          (f) => f.path === decodeURIComponent(path.slice(8)),
        );
        if (!entry) throw new Error("Unknown resumed asset");
        response.setHeader("content-type", "image/png");
        response.end(Buffer.from(entry.base64, "base64"));
        return;
      } else {
        const base = resolve("packages/ferrum-web");
        file = resolve(base, "." + decodeURIComponent(path.slice(7)));
        if (!file.startsWith(base + sep))
          throw new Error("Path outside engine");
      }
      response.setHeader(
        "content-type",
        extname(file) === ".wasm" ? "application/wasm" : "text/javascript",
      );
      response.end(await readFile(file));
      return;
    }
    if (path.startsWith(generatorRoute.prefix + "/")) {
      request.url = request.url.slice(generatorRoute.prefix.length);
      generatorRoute.handler(request, response);
      return;
    }
    if (path === "/placement.scene-authoring.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(source));
      return;
    }
    if (path === "/__ferrum-placement-save") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const value = JSON.parse(body);
      sceneSaves++;
      await writeFile(
        resolve(run, "saved.scene.json"),
        JSON.stringify(value.document, null, 2),
      );
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ saved: true, document: value.document }));
      return;
    }
    if (path === "/save-assets") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const bundle = JSON.parse(body);
      assert.equal(bundle.overwrite, false);
      if (request.headers["x-test-mode"] === "conflict") {
        response.statusCode = 409;
        response.end("Asset file conflict. Existing files preserved.");
        return;
      }
      const textures = {};
      for (const [id, file] of Object.entries(bundle.manifest.textures)) {
        const entry = bundle.files.find((f) => f.path === file);
        const bytes = Buffer.from(entry.base64, "base64");
        assert.equal(sha256(bytes), entry.sha256);
        textures[id] = "/saved/" + encodeURIComponent(file);
        if (request.headers["x-test-mode"] === "corrupt")
          textures[id] = "/corrupt.png";
        else {
          assert(!saved.has(textures[id]));
          saved.set(textures[id], bytes);
          await writeFile(resolve(run, file), bytes);
        }
      }
      if (request.headers["x-test-mode"] !== "corrupt")
        await writeFile(
          resolve(run, "saved-assets.json"),
          JSON.stringify(bundle, null, 2),
        );
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ registered: true, textures }));
      return;
    }
    if (saved.has(path)) {
      response.setHeader("content-type", "image/png");
      response.end(saved.get(path));
      return;
    }
    if (path === "/corrupt.png") {
      response.setHeader("content-type", "image/png");
      response.end(encodePngRgba(1, 1, new Uint8Array([0, 0, 0, 255])));
      return;
    }
    const file = resolve(
      app,
      "." + (path === "/" ? "/index.html" : decodeURIComponent(path)),
    );
    if (!file.startsWith(app + sep)) throw new Error("Path outside app");
    response.setHeader(
      "content-type",
      {
        ".js": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".wasm": "application/wasm",
        ".json": "application/json",
      }[extname(file)] ?? "application/octet-stream",
    );
    response.end(await readFile(file));
  } catch (error) {
    response.statusCode = 404;
    response.end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
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
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: integration ? 2 : 1,
  acceptDownloads: true,
});
const page = await context.newPage(),
  errors = [];
await page.addInitScript(() => {
  const resources = {
    workers: new Set(),
    urls: new Set(),
    textures: new Set(),
  };
  const NativeWorker = globalThis.Worker;
  globalThis.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      resources.workers.add(this);
    }
    terminate() {
      resources.workers.delete(this);
      super.terminate();
    }
  };
  const createUrl = URL.createObjectURL.bind(URL),
    revokeUrl = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    const url = createUrl(blob);
    resources.urls.add(url);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    resources.urls.delete(url);
    revokeUrl(url);
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
  globalThis.__normalUiResources = resources;
});
page.on("pageerror", (error) => errors.push(String(error)));
const wait = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 30000 });
function sprite(size = 64) {
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(
        (x - size / 2) / (size / 2),
        (y - size / 2) / (size / 2),
      );
      bytes.set(
        [170, 170, 170, d < 0.93 ? 255 : d < 1 ? 128 : 0],
        (y * size + x) * 4,
      );
    }
  return encodePngRgba(size, size, bytes);
}
const tool = page.locator("[data-placement-normal-tool]"),
  action = (name) => tool.locator(`[data-normal-action="${name}"]`);
async function upload(name, buffer) {
  await tool.getByRole("tab", { name: "Settings", exact: true }).click();
  await tool
    .getByLabel("Normal source image")
    .setInputFiles({ name, mimeType: "image/png", buffer });
  await wait(
    () =>
      document
        .querySelector("[data-normal-source]")
        ?.textContent.includes("KiB") &&
      document.querySelector("[data-placement-normal-tool]").dataset
        .normalBusy === "false",
  );
}
async function generate() {
  await action("generate").click();
  await wait(
    () =>
      document.querySelector("[data-placement-normal-tool]").dataset
        .normalReady === "true" &&
      document.querySelectorAll(".placement-normal-preview-grid canvas")
        .length === 3,
  );
}
async function snapshot() {
  return await page.evaluate(() => ({
    state: globalThis.ferrumPlacementViewerState,
    history: globalThis.ferrumPlacementViewerHistory,
    bindings:
      globalThis.ferrumPlacementViewerAgentHandoff?.normalBindings ?? [],
  }));
}
try {
  await page.goto(origin);
  await wait(
    () =>
      globalThis.ferrumEngine &&
      globalThis.ferrumPlacementViewerState &&
      globalThis.ferrumPlacementWorkspaceMode === "spatial",
  );
  assert.equal(
    await page.evaluate(() => globalThis.ferrumPlacementViewerSaveEnabled),
    true,
    "Run the smoke with the save-enabled UI build",
  );
  await showPlacementBottom(page, "assets");
  await tool.locator("summary").click();
  await page
    .getByRole("button", { name: "Generate Normal Crate", exact: true })
    .click();
  await wait(() =>
    document
      .querySelector("[data-normal-source]")
      ?.textContent.includes("crate.png"),
  );
  const original = await snapshot();
  await action("expand").click();
  if (integration) {
    const settings = tool.getByRole("tab", { name: "Settings", exact: true }),
      preview = tool.getByRole("tab", { name: "Preview", exact: true });
    await settings.focus();
    for (const [key, target] of [
      ["ArrowRight", preview],
      ["Home", settings],
      ["End", preview],
      ["ArrowRight", settings],
    ]) {
      await page.keyboard.press(key);
      assert.equal(await target.getAttribute("aria-selected"), "true");
      assert(await target.evaluate((el) => el === document.activeElement));
    }
  }
  await upload("sphere.png", sprite());
  await tool.getByLabel("Normal preset").selectOption("Soft");
  await generate();
  assert.deepEqual(
    (await snapshot()).state.draftPatch,
    original.state.draftPatch,
    "Generation edited the scene",
  );
  const pixels = await page.evaluate(() => {
    const canvas = document.querySelector(
        ".placement-normal-preview-grid figure:last-child canvas",
      ),
      gl = canvas.getContext("webgl2"),
      p = new Uint8Array(384 * 192 * 4);
    gl.readPixels(0, 0, 384, 192, gl.RGBA, gl.UNSIGNED_BYTE, p);
    return Array.from(p);
  });
  let lightingDifference = 0;
  for (let y = 0; y < 192; y++)
    for (let x = 0; x < 192; x++) {
      const a = (y * 384 + x) * 4,
        b = (y * 384 + x + 192) * 4;
      if (pixels[a + 3] && pixels[b + 3] && Math.abs(pixels[a] - pixels[b]) > 3)
        lightingDifference++;
    }
  assert(lightingDifference > 100);
  await tool.getByLabel("Preview lighting").selectOption("Moving Light");
  const lightBefore = await tool.locator("canvas").last().screenshot();
  await page.waitForTimeout(160);
  assert.notDeepEqual(
    await tool.locator("canvas").last().screenshot(),
    lightBefore,
  );
  await tool.getByLabel("Preview lighting").selectOption("Fixed Light");
  await page.evaluate(() => {
    const engine = globalThis.ferrumEngine,
      load = engine.loadAssets.bind(engine);
    engine.loadAssets = async (...args) => {
      await new Promise(
        (resolve) => (globalThis.__finishNormalUpload = resolve),
      );
      return load(...args);
    };
    globalThis.__restoreNormalUpload = () => {
      engine.loadAssets = load;
    };
  });
  await action("apply").click();
  await wait(() => !!globalThis.__finishNormalUpload);
  await page.evaluate(() => {
    globalThis.ferrumPlacementViewerSelect();
    globalThis.__finishNormalUpload();
    globalThis.__restoreNormalUpload();
  });
  await wait(() =>
    document
      .querySelector("[data-normal-status]")
      .textContent.includes("Apply failed"),
  );
  assert.deepEqual(
    (await snapshot()).state.draftPatch,
    original.state.draftPatch,
  );
  await page.evaluate(() => globalThis.ferrumPlacementViewerSelect("sprite"));
  await action("apply").click();
  await wait(() =>
    document
      .querySelector("[data-normal-status]")
      .textContent.includes("Applied"),
  );
  const applied = await snapshot();
  assert.equal(applied.history.undoCount, original.history.undoCount + 1);
  assert.equal(applied.bindings.length, 1);
  assert(applied.state.spatial.billboards.sprite.normalTexture);
  if (integration) {
    // A real partial upload fails after the first texture is in the registry.
    // The new immutable pair must roll back without touching the active pair or history.
    await tool.getByRole("tab", { name: "Settings", exact: true }).click();
    await tool.getByLabel("Normal preset").selectOption("Crisp");
    await generate();
    await page.evaluate(() => {
      const engine = globalThis.ferrumEngine,
        load = engine.loadAssets.bind(engine);
      engine.loadAssets = async (manifest) => {
        const color = Object.keys(manifest.textures)[0];
        await load({
          ...manifest,
          textures: { [color]: manifest.textures[color] },
          textureOptions: { [color]: manifest.textureOptions[color] },
        });
        throw new Error("Injected normal upload failure");
      };
      globalThis.__restoreNormalUpload = () => {
        engine.loadAssets = load;
      };
    });
    const before = await snapshot(),
      frameBefore = await page.locator("canvas.demo-canvas").screenshot(),
      resourcesBefore = await page.evaluate(() => ({
        textures: globalThis.__normalUiResources.textures.size,
        urls: globalThis.__normalUiResources.urls.size,
      }));
    await action("apply").click();
    await wait(() =>
      document
        .querySelector("[data-normal-status]")
        .textContent.includes("Injected normal upload failure"),
    );
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(
      await page.locator("canvas.demo-canvas").screenshot(),
      frameBefore,
      "Failed replacement changed the live scene pixels",
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        textures: globalThis.__normalUiResources.textures.size,
        urls: globalThis.__normalUiResources.urls.size,
      })),
      resourcesBefore,
      "Partial upload leaked a texture or URL",
    );
    await page.evaluate(() => globalThis.__restoreNormalUpload());
    await action("apply").click();
    await wait(() =>
      document
        .querySelector("[data-normal-status]")
        .textContent.includes("Applied"),
    );
    assert.equal(
      (await snapshot()).history.undoCount,
      before.history.undoCount + 1,
    );
    assert.equal(
      (await snapshot()).bindings.length,
      1,
      "Replacement exported stale binding evidence",
    );
    // Restore the earlier generation so the existing one-Undo assertion remains meaningful.
    await page
      .locator('[data-placement-action="undo"]:visible')
      .first()
      .click();
    await wait(
      (previous) =>
        JSON.stringify(globalThis.ferrumPlacementViewerState.draftPatch) ===
        previous,
      JSON.stringify(applied.state.draftPatch),
    );
    assert.deepEqual(
      (await snapshot()).bindings,
      applied.bindings,
      "Undo lost the previous generation provenance",
    );
    await page
      .locator('[data-placement-action="redo"]:visible')
      .first()
      .click();
    await wait(() => globalThis.ferrumPlacementViewerHistory.redoCount === 0);
    assert.equal(
      (await snapshot()).bindings.length,
      1,
      "Redo duplicated or lost generation provenance",
    );
    assert.notDeepEqual((await snapshot()).bindings, applied.bindings);
    await page
      .locator('[data-placement-action="undo"]:visible')
      .first()
      .click();
    await wait(
      (previous) =>
        JSON.stringify(globalThis.ferrumPlacementViewerState.draftPatch) ===
        previous,
      JSON.stringify(applied.state.draftPatch),
    );
    await tool.getByRole("tab", { name: "Settings", exact: true }).click();
    await tool.getByLabel("Normal preset").selectOption("Soft");
    await generate();
  }
  await page.locator('[data-placement-action="undo"]:visible').first().click();
  await wait(
    () =>
      !globalThis.ferrumPlacementViewerState.spatial.billboards.sprite
        .normalTexture,
  );
  assert.equal((await snapshot()).bindings.length, 0);
  await page.locator('[data-placement-action="redo"]:visible').first().click();
  await wait(
    () =>
      !!globalThis.ferrumPlacementViewerState.spatial.billboards.sprite
        .normalTexture,
  );
  assert.equal((await snapshot()).bindings.length, 1);
  await page.evaluate(() => globalThis.ferrumPlacementViewerSaveDraft());
  assert.equal(sceneSaves, 0);
  assert.match(
    await page.evaluate(() => globalThis.ferrumPlacementViewerLastSaveError),
    /generated assets/i,
  );
  const downloadPromise = page.waitForEvent("download");
  await action("export").click();
  const download = await downloadPromise;
  await download.saveAs(resolve(run, "export.normal-assets.json"));
  const exported = JSON.parse(
    await readFile(resolve(run, "export.normal-assets.json")),
  );
  assert.equal(exported.format, "ferrum2d.sprite-normal.assets");
  assert.equal(exported.overwrite, false);
  for (const entry of exported.files) {
    const bytes = Buffer.from(entry.base64, "base64");
    assert.equal(sha256(bytes), entry.sha256);
    assert.equal(decodePng(bytes).width, 64);
  }
  let agentResume;
  if (integration) {
    resumeData = {
      bundle: exported,
      document: mergeScenePlacementPatch(source, applied.state.draftPatch)
        .document,
    };
    await writeFile(
      resolve(run, "agent-resume.json"),
      JSON.stringify(resumeData, null, 2) + "\n",
    );
    const resumed = await context.newPage();
    resumed.on("pageerror", (error) => errors.push(String(error)));
    try {
      await resumed.goto(origin + "/resume.html");
      await resumed.waitForFunction(
        () => window.resumeReport || window.resumeError,
      );
      const result = await resumed.evaluate(() => ({
        report: window.resumeReport,
        error: window.resumeError,
      }));
      assert.equal(result.error, undefined);
      agentResume = result.report;
      assert(agentResume.lightingDifference > 50);
    } finally {
      await resumed.close();
    }
  }
  assert(await action("save").isDisabled());
  await page.evaluate(() => globalThis.ferrumPlacementViewerSaveDraft());
  assert.equal(sceneSaves, 0, "Export must not count as persistence");
  await page.screenshot({
    path: resolve(run, "normal-assets-desktop.png"),
    fullPage: true,
  });
  const stablePatch = JSON.stringify((await snapshot()).state.draftPatch);
  await upload("invalid.png", Buffer.from("invalid"));
  await action("generate").click();
  await wait(() =>
    document
      .querySelector("[data-normal-status]")
      .textContent.includes("Generation failed"),
  );
  assert.equal(
    JSON.stringify((await snapshot()).state.draftPatch),
    stablePatch,
  );
  assert(await action("apply").isDisabled());
  await upload("large.png", sprite(1024));
  await action("generate").click();
  if (integration) {
    await action("cancel").focus();
    await page.keyboard.press("Enter");
  } else await action("cancel").click();
  assert.match(
    await tool.locator("[data-normal-status]").textContent(),
    /Cancelled/,
  );
  assert.equal(
    JSON.stringify((await snapshot()).state.draftPatch),
    stablePatch,
  );
  await upload("anim.gif", animatedGif());
  await tool.getByLabel("Export animation", { exact: true }).check();
  await tool.getByLabel("Loop animation").uncheck();
  await generate();
  await action("apply").click();
  await wait(() =>
    document
      .querySelector("[data-normal-status]")
      .textContent.includes("Applied"),
  );
  assert.equal(
    (await snapshot()).bindings[0].binding.animationSet.clips[0].loop,
    false,
  );
  await page.evaluate(() => {
    globalThis.__normalHostMode = "conflict";
    globalThis.ferrumPlacementNormalAssetHost = {
      async saveAssets(bundle, { signal }) {
        const response = await fetch("/save-assets", {
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            "x-test-mode": globalThis.__normalHostMode,
          },
          body: JSON.stringify(bundle),
        });
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      },
    };
    globalThis.ferrumPlacementViewerSelect("sprite");
  });
  await action("save").click();
  await wait(() =>
    document
      .querySelector("[data-normal-status]")
      .textContent.includes("conflict"),
  );
  assert.equal(sceneSaves, 0);
  await page.evaluate(() => (globalThis.__normalHostMode = "corrupt"));
  await action("save").click();
  await wait(() =>
    document
      .querySelector("[data-normal-status]")
      .textContent.includes("differs"),
  );
  await page.evaluate(() => globalThis.ferrumPlacementViewerSaveDraft());
  assert.equal(sceneSaves, 0);
  await page.evaluate(() => (globalThis.__normalHostMode = "ok"));
  await action("save").click();
  await wait(() =>
    document
      .querySelector("[data-normal-status]")
      .textContent.includes("saved and registered"),
  );
  await page.evaluate(() => globalThis.ferrumPlacementViewerSaveDraft());
  await wait(() => !globalThis.ferrumPlacementViewerState.draftPatch);
  assert.equal(sceneSaves, 1);
  const second = structuredClone(source);
  delete second.spatial;
  second.sceneComposition.fragments.main.instances[0].id = "flat";
  await page.locator("[data-placement-document-file]").setInputFiles({
    name: "flat.scene.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(second)),
  });
  await wait(() => globalThis.ferrumPlacementWorkspaceMode === "2d");
  await showPlacementBottom(page, "assets");
  if ((await tool.getAttribute("open")) === null)
    await tool.locator("summary").click();
  assert.match(
    await tool.locator("[data-normal-source]").textContent(),
    /Choose/,
  );
  await upload("anim.apng", animatedApng());
  await tool.getByLabel("Export animation", { exact: true }).check();
  await generate();
  assert(await action("apply").isDisabled());
  const tab = page.locator('[data-placement-document-key="sample"]');
  await tab.click();
  await wait(() => globalThis.ferrumPlacementWorkspaceMode === "spatial");
  assert.match(
    await tool.locator("[data-normal-source]").textContent(),
    /anim.gif/,
  );
  await page.locator('[data-placement-document-key^="file:"]').click();
  await wait(() => globalThis.ferrumPlacementWorkspaceMode === "2d");
  let budget;
  await upload("large.png", sprite(1024));
  await action("generate").click();
  await tab.click();
  await wait(() => globalThis.ferrumPlacementWorkspaceMode === "spatial");
  await page.waitForTimeout(250);
  assert.match(
    await tool.locator("[data-normal-source]").textContent(),
    /anim.gif/,
  );
  await page.setViewportSize({ width: 640, height: 840 });
  await showPlacementBottom(page, "assets");
  if (integration) {
    await tool.getByRole("tab", { name: "Settings", exact: true }).focus();
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
        .getByRole("tab", { name: "Settings", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    assert(
      await tool.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      "Compact normal tool overflow",
    );
  }
  await page.screenshot({
    path: resolve(run, "normal-assets-compact.png"),
    fullPage: true,
  });
  if (integration) {
    await upload("cancel-retained.png", sprite(32));
    await tool.getByLabel("Export animation", { exact: true }).uncheck();
    await generate();
    // Cancel after a real digest, immediately before reusing an unuploaded pair.
    await page.evaluate(() => {
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      let held = false;
      crypto.subtle.digest = async (...args) => {
        const result = await digest(...args);
        if (
          !held &&
          new TextDecoder().decode(args[1]).startsWith('["sample",')
        ) {
          held = true;
          await new Promise((resolve) => {
            globalThis.__finishNormalHash = resolve;
          });
        }
        return result;
      };
      globalThis.__restoreNormalHash = () => {
        crypto.subtle.digest = digest;
      };
    });
    await action("generate").click();
    await wait(() => !!globalThis.__finishNormalHash);
    const beforeCancel = await snapshot();
    await action("cancel").click();
    await page.evaluate(async () => {
      globalThis.__restoreNormalHash();
      globalThis.__finishNormalHash();
      await new Promise(requestAnimationFrame);
    });
    assert.deepEqual(
      await snapshot(),
      beforeCancel,
      "Cancelled preparation edited the scene",
    );
    assert(
      await action("apply").isDisabled(),
      "Cancelled regeneration remained applicable",
    );
    await generate();
    await action("apply").click();
    await wait(() =>
      document
        .querySelector("[data-normal-status]")
        .textContent.includes("Applied"),
    );
    assert.equal((await snapshot()).bindings.length, 1);
    const attempts = [];
    for (let i = 0; i < 9; i++) {
      await tool.getByRole("tab", { name: "Settings", exact: true }).click();
      await tool
        .getByLabel("Generated asset name", { exact: true })
        .fill("budget" + i);
      const before = await snapshot();
      await action("generate").click();
      await wait(
        () =>
          document.querySelector("[data-placement-normal-tool]").dataset
            .normalBusy === "false",
      );
      const status = await tool.locator("[data-normal-status]").textContent();
      attempts.push(status);
      if (status.includes("budget reached")) {
        assert.deepEqual(
          await snapshot(),
          before,
          "Budget rejection edited the scene",
        );
        break;
      }
      await action("apply").click();
      await wait(() =>
        document
          .querySelector("[data-normal-status]")
          .textContent.includes("Applied"),
      );
    }
    assert(
      attempts.at(-1).includes("budget reached"),
      "Session entry cap was not enforced",
    );
    assert(attempts.length < 9 && attempts.length > 1);
    budget = { entryLimit: 8, attempts: attempts.length, rejected: true };
  }
  await page.locator('[data-placement-document-key^="file:"]').click();
  await wait(() => globalThis.ferrumPlacementWorkspaceMode === "2d");
  const urlsBeforeClose = await page.evaluate(
    () => globalThis.__normalUiResources.urls.size,
  );
  if (integration) page.once("dialog", (dialog) => dialog.accept());
  await page.locator('[data-placement-close-document="sample"]').click();
  const urlsAfterClose = await page.evaluate(
    () => globalThis.__normalUiResources.urls.size,
  );
  assert(
    urlsAfterClose < urlsBeforeClose,
    "Closing a document retained generated image URLs",
  );
  if (integration) {
    await tool.getByRole("tab", { name: "Settings", exact: true }).click();
    await tool
      .getByLabel("Generated asset name", { exact: true })
      .fill("budget-released");
    await generate();
    budget.recoveredAfterDocumentClose = true;
  }
  await page.evaluate(() => {
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    );
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
  });
  assert.equal(await tool.getAttribute("data-normal-busy"), "false");
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: false }),
    ),
  );
  const released = await page.evaluate(() =>
    Object.fromEntries(
      Object.entries(globalThis.__normalUiResources).map(([key, values]) => [
        key,
        values.size,
      ]),
    ),
  );
  assert.deepEqual(released, { workers: 0, urls: 0, textures: 0 });
  assert.deepEqual(errors, []);
  const report = {
    ok: true,
    run,
    lightingDifference,
    sceneSaves,
    generatedWithoutSceneMutation: true,
    singleUndo: true,
    changedSelectionRejected: true,
    redo: true,
    handoff: true,
    exportHashes: true,
    exportDoesNotPersist: true,
    sourceFailurePreservesDraft: true,
    cancel: true,
    gifAnimation: true,
    apngAnimation: true,
    hostConflict: true,
    hostHashRejected: true,
    hostSaved: true,
    documentIsolation: true,
    staleResultBlocked: true,
    compact: true,
    ...(integration
      ? {
          deviceScaleFactor: 2,
          keyboardTabsAndCancel: true,
          partialUploadRollbackAndRetry: true,
          priorGenerationUndoRedoProvenance: true,
          cancelledPreparationRetainsOwnedPair: true,
          agentResume,
          budget,
        }
      : {}),
    documentCloseReleasedUrls: true,
    released,
    requests: Object.fromEntries(requests),
  };
  await writeFile(
    resolve(
      artifact,
      integration ? "ui-verification.json" : "verification.json",
    ),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page
    .screenshot({ path: resolve(run, "failure.png"), fullPage: true })
    .catch(() => {});
  console.error(
    await page
      .evaluate(() => ({
        normal: document.querySelector("[data-normal-status]")?.textContent,
        error: document.querySelector(".demo-error")?.textContent,
        history: globalThis.ferrumPlacementViewerHistory,
      }))
      .catch(() => undefined),
    errors,
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
