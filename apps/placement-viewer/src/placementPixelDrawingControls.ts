import { setUiAttribute, setUiText } from "./placementLocale";
import { PIXEL_BRUSH_MAX, PIXEL_DRAW_DEFAULTS, type PixelDrawSettings, type PixelShape } from "./placementPixelDrawing";
import type { PixelTool } from "./placementPixelCanvas";

export function createPixelDrawingControls(options: { choose(shape: PixelShape): void; cancel(): void; changed(): void; report(error: unknown): void }) {
  let settings: PixelDrawSettings = { ...PIXEL_DRAW_DEFAULTS };
  const picker = document.createElement("select"); picker.dataset.pixelShapeTool = "true"; setUiAttribute(picker, "aria-label", "Shape Tool");
  for (const [value, text] of [["", "Shape Tool"], ["line", "Line (L)"], ["rectangle", "Rectangle (R)"], ["ellipse", "Ellipse (O)"]]) {
    const option = document.createElement("option"); option.value = value; setUiText(option, text); picker.append(option);
  }
  picker.onchange = () => {
    const value = picker.value;
    if (value === "line" || value === "rectangle" || value === "ellipse") options.choose(value);
  };
  const element = document.createElement("div"); element.className = "placement-pixel-drawing-options";
  element.setAttribute("role", "toolbar"); setUiAttribute(element, "aria-label", "Pixel Drawing Options"); element.hidden = true;
  const size = document.createElement("input"); size.type = "number"; size.min = "1"; size.max = String(PIXEL_BRUSH_MAX);
  size.value = "1"; size.dataset.pixelBrushSize = "true"; setUiAttribute(size, "aria-label", "Brush Size");
  const sizeLabel = document.createElement("label"); setUiText(sizeLabel, "Size"); sizeLabel.append(size); element.append(sizeLabel);
  size.onchange = () => {
    const next = size.valueAsNumber;
    if (!Number.isInteger(next) || next < 1 || next > PIXEL_BRUSH_MAX) {
      size.value = String(settings.size); options.report(Error("Brush size must be an integer from 1 to 32")); return;
    }
    options.cancel(); settings = { ...settings, size: next }; options.changed();
  };
  function flag(key: "mirrorX" | "mirrorY" | "filled", text: string) {
    const input = document.createElement("input"); input.type = "checkbox"; input.dataset.pixelDrawing = key; setUiAttribute(input, "aria-label", text);
    const label = document.createElement("label"); label.append(input, document.createTextNode(" ")); const caption = document.createElement("span"); setUiText(caption, text); label.append(caption); element.append(label);
    input.onchange = () => { const checked = input.checked; options.cancel(); settings = { ...settings, [key]: checked }; options.changed(); };
    return { input, label };
  }
  const mirrorX = flag("mirrorX", "Mirror Horizontal"), mirrorY = flag("mirrorY", "Mirror Vertical"), filled = flag("filled", "Filled Shape");
  const hint = document.createElement("span"), mask = document.createElement("span");
  setUiText(hint, "Release to draw · Shift for square/circle"); setUiText(mask, "Selection mask · Escape to clear"); element.append(hint, mask);
  return {
    element, picker, settings: () => ({ ...settings }),
    reset() { settings = { ...PIXEL_DRAW_DEFAULTS }; },
    sync(tool: PixelTool, disabled: boolean, selected: boolean) {
      const shape = tool === "line" || tool === "rectangle" || tool === "ellipse", paint = tool === "pencil" || tool === "eraser";
      element.hidden = !shape && !paint && !(tool === "fill" && selected);
      picker.value = shape ? tool : ""; picker.disabled = disabled;
      size.value = String(settings.size); size.disabled = disabled; sizeLabel.hidden = !paint && (!shape || (tool !== "line" && settings.filled));
      for (const [key, control] of [["mirrorX", mirrorX], ["mirrorY", mirrorY], ["filled", filled]] as const) {
        control.input.checked = settings[key]; control.input.disabled = disabled;
        control.label.hidden = key === "filled" ? tool !== "rectangle" && tool !== "ellipse" : !shape && !paint;
      }
      hint.hidden = !shape; mask.hidden = !selected;
    },
  };
}
