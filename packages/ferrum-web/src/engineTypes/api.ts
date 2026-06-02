import type { AssetLoadProgressCallback, AssetManifest, LoadedAssets } from "../assetLoader";
import type { BuiltInShooterStateSnapshot } from "../builtInShooterStateSnapshot.js";
import type {
  BehaviorRecipeApplyResult,
  BehaviorRecipeCommand,
  BehaviorRecipeDocumentSpec,
  ResolvedBehaviorRecipeDocument,
} from "../behaviorRecipes.js";
import type {
  ApplyBehaviorStateMachineStateCommandsOptions,
  BehaviorStateMachineDocumentSpec,
  BehaviorStateMachineRuntimeInstallOptions,
  BehaviorStateMachineRuntimeInstallPlan,
  BehaviorStateMachineRuntimeInstallResult,
  BehaviorStateMachineStateCommandApplyResult,
  BehaviorStateMachineStateCommandOptions,
  BehaviorStateMachineStateCommandPlan,
  BehaviorStateMachineStateCommandPreflightResult,
  ResolvedBehaviorStateMachineDocument,
} from "../behaviorStateMachine.js";
import type { ResolvedShooterGameSpec, ShooterGameSpec } from "../gameSpec";
import type {
  ApplyGameplayBehaviorCommandsOptions,
  GameplayEntityHandle,
  GameplayEntityHandleMap,
} from "../gameplayAuthoring.js";
import type { InputSnapshot } from "../inputManager";
import type { ParticlePresetConfig } from "../particlePreset";
import type { PhysicsMode, ResolvedPhysicsSpec } from "../physicsSpec.js";
import type { PhysicsBodyStateBufferSnapshot } from "../physicsBodyStateBuffer.js";
import type {
  PhysicsBodyContactHit,
  PhysicsBodyManifoldHit,
  PhysicsBodyQueryHit,
  PhysicsRaycastBodyHit,
  PhysicsRigidContactImpulseHit,
  PhysicsShapeCastBodyHit,
  PhysicsTileContactHit,
  PhysicsTileManifoldHit,
  PhysicsTileRaycastHit,
  PhysicsTileShapeCastHit,
} from "../wasmBridge";
import type {
  AssetHost,
  FixedTimestepOptions,
  PhysicsDebugOptions,
  PhysicsRigidBodyStepOptions,
  PhysicsRigidBodyStepStats,
  ShooterSoundIds,
  ShooterTextureIds,
} from "./frame.js";
import type {
  PhysicsBodyColliderOptions,
  PhysicsBodyColliderSnapshot,
  PhysicsBodyHeightSpan,
  PhysicsHd2dKinematicMoveOptions,
  PhysicsHd2dKinematicMoveResult,
  PhysicsEntityHandle,
  PhysicsEntitySnapshot,
  PhysicsRigidBodyMassProperties,
  PhysicsRigidBodyMaterial,
  PhysicsRigidBodySpawnOptions,
  PhysicsRigidBodyTuning,
} from "./physicsBodies.js";
import type { PhysicsJointHandle, PhysicsJointSnapshot, PhysicsJointSpawnOptions } from "./physicsJoints.js";
import type {
  PhysicsAabbBodyQuery,
  PhysicsAabbBodyShapeCastQuery,
  PhysicsAabbTileObstacleContactQuery,
  PhysicsAabbTileObstacleManifoldQuery,
  PhysicsAabbTileObstacleShapeCastQuery,
  PhysicsBodyContactQuery,
  PhysicsBodyManifoldQuery,
  PhysicsCapsuleBodyQuery,
  PhysicsCapsuleBodyShapeCastQuery,
  PhysicsCircleBodyQuery,
  PhysicsCircleBodyShapeCastQuery,
  PhysicsConvexPolygonBodyQuery,
  PhysicsConvexPolygonBodyShapeCastQuery,
  PhysicsNearestBodyHit,
  PhysicsNearestBodyQuery,
  PhysicsNearestTileObstacleHit,
  PhysicsNearestTileObstacleQuery,
  PhysicsOrientedBoxBodyQuery,
  PhysicsOrientedBoxBodyShapeCastQuery,
  PhysicsPointBodyQuery,
  PhysicsRaycastBodyQuery,
  PhysicsRaycastTileObstacleQuery,
  PhysicsSegmentCastBodyQuery,
  PhysicsSegmentCastTileObstacleQuery,
  PhysicsShapeCastMotionQuery,
  PhysicsTileShapeCastMotionQuery,
  ShooterTileBridgePortalMetadata,
  ShooterTileHd2dMetadata,
  TilemapNavigationPath,
  TilemapNavigationPathQuery,
  TilemapNavigationWaypoint,
  TilemapNavigationWaypointQuery,
  TilemapRectEditOptions,
} from "./physicsQueries.js";

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
  /** Rust collision lifecycle tracking과 FrameState decoded collision event 배열을 켤지 여부입니다. 기본값은 false입니다. */
  includeCollisionEvents?: boolean;
  /** FrameState에 gameplay event buffer와 decoded object 배열을 포함할지 여부입니다. 기본값은 true입니다. */
  includeGameplayEvents?: boolean;
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
  builtInShooterPlayerHandle(): GameplayEntityHandle | undefined;
  captureShooterStateSnapshot(): BuiltInShooterStateSnapshot | undefined;
  restoreShooterStateSnapshot(snapshot: BuiltInShooterStateSnapshot): boolean;
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
    options?: TilemapRectEditOptions,
  ): boolean;
  setShooterTileHeightSpan(tileId: number, heightSpan: PhysicsBodyHeightSpan): boolean;
  clearShooterTileHeightSpan(tileId: number): boolean;
  setShooterTileHd2dMetadata(tileId: number, metadata: ShooterTileHd2dMetadata): boolean;
  clearShooterTileHd2dMetadata(tileId: number): boolean;
  setShooterTileBridgePortal(tileId: number, portal: ShooterTileBridgePortalMetadata): boolean;
  clearShooterTileBridgePortal(tileId: number): boolean;
  setShooterTilemapNavigationCost(layerIndex: number, column: number, row: number, cost: number): boolean;
  queryTilemapNavigationWaypoint(query: TilemapNavigationWaypointQuery): TilemapNavigationWaypoint | undefined;
  queryTilemapNavigationPath(query: TilemapNavigationPathQuery): TilemapNavigationPath | undefined;
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
  configurePhysicsRuntime(spec: ResolvedPhysicsSpec): ResolvedPhysicsSpec;
  configureFixedTimestep(options: boolean | FixedTimestepOptions): void;
  configureAutoRigidBodyStep(options: boolean | PhysicsRigidBodyStepOptions): void;
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
  setPhysicsBodyHeightSpan(handle: PhysicsEntityHandle, span: PhysicsBodyHeightSpan): boolean;
  clearPhysicsBodyHeightSpan(handle: PhysicsEntityHandle): boolean;
  getPhysicsBodyHeightSpan(handle: PhysicsEntityHandle): PhysicsBodyHeightSpan | undefined;
  moveHd2dKinematicBodyWithTilemap(
    handle: PhysicsEntityHandle,
    options: PhysicsHd2dKinematicMoveOptions,
  ): PhysicsHd2dKinematicMoveResult | undefined;
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

export interface FerrumGameplayAuthoringApi {
  gameplayEntityExists(entity: GameplayEntityHandle): boolean;
  applyGameplayBehaviorCommands(
    commands: readonly BehaviorRecipeCommand[],
    entityHandles: GameplayEntityHandleMap,
    options?: ApplyGameplayBehaviorCommandsOptions,
  ): BehaviorRecipeApplyResult;
  installBehaviorStateMachineRuntime(
    document: BehaviorStateMachineDocumentSpec | ResolvedBehaviorStateMachineDocument,
    machineId: string,
    entity: GameplayEntityHandle,
    options?: BehaviorStateMachineRuntimeInstallOptions,
  ): BehaviorStateMachineRuntimeInstallResult;
  gameplayBehaviorState(entity: GameplayEntityHandle): number;
  createBehaviorStateMachineCurrentStateCommandPlan(
    document: BehaviorStateMachineDocumentSpec | ResolvedBehaviorStateMachineDocument,
    recipes: BehaviorRecipeDocumentSpec | ResolvedBehaviorRecipeDocument,
    installPlan: BehaviorStateMachineRuntimeInstallPlan,
    entity: GameplayEntityHandle,
    options?: BehaviorStateMachineStateCommandOptions,
  ): BehaviorStateMachineStateCommandPlan;
  applyBehaviorStateMachineStateCommands(
    plan: BehaviorStateMachineStateCommandPlan,
    entity: GameplayEntityHandle,
    options?: ApplyBehaviorStateMachineStateCommandsOptions,
  ): BehaviorStateMachineStateCommandApplyResult;
  preflightBehaviorStateMachineStateCommands(
    plan: BehaviorStateMachineStateCommandPlan,
    entity: GameplayEntityHandle,
    options?: ApplyBehaviorStateMachineStateCommandsOptions,
  ): BehaviorStateMachineStateCommandPreflightResult;
}

export type InputActionRuntimeControl = "space" | "enter" | "mouseLeft";
export type InputActionActivation = "down" | "pressed";

export interface InputActionRuntimeBinding {
  control: InputActionRuntimeControl;
  activation: InputActionActivation;
}

export interface FerrumInputActionApi {
  setInputActionBinding(actionId: number, bindingIndex: number, binding: InputActionRuntimeBinding): boolean;
  clearInputActionBindings(actionId: number): boolean;
  resetInputActionBindings(): void;
}

export interface FerrumEngine
  extends FerrumLifecycleApi,
    FerrumSceneApi,
    FerrumAssetApi,
    FerrumParticleApi,
    FerrumPhysicsApi,
    FerrumGameplayAuthoringApi,
    FerrumInputActionApi {}

export interface ViewportSnapshot {
  width: number;
  height: number;
}

export type InputProvider = () => InputSnapshot;
export type ViewportProvider = () => ViewportSnapshot;
