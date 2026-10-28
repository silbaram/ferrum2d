import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { showPlacementDock, showPlacementInspector } from "./placement-panel-navigation.mjs";

/** Runs on a separate page so the standard viewer/save fixtures retain their baseline. */
export async function smokePlacementLayers(parent, timeoutMs) {
  const output = "artifacts/placement-layers";
  await mkdir(output, { recursive: true });
  const dpr = await parent.evaluate(() => devicePixelRatio);
  const page = await parent.context().browser().newPage({ viewport: parent.viewportSize() ?? { width: 1280, height: 900 }, deviceScaleFactor: dpr }), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const wait = (predicate, arg) => page.waitForFunction(predicate, arg, { timeout: timeoutMs });
  const paint = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const panel = () => page.locator(".placement-panel:not([hidden]) .placement-layers");
  const row = layer => panel().locator(`[data-render-layer="${layer}"]`);
  const snapshot = () => page.evaluate(() => ({
    state: window.ferrumPlacementViewerState,
    history: window.ferrumPlacementViewerHistory,
    patch: window.ferrumPlacementViewerExportPatch() ?? null,
    commands: window.ferrumPlacementViewerRuntimeFrame.renderCommandCount,
  }));
  try {
    await page.goto(new URL("?scene=garden", parent.url()).href, { waitUntil: "networkidle" });
    await wait(() => window.ferrumPlacementViewerRuntimeFrame?.entityCount === 465);
    await page.locator("[data-placement-language]").selectOption("en");
    await showPlacementDock(page, "scene");
    await paint();
    const baseline = await snapshot();
    assert.equal(baseline.patch, null); assert.equal(await panel().locator("[data-render-layer]").count(), 3);
    assert.deepEqual(await panel().locator("[data-render-layer]").evaluateAll(rows => rows.map(row => Number(row.dataset.renderLayer))), [0, -90, -100]);
    // Inject a one-shot failure after a policy write, before presentation completes.
    // The real UI action must roll back selection as well as visibility and history.
    await page.evaluate(() => {
      window.ferrumPlacementViewerSelect("garden_hero");
      const viewer = window.__ferrumPlacementViewer, original = viewer.setLayerEditing;
      viewer.setLayerEditing = options => {
        viewer.setLayerEditing = original;
        original(options);
        throw new Error("Smoke: layer presentation rejected");
      };
    });
    await row(0).locator("[data-layer-control=visible]").click();
    const rejected = await snapshot();
    assert.deepEqual(rejected.state.selectedInstanceIds, ["garden_hero"]);
    assert.deepEqual(rejected.state.layerEditing, baseline.state.layerEditing);
    assert.deepEqual(rejected.history, baseline.history);
    assert.equal(rejected.patch, null);
    assert.match(await panel().locator('output[role=status]').textContent(), /layer presentation rejected/);
    await wait(expected => window.ferrumPlacementViewerRuntimeFrame.renderCommandCount === expected, baseline.commands);
    const pixels = await page.locator("canvas.demo-canvas").screenshot();
    await row(0).locator("[data-layer-control=visible]").click();
    await wait(() => window.ferrumPlacementViewerRuntimeFrame.renderCommandCount < 450);
    const hidden = await snapshot();
    assert.deepEqual(hidden.history, baseline.history); assert.equal(hidden.patch, null);
    assert.equal(hidden.state.selected, undefined);
    assert.notDeepEqual(await page.locator("canvas.demo-canvas").screenshot(), pixels, "Hiding must change real canvas pixels");
    const hiddenPick = await page.evaluate(() => {
      const viewer = window.__ferrumPlacementViewer, state = viewer.state(), actor = state.instances.find(i => i.instanceId === "garden_hero");
      const point = { x: (actor.transform.x - state.viewport.worldMinX) * state.viewport.zoom, y: (actor.transform.y - state.viewport.worldMinY) * state.viewport.zoom };
      return viewer.pickInstanceAtScreen(point)?.instanceId;
    });
    assert.notEqual(hiddenPick, "garden_hero");
    await page.screenshot({ path: `${output}/hidden-objects.png`, fullPage: true });
    await page.locator("[data-placement-playback=play]").click();
    await wait(() => window.ferrumPlacementWorkspaceMode === "game" && window.ferrumPlacementViewerRuntimeFrame.renderCommandCount >= 465);
    await page.locator("[data-placement-playback=stop]").click();
    await wait(() => window.ferrumPlacementWorkspaceMode === "2d" && window.ferrumPlacementViewerRuntimeFrame.renderCommandCount < 450);
    await row(-90).locator("[data-layer-control=solo]").click();
    await wait(() => window.ferrumPlacementViewerRuntimeFrame.renderCommandCount === 1);
    await row(-90).locator("[data-layer-control=solo]").click();
    await wait(() => window.ferrumPlacementViewerState.layerEditing.hiddenLayers.length === 1 && window.ferrumPlacementViewerState.layerEditing.hiddenLayers[0] === 0);
    await panel().getByRole("button", { name: "Show All", exact: true }).click();
    await wait(expected => window.ferrumPlacementViewerRuntimeFrame.renderCommandCount === expected, baseline.commands);

    // Isolation follows new layer numbers, Undo and preview mode changes.
    await row(0).locator("[data-layer-control=solo]").click();
    await paint();
    const soloCommands = (await snapshot()).commands;
    await page.evaluate(() => {
      window.ferrumPlacementViewerAddInstance("garden", { id: "layer_solo_new", prefab: "garden-hero", x: 760, y: 546, layer: 12 });
    });
    await wait(() => window.ferrumPlacementViewerState.layerEditing.hiddenLayers.includes(12));
    assert.equal((await snapshot()).commands, soloCommands);
    assert.equal(await row(0).locator("[data-layer-control=solo]").getAttribute("aria-pressed"), "true");
    await page.locator("[data-placement-action=undo]").click();
    await wait(() => window.ferrumPlacementViewerState.layerEditing.hiddenLayers.includes(-90) && !window.ferrumPlacementViewerExportPatch());
    await page.locator("[data-placement-playback=play]").click();
    await wait(() => window.ferrumPlacementWorkspaceMode === "game" && window.ferrumPlacementViewerRuntimeFrame.renderCommandCount >= 465);
    await page.locator("[data-placement-playback=stop]").click();
    await wait(expected => window.ferrumPlacementWorkspaceMode === "2d" && window.ferrumPlacementViewerRuntimeFrame.renderCommandCount === expected, soloCommands);
    assert.equal(await row(0).locator("[data-layer-control=solo]").getAttribute("aria-pressed"), "true");
    await row(0).locator("[data-layer-control=solo]").click();
    await wait(expected => window.ferrumPlacementViewerRuntimeFrame.renderCommandCount === expected, baseline.commands);
    await row(-90).locator("[data-layer-control=solo]").click();
    await page.evaluate(() => {
      window.__ferrumPlacementViewer.updateInstanceRenderLayers([{ instanceId: "garden_bridge", layer: 12 }]);
      window.ferrumPlacementViewerSelect();
    });
    await wait(() => window.ferrumPlacementViewerState.layerEditing.hiddenLayers.length === 0);
    assert.equal(await panel().locator('[data-layer-control=solo][aria-pressed="true"]').count(), 0);
    await page.locator("[data-placement-action=undo]").click();
    await wait(() => !window.ferrumPlacementViewerExportPatch());

    // The garden ground has individual locks. Layer unlocking must preserve them.
    await row(-100).locator("[data-layer-control=lock]").click();
    await row(-100).locator("[data-layer-control=lock]").click();
    assert.deepEqual((await snapshot()).state.individuallyLockedInstanceIds, baseline.state.individuallyLockedInstanceIds);
    await row(0).locator("[data-layer-control=lock]").click();
    assert((await snapshot()).state.lockedInstanceIds.includes("garden_hero"));
    await panel().getByRole("button", { name: "Unlock Layers", exact: true }).click();
    assert(!(await snapshot()).state.lockedInstanceIds.includes("garden_hero"));

    await row(-90).locator("[data-layer-control=filter]").click();
    await panel().getByLabel("Layer Alias", { exact: true }).fill("Bridge");
    await panel().getByLabel("Layer Alias", { exact: true }).press("Tab");
    assert.match(await row(-90).textContent(), /Bridge/);
    assert.equal((await snapshot()).patch, null);
    await panel().getByRole("button", { name: "Select Layer", exact: true }).click();
    assert.deepEqual((await snapshot()).state.selectedInstanceIds, ["garden_bridge"]);
    await row(0).locator("[data-layer-control=filter]").click();
    await panel().getByRole("button", { name: "Move Selection", exact: true }).click();
    await wait(() => window.ferrumPlacementViewerState.instances.find(i => i.instanceId === "garden_bridge").transform.layer === 0);
    assert.equal((await snapshot()).history.undoCount, baseline.history.undoCount + 1);
    await page.locator("[data-placement-action=undo]").click();
    await wait(() => !window.ferrumPlacementViewerExportPatch());
    await row(-90).dragTo(row(0));
    await wait(() => window.ferrumPlacementViewerState.instances.find(i => i.instanceId === "garden_hero").transform.layer === -90);
    assert.equal((await snapshot()).history.undoCount, baseline.history.undoCount + 1);
    await page.locator("[data-placement-action=undo]").click();
    await wait(() => !window.ferrumPlacementViewerExportPatch());

    // Sorting controls must preserve sprite animation, collider/body and shadow metadata.
    await page.evaluate(() => window.ferrumPlacementViewerSelect("garden_hero"));
    await showPlacementInspector(page);
    const transform = page.locator(".placement-panel:not([hidden]) [data-section=transform]");
    if (!(await transform.evaluate(element => element.open))) await transform.locator("summary").click();
    await transform.locator("[data-placement-transform-field=sortOrder]").fill("9");
    await transform.locator("[data-placement-transform-field=sortOrder]").press("Tab");
    await wait(() => window.ferrumPlacementViewerState.selected.visual.sortOrder === 9);
    const preserved = await page.evaluate(() => {
      const document = window.ferrumPlacementSpatialExportDocument();
      const hero = document.sceneComposition.fragments.garden.instances.find(instance => instance.id === "garden_hero");
      const components = hero.props?.components ?? document.sceneComposition.prefabs[hero.prefab].props.components;
      return { animation: components.visual.animationSet, shadow: components.visual.shadow, body: components.body, collision: components.layer };
    });
    assert(preserved.animation); assert(preserved.shadow); assert(preserved.body); assert.equal(preserved.collision, "player");
    await page.locator("[data-placement-action=undo]").click();
    await wait(() => !window.ferrumPlacementViewerExportPatch());
    await showPlacementDock(page, "scene");
    await row(0).locator("[data-layer-control=visible]").click();
    await row(-90).locator("[data-layer-control=lock]").click();
    const firstKey = await page.evaluate(() => window.ferrumPlacementWorkspaceActiveDocument);
    const source = await (await page.request.get(new URL("placement.garden.scene-authoring.json", page.url()).href)).body();
    await page.locator("[data-placement-document-file]").setInputFiles({ name: "layer-tab.scene-authoring.json", mimeType: "application/json", buffer: source });
    await wait(key => window.ferrumPlacementWorkspaceActiveDocument !== key && window.ferrumPlacementViewerState.layerEditing.hiddenLayers.length === 0 && window.ferrumPlacementViewerRuntimeFrame.renderCommandCount >= 465, firstKey);
    await page.locator(`[data-placement-document-key="${firstKey}"]`).click();
    await wait(() => window.ferrumPlacementViewerState.layerEditing.hiddenLayers.includes(0) && window.ferrumPlacementViewerState.layerEditing.lockedLayers.includes(-90) && window.ferrumPlacementViewerRuntimeFrame.renderCommandCount === 433);
    await panel().getByRole("button", { name: "Show All", exact: true }).click();
    await panel().getByRole("button", { name: "Unlock Layers", exact: true }).click();
    await page.locator("[data-placement-language]").selectOption("ko");
    await showPlacementDock(page, "scene");
    assert.equal(await panel().locator(":scope > summary").textContent(), "그리기 레이어");
    await page.screenshot({ path: `${output}/layers-ko.png`, fullPage: true });
    await page.reload({ waitUntil: "networkidle" });
    await wait(() => window.ferrumPlacementViewerRuntimeFrame?.entityCount === 465);
    await showPlacementDock(page, "scene");
    assert.match(await row(-90).textContent(), /Bridge/);
    assert.equal((await snapshot()).patch, null);

    // A spatial-only filter must not remain active behind the hidden 2D dropdown.
    await page.goto(new URL("?scene=village", parent.url()).href, { waitUntil: "networkidle" });
    await wait(() => window.ferrumPlacementViewerState?.spatial);
    await page.locator("[data-placement-language]").selectOption("en");
    await page.locator('[data-placement-mode="2d"]').click();
    await showPlacementDock(page, "scene");
    const initialObjects = await page.locator('.placement-panel:not([hidden]) .placement-instance-row:not([hidden])').count();
    const villageLayer = Number(await panel().locator('[data-render-layer]').first().getAttribute('data-render-layer'));
    await row(villageLayer).locator('[data-layer-control=filter]').click();
    const filteredObjects = await page.locator('.placement-panel:not([hidden]) .placement-instance-row:not([hidden])').count();
    await page.locator('[data-placement-mode="spatial"]').click();
    await page.locator('.placement-panel:not([hidden]) [data-placement-scene-layer-filter]').selectOption('terrain');
    await page.locator('[data-placement-mode="2d"]').click();
    assert.equal(await page.locator('.placement-panel:not([hidden]) [data-placement-scene-layer-filter]').inputValue(), String(villageLayer));
    assert.equal(await page.locator('.placement-panel:not([hidden]) .placement-instance-row:not([hidden])').count(), filteredObjects);
    await panel().getByRole('button', { name: 'All Layers', exact: true }).click();
    assert.equal(await page.locator('.placement-panel:not([hidden]) .placement-instance-row:not([hidden])').count(), initialObjects);
    assert.deepEqual(errors, []);
    await writeFile(`${output}/checks.json`, JSON.stringify({ ok: true, dpr, nativeCommands: baseline.commands,
      hiddenCommands: hidden.commands, checks: ["effective layers", "failed policy restores selection and visibility", "real framebuffer changes", "hidden picking", "game restores rendering", "solo restores visibility", "solo follows layer edits, undo and playback", "removed solo layer restores visibility", "2D/HD-2D filter restoration", "individual locks survive", "local alias", "move and drag order undo", "sorting preserves components", "document isolation and restore", "Korean labels", "alias reload"] }, null, 2));
  } finally { await page.close(); }
}
