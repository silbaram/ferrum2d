import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { placementSpatialRegressionFixture } from "./placement-test-build.mjs";
import { showPlacementMenu, openPlacementLightingAdvanced, showPlacementInspector } from "./placement-panel-navigation.mjs";

/** Exercises real UI -> patch -> Wasm -> renderer. Only the desktop file bridge is simulated. */
export async function smokePlacementLightingAdvanced(parent, timeoutMs = 30000) {
  const output = "artifacts/viewer-lighting";
  await mkdir(output, { recursive: true });
  const fixture = JSON.parse(await readFile(placementSpatialRegressionFixture, "utf8"));
  fixture.spatial.environment = { lighting: { enabled: true, ambient: [.18, .18, .18], lights: [
    { position: { x: -50, y: 0, elevation: 80 }, radius: 220 },
    { position: { x: 60, y: 20, elevation: 90 }, radius: 200 },
  ], directional: { direction: { x: -1, y: -1, elevation: 2 } } } };
  const page = await parent.context().browser().newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(document => {
    let saved = JSON.parse(sessionStorage.getItem("advanced-lighting-save") ?? "null") ?? document;
    window.__advancedLightingSaves = [];
    window.__TAURI__ = { core: { async invoke(command, args) {
      if (command === "load_placement_scene_document") return { path: "/tmp/advanced-lighting.json", document: structuredClone(saved) };
      if (command !== "save_placement_scene_document") throw Error("Unexpected command: " + command);
      if (JSON.stringify(args.expectedDocument) !== JSON.stringify(saved)) throw Error("Save conflict");
      saved = structuredClone(args.document); sessionStorage.setItem("advanced-lighting-save", JSON.stringify(saved));
      window.__advancedLightingSaves.push(structuredClone(args));
      return { path: "/tmp/advanced-lighting.json", document: structuredClone(saved) };
    } } };
  }, fixture);
  const wait = (fn, arg) => page.waitForFunction(fn, arg, { timeout: timeoutMs });
  const paint = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
  const source = () => page.evaluate(() => window.ferrumPlacementSpatialExportDocument());
  const save = () => page.evaluate(() => window.ferrumPlacementViewerSaveDraft());
  const saveCount = () => page.evaluate(() => window.__advancedLightingSaves.length);
  const history = () => page.evaluate(() => window.ferrumPlacementViewerHistory);
  const environment = async () => (await source()).spatial.environment;
  const field = name => page.locator(`[data-placement-lighting-field="${name}"]`);
  const open = () => showPlacementMenu(page, "lighting");
  const reveal = async control => { await open(); await openPlacementLightingAdvanced(control); return control; };
  const edit = async (name, value) => { const input = await reveal(field(name)); await input.fill(String(value)); await input.press("Enter"); await paint(); };
  const toggle = async (name, checked) => { const input = await reveal(page.locator(`[data-placement-lighting-toggle="${name}"]`)); await input.setChecked(checked); await paint(); };
  const select = async (name, value) => { const input = await reveal(page.locator(`[data-placement-lighting-select="${name}"]`)); await input.selectOption(value); await paint(); };
  const action = async name => { const button = await reveal(page.locator(`[data-placement-lighting-action="${name}"]`)); await button.click(); await paint(); };
  const undo = async () => { await page.evaluate(() => window.ferrumPlacementViewerUndo()); await paint(); };
  async function ready() {
    await wait(() => window.ferrumPlacementWorkspaceMode === "spatial" && window.ferrumPlacementViewerSaveEnabled === true);
    await page.locator("[data-placement-language]").selectOption("en");
    await page.evaluate(() => {
      const renderer = window.ferrumRuntime.renderer, draw = renderer.renderCommands;
      renderer.renderCommands = function(...args) {
        const values = (args[1] ?? args[0]).spatial?.environment?.values, stats = draw.apply(this, args);
        window.__advancedLightingNative = { values: values ? Array.from(values) : [], stats: structuredClone(stats) }; return stats;
      };
    });
    await paint();
  }
  try {
    const url = new URL(parent.url()); url.search = "?scene=hd2d";
    await page.goto(url.href, { waitUntil: "networkidle" }); await ready();
    // A focused receiver input can be the only edit; SaveDraft must create its patch.
    await showPlacementInspector(page, "properties");
    await page.locator("[data-placement-spatial-target]:visible").selectOption(`surface:${fixture.spatial.terrain[0].id}`);
    const receiverField = name => page.locator(`[data-placement-spatial-field="${name}"]:visible`);
    await receiverField("lightMask").focus();
    assert.equal(await save(), undefined, "An unchanged default channel must not author a patch");
    assert.equal(await saveCount(), 0);
    await receiverField("lightMask").fill("1");
    assert.equal(await page.evaluate(() => window.ferrumPlacementViewerExportPatch()), undefined);
    assert.equal((await save())?.saved, true, "Save must flush the only focused receiver edit");
    assert.equal((await source()).spatial.terrain[0].lightMask, 1);
    await page.locator("canvas.demo-canvas").focus(); await paint();
    assert.equal(await page.evaluate(() => window.ferrumPlacementViewerExportPatch()), undefined, "Blur after save must not reauthor the field");
    await receiverField("lightMask").focus(); assert.equal(await save(), undefined);
    assert.equal(await saveCount(), 1, "An unchanged focused channel must not save again");

    // An invalid pending field must block saving even when another valid draft exists.
    await receiverField("lightMask").fill("2"); await page.locator("canvas.demo-canvas").focus(); await paint();
    const acceptedReceiver = await source(), acceptedHistory = await history();
    for (const invalid of ["1.5", "256", "-1", ""]) {
      await receiverField("shadowMask").fill(invalid);
      assert.equal(await save(), undefined); await paint();
      assert.deepEqual(await source(), acceptedReceiver); assert.deepEqual(await history(), acceptedHistory);
      assert.equal(await saveCount(), 1);
      assert.equal(await receiverField("shadowMask").inputValue(), invalid);
      assert(await receiverField("shadowMask").evaluate(e => e === document.activeElement && !e.disabled));
    }
    await receiverField("shadowMask").fill("5");
    await page.evaluate(() => { const engine = window.ferrumEngine, original = engine.configureDataSceneSpatial; engine.configureDataSceneSpatial = function(...args) { engine.configureDataSceneSpatial = original; return false; }; });
    assert.equal(await save(), undefined, "Native rejection must block the save and roll back the field");
    assert.deepEqual(await source(), acceptedReceiver); assert.deepEqual(await history(), acceptedHistory);
    assert.equal(await saveCount(), 1);
    await receiverField("shadowMask").fill("5");
    assert.equal((await save())?.saved, true);
    assert.equal((await source()).spatial.terrain[0].shadowMask, 5);
    assert.deepEqual(await page.evaluate(() => window.__advancedLightingSaves.at(-1).document), await source());
    await page.reload({ waitUntil: "networkidle" }); await ready();
    assert.equal((await source()).spatial.terrain[0].lightMask, 2);
    assert.equal((await source()).spatial.terrain[0].shadowMask, 5);

    await toggle("sun-shadows", true); await toggle("sun-pcss", true); await edit("sun-pcss-radius", 1.2); await edit("sun-pcss-limit", 12);
    await select("sun-resolution", "128"); await edit("sun-lightMask", 3); await edit("sun-shadowMask", 5);
    for (const [index, radius] of [[0, 4], [1, 6]]) {
      await open(); await page.locator("[data-placement-lighting-point-index]").selectOption(String(index));
      await toggle("point-shadows", true); await toggle("point-pcss", true);
      await edit("point-pcss-radius", radius); await edit("point-pcss-limit", 12 + index * 2); await select("point-resolution", "128");
      await edit("point-lightMask", index + 1); await edit("point-shadowMask", index + 1);
    }
    await toggle("bloom", true); await select("bloom-mode", "wide"); await select("bloom-quality", "high"); await edit("bloom-radius", 64);
    assert.equal(await field("bloom-radius").getAttribute("max"), "96"); assert(await field("bloom-radius").evaluate(e => e.validity.valid));
    await toggle("selection", true); await edit("selection-hysteresis", .2); await edit("selection-fadeSeconds", .3); await edit("selection-resetDistance", 250);
    await select("fog-mode", "height"); await edit("fog-baseHeight", 10); await edit("fog-density", .002); await edit("fog-falloff", .03);
    await edit("fog-density", .000002); await field("fog-falloff").focus(); await paint();
    assert.equal(Number(await field("fog-density").inputValue()), .000002, "Small nonzero fog densities must not display as zero");
    await undo();
    await toggle("shafts", true); await edit("shaft-intensity", .4); await edit("shaft-density", .005); await select("shaft-quality", "low");
    await action("add-probe"); await edit("probe-x", -20); await edit("probe-radius", 140); await edit("probe-intensity", .5);
    const firstProbe = (await environment()).lighting.probes[0];
    await action("add-probe"); await edit("probe-x", 60); await edit("probe-intensity", 0);
    assert.deepEqual((await environment()).lighting.probes[0], firstProbe);
    assert.equal((await environment()).lighting.probes[1].intensity, 0, "Zero is authored dark fill, not removal");
    await action("remove-probe"); await undo(); assert.equal((await environment()).lighting.probes.length, 2);
    for (let i = 2; i < 8; i++) await action("add-probe");
    assert(await page.locator('[data-placement-lighting-action="add-probe"]').isDisabled());
    for (let i = 2; i < 8; i++) await undo();
    assert.equal((await environment()).lighting.probes.length, 2);
    await reveal(page.locator("[data-placement-lighting-probe-index]")); await page.locator("[data-placement-lighting-probe-index]").selectOption("0");

    // Receiver masks use the existing spatial patch path for terrain and billboards.
    await showPlacementInspector(page, "properties");
    for (const [kind, id] of [["surface", fixture.spatial.terrain[0].id], ["billboard", Object.keys(fixture.spatial.billboards)[0]]]) {
      await page.locator("[data-placement-spatial-target]:visible").selectOption(`${kind}:${id}`); await paint();
      for (const [name, value] of [["lightMask", 3], ["shadowMask", 5]]) {
        await receiverField(name).fill(String(value));
        await save(); await paint();
        const doc = await source(), receiver = kind === "surface" ? doc.spatial.terrain.find(s => s.id === id) : doc.spatial.billboards[id];
        assert.equal(receiver[name], value);
        assert.deepEqual(await page.evaluate(() => window.__advancedLightingSaves.at(-1).document), doc);
      }
    }
    await open(); await paint();
    const authored = await source(), env = authored.spatial.environment;
    assert.equal(env.composition, "separated"); assert.equal(env.bloom.mode, "wide"); assert.equal(env.bloom.radius, 64);
    assert.equal(env.lighting.directional.shadows.pcss.angularRadius, 1.2);
    assert.deepEqual(env.lighting.pointShadows.map(s => s.pcss.sourceRadius), [4, 6]);
    assert.equal(env.fog.height.baseHeight, 10); assert.equal(env.lightShafts.quality, "low");
    await wait(() => window.__advancedLightingNative?.values.length === 700);
    const native = await page.evaluate(() => window.__advancedLightingNative);
    // The known public environment layout is asserted independently from authored JSON.
    for (const at of [576, 580, 589, 592, 600, 604, 608, 616, 632]) assert.equal(native.values[at], 1, `Native extension at ${at}`);
    assert.equal(native.values[544], 3 | (5 << 8), "Packed sun light/shadow channels");
    assert.equal(native.values[545], 1 | (1 << 8)); assert.equal(native.values[546], 2 | (2 << 8));
    assert.equal(native.values[633], 2);
    assert.equal(native.stats.spatial.lightShaftDrawCalls, 2, "Shaft scattering plus resolve when AO is absent");
    assert.equal(native.stats.spatialLightShaftDrawCalls, 2, "Frame shaft draw budget without AO sharing");
    assert(native.stats.spatialBloomDrawCalls > 0 && native.stats.drawCalls <= 128);
    assert((await page.evaluate(() => window.ferrumPlacementViewerRuntimeFrame.entityCount)) > 0);
    console.log("Advanced lighting UI: native values and effect budgets verified; checking history and save.");

    await edit("sun-lightMask", 1.5); assert.deepEqual(await source(), authored); await field("sun-lightMask").press("Escape");
    await edit("bloom-radius", 97); assert.deepEqual(await source(), authored); await field("bloom-radius").press("Escape");
    await page.evaluate(() => { const engine = window.ferrumEngine, original = engine.configureDataSceneSpatial; engine.configureDataSceneSpatial = function(...args) { engine.configureDataSceneSpatial = original; return false; }; });
    await edit("shaft-intensity", .9); assert.deepEqual(await source(), authored); await field("shaft-intensity").press("Escape");
    await select("bloom-mode", "gather"); assert.equal((await environment()).bloom.radius, 24); await undo(); assert.deepEqual(await source(), authored);
    await toggle("sun-shadows", false); assert.equal((await environment()).lightShafts, undefined); await undo(); assert.deepEqual(await source(), authored);
    await action("remove-sun"); assert.equal((await environment()).lightShafts, undefined); await undo(); assert.deepEqual(await source(), authored);
    await open(); await page.locator('[data-placement-lighting-preset="Atmosphere Preset"]').selectOption("Interior"); await paint();
    assert.equal((await environment()).lightShafts, undefined); assert.equal((await environment()).lighting.directional.shadows, undefined);
    assert.equal((await environment()).bloom.mode, "wide"); assert(await page.locator(".placement-lighting-error").isHidden());
    await undo(); assert.deepEqual(await source(), authored);
    await toggle("enabled", false); assert.equal((await environment()).lighting.enabled, false); await toggle("enabled", true);
    assert.deepEqual(await source(), authored);
    await page.locator('[data-placement-playback="play"]').click(); await paint(); await reveal(field("shaft-intensity")); assert(await field("shaft-intensity").isDisabled());
    await page.locator('[data-placement-playback="stop"]').click(); await paint(); assert.deepEqual(await source(), authored);

    // Save must flush the focused wide-radius input, including values above the old 24 cap.
    await reveal(field("bloom-radius")); await field("bloom-radius").fill("80");
    assert.equal((await page.evaluate(() => window.ferrumPlacementViewerSaveDraft())).saved, true);
    const saved = await source(); assert.equal(saved.spatial.environment.bloom.radius, 80);
    assert.deepEqual(await page.evaluate(() => window.__advancedLightingSaves.at(-1).document), saved);
    await page.reload({ waitUntil: "networkidle" }); await ready(); assert.deepEqual(await source(), saved);
    for (const locale of ["ko", "en"]) {
      await page.locator("[data-placement-language]").selectOption(locale); await reveal(field("shaft-intensity"));
      await field("shaft-intensity").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/advanced-${locale}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 650 }); await page.locator("[data-placement-language]").selectOption("ko");
    await reveal(field("probe-intensity")); await field("probe-intensity").scrollIntoViewIfNeeded();
    const bounds = await field("probe-intensity").boundingBox(); assert(bounds.x >= 0 && bounds.x + bounds.width <= 391);
    await page.screenshot({ path: `${output}/advanced-compact.png`, fullPage: true });
    assert.deepEqual(errors, []);
    const result = { ok: true, native, checks: ["UI-authored PCSS, fog, shafts, probes, wide Bloom, selection and channels", "independent two-owner PCSS", "probe limit and zero intensity", "focused terrain/billboard receiver save and reload", "receiver no-op/blur, invalid input and native rejection save guards", "native extension values and bounded effect draws", "invalid value/native rejection rollback", "dependency removal in one undo", "wide-preserving Interior preset", "Play/Stop", "focused wide-radius save and reload", "KO/EN/compact"] };
    await writeFile(`${output}/advanced.json`, JSON.stringify(result, null, 2) + "\n"); return result;
  } catch (error) {
    await writeFile(`${output}/advanced-failure.json`, JSON.stringify({ message: error.message, native: await page.evaluate(() => window.__advancedLightingNative), errors }, null, 2));
    await page.screenshot({ path: `${output}/advanced-failure.png`, fullPage: true }); throw error;
  }
  finally { await page.close(); }
}
