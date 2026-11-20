/** Frame-owned native terrain evidence. No terrain participant is an Entity.
 * Kind1 solved contact: impulse/approachSpeed; kind2 swept projectile: fraction.
 * Points/normals are actual XYZ witnesses (normal points out of terrain).
 */
export interface TerrainImpactBufferView {
  readonly version: 1;
  readonly stride: 24;
  readonly count: number;
  readonly dropped: number;
  readonly words: Uint32Array;
  readonly floats: Float32Array;
}
export const TERRAIN_IMPACT_LAYOUT = {
  kind:0, flags:1, actor:2, actorBody:4, actorCollider:6, terrainBody:8, terrainCollider:10,
  terrain:12, point:15, normal:18, impulse:21, approachSpeed:22, fraction:23,
  solvedContact:1, projectileArrival:2, targetRemoved:4, tile:1, spatialSurface:2,
} as const;
type Native={terrain_impact_version():number;terrain_impact_stride_words():number;terrain_impact_count():number;terrain_impact_dropped():number;terrain_impact_ptr():number};
export function readTerrainImpacts(native:Native,memory:WebAssembly.Memory):TerrainImpactBufferView {
  if(native.terrain_impact_version()!==1 || native.terrain_impact_stride_words()!==24)throw new Error("Unsupported terrain impact ABI");
  const count=native.terrain_impact_count(),dropped=native.terrain_impact_dropped(),pointer=native.terrain_impact_ptr();
  const buffer=memory.buffer;
  if(!Number.isSafeInteger(count)||count<0||count>4096||!Number.isSafeInteger(pointer)||pointer<0||pointer%4!==0||pointer+count*96>buffer.byteLength||!Number.isSafeInteger(dropped)||dropped<0||dropped>0xffffffff)throw new Error("Invalid terrain impact buffer");
  return {version:1,stride:24,count,dropped,words:new Uint32Array(buffer,pointer,count*24),floats:new Float32Array(buffer,pointer,count*24)};
}
