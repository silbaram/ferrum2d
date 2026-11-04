import type { createPixelSelection } from "./placementPixelSelection";
import type { PixelTransform } from "./placementPixelTransform";
import { registerUiRoot, setUiAttribute, setUiText, uiMessage } from "./placementLocale";

/** Local preview session; Apply is the only route that mutates the pixel source. */
export function createPixelTransformDialog(options: { selection: ReturnType<typeof createPixelSelection>; perform(run: () => unknown): void; report(error: unknown): void }) {
  const button = document.createElement("button"); button.type = "button"; button.dataset.pixelAction = "free-transform";
  setUiText(button, "Free Transform"); setUiAttribute(button, "title", "Rotate and scale selected pixels");
  let popup: HTMLDialogElement | undefined, canvas: HTMLCanvasElement | undefined;
  let session: ReturnType<typeof options.selection.beginFreeTransform> | undefined, blocked = true, disposed = false;
  function cancel() {
    session?.cancel(); session = undefined; popup?.close(); popup?.remove(); popup = undefined;
    if (canvas) canvas.width = canvas.height = 0; canvas = undefined;
  }
  function valid() { return !disposed && !blocked && button.isConnected && !button.closest("[hidden]") && !!session?.valid(); }
  button.onclick = () => {
    if (disposed || blocked || button.disabled || !button.isConnected || button.closest("[hidden]")) return;
    cancel();
    try { session = options.selection.beginFreeTransform(); } catch (error) { options.report(error); return; }
    const captured = session, dialog = document.createElement("dialog"); popup = dialog;
    dialog.className = "placement-pixel-dialog placement-pixel-transform-dialog"; dialog.dataset.pixelTransformDialog = "true";
    setUiAttribute(dialog, "aria-label", "Free Transform");
    const title = document.createElement("h3"), hint = document.createElement("p");
    setUiText(title, "Free Transform"); setUiText(hint, "Preview uses the original selection. Apply creates one undo step."); dialog.append(title, hint);
    const image = document.createElement("canvas"); canvas = image; image.dataset.pixelTransformPreview = "true"; dialog.append(image);
    function number(label: string, key: string, min: number, max: number, initial: number) {
      const row = document.createElement("label"), text = document.createElement("span"), input = document.createElement("input");
      setUiText(text, label); setUiAttribute(input, "aria-label", label); input.type = "number"; input.min = String(min); input.max = String(max); input.step = "any"; input.value = String(initial);
      input.dataset.pixelTransform = key; row.append(text, input); dialog.append(row); return input;
    }
    const angle = number("Angle (degrees)", "angle", -360, 360, 0), x = number("Width (%)", "x", 1, 1600, 100), y = number("Height (%)", "y", 1, 1600, 100);
    const lockRow = document.createElement("label"), lockText = document.createElement("span"), lock = document.createElement("input");
    setUiText(lockText, "Keep Aspect Ratio"); lock.type = "checkbox"; lock.checked = true; lock.dataset.pixelTransformLock = "true"; lockRow.append(lockText, lock); dialog.append(lockRow);
    const samplingRow = document.createElement("label"), samplingText = document.createElement("span"), sampling = document.createElement("select");
    setUiText(samplingText, "Transform Sampling"); setUiAttribute(sampling, "aria-label", "Transform Sampling"); sampling.dataset.pixelTransformSampling = "true";
    for (const [value, label] of [["nearest", "Nearest Pixel"], ["linear", "Smooth Interpolation"]]) {
      const option = document.createElement("option"); option.value = value; setUiText(option, label); sampling.append(option);
    }
    samplingRow.append(samplingText, sampling); dialog.append(samplingRow);
    const status = document.createElement("output"); status.setAttribute("role", "status"); status.dataset.pixelTransformStatus = "true"; dialog.append(status);
    const apply = document.createElement("button"), dismiss = document.createElement("button"); apply.type = dismiss.type = "button";
    setUiText(apply, "Apply"); setUiText(dismiss, "Cancel"); apply.dataset.pixelTransformApply = "true"; dismiss.dataset.pixelTransformCancel = "true"; dialog.append(apply, dismiss);
    function values(): PixelTransform {
      return { angle: angle.valueAsNumber, scaleX: x.valueAsNumber / 100, scaleY: y.valueAsNumber / 100,
        sampling: sampling.value === "nearest" ? "nearest" : "linear" };
    }
    function update() {
      if (session !== captured) return;
      if (!valid()) { cancel(); return; }
      try {
        const result = captured.preview(values()); image.width = result.canvasWidth; image.height = result.canvasHeight;
        const context = image.getContext("2d"); if (!context) throw Error("Canvas image processing unavailable");
        context.putImageData(new ImageData(new Uint8ClampedArray(result.pixels), image.width, image.height), 0, 0);
        setUiText(status, result.clipped ? "Outside frame pixels will be clipped" : uiMessage("Transformed selection: {0} × {1}", result.width, result.height));
        status.dataset.error = "false"; apply.disabled = false;
      } catch (error) { setUiText(status, error instanceof Error ? error.message : String(error)); status.dataset.error = "true"; apply.disabled = true; }
    }
    angle.oninput = sampling.onchange = update;
    x.oninput = () => { if (lock.checked) y.value = x.value; update(); };
    y.oninput = () => { if (lock.checked) x.value = y.value; update(); };
    lock.onchange = () => { if (lock.checked) y.value = x.value; update(); };
    apply.onclick = () => {
      if (!valid() || session !== captured || apply.disabled) return;
      const settings = values(); options.perform(() => {
        const changed = captured.apply(settings); cancel(); return changed;
      });
    };
    dismiss.onclick = () => { if (session === captured) cancel(); };
    dialog.addEventListener("cancel", event => { event.preventDefault(); if (session === captured) cancel(); });
    dialog.addEventListener("keydown", event => {
      event.stopPropagation(); if (!event.isComposing && event.code === "Enter" && event.target instanceof HTMLInputElement && event.target.type === "number") { event.preventDefault(); apply.click(); }
    });
    registerUiRoot(dialog); document.body.append(dialog); dialog.showModal(); update(); angle.focus();
  };
  return { button, cancel, sync(disabled: boolean) {
    blocked = disabled; button.disabled = disabled || !options.selection.bounds() || !options.selection.editable();
    if (popup && !valid()) cancel();
  }, destroy() { disposed = true; cancel(); } };
}
