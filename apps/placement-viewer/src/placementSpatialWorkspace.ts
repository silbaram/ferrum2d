import {
  setUiAttribute,
  setUiText,
  uiMessage,
  uiText,
} from "./placementLocale";
import { decorateViewportAction, viewportGroup } from "./placementViewportChrome";
import { createPlacementControlMenu } from "./placementControlMenu";
import { createPlacementGameCamera } from "./placementGameCamera";
import {
  createDataSceneSpatialView,
  loadSpatialGlb,
  type FerrumRuntime,
  type FerrumRuntimeFrame,
  type SpatialCameraSpec,
  type SpatialModelAsset,
  type SpatialPoint,
  type SpatialRenderBufferView,
} from "@ferrum2d/ferrum-web/core";
import {
  mergeScenePlacementPatch,
  resolveSceneAuthoringDocument,
  type SceneAuthoringDocumentSpec,
  type ScenePlacementViewer,
  type ScenePlacementViewerState,
  type SceneSpatialPatchOperation,
  type ScenePlacementAssetProvider,
} from "@ferrum2d/ferrum-web/authoring";
import { createPlacementSpatialPalette } from "./placementSpatialPalette";
import { createPlacementSpatialProxy } from "./placementSpatialProxy";
import { pointOnElevationPlane, type PlaneProjection } from "./placementGridGeometry";
import {
  MIN_VIEW_PITCH, MAX_VIEW_PITCH, VIEW_PITCH_STEP,
  spatialCameraPitch, tiltSpatialCamera, spatialEditorRenderCamera,
} from "./placementSpatialCamera";

type Mode = "2d" | "spatial" | "game";
type Target = { kind: "surface" | "model" | "billboard"; id: string };
type Point = { x: number; y: number; depth: number };
// Corner order follows worldGeometry's X/Y/Z loops, rather than a screen rectangle.
const MODEL_FACES = [
  [0, 1, 3, 2],
  [4, 6, 7, 5],
  [0, 4, 5, 1],
  [2, 3, 7, 6],
  [0, 2, 6, 4],
  [1, 5, 7, 3],
];
function triangleDepth(a: Point, b: Point, c: Point, x: number, y: number) {
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 1e-8) return;
  const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator,
    v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator,
    w = 1 - u - v;
  if (Math.min(u, v, w) < -1e-7) return;
  // NDC depth is linear in screen space, including perspective projections.
  return u * a.depth + v * b.depth + w * c.depth;
}
interface CameraState {
  returnMode?: "2d" | "spatial";
  paused?: boolean;
  gameFrame?: boolean;
  hiddenFloors?: number[];
  focusFloor?: number;
  workingPlane?: { elevation: number; floorId: number };
  ghostOthers?: boolean;
  camera?: SpatialCameraSpec;
  target?: Target;
  mode: Mode;
}
function elevationAtScreenY(
  point: SpatialPoint,
  screenY: number,
  projection: PlaneProjection,
): number | undefined {
  const { camera: m, rect } = projection;
  if (rect.height <= 0) return;
  const v = 1 - ((screenY - rect.top) / rect.height) * 2,
    constantY = m[1] * point.x - m[9] * point.y + m[13],
    constantW = m[3] * point.x - m[11] * point.y + m[15],
    denominator = m[5] - v * m[7],
    scale = Math.max(Math.abs(m[5]), Math.abs(v * m[7]));
  if (Math.abs(denominator) <= scale * 1e-12) return;
  const elevation = (v * constantW - constantY) / denominator,
    w = constantW + m[7] * elevation;
  return Number.isFinite(elevation) && Number.isFinite(w) && w > 0
    ? elevation
    : undefined;
}

/** Authoring geometry and edit cameras only. Native runtime owns preview simulation. */
export function installPlacementSpatialWorkspace(options: {
  runtime: FerrumRuntime;
  models: Map<string, SpatialModelAsset>;
  assets(): ScenePlacementAssetProvider;
  assetMount(): HTMLElement;
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  cameraToolbar: HTMLElement;
  flushSceneSettings?(): boolean;
  navigationSettings: HTMLElement;
  viewSettings: HTMLElement;
  gridChanged?(state: ScenePlacementViewerState): void;
  toolChange(): void;
  viewer: ScenePlacementViewer;
  document(): SceneAuthoringDocumentSpec;
  apply(document: SceneAuthoringDocumentSpec): void;
  onChange(state: ScenePlacementViewerState): unknown;
  finishEdit(): void;
  snap(): { enabled: boolean; gridSize: number };
  setSnap(value: { enabled: boolean; gridSize: number }): void;
  components(
    id: string,
  ): NonNullable<
    Parameters<ScenePlacementViewer["addInstance"]>[1]["props"]
  >[string];
}) {
  const { runtime, canvas, stage, viewer } = options;
  const view = createDataSceneSpatialView(runtime.engine, canvas);
  const sessions = new Map<string, CameraState>();
  const models = options.models;
  const modelNames = new Map<string, string>();
  let visibilitySignature = "",
    ghostSignature = "",
    ghostRevision = 0;
  let key = "",
    active: CameraState = { mode: "2d" };
  let state = viewer.state(),
    signature = "",
    applying = false,
    suspended = false,
    appliedMode: Mode = "2d";
  let frame: SpatialRenderBufferView | undefined;
  let inspector: HTMLElement | undefined;
  let navigationTool: "select" | "pan" = "select";
  let spaceHeld = false;
  let cameraTransaction = false;
  let previewCamera: SpatialCameraSpec | undefined;
  let drag:
    | {
        id: number;
        target: Element;
        startX: number;
        startY: number;
        origin: ScenePlacementViewerState;
        hit?: SpatialPoint;
        camera?: SpatialCameraSpec;
        projection?: PlaneProjection;
        heightAnchor?: { point: SpatialPoint; screenY: number };
        cancelRequested?: boolean;
        kind: "move" | "height" | "rotate" | "camera";
        selected?: Target;
      }
    | undefined;
  const controls = document.createElement("div");
  const modes = document.createElement("div");
  modes.className = "placement-workspace-modes";
  modes.setAttribute("role", "toolbar");
  setUiAttribute(modes, "aria-label", "Workspace mode");
  controls.append(modes);
  controls.className = "placement-mode-controls";
  controls.setAttribute("role", "toolbar");
  setUiAttribute(controls, "aria-label", "Playback");
  const buttons = new Map<Mode, HTMLButtonElement>();
  for (const [mode, label] of [
    ["2d", "2D"],
    ["spatial", "HD-2D"],
    ["game", "Game Preview"],
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    setUiText(button, label);
    setUiAttribute(button, "title", mode === "2d" ? "Edit flat scene placement" : mode === "spatial" ? "Edit depth and height placement" : "Preview the authored game camera");
    button.dataset.placementMode = mode;
    button.addEventListener("click", () => changeMode(mode));
    buttons.set(mode, button);
    modes.append(button);
  }
  const play = document.createElement("button"),
    pause = document.createElement("button"),
    stop = document.createElement("button");
  for (const [button, label] of [
    [play, "Play"],
    [pause, "Pause"],
    [stop, "Stop"],
  ] as const) {
    button.type = "button";
    decorateViewportAction(button, label === "Play" ? "play" : label === "Pause" ? "pause" : "stop", label, undefined, true);
    button.dataset.placementPlayback = label.toLowerCase();
    setUiAttribute(button, "title", label === "Play" ? "Run the current scene" : label === "Pause" ? "Pause or resume the running scene" : "Stop and return to editing");
    controls.append(button);
  }
  play.addEventListener("click", () => changeMode("game"));
  pause.addEventListener("click", () => {
    if (active.mode !== "game") return;
    if (!gameCamera.cancelGesture() || !gameCamera.flushInput()) return;
    try {
      const changed = active.paused
        ? runtime.engine.resumeDataScene()
        : runtime.engine.pauseDataScene();
      if (!changed) throw new Error("Preview playback change rejected");
      active.paused = !active.paused;
      options.onChange(viewer.state());
    } catch (error) {
      report(error);
    }
  });
  stop.addEventListener("click", () =>
    changeMode(active.returnMode ?? (state.spatial ? "spatial" : "2d")),
  );
  (
    stage.closest(".demo-shell")?.querySelector(".demo-actions") ?? stage
  ).append(controls);
  const panel = document.createElement("section");
  panel.className = "placement-spatial-panel";
  const title = document.createElement("h3");
  setUiText(title, "Spatial Placement");
  const targetSelect = document.createElement("select");
  targetSelect.dataset.placementSpatialTarget = "true";
  setUiAttribute(targetSelect, "aria-label", "Spatial target");
  const fields = new Map<string, HTMLInputElement>();
  const fieldLabels = new Map<string, HTMLSpanElement>();
  const form = document.createElement("form");
  form.className = "placement-spatial-fields";
  form.addEventListener("submit", (e) => e.preventDefault());
  for (const [name, label] of [
    ["x", "Ground X"],
    ["y", "Ground Y"],
    ["elevation", "Body / Surface Elevation"],
    ["floorId", "Floor"],
    ["offset", "Visual Elevation"],
    ["yaw", "Model Yaw"],
    ["scale", "Model Scale"],
  ]) {
    const row = document.createElement("label"),
      caption = document.createElement("span");
    setUiText(caption, label);
    const input = document.createElement("input");
    input.type = "number";
    input.step = name === "floorId" ? "1" : "any";
    input.dataset.placementSpatialField = name;
    row.append(caption, input);
    form.append(row);
    fields.set(name, input);
    fieldLabels.set(name, caption);
    input.addEventListener("change", () => {
      const value = input.valueAsNumber;
      if (!Number.isFinite(value)) return;
      if (!cancel()) return;
      options.finishEdit();
      viewer.beginEdit("Spatial Input");
      try {
        editField(name, value);
        options.onChange(viewer.commitEdit());
        report();
      } catch (error) {
        // A schema-valid edit can still fail native/GPU preparation. Retain neither
        // its draft nor its history entry, then restore the authored preview.
        const restored = viewer.cancelEdit();
        try {
          options.onChange(restored);
          sync(viewer.state(), true);
        } catch (restoreError) {
          report(restoreError);
          return;
        }
        report(error);
      }
    });
  }
  const info = document.createElement("p");
  setUiText(
    info,
    "Model bounds and billboard geometry select authored objects. Model pose does not move collision proxies.",
  );
  const editHint = document.createElement("p");
  editHint.className = "placement-spatial-edit-hint";
  const message = document.createElement("output");
  message.className = "placement-spatial-message";
  message.setAttribute("aria-live", "polite");
  panel.append(title, targetSelect, form, editHint, info, message);
  targetSelect.addEventListener("change", () => {
    const [kind, ...id] = targetSelect.value.split(":");
    if (kind === "surface" || kind === "model" || kind === "billboard")
      choose({ kind, id: id.join(":") });
  });
  const selection = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  selection.classList.add("placement-spatial-selection");
  const polygon = document.createElementNS(selection.namespaceURI, "polygon");
  selection.append(polygon);
  stage.append(selection);
  const transformTools = document.createElement("div");
  transformTools.className = "placement-spatial-transform-tools";
  transformTools.setAttribute("role", "toolbar");
  setUiAttribute(transformTools, "aria-label", "Transform selection");
  transformTools.hidden = true;
  const heightHandle = document.createElement("button"),
    rotateHandle = document.createElement("button");
  heightHandle.type = "button";
  heightHandle.dataset.placementSpatialHeight = "true";
  heightHandle.className = "placement-spatial-height";
  decorateViewportAction(heightHandle, "height", "Height", undefined, true);
  rotateHandle.type = "button";
  rotateHandle.dataset.placementSpatialRotate = "true";
  rotateHandle.className = "placement-spatial-rotate";
  decorateViewportAction(rotateHandle, "right", "Rotate Object", undefined, true);
  transformTools.append(heightHandle, rotateHandle);
  stage.append(transformTools);
  const cameraControls = document.createElement("div");
  cameraControls.className = "placement-spatial-camera";
  cameraControls.setAttribute("role", "toolbar");
  setUiAttribute(cameraControls, "aria-label", "Spatial edit camera");
  const toolsGroup = viewportGroup("Selection tools"),
    cameraGroup = viewportGroup("View navigation"),
    frameGroup = viewportGroup("Frame view"),
    floorGroup = viewportGroup("Floor view");
  const cameraMenu = createPlacementControlMenu("camera-spatial", "Editor View", "camera");
  const cameraHint = document.createElement("p");
  setUiText(cameraHint, "Editor view only. Game Preview uses the scene camera.");
  cameraMenu.panel.append(cameraHint, cameraGroup);
  cameraControls.append(toolsGroup);
  options.navigationSettings.append(frameGroup, cameraMenu.element, floorGroup);
  const navigationButtons = new Map<string, HTMLButtonElement>();
  for (const [tool, label, title] of [
    ["select", "Select", "Select objects (V)"],
    ["pan", "Pan", "Pan viewport (H / Space + drag)"],
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.placementSpatialNavigation = tool;
    decorateViewportAction(button, tool, label, undefined, true);
    setUiAttribute(button, "title", title);
    button.addEventListener("click", () => setNavigationTool(tool));
    navigationButtons.set(tool, button);
    toolsGroup.append(button);
  }
  function syncNavigationTool() {
    const panning = navigationTool === "pan" || spaceHeld || drag?.kind === "camera";
    for (const [tool, button] of navigationButtons)
      button.setAttribute("aria-pressed", String(tool === (panning ? "pan" : "select")));
    stage.dataset.spatialNavigationTool =
      drag?.kind === "camera"
        ? "panning"
        : navigationTool === "pan" || spaceHeld
          ? "pan"
          : "select";
    stage.dispatchEvent(new CustomEvent("placement-navigation-change", {
      detail: { mode: "spatial", tool: navigationTool, temporary: spaceHeld, dragging: drag?.kind === "camera" },
    }));
    syncPitchControls();
    gameCamera.sync();
  }
  function setNavigationTool(tool: typeof navigationTool) {
    if (drag || cameraTransaction || palette.ownsDrag() || active.mode !== "spatial") return;
    if (tool === "pan") palette.cancel();
    navigationTool = tool;
    syncNavigationTool();
    canvas.focus({ preventScroll: true });
  }
  const pitchControls = document.createElement("label"),
    pitchLabel = document.createElement("span"),
    pitchInput = document.createElement("input"),
    pitchOutput = document.createElement("output"),
    pitchButtons = new Map<string, HTMLButtonElement>();
  pitchControls.className = "placement-camera-pitch";
  setUiText(pitchLabel, "Viewing angle");
  pitchInput.type = "range";
  pitchInput.min = String(MIN_VIEW_PITCH);
  pitchInput.max = String(MAX_VIEW_PITCH);
  pitchInput.step = "1";
  pitchInput.dataset.placementCameraPitch = "true";
  setUiAttribute(pitchInput, "aria-label", "Viewing angle");
  setUiAttribute(pitchInput, "title", "Angle above the ground (1–89°)");
  pitchOutput.dataset.placementCameraPitchValue = "true";
  pitchControls.append(pitchLabel, pitchOutput, pitchInput);
  cameraMenu.panel.append(pitchControls);
  pitchInput.addEventListener("input", () => {
    if (drag || cameraTransaction || suspended || active.mode !== "spatial" || !active.camera) {
      syncPitchControls();
      return;
    }
    try {
      setCamera(tiltSpatialCamera(active.camera, pitchInput.valueAsNumber));
      report();
    } catch (error) {
      syncPitchControls();
      report(error);
    }
  });
  function syncPitchControls() {
    const pitch = active.camera ? spatialCameraPitch(active.camera) : 0;
    pitchInput.value = String(pitch);
    pitchInput.disabled = !active.camera || active.mode !== "spatial" || suspended || !!drag || cameraTransaction;
    setUiText(pitchOutput, uiMessage("{0}°", Number(pitch.toFixed(1))));
    for (const [action, button] of pitchButtons)
      button.disabled = pitchInput.disabled || (action === "up" ? pitch >= MAX_VIEW_PITCH - 1e-6 : pitch <= MIN_VIEW_PITCH + 1e-6);
  }
  for (const [action, label] of [
    ["left", "Orbit Left"],
    ["right", "Orbit Right"],
    ["up", "Orbit Up"],
    ["down", "Orbit Down"],
    ["out", "Zoom Out"],
    ["in", "Zoom In"],
    ["reset", "Reset Camera"],
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    decorateViewportAction(button,
      action === "in" ? "plus" : action === "out" ? "minus" : action,
      label);
    button.dataset.placementSpatialCamera = action;
    button.addEventListener("click", () => {
      if (!active.camera || drag || cameraTransaction) return;
      try {
        let camera = structuredClone(active.camera);
        if (action === "reset") camera = structuredClone(state.spatial!.camera);
        else if (action === "left" || action === "right") {
          const angle = ((action === "left" ? -1 : 1) * Math.PI) / 12;
          const dx = camera.position.x - camera.target.x,
            dy = camera.position.y - camera.target.y;
          camera.position.x =
            camera.target.x + dx * Math.cos(angle) - dy * Math.sin(angle);
          camera.position.y =
            camera.target.y + dx * Math.sin(angle) + dy * Math.cos(angle);
        } else if (action === "up" || action === "down") {
          camera = tiltSpatialCamera(camera, spatialCameraPitch(camera) + (action === "up" ? VIEW_PITCH_STEP : -VIEW_PITCH_STEP));
        } else camera = zoomedCamera(camera, action === "in" ? 0.8 : 1.25);
        setCamera(camera);
        report();
      } catch (error) {
        report(error);
      }
    });
    if (action === "up" || action === "down") pitchButtons.set(action, button);
    cameraGroup.append(button);
  }
  options.cameraToolbar.append(cameraControls);
  const gameCameraLaunch = document.createElement("button");
  gameCameraLaunch.type = "button";
  gameCameraLaunch.dataset.placementGameCameraEdit = "true";
  decorateViewportAction(gameCameraLaunch, "camera", "Game Camera");
  setUiAttribute(gameCameraLaunch, "title", "Adjust the game camera live");
  gameCameraLaunch.addEventListener("click", previewGameCamera);
  cameraControls.append(gameCameraLaunch);
  const gameCamera = createPlacementGameCamera({
    canvas, stage,
    camera: () => state.spatial?.camera,
    editorCamera: () => active.camera,
    canEdit: () => (active.mode === "spatial" || liveGameCamera()) && !suspended && !drag && !cameraTransaction && !canvas.closest<HTMLElement>(".demo-shell")?.inert,
    live: liveGameCamera,
    previewInput: previewGameCameraInput,
    closePreview: () => changeMode(active.returnMode ?? "spatial"),
    commit: commitGameCamera,
    report,
    preview: previewGameCamera,
  });
  cameraMenu.panel.append(gameCamera.element);
  const assets = document.createElement("div");
  assets.className = "placement-model-import";
  const importTitle = document.createElement("h4");
  setUiText(importTitle, "Import Model");
  assets.append(importTitle);
  const modelKey = document.createElement("input");
  setUiAttribute(modelKey, "placeholder", "Model asset ID");
  setUiAttribute(modelKey, "aria-label", "Model asset ID");
  modelKey.dataset.placementModelKey = "true";
  const modelFile = document.createElement("input");
  modelFile.type = "file";
  modelFile.accept = ".glb";
  modelFile.dataset.placementModelFile = "true";
  setUiAttribute(modelFile, "aria-label", "Import model GLB");
  let importRevision = 0;
  modelFile.addEventListener("change", () => {
    void (async () => {
      const file = modelFile.files?.[0];
      if (!file) return;
      const revision = ++importRevision,
        sourceKey = key,
        id = modelKey.value.trim() || file.name.replace(/\.glb$/i, "");
      try {
        palette.cancel();
        if (file.size > 32 * 1024 * 1024)
          throw new Error("Model exceeds 32 MiB");
        const asset = await loadSpatialGlb(await file.arrayBuffer(), {
          materialProfile: "diffuse",
        });
        if (revision !== importRevision || sourceKey !== key) return;
        const refs = Object.values(state.spatial?.models ?? {})
          .flatMap((m) => [m, ...(m.lods ?? [])])
          .filter((m) => m.asset === id);
        if (refs.some((m) => m.contentId !== asset.contentId))
          throw new Error(
            "Model contentId differs from the authored reference",
          );
        if (!models.has(asset.contentId)) {
          if (
            models.size >= 16 ||
            [...models.values()].reduce(
              (bytes, value) => bytes + value.byteLength,
              0,
            ) +
              asset.byteLength >
              128 * 1024 * 1024
          )
            throw new Error("Spatial model cache exceeds 16 assets or 128 MiB");
          if (
            !runtime.engine.registerDataSceneSpatialModel(
              "placement:" + asset.contentId,
              asset,
            )
          )
            throw new Error("Model registration rejected");
          models.set(asset.contentId, asset);
        }
        modelNames.set(asset.contentId, id);
        signature = "";
        sync(viewer.state());
        report();
        window.dispatchEvent(
          new CustomEvent("ferrum-placement-model-import", {
            detail: { id, contentId: asset.contentId },
          }),
        );
      } catch (error) {
        if (revision === importRevision && sourceKey === key) report(error);
      } finally {
        if (revision === importRevision) modelFile.value = "";
      }
    })();
  });
  assets.append(modelKey, modelFile);
  function report(error?: unknown) {
    setUiText(
      message,
      error ? (error instanceof Error ? error.message : String(error)) : "",
    );
    if (error)
      window.dispatchEvent(
        new CustomEvent("ferrum-placement-document-error", { detail: error }),
      );
  }
  const palette = createPlacementSpatialPalette({
    canvas,
    stage,
    viewer,
    models,
    modelNames,
    assets: options.assets,
    canPlace: () =>
      active.mode === "spatial" &&
      !suspended &&
      !drag &&
      !cameraTransaction &&
      !canvas.closest<HTMLElement>(".demo-shell")?.inert,
    hit: (point) => (frame ? view.pick(point, frame) : undefined),
    plane: () => active.workingPlane ?? { elevation: 0, floorId: 0 },
    planeHit(point) {
      const projection = projectionSnapshot();
      if (!projection) return;
      const r = projection.rect;
      if (point.x < r.left || point.x > r.left + r.width || point.y < r.top || point.y > r.top + r.height) return;
      const hit = pointOnElevationPlane(point, active.workingPlane?.elevation ?? 0, projection);
      if (!hit || Math.abs(hit.x) > 1e6 || Math.abs(hit.y) > 1e6 || !view.project(hit, frame!)?.visible) return;
      return hit;
    },
    project: (point) => (frame ? view.project(point, frame) : undefined),
    snap: options.snap,
    finishEdit: options.finishEdit,
    onChange: options.onChange,
    report,
    toolChange(placing) {
      if (placing) navigationTool = "select";
      syncNavigationTool();
      options.toolChange();
    },
  });
  form.after(palette.element);
  const proxy = createPlacementSpatialProxy({
    viewer,
    components: options.components,
    debug: (enabled) => {
      runtime.engine.setDataSceneSpatialDebug(
        enabled ? { colliders: true, heightSpans: true } : null,
      );
    },
    finish: options.finishEdit,
    change: options.onChange,
    report,
  });
  palette.element.after(proxy.element);
  options.viewSettings.append(proxy.overlayControl);
  const planeSettings = document.createElement("div"),
    planeHeight = document.createElement("input"),
    planeFloor = document.createElement("input");
  planeSettings.className = "placement-working-plane";
  for (const [input, label, field] of [
    [planeHeight, "Working plane height", "elevation"],
    [planeFloor, "Working plane floor", "floorId"],
  ] as const) {
    const row = document.createElement("label");
    input.type = "number";
    input.min = field === "floorId" ? "0" : "-1000000";
    input.max = field === "floorId" ? "65535" : "1000000";
    input.step = field === "floorId" ? "1" : "any";
    input.dataset.placementWorkingPlane = field;
    setUiAttribute(input, "aria-label", label);
    row.append(uiText(label), input);
    planeSettings.append(row);
    input.addEventListener("change", () => {
      const value = input.valueAsNumber;
      if (drag || !input.validity.valid || !Number.isFinite(value)) {
        input.value = String((active.workingPlane ?? { elevation: 0, floorId: 0 })[field]);
        return;
      }
      const previous = active.workingPlane;
      active.workingPlane = { elevation: 0, floorId: 0, ...previous, [field]: value };
      try {
        setCamera();
        report();
      } catch (error) {
        active.workingPlane = previous;
        input.value = String((previous ?? { elevation: 0, floorId: 0 })[field]);
        report(error);
      }
      updateSpatialInfo();
      options.gridChanged?.(state);
    });
  }
  options.viewSettings.append(planeSettings);
  const objectActions = document.createElement("div"),
    rename = document.createElement("input");
  setUiAttribute(rename, "aria-label", "Spatial object ID");
  rename.dataset.placementSpatialRename = "true";
  objectActions.className = "placement-spatial-object-actions";
  objectActions.append(rename);
  for (const [action, label] of [
    ["rename", "Rename"],
    ["duplicate", "Duplicate"],
    ["remove", "Remove"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    setUiText(button, label);
    button.dataset.placementSpatialAction = action;
    button.addEventListener("click", () => {
      try {
        if (!cancel()) return;
        options.finishEdit();
        const id = viewer.state().selectedInstanceId;
        if (!id) return;
        const next =
          action === "rename"
            ? viewer.renameInstance(id, rename.value.trim())
            : action === "duplicate"
              ? viewer.duplicateInstances([id])
              : viewer.removeInstance(id);
        options.onChange(next);
        report();
      } catch (error) {
        report(error);
      }
    });
    objectActions.append(button);
  }
  form.before(objectActions);
  const snapRow = document.createElement("label"),
    snapToggle = document.createElement("input"),
    support = document.createElement("output");
  snapRow.className = "placement-spatial-snap";
  snapToggle.type = "checkbox";
  snapToggle.dataset.placementSpatialSnap = "true";
  setUiAttribute(snapToggle, "aria-label", "Spatial grid snap");
  snapRow.append(snapToggle, uiText(" Snap "), support);
  options.viewSettings.append(snapRow);
  const updateSnap = () => {
    options.setSnap({ enabled: snapToggle.checked, gridSize: options.snap().gridSize });
  };
  snapToggle.addEventListener("change", updateSnap);
  const floorPanel = document.createElement("details"),
    floorSummary = document.createElement("summary"),
    floorRows = document.createElement("div"),
    focusFloor = document.createElement("select"),
    ghostLabel = document.createElement("label"),
    ghostToggle = document.createElement("input");
  setUiText(floorSummary, "Floor Visibility");
  setUiAttribute(focusFloor, "aria-label", "Active floor");
  focusFloor.dataset.placementFocusFloor = "true";
  ghostToggle.type = "checkbox";
  ghostToggle.dataset.placementGhostFloors = "true";
  ghostLabel.append(ghostToggle, uiText(" Ghost Other Floors"));
  floorPanel.append(floorSummary, focusFloor, ghostLabel, floorRows);
  panel.append(floorPanel);
  const floorsButton = document.createElement("button");
  floorsButton.type = "button";
  decorateViewportAction(floorsButton, "floors", "Floors");
  floorsButton.dataset.placementFloorControls = "true";
  floorsButton.addEventListener("click", () => {
    floorPanel.open = true;
    stage
      .closest(".demo-shell")
      ?.dispatchEvent(new CustomEvent("placement-show-properties"));
    floorPanel.scrollIntoView({ block: "nearest" });
  });
  floorGroup.append(focusFloor, floorsButton);
  const spatialInfo = document.createElement("output");
  spatialInfo.className = "placement-spatial-info";
  spatialInfo.dataset.placementSpatialInfo = "true";
  stage.append(spatialInfo);
  const ghosts = document.createElementNS(selection.namespaceURI, "svg");
  ghosts.classList.add("placement-floor-ghosts");
  ghosts.setAttribute("aria-hidden", "true");
  stage.append(ghosts);
  const candidates = document.createElement("div");
  candidates.className = "placement-spatial-candidates";
  candidates.hidden = true;
  candidates.setAttribute("role", "menu");
  stage.append(candidates);
  const filterChanged = () => {
    if (!cancel()) return;
    active.focusFloor =
      focusFloor.value === "all" ? undefined : Number(focusFloor.value);
    active.ghostOthers = ghostToggle.checked;
    visibilitySignature = "";
    ghostSignature = "";
    try {
      sync(viewer.state());
    } catch (error) {
      report(error);
    }
  };
  focusFloor.addEventListener("change", filterChanged);
  ghostToggle.addEventListener("change", filterChanged);
  floorPanel.addEventListener("toggle", () => {
    if (floorPanel.open && active.mode === "spatial")
      try {
        applyVisibility();
      } catch (error) {
        report(error);
      }
  });
  function allTargets(): Target[] {
    return state.spatial
      ? [
          ...state.spatial.terrain.map((s) => ({
            kind: "surface" as const,
            id: s.id,
          })),
          ...Object.keys(state.spatial.models ?? {}).map((id) => ({
            kind: "model" as const,
            id,
          })),
          ...Object.keys(state.spatial.billboards).map((id) => ({
            kind: "billboard" as const,
            id,
          })),
        ]
      : [];
  }
  function floorFor(target: Target): number {
    if (target.kind === "surface")
      return (
        state.spatial?.terrain.find((s) => s.id === target.id)?.floorId ?? 0
      );
    const instance = state.instances.find(
      (instance) => instance.instanceId === target.id,
    );
    if (instance?.body?.heightSpan)
      return instance.body.heightSpan.floorId ?? 0;
    const base = pose(target.id),
      model = state.spatial?.models?.[target.id],
      asset = model && models.get(model.contentId);
    const elevation =
      base.elevation +
      (model?.elevation ?? 0) +
      (asset ? asset.bounds[1] * (model?.scale ?? 1) : 0);
    const surfaces =
      state.spatial?.terrain.filter(
        (s) =>
          base.x >= s.x &&
          base.x <= s.x + s.width &&
          base.y >= s.y &&
          base.y <= s.y + s.depth,
      ) ?? [];
    const error = (s: (typeof surfaces)[number]) =>
      Math.abs(
        elevation -
          s.elevation -
          ((s.endElevation ?? s.elevation) - s.elevation) *
            (s.rampAxis === "x"
              ? (base.x - s.x) / s.width
              : (base.y - s.y) / s.depth),
      );
    return surfaces.sort((a, b) => error(a) - error(b))[0]?.floorId ?? 0;
  }
  function visible(target: Target) {
    const floor = floorFor(target);
    return (
      !(active.hiddenFloors ?? []).includes(floor) &&
      (active.focusFloor === undefined || floor === active.focusFloor)
    );
  }
  function applyVisibility() {
    if (active.mode !== "spatial") {
      ghosts.replaceChildren();
      return;
    }
    const targets = allTargets(),
      floors = [...new Set(targets.map(floorFor))].sort((a, b) => a - b),
      floorSignature = JSON.stringify(floors);
    if (floorRows.dataset.signature !== floorSignature) {
      floorRows.dataset.signature = floorSignature;
      floorRows.replaceChildren();
      focusFloor.replaceChildren();
      for (const value of ["all", ...floors.map(String)]) {
        const option = document.createElement("option");
        option.value = value;
        setUiText(
          option,
          value === "all" ? "All Floors" : uiMessage("Floor {0}", value),
        );
        focusFloor.append(option);
      }
      for (const floor of floors) {
        const label = document.createElement("label"),
          input = document.createElement("input");
        input.type = "checkbox";
        input.checked = !(active.hiddenFloors ?? []).includes(floor);
        input.dataset.placementFloorVisible = String(floor);
        label.append(input, " Floor " + floor);
        floorRows.append(label);
        input.addEventListener("change", () => {
          if (!cancel()) return;
          active.hiddenFloors = input.checked
            ? (active.hiddenFloors ?? []).filter((value) => value !== floor)
            : [...(active.hiddenFloors ?? []), floor];
          visibilitySignature = "";
          ghostSignature = "";
          sync(viewer.state());
        });
      }
    }
    if (active.focusFloor !== undefined && !floors.includes(active.focusFloor))
      active.focusFloor = undefined;
    for (const input of floorRows.querySelectorAll<HTMLInputElement>("input"))
      input.checked = !(active.hiddenFloors ?? []).includes(
        Number(input.dataset.placementFloorVisible),
      );
    focusFloor.value =
      active.focusFloor === undefined ? "all" : String(active.focusFloor);
    ghostToggle.checked = !!active.ghostOthers;
    const hidden = targets.filter((target) => !visible(target));
    const hiddenEntities = hidden
      .filter((target) => target.kind !== "surface")
      .flatMap((target) => {
        const handle = state.instances.find(
          (instance) => instance.instanceId === target.id,
        )?.entity;
        return handle ? [handle] : [];
      });
    const hiddenSurfaces = hidden
      .filter((target) => target.kind === "surface")
      .map((target) => target.id);
    const signature = JSON.stringify([hiddenEntities, hiddenSurfaces]);
    if (signature !== visibilitySignature) {
      if (
        !runtime.engine.setDataSceneSpatialPreviewFilter({
          hiddenEntities,
          hiddenSurfaces,
        })
      )
        throw new Error("Spatial preview visibility rejected");
      visibilitySignature = signature;
      ghostSignature = "";
      ghostRevision++;
    }
  }
  function frameTargets(selectedOnly: boolean) {
    if (!cancel() || !active.camera) return;
    const targets = allTargets().filter(
      (target) =>
        visible(target) && (!selectedOnly || target.id === active.target?.id),
    );
    const minimum = [Infinity, Infinity, Infinity],
      maximum = [-Infinity, -Infinity, -Infinity];
    let pointCount = 0;
    for (const target of targets)
      for (const point of worldGeometry(target)) {
        pointCount++;
        const values = [point.x, point.y, point.elevation];
        for (let axis = 0; axis < 3; axis++) {
          minimum[axis] = Math.min(minimum[axis], values[axis]);
          maximum[axis] = Math.max(maximum[axis], values[axis]);
        }
      }
    if (!pointCount) return;
    const center = {
      x: (minimum[0] + maximum[0]) / 2,
      y: (minimum[1] + maximum[1]) / 2,
      elevation: (minimum[2] + maximum[2]) / 2,
    };
    const camera = structuredClone(active.camera),
      dx = camera.position.x - camera.target.x,
      dy = camera.position.y - camera.target.y,
      dz = camera.position.elevation - camera.target.elevation;
    const radius = Math.max(
      1,
      Math.hypot(
        maximum[0] - minimum[0],
        maximum[1] - minimum[1],
        maximum[2] - minimum[2],
      ) / 2,
    );
    const aspect = Math.max(
      0.01,
      canvas.clientWidth / Math.max(1, canvas.clientHeight),
    );
    const limitingFov = Math.min(
      ((camera.fovDegrees ?? 60) * Math.PI) / 180,
      2 *
        Math.atan(
          Math.tan(((camera.fovDegrees ?? 60) * Math.PI) / 360) * aspect,
        ),
    );
    const distance =
      camera.projection === "perspective"
        ? (radius / Math.sin(limitingFov / 2)) * 1.3
        : Math.hypot(dx, dy, dz);
    const ratio = distance / Math.max(0.01, Math.hypot(dx, dy, dz));
    camera.target = center;
    camera.position = {
      x: center.x + dx * ratio,
      y: center.y + dy * ratio,
      elevation: center.elevation + dz * ratio,
    };
    if (camera.projection === "orthographic")
      camera.height = Math.max(1, (radius * 2.6) / Math.min(1, aspect));
    try {
      setCamera(camera);
    } catch (error) {
      report(error);
    }
  }
  for (const [label, selected] of [
    ["Frame", true],
    ["Fit Scene", false],
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    decorateViewportAction(button, selected ? "frame" : "fit", label);
    setUiAttribute(button, "title", selected ? "Center the selected object (F)" : "Show the entire scene (Home)");
    button.dataset.placementSpatialFrame = String(selected);
    button.addEventListener("click", () => frameTargets(selected));
    frameGroup.append(button);
  }
  canvas.addEventListener("contextmenu", (event) => {
    if (active.mode !== "spatial" || drag) return;
    event.preventDefault();
    candidates.replaceChildren();
    const hits = pickCandidates(event.clientX, event.clientY, true);
    for (const target of hits.slice(0, 64)) {
      const button = document.createElement("button");
      button.type = "button";
      setUiText(
        button,
        uiMessage(
          "{0} · {1} · Floor {2}",
          target.id,
          uiMessage(target.kind),
          floorFor(target),
        ),
      );
      button.setAttribute("role", "menuitem");
      button.dataset.placementPickCandidate = target.id;
      button.addEventListener("click", () => {
        choose(target);
        candidates.hidden = true;
      });
      candidates.append(button);
    }
    const rect = stage.getBoundingClientRect();
    candidates.style.left =
      Math.max(
        0,
        Math.min(stage.clientWidth - 180, event.clientX - rect.left),
      ) + "px";
    candidates.style.top =
      Math.max(
        0,
        Math.min(stage.clientHeight - 120, event.clientY - rect.top),
      ) + "px";
    candidates.hidden = !hits.length;
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag && !spaceHeld && navigationTool === "select")
      palette.move({ x: event.clientX, y: event.clientY });
  });
  function authoredDocument() {
    const base = options.document(),
      patch = viewer.exportPatch();
    return patch ? mergeScenePlacementPatch(base, patch).document : base;
  }
  function commitGameCamera(camera: SpatialCameraSpec) {
    if ((active.mode !== "spatial" && !liveGameCamera()) || suspended || !cancel()) return false;
    previewCamera = undefined;
    options.finishEdit();
    try {
      viewer.beginEdit("Game Camera");
      cameraTransaction = true;
      options.onChange(viewer.updateSpatial([{ kind: "setCamera", changes: { camera } }]));
      const committed = viewer.commitEdit();
      cameraTransaction = false;
      options.onChange(committed);
      report();
      return true;
    } catch (error) {
      if (cameraTransaction && !cancel()) return false;
      report(error);
      return false;
    }
  }
  function liveGameCamera() {
    return active.mode === "game" && !!active.paused && !!active.gameFrame && !!state.spatial;
  }
  function previewGameCameraInput(camera?: SpatialCameraSpec) {
    if (!liveGameCamera()) { previewCamera = undefined; return; }
    const next = camera ?? state.spatial!.camera;
    const size = runtime.renderer.viewportSize();
    if (!(size.width > 0 && size.height > 0)) return;
    if (!runtime.engine.setDataSceneSpatialCamera(next, size)) throw new Error("Game camera preview rejected");
    previewCamera = camera;
  }
  function previewGameCamera() {
    if (suspended || canvas.closest<HTMLElement>(".demo-shell")?.inert || !state.spatial || !gameCamera.flushInput()) return;
    changeMode("game");
    if (active.mode !== "game") return;
    try {
      if (!runtime.engine.pauseDataScene()) throw new Error("Preview playback change rejected");
      active.paused = true; active.gameFrame = true;
      options.onChange(viewer.state());
      canvas.focus({ preventScroll: true });
    } catch (error) {
      changeMode(active.returnMode ?? "spatial");
      report(error);
    }
  }
  function changeMode(mode: Mode) {
    if (mode === active.mode) return;
    if (mode === "spatial" && !state.spatial) return;
    if (!gameCamera.cancelGesture() || !gameCamera.flushInput()) return;
    if (options.flushSceneSettings?.() === false) return;
    if (!cancel()) return;
    previewCamera = undefined;
    options.finishEdit();
    const previous = active.mode;
    const previousPaused = active.paused,
      previousReturnMode = active.returnMode,
      previousGameFrame = active.gameFrame;
    if (mode === "game" && previous !== "game") active.returnMode = previous;
    active.paused = false;
    active.gameFrame = false;
    active.mode = mode;
    signature = "";
    try {
      options.onChange(viewer.state());
    } catch (error) {
      active.mode = previous;
      active.paused = previousPaused;
      active.returnMode = previousReturnMode;
      active.gameFrame = previousGameFrame;
      signature = "";
      options.onChange(viewer.state());
      report(error);
    }
  }
  function setCamera(camera = active.camera) {
    if (active.mode !== "spatial" || !camera) return;
    const size = runtime.renderer.viewportSize();
    // A hidden/minimized host can briefly have no drawable surface. Resize
    // will retry when positive dimensions return; native requires both > 0.
    if (!(size.width > 0 && size.height > 0)) return;
    palette.clearPreview();
    const renderCamera = spatialEditorRenderCamera(camera, active.workingPlane?.elevation ?? 0);
    if (!runtime.engine.setDataSceneSpatialCamera(renderCamera, size))
      throw new Error("Spatial edit camera rejected");
    // Commit the UI camera only after native validation accepts it.
    active.camera = camera;
    gameCamera.sync();
    syncPitchControls();
    Object.assign(window, {
      ferrumPlacementSpatialCamera: structuredClone(active.camera),
      ferrumPlacementSpatialRenderCamera: structuredClone(renderCamera),
    });
  }
  function zoomedCamera(camera: SpatialCameraSpec, factor: number) {
    if (camera.projection === "orthographic")
      camera.height = Math.max(1, Math.min(1e6, (camera.height ?? 200) * factor));
    else {
      const dx = camera.position.x - camera.target.x,
        dy = camera.position.y - camera.target.y,
        dz = camera.position.elevation - camera.target.elevation,
        distance = Math.hypot(dx, dy, dz),
        near = camera.near ?? 0.1,
        far = camera.far ?? 10000,
        minimum = Math.min(Math.max(1, near * 2), (near + far) / 2),
        maximum = Math.max(minimum, Math.min(1e6, far * 0.9)),
        nextDistance = Math.max(minimum, Math.min(maximum, distance * factor)),
        ratio = nextDistance / distance;
      camera.position = {
        x: camera.target.x + dx * ratio,
        y: camera.target.y + dy * ratio,
        elevation: camera.target.elevation + dz * ratio,
      };
    }
    return camera;
  }
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (active.mode !== "spatial") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (
        !active.camera ||
        drag ||
        cameraTransaction ||
        suspended ||
        palette.ownsDrag() ||
        canvas.closest<HTMLElement>(".demo-shell")?.inert ||
        !Number.isFinite(event.deltaY)
      ) return;
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? canvas.clientHeight
            : 1;
      try {
        setCamera(
          zoomedCamera(
            structuredClone(active.camera),
            Math.exp(Math.max(-500, Math.min(500, event.deltaY * unit)) * 0.002),
          ),
        );
        report();
      } catch (error) {
        report(error);
      }
    },
    { passive: false },
  );
  function projectionSnapshot(): PlaneProjection | undefined {
    if (!frame) return;
    const rect = canvas.getBoundingClientRect(),
      presentation = frame.presentation;
    return {
      camera: frame.camera.slice(),
      rect:
        presentation && presentation[4] > 0
          ? {
              left: rect.left + rect.width * presentation[0],
              top: rect.top + rect.height * presentation[1],
              width: rect.width * presentation[2],
              height: rect.height * presentation[3],
            }
          : {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            },
    };
  }
  function choose(target?: Target) {
    active.target = target;
    options.onChange(
      target && target.kind !== "surface"
        ? viewer.selectInstance(target.id)
        : viewer.selectInstances([]),
    );
  }
  function selectedInstance(origin = state) {
    return origin.instances.find((i) => i.instanceId === active.target?.id);
  }
  function editField(name: string, value: number, origin = viewer.state()) {
    const target = active.target,
      spatial = origin.spatial;
    if (!target || !spatial) return;
    if (
      target.kind !== "surface" &&
      spatial.attachments?.[target.id] &&
      ["x", "y", "elevation", "floorId"].includes(name)
    )
      throw new Error(
        "Attached instance placement is owned by its attachment source",
      );
    if (target.kind === "surface") {
      const surface = spatial.terrain.find((s) => s.id === target.id);
      if (!surface) return;
      const changes: Extract<
        SceneSpatialPatchOperation,
        { kind: "updateTerrainSurface" }
      >["changes"] = {};
      if (name === "elevation") {
        const delta = value - surface.elevation;
        changes.elevation = value;
        if (surface.endElevation !== undefined)
          changes.endElevation = surface.endElevation + delta;
        if (surface.baseElevation !== undefined)
          changes.baseElevation = surface.baseElevation + delta;
      } else if (name === "x" || name === "y" || name === "floorId")
        changes[name] = value;
      else return;
      options.onChange(
        viewer.updateSpatial([
          { kind: "updateTerrainSurface", id: target.id, changes },
        ]),
      );
    } else {
      const instance = selectedInstance(origin);
      if (!instance) return;
      if (origin.lockedInstanceIds.includes(target.id)) return;
      if (target.kind === "billboard" && name === "yaw" && spatial.actor?.instanceId === target.id)
        throw new Error("Player rotation requires an unrotated AABB collider. Change facing through animation.");
      if (name === "x" || name === "y")
        options.onChange(
          viewer.updateInstanceTransform(target.id, { [name]: value }),
        );
      else if (name === "elevation" || name === "floorId") {
        if (!instance.body?.heightSpan)
          throw new Error(
            "Body heightSpan must be authored before editing physical height",
          );
        // Use the existing public component path, preserving every other component field.
        const doc = authoredDocument(),
          resolved = resolveSceneAuthoringDocument(doc, {
            validateBindings: true,
            validateComponents: true,
            missingBehavior: "ignore",
          });
        const raw = resolved.bindingPlan?.instances.find(
          (i) => i.id === target.id,
        )?.props.components;
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
          throw new Error("Inline component source required");
        const components = structuredClone(raw);
        const body = {
          ...instance.body,
          heightSpan: { ...instance.body.heightSpan, [name]: value },
        };
        options.onChange(
          viewer.updateInstanceComponents(target.id, { ...components, body }),
        );
      } else if (
        target.kind === "model" &&
        (name === "offset" || name === "yaw" || name === "scale")
      ) {
        const changes =
          name === "offset"
            ? { elevation: value }
            : name === "yaw"
              ? { yawDegrees: value }
              : { scale: value };
        options.onChange(
          viewer.updateSpatial([
            { kind: "updateModel", id: target.id, changes },
          ]),
        );
      } else if (target.kind === "billboard" && name === "offset")
        options.onChange(
          viewer.updateSpatial([
            {
              kind: "updateBillboard",
              id: target.id,
              changes: { elevation: value },
            },
          ]),
        );
      else if (
        target.kind === "billboard" && (name === "yaw" || name === "scale")
      )
        options.onChange(
          viewer.updateInstanceTransform(
            target.id,
            name === "yaw"
              ? { rotationRadians: value * Math.PI / 180 }
              : { scale: value },
          ),
        );
    }
  }
  function sync(next: ScenePlacementViewerState, resetInputs = false) {
    state = next;
    if (document.activeElement !== planeHeight) planeHeight.value = String(active.workingPlane?.elevation ?? 0);
    if (document.activeElement !== planeFloor) planeFloor.value = String(active.workingPlane?.floorId ?? 0);
    // A remove/Undo can discard the selected visual identity before the next frame.
    // Never let the overlay dereference a stale target and interrupt the render loop.
    if (
      active.target &&
      (active.target.kind === "surface"
        ? !state.spatial?.terrain.some(
            (surface) => surface.id === active.target!.id,
          )
        : !state.instances.some(
            (instance) => instance.instanceId === active.target!.id,
          ))
    )
      active.target = undefined;
    if (suspended) return next;
    palette.sync();
    proxy.sync(state);
    const snap = options.snap();
    snapToggle.checked = snap.enabled;
    if (state.selectedInstanceId && state.spatial) {
      if (state.spatial.models?.[state.selectedInstanceId])
        active.target = { kind: "model", id: state.selectedInstanceId };
      else if (state.spatial.billboards[state.selectedInstanceId])
        active.target = { kind: "billboard", id: state.selectedInstanceId };
    }
    stage.dataset.workspaceMode = active.mode;
    stage.dataset.spatialActor = state.spatial?.actor?.instanceId ?? "";
    if (active.mode !== "spatial") spaceHeld = false;
    syncNavigationTool();
    for (const [mode, button] of buttons) {
      button.setAttribute("aria-pressed", String(mode === active.mode));
      button.disabled = mode === "spatial" && !state.spatial;
    }
    panel.hidden = active.mode !== "spatial";
    palette.element.hidden = panel.hidden;
    spatialInfo.hidden = panel.hidden;
    play.disabled = active.mode === "game";
    pause.disabled = stop.disabled = active.mode !== "game";
    play.hidden = active.mode === "game";
    pause.hidden = stop.hidden = active.mode !== "game";
    if (active.mode !== "spatial") cameraMenu.close();
    const pauseLabel = active.paused ? "Resume" : "Pause";
    if (pause.dataset.caption !== pauseLabel) {
      decorateViewportAction(pause, active.paused ? "play" : "pause", pauseLabel, undefined, true);
      setUiAttribute(pause, "title", "Pause or resume the running scene");
      pause.dataset.caption = pauseLabel;
    }
    controls.dataset.playbackState =
      active.mode === "game"
        ? active.paused
          ? "paused"
          : "playing"
        : "stopped";
    const addForm = inspector?.querySelector<HTMLElement>(
      ".placement-add-controls",
    );
    if (addForm) addForm.hidden = active.mode !== "2d";
    cameraControls.hidden = !state.spatial || active.mode === "2d";
    for (const group of [toolsGroup, cameraMenu.element, frameGroup, floorGroup]) group.hidden = active.mode !== "spatial";
    gameCameraLaunch.setAttribute("aria-pressed", String(liveGameCamera()));
    gameCameraLaunch.disabled = suspended || !!drag || cameraTransaction;
    syncPitchControls();
    gameCamera.sync(resetInputs);
    const importDisabled = active.mode === "game" || suspended;
    modelKey.disabled = modelFile.disabled = importDisabled;
    for (const section of inspector?.querySelectorAll<HTMLDetailsElement>(
      ".placement-inspector-section",
    ) ?? []) {
      const sectionId = section.dataset.section;
      if (
        sectionId &&
        [
          "transform",
          "object",
          "visual",
          "collider",
          "behavior-binding",
        ].includes(sectionId)
      )
        section.hidden = active.mode !== "2d";
    }
    for (const form of inspector?.querySelectorAll<HTMLElement>(
      ".placement-controls",
    ) ?? [])
      form.inert = active.mode !== "2d";
    const componentsForm = inspector?.querySelector<HTMLElement>(
      ".placement-component-controls",
    );
    if (componentsForm) componentsForm.hidden = active.mode !== "2d";
    const nextSignature =
      key + "|" + active.mode + "|" + JSON.stringify(state.draftPatch ?? null);
    if (!applying && nextSignature !== signature) {
      signature = nextSignature;
      applying = true;
      try {
        if (state.spatial || active.mode === "game" || appliedMode === "game") {
          visibilitySignature = "";
          ghostSignature = "";
          options.apply(
            active.mode === "2d" && !state.spatial
              ? options.document()
              : authoredDocument(),
          );
          state = viewer.state();
        }
        if (active.mode === "2d" && state.spatial) {
          runtime.engine.clearDataSceneSpatial();
          runtime.engine.pauseDataScene();
        } else if (active.mode === "spatial") {
          runtime.engine.pauseDataScene();
          active.camera ??= structuredClone(state.spatial!.camera);
          setCamera();
        } else if (active.mode === "game") {
          if (active.paused) runtime.engine.pauseDataScene();
          else runtime.engine.resumeDataScene();
        }
        appliedMode = active.mode;
      } catch (error) {
        signature = "";
        throw error;
      } finally {
        applying = false;
      }
    }
    applyVisibility();
    options.gridChanged?.(state);
    if (active.mode === "spatial")
      runtime.engine.setDataSceneSpatialDebug(
        proxy.overlay() ? { colliders: true, heightSpans: true } : null,
      );
    const selected = active.target,
      spatial = state.spatial;
    objectActions.hidden = !selected || selected.kind === "surface";
    if (document.activeElement !== rename) rename.value = selected?.id ?? "";
    const entries: Target[] = spatial
      ? [
          ...spatial.terrain.map((s) => ({
            kind: "surface" as const,
            id: s.id,
          })),
          ...Object.keys(spatial.models ?? {}).map((id) => ({
            kind: "model" as const,
            id,
          })),
          ...Object.keys(spatial.billboards).map((id) => ({
            kind: "billboard" as const,
            id,
          })),
        ]
      : [];
    const targetSignature = entries.map((t) => t.kind + ":" + t.id).join("|");
    if (targetSelect.dataset.signature !== targetSignature) {
      const noSelection = document.createElement("option");
      noSelection.value = "";
      noSelection.disabled = true;
      setUiText(noSelection, "No selection");
      targetSelect.replaceChildren(
        noSelection,
        ...entries.map((t) => {
          const option = document.createElement("option");
          option.value = t.kind + ":" + t.id;
          setUiText(option, uiMessage("{0} / {1}", uiMessage(t.kind), t.id));
          return option;
        }),
      );
      targetSelect.dataset.signature = targetSignature;
    }
    targetSelect.value = selected ? selected.kind + ":" + selected.id : "";
    const instance = selectedInstance(),
      surface = spatial?.terrain.find(
        (s) => selected?.kind === "surface" && s.id === selected.id,
      );
    const model =
        selected?.kind === "model" ? spatial?.models?.[selected.id] : undefined,
      billboard =
        selected?.kind === "billboard"
          ? spatial?.billboards[selected.id]
          : undefined;
    const values: Record<string, number | undefined> = {
      x: surface?.x ?? instance?.transform.x,
      y: surface?.y ?? instance?.transform.y,
      elevation: surface?.elevation ?? instance?.body?.heightSpan?.elevation,
      floorId: surface?.floorId ?? instance?.body?.heightSpan?.floorId,
      offset: model || billboard
        ? (model?.elevation ?? billboard?.elevation ?? 0)
        : undefined,
      yaw: model ? (model.yawDegrees ?? 0)
        : billboard && instance ? instance.transform.rotationRadians * 180 / Math.PI
          : undefined,
      scale: model ? (model.scale ?? 1)
        : billboard && instance ? instance.transform.scale : undefined,
    };
    setUiText(fieldLabels.get("yaw")!, model ? "Model Yaw (°)" : "Sprite Rotation (°)");
    setUiText(fieldLabels.get("scale")!, model ? "Model Scale" : "Sprite Scale");
    const locked =
      selected?.kind !== "surface" &&
      selected &&
      state.lockedInstanceIds.includes(selected.id);
    const actorRotation = !!billboard && spatial?.actor?.instanceId === selected?.id;
    setUiText(editHint, !selected
      ? "Select an object, then edit its properties in Inspector."
      : locked
      ? "Unlock the object to edit its placement."
      : actorRotation
        ? "Player rotation requires an unrotated AABB collider. Change facing through animation."
        : selected?.kind === "surface"
          ? "Drag to move. Use Height to raise or lower the surface."
          : selected && spatial?.attachments?.[selected.id]
            ? "Position and physical height are owned by the attachment source."
            : "Drag to move. Use the height and rotation icons, or edit numeric fields.");
    for (const [name, input] of fields) {
      input.parentElement!.hidden = values[name] === undefined;
      input.disabled =
        values[name] === undefined ||
        !!locked ||
        (name === "yaw" && actorRotation) ||
        !!(
          selected &&
          selected.kind !== "surface" &&
          spatial?.attachments?.[selected.id] &&
          ["x", "y", "elevation", "floorId"].includes(name)
        );
      if (resetInputs || document.activeElement !== input)
        input.value = values[name] === undefined ? "" : String(values[name]);
    }
    publish();
    setUiText(
      support,
      values.floorId === undefined
        ? "Visual Only"
        : uiMessage("Selected Floor {0}", values.floorId),
    );
    const bodyHeight = instance?.body?.heightSpan?.height;
    spatialInfo.dataset.selection = selected?.id ?? "";
    spatialInfo.dataset.selectionHeight =
      values.elevation === undefined ? "" : String(values.elevation);
    spatialInfo.dataset.selectionFloor =
      values.floorId === undefined ? "" : String(values.floorId);
    spatialInfo.dataset.heightSpan =
      bodyHeight === undefined ? "" : String(bodyHeight);
    spatialInfo.dataset.visualOffset =
      values.offset === undefined ? "" : String(values.offset);
    updateSpatialInfo();
    return state;
  }
  function updateSpatialInfo() {
    const hit = palette.support();
    setUiText(
      spatialInfo,
      uiMessage(
        "View: {0} · Selected: {1} / {2} / H {3}{4} / Visual {5} · Placement: {6}",
        active.focusFloor === undefined
          ? uiMessage("All Floors")
          : uiMessage("Floor {0}", active.focusFloor),
        spatialInfo.dataset.selection || uiMessage("None"),
        spatialInfo.dataset.selectionFloor
          ? uiMessage("Floor {0}", spatialInfo.dataset.selectionFloor)
          : uiMessage("Visual Only"),
        spatialInfo.dataset.selectionHeight || "—",
        spatialInfo.dataset.heightSpan
          ? " + " + spatialInfo.dataset.heightSpan
          : "",
        spatialInfo.dataset.visualOffset || "—",
        hit
          ? uiMessage(
              "{0} / H {1} / {2}",
              hit.floor ? uiMessage("Floor {0}", hit.floor) : uiMessage("Visual Only"),
              hit.elevation,
              hit.kind === "plane" ? uiMessage("Working plane · no terrain support") : hit.surface,
            )
          : uiMessage("No Support"),
      ),
    );
  }
  function publish() {
    Object.assign(window, {
      ferrumPlacementWorkspaceMode: active.mode,
      ferrumPlacementSpatialTarget: active.target
        ? { ...active.target }
        : undefined,
    });
  }
  Object.assign(window, {
    ferrumPlacementSpatialProject: (point: SpatialPoint) =>
      frame ? view.project(point, frame) : undefined,
    ferrumPlacementSpatialExportDocument: authoredDocument,
  });
  function pose(
    id: string,
    origin = state,
    seen = new Set<string>(),
  ): SpatialPoint & { yaw: number } {
    if (seen.has(id)) throw new Error("Attachment cycle");
    seen.add(id);
    const instance = origin.instances.find((i) => i.instanceId === id);
    if (!instance) throw new Error("Unknown spatial instance");
    const attachment = origin.spatial?.attachments?.[id];
    if (!attachment)
      return {
        x: instance.transform.x,
        y: instance.transform.y,
        elevation: instance.body?.heightSpan?.elevation ?? 0,
        // Instance rotation is the sprite's local angle. Native body yaw starts
        // at zero for authored roots and is accumulated separately by attachments.
        yaw: 0,
      };
    const parent = pose(attachment.parent, origin, seen),
      angle = parent.yaw;
    return {
      x:
        parent.x +
        (attachment.x ?? 0) * Math.cos(angle) -
        (attachment.y ?? 0) * Math.sin(angle),
      y:
        parent.y +
        (attachment.x ?? 0) * Math.sin(angle) +
        (attachment.y ?? 0) * Math.cos(angle),
      elevation: parent.elevation + (attachment.elevation ?? 0),
      yaw: angle + ((attachment.yawDegrees ?? 0) * Math.PI) / 180,
    };
  }
  function worldGeometry(target: Target): SpatialPoint[] {
    if (!state.spatial) return [];
    let points: SpatialPoint[] = [];
    if (target.kind === "surface") {
      const s = state.spatial.terrain.find((s) => s.id === target.id);
      if (!s) return [];
      points = [
        [s.x, s.y],
        [s.x + s.width, s.y],
        [s.x + s.width, s.y + s.depth],
        [s.x, s.y + s.depth],
      ].map(([x, y]) => ({
        x,
        y,
        elevation:
          s.elevation +
          ((s.endElevation ?? s.elevation) - s.elevation) *
            (s.rampAxis === "x" ? (x - s.x) / s.width : (y - s.y) / s.depth),
      }));
    } else {
      const instance = state.instances.find((i) => i.instanceId === target.id);
      if (!instance) return [];
      const base = pose(target.id);
      if (target.kind === "model") {
        const model = state.spatial.models?.[target.id],
          asset = model ? models.get(model.contentId) : undefined;
        if (!model || !asset) return [];
        const levels = [
          asset,
          ...(model.lods ?? []).map((lod) => models.get(lod.contentId)),
        ];
        if (levels.some((level) => !level)) return [];
        // Native visibility uses the common bounds of all authored LODs.
        const b = Array.from({ length: 6 }, (_, i) =>
            (i < 3 ? Math.min : Math.max)(
              ...levels.map((level) => level!.bounds[i]),
            ),
          ),
          s = model.scale ?? 1,
          a = base.yaw + ((model.yawDegrees ?? 0) * Math.PI) / 180;
        for (const x of [b[0], b[3]])
          for (const y of [b[1], b[4]])
            for (const z of [b[2], b[5]])
              points.push({
                x: base.x + s * (x * Math.cos(a) + z * Math.sin(a)),
                y: base.y + s * (x * Math.sin(a) - z * Math.cos(a)),
                elevation: base.elevation + (model.elevation ?? 0) + s * y,
              });
      } else {
        const visual = instance.visual,
          b = state.spatial.billboards[target.id];
        if (!visual || !b || !active.camera) return [];
        const dx = active.camera.target.x - active.camera.position.x,
          dy = active.camera.target.y - active.camera.position.y,
          len = Math.hypot(dx, dy),
          rx = dy / len,
          ry = -dx / len;
        const size = (b.unitsPerPixel ?? 1) * instance.transform.scale,
          angle = instance.transform.rotationRadians + base.yaw;
        const ox = visual.kind === "sprite" ? visual.originX : 0.5,
          oy = visual.kind === "sprite" ? visual.originY : 0.5;
        for (const [u, v] of [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ]) {
          const x = (u - ox) * visual.bounds.width * size,
            y = (oy - v) * visual.bounds.height * size,
            h = x * Math.sin(angle) + y * Math.cos(angle),
            w = x * Math.cos(angle) - y * Math.sin(angle);
          points.push({
            x: base.x + rx * w,
            y: base.y + ry * w,
            elevation: base.elevation + (b.elevation ?? 0) + h,
          });
        }
      }
    }
    return points;
  }
  function projectedGeometry(target: Target): Point[] {
    if (!frame) return [];
    const projected = worldGeometry(target).map((p) => view.project(p, frame!));
    if (projected.length === 0) return [];
    if (projected.some((p) => !p || p.depth < -1 || p.depth > 1)) return [];
    return projected.filter((p): p is NonNullable<typeof p> => !!p);
  }
  function geometry(target: Target): Point[] {
    const valid = projectedGeometry(target);
    if (!valid.length) return [];
    if (target.kind === "model") {
      const left = Math.min(...valid.map((p) => p.x)),
        right = Math.max(...valid.map((p) => p.x)),
        top = Math.min(...valid.map((p) => p.y)),
        bottom = Math.max(...valid.map((p) => p.y)),
        depth = Math.min(...valid.map((p) => p.depth));
      return [
        { x: left, y: top, depth },
        { x: right, y: top, depth },
        { x: right, y: bottom, depth },
        { x: left, y: bottom, depth },
      ];
    }
    return valid;
  }
  function pickDepth(target: Target, x: number, y: number) {
    const points = projectedGeometry(target);
    if (!points.length) return;
    let nearest: number | undefined;
    for (const [a, b, c, d] of target.kind === "model" ? MODEL_FACES : [[0, 1, 2, 3]]) {
      for (const triangle of [[a, b, c], [a, c, d]]) {
        const depth = triangleDepth(points[triangle[0]], points[triangle[1]], points[triangle[2]], x, y);
        if (depth !== undefined && (nearest === undefined || depth < nearest)) nearest = depth;
      }
    }
    return nearest;
  }
  function pickCandidates(
    x: number,
    y: number,
    includeOccluded = false,
  ): Target[] {
    if (!frame || !state.spatial) return [];
    const hits: { target: Target; depth: number }[] = [];
    const surface = view.pick({ x, y }, frame);
    if (surface) {
      const projected = view.project(surface, frame);
      if (projected)
        hits.push({
          target: { kind: "surface", id: surface.surfaceId },
          depth: projected.depth,
        });
    }
    for (const target of includeOccluded
      ? allTargets().filter(
          (target) =>
            target.kind === "surface" &&
            visible(target) &&
            target.id !== surface?.surfaceId,
        )
      : []) {
      const depth = pickDepth(target, x, y);
      if (depth !== undefined) hits.push({ target, depth });
    }
    const locked = new Set(state.lockedInstanceIds);
    for (const kind of ["model", "billboard"] as const)
      for (const id of Object.keys(
        kind === "model"
          ? (state.spatial.models ?? {})
          : state.spatial.billboards,
      )) {
        if (locked.has(id) || !visible({ kind, id })) continue;
        const target = { kind, id },
          depth = pickDepth(target, x, y);
        if (depth !== undefined) hits.push({ target, depth });
      }
    return hits.sort((a, b) => a.depth - b.depth).map((hit) => hit.target);
  }
  function pick(x: number, y: number) {
    return pickCandidates(x, y)[0];
  }
  function cancel() {
    if (!gameCamera.cancelGesture()) return false;
    candidates.hidden = true;
    palette.cancel();
    const previous = drag;
    if (!previous) {
      if (!cameraTransaction) return true;
      try {
        options.onChange(viewer.cancelEdit());
      } catch (error) {
        report(error);
        return false;
      }
      cameraTransaction = false;
      syncNavigationTool();
      gameCamera.sync(true);
      return true;
    }
    if (previous.kind === "camera") {
      try {
        setCamera(previous.camera);
      } catch (error) {
        report(error);
      }
    } else {
      try {
        options.onChange(viewer.cancelEdit());
      } catch (error) {
        // The host can reject restoration while retaining the last accepted
        // draft and open transaction. Keep ownership until cancellation succeeds.
        previous.cancelRequested = true;
        try {
          options.onChange(viewer.state());
        } catch (refreshError) {
          report(refreshError);
        }
        report(error);
        return false;
      }
    }
    drag = undefined;
    syncNavigationTool();
    if (previous.target.hasPointerCapture(previous.id))
      previous.target.releasePointerCapture(previous.id);
    return true;
  }
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (
        active.mode !== "spatial" ||
        !frame ||
        (event.button !== 0 && event.button !== 1)
      )
        return;
      if ((drag || cameraTransaction) && !cancel()) return;
      candidates.hidden = true;
      canvas.focus({ preventScroll: true });
      event.preventDefault();
      event.stopImmediatePropagation();
      const camera =
        event.button === 1 || event.altKey || spaceHeld || navigationTool === "pan";
      if (!camera && palette.pending()) {
        palette.place({ x: event.clientX, y: event.clientY });
        return;
      }
      if (!camera) {
        const target = pick(event.clientX, event.clientY);
        if (!target) {
          options.finishEdit();
          choose();
          return;
        }
        choose(target);
      }
      options.finishEdit();
      const projection = projectionSnapshot();
      if (!projection) return;
      const terrainHit = camera
          ? undefined
          : view.pick({ x: event.clientX, y: event.clientY }, frame),
        selected = active.target,
        base =
          selected && selected.kind !== "surface"
            ? pose(selected.id)
            : undefined,
        visual =
          selected?.kind === "model"
            ? state.spatial?.models?.[selected.id]
            : selected?.kind === "billboard"
              ? state.spatial?.billboards[selected.id]
              : undefined,
        elevation = camera
          ? active.camera?.target.elevation
          : selected?.kind === "surface"
            ? terrainHit?.elevation
            : base
              ? base.elevation + (visual?.elevation ?? 0)
              : undefined,
        hit =
          elevation === undefined
            ? undefined
            : pointOnElevationPlane(
                { x: event.clientX, y: event.clientY },
                elevation,
                projection,
              );
      if (!hit) return;
      if (!camera) viewer.beginEdit("Spatial Move");
      drag = {
        id: event.pointerId,
        target: canvas,
        startX: event.clientX,
        startY: event.clientY,
        origin: viewer.state(),
        kind: camera ? "camera" : "move",
        camera: structuredClone(active.camera),
        projection,
        selected: active.target,
        hit,
      };
      canvas.setPointerCapture(event.pointerId);
      syncNavigationTool();
    },
    true,
  );
  function transformRestriction(kind: "height" | "rotate") {
    const target = active.target;
    if (!target) return "Select an object, then edit its properties in Inspector.";
    if (target.kind !== "surface" && state.lockedInstanceIds.includes(target.id))
      return "Unlock the object to edit its placement.";
    if (kind === "height" && target.kind !== "surface" && state.spatial?.attachments?.[target.id])
      return "Position and physical height are owned by the attachment source.";
    if (kind === "rotate" && target.kind === "surface")
      return "Terrain surfaces cannot rotate";
    if (kind === "rotate" && target.kind === "billboard" && state.spatial?.actor?.instanceId === target.id)
      return "Player rotation requires an unrotated AABB collider. Change facing through animation.";
  }
  function rotationDegrees(origin: ScenePlacementViewerState) {
    const target = active.target;
    return target?.kind === "model"
      ? (origin.spatial?.models?.[target.id]?.yawDegrees ?? 0)
      : (selectedInstance(origin)?.transform.rotationRadians ?? 0) * 180 / Math.PI;
  }
  function editHeight(delta: number, origin: ScenePlacementViewerState, quantize = (value: number) => value) {
    const target = active.target;
    if (!target) return;
    if (target.kind === "surface") {
      const surface = origin.spatial?.terrain.find((s) => s.id === target.id);
      if (surface) editField("elevation", quantize(surface.elevation + delta), origin);
    } else {
      const instance = selectedInstance(origin);
      if (instance?.body?.heightSpan)
        editField("elevation", quantize(instance.body.heightSpan.elevation + delta), origin);
      else {
        const visual = target.kind === "model"
          ? origin.spatial?.models?.[target.id]
          : origin.spatial?.billboards[target.id];
        editField("offset", quantize((visual?.elevation ?? 0) + delta), origin);
      }
    }
  }
  for (const [handle, kind] of [[heightHandle, "height"], [rotateHandle, "rotate"]] as const) {
    handle.addEventListener("pointerdown", (event) => {
      if (
        event.button !== 0 ||
        active.mode !== "spatial" ||
        !frame ||
        !active.target ||
        navigationTool === "pan" || spaceHeld || event.altKey ||
        transformRestriction(kind)
      ) return;
      // A transform replaces pending placement so its first Escape cancels the edit.
      if (!cancel()) return;
      event.preventDefault();
      event.stopPropagation();
      options.finishEdit();
      const projection = projectionSnapshot(),
        heightAnchor = kind === "height" ? worldGeometry(active.target)
          .map((point) => ({
            point,
            screenY: view.project(point, frame!)?.y,
          }))
          .filter(
            (anchor): anchor is { point: SpatialPoint; screenY: number } =>
              anchor.screenY !== undefined,
          )
          .sort((a, b) => a.screenY - b.screenY)[0] : undefined;
      if (kind === "height" && (!projection || !heightAnchor)) return;
      viewer.beginEdit(kind === "height" ? "Spatial Height" : "Spatial Rotation");
      drag = {
        id: event.pointerId,
        target: handle,
        startX: event.clientX,
        startY: event.clientY,
        origin: viewer.state(),
        kind,
        selected: active.target,
        projection,
        heightAnchor,
      };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.code) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (active.mode !== "spatial" || navigationTool === "pan" || spaceHeld || transformRestriction(kind)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!cancel()) return;
      options.finishEdit();
      const origin = viewer.state(),
        direction = event.code === "ArrowRight" || event.code === "ArrowUp" ? 1 : -1;
      viewer.beginEdit(kind === "height" ? "Spatial Height" : "Spatial Rotation");
      try {
        if (kind === "rotate") editField("yaw", rotationDegrees(origin) + direction * (event.shiftKey ? 15 : 1), origin);
        else {
          const snap = options.snap();
          editHeight(direction * (snap.enabled ? snap.gridSize : 1) * (event.shiftKey ? 10 : 1), origin);
        }
        options.onChange(viewer.commitEdit());
        report();
      } catch (error) {
        options.onChange(viewer.cancelEdit());
        report(error);
      }
    });
  }
  window.addEventListener(
    "pointermove",
    (event) => {
      if (!drag || drag.id !== event.pointerId || !frame) return;
      if (drag.cancelRequested) return;
      if (!(event.buttons & (drag.kind === "camera" ? 5 : 1))) {
        cancel();
        return;
      }
      try {
        const origin = drag.origin,
          target = drag.selected;
        if (
          drag.kind === "camera" &&
          drag.camera &&
          drag.projection &&
          drag.hit
        ) {
          const camera = structuredClone(drag.camera),
            hit = pointOnElevationPlane(
              { x: event.clientX, y: event.clientY },
              camera.target.elevation,
              drag.projection,
            );
          if (!hit) return;
          const dx = drag.hit.x - hit.x,
            dy = drag.hit.y - hit.y;
          for (const p of [camera.position, camera.target]) {
            p.x += dx;
            p.y += dy;
          }
          setCamera(camera);
          return;
        }
        if (!target) return;
        active.target = target;
        const snap = options.snap(),
          quantize = (v: number) =>
            snap.enabled ? Math.round(v / snap.gridSize) * snap.gridSize : v;
        if (drag.kind === "height") {
          const p =
            target.kind === "surface"
              ? origin.spatial?.terrain.find((s) => s.id === target.id)
              : pose(target.id, origin);
          if (!p || !drag.projection || !drag.heightAnchor) return;
          const elevation = elevationAtScreenY(
            drag.heightAnchor.point,
            drag.heightAnchor.screenY + event.clientY - drag.startY,
            drag.projection,
          );
          if (elevation === undefined) return;
          const delta = elevation - drag.heightAnchor.point.elevation;
          editHeight(delta, origin, quantize);
        } else if (drag.kind === "rotate") {
          // Screen-space horizontal travel is independent of camera projection and DPR.
          const angle = rotationDegrees(origin) + event.clientX - drag.startX;
          editField("yaw", event.shiftKey ? Math.round(angle / 15) * 15 : angle, origin);
        } else if (drag.hit && drag.projection) {
          if (
            target.kind !== "surface" &&
            origin.spatial?.attachments?.[target.id]
          )
            throw new Error(
              "Attached instance placement is owned by its attachment source",
            );
          // Keep the authored horizontal plane fixed for the whole gesture.
          // Picking a freshly moved ramp introduces height feedback and makes
          // the result depend on how many pointer events arrived.
          const hit = pointOnElevationPlane(
            { x: event.clientX, y: event.clientY },
            drag.hit.elevation,
            drag.projection,
          );
          if (!hit) return;
          const p =
            target.kind === "surface"
              ? origin.spatial?.terrain.find((s) => s.id === target.id)
              : origin.instances.find((i) => i.instanceId === target.id)
                  ?.transform;
          if (!p) return;
          const x = quantize(p.x + hit.x - drag.hit.x),
            y = quantize(p.y + hit.y - drag.hit.y);
          if (target.kind === "surface")
            options.onChange(
              viewer.updateSpatial([
                {
                  kind: "updateTerrainSurface",
                  id: target.id,
                  changes: { x, y },
                },
              ]),
            );
          else
            options.onChange(
              viewer.updateInstanceTransform(target.id, { x, y }),
            );
        }
      } catch (error) {
        cancel();
        report(error);
      }
    },
    true,
  );
  window.addEventListener(
    "pointerup",
    (event) => {
      if (drag?.id !== event.pointerId) return;
      if (drag.cancelRequested) {
        cancel();
        return;
      }
      const previous = drag;
      drag = undefined;
      syncNavigationTool();
      if (previous.target.hasPointerCapture(previous.id))
        previous.target.releasePointerCapture(previous.id);
      if (previous.kind !== "camera") options.onChange(viewer.commitEdit());
    },
    true,
  );
  window.addEventListener(
    "pointercancel",
    (event) => {
      if (drag?.id === event.pointerId) cancel();
    },
    true,
  );
  for (const element of [canvas, heightHandle, rotateHandle])
    element.addEventListener("lostpointercapture", (event) => {
      if (event instanceof PointerEvent && drag?.id === event.pointerId)
        cancel();
    });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      spaceHeld = false;
      syncNavigationTool();
    }
  });
  window.addEventListener("blur", () => {
    spaceHeld = false;
    cancel();
    syncNavigationTool();
  });
  window.addEventListener(
    "keydown",
    (event) => {
      // A disclosure owns Escape before placement/candidate cancellation.
      if (
        event.code === "Escape" &&
        event.target instanceof Element &&
        event.target.closest(".placement-control-menu[open], .placement-view-options[open]")
      ) return;
      if (event.code === "Escape" && !candidates.hidden) {
        event.preventDefault();
        event.stopPropagation();
        candidates.hidden = true;
        return;
      }
      if (
        event.code === "Escape" &&
        (palette.pending() || palette.ownsDrag())
      ) {
        event.preventDefault();
        event.stopPropagation();
        palette.cancel();
        return;
      }
      if (
        (drag || cameraTransaction) &&
        (event.code === "Escape" ||
          ((event.ctrlKey || event.metaKey) &&
            !event.altKey &&
            ["KeyZ", "KeyY"].includes(event.code)))
      ) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
      if (
        active.mode === "spatial" &&
        document.activeElement === canvas &&
        !drag &&
        !cameraTransaction &&
        !canvas.closest<HTMLElement>(".demo-shell")?.inert
      ) {
        if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          ["Space", "KeyH", "KeyV"].includes(event.code)
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (event.code === "Space") {
            spaceHeld = true;
            palette.clearPreview();
            syncNavigationTool();
          } else setNavigationTool(event.code === "KeyH" ? "pan" : "select");
          return;
        }
        if (
          (event.code === "KeyF" || event.code === "Home") &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          event.preventDefault();
          frameTargets(event.code === "KeyF");
        } else if (
          ((event.ctrlKey || event.metaKey) && event.code === "KeyD") ||
          event.code === "Delete" ||
          event.code === "Backspace"
        ) {
          const id = viewer.state().selectedInstanceId;
          if (!id) return;
          event.preventDefault();
          try {
            if (!cancel()) return;
            options.finishEdit();
            options.onChange(
              event.code === "KeyD"
                ? viewer.duplicateInstances([id])
                : viewer.removeInstance(id),
            );
            report();
          } catch (error) {
            report(error);
          }
        }
      }
    },
    true,
  );
  const resize = new ResizeObserver(() => {
    try {
      if (liveGameCamera()) previewGameCameraInput(previewCamera);
      else setCamera();
    } catch (error) {
      report(error);
    }
  });
  resize.observe(canvas);
  return {
    assetPalette: palette,
    runScene() {
      if (suspended || canvas.closest<HTMLElement>(".demo-shell")?.inert) return false;
      if (!gameCamera.cancelGesture() || !gameCamera.flushInput()) return false;
      if (options.flushSceneSettings?.() === false) return false;
      changeMode("game");
      if (active.mode !== "game") return false;
      if (active.paused) {
        if (!runtime.engine.resumeDataScene()) return false;
        active.paused = false;
      }
      active.gameFrame = false;
      options.onChange(viewer.state());
      return true;
    },
    registerModel(id: string, asset: SpatialModelAsset) {
      if (!models.has(asset.contentId)) {
        if (
          models.size >= 16 ||
          [...models.values()].reduce(
            (sum, value) => sum + value.byteLength,
            0,
          ) +
            asset.byteLength >
            128 * 1024 * 1024
        )
          throw new Error("Spatial model cache exceeds 16 assets or 128 MiB");
        if (
          !runtime.engine.registerDataSceneSpatialModel(
            "placement:" + asset.contentId,
            asset,
          )
        )
          throw new Error("Model registration rejected");
        models.set(asset.contentId, asset);
      }
      modelNames.set(asset.contentId, id);
      palette.sync();
    },
    gridSurfaceState() {
      const surfaces =
        state.spatial?.terrain.filter((s) =>
          visible({ kind: "surface", id: s.id }),
        ) ?? [];
      return {
        surfaces,
        referencePlane: active.mode === "spatial" && !!state.spatial,
        planeElevation: active.workingPlane?.elevation ?? 0,
        planeFloor: active.workingPlane?.floorId ?? 0,
      };
    },
    mode: () => active.mode,
    ownsGesture: () => drag !== undefined || cameraTransaction || palette.ownsDrag() || gameCamera.ownsGesture(),
    flushCameraInput: () => gameCamera.flushInput(),
    target: () => (active.target ? { ...active.target } : undefined),
    selectSurface(id: string) {
      if (!state.spatial?.terrain.some((surface) => surface.id === id)) return;
      if (active.mode !== "spatial") changeMode("spatial");
      if (active.mode === "spatial") choose({ kind: "surface", id });
    },
    suspend() {
      if (!cancel()) return false;
      suspended = true;
      return true;
    },
    activate(documentKey: string, root: HTMLElement) {
      if (!cancel()) return false;
      suspended = false;
      previewCamera = undefined;
      importRevision++;
      key = documentKey;
      inspector = root;
      const spatial = viewer.state().spatial;
      for (const reference of Object.values(spatial?.models ?? {}).flatMap(
        (model) => [model, ...(model.lods ?? [])],
      ))
        if (models.has(reference.contentId))
          modelNames.set(reference.contentId, reference.asset);
      active = sessions.get(key) ?? {
        mode: spatial ? "spatial" : "2d",
        camera: spatial ? structuredClone(spatial.camera) : undefined,
      };
      sessions.set(key, active);
      frame = undefined;
      signature = "";
      root.querySelector("[data-placement-spatial-properties]")?.append(panel);
      root
        .querySelector("[data-placement-spatial-placement]")
        ?.append(palette.element);
      options.assetMount().append(assets);
      options.onChange(viewer.state());
      return true;
    },
    sync,
    cancel,
    async ensureModels(document: SceneAuthoringDocumentSpec) {
      for (const ref of Object.values(document.spatial?.models ?? {}).flatMap(
        (m) => [m, ...(m.lods ?? [])],
      )) {
        const asset = models.get(ref.contentId);
        if (asset?.contentId === ref.contentId) {
          if (
            !runtime.engine.registerDataSceneSpatialModel(
              "placement:" + asset.contentId,
              asset,
            )
          )
            throw new Error("Model registration rejected");
          continue;
        }
        throw new Error(
          "Import GLB asset '" +
            ref.asset +
            "' with contentId " +
            ref.contentId +
            " before opening this document",
        );
      }
    },
    frame(update: FerrumRuntimeFrame) {
      if (active.mode === "spatial") updateSpatialInfo();
      const spatial = update.frame.renderCommandBuffer.spatial;
      gameCamera.frame(spatial?.presentation, !!spatial && active.mode === "game" && !!active.paused && !!active.gameFrame);
      if (active.mode !== "spatial" || !spatial) {
        selection.style.display = "none";
        transformTools.hidden = true;
        return;
      }
      // Retain only the two projection inputs and revision used by native picking, never borrowed geometry.
      frame = {
        version: 1,
        vertexStride: 11,
        camera: spatial.camera.slice(),
        terrain: new Float32Array(),
        terrainVertexCount: 0,
        terrainRevision: spatial.terrainRevision,
        billboards: new Float32Array(),
        billboardVertexCount: 0,
        presentation: spatial.presentation?.slice(),
      };
      const ghostKey = JSON.stringify([
        frame.camera,
        ghostRevision,
        active.ghostOthers,
      ]);
      if (ghostKey !== ghostSignature) {
        ghostSignature = ghostKey;
        ghosts.replaceChildren();
        if (active.ghostOthers) {
          const rect = stage.getBoundingClientRect();
          for (const target of allTargets()
            .filter((target) => !visible(target))
            .slice(0, 256)) {
            const points = geometry(target);
            if (!points.length) continue;
            const path = document.createElementNS(
              ghosts.namespaceURI,
              "polygon",
            );
            path.setAttribute(
              "points",
              points
                .map((point) => `${point.x - rect.left},${point.y - rect.top}`)
                .join(" "),
            );
            ghosts.append(path);
          }
        }
      }
      const target = active.target,
        points = target && visible(target) ? geometry(target) : [],
        rect = points.length ? canvas.getBoundingClientRect() : undefined,
        left = Math.min(...points.map((p) => p.x)),
        right = Math.max(...points.map((p) => p.x)),
        top = Math.min(...points.map((p) => p.y)),
        bottom = Math.max(...points.map((p) => p.y)),
        intersectsViewport = rect && right > rect.left && left < rect.right &&
          bottom > rect.top && top < rect.bottom;
      selection.style.display = points.length ? "" : "none";
      transformTools.hidden =
        !intersectsViewport ||
        !!(
          target &&
          target.kind !== "surface" &&
          state.lockedInstanceIds.includes(target.id)
        );
      heightHandle.hidden = !!(target && target.kind !== "surface" && state.spatial?.attachments?.[target.id]);
      for (const [handle, kind, hint] of [
        [heightHandle, "height", "Drag height; arrows adjust; Escape cancels"],
        [rotateHandle, "rotate", "Drag rotation; Shift snaps 15°; Escape cancels"],
      ] as const) {
        const reason = transformRestriction(kind);
        handle.disabled = !!reason;
        setUiAttribute(handle, "title", reason ?? hint);
      }
      if (!rect) {
        Object.assign(window, { ferrumPlacementSpatialSelection: undefined });
        return;
      }
      polygon.setAttribute(
        "points",
        points.map((p) => p.x - rect.left + "," + (p.y - rect.top)).join(" "),
      );
      transformTools.style.left = Math.max(8, Math.min(rect.width - 68,
        right - rect.left + 8)) + "px";
      transformTools.style.top = Math.max(32, Math.min(rect.height - 36,
        top - rect.top)) + "px";
      Object.assign(window, {
        ferrumPlacementSpatialSelection: {
          target,
          bounds: points.map((p) => ({ ...p })),
          canvas: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          },
        },
      });
    },
  };
}
