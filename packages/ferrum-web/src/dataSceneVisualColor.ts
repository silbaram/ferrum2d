import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import { srgbToLinear, type ColorManagementMode } from "./colorManagement.js";

/** Hex authoring colors are sRGB; numeric commands use the renderer's working space. */
export function dataSceneVisualColor(value: string | undefined, path: string, mode: ColorManagementMode = "legacy"): [number, number, number, number] {
  if (value === undefined) return [1, 1, 1, 1];
  if (!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) {
    throw sceneCompositionDiagnosticError(path, "must be #RGB, #RGBA, #RRGGBB or #RRGGBBAA (sRGB)");
  }
  let hex = value.slice(1);
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join("");
  const channel = (offset: number): number => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  const rgb = [channel(0), channel(2), channel(4)].map((v) => mode === "linear-srgb" ? srgbToLinear(v) : v);
  return [rgb[0], rgb[1], rgb[2], hex.length === 8 ? channel(6) : 1];
}
