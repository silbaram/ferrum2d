import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
import {
  scenePlacementVisualGeometry,
  type ScenePlacementPoint,
  type ScenePlacementViewer,
  type ScenePlacementViewerInstance,
  type ScenePlacementViewerState,
} from "@ferrum2d/ferrum-web/authoring";

export function hasLockedSelection(state: ScenePlacementViewerState): boolean {
  const locked = new Set(state.lockedInstanceIds);
  return state.selectedInstanceIds.some((id) => locked.has(id));
}

export function togglePlacementSelection(
  viewer: ScenePlacementViewer,
  id: string,
): ScenePlacementViewerState {
  const ids = viewer.state().selectedInstanceIds;
  return viewer.selectInstances(
    ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
  );
}

/** Absolute primary XY becomes a common delta; member offsets are preserved. */
export function movePlacementSelectionTo(
  viewer: ScenePlacementViewer,
  point: ScenePlacementPoint,
): ScenePlacementViewerState {
  const state = viewer.state();
  if (!state.selected || hasLockedSelection(state)) return state;
  const dx = point.x - state.selected.transform.x,
    dy = point.y - state.selected.transform.y;
  const ids = new Set(state.selectedInstanceIds);
  return viewer.updateInstanceTransforms(
    state.instances
      .filter((instance) => ids.has(instance.instanceId))
      .map((instance) => ({
        instanceId: instance.instanceId,
        transform: {
          x: instance.transform.x + dx,
          y: instance.transform.y + dy,
        },
      })),
  );
}

/** Selection tools own transient UI only; mutations still go through the public viewer. */
export function installPlacementSelectionTools(options: {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  viewer: ScenePlacementViewer;
  onChange(state: ScenePlacementViewerState): unknown;
  isAdding(): boolean;
  isEditing(): boolean;
  finishEdit(): void;
}) {
  const { canvas, stage, viewer } = options;
  const outlines = document.createElement("div");
  outlines.className = "placement-multi-selection";
  const markers = new Map<string, HTMLElement>();
  const marquee = document.createElement("div");
  marquee.className = "placement-marquee";
  marquee.hidden = true;
  const controls = document.createElement("div");
  controls.className = "placement-selection-tools";
  controls.setAttribute("role", "toolbar");
  setUiAttribute(controls, "aria-label", "Selection tools");
  const count = document.createElement("span");
  controls.append(count);
  function button(
    action: string,
    label: string,
    title: string,
    run: () => void,
  ) {
    const element = document.createElement("button");
    element.type = "button";
    setUiText(element, label);
    setUiAttribute(element, "title", title);
    element.dataset.placementSelectionAction = action;
    element.addEventListener("click", () => {
      options.finishEdit();
      run();
    });
    controls.append(element);
    return element;
  }
  const selectAll = () => {
    const state = viewer.state(),
      locked = new Set(state.lockedInstanceIds);
    options.onChange(
      viewer.selectInstances(
        state.instances
          .filter((instance) => !locked.has(instance.instanceId))
          .map((instance) => instance.instanceId),
      ),
    );
  };
  button("all", "All", "Select unlocked objects (Ctrl/Cmd+A)", selectAll);
  const lock = button("lock", "Lock", "Lock selected objects", () =>
    options.onChange(
      viewer.setInstancesLocked(viewer.state().selectedInstanceIds, true),
    ),
  );
  const unlock = button("unlock", "Unlock", "Unlock selected objects", () =>
    options.onChange(
      viewer.setInstancesLocked(viewer.state().selectedInstanceIds, false),
    ),
  );
  button("clear", "Clear", "Clear selection (Escape)", () =>
    options.onChange(viewer.selectInstances([])),
  );
  stage.append(outlines, marquee, controls);
  let box:
    | {
        id: number;
        start: ScenePlacementPoint;
        end: ScenePlacementPoint;
        previous: readonly string[];
        additive: boolean;
      }
    | undefined;
  const screen = (event: PointerEvent): ScenePlacementPoint => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  function endBox(cancel: boolean) {
    if (!box) return;
    const previous = box;
    box = undefined;
    marquee.hidden = true;
    if (canvas.hasPointerCapture(previous.id))
      canvas.releasePointerCapture(previous.id);
    if (cancel) {
      options.onChange(viewer.selectInstances(previous.previous));
      return;
    }
    const state = viewer.state(),
      locked = new Set(state.lockedInstanceIds),
      viewport = state.viewport;
    const left = Math.min(previous.start.x, previous.end.x),
      right = Math.max(previous.start.x, previous.end.x);
    const top = Math.min(previous.start.y, previous.end.y),
      bottom = Math.max(previous.start.y, previous.end.y);
    const ids = previous.additive ? [...previous.previous] : [];
    if (right - left >= 4 || bottom - top >= 4) {
      for (const instance of state.instances) {
        if (locked.has(instance.instanceId)) continue;
        const geometry = selectionGeometry(instance);
        const cos = Math.abs(Math.cos(geometry.rotationRadians)),
          sin = Math.abs(Math.sin(geometry.rotationRadians));
        const halfX =
          ((geometry.width * cos + geometry.height * sin) * viewport.zoom) / 2;
        const halfY =
          ((geometry.width * sin + geometry.height * cos) * viewport.zoom) / 2;
        const x = (geometry.x - viewport.worldMinX) * viewport.zoom,
          y = (geometry.y - viewport.worldMinY) * viewport.zoom;
        if (
          x - halfX >= left &&
          x + halfX <= right &&
          y - halfY >= top &&
          y + halfY <= bottom
        )
          ids.push(instance.instanceId);
      }
    }
    options.onChange(viewer.selectInstances(ids));
  }
  function cancelBoxGesture() {
    if (!box) return;
    endBox(true);
    options.finishEdit();
  }
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (
        event.button !== 0 ||
        options.isAdding() ||
        stage.dataset.navigationTool !== "select"
      )
        return;
      const point = screen(event);
      if (viewer.pickInstanceAtScreen(point)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      box = {
        id: event.pointerId,
        start: point,
        end: point,
        previous: [...viewer.state().selectedInstanceIds],
        additive: event.shiftKey || event.ctrlKey || event.metaKey,
      };
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
    },
    true,
  );
  canvas.addEventListener(
    "pointermove",
    (event) => {
      if (box?.id !== event.pointerId) return;
      event.stopImmediatePropagation();
      if ((event.buttons & 1) === 0) {
        cancelBoxGesture();
        return;
      }
      box.end = screen(event);
      marquee.hidden = false;
      Object.assign(marquee.style, {
        left: `${Math.min(box.start.x, box.end.x)}px`,
        top: `${Math.min(box.start.y, box.end.y)}px`,
        width: `${Math.abs(box.end.x - box.start.x)}px`,
        height: `${Math.abs(box.end.y - box.start.y)}px`,
      });
    },
    true,
  );
  canvas.addEventListener(
    "pointerup",
    (event) => {
      if (box?.id !== event.pointerId) return;
      event.stopImmediatePropagation();
      box.end = screen(event);
      endBox(false);
    },
    true,
  );
  canvas.addEventListener(
    "pointercancel",
    (event) => {
      if (box?.id === event.pointerId) endBox(true);
    },
    true,
  );
  canvas.addEventListener("lostpointercapture", (event) => {
    if (box?.id === event.pointerId) cancelBoxGesture();
  });
  window.addEventListener("blur", () => {
    cancelBoxGesture();
  });
  canvas.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || options.isEditing() || options.isAdding())
      return;
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      event.code === "KeyA"
    ) {
      event.preventDefault();
      selectAll();
      return;
    }
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      stage.dataset.navigationTool !== "select"
    )
      return;
    if (event.code === "Escape") {
      event.preventDefault();
      options.onChange(viewer.selectInstances([]));
    }
    if (event.code === "Delete" || event.code === "Backspace") {
      event.preventDefault();
      const state = viewer.state();
      if (!hasLockedSelection(state))
        options.onChange(viewer.removeInstances(state.selectedInstanceIds));
    }
  });
  return {
    cancel: () => endBox(true),
    sync(state: ScenePlacementViewerState) {
      const selected = new Set(state.selectedInstanceIds),
        locked = new Set(state.lockedInstanceIds);
      setUiText(count, uiMessage("{0} Selected", selected.size));
      lock.disabled =
        !selected.size ||
        state.selectedInstanceIds.every((id) => locked.has(id));
      unlock.disabled = !state.selectedInstanceIds.some((id) => locked.has(id));
      for (const [id, marker] of markers)
        if (!selected.has(id) || id === state.selectedInstanceId) {
          marker.remove();
          markers.delete(id);
        }
      for (const instance of state.instances) {
        if (
          !selected.has(instance.instanceId) ||
          instance.instanceId === state.selectedInstanceId
        )
          continue;
        let marker = markers.get(instance.instanceId);
        if (!marker) {
          marker = document.createElement("div");
          marker.className = "placement-secondary-selection";
          marker.dataset.selectedInstanceId = instance.instanceId;
          markers.set(instance.instanceId, marker);
          outlines.append(marker);
        }
        const geometry = selectionGeometry(instance),
          viewport = state.viewport;
        Object.assign(marker.style, {
          transform: `translate(${(geometry.x - geometry.width / 2 - viewport.worldMinX) * viewport.zoom}px, ${(geometry.y - geometry.height / 2 - viewport.worldMinY) * viewport.zoom}px) rotate(${geometry.rotationRadians}rad)`,
          width: `${geometry.width * viewport.zoom}px`,
          height: `${geometry.height * viewport.zoom}px`,
        });
        marker.dataset.locked = String(locked.has(instance.instanceId));
      }
    },
  };
}

function selectionGeometry(instance: ScenePlacementViewerInstance) {
  return instance.visual
    ? scenePlacementVisualGeometry(instance.visual, instance.transform)
    : {
        ...instance.transform,
        width: 16 * instance.transform.scale,
        height: 16 * instance.transform.scale,
      };
}
