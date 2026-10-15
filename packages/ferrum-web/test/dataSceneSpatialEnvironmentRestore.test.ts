import { equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  createEngine,
  captureGameStateSnapshot,
  restoreGameStateSnapshot,
  hashGameStateSnapshot,
} from "../src/core.js";
import { applyDataSceneAuthoringDocument } from "../src/authoring.js";

test("spatial shadow restore preflights prospective caster budgets before activation", async () => {
  const { readFile } = await (new Function(
    "return import('node:fs/promises')",
  )() as Promise<{
    readFile(url: URL): Promise<Uint8Array>;
  }>);
  const original = {
    fetch: globalThis.fetch,
    raf: globalThis.requestAnimationFrame,
    cancel: globalThis.cancelAnimationFrame,
  };
  globalThis.fetch = async (input, init) =>
    String(input).startsWith("file:")
      ? new Response(
          Uint8Array.from(await readFile(new URL(String(input)))).buffer,
          { headers: { "Content-Type": "application/wasm" } },
        )
      : original.fetch(input, init);
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const source = await createEngine(
    () => {},
    undefined,
    undefined,
    () => ({ width: 800, height: 480 }),
  );
  const destination = await createEngine(
    () => {},
    undefined,
    undefined,
    () => ({ width: 800, height: 480 }),
  );
  const environment = {
    lighting: {
      lights: [{ position: { x: 0, y: 0, elevation: 100 }, radius: 500 }],
      shadows: { lightIndex: 0 },
    },
  };
  const prefab = (texture: number) => ({
    props: {
      components: {
        visual: { kind: "sprite", texture, width: 12, height: 24 },
        collider: "none",
        layer: "wall",
      },
    },
  });
  const document = (count: number, terrainCount: number) => ({
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    sceneComposition: {
      initialFragment: "lab",
      prefabs: { one: prefab(0), two: prefab(1) },
      fragments: {
        lab: {
          instances: Array.from({ length: count }, (_, i) => ({
            id: "tree" + i,
            prefab: i % 2 ? "two" : "one",
            x: i,
            y: 16,
          })),
        },
      },
    },
    behaviorRecipes: { entities: {} },
    spatial: {
      camera: {
        projection: "orthographic",
        position: { x: 48, y: -160, elevation: 160 },
        target: { x: 48, y: 32, elevation: 16 },
        height: 240,
        near: 0.1,
        far: 1000,
      },
      terrain: Array.from({ length: terrainCount }, (_, i) => ({
        id: "ground" + i,
        x: i * 32,
        y: 0,
        width: 32,
        depth: 64,
        elevation: 0,
        textureId: i % 2,
      })),
      billboards: Object.fromEntries(
        Array.from({ length: count }, (_, i) => ["tree" + i, {}]),
      ),
    },
  });
  try {
    // Keep a real pre-v5 save and its original hash while the active replay fixture advances to v5.
    const legacy = JSON.parse(
      new TextDecoder().decode(
        await readFile(
          new URL(
            "../../../../tests/fixtures/legacy/data-scene-state-v3.json",
            import.meta.url,
          ),
        ),
      ),
    );
    equal(legacy.dataScene.version, 3);
    equal(hashGameStateSnapshot(legacy), legacy.snapshotHash);
    ok(
      restoreGameStateSnapshot(destination, legacy, {
        dataSceneAuthoringApplyOptions: {
          textureId: (name) => (name === "crate" ? 1 : 2),
        },
      }).dataSceneStateApplied,
    );
    equal(destination.entityCount(), legacy.dataScene.scene.entityCount);
    equal(hashGameStateSnapshot(legacy), legacy.snapshotHash);
    for (const [count, terrainCount, message] of [
      [1025, 1, /1024/],
      [2, 63, /64/],
    ] as const) {
      const doc = document(count, terrainCount);
      applyDataSceneAuthoringDocument(source, doc);
      const sentinel = applyDataSceneAuthoringDocument(
        destination,
        document(1, 1),
      ).entityHandles.tree0!;
      const snapshot = captureGameStateSnapshot(source, {
        includeDataSceneState: true,
        includeDataSceneProgress: true,
        dataSceneAuthoringDocument: JSON.parse(JSON.stringify(doc)),
      });
      const bad = JSON.parse(JSON.stringify(snapshot));
      bad.dataScene.version = 7;
      bad.dataScene.progress.spatial.environment = environment;
      bad.snapshotHash = hashGameStateSnapshot(bad);
      throws(() => restoreGameStateSnapshot(destination, bad), message);
      ok(destination.gameplayEntityExists(sentinel));
      equal(destination.entityCount(), 1);
      // The same texture-budget error in authored effects is also caught before replacing the scene.
      throws(
        () =>
          applyDataSceneAuthoringDocument(destination, {
            ...doc,
            spatial: { ...doc.spatial, environment },
          }),
        message,
      );
      ok(destination.gameplayEntityExists(sentinel));
    }
    const doc = document(2, 63);
    const handles = applyDataSceneAuthoringDocument(source, doc).entityHandles;
    ok(source.despawnPhysicsEntity(handles.tree1!));
    ok(source.setDataSceneSpatialEnvironment(environment));
    const saved = captureGameStateSnapshot(source, {
      includeDataSceneState: true,
      includeDataSceneProgress: true,
      dataSceneAuthoringDocument: JSON.parse(JSON.stringify(doc)),
    });
    equal(saved.dataScene!.version, 7);
    ok(
      restoreGameStateSnapshot(destination, JSON.parse(JSON.stringify(saved)))
        .dataSceneStateApplied,
    );
    equal(destination.entityCount(), 1);
  } finally {
    source.destroy();
    destination.destroy();
    globalThis.fetch = original.fetch;
    globalThis.requestAnimationFrame = original.raf;
    globalThis.cancelAnimationFrame = original.cancel;
  }
});
