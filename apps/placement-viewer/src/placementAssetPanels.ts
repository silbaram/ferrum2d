import { createPlacementControlMenu } from "./placementControlMenu";
import { setUiText } from "./placementLocale";

const IMPORT_PANELS = [
  ["pixel", "Pixel Art"],
  ["aseprite", "Import Aseprite"],
  ["tile", "Import Tile Frames"],
  ["model", "Import Model"],
  ["normal", "Generate Normal"],
] as const;
const MANAGE_PANELS = [
  ["usage", "Asset Usage"],
  ["cleanup", "Catalog Cleanup"],
  ["changes", "Asset Changes"],
] as const;
export type PlacementAssetTool = (typeof IMPORT_PANELS | typeof MANAGE_PANELS)[number][0];
export type PlacementAssetPanel = "browse" | PlacementAssetTool;

/** UI-only view switch: every tool keeps its own state, handlers and IO owners. */
export function createPlacementAssetPanels(host: HTMLElement, assetsTab: HTMLElement, selectAssets: () => void) {
  const bar = document.createElement("div"), back = document.createElement("button"), title = document.createElement("strong");
  bar.className = "placement-asset-view-bar";
  back.type = "button";
  back.className = "placement-asset-back";
  back.dataset.placementAssetViewBack = "true";
  setUiText(back, "Back to Assets");
  bar.append(back, title);
  host.prepend(bar);
  const actions = document.createElement("div");
  actions.className = "placement-asset-actions";
  const panels = new Map<PlacementAssetPanel, HTMLElement>(), entries = new Map<PlacementAssetTool, HTMLButtonElement>();
  const titles = new Map<PlacementAssetPanel, string>([...IMPORT_PANELS, ...MANAGE_PANELS]);
  let active: PlacementAssetPanel = "browse", reveal: (() => void) | undefined;
  function menu(id: string, label: string, icon: "plus" | "view", items: readonly (readonly [PlacementAssetTool, string])[]) {
    const control = createPlacementControlMenu(id, label, icon);
    for (const [panel, text] of items) {
      const entry = document.createElement("button");
      entry.type = "button";
      entry.dataset.placementAssetOpen = panel;
      setUiText(entry, text);
      entry.addEventListener("click", () => { show(panel); control.close(); });
      entries.set(panel, entry);
      control.panel.append(entry);
    }
    actions.append(control.element);
    return control;
  }
  const importMenu = menu("asset-import", "Import", "plus", IMPORT_PANELS);
  menu("asset-manage", "Manage", "view", MANAGE_PANELS);
  function sync() {
    for (const [id, panel] of panels) {
      panel.dataset.assetPanel = id;
      panel.dataset.assetPanelActive = String(id === active);
    }
    bar.hidden = active === "browse";
    const label = titles.get(active);
    if (label) setUiText(title, label);
  }
  function show(id: PlacementAssetPanel) {
    if (id !== active) {
      const previous = panels.get(active), next = panels.get(id);
      active = id;
      if (previous instanceof HTMLDetailsElement) previous.open = false;
      if (next instanceof HTMLDetailsElement) next.open = true;
      sync();
    }
    if (id === "browse") return;
    selectAssets();
    reveal?.();
  }
  back.addEventListener("click", () => {
    const tool = active;
    show("browse");
    if (tool !== "browse") (actions.querySelector<HTMLElement>("summary") ?? back).focus({ preventScroll: true });
  });
  return {
    actions,
    show,
    active: () => active,
    bindReveal(callback: () => void) { reveal = callback; },
    /** Tools opened by their own code paths drive the view through their disclosure. */
    register(id: PlacementAssetPanel, panel: HTMLElement) {
      if (panels.get(id) === panel) return;
      panels.set(id, panel);
      if (panel instanceof HTMLDetailsElement)
        panel.addEventListener("toggle", () => {
          if (panel.open && active !== id) show(id);
          else if (!panel.open && active === id) show("browse");
        });
      sync();
    },
    /** A collapsed drawer must still announce pending recovery or launch errors. */
    attention(id: PlacementAssetTool, value: boolean) {
      for (const node of [entries.get(id), importMenu.summary, assetsTab])
        if (node) node.dataset.assetAttention = String(value);
    },
  };
}
