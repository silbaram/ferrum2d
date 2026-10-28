import { createPlacementControlMenu } from "./placementControlMenu";
import { setUiAttribute, setUiText } from "./placementLocale";
import type { createPlacementViewportToolbar } from "./placementViewportToolbar";

/** Arrange existing controls; their owners retain document, camera and playback state. */
export function installPlacementWorkspaceChrome(root: HTMLElement, viewport: ReturnType<typeof createPlacementViewportToolbar>,
  openExample?: (name: "garden" | "village" | "default") => void,
  showScenes?: () => void,
  showUpdates?: () => void) {
  const header = root.querySelector<HTMLElement>(".demo-toolbar"),
    title = header?.querySelector<HTMLElement>("h1"),
    actions = header?.querySelector<HTMLElement>(".demo-actions"),
    fileStrip = root.querySelector<HTMLElement>(".placement-file-strip"),
    strip = root.querySelector<HTMLElement>(".placement-workspace-strip"),
    modes = root.querySelector<HTMLElement>(".placement-workspace-modes"),
    layout = root.querySelector<HTMLElement>(".placement-layout-controls"),
    open = root.querySelector<HTMLButtonElement>('[data-placement-action="open-json-document"]');
  if (!header || !title || !actions || !strip || !modes || !layout) return;
  const brand = document.createElement("div");
  brand.className = "placement-app-menu";
  const file = createPlacementControlMenu("file", "File", "file");
  if (fileStrip) file.panel.append(fileStrip);
  if (open) file.panel.append(open);
  if (showUpdates) {
    const updates = document.createElement("button"); updates.type = "button"; updates.dataset.placementAction = "updates";
    setUiText(updates, "Versions and updates");
    updates.addEventListener("click", () => { file.close(true); showUpdates(); }); file.panel.append(updates);
  }
  if (showScenes) {
    const scenes = document.createElement("button"); scenes.type = "button";
    scenes.dataset.placementAction = "scene-explorer";
    setUiText(scenes, "Project scenes");
    scenes.addEventListener("click", () => { file.close(true); showScenes(); });
    file.panel.append(scenes);
  }
  if (openExample) {
    const examples = createPlacementControlMenu("examples", "Examples", "file");
    for (const [name, label] of [["garden", "2D Lantern Garden"], ["village", "HD-2D Village"], ["default", "Basic 2D"]] as const) {
      const button = document.createElement("button"); button.type = "button";
      button.dataset.placementExample = name;
      setUiAttribute(button, "aria-label", label);
      const text = document.createElement("span");
      button.append(text); setUiText(text, label);
      button.addEventListener("click", () => { examples.close(); file.close(true); openExample(name); });
      examples.panel.append(button);
    }
    file.panel.append(examples.element);
  }
  brand.append(title, file.element);
  header.replaceChildren(brand, modes, actions);
  root.dataset.compactChrome = "true";
  strip.insertBefore(viewport.element, layout);
  const readout = viewport.element.querySelector<HTMLElement>(".placement-tool-readout");
  if (readout) root.querySelector(".placement-status-bar")?.append(readout);
  const language = actions.querySelector<HTMLElement>(".placement-language"),
    history = actions.querySelector<HTMLElement>(".placement-session-controls"),
    playback = actions.querySelector<HTMLElement>(".placement-mode-controls");
  for (const control of [history, language, playback]) if (control) actions.append(control);
  setUiAttribute(actions, "aria-label", "History, language and playback");

  // Compact screens retain direct panel tabs. Desktop layout settings live in View.
  function syncLayoutHome() {
    const home = root.dataset.compact === "true" ? strip! : viewport.layoutSettings;
    if (layout!.parentElement !== home) home.append(layout!);
  }
  syncLayoutHome();
  const observer = new MutationObserver(syncLayoutHome);
  observer.observe(root, { attributes: true, attributeFilter: ["data-compact"] });
  window.addEventListener("pagehide", event => { if (!event.persisted) observer.disconnect(); });
}
