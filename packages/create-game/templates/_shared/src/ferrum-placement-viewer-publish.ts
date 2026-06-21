import {
  createScenePlacementAgentHandoff,
  type ScenePlacementAgentHandoff,
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
  ferrumConsumerPlacementViewerAgentHandoff?: ScenePlacementAgentHandoff;
  ferrumConsumerPlacementViewerSaveResult?: ScenePlacementPatchSaveResult;
  ferrumConsumerPlacementViewerProjectAssets?: readonly string[];
}

export interface PlacementHandoffControlsState {
  readonly draftPatch: ScenePlacementPatch | undefined;
  readonly handoff: ScenePlacementAgentHandoff;
  readonly saveEnabled: boolean;
  readonly onSaveDraft: () => Promise<void>;
}

export interface PlacementHandoffControls {
  readonly element: HTMLElement;
  setState(state: PlacementHandoffControlsState): void;
}

export interface RenderPlacementAgentOutputsOptions {
  readonly handoff: HTMLTextAreaElement;
  readonly patchOutput: HTMLTextAreaElement;
  readonly handoffControls: PlacementHandoffControls;
  readonly session: PlacementSession;
  readonly state: ScenePlacementViewerState;
  readonly draftPatch: ScenePlacementPatch | undefined;
  readonly sourceDocument: string;
  readonly onSaveDraft: () => Promise<void>;
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

export function createPlacementHandoffControls(): PlacementHandoffControls {
  const element = document.createElement("section");
  const actions = document.createElement("div");
  const copyPatch = document.createElement("button");
  const copyHandoff = document.createElement("button");
  const saveDraft = document.createElement("button");
  const status = document.createElement("p");
  let lastDraftPatch: ScenePlacementPatch | undefined;
  let lastHandoff: ScenePlacementAgentHandoff | undefined;
  let lastSaveDraft: (() => Promise<void>) | undefined;

  element.className = "placement-handoff-controls";
  actions.className = "placement-handoff-actions";
  status.className = "placement-handoff-status";
  status.dataset.status = "idle";
  copyPatch.type = "button";
  copyPatch.textContent = "Copy Patch";
  copyPatch.dataset.placementAction = "copy-patch";
  copyHandoff.type = "button";
  copyHandoff.textContent = "Copy Handoff";
  copyHandoff.dataset.placementAction = "copy-handoff";
  saveDraft.type = "button";
  saveDraft.textContent = "Save Draft";
  saveDraft.dataset.placementAction = "save-draft";

  actions.append(copyPatch, copyHandoff, saveDraft);
  element.append(actions, status);

  const setStatus = (message: string, kind: "idle" | "success" | "blocked" | "error"): void => {
    status.textContent = message;
    status.dataset.status = kind;
  };
  const copyJson = async (kind: "patch" | "handoff"): Promise<void> => {
    const value = kind === "patch" ? lastDraftPatch : lastHandoff;
    if (value === undefined) {
      setStatus(kind === "patch" ? "No draft patch to copy" : "No handoff payload yet", "blocked");
      return;
    }
    try {
      await copyPlacementText(JSON.stringify(value, null, 2));
      setStatus(kind === "patch" ? "Patch copied" : "Handoff copied", "success");
    } catch (error) {
      setStatus(placementErrorMessage(error), "error");
    }
  };

  copyPatch.addEventListener("click", () => {
    void copyJson("patch");
  });
  copyHandoff.addEventListener("click", () => {
    void copyJson("handoff");
  });
  saveDraft.addEventListener("click", () => {
    if (saveDraft.disabled || lastSaveDraft === undefined) {
      return;
    }
    void (async () => {
      try {
        setStatus("Saving draft", "idle");
        await lastSaveDraft();
        setStatus("Draft saved", "success");
      } catch (error) {
        setStatus(placementErrorMessage(error), "error");
      }
    })();
  });

  return {
    element,
    setState(state) {
      lastDraftPatch = state.draftPatch;
      lastHandoff = state.handoff;
      lastSaveDraft = state.onSaveDraft;
      const draftCount = state.draftPatch?.operations.length ?? 0;
      const blockedCount = state.handoff.migrationPreview?.references.length ?? 0;
      const assetDiagnosticCount = state.handoff.assetDiagnostics.length;
      copyPatch.disabled = draftCount === 0;
      copyHandoff.disabled = false;
      saveDraft.disabled = draftCount === 0 || !state.saveEnabled || blockedCount > 0;
      saveDraft.dataset.blockedByReferences = String(blockedCount > 0);
      element.dataset.draftCount = String(draftCount);
      element.dataset.blockedReferenceCount = String(blockedCount);
      element.dataset.assetDiagnosticCount = String(assetDiagnosticCount);
      if (blockedCount > 0) {
        setStatus(`${blockedCount} blocked reference${blockedCount === 1 ? "" : "s"}`, "blocked");
      } else if (draftCount > 0) {
        setStatus(`${draftCount} patch operation${draftCount === 1 ? "" : "s"} ready`, "idle");
      } else {
        setStatus("No draft patch", "idle");
      }
    },
  };
}

export function renderPlacementAgentOutputs(options: RenderPlacementAgentOutputsOptions): void {
  const { handoff, patchOutput, handoffControls, session, state, draftPatch, sourceDocument, onSaveDraft } = options;
  const assetDiagnostics = placementAssetDiagnosticsForState(state, session);
  const handoffPayload = createScenePlacementAgentHandoff({
    document: session.document,
    state,
    patch: draftPatch,
    sourceDocument,
    assetDiagnostics,
    path: "placementViewer.bindingMigration",
  });
  handoff.value = JSON.stringify(handoffPayload, null, 2);
  patchOutput.value = draftPatch === undefined ? "" : JSON.stringify(draftPatch, null, 2);
  publishPlacementAgentHandoff(handoffPayload);
  publishPlacementProjectAssets(session);
  handoffControls.setState({
    draftPatch,
    handoff: handoffPayload,
    saveEnabled: true,
    onSaveDraft,
  });
}

function publishPlacementAgentHandoff(handoff: ScenePlacementAgentHandoff): void {
  (window as ConsumerPlacementViewerWindow).ferrumConsumerPlacementViewerAgentHandoff = handoff;
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

async function copyPlacementText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.left = "-10000px";
  textarea.style.top = "0";
  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  active?.focus();
  if (!copied) {
    throw new Error("Clipboard copy failed");
  }
}

function placementErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown placement viewer error";
}
