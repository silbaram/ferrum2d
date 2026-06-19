import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import type { ResolvedSceneCompositionInstance } from "./sceneComposition.js";

export const DATA_SCENE_COMPONENTS_PROP = "components" as const;
export const DATA_SCENE_MAX_CONVEX_POLYGON_VERTICES = 16 as const;
export const DATA_SCENE_DEFAULT_PRIMITIVE_SIZE = 32 as const;
export const DATA_SCENE_DEFAULT_POINT_SIZE = 12 as const;

export const DATA_SCENE_PRIMITIVE_TEXTURES = Object.freeze({
  rect: "__ferrum2d.primitive.rect",
  circle: "__ferrum2d.primitive.circle",
  point: "__ferrum2d.primitive.point",
} as const);

export const DATA_SCENE_COLLISION_LAYER_CODES = Object.freeze({
  player: 0,
  enemy: 1,
  bullet: 2,
  wall: 3,
  pickup: 4,
} as const);

const DATA_SCENE_COLLISION_LAYER_NAMES = Object.freeze([
  "player",
  "enemy",
  "bullet",
  "wall",
  "pickup",
] as const);

export type DataSceneCollisionLayerName = keyof typeof DATA_SCENE_COLLISION_LAYER_CODES;
export type DataSceneCollisionLayerSpec = DataSceneCollisionLayerName | number;
export type DataSceneTextureRefSpec = string | number;
export type DataScenePrimitiveVisualShape = keyof typeof DATA_SCENE_PRIMITIVE_TEXTURES;

export interface DataSceneSpriteFrameSpec {
  u0?: number;
  v0?: number;
  u1?: number;
  v1?: number;
}

export interface DataSceneSpriteAnimationSpec {
  frameCount: number;
  fps: number;
}

export interface DataSceneSpriteComponentSpec {
  texture: DataSceneTextureRefSpec;
  width: number;
  height: number;
  frame?: DataSceneSpriteFrameSpec;
  animation?: DataSceneSpriteAnimationSpec;
}

export interface DataScenePrimitiveVisualSpec {
  kind: "primitive";
  shape: DataScenePrimitiveVisualShape;
  color?: string;
  width?: number;
  height?: number;
  radius?: number;
}

export interface DataSceneSpriteVisualSpec {
  kind: "sprite";
  texture?: DataSceneTextureRefSpec;
  asset?: DataSceneTextureRefSpec;
  width: number;
  height: number;
  frame?: DataSceneSpriteFrameSpec;
  animation?: DataSceneSpriteAnimationSpec;
  originX?: number;
  originY?: number;
  layer?: number;
  sortOrder?: number;
  tint?: string;
  color?: string;
}

export type DataSceneObjectVisualSpec =
  | DataScenePrimitiveVisualSpec
  | DataSceneSpriteVisualSpec;

export interface DataSceneColliderBaseSpec {
  offsetX?: number;
  offsetY?: number;
  enabled?: boolean;
  isTrigger?: boolean;
}

export interface DataSceneNoneColliderSpec {
  type: "none";
}

export interface DataSceneAabbColliderSpec extends DataSceneColliderBaseSpec {
  type: "aabb";
  halfWidth: number;
  halfHeight: number;
}

export interface DataSceneCircleColliderSpec extends DataSceneColliderBaseSpec {
  type: "circle";
  radius: number;
}

export interface DataSceneCapsuleColliderSpec extends DataSceneColliderBaseSpec {
  type: "capsule";
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  radius: number;
}

export interface DataSceneOrientedBoxColliderSpec extends DataSceneColliderBaseSpec {
  type: "orientedBox";
  halfWidth: number;
  halfHeight: number;
  rotationRadians?: number;
}

export interface DataSceneConvexPolygonVertexSpec {
  x: number;
  y: number;
}

export interface DataSceneConvexPolygonColliderSpec extends DataSceneColliderBaseSpec {
  type: "convexPolygon";
  vertices: readonly DataSceneConvexPolygonVertexSpec[];
  rotationRadians?: number;
}

export type DataSceneColliderComponentSpec =
  | "none"
  | DataSceneNoneColliderSpec
  | DataSceneAabbColliderSpec
  | DataSceneCircleColliderSpec
  | DataSceneCapsuleColliderSpec
  | DataSceneOrientedBoxColliderSpec
  | DataSceneConvexPolygonColliderSpec;

export interface DataSceneComponentsSpec {
  template?: string;
  visual?: DataSceneObjectVisualSpec;
  sprite?: DataSceneSpriteComponentSpec;
  collider?: DataSceneColliderComponentSpec;
  layer?: DataSceneCollisionLayerSpec;
}

export interface ResolvedDataSceneTextureRef {
  kind: "asset" | "id";
  value: string | number;
  name?: string;
  id?: number;
}

export interface ResolvedDataSceneSpriteFrame {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface ResolvedDataSceneSpriteAnimation {
  frameCount: number;
  fps: number;
}

export interface ResolvedDataSceneSpriteComponent {
  texture: ResolvedDataSceneTextureRef;
  width: number;
  height: number;
  frame: ResolvedDataSceneSpriteFrame;
  animation?: ResolvedDataSceneSpriteAnimation;
}

export interface ResolvedDataSceneObjectVisualBounds {
  width: number;
  height: number;
}

export type ResolvedDataSceneObjectVisual =
  | {
      kind: "primitive";
      shape: DataScenePrimitiveVisualShape;
      color?: string;
      width: number;
      height: number;
      radius?: number;
      bounds: ResolvedDataSceneObjectVisualBounds;
    }
  | {
      kind: "sprite";
      texture: ResolvedDataSceneTextureRef;
      width: number;
      height: number;
      frame: ResolvedDataSceneSpriteFrame;
      animation?: ResolvedDataSceneSpriteAnimation;
      originX: number;
      originY: number;
      layer?: number;
      sortOrder?: number;
      tint?: string;
      color?: string;
      bounds: ResolvedDataSceneObjectVisualBounds;
    };

export interface ResolvedDataSceneCollisionLayer {
  name: DataSceneCollisionLayerName;
  code: number;
}

export interface ResolvedDataSceneColliderBase {
  offsetX: number;
  offsetY: number;
  enabled: boolean;
  isTrigger: boolean;
}

export type ResolvedDataSceneColliderComponent =
  | { type: "none" }
  | (ResolvedDataSceneColliderBase & { type: "aabb"; halfWidth: number; halfHeight: number })
  | (ResolvedDataSceneColliderBase & { type: "circle"; radius: number })
  | (ResolvedDataSceneColliderBase & {
      type: "capsule";
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      radius: number;
    })
  | (ResolvedDataSceneColliderBase & {
      type: "orientedBox";
      halfWidth: number;
      halfHeight: number;
      rotationRadians: number;
    })
  | (ResolvedDataSceneColliderBase & {
      type: "convexPolygon";
      vertices: readonly ResolvedDataSceneConvexPolygonVertex[];
      rotationRadians: number;
    });

export interface ResolvedDataSceneConvexPolygonVertex {
  x: number;
  y: number;
}

export type ResolvedDataSceneComponents =
  | {
      mode: "template";
      template: string;
    }
  | {
      mode: "inline";
      visual: ResolvedDataSceneObjectVisual;
      sprite: ResolvedDataSceneSpriteComponent;
      collider: ResolvedDataSceneColliderComponent;
      layer: ResolvedDataSceneCollisionLayer;
    };

export interface ResolveDataSceneComponentsOptions {
  path?: string;
  allowTemplate?: boolean;
}

export interface ResolveDataSceneInstanceComponentsOptions {
  path?: string;
  allowTemplate?: boolean;
}

export function resolveDataSceneComponentsSpec(
  spec: unknown,
  options: ResolveDataSceneComponentsOptions = {},
): ResolvedDataSceneComponents {
  const path = options.path ?? DATA_SCENE_COMPONENTS_PROP;
  const components = requiredRecord(spec, path);
  const template = optionalString(components.template, `${path}.template`);

  if (template !== undefined) {
    rejectTemplateMixedWithInlineFields(components, path);
    if (options.allowTemplate === false) {
      throw sceneCompositionDiagnosticError(
        `${path}.template`,
        "is not supported here; provide inline sprite, collider, and layer components",
      );
    }
    return {
      mode: "template",
      template,
    };
  }

  return {
    mode: "inline",
    ...resolveInlineVisualComponents(components, path),
    collider: resolveColliderComponent(requiredProperty(components, "collider", path), `${path}.collider`),
    layer: resolveCollisionLayer(requiredProperty(components, "layer", path), `${path}.layer`),
  };
}

export function dataSceneObjectVisualBounds(
  components: Extract<ResolvedDataSceneComponents, { mode: "inline" }>,
): ResolvedDataSceneObjectVisualBounds {
  return {
    width: components.visual.bounds.width,
    height: components.visual.bounds.height,
  };
}

export function resolveDataSceneInstanceComponents(
  instance: ResolvedSceneCompositionInstance,
  options: ResolveDataSceneInstanceComponentsOptions = {},
): ResolvedDataSceneComponents {
  const path = options.path ?? `sceneComposition.instances.${instance.id}`;
  return resolveDataSceneComponentsSpec(instance.props[DATA_SCENE_COMPONENTS_PROP], {
    allowTemplate: options.allowTemplate,
    path: `${path}.props.${DATA_SCENE_COMPONENTS_PROP}`,
  });
}

function rejectTemplateMixedWithInlineFields(
  components: Readonly<Record<string, unknown>>,
  path: string,
): void {
  for (const key of ["visual", "sprite", "collider", "layer"] as const) {
    if (components[key] !== undefined) {
      throw sceneCompositionDiagnosticError(
        `${path}.${key}`,
        "must not be provided when components.template references a catalog template",
      );
    }
  }
}

function resolveInlineVisualComponents(
  components: Readonly<Record<string, unknown>>,
  path: string,
): { visual: ResolvedDataSceneObjectVisual; sprite: ResolvedDataSceneSpriteComponent } {
  if (components.visual !== undefined && components.sprite !== undefined) {
    throw sceneCompositionDiagnosticError(
      `${path}.visual`,
      "must not be provided together with legacy components.sprite",
    );
  }
  if (components.visual !== undefined) {
    const visual = resolveObjectVisual(components.visual, `${path}.visual`);
    return {
      visual,
      sprite: runtimeSpriteForVisual(visual),
    };
  }
  const sprite = resolveSpriteComponent(requiredProperty(components, "sprite", path), `${path}.sprite`);
  return {
    visual: spriteVisualFromResolvedSprite(sprite),
    sprite,
  };
}

function resolveObjectVisual(value: unknown, path: string): ResolvedDataSceneObjectVisual {
  const visual = requiredRecord(value, path);
  const kind = requiredString(visual.kind, `${path}.kind`);
  switch (kind) {
    case "primitive":
      return resolvePrimitiveVisual(visual, path);
    case "sprite":
      return resolveSpriteVisual(visual, path);
    default:
      throw sceneCompositionDiagnosticError(`${path}.kind`, "must be one of primitive or sprite");
  }
}

function resolvePrimitiveVisual(
  visual: Readonly<Record<string, unknown>>,
  path: string,
): Extract<ResolvedDataSceneObjectVisual, { kind: "primitive" }> {
  const shape = requiredPrimitiveVisualShape(visual.shape, `${path}.shape`);
  const color = optionalString(visual.color, `${path}.color`);
  if (shape === "circle") {
    const radius = positiveNumber(visual.radius ?? DATA_SCENE_DEFAULT_PRIMITIVE_SIZE * 0.5, `${path}.radius`);
    const size = radius * 2;
    return {
      kind: "primitive",
      shape,
      ...(color === undefined ? {} : { color }),
      width: size,
      height: size,
      radius,
      bounds: { width: size, height: size },
    };
  }
  if (shape === "point") {
    const size = positiveNumber(visual.width ?? visual.height ?? DATA_SCENE_DEFAULT_POINT_SIZE, `${path}.width`);
    return {
      kind: "primitive",
      shape,
      ...(color === undefined ? {} : { color }),
      width: size,
      height: size,
      bounds: { width: size, height: size },
    };
  }
  const width = positiveNumber(visual.width ?? DATA_SCENE_DEFAULT_PRIMITIVE_SIZE, `${path}.width`);
  const height = positiveNumber(visual.height ?? DATA_SCENE_DEFAULT_PRIMITIVE_SIZE, `${path}.height`);
  return {
    kind: "primitive",
    shape,
    ...(color === undefined ? {} : { color }),
    width,
    height,
    bounds: { width, height },
  };
}

function resolveSpriteVisual(
  visual: Readonly<Record<string, unknown>>,
  path: string,
): Extract<ResolvedDataSceneObjectVisual, { kind: "sprite" }> {
  const textureValue = visual.texture ?? visual.asset;
  const sprite = resolveSpriteComponent({
    texture: textureValue,
    width: visual.width,
    height: visual.height,
    ...(visual.frame === undefined ? {} : { frame: visual.frame }),
    ...(visual.animation === undefined ? {} : { animation: visual.animation }),
  }, path);
  const originX = finiteNumber(visual.originX ?? 0.5, `${path}.originX`);
  const originY = finiteNumber(visual.originY ?? 0.5, `${path}.originY`);
  const layer = visual.layer === undefined ? undefined : finiteNumber(visual.layer, `${path}.layer`);
  const sortOrder = visual.sortOrder === undefined ? undefined : finiteNumber(visual.sortOrder, `${path}.sortOrder`);
  const tint = optionalString(visual.tint, `${path}.tint`);
  const color = optionalString(visual.color, `${path}.color`);
  return {
    kind: "sprite",
    texture: sprite.texture,
    width: sprite.width,
    height: sprite.height,
    frame: sprite.frame,
    ...(sprite.animation === undefined ? {} : { animation: sprite.animation }),
    originX,
    originY,
    ...(layer === undefined ? {} : { layer }),
    ...(sortOrder === undefined ? {} : { sortOrder }),
    ...(tint === undefined ? {} : { tint }),
    ...(color === undefined ? {} : { color }),
    bounds: { width: sprite.width, height: sprite.height },
  };
}

function runtimeSpriteForVisual(visual: ResolvedDataSceneObjectVisual): ResolvedDataSceneSpriteComponent {
  if (visual.kind === "sprite") {
    return {
      texture: visual.texture,
      width: visual.width,
      height: visual.height,
      frame: visual.frame,
      ...(visual.animation === undefined ? {} : { animation: visual.animation }),
    };
  }
  return {
    texture: {
      kind: "asset",
      value: DATA_SCENE_PRIMITIVE_TEXTURES[visual.shape],
      name: DATA_SCENE_PRIMITIVE_TEXTURES[visual.shape],
    },
    width: visual.width,
    height: visual.height,
    frame: { u0: 0, v0: 0, u1: 1, v1: 1 },
  };
}

function spriteVisualFromResolvedSprite(
  sprite: ResolvedDataSceneSpriteComponent,
): Extract<ResolvedDataSceneObjectVisual, { kind: "sprite" }> {
  return {
    kind: "sprite",
    texture: sprite.texture,
    width: sprite.width,
    height: sprite.height,
    frame: sprite.frame,
    ...(sprite.animation === undefined ? {} : { animation: sprite.animation }),
    originX: 0.5,
    originY: 0.5,
    bounds: { width: sprite.width, height: sprite.height },
  };
}

function resolveSpriteComponent(value: unknown, path: string): ResolvedDataSceneSpriteComponent {
  const sprite = requiredRecord(value, path);
  const animationValue = sprite.animation;
  return {
    texture: resolveTextureRef(requiredProperty(sprite, "texture", path), `${path}.texture`),
    width: positiveNumber(requiredProperty(sprite, "width", path), `${path}.width`),
    height: positiveNumber(requiredProperty(sprite, "height", path), `${path}.height`),
    frame: resolveSpriteFrame(sprite.frame, `${path}.frame`),
    ...(animationValue === undefined
      ? {}
      : { animation: resolveSpriteAnimation(animationValue, `${path}.animation`) }),
  };
}

function resolveTextureRef(value: unknown, path: string): ResolvedDataSceneTextureRef {
  if (typeof value === "string" && value.length > 0) {
    return {
      kind: "asset",
      value,
      name: value,
    };
  }
  if (isU32(value)) {
    return {
      kind: "id",
      value,
      id: value,
    };
  }
  throw sceneCompositionDiagnosticError(path, "must be a non-empty texture asset id string or non-negative u32 texture id");
}

function resolveSpriteFrame(value: unknown, path: string): ResolvedDataSceneSpriteFrame {
  if (value === undefined) {
    return {
      u0: 0,
      v0: 0,
      u1: 1,
      v1: 1,
    };
  }
  const frame = requiredRecord(value, path);
  const u0 = unitNumber(frame.u0 ?? 0, `${path}.u0`);
  const v0 = unitNumber(frame.v0 ?? 0, `${path}.v0`);
  const u1 = unitNumber(frame.u1 ?? 1, `${path}.u1`);
  const v1 = unitNumber(frame.v1 ?? 1, `${path}.v1`);
  if (u1 <= u0) {
    throw sceneCompositionDiagnosticError(`${path}.u1`, "must be greater than frame.u0");
  }
  if (v1 <= v0) {
    throw sceneCompositionDiagnosticError(`${path}.v1`, "must be greater than frame.v0");
  }
  return { u0, v0, u1, v1 };
}

function resolveSpriteAnimation(value: unknown, path: string): ResolvedDataSceneSpriteAnimation {
  const animation = requiredRecord(value, path);
  return {
    frameCount: positiveInteger(requiredProperty(animation, "frameCount", path), `${path}.frameCount`),
    fps: positiveNumber(requiredProperty(animation, "fps", path), `${path}.fps`),
  };
}

function resolveColliderComponent(value: unknown, path: string): ResolvedDataSceneColliderComponent {
  if (value === "none") {
    return { type: "none" };
  }
  const collider = requiredRecord(value, path);
  const type = requiredString(collider.type, `${path}.type`);
  if (type === "none") {
    return { type: "none" };
  }
  const base = resolveColliderBase(collider, path);
  switch (type) {
    case "aabb":
      return {
        type,
        ...base,
        halfWidth: positiveNumber(requiredProperty(collider, "halfWidth", path), `${path}.halfWidth`),
        halfHeight: positiveNumber(requiredProperty(collider, "halfHeight", path), `${path}.halfHeight`),
      };
    case "circle":
      return {
        type,
        ...base,
        radius: positiveNumber(requiredProperty(collider, "radius", path), `${path}.radius`),
      };
    case "capsule":
      return {
        type,
        ...base,
        startX: finiteNumber(requiredProperty(collider, "startX", path), `${path}.startX`),
        startY: finiteNumber(requiredProperty(collider, "startY", path), `${path}.startY`),
        endX: finiteNumber(requiredProperty(collider, "endX", path), `${path}.endX`),
        endY: finiteNumber(requiredProperty(collider, "endY", path), `${path}.endY`),
        radius: positiveNumber(requiredProperty(collider, "radius", path), `${path}.radius`),
      };
    case "orientedBox":
      return {
        type,
        ...base,
        halfWidth: positiveNumber(requiredProperty(collider, "halfWidth", path), `${path}.halfWidth`),
        halfHeight: positiveNumber(requiredProperty(collider, "halfHeight", path), `${path}.halfHeight`),
        rotationRadians: finiteNumber(collider.rotationRadians ?? 0, `${path}.rotationRadians`),
      };
    case "convexPolygon":
      return {
        type,
        ...base,
        vertices: resolveConvexPolygonVertices(requiredProperty(collider, "vertices", path), `${path}.vertices`),
        rotationRadians: finiteNumber(collider.rotationRadians ?? 0, `${path}.rotationRadians`),
      };
    default:
      throw sceneCompositionDiagnosticError(
        `${path}.type`,
        "must be one of none, aabb, circle, capsule, orientedBox, or convexPolygon",
      );
  }
}

function resolveColliderBase(value: Readonly<Record<string, unknown>>, path: string): ResolvedDataSceneColliderBase {
  return {
    offsetX: finiteNumber(value.offsetX ?? 0, `${path}.offsetX`),
    offsetY: finiteNumber(value.offsetY ?? 0, `${path}.offsetY`),
    enabled: booleanValue(value.enabled ?? true, `${path}.enabled`),
    isTrigger: booleanValue(value.isTrigger ?? true, `${path}.isTrigger`),
  };
}

function resolveConvexPolygonVertices(
  value: unknown,
  path: string,
): readonly ResolvedDataSceneConvexPolygonVertex[] {
  if (!Array.isArray(value)) {
    throw sceneCompositionDiagnosticError(path, "must be an array");
  }
  if (value.length < 3 || value.length > DATA_SCENE_MAX_CONVEX_POLYGON_VERTICES) {
    throw sceneCompositionDiagnosticError(
      path,
      `must contain between 3 and ${DATA_SCENE_MAX_CONVEX_POLYGON_VERTICES} vertices`,
    );
  }
  return value.map((entry, index) => {
    const vertex = requiredRecord(entry, `${path}.${index}`);
    return {
      x: finiteNumber(requiredProperty(vertex, "x", `${path}.${index}`), `${path}.${index}.x`),
      y: finiteNumber(requiredProperty(vertex, "y", `${path}.${index}`), `${path}.${index}.y`),
    };
  });
}

function resolveCollisionLayer(value: unknown, path: string): ResolvedDataSceneCollisionLayer {
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(DATA_SCENE_COLLISION_LAYER_CODES, value)) {
    return {
      name: value as DataSceneCollisionLayerName,
      code: DATA_SCENE_COLLISION_LAYER_CODES[value as DataSceneCollisionLayerName],
    };
  }
  if (Number.isInteger(value) && typeof value === "number") {
    const name = DATA_SCENE_COLLISION_LAYER_NAMES[value];
    if (name !== undefined) {
      return {
        name,
        code: value,
      };
    }
  }
  throw sceneCompositionDiagnosticError(path, "must be one of player, enemy, bullet, wall, pickup, or layer code 0..4");
}

function requiredProperty(value: Readonly<Record<string, unknown>>, key: string, path: string): unknown {
  const property = value[key];
  if (property === undefined) {
    throw sceneCompositionDiagnosticError(`${path}.${key}`, "is required");
  }
  return property;
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw sceneCompositionDiagnosticError(path, "must be an object");
  }
  return value;
}

function requiredPrimitiveVisualShape(value: unknown, path: string): DataScenePrimitiveVisualShape {
  if (
    typeof value === "string"
    && Object.prototype.hasOwnProperty.call(DATA_SCENE_PRIMITIVE_TEXTURES, value)
  ) {
    return value as DataScenePrimitiveVisualShape;
  }
  throw sceneCompositionDiagnosticError(path, "must be one of rect, circle, or point");
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw sceneCompositionDiagnosticError(path, "must be a non-empty string");
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredString(value, path);
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throw sceneCompositionDiagnosticError(path, "must be a positive integer");
  }
  return value;
}

function positiveNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw sceneCompositionDiagnosticError(path, "must be a positive finite number");
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw sceneCompositionDiagnosticError(path, "must be a finite number");
  }
  return value;
}

function unitNumber(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (number < 0 || number > 1) {
    throw sceneCompositionDiagnosticError(path, "must be between 0 and 1");
  }
  return number;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw sceneCompositionDiagnosticError(path, "must be a boolean");
  }
  return value;
}

function isU32(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
