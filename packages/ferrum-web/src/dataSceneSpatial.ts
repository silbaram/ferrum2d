import { uint32Number } from "./particlePreset.js";
import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import type { GameplayEntityHandle } from "./gameplayAuthoring.js";
import type { DataSceneMoveStatus } from "./dataSceneMovement.js";
import type { Engine } from "../pkg/ferrum_core.js";
import { spatialModelRegistry, spatialModelResource, type SpatialModelAsset } from "./spatialModel.js";
import {
  compileSpatialEnvironment,
  resolveSpatialEnvironmentSpec,
  type SpatialEnvironmentSpec,
  type SpatialEnvironmentBufferView,
} from "./spatialEnvironment.js";

export interface SpatialPoint {
  x: number;
  y: number;
  elevation: number;
}
export interface SpatialCameraSpec {
  projection: "orthographic" | "perspective";
  position: SpatialPoint;
  target: SpatialPoint;
  /** World-space vertical extent for orthographic cameras. */
  height?: number;
  /** Degrees, for perspective cameras. */
  fovDegrees?: number;
  near?: number;
  far?: number;
}
export interface SpatialTerrainSurface {
  /** false keeps native physics/picking/debug support without color/depth/shadow draws. Default true. */
  render?: boolean;
  id: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  elevation: number;
  endElevation?: number;
  /** Ramp height varies along this ground axis. Default y; only valid for kind:ramp. */
  rampAxis?: "x" | "y";
  baseElevation?: number;
  floorId?: number;
  kind?: "flat" | "stair" | "ramp" | "bridge";
  color?: readonly [number, number, number, number];
  textureId?: number;
  walkable?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
}
export interface SpatialBillboardSpec {
  /** Stable project texture name. Resolved before native configuration; exclusive with normalTextureId. */
  normalTexture?: string;
  normalTextureId?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  unitsPerPixel?: number;
  alphaCutoff?: number;
  elevation?: number;
}
/** Bidirectional shared-edge connection between walkable surfaces on different floors. */
export interface SpatialSurfaceConnection {
  from: string;
  to: string;
}
/** Runtime request; x/y are the actor origin, floorId selects the destination support. */
export interface SpatialMoveOptions {
  x: number;
  y: number;
  floorId: number;
  speed: number;
  /** Grid spacing in world units. Default 8; smaller grids can exceed the search budget. */
  cellSize?: number;
  /** Final waypoint tolerance on the destination surface. Default 0.5. */
  arrivalRadius?: number;
  /** WASD cancels and takes control in the same update. Default true. */
  cancelOnInput?: boolean;
}
export interface SpatialMoveStats {
  searchNodeCount: number;
  edgeProbeCount: number;
  waypointCount: number;
  remainingWaypointCount: number;
  searchCount: number;
  /** Conservative native work including request preparation; not milliseconds. */
  probeWorkUnits: number;
  /** Optional native v1 diagnostics. Rejected requests preserve the active route counters above. */
  lastRequest?: {
    status:
      | "notRequested"
      | "accepted"
      | "invalidRequest"
      | "unsupportedActor"
      | "noPath"
      | "nodeBudgetExceeded"
      | "probeBudgetExceeded"
      | "workBudgetExceeded"
      | "frameBudgetExceeded";
    count: number;
    /** Enabled target AABB/OBB proxies; excludes the moving actor and terrain. */
    collisionProxyCount: number;
    preparationWorkUnits: number;
  };
}
export interface DataSceneSpatialSpec {
  /** Static model resources must be loaded/registered before applying authoring. */
  models?: Readonly<Record<string, SpatialModelInstanceSpec>>;
  /** Visual GPU residency only; physics/supports remain loaded. Up to 64 world-space chunks. */
  modelChunks?: Readonly<Record<string,{min:SpatialPoint;max:SpatialPoint;loadDistance:number;unloadDistance:number}>>;
  /** Native parent-body coordinates. Attached children require static heightSpan bodies. */
  attachments?: Readonly<Record<string,{parent:string;x?:number;y?:number;elevation?:number;yawDegrees?:number;inheritFloor?:boolean}>>;
  /** Instance IDs mapped to authored light indices. Positions become local offsets. */
  lightBindings?: Readonly<Record<string, readonly number[]>>;
  environment?: SpatialEnvironmentSpec;
  camera: SpatialCameraSpec;
  terrain: readonly SpatialTerrainSurface[];
  connections?: readonly SpatialSurfaceConnection[];
  billboards: Readonly<Record<string, SpatialBillboardSpec>>;
  actor?: {
    instanceId: string;
    speed: number;
    maxStepHeight?: number;
    maxDropHeight?: number;
  };
}
export interface SpatialModelInstanceSpec {
  chunk?: string;
  /** Up to three additional preloaded CPU assets; native distance selection has 10% hysteresis. */
  lods?: readonly {asset:string;contentId:string;minDistance:number}[];
  asset: string;
  contentId: string;
  elevation?: number;
  yawDegrees?: number;
  scale?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}
/** Runtime diagnostics only; not scene authoring data or saved progress. */
export interface SpatialDebugOptions {
  terrain?: boolean;
  billboards?: boolean;
  heightSpans?: boolean;
  /** Native collider outlines at heightSpan bottom/top, including compound and chain children. */
  colliders?: boolean;
  /** Last committed spatial sweep hits and available rigid solver impulse contacts. */
  contacts?: boolean;
  /** Camera-facing terrain/body floor IDs. F- denotes a body without heightSpan. */
  floorIds?: boolean;
  /** true: respect scene depth; false: show occluded lines too. Default true. */
  depthTest?: boolean;
}
/** Optional extension v1; the same XYZ/UV/RGBA/texture/cutoff layout as spatial triangles. */
export interface SpatialDebugBufferView {
  version: 1;
  vertexStride: 11;
  vertices: Float32Array;
  vertexCount: number;
  depthTest: boolean;
  /** Native vertex/work/hit budget exceeded or nonfinite diagnostic geometry rejected. */
  truncated: boolean;
}
/** Borrowed Wasm views; reacquire per frame or explicitly copy for deferred rendering/picking. */
interface SpatialRenderBufferBase {
  /** Independent v1: four u32 metadata words + sixteen f32 matrix words per native instance. */
  models?: { version: 1; stride: 20; words: Uint32Array; values: Float32Array; assets: ReadonlyMap<number, SpatialModelAsset> };
  vertexStride: 11;
  camera: Float32Array;
  terrain: Float32Array;
  terrainVertexCount: number;
  terrainRevision: number;
  /** Normalized top-left viewport x/y/w/h, followed by internal width/height (zero disables). */
  presentation?: Float32Array;
  /** Independent material extension v1: normal texture ID (16777215=none), cast/receive flags. */
  materials?: { version: 1; terrain: Uint32Array; billboards: Uint32Array };
  billboards: Float32Array;
  billboardVertexCount: number;
  debug?: SpatialDebugBufferView;
  environment?: SpatialEnvironmentBufferView;
}
export type SpatialRenderBufferView = SpatialRenderBufferBase &
  (
    | { version: 1; terrainDrawRanges?: never }
    /** Ordered [firstVertex, vertexCount] pairs into static terrain. Empty means fully culled. */
    | { version: 2; terrainDrawRanges: Uint32Array }
  );
export interface SpatialSurfaceHit extends SpatialPoint {
  surfaceId: string;
  floorId: number;
  normal: readonly [number, number, number];
  distance: number;
  walkable: boolean;
}
/** Owned last-rendered LOD/pose for a cold authoring query, never a physics shape. */
export interface SpatialModelDrawSnapshot {
  readonly asset: SpatialModelAsset;
  /** Column-major asset-local glTF XYZ to world XYZ transform. */
  readonly transform: Float32Array;
  readonly cameraVisible: boolean;
}
export interface FerrumSpatialApi {
  /** Authoring presentation only. Hidden terrain is excluded from visual picking, never physics. Null restores all. */
  /** Cold editor-only 2D/spatial filter. Does not alter simulation or saved scene data. */
  setDataSceneSpatialPreviewFilter(options: {hiddenEntities: readonly GameplayEntityHandle[];hiddenSurfaces:readonly string[]} | null): boolean;
  registerDataSceneSpatialModel(id: string, asset: SpatialModelAsset): boolean;
  releaseDataSceneSpatialModel(id: string): boolean;
  /** Undefined before rendering, after unbinding, or on older cores without this capability. */
  dataSceneSpatialModelDrawSnapshot(handle: GameplayEntityHandle): SpatialModelDrawSnapshot | undefined;
  /** Cold asset/content/renderer-independent validation before replacing a scene. */
  preflightDataSceneSpatialModels(spec: DataSceneSpatialSpec, origins?: Readonly<Record<string, SpatialPoint>>): boolean;
  /** Presentation settings only; movement is preserved. Null disables all spatial effects. */
  setDataSceneSpatialEnvironment(
    options: SpatialEnvironmentSpec | null,
  ): boolean;
  /** Bounded native search. Failure preserves any active route and the actor pose. */
  moveDataSceneSpatialActorTo(options: SpatialMoveOptions): boolean;
  cancelDataSceneSpatialMove(): boolean;
  dataSceneSpatialMoveStatus(): DataSceneMoveStatus | undefined;
  /** Request-time search diagnostics; no automatic per-frame replanning. */
  dataSceneSpatialMoveStats(): SpatialMoveStats | undefined;
  /** Pass null to disable. Each category defaults false; configure/reset/restore clears diagnostics. */
  setDataSceneSpatialDebug(options: SpatialDebugOptions | null): boolean;
  configureDataSceneSpatial(
    spec: DataSceneSpatialSpec,
    handles: Readonly<Record<string, GameplayEntityHandle>>,
  ): boolean;
  setDataSceneSpatialCamera(
    camera: SpatialCameraSpec,
    viewport: { width: number; height: number },
  ): boolean;
  clearDataSceneSpatial(): void;
  moveDataSceneSpatialBody(
    handle: GameplayEntityHandle,
    dx: number,
    dy: number,
    options?: { maxStepHeight?: number; maxDropHeight?: number },
  ): boolean;
  /** NDC X/Y; camera snapshot from the displayed frame. Stale terrain returns undefined. */
  pickDataSceneSpatialSurface(
    x: number,
    y: number,
    frame: SpatialRenderBufferView,
  ): SpatialSurfaceHit | undefined;
}
const kinds = { flat: 0, stair: 1, ramp: 2, bridge: 4 } as const;
function record(v: unknown, path: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw sceneCompositionDiagnosticError(path, "must be an object");
  return v as Record<string, unknown>;
}
function keys(
  o: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(o))
    if (!allowed.includes(key))
      throw sceneCompositionDiagnosticError(
        `${path}.${key}`,
        "is not supported",
      );
}
function num(
  v: unknown,
  path: string,
  min = -Infinity,
  max = Infinity,
): number {
  if (
    typeof v !== "number" ||
    !Number.isFinite(Math.fround(v)) ||
    v < min ||
    v > max
  )
    throw sceneCompositionDiagnosticError(
      path,
      "must be a finite f32 in the supported range",
    );
  return v;
}
function point(v: unknown, path: string): SpatialPoint {
  const o = record(v, path);
  keys(o, ["x", "y", "elevation"], path);
  return {
    x: num(o.x, `${path}.x`),
    y: num(o.y, `${path}.y`),
    elevation: num(o.elevation, `${path}.elevation`),
  };
}
function integer(v: unknown, path: string, max: number): number {
  const n = num(v, path, 0, max);
  if (!Number.isInteger(n))
    throw sceneCompositionDiagnosticError(path, "must be an integer");
  return n;
}
function bool(v: unknown, path: string): boolean {
  if (typeof v !== "boolean")
    throw sceneCompositionDiagnosticError(path, "must be a boolean");
  return v;
}
function positive(v: unknown, path: string): number {
  const n = num(v, path);
  if (Math.fround(n) <= 0)
    throw sceneCompositionDiagnosticError(path, "must be positive f32");
  return n;
}
export function resolveSpatialCameraSpec(
  v: unknown,
  path = "spatial.camera",
): SpatialCameraSpec {
  const o = record(v, path);
  keys(
    o,
    ["projection", "position", "target", "height", "fovDegrees", "near", "far"],
    path,
  );
  if (o.projection !== "orthographic" && o.projection !== "perspective")
    throw sceneCompositionDiagnosticError(
      `${path}.projection`,
      "must be orthographic or perspective",
    );
  const position = point(o.position, `${path}.position`),
    target = point(o.target, `${path}.target`);
  if (Math.hypot(position.x - target.x, position.y - target.y) < 0.0001)
    throw sceneCompositionDiagnosticError(
      path,
      "camera must have a nonzero horizontal viewing direction",
    );
  const near = positive(o.near ?? 0.1, `${path}.near`),
    far = positive(o.far ?? 10000, `${path}.far`);
  if (Math.fround(far) <= Math.fround(near))
    throw sceneCompositionDiagnosticError(`${path}.far`, "must exceed near");
  return {
    projection: o.projection,
    position,
    target,
    near,
    far,
    ...(o.projection === "orthographic"
      ? { height: positive(o.height ?? 240, `${path}.height`) }
      : { fovDegrees: num(o.fovDegrees ?? 45, `${path}.fovDegrees`, 1, 170) }),
  };
}
/** Internal normalization shared with model-local authoring; public scenes use world f32 bounds. */
export function resolveSpatialTerrainSurfaces(
  input: unknown,
  path: string,
  space: "world" | "local" = "world",
): SpatialTerrainSurface[] {
  if (!Array.isArray(input) || input.length > 256)
    throw sceneCompositionDiagnosticError(
      `${path}`,
      "must be an array with at most 256 surfaces",
    );
  const ids = new Set<string>();
  const terrain = Array.from(
    input,
    (v: unknown, i: number): SpatialTerrainSurface => {
      const at = `${path}.${i}`,
        s = record(v, at);
      keys(
        s,
        [
          "id",
          "render",
          "x",
          "y",
          "width",
          "depth",
          "elevation",
          "endElevation",
          "rampAxis",
          "baseElevation",
          "floorId",
          "kind",
          "color",
          "textureId",
          "walkable",
          "castShadow",
          "receiveShadow",
        ],
        at,
      );
      if (typeof s.id !== "string" || s.id.length === 0 || ids.has(s.id))
        throw sceneCompositionDiagnosticError(
          `${at}.id`,
          "must be a unique nonempty ID",
        );
      ids.add(s.id);
      const kind = s.kind ?? "flat";
      if (
        typeof kind !== "string" ||
        !Object.prototype.hasOwnProperty.call(kinds, kind)
      )
        throw sceneCompositionDiagnosticError(
          `${at}.kind`,
          "must be flat, stair, ramp, or bridge",
        );
      if (s.rampAxis !== undefined && (kind !== "ramp" || (s.rampAxis !== "x" && s.rampAxis !== "y")))
        throw sceneCompositionDiagnosticError(`${at}.rampAxis`, "requires kind:ramp and x or y");
      const render = s.render === undefined ? true : bool(s.render, `${at}.render`);
      if (
        !render &&
        (s.textureId !== undefined || s.castShadow === true || s.receiveShadow === true)
      )
        throw sceneCompositionDiagnosticError(
          at,
          "render:false surfaces cannot use textures or enable shadow flags",
        );
      const x = num(s.x, `${at}.x`),
        y = num(s.y, `${at}.y`),
        width = positive(s.width, `${at}.width`),
        depth = positive(s.depth, `${at}.depth`);
      const elevation = num(s.elevation, `${at}.elevation`),
        endElevation = num(s.endElevation ?? elevation, `${at}.endElevation`),
        baseElevation = num(
          s.baseElevation ?? Math.min(0, elevation, endElevation),
          `${at}.baseElevation`,
        );
      if (
        baseElevation > Math.min(elevation, endElevation) ||
        (kind !== "ramp" && elevation !== endElevation)
      )
        throw sceneCompositionDiagnosticError(
          at,
          "requires base below top and ramp for varying elevation",
        );
      const color = s.color ?? [0.6, 0.65, 0.7, 1];
      if (!Array.isArray(color) || color.length !== 4)
        throw sceneCompositionDiagnosticError(
          `${at}.color`,
          "must have four RGBA numbers",
        );
      const rgba = Array.from(color, (c: unknown, i: number) =>
        num(c, `${at}.color.${i}`, 0, 1),
      ) as [number, number, number, number];
      if (rgba[3] !== 1)
        throw sceneCompositionDiagnosticError(
          `${at}.color.3`,
          "terrain requires opaque alpha=1",
        );
      return {
        id: s.id,
        x,
        y,
        width,
        depth,
        elevation,
        endElevation,
        ...(s.rampAxis === undefined ? {} : { rampAxis: s.rampAxis as "x" | "y" }),
        baseElevation,
        kind: kind as SpatialTerrainSurface["kind"],
        floorId: integer(s.floorId ?? 0, `${at}.floorId`, 65535),
        color: rgba,
        walkable: bool(s.walkable ?? true, `${at}.walkable`),
        ...(s.render === undefined ? {} : { render }),
        ...(!render ? { castShadow: false, receiveShadow: false } : {}),
        ...(s.castShadow === undefined ? {} : { castShadow: bool(s.castShadow, `${at}.castShadow`) }),
        ...(s.receiveShadow === undefined ? {} : { receiveShadow: bool(s.receiveShadow, `${at}.receiveShadow`) }),
        ...(s.textureId === undefined
          ? {}
          : { textureId: integer(s.textureId, `${at}.textureId`, 16777214) }),
      };
    },
  );
  // Match the native buffer: round components before arithmetic and round sums too.
  // Comparing JS doubles here rejects valid seams and can miss actual native overlaps.
  const terrainBounds = terrain.map((surface, i) => {
    const round = space === "world" ? Math.fround : (n: number) => n;
    const x = round(surface.x), y = round(surface.y);
    const maxX = round(x + round(surface.width));
    const maxY = round(y + round(surface.depth));
    if (!Number.isFinite(maxX) || !Number.isFinite(maxY) || maxX <= x || maxY <= y)
      throw sceneCompositionDiagnosticError(`${path}.${i}`, "requires positive finite f32 bounds after placement");
    return [x, y, maxX, maxY];
  });
  for (let i = 0; i < terrain.length; i++)
    for (let j = 0; j < i; j++) {
      const a = terrainBounds[i], b = terrainBounds[j];
      if (terrain[i].floorId === terrain[j].floorId &&
          a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1])
        throw sceneCompositionDiagnosticError(`${path}.${i}`, "surfaces on the same floor must not overlap");
    }
  return terrain;
}
export function resolveDataSceneSpatialSpec(
  v: unknown,
  path = "spatial",
): DataSceneSpatialSpec {
  const o = record(v, path);
  keys(
    o,
    ["camera", "terrain", "billboards", "actor", "connections", "environment", "models", "attachments", "modelChunks", "lightBindings"],
    path,
  );
  const camera = resolveSpatialCameraSpec(o.camera, `${path}.camera`);
  const terrain = resolveSpatialTerrainSurfaces(o.terrain, `${path}.terrain`);
  const connections = resolveConnections(
    o.connections,
    terrain,
    `${path}.connections`,
  );
  const source = record(o.billboards, `${path}.billboards`),
    billboards: Record<string, SpatialBillboardSpec> = Object.create(null);
  if (Object.keys(source).length > 10000)
    throw sceneCompositionDiagnosticError(
      `${path}.billboards`,
      "must have at most 10000 entries",
    );
  for (const [id, v] of Object.entries(source)) {
    const at = `${path}.billboards.${id}`,
      b = record(v, at);
    keys(b, ["unitsPerPixel", "alphaCutoff", "elevation", "normalTexture", "normalTextureId", "castShadow", "receiveShadow", "chunk", "lods"], at);
    if (b.normalTexture !== undefined && (typeof b.normalTexture !== "string" || !b.normalTexture.trim() || b.normalTexture !== b.normalTexture.trim() || b.normalTexture.length > 256 || b.normalTextureId !== undefined))
      throw sceneCompositionDiagnosticError(`${at}.normalTexture`, "must be a nonempty project texture name of at most 256 characters, exclusive with normalTextureId");
    billboards[id] = {
      ...(b.normalTexture === undefined ? {} : { normalTexture: b.normalTexture as string }),
      ...(b.normalTextureId === undefined ? {} : { normalTextureId: integer(b.normalTextureId, `${at}.normalTextureId`, 16777214) }),
      ...(b.castShadow === undefined ? {} : { castShadow: bool(b.castShadow, `${at}.castShadow`) }),
      ...(b.receiveShadow === undefined ? {} : { receiveShadow: bool(b.receiveShadow, `${at}.receiveShadow`) }),
      unitsPerPixel: positive(b.unitsPerPixel ?? 1, `${at}.unitsPerPixel`),
      alphaCutoff: num(b.alphaCutoff ?? 0.5, `${at}.alphaCutoff`, 0.001, 1),
      elevation: num(b.elevation ?? 0, `${at}.elevation`),
    };
  }
  const actor =
    o.actor === undefined ? undefined : record(o.actor, `${path}.actor`);
  if (actor)
    keys(
      actor,
      ["instanceId", "speed", "maxStepHeight", "maxDropHeight"],
      `${path}.actor`,
    );
  if (
    actor &&
    (typeof actor.instanceId !== "string" ||
      !Object.prototype.hasOwnProperty.call(billboards, actor.instanceId) ||
      terrain.length === 0)
  )
    throw sceneCompositionDiagnosticError(
      `${path}.actor.instanceId`,
      "must reference a billboard and a nonempty terrain",
    );
  const environment =
    o.environment === undefined
      ? undefined
      : resolveSpatialEnvironmentSpec(o.environment, `${path}.environment`);
  const lightBindings: Record<string,number[]> = Object.create(null);
  if(o.lightBindings !== undefined) {
    const seen=new Set<number>();
    for(const [id,indices] of Object.entries(record(o.lightBindings,`${path}.lightBindings`))) {
      if(!id || !Array.isArray(indices) || indices.length===0)throw sceneCompositionDiagnosticError(`${path}.lightBindings.${id}`,"requires a nonempty light index array");
      lightBindings[id]=Array.from(indices,index=>{
        if(!Number.isInteger(index) || index<0 || index>=(environment?.lighting?.lights.length??0) || seen.has(index) || environment?.lighting?.lights[index].followActor)throw sceneCompositionDiagnosticError(`${path}.lightBindings.${id}`,"requires unique authored light indices without followActor");
        seen.add(index);return index;
      });
    }
    if(seen.size && environment?.lighting) environment.lighting.maxActiveLights ??=4;
  }
  const models: Record<string, SpatialModelInstanceSpec> = Object.create(null);
  if (o.models !== undefined) {
    const entries = Object.entries(record(o.models, `${path}.models`));
    if (entries.length > 1024) throw sceneCompositionDiagnosticError(`${path}.models`, "maximum 1024 instances");
    for (const [id, raw] of entries) {
      const at = `${path}.models.${id}`, m = record(raw, at);
      keys(m, ["asset", "contentId", "elevation", "yawDegrees", "scale", "castShadow", "receiveShadow", "chunk", "lods"], at);
      if (!id || Object.prototype.hasOwnProperty.call(billboards,id) || typeof m.asset !== "string" || !m.asset || typeof m.contentId !== "string" || !/^[a-f0-9]{64}$/.test(m.contentId))
        throw sceneCompositionDiagnosticError(at, "requires unique model instance, asset ID and SHA-256 contentId");
      const lods:NonNullable<SpatialModelInstanceSpec['lods']>[number][]=[];
      if(m.lods!==undefined){if(!Array.isArray(m.lods)||m.lods.length>3)throw sceneCompositionDiagnosticError(`${at}.lods`,'maximum 3 additional LOD assets');let previous=0;
        for(const [index,value]of m.lods.entries()){const p=`${at}.lods.${index}`,l=record(value,p);keys(l,['asset','contentId','minDistance'],p);
          if(typeof l.asset!=='string'||!l.asset||typeof l.contentId!=='string'||!/^[a-f0-9]{64}$/.test(l.contentId))throw sceneCompositionDiagnosticError(p,'requires asset ID and SHA-256 contentId');
          const distance=num(l.minDistance,`${p}.minDistance`,0,1e6);if(Math.fround(distance)<=Math.fround(previous))throw sceneCompositionDiagnosticError(p,'distances must increase and remain positive in f32');previous=distance;lods.push({asset:l.asset,contentId:l.contentId,minDistance:distance});}}
      if(m.chunk!==undefined&&(typeof m.chunk!=='string'||!m.chunk))throw sceneCompositionDiagnosticError(`${at}.chunk`,'requires a chunk ID');
      models[id] = { asset:m.asset, contentId:m.contentId,
        ...(m.chunk===undefined?{}:{chunk:m.chunk as string}),...(m.lods===undefined?{}:{lods}),
        elevation:num(m.elevation ?? 0,`${at}.elevation`), yawDegrees:num(m.yawDegrees ?? 0,`${at}.yawDegrees`,-360,360), scale:num(m.scale ?? 1,`${at}.scale`,0.0001,10000),
        ...(m.castShadow===undefined?{}:{castShadow:bool(m.castShadow,`${at}.castShadow`)}),
        ...(m.receiveShadow===undefined?{}:{receiveShadow:bool(m.receiveShadow,`${at}.receiveShadow`)}) };
    }
  }
  const modelChunks:NonNullable<DataSceneSpatialSpec['modelChunks']>=Object.create(null);
  if(o.modelChunks!==undefined){const entries=Object.entries(record(o.modelChunks,`${path}.modelChunks`));if(entries.length>64)throw sceneCompositionDiagnosticError(`${path}.modelChunks`,'maximum 64 chunks');
    for(const[id,value]of entries){const at=`${path}.modelChunks.${id}`,c=record(value,at);keys(c,['min','max','loadDistance','unloadDistance'],at);
      const point=(input:unknown,p:string):SpatialPoint=>{const v=record(input,p);keys(v,['x','y','elevation'],p);return {x:num(v.x,`${p}.x`,-1e6,1e6),y:num(v.y,`${p}.y`,-1e6,1e6),elevation:num(v.elevation,`${p}.elevation`,-1e6,1e6)};};
      const min=point(c.min,`${at}.min`),max=point(c.max,`${at}.max`),loadDistance=num(c.loadDistance,`${at}.loadDistance`,0,1e6),unloadDistance=num(c.unloadDistance,`${at}.unloadDistance`,0,1e6);
      if(!id||min.x>max.x||min.y>max.y||min.elevation>max.elevation||Math.fround(unloadDistance)<=Math.fround(loadDistance))throw sceneCompositionDiagnosticError(at,'ordered bounds and unloadDistance > loadDistance required');
      (modelChunks as Record<string,typeof modelChunks[string]>)[id]={min,max,loadDistance,unloadDistance};}}
  for(const[id,m]of Object.entries(models))if(m.chunk!==undefined&&!Object.prototype.hasOwnProperty.call(modelChunks,m.chunk))throw sceneCompositionDiagnosticError(`${path}.models.${id}.chunk`,'unknown model chunk');
  if ((environment?.lighting?.shadows || environment?.lighting?.directional?.shadows) && Object.keys(billboards).length > 1024)
    throw sceneCompositionDiagnosticError(
      `${path}.billboards`,
      "shadow casting supports at most 1024 authored billboards",
    );
  const attachments: Record<string,NonNullable<DataSceneSpatialSpec['attachments']>[string]>=Object.create(null);
  if(o.attachments!==undefined){
    const entries=Object.entries(record(o.attachments,`${path}.attachments`));
    if(entries.length>1024)throw sceneCompositionDiagnosticError(`${path}.attachments`,'maximum 1024 attachments');
    for(const [id,value] of entries){const at=`${path}.attachments.${id}`,a=record(value,at);keys(a,['parent','x','y','elevation','yawDegrees','inheritFloor'],at);
      if(!id || typeof a.parent!=='string'||!a.parent||a.parent===id)throw sceneCompositionDiagnosticError(at,'requires a distinct nonempty parent');
      attachments[id]={parent:a.parent,x:num(a.x??0,`${at}.x`),y:num(a.y??0,`${at}.y`),elevation:num(a.elevation??0,`${at}.elevation`),yawDegrees:num(a.yawDegrees??0,`${at}.yawDegrees`,-360,360),inheritFloor:bool(a.inheritFloor??true,`${at}.inheritFloor`)};
    }
    for(const id of Object.keys(attachments)){const seen=new Set<string>();let parent=id;
      while(attachments[parent]){if(seen.has(parent)||seen.size>=8)throw sceneCompositionDiagnosticError(`${path}.attachments.${id}`,'cyclic attachment or depth exceeds 8');seen.add(parent);parent=attachments[parent].parent;}
      if(!Object.prototype.hasOwnProperty.call(models,parent))throw sceneCompositionDiagnosticError(`${path}.attachments.${id}`,'root parent must reference an authored model');
    }
  }
  return {
    camera,
    terrain,
    ...(o.models === undefined ? {} : {models}),
    ...(o.modelChunks===undefined?{}:{modelChunks}),
    ...(o.attachments===undefined?{}:{attachments}),
    ...(environment === undefined ? {} : { environment }),
    ...(Object.keys(lightBindings).length ? {lightBindings}:{}),
    ...(connections.length ? { connections } : {}),
    billboards,
    ...(actor
      ? {
          actor: {
            instanceId: actor.instanceId as string,
            speed: num(actor.speed, `${path}.actor.speed`, 0),
            maxStepHeight: num(
              actor.maxStepHeight ?? 32,
              `${path}.actor.maxStepHeight`,
              0,
            ),
            maxDropHeight: num(
              actor.maxDropHeight ?? 32,
              `${path}.actor.maxDropHeight`,
              0,
            ),
          },
        }
      : {}),
  };
}
function resolveConnections(
  value: unknown,
  terrain: readonly SpatialTerrainSurface[],
  path: string,
): SpatialSurfaceConnection[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 256)
    throw sceneCompositionDiagnosticError(
      path,
      "must be an array of at most 256 bidirectional connections",
    );
  const gateways: {
    from: string;
    to: string;
    edge: readonly [number, number, number, number];
  }[] = [];
  return Array.from(value, (v: unknown, i: number) => {
    const at = `${path}.${i}`,
      c = record(v, at);
    keys(c, ["from", "to"], at);
    const a = terrain.find((s) => s.id === c.from),
      b = terrain.find((s) => s.id === c.to);
    if (!a || !b || a.floorId === b.floorId || !a.walkable || !b.walkable)
      throw sceneCompositionDiagnosticError(
        at,
        "must reference walkable surfaces on different floors",
      );
    const bounds = (s: SpatialTerrainSurface) => [
      Math.fround(s.x),
      Math.fround(s.y),
      Math.fround(s.width),
      Math.fround(s.depth),
    ];
    const [ax, ay, aw, ad] = bounds(a),
      [bx, by, bw, bd] = bounds(b);
    const edge: readonly [number, number, number, number] | undefined =
      (Math.fround(ax + aw) === bx || Math.fround(bx + bw) === ax) &&
      Math.max(ay, by) < Math.min(Math.fround(ay + ad), Math.fround(by + bd))
        ? [
            0,
            Math.fround(ax + aw) === bx ? bx : ax,
            Math.max(ay, by),
            Math.min(Math.fround(ay + ad), Math.fround(by + bd)),
          ]
        : (Math.fround(ay + ad) === by || Math.fround(by + bd) === ay) &&
            Math.max(ax, bx) <
              Math.min(Math.fround(ax + aw), Math.fround(bx + bw))
          ? [
              1,
              Math.fround(ay + ad) === by ? by : ay,
              Math.max(ax, bx),
              Math.min(Math.fround(ax + aw), Math.fround(bx + bw)),
            ]
          : undefined;
    if (!edge)
      throw sceneCompositionDiagnosticError(
        at,
        "surfaces must share an exact f32 edge of positive length; overlap, gaps and corner-only links are unsupported",
      );
    for (const [from, to] of [
      [a.id, b.id],
      [b.id, a.id],
    ]) {
      if (
        gateways.some(
          (g) =>
            g.from === from &&
            (g.to === to ||
              (g.edge[0] === edge[0] &&
                g.edge[1] === edge[1] &&
                Math.max(g.edge[2], edge[2]) < Math.min(g.edge[3], edge[3]))),
        )
      )
        throw sceneCompositionDiagnosticError(
          at,
          "duplicate or ambiguous shared-edge connection",
        );
      gateways.push({ from, to, edge });
    }
    return { from: a.id, to: b.id };
  });
}
export function spatialCameraValues(
  c: SpatialCameraSpec,
  width: number,
  height: number,
): Float32Array {
  positive(width, "spatial.viewport.width");
  positive(height, "spatial.viewport.height");
  return Float32Array.from([
    c.projection === "orthographic" ? 0 : 1,
    c.position.x,
    c.position.elevation,
    -c.position.y,
    c.target.x,
    c.target.elevation,
    -c.target.y,
    c.projection === "orthographic"
      ? (c.height ?? 240)
      : ((c.fovDegrees ?? 45) * Math.PI) / 180,
    c.near ?? 0.1,
    c.far ?? 10000,
    width,
    height,
  ]);
}

/** Internal cold-path compiler shared by configure and saved-state preflight. */
export function compileSpatialTerrain(
  terrain: readonly SpatialTerrainSurface[],
) {
  const floats: number[] = [],
    integers: number[] = [];
  terrain.forEach((s, i) => {
    floats.push(
      s.x,
      s.y,
      s.width,
      s.depth,
      s.baseElevation!,
      s.elevation,
      s.endElevation!,
      ...s.color!,
    );
    integers.push(
      i + 1,
      s.floorId!,
      s.textureId ?? 16777215,
      kinds[s.kind!] * 2 + Number(s.walkable) + (s.render === false ? 16 : 0) + (s.rampAxis === "x" ? 32 : 0),
    );
  });
  return {
    values: Float32Array.from(floats),
    metadata: Uint32Array.from(integers),
  };
}
/** Cold authoring preparation; numeric IDs never replace names in the saved document. */
export function resolveSpatialNormalTextures(spec: DataSceneSpatialSpec, textureId: (name: string) => number): DataSceneSpatialSpec {
  const billboards: Record<string, SpatialBillboardSpec> = Object.create(null);
  for (const [id, billboard] of Object.entries(spec.billboards)) {
    const { normalTexture, ...rest } = billboard;
    if (normalTexture === undefined) { billboards[id] = { ...rest }; continue; }
    const path = `spatial.billboards.${id}.normalTexture`;
    let value: number;
    try { value = textureId(normalTexture); }
    catch { throw sceneCompositionDiagnosticError(path, `texture '${normalTexture}' is not registered`); }
    billboards[id] = { ...rest, normalTextureId: integer(value, path, 16777214) };
  }
  return { ...spec, billboards };
}

export function createSpatialApi(
  rust: Engine,
  requireAlive: () => void,
  viewport: () => { width: number; height: number },
  textureId: (name: string) => number = () => { throw new Error("Texture resolver unavailable"); },
): FerrumSpatialApi {
  let surfaceIds: readonly string[] = [];
  const api: FerrumSpatialApi = {
    registerDataSceneSpatialModel(id, asset) {
      requireAlive();
      const resource=spatialModelResource(asset);
      if (!id || !resource || typeof rust.configure_spatial_scene_models!=="function") return false;
      const registry = spatialModelRegistry(rust), previous = registry.get(id);
      if (previous) return previous.handle === asset;
      if (registry.size >= 16 || [...registry.values()].reduce((n,r)=>n+r.handle.byteLength,asset.byteLength)>128*1024*1024) return false;
      let nativeId = 1; while ([...registry.values()].some(a=>a.id===nativeId)) nativeId++;
      registry.set(id,{id:nativeId,asset:resource,handle:asset}); return true;
    },
    releaseDataSceneSpatialModel(id) {
      requireAlive();
      const registry=spatialModelRegistry(rust), entry=registry.get(id);
      return !!entry && !rust.spatial_model_asset_in_use(entry.id) && registry.delete(id);
    },
    dataSceneSpatialModelDrawSnapshot(handle) {
      requireAlive();
      const id=uint32Number(handle.entityId,"model.entityId"),generation=uint32Number(handle.entityGeneration,"model.entityGeneration");
      if (typeof rust.spatial_model_draw_snapshot !== "function") return;
      const words=rust.spatial_model_draw_snapshot(id,generation);
      if (!words.length) return;
      if (words.length!==20 || words[3]!==0 || words[2]>255) throw new Error("Invalid spatial model draw snapshot");
      const asset=[...spatialModelRegistry(rust).values()].find(entry=>entry.id===words[0])?.handle;
      if (!asset) throw new Error("Unregistered spatial model draw snapshot");
      const transform=new Float32Array(words.buffer,words.byteOffset+16,16);
      if (!transform.every(Number.isFinite)) throw new Error("Invalid spatial model draw snapshot");
      return {asset,transform,cameraVisible:!!(words[2]&1)};
    },
    preflightDataSceneSpatialModels(input, origins = {}) {
      requireAlive();
      const spec=resolveDataSceneSpatialSpec(input), registry=spatialModelRegistry(rust);
      if(Object.keys(spec.lightBindings??{}).length&&typeof rust.configure_spatial_light_bindings!=="function")return false;
      if(Object.keys(spec.attachments??{}).length&&typeof rust.configure_spatial_attachments!=='function')return false;
      if((spec.modelChunks!==undefined||Object.values(spec.models??{}).some(m=>m.lods!==undefined))&&typeof rust.configure_spatial_model_streaming!=='function')return false;
      let primitives=0,triangles=0;
      const styles:number[]=[],points:number[]=[];
      for(const [id,m] of Object.entries(spec.models ?? {})) {
        const entry=registry.get(m.asset);
        if(!entry || entry.asset.contentId!==m.contentId || typeof rust.configure_spatial_scene_models!=="function") return false;
        const levels=[m,...(m.lods??[])].map(l=>registry.get(l.asset));
        if(levels.some((l,i)=>!l||l.asset.contentId!==[m,...(m.lods??[])][i].contentId))return false;
        primitives+=Math.max(...levels.map(l=>l!.asset.primitives.length));
        triangles+=Math.max(...levels.map(l=>l!.asset.primitives.reduce((n,p)=>n+p.indices.length/3,0)));
        styles.push(m.elevation!,m.yawDegrees!*Math.PI/180,m.scale!,...modelUnionBounds(levels.map(l=>l!.asset.bounds)));
        const at=(Object.prototype.hasOwnProperty.call(origins,id) ? origins[id] : undefined) ?? {x:0,y:0,elevation:0};points.push(at.x,at.y,at.elevation);
      }
      return primitives<=4096 && triangles<=262144 && ((styles.length<=64*9 && primitives<=64) || (typeof rust.spatial_model_batch_abi_version==="function" && rust.spatial_model_batch_abi_version()===1)) && (!styles.length || (typeof rust.preflight_spatial_model_poses==="function" && rust.preflight_spatial_model_poses(Float32Array.from(styles),Float32Array.from(points))));
    },
    setDataSceneSpatialEnvironment(options) {
      requireAlive();
      const values = compileSpatialEnvironment(options);
      return (
        typeof rust.configure_spatial_environment === "function" &&
        rust.configure_spatial_environment(values)
      );
    },
    moveDataSceneSpatialActorTo(input) {
      requireAlive();
      const path = "spatial.move";
      const o = record(input, path);
      keys(
        o,
        [
          "x",
          "y",
          "floorId",
          "speed",
          "cellSize",
          "arrivalRadius",
          "cancelOnInput",
        ],
        path,
      );
      const x = num(o.x, `${path}.x`);
      const y = num(o.y, `${path}.y`);
      const floor = integer(o.floorId, `${path}.floorId`, 65535);
      const speed = num(o.speed, `${path}.speed`, 0);
      const cell = num(
        o.cellSize === undefined ? 8 : o.cellSize,
        `${path}.cellSize`,
        0,
      );
      const radius = num(
        o.arrivalRadius === undefined ? 0.5 : o.arrivalRadius,
        `${path}.arrivalRadius`,
        0,
      );
      const cancel = bool(
        o.cancelOnInput === undefined ? true : o.cancelOnInput,
        `${path}.cancelOnInput`,
      );
      if (Math.fround(speed) <= 0 || Math.fround(cell) <= 0)
        throw sceneCompositionDiagnosticError(
          path,
          "speed and cellSize must be positive f32 values",
        );
      return (
        typeof rust.move_data_scene_spatial_actor_to === "function" &&
        rust.move_data_scene_spatial_actor_to(
          x,
          y,
          floor,
          speed,
          cell,
          radius,
          cancel,
        )
      );
    },
    cancelDataSceneSpatialMove() {
      requireAlive();
      return (
        typeof rust.cancel_data_scene_spatial_move === "function" &&
        rust.cancel_data_scene_spatial_move()
      );
    },
    dataSceneSpatialMoveStatus() {
      requireAlive();
      const value =
        typeof rust.data_scene_spatial_move_status === "function"
          ? rust.data_scene_spatial_move_status()
          : -1;
      return (["idle", "moving", "arrived", "blocked", "cancelled"] as const)[
        value
      ];
    },
    dataSceneSpatialMoveStats() {
      requireAlive();
      if (typeof rust.data_scene_spatial_move_stats !== "function")
        return undefined;
      const v = rust.data_scene_spatial_move_stats();
      if (v.length !== 6) return undefined;
      const stats: SpatialMoveStats = {
        searchNodeCount: v[0],
        edgeProbeCount: v[1],
        waypointCount: v[2],
        remainingWaypointCount: v[3],
        searchCount: v[4],
        probeWorkUnits: v[5],
      };
      if (typeof rust.data_scene_spatial_move_diagnostics === "function") {
        const d = rust.data_scene_spatial_move_diagnostics();
        const status = ([
          "notRequested",
          "accepted",
          "invalidRequest",
          "unsupportedActor",
          "noPath",
          "nodeBudgetExceeded",
          "probeBudgetExceeded",
          "workBudgetExceeded",
          "frameBudgetExceeded",
        ] as const)[d[1]];
        if (d.length === 5 && d[0] === 1 && status !== undefined) {
          stats.lastRequest = {
            status,
            count: d[2],
            collisionProxyCount: d[3],
            preparationWorkUnits: d[4],
          };
        }
      }
      return stats;
    },
    configureDataSceneSpatial(input, handles) {
      requireAlive();
      const spec = resolveSpatialNormalTextures(resolveDataSceneSpatialSpec(input), textureId);
      const lightMetadata:number[]=[], lightOffsets:number[]=[];
      for(const [id,indices] of Object.entries(spec.lightBindings??{})) {
        const h=handles[id];if(!h)throw sceneCompositionDiagnosticError(`spatial.lightBindings.${id}`,"must reference an applied instance");
        const entityId=uint32Number(h.entityId,`spatial.lightBindings.${id}.entityId`), generation=uint32Number(h.entityGeneration,`spatial.lightBindings.${id}.entityGeneration`);
        // Cold validation must precede scene replacement. A stale nonvisual target
        // is not covered by billboard/model preflight and would otherwise fail after commit.
        if(typeof rust.gameplay_entity_exists!=="function" || !rust.gameplay_entity_exists(entityId,generation))return false;
        for(const index of indices) {lightMetadata.push(index,entityId,generation);lightOffsets.push(spec.models?.[id]?.elevation??spec.billboards[id]?.elevation??0);}
      }
      if(lightMetadata.length && typeof rust.configure_spatial_light_bindings!=="function")return false;
      if(Object.keys(spec.attachments??{}).length && typeof rust.configure_spatial_attachments!=='function')return false;
      if (spec.terrain.some(s => s.rampAxis === "x") &&
          (typeof rust.spatial_ramp_axis_abi_version !== "function" || rust.spatial_ramp_axis_abi_version() !== 1)) return false;
      if (
        spec.terrain.some(s => s.render === false) &&
        (typeof rust.spatial_surface_proxy_abi_version !== "function" ||
          rust.spatial_surface_proxy_abi_version() !== 1)
      ) return false;
      if (!api.preflightDataSceneSpatialModels(spec)) return false;
      const hs: number[] = [],
        vs: number[] = [];
      for (const [id, b] of Object.entries(spec.billboards)) {
        const h = handles[id];
        if (!h)
          throw sceneCompositionDiagnosticError(
            `spatial.billboards.${id}`,
            "must reference an applied instance",
          );
        hs.push(h.entityId, h.entityGeneration);
        vs.push(b.unitsPerPixel!, b.alphaCutoff!, b.elevation!);
      }
      const terrain = compileSpatialTerrain(spec.terrain);
      const size = viewport();
      const camera = spatialCameraValues(spec.camera, size.width, size.height);
      const actor = spec.actor;
      const actorHandle = actor ? handles[actor.instanceId] : undefined;
      if (actor && !actorHandle)
        throw sceneCompositionDiagnosticError(
          "spatial.actor.instanceId",
          "must reference an applied entity",
        );
      const args = [
        camera,
        terrain.values,
        terrain.metadata,
        Uint32Array.from(hs),
        Float32Array.from(vs),
        actorHandle
          ? Uint32Array.from([
              actorHandle.entityId,
              actorHandle.entityGeneration,
            ])
          : new Uint32Array(),
        actor
          ? Float32Array.from([
              actor.speed,
              actor.maxStepHeight!,
              actor.maxDropHeight!,
            ])
          : new Float32Array(),
      ] as const;
      const connections = spec.connections ?? [];
      const materialFlags = (o: { castShadow?: boolean; receiveShadow?: boolean }) => (o.castShadow === false ? 0 : 1) | (o.receiveShadow === false ? 0 : 2);
      const materialOptions = spec.terrain.some(t => t.castShadow !== undefined || t.receiveShadow !== undefined) || Object.values(spec.billboards).some(b => b.normalTextureId !== undefined || b.castShadow !== undefined || b.receiveShadow !== undefined);
      const connectionValues = Uint32Array.from(connections.flatMap(c => [spec.terrain.findIndex(s => s.id === c.from) + 1, spec.terrain.findIndex(s => s.id === c.to) + 1]));
      const modelMetadata:number[]=[],modelStyles:number[]=[];
      for(const [id,m] of Object.entries(spec.models ?? {})) {
        const handle=handles[id], entry=spatialModelRegistry(rust).get(m.asset)!;
        if(!handle) throw sceneCompositionDiagnosticError(`spatial.models.${id}`,"must reference an applied instance");
        modelMetadata.push(handle.entityId,handle.entityGeneration,entry.id,materialFlags(m),entry.asset.primitives.length,entry.asset.primitives.reduce((n,p)=>n+p.indices.length/3,0));
        modelStyles.push(m.elevation!,m.yawDegrees!*Math.PI/180,m.scale!,...modelUnionBounds([m,...(m.lods??[])].map(l=>spatialModelRegistry(rust).get(l.asset)!.asset.bounds)));
      }
      const attachmentMetadata:number[]=[],attachmentValues:number[]=[];
      for(const[id,a]of Object.entries(spec.attachments??{})){const child=handles[id],parent=handles[a.parent];if(!child||!parent)throw sceneCompositionDiagnosticError(`spatial.attachments.${id}`,'must reference applied handles');attachmentMetadata.push(child.entityId,child.entityGeneration,parent.entityId,parent.entityGeneration,a.inheritFloor?1:0);attachmentValues.push(a.x!,a.y!,a.elevation!,a.yawDegrees!*Math.PI/180);}
      if(attachmentMetadata.length&&(typeof rust.preflight_spatial_attachments!=='function'||!rust.preflight_spatial_attachments(Uint32Array.from(attachmentMetadata),Float32Array.from(attachmentValues),Uint32Array.from(modelMetadata),Float32Array.from(modelStyles))))return false;
      const accepted = modelMetadata.length
        ? rust.configure_spatial_scene_models(...args, connectionValues, compileSpatialEnvironment(spec.environment ?? null),
            Uint32Array.from(spec.terrain.map(materialFlags)),Uint32Array.from(Object.values(spec.billboards).flatMap(b=>[b.normalTextureId ?? 16777215,materialFlags(b)])),
            Uint32Array.from(modelMetadata),Float32Array.from(modelStyles))
        : materialOptions
        ? typeof rust.configure_spatial_scene_materials === "function" && rust.configure_spatial_scene_materials(...args, connectionValues,
            compileSpatialEnvironment(spec.environment ?? null), Uint32Array.from(spec.terrain.map(materialFlags)),
            Uint32Array.from(Object.values(spec.billboards).flatMap(b => [b.normalTextureId ?? 16777215, materialFlags(b)])))
        : spec.environment !== undefined
          ? typeof rust.configure_spatial_scene_environment === "function" &&
            rust.configure_spatial_scene_environment(
              ...args,
              Uint32Array.from(
                connections.flatMap((c) => [
                  spec.terrain.findIndex((s) => s.id === c.from) + 1,
                  spec.terrain.findIndex((s) => s.id === c.to) + 1,
                ]),
              ),
              compileSpatialEnvironment(spec.environment),
            )
          : connections.length
            ? typeof rust.configure_spatial_scene_connected === "function" &&
              rust.configure_spatial_scene_connected(
                ...args,
                Uint32Array.from(
                  connections.flatMap((c) => [
                    spec.terrain.findIndex((s) => s.id === c.from) + 1,
                    spec.terrain.findIndex((s) => s.id === c.to) + 1,
                  ]),
                ),
              )
            : rust.configure_spatial_scene(...args);
      if (!accepted) return false;
      if(lightMetadata.length && !rust.configure_spatial_light_bindings(Uint32Array.from(lightMetadata),Float32Array.from(lightOffsets)))return false;
      if(Object.keys(spec.attachments??{}).length){
        if(!rust.configure_spatial_attachments(Uint32Array.from(attachmentMetadata),Float32Array.from(attachmentValues)))return false;
      }
      if(spec.modelChunks!==undefined||Object.values(spec.models??{}).some(m=>m.lods!==undefined)){
        const chunks=Object.entries(spec.modelChunks??{}),metadata:number[]=[],distances:number[]=[];
        for(const[id,m]of Object.entries(spec.models??{})){const h=handles[id];for(const l of [{...m,minDistance:0},...(m.lods??[])]){const e=spatialModelRegistry(rust).get(l.asset)!;metadata.push(h.entityId,h.entityGeneration,e.id,e.asset.primitives.length,e.asset.primitives.reduce((n,p)=>n+p.indices.length/3,0),m.chunk===undefined?0:chunks.findIndex(([id])=>id===m.chunk)+1);distances.push(l.minDistance);}}
        if(!rust.configure_spatial_model_streaming(Float32Array.from(chunks.flatMap(([,c])=>[c.min.x,c.min.elevation,-c.max.y,c.max.x,c.max.elevation,-c.min.y,c.loadDistance,c.unloadDistance])),Uint32Array.from(metadata),Float32Array.from(distances)))return false;
      }
      surfaceIds = spec.terrain.map((s) => s.id);
      return true;
    },
    setDataSceneSpatialCamera(input, size) {
      requireAlive();
      return rust.configure_spatial_camera(
        spatialCameraValues(
          resolveSpatialCameraSpec(input),
          size.width,
          size.height,
        ),
      );
    },
    setDataSceneSpatialDebug(input) {
      requireAlive();
      let flags = 0;
      if (input !== null) {
        const o = record(input, "spatial.debug");
        keys(
          o,
          [
            "terrain",
            "billboards",
            "heightSpans",
            "colliders",
            "contacts",
            "floorIds",
            "depthTest",
          ],
          "spatial.debug",
        );
        for (const [key, bit] of [
          ["terrain", 1],
          ["billboards", 2],
          ["heightSpans", 4],
          ["colliders", 16],
          ["contacts", 32],
          ["floorIds", 64],
        ] as const)
          if (o[key] !== undefined && bool(o[key], `spatial.debug.${key}`))
            flags |= bit;
        const depth =
          o.depthTest === undefined
            ? true
            : bool(o.depthTest, "spatial.debug.depthTest");
        if (flags && depth) flags |= 8;
      }
      return (
        typeof rust.configure_spatial_debug === "function" &&
        rust.configure_spatial_debug(flags)
      );
    },
    setDataSceneSpatialPreviewFilter(options) {
      requireAlive();
      const entities=options?.hiddenEntities ?? [], surfaces=options?.hiddenSurfaces ?? [];
      if(entities.length>16384 || surfaces.length>256) throw new Error("Spatial preview filter exceeds budget");
      const keys=new Uint32Array(entities.length*2);
      entities.forEach((handle,index)=>{keys[index*2]=uint32Number(handle.entityId,"preview.entityId");keys[index*2+1]=uint32Number(handle.entityGeneration,"preview.entityGeneration");});
      const ids=new Uint32Array(surfaces.map(id=>{const index=surfaceIds.indexOf(id);if(index<0)throw new Error("Unknown preview surface");return index+1;}));
      return typeof rust.set_spatial_preview_filter === "function" && rust.set_spatial_preview_filter(keys,ids);
    },
    clearDataSceneSpatial() {
      requireAlive();
      rust.clear_spatial_scene();
      surfaceIds = [];
    },
    moveDataSceneSpatialBody(h, dx, dy, o = {}) {
      requireAlive();
      return rust.move_spatial_body(
        h.entityId,
        h.entityGeneration,
        num(dx, "spatial.move.dx"),
        num(dy, "spatial.move.dy"),
        num(o.maxStepHeight ?? 32, "spatial.move.maxStepHeight", 0),
        num(o.maxDropHeight ?? 32, "spatial.move.maxDropHeight", 0),
      );
    },
    pickDataSceneSpatialSurface(x, y, frame) {
      requireAlive();
      const v = rust.pick_spatial_surface(
        num(x, "spatial.pick.x", -1, 1),
        num(y, "spatial.pick.y", -1, 1),
        frame.camera,
        frame.terrainRevision,
      );
      if (v.length === 0) return undefined;
      const id = surfaceIds[v[0] - 1];
      if (id === undefined)
        throw new Error("Spatial surface identity mismatch");
      return {
        surfaceId: id,
        floorId: v[1],
        x: v[2],
        y: v[3],
        elevation: v[4],
        normal: [v[5], v[6], v[7]],
        distance: v[8],
        walkable: v[9] === 1,
      };
    },
  };
  return api;
}

/** Browser coordinate adapter; camera projection and terrain identity come from the displayed frame. */
function spatialDisplayRect(canvas: HTMLCanvasElement, frame: SpatialRenderBufferView) {
  const rect = canvas.getBoundingClientRect(), p = frame.presentation;
  return p && p[4] > 0 ? { left: rect.left + rect.width * p[0], top: rect.top + rect.height * p[1], width: rect.width * p[2], height: rect.height * p[3] } : rect;
}
export function createDataSceneSpatialView(
  engine: FerrumSpatialApi,
  canvas: HTMLCanvasElement,
) {
  return {
    project(point: SpatialPoint, frame: SpatialRenderBufferView) {
      const m = frame.camera,
        p = [point.x, point.elevation, -point.y, 1];
      const c = Array.from({ length: 4 }, (_, row) =>
        p.reduce((sum, v, column) => sum + m[column * 4 + row] * v, 0),
      );
      if (c[3] <= 0) return undefined;
      const rect = spatialDisplayRect(canvas, frame);
      return {
        x: rect.left + ((c[0] / c[3] + 1) * rect.width) / 2,
        y: rect.top + ((1 - c[1] / c[3]) * rect.height) / 2,
        depth: c[2] / c[3],
        visible:
          c[2] >= -c[3] &&
          c[2] <= c[3] &&
          Math.abs(c[0]) <= c[3] &&
          Math.abs(c[1]) <= c[3],
      };
    },
    pick(client: { x: number; y: number }, frame: SpatialRenderBufferView) {
      const rect = spatialDisplayRect(canvas, frame);
      if (rect.width <= 0 || rect.height <= 0)
        throw new Error("Spatial picking requires a visible canvas");
      const x = ((client.x - rect.left) / rect.width) * 2 - 1,
        y = 1 - ((client.y - rect.top) / rect.height) * 2;
      if (Math.abs(x) > 1 || Math.abs(y) > 1) return undefined;
      return engine.pickDataSceneSpatialSurface(x, y, frame);
    },
  };
}

/** Conservative common bounds keep all LOD silhouettes and shadow casters in native visibility tests. */
function modelUnionBounds(bounds:readonly (readonly number[])[]):number[]{return Array.from({length:6},(_,i)=>(i<3?Math.min:Math.max)(...bounds.map(b=>b[i])));}
