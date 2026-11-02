import { resolvePixelPerfectOptions, type PixelPerfectOptions } from "./pixelPerfect.js";
import { sceneCompositionDiagnosticError } from "./diagnostics.js";
/** TS presentation settings. These do not alter simulation or the Wasm command ABI. */
export interface SceneDisplaySpec {
    pixelPerfect?: PixelPerfectOptions | false;
}
export function resolveSceneDisplay(value: unknown, path = "sceneAuthoring.display"): SceneDisplaySpec | undefined {
    if (value === undefined)
        return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw sceneCompositionDiagnosticError(path, "must be an object");
    const object = value as Record<string, unknown>;
    if (Object.keys(object).some(key => key !== "pixelPerfect"))
        throw sceneCompositionDiagnosticError(path, "unknown display option");
    try {
        const settings = resolvePixelPerfectOptions(object.pixelPerfect);
        return object.pixelPerfect === undefined ? {} : { pixelPerfect: settings ?? false };
    }
    catch (error) {
        throw sceneCompositionDiagnosticError(`${path}.pixelPerfect`, error instanceof Error ? error.message : String(error));
    }
}
