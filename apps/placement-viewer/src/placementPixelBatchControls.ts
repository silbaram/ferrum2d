import { setUiAttribute, setUiText, registerUiRoot, uiMessage } from "./placementLocale";
import type { createPixelEditor, PixelBatchTransform, PixelRegion } from "./placementPixelDocument";

/** UI-only frame range and readonly preview. The document owns the atomic multi-cel edit. */
export function createPixelBatchControls(options: {
  editor(): ReturnType<typeof createPixelEditor>; area(): PixelRegion | undefined; selectionKey(): number; key(): string;
  retain(area: PixelRegion): void; disabled(): boolean; cancelStroke(): void; changed(): void; report(error: unknown): void;
}) {
  const element = document.createElement("details"), summary = document.createElement("summary"), panel = document.createElement("div");
  element.className = "placement-pixel-batch-menu"; setUiText(summary, "Frame Range"); element.append(summary, panel);
  const list = document.createElement("div"); list.className = "placement-pixel-batch-list"; setUiAttribute(list, "aria-label", "Target Frames");
  const all = document.createElement("button"), current = document.createElement("button"), review = document.createElement("button");
  for (const button of [all, current, review]) button.type = "button";
  setUiText(all, "All Frames"); setUiText(current, "Current Frame"); setUiText(review, "Review Changes"); review.dataset.pixelBatchReview = "true";
  all.dataset.pixelBatchRange = "all"; current.dataset.pixelBatchRange = "current";
  const operation = document.createElement("select"); operation.dataset.pixelBatchOperation = "true"; setUiAttribute(operation, "aria-label", "Frame Operation");
  for (const [value, label] of [["move", "Move"], ["flip-x", "Flip Horizontal"], ["flip-y", "Flip Vertical"]]) { const item = document.createElement("option"); item.value = value; setUiText(item, label); operation.append(item); }
  const fields: HTMLInputElement[] = [];
  for (const [key, label] of [["x", "Offset X"], ["y", "Offset Y"]]) {
    const row = document.createElement("label"), text = document.createElement("span"), input = document.createElement("input");
    input.type = "number"; input.min = "-1048576"; input.max = "1048576"; input.step = "1"; input.value = "0"; input.dataset.pixelBatchOffset = key;
    setUiText(text, label); setUiAttribute(input, "aria-label", label); row.append(text, input); panel.append(row); fields.push(input);
  }
  const hint = document.createElement("p"); setUiText(hint, "Selected layer and pixel mask · One Undo");
  panel.prepend(all, current, list, operation); panel.append(review, hint);
  let selected = new Set<string>(), previous: ReturnType<typeof createPixelEditor> | undefined, signature = "", disposed = false;
  let popup: HTMLDialogElement | undefined, preview: HTMLCanvasElement | undefined, captured = "";
  const rows = new Map<string, HTMLInputElement>();
  const stamp = () => { const e = options.editor(); return JSON.stringify([options.key(), e.revision(), e.selectedFrame(), e.selectedLayer(), e.selectedAtlasFrame(), options.selectionKey()]); };
  function cancel() { if (preview) preview.width = preview.height = 0; popup?.close(); popup?.remove(); popup = preview = undefined; }
  function choose(ids: string[]) { if (options.disabled()) return; selected = new Set(ids); sync(); }
  all.onclick = () => choose(options.editor().frames().map(frame => frame.id)); current.onclick = () => choose([options.editor().selectedFrame()]);
  operation.onchange = () => sync();
  function values(): PixelBatchTransform {
    if (operation.value === "flip-x" || operation.value === "flip-y") return { kind: operation.value };
    const [dx, dy] = fields.map(field => field.valueAsNumber);
    if (operation.value !== "move" || ![dx, dy].every(n => Number.isSafeInteger(n) && Math.abs(n) <= 1_048_576)) throw Error("Invalid batch transform");
    return { kind: "move", dx, dy };
  }
  review.onclick = () => {
    if (disposed || options.disabled() || options.editor().atlas()) return;
    options.cancelStroke(); element.open = false; cancel();
    const editor = options.editor(), ids = [...selected], layer = editor.selectedLayer(), area = options.area();
    let transform: PixelBatchTransform;
    try { transform = values(); editor.previewBatchTransform(ids, layer, area, transform); } catch (error) { options.report(error); return; }
    captured = stamp();
    const dialog = document.createElement("dialog"), title = document.createElement("h3"), info = document.createElement("p");
    dialog.className = "placement-pixel-dialog"; dialog.dataset.pixelBatchDialog = "true"; setUiAttribute(dialog, "aria-label", "Frame Range"); popup = dialog;
    setUiText(title, "Frame Range"); info.textContent = editor.layers().find(entry => entry.id === layer)!.name + " · " + layer;
    const frame = document.createElement("select"); frame.dataset.pixelBatchPreviewFrame = "true"; setUiAttribute(frame, "aria-label", "Preview Frame");
    for (const id of ids) { const item = document.createElement("option"); item.value = item.textContent = id; frame.append(item); }
    frame.value = ids.includes(editor.selectedFrame()) ? editor.selectedFrame() : ids[0];
    const canvas = document.createElement("canvas"); preview = canvas; canvas.dataset.pixelBatchPreview = "true"; setUiAttribute(canvas, "aria-label", "Frame Range Preview");
    const status = document.createElement("output"), warning = document.createElement("p"), error = document.createElement("output"); status.dataset.pixelBatchStatus = "true"; status.setAttribute("role", "status"); error.setAttribute("role", "status");
    setUiText(warning, "Outside frame pixels will be clipped");
    const apply = document.createElement("button"), dismiss = document.createElement("button"); apply.type = dismiss.type = "button"; apply.dataset.pixelBatchConfirm = "true"; setUiText(apply, "Confirm"); setUiText(dismiss, "Cancel");
    const valid = () => !disposed && editor === options.editor() && !options.disabled() && captured === stamp();
    function update() {
      if (!valid()) { cancel(); return; }
      try {
        const plan = editor.previewBatchTransform(ids, layer, area, transform, frame.value);
        canvas.width = editor.width; canvas.height = editor.height; const zoom = Math.min(8, 192 / Math.max(editor.width, editor.height)); canvas.style.width = editor.width * zoom + "px"; canvas.style.height = editor.height * zoom + "px";
        const context = canvas.getContext("2d"); if (!context) throw Error("Canvas image processing unavailable"); context.putImageData(new ImageData(new Uint8ClampedArray(plan.pixels), editor.width, editor.height), 0, 0);
        setUiText(status, uiMessage("Targets {0} · Excluded {1} · Changed {2}", plan.targetIds.length, plan.skippedIds.length, plan.changedFrames));
        status.dataset.targets = String(plan.targetIds.length); status.dataset.excluded = String(plan.skippedIds.length); status.dataset.changed = String(plan.changedFrames);
        warning.hidden = !plan.clipped; apply.disabled = plan.changedFrames === 0; error.textContent = "";
      } catch (value) { apply.disabled = true; setUiText(error, value instanceof Error ? value.message : String(value)); }
    }
    frame.onchange = update;
    apply.onclick = () => {
      if (!valid()) { cancel(); return; }
      try { const plan = editor.previewBatchTransform(ids, layer, area, transform); editor.batchTransform(ids, layer, area, transform); if (area) options.retain(plan.targetIds.includes(editor.selectedFrame()) ? plan.area : area); cancel(); options.changed(); }
      catch (error) { cancel(); options.report(error); }
    };
    dismiss.onclick = cancel; dialog.addEventListener("cancel", event => { event.preventDefault(); cancel(); }); dialog.addEventListener("keydown", event => event.stopPropagation());
    dialog.append(title, info, frame, canvas, status, warning, error, apply, dismiss); registerUiRoot(dialog); document.body.append(dialog); dialog.showModal(); update(); dismiss.focus();
  };
  function sync() {
    const editor = options.editor(), frames = editor.frames(), disabled = options.disabled() || !!editor.atlas();
    if (previous !== editor) { cancel(); previous = editor; selected = new Set([editor.selectedFrame()]); signature = ""; operation.value = "move"; fields.forEach(input => input.value = "0"); element.open = false; }
    for (const id of selected) if (!frames.some(frame => frame.id === id)) selected.delete(id);
    const next = JSON.stringify(frames);
    if (signature !== next) { signature = next; list.replaceChildren(); rows.clear(); frames.forEach((frame, i) => { const row = document.createElement("label"), input = document.createElement("input"), label = document.createElement("span"); input.type = "checkbox"; input.dataset.pixelBatchFrame = frame.id; setUiText(label, uiMessage("{0} ({1})", i + 1, frame.id)); row.append(input, label); list.append(row); rows.set(frame.id, input); input.onchange = () => { if (options.disabled()) { sync(); return; } if (input.checked) selected.add(frame.id); else selected.delete(frame.id); sync(); }; }); }
    for (const [id, input] of rows) { input.checked = selected.has(id); input.disabled = disabled; }
    all.disabled = current.disabled = operation.disabled = disabled; review.disabled = disabled || selected.size === 0;
    fields.forEach(input => input.disabled = disabled || operation.value !== "move"); summary.setAttribute("aria-disabled", String(disabled));
    if (popup && (disabled || captured !== stamp())) cancel();
  }
  element.addEventListener("keydown", event => { if (event.code === "Escape" && element.open) { event.preventDefault(); event.stopPropagation(); element.open = false; summary.focus(); } });
  // This panel participates in layout. Closing on canvas pointerdown would move the image before sampling it.
  // Keep it open like an inspector until its summary, Escape, or Review explicitly closes it.
  function clear() { cancel(); rows.clear(); list.replaceChildren(); selected.clear(); previous = undefined; signature = ""; element.open = false; }
  return { element, cancel, sync, clear, destroy() { disposed = true; clear(); } };
}
