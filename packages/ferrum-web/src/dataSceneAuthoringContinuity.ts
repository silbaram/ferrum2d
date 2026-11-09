import { dataSceneAuthoringContinuityContext } from "./dataSceneProgress.js";
import { resolveSceneAuthoringDocument } from "./sceneAuthoringDocument.js";
import { bindSceneBehaviorRecipes } from "./gameplayAuthoring.js";
import { resolveDataSceneInstanceComponents } from "./dataSceneComponents.js";
import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import type { FerrumEngine } from "./engineTypes.js";
import type { GameplayEntityHandle } from "./gameplayAuthoring.js";
import type { ResolvedSceneAuthoringDocument } from "./sceneAuthoringDocument.js";
import type { ResolvedSceneCompositionInstance } from "./sceneComposition.js";
import type { DataSceneRuntimeEngineAdapter } from "./dataSceneRuntimeTarget.js";

/** Match authored IDs/configuration only. Rust retains and restores all actual playback/LOD values. */
export function prepareDataSceneAuthoringContinuity(
  engine: FerrumEngine,
  document: ResolvedSceneAuthoringDocument,
  instances: readonly ResolvedSceneCompositionInstance[],
  adapter: DataSceneRuntimeEngineAdapter,
  path: string,
) {
  const begin = adapter.beginAuthoringContinuity?.bind(adapter);
  const finish = adapter.finishAuthoringContinuity?.bind(adapter);
  const cancel = adapter.cancelAuthoringContinuity?.bind(adapter);
  if (!begin || !finish || !cancel)
    throw sceneCompositionDiagnosticError(path, "preserving animation/LOD requires compatible Wasm");
  const previous = dataSceneAuthoringContinuityContext(engine);
  const oldDocument = resolveSceneAuthoringDocument(previous.document, { validateComponents: true, validateBindings: true });
  const oldInstances = new Map(bindSceneBehaviorRecipes(oldDocument.sceneComposition, oldDocument.behaviorRecipes).instances.map(instance => [instance.id, instance]));
  const ids: string[] = [], handles: number[] = [], masks: number[] = [];
  const animation = (instance: ResolvedSceneCompositionInstance) => {
    const components = resolveDataSceneInstanceComponents(instance, { allowTemplate: true });
    return components.mode === "inline" ? components.sprite.animationSet : undefined;
  };
  for (const instance of instances) {
    const old = oldInstances.get(instance.id), handle = previous.handles[instance.id];
    if (!old || !handle) continue;
    let mask = 0;
    const before = animation(old), after = animation(instance);
    if (before && after && JSON.stringify(before) === JSON.stringify(after)) mask |= 1;
    const oldModel = oldDocument.spatial?.models?.[instance.id], model = document.spatial?.models?.[instance.id];
    if (oldModel && model && oldModel.asset === model.asset && oldModel.contentId === model.contentId && JSON.stringify(oldModel.lods) === JSON.stringify(model.lods)) mask |= 2;
    if (mask) {
      ids.push(instance.id);
      handles.push(handle.entityId, handle.entityGeneration);
      masks.push(mask);
    }
  }
  const token = begin(Uint32Array.from(handles), Uint32Array.from(masks));
  if (!token) throw sceneCompositionDiagnosticError(path, "native animation/LOD capture rejected the handoff");
  return {
    restore(next: Readonly<Record<string, GameplayEntityHandle>>) {
      const handles = ids.flatMap(id => {
        const handle = next[id];
        if (!handle) throw sceneCompositionDiagnosticError(path, `missing reapplied instance ${id}`);
        return [handle.entityId, handle.entityGeneration];
      });
      if (!finish(token, Uint32Array.from(handles))) throw sceneCompositionDiagnosticError(path, "native animation/LOD restore rejected the handoff");
    },
    dispose() { cancel(token); },
  };
}
