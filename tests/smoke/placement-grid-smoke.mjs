import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright-core";
import { clickPlacementControl, showPlacementInspector, showPlacementViewOptions } from "./placement-panel-navigation.mjs";
const artifact = resolve("artifacts/viewport-grid");
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
try {
  for (const mode of ["2d", "spatial"])
    for (const dpr of [1, 2]) {
      const page = await browser.newPage({
          viewport: { width: 1280, height: 900 },
          deviceScaleFactor: dpr,
        }),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        const buffers = new Set();
        const prototype = WebGL2RenderingContext.prototype;
        const create = prototype.createBuffer,
          destroy = prototype.deleteBuffer;
        prototype.createBuffer = function () {
          const buffer = create.call(this);
          if (buffer) buffers.add(buffer);
          return buffer;
        };
        prototype.deleteBuffer = function (buffer) {
          buffers.delete(buffer);
          return destroy.call(this, buffer);
        };
        window.__gridLiveBuffers = () => buffers.size;
      });
      try {
        await page.goto(origin + (mode === "spatial" ? "/?scene=hd2d" : "/"));
        await page.waitForFunction(
          () =>
            window.ferrumPlacementGrid?.lineCount > 0 &&
            window.ferrumPlacementViewerRuntimeFrame?.drawCalls > 0,
        );
        const grid = page.getByRole("checkbox", {
            name: "Show grid",
            exact: true,
          }),
          size = page.getByRole("spinbutton", {
            name: "Grid size",
            exact: true,
          });
        const documentBefore = await page.evaluate(() =>
          JSON.stringify(window.ferrumPlacementSpatialExportDocument()),
        );
        const history = await page.evaluate(
          () => window.ferrumPlacementViewerHistory.undoCount,
        );
        const on = await page.evaluate(() => ({
          grid: window.ferrumPlacementGrid,
          drawCalls: window.ferrumPlacementViewerRuntimeFrame.drawCalls,
        }));
        assert(on.grid.lineCount <= 512);
        assert.equal(on.grid.mode, mode);
        await showPlacementViewOptions(page);
        await grid.uncheck();
        await page.waitForFunction(
          () => window.ferrumPlacementGrid.lineCount === 0,
        );
        const off = await page.evaluate(() => ({
          grid: window.ferrumPlacementGrid,
          drawCalls: window.ferrumPlacementViewerRuntimeFrame.drawCalls,
        }));
        assert.equal(on.drawCalls - off.drawCalls, 1);
        await page.evaluate(() => {
          const c = document.querySelector("canvas.demo-canvas"),
            gl = c.getContext("webgl2"),
            data = new Uint8Array(c.width * c.height * 4);
          gl.readPixels(
            0,
            0,
            c.width,
            c.height,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            data,
          );
          window.__gridPixels = data;
        });
        await showPlacementViewOptions(page);
        await grid.check();
        await page.waitForFunction(
          () => window.ferrumPlacementGrid.lineCount > 0,
        );
        const changedPixels = await page.evaluate(() => {
          const c = document.querySelector("canvas.demo-canvas"),
            gl = c.getContext("webgl2"),
            data = new Uint8Array(c.width * c.height * 4);
          gl.readPixels(
            0,
            0,
            c.width,
            c.height,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            data,
          );
          let count = 0;
          for (let i = 0; i < data.length; i += 4)
            if (
              data[i] !== window.__gridPixels[i] ||
              data[i + 1] !== window.__gridPixels[i + 1] ||
              data[i + 2] !== window.__gridPixels[i + 2]
            )
              count++;
          return count;
        });
        assert(changedPixels > 500);
        await showPlacementViewOptions(page);
        await size.fill("32");
        await size.press("Tab");
        await page.waitForFunction(
          () => window.ferrumPlacementGrid.spacing >= 32,
        );
        await showPlacementViewOptions(page);
        await size.fill("16");
        await size.press("Tab");
        await page.waitForFunction(
          () => window.ferrumPlacementGrid.spacing === 16,
        );
        if (mode === "spatial") {
          const pixelAt = (point) =>
            page.evaluate((point) => {
              const p = window.ferrumPlacementSpatialProject(point),
                c = document.querySelector("canvas.demo-canvas"),
                r = c.getBoundingClientRect(),
                gl = c.getContext("webgl2"),
                x = Math.round(((p.x - r.left) * c.width) / r.width),
                y =
                  c.height -
                  1 -
                  Math.round(((p.y - r.top) * c.height) / r.height),
                bytes = new Uint8Array(36);
              gl.readPixels(
                Math.max(0, x - 1),
                Math.max(0, y - 1),
                3,
                3,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                bytes,
              );
              return [...bytes];
            }, point);
          const hiddenPoint = { x: 16, y: 125, elevation: 0 },
            spritePoint = { x: -48, y: -6, elevation: 0 },
            exposedPoint = { x: 16, y: -40, elevation: 0 };
          const hiddenOn = await pixelAt(hiddenPoint),
            spriteOn = await pixelAt(spritePoint),
            exposedOn = await pixelAt(exposedPoint);
          await showPlacementViewOptions(page);
          await grid.uncheck();
          await page.waitForFunction(
            () => window.ferrumPlacementGrid.lineCount === 0,
          );
          assert.deepEqual(
            await pixelAt(hiddenPoint),
            hiddenOn,
            "ground grid must not show through bridge",
          );
          assert.deepEqual(
            await pixelAt(spritePoint),
            spriteOn,
            "grid must not show through billboard",
          );
          assert.notDeepEqual(
            await pixelAt(exposedPoint),
            exposedOn,
            "exposed world grid line must change framebuffer pixels",
          );
          const snap = page.getByRole("checkbox", {
            name: "Spatial grid snap",
            exact: true,
          });
          await snap.check();
          await showPlacementViewOptions(page);
          assert.equal(await grid.isChecked(), false);
          await snap.uncheck();
          await showPlacementViewOptions(page);
          await grid.check();
          await page.waitForFunction(
            () => window.ferrumPlacementGrid.lineCount > 0,
          );
          const before = await page.evaluate(
            () => window.ferrumPlacementGrid.lineCount,
          );
          await showPlacementViewOptions(page);
          await page.getByRole("checkbox", { name: "Terrain height grid", exact: true }).check();
          await page.waitForFunction(n => window.ferrumPlacementGrid.lineCount > n, before);
          const withTerrain = await page.evaluate(() => window.ferrumPlacementGrid.lineCount);
          await page
            .getByRole("button", { name: "Floors", exact: true })
            .click();
          await page.locator('[data-placement-floor-visible="1"]').uncheck();
          await page.waitForFunction(
            (n) => window.ferrumPlacementGrid.lineCount < n,
            withTerrain,
          );
          await page.locator('[data-placement-floor-visible="1"]').check();
          await showPlacementViewOptions(page);
          await page
            .getByRole("checkbox", { name: "Show Proxy Overlay", exact: true })
            .check();
          await page.waitForFunction(
            () =>
              window.ferrumPlacementViewerRuntimeFrame.spatial.debugVertices >
                0 && window.ferrumPlacementGrid.lineCount > 0,
          );
          await showPlacementViewOptions(page);
          await page
            .getByRole("checkbox", { name: "Show Proxy Overlay", exact: true })
            .uncheck();
          await clickPlacementControl(page, "[data-placement-spatial-camera=left]");
          await clickPlacementControl(page, "[data-placement-spatial-camera=in]");
          await page.waitForFunction(
            () => window.ferrumPlacementGrid.lineCount > 0,
          );
        } else {
          await page
            .locator('[data-placement-selection-action="clear"]')
            .click();
          await showPlacementInspector(page);
          await showPlacementViewOptions(page);
          await grid.uncheck();
          const snap = page.locator("[data-placement-snap-toggle]:visible");
          await snap.check();
          await showPlacementViewOptions(page);
          assert.equal(await grid.isChecked(), false);
          await snap.uncheck();
          await showPlacementViewOptions(page);
          await grid.check();
          await page.locator("canvas.demo-canvas").focus();
          const beforePan = await page.evaluate(() => ({
            ...window.ferrumPlacementEditCamera,
          }));
          const canvas = await page.locator("canvas.demo-canvas").boundingBox();
          await page.mouse.move(
            canvas.x + canvas.width / 2,
            canvas.y + canvas.height / 2,
          );
          await page.keyboard.down("Space");
          await page.mouse.down();
          await page.mouse.move(
            canvas.x + canvas.width / 2 + 60,
            canvas.y + canvas.height / 2 + 30,
            { steps: 4 },
          );
          await page.mouse.up();
          await page.keyboard.up("Space");
          await page.waitForFunction(
            (before) =>
              window.ferrumPlacementGrid.lineCount > 0 &&
              (window.ferrumPlacementEditCamera.x !== before.x ||
                window.ferrumPlacementEditCamera.y !== before.y),
            beforePan,
          );
          await clickPlacementControl(page, "[data-placement-view-action=zoom-out]");
          await clickPlacementControl(page, "[data-placement-view-action=fit-scene]");
          await clickPlacementControl(page, "[data-placement-view-action=reset-view]");
        }
        await page.setViewportSize({ width: 1000, height: 760 });
        await page.waitForFunction(
          () =>
            window.ferrumPlacementGrid.lineCount > 0 &&
            window.ferrumPlacementGrid.lineCount <= 512,
        );
        assert.equal(
          await page.evaluate(() =>
            JSON.stringify(window.ferrumPlacementSpatialExportDocument()),
          ),
          documentBefore,
        );
        assert.equal(
          await page.evaluate(
            () => window.ferrumPlacementViewerHistory.undoCount,
          ),
          history,
        );
        await page
          .getByRole("button", { name: "Game Preview", exact: true })
          .click();
        await page.waitForFunction(
          () =>
            window.ferrumPlacementWorkspaceMode === "game" &&
            window.ferrumPlacementGrid.lineCount === 0,
        );
        assert.equal(await grid.isVisible(), false);
        await page.getByRole("button", { name: "Stop", exact: true }).click();
        await page.waitForFunction(
          () =>
            window.ferrumPlacementWorkspaceMode !== "game" &&
            window.ferrumPlacementGrid.lineCount > 0,
        );
        await page.screenshot({
          path: resolve(artifact, `${mode}-dpr${dpr}.png`),
          fullPage: true,
        });
        assert.deepEqual(errors, []);
        await page.evaluate(() =>
          window.dispatchEvent(
            new PageTransitionEvent("pagehide", { persisted: false }),
          ),
        );
        assert.equal(
          await page.evaluate(() => window.ferrumPlacementGrid),
          undefined,
          "page teardown must release grid resources",
        );
        await page.waitForFunction(() => window.__gridLiveBuffers() === 0);
        results.push({
          mode,
          dpr,
          changedPixels,
          lineCount: on.grid.lineCount,
          extraDrawCalls: on.drawCalls - off.drawCalls,
          snapIndependent: true,
          historyUnchanged: true,
          modeRestored: true,
          teardown: true,
          gpuBuffersReleased: true,
          depthTest: on.grid.depthTest,
          ...(mode === "spatial"
            ? {
                floorFilter: true,
                proxyOverlay: true,
                bridgeAndSpriteOcclusion: true,
              }
            : { panZoomAndFrame: true }),
        });
      } catch (error) {
        await page
          .screenshot({
            path: resolve(artifact, "failure.png"),
            fullPage: true,
          })
          .catch(() => {});
        throw error;
      } finally {
        await page.close();
      }
    }
  // Perspective and terrain-free fallback use the same renderer path as authored documents.
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const extraErrors = [];
  page.on("pageerror", (e) => extraErrors.push(e.message));
  await page.goto(origin + "/?scene=hd2d");
  await page.waitForFunction(() => window.ferrumPlacementGrid?.lineCount > 0);
  const source = JSON.parse(
    await readFile(
      "apps/placement-viewer/public/placement.hd2d.scene-authoring.json",
      "utf8",
    ),
  );
  source.spatial.camera = {
    projection: "perspective",
    position: { x: 160, y: -240, elevation: 220 },
    target: { x: 0, y: 25, elevation: 0 },
    fovDegrees: 55,
    near: 0.1,
    far: 2000,
  };
  await page.locator("[data-placement-document-file]").setInputFiles({
    name: "perspective-grid.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await page.waitForFunction(
    () =>
      window.ferrumPlacementWorkspaceMode === "spatial" &&
      window.ferrumPlacementSpatialCamera?.projection === "perspective" &&
      window.ferrumPlacementSpatialExportDocument().spatial.camera
        .projection === "perspective" &&
      window.ferrumPlacementGrid.lineCount > 0,
  );
  source.spatial.terrain = [];
  await page.locator("[data-placement-document-file]").setInputFiles({
    name: "reference-grid.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await page.waitForFunction(
    () =>
      window.ferrumPlacementGrid?.referencePlane === true &&
      window.ferrumPlacementGrid.lineCount > 0,
  );
  assert.deepEqual(extraErrors, []);
  await page.close();
  const report = {
    ok: true,
    origin,
    results,
    perspective: true,
    referencePlane: true,
    backend: "official app WebGL2; public engine/Wasm ABI unchanged",
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
