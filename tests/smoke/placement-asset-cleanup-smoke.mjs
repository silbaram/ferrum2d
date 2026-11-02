import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { encodePngRgba } from "../../scripts/tools/pack-textures.mjs";
import { showPlacementBottom, showPlacementInspector } from "./placement-panel-navigation.mjs";
const hash = value => createHash("sha256").update(value).digest("hex");
function pixelBundle(identity, color, revision) {
  const pixels = Buffer.from([color, 40, 160, 255, 12, 34, 56, 0]);
  const source = { format: "ferrum2d.pixel-document", version: 1, name: "cleanup fixture", width: 2, height: 1, colorSpace: "srgb",
    layer: { id: "layer-1", name: "Layer 1" }, frame: { id: "frame-1", durationMs: 100 }, palette: ["#ff0000ff"], rgba: pixels.toString("base64") };
  const json = Buffer.from(JSON.stringify(source));
  const png = encodePngRgba(2, 1, pixels);
  const id = "pixel." + hash(JSON.stringify([identity, json.toString()])).slice(0, 24);
  return { id, bundle: { format: "ferrum2d.pixel-project.assets", version: 1, overwrite: false, expectedCatalogRevision: revision,
      revisions: [{ assetId: id, identityDocument: identity, width: 2, height: 1, jsonSha256: hash(json), pngSha256: hash(png) }],
      manifest: { textures: { [id]: id + ".png" }, textureOptions: { [id]: { colorSpace: "srgb" } } },
      files: [{ path: id + ".json", mediaType: "application/json", sha256: hash(json), base64: json.toString("base64") },
        { path: id + ".png", mediaType: "image/png", sha256: hash(png), base64: png.toString("base64") }] } };
}
/** Runs through actual app controls and actual Rust storage; the shared runner owns the stdio transport. */
export async function smokeAssetCleanup({ getPage, project, scene, initial, run, commands, invoke, restart, holdWrite, waitHeld, releaseWrite, close, webProbe }) {
  await webProbe();
  let page = getPage();
  const root = join(project, "public/assets/.ferrum-pixels");
  const catalog = join(root, "catalog.json");
  const closed = join(project, "public/closed-scene.json");
  let revision = "";
  const ids = [];
  for (const color of [10, 20, 30, 40]) {
    const fixture = pixelBundle(scene, color, revision);
    ids.push(fixture.id);
    const reply = await invoke("save_placement_pixel_assets", { projectPath: project, bundle: fixture.bundle });
    revision = reply.catalogRevision;
  }
  const document = structuredClone(initial);
  document.sceneComposition.fragments.main.instances[0].props.components.visual.texture = ids[0];
  await writeFile(scene, JSON.stringify(document, null, 2) + "\n");
  await writeFile(closed, JSON.stringify({ inactive: { texture: ids[1] } }));
  const sceneBytes = await readFile(scene);
  const closedBytes = await readFile(closed);
  const catalogBytes = await readFile(catalog);
  const originals = new Map(await Promise.all((await readdir(root)).map(async (name) => [name, await readFile(join(root, name))])));
  await restart();
  page = getPage();
  const dialog = () => page.locator('[data-placement-cleanup-dialog]');
  const action = name => dialog().locator(`[data-placement-cleanup-action="${name}"]`);
  const status = () => dialog().locator('[data-placement-cleanup-status]').textContent();
  const row = id => dialog().locator(`[data-placement-cleanup-revision=".ferrum-pixels:${id}"]`);
  const source = () => page.evaluate(() => JSON.stringify({ doc: window.ferrumPlacementSpatialExportDocument(), patch: window.ferrumPlacementViewerExportPatch(), history: window.ferrumPlacementViewerHistory }));
  async function launch() { await showPlacementBottom(page); await page.locator('[data-placement-cleanup-open]').click(); }
  async function analyze() { await action("scan").click(); await page.waitForFunction(() => document.querySelector('[data-placement-cleanup-dialog]').getAttribute("aria-busy") === "false"); assert.match(await status(), /Review references/); }
  async function reopen() { await action("reopen").click(); await page.waitForFunction(() => window.ferrumEngine && document.querySelector('[data-placement-cleanup-dialog]')?.open === false); await page.locator('[data-placement-language]').selectOption("en"); }
  assert(!commands.includes("inspect_placement_asset_cleanup"), "opening a project must not analyze cleanup automatically");
  await page.locator('[data-placement-language]').selectOption("en");
  const readOnlyBefore = await source();
  await launch();
  await analyze();
  assert(await row(ids[0]).isDisabled());
  assert(await row(ids[1]).isDisabled());
  assert(await row(ids[2]).isEnabled());
  assert(await row(ids[3]).isEnabled());
  assert(await action("apply").isDisabled());
  await row(ids[2]).check();
  assert(await action("apply").isEnabled());
  const download = page.waitForEvent("download");
  await action("export").click();
  const planFile = join(run, "cleanup-plan.json");
  await (await download).saveAs(planFile);
  const plan = JSON.parse(await readFile(planFile, "utf8"));
  assert.equal(plan.deletionAllowed, false);
  assert.deepEqual(plan.selected, [".ferrum-pixels:" + ids[2]]);
  assert(plan.revisions.find(value => value.id === ids[1]).references.includes("public/closed-scene.json"));
  assert.equal(await source(), readOnlyBefore);
  assert.deepEqual(await readFile(catalog), catalogBytes);
  await page.keyboard.press("Escape");
  assert.equal(await dialog().evaluate(e => e.open), false);
  // Read-only discovery can be canceled without waiting for a native response.
  await launch();
  holdWrite();
  await action("scan").click();
  await waitHeld();
  assert(await dialog().locator('[data-placement-cleanup-close]').isEnabled());
  await page.keyboard.press("Escape");
  assert.equal(await dialog().evaluate(e => e.open), false);
  releaseWrite();
  await launch();
  assert(await action("apply").isDisabled());
  await analyze();
  assert.equal(await source(), readOnlyBefore);
  await page.keyboard.press("Escape");
  // Unapplied component fields and retained Redo protect work that a mandatory reload would discard.
  await showPlacementInspector(page);
  await page.evaluate(() => window.ferrumPlacementViewerSelect("sprite"));
  const width = page.locator('.placement-inspector:visible [data-placement-component-field="visualWidth"]');
  const old = await width.inputValue();
  await width.fill(String(Number(old) + 3));
  await launch();
  await analyze();
  await row(ids[2]).check();
  assert(await action("apply").isDisabled());
  assert.match(await dialog().locator('#placement-cleanup-reason').textContent(), /pending component/);
  await page.keyboard.press("Escape");
  await width.fill(old);
  const x = page.locator('.placement-inspector:visible [data-placement-transform-field="x"]');
  await x.fill("850");
  await x.press("Tab");
  await launch();
  await analyze();
  await row(ids[2]).check();
  assert(await action("apply").isDisabled());
  assert.match(await dialog().locator('#placement-cleanup-reason').textContent(), /Save all/);
  await page.keyboard.press("Escape");
  await page.locator('[data-placement-action="undo"]').click();
  await launch();
  await analyze();
  await row(ids[2]).check();
  assert(await action("apply").isDisabled());
  assert.match(await dialog().locator('#placement-cleanup-reason').textContent(), /Undo and Redo/);
  await page.keyboard.press("Escape");
  await restart();
  page = getPage();
  await page.locator('[data-placement-language]').selectOption("en");
  // Disk writes after preview are rechecked in Rust. Failed writes still require a clean reopen.
  await launch();
  await analyze();
  await row(ids[2]).check();
  await writeFile(closed, JSON.stringify({ inactive: { texture: ids[1] }, late: ids[2] }));
  await action("apply").click();
  await action("reopen").waitFor({ state: "visible" });
  assert.match(await status(), /failed.*changed/is);
  assert.deepEqual(await readFile(catalog), catalogBytes);
  await assert.rejects(stat(join(project, ".ferrum-asset-backups")));
  await writeFile(closed, closedBytes);
  await reopen();
  await launch();
  await analyze();
  await row(ids[2]).check();
  holdWrite();
  await action("apply").click();
  await waitHeld();
  assert(await dialog().locator('[data-placement-cleanup-close]').isDisabled());
  assert(await row(ids[3]).isDisabled());
  await page.keyboard.press("Escape");
  assert(await dialog().evaluate(e => e.open));
  releaseWrite();
  await action("reopen").waitFor({ state: "visible" });
  assert.match(await status(), /Operation completed/);
  assert(await action("scan").isDisabled());
  assert(await dialog().locator('[data-placement-cleanup-close]').isDisabled());
  const saved = JSON.parse(await readFile(catalog, "utf8"));
  assert.equal(saved.revisions.length, 3);
  assert(!saved.revisions.some(value => value.assetId === ids[2]));
  for (const suffix of [".png", ".json"])
    await assert.rejects(stat(join(root, ids[2] + suffix)));
  const backupId = (await readdir(join(project, ".ferrum-asset-backups")))[0];
  for (const [name, bytes] of originals)
    assert.deepEqual(await readFile(join(project, ".ferrum-asset-backups", backupId, ".ferrum-pixels", name)), bytes);
  assert.deepEqual(await readFile(scene), sceneBytes);
  assert.deepEqual(await readFile(closed), closedBytes);
  await page.screenshot({ path: join(run, "retired.png"), fullPage: true });
  await reopen();
  // Restore from a new Rust/browser session; the backup remains recoverable evidence.
  await restart();
  page = getPage();
  await page.locator('[data-placement-language]').selectOption("en");
  await launch();
  await analyze();
  assert.equal(await row(ids[2]).count(), 0);
  // Recovery remains available if an unrelated closed scene becomes malformed.
  await writeFile(closed, "invalid JSON");
  await action("scan").click();
  await page.waitForFunction(() => document.querySelector('[data-placement-cleanup-dialog]').getAttribute('aria-busy') === 'false');
  assert.match(await status(), /analysis failed.*Recovery backups are still available/is);
  assert(await action("apply").isDisabled());
  await dialog().locator(':scope > details > summary').click();
  await dialog().locator(`[data-placement-cleanup-restore="${backupId}"]`).click();
  await action("reopen").waitFor({ state: "visible" });
  assert.match(await status(), /Operation completed/);
  for (const [name, bytes] of originals)
    assert.deepEqual(await readFile(join(root, name)), bytes);
  assert.deepEqual(await readFile(scene), sceneBytes);
  assert.equal(await readFile(closed, "utf8"), "invalid JSON");
  await writeFile(closed, closedBytes);
  await reopen();
  // Compact Korean modal uses the same controls and contains its own scrolling surface.
  await page.setViewportSize({ width: 680, height: 780 });
  await page.locator('[data-placement-language]').selectOption("ko");
  await launch();
  assert.match(await dialog().locator('h2').textContent(), /프로젝트/);
  await action("scan").click();
  await page.waitForFunction(() => document.querySelector('[data-placement-cleanup-dialog]').getAttribute('aria-busy') === 'false');
  assert.equal(await row(ids[2]).isDisabled(), false);
  const bounds = await dialog().boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 681 && bounds.y >= 0 && bounds.y + bounds.height <= 781);
  await page.screenshot({ path: join(run, "korean-compact.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await close();
  return { webDisabled: true, realRustStorageAndProtocol: true, explicitSelection: true, closedSceneProtected: true, analysisReadOnly: true, canceledAnalysisIgnoresLateReply: true, pendingInputsProtected: true,
    dirtyAndRedoProtected: true, lateReferenceRejected: true, busyEscapeBlocked: true, fullCatalogBackupExact: true, retiredFilesOnly: true,
    mandatoryReopen: true, freshSessionRestoreExact: true, recoveryDespiteAnalysisFailure: true, koreanCompact: true, sceneUnchanged: true };
}
