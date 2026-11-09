// Capture the real production examples; no fixtures or simulated game screens.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { loadExampleCatalog } from "../validate/check-example-catalog.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(root, "docs/development/quality/screenshots");
const artifacts = resolve(root, "artifacts/readme-refresh");
const onlyShooter = process.argv.includes("--only=topdown-shooter");
const onlyGuided = process.argv.includes("--only=guided-examples");
const onlySuite = process.argv.includes("--only=example-suite");
const onlyLab = process.argv.includes("--only=feature-lab");
const featureCount = JSON.parse(await readFile(resolve(root,"examples/shared/featureCatalog.json"),"utf8")).length;
const physicsCount = JSON.parse(await readFile(resolve(root,"examples/shared/physicsExamples.json"),"utf8")).length;
const suiteBuild = onlySuite || onlyLab;
const guidedExamples = ["breakout", "platformer", "physics-sandbox"];
const routes = new Map([
  ...loadExampleCatalog(root).filter(item => item.kind !== "reference").map(item => [item.id,
    resolve(root, suiteBuild ? `dist-pages/${item.id}` : item.source)]),
  ...(suiteBuild ? [["examples", resolve(root, "dist-pages")]] : []),
]);
for (const [name, dir] of routes) {
  if (onlyLab ? ["starter-runtime", "examples"].includes(name) : onlyShooter ? name === "topdown-shooter" : onlyGuided ? guidedExamples.includes(name) : true) await readFile(resolve(dir, "index.html"));
}
await mkdir(output, { recursive: true });
await mkdir(artifacts, { recursive: true });
const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "application/javascript", ".woff2": "font/woff2", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".glb": "model/gltf-binary", ".wav": "audio/wav", ".ogg": "audio/ogg" };
const server = createServer(async (req, res) => {
  try {
    const parts = decodeURIComponent(new URL(req.url, "http://localhost").pathname).split("/");
    const base = routes.get(parts[1]);
    assert(base);
    const relative = parts.slice(2).join("/");
    const file = resolve(base, !relative || relative.endsWith("/") ? relative + "index.html" : relative);
    assert(file.startsWith(base + sep));
    const bytes = await readFile(file);
    res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
let browser;
const report = {
  capturedAt: new Date().toISOString(),
  sourceNote: "Production builds from the current working tree; sourceCommit is the base commit.",
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1,
  renderer: "WebGL2 / Chromium SwiftShader", screenshots: [],
};
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE,
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: report.viewport, deviceScaleFactor: 1, locale: "ko-KR" });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const exampleOrigin = suiteBuild ? `${origin}/examples` : origin;
  const errors = [];
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const paint = () => page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
  const capture = async (name, locator, evidence) => {
    await paint();
    assert.deepEqual(errors, [], "Examples must render without browser errors");
    const bytes = await locator.screenshot({ path: resolve(output, name) });
    report.screenshots.push({ name, route: page.url().replace(origin, ""), bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), ...evidence });
    console.log(`Captured ${name} (${bytes.length} bytes)`);
  };
  if (suiteBuild) {
    await page.goto(`${origin}/examples/`);
    await page.waitForFunction(total => document.querySelector('[data-feature-count]')?.textContent.includes(`${total} / ${total}`),featureCount+physicsCount);
    await capture("example-hub.png", page, { mode: "example-hub", features: featureCount, physics: physicsCount, experiments: featureCount+physicsCount });
    await page.goto(`${origin}/examples/starter-runtime/?feature=nine-slice`);
    await page.waitForFunction(() => window.ferrumFeatureLab?.snapshot().commands > 0);
    await page.locator('[data-control=pause]').click();
    await capture("engine-feature-lab.png", page.locator("body"), await page.evaluate(() => window.ferrumFeatureLab.snapshot()));
    if (onlySuite) {
      await page.goto(`${origin}/examples/pixel-art/`);
      await page.waitForFunction(() => window.ferrumPixelShowcase?.snapshot().commands >= 240);
      await page.locator('#pixel-pause').click();
      await capture("pixel-art-demo.png", page.locator("body"), await page.evaluate(() => window.ferrumPixelShowcase.snapshot()));
    }
  }
  for (const scene of onlyShooter || onlyGuided || suiteBuild ? [] : ["village", "garden"]) {
    const source = JSON.parse(await readFile(resolve(routes.get("placement-viewer"), `placement.${scene}.scene-authoring.json`), "utf8"));
    const count = Object.values(source.sceneComposition.fragments).reduce((sum, fragment) => sum + fragment.instances.length, 0);
    console.log(`Opening ${scene}: ${count} authored objects`);
    await page.goto(`${origin}/placement-viewer/?scene=${scene}`);
    await page.waitForFunction(expected => window.ferrumPlacementViewerState?.instances.length === expected &&
      window.ferrumPlacementViewerRuntimeFrame?.entityCount > 0, count, { timeout: 60000 });
    await page.locator("[data-placement-language]").selectOption("ko");
    if (scene === "village") {
      await page.waitForFunction(() => window.ferrumPlacementViewerRuntimeFrame?.spatial?.modelDraws >= 30, null, { timeout: 60000 });
      await capture("placement-village.png", page.locator("body"), await page.evaluate(() => ({
        mode: window.ferrumPlacementWorkspaceMode, frame: window.ferrumPlacementViewerRuntimeFrame,
      })));
    }
    await page.locator("[data-placement-playback=play]").click();
    await page.waitForFunction(() => window.ferrumPlacementWorkspaceMode === "game" && window.ferrumEngine.dataSceneState() === "playing");
    await page.locator("[data-placement-playback=pause]").click();
    await page.waitForFunction(() => window.ferrumEngine.dataSceneState() === "paused");
    await capture(`${scene}-game-preview.png`, page.locator("canvas.demo-canvas"), await page.evaluate(() => ({
      mode: window.ferrumPlacementWorkspaceMode, gameState: window.ferrumEngine.dataSceneState(),
      frame: window.ferrumPlacementViewerRuntimeFrame,
    })));
  }
  if (!onlyGuided && !onlyLab) {
  await page.goto(`${exampleOrigin}/topdown-shooter/?preserveDrawingBuffer=true`);
  await page.waitForFunction(() => window.ferrumEngine?.gameState() === 0 && window.ferrumRuntime.renderer.stats().drawCalls > 0);
  await capture("topdown-shooter-title.png", page.locator("body"), { gameState: "title" });
  await page.locator("[data-action=start]").click();
  await page.waitForFunction(() => window.ferrumEngine.gameState() === 1 && window.ferrumEngine.entityCount() > 3);
  const startedAt = await page.evaluate(() => window.ferrumEngine.time());
  await page.waitForFunction(start => window.ferrumEngine.time() >= start + 3, startedAt);
  const box = await page.locator("canvas").boundingBox();
  await page.mouse.move(box.x + box.width * .75, box.y + box.height * .4);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.ferrumEngine.gameState()), 1);
  await capture("topdown-shooter-gameplay.png", page.locator("body"), await page.evaluate(() => ({
    gameState: "playing", timeSeconds: window.ferrumEngine.time(), entities: window.ferrumEngine.entityCount(), stats: window.ferrumRuntime.renderer.stats(),
  })));
  }
  for (const id of onlyShooter || onlyLab ? [] : guidedExamples) {
    await page.goto(`${exampleOrigin}/${id}/?preserveDrawingBuffer=true`);
    await page.waitForFunction(() => window.ferrumEngine && window.ferrumRuntime.renderer.stats().drawCalls > 0 &&
      (document.querySelector(".demo-shell")?.dataset.playback === "playing" || window.ferrumPhysicsSandboxSmokeFrame?.frameCount > 1));
    if (id === "physics-sandbox") await page.getByRole("button", { name: "일시정지", exact: true }).click();
    else await page.locator("[data-demo-control=pause]").click();
    await capture(id === "physics-sandbox" ? "physics-lab.png" : `${id}-demo.png`, page.locator("body"), await page.evaluate(() => ({
      paused: true,
      nativeState: window.ferrumEngine.gameState(),
      entities: window.ferrumEngine.entityCount(),
      camera: { x: window.ferrumEngine.cameraX(), y: window.ferrumEngine.cameraY() },
      viewport: window.ferrumRuntime.renderer.viewportSize(),
      stats: window.ferrumRuntime.renderer.stats(),
    })));
  }
  report.errors = errors;
  await writeFile(resolve(artifacts, "capture.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(resolve(artifacts, onlyLab ? "capture-feature-lab.json" : onlySuite ? "capture-suite.json" : onlyGuided ? "capture-guided.json" : onlyShooter ? "capture-topdown.json" : "capture-all.json"), JSON.stringify(report, null, 2) + "\n");
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
