import { dataSceneAuthoringContinuityContext, type DataSceneAuthoringContinuityMetadata } from "./dataSceneProgress.js";
import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import type { FerrumEngine } from "./engineTypes.js";
import type { GameplayEntityHandle } from "./gameplayAuthoring.js";
import type { ResolvedSceneCompositionInstance } from "./sceneComposition.js";
import type { DataSceneRuntimeEngineAdapter } from "./dataSceneRuntimeTarget.js";

function entry<T>(values: Readonly<Record<string, T>> | undefined, id: string): T | undefined {
  return values && Object.prototype.hasOwnProperty.call(values, id) ? values[id] : undefined;
}

/** Match authored IDs/configuration only. Rust retains and restores all actual playback/LOD values. */
export function prepareDataSceneAuthoringContinuity(
  engine: FerrumEngine,
  metadata: DataSceneAuthoringContinuityMetadata,
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
  const ids: string[] = [], handles: number[] = [], masks: number[] = [];
  for (const instance of instances) {
    const handle = entry(previous.handles, instance.id);
    if (!handle) continue;
    let mask = 0;
    const before = entry(previous.metadata.animations, instance.id), after = entry(metadata.animations, instance.id);
    if (before && after && JSON.stringify(before) === JSON.stringify(after)) mask |= 1;
    const oldModel = entry(previous.metadata.models, instance.id), model = entry(metadata.models, instance.id);
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
