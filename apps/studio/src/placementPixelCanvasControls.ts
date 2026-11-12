import { PIXEL_CANVAS_ANCHORS, type createPixelEditor } from "./placementPixelDocument";
import { setUiAttribute, setUiText, uiMessage, registerUiRoot } from "./placementLocale";

export function createPixelCanvasControls(options: {
  editor(): ReturnType<typeof createPixelEditor>; key(): string; disabled(): boolean; cancelStroke(): void;
  changed(): void; report(error: unknown): void;
}) {
  const element = document.createElement("button"); element.type = "button"; element.dataset.pixelAction = "resize-canvas"; setUiText(element, "Canvas Size");
  let popup: HTMLDialogElement | undefined, canvas: HTMLCanvasElement | undefined, beforeCanvas: HTMLCanvasElement | undefined, captured = "", disposed = false;
  const stamp = () => { const e = options.editor(); return JSON.stringify([options.key(), e.revision(), e.selectedFrame(), e.selectedLayer(), e.selectedAtlasFrame()]); };
  function cancel() { for (const image of [canvas, beforeCanvas]) if (image) image.width = image.height = 0; popup?.close(); popup?.remove(); popup = canvas = beforeCanvas = undefined; }
  element.onclick = () => {
    if (options.disabled() || options.editor().atlas()) return;
    options.cancelStroke(); cancel(); const editor = options.editor(); captured = stamp();
    const dialog = document.createElement("dialog"); dialog.className = "placement-pixel-dialog placement-pixel-resize-dialog"; popup = dialog;
    const title = document.createElement("h3"), hint = document.createElement("p"); setUiText(title, "Canvas Size");
    setUiText(hint, "All frames and layers, including hidden/locked. Pixels are not resampled."); dialog.append(title, hint);
    const width = document.createElement("input"), height = document.createElement("input"), anchor = document.createElement("select");
    for (const [input, value, label, key] of [[width, editor.width, "Canvas Width", "width"], [height, editor.height, "Canvas Height", "height"]] as const) {
      input.type = "number"; input.min = "1"; input.max = "256"; input.value = String(value); input.dataset.pixelResize = key; setUiAttribute(input, "aria-label", label);
      const row = document.createElement("label"), text = document.createElement("span"); setUiText(text, label); row.append(text, input); dialog.append(row);
    }
    anchor.dataset.pixelResize = "anchor"; setUiAttribute(anchor, "aria-label", "Canvas Anchor");
    const names = ["Top Left", "Top Center", "Top Right", "Center Left", "Center", "Center Right", "Bottom Left", "Bottom Center", "Bottom Right"];
    PIXEL_CANVAS_ANCHORS.forEach((value, index) => { const option = document.createElement("option"); option.value = value; setUiText(option, names[index]); anchor.append(option); });
    anchor.value = "center"; const row = document.createElement("label"), caption = document.createElement("span"); setUiText(caption, "Canvas Anchor"); row.append(caption, anchor); dialog.append(row);
    const preview = document.createElement("canvas"); canvas = preview; preview.dataset.pixelResizePreview = "true"; setUiAttribute(preview, "aria-label", "Canvas Size Preview");
    const before = document.createElement("canvas"); beforeCanvas = before; before.dataset.pixelResizeBefore = "true"; setUiAttribute(before, "aria-label", "Pixels To Crop");
    const info = document.createElement("p"), warning = document.createElement("p"), error = document.createElement("output"); error.setAttribute("role", "status");
    setUiText(warning, "Pixels outside the new canvas will be removed."); dialog.append(before, preview, info, warning, error);
    const apply = document.createElement("button"), dismiss = document.createElement("button"); apply.type = dismiss.type = "button";
    apply.dataset.pixelResizeConfirm = "true"; setUiText(apply, "Resize"); setUiText(dismiss, "Cancel"); dismiss.onclick = cancel; dialog.append(apply, dismiss);
    function values() { const value = PIXEL_CANVAS_ANCHORS.find(value => value === anchor.value); if (!value) throw Error("Invalid canvas anchor"); return { width: width.valueAsNumber, height: height.valueAsNumber, anchor: value }; }
    function update() {
      if (disposed || options.editor() !== editor || captured !== stamp() || options.disabled()) { cancel(); return; }
      try {
        const value = values(), plan = editor.previewResize(value.width, value.height, value.anchor);
        preview.width = plan.width; preview.height = plan.height;
        const zoom = Math.min(4, 192 / Math.max(plan.width, plan.height));
        preview.style.width = plan.width * zoom + "px"; preview.style.height = plan.height * zoom + "px";
        const context = preview.getContext("2d"); if (!context) throw Error("Canvas image processing unavailable");
        context.putImageData(new ImageData(new Uint8ClampedArray(plan.pixels), plan.width, plan.height), 0, 0);
        // Show exactly what the crop removes, separately from the resulting canvas.
        before.hidden = !plan.cropped;
        if (plan.cropped) {
          before.width = editor.width; before.height = editor.height;
          const ratio = Math.min(4, 192 / Math.max(editor.width, editor.height));
          before.style.width = editor.width * ratio + "px"; before.style.height = editor.height * ratio + "px";
          const prior = before.getContext("2d"); if (!prior) throw Error("Canvas image processing unavailable");
          prior.putImageData(new ImageData(new Uint8ClampedArray(editor.bytes()), editor.width, editor.height), 0, 0);
          const removed = getComputedStyle(dialog).getPropertyValue("--red").trim();
          prior.fillStyle = removed; prior.globalAlpha = 0.55;
          const left = Math.max(0, -plan.offsetX), top = Math.max(0, -plan.offsetY);
          const right = Math.min(editor.width, plan.width - plan.offsetX), bottom = Math.min(editor.height, plan.height - plan.offsetY);
          prior.fillRect(0, 0, editor.width, top); prior.fillRect(0, bottom, editor.width, editor.height - bottom);
          prior.fillRect(0, top, left, bottom - top); prior.fillRect(right, top, editor.width - right, bottom - top);
          prior.globalAlpha = 1;
        } else before.width = before.height = 0;
        setUiText(info, uiMessage("{0} × {1} → {2} × {3} · Offset {4}, {5}", editor.width, editor.height, plan.width, plan.height, plan.offsetX, plan.offsetY));
        warning.hidden = !plan.cropped; error.textContent = ""; apply.disabled = plan.width === editor.width && plan.height === editor.height;
      } catch (value) { setUiText(error, value instanceof Error ? value.message : String(value)); apply.disabled = true; }
    }
    width.oninput = height.oninput = anchor.onchange = update;
    apply.onclick = () => {
      if (disposed || options.disabled() || options.editor() !== editor || captured !== stamp()) { cancel(); return; }
      try { const value = values(); editor.resizeCanvas(value.width, value.height, value.anchor); cancel(); options.changed(); }
      catch (error) { options.report(error); update(); }
    };
    dialog.addEventListener("cancel", event => { event.preventDefault(); cancel(); });
    registerUiRoot(dialog); document.body.append(dialog); dialog.showModal(); update(); dismiss.focus();
  };
  return {
    element, cancel,
    sync() { element.disabled = options.disabled() || !!options.editor().atlas(); if (popup && (options.disabled() || captured !== stamp())) cancel(); },
    destroy() { disposed = true; cancel(); },
  };
}
