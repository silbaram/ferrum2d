import { formatUi, setUiText, uiMessage, type UiContent } from "./placementLocale";

type InspectorContext = { mode: string; count: number; locked: boolean; target?: string };
/** Presentation metadata only; control owners retain edit capabilities and patches. */
export function placementInspectorContext(input: InspectorContext): { state: string; message: UiContent } {
  if (input.mode === "game") return { state: "game", message: "Game preview · Stop to edit" };
  if (!input.count && !input.target) return { state: "empty", message: "Select an object to edit its properties." };
  if (input.locked) return { state: "locked", message: "Selection locked · Unlock to edit" };
  if (input.mode === "spatial") return { state: "spatial", message: "Spatial fields edit the active target" };
  if (input.count > 1) return { state: "multiple", message: uiMessage("Transform affects {0} objects · Components need one selection", input.count) };
  return { state: "single", message: "Drag to move" };
}

export function createPlacementInspectorContext() {
  const element = document.createElement("output");
  element.className = "placement-inspector-context";
  element.dataset.placementInspectorContext = "true";
  element.setAttribute("role", "status"); element.setAttribute("aria-live", "polite");
  let previous = "";
  return { element, sync(input: InspectorContext) {
    const next = placementInspectorContext(input), signature = next.state + ":" + formatUi(next.message, "en");
    if (previous === signature) return;
    previous = signature; element.dataset.state = next.state; setUiText(element, next.message);
  } };
}
