import type { ScenePlacementViewerState } from "@ferrum2d/ferrum-web/authoring";
import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
import { decorateViewportAction } from "./placementViewportChrome";
import { placementRenderLayer, placementLayerGroups, type PlacementLayerViewState } from "./placementLayerState";

export type PlacementLayerAction =
  | { kind: "policy"; hiddenLayers: readonly number[]; lockedLayers: readonly number[] }
  | { kind: "select"; ids: string[] }
  | { kind: "move"; layer: number }
  | { kind: "swap"; from: number; to: number };

/** Numeric layer aliases are local viewer preferences, never runtime scene metadata. */
export function createPlacementLayers(source: string, filter: (layer?: number) => void, view: PlacementLayerViewState = { beforeSolo: [] }) {
  const element = document.createElement("details"), summary = document.createElement("summary"), rows = document.createElement("div");
  element.className = "placement-layers"; element.open = true;
  setUiText(summary, "Render Layers"); element.append(summary);
  const tools = document.createElement("div"), fields = document.createElement("div"), message = document.createElement("output");
  tools.className = fields.className = "placement-layer-tools";
  message.setAttribute("role", "status"); element.append(tools, rows, fields, message);
  let state: ScenePlacementViewerState | undefined, signature = "";
  const storageKey = `ferrum-placement-layer-aliases:${source}`;
  let aliases: Record<string, string> = {};
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    if (value && typeof value === "object" && !Array.isArray(value))
      for (const [key, name] of Object.entries(value).slice(0, 1024))
        if (Number.isInteger(Number(key)) && typeof name === "string" && name.length <= 64) aliases[key] = name;
  } catch { /* Storage may be unavailable in a local file host. */ }
  function emit(action: PlacementLayerAction) {
    let rejected = false;
    element.dispatchEvent(new CustomEvent("placement-layer-action", { bubbles: true, detail: { action, report(error?: string) { rejected = error !== undefined; setUiText(message, error ?? ""); } } }));
    return !rejected;
  }
  const policy = () => state?.layerEditing ?? { hiddenLayers: [], lockedLayers: [] };
  function button(parent: HTMLElement, label: string, action: () => void) {
    const value = document.createElement("button"); value.type = "button"; setUiText(value, label);
    value.addEventListener("click", action); parent.append(value); return value;
  }
  const all = button(tools, "All Layers", () => { view.active = undefined; filter(); refresh(); });
  const show = button(tools, "Show All", () => { if (emit({ kind: "policy", ...policy(), hiddenLayers: [] })) { view.solo = undefined; signature = ""; refresh(); } });
  const unlock = button(tools, "Unlock Layers", () => emit({ kind: "policy", ...policy(), lockedLayers: [] }));
  const alias = document.createElement("input"); alias.type = "text"; alias.maxLength = 64;
  setUiAttribute(alias, "aria-label", "Layer Alias"); setUiAttribute(alias, "title", "Local alias for this layer number"); fields.append(alias);
  setUiAttribute(alias, "placeholder", "Layer Alias");
  alias.addEventListener("change", () => {
    const { active } = view;
    if (active === undefined) return;
    if (alias.value.trim()) aliases[String(active)] = alias.value.trim(); else delete aliases[String(active)];
    try { localStorage.setItem(storageKey, JSON.stringify(aliases)); } catch { /* Optional UI preference. */ }
    signature = ""; refresh();
  });
  const select = button(fields, "Select Layer", () => {
    emit({ kind: "select", ids: state?.instances.filter(i => placementRenderLayer(i) === view.active).map(i => i.instanceId) ?? [] });
  });
  const move = button(fields, "Move Selection", () => { if (view.active !== undefined) emit({ kind: "move", layer: view.active }); });
  const hint = document.createElement("p"); setUiText(hint, "Front to back. Hide and lock affect editing only."); element.append(hint);
  function refresh() {
    if (!state) return;
    const groups = placementLayerGroups(state), order = [...groups.keys()].sort((a, b) => b - a), { hiddenLayers, lockedLayers } = policy();
    const hidden = new Set(hiddenLayers), locked = new Set(state.lockedInstanceIds);
    if (view.active !== undefined && !order.includes(view.active)) { view.active = undefined; filter(); }
    const { active, solo } = view;
    const next = JSON.stringify([order, [...groups].map(([layer, group]) => [layer, group.ids]), state.selectedInstanceIds, state.lockedInstanceIds, hiddenLayers, lockedLayers, active, solo, aliases]);
    all.setAttribute("aria-pressed", String(active === undefined)); show.disabled = !hiddenLayers.length; unlock.disabled = !lockedLayers.length;
    alias.disabled = select.disabled = move.disabled = active === undefined;
    if (document.activeElement !== alias) alias.value = active === undefined ? "" : aliases[String(active)] ?? "";
    if (active !== undefined) {
      select.disabled = hiddenLayers.includes(active);
      move.disabled = !state.selectedInstanceIds.length || hidden.has(active) || lockedLayers.includes(active) || state.selectedInstanceIds.some(id => locked.has(id));
    }
    if (next === signature) return; signature = next;
    const focused = rows.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.layerControl : undefined;
    const focusedLayer = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-render-layer]")?.dataset.renderLayer;
    rows.replaceChildren(...order.map((layer, index) => {
      const row = document.createElement("div"); row.className = "placement-layer-row"; row.dataset.renderLayer = String(layer);
      setUiAttribute(row, "title", "Drag to swap layer order");
      const members = groups.get(layer)!;
      row.dataset.active = String(active === layer); row.dataset.selected = String(members.selected);
      row.dataset.hiddenLayer = String(hiddenLayers.includes(layer)); row.draggable = true;
      const label = button(row, "", () => { view.active = layer; filter(layer); signature = ""; refresh(); });
      label.className = "placement-layer-name"; label.textContent = `${layer}${aliases[String(layer)] ? ` · ${aliases[String(layer)]}` : ""} (${members.ids.length})`;
      setUiAttribute(label, "title", uiMessage("Layer {0}", layer)); label.dataset.layerControl = "filter";
      label.setAttribute("aria-pressed", String(active === layer));
      const icon = (key: string, glyph: "eye" | "eyeOff" | "lock" | "unlock" | "solo" | "layerUp" | "layerDown", title: string, action: () => void, pressed?: boolean) => {
        const b = button(row, "", action); decorateViewportAction(b, glyph, title, undefined, true); b.dataset.layerControl = key;
        if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed)); return b;
      };
      icon("visible", hiddenLayers.includes(layer) ? "eyeOff" : "eye", "Toggle Layer Visibility", () => {
        if (emit({ kind: "policy", ...policy(), hiddenLayers: hiddenLayers.includes(layer) ? hiddenLayers.filter(v => v !== layer) : [...hiddenLayers, layer] })) { view.solo = undefined; signature = ""; refresh(); }
      }, !hiddenLayers.includes(layer));
      icon("lock", lockedLayers.includes(layer) ? "lock" : "unlock", "Toggle Layer Lock", () => emit({ kind: "policy", ...policy(), lockedLayers: lockedLayers.includes(layer) ? lockedLayers.filter(v => v !== layer) : [...lockedLayers, layer] }), lockedLayers.includes(layer));
      icon("solo", "solo", "Solo Layer", () => {
        const nextSolo = solo === layer ? undefined : layer;
        const restore = solo === undefined ? [...policy().hiddenLayers] : view.beforeSolo;
        if (emit({ kind: "policy", ...policy(), hiddenLayers: nextSolo === undefined ? [...restore] : order.filter(v => v !== layer) })) {
          view.beforeSolo = restore; view.solo = nextSolo; signature = ""; refresh();
        }
      }, solo === layer);
      for (const [key, glyph, title, other] of [["up", "layerUp", "Move Layer Forward", order[index - 1]], ["down", "layerDown", "Move Layer Backward", order[index + 1]]] as const) {
        const b = icon(key, glyph, title, () => { if (other !== undefined) emit({ kind: "swap", from: layer, to: other }); });
        b.disabled = other === undefined || hidden.has(layer) || hidden.has(other) || members.locked || groups.get(other)!.locked;
      }
      row.addEventListener("dragstart", event => { event.dataTransfer?.setData("application/x-ferrum-render-layer", String(layer)); });
      row.addEventListener("dragover", event => { if (event.dataTransfer?.types.includes("application/x-ferrum-render-layer")) event.preventDefault(); });
      row.addEventListener("drop", event => {
        const raw = event.dataTransfer?.getData("application/x-ferrum-render-layer"); if (!raw) return;
        event.preventDefault(); const from = Number(raw); if (from !== layer && order.includes(from)) emit({ kind: "swap", from, to: layer });
      });
      return row;
    }));
    if (focused && focusedLayer) rows.querySelector<HTMLElement>(`[data-render-layer="${focusedLayer}"] [data-layer-control="${focused}"]`)?.focus({ preventScroll: true });
  }
  return { element, view, sync(next: ScenePlacementViewerState, mode = "2d") { state = next; element.hidden = mode !== "2d"; refresh(); if (mode === "2d") filter(view.active); } };
}
