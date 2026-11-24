import { resolvePixelPerfectOptions, type PixelPerfectOptions } from "./pixelPerfect.js";
import { sceneCompositionDiagnosticError } from "./diagnostics.js";

/** World rectangle to keep visible in a flat Data Scene. */
export interface SceneFitSpec {
  /** World width, greater than zero and at most 100,000. */
  width: number;
  /** World height, greater than zero and at most 100,000. */
  height: number;
  /** Left edge in world units. Defaults to zero. */
  x?: number;
  /** Top edge in world units. Defaults to zero. */
  y?: number;
}

/** TS presentation settings. These do not alter simulation or the Wasm command ABI. */
export interface SceneDisplaySpec {
  pixelPerfect?: PixelPerfectOptions | false;
  /** Scale the world rectangle to the canvas, or override the runtime default with false. */
  fit?: SceneFitSpec | false;
}

export function resolveSceneDisplay(value: unknown, path = "sceneAuthoring.display"): SceneDisplaySpec | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw sceneCompositionDiagnosticError(path, "must be an object");
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some(key => key !== "pixelPerfect" && key !== "fit"))
    throw sceneCompositionDiagnosticError(path, "unknown display option");
  let pixelPerfect: PixelPerfectOptions | undefined;
  try {
    pixelPerfect = resolvePixelPerfectOptions(object.pixelPerfect);
  } catch (error) {
    throw sceneCompositionDiagnosticError(`${path}.pixelPerfect`, error instanceof Error ? error.message : String(error));
  }
  const fit = resolveSceneFit(object.fit, `${path}.fit`);
  if (fit && pixelPerfect) throw sceneCompositionDiagnosticError(`${path}.fit`, "cannot be combined with pixelPerfect");
  return {
    ...(object.pixelPerfect === undefined ? {} : { pixelPerfect: pixelPerfect ?? false }),
    ...(fit === undefined ? {} : { fit }),
  };
}

/** Shared validation for the authored value and the runtime default. */
export function resolveSceneFit(value: unknown, path: string): SceneFitSpec | false | undefined {
  if (value === undefined || value === false) return value;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw sceneCompositionDiagnosticError(path, "must be an object or false");
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) {
    if (key !== "width" && key !== "height" && key !== "x" && key !== "y")
      throw sceneCompositionDiagnosticError(`${path}.${key}`, "unknown fit option");
  }
  const dimension = (key: "width" | "height") => {
    const size = object[key];
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0 || size > 100_000)
      throw sceneCompositionDiagnosticError(`${path}.${key}`, "must be greater than zero and at most 100000");
    return size;
  };
  const offset = (key: "x" | "y") => {
    const coordinate = object[key] === undefined ? 0 : object[key];
    if (typeof coordinate !== "number" || !Number.isFinite(coordinate))
      throw sceneCompositionDiagnosticError(`${path}.${key}`, "must be a finite number");
    return coordinate;
  };
  return { width: dimension("width"), height: dimension("height"), x: offset("x"), y: offset("y") };
}
