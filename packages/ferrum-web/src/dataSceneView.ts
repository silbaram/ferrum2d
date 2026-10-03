import type { FerrumEngine, FrameState } from "./engineTypes.js";
import type { DataSceneCameraOptions } from "./dataSceneCamera.js";
import type { LightingScene2D } from "./lightingTypes.js";
import {
  createScenePlacementViewport, screenToSceneWorld, worldToSceneScreen,
  type ScenePlacementViewport, type ScenePlacementPoint,
} from "./scenePlacementViewport.js";

export interface DataSceneViewRenderer {
  viewportSize(): { width: number; height: number };
  setViewportZoom?(zoom: number): void;
}
export interface DataSceneViewOptions extends DataSceneCameraOptions { zoom?: number; }

/** CSS/device sizes plus the actual Rust camera center; logical units are world units. */
export type DataSceneViewSnapshot = ScenePlacementViewport;

export interface DataSceneView {
  setCamera(options: DataSceneCameraOptions): void;
  setZoom(zoom: number): void;
  snapshot(frame?: Pick<FrameState, "cameraX" | "cameraY">): DataSceneViewSnapshot;
  screenToWorld(point: ScenePlacementPoint, snapshot?: DataSceneViewSnapshot): ScenePlacementPoint;
  worldToScreen(point: ScenePlacementPoint, snapshot?: DataSceneViewSnapshot): ScenePlacementPoint;
  /** Client coordinates (e.g. PointerEvent.clientX/Y), accounting for canvas rect offset/scale. */
  pointerToWorld(client: ScenePlacementPoint, snapshot?: DataSceneViewSnapshot): ScenePlacementPoint;
  /** Converts world lights/occluders to logical render coordinates once per frame. */
  lighting(scene: LightingScene2D, snapshot?: DataSceneViewSnapshot): LightingScene2D;
}

/** Connects an active Data Scene to a renderer; call again/rebind follow after scene reapply. */
export function createDataSceneView(
  engine: FerrumEngine, renderer: DataSceneViewRenderer, canvas: HTMLCanvasElement,
  options: DataSceneViewOptions = {},
): DataSceneView {
  if (renderer.setViewportZoom === undefined) throw new Error("Data Scene view requires renderer.setViewportZoom().");
  let zoom = validateZoom(options.zoom ?? 1);
  const setCamera = (camera: DataSceneCameraOptions): void => {
    if (!engine.setDataSceneCamera(camera)) throw new Error("Data Scene camera requires an active Data Scene and a current follow handle.");
  };
  const setZoom = (value: number): void => {
    const next = validateZoom(value);
    renderer.setViewportZoom!(next);
    zoom = next;
    const viewport = renderer.viewportSize();
    engine.setViewportSize(viewport.width, viewport.height);
  };
  // Bounds must clamp against the zoomed viewport, not the previous logical size.
  setZoom(zoom);
  setCamera(options);
  const snapshot = (frame?: Pick<FrameState, "cameraX" | "cameraY">): DataSceneViewSnapshot => createScenePlacementViewport({
    cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight,
    backbufferWidth: canvas.width, backbufferHeight: canvas.height,
    dpr: canvas.width / canvas.clientWidth, zoom,
    cameraX: frame?.cameraX ?? engine.cameraX(), cameraY: frame?.cameraY ?? engine.cameraY(),
  });
  return {
    setCamera, setZoom, snapshot,
    screenToWorld: (point, view = snapshot()) => screenToSceneWorld(view, point),
    worldToScreen: (point, view = snapshot()) => worldToSceneScreen(view, point),
    pointerToWorld: (client, view = snapshot()) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) throw new Error("Data Scene pointer conversion requires a visible canvas.");
      return screenToSceneWorld(view, { x: (client.x - rect.left) * view.cssWidth / rect.width, y: (client.y - rect.top) * view.cssHeight / rect.height });
    },
    lighting: (scene, view = snapshot()) => ({ ...scene,
      pointLights: scene.pointLights?.map((light) => ({ ...light, x: light.x - view.worldMinX, y: light.y - view.worldMinY })),
      tileOccluders: scene.tileOccluders?.map((rect) => ({ ...rect, x: rect.x - view.worldMinX, y: rect.y - view.worldMinY })),
    }),
  };
}

function validateZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom < 0.0001 || zoom > 10000) throw new Error("Data Scene zoom must be in [0.0001, 10000].");
  return zoom;
}
