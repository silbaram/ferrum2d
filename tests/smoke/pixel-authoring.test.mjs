import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { decodePng } from "../../scripts/tools/pack-textures.mjs";
const require = createRequire(new URL("../../apps/placement-viewer/package.json", import.meta.url));
const ts = require("typescript");
async function checkedImport(url) {
  try { return await import(url); }
  catch (error) {
    // Some Node test-runner modes can summarize already registered cases after
    // a rejected top-level bootstrap. Never report that partial suite as green.
    process.exitCode = 1;
    console.error("Pixel test module bootstrap failed:", String(error?.message ?? error).slice(0, 160));
    throw error;
  }
}
async function moduleUrl(name, imports = {}) {
  let code = ts.transpileModule(await readFile(new URL("../../apps/placement-viewer/src/" + name + ".ts", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [from, to] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(from), JSON.stringify(to));
  return "data:text/javascript;base64," + Buffer.from(code).toString("base64");
}
const documentUrl = await moduleUrl("placementPixelDocument");
const { createPixelEditor: create, newPixelDocument: blank, readPixelDocument: read, pixelBytes, pixelDocumentFromRgba, PIXEL_LIMITS } = await checkedImport(documentUrl);
const { pixelPng } = await checkedImport(await moduleUrl("placementPixelPng", { "./placementPixelDocument": documentUrl }));
const red = [255, 0, 0, 255], blue = [0, 0, 255, 255], transparent = [0, 0, 0, 0];
function stroke(editor, x0, y0, x1, y1, color = red) {
  editor.begin(); editor.line(x0, y0, x1, y1, color); editor.commit();
}
test("native source roundtrip retains pixel bytes, stable frame/layer IDs and palette without history", () => {
  const editor = create(blank(32, 32, "캐릭터"));
  stroke(editor, 1, 2, 5, 6);
  const source = read(JSON.stringify(editor.document()));
  assert.deepEqual(create(source).bytes(), editor.bytes());
  assert.equal(source.layer.id, "layer-1"); assert.equal(source.frame.id, "frame-1");
  assert.deepEqual(source.palette, editor.palette);
  assert.deepEqual(create(source).history(), { undo: 0, redo: 0, bytes: 0 });
});
test("reject invalid dimensions, metadata, version, color space, base64 and byte lengths before allocation", () => {
  for (const side of [0, -1, 257, NaN, Infinity, 1.5]) assert.throws(() => blank(side, 32));
  for (const patch of [
    { version: 2 }, { colorSpace: "linear" }, { width: 0 }, { name: "" },
    { rgba: "AAAA" }, { rgba: "*".repeat(blank().rgba.length) }, { palette: ["red"] },
    { layer: null }, { frame: { id: "frame", durationMs: 0 } },
  ]) assert.throws(() => read(JSON.stringify({ ...blank(), ...patch })));
  assert.throws(() => read(" ".repeat(PIXEL_LIMITS.documentBytes + 1)));
  assert.throws(() => read(JSON.stringify({ ...blank(), frame: { id: "frame", durationMs: 60001 } })), /Frame duration/);
});
test("fast pointer movement rasterizes a continuous line and commits as one Undo", () => {
  const editor = create(blank(32, 32));
  stroke(editor, 0, 0, 31, 31);
  for (let n = 0; n < 32; n++) assert.deepEqual(editor.sample(n, n), red);
  assert.equal(editor.history().undo, 1);
  editor.undo(); assert(editor.bytes().every(n => n === 0));
  editor.redo(); assert.deepEqual(editor.sample(31, 31), red);
});
test("stroke cancellation restores pixels without consuming Redo", () => {
  const editor = create(blank(8, 8));
  stroke(editor, 0, 0, 7, 0); editor.undo();
  editor.begin(); editor.line(0, 3, 7, 3, blue); editor.cancel();
  assert.equal(editor.history().undo, 0); assert.equal(editor.history().redo, 1);
  editor.redo(); assert.deepEqual(editor.sample(0, 0), red); assert.deepEqual(editor.sample(0, 3), transparent);
});
test("no-op edits keep Redo and actual edits invalidate it", () => {
  const editor = create(blank(4, 4));
  stroke(editor, 0, 0, 1, 0); editor.undo();
  stroke(editor, 0, 0, 1, 0, transparent); assert.equal(editor.history().redo, 1);
  stroke(editor, 1, 1, 2, 1, blue); assert.equal(editor.history().redo, 0);
});
test("clip captured pointer segments before walking pixels and reject invalid input", () => {
  const editor = create(blank(8, 8));
  stroke(editor, -100000, 3, 100000, 3);
  for (let x = 0; x < 8; x++) assert.deepEqual(editor.sample(x, 3), red);
  stroke(editor, -10, -10, -1, -1); assert.equal(editor.history().undo, 1);
  editor.begin(); assert.throws(() => editor.line(Infinity, 1, 1, 1, red)); editor.cancel();
  assert.equal(editor.sample(-1, 1), undefined);
});
test("bounded connected fill respects an enclosed border and cancels atomically", () => {
  const editor = create(blank(8, 8));
  stroke(editor, 3, 0, 3, 7);
  editor.begin(); editor.fill(0, 0, blue); editor.commit();
  assert.deepEqual(editor.sample(2, 7), blue); assert.deepEqual(editor.sample(4, 7), transparent);
  assert.deepEqual(editor.sample(3, 7), red);
  editor.begin(); editor.fill(4, 0, red); editor.cancel();
  assert.deepEqual(editor.sample(4, 0), transparent);
});
test("fill treats fully transparent RGB as one region and handles the maximum document", () => {
  const bytes = new Uint8Array(256 * 256 * 4); bytes[0] = 200;
  const editor = create(pixelDocumentFromRgba(256, 256, "max", bytes));
  editor.begin(); editor.fill(0, 0, blue); editor.commit();
  assert.deepEqual(editor.sample(255, 255), blue);
  assert.equal(editor.history().undo, 1);
});
test("history is limited by steps and actual pixel snapshot bytes", () => {
  const small = create(blank(1, 1));
  for (let i = 0; i < 70; i++) stroke(small, 0, 0, 0, 0, i % 2 ? red : blue);
  assert.equal(small.history().undo, 64);
  const large = create(blank(256, 256));
  for (let i = 0; i < 40; i++) stroke(large, 0, 0, 0, 0, i % 2 ? red : blue);
  assert.equal(large.history().undo, 32); assert.equal(large.history().bytes, PIXEL_LIMITS.historyBytes);
  large.undo(); assert.equal(large.history().bytes, PIXEL_LIMITS.historyBytes);
});
test("export checkpoints and restored source cannot alias live document bytes", () => {
  const editor = create(blank(8, 8));
  stroke(editor, 1, 1, 2, 1); assert(editor.dirty()); editor.markExported();
  const copied = editor.bytes(); copied.fill(0); assert.deepEqual(editor.sample(1, 1), red);
  stroke(editor, 2, 2, 3, 2); assert(editor.dirty()); editor.undo(); assert(!editor.dirty());
  const source = editor.document(); source.palette.length = 0;
  assert(editor.document().palette.length > 0);
});
test("PNG output retains exact straight-alpha bytes including transparent RGB", async () => {
  const pixels = new Uint8Array([200, 10, 40, 1, 1, 2, 3, 0, 255, 0, 0, 255, 0, 255, 0, 128]);
  const source = pixelDocumentFromRgba(2, 2, "alpha", pixels);
  const png = decodePng(Buffer.from(await pixelPng(source)));
  assert.equal(png.width, 2); assert.equal(png.height, 2);
  assert.deepEqual(new Uint8Array(png.pixels), pixels);
  assert.deepEqual(pixelBytes(read(JSON.stringify(source))), pixels);
});

const scopeUrl = await moduleUrl("placementAssetScope");
const storeUrl = await moduleUrl("placementSpriteRevisions", { "./placementAssetScope": scopeUrl });
const hashUrl = "data:text/javascript;base64," + Buffer.from(
  'export async function placementNormalHash(data) { const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data; return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join(""); }',
).toString("base64");
const { pixelComponentPatch: patch, createPixelAssets } = await checkedImport(await moduleUrl("placementPixelAssets", {
  "./placementPixelDocument": documentUrl,
  "@ferrum2d/ferrum-web/authoring": new URL("../../packages/ferrum-web/dist/authoring.js", import.meta.url).href,
  "./placementNormalAssets": hashUrl,
  "./placementSpriteRevisions": storeUrl,
  "./placementPixelPng": await moduleUrl("placementPixelPng", { "./placementPixelDocument": documentUrl }),
}));
function scene() {
  return {
    format: "ferrum2d.consumer.scene-authoring", version: 1, behaviorRecipes: { entities: {} },
    sceneComposition: {
      initialFragment: "main", prefabs: { object: {} },
      fragments: { main: { instances: [{
        id: "hero", prefab: "object", x: 12, y: 34, rotationRadians: 0.4, scale: 2,
        props: { components: {
          visual: { kind: "sprite", texture: "old", width: 32, height: 48, originX: 0.2, originY: 1, tint: "#ffffff" },
          collider: { type: "aabb", halfWidth: 4, halfHeight: 6 }, body: { type: "static" }, layer: "actor",
        } },
      }] } },
    },
  };
}
const state = { fragment: "main", selectedInstanceId: "hero", lockedInstanceIds: [] };
test("scene patches change only the static image/frame and preserve all other components", () => {
  const document = scene(), before = structuredClone(document);
  const operation = patch(document, state, "pixel.new").operations[0];
  assert.equal(operation.kind, "updateComponents");
  assert.equal(operation.components.visual.texture, "pixel.new");
  for (const key of ["width", "height", "originX", "originY", "tint"])
    assert.equal(operation.components.visual[key], before.sceneComposition.fragments.main.instances[0].props.components.visual[key]);
  for (const key of ["collider", "body", "layer"])
    assert.deepEqual(operation.components[key], before.sceneComposition.fragments.main.instances[0].props.components[key]);
  assert.deepEqual(document, before);
});
test("reject locked, animated, normal-bound and missing targets before a patch can apply", () => {
  assert.throws(() => patch(scene(), { ...state, lockedInstanceIds: ["hero"] }, "pixel.new"), /Unlock/);
  assert.throws(() => patch(scene(), { ...state, selectedInstanceId: "missing" }, "pixel.new"), /Select/);
  const animated = scene(); animated.sceneComposition.fragments.main.instances[0].props.components.visual.animation = {};
  assert.throws(() => patch(animated, state, "pixel.new"), /Animated/);
  const normal = scene(); normal.spatial = { billboards: { hero: { normalTexture: "normal" } } };
  assert.throws(() => patch(normal, state, "pixel.new"), /normals/);
});
test("source revisions are immutable, scoped to a scene and retained while referenced by history", async () => {
  const retained = new Set(), released = [];
  const assets = createPixelAssets({
    engine: { loadAssets: async () => {}, releaseAssets: m => released.push(...m.textures.map(t => t.name)) },
    taken: () => false, retains: id => retained.has(id),
  });
  try {
    const editor = create(blank(4, 4)); stroke(editor, 0, 0, 3, 3);
    const source = editor.document(), a = await assets.prepare("first", source, new AbortController().signal);
    assets.commit(a);
    retained.add(a.id); source.palette.length = 0;
    assert(a.source.palette.length > 0);
    stroke(editor, 0, 3, 3, 0, blue);
    const b = await assets.prepare("first", editor.document(), new AbortController().signal);
    assert.notEqual(a.id, b.id); assert.equal(assets.providerAssets("second").length, 0);
    assert(assets.blocksSave({ texture: a.id }));
    assert.throws(() => assets.assertDocumentAssets({ texture: a.id }, "second"), /another scene/);
    assert.deepEqual(await assets.collectUnused(), { removed: 1, bytes: b.bytes });
    assert.deepEqual(assets.providerAssets("first").map(a => a.id), [a.id]);
    assert.deepEqual(released, [b.id]);
    const bundle = assets.bundle("first", scene());
    assert.equal(bundle.format, "ferrum2d.pixel-assets"); assert.equal(bundle.assets.length, 1);
    assert.equal(bundle.manifest.textureOptions[a.id].colorSpace, "srgb");
    assert.equal(bundle.assets[0].source.format, "ferrum2d.pixel-document");
  } finally { assets.destroy(); }
});
test("failed and cancelled uploads do not retain source entries or URLs", async () => {
  let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  const assets = createPixelAssets({
    engine: { loadAssets: async () => { started(); await new Promise(resolve => { finish = resolve; }); }, releaseAssets() {} },
    taken: () => false, retains: () => false,
  });
  try {
    const controller = new AbortController();
    const pending = assets.prepare("first", blank(4, 4), controller.signal);
    await ready; controller.abort(); finish();
    await assert.rejects(pending);
    assert.deepEqual(assets.providerAssets("first"), []);
    assert.equal(assets.bundle("first", scene()).assets.length, 0);
  } finally { assets.destroy(); }
});
test("numeric-only texture aliases cannot bypass session save or cross-scene guards", async () => {
  const ids = new Map();
  const assets = createPixelAssets({
    engine: {
      loadAssets: async manifest => { for (const id of Object.keys(manifest.textures)) ids.set(id, 47); },
      textureId: id => ids.get(id), releaseAssets() {},
    },
    taken: () => false, retains: () => true,
  });
  try {
    const asset = await assets.prepare("first", blank(4, 4), new AbortController().signal);
    assets.commit(asset);
    const document = scene();
    const visual = document.sceneComposition.fragments.main.instances[0].props.components.visual;
    visual.texture = 47;
    assert(!JSON.stringify(document).includes(asset.id));
    assert(assets.blocksSave(document), "Numeric GPU aliases are session references too");
    assert.throws(() => assets.assertDocumentAssets(document, "second"), /another scene/);
    assert(!assets.blocksSave({ width: 47, height: 47, texture: 470 }));
    const bundle = assets.bundle("first", document);
    assert.equal(bundle.sceneDocument.sceneComposition.fragments.main.instances[0].props.components.visual.texture, asset.id);
    assert.equal(visual.texture, 47, "Export normalization must not mutate the authored source");
  } finally { assets.destroy(); }
});
test("an asset revision snapshots source bytes and dimensions before asynchronous PNG work", async () => {
  const assets = createPixelAssets({
    engine: { loadAssets: async () => {}, releaseAssets() {} },
    taken: () => false, retains: () => false,
  });
  try {
    const source = blank(4, 4), expected = structuredClone(source);
    const pending = assets.prepare("first", source, new AbortController().signal);
    source.width = 8; source.palette[0] = "#ffffffff";
    source.rgba = blank(8, 4).rgba;
    const asset = await pending;
    assert.deepEqual(asset.source, expected);
    const png = decodePng(Buffer.from(asset.png));
    assert.equal(png.width, expected.width); assert.equal(png.height, expected.height);
    assert.deepEqual(new Uint8Array(png.pixels), pixelBytes(expected));
  } finally { assets.destroy(); }
});
test("PNG validation and dimensions use a private source snapshot before yielding", async () => {
  const source = blank(4, 4), expected = structuredClone(source);
  const pending = pixelPng(source);
  source.width = 8; source.rgba = blank(8, 4).rgba;
  const png = decodePng(Buffer.from(await pending));
  assert.equal(png.width, 4); assert.equal(png.height, 4);
  assert.deepEqual(new Uint8Array(png.pixels), pixelBytes(expected));
  await assert.rejects(pixelPng({ ...blank(), version: 2 }), /Unsupported/);
});
test("rollback releases only provisional revisions and preserves previously committed assets", async () => {
  const released = [], retained = new Set();
  const assets = createPixelAssets({
    engine: { loadAssets: async () => {}, releaseAssets: m => released.push(...m.textures.map(t => t.name)) },
    taken: () => false, retains: id => retained.has(id),
  });
  try {
    const a = await assets.prepare("first", blank(4, 4, "provisional"), new AbortController().signal);
    assert.equal(assets.bundle("first", scene()).assets.length, 0);
    assert(assets.discardUncommitted(a)); assert(!assets.has(a.id));
    assert.deepEqual(released, [a.id]);
    const b = await assets.prepare("first", blank(4, 4, "published"), new AbortController().signal);
    assets.commit(b);
    assert(!assets.discardUncommitted(b)); assert(assets.has(b.id));
    const c = await assets.prepare("first", blank(4, 4, "referenced"), new AbortController().signal);
    retained.add(c.id);
    assert(!assets.discardUncommitted(c)); assert(assets.has(c.id));
    assert.equal(assets.bundle("first", scene()).assets.length, 1);
  } finally { assets.destroy(); }
});
test("portable exports normalize prefab/variant/include/legacy and normal aliases without changing source metadata", async () => {
  const assets = createPixelAssets({
    engine: { loadAssets: async () => {}, textureId: () => 0, releaseAssets() {} },
    taken: () => false, retains: () => false,
  });
  try {
    const asset = await assets.prepare("first", blank(2, 2), new AbortController().signal);
    assets.commit(asset);
    const document = scene();
    document.sceneComposition.prefabs.object.props = { components: { visual: { kind: "sprite", texture: 0, width: 2, height: 2 } } };
    document.sceneComposition.prefabs.object.variants = { alternate: { props: { components: { visual: { texture: 0 } } } } };
    document.sceneComposition.fragments.empty = { instances: [] };
    document.sceneComposition.fragments.main.include = [{ fragment: "empty", props: { components: { sprite: { texture: 0, width: 2, height: 2 } } } }];
    document.spatial = { billboards: { hero: { normalTextureId: 0 } } };
    document.sceneComposition.fragments.main.instances[0].props.metadata = { width: 0, height: 0, values: Array(140000).fill(1) };
    const before = structuredClone(document);
    assert(assets.blocksSave({ texture: 0 }));
    assert(!assets.blocksSave({ width: 0, texture: 10 }));
    const copy = assets.bundle("first", document).sceneDocument;
    assert.equal(copy.sceneComposition.prefabs.object.props.components.visual.texture, asset.id);
    assert.equal(copy.sceneComposition.prefabs.object.variants.alternate.props.components.visual.texture, asset.id);
    assert.equal(copy.sceneComposition.fragments.main.include[0].props.components.sprite.texture, asset.id);
    assert.deepEqual(copy.spatial.billboards.hero, { normalTexture: asset.id });
    assert.deepEqual(copy.sceneComposition.fragments.main.instances[0].props.metadata, before.sceneComposition.fragments.main.instances[0].props.metadata);
    assert.deepEqual(document, before);
    document.sceneComposition.fragments.main.instances[0].props.metadata.textureId = 0;
    assert.throws(() => assets.bundle("first", document), /named pixel texture/);
    assert.equal(document.sceneComposition.fragments.main.instances[0].props.metadata.textureId, 0);
  } finally { assets.destroy(); }
});
test("closing a source scene cannot release pixels retained by another open scene or its history", async () => {
  const retained = new Set(), released = [];
  const assets = createPixelAssets({
    engine: { loadAssets: async () => {}, releaseAssets: m => released.push(...m.textures.map(t => t.name)) },
    taken: () => false, retains: id => retained.has(id),
  });
  try {
    const a = await assets.prepare("first", blank(4, 4, "shared"), new AbortController().signal);
    assets.commit(a); retained.add(a.id);
    const b = await assets.prepare("first", blank(4, 4, "unused"), new AbortController().signal);
    assets.commit(b);
    assets.close("first");
    assert(assets.has(a.id)); assert(!assets.has(b.id));
    assert.deepEqual(released, [b.id]);
    retained.clear(); await assets.collectUnused();
    assert(!assets.has(a.id)); assert.deepEqual(released, [b.id, a.id]);
  } finally { assets.destroy(); }
});
