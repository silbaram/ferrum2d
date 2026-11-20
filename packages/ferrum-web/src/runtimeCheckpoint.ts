import type { Engine, EngineRuntimeCheckpoint } from "../pkg/ferrum_core.js";
import type { ResolvedPhysicsSpec } from "./physicsSpec.js";

/** Same-Engine, in-memory Rust runtime rollback. Dispose when no longer needed.
 * This does not serialize to JSON or capture external assets/JS services. */
export interface RuntimeCheckpoint {
  readonly capturedRevision: number;
  dispose(): void;
}
export interface FerrumRuntimeCheckpointApi {
  supportsRuntimeCheckpoints(): boolean;
  /** Pause/stop RAF first. Native input, AI/search/cache, physics, entities,
   * terrain, interpolation and queued outputs are preserved without a tick. */
  captureRuntimeCheckpoint(): RuntimeCheckpoint;
  /** Same Engine only. Discard future entity handles and borrowed Wasm views.
   * Repeated restore is allowed; the rollback revision increases on success. */
  restoreRuntimeCheckpoint(checkpoint: RuntimeCheckpoint): void;
  runtimeCheckpointRevision(): number;
}
type Native = Partial<Pick<Engine, "runtime_checkpoint_version" | "runtime_checkpoint_revision"
  | "capture_runtime_checkpoint" | "restore_runtime_checkpoint">>;
interface Entry {
  owner: object;
  native: EngineRuntimeCheckpoint | undefined;
  physicsSpec: ResolvedPhysicsSpec;
  physicsSpecScene?: number;
}
const checkpoints = new WeakMap<RuntimeCheckpoint, Entry>();

export function createRuntimeCheckpointApi(native: Native, requireAlive: () => void,
  isFrameActive: () => boolean, host: { physicsSpec: ResolvedPhysicsSpec; physicsSpecScene?: number },
  synchronizeMetadata?: () => void): FerrumRuntimeCheckpointApi {
  const owner = {};
  const supported = () => typeof native.runtime_checkpoint_version === "function"
    && native.runtime_checkpoint_version() === 1
    && typeof native.runtime_checkpoint_revision === "function"
    && typeof native.capture_runtime_checkpoint === "function"
    && typeof native.restore_runtime_checkpoint === "function";
  const check = (stopped: boolean) => {
    requireAlive();
    if (!supported()) throw new Error("This Wasm core does not support runtime checkpoints version 1.");
    if (stopped && isFrameActive()) throw new Error("Pause or stop the engine and wait until frame callbacks finish before using a runtime checkpoint.");
  };
  const revision = () => {
    const value = native.runtime_checkpoint_revision!();
    if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error("Invalid runtime checkpoint revision.");
    return value;
  };
  return {
    supportsRuntimeCheckpoints() { requireAlive(); return supported(); },
    runtimeCheckpointRevision() { check(false); return revision(); },
    captureRuntimeCheckpoint() {
      check(true);
      synchronizeMetadata?.();
      const capturedRevision = revision();
      const physicsSpec = structuredClone(host.physicsSpec);
      const packet = native.capture_runtime_checkpoint!();
      if (!packet) throw new Error("Runtime checkpoint capture rejected (restore transaction or native snapshot capacity).");
      const entry: Entry = { owner, native: packet, physicsSpec, physicsSpecScene: host.physicsSpecScene };
      const checkpoint = Object.freeze({
        capturedRevision,
        dispose() { const packet = entry.native; entry.native = undefined; packet?.free(); },
        toJSON() { throw new Error("Runtime checkpoints are in-memory values and cannot be serialized to JSON."); },
      });
      checkpoints.set(checkpoint, entry);
      return checkpoint;
    },
    restoreRuntimeCheckpoint(checkpoint) {
      check(true);
      const entry = checkpoints.get(checkpoint);
      if (!entry || entry.owner !== owner) throw new Error("Runtime checkpoint belongs to a different Engine or SDK instance.");
      const packet = entry.native;
      if (!packet) throw new Error("Runtime checkpoint has been disposed.");
      // Prepare platform metadata before native commit. Device input, renderer
      // resources and other external services remain owned by their host.
      const physicsSpec = structuredClone(entry.physicsSpec);
      if (!native.restore_runtime_checkpoint!(packet)) throw new Error("Runtime checkpoint restore rejected; live state was preserved.");
      host.physicsSpec = physicsSpec;
      host.physicsSpecScene = entry.physicsSpecScene;
    },
  };
}
