#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright-core";
import { clickPlacementControl, showPlacementAssetPanel, showPlacementBottom, showPlacementInspector } from "./placement-panel-navigation.mjs";

const out = resolve("artifacts/physics-3d/aggregate-authoring/native-studio");
await mkdir(out, { recursive: true });
const root = resolve("apps/studio/dist"), modelBytes = await readFile("examples/data-scene-native/assets/rock.glb");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const contentId = sha(modelBytes), h = Math.sin(0.31) / Math.sqrt(2);
const body = { kind: "dynamic", elevation: 5, rotation: [h, 0, h, Math.cos(0.31)], renderOffset: [0.5, -0.25, 0.75],
  angularVelocity: [0.3, 0.4, 0.2], linearVelocity: [0.1, 0.05, -0.1], canSleep: false,
  collider: { shape: { type: "box", halfExtents: [0.5, 0.75, 1] }, friction: 0.4 } };
const document = { format: "ferrum2d.consumer.scene-authoring", version: 1,
  physics: { space: "spatial", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: 0.01 },
  sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: { instances: [{ id: "native_model", prefab: "object", x: 3, y: -4,
    props: { components: { visual: { kind: "primitive", shape: "circle", radius: 0.25 }, collider: { type: "none" }, layer: "wall", body } } }] } } },
  behaviorRecipes: { entities: {} }, spatial: {
    camera: { projection: "orthographic", position: { x: 12, y: -20, elevation: 18 }, target: { x: 3, y: -4, elevation: 6 }, height: 20, near: 0.1, far: 100 },
    terrain: [{ id: "floor", x: -10, y: -10, width: 20, depth: 20, elevation: 0, baseElevation: -1, castShadow: false }], billboards: {},
    models: { native_model: { asset: "native-rock", contentId, scale: 0.1, elevation: 1.5, yawDegrees: 37, castShadow: false } },
    environment: { lighting: { ambient: [0.7, 0.7, 0.7], lights: [] } } } };
const bootstrap = structuredClone(document); bootstrap.spatial.models = {}; bootstrap.spatial.billboards = { native_model: {} };
const fixtureBytes = Buffer.from(JSON.stringify(document)), bootstrapBytes = Buffer.from(JSON.stringify(bootstrap));
await writeFile(resolve(out, "native-model.scene-authoring.json"), fixtureBytes);
const served = new Map(), types = { ".html": "text/html", ".js": "application/javascript", ".wasm": "application/wasm", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer((request, response) => { void (async () => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/placement.garden.scene-authoring.json") { response.setHeader("Content-Type", "application/json"); response.end(bootstrapBytes); return; }
  if (url.pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
  const file = resolve(root, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  const bytes = await readFile(file); served.set(file, { bytes: bytes.length, sha256: sha(bytes) });
  response.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream"); response.end(bytes);
})().catch(() => response.writeHead(404).end()); });
const report = { format: "ferrum2d.native-authoring.studio-smoke", version: 1, status: "running", fixtureSha256: sha(fixtureBytes), modelSha256: contentId,
  scope: "Existing production Studio build; UI model import, native pose/selection/framing/ghost, elevation reset/history, local yaw, play/stop. Functional check, not a renderer performance gate." };
let browser, page, stage = "launch";
try {
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const options = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  if (process.env.FERRUM_BROWSER_EXECUTABLE) browser = await chromium.launch({ ...options, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE });
  else { try { browser = await chromium.launch({ ...options, channel: process.env.FERRUM_BROWSER_CHANNEL ?? "chrome" }); }
    catch (error) { if (process.env.FERRUM_BROWSER_CHANNEL) throw error; browser = await chromium.launch({ ...options, channel: "chromium" }); } }
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const wait = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 30000 });
  const paint = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const source = () => page.evaluate(() => window.ferrumPlacementSpatialExportDocument());
  const read = () => page.evaluate(() => {
    const state = window.ferrumPlacementViewerState, selected = state.instances.find(instance => instance.instanceId === "native_model");
    const draw = selected && window.ferrumEngine.dataSceneSpatialModelDrawSnapshot(selected.entity);
    return { body: state.selected?.body, runtime: window.ferrumPlacementSelectedRuntime, selection: window.ferrumPlacementSpatialSelection,
      matrix: draw && [...draw.transform], assetBounds: draw && [...draw.asset.bounds], visible: draw?.cameraVisible,
      frame: window.ferrumPlacementViewerRuntimeFrame, history: window.ferrumPlacementViewerHistory, patch: window.ferrumPlacementViewerExportPatch() };
  });
  stage = "bootstrap and real UI GLB import";
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await wait(() => window.ferrumPlacementViewerState?.instances.some(instance => instance.instanceId === "native_model") && window.ferrumPlacementViewerRuntimeFrame?.drawCalls > 0);
  await page.locator("[data-placement-language]").selectOption("en");
  await showPlacementAssetPanel(page, "model");
  await page.locator("[data-placement-model-key]:visible").fill("native-rock");
  await page.evaluate(() => { window.__nativeModelImported = false; window.addEventListener("ferrum-placement-model-import", () => { window.__nativeModelImported = true; }, { once: true }); });
  await page.locator("[data-placement-model-file]:visible").setInputFiles({ name: "native-rock.glb", mimeType: "model/gltf-binary", buffer: modelBytes });
  await wait(() => window.__nativeModelImported);
  await page.locator("[data-placement-document-file]").setInputFiles({ name: "native-model.scene-authoring.json", mimeType: "application/json", buffer: fixtureBytes });
  await wait(() => window.ferrumPlacementViewerState?.spatial?.models?.native_model && !document.querySelector(".demo-shell").inert && window.ferrumPlacementViewerRuntimeFrame?.spatial?.modelDraws === 1);
  if (await page.evaluate(() => window.ferrumPlacementWorkspaceMode !== "spatial")) await page.locator('[data-placement-mode="spatial"]').click();
  await page.evaluate(() => window.ferrumPlacementViewerSelect("native_model"));
  await showPlacementInspector(page, "properties");
  await page.locator("[data-placement-spatial-target]:visible").selectOption("model:native_model");
  await showPlacementBottom(page, "runtime");
  await wait(() => window.ferrumPlacementSelectedRuntime?.shapePhysics?.rotation?.length === 4 && window.ferrumPlacementSpatialSelection?.geometrySource === "authoring");
  report.initial = await read();
  const expectedPosition = [2.5, 5.25, 3.25];
  body.rotation.forEach((value, i) => assert(Math.abs(report.initial.runtime.shapePhysics.rotation[i] - value) < 0.000001));
  expectedPosition.forEach((value, i) => assert(Math.abs(report.initial.runtime.shapePhysics.position[i] - value) < 0.000001));
  assert.equal(report.initial.runtime.shapePhysics.colliderCount, 1);
  assert.equal(report.initial.frame.entityCount, 1); assert.equal(report.initial.frame.spatial.modelDraws, 1);
  assert(report.initial.frame.drawCalls > 0 && Number.isFinite(report.initial.frame.rustUpdateTimeMs));
  assert(report.initial.matrix.length === 16 && report.initial.matrix.every(Number.isFinite));
  stage = "authored eight-corner selection and framing";
  const authoredCorners = (bounds, matrix) => [bounds[0], bounds[3]].flatMap(x => [bounds[1], bounds[4]].flatMap(y => [bounds[2], bounds[5]].map(z => ({
    x: matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    elevation: matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    y: -(matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]),
  }))));
  report.eightCorners = authoredCorners(report.initial.assetBounds, report.initial.matrix);
  assert.equal(report.eightCorners.length, 8); assert(report.eightCorners.every(point => Object.values(point).every(Number.isFinite)));
  await clickPlacementControl(page, '[data-placement-spatial-frame="true"]'); await paint();
  report.framed = await read();
  const projected = await page.evaluate(points => points.map(point => window.ferrumPlacementSpatialProject(point)), report.eightCorners);
  assert(projected.every(point => point?.visible && Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.equal(report.framed.selection.geometrySource, "authoring"); assert.equal(report.framed.selection.bounds.length, 4);
  const rectangle = report.framed.selection.bounds;
  const expectedBounds = [Math.min(...projected.map(point => point.x)), Math.max(...projected.map(point => point.x)), Math.min(...projected.map(point => point.y)), Math.max(...projected.map(point => point.y))];
  const actualBounds = [Math.min(...rectangle.map(point => point.x)), Math.max(...rectangle.map(point => point.x)), Math.min(...rectangle.map(point => point.y)), Math.max(...rectangle.map(point => point.y))];
  expectedBounds.forEach((value, i) => assert(Math.abs(value - actualBounds[i]) < 0.05, "Selection must project all eight full-quaternion model bounds corners"));
  stage = "native model authoring ghost";
  await clickPlacementControl(page, "[data-placement-floor-controls]");
  await page.locator("[data-placement-ghost-floors]:visible").check();
  await page.locator('[data-placement-floor-visible="0"]:visible').uncheck();
  await wait(() => document.querySelectorAll(".placement-floor-ghosts polygon").length >= 2);
  report.ghost = await page.locator(".placement-floor-ghosts polygon").evaluateAll(nodes => nodes.map(node => node.getAttribute("points").trim().split(/\s+/).map(pair => pair.split(",").map(Number))));
  assert(report.ghost.every(points => points.length === 4 && points.flat().every(Number.isFinite)));
  const origin = report.framed.selection.canvas;
  assert(report.ghost.some(points => points.every((point, i) => Math.abs(point[0] - (rectangle[i].x - origin.left)) < 0.05 && Math.abs(point[1] - (rectangle[i].y - origin.top)) < 0.05)), "Ghost must use the same authored full-pose bounds as selection");
  await page.locator('[data-placement-floor-visible="0"]:visible').check(); await page.locator("[data-placement-ghost-floors]:visible").uncheck();
  await showPlacementInspector(page, "properties");
  const field = name => page.locator(`[data-placement-spatial-field="${name}"]:visible`);
  const edit = async (name, value) => { await field(name).fill(String(value)); await field(name).press("Tab"); await paint(); };
  const assertPreserved = authored => {
    const current = authored.sceneComposition.fragments.main.instances[0].props.components.body;
    for (const key of ["rotation", "renderOffset", "collider", "angularVelocity", "linearVelocity", "kind"]) assert.deepEqual(current[key], body[key], key);
  };
  stage = "native elevation edit and Reset to Original with Undo/Redo";
  await edit("elevation", 9);
  await wait(() => Math.abs((window.ferrumPlacementSelectedRuntime?.shapePhysics?.position[1] ?? 0) - 9.25) < 0.00001);
  report.elevationEdited = await read(); assert.equal(report.elevationEdited.body.elevation, 9); assertPreserved(await source()); assert(report.elevationEdited.patch);
  await page.locator('[data-placement-property-reset="spatial:elevation"]:visible').click(); await paint();
  await wait(() => window.ferrumPlacementViewerState.selected.body.elevation === 5);
  report.reset = await read(); assertPreserved(await source());
  await page.locator('[data-placement-action="undo"]').click(); await paint();
  await wait(() => window.ferrumPlacementViewerState.selected.body.elevation === 9);
  await page.locator('[data-placement-action="redo"]').click(); await paint();
  await wait(() => window.ferrumPlacementViewerState.selected.body.elevation === 5);
  stage = "model local yaw edit";
  await edit("yaw", 73); await wait(() => window.ferrumPlacementViewerState.spatial.models.native_model.yawDegrees === 73);
  report.yawEdited = await read(); const authored = await source(); assertPreserved(authored); assert.equal(authored.spatial.models.native_model.yawDegrees, 73);
  assert.equal(authored.sceneComposition.fragments.main.instances[0].props.components.body.elevation, 5);
  const stopped = report.yawEdited.runtime.shapePhysics;
  stage = "Play advances actual native quaternion and Stop restores authored pose";
  await page.locator('[data-placement-playback="play"]').click();
  await wait(before => window.ferrumPlacementSelectedRuntime?.mode === "game" && window.ferrumPlacementSelectedRuntime.shapePhysics.rotation.some((value, i) => Math.abs(value - before[i]) > 0.01), stopped.rotation);
  report.playing = await read(); assert.equal(report.playing.frame.spatial.modelDraws, 1); assert(Number.isFinite(report.playing.frame.rustUpdateTimeMs));
  await page.locator('[data-placement-playback="stop"]').click();
  await wait(before => window.ferrumPlacementSelectedRuntime?.mode !== "game" && window.ferrumPlacementSelectedRuntime.shapePhysics.rotation.every((value, i) => Math.abs(value - before[i]) < 0.000001), stopped.rotation);
  report.stopped = await read(); assert.deepEqual(await source(), authored);
  stopped.position.forEach((value, i) => assert(Math.abs(report.stopped.runtime.shapePhysics.position[i] - value) < 0.000001));
  assert.deepEqual(errors, []); await page.screenshot({ path: resolve(out, "native-model.png") });
  Object.assign(report, { status: "passed", browser: browser.version(), errors });
} catch (error) {
  Object.assign(report, { status: "failed", stage, error: String(error), stack: error.stack });
  await page?.screenshot({ path: resolve(out, "failure.png") }).catch(() => {}); throw error;
} finally {
  report.servedInputs = Object.fromEntries(served); report.sourceSha256 = sha(await readFile("tests/smoke/native-authoring-studio-smoke.mjs"));
  await writeFile(resolve(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await browser?.close(); await new Promise(done => server.close(done));
}
console.log(JSON.stringify({ status: report.status, browser: report.browser, sourceSha256: report.sourceSha256, fixtureSha256: report.fixtureSha256, modelSha256: report.modelSha256, report: resolve(out, "report.json") }));
