export interface ScenePlacementPoint {
  x: number;
  y: number;
}

export interface ScenePlacementViewportOptions {
  cssWidth: number;
  cssHeight: number;
  dpr?: number;
  backbufferWidth?: number;
  backbufferHeight?: number;
  cameraX?: number;
  cameraY?: number;
  zoom?: number;
}

export interface ScenePlacementViewport {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  backbufferWidth: number;
  backbufferHeight: number;
  cameraX: number;
  cameraY: number;
  zoom: number;
  worldMinX: number;
  worldMinY: number;
  worldMaxX: number;
  worldMaxY: number;
  worldWidth: number;
  worldHeight: number;
}

export type ScenePlacementSnapMode = "nearest" | "floor" | "ceil";

export interface ScenePlacementSnapOptions {
  gridSize?: number;
  originX?: number;
  originY?: number;
  mode?: ScenePlacementSnapMode;
}

export function createScenePlacementViewport(
  options: ScenePlacementViewportOptions,
): ScenePlacementViewport {
  const cssWidth = positiveFinite(options.cssWidth, "scenePlacementViewport.cssWidth");
  const cssHeight = positiveFinite(options.cssHeight, "scenePlacementViewport.cssHeight");
  const zoom = positiveFinite(options.zoom ?? 1, "scenePlacementViewport.zoom");
  const dpr = positiveFinite(options.dpr ?? 1, "scenePlacementViewport.dpr");
  const worldWidth = cssWidth / zoom;
  const worldHeight = cssHeight / zoom;
  const cameraX = finiteNumber(
    options.cameraX ?? worldWidth * 0.5,
    "scenePlacementViewport.cameraX",
  );
  const cameraY = finiteNumber(
    options.cameraY ?? worldHeight * 0.5,
    "scenePlacementViewport.cameraY",
  );
  const backbufferWidth = positiveFinite(
    options.backbufferWidth ?? cssWidth * dpr,
    "scenePlacementViewport.backbufferWidth",
  );
  const backbufferHeight = positiveFinite(
    options.backbufferHeight ?? cssHeight * dpr,
    "scenePlacementViewport.backbufferHeight",
  );
  const worldMinX = cameraX - worldWidth * 0.5;
  const worldMinY = cameraY - worldHeight * 0.5;

  return {
    cssWidth,
    cssHeight,
    dpr,
    backbufferWidth,
    backbufferHeight,
    cameraX,
    cameraY,
    zoom,
    worldMinX,
    worldMinY,
    worldMaxX: worldMinX + worldWidth,
    worldMaxY: worldMinY + worldHeight,
    worldWidth,
    worldHeight,
  };
}

export function screenToSceneWorld(
  viewport: ScenePlacementViewport,
  point: ScenePlacementPoint,
): ScenePlacementPoint {
  const x = finiteNumber(point.x, "scenePlacement.screen.x");
  const y = finiteNumber(point.y, "scenePlacement.screen.y");
  return {
    x: viewport.worldMinX + x / viewport.zoom,
    y: viewport.worldMinY + y / viewport.zoom,
  };
}

export function worldToSceneScreen(
  viewport: ScenePlacementViewport,
  point: ScenePlacementPoint,
): ScenePlacementPoint {
  const x = finiteNumber(point.x, "scenePlacement.world.x");
  const y = finiteNumber(point.y, "scenePlacement.world.y");
  return {
    x: (x - viewport.worldMinX) * viewport.zoom,
    y: (y - viewport.worldMinY) * viewport.zoom,
  };
}

export function sceneScreenToBackbuffer(
  viewport: ScenePlacementViewport,
  point: ScenePlacementPoint,
): ScenePlacementPoint {
  const x = finiteNumber(point.x, "scenePlacement.screen.x");
  const y = finiteNumber(point.y, "scenePlacement.screen.y");
  return {
    x: x * viewport.backbufferWidth / viewport.cssWidth,
    y: y * viewport.backbufferHeight / viewport.cssHeight,
  };
}

export function sceneBackbufferToScreen(
  viewport: ScenePlacementViewport,
  point: ScenePlacementPoint,
): ScenePlacementPoint {
  const x = finiteNumber(point.x, "scenePlacement.backbuffer.x");
  const y = finiteNumber(point.y, "scenePlacement.backbuffer.y");
  return {
    x: x * viewport.cssWidth / viewport.backbufferWidth,
    y: y * viewport.cssHeight / viewport.backbufferHeight,
  };
}

export function snapSceneWorldPoint(
  point: ScenePlacementPoint,
  options: ScenePlacementSnapOptions = {},
): ScenePlacementPoint {
  const gridSize = positiveFinite(options.gridSize ?? 1, "scenePlacement.snap.gridSize");
  const originX = finiteNumber(options.originX ?? 0, "scenePlacement.snap.originX");
  const originY = finiteNumber(options.originY ?? 0, "scenePlacement.snap.originY");
  const mode = options.mode ?? "nearest";
  return {
    x: snapAxis(finiteNumber(point.x, "scenePlacement.world.x"), gridSize, originX, mode),
    y: snapAxis(finiteNumber(point.y, "scenePlacement.world.y"), gridSize, originY, mode),
  };
}

function snapAxis(
  value: number,
  gridSize: number,
  origin: number,
  mode: ScenePlacementSnapMode,
): number {
  const scaled = (value - origin) / gridSize;
  if (mode === "floor") {
    return origin + Math.floor(scaled) * gridSize;
  }
  if (mode === "ceil") {
    return origin + Math.ceil(scaled) * gridSize;
  }
  if (mode !== "nearest") {
    throw new Error("scenePlacement.snap.mode must be 'nearest', 'floor', or 'ceil'.");
  }
  return origin + Math.round(scaled) * gridSize;
}

function finiteNumber(value: number, path: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function positiveFinite(value: number, path: string): number {
  const number = finiteNumber(value, path);
  if (number <= 0) {
    throw new Error(`${path} must be greater than 0.`);
  }
  return number;
}
