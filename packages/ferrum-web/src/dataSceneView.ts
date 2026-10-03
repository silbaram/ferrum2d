import { resolveDirectionalLight2D } from "./dataSceneSun.js";
import type { DirectionalLight2D } from "./lightingTypes.js";
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
  setGroundYScale?(scale: number): void;
}
export interface DataSceneViewOptions extends DataSceneCameraOptions { zoom?: number; groundYScale?: number; sun?: DirectionalLight2D | false; }

/** CSS/device sizes plus the actual Rust camera center; logical units are world units. */
export interface DataSceneViewSnapshot extends ScenePlacementViewport { groundYScale: number; }

export interface DataSceneView {
  setCamera(options: DataSceneCameraOptions): void;
  setZoom(zoom: number): void;
  setGroundYScale(scale: number): void;
  setSun(light: DirectionalLight2D | false): void;
  snapshot(frame?: Pick<FrameState, "cameraX" | "cameraY" | "cameraGroundYScale">): DataSceneViewSnapshot;
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
  let sun: DirectionalLight2D | undefined;
  const setSun = (light: DirectionalLight2D | false): void => {
    const next = light === false ? undefined : resolveDirectionalLight2D(light);
    if (!engine.setDataSceneSun(next ?? false)) throw new Error("Sun requires an active Data Scene");
    sun = next;
  };
  const setGroundYScale = (scale: number): void => {
    if (!Number.isFinite(scale) || scale < Math.fround(0.01) || scale > 1) throw new Error("groundYScale must be in [0.01, 1]");
    if (renderer.setGroundYScale === undefined && scale !== 1) throw new Error("Renderer does not support ground projection");
    if (!engine.setDataSceneGroundYScale(scale)) throw new Error("Ground projection requires an active Data Scene");
    renderer.setGroundYScale?.(scale);
  };
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
  setGroundYScale(options.groundYScale ?? 1);
  setZoom(zoom);
  setCamera(options);
  if (options.sun !== undefined) setSun(options.sun);
  const snapshot = (frame?: Pick<FrameState, "cameraX" | "cameraY" | "cameraGroundYScale">): DataSceneViewSnapshot => {
    const groundYScale = frame?.cameraGroundYScale ?? engine.cameraGroundYScale();
    const base = createScenePlacementViewport({
    cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight,
    backbufferWidth: canvas.width, backbufferHeight: canvas.height,
    dpr: canvas.width / canvas.clientWidth, zoom,
    cameraX: frame?.cameraX ?? engine.cameraX(), cameraY: frame?.cameraY ?? engine.cameraY(),
    });
    const worldHeight = base.worldHeight / groundYScale;
    return { ...base, groundYScale, worldHeight, worldMinY: base.cameraY - worldHeight / 2, worldMaxY: base.cameraY + worldHeight / 2 };
  };
  const fromScreen = (point: ScenePlacementPoint, view: DataSceneViewSnapshot) => screenToSceneWorld(view, { x: point.x, y: point.y / view.groundYScale });
  const toScreen = (point: ScenePlacementPoint, view: DataSceneViewSnapshot) => {
    const screen = worldToSceneScreen(view, point);
    return { x: screen.x, y: screen.y * view.groundYScale };
  };
  return {
    setCamera, setZoom, setGroundYScale, setSun, snapshot,
    screenToWorld: (point, view = snapshot()) => fromScreen(point, view),
    worldToScreen: (point, view = snapshot()) => toScreen(point, view),
    pointerToWorld: (client, view = snapshot()) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) throw new Error("Data Scene pointer conversion requires a visible canvas.");
      return fromScreen({ x: (client.x - rect.left) * view.cssWidth / rect.width, y: (client.y - rect.top) * view.cssHeight / rect.height }, view);
    },
    lighting: (scene, view = snapshot()) => ({ ...scene,
      ...(sun === undefined ? {} : { directionalLight: sun }),
      pointLights: scene.pointLights?.map((light) => ({ ...light, x: light.x - view.worldMinX, y: (light.y - view.worldMinY) * view.groundYScale, radiusY: (light.radiusY ?? light.radius) * view.groundYScale })),
      tileOccluders: scene.tileOccluders?.map((rect) => ({ ...rect, x: rect.x - view.worldMinX, y: (rect.y - view.worldMinY) * view.groundYScale, height: rect.height * view.groundYScale })),
    }),
  };
}

function validateZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom < 0.0001 || zoom > 10000) throw new Error("Data Scene zoom must be in [0.0001, 10000].");
  return zoom;
}
