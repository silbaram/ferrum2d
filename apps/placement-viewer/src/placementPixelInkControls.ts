import { setUiAttribute, setUiText } from "./placementLocale";
import { pixelColor, pixelHex } from "./placementPixelDocument";
import { PIXEL_INK_DEFAULTS, pixelInkSettings, type PixelInkSettings } from "./placementPixelInk";
import type { PixelTool } from "./placementPixelCanvas";

export function createPixelInkControls(options: { cancel(): void; changed(): void; report(error: unknown): void }) {
  let settings = pixelInkSettings(PIXEL_INK_DEFAULTS);
  const element = document.createElement("div"); element.className = "placement-pixel-drawing-options";
  element.dataset.pixelInkOptions = "true"; element.hidden = true;
  const color = document.createElement("input"), alpha = document.createElement("input"), density = document.createElement("input"), mode = document.createElement("select");
  color.type = "color"; color.dataset.pixelSecondary = "true";
  alpha.type = density.type = "number"; alpha.min = density.min = "0"; alpha.max = "255"; density.max = "16";
  alpha.dataset.pixelSecondaryAlpha = "true"; density.dataset.pixelDitherDensity = "true"; mode.dataset.pixelGradientMode = "true";
  function label(control: HTMLElement, title: string) {
    const row = document.createElement("label"); setUiText(row, title); setUiAttribute(control, "aria-label", title); row.append(control); element.append(row); return row;
  }
  label(color, "Second Color"); label(alpha, "Second Alpha");
  const densityLabel = label(density, "Dither Ratio (0–16)"), modeLabel = label(mode, "Gradient Mode");
  for (const [value, text] of [["colors", "Two Colors"], ["dither", "Dither"], ["palette", "Palette Steps"]]) {
    const option = document.createElement("option"); option.value = value; setUiText(option, text); mode.append(option);
  }
  const hint = document.createElement("span"); setUiText(hint, "Drag to preview · Release to apply · Escape to cancel"); element.append(hint);
  function values() { color.value = pixelHex(settings.secondary).slice(0, 7); alpha.value = String(settings.secondary[3]); density.value = String(settings.density); mode.value = settings.gradient; }
  function edit() {
    try {
      const a = alpha.valueAsNumber;
      if (!Number.isInteger(a) || a < 0 || a > 255) throw Error("Invalid color tool settings");
      const next = pixelInkSettings({ secondary: pixelColor(color.value + a.toString(16).padStart(2, "0")), density: density.valueAsNumber, gradient: mode.value as PixelInkSettings["gradient"] });
      options.cancel(); settings = next; options.changed();
    } catch (error) { values(); options.report(error); }
  }
  for (const control of [color, alpha, density, mode]) control.onchange = edit;
  return { element, snapshot: () => pixelInkSettings(settings), reset() { settings = pixelInkSettings(PIXEL_INK_DEFAULTS); values(); },
    sync(tool: PixelTool, disabled: boolean) {
      element.hidden = tool !== "dither" && tool !== "gradient"; values();
      for (const control of [color, alpha, density, mode]) control.disabled = disabled;
      densityLabel.hidden = tool !== "dither"; modeLabel.hidden = hint.hidden = tool !== "gradient";
    },
  };
}
