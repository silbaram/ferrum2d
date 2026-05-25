import type { ResolvedShooterTileLayer, ResolvedShooterTilemap } from "./gameSpec.js";
import {
  extractTilemapBoundaryChains,
  type TilemapBoundaryExtractionOptions,
  type TilemapBoundaryExtractionResult,
} from "./tilemapPhysics.js";

const DEFAULT_SOLID_THRESHOLD = 1;
const SOLID_TILE_ID = 1;

export interface PixelMaskTerrainOptions {
  width: number;
  height: number;
  data?: Uint8Array | readonly number[];
  fill?: "empty" | "solid";
  solidThreshold?: number;
}

export interface PixelMaskTerrainLayerOptions {
  layerIndex?: number;
  name?: string;
  tileWidth?: number;
  tileHeight?: number;
  originX?: number;
  originY?: number;
  collisionOnly?: boolean;
}

export interface PixelMaskTerrainBoundaryOptions
  extends PixelMaskTerrainLayerOptions,
    Omit<TilemapBoundaryExtractionOptions, "layerIndex"> {}

export interface PixelMaskTerrainDirtyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelMaskTerrainAlphaPatch {
  rect: PixelMaskTerrainDirtyRect;
  alpha: Uint8Array;
}

export interface PixelMaskTerrainTextureUploadOptions {
  color?: readonly [number, number, number];
  alphaScale?: number;
}

export class PixelMaskTerrain {
  readonly width: number;
  readonly height: number;
  readonly solidThreshold: number;
  readonly data: Uint8Array;
  version = 0;
  private dirty: PixelMaskTerrainDirtyRect | undefined;

  constructor(options: PixelMaskTerrainOptions) {
    this.width = positiveInteger(options.width, "pixelMaskTerrain.width");
    this.height = positiveInteger(options.height, "pixelMaskTerrain.height");
    this.solidThreshold = alphaByte(options.solidThreshold ?? DEFAULT_SOLID_THRESHOLD, "pixelMaskTerrain.solidThreshold");
    const pixelCount = this.width * this.height;
    if (options.data !== undefined) {
      if (options.data.length !== pixelCount) {
        throw new Error("pixelMaskTerrain.data length must equal width * height");
      }
      this.data = Uint8Array.from(options.data, (value) => alphaByte(value, "pixelMaskTerrain.data"));
    } else {
      this.data = new Uint8Array(pixelCount);
      this.data.fill(options.fill === "solid" ? 255 : 0);
    }
  }

  isSolid(x: number, y: number): boolean {
    if (!this.contains(x, y)) {
      return false;
    }
    return this.data[this.index(x, y)] >= this.solidThreshold;
  }

  alphaAt(x: number, y: number): number {
    if (!this.contains(x, y)) {
      return 0;
    }
    return this.data[this.index(x, y)];
  }

  setPixel(x: number, y: number, alpha: number): boolean {
    if (!this.contains(x, y)) {
      return false;
    }
    const nextAlpha = alphaByte(alpha, "pixelMaskTerrain.alpha");
    const index = this.index(x, y);
    if (this.data[index] === nextAlpha) {
      return false;
    }
    this.data[index] = nextAlpha;
    this.markDirty(x, y);
    this.version += 1;
    return true;
  }

  carveRect(x: number, y: number, width: number, height: number, alpha = 0): boolean {
    const minX = Math.max(0, Math.floor(x));
    const minY = Math.max(0, Math.floor(y));
    const maxX = Math.min(this.width, Math.ceil(x + width));
    const maxY = Math.min(this.height, Math.ceil(y + height));
    return this.writeArea(minX, minY, maxX, maxY, alphaByte(alpha, "pixelMaskTerrain.alpha"));
  }

  carveCircle(centerX: number, centerY: number, radius: number, alpha = 0): boolean {
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(radius) || radius < 0) {
      return false;
    }
    const minX = Math.max(0, Math.floor(centerX - radius));
    const minY = Math.max(0, Math.floor(centerY - radius));
    const maxX = Math.min(this.width, Math.ceil(centerX + radius));
    const maxY = Math.min(this.height, Math.ceil(centerY + radius));
    const radiusSquared = radius * radius;
    let changed = false;
    const nextAlpha = alphaByte(alpha, "pixelMaskTerrain.alpha");
    for (let py = minY; py < maxY; py += 1) {
      for (let px = minX; px < maxX; px += 1) {
        const dx = px + 0.5 - centerX;
        const dy = py + 0.5 - centerY;
        if (dx * dx + dy * dy > radiusSquared) {
          continue;
        }
        const index = this.index(px, py);
        if (this.data[index] === nextAlpha) {
          continue;
        }
        this.data[index] = nextAlpha;
        this.markDirty(px, py);
        changed = true;
      }
    }
    if (changed) {
      this.version += 1;
    }
    return changed;
  }

  dirtyRect(): PixelMaskTerrainDirtyRect | undefined {
    return this.dirty === undefined ? undefined : { ...this.dirty };
  }

  clearDirty(): void {
    this.dirty = undefined;
  }

  dirtyAlphaPatch(): PixelMaskTerrainAlphaPatch | undefined {
    if (this.dirty === undefined) {
      return undefined;
    }
    const rect = { ...this.dirty };
    const alpha = new Uint8Array(rect.width * rect.height);
    for (let row = 0; row < rect.height; row += 1) {
      const sourceOffset = this.index(rect.x, rect.y + row);
      const targetOffset = row * rect.width;
      alpha.set(this.data.subarray(sourceOffset, sourceOffset + rect.width), targetOffset);
    }
    return { rect, alpha };
  }

  toTilemapLayer(options: PixelMaskTerrainLayerOptions = {}): ResolvedShooterTileLayer {
    const data = Array.from(this.data, (alpha) => alpha >= this.solidThreshold ? SOLID_TILE_ID : 0);
    return {
      index: options.layerIndex ?? 0,
      name: options.name ?? "pixel-mask-terrain",
      columns: this.width,
      rows: this.height,
      tileWidth: positiveNumber(options.tileWidth ?? 1, "pixelMaskTerrain.tileWidth"),
      tileHeight: positiveNumber(options.tileHeight ?? 1, "pixelMaskTerrain.tileHeight"),
      originX: finiteNumber(options.originX ?? 0, "pixelMaskTerrain.originX"),
      originY: finiteNumber(options.originY ?? 0, "pixelMaskTerrain.originY"),
      collision: true,
      collisionOnly: options.collisionOnly ?? true,
      data,
    };
  }

  extractBoundaryChains(options: PixelMaskTerrainBoundaryOptions = {}): TilemapBoundaryExtractionResult {
    return extractPixelMaskBoundaryChains(this, options);
  }

  private writeArea(minX: number, minY: number, maxX: number, maxY: number, alpha: number): boolean {
    if (minX >= maxX || minY >= maxY) {
      return false;
    }
    let changed = false;
    for (let py = minY; py < maxY; py += 1) {
      for (let px = minX; px < maxX; px += 1) {
        const index = this.index(px, py);
        if (this.data[index] === alpha) {
          continue;
        }
        this.data[index] = alpha;
        this.markDirty(px, py);
        changed = true;
      }
    }
    if (changed) {
      this.version += 1;
    }
    return changed;
  }

  private contains(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }

  private markDirty(x: number, y: number): void {
    if (this.dirty === undefined) {
      this.dirty = { x, y, width: 1, height: 1 };
      return;
    }
    const minX = Math.min(this.dirty.x, x);
    const minY = Math.min(this.dirty.y, y);
    const maxX = Math.max(this.dirty.x + this.dirty.width, x + 1);
    const maxY = Math.max(this.dirty.y + this.dirty.height, y + 1);
    this.dirty = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
}

export function createPixelMaskTerrain(options: PixelMaskTerrainOptions): PixelMaskTerrain {
  return new PixelMaskTerrain(options);
}

export function pixelMaskTerrainToTilemapLayer(
  terrain: PixelMaskTerrain,
  options: PixelMaskTerrainLayerOptions = {},
): ResolvedShooterTileLayer {
  return terrain.toTilemapLayer(options);
}

export function extractPixelMaskBoundaryChains(
  terrain: PixelMaskTerrain,
  options: PixelMaskTerrainBoundaryOptions = {},
): TilemapBoundaryExtractionResult {
  const layer = terrain.toTilemapLayer(options);
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
  return extractTilemapBoundaryChains(tilemap, {
    ...options,
    layerIndex: layer.index,
  });
}

function positiveInteger(value: number, path: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${path} must be a positive integer`);
  }
  return value;
}

function positiveNumber(value: number, path: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${path} must be a positive number`);
  }
  return value;
}

function finiteNumber(value: number, path: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${path} must be finite`);
  }
  return value;
}

function alphaByte(value: number, path: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 255) {
    throw new Error(`${path} must be between 0 and 255`);
  }
  return Math.round(value);
}
