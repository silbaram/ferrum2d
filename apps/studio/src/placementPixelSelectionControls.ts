import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
import type { createPixelSelection } from "./placementPixelSelection";
import { PIXEL_SELECTION_DEFAULTS, type PixelSelectionSettings } from "./placementPixelMask";
import { createPixelTransformDialog } from "./placementPixelTransformDialog";

export function createPixelSelectionControls(options: {
  selection: ReturnType<typeof createPixelSelection>;
  perform(run: () => unknown): void;
  configure(): void;
  report(error: unknown): void;
}) {
  const selection = options.selection, element = document.createElement("div");
  element.className = "placement-pixel-selection"; element.hidden = true;
  element.setAttribute("role", "toolbar"); setUiAttribute(element, "aria-label", "Pixel Selection");
  const menu = document.createElement("details"), summary = document.createElement("summary"), panel = document.createElement("div");
  setUiText(summary, "Selection"); menu.append(summary, panel);
  const actions = [
    ["select-all", "Select All", "Ctrl/Cmd+A", () => selection.all()],
    ["deselect", "Deselect", "Escape", () => selection.clear()],
    ["copy", "Copy", "Ctrl/Cmd+C", () => selection.copy()],
    ["cut", "Cut", "Ctrl/Cmd+X", () => selection.cut()],
    ["paste", "Paste", "Ctrl/Cmd+V", () => selection.paste()],
    ["delete", "Delete Pixels", "Delete", () => selection.remove()],
    ["flip-x", "Flip Horizontal", "", () => selection.transform("flip-x")],
    ["flip-y", "Flip Vertical", "", () => selection.transform("flip-y")],
    ["rotate", "Rotate 90°", "", () => selection.transform("rotate")],
  ] as const;
  const buttons = new Map<string, HTMLButtonElement>();
  let settings: PixelSelectionSettings = { ...PIXEL_SELECTION_DEFAULTS };
  function picker(key: "shape" | "operation", label: string, entries: readonly (readonly [string, string])[]) {
    const node = document.createElement("select"); node.dataset["pixelSelection" + (key === "shape" ? "Shape" : "Operation")] = "true"; setUiAttribute(node, "aria-label", label);
    for (const [value, text] of entries) { const option = document.createElement("option"); option.value = value; setUiText(option, text); node.append(option); }
    node.onchange = () => { const value = entries.find(([value]) => value === node.value)?.[0]; if (!value) return; settings = { ...settings, [key]: value }; options.configure(); };
    element.append(node); return node;
  }
  const shape = picker("shape", "Selection Shape", [["rectangle", "Rectangle Selection"], ["color", "Color Selection"], ["wand", "Magic Wand"], ["lasso", "Lasso Selection"], ["polygon", "Polygon Selection"]]);
  const operation = picker("operation", "Selection Operation", [["replace", "Replace Selection"], ["add", "Add Selection"], ["subtract", "Subtract Selection"], ["intersect", "Intersect Selection"]]);
  const toleranceLabel = document.createElement("label"), toleranceText = document.createElement("span"), tolerance = document.createElement("input");
  setUiText(toleranceText, "Tolerance"); tolerance.type = "number"; tolerance.min = "0"; tolerance.max = "255"; tolerance.value = "0";
  tolerance.dataset.pixelSelectionTolerance = "true"; setUiAttribute(tolerance, "aria-label", "Selection Tolerance"); toleranceLabel.append(toleranceText, tolerance); element.append(toleranceLabel);
  tolerance.onchange = () => { const value = tolerance.valueAsNumber; if (!Number.isInteger(value) || value < 0 || value > 255) { tolerance.value = String(settings.tolerance); options.report(Error("Selection tolerance must be 0 to 255")); return; } settings = { ...settings, tolerance: value }; options.configure(); };
  const diagonalLabel = document.createElement("label"), diagonalText = document.createElement("span"), diagonal = document.createElement("input");
  diagonal.type = "checkbox"; diagonal.dataset.pixelSelectionDiagonal = "true"; setUiText(diagonalText, "Eight Connected"); diagonalLabel.append(diagonal, diagonalText); element.append(diagonalLabel);
  diagonal.onchange = () => { const value = diagonal.checked; settings = { ...settings, diagonal: value }; options.configure(); };
  const hint = document.createElement("span"); element.append(hint);
  function button(key: string, label: string, shortcut: string, run: () => unknown, parent: HTMLElement) {
    const node = document.createElement("button"); node.type = "button"; node.dataset.pixelAction = key;
    setUiText(node, label); setUiAttribute(node, "aria-label", label);
    setUiAttribute(node, "title", shortcut ? uiMessage("{0} ({1})", uiMessage(label), shortcut) : label);
    node.onclick = () => { menu.open = false; options.perform(run); }; parent.append(node); buttons.set(key, node);
    return node;
  }
  for (const [key, label, shortcut, run] of actions) button(key, label, shortcut, run, panel);
  const transform = createPixelTransformDialog(options); panel.append(transform.button);
  transform.button.addEventListener("click", () => { menu.open = false; });
  const confirm = button("selection-confirm", "Confirm", "Enter", () => selection.confirm(), element);
  const cancel = button("selection-cancel", "Cancel", "Escape", () => selection.cancel(), element);
  const status = document.createElement("output"); status.setAttribute("role", "status"); status.dataset.pixelSelectionStatus = "true";
  element.prepend(menu); element.append(status);
  menu.addEventListener("keydown", event => {
    if (event.code === "Escape" && menu.open) { event.preventDefault(); event.stopPropagation(); menu.open = false; summary.focus(); }
  });
  const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false; };
  window.addEventListener("pointerdown", outside, true);
  return {
    element,
    settings: () => ({ ...settings }),
    cancel: transform.cancel,
    reset() { transform.cancel(); settings = { ...PIXEL_SELECTION_DEFAULTS }; menu.open = false; },
    sync(visible: boolean, disabled: boolean) {
      element.hidden = !visible; if (!visible) menu.open = false;
      transform.sync(disabled || !visible);
      shape.value = settings.shape; operation.value = settings.operation; tolerance.value = String(settings.tolerance); diagonal.checked = settings.diagonal;
      shape.disabled = operation.disabled = tolerance.disabled = diagonal.disabled = disabled;
      toleranceLabel.hidden = settings.shape !== "color" && settings.shape !== "wand"; diagonalLabel.hidden = settings.shape !== "wand";
      setUiText(hint, settings.shape === "polygon" ? "Click vertices · Enter/double-click to select · Escape to cancel" : "Shift add · Alt subtract · Shift+Alt intersect");
      const bounds = selection.bounds(), pending = selection.pending(), editable = selection.editable();
      for (const [key, node] of buttons) {
        node.disabled = disabled || (key !== "select-all" && key !== "paste" && !bounds);
        if (["cut", "delete", "flip-x", "flip-y", "rotate", "paste", "selection-confirm"].includes(key)) node.disabled ||= !editable;
        if (["select-all", "cut", "delete", "paste"].includes(key)) node.disabled ||= pending;
        if (key === "paste") node.disabled ||= !selection.hasClipboard();
      }
      confirm.hidden = cancel.hidden = !pending;
      const moveHint = settings.shape === "rectangle" && settings.operation === "replace" ? "Selection {0} × {1} · Drag or arrow keys to move" : "Selection {0} × {1} · Arrow keys to move";
      const selectHint = settings.shape === "color" || settings.shape === "wand" ? "Click to select pixels" : settings.shape === "polygon" ? "Click polygon vertices" : "Drag to select pixels";
      setUiText(status, pending ? selection.clipped() ? "Outside frame pixels will be clipped" : disabled ? "Release to preview · Escape to cancel" : "Preview · Enter to confirm · Escape to cancel"
        : bounds ? uiMessage(disabled || !editable ? "Selection {0} × {1}" : moveHint, bounds.width, bounds.height) : disabled ? "" : selectHint);
    },
    destroy() { transform.destroy(); window.removeEventListener("pointerdown", outside, true); },
  };
}
