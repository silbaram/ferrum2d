import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import {
  encodePngRgba,
  decodePng,
} from "../../scripts/tools/pack-textures.mjs";
const require = createRequire(
    new URL("../../apps/placement-viewer/package.json", import.meta.url),
  ),
  ts = require("typescript");
const authoring = new URL(
  "../../packages/ferrum-web/dist/authoring.js",
  import.meta.url,
).href;
const { createScenePlacementViewer } = await import(authoring);
async function moduleSource(file, replacements = []) {
  let output = ts
    .transpileModule(
      await readFile(
        new URL("../../apps/placement-viewer/src/" + file, import.meta.url),
        "utf8",
      ),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      },
    )
    .outputText.replaceAll("@ferrum2d/ferrum-web/authoring", authoring);
  for (const [from, to] of replacements) output = output.replaceAll(from, to);
  return (
    "data:text/javascript;base64," + Buffer.from(output).toString("base64")
  );
}
const scope = await moduleSource("placementAssetScope.ts"),
  assets = await moduleSource("placementNormalAssets.ts", [["./placementAssetScope", scope]]),
  source = await moduleSource("placementNormalProject.ts", [
    ["./placementNormalAssets", assets],
    [
      "./placementAsepriteAnimation",
      await moduleSource("placementAsepriteAnimation.ts"),
    ],
  ]);
const {
  createDesktopNormalProjectHost: host,
  readPlacementNormalProject: read,
  createPlacementNormalProjectAssets: store,
} = await import(source);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
globalThis.location = new URL("http://normal.test/");
globalThis.window = new EventTarget();
globalThis.createImageBitmap = async (blob) => {
  const decoded = decodePng(Buffer.from(await blob.arrayBuffer()));
  return { width: decoded.width, height: decoded.height, close() {} };
};
const signal = () => new AbortController().signal;
test("project normal assets remain available to sibling scenes after the first document closes", async () => {
  const f = fixture(true), released = [];
  const manager = store({ loadAssets: async () => {}, releaseAssets: value => released.push(value) }, "first", "project-a");
  await manager.load(f.catalog, new Map(), () => false, signal());
  const document = {
    format: "ferrum2d.consumer.scene-authoring", version: 1, behaviorRecipes: { entities: {} },
    sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: { instances: [{ id: "sprite", prefab: "object", x: 0, y: 0, props: { components: { collider: "none", layer: "wall", visual: { kind: "sprite", texture: "pair.color", width: 32, height: 32, frame: { u0: 0, v0: 0, u1: 1, v1: 1 } } } } }] } } },
    spatial: { camera: { projection: "orthographic", position: { x: 0, y: -200, elevation: 80 }, target: { x: 0, y: 0, elevation: 32 }, height: 110, near: 0.1, far: 1200 }, terrain: [], billboards: { sprite: { normalTexture: "pair.normal" } } },
  };
  assert.equal(manager.browserEntries("second", "project-a").length, 1);
  assert.equal(manager.browserEntries("second", "project-b").length, 0);
  assert.doesNotThrow(() => manager.assertDocumentAssets(document, "second", "project-a"));
  assert.throws(() => manager.assertDocumentAssets(document, "second", "project-b"), /another document/);
  assert.throws(() => manager.assertDocumentAssets(document, "first"), /another document/);
  manager.close("first");
  assert.equal(released.length, 0);
  assert.equal(manager.bundles("second", document, "project-a")[0].files.length, 2);
  const state = createScenePlacementViewer({ document, viewport: { cssWidth: 320, cssHeight: 240 } }).state();
  assert.equal(manager.bindings("second", document, state, "project-a").length, 1);
  manager.destroy();
  assert.equal(released.length, 1);
});
function fixture(aseprite = false) {
  const pixel=aseprite==="pixel", family=pixel?"pixel":"aseprite", colorId=pixel?"pixel."+"a".repeat(24):"pair.color";
  const color = encodePngRgba(1, 1, new Uint8Array([220, 30, 20, 255])),
    normal = encodePngRgba(1, 1, new Uint8Array([128, 128, 255, 255]));
  const generator = {
    repository: "generator",
    revision: "a".repeat(40),
    binarySha256: "a".repeat(64),
  };
  let report = {
    format: "ferrum2d.sprite-normals.report",
    version: 1,
    ok: true,
    generator,
    config: { sha256: "a".repeat(64) },
    settings: {},
    normalFormat: "opengl",
    colorSpace: "none",
    results: [
      {
        input: { path: "source.png", sha256: sha(color) },
        color: "source.png",
        normal: "source_n.png",
        width: 1,
        height: 1,
        outputs: [{ path: "source_n.png", sha256: sha(normal) }],
      },
    ],
  };
  let metadataJson = "{}",
    settings = {},
    configSha256 = report.config.sha256;
  if (aseprite) {
    const content = {
      format: "ferrum2d."+family+"-normal.report",
      version: 1,
      pipeline: family+"-rects-v1",
      source: {
        assetId: colorId,
        jsonSha256: "b".repeat(64),
        pngSha256: sha(color),
      },
      settings: {},
      frames: [{ ...(pixel?{id:"frame-1"}:{}),rect: [0, 0, 1, 1], report }],
      output: { sha256: sha(normal), width: 1, height: 1 },
    };
    configSha256 = sha(JSON.stringify(content));
    report = {
      ...content,
      config: { path: "config.json", sha256: configSha256 },
    };
    metadataJson = JSON.stringify(report);
    settings = { pipeline: family+"-rects-v1", jsonSha256: "b".repeat(64) };
  }
  const binding = {
    format: "ferrum2d.sprite-normal.binding",
    version: 1,
    width: 1,
    height: 1,
    textures: {
      color: {
        asset: colorId,
        path: "source.png",
        sha256: sha(color),
        colorSpace: "srgb",
      },
      normal: {
        asset: "pair.normal",
        path: "source_n.png",
        sha256: sha(normal),
        colorSpace: "none",
      },
    },
    frames: [{ u0: 0, v0: 0, u1: 1, v1: 1 }],
    generation: {
      ...generator,
      configSha256,
      settings,
      input: { path: "source.png", sha256: sha(color) },
    },
  };
  const bundle = {
    format: "ferrum2d.sprite-normal.assets",
    version: 1,
    overwrite: false,
    document: "scene",
    binding,
    report,
    metadataJson,
    manifest: {
      textures: {
        [colorId]: colorId+".png",
        "pair.normal": "pair.normal.png",
      },
      textureOptions: {
        [colorId]: { colorSpace: "srgb" },
        "pair.normal": { colorSpace: "none" },
      },
    },
    files: [],
  };
  const data = new Map();
  function refresh() {
    const bytes = Buffer.from(JSON.stringify(bundle)),
      id = sha(bytes);
    data.set("http://normal.test/metadata", bytes);
    return {
      format: "ferrum2d.sprite-normal.project",
      version: 1,
      registered: true,
      entries: [{ sha256: id, metadataUrl: "/metadata" }],
      textures: { [colorId]: "/color", "pair.normal": "/normal" },
    };
  }
  data.set("http://normal.test/color", color);
  data.set("http://normal.test/normal", normal);
  const catalog = refresh();
  globalThis.fetch = async (url) =>
    new Response(data.get(String(url)), {
      status: data.has(String(url)) ? 200 : 404,
    });
  return { bundle, catalog, data, refresh };
}
test("worker and Aseprite metadata roundtrip retains binding and measured color spaces", async () => {
  for (const aseprite of [false, true]) {
    const f = fixture(aseprite),
      result = await read(f.catalog, signal());
    assert.equal(result.pairs.length, 1);
    assert.deepEqual(result.pairs[0].bundle.binding, f.bundle.binding);
    assert.equal(result.textures.get("pair.color").colorSpace, "srgb");
    assert.equal(result.textures.get("pair.normal").colorSpace, "none");
  }
});
test("rejects changed metadata, actual PNG bytes, dimensions, provenance and URL schemes", async () => {
  let f = fixture();
  f.catalog.entries[0].sha256 = "0".repeat(64);
  await assert.rejects(read(f.catalog, signal()), /metadata SHA/);
  f = fixture();
  f.data.set(
    "http://normal.test/normal",
    encodePngRgba(1, 1, new Uint8Array([1, 2, 3, 255])),
  );
  await assert.rejects(read(f.catalog, signal()), /texture hash/);
  f = fixture();
  f.bundle.binding.width = 2;
  await assert.rejects(read(f.refresh(), signal()), /differs/);
  f = fixture(true);
  f.bundle.report.settings.normalStrength = 999;
  f.bundle.metadataJson = JSON.stringify(f.bundle.report);
  await assert.rejects(read(f.refresh(), signal()), /provenance/);
  f = fixture();
  f.catalog.textures["pair.normal"] = "blob:temporary";
  await assert.rejects(read(f.catalog, signal()), /durable/);
});
test("catalog duplicate/extra texture entries and cancellation fail before activation", async () => {
  const f = fixture();
  f.catalog.entries.push(f.catalog.entries[0]);
  await assert.rejects(read(f.catalog, signal()), /duplicate/);
  f.catalog.entries.pop();
  f.catalog.textures.extra = "/normal";
  await assert.rejects(read(f.catalog, signal()), /unexpected/);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(read(f.catalog, aborted.signal), /abort/i);
});
test("native save adapter preserves ordered JSON, validates replies, and stops after cancellation", async () => {
  const f = fixture(true);
  let args, command;
  const adapter = host(async (name, value) => {
    command = name;
    args = value;
    return f.catalog;
  }, "/project");
  assert.equal(
    (await adapter.saveAssets(f.bundle, { signal: signal() })).registered,
    true,
  );
  assert.equal(command, "save_placement_normal_assets");
  assert.equal(args.metadataJson, JSON.stringify(f.bundle));
  assert.equal(args.projectPath, "/project");
  const abort = new AbortController();
  const late = host(async () => {
    abort.abort();
    return f.catalog;
  }, "/project");
  await assert.rejects(
    late.saveAssets(f.bundle, { signal: abort.signal }),
    /abort/i,
  );
  f.catalog.entries[0].sha256 = "0".repeat(64);
  await assert.rejects(
    adapter.saveAssets(f.bundle, { signal: signal() }),
    /metadata SHA/,
  );
});
test("restoration shares source colors, owns only new textures, restores evidence/export and closes cleanly", async () => {
  const f = fixture(true),
    loaded = [],
    released = [];
  const manager = store(
    {
      loadAssets: async (m) => loaded.push(m),
      releaseAssets: (m) => released.push(m),
    },
    "scene",
  );
  await manager.load(
    f.catalog,
    new Map([
      [
        "pair.color",
        { sha256: f.bundle.binding.textures.color.sha256, colorSpace: "srgb" },
      ],
    ]),
    () => false,
    signal(),
  );
  assert.deepEqual(Object.keys(loaded[0].textures), ["pair.normal"]);
  const document = {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    behaviorRecipes: { entities: {} },
    sceneComposition: {
      initialFragment: "main",
      prefabs: { object: {} },
      fragments: {
        main: {
          instances: [
            {
              id: "sprite",
              prefab: "object",
              x: 0,
              y: 0,
              props: {
                components: {
                  collider: "none",
                  layer: "wall",
                  visual: {
                    kind: "sprite",
                    texture: "pair.color",
                    width: 32,
                    height: 32,
                    frame: { u0: 0, v0: 0, u1: 1, v1: 1 },
                  },
                },
              },
            },
          ],
        },
      },
    },
    spatial: {
      camera: {
        projection: "orthographic",
        position: { x: 0, y: -200, elevation: 80 },
        target: { x: 0, y: 0, elevation: 32 },
        height: 110,
        near: 0.1,
        far: 1200,
      },
      terrain: [],
      billboards: { sprite: { normalTexture: "pair.normal" } },
    },
  };
  const state = createScenePlacementViewer({
    document,
    viewport: { cssWidth: 320, cssHeight: 240 },
  }).state();
  assert.equal(manager.bindings("scene", document, state).length, 1);
  // Animated layout is reconstructed from the scene and verified generator rects.
  const visual =
    document.sceneComposition.fragments.main.instances[0].props.components
      .visual;
  visual.animationSet = {
    initialClip: 27,
    clips: [
      { id: 27, fps: 10, loop: false, frames: [visual.frame, visual.frame] },
    ],
  };
  const recovered = manager.bindings("scene", document, state);
  assert.equal(recovered.length, 1);
  assert.deepEqual(recovered[0].binding.animationSet, visual.animationSet);
  assert.equal(recovered[0].binding.frames.length, 1);
  visual.animationSet.clips[0].frames[1] = { u0: 0, v0: 0, u1: 0.5, v1: 1 };
  assert.deepEqual(
    manager.bindings("scene", document, state),
    [],
    "Unknown rect must not claim generated normal evidence",
  );
  delete visual.animationSet;
  assert.equal(manager.browserEntries("other").length, 0);
  assert.equal(manager.bundles("scene", document)[0].files.length, 2);
  assert.throws(
    () => manager.assertDocumentAssets(document, "other"),
    /another document/,
  );
  manager.close("scene");
  assert.deepEqual(
    released[0].textures.map((t) => t.name),
    ["pair.normal"],
  );
  assert(!manager.has("pair.normal"));
});

test("pixel normal catalog validates source hash/frame evidence and borrows the pixel color texture",async()=>{
  const f=fixture("pixel"),id=f.bundle.binding.textures.color.asset,source={sha256:f.bundle.binding.textures.color.sha256,colorSpace:"srgb",sourceJsonSha256:"b".repeat(64),frameRects:[{id:"frame-1",x:0,y:0,width:1,height:1}]};
  for(const change of [{sourceJsonSha256:"c".repeat(64)},{frameRects:[{id:"changed",x:0,y:0,width:1,height:1}]}]){
    const manager=store({loadAssets:async()=>{throw Error("must validate before upload");},releaseAssets(){}},"scene","project");
    await assert.rejects(manager.load(f.catalog,new Map([[id,{...source,...change}]]),()=>false,signal()),/source or frame layout/);manager.destroy();
  }
  let uploaded;const released=[];
  const manager=store({async loadAssets(value){uploaded=value;},releaseAssets(value){released.push(value);}},"scene","project");
  await manager.load(f.catalog,new Map([[id,source]]),()=>false,signal());
  assert.deepEqual(Object.keys(uploaded.textures),["pair.normal"]);assert.equal(manager.bundles("scene",undefined,"project")[0].report.format,"ferrum2d.pixel-normal.report");
  manager.destroy();assert.deepEqual(released[0].textures.map(t=>t.name),["pair.normal"]);
});
