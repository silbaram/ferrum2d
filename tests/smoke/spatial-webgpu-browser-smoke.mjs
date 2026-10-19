import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, writeFile, cp } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { runReleaseCommand } from "./github-release-command.mjs";
import { installSpatialGpuTarget } from "./spatial-webgpu-capture.mjs";
const { chromium } = await import(process.env.FERRUM_PLAYWRIGHT_MODULE ?? "playwright-core");
const root = resolve("."),
  parent = resolve(
    root,
    process.env.FERRUM_SPATIAL_WEBGPU_ARTIFACT_PARENT ??
      "artifacts/hd2d-static-model/spatial-webgpu",
  );
await mkdir(parent, { recursive: true });
const output = await mkdtemp(resolve(parent, "run-"));
if (process.env.FERRUM_SPATIAL_WEBGPU_PREPARED_PACKAGE) {
  await cp(process.env.FERRUM_SPATIAL_WEBGPU_PREPARED_PACKAGE, resolve(output, "package"), {
    recursive: true,
  });
} else {
  await runReleaseCommand("pnpm", ["pack", "--pack-destination", output], {
    cwd: resolve(root, "packages/ferrum-web"),
  });
  const tgz = (await readdir(output)).find((name) => name.endsWith(".tgz"));
  assert(tgz);
  await runReleaseCommand("tar", ["-xzf", resolve(output, tgz), "-C", output]);
}
const shadowsOnly = process.argv.includes("--shadows-only");
const environmentOnly = process.argv.includes("--environment-only");
const fallbackOnly = process.argv.includes("--fallback-only"),
  modelsOnly = process.argv.includes("--models-only"),
  offscreen = process.argv.includes("--offscreen-target");
const html = `<!doctype html><style>html,body,canvas{margin:0;display:block;width:100%;height:100%}</style><script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/package/dist/core.js","@ferrum2d/ferrum-web/authoring":"/package/dist/authoring.js","@ferrum2d/ferrum-web/labs":"/package/dist/labs.js"}}</script><script type="module">import{probeSpatialWebGpu,probeSpatialFallbacks}from'/fixture.mjs';import{probeSpatialWebGpuModels}from'/models.mjs';window.probeSpatialWebGpu=probeSpatialWebGpu;window.probeSpatialFallbacks=probeSpatialFallbacks;window.probeSpatialWebGpuModels=probeSpatialWebGpuModels;import{probeSpatialWebGpuEnvironment}from'/environment.mjs';window.probeSpatialWebGpuEnvironment=probeSpatialWebGpuEnvironment;import{probeSpatialWebGpuShadows}from'/shadows.mjs';window.probeSpatialWebGpuShadows=probeSpatialWebGpuShadows;</script>`;
const server = createServer((req, res) => {
  void (async () => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    if (path === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(html);
      return;
    }
    const fixture =
      path === "/fixture.mjs"
        ? "tests/smoke/spatial-webgpu-browser-fixture.mjs"
        : path === "/shadows.mjs"
          ? "tests/smoke/spatial-webgpu-shadow-browser-fixture.mjs"
          : path === "/environment.mjs"
            ? "tests/smoke/spatial-webgpu-environment-browser-fixture.mjs"
            : path === "/models.mjs"
              ? "tests/smoke/spatial-webgpu-model-browser-fixture.mjs"
              : ["/rock.glb", "/tree.glb", "/tree-material.glb", "/building.glb"].includes(path)
                ? `examples/data-scene-native/assets${path}`
                : undefined;
    const file = fixture ? resolve(root, fixture) : resolve(output, "." + decodeURIComponent(path));
    if (
      !fixture &&
      (!file.startsWith(resolve(output, "package") + sep) || !/\.(js|wasm)$/.test(file))
    ) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      file.endsWith(".wasm")
        ? "application/wasm"
        : file.endsWith(".glb")
          ? "model/gltf-binary"
          : "application/javascript",
    );
    res.end(await readFile(file));
  })().catch(() => res.writeHead(404).end());
});
const report = {
  format: "ferrum2d.spatial-webgpu.smoke",
  version: 1,
  status: "running",
  presentation: offscreen ? "offscreen" : "canvas",
  mode: shadowsOnly
    ? "shadows-only"
    : environmentOnly
      ? "environment-only"
      : fallbackOnly
        ? "fallback-only"
        : modelsOnly
          ? "models-only"
          : "full",
  cases: [],
  modelCases: [],
  environmentCases: [],
  shadowCases: [],
  fallbackCases: [],
  wasmSha256: createHash("sha256")
    .update(await readFile(resolve(output, "package/pkg/ferrum_core_bg.wasm")))
    .digest("hex"),
};
let browser;
try {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const options = {
    headless: true,
    args:
      process.platform === "win32"
        ? ["--no-sandbox"]
        : ["--no-sandbox", "--enable-unsafe-webgpu", "--use-vulkan=swiftshader"],
  };
  browser = process.env.FERRUM_BROWSER_EXECUTABLE
    ? await chromium.launch({ ...options, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE })
    : await chromium.launch(options);
  report.browser = browser.version();
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ])
    for (const deviceScaleFactor of [1, 2]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor });
      const errors = [];
      let bootReject;
      const bootFailure = new Promise((_resolve, reject) => (bootReject = reject));
      page.on("console", (m) => {
        if (
          m.type() === "error" ||
          m.text().startsWith("environment state") ||
          m.text().startsWith("shadow state")
        )
          console.log(m.type(), m.text());
      });
      page.on("pageerror", (error) => {
        errors.push(String(error));
        bootReject(error);
      });
      page.setDefaultTimeout(60000);
      if (offscreen) await page.addInitScript(installSpatialGpuTarget);
      try {
        report.activeCase = { viewport, deviceScaleFactor };
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await Promise.race([page.waitForFunction(() => window.probeSpatialWebGpu), bootFailure]);
        const result =
          fallbackOnly || modelsOnly || environmentOnly || shadowsOnly
            ? []
            : await page.evaluate(() => window.probeSpatialWebGpu());
        assert.equal(
          result.length,
          fallbackOnly || modelsOnly || environmentOnly || shadowsOnly ? 0 : 2,
        );
        assert.deepEqual(errors, []);
        for (const entry of result)
          for (const backend of entry.backends) {
            assert(
              backend.restored &&
                backend.reversed &&
                backend.picked === "bridge" &&
                backend.warmTerrainUpload === 0 &&
                backend.errors.length === 0,
            );
            const file = `${backend.backend}-${entry.projection}-${viewport.width}x${viewport.height}-dpr${deviceScaleFactor}.png`;
            await writeFile(
              resolve(output, file),
              Buffer.from(backend.image.split(",")[1], "base64"),
            );
            backend.image = file;
          }
        if (!fallbackOnly && !environmentOnly && !shadowsOnly) {
          const models = await page.evaluate(() => window.probeSpatialWebGpuModels());
          assert.equal(models.length, 2);
          assert.deepEqual(errors, []);
          for (const entry of models)
            for (const backend of entry.backends) {
              assert(
                backend.restored &&
                  backend.reversed &&
                  backend.stats.modelDrawCalls === 11 &&
                  backend.stats.modelInstancedDrawCalls === 2 &&
                  backend.errors.length === 0,
              );
              const file = `models-${backend.backend}-${entry.projection}-${viewport.width}x${viewport.height}-dpr${deviceScaleFactor}.png`;
              await writeFile(
                resolve(output, file),
                Buffer.from(backend.image.split(",")[1], "base64"),
              );
              backend.image = file;
            }
          report.modelCases.push({ viewport, deviceScaleFactor, result: models });
        }
        if (!fallbackOnly && !modelsOnly && !shadowsOnly) {
          const environment = await page.evaluate(() => window.probeSpatialWebGpuEnvironment());
          assert.equal(environment.length, 2);
          assert.deepEqual(errors, []);
          for (const entry of environment) {
            assert.equal(entry.comparisons.length, 16);
            for (const backend of entry.backends) {
              assert(backend.restored && backend.errors.length === 0);
              assert.equal(backend.rows.length, 16);
              for (const row of backend.rows) {
                const file = `environment-${row.name}-${backend.backend}-${entry.projection}-${viewport.width}x${viewport.height}-dpr${deviceScaleFactor}.png`;
                await writeFile(
                  resolve(output, file),
                  Buffer.from(row.image.split(",")[1], "base64"),
                );
                row.image = file;
              }
            }
          }
          report.environmentCases.push({ viewport, deviceScaleFactor, result: environment });
        }
        if (!fallbackOnly && !modelsOnly && !environmentOnly) {
          const shadows = await page.evaluate(() => window.probeSpatialWebGpuShadows());
          assert.equal(shadows.length, 2);
          assert.deepEqual(errors, []);
          for (const entry of shadows) {
            assert.equal(entry.comparisons.length, 19);
            for (const backend of entry.backends) {
              assert(backend.restored && backend.errors.length === 0);
              assert.equal(backend.rows.length, 19);
              for (const row of backend.rows) {
                const file = `shadow-${row.name}-${backend.backend}-${entry.projection}-${viewport.width}x${viewport.height}-dpr${deviceScaleFactor}.png`;
                await writeFile(
                  resolve(output, file),
                  Buffer.from(row.image.split(",")[1], "base64"),
                );
                row.image = file;
              }
            }
          }
          report.shadowCases.push({ viewport, deviceScaleFactor, result: shadows });
        }
        const fallback = await page.evaluate(() => window.probeSpatialFallbacks());
        assert.equal(fallback.length, 4);
        assert.deepEqual(errors, []);
        report.fallbackCases.push({ viewport, deviceScaleFactor, result: fallback });
        report.cases.push({ viewport, deviceScaleFactor, result });
        delete report.activeCase;
        console.log(
          JSON.stringify({
            viewport,
            deviceScaleFactor,
            comparisons: result.map((r) => ({
              projection: r.projection,
              differentPixels: r.differentPixels,
              pixels: r.pixelCount,
            })),
          }),
        );
      } finally {
        await page.close();
      }
    }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error?.stack ?? error);
  throw error;
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Spatial WebGPU report: ${resolve(output, "report.json")}`);
}
