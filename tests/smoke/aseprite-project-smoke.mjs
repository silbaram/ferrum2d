import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { createServer } from "node:http";
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  readdir,
  unlink,
} from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { chromium } from "playwright-core";
import { encodePngRgba } from "../../scripts/tools/pack-textures.mjs";
import { sha256 } from "../../scripts/tools/sprite-normals-tool.mjs";
import { showPlacementBottom } from "./placement-panel-navigation.mjs";
import { placementNormalGeneratorPlugin } from "../../apps/placement-viewer/server/normalGenerator.mjs";
import { smokeNativeTiles } from "./native-tile-project-smoke.mjs";
import { smokeNativeNormals } from "./native-normal-project-smoke.mjs";

const tileMode = process.argv.includes("--tiles");
const externalTileMode = tileMode && process.argv.includes("--external-tsj");
const multiTileMode = tileMode && process.argv.includes("--multi-tilesets");
const animationMode = process.argv.includes("--animations");
const pairedMode = process.argv.includes("--paired");
const normalMode = pairedMode || process.argv.includes("--normals");
const artifact = resolve(
  externalTileMode
    ? "artifacts/tiled-external-assets"
    : multiTileMode
      ? "artifacts/multi-tileset-assets"
      : tileMode
        ? "artifacts/native-tile-assets"
        : pairedMode
          ? "artifacts/aseprite-paired/project"
          : normalMode
            ? "artifacts/native-normal-assets"
            : animationMode
              ? "artifacts/aseprite-animation/project"
              : "artifacts/aseprite-project",
);
await mkdir(artifact, { recursive: true });
const run = await mkdtemp(join(artifact, "run-")),
  app = resolve("apps/placement-viewer/dist");
const compiled = spawnSync(
  "cargo",
  [
    "test",
    "--manifest-path",
    "apps/placement-viewer-desktop/src-tauri/Cargo.toml",
    "--no-default-features",
    "--offline",
    "--no-run",
    "--message-format=json",
  ],
  { encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
);
await writeFile(join(run, "rust-build.log"), compiled.stderr + compiled.stdout);
assert.equal(compiled.status, 0, compiled.stderr);
const executable = compiled.stdout
  .split("\n")
  .flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  })
  .find(
    (item) =>
      item.reason === "compiler-artifact" &&
      item.target?.name === "ferrum_placement_viewer_desktop_lib" &&
      item.profile?.test &&
      item.executable,
  )?.executable;
assert(executable, "Rust host test binary missing");

function rustBridge() {
  const process = spawn(
    executable,
    [
      "placement_document::aseprite_assets::tests::browser_bridge",
      "--exact",
      "--ignored",
      "--nocapture",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let serial = 0,
    closed = false,
    diagnostic = "";
  const pending = new Map();
  process.stderr.on("data", (chunk) => (diagnostic += chunk));
  createInterface({ input: process.stdout }).on("line", (line) => {
    const index = line.indexOf("FERRUM_ASEPRITE_REPLY ");
    if (index < 0) return;
    const reply = JSON.parse(
        line.slice(index + "FERRUM_ASEPRITE_REPLY ".length),
      ),
      entry = pending.get(reply.id);
    if (!entry) return;
    pending.delete(reply.id);
    clearTimeout(entry.timer);
    reply.error
      ? entry.reject(new Error(reply.error))
      : entry.resolve(reply.result);
  });
  const ended = new Promise((done, reject) => {
    process.on("error", reject);
    process.on("exit", (code) => {
      closed = true;
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(Error("Native host exited: " + diagnostic));
      }
      pending.clear();
      code === 0
        ? done()
        : reject(Error("Native host exit " + code + " " + diagnostic));
    });
  });
  ended.catch(() => {});
  return {
    invoke(command, args = {}) {
      assert(!closed, "Native host was closed");
      const id = ++serial;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error("Native host timeout: " + command));
        }, 30000);
        pending.set(id, { resolve, reject, timer });
        process.stdin.write(JSON.stringify({ id, command, args }) + "\n");
      });
    },
    async close() {
      process.stdin.end();
      await ended;
    },
  };
}

let bridge = rustBridge(),
  hold = false,
  release,
  held = false,
  corruptReply = false,
  gameProject;
const commands = [];
let generatorRoute;
if (normalMode)
  placementNormalGeneratorPlugin().configurePreviewServer({
    middlewares: {
      use(prefix, handler) {
        generatorRoute = { prefix, handler };
      },
    },
  });
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  try {
    if (normalMode && url.pathname.startsWith(generatorRoute.prefix + "/")) {
      request.url = request.url.slice(generatorRoute.prefix.length);
      generatorRoute.handler(request, response);
      return;
    }
    if (url.pathname === "/game.html") {
      response.setHeader("content-type", "text/html");
      response.end(
        '<!doctype html><script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/engine/dist/core.js","@ferrum2d/ferrum-web/authoring":"/engine/dist/authoring.js","@ferrum2d/ferrum-web/starter-scenes":"/engine/dist/starter-scenes.js"}}</script><canvas style="width:480px;height:360px"></canvas><script type="module">import {probeSavedProjectGame} from "/game-fixture.mjs";try{window.savedGameReport=await probeSavedProjectGame()}catch(error){window.savedGameFailure=error.stack}</script>',
      );
      return;
    }
    if (url.pathname === "/ipc") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const { command, args } = JSON.parse(Buffer.concat(chunks).toString());
      commands.push(command);
      const result = await bridge.invoke(command, args);
      if (
        command === "save_placement_tile_assets" ||
        command === "save_placement_aseprite_assets" ||
        command === "save_placement_normal_assets"
      ) {
        if (hold) {
          held = true;
          await new Promise((done) => (release = done));
        }
        if (corruptReply) {
          if (
            [
              "save_placement_aseprite_assets",
              "save_placement_tile_assets",
            ].includes(command)
          )
            result.assets[0].metadata.pngSha256 = "0".repeat(64);
          else result.entries[0].sha256 = "0".repeat(64);
        }
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ result }));
      return;
    }
    if (url.pathname === "/asset") {
      const value = await bridge.invoke("protocol", {
        uri: url.searchParams.get("uri"),
      });
      response.writeHead(value.status, {
        "content-type": value.mime,
        "cache-control": "no-store",
      });
      response.end(Buffer.from(value.base64, "base64"));
      return;
    }
    let file;
    if (url.pathname === "/aseprite-paired-runtime-fixture.mjs")
      file = resolve("tests/smoke/aseprite-paired-runtime-fixture.mjs");
    else if (url.pathname === "/game-fixture.mjs")
      file = resolve(
        tileMode
          ? "tests/smoke/native-tile-game-fixture.mjs"
          : "tests/smoke/aseprite-project-game-fixture.mjs",
      );
    else if (url.pathname.startsWith("/engine/")) {
      const base = resolve("packages/ferrum-web");
      file = resolve(base, "." + decodeURIComponent(url.pathname.slice(7)));
      assert(file.startsWith(base + sep));
    } else if (url.pathname.startsWith("/game/")) {
      const base = resolve(gameProject, "public");
      file = resolve(base, "." + decodeURIComponent(url.pathname.slice(5)));
      assert(file.startsWith(base + sep));
    } else {
      file = resolve(
        app,
        "." +
          (url.pathname === "/"
            ? "/index.html"
            : decodeURIComponent(url.pathname)),
      );
      assert(file.startsWith(app + sep));
    }
    response.setHeader(
      "content-type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".wasm": "application/wasm",
        ".json": "application/json",
        ".png": "image/png",
        ".svg": "image/svg+xml",
      }[extname(file)] ?? "application/octet-stream",
    );
    response.end(await readFile(file));
  } catch (error) {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: error.message }));
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

function source(mode) {
  const document = {
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
              x: mode === "2d" ? 800 : 0,
              y: mode === "2d" ? 480 : 0,
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
  if (tileMode) document.sceneComposition.prefabs.map_spawn={props:{components:{visual:{kind:'primitive',shape:'rect',width:8,height:8,color:'#ffffff'},collider:'none',layer:'wall'}}};
  if (tileMode) document.behaviorRecipes.entities.map_guard={recipes:[{kind:'health',max:10}]};
  if (mode === "hd2d")
    document.spatial = {
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
  if (tileMode) {
    const second = structuredClone(
      document.sceneComposition.fragments.main.instances[0],
    );
    second.id = "second";
    second.x += 70;
    document.sceneComposition.fragments.main.instances.push(second);
    if (document.spatial) {
      document.spatial.billboards.second = {};
      document.spatial.camera.target.x = 35;
      document.spatial.camera.position.x = 35;
      document.spatial.camera.height = 170;
    }
  }
  return document;
}
function fixture(updated = false) {
  const height = updated ? 32 : 16,
    pixels = new Uint8Array(32 * height * 4),
    rect = updated
      ? { x: 24, y: 20, w: 8, h: 12 }
      : { x: 0, y: 0, w: 16, h: 16 };
  for (let y = rect.y; y < rect.y + rect.h; y++)
    for (let x = rect.x; x < rect.x + rect.w; x++)
      if (
        !normalMode ||
        Math.hypot(
          (x + 0.5 - rect.x) / rect.w - 0.5,
          (y + 0.5 - rect.y) / rect.h - 0.5,
        ) < 0.44
      )
        pixels.set(
          updated ? [20, 70, 220, 255] : [220, 30, 20, 255],
          (y * 32 + x) * 4,
        );
  if (pairedMode)
    for (let y = 0; y < 8; y++)
      for (let x = 16; x < 24; x++) {
        if (Math.hypot((x + 0.5 - 16) / 8 - 0.5, (y + 0.5) / 8 - 0.5) < 0.44)
          pixels.set([30, 220, 50, 255], (y * 32 + x) * 4);
      }
  return {
    png: encodePngRgba(32, height, pixels),
    json: {
      frames: {
        "hero-idle.png": {
          frame: rect,
          rotated: false,
          trimmed: false,
          duration: pairedMode && updated ? 90 : 100,
        },
        ...(pairedMode
          ? {
              "hero-walk.png": {
                frame: { x: 16, y: 0, w: 8, h: 8 },
                rotated: false,
                trimmed: false,
                duration: updated ? 180 : 200,
              },
            }
          : {}),
      },
      meta: {
        image: "hero.png",
        size: { w: 32, h: height },
        frameTags: pairedMode
          ? updated
            ? [
                { name: "rest", from: 0, to: 0 },
                { name: "run", from: 0, to: 1 },
              ]
            : [
                { name: "run", from: 0, to: 1 },
                { name: "rest", from: 0, to: 0 },
              ]
          : [{ name: "idle", from: 0, to: 0, direction: "forward" }],
      },
    },
  };
}
const reports = [];
try {
  for (const scenario of tileMode
    ? externalTileMode
      ? ["tiled:2d", "tiled:hd2d"]
      : ["tiled:2d", "tiled:hd2d", "ldtk:2d", "ldtk:hd2d"]
    : normalMode
      ? ["hd2d"]
      : ["2d", "hd2d"]) {
    const [kind, mode] = tileMode ? scenario.split(":") : [undefined, scenario];
    const project = join(run, scenario.replace(":", "-"));
    gameProject = project;
    await mkdir(join(project, "public"), { recursive: true });
    const scene = join(project, "public/scene-authoring.json"),
      assetRoot = join(project, "public/assets/.ferrum-aseprite");
    const initial = source(mode);
    await writeFile(scene, JSON.stringify(initial, null, 2) + "\n");
    let context, page, errors;
    async function open() {
      errors = [];
      context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        deviceScaleFactor: mode === "hd2d" ? 2 : 1,
      });
      page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.on("pageerror", (error) =>
        errors.push(error.stack ?? String(error)),
      );
      await page.addInitScript(() => {
        const original = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          return original(
            url.startsWith("ferrum-asset:")
              ? "/asset?uri=" + encodeURIComponent(url)
              : input,
            init,
          );
        };
        window.__TAURI__ = {
          core: {
            async invoke(command, args) {
              const response = await original("/ipc", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ command, args }),
              });
              const result = await response.json();
              if (result.error) throw Error(result.error);
              return result.result;
            },
          },
        };
        const resources = { urls: new Set(), textures: new Set() },
          create = URL.createObjectURL.bind(URL),
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
        const allocate = WebGL2RenderingContext.prototype.createTexture,
          dispose = WebGL2RenderingContext.prototype.deleteTexture;
        WebGL2RenderingContext.prototype.createTexture = function () {
          const value = allocate.call(this);
          if (value) resources.textures.add(value);
          return value;
        };
        WebGL2RenderingContext.prototype.deleteTexture = function (value) {
          resources.textures.delete(value);
          dispose.call(this, value);
        };
        window.projectResources = resources;
      });
      await page.goto(origin + "/?projectPath=" + encodeURIComponent(project));
    }
    const ready = () =>
      page.waitForFunction(
        () => window.ferrumPlacementViewerState && window.ferrumEngine,
      );
    const tool = () =>
        page.locator(
          tileMode
            ? "[data-placement-tile-tool]"
            : "[data-placement-aseprite-tool]",
        ),
      action = (name) =>
        tool().locator(
          `[data-${tileMode ? "tile" : "aseprite"}-action="${name}"]`,
        );
    async function reveal() {
      await showPlacementBottom(page, "assets");
      if ((await tool().getAttribute("open")) === null)
        await tool().locator(":scope > summary").click();
    }
    async function stage(data) {
      await tool().getByRole("tab", { name: "Source", exact: true }).click();
      await tool()
        .getByLabel("Aseprite asset name", { exact: true })
        .fill("hero");
      await tool()
        .getByLabel("Aseprite JSON", { exact: true })
        .setInputFiles({
          name: "hero.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(data.json)),
        });
      await tool().getByLabel("Aseprite PNG", { exact: true }).setInputFiles({
        name: "hero.png",
        mimeType: "image/png",
        buffer: data.png,
      });
      await action("inspect").click();
      await page.waitForFunction(
        () =>
          document.querySelector("[data-placement-aseprite-tool]").dataset
            .asepriteBusy === "false",
      );
      assert.equal(await tool().getAttribute("data-aseprite-ready"), "true");
    }
    const imported = () =>
      page.evaluate(
        () => window.ferrumPlacementViewerAgentHandoff.asepriteImports ?? [],
      );
    async function applied() {
      await page.waitForFunction(() =>
        document
          .querySelector("[data-aseprite-status]")
          .textContent.startsWith("Applied"),
      );
    }
    async function saveFailed() {
      await page.waitForFunction(() =>
        document
          .querySelector("[data-aseprite-status]")
          .textContent.startsWith("Project save failed"),
      );
    }
    async function saveSucceeded() {
      await page.waitForFunction(() =>
        document
          .querySelector("[data-aseprite-status]")
          .textContent.startsWith("Project saved"),
      );
    }
    async function pixels() {
      if (mode === "2d")
        await page.locator('[data-placement-mode="game"]').click();
      const result = await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
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
          blue = 0;
        for (let i = 0; i < bytes.length; i += 4) {
          if (bytes[i] > bytes[i + 1] * 2 && bytes[i] > bytes[i + 2] * 2) red++;
          if (bytes[i + 2] > bytes[i] * 2 && bytes[i + 2] > bytes[i + 1] * 1.5)
            blue++;
        }
        return { red, blue };
      });
      if (mode === "2d")
        await page.locator('[data-placement-mode="2d"]').click();
      return result;
    }
    async function closePage() {
      await page.evaluate(() =>
        window.dispatchEvent(
          new PageTransitionEvent("pagehide", { persisted: false }),
        ),
      );
      assert.deepEqual(
        await page.evaluate(() => ({
          urls: window.projectResources.urls.size,
          textures: window.projectResources.textures.size,
        })),
        { urls: 0, textures: 0 },
      );
      assert.deepEqual(errors, []);
      await context.close();
    }
    try {
      await open();
      await ready();
      await reveal();
      if (tileMode) {
        reports.push(
          await smokeNativeTiles({
            getPage: () => page,
            kind,
            mode,
            multi: multiTileMode || externalTileMode,
            external: externalTileMode,
            project,
            scene,
            initial,
            run,
            origin,
            tool,
            action,
            reveal,
            restart: async () => {
              await closePage();
              await bridge.close();
              bridge = rustBridge();
              await open();
              await ready();
              await reveal();
            },
            close: closePage,
            setCorrupt: (value) => {
              corruptReply = value;
            },
            holdSave: () => {
              hold = true;
              held = false;
            },
            waitHeld: async () => {
              for (let i = 0; i < 200 && !held; i++)
                await new Promise((done) => setTimeout(done, 10));
              assert(held);
            },
            releaseSave: () => {
              hold = false;
              release();
            },
            freshGame: async () => {
              const game = await browser.newPage({
                viewport: { width: 480, height: 360 },
                deviceScaleFactor: mode === "hd2d" ? 2 : 1,
              });
              try {
                await game.goto(origin + "/game.html");
                await game.waitForFunction(
                  () => window.savedGameReport || window.savedGameFailure,
                );
                const r = await game.evaluate(() => ({
                  report: window.savedGameReport,
                  error: window.savedGameFailure,
                }));
                assert.equal(r.error, undefined);
                return r.report;
              } finally {
                await game.close();
              }
            },
            protocol: (uri) => bridge.invoke("protocol", { uri }),
            tamperOpen: async () => {
              await closePage();
              await bridge.close();
              bridge = rustBridge();
              await open();
              await page.waitForFunction(() =>
                document.querySelector(".demo-error-shell"),
              );
              const error = await page
                .locator(".demo-error-shell")
                .textContent();
              await context.close();
              return error;
            },
          }),
        );
        continue;
      }
      assert(await action("save").isDisabled());
      const first = fixture();
      await stage(first);
      await action(animationMode ? "animation" : "apply").click();
      await applied();
      if (normalMode) {
        reports.push(
          await smokeNativeNormals({
            getPage: () => page,
            paired: pairedMode,
            project,
            scene,
            initial,
            run,
            fixture,
            stage,
            reveal,
            action,
            tool,
            imported,
            pixels,
            origin,
            restart: async () => {
              await closePage();
              await bridge.close();
              bridge = rustBridge();
              await open();
              await ready();
              await reveal();
            },
            close: closePage,
            setCorrupt: (value) => {
              corruptReply = value;
            },
            holdSave: () => {
              hold = true;
              held = false;
            },
            waitHeld: async () => {
              for (let i = 0; i < 200 && !held; i++)
                await new Promise((done) => setTimeout(done, 10));
              assert(held);
            },
            releaseSave: () => {
              hold = false;
              release();
            },
          }),
        );
        continue;
      }
      const id = (await imported())[0].assetId;
      assert((await pixels()).red > 100);
      assert.deepEqual(JSON.parse(await readFile(scene)), initial);
      await reveal();
      await mkdir(assetRoot, { recursive: true });
      const conflict = join(assetRoot, id + ".json");
      await writeFile(conflict, "competing source");
      await action("save").click();
      await saveFailed();
      assert.equal(await readFile(conflict, "utf8"), "competing source");
      assert.equal((await imported())[0].persisted, false);
      assert.deepEqual(JSON.parse(await readFile(scene)), initial);
      await unlink(conflict);
      // Native persistence completes, then a malformed host reply must still block scene save.
      corruptReply = true;
      await action("save").click();
      await saveFailed();
      corruptReply = false;
      assert.equal((await imported())[0].persisted, false);
      assert.deepEqual(JSON.parse(await readFile(scene)), initial);
      hold = true;
      held = false;
      await action("save").click();
      for (let i = 0; i < 100 && !held; i++)
        await new Promise((done) => setTimeout(done, 20));
      assert(held, "Native save was not held");
      await action("cancel").click();
      hold = false;
      release();
      await page.waitForTimeout(100);
      assert.equal((await imported())[0].persisted, false);
      assert.deepEqual(JSON.parse(await readFile(scene)), initial);
      await action("save").click();
      await saveSucceeded();
      assert.equal((await imported())[0].persisted, true);
      if (animationMode) {
        const restored = (await imported())[0].animations[0];
        assert.equal(restored.tags[0].name, "idle");
        assert.equal(restored.tags[0].id, 0);
        assert.equal(restored.initialClip, 0);
      }
      const saved = JSON.parse(await readFile(scene));
      assert.equal(
        saved.sceneComposition.fragments.main.instances[0].props.components
          .visual.texture,
        id,
      );
      assert((await pixels()).red > 100);
      assert.equal(
        sha256(await readFile(join(assetRoot, id + ".png"))),
        sha256(first.png),
      );
      assert(!(await readdir(assetRoot)).some((name) => name.endsWith(".tmp")));
      await closePage();
      await bridge.close();
      bridge = rustBridge();
      await open();
      await ready();
      await reveal();
      assert.equal((await imported())[0].assetId, id);
      assert.equal((await imported())[0].persisted, true);
      assert.equal(
        await page
          .locator("[data-placement-browser-asset]")
          .filter({ hasText: "hero-idle.png" })
          .count(),
        1,
      );
      assert.equal(
        await tool()
          .getByLabel("Aseprite asset name", { exact: true })
          .inputValue(),
        "hero",
      );
      assert((await pixels()).red > 100);
      await reveal();
      const next = fixture(true);
      await stage(next);
      await action(animationMode ? "reimport-animation" : "reimport").click();
      await applied();
      const newId = (await imported())[0].assetId;
      assert.notEqual(newId, id);
      assert((await pixels()).blue > 100);
      await page
        .locator('[data-placement-action="undo"]:visible')
        .first()
        .click();
      await page.waitForFunction(
        (id) =>
          window.ferrumPlacementViewerAgentHandoff.asepriteImports?.[0]
            ?.assetId === id,
        id,
      );
      assert((await pixels()).red > 100);
      await page
        .locator('[data-placement-action="redo"]:visible')
        .first()
        .click();
      assert((await pixels()).blue > 100);
      // Assets publish safely, but stale scene baselines must preserve an external edit.
      const external = structuredClone(saved);
      external.sceneComposition.fragments.main.instances[0].x += 17;
      await writeFile(scene, JSON.stringify(external));
      await reveal();
      await action("save").click();
      await saveFailed();
      assert.deepEqual(JSON.parse(await readFile(scene)), external);
      assert.equal((await imported())[0].persisted, true);
      assert((await pixels()).blue > 100);
      assert.equal(
        JSON.parse(await readFile(join(assetRoot, "catalog.json"))).revisions
          .length,
        2,
      );
      await writeFile(scene, JSON.stringify(saved));
      await reveal();
      await action("save").click();
      await saveSucceeded();
      const finalBytes = await readFile(scene);
      assert.equal(
        JSON.parse(finalBytes).sceneComposition.fragments.main.instances[0]
          .props.components.visual.texture,
        newId,
      );
      await page.screenshot({
        path: join(run, mode + "-saved.png"),
        fullPage: true,
      });
      await closePage();
      await bridge.close();
      bridge = rustBridge();
      await open();
      await ready();
      await reveal();
      assert.equal((await imported())[0].assetId, newId);
      assert.equal((await imported())[0].persisted, true);
      assert((await pixels()).blue > 100);
      await closePage();
      await bridge.close();
      bridge = rustBridge();
      const raw = await readFile(join(assetRoot, newId + ".png"));
      const gamePage = await browser.newPage({
        viewport: { width: 480, height: 360 },
        deviceScaleFactor: mode === "hd2d" ? 2 : 1,
      });
      const gameErrors = [];
      gamePage.on("pageerror", (error) => gameErrors.push(String(error)));
      await gamePage.goto(origin + "/game.html");
      await gamePage.waitForFunction(
        () => window.savedGameReport || window.savedGameFailure,
      );
      const gameResult = await gamePage.evaluate(() => ({
        report: window.savedGameReport,
        error: window.savedGameFailure,
      }));
      assert.equal(gameResult.error, undefined);
      assert(gameResult.report.bluePixels > 100);
      assert.deepEqual(gameErrors, []);
      await gamePage.close();
      await writeFile(join(assetRoot, newId + ".png"), Buffer.from("tampered"));
      await open();
      await page.waitForFunction(() =>
        document.querySelector(".demo-error-shell"),
      );
      assert.match(
        await page.locator(".demo-error-shell").textContent(),
        /SHA-256|byte limit/,
      );
      assert.deepEqual(await readFile(scene), finalBytes);
      await context.close();
      await writeFile(join(assetRoot, newId + ".png"), raw);
      reports.push({
        mode,
        dpr: mode === "hd2d" ? 2 : 1,
        realRustStorageAndProtocol: true,
        exclusiveSources: true,
        sourceHashes: true,
        malformedReplyBlocksScene: true,
        cancelBlocksScene: true,
        singleProjectSave: true,
        freshRustAndBrowserSessions: true,
        ...(animationMode ? { animationSourceReconstruction: true } : {}),
        restoredCatalogFrames: true,
        reimportUndoRedo: true,
        sceneConflictPreserved: true,
        idempotentRetry: true,
        tamperRejected: true,
        savedManifestGame: gameResult.report,
        released: { urls: 0, textures: 0 },
      });
    } catch (error) {
      await page
        ?.screenshot({ path: join(run, mode + "-failure.png"), fullPage: true })
        .catch(() => {});
      console.error(
        mode,
        await page
          ?.evaluate(() => ({
            tool: document.querySelector("[data-aseprite-status]")?.textContent,
            tile: document.querySelector("[data-tile-status]")?.textContent,
            error: document.querySelector(".demo-error")?.textContent,
          }))
          .catch(() => {}),
        errors,
      );
      await context?.close();
      throw error;
    }
  }
  const report = {
    ok: true,
    run,
    browser: browser.version(),
    transport:
      "test-only stdio bridge to actual Rust host storage/protocol functions; native GUI IPC is not exercised",
    results: reports,
    commands,
  };
  await writeFile(
    join(artifact, "verification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (release) release();
  await browser.close();
  await bridge.close();
  await new Promise((done) => server.close(done));
}
