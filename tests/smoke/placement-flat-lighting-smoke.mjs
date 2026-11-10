import assert from "node:assert/strict";
import { encodePngRgba } from "../../scripts/tools/pack-textures.mjs";
import { closeSmokePage } from "./browser-page-cleanup.mjs";

/** Real official app host: cold apply, data upload, draft, tab restore and Playing. */
export async function smokePlacementFlatLighting(parent, timeoutMs = 30000) {
  const page = await parent.context().browser().newPage({ viewport: { width: 1440, height: 960 } });
  let failure;
  try {
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if(message.type() === "error") errors.push(message.text()); });
    const visual = { kind: "sprite", texture: "floor", width: 96, height: 64, lighting: { mode: "opaque", lightMask: 1, shadowMask: 0 }, surface: { emission: [0.001, 0, 0], specular: 0.2, roughness: 0.7, specularTexture: "crate" } };
    const scene = { format: "ferrum2d.consumer.scene-authoring", version: 1, lighting: { profile: "lit", ambientIrradiance: [0, 0, 0], pointLights: [
      { x: 800, y: 480, radius: 10000, height: 100, color: [1, 0, 0], intensity: 1, lightMask: 1, cookie: { texture: "crate", rotationRadians: 0, uv: [1, 0, 0, 1] } },
      { x: 800, y: 480, radius: 10000, height: 100, color: [0, 0, 1], intensity: 1, lightMask: 2, cookie: { texture: "crate" } },
    ] }, sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: { instances: [{ id: "receiver", prefab: "object", x: 800, y: 480, props: { components: { visual, collider: "none", layer: "wall" } } }] } } }, behaviorRecipes: { entities: {} } };
    await page.route("**/placement.scene-authoring.json", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(scene) }));
    // Identical dimensions make the separate source atlas a valid surface map.
    const pixels = encodePngRgba(2, 2, new Uint8Array(Array(4).fill([255, 255, 255, 255]).flat()));
    const translucentPng = encodePngRgba(2, 2, new Uint8Array(Array(4).fill([255, 255, 255, 128]).flat()));
    const cookiePng = encodePngRgba(2, 2, new Uint8Array(Array(4).fill([128, 255, 255, 128]).flat()));
    // Built-in preview textures are data URLs and do not pass through routing.
    // Keep their normal loader/decode/upload path, replacing just fixture bytes.
    await page.addInitScript(({ opaque, translucent, cookie }) => {
      const fetchSource = window.fetch.bind(window);
      window.fetch = (input, options) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return fetchSource(url.startsWith("data:image/png;base64,")
          ? location.search.includes("legacy-alpha") ? translucent
            : url.includes("nGOI2FL3HwAFfAKKSdpdew") ? cookie : opaque : input, options);
      };
    }, { opaque: `data:image/png;base64,${pixels.toString("base64")}`, translucent: `data:image/png;base64,${translucentPng.toString("base64")}`, cookie: `data:image/png;base64,${cookiePng.toString("base64")}` });
    await page.route("**/*.png", route => route.fulfill({ contentType: "image/png", body: pixels }));
    await page.goto(new URL("/", parent.url()).href);
    await page.waitForFunction(() => window.ferrumPlacementViewerRuntimeFrame?.entityCount === 1 && window.ferrumPlacementViewerState?.lighting?.profile === "lit", undefined, { timeout: timeoutMs });
    const initial = await page.evaluate(() => window.ferrumPlacementWorkspaceActiveDocument);
    const sample = (offset = 0) => page.evaluate(async offset => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const state = window.ferrumPlacementViewerState, canvas = document.querySelector("canvas.demo-canvas"), gl = canvas.getContext("webgl2"), viewport = state.viewport;
      const instance = state.instances.find(i => i.instanceId === "receiver"), x = (instance.transform.x + offset - viewport.worldMinX) * viewport.zoom, y = (instance.transform.y + offset - viewport.worldMinY) * viewport.zoom;
      const result = new Uint8Array(4);
      gl.readPixels(Math.round(x * canvas.width / canvas.clientWidth), canvas.height - 1 - Math.round(y * canvas.height / canvas.clientHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, result);
      return [...result];
    }, offset);
    const red = await sample(); assert(red[0] > 60 && red[2] < 10, `initial masked red receiver: ${red}`);
    await page.evaluate(visual => window.ferrumPlacementViewerUpdateComponents("receiver", { visual: { ...visual, lighting: { ...visual.lighting, lightMask: 2 } }, collider: "none", layer: "wall" }), visual);
    const blue = await sample(); assert(blue[2] > 60 && blue[0] < 20, `draft mask must reach native preview: ${blue}`);
    const beforeRejected = await page.evaluate(() => JSON.stringify({ document: window.ferrumPlacementSpatialExportDocument(), entity: window.ferrumPlacementViewerState.instances[0].entity, history: window.ferrumPlacementViewerHistory }));
    const invalid = structuredClone(scene);
    invalid.lighting.pointLights[0].cookie.texture = "floor";
    await page.locator("[data-placement-document-file]").setInputFiles({ name: "conflicting-lit.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
    await page.waitForFunction(() => document.querySelector(".placement-workspace-message")?.textContent.includes("both color and lighting data") && !document.querySelector(".demo-shell").inert);
    assert.equal(await page.evaluate(() => JSON.stringify({ document: window.ferrumPlacementSpatialExportDocument(), entity: window.ferrumPlacementViewerState.instances[0].entity, history: window.ferrumPlacementViewerHistory })), beforeRejected);
    assert.deepEqual(await sample(), blue, "Rejected asset roles preserve the current native scene and pixels");
    // Reopen a second document, then return to the patched first document.
    const second = structuredClone(scene);
    for (const light of second.lighting.pointLights) light.cookie.texture = "turret";
    second.sceneComposition.fragments.main.instances[0].props.components.visual.surface.roughnessTexture = "turret";
    await page.locator("[data-placement-document-file]").setInputFiles({ name: "other-lit.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(second)) });
    await page.waitForFunction(key => window.ferrumPlacementWorkspaceActiveDocument !== key && !document.querySelector(".demo-shell").inert, initial);
    const rawCookie = await sample();
    const linear = value => { const n = value / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; };
    const encode = n => Math.round(255 * (n <= .0031308 ? 12.92 * n : 1.055 * n ** (1 / 2.4) - .055));
    const expectedCookie = encode((linear(red[0]) - .001) * (128 / 255) ** 2 + .001);
    assert(Math.abs(rawCookie[0] - expectedCookie) <= 3 && rawCookie[2] < 10, `late cookie must use raw straight R*A: ${rawCookie}, expected ${expectedCookie}`);
    await page.locator(`[data-placement-document-key=${JSON.stringify(initial)}]`).click();
    await page.waitForFunction(key => window.ferrumPlacementWorkspaceActiveDocument === key, initial);
    const restored = await sample(); assert(restored[2] > 60 && restored[0] < 20, `tab restore preserves draft mask: ${restored}`);
    const polygonScene = structuredClone(scene);
    polygonScene.sceneComposition.fragments.main.instances[0].props.components.visual.lighting.shadowMask = 255;
    polygonScene.lighting.pointLights = [{ ...scene.lighting.pointLights[0], x: 700 }];
    polygonScene.lighting.shadows = { enabled: true, color: [0, 0, 0, 1], projectionLength: 512 };
    polygonScene.lighting.polygonOccluders = [{ vertices: [{ x: 760, y: 440 }, { x: 780, y: 480 }, { x: 760, y: 520 }] }];
    await page.locator("[data-placement-document-file]").setInputFiles({ name: "polygon-lit.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(polygonScene)) });
    await page.waitForFunction(key => window.ferrumPlacementWorkspaceActiveDocument !== key && !document.querySelector(".demo-shell").inert, initial);
    const polygon = await sample(); assert(polygon[0] < 10 && polygon[2] < 10, `cold polygon must occlude direct light: ${polygon}`);
    assert.deepEqual((await page.evaluate(() => window.ferrumPlacementSpatialExportDocument())).lighting.polygonOccluders, polygonScene.lighting.polygonOccluders);
    const polygonBefore = await page.evaluate(() => JSON.stringify({ document: window.ferrumPlacementSpatialExportDocument(), entity: window.ferrumPlacementViewerState.instances[0].entity, history: window.ferrumPlacementViewerHistory }));
    const invalidPolygon = structuredClone(polygonScene); invalidPolygon.lighting.polygonOccluders[0].vertices[1] = { x: 760, y: 480 };
    await page.locator("[data-placement-document-file]").setInputFiles({ name: "invalid-polygon-lit.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalidPolygon)) });
    await page.waitForFunction(() => document.querySelector(".placement-workspace-message")?.textContent.includes("convex") && !document.querySelector(".demo-shell").inert);
    assert.equal(await page.evaluate(() => JSON.stringify({ document: window.ferrumPlacementSpatialExportDocument(), entity: window.ferrumPlacementViewerState.instances[0].entity, history: window.ferrumPlacementViewerHistory })), polygonBefore);
    assert.deepEqual(await sample(), polygon);
    await page.locator(`[data-placement-document-key=${JSON.stringify(initial)}]`).click();
    await page.waitForFunction(key => window.ferrumPlacementWorkspaceActiveDocument === key, initial);
    assert.deepEqual(await sample(), restored, "polygon document switch must preserve the original cookie/mask draft");
    await page.locator('[data-placement-playback=play]').click();
    await page.waitForFunction(() => window.ferrumPlacementWorkspaceMode === "game");
    const playing = await sample(); assert(playing[2] > 60 && playing[0] < 20, `Playing preserves mask/material: ${playing}`);
    assert.deepEqual((await page.evaluate(() => window.ferrumPlacementSpatialExportDocument())).lighting.pointLights[0].cookie, scene.lighting.pointLights[0].cookie, "Playing/export must retain the authored cookie reference and explicit UV/rotation");
    // The same app upload policy must also preserve straight-alpha legacy input.
    // A half-alpha white texel should be ~135 over the dark canvas, not ~71.
    const legacy = structuredClone(scene); delete legacy.lighting;
    delete legacy.sceneComposition.fragments.main.instances[0].props.components.visual.lighting;
    delete legacy.sceneComposition.fragments.main.instances[0].props.components.visual.surface;
    await page.route("**/placement.scene-authoring.json", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(legacy) }));
    await page.route("**/*.png", route => route.fulfill({ contentType: "image/png", body: translucentPng }));
    await page.goto(new URL("/?legacy-alpha=true", parent.url()).href);
    await page.waitForFunction(() => window.ferrumPlacementViewerRuntimeFrame?.renderCommandCount === 1 && !window.ferrumPlacementViewerState?.lighting);
    const translucent = await sample(7);
    assert(translucent.slice(0, 3).every(channel => channel >= 120 && channel <= 150), `legacy straight-alpha preview: ${translucent}`);
    assert.deepEqual(errors, []);
    return { coldLitApply: true, straightAlphaAndDataMap: true, legacyTranslucentInput: true, cookieRawRedAlpha: true, cookieSourcePreserved: true, polygonColdApply: true, polygonSourcePreserved: true, polygonRejectedBeforeReplace: true, lateDataRole: true, failedPreflightPreservesScene: true, draftMask: true, tabRestore: true, playing: true, pixels: { red, blue, rawCookie, polygon, restored, playing, translucent } };
  } catch (error) { failure = error; throw error; }
  finally { await closeSmokePage(page, 10000, failure); }
}
