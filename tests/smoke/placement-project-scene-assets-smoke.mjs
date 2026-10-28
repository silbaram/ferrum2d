import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { encodePngRgba, decodePng } from "../../scripts/tools/pack-textures.mjs";
import { showPlacementMenu, showPlacementInspector } from "./placement-panel-navigation.mjs";

/** Verified persisted atlas shared by two scenes, including source-tab closure and foreign-file rejection. */
export async function smokeProjectSceneAssets(parent, timeoutMs, source) {
  const project = "/tmp/ferrum-project-scene-assets", first = project + "/public/scene-authoring.json", second = project + "/public/room.json";
  const png = encodePngRgba(1, 1, new Uint8Array([245, 10, 240, 255]));
  const json = JSON.stringify({ frames: { "idle.png": { frame: { x: 0, y: 0, w: 1, h: 1 }, rotated: false, trimmed: false, duration: 100 } }, meta: { image: "hero.png", size: { w: 1, h: 1 } } });
  const hash = value => createHash("sha256").update(value).digest("hex");
  const jsonSha256 = hash(json), pngSha256 = hash(png);
  const assetId = "aseprite.hero." + hash(JSON.stringify([first, "hero", jsonSha256, pngSha256])).slice(0, 24);
  const metadata = { logicalId: "hero", assetId, identityDocument: first, jsonName: "hero.json", pngName: "hero.png", jsonSha256, pngSha256, width: 1, height: 1, frames: [{ id: "idle.png", x: 0, y: 0, width: 1, height: 1, uv: { u0: 0, v0: 0, u1: 1, v1: 1 } }], persisted: true };
  const document = structuredClone(source);
  delete document.sceneComposition.prefabs.crate.props.components.sprite;
  document.sceneComposition.prefabs.crate.props.components.visual = { kind: "sprite", texture: assetId, width: 40, height: 40, frame: { u0: 0, v0: 0, u1: 1, v1: 1 } };
  const page = await parent.context().browser().newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
  const wait = (predicate, arg) => page.waitForFunction(predicate, arg, { timeout: timeoutMs });
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.route("**/__project-scene-hero.png", route => route.fulfill({ contentType: "image/png", body: png }));
    await page.route("**/__project-scene-hero.json", route => route.fulfill({ contentType: "application/json", body: json }));
    await page.addInitScript(({ project, first, second, document, metadata, pngSize }) => {
      const scenes = new Map([[first, document], [second, structuredClone(document)]]);
      const folder = { assetFolderPath: project + "/public/assets", exists: true, imageCount: 0, images: [], models: [], diagnostics: [] };
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      window.__sharedSceneAtlasUrls = []; window.__sharedSceneRevokedUrls = [];
      URL.createObjectURL = blob => { const url = create(blob); if (blob.type === "image/png" && blob.size === pngSize) window.__sharedSceneAtlasUrls.push(url); return url; };
      URL.revokeObjectURL = url => { window.__sharedSceneRevokedUrls.push(url); revoke(url); };
      window.__TAURI__ = { core: { async invoke(command, args) {
        if (command === "load_placement_project_folder") return { projectPath: project, sceneDocumentPath: first, handoffPath: project + "/.ferrum-placement-handoff.json", assetFolder: folder, document };
        if (command === "load_placement_aseprite_assets") return { format: "ferrum2d.aseprite.project", version: 1, assets: [{ metadata, pngUrl: location.origin + "/__project-scene-hero.png", jsonUrl: location.origin + "/__project-scene-hero.json" }] };
        if (command === "load_placement_tile_assets") return { format: "ferrum2d.tile-import.project", version: 1, assets: [] };
        if (command === "load_placement_normal_assets") return { format: "ferrum2d.sprite-normal.project", version: 1, registered: true, entries: [], textures: {} };
        if (command === "list_placement_project_scenes") return { truncated: false, diagnostics: [{ relativePath: "public/locked", code: "PermissionDenied" }], scenes: [first, second].map(path => ({ path, relativePath: path.slice(project.length + 1), mode: "2d" })) };
        if (command === "load_placement_scene_document") return { path: args.sceneDocumentPath, document: structuredClone(scenes.get(args.sceneDocumentPath)) };
        if (command === "inspect_placement_asset_folder") return folder;
        if (command === "save_placement_agent_handoff") return { path: project + "/.ferrum-placement-handoff.json", handoff: args.handoff };
        if (command === "save_placement_scene_document") {
          if (args.sceneDocumentPath !== second || JSON.stringify(args.expectedDocument) !== JSON.stringify(scenes.get(second))) throw Error("Wrong scene save baseline");
          scenes.set(second, structuredClone(args.document)); return { path: second, document: args.document };
        }
        throw Error("Unexpected command: " + command);
      } } };
    }, { project, first, second, document, metadata, pngSize: png.length });
    const url = new URL("./", parent.url()); url.searchParams.set("projectPath", project); url.searchParams.set("preserveDrawingBuffer", "true");
    await page.goto(url.href, { waitUntil: "networkidle" });
    await wait(() => window.ferrumPlacementViewerRuntimeFrame?.entityCount === 6);
    await page.locator("[data-placement-language]").selectOption("en");
    await showPlacementMenu(page, "file"); await page.locator("[data-placement-action=scene-explorer]").click();
    const explorer = page.locator(".placement-scene-explorer:visible");
    await explorer.locator(`[data-placement-project-scene="${second}"]`).dblclick();
    await wait(key => window.ferrumPlacementWorkspaceActiveDocument === key, second);
    assert.match(await explorer.locator("[role=status]").textContent(), /Could not read public\/locked/);
    assert.equal(await explorer.getByRole("option").count(), 2);
    await page.locator("[data-placement-language]").selectOption("ko");
    assert.match(await explorer.locator("[role=status]").textContent(), /읽기 실패/);
    await page.locator("[data-placement-language]").selectOption("en");
    const handoff = await page.evaluate(() => window.ferrumPlacementViewerAgentHandoff);
    assert(handoff.asepriteImports.some(entry => entry.assetId === assetId && entry.persisted));
    await page.locator(`[data-placement-close-document="${first}"]`).click();
    await wait(() => window.ferrumPlacementWorkspaceDocuments.length === 1);
    const resources = await page.evaluate(() => ({ urls: window.__sharedSceneAtlasUrls, revoked: window.__sharedSceneRevokedUrls }));
    assert(resources.urls.length > 0); assert(resources.urls.every(url => !resources.revoked.includes(url)));
    const { pixels } = decodePng(await page.locator("canvas.demo-canvas").screenshot());
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 180 && pixels[i + 1] < 80 && pixels[i + 2] > 140) colored++;
    assert(colored > 100, "Shared atlas must still render after the source document closes");
    await showPlacementInspector(page);
    await page.evaluate(() => window.ferrumPlacementViewerSelect("crate_left"));
    const x = page.locator("input[data-placement-transform-field=x]:visible"); await x.fill("470"); await x.press("Enter");
    await wait(() => !!window.ferrumPlacementViewerExportPatch());
    assert.equal((await page.evaluate(() => window.ferrumPlacementViewerSaveDraft())).saved, true);
    await page.locator("[data-placement-document-file]").setInputFiles({ name: "foreign.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
    await wait(() => document.querySelector(".placement-workspace-message").textContent.includes("Install imported assets"));
    assert.equal(await page.evaluate(() => window.ferrumPlacementWorkspaceActiveDocument), second);
    assert.equal(await page.evaluate(() => window.ferrumPlacementWorkspaceDocuments.length), 1);
    assert.deepEqual(errors, []);
    const report = { fakeBridge: true, sharedPersistedAtlas: true, sourceDocumentCloseRetainsTexture: true, coloredPixels: colored, sharedSceneSave: true, foreignFileBlocked: true, partialScanWarnings: true, pageErrors: errors };
    await writeFile("artifacts/placement-scene-explorer/project-assets.json", JSON.stringify(report, null, 2) + "\n");
    return report;
  } finally { await page.close(); }
}
