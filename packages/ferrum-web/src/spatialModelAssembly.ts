import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import { resolveSpatialTerrainSurfaces, type SpatialModelInstanceSpec, type SpatialTerrainSurface, type SpatialSurfaceConnection } from "./dataSceneSpatial.js";
import { instantiateSceneFragment, resolveSceneCompositionSpec, type SceneCompositionFragmentInstanceSpec } from "./sceneComposition.js";
import { resolveSceneAuthoringDocument, type SceneAuthoringDocumentSpec } from "./sceneAuthoringDocument.js";

/** A static AABB in model-local ground XY, with elevation measured upward. */
export interface SpatialModelColliderProxy {
  id: string;
  x: number;
  y: number;
  halfWidth: number;
  halfDepth: number;
  elevation: number;
  height: number;
  /** Global floor ID, unchanged by placement. Default 0. */
  floorId?: number;
}

/** Cold authoring input. Imported GLB node transforms are already baked into the asset. */
export interface SpatialModelAssemblySpec {
  id: string;
  x: number;
  y: number;
  elevation?: number;
  /** Opt in to native root motion and derived static child model/collider poses. */
  motion?: "kinematic";
  floorId?: number;
  /** Ground yaw in degrees. Assemblies with walk surfaces require cardinal world yaw. */
  yawDegrees?: number;
  /** Positive uniform scale, shared by model, collider dimensions and surface heights. */
  scale?: number;
  model: Omit<SpatialModelInstanceSpec, "elevation" | "yawDegrees" | "scale">;
  colliders?: readonly SpatialModelColliderProxy[];
  /** Local rectangular walk surfaces. Generated surfaces always have render:false. */
  terrain?: readonly SpatialTerrainSurface[];
  /** References local terrain IDs; placement namespaces both endpoints. */
  connections?: readonly SpatialSurfaceConnection[];
  /** Static child placements relative to this assembly; compiled to ordinary world-space scene data. */
  children?: readonly SpatialModelAssemblySpec[];
}

interface AssemblyPlacement {
  moving?: boolean;
  id: string;
  x: number;
  y: number;
  elevation: number;
  yawDegrees: number;
  scale: number;
}

/**
 * Append a static assembly to the initial fragment without mutating the input document.
 * Returns ordinary serializable authoring data with world-unit proxies and stable IDs.
 * Static assemblies compile once; motion:kinematic binds children to the native root pose.
 * Apply the returned document with the default composition transform/initial fragment.
 */
export function addSpatialModelAssembly(
  document: SceneAuthoringDocumentSpec,
  assembly: SpatialModelAssemblySpec,
): SceneAuthoringDocumentSpec {
  const result = appendAssembly(document, assembly, "spatialModelAssembly", [], { count: 0 });
  // Validate the complete hierarchy: a child's terrain can provide the actor's support.
  resolveSceneAuthoringDocument(result, { validateBindings: true, validateComponents: true });
  return result;
}

function appendAssembly(
  document: SceneAuthoringDocumentSpec,
  assembly: SpatialModelAssemblySpec,
  path: string,
  ancestors: readonly SpatialModelAssemblySpec[],
  budget: { count: number },
  parent?: AssemblyPlacement,
): SceneAuthoringDocumentSpec {
  const fail = (at: string, message: string): never => { throw sceneCompositionDiagnosticError(`${path}.${at}`, message); };
  const fields = (value: unknown, allowed: readonly string[], at: string): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(at, "must be an object");
    for (const key of Object.keys(value as object)) if (!allowed.includes(key)) fail(`${at}.${key}`, "unsupported field");
    return value as Record<string, unknown>;
  };
  fields(assembly, ["id", "x", "y", "elevation", "yawDegrees", "scale", "model", "colliders", "terrain", "connections", "children", "motion", "floorId"], "input");
  if(assembly.motion!==undefined&&assembly.motion!=='kinematic')fail('motion','must be kinematic');
  const moving=assembly.motion==='kinematic'||parent?.moving===true;
  if(moving&&(assembly.terrain?.length||assembly.connections?.length))fail('terrain','moving terrain/connection proxies are unsupported');
  if (ancestors.includes(assembly)) fail("children", "cyclic assembly hierarchy");
  if (ancestors.length >= 8) fail("children", "maximum assembly depth is 8 including the root");
  if (++budget.count > 64) fail("children", "maximum 64 assemblies per call including the root");
  const children = assembly.children === undefined ? [] : assembly.children;
  if (!Array.isArray(children) || children.length > 63) fail("children", "must be an array with at most 63 children");
  const number = (v: unknown, at: string, min = -Infinity, max = Infinity): number => {
    if (typeof v !== "number" || !Number.isFinite(Math.fround(v)) || v < min || v > max) fail(at, "must be a finite f32 in range");
    return v as number;
  };
  const positive = (v: unknown, at: string): number => {
    const n = number(v, at);
    if (Math.fround(n) <= 0) fail(at, "must remain positive in f32");
    return Math.fround(n);
  };
  const id = (v: unknown, at: string): string => {
    if (typeof v !== "string" || v.length === 0 || v.length > 128) fail(at, "must be a nonempty ID of at most 128 characters");
    return v as string;
  };
  const localId = id(assembly.id, "id");
  const root = id(parent ? `${parent.id}/children/${localId}` : localId, "id"), prefab = `${root}/prefab`;
  const localX = Math.fround(number(assembly.x, "x")), localY = Math.fround(number(assembly.y, "y"));
  const localElevation = Math.fround(number(assembly.elevation ?? 0, "elevation"));
  const localScale = number(assembly.scale ?? 1, "scale", 0.0001, 10000);
  const localYaw = number(assembly.yawDegrees ?? 0, "yawDegrees", -360, 360);
  const basis=(degrees:number):number[]=>degrees%90===0?[[1,0],[0,1],[-1,0],[0,-1]][((degrees/90)%4+4)%4]:[Math.cos(degrees*Math.PI/180),Math.sin(degrees*Math.PI/180)];
  const [pc, ps] = basis(parent?.yawDegrees??0);
  const parentFactor = Math.fround(parent?.scale ?? 1);
  const x = parent ? Math.fround(number(parent.x + (pc * localX - ps * localY) * parentFactor, "transformed.x")) : localX;
  const y = parent ? Math.fround(number(parent.y + (ps * localX + pc * localY) * parentFactor, "transformed.y")) : localY;
  const elevation = parent ? Math.fround(number(parent.elevation + localElevation * parentFactor, "transformed.elevation")) : localElevation;
  const scale = number((parent?.scale ?? 1) * localScale, "transformed.scale", 0.0001, 10000);
  const factor = Math.fround(scale);
  const yaw = parent ? ((parent.yawDegrees + localYaw) % 360 + 360) % 360 : localYaw;
  const turn = ((yaw / 90) % 4 + 4) % 4;
  const [c, s] = basis(yaw);
  if(yaw%90!==0 && assembly.terrain?.length)fail('yawDegrees','walk surfaces require a multiple of 90 degrees');
  const rotate = (px: number, py: number): [number, number] => [c * px - s * py, s * px + c * py];
  const point = (px: number, py: number): [number, number] => {
    const [rx, ry] = rotate(px, py);
    return [Math.fround(number(x + rx * factor, "transformed.x")), Math.fround(number(y + ry * factor, "transformed.y"))];
  };
  const height = (h: number): number => Math.fround(number(elevation + h * factor, "transformed.elevation"));
  const colliders = assembly.colliders === undefined ? [] : assembly.colliders;
  if (!Array.isArray(colliders) || colliders.length > 256) fail("colliders", "must be an array with at most 256 proxies");
  fields(assembly.model, ["asset", "contentId", "castShadow", "receiveShadow", "chunk", "lods"], "model");
  const composition = resolveSceneCompositionSpec(document.sceneComposition);
  if (!document.spatial) fail("document.spatial", "requires a spatial authoring document");
  const spatial = document.spatial!;
  const instances = instantiateSceneFragment(composition);
  const ids = new Set(instances.map(i => i.id));
  if (ids.has(root) || Object.prototype.hasOwnProperty.call(composition.prefabs, prefab)) fail("id", "assembly instance or prefab ID already exists");
  const transparent = { kind: "sprite" as const, texture: 0, width: 1, height: 1, color: "#ffffff00" };
  const rootFloor=number(assembly.floorId??0,'floorId',0,65535);if(!Number.isInteger(rootFloor))fail('floorId','must be an integer');
  const generated: SceneCompositionFragmentInstanceSpec[] = [{ id: root, prefab, x, y, props: { components: { visual: transparent, collider: moving?{type:'aabb',halfWidth:1,halfHeight:1,isTrigger:true}:"none", layer: "wall",...(moving?{body:{type:parent?.moving?'static':'kinematic',heightSpan:{floorId:rootFloor,elevation,height:1}}}:{}) } } }];
  const attachments={...spatial.attachments};
  if(parent?.moving)attachments[root]={parent:parent.id,x:Math.fround(x-parent.x),y:Math.fround(y-parent.y),elevation:Math.fround(elevation-parent.elevation),yawDegrees:0,inheritFloor:assembly.floorId===undefined};
  const localColliderIds = new Set<string>();
  for (const [i, raw] of colliders.entries()) {
    const at = `colliders.${i}`;
    fields(raw, ["id", "x", "y", "halfWidth", "halfDepth", "elevation", "height", "floorId"], at);
    const local = id(raw.id, `${at}.id`), instanceId = `${root}/colliders/${local}`;
    if (localColliderIds.has(local) || ids.has(instanceId)) fail(`${at}.id`, "duplicate collider instance ID");
    localColliderIds.add(local);
    const [px, py] = point(number(raw.x, `${at}.x`), number(raw.y, `${at}.y`));
    const hw = positive(raw.halfWidth, `${at}.halfWidth`);
    const hd = positive(raw.halfDepth, `${at}.halfDepth`);
    const h = positive(raw.height, `${at}.height`);
    const floorId = number(raw.floorId ?? 0, `${at}.floorId`, 0, 65535);
    if (!Number.isInteger(floorId)) fail(`${at}.floorId`, "must be an integer");
    const oriented=moving||yaw%90!==0;
    const halfWidth = positive((!oriented&&turn % 2 ? hd : hw) * factor, `${at}.halfWidth`);
    const halfDepth = positive((!oriented&&turn % 2 ? hw : hd) * factor, `${at}.halfDepth`);
    const boundX=oriented?Math.abs(c)*halfWidth+Math.abs(s)*halfDepth:halfWidth;
    const boundY=oriented?Math.abs(s)*halfWidth+Math.abs(c)*halfDepth:halfDepth;
    const bottom = height(number(raw.elevation, `${at}.elevation`));
    const bodyHeight = positive(h * factor, `${at}.height`);
    const interval = (min: number, max: number): boolean => Number.isFinite(min) && Number.isFinite(max)
      && Number.isFinite(Math.fround(max - min)) && max > min;
    if (!interval(Math.fround(px - boundX), Math.fround(px + boundX))
        || !interval(Math.fround(py - boundY), Math.fround(py + boundY))
        || !interval(bottom, Math.fround(bottom + bodyHeight)))
      fail(at, "requires positive finite f32 world AABB bounds and height span");
    generated.push({ id: instanceId, prefab, x: px, y: py, props: { components: {
      visual: transparent, layer: "wall",
      collider: oriented?{type:'orientedBox',halfWidth,halfHeight:halfDepth,rotationRadians:yaw*Math.PI/180,isTrigger:false}:{ type: "aabb", halfWidth, halfHeight: halfDepth, isTrigger: false },
      body: { type: "static", heightSpan: { floorId, elevation: bottom, height: bodyHeight } },
    } } });
    if(moving)attachments[instanceId]={parent:root,x:Math.fround(px-x),y:Math.fround(py-y),elevation:Math.fround(bottom-elevation),yawDegrees:0,inheritFloor:raw.floorId===undefined};
  }
  const surfaces = assembly.terrain === undefined ? [] : assembly.terrain;
  if (!Array.isArray(surfaces) || surfaces.length > 256) fail("terrain", "must be an array with at most 256 surfaces");
  const localTerrain = resolveSpatialTerrainSurfaces(surfaces.map((surface, i) => {
    if (!surface || (surface.render !== undefined && surface.render !== false)) fail(`terrain.${i}.render`, "assembly surfaces must be invisible proxies");
    id(surface.id, `terrain.${i}.id`);
    return { ...surface, render: false };
  }), `${path}.terrain`, "local");
  const sourceConnections = assembly.connections === undefined ? [] : assembly.connections;
  if (!Array.isArray(sourceConnections) || sourceConnections.length > 256) fail("connections", "must be an array with at most 256 links");
  const surfaceId = (localId: string): string => `${root}/terrain/${localId}`;
  const terrain = localTerrain.map(surface => {
    const corners = [[surface.x, surface.y], [surface.x + surface.width, surface.y], [surface.x, surface.y + surface.depth], [surface.x + surface.width, surface.y + surface.depth]].map(([px, py]) => point(px, py));
    const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
    const [dx, dy] = rotate(surface.rampAxis === "x" ? 1 : 0, surface.rampAxis === "x" ? 0 : 1);
    const reversed = dx < 0 || dy < 0;
    return { ...surface, id: surfaceId(surface.id), x: Math.min(...xs), y: Math.min(...ys), width: positive(Math.max(...xs) - Math.min(...xs), "transformed.width"), depth: positive(Math.max(...ys) - Math.min(...ys), "transformed.depth"),
      elevation: height(reversed ? surface.endElevation! : surface.elevation), endElevation: height(reversed ? surface.elevation : surface.endElevation!), baseElevation: height(surface.baseElevation!),
      ...(surface.kind === "ramp" ? { rampAxis: dx === 0 ? "y" as const : "x" as const } : {}),
    };
  });
  const fragment = composition.initialFragment;
  const originalFragment = document.sceneComposition.fragments?.[fragment] ?? {};
  let result: SceneAuthoringDocumentSpec = { ...document,
    sceneComposition: { ...document.sceneComposition, prefabs: { ...document.sceneComposition.prefabs, [prefab]: {} },
      fragments: { ...document.sceneComposition.fragments, [fragment]: { ...originalFragment, instances: [...(originalFragment.instances ?? []), ...generated] } } },
    spatial: { ...spatial, ...(moving?{attachments}:{}), models: { ...spatial.models, [root]: { ...assembly.model, elevation:moving?0:elevation, yawDegrees: yaw, scale } },
      terrain: [...spatial.terrain, ...terrain], connections: [...(spatial.connections ?? []), ...sourceConnections.map((edge, i) => {
        fields(edge, ["from", "to"], `connections.${i}`);
        return { from: surfaceId(id(edge.from, `connections.${i}.from`)), to: surfaceId(id(edge.to, `connections.${i}.to`)) };
      })] },
  };
  const placement = { id: root, x, y, elevation, scale, yawDegrees: yaw, moving };
  for (let i = 0; i < children.length; i++)
    result = appendAssembly(result, children[i], `${path}.children.${i}`, [...ancestors, assembly], budget, placement);
  return result;
}
