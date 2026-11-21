import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Actual packed public SDK, native tile rendering and controller collision. */
export async function probeGraphicalTilemapAuthoring(page, packageEvidence = {}) {
  const directory = resolve("artifacts/physics-3d/goal-closure/graphical-tilemap/browser");
  await mkdir(directory, { recursive: true });
  const report = { format: "ferrum2d.graphical-tilemap.browser", version: 1, status: "running", packageEvidence };
  try {
    const result = await page.evaluate(async () => {
      const { createEngine, AssetLoader, WebGL2Renderer } = await import("@ferrum2d/ferrum-web/core");
      const { applyDataSceneAuthoringDocument, createSceneInstanceHandleRegistry } = await import("@ferrum2d/ferrum-web/authoring");
      const canvas = document.createElement("canvas");
      canvas.width = 160; canvas.height = 96; canvas.style.cssText = "display:block;width:160px;height:96px";
      document.body.append(canvas);
      const renderer = new WebGL2Renderer(canvas, { preserveDrawingBuffer: true });
      const loader = new AssetLoader(renderer), image = document.createElement("canvas");
      image.width = 32; image.height = 16;
      const paint = image.getContext("2d");
      paint.fillStyle = "#00ff00"; paint.fillRect(0, 0, 16, 16);
      paint.fillStyle = "#ff0000"; paint.fillRect(16, 0, 16, 16);
      await loader.loadAssets({ textures: { tiles: image.toDataURL() } });
      const originalRaf = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
      const pending = new Map(); let serial = 0, timestamp = 0, engine, checkpoint;
      window.requestAnimationFrame = callback => { pending.set(++serial, callback); return serial; };
      window.cancelAnimationFrame = id => { pending.delete(id); };
      let latest;
      const sample = { frames: 0, nativeFrames: 0, maxRustMs: 0, maxDrawCalls: 0 };
      const pump = ms => {
        timestamp += ms; const callbacks = [...pending.values()]; pending.clear();
        if (callbacks.length !== 1) throw new Error("Expected one owned tilemap RAF");
        callbacks[0](timestamp);
      };
      const draw = () => { engine.start(); engine.resume(); pump(100); pump(10); engine.pause(); };
      try {
        engine = await createEngine(frame => {
          latest = [...frame.renderCommandBuffer.buffer];
          sample.frames++; sample.nativeFrames += Number(Boolean(frame.unifiedPhysics));
          sample.maxRustMs = Math.max(sample.maxRustMs, frame.rustUpdateTimeMs);
          renderer.render(); renderer.renderCommands(frame.renderCommandBuffer); renderer.renderPostProcess();
          sample.maxDrawCalls = Math.max(sample.maxDrawCalls, renderer.stats().drawCalls);
        }, undefined, loader, () => renderer.viewportSize());
        const registry = createSceneInstanceHandleRegistry();
        const grid = { columns: 3, rows: 1, tileWidth: 16, tileHeight: 16, originX: -24, originY: -8, tiles: [1, 2, 3],
          definitions: [
            { id: 1, height: 1, blocksMovement: false, visual: { texture: "tiles", frame: { u0: 0, u1: 0.5 } } },
            { id: 2, height: 1, visual: { texture: "tiles", frame: { u0: 0.5, u1: 1 } } },
            { id: 3, height: 1 },
          ] };
        const doc = { format: "ferrum2d.consumer.scene-authoring", version: 1,
          sceneComposition: { initialFragment: "main", prefabs: { actor: {} }, fragments: { main: {
            instances: [{ id: "actor", prefab: "actor", x: -40, y: 0, props: { components: { template: "runner" } } }],
          } } }, behaviorRecipes: { entities: {} },
          physics: { space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: 0.01, collisionTilemap: grid } };
        let templateLookups = 0;
        const options = { instanceHandleRegistry: registry, componentTemplates: () => {
          templateLookups++;
          return { visual: { kind: "sprite", texture: "tiles", width: 4, height: 4 },
            collider: { type: "circle", radius: 2, isTrigger: false }, layer: "player",
            body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 1 }, kinematicController: {} } };
        } };
        const applied = applyDataSceneAuthoringDocument(engine, doc, options), actor = applied.entityHandles.actor;
        engine.setViewportSize(160, 96); engine.setDataSceneCamera({ x: 0, y: 0 });
        engine.configureAutoRigidBodyStep(false); draw();
        const gl = canvas.getContext("webgl2"), pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let red = 0, green = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 180 && pixels[i + 1] < 50 && pixels[i + 2] < 50) red++;
          if (pixels[i + 1] > 180 && pixels[i] < 50 && pixels[i + 2] < 50) green++;
        }
        const state = () => ({ body: engine.getPhysicsEntity(actor), time: engine.time(), registry: registry.get("actor"), entities: engine.entityCount() });
        const trace = () => {
          const rows = [];
          for (let step = 0; step < 50; step++) { engine.stepRigidBodies(Math.fround(0.01)); rows.push(state()); }
          return rows;
        };
        engine.setPhysicsBodyVelocity(actor, 100, 0);
        checkpoint = engine.captureRuntimeCheckpoint();
        const expected = trace(); engine.restoreRuntimeCheckpoint(checkpoint); const replayed = trace();
        engine.restoreRuntimeCheckpoint(checkpoint); checkpoint.dispose(); checkpoint = undefined;
        draw(); const commands = latest, before = state();
        let capacityError, missingAssetError;
        const bad = structuredClone(doc); bad.physics.maxBodies = 1;
        bad.physics.collisionTilemap.definitions[0].visual.tint = "#0000ff";
        try { applyDataSceneAuthoringDocument(engine, bad, options); } catch (error) { capacityError = String(error); }
        const afterCapacity = state();
        const missing = structuredClone(doc); missing.physics.collisionTilemap.definitions[0].visual.texture = "missing-tiles";
        try { applyDataSceneAuthoringDocument(engine, missing, options); } catch (error) { missingAssetError = String(error); }
        const afterMissingAsset = state();
        draw(); const retainedCommands = latest;
        const direct = engine.configureDataSceneCollisionTilemap(grid);
        engine.setPhysicsBodyPosition(actor, 40, 0); engine.setPhysicsBodyVelocity(actor, -100, 0);
        const invisibleWall = trace().at(-1).body.x;
        const cleared = engine.configureDataSceneCollisionTilemap(false);
        engine.setPhysicsBodyPosition(actor, -40, 0); engine.setPhysicsBodyVelocity(actor, 100, 0);
        const clearedEnd = trace().at(-1).body.x;
        return { templateLookups, red, green, glError: gl.getError(), commands, retainedCommands, before, afterCapacity,
          afterMissingAsset, capacityError, missingAssetError, expected, replayed, invisibleWall, direct, cleared, clearedEnd,
          sample, textureId: loader.textureId("tiles"), preservedTemplate: applied.document.sceneComposition.fragments.main.instances[0].props.components.template };
      } finally {
        checkpoint?.dispose(); engine?.destroy(); renderer.destroy(); canvas.remove();
        window.requestAnimationFrame = originalRaf; window.cancelAnimationFrame = originalCancel;
      }
    });
    assert(result.red >= 200 && result.green >= 200, "Both atlas frames must reach the actual framebuffer");
    assert.equal(result.glError, 0); assert.equal(result.before.entities, 1, "Tiles must not create per-cell entities");
    assert.equal(result.preservedTemplate, "runner");
    assert.deepEqual(result.expected, result.replayed, "Controller and tile collision must replay exactly");
    assert(result.expected.at(-1).body.x > -11 && result.expected.at(-1).body.x < -9, "Visible blocking tile must stop the controller");
    assert(result.invisibleWall > 25 && result.invisibleWall < 27, "Collision-only tile must still block");
    assert(result.capacityError && result.missingAssetError);
    assert.deepEqual(result.before, result.afterCapacity); assert.deepEqual(result.before, result.afterMissingAsset);
    assert.deepEqual(result.commands, result.retainedCommands, "Failed apply must preserve the old tile graphics");
    assert(result.direct && result.cleared); assert(result.clearedEnd > 9, "Clear must remove tile collision");
    assert(result.sample.frames > 0 && result.sample.nativeFrames === result.sample.frames);
    assert(result.sample.maxDrawCalls > 0 && result.sample.maxDrawCalls <= 4);
    assert(Number.isFinite(result.sample.maxRustMs) && result.sample.maxRustMs < 500);
    Object.assign(report, { status: "passed", result, scope: "Packed native graphics/collision/template authoring, real WebGL2 pixels and bounded functional costs; not density or physical-device acceptance" });
    return report;
  } catch (error) { report.status = "failed"; report.error = String(error); throw error; }
  finally { await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2) + "\n"); }
}
