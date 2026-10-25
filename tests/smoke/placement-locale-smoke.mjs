import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright-core";
import { showPlacementInspector, showPlacementViewOptions } from "./placement-panel-navigation.mjs";
const artifact = resolve("artifacts/viewer-localization");
await mkdir(artifact, { recursive: true });
const arg = process.argv.indexOf("--url"),
  base = resolve("apps/placement-viewer/dist");
let server;
if (arg < 0) {
  server = createServer(async (req, res) => {
    try {
      const p = new URL(req.url, "http://localhost").pathname,
        file = resolve(
          base,
          "." + (p === "/" ? "/index.html" : decodeURIComponent(p)),
        );
      assert(file.startsWith(base + sep));
      res.setHeader(
        "content-type",
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".wasm": "application/wasm",
          ".png": "image/png",
          ".woff2": "font/woff2",
        }[extname(file)] ?? "application/octet-stream",
      );
      res.end(await readFile(file));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
}
const origin =
  arg >= 0
    ? process.argv[arg + 1]
    : "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.FERRUM_BROWSER_EXECUTABLE,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
  ],
});
const results = [];
const storageKey = "ferrum.placement.locale.v1";
const snapshot = (page) =>
  page.evaluate(() => ({
    document: JSON.stringify(window.ferrumPlacementSpatialExportDocument()),
    patch: JSON.stringify(window.ferrumPlacementViewerExportPatch()),
    handoff: JSON.stringify(window.ferrumPlacementViewerAgentHandoff),
    history: window.ferrumPlacementViewerHistory,
    selected: window.ferrumPlacementViewerState.selectedInstanceIds,
    entities: window.ferrumPlacementViewerState.instances.map((i) => i.entity),
    camera:
      window.ferrumPlacementWorkspaceMode === "spatial"
        ? window.ferrumPlacementSpatialCamera
        : window.ferrumPlacementEditCamera,
  }));
const waitReady = (page) =>
  page.waitForFunction(
    () =>
      window.ferrumPlacementGrid?.lineCount > 0 &&
      window.ferrumPlacementViewerRuntimeFrame?.drawCalls > 0,
  );
try {
  for (const mode of ["2d", "spatial"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      deviceScaleFactor: 2,
      locale: "en-US",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (dialog) => dialog.accept());
    try {
      await page.addInitScript(
        (key) => localStorage.setItem(key, "en"),
        storageKey,
      );
      await page.goto(origin + (mode === "spatial" ? "/?scene=hd2d" : "/"));
      await waitReady(page);
      const language = page.locator("[data-placement-language]");
      if (mode === "2d") {
        await page.locator('[data-instance-id="crate_left"]').click();
        await showPlacementInspector(page);
      }
      const field = page.locator(
        mode === "2d"
          ? '[data-placement-transform-field="x"]:visible'
          : '[data-placement-spatial-field="x"]:visible',
      );
      const next = String(Number(await field.inputValue()) + 5);
      await field.fill(next);
      await field.press("Tab");
      await page.locator("canvas.demo-canvas").focus();
      await page.waitForFunction(
        () =>
          window.ferrumPlacementViewerHistory.undoCount > 0 &&
          !window.ferrumPlacementViewerHistory.transactionLabel,
      );
      await page.evaluate(
        () =>
          (window.__localeCanvas =
            document.querySelector("canvas.demo-canvas")),
      );
      const before = await snapshot(page);
      for (const locale of ["ko", "en", "ko"]) {
        await language.selectOption(locale);
        await page.waitForFunction(
          (language) => document.documentElement.lang === language,
          locale,
        );
        await page.waitForTimeout(450);
        assert.deepEqual(
          await snapshot(page),
          before,
          "language change must preserve document, history, selection, handles and camera",
        );
        assert.equal(await field.inputValue(), next);
        await showPlacementViewOptions(page);
        assert.equal(
          await page.evaluate(
            () =>
              window.__localeCanvas ===
              document.querySelector("canvas.demo-canvas"),
          ),
          true,
        );
        assert.equal(
          await page
            .getByRole("button", {
              name: locale === "ko" ? "실행 취소" : "Undo",
              exact: true,
            })
            .count(),
          1,
        );
        assert.equal(
          await page
            .getByRole("checkbox", {
              name: locale === "ko" ? "격자 표시" : "Show grid",
              exact: true,
            })
            .count(),
          1,
        );
        assert.equal(
          await page
            .getByRole("button", {
              name: locale === "ko" ? "게임 미리보기" : "Game Preview",
              exact: true,
            })
            .count(),
          1,
        );
        assert(
          await page
            .locator("[data-placement-grid-spacing]")
            .innerText()
            .then((t) => t.includes(locale === "ko" ? "단위" : "units")),
        );
      }
      // All asset tool labels use live UI bindings, including lazily opened content.
      for (const [selector, name] of [
        ["[data-placement-aseprite-tool] > summary", "Aseprite 가져오기"],
        ["[data-placement-tile-tool] > summary", "타일 프레임 가져오기"],
        ["[data-placement-normal-tool] > summary", "노멀 생성"],
      ]) {
        const summary = page.locator(selector);
        assert.equal(await summary.innerText(), name);
        await summary.click();
        if (name === "노멀 생성") {
          assert.equal(
            await page.getByLabel("노멀 원본 이미지", { exact: true }).count(),
            1,
          );
          assert.equal(
            await page.getByLabel("노멀 프리셋", { exact: true }).count(),
            1,
          );
        }
        await summary.click();
      }
      // Open another document, switch while the original inspector is detached, and restore it.
      const fixture = {
        format: "ferrum2d.consumer.scene-authoring",
        version: 1,
        behaviorRecipes: { entities: {} },
        sceneComposition: {
          initialFragment: "main",
          prefabs: { object: { props: { behaviorRecipes: [] } } },
          fragments: {
            main: {
              instances: [
                {
                  id: "Save",
                  prefab: "object",
                  x: 0,
                  y: 0,
                  props: {
                    components: {
                      visual: {
                        kind: "sprite",
                        texture: "crate",
                        width: 24,
                        height: 32,
                      },
                      body: { type: "static" },
                      collider: { type: "aabb", halfWidth: 12, halfHeight: 16 },
                      layer: "wall",
                    },
                  },
                },
              ],
            },
          },
        },
      };
      await page.locator("[data-placement-document-file]").setInputFiles({
        name: "Save.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(fixture)),
      });
      await page.waitForFunction(() =>
        window.ferrumPlacementViewerState.instances.some(
          (i) => i.instanceId === "Save",
        ),
      );
      assert.equal(
        await page.locator('[data-instance-id="Save"]').innerText(),
        "Save",
      );
      await page.locator('[data-instance-id="Save"]').click();
      assert.equal(
        await page
          .locator('[data-section="identity"] dd:visible')
          .first()
          .innerText(),
        "Save",
      );
      await language.selectOption("en");
      await language.selectOption("ko");
      assert.equal(
        await page.locator('[data-instance-id="Save"]').innerText(),
        "Save",
        "authored IDs must not be treated as UI keys",
      );
      await page.locator("[data-placement-document-key]").first().click();
      await page.waitForFunction(
        (mode) => window.ferrumPlacementWorkspaceMode === mode,
        mode,
      );
      const restored = await snapshot(page);
      const {
        entities: beforeHandles,
        handoff: beforeHandoff,
        ...beforeTab
      } = before;
      const {
        entities: restoredHandles,
        handoff: restoredHandoff,
        ...restoredTab
      } = restored;
      assert.deepEqual(
        restoredTab,
        beforeTab,
        "cached tab must retain authored edits after language changes",
      );
      assert.equal(
        await page
          .getByRole("button", { name: "실행 취소", exact: true })
          .count(),
        1,
      );
      const fonts = await page.evaluate(async () => {
        const faces = await document.fonts.load(
          '13px "Ferrum Korean UI"',
          "한국어",
        );
        return faces.map((face) => ({
          family: face.family,
          status: face.status,
        }));
      });
      assert(
        fonts.length > 0 && fonts.every((font) => font.status === "loaded"),
        "bundled Hangul font must load",
      );
      await page.screenshot({
        path: resolve(artifact, `${mode}-ko.png`),
        fullPage: true,
      });
      await page.setViewportSize({ width: 800, height: 680 });
      const box = await language.boundingBox();
      assert(
        box.x >= 0 && box.x + box.width <= 800,
        "language selector must remain reachable on a compact window",
      );
      await page.screenshot({
        path: resolve(artifact, `${mode}-ko-compact.png`),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate((key) => localStorage.getItem(key), storageKey),
        "ko",
      );
      // Remove the startup override before testing an actual reload in the same browser context.
      const reloaded = await page.context().newPage();
      await reloaded.goto(origin + (mode === "spatial" ? "/?scene=hd2d" : "/"));
      await waitReady(reloaded);
      assert.equal(
        await reloaded.locator("[data-placement-language]").inputValue(),
        "ko",
      );
      await reloaded.reload();
      await waitReady(reloaded);
      assert.equal(
        await reloaded.locator("[data-placement-language]").inputValue(),
        "ko",
      );
      await reloaded.close();
      assert.deepEqual(errors, []);
      results.push({
        mode,
        dpr: 2,
        liveSwitch: true,
        authoredValuesPreserved: true,
        draftHistoryCameraHandlesPreserved: true,
        cachedTab: true,
        assetTools: true,
        compact: true,
        persistence: true,
      });
    } catch (error) {
      await page
        .screenshot({ path: resolve(artifact, "failure.png"), fullPage: true })
        .catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }
  for (const storage of ["missing", "invalid", "blocked"]) {
    const page = await browser.newPage({
      locale: "ko-KR",
      viewport: { width: 1280, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    if (storage === "invalid")
      await page.addInitScript(
        (key) => localStorage.setItem(key, "invalid"),
        storageKey,
      );
    if (storage === "blocked")
      await page.addInitScript(() => {
        Storage.prototype.getItem = function () {
          throw new DOMException("blocked", "SecurityError");
        };
        Storage.prototype.setItem = function () {
          throw new DOMException("blocked", "SecurityError");
        };
      });
    await page.goto(origin);
    await waitReady(page);
    assert.equal(
      await page.locator("[data-placement-language]").inputValue(),
      "ko",
    );
    await page.locator("[data-placement-language]").selectOption("en");
    assert.equal(
      await page.getByRole("button", { name: "Undo", exact: true }).count(),
      1,
    );
    assert.deepEqual(errors, []);
    await page.close();
    results.push({ storage, koreanBrowserDefault: true, englishSwitch: true });
  }
  const report = {
    ok: true,
    origin,
    results,
    renderer: "real WebGL2/Wasm",
    gate: "opt-in",
  };
  await writeFile(
    resolve(artifact, "verification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  if (server) await new Promise((done) => server.close(done));
}
