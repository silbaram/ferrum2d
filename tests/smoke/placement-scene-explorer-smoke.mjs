import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { showPlacementDock, showPlacementInspector, showPlacementMenu } from "./placement-panel-navigation.mjs";
import { smokeProjectSceneAssets } from "./placement-project-scene-assets-smoke.mjs";

export async function smokePlacementSceneExplorer(parent, timeoutMs) {
  const page = await parent.context().browser().newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], output = "artifacts/placement-scene-explorer";
  await mkdir(output, { recursive: true });
  page.on("pageerror", error => errors.push(error.message));
  const wait = (predicate, arg) => page.waitForFunction(predicate, arg, { timeout: timeoutMs });
  const explorer = () => page.locator(".placement-scene-explorer:visible");
  const row = name => explorer().locator(`[data-placement-project-scene$="/${name}"]`);
  const action = name => explorer().locator(`[data-placement-scene-action=${name}]`);
  let folder;
  try {
    await page.goto(new URL("./", parent.url()).href, { waitUntil: "networkidle" });
    await wait(() => window.ferrumPlacementViewerRuntimeFrame?.entityCount === 6);
    await page.locator("[data-placement-language]").selectOption("en");
    // The File entry reveals a hidden scene dock, including the compact layout.
    await showPlacementMenu(page, "file");
    await page.locator("[data-placement-action=scene-explorer]").click();
    await wait(() => document.querySelectorAll(".placement-scene-explorer [role=option]").length === 4);
    const initialKey = await page.evaluate(() => window.ferrumPlacementWorkspaceActiveDocument);
    await row("placement.scene-authoring.json").dblclick();
    assert.equal(await page.evaluate(() => window.ferrumPlacementWorkspaceDocuments.length), 1);
    await showPlacementInspector(page);
    await page.evaluate(() => window.ferrumPlacementViewerSelect("crate_left"));
    const x = page.locator("input[data-placement-transform-field=x]:visible");
    await x.fill("390"); await x.press("Enter");
    await wait(() => !!window.ferrumPlacementViewerExportPatch());
    const patch = await page.evaluate(() => window.ferrumPlacementViewerExportPatch());
    await showPlacementDock(page, "scene");
    await row("placement.garden.scene-authoring.json").dblclick();
    await wait(() => window.ferrumPlacementViewerState?.instances.some(i => i.instanceId === "garden_hero"));
    assert.equal(await page.evaluate(() => window.ferrumPlacementWorkspaceDocuments.length), 2);
    assert(await explorer().isVisible());
    await action("run").click();
    await wait(() => window.ferrumPlacementWorkspaceMode === "game");
    assert.equal(await page.locator("[data-placement-playback=pause]").isEnabled(), true);
    await page.locator("[data-placement-playback=pause]").click();
    assert.equal(await page.locator("[data-placement-playback=pause]").getAttribute("aria-label"), "Resume");
    await action("run").click();
    assert.equal(await page.locator("[data-placement-playback=pause]").getAttribute("aria-label"), "Pause");
    await page.locator("[data-placement-playback=stop]").click();
    await row("placement.scene-authoring.json").click(); await action("open").click();
    await wait(key => window.ferrumPlacementWorkspaceActiveDocument === key, initialKey);
    assert.deepEqual(await page.evaluate(() => window.ferrumPlacementViewerExportPatch()), patch);
    assert.equal(await page.evaluate(() => window.ferrumPlacementWorkspaceDocuments.length), 2);
    // Search, keyboard list navigation and selected scene execution cannot run the old scene after an error.
    const search = explorer().locator("[data-placement-scene-search]");
    await search.fill("hd2d");
    assert.equal(await explorer().getByRole("option").count(), 1);
    await page.route("**/placement.hd2d.scene-authoring.json", route => route.fulfill({ json: { format: "broken" } }));
    await explorer().getByRole("option").click(); await action("run").click();
    await wait(() => document.querySelector(".placement-scene-explorer-status").textContent.length > 0 && !document.querySelector(".demo-shell").inert);
    assert.equal(await page.evaluate(() => window.ferrumPlacementWorkspaceActiveDocument), initialKey);
    assert.equal(await page.evaluate(() => window.ferrumPlacementWorkspaceMode), "2d");
    assert.equal(await page.evaluate(() => window.ferrumPlacementWorkspaceDocuments.length), 2);
    assert.notEqual(await explorer().locator("[role=status]").textContent(), "1 of 4 scenes");
    await page.unroute("**/placement.hd2d.scene-authoring.json");
    await search.fill("");
    await explorer().getByRole("option").first().focus(); await page.keyboard.press("End");
    assert.equal(await explorer().getByRole("option").last().getAttribute("aria-selected"), "true");
    await page.keyboard.press("Home");
    assert.equal(await explorer().getByRole("option").first().getAttribute("aria-selected"), "true");
    await page.keyboard.press("Enter");
    await wait(() => window.ferrumPlacementViewerState?.instances.some(i => i.instanceId === "garden_hero"));
    await page.locator("[data-placement-language]").selectOption("ko");
    assert.equal(await action("run").textContent(), "씬 실행");
    await page.screenshot({ path: `${output}/project-scenes-ko.png` });
    await page.setViewportSize({ width: 780, height: 760 });
    await wait(() => document.querySelector(".demo-shell").dataset.compact === "true");
    await showPlacementDock(page, "scene");
    assert(await explorer().isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${output}/project-scenes-compact.png` });
    await page.setViewportSize({ width: 1280, height: 900 });
    await wait(() => document.querySelector(".demo-shell").dataset.compact !== "true");
    await page.locator("[data-placement-language]").selectOption("en");
    // User-selected folder files are lazy, export-only documents. Folder refresh prompts a new selection.
    folder = await mkdtemp(join(tmpdir(), "ferrum-scene-browser-"));
    const source = await (await page.request.get(new URL("placement.scene-authoring.json", page.url()).href)).text();
    await mkdir(join(folder, "public"));
    await writeFile(join(folder, "public/room.json"), source);
    await writeFile(join(folder, "public/broken.scene-authoring.json"), "{");
    const chooser = page.waitForEvent("filechooser");
    await action("choose").click(); await (await chooser).setFiles(folder);
    await wait(() => document.querySelectorAll(".placement-scene-explorer [role=option]").length === 2);
    const invalid = explorer().locator("[data-placement-project-scene$='broken.scene-authoring.json']");
    await invalid.click(); assert.equal(await action("run").isDisabled(), true);
    await explorer().locator("[data-placement-project-scene$='room.json']").click();
    await action("run").click();
    await wait(() => window.ferrumPlacementWorkspaceActiveDocument.startsWith("folder:"));
    await wait(() => window.ferrumPlacementWorkspaceMode === "game" && window.ferrumPlacementViewerState.instances.length === 6);
    assert.equal(await page.evaluate(() => window.ferrumPlacementViewerSaveEnabled), false);
    assert.match(await explorer().locator(".placement-scene-explorer-hint").textContent(), /read-only snapshots/);
    assert.deepEqual(errors, []);
    const native = await smokeNativeSceneExplorer(parent, timeoutMs, JSON.parse(source));
    native.projectAssets = await smokeProjectSceneAssets(parent, timeoutMs, JSON.parse(source));
    const report = { ok: true, hostedScenes: 4, duplicateTabPreserved: true, draftPreserved: true, runSelected: true, failedOpenDoesNotPlayPreviousScene: true, keyboard: true, ko: true, compact: true, folderExportOnly: true, native, pageErrors: errors };
    await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + "\n");
    return report;
  } finally { await page.close(); if (folder) await rm(folder, { recursive: true, force: true }); }
}

async function smokeNativeSceneExplorer(parent, timeoutMs, document) {
  const page = await parent.context().browser().newPage({ viewport: { width: 1280, height: 900 } });
  const project = "/tmp/ferrum-scene-explorer", first = project + "/public/scene-authoring.json", second = project + "/public/levels/room.json";
  const wait = (predicate, arg) => page.waitForFunction(predicate, arg, { timeout: timeoutMs });
  try {
    await page.addInitScript(({ project, first, second, document }) => {
      const scenes = new Map([[first, document], [second, structuredClone(document)]]);
      const folder = path => ({ assetFolderPath: path, exists: true, imageCount: 0, images: [], models: [], diagnostics: [] });
      window.__sceneExplorerCommands = [];
      window.__TAURI__ = { core: { async invoke(command, args) {
        window.__sceneExplorerCommands.push({ command, args: structuredClone(args) });
        if (command === "load_placement_project_folder") return { projectPath: project, sceneDocumentPath: first, handoffPath: project + "/.ferrum-placement-handoff.json", assetFolder: folder(project + "/public/assets"), document };
        if (command === "list_placement_project_scenes") return { truncated: false, scenes: [first, second].map(path => ({ path, relativePath: path.slice(project.length + 1), mode: "2d" })) };
        if (command === "load_placement_scene_document") return { path: args.sceneDocumentPath, document: structuredClone(scenes.get(args.sceneDocumentPath)) };
        if (command === "inspect_placement_asset_folder") return folder(args.assetFolderPath);
        if (command === "load_placement_tile_assets") return { format: "ferrum2d.tile-import.project", version: 1, assets: [] };
        if (command === "load_placement_aseprite_assets") return { format: "ferrum2d.aseprite.project", version: 1, assets: [] };
        if (command === "load_placement_normal_assets") return { format: "ferrum2d.sprite-normal.project", version: 1, registered: true, entries: [], textures: {} };
        if (command === "save_placement_agent_handoff") return { path: project + "/.ferrum-placement-handoff.json", handoff: args.handoff };
        if (command === "save_placement_scene_document") { scenes.set(args.sceneDocumentPath, structuredClone(args.document)); return { path: args.sceneDocumentPath, document: args.document }; }
        throw new Error("Unexpected command: " + command);
      } } };
    }, { project, first, second, document });
    const url = new URL("./", parent.url()); url.searchParams.set("projectPath", project + "/.");
    await page.goto(url.href, { waitUntil: "networkidle" });
    await wait(() => window.ferrumPlacementViewerRuntimeFrame?.entityCount === 6);
    await page.locator("[data-placement-language]").selectOption("en");
    await showPlacementMenu(page, "file"); await page.locator("[data-placement-action=scene-explorer]").click();
    const explorer = page.locator(".placement-scene-explorer:visible");
    await explorer.getByRole("option").first().dblclick();
    assert.equal(await page.evaluate(() => window.ferrumPlacementWorkspaceDocuments.length), 1);
    const latest = project + "/public/latest-assets";
    await page.evaluate(path => window.ferrumPlacementViewerOpenAssetFolder(path), latest);
    await wait(path => window.ferrumPlacementViewerDesktop.assetFolderPath === path && window.ferrumPlacementViewerDesktop.assetFolderRuntimeStatus === "ready", latest);
    await explorer.locator(`[data-placement-project-scene="${second}"]`).click();
    await explorer.locator("[data-placement-scene-action=run]").click();
    await wait(path => window.ferrumPlacementWorkspaceActiveDocument === path && window.ferrumPlacementWorkspaceMode === "game", second);
    const state = await page.evaluate(() => window.ferrumPlacementViewerDesktop);
    assert.equal(state.projectPath, project); assert.equal(state.assetFolderPath, latest); assert.equal(state.sceneDocumentPath, second);
    await page.locator("[data-placement-playback=stop]").click();
    await showPlacementInspector(page);
    await page.evaluate(() => window.ferrumPlacementViewerSelect("crate_left"));
    const x = page.locator("input[data-placement-transform-field=x]:visible");
    await x.fill("470"); await x.press("Enter");
    await wait(() => !!window.ferrumPlacementViewerExportPatch());
    const saved = await page.evaluate(() => window.ferrumPlacementViewerSaveDraft());
    assert.equal(saved.saved, true);
    const write = await page.evaluate(() => window.__sceneExplorerCommands.filter(c => c.command === "save_placement_scene_document").at(-1));
    assert.equal(write.args.sceneDocumentPath, second); assert(write.args.expectedDocument);
    return { fakeBridge: true, currentSceneDeduplicated: true, unopenedSceneRuns: true, latestAssetContext: true, saveTargetsSelectedScene: true };
  } finally { await page.close(); }
}
