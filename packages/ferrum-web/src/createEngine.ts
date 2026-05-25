import type { Engine } from "../pkg/ferrum_core";
import type { AssetLoadProgressCallback, AssetManifest, LoadedAssets } from "./assetLoader";
import { applyShooterGameSpec } from "./gameSpec";
import type { ResolvedShooterGameSpec, ShooterGameSpec } from "./gameSpec";
import { resolvePhysicsSpec } from "./physicsSpec.js";
import type { PhysicsDebugSpec, PhysicsMode, ResolvedPhysicsSpec } from "./physicsSpec.js";
import { finiteNumber, particlePresetId, resolveParticlePresetConfigForWasm, uint32Number } from "./particlePreset";
import type { ParticlePresetConfig } from "./particlePreset";
import { GameLoop } from "./gameLoop";
import type { InputSnapshot } from "./inputManager";
import {
  PHYSICS_BODY_STATE_BUFFER_FORMAT,
  PHYSICS_BODY_STATE_BUFFER_VERSION,
  PHYSICS_BODY_STATE_FLOATS_PER_BODY,
  PHYSICS_BODY_STATE_U32S_PER_BODY,
  validatePhysicsBodyStateBufferSnapshot,
} from "./physicsBodyStateBuffer.js";
import type { PhysicsBodyStateBufferSnapshot } from "./physicsBodyStateBuffer.js";
import { EMPTY_AUDIO_EVENTS } from "./wasmBridge";
import { EMPTY_COLLISION_EVENTS } from "./collisionEventDecoder";
import { EMPTY_PHYSICS_DEBUG_LINES } from "./physicsDebugLineDecoder";
import type {
  AudioEventBufferView,
  AudioEventView,
  CollisionEventBufferView,
  CollisionEventView,
  PhysicsBodyContactHit,
  PhysicsBodyManifoldHit,
  PhysicsBodyQueryHit,
  PhysicsDebugLineBufferView,
  PhysicsDebugLineView,
  PhysicsRaycastBodyHit,
  PhysicsRigidContactImpulseHit,
  PhysicsShapeCastBodyHit,
  PhysicsTileContactHit,
  PhysicsTileManifoldHit,
  PhysicsTileRaycastHit,
  PhysicsTileShapeCastHit,
  RenderCommandBufferView,
  RenderCommandView,
} from "./wasmBridge";
import { WasmBridge } from "./wasmBridge";

export {
  PHYSICS_BODY_STATE_BUFFER_FORMAT,
  PHYSICS_BODY_STATE_BUFFER_VERSION,
  PHYSICS_BODY_STATE_FLOATS_PER_BODY,
  PHYSICS_BODY_STATE_U32S_PER_BODY,
  createPhysicsBodyStateBufferSnapshot,
} from "./physicsBodyStateBuffer.js";
export type { PhysicsBodyStateBufferSnapshot } from "./physicsBodyStateBuffer.js";

export interface AssetHost {
  loadAssets(manifest: AssetManifest, onProgress?: AssetLoadProgressCallback): Promise<LoadedAssets>;
  textureId(name: string): number;
  soundId?(name: string): number;
  playAudioEventBuffer?(events: AudioEventBufferView): void;
  playAudioEvents?(events: readonly AudioEventView[]): void;
  configureAudio?(config: AudioBusConfig): void;
}

export interface AudioBusConfig {
  masterVolume: number;
  sfxVolume: number;
}

export interface ShooterTextureIds {
  player: number;
  enemy: number;
  bullet: number;
}

export interface ShooterSoundIds {
  shoot: number;
  hit: number;
  gameOver: number;
}

export interface FrameState {
  timeSeconds: number;
  frameTimeMs: number;
  rustUpdateTimeMs: number;
  score: number;
  entityCount: number;
  gameState: number;
  spriteCount: number;
  mouseX: number;
  mouseY: number;
  cameraX: number;
  cameraY: number;
  audioEventCount: number;
  audioEvents: readonly AudioEventView[];
  physics: PhysicsFrameStats;
  collisionEventBuffer: CollisionEventBufferView;
  collisionEvents: readonly CollisionEventView[];
  physicsDebugLineBuffer: PhysicsDebugLineBufferView;
  physicsDebugLines: readonly PhysicsDebugLineView[];
  /** @deprecated 호환성 유지용. hot path에서는 renderCommandBuffer를 사용하세요. */
  renderCommands: RenderCommandView[];
  renderCommandBuffer: RenderCommandBufferView;
}

export type FrameHandler = (state: FrameState) => void;

export interface FixedTimestepOptions {
  enabled?: boolean;
  stepSeconds?: number;
  maxFrameSeconds?: number;
  maxStepsPerUpdate?: number;
}

export interface PhysicsFrameStats {
  mode: PhysicsMode;
  gravityX: number;
  gravityY: number;
  continuous: boolean;
  fixedTimestepEnabled: boolean;
  fixedStepSeconds: number;
  fixedSteps: number;
  fixedAlpha: number;
  fixedConsumedSeconds: number;
  fixedDroppedSeconds: number;
  kinematicMoves: number;
  kinematicHits: number;
  kinematicEntityHits: number;
  kinematicTileHits: number;
  solidCandidateChecks: number;
  tileCandidateChecks: number;
  collisionPairs: number;
  collisionSolidPairs: number;
  collisionTriggerPairs: number;
  collisionEnterEvents: number;
  collisionStayEvents: number;
  collisionExitEvents: number;
  collisionHitEvents: number;
  collisionTriggerEnterEvents: number;
  collisionTriggerStayEvents: number;
  collisionTriggerExitEvents: number;
  collisionEventCount: number;
  ccdChecks: number;
  ccdHits: number;
  sleepingBodies: number;
  brokenJoints: number;
}

export type PhysicsDebugOptions = PhysicsDebugSpec;

export interface PhysicsRigidBodyStepOptions {
  gravityX?: number;
  gravityY?: number;
  velocityIterations?: number;
  positionIterations?: number;
  positionCorrectionPercent?: number;
  positionCorrectionSlop?: number;
  restitutionVelocityThreshold?: number;
  contactBaumgarteBiasFactor?: number;
  maxContactBaumgarteBiasVelocity?: number;
  contactSplitImpulse?: boolean;
}

export interface PhysicsRigidBodyStepStats {
  substeps: number;
  dynamicBodies: number;
  angularBodies: number;
  islandCount: number;
  islandBodies: number;
  activeIslands: number;
  sleepingIslands: number;
  largestIslandBodies: number;
  contactChecks: number;
  velocityImpulses: number;
  contactBlockSolves: number;
  baumgarteVelocityBiases: number;
  splitVelocityImpulses: number;
  restitutionVelocityThresholdSkips: number;
  warmStartImpulses: number;
  contactCacheEntries: number;
  sleepingBodies: number;
  bodiesPutToSleep: number;
  bodiesWoken: number;
  islandsWoken: number;
  islandsPutToSleep: number;
  ccdChecks: number;
  ccdHits: number;
  positionCorrections: number;
  splitPositionCorrections: number;
  constraintVelocityCorrections: number;
  constraintPositionCorrections: number;
  brokenJoints: number;
}

export type PhysicsRigidBodyType = "static" | "kinematic" | "dynamic";
export type PhysicsColliderType =
  | "none"
  | "aabb"
  | "circle"
  | "capsule"
  | "orientedBox"
  | "convexPolygon"
  | "edge"
  | "chain";
export type PhysicsCollisionLayer = "player" | "enemy" | "bullet" | "wall";

export interface PhysicsEntityHandle {
  entityId: number;
  entityGeneration: number;
}

export interface PhysicsRigidBodyMaterial {
  restitution?: number;
  friction?: number;
  surfaceVelocityX?: number;
  surfaceVelocityY?: number;
  density?: number;
  contactBaumgarteBiasScale?: number;
  maxContactBaumgarteBiasVelocityScale?: number;
  contactPositionCorrectionScale?: number;
  contactPositionCorrectionSlopScale?: number;
}

export interface PhysicsMaterialSnapshot {
  restitution: number;
  friction: number;
  surfaceVelocityX: number;
  surfaceVelocityY: number;
  density: number;
  contactBaumgarteBiasScale: number;
  maxContactBaumgarteBiasVelocityScale: number;
  contactPositionCorrectionScale: number;
  contactPositionCorrectionSlopScale: number;
}

export interface PhysicsRigidBodyMassProperties {
  mass: number;
  inertia: number;
}

export interface PhysicsRigidBodyTuning {
  gravityScale?: number;
  linearDamping?: number;
  angularDamping?: number;
}

export type PhysicsRigidBodyCollider =
  | {
      type: "aabb";
      halfWidth: number;
      halfHeight: number;
      offsetX?: number;
      offsetY?: number;
    }
  | {
      type: "circle";
      radius: number;
      offsetX?: number;
      offsetY?: number;
    }
  | {
      type: "capsule";
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      radius: number;
      offsetX?: number;
      offsetY?: number;
    }
  | {
      type: "edge";
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      offsetX?: number;
      offsetY?: number;
    }
  | {
      type: "chain";
      vertices: PhysicsConvexPolygonVertexBuffer;
      loop?: boolean;
      offsetX?: number;
      offsetY?: number;
    }
  | {
      type: "orientedBox";
      halfWidth: number;
      halfHeight: number;
      rotationRadians?: number;
      offsetX?: number;
      offsetY?: number;
    }
  | {
      type: "convexPolygon";
      vertices: PhysicsConvexPolygonVertexBuffer;
      rotationRadians?: number;
      offsetX?: number;
      offsetY?: number;
    };

export interface PhysicsRigidBodySpawnOptions {
  x: number;
  y: number;
  bodyType?: PhysicsRigidBodyType;
  collider: PhysicsRigidBodyCollider;
  mass?: number;
  density?: number;
  layer?: PhysicsCollisionLayer;
  categoryBits?: number;
  maskBits?: number;
  isTrigger?: boolean;
  colliderEnabled?: boolean;
  bodyEnabled?: boolean;
  canSleep?: boolean;
  velocityX?: number;
  velocityY?: number;
  rotationRadians?: number;
  angularVelocityRadiansPerSecond?: number;
  gravityScale?: number;
  linearDamping?: number;
  angularDamping?: number;
  material?: PhysicsRigidBodyMaterial;
  colliderMaterial?: PhysicsRigidBodyMaterial;
}

export interface PhysicsBodyColliderOptions {
  collider: PhysicsRigidBodyCollider;
  layer?: PhysicsCollisionLayer;
  categoryBits?: number;
  maskBits?: number;
  isTrigger?: boolean;
  colliderEnabled?: boolean;
}

export interface PhysicsBodyColliderSnapshot {
  colliderIndex: number;
  colliderType: PhysicsColliderType;
  colliderEnabled: boolean;
  colliderIsTrigger: boolean;
  colliderOffsetX: number;
  colliderOffsetY: number;
  colliderMaterialOverride: boolean;
  colliderMaterial: PhysicsMaterialSnapshot;
  categoryBits: number;
  maskBits: number;
}

export interface PhysicsEntitySnapshot extends PhysicsEntityHandle {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  rotationRadians: number;
  angularVelocityRadiansPerSecond: number;
  bodyType: PhysicsRigidBodyType;
  bodyEnabled: boolean;
  isSleeping: boolean;
  colliderType: PhysicsColliderType;
  colliderEnabled: boolean;
  colliderIsTrigger: boolean;
  colliderOffsetX: number;
  colliderOffsetY: number;
  colliderMaterialOverride: boolean;
  colliderMaterial: PhysicsMaterialSnapshot;
  mass: number;
  inverseMass: number;
  inertia: number;
  inverseInertia: number;
  gravityScale: number;
  linearDamping: number;
  angularDamping: number;
  restitution: number;
  friction: number;
  surfaceVelocityX: number;
  surfaceVelocityY: number;
  density: number;
  contactBaumgarteBiasScale: number;
  maxContactBaumgarteBiasVelocityScale: number;
  contactPositionCorrectionScale: number;
  contactPositionCorrectionSlopScale: number;
}

export type PhysicsJointType =
  | "distance"
  | "rope"
  | "spring"
  | "revolute"
  | "prismatic"
  | "weld"
  | "gear"
  | "pulley";

export interface PhysicsJointHandle {
  jointType: PhysicsJointType;
  jointIndex: number;
  jointGeneration: number;
}

export interface PhysicsJointBaseOptions {
  entityA: PhysicsEntityHandle;
  entityB: PhysicsEntityHandle;
  stiffness?: number;
  damping?: number;
  enabled?: boolean;
}

export type PhysicsJointSpawnOptions =
  | (PhysicsJointBaseOptions & {
      type: "distance";
      restLength: number;
      breakDistance?: number;
    })
  | (PhysicsJointBaseOptions & {
      type: "rope";
      maxLength: number;
      breakDistance?: number;
    })
  | (PhysicsJointBaseOptions & {
      type: "spring";
      restLength: number;
      breakDistance?: number;
    })
  | (PhysicsJointBaseOptions & {
      type: "pulley";
      groundAnchorAX: number;
      groundAnchorAY: number;
      groundAnchorBX: number;
      groundAnchorBY: number;
      localAnchorAX?: number;
      localAnchorAY?: number;
      localAnchorBX?: number;
      localAnchorBY?: number;
      restLength: number;
      ratio?: number;
      breakDistance?: number;
    })
  | (PhysicsJointBaseOptions & {
      type: "revolute";
      localAnchorAX?: number;
      localAnchorAY?: number;
      localAnchorBX?: number;
      localAnchorBY?: number;
      breakDistance?: number;
      limitEnabled?: boolean;
      lowerAngle?: number;
      upperAngle?: number;
      motorEnabled?: boolean;
      motorSpeed?: number;
      maxMotorTorque?: number;
    })
  | (PhysicsJointBaseOptions & {
      type: "prismatic";
      localAnchorAX?: number;
      localAnchorAY?: number;
      localAnchorBX?: number;
      localAnchorBY?: number;
      localAxisAX?: number;
      localAxisAY?: number;
      referenceAngle?: number;
      angularStiffness?: number;
      angularDamping?: number;
      breakDistance?: number;
      limitEnabled?: boolean;
      lowerTranslation?: number;
      upperTranslation?: number;
      motorEnabled?: boolean;
      motorSpeed?: number;
      maxMotorForce?: number;
    })
  | (PhysicsJointBaseOptions & {
      type: "weld";
      localAnchorAX?: number;
      localAnchorAY?: number;
      localAnchorBX?: number;
      localAnchorBY?: number;
      referenceAngle?: number;
      angularStiffness?: number;
      angularDamping?: number;
      breakDistance?: number;
      breakAngle?: number;
    })
  | (PhysicsJointBaseOptions & {
      type: "gear";
      ratio?: number;
      referenceAngle?: number;
      breakAngle?: number;
    });

export interface PhysicsJointSnapshot extends PhysicsJointHandle {
  entityA: PhysicsEntityHandle;
  entityB: PhysicsEntityHandle;
  enabled: boolean;
  restLength: number;
  maxLength: number;
  ratio: number;
  referenceAngle: number;
  breakDistance: number;
  breakAngle: number;
  stiffness: number;
  damping: number;
  angularStiffness: number;
  angularDamping: number;
  localAnchorAX: number;
  localAnchorAY: number;
  localAnchorBX: number;
  localAnchorBY: number;
  localAxisAX: number;
  localAxisAY: number;
  groundAnchorAX: number;
  groundAnchorAY: number;
  groundAnchorBX: number;
  groundAnchorBY: number;
  limitEnabled: boolean;
  lowerAngle: number;
  upperAngle: number;
  lowerTranslation: number;
  upperTranslation: number;
  motorEnabled: boolean;
  motorSpeed: number;
  maxMotorForce: number;
  maxMotorTorque: number;
}

export interface PhysicsNearestBodyQuery {
  x: number;
  y: number;
  maxDistance: number;
  queryMaskBits?: number;
}

export interface PhysicsNearestBodyHit {
  entityId: number;
  entityGeneration: number;
  pointX: number;
  pointY: number;
  distance: number;
}

export interface PhysicsNearestTileObstacleQuery {
  x: number;
  y: number;
  maxDistance: number;
}

export interface PhysicsNearestTileObstacleHit {
  layerIndex: number;
  tileIndex: number;
  pointX: number;
  pointY: number;
  distance: number;
}

export interface PhysicsBodyContactQuery {
  categoryABits?: number;
  categoryBBits?: number;
}

export type PhysicsBodyManifoldQuery = PhysicsBodyContactQuery;

export interface PhysicsPointBodyQuery {
  x: number;
  y: number;
  queryMaskBits?: number;
}

export interface PhysicsAabbBodyQuery {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  queryMaskBits?: number;
}

export interface PhysicsCircleBodyQuery {
  x: number;
  y: number;
  radius: number;
  queryMaskBits?: number;
}

export interface PhysicsOrientedBoxBodyQuery {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  rotationRadians: number;
  queryMaskBits?: number;
}

export interface PhysicsCapsuleBodyQuery {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  radius: number;
  queryMaskBits?: number;
}

export type PhysicsConvexPolygonVertexBuffer = Float32Array | readonly number[];

export interface PhysicsConvexPolygonBodyQuery {
  vertices: PhysicsConvexPolygonVertexBuffer;
  queryMaskBits?: number;
}

export interface PhysicsRaycastBodyQuery {
  originX: number;
  originY: number;
  directionX: number;
  directionY: number;
  maxDistance: number;
  queryMaskBits?: number;
}

export interface PhysicsSegmentCastBodyQuery {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  queryMaskBits?: number;
}

export interface PhysicsRaycastTileObstacleQuery {
  originX: number;
  originY: number;
  directionX: number;
  directionY: number;
  maxDistance: number;
}

export interface PhysicsSegmentCastTileObstacleQuery {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface PhysicsShapeCastMotionQuery {
  directionX: number;
  directionY: number;
  maxDistance: number;
  queryMaskBits?: number;
}

export interface PhysicsTileShapeCastMotionQuery {
  directionX: number;
  directionY: number;
  maxDistance: number;
}

export interface PhysicsAabbBodyShapeCastQuery extends PhysicsShapeCastMotionQuery {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

export interface PhysicsAabbTileObstacleShapeCastQuery extends PhysicsTileShapeCastMotionQuery {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

export interface PhysicsAabbTileObstacleContactQuery {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

export interface PhysicsAabbTileObstacleManifoldQuery {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

export interface PhysicsCircleBodyShapeCastQuery extends PhysicsShapeCastMotionQuery {
  x: number;
  y: number;
  radius: number;
}

export interface PhysicsOrientedBoxBodyShapeCastQuery extends PhysicsShapeCastMotionQuery {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  rotationRadians: number;
}

export interface PhysicsCapsuleBodyShapeCastQuery extends PhysicsShapeCastMotionQuery {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  radius: number;
}

export interface PhysicsConvexPolygonBodyShapeCastQuery extends PhysicsShapeCastMotionQuery {
  vertices: PhysicsConvexPolygonVertexBuffer;
}

export interface EngineLifecycleSnapshot {
  timeSeconds: number;
  score: number;
  entityCount: number;
  gameState: number;
  spriteCount: number;
}

export interface EngineLifecycleHooks {
  onStart?(snapshot: EngineLifecycleSnapshot): void;
  onPause?(snapshot: EngineLifecycleSnapshot): void;
  onResume?(snapshot: EngineLifecycleSnapshot): void;
  onStop?(snapshot: EngineLifecycleSnapshot): void;
  onDestroy?(snapshot: EngineLifecycleSnapshot): void;
}

export interface CreateEngineOptions {
  /** @deprecated 호환 API 사용자만 켜세요. 매 프레임 command object 배열을 생성합니다. */
  includeDeprecatedRenderCommands?: boolean;
  /** @deprecated Worker clock는 현재 MVP 범위 밖이며 이 옵션은 무시됩니다. */
  useWorkerClock?: boolean;
  /** FrameState에 decoded audio event object 배열을 포함할지 여부입니다. 기본값은 true입니다. */
  includeAudioEvents?: boolean;
  /** FrameState에 decoded collision event object 배열을 포함할지 여부입니다. 기본값은 false입니다. */
  includeCollisionEvents?: boolean;
  /** Rust core에서 physics debug line buffer를 만들지 여부입니다. 기본값은 false입니다. */
  enablePhysicsDebugLines?: boolean | PhysicsDebugOptions;
  /** Physics debug line category 옵션입니다. enablePhysicsDebugLines=true면 기본 broadphase/contact를 사용합니다. */
  physicsDebugOptions?: PhysicsDebugOptions;
  /** FrameState에 decoded physics debug line object 배열을 포함할지 여부입니다. 기본값은 false입니다. */
  includePhysicsDebugLines?: boolean;
  /** Optional fixed timestep simulation mode. 기본값은 disabled variable-delta update입니다. */
  fixedTimestep?: boolean | FixedTimestepOptions;
  /** Runtime physics mode override. 지정하면 Game Spec의 physics.mode보다 우선합니다. */
  physicsMode?: PhysicsMode;
  /** Platform lifecycle callbacks. These receive snapshots only and must not own simulation state. */
  lifecycle?: EngineLifecycleHooks;
}
export interface FerrumLifecycleApi {
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  destroy(): void;
  time(): number;
  version(): string;
}

export interface FerrumSceneApi {
  score(): number;
  entityCount(): number;
  gameState(): number;
  spriteCount(): number;
  resetGame(): void;
  useBreakoutGame(): void;
  usePlatformerGame(): void;
  setViewportSize(width: number, height: number): void;
  setGameSpec(spec: ShooterGameSpec): ResolvedShooterGameSpec;
  setShooterTilemapTile(layerIndex: number, column: number, row: number, tileId: number): boolean;
  setShooterTilemapTilesRect(
    layerIndex: number,
    column: number,
    row: number,
    width: number,
    height: number,
    tileId: number,
  ): boolean;
  cameraX(): number;
  cameraY(): number;
}

export interface FerrumAssetApi {
  loadAssets(manifest: AssetManifest, onProgress?: AssetLoadProgressCallback): Promise<LoadedAssets>;
  textureId(name: string): number;
  soundId(name: string): number;
  setTextureIds(textureIds: ShooterTextureIds): void;
  setSoundIds(soundIds: ShooterSoundIds): void;
}

export interface FerrumParticleApi {
  setParticlePreset(presetId: number, preset: ParticlePresetConfig): void;
  clearParticlePresets(): void;
  setShooterHitParticlePreset(presetId: number): void;
  clearShooterHitParticlePreset(): void;
  setParticleSeed(seed: number): void;
  spawnParticleBurst(presetId: number, x: number, y: number): number;
  clearParticles(): void;
  particleCount(): number;
  particleCapacity(): number;
}

export interface FerrumPhysicsRuntimeApi {
  configureFixedTimestep(options: boolean | FixedTimestepOptions): void;
  setPhysicsDebugLinesEnabled(enabled: boolean | PhysicsDebugOptions): void;
  setPhysicsDebugOptions(options: PhysicsDebugOptions): void;
  stepRigidBodies(
    deltaSeconds: number,
    options?: PhysicsRigidBodyStepOptions,
  ): PhysicsRigidBodyStepStats;
}

export interface FerrumPhysicsBodyApi {
  spawnRigidBody(options: PhysicsRigidBodySpawnOptions): PhysicsEntityHandle;
  addPhysicsBodyCollider(handle: PhysicsEntityHandle, options: PhysicsBodyColliderOptions): boolean;
  getPhysicsBodyColliderCount(handle: PhysicsEntityHandle): number;
  getPhysicsBodyCollider(
    handle: PhysicsEntityHandle,
    colliderIndex: number,
  ): PhysicsBodyColliderSnapshot | undefined;
  getPhysicsEntity(handle: PhysicsEntityHandle): PhysicsEntitySnapshot | undefined;
  capturePhysicsBodyStateBuffer(handles: readonly PhysicsEntityHandle[]): PhysicsBodyStateBufferSnapshot;
  restorePhysicsBodyStateBuffer(snapshot: PhysicsBodyStateBufferSnapshot): boolean;
  despawnPhysicsEntity(handle: PhysicsEntityHandle): boolean;
  setPhysicsBodyPosition(handle: PhysicsEntityHandle, x: number, y: number): boolean;
  setPhysicsBodyVelocity(handle: PhysicsEntityHandle, velocityX: number, velocityY: number): boolean;
  setPhysicsBodyRotation(handle: PhysicsEntityHandle, rotationRadians: number): boolean;
  setPhysicsBodyAngularVelocity(handle: PhysicsEntityHandle, radiansPerSecond: number): boolean;
  setPhysicsBodyEnabled(handle: PhysicsEntityHandle, enabled: boolean): boolean;
  setPhysicsColliderOffset(handle: PhysicsEntityHandle, offsetX: number, offsetY: number): boolean;
  setPhysicsColliderEnabled(handle: PhysicsEntityHandle, enabled: boolean): boolean;
  setPhysicsColliderMaterial(
    handle: PhysicsEntityHandle,
    material: PhysicsRigidBodyMaterial,
  ): boolean;
  setPhysicsBodyColliderMaterial(
    handle: PhysicsEntityHandle,
    colliderIndex: number,
    material: PhysicsRigidBodyMaterial,
  ): boolean;
  clearPhysicsColliderMaterial(handle: PhysicsEntityHandle): boolean;
  setPhysicsBodyMassProperties(
    handle: PhysicsEntityHandle,
    properties: PhysicsRigidBodyMassProperties,
  ): boolean;
  setPhysicsBodyTuning(handle: PhysicsEntityHandle, tuning: PhysicsRigidBodyTuning): boolean;
  setPhysicsBodyMaterial(handle: PhysicsEntityHandle, material: PhysicsRigidBodyMaterial): boolean;
  applyPhysicsBodyForce(handle: PhysicsEntityHandle, forceX: number, forceY: number): boolean;
  applyPhysicsBodyImpulse(handle: PhysicsEntityHandle, impulseX: number, impulseY: number): boolean;
  applyPhysicsBodyTorque(handle: PhysicsEntityHandle, torque: number): boolean;
  applyPhysicsBodyAngularImpulse(handle: PhysicsEntityHandle, angularImpulse: number): boolean;
}

export interface FerrumPhysicsJointApi {
  spawnPhysicsJoint(options: PhysicsJointSpawnOptions): PhysicsJointHandle;
  getPhysicsJoint(handle: PhysicsJointHandle): PhysicsJointSnapshot | undefined;
  clearPhysicsJoint(handle: PhysicsJointHandle): boolean;
  setPhysicsJointEnabled(handle: PhysicsJointHandle, enabled: boolean): boolean;
}

export interface FerrumPhysicsQueryApi {
  queryNearestBody(query: PhysicsNearestBodyQuery): PhysicsNearestBodyHit | undefined;
  queryNearestTileObstacle(query: PhysicsNearestTileObstacleQuery): PhysicsNearestTileObstacleHit | undefined;
  queryBodyContacts(query?: PhysicsBodyContactQuery): readonly PhysicsBodyContactHit[];
  queryBodyManifolds(query?: PhysicsBodyManifoldQuery): readonly PhysicsBodyManifoldHit[];
  queryRigidContactImpulses(): readonly PhysicsRigidContactImpulseHit[];
  queryPointBodies(query: PhysicsPointBodyQuery): readonly PhysicsBodyQueryHit[];
  queryAabbBodies(query: PhysicsAabbBodyQuery): readonly PhysicsBodyQueryHit[];
  queryCircleBodies(query: PhysicsCircleBodyQuery): readonly PhysicsBodyQueryHit[];
  queryOrientedBoxBodies(query: PhysicsOrientedBoxBodyQuery): readonly PhysicsBodyQueryHit[];
  queryCapsuleBodies(query: PhysicsCapsuleBodyQuery): readonly PhysicsBodyQueryHit[];
  queryConvexPolygonBodies(query: PhysicsConvexPolygonBodyQuery): readonly PhysicsBodyQueryHit[];
  raycastBodies(query: PhysicsRaycastBodyQuery): readonly PhysicsRaycastBodyHit[];
  segmentCastBodies(query: PhysicsSegmentCastBodyQuery): readonly PhysicsRaycastBodyHit[];
  raycastTileObstacles(query: PhysicsRaycastTileObstacleQuery): readonly PhysicsTileRaycastHit[];
  segmentCastTileObstacles(query: PhysicsSegmentCastTileObstacleQuery): readonly PhysicsTileRaycastHit[];
  shapeCastAabbBodies(query: PhysicsAabbBodyShapeCastQuery): readonly PhysicsShapeCastBodyHit[];
  shapeCastCircleBodies(query: PhysicsCircleBodyShapeCastQuery): readonly PhysicsShapeCastBodyHit[];
  shapeCastOrientedBoxBodies(query: PhysicsOrientedBoxBodyShapeCastQuery): readonly PhysicsShapeCastBodyHit[];
  shapeCastCapsuleBodies(query: PhysicsCapsuleBodyShapeCastQuery): readonly PhysicsShapeCastBodyHit[];
  shapeCastConvexPolygonBodies(query: PhysicsConvexPolygonBodyShapeCastQuery): readonly PhysicsShapeCastBodyHit[];
  shapeCastAabbTileObstacles(query: PhysicsAabbTileObstacleShapeCastQuery): readonly PhysicsTileShapeCastHit[];
  queryAabbTileObstacleContacts(query: PhysicsAabbTileObstacleContactQuery): readonly PhysicsTileContactHit[];
  queryAabbTileObstacleManifolds(query: PhysicsAabbTileObstacleManifoldQuery): readonly PhysicsTileManifoldHit[];
}

export interface FerrumPhysicsApi
  extends FerrumPhysicsRuntimeApi,
    FerrumPhysicsBodyApi,
    FerrumPhysicsJointApi,
    FerrumPhysicsQueryApi {}

export interface FerrumEngine
  extends FerrumLifecycleApi,
    FerrumSceneApi,
    FerrumAssetApi,
    FerrumParticleApi,
    FerrumPhysicsApi {}

export interface ViewportSnapshot {
  width: number;
  height: number;
}

export type InputProvider = () => InputSnapshot;
export type ViewportProvider = () => ViewportSnapshot;

const EMPTY_RENDER_COMMANDS: RenderCommandView[] = [];
const DEFAULT_PHYSICS_QUERY_MASK_BITS = 0xffffffff;
const DEFAULT_RIGID_BODY_GRAVITY_X = 0;
const DEFAULT_RIGID_BODY_GRAVITY_Y = 980;
const DEFAULT_RIGID_BODY_VELOCITY_ITERATIONS = 6;
const DEFAULT_RIGID_BODY_POSITION_ITERATIONS = 3;
const DEFAULT_RIGID_BODY_POSITION_CORRECTION_PERCENT = 0.8;
const DEFAULT_RIGID_BODY_POSITION_CORRECTION_SLOP = 0.01;
const DEFAULT_RIGID_BODY_RESTITUTION_VELOCITY_THRESHOLD = 1;
const DEFAULT_RIGID_BODY_CONTACT_BAUMGARTE_BIAS_FACTOR = 0.2;
const DEFAULT_RIGID_BODY_MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY = 120;
const DEFAULT_RIGID_BODY_DENSITY = 1;
const DEFAULT_RIGID_BODY_RESTITUTION = 0;
const DEFAULT_RIGID_BODY_FRICTION = 0.4;
const DEFAULT_RIGID_BODY_MATERIAL_SCALE = 1;
const PHYSICS_DEBUG_BROADPHASE = 1 << 0;
const PHYSICS_DEBUG_CONTACTS = 1 << 1;
const PHYSICS_DEBUG_COLLIDERS = 1 << 2;
const PHYSICS_DEBUG_JOINTS = 1 << 3;
const PHYSICS_DEBUG_SLEEPING = 1 << 4;
const PHYSICS_DEBUG_CCD = 1 << 5;
const PHYSICS_DEBUG_DEFAULT = PHYSICS_DEBUG_BROADPHASE | PHYSICS_DEBUG_CONTACTS;
const PHYSICS_BODY_TYPE_CODES: Record<PhysicsRigidBodyType, number> = Object.freeze({
  static: 0,
  kinematic: 1,
  dynamic: 2,
});
const PHYSICS_BODY_TYPES: readonly PhysicsRigidBodyType[] = Object.freeze([
  "static",
  "kinematic",
  "dynamic",
]);
const PHYSICS_COLLIDER_TYPES: readonly PhysicsColliderType[] = Object.freeze([
  "none",
  "aabb",
  "circle",
  "capsule",
  "orientedBox",
  "convexPolygon",
  "edge",
  "chain",
]);
const PHYSICS_BODY_STATE_U32_ENTITY_ID = 0;
const PHYSICS_BODY_STATE_U32_ENTITY_GENERATION = 1;
const PHYSICS_BODY_STATE_U32_BODY_TYPE = 2;
const PHYSICS_BODY_STATE_U32_COLLIDER_TYPE = 3;
const PHYSICS_BODY_STATE_U32_FLAGS = 4;
const PHYSICS_BODY_STATE_FLAG_BODY_ENABLED = 1 << 0;
const PHYSICS_BODY_STATE_FLAG_SLEEPING = 1 << 1;
const PHYSICS_BODY_STATE_FLAG_COLLIDER_ENABLED = 1 << 2;
const PHYSICS_BODY_STATE_FLAG_COLLIDER_TRIGGER = 1 << 3;
const PHYSICS_BODY_STATE_FLAG_COLLIDER_MATERIAL_OVERRIDE = 1 << 4;
const PHYSICS_LAYER_CODES: Record<PhysicsCollisionLayer, number> = Object.freeze({
  player: 0,
  enemy: 1,
  bullet: 2,
  wall: 3,
});
const PHYSICS_LAYER_MASK_BITS: Record<PhysicsCollisionLayer, number> = Object.freeze({
  player: 1 << 0,
  enemy: 1 << 1,
  bullet: 1 << 2,
  wall: 1 << 3,
});
const PHYSICS_JOINT_TYPE_CODES: Record<PhysicsJointType, number> = Object.freeze({
  distance: 0,
  rope: 1,
  spring: 2,
  revolute: 3,
  prismatic: 4,
  gear: 5,
  weld: 6,
  pulley: 7,
});
const PHYSICS_JOINT_TYPES: readonly PhysicsJointType[] = Object.freeze([
  "distance",
  "rope",
  "spring",
  "revolute",
  "prismatic",
  "gear",
  "weld",
  "pulley",
]);
interface FramePipelineContext {
  bridge: WasmBridge;
  rustEngine: Engine;
  physicsSpec: ResolvedPhysicsSpec;
  onFrame?: FrameHandler;
  inputProvider?: InputProvider;
  assetHost?: AssetHost;
  viewportProvider?: ViewportProvider;
  options: CreateEngineOptions;
}

interface AudioDrainResult {
  audioEventCount: number;
  audioEvents: readonly AudioEventView[];
}

export async function createEngine(
  onFrame?: FrameHandler,
  inputProvider?: InputProvider,
  assetHost?: AssetHost,
  viewportProvider?: ViewportProvider,
  options: CreateEngineOptions = {},
): Promise<FerrumEngine> {
  const bridge = await WasmBridge.init();
  const rustEngine: Engine = bridge.engine();
  const initialPhysicsSpec = resolvePhysicsSpec(undefined, {
    modeOverride: options.physicsMode,
  });
  applyPhysicsRuntimeOptions(rustEngine, initialPhysicsSpec, options, options.physicsMode !== undefined);
  const framePipeline: FramePipelineContext = {
    bridge,
    rustEngine,
    physicsSpec: initialPhysicsSpec,
    onFrame,
    inputProvider,
    assetHost,
    viewportProvider,
    options,
  };

  const loop = new GameLoop(
    (deltaSeconds) => runFrame(framePipeline, deltaSeconds),
    0.05,
  );

  const requireAssetHost = (): AssetHost => {
    if (!assetHost) {
      throw new Error("loadAssets() requires an AssetHost. Pass BrowserPlatformHost as the third createEngine() argument.");
    }
    return assetHost;
  };

  let destroyed = false;
  let running = false;
  let paused = false;

  const requireAlive = (): void => {
    if (destroyed) {
      throw new Error("FerrumEngine has been destroyed.");
    }
  };

  const lifecycleSnapshot = (): EngineLifecycleSnapshot => ({
    timeSeconds: rustEngine.time(),
    score: rustEngine.score(),
    entityCount: rustEngine.entity_count(),
    gameState: rustEngine.game_state(),
    spriteCount: rustEngine.sprite_count(),
  });

  const destroy = (): void => {
    if (destroyed) {
      return;
    }
    const snapshot = lifecycleSnapshot();
    destroyed = true;
    running = false;
    paused = false;
    loop.stop();
    try {
      options.lifecycle?.onDestroy?.(snapshot);
    } finally {
      rustEngine.free();
    }
  };

  const setTextureIds = (textureIds: ShooterTextureIds): void => {
    requireAlive();
    rustEngine.set_texture_ids(textureIds.player, textureIds.enemy, textureIds.bullet);
  };

  const setSoundIds = (soundIds: ShooterSoundIds): void => {
    requireAlive();
    rustEngine.set_sound_ids(soundIds.shoot, soundIds.hit, soundIds.gameOver);
  };

  const setGameSpec = (spec: ShooterGameSpec): ResolvedShooterGameSpec => {
    requireAlive();
    const resolved = applyShooterGameSpec(rustEngine, spec, {
      textureId: (name) => requireAssetHost().textureId(name),
      physicsModeOverride: options.physicsMode,
    });
    framePipeline.physicsSpec = resolved.physics;
    applyPhysicsRuntimeOptions(
      rustEngine,
      resolved.physics,
      options,
      spec.physics !== undefined || options.physicsMode !== undefined,
    );
    assetHost?.configureAudio?.({
      masterVolume: resolved.audioMasterVolume,
      sfxVolume: resolved.audioSfxVolume,
    });
    return resolved;
  };

  const setParticlePreset = (presetId: number, preset: ParticlePresetConfig): void => {
    requireAlive();
    const id = particlePresetId(presetId);
    const resolved = resolveParticlePresetConfigForWasm(preset, (name) => requireAssetHost().textureId(name));
    rustEngine.set_particle_preset(
      id,
      resolved.textureId,
      resolved.uv.u0,
      resolved.uv.v0,
      resolved.uv.u1,
      resolved.uv.v1,
      resolved.burstCount,
      resolved.lifetime[0],
      resolved.lifetime[1],
      resolved.speed[0],
      resolved.speed[1],
      resolved.startSize[0],
      resolved.startSize[1],
      resolved.endSize[0],
      resolved.endSize[1],
      resolved.startColor[0],
      resolved.startColor[1],
      resolved.startColor[2],
      resolved.startColor[3],
      resolved.endColor[0],
      resolved.endColor[1],
      resolved.endColor[2],
      resolved.endColor[3],
      resolved.accelerationX,
      resolved.accelerationY,
      resolved.damping,
    );
  };

  const spawnParticleBurst = (presetId: number, x: number, y: number): number => {
    requireAlive();
    return rustEngine.spawn_particle_burst(
      particlePresetId(presetId),
      finiteNumber(x, "particle burst x"),
      finiteNumber(y, "particle burst y"),
    );
  };

  const useBreakoutGame = (): void => {
    requireAlive();
    rustEngine.use_breakout_scene();
  };

  const usePlatformerGame = (): void => {
    requireAlive();
    rustEngine.use_platformer_scene();
  };

  const configureFixedTimestep = (fixedTimestep: boolean | FixedTimestepOptions): void => {
    requireAlive();
    applyFixedTimestepOptions(rustEngine, fixedTimestep);
  };

  const setPhysicsDebugLinesEnabled = (enabled: boolean | PhysicsDebugOptions): void => {
    requireAlive();
    const flags = physicsDebugFlags(enabled);
    rustEngine.set_physics_debug_line_flags(flags);
    rustEngine.set_physics_debug_lines_enabled(flags !== 0);
  };

  const setPhysicsDebugOptions = (options: PhysicsDebugOptions): void => {
    requireAlive();
    const flags = physicsDebugFlags(options);
    rustEngine.set_physics_debug_line_flags(flags);
    rustEngine.set_physics_debug_lines_enabled(flags !== 0);
  };

  const stepRigidBodies = (
    deltaSeconds: number,
    options?: PhysicsRigidBodyStepOptions,
  ): PhysicsRigidBodyStepStats => {
    requireAlive();
    const resolvedDeltaSeconds = finiteNumber(deltaSeconds, "rigid body step deltaSeconds");
    if (options === undefined) {
      rustEngine.step_rigid_bodies(resolvedDeltaSeconds);
      return readRigidBodyStepStats(rustEngine);
    }
    rustEngine.step_rigid_bodies_with_config(
      resolvedDeltaSeconds,
      finiteNumber(options.gravityX ?? DEFAULT_RIGID_BODY_GRAVITY_X, "rigid body gravityX"),
      finiteNumber(options.gravityY ?? DEFAULT_RIGID_BODY_GRAVITY_Y, "rigid body gravityY"),
      uint32Number(
        options.velocityIterations ?? DEFAULT_RIGID_BODY_VELOCITY_ITERATIONS,
        "rigid body velocityIterations",
      ),
      uint32Number(
        options.positionIterations ?? DEFAULT_RIGID_BODY_POSITION_ITERATIONS,
        "rigid body positionIterations",
      ),
      finiteNumber(
        options.positionCorrectionPercent ?? DEFAULT_RIGID_BODY_POSITION_CORRECTION_PERCENT,
        "rigid body positionCorrectionPercent",
      ),
      finiteNumber(
        options.positionCorrectionSlop ?? DEFAULT_RIGID_BODY_POSITION_CORRECTION_SLOP,
        "rigid body positionCorrectionSlop",
      ),
      finiteNumber(
        options.restitutionVelocityThreshold ??
          DEFAULT_RIGID_BODY_RESTITUTION_VELOCITY_THRESHOLD,
        "rigid body restitutionVelocityThreshold",
      ),
      finiteNumber(
        options.contactBaumgarteBiasFactor ?? DEFAULT_RIGID_BODY_CONTACT_BAUMGARTE_BIAS_FACTOR,
        "rigid body contactBaumgarteBiasFactor",
      ),
      finiteNumber(
        options.maxContactBaumgarteBiasVelocity ??
          DEFAULT_RIGID_BODY_MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
        "rigid body maxContactBaumgarteBiasVelocity",
      ),
      options.contactSplitImpulse === true,
    );
    return readRigidBodyStepStats(rustEngine);
  };

  const spawnRigidBody = (options: PhysicsRigidBodySpawnOptions): PhysicsEntityHandle => {
    requireAlive();
    const x = finiteNumber(options.x, "physics body x");
    const y = finiteNumber(options.y, "physics body y");
    const bodyType = physicsRigidBodyType(options.bodyType);
    const bodyTypeCode = PHYSICS_BODY_TYPE_CODES[bodyType];
    const layer = options.layer ?? (bodyType === "static" ? "wall" : "player");
    const layerCode = physicsCollisionLayerCode(layer);
    const categoryBits = uint32Number(
      options.categoryBits ?? PHYSICS_LAYER_MASK_BITS[layer],
      "physics body categoryBits",
    );
    const maskBits = uint32Number(options.maskBits ?? DEFAULT_PHYSICS_QUERY_MASK_BITS, "physics body maskBits");
    const material = options.material;
    const density = positiveNumber(
      options.density ?? material?.density ?? DEFAULT_RIGID_BODY_DENSITY,
      "physics body density",
    );
    const mass = options.mass === undefined
      ? density
      : positiveNumber(options.mass, "physics body mass");
    const useDensity = options.mass === undefined;
    const colliderEnabled = options.colliderEnabled ?? true;
    const bodyEnabled = options.bodyEnabled ?? true;
    const canSleep = options.canSleep ?? bodyType === "dynamic";
    const collider = options.collider;
    let spawned = false;

    switch (collider.type) {
      case "aabb":
        spawned = rustEngine.spawn_physics_aabb_body(
          x,
          y,
          positiveNumber(collider.halfWidth, "physics aabb halfWidth"),
          positiveNumber(collider.halfHeight, "physics aabb halfHeight"),
          bodyTypeCode,
          mass,
          useDensity,
          layerCode,
          categoryBits,
          maskBits,
          options.isTrigger === true,
          colliderEnabled,
          bodyEnabled,
          canSleep,
        );
        break;
      case "circle":
        spawned = rustEngine.spawn_physics_circle_body(
          x,
          y,
          positiveNumber(collider.radius, "physics circle radius"),
          bodyTypeCode,
          mass,
          useDensity,
          layerCode,
          categoryBits,
          maskBits,
          options.isTrigger === true,
          colliderEnabled,
          bodyEnabled,
          canSleep,
        );
        break;
      case "capsule":
        spawned = rustEngine.spawn_physics_capsule_body(
          x,
          y,
          finiteNumber(collider.startX, "physics capsule startX"),
          finiteNumber(collider.startY, "physics capsule startY"),
          finiteNumber(collider.endX, "physics capsule endX"),
          finiteNumber(collider.endY, "physics capsule endY"),
          positiveNumber(collider.radius, "physics capsule radius"),
          bodyTypeCode,
          mass,
          useDensity,
          layerCode,
          categoryBits,
          maskBits,
          options.isTrigger === true,
          colliderEnabled,
          bodyEnabled,
          canSleep,
        );
        break;
      case "edge":
        spawned = rustEngine.spawn_physics_edge_body(
          x,
          y,
          finiteNumber(collider.startX, "physics edge startX"),
          finiteNumber(collider.startY, "physics edge startY"),
          finiteNumber(collider.endX, "physics edge endX"),
          finiteNumber(collider.endY, "physics edge endY"),
          bodyTypeCode,
          mass,
          useDensity,
          layerCode,
          categoryBits,
          maskBits,
          options.isTrigger === true,
          colliderEnabled,
          bodyEnabled,
          canSleep,
        );
        break;
      case "chain":
        spawned = rustEngine.spawn_physics_chain_body(
          x,
          y,
          physicsQueryVertexBuffer(collider.vertices),
          collider.loop === true,
          bodyTypeCode,
          mass,
          useDensity,
          layerCode,
          categoryBits,
          maskBits,
          options.isTrigger === true,
          colliderEnabled,
          bodyEnabled,
          canSleep,
        );
        break;
      case "orientedBox":
        spawned = rustEngine.spawn_physics_oriented_box_body(
          x,
          y,
          positiveNumber(collider.halfWidth, "physics orientedBox halfWidth"),
          positiveNumber(collider.halfHeight, "physics orientedBox halfHeight"),
          finiteNumber(collider.rotationRadians ?? 0, "physics orientedBox rotationRadians"),
          bodyTypeCode,
          mass,
          useDensity,
          layerCode,
          categoryBits,
          maskBits,
          options.isTrigger === true,
          colliderEnabled,
          bodyEnabled,
          canSleep,
        );
        break;
      case "convexPolygon":
        spawned = rustEngine.spawn_physics_convex_polygon_body(
          x,
          y,
          physicsQueryVertexBuffer(collider.vertices),
          finiteNumber(collider.rotationRadians ?? 0, "physics convexPolygon rotationRadians"),
          bodyTypeCode,
          mass,
          useDensity,
          layerCode,
          categoryBits,
          maskBits,
          options.isTrigger === true,
          colliderEnabled,
          bodyEnabled,
          canSleep,
        );
        break;
      default:
        throw new Error("physics collider type is not supported.");
    }

    if (!spawned) {
      throw new Error("spawnRigidBody() rejected invalid physics body options.");
    }
    const handle = readPhysicsEntityHandle(rustEngine);
    applyPhysicsColliderOffset(rustEngine, handle, collider);
    applyPhysicsBodyTuning(rustEngine, handle, bodyType, options);
    if (material !== undefined) {
      applyPhysicsBodyMaterial(rustEngine, handle, material);
    }
    if (options.colliderMaterial !== undefined) {
      applyPhysicsColliderMaterial(rustEngine, handle, options.colliderMaterial);
    }
    if (options.velocityX !== undefined || options.velocityY !== undefined) {
      rustEngine.set_physics_body_velocity(
        handle.entityId,
        handle.entityGeneration,
        finiteNumber(options.velocityX ?? 0, "physics body velocityX"),
        finiteNumber(options.velocityY ?? 0, "physics body velocityY"),
      );
    }
    if (options.rotationRadians !== undefined) {
      rustEngine.set_physics_body_rotation(
        handle.entityId,
        handle.entityGeneration,
        finiteNumber(options.rotationRadians, "physics body rotationRadians"),
      );
    }
    if (options.angularVelocityRadiansPerSecond !== undefined) {
      rustEngine.set_physics_body_angular_velocity(
        handle.entityId,
        handle.entityGeneration,
        finiteNumber(
          options.angularVelocityRadiansPerSecond,
          "physics body angularVelocityRadiansPerSecond",
        ),
      );
    }
    return handle;
  };

  const addPhysicsBodyCollider = (
    handle: PhysicsEntityHandle,
    options: PhysicsBodyColliderOptions,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    const layer = options.layer ?? "player";
    const layerCode = physicsCollisionLayerCode(layer);
    const categoryBits = uint32Number(
      options.categoryBits ?? PHYSICS_LAYER_MASK_BITS[layer],
      "physics collider categoryBits",
    );
    const maskBits = uint32Number(options.maskBits ?? DEFAULT_PHYSICS_QUERY_MASK_BITS, "physics collider maskBits");
    const collider = options.collider;
    let added = false;
    switch (collider.type) {
      case "aabb":
        added = rustEngine.add_physics_aabb_collider(
          resolved.entityId,
          resolved.entityGeneration,
          positiveNumber(collider.halfWidth, "physics aabb halfWidth"),
          positiveNumber(collider.halfHeight, "physics aabb halfHeight"),
          finiteNumber(collider.offsetX ?? 0, "physics collider offsetX"),
          finiteNumber(collider.offsetY ?? 0, "physics collider offsetY"),
          layerCode,
          categoryBits,
          maskBits,
          options.isTrigger === true,
          options.colliderEnabled ?? true,
        );
        break;
      case "circle":
        added = rustEngine.add_physics_circle_collider(
          resolved.entityId,
          resolved.entityGeneration,
          positiveNumber(collider.radius, "physics circle radius"),
          finiteNumber(collider.offsetX ?? 0, "physics collider offsetX"),
          finiteNumber(collider.offsetY ?? 0, "physics collider offsetY"),
          layerCode,
          categoryBits,
          maskBits,
          options.isTrigger === true,
          options.colliderEnabled ?? true,
        );
        break;
      case "capsule":
        added = rustEngine.add_physics_capsule_collider(
          resolved.entityId,
          resolved.entityGeneration,
          finiteNumber(collider.startX, "physics capsule startX"),
          finiteNumber(collider.startY, "physics capsule startY"),
          finiteNumber(collider.endX, "physics capsule endX"),
          finiteNumber(collider.endY, "physics capsule endY"),
          positiveNumber(collider.radius, "physics capsule radius"),
          finiteNumber(collider.offsetX ?? 0, "physics collider offsetX"),
          finiteNumber(collider.offsetY ?? 0, "physics collider offsetY"),
          layerCode,
          categoryBits,
          maskBits,
          options.isTrigger === true,
          options.colliderEnabled ?? true,
        );
        break;
      case "edge":
        added = rustEngine.add_physics_edge_collider(
          resolved.entityId,
          resolved.entityGeneration,
          finiteNumber(collider.startX, "physics edge startX"),
          finiteNumber(collider.startY, "physics edge startY"),
          finiteNumber(collider.endX, "physics edge endX"),
          finiteNumber(collider.endY, "physics edge endY"),
          finiteNumber(collider.offsetX ?? 0, "physics collider offsetX"),
          finiteNumber(collider.offsetY ?? 0, "physics collider offsetY"),
          layerCode,
          categoryBits,
          maskBits,
          options.isTrigger === true,
          options.colliderEnabled ?? true,
        );
        break;
      case "chain":
        added = rustEngine.add_physics_chain_collider(
          resolved.entityId,
          resolved.entityGeneration,
          physicsQueryVertexBuffer(collider.vertices),
          collider.loop === true,
          finiteNumber(collider.offsetX ?? 0, "physics collider offsetX"),
          finiteNumber(collider.offsetY ?? 0, "physics collider offsetY"),
          layerCode,
          categoryBits,
          maskBits,
          options.isTrigger === true,
          options.colliderEnabled ?? true,
        );
        break;
      case "orientedBox":
        added = rustEngine.add_physics_oriented_box_collider(
          resolved.entityId,
          resolved.entityGeneration,
          positiveNumber(collider.halfWidth, "physics orientedBox halfWidth"),
          positiveNumber(collider.halfHeight, "physics orientedBox halfHeight"),
          finiteNumber(collider.rotationRadians ?? 0, "physics orientedBox rotationRadians"),
          finiteNumber(collider.offsetX ?? 0, "physics collider offsetX"),
          finiteNumber(collider.offsetY ?? 0, "physics collider offsetY"),
          layerCode,
          categoryBits,
          maskBits,
          options.isTrigger === true,
          options.colliderEnabled ?? true,
        );
        break;
      case "convexPolygon":
        added = rustEngine.add_physics_convex_polygon_collider(
          resolved.entityId,
          resolved.entityGeneration,
          physicsQueryVertexBuffer(collider.vertices),
          finiteNumber(collider.rotationRadians ?? 0, "physics convexPolygon rotationRadians"),
          finiteNumber(collider.offsetX ?? 0, "physics collider offsetX"),
          finiteNumber(collider.offsetY ?? 0, "physics collider offsetY"),
          layerCode,
          categoryBits,
          maskBits,
          options.isTrigger === true,
          options.colliderEnabled ?? true,
        );
        break;
      default:
        throw new Error("physics collider type is not supported.");
    }
    if (!added) {
      return false;
    }
    return true;
  };

  const getPhysicsBodyColliderCount = (handle: PhysicsEntityHandle): number => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.physics_body_collider_count(resolved.entityId, resolved.entityGeneration);
  };

  const getPhysicsBodyCollider = (
    handle: PhysicsEntityHandle,
    colliderIndex: number,
  ): PhysicsBodyColliderSnapshot | undefined => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    if (!rustEngine.query_physics_body_collider(
      resolved.entityId,
      resolved.entityGeneration,
      uint32Number(colliderIndex, "physics collider index"),
    )) {
      return undefined;
    }
    return readPhysicsBodyColliderSnapshot(rustEngine);
  };

  const getPhysicsEntity = (handle: PhysicsEntityHandle): PhysicsEntitySnapshot | undefined => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    if (!rustEngine.query_physics_entity(resolved.entityId, resolved.entityGeneration)) {
      return undefined;
    }
    return readPhysicsEntitySnapshot(rustEngine);
  };

  const capturePhysicsBodyStateBuffer = (
    handles: readonly PhysicsEntityHandle[],
  ): PhysicsBodyStateBufferSnapshot => {
    requireAlive();
    const handleBuffer = physicsEntityHandleBuffer(handles);
    if (!rustEngine.capture_physics_body_snapshot_bulk(handleBuffer)) {
      throw new Error("capturePhysicsBodyStateBuffer() rejected one or more physics body handles.");
    }
    const view = bridge.readPhysicsBodyStateBuffer();
    const floats = new Float32Array(view.floats);
    const u32s = new Uint32Array(view.u32s);
    const states = decodePhysicsBodyStateBuffer({
      bodyCount: view.bodyCount,
      handles: new Uint32Array(handleBuffer),
      floats,
      u32s,
      floatsPerBody: view.floatsPerBody,
      u32sPerBody: view.u32sPerBody,
    });
    return {
      format: PHYSICS_BODY_STATE_BUFFER_FORMAT,
      version: PHYSICS_BODY_STATE_BUFFER_VERSION,
      bodyCount: view.bodyCount,
      handles: new Uint32Array(handleBuffer),
      floats,
      u32s,
      floatsPerBody: view.floatsPerBody,
      u32sPerBody: view.u32sPerBody,
      states,
    };
  };

  const restorePhysicsBodyStateBuffer = (snapshot: PhysicsBodyStateBufferSnapshot): boolean => {
    requireAlive();
    validatePhysicsBodyStateBufferSnapshot(snapshot);
    return rustEngine.restore_physics_body_snapshot_bulk(
      snapshot.handles,
      snapshot.floats,
      snapshot.u32s,
    );
  };

  const despawnPhysicsEntity = (handle: PhysicsEntityHandle): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.despawn_physics_entity(resolved.entityId, resolved.entityGeneration);
  };

  const setPhysicsBodyPosition = (
    handle: PhysicsEntityHandle,
    x: number,
    y: number,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.set_physics_body_position(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(x, "physics body x"),
      finiteNumber(y, "physics body y"),
    );
  };

  const setPhysicsBodyVelocity = (
    handle: PhysicsEntityHandle,
    velocityX: number,
    velocityY: number,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.set_physics_body_velocity(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(velocityX, "physics body velocityX"),
      finiteNumber(velocityY, "physics body velocityY"),
    );
  };

  const setPhysicsBodyRotation = (
    handle: PhysicsEntityHandle,
    rotationRadians: number,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.set_physics_body_rotation(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(rotationRadians, "physics body rotationRadians"),
    );
  };

  const setPhysicsBodyAngularVelocity = (
    handle: PhysicsEntityHandle,
    radiansPerSecond: number,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.set_physics_body_angular_velocity(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(radiansPerSecond, "physics body angularVelocityRadiansPerSecond"),
    );
  };

  const setPhysicsBodyEnabled = (handle: PhysicsEntityHandle, enabled: boolean): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.set_physics_body_enabled(resolved.entityId, resolved.entityGeneration, enabled);
  };

  const setPhysicsColliderOffset = (
    handle: PhysicsEntityHandle,
    offsetX: number,
    offsetY: number,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.set_physics_collider_offset(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(offsetX, "physics collider offsetX"),
      finiteNumber(offsetY, "physics collider offsetY"),
    );
  };

  const setPhysicsColliderEnabled = (
    handle: PhysicsEntityHandle,
    enabled: boolean,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.set_physics_collider_enabled(
      resolved.entityId,
      resolved.entityGeneration,
      enabled,
    );
  };

  const setPhysicsColliderMaterial = (
    handle: PhysicsEntityHandle,
    material: PhysicsRigidBodyMaterial,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    if (!rustEngine.query_physics_entity(resolved.entityId, resolved.entityGeneration)) {
      return false;
    }
    const current = readPhysicsEntitySnapshot(rustEngine);
    return setPhysicsColliderMaterialValues(rustEngine, resolved, {
      restitution: material.restitution ?? current.colliderMaterial.restitution,
      friction: material.friction ?? current.colliderMaterial.friction,
      surfaceVelocityX: material.surfaceVelocityX ?? current.colliderMaterial.surfaceVelocityX,
      surfaceVelocityY: material.surfaceVelocityY ?? current.colliderMaterial.surfaceVelocityY,
      density: material.density ?? current.colliderMaterial.density,
      contactBaumgarteBiasScale:
        material.contactBaumgarteBiasScale ?? current.colliderMaterial.contactBaumgarteBiasScale,
      maxContactBaumgarteBiasVelocityScale:
        material.maxContactBaumgarteBiasVelocityScale ??
        current.colliderMaterial.maxContactBaumgarteBiasVelocityScale,
      contactPositionCorrectionScale:
        material.contactPositionCorrectionScale ??
        current.colliderMaterial.contactPositionCorrectionScale,
      contactPositionCorrectionSlopScale:
        material.contactPositionCorrectionSlopScale ??
        current.colliderMaterial.contactPositionCorrectionSlopScale,
    });
  };

  const setPhysicsBodyColliderMaterial = (
    handle: PhysicsEntityHandle,
    colliderIndex: number,
    material: PhysicsRigidBodyMaterial,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    const resolvedColliderIndex = uint32Number(colliderIndex, "physics collider index");
    if (!rustEngine.query_physics_body_collider(
      resolved.entityId,
      resolved.entityGeneration,
      resolvedColliderIndex,
    )) {
      return false;
    }
    const current = readPhysicsBodyColliderSnapshot(rustEngine).colliderMaterial;
    return setPhysicsCompoundColliderMaterialValues(
      rustEngine,
      resolved,
      resolvedColliderIndex,
      {
        restitution: material.restitution ?? current.restitution,
        friction: material.friction ?? current.friction,
        surfaceVelocityX: material.surfaceVelocityX ?? current.surfaceVelocityX,
        surfaceVelocityY: material.surfaceVelocityY ?? current.surfaceVelocityY,
        density: material.density ?? current.density,
        contactBaumgarteBiasScale:
          material.contactBaumgarteBiasScale ?? current.contactBaumgarteBiasScale,
        maxContactBaumgarteBiasVelocityScale:
          material.maxContactBaumgarteBiasVelocityScale ??
          current.maxContactBaumgarteBiasVelocityScale,
        contactPositionCorrectionScale:
          material.contactPositionCorrectionScale ?? current.contactPositionCorrectionScale,
        contactPositionCorrectionSlopScale:
          material.contactPositionCorrectionSlopScale ?? current.contactPositionCorrectionSlopScale,
      },
    );
  };

  const clearPhysicsColliderMaterial = (handle: PhysicsEntityHandle): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.clear_physics_collider_material(
      resolved.entityId,
      resolved.entityGeneration,
    );
  };

  const setPhysicsBodyMassProperties = (
    handle: PhysicsEntityHandle,
    properties: PhysicsRigidBodyMassProperties,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.set_physics_body_mass_properties(
      resolved.entityId,
      resolved.entityGeneration,
      positiveNumber(properties.mass, "physics body mass"),
      positiveNumber(properties.inertia, "physics body inertia"),
    );
  };

  const setPhysicsBodyTuning = (
    handle: PhysicsEntityHandle,
    tuning: PhysicsRigidBodyTuning,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    if (!rustEngine.query_physics_entity(resolved.entityId, resolved.entityGeneration)) {
      return false;
    }
    const current = readPhysicsEntitySnapshot(rustEngine);
    return rustEngine.set_physics_body_tuning(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(tuning.gravityScale ?? current.gravityScale, "physics body gravityScale"),
      nonNegativeNumber(
        tuning.linearDamping ?? current.linearDamping,
        "physics body linearDamping",
      ),
      nonNegativeNumber(
        tuning.angularDamping ?? current.angularDamping,
        "physics body angularDamping",
      ),
    );
  };

  const setPhysicsBodyMaterial = (
    handle: PhysicsEntityHandle,
    material: PhysicsRigidBodyMaterial,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    if (!rustEngine.query_physics_entity(resolved.entityId, resolved.entityGeneration)) {
      return false;
    }
    const current = readPhysicsEntitySnapshot(rustEngine);
    return setPhysicsBodyMaterialValues(rustEngine, resolved, {
      restitution: material.restitution ?? current.restitution,
      friction: material.friction ?? current.friction,
      surfaceVelocityX: material.surfaceVelocityX ?? current.surfaceVelocityX,
      surfaceVelocityY: material.surfaceVelocityY ?? current.surfaceVelocityY,
      density: material.density ?? current.density,
      contactBaumgarteBiasScale:
        material.contactBaumgarteBiasScale ?? current.contactBaumgarteBiasScale,
      maxContactBaumgarteBiasVelocityScale:
        material.maxContactBaumgarteBiasVelocityScale ??
        current.maxContactBaumgarteBiasVelocityScale,
      contactPositionCorrectionScale:
        material.contactPositionCorrectionScale ?? current.contactPositionCorrectionScale,
      contactPositionCorrectionSlopScale:
        material.contactPositionCorrectionSlopScale ??
        current.contactPositionCorrectionSlopScale,
    });
  };

  const applyPhysicsBodyForce = (
    handle: PhysicsEntityHandle,
    forceX: number,
    forceY: number,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.apply_physics_body_force(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(forceX, "physics body forceX"),
      finiteNumber(forceY, "physics body forceY"),
    );
  };

  const applyPhysicsBodyImpulse = (
    handle: PhysicsEntityHandle,
    impulseX: number,
    impulseY: number,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.apply_physics_body_impulse(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(impulseX, "physics body impulseX"),
      finiteNumber(impulseY, "physics body impulseY"),
    );
  };

  const applyPhysicsBodyTorque = (handle: PhysicsEntityHandle, torque: number): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.apply_physics_body_torque(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(torque, "physics body torque"),
    );
  };

  const applyPhysicsBodyAngularImpulse = (
    handle: PhysicsEntityHandle,
    angularImpulse: number,
  ): boolean => {
    requireAlive();
    const resolved = physicsEntityHandle(handle);
    return rustEngine.apply_physics_body_angular_impulse(
      resolved.entityId,
      resolved.entityGeneration,
      finiteNumber(angularImpulse, "physics body angularImpulse"),
    );
  };

  const spawnPhysicsJoint = (options: PhysicsJointSpawnOptions): PhysicsJointHandle => {
    requireAlive();
    const entityA = physicsEntityHandle(options.entityA);
    const entityB = physicsEntityHandle(options.entityB);
    const enabled = options.enabled ?? true;
    let spawned = false;

    switch (options.type) {
      case "distance":
        spawned = rustEngine.spawn_physics_distance_joint(
          entityA.entityId,
          entityA.entityGeneration,
          entityB.entityId,
          entityB.entityGeneration,
          nonNegativeNumber(options.restLength, "physics distance joint restLength"),
          unitIntervalNumber(options.stiffness ?? 1, "physics distance joint stiffness"),
          unitIntervalNumber(options.damping ?? 0, "physics distance joint damping"),
          breakLimitNumber(
            options.breakDistance ?? Number.POSITIVE_INFINITY,
            "physics distance joint breakDistance",
          ),
          enabled,
        );
        break;
      case "rope":
        spawned = rustEngine.spawn_physics_rope_joint(
          entityA.entityId,
          entityA.entityGeneration,
          entityB.entityId,
          entityB.entityGeneration,
          nonNegativeNumber(options.maxLength, "physics rope joint maxLength"),
          unitIntervalNumber(options.stiffness ?? 1, "physics rope joint stiffness"),
          unitIntervalNumber(options.damping ?? 0, "physics rope joint damping"),
          breakLimitNumber(
            options.breakDistance ?? Number.POSITIVE_INFINITY,
            "physics rope joint breakDistance",
          ),
          enabled,
        );
        break;
      case "spring":
        spawned = rustEngine.spawn_physics_spring_joint(
          entityA.entityId,
          entityA.entityGeneration,
          entityB.entityId,
          entityB.entityGeneration,
          nonNegativeNumber(options.restLength, "physics spring joint restLength"),
          unitIntervalNumber(options.stiffness ?? 1, "physics spring joint stiffness"),
          unitIntervalNumber(options.damping ?? 0, "physics spring joint damping"),
          breakLimitNumber(
            options.breakDistance ?? Number.POSITIVE_INFINITY,
            "physics spring joint breakDistance",
          ),
          enabled,
        );
        break;
      case "pulley":
        spawned = rustEngine.spawn_physics_pulley_joint(
          entityA.entityId,
          entityA.entityGeneration,
          entityB.entityId,
          entityB.entityGeneration,
          finiteNumber(options.groundAnchorAX, "physics pulley joint groundAnchorAX"),
          finiteNumber(options.groundAnchorAY, "physics pulley joint groundAnchorAY"),
          finiteNumber(options.groundAnchorBX, "physics pulley joint groundAnchorBX"),
          finiteNumber(options.groundAnchorBY, "physics pulley joint groundAnchorBY"),
          finiteNumber(options.localAnchorAX ?? 0, "physics pulley joint localAnchorAX"),
          finiteNumber(options.localAnchorAY ?? 0, "physics pulley joint localAnchorAY"),
          finiteNumber(options.localAnchorBX ?? 0, "physics pulley joint localAnchorBX"),
          finiteNumber(options.localAnchorBY ?? 0, "physics pulley joint localAnchorBY"),
          nonNegativeNumber(options.restLength, "physics pulley joint restLength"),
          positiveNumber(options.ratio ?? 1, "physics pulley joint ratio"),
          unitIntervalNumber(options.stiffness ?? 1, "physics pulley joint stiffness"),
          unitIntervalNumber(options.damping ?? 0, "physics pulley joint damping"),
          breakLimitNumber(
            options.breakDistance ?? Number.POSITIVE_INFINITY,
            "physics pulley joint breakDistance",
          ),
          enabled,
        );
        break;
      case "revolute":
        spawned = rustEngine.spawn_physics_revolute_joint(
          entityA.entityId,
          entityA.entityGeneration,
          entityB.entityId,
          entityB.entityGeneration,
          finiteNumber(options.localAnchorAX ?? 0, "physics revolute joint localAnchorAX"),
          finiteNumber(options.localAnchorAY ?? 0, "physics revolute joint localAnchorAY"),
          finiteNumber(options.localAnchorBX ?? 0, "physics revolute joint localAnchorBX"),
          finiteNumber(options.localAnchorBY ?? 0, "physics revolute joint localAnchorBY"),
          unitIntervalNumber(options.stiffness ?? 1, "physics revolute joint stiffness"),
          unitIntervalNumber(options.damping ?? 1, "physics revolute joint damping"),
          breakLimitNumber(
            options.breakDistance ?? Number.POSITIVE_INFINITY,
            "physics revolute joint breakDistance",
          ),
          options.limitEnabled === true,
          finiteNumber(options.lowerAngle ?? 0, "physics revolute joint lowerAngle"),
          finiteNumber(options.upperAngle ?? 0, "physics revolute joint upperAngle"),
          options.motorEnabled === true,
          finiteNumber(options.motorSpeed ?? 0, "physics revolute joint motorSpeed"),
          nonNegativeNumber(options.maxMotorTorque ?? 0, "physics revolute joint maxMotorTorque"),
          enabled,
        );
        break;
      case "prismatic":
        spawned = rustEngine.spawn_physics_prismatic_joint(
          entityA.entityId,
          entityA.entityGeneration,
          entityB.entityId,
          entityB.entityGeneration,
          finiteNumber(options.localAnchorAX ?? 0, "physics prismatic joint localAnchorAX"),
          finiteNumber(options.localAnchorAY ?? 0, "physics prismatic joint localAnchorAY"),
          finiteNumber(options.localAnchorBX ?? 0, "physics prismatic joint localAnchorBX"),
          finiteNumber(options.localAnchorBY ?? 0, "physics prismatic joint localAnchorBY"),
          finiteNumber(options.localAxisAX ?? 1, "physics prismatic joint localAxisAX"),
          finiteNumber(options.localAxisAY ?? 0, "physics prismatic joint localAxisAY"),
          finiteNumber(options.referenceAngle ?? 0, "physics prismatic joint referenceAngle"),
          unitIntervalNumber(options.stiffness ?? 1, "physics prismatic joint stiffness"),
          unitIntervalNumber(options.damping ?? 1, "physics prismatic joint damping"),
          unitIntervalNumber(
            options.angularStiffness ?? 1,
            "physics prismatic joint angularStiffness",
          ),
          unitIntervalNumber(
            options.angularDamping ?? 1,
            "physics prismatic joint angularDamping",
          ),
          breakLimitNumber(
            options.breakDistance ?? Number.POSITIVE_INFINITY,
            "physics prismatic joint breakDistance",
          ),
          options.limitEnabled === true,
          finiteNumber(options.lowerTranslation ?? 0, "physics prismatic joint lowerTranslation"),
          finiteNumber(options.upperTranslation ?? 0, "physics prismatic joint upperTranslation"),
          options.motorEnabled === true,
          finiteNumber(options.motorSpeed ?? 0, "physics prismatic joint motorSpeed"),
          nonNegativeNumber(options.maxMotorForce ?? 0, "physics prismatic joint maxMotorForce"),
          enabled,
        );
        break;
      case "weld":
        spawned = rustEngine.spawn_physics_weld_joint(
          entityA.entityId,
          entityA.entityGeneration,
          entityB.entityId,
          entityB.entityGeneration,
          finiteNumber(options.localAnchorAX ?? 0, "physics weld joint localAnchorAX"),
          finiteNumber(options.localAnchorAY ?? 0, "physics weld joint localAnchorAY"),
          finiteNumber(options.localAnchorBX ?? 0, "physics weld joint localAnchorBX"),
          finiteNumber(options.localAnchorBY ?? 0, "physics weld joint localAnchorBY"),
          finiteNumber(options.referenceAngle ?? 0, "physics weld joint referenceAngle"),
          unitIntervalNumber(options.stiffness ?? 1, "physics weld joint stiffness"),
          unitIntervalNumber(options.damping ?? 1, "physics weld joint damping"),
          unitIntervalNumber(options.angularStiffness ?? 1, "physics weld joint angularStiffness"),
          unitIntervalNumber(options.angularDamping ?? 1, "physics weld joint angularDamping"),
          breakLimitNumber(
            options.breakDistance ?? Number.POSITIVE_INFINITY,
            "physics weld joint breakDistance",
          ),
          breakLimitNumber(
            options.breakAngle ?? Number.POSITIVE_INFINITY,
            "physics weld joint breakAngle",
          ),
          enabled,
        );
        break;
      case "gear":
        spawned = rustEngine.spawn_physics_gear_joint(
          entityA.entityId,
          entityA.entityGeneration,
          entityB.entityId,
          entityB.entityGeneration,
          finiteNumber(options.ratio ?? 1, "physics gear joint ratio"),
          finiteNumber(options.referenceAngle ?? 0, "physics gear joint referenceAngle"),
          unitIntervalNumber(options.stiffness ?? 1, "physics gear joint stiffness"),
          unitIntervalNumber(options.damping ?? 1, "physics gear joint damping"),
          breakLimitNumber(
            options.breakAngle ?? Number.POSITIVE_INFINITY,
            "physics gear joint breakAngle",
          ),
          enabled,
        );
        break;
      default:
        throw new Error("physics joint type is not supported.");
    }

    if (!spawned) {
      throw new Error("spawnPhysicsJoint() rejected invalid physics joint options.");
    }
    return readPhysicsJointHandle(rustEngine);
  };

  const getPhysicsJoint = (handle: PhysicsJointHandle): PhysicsJointSnapshot | undefined => {
    requireAlive();
    const resolved = physicsJointHandle(handle);
    if (
      !rustEngine.query_physics_joint(
        PHYSICS_JOINT_TYPE_CODES[resolved.jointType],
        resolved.jointIndex,
        resolved.jointGeneration,
      )
    ) {
      return undefined;
    }
    return readPhysicsJointSnapshot(rustEngine);
  };

  const clearPhysicsJoint = (handle: PhysicsJointHandle): boolean => {
    requireAlive();
    const resolved = physicsJointHandle(handle);
    return rustEngine.clear_physics_joint(
      PHYSICS_JOINT_TYPE_CODES[resolved.jointType],
      resolved.jointIndex,
      resolved.jointGeneration,
    );
  };

  const setPhysicsJointEnabled = (handle: PhysicsJointHandle, enabled: boolean): boolean => {
    requireAlive();
    const resolved = physicsJointHandle(handle);
    return rustEngine.set_physics_joint_enabled(
      PHYSICS_JOINT_TYPE_CODES[resolved.jointType],
      resolved.jointIndex,
      resolved.jointGeneration,
      enabled,
    );
  };

  const queryNearestBody = (query: PhysicsNearestBodyQuery): PhysicsNearestBodyHit | undefined => {
    requireAlive();
    const hit = rustEngine.query_nearest_body(
      query.x,
      query.y,
      query.maxDistance,
      physicsQueryMaskBits(query.queryMaskBits),
    );
    if (!hit) {
      return undefined;
    }
    return {
      entityId: rustEngine.physics_query_entity_id(),
      entityGeneration: rustEngine.physics_query_entity_generation(),
      pointX: rustEngine.physics_query_point_x(),
      pointY: rustEngine.physics_query_point_y(),
      distance: rustEngine.physics_query_distance(),
    };
  };

  const queryNearestTileObstacle = (
    query: PhysicsNearestTileObstacleQuery,
  ): PhysicsNearestTileObstacleHit | undefined => {
    requireAlive();
    const hit = rustEngine.query_nearest_tile_obstacle(query.x, query.y, query.maxDistance);
    if (!hit) {
      return undefined;
    }
    return {
      layerIndex: rustEngine.physics_query_tile_layer_index(),
      tileIndex: rustEngine.physics_query_tile_index(),
      pointX: rustEngine.physics_query_point_x(),
      pointY: rustEngine.physics_query_point_y(),
      distance: rustEngine.physics_query_distance(),
    };
  };

  const queryBodyContacts = (
    query: PhysicsBodyContactQuery = {},
  ): readonly PhysicsBodyContactHit[] => {
    requireAlive();
    rustEngine.query_body_contacts(
      physicsQueryMaskBits(query.categoryABits),
      physicsQueryMaskBits(query.categoryBBits),
    );
    return bridge.readPhysicsBodyContactHits();
  };

  const queryBodyManifolds = (
    query: PhysicsBodyManifoldQuery = {},
  ): readonly PhysicsBodyManifoldHit[] => {
    requireAlive();
    rustEngine.query_body_manifolds(
      physicsQueryMaskBits(query.categoryABits),
      physicsQueryMaskBits(query.categoryBBits),
    );
    return bridge.readPhysicsBodyManifoldHits();
  };

  const queryRigidContactImpulses = (): readonly PhysicsRigidContactImpulseHit[] => {
    requireAlive();
    rustEngine.query_rigid_contact_impulses();
    return bridge.readPhysicsRigidContactImpulseHits();
  };

  const queryPointBodies = (query: PhysicsPointBodyQuery): readonly PhysicsBodyQueryHit[] => {
    requireAlive();
    rustEngine.query_point_bodies(query.x, query.y, physicsQueryMaskBits(query.queryMaskBits));
    return bridge.readPhysicsQueryHits();
  };

  const queryAabbBodies = (query: PhysicsAabbBodyQuery): readonly PhysicsBodyQueryHit[] => {
    requireAlive();
    rustEngine.query_aabb_bodies(
      query.x,
      query.y,
      query.halfWidth,
      query.halfHeight,
      physicsQueryMaskBits(query.queryMaskBits),
    );
    return bridge.readPhysicsQueryHits();
  };

  const queryCircleBodies = (query: PhysicsCircleBodyQuery): readonly PhysicsBodyQueryHit[] => {
    requireAlive();
    rustEngine.query_circle_bodies(
      query.x,
      query.y,
      query.radius,
      physicsQueryMaskBits(query.queryMaskBits),
    );
    return bridge.readPhysicsQueryHits();
  };

  const queryOrientedBoxBodies = (
    query: PhysicsOrientedBoxBodyQuery,
  ): readonly PhysicsBodyQueryHit[] => {
    requireAlive();
    rustEngine.query_oriented_box_bodies(
      query.x,
      query.y,
      query.halfWidth,
      query.halfHeight,
      query.rotationRadians,
      physicsQueryMaskBits(query.queryMaskBits),
    );
    return bridge.readPhysicsQueryHits();
  };

  const queryCapsuleBodies = (query: PhysicsCapsuleBodyQuery): readonly PhysicsBodyQueryHit[] => {
    requireAlive();
    rustEngine.query_capsule_bodies(
      query.startX,
      query.startY,
      query.endX,
      query.endY,
      query.radius,
      physicsQueryMaskBits(query.queryMaskBits),
    );
    return bridge.readPhysicsQueryHits();
  };

  const queryConvexPolygonBodies = (
    query: PhysicsConvexPolygonBodyQuery,
  ): readonly PhysicsBodyQueryHit[] => {
    requireAlive();
    rustEngine.query_convex_polygon_bodies(
      physicsQueryVertexBuffer(query.vertices),
      physicsQueryMaskBits(query.queryMaskBits),
    );
    return bridge.readPhysicsQueryHits();
  };

  const raycastBodies = (query: PhysicsRaycastBodyQuery): readonly PhysicsRaycastBodyHit[] => {
    requireAlive();
    rustEngine.raycast_bodies(
      query.originX,
      query.originY,
      query.directionX,
      query.directionY,
      query.maxDistance,
      physicsQueryMaskBits(query.queryMaskBits),
    );
    return bridge.readPhysicsRaycastHits();
  };

  const segmentCastBodies = (
    query: PhysicsSegmentCastBodyQuery,
  ): readonly PhysicsRaycastBodyHit[] => {
    requireAlive();
    rustEngine.segment_cast_bodies(
      query.startX,
      query.startY,
      query.endX,
      query.endY,
      physicsQueryMaskBits(query.queryMaskBits),
    );
    return bridge.readPhysicsRaycastHits();
  };

  const raycastTileObstacles = (
    query: PhysicsRaycastTileObstacleQuery,
  ): readonly PhysicsTileRaycastHit[] => {
    requireAlive();
    rustEngine.raycast_tile_obstacles(
      query.originX,
      query.originY,
      query.directionX,
      query.directionY,
      query.maxDistance,
    );
    return bridge.readPhysicsTileRaycastHits();
  };

  const segmentCastTileObstacles = (
    query: PhysicsSegmentCastTileObstacleQuery,
  ): readonly PhysicsTileRaycastHit[] => {
    requireAlive();
    rustEngine.segment_cast_tile_obstacles(
      query.startX,
      query.startY,
      query.endX,
      query.endY,
    );
    return bridge.readPhysicsTileRaycastHits();
  };

  const shapeCastAabbBodies = (
    query: PhysicsAabbBodyShapeCastQuery,
  ): readonly PhysicsShapeCastBodyHit[] => {
    requireAlive();
    rustEngine.shape_cast_aabb_bodies(
      query.x,
      query.y,
      query.halfWidth,
      query.halfHeight,
      query.directionX,
      query.directionY,
      query.maxDistance,
      physicsQueryMaskBits(query.queryMaskBits),
    );
    return bridge.readPhysicsShapeCastHits();
  };

  const shapeCastCircleBodies = (
    query: PhysicsCircleBodyShapeCastQuery,
  ): readonly PhysicsShapeCastBodyHit[] => {
    requireAlive();
    rustEngine.shape_cast_circle_bodies(
      query.x,
      query.y,
      query.radius,
      query.directionX,
      query.directionY,
      query.maxDistance,
      physicsQueryMaskBits(query.queryMaskBits),
    );
    return bridge.readPhysicsShapeCastHits();
  };

  const shapeCastOrientedBoxBodies = (
    query: PhysicsOrientedBoxBodyShapeCastQuery,
  ): readonly PhysicsShapeCastBodyHit[] => {
    requireAlive();
    rustEngine.shape_cast_oriented_box_bodies(
      query.x,
      query.y,
      query.halfWidth,
      query.halfHeight,
      query.rotationRadians,
      query.directionX,
      query.directionY,
      query.maxDistance,
      physicsQueryMaskBits(query.queryMaskBits),
    );
    return bridge.readPhysicsShapeCastHits();
  };

  const shapeCastCapsuleBodies = (
    query: PhysicsCapsuleBodyShapeCastQuery,
  ): readonly PhysicsShapeCastBodyHit[] => {
    requireAlive();
    rustEngine.shape_cast_capsule_bodies(
      query.startX,
      query.startY,
      query.endX,
      query.endY,
      query.radius,
      query.directionX,
      query.directionY,
      query.maxDistance,
      physicsQueryMaskBits(query.queryMaskBits),
    );
    return bridge.readPhysicsShapeCastHits();
  };

  const shapeCastConvexPolygonBodies = (
    query: PhysicsConvexPolygonBodyShapeCastQuery,
  ): readonly PhysicsShapeCastBodyHit[] => {
    requireAlive();
    rustEngine.shape_cast_convex_polygon_bodies(
      physicsQueryVertexBuffer(query.vertices),
      query.directionX,
      query.directionY,
      query.maxDistance,
      physicsQueryMaskBits(query.queryMaskBits),
    );
    return bridge.readPhysicsShapeCastHits();
  };

  const shapeCastAabbTileObstacles = (
    query: PhysicsAabbTileObstacleShapeCastQuery,
  ): readonly PhysicsTileShapeCastHit[] => {
    requireAlive();
    rustEngine.shape_cast_aabb_tile_obstacles(
      query.x,
      query.y,
      query.halfWidth,
      query.halfHeight,
      query.directionX,
      query.directionY,
      query.maxDistance,
    );
    return bridge.readPhysicsTileShapeCastHits();
  };

  const queryAabbTileObstacleContacts = (
    query: PhysicsAabbTileObstacleContactQuery,
  ): readonly PhysicsTileContactHit[] => {
    requireAlive();
    rustEngine.query_aabb_tile_obstacle_contacts(
      query.x,
      query.y,
      query.halfWidth,
      query.halfHeight,
    );
    return bridge.readPhysicsTileContactHits();
  };

  const queryAabbTileObstacleManifolds = (
    query: PhysicsAabbTileObstacleManifoldQuery,
  ): readonly PhysicsTileManifoldHit[] => {
    requireAlive();
    rustEngine.query_aabb_tile_obstacle_manifolds(
      query.x,
      query.y,
      query.halfWidth,
      query.halfHeight,
    );
    return bridge.readPhysicsTileManifoldHits();
  };

  const setShooterTilemapTile = (
    layerIndex: number,
    column: number,
    row: number,
    tileId: number,
  ): boolean => {
    requireAlive();
    return rustEngine.set_shooter_tilemap_tile(
      uint32Number(layerIndex, "tilemap layer index"),
      uint32Number(column, "tilemap column"),
      uint32Number(row, "tilemap row"),
      uint32Number(tileId, "tile id"),
    );
  };

  const setShooterTilemapTilesRect = (
    layerIndex: number,
    column: number,
    row: number,
    width: number,
    height: number,
    tileId: number,
  ): boolean => {
    requireAlive();
    return rustEngine.set_shooter_tilemap_tiles_rect(
      uint32Number(layerIndex, "tilemap layer index"),
      uint32Number(column, "tilemap column"),
      uint32Number(row, "tilemap row"),
      uint32Number(width, "tilemap rect width"),
      uint32Number(height, "tilemap rect height"),
      uint32Number(tileId, "tile id"),
    );
  };

  const lifecycleApi: FerrumLifecycleApi = {
    start: () => {
      requireAlive();
      if (running) {
        return;
      }
      loop.start();
      running = true;
      paused = false;
      options.lifecycle?.onStart?.(lifecycleSnapshot());
    },
    pause: () => {
      requireAlive();
      if (!running || paused) {
        return;
      }
      loop.pause();
      paused = true;
      options.lifecycle?.onPause?.(lifecycleSnapshot());
    },
    resume: () => {
      requireAlive();
      if (!running || !paused) {
        return;
      }
      loop.resume();
      paused = false;
      options.lifecycle?.onResume?.(lifecycleSnapshot());
    },
    stop: () => {
      if (destroyed || !running) {
        return;
      }
      const snapshot = lifecycleSnapshot();
      loop.stop();
      running = false;
      paused = false;
      options.lifecycle?.onStop?.(snapshot);
    },
    destroy,
    time: () => { requireAlive(); return rustEngine.time(); },
    version: () => { requireAlive(); return bridge.version(); },
  };

  const sceneApi: FerrumSceneApi = {
    score: () => { requireAlive(); return rustEngine.score(); },
    entityCount: () => { requireAlive(); return rustEngine.entity_count(); },
    gameState: () => { requireAlive(); return rustEngine.game_state(); },
    spriteCount: () => { requireAlive(); return rustEngine.sprite_count(); },
    resetGame: () => { requireAlive(); rustEngine.reset_game(); },
    useBreakoutGame,
    usePlatformerGame,
    setViewportSize: (width, height) => {
      requireAlive();
      rustEngine.set_viewport_size(width, height);
    },
    setGameSpec,
    setShooterTilemapTile,
    setShooterTilemapTilesRect,
    cameraX: () => { requireAlive(); return rustEngine.camera_x(); },
    cameraY: () => { requireAlive(); return rustEngine.camera_y(); },
  };

  const assetApi: FerrumAssetApi = {
    loadAssets: async (manifest, onProgress) => {
      requireAlive();
      return await requireAssetHost().loadAssets(manifest, onProgress);
    },
    textureId: (name) => {
      requireAlive();
      return requireAssetHost().textureId(name);
    },
    soundId: (name) => {
      requireAlive();
      const host = requireAssetHost();
      if (!host.soundId) {
        throw new Error("soundId() requires an AssetHost with sound support. Pass BrowserPlatformHost as the third createEngine() argument.");
      }
      return host.soundId(name);
    },
    setTextureIds,
    setSoundIds,
  };

  const particleApi: FerrumParticleApi = {
    setParticlePreset,
    clearParticlePresets: () => { requireAlive(); rustEngine.clear_particle_presets(); },
    setShooterHitParticlePreset: (presetId) => {
      requireAlive();
      rustEngine.set_shooter_hit_particle_preset(particlePresetId(presetId));
    },
    clearShooterHitParticlePreset: () => { requireAlive(); rustEngine.clear_shooter_hit_particle_preset(); },
    setParticleSeed: (seed) => { requireAlive(); rustEngine.set_particle_seed(uint32Number(seed, "particle seed")); },
    spawnParticleBurst,
    clearParticles: () => { requireAlive(); rustEngine.clear_particles(); },
    particleCount: () => { requireAlive(); return rustEngine.particle_count(); },
    particleCapacity: () => { requireAlive(); return rustEngine.particle_capacity(); },
  };

  const physicsRuntimeApi: FerrumPhysicsRuntimeApi = {
    configureFixedTimestep,
    setPhysicsDebugLinesEnabled,
    setPhysicsDebugOptions,
    stepRigidBodies,
  };

  const physicsBodyApi: FerrumPhysicsBodyApi = {
    spawnRigidBody,
    addPhysicsBodyCollider,
    getPhysicsBodyColliderCount,
    getPhysicsBodyCollider,
    getPhysicsEntity,
    capturePhysicsBodyStateBuffer,
    restorePhysicsBodyStateBuffer,
    despawnPhysicsEntity,
    setPhysicsBodyPosition,
    setPhysicsBodyVelocity,
    setPhysicsBodyRotation,
    setPhysicsBodyAngularVelocity,
    setPhysicsBodyEnabled,
    setPhysicsColliderOffset,
    setPhysicsColliderEnabled,
    setPhysicsColliderMaterial,
    setPhysicsBodyColliderMaterial,
    clearPhysicsColliderMaterial,
    setPhysicsBodyMassProperties,
    setPhysicsBodyTuning,
    setPhysicsBodyMaterial,
    applyPhysicsBodyForce,
    applyPhysicsBodyImpulse,
    applyPhysicsBodyTorque,
    applyPhysicsBodyAngularImpulse,
  };

  const physicsJointApi: FerrumPhysicsJointApi = {
    spawnPhysicsJoint,
    getPhysicsJoint,
    clearPhysicsJoint,
    setPhysicsJointEnabled,
  };

  const physicsQueryApi: FerrumPhysicsQueryApi = {
    queryNearestBody,
    queryNearestTileObstacle,
    queryBodyContacts,
    queryBodyManifolds,
    queryRigidContactImpulses,
    queryPointBodies,
    queryAabbBodies,
    queryCircleBodies,
    queryOrientedBoxBodies,
    queryCapsuleBodies,
    queryConvexPolygonBodies,
    raycastBodies,
    segmentCastBodies,
    raycastTileObstacles,
    segmentCastTileObstacles,
    shapeCastAabbBodies,
    shapeCastCircleBodies,
    shapeCastOrientedBoxBodies,
    shapeCastCapsuleBodies,
    shapeCastConvexPolygonBodies,
    shapeCastAabbTileObstacles,
    queryAabbTileObstacleContacts,
    queryAabbTileObstacleManifolds,
  };

  return {
    ...lifecycleApi,
    ...sceneApi,
    ...assetApi,
    ...particleApi,
    ...physicsRuntimeApi,
    ...physicsBodyApi,
    ...physicsJointApi,
    ...physicsQueryApi,
  };
}

function physicsQueryMaskBits(queryMaskBits: number | undefined): number {
  return queryMaskBits === undefined ? DEFAULT_PHYSICS_QUERY_MASK_BITS : queryMaskBits >>> 0;
}

function physicsQueryVertexBuffer(vertices: PhysicsConvexPolygonVertexBuffer): Float32Array {
  return vertices instanceof Float32Array ? vertices : Float32Array.from(vertices);
}

function positiveNumber(value: number, label: string): number {
  const resolved = finiteNumber(value, label);
  if (resolved <= 0) {
    throw new Error(`${label} must be greater than 0.`);
  }
  return resolved;
}

function nonNegativeNumber(value: number, label: string): number {
  const resolved = finiteNumber(value, label);
  if (resolved < 0) {
    throw new Error(`${label} must be greater than or equal to 0.`);
  }
  return resolved;
}

function unitIntervalNumber(value: number, label: string): number {
  const resolved = finiteNumber(value, label);
  if (resolved < 0 || resolved > 1) {
    throw new Error(`${label} must be between 0 and 1.`);
  }
  return resolved;
}

function breakLimitNumber(value: number, label: string): number {
  if (value === Number.POSITIVE_INFINITY) {
    return value;
  }
  return nonNegativeNumber(value, label);
}

function physicsRigidBodyType(bodyType: PhysicsRigidBodyType | undefined): PhysicsRigidBodyType {
  if (bodyType === undefined) {
    return "dynamic";
  }
  if (bodyType in PHYSICS_BODY_TYPE_CODES) {
    return bodyType;
  }
  throw new Error("physics bodyType must be static, kinematic, or dynamic.");
}

function physicsCollisionLayerCode(layer: PhysicsCollisionLayer): number {
  if (layer in PHYSICS_LAYER_CODES) {
    return PHYSICS_LAYER_CODES[layer];
  }
  throw new Error("physics collision layer must be player, enemy, bullet, or wall.");
}

function physicsEntityHandle(handle: PhysicsEntityHandle): PhysicsEntityHandle {
  return {
    entityId: uint32Number(handle.entityId, "physics entity id"),
    entityGeneration: uint32Number(handle.entityGeneration, "physics entity generation"),
  };
}

function physicsEntityHandleBuffer(handles: readonly PhysicsEntityHandle[]): Uint32Array {
  const buffer = new Uint32Array(handles.length * 2);
  handles.forEach((handle, index) => {
    const resolved = physicsEntityHandle(handle);
    const offset = index * 2;
    buffer[offset] = resolved.entityId;
    buffer[offset + 1] = resolved.entityGeneration;
  });
  return buffer;
}

function readPhysicsEntityHandle(rustEngine: Engine): PhysicsEntityHandle {
  return {
    entityId: rustEngine.physics_entity_id(),
    entityGeneration: rustEngine.physics_entity_generation(),
  };
}

function readPhysicsEntitySnapshot(rustEngine: Engine): PhysicsEntitySnapshot {
  return {
    ...readPhysicsEntityHandle(rustEngine),
    x: rustEngine.physics_entity_x(),
    y: rustEngine.physics_entity_y(),
    velocityX: rustEngine.physics_entity_velocity_x(),
    velocityY: rustEngine.physics_entity_velocity_y(),
    rotationRadians: rustEngine.physics_entity_rotation_radians(),
    angularVelocityRadiansPerSecond:
      rustEngine.physics_entity_angular_velocity_radians_per_second(),
    bodyType: PHYSICS_BODY_TYPES[rustEngine.physics_entity_body_type()] ?? "dynamic",
    bodyEnabled: rustEngine.physics_entity_body_enabled(),
    isSleeping: rustEngine.physics_entity_is_sleeping(),
    colliderType: PHYSICS_COLLIDER_TYPES[rustEngine.physics_entity_collider_type()] ?? "none",
    colliderEnabled: rustEngine.physics_entity_collider_enabled(),
    colliderIsTrigger: rustEngine.physics_entity_collider_is_trigger(),
    colliderOffsetX: rustEngine.physics_entity_collider_offset_x(),
    colliderOffsetY: rustEngine.physics_entity_collider_offset_y(),
    colliderMaterialOverride: rustEngine.physics_entity_collider_material_override(),
    colliderMaterial: {
      restitution: rustEngine.physics_entity_collider_restitution(),
      friction: rustEngine.physics_entity_collider_friction(),
      surfaceVelocityX: rustEngine.physics_entity_collider_surface_velocity_x(),
      surfaceVelocityY: rustEngine.physics_entity_collider_surface_velocity_y(),
      density: rustEngine.physics_entity_collider_density(),
      contactBaumgarteBiasScale:
        rustEngine.physics_entity_collider_contact_baumgarte_bias_scale(),
      maxContactBaumgarteBiasVelocityScale:
        rustEngine.physics_entity_collider_max_contact_baumgarte_bias_velocity_scale(),
      contactPositionCorrectionScale:
        rustEngine.physics_entity_collider_contact_position_correction_scale(),
      contactPositionCorrectionSlopScale:
        rustEngine.physics_entity_collider_contact_position_correction_slop_scale(),
    },
    mass: rustEngine.physics_entity_mass(),
    inverseMass: rustEngine.physics_entity_inverse_mass(),
    inertia: rustEngine.physics_entity_inertia(),
    inverseInertia: rustEngine.physics_entity_inverse_inertia(),
    gravityScale: rustEngine.physics_entity_gravity_scale(),
    linearDamping: rustEngine.physics_entity_linear_damping(),
    angularDamping: rustEngine.physics_entity_angular_damping(),
    restitution: rustEngine.physics_entity_restitution(),
    friction: rustEngine.physics_entity_friction(),
    surfaceVelocityX: rustEngine.physics_entity_surface_velocity_x(),
    surfaceVelocityY: rustEngine.physics_entity_surface_velocity_y(),
    density: rustEngine.physics_entity_density(),
    contactBaumgarteBiasScale: rustEngine.physics_entity_contact_baumgarte_bias_scale(),
    maxContactBaumgarteBiasVelocityScale:
      rustEngine.physics_entity_max_contact_baumgarte_bias_velocity_scale(),
    contactPositionCorrectionScale:
      rustEngine.physics_entity_contact_position_correction_scale(),
    contactPositionCorrectionSlopScale:
      rustEngine.physics_entity_contact_position_correction_slop_scale(),
  };
}

interface PhysicsBodyStateBufferDecodeInput {
  bodyCount: number;
  handles: Uint32Array;
  floats: Float32Array;
  u32s: Uint32Array;
  floatsPerBody: number;
  u32sPerBody: number;
}

function decodePhysicsBodyStateBuffer(
  snapshot: PhysicsBodyStateBufferDecodeInput,
): readonly PhysicsEntitySnapshot[] {
  const states: PhysicsEntitySnapshot[] = [];
  for (let index = 0; index < snapshot.bodyCount; index += 1) {
    const floatOffset = index * snapshot.floatsPerBody;
    const u32Offset = index * snapshot.u32sPerBody;
    const flags = snapshot.u32s[u32Offset + PHYSICS_BODY_STATE_U32_FLAGS];
    states.push({
      entityId: snapshot.u32s[u32Offset + PHYSICS_BODY_STATE_U32_ENTITY_ID],
      entityGeneration: snapshot.u32s[u32Offset + PHYSICS_BODY_STATE_U32_ENTITY_GENERATION],
      x: snapshot.floats[floatOffset],
      y: snapshot.floats[floatOffset + 1],
      velocityX: snapshot.floats[floatOffset + 2],
      velocityY: snapshot.floats[floatOffset + 3],
      rotationRadians: snapshot.floats[floatOffset + 4],
      angularVelocityRadiansPerSecond: snapshot.floats[floatOffset + 5],
      bodyType: PHYSICS_BODY_TYPES[snapshot.u32s[u32Offset + PHYSICS_BODY_STATE_U32_BODY_TYPE]] ?? "dynamic",
      bodyEnabled: (flags & PHYSICS_BODY_STATE_FLAG_BODY_ENABLED) !== 0,
      isSleeping: (flags & PHYSICS_BODY_STATE_FLAG_SLEEPING) !== 0,
      colliderType:
        PHYSICS_COLLIDER_TYPES[snapshot.u32s[u32Offset + PHYSICS_BODY_STATE_U32_COLLIDER_TYPE]] ?? "none",
      colliderEnabled: (flags & PHYSICS_BODY_STATE_FLAG_COLLIDER_ENABLED) !== 0,
      colliderIsTrigger: (flags & PHYSICS_BODY_STATE_FLAG_COLLIDER_TRIGGER) !== 0,
      colliderOffsetX: snapshot.floats[floatOffset + 20],
      colliderOffsetY: snapshot.floats[floatOffset + 21],
      colliderMaterialOverride: (flags & PHYSICS_BODY_STATE_FLAG_COLLIDER_MATERIAL_OVERRIDE) !== 0,
      colliderMaterial: {
        restitution: snapshot.floats[floatOffset + 22],
        friction: snapshot.floats[floatOffset + 23],
        surfaceVelocityX: snapshot.floats[floatOffset + 24],
        surfaceVelocityY: snapshot.floats[floatOffset + 25],
        density: snapshot.floats[floatOffset + 26],
        contactBaumgarteBiasScale: snapshot.floats[floatOffset + 27],
        maxContactBaumgarteBiasVelocityScale: snapshot.floats[floatOffset + 28],
        contactPositionCorrectionScale: snapshot.floats[floatOffset + 29],
        contactPositionCorrectionSlopScale: snapshot.floats[floatOffset + 30],
      },
      mass: snapshot.floats[floatOffset + 6],
      inverseMass: inverseOrZero(snapshot.floats[floatOffset + 6]),
      inertia: snapshot.floats[floatOffset + 7],
      inverseInertia: inverseOrZero(snapshot.floats[floatOffset + 7]),
      gravityScale: snapshot.floats[floatOffset + 8],
      linearDamping: snapshot.floats[floatOffset + 9],
      angularDamping: snapshot.floats[floatOffset + 10],
      restitution: snapshot.floats[floatOffset + 11],
      friction: snapshot.floats[floatOffset + 12],
      surfaceVelocityX: snapshot.floats[floatOffset + 13],
      surfaceVelocityY: snapshot.floats[floatOffset + 14],
      density: snapshot.floats[floatOffset + 15],
      contactBaumgarteBiasScale: snapshot.floats[floatOffset + 16],
      maxContactBaumgarteBiasVelocityScale: snapshot.floats[floatOffset + 17],
      contactPositionCorrectionScale: snapshot.floats[floatOffset + 18],
      contactPositionCorrectionSlopScale: snapshot.floats[floatOffset + 19],
    });
  }
  return states;
}

function inverseOrZero(value: number): number {
  return Number.isFinite(value) && value > 0 ? 1 / value : 0;
}

function readPhysicsBodyColliderSnapshot(rustEngine: Engine): PhysicsBodyColliderSnapshot {
  return {
    colliderIndex: rustEngine.physics_body_collider_index(),
    colliderType: PHYSICS_COLLIDER_TYPES[rustEngine.physics_body_collider_type()] ?? "none",
    colliderEnabled: rustEngine.physics_body_collider_enabled(),
    colliderIsTrigger: rustEngine.physics_body_collider_is_trigger(),
    colliderOffsetX: rustEngine.physics_body_collider_offset_x(),
    colliderOffsetY: rustEngine.physics_body_collider_offset_y(),
    colliderMaterialOverride: rustEngine.physics_body_collider_material_override(),
    colliderMaterial: {
      restitution: rustEngine.physics_body_collider_restitution(),
      friction: rustEngine.physics_body_collider_friction(),
      surfaceVelocityX: rustEngine.physics_body_collider_surface_velocity_x(),
      surfaceVelocityY: rustEngine.physics_body_collider_surface_velocity_y(),
      density: rustEngine.physics_body_collider_density(),
      contactBaumgarteBiasScale:
        rustEngine.physics_body_collider_contact_baumgarte_bias_scale(),
      maxContactBaumgarteBiasVelocityScale:
        rustEngine.physics_body_collider_max_contact_baumgarte_bias_velocity_scale(),
      contactPositionCorrectionScale:
        rustEngine.physics_body_collider_contact_position_correction_scale(),
      contactPositionCorrectionSlopScale:
        rustEngine.physics_body_collider_contact_position_correction_slop_scale(),
    },
    categoryBits: rustEngine.physics_body_collider_category_bits(),
    maskBits: rustEngine.physics_body_collider_mask_bits(),
  };
}

function physicsJointHandle(handle: PhysicsJointHandle): PhysicsJointHandle {
  if (!(handle.jointType in PHYSICS_JOINT_TYPE_CODES)) {
    throw new Error(
      "physics jointType must be distance, rope, spring, pulley, revolute, prismatic, weld, or gear.",
    );
  }
  return {
    jointType: handle.jointType,
    jointIndex: uint32Number(handle.jointIndex, "physics joint index"),
    jointGeneration: uint32Number(handle.jointGeneration, "physics joint generation"),
  };
}

function readPhysicsJointHandle(rustEngine: Engine): PhysicsJointHandle {
  return {
    jointType: PHYSICS_JOINT_TYPES[rustEngine.physics_joint_type()] ?? "distance",
    jointIndex: rustEngine.physics_joint_index(),
    jointGeneration: rustEngine.physics_joint_generation(),
  };
}

function readPhysicsJointSnapshot(rustEngine: Engine): PhysicsJointSnapshot {
  return {
    ...readPhysicsJointHandle(rustEngine),
    entityA: {
      entityId: rustEngine.physics_joint_entity_a_id(),
      entityGeneration: rustEngine.physics_joint_entity_a_generation(),
    },
    entityB: {
      entityId: rustEngine.physics_joint_entity_b_id(),
      entityGeneration: rustEngine.physics_joint_entity_b_generation(),
    },
    enabled: rustEngine.physics_joint_enabled(),
    restLength: rustEngine.physics_joint_rest_length(),
    maxLength: rustEngine.physics_joint_max_length(),
    ratio: rustEngine.physics_joint_ratio(),
    referenceAngle: rustEngine.physics_joint_reference_angle(),
    breakDistance: rustEngine.physics_joint_break_distance(),
    breakAngle: rustEngine.physics_joint_break_angle(),
    stiffness: rustEngine.physics_joint_stiffness(),
    damping: rustEngine.physics_joint_damping(),
    angularStiffness: rustEngine.physics_joint_angular_stiffness(),
    angularDamping: rustEngine.physics_joint_angular_damping(),
    localAnchorAX: rustEngine.physics_joint_local_anchor_a_x(),
    localAnchorAY: rustEngine.physics_joint_local_anchor_a_y(),
    localAnchorBX: rustEngine.physics_joint_local_anchor_b_x(),
    localAnchorBY: rustEngine.physics_joint_local_anchor_b_y(),
    localAxisAX: rustEngine.physics_joint_local_axis_a_x(),
    localAxisAY: rustEngine.physics_joint_local_axis_a_y(),
    groundAnchorAX: rustEngine.physics_joint_ground_anchor_a_x(),
    groundAnchorAY: rustEngine.physics_joint_ground_anchor_a_y(),
    groundAnchorBX: rustEngine.physics_joint_ground_anchor_b_x(),
    groundAnchorBY: rustEngine.physics_joint_ground_anchor_b_y(),
    limitEnabled: rustEngine.physics_joint_limit_enabled(),
    lowerAngle: rustEngine.physics_joint_lower_angle(),
    upperAngle: rustEngine.physics_joint_upper_angle(),
    lowerTranslation: rustEngine.physics_joint_lower_translation(),
    upperTranslation: rustEngine.physics_joint_upper_translation(),
    motorEnabled: rustEngine.physics_joint_motor_enabled(),
    motorSpeed: rustEngine.physics_joint_motor_speed(),
    maxMotorForce: rustEngine.physics_joint_max_motor_force(),
    maxMotorTorque: rustEngine.physics_joint_max_motor_torque(),
  };
}

function applyPhysicsColliderOffset(
  rustEngine: Engine,
  handle: PhysicsEntityHandle,
  collider: PhysicsRigidBodyCollider,
): void {
  const offsetX = collider.offsetX;
  const offsetY = collider.offsetY;
  if (offsetX === undefined && offsetY === undefined) {
    return;
  }
  rustEngine.set_physics_collider_offset(
    handle.entityId,
    handle.entityGeneration,
    finiteNumber(offsetX ?? 0, "physics collider offsetX"),
    finiteNumber(offsetY ?? 0, "physics collider offsetY"),
  );
}

function applyPhysicsBodyTuning(
  rustEngine: Engine,
  handle: PhysicsEntityHandle,
  bodyType: PhysicsRigidBodyType,
  options: PhysicsRigidBodySpawnOptions,
): void {
  if (
    options.gravityScale === undefined &&
    options.linearDamping === undefined &&
    options.angularDamping === undefined
  ) {
    return;
  }
  rustEngine.set_physics_body_tuning(
    handle.entityId,
    handle.entityGeneration,
    finiteNumber(
      options.gravityScale ?? (bodyType === "dynamic" ? 1 : 0),
      "physics body gravityScale",
    ),
    nonNegativeNumber(options.linearDamping ?? 0, "physics body linearDamping"),
    nonNegativeNumber(options.angularDamping ?? 0, "physics body angularDamping"),
  );
}

function applyPhysicsBodyMaterial(
  rustEngine: Engine,
  handle: PhysicsEntityHandle,
  material: PhysicsRigidBodyMaterial,
): void {
  setPhysicsBodyMaterialValues(rustEngine, handle, {
    restitution: material.restitution ?? DEFAULT_RIGID_BODY_RESTITUTION,
    friction: material.friction ?? DEFAULT_RIGID_BODY_FRICTION,
    surfaceVelocityX: material.surfaceVelocityX ?? 0,
    surfaceVelocityY: material.surfaceVelocityY ?? 0,
    density: material.density ?? DEFAULT_RIGID_BODY_DENSITY,
    contactBaumgarteBiasScale:
      material.contactBaumgarteBiasScale ?? DEFAULT_RIGID_BODY_MATERIAL_SCALE,
    maxContactBaumgarteBiasVelocityScale:
      material.maxContactBaumgarteBiasVelocityScale ?? DEFAULT_RIGID_BODY_MATERIAL_SCALE,
    contactPositionCorrectionScale:
      material.contactPositionCorrectionScale ?? DEFAULT_RIGID_BODY_MATERIAL_SCALE,
    contactPositionCorrectionSlopScale:
      material.contactPositionCorrectionSlopScale ?? DEFAULT_RIGID_BODY_MATERIAL_SCALE,
  });
}

function applyPhysicsColliderMaterial(
  rustEngine: Engine,
  handle: PhysicsEntityHandle,
  material: PhysicsRigidBodyMaterial,
): void {
  if (!rustEngine.query_physics_entity(handle.entityId, handle.entityGeneration)) {
    return;
  }
  const current = readPhysicsEntitySnapshot(rustEngine);
  setPhysicsColliderMaterialValues(rustEngine, handle, {
    restitution: material.restitution ?? current.colliderMaterial.restitution,
    friction: material.friction ?? current.colliderMaterial.friction,
    surfaceVelocityX: material.surfaceVelocityX ?? current.colliderMaterial.surfaceVelocityX,
    surfaceVelocityY: material.surfaceVelocityY ?? current.colliderMaterial.surfaceVelocityY,
    density: material.density ?? current.colliderMaterial.density,
    contactBaumgarteBiasScale:
      material.contactBaumgarteBiasScale ?? current.colliderMaterial.contactBaumgarteBiasScale,
    maxContactBaumgarteBiasVelocityScale:
      material.maxContactBaumgarteBiasVelocityScale ??
      current.colliderMaterial.maxContactBaumgarteBiasVelocityScale,
    contactPositionCorrectionScale:
      material.contactPositionCorrectionScale ??
      current.colliderMaterial.contactPositionCorrectionScale,
    contactPositionCorrectionSlopScale:
      material.contactPositionCorrectionSlopScale ??
      current.colliderMaterial.contactPositionCorrectionSlopScale,
  });
}

function setPhysicsBodyMaterialValues(
  rustEngine: Engine,
  handle: PhysicsEntityHandle,
  material: Required<PhysicsRigidBodyMaterial>,
): boolean {
  return rustEngine.set_physics_body_material(
    handle.entityId,
    handle.entityGeneration,
    nonNegativeNumber(
      material.restitution,
      "physics body material restitution",
    ),
    nonNegativeNumber(
      material.friction,
      "physics body material friction",
    ),
    finiteNumber(material.surfaceVelocityX, "physics body material surfaceVelocityX"),
    finiteNumber(material.surfaceVelocityY, "physics body material surfaceVelocityY"),
    positiveNumber(material.density, "physics body material density"),
    nonNegativeNumber(
      material.contactBaumgarteBiasScale,
      "physics body material contactBaumgarteBiasScale",
    ),
    nonNegativeNumber(
      material.maxContactBaumgarteBiasVelocityScale,
      "physics body material maxContactBaumgarteBiasVelocityScale",
    ),
    nonNegativeNumber(
      material.contactPositionCorrectionScale,
      "physics body material contactPositionCorrectionScale",
    ),
    nonNegativeNumber(
      material.contactPositionCorrectionSlopScale,
      "physics body material contactPositionCorrectionSlopScale",
    ),
  );
}

function setPhysicsColliderMaterialValues(
  rustEngine: Engine,
  handle: PhysicsEntityHandle,
  material: PhysicsMaterialSnapshot,
): boolean {
  return rustEngine.set_physics_collider_material(
    handle.entityId,
    handle.entityGeneration,
    nonNegativeNumber(
      material.restitution,
      "physics collider material restitution",
    ),
    nonNegativeNumber(
      material.friction,
      "physics collider material friction",
    ),
    finiteNumber(material.surfaceVelocityX, "physics collider material surfaceVelocityX"),
    finiteNumber(material.surfaceVelocityY, "physics collider material surfaceVelocityY"),
    positiveNumber(material.density, "physics collider material density"),
    nonNegativeNumber(
      material.contactBaumgarteBiasScale,
      "physics collider material contactBaumgarteBiasScale",
    ),
    nonNegativeNumber(
      material.maxContactBaumgarteBiasVelocityScale,
      "physics collider material maxContactBaumgarteBiasVelocityScale",
    ),
    nonNegativeNumber(
      material.contactPositionCorrectionScale,
      "physics collider material contactPositionCorrectionScale",
    ),
    nonNegativeNumber(
      material.contactPositionCorrectionSlopScale,
      "physics collider material contactPositionCorrectionSlopScale",
    ),
  );
}

function setPhysicsCompoundColliderMaterialValues(
  rustEngine: Engine,
  handle: PhysicsEntityHandle,
  colliderIndex: number,
  material: PhysicsMaterialSnapshot,
): boolean {
  return rustEngine.set_physics_compound_collider_material(
    handle.entityId,
    handle.entityGeneration,
    uint32Number(colliderIndex, "physics collider index"),
    nonNegativeNumber(
      material.restitution,
      "physics collider material restitution",
    ),
    nonNegativeNumber(
      material.friction,
      "physics collider material friction",
    ),
    finiteNumber(material.surfaceVelocityX, "physics collider material surfaceVelocityX"),
    finiteNumber(material.surfaceVelocityY, "physics collider material surfaceVelocityY"),
    positiveNumber(material.density, "physics collider material density"),
    nonNegativeNumber(
      material.contactBaumgarteBiasScale,
      "physics collider material contactBaumgarteBiasScale",
    ),
    nonNegativeNumber(
      material.maxContactBaumgarteBiasVelocityScale,
      "physics collider material maxContactBaumgarteBiasVelocityScale",
    ),
    nonNegativeNumber(
      material.contactPositionCorrectionScale,
      "physics collider material contactPositionCorrectionScale",
    ),
    nonNegativeNumber(
      material.contactPositionCorrectionSlopScale,
      "physics collider material contactPositionCorrectionSlopScale",
    ),
  );
}

function readRigidBodyStepStats(rustEngine: Engine): PhysicsRigidBodyStepStats {
  return {
    substeps: rustEngine.rigid_body_step_substeps(),
    dynamicBodies: rustEngine.rigid_body_step_dynamic_bodies(),
    angularBodies: rustEngine.rigid_body_step_angular_bodies(),
    islandCount: rustEngine.rigid_body_step_island_count(),
    islandBodies: rustEngine.rigid_body_step_island_bodies(),
    activeIslands: rustEngine.rigid_body_step_active_islands(),
    sleepingIslands: rustEngine.rigid_body_step_sleeping_islands(),
    largestIslandBodies: rustEngine.rigid_body_step_largest_island_bodies(),
    contactChecks: rustEngine.rigid_body_step_contact_checks(),
    velocityImpulses: rustEngine.rigid_body_step_velocity_impulses(),
    contactBlockSolves: rustEngine.rigid_body_step_contact_block_solves(),
    baumgarteVelocityBiases: rustEngine.rigid_body_step_baumgarte_velocity_biases(),
    splitVelocityImpulses: rustEngine.rigid_body_step_split_velocity_impulses(),
    restitutionVelocityThresholdSkips:
      rustEngine.rigid_body_step_restitution_velocity_threshold_skips(),
    warmStartImpulses: rustEngine.rigid_body_step_warm_start_impulses(),
    contactCacheEntries: rustEngine.rigid_body_step_contact_cache_entries(),
    sleepingBodies: rustEngine.rigid_body_step_sleeping_bodies(),
    bodiesPutToSleep: rustEngine.rigid_body_step_bodies_put_to_sleep(),
    bodiesWoken: rustEngine.rigid_body_step_bodies_woken(),
    islandsWoken: rustEngine.rigid_body_step_islands_woken(),
    islandsPutToSleep: rustEngine.rigid_body_step_islands_put_to_sleep(),
    ccdChecks: rustEngine.rigid_body_step_ccd_checks(),
    ccdHits: rustEngine.rigid_body_step_ccd_hits(),
    positionCorrections: rustEngine.rigid_body_step_position_corrections(),
    splitPositionCorrections: rustEngine.rigid_body_step_split_position_corrections(),
    constraintVelocityCorrections: rustEngine.rigid_body_step_constraint_velocity_corrections(),
    constraintPositionCorrections: rustEngine.rigid_body_step_constraint_position_corrections(),
    brokenJoints: rustEngine.rigid_body_step_broken_joints(),
  };
}

function runFrame(context: FramePipelineContext, deltaSeconds: number): void {
  const input = pushInput(context.rustEngine, context.inputProvider);
  pushViewport(context.rustEngine, context.viewportProvider);
  const rustUpdateTimeMs = updateRust(context.rustEngine, deltaSeconds);
  const audioEvents = drainAudioEvents(context.bridge, context.rustEngine, context.assetHost, context.options.includeAudioEvents ?? true);
  const renderCommandBuffer = context.bridge.readRenderCommandBuffer();
  const collisionEventBuffer = context.bridge.readCollisionEventBuffer();
  const physicsDebugLineBuffer = context.bridge.readPhysicsDebugLineBuffer();
  context.onFrame?.(buildFrameState(
    context.bridge,
    context.rustEngine,
    deltaSeconds,
    rustUpdateTimeMs,
    input,
    audioEvents,
    renderCommandBuffer,
    collisionEventBuffer,
    physicsDebugLineBuffer,
    context.physicsSpec,
    context.options,
  ));
}

function pushInput(rustEngine: Engine, inputProvider?: InputProvider): InputSnapshot | undefined {
  const input = inputProvider?.();
  if (!input) {
    return undefined;
  }
  rustEngine.set_input(
    input.w,
    input.a,
    input.s,
    input.d,
    input.space,
    input.enter,
    input.mouseLeft,
    input.mouseX,
    input.mouseY,
  );
  return input;
}

function pushViewport(rustEngine: Engine, viewportProvider?: ViewportProvider): void {
  const viewport = viewportProvider?.();
  if (viewport) {
    rustEngine.set_viewport_size(viewport.width, viewport.height);
  }
}

function updateRust(rustEngine: Engine, deltaSeconds: number): number {
  const updateStartMs = performance.now();
  rustEngine.update(deltaSeconds);
  return performance.now() - updateStartMs;
}

function drainAudioEvents(
  bridge: WasmBridge,
  rustEngine: Engine,
  assetHost: AssetHost | undefined,
  includeAudioEvents: boolean,
): AudioDrainResult {
  const audioEventBuffer = bridge.readAudioEventBuffer();
  let decodedAudioEvents: readonly AudioEventView[] | undefined;
  const decodeAudioEvents = (): readonly AudioEventView[] => {
    decodedAudioEvents ??= bridge.decodeAudioEvents(audioEventBuffer);
    return decodedAudioEvents;
  };

  try {
    if (audioEventBuffer.eventCount > 0) {
      if (assetHost?.playAudioEventBuffer) {
        assetHost.playAudioEventBuffer(audioEventBuffer);
      } else {
        assetHost?.playAudioEvents?.(decodeAudioEvents());
      }
    }
  } finally {
    rustEngine.clear_audio_events();
  }
  return {
    audioEventCount: audioEventBuffer.eventCount,
    audioEvents: includeAudioEvents ? decodeAudioEvents() : EMPTY_AUDIO_EVENTS,
  };
}

function buildFrameState(
  bridge: WasmBridge,
  rustEngine: Engine,
  deltaSeconds: number,
  rustUpdateTimeMs: number,
  input: InputSnapshot | undefined,
  audioEvents: AudioDrainResult,
  renderCommandBuffer: RenderCommandBufferView,
  collisionEventBuffer: CollisionEventBufferView,
  physicsDebugLineBuffer: PhysicsDebugLineBufferView,
  physicsSpec: ResolvedPhysicsSpec,
  options: CreateEngineOptions,
): FrameState {
  const physics = buildPhysicsFrameStats(rustEngine, physicsSpec);
  return {
    timeSeconds: rustEngine.time(),
    frameTimeMs: deltaSeconds * 1000,
    rustUpdateTimeMs,
    score: rustEngine.score(),
    entityCount: rustEngine.entity_count(),
    gameState: rustEngine.game_state(),
    spriteCount: rustEngine.sprite_count(),
    mouseX: input?.mouseX ?? 0,
    mouseY: input?.mouseY ?? 0,
    cameraX: rustEngine.camera_x(),
    cameraY: rustEngine.camera_y(),
    audioEventCount: audioEvents.audioEventCount,
    audioEvents: audioEvents.audioEvents,
    physics,
    collisionEventBuffer,
    collisionEvents: options.includeCollisionEvents
      ? bridge.decodeCollisionEvents(collisionEventBuffer)
      : EMPTY_COLLISION_EVENTS,
    physicsDebugLineBuffer,
    physicsDebugLines: options.includePhysicsDebugLines
      ? bridge.decodePhysicsDebugLines(physicsDebugLineBuffer)
      : EMPTY_PHYSICS_DEBUG_LINES,
    renderCommandBuffer,
    renderCommands: options.includeDeprecatedRenderCommands ? bridge.readRenderCommands() : EMPTY_RENDER_COMMANDS,
  };
}

function buildPhysicsFrameStats(
  rustEngine: Engine,
  physicsSpec: ResolvedPhysicsSpec,
): PhysicsFrameStats {
  const collisionEnterEvents = rustEngine.collision_enter_count();
  const collisionStayEvents = rustEngine.collision_stay_count();
  const collisionExitEvents = rustEngine.collision_exit_count();
  const collisionHitEvents = rustEngine.collision_hit_count();
  const collisionTriggerEnterEvents = rustEngine.collision_trigger_enter_count();
  const collisionTriggerStayEvents = rustEngine.collision_trigger_stay_count();
  const collisionTriggerExitEvents = rustEngine.collision_trigger_exit_count();
  return {
    mode: physicsSpec.mode,
    gravityX: physicsSpec.gravityX,
    gravityY: physicsSpec.gravityY,
    continuous: physicsSpec.continuous,
    fixedTimestepEnabled: rustEngine.fixed_timestep_enabled(),
    fixedStepSeconds: physicsSpec.solver.stepSeconds,
    fixedSteps: rustEngine.physics_fixed_steps(),
    fixedAlpha: rustEngine.fixed_timestep_alpha(),
    fixedConsumedSeconds: rustEngine.fixed_timestep_consumed_seconds(),
    fixedDroppedSeconds: rustEngine.fixed_timestep_dropped_seconds(),
    kinematicMoves: rustEngine.physics_kinematic_moves(),
    kinematicHits: rustEngine.physics_kinematic_hits(),
    kinematicEntityHits: rustEngine.physics_kinematic_entity_hits(),
    kinematicTileHits: rustEngine.physics_kinematic_tile_hits(),
    solidCandidateChecks: rustEngine.physics_solid_candidate_checks(),
    tileCandidateChecks: rustEngine.physics_tile_candidate_checks(),
    collisionPairs: rustEngine.physics_collision_pairs(),
    collisionSolidPairs: rustEngine.physics_collision_solid_pairs(),
    collisionTriggerPairs: rustEngine.physics_collision_trigger_pairs(),
    collisionEnterEvents,
    collisionStayEvents,
    collisionExitEvents,
    collisionHitEvents,
    collisionTriggerEnterEvents,
    collisionTriggerStayEvents,
    collisionTriggerExitEvents,
    collisionEventCount:
      collisionEnterEvents +
      collisionStayEvents +
      collisionExitEvents +
      collisionHitEvents +
      collisionTriggerEnterEvents +
      collisionTriggerStayEvents +
      collisionTriggerExitEvents,
    ccdChecks: rustEngine.rigid_body_step_ccd_checks(),
    ccdHits: rustEngine.rigid_body_step_ccd_hits(),
    sleepingBodies: rustEngine.rigid_body_step_sleeping_bodies(),
    brokenJoints: rustEngine.rigid_body_step_broken_joints(),
  };
}

function applyPhysicsDebugLineOptions(
  rustEngine: Engine,
  options: CreateEngineOptions,
  physicsSpec?: ResolvedPhysicsSpec,
): void {
  const flags = physicsDebugFlags(
    options.physicsDebugOptions ?? options.enablePhysicsDebugLines,
    physicsSpec?.debug,
    options.includePhysicsDebugLines === true,
  );
  rustEngine.set_physics_debug_line_flags(flags);
  rustEngine.set_physics_debug_lines_enabled(flags !== 0);
}

function physicsDebugFlags(
  options?: boolean | PhysicsDebugOptions,
  spec?: PhysicsDebugSpec,
  includePhysicsDebugLines = false,
): number {
  if (typeof options === "object") {
    return physicsDebugCategoryFlags(options);
  }
  if (options === true || includePhysicsDebugLines) {
    return PHYSICS_DEBUG_DEFAULT;
  }
  if (spec !== undefined) {
    return physicsDebugCategoryFlags(spec);
  }
  return 0;
}

function physicsDebugCategoryFlags(options: PhysicsDebugOptions): number {
  let flags = 0;
  if (options.broadphase === true) flags |= PHYSICS_DEBUG_BROADPHASE;
  if (options.contacts === true || options.manifolds === true) flags |= PHYSICS_DEBUG_CONTACTS;
  if (options.colliders === true || options.layers === true) {
    flags |= PHYSICS_DEBUG_COLLIDERS;
  }
  if (options.joints === true) flags |= PHYSICS_DEBUG_JOINTS;
  if (options.sleeping === true) flags |= PHYSICS_DEBUG_SLEEPING | PHYSICS_DEBUG_COLLIDERS;
  if (options.ccd === true) flags |= PHYSICS_DEBUG_CCD;
  return flags;
}

function applyPhysicsRuntimeOptions(
  rustEngine: Engine,
  physicsSpec: ResolvedPhysicsSpec,
  options: CreateEngineOptions,
  hasPhysicsConfig: boolean,
): void {
  if (options.fixedTimestep !== undefined) {
    applyFixedTimestepOptions(rustEngine, options.fixedTimestep);
  } else if (hasPhysicsConfig) {
    applyFixedTimestepOptions(rustEngine, {
      enabled: physicsSpec.solver.fixedTimestep,
      stepSeconds: physicsSpec.solver.stepSeconds,
    });
  }
  applyPhysicsDebugLineOptions(rustEngine, options, physicsSpec);
}

function applyFixedTimestepOptions(
  rustEngine: Engine,
  fixedTimestep: boolean | FixedTimestepOptions | undefined,
): void {
  if (fixedTimestep === undefined) {
    return;
  }
  if (typeof fixedTimestep === "boolean") {
    rustEngine.configure_fixed_timestep(fixedTimestep, 1 / 60, 0.25, 8);
    return;
  }
  rustEngine.configure_fixed_timestep(
    fixedTimestep.enabled ?? true,
    fixedTimestep.stepSeconds ?? 1 / 60,
    fixedTimestep.maxFrameSeconds ?? 0.25,
    fixedTimestep.maxStepsPerUpdate ?? 8,
  );
}
