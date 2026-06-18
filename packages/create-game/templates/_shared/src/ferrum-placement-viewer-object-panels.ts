import {
  appendAuthoringViewerKeyValueRow,
  createAuthoringViewerActionButton,
  createAuthoringViewerMessage,
  createAuthoringViewerSummaryCard,
  formatAuthoringViewerBehaviorProfiles,
} from "@ferrum2d/authoring-viewer";
import {
  snapSceneWorldPoint,
  type ResolvedDataSceneColliderComponent,
  type ResolvedDataSceneObjectVisual,
  type ResolvedDataSceneSpriteFrame,
  type ResolvedSceneAuthoringDocument,
  type SceneCompositionFragmentInstanceSpec,
  type SceneCompositionJsonValue,
  type ScenePlacementAssetProvider,
  type ScenePlacementObjectDefinitionSummary,
  type ScenePlacementPoint,
  type ScenePlacementSpriteAsset,
  type ScenePlacementSpriteFrameAsset,
  type ScenePlacementViewer,
  type ScenePlacementViewerInstance,
  type ScenePlacementViewerState,
} from "@ferrum2d/ferrum-web/authoring";

interface PlacementBounds {
  readonly width: number;
  readonly height: number;
}

type PlacementJsonValue = SceneCompositionJsonValue;
type PlacementJsonObject = Record<string, SceneCompositionJsonValue>;

export interface PlacementObjectPanelOptions {
  readonly objectPrefabId: string;
  readonly snapGridSize: number;
  readonly defaultObjectSize: number;
}

interface PlacementObjectPanelSession {
  readonly resolved: ResolvedSceneAuthoringDocument;
  readonly viewer: Pick<ScenePlacementViewer, "state" | "addObjectDefinition" | "addInstance">;
  readonly assetProvider: ScenePlacementAssetProvider;
}

export function renderPlacementDetails(
  container: HTMLElement,
  state: ScenePlacementViewerState,
): void {
  const selected = state.selected;
  if (selected === undefined) {
    container.replaceChildren(createAuthoringViewerMessage({
      text: "Select an instance.",
      className: "placement-muted",
    }));
    return;
  }

  const list = document.createElement("dl");
  list.className = "placement-kv";
  appendAuthoringViewerKeyValueRow(list, "id", selected.instanceId);
  appendAuthoringViewerKeyValueRow(list, "prefab", selected.prefab);
  appendAuthoringViewerKeyValueRow(list, "role", selected.role);
  appendAuthoringViewerKeyValueRow(list, "visual", placementVisualLabel(selected));
  appendAuthoringViewerKeyValueRow(list, "collider", placementColliderLabel(selected));
  appendAuthoringViewerKeyValueRow(list, "profiles", formatAuthoringViewerBehaviorProfiles(selected.behaviorProfiles, {
    emptyLabel: "none",
  }));
  appendAuthoringViewerKeyValueRow(list, "entity", selected.entity === undefined
    ? "not resolved"
    : `${selected.entity.entityId}:${selected.entity.entityGeneration}`);
  container.replaceChildren(list);
}

export function renderObjectDefinitions(
  container: HTMLElement,
  session: PlacementObjectPanelSession,
  state: ScenePlacementViewerState,
  render: () => void,
  options: PlacementObjectPanelOptions,
): void {
  const selected = state.selected;
  const fragment = document.createDocumentFragment();
  const createRow = document.createElement("div");
  const definitionInput = document.createElement("input");
  const reusableDefinitions = reusableObjectDefinitions(state, options);

  createRow.className = "placement-definition-create";
  definitionInput.type = "text";
  definitionInput.placeholder = "definition id";
  definitionInput.dataset.placementDefinitionId = "true";
  definitionInput.value = selected === undefined ? "" : nextObjectDefinitionId(state, selected.instanceId);
  definitionInput.disabled = selected === undefined;
  const createButton = createAuthoringViewerActionButton({
    label: "Create Definition",
    disabled: selected?.visual === undefined,
    dataset: { placementAction: "create-object-definition" },
    onClick: () => {
      const definitionId = definitionInput.value.trim();
      const currentSelected = session.viewer.state().selected;
      if (currentSelected === undefined || definitionId.length === 0) {
        return;
      }
      session.viewer.addObjectDefinition(definitionId, placementObjectDefinitionFromSelected(currentSelected));
      render();
    },
  });
  createRow.append(definitionInput, createButton);
  fragment.append(createRow);

  if (reusableDefinitions.length === 0) {
    fragment.append(createAuthoringViewerMessage({
      text: "No reusable object definitions.",
      className: "placement-muted",
    }));
  }

  for (const definition of reusableDefinitions) {
    fragment.append(createAuthoringViewerSummaryCard({
      title: definition.id,
      meta: objectDefinitionMetaLabel(definition),
      className: "placement-definition-card",
      metaClassName: "placement-muted",
      dataset: { definitionId: definition.id },
      action: {
        label: "Add",
        className: "placement-definition-add",
        onClick: () => {
          addObjectDefinitionInstance(session, state, definition.id, options);
          render();
        },
      },
    }));
  }

  container.replaceChildren(fragment);
}

export function renderProjectAssets(
  container: HTMLElement,
  session: PlacementObjectPanelSession,
  state: ScenePlacementViewerState,
  render: () => void,
  options: PlacementObjectPanelOptions,
): void {
  const assets = session.assetProvider.listSpriteAssets();
  const canAddObject = hasObjectPrefab(session, options);
  const fragment = document.createDocumentFragment();
  if (assets.length === 0) {
    fragment.append(createAuthoringViewerMessage({
      text: "No project sprite assets.",
      className: "placement-muted",
    }));
  }
  if (!canAddObject) {
    fragment.append(createAuthoringViewerMessage({
      text: `Add Sprite requires the '${options.objectPrefabId}' prefab.`,
      className: "placement-muted",
    }));
  }
  for (const asset of assets) {
    const frames = session.assetProvider.listSpriteFrames(asset.id);
    const children: HTMLElement[] = [];
    if (asset.thumbnailUrl !== undefined) {
      const preview = document.createElement("div");
      preview.className = "placement-asset-thumb";
      preview.style.backgroundImage = `url("${asset.thumbnailUrl}")`;
      children.push(preview);
    }
    if (frames.length > 0) {
      const frameList = document.createElement("div");
      frameList.className = "placement-asset-frames";
      for (const frame of frames.slice(0, 8)) {
        frameList.append(createAuthoringViewerActionButton({
          label: frame.label ?? frame.id,
          disabled: !canAddObject,
          dataset: { frameId: frame.id },
          onClick: () => {
            addProjectSpriteInstance(session, state, asset.id, options, frame.id);
            render();
          },
        }));
      }
      if (frames.length > 8) {
        const more = document.createElement("span");
        more.textContent = `+${frames.length - 8}`;
        frameList.append(more);
      }
      children.push(frameList);
    }
    fragment.append(createAuthoringViewerSummaryCard({
      title: asset.label ?? asset.id,
      meta: assetSizeLabel(asset.width, asset.height, frames.length),
      className: "placement-asset-card",
      metaClassName: "placement-muted",
      dataset: { assetId: asset.id },
      action: {
        label: "Add",
        className: "placement-asset-add",
        disabled: !canAddObject,
        onClick: () => {
          addProjectSpriteInstance(session, state, asset.id, options);
          render();
        },
      },
      children,
    }));
  }
  container.replaceChildren(fragment);
}

function reusableObjectDefinitions(
  state: ScenePlacementViewerState,
  options: PlacementObjectPanelOptions,
): readonly ScenePlacementObjectDefinitionSummary[] {
  return state.objectDefinitions.filter((definition) =>
    definition.id !== options.objectPrefabId
    && definition.hasDataSceneComponents
    && definition.visual !== undefined
  );
}

function objectDefinitionMetaLabel(definition: ScenePlacementObjectDefinitionSummary): string {
  const visual = definition.visual === undefined ? "visual none" : placementVisualSummary(definition.visual);
  const collider = definition.collider === undefined ? "collider none" : placementColliderSummary(definition.collider);
  const behaviorProfiles = formatAuthoringViewerBehaviorProfiles(definition.behaviorProfiles, {
    emptyLabel: "",
  });
  const behavior = behaviorProfiles.length === 0
    ? ""
    : ` | behavior ${behaviorProfiles}`;
  return `${visual} | ${collider}${behavior}`;
}

function addObjectDefinitionInstance(
  session: PlacementObjectPanelSession,
  state: ScenePlacementViewerState,
  definitionId: string,
  options: PlacementObjectPanelOptions,
): void {
  const point = placementAddPoint(state, options);
  session.viewer.addInstance(state.fragment, {
    id: nextObjectDefinitionInstanceId(state.instances, definitionId),
    prefab: definitionId,
    x: point.x,
    y: point.y,
    layer: state.selected?.transform.layer ?? 0,
  });
}

function placementObjectDefinitionFromSelected(
  selected: ScenePlacementViewerInstance,
): Parameters<ScenePlacementViewer["addObjectDefinition"]>[1] {
  if (selected.visual === undefined) {
    throw new Error("object definition creation requires selected visual components.");
  }
  return {
    props: {
      components: {
        visual: placementVisualPatchFromResolved(selected.visual),
        collider: selected.collider === undefined
          ? "none"
          : placementColliderPatchFromResolved(selected.collider),
        layer: selected.componentLayer?.name ?? "wall",
      },
    },
  };
}

function addProjectSpriteInstance(
  session: PlacementObjectPanelSession,
  state: ScenePlacementViewerState,
  assetId: string,
  options: PlacementObjectPanelOptions,
  frameId?: string,
): void {
  const asset = session.assetProvider.resolveSpriteAsset(assetId);
  if (asset === undefined) {
    return;
  }
  const frame = frameId === undefined
    ? undefined
    : session.assetProvider.resolveSpriteFrame(assetId, frameId);
  const point = placementAddPoint(state, options);
  const size = spritePlacementSize(asset, frame, options);
  const instance: SceneCompositionFragmentInstanceSpec = {
    id: nextProjectSpriteId(state.instances, frame?.id ?? asset.id),
    prefab: options.objectPrefabId,
    x: point.x,
    y: point.y,
    layer: state.selected?.transform.layer ?? 0,
    props: projectSpriteInstanceProps(asset.id, size, frame),
  };
  session.viewer.addInstance(state.fragment, instance);
}

function projectSpriteInstanceProps(
  assetId: string,
  size: PlacementBounds,
  frame: ScenePlacementSpriteFrameAsset | undefined,
): Record<string, SceneCompositionJsonValue> {
  const visual: Record<string, SceneCompositionJsonValue> = {
    kind: "sprite",
    asset: assetId,
    width: size.width,
    height: size.height,
    originX: 0.5,
    originY: 0.5,
  };
  if (frame?.frame !== undefined) {
    visual.frame = {
      u0: frame.frame.u0,
      v0: frame.frame.v0,
      u1: frame.frame.u1,
      v1: frame.frame.v1,
    };
  }
  return {
    components: {
      visual,
      collider: {
        type: "aabb",
        halfWidth: size.width * 0.5,
        halfHeight: size.height * 0.5,
      },
      layer: "wall",
    },
  };
}

function spritePlacementSize(
  asset: ScenePlacementSpriteAsset,
  frame: ScenePlacementSpriteFrameAsset | undefined,
  options: PlacementObjectPanelOptions,
): PlacementBounds {
  return {
    width: frame?.width ?? asset.width ?? options.defaultObjectSize,
    height: frame?.height ?? asset.height ?? options.defaultObjectSize,
  };
}

function placementAddPoint(
  state: ScenePlacementViewerState,
  options: PlacementObjectPanelOptions,
): ScenePlacementPoint {
  const selected = state.selected;
  const base = selected === undefined
    ? { x: state.viewport.cameraX, y: state.viewport.cameraY }
    : {
        x: selected.transform.x + options.snapGridSize,
        y: selected.transform.y + options.snapGridSize,
      };
  return snapSceneWorldPoint(base, { gridSize: options.snapGridSize });
}

function hasObjectPrefab(
  session: PlacementObjectPanelSession,
  options: PlacementObjectPanelOptions,
): boolean {
  return session.resolved.sceneComposition.prefabs[options.objectPrefabId] !== undefined;
}

function nextObjectDefinitionId(
  state: ScenePlacementViewerState,
  instanceId: string,
): string {
  const existing = new Set(state.objectDefinitions.map((definition) => definition.id));
  const base = `${placementIdPart(instanceId)}-definition`;
  if (!existing.has(base)) {
    return base;
  }
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
}

function nextObjectDefinitionInstanceId(
  instances: readonly ScenePlacementViewerInstance[],
  definitionId: string,
): string {
  const ids = new Set(instances.map((instance) => instance.instanceId));
  const base = `object-${placementIdPart(definitionId)}`;
  for (let index = 1; index < 1000; index += 1) {
    const id = `${base}-${index}`;
    if (!ids.has(id)) {
      return id;
    }
  }
  throw new Error(`Could not allocate an object id for ${definitionId}.`);
}

function nextProjectSpriteId(
  instances: readonly ScenePlacementViewerInstance[],
  sourceId: string,
): string {
  const ids = new Set(instances.map((instance) => instance.instanceId));
  const base = `sprite-${placementIdPart(sourceId)}`;
  for (let index = 1; index < 1000; index += 1) {
    const id = `${base}-${index}`;
    if (!ids.has(id)) {
      return id;
    }
  }
  throw new Error(`Could not allocate a sprite id for ${sourceId}.`);
}

function placementIdPart(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length === 0 ? "asset" : normalized;
}

function assetSizeLabel(width: number | undefined, height: number | undefined, frameCount: number): string {
  const size = width === undefined || height === undefined ? "size unknown" : `${width}x${height}`;
  return `${size} | ${frameCount} frames`;
}

function placementVisualLabel(instance: ScenePlacementViewerInstance): string {
  const visual = instance.visual;
  if (visual === undefined) {
    return "none";
  }
  return placementVisualSummary(visual);
}

function placementVisualSummary(visual: ResolvedDataSceneObjectVisual): string {
  if (visual.kind === "primitive") {
    return `${visual.shape} ${visual.bounds.width}x${visual.bounds.height}`;
  }
  const texture = visual.texture.kind === "asset"
    ? visual.texture.name ?? String(visual.texture.value)
    : `#${visual.texture.id ?? visual.texture.value}`;
  return `${texture} ${visual.bounds.width}x${visual.bounds.height}`;
}

function placementVisualPatchFromResolved(
  visual: ResolvedDataSceneObjectVisual,
): PlacementJsonObject {
  if (visual.kind === "primitive") {
    const base: PlacementJsonObject = {
      kind: "primitive",
      shape: visual.shape,
      ...(visual.color === undefined ? {} : { color: visual.color }),
    };
    if (visual.shape === "circle") {
      return {
        ...base,
        radius: visual.radius ?? visual.width * 0.5,
      };
    }
    if (visual.shape === "point") {
      return {
        ...base,
        width: visual.width,
      };
    }
    return {
      ...base,
      width: visual.width,
      height: visual.height,
    };
  }
  const texture = visual.texture.kind === "asset"
    ? { asset: visual.texture.name ?? String(visual.texture.value) }
    : { texture: visual.texture.id ?? visual.texture.value };
  return {
    kind: "sprite",
    ...texture,
    width: visual.width,
    height: visual.height,
    frame: spriteFramePatch(visual.frame),
    ...(visual.animation === undefined ? {} : {
      animation: {
        frameCount: visual.animation.frameCount,
        fps: visual.animation.fps,
      },
    }),
    originX: visual.originX,
    originY: visual.originY,
    ...(visual.layer === undefined ? {} : { layer: visual.layer }),
    ...(visual.sortOrder === undefined ? {} : { sortOrder: visual.sortOrder }),
    ...(visual.tint === undefined ? {} : { tint: visual.tint }),
    ...(visual.color === undefined ? {} : { color: visual.color }),
  };
}

function spriteFramePatch(frame: ResolvedDataSceneSpriteFrame): PlacementJsonObject {
  return {
    u0: frame.u0,
    v0: frame.v0,
    u1: frame.u1,
    v1: frame.v1,
  };
}

function placementColliderLabel(instance: ScenePlacementViewerInstance): string {
  const collider = instance.collider;
  if (collider === undefined) {
    return "none";
  }
  return placementColliderSummary(collider);
}

function placementColliderSummary(collider: ResolvedDataSceneColliderComponent): string {
  switch (collider.type) {
    case "none":
      return "none";
    case "aabb":
      return `aabb ${collider.halfWidth * 2}x${collider.halfHeight * 2}`;
    case "circle":
      return `circle r${collider.radius}`;
    case "capsule":
      return `capsule r${collider.radius}`;
    case "orientedBox":
      return `orientedBox ${collider.halfWidth * 2}x${collider.halfHeight * 2}`;
    case "convexPolygon":
      return `convexPolygon ${collider.vertices.length}`;
  }
}

function placementColliderPatchFromResolved(
  collider: ResolvedDataSceneColliderComponent,
): PlacementJsonValue {
  if (collider.type === "none") {
    return "none";
  }
  const base = placementColliderBasePatchFromResolved(collider);
  switch (collider.type) {
    case "aabb":
      return {
        type: "aabb",
        ...base,
        halfWidth: collider.halfWidth,
        halfHeight: collider.halfHeight,
      };
    case "circle":
      return {
        type: "circle",
        ...base,
        radius: collider.radius,
      };
    case "capsule":
      return {
        type: "capsule",
        ...base,
        startX: collider.startX,
        startY: collider.startY,
        endX: collider.endX,
        endY: collider.endY,
        radius: collider.radius,
      };
    case "orientedBox":
      return {
        type: "orientedBox",
        ...base,
        halfWidth: collider.halfWidth,
        halfHeight: collider.halfHeight,
        rotationRadians: collider.rotationRadians,
      };
    case "convexPolygon":
      return {
        type: "convexPolygon",
        ...base,
        vertices: collider.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
        rotationRadians: collider.rotationRadians,
      };
  }
}

function placementColliderBasePatchFromResolved(
  collider: Exclude<ResolvedDataSceneColliderComponent, { type: "none" }>,
): PlacementJsonObject {
  return {
    offsetX: collider.offsetX,
    offsetY: collider.offsetY,
    enabled: collider.enabled,
    isTrigger: collider.isTrigger,
  };
}
