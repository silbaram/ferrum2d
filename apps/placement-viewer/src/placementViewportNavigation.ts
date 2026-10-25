import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
import { decorateViewportAction, viewportGroup, type ViewportIcon } from "./placementViewportChrome";
import { scenePlacementVisualGeometry } from "@ferrum2d/ferrum-web/authoring";
import type {
  ScenePlacementPoint,
  ScenePlacementViewer,
  ScenePlacementViewerInstance,
  ScenePlacementViewerState,
} from "@ferrum2d/ferrum-web/authoring";
import {
  createDataSceneView,
  type FerrumRuntime,
} from "@ferrum2d/ferrum-web/core";

export interface PlacementEditCamera {
  x: number;
  y: number;
  zoom: number;
}
const MIN_ZOOM = 0.125;
const MAX_ZOOM = 8;
const CAMERA_LIMIT = 10_000_000;

/** Ephemeral edit camera; it never changes authored transforms or document history. */
export function installPlacementViewportNavigation(options: {
  runtime: FerrumRuntime;
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  toolbar?: HTMLElement;
  viewer: ScenePlacementViewer;
  onChange(state: ScenePlacementViewerState): unknown;
  isEditing(): boolean;
}) {
  const { runtime, canvas, stage, viewer } = options;
  const initial: PlacementEditCamera = {
    x: runtime.engine.cameraX(),
    y: runtime.engine.cameraY(),
    zoom: 1,
  };
  const view = createDataSceneView(
    runtime.engine,
    runtime.renderer,
    canvas,
    initial,
  );
  const controls = document.createElement("div");
  controls.className = "placement-viewport-controls";
  controls.setAttribute("role", "toolbar");
  setUiAttribute(controls, "aria-label", "2D viewport navigation");
  const toolsGroup = viewportGroup("Selection tools"),
    cameraGroup = viewportGroup("View navigation"),
    frameGroup = viewportGroup("Frame view");
  controls.append(toolsGroup, cameraGroup, frameGroup);
  const icons: Record<string, ViewportIcon> = {
    select: "select", pan: "pan", "zoom-out": "minus", "zoom-in": "plus",
    "frame-selection": "frame", "fit-scene": "fit", "reset-view": "reset",
  };
  let tool: "select" | "pan" = "select";
  let spaceHeld = false;
  let pendingFrame: number | undefined;
  let drag:
    | {
        id: number;
        origin: ScenePlacementPoint;
        camera: PlacementEditCamera;
        latest: ScenePlacementPoint;
        buttons: number;
      }
    | undefined;
  const button = (
    action: string,
    label: string,
    title: string,
    run: () => void,
  ) => {
    const element = document.createElement("button");
    element.type = "button";
    setUiText(element, label);
    if (icons[action]) decorateViewportAction(element, icons[action], label,
      action === "select" ? "V" : action === "pan" ? "H" : undefined,
      action !== "select" && action !== "pan");
    setUiAttribute(element, "title", title);
    element.dataset.placementViewAction = action;
    element.addEventListener("click", () => {
      if (!options.isEditing()) run();
    });
    (action === "select" || action === "pan" ? toolsGroup
      : action === "frame-selection" || action === "fit-scene" ? frameGroup : cameraGroup).append(element);
    return element;
  };
  const select = button("select", "Select", "Select and move objects (V)", () =>
    setTool("select"),
  );
  const pan = button("pan", "Pan", "Pan viewport (H)", () => setTool("pan"));
  button("zoom-out", "Out", "Zoom out", () => zoomAt(snapshot().zoom / 1.25));
  const percent = button("actual-size", "100%", "Actual size", () => zoomAt(1));
  button("zoom-in", "In", "Zoom in", () => zoomAt(snapshot().zoom * 1.25));
  const frame = button("frame-selection", "Frame", "Frame selection (F)", () =>
    fit(true),
  );
  button("fit-scene", "Fit Scene", "Fit scene (Home)", () => fit(false));
  button("reset-view", "Reset", "Reset view (0)", () => restore(initial));
  (options.toolbar ?? stage).append(controls);

  function snapshot(): PlacementEditCamera {
    const state = view.snapshot();
    return { x: state.cameraX, y: state.cameraY, zoom: state.zoom };
  }
  function refresh() {
    const state = viewer.updateViewport(view.snapshot());
    setUiText(
      percent,
      uiMessage("{0}%", Math.round(state.viewport.zoom * 1000) / 10),
    );
    frame.disabled = state.selected === undefined;
    Object.assign(window, { ferrumPlacementEditCamera: snapshot() });
    options.onChange(state);
  }
  function apply(camera: PlacementEditCamera) {
    view.setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom)));
    view.setCamera({
      x: Math.max(-CAMERA_LIMIT, Math.min(CAMERA_LIMIT, camera.x)),
      y: Math.max(-CAMERA_LIMIT, Math.min(CAMERA_LIMIT, camera.y)),
      smoothTimeSeconds: 0,
    });
    // A stale world pointer must not leave an Add ghost at its former camera location.
    viewer.pointerAtScreen();
    refresh();
  }
  function restore(camera: PlacementEditCamera = initial) {
    cancelGesture();
    apply(camera);
  }
  function zoomAt(zoom: number, point?: ScenePlacementPoint) {
    if (drag || options.isEditing()) return;
    const before = view.snapshot();
    const anchor = point ?? { x: before.cssWidth / 2, y: before.cssHeight / 2 };
    const world = view.screenToWorld(anchor, before);
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    apply({
      zoom: next,
      x: world.x - (anchor.x - before.cssWidth / 2) / next,
      y: world.y - (anchor.y - before.cssHeight / 2) / next,
    });
  }
  function fit(selectedOnly: boolean) {
    const state = viewer.state();
    const selected = new Set(state.selectedInstanceIds);
    const instances = selectedOnly
      ? state.instances.filter((instance) => selected.has(instance.instanceId))
      : state.instances;
    if (!instances.length) return;
    const bounds = visualBounds(instances);
    const viewport = view.snapshot();
    const width = Math.max(1, viewport.cssWidth - 64);
    // Reserve the toolbar and margin above the objects.
    const height = Math.max(1, viewport.cssHeight - 128);
    apply({
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
      zoom: Math.min(
        selectedOnly ? 2 : MAX_ZOOM,
        width / Math.max(1, bounds.maxX - bounds.minX),
        height / Math.max(1, bounds.maxY - bounds.minY),
      ),
    });
  }
  function setTool(next: typeof tool) {
    cancelGesture();
    tool = next;
    syncTool();
    canvas.focus({ preventScroll: true });
  }
  function syncTool() {
    const panning = tool === "pan" || spaceHeld || drag !== undefined;
    select.setAttribute("aria-pressed", String(!panning));
    pan.setAttribute("aria-pressed", String(panning));
    stage.dataset.navigationTool = drag
      ? "panning"
      : tool === "pan" || spaceHeld
        ? "pan"
        : "select";
    stage.dispatchEvent(new CustomEvent("placement-navigation-change", {
      detail: { mode: "2d", tool, temporary: spaceHeld, dragging: drag !== undefined },
    }));
  }
  function point(event: MouseEvent): ScenePlacementPoint {
    const rect = canvas.getBoundingClientRect();
    // Match DataSceneView's logical CSS dimensions, including fractional CSS sizing.
    return {
      x: ((event.clientX - rect.left) * canvas.clientWidth) / rect.width,
      y: ((event.clientY - rect.top) * canvas.clientHeight) / rect.height,
    };
  }
  function isNavigationGesture(event: PointerEvent) {
    return (
      (event.button === 1 ||
        (event.button === 0 && (spaceHeld || tool === "pan"))) &&
      event.target instanceof Node &&
      stage.contains(event.target) &&
      !(
        event.target instanceof Element &&
        event.target.closest("[role=toolbar]")
      )
    );
  }
  function cancelFrame() {
    if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
    pendingFrame = undefined;
  }
  function updatePan() {
    pendingFrame = undefined;
    if (!drag) return;
    apply({
      ...drag.camera,
      x: drag.camera.x - (drag.latest.x - drag.origin.x) / drag.camera.zoom,
      y: drag.camera.y - (drag.latest.y - drag.origin.y) / drag.camera.zoom,
    });
  }
  function endPan(cancel: boolean) {
    if (!drag) return;
    cancelFrame();
    const previous = drag;
    if (!cancel) updatePan();
    drag = undefined;
    if (canvas.hasPointerCapture(previous.id))
      canvas.releasePointerCapture(previous.id);
    if (cancel) apply(previous.camera);
    syncTool();
  }
  function cancelGesture() {
    endPan(true);
  }
  stage.addEventListener(
    "pointerdown",
    (event) => {
      if (!isNavigationGesture(event) || options.isEditing()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (drag) return;
      canvas.focus({ preventScroll: true });
      drag = {
        id: event.pointerId,
        origin: point(event),
        latest: point(event),
        camera: snapshot(),
        buttons: event.button === 1 ? 4 : 1,
      };
      canvas.setPointerCapture(event.pointerId);
      syncTool();
    },
    true,
  );
  stage.addEventListener(
    "pointermove",
    (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if ((event.buttons & drag.buttons) === 0) {
        endPan(true);
        return;
      }
      drag.latest = point(event);
      if (pendingFrame === undefined)
        pendingFrame = requestAnimationFrame(updatePan);
    },
    true,
  );
  stage.addEventListener(
    "pointerup",
    (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      event.stopImmediatePropagation();
      drag.latest = point(event);
      endPan(false);
    },
    true,
  );
  stage.addEventListener(
    "pointercancel",
    (event) => {
      if (event.pointerId === drag?.id) endPan(true);
    },
    true,
  );
  canvas.addEventListener("lostpointercapture", (event) => {
    if (event.pointerId === drag?.id) endPan(true);
  });
  stage.addEventListener(
    "wheel",
    (event) => {
      if (
        (event.target instanceof Element &&
          event.target.closest("[role=toolbar]")) ||
        !Number.isFinite(event.deltaY)
      )
        return;
      event.preventDefault();
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? canvas.clientHeight
            : 1;
      zoomAt(
        snapshot().zoom *
          Math.exp(-Math.max(-500, Math.min(500, event.deltaY * unit)) * 0.002),
        point(event),
      );
    },
    { passive: false },
  );
  stage.addEventListener(
    "keydown",
    (event) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target instanceof Element &&
          event.target.closest("[role=toolbar]"))
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        event.stopPropagation();
        if (!options.isEditing()) {
          spaceHeld = true;
          syncTool();
        }
        return;
      }
      if (options.isEditing()) return;
      if (event.code === "Escape" && drag) {
        event.preventDefault();
        cancelGesture();
        return;
      }
      if (drag) return;
      const action =
        event.code === "KeyF"
          ? () => fit(true)
          : event.code === "Home"
            ? () => fit(false)
            : event.code === "Digit0"
              ? () => restore(initial)
              : event.code === "KeyH"
                ? () => setTool("pan")
                : event.code === "KeyV"
                  ? () => setTool("select")
                  : undefined;
      if (action) {
        event.preventDefault();
        action();
      }
    },
    true,
  );
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      spaceHeld = false;
      syncTool();
    }
  });
  window.addEventListener("blur", () => {
    spaceHeld = false;
    cancelGesture();
    syncTool();
  });
  const observer = new ResizeObserver(refresh);
  observer.observe(canvas);
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      cancelFrame();
      observer.disconnect();
    }
  });
  syncTool();
  refresh();
  return {
    snapshot,
    restore,
    cancelGesture,
    refresh,
    isNavigationGesture,
    isNavigating: () => spaceHeld || tool === "pan" || drag !== undefined,
    syncSelection: (state: ScenePlacementViewerState) => {
      frame.disabled = state.selected === undefined;
    },
  };
}

function visualBounds(instances: readonly ScenePlacementViewerInstance[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const instance of instances) {
    const geometry = instance.visual
      ? scenePlacementVisualGeometry(instance.visual, instance.transform)
      : { ...instance.transform, width: 16, height: 16 };
    const cos = Math.abs(Math.cos(geometry.rotationRadians)),
      sin = Math.abs(Math.sin(geometry.rotationRadians));
    const halfX = (geometry.width * cos + geometry.height * sin) / 2;
    const halfY = (geometry.width * sin + geometry.height * cos) / 2;
    minX = Math.min(minX, geometry.x - halfX);
    maxX = Math.max(maxX, geometry.x + halfX);
    minY = Math.min(minY, geometry.y - halfY);
    maxY = Math.max(maxY, geometry.y + halfY);
  }
  return { minX, minY, maxX, maxY };
}
