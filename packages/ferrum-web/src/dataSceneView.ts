import { resolveLightingCookieReferences } from "./lightingCookie.js";
import { resolvePointLightSpot } from "./lightingSpot.js";
import { resolveDirectionalLight2D,resolveLitDirectionalLight2D } from "./dataSceneSun.js";
import type { DirectionalLight2D } from "./lightingTypes.js";
import type { FerrumEngine, FrameState } from "./engineTypes.js";
import type { DataSceneCameraOptions } from "./dataSceneCamera.js";
import type { LightingScene2D } from "./lightingTypes.js";
import type { SceneFitSpec } from "./sceneDisplay.js";
import { pixelPerfectPointToViewport, resolvePixelPerfectOptions, type PixelPerfectOptions, type PixelPerfectPresentation } from "./pixelPerfect.js";
import {
  createScenePlacementViewport, screenToSceneWorld, worldToSceneScreen,
  type ScenePlacementViewport, type ScenePlacementPoint,
} from "./scenePlacementViewport.js";

export interface DataSceneViewRenderer {
  viewportSize(): { width: number; height: number };
  setViewportZoom?(zoom: number): void;
  setGroundYScale?(scale: number): void;
  setPixelPerfect?(options: PixelPerfectOptions | false | undefined): void;
  pixelPerfectPresentation?(): PixelPerfectPresentation | undefined;
}
export interface DataSceneViewOptions extends DataSceneCameraOptions { zoom?: number; groundYScale?: number; sun?: DirectionalLight2D | false; pixelPerfect?: PixelPerfectOptions | false; }

/** CSS/device sizes plus the actual Rust camera center; logical units are world units. */
export interface DataSceneViewSnapshot extends ScenePlacementViewport { groundYScale: number; presentation?: PixelPerfectPresentation; }

export interface DataSceneView {
  setCamera(options: DataSceneCameraOptions): void;
  setZoom(zoom: number): void;
  setPixelPerfect(options: PixelPerfectOptions | false): void;
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
  const zoom = validateZoom(options.zoom ?? 1);
  const pixelPerfect = options.pixelPerfect === undefined ? undefined : resolvePixelPerfectOptions(options.pixelPerfect) ?? false;
  if (pixelPerfect !== undefined && (!renderer.setPixelPerfect || !renderer.pixelPerfectPresentation))
    throw Error("Renderer does not support pixelPerfect presentation");
  const { view } = bindDataSceneView(engine, renderer, canvas);
  // Bounds must clamp against the zoomed viewport, not the previous logical size.
  view.setGroundYScale(options.groundYScale ?? 1);
  if (pixelPerfect !== undefined) view.setPixelPerfect(pixelPerfect);
  view.setZoom(zoom);
  view.setCamera(options);
  if (options.sun !== undefined) view.setSun(options.sun);
  return view;
}

/** Connect the view without configuring the engine or requiring renderer capabilities at startup. */
export function bindDataSceneView(
  engine: FerrumEngine, renderer: DataSceneViewRenderer, canvas: HTMLCanvasElement,
  useRendererZoom = false,
) {
  let zoom = 1;
  let sun: DirectionalLight2D | undefined;
  const setSun = (light: DirectionalLight2D | false): void => {
    const next = light === false ? undefined : (light.lightMask!==undefined||light.shadowMask!==undefined?resolveLitDirectionalLight2D:resolveDirectionalLight2D)(light);
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
  const setRendererZoom = (value: number): void => {
    const next = validateZoom(value);
    if (!renderer.setViewportZoom) throw new Error("Data Scene view requires renderer.setViewportZoom().");
    renderer.setViewportZoom(next);
    zoom = next;
  };
  const setZoom = (value: number): void => {
    setRendererZoom(value);
    const viewport = renderer.viewportSize();
    engine.setViewportSize(viewport.width, viewport.height);
  };
  const setPixelPerfect = (value: PixelPerfectOptions | false): void => {
    const next = resolvePixelPerfectOptions(value);
    if(!renderer.setPixelPerfect || !renderer.pixelPerfectPresentation)throw Error("Renderer does not support pixelPerfect presentation");
    renderer.setPixelPerfect(next ?? false);
    const viewport=renderer.viewportSize();engine.setViewportSize(viewport.width,viewport.height);
  };
  const currentZoom = (presentation?: PixelPerfectPresentation) => {
    if (!useRendererZoom) return zoom;
    const viewport = renderer.viewportSize();
    const horizontal = (presentation?.sourceWidth ?? canvas.clientWidth) / viewport.width;
    if (Number.isFinite(horizontal) && horizontal > 0) return clampZoom(horizontal);
    const vertical = (presentation?.sourceHeight ?? canvas.clientHeight) / viewport.height;
    return Number.isFinite(vertical) && vertical > 0 ? clampZoom(vertical) : zoom;
  };
  const snapshot = (frame?: Pick<FrameState, "cameraX" | "cameraY" | "cameraGroundYScale">): DataSceneViewSnapshot => {
    const groundYScale = frame?.cameraGroundYScale ?? engine.cameraGroundYScale();
    const presentation=renderer.pixelPerfectPresentation?.();
    const cssWidth=canvas.clientWidth,cssHeight=canvas.clientHeight;
    if(cssWidth<=0 || cssHeight<=0)throw Error("Data Scene view requires a visible canvas");
    const base = createScenePlacementViewport({
    cssWidth: presentation?.sourceWidth??cssWidth, cssHeight: presentation?.sourceHeight??cssHeight,
    backbufferWidth: canvas.width, backbufferHeight: canvas.height,
    dpr: canvas.width / canvas.clientWidth, zoom: currentZoom(presentation),
    cameraX: frame?.cameraX ?? engine.cameraX(), cameraY: frame?.cameraY ?? engine.cameraY(),
    });
    const worldHeight = base.worldHeight / groundYScale;
    return { ...base, cssWidth,cssHeight,...(presentation?{presentation}:{}),groundYScale, worldHeight, worldMinY: base.cameraY - worldHeight / 2, worldMaxY: base.cameraY + worldHeight / 2 };
  };
  const fromScreen = (point: ScenePlacementPoint, view: DataSceneViewSnapshot) => {
    const p=view.presentation;
    if(p){const pixel=pixelPerfectPointToViewport(p,point.x,point.y,view.cssWidth,view.cssHeight);
      return {x:view.worldMinX+pixel.x/view.zoom,y:view.worldMinY+pixel.y/view.zoom/view.groundYScale};}
    return screenToSceneWorld(view, { x: point.x, y: point.y / view.groundYScale });
  };
  const toScreen = (point: ScenePlacementPoint, view: DataSceneViewSnapshot) => {
    const screen = worldToSceneScreen(view, point);
    const p=view.presentation;
    if(p)return {x:(p.x+screen.x*p.width/p.sourceWidth)*view.cssWidth/p.canvasWidth,
      y:(p.y+screen.y*view.groundYScale*p.height/p.sourceHeight)*view.cssHeight/p.canvasHeight};
    return { x: screen.x, y: screen.y * view.groundYScale };
  };
  const view: DataSceneView = {
    setCamera, setZoom, setPixelPerfect, setGroundYScale, setSun, snapshot,
    screenToWorld: (point, view = snapshot()) => fromScreen(point, view),
    worldToScreen: (point, view = snapshot()) => toScreen(point, view),
    pointerToWorld: (client, view = snapshot()) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) throw new Error("Data Scene pointer conversion requires a visible canvas.");
      return fromScreen({ x: (client.x - rect.left) * view.cssWidth / rect.width, y: (client.y - rect.top) * view.cssHeight / rect.height }, view);
    },
    lighting: (scene, view = snapshot()) => ({ ...scene,
      ...(sun === undefined ? {} : { directionalLight: sun }),
      pointLights: resolveLightingCookieReferences(scene, name => engine.textureId(name)).pointLights?.map((light, index) => {
        const spot = light.spot === undefined ? undefined : resolvePointLightSpot(light.spot, `lighting.pointLights[${index}].spot`);
        // Normalize before projection: a valid short vector must not fall below the input epsilon.
        if (spot) spot.directionY *= view.groundYScale;
        return { ...light, ...(spot ? { spot } : {}), x: light.x - view.worldMinX, y: (light.y - view.worldMinY) * view.groundYScale, radiusY: (light.radiusY ?? light.radius) * view.groundYScale };
      }),
      tileOccluders: scene.tileOccluders?.map((rect) => ({ ...rect, x: rect.x - view.worldMinX, y: (rect.y - view.worldMinY) * view.groundYScale, height: rect.height * view.groundYScale })),
      polygonOccluders: scene.polygonOccluders?.map(polygon => ({ vertices: polygon.vertices.map(point => ({ x: point.x - view.worldMinX, y: (point.y - view.worldMinY) * view.groundYScale })) })),
    }),
  };
  return { view, currentZoom, setRendererZoom };
}

const MIN_ZOOM = 0.0001;
const MAX_ZOOM = 10000;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function validateZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom < MIN_ZOOM || zoom > MAX_ZOOM) throw new Error("Data Scene zoom must be in [0.0001, 10000].");
  return zoom;
}

export function fitDataSceneZoom(canvas: HTMLCanvasElement, fit: SceneFitSpec): number | undefined {
  const { clientWidth, clientHeight } = canvas;
  if (clientWidth <= 0 || clientHeight <= 0) return undefined;
  return clampZoom(Math.min(clientWidth / fit.width, clientHeight / fit.height));
}
