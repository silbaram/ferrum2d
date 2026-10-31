import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
import type { createPixelSelection } from "./placementPixelSelection";

export function createPixelSelectionControls(options: {
  selection: ReturnType<typeof createPixelSelection>;
  perform(run: () => unknown): void;
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
  function button(key: string, label: string, shortcut: string, run: () => unknown, parent: HTMLElement) {
    const node = document.createElement("button"); node.type = "button"; node.dataset.pixelAction = key;
    setUiText(node, label); setUiAttribute(node, "aria-label", label);
    setUiAttribute(node, "title", shortcut ? uiMessage("{0} ({1})", uiMessage(label), shortcut) : label);
    node.onclick = () => { menu.open = false; options.perform(run); }; parent.append(node); buttons.set(key, node);
    return node;
  }
  for (const [key, label, shortcut, run] of actions) button(key, label, shortcut, run, panel);
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
    sync(visible: boolean, disabled: boolean) {
      element.hidden = !visible; if (!visible) menu.open = false;
      const bounds = selection.bounds(), pending = selection.pending(), editable = selection.editable();
      for (const [key, node] of buttons) {
        node.disabled = disabled || (key !== "select-all" && key !== "paste" && !bounds);
        if (["cut", "delete", "flip-x", "flip-y", "rotate", "paste", "selection-confirm"].includes(key)) node.disabled ||= !editable;
        if (["select-all", "cut", "delete", "paste"].includes(key)) node.disabled ||= pending;
        if (key === "paste") node.disabled ||= !selection.hasClipboard();
      }
      confirm.hidden = cancel.hidden = !pending;
      setUiText(status, pending ? selection.clipped() ? "Outside frame pixels will be clipped" : "Preview · Enter to confirm · Escape to cancel"
        : bounds ? uiMessage("Selection {0} × {1} · Drag or arrow keys to move", bounds.width, bounds.height) : "Drag to select pixels");
    },
    destroy() { window.removeEventListener("pointerdown", outside, true); },
  };
}
