export type LightingColor3 = readonly [number, number, number];
export type LightingColor4 = readonly [number, number, number, number];

export interface PointLight2D {
  x: number;
  y: number;
  radius: number;
  color?: LightingColor3 | LightingColor4;
  intensity?: number;
  falloff?: number;
}

export interface TileOccluder2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LightingDebugOptions {
  tileOccluders?: boolean;
  color?: LightingColor4;
}

export interface LightingShadowOptions {
  enabled?: boolean;
  color?: LightingColor4;
  projectionLength?: number;
  maxDistance?: number;
}

export interface ShadowClipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShadowProjectionOptions {
  clipRect?: ShadowClipRect;
}

export interface ShadowProjectionPoint {
  x: number;
  y: number;
}

export interface ShadowProjectionAnglePoint {
  point: ShadowProjectionPoint;
  angle: number;
}

export interface ShadowProjectionScratch {
  readonly corners: ShadowProjectionPoint[];
  readonly anglePoints: ShadowProjectionAnglePoint[];
  readonly polygon: ShadowProjectionPoint[];
  readonly clipA: ShadowProjectionPoint[];
  readonly clipB: ShadowProjectionPoint[];
  readonly startFar: ShadowProjectionPoint;
  readonly endFar: ShadowProjectionPoint;
  result: ShadowProjectionPoint[];
}

export interface LightingScene2D {
  enabled?: boolean;
  ambient?: LightingColor4;
  pointLights?: readonly PointLight2D[];
  tileOccluders?: readonly TileOccluder2D[];
  shadows?: boolean | LightingShadowOptions;
  debug?: LightingDebugOptions;
}

export interface ResolvedPointLight2D {
  x: number;
  y: number;
  radius: number;
  color: LightingColor4;
  intensity: number;
  falloff: number;
}

export interface ResolvedLightingDebugOptions {
  tileOccluders: boolean;
  color: LightingColor4;
}

export interface ResolvedLightingShadowOptions {
  enabled: boolean;
  color: LightingColor4;
  projectionLength: number;
  maxDistance?: number;
}

export interface ResolvedLightingScene2D {
  enabled: boolean;
  ambient: LightingColor4;
  pointLights: readonly ResolvedPointLight2D[];
  tileOccluders: readonly TileOccluder2D[];
  shadows: ResolvedLightingShadowOptions;
  debug: ResolvedLightingDebugOptions;
}

export interface TileOccluderGridInput {
  width: number;
  height: number;
  tileSize: number;
  data: readonly number[];
  solidTileIds?: readonly number[];
}

export interface Hd2dTileOccluderDefinition {
  blocksVision?: boolean;
  occluderHeight?: number;
}

export interface Hd2dTileOccluderGridInput extends TileOccluderGridInput {
  tiles: Readonly<Record<number, Hd2dTileOccluderDefinition | undefined>>;
}
