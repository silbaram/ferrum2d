import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { showPlacementInspector, showPlacementMenu } from "./placement-panel-navigation.mjs";

export async function smokePlacementUpdates(parent, timeoutMs) {
  const browser = parent.context().browser(), page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  const output = "artifacts/placement-updates", projectPath = "/tmp/ferrum-update-browser-fixture";
  const document = await (await page.request.get(new URL("placement.scene-authoring.json", parent.url()).href)).json();
  const wait = (fn, arg) => page.waitForFunction(fn, arg, { timeout: timeoutMs });
  const dialog = page.locator("[data-placement-updates]");
  const action = name => dialog.locator(`[data-update-action=${name}]`);
  const status = name => dialog.locator(`[data-update-section=${name}] [role=status]`);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  let offline = false, signedMetadata = true;
  try {
    await mkdir(output, { recursive: true });
    await page.route("https://api.github.com/**", route => offline ? route.fulfill({ status: 403, body: "rate limited" }) : route.fulfill({ json: [{ draft: false, tag_name: "ferrum-web-v0.1.0-beta.10", assets: ["ferrum2d-placement-viewer-0.1.0-beta.10-linux-x64.deb", ...(signedMetadata ? ["viewer-updater-linux-x64.json"] : [])].map(name => ({ name, state: "uploaded" })) }] }));
    await page.addInitScript(({ projectPath, document }) => {
      window.__updateCalls = []; window.__updateDelay = false; window.__updateConfigured = false;
      const folder = path => ({ assetFolderPath: path, exists: true, imageCount: 0, images: [], models: [], diagnostics: [] });
      window.__TAURI__ = { event: { async listen(name, callback) { window.__updateProgress = callback; return () => { delete window.__updateProgress; }; } }, core: { async invoke(command, args) {
        window.__updateCalls.push({ command, args });
        if (command === "load_placement_project_folder") return { projectPath, sceneDocumentPath: projectPath + "/public/scene-authoring.json", handoffPath: projectPath + "/.ferrum-placement-handoff.json", assetFolder: folder(projectPath + "/public/assets"), document };
        if (command === "list_placement_project_scenes") return { scenes: [], truncated: false };
        if (command === "inspect_placement_asset_folder") return folder(args.assetFolderPath);
        if (command === "load_placement_tile_assets") return { format: "ferrum2d.tile-import.project", version: 1, assets: [] };
        if (command === "load_placement_aseprite_assets") return { format: "ferrum2d.aseprite.project", version: 1, assets: [] };
        if (command === "load_placement_normal_assets") return { format: "ferrum2d.sprite-normal.project", version: 1, registered: true, entries: [], textures: {} };
        if (command === "placement_update_info") return { viewerVersion: "0.1.0-beta.9", bundledEngineVersion: "0.1.0-beta.9", repository: "silbaram/ferrum2d", os: "linux", arch: "x64", configured: window.__updateConfigured, canInstall: window.__updateConfigured, reason: "This build has no update signing key" };
        if (command === "check_placement_project_update") {
          if (window.__updateNoNode) throw Error("Node.js is required for project engine updates");
          const reply = { ok: true, projectPath, currentVersion: "0.1.0-beta.9", latestVersion: "0.1.0-beta.10", available: true, manager: "pnpm" };
          if (window.__updateDelay) { window.__updateDelay = false; return new Promise(resolve => { window.__resolveUpdateCheck = () => resolve({ ...reply, latestVersion: "0.1.0-beta.99" }); }); }
          return reply;
        }
        if (command === "check_placement_viewer_update") return { available: true, version: "0.1.0-beta.10", token: "fixture-token" };
        if (command === "apply_placement_project_update") return { ok: true, version: "0.1.0-beta.10", backup: projectPath + "/.ferrum-updates/fixture" };
        if (command === "apply_placement_viewer_update") return new Promise(resolve => { window.__finishViewerUpdate = () => resolve({ installed: true, restartRequired: true }); });
        if (command === "restart_placement_viewer_after_update") return;
        if (command === "open_placement_release_page") return;
        if (command === "save_placement_agent_handoff") return { path: projectPath + "/.ferrum-placement-handoff.json", handoff: args.handoff };
        throw Error("Unexpected command: " + command);
      } } };
    }, { projectPath, document });
    const url = new URL("./", parent.url()); url.searchParams.set("projectPath", projectPath);
    await page.goto(url.href, { waitUntil: "networkidle" }); await wait(() => window.ferrumPlacementViewerRuntimeFrame?.entityCount === 6);
    await page.locator("[data-placement-language]").selectOption("en");
    const open = async () => { await showPlacementMenu(page, "file"); await page.locator("[data-placement-action=updates]").click(); };
    await open(); await wait(() => !document.querySelector('[data-update-action=project]').disabled);
    assert.equal(await page.locator(".demo-shell").evaluate(root => root.inert), true);
    assert(await action("viewer").isDisabled()); assert.match(await status("viewer").textContent(), /no update signing key/);
    offline = true; await action("check").click(); await wait(() => document.querySelector('[data-update-section=viewer] [role=status]').textContent.includes("403"));
    offline = false; signedMetadata = false; await page.evaluate(() => { window.__updateConfigured = true; });
    await action("check").click(); await wait(() => !document.querySelector('[data-update-action=check]').disabled);
    assert(await action("viewer").isDisabled()); assert.match(await status("viewer").textContent(), /no signed updater/);
    assert(await dialog.locator('[data-update-section=viewer] a').isVisible());
    signedMetadata = true; await page.evaluate(() => { window.__updateNoNode = true; });
    await action("check").click(); await wait(() => !document.querySelector('[data-update-action=check]').disabled);
    assert(await action("project").isDisabled()); assert.match(await status("project").textContent(), /Node.js is required/);
    await page.evaluate(() => { window.__updateNoNode = false; }); await action("check").click();
    await wait(() => !document.querySelector('[data-update-action=viewer]').disabled && !document.querySelector('[data-update-action=project]').disabled);
    assert(await action("viewer").isEnabled());
    await dialog.locator('[data-update-section=viewer] a').click();
    assert.equal(await page.evaluate(() => window.__updateCalls.find(c => c.command === "open_placement_release_page").args.url), "https://github.com/silbaram/ferrum2d/releases/tag/ferrum-web-v0.1.0-beta.10");
    await action("project").click(); await wait(() => document.querySelector('[data-update-section=project] [role=status]').textContent.includes("Engine updated"));
    const apply = await page.evaluate(() => window.__updateCalls.find(c => c.command === "apply_placement_project_update"));
    assert.deepEqual(apply.args, { projectPath, version: "0.1.0-beta.10", expectedVersion: "0.1.0-beta.9" });
    assert(await action("project").isDisabled());
    await action("viewer").click(); assert(await action("close").isDisabled());
    await page.keyboard.press("Escape"); assert(await dialog.isVisible());
    await page.evaluate(() => window.__updateProgress({ payload: { phase: "download", received: 1024, total: 2048 } }));
    assert.match(await status("viewer").textContent(), /Downloading 1 \/ 2 KiB/);
    await page.evaluate(() => window.__finishViewerUpdate()); await wait(() => document.querySelector('[data-update-action=viewer]').textContent === "Restart");
    await action("viewer").click(); await wait(() => window.__updateCalls.some(c => c.command === "restart_placement_viewer_after_update"));
    await action("close").click(); assert.equal(await page.locator(".demo-shell").evaluate(root => root.inert), false);
    // Running scenes and drafts in any tab prevent package installation/restart.
    await page.locator("[data-placement-playback=play]").click(); await open(); await wait(() => !document.querySelector('[data-update-action=project]').disabled);
    const before = await page.evaluate(() => window.__updateCalls.filter(c => c.command.startsWith("apply_")).length);
    await action("project").click(); assert.match(await status("project").textContent(), /Stop the running scene/);
    await action("close").click(); await page.locator("[data-placement-playback=stop]").click();
    await showPlacementInspector(page); await page.evaluate(() => window.ferrumPlacementViewerSelect("crate_left"));
    const x = page.locator("input[data-placement-transform-field=x]:visible"); await x.fill("470"); await x.press("Enter");
    await open(); await wait(() => !document.querySelector('[data-update-action=project]').disabled); await action("project").click();
    assert.match(await status("project").textContent(), /unsaved scene changes/);
    assert.equal(await page.evaluate(() => window.__updateCalls.filter(c => c.command.startsWith("apply_")).length), before);
    // Closing checks cancels UI ownership; an old reply cannot replace a reopened dialog.
    await action("close").click(); await page.evaluate(() => { window.__updateDelay = true; }); await open();
    await wait(() => typeof window.__resolveUpdateCheck === "function"); await action("close").click();
    await open(); await wait(() => !document.querySelector('[data-update-action=project]').disabled);
    await page.evaluate(() => window.__resolveUpdateCheck()); assert(!((await dialog.textContent()).includes("beta.99")));
    await action("close").click();
    await page.evaluate(() => { window.__updateConfigured = false; }); await page.locator("[data-placement-language]").selectOption("ko");
    await page.setViewportSize({ width: 680, height: 760 }); await open(); await wait(() => !document.querySelector('[data-update-action=check]').disabled);
    assert.match(await dialog.locator("h2").textContent(), /버전/); assert(await action("viewer").isEnabled()); // completed update still offers Restart
    assert.equal(await dialog.evaluate(element => element.getBoundingClientRect().right <= innerWidth), true);
    await page.screenshot({ path: `${output}/updates-ko-compact.png` });
    await action("close").click(); assert.deepEqual(errors, []);
    const web = await browser.newPage();
    try {
      await web.route("https://api.github.com/**", route => route.fulfill({ json: [{ draft: false, tag_name: "ferrum-web-v0.1.0-beta.10", assets: [] }] }));
      await web.goto(new URL("./", parent.url()).href, { waitUntil: "networkidle" });
      await web.locator("[data-placement-language]").selectOption("en");
      await showPlacementMenu(web, "file"); await web.locator("[data-placement-action=updates]").click();
      await web.waitForFunction(() => !document.querySelector('[data-update-action=check]').disabled);
      assert(await web.locator('[data-update-action=viewer]').isDisabled()); assert(await web.locator('[data-update-action=project]').isDisabled());
      assert.match(await web.locator('[data-update-section=viewer] [role=status]').textContent(), /Browser builds update when/);
    } finally { await web.close(); }
    const report = { ok: true, mockedNativeBridge: true, sdkPinnedApply: true, installProgress: true, restart: true, unsavedAndPlayingGuard: true, staleChecks: true, closeBlockedDuringInstall: true, koCompact: true, missingKeyAndNode: true, unsignedManualDownload: true, browserGuidance: true, offline: true, pageErrors: errors };
    await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + "\n"); return report;
  } finally { await page.close(); }
}
