import type { ScenePlacementViewerInstance, ScenePlacementViewerState } from "@ferrum2d/ferrum-web/authoring";

export const placementRenderLayer = (instance: ScenePlacementViewerInstance) =>
  instance.visual?.kind === "sprite" ? instance.visual.layer ?? instance.transform.layer : instance.transform.layer;

/** Per-document presentation state, retained when saving rebuilds the inspector. */
export interface PlacementLayerViewState {
  active?: number;
  solo?: number;
  beforeSolo: readonly number[];
}

/** Classify once per sync instead of rescanning all instances for each layer row. */
export function placementLayerGroups(state: ScenePlacementViewerState) {
  const selected = new Set(state.selectedInstanceIds), locked = new Set(state.lockedInstanceIds);
  const groups = new Map<number, { ids: string[]; selected: boolean; locked: boolean }>();
  for (const instance of state.instances) {
    const layer = placementRenderLayer(instance);
    let group = groups.get(layer);
    if (!group) { group = { ids: [], selected: false, locked: false }; groups.set(layer, group); }
    group.ids.push(instance.instanceId);
    group.selected ||= selected.has(instance.instanceId);
    group.locked ||= locked.has(instance.instanceId);
  }
  return groups;
}

/** Reconcile isolation after an edit introduces/removes a numeric layer. */
export function placementSoloPolicy(state: ScenePlacementViewerState, view: PlacementLayerViewState) {
  if (view.solo === undefined) return undefined;
  const layers = new Set(state.instances.map(placementRenderLayer));
  const hiddenLayers = layers.has(view.solo) ? [...layers].filter(layer => layer !== view.solo) : [...view.beforeSolo];
  if (!layers.has(view.solo)) view.solo = undefined;
  const current = state.layerEditing ?? { hiddenLayers: [], lockedLayers: [] };
  const hidden = new Set(current.hiddenLayers);
  return hiddenLayers.length === hidden.size && hiddenLayers.every(layer => hidden.has(layer))
    ? undefined : { ...current, hiddenLayers };
}
