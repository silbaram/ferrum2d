import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolvePixelPerfectOptions, resolvePixelPerfectPresentation } from "../../packages/ferrum-web/dist/core.js";

// Logic half of the flat Game Preview viewer smoke: which camera the editor returns to,
// and when pixel-perfect or fit presentation is applied. Pixels and pointer DPR stay in the browser.
const ts = createRequire(new URL("../../apps/studio/package.json", import.meta.url))("typescript");
const source = ts.transpileModule(await readFile("apps/studio/src/placementScenePresentation.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replaceAll('"@ferrum2d/ferrum-web/core"', JSON.stringify(new URL("../../packages/ferrum-web/dist/core.js", import.meta.url).href));
const { createPlacementScenePresentation } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

const flat = (display) => ({ format: "ferrum2d.consumer.scene-authoring", version: 1, ...(display ? { display } : {}) });
const pixelDocument = flat({ pixelPerfect: { width: 320, height: 180 } });
const fitDocument = flat({ fit: { x: 100, y: 40, width: 400, height: 200 } });

function fixture() {
  let presentation;
  const calls = [];
  let editCamera = { x: 850, y: 120, zoom: 2 };
  const canvas = {
    clientWidth: 800, clientHeight: 300,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 300 }),
  };
  const runtime = {
    engine: { cameraX: () => 160, cameraY: () => 90 },
    renderer: {
      setPixelPerfect(value) {
        calls.push(["pixel", value ? `${value.width}x${value.height}` : false]);
        const config = resolvePixelPerfectOptions(value);
        presentation = config ? resolvePixelPerfectPresentation(800, 300, config) : undefined;
      },
      pixelPerfectPresentation: () => presentation,
    },
  };
  const scene = createPlacementScenePresentation({
    runtime, canvas,
    camera: () => ({ ...editCamera }),
    restore: camera => { calls.push(["restore", { ...camera }]); editCamera = { ...camera }; },
    applyFit: camera => calls.push(["fit", { ...camera }]),
    setZoom: zoom => calls.push(["zoom", zoom]),
  });
  return { scene, calls, canvas, edit: camera => { editCamera = { ...camera }; } };
}

test("pixel-perfect Game Preview uses the game camera and returns to the captured edit camera", () => {
  const { scene, calls, edit } = fixture();
  const editCamera = { x: 850, y: 120, zoom: 2 };
  scene.capture("a", "game", pixelDocument);
  edit({ x: 1, y: 2, zoom: 3 });
  scene.capture("a", "game", pixelDocument);
  assert.deepEqual(scene.editingCamera("a"), editCamera, "only the first capture records the edit camera");
  assert.equal(scene.sync("a", "game", pixelDocument, 1), true);
  assert.deepEqual(calls, [["pixel", "320x180"], ["restore", { x: 160, y: 90, zoom: 1 }]]);
  assert.equal(scene.sync("a", "game", pixelDocument, 1), undefined, "an unchanged preview is not reapplied");

  calls.length = 0;
  assert.equal(scene.sync("a", "2d", pixelDocument, 1), true);
  assert.deepEqual(calls, [["pixel", false], ["restore", editCamera]]);
  assert.equal(scene.editingCamera("a"), undefined, "the restored camera is consumed");
});

test("fit Game Preview frames the authored rectangle and follows canvas resizes", () => {
  const { scene, calls, canvas } = fixture();
  scene.capture("a", "game", fitDocument);
  assert.equal(scene.sync("a", "game", fitDocument, 1), true);
  assert.deepEqual(calls, [["fit", { x: 300, y: 140, zoom: 1.5 }]]);
  calls.length = 0;
  canvas.clientWidth = 400;
  scene.resize();
  assert.deepEqual(calls, [["zoom", 1]]);
  canvas.clientWidth = 0;
  calls.length = 0;
  scene.resize();
  assert.deepEqual(calls, [], "a hidden canvas defers the fit zoom");
  canvas.clientWidth = 800;
  scene.sync("a", "2d", fitDocument, 1);
  assert.deepEqual(calls, [["restore", { x: 850, y: 120, zoom: 2 }]]);
  calls.length = 0;
  scene.resize();
  assert.deepEqual(calls, [], "leaving fit stops resize zoom updates");
});

test("each document keeps its own edit camera and spatial or plain documents never capture one", () => {
  const { scene, calls, edit } = fixture();
  scene.capture("a", "game", pixelDocument);
  edit({ x: 5, y: 6, zoom: 0.5 });
  scene.capture("b", "game", fitDocument);
  assert.deepEqual(scene.editingCamera("a"), { x: 850, y: 120, zoom: 2 });
  assert.deepEqual(scene.editingCamera("b"), { x: 5, y: 6, zoom: 0.5 });
  scene.forget("b");
  assert.equal(scene.editingCamera("b"), undefined);

  scene.capture("plain", "game", flat());
  scene.capture("spatial", "game", { ...pixelDocument, spatial: {} });
  scene.capture("editing", "2d", pixelDocument);
  for (const key of ["plain", "spatial", "editing"]) assert.equal(scene.editingCamera(key), undefined, key);
  assert.equal(scene.sync("plain", "game", flat(), 1), false);
  assert.deepEqual(calls, []);
});

test("letterbox bars reject pointer input only while a pixel presentation is active", () => {
  const { scene } = fixture();
  assert.equal(scene.contains({ x: 15, y: 25 }), true, "without pixel presentation every point is inside");
  scene.sync("a", "game", pixelDocument, 1);
  // 320x180 in an 800x300 canvas scales by 1 and centers with 240 px side bars.
  assert.equal(scene.contains({ x: 10 + 400, y: 20 + 150 }), true);
  assert.equal(scene.contains({ x: 10 + 100, y: 20 + 150 }), false);
  assert.equal(scene.contains({ x: 10 + 700, y: 20 + 150 }), false);
});
