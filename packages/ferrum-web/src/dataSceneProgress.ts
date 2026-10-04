import type { FerrumEngine } from "./engineTypes.js";
import type { ApplyDataSceneAuthoringDocumentOptions } from "./dataSceneRuntimeTarget.js";
import { bindSceneBehaviorRecipes, type GameplayEntityHandle } from "./gameplayAuthoring.js";
import { resolveSceneAuthoringDocument } from "./sceneAuthoringDocument.js";
import { resolveDataSceneNavigationSpec, type DataSceneNavigationSpec } from "./dataSceneNavigation.js";

/** Authored entity progress only; positions, timers and dynamic spawns are not included. */
export interface DataSceneProgressSnapshot {
  readonly instances: readonly {
    readonly id: string;
    readonly removed: boolean;
    readonly interactionConsumed: boolean;
  }[];
  /** null explicitly restores a cleared navigation grid. */
  readonly navigation: DataSceneNavigationSpec | null;
}

export interface DataSceneProgressAdapter {
  epoch(): number;
  capture(epoch: number, handles: Uint32Array): Uint32Array;
  navigation(): Float64Array;
  restore(epoch: number, handles: Uint32Array, states: Uint32Array): boolean;
}
const adapters = new WeakMap<FerrumEngine, DataSceneProgressAdapter>();
const contexts = new WeakMap<FerrumEngine, {
  epoch: number;
  document: string;
  handles: Readonly<Record<string, GameplayEntityHandle>>;
}>();

export function attachDataSceneProgressAdapter(engine: FerrumEngine, adapter: DataSceneProgressAdapter): void {
  adapters.set(engine, adapter);
}

// Metadata only: retain original handles even after entities are removed from the world/registry.
export function forgetDataSceneProgressContext(engine: FerrumEngine): void {
  contexts.delete(engine);
}

export function rememberDataSceneProgressContext(
  engine: FerrumEngine, document: unknown, handles: Readonly<Record<string, GameplayEntityHandle>>,
  options: ApplyDataSceneAuthoringDocumentOptions,
): void {
  const adapter = adapters.get(engine);
  if (adapter === undefined || unsupportedOptions(options).length > 0) return;
  contexts.set(engine, {
    epoch: adapter.epoch(), document: canonicalDocument(document),
    handles: Object.fromEntries(Object.entries(handles).map(([id, handle]) => [id, { ...handle }])),
  });
}

export function captureDataSceneProgress(engine: FerrumEngine, document: unknown): DataSceneProgressSnapshot {
  const adapter = requireAdapter(engine);
  const context = contexts.get(engine);
  if (context === undefined || context.epoch === 0 || context.epoch !== adapter.epoch()) {
    throw new Error("Data Scene progress requires a fresh, complete authoring apply with default binding options; reset or incremental apply invalidates it.");
  }
  if (document === undefined || canonicalDocument(document) !== context.document) {
    throw new Error("Data Scene progress requires the same authoringDocument used to apply the scene.");
  }
  const ids = Object.keys(context.handles).sort();
  const states = adapter.capture(context.epoch, handleBuffer(ids, context.handles));
  if (states.length !== ids.length) throw new Error("Data Scene progress capture rejected stale handles.");
  const grid = adapter.navigation();
  const progress: DataSceneProgressSnapshot = {
    instances: ids.map((id, index) => ({ id, removed: states[index] === 0, interactionConsumed: states[index] === 3 })),
    navigation: grid.length === 0 ? null : resolveDataSceneNavigationSpec({
      columns: grid[0], rows: grid[1], cellWidth: grid[2], cellHeight: grid[3],
      originX: grid[4], originY: grid[5], costs: Array.from(grid.slice(6)),
    }),
  };
  validateDataSceneProgress(progress, document);
  return progress;
}

export function preflightDataSceneProgressRestore(
  engine: FerrumEngine, options: ApplyDataSceneAuthoringDocumentOptions = {},
): void {
  requireAdapter(engine);
  const unsupported = unsupportedOptions(options);
  if (unsupported.length > 0) throw new Error(`Data Scene progress restore does not support apply options: ${unsupported.join(", ")}. Put binding configuration in the saved document.`);
}

export function restoreDataSceneProgress(
  engine: FerrumEngine, progress: DataSceneProgressSnapshot, handles: Readonly<Record<string, GameplayEntityHandle>>,
): void {
  const adapter = requireAdapter(engine);
  const ids = progress.instances.map(instance => instance.id);
  const states = Uint32Array.from(progress.instances, instance => instance.removed ? 0 : instance.interactionConsumed ? 3 : 1);
  if (!adapter.restore(adapter.epoch(), handleBuffer(ids, handles), states)) {
    throw new Error("Data Scene progress restore rejected entity state.");
  }
  const ok = progress.navigation === null
    ? engine.clearDataSceneNavigation()
    : engine.configureDataSceneNavigation(progress.navigation);
  if (!ok) throw new Error("Data Scene progress restore rejected navigation.");
}

export function validateDataSceneProgress(value: unknown, document: unknown): asserts value is DataSceneProgressSnapshot {
  if (!isRecord(value) || Object.keys(value).some(key => !["instances", "navigation"].includes(key)) || !Array.isArray(value.instances)) {
    throw new Error("Data Scene progress must contain instances and navigation.");
  }
  if (document === undefined) throw new Error("Data Scene progress requires an authoringDocument.");
  const resolved = resolveSceneAuthoringDocument(document);
  const plan = bindSceneBehaviorRecipes(resolved.sceneComposition, resolved.behaviorRecipes);
  const expected = new Set(plan.instances.map(instance => instance.id));
  const interactions = new Map<string, boolean>();
  for (const binding of plan.bindings) {
    if (binding.command.type === "configureInteraction") interactions.set(binding.instance.id, binding.command.once);
  }
  for (const instance of value.instances) {
    if (!isRecord(instance) || Object.keys(instance).some(key => !["id", "removed", "interactionConsumed"].includes(key))
      || typeof instance.id !== "string" || !expected.delete(instance.id)
      || typeof instance.removed !== "boolean" || typeof instance.interactionConsumed !== "boolean"
      || (instance.interactionConsumed && (instance.removed || interactions.get(instance.id) !== true))) {
      throw new Error("Data Scene progress has an unknown/duplicate instance ID or invalid interaction state.");
    }
  }
  if (expected.size !== 0) throw new Error("Data Scene progress must include every authored instance.");
  if (value.navigation !== null) resolveDataSceneNavigationSpec(value.navigation, "dataScene.progress.navigation");
}

function requireAdapter(engine: FerrumEngine): DataSceneProgressAdapter {
  const adapter = adapters.get(engine);
  if (adapter === undefined) throw new Error("Data Scene progress requires a FerrumEngine created by createEngine().");
  return adapter;
}
function handleBuffer(ids: readonly string[], handles: Readonly<Record<string, GameplayEntityHandle>>): Uint32Array {
  return Uint32Array.from(ids.flatMap(id => {
    const handle = handles[id];
    if (handle === undefined) throw new Error(`Data Scene progress is missing instance '${id}'.`);
    return [handle.entityId, handle.entityGeneration];
  }));
}
function unsupportedOptions(options: ApplyDataSceneAuthoringDocumentOptions): string[] {
  return Object.entries(options).filter(([key, value]) => value !== undefined
    && !["path", "textureId", "colorManagement", "instanceHandleRegistry"].includes(key)
    && !(["activateDataScene", "validateBindings", "validateComponents"].includes(key) && value === true)
  ).map(([key]) => key);
}
function canonicalDocument(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => isRecord(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
