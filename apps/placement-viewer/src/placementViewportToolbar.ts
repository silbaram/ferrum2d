import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
import { decorateViewportAction, installViewportToolbarKeys } from "./placementViewportChrome";
import { createPlacementControlMenu } from "./placementControlMenu";

type NavigationState = { tool: "select" | "pan"; temporary: boolean; dragging: boolean };
/** Fixed tools and a light-dismiss display disclosure outside the picking surface. */
export function createPlacementViewportToolbar(stage: HTMLElement, cancel: () => void, onColliderBoundsChange: (enabled: boolean) => void) {
  const element = document.createElement("section"),
    primary = document.createElement("div"),
    navigation = document.createElement("div"),
    camera = document.createElement("div"),
    readout = document.createElement("div"),
    status = document.createElement("output"),
    button = document.createElement("button"),
    size = document.createElement("span"),
    expand = document.createElement("button"),
    options = document.createElement("details"),
    summary = document.createElement("summary"),
    panel = document.createElement("div"),
    heading = document.createElement("strong"),
    close = document.createElement("button"),
    gridSettings = document.createElement("div"),
    spatialSettings = document.createElement("div"),
    flatNavigation = document.createElement("div"),
    spatialNavigation = document.createElement("div"),
    layoutSettings = document.createElement("div");
  const lightingSettings = document.createElement("div");
  const flatOverlays = document.createElement("label"), colliderBounds = document.createElement("input"), colliderText = document.createElement("span");
  flatOverlays.className = "placement-view-collider-bounds";
  colliderBounds.type = "checkbox";
  colliderBounds.dataset.placementColliderBounds = "true";
  setUiAttribute(colliderBounds, "aria-label", "Collision Bounds");
  setUiAttribute(flatOverlays, "title", "Show collision bounds and offset handle");
  setUiText(colliderText, "Collision Bounds");
  flatOverlays.append(colliderBounds, colliderText);
  colliderBounds.addEventListener("change", () => onColliderBoundsChange(colliderBounds.checked));
  let mode = "2d", label: string | undefined, dragging = false;
  const states: Record<string, NavigationState> = {};
  element.className = "placement-viewport-toolbar";
  setUiAttribute(element, "aria-label", "Viewport tools");
  primary.className = "placement-viewport-primary";
  primary.setAttribute("role", "toolbar");
  setUiAttribute(primary, "aria-label", "Viewport actions");
  navigation.className = "placement-navigation-mount";
  camera.className = "placement-camera-mount";
  readout.className = "placement-tool-readout";
  status.dataset.placementToolStatus = "true";
  status.setAttribute("aria-live", "polite");
  button.type = close.type = expand.type = "button";
  decorateViewportAction(button, "close", "Cancel", undefined, true);
  button.dataset.placementToolCancel = "true";
  button.addEventListener("click", cancel);
  size.dataset.placementViewportSize = "true";
  setUiAttribute(size, "aria-label", "Viewport size");
  setUiAttribute(size, "title", "Viewport size in CSS pixels");
  expand.dataset.placementViewportExpand = "true";
  decorateViewportAction(expand, "fit", "Expand View", undefined, true);

  options.className = "placement-view-options";
  summary.dataset.placementViewOptions = "true";
  summary.setAttribute("role", "button");
  summary.setAttribute("aria-expanded", "false");
  summary.setAttribute("aria-controls", "placement-view-options-panel");
  decorateViewportAction(summary, "view", "View");
  setUiAttribute(summary, "title", "Grid, snapping and overlays");
  const caret = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  caret.setAttribute("viewBox", "0 0 16 16");
  caret.setAttribute("aria-hidden", "true");
  caret.classList.add("placement-disclosure-caret");
  caret.innerHTML = '<path d="m4 6 4 4 4-4"/>';
  summary.append(caret);
  panel.id = "placement-view-options-panel";
  panel.className = "placement-view-panel";
  panel.setAttribute("role", "group");
  setUiAttribute(panel, "aria-label", "View settings");
  setUiText(heading, "View settings");
  setUiText(close, "Close");
  setUiAttribute(close, "aria-label", "Close view settings");
  close.addEventListener("click", () => closeOptions(true));
  const header = document.createElement("div");
  header.className = "placement-view-panel-header";
  header.append(heading, close);
  gridSettings.className = "placement-view-grid-settings";
  spatialSettings.className = "placement-view-spatial-settings";
  flatNavigation.className = spatialNavigation.className = "placement-view-navigation";
  layoutSettings.className = "placement-view-layout";
  panel.append(header, flatNavigation, spatialNavigation, lightingSettings, gridSettings, flatOverlays, spatialSettings, layoutSettings);
  options.append(summary, panel);
  // The runtime handles Enter/Space globally; own disclosure activation here
  // so keyboard users retain native-like behavior without gameplay input.
  summary.addEventListener("keydown", (event) => {
    if (event.code !== "Enter" && event.code !== "Space") return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) summary.click();
  });
  options.addEventListener("toggle", () => summary.setAttribute("aria-expanded", String(options.open)));
  function closeOptions(restoreFocus = false) {
    if (!options.open) return;
    options.open = false;
    summary.setAttribute("aria-expanded", "false");
    for (const menu of panel.querySelectorAll<HTMLDetailsElement>("details[data-placement-menu]")) {
      menu.open = false;
      menu.querySelector(":scope > summary")?.setAttribute("aria-expanded", "false");
    }
    if (restoreFocus) summary.focus({ preventScroll: true });
  }
  // Outside pointer/focus dismiss without stealing focus from the next action.
  document.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Node && !options.contains(event.target)) closeOptions();
  }, true);
  document.addEventListener("focusin", (event) => {
    if (event.target instanceof Node && !options.contains(event.target)) closeOptions();
  });
  window.addEventListener("resize", () => closeOptions());
  options.addEventListener("keydown", (event) => {
    if (event.code !== "Escape" || !options.open) return;
    event.preventDefault();
    event.stopPropagation();
    closeOptions(true);
  });
  readout.append(status);
  const help = createPlacementControlMenu("help", "Controls", "help");
  const instructions = document.createElement("dl");
  instructions.className = "placement-controls-guide";
  for (const [label, description] of [
    ["Place objects", "Drag an asset from Assets into the viewport."],
    ["Edit selection", "Select an object, then edit its properties in Inspector."],
    ["Navigate", "V: select · H or Space + drag: pan · Wheel: zoom"],
    ["Frame view", "F: selected object · Home: entire scene"],
    ["Editor View", "View > Editor View changes navigation. Game Camera edits the saved view."],
    ["Play", "Play runs the scene. Stop returns to editing."],
    ["Keep changes", "Export copies a patch or handoff. File saving requires a save-enabled host."],
  ]) {
    const term = document.createElement("dt"), descriptionElement = document.createElement("dd");
    setUiText(term, label);
    setUiText(descriptionElement, description);
    instructions.append(term, descriptionElement);
  }
  help.panel.append(instructions);
  panel.append(help.element, size);
  primary.append(navigation, camera, button, options, expand);
  element.append(primary, readout);
  installViewportToolbarKeys(primary);
  stage.closest(".demo-shell")?.append(element);
  function renderReadout() {
    const nav = states[mode];
    const text = label
      ? uiMessage("{0}: {1} · {2} · Esc to cancel", uiMessage(dragging ? "Drag" : "Place"), label, uiMessage(dragging ? "Drop into viewport" : "Click to place"))
      : mode === "game" ? (stage.dataset.gameCameraEditing === "true" ? "Camera preview paused · Adjust the panel to frame the game" : stage.dataset.flatActor ? "Game Preview · Click ground to move · Stop to edit" : stage.dataset.spatialActor ? "Game Preview · WASD to move · Stop to edit" : "Game Preview · Choose 2D or HD-2D to edit")
        : nav?.temporary ? "Temporary pan · Release Space to return"
          : nav?.dragging ? "Panning · Esc to cancel"
            : nav?.tool === "pan" ? "Pan view · Drag to move · V to select"
              : "Select objects · Space + drag to pan";
    setUiText(status, text);
    setUiAttribute(status, "title", text);
    readout.dataset.active = String(!!label);
    readout.dataset.navigation = nav?.temporary ? "temporary-pan" : nav?.tool ?? "select";
    button.hidden = !label;
    readout.hidden = !label && mode !== "game" && !nav?.temporary && !nav?.dragging && nav?.tool !== "pan";
  }
  stage.addEventListener("placement-navigation-change", (event) => {
    const detail = (event as CustomEvent<NavigationState & { mode: string }>).detail;
    states[detail.mode] = detail;
    if (mode === detail.mode) renderReadout();
  });
  return {
    element, navigation, camera, gridSettings, spatialSettings, flatNavigation, spatialNavigation, layoutSettings, lightingSettings,
    sync(nextMode: string, nextLabel?: string, nextDragging = false) {
      if (mode !== nextMode) closeOptions();
      mode = nextMode; label = nextLabel; dragging = nextDragging;
      navigation.hidden = mode !== "2d";
      camera.hidden = mode === "2d";
      spatialSettings.hidden = mode !== "spatial";
      flatNavigation.hidden = mode !== "2d";
      spatialNavigation.hidden = mode !== "spatial";
      gridSettings.hidden = mode === "game";
      flatOverlays.hidden = mode !== "2d";
      renderReadout();
    },
  };
}
