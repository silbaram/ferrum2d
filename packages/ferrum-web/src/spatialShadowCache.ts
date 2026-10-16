import type { SpatialRenderBufferView } from "./dataSceneSpatial.js";
import type { SpriteTextureSource } from "./spriteBatch.js";

/** GPU-result cache only. Revisions and face ranges are produced by the native scene. */
export class SpatialShadowCache {
  private terrainRevision = -1;
  private casterRevision = -1;
  private memory?: ArrayBufferLike;
  private offset = -1;
  private matrixLength = 0;
  private readonly matrices = new Float32Array(112);
  private readonly pointLight = new Float32Array(4);
  private readonly textureRevisions = new Map<number, number>();
  private readonly pendingTextures = new Map<number, number>();

  matches(frame: SpatialRenderBufferView, textures: SpriteTextureSource): boolean {
    const env = frame.environment!;
    this.pendingTextures.clear();
    let tracked = true;
    for (const buffer of [frame.terrain, env.shadowCasters]) {
      for (let i = 9; i < buffer.length; i += 33) {
        const id = buffer[i];
        if (id === 16777215 || this.pendingTextures.has(id)) continue;
        const revision = textures.textureRevision?.(id);
        if (revision === undefined) tracked = false;
        else this.pendingTextures.set(id, revision);
      }
    }
    const light = env.values[2] >= 0 ? env.values.subarray(12 + env.values[2] * 12, 16 + env.values[2] * 12) : undefined;
    let sameTextures = this.textureRevisions.size === this.pendingTextures.size;
    for (const [id, revision] of this.pendingTextures) if (this.textureRevisions.get(id) !== revision) sameTextures = false;
    return tracked && env.shadowSubmission !== undefined &&
      this.memory === frame.terrain.buffer && this.offset === frame.terrain.byteOffset &&
      this.terrainRevision === frame.terrainRevision &&
      this.casterRevision === env.shadowSubmission.revision &&
      (light === undefined || light.every((v, i) => v === this.pointLight[i])) &&
      this.matrixLength === env.shadowMatrices.length && env.shadowMatrices.every((v, i) => v === this.matrices[i]) &&
      sameTextures;
  }

  commit(frame: SpatialRenderBufferView): void {
    const env = frame.environment!;
    this.memory = frame.terrain.buffer;
    this.offset = frame.terrain.byteOffset;
    this.terrainRevision = frame.terrainRevision;
    this.casterRevision = env.shadowSubmission?.revision ?? -1;
    if (env.values[2] >= 0) this.pointLight.set(env.values.subarray(12 + env.values[2] * 12, 16 + env.values[2] * 12));
    this.matrixLength = env.shadowMatrices.length;
    this.matrices.set(env.shadowMatrices);
    this.textureRevisions.clear();
    for (const [id, revision] of this.pendingTextures) this.textureRevisions.set(id, revision);
  }
}
