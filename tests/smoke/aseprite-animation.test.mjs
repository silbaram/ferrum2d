import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../../apps/placement-viewer/package.json", import.meta.url),
);
const ts = require("typescript");
const source = await readFile(
  new URL(
    "../../apps/placement-viewer/src/placementAsepriteAnimation.ts",
    import.meta.url,
  ),
  "utf8",
);
const compiled = ts
  .transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  })
  .outputText.replaceAll(
    "@ferrum2d/ferrum-web/authoring",
    new URL("../../packages/ferrum-web/dist/authoring.js", import.meta.url)
      .href,
  );
const {
  asepriteAnimationCatalog: catalog,
  asepriteAnimationPatch: patch,
  asepriteAnimationEvidence: evidence,
} = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
function asset(
  id = "old",
  durations = [100, 200, 100],
  tags = [
    { name: "run", from: 0, to: 2, direction: "forward" },
    { name: "rest", from: 1, to: 1, direction: "forward" },
  ],
) {
  const frames = durations.map((_, i) => ({
    id: `frame${i}`,
    uv: { u0: i / 4, v0: 0, u1: (i + 1) / 4, v1: 0.5 },
  }));
  return {
    name: "hero",
    id,
    frames,
    jsonSha256: id,
    jsonText: JSON.stringify({
      frames: Object.fromEntries(
        frames.map((f, i) => [f.id, { duration: durations[i] }]),
      ),
      meta: { frameTags: tags },
    }),
  };
}
const state = { fragment: "main", lockedInstanceIds: [] };
function doc(
  visual = { kind: "sprite", texture: "old", width: 32, height: 48 },
) {
  return {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    behaviorRecipes: { entities: {} },
    sceneComposition: {
      initialFragment: "main",
      prefabs: { sprite: {} },
      fragments: {
        main: {
          instances: [
            {
              id: "sprite",
              prefab: "sprite",
              x: 3,
              y: 8,
              props: {
                components: {
                  visual,
                  body: { type: "static" },
                  collider: { type: "aabb", halfWidth: 4, halfHeight: 6 },
                  layer: "actor",
                },
              },
            },
          ],
        },
      },
    },
  };
}
const bind = (a, loop = false) =>
  patch(doc(), state, [a], a, { instance: "sprite", initial: "rest", loop });
const visual = (p) => p.operations[0].components.visual;
test("integer durations become exact repeated frames with native float32 timing disclosure", () => {
  const [run] = catalog(asset("old", [90, 180, 90]));
  assert.deepEqual(run.repeats, [1, 2, 1]);
  assert.equal(run.clip.frames.length, 4);
  assert.equal(run.sourceCycleMs, 360);
  assert.equal(run.nativeFps, Math.fround(1000 / 90));
  assert.equal(run.nativeCycleErrorMs, 4000 / run.nativeFps - 360);
});
for (const [direction, expected] of [
  ["forward", [0, 1, 2]],
  ["reverse", [2, 1, 0]],
  ["pingpong", [0, 1, 2, 1]],
  ["pingpong_reverse", [2, 1, 0, 1]],
])
  test(
    direction +
      " preserves source ordering and avoids doubled pingpong endpoints",
    () => {
      const [tag] = catalog(
        asset(
          "old",
          [100, 100, 100],
          [{ name: "run", from: 0, to: 2, direction }],
        ),
      );
      assert.deepEqual(
        tag.frameNames,
        expected.map((i) => "frame" + i),
      );
    },
  );
test("array exports retain filename/source order", () => {
  const a = asset(),
    raw = JSON.parse(a.jsonText);
  raw.frames = Object.entries(raw.frames).map(([filename, value]) => ({
    filename,
    ...value,
  }));
  a.jsonText = JSON.stringify(raw);
  assert.deepEqual(catalog(a)[0].frameNames, ["frame0", "frame1", "frame2"]);
});
test("selected static import uses requested initial tag and loop without changing other components", () => {
  const p = bind(asset()),
    v = visual(p);
  assert.equal(v.animationSet.initialClip, 1);
  assert.equal(v.animationSet.clips[0].loop, false);
  assert.deepEqual(v.frame, v.animationSet.clips[1].frames[0]);
  assert.equal(v.width, 32);
  assert.deepEqual(p.operations[0].components.body, { type: "static" });
  assert.deepEqual(
    evidence(doc(v), state, [asset()])[0].tags.map((t) => [t.name, t.id]),
    [
      ["run", 0],
      ["rest", 1],
    ],
  );
});
test("reimport preserves arbitrary numeric IDs, initial and loop through source tag reorder + addition", () => {
  const a = asset(),
    v = visual(bind(a)),
    tags = JSON.parse(a.jsonText).meta.frameTags;
  v.animationSet.clips[0].id = 41;
  v.animationSet.clips[1].id = 7;
  v.animationSet.initialClip = 7;
  v.animationSet.clips[0].loop = true;
  const next = asset(
    "new",
    [200, 100, 100],
    [tags[1], tags[0], { name: "last", from: 2, to: 2 }],
  );
  next.frames = next.frames.map((f) => ({
    ...f,
    uv: { ...f.uv, v0: 0.5, v1: 1 },
  }));
  const p = patch(doc(v), state, [a], next, { initial: "run", loop: false }),
    out = visual(p).animationSet;
  assert.deepEqual(
    out.clips.map((clip) => [clip.id, clip.loop]),
    [
      [7, false],
      [41, true],
      [0, false],
    ],
  );
  assert.equal(out.initialClip, 7);
  assert.equal(out.clips[0].frames[0].v0, 0.5);
  assert.deepEqual(
    evidence(doc(visual(p)), state, [next])[0].tags.map((t) => [t.name, t.id]),
    [
      ["rest", 7],
      ["run", 41],
      ["last", 0],
    ],
  );
});
test("rejects missing tags, manually edited clips, duplicates and ambiguous source tags", () => {
  const a = asset(),
    v = visual(bind(a));
  assert.throws(
    () =>
      patch(
        doc(v),
        state,
        [a],
        asset("new", [100, 200, 100], [{ name: "run", from: 0, to: 2 }]),
        { loop: true },
      ),
    /missing tag rest/,
  );
  v.animationSet.clips[0].fps = 13;
  assert.throws(
    () => patch(doc(v), state, [a], asset("new"), { loop: true }),
    /manually edited/,
  );
  const ambiguous = asset(
    "old",
    [100],
    [
      { name: "a", from: 0, to: 0 },
      { name: "b", from: 0, to: 0 },
    ],
  );
  assert.throws(
    () =>
      patch(doc(), state, [ambiguous], ambiguous, {
        instance: "sprite",
        initial: "a",
        loop: true,
      }),
    /ambiguous/,
  );
  assert.deepEqual(evidence(doc(v), state, [a]), []);
});
test("duration/frame budget and unsupported metadata fail independently from static import", () => {
  for (const [durations, message] of [
    [[0, 100, 100], /duration/],
    [[1.5, 100, 100], /duration/],
    [[1001, 1000, 1000], /max 32/],
    [[1_000_001, 1_000_001, 1_000_001], /FPS/],
  ])
    assert.throws(() => catalog(asset("old", durations)), message);
  assert.throws(() => catalog(asset("old", [100], [])), /frameTags/);
  for (const extra of [{ direction: "unknown" }, { repeat: 2 }])
    assert.throws(
      () =>
        catalog(asset("old", [100], [{ name: "a", from: 0, to: 0, ...extra }])),
      /unsupported/,
    );
});
test("locks, legacy animations, normal bindings and unknown animated sources are blocked", () => {
  const a = asset(),
    policy = { instance: "sprite", initial: "run", loop: true };
  assert.throws(
    () =>
      patch(doc(), { ...state, lockedInstanceIds: ["sprite"] }, [a], a, policy),
    /unlock/,
  );
  const d = doc();
  d.spatial = { billboards: { sprite: { normalTexture: "normal" } } };
  assert.throws(() => patch(d, state, [a], a, policy), /normal binding/);
  const v = visual(bind(a));
  v.texture = "other";
  assert.throws(() => patch(doc(v), state, [a], a, policy), /not bound/);
  assert.throws(
    () => patch(doc({ kind: "sprite", animation: {} }), state, [a], a, policy),
    /legacy/,
  );
});

test("paired animation produces one combined patch and keeps migration policy", () => {
  const a = asset(),
    d = doc();
  d.spatial = {
    billboards: { sprite: { normalTexture: "previous.normal", elevation: 3 } },
  };
  const p = patch(
    d,
    state,
    [a],
    a,
    { instance: "sprite", initial: "rest", loop: false },
    "next.normal",
  );
  assert.equal(p.version, 3);
  assert.deepEqual(p.spatial, {
    format: "ferrum2d.scene-spatial.patch",
    version: 4,
    operations: [
      {
        kind: "setBillboardNormalTexture",
        id: "sprite",
        changes: { normalTexture: "next.normal" },
      },
    ],
  });
  assert.equal(p.operations.length, 1);
  const v = visual(p),
    next = asset("new");
  v.animationSet.clips[0].id = 42;
  const migrated = patch(
    { ...doc(v), spatial: d.spatial },
    state,
    [a],
    next,
    { initial: "run", loop: true },
    "new.normal",
  );
  assert.equal(visual(migrated).animationSet.clips[0].id, 42);
  assert.equal(visual(migrated).animationSet.initialClip, 1);
  assert(visual(migrated).animationSet.clips.every((c) => !c.loop));
  assert.deepEqual(
    migrated.operations[0].components.collider,
    p.operations[0].components.collider,
  );
  assert.equal(d.spatial.billboards.sprite.normalTexture, "previous.normal");
});
test("paired normals reject missing billboards, locks and more than 32 unique UVs before generation", () => {
  const a = asset(),
    policy = { instance: "sprite", initial: "run", loop: true };
  assert.throws(
    () => patch(doc(), state, [a], a, policy, "normal"),
    /billboard/,
  );
  const d = { ...doc(), spatial: { billboards: { sprite: {} } } };
  assert.throws(
    () =>
      patch(
        d,
        { ...state, lockedInstanceIds: ["sprite"] },
        [a],
        a,
        policy,
        "normal",
      ),
    /unlock/,
  );
  const many = asset("many", Array(33).fill(100), [
    { name: "a", from: 0, to: 31 },
    { name: "b", from: 32, to: 32 },
  ]);
  many.frames = many.frames.map((f, i) => ({
    ...f,
    uv: { u0: i / 64, u1: (i + 1) / 64, v0: 0, v1: 1 },
  }));
  assert.throws(
    () => patch(d, state, [], many, { ...policy, initial: "a" }, "normal"),
    /32 unique/,
  );
  assert.equal(
    patch(doc(), state, [], many, { ...policy, initial: "a" }).version,
    2,
  );
});

test("paired batch migration preserves each target policy and excludes static or other-fragment targets", () => {
  const a = asset(),
    first = visual(bind(a)),
    second = structuredClone(first);
  second.animationSet.clips[0].id = 42;
  second.animationSet.clips[0].loop = true;
  second.animationSet.initialClip = 42;
  const d = doc(first),
    instances = d.sceneComposition.fragments.main.instances;
  instances.push({
    ...structuredClone(instances[0]),
    id: "second",
    props: { components: { ...instances[0].props.components, visual: second } },
  });
  instances.push({
    ...structuredClone(instances[0]),
    id: "static",
    props: { components: { visual: { kind: "sprite", texture: a.id } } },
  });
  d.sceneComposition.fragments.other = {
    instances: [{ ...structuredClone(instances[0]), id: "outside" }],
  };
  d.spatial = { billboards: { sprite: {}, second: {}, static: {} } };
  const before = JSON.stringify(d),
    next = asset("new"),
    p = patch(
      d,
      state,
      [a],
      next,
      { initial: "run", loop: false },
      "next.normal",
    );
  assert.deepEqual(
    p.operations.map((op) => op.instanceId),
    ["sprite", "second"],
  );
  assert.equal(visual(p).animationSet.initialClip, 1);
  assert.equal(p.operations[1].components.visual.animationSet.initialClip, 42);
  assert.equal(
    p.operations[1].components.visual.animationSet.clips[0].loop,
    true,
  );
  assert.equal(p.spatial.operations.length, 2);
  assert.throws(
    () =>
      patch(
        d,
        { ...state, lockedInstanceIds: ["second"] },
        [a],
        next,
        { initial: "run", loop: false },
        "next.normal",
      ),
    /unlock/,
  );
  assert.equal(JSON.stringify(d), before);
});
