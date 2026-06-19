import {
  createScenePlacementAgentHandoff,
  type SceneCompositionFragmentInstanceSpec,
  type ScenePlacementAssetDiagnostic,
  type ScenePlacementBehaviorBindingPatch,
  type ScenePlacementBehaviorBindingTarget,
  type ScenePlacementPatch,
  type ScenePlacementPatchSaveResult,
  type ScenePlacementViewer,
  type ScenePlacementViewerState,
} from "@ferrum2d/ferrum-web/authoring";
import type { PlacementSession } from "./ferrum-placement-viewer-stage-session";

interface ConsumerPlacementViewerWindow extends Window {
  __ferrumConsumerPlacementViewer?: {
    state(): ScenePlacementViewerState;
    exportPatch(): ScenePlacementPatch | undefined;
    selectInstance(instanceId?: string): ScenePlacementViewerState;
    addObjectDefinition(
      definitionId: string,
      definition: Parameters<ScenePlacementViewer["addObjectDefinition"]>[1],
    ): ScenePlacementViewerState;
    addInstance(fragment: string, instance: SceneCompositionFragmentInstanceSpec): ScenePlacementViewerState;
    updateBehaviorBinding(
      target: ScenePlacementBehaviorBindingTarget,
      behaviorRecipes: ScenePlacementBehaviorBindingPatch,
    ): ScenePlacementViewerState;
  };
  ferrumConsumerPlacementViewerState?: ScenePlacementViewerState;
  ferrumConsumerPlacementViewerPatch?: ScenePlacementPatch;
  ferrumConsumerPlacementViewerSaveResult?: ScenePlacementPatchSaveResult;
  ferrumConsumerPlacementViewerProjectAssets?: readonly string[];
}

export interface RenderPlacementAgentOutputsOptions {
  readonly handoff: HTMLTextAreaElement;
  readonly patchOutput: HTMLTextAreaElement;
  readonly session: PlacementSession;
  readonly state: ScenePlacementViewerState;
  readonly draftPatch: ScenePlacementPatch | undefined;
  readonly sourceDocument: string;
}

export function publishPlacementViewer(viewer: ScenePlacementViewer): void {
  const target = window as ConsumerPlacementViewerWindow;
  target.__ferrumConsumerPlacementViewer = {
    state: () => viewer.state(),
    exportPatch: () => viewer.exportPatch(),
    selectInstance: (instanceId) => viewer.selectInstance(instanceId),
    addObjectDefinition: (definitionId, definition) => viewer.addObjectDefinition(definitionId, definition),
    addInstance: (fragment, instance) => viewer.addInstance(fragment, instance),
    updateBehaviorBinding: (target, behaviorRecipes) => viewer.updateBehaviorBinding(target, behaviorRecipes),
  };
}

export function publishPlacementState(state: ScenePlacementViewerState): void {
  const target = window as ConsumerPlacementViewerWindow;
  target.ferrumConsumerPlacementViewerState = state;
  target.ferrumConsumerPlacementViewerPatch = state.draftPatch;
}

export function publishPlacementSaveResult(result: ScenePlacementPatchSaveResult): void {
  (window as ConsumerPlacementViewerWindow).ferrumConsumerPlacementViewerSaveResult = result;
}

export function renderPlacementAgentOutputs(options: RenderPlacementAgentOutputsOptions): void {
  const { handoff, patchOutput, session, state, draftPatch, sourceDocument } = options;
  handoff.value = JSON.stringify(createScenePlacementAgentHandoff({
    document: session.document,
    state,
    patch: draftPatch,
    sourceDocument,
    assetDiagnostics: placementAssetDiagnosticsForState(state, session),
    path: "placementViewer.bindingMigration",
  }), null, 2);
  patchOutput.value = draftPatch === undefined ? "" : JSON.stringify(draftPatch, null, 2);
  publishPlacementProjectAssets(session);
}

function publishPlacementProjectAssets(session: PlacementSession): void {
  (window as ConsumerPlacementViewerWindow).ferrumConsumerPlacementViewerProjectAssets =
    session.assetProvider.listSpriteAssets().map((asset) => asset.id);
}

function placementAssetDiagnosticsForState(
  state: ScenePlacementViewerState,
  session: PlacementSession,
): readonly ScenePlacementAssetDiagnostic[] {
  const diagnostics: ScenePlacementAssetDiagnostic[] = [];
  for (const instance of state.instances) {
    const visual = instance.visual;
    if (visual?.kind !== "sprite" || visual.texture.kind !== "asset") {
      continue;
    }
    diagnostics.push(...session.assetProvider.diagnoseSpriteAssetReference({
      asset: visual.texture.name ?? String(visual.texture.value),
      path: `placementViewer.instances.${instance.instanceId}.visual.asset`,
    }));
  }
  return diagnostics;
}
