#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright-core";
import { clickPlacementControl, showPlacementAssetPanel, showPlacementBottom, showPlacementInspector } from "./placement-panel-navigation.mjs";

// Build the opt-in QA host separately: VITE_FERRUM_STUDIO_SAVE=true vite build --outDir <artifact>.
// This runner never rebuilds or changes product output. Its save host writes only evidence here.
const out = resolve("artifacts/physics-3d/goal-closure/studio-native-authoring/browser");
const root = resolve(process.env.FERRUM_NATIVE_TEMPLATE_STUDIO_ROOT ?? "apps/studio/dist");
const fixturePath = resolve("tests/fixtures/placement.native-templates.scene-authoring.json");
const fixtureBytes = await readFile(fixturePath), fixture = JSON.parse(fixtureBytes);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";
await mkdir(out, { recursive: true });
await writeFile(resolve(out, "fixture.scene-authoring.json"), fixtureBytes);

function assertAuthored(document) {
  assert.deepEqual(document.componentTemplates, fixture.componentTemplates, "Keep the authored root catalog exact");
  assert.deepEqual(document.sceneComposition.prefabs, fixture.sceneComposition.prefabs, "Keep raw prefab template references");
  assert.deepEqual(document.physics, fixture.physics, "Keep authored joint and graphical tile references");
  assert.deepEqual(document.behaviorRecipes, fixture.behaviorRecipes);
  for (const instance of document.sceneComposition.fragments.main.instances) {
    const original = fixture.sceneComposition.fragments.main.instances.find(item => item.id === instance.id);
    assert(original);
    assert.deepEqual(instance.props, original.props, "Do not detach shared components into instance props");
  }
}
assertAuthored(fixture);
assert.equal(fixture.sceneComposition.fragments.main.instances.length, 3);
assert.equal(Object.keys(fixture.physics.joints).length, 1);
let persisted = structuredClone(fixture);
const served = new Map(), saveRequests = [], hostErrors = [];
const types = { ".html": "text/html", ".js": "application/javascript", ".wasm": "application/wasm", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer((request, response) => { void (async () => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/__ferrum-placement-save" && request.method === "POST") {
    const chunks = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) throw new Error("Fixture save exceeds the existing scene host limit");
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks));
    assert.deepEqual(body.expectedDocument, persisted, "The Studio save must compare the original source snapshot");
    assertAuthored(body.document);
    const next = structuredClone(body.document);
    await writeFile(resolve(out, "saved-scene-authoring.json"), json(next));
    saveRequests.push({ expectedSha256: sha(json(body.expectedDocument)), savedSha256: sha(json(next)), bytes: size });
    persisted = next;
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ saved: true, document: persisted })); return;
  }
  if (url.pathname === "/placement.garden.scene-authoring.json") {
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(persisted)); return;
  }
  if (url.pathname === "/placement-scenes.json") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ version: 1, scenes: [{ relativePath: "placement.garden.scene-authoring.json", mode: "2d" }], truncated: false })); return;
  }
  if (url.pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
  const file = resolve(root, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  const bytes = await readFile(file); served.set(file, { bytes: bytes.length, sha256: sha(bytes) });
  response.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream"); response.end(bytes);
})().catch(error => {
  if (request.url?.startsWith("/__ferrum-placement-save")) hostErrors.push(String(error));
  response.writeHead(request.url?.startsWith("/__ferrum-placement-save") ? 400 : 404).end(String(error));
}); });
const report = { format: "ferrum2d.native-template.studio-smoke", version: 1, status: "running", root,
  fixtureSha256: sha(fixtureBytes),
  scope: "Production Studio code in a separate opt-in QA build: paused 2D, public native body/controller/joint rows, picking/transform/history, shared read-only components, export/save, asset evidence, graphical tile commands and Play/Stop. Functional fixture with draw-call sanity bounds; no general performance or default save-authority claim." };
let browser, page, stage = "public SDK layouts";
try {
  const sdkRoot = new URL("../../apps/studio/node_modules/@ferrum2d/ferrum-web/", import.meta.url);
  const sdkPackage = JSON.parse(await readFile(new URL("package.json", sdkRoot)));
  const sdk = await import(new URL(sdkPackage.exports["./core"].import, sdkRoot).href);
  const layouts = { body: sdk.UNIFIED_PHYSICS_STATE_LAYOUT, character: sdk.UNIFIED_PHYSICS_CHARACTER_LAYOUT, joint: sdk.UNIFIED_PHYSICS_JOINT_LAYOUT };
  report.wasmSourceSha256 = sha(await readFile("packages/ferrum-web/pkg/ferrum_core_bg.wasm"));
  stage = "launch";
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const launch = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  if (process.env.FERRUM_BROWSER_EXECUTABLE) browser = await chromium.launch({ ...launch, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE });
  else { try { browser = await chromium.launch({ ...launch, channel: process.env.FERRUM_BROWSER_CHANNEL ?? "chrome" }); }
    catch (error) { if (process.env.FERRUM_BROWSER_CHANNEL) throw error; browser = await chromium.launch({ ...launch, channel: "chromium" }); } }
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const wait = (predicate, arg) => page.waitForFunction(predicate, arg, { timeout: 30000 });
  const paint = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const authored = () => page.evaluate(() => window.ferrumPlacementSpatialExportDocument());
  const frameFixture = async () => {
    await clickPlacementControl(page, '[data-placement-view-action="fit-scene"]');
    await clickPlacementControl(page, '[data-placement-view-action="actual-size"]');
    const coversFixture = () => page.evaluate(() => {
      const v = window.ferrumPlacementViewerState.viewport;
      return v.worldMinX <= -134 && v.worldMaxX >= 96 && v.worldMinY <= -20 && v.worldMaxY >= 118;
    });
    for (let attempt = 0; attempt < 12 && !await coversFixture(); attempt++)
      await clickPlacementControl(page, '[data-placement-view-action="zoom-out"]');
    assert(await coversFixture(), "Frame the authored sprites and graphical grid using existing camera controls");
    await paint();
    await wait(() => window.ferrumPlacementViewerRuntimeFrame?.renderCommandCount >= 7);
  };
  const native = () => page.evaluate(({ body: B, character: C, joint: J }) => {
    const engine = window.ferrumEngine, state = window.ferrumPlacementViewerState;
    const handles = Object.fromEntries(state.instances.map(instance => [instance.instanceId, instance.entity]));
    const bodyRows = state.instances.map(instance => {
      if (!instance.entity) throw new Error("Templated instance has no live entity handle");
      const handle = instance.entity, row = engine.queryUnifiedPhysicsBodyStates(new Uint32Array([handle.entityId, handle.entityGeneration]));
      const owned = { id: instance.instanceId, handle, count: row.count, entityId: row.words[B.entityId], generation: row.words[B.entityGeneration],
        position: Array.from(row.floats.slice(B.position, B.position + 3)), velocity: Array.from(row.floats.slice(B.linearVelocity, B.linearVelocity + 3)) };
      return { ...owned, colliders: engine.queryUnifiedPhysicsColliders(handle).length };
    });
    const runner = handles.runner, c = engine.queryUnifiedPhysicsCharacterStates(new Uint32Array([runner.entityId, runner.entityGeneration]));
    const character = { count: c.count, entityId: c.words[C.entityId], generation: c.words[C.entityGeneration] };
    const joints = engine.queryUnifiedPhysicsJointStates();
    const jointRows = Array.from({ length: joints.count }, (_, index) => {
      const offset = index * J.stride;
      return { slot: joints.words[offset + J.joint], generation: joints.words[offset + J.joint + 1], code: joints.words[offset + J.code],
        entityA: { entityId: joints.words[offset + J.entityA], entityGeneration: joints.words[offset + J.entityA + 1] },
        entityB: { entityId: joints.words[offset + J.entityB], entityGeneration: joints.words[offset + J.entityB + 1] } };
    });
    return { mode: window.ferrumPlacementWorkspaceMode, lifecycle: engine.dataSceneState(), entities: engine.entityCount(), bodyRows, character,
      handles, jointRows, frame: window.ferrumPlacementViewerRuntimeFrame, history: window.ferrumPlacementViewerHistory };
  }, layouts);
  const checkNative = (snapshot, mode) => {
    assert.equal(snapshot.mode, mode); assert.equal(snapshot.lifecycle, mode === "game" ? "playing" : "paused");
    assert.equal(snapshot.entities, 3); assert.equal(snapshot.bodyRows.length, 3);
    for (const row of snapshot.bodyRows) {
      assert.equal(row.count, 1); assert.equal(row.entityId, row.handle.entityId); assert.equal(row.generation, row.handle.entityGeneration);
      assert(row.colliders >= 1); assert(row.position.every(Number.isFinite));
    }
    assert.equal(snapshot.character.count, 1); assert.equal(snapshot.character.entityId, snapshot.handles.runner.entityId);
    assert.equal(snapshot.character.generation, snapshot.handles.runner.entityGeneration);
    assert.equal(snapshot.jointRows.length, 1); assert.equal(snapshot.jointRows[0].code, layouts.joint.distance);
    assert.deepEqual(snapshot.jointRows[0].entityA, snapshot.handles.crate_a); assert.deepEqual(snapshot.jointRows[0].entityB, snapshot.handles.crate_b);
    assert(snapshot.frame.renderCommandCount >= 7 && snapshot.frame.drawCalls > 0 && snapshot.frame.drawCalls <= 16);
    assert(Number.isFinite(snapshot.frame.rustUpdateTimeMs) && snapshot.frame.rustUpdateTimeMs >= 0);
  };
  // Observe one existing public renderer submission, then immediately restore the method.
  // Copy the borrowed native command values inside that call; never retain a Wasm view.
  const commands = () => page.evaluate(() => new Promise((done, reject) => {
    const renderer = window.ferrumRuntime.renderer, original = renderer.renderCommands, engine = window.ferrumEngine;
    const timer = setTimeout(() => { renderer.renderCommands = original; reject(new Error("No Studio renderer submission")); }, 10000);
    renderer.renderCommands = function (...args) {
      renderer.renderCommands = original; clearTimeout(timer);
      try {
        const buffer = args.length > 1 ? args[1] : args[0], accessor = engine.createRenderCommandAccessor(), rows = [];
        accessor.bind(buffer);
        for (let index = 0; index < buffer.commandCount; index++) {
          accessor.select(index); rows.push({ x: accessor.x, y: accessor.y, width: accessor.width, height: accessor.height,
            textureId: accessor.textureId, alpha: accessor.a });
        }
        const result = original.apply(this, args);
        done({ rows, floorTextureId: engine.textureId("floor"), zoom: window.ferrumPlacementViewerState.viewport.zoom });
        return result;
      } catch (error) { reject(error); throw error; }
    };
  }));
  const checkTiles = snapshot => {
    assert(snapshot.floorTextureId > 0, "Graphical tiles must use the already registered floor texture");
    const tileRows = snapshot.rows.filter(row => row.textureId === snapshot.floorTextureId);
    assert.equal(tileRows.length, 4);
    for (const row of tileRows) { assert(Math.abs(row.width - 48) < 0.001); assert(Math.abs(row.height - 48) < 0.001); assert(row.alpha > 0); }
    assert.equal(new Set(tileRows.map(row => row.x)).size, 4); assert.equal(new Set(tileRows.map(row => row.y)).size, 1);
  };

  stage = "self-contained local catalog opens in actual paused 2D Studio";
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await wait(() => window.ferrumPlacementViewerState?.instances.length === 3 && window.ferrumPlacementViewerRuntimeFrame && !document.querySelector(".demo-shell").inert);
  await page.locator("[data-placement-language]").selectOption("en");
  report.saveOptInObserved = await page.evaluate(() => window.ferrumPlacementViewerSaveEnabled);
  assert.equal(report.saveOptInObserved, true, "Use a separate VITE_FERRUM_STUDIO_SAVE=true QA artifact for the real Save Draft check");
  await frameFixture();
  report.initial = await native(); checkNative(report.initial, "2d");
  report.initialCommands = await commands(); checkTiles(report.initialCommands);
  assertAuthored(await authored());

  stage = "resolved bounds and real canvas picking";
  report.picking = await page.evaluate(() => {
    const viewer = window.__ferrumPlacementViewer, state = viewer.state(), crate = state.instances.find(item => item.instanceId === "crate_a");
    const screen = (x, y) => ({ x: (x - state.viewport.worldMinX) * state.viewport.zoom, y: (y - state.viewport.worldMinY) * state.viewport.zoom });
    const center = screen(crate.transform.x, crate.transform.y), inside = screen(crate.transform.x + 19, crate.transform.y), outside = screen(crate.transform.x + 21, crate.transform.y);
    const rect = document.querySelector("canvas").getBoundingClientRect();
    return { center, inside: viewer.pickInstanceAtScreen(inside)?.instanceId, outside: viewer.pickInstanceAtScreen(outside)?.instanceId,
      click: { x: rect.left + center.x, y: rect.top + center.y }, visual: crate.visual, template: crate.componentTemplate };
  });
  assert.equal(report.picking.template, "crateBody"); assert.equal(report.picking.visual.bounds.width, 40); assert.equal(report.picking.visual.bounds.height, 40);
  assert.equal(report.picking.inside, "crate_a"); assert.equal(report.picking.outside, undefined);
  await page.mouse.click(report.picking.click.x, report.picking.click.y);
  await wait(() => window.ferrumPlacementViewerState.selectedInstanceId === "crate_a");
  await showPlacementInspector(page, "properties");
  await showPlacementBottom(page, "runtime");
  await wait(() => window.ferrumPlacementSelectedRuntime?.instanceId === "crate_a" && window.ferrumPlacementSelectedRuntime.shapePhysics?.colliderCount === 1);

  stage = "shared visual/body/collider stay read-only without detachment";
  const fields = page.locator(".placement-component-controls [data-placement-component-field]");
  assert((await fields.count()) > 0);
  assert(await fields.evaluateAll(nodes => nodes.every(node => node.disabled)));
  assert(await page.locator('[data-placement-action="apply-components"]').isDisabled());
  const cleanSource = await authored();
  report.rejectedEdits = await page.evaluate(component => {
    const edits = [structuredClone(component), structuredClone(component), structuredClone(component), { template: "runner" }];
    edits[0].visual.width += 1; edits[1].body.gravityScale = 2; edits[2].body.collider.shape.halfExtents[0] += 1;
    return edits.map(edit => {
      try { window.ferrumPlacementViewerUpdateComponents("crate_a", edit); return { rejected: false }; }
      catch (error) { return { rejected: true, message: error.message }; }
    });
  }, fixture.componentTemplates.crateBody);
  assert(report.rejectedEdits.every(item => item.rejected && /read-only/.test(item.message)));
  assert.equal(await page.evaluate(() => window.ferrumPlacementViewerExportPatch()), undefined);
  assert.deepEqual(await authored(), cleanSource);

  stage = "instance transform and independent render layer preserve raw source through Undo/Redo";
  await showPlacementInspector(page, "properties");
  const x = page.locator('[data-placement-transform-field="x"]:visible'), layer = page.locator('[data-placement-transform-field="layer"]:visible');
  await x.fill("-65"); await x.press("Tab");
  await layer.fill("4"); await layer.press("Tab"); await paint();
  await wait(() => window.ferrumPlacementViewerState.selected?.transform.x === -65 && window.ferrumPlacementViewerState.selected.transform.layer === 4);
  report.patch = await page.evaluate(() => window.ferrumPlacementViewerExportPatch());
  assert(report.patch && report.patch.operations.every(operation => ["updateTransform", "updateResolvedTransform"].includes(operation.kind)));
  const edited = await authored(); assertAuthored(edited);
  assert.equal(edited.sceneComposition.fragments.main.instances[0].x, -65); assert.equal(edited.sceneComposition.fragments.main.instances[0].layer, 4);
  await writeFile(resolve(out, "exported-scene-authoring.json"), json(edited));
  await writeFile(resolve(out, "placement.patch.json"), json(report.patch));
  await clickPlacementControl(page, '[data-placement-action="undo"]');
  await clickPlacementControl(page, '[data-placement-action="undo"]');
  await wait(() => !window.ferrumPlacementViewerExportPatch());
  assert.deepEqual(await authored(), fixture);
  await clickPlacementControl(page, '[data-placement-action="redo"]');
  await clickPlacementControl(page, '[data-placement-action="redo"]');
  await wait(() => window.ferrumPlacementViewerState.selected?.transform.x === -65 && window.ferrumPlacementViewerState.selected.transform.layer === 4);
  assert.deepEqual(await authored(), edited);
  report.edited = await native(); checkNative(report.edited, "2d");
  assert(Math.abs(report.edited.bodyRows.find(row => row.id === "crate_a").position[0] + 65) < 0.001);

  stage = "Play runs actual native rows and Stop restores edited authored bodies";
  await clickPlacementControl(page, '[data-placement-playback="play"]');
  await wait(({ B, before }) => {
    const state = window.ferrumPlacementViewerState, instance = state.instances.find(item => item.instanceId === "crate_a");
    if (window.ferrumPlacementWorkspaceMode !== "game" || window.ferrumEngine.dataSceneState() !== "playing" || !instance?.entity) return false;
    const handle = instance.entity, row = window.ferrumEngine.queryUnifiedPhysicsBodyStates(new Uint32Array([handle.entityId, handle.entityGeneration]));
    return row.count === 1 && Math.abs(row.floats[B.position] - before) > 0.2;
  }, { B: layouts.body, before: -65 });
  report.playing = await native(); checkNative(report.playing, "game");
  report.playCommands = await commands(); checkTiles(report.playCommands);
  assert.deepEqual(await authored(), edited);
  await clickPlacementControl(page, '[data-placement-playback="stop"]');
  await wait(() => window.ferrumPlacementWorkspaceMode === "2d" && window.ferrumEngine.dataSceneState() === "paused");
  report.stopped = await native(); checkNative(report.stopped, "2d");
  for (const row of report.stopped.bodyRows) assert.deepEqual(row.position, report.edited.bodyRows.find(item => item.id === row.id).position);
  assert.deepEqual(await authored(), edited);

  stage = "real opt-in Studio save compares source and persists only the QA artifact";
  await showPlacementInspector(page, "properties");
  await page.locator('[data-section="transform"] [data-placement-action="save-draft"]').click();
  await wait(() => window.ferrumPlacementViewerLastSave?.saved || window.ferrumPlacementViewerLastSaveError);
  report.save = await page.evaluate(() => ({ result: window.ferrumPlacementViewerLastSave, error: window.ferrumPlacementViewerLastSaveError,
    source: window.ferrumPlacementViewerSavedDocument, patch: window.ferrumPlacementViewerExportPatch() }));
  assert.equal(report.save.error, undefined); assert.equal(report.save.result.saved, true); assert.equal(report.save.patch, undefined);
  assert.equal(saveRequests.length, 1); assert.deepEqual(report.save.source, edited); assert.deepEqual(persisted, edited); assertAuthored(persisted);

  stage = "catalog and tile asset evidence retain original JSON pointers";
  await page.evaluate(() => { window.ferrumPlacementViewerSelect("crate_a"); window.ferrumPlacementViewerRefreshHandoff(); });
  report.handoff = await page.evaluate(() => window.ferrumPlacementViewerAgentHandoff);
  assert.deepEqual(report.handoff.componentTemplates, fixture.componentTemplates);
  assert.equal(report.handoff.selected.componentTemplate, "crateBody"); assert.deepEqual(report.handoff.assetDiagnostics, []);
  assert(report.handoff.authoringEvidence.selectedSourcePaths.some(path => path.endsWith("#/componentTemplates/crateBody")));
  await writeFile(resolve(out, "agent-handoff.json"), json(report.handoff));
  await showPlacementAssetPanel(page, "usage");
  const usage = page.locator("[data-placement-asset-usage]");
  if (!await usage.evaluate(node => node.open)) await usage.locator(":scope > summary").click();
  await page.locator("[data-placement-usage-scan]").click();
  await wait(() => !document.querySelector("[data-placement-usage-export]").disabled);
  const downloadPending = page.waitForEvent("download");
  await page.locator("[data-placement-usage-export]").click();
  const download = await downloadPending; await download.saveAs(resolve(out, "asset-usage.json"));
  report.assetUsage = JSON.parse(await readFile(resolve(out, "asset-usage.json")));
  assert.equal(report.assetUsage.scanned, 1); assert.equal(report.assetUsage.limited, false); assert.deepEqual(report.assetUsage.issues, []);
  for (const [assetId, pointer] of [["crate", "/componentTemplates/crateBody/visual/asset"], ["agent", "/componentTemplates/runner/visual/asset"], ["floor", "/physics/collisionTilemap/definitions/0/visual/texture"]]) {
    const asset = report.assetUsage.assets.find(item => item.kind === "sprite" && item.id === assetId);
    assert(asset?.registered); assert(asset.references.length >= 2);
    assert(asset.references.every(reference => reference.pointer === pointer));
    for (const source of new Set(asset.references.map(reference => reference.source)))
      assert.equal(asset.references.filter(reference => reference.source === source).length, 1, "Shared instances must not duplicate their catalog source path");
  }

  stage = "reload persisted raw templates into paused 2D";
  await page.reload();
  await wait(() => window.ferrumPlacementViewerState?.instances.length === 3 && window.ferrumPlacementViewerRuntimeFrame && !document.querySelector(".demo-shell").inert);
  await frameFixture();
  report.reopened = await native(); checkNative(report.reopened, "2d"); assert.deepEqual(await authored(), edited);
  report.reopenedCommands = await commands(); checkTiles(report.reopenedCommands);
  assert.equal(await page.evaluate(() => window.ferrumPlacementViewerExportPatch()), undefined);
  assert.deepEqual(errors, []); assert.deepEqual(hostErrors, []);
  assert([...served.entries()].some(([file, value]) => extname(file) === ".wasm" && value.sha256 === report.wasmSourceSha256), "The browser must load the fresh product Wasm");
  await page.screenshot({ path: resolve(out, "native-templates.png") });
  Object.assign(report, { status: "passed", browser: browser.version(), errors });
} catch (error) {
  Object.assign(report, { status: "failed", stage, error: String(error), stack: error.stack });
  if (page) {
    report.failureState = await page.evaluate(() => ({ mode: window.ferrumPlacementWorkspaceMode, frame: window.ferrumPlacementViewerRuntimeFrame,
      state: window.ferrumPlacementViewerState, text: document.querySelector("#app")?.textContent?.slice(-12000) })).catch(() => undefined);
    await page.screenshot({ path: resolve(out, "failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  report.servedInputs = Object.fromEntries(served); report.saveRequests = saveRequests; report.hostErrors = hostErrors;
  report.sourceSha256 = sha(await readFile("tests/smoke/native-template-studio-smoke.mjs"));
  await writeFile(resolve(out, "report.json"), json(report));
  await browser?.close(); if (server.listening) await new Promise(done => server.close(done));
}
console.log(JSON.stringify({ status: report.status, browser: report.browser, sourceSha256: report.sourceSha256,
  fixtureSha256: report.fixtureSha256, report: resolve(out, "report.json") }));
