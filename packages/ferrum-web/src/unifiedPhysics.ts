import type {FerrumUnifiedPhysicsBindingApi} from "./unifiedPhysicsBindings.js";
import type {FerrumUnifiedPhysicsJointApi} from "./unifiedPhysicsJoints.js";
import type { FerrumUnifiedPhysicsControlApi } from "./unifiedPhysicsControls.js";
import type { FerrumUnifiedPhysicsObservationApi } from "./unifiedPhysicsObservations.js";
import type { Engine } from "../pkg/ferrum_core.js";
import { finiteNumber, uint32Number } from "./particlePreset.js";
import type { WasmBridge } from "./wasmBridge.js";
import type { FerrumUnifiedPhysicsAuthoringApi } from "./unifiedPhysicsAuthoring.js";
import type { FerrumUnifiedPhysicsCharacterApi } from "./unifiedPhysicsCharacters.js";
import type { FerrumUnifiedPhysicsCommandApi } from "./unifiedPhysicsCommands.js";
import type { FerrumUnifiedPhysicsCollisionApi } from "./unifiedPhysicsCollisions.js";
import type { FerrumUnifiedPhysicsQueryApi } from "./unifiedPhysicsQueries.js";

/** Explicit setup for the unified 3D backend. Planar mode constrains the same solver to XY. */
export interface UnifiedPhysicsOptions {
  space: "planar-xy" | "spatial";
  /** Engine units/s². Planar Z must be zero; spatial scenes use Y-up. */
  gravity: readonly [number, number, number];
  /** Engine units per meter; choose the scale used by the authored scene. */
  lengthUnit: number;
  stepSeconds?: number;
  velocityIterations?: number;
  positionIterations?: number;
  restitutionVelocityThreshold?: number;
  continuous?: boolean;
  maxBodies?: number;
  maxColliders?: number;
  maxEvents?: number;
  maxCharacters?: number;
  maxJoints?: number;
}

/** Word offsets in a native simulation row, independent of render projection. */
export const UNIFIED_PHYSICS_STATE_LAYOUT = {
  stride: 16, entityId: 0, entityGeneration: 1, flags: 2,
  position: 3, rotation: 6, linearVelocity: 10, angularVelocity: 13,
  sleepingFlag: 1,
} as const;

/** Borrowed views, invalidated by the next query, Wasm memory growth or engine destruction. Copy to retain. */
export interface UnifiedPhysicsBodyStateBufferView {
  count: number;
  stride: 16;
  words: Uint32Array;
  floats: Float32Array;
}

export interface FerrumUnifiedPhysicsApi extends FerrumUnifiedPhysicsBindingApi, FerrumUnifiedPhysicsJointApi, FerrumUnifiedPhysicsControlApi, FerrumUnifiedPhysicsAuthoringApi, FerrumUnifiedPhysicsCharacterApi, FerrumUnifiedPhysicsCommandApi, FerrumUnifiedPhysicsQueryApi, FerrumUnifiedPhysicsCollisionApi, FerrumUnifiedPhysicsObservationApi {
  /** Configure the current native world for Data Scene or planar Shooter/Breakout/Platformer.
   * Imports existing planar bodies/fixtures/joints and configures the fixed clock and auto stepping.
   * Spatial built-in scenes remain unsupported. Reconfiguration requires no bound bodies.
   * Native saves use same-Engine runtime checkpoints; legacy Shooter snapshots cannot capture native state.
   * Omitted creation options already select planar native with variable/automatic stepping.
   * Native file sessions use the separate bounded same-build public game-file API.
   */
  configureUnifiedPhysics(options: UnifiedPhysicsOptions): void;
  /** Packed entity id/generation pairs, at most 65,536. Preserves request order and duplicates. */
  queryUnifiedPhysicsBodyStates(handles: Uint32Array): UnifiedPhysicsBodyStateBufferView;
  /** Six f32s per handle: linear XYZ, angular XYZ. All rows validate before any mutation.
   * Duplicate handles use the last row. Controller velocities must use controller input instead.
   */
  setUnifiedPhysicsVelocities(handles: Uint32Array, velocities: Float32Array): void;
}

type NativeBridge = Pick<Engine,
  "unified_physics_bridge_version" | "configure_unified_physics_world" |
  "query_unified_physics_body_states" | "set_unified_physics_velocities" |
  "unified_physics_body_state_stride_words" | "unified_physics_body_state_count" |
  "unified_physics_body_state_ptr">;

function checkBridge(native: NativeBridge): void {
  if (typeof native.unified_physics_bridge_version !== "function"
    || native.unified_physics_bridge_version() !== 1
    || typeof native.configure_unified_physics_world !== "function"
    || typeof native.query_unified_physics_body_states !== "function"
    || typeof native.set_unified_physics_velocities !== "function"
    || typeof native.unified_physics_body_state_stride_words !== "function"
    || typeof native.unified_physics_body_state_count !== "function"
    || typeof native.unified_physics_body_state_ptr !== "function"
    || native.unified_physics_body_state_stride_words() !== UNIFIED_PHYSICS_STATE_LAYOUT.stride) {
    throw new Error("This Wasm core does not support unified physics bridge version 1.");
  }
}

function checkHandles(handles: Uint32Array): void {
  if (!(handles instanceof Uint32Array) || handles.length % 2 !== 0 || handles.length > 131_072) {
    throw new Error("Unified physics requires at most 65536 entity id/generation pairs.");
  }
}

export function queryUnifiedPhysicsBodyStates(
  native: NativeBridge, memory: WebAssembly.Memory, handles: Uint32Array,
): UnifiedPhysicsBodyStateBufferView {
  checkBridge(native);
  checkHandles(handles);
  const expectedCount = handles.length / 2;
  // Native input allocation can grow memory. Copy aliases before crossing the boundary.
  native.query_unified_physics_body_states(handles.buffer === memory.buffer ? handles.slice() : handles);
  const count = native.unified_physics_body_state_count();
  const pointer = native.unified_physics_body_state_ptr();
  const stride = UNIFIED_PHYSICS_STATE_LAYOUT.stride;
  // Reacquire memory only after native allocation; no cached TypedArray survives growth.
  const buffer = memory.buffer;
  if (!Number.isInteger(count) || count !== expectedCount
    || !Number.isSafeInteger(pointer) || pointer < 0 || pointer % 4 !== 0
    || pointer + count * stride * 4 > buffer.byteLength) {
    throw new Error("Invalid unified physics body state buffer.");
  }
  return { count, stride, words: new Uint32Array(buffer, pointer, count * stride),
    floats: new Float32Array(buffer, pointer, count * stride) };
}

export function createUnifiedPhysicsApi(
  native: NativeBridge, bridge: Pick<WasmBridge, "queryUnifiedPhysicsBodyStates" | "copyUnifiedPhysicsInputAliases">,
  requireAlive: () => void,
  onConfigured?: (config: {
    gravity: readonly [number, number, number]; stepSeconds: number;
    velocityIterations: number; positionIterations: number; continuous: boolean;
  }) => void,
): Pick<FerrumUnifiedPhysicsApi, "configureUnifiedPhysics" | "queryUnifiedPhysicsBodyStates" | "setUnifiedPhysicsVelocities"> {
  return {
    configureUnifiedPhysics(options) {
      requireAlive(); checkBridge(native);
      const {metadata, values} = encodeUnifiedPhysicsWorld(options);
      native.configure_unified_physics_world(metadata, values);
      // Publish the admitted f32 settings only after native configuration succeeds.
      onConfigured?.({ gravity: [values[0], values[1], values[2]], stepSeconds: values[3],
        velocityIterations: metadata[1], positionIterations: metadata[2], continuous: metadata[3] !== 0 });
    },
    queryUnifiedPhysicsBodyStates(handles) {
      requireAlive();
      return bridge.queryUnifiedPhysicsBodyStates(handles);
    },
    setUnifiedPhysicsVelocities(handles, velocities) {
      requireAlive(); checkBridge(native); checkHandles(handles);
      if (!(velocities instanceof Float32Array) || velocities.length !== handles.length / 2 * 6) {
        throw new Error("Unified physics velocity rows require six f32 values per handle.");
      }
      const input = bridge.copyUnifiedPhysicsInputAliases(handles, velocities);
      native.set_unified_physics_velocities(input.handles, input.values);
    },
  };
}

/** Internal shared setup encoding for runtime and authoring preflight. */
export function encodeUnifiedPhysicsWorld(options: UnifiedPhysicsOptions) {
  if (options.space !== "planar-xy" && options.space !== "spatial") throw new Error("Invalid unified physics space.");
  if (!Array.isArray(options.gravity) || options.gravity.length !== 3) throw new Error("Unified physics gravity requires XYZ.");
  if (options.continuous !== undefined && typeof options.continuous !== "boolean") throw new Error("Unified physics continuous must be boolean.");
  const numbers = [...options.gravity, options.stepSeconds ?? 1 / 60, options.lengthUnit, options.restitutionVelocityThreshold ?? 0];
  const values = new Float32Array(numbers.map(v => finiteNumber(Math.fround(finiteNumber(v, "unified physics value")), "unified physics f32 value")));
  const metadata = new Uint32Array([
    options.space === "planar-xy" ? 0 : 1,
    options.velocityIterations ?? 1, options.positionIterations ?? 1,
    options.continuous === false ? 0 : 1,
    options.maxBodies ?? 8192, options.maxColliders ?? 16384,
    options.maxEvents ?? 4096, options.maxCharacters ?? 128, options.maxJoints ?? 16384,
  ].map(v => uint32Number(v, "unified physics metadata")));
  return {metadata, values};
}
