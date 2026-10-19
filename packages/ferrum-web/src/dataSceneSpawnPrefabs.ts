import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import { finalCombatActions } from "./dataSceneCombatActions.js";
import { resolveDataSceneInstanceComponents } from "./dataSceneComponents.js";
import type {
  GameplayBehaviorRuntimeIds,
  GameplayEntityHandle,
  SceneBehaviorBindingPlan,
} from "./gameplayAuthoring.js";
import type { ResolvedSceneAuthoringDocument } from "./sceneAuthoringDocument.js";

/** Standalone authored seed; it remains an ordinary live instance after apply. */
export interface DataSceneSpawnPrefabSpec {
  readonly prototypeInstanceId: string;
}
export interface DataSceneSpawnPrefabBinding {
  readonly prefabId: number;
  readonly prototype: GameplayEntityHandle;
}

export function resolveDataSceneSpawnPrefabs(
  value: unknown,
  path: string,
): Readonly<Record<string, DataSceneSpawnPrefabSpec>> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  const entries = Object.entries(value);
  if (entries.length > 256)
    throw gameplayAuthoringDiagnosticError(path, "supports at most 256 prefabs");
  return Object.fromEntries(
    entries.map(([name, raw]) => {
      if (!name.trim() || !raw || typeof raw !== "object" || Array.isArray(raw))
        throw gameplayAuthoringDiagnosticError(
          `${path}.${name}`,
          "requires a named prototype object",
        );
      const input = raw as Record<string, unknown>; // Object shape checked above; fields are validated below.
      if (
        Object.keys(input).some((key) => key !== "prototypeInstanceId") ||
        typeof input.prototypeInstanceId !== "string" ||
        !input.prototypeInstanceId.trim()
      )
        throw gameplayAuthoringDiagnosticError(
          `${path}.${name}`,
          "requires only a non-empty prototypeInstanceId",
        );
      return [name, { prototypeInstanceId: input.prototypeInstanceId }];
    }),
  );
}

/** Authoring-only contracts; runs before activation, including document-only resolution. */
export function validateDataSceneSpawnPrefabs(
  document: Pick<ResolvedSceneAuthoringDocument, "gameplay" | "spatial" | "ids">,
  plan: SceneBehaviorBindingPlan,
  ids: GameplayBehaviorRuntimeIds | undefined = document.ids,
  path = "dataScene",
): void {
  const catalog = document.gameplay?.spawnPrefabs ?? {},
    used = new Set<number>();
  for (const [name, prefab] of Object.entries(catalog)) {
    const prefabPath = `${path}.gameplay.spawnPrefabs.${name}`,
      id = ids?.prefabs?.[name];
    if (id === undefined || !Number.isInteger(id) || id <= 0 || id > 0xffffffff || used.has(id))
      throw gameplayAuthoringDiagnosticError(
        prefabPath,
        "requires a distinct positive uint32 ids.prefabs entry",
      );
    used.add(id);
    const instance = plan.instances.find((instance) => instance.id === prefab.prototypeInstanceId);
    if (!instance)
      throw gameplayAuthoringDiagnosticError(
        prefabPath,
        "prototypeInstanceId must reference the applied fragment",
      );
    const component = resolveDataSceneInstanceComponents(instance, {
      allowTemplate: false,
      path: prefabPath,
    });
    if (
      component.mode !== "inline" ||
      component.body?.type === "dynamic" ||
      document.spatial?.attachments?.[instance.id] ||
      document.spatial?.models?.[instance.id]
    )
      throw gameplayAuthoringDiagnosticError(
        prefabPath,
        "requires a standalone inline static/kinematic actor without a model binding",
      );
    if (
      document.spatial &&
      (component.body !== undefined) !== (component.body?.heightSpan !== undefined)
    )
      throw gameplayAuthoringDiagnosticError(
        prefabPath,
        "spatial prototypes require matching body and heightSpan presence",
      );
    const managed = plan.commands.some(
      (command) =>
        command.entity === instance.id &&
        (command.type === "configureChase" ||
          (document.gameplay?.combatNavigation?.movementPatterns === "all" &&
            (command.type === "configureSeekTarget" || command.type === "configureAccelerate"))),
    );
    if (
      document.gameplay?.combatNavigation &&
      managed &&
      (component.body?.type !== "kinematic" ||
        !component.body.heightSpan ||
        component.collider.type !== "aabb" ||
        !component.collider.enabled)
    )
      throw gameplayAuthoringDiagnosticError(
        prefabPath,
        "navigation prototypes require an enabled kinematic heightSpan AABB body",
      );
  }
  for (const command of finalCombatActions(plan.commands, ids))
    if (command.type === "configureSpawnPrefabAction") {
      const id = ids?.prefabs?.[command.prefab];
      if (
        document.gameplay?.combat !== true ||
        !Object.prototype.hasOwnProperty.call(catalog, command.prefab) ||
        id === undefined ||
        (command.prefabId !== undefined && command.prefabId !== id)
      )
        throw gameplayAuthoringDiagnosticError(
          `${path}.behaviorRecipes.spawnPrefab`,
          "must reference gameplay.spawnPrefabs with the same declared prefab ID",
        );
    }
}

/** Cold registration only; sorted sparse semantic IDs, never an array-index identity. */
export function compileDataSceneSpawnPrefabs(
  bindings: readonly DataSceneSpawnPrefabBinding[],
): Uint32Array {
  if (bindings.length > 256)
    throw gameplayAuthoringDiagnosticError(
      "dataScene.gameplay.spawnPrefabs",
      "supports at most 256 prefabs",
    );
  const values = new Uint32Array(bindings.length * 3);
  let previous = 0;
  [...bindings]
    .sort((a, b) => a.prefabId - b.prefabId)
    .forEach((binding, index) => {
      const { prefabId, prototype } = binding;
      if (
        !Number.isInteger(prefabId) ||
        prefabId <= previous ||
        prefabId > 0xffffffff ||
        !prototype ||
        ![prototype.entityId, prototype.entityGeneration].every(
          (value) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff,
        )
      )
        throw gameplayAuthoringDiagnosticError(
          "dataScene.gameplay.spawnPrefabs",
          "requires unique positive uint32 IDs and valid prototype handles",
        );
      values.set([prefabId, prototype.entityId, prototype.entityGeneration], index * 3);
      previous = prefabId;
    });
  return values;
}
