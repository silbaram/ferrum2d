import {
  createScenePlacementViewer,
  createScenePlacementViewport,
  dataSceneObjectVisualBounds,
  resolveDataSceneInstanceComponents,
  resolveSceneAuthoringDocument,
  worldToSceneScreen,
  type ResolvedSceneAuthoringDocument,
  type ResolvedSceneCompositionInstance,
  type SceneAuthoringDocumentSpec,
  type ScenePlacementAssetProvider,
  type ScenePlacementPoint,
  type ScenePlacementTransform,
  type ScenePlacementViewer,
  type ScenePlacementViewerInstance,
  type ScenePlacementViewerState,
} from "@ferrum2d/ferrum-web/authoring";

export interface PlacementStageSessionSettings {
  readonly defaultObjectSize: number;
  readonly defaultStageWidth: number;
  readonly defaultStageHeight: number;
}

export interface PlacementBounds {
  readonly width: number;
  readonly height: number;
}

export interface PlacementSession {
  readonly document: SceneAuthoringDocumentSpec;
  readonly resolved: ResolvedSceneAuthoringDocument;
  readonly viewer: ScenePlacementViewer;
  readonly assetProvider: ScenePlacementAssetProvider;
  readonly boundsBySourceId: ReadonlyMap<string, PlacementBounds>;
}

type PlacementViewportInstance =
  | { x: number; y: number }
  | { transform: Pick<ScenePlacementTransform, "x" | "y"> };

export function createPlacementSession(
  documentSpec: SceneAuthoringDocumentSpec,
  stage: HTMLElement,
  assetProvider: ScenePlacementAssetProvider,
  settings: PlacementStageSessionSettings,
): PlacementSession {
  const resolved = resolveSceneAuthoringDocument(documentSpec, {
    path: "placementViewer.document",
    validateBindings: true,
    missingBehavior: "ignore",
  });
  const instances = resolved.bindingPlan?.instances ?? [];
  const boundsBySourceId = boundsByInstanceId(instances, settings);
  const selectedInstanceId = instances[0]?.id;
  const viewer = createScenePlacementViewer({
    sceneComposition: resolved.sceneComposition,
    viewport: viewportForStage(stage, instances, settings),
    ...(selectedInstanceId === undefined ? {} : { selectedInstanceId }),
    path: "placementViewer.viewer",
  });
  return {
    document: documentSpec,
    resolved,
    viewer,
    assetProvider,
    boundsBySourceId,
  };
}

export function selectPlacementInstanceAtPointer(
  stage: HTMLElement,
  session: PlacementSession,
  event: PointerEvent,
): void {
  session.viewer.selectInstanceAtScreen(pointerPoint(stage, event));
}

export function updatePlacementViewportForStage(
  stage: HTMLElement,
  session: PlacementSession,
  settings: PlacementStageSessionSettings,
): void {
  session.viewer.updateViewport(viewportForStage(stage, session.viewer.state().instances, settings));
}

export function renderPlacementStage(
  stage: HTMLElement,
  session: PlacementSession,
  state: ScenePlacementViewerState,
  render: () => void,
  settings: PlacementStageSessionSettings,
): void {
  const fragment = document.createDocumentFragment();
  if (state.instances.length === 0) {
    const empty = document.createElement("div");
    empty.className = "placement-empty";
    empty.textContent = "No scene instances.";
    fragment.append(empty);
  }

  for (const instance of state.instances) {
    const bounds = boundsForInstance(session, instance, settings);
    const point = worldToSceneScreen(state.viewport, instance.transform);
    const width = Math.max(26, bounds.width * state.viewport.zoom);
    const height = Math.max(26, bounds.height * state.viewport.zoom);
    const button = document.createElement("button");
    const label = document.createElement("span");
    button.type = "button";
    button.className = "placement-object";
    button.dataset.role = instance.role;
    button.dataset.selected = String(instance.instanceId === state.selectedInstanceId);
    button.style.left = `${point.x - width * 0.5}px`;
    button.style.top = `${point.y - height * 0.5}px`;
    button.style.width = `${width}px`;
    button.style.height = `${height}px`;
    label.textContent = instance.instanceId;
    button.append(label);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      session.viewer.selectInstance(instance.instanceId);
      render();
    });
    fragment.append(button);
  }
  stage.replaceChildren(fragment);
}

export function renderPlacementInstanceList(
  container: HTMLElement,
  session: PlacementSession,
  state: ScenePlacementViewerState,
  render: () => void,
): void {
  const fragment = document.createDocumentFragment();
  for (const instance of state.instances) {
    const button = document.createElement("button");
    const name = document.createElement("span");
    const role = document.createElement("span");
    button.type = "button";
    button.dataset.selected = String(instance.instanceId === state.selectedInstanceId);
    name.textContent = instance.instanceId;
    role.className = "placement-muted";
    role.textContent = instance.role;
    button.append(name, role);
    button.addEventListener("click", () => {
      session.viewer.selectInstance(instance.instanceId);
      render();
    });
    fragment.append(button);
  }
  container.replaceChildren(fragment);
}

function boundsByInstanceId(
  instances: readonly ResolvedSceneCompositionInstance[],
  settings: PlacementStageSessionSettings,
): Map<string, PlacementBounds> {
  const bounds = new Map<string, PlacementBounds>();
  for (const instance of instances) {
    bounds.set(instance.id, boundsForResolvedInstance(instance, settings));
  }
  return bounds;
}

function boundsForResolvedInstance(
  instance: ResolvedSceneCompositionInstance,
  settings: PlacementStageSessionSettings,
): PlacementBounds {
  if (!("components" in instance.props)) {
    return fallbackBounds(settings);
  }
  try {
    const components = resolveDataSceneInstanceComponents(instance, {
      allowTemplate: false,
      path: `placementViewer.instances.${instance.id}`,
    });
    if (components.mode === "inline") {
      const visualBounds = dataSceneObjectVisualBounds(components);
      return {
        width: Math.max(1, visualBounds.width * instance.scale),
        height: Math.max(1, visualBounds.height * instance.scale),
      };
    }
  } catch {
    return fallbackBounds(settings);
  }
  return fallbackBounds(settings);
}

function boundsForInstance(
  session: PlacementSession,
  instance: ScenePlacementViewerInstance,
  settings: PlacementStageSessionSettings,
): PlacementBounds {
  if (instance.visual !== undefined) {
    return {
      width: instance.visual.bounds.width,
      height: instance.visual.bounds.height,
    };
  }
  return session.boundsBySourceId.get(instance.sourceId) ?? fallbackBounds(settings);
}

function fallbackBounds(settings: PlacementStageSessionSettings): PlacementBounds {
  return {
    width: settings.defaultObjectSize,
    height: settings.defaultObjectSize,
  };
}

function viewportForStage(
  stage: HTMLElement,
  instances: readonly PlacementViewportInstance[],
  settings: PlacementStageSessionSettings,
) {
  const rect = stage.getBoundingClientRect();
  const cssWidth = Math.max(320, rect.width || settings.defaultStageWidth);
  const cssHeight = Math.max(320, rect.height || settings.defaultStageHeight);
  const center = sceneCenter(instances);
  return createScenePlacementViewport({
    cssWidth,
    cssHeight,
    cameraX: center.x,
    cameraY: center.y,
    zoom: 1,
  });
}

function sceneCenter(
  instances: readonly PlacementViewportInstance[],
): ScenePlacementPoint {
  if (instances.length === 0) {
    return { x: 0, y: 0 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const instance of instances) {
    const point = "transform" in instance ? instance.transform : instance;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: (minX + maxX) * 0.5,
    y: (minY + maxY) * 0.5,
  };
}

function pointerPoint(stage: HTMLElement, event: PointerEvent): ScenePlacementPoint {
  const rect = stage.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}
