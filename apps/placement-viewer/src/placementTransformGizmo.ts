import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
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
  selectionBounds(): DOMRect | undefined;
}) {
  const { viewer, canvas } = options;
  const root = document.createElement("div");
  root.className = "placement-transform-gizmo";
  root.hidden = true;
  root.setAttribute("role", "toolbar");
  setUiAttribute(root, "aria-label", "Transform selection");
  const caption = document.createElement("div"), actions = document.createElement("div"), hint = document.createElement("div");
  caption.className = "placement-transform-caption";
  actions.className = "placement-transform-actions";
  hint.className = "placement-transform-hint";
  root.append(caption, actions, hint);
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
  let current = viewer.state();
  let hovered: string | undefined;
  let drag:
    | {
        id: number;
        target: HTMLButtonElement;
        kind: string;
        origin: ScenePlacementViewerState;
        startX: number;
      }
    | undefined;
  function handle(kind: string, label: string, path: string) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.placementTransformGizmo = kind;
    setUiAttribute(button, "aria-label", label);
    button.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">${path}</svg>`;
    const text = document.createElement("span"), value = document.createElement("span");
    setUiText(text, kind === "rotate" ? "Rotate" : "Scale");
    value.className = "placement-transform-value";
    button.append(text, value);
    setUiAttribute(button, "title", kind === "rotate" ? "Drag sideways · Arrow keys rotate" : "Drag sideways · Arrow keys scale");
    actions.append(button);
    button.addEventListener("pointerenter", () => { hovered = kind; sync(current); });
    button.addEventListener("pointerleave", () => { hovered = undefined; sync(current); });
    button.addEventListener("focus", () => sync(current));
    button.addEventListener("blur", () => queueMicrotask(() => sync(current)));
    button.addEventListener("pointerdown", (event) => {
      const state = viewer.state();
      if (
        event.button !== 0 ||
        !state.selected ||
        hasLockedSelection(state) ||
        options.isAdding() || root.hidden
      )
        return;
      drag = {
        id: event.pointerId,
        target: button,
        kind,
        origin: state,
        startX: event.clientX,
      };
      root.dataset.dragging = kind;
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
        drag || root.hidden || hasLockedSelection(viewer.state())
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
    const dx = event.clientX - drag.startX;
    let angle = dx * Math.PI / 180;
    let ratio = Math.max(0.01, Math.min(100, 2 ** (dx / 120)));
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
    delete root.dataset.dragging;
    if (previous.target.hasPointerCapture(previous.id))
      previous.target.releasePointerCapture(previous.id);
    if (cancel) {
      options.onChange(viewer.cancelEdit());
      options.finishEdit();
    }
    sync(viewer.state());
  }
  window.addEventListener("blur", () => end(true));
  options.stage.addEventListener("placement-navigation-change", () => sync(viewer.state()));
  function sync(state: ScenePlacementViewerState) {
    current = state;
    const primary = state.selected;
    const panning = ["pan", "panning"].includes(options.stage.dataset.navigationTool ?? "");
    const canvasRect = canvas.getBoundingClientRect(), bounds = options.selectionBounds();
    const offscreen = !!bounds && (
      bounds.right <= canvasRect.left || bounds.left >= canvasRect.right ||
      bounds.bottom <= canvasRect.top || bounds.top >= canvasRect.bottom);
    root.hidden = !primary || options.isAdding() || panning || !bounds || (!drag && offscreen);
    if (root.hidden || !primary || !bounds) return;
    const locked = hasLockedSelection(state);
    const name = state.selectedInstanceIds.length > 1 ? uiMessage("{0} · {1} selected", primary.instanceId, state.selectedInstanceIds.length) : uiMessage("{0}", primary.instanceId);
    setUiText(caption, name);
    setUiAttribute(caption, "title", name);
    actions.hidden = locked;
    const angle = Number((primary.transform.rotationRadians * 180 / Math.PI).toFixed(1));
    rotate.querySelector(".placement-transform-value")!.textContent = `${angle}°`;
    scale.querySelector(".placement-transform-value")!.textContent = `${Number((primary.transform.scale * 100).toFixed(1))}%`;
    const focused = document.activeElement === rotate ? "rotate" : document.activeElement === scale ? "scale" : undefined;
    const active = drag?.kind ?? hovered ?? focused;
    const keyboard = !drag && !hovered && !!focused;
    const instructions = locked ? "Selection locked" : active === "rotate"
      ? keyboard ? "Arrow keys: 15° · Shift: 1°" : "Drag sideways · Shift: 15° snap"
      : active === "scale" ? keyboard ? "Arrow keys: 10% · Shift: 1%" : "Drag sideways · Shift: 10% snap" : "Drag the object to move";
    setUiText(hint, instructions);
    setUiAttribute(hint, "title", instructions);
    if (drag) return; // Keep the grabbed control still until release.
    root.style.maxWidth = `${Math.max(0, canvasRect.width - 16)}px`;
    const width = root.offsetWidth, height = root.offsetHeight;
    const x = (bounds.left + bounds.right) / 2 - canvasRect.left - width / 2;
    const above = bounds.top - canvasRect.top - height - 8;
    const below = bounds.bottom - canvasRect.top + 8;
    const y = above >= 8 ? above : below + height <= canvasRect.height - 8 ? below : above;
    root.style.left = `${Math.max(8, Math.min(canvasRect.width - width - 8, x))}px`;
    root.style.top = `${Math.max(8, Math.min(canvasRect.height - height - 8, y))}px`;
  }
  return {
    cancel: () => end(true),
    sync,
  };
}
