import { physicsSpecDiagnosticError } from "./diagnostics.js";
import type {
  ResolvedShooterTileDefinition,
  ResolvedShooterTileLayer,
  ResolvedShooterTilemap,
} from "./gameSpec.js";
import type { PhysicsBodySpec, PhysicsChainColliderSpec, PhysicsSpecVector2 } from "./physicsSpec.js";

const DEFAULT_BODY_ID_PREFIX = "tilemapBoundary";
const DEFAULT_MAX_CHAIN_VERTICES = 64;

export interface TilemapBoundaryExtractionOptions {
  layerIndex?: number;
  bodyIdPrefix?: string;
  physicsLayer?: string;
  material?: string;
  maxVerticesPerChain?: number;
  path?: string;
}

export interface TilemapBoundaryChain {
  bodyId: string;
  layerIndex: number;
  layerName: string;
  collider: PhysicsChainColliderSpec;
  floor?: string;
  elevation?: number;
  height?: number;
  segmentCount: number;
}

export interface TilemapBoundaryExtractionResult {
  chains: TilemapBoundaryChain[];
  bodies: Record<string, PhysicsBodySpec>;
  chainCount: number;
  segmentCount: number;
}

interface BoundarySegment {
  start: PhysicsSpecVector2;
  end: PhysicsSpecVector2;
}

interface BoundaryPath {
  vertices: PhysicsSpecVector2[];
  loop: boolean;
  segmentCount: number;
}

interface SolidTileGroup {
  tileIds: ReadonlySet<number>;
  heightMetadata?: {
    floor: string;
    elevation: number;
    height: number;
  };
}

export function extractTilemapBoundaryChains(
  tilemap: ResolvedShooterTilemap,
  options: TilemapBoundaryExtractionOptions = {},
): TilemapBoundaryExtractionResult {
  const path = options.path ?? "tilemap";
  const maxVerticesPerChain = boundedMaxVertices(options.maxVerticesPerChain, `${path}.maxVerticesPerChain`);
  const solidTileGroups = solidTileGroupsForBoundaryExtraction(tilemap);
  const layers = tilemap.layers.filter((layer) =>
    layer.collision && (options.layerIndex === undefined || layer.index === options.layerIndex)
  );
  const chains: TilemapBoundaryChain[] = [];

  for (const layer of layers) {
    const layerGroups = layer.collisionOnly ? [collisionOnlySolidGroup()] : solidTileGroups;
    for (const group of layerGroups) {
      const paths = boundaryPathsForLayer(layer, group.tileIds);
      for (const pathEntry of paths) {
        for (const chunk of splitBoundaryPath(pathEntry, maxVerticesPerChain)) {
          const bodyId = `${bodyIdPrefix(options.bodyIdPrefix)}.${layer.index}.${chains.length}`;
          const collider: PhysicsChainColliderSpec = {
            shape: "chain",
            vertices: chunk.vertices,
            loop: chunk.loop,
            ...(options.material === undefined ? {} : { material: options.material }),
            ...(options.physicsLayer === undefined ? {} : { layer: options.physicsLayer }),
          };
          chains.push({
            bodyId,
            layerIndex: layer.index,
            layerName: layer.name,
            collider,
            ...(group.heightMetadata ?? {}),
            segmentCount: chunk.segmentCount,
          });
        }
      }
    }
  }

  const bodies = Object.fromEntries(
    chains.map((chain) => [
      chain.bodyId,
      {
        type: "static",
        position: [0, 0],
        ...chainHeightMetadata(chain),
        ...(options.physicsLayer === undefined ? {} : { layer: options.physicsLayer }),
        ...(options.material === undefined ? {} : { material: options.material }),
        collider: chain.collider,
      } satisfies PhysicsBodySpec,
    ]),
  );

  return {
    chains,
    bodies,
    chainCount: chains.length,
    segmentCount: chains.reduce((sum, chain) => sum + chain.segmentCount, 0),
  };
}

function collisionOnlySolidGroup(): SolidTileGroup {
  return { tileIds: new Set<number>() };
}

function solidTileGroupsForBoundaryExtraction(tilemap: ResolvedShooterTilemap): SolidTileGroup[] {
  const groups = new Map<string, { tileIds: Set<number>; heightMetadata?: SolidTileGroup["heightMetadata"] }>();
  for (const tile of tilemap.tiles) {
    if (tile.blocksMovement === false || tile.slope !== undefined || tile.oneWayPlatform === true) {
      continue;
    }
    const heightMetadata = tileHeightMetadataForBoundaryExtraction(tile);
    const key = heightMetadata === undefined
      ? "legacy"
      : `${heightMetadata.floor}\0${heightMetadata.elevation}\0${heightMetadata.height}`;
    const group = groups.get(key);
    if (group) {
      group.tileIds.add(tile.id);
    } else {
      groups.set(key, {
        tileIds: new Set([tile.id]),
        ...(heightMetadata === undefined ? {} : { heightMetadata }),
      });
    }
  }
  return [...groups.values()];
}

function tileHeightMetadataForBoundaryExtraction(
  tile: ResolvedShooterTilemap["tiles"][number],
): SolidTileGroup["heightMetadata"] | undefined {
  if (tile.floor === "default" && tile.elevation === 0 && tile.height === 0) {
    return undefined;
  }
  return {
    floor: tile.floor,
    elevation: tile.elevation,
    height: tile.height,
  };
}

function chainHeightMetadata(chain: TilemapBoundaryChain): Pick<PhysicsBodySpec, "floor" | "elevation" | "height"> {
  if (chain.floor === undefined || chain.elevation === undefined || chain.height === undefined) {
    return {};
  }
  return {
    floor: chain.floor,
    elevation: chain.elevation,
    height: chain.height,
  };
}

function boundaryPathsForLayer(
  layer: ResolvedShooterTileLayer,
  solidTileIds: ReadonlySet<number>,
): BoundaryPath[] {
  const segments: BoundarySegment[] = [];
  for (let row = 0; row < layer.rows; row += 1) {
    for (let column = 0; column < layer.columns; column += 1) {
      if (!isSolidCell(layer, column, row, solidTileIds)) {
        continue;
      }
      const x = layer.originX + column * layer.tileWidth;
      const y = layer.originY + row * layer.tileHeight;
      const right = x + layer.tileWidth;
      const bottom = y + layer.tileHeight;
      if (!isSolidCell(layer, column, row - 1, solidTileIds)) {
        segments.push({ start: [x, y], end: [right, y] });
      }
      if (!isSolidCell(layer, column + 1, row, solidTileIds)) {
        segments.push({ start: [right, y], end: [right, bottom] });
      }
      if (!isSolidCell(layer, column, row + 1, solidTileIds)) {
        segments.push({ start: [right, bottom], end: [x, bottom] });
      }
      if (!isSolidCell(layer, column - 1, row, solidTileIds)) {
        segments.push({ start: [x, bottom], end: [x, y] });
      }
    }
  }
  return connectBoundarySegments(segments);
}

function isSolidCell(
  layer: ResolvedShooterTileLayer,
  column: number,
  row: number,
  solidTileIds: ReadonlySet<number>,
): boolean {
  if (column < 0 || row < 0 || column >= layer.columns || row >= layer.rows) {
    return false;
  }
  const tileId = layer.data[row * layer.columns + column] ?? 0;
  if (tileId <= 0) {
    return false;
  }
  return layer.collisionOnly || solidTileIds.has(tileId);
}

function connectBoundarySegments(segments: BoundarySegment[]): BoundaryPath[] {
  const unused = new Set<number>();
  const orderedIndices: number[] = [];
  const byStart = new Map<string, number[]>();
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    unused.add(index);
    orderedIndices.push(index);
    const key = pointKey(segment.start);
    const entries = byStart.get(key) ?? [];
    entries.push(index);
    byStart.set(key, entries);
  }
  orderedIndices.sort((a, b) =>
    pointOrder(segments[a].start, segments[b].start) || pointOrder(segments[a].end, segments[b].end)
  );
  for (const entries of byStart.values()) {
    entries.sort((a, b) => pointOrder(segments[a].end, segments[b].end));
  }

  const paths: BoundaryPath[] = [];
  let orderedCursor = 0;
  while (unused.size > 0) {
    while (orderedCursor < orderedIndices.length && !unused.has(orderedIndices[orderedCursor])) {
      orderedCursor += 1;
    }
    const firstIndex = orderedIndices[orderedCursor];
    if (firstIndex === undefined) {
      break;
    }
    unused.delete(firstIndex);
    const first = segments[firstIndex];
    const vertices: PhysicsSpecVector2[] = [first.start, first.end];
    let current = first.end;
    let loop = false;

    while (true) {
      if (samePoint(current, vertices[0])) {
        vertices.pop();
        loop = vertices.length > 2;
        break;
      }
      const nextIndex = nextUnusedSegmentIndex(byStart.get(pointKey(current)) ?? [], unused);
      if (nextIndex === undefined) {
        break;
      }
      unused.delete(nextIndex);
      current = segments[nextIndex].end;
      vertices.push(current);
    }

    if (vertices.length >= 2) {
      paths.push({
        vertices,
        loop,
        segmentCount: loop ? vertices.length : vertices.length - 1,
      });
    }
  }
  return paths;
}

function nextUnusedSegmentIndex(indices: readonly number[], unused: ReadonlySet<number>): number | undefined {
  return indices.find((index) => unused.has(index));
}

function splitBoundaryPath(path: BoundaryPath, maxVertices: number): BoundaryPath[] {
  if (path.vertices.length <= maxVertices) {
    return [path];
  }
  const chunks: BoundaryPath[] = [];
  for (let start = 0; start < path.vertices.length - 1; start += maxVertices - 1) {
    const vertices = path.vertices.slice(start, start + maxVertices);
    if (vertices.length >= 2) {
      chunks.push({ vertices, loop: false, segmentCount: vertices.length - 1 });
    }
  }
  if (path.loop) {
    const first = path.vertices[0];
    const last = path.vertices[path.vertices.length - 1];
    if (!samePoint(first, last)) {
      chunks.push({ vertices: [last, first], loop: false, segmentCount: 1 });
    }
  }
  return chunks;
}

function boundedMaxVertices(value: number | undefined, path: string): number {
  const maxVertices = value ?? DEFAULT_MAX_CHAIN_VERTICES;
  if (!Number.isInteger(maxVertices) || maxVertices < 2 || maxVertices > DEFAULT_MAX_CHAIN_VERTICES) {
    throw physicsSpecDiagnosticError(path, "must be an integer between 2 and 64");
  }
  return maxVertices;
}

function bodyIdPrefix(value: string | undefined): string {
  const prefix = value?.trim();
  return prefix && prefix.length > 0 ? prefix : DEFAULT_BODY_ID_PREFIX;
}

function pointKey(point: PhysicsSpecVector2): string {
  return `${point[0]},${point[1]}`;
}

function samePoint(a: PhysicsSpecVector2, b: PhysicsSpecVector2): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function pointOrder(a: PhysicsSpecVector2, b: PhysicsSpecVector2): number {
  return a[0] - b[0] || a[1] - b[1];
}
