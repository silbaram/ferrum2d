import type { FerrumEngine } from "./createEngine.js";
import {
  createPhysicsWorldFromSpec,
  type PhysicsWorldApplyResult,
  type PhysicsWorldApplyWarning,
} from "./physicsAuthoring.js";
import type { PhysicsSpec } from "./physicsSpec.js";
import {
  PixelMaskTerrain,
  type PixelMaskTerrainAlphaPatch,
  type PixelMaskTerrainBoundaryOptions,
  type PixelMaskTerrainDirtyRect,
  type PixelMaskTerrainTextureUploadOptions,
} from "./pixelMaskTerrain.js";
import { extractTilemapBoundaryChains } from "./tilemapPhysics.js";
import type { TilemapBoundaryExtractionResult } from "./tilemapPhysics.js";
import type { ResolvedShooterTileLayer, ResolvedShooterTilemap } from "./gameSpec.js";

const SOLID_TILE_ID = 1;
const DEFAULT_CHUNK_SIZE = 32;
const DEFAULT_BODY_ID_PREFIX = "pixelMaskTerrain";

export interface PixelMaskTerrainTextureTarget {
  createPixelMaskTerrainTexture(
    textureId: number,
    terrain: PixelMaskTerrain,
    options?: PixelMaskTerrainTextureUploadOptions,
  ): unknown;
  updatePixelMaskTerrainTexture(
    textureId: number,
    patch: PixelMaskTerrainAlphaPatch,
    options?: PixelMaskTerrainTextureUploadOptions,
  ): unknown;
}

export interface PixelMaskTerrainRuntimeTextureOptions {
  target: PixelMaskTerrainTextureTarget;
  textureId: number;
  uploadOnCreate?: boolean;
  upload?: PixelMaskTerrainTextureUploadOptions;
}

export interface PixelMaskTerrainRuntimePhysicsOptions {
  engine: FerrumEngine;
  applyOnCreate?: boolean;
  chunkWidth?: number;
  chunkHeight?: number;
  maxDirtyChunksPerSync?: number;
  baseSpec?: Omit<PhysicsSpec, "bodies" | "joints">;
  boundary?: PixelMaskTerrainBoundaryOptions;
  path?: string;
  unsafeUnitScaleThreshold?: number;
  onWarning?: (warning: PhysicsWorldApplyWarning) => void;
}

export interface PixelMaskTerrainRuntimeOptions {
  terrain: PixelMaskTerrain;
  texture?: PixelMaskTerrainRuntimeTextureOptions;
  physics?: PixelMaskTerrainRuntimePhysicsOptions;
  clearDirtyAfterSync?: boolean;
}

export interface PixelMaskTerrainRuntimeSyncOptions {
  force?: boolean;
}

export interface PixelMaskTerrainRuntimeSyncResult {
  terrainVersion: number;
  textureUploaded: boolean;
  texturePatch?: PixelMaskTerrainDirtyRect;
  colliderChunksRebuilt: number;
  colliderBodies: number;
  colliderChains: number;
  colliderSegments: number;
}

interface ChunkCoord {
  x: number;
  y: number;
}

interface RuntimeChunk {
  coord: ChunkCoord;
  world?: PhysicsWorldApplyResult;
  extraction?: TilemapBoundaryExtractionResult;
}

export class PixelMaskTerrainRuntime {
  readonly terrain: PixelMaskTerrain;
  private readonly texture?: PixelMaskTerrainRuntimeTextureOptions;
  private readonly physics?: RequiredChunkPhysicsOptions;
  private readonly clearDirtyAfterSync: boolean;
  private readonly chunks = new Map<string, RuntimeChunk>();
  private textureCreated = false;
  private destroyed = false;

  constructor(options: PixelMaskTerrainRuntimeOptions) {
    this.terrain = options.terrain;
    this.texture = options.texture;
    this.physics = normalizePhysicsOptions(options.physics);
    this.clearDirtyAfterSync = options.clearDirtyAfterSync ?? true;
    const includeTexture = this.texture !== undefined && this.texture.uploadOnCreate !== false;
    const includePhysics = this.physics !== undefined && this.physics.applyOnCreate !== false;
    if (includeTexture || includePhysics) {
      this.syncInternal({
        force: true,
        clearDirty: this.clearDirtyAfterSync,
        includeTexture,
        includePhysics,
      });
    }
  }

  setPixel(x: number, y: number, alpha: number): PixelMaskTerrainRuntimeSyncResult {
    this.assertAlive();
    this.terrain.setPixel(x, y, alpha);
    return this.sync();
  }

  carveRect(
    x: number,
    y: number,
    width: number,
    height: number,
    alpha = 0,
  ): PixelMaskTerrainRuntimeSyncResult {
    this.assertAlive();
    this.terrain.carveRect(x, y, width, height, alpha);
    return this.sync();
  }

  carveCircle(
    centerX: number,
    centerY: number,
    radius: number,
    alpha = 0,
  ): PixelMaskTerrainRuntimeSyncResult {
    this.assertAlive();
    this.terrain.carveCircle(centerX, centerY, radius, alpha);
    return this.sync();
  }

  sync(options: PixelMaskTerrainRuntimeSyncOptions = {}): PixelMaskTerrainRuntimeSyncResult {
    return this.syncInternal({ force: options.force === true, clearDirty: this.clearDirtyAfterSync });
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const chunk of this.chunks.values()) {
      chunk.world?.clear();
    }
    this.chunks.clear();
  }

  private syncInternal(
    options: PixelMaskTerrainRuntimeSyncOptions & {
      clearDirty: boolean;
      includeTexture?: boolean;
      includePhysics?: boolean;
    },
  ): PixelMaskTerrainRuntimeSyncResult {
    this.assertAlive();
    const dirty = this.terrain.dirtyRect();
    const shouldForce = options.force === true;
    let textureUploaded = false;
    let texturePatch: PixelMaskTerrainDirtyRect | undefined;
    let colliderChunksRebuilt = 0;

    if (
      options.includeTexture !== false
      && this.texture !== undefined
      && (shouldForce || dirty !== undefined || !this.textureCreated)
    ) {
      if (shouldForce || !this.textureCreated) {
        this.texture.target.createPixelMaskTerrainTexture(
          this.texture.textureId,
          this.terrain,
          this.texture.upload,
        );
        texturePatch = { x: 0, y: 0, width: this.terrain.width, height: this.terrain.height };
        this.textureCreated = true;
      } else {
        const patch = this.terrain.dirtyAlphaPatch();
        if (patch !== undefined) {
          this.texture.target.updatePixelMaskTerrainTexture(
            this.texture.textureId,
            patch,
            this.texture.upload,
          );
          texturePatch = patch.rect;
        }
      }
      textureUploaded = true;
    }

    if (
      options.includePhysics !== false
      && this.physics !== undefined
      && (shouldForce || dirty !== undefined)
    ) {
      const dirtyChunks = shouldForce ? allChunks(this.terrain, this.physics) : chunksForDirtyRect(dirty, this.physics);
      if (dirtyChunks.length > this.physics.maxDirtyChunksPerSync) {
        throw new Error(
          `pixel mask terrain sync requires ${dirtyChunks.length} dirty chunks, ` +
            `which exceeds maxDirtyChunksPerSync=${this.physics.maxDirtyChunksPerSync}.`,
        );
      }
      for (const chunk of dirtyChunks) {
        this.rebuildChunk(chunk);
      }
      colliderChunksRebuilt = dirtyChunks.length;
    }

    if (options.clearDirty && (textureUploaded || colliderChunksRebuilt > 0)) {
      this.terrain.clearDirty();
    }

    const colliderStats = this.colliderStats();
    return {
      terrainVersion: this.terrain.version,
      textureUploaded,
      ...(texturePatch === undefined ? {} : { texturePatch }),
      colliderChunksRebuilt,
      colliderBodies: colliderStats.bodies,
      colliderChains: colliderStats.chains,
      colliderSegments: colliderStats.segments,
    };
  }

  private rebuildChunk(coord: ChunkCoord): void {
    const physics = this.physics;
    if (physics === undefined) {
      return;
    }
    const key = chunkKey(coord);
    const previous = this.chunks.get(key);
    const extraction = extractChunkBoundaryChains(this.terrain, coord, physics);
    if (extraction.chainCount === 0) {
      previous?.world?.clear();
      this.chunks.delete(key);
      return;
    }
    const world = createPhysicsWorldFromSpec(physics.engine, {
      ...physics.baseSpec,
      bodies: extraction.bodies,
      joints: {},
    }, {
      replace: previous?.world,
      path: `${physics.path}.chunks.${coord.x}.${coord.y}`,
      unsafeUnitScaleThreshold: physics.unsafeUnitScaleThreshold,
      onWarning: physics.onWarning,
    });
    this.chunks.set(key, { coord, world, extraction });
  }

  private colliderStats(): { bodies: number; chains: number; segments: number } {
    let bodies = 0;
    let chains = 0;
    let segments = 0;
    for (const chunk of this.chunks.values()) {
      bodies += chunk.world?.bodyCount ?? 0;
      chains += chunk.extraction?.chainCount ?? 0;
      segments += chunk.extraction?.segmentCount ?? 0;
    }
    return { bodies, chains, segments };
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("PixelMaskTerrainRuntime has been destroyed.");
    }
  }
}

export function createPixelMaskTerrainRuntime(
  options: PixelMaskTerrainRuntimeOptions,
): PixelMaskTerrainRuntime {
  return new PixelMaskTerrainRuntime(options);
}

interface RequiredChunkPhysicsOptions {
  engine: FerrumEngine;
  applyOnCreate: boolean;
  chunkWidth: number;
  chunkHeight: number;
  maxDirtyChunksPerSync: number;
  baseSpec: Omit<PhysicsSpec, "bodies" | "joints">;
  boundary: PixelMaskTerrainBoundaryOptions;
  path: string;
  unsafeUnitScaleThreshold?: number;
  onWarning?: (warning: PhysicsWorldApplyWarning) => void;
}

function normalizePhysicsOptions(
  options: PixelMaskTerrainRuntimePhysicsOptions | undefined,
): RequiredChunkPhysicsOptions | undefined {
  if (options === undefined) {
    return undefined;
  }
  const chunkWidth = positiveInteger(options.chunkWidth ?? DEFAULT_CHUNK_SIZE, "pixelMaskTerrain.physics.chunkWidth");
  const chunkHeight = positiveInteger(options.chunkHeight ?? DEFAULT_CHUNK_SIZE, "pixelMaskTerrain.physics.chunkHeight");
  const maxDirtyChunksPerSync = positiveInteger(
    options.maxDirtyChunksPerSync ?? Number.MAX_SAFE_INTEGER,
    "pixelMaskTerrain.physics.maxDirtyChunksPerSync",
  );
  return {
    engine: options.engine,
    applyOnCreate: options.applyOnCreate ?? true,
    chunkWidth,
    chunkHeight,
    maxDirtyChunksPerSync,
    baseSpec: {
      mode: "rigid",
      ...(options.baseSpec ?? {}),
    },
    boundary: {
      bodyIdPrefix: DEFAULT_BODY_ID_PREFIX,
      ...(options.boundary ?? {}),
    },
    path: options.path ?? "pixelMaskTerrain",
    unsafeUnitScaleThreshold: options.unsafeUnitScaleThreshold,
    onWarning: options.onWarning,
  };
}

function extractChunkBoundaryChains(
  terrain: PixelMaskTerrain,
  coord: ChunkCoord,
  options: RequiredChunkPhysicsOptions,
): TilemapBoundaryExtractionResult {
  const layer = chunkTilemapLayer(terrain, coord, options);
  const tilemap: ResolvedShooterTilemap = {
    tiles: [{
      id: SOLID_TILE_ID,
      frame: {
        name: "pixel-mask-terrain.solid",
        texture: "pixel-mask-terrain",
        width: 1,
        height: 1,
        u0: 0,
        v0: 0,
        u1: 1,
        v1: 1,
      },
      color: [1, 1, 1, 1],
    }],
    layers: [layer],
  };
  const bodyIdPrefix = `${options.boundary.bodyIdPrefix ?? DEFAULT_BODY_ID_PREFIX}.${coord.x}.${coord.y}`;
  return extractTilemapBoundaryChains(tilemap, {
    ...options.boundary,
    bodyIdPrefix,
    layerIndex: layer.index,
  });
}

function chunkTilemapLayer(
  terrain: PixelMaskTerrain,
  coord: ChunkCoord,
  options: RequiredChunkPhysicsOptions,
): ResolvedShooterTileLayer {
  const startX = coord.x * options.chunkWidth;
  const startY = coord.y * options.chunkHeight;
  const width = Math.min(options.chunkWidth, terrain.width - startX);
  const height = Math.min(options.chunkHeight, terrain.height - startY);
  const tileWidth = options.boundary.tileWidth ?? 1;
  const tileHeight = options.boundary.tileHeight ?? 1;
  const originX = options.boundary.originX ?? 0;
  const originY = options.boundary.originY ?? 0;
  const data: number[] = [];
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = (startY + row) * terrain.width + startX;
    for (const alpha of terrain.data.subarray(sourceOffset, sourceOffset + width)) {
      data.push(alpha >= terrain.solidThreshold ? SOLID_TILE_ID : 0);
    }
  }
  return {
    index: coord.y * Math.ceil(terrain.width / options.chunkWidth) + coord.x,
    name: `${options.boundary.name ?? "pixel-mask-terrain"}.${coord.x}.${coord.y}`,
    columns: width,
    rows: height,
    tileWidth,
    tileHeight,
    originX: originX + startX * tileWidth,
    originY: originY + startY * tileHeight,
    collision: true,
    collisionOnly: options.boundary.collisionOnly ?? true,
    data,
  };
}

function allChunks(
  terrain: PixelMaskTerrain,
  options: RequiredChunkPhysicsOptions,
): ChunkCoord[] {
  const chunks: ChunkCoord[] = [];
  const chunkColumns = Math.ceil(terrain.width / options.chunkWidth);
  const chunkRows = Math.ceil(terrain.height / options.chunkHeight);
  for (let y = 0; y < chunkRows; y += 1) {
    for (let x = 0; x < chunkColumns; x += 1) {
      chunks.push({ x, y });
    }
  }
  return chunks;
}

function chunksForDirtyRect(
  dirty: PixelMaskTerrainDirtyRect | undefined,
  options: RequiredChunkPhysicsOptions,
): ChunkCoord[] {
  if (dirty === undefined) {
    return [];
  }
  const minChunkX = Math.floor(dirty.x / options.chunkWidth);
  const minChunkY = Math.floor(dirty.y / options.chunkHeight);
  const maxChunkX = Math.floor((dirty.x + dirty.width - 1) / options.chunkWidth);
  const maxChunkY = Math.floor((dirty.y + dirty.height - 1) / options.chunkHeight);
  const chunks: ChunkCoord[] = [];
  for (let y = minChunkY; y <= maxChunkY; y += 1) {
    for (let x = minChunkX; x <= maxChunkX; x += 1) {
      chunks.push({ x, y });
    }
  }
  return chunks;
}

function chunkKey(coord: ChunkCoord): string {
  return `${coord.x},${coord.y}`;
}

function positiveInteger(value: number, path: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${path} must be a positive integer.`);
  }
  return value;
}
