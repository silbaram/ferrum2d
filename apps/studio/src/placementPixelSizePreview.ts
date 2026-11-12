import type { createPixelEditor } from "./placementPixelDocument";
import { setUiAttribute, setUiText } from "./placementLocale";

/** Source-pixel preview: redraws on editor/frame-clock changes, owns no playback clock. */
export function createPixelSizePreview(options: { editor(): ReturnType<typeof createPixelEditor>; pixels(): Uint8Array; active(): boolean }) {
  const element = document.createElement("details"), summary = document.createElement("summary"), panel = document.createElement("div");
  element.className = "placement-pixel-size-preview"; element.dataset.pixelSizePreview = "true"; setUiText(summary, "Actual Size");
  const scale = document.createElement("select"); scale.dataset.pixelPreviewScale = "true"; setUiAttribute(scale, "aria-label", "Source Preview Scale");
  for (const n of [1, 2]) { const option = document.createElement("option"); option.value = String(n); option.textContent = n + "×"; scale.append(option); }
  const hint = document.createElement("p"); setUiText(hint, "Source CSS pixels · Follows frame/tag playback");
  const scroll = document.createElement("div"); scroll.className = "placement-pixel-size-scroll";
  panel.append(scale, hint, scroll); element.append(summary, panel);
  let canvas: HTMLCanvasElement | undefined, frame = 0, disposed = false, focused = true;
  function drop() { cancelAnimationFrame(frame); frame = 0; if (canvas) { canvas.width = canvas.height = 0; canvas.remove(); canvas = undefined; } }
  function visible() { return !disposed && element.open && options.active() && focused && document.visibilityState !== "hidden"; }
  function draw() {
    frame = 0; if (!visible()) { drop(); return; }
    canvas ??= document.createElement("canvas"); canvas.dataset.pixelSizeCanvas = "true"; setUiAttribute(canvas, "aria-label", "Actual Size Pixels");
    if (!canvas.isConnected) scroll.append(canvas);
    const editor = options.editor(), multiplier = scale.value === "2" ? 2 : 1;
    canvas.width = editor.width; canvas.height = editor.height;
    canvas.style.width = editor.width * multiplier + "px"; canvas.style.height = editor.height * multiplier + "px";
    canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(options.pixels()), editor.width, editor.height), 0, 0);
  }
  function refresh() { if (!visible()) { drop(); return; } if (!frame) frame = requestAnimationFrame(draw); }
  const blur = () => { focused = false; drop(); }, focus = () => { focused = true; refresh(); };
  const visibility = () => document.visibilityState === "hidden" ? drop() : refresh();
  window.addEventListener("blur", blur); window.addEventListener("focus", focus); document.addEventListener("visibilitychange", visibility);
  element.addEventListener("toggle", refresh); scale.onchange = refresh;
  element.addEventListener("wheel", event => event.stopPropagation(), { passive: true });
  element.addEventListener("keydown", event => { if (event.code === "Escape" && element.open) { event.preventDefault(); event.stopPropagation(); element.open = false; drop(); summary.focus(); } });
  return {
    element, refresh, sync: refresh, suspend: drop,
    reset() { element.open = false; scale.value = "1"; focused = document.hasFocus(); drop(); },
    destroy() { disposed = true; drop(); window.removeEventListener("blur", blur); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visibility); },
  };
}
