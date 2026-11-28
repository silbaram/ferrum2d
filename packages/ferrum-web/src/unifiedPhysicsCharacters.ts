import type { Engine } from "../pkg/ferrum_core.js";
import type { PhysicsEntityHandle } from "./engineTypes/physicsBodies.js";
import { physicsEntityHandle } from "./physicsHandles.js";
import { physicsF32, type UnifiedPhysicsVector3 } from "./unifiedPhysicsAuthoring.js";
import type { WasmBridge } from "./wasmBridge.js";

export interface UnifiedPhysicsCharacterOptions {
  up?: UnifiedPhysicsVector3;
  skinWidth?: number;
  maxSlopeAngle?: number;
  slideAngle?: number;
  stepHeight?: number;
  stepMinWidth?: number;
  snapDistance?: number;
  maxVerticalSpeed?: number;
  /** Virtual character mass: 0 (prescribed motion, default) or 0.0001..10000.
   * Positive mass enables pushes with an equal opposite impulse and external force/impulse commands.
   * Incoming dynamic bodies see a kinematic capsule. Read collision events and apply any
   * gameplay knockback with applyUnifiedPhysicsCharacterImpulses.
   */
  pushMass?: number;
}
export const UNIFIED_PHYSICS_CHARACTER_LAYOUT = {
  stride: 28, entityId: 0, entityGeneration: 1, flags: 2,
  groundCollider: 3, groundBody: 5, carriedBy: 7,
  translation: 9, velocity: 12, carryTranslation: 15, verticalSpeed: 18,
  droppedContacts: 19, pairCasts: 20, pairContacts: 21, couplingVisits: 22,
  failedPairCasts: 23, obstacleCasts: 24, failedObstacleCasts: 25, obstacleContacts: 26, failedObstacleContacts: 27,
  groundedFlag: 1, slidingFlag: 2, ceilingFlag: 4, blockedByCharacterFlag: 8,
  couplingLimitFlag: 16, blockedByObstacleFlag: 32, obstacleLimitFlag: 64,
  groundPresentFlag: 128, carryPresentFlag: 256,
} as const;
/** Borrowed last-tick state. Ground/carry handles identify native physics objects, not render entities. */
export interface UnifiedPhysicsCharacterStateBufferView {
  count: number; stride: 28; words: Uint32Array; floats: Float32Array;
}
export interface FerrumUnifiedPhysicsCharacterApi {
  /** Setup/reset of a position-kinematic capsule controller. False disables it without removing the body. */
  configureUnifiedPhysicsCharacter(handle: PhysicsEntityHandle, options: UnifiedPhysicsCharacterOptions | false): void;
  /** Four floats per handle: perpendicular ground velocity XYZ, jump speed. Atomic admission, last duplicate wins.
   * Velocity persists; jump is consumed once on the next accepted interval. A new input replaces a pending jump.
   */
  setUnifiedPhysicsCharacterInputs(handles: Uint32Array, inputs: Float32Array): void;
  /** Persistent world-space XYZ force, three floats per character. Duplicate rows add.
   * Requires positive pushMass; planar Z must be zero. Admission is atomic.
   */
  addUnifiedPhysicsCharacterForces(handles: Uint32Array, forces: Float32Array): void;
  /** Clear persistent forces, retaining external velocity and queued impulses. */
  clearUnifiedPhysicsCharacterForces(handles: Uint32Array): void;
  /** Queue one-shot world-space XYZ impulses, three floats per character.
   * Requires positive pushMass. The next accepted character interval consumes them.
   */
  applyUnifiedPhysicsCharacterImpulses(handles: Uint32Array, impulses: Float32Array): void;
  /** Rows expire on the next character query, Wasm memory growth or engine destruction. Copy to retain. */
  queryUnifiedPhysicsCharacterStates(handles: Uint32Array): UnifiedPhysicsCharacterStateBufferView;
}
type Native = Pick<Engine, "unified_physics_character_version" | "configure_unified_physics_character"
  | "set_unified_physics_character_inputs" | "query_unified_physics_character_states"
  | "unified_physics_character_state_stride_words" | "unified_physics_character_state_count" | "unified_physics_character_state_ptr"> & {
    unified_physics_character_force_version?(): number;
    command_unified_physics_character_forces?(code: number, handles: Uint32Array, values: Float32Array): void;
  };
const EMPTY_FORCES = new Float32Array();

/** Positive virtual mass uses the finite-mass coupling implemented with force capability v1. */
export function assertUnifiedPhysicsCharacterCoupling(native: Pick<Native, "unified_physics_character_force_version">,
  configuration: Float32Array): void {
  if (configuration[10] > 0 && (typeof native.unified_physics_character_force_version !== "function"
    || native.unified_physics_character_force_version() !== 1))
    throw new Error("Positive character pushMass requires finite-mass coupling / character force version 1.");
}
function check(native: Native): void {
  if (typeof native.unified_physics_character_version !== "function" || native.unified_physics_character_version() !== 1
    || typeof native.configure_unified_physics_character !== "function" || typeof native.set_unified_physics_character_inputs !== "function"
    || typeof native.query_unified_physics_character_states !== "function" || typeof native.unified_physics_character_state_stride_words !== "function"
    || typeof native.unified_physics_character_state_count !== "function" || typeof native.unified_physics_character_state_ptr !== "function"
    || native.unified_physics_character_state_stride_words() !== UNIFIED_PHYSICS_CHARACTER_LAYOUT.stride) {
    throw new Error("This Wasm core does not support unified physics character version 1.");
  }
}
function handlesValid(h: Uint32Array): void {
  if (!(h instanceof Uint32Array) || h.length % 2 !== 0 || h.length > 131072) throw new Error("Character handles require at most 65536 id/generation pairs.");
}
export function queryUnifiedPhysicsCharacterStates(native: Native, memory: WebAssembly.Memory, handles: Uint32Array): UnifiedPhysicsCharacterStateBufferView {
  check(native); handlesValid(handles);
  const expected = handles.length / 2;
  native.query_unified_physics_character_states(handles.buffer === memory.buffer ? handles.slice() : handles);
  const count = native.unified_physics_character_state_count(), ptr = native.unified_physics_character_state_ptr();
  const stride = UNIFIED_PHYSICS_CHARACTER_LAYOUT.stride, buffer = memory.buffer;
  if (count !== expected || !Number.isSafeInteger(ptr) || ptr < 0 || ptr % 4 !== 0 || ptr + count * stride * 4 > buffer.byteLength) throw new Error("Invalid character state buffer.");
  return {count, stride, words: new Uint32Array(buffer, ptr, count * stride), floats: new Float32Array(buffer, ptr, count * stride)};
}
/** Shared cold codec for direct configuration and disposable authoring preflight. */
export function encodeUnifiedPhysicsCharacter(options: UnifiedPhysicsCharacterOptions): Float32Array {
  const up = options.up ?? [0,1,0];
  if (!Array.isArray(up) || up.length !== 3) throw new Error("Character up requires XYZ.");
  const slope = options.maxSlopeAngle ?? Math.PI / 4;
  const pushMass = physicsF32(options.pushMass === undefined ? 0 : options.pushMass);
  if (pushMass < 0 || pushMass > 10000 || pushMass !== 0 && pushMass < Math.fround(0.0001)
    || options.pushMass !== undefined && options.pushMass !== 0 && pushMass === 0)
    throw new Error("Character pushMass must be zero or in 0.0001..10000.");
  return new Float32Array([...up, options.skinWidth ?? 0.01, slope, options.slideAngle ?? slope,
    options.stepHeight ?? 0.3, options.stepMinWidth ?? 0.2, options.snapDistance ?? 0.2,
    options.maxVerticalSpeed ?? 50, pushMass].map(physicsF32));
}
export function createUnifiedPhysicsCharacterApi(native: Native,
  bridge: Pick<WasmBridge, "queryUnifiedPhysicsCharacterStates" | "copyUnifiedPhysicsInputAliases">,
  requireAlive: () => void): FerrumUnifiedPhysicsCharacterApi {
  const forceCommand = (code: number, handles: Uint32Array, values: Float32Array = EMPTY_FORCES): void => {
    requireAlive();
    if (native.unified_physics_character_force_version?.() !== 1 || typeof native.command_unified_physics_character_forces !== "function")
      throw new Error("This Wasm core does not support unified physics character force version 1.");
    handlesValid(handles);
    const stride = code === 1 ? 0 : 3;
    if (!(values instanceof Float32Array) || values.length !== handles.length / 2 * stride)
      throw new Error(`Character forces require ${stride} f32 values per handle.`);
    const data = bridge.copyUnifiedPhysicsInputAliases(handles, values);
    native.command_unified_physics_character_forces(code, data.handles, data.values);
  };
  return {
    configureUnifiedPhysicsCharacter(handle, options) {
      requireAlive(); check(native);
      const h = physicsEntityHandle(handle);
      if (options === false) { native.configure_unified_physics_character(h.entityId, h.entityGeneration, new Float32Array()); return; }
      const configuration = encodeUnifiedPhysicsCharacter(options);
      assertUnifiedPhysicsCharacterCoupling(native, configuration);
      native.configure_unified_physics_character(h.entityId, h.entityGeneration, configuration);
    },
    setUnifiedPhysicsCharacterInputs(handles, inputs) {
      requireAlive(); check(native); handlesValid(handles);
      if (!(inputs instanceof Float32Array) || inputs.length !== handles.length / 2 * 4) throw new Error("Character input requires four f32 values per handle.");
      const data = bridge.copyUnifiedPhysicsInputAliases(handles, inputs);
      native.set_unified_physics_character_inputs(data.handles, data.values);
    },
    addUnifiedPhysicsCharacterForces(handles, forces) { forceCommand(0, handles, forces); },
    clearUnifiedPhysicsCharacterForces(handles) { forceCommand(1, handles); },
    applyUnifiedPhysicsCharacterImpulses(handles, impulses) { forceCommand(2, handles, impulses); },
    queryUnifiedPhysicsCharacterStates(handles) { requireAlive(); return bridge.queryUnifiedPhysicsCharacterStates(handles); },
  };
}
