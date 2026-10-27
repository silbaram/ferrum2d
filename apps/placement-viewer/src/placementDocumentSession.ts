import {
  setUiAttribute,
  setUiText,
  translateUi,
  uiMessage,
} from "./placementLocale";
import type {
  ScenePlacementViewer,
  ScenePlacementViewerState,
} from "@ferrum2d/ferrum-web/authoring";
import { decorateViewportAction } from "./placementViewportChrome";

/** Per-document input/history boundary; the viewer retains the inspectable JSON draft. */
export function installPlacementDocumentSession(options: {
  canvas: HTMLCanvasElement;
  viewer: ScenePlacementViewer;
  onChange(state: ScenePlacementViewerState): unknown;
  hasUnsavedChanges?(): boolean;
  isNavigationGesture?(event: PointerEvent): boolean;
  canEdit?(): boolean;
  canSave?(): boolean;
  hasExternalGesture?(): boolean;
}) {
  const { canvas, viewer, onChange } = options;
  const root = canvas.closest<HTMLElement>(".demo-shell") ?? document.body;
  const controls = document.createElement("div");
  controls.className = "placement-session-controls";
  setUiAttribute(controls, "aria-label", "Document history");
  const undo = document.createElement("button");
  const redo = document.createElement("button");
  const status = document.createElement("span");
  decorateViewportAction(undo, "left", "Undo", undefined, true);
  decorateViewportAction(redo, "right", "Redo", undefined, true);
  undo.type = redo.type = "button";
  undo.dataset.placementAction = "undo";
  redo.dataset.placementAction = "redo";
  setUiAttribute(undo, "title", "Undo (Ctrl/Cmd+Z)");
  setUiAttribute(redo, "title", "Redo (Ctrl/Cmd+Shift+Z)");
  status.setAttribute("aria-live", "polite");
  status.className = "placement-visually-hidden";
  controls.append(undo, redo, status);
  (
    root.querySelector(".demo-actions") ??
    root.querySelector(".demo-toolbar") ??
    canvas.parentElement
  )?.append(controls);
  let busy = false;
  let navigationApproved = false;
  let serial = 0;
  let pendingPointerFinish = false;
  let pointer: { id: number; target: Element } | undefined;
  const isDirty = () =>
    options.hasUnsavedChanges?.() ?? viewer.exportPatch() !== undefined;

  function sync() {
    const history = viewer.historyState();
    undo.disabled =
      busy ||
      options.canEdit?.() === false ||
      history.undoCount === 0 ||
      history.transactionLabel !== undefined;
    redo.disabled =
      busy ||
      options.canEdit?.() === false ||
      history.redoCount === 0 ||
      history.transactionLabel !== undefined;
    setUiText(
      status,
      busy
        ? "Saving…"
        : uiMessage(
            "{0} · {1} edits",
            viewer.exportPatch()
              ? uiMessage("Modified")
              : options.canSave?.() === false
                ? uiMessage("Clean")
                : uiMessage("Saved"),
            history.undoCount,
          ),
    );
    Object.assign(window, { ferrumPlacementViewerHistory: history });
  }
  function publish(state: ScenePlacementViewerState) {
    onChange(state);
    sync();
    return state;
  }
  function applyHistory(action: () => ScenePlacementViewerState) {
    if (options.hasExternalGesture?.()) return viewer.state();
    try {
      return publish(action());
    } catch (error) {
      const state = publish(viewer.state());
      window.dispatchEvent(
        new CustomEvent("ferrum-placement-document-error", { detail: error }),
      );
      return state;
    }
  }
  function finish(cancel: boolean) {
    if (options.hasExternalGesture?.()) return;
    serial++;
    pendingPointerFinish = false;
    if (viewer.historyState().transactionLabel === undefined) return;
    applyHistory(() => (cancel ? viewer.cancelEdit() : viewer.commitEdit()));
  }
  function cancelPointer() {
    const previous = pointer;
    pointer = undefined;
    if (previous) {
      previous.target.dispatchEvent(
        new PointerEvent("pointercancel", {
          bubbles: true,
          pointerId: previous.id,
        }),
      );
    }
    finish(true);
  }
  undo.addEventListener("click", () => applyHistory(() => viewer.undo()));
  redo.addEventListener("click", () => applyHistory(() => viewer.redo()));
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (
        busy ||
        options.canEdit?.() === false ||
        event.button !== 0 ||
        !(event.target instanceof Element) ||
        !root.contains(event.target)
      )
        return;
      if (options.isNavigationGesture?.(event)) return;
      if (
        event.target !== canvas &&
        !event.target.closest(
          "[data-placement-resize-handle], [data-placement-collider-offset-handle], [data-placement-transform-gizmo]",
        )
      )
        return;
      finish(false);
      pointer = { id: event.pointerId, target: event.target };
      viewer.beginEdit("Pointer Edit");
      sync();
    },
    true,
  );
  window.addEventListener(
    "pointerup",
    (event) => {
      if (pointer?.id !== event.pointerId) return;
      pendingPointerFinish = true;
      pointer = undefined;
      const current = serial;
      // Pointer handlers may enqueue their final update after the capture phase.
      queueMicrotask(() =>
        requestAnimationFrame(() => {
          if (serial === current) finish(false);
        }),
      );
    },
    true,
  );
  window.addEventListener(
    "pointercancel",
    (event) => {
      if (pointer?.id !== event.pointerId) return;
      pendingPointerFinish = true;
      pointer = undefined;
      queueMicrotask(() => finish(true));
    },
    true,
  );
  root.addEventListener("focusin", (event) => {
    if (
      event.target instanceof HTMLInputElement &&
      event.target.dataset.placementTransformField
    ) {
      finish(false);
      viewer.beginEdit("Transform Input");
      sync();
    }
  });
  root.addEventListener("focusout", (event) => {
    if (
      event.target instanceof HTMLInputElement &&
      event.target.dataset.placementTransformField
    )
      finish(false);
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (
        busy ||
        options.hasExternalGesture?.() ||
        options.canEdit?.() === false ||
        !root.contains(event.target as Node)
      )
        return;
      if (event.code === "Escape" && viewer.historyState().transactionLabel) {
        event.preventDefault();
        event.stopPropagation();
        cancelPointer();
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest("input, textarea, select, [contenteditable=true]")
      )
        return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.code !== "KeyZ" && event.code !== "KeyY") return;
      event.preventDefault();
      if (pointer) {
        cancelPointer();
        return;
      }
      applyHistory(() =>
        event.shiftKey || event.code === "KeyY" ? viewer.redo() : viewer.undo(),
      );
    },
    true,
  );
  window.addEventListener("beforeunload", (event) => {
    if (isDirty() && !navigationApproved) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("pageshow", () => {
    navigationApproved = false;
  });
  Object.assign(window, {
    ferrumPlacementViewerUndo: () => applyHistory(() => viewer.undo()),
    ferrumPlacementViewerRedo: () => applyHistory(() => viewer.redo()),
  });
  sync();
  return {
    sync,
    finishEdit() {
      if (pointer) cancelPointer();
      else finish(false);
    },
    isSaving: () => busy,
    hasPointerGesture: () => pointer !== undefined || pendingPointerFinish,
    isFinishingPointerEdit: () => pendingPointerFinish,
    allowReload() {
      navigationApproved = true;
    },
    confirmNavigation() {
      if (busy) return false;
      if (
        isDirty() &&
        !window.confirm(
          translateUi("Unsaved changes will be lost. Open another project?"),
        )
      )
        return false;
      navigationApproved = true;
      return true;
    },
    setSaving(value: boolean) {
      if (value) finish(false);
      busy = value;
      // Keep runtime rendering, but prevent new UI edits while an asynchronous save is pending.
      root.inert = value;
      sync();
    },
  };
}
