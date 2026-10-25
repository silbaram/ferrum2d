import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
import { decorateViewportAction, installViewportToolbarKeys } from "./placementViewportChrome";

type NavigationState = { tool: "select" | "pan"; temporary: boolean; dragging: boolean };
/** Fixed tools and a light-dismiss display disclosure outside the picking surface. */
export function createPlacementViewportToolbar(stage: HTMLElement, cancel: () => void) {
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
    spatialSettings = document.createElement("div");
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
  setUiText(button, "Cancel");
  button.dataset.placementToolCancel = "true";
  button.addEventListener("click", cancel);
  size.dataset.placementViewportSize = "true";
  setUiAttribute(size, "aria-label", "Viewport size");
  setUiAttribute(size, "title", "Viewport size in CSS pixels");
  expand.dataset.placementViewportExpand = "true";
  setUiText(expand, "Expand View");

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
  panel.append(header, gridSettings, spatialSettings);
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
    if (restoreFocus) summary.focus({ preventScroll: true });
  }
  // Outside pointer/focus dismiss without stealing focus from the next action.
  document.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Node && !options.contains(event.target)) closeOptions();
  }, true);
  document.addEventListener("focusin", (event) => {
    if (event.target instanceof Node && !options.contains(event.target)) closeOptions();
  });
  options.addEventListener("keydown", (event) => {
    if (event.code !== "Escape" || !options.open) return;
    event.preventDefault();
    event.stopPropagation();
    closeOptions(true);
  });
  readout.append(status, button, size, expand);
  primary.append(navigation, camera, options);
  element.append(primary, readout);
  installViewportToolbarKeys(primary);
  stage.closest(".demo-shell")?.append(element);
  function renderReadout() {
    const nav = states[mode];
    const text = label
      ? uiMessage("{0}: {1} · {2} · Esc to cancel", uiMessage(dragging ? "Drag" : "Place"), label, uiMessage(dragging ? "Drop into viewport" : "Click to place"))
      : mode === "game" ? (stage.dataset.spatialActor ? "Game Preview · WASD to move · Stop to edit" : "Game Preview · Choose 2D or HD-2D to edit")
        : nav?.temporary ? "Temporary pan · Release Space to return"
          : nav?.dragging ? "Panning · Esc to cancel"
            : nav?.tool === "pan" ? "Pan view · Drag to move · V to select"
              : "Select objects · Space + drag to pan";
    setUiText(status, text);
    setUiAttribute(status, "title", text);
    readout.dataset.active = String(!!label);
    readout.dataset.navigation = nav?.temporary ? "temporary-pan" : nav?.tool ?? "select";
    button.hidden = !label;
  }
  stage.addEventListener("placement-navigation-change", (event) => {
    const detail = (event as CustomEvent<NavigationState & { mode: string }>).detail;
    states[detail.mode] = detail;
    if (mode === detail.mode) renderReadout();
  });
  return {
    element, navigation, camera, gridSettings, spatialSettings,
    sync(nextMode: string, nextLabel?: string, nextDragging = false) {
      if (mode !== nextMode) closeOptions();
      mode = nextMode; label = nextLabel; dragging = nextDragging;
      navigation.hidden = mode !== "2d";
      camera.hidden = spatialSettings.hidden = mode !== "spatial";
      options.hidden = mode === "game";
      renderReadout();
    },
  };
}
