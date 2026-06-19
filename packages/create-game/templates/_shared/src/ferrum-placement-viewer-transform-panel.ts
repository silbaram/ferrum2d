import {
  createAuthoringViewerMessage,
  createAuthoringViewerNumberControl,
} from "@ferrum2d/authoring-viewer";
import {
  saveScenePlacementPatch,
  snapSceneWorldPoint,
  type ResolvedSceneAuthoringDocument,
  type SceneAuthoringDocumentSpec,
  type SceneCompositionFragmentInstanceSpec,
  type ScenePlacementPatchSaveResult,
  type ScenePlacementTransform,
  type ScenePlacementViewer,
  type ScenePlacementViewerInstance,
  type ScenePlacementViewerState,
} from "@ferrum2d/ferrum-web/authoring";

export interface PlacementTransformPanelSettings {
  readonly memorySaveAdapterId: string;
  readonly snapGridSize: number;
}

interface PlacementTransformPanelSession {
  readonly document: SceneAuthoringDocumentSpec;
  readonly resolved: ResolvedSceneAuthoringDocument;
  readonly viewer: Pick<
    ScenePlacementViewer,
    | "addInstance"
    | "clearDraftPatch"
    | "exportPatch"
    | "removeInstance"
    | "renameInstance"
    | "updateBehaviorBinding"
    | "updateInstanceTransform"
  >;
}

export interface RenderPlacementTransformControlsOptions {
  readonly container: HTMLElement;
  readonly session: PlacementTransformPanelSession;
  readonly settings: PlacementTransformPanelSettings;
  readonly state: ScenePlacementViewerState;
  readonly onDocumentSaved: (document: SceneAuthoringDocumentSpec) => void;
  readonly onSaveResult: (result: ScenePlacementPatchSaveResult) => void;
  readonly render: () => void;
}

export function renderPlacementTransformControls(
  options: RenderPlacementTransformControlsOptions,
): void {
  const { container, session, settings, state, onDocumentSaved, onSaveResult, render } = options;
  const selected = state.selected;
  if (selected === undefined) {
    container.replaceChildren(createAuthoringViewerMessage({
      text: "No selection.",
      className: "placement-muted",
    }));
    return;
  }

  const grid = document.createElement("div");
  const actions = document.createElement("div");
  const renameInput = document.createElement("input");
  const renameButton = document.createElement("button");
  const duplicateButton = document.createElement("button");
  const removeButton = document.createElement("button");
  const saveButton = document.createElement("button");
  const clearButton = document.createElement("button");
  const behaviorRecipe = document.createElement("select");
  const attachBehaviorButton = document.createElement("button");
  const detachBehaviorButton = document.createElement("button");
  const behaviorRecipeIds = Object.keys(session.resolved.behaviorRecipes.entities);
  const transformInputs = {
    x: numberField("x", selected.transform.x),
    y: numberField("y", selected.transform.y),
    scale: numberField("scale", selected.transform.scale),
    rotationRadians: numberField("rotation", selected.transform.rotationRadians),
    layer: numberField("layer", selected.transform.layer),
  };

  grid.className = "placement-grid";
  actions.className = "placement-actions";
  renameInput.value = selected.instanceId;
  renameButton.type = "button";
  renameButton.textContent = "Rename";
  duplicateButton.type = "button";
  duplicateButton.textContent = "Duplicate";
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  saveButton.type = "button";
  saveButton.textContent = "Apply Memory";
  clearButton.type = "button";
  clearButton.textContent = "Clear Draft";
  behaviorRecipe.dataset.placementBehaviorRecipe = "true";
  behaviorRecipe.disabled = behaviorRecipeIds.length === 0;
  for (const recipeId of behaviorRecipeIds.length === 0 ? [""] : behaviorRecipeIds) {
    const option = document.createElement("option");
    option.value = recipeId;
    option.textContent = recipeId.length === 0 ? "no recipes" : recipeId;
    behaviorRecipe.append(option);
  }
  const selectedRecipe = selected.behaviorProfiles[0];
  if (selectedRecipe !== undefined && behaviorRecipeIds.includes(selectedRecipe)) {
    behaviorRecipe.value = selectedRecipe;
  }
  attachBehaviorButton.type = "button";
  attachBehaviorButton.textContent = "Attach Behavior";
  attachBehaviorButton.dataset.placementAction = "attach-behavior-binding";
  attachBehaviorButton.disabled = behaviorRecipeIds.length === 0;
  detachBehaviorButton.type = "button";
  detachBehaviorButton.textContent = "Detach Behavior";
  detachBehaviorButton.dataset.placementAction = "detach-behavior-binding";
  detachBehaviorButton.disabled = selected.behaviorProfiles.length === 0;

  for (const [key, field] of Object.entries(transformInputs)) {
    field.input.addEventListener("change", () => {
      const value = Number(field.input.value);
      if (!Number.isFinite(value)) return;
      session.viewer.updateInstanceTransform(selected.instanceId, {
        [key]: key === "layer" ? Math.trunc(value) : value,
      } as Partial<ScenePlacementTransform>);
      render();
    });
    grid.append(field.label);
  }

  actions.append(
    renameInput,
    renameButton,
    behaviorRecipe,
    attachBehaviorButton,
    detachBehaviorButton,
    duplicateButton,
    removeButton,
    saveButton,
    clearButton,
  );
  renameButton.addEventListener("click", () => {
    session.viewer.renameInstance(selected.instanceId, renameInput.value.trim());
    render();
  });
  duplicateButton.addEventListener("click", () => {
    const point = snapSceneWorldPoint({
      x: selected.transform.x + settings.snapGridSize,
      y: selected.transform.y + settings.snapGridSize,
    }, { gridSize: settings.snapGridSize });
    session.viewer.addInstance(state.fragment, {
      id: nextDuplicateId(state.instances, selected.instanceId),
      prefab: selected.prefab,
      ...(selected.variant === undefined ? {} : { variant: selected.variant }),
      x: point.x,
      y: point.y,
      scale: selected.transform.scale,
      rotationRadians: selected.transform.rotationRadians,
      layer: selected.transform.layer,
    } satisfies SceneCompositionFragmentInstanceSpec);
    render();
  });
  removeButton.addEventListener("click", () => {
    session.viewer.removeInstance(selected.instanceId);
    render();
  });
  attachBehaviorButton.addEventListener("click", () => {
    const recipeId = behaviorRecipe.value.trim();
    if (recipeId.length === 0) {
      return;
    }
    session.viewer.updateBehaviorBinding(
      { kind: "instance", instanceId: selected.instanceId },
      recipeId,
    );
    render();
  });
  detachBehaviorButton.addEventListener("click", () => {
    session.viewer.updateBehaviorBinding(
      { kind: "instance", instanceId: selected.instanceId },
      null,
    );
    render();
  });
  saveButton.addEventListener("click", async () => {
    const patch = session.viewer.exportPatch();
    if (patch === undefined) return;
    const result = await saveScenePlacementPatch(session.document, patch, {
      allowSave: true,
      adapter: {
        id: settings.memorySaveAdapterId,
        saveScenePlacementPatch: (request) => ({
          saved: true,
          document: request.mergedDocument,
        }),
      },
      allowedAdapterIds: [settings.memorySaveAdapterId],
      path: "placementViewer.memorySave",
    });
    onSaveResult(result);
    onDocumentSaved(result.document);
    render();
  });
  clearButton.addEventListener("click", () => {
    session.viewer.clearDraftPatch();
    render();
  });

  container.replaceChildren(grid, actions);
}

function numberField(labelText: string, value: number): { label: HTMLLabelElement; input: HTMLInputElement } {
  return createAuthoringViewerNumberControl({
    label: labelText,
    value,
    className: "placement-field",
    step: labelText === "layer" ? "1" : "0.1",
  });
}

function nextDuplicateId(instances: readonly ScenePlacementViewerInstance[], selectedId: string): string {
  const ids = new Set(instances.map((instance) => instance.instanceId));
  for (let index = 1; index < 1000; index += 1) {
    const id = `${selectedId}-copy-${index}`;
    if (!ids.has(id)) {
      return id;
    }
  }
  throw new Error(`Could not allocate a duplicate id for ${selectedId}.`);
}
