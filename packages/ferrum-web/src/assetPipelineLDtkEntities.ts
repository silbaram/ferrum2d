import { assetPipelineDiagnosticError } from "./diagnostics.js";
import type { LDtkEntityInstance } from "./assetPipelineTypes.js";
import {
  arrayValue,
  finiteNumber,
  objectValue,
  optionalArray,
  optionalBoolean,
  optionalString,
  positiveInteger,
  positiveNumber,
  requiredString,
} from "./assetPipelineValidation.js";
import {
  ldtkNumberPair,
  ldtkOptionalIntegerPair,
} from "./assetPipelineLDtkValues.js";

export function ldtkEntityLayer(
  value: unknown,
  options: {
    path: string;
    fallbackName: string;
    layerIndex: number;
    includeHiddenLayers: boolean;
    originX: number;
    originY: number;
  },
): LDtkEntityInstance[] {
  const layer = objectValue(value, options.path);
  const type = optionalString(layer.__type, `${options.path}.__type`) ?? "Tiles";
  if (type !== "Entities") {
    return [];
  }

  const visible = optionalBoolean(layer.visible, `${options.path}.visible`) ?? true;
  if (!visible && !options.includeHiddenLayers) {
    return [];
  }

  const name = optionalString(layer.__identifier, `${options.path}.__identifier`) ?? options.fallbackName;
  const gridSize = positiveNumber(layer.__gridSize, `${options.path}.__gridSize`);
  const offsetX = finiteNumber(layer.__pxTotalOffsetX, `${options.path}.__pxTotalOffsetX`, 0);
  const offsetY = finiteNumber(layer.__pxTotalOffsetY, `${options.path}.__pxTotalOffsetY`, 0);
  return arrayValue(layer.entityInstances, `${options.path}.entityInstances`).map((entry, index) => {
    return ldtkEntityInstance(entry, {
      path: `${options.path}.entityInstances.${index}`,
      layerName: name,
      layerIndex: options.layerIndex,
      gridSize,
      offsetX: options.originX + offsetX,
      offsetY: options.originY + offsetY,
    });
  });
}

function ldtkEntityInstance(
  value: unknown,
  options: {
    path: string;
    layerName: string;
    layerIndex: number;
    gridSize: number;
    offsetX: number;
    offsetY: number;
  },
): LDtkEntityInstance {
  const entity = objectValue(value, options.path);
  const [pxX, pxY] = ldtkNumberPair(entity.px, `${options.path}.px`);
  const [gridX, gridY] = ldtkOptionalIntegerPair(entity.__grid, `${options.path}.__grid`, [
    Math.floor(pxX / options.gridSize),
    Math.floor(pxY / options.gridSize),
  ]);
  const fields = ldtkEntityFields(entity.fieldInstances, `${options.path}.fieldInstances`);
  const defUid = entity.defUid === undefined
    ? undefined
    : positiveInteger(entity.defUid, `${options.path}.defUid`);

  return {
    identifier: requiredString(entity.__identifier, `${options.path}.__identifier`),
    ...(entity.iid === undefined ? {} : { iid: requiredString(entity.iid, `${options.path}.iid`) }),
    ...(defUid === undefined ? {} : { defUid }),
    layerName: options.layerName,
    layerIndex: options.layerIndex,
    x: options.offsetX + pxX,
    y: options.offsetY + pxY,
    gridX,
    gridY,
    width: positiveNumber(entity.width, `${options.path}.width`),
    height: positiveNumber(entity.height, `${options.path}.height`),
    fields: fields.values,
    fieldTypes: fields.types,
  };
}

function ldtkEntityFields(value: unknown, path: string): {
  values: Record<string, unknown>;
  types: Record<string, string>;
} {
  const fields: Record<string, unknown> = {};
  const types: Record<string, string> = {};
  for (const [index, entry] of optionalArray(value, path).entries()) {
    const fieldPath = `${path}.${index}`;
    const field = objectValue(entry, fieldPath);
    const identifier = requiredString(field.__identifier, `${fieldPath}.__identifier`);
    if (Object.prototype.hasOwnProperty.call(fields, identifier)) {
      throw assetPipelineDiagnosticError(`${fieldPath}.__identifier`, `duplicate LDtk entity field '${identifier}'`);
    }
    fields[identifier] = field.__value;
    const type = optionalString(field.__type, `${fieldPath}.__type`);
    if (type !== undefined) {
      types[identifier] = type;
    }
  }
  return { values: fields, types };
}
