import { PIXEL_REPEAT_DEFAULTS, type PixelRepeat } from "./placementPixelDrawing";
import { setUiText, setUiAttribute } from "./placementLocale";

export function createPixelRepeatControls(options: { atlas(): boolean; disabled(): boolean; cancelStroke(): void; changed(): void }) {
  const element = document.createElement("details"), summary = document.createElement("summary"), panel = document.createElement("div"); element.className = "placement-pixel-repeat-menu"; setUiText(summary, "View"); element.append(summary, panel);
  let value: PixelRepeat = { ...PIXEL_REPEAT_DEFAULTS };
  const checks = new Map<"x" | "y", HTMLInputElement>();
  for (const [axis, label] of [["x", "Repeat Horizontal"], ["y", "Repeat Vertical"]] as const) {
    const row = document.createElement("label"), input = document.createElement("input"), text = document.createElement("span"); input.type = "checkbox"; input.dataset.pixelRepeat = axis; setUiAttribute(input, "aria-label", label); setUiText(text, label); row.append(input, text); panel.append(row); checks.set(axis, input);
    input.onchange = () => { const checked = input.checked; if (options.atlas() || options.disabled()) { sync(); return; } options.cancelStroke(); value = { ...value, [axis]: checked }; options.changed(); };
  }
  const hint = document.createElement("span"); panel.append(hint);
  function sync() {
    const atlas = options.atlas(); for (const [axis, input] of checks) { input.checked = !atlas && value[axis]; input.disabled = atlas || options.disabled(); }
    setUiText(hint, atlas ? "Repeat editing is unavailable for fixed atlases" : "3 × 3 preview · Start in the center tile · Outside preview is clipped");
  }
  return { element, sync, settings: () => options.atlas() ? { ...PIXEL_REPEAT_DEFAULTS } : { ...value }, reset() { value = { ...PIXEL_REPEAT_DEFAULTS }; element.open = false; } };
}
