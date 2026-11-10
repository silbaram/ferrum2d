import type { FlatHdrOptions, ResolvedFlatHdrOptions } from "./flatHdr.js";
export type { FlatHdrOptions, ResolvedFlatHdrOptions } from "./flatHdr.js";
export type LightingColor3 = readonly [number, number, number];
export type LightingColor4 = readonly [number, number, number, number];

/** Flat 2D sunlight: additive full-view illumination plus optional native ground casters. */
export interface DirectionalLight2D {
  /** Eight channel bits for light and shadow reception; each defaults to255. */
  lightMask?: number;
  shadowMask?: number;
  /** Normal-map incidence angle; shadows keep their existing projection. Default pi/4. */
  elevationRadians?: number;
  directionX: number;
  directionY: number;
  intensity?: number;
  color?: LightingColor3;
  shadowOpacity?: number;
  shadowLengthScale?: number;
  maxCasters?: number;
}
export interface ResolvedDirectionalLight2D extends Required<Omit<DirectionalLight2D,"elevationRadians"|"lightMask"|"shadowMask">> { elevationRadians?: number; lightMask?:number;shadowMask?:number; }

/** Point-light cone in the same logical XY/elliptical metric as the light's range. */
export interface PointLightSpot2D {
  /** Finite float32 XY vector, length at least1e-6; normalized during validation. */
  directionX: number;
  directionY: number;
  /** Full opening, 0.1..360 degrees. 360 with penumbra0 preserves a radial point light. */
  angleDegrees: number;
  /** Fraction of the half-opening used by the smooth edge, 0..1; default0. */
  penumbra?: number;
}
export interface ResolvedPointLightSpot2D extends Required<PointLightSpot2D> {}

export interface PointLight2D {
  /** Optional cone; requires profile lit. */
  spot?: PointLightSpot2D;
  lightMask?: number;
  shadowMask?: number;
  /** Logical normal-light Z distance; defaults to radius*0.5. */
  height?: number;
  x: number;
  y: number;
  radius: number;
  /** Logical vertical radius; defaults to radius. */
  radiusY?: number;
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
  /** RGB transmission filter for this light; alpha is union mask opacity. Default black. */
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
  /** Optional float world target and one output transform. Requires profile lit. */
  hdr?: FlatHdrOptions | false;
  /** Omit for the existing overlay. lit uses explicit sprite receiver metadata. */
  profile?: "legacy" | "lit";
  /** Linear ambient irradiance for lit, default white. Do not combine with ambient overlay. */
  ambientIrradiance?: LightingColor3;
  enabled?: boolean;
  ambient?: LightingColor4;
  directionalLight?: DirectionalLight2D;
  pointLights?: readonly PointLight2D[];
  tileOccluders?: readonly TileOccluder2D[];
  shadows?: boolean | LightingShadowOptions;
  debug?: LightingDebugOptions;
}

export interface ResolvedPointLight2D {
  spot?: ResolvedPointLightSpot2D;
  lightMask?: number;
  shadowMask?: number;
  height?: number;
  x: number;
  y: number;
  radius: number;
  /** Logical vertical radius; defaults to radius. */
  radiusY?: number;
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
  hdr?: ResolvedFlatHdrOptions;
  profile?: "legacy" | "lit";
  ambientIrradiance?: LightingColor3;
  enabled: boolean;
  ambient: LightingColor4;
  directionalLight?: ResolvedDirectionalLight2D;
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
