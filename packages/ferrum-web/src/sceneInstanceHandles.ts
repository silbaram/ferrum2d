/** Owns authored instance identity, reverse lookup and stale-handle pruning. */
import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import type {
  GameplayEntityHandle,
  SceneInstanceEntityExists,
  SceneInstanceHandleLookupOptions,
  SceneInstanceHandleRegistryEntry,
  SceneInstanceHandleRegistryOptions,
  SceneInstanceHandleRegistrySyncOptions,
  SceneInstanceHandleRegistrySyncResult,
} from "./gameplayAuthoringTypes.js";
import { isRecord, requiredBehaviorProp } from "./gameplayAuthoringValidation.js";
import type { ResolvedSceneCompositionInstance } from "./sceneComposition.js";

export class SceneInstanceHandleRegistry {
  private readonly handlesByInstanceId = new Map<string, GameplayEntityHandle>();
  private readonly instanceIdByHandleKey = new Map<string, string>();
  private readonly entityExists?: SceneInstanceEntityExists;

  constructor(options: SceneInstanceHandleRegistryOptions = {}) {
    this.entityExists = options.entityExists;
  }

  get size(): number {
    return this.handlesByInstanceId.size;
  }

  set(
    instanceId: string,
    handle: GameplayEntityHandle,
    options: { path?: string } = {},
  ): SceneInstanceHandleRegistryEntry {
    const path = options.path ?? `sceneInstanceHandles.${instanceId}`;
    const key = requiredBehaviorProp(instanceId, `${path}.instanceId`);
    const nextHandle = gameplayEntityHandle(handle, `${path}.handle`);
    const nextHandleKey = handleKey(nextHandle);
    const previousHandle = this.handlesByInstanceId.get(key);
    if (previousHandle !== undefined) {
      this.instanceIdByHandleKey.delete(handleKey(previousHandle));
    }
    const previousInstanceId = this.instanceIdByHandleKey.get(nextHandleKey);
    if (previousInstanceId !== undefined && previousInstanceId !== key) {
      this.handlesByInstanceId.delete(previousInstanceId);
    }
    const storedHandle = copyGameplayEntityHandle(nextHandle);
    this.handlesByInstanceId.set(key, storedHandle);
    this.instanceIdByHandleKey.set(nextHandleKey, key);
    return {
      instanceId: key,
      handle: copyGameplayEntityHandle(storedHandle),
    };
  }

  get(instanceId: string, options: SceneInstanceHandleLookupOptions = {}): GameplayEntityHandle | undefined {
    const key = requiredBehaviorProp(instanceId, `${options.path ?? "sceneInstanceHandles"}.instanceId`);
    const handle = this.handlesByInstanceId.get(key);
    if (handle === undefined) {
      return undefined;
    }
    if ((options.validateLive ?? false) && !this.isLive(handle)) {
      this.delete(key);
      return undefined;
    }
    return copyGameplayEntityHandle(handle);
  }

  require(instanceId: string, options: SceneInstanceHandleLookupOptions = {}): GameplayEntityHandle {
    const handle = this.get(instanceId, options);
    if (handle === undefined) {
      throw gameplayAuthoringDiagnosticError(
        options.path ?? `sceneInstanceHandles.${instanceId}`,
        `references unknown or stale scene instance '${instanceId}'`,
      );
    }
    return handle;
  }

  has(instanceId: string, options: SceneInstanceHandleLookupOptions = {}): boolean {
    return this.get(instanceId, options) !== undefined;
  }

  instanceIdForHandle(
    handle: GameplayEntityHandle,
    options: SceneInstanceHandleLookupOptions = {},
  ): string | undefined {
    const path = options.path ?? "sceneInstanceHandles.handle";
    const checkedHandle = gameplayEntityHandle(handle, path);
    const instanceId = this.instanceIdByHandleKey.get(handleKey(checkedHandle));
    if (instanceId === undefined) {
      return undefined;
    }
    if ((options.validateLive ?? false) && !this.isLive(checkedHandle)) {
      this.delete(instanceId);
      return undefined;
    }
    return instanceId;
  }

  delete(instanceId: string): boolean {
    const handle = this.handlesByInstanceId.get(instanceId);
    if (handle === undefined) {
      return false;
    }
    this.handlesByInstanceId.delete(instanceId);
    this.instanceIdByHandleKey.delete(handleKey(handle));
    return true;
  }

  clear(): void {
    this.handlesByInstanceId.clear();
    this.instanceIdByHandleKey.clear();
  }

  entries(options: SceneInstanceHandleLookupOptions = {}): readonly SceneInstanceHandleRegistryEntry[] {
    if (options.validateLive ?? false) {
      this.pruneStale(options);
    }
    return Array.from(this.handlesByInstanceId.entries(), ([instanceId, handle]) => ({
      instanceId,
      handle: copyGameplayEntityHandle(handle),
    }));
  }

  sync(
    instances: readonly ResolvedSceneCompositionInstance[],
    handles: readonly GameplayEntityHandle[],
    options: SceneInstanceHandleRegistrySyncOptions = {},
  ): SceneInstanceHandleRegistrySyncResult {
    const path = options.path ?? "sceneInstanceHandles";
    if (instances.length !== handles.length) {
      throw gameplayAuthoringDiagnosticError(`${path}.handles`, "must match scene instance count");
    }
    const seen = new Set<string>();
    const seenHandleIndexes = new Map<string, number>();
    const nextEntries = instances.map((instance, index) => {
      const instanceId = requiredBehaviorProp(instance.id, `${path}.instances.${index}.id`);
      if (seen.has(instanceId)) {
        throw gameplayAuthoringDiagnosticError(`${path}.instances.${index}.id`, "must be unique");
      }
      seen.add(instanceId);
      const handle = gameplayEntityHandle(handles[index]!, `${path}.instances.${index}.handle`);
      const nextHandleKey = handleKey(handle);
      const previousHandleIndex = seenHandleIndexes.get(nextHandleKey);
      if (previousHandleIndex !== undefined) {
        throw gameplayAuthoringDiagnosticError(
          `${path}.instances.${index}.handle`,
          `must be unique; duplicates instances.${previousHandleIndex}.handle`,
        );
      }
      seenHandleIndexes.set(nextHandleKey, index);
      return {
        instanceId,
        handle: copyGameplayEntityHandle(handle),
      };
    });
    const entries = nextEntries.map((entry, index) =>
      this.set(entry.instanceId, entry.handle, {
        path: `${path}.instances.${index}`,
      }),
    );
    const removedInstanceIds: string[] = [];
    if (options.removeMissing ?? true) {
      for (const instanceId of Array.from(this.handlesByInstanceId.keys())) {
        if (!seen.has(instanceId) && this.delete(instanceId)) {
          removedInstanceIds.push(instanceId);
        }
      }
    }
    const staleInstanceIds = (options.pruneStale ?? true)
      ? this.pruneStale({ path: `${path}.stale` })
      : [];
    const staleInstanceIdSet = new Set(staleInstanceIds);
    const syncedEntries = entries.filter((entry) =>
      !staleInstanceIdSet.has(entry.instanceId) && this.handlesByInstanceId.has(entry.instanceId),
    );
    this.reorderSyncedEntries(syncedEntries, seen);
    return {
      entries: syncedEntries,
      removedInstanceIds,
      staleInstanceIds,
    };
  }

  pruneStale(_options: { path?: string } = {}): readonly string[] {
    if (this.entityExists === undefined) {
      return [];
    }
    const staleInstanceIds: string[] = [];
    for (const [instanceId, handle] of Array.from(this.handlesByInstanceId.entries())) {
      if (!this.isLive(handle)) {
        this.delete(instanceId);
        staleInstanceIds.push(instanceId);
      }
    }
    return staleInstanceIds;
  }

  private isLive(handle: GameplayEntityHandle): boolean {
    return this.entityExists?.(copyGameplayEntityHandle(handle)) ?? true;
  }

  private reorderSyncedEntries(
    entries: readonly SceneInstanceHandleRegistryEntry[],
    syncedInstanceIds: ReadonlySet<string>,
  ): void {
    const remainingEntries = Array.from(this.handlesByInstanceId.entries())
      .filter(([instanceId]) => !syncedInstanceIds.has(instanceId))
      .map(([instanceId, handle]) => ({
        instanceId,
        handle: copyGameplayEntityHandle(handle),
      }));
    this.clear();
    for (const entry of [...entries, ...remainingEntries]) {
      const handle = copyGameplayEntityHandle(entry.handle);
      this.handlesByInstanceId.set(entry.instanceId, handle);
      this.instanceIdByHandleKey.set(handleKey(handle), entry.instanceId);
    }
  }
}

export function createSceneInstanceHandleRegistry(
  options: SceneInstanceHandleRegistryOptions = {},
): SceneInstanceHandleRegistry {
  return new SceneInstanceHandleRegistry(options);
}

export function gameplayEntityHandle(value: unknown, path: string): GameplayEntityHandle {
  if (!isRecord(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an entity handle object");
  }
  const entityId = handleU32(value.entityId, `${path}.entityId`);
  const entityGeneration = handleU32(value.entityGeneration, `${path}.entityGeneration`);
  return { entityId, entityGeneration };
}

function copyGameplayEntityHandle(handle: GameplayEntityHandle): GameplayEntityHandle {
  return {
    entityId: handle.entityId,
    entityGeneration: handle.entityGeneration,
  };
}

function handleKey(handle: GameplayEntityHandle): string {
  return `${handle.entityId}:${handle.entityGeneration}`;
}

function handleU32(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-negative uint32 integer");
  }
  return value;
}
