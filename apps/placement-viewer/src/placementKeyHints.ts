import { setUiText } from "./placementLocale";

export interface PlacementKeyHintContext {
  mode: "2d" | "spatial";
  selected: number;
  locked: boolean;
  mac: boolean;
}
export type PlacementKeyHint = readonly [key: string, label: string];

export const isMacPlatform = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** Mac keeps Ctrl+K for text fields' kill-line; other platforms have no Cmd key. */
export const commandSearchShortcut = (mac: boolean) => (mac ? "⌘K" : "Ctrl+K");
export const isCommandSearchShortcut = (event: KeyboardEvent, mac: boolean) =>
  event.code === "KeyK" && !event.altKey && !event.shiftKey && (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);

/** Only keys whose handlers act in this state; the viewport handlers remain the owners. */
export function placementKeyHints(context: PlacementKeyHintContext): PlacementKeyHint[] {
  const mod = context.mac ? "⌘" : "Ctrl+";
  // First, so a narrow status bar clips the contextual keys rather than the palette.
  const hints: PlacementKeyHint[] = [[commandSearchShortcut(context.mac), "Commands"]];
  if (!context.selected) {
    if (context.mode === "2d") hints.push([`${mod}A`, "Select all"]);
    hints.push(["Space", "Drag to pan"], ["Home", "Fit Scene"]);
  } else {
    if (!context.locked) {
      if (context.mode === "2d") hints.push(["↑↓←→", "Nudge (Shift ×10)"]);
      else hints.push([`${mod}D`, "Duplicate"]);
      hints.push(["Delete", "Remove"]);
    }
    hints.push(["F", "Frame Selected"]);
    if (context.mode === "2d") hints.push(["Esc", "Deselect"]);
  }
  return hints;
}

export function renderPlacementKeyHints(element: HTMLElement, hints: readonly PlacementKeyHint[]) {
  const signature = JSON.stringify(hints);
  if (element.dataset.signature === signature) return;
  element.dataset.signature = signature;
  element.replaceChildren(...hints.map(([key, label]) => {
    const item = document.createElement("span"), kbd = document.createElement("kbd"), text = document.createElement("span");
    item.className = "placement-key-hint";
    kbd.textContent = key;
    setUiText(text, label);
    item.append(kbd, text);
    return item;
  }));
}
