import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  tileFixture,
  tileMapFixture,
  multiTileFixture,
  externalTileFixture,
} from "./tile-import-fixtures.mjs";

/** Actual Rust filesystem/protocol; only IPC transport is replaced by the harness. */
export async function smokeNativeTiles({
  getPage,
  kind,
  mode,
  multi = false,
  external: externalTsj = false,
  project,
  scene,
  initial,
  run,
  origin,
  tool,
  action,
  reveal,
  restart,
  close,
  setCorrupt,
  holdSave,
  waitHeld,
  releaseSave,
  freshGame,
  protocol,
  tamperOpen,
}) {
  const root = join(project, "public/assets/.ferrum-tiles"),
    idle = () =>
      getPage().waitForFunction(
        () =>
          document.querySelector("[data-placement-tile-tool]").dataset
            .tileBusy === "false",
      ),
    click = async (name) => {
      await action(name).click();
      await idle();
    },
    status = () => tool().locator("[data-tile-status]").textContent(),
    imports = () =>
      getPage().evaluate(() =>
        structuredClone(
          window.ferrumPlacementViewerAgentHandoff.tileImports ?? [],
        ),
      );
  const wholeMap=mode==='2d'&&!multi&&!externalTsj;
  let mapTarget;
  const stage = async (updated) => {
    const previousKey = multi
      ? await tool().getByLabel("Tileset", { exact: true }).inputValue()
      : undefined;
    if (multi)
      await getPage().evaluate(() => {
        const original = File.prototype.arrayBuffer;
        window.restoreTileFileReader = () => {
          File.prototype.arrayBuffer = original;
        };
        File.prototype.arrayBuffer = function () {
          return this.name.endsWith(".json")
            ? new Promise((resolve) => setTimeout(resolve, 120)).then(() =>
                original.call(this),
              )
            : original.call(this);
        };
      });
    const data = externalTsj
      ? externalTileFixture(updated)
      : multi
        ? multiTileFixture(kind, updated)
        : wholeMap ? tileMapFixture(kind,updated) : tileFixture(kind, updated);
    await reveal();
    await tool().getByRole("tab", { name: "Source", exact: true }).click();
    await tool()
      .getByLabel("Tile source format", { exact: true })
      .selectOption(kind);
    await tool().getByLabel("Tile asset name", { exact: true }).fill("terrain");
    await tool()
      .getByLabel("Tile JSON", { exact: true })
      .setInputFiles({
        name: kind + ".json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(data.json)),
      });
    if (externalTsj) {
      await idle();
      if (!updated && !(await imports()).length)
        assert.match(await status(), /missing external TSJ/);
      await tool()
        .getByLabel("External TSJ Files", { exact: true })
        .setInputFiles(
          data.dependencies.map((d) => ({
            name: d.name,
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(d.json)),
          })),
        );
    }
    await tool().getByLabel("Tileset PNG", { exact: true }).setInputFiles({
      name: "tiles.png",
      mimeType: "image/png",
      buffer: data.png,
    });
    if (multi) {
      await idle();
      if (updated)
        assert.equal(
          await tool().getByLabel("Tileset", { exact: true }).inputValue(),
          previousKey,
        );
      await tool()
        .getByLabel("Tileset", { exact: true })
        .selectOption(kind === "tiled" ? "tiled:terrain" : "ldtk:7");
    }
    if (multi)
      await getPage().evaluate(() => {
        window.restoreTileFileReader();
        delete window.restoreTileFileReader;
      });
    await click("inspect");
    assert.equal(
      await tool().getAttribute("data-tile-ready"),
      "true",
      await status(),
    );
  };
  await stage(false);
  for (const [instance, frame] of [
    ["sprite", "terrain.0"],
    ["second", "terrain.1"],
  ]) {
    await getPage().evaluate(
      (id) => window.ferrumPlacementViewerSelect(id),
      instance,
    );
    await reveal();
    await tool().getByRole("tab", { name: "Preview", exact: true }).click();
    await tool().getByLabel("Tile frame", { exact: true }).selectOption(frame);
    await click("apply");
    assert.match(await status(), /^Applied/);
  }
  if(wholeMap){
    await tool().getByRole('tab',{name:'Source',exact:true}).click();
    await tool().locator('details').first().evaluate(el=>{el.open=true;});
    const mapping={};const data=tileFixture(kind);
    if(kind==='ldtk')for(const layer of data.json.levels[0].layerInstances)for(const e of layer.entityInstances??[])mapping[e.__identifier]='map_spawn';
    await tool().getByLabel('Map placement options (JSON)',{exact:true}).fill(JSON.stringify({originX:-60,originY:48,objectPrefabs:mapping}));
    await click('map');assert.match(await status(),/^Applied/);
    mapTarget=await getPage().evaluate(()=>window.ferrumPlacementViewerState.draftPatch.operations.find(op=>op.kind==='addInstance'&&op.instance.props?.tileMapImport?.cell?.column===0&&op.instance.props?.tileMapImport?.cell?.row===1).instance);
    await getPage().evaluate(id=>window.ferrumPlacementViewerUpdateBehaviorBinding({kind:'instance',instanceId:id},'map_guard'),mapTarget.id);
  }
  const first = (await imports())[0],
    id = first.assetId;
  assert.equal(first.persisted, false);
  if (multi) {
    assert.equal(first.selection.omittedTileInstances, 1);
    assert.equal(first.selection.sourceTilesets, 2);
    assert.match(
      await tool().locator("[data-tile-info]").textContent(),
      /1 other tiles excluded/,
    );
    await tool().getByRole("tab", { name: "Source", exact: true }).click();
    await tool()
      .getByLabel("Tileset", { exact: true })
      .selectOption(kind === "tiled" ? "tiled:decor" : "ldtk:8");
    await click("inspect");
    assert.match(await status(), /PNG filename differs/);
    assert.equal((await imports())[0].assetId, id);
    await tool()
      .getByLabel("Tileset", { exact: true })
      .selectOption(first.tilesetKey);
    await click("inspect");
  }
  await mkdir(root, { recursive: true });
  const conflict = join(root, id + ".json");
  await writeFile(conflict, "external");
  await click("save");
  assert.match(await status(), /^Project save failed/);
  assert.equal(await readFile(conflict, "utf8"), "external");
  assert.deepEqual(JSON.parse(await readFile(scene)), initial);
  await unlink(conflict);
  setCorrupt(true);
  await click("save");
  assert.match(await status(), /^Project save failed/);
  assert.equal((await imports())[0].persisted, false);
  assert.deepEqual(JSON.parse(await readFile(scene)), initial);
  setCorrupt(false);
  holdSave();
  await action("save").click();
  await waitHeld();
  await action("cancel").click();
  releaseSave();
  await getPage().waitForTimeout(100);
  assert.equal((await imports())[0].persisted, false);
  assert.deepEqual(JSON.parse(await readFile(scene)), initial);
  await click("save");
  assert.match(await status(), /^Project saved/);
  assert.equal((await imports())[0].persisted, true);
  const saved = JSON.parse(await readFile(scene)),
    catalog = JSON.parse(await readFile(join(root, "catalog.json")));
  if(wholeMap)assert(Object.values(saved.sceneComposition.fragments).flatMap(f=>f.instances??[]).filter(i=>i.props?.tileMapImport).length>=2);
  assert.equal(catalog.revisions.length, 1);
  assert.equal(catalog.revisions[0].frames, undefined);
  if (multi) assert.equal(catalog.revisions[0].tilesetKey, first.tilesetKey);
  if (externalTsj) {
    assert.equal(catalog.revisions[0].dependencies.length, 2);
    const data = externalTileFixture();
    for (const [i, d] of catalog.revisions[0].dependencies.entries())
      assert.equal(
        await readFile(join(root, `${id}.dep.${i}.tsj`), "utf8"),
        JSON.stringify(
          data.dependencies.find((x) => x.source === d.source).json,
        ),
      );
    assert.equal(
      await readFile(join(root, id + ".json"), "utf8"),
      JSON.stringify(data.json),
    );
  }
  assert(!(await readdir(root)).some((n) => n.endsWith(".tmp")));
  if(wholeMap&&kind==='tiled'){
    // Simulate a saved pre-coordinate release while keeping its public IDs and exact source catalog.
    for(const i of saved.sceneComposition.fragments.main.instances){const m=i.props?.tileMapImport;if(!m?.cell)continue;m.key='tile:'+m.cell.layer+':'+(m.cell.row*2+m.cell.column);delete m.cell;}
    await writeFile(scene,JSON.stringify(saved));
  }
  await restart();
  assert.equal((await imports())[0].assetId, id);
  assert.equal((await imports())[0].persisted, true);
  assert.equal(
    await tool().getByLabel("Tile asset name", { exact: true }).inputValue(),
    "terrain",
  );
  if (multi)
    assert.equal(
      await tool().getByLabel("Tileset", { exact: true }).inputValue(),
      first.tilesetKey,
    );
  // Unchanged source re-selection keeps the chosen key even when JSON reads finish late.
  if (multi) await stage(false);
  else await click("inspect");
  await click("register");
  assert.equal((await imports())[0].assetId, id);
  await stage(true);
  await click("reimport");
  assert.match(await status(), /^Applied/);
  if(wholeMap){await click('map');assert.match(await status(),/^Applied/);}
  const next = (await imports())[0];
  assert.notEqual(next.assetId, id);
  if (externalTsj) assert.equal(next.jsonSha256, first.jsonSha256);
  await getPage()
    .locator('[data-placement-action="undo"]:visible')
    .first()
    .click();
  await getPage().waitForFunction(
    (id) =>
      window.ferrumPlacementViewerAgentHandoff.tileImports?.[0]?.assetId === id,
    id,
  );
  await getPage()
    .locator('[data-placement-action="redo"]:visible')
    .first()
    .click();
  await getPage().waitForFunction(
    (id) =>
      window.ferrumPlacementViewerAgentHandoff.tileImports?.[0]?.assetId === id,
    next.assetId,
  );
  const external = structuredClone(saved);
  external.sceneComposition.fragments.main.instances[0].x += 17;
  await writeFile(scene, JSON.stringify(external));
  await reveal();
  await click("save");
  assert.match(await status(), /^Project save failed/);
  assert.deepEqual(JSON.parse(await readFile(scene)), external);
  assert.equal((await imports())[0].persisted, true);
  await writeFile(scene, JSON.stringify(saved));
  await click("save");
  assert.match(await status(), /^Project saved/);
  const finalBytes = await readFile(scene),
    finalDoc = JSON.parse(finalBytes),
    instances = finalDoc.sceneComposition.fragments.main.instances;
  assert(
    instances.filter(i=>i.id==='first'||i.id==='second').every((i) => i.props.components.visual.texture === next.assetId),
  );
  if(wholeMap){
    const imported=instances.filter(i=>i.props?.tileMapImport);
    assert(imported.length>=2);
    assert(imported.every(i=>i.props.tileMapImport.assetId===next.assetId));
    assert(imported.filter(i=>i.props.tileMapImport.key.startsWith('tile:')).every(i=>i.props.components.visual.asset===next.assetId));
    assert.equal(imported.filter(i=>i.props.tileMapImport.cell).length,5);
    const target=imported.find(i=>i.id===mapTarget.id);assert.deepEqual([target.x,target.y,target.props.behaviorRecipes],[mapTarget.x,mapTarget.y,'map_guard']);
    assert.deepEqual(target.props.tileMapImport.cell,{layer:'ground',column:0,row:1});
  }
  assert.notDeepEqual(
    instances[0].props.components.visual.frame,
    instances[1].props.components.visual.frame,
  );
  await restart();
  assert.equal((await imports())[0].assetId, next.assetId);
  assert.equal((await imports())[0].persisted, true);
  const download = getPage().waitForEvent("download");
  await click("export");
  const exportPath = join(run, `${kind}-${mode}-assets.json`);
  await (await download).saveAs(exportPath);
  const exported = JSON.parse(await readFile(exportPath));
  assert.equal(exported.revisions.length, 2);
  assert(
    exported.revisions.every(
      (r) => r.imported && r.identityDocument && r.persisted,
    ),
  );
  if (externalTsj) {
    assert.equal(
      exported.files.filter((f) => f.path.endsWith(".tsj")).length,
      4,
    );
    for (const r of exported.revisions) assert.equal(r.dependencies.length, 2);
  }
  const savedGame = await freshGame();
  assert(savedGame.bluePixels > 100 && savedGame.greenPixels > 100);
  // Cached protocol references also reject changed content, before a fresh host reload.
  const nativeCatalog = await getPage().evaluate(async () =>
    window.__TAURI__.core.invoke("load_placement_tile_assets", {
      projectPath: new URL(location.href).searchParams.get("projectPath"),
    }),
  );
  const pngUrl = nativeCatalog.assets.find(
    (a) => a.metadata.assetId === next.assetId,
  ).pngUrl;
  const path = join(root, next.assetId + ".png"),
    raw = await readFile(path);
  await writeFile(path, "tampered");
  assert.notEqual((await protocol(pngUrl)).status, 200);
  if (externalTsj) {
    const dep = nativeCatalog.assets.find(
      (a) => a.metadata.assetId === next.assetId,
    ).dependencies[0];
    const depPath = join(root, next.assetId + ".dep.0.tsj");
    const bytes = await readFile(depPath);
    await writeFile(depPath, "tampered TSJ");
    assert.notEqual((await protocol(dep.jsonUrl)).status, 200);
    await writeFile(depPath, bytes);
  }
  // Restore before close (runtime is already loaded), then tamper after the resource check.
  await writeFile(path, raw);
  await getPage().screenshot({
    path: join(run, `${kind}-${mode}-saved.png`),
    fullPage: true,
  });
  await writeFile(path, "tampered");
  assert.match(await tamperOpen(), /SHA-256|byte limit/);
  assert.deepEqual(await readFile(scene), finalBytes);
  await writeFile(path, raw);
  return {
    kind,
    mode,
    ...(multi
      ? {
          namedTilesetSelection: true,
          omittedTilesReported: true,
          pngMismatchPreservesScene: true,
          selectedKeyRestored: true,
        }
      : {}),
    ...(externalTsj
      ? {
          externalTsjOriginals: true,
          tsjDependencyProtocol: true,
          tsjReimportWithoutMapChange: true,
          rawDependencyExport: true,
          missingTsjDiagnosed: true,
        }
      : {}),
    dpr: mode === "hd2d" ? 2 : 1,
    realRustStorageAndProtocol: true,
    conflictPreserved: true,
    corruptReplyBlocked: true,
    cancelBlockedScene: true,
    sourceOnlyCatalog: true,
    restartedTwice: true,
    canonicalIdentity: true,
    reimportUndoRedo: true,
    ...(wholeMap?{wholeMapSavedAndReopened:true,stableMapIds:true,resizedCellIdentity:true,instanceBehaviorPreserved:true,legacySourceMigration:kind==='tiled'}:{}),
    sceneCasPreserved: true,
    rawExport: true,
    tamperRejected: true,
    savedManifestGame: savedGame,
    released: { urls: 0, textures: 0 },
  };
}
