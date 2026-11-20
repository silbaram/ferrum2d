import type { Engine } from "../pkg/ferrum_core.js";
import type { PhysicsBodyHeightSpan, PhysicsEntityHandle } from "./engineTypes/physicsBodies.js";
import { uint32Number } from "./particlePreset.js";
import { physicsEntityHandle } from "./physicsHandles.js";
import { encodeUnifiedPhysicsShape, physicsF32, type UnifiedPhysicsConvexShape,
  type UnifiedPhysicsPose, type UnifiedPhysicsVector3 } from "./unifiedPhysicsAuthoring.js";

/** World-local native identity. Invalid after collider removal or world replacement. */
export interface UnifiedPhysicsColliderHandle { slot: number; generation: number; }
export interface UnifiedPhysicsQueryFilter {
  category?: number;
  mask?: number;
  includeSensors?: boolean;
  respectTargetMask?: boolean;
  excludeBody?: PhysicsEntityHandle;
  excludeCollider?: UnifiedPhysicsColliderHandle;
  planarSpan?: PhysicsBodyHeightSpan;
  /** Restrict to actual authored terrain geometry. Purpose respects HD tile
   * flags, includes its sensor geometry, and does not apply response masks.
   * Category/mask selection and explicit exclusions still apply. */
  terrain?: "all" | "movement" | "projectile" | "vision";
}
type QueryCommon = { filter?: UnifiedPhysicsQueryFilter; limit?: number };
export type UnifiedPhysicsQuery = QueryCommon & (
  | { type: "ray"; origin: UnifiedPhysicsVector3; direction: UnifiedPhysicsVector3; maxDistance: number; solid?: boolean }
  | { type: "point"; point: UnifiedPhysicsVector3 }
  | { type: "overlap"; shape: UnifiedPhysicsConvexShape; pose?: UnifiedPhysicsPose }
  | { type: "sweep"; shape: UnifiedPhysicsConvexShape; pose?: UnifiedPhysicsPose; translation: UnifiedPhysicsVector3 }
  | { type: "nearest"; point: UnifiedPhysicsVector3; maxDistance: number }
);
/** Owned reusable input. Numeric rows may be updated between queries using the named layout. */
export interface UnifiedPhysicsQueryBatch {
  readonly metadata: Uint32Array;
  readonly values: Float32Array;
  readonly shapeMetadata: Uint32Array;
  readonly shapeValues: Float32Array;
}
export const UNIFIED_PHYSICS_QUERY_LAYOUT = {
  metadataStride: 12, inputStride: 13,
  inputPosition: 0, inputRotation: 3, inputMotion: 7, inputDistance: 10, inputElevation: 11, inputHeight: 12,
  inputKind: 0, inputFlags: 1, inputCategory: 2, inputMask: 3, inputExcludeBody: 4, inputExcludeCollider: 6,
  inputFloor: 8, inputLimit: 9, inputShapeMetadataLength: 10, inputShapeValuesLength: 11,
  rayKind: 0, pointKind: 1, overlapKind: 2, sweepKind: 3, nearestKind: 4,
  includeSensorsFlag: 1, respectTargetMaskFlag: 2, excludeBodyFlag: 4, excludeColliderFlag: 8,
  planarSpanFlag: 16, solidRayFlag: 32, terrainShift: 6, terrainAllFlag: 64, terrainMovementFlag: 128, terrainProjectileFlag: 192, terrainVisionFlag: 256,
  hitStride: 19, summaryStride: 3, summaryOffset: 0, summaryCount: 1, summaryFlags: 2, truncatedFlag: 1,
  queryIndex: 0, kind: 1, flags: 2, entity: 3, body: 5, collider: 7, value: 9, point: 10, normal: 13,
  terrainKind: 16, terrainId: 17, terrainTileIndex: 18, tileTerrain: 1, spatialSurfaceTerrain: 2,
  entityPresentFlag: 1, sensorFlag: 2, initialOverlapFlag: 4, insideFlag: 8,
} as const;
/** Borrowed results, invalidated by the next query, memory growth or engine destruction. */
export interface UnifiedPhysicsQueryBufferView {
  queryCount: number;
  hitCount: number;
  stride: 19;
  summaries: Uint32Array;
  words: Uint32Array;
  floats: Float32Array;
}
export interface FerrumUnifiedPhysicsQueryApi {
  /** Executes mixed queries without stepping; failed native queries clear the whole result. */
  queryUnifiedPhysics(batch: UnifiedPhysicsQueryBatch): UnifiedPhysicsQueryBufferView;
}
function flag(value: boolean | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error("Query flags must be boolean.");
  return value;
}
function vector(out: Float32Array, offset: number, value: readonly number[], length: number): void {
  if (!Array.isArray(value) || value.length !== length) throw new Error("Invalid query vector length.");
  for (let i=0;i<length;i++) out[offset+i]=physicsF32(value[i]);
}
/** Compile at setup, then reuse the typed buffers. Up to 256 queries and 65536 total requested hits. */
export function createUnifiedPhysicsQueryBatch(queries: readonly UnifiedPhysicsQuery[]): UnifiedPhysicsQueryBatch {
  if (!Array.isArray(queries) || queries.length > 256) throw new Error("At most 256 queries are allowed.");
  const metadata=new Uint32Array(queries.length*12),values=new Float32Array(queries.length*13);
  const shapeMetadata:number[]=[],shapeValues:number[]=[];
  let requested=0;
  queries.forEach((q,index)=>{
    const m=index*12,v=index*13;
    const kind=["ray","point","overlap","sweep","nearest"].indexOf(q.type);
    if(kind<0)throw new Error("Unknown unified physics query kind.");
    metadata[m]=kind;values[v+6]=1;
    const f=q.filter??{};
    let flags=Number(flag(f.includeSensors,false)) | (Number(flag(f.respectTargetMask,true))<<1);
    if (f.terrain !== undefined) {
      const purpose = ["all", "movement", "projectile", "vision"].indexOf(f.terrain);
      if (purpose < 0) throw new Error("Unknown terrain query purpose.");
      flags |= (purpose + 1) << 6;
    }
    metadata[m+2]=uint32Number(f.category??0xffffffff,"query category");
    metadata[m+3]=uint32Number(f.mask??0xffffffff,"query mask");
    const limit=uint32Number(q.limit??32,"query hit limit",65536);
    if(limit===0 || (requested+=limit)>65536)throw new Error("Query hit capacity exceeded.");
    metadata[m+9]=limit;
    if(f.excludeBody){const h=physicsEntityHandle(f.excludeBody);flags|=4;metadata[m+4]=h.entityId;metadata[m+5]=h.entityGeneration;}
    if(f.excludeCollider){flags|=8;metadata[m+6]=uint32Number(f.excludeCollider.slot,"collider slot");metadata[m+7]=uint32Number(f.excludeCollider.generation,"collider generation");}
    if(f.planarSpan){flags|=16;metadata[m+8]=uint32Number(f.planarSpan.floorId??0,"query floor");values[v+11]=physicsF32(f.planarSpan.elevation);values[v+12]=physicsF32(f.planarSpan.height);}
    if(q.type==="ray"){
      flags|=Number(flag(q.solid,true))<<5;vector(values,v,q.origin,3);vector(values,v+7,q.direction,3);values[v+10]=physicsF32(q.maxDistance);
    }else if(q.type==="point" || q.type==="nearest"){
      vector(values,v,q.point,3);if(q.type==="nearest")values[v+10]=physicsF32(q.maxDistance);
    }else{
      vector(values,v,q.pose?.position??[0,0,0],3);vector(values,v+3,q.pose?.rotation??[0,0,0,1],4);
      if(!["box","sphere","capsule","convexHull"].includes(q.shape.type))throw new Error("Queries require a convex shape.");
      const shape=encodeUnifiedPhysicsShape(q.shape);metadata[m+10]=shape.metadata.length;metadata[m+11]=shape.values.length;
      for(const value of shape.metadata)shapeMetadata.push(value);
      for(const value of shape.values)shapeValues.push(value);
      if(q.type==="sweep")vector(values,v+7,q.translation,3);
    }
    metadata[m+1]=flags;
  });
  return {metadata,values,shapeMetadata:new Uint32Array(shapeMetadata),shapeValues:new Float32Array(shapeValues)};
}

type Native = Pick<Engine,"query_unified_physics"|"unified_physics_query_version"|"unified_physics_query_hit_stride_words"
  |"unified_physics_query_summary_stride_words"|"unified_physics_query_count"|"unified_physics_query_hit_count"
  |"unified_physics_query_hit_ptr"|"unified_physics_query_summary_ptr">;

export function queryUnifiedPhysics(native:Native,memory:WebAssembly.Memory,batch:UnifiedPhysicsQueryBatch):UnifiedPhysicsQueryBufferView {
  const methods=["query_unified_physics","unified_physics_query_version","unified_physics_query_hit_stride_words",
    "unified_physics_query_summary_stride_words","unified_physics_query_count","unified_physics_query_hit_count",
    "unified_physics_query_hit_ptr","unified_physics_query_summary_ptr"] as const;
  if(methods.some(name=>typeof native[name]!=="function") || native.unified_physics_query_version()!==1
    || native.unified_physics_query_hit_stride_words()!==19 || native.unified_physics_query_summary_stride_words()!==3){
    throw new Error("This Wasm core does not support unified physics query version 1.");
  }
  const {metadata,values,shapeMetadata,shapeValues}=batch;
  if(!(metadata instanceof Uint32Array) || metadata.length%12!==0 || metadata.length>256*12
    || !(values instanceof Float32Array) || values.length!==metadata.length/12*13
    || !(shapeMetadata instanceof Uint32Array) || shapeMetadata.length>512
    || !(shapeValues instanceof Float32Array) || shapeValues.length>196608)throw new Error("Invalid query batch buffers.");
  const expected=metadata.length/12,buffer=memory.buffer;
  // All four copies must precede the first generated-wrapper allocation.
  const m=metadata.buffer===buffer?metadata.slice():metadata;
  const v=values.buffer===buffer?values.slice():values;
  const sm=shapeMetadata.buffer===buffer?shapeMetadata.slice():shapeMetadata;
  const sv=shapeValues.buffer===buffer?shapeValues.slice():shapeValues;
  native.query_unified_physics(m,v,sm,sv);
  const queryCount=native.unified_physics_query_count(),hitCount=native.unified_physics_query_hit_count();
  const hp=native.unified_physics_query_hit_ptr(),sp=native.unified_physics_query_summary_ptr(),current=memory.buffer;
  function valid(pointer:number,words:number):boolean{return Number.isSafeInteger(pointer)&&pointer>=0&&pointer%4===0&&pointer+words*4<=current.byteLength;}
  if(queryCount!==expected || !Number.isSafeInteger(hitCount) || hitCount<0 || hitCount>65536
    || !valid(hp,hitCount*19) || !valid(sp,queryCount*3))throw new Error("Invalid query result buffers.");
  const summaries=new Uint32Array(current,sp,queryCount*3);
  let end=0;
  for(let i=0;i<queryCount;i++){
    const offset=summaries[i*3],count=summaries[i*3+1],flags=summaries[i*3+2];
    if(offset!==end || count>m[i*12+9] || offset+count>hitCount || flags>1)throw new Error("Invalid query result summary.");
    end=offset+count;
  }
  if(end!==hitCount)throw new Error("Incomplete query result summary.");
  return {queryCount,hitCount,stride:19,summaries,words:new Uint32Array(current,hp,hitCount*19),floats:new Float32Array(current,hp,hitCount*19)};
}
