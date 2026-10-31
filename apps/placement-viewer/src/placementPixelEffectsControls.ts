import { setUiAttribute, setUiText, registerUiRoot, uiMessage } from "./placementLocale";
import type { createPixelEditor, PixelColor, PixelRegion } from "./placementPixelDocument";
import { pixelOutlineMask } from "./placementPixelOutline";

export function createPixelEffectsControls(options: {
  editor(): ReturnType<typeof createPixelEditor>; color(): PixelColor; area(): PixelRegion | undefined; selectionKey(): number; key(): string;
  retain(area: PixelRegion): void; disabled(): boolean; cancelStroke(): void; changed(): void; report(error: unknown): void;
}) {
  const element = document.createElement("details"), summary = document.createElement("summary"), open = document.createElement("button");
  element.className = "placement-pixel-effects-menu"; setUiText(summary, "Effects"); open.type = "button"; open.dataset.pixelAction = "outline"; setUiText(open, "Outline"); element.append(summary, open);
  let popup: HTMLDialogElement | undefined, preview: HTMLCanvasElement | undefined, captured = "", disposed = false;
  const stamp = () => { const e = options.editor(); return JSON.stringify([options.key(), e.revision(), e.selectedFrame(), e.selectedLayer(), e.selectedAtlasFrame(), options.selectionKey(), options.color()]); };
  function cancel() { if (preview) preview.width = preview.height = 0; popup?.close(); popup?.remove(); popup = preview = undefined; }
  open.onclick = () => {
    if (options.disabled()) return;
    options.cancelStroke(); element.open = false; cancel(); const editor = options.editor(), area = options.area(), region = editor.region(), color: PixelColor = [...options.color()]; captured = stamp();
    const dialog = document.createElement("dialog"); dialog.className = "placement-pixel-dialog"; dialog.dataset.pixelOutlineDialog = "true"; popup = dialog;
    const title = document.createElement("h3"), hint = document.createElement("p"); setUiText(title, "Outline"); setUiText(hint, area ? "Current Cel · Selection Mask" : "Current Cel"); dialog.append(title, hint);
    const place = document.createElement("select"), neighbors = document.createElement("select"); place.dataset.pixelOutlinePlace = "true"; neighbors.dataset.pixelOutlineNeighbors = "true";
    setUiAttribute(place, "aria-label", "Outline Placement"); setUiAttribute(neighbors, "aria-label", "Outline Neighbors");
    for (const [value, text] of [["outside", "Outside"], ["inside", "Inside"]]) { const option = document.createElement("option"); option.value = value; setUiText(option, text); place.append(option); }
    for (const n of [4, 8]) { const option = document.createElement("option"); option.value = String(n); option.textContent = String(n); neighbors.append(option); }
    const canvas = document.createElement("canvas"); canvas.dataset.pixelOutlinePreview = "true"; preview = canvas;
    const status = document.createElement("output"), warning = document.createElement("p"); status.setAttribute("role", "status"); setUiText(warning, "Outside frame pixels will be clipped");
    const apply = document.createElement("button"), dismiss = document.createElement("button"); apply.type = dismiss.type = "button"; setUiText(apply, "Confirm"); setUiText(dismiss, "Cancel"); apply.dataset.pixelOutlineConfirm = "true";
    let result: ReturnType<typeof pixelOutlineMask> | undefined;
    function update() {
      if (disposed || options.disabled() || editor !== options.editor() || stamp() !== captured) { cancel(); return; }
      try {
        const value = place.value; if (value !== "inside" && value !== "outside") throw Error("Invalid outline settings");
        result = pixelOutlineMask(editor.layerBytes(editor.selectedLayer()), editor.width, editor.height, region, area, value, neighbors.value === "8");
        const full = editor.previewPaint(result.mask, color), pixels = new Uint8ClampedArray(region.width * region.height * 4);
        for (let y = 0; y < region.height; y++) pixels.set(full.subarray(((y + region.y) * editor.width + region.x) * 4, ((y + region.y) * editor.width + region.x + region.width) * 4), y * region.width * 4);
        canvas.width = region.width; canvas.height = region.height; const zoom = Math.min(8, 192 / Math.max(region.width, region.height)); canvas.style.width = region.width * zoom + "px"; canvas.style.height = region.height * zoom + "px";
        canvas.getContext("2d")?.putImageData(new ImageData(pixels, region.width, region.height), 0, 0); warning.hidden = !result.clipped; apply.disabled = !result.count; setUiText(status, uiMessage("Outline {0} pixels", result.count));
      } catch (error) { apply.disabled = true; options.report(error); }
    }
    place.onchange = neighbors.onchange = update;
    apply.onclick = () => { if (disposed || options.disabled() || editor !== options.editor() || stamp() !== captured || !result) { cancel(); return; } try { editor.editPaint(result.mask, color); if (area) options.retain(area); cancel(); options.changed(); } catch (error) { cancel(); options.report(error); } };
    dismiss.onclick = cancel; dialog.addEventListener("cancel", event => { event.preventDefault(); cancel(); }); dialog.addEventListener("keydown", event => event.stopPropagation());
    dialog.append(place, neighbors, canvas, status, warning, apply, dismiss); registerUiRoot(dialog); document.body.append(dialog); dialog.showModal(); update(); dismiss.focus();
  };
  return { element, cancel, sync() { open.disabled = options.disabled(); if (popup && (options.disabled() || captured !== stamp())) cancel(); }, destroy() { disposed = true; cancel(); } };
}
