import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import type { FerrumEngine } from "./engineTypes.js";
import {
  resolveDataSceneInstanceComponents,
  type ResolvedDataSceneColliderComponent,
  type ResolvedDataSceneComponents,
  type ResolvedDataSceneSpriteComponent,
} from "./dataSceneComponents.js";
import type { GameplayEntityHandle, SceneBehaviorRuntimeTarget } from "./gameplayAuthoring.js";
import type { ResolvedSceneCompositionInstance } from "./sceneComposition.js";

const DATA_SCENE_RUNTIME_ENGINE_ADAPTER = Symbol("ferrum2d.dataSceneRuntimeEngineAdapter");

const DATA_SCENE_COLLIDER_TYPE_NONE = 0;
const DATA_SCENE_COLLIDER_TYPE_AABB = 1;
const DATA_SCENE_COLLIDER_TYPE_CIRCLE = 2;
const DATA_SCENE_COLLIDER_TYPE_CAPSULE = 3;
const DATA_SCENE_COLLIDER_TYPE_ORIENTED_BOX = 4;
const DATA_SCENE_COLLIDER_TYPE_CONVEX_POLYGON = 5;

export type DataSceneRuntimeTextureIdResolver = (name: string) => number;

export interface CreateDataSceneRuntimeTargetOptions {
  path?: string;
  activateDataScene?: boolean;
  textureId?: DataSceneRuntimeTextureIdResolver;
}

export interface DataSceneRuntimeSpawnRequest {
  x: number;
  y: number;
  textureId: number;
  spriteWidth: number;
  spriteHeight: number;
  frameU0: number;
  frameV0: number;
  frameU1: number;
  frameV1: number;
  animationFrameCount: number;
  animationFps: number;
  layer: number;
  colliderType: number;
  colliderOffsetX: number;
  colliderOffsetY: number;
  colliderEnabled: boolean;
  colliderIsTrigger: boolean;
  colliderHalfWidth: number;
  colliderHalfHeight: number;
  colliderRadius: number;
  colliderStartX: number;
  colliderStartY: number;
  colliderEndX: number;
  colliderEndY: number;
  colliderRotationRadians: number;
  colliderVertices: Float32Array;
}

export interface DataSceneRuntimeEngineAdapter {
  useDataScene(): void;
  textureId(name: string): number;
  spawnDataSceneEntity(request: DataSceneRuntimeSpawnRequest): GameplayEntityHandle | undefined;
}

interface DataSceneRuntimeEngine {
  [DATA_SCENE_RUNTIME_ENGINE_ADAPTER]?: DataSceneRuntimeEngineAdapter;
}

export function attachDataSceneRuntimeEngineAdapter(
  engine: FerrumEngine,
  adapter: DataSceneRuntimeEngineAdapter,
): FerrumEngine {
  Object.defineProperty(engine, DATA_SCENE_RUNTIME_ENGINE_ADAPTER, {
    configurable: false,
    enumerable: false,
    value: adapter,
  });
  return engine;
}

export function createDataSceneRuntimeTarget(
  engine: FerrumEngine,
  options: CreateDataSceneRuntimeTargetOptions = {},
): SceneBehaviorRuntimeTarget {
  const path = options.path ?? "dataSceneRuntimeTarget";
  const adapter = dataSceneRuntimeEngineAdapter(engine, `${path}.engine`);
  const textureId = options.textureId ?? ((name: string) => adapter.textureId(name));
  let dataSceneActivated = false;

  const activateDataScene = (): void => {
    if (options.activateDataScene === false || dataSceneActivated) {
      return;
    }
    adapter.useDataScene();
    dataSceneActivated = true;
  };

  return {
    spawnSceneInstance: (instance) => {
      const request = dataSceneRuntimeSpawnRequest(instance, textureId, `${path}.instances.${instance.id}`);
      activateDataScene();
      const handle = adapter.spawnDataSceneEntity(request);
      if (handle === undefined) {
        throw sceneCompositionDiagnosticError(`${path}.instances.${instance.id}`, "failed to spawn data-scene entity");
      }
      return handle;
    },
  };
}

function dataSceneRuntimeEngineAdapter(engine: FerrumEngine, path: string): DataSceneRuntimeEngineAdapter {
  const adapter = (engine as DataSceneRuntimeEngine)[DATA_SCENE_RUNTIME_ENGINE_ADAPTER];
  if (adapter === undefined) {
    throw sceneCompositionDiagnosticError(
      path,
      "must be a FerrumEngine created by createEngine() from @ferrum2d/ferrum-web",
    );
  }
  return adapter;
}

function dataSceneRuntimeSpawnRequest(
  instance: ResolvedSceneCompositionInstance,
  textureId: DataSceneRuntimeTextureIdResolver,
  path: string,
): DataSceneRuntimeSpawnRequest {
  const components = resolveDataSceneInstanceComponents(instance, {
    allowTemplate: false,
    path,
  });
  rejectUnsupportedRuntimeTransform(instance, path);
  if (components.mode === "template") {
    throw sceneCompositionDiagnosticError(
      `${path}.props.components.template`,
      "is not supported by createDataSceneRuntimeTarget yet",
    );
  }

  return inlineDataSceneRuntimeSpawnRequest(instance, components, textureId);
}

function rejectUnsupportedRuntimeTransform(instance: ResolvedSceneCompositionInstance, path: string): void {
  if (instance.rotationRadians !== 0) {
    throw sceneCompositionDiagnosticError(
      `${path}.rotationRadians`,
      "is not supported by createDataSceneRuntimeTarget yet; keep instance rotation at 0 and use collider rotation descriptors where needed",
    );
  }
  if (instance.layer !== 0) {
    throw sceneCompositionDiagnosticError(
      `${path}.layer`,
      "is not supported by createDataSceneRuntimeTarget yet; use props.components.layer for collision layer",
    );
  }
}

function inlineDataSceneRuntimeSpawnRequest(
  instance: ResolvedSceneCompositionInstance,
  components: Extract<ResolvedDataSceneComponents, { mode: "inline" }>,
  textureId: DataSceneRuntimeTextureIdResolver,
): DataSceneRuntimeSpawnRequest {
  const scale = instance.scale;
  const sprite = components.sprite;
  const collider = components.collider;
  const colliderShape = colliderRuntimeShape(collider, scale, instance.rotationRadians);
  return {
    x: instance.x,
    y: instance.y,
    textureId: dataSceneTextureId(sprite, textureId),
    spriteWidth: sprite.width * scale,
    spriteHeight: sprite.height * scale,
    frameU0: sprite.frame.u0,
    frameV0: sprite.frame.v0,
    frameU1: sprite.frame.u1,
    frameV1: sprite.frame.v1,
    animationFrameCount: sprite.animation?.frameCount ?? 0,
    animationFps: sprite.animation?.fps ?? 0,
    layer: components.layer.code,
    colliderType: colliderShape.type,
    colliderOffsetX: colliderShape.offsetX,
    colliderOffsetY: colliderShape.offsetY,
    colliderEnabled: colliderShape.enabled,
    colliderIsTrigger: colliderShape.isTrigger,
    colliderHalfWidth: colliderShape.halfWidth,
    colliderHalfHeight: colliderShape.halfHeight,
    colliderRadius: colliderShape.radius,
    colliderStartX: colliderShape.startX,
    colliderStartY: colliderShape.startY,
    colliderEndX: colliderShape.endX,
    colliderEndY: colliderShape.endY,
    colliderRotationRadians: colliderShape.rotationRadians,
    colliderVertices: colliderShape.vertices,
  };
}

function dataSceneTextureId(
  sprite: ResolvedDataSceneSpriteComponent,
  textureId: DataSceneRuntimeTextureIdResolver,
): number {
  if (sprite.texture.kind === "id") {
    return sprite.texture.id ?? Number(sprite.texture.value);
  }
  return textureId(sprite.texture.name ?? String(sprite.texture.value));
}

interface RuntimeColliderShape {
  type: number;
  offsetX: number;
  offsetY: number;
  enabled: boolean;
  isTrigger: boolean;
  halfWidth: number;
  halfHeight: number;
  radius: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  rotationRadians: number;
  vertices: Float32Array;
}

function colliderRuntimeShape(
  collider: ResolvedDataSceneColliderComponent,
  scale: number,
  rotationRadians: number,
): RuntimeColliderShape {
  const base = colliderBase(collider, scale, rotationRadians);
  switch (collider.type) {
    case "none":
      return base;
    case "aabb":
      if (rotationRadians !== 0) {
        return {
          ...base,
          type: DATA_SCENE_COLLIDER_TYPE_ORIENTED_BOX,
          halfWidth: scaleNumber(collider.halfWidth, scale),
          halfHeight: scaleNumber(collider.halfHeight, scale),
          rotationRadians,
        };
      }
      return {
        ...base,
        type: DATA_SCENE_COLLIDER_TYPE_AABB,
        halfWidth: scaleNumber(collider.halfWidth, scale),
        halfHeight: scaleNumber(collider.halfHeight, scale),
      };
    case "circle":
      return {
        ...base,
        type: DATA_SCENE_COLLIDER_TYPE_CIRCLE,
        radius: scaleNumber(collider.radius, scale),
      };
    case "capsule": {
      const start = transformLocalPoint(collider.startX, collider.startY, scale, rotationRadians);
      const end = transformLocalPoint(collider.endX, collider.endY, scale, rotationRadians);
      return {
        ...base,
        type: DATA_SCENE_COLLIDER_TYPE_CAPSULE,
        radius: scaleNumber(collider.radius, scale),
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
      };
    }
    case "orientedBox":
      return {
        ...base,
        type: DATA_SCENE_COLLIDER_TYPE_ORIENTED_BOX,
        halfWidth: scaleNumber(collider.halfWidth, scale),
        halfHeight: scaleNumber(collider.halfHeight, scale),
        rotationRadians: collider.rotationRadians + rotationRadians,
      };
    case "convexPolygon":
      return {
        ...base,
        type: DATA_SCENE_COLLIDER_TYPE_CONVEX_POLYGON,
        rotationRadians: collider.rotationRadians + rotationRadians,
        vertices: new Float32Array(collider.vertices.flatMap((vertex) => [
          scaleNumber(vertex.x, scale),
          scaleNumber(vertex.y, scale),
        ])),
      };
  }
  const _exhaustive: never = collider;
  return _exhaustive;
}

function colliderBase(
  collider: ResolvedDataSceneColliderComponent,
  scale: number,
  rotationRadians: number,
): RuntimeColliderShape {
  if (collider.type === "none") {
    return {
      type: DATA_SCENE_COLLIDER_TYPE_NONE,
      offsetX: 0,
      offsetY: 0,
      enabled: false,
      isTrigger: true,
      halfWidth: 0,
      halfHeight: 0,
      radius: 0,
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      rotationRadians: 0,
      vertices: new Float32Array(),
    };
  }
  const offset = transformLocalPoint(collider.offsetX, collider.offsetY, scale, rotationRadians);
  return {
    type: DATA_SCENE_COLLIDER_TYPE_NONE,
    offsetX: offset.x,
    offsetY: offset.y,
    enabled: collider.enabled,
    isTrigger: collider.isTrigger,
    halfWidth: 0,
    halfHeight: 0,
    radius: 0,
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    rotationRadians: 0,
    vertices: new Float32Array(),
  };
}

function transformLocalPoint(
  x: number,
  y: number,
  scale: number,
  rotationRadians: number,
): { x: number; y: number } {
  const scaledX = scaleNumber(x, scale);
  const scaledY = scaleNumber(y, scale);
  if (rotationRadians === 0) {
    return { x: scaledX, y: scaledY };
  }
  const cos = Math.cos(rotationRadians);
  const sin = Math.sin(rotationRadians);
  return {
    x: scaledX * cos - scaledY * sin,
    y: scaledX * sin + scaledY * cos,
  };
}

function scaleNumber(value: number, scale: number): number {
  return value * scale;
}
