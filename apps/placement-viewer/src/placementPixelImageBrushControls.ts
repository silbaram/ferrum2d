import { createPixelBrushLibrary, PIXEL_IMAGE_BRUSH_LIMITS } from "./placementPixelImageBrush";
import type { createPixelEditor, PixelRegion } from "./placementPixelDocument";
import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";

export function createPixelImageBrushControls(options: { editor(): ReturnType<typeof createPixelEditor>; area(): PixelRegion | undefined; disabled(): boolean; clearSelection(): void; choose(): void; report(error: unknown): void }) {
  const element = document.createElement("details"), summary = document.createElement("summary"), panel = document.createElement("div"); element.className = "placement-pixel-image-brush-menu"; setUiText(summary, "Image Brushes"); element.append(summary, panel);
  const library = createPixelBrushLibrary(), select = document.createElement("select"); select.dataset.pixelImageBrush = "true"; setUiAttribute(select, "aria-label", "Active Image Brush"); panel.append(select);
  let id = "", anchorX = 0, anchorY = 0, spacing = 1, signature = "";
  const capture = document.createElement("button"), remove = document.createElement("button"); capture.type = remove.type = "button"; capture.dataset.pixelBrushAction = "capture"; remove.dataset.pixelBrushAction = "remove"; setUiText(capture, "Brush From Selection"); setUiText(remove, "Remove Brush"); panel.append(capture, remove);
  const fields = new Map<string, HTMLInputElement>();
  for (const [key, label] of [["x", "Brush Anchor X"], ["y", "Brush Anchor Y"], ["spacing", "Brush Spacing"]]) {
    const row = document.createElement("label"), text = document.createElement("span"), input = document.createElement("input"); input.type = "number"; input.min = key === "spacing" ? "1" : "0"; input.max = "32"; input.dataset.pixelBrushSetting = key; setUiText(text, label); setUiAttribute(input, "aria-label", label); row.append(text, input); panel.append(row); fields.set(key, input);
    input.onchange = () => {
      if (!id || options.disabled()) return;
      try { const brush = library.snapshot(id, key === "x" ? input.valueAsNumber : anchorX, key === "y" ? input.valueAsNumber : anchorY, key === "spacing" ? input.valueAsNumber : spacing); anchorX = brush.anchorX; anchorY = brush.anchorY; spacing = brush.spacing; options.choose(); }
      catch (error) { options.report(error); sync(); }
    };
  }
  const hint = document.createElement("p"); setUiText(hint, "Raw colors · Transparent pixels keep the background · Last stamp wins"); panel.append(hint);
  const limit = document.createElement("p"); setUiText(limit, "Up to 8 brushes · 32 × 32 · 64 KiB · Current document only"); panel.append(limit);
  function use(value: string) { id = value; if (id) { const b = library.snapshot(id); anchorX = b.anchorX; anchorY = b.anchorY; spacing = b.spacing; } options.choose(); }
  select.onchange = () => { if (!options.disabled()) use(select.value); };
  capture.onclick = () => { if (options.disabled()) return; try { const area = options.area(); if (!area) throw Error("Select pixels to create a brush"); const next = library.capture(options.editor().readRegion(area)); options.clearSelection(); use(next); } catch (error) { options.report(error); } };
  remove.onclick = () => { if (!id || options.disabled()) return; library.remove(id); use(""); };
  function sync() {
    const entries = library.entries(), next = JSON.stringify(entries), disabled = options.disabled();
    if (next !== signature) { signature = next; select.replaceChildren(); const plain = document.createElement("option"); plain.value = ""; setUiText(plain, "Square Brush"); select.append(plain); entries.forEach((entry, i) => { const option = document.createElement("option"); option.value = entry.id; setUiText(option, uiMessage("Brush {0} · {1} × {2}", i + 1, entry.width, entry.height)); select.append(option); }); }
    select.value = id; select.disabled = disabled; capture.disabled = disabled || !options.area() || entries.length >= PIXEL_IMAGE_BRUSH_LIMITS.slots; remove.disabled = disabled || !id;
    for (const [key, input] of fields) { input.value = String(key === "x" ? anchorX : key === "y" ? anchorY : spacing); input.disabled = disabled || !id; const brush = entries.find(b => b.id === id); input.max = String(key === "spacing" ? 32 : brush ? (key === "x" ? brush.width : brush.height) - 1 : 0); }
  }
  return { element, sync, active: () => !!id, snapshot: () => id ? library.snapshot(id, anchorX, anchorY, spacing) : undefined,
    reset() { library.clear(); id = ""; anchorX = anchorY = 0; spacing = 1; signature = ""; element.open = false; },
    destroy() { library.clear(); id = ""; } };
}
