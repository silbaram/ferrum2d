import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import type { AssetManifest } from "./assetLoader.js";
import type { ShooterAtlasFrameSpec, ShooterAtlasSpec } from "./gameSpecTypes.js";

export interface ScenePlacementSpriteAsset {
  readonly id: string;
  readonly label?: string;
  readonly width?: number;
  readonly height?: number;
  readonly thumbnailUrl?: string;
  readonly frames?: readonly ScenePlacementSpriteFrameAsset[];
}

export interface ScenePlacementSpriteFrameAsset {
  readonly id: string;
  readonly label?: string;
  readonly width?: number;
  readonly height?: number;
  readonly thumbnailUrl?: string;
  readonly frame?: ScenePlacementSpriteFrameRect;
}

export interface ScenePlacementSpriteFrameRect {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

export interface ScenePlacementSpriteAssetReference {
  readonly asset: string;
  readonly frame?: string;
  readonly path?: string;
}

export type ScenePlacementAssetDiagnosticCode =
  | "missingSpriteAsset"
  | "missingSpriteFrame";

export interface ScenePlacementAssetDiagnostic {
  readonly severity: "error";
  readonly code: ScenePlacementAssetDiagnosticCode;
  readonly path: string;
  readonly assetId: string;
  readonly frameId?: string;
  readonly message: string;
}

export interface ScenePlacementAssetProvider {
  listSpriteAssets(): readonly ScenePlacementSpriteAsset[];
  resolveSpriteAsset(id: string): ScenePlacementSpriteAsset | undefined;
  listSpriteFrames(assetId: string): readonly ScenePlacementSpriteFrameAsset[];
  resolveSpriteFrame(assetId: string, frameId: string): ScenePlacementSpriteFrameAsset | undefined;
  diagnoseSpriteAssetReference(reference: ScenePlacementSpriteAssetReference): readonly ScenePlacementAssetDiagnostic[];
}

export interface CreateScenePlacementAssetProviderOptions {
  path?: string;
}

export interface ScenePlacementProjectTextureEntry {
  readonly name: string;
  readonly url?: string;
  readonly textureId?: number;
}

export interface ScenePlacementProjectTextureRegistry {
  entries(): readonly ScenePlacementProjectTextureEntry[];
}

export interface ScenePlacementProjectTextureMetadata {
  readonly label?: string;
  readonly width?: number;
  readonly height?: number;
  readonly thumbnailUrl?: string;
}

export interface ScenePlacementProjectAtlasFrameContext {
  readonly frameName: string;
  readonly textureId: string;
  readonly frame: ShooterAtlasFrameSpec;
}

export interface CreateScenePlacementProjectAssetProviderOptions
  extends CreateScenePlacementAssetProviderOptions {
  readonly manifest?: Pick<AssetManifest, "textures">;
  readonly textures?: Record<string, string>;
  readonly textureRegistry?: ScenePlacementProjectTextureRegistry;
  readonly atlas?: Pick<ShooterAtlasSpec, "frames">;
  readonly textureMetadata?: Record<string, ScenePlacementProjectTextureMetadata>;
  readonly includeAtlasFrames?: boolean;
  readonly includeNumericAtlasTextures?: boolean;
  readonly frameId?: (context: ScenePlacementProjectAtlasFrameContext) => string;
  readonly frameLabel?: (context: ScenePlacementProjectAtlasFrameContext) => string | undefined;
}

export function createScenePlacementAssetProvider(
  assets: readonly ScenePlacementSpriteAsset[],
  options: CreateScenePlacementAssetProviderOptions = {},
): ScenePlacementAssetProvider {
  const path = options.path ?? "scenePlacementAssets";
  const byId = new Map<string, ScenePlacementSpriteAsset>();
  for (let index = 0; index < assets.length; index += 1) {
    const asset = normalizeScenePlacementSpriteAsset(assets[index], `${path}.${index}`);
    if (byId.has(asset.id)) {
      throw gameplayAuthoringDiagnosticError(`${path}.${index}.id`, `duplicates sprite asset '${asset.id}'`);
    }
    byId.set(asset.id, asset);
  }
  const list = Object.freeze([...byId.values()]);
  return {
    listSpriteAssets: () => list,
    resolveSpriteAsset: (id) => byId.get(id),
    listSpriteFrames: (assetId) => byId.get(assetId)?.frames ?? [],
    resolveSpriteFrame: (assetId, frameId) => byId.get(assetId)?.frames?.find((frame) => frame.id === frameId),
    diagnoseSpriteAssetReference: (reference) => diagnoseSpriteAssetReference(byId, reference),
  };
}

export function createScenePlacementAssetProviderFromProjectAssets(
  options: CreateScenePlacementProjectAssetProviderOptions = {},
): ScenePlacementAssetProvider {
  const path = options.path ?? "scenePlacementProjectAssets";
  const assets = new Map<string, MutableScenePlacementSpriteAsset>();
  appendProjectTextureMap(assets, options.textures, options, `${path}.textures`);
  appendProjectTextureMap(assets, options.manifest?.textures, options, `${path}.manifest.textures`);
  appendProjectTextureRegistry(assets, options, `${path}.textureRegistry`);
  if (options.includeAtlasFrames !== false) {
    appendProjectAtlasFrames(assets, options, `${path}.atlas`);
  }
  return createScenePlacementAssetProvider([...assets.values()], options);
}

interface MutableScenePlacementSpriteAsset {
  id: string;
  label?: string;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  frames?: ScenePlacementSpriteFrameAsset[];
}

function appendProjectTextureMap(
  assets: Map<string, MutableScenePlacementSpriteAsset>,
  textures: Record<string, string> | undefined,
  options: CreateScenePlacementProjectAssetProviderOptions,
  path: string,
): void {
  if (textures === undefined) {
    return;
  }
  for (const [id, url] of Object.entries(textures)) {
    upsertProjectTextureAsset(
      assets,
      requiredAssetString(id, `${path}.${id}.id`),
      requiredAssetString(url, `${path}.${id}`),
      options,
    );
  }
}

function appendProjectTextureRegistry(
  assets: Map<string, MutableScenePlacementSpriteAsset>,
  options: CreateScenePlacementProjectAssetProviderOptions,
  path: string,
): void {
  const entries = options.textureRegistry?.entries();
  if (entries === undefined) {
    return;
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    upsertProjectTextureAsset(
      assets,
      requiredAssetString(entry.name, `${path}.${index}.name`),
      entry.url === undefined ? undefined : requiredAssetString(entry.url, `${path}.${index}.url`),
      options,
    );
  }
}

function appendProjectAtlasFrames(
  assets: Map<string, MutableScenePlacementSpriteAsset>,
  options: CreateScenePlacementProjectAssetProviderOptions,
  path: string,
): void {
  const frames = options.atlas?.frames;
  if (frames === undefined) {
    return;
  }
  for (const [frameName, frame] of Object.entries(frames)) {
    const framePath = `${path}.frames.${frameName}`;
    const textureId = projectAtlasTextureId(frame.texture, options, `${framePath}.texture`);
    if (textureId === undefined) {
      continue;
    }
    const asset = upsertProjectTextureAsset(assets, textureId, undefined, options);
    const context: ScenePlacementProjectAtlasFrameContext = { frameName, textureId, frame };
    const frameAsset: ScenePlacementSpriteFrameAsset = {
      id: requiredAssetString(options.frameId?.(context) ?? frameName, `${framePath}.id`),
      ...(options.frameLabel === undefined
        ? { label: frameName }
        : optionalLabel(options.frameLabel(context), `${framePath}.label`)),
      ...optionalAtlasFrameSize(frame.size, `${framePath}.size`),
      ...(asset.thumbnailUrl === undefined ? {} : { thumbnailUrl: asset.thumbnailUrl }),
      ...optionalAtlasFrameRect(frame.uv, `${framePath}.uv`),
    };
    if (
      asset.width === undefined
      && asset.height === undefined
      && frameAsset.width !== undefined
      && frameAsset.height !== undefined
      && frameAsset.frame?.u0 === 0
      && frameAsset.frame.v0 === 0
      && frameAsset.frame.u1 === 1
      && frameAsset.frame.v1 === 1
    ) {
      asset.width = frameAsset.width;
      asset.height = frameAsset.height;
    }
    if (asset.frames === undefined) {
      asset.frames = [];
    }
    asset.frames.push(frameAsset);
  }
}

function upsertProjectTextureAsset(
  assets: Map<string, MutableScenePlacementSpriteAsset>,
  id: string,
  url: string | undefined,
  options: CreateScenePlacementProjectAssetProviderOptions,
): MutableScenePlacementSpriteAsset {
  const metadata = options.textureMetadata?.[id];
  const existing = assets.get(id);
  if (existing !== undefined) {
    mergeProjectTextureMetadata(existing, url, metadata);
    return existing;
  }
  const asset: MutableScenePlacementSpriteAsset = { id };
  mergeProjectTextureMetadata(asset, url, metadata);
  assets.set(id, asset);
  return asset;
}

function mergeProjectTextureMetadata(
  asset: MutableScenePlacementSpriteAsset,
  url: string | undefined,
  metadata: ScenePlacementProjectTextureMetadata | undefined,
): void {
  if (metadata?.label !== undefined) {
    asset.label = requiredAssetString(metadata.label, `scenePlacementProjectAssets.${asset.id}.label`);
  }
  if (metadata?.width !== undefined) {
    asset.width = positiveAssetNumber(metadata.width, `scenePlacementProjectAssets.${asset.id}.width`);
  }
  if (metadata?.height !== undefined) {
    asset.height = positiveAssetNumber(metadata.height, `scenePlacementProjectAssets.${asset.id}.height`);
  }
  if (metadata?.thumbnailUrl !== undefined) {
    asset.thumbnailUrl = requiredAssetString(metadata.thumbnailUrl, `scenePlacementProjectAssets.${asset.id}.thumbnailUrl`);
  } else if (asset.thumbnailUrl === undefined && url !== undefined) {
    asset.thumbnailUrl = url;
  }
}

function projectAtlasTextureId(
  value: unknown,
  options: CreateScenePlacementProjectAssetProviderOptions,
  path: string,
): string | undefined {
  if (typeof value === "string") {
    return requiredAssetString(value, path);
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return options.includeNumericAtlasTextures === true ? String(value) : undefined;
  }
  if (value === undefined) {
    return undefined;
  }
  throw gameplayAuthoringDiagnosticError(path, "must be a texture asset id string");
}

function optionalLabel(value: string | undefined, path: string): { label?: string } {
  return value === undefined ? {} : { label: requiredAssetString(value, path) };
}

function optionalAtlasFrameSize(
  size: ShooterAtlasFrameSpec["size"],
  path: string,
): Pick<ScenePlacementSpriteFrameAsset, "width" | "height"> {
  if (size === undefined) {
    return {};
  }
  return {
    ...(size.width === undefined ? {} : { width: positiveAssetNumber(size.width, `${path}.width`) }),
    ...(size.height === undefined ? {} : { height: positiveAssetNumber(size.height, `${path}.height`) }),
  };
}

function optionalAtlasFrameRect(
  uv: ShooterAtlasFrameSpec["uv"],
  path: string,
): { frame?: ScenePlacementSpriteFrameRect } {
  if (uv === undefined) {
    return {};
  }
  return {
    frame: normalizeScenePlacementSpriteFrameRect(uv as ScenePlacementSpriteFrameRect, path),
  };
}

function normalizeScenePlacementSpriteAsset(
  asset: ScenePlacementSpriteAsset,
  path: string,
): ScenePlacementSpriteAsset {
  const id = requiredAssetString(asset.id, `${path}.id`);
  return Object.freeze({
    id,
    ...(asset.label === undefined ? {} : { label: requiredAssetString(asset.label, `${path}.label`) }),
    ...(asset.width === undefined ? {} : { width: positiveAssetNumber(asset.width, `${path}.width`) }),
    ...(asset.height === undefined ? {} : { height: positiveAssetNumber(asset.height, `${path}.height`) }),
    ...(asset.thumbnailUrl === undefined
      ? {}
      : { thumbnailUrl: requiredAssetString(asset.thumbnailUrl, `${path}.thumbnailUrl`) }),
    ...(asset.frames === undefined ? {} : { frames: normalizeScenePlacementSpriteFrames(asset.frames, `${path}.frames`) }),
  });
}

function normalizeScenePlacementSpriteFrames(
  frames: readonly ScenePlacementSpriteFrameAsset[],
  path: string,
): readonly ScenePlacementSpriteFrameAsset[] {
  if (!Array.isArray(frames)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an array");
  }
  const byId = new Set<string>();
  return Object.freeze(frames.map((frame, index) => {
    const normalized = normalizeScenePlacementSpriteFrame(frame, `${path}.${index}`);
    if (byId.has(normalized.id)) {
      throw gameplayAuthoringDiagnosticError(`${path}.${index}.id`, `duplicates sprite frame '${normalized.id}'`);
    }
    byId.add(normalized.id);
    return normalized;
  }));
}

function normalizeScenePlacementSpriteFrame(
  frame: ScenePlacementSpriteFrameAsset,
  path: string,
): ScenePlacementSpriteFrameAsset {
  const id = requiredAssetString(frame.id, `${path}.id`);
  return Object.freeze({
    id,
    ...(frame.label === undefined ? {} : { label: requiredAssetString(frame.label, `${path}.label`) }),
    ...(frame.width === undefined ? {} : { width: positiveAssetNumber(frame.width, `${path}.width`) }),
    ...(frame.height === undefined ? {} : { height: positiveAssetNumber(frame.height, `${path}.height`) }),
    ...(frame.thumbnailUrl === undefined
      ? {}
      : { thumbnailUrl: requiredAssetString(frame.thumbnailUrl, `${path}.thumbnailUrl`) }),
    ...(frame.frame === undefined ? {} : { frame: normalizeScenePlacementSpriteFrameRect(frame.frame, `${path}.frame`) }),
  });
}

function normalizeScenePlacementSpriteFrameRect(
  frame: ScenePlacementSpriteFrameRect,
  path: string,
): ScenePlacementSpriteFrameRect {
  const u0 = unitAssetNumber(frame.u0, `${path}.u0`);
  const v0 = unitAssetNumber(frame.v0, `${path}.v0`);
  const u1 = unitAssetNumber(frame.u1, `${path}.u1`);
  const v1 = unitAssetNumber(frame.v1, `${path}.v1`);
  if (u1 <= u0) {
    throw gameplayAuthoringDiagnosticError(`${path}.u1`, "must be greater than frame.u0");
  }
  if (v1 <= v0) {
    throw gameplayAuthoringDiagnosticError(`${path}.v1`, "must be greater than frame.v0");
  }
  return Object.freeze({ u0, v0, u1, v1 });
}

function diagnoseSpriteAssetReference(
  assets: ReadonlyMap<string, ScenePlacementSpriteAsset>,
  reference: ScenePlacementSpriteAssetReference,
): readonly ScenePlacementAssetDiagnostic[] {
  const assetId = requiredAssetString(reference.asset, `${reference.path ?? "scenePlacementAssetReference"}.asset`);
  const frameId = reference.frame === undefined
    ? undefined
    : requiredAssetString(reference.frame, `${reference.path ?? "scenePlacementAssetReference"}.frame`);
  const path = reference.path ?? `spriteAssets.${assetId}`;
  const asset = assets.get(assetId);
  if (asset === undefined) {
    return [Object.freeze({
      severity: "error",
      code: "missingSpriteAsset",
      path,
      assetId,
      message: `sprite asset '${assetId}' is not available in the placement asset provider`,
    })];
  }
  if (frameId !== undefined && asset.frames?.find((frame) => frame.id === frameId) === undefined) {
    return [Object.freeze({
      severity: "error",
      code: "missingSpriteFrame",
      path,
      assetId,
      frameId,
      message: `sprite asset '${assetId}' does not provide frame '${frameId}'`,
    })];
  }
  return [];
}

function requiredAssetString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-empty string");
  }
  return value.trim();
}

function positiveAssetNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a positive finite number");
  }
  return value;
}

function unitAssetNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw gameplayAuthoringDiagnosticError(path, "must be a finite number between 0 and 1");
  }
  return value;
}
