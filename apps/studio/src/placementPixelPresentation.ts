import { pixelPerfectPointToViewport, resolveSceneDisplay, type FerrumRuntime, type PixelPerfectOptions } from "@ferrum2d/ferrum-web/core";
import type { SceneAuthoringDocumentSpec } from "@ferrum2d/ferrum-web/authoring";
import type { PlacementEditCamera } from "./placementViewportNavigation";
/** Cold preview state only. The renderer/runtime own pixels and native camera state. */
export function createPlacementPixelPresentation(options: {
    runtime: FerrumRuntime;
    canvas: HTMLCanvasElement;
    camera(): PlacementEditCamera;
    restore(camera: PlacementEditCamera): void;
}) {
    const editors = new Map<string, PlacementEditCamera>();
    const gameCamera = { x: options.runtime.engine.cameraX(), y: options.runtime.engine.cameraY(), zoom: 1 };
    let signature = "";
    function settings(mode: string | undefined, document: SceneAuthoringDocumentSpec): PixelPerfectOptions | undefined {
        const config = resolveSceneDisplay(document.display)?.pixelPerfect;
        return mode === "game" && !document.spatial && config ? config : undefined;
    }
    return {
        contains(point: {
            x: number;
            y: number;
        }) {
            const p = options.runtime.renderer.pixelPerfectPresentation?.();
            if (!p)
                return true;
            const rect = options.canvas.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0)
                return false;
            return pixelPerfectPointToViewport(p, point.x - rect.left, point.y - rect.top, rect.width, rect.height).inside;
        },
        capture(key: string, mode: string | undefined, document: SceneAuthoringDocumentSpec) {
            if (settings(mode, document) && !editors.has(key))
                editors.set(key, options.camera());
        },
        editingCamera: (key: string) => editors.get(key),
        forget: (key: string) => { editors.delete(key); },
        sync(key: string, mode: string | undefined, document: SceneAuthoringDocumentSpec, revision: number) {
            const config = settings(mode, document), next = JSON.stringify([key, mode, config, revision]);
            if (next === signature)
                return;
            const previous = options.runtime.renderer.pixelPerfectPresentation?.();
            let changed = false;
            if (config) {
                options.runtime.renderer.setPixelPerfect?.(config);
                options.restore(gameCamera);
                changed = true;
            }
            else if (previous) {
                options.runtime.renderer.setPixelPerfect?.(false);
                changed = true;
            }
            if (!config && editors.has(key)) {
                options.restore(editors.get(key)!);
                editors.delete(key);
                changed = true;
            }
            signature = next;
            return changed;
        },
    };
}
