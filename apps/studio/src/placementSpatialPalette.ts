import {
  setUiAttribute,
  setUiText,
  uiMessage,
  uiText,
} from "./placementLocale";
import type {
  SpatialModelAsset,
  SpatialPoint,
  SpatialSurfaceHit,
} from "@ferrum2d/ferrum-web/core";
import type {
  ScenePlacementAssetProvider,
  ScenePlacementViewer,
  ScenePlacementViewerState,
} from "@ferrum2d/ferrum-web/authoring";
import type { PlacementBrowserAsset } from "./placementAssetBrowser";
import { createSpatialModelThumbnailSvg } from "@ferrum2d/ferrum-web/core";

const DRAG_TYPE = "application/x-ferrum-spatial-placement";
type PlacementValue = NonNullable<
  Parameters<ScenePlacementViewer["addInstance"]>[1]["props"]
>[string];
type Asset =
  | {
      kind: "sprite";
      id: string;
      width: number;
      height: number;
      thumbnail?: string;
      frame?: { u0: number; v0: number; u1: number; v1: number };
    }
  | { kind: "model"; id: string; contentId: string; model: SpatialModelAsset };
type PlacementHit = SpatialPoint & { floorId: number } & (
  { kind: "terrain"; surfaceId: string } | { kind: "plane" }
);

/** Cold authoring only: native terrain hits or an explicitly selected working plane. */
export function createPlacementSpatialPalette(options: {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  viewer: ScenePlacementViewer;
  assets(): ScenePlacementAssetProvider;
  models: Map<string, SpatialModelAsset>;
  modelNames: Map<string, string>;
  canPlace(): boolean;
  hit(point: { x: number; y: number }): SpatialSurfaceHit | undefined;
  plane(): { elevation: number; floorId: number };
  planeHit(point: { x: number; y: number }): SpatialPoint | undefined;
  project(
    point: SpatialPoint,
  ): { x: number; y: number; visible: boolean } | undefined;
  snap(): { enabled: boolean; gridSize: number };
  finishEdit(): void;
  onChange(state: ScenePlacementViewerState): unknown;
  report(error?: unknown): void;
  toolChange(placing: boolean): void;
}) {
  const { canvas, stage, viewer } = options;
  const element = document.createElement("section");
  element.className = "placement-spatial-palette";
  setUiAttribute(element, "aria-label", "Add spatial object");
  const heading = document.createElement("h4");
  setUiText(heading, "Add Object");
  const basis = document.createElement("select");
  basis.dataset.placementSpatialBasis = "true";
  setUiAttribute(basis, "aria-label", "Placement basis");
  for (const [value, text] of [["terrain", "Terrain surface"], ["plane", "Working plane"]]) {
    const option = document.createElement("option");
    option.value = value;
    setUiText(option, text);
    basis.append(option);
  }
  const kind = document.createElement("select");
  kind.dataset.placementSpatialAddKind = "true";
  setUiAttribute(kind, "aria-label", "Object type");
  for (const [value, label] of [
    ["sprite", "Sprite"],
    ["model", "Model"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    setUiText(option, label);
    kind.append(option);
  }
  const assets = document.createElement("select");
  assets.dataset.placementSpatialAddAsset = "true";
  setUiAttribute(assets, "aria-label", "Placement asset");
  const frames = document.createElement("select");
  frames.dataset.placementSpatialAddFrame = "true";
  setUiAttribute(frames, "aria-label", "Sprite frame");
  const id = document.createElement("input");
  setUiAttribute(id, "placeholder", "Object ID (auto)");
  setUiAttribute(id, "aria-label", "New object ID");
  id.dataset.placementSpatialNewId = "true";
  const thumbnail = document.createElement("div");
  thumbnail.className = "placement-spatial-asset-preview";
  thumbnail.dataset.placementSpatialAssetPreview = "true";
  thumbnail.draggable = true;
  setUiAttribute(thumbnail, "title", "Drag into the viewport");
  const name = document.createElement("span");
  const image = document.createElement("img");
  image.alt = "";
  image.draggable = false;
  thumbnail.append(image, name);
  const place = document.createElement("button");
  place.type = "button";
  setUiText(place, "Place");
  place.dataset.placementSpatialPlace = "true";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  setUiText(cancelButton, "Cancel");
  cancelButton.dataset.placementSpatialPlaceCancel = "true";
  const actions = document.createElement("div");
  const repeat = document.createElement("input");
  repeat.type = "checkbox";
  repeat.dataset.placementSpatialRepeat = "true";
  const repeatLabel = document.createElement("label");
  repeatLabel.append(repeat, uiText(" Keep Placing"));
  const rotation = document.createElement("input"),
    scale = document.createElement("input");
  rotation.type = scale.type = "number";
  rotation.value = "0";
  scale.value = "1";
  rotation.step = "15";
  scale.step = "0.1";
  scale.min = "0.01";
  scale.max = "100";
  setUiAttribute(rotation, "aria-label", "Placement rotation degrees");
  setUiAttribute(scale, "aria-label", "Placement scale");
  rotation.dataset.placementSpatialAddRotation = "true";
  scale.dataset.placementSpatialAddScale = "true";
  actions.append(place, cancelButton);
  const hint = document.createElement("p");
  setUiText(
    hint,
    "Choose a placement basis and asset, then click Place or drag the preview. Set working plane height and floor in View. The floor applies to sprites; visual-only models use height.",
  );
  element.append(
    heading,
    basis,
    kind,
    assets,
    frames,
    id,
    labelled("Rotation (°)", rotation),
    labelled("Scale (×)", scale),
    repeatLabel,
    thumbnail,
    actions,
    hint,
  );

  function labelled(text: string, input: HTMLInputElement) {
    const label = document.createElement("label");
    label.className = "placement-field-label";
    label.append(text, input);
    return label;
  }
  repeatLabel.className = "placement-inline-checkbox";
  const preview = document.createElement("div");
  preview.className = "placement-spatial-add-preview";
  preview.dataset.placementSpatialAddPreview = "true";
  preview.hidden = true;
  const ghost = document.createElement("img");
  ghost.alt = "";
  const caption = document.createElement("span");
  preview.append(ghost, caption);
  const rejection = document.createElement("div");
  rejection.className = "placement-spatial-drop-rejection";
  rejection.dataset.placementDropRejection = "true";
  rejection.setAttribute("role", "status");
  rejection.setAttribute("aria-live", "polite");
  rejection.hidden = true;
  const marker = document.createElement("div");
  marker.className = "placement-spatial-add-anchor";
  marker.hidden = true;
  stage.append(preview, marker, rejection);
  let pending: Asset | undefined;
  let dragging: { token: string; asset: Asset } | undefined;
  let inventorySignature = "";
  let previewSignature = "";
  let lastProvider: ScenePlacementAssetProvider | undefined;
  const modelThumbnails = new Map<string, string>();
  function selectedAsset(): Asset {
    if (kind.value === "model") {
      const model = options.models.get(assets.value),
        assetId = options.modelNames.get(assets.value);
      if (!model || !assetId)
        throw new Error("Import or load a GLB model before placement");
      return { kind: "model", id: assetId, contentId: model.contentId, model };
    }
    const provider = options.assets(),
      asset = provider.resolveSpriteAsset(assets.value);
    if (!asset) throw new Error("Choose an available sprite asset");
    const frame = frames.value
      ? provider.resolveSpriteFrame(asset.id, frames.value)
      : undefined;
    if (frames.value && !frame)
      throw new Error("Sprite frame is no longer available");
    return {
      kind: "sprite",
      id: asset.id,
      thumbnail: frame?.thumbnailUrl ?? asset.thumbnailUrl,
      width:
        frame?.width ??
        (asset.width ?? 32) *
          (frame?.frame ? frame.frame.u1 - frame.frame.u0 : 1),
      height:
        frame?.height ??
        (asset.height ?? 32) *
          (frame?.frame ? frame.frame.v1 - frame.frame.v0 : 1),
      frame: frame?.frame ? { ...frame.frame } : undefined,
    };
  }
  function clearPreview() {
    preview.hidden = marker.hidden = rejection.hidden = true;
  }
  function cancel() {
    pending = undefined;
    dragging = undefined;
    clearPreview();
    place.setAttribute("aria-pressed", "false");
    cancelButton.disabled = true;
    options.toolChange(pending !== undefined);
  }
  basis.addEventListener("change", cancel);
  function updateThumbnail() {
    frames.hidden = kind.value !== "sprite";
    const provider = options.assets();
    const signature =
      kind.value +
      "|" +
      assets.value +
      "|" +
      JSON.stringify(provider.listSpriteFrames(assets.value));
    if (frames.dataset.signature !== signature) {
      frames.dataset.signature = signature;
      const previousFrame = frames.value;
      frames.replaceChildren();
      const full = document.createElement("option");
      full.value = "";
      setUiText(full, "Full Image");
      frames.append(full);
      for (const frame of provider.listSpriteFrames(assets.value)) {
        const option = document.createElement("option");
        option.value = frame.id;
        option.textContent = frame.label ?? frame.id;
        frames.append(option);
      }
      if ([...frames.options].some((option) => option.value === previousFrame))
        frames.value = previousFrame;
    }
    previewSignature = JSON.stringify(kind.value === "sprite"
      ? [kind.value, assets.value, frames.value, provider.resolveSpriteAsset(assets.value)]
      : [kind.value, assets.value, options.modelNames.get(assets.value), options.models.has(assets.value)]);
    try {
      const asset = selectedAsset();
      name.textContent = asset.id;
      const url = asset.kind === "sprite" ? asset.thumbnail : undefined;
      image.hidden = !url;
      if (url) image.src = url;
      else image.removeAttribute("src");
      place.disabled = false;
      thumbnail.draggable = true;
    } catch {
      setUiText(
        name,
        kind.value === "model"
          ? "Import a GLB to place a model"
          : "No sprite assets",
      );
      image.hidden = true;
      image.removeAttribute("src");
      place.disabled = true;
      thumbnail.draggable = false;
    }
  }
  function sync() {
    const provider = options.assets();
    const entries =
      kind.value === "sprite"
        ? provider
            .listSpriteAssets()
            .map((asset) => [asset.id, asset.label ?? asset.id])
        : [...options.modelNames]
            .filter(([contentId]) => options.models.has(contentId))
            .map(([contentId, assetId]) => [contentId, assetId]);
    const signature = kind.value + JSON.stringify(entries);
    const inventoryChanged = signature !== inventorySignature;
    const providerChanged = provider !== lastProvider;
    lastProvider = provider;
    if (inventoryChanged) {
      inventorySignature = signature;
      const previous = assets.value;
      assets.replaceChildren(
        ...entries.map(([value, label]) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          return option;
        }),
      );
      if (entries.some(([value]) => value === previous))
        assets.value = previous;
    }
    if (inventoryChanged || providerChanged) {
      const previous = previewSignature;
      updateThumbnail();
      // Publish the refreshed signature before notifying the host: toolChange
      // may synchronously re-enter sync. Unrelated asset changes keep the tool.
      if (previous !== previewSignature && (pending || dragging)) cancel();
    }
  }
  for (const control of [kind, assets, frames, id])
    control.addEventListener("change", () => {
      cancel();
      sync();
      updateThumbnail();
    });
  place.addEventListener("click", () => {
    if (!options.canPlace()) return;
    try {
      pending = selectedAsset();
      place.setAttribute("aria-pressed", "true");
      options.toolChange(pending !== undefined);
      cancelButton.disabled = false;
      options.report();
    } catch (error) {
      options.report(error);
    }
  });
  cancelButton.addEventListener("click", cancel);
  function support(point: { x: number; y: number }): PlacementHit | undefined {
    if (basis.value === "plane") {
      const hit = options.planeHit(point);
      if (!hit) return;
      const snap = options.snap(), plane = options.plane(),
        x = snap.enabled ? Math.round(hit.x / snap.gridSize) * snap.gridSize : hit.x,
        y = snap.enabled ? Math.round(hit.y / snap.gridSize) * snap.gridSize : hit.y;
      if (Math.abs(x) > 1e6 || Math.abs(y) > 1e6) return;
      return { kind: "plane", x, y, ...plane };
    }
    const hit = options.hit(point);
    if (!hit) return;
    const surface = viewer
      .state()
      .spatial?.terrain.find((surface) => surface.id === hit.surfaceId);
    if (!surface) return;
    const snap = options.snap();
    const x = snap.enabled
      ? Math.round(hit.x / snap.gridSize) * snap.gridSize
      : hit.x;
    const y = snap.enabled
      ? Math.round(hit.y / snap.gridSize) * snap.gridSize
      : hit.y;
    if (
      x < surface.x ||
      x > surface.x + surface.width ||
      y < surface.y ||
      y > surface.y + surface.depth
    )
      return;
    // This is authored preview geometry, not runtime movement or collision solving.
    const t =
      surface.rampAxis === "x"
        ? (x - surface.x) / surface.width
        : (y - surface.y) / surface.depth;
    return {
      ...hit,
      kind: "terrain",
      x,
      y,
      elevation:
        surface.elevation +
        ((surface.endElevation ?? surface.elevation) - surface.elevation) * t,
    };
  }
  function bounds(asset: Asset, hit: SpatialPoint) {
    const factor = Number(scale.value);
    if (asset.kind === "model") {
      const b = asset.model.bounds,
        points: SpatialPoint[] = [];
      const angle = (Number(rotation.value) * Math.PI) / 180;
      for (const x of [b[0], b[3]])
        for (const y of [b[2], b[5]])
          for (const h of [0, b[4] - b[1]])
            points.push({
              x: hit.x + (x * Math.cos(angle) + y * Math.sin(angle)) * factor,
              y: hit.y + (x * Math.sin(angle) - y * Math.cos(angle)) * factor,
              elevation: hit.elevation + h * factor,
            });
      return points;
    }
    // A vertical screen-facing guide follows the same physical foot anchor.
    return [hit, { ...hit, elevation: hit.elevation + asset.height * factor }];
  }
  function rejectPlacement(point: { x: number; y: number }, reason: string) {
    clearPreview();
    const rect = stage.getBoundingClientRect(), area = canvas.getBoundingClientRect();
    rejection.style.maxWidth = Math.max(0, Math.min(220, area.width - 16)) + "px";
    rejection.style.left = Math.max(area.left, Math.min(point.x + 12, area.right - 228)) - rect.left + "px";
    rejection.style.top = Math.max(area.top, Math.min(point.y + 12, area.bottom - 60)) - rect.top + "px";
    setUiText(rejection, reason);
    rejection.hidden = false;
    return false;
  }
  function showPreview(asset: Asset, point: { x: number; y: number }): boolean {
    const hit = support(point);
    if (!hit) {
      return rejectPlacement(point, basis.value === "plane" ? "Working plane is not visible at this angle." : "No terrain here. Choose Working Plane to place outside the map.");
    }
    const anchor = options.project(hit),
      points = bounds(asset, hit).map(options.project);
    if (!anchor?.visible || points.some((point) => !point?.visible)) {
      // Framing only limits the guide. A valid placement may extend offscreen.
      clearPreview();
      return true;
    }
    const valid = points.filter(
        (point): point is NonNullable<typeof point> => !!point,
      ),
      rect = stage.getBoundingClientRect();
    const height = Math.max(
      8,
      Math.max(...valid.map((point) => point.y)) -
        Math.min(...valid.map((point) => point.y)),
    );
    const width =
      asset.kind === "sprite"
        ? (height * asset.width) / asset.height
        : Math.max(
            8,
            Math.max(...valid.map((point) => point.x)) -
              Math.min(...valid.map((point) => point.x)),
          );
    preview.style.left =
      (asset.kind === "sprite"
        ? anchor.x - width / 2
        : Math.min(...valid.map((point) => point.x))) -
      rect.left +
      "px";
    preview.style.top =
      Math.min(...valid.map((point) => point.y)) - rect.top + "px";
    preview.style.transformOrigin = "50% 100%";
    preview.style.transform =
      asset.kind === "sprite" ? `rotate(${-Number(rotation.value)}deg)` : "";
    preview.style.width = width + "px";
    preview.style.height = height + "px";
    const url = asset.kind === "sprite" ? asset.thumbnail : undefined;
    ghost.hidden = !url;
    if (url) ghost.src = url;
    else ghost.removeAttribute("src");
    const visualOnly = asset.kind === "model";
    setUiText(caption, uiMessage("{0} · {1} · H {2} · {3}", asset.id,
      visualOnly ? uiMessage("Visual Only") : uiMessage("Floor {0}", hit.floorId), hit.elevation,
      hit.kind === "plane" ? uiMessage("Working plane · no terrain support") : uiMessage("Terrain surface")));
    marker.style.left = anchor.x - rect.left + "px";
    marker.style.top = anchor.y - rect.top + "px";
    preview.dataset.surface = hit.kind === "terrain" ? hit.surfaceId : "";
    preview.dataset.basis = hit.kind;
    preview.dataset.x = String(hit.x);
    preview.dataset.y = String(hit.y);
    preview.dataset.elevation = String(hit.elevation);
    preview.dataset.floor = visualOnly ? "" : String(hit.floorId);
    preview.hidden = marker.hidden = false;
    rejection.hidden = true;
    return true;
  }
  function commit(asset: Asset, point: { x: number; y: number }) {
    try {
      if (!options.canPlace()) return false;
      const hit = support(point);
      if (!hit) throw new Error(basis.value === "plane" ? "The working plane is outside the visible view" : "Place the object on a terrain surface");
      options.finishEdit();
      const state = viewer.state();
      const factor = Number(scale.value),
        degrees = Number(rotation.value);
      if (
        !Number.isFinite(factor) ||
        factor < 0.01 ||
        factor > 100 ||
        !Number.isFinite(degrees)
      )
        throw new Error("Placement scale must be 0.01–100 and rotation finite");
      if (
        asset.kind === "model" &&
        Object.values(state.spatial?.models ?? {})
          .flatMap((model) => [model, ...(model.lods ?? [])])
          .some(
            (model) =>
              model.asset === asset.id && model.contentId !== asset.contentId,
          )
      )
        throw new Error(
          `Model asset '${asset.id}' already references different content; import with another asset ID`,
        );
      const definitions = state.objectDefinitions.filter(
        (definition) => definition.behaviorProfiles.length === 0,
      );
      const prefab =
        definitions.find((definition) => definition.id === "object")?.id ??
        definitions[0]?.id;
      if (!prefab)
        throw new Error(
          "Add an ObjectDefinition without behavior bindings before placement",
        );
      const used = new Set(
        state.instances.map((instance) => instance.instanceId),
      );
      for (const operation of state.draftPatch?.operations ?? [])
        if (
          operation.kind === "removeInstance" ||
          operation.kind === "renameInstance"
        )
          used.add(operation.instanceId);
      const prefix = asset.id.replace(/[^a-zA-Z0-9_-]/g, "_") || asset.kind;
      let instanceId = id.value.trim();
      if (!instanceId) {
        for (let index = 1; index <= 16384; index++) {
          if (!used.has(prefix + "_" + index)) {
            instanceId = prefix + "_" + index;
            break;
          }
        }
      }
      if (!instanceId) throw new Error("No available object ID");
      const width =
        asset.kind === "sprite"
          ? asset.width
          : Math.max(1, asset.model.bounds[3] - asset.model.bounds[0]);
      const height =
        asset.kind === "sprite"
          ? asset.height
          : Math.max(0.01, asset.model.bounds[4] - asset.model.bounds[1]);
      const visual: PlacementValue =
        asset.kind === "sprite"
          ? {
              kind: "sprite",
              asset: asset.id,
              width,
              height,
              originX: 0.5,
              originY: 1,
              ...(asset.frame ? { frame: { ...asset.frame } } : {}),
            }
          : {
              kind: "primitive",
              shape: "rect",
              width,
              height: Math.max(
                1,
                asset.model.bounds[5] - asset.model.bounds[2],
              ),
              color: "#aeb9c6",
            };
      const components = {
        visual,
        collider:
          asset.kind === "sprite"
            ? { type: "aabb", halfWidth: width / 4, halfHeight: width / 4 }
            : "none",
        layer: "wall",
        ...(asset.kind === "sprite"
          ? {
              body: {
                type: "static",
                heightSpan: {
                  elevation: hit.elevation,
                  height: height * factor,
                  floorId: hit.floorId,
                },
              },
            }
          : {}),
      };
      const spatial: NonNullable<
        Parameters<ScenePlacementViewer["addInstance"]>[2]
      > =
        asset.kind === "sprite"
          ? {
              kind: "addBillboard",
              changes: { unitsPerPixel: 1, elevation: 0 },
            }
          : {
              kind: "addModel",
              changes: {
                asset: asset.id,
                contentId: asset.contentId,
                elevation: hit.elevation - asset.model.bounds[1] * factor,
                yawDegrees: degrees,
                scale: factor,
              },
            };
      const result = viewer.addInstance(
        state.fragment,
        {
          id: instanceId,
          prefab,
          x: hit.x,
          y: hit.y,
          ...(asset.kind === "sprite"
            ? { rotationRadians: (degrees * Math.PI) / 180, scale: factor }
            : {}),
          props: { components },
        },
        spatial,
      );
      if (repeat.checked && !dragging) {
        id.value = "";
        clearPreview();
      } else cancel();
      options.onChange(result);
      options.report();
      return true;
    } catch (error) {
      options.onChange(viewer.state());
      options.report(error);
      return false;
    }
  }
  function startDrag(event: DragEvent) {
    if (!options.canPlace() || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    try {
      const asset = selectedAsset();
      cancel();
      dragging = { asset, token: crypto.randomUUID() };
      options.toolChange(true);
      event.dataTransfer.setData(DRAG_TYPE, dragging.token);
      event.dataTransfer.effectAllowed = "copy";
    } catch (error) {
      event.preventDefault();
      options.report(error);
    }
  }
  thumbnail.addEventListener("dragstart", startDrag);
  canvas.addEventListener("dragover", (event) => {
    if (
      !dragging ||
      !event.dataTransfer?.types.includes(DRAG_TYPE) ||
      !options.canPlace()
    )
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = showPreview(dragging.asset, { x: event.clientX, y: event.clientY }) ? "copy" : "none";
  });
  canvas.addEventListener("drop", (event) => {
    if (!dragging || event.dataTransfer?.getData(DRAG_TYPE) !== dragging.token)
      return;
    event.preventDefault();
    try {
      commit(dragging.asset, { x: event.clientX, y: event.clientY });
    } finally {
      cancel();
    }
  });
  canvas.addEventListener("dragleave", clearPreview);
  canvas.addEventListener("pointerleave", clearPreview);
  window.addEventListener("dragend", () => {
    if (dragging) cancel();
  });
  cancel();
  sync();
  return {
    element,
    sync,
    cancel,
    clearPreview,
    support: () =>
      preview.hidden
        ? undefined
        : {
            surface: preview.dataset.surface,
            kind: preview.dataset.basis,
            floor: preview.dataset.floor,
            elevation: preview.dataset.elevation,
          },
    browserEntries(): PlacementBrowserAsset[] {
      return [...options.modelNames]
        .filter(([hash]) => options.models.has(hash))
        .map(([contentId, id]) => {
          if (!modelThumbnails.has(contentId))
            modelThumbnails.set(
              contentId,
              "data:image/svg+xml," +
                encodeURIComponent(
                  createSpatialModelThumbnailSvg(
                    options.models.get(contentId)!,
                  ),
                ),
            );
          return {
            key: "model:" + contentId,
            kind: "model",
            id,
            contentId,
            label: id + " · " + contentId.slice(0, 8),
            thumbnail: modelThumbnails.get(contentId),
          };
        });
    },
    choose(asset: PlacementBrowserAsset, arm = true) {
      cancel();
      kind.value = asset.kind;
      sync();
      assets.value = asset.contentId ?? asset.id;
      updateThumbnail();
      frames.value = asset.frameId ?? "";
      updateThumbnail();
      if (arm) place.click();
    },
    dragAsset(event: DragEvent, asset: PlacementBrowserAsset) {
      this.choose(asset, false);
      startDrag(event);
    },
    ownsDrag: () => dragging !== undefined,
    pending: () => pending !== undefined,
    toolState: () => {
      const asset = pending ?? dragging?.asset;
      if (!asset) return;
      return {
        kind: asset.kind,
        id: asset.id,
        label: asset.id,
        frameId:
          asset.kind === "sprite" ? frames.value || undefined : undefined,
        contentId: asset.kind === "model" ? asset.contentId : undefined,
        dragging: !!dragging,
      };
    },
    move(point: { x: number; y: number }) {
      if (pending && options.canPlace()) showPreview(pending, point);
    },
    place(point: { x: number; y: number }) {
      return pending ? commit(pending, point) : false;
    },
  };
}
