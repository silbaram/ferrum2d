import type { AssetLoadProgressCallback, AssetManifest, LoadedAssets } from "../assetLoader";
import type { PostProcessStackInput } from "../cameraPostProcessing";
import type { PhysicsDebugSpec, PhysicsMode } from "../physicsSpec.js";
import type {
  AudioEventBufferView,
  AudioEventView,
  CollisionEventBufferView,
  CollisionEventView,
  EffectEventBufferView,
  EffectEventView,
  GameplayEventBufferView,
  GameplayEventView,
  PhysicsDebugLineBufferView,
  PhysicsDebugLineView,
  RenderCommandBufferView,
  RenderCommandView,
} from "../wasmBridge";

export interface AssetHost {
  loadAssets(manifest: AssetManifest, onProgress?: AssetLoadProgressCallback): Promise<LoadedAssets>;
  textureId(name: string): number;
  soundId?(name: string): number;
  hasSound?(soundId: number): boolean;
  playAudioEventBuffer?(events: AudioEventBufferView): void;
  playAudioEvents?(events: readonly AudioEventView[]): void;
  configureAudio?(config: AudioBusConfig): void;
  setPostProcess?(postProcess: PostProcessStackInput): void;
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
  /** Rust-side culling 이후 현재 frame에서 보이는 sprite render command 수입니다. */
  spriteCount: number;
  mouseX: number;
  mouseY: number;
  cameraX: number;
  cameraY: number;
  playerFloorId?: number;
  playerElevation?: number;
  playerHeight?: number;
  actionDiagnostics: ActionFrameDiagnostics;
  spawnDiagnostics: SpawnFrameDiagnostics;
  audioEventCount: number;
  audioEvents: readonly AudioEventView[];
  physics: PhysicsFrameStats;
  /** Wasm memory view입니다. frame 안에서 동기 소비하거나 보관 전 복사하세요. */
  collisionEventBuffer: CollisionEventBufferView;
  collisionEvents: readonly CollisionEventView[];
  /** Wasm memory view입니다. frame 안에서 동기 소비하거나 보관 전 복사하세요. */
  gameplayEventBuffer: GameplayEventBufferView;
  gameplayEvents: readonly GameplayEventView[];
  /** Wasm memory view입니다. frame 안에서 동기 소비하거나 보관 전 복사하세요. */
  effectEventBuffer: EffectEventBufferView;
  effectEvents: readonly EffectEventView[];
  /** Wasm memory view입니다. frame 안에서 동기 소비하거나 보관 전 복사하세요. */
  physicsDebugLineBuffer: PhysicsDebugLineBufferView;
  physicsDebugLines: readonly PhysicsDebugLineView[];
  /** @deprecated 호환성 유지용. hot path에서는 renderCommandBuffer를 사용하세요. */
  renderCommands: RenderCommandView[];
  /** Wasm memory view입니다. frame 안에서 동기 소비하거나 보관 전 복사하세요. */
  renderCommandBuffer: RenderCommandBufferView;
}

export type FrameHandler = (state: FrameState) => void;

export interface ActionFrameDiagnostics {
  triggerAttempts: number;
  triggerFailures: number;
  triggerFailureEventsPushed: number;
  triggerCommitSkips: number;
  lastPreparedTriggerFailureReasonCode?: number;
  failureReasonCounts: readonly number[];
}

export interface SpawnFrameDiagnostics {
  commandsDrained: number;
  projectileSpawns: number;
  projectileArcsApplied: number;
  projectileShootAudioEventsPushed: number;
  prefabSpawns: number;
  prefabSpawnedPayloads: number;
  prefabSpawnedEventsPushed: number;
}

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
  hd2dFilteredEntityCandidates: number;
  hd2dFilteredTileCandidates: number;
  collisionLifecycleEventsEnabled?: boolean;
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
