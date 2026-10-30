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
  "./placementAssetScope": scopeUrl,
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
  await assert.rejects(pixelPng({ ...blank(), version: 3 }), /Unsupported/);
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

const projectHashUrl = 'data:text/javascript;base64,' + Buffer.from(`
export async function placementNormalHash(value) { const bytes=typeof value==='string'?new TextEncoder().encode(value):value; return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join(''); }
export async function placementNormalRead(response,limit) { if(!response.ok)throw Error('HTTP '+response.status); const bytes=await response.arrayBuffer();if(bytes.byteLength>limit)throw Error('Byte limit');return bytes; }
`).toString('base64');
const pngUrl = await moduleUrl('placementPixelPng', { './placementPixelDocument':documentUrl });
const { verifyPixelPng } = await checkedImport(pngUrl);
const { pixelProjectBundle, readPixelProject, createDesktopPixelProjectHost } = await checkedImport(await moduleUrl('placementPixelProject', {
  './placementPixelDocument':documentUrl, './placementPixelPng':pngUrl, './placementNormalAssets':projectHashUrl,
}));
async function projectFixture() {
  const store=createPixelAssets({engine:{textureId:()=>7,loadAssets:async()=>{},releaseAssets:()=>{}},taken:()=>false,retains:()=>false});
  const source=pixelDocumentFromRgba(2,1,'캐릭터',new Uint8Array([10,20,30,0,0,0,255,128]));
  const asset=await store.prepare('scene',source,new AbortController().signal);store.commit(asset);
  const bundle=await pixelProjectBundle([asset]);
  const catalog={format:'ferrum2d.pixel.project',version:1,catalogRevision:'1'.repeat(64),assets:[{
    metadata:bundle.revisions[0],jsonUrl:'http://project/source.json',pngUrl:'http://project/sprite.png',
  }]};
  return {store,asset,bundle,catalog,source};
}
test('project source restores exact transparent RGBA, layer/frame IDs, palette and immutable identity', async()=>{
  const f=await projectFixture(), originalFetch=globalThis.fetch, originalLocation=globalThis.location;
  const files=new Map(f.bundle.files.map(file=>['http://project/'+(file.mediaType==='image/png'?'sprite.png':'source.json'),Buffer.from(file.base64,'base64')]));
  globalThis.location={href:'http://project/'};globalThis.fetch=async url=>new Response(files.get(url));
  try {
    const restored=await readPixelProject(f.catalog,'other-scene','/project',new AbortController().signal);
    assert.equal(restored[0].id,f.asset.id);assert.equal(restored[0].identityDocument,'scene');
    assert.deepEqual(restored[0].source,f.source);assert(restored[0].persisted);
    const durable=createPixelAssets({engine:{textureId:()=>7,loadAssets:async()=>{},releaseAssets:()=>{}},taken:()=>false,retains:()=>false});
    await durable.restore(restored,new AbortController().signal);
    const document={visual:{texture:f.asset.id}};
    assert.equal(durable.blocksSave(document,'third-scene','/project'),false);
    assert.equal(durable.blocksSave(document,'third-scene','/foreign'),true);
    assert.throws(()=>durable.assertDocumentAssets(document,'third-scene','/foreign'));
    assert.doesNotThrow(()=>durable.assertDocumentAssets(document,'third-scene','/project'));
    assert.equal(durable.blocksSave({visual:{texture:7}},'third-scene','/project'),true,'runtime numeric aliases cannot become durable scene references');
    assert.equal(durable.providerAssets('third-scene','/project').length,1);
    durable.close('other-scene'); assert.equal(durable.entries().length,1);
    assert.deepEqual(await durable.collectUnused(),{removed:0,bytes:0});durable.destroy();
  } finally {globalThis.fetch=originalFetch;globalThis.location=originalLocation;f.store.destroy();}
});
test('project reader rejects forged identity, hashes, unsafe URLs, duplicate entries and mismatched PNG pixels',async()=>{
  const f=await projectFixture(),originalFetch=globalThis.fetch,originalLocation=globalThis.location;
  globalThis.location={href:'http://project/'};
  const json=Buffer.from(f.bundle.files[0].base64,'base64'),png=Buffer.from(f.bundle.files[1].base64,'base64');
  globalThis.fetch=async url=>new Response(url.endsWith('.png')?png:json);
  try {
    for(const modify of [c=>c.assets.push(c.assets[0]),c=>c.assets[0].metadata.jsonSha256='0'.repeat(64),c=>c.assets[0].metadata.identityDocument='wrong',c=>c.assets[0].pngUrl='blob:http://project/foo',c=>c.catalogRevision='invalid']) {
      const candidate=structuredClone(f.catalog);modify(candidate);
      await assert.rejects(readPixelProject(candidate,'scene','/project',new AbortController().signal));
    }
    const different=await pixelPng(blank(2,1));
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',different))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const candidate=structuredClone(f.catalog);candidate.assets[0].metadata.pngSha256=hash;
    globalThis.fetch=async url=>new Response(url.endsWith('.png')?different:json);
    await assert.rejects(readPixelProject(candidate,'scene','/project',new AbortController().signal),/editable source differ/);
  } finally {globalThis.fetch=originalFetch;globalThis.location=originalLocation;f.store.destroy();}
});
test('desktop pixel host requires a loaded catalog and advances its optimistic token only after an accepted response',async()=>{
  const f=await projectFixture(),calls=[];
  let result={...f.catalog,assets:[],catalogRevision:''};
  const host=createDesktopPixelProjectHost(async(command,args)=>{calls.push({command,args});return result;},'/project');
  const signal=new AbortController().signal;
  try {
    await assert.rejects(host.save([f.asset],signal),/Reopen/);assert.equal(calls.length,0);
    await host.load(signal);result=f.catalog;await host.save([f.asset],signal);
    assert.equal(calls.at(-1).args.bundle.expectedCatalogRevision,'');
    result={...f.catalog,catalogRevision:'2'.repeat(64)};await host.save([f.asset],signal);
    assert.equal(calls.at(-1).args.bundle.expectedCatalogRevision,'1'.repeat(64));
    result={...f.catalog,catalogRevision:'bad'};await assert.rejects(host.save([f.asset],signal));
    assert.equal(calls.at(-1).args.bundle.expectedCatalogRevision,'2'.repeat(64));
  } finally {f.store.destroy();}
});
test('lossless saved PNG verification rejects damaged checksums, truncation and different source pixels',async()=>{
  const source=blank(2,2),png=await pixelPng(source);
  await verifyPixelPng(png,source);
  for(const candidate of [png.slice(0,-1),new Uint8Array([...new Uint8Array(png),0]).buffer])await assert.rejects(verifyPixelPng(candidate,source));
  const damaged=png.slice(0);new Uint8Array(damaged)[30]^=1;await assert.rejects(verifyPixelPng(damaged,source));
  const editor=create(source);stroke(editor,0,0,1,1);
  await assert.rejects(verifyPixelPng(png,editor.document()),/editable source differ/);
});

test('native-valid formatted JSON and ordinary RGBA PNG reopen and resave with identical source bytes', async()=>{
  const f=await projectFixture(),originalFetch=globalThis.fetch,originalLocation=globalThis.location;
  const raw=JSON.stringify(f.source,null,2)+'\n';
  const { encodePngRgba }=await import('../../scripts/tools/pack-textures.mjs');
  const png=encodePngRgba(f.source.width,f.source.height,pixelBytes(f.source));
  const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const candidate=structuredClone(f.catalog),meta=candidate.assets[0].metadata;
  meta.assetId='pixel.'+(await hash(JSON.stringify([meta.identityDocument,raw]))).slice(0,24);
  meta.jsonSha256=await hash(raw);meta.pngSha256=await hash(png);
  globalThis.location={href:'http://project/'};globalThis.fetch=async url=>new Response(url.endsWith('.png')?new Uint8Array(png).slice().buffer:raw);
  try {
    const restored=await readPixelProject(candidate,'scene','/project',new AbortController().signal);
    assert.deepEqual(restored[0].source,f.source);
    const bundle=await pixelProjectBundle(restored);
    assert.equal(bundle.revisions[0].assetId,meta.assetId);
    assert.equal(Buffer.from(bundle.files[0].base64,'base64').toString(),raw);
    assert.equal(bundle.revisions[0].jsonSha256,meta.jsonSha256);
  } finally {globalThis.fetch=originalFetch;globalThis.location=originalLocation;f.store.destroy();}
});
test('project bundle snapshots all revision fields and PNG bytes before yielding',async()=>{
  const f=await projectFixture();
  try {
    const expected=await pixelProjectBundle([f.asset]);
    const pending=pixelProjectBundle([f.asset]);
    f.asset.id='pixel.'+'a'.repeat(24);f.asset.width=1;f.asset.identityDocument='changed';
    new Uint8Array(f.asset.png).fill(0);f.asset.source.name='changed';
    assert.deepEqual(await pending,expected);
  } finally {f.store.destroy();}
});

test('standard RGBA PNG row filters, ancillary metadata, split IDAT and Adam7 preserve exact pixels',async()=>{
  const {filteredPixelPng}=await import('./pixel-png-fixture.mjs');
  for(const [width,height] of [[1,1],[1,9],[9,1],[9,9],[32,32]]) {
    const pixels=Uint8Array.from({length:width*height*4},(_,i)=>(i*29+3)%256);
    const source=pixelDocumentFromRgba(width,height,'filtered',pixels);
    for(const interlaced of [false,true]) {
      const png=filteredPixelPng(width,height,pixels,interlaced);
      if(!interlaced)assert.deepEqual(new Uint8Array(decodePng(png).pixels),pixels,'independent existing decoder checks fixture');
      await verifyPixelPng(Uint8Array.from(png).buffer,source);
    }
  }
});
test('PNG verification snapshots caller source and input bytes before inflate yields',async()=>{
  const source=blank(8,8),png=await pixelPng(source);
  const result=verifyPixelPng(png,source);
  source.width=1;source.rgba='AAAAAA==';new Uint8Array(png).fill(0);
  await result;
});

test('embedded PNG profiles cannot reinterpret the sRGB source pixels during runtime decode',async()=>{
  const {filteredPixelPng,pixelPngChunk}=await import('./pixel-png-fixture.mjs');
  const source=blank(2,2),png=filteredPixelPng(2,2,pixelBytes(source));
  for(const [name,body] of [['gAMA',Buffer.from([0,1,0x86,0xa0])],['iCCP',Buffer.from('profile\0fake')],['cICP',Buffer.from([9,16,0,1])]]) {
    const invalid=Buffer.concat([png.subarray(0,33),pixelPngChunk(name,body),png.subarray(33)]);
    await assert.rejects(verifyPixelPng(Uint8Array.from(invalid).buffer,source),/color space/);
  }
  const gamma=Buffer.alloc(4);gamma.writeUInt32BE(45455);
  const srgb=Buffer.concat([png.subarray(0,33),pixelPngChunk('gAMA',gamma),png.subarray(33)]);
  await verifyPixelPng(Uint8Array.from(srgb).buffer,source);
});

test('image layer edits upgrade v1 explicitly and preserve independent pixels and source-over output',()=>{
  const source=pixelDocumentFromRgba(2,1,'layers',new Uint8Array([255,0,0,255,12,34,56,0]));
  const editor=create(source);assert.equal(editor.document().version,1);
  editor.selectLayer('layer-1');assert.equal(editor.dirty(),false);assert.equal(editor.history().undo,0);
  const top=editor.addLayer('Equipment');stroke(editor,0,0,0,0,[0,0,255,128]);
  const document=editor.document();assert.equal(document.version,2);assert.equal(document.layers.length,2);
  assert.deepEqual([...editor.bytes()],[127,0,128,255,12,34,56,0]);
  assert.deepEqual([...editor.layerBytes('layer-1')],[255,0,0,255,12,34,56,0]);
  assert.deepEqual([...editor.layerBytes(top)],[0,0,255,128,0,0,0,0]);
  assert.deepEqual(pixelBytes(read(JSON.stringify(document))),editor.bytes());
  editor.markExported();editor.selectLayer('layer-1');assert.equal(editor.dirty(),false);
  const leaked=editor.layers();leaked[0].name='mutated';editor.layerBytes(top).fill(0);
  assert.equal(editor.layers()[0].name,source.layer.name);assert.deepEqual(editor.bytes(),pixelBytes(document));
});
test('layer metadata, order, removal and paint share Undo/Redo without serializing selection',()=>{
  const editor=create(blank(2,2)),original=editor.document();
  const top=editor.addLayer('Top');editor.renameLayer(top,'Armor');editor.setLayerLocked(top,true);editor.setLayerVisible(top,false);editor.moveLayer(top,-1);
  const after=editor.document();assert.equal(after.layers[0].id,top);
  editor.removeLayer(top);assert.equal(editor.layers().length,1);editor.undo();assert.deepEqual(editor.document(),after);
  for(let i=0;i<5;i++)editor.undo();assert.deepEqual(editor.document(),original);assert.equal(editor.dirty(),false);
  for(let i=0;i<5;i++)editor.redo();assert.deepEqual(editor.document(),after);
  editor.undo();const count=editor.history().redo;editor.renameLayer(top,'Armor');assert.equal(editor.history().redo,count,'no-op metadata retains Redo');
  const fresh=editor.addLayer('New');assert.notEqual(fresh,top);assert.equal(editor.history().redo,0);
  assert.throws(()=>editor.renameLayer(fresh,''));assert.equal(editor.layers().at(-1).name,'New');
});
test('hidden and locked image layers cannot be painted, while selection, visibility and merged picking remain usable',()=>{
  const editor=create(blank(2,2));stroke(editor,0,0,1,1,blue);
  const top=editor.addLayer('Top');editor.setLayerLocked(top,true);
  assert.equal(editor.canPaint(),false);assert.throws(()=>editor.begin(),/unlock/);assert.equal(editor.active(),false);
  assert.deepEqual(editor.sample(0,0),blue);
  editor.setLayerLocked(top,false);editor.setLayerVisible(top,false);assert.throws(()=>editor.begin(),/unlock/);
  editor.selectLayer('layer-1');assert.equal(editor.canPaint(),true);assert.deepEqual(editor.sample(0,0),blue);
  editor.setLayerVisible('layer-1',false);assert.deepEqual([...editor.bytes()],Array(16).fill(0));
  editor.setLayerVisible(top,true);editor.selectLayer(top);stroke(editor,1,1,1,1,red);assert.deepEqual(editor.sample(1,1),red);
});
test('fill boundaries belong to the selected layer and a cancelled stroke preserves the layer Redo branch',()=>{
  const editor=create(blank(3,3));editor.begin();editor.fill(0,0,blue);editor.commit();
  const base=editor.layerBytes('layer-1'),top=editor.addLayer('Top');stroke(editor,1,1,1,1,red);
  editor.begin();editor.fill(0,0,[0,255,0,255]);editor.commit();
  assert.deepEqual(editor.layerBytes('layer-1'),base);assert.deepEqual(editor.sample(1,1),red);assert.deepEqual(editor.sample(0,0),[0,255,0,255]);
  editor.undo();const branch=editor.history().redo;editor.begin();editor.line(0,0,2,2,blue);editor.cancel();
  assert.equal(editor.history().redo,branch);editor.redo();assert.deepEqual(editor.sample(0,0),[0,255,0,255]);
  editor.selectLayer('layer-1');editor.undo();assert.equal(editor.selectedLayer(),top);
});
test('v2 validates unique IDs, flags, layer count and a bounded maximum-size source without changing v1 byte limits',()=>{
  const editor=create(blank(256,256));for(let i=1;i<8;i++)editor.addLayer('Layer '+i);
  const source=editor.document(),raw=JSON.stringify(source);
  assert(raw.length>1024*1024);assert(raw.length<PIXEL_LIMITS.sourceBytes);assert.deepEqual(read(raw),source);
  assert.throws(()=>editor.addLayer());
  for(const modify of [d=>d.layers=[],d=>d.layers.push(d.layers[0]),d=>d.layers[1].id=d.layers[0].id,
    d=>d.layers[0].locked='false',d=>d.layers[0].visible=null,d=>d.layers[0].rgba='AAAA',d=>d.rgba='AAAA']) {
    const invalid=structuredClone(source);modify(invalid);assert.throws(()=>read(JSON.stringify(invalid)));
  }
  assert.throws(()=>read(JSON.stringify(blank())+' '.repeat(PIXEL_LIMITS.documentBytes)));
  assert.throws(()=>read(raw+' '.repeat(PIXEL_LIMITS.sourceBytes)));
  const single=create(blank());assert.throws(()=>single.removeLayer('layer-1'));assert.equal(single.document().version,1);
});
test('layered PNG export uses only visible composite and keeps raw layer bytes in source',async()=>{
  const editor=create(blank(2,2));editor.begin();editor.fill(0,0,blue);editor.commit();
  const top=editor.addLayer('Red');editor.begin();editor.fill(0,0,[255,0,0,64]);editor.commit();
  let png=decodePng(Buffer.from(await pixelPng(editor.document())));assert.deepEqual([...png.pixels.subarray(0,4)],[64,0,191,255]);
  editor.moveLayer(top,-1);png=decodePng(Buffer.from(await pixelPng(editor.document())));assert.deepEqual([...png.pixels.subarray(0,4)],[0,0,255,255]);
  editor.setLayerVisible('layer-1',false);png=decodePng(Buffer.from(await pixelPng(editor.document())));assert.deepEqual([...png.pixels.subarray(0,4)],[255,0,0,64]);
  assert.deepEqual([...editor.layerBytes('layer-1').subarray(0,4)],blue);
});
test('mixed layer and stroke history counts actual snapshot bytes and stays within 16 MiB',()=>{
  const editor=create(blank(256,256));for(let i=1;i<8;i++)editor.addLayer('Layer '+i);
  for(let i=0;i<20;i++){stroke(editor,i,0,i,1,[i,40,200,255]);assert(editor.history().bytes<=PIXEL_LIMITS.historyBytes);}
  const saved=editor.document();let count=0;while(editor.history().undo){editor.undo();count++;assert(editor.history().bytes<=PIXEL_LIMITS.historyBytes);}
  assert(count<=64);while(editor.history().redo)editor.redo();assert.deepEqual(editor.document(),saved);
});

test('removed image layer IDs are not recycled after closing and reopening the source',()=>{
  const editor=create(blank(2,2)),removed=editor.addLayer('Removed');editor.removeLayer(removed);
  const restored=create(read(JSON.stringify(editor.document()))),fresh=restored.addLayer('Fresh');
  assert.notEqual(fresh,removed);
  const document=restored.document();restored.undo();restored.redo();assert.deepEqual(restored.document(),document);
});

test('pixel source text and numeric spelling have one frontend/native contract',()=>{
  for(const version of [1,2]) {
    const editor=create(blank(2,1));if(version===2)editor.addLayer();
    const source=editor.document();
    const raw=JSON.stringify(source).replace('"version":'+version,'"version":'+version+'.0')
      .replace('"width":2','"width":2e0').replace('"height":1','"height":1.0').replace('"durationMs":100','"durationMs":100.0');
    assert.deepEqual(read(raw),source);
    for(const [name,accepted] of [['\ufeff',false],[' \ufeff\t',false],['\u0085',true],['\ufeffBody',true]]) {
      const named=JSON.stringify({...source,name});
      if(accepted)assert.equal(read(named).name,name);else assert.throws(()=>read(named),/names/);
    }
  }
});

test('pixel names and layer/frame IDs reject unpaired UTF-16 surrogates before publishing',()=>{
  for(const version of [1,2]) {
    const editor=create(blank(2,1));if(version===2)editor.addLayer();
    const source=editor.document();
    for(const bad of ['\ud800','\udfff','Body\ud800','\udfffArmor']) {
      for(const path of [['name'],['frame','id'],version===1?['layer','name']:['layers',0,'name'],version===1?['layer','id']:['layers',0,'id']]) {
        const invalid=structuredClone(source);let target=invalid;
        for(const key of path.slice(0,-1))target=target[key];target[path.at(-1)]=bad;
        assert.throws(()=>read(JSON.stringify(invalid)),/Unicode/);
      }
    }
    const valid='😀'.repeat(32);assert.equal(read(JSON.stringify({...source,name:valid})).name,valid);
  }
});
