import { NativePixelMaskTerrain, wasm_memory } from "../pkg/ferrum_core.js";
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

/** Synchronous native mask facade. Initialize Ferrum2D Wasm before construction. */
export class PixelMaskTerrain {
  readonly width: number;
  readonly height: number;
  readonly solidThreshold: number;
  private native: NativePixelMaskTerrain | undefined;

  constructor(options: PixelMaskTerrainOptions) {
    this.width = positiveInteger(options.width, "pixelMaskTerrain.width");
    this.height = positiveInteger(options.height, "pixelMaskTerrain.height");
    this.solidThreshold = alphaByte(options.solidThreshold ?? DEFAULT_SOLID_THRESHOLD, "pixelMaskTerrain.solidThreshold");
    const input = options.data;
    if (input !== undefined && input.length !== this.width * this.height) {
      throw new Error("pixelMaskTerrain.data length must equal width * height");
    }
    // These are immutable construction inputs, never a mutable runtime fallback.
    const data = input === undefined ? new Uint8Array(0)
      : Uint8Array.from(input, (value) => alphaByte(value, "pixelMaskTerrain.data"));
    try {
      wasm_memory();
    } catch {
      throw new Error("PixelMaskTerrain requires initialized Ferrum2D Wasm; await initializeFerrumWasm() or createEngine() before creating terrain.");
    }
    this.native = nativeResult(() => new NativePixelMaskTerrain(
      this.width, this.height, this.solidThreshold, options.fill === "solid", data,
    ));
  }

  /** Owned alpha snapshot. Editing it does not change the native terrain. */
  get data(): Uint8Array {
    return this.requireNative().alpha_data();
  }

  get version(): number {
    return this.requireNative().version();
  }

  /** Owned 0/1 occupancy snapshot, classified by Rust using solidThreshold. */
  solidData(): Uint8Array {
    return this.requireNative().solid_data();
  }

  isSolid(x: number, y: number): boolean {
    return this.requireNative().is_solid(x, y);
  }

  alphaAt(x: number, y: number): number {
    return this.requireNative().alpha_at(x, y);
  }

  setPixel(x: number, y: number, alpha: number): boolean {
    return nativeResult(() => this.requireNative().set_pixel(x, y, alpha));
  }

  carveRect(x: number, y: number, width: number, height: number, alpha = 0): boolean {
    return nativeResult(() => this.requireNative().carve_rect(x, y, width, height, alpha));
  }

  carveCircle(centerX: number, centerY: number, radius: number, alpha = 0): boolean {
    return nativeResult(() => this.requireNative().carve_circle(centerX, centerY, radius, alpha));
  }

  dirtyRect(): PixelMaskTerrainDirtyRect | undefined {
    const words = this.requireNative().dirty_rect();
    return words.length === 0 ? undefined
      : { x: words[0], y: words[1], width: words[2], height: words[3] };
  }

  clearDirty(): void {
    this.requireNative().clear_dirty();
  }

  dirtyAlphaPatch(): PixelMaskTerrainAlphaPatch | undefined {
    const packet = this.requireNative().dirty_alpha_patch();
    if (packet.length === 0) return undefined;
    const header = new DataView(packet.buffer, packet.byteOffset, 16);
    const rect = {
      x: header.getUint32(0, true), y: header.getUint32(4, true),
      width: header.getUint32(8, true), height: header.getUint32(12, true),
    };
    // packet already owns its bytes, so this subview cannot alias Wasm memory.
    return { rect, alpha: packet.subarray(16) };
  }

  toTilemapLayer(options: PixelMaskTerrainLayerOptions = {}): ResolvedShooterTileLayer {
    const data = Array.from(this.solidData());
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

  /** Releases this mask only; runtimes that reference it must be stopped first. */
  destroy(): void {
    const native = this.native;
    this.native = undefined;
    native?.free();
  }

  private requireNative(): NativePixelMaskTerrain {
    if (this.native === undefined) throw new Error("PixelMaskTerrain has been destroyed.");
    return this.native;
  }
}

function nativeResult<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
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
      floor: "default",
      elevation: 0,
      height: 0,
      kind: "flat",
      blocksMovement: true,
      blocksProjectile: true,
      blocksVision: true,
      occluderHeight: 0,
    }],
    layers: [layer],
  };
  return extractTilemapBoundaryChains(tilemap, {
    ...options,
    layerIndex: layer.index,
  });
}

function positiveInteger(value: number, path: string): number {
  if (!Number.isInteger(value) || value <= 0 || value > 4096) {
    throw new Error(`${path} must be a positive integer at most 4096`);
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
