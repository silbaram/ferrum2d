import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../apps/placement-viewer/package.json", import.meta.url));
const ts = require("typescript");
async function moduleUrl(name, imports = {}) {
  let code = ts.transpileModule(await readFile(new URL(`../../apps/placement-viewer/src/${name}.ts`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [from, url] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(from), JSON.stringify(url));
  return "data:text/javascript;base64," + Buffer.from(code).toString("base64");
}
const scopeUrl = await moduleUrl("placementAssetScope");
const { canUsePlacementAsset } = await import(scopeUrl);
const { createPlacementSpriteRevisions } = await import(await moduleUrl("placementSpriteRevisions", { "./placementAssetScope": scopeUrl }));

test("only verified assets in the same project can cross document boundaries", () => {
  const asset = { document: "first", persisted: false };
  assert(canUsePlacementAsset(asset, "first"));
  assert(!canUsePlacementAsset(asset, "second", "project-a"));
  asset.project = "project-a";
  assert(!canUsePlacementAsset(asset, "second", "project-a"));
  asset.persisted = true;
  assert(canUsePlacementAsset(asset, "second", "project-a"));
  assert(!canUsePlacementAsset(asset, "first", "project-b"));
  assert(!canUsePlacementAsset(asset, "second"));
});

test("closing the source scene retains project textures while releasing session textures exactly once", async () => {
  const released = [];
  const engine = { loadAssets: async () => {}, releaseAssets: request => released.push(...request.textures.map(t => t.name)) };
  const store = createPlacementSpriteRevisions(engine, () => false, { entries: 8, bytes: 1024 });
  const make = (id, persisted) => ({ id, name: id, document: "first", persisted, project: persisted ? "project-a" : undefined, png: new Uint8Array([1]).buffer, bytes: 1, uploaded: false });
  const saved = store.adopt(make("saved", true)), draft = store.adopt(make("draft", false));
  await store.upload(saved, new AbortController().signal); await store.upload(draft, new AbortController().signal);
  store.close("first");
  assert.deepEqual(store.entries().map(a => a.id), ["saved"]);
  assert.equal(saved.uploaded, true); assert(canUsePlacementAsset(saved, "second", "project-a"));
  assert.deepEqual(released, ["draft"]);
  store.destroy(); store.destroy();
  assert.deepEqual(released, ["draft", "saved"]);
});

test("explicit cleanup preserves retained, pending and persisted revisions while recovering the import budget", async () => {
  const engine = { loadAssets: async () => {}, releaseAssets() {} };
  const store = createPlacementSpriteRevisions(engine, () => false, { entries: 3, bytes: 3 });
  const make = id => ({ id, name: id, document: "scene", png: new Uint8Array([1]).buffer, bytes: 1, uploaded: false });
  const keep = store.adopt(make("history")), unused = store.adopt(make("unused")), saved = store.adopt({ ...make("saved"), persisted: true });
  await store.upload(unused, new AbortController().signal);
  assert.throws(() => store.adopt(make("next")), /budget/);
  assert.deepEqual(await store.collectUnused(new Set([keep.id])), { removed: 1, bytes: 1 });
  assert.deepEqual(store.entries().map(a => a.id), [keep.id, saved.id]);
  store.adopt(make("next")); store.destroy();
});

test("cleanup release failure retains source revisions and reconstructs released textures", async () => {
  let fail = false; const loads = [];
  const engine = { loadAssets: async r => loads.push(...Object.keys(r.textures)), releaseAssets() { if (fail) throw Error("release failed"); } };
  const store = createPlacementSpriteRevisions(engine, () => false, { entries: 8, bytes: 10 });
  const asset = store.adopt({ id: "atlas", name: "atlas", document: "scene", png: new Uint8Array([1]).buffer, bytes: 1, uploaded: false });
  await store.upload(asset, new AbortController().signal); const url = asset.url; fail = true;
  await assert.rejects(store.collectUnused(new Set()), /release failed/);
  assert.equal(store.entries()[0], asset); assert.equal(asset.url, url); assert.equal(asset.uploaded, true);
  assert.deepEqual(loads, ["atlas", "atlas"]); fail = false; store.destroy();
});

test("cleanup skips an in-flight upload", async () => {
  let finish; const engine = { loadAssets: () => new Promise(resolve => { finish = resolve; }), releaseAssets() {} };
  const store = createPlacementSpriteRevisions(engine, () => false, { entries: 8, bytes: 10 });
  const asset = store.adopt({ id: "pending", name: "pending", document: "scene", png: new Uint8Array([1]).buffer, bytes: 1, uploaded: false });
  const task = store.upload(asset, new AbortController().signal);
  assert.deepEqual(await store.collectUnused(new Set()), { removed: 0, bytes: 0 });
  finish(); await task; store.destroy();
});

const localeStub = 'data:text/javascript;base64,' + Buffer.from('export function setUiText() {}').toString('base64');
const { createPlacementImportDiagnostic } = await import(await moduleUrl("placementImportDiagnostics", { "./placementLocale": localeStub }));
test("import diagnostic preserves source identity and exact escaped scene pointers", () => {
  const scene = { prefabs: { "a/b~c": { visual: { texture: "old" } } }, instances: [{ visual: { texture: "old" } }] };
  const error = Object.assign(Error("Missing frame idle used by hero"), { importSource: { file: "hero.json", pointer: "/frames", item: "idle" }, assetId: "old" });
  const report = createPlacementImportDiagnostic(error, { document: "map.json", sourceFile: "fallback.json", scene });
  assert.deepEqual(report.source, { file: "hero.json", pointer: "/frames", item: "idle" });
  assert.deepEqual(report.scenePaths, ["/prefabs/a~1b~0c/visual/texture", "/instances/0/visual/texture"]);
  assert.equal(report.assetId, "old"); assert.equal(report.document, "map.json");
});

test("closing a store during cleanup rollback cannot resurrect its texture", async () => {
  let recover, fail = false, recovering = false; const released = [];
  const engine = {
    loadAssets: async () => { if (recovering) await new Promise(resolve => { recover = resolve; }); },
    releaseAssets(m) { if (fail) throw Error("release failed"); released.push(...m.textures.map(t => t.name)); },
  };
  const store = createPlacementSpriteRevisions(engine, () => false, { entries: 8, bytes: 10 });
  const a = store.adopt({ id: "closing", name: "closing", document: "scene", png: new Uint8Array([1]).buffer, bytes: 1, uploaded: false });
  await store.upload(a, new AbortController().signal);
  fail = recovering = true; const cleanup = store.collectUnused(new Set());
  fail = false; store.destroy(); recover(); await assert.rejects(cleanup, /release failed/);
  assert.equal(store.entries().length, 0); assert.equal(a.url, undefined); assert.deepEqual(released, ["closing", "closing"]);
});

test("failed cleanup reconstruction retains source bytes without leaking a stale URL", async () => {
  let fail = false;
  const engine = { loadAssets: async () => { if (fail) throw Error("reload failed"); }, releaseAssets() { if (fail) throw Error("release failed"); } };
  const store = createPlacementSpriteRevisions(engine, () => false, { entries: 8, bytes: 10 });
  const a = store.adopt({ id: "retry", name: "retry", document: "scene", png: new Uint8Array([1]).buffer, bytes: 1, uploaded: false });
  await store.upload(a, new AbortController().signal); fail = true;
  await assert.rejects(store.collectUnused(new Set()), /release failed/);
  assert.equal(store.entries()[0], a); assert.equal(a.url, undefined); assert.equal(a.uploaded, false); assert.equal(a.png.byteLength, 1);
  fail = false; await store.upload(a, new AbortController().signal); assert(a.uploaded); store.destroy();
});

test("import reports emitted before Problems mounts remain readable and clear without mutable aliases", async () => {
  const { installPlacementImportDiagnostics, readPlacementImportDiagnostics } = await import(await moduleUrl("placementImportDiagnostics", { "./placementLocale": localeStub }));
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  globalThis.document = { createElement: () => ({ dataset: {}, append() {}, textContent: "" }) };
  globalThis.window = new EventTarget();
  try {
    const panel = installPlacementImportDiagnostics({ append() {} }, "late-panel");
    const report = createPlacementImportDiagnostic(Error("Missing frame idle"), { document: "map.json", sourceFile: "hero.json", scene: {} });
    panel.update([report]);
    report.message = "modified by caller";
    const retained = readPlacementImportDiagnostics();
    assert.equal(retained.length, 1); assert.equal(retained[0].message, "Missing frame idle");
    retained[0].source.file = "modified.json";
    assert.equal(readPlacementImportDiagnostics()[0].source.file, "hero.json");
    panel.clear(); assert.deepEqual(readPlacementImportDiagnostics(), []);
  } finally { globalThis.document = previousDocument; globalThis.window = previousWindow; }
});

test("diagnostic collection bounds paths and traversal, tolerates cycles and retains shared source paths", () => {
  const shared = { visual: { texture: "old" } };
  const scene = { first: shared, second: shared }; scene.cycle = scene;
  const collect = scene => createPlacementImportDiagnostic(Error("frame"), { document: "scene", sourceFile: "atlas.json", scene, assetId: "old" });
  assert.deepEqual(collect(scene).scenePaths, ["/first/visual/texture", "/second/visual/texture"]);
  assert.equal(collect(scene).scenePathsTruncated, true);
  const many = Array.from({ length: 100 }, () => ({ texture: "old" }));
  assert.equal(collect(many).scenePaths.length, 64); assert.equal(collect(many).scenePathsTruncated, true);
  const deep = {}; let node = deep;
  for (let i = 0; i < 10000; i++) node = node.child = {};
  assert.equal(collect(deep).scenePathsTruncated, true);
  assert.equal(collect({ values: Array.from({ length: 70000 }, () => 1) }).scenePathsTruncated, true);
});
