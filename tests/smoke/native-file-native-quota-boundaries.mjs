/** Measure inclusive native preparation limits of an SDK-generated file. */
export function probeNativeFileQuotas(page, wasmUrl) {
  return page.evaluate(async wasmUrl => {
    const { createEngine, createNativeGameFileSession, NativeGameFileError, UNIFIED_PHYSICS_STATE_LAYOUT } =
      await import("@ferrum2d/ferrum-web/core");
    const { createDataSceneRuntimeTarget } = await import("@ferrum2d/ferrum-web/authoring");
    const wasm = new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer());
    const engine = await createEngine();

    function check(condition, message) {
      if (!condition) throw new Error(message);
    }
    try {
      engine.useDataScene();
      engine.configureUnifiedPhysics({ space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: .01 });
      const moving = engine.spawnUnifiedPhysicsBody({
        kind: "kinematic-velocity", linearVelocity: [2, 0, 0], collider: { shape: { type: "sphere", radius: .25 } },
      });
      const sphere = { shape: { type: "sphere", radius: .125 } };
      const anchor = engine.spawnUnifiedPhysicsBody({ kind: "fixed", pose: { position: [3, 0, 0] }, collider: sphere });
      const bob = engine.spawnUnifiedPhysicsBody({ kind: "dynamic", pose: { position: [4, 0, 0] }, collider: sphere });
      engine.createUnifiedPhysicsJoint({ bodyA: anchor, bodyB: bob, kind: { type: "distance", length: 1 } });

      // World joint slots and nested collider leaves use separate allowances from the native joint arena.
      const circle = { type: "circle", radius: .25 };
      const left = engine.spawnRigidBody({ x: 10, y: 0, mass: 1, collider: circle });
      const right = engine.spawnRigidBody({ x: 11, y: 0, mass: 1, collider: circle });
      const joint = engine.spawnPhysicsJoint({ type: "distance", entityA: left, entityB: right, restLength: 1 });
      check(engine.getPhysicsJoint(joint), "missing World joint");
      check(engine.addPhysicsBodyCollider(left, { collider: { ...circle, offsetX: .25 } }), "could not add compound leaf");
      check(engine.configureDataSceneCollisionTilemap({
        columns: 2, rows: 2, tileWidth: 1, tileHeight: 1, originX: 30, originY: 30,
        tiles: new Uint32Array([1, 1, 1, 1]), definitions: [{ id: 1, height: 1 }],
      }), "could not add terrain");

      // Registering an animated actor as a spawn prototype shares the source clip table.
      const sprite = createDataSceneRuntimeTarget(engine, { activateDataScene: false }).spawnSceneInstance({
        id: "seed", sourceId: "seed", prefab: "seed", x: 20, y: 0, rotationRadians: 0, scale: 1, layer: 0,
        props: { components: { sprite: { texture: 0, width: 1, height: 1 }, collider: "none", layer: "enemy" } },
      });
      check(sprite && engine.configureDataSceneSpriteAnimation(sprite, { clips: [{ id: 1, fps: 10, frames: [{}, {}] }] }),
        "could not configure prototype sprite clips");
      check(engine.configureDataSceneGameplay({
        combat: true, primaryActor: moving, spawnPrefabs: [{ prefabId: 1, prototype: sprite }],
      }), "could not share sprite clips with prototype");

      const handles = new Uint32Array([moving, anchor, bob].flatMap(h => [h.entityId, h.entityGeneration]));
      function state() {
        const rows = engine.queryUnifiedPhysicsBodyStates(handles);
        return JSON.stringify([Array.from(rows.floats), Array.from(rows.words)]);
      }
      const before = state();
      const writer = await createNativeGameFileSession(engine, { wasm });
      let file;
      try { file = await writer.capture(); } finally { await writer.dispose(); }

      let attempts = 0;
      async function attempt(key, value, relatedLimits = {}) {
        const options = key === "maximumMemoryPages" ? { maximumMemoryPages: value } :
          { nativeLimits: { ...relatedLimits, [key]: value } };
        const session = await createNativeGameFileSession(engine, { wasm, ...options });
        attempts++;
        try {
          const ready = await session.prepare(file);
          await session.discard(ready);
          return { accepted: true };
        } catch (error) {
          if (!(error instanceof NativeGameFileError && error.phase === "prepare")) throw error;
          return { accepted: false, code: error.code, phase: error.phase, cause: String(error.cause) };
        } finally {
          check(session.current() === engine && session.epoch() === 0 && state() === before, key + " modified current game");
          await session.dispose();
        }
      }
      async function boundary(key, exact, relatedLimits = {}) {
        const accepted = await attempt(key, exact, relatedLimits);
        check(accepted.accepted, key + " exact " + exact + " " + JSON.stringify(accepted));
        const below = exact ? await attempt(key, exact - 1, relatedLimits) : null;
        check(!below?.accepted, key + " accepted one unit below " + exact);
        return { exact, below };
      }

      const sectionLimits = ["maxEngineSectionBytes", "maxVariablesSectionBytes", "maxAuthoringSectionBytes",
        "maxResourceManifestSectionBytes", "maxResourceDataSectionBytes", "maxDialogueQuestSectionBytes", "maxHostBindingsSectionBytes"];
      const words = new DataView(file.buffer, file.byteOffset, file.byteLength);
      check(words.getUint32(8, true) === 1 && words.getUint32(12, true) === 64 &&
        words.getUint32(20, true) === sectionLimits.length, "file directory layout");
      const MiB = 1024 * 1024;
      const known = {
        maxFileBytes: file.length, maxChecksumBytes: file.length, maxChecksumWork: 4 * file.length,
        maxEntitySlots: engine.entityCount(), maxJointSlots: 1, maxDecodeZeroSizedElements: 0,
        // Native admission reserves the configured decode allocation plus post-decode scratch.
        maxAllocationWork: (960 + 64) * MiB,
      };
      sectionLimits.forEach((key, i) => {
        const offset = 64 + i * 32;
        check(words.getUint32(offset, true) === i + 1, "section ordinal");
        known[key] = Number(words.getBigUint64(offset + 16, true));
      });
      const quotas = {};
      for (const [key, exact] of Object.entries(known)) quotas[key] = await boundary(key, exact);

      // These native counters are not exposed as telemetry. Find the minimum accepted
      // limit, then rerun it and one unit below with every other setting at its default.
      const variable = {
        maxDecodeInputBytes: 64 * MiB, maxDecodeAllocationWork: 960 * MiB, maxDecodeValues: 64 * MiB,
        maxDecodeDepth: 96, maxDecodeCollection: 64 * MiB, maxPostDecodeWork: 128 * MiB,
        maxPostDecodeScratchBytes: 64 * MiB, maxNestedItems: 64 * MiB, maxAliasRoots: 64 * MiB,
        maxAliasCompareBytes: 128 * MiB, maxOutputBytes: 64 * MiB, maxMetadataBytes: 64 * MiB, maximumMemoryPages: 8192,
      };
      for (const [key, maximum] of Object.entries(variable)) {
        let lower = 0, upper = Math.min(maximum, file.length);
        check(!(await attempt(key, lower)).accepted, key + " must be used by this fixture");
        while (!(await attempt(key, upper)).accepted) {
          check(upper < maximum, "default " + key + " rejected");
          lower = upper;
          upper = Math.min(maximum, upper * 2);
        }
        while (upper - lower > 1) {
          const middle = lower + Math.floor((upper - lower) / 2);
          if ((await attempt(key, middle)).accepted) upper = middle;
          else lower = middle;
        }
        quotas[key] = await boundary(key, upper);
      }

      const memoryPages = quotas.maximumMemoryPages;
      delete quotas.maximumMemoryPages;
      check(Object.keys(quotas).length === 26, "public native limit coverage");
      const allocationComponents = {
        maxDecodeAllocationWork: quotas.maxDecodeAllocationWork.exact,
        maxPostDecodeScratchBytes: quotas.maxPostDecodeScratchBytes.exact,
      };
      const combined = allocationComponents.maxDecodeAllocationWork + allocationComponents.maxPostDecodeScratchBytes;
      const combinedAllocation = { ...allocationComponents, ...await boundary("maxAllocationWork", combined, allocationComponents) };

      const x = engine.queryUnifiedPhysicsBodyStates(handles).floats[UNIFIED_PHYSICS_STATE_LAYOUT.position];
      engine.stepRigidBodies(.01);
      check(engine.queryUnifiedPhysicsBodyStates(handles).floats[UNIFIED_PHYSICS_STATE_LAYOUT.position] > x,
        "native quota checks blocked the original game");
      return { fileBytes: file.length, attempts, quotas, maximumMemoryPages: memoryPages, combinedAllocation };
    } finally { engine.destroy(); }
  }, wasmUrl);
}
