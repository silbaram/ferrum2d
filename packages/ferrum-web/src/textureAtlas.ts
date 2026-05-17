export interface AtlasSpriteInput {
  name: string;
  width: number;
  height: number;
}

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

export interface TextureAtlasLayout {
  width: number;
  height: number;
  sprites: AtlasSpritePlacement[];
}

export interface TextureAtlasOptions {
  padding?: number;
  maxSize?: number;
  powerOfTwo?: boolean;
}

const DEFAULT_MAX_SIZE = 4096;

interface PackedRect {
  name: string;
  width: number;
  height: number;
  area: number;
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(value, 1)));
}

function overlaps(a: AtlasSpritePlacement, b: AtlasSpritePlacement): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

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

  rects.sort((a, b) => b.area - a.area);

  let atlasWidth = rects.reduce((m, r) => Math.max(m, r.width), 1);
  let atlasHeight = rects.reduce((m, r) => Math.max(m, r.height), 1);
  if (powerOfTwo) {
    atlasWidth = nextPowerOfTwo(atlasWidth);
    atlasHeight = nextPowerOfTwo(atlasHeight);
  }

  while (atlasWidth <= maxSize && atlasHeight <= maxSize) {
    const placements: AtlasSpritePlacement[] = [];
    let cursorX = padding;
    let cursorY = padding;
    let rowHeight = 0;
    let fits = true;

    for (const rect of rects) {
      const neededW = rect.width + padding;
      const neededH = rect.height + padding;

      if (cursorX + neededW > atlasWidth) {
        cursorX = padding;
        cursorY += rowHeight + padding;
        rowHeight = 0;
      }

      if (cursorY + neededH > atlasHeight) {
        fits = false;
        break;
      }

      placements.push({
        name: rect.name,
        x: cursorX,
        y: cursorY,
        width: rect.width,
        height: rect.height,
        u0: cursorX / atlasWidth,
        v0: cursorY / atlasHeight,
        u1: (cursorX + rect.width) / atlasWidth,
        v1: (cursorY + rect.height) / atlasHeight,
      });

      cursorX += rect.width + padding;
      rowHeight = Math.max(rowHeight, rect.height);
    }

    if (fits) {
      for (let i = 0; i < placements.length; i += 1) {
        for (let j = i + 1; j < placements.length; j += 1) {
          if (overlaps(placements[i], placements[j])) {
            throw new Error("Texture atlas packing produced overlapping sprites.");
          }
        }
      }

      const usedWidth = placements.reduce((m, p) => Math.max(m, p.x + p.width + padding), 1);
      const usedHeight = placements.reduce((m, p) => Math.max(m, p.y + p.height + padding), 1);
      return {
        width: powerOfTwo ? nextPowerOfTwo(usedWidth) : usedWidth,
        height: powerOfTwo ? nextPowerOfTwo(usedHeight) : usedHeight,
        sprites: placements,
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
