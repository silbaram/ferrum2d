import type { ShooterAtlasFrameSpec, ShooterAtlasSpec } from "./gameSpec.js";

/** @deprecated 자동 texture atlas pipeline은 현재 MVP 범위 밖입니다. 호환용 authoring helper입니다. */
export interface AtlasSpriteInput {
  name: string;
  width: number;
  height: number;
}

export interface TextureAtlasPackInput extends AtlasSpriteInput {
  source?: string;
}

/** @deprecated 자동 texture atlas pipeline은 현재 MVP 범위 밖입니다. 호환용 authoring helper입니다. */
export interface AtlasSpritePlacement {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** @deprecated 자동 texture atlas pipeline은 현재 MVP 범위 밖입니다. 호환용 authoring helper입니다. */
export interface TextureAtlasLayout {
  width: number;
  height: number;
  sprites: AtlasSpritePlacement[];
}

/** @deprecated 자동 texture atlas pipeline은 현재 MVP 범위 밖입니다. 호환용 authoring helper입니다. */
export interface TextureAtlasOptions {
  padding?: number;
  maxSize?: number;
  powerOfTwo?: boolean;
}

export interface TextureAtlasPackOptions extends TextureAtlasOptions {
  texture?: string | number;
  image?: string;
}

export interface PackedTextureAtlasFrame extends AtlasSpritePlacement {
  uv: {
    u0: number;
    v0: number;
    u1: number;
    v1: number;
  };
  source?: string;
}

export interface PackedTextureAtlasDocument {
  format: "ferrum-texture-atlas-pack";
  version: 1;
  texture: string | number;
  width: number;
  height: number;
  image?: string;
  frames: Record<string, ShooterAtlasFrameSpec>;
  placements: readonly PackedTextureAtlasFrame[];
}

export const TEXTURE_ATLAS_PACK_FORMAT = "ferrum-texture-atlas-pack" as const;
export const TEXTURE_ATLAS_PACK_VERSION = 1 as const;

const DEFAULT_MAX_SIZE = 4096;

interface PackedRect {
  name: string;
  width: number;
  height: number;
  area: number;
}

interface FreeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PackedRectPlacement {
  rect: PackedRect;
  outer: FreeRect;
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(value, 1)));
}

function overlaps(a: AtlasSpritePlacement, b: AtlasSpritePlacement): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** @deprecated 자동 texture atlas pipeline은 현재 MVP 범위 밖입니다. 호환용 authoring helper입니다. */
export function generateTextureAtlasLayout(inputs: readonly AtlasSpriteInput[], options: TextureAtlasOptions = {}): TextureAtlasLayout {
  if (inputs.length === 0) {
    return { width: 1, height: 1, sprites: [] };
  }

  const padding = Math.max(0, Math.floor(options.padding ?? 2));
  const maxSize = Math.max(64, Math.floor(options.maxSize ?? DEFAULT_MAX_SIZE));
  const powerOfTwo = options.powerOfTwo ?? true;

  const rects: PackedRect[] = inputs.map((input) => {
    if (!input.name) throw new Error("Texture atlas input name is required.");
    if (!Number.isFinite(input.width) || input.width <= 0) throw new Error(`Invalid width for '${input.name}'.`);
    if (!Number.isFinite(input.height) || input.height <= 0) throw new Error(`Invalid height for '${input.name}'.`);
    return {
      name: input.name,
      width: Math.ceil(input.width),
      height: Math.ceil(input.height),
      area: Math.ceil(input.width) * Math.ceil(input.height),
    };
  });

  rects.sort(comparePackedRects);

  let atlasWidth = rects.reduce((m, r) => Math.max(m, r.width + padding * 2), 1);
  let atlasHeight = rects.reduce((m, r) => Math.max(m, r.height + padding * 2), 1);
  if (powerOfTwo) {
    atlasWidth = nextPowerOfTwo(atlasWidth);
    atlasHeight = nextPowerOfTwo(atlasHeight);
  }

  while (atlasWidth <= maxSize && atlasHeight <= maxSize) {
    const placements = tryPackMaxRects(rects, atlasWidth, atlasHeight, padding);
    if (placements !== undefined) {
      for (let i = 0; i < placements.length; i += 1) {
        for (let j = i + 1; j < placements.length; j += 1) {
          if (overlaps(placements[i], placements[j])) {
            throw new Error("Texture atlas packing produced overlapping sprites.");
          }
        }
      }

      const usedWidth = placements.reduce((m, p) => Math.max(m, p.x + p.width + padding), 1);
      const usedHeight = placements.reduce((m, p) => Math.max(m, p.y + p.height + padding), 1);
      const finalWidth = powerOfTwo ? nextPowerOfTwo(usedWidth) : usedWidth;
      const finalHeight = powerOfTwo ? nextPowerOfTwo(usedHeight) : usedHeight;
      return {
        width: finalWidth,
        height: finalHeight,
        sprites: placements.map((placement) => placementWithAtlasSize(placement, finalWidth, finalHeight)),
      };
    }

    if (atlasWidth <= atlasHeight) {
      atlasWidth = powerOfTwo ? atlasWidth * 2 : atlasWidth + 256;
    } else {
      atlasHeight = powerOfTwo ? atlasHeight * 2 : atlasHeight + 256;
    }
  }

  throw new Error(`Texture atlas packing failed within maxSize=${maxSize}.`);
}

function tryPackMaxRects(
  rects: readonly PackedRect[],
  atlasWidth: number,
  atlasHeight: number,
  padding: number,
): AtlasSpritePlacement[] | undefined {
  const freeRects: FreeRect[] = [{ x: 0, y: 0, width: atlasWidth, height: atlasHeight }];
  const packed: PackedRectPlacement[] = [];

  for (const rect of rects) {
    const outerWidth = rect.width + padding * 2;
    const outerHeight = rect.height + padding * 2;
    const placement = findBestMaxRect(freeRects, outerWidth, outerHeight);
    if (placement === undefined) {
      return undefined;
    }
    const outer = {
      x: placement.x,
      y: placement.y,
      width: outerWidth,
      height: outerHeight,
    };
    splitFreeRects(freeRects, outer);
    pruneContainedFreeRects(freeRects);
    packed.push({ rect, outer });
  }

  return packed.map(({ rect, outer }) => ({
    name: rect.name,
    x: outer.x + padding,
    y: outer.y + padding,
    width: rect.width,
    height: rect.height,
    u0: (outer.x + padding) / atlasWidth,
    v0: (outer.y + padding) / atlasHeight,
    u1: (outer.x + padding + rect.width) / atlasWidth,
    v1: (outer.y + padding + rect.height) / atlasHeight,
  }));
}

function findBestMaxRect(
  freeRects: readonly FreeRect[],
  width: number,
  height: number,
): Pick<FreeRect, "x" | "y"> | undefined {
  let best: FreeRect | undefined;
  let bestShortSide = Number.POSITIVE_INFINITY;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const free of freeRects) {
    if (width > free.width || height > free.height) {
      continue;
    }
    const leftoverX = free.width - width;
    const leftoverY = free.height - height;
    const shortSide = Math.min(leftoverX, leftoverY);
    const area = free.width * free.height - width * height;
    if (
      shortSide < bestShortSide
      || (shortSide === bestShortSide && area < bestArea)
      || (shortSide === bestShortSide && area === bestArea && best !== undefined && free.y < best.y)
      || (shortSide === bestShortSide && area === bestArea && best !== undefined && free.y === best.y && free.x < best.x)
    ) {
      best = free;
      bestShortSide = shortSide;
      bestArea = area;
    }
  }
  return best === undefined ? undefined : { x: best.x, y: best.y };
}

function splitFreeRects(freeRects: FreeRect[], used: FreeRect): void {
  const next: FreeRect[] = [];
  for (const free of freeRects) {
    if (!rectsOverlap(free, used)) {
      next.push(free);
      continue;
    }
    if (used.x > free.x) {
      next.push({ x: free.x, y: free.y, width: used.x - free.x, height: free.height });
    }
    const usedRight = used.x + used.width;
    const freeRight = free.x + free.width;
    if (usedRight < freeRight) {
      next.push({ x: usedRight, y: free.y, width: freeRight - usedRight, height: free.height });
    }
    if (used.y > free.y) {
      next.push({ x: free.x, y: free.y, width: free.width, height: used.y - free.y });
    }
    const usedBottom = used.y + used.height;
    const freeBottom = free.y + free.height;
    if (usedBottom < freeBottom) {
      next.push({ x: free.x, y: usedBottom, width: free.width, height: freeBottom - usedBottom });
    }
  }
  freeRects.length = 0;
  freeRects.push(...next.filter((rect) => rect.width > 0 && rect.height > 0));
}

function pruneContainedFreeRects(freeRects: FreeRect[]): void {
  for (let i = 0; i < freeRects.length; i += 1) {
    for (let j = i + 1; j < freeRects.length; j += 1) {
      if (containsRect(freeRects[i], freeRects[j])) {
        freeRects.splice(j, 1);
        j -= 1;
      } else if (containsRect(freeRects[j], freeRects[i])) {
        freeRects.splice(i, 1);
        i -= 1;
        break;
      }
    }
  }
}

function rectsOverlap(a: FreeRect, b: FreeRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function containsRect(outer: FreeRect, inner: FreeRect): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

export function packTextureAtlas(
  inputs: readonly TextureAtlasPackInput[],
  options: TextureAtlasPackOptions = {},
): PackedTextureAtlasDocument {
  const texture = options.texture ?? "atlas";
  const sourceByName = new Map<string, string>();
  const seen = new Set<string>();
  for (const input of inputs) {
    if (seen.has(input.name)) {
      throw new Error(`Duplicate texture atlas sprite name '${input.name}'.`);
    }
    seen.add(input.name);
    if (input.source !== undefined) {
      sourceByName.set(input.name, input.source);
    }
  }

  const layout = generateTextureAtlasLayout(inputs, options);
  const placements = [...layout.sprites]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((placement): PackedTextureAtlasFrame => ({
      ...placement,
      uv: {
        u0: placement.u0,
        v0: placement.v0,
        u1: placement.u1,
        v1: placement.v1,
      },
      ...(sourceByName.has(placement.name) ? { source: sourceByName.get(placement.name) } : {}),
    }));
  const frames: Record<string, ShooterAtlasFrameSpec> = {};
  for (const placement of placements) {
    frames[placement.name] = {
      texture,
      uv: placement.uv,
      size: {
        width: placement.width,
        height: placement.height,
      },
    };
  }

  return {
    format: TEXTURE_ATLAS_PACK_FORMAT,
    version: TEXTURE_ATLAS_PACK_VERSION,
    texture,
    width: layout.width,
    height: layout.height,
    ...(options.image === undefined ? {} : { image: options.image }),
    frames,
    placements,
  };
}

export function textureAtlasDocumentToShooterAtlas(
  document: PackedTextureAtlasDocument,
): ShooterAtlasSpec {
  if (document.format !== TEXTURE_ATLAS_PACK_FORMAT || document.version !== TEXTURE_ATLAS_PACK_VERSION) {
    throw new Error("Unsupported texture atlas document format or version.");
  }
  return {
    frames: { ...document.frames },
  };
}

function comparePackedRects(a: PackedRect, b: PackedRect): number {
  return b.area - a.area
    || b.height - a.height
    || b.width - a.width
    || a.name.localeCompare(b.name);
}

function placementWithAtlasSize(
  placement: AtlasSpritePlacement,
  atlasWidth: number,
  atlasHeight: number,
): AtlasSpritePlacement {
  return {
    ...placement,
    u0: placement.x / atlasWidth,
    v0: placement.y / atlasHeight,
    u1: (placement.x + placement.width) / atlasWidth,
    v1: (placement.y + placement.height) / atlasHeight,
  };
}
