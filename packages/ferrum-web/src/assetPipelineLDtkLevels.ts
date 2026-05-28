import { assetPipelineDiagnosticError } from "./diagnostics.js";
import type { LDtkTilemapImportOptions } from "./assetPipelineTypes.js";
import {
  arrayValue,
  nonNegativeInteger,
  objectValue,
  optionalString,
  positiveNumber,
  requiredString,
} from "./assetPipelineValidation.js";
import type { JsonRecord } from "./assetPipelineValidation.js";
import { LDTK_ROOT_PATH } from "./assetPipelineLDtkConstants.js";

interface LDtkLevel {
  identifier: string;
  iid?: string;
  width: number;
  height: number;
  layers: unknown[];
  path: string;
}

export function ldtkLevel(root: JsonRecord, options: LDtkTilemapImportOptions): LDtkLevel {
  const levels = arrayValue(root.levels, `${LDTK_ROOT_PATH}.levels`);
  if (levels.length === 0) {
    throw assetPipelineDiagnosticError(`${LDTK_ROOT_PATH}.levels`, "must contain at least one level");
  }

  const selectorCount = [
    options.levelIdentifier,
    options.levelIid,
    options.levelIndex,
  ].filter((value) => value !== undefined).length;
  if (selectorCount > 1) {
    throw assetPipelineDiagnosticError(
      `${LDTK_ROOT_PATH}.level`,
      "select only one of levelIdentifier, levelIid, or levelIndex",
    );
  }

  const index = ldtkLevelIndex(levels, options);
  const levelPath = `${LDTK_ROOT_PATH}.levels.${index}`;
  const record = objectValue(levels[index], levelPath);
  const externalRelPath = optionalString(record.externalRelPath, `${levelPath}.externalRelPath`);
  const layerSource = ldtkLevelLayerSource(record, {
    levelPath,
    externalRelPath,
    externalLevels: options.externalLevels,
  });

  return {
    identifier: optionalString(record.identifier, `${levelPath}.identifier`) ?? `level-${index}`,
    iid: optionalString(record.iid, `${levelPath}.iid`),
    width: positiveNumber(record.pxWid, `${levelPath}.pxWid`),
    height: positiveNumber(record.pxHei, `${levelPath}.pxHei`),
    layers: layerSource.layers,
    path: layerSource.path,
  };
}

function ldtkLevelLayerSource(
  level: JsonRecord,
  options: {
    levelPath: string;
    externalRelPath: string | undefined;
    externalLevels: Record<string, unknown> | undefined;
  },
): { layers: unknown[]; path: string } {
  if (level.layerInstances !== null || options.externalRelPath === undefined) {
    return {
      layers: arrayValue(level.layerInstances, `${options.levelPath}.layerInstances`),
      path: options.levelPath,
    };
  }

  const externalLevel = options.externalLevels?.[options.externalRelPath];
  if (externalLevel === undefined) {
    throw assetPipelineDiagnosticError(
      `${options.levelPath}.layerInstances`,
      `external LDtk level ${options.externalRelPath} must be provided in options.externalLevels`,
    );
  }

  const externalPath = `${LDTK_ROOT_PATH}.externalLevels.${options.externalRelPath}`;
  const externalRecord = objectValue(externalLevel, externalPath);
  return {
    layers: arrayValue(externalRecord.layerInstances, `${externalPath}.layerInstances`),
    path: externalPath,
  };
}

function ldtkLevelIndex(levels: unknown[], options: LDtkTilemapImportOptions): number {
  if (options.levelIdentifier !== undefined) {
    const levelIdentifier = requiredString(options.levelIdentifier, `${LDTK_ROOT_PATH}.levelIdentifier`);
    const found = levels.findIndex((entry, index) => {
      const level = objectValue(entry, `${LDTK_ROOT_PATH}.levels.${index}`);
      return level.identifier === levelIdentifier;
    });
    if (found < 0) {
      throw assetPipelineDiagnosticError(`${LDTK_ROOT_PATH}.levelIdentifier`, `level '${levelIdentifier}' was not found`);
    }
    return found;
  }

  if (options.levelIid !== undefined) {
    const levelIid = requiredString(options.levelIid, `${LDTK_ROOT_PATH}.levelIid`);
    const found = levels.findIndex((entry, index) => {
      const level = objectValue(entry, `${LDTK_ROOT_PATH}.levels.${index}`);
      return level.iid === levelIid;
    });
    if (found < 0) {
      throw assetPipelineDiagnosticError(`${LDTK_ROOT_PATH}.levelIid`, `level iid '${levelIid}' was not found`);
    }
    return found;
  }

  if (options.levelIndex !== undefined) {
    const levelIndex = nonNegativeInteger(options.levelIndex, `${LDTK_ROOT_PATH}.levelIndex`);
    if (levelIndex >= levels.length) {
      throw assetPipelineDiagnosticError(`${LDTK_ROOT_PATH}.levelIndex`, "must reference an existing level");
    }
    return levelIndex;
  }

  return 0;
}
