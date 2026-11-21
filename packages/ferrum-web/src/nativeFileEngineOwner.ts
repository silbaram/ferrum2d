/** @internal Actual SDK facade ownership. File data cannot manufacture an entry.
 * These borrowed references never form a Ready token or a public raw Engine API. */
import type { Engine } from "../pkg/ferrum_core.js";
import type { CreateEngineOptions, FerrumEngine } from "./engineTypes.js";
import type { FramePipelineContext } from "./engineFramePipeline.js";
import type { ResolvedPhysicsSpec } from "./physicsSpec.js";
import type { WasmBridge } from "./wasmBridge.js";

export interface DetachedEngineMetadata {
  readonly initialPhysicsSpec: ResolvedPhysicsSpec;
  readonly physicsSpec: ResolvedPhysicsSpec;
  readonly physicsSpecScene?: number;
  readonly particlePresetIds: readonly number[];
  readonly lastViewportWidth?: number;
  readonly lastViewportHeight?: number;
  readonly viewportDirty?: boolean;
}

export interface NativeFileEngineOwner {
  readonly bridge: WasmBridge;
  readonly native: Engine;
  readonly options: CreateEngineOptions;
  readonly frame: FramePipelineContext;
  readonly initialPhysicsSpec: ResolvedPhysicsSpec;
  readonly particlePresetIds: ReadonlySet<number>;
  requireAlive(): void;
  /** Includes a paused RAF loop's native frame callback and authoring transaction. */
  busy(): boolean;
}

const owners = new WeakMap<FerrumEngine, NativeFileEngineOwner>();

export function registerNativeFileEngineOwner(engine: FerrumEngine, owner: NativeFileEngineOwner): void {
  if (owners.has(engine)) throw new Error("Native-file facade owner is already registered");
  owners.set(engine, Object.freeze(owner));
}

export function nativeFileEngineOwner(engine: FerrumEngine): NativeFileEngineOwner {
  const owner = owners.get(engine);
  if (!owner) throw new Error("Native-file operations require an actual Ferrum2D SDK facade");
  owner.requireAlive();
  if (owner.busy()) throw new Error("Stop the engine and finish frame/authoring callbacks before native-file operations");
  return owner;
}

/** The caller holds the source/native/resource fences throughout capture. */
export function captureDetachedEngineMetadata(owner: NativeFileEngineOwner): DetachedEngineMetadata {
  owner.requireAlive();
  if (owner.busy()) throw new Error("Native-file source is active");
  return {
    initialPhysicsSpec: structuredClone(owner.initialPhysicsSpec),
    physicsSpec: structuredClone(owner.frame.physicsSpec),
    physicsSpecScene: owner.frame.physicsSpecScene,
    particlePresetIds: [...owner.particlePresetIds],
    lastViewportWidth: owner.frame.lastViewportWidth,
    lastViewportHeight: owner.frame.lastViewportHeight,
    viewportDirty: owner.frame.viewportDirty,
  };
}
