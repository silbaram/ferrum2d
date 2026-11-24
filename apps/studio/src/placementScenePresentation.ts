import { pixelPerfectPointToViewport, resolveSceneDisplay, type FerrumRuntime, type SceneFitSpec } from "@ferrum2d/ferrum-web/core";
import type { SceneAuthoringDocumentSpec } from "@ferrum2d/ferrum-web/authoring";
import type { PlacementEditCamera } from "./placementViewportNavigation";
/** Cold preview state only. The renderer/runtime own pixels and native camera state. */
export function createPlacementScenePresentation(options: {
    runtime: FerrumRuntime;
    canvas: HTMLCanvasElement;
    camera(): PlacementEditCamera;
    restore(camera: PlacementEditCamera): void;
    applyFit(camera: { x: number; y: number; zoom?: number }): void;
    setZoom(zoom: number): void;
}) {
    const editors = new Map<string, PlacementEditCamera>();
    const gameCamera = { x: options.runtime.engine.cameraX(), y: options.runtime.engine.cameraY(), zoom: 1 };
    let signature = "";
    let activeFit: SceneFitSpec | undefined;
    function settings(mode: string | undefined, document: SceneAuthoringDocumentSpec) {
        return mode === "game" && !document.spatial ? resolveSceneDisplay(document.display) : undefined;
    }
    function fitZoom(fit: SceneFitSpec) {
        const { clientWidth, clientHeight } = options.canvas;
        if (clientWidth <= 0 || clientHeight <= 0) return undefined;
        return Math.max(0.0001, Math.min(10000, clientWidth / fit.width, clientHeight / fit.height));
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
            const display = settings(mode, document);
            if ((display?.pixelPerfect || display?.fit) && !editors.has(key))
                editors.set(key, options.camera());
        },
        resize() {
            if (!activeFit) return;
            const zoom = fitZoom(activeFit);
            if (zoom !== undefined) options.setZoom(zoom);
        },
        editingCamera: (key: string) => editors.get(key),
        forget: (key: string) => { editors.delete(key); },
        sync(key: string, mode: string | undefined, document: SceneAuthoringDocumentSpec, revision: number) {
            const display = settings(mode, document);
            const pixelPerfect = display?.pixelPerfect || undefined;
            const fit = display?.fit || undefined;
            const next = JSON.stringify([key, mode, pixelPerfect, fit, revision]);
            if (next === signature)
                return;
            const previous = options.runtime.renderer.pixelPerfectPresentation?.();
            let changed = false;
            if (pixelPerfect) {
                options.runtime.renderer.setPixelPerfect?.(pixelPerfect);
                options.restore(gameCamera);
                changed = true;
            }
            else if (previous) {
                options.runtime.renderer.setPixelPerfect?.(false);
                changed = true;
            }
            if (fit) {
                options.applyFit({
                    x: (fit.x ?? 0) + fit.width / 2,
                    y: (fit.y ?? 0) + fit.height / 2,
                    zoom: fitZoom(fit),
                });
                changed = true;
            }
            else if (!pixelPerfect && editors.has(key)) {
                options.restore(editors.get(key)!);
                editors.delete(key);
                changed = true;
            }
            activeFit = fit;
            signature = next;
            return changed;
        },
    };
}
