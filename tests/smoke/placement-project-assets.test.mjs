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
