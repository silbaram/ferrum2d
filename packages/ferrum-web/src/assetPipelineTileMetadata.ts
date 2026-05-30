import { assetPipelineDiagnosticError } from "./diagnostics.js";
import type {
  ShooterTileKind,
  ShooterTileRampAxis,
  ShooterTileRampSpec,
  ShooterTileSlopeSpec,
  ShooterTileSpec,
} from "./gameSpec.js";
import {
  finiteNumber,
  nonNegativeInteger,
  nonNegativeNumber,
  normalizedNumber,
  optionalBoolean,
  requiredString,
} from "./assetPipelineValidation.js";
import type { JsonRecord } from "./assetPipelineValidation.js";

type TileHeightMetadata = Pick<ShooterTileSpec, "floor" | "elevation" | "height">;
type TileHd2dMetadata = Pick<
  ShooterTileSpec,
  "kind" | "ramp" | "bridgePortal" | "blocksMovement" | "blocksProjectile" | "blocksVision" | "occluderHeight"
>;
type MetadataProperty = { value: unknown; path: string } | undefined;

const TILE_KINDS = new Set<ShooterTileKind>(["flat", "stair", "ramp", "ledge", "bridge"]);
const TILE_RAMP_AXES = new Set<ShooterTileRampAxis>(["x", "y"]);

export function tileSlopeFromEndpointProperties(
  x0: { value: unknown; path: string } | undefined,
  y0: { value: unknown; path: string } | undefined,
  x1: { value: unknown; path: string } | undefined,
  y1: { value: unknown; path: string } | undefined,
  path: string,
): ShooterTileSlopeSpec | undefined {
  if (!x0 && !y0 && !x1 && !y1) {
    return undefined;
  }
  const slope = {
    x0: normalizedNumber(x0?.value, x0?.path ?? `${path}.slopeX0`),
    y0: normalizedNumber(y0?.value, y0?.path ?? `${path}.slopeY0`),
    x1: normalizedNumber(x1?.value, x1?.path ?? `${path}.slopeX1`),
    y1: normalizedNumber(y1?.value, y1?.path ?? `${path}.slopeY1`),
  };
  validateTileSlope(slope, `${path}.slopeX1`, "slopeX0");
  return slope;
}

export function tileSlopeFromRecord(value: JsonRecord, path: string): ShooterTileSlopeSpec {
  const slope = {
    x0: normalizedNumber(value.x0, `${path}.x0`),
    y0: normalizedNumber(value.y0, `${path}.y0`),
    x1: normalizedNumber(value.x1, `${path}.x1`),
    y1: normalizedNumber(value.y1, `${path}.y1`),
  };
  validateTileSlope(slope, `${path}.x1`, "slope.x0");
  return slope;
}

export function tileHeightMetadataFromProperties(
  floor: MetadataProperty,
  elevation: MetadataProperty,
  height: MetadataProperty,
): TileHeightMetadata | undefined {
  if (!floor && !elevation && !height) {
    return undefined;
  }
  return {
    ...(floor ? { floor: requiredString(floor.value, floor.path) } : {}),
    ...(elevation ? { elevation: finiteNumber(elevation.value, elevation.path, 0) } : {}),
    ...(height ? { height: nonNegativeNumber(height.value, height.path) } : {}),
  };
}

export function tileHeightMetadataFromRecord(value: JsonRecord, path: string): TileHeightMetadata | undefined {
  if (value.floor === undefined && value.elevation === undefined && value.height === undefined) {
    return undefined;
  }
  return {
    ...(value.floor === undefined ? {} : { floor: requiredString(value.floor, `${path}.floor`) }),
    ...(value.elevation === undefined ? {} : { elevation: finiteNumber(value.elevation, `${path}.elevation`, 0) }),
    ...(value.height === undefined ? {} : { height: nonNegativeNumber(value.height, `${path}.height`) }),
  };
}

export function tileHd2dMetadataFromProperties(
  kind: MetadataProperty,
  rampAxis: MetadataProperty,
  rampStartElevation: MetadataProperty,
  rampEndElevation: MetadataProperty,
  blocksMovement: MetadataProperty,
  blocksProjectile: MetadataProperty,
  blocksVision: MetadataProperty,
  occluderHeight: MetadataProperty,
): TileHd2dMetadata | undefined {
  const ramp = tileRampFromProperties(rampAxis, rampStartElevation, rampEndElevation);
  const hasMetadata = Boolean(
    kind
      || ramp
      || blocksMovement
      || blocksProjectile
      || blocksVision
      || occluderHeight,
  );
  if (!hasMetadata) {
    return undefined;
  }
  const resolvedKind = kind
    ? tileKind(requiredString(kind.value, kind.path), kind.path)
    : ramp
      ? "ramp"
      : undefined;
  return {
    ...(resolvedKind ? { kind: resolvedKind } : {}),
    ...(ramp ? { ramp } : {}),
    ...(blocksMovement ? { blocksMovement: optionalBoolean(blocksMovement.value, blocksMovement.path) } : {}),
    ...(blocksProjectile ? { blocksProjectile: optionalBoolean(blocksProjectile.value, blocksProjectile.path) } : {}),
    ...(blocksVision ? { blocksVision: optionalBoolean(blocksVision.value, blocksVision.path) } : {}),
    ...(occluderHeight ? { occluderHeight: nonNegativeNumber(occluderHeight.value, occluderHeight.path) } : {}),
  };
}

export function tileHd2dMetadataFromRecord(value: JsonRecord, path: string): TileHd2dMetadata | undefined {
  if (
    value.kind === undefined
    && value.ramp === undefined
    && value.bridgePortal === undefined
    && value.blocksMovement === undefined
    && value.blocksProjectile === undefined
    && value.blocksVision === undefined
    && value.occluderHeight === undefined
  ) {
    return undefined;
  }
  const ramp = value.ramp === undefined
    ? undefined
    : tileRampFromRecord(objectRecord(value.ramp, `${path}.ramp`), `${path}.ramp`);
  const resolvedKind = value.kind === undefined
    ? value.bridgePortal !== undefined
      ? "bridge"
      : ramp
      ? "ramp"
      : undefined
    : tileKind(requiredString(value.kind, `${path}.kind`), `${path}.kind`);
  const bridgePortal = value.bridgePortal === undefined
    ? undefined
    : tileBridgePortalFromRecord(objectRecord(value.bridgePortal, `${path}.bridgePortal`), `${path}.bridgePortal`);
  return {
    ...(resolvedKind ? { kind: resolvedKind } : {}),
    ...(ramp ? { ramp } : {}),
    ...(bridgePortal ? { bridgePortal } : {}),
    ...(value.blocksMovement === undefined
      ? {}
      : { blocksMovement: optionalBoolean(value.blocksMovement, `${path}.blocksMovement`) }),
    ...(value.blocksProjectile === undefined
      ? {}
      : { blocksProjectile: optionalBoolean(value.blocksProjectile, `${path}.blocksProjectile`) }),
    ...(value.blocksVision === undefined
      ? {}
      : { blocksVision: optionalBoolean(value.blocksVision, `${path}.blocksVision`) }),
    ...(value.occluderHeight === undefined
      ? {}
      : { occluderHeight: nonNegativeNumber(value.occluderHeight, `${path}.occluderHeight`) }),
  };
}

function tileBridgePortalFromRecord(value: JsonRecord, path: string): NonNullable<ShooterTileSpec["bridgePortal"]> {
  return {
    ...(value.lowerFloor === undefined ? {} : { lowerFloor: requiredString(value.lowerFloor, `${path}.lowerFloor`) }),
    ...(value.upperFloor === undefined ? {} : { upperFloor: requiredString(value.upperFloor, `${path}.upperFloor`) }),
    ...(value.lowerElevation === undefined
      ? {}
      : { lowerElevation: finiteNumber(value.lowerElevation, `${path}.lowerElevation`, 0) }),
    ...(value.upperElevation === undefined
      ? {}
      : { upperElevation: finiteNumber(value.upperElevation, `${path}.upperElevation`, 0) }),
    ...(value.navigationCost === undefined
      ? {}
      : { navigationCost: nonNegativeInteger(value.navigationCost, `${path}.navigationCost`) }),
  };
}

function tileRampFromProperties(
  axis: MetadataProperty,
  startElevation: MetadataProperty,
  endElevation: MetadataProperty,
): ShooterTileRampSpec | undefined {
  if (!axis && !startElevation && !endElevation) {
    return undefined;
  }
  return {
    ...(axis ? { axis: tileRampAxis(requiredString(axis.value, axis.path), axis.path) } : {}),
    ...(startElevation
      ? { startElevation: finiteNumber(startElevation.value, startElevation.path, 0) }
      : {}),
    ...(endElevation ? { endElevation: finiteNumber(endElevation.value, endElevation.path, 0) } : {}),
  };
}

function tileRampFromRecord(value: JsonRecord, path: string): ShooterTileRampSpec {
  return {
    ...(value.axis === undefined ? {} : { axis: tileRampAxis(requiredString(value.axis, `${path}.axis`), `${path}.axis`) }),
    ...(value.startElevation === undefined
      ? {}
      : { startElevation: finiteNumber(value.startElevation, `${path}.startElevation`, 0) }),
    ...(value.endElevation === undefined
      ? {}
      : { endElevation: finiteNumber(value.endElevation, `${path}.endElevation`, 0) }),
  };
}

function tileKind(value: string, path: string): ShooterTileKind {
  if (TILE_KINDS.has(value as ShooterTileKind)) {
    return value as ShooterTileKind;
  }
  throw assetPipelineDiagnosticError(path, "must be one of flat, stair, ramp, ledge, or bridge");
}

function tileRampAxis(value: string, path: string): ShooterTileRampAxis {
  if (TILE_RAMP_AXES.has(value as ShooterTileRampAxis)) {
    return value as ShooterTileRampAxis;
  }
  throw assetPipelineDiagnosticError(path, "must be x or y");
}

function objectRecord(value: unknown, path: string): JsonRecord {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  throw assetPipelineDiagnosticError(path, "must be an object");
}

function validateTileSlope(slope: ShooterTileSlopeSpec, path: string, x0Name: string): void {
  if (Math.abs((slope.x1 ?? 0) - (slope.x0 ?? 0)) <= 0.0001) {
    throw assetPipelineDiagnosticError(path, `must differ from ${x0Name}`);
  }
}
