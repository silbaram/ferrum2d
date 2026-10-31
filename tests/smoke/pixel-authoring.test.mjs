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
const atlasUrl = await moduleUrl("placementPixelAtlas");
const {readPixelAtlas,pixelAtlasRect}=await checkedImport(atlasUrl);
const documentUrl = await moduleUrl("placementPixelDocument", {"./placementPixelAtlas":atlasUrl});
const animationUrl=await moduleUrl("placementPixelAnimation",{
  "./placementPixelDocument":documentUrl,
  "@ferrum2d/ferrum-web/authoring":new URL("../../packages/ferrum-web/dist/authoring.js",import.meta.url).href,
});
const {pixelAnimation,pixelPreviewFrame,pixelAnimationInput}=await checkedImport(animationUrl);
const {pixelOnionFrames,PIXEL_ONION_DEFAULTS}=await checkedImport(await moduleUrl("placementPixelOnion"));
const { createPixelEditor: create, newPixelDocument: blank, readPixelDocument: read, pixelBytes, pixelDocumentFromRgba, pixelAtlas, pixelFrames, PIXEL_LIMITS } = await checkedImport(documentUrl);
const { pixelPng, readPixelPng } = await checkedImport(await moduleUrl("placementPixelPng", { "./placementPixelDocument": documentUrl }));
const red = [255, 0, 0, 255], blue = [0, 0, 255, 255], transparent = [0, 0, 0, 0];
test('onion neighbours are view-only, directional and never wrap or include the current frame',()=>{
  const frames=[{id:'a'},{id:'b'},{id:'c'}],settings={...PIXEL_ONION_DEFAULTS,enabled:true};
  assert.deepEqual(pixelOnionFrames(frames,'b',settings),[{id:'a',side:'previous'},{id:'c',side:'next'}]);
  assert.deepEqual(pixelOnionFrames(frames,'a',settings),[{id:'b',side:'next'}]);
  assert.deepEqual(pixelOnionFrames(frames,'c',settings),[{id:'b',side:'previous'}]);
  assert.deepEqual(pixelOnionFrames([{id:'a'}],'a',settings),[]);
  for(const patch of [{enabled:false},{opacity:0},{previous:false,next:false}])assert.deepEqual(pixelOnionFrames(frames,'b',{...settings,...patch}),[]);
  assert.deepEqual(pixelOnionFrames(frames,'b',settings,true),[]);
  assert.deepEqual(pixelOnionFrames(frames,'b',{...settings,next:false}),[{id:'a',side:'previous'}]);
  assert.deepEqual(pixelOnionFrames(frames,'b',{...settings,previous:false}),[{id:'c',side:'next'}]);
  assert.deepEqual(pixelOnionFrames([frames[1],frames[0],frames[2]],'b',settings),[{id:'a',side:'next'}]);
  assert.throws(()=>pixelOnionFrames(frames,'missing',settings),/frame not found/);
  for(const opacity of [-1,101,NaN,Infinity,0.5])assert.throws(()=>pixelOnionFrames(frames,'b',{...settings,opacity}),/opacity/);
  assert.deepEqual(settings,{enabled:true,previous:true,next:true,opacity:30});assert.deepEqual(frames,[{id:'a'},{id:'b'},{id:'c'}]);
});
test('reading onion neighbours preserves history and source; cached composites follow edits, layers and Undo',()=>{
  const editor=create(blank(2,1));stroke(editor,0,0,0,0,red);editor.addFrame();stroke(editor,1,0,1,0,blue);editor.addFrame();
  editor.selectFrame(editor.frames()[1].id);editor.markExported();
  const source=editor.document(),history=editor.history(),settings={...PIXEL_ONION_DEFAULTS,enabled:true};
  for(let i=0;i<4;i++)for(const frame of editor.frames())editor.bytes(frame.id);
  for(const frame of pixelOnionFrames(editor.frames(),editor.selectedFrame(),settings))editor.bytes(frame.id).fill(0);
  assert.deepEqual(editor.document(),source);assert.deepEqual(editor.history(),history);assert.equal(editor.dirty(),false);
  const first=editor.frames()[0].id;assert.deepEqual(editor.sample(0,0,first),red);
  editor.setLayerVisible(editor.selectedLayer(),false);for(const frame of editor.frames())assert(editor.bytes(frame.id).every(v=>v===0));
  editor.undo();assert.deepEqual(editor.sample(0,0,first),red);
  editor.selectFrame(first);stroke(editor,0,0,0,0,blue);assert.deepEqual(editor.sample(0,0,first),blue);
  editor.undo();assert.deepEqual(editor.sample(0,0,first),red);
});
function stroke(editor, x0, y0, x1, y1, color = red) {
  editor.begin(); editor.line(x0, y0, x1, y1, color); editor.commit();
}
test("native source roundtrip retains pixel bytes, stable frame/layer IDs and palette without history", () => {
  const editor = create(blank(32, 32, "캐릭터"));
  stroke(editor, 1, 2, 5, 6);
  const source = read(JSON.stringify(editor.document()));
  assert.equal(JSON.stringify(source), JSON.stringify(editor.document()), "Legacy v1 canonical field order is part of immutable revision identity");
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
const { pixelComponentPatch: patch, pixelAtlasComponentPatch: atlasPatch, createPixelAssets } = await checkedImport(await moduleUrl("placementPixelAssets", {
  "./placementPixelDocument": documentUrl,
  "./placementPixelAnimation":animationUrl,
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
  await assert.rejects(pixelPng({ ...blank(), version: 99 }), /Unsupported/);
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

test('frame operations preserve v1 until edited and keep selection outside dirty/history',()=>{
  const editor=create(blank(2,1)),original=editor.document(),first=editor.selectedFrame();
  stroke(editor,0,0,0,0,blue);const painted=editor.document();
  const second=editor.addFrame();assert.equal(editor.document().version,3);assert.deepEqual(editor.sample(0,0),transparent);
  editor.setFrameDuration(second,200);stroke(editor,0,0,0,0,red);
  const third=editor.duplicateFrame();assert.notEqual(third,second);assert.deepEqual(editor.sample(0,0),red);
  stroke(editor,0,0,0,0,[0,255,0,255]);editor.selectFrame(second);assert.deepEqual(editor.sample(0,0),red);
  editor.selectFrame(first);assert.deepEqual(editor.sample(0,0),blue);
  editor.markExported();const checkpoint=editor.document(),history=editor.history();editor.selectFrame(third);
  assert.equal(editor.dirty(),false);assert.deepEqual(editor.history(),history);assert.deepEqual(editor.document(),checkpoint);
  editor.moveFrame(third,-1);editor.removeFrame(second);const final=editor.document();
  editor.undo();editor.undo();assert.deepEqual(editor.document(),checkpoint);editor.redo();editor.redo();assert.deepEqual(editor.document(),final);
  while(editor.history().undo)editor.undo();assert.deepEqual(editor.document(),original);
  const duration=create(painted);duration.setFrameDuration(duration.selectedFrame(),120);assert.equal(duration.document().version,3);duration.undo();assert.deepEqual(duration.document(),painted);
});

test('shared layer edits move every frame cel atomically and retain frame-local pixels',()=>{
  const editor=create(blank(2,1)),first=editor.selectedFrame();stroke(editor,0,0,0,0,blue);
  const second=editor.addFrame();stroke(editor,0,0,0,0,red);
  const top=editor.addLayer('Armor');stroke(editor,1,0,1,0,[0,255,0,255]);
  editor.selectFrame(first);assert.deepEqual([...editor.layerBytes(top)],[0,0,0,0,0,0,0,0]);
  stroke(editor,1,0,1,0,blue);const before=editor.document();
  editor.moveLayer(top,-1);for(const frame of editor.document().frames)assert.equal(frame.cels[0].layerId,top);
  editor.setLayerVisible(top,false);editor.selectFrame(second);assert.deepEqual(editor.sample(1,0),transparent);
  editor.setLayerLocked(top,true);assert.throws(()=>editor.begin(),/unlock/);
  editor.removeLayer(top);assert(editor.document().frames.every(frame=>frame.cels.length===1));
  for(let i=0;i<4;i++)editor.undo();assert.deepEqual(editor.document(),before);
  editor.selectFrame(second);assert.deepEqual(editor.sample(1,0),[0,255,0,255]);
  editor.begin();editor.line(0,0,1,0,blue);editor.selectFrame(first);assert.equal(editor.active(),false);editor.selectFrame(second);assert.deepEqual(editor.sample(1,0),[0,255,0,255]);
});

test('v3 validates stable frame IDs, cel associations, duration and aggregate bounds',()=>{
  const editor=create(blank(2,1));editor.addLayer();editor.addFrame();const source=editor.document();
  assert.deepEqual(read(JSON.stringify(source)),source);
  for(const mutate of [d=>d.frames=[],d=>d.frames[1].id=d.frames[0].id,d=>d.frames[0].durationMs=0,
    d=>d.frames[0].durationMs=1.5,d=>d.frames[0].cels.pop(),d=>d.frames[0].cels.reverse(),
    d=>d.frames[0].cels[0].rgba='AAAA',d=>d.layers[0].rgba='AAAA',d=>d.frame={id:'frame',durationMs:100}]) {
    const invalid=structuredClone(source);mutate(invalid);assert.throws(()=>read(JSON.stringify(invalid)));
  }
  const small=create(blank(1,1));for(let i=1;i<16;i++)small.addFrame();assert.throws(()=>small.addFrame(),/limit/);
  const removed=small.selectedFrame();small.removeFrame(removed);const restored=create(read(JSON.stringify(small.document())));assert.notEqual(restored.addFrame(),removed);
  const large=create(blank(256,256));for(let i=1;i<8;i++)large.addLayer();for(let i=1;i<4;i++)large.addFrame();
  assert.equal(large.frames().length,4);assert.throws(()=>large.addFrame(),/budget/);
  assert.throws(()=>read(JSON.stringify({...blank(),version:2,layer:undefined,rgba:undefined,layers:source.layers,frame:{id:'frame',durationMs:100},frames:source.frames})));
});

test('frame atlas and PNG retain source order, transparent RGB and zero trailing cells',async()=>{
  const editor=create(pixelDocumentFromRgba(2,1,'sheet',new Uint8Array([255,0,0,255,12,34,56,0])));
  editor.addFrame();stroke(editor,0,0,1,0,blue);editor.addFrame();stroke(editor,0,0,1,0,[0,255,0,255]);
  const source=editor.document(),atlas=pixelAtlas(source);
  assert.equal(atlas.width,4);assert.equal(atlas.height,2);
  assert.deepEqual([...atlas.pixels],[255,0,0,255,12,34,56,0,0,0,255,255,0,0,255,255,0,255,0,255,0,255,0,255,0,0,0,0,0,0,0,0]);
  const png=await pixelPng(source);assert.deepEqual(new Uint8Array(decodePng(Buffer.from(png)).pixels),atlas.pixels);
  await verifyPixelPng(png,source);
  const changed=structuredClone(source);changed.frames.reverse();await assert.rejects(verifyPixelPng(png,changed),/editable source/);
  const pending=pixelPng(source);source.frames[0].cels[0].rgba=source.frames[1].cels[0].rgba;
  assert.deepEqual(new Uint8Array(decodePng(Buffer.from(await pending)).pixels),atlas.pixels);
});

test('preview and native UV ticks agree on exact source frame duration and order',()=>{
  const editor=create(blank(2,1));const first=editor.selectedFrame(),second=editor.addFrame();editor.setFrameDuration(second,200);
  const info=pixelAnimationInput(editor.document()),compiled=pixelAnimation(info);
  assert.equal(compiled.tickMs,100);assert.deepEqual(compiled.repeats,[1,2]);assert.equal(compiled.set.clips[0].fps,10);
  assert.deepEqual(compiled.set.clips[0].frames,[compiled.layout.frames[0],compiled.layout.frames[1],compiled.layout.frames[1]]);
  assert.equal(compiled.nativeCycleMs,300);
  assert.deepEqual([0,99,100,299,300,400].map(ms=>pixelPreviewFrame(info.frames,ms)),[0,0,1,1,0,1]);
  editor.setFrameDuration(first,83);editor.setFrameDuration(second,124);
  assert.throws(()=>pixelAnimation(pixelAnimationInput(editor.document())),/32 native/);
  assert.equal(pixelPreviewFrame(editor.frames(),83),1);assert.doesNotThrow(()=>read(JSON.stringify(editor.document())));
});

test('animated pixel patches preserve components and only migrate verified owned animation',()=>{
  const editor=create(blank(2,1));editor.addFrame();editor.setFrameDuration(editor.selectedFrame(),200);
  const source=editor.document(),info=pixelAnimationInput(source),document=scene(),before=structuredClone(document);
  const operation=patch(document,state,'pixel.new',info).operations[0];
  assert.deepEqual(operation.components.visual.animationSet,pixelAnimation(info).set);
  for(const key of ['collider','body','layer'])assert.deepEqual(operation.components[key],before.sceneComposition.fragments.main.instances[0].props.components[key]);
  for(const key of ['width','height','originX','originY','tint'])assert.equal(operation.components.visual[key],before.sceneComposition.fragments.main.instances[0].props.components.visual[key]);
  const owned=scene();owned.sceneComposition.fragments.main.instances[0].props.components=structuredClone(operation.components);
  const visual=owned.sceneComposition.fragments.main.instances[0].props.components.visual;visual.animationSet.clips[0].loop=false;
  const revisions=[{id:'pixel.new',source}];
  assert.equal(patch(owned,state,'pixel.next',info,revisions).operations[0].components.visual.animationSet.clips[0].loop,false);
  assert.throws(()=>patch(owned,state,'pixel.next',info),/owned/);
  const single=create(source);single.removeFrame(single.selectedFrame());
  const detached=patch(owned,state,'pixel.static',pixelAnimationInput(single.document()),revisions).operations[0].components;
  assert.equal(detached.visual.animationSet,undefined,'a verified owned animation can become a static sprite');
  assert.deepEqual(detached.visual.frame,{u0:0,v0:0,u1:1,v1:1},'static conversion cannot retain an atlas cell UV');
  for(const key of ['collider','body','layer'])assert.deepEqual(detached[key],operation.components[key]);
  assert.deepEqual(visual.animationSet.clips[0].frames,operation.components.visual.animationSet.clips[0].frames,'patch generation preserves its input animation');
  visual.animationSet.clips[0].fps=20;assert.throws(()=>patch(owned,state,'pixel.next',info,revisions),/Migrate/);
});

test('animated revision bundle and native reader verify sheet dimensions and preserve exact frame source',async()=>{
  const engine={async loadAssets(){},textureId(){return 41;},releaseAssets(){}},assets=createPixelAssets({engine,taken:()=>false,retains:()=>false});
  const editor=create(blank(2,1));stroke(editor,0,0,1,0,blue);editor.addFrame();stroke(editor,0,0,1,0,red);
  try {
    const asset=await assets.prepare('scene',editor.document(),new AbortController().signal);assets.commit(asset);
    assert.equal(asset.width,4);assert.equal(asset.height,1);
    assert.equal(assets.providerAssets('scene')[0].frames.length,2);
    const bundle=await pixelProjectBundle([asset]),meta=bundle.revisions[0];
    const priorFetch=globalThis.fetch,priorLocation=globalThis.location;globalThis.location={href:'https://example.test/'};
    globalThis.fetch=async url=>new Response(Buffer.from(bundle.files.find(f=>String(url).endsWith(f.path)).base64,'base64'));
    try {
      const catalog={format:'ferrum2d.pixel.project',version:1,catalogRevision:'a'.repeat(64),assets:[{metadata:meta,jsonUrl:'https://example.test/'+asset.id+'.json',pngUrl:'https://example.test/'+asset.id+'.png'}]};
      const restored=await readPixelProject(catalog,'scene','/project',new AbortController().signal);
      assert.deepEqual(restored[0].source,editor.document());assert.equal(restored[0].width,4);
      const exported=assets.bundle('scene',scene());assert.equal(exported.assets[0].animationSet.clips[0].frames.length,2);
    } finally{globalThis.fetch=priorFetch;globalThis.location=priorLocation;}
  } finally{assets.destroy();}
});

test('an unchanged formatted v3 project source reuses its exact immutable revision',async()=>{
  const editor=create(blank(2,1));editor.addFrame();const source=editor.document(),raw=JSON.stringify(source,null,2)+'\n',png=await pixelPng(source);
  const hash=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value)).toString('hex');
  const id='pixel.'+(await hash(JSON.stringify(['scene',raw]))).slice(0,24),sha256=await hash(png);
  const asset={id,identityDocument:'scene',document:'scene',project:'/project',persisted:true,committed:true,source,sourceJson:raw,png,sha256,name:source.name,width:4,height:1,bytes:Buffer.byteLength(raw)+png.byteLength,uploaded:false};
  const assets=createPixelAssets({engine:{async loadAssets(){},textureId:()=>7,releaseAssets(){}},taken:()=>false,retains:()=>false});
  try {
    await assets.restore([asset],new AbortController().signal);
    const reused=await assets.prepare('scene',create(source).document(),new AbortController().signal);
    assert.equal(reused.id,id);assert.equal(reused.sourceJson,raw);assert.equal(assets.entries().length,1);
  } finally{assets.destroy();}
});

test('maximum cel document stays below v3 source limit and within one full history snapshot',()=>{
  const editor=create(blank(256,256));for(let i=1;i<8;i++)editor.addLayer();for(let i=1;i<4;i++)editor.addFrame();
  const raw=JSON.stringify(editor.document());assert(raw.length>3*1024*1024&&raw.length<PIXEL_LIMITS.sourceBytes);
  assert.equal(read(raw).frames.length,4);
  editor.setFrameDuration(editor.selectedFrame(),120);assert.equal(editor.history().undo,1);assert.equal(editor.history().bytes,PIXEL_LIMITS.historyBytes);
  const before=editor.document();editor.undo();assert.equal(editor.frames().at(-1).durationMs,100);editor.redo();assert.deepEqual(editor.document(),before);
});

function atlasSource() {
  const source=pixelDocumentFromRgba(8,4,"fixed-atlas",Uint8Array.from({length:8*4*4},(_,i)=>i%4===3?0:i));
  return {...source,version:4,atlas:{texture:"sheet",frames:[
    {id:"left",frame:{u0:0,v0:0,u1:0.5,v1:1}},
    {id:"right",frame:{u0:0.5,v0:0,u1:1,v1:1}},
  ]}};
}
test("fixed atlas validates exact, bounded non-overlapping pixel rects without repacking",()=>{
  const source=atlasSource();assert.deepEqual(read(JSON.stringify(source)),source);
  assert.deepEqual(pixelAtlasRect(8,4,source.atlas.frames[1].frame),{x:4,y:0,width:4,height:4});
  for(const frame of [{u0:-1e-12,v0:0,u1:1,v1:1},{u0:0,v0:0,u1:1+1e-12,v1:1},{u0:0.01,v0:0,u1:1,v1:1},{u0:0,v0:0,u1:0,v1:1},{u0:-1,v0:0,u1:1,v1:1},{u0:0,v0:0,u1:NaN,v1:1}])
    assert.throws(()=>readPixelAtlas({...source.atlas,frames:[{id:"bad",frame}]},8,4));
  for(const frames of [[],Array(257).fill(source.atlas.frames[0]),[source.atlas.frames[0],source.atlas.frames[0]],
    [source.atlas.frames[0],{id:"overlap",frame:{u0:0.25,v0:0,u1:1,v1:1}}]])
    assert.throws(()=>readPixelAtlas({...source.atlas,frames},8,4));
  for(const version of [1,2,3])assert.throws(()=>read(JSON.stringify({...source,version})),/atlas version/);
});
test("atlas strokes and fill stay within the selected frame, including captured out-of-bounds endpoints",()=>{
  const source=atlasSource(),editor=create(source),before=editor.bytes();editor.selectAtlasFrame("right");
  stroke(editor,-10000,1,10000,1,blue);
  editor.begin();editor.fill(4,0,red);editor.commit();
  const output=editor.bytes();for(let y=0;y<4;y++)for(let x=0;x<4;x++)
    assert.deepEqual(output.slice((y*8+x)*4,(y*8+x+1)*4),before.slice((y*8+x)*4,(y*8+x+1)*4));
  assert.equal(editor.sample(0,0),undefined);assert.deepEqual(editor.sample(4,0),red);
  editor.undo();editor.undo();assert.deepEqual(editor.bytes(),before);editor.redo();editor.redo();assert.deepEqual(editor.bytes(),output);
  assert.deepEqual(editor.document().atlas,source.atlas);
});
test("atlas frame selection is view-only, shared Undo remains valid and structure changes are blocked",()=>{
  const source=atlasSource(),editor=create(source);editor.selectAtlasFrame("right");
  assert.equal(editor.dirty(),false);assert.deepEqual(editor.history(),{undo:0,redo:0,bytes:0});
  for(const operation of [()=>editor.addLayer(),()=>editor.addFrame(),()=>editor.duplicateFrame(),()=>editor.setLayerVisible(editor.selectedLayer(),false),()=>editor.setFrameDuration(editor.selectedFrame(),200)])
    assert.throws(operation,/Atlas layout is fixed/);
  stroke(editor,4,1,4,1,blue);editor.selectAtlasFrame("left");editor.undo();assert.deepEqual(editor.document(),source);
  assert.equal(editor.selectedAtlasFrame(),"left");assert.equal(editor.dirty(),false);editor.redo();
  assert.equal(editor.dirty(),true);assert.equal(editor.selectedAtlasFrame(),"left");
});
test("fixed atlas PNG roundtrip preserves all straight-alpha bytes, including unedited transparent RGB",async()=>{
  const source=atlasSource(),editor=create(source);stroke(editor,1,1,1,1,blue);
  const png=await pixelPng(editor.document()),decoded=await readPixelPng(png);
  assert.deepEqual(decoded.pixels,editor.bytes());assert.deepEqual([decoded.width,decoded.height],[8,4]);
  assert.deepEqual(new Uint8Array(decodePng(Buffer.from(png)).pixels),editor.bytes());
  const restored=create(read(JSON.stringify(editor.document())));assert.deepEqual(restored.bytes(),editor.bytes());
  assert.deepEqual(restored.atlas(),source.atlas);
});

test("atlas apply preserves UV and components and rejects wrong, locked, animated or normal-bound targets",()=>{
  const source=atlasSource(),document=scene(),visual=document.sceneComposition.fragments.main.instances[0].props.components.visual;
  visual.texture="sheet";visual.frame={...source.atlas.frames[1].frame};const before=structuredClone(document);
  const operation=atlasPatch(document,state,"pixel.new",source,"right",[]).operations[0];
  assert.deepEqual(operation.components,{...before.sceneComposition.fragments.main.instances[0].props.components,
    visual:{...visual,texture:"pixel.new",asset:"pixel.new"}});assert.deepEqual(document,before);
  for(const patch of [{texture:"wrong"},{frame:source.atlas.frames[0].frame},{animationSet:{}},{animation:{}}]) {
    const invalid=structuredClone(document);Object.assign(invalid.sceneComposition.fragments.main.instances[0].props.components.visual,patch);
    assert.throws(()=>atlasPatch(invalid,state,"pixel.new",source,"right",[]),/static sprite/);
  }
  assert.throws(()=>atlasPatch(document,{...state,lockedInstanceIds:["hero"]},"pixel.new",source,"right",[]),/Unlock/);
  const normal=structuredClone(document);normal.spatial={billboards:{hero:{normalTexture:"normals"}}};
  assert.throws(()=>atlasPatch(normal,state,"pixel.new",source,"right",[]),/normals/);
  visual.texture="pixel.old";assert.throws(()=>atlasPatch(document,state,"pixel.new",source,"right",[]));
  assert.doesNotThrow(()=>atlasPatch(document,state,"pixel.new",source,"right",[{id:"pixel.old",source}]));
});

test("a fixed atlas full frame matches an authored sprite's omitted default UV",()=>{
  const source=atlasSource(),document=scene(),visual=document.sceneComposition.fragments.main.instances[0].props.components.visual;
  visual.texture='sheet';assert.equal(visual.frame,undefined);
  source.atlas.frames=[{id:'full',frame:{u0:0,v0:0,u1:1,v1:1}}];
  const before=structuredClone(document);
  const operation=atlasPatch(document,state,'pixel.full',source,'full',[]).operations[0];
  assert.deepEqual(operation.components.visual,{...visual,texture:'pixel.full',asset:'pixel.full',frame:source.atlas.frames[0].frame});
  assert.deepEqual(document,before);
  const invalid=structuredClone(document);invalid.sceneComposition.fragments.main.instances[0].props.components.visual.frame=null;
  assert.throws(()=>atlasPatch(invalid,state,'pixel.full',source,'full',[]),/frame/);
  assert.throws(()=>atlasPatch(document,state,'pixel.half',atlasSource(),'right',[]),/static sprite/);
  visual.frame={};assert.doesNotThrow(()=>atlasPatch(document,state,'pixel.full',source,'full',[]));
  visual.frame={u0:0.5};assert.doesNotThrow(()=>atlasPatch(document,state,'pixel.half',atlasSource(),'right',[]));
});

test('tag editing is versioned, undoable and keeps stable frame and clip identities',()=>{
  const editor=create(blank(2,1));const first=editor.selectedFrame(),second=editor.addFrame();
  const legacy=editor.document(),idle=editor.addTag('idle',[first]),walk=editor.addTag('walk',[first,second]);
  assert.equal(editor.document().version,5);assert.deepEqual(editor.tags().map(t=>t.clipId),[0,1]);
  editor.updateTag(walk,{name:'run',frameIds:[second,first],loop:false});editor.setInitialTag(walk);
  editor.moveFrame(first,1);
  assert.deepEqual(editor.tags()[1].frameIds,[second,first],'source reordering cannot retime tag membership');
  const source=editor.document();assert.deepEqual(read(JSON.stringify(source)),source);
  assert.deepEqual(create(source).tags(),editor.tags());assert.equal(create(source).initialTag(),walk);
  const history=editor.history();assert.throws(()=>editor.removeFrame(first),/tags/);assert.deepEqual(editor.history(),history);
  editor.tags()[0].frameIds.length=0;assert.equal(editor.tags()[0].frameIds.length,1,'metadata snapshots cannot mutate the editor');
  editor.removeTag(walk);const next=editor.addTag('attack',[second]);assert.equal(editor.tags().find(t=>t.id===next).clipId,2);
  const reopened=create(read(JSON.stringify(editor.document())));reopened.removeTag(next);assert.equal(reopened.addTag('jump',[second]).startsWith('tag-'),true);assert.equal(reopened.tags()[1].clipId,3);
  editor.undo();editor.undo();assert.deepEqual(editor.document(),source);
  editor.redo();assert.equal(editor.tags().length,1);assert.throws(()=>editor.removeTag(idle),/at least one/);
  while(editor.history().undo)editor.undo();assert.equal(editor.document().version,1);
  assert.equal(legacy.version,3);
});
test('tag schema rejects invalid references, collisions, allocation and old-version metadata',()=>{
  const editor=create(blank(2,1));editor.addTag('idle',[editor.selectedFrame()]);const source=editor.document();
  const changes=[s=>s.tags=[],s=>s.tags.push({...s.tags[0]}),s=>s.tags[0].frameIds=['missing'],s=>s.tags[0].frameIds=['frame-1','frame-1'],
    s=>s.tags[0].loop='true',s=>s.tags[0].clipId=65536,s=>s.nextClipId=0,s=>s.nextClipId=65537,s=>s.initialTag='missing',s=>s.version=3];
  for(const change of changes){const bad=structuredClone(source);change(bad);assert.throws(()=>read(JSON.stringify(bad)));}
  const before=editor.document(),history=editor.history();
  assert.throws(()=>editor.addTag('idle',['frame-1']),/Duplicate/);assert.throws(()=>editor.addTag('walk',[]),/unique/);
  assert.deepEqual(editor.document(),before);assert.deepEqual(editor.history(),history);
});
test('tags compile independent ordered loops with per-clip timing and a stable initial clip',async()=>{
  const editor=create(blank(2,1));const first=editor.selectedFrame();stroke(editor,0,0,1,0,blue);
  const second=editor.addFrame();editor.setFrameDuration(second,200);stroke(editor,0,0,1,0,red);
  const idle=editor.addTag('idle',[first]),walk=editor.addTag('walk',[second,first]);
  editor.updateTag(walk,{name:'walk',frameIds:[second,first],loop:false});editor.setInitialTag(walk);
  const source=editor.document(),compiled=pixelAnimation(pixelAnimationInput(source));
  assert.equal(compiled.set.initialClip,1);assert.deepEqual(compiled.set.clips.map(t=>t.id),[0,1]);
  assert.deepEqual(compiled.set.clips[1].frames,[compiled.layout.frames[1],compiled.layout.frames[1],compiled.layout.frames[0]]);
  assert.equal(compiled.set.clips[1].loop,false);assert.equal(compiled.cycleMs,300);
  const png=decodePng(Buffer.from(await pixelPng(source)));assert.equal(png.width,4);assert.deepEqual([...png.pixels], [...blue,...blue,...red,...red]);
  editor.moveFrame(first,1);const reordered=pixelAnimation(pixelAnimationInput(editor.document()));
  assert.deepEqual(reordered.set.clips[1].frames,[reordered.layout.frames[0],reordered.layout.frames[0],reordered.layout.frames[1]]);
  assert.equal(editor.tags()[0].id,idle);
});
test('owned tagged migration requires exact approval, retains all existing clip IDs and preserves unrelated props',()=>{
  const editor=create(blank(2,1));const first=editor.selectedFrame(),second=editor.addFrame();
  const old=editor.document(),document=scene();
  document.sceneComposition.fragments.main.instances[0].props.components=patch(document,state,'pixel.old',pixelAnimationInput(old)).operations[0].components;
  editor.addTag('idle',[first]);editor.addTag('walk',[first,second]);const info=pixelAnimationInput(editor.document()),revisions=[{id:'pixel.old',source:old}];
  let required;try{patch(document,state,'pixel.next',info,revisions);}catch(error){required=error;}
  assert.equal(required.constructor.name,'PixelClipMigrationRequired');assert.deepEqual(required.beforeIds,[0]);assert.deepEqual(required.afterIds,[0,1]);
  const migrated=patch(document,state,'pixel.next',info,revisions,required.approval).operations[0].components;
  assert.deepEqual(migrated.visual.animationSet,pixelAnimation(info).set);
  for(const key of ['collider','body','layer'])assert.deepEqual(migrated[key],document.sceneComposition.fragments.main.instances[0].props.components[key]);
  const stale=structuredClone(info);stale.tags[1].loop=false;assert.throws(()=>patch(document,state,'pixel.next',stale,revisions,required.approval),/Migrate/);
  const after=scene();after.sceneComposition.fragments.main.instances[0].props.components=migrated;
  const current=[{id:'pixel.next',source:editor.document()}];
  assert.doesNotThrow(()=>patch(after,state,'pixel.same',info,current));
  editor.removeTag(editor.tags()[1].id);assert.throws(()=>patch(after,state,'pixel.removed',pixelAnimationInput(editor.document()),current),/Keep existing clip IDs/);
  assert.throws(()=>patch(after,state,'pixel.external',info,[]),/owned/);
});
test('tagged revisions export clip metadata and roundtrip through the native source reader',async()=>{
  const editor=create(blank(2,1));stroke(editor,0,0,1,0,blue);editor.addTag('idle',[editor.selectedFrame()]);editor.addTag('attack',[editor.selectedFrame()]);
  const assets=createPixelAssets({engine:{async loadAssets(){},textureId(){return 41;},releaseAssets(){}},taken:()=>false,retains:()=>false});
  try {
    const asset=await assets.prepare('scene',editor.document(),new AbortController().signal);assets.commit(asset);
    const output=assets.bundle('scene',scene());assert.equal(output.assets[0].animationSet.clips.length,2);
    const bundle=await pixelProjectBundle([asset]);
    const host={format:'ferrum2d.pixel.project',version:1,catalogRevision:'a'.repeat(64),assets:[{metadata:bundle.revisions[0],jsonUrl:'https://fixture/source',pngUrl:'https://fixture/png'}]};
    const previous=globalThis.fetch,locationBefore=globalThis.location;globalThis.location={href:'https://fixture/'};
    globalThis.fetch=async url=>new Response(String(url).endsWith('/source')?asset.sourceJson:asset.png.slice(0));
    try{const [restored]=await readPixelProject(host,'next','project',new AbortController().signal);assert.deepEqual(restored.source,editor.document());}
    finally{globalThis.fetch=previous;globalThis.location=locationBefore;}
  }finally{assets.destroy();}
});
test('tag limits fail without changes and initial clip UV follows the chosen tag',()=>{
  const editor=create(blank(1,1));const first=editor.selectedFrame(),second=editor.addFrame();
  editor.addTag('idle',[first]);const walk=editor.addTag('walk',[second]);editor.setInitialTag(walk);
  const info=pixelAnimationInput(editor.document()),compiled=pixelAnimation(info);
  const visual=patch(scene(),state,'pixel.tagged',info).operations[0].components.visual;
  assert.equal(visual.animationSet.initialClip,1);assert.deepEqual(visual.frame,compiled.layout.frames[1]);
  while(editor.tags().length<PIXEL_LIMITS.tags)editor.addTag('tag-'+editor.tags().length,[first]);
  const before=editor.document(),history=editor.history();assert.throws(()=>editor.addTag('overflow',[first]),/tag limit/);
  assert.deepEqual(editor.document(),before);assert.deepEqual(editor.history(),history);
  const exhausted=create({...before,nextClipId:65536});assert.throws(()=>exhausted.addTag('unused',[first]),/tag limit/);
  exhausted.removeTag(exhausted.tags().at(-1).id);assert.throws(()=>exhausted.addTag('unused',[first]),/clip ID limit/);
});

const pixelNormalUrl=await moduleUrl('placementPixelNormals',{
  './placementPixelDocument':documentUrl,'./placementPixelAnimation':animationUrl,
  './placementPixelAssets':await moduleUrl('placementPixelAssets',{'./placementPixelDocument':documentUrl,'./placementPixelAnimation':animationUrl,'./placementAssetScope':scopeUrl,'@ferrum2d/ferrum-web/authoring':new URL('../../packages/ferrum-web/dist/authoring.js',import.meta.url).href,'./placementNormalAssets':hashUrl,'./placementSpriteRevisions':storeUrl,'./placementPixelPng':await moduleUrl('placementPixelPng',{'./placementPixelDocument':documentUrl})}),
  './placementFrameNormals':'data:text/javascript,export function createPlacementFrameNormals(options){return options}',
  './placementNormalAssets':hashUrl,
  './placementAsepriteAnimation':await moduleUrl('placementAsepriteAnimation',{'@ferrum2d/ferrum-web/authoring':new URL('../../packages/ferrum-web/dist/authoring.js',import.meta.url).href}),
  '@ferrum2d/ferrum-web/authoring':new URL('../../packages/ferrum-web/dist/authoring.js',import.meta.url).href,
});
const {pixelNormalFrames,pixelNormalSource,pixelNormalPatch}=await checkedImport(pixelNormalUrl);
const {createPlacementFrameNormals}=await checkedImport(await moduleUrl('placementFrameNormals',{
  './placementNormalReferences':await moduleUrl('placementNormalReferences'),
  './placementLocale':'data:text/javascript,export function uiMessage(text,...args){return {text,args}}',
  './placementAssetScope':scopeUrl,
  './placementAsepriteAnimation':await moduleUrl('placementAsepriteAnimation',{'@ferrum2d/ferrum-web/authoring':new URL('../../packages/ferrum-web/dist/authoring.js',import.meta.url).href}),
  './placementAsepriteNormalPng':await moduleUrl('placementAsepriteNormalPng'),
  './placementNormalAssets':await moduleUrl('placementNormalAssets',{'./placementAssetScope':scopeUrl,'@ferrum2d/ferrum-web/authoring':new URL('../../packages/ferrum-web/dist/authoring.js',import.meta.url).href}),
  '@ferrum2d/ferrum-web/authoring':new URL('../../packages/ferrum-web/dist/authoring.js',import.meta.url).href,
}));
test('normal cache scope follows live entries and target-scene evidence, including close during restore',async()=>{
  const {placementNormalHash:sha}=await checkedImport(hashUrl),source=blank(1,1),png=await pixelPng(source),normal=await pixelPng(pixelDocumentFromRgba(1,1,'normal',new Uint8Array([128,128,255,255])));
  const asset={id:'pixel.'+'a'.repeat(24),document:'scene',source,sourceJson:JSON.stringify(source),width:1,height:1,png,sha256:await sha(png)},input=await pixelNormalSource(asset);
  const settings={normalStrength:1.5},generator={repository:'test',revision:'d'.repeat(40),binarySha256:'e'.repeat(64)};
  const key=await sha(JSON.stringify(['scene',asset.id,settings,generator,'pixel-rects-v1'])),normalId='pixel-normal.'+key.slice(0,24);
  const binding={format:'ferrum2d.sprite-normal.binding',version:1,width:1,height:1,
    textures:{color:{asset:asset.id,path:asset.id+'.png',sha256:asset.sha256,colorSpace:'srgb'},normal:{asset:normalId,path:normalId+'.png',sha256:await sha(normal),colorSpace:'none'}},
    frames:[{u0:0,v0:0,u1:1,v1:1}],generation:{...generator,configSha256:'f'.repeat(64),settings:{},input:{path:'color.png',sha256:asset.sha256}}};
  const report={format:'ferrum2d.pixel-normal.report',source:{assetId:asset.id,jsonSha256:input.jsonSha256,pngSha256:asset.sha256},frames:[{id:input.frames[0].id,rect:[0,0,1,1]}]};
  const bundle={binding,report,files:[{path:normalId+'.png',base64:Buffer.from(normal).toString('base64')}]};
  const make=project=>createPlacementFrameNormals({kind:'pixel',engine:{loadAssets:async()=>{},releaseAssets:()=>{}},host:()=>({generator}),project:()=>project,settings:()=>settings,restored:()=>[bundle],taken:()=>false});
  const local=make(),{entry}=await local.prepare(input,new AbortController().signal,()=>{});
  assert(local.available(entry,'scene'));assert(!local.available(entry,'sibling'));
  local.close('scene');assert(!local.available(entry,'scene'));
  assert.throws(()=>local.activate(entry,scene(),{operations:[]},()=>assert.fail('closed entry applied')),/closed/);
  const durable=make('project'),saved=(await durable.prepare(input,new AbortController().signal,()=>{})).entry;
  assert(durable.available(saved,'sibling'));
  const target=scene();target.sceneComposition.fragments.main.instances[0].props.components.layer='wall';
  target.spatial={camera:{projection:'orthographic',position:{x:0,y:-200,elevation:80},target:{x:0,y:0,elevation:32},height:110,near:0.1,far:1200},terrain:[],billboards:{hero:{}}};
  const patch=pixelNormalPatch(target,state,asset,saved,[],[],'');
  durable.activate(saved,target,patch,()=>{},'sibling');
  const flat=scene();flat.sceneComposition.fragments.main.instances[0].props.components.visual.normalTexture=normalId;
  assert(!durable.blocksSave(flat,'sibling'));
  flat.sceneComposition.fragments.main.instances[0].props.components.visual.normalTexture=42;
  const numeric=createPlacementFrameNormals({kind:'pixel',engine:{textureId:()=>42},host:()=>({generator}),project:()=> 'project',settings:()=>settings,restored:()=>[bundle],taken:()=>false});
  await numeric.prepare(input,new AbortController().signal,()=>{});assert(numeric.blocksSave(flat,'scene'));numeric.destroy();
  assert.equal(durable.bindings('sibling').length,1);assert.equal(durable.bindings('scene').length,0);
  durable.close('scene');assert(durable.available(saved,'sibling'));durable.destroy();assert(!durable.available(saved,'sibling'));
  const closing=make('project'),pending=closing.prepare(input,new AbortController().signal,()=>{});closing.destroy();
  await assert.rejects(pending,/disposed/);
});
test('pixel normal regions exclude atlas padding and preserve stable source frame IDs',()=>{
  const editor=create(blank(2,1));const first=editor.selectedFrame();editor.addFrame();editor.addFrame();editor.addTag('idle',[first]);
  const source=editor.document(),rects=pixelNormalFrames(source);
  assert.deepEqual(rects,source.frames.map((frame,i)=>({id:frame.id,x:i%2*2,y:Math.floor(i/2),width:2,height:1})));
  assert.equal(rects.length,3);assert.equal(rects.some(rect=>rect.x===2&&rect.y===1),false);
  const fixed={...blank(4,2),version:4,atlas:{texture:'sheet',frames:[{id:'right',frame:{u0:0.5,v0:0,u1:1,v1:1}}]}};
  assert.deepEqual(pixelNormalFrames(fixed),[{id:'right',x:2,y:0,width:2,height:2}]);
});
test('pixel normal inputs snapshot all source fields before hash work yields',async()=>{
  const source=blank(2,1),asset={id:'pixel.'+'a'.repeat(24),document:'scene',source,sourceJson:JSON.stringify(source),width:2,height:1,png:new Uint8Array([1,2,3]).buffer,sha256:'b'.repeat(64)};
  const expected=structuredClone(asset),pending=pixelNormalSource(asset);
  asset.id='changed';asset.source.frame.id='changed';asset.sourceJson='changed';new Uint8Array(asset.png).fill(0);asset.sha256='changed';
  const actual=await pending;assert.equal(actual.id,expected.id);assert.equal(actual.sourceJson,expected.sourceJson);assert.equal(actual.pngSha256,expected.sha256);
  assert.deepEqual([...new Uint8Array(actual.png)],[1,2,3]);assert.equal(actual.frames[0].id,'frame-1');
});
test('normal stale revisions advance for content and Undo while frame/layer selection stays view-only',()=>{
  const editor=create(blank(2,1));const first=editor.selectedFrame(),other=editor.addFrame(),revision=editor.revision();
  editor.selectFrame(first);editor.selectLayer(editor.selectedLayer());assert.equal(editor.revision(),revision);
  stroke(editor,0,0,0,0);const edited=editor.revision();assert(edited>revision);
  editor.undo();assert(editor.revision()>edited);assert(editor.bytes().every(n=>n===0));
  editor.setFrameDuration(other,200);assert(editor.revision()>edited);
});
test('paired pixel patch protects foreign normals, checks source identity and preserves components',async()=>{
  const source=blank(2,1),asset={id:'pixel.'+'a'.repeat(24),document:'scene',source,sourceJson:JSON.stringify(source),width:2,height:1,png:new Uint8Array().buffer,sha256:'b'.repeat(64)};
  const input=await pixelNormalSource(asset),binding={format:'ferrum2d.sprite-normal.binding',version:1,width:2,height:1,
    textures:{color:{asset:asset.id,path:asset.id+'.png',sha256:asset.sha256,colorSpace:'srgb'},normal:{asset:'pixel-normal.test',path:'normal.png',sha256:'c'.repeat(64),colorSpace:'none'}},
    frames:[{u0:0,v0:0,u1:1,v1:1}],generation:{repository:'test',revision:'d'.repeat(40),binarySha256:'e'.repeat(64),configSha256:'f'.repeat(64),settings:{},input:{path:'color.png',sha256:asset.sha256}}};
  const entry={source:input,binding},document=scene();document.sceneComposition.fragments.main.instances[0].props.components.layer='wall';
  document.spatial={camera:{projection:'orthographic',position:{x:0,y:-200,elevation:80},target:{x:0,y:0,elevation:32},height:110,near:0.1,far:1200},terrain:[],billboards:{hero:{}}};
  const before=structuredClone(document),paired=pixelNormalPatch(document,state,asset,entry,[],[],'');
  assert.equal(paired.version,3);assert.equal(paired.spatial.operations[0].changes.normalTexture,'pixel-normal.test');
  for(const key of ['collider','body','layer'])assert.deepEqual(paired.operations[0].components[key],before.sceneComposition.fragments.main.instances[0].props.components[key]);
  assert.deepEqual(document,before);
  assert.throws(()=>pixelNormalPatch(document,state,{...asset,sourceJson:'different'},entry,[],[],''),/source differs/);
  document.spatial.billboards.hero.normalTexture='external';assert.throws(()=>pixelNormalPatch(document,state,asset,entry,[],[],''),/not owned/);
  assert.doesNotThrow(()=>pixelNormalPatch(document,state,asset,entry,[],[{report:{format:'ferrum2d.pixel-normal.report'},binding:{textures:{color:{asset:'old'},normal:{asset:'external'}}}}],''));
});
const {validatePlacementAssetPatch}=await checkedImport(await moduleUrl('placementAssetPatch',{'@ferrum2d/ferrum-web/authoring':new URL('../../packages/ferrum-web/dist/authoring.js',import.meta.url).href}));
test('asset scope permits only a normal binding paired with a local component update',()=>{
  const document=scene();document.sceneComposition.fragments.main.instances[0].props.components.layer='wall';
  document.spatial={camera:{projection:'orthographic',position:{x:0,y:-200,elevation:80},target:{x:0,y:0,elevation:32},height:110,near:0.1,far:1200},terrain:[],billboards:{hero:{}}};
  const patch={format:'ferrum2d.scene-placement.patch',version:3,operations:[{kind:'updateComponents',instanceId:'hero',components:document.sceneComposition.fragments.main.instances[0].props.components}],
    spatial:{format:'ferrum2d.scene-spatial.patch',version:4,operations:[{kind:'setBillboardNormalTexture',id:'hero',changes:{normalTexture:'normal'}}]}};
  const before=structuredClone(document);assert.doesNotThrow(()=>validatePlacementAssetPatch(document,patch,'main'));assert.deepEqual(document,before);
  assert.throws(()=>validatePlacementAssetPatch(document,{...patch,operations:[]},'main'),/matching sprite/);
  assert.throws(()=>validatePlacementAssetPatch(document,{...patch,lighting:{}},'main'),/cannot change scene lighting/);
  assert.throws(()=>validatePlacementAssetPatch(document,{...patch,spatial:{...patch.spatial,operations:[{kind:'setCamera',changes:{}}]}},'main'),/matching sprite/);
  document.sceneComposition.fragments.other={instances:[{id:'other',prefab:'object',x:0,y:0,props:{components:patch.operations[0].components}}]};
  assert.throws(()=>validatePlacementAssetPatch(document,{...patch,operations:[{...patch.operations[0],instanceId:'other'}]},'main'),/allowed|scope|fragment/i);
});


test('ordinary 2D paired pixel application preserves the target and protects stale normals',async()=>{
  const source=blank(2,1),asset={id:'pixel.'+'a'.repeat(24),document:'scene',source,sourceJson:JSON.stringify(source),width:2,height:1,png:new ArrayBuffer(0),sha256:'b'.repeat(64)};
  const input=await pixelNormalSource(asset),binding={format:'ferrum2d.sprite-normal.binding',version:1,width:2,height:1,
    textures:{color:{asset:asset.id,path:asset.id+'.png',sha256:asset.sha256,colorSpace:'srgb'},normal:{asset:'pixel-normal.test',path:'normal.png',sha256:'c'.repeat(64),colorSpace:'none'}},
    frames:[{u0:0,v0:0,u1:1,v1:1}],generation:{repository:'test',revision:'d'.repeat(40),binarySha256:'e'.repeat(64),configSha256:'f'.repeat(64),settings:{},input:{path:'color.png',sha256:asset.sha256}}};
  const document=scene();document.sceneComposition.fragments.main.instances[0].props.components.layer='wall';
  const before=structuredClone(document),entry={source:input,binding};
  const paired=pixelNormalPatch(document,state,asset,entry,[],[],'');assert.equal(paired.version,2);assert.equal(paired.spatial,undefined);
  assert.equal(paired.operations[0].components.visual.normalTexture,'pixel-normal.test');assert.deepEqual(document,before);
  assert.doesNotThrow(()=>validatePlacementAssetPatch(document,paired,'main'));
  document.sceneComposition.fragments.main.instances[0].props.components=paired.operations[0].components;
  assert.throws(()=>patch(document,state,'color'),/paired normals/);
  assert.throws(()=>pixelNormalPatch(document,state,asset,entry,[],[],''),/not owned/);
  const known=[{report:{format:'ferrum2d.pixel-normal.report'},binding}];
  assert.doesNotThrow(()=>pixelNormalPatch(document,state,asset,entry,[],known,''));
});
test('normal references include inherited prefab, variant, include and legacy/numeric sprite paths',async()=>{
  const {normalReferences,referencesNormal,visitNormalReferences}=await checkedImport(await moduleUrl('placementNormalReferences'));
  const document=scene();document.sceneComposition.prefabs.object.props={components:{visual:{normalTexture:'prefab'}}};
  document.sceneComposition.prefabs.object.variants={alt:{props:{components:{sprite:{normalTexture:12}}}}};
  document.sceneComposition.fragments.main.include=[{fragment:'empty',props:{components:{visual:{normalTexture:'include'}}}}];
  document.sceneComposition.fragments.main.instances[0].props.components.visual.normalTexture='instance';
  document.spatial={billboards:{hero:{normalTextureId:13}}};
  const refs=normalReferences(document);assert.deepEqual([...refs],['prefab',12,'instance','include',13]);
  assert(referencesNormal(refs,'known',()=>12));assert(!referencesNormal(refs,'other',()=>14));
  const copy=structuredClone(document);visitNormalReferences(copy,(owner,key)=>{if(owner[key]===12)owner[key]='stable';});assert(normalReferences(copy).has('stable'));assert(normalReferences(document).has(12));
});
