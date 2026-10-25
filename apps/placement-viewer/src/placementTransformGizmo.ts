import { setUiAttribute, uiMessage } from "./placementLocale";
import type {
  ScenePlacementViewer,
  ScenePlacementViewerState,
} from "@ferrum2d/ferrum-web/authoring";
import { hasLockedSelection } from "./placementSelection";

/** The primary authored pivot is shared by numeric, keyboard and pointer edits. */
export function transformPlacementSelection(
  viewer: ScenePlacementViewer,
  origin: ScenePlacementViewerState,
  change: { rotation?: number; scale?: number },
): ScenePlacementViewerState {
  const primary = origin.selected;
  if (!primary || hasLockedSelection(origin)) return viewer.state();
  const angle = change.rotation ?? 0,
    ratio = change.scale ?? 1;
  if (!Number.isFinite(angle) || !Number.isFinite(ratio) || ratio <= 0)
    throw new Error("Rotation must be finite and scale must be positive.");
  const ids = new Set(origin.selectedInstanceIds);
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  return viewer.updateInstanceTransforms(
    origin.instances
      .filter((i) => ids.has(i.instanceId))
      .map((i) => {
        const dx = (i.transform.x - primary.transform.x) * ratio;
        const dy = (i.transform.y - primary.transform.y) * ratio;
        return {
          instanceId: i.instanceId,
          transform: {
            x: primary.transform.x + dx * cos - dy * sin,
            y: primary.transform.y + dx * sin + dy * cos,
            rotationRadians: i.transform.rotationRadians + angle,
            scale: i.transform.scale * ratio,
          },
        };
      }),
  );
}

export function installPlacementTransformGizmo(options: {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  viewer: ScenePlacementViewer;
  onChange(state: ScenePlacementViewerState): unknown;
  isAdding(): boolean;
  snapEnabled(): boolean;
  finishEdit(): void;
}) {
  const { viewer, canvas } = options;
  const root = document.createElement("div");
  root.className = "placement-transform-gizmo";
  root.setAttribute("role", "toolbar");
  setUiAttribute(root, "aria-label", "Transform selection");
  const rotate = handle(
    "rotate",
    "Rotate selection",
    '<path d="M4 7a5 5 0 1 1-1 5M4 3v4H0"/>',
  );
  const scale = handle(
    "scale",
    "Scale selection",
    '<path d="M2 10v4h4M10 2h4v4M2 14l12-12"/>',
  );
  options.stage.append(root);
  let drag:
    | {
        id: number;
        target: HTMLButtonElement;
        kind: string;
        origin: ScenePlacementViewerState;
        x: number;
        y: number;
        angle: number;
        distance: number;
      }
    | undefined;
  function handle(kind: string, label: string, path: string) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.placementTransformGizmo = kind;
    setUiAttribute(button, "aria-label", label);
    setUiAttribute(
      button,
      "title",
      uiMessage("{0} (arrow keys)", uiMessage(label)),
    );
    button.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">${path}</svg>`;
    root.append(button);
    button.addEventListener("pointerdown", (event) => {
      const state = viewer.state();
      if (
        event.button !== 0 ||
        !state.selected ||
        hasLockedSelection(state) ||
        options.isAdding()
      )
        return;
      const rect = canvas.getBoundingClientRect(),
        viewport = state.viewport;
      const x =
        rect.left +
        (state.selected.transform.x - viewport.worldMinX) * viewport.zoom;
      const y =
        rect.top +
        (state.selected.transform.y - viewport.worldMinY) * viewport.zoom;
      drag = {
        id: event.pointerId,
        target: button,
        kind,
        origin: state,
        x,
        y,
        angle: Math.atan2(event.clientY - y, event.clientX - x),
        distance: Math.max(1, Math.hypot(event.clientX - x, event.clientY - y)),
      };
      button.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("pointermove", (event) => {
      if (drag?.id !== event.pointerId) return;
      if (!(event.buttons & 1)) return end(true);
      apply(event);
    });
    button.addEventListener("pointerup", (event) => {
      if (drag?.id !== event.pointerId) return;
      apply(event);
      end(false);
    });
    button.addEventListener("pointercancel", () => end(true));
    button.addEventListener("lostpointercapture", () => end(true));
    button.addEventListener("keydown", (event) => {
      if (
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          event.code,
        ) ||
        drag
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      options.finishEdit();
      const direction =
        event.code === "ArrowLeft" || event.code === "ArrowDown" ? -1 : 1;
      options.onChange(
        transformPlacementSelection(
          viewer,
          viewer.state(),
          kind === "rotate"
            ? {
                rotation:
                  (direction * (event.shiftKey ? 1 : 15) * Math.PI) / 180,
              }
            : { scale: 1 + direction * (event.shiftKey ? 0.01 : 0.1) },
        ),
      );
    });
    return button;
  }
  function apply(event: PointerEvent) {
    if (!drag) return;
    let angle =
      Math.atan2(event.clientY - drag.y, event.clientX - drag.x) - drag.angle;
    angle = Math.atan2(Math.sin(angle), Math.cos(angle));
    let ratio = Math.max(
      0.01,
      Math.min(
        100,
        Math.hypot(event.clientX - drag.x, event.clientY - drag.y) /
          drag.distance,
      ),
    );
    if (event.shiftKey || options.snapEnabled()) {
      angle = (Math.round(angle / (Math.PI / 12)) * Math.PI) / 12;
      ratio = Math.max(0.1, Math.round(ratio * 10) / 10);
    }
    options.onChange(
      transformPlacementSelection(
        viewer,
        drag.origin,
        drag.kind === "rotate" ? { rotation: angle } : { scale: ratio },
      ),
    );
  }
  function end(cancel: boolean) {
    const previous = drag;
    if (!previous) return;
    drag = undefined;
    if (previous.target.hasPointerCapture(previous.id))
      previous.target.releasePointerCapture(previous.id);
    if (cancel) {
      options.onChange(viewer.cancelEdit());
      options.finishEdit();
    }
  }
  window.addEventListener("blur", () => end(true));
  return {
    cancel: () => end(true),
    sync(state: ScenePlacementViewerState) {
      const primary = state.selected;
      root.hidden = !primary || hasLockedSelection(state) || options.isAdding();
      if (!primary) return;
      const x =
        (primary.transform.x - state.viewport.worldMinX) * state.viewport.zoom;
      const y =
        (primary.transform.y - state.viewport.worldMinY) * state.viewport.zoom;
      root.style.left = `${x}px`;
      root.style.top = `${y}px`;
      rotate.style.transform = "translate(-12px, -72px)";
      scale.style.transform = "translate(48px, 36px)";
    },
  };
}
