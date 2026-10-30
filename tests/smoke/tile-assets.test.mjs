import { mergeScenePlacementPatch, createScenePlacementViewer, previewScenePlacementBindingMigration } from "../../packages/ferrum-web/dist/authoring.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import {
  decodePng,
  encodePngRgba,
} from "../../scripts/tools/pack-textures.mjs";
import {
  tileFixture,
  multiTileFixture,
  externalTileFixture,
} from "./tile-import-fixtures.mjs";
const require = createRequire(
    new URL("../../apps/placement-viewer/package.json", import.meta.url),
  ),
  ts = require("typescript");
async function source(file, replacements = []) {
  let code = ts.transpileModule(
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
  ).outputText;
  for (const entry of ["authoring", "starter-scenes"])
    code = code.replaceAll(
      "@ferrum2d/ferrum-web/" + entry,
      new URL(
        "../../packages/ferrum-web/dist/" + entry + ".js",
        import.meta.url,
      ).href,
    );
  for (const [from, to] of replacements) code = code.replaceAll(from, to);
  return "data:text/javascript;base64," + Buffer.from(code).toString("base64");
}
const scope = await source("placementAssetScope.ts"),
  normal = await source("placementNormalAssets.ts", [["./placementAssetScope", scope]]),
  dependenciesSource = await source("placementTileDependencies.ts"),
  { resolveTileDependencies, tileJson } = await import(dependenciesSource),
  selectionSource = await source("placementTileSelection.ts", [
    ["./placementTileDependencies", dependenciesSource],
  ]),
  { tileSourceChoices, selectTileSource } = await import(selectionSource),
  tile = await source("placementTileAssets.ts", [
    ["./placementNormalAssets", normal],
    ["./placementTileSelection", selectionSource],
    ["./placementTileDependencies", dependenciesSource],
  ]),
  {
    inspectTileAsset: inspect,
    tileComponentPatch: patch,
    tileBundle: bundle,
    tileEvidence: evidence,
    tileAssetReferenced,
  } = await import(tile),
  { createPlacementSpriteRevisions: store } = await import(
    await source("placementSpriteRevisions.ts", [["./placementAssetScope", scope]])
  );
globalThis.createImageBitmap = async (blob) => {
  const result = decodePng(Buffer.from(await blob.arrayBuffer()));
  return { width: result.width, height: result.height, close() {} };
};
const signal = () => new AbortController().signal,
  sha = (b) => createHash("sha256").update(b).digest("hex");
const check = async (
  kind,
  updated = false,
  data = tileFixture(kind, updated),
  key = "scene",
  level = 0,
  tilesetKey,
) =>
  inspect(
    key,
    "terrain",
    kind,
    level,
    new File([JSON.stringify(data.json)], kind + ".json"),
    new File([data.png], "tiles.png"),
    signal(),
    tilesetKey,
    data.dependencies?.map((d) => new File([JSON.stringify(d.json)], d.name)),
  );
function doc(texture, frame) {
  return {
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
              x: 3,
              y: 8,
              props: {
                components: {
                  visual: {
                    kind: "sprite",
                    texture,
                    width: 32,
                    height: 48,
                    frame,
                  },
                  collider: { type: "aabb", halfWidth: 4, halfHeight: 6 },
                  body: { type: "static" },
                  layer: "wall",
                },
              },
            },
          ],
        },
      },
    },
  };
}
const state = { fragment: "main", lockedInstanceIds: [] };
for (const kind of ["tiled", "ldtk"]) {
  test(
    kind +
      " actual PNG and raw sources produce stable immutable IDs and preserved map metadata",
    async () => {
      const a = await check(kind),
        again = await check(kind),
        next = await check(kind, true);
      assert.equal(a.id, again.id);
      assert.notEqual(next.id, a.id);
      assert.deepEqual(
        a.frames.map((f) => f.id),
        ["terrain.0", "terrain.1"],
      );
      assert.deepEqual([...next.frames].map((f) => f.id).sort(), [
        "terrain.0",
        "terrain.1",
      ]);
      assert.equal(next.frames.find((f) => f.id === "terrain.0").uv.u1, 1 / 3);
      const output = bundle("scene", [a, next]);
      for (const file of output.files)
        assert.equal(sha(Buffer.from(file.base64, "base64")), file.sha256);
      assert.equal(output.manifest.textureOptions[a.id].colorSpace, "srgb");
      assert.deepEqual(output.revisions[1].imported, next.imported);
      if (kind === "ldtk")
        assert.equal(next.imported.entities[0].iid, "spawn-1");
      assert.notEqual((await check(kind, false, undefined, "other")).id, a.id);
    },
  );
  test(
    kind +
      " selected and batch patches preserve components and match frame identity across atlas repack",
    async () => {
      const a = await check(kind),
        next = await check(kind, true),
        d = doc(a.id, a.frames[0].uv),
        before = JSON.stringify(d);
      const applied = patch(d, state, [a], a, {
        instance: "sprite",
        frame: "terrain.1",
      });
      assert.deepEqual(
        applied.operations[0].components.visual.frame,
        a.frames[1].uv,
      );
      const migrated = patch(d, state, [a], next);
      assert.deepEqual(
        migrated.operations[0].components.visual.frame,
        next.frames.find((f) => f.id === "terrain.0").uv,
      );
      for (const name of ["collider", "body", "layer"])
        assert.deepEqual(
          migrated.operations[0].components[name],
          d.sceneComposition.fragments.main.instances[0].props.components[name],
        );
      assert.equal(migrated.version, 2);
      assert.equal(JSON.stringify(d), before);
      assert.equal(evidence(next).persisted, false);
    },
  );
  test(
    kind +
      " rejects missing frame, ambiguous UV, identity changes, locks, animation and normal bindings",
    async () => {
      const a = await check(kind),
        next = await check(kind, true),
        d = doc(a.id, a.frames[0].uv);
      assert.throws(
        () => patch(d, { ...state, lockedInstanceIds: ["sprite"] }, [a], next),
        /unlock/,
      );
      assert.throws(
        () => patch(d, state, [a], { ...next, lineage: "different" }),
        /identity/,
      );
      assert.throws(
        () =>
          patch(d, state, [a], {
            ...next,
            frames: next.frames.filter((f) => f.id !== "terrain.0"),
          }),
        /missing frame/,
      );
      assert.throws(
        () =>
          patch(
            d,
            state,
            [{ ...a, frames: [a.frames[0], { ...a.frames[0], id: "alias" }] }],
            next,
          ),
        /ambiguous/,
      );
      d.spatial = { billboards: { sprite: { normalTexture: "normal" } } };
      assert.throws(() => patch(d, state, [a], next), /normal binding/);
      delete d.spatial;
      d.sceneComposition.fragments.main.instances[0].props.components.visual.animationSet =
        {};
      assert.throws(() => patch(d, state, [a], next), /animated/);
    },
  );
}
test("dependency, dimensions, cell allocation and unsupported input guards run before importing", async () => {
  let f = tileFixture("tiled");
  f.json.tilesets[0].source = "external.tsj";
  await assert.rejects(check("tiled", false, f), /missing external TSJ/);
  f = tileFixture("ldtk");
  f.json.levels[0].externalRelPath = "level.ldtkl";
  await assert.rejects(check("ldtk", false, f), /embedded/);
  f = tileFixture("ldtk");
  f.json.levels[0].layerInstances[0].__cWid = 1e9;
  await assert.rejects(check("ldtk", false, f), /columns/);
  f = tileFixture("tiled");
  f.json.layers[0].data = "compressed";
  await assert.rejects(check("tiled", false, f), /uncompressed/);
  f = tileFixture("tiled");
  f.json.tilesets[0].imagewidth = 20;
  await assert.rejects(check("tiled", false, f), /dimensions/);
  f = tileFixture("tiled");
  f.json.layers[0].data = [0x80000001, 2];
  await assert.rejects(check("tiled", false, f), /flipped/);
  f = tileFixture("ldtk");
  f.json.levels[0].layerInstances[0].gridTiles[0].f = 1;
  await assert.rejects(check("ldtk", false, f), /flipped/);
});
test("revision budgets and partial upload failure preserve earlier resources; close rejects an in-flight upload", async () => {
  const loaded = [],
    released = [],
    a = await check("tiled"),
    b = await check("tiled", true);
  const revisions = store(
    {
      loadAssets: async (m) => loaded.push(m),
      releaseAssets: (m) => released.push(m),
    },
    () => false,
    { entries: 1, bytes: 64 * 1024 * 1024 },
  );
  revisions.adopt(a);
  await revisions.upload(a, signal());
  assert.equal(a.uploaded, true);
  assert.throws(() => revisions.adopt(b), /budget/);
  assert.equal(a.uploaded, true);
  revisions.close("scene");
  assert.equal(a.uploaded, false);
  assert.equal(released.length, 1);
  let release;
  const lateTextures = new Set();
  const pending = store(
    {
      loadAssets: async () => {
        await new Promise((done) => {
          release = done;
        });
        lateTextures.add(b.id);
      },
      releaseAssets: (m) => {
        released.push(m);
        for (const texture of m.textures) lateTextures.delete(texture.name);
      },
    },
    () => false,
    { entries: 8, bytes: 64 * 1024 * 1024 },
  );
  pending.adopt(b);
  const upload = pending.upload(b, signal());
  pending.close("scene");
  release();
  await assert.rejects(upload, /closed/);
  assert.equal(b.url, undefined);
  assert.equal(b.uploaded, false);
  assert.equal(
    lateTextures.size,
    0,
    "A loader completing after close must not leak its late texture",
  );
  const rejected = store(
    {
      loadAssets: async () => {
        throw Error("partial GPU failure");
      },
      releaseAssets: (m) => released.push(m),
    },
    () => false,
    { entries: 8, bytes: 64 * 1024 * 1024 },
  );
  rejected.adopt(b);
  await assert.rejects(rejected.upload(b, signal()), /partial GPU/);
  assert.equal(b.url, undefined);
  rejected.destroy();
  assert.throws(() => rejected.adopt(a), /closed/);
});

test("byte limits, cancellation and aggregate grid bounds reject before allocating import data", async () => {
  const f = tileFixture("ldtk"),
    abort = new AbortController();
  abort.abort();
  await assert.rejects(
    inspect(
      "scene",
      "tiles",
      "ldtk",
      0,
      new File([JSON.stringify(f.json)], "map.ldtk"),
      new File([f.png], "tiles.png"),
      abort.signal,
    ),
    /abort/i,
  );
  let read = false;
  await assert.rejects(
    inspect(
      "scene",
      "tiles",
      "tiled",
      0,
      {
        size: 1_048_577,
        arrayBuffer() {
          read = true;
          throw Error("should not read");
        },
      },
      new File([f.png], "tiles.png"),
      signal(),
    ),
    /byte budget/,
  );
  assert.equal(read, false);
  const large = structuredClone(f.json.levels[0].layerInstances[0]);
  large.__cWid = large.__cHei = 256;
  f.json.levels[0].layerInstances = [large, large];
  await assert.rejects(check("ldtk", false, f), /cell budget/);
});

test("fractional normalized UV arithmetic retains integer pixel dimensions", async () => {
  const data = tileFixture("tiled");
  data.png = encodePngRgba(100, 16, new Uint8Array(100 * 16 * 4));
  Object.assign(data.json.tilesets[0], {
    imagewidth: 100,
    tilewidth: 1,
    columns: 100,
    tilecount: 100,
  });
  data.json.layers[0].data = [8, 9];
  const a = await check("tiled", false, data);
  assert(a.frames.every((f) => f.width === 1 && f.height === 16));
});

const revisionsSource = await source("placementSpriteRevisions.ts", [["./placementAssetScope", scope]]),
  projectSource = await source("placementTileProject.ts", [
    ["./placementTileAssets", tile],
    ["./placementNormalAssets", normal],
    ["./placementSpriteRevisions", revisionsSource],
  ]),
  {
    readPlacementTileProject,
    createDesktopTileProjectHost,
    createPlacementTileAssets,
  } = await import(projectSource);
globalThis.location = { href: "https://project.test/" };
async function projectFixture(kind) {
  const asset = await check(kind),
    bytes = new Map([
      ["https://project.test/source.json", asset.json],
      ["https://project.test/source.png", asset.png],
    ]);
  const catalog = {
    format: "ferrum2d.tile-import.project",
    version: 1,
    assets: [
      {
        metadata: evidence(asset),
        jsonUrl: "https://project.test/source.json",
        pngUrl: "https://project.test/source.png",
      },
    ],
  };
  return { asset, catalog, bytes };
}
for (const kind of ["tiled", "ldtk"])
  test(`${kind} native sources restore canonical identity and recompute frames`, async () => {
    const f = await projectFixture(kind),
      original = globalThis.fetch;
    globalThis.fetch = async (url) => new Response(f.bytes.get(String(url)));
    try {
      delete f.catalog.assets[0].metadata.frames;
      const [restored] = await readPlacementTileProject(
        f.catalog,
        "reopened-scene",
        "/project",
        signal(),
      );
      assert.equal(restored.document, "reopened-scene");
      assert.equal(restored.identityDocument, "scene");
      assert.equal(restored.id, f.asset.id);
      assert.equal(restored.persisted, true);
      assert.equal(restored.project, "/project");
      assert.deepEqual(restored.frames, f.asset.frames);
      const owned = createPlacementTileAssets(
        { loadAssets: async () => {}, releaseAssets() {} },
        () => false,
      );
      owned.adopt(restored);
      const again = await check(
        kind,
        false,
        tileFixture(kind),
        "reopened-scene",
      );
      assert.equal(owned.adopt(again), restored);
      assert.equal(
        bundle("reopened-scene", owned.entries()).revisions[0].identityDocument,
        "scene",
      );
      owned.destroy();
    } finally {
      globalThis.fetch = original;
    }
  });
test("native tile catalog rejects corrupted identities, duplicate revisions and temporary URLs", async () => {
  const f = await projectFixture("tiled"),
    original = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(f.bytes.get(String(url)));
  try {
    for (const change of [
      (c) => c.assets.push(c.assets[0]),
      (c) => (c.assets[0].pngUrl = "blob:temporary"),
      (c) => (c.assets[0].metadata.pngSha256 = "0".repeat(64)),
      (c) => (c.assets[0].metadata.assetId += "x"),
      (c) => (c.assets[0].metadata.width = 1),
      (c) => (c.assets[0].metadata.identityDocument = "another"),
      (c) => (c.assets[0].metadata.levelIndex = 1),
    ]) {
      const c = structuredClone(f.catalog);
      change(c);
      await assert.rejects(
        readPlacementTileProject(c, "scene", "/project", signal()),
      );
    }
    f.bytes.set("https://project.test/source.png", new Uint8Array([0]));
    await assert.rejects(
      readPlacementTileProject(f.catalog, "scene", "/project", signal()),
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("native tile host aborts late replies without marking sources durable", async () => {
  const f = await projectFixture("tiled");
  let release, args;
  const host = createDesktopTileProjectHost(async (command, input) => {
    args = { command, input };
    return new Promise((done) => (release = done));
  }, "/project");
  const controller = new AbortController(),
    pending = host.save(bundle("scene", [f.asset]), controller.signal);
  assert.equal(args.command, "save_placement_tile_assets");
  assert.equal(args.input.projectPath, "/project");
  controller.abort();
  release(f.catalog);
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(f.asset.persisted, false);
});

for (const kind of ["tiled", "ldtk"]) {
  const key = kind === "tiled" ? "tiled:terrain" : "ldtk:7";
  test(`${kind} selected tileset excludes other frames/cells and preserves raw source`, async () => {
    const f = multiTileFixture(kind),
      before = JSON.stringify(f.json);
    const a = await check(kind, false, f, "scene", 0, key);
    assert.deepEqual(
      a.frames.map((f) => f.id),
      ["terrain.0", "terrain.1"],
    );
    assert.deepEqual(a.selection, {
      key,
      name: "terrain",
      sourceTilesets: 2,
      omittedTileInstances: 1,
    });
    assert.equal(new TextDecoder().decode(a.json), before);
    assert.equal(JSON.stringify(f.json), before);
    assert.equal(evidence(a).tilesetKey, key);
    if (kind === "tiled")
      assert.deepEqual(a.imported.tilemap.layers[0].data, [1, 0, 2]);
    else {
      assert.deepEqual(a.imported.layerNames, ["ground"]);
      assert.equal(a.imported.entities[0].layerIndex, 2);
    }
    const next = await check(
      kind,
      true,
      multiTileFixture(kind, true),
      "scene",
      0,
      key,
    );
    assert.equal(next.lineage, a.lineage);
    assert.equal(
      patch(doc(a.id, a.frames[0].uv), state, [a], next).operations.length,
      1,
    );
    await assert.rejects(check(kind, false, f), /choose a tileset/);
    await assert.rejects(
      check(kind, false, f, "scene", 0, "missing"),
      /choose a tileset/,
    );
  });
  test(`${kind} same PNG with distinct tileset keys keeps separate revisions and native restoration`, async () => {
    const f = multiTileFixture(kind),
      entries = kind === "tiled" ? f.json.tilesets : f.json.defs.tilesets;
    const target = entries.find((s) =>
        kind === "tiled" ? s.name === "terrain" : s.uid === 7,
      ),
      other = entries.find((s) => s !== target);
    if (kind === "tiled")
      Object.assign(other, {
        image: "tiles.png",
        imagewidth: target.imagewidth,
        imageheight: target.imageheight,
        columns: target.columns,
      });
    else
      Object.assign(other, {
        relPath: "tiles.png",
        pxWid: target.pxWid,
        pxHei: target.pxHei,
      });
    const a = await check(kind, false, f, "scene", 0, key),
      b = await check(
        kind,
        false,
        f,
        "scene",
        0,
        kind === "tiled" ? "tiled:decor" : "ldtk:8",
      );
    assert.notEqual(a.id, b.id);
    assert.equal(a.jsonSha256, b.jsonSha256);
    assert.equal(a.pngSha256, b.pngSha256);
    const owned = createPlacementTileAssets(
      { loadAssets: async () => {}, releaseAssets() {} },
      () => false,
    );
    assert.equal(owned.adopt(a), a);
    assert.equal(owned.adopt(b), b);
    assert.equal(owned.entries().length, 2);
    assert.throws(
      () => patch(doc(a.id, a.frames[0].uv), state, [a], b),
      /identity/,
    );
    const catalog = {
        format: "ferrum2d.tile-import.project",
        version: 1,
        assets: [
          {
            metadata: evidence(a),
            jsonUrl: "/source.json",
            pngUrl: "/source.png",
          },
        ],
      },
      original = globalThis.fetch;
    globalThis.fetch = async (url) =>
      new Response(String(url).endsWith(".json") ? a.json : a.png);
    try {
      const [restored] = await readPlacementTileProject(
        catalog,
        "another-document",
        "/project",
        signal(),
      );
      assert.equal(restored.id, a.id);
      assert.deepEqual(restored.selection, a.selection);
      catalog.assets[0].metadata.tilesetKey = "missing";
      await assert.rejects(
        readPlacementTileProject(catalog, "scene", "/project", signal()),
      );
    } finally {
      globalThis.fetch = original;
      owned.destroy();
    }
  });
  test(`${kind} duplicate/oversized tilesets and unsupported omitted inputs are diagnosed`, async () => {
    let f = multiTileFixture(kind),
      entries = kind === "tiled" ? f.json.tilesets : f.json.defs.tilesets;
    if (kind === "tiled") entries[0].name = entries[1].name;
    else entries[0].uid = entries[1].uid;
    assert.throws(() => tileSourceChoices(f.json, kind), /duplicate/);
    f = multiTileFixture(kind);
    entries = kind === "tiled" ? f.json.tilesets : f.json.defs.tilesets;
    entries.push(
      ...Array.from({ length: 7 }, () => structuredClone(entries[0])),
    );
    assert.throws(() => tileSourceChoices(f.json, kind), /1..8/);
    f = multiTileFixture(kind);
    if (kind === "tiled") f.json.layers[0].data[1] = 0x80000064;
    else f.json.levels[0].layerInstances[0].gridTiles[0].f = 1;
    await assert.rejects(check(kind, false, f, "scene", 0, key), /flipped/);
  });
}

test("multi-tileset projection rejects ambiguous or missing source references instead of dropping them", async () => {
  let f = multiTileFixture("tiled");
  f.json.tilesets[0].firstgid = 1;
  await assert.rejects(
    check("tiled", false, f, "scene", 0, "tiled:terrain"),
    /overlapping/,
  );
  f = multiTileFixture("tiled");
  f.json.layers[0].data[1] = 999;
  await assert.rejects(
    check("tiled", false, f, "scene", 0, "tiled:terrain"),
    /no tileset/,
  );
  f = multiTileFixture("ldtk");
  f.json.levels[0].layerInstances[0].__tilesetDefUid = 999;
  await assert.rejects(
    check("ldtk", false, f, "scene", 0, "ldtk:7"),
    /UID was not found/,
  );
  f = multiTileFixture("tiled");
  f.json.layers = [{ type: "group", name: "group", layers: f.json.layers }];
  await assert.rejects(
    check("tiled", false, f, "scene", 0, "tiled:terrain"),
    /flatten Tiled group/,
  );
});

test("external TSJ originals, sorted dependency hashes and TSJ-only revisions survive export", async () => {
  const f = externalTileFixture(),
    nextFixture = externalTileFixture(true);
  const a = await check("tiled", false, f, "scene", 0, "tiled:terrain");
  const next = await check(
    "tiled",
    false,
    nextFixture,
    "scene",
    0,
    "tiled:terrain",
  );
  assert.equal(a.jsonSha256, next.jsonSha256);
  assert.notEqual(a.id, next.id);
  assert.equal(a.selection.omittedTileInstances, 1);
  assert.deepEqual(
    a.frames.map((f) => f.id),
    ["terrain.0", "terrain.1"],
  );
  assert.equal(a.lineage, next.lineage);
  const onlyTsj = externalTileFixture();
  onlyTsj.dependencies.find((d) => d.name === "terrain.tsj").json.spacing = 0;
  const tsjRevision = await check(
    "tiled",
    false,
    onlyTsj,
    "scene",
    0,
    "tiled:terrain",
  );
  assert.equal(tsjRevision.jsonSha256, a.jsonSha256);
  assert.equal(tsjRevision.pngSha256, a.pngSha256);
  assert.notEqual(tsjRevision.id, a.id);
  const files = bundle("scene", [a]).files;
  assert.equal(files.length, 4);
  for (const [i, d] of a.dependencies.entries()) {
    const original = f.dependencies.find((x) => x.source === d.source);
    assert.equal(Buffer.from(d.json).toString(), JSON.stringify(original.json));
    const file = files.find((x) => x.path === `${a.id}.dep.${i}.tsj`);
    assert.equal(file.sha256, sha(Buffer.from(file.base64, "base64")));
    assert.equal(
      Buffer.from(file.base64, "base64").toString(),
      JSON.stringify(original.json),
    );
  }
  assert.equal(
    patch(doc(a.id, a.frames[0].uv), state, [a], next).operations.length,
    1,
  );
  const reordered = externalTileFixture();
  reordered.dependencies.reverse();
  assert.equal(
    (await check("tiled", false, reordered, "scene", 0, "tiled:terrain")).id,
    a.id,
  );
});
test("external TSJ binding rejects missing, extra, duplicate, ambiguous and unsupported sources before mutation", async () => {
  for (const mutate of [
    (f) => f.dependencies.pop(),
    (f) => f.dependencies.push({ ...f.dependencies[0] }),
    (f) => (f.dependencies[0].name = "wrong.tsj"),
    (f) => (f.json.tilesets[0].source = "https://host/terrain.tsj"),
    (f) => (f.json.tilesets[0].source = "tiles/terrain.tsx"),
    (f) => (f.json.tilesets[0].source = "other/terrain.tsj"),
    (f) => (f.dependencies[0].json.source = "nested.tsj"),
    (f) => (f.dependencies[0].json.type = "map"),
  ]) {
    const f = externalTileFixture();
    mutate(f);
    await assert.rejects(check("tiled", false, f, "scene", 0, "tiled:terrain"));
  }
  const f = externalTileFixture();
  await assert.rejects(check("ldtk", false, f));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    inspect(
      "scene",
      "tiles",
      "tiled",
      0,
      new File([JSON.stringify(f.json)], "map.json"),
      new File([f.png], "tiles.png"),
      controller.signal,
      "tiled:terrain",
      [],
    ),
    { name: "AbortError" },
  );
});
test("external TSJ native reconstruction verifies dependency bytes, URLs and source bindings", async () => {
  const a = await check(
    "tiled",
    false,
    externalTileFixture(),
    "scene",
    0,
    "tiled:terrain",
  );
  const bytes = new Map([
    ["https://project.test/map.json", a.json],
    ["https://project.test/tiles.png", a.png],
  ]);
  for (const [i, d] of a.dependencies.entries())
    bytes.set(`https://project.test/${i}.tsj`, d.json);
  const c = {
    format: "ferrum2d.tile-import.project",
    version: 1,
    assets: [
      {
        metadata: evidence(a),
        jsonUrl: "/map.json",
        pngUrl: "/tiles.png",
        dependencies: a.dependencies.map((d, i) => ({
          source: d.source,
          jsonUrl: `/${i}.tsj`,
        })),
      },
    ],
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(bytes.get(String(url)));
  try {
    const [restored] = await readPlacementTileProject(
      c,
      "reopen",
      "/project",
      signal(),
    );
    assert.equal(restored.id, a.id);
    assert.equal(restored.dependencies.length, 2);
    const owned = createPlacementTileAssets(
      { loadAssets: async () => {}, releaseAssets() {} },
      () => false,
    );
    owned.adopt(restored);
    const again = await check(
      "tiled",
      false,
      externalTileFixture(),
      "reopen",
      0,
      "tiled:terrain",
    );
    assert.equal(owned.adopt(again), restored);
    for (const mutate of [
      (c) => c.assets[0].dependencies.pop(),
      (c) => (c.assets[0].dependencies[0].jsonUrl = "blob:temporary"),
      (c) => (c.assets[0].metadata.dependencies[0].sha256 = "0".repeat(64)),
      (c) => (c.assets[0].metadata.dependencies[0].source = "other.tsj"),
    ]) {
      const bad = structuredClone(c);
      mutate(bad);
      await assert.rejects(
        readPlacementTileProject(bad, "reopen", "/project", signal()),
      );
    }
    bytes.set("https://project.test/0.tsj", new TextEncoder().encode("{}"));
    await assert.rejects(
      readPlacementTileProject(c, "reopen", "/project", signal()),
    );
    owned.destroy();
  } finally {
    globalThis.fetch = original;
  }
});

test("single external and mixed embedded/TSJ tilesets preserve existing selection semantics", async () => {
  const single = tileFixture("tiled");
  const set = single.json.tilesets[0];
  const { firstgid, ...json } = set;
  single.json.tilesets = [{ firstgid, source: "../tiles/terrain.tsj" }];
  single.dependencies = [{ name: "terrain.tsj", json }];
  const a = await check("tiled", false, single);
  assert.equal(a.selection, undefined);
  assert.equal(a.dependencies.length, 1);
  assert.equal(a.dependencies[0].source, "../tiles/terrain.tsj");
  assert.deepEqual(
    a.frames.map((f) => f.id),
    ["terrain.0", "terrain.1"],
  );
  const mixed = externalTileFixture();
  const decor = mixed.dependencies.find((d) => d.name === "decor.tsj");
  const index = mixed.json.tilesets.findIndex((s) =>
    s.source.endsWith("decor.tsj"),
  );
  mixed.json.tilesets[index] = {
    ...decor.json,
    firstgid: mixed.json.tilesets[index].firstgid,
  };
  mixed.dependencies = mixed.dependencies.filter((d) => d !== decor);
  const b = await check("tiled", false, mixed, "scene", 0, "tiled:terrain");
  assert.equal(b.dependencies.length, 1);
  assert.equal(b.selection.omittedTileInstances, 1);
});
test("map plus TSJ budget and late cancelled metadata reads fail before source adoption", async () => {
  const { readTileSourceChoices } = await import(selectionSource);
  const f = externalTileFixture();
  const raw = JSON.stringify(f.json);
  const map = new File([raw], "map.json");
  let read = false;
  await assert.rejects(
    readTileSourceChoices(map, "tiled", signal(), [
      {
        size: 1_048_576,
        arrayBuffer() {
          read = true;
          throw Error("unexpected read");
        },
      },
    ]),
    /byte budget/,
  );
  assert.equal(read, false);
  await assert.rejects(
    readTileSourceChoices(
      map,
      "tiled",
      signal(),
      Array.from({ length: 9 }, () => new File(["{}"], "terrain.tsj")),
    ),
    /budget/,
  );
  const controller = new AbortController();
  let release, started;
  const ready = new Promise((done) => (started = done));
  const pending = readTileSourceChoices(map, "tiled", controller.signal, [
    {
      name: "terrain.tsj",
      size: 2,
      arrayBuffer() {
        started();
        return new Promise((done) => (release = done));
      },
    },
  ]);
  await ready;
  controller.abort();
  release(new TextEncoder().encode("{}").buffer);
  await assert.rejects(pending, { name: "AbortError" });
});

const mapSpawnDefinition={props:{components:{visual:{kind:'primitive',shape:'rect',width:8,height:8,color:'#ffffff'},collider:'none',layer:'wall'}}};
const {tileMapPlacementPatch:mapPatch}=await import(await source("placementTileMap.ts"));
for(const kind of ["tiled","ldtk"])test(kind+" whole-map patch preserves coordinates, source, layers and replaces only its group",async()=>{
  const asset=await check(kind),next=await check(kind,true),document=doc(asset.id,asset.frames[0].uv);
  const sourceBefore=JSON.stringify(document),rawBefore=Buffer.from(asset.json).toString('hex');
  document.sceneComposition.prefabs.spawn=structuredClone(mapSpawnDefinition);
  const options={originX:40,originY:60,layerBase:-20,collisionLayers:['ground'],objectPrefabs:{Spawn:'spawn',PlayerSpawn:'spawn',spawn:'spawn'}};
  if(kind==='ldtk')for(const e of asset.imported.entities)options.objectPrefabs[e.identifier]='spawn';
  const patch=mapPatch(document,state,asset,options);
  const first=mergeScenePlacementPatch(document,patch).document;
  const generated=first.sceneComposition.fragments.main.instances.filter(i=>i.props?.tileMapImport);
  assert(generated.length>=2);
  const tiles=generated.filter(i=>i.props.components);
  assert.deepEqual(tiles.map(i=>[i.x,i.y,i.layer]),[[48,68,kind==='ldtk'?-19:-20],[64,68,kind==='ldtk'?-19:-20]]);
  assert(tiles.every(i=>i.props.components.collider.type==='aabb'));
  const replaced=mergeScenePlacementPatch(first,mapPatch(first,state,next,options)).document;
  assert.equal(replaced.sceneComposition.fragments.main.instances.filter(i=>i.props?.tileMapImport).length,generated.length);
  assert(replaced.sceneComposition.fragments.main.instances.some(i=>i.id==='sprite'));
  assert.equal(Buffer.from(asset.json).toString('hex'),rawBefore);
  assert.throws(()=>mapPatch(first,{...state,lockedInstanceIds:[generated[0].id]},next,options),/unlock/);
  assert.throws(()=>mapPatch(document,state,{...asset,selection:{...asset.selection,omittedTileInstances:1}},options),/excludes/);
  assert.throws(()=>mapPatch(document,state,asset,{...options,collisionLayers:['typo']}),/unknown collision/);
});

test("whole-map coordinates retain Tiled layer offsets and reject silently omitted features",async()=>{
  const data=tileFixture('tiled');data.json.layers[0].offsetx=5;data.json.layers[0].offsety=-7;
  const a=await check('tiled',false,data),d=doc(a.id,a.frames[0].uv);
  const result=mergeScenePlacementPatch(d,mapPatch(d,state,a)).document;
  const first=result.sceneComposition.fragments.main.instances.find(i=>i.props?.tileMapImport?.key==='tile:ground:0,0');
  assert.deepEqual([first.x,first.y],[13,1]);
  const opacity=tileFixture('tiled');opacity.json.layers[0].opacity=.5;
  const half=await check('tiled',false,opacity);assert.throws(()=>mapPatch(d,state,half),/opacity/);
});

test("whole map preserves explicit nonblocking cells on a collision layer",async()=>{
 const data=tileFixture('tiled');data.json.tilesets[0].tiles=[{id:0,properties:[{name:'blocksMovement',type:'bool',value:false}]}];
 const a=await check('tiled',false,data),d=doc(a.id,a.frames[0].uv);
 const result=mergeScenePlacementPatch(d,mapPatch(d,state,a,{collisionLayers:['ground']})).document;
 const cells=result.sceneComposition.fragments.main.instances.filter(i=>i.props?.tileMapImport?.key.startsWith('tile:'));
 assert.equal(cells[0].props.components.collider,'none');assert.equal(cells[1].props.components.collider.type,'aabb');
});

test("whole map keeps the exact source revision when only mapped objects remain",async()=>{
  const a=await check('ldtk'),next=await check('ldtk',true),d=doc(a.id,a.frames[0].uv);
  d.sceneComposition.prefabs.spawn=structuredClone(mapSpawnDefinition);
  const objectPrefabs=Object.fromEntries(a.imported.entities.map(e=>[e.identifier,'spawn']));
  const result=mergeScenePlacementPatch(d,mapPatch(d,state,a,{objectPrefabs})).document;
  result.sceneComposition.fragments.main.instances=result.sceneComposition.fragments.main.instances.filter(i=>i.props?.tileMapImport?.key.startsWith('entity:'));
  assert(result.sceneComposition.fragments.main.instances.length>0);
  assert.equal(tileAssetReferenced(result,a),true);
  assert.equal(tileAssetReferenced(result,next),false);
});

test("saved map reimport preserves source IDs through the real viewer and one undo",async()=>{
  const a=await check('ldtk'),b=await check('ldtk',true),d=doc(a.id,a.frames[0].uv);d.sceneComposition.prefabs.spawn=structuredClone(mapSpawnDefinition);
  const options={objectPrefabs:Object.fromEntries(a.imported.entities.map(e=>[e.identifier,'spawn']))};
  const saved=mergeScenePlacementPatch(d,mapPatch(d,state,a,options)).document;
  const viewer=createScenePlacementViewer({document:saved,viewport:{cssWidth:320,cssHeight:240}});
  const baseline=viewer.state().instances.map(i=>i.instanceId);
  const patch=mapPatch(saved,viewer.state(),b,options);viewer.beginEdit('Map reimport');
  for(const op of patch.operations){
    if(op.kind==='removeInstance')viewer.removeInstance(op.instanceId);
    else if(op.kind==='addInstance')viewer.addInstance(op.fragment,op.instance);
    else if(op.kind==='addObjectDefinition')viewer.addObjectDefinition(op.id,op.definition);
  }
  viewer.commitEdit();assert.equal(viewer.historyState().undoCount,1);
  assert.deepEqual(viewer.state().instances.map(i=>i.instanceId),baseline);
  const exported=viewer.exportPatch(),merged=mergeScenePlacementPatch(saved,exported).document;
  assert(merged.sceneComposition.fragments.main.instances.filter(i=>i.props?.tileMapImport).every(i=>i.props.tileMapImport.assetId===b.id));
  assert.deepEqual(previewScenePlacementBindingMigration(saved,exported).removedInstanceIds,[]);
  viewer.undo();assert.equal(viewer.exportPatch(),undefined);viewer.redo();assert.deepEqual(viewer.exportPatch(),exported);
});

test("whole map rejects oversized conversion before any document change",async()=>{
  const a=await check('tiled'),d=doc(a.id,a.frames[0].uv),before=JSON.stringify(d);
  const huge={...a,imported:structuredClone(a.imported)};
  const layer=huge.imported.tilemap.layers[0];layer.columns=2049;layer.rows=1;layer.data=Array(2049).fill(1);
  assert.throws(()=>mapPatch(d,state,huge),/2048/);assert.equal(JSON.stringify(d),before);
});

test("whole map rejects object mappings without usable inline components",async()=>{
 const a=await check('ldtk'),d=doc(a.id,a.frames[0].uv);
 const objectPrefabs=Object.fromEntries(a.imported.entities.map(e=>[e.identifier,'object']));
 assert.throws(()=>mapPatch(d,state,a,{objectPrefabs}),/must be an object/);
});

test("Tiled rectangle mapping retains object-layer order, center, offsets and properties",async()=>{
 const data=tileFixture('tiled');
 data.json.layers.push({type:'objectgroup',name:'actors',offsetx:5,offsety:-3,objects:[{id:7,type:'Spawn',x:10,y:20,width:8,height:6,properties:[{name:'note',type:'string',value:'source'}]}]});
 const a=await check('tiled',false,data),d=doc(a.id,a.frames[0].uv);d.sceneComposition.prefabs.spawn=structuredClone(mapSpawnDefinition);
 const result=mergeScenePlacementPatch(d,mapPatch(d,state,a,{originX:40,originY:60,layerBase:-20,objectPrefabs:{Spawn:'spawn'}})).document;
 const object=result.sceneComposition.fragments.main.instances.find(i=>i.props?.tileMapImport?.key==='object:actors:7');
 assert.deepEqual([object.x,object.y,object.layer,object.prefab],[59,80,-19,'spawn']);
 assert.deepEqual(object.props.tileMapImport.object.properties,data.json.layers[1].objects[0].properties);
});

test("empty imported groups still reject a different source identity through their definition",async()=>{
 const a=await check('tiled'),d=doc(a.id,a.frames[0].uv);
 const saved=mergeScenePlacementPatch(d,mapPatch(d,state,a)).document;
 saved.sceneComposition.fragments.main.instances=saved.sceneComposition.fragments.main.instances.filter(i=>!i.props?.tileMapImport);
 assert.throws(()=>mapPatch(saved,state,{...a,lineage:'different-source'}),/different source identity/);
});


function applyMapEdit(viewer, patch) {
  viewer.beginEdit('Apply Tile Map');
  try {
    for (const op of patch.operations) {
      if (op.kind==='addObjectDefinition') viewer.addObjectDefinition(op.id,op.definition);
      else if (op.kind==='removeInstance') viewer.removeInstance(op.instanceId);
      else if (op.kind==='addInstance') viewer.addInstance(op.fragment,op.instance);
      else if (op.kind==='updateBehaviorBinding') viewer.updateBehaviorBinding(op.target,op.behaviorRecipes);
      else throw Error('unexpected map operation');
    }
    viewer.commitEdit();
  } catch (error) { viewer.cancelEdit(); throw error; }
}
function gridFixture(kind, columns) {
  const f=tileFixture(kind),data=columns===2?[1,2,1,2]:[1,2,2,1,2,0];
  if(kind==='tiled') {
    Object.assign(f.json,{width:columns,height:2});
    Object.assign(f.json.layers[0],{width:columns,height:2,data});
  } else {
    Object.assign(f.json.levels[0],{pxWid:columns*16,pxHei:32});
    Object.assign(f.json.levels[0].layerInstances[0],{__cWid:columns,__cHei:2,gridTiles:data.flatMap((t,i)=>t?[{px:[(i%columns)*16,Math.floor(i/columns)*16],src:[(t-1)*16,0],t:t-1,f:0}]:[])});
  }
  return f;
}
for(const kind of ['tiled','ldtk']) test(kind+' resized map retains grid-cell IDs, bindings and single Undo through save/reopen',async()=>{
  const a=await check(kind,false,gridFixture(kind,2)),b=await check(kind,true,gridFixture(kind,3)),d=doc(a.id,a.frames[0].uv);
  d.sceneComposition.prefabs.spawn=structuredClone(mapSpawnDefinition);
  const options={objectPrefabs:{Spawn:'spawn'}};
  const initial=mergeScenePlacementPatch(d,mapPatch(d,state,a,options)).document;
  initial.behaviorRecipes.entities.guard={recipes:[{kind:'health',max:10}]};
  const target=initial.sceneComposition.fragments.main.instances.find(i=>i.x===8&&i.y===24&&i.props?.tileMapImport?.cell);
  const bindingViewer=createScenePlacementViewer({document:initial,viewport:{cssWidth:320,cssHeight:240}});
  bindingViewer.updateBehaviorBinding({kind:'instance',instanceId:target.id},'guard');
  const saved=mergeScenePlacementPatch(initial,bindingViewer.exportPatch()).document;
  const viewer=createScenePlacementViewer({document:saved,viewport:{cssWidth:320,cssHeight:240}});
  const patch=mapPatch(saved,viewer.state(),b,options);
  applyMapEdit(viewer,patch);
  const exported=viewer.exportPatch(),merged=mergeScenePlacementPatch(saved,exported).document;
  const old=merged.sceneComposition.fragments.main.instances.find(i=>i.id===target.id);
  assert.deepEqual([old.x,old.y,old.props.behaviorRecipes],[8,24,'guard']);
  const newCell=merged.sceneComposition.fragments.main.instances.find(i=>i.x===40&&i.y===8&&i.props?.tileMapImport?.cell);
  assert(newCell);assert.notEqual(newCell.id,target.id);
  assert.equal(viewer.historyState().undoCount,1);assert.deepEqual(merged.behaviorRecipes,saved.behaviorRecipes);
  viewer.undo();assert.equal(viewer.exportPatch(),undefined);viewer.redo();assert.deepEqual(viewer.exportPatch(),exported);
  const reopened=createScenePlacementViewer({document:JSON.parse(JSON.stringify(merged)),viewport:{cssWidth:320,cssHeight:240}});
  assert.deepEqual(reopened.state().instances.find(i=>i.instanceId===target.id).behaviorProfiles,['guard']);
});

test('legacy linear keys migrate from the exact original grid while preserving saved IDs and aliases',async()=>{
  const a=await check('tiled',false,gridFixture('tiled',2)),b=await check('tiled',true,gridFixture('tiled',3)),d=doc(a.id,a.frames[0].uv);
  const saved=mergeScenePlacementPatch(d,mapPatch(d,state,a)).document;
  for(const i of saved.sceneComposition.fragments.main.instances) {
    const m=i.props?.tileMapImport;if(!m?.cell)continue;
    const index=m.cell.row*2+m.cell.column;i.id='legacy_'+index;m.key='tile:ground:'+index;delete m.cell;
  }
  const before=JSON.stringify(saved);
  assert.throws(()=>mapPatch(saved,state,b),/original source revision/);assert.equal(JSON.stringify(saved),before);
  const patch=mapPatch(saved,state,b,{},[a]);
  const viewer=createScenePlacementViewer({document:saved,viewport:{cssWidth:320,cssHeight:240}});applyMapEdit(viewer,patch);
  const merged=mergeScenePlacementPatch(saved,viewer.exportPatch()).document;
  const cell=merged.sceneComposition.fragments.main.instances.find(i=>i.id==='legacy_2');
  assert.deepEqual([cell.x,cell.y,cell.props.tileMapImport.key],[8,24,'tile:ground:2']);
  assert.deepEqual(cell.props.tileMapImport.cell,{layer:'ground',column:0,row:1});
  const newest=mergeScenePlacementPatch(merged,mapPatch(merged,state,b)).document;
  assert.equal(newest.sceneComposition.fragments.main.instances.find(i=>i.x===8&&i.y===24&&i.props?.tileMapImport).id,'legacy_2');
  assert.equal(previewScenePlacementBindingMigration(saved,patch).removedInstanceIds.length,0);
  viewer.undo();assert.equal(viewer.exportPatch(),undefined);viewer.redo();
});

test('map replacement preserves explicit detach and instance binding without freezing inherited prefab behavior',async()=>{
  const f=tileFixture('ldtk');
  const entities=f.json.levels[0].layerInstances[1].entityInstances;
  entities.push({...structuredClone(entities[0]),iid:'spawn-2',px:[24,8]});
  entities.push({...structuredClone(entities[0]),iid:'spawn-3',px:[8,24]});
  const a=await check('ldtk',false,f),d=doc(a.id,a.frames[0].uv);
  for(const name of ['first','second','guard'])d.behaviorRecipes.entities[name]={recipes:[{kind:'health',max:10}]};
  d.sceneComposition.prefabs.first={...structuredClone(mapSpawnDefinition),props:{...structuredClone(mapSpawnDefinition.props),behaviorRecipes:'first'}};
  d.sceneComposition.prefabs.second={...structuredClone(mapSpawnDefinition),props:{...structuredClone(mapSpawnDefinition.props),behaviorRecipes:'second'}};
  const initial=mergeScenePlacementPatch(d,mapPatch(d,state,a,{objectPrefabs:{Spawn:'first'}})).document;
  const objects=initial.sceneComposition.fragments.main.instances.filter(i=>i.props?.tileMapImport?.key.startsWith('entity:'));
  const bindingViewer=createScenePlacementViewer({document:initial,viewport:{cssWidth:320,cssHeight:240}});
  bindingViewer.updateBehaviorBinding({kind:'instance',instanceId:objects[0].id},['guard']);
  bindingViewer.updateBehaviorBinding({kind:'instance',instanceId:objects[1].id},null);
  const saved=mergeScenePlacementPatch(initial,bindingViewer.exportPatch()).document;
  const changed=mergeScenePlacementPatch(saved,mapPatch(saved,state,a,{objectPrefabs:{Spawn:'second'}})).document;
  const resolved=createScenePlacementViewer({document:changed,viewport:{cssWidth:320,cssHeight:240}}).state().instances;
  assert.deepEqual(resolved.find(i=>i.instanceId===objects[0].id).behaviorProfiles,['guard']);
  assert.deepEqual(resolved.find(i=>i.instanceId===objects[1].id).behaviorProfiles,[]);
  assert.deepEqual(resolved.find(i=>i.instanceId===objects[2].id).behaviorProfiles,['second']);
  assert.deepEqual(changed.behaviorRecipes,saved.behaviorRecipes);
});

test('map reimport rejects unsupported authored props before dropping data',async()=>{
  const a=await check('tiled'),d=doc(a.id,a.frames[0].uv);
  const saved=mergeScenePlacementPatch(d,mapPatch(d,state,a)).document;
  const target=saved.sceneComposition.fragments.main.instances.find(i=>i.props?.tileMapImport);target.props.agentNote='preserve me';
  const before=JSON.stringify(saved);assert.throws(()=>mapPatch(saved,state,a),/unsupported authored prop agentNote/);assert.equal(JSON.stringify(saved),before);
});
