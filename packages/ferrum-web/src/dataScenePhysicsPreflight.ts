import { Engine } from "../pkg/ferrum_core.js";
import { encodeUnifiedPhysicsWorld, type UnifiedPhysicsOptions } from "./unifiedPhysics.js";
import { encodeUnifiedPhysicsBody, type UnifiedPhysicsBodyOptions } from "./unifiedPhysicsAuthoring.js";
import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import { assertUnifiedPhysicsCharacterCoupling, encodeUnifiedPhysicsCharacter, type UnifiedPhysicsCharacterOptions } from "./unifiedPhysicsCharacters.js";
import { encodeUnifiedPhysicsJoint } from "./unifiedPhysicsJoints.js";
import type { CompiledDataScenePhysicsJoint } from "./dataScenePhysicsJoints.js";
import type { PhysicsEntityHandle } from "./engineTypes/physicsBodies.js";
import { configureEncodedDataSceneCollisionTilemap, type EncodedDataSceneCollisionTilemap } from "./dataSceneCollisionTilemap.js";
import { guardWasmNamespaceObject, wasmNamespaceForObject } from "./wasmNamespaceObject.js";

export interface CompiledDataScenePhysicsBody {
  id: string;
  options: UnifiedPhysicsBodyOptions;
  character?: UnifiedPhysicsCharacterOptions;
}

/** Cold authoring admission. A disposable native world checks actual geometry, axis locks,
 * mass/inertia and aggregate capacities before the running scene is replaced. No stepping. */
export function preflightDataScenePhysics(world: UnifiedPhysicsOptions,
  bodies: readonly CompiledDataScenePhysicsBody[], joints: readonly CompiledDataScenePhysicsJoint[], path: string,
  tilemap?: EncodedDataSceneCollisionTilemap, nativeOwner?: Engine): void {
  const namespace = nativeOwner === undefined ? undefined : wasmNamespaceForObject(nativeOwner);
  const probe = namespace === undefined ? new Engine()
    : namespace.call(bindings => guardWasmNamespaceObject(namespace, new bindings.Engine()));
  let location = `${path}.physics`;
  try {
    probe.use_data_scene();
    const w = encodeUnifiedPhysicsWorld(world);
    probe.configure_unified_physics_world(w.metadata, w.values);
    const handles = new Map<string, PhysicsEntityHandle>();
    for (const body of bodies) {
      location = `${path}.instances.${body.id}.components.body`;
      const p = encodeUnifiedPhysicsBody(body.options);
      const id = probe.spawn_unified_physics_body(p.metadata, p.values, p.shape.metadata, p.shape.values);
      handles.set(body.id, { entityId: id[0], entityGeneration: id[1] });
      if (body.character !== undefined) {
        location += ".character";
        const configuration = encodeUnifiedPhysicsCharacter(body.character);
        assertUnifiedPhysicsCharacterCoupling(probe, configuration);
        probe.configure_unified_physics_character(id[0], id[1], configuration);
      }
    }
    for (const joint of joints) {
      location = `${path}.physics.joints.${joint.name}`;
      const p = encodeUnifiedPhysicsJoint({ ...joint.options, bodyA: handles.get(joint.options.bodyA)!, bodyB: handles.get(joint.options.bodyB)! });
      probe.create_unified_physics_joint(p.handles, p.metadata, p.values);
    }
    if (tilemap !== undefined) {
      location = `${path}.physics.collisionTilemap`;
      if (!configureEncodedDataSceneCollisionTilemap(probe, tilemap))
        throw new Error("native tilemap admission rejected");
    }
  } catch (e) {
    throw sceneCompositionDiagnosticError(location, e instanceof Error ? e.message : String(e));
  } finally { probe.free(); }
}
