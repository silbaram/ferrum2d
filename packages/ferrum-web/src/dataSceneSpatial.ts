import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import type { GameplayEntityHandle } from "./gameplayAuthoring.js";
import type { DataSceneMoveStatus } from "./dataSceneMovement.js";
import type { Engine } from "../pkg/ferrum_core.js";
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
  id: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  elevation: number;
  endElevation?: number;
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
  /** Conservative native collision/sort work estimate; not milliseconds. */
  probeWorkUnits: number;
}
export interface DataSceneSpatialSpec {
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
export interface FerrumSpatialApi {
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
export function resolveDataSceneSpatialSpec(
  v: unknown,
  path = "spatial",
): DataSceneSpatialSpec {
  const o = record(v, path);
  keys(
    o,
    ["camera", "terrain", "billboards", "actor", "connections", "environment"],
    path,
  );
  const camera = resolveSpatialCameraSpec(o.camera, `${path}.camera`);
  if (!Array.isArray(o.terrain) || o.terrain.length > 256)
    throw sceneCompositionDiagnosticError(
      `${path}.terrain`,
      "must be an array with at most 256 surfaces",
    );
  const ids = new Set<string>();
  const terrain = Array.from(
    o.terrain,
    (v: unknown, i: number): SpatialTerrainSurface => {
      const at = `${path}.terrain.${i}`,
        s = record(v, at);
      keys(
        s,
        [
          "id",
          "x",
          "y",
          "width",
          "depth",
          "elevation",
          "endElevation",
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
      const x = num(s.x, `${at}.x`),
        y = num(s.y, `${at}.y`),
        width = positive(s.width, `${at}.width`),
        depth = positive(s.depth, `${at}.depth`);
      num(x + width, `${at}.width`);
      num(y + depth, `${at}.depth`);
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
        baseElevation,
        kind: kind as SpatialTerrainSurface["kind"],
        floorId: integer(s.floorId ?? 0, `${at}.floorId`, 65535),
        color: rgba,
        walkable: bool(s.walkable ?? true, `${at}.walkable`),
        ...(s.castShadow === undefined ? {} : { castShadow: bool(s.castShadow, `${at}.castShadow`) }),
        ...(s.receiveShadow === undefined ? {} : { receiveShadow: bool(s.receiveShadow, `${at}.receiveShadow`) }),
        ...(s.textureId === undefined
          ? {}
          : { textureId: integer(s.textureId, `${at}.textureId`, 16777214) }),
      };
    },
  );
  for (let i = 0; i < terrain.length; i++)
    for (let j = 0; j < i; j++) {
      const a = terrain[i],
        b = terrain[j];
      if (
        a.floorId === b.floorId &&
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.depth &&
        a.y + a.depth > b.y
      )
        throw sceneCompositionDiagnosticError(
          `${path}.terrain.${i}`,
          "surfaces on the same floor must not overlap",
        );
    }
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
    keys(b, ["unitsPerPixel", "alphaCutoff", "elevation", "normalTextureId", "castShadow", "receiveShadow"], at);
    billboards[id] = {
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
  if ((environment?.lighting?.shadows || environment?.lighting?.directional?.shadows) && Object.keys(billboards).length > 1024)
    throw sceneCompositionDiagnosticError(
      `${path}.billboards`,
      "shadow casting supports at most 1024 authored billboards",
    );
  return {
    camera,
    terrain,
    ...(environment === undefined ? {} : { environment }),
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
      kinds[s.kind!] * 2 + Number(s.walkable),
    );
  });
  return {
    values: Float32Array.from(floats),
    metadata: Uint32Array.from(integers),
  };
}
export function createSpatialApi(
  rust: Engine,
  requireAlive: () => void,
  viewport: () => { width: number; height: number },
): FerrumSpatialApi {
  let surfaceIds: readonly string[] = [];
  return {
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
      return {
        searchNodeCount: v[0],
        edgeProbeCount: v[1],
        waypointCount: v[2],
        remainingWaypointCount: v[3],
        searchCount: v[4],
        probeWorkUnits: v[5],
      };
    },
    configureDataSceneSpatial(input, handles) {
      requireAlive();
      const spec = resolveDataSceneSpatialSpec(input);
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
      const accepted = materialOptions
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
