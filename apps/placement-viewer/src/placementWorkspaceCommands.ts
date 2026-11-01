import type { PlacementCommand } from "./placementCommandPalette";
import { WORKSPACE_PRESETS } from "./placementWorkspacePreferences";

/** Declarative adapters to existing UI owners; no patch or simulation state lives here. */
export function placementWorkspaceCommands(options: {
  root: HTMLElement;
  documentRoot(): HTMLElement;
  mode(): string;
  pixelOpen(): boolean;
  reveal(dock: "scene" | "inspector" | "runtime"): void;
}): PlacementCommand[] {
  const commands: PlacementCommand[] = [];
  const editorView = () => !options.pixelOpen() && options.mode() !== "game";
  function action(id: string, label: string, category: string, selector: () => string, enabled = () => true, shortcut?: string, before?: () => void, scope: () => HTMLElement = () => options.root) {
    const target = () => scope().querySelector<HTMLButtonElement>(selector());
    commands.push({ id, label, category, shortcut,
      enabled: () => { const control = target(); return enabled() && !!control?.isConnected && !control.matches(":disabled") && !control.hidden; },
      run() { if (!enabled()) return; const control = target(); if (!control?.isConnected || control.matches(":disabled") || control.hidden) return; before?.(); control.focus?.({ preventScroll: true }); control.click(); },
    });
  }
  const navigation = (flat: string, spatial: string) => () => options.mode() === "2d" ? flat : spatial;
  action("select", "Select", "Viewport", navigation('[data-placement-view-action="select"]', '[data-placement-spatial-navigation="select"]'), editorView, "V");
  action("pan", "Pan", "Viewport", navigation('[data-placement-view-action="pan"]', '[data-placement-spatial-navigation="pan"]'), editorView, "H");
  action("frame-selection", "Frame Selected", "Viewport", navigation('[data-placement-view-action="frame-selection"]', '[data-placement-spatial-frame="true"]'), editorView, "F");
  action("fit-scene", "Fit Scene", "Viewport", navigation('[data-placement-view-action="fit-scene"]', '[data-placement-spatial-frame="false"]'), editorView, "Home");
  action("reset-view", "Reset Camera", "Viewport", navigation('[data-placement-view-action="reset-view"]', '[data-placement-spatial-camera="reset"]'), editorView);
  action("game-camera", "Game Camera", "Viewport", () => '[data-placement-game-camera-edit]', () => !options.pixelOpen());
  for (const [id, label, mode] of [["view-2d", "2D View", "2d"], ["view-hd2d", "HD-2D View", "spatial"], ["view-game", "Game Preview", "game"]])
    action(id, label, "Workspace", () => `[data-placement-mode="${mode}"]`, () => !options.pixelOpen());
  action("play", "Play", "Workspace", () => '[data-placement-playback="play"]', () => !options.pixelOpen());
  action("stop", "Stop", "Workspace", () => '[data-placement-playback="stop"]', () => !options.pixelOpen());
  action("project-scenes", "Project scenes", "Panels", () => '[data-placement-action="scene-explorer"]');
  for (const [id, label, dock, selector] of [
    ["objects", "Objects", "scene", '[data-placement-panel-tab="objects"]'],
    ["properties", "Properties", "inspector", '.placement-inspector [data-placement-panel-tab="properties"]'],
    ["assets", "Assets", "runtime", '.placement-runtime-dock [data-placement-panel-tab="assets"]'],
    ["problems", "Problems", "runtime", '.placement-runtime-dock [data-placement-panel-tab="problems"]'],
    ["runtime", "Runtime", "runtime", '.placement-runtime-dock [data-placement-panel-tab="runtime"]'],
  ] as const) action(id, label, "Panels", () => selector, () => true, undefined, () => options.reveal(dock), dock === "runtime" ? () => options.root : options.documentRoot);
  action("focus-view", "Focus", "Workspace", () => '[data-placement-action="focus-viewport"]');
  action("reset-layout", "Reset Layout", "Workspace", () => '[data-placement-action="reset-layout"]');
  for (const { id, label } of WORKSPACE_PRESETS)
    action(`layout-${id}`, label, "Layouts", () => `[data-placement-layout-preset="${id}"]`);
  action("new-pixel", "New Pixel", "Pixel Art", () => '[data-pixel-launcher] [data-pixel-action="new"]');
  action("open-pixel", "Open Pixel / PNG", "Pixel Art", () => '[data-pixel-launcher] [data-pixel-action="open"]');
  for (const [id, label, actionName, key] of [["pixel-undo", "Undo", "undo", "Ctrl/Cmd Z"], ["pixel-redo", "Redo", "redo", "Ctrl/Cmd Shift Z"], ["pixel-fit", "Fit", "fit", ""], ["back-to-scene", "Back To Scene", "back", ""]])
    action(id, label, "Pixel Art", () => `#placement-pixel-workspace [data-pixel-action="${actionName}"]`, options.pixelOpen, key);
  const properties = commands.find(command => command.id === "properties");
  if (properties) properties.keywords = ["transform", "rotation", "scale", "position", "속성", "위치", "회전", "크기"];
  return commands;
}
