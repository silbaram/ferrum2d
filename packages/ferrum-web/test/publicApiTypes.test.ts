import { equal } from "node:assert/strict";
import { test } from "node:test";
import {
  importAsepriteAtlas,
  importAsepriteAtlasFrames,
  importLDtkGameSpec,
  importLDtkTilemap,
  importTiledGameSpec,
  importTiledTilemap,
} from "../src/assetPipeline.js";
import {
  AnimationTimelinePlayer,
  animationTimelineFrameAt,
  resolveAnimationTimelineSpec,
} from "../src/animationTimeline.js";
import {
  applySceneCompositionFragment,
  instantiateSceneFragment,
  resolveSceneCompositionSpec,
} from "../src/sceneComposition.js";
import {
  applyBehaviorRecipes,
  behaviorRecipeCommandsForEntity,
  resolveBehaviorRecipeDocument,
} from "../src/behaviorRecipes.js";
import {
  assetManifestFingerprint,
  createAssetPreloadCachePolicy,
  invalidatePreloadedAssetCache,
  preloadAssetManifest,
  resolveAssetPreloadPlan,
} from "../src/assetPreload.js";
import { IndexedDbAssetCache } from "../src/indexedDbAssetCache.js";
import { decodeCollisionEvents } from "../src/collisionEventDecoder.js";
import { decodePhysicsDebugLines } from "../src/physicsDebugLineDecoder.js";
import {
  buildDebugGizmoLineBuffer,
  buildDebugGizmoLines,
  debugGizmoLinesToBuffer,
} from "../src/debugGizmos.js";
import {
  decodePhysicsBodyContactHits,
  decodePhysicsBodyManifoldHits,
  decodePhysicsQueryHits,
  decodePhysicsRaycastHits,
  decodePhysicsRigidContactImpulseHits,
  decodePhysicsShapeCastHits,
  decodePhysicsTileContactHits,
  decodePhysicsTileManifoldHits,
  decodePhysicsTileRaycastHits,
  decodePhysicsTileShapeCastHits,
} from "../src/physicsQueryDecoder.js";
import { resolvePhysicsSpec } from "../src/physicsSpec.js";
import {
  createCollider,
  createPhysicsLayerMap,
  createPhysicsLayerSpec,
  createPhysicsWorldFromSpec,
  createRigidBody,
  physicsMaterial,
} from "../src/physicsAuthoring.js";
import { applyPhysicsSceneProfile } from "../src/physicsSceneIntegration.js";
import {
  createPixelMaskTerrain,
  extractPixelMaskBoundaryChains,
} from "../src/pixelMaskTerrain.js";
import {
  applyTileRules,
  bakeAnimatedTileLayer,
  resolveAnimatedTileFrame,
} from "../src/tilemapAuthoring.js";
import {
  BREAKOUT_INPUT_ACTION_PROFILE,
  DEFAULT_INPUT_ACTION_PROFILE,
  INPUT_ACTION_PROFILES,
  PLATFORMER_INPUT_ACTION_PROFILE,
  resolveInputActionState,
  TOPDOWN_SHOOTER_INPUT_ACTION_PROFILE,
} from "../src/inputProfile.js";
import {
  applyVirtualControlStateToSnapshot,
  DEFAULT_VIRTUAL_CONTROL_BUTTONS,
  VirtualControls,
} from "../src/virtualControls.js";
import {
  resolveSpriteMaterialPreset,
  SPRITE_MATERIAL_PRESETS,
  spriteMaterialPasses,
} from "../src/spriteMaterial.js";
import {
  PARTICLE_VFX_PRESETS,
  ParticleVfxEmitter,
  particleVfxPreset,
  resolveParticleVfxPresetConfig,
} from "../src/particleVfx.js";
import {
  deriveTileOccludersFromTilemapGrid,
  normalizeLightingScene,
} from "../src/lighting.js";
import {
  captureGameStateSnapshot,
  GAME_STATE_SNAPSHOT_FORMAT,
  GAME_STATE_SNAPSHOT_VERSION,
  loadGameStateSnapshotFromStorage,
  parseGameStateSnapshot,
  restoreGameStateSnapshot,
  saveGameStateSnapshotToStorage,
  stringifyGameStateSnapshot,
} from "../src/gameStateSnapshot.js";
import { createPixelMaskTerrainRuntime } from "../src/pixelMaskTerrainRuntime.js";
import { createPhysicsReplayInputStream } from "../src/physicsSnapshot.js";
import {
  PHYSICS_REPLAY_WORKER_REQUEST_FORMAT,
  createPhysicsReplayWorkerClient,
} from "../src/physicsReplayWorker.js";
import {
  PHYSICS_BODY_STATE_BUFFER_FORMAT,
  PHYSICS_BODY_STATE_FLOATS_PER_BODY,
  PHYSICS_BODY_STATE_U32S_PER_BODY,
  createPhysicsBodyStateBufferSnapshot,
} from "../src/physicsBodyStateBuffer.js";
import {
  evaluateRuntimeProfilerBudget,
  RuntimeProfiler,
  runtimeDiagnosticsFrameSample,
} from "../src/runtimeProfiler.js";
import { LoadingOverlay } from "../src/loadingOverlay.js";
import {
  HUD_THEME_PRESETS,
  createHudOverlayState,
  resolveHudTheme,
} from "../src/hudToolkit.js";
import {
  ACCESSIBILITY_CONTRAST_PALETTES,
  accessibilitySubtitlePanel,
  applyAccessibilityToCameraRigSpec,
  applyAccessibilityToScreenFadeSpec,
  readAccessibilityEnvironment,
  resolveAccessibilityContrastPalette,
  resolveAccessibilityHudTheme,
  resolveAccessibilityOptions,
} from "../src/accessibilityOptions.js";
import {
  CameraRigController,
  ScreenFadeTransition,
  clampCameraToBounds,
  fadePostProcessPass,
  resolveCameraRigSpec,
  resolvePostProcessPasses,
} from "../src/cameraPostProcessing.js";
import {
  CutsceneSequencePlayer,
  applyCutsceneSequenceEvent,
  resolveCutsceneSequenceSpec,
} from "../src/cutsceneSequence.js";
import {
  LocalizationBundle,
  layoutLocalizedText,
  loadFontLoadingPolicy,
  localizationLocaleChain,
  resolveFontLoadingPolicy,
  resolveLocalizationDocument,
} from "../src/localization.js";
import {
  LevelChunkStreamer,
  resolveLevelChunkManifest,
  resolveLevelStreamingPlan,
} from "../src/levelStreaming.js";
import {
  DialogueSession,
  QuestLog,
  captureDialogueQuestState,
  dialogueNodeToUiOverlayState,
  resolveDialogueGraph,
  resolveQuestDocument,
  restoreDialogueQuestState,
} from "../src/dialogueQuest.js";
import {
  TEXTURE_ATLAS_PACK_FORMAT,
  packTextureAtlas,
  textureAtlasDocumentToShooterAtlas,
} from "../src/textureAtlas.js";
import {
  SCREENSHOT_CAPTURE_SUMMARY_FORMAT,
  SCREENSHOT_CAPTURE_SUMMARY_VERSION,
  assertScreenshotCaptureSummary,
  compareScreenshotSummaries,
  resolveScreenshotCaptureSpec,
  summarizeScreenshotPixels,
} from "../src/screenshotCapture.js";
import type {
  AsepriteAtlasImportOptions,
  AsepriteAtlasImportResult,
  AnimatedTileFrameSpec,
  AnimatedTileLayerOptions,
  AnimatedTileSpec,
  ApplyTileRulesOptions,
  AssetPreloadCache,
  AssetPreloadCachePolicy,
  AssetPreloadEntry,
  AssetPreloadInvalidationResult,
  AssetPreloadPlan,
  AssetManifest,
  AnimationTimelineEmittedEvent,
  AnimationTimelineEventPayload,
  AnimationTimelineEventSpec,
  AnimationTimelineFrameRef,
  AnimationTimelinePlayerSnapshot,
  AnimationTimelineSpec,
  AnimationTimelineStateSpec,
  AnimationTimelineTransitionSpec,
  AnimationTimelineUpdateOptions,
  AnimationTimelineUpdateResult,
  ApplyBehaviorRecipesOptions,
  ApplySceneCompositionOptions,
  AudioAssetLoader,
  AudioBus,
  AudioBusConfig,
  AudioManagerConfig,
  AudioManagerState,
  PlayBgmOptions,
  StopBgmOptions,
  SpatialAudioOptions,
  AtlasSpriteInput,
  AtlasSpritePlacement,
  PackedTextureAtlasDocument,
  PackedTextureAtlasFrame,
  ResolvedScreenshotCaptureSpec,
  ScreenshotCaptureSpec,
  ScreenshotColorSummary,
  ScreenshotComparisonReport,
  ScreenshotComparisonThreshold,
  ScreenshotPixelSummary,
  TextureAtlasLayout,
  TextureAtlasOptions,
  TextureAtlasPackInput,
  TextureAtlasPackOptions,
  BinaryAssetCache,
  BinaryCacheSetOptions,
  BehaviorRecipeApplyResult,
  BehaviorRecipeCommand,
  BehaviorRecipeCommandBase,
  BehaviorRecipeCommandOptions,
  BehaviorRecipeDamageTarget,
  BehaviorRecipeDocumentSpec,
  BehaviorRecipeEntrySpec,
  BehaviorRecipeEntitySpec,
  BehaviorRecipeHealthZeroAction,
  BehaviorRecipeKind,
  BehaviorRecipeReferenceSpec,
  BehaviorRecipeRuntimeTarget,
  BehaviorRecipeSpec,
  BuiltInShooterStateSnapshot,
  ChaseBehaviorRecipeSpec,
  ConfigureChaseBehaviorCommand,
  ConfigureDamageBehaviorCommand,
  ConfigureHealthBehaviorCommand,
  ConfigureInteractionBehaviorCommand,
  ConfigurePickupBehaviorCommand,
  CreatedRenderer,
  CreateRendererOptions,
  DamageBehaviorRecipeSpec,
  DiagnosticCode,
  DiagnosticContext,
  DiagnosticReport,
  AccessibilityContrastColorRole,
  AccessibilityContrastPaletteName,
  AccessibilityContrastPaletteSpec,
  AccessibilityEnvironment,
  AccessibilityInputAssistSpec,
  AccessibilityMediaQueryListLike,
  AccessibilityMediaQuerySource,
  AccessibilityOptionsSpec,
  AccessibilityReducedMotionPreference,
  AccessibilitySubtitlePanelOptions,
  AccessibilitySubtitleSpec,
  DebugGizmoBoundsSpec,
  DebugGizmoCategory,
  DebugGizmoColor,
  DebugGizmoLine,
  DebugGizmoLineBufferResult,
  DebugGizmoOptions,
  DebugGizmoPathSpec,
  DebugGizmoPoint,
  DebugGizmoSceneSpec,
  DebugGizmoSpawnSpec,
  ResolvedDebugGizmoColor,
  ResolvedAccessibilityContrastPalette,
  ResolvedAccessibilityInputAssist,
  ResolvedAccessibilityOptions,
  ResolveAccessibilityOptionsOptions,
  RendererFallbackInfo,
  PhysicsReplayWorkerRunResult,
  PhysicsReplayWorkerTransferBenchmarkResult,
  BrowserPlatformHost,
  CreateEngineOptions,
  FerrumRuntime,
  FerrumRuntimeEnvironment,
  FerrumRuntimeFrame,
  FerrumRuntimeOptions,
  FerrumRuntimeRenderer,
  LightingSceneProvider,
  SpriteMaterialProvider,
  LoadingOverlayOptions,
  LoadingOverlayState,
  LoadingOverlayStatus,
  UiOverlayStateProvider,
  EngineLifecycleHooks,
  EngineLifecycleSnapshot,
  AssetHost,
  FerrumEngine,
  FixedTimestepOptions,
  FrameHandler,
  FrameState,
  HealthBehaviorRecipeSpec,
  GameStateSceneSnapshot,
  GameStateSnapshot,
  GameStateSnapshotJsonValue,
  GameStateSnapshotRestoreResult,
  GameStateSnapshotStorage,
  InputManagerOptions,
  GamepadInputMapping,
  InputActionBinding,
  InputActionProfile,
  InputActionProfileId,
  InputActionState,
  InputAxisBinding,
  InputDigitalControl,
  InputProvider,
  VirtualButtonOptions,
  VirtualControlsOptions,
  VirtualControlsState,
  VirtualJoystickOptions,
  ResolvedSpriteMaterialColorMix,
  ResolvedSpriteMaterialOutline,
  ResolvedSpriteMaterialPreset,
  SpriteMaterialBlendMode,
  SpriteMaterialColor,
  SpriteMaterialColorMix,
  SpriteMaterialOutlineDirections,
  SpriteMaterialOutlineOptions,
  SpriteMaterialPass,
  SpriteMaterialPreset,
  SpriteMaterialPresetInput,
  SpriteMaterialPresetName,
  LightingScene2D,
  LightingShadowOptions,
  PointLight2D,
  ResolvedLightingShadowOptions,
  ResolvedLightingScene2D,
  TileOccluder2D,
  TileOccluderGridInput,
  ShadowClipRect,
  ShadowProjectionOptions,
  IndexedDbAssetCacheOptions,
  JsonAssetCache,
  JsonCacheSetOptions,
  PhysicsAabbTileObstacleContactQuery,
  PhysicsAabbTileObstacleManifoldQuery,
  PhysicsDebugLineCamera,
  PhysicsDebugOptions,
  PhysicsDebugSpec,
  PhysicsFrameStats,
  PhysicsLayerPattern,
  PhysicsLayerSpec,
  PhysicsMaterialPresetName,
  PhysicsMode,
  PhysicsSpec,
  PhysicsAabbBodyShapeCastQuery,
  PhysicsAabbBodyQuery,
  PhysicsAabbTileObstacleShapeCastQuery,
  PhysicsAuthoringLayer,
  PhysicsBodyColliderOptions,
  PhysicsBodyColliderSnapshot,
  PhysicsBodyStateBufferSnapshot,
  PhysicsBodyContactHit,
  PhysicsBodyContactHitBufferView,
  PhysicsBodyContactQuery,
  PhysicsBodyManifoldHit,
  PhysicsBodyManifoldHitBufferView,
  PhysicsBodyManifoldQuery,
  PhysicsBodyQueryHit,
  PhysicsCapsuleBodyShapeCastQuery,
  PhysicsCapsuleBodyQuery,
  PhysicsCircleBodyShapeCastQuery,
  PhysicsCircleBodyQuery,
  PhysicsConvexPolygonBodyShapeCastQuery,
  PhysicsConvexPolygonBodyQuery,
  PhysicsConvexPolygonVertexBuffer,
  PhysicsColliderAuthoringOptions,
  PhysicsColliderType,
  PhysicsCollisionLayer,
  PhysicsEntityHandle,
  PhysicsEntitySnapshot,
  PhysicsJointBaseOptions,
  PhysicsJointHandle,
  PhysicsJointSnapshot,
  PhysicsJointSpawnOptions,
  PhysicsJointType,
  ParticleColor,
  ParticlePresetConfig,
  ParticleRangeInput,
  ParticleTextureRef,
  ParticleUvRect,
  ParticleVfxEmitterConfig,
  ParticleVfxEmitterMode,
  ParticleVfxEmitterOptions,
  ParticleVfxEmitterSnapshot,
  ParticleVfxEmitterTarget,
  ParticleVfxPresetConfig,
  ParticleVfxPresetName,
  ResolvedParticleVfxEmitterConfig,
  ResolvedParticleVfxPresetConfig,
  PhysicsNearestBodyHit,
  PhysicsNearestBodyQuery,
  PhysicsNearestTileObstacleHit,
  PhysicsNearestTileObstacleQuery,
  PhysicsOrientedBoxBodyQuery,
  PhysicsPointBodyQuery,
  PhysicsQueryHitBufferView,
  PhysicsRaycastBodyHit,
  PhysicsRaycastBodyQuery,
  PhysicsRaycastHitBufferView,
  PhysicsRaycastTileObstacleQuery,
  PhysicsRigidContactImpulseHit,
  PhysicsRigidContactImpulseHitBufferView,
  PhysicsRigidBodyAuthoringOptions,
  PhysicsRigidBodyCollider,
  PhysicsRigidBodyMassProperties,
  PhysicsRigidBodyMaterial,
  PhysicsRigidBodySpawnOptions,
  PhysicsRigidBodyStepOptions,
  PhysicsRigidBodyStepStats,
  PhysicsRigidBodyTuning,
  PhysicsRigidBodyType,
  PhysicsMaterialSnapshot,
  PhysicsSegmentCastBodyQuery,
  PhysicsSegmentCastTileObstacleQuery,
  PhysicsShapeCastBodyHit,
  PhysicsShapeCastHitBufferView,
  PhysicsTileContactHit,
  PhysicsTileContactHitBufferView,
  PhysicsTileManifoldHit,
  PhysicsTileManifoldHitBufferView,
  PhysicsTileRaycastHit,
  PhysicsTileRaycastHitBufferView,
  PhysicsTileShapeCastHit,
  PhysicsTileShapeCastHitBufferView,
  PhysicsTileShapeCastMotionQuery,
  PhysicsOrientedBoxBodyShapeCastQuery,
  PhysicsReplayInputEvent,
  PhysicsReplayInputRunResult,
  PhysicsReplayInputStream,
  PhysicsWorldApplyResult,
  ApplyPhysicsSceneProfileOptions,
  PhysicsSceneProfileApplyResult,
  PhysicsSceneProfileId,
  PhysicsSceneProfileSpec,
  PixelMaskTerrainAlphaPatch,
  PixelMaskTerrainBoundaryOptions,
  PixelMaskTerrainDirtyRect,
  PixelMaskTerrainLayerOptions,
  PixelMaskTerrainOptions,
  PixelMaskTerrainRuntimeOptions,
  PixelMaskTerrainRuntimeSyncResult,
  PixelMaskTerrainTextureTarget,
  PixelMaskTerrainTextureUploadOptions,
  Renderer,
  RendererStats,
  RuntimeDiagnosticsBudget,
  RuntimeDiagnosticsFrameSample,
  RuntimeDiagnosticsReport,
  RuntimeDiagnosticsViolation,
  RuntimeProfilerOptions,
  RuntimeProfilerSnapshot,
  ResolvedAnimationTimelineEvent,
  ResolvedAnimationTimelineSpec,
  ResolvedAnimationTimelineState,
  ResolvedAnimationTimelineTransition,
  ResolveBehaviorRecipeDocumentOptions,
  ResolvedBehaviorRecipe,
  ResolvedBehaviorRecipeBase,
  ResolvedBehaviorRecipeDocument,
  ResolvedBehaviorRecipeEntity,
  ResolvedChaseBehaviorRecipe,
  ResolvedDamageBehaviorRecipe,
  ResolvedHealthBehaviorRecipe,
  ResolvedInteractionBehaviorRecipe,
  ResolvedPickupBehaviorRecipe,
  ResolvedSceneCompositionFragment,
  ResolvedSceneCompositionFragmentInclude,
  ResolvedSceneCompositionFragmentInstance,
  ResolvedSceneCompositionInstance,
  ResolvedSceneCompositionPrefab,
  ResolvedSceneCompositionPrefabVariant,
  ResolvedSceneCompositionSpec,
  ResolvedSceneCompositionTransform,
  ResolveSceneCompositionOptions,
  SceneCompositionApplyResult,
  SceneCompositionFragmentIncludeSpec,
  SceneCompositionFragmentInstanceSpec,
  SceneCompositionFragmentSpec,
  SceneCompositionJsonValue,
  SceneCompositionPrefabSpec,
  SceneCompositionPrefabVariantSpec,
  SceneCompositionProps,
  SceneCompositionSpec,
  SceneCompositionTarget,
  SceneCompositionTransformSpec,
  InstantiateSceneFragmentOptions,
  PickupBehaviorRecipeSpec,
  CreateAssetPreloadCachePolicyOptions,
  InvalidatePreloadedAssetCacheOptions,
  PreloadAssetManifestOptions,
  PreloadedAssetManifest,
  InteractionBehaviorRecipeSpec,
  LDtkEntityInstance,
  LDtkTilemapImportOptions,
  LDtkTilemapImportResult,
  LDtkTilesetFrameContext,
  ResolvedShooterAtlasAnimation,
  ResolvedShooterAtlasAnimationState,
  ResolvedShooterPhysicsMaterial,
  ResolvedShooterPrefabColliderBase,
  ResolvedShooterPrefabCollider,
  ResolvedShooterPrefabColliderVertex,
  ShooterPrefabColliderType,
  ShooterAtlasFrameSpec,
  ShooterAtlasSpec,
  ShooterAtlasAnimationSpec,
  ShooterAtlasAnimationStateSpec,
  ShooterCameraPreset,
  ShooterCameraSpec,
  ShooterEnemyOrbitSpec,
  ShooterEnemyPresetSpec,
  ShooterGameSpec,
  ShooterPhysicsMaterialSpec,
  ShooterPrefabColliderSpec,
  ShooterTileLayerSpec,
  ShooterTilemapSpec,
  ShooterTileSlopeSpec,
  ShooterTileSpec,
  ResolvedShooterTileDefinition,
  ResolvedShooterTileSlopeDefinition,
  ShooterWaveSpec,
  ResolvedShooterTilemap,
  ViewportProvider,
  WebGPURenderer,
  WebGPURendererOptions,
  WebGL2RendererOptions,
  CollisionEventBufferView,
  CollisionEventView,
  CameraBounds,
  CameraDeadZone,
  CameraPoint,
  CameraRigSnapshot,
  CameraRigSpec,
  CameraRigStepOptions,
  CameraViewport,
  PhysicsDebugLineBufferView,
  PhysicsDebugLineView,
  BloomPostProcessPassInput,
  CrtPostProcessPassInput,
  FadePostProcessPassInput,
  GlitchPostProcessPassInput,
  PostProcessColor,
  PostProcessPassInput,
  PostProcessPassKind,
  PostProcessingConfigInput,
  PostProcessProvider,
  PostProcessStackInput,
  VignettePostProcessPassInput,
  CutsceneAudioAction,
  CutsceneAudioBus,
  CutsceneAudioCommandSpec,
  CutsceneCameraCommandSpec,
  CutsceneCommandBaseSpec,
  CutsceneDialogueCommandSpec,
  CutsceneSequenceCommandKind,
  CutsceneSequenceCommandSpec,
  CutsceneSequenceEasing,
  CutsceneSequenceEvent,
  CutsceneSequencePlayerSnapshot,
  CutsceneSequenceSpec,
  CutsceneSequenceTarget,
  CutsceneSequenceUpdateOptions,
  CutsceneSequenceUpdateResult,
  CutsceneWaitCommandSpec,
  ResolveCutsceneSequenceOptions,
  ResolvedCutsceneAudioCommand,
  ResolvedCutsceneCameraCommand,
  ResolvedCutsceneCommandBase,
  ResolvedCutsceneDialogueCommand,
  ResolvedCutsceneSequenceCommand,
  ResolvedCutsceneSequenceSpec,
  ResolvedCutsceneWaitCommand,
  BitmapFontPolicySpec,
  FontDisplayPolicy,
  FontFaceSetLike,
  FontLoadingPolicySpec,
  LoadFontPolicyResult,
  LocalizationDocumentSpec,
  LocalizationLocaleSpec,
  LocalizationPlaceholderValue,
  LocalizationStringEntrySpec,
  LocalizationStringSpec,
  LocalizeOptions,
  LocalizedTextResult,
  MissingLocalizationBehavior,
  ResolvedBitmapFontPolicy,
  ResolvedCameraBounds,
  ResolvedCameraDeadZone,
  ResolvedCameraRigSpec,
  ResolvedBloomPostProcessPass,
  ResolvedCrtPostProcessPass,
  ResolvedFontLoadingPolicy,
  ResolvedFadePostProcessPass,
  ResolvedGlitchPostProcessPass,
  ResolvedLocalizationDocument,
  ResolvedLocalizationLocale,
  ResolvedLocalizationString,
  ResolvedPostProcessColor,
  ResolvedPostProcessPass,
  ResolvedVignettePostProcessPass,
  ResolvedWebFontPolicy,
  ResolveCameraRigOptions,
  ResolveLocalizationOptions,
  ResolvePostProcessOptions,
  TextDirection,
  TextLayoutLine,
  TextLayoutOptions,
  TextLayoutResult,
  WebFontPolicySpec,
  LevelChunkBounds,
  LevelChunkManifestSpec,
  LevelChunkSpec,
  LevelChunkStreamerSnapshot,
  LevelStreamingAssetLifetimePolicy,
  LevelStreamingOrigin,
  LevelStreamingPlan,
  LevelStreamingPlanOptions,
  LevelStreamingViewport,
  LevelTilemapChunkSpec,
  ResolveLevelChunkManifestOptions,
  ResolvedLevelChunk,
  ResolvedLevelChunkManifest,
  ResolvedLevelTilemapChunk,
  DialogueChoiceResult,
  DialogueChoiceSpec,
  DialogueGraphSpec,
  DialogueNodeSpec,
  DialogueQuestStateSnapshot,
  DialogueSessionSnapshot,
  DialogueUiOptions,
  QuestDocumentSpec,
  QuestLogSnapshot,
  QuestObjectiveSpec,
  QuestProgressSnapshot,
  QuestSpec,
  QuestStageSpec,
  QuestStatus,
  QuestUpdateAction,
  QuestUpdateSpec,
  ResolvedDialogueChoice,
  ResolvedDialogueGraph,
  ResolvedDialogueNode,
  ResolvedQuest,
  ResolvedQuestDocument,
  ResolvedQuestObjective,
  ResolvedQuestStage,
  ResolvedQuestUpdate,
  ResolveDialogueQuestOptions,
  RestoreDialogueQuestStateOptions,
  TiledLayerCompressionContext,
  TiledLayerDataDecoder,
  TiledTilemapImportOptions,
  TiledTilemapImportResult,
  TiledTilesetFrameContext,
  TilemapNavigationPath,
  TilemapNavigationPathPoint,
  TilemapNavigationPathQuery,
  TilemapNavigationWaypoint,
  TilemapNavigationWaypointQuery,
  TilemapRectEditOptions,
  TileRuleGrid,
  TileRuleSpec,
  TilemapBoundaryChain,
  TilemapBoundaryExtractionOptions,
  TilemapBoundaryExtractionResult,
  CreateHudOverlayStateOptions,
  HudComponentBase,
  HudComponentSpec,
  HudCounterSpec,
  HudMessageSpec,
  HudMeterSpec,
  HudPromptSpec,
  HudThemeInput,
  HudThemePresetName,
  HudThemeTokens,
  ResolvedHudThemeTokens,
  UiAction,
  UiDialog,
  UiMeter,
  UiOverlay,
  UiOverlayActionEvent,
  UiOverlayActionTone,
  UiOverlayOptions,
  UiOverlayRegion,
  UiOverlayState,
  UiOverlayTone,
  UiPanel,
  UiTextLine,
  ScreenFadeTransitionSnapshot,
  ScreenFadeTransitionSpec,
  createFerrumRuntime,
  generateTextureAtlasLayout,
} from "../src/index.js";

type PublicApi = typeof import("../src/index.js");
type AssertType<T extends true> = T;
type IfEquals<X, Y, A = true, B = false> =
  (<T>() => T extends X ? 1 : 2) extends
  (<T>() => T extends Y ? 1 : 2) ? A : B;
type IsReadonly<T, K extends keyof T> = IfEquals<
  { [P in K]: T[P] },
  { -readonly [P in K]: T[P] },
  false,
  true
>;
type _BuiltInShooterSnapshotEntityCountReadonly = AssertType<IsReadonly<BuiltInShooterStateSnapshot, "entityCount">>;
type _GameStateSceneSnapshotScoreReadonly = AssertType<IsReadonly<GameStateSceneSnapshot, "score">>;
type _GameStateSnapshotSceneReadonly = AssertType<IsReadonly<GameStateSnapshot, "scene">>;
type _GameStateSnapshotRestoreResultSceneAfterReadonly = AssertType<IsReadonly<GameStateSnapshotRestoreResult, "sceneAfter">>;
const readonlySnapshotTypeAssertions: [
  _BuiltInShooterSnapshotEntityCountReadonly,
  _GameStateSceneSnapshotScoreReadonly,
  _GameStateSnapshotSceneReadonly,
  _GameStateSnapshotRestoreResultSceneAfterReadonly,
] = [true, true, true, true];
void readonlySnapshotTypeAssertions;

test("public API types are importable from entrypoint source", () => {
  const manifest: AssetManifest = {
    textures: { player: "/assets/player.png" },
    sounds: { shoot: "/assets/shoot.wav" },
    json: { game: "/game.json" },
  };
  const publicResolveAssetPreloadPlan: PublicApi["resolveAssetPreloadPlan"] = resolveAssetPreloadPlan;
  const publicPreloadAssetManifest: PublicApi["preloadAssetManifest"] = preloadAssetManifest;
  const publicAssetManifestFingerprint: PublicApi["assetManifestFingerprint"] = assetManifestFingerprint;
  const publicCreateAssetPreloadCachePolicy: PublicApi["createAssetPreloadCachePolicy"] =
    createAssetPreloadCachePolicy;
  const publicInvalidatePreloadedAssetCache: PublicApi["invalidatePreloadedAssetCache"] =
    invalidatePreloadedAssetCache;
  const publicIndexedDbAssetCache: PublicApi["IndexedDbAssetCache"] = IndexedDbAssetCache;
  const publicLoadingOverlay: PublicApi["LoadingOverlay"] = LoadingOverlay;
  const assetPreloadCachePolicy: AssetPreloadCachePolicy = {
    json: true,
    textures: true,
    sounds: true,
    binary: true,
    version: "v1",
    ttlMs: 1000,
  };
  const assetPreloadPlan: AssetPreloadPlan = publicResolveAssetPreloadPlan(manifest);
  const firstAssetPreloadEntry: AssetPreloadEntry | undefined = assetPreloadPlan.entries[0];
  const cachePolicyOptions: CreateAssetPreloadCachePolicyOptions = {
    versionPrefix: "game",
    versionSalt: "release",
    ttlMs: 1000,
  };
  const derivedAssetPreloadCachePolicy: AssetPreloadCachePolicy =
    publicCreateAssetPreloadCachePolicy(manifest, cachePolicyOptions);
  const preloadOptions: PreloadAssetManifestOptions = { cachePolicy: derivedAssetPreloadCachePolicy };
  const invalidationOptions: InvalidatePreloadedAssetCacheOptions = { policy: derivedAssetPreloadCachePolicy };
  const nullableAssetPreloadInvalidation: AssetPreloadInvalidationResult | undefined = undefined;
  const nullablePreloadedManifest: PreloadedAssetManifest | undefined = undefined;
  const jsonCacheSetOptions: JsonCacheSetOptions = { version: "v1", ttlMs: 1000 };
  const binaryCacheSetOptions: BinaryCacheSetOptions = jsonCacheSetOptions;
  const indexedDbAssetCache = new publicIndexedDbAssetCache({ indexedDB: undefined });
  const assetPreloadCache: AssetPreloadCache = indexedDbAssetCache;
  const jsonAssetCache: JsonAssetCache = indexedDbAssetCache;
  const binaryAssetCache: BinaryAssetCache = indexedDbAssetCache;
  const indexedDbOptions: IndexedDbAssetCacheOptions = {
    databaseName: "ferrum-test",
    storeName: "json",
    binaryStoreName: "binary",
  };
  const levelOrigin: LevelStreamingOrigin = { x: 0, y: 0 };
  const levelTilemapChunk: LevelTilemapChunkSpec = { url: "/chunks/0-0.json", layer: "main" };
  const levelChunkSpec: LevelChunkSpec = {
    id: "0,0",
    chunkX: 0,
    chunkY: 0,
    tilemap: levelTilemapChunk,
    assets: manifest,
  };
  const levelManifestSpec: LevelChunkManifestSpec = {
    id: "world",
    tileWidth: 16,
    tileHeight: 16,
    chunkColumns: 4,
    chunkRows: 4,
    origin: levelOrigin,
    chunks: [levelChunkSpec],
  };
  const levelResolveOptions: ResolveLevelChunkManifestOptions = { path: "streaming" };
  const publicResolveLevelChunkManifest: PublicApi["resolveLevelChunkManifest"] = resolveLevelChunkManifest;
  const publicResolveLevelStreamingPlan: PublicApi["resolveLevelStreamingPlan"] = resolveLevelStreamingPlan;
  const publicLevelChunkStreamer: PublicApi["LevelChunkStreamer"] = LevelChunkStreamer;
  const resolvedLevelManifest: ResolvedLevelChunkManifest =
    publicResolveLevelChunkManifest(levelManifestSpec, levelResolveOptions);
  const resolvedLevelChunk: ResolvedLevelChunk = resolvedLevelManifest.chunks[0] as ResolvedLevelChunk;
  const resolvedLevelTilemapChunk: ResolvedLevelTilemapChunk =
    resolvedLevelChunk.tilemap as ResolvedLevelTilemapChunk;
  const levelChunkBounds: LevelChunkBounds = resolvedLevelChunk.bounds;
  const levelViewport: LevelStreamingViewport = { x: 0, y: 0, width: 16, height: 16 };
  const levelAssetLifetime: LevelStreamingAssetLifetimePolicy = { preloadMarginChunks: 0, retainMarginChunks: 0 };
  const levelPlanOptions: LevelStreamingPlanOptions = { assetLifetime: levelAssetLifetime };
  const levelStreamingPlan: LevelStreamingPlan =
    publicResolveLevelStreamingPlan(resolvedLevelManifest, levelViewport, levelPlanOptions);
  const levelStreamer = publicLevelChunkStreamer.create(resolvedLevelManifest, levelAssetLifetime);
  const levelStreamerSnapshot: LevelChunkStreamerSnapshot = levelStreamer.markLoaded(levelStreamingPlan.loadChunkIds);
  const loadingOverlayOptions: LoadingOverlayOptions = { title: "Loading", autoHideOnComplete: true };
  const loadingOverlayStatus: LoadingOverlayStatus = "loading";
  const loadingOverlayState: LoadingOverlayState = {
    status: loadingOverlayStatus,
    progress: { loaded: 1, total: 2, ratio: 0.5 },
    title: "Loading",
    detail: "Loading texture player (1/2)",
  };
  const animationFrameRef: AnimationTimelineFrameRef = "idle.0";
  const animationEventPayload: AnimationTimelineEventPayload = { sound: "step" };
  const animationEvent: AnimationTimelineEventSpec = { frame: 1, id: "footstep", payload: animationEventPayload };
  const animationTransition: AnimationTimelineTransitionSpec = { on: "move", to: "move" };
  const animationState: AnimationTimelineStateSpec = {
    frames: [animationFrameRef, "idle.1"],
    fps: 2,
    events: [animationEvent],
    transitions: [animationTransition],
  };
  const animationTimelineSpec: AnimationTimelineSpec = {
    initialState: "idle",
    states: {
      idle: animationState,
      move: { frameCount: 2, fps: 4, transitions: [{ to: "idle", atEnd: true }] },
    },
  };
  const publicResolveAnimationTimelineSpec: PublicApi["resolveAnimationTimelineSpec"] =
    resolveAnimationTimelineSpec;
  const publicAnimationTimelineFrameAt: PublicApi["animationTimelineFrameAt"] = animationTimelineFrameAt;
  const publicAnimationTimelinePlayer: PublicApi["AnimationTimelinePlayer"] = AnimationTimelinePlayer;
  const resolvedAnimationTimeline: ResolvedAnimationTimelineSpec =
    publicResolveAnimationTimelineSpec(animationTimelineSpec);
  const resolvedAnimationState: ResolvedAnimationTimelineState = resolvedAnimationTimeline.states.idle;
  const resolvedAnimationEvent: ResolvedAnimationTimelineEvent = resolvedAnimationState.events[0];
  const resolvedAnimationTransition: ResolvedAnimationTimelineTransition = resolvedAnimationState.transitions[0];
  const animationPlayer = publicAnimationTimelinePlayer.create(resolvedAnimationTimeline);
  const animationUpdateOptions: AnimationTimelineUpdateOptions = { signals: ["move"], maxEvents: 4 };
  const animationUpdate: AnimationTimelineUpdateResult = animationPlayer.update(0.5, animationUpdateOptions);
  const animationEmittedEvent: AnimationTimelineEmittedEvent | undefined = animationUpdate.events[0];
  const animationSnapshot: AnimationTimelinePlayerSnapshot = animationPlayer.snapshot();
  const sceneCompositionJson: SceneCompositionJsonValue = { hp: 1 };
  const sceneCompositionProps: SceneCompositionProps = {
    kind: "enemy",
    stats: sceneCompositionJson,
  };
  const sceneCompositionTransform: SceneCompositionTransformSpec = { x: 4, y: 5, scale: 1 };
  const resolvedSceneCompositionTransform: ResolvedSceneCompositionTransform = {
    x: 4,
    y: 5,
    rotationRadians: 0,
    scale: 1,
    layer: 0,
  };
  const sceneCompositionVariant: SceneCompositionPrefabVariantSpec = {
    props: { stats: { hp: 2 } },
  };
  const sceneCompositionPrefab: SceneCompositionPrefabSpec = {
    props: sceneCompositionProps,
    variants: { strong: sceneCompositionVariant },
  };
  const sceneCompositionInstanceSpec: SceneCompositionFragmentInstanceSpec = {
    id: "enemy",
    prefab: "enemy",
    variant: "strong",
    ...sceneCompositionTransform,
    props: { room: "alpha" },
  };
  const sceneCompositionInclude: SceneCompositionFragmentIncludeSpec = {
    fragment: "spawn",
    idPrefix: "a.",
    x: 2,
  };
  const sceneCompositionFragment: SceneCompositionFragmentSpec = {
    include: [sceneCompositionInclude],
  };
  const sceneCompositionSpec: SceneCompositionSpec = {
    initialFragment: "room",
    prefabs: { enemy: sceneCompositionPrefab },
    fragments: {
      room: sceneCompositionFragment,
      spawn: { instances: [sceneCompositionInstanceSpec] },
    },
  };
  const resolveSceneCompositionOptions: ResolveSceneCompositionOptions = { path: "scene" };
  const instantiateSceneCompositionOptions: InstantiateSceneFragmentOptions = { fragment: "room" };
  const applySceneCompositionOptions: ApplySceneCompositionOptions = instantiateSceneCompositionOptions;
  const publicResolveSceneCompositionSpec: PublicApi["resolveSceneCompositionSpec"] =
    resolveSceneCompositionSpec;
  const publicInstantiateSceneFragment: PublicApi["instantiateSceneFragment"] = instantiateSceneFragment;
  const publicApplySceneCompositionFragment: PublicApi["applySceneCompositionFragment"] =
    applySceneCompositionFragment;
  const resolvedSceneComposition: ResolvedSceneCompositionSpec =
    publicResolveSceneCompositionSpec(sceneCompositionSpec, resolveSceneCompositionOptions);
  const resolvedSceneCompositionPrefab: ResolvedSceneCompositionPrefab = resolvedSceneComposition.prefabs.enemy;
  const resolvedSceneCompositionVariant: ResolvedSceneCompositionPrefabVariant =
    resolvedSceneCompositionPrefab.variants.strong;
  const resolvedSceneCompositionFragment: ResolvedSceneCompositionFragment = resolvedSceneComposition.fragments.room;
  const resolvedSceneCompositionInclude: ResolvedSceneCompositionFragmentInclude =
    resolvedSceneCompositionFragment.include[0];
  const resolvedSceneCompositionFragmentInstance: ResolvedSceneCompositionFragmentInstance =
    resolvedSceneComposition.fragments.spawn.instances[0];
  const resolvedSceneCompositionInstances: ResolvedSceneCompositionInstance[] =
    publicInstantiateSceneFragment(resolvedSceneComposition, instantiateSceneCompositionOptions);
  const resolvedSceneCompositionInstance: ResolvedSceneCompositionInstance = resolvedSceneCompositionInstances[0];
  const sceneCompositionTarget: SceneCompositionTarget = {
    spawnSceneInstance: (instance) => instance.id,
  };
  const sceneCompositionApplyResult: SceneCompositionApplyResult =
    publicApplySceneCompositionFragment(sceneCompositionTarget, resolvedSceneComposition, applySceneCompositionOptions);
  const behaviorRecipeKind: BehaviorRecipeKind = "health";
  const behaviorRecipeZeroAction: BehaviorRecipeHealthZeroAction = "event";
  const behaviorRecipeDamageTarget: BehaviorRecipeDamageTarget = "other";
  const healthBehaviorRecipe: HealthBehaviorRecipeSpec = {
    id: "living",
    kind: "health",
    max: 3,
    start: 2,
    onZero: behaviorRecipeZeroAction,
    event: "defeated",
  };
  const damageBehaviorRecipe: DamageBehaviorRecipeSpec = {
    id: "contactDamage",
    kind: "damage",
    amount: 1,
    target: behaviorRecipeDamageTarget,
  };
  const pickupBehaviorRecipe: PickupBehaviorRecipeSpec = { kind: "pickup", item: "coin", count: 1 };
  const chaseBehaviorRecipe: ChaseBehaviorRecipeSpec = { kind: "chase", target: "player", speed: 80 };
  const interactionBehaviorRecipe: InteractionBehaviorRecipeSpec = {
    kind: "interaction",
    action: "inspect",
    radius: 24,
  };
  const behaviorRecipeSpec: BehaviorRecipeSpec = damageBehaviorRecipe;
  const behaviorRecipeReference: BehaviorRecipeReferenceSpec = {
    use: "contactDamage",
    id: "strongDamage",
    overrides: { amount: 2 },
  };
  const behaviorRecipeEntry: BehaviorRecipeEntrySpec = behaviorRecipeReference;
  const behaviorRecipeEntity: BehaviorRecipeEntitySpec = {
    tags: ["hostile"],
    recipes: [healthBehaviorRecipe, behaviorRecipeEntry, chaseBehaviorRecipe],
  };
  const behaviorRecipeDocument: BehaviorRecipeDocumentSpec = {
    recipes: { contactDamage: damageBehaviorRecipe },
    entities: {
      enemy: behaviorRecipeEntity,
      coin: { recipes: [pickupBehaviorRecipe, interactionBehaviorRecipe] },
    },
  };
  const behaviorRecipeResolveOptions: ResolveBehaviorRecipeDocumentOptions = { path: "recipes" };
  const publicResolveBehaviorRecipeDocument: PublicApi["resolveBehaviorRecipeDocument"] =
    resolveBehaviorRecipeDocument;
  const publicBehaviorRecipeCommandsForEntity: PublicApi["behaviorRecipeCommandsForEntity"] =
    behaviorRecipeCommandsForEntity;
  const publicApplyBehaviorRecipes: PublicApi["applyBehaviorRecipes"] = applyBehaviorRecipes;
  const resolvedBehaviorRecipeDocument: ResolvedBehaviorRecipeDocument =
    publicResolveBehaviorRecipeDocument(behaviorRecipeDocument, behaviorRecipeResolveOptions);
  const resolvedBehaviorRecipeEntity: ResolvedBehaviorRecipeEntity =
    resolvedBehaviorRecipeDocument.entities.enemy;
  const resolvedBehaviorRecipeBase: ResolvedBehaviorRecipeBase = resolvedBehaviorRecipeEntity.recipes[0];
  const resolvedBehaviorRecipe: ResolvedBehaviorRecipe = resolvedBehaviorRecipeEntity.recipes[1];
  const resolvedHealthBehaviorRecipe: ResolvedHealthBehaviorRecipe =
    resolvedBehaviorRecipeEntity.recipes[0] as ResolvedHealthBehaviorRecipe;
  const resolvedDamageBehaviorRecipe: ResolvedDamageBehaviorRecipe =
    resolvedBehaviorRecipeEntity.recipes[1] as ResolvedDamageBehaviorRecipe;
  const resolvedChaseBehaviorRecipe: ResolvedChaseBehaviorRecipe =
    resolvedBehaviorRecipeEntity.recipes[2] as ResolvedChaseBehaviorRecipe;
  const resolvedPickupBehaviorRecipe: ResolvedPickupBehaviorRecipe =
    resolvedBehaviorRecipeDocument.entities.coin.recipes[0] as ResolvedPickupBehaviorRecipe;
  const resolvedInteractionBehaviorRecipe: ResolvedInteractionBehaviorRecipe =
    resolvedBehaviorRecipeDocument.entities.coin.recipes[1] as ResolvedInteractionBehaviorRecipe;
  const behaviorRecipeCommandOptions: BehaviorRecipeCommandOptions = { kinds: ["damage"] };
  const behaviorRecipeCommands: BehaviorRecipeCommand[] =
    publicBehaviorRecipeCommandsForEntity(resolvedBehaviorRecipeDocument, "enemy", behaviorRecipeCommandOptions);
  const behaviorRecipeCommandBase: BehaviorRecipeCommandBase = behaviorRecipeCommands[0];
  const healthBehaviorCommand: ConfigureHealthBehaviorCommand =
    publicBehaviorRecipeCommandsForEntity(resolvedBehaviorRecipeDocument, "enemy")[0] as ConfigureHealthBehaviorCommand;
  const damageBehaviorCommand: ConfigureDamageBehaviorCommand = behaviorRecipeCommands[0] as ConfigureDamageBehaviorCommand;
  const chaseBehaviorCommand: ConfigureChaseBehaviorCommand =
    publicBehaviorRecipeCommandsForEntity(resolvedBehaviorRecipeDocument, "enemy", { kinds: ["chase"] })[0] as ConfigureChaseBehaviorCommand;
  const pickupBehaviorCommand: ConfigurePickupBehaviorCommand =
    publicBehaviorRecipeCommandsForEntity(resolvedBehaviorRecipeDocument, "coin", { kinds: ["pickup"] })[0] as ConfigurePickupBehaviorCommand;
  const interactionBehaviorCommand: ConfigureInteractionBehaviorCommand =
    publicBehaviorRecipeCommandsForEntity(resolvedBehaviorRecipeDocument, "coin", { kinds: ["interaction"] })[0] as ConfigureInteractionBehaviorCommand;
  const behaviorRecipeRuntimeTarget: BehaviorRecipeRuntimeTarget = {
    applyBehaviorRecipeCommand: (command) => command.type,
  };
  const applyBehaviorRecipesOptions: ApplyBehaviorRecipesOptions = { entity: "coin" };
  const behaviorRecipeApplyResult: BehaviorRecipeApplyResult =
    publicApplyBehaviorRecipes(behaviorRecipeRuntimeTarget, resolvedBehaviorRecipeDocument, applyBehaviorRecipesOptions);
  const publicCreateCollider: PublicApi["createCollider"] = createCollider;
  const publicCreateRigidBody: PublicApi["createRigidBody"] = createRigidBody;
  const publicCreatePhysicsWorldFromSpec: PublicApi["createPhysicsWorldFromSpec"] = createPhysicsWorldFromSpec;
  const publicApplyPhysicsSceneProfile: PublicApi["applyPhysicsSceneProfile"] = applyPhysicsSceneProfile;
  const publicCreatePhysicsLayerSpec: PublicApi["createPhysicsLayerSpec"] = createPhysicsLayerSpec;
  const publicCreatePhysicsLayerMap: PublicApi["createPhysicsLayerMap"] = createPhysicsLayerMap;
  const publicPhysicsMaterial: PublicApi["physicsMaterial"] = physicsMaterial;
  const publicCreatePhysicsReplayInputStream: PublicApi["createPhysicsReplayInputStream"] =
    createPhysicsReplayInputStream;
  const publicCreatePhysicsReplayWorkerClient: PublicApi["createPhysicsReplayWorkerClient"] =
    createPhysicsReplayWorkerClient;
  const publicPhysicsReplayWorkerRequestFormat: PublicApi["PHYSICS_REPLAY_WORKER_REQUEST_FORMAT"] =
    PHYSICS_REPLAY_WORKER_REQUEST_FORMAT;
  const publicCreatePixelMaskTerrain: PublicApi["createPixelMaskTerrain"] = createPixelMaskTerrain;
  const publicExtractPixelMaskBoundaryChains: PublicApi["extractPixelMaskBoundaryChains"] =
    extractPixelMaskBoundaryChains;
  const publicCreatePixelMaskTerrainRuntime: PublicApi["createPixelMaskTerrainRuntime"] =
    createPixelMaskTerrainRuntime;
  const authoringCollider: PhysicsColliderAuthoringOptions = { type: "box", size: [16, 24] };
  const bodyAuthoring: PhysicsRigidBodyAuthoringOptions = {
    collider: authoringCollider,
    material: "wood",
    layer: "player",
  };
  const layerPattern: PhysicsLayerPattern = { player: ["world"], world: ["player"] };
  const authoringLayerSpec = publicCreatePhysicsLayerSpec(layerPattern);
  const physicsLayerMap: Record<string, PhysicsAuthoringLayer> = publicCreatePhysicsLayerMap(layerPattern);
  const materialPreset: PhysicsMaterialPresetName = "wood";
  const bodyCollider = publicCreateCollider(authoringCollider);
  const material = publicPhysicsMaterial(materialPreset);
  const nullableWorld: PhysicsWorldApplyResult | undefined = undefined;
  const physicsSceneProfileId: PhysicsSceneProfileId = "runtime";
  const physicsSceneProfileSpec: PhysicsSceneProfileSpec = {
    profile: physicsSceneProfileId,
    physics: {
      mode: "rigid",
      bodies: {
        crate: { type: "dynamic", collider: { shape: "box", size: [8, 8] } },
      },
    },
  };
  const physicsSceneProfileOptions: ApplyPhysicsSceneProfileOptions = { path: "physicsScene" };
  const replayEvent: PhysicsReplayInputEvent = {
    frame: 0,
    body: "crate",
    type: "setVelocity",
    velocityX: 1,
    velocityY: 0,
  };
  const replayInputStream: PhysicsReplayInputStream = publicCreatePhysicsReplayInputStream({
    frameCount: 1,
    events: [replayEvent],
  });
  const nullableReplayRun: PhysicsReplayInputRunResult | undefined = undefined;
  const nullableWorkerReplayRun: PhysicsReplayWorkerRunResult | undefined = undefined;
  const nullableWorkerBenchmark: PhysicsReplayWorkerTransferBenchmarkResult | undefined = undefined;
  const pixelMaskOptions: PixelMaskTerrainOptions = { width: 2, height: 2, fill: "solid" };
  const pixelMaskLayerOptions: PixelMaskTerrainLayerOptions = { tileWidth: 4, tileHeight: 4 };
  const pixelMaskBoundaryOptions: PixelMaskTerrainBoundaryOptions = { physicsLayer: "world" };
  const pixelTerrain = publicCreatePixelMaskTerrain(pixelMaskOptions);
  const pixelTextureUploadOptions: PixelMaskTerrainTextureUploadOptions = {
    color: [255, 255, 255],
    alphaScale: 1,
  };
  const pixelRuntimeTarget: PixelMaskTerrainTextureTarget = {
    createPixelMaskTerrainTexture: () => undefined,
    updatePixelMaskTerrainTexture: () => undefined,
  };
  const pixelRuntimeOptions: PixelMaskTerrainRuntimeOptions = {
    terrain: pixelTerrain,
    texture: {
      target: pixelRuntimeTarget,
      textureId: 1,
      upload: pixelTextureUploadOptions,
    },
    clearDirtyAfterSync: true,
  };
  const nullablePixelRuntimeResult: PixelMaskTerrainRuntimeSyncResult | undefined = undefined;
  const pixelBoundary = publicExtractPixelMaskBoundaryChains(pixelTerrain, pixelMaskBoundaryOptions);
  const nullableDirtyRect: PixelMaskTerrainDirtyRect | undefined = pixelTerrain.dirtyRect();
  const nullableAlphaPatch: PixelMaskTerrainAlphaPatch | undefined = pixelTerrain.dirtyAlphaPatch();
  const tilemapBoundaryOptions: TilemapBoundaryExtractionOptions = { physicsLayer: "world" };
  const tilemapBoundaryResult: TilemapBoundaryExtractionResult = pixelTerrain.extractBoundaryChains(tilemapBoundaryOptions);
  const tilemapBoundaryChain: TilemapBoundaryChain | undefined = tilemapBoundaryResult.chains[0];
  const tileRuleGrid: TileRuleGrid = { columns: 1, rows: 1, data: [1] };
  const tileRules: TileRuleSpec[] = [{ match: "filled", output: 2 }];
  const tileRuleOptions: ApplyTileRulesOptions = { preserveUnmatched: false };
  const publicApplyTileRules: PublicApi["applyTileRules"] = applyTileRules;
  const animatedTileFrame: AnimatedTileFrameSpec = { tile: 4, durationMs: 100 };
  const animatedTile: AnimatedTileSpec = { frames: [3, animatedTileFrame], fps: 4 };
  const animatedTileOptions: AnimatedTileLayerOptions = { timeSeconds: 0.25 };
  const publicResolveAnimatedTileFrame: PublicApi["resolveAnimatedTileFrame"] = resolveAnimatedTileFrame;
  const publicBakeAnimatedTileLayer: PublicApi["bakeAnimatedTileLayer"] = bakeAnimatedTileLayer;
  const spriteMaterialName: SpriteMaterialPresetName = "outline";
  const spriteMaterialColor: SpriteMaterialColor = [1, 1, 1, 1];
  const spriteMaterialColorMix: SpriteMaterialColorMix = {
    color: spriteMaterialColor,
    amount: 0.25,
    preserveAlpha: true,
  };
  const resolvedSpriteMaterialColorMix: ResolvedSpriteMaterialColorMix = {
    color: spriteMaterialColor,
    amount: 0.25,
    preserveAlpha: true,
  };
  const spriteMaterialOutlineDirections: SpriteMaterialOutlineDirections = "cardinal";
  const spriteMaterialOutlineOptions: SpriteMaterialOutlineOptions = {
    color: [0, 0, 0, 0.9],
    thickness: 2,
    directions: spriteMaterialOutlineDirections,
  };
  const resolvedSpriteMaterialOutline: ResolvedSpriteMaterialOutline = {
    color: [0, 0, 0, 0.9],
    thickness: 2,
    directions: "cardinal",
  };
  const spriteMaterialBlendMode: SpriteMaterialBlendMode = "alpha";
  const spriteMaterialPreset: SpriteMaterialPreset = {
    name: "custom",
    blendMode: spriteMaterialBlendMode,
    colorMix: spriteMaterialColorMix,
    outline: spriteMaterialOutlineOptions,
  };
  const spriteMaterialInput: SpriteMaterialPresetInput = spriteMaterialPreset;
  const publicResolveSpriteMaterialPreset: PublicApi["resolveSpriteMaterialPreset"] = resolveSpriteMaterialPreset;
  const publicSpriteMaterialPresets: PublicApi["SPRITE_MATERIAL_PRESETS"] = SPRITE_MATERIAL_PRESETS;
  const publicSpriteMaterialPasses: PublicApi["spriteMaterialPasses"] = spriteMaterialPasses;
  const resolvedSpriteMaterial: ResolvedSpriteMaterialPreset =
    publicResolveSpriteMaterialPreset(spriteMaterialInput);
  const firstSpriteMaterialPass: SpriteMaterialPass | undefined =
    publicSpriteMaterialPasses(publicResolveSpriteMaterialPreset(spriteMaterialName))[0];
  const pointLight: PointLight2D = { x: 24, y: 32, radius: 96, color: [1, 0.9, 0.65], intensity: 1 };
  const tileOccluderGrid: TileOccluderGridInput = { width: 1, height: 1, tileSize: 16, data: [1] };
  const tileOccluder: TileOccluder2D = deriveTileOccludersFromTilemapGrid(tileOccluderGrid)[0];
  const lightingShadows: LightingShadowOptions = { enabled: true, projectionLength: 128 };
  const lightingScene: LightingScene2D = {
    ambient: [0, 0, 0, 0.4],
    pointLights: [pointLight],
    tileOccluders: [tileOccluder],
    shadows: lightingShadows,
    debug: { tileOccluders: true },
  };
  const resolvedLightingScene: ResolvedLightingScene2D = normalizeLightingScene(lightingScene);
  const resolvedLightingShadows: ResolvedLightingShadowOptions = resolvedLightingScene.shadows;
  const shadowClipRect: ShadowClipRect = { x: 0, y: 0, width: 320, height: 180 };
  const shadowProjectionOptions: ShadowProjectionOptions = { clipRect: shadowClipRect };
  const lightingSceneProvider: LightingSceneProvider = (frame) => ({
    ...lightingScene,
    pointLights: [{ ...pointLight, x: frame.mouseX }],
  });
  const cameraPoint: CameraPoint = { x: 10, y: 12 };
  const cameraViewport: CameraViewport = { width: 320, height: 180 };
  const cameraBounds: CameraBounds = { minX: 0, minY: 0, maxX: 640, maxY: 360 };
  const cameraDeadZone: CameraDeadZone = { width: 96, height: 64 };
  const cameraRigSpec: CameraRigSpec = {
    x: cameraPoint.x,
    y: cameraPoint.y,
    bounds: cameraBounds,
    deadZone: cameraDeadZone,
    smoothTimeSeconds: 0.15,
  };
  const cameraRigOptions: ResolveCameraRigOptions = { path: "camera" };
  const publicResolveCameraRigSpec: PublicApi["resolveCameraRigSpec"] = resolveCameraRigSpec;
  const publicClampCameraToBounds: PublicApi["clampCameraToBounds"] = clampCameraToBounds;
  const publicCameraRigController: PublicApi["CameraRigController"] = CameraRigController;
  const resolvedCameraRig: ResolvedCameraRigSpec = publicResolveCameraRigSpec(cameraRigSpec, cameraRigOptions);
  const resolvedCameraBounds: ResolvedCameraBounds = resolvedCameraRig.bounds ?? cameraBounds;
  const resolvedCameraDeadZone: ResolvedCameraDeadZone = resolvedCameraRig.deadZone;
  const cameraRigStepOptions: CameraRigStepOptions = { viewport: cameraViewport };
  const cameraRig = publicCameraRigController.create(cameraRigSpec);
  const cameraRigSnapshot: CameraRigSnapshot = cameraRig.step({ x: 100, y: 80 }, 1 / 60, cameraRigStepOptions);
  const postProcessKind: PostProcessPassKind = "fade";
  const postProcessColor: PostProcessColor = [0, 0, 0, 0.25];
  const fadePassInput: FadePostProcessPassInput = { kind: postProcessKind, color: postProcessColor };
  const bloomPassInput: BloomPostProcessPassInput = { kind: "bloom", threshold: 0.8, intensity: 0.4 };
  const crtPassInput: CrtPostProcessPassInput = { kind: "crt", scanlineIntensity: 0.2 };
  const vignettePassInput: VignettePostProcessPassInput = { kind: "vignette", intensity: 0.25 };
  const glitchPassInput: GlitchPostProcessPassInput = { kind: "glitch", intensity: 0.02 };
  const postProcessConfigInput: PostProcessingConfigInput = { bloom: { intensity: 0.3 }, vignette: { intensity: 0.2 } };
  const postProcessPassInput: PostProcessPassInput = fadePassInput;
  const postProcessStackInput: PostProcessStackInput = [
    postProcessPassInput,
    bloomPassInput,
    crtPassInput,
    vignettePassInput,
    glitchPassInput,
  ];
  const postProcessOptions: ResolvePostProcessOptions = { path: "screen" };
  const publicResolvePostProcessPasses: PublicApi["resolvePostProcessPasses"] = resolvePostProcessPasses;
  const publicFadePostProcessPass: PublicApi["fadePostProcessPass"] = fadePostProcessPass;
  const resolvedPostProcessPasses: readonly ResolvedPostProcessPass[] =
    publicResolvePostProcessPasses(postProcessStackInput, postProcessOptions);
  const resolvedPostProcessPass: ResolvedFadePostProcessPass =
    resolvedPostProcessPasses[0] as ResolvedFadePostProcessPass;
  const resolvedBloomPostProcessPass: ResolvedBloomPostProcessPass =
    publicResolvePostProcessPasses(postProcessConfigInput)[0] as ResolvedBloomPostProcessPass;
  const resolvedCrtPostProcessPass: ResolvedCrtPostProcessPass =
    publicResolvePostProcessPasses(crtPassInput)[0] as ResolvedCrtPostProcessPass;
  const resolvedVignettePostProcessPass: ResolvedVignettePostProcessPass =
    publicResolvePostProcessPasses(vignettePassInput)[0] as ResolvedVignettePostProcessPass;
  const resolvedGlitchPostProcessPass: ResolvedGlitchPostProcessPass =
    publicResolvePostProcessPasses(glitchPassInput)[0] as ResolvedGlitchPostProcessPass;
  const resolvedPostProcessColor: ResolvedPostProcessColor = resolvedPostProcessPass.color;
  equal(resolvedBloomPostProcessPass.kind, "bloom");
  equal(resolvedCrtPostProcessPass.kind, "crt");
  equal(resolvedVignettePostProcessPass.kind, "vignette");
  equal(resolvedGlitchPostProcessPass.kind, "glitch");
  const fadeTransitionSpec: ScreenFadeTransitionSpec = { durationSeconds: 1, fromOpacity: 1, toOpacity: 0 };
  const publicScreenFadeTransition: PublicApi["ScreenFadeTransition"] = ScreenFadeTransition;
  const fadeTransition = publicScreenFadeTransition.create(fadeTransitionSpec);
  const fadeTransitionSnapshot: ScreenFadeTransitionSnapshot = fadeTransition.update(0.5);
  const postProcessProvider: PostProcessProvider = () => fadeTransition.postProcessPasses();
  const cutsceneCommandBase: CutsceneCommandBaseSpec = { id: "intro" };
  const cutsceneKind: CutsceneSequenceCommandKind = "camera";
  const cutsceneEasing: CutsceneSequenceEasing = "easeInOut";
  const cutsceneAudioAction: CutsceneAudioAction = "play";
  const cutsceneAudioBus: CutsceneAudioBus = "bgm";
  const cutsceneWaitCommand: CutsceneWaitCommandSpec = { kind: "wait", durationSeconds: 0.1 };
  const cutsceneCameraCommand: CutsceneCameraCommandSpec = {
    ...cutsceneCommandBase,
    kind: cutsceneKind,
    target: cameraPoint,
    easing: cutsceneEasing,
  };
  const cutsceneAudioCommand: CutsceneAudioCommandSpec = {
    kind: "audio",
    sound: "intro",
    action: cutsceneAudioAction,
    bus: cutsceneAudioBus,
  };
  const cutsceneDialogueCommand: CutsceneDialogueCommandSpec = {
    kind: "dialogue",
    speaker: "Guide",
    text: "Ready",
  };
  const cutsceneSequenceCommand: CutsceneSequenceCommandSpec = cutsceneDialogueCommand;
  const cutsceneSequenceSpec: CutsceneSequenceSpec = {
    id: "intro",
    commands: [
      cutsceneWaitCommand,
      cutsceneCameraCommand,
      cutsceneAudioCommand,
      cutsceneSequenceCommand,
    ],
  };
  const cutsceneResolveOptions: ResolveCutsceneSequenceOptions = { path: "cutscene" };
  const publicResolveCutsceneSequenceSpec: PublicApi["resolveCutsceneSequenceSpec"] =
    resolveCutsceneSequenceSpec;
  const publicCutsceneSequencePlayer: PublicApi["CutsceneSequencePlayer"] = CutsceneSequencePlayer;
  const publicApplyCutsceneSequenceEvent: PublicApi["applyCutsceneSequenceEvent"] =
    applyCutsceneSequenceEvent;
  const resolvedCutsceneSequence: ResolvedCutsceneSequenceSpec =
    publicResolveCutsceneSequenceSpec(cutsceneSequenceSpec, cutsceneResolveOptions);
  const resolvedCutsceneCommandBase: ResolvedCutsceneCommandBase =
    resolvedCutsceneSequence.commands[0] as ResolvedCutsceneCommandBase;
  const resolvedCutsceneCommand: ResolvedCutsceneSequenceCommand =
    resolvedCutsceneSequence.commands[1] as ResolvedCutsceneSequenceCommand;
  const resolvedCutsceneWait: ResolvedCutsceneWaitCommand =
    resolvedCutsceneSequence.commands[0] as ResolvedCutsceneWaitCommand;
  const resolvedCutsceneCamera: ResolvedCutsceneCameraCommand =
    resolvedCutsceneSequence.commands[1] as ResolvedCutsceneCameraCommand;
  const resolvedCutsceneAudio: ResolvedCutsceneAudioCommand =
    resolvedCutsceneSequence.commands[2] as ResolvedCutsceneAudioCommand;
  const resolvedCutsceneDialogue: ResolvedCutsceneDialogueCommand =
    resolvedCutsceneSequence.commands[3] as ResolvedCutsceneDialogueCommand;
  const cutsceneTarget: CutsceneSequenceTarget = {
    moveCamera: () => undefined,
    playCutsceneAudio: () => undefined,
    showCutsceneDialogue: () => undefined,
  };
  const cutscenePlayer = publicCutsceneSequencePlayer.create(resolvedCutsceneSequence);
  const cutsceneUpdateOptions: CutsceneSequenceUpdateOptions = { target: cutsceneTarget };
  const cutsceneUpdate: CutsceneSequenceUpdateResult = cutscenePlayer.update(0, cutsceneUpdateOptions);
  const cutsceneSnapshot: CutsceneSequencePlayerSnapshot = cutsceneUpdate.snapshot;
  const cutsceneEvent: CutsceneSequenceEvent = cutsceneUpdate.events[0] as CutsceneSequenceEvent;
  publicApplyCutsceneSequenceEvent(cutsceneTarget, cutsceneEvent);
  const textDirection: TextDirection = "ltr";
  const localizationPlaceholderValue: LocalizationPlaceholderValue = "Ferrum";
  const localizationStringEntry: LocalizationStringEntrySpec = {
    text: "Hello, {name}",
    description: "Greeting",
  };
  const localizationString: LocalizationStringSpec = localizationStringEntry;
  const localizationLocale: LocalizationLocaleSpec = {
    direction: textDirection,
    strings: {
      greeting: localizationString,
      start: "Start",
    },
  };
  const localizationDocumentSpec: LocalizationDocumentSpec = {
    defaultLocale: "en",
    fallbackLocale: "en",
    locales: {
      en: localizationLocale,
      ko: { strings: { start: "시작" } },
    },
  };
  const localizationOptions: ResolveLocalizationOptions = { path: "localization" };
  const publicResolveLocalizationDocument: PublicApi["resolveLocalizationDocument"] =
    resolveLocalizationDocument;
  const publicLocalizationBundle: PublicApi["LocalizationBundle"] = LocalizationBundle;
  const publicLocalizationLocaleChain: PublicApi["localizationLocaleChain"] = localizationLocaleChain;
  const resolvedLocalization: ResolvedLocalizationDocument =
    publicResolveLocalizationDocument(localizationDocumentSpec, localizationOptions);
  const resolvedLocalizationLocale: ResolvedLocalizationLocale = resolvedLocalization.locales.en;
  const resolvedLocalizationString: ResolvedLocalizationString = resolvedLocalizationLocale.strings.greeting;
  const localizationBundle = publicLocalizationBundle.create(resolvedLocalization, "ko-KR");
  const missingLocalizationBehavior: MissingLocalizationBehavior = "fallback";
  const localizeOptions: LocalizeOptions = {
    values: { name: localizationPlaceholderValue },
    missing: missingLocalizationBehavior,
  };
  const localizedText: LocalizedTextResult = localizationBundle.localize("greeting", localizeOptions);
  const textLayoutOptions: TextLayoutOptions = { maxCharsPerLine: 12, maxLines: 2, overflow: "ellipsis" };
  const publicLayoutLocalizedText: PublicApi["layoutLocalizedText"] = layoutLocalizedText;
  const textLayout: TextLayoutResult = publicLayoutLocalizedText(localizedText.text, textLayoutOptions);
  const textLayoutLine: TextLayoutLine = textLayout.lines[0];
  const fontDisplayPolicy: FontDisplayPolicy = "swap";
  const webFontPolicySpec: WebFontPolicySpec = {
    family: "Ferrum UI",
    sources: ["/fonts/ferrum.woff2"],
    display: fontDisplayPolicy,
  };
  const bitmapFontPolicySpec: BitmapFontPolicySpec = {
    image: "/fonts/pixel.png",
    data: "/fonts/pixel.json",
  };
  const fontLoadingPolicySpec: FontLoadingPolicySpec = {
    defaultFamily: "Ferrum UI",
    webFonts: { ui: webFontPolicySpec },
    bitmapFonts: { pixel: bitmapFontPolicySpec },
  };
  const publicResolveFontLoadingPolicy: PublicApi["resolveFontLoadingPolicy"] = resolveFontLoadingPolicy;
  const publicLoadFontLoadingPolicy: PublicApi["loadFontLoadingPolicy"] = loadFontLoadingPolicy;
  const fontPolicy: ResolvedFontLoadingPolicy = publicResolveFontLoadingPolicy(fontLoadingPolicySpec);
  const resolvedWebFont: ResolvedWebFontPolicy = fontPolicy.webFonts[0];
  const resolvedBitmapFont: ResolvedBitmapFontPolicy = fontPolicy.bitmapFonts[0];
  const fontFaceSet: FontFaceSetLike = { load: async () => [] };
  const fontLoadPromise: Promise<LoadFontPolicyResult> = publicLoadFontLoadingPolicy(fontPolicy, fontFaceSet);
  void fontLoadPromise;
  const questStatus: QuestStatus = "active";
  const questUpdateAction: QuestUpdateAction = "start";
  const questObjectiveSpec: QuestObjectiveSpec = { text: "Talk" };
  const questStageSpec: QuestStageSpec = {
    title: "Intro",
    objectives: { talk: questObjectiveSpec },
  };
  const questSpec: QuestSpec = { title: "Tutorial", stages: { intro: questStageSpec } };
  const questDocumentSpec: QuestDocumentSpec = { quests: { tutorial: questSpec } };
  const questUpdateSpec: QuestUpdateSpec = { quest: "tutorial", action: questUpdateAction, stage: "intro" };
  const dialogueChoiceSpec: DialogueChoiceSpec = {
    id: "accept",
    label: "Accept",
    to: "done",
    questUpdates: [questUpdateSpec],
  };
  const dialogueNodeSpec: DialogueNodeSpec = {
    speaker: "Guide",
    text: "Ready?",
    choices: [dialogueChoiceSpec],
  };
  const dialogueGraphSpec: DialogueGraphSpec = {
    initialNode: "start",
    nodes: {
      start: dialogueNodeSpec,
      done: { text: "Done", end: true },
    },
  };
  const dialogueQuestOptions: ResolveDialogueQuestOptions = { path: "dialogue" };
  const publicResolveQuestDocument: PublicApi["resolveQuestDocument"] = resolveQuestDocument;
  const publicResolveDialogueGraph: PublicApi["resolveDialogueGraph"] = resolveDialogueGraph;
  const publicQuestLog: PublicApi["QuestLog"] = QuestLog;
  const publicDialogueSession: PublicApi["DialogueSession"] = DialogueSession;
  const publicDialogueNodeToUiOverlayState: PublicApi["dialogueNodeToUiOverlayState"] =
    dialogueNodeToUiOverlayState;
  const publicCaptureDialogueQuestState: PublicApi["captureDialogueQuestState"] = captureDialogueQuestState;
  const publicRestoreDialogueQuestState: PublicApi["restoreDialogueQuestState"] = restoreDialogueQuestState;
  const resolvedQuestDocument: ResolvedQuestDocument =
    publicResolveQuestDocument(questDocumentSpec, dialogueQuestOptions);
  const resolvedQuest: ResolvedQuest = resolvedQuestDocument.quests.tutorial;
  const resolvedQuestStage: ResolvedQuestStage = resolvedQuest.stages[0];
  const resolvedQuestObjective: ResolvedQuestObjective = resolvedQuestStage.objectives[0];
  const resolvedDialogueGraph: ResolvedDialogueGraph =
    publicResolveDialogueGraph(dialogueGraphSpec, dialogueQuestOptions);
  const resolvedDialogueNode: ResolvedDialogueNode = resolvedDialogueGraph.nodes.start;
  const resolvedDialogueChoice: ResolvedDialogueChoice = resolvedDialogueNode.choices[0];
  const resolvedQuestUpdate: ResolvedQuestUpdate = resolvedDialogueChoice.questUpdates[0];
  const questLog = publicQuestLog.create(resolvedQuestDocument);
  const questProgress: QuestProgressSnapshot = questLog.apply(questUpdateSpec);
  const questLogSnapshot: QuestLogSnapshot = questLog.snapshot();
  const dialogueSession = publicDialogueSession.create(resolvedDialogueGraph, questLog);
  const dialogueChoiceResult: DialogueChoiceResult = dialogueSession.choose("accept");
  const dialogueSessionSnapshot: DialogueSessionSnapshot = dialogueSession.snapshot();
  const dialogueUiOptions: DialogueUiOptions = { title: "Talk" };
  const dialogueUiState: UiOverlayState = publicDialogueNodeToUiOverlayState(dialogueSession, dialogueUiOptions);
  const dialogueQuestSnapshot: DialogueQuestStateSnapshot =
    publicCaptureDialogueQuestState(dialogueSession, questLog);
  const restoreDialogueQuestOptions: RestoreDialogueQuestStateOptions = {
    dialogue: dialogueSession,
    questLog,
  };
  publicRestoreDialogueQuestState(dialogueQuestSnapshot, restoreDialogueQuestOptions);
  const spriteMaterialProvider: SpriteMaterialProvider = (frame) => (frame.gameState > 0 ? "flash" : false);
  const publicNormalizeLightingScene: PublicApi["normalizeLightingScene"] = normalizeLightingScene;
  const publicDeriveTileOccludersFromTilemapGrid: PublicApi["deriveTileOccludersFromTilemapGrid"] =
    deriveTileOccludersFromTilemapGrid;
  const runtimeProfilerOptions: RuntimeProfilerOptions = {
    budget: {
      maxFrameTimeMs: 16.7,
      maxDrawCalls: 2,
    },
  };
  const runtimeProfiler = new RuntimeProfiler(runtimeProfilerOptions);
  const runtimeBudget: RuntimeDiagnosticsBudget = { maxFrameTimeMs: 16.7, maxAssetLoadElapsedMs: 250 };
  const runtimeFrameSample: RuntimeDiagnosticsFrameSample = runtimeDiagnosticsFrameSample({
    fps: 60,
    frameTimeMs: 16,
    rustUpdateTimeMs: 1,
    renderTimeMs: 2,
    entityCount: 1,
    spriteCount: 1,
    drawCalls: 1,
    batchCount: 1,
  });
  const runtimeReport: RuntimeDiagnosticsReport = runtimeProfiler.recordFrame(runtimeFrameSample);
  const runtimeSnapshot: RuntimeProfilerSnapshot = runtimeProfiler.snapshot();
  const runtimeViolation: RuntimeDiagnosticsViolation | undefined =
    evaluateRuntimeProfilerBudget(runtimeSnapshot, runtimeBudget).violations[0];
  const publicRuntimeProfiler: PublicApi["RuntimeProfiler"] = RuntimeProfiler;
  const publicRuntimeDiagnosticsFrameSample: PublicApi["runtimeDiagnosticsFrameSample"] =
    runtimeDiagnosticsFrameSample;
  const publicEvaluateRuntimeProfilerBudget: PublicApi["evaluateRuntimeProfilerBudget"] =
    evaluateRuntimeProfilerBudget;
  const snapshotEngine: Pick<
    FerrumEngine,
    "score" | "gameState" | "entityCount" | "spriteCount" | "cameraX" | "cameraY"
  > = {
    score: () => 3,
    gameState: () => 1,
    entityCount: () => 4,
    spriteCount: () => 5,
    cameraX: () => 6,
    cameraY: () => 7,
  };
  const gameStateCustom: GameStateSnapshotJsonValue = { checkpoint: "alpha" };
  const builtInShooterState: BuiltInShooterStateSnapshot = {
    format: "ferrum2d.builtin-shooter-state",
    version: 1,
    headerFloats: [0, 1, 0, 0, 400, 240],
    headerU32s: [1, 1, 3, 0, 0, 0, 0, 0],
    entityFloats: [400, 240, 0, 0, 0, 0, 0],
    entityU32s: [0, 0],
    entityCount: 1,
    floatsPerEntity: 7,
    u32sPerEntity: 2,
  };
  const publicCaptureGameStateSnapshot: PublicApi["captureGameStateSnapshot"] = captureGameStateSnapshot;
  const publicGameStateSnapshotFormat: PublicApi["GAME_STATE_SNAPSHOT_FORMAT"] = GAME_STATE_SNAPSHOT_FORMAT;
  const publicGameStateSnapshotVersion: PublicApi["GAME_STATE_SNAPSHOT_VERSION"] = GAME_STATE_SNAPSHOT_VERSION;
  const publicStringifyGameStateSnapshot: PublicApi["stringifyGameStateSnapshot"] = stringifyGameStateSnapshot;
  const publicParseGameStateSnapshot: PublicApi["parseGameStateSnapshot"] = parseGameStateSnapshot;
  const publicRestoreGameStateSnapshot: PublicApi["restoreGameStateSnapshot"] = restoreGameStateSnapshot;
  const publicSaveGameStateSnapshotToStorage: PublicApi["saveGameStateSnapshotToStorage"] =
    saveGameStateSnapshotToStorage;
  const publicLoadGameStateSnapshotFromStorage: PublicApi["loadGameStateSnapshotFromStorage"] =
    loadGameStateSnapshotFromStorage;
  const gameStateSnapshot: GameStateSnapshot = publicCaptureGameStateSnapshot(
    snapshotEngine as FerrumEngine,
    { customState: gameStateCustom },
  );
  const gameStateScene: GameStateSceneSnapshot = gameStateSnapshot.scene;
  const gameStateStorage: GameStateSnapshotStorage = {
    getItem: () => publicStringifyGameStateSnapshot(gameStateSnapshot),
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  const gameStateRestore: GameStateSnapshotRestoreResult = publicRestoreGameStateSnapshot(
    snapshotEngine as FerrumEngine,
    gameStateSnapshot,
  );
  equal(typeof publicCreateRigidBody, "function");
  equal(typeof publicPreloadAssetManifest, "function");
  equal(assetPreloadPlan.total, 3);
  equal(firstAssetPreloadEntry?.kind, "texture");
  equal(publicAssetManifestFingerprint(manifest, "release").length > 0, true);
  equal(preloadOptions.cachePolicy?.json, true);
  equal(preloadOptions.cachePolicy?.textures, true);
  equal(derivedAssetPreloadCachePolicy.version?.startsWith("game-"), true);
  equal(invalidationOptions.policy?.binary, true);
  equal(nullableAssetPreloadInvalidation, undefined);
  equal(typeof publicInvalidatePreloadedAssetCache, "function");
  equal(assetPreloadCachePolicy.binary, true);
  equal(nullablePreloadedManifest, undefined);
  equal(jsonCacheSetOptions.version, "v1");
  equal(binaryCacheSetOptions.ttlMs, 1000);
  equal(typeof jsonAssetCache.getJson, "function");
  equal(typeof binaryAssetCache.getBinary, "function");
  equal(resolvedLevelManifest.id, "world");
  equal(resolvedLevelTilemapChunk.layer, "main");
  equal(levelChunkBounds.width, 64);
  equal(levelStreamingPlan.activeChunkIds[0], "0,0");
  equal(levelStreamingPlan.assetManifest.json?.["0,0:tilemap"], "/chunks/0-0.json");
  equal(levelStreamerSnapshot.loadedChunkIds[0], "0,0");
  equal(indexedDbOptions.storeName, "json");
  equal(indexedDbOptions.binaryStoreName, "binary");
  equal(typeof publicLoadingOverlay, "function");
  equal(loadingOverlayOptions.autoHideOnComplete, true);
  equal(loadingOverlayState.status, "loading");
  equal(resolvedAnimationTimeline.initialState, "idle");
  equal(resolvedAnimationState.frames[0], "idle.0");
  equal(resolvedAnimationEvent.id, "footstep");
  equal(resolvedAnimationTransition.to, "move");
  equal(publicAnimationTimelineFrameAt(resolvedAnimationTimeline, "idle", 0.5).frame, "idle.1");
  equal(animationUpdate.events[0]?.id, "footstep");
  equal(animationUpdate.transitioned, true);
  equal(animationEmittedEvent?.frame, "idle.1");
  equal(animationSnapshot.state, "move");
  equal(resolvedSceneComposition.initialFragment, "room");
  equal(resolvedSceneCompositionPrefab.id, "enemy");
  equal(resolvedSceneCompositionVariant.id, "strong");
  equal(resolvedSceneCompositionInclude.idPrefix, "a.");
  equal(resolvedSceneCompositionFragmentInstance.prefab, "enemy");
  equal(resolvedSceneCompositionTransform.scale, 1);
  equal(resolvedSceneCompositionInstance.id, "a.enemy");
  equal(resolvedSceneCompositionInstance.x, 6);
  equal(sceneCompositionApplyResult.spawnResults[0], "a.enemy");
  equal(resolveSceneCompositionOptions.path, "scene");
  equal(typeof publicApplySceneCompositionFragment, "function");
  equal(resolvedBehaviorRecipeDocument.entities.enemy.tags[0], "hostile");
  equal(resolvedBehaviorRecipeBase.id, "living");
  equal(resolvedBehaviorRecipe.kind, "damage");
  equal(resolvedHealthBehaviorRecipe.event, "defeated");
  equal(resolvedDamageBehaviorRecipe.amount, 2);
  equal(resolvedChaseBehaviorRecipe.target, "player");
  equal(resolvedPickupBehaviorRecipe.item, "coin");
  equal(resolvedInteractionBehaviorRecipe.action, "inspect");
  equal(behaviorRecipeKind, "health");
  equal(healthBehaviorCommand.type, "configureHealth");
  equal(damageBehaviorCommand.amount, 2);
  equal(chaseBehaviorCommand.type, "configureChase");
  equal(pickupBehaviorCommand.type, "configurePickup");
  equal(interactionBehaviorCommand.type, "configureInteraction");
  equal(behaviorRecipeCommandBase.entity, "enemy");
  equal(behaviorRecipeApplyResult.results[0], "configurePickup");
  equal(behaviorRecipeSpec.kind, "damage");
  equal(behaviorRecipeResolveOptions.path, "recipes");
  equal(typeof publicApplyBehaviorRecipes, "function");
  equal(typeof publicCreatePhysicsWorldFromSpec, "function");
  equal(typeof publicCreatePhysicsReplayWorkerClient, "function");
  equal(publicPhysicsReplayWorkerRequestFormat, "ferrum2d.physics-replay.worker.request");
  equal(typeof publicCreatePixelMaskTerrain, "function");
  equal(typeof publicCreatePixelMaskTerrainRuntime, "function");
  equal(replayInputStream.frameCount, 1);
  equal(bodyCollider.type, "aabb");
  equal(material.density, 0.8);
  equal(authoringLayerSpec.player.mask[0], "world");
  equal(physicsLayerMap.player.maskBits, 2);
  equal(bodyAuthoring.material, "wood");
  equal(nullableWorld, undefined);
  equal(nullableReplayRun, undefined);
  equal(nullableWorkerReplayRun, undefined);
  equal(nullableWorkerBenchmark, undefined);
  equal(pixelMaskLayerOptions.tileWidth, 4);
  equal(pixelRuntimeOptions.texture?.textureId, 1);
  equal(nullablePixelRuntimeResult, undefined);
  equal(pixelBoundary.chainCount, 1);
  equal(nullableDirtyRect, undefined);
  equal(nullableAlphaPatch, undefined);
  equal(tilemapBoundaryChain?.collider.shape, "chain");
  equal(publicApplyTileRules(tileRuleGrid, tileRules, tileRuleOptions)[0], 2);
  equal(publicResolveAnimatedTileFrame(animatedTile, animatedTileOptions), 4);
  equal(publicBakeAnimatedTileLayer(tileRuleGrid, { 1: animatedTile }, animatedTileOptions)[0], 4);
  equal(resolvedSpriteMaterial.name, "custom");
  equal(resolvedSpriteMaterial.colorMix?.amount, resolvedSpriteMaterialColorMix.amount);
  equal(resolvedSpriteMaterial.outline?.thickness, resolvedSpriteMaterialOutline.thickness);
  equal(publicSpriteMaterialPresets.additive.blendMode, "additive");
  equal(firstSpriteMaterialPass?.kind, "outline");
  equal(typeof spriteMaterialProvider, "function");
  equal(typeof publicRuntimeProfiler, "function");
  equal(publicRuntimeDiagnosticsFrameSample(runtimeFrameSample).drawCalls, 1);
  equal(publicEvaluateRuntimeProfilerBudget(runtimeSnapshot, runtimeBudget).passed, true);
  equal(runtimeReport.passed, true);
  equal(runtimeViolation, undefined);
  equal(publicGameStateSnapshotFormat, "ferrum2d.game-state.snapshot");
  equal(publicGameStateSnapshotVersion, 1);
  equal(gameStateSnapshot.format, GAME_STATE_SNAPSHOT_FORMAT);
  equal(gameStateScene.score, 3);
  equal(publicParseGameStateSnapshot(publicStringifyGameStateSnapshot(gameStateSnapshot)).version, 1);
  publicSaveGameStateSnapshotToStorage(gameStateStorage, "slot", gameStateSnapshot);
  equal(publicLoadGameStateSnapshotFromStorage(gameStateStorage, "slot")?.snapshotHash, gameStateSnapshot.snapshotHash);
  equal(gameStateRestore.customStateApplied, false);
  equal(gameStateRestore.builtInShooterStateApplied, false);
  const asepriteImportOptions: AsepriteAtlasImportOptions = { texture: "sprites" };
  const publicImportAsepriteAtlas: PublicApi["importAsepriteAtlas"] = importAsepriteAtlas;
  const asepriteImportResult: AsepriteAtlasImportResult = publicImportAsepriteAtlas({
    frames: {
      "player.png": { frame: { x: 0, y: 0, w: 16, h: 16 } },
    },
    meta: { size: { w: 32, h: 32 } },
  }, asepriteImportOptions);
  const publicImportAsepriteAtlasFrames: PublicApi["importAsepriteAtlasFrames"] = importAsepriteAtlasFrames;
  const tiledImportOptions: TiledTilemapImportOptions = {
    externalTilesets: {
      "terrain.tsx": {
        name: "terrain",
        imagewidth: 8,
        imageheight: 8,
        tilewidth: 8,
        tileheight: 8,
        columns: 1,
        tilecount: 1,
      },
    },
    frameNameForGid: (context: TiledTilesetFrameContext) => `${context.tilesetName}.${context.localId}`,
    decodeCompressedLayerData: (bytes: Uint8Array, context: TiledLayerCompressionContext) => {
      equal(context.compression.length > 0, true);
      return bytes;
    },
  };
  const tiledLayerDataDecoder: TiledLayerDataDecoder = tiledImportOptions.decodeCompressedLayerData!;
  const publicImportTiledTilemap: PublicApi["importTiledTilemap"] = importTiledTilemap;
  const tiledImportResult: TiledTilemapImportResult = publicImportTiledTilemap({
    orientation: "orthogonal",
    width: 1,
    height: 1,
    tilewidth: 8,
    tileheight: 8,
    tilesets: [{
      firstgid: 1,
      source: "terrain.tsx",
    }],
    layers: [{ type: "tilelayer", width: 1, height: 1, data: [1] }],
  }, tiledImportOptions);
  const publicImportTiledGameSpec: PublicApi["importTiledGameSpec"] = importTiledGameSpec;
  const ldtkImportOptions: LDtkTilemapImportOptions = {
    externalLevels: {},
    frameNameForTile: (context: LDtkTilesetFrameContext) => `${context.tilesetIdentifier}.${context.ldtkTileId}`,
  };
  const publicImportLDtkTilemap: PublicApi["importLDtkTilemap"] = importLDtkTilemap;
  const ldtkImportResult: LDtkTilemapImportResult = publicImportLDtkTilemap({
    defs: {
      tilesets: [{
        uid: 1,
        identifier: "terrain",
        pxWid: 8,
        pxHei: 8,
        tileGridSize: 8,
      }],
    },
    levels: [{
      identifier: "Level_0",
      pxWid: 8,
      pxHei: 8,
      layerInstances: [{
        __identifier: "ground",
        __type: "Tiles",
        __cWid: 1,
        __cHei: 1,
        __gridSize: 8,
        __tilesetDefUid: 1,
        gridTiles: [{ px: [0, 0], src: [0, 0], t: 0, f: 0 }],
      }, {
        __identifier: "actors",
        __type: "Entities",
        __gridSize: 8,
        entityInstances: [{
          __identifier: "Spawn",
          px: [0, 0],
          width: 8,
          height: 8,
          fieldInstances: [{
            __identifier: "role",
            __type: "String",
            __value: "player",
          }],
        }],
      }],
    }],
  }, ldtkImportOptions);
  const firstLDtkEntity: LDtkEntityInstance | undefined = ldtkImportResult.entities[0];
  const publicImportLDtkGameSpec: PublicApi["importLDtkGameSpec"] = importLDtkGameSpec;
  const lifecycleHooks: EngineLifecycleHooks = {
    onStart: (snapshot: EngineLifecycleSnapshot) => {
      equal(snapshot.gameState >= 0, true);
    },
    onDestroy: (snapshot) => {
      equal(snapshot.entityCount >= 0, true);
    },
  };
  const options: CreateEngineOptions = {
    includeDeprecatedRenderCommands: false,
    useWorkerClock: true,
    includeAudioEvents: true,
    includeCollisionEvents: true,
    enablePhysicsDebugLines: true,
    includePhysicsDebugLines: true,
    physicsDebugOptions: { colliders: true, contacts: true },
    fixedTimestep: { stepSeconds: 1 / 60, maxFrameSeconds: 0.25, maxStepsPerUpdate: 8 },
    physicsMode: "rigid",
    lifecycle: lifecycleHooks,
  };
  const fixedTimestepOptions: FixedTimestepOptions = { enabled: true, stepSeconds: 1 / 120 };
  const rendererOptions: CreateRendererOptions = {
    preferred: "webgpu",
    fallbackBehavior: "silent",
    webgpu: { powerPreference: "high-performance" },
    onFallback: (info: RendererFallbackInfo) => {
      equal(info.fallback, "webgl2");
    },
  };
  const webgpuOptions: WebGPURendererOptions = {
    clearColor: [0, 0, 0, 1],
    fallbackAdapter: false,
    lighting: lightingScene,
    postProcess: postProcessStackInput,
  };
  const webgl2Options: WebGL2RendererOptions = {
    clearColor: [0, 0, 0, 1],
    preserveDrawingBuffer: true,
    lighting: lightingScene,
    postProcess: postProcessStackInput,
  };
  const physicsDebugLineCamera: PhysicsDebugLineCamera = { x: 0, y: 0 };
  const inputManagerOptions: InputManagerOptions = {
    gamepad: true,
    gamepadDeadzone: 0.3,
    gamepadMapping: {
      moveXAxis: 0,
      moveYAxis: 1,
      actionButtons: [0, 2],
      menuButtons: [9],
      pointerButtons: [5, 7],
    },
    pointerGestures: true,
    pointerGestureThreshold: 16,
  };
  const gamepadMapping: GamepadInputMapping = inputManagerOptions.gamepadMapping ?? {};
  const inputDigitalControl: InputDigitalControl = "space";
  const inputActionBinding: InputActionBinding = { control: inputDigitalControl };
  const inputAxisBinding: InputAxisBinding = { negative: "left", positive: "right" };
  const inputActionProfile: InputActionProfile = {
    actions: {
      left: [{ control: "a" }],
      right: [{ control: "d" }],
      fire: [inputActionBinding, { virtualButton: "fire" }],
    },
    axes: {
      horizontal: inputAxisBinding,
    },
  };
  const publicResolveInputActionState: PublicApi["resolveInputActionState"] = resolveInputActionState;
  const publicDefaultInputActionProfile: PublicApi["DEFAULT_INPUT_ACTION_PROFILE"] = DEFAULT_INPUT_ACTION_PROFILE;
  const publicTopdownInputActionProfile: PublicApi["TOPDOWN_SHOOTER_INPUT_ACTION_PROFILE"] =
    TOPDOWN_SHOOTER_INPUT_ACTION_PROFILE;
  const publicPlatformerInputActionProfile: PublicApi["PLATFORMER_INPUT_ACTION_PROFILE"] =
    PLATFORMER_INPUT_ACTION_PROFILE;
  const publicBreakoutInputActionProfile: PublicApi["BREAKOUT_INPUT_ACTION_PROFILE"] =
    BREAKOUT_INPUT_ACTION_PROFILE;
  const publicInputActionProfiles: PublicApi["INPUT_ACTION_PROFILES"] = INPUT_ACTION_PROFILES;
  const inputActionProfileId: InputActionProfileId = "topdownShooter";
  const virtualJoystickOptions: VirtualJoystickOptions = { deadzone: 0.25, maxDistance: 48 };
  const virtualButtonOptions: VirtualButtonOptions = { id: "fire", label: "Fire", controls: ["space"], virtualButton: "fire" };
  const virtualControlsOptions: VirtualControlsOptions = {
    joystick: virtualJoystickOptions,
    buttons: [virtualButtonOptions],
  };
  const virtualControlsState: VirtualControlsState = {
    w: false,
    a: false,
    s: false,
    d: true,
    buttons: { fire: true },
    virtualButtons: { fire: true },
  };
  const publicVirtualControls: PublicApi["VirtualControls"] = VirtualControls;
  const publicDefaultVirtualControlButtons: PublicApi["DEFAULT_VIRTUAL_CONTROL_BUTTONS"] =
    DEFAULT_VIRTUAL_CONTROL_BUTTONS;
  const publicApplyVirtualControlStateToSnapshot: PublicApi["applyVirtualControlStateToSnapshot"] =
    applyVirtualControlStateToSnapshot;
  const inputActionState: InputActionState = publicResolveInputActionState(
    {
      w: false,
      a: false,
      s: false,
      d: true,
      space: false,
      enter: false,
      mouseLeft: false,
      mouseX: 0,
      mouseY: 0,
    },
    inputActionProfile,
    { virtualButtons: { fire: true } },
  );
  const virtualInputSnapshot = publicApplyVirtualControlStateToSnapshot({
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
    enter: false,
    mouseLeft: false,
    mouseX: 0,
    mouseY: 0,
  }, virtualControlsState, [virtualButtonOptions]);
  const hudThemeName: HudThemePresetName = "high-contrast";
  const hudThemeInput: HudThemeInput = { textColor: "#ffffff" };
  const hudThemeTokens: HudThemeTokens = {
    ...HUD_THEME_PRESETS.dark,
    textColor: "#ffffff",
  };
  const publicHudThemePresets: PublicApi["HUD_THEME_PRESETS"] = HUD_THEME_PRESETS;
  const publicResolveHudTheme: PublicApi["resolveHudTheme"] = resolveHudTheme;
  const publicCreateHudOverlayState: PublicApi["createHudOverlayState"] = createHudOverlayState;
  const resolvedHudTheme: ResolvedHudThemeTokens = publicResolveHudTheme(hudThemeInput);
  const accessibilityReducedMotion: AccessibilityReducedMotionPreference = "system";
  const accessibilityPaletteName: AccessibilityContrastPaletteName = "deuteranopia";
  const accessibilityColorRole: AccessibilityContrastColorRole = "focus";
  const accessibilityInputAssist: AccessibilityInputAssistSpec = { holdToToggleActions: ["fire"] };
  const accessibilityPaletteSpec: AccessibilityContrastPaletteSpec = {
    id: "custom",
    colors: { [accessibilityColorRole]: "#ffffff" },
  };
  const accessibilitySpec: AccessibilityOptionsSpec = {
    reducedMotion: accessibilityReducedMotion,
    subtitles: true,
    contrastPalette: accessibilityPaletteName,
    inputAssist: accessibilityInputAssist,
  };
  const accessibilityEnvironment: AccessibilityEnvironment = { prefersReducedMotion: true };
  const accessibilityMediaQueryList: AccessibilityMediaQueryListLike = { matches: true };
  const accessibilityMediaQuerySource: AccessibilityMediaQuerySource = {
    matchMedia: () => accessibilityMediaQueryList,
  };
  const resolveAccessibilityOptionsOptions: ResolveAccessibilityOptionsOptions = {
    environment: accessibilityEnvironment,
  };
  const accessibilitySubtitleSpec: AccessibilitySubtitleSpec = {
    speaker: "Guide",
    text: "Move carefully.",
  };
  const accessibilitySubtitleOptions: AccessibilitySubtitlePanelOptions = {
    accessibility: accessibilitySpec,
  };
  const publicAccessibilityPalettes: PublicApi["ACCESSIBILITY_CONTRAST_PALETTES"] =
    ACCESSIBILITY_CONTRAST_PALETTES;
  const publicReadAccessibilityEnvironment: PublicApi["readAccessibilityEnvironment"] =
    readAccessibilityEnvironment;
  const publicResolveAccessibilityOptions: PublicApi["resolveAccessibilityOptions"] =
    resolveAccessibilityOptions;
  const publicResolveAccessibilityContrastPalette: PublicApi["resolveAccessibilityContrastPalette"] =
    resolveAccessibilityContrastPalette;
  const publicResolveAccessibilityHudTheme: PublicApi["resolveAccessibilityHudTheme"] =
    resolveAccessibilityHudTheme;
  const publicApplyAccessibilityToCameraRigSpec: PublicApi["applyAccessibilityToCameraRigSpec"] =
    applyAccessibilityToCameraRigSpec;
  const publicApplyAccessibilityToScreenFadeSpec: PublicApi["applyAccessibilityToScreenFadeSpec"] =
    applyAccessibilityToScreenFadeSpec;
  const publicAccessibilitySubtitlePanel: PublicApi["accessibilitySubtitlePanel"] =
    accessibilitySubtitlePanel;
  const resolvedAccessibilityOptions: ResolvedAccessibilityOptions =
    publicResolveAccessibilityOptions(accessibilitySpec, resolveAccessibilityOptionsOptions);
  const resolvedAccessibilityPalette: ResolvedAccessibilityContrastPalette =
    publicResolveAccessibilityContrastPalette(accessibilityPaletteSpec);
  const resolvedAccessibilityInputAssist: ResolvedAccessibilityInputAssist =
    resolvedAccessibilityOptions.inputAssist;
  const accessibilityHudTheme: ResolvedHudThemeTokens =
    publicResolveAccessibilityHudTheme(resolvedAccessibilityOptions);
  const accessibilityCameraSpec: CameraRigSpec =
    publicApplyAccessibilityToCameraRigSpec({ smoothTimeSeconds: 0.2 }, resolvedAccessibilityOptions);
  const accessibilityFadeSpec: ScreenFadeTransitionSpec =
    publicApplyAccessibilityToScreenFadeSpec({ durationSeconds: 0.8 }, resolvedAccessibilityOptions);
  const accessibilitySubtitlePanelState: UiPanel | undefined =
    publicAccessibilitySubtitlePanel(accessibilitySubtitleSpec, accessibilitySubtitleOptions);
  const detectedAccessibilityEnvironment: AccessibilityEnvironment =
    publicReadAccessibilityEnvironment(accessibilityMediaQuerySource);
  const uiOverlayTone: UiOverlayTone = "accent";
  const uiOverlayActionTone: UiOverlayActionTone = "primary";
  const uiOverlayRegion: UiOverlayRegion = "top-right";
  const uiMeter: UiMeter = { value: 3, max: 5 };
  const uiTextLine: UiTextLine = {
    id: "hp",
    label: "HP",
    value: "60%",
    tone: uiOverlayTone,
    meter: uiMeter,
  };
  const uiAction: UiAction = {
    id: "pause",
    label: "Pause",
    ariaLabel: "Pause game",
    tone: uiOverlayActionTone,
  };
  const uiPanel: UiPanel = {
    id: "hud",
    title: "HUD",
    region: uiOverlayRegion,
    ariaLive: "polite",
    lines: [uiTextLine],
    actions: [uiAction],
  };
  const uiDialog: UiDialog = {
    id: "pause",
    title: "Paused",
    actions: [uiAction],
  };
  const hudComponentBase: HudComponentBase = { id: "hp", label: "HP" };
  const hudMeterSpec: HudMeterSpec = { ...hudComponentBase, type: "meter", value: 3, max: 5 };
  const hudCounterSpec: HudCounterSpec = { id: "score", type: "counter", value: 12 };
  const hudPromptSpec: HudPromptSpec = { id: "start", type: "prompt", text: "Press Start", action: uiAction };
  const hudMessageSpec: HudMessageSpec = { id: "hint", type: "message", text: "Ready" };
  const hudComponentSpec: HudComponentSpec = hudMeterSpec;
  const createHudOptions: CreateHudOverlayStateOptions = {
    panelId: "game-hud",
    title: "Stats",
    region: uiOverlayRegion,
  };
  const hudOverlayState: UiOverlayState =
    publicCreateHudOverlayState([hudMeterSpec, hudCounterSpec, hudPromptSpec, hudMessageSpec], createHudOptions);
  const uiOptions: UiOverlayOptions = {
    theme: hudThemeName,
    onAction: (event: UiOverlayActionEvent) => {
      equal(event.id.length > 0, true);
    },
  };
  const uiState: UiOverlayState = {
    panels: [uiPanel],
    dialog: uiDialog,
  };
  const uiStateProvider: UiOverlayStateProvider = () => uiState;
  const runtimeEnvironment: FerrumRuntimeEnvironment = "production";
  const runtimeOptions: FerrumRuntimeOptions = {
    canvas: {} as HTMLCanvasElement,
    rendererPreference: "webgpu",
    webgl2: webgl2Options,
    webgpu: webgpuOptions,
    inputOptions: inputManagerOptions,
    ui: uiOptions,
    uiState: uiStateProvider,
    environment: runtimeEnvironment,
    debug: false,
    profiler: runtimeProfilerOptions,
    lighting: lightingSceneProvider,
    postProcess: postProcessProvider,
    physicsDebugLines: true,
    physicsMode: "arcade",
    onFrame: (runtimeFrame: FerrumRuntimeFrame) => {
      equal(runtimeFrame.rendererStats.drawCalls >= 0, true);
      equal(runtimeFrame.rendererStats.physicsDebugLineCount >= 0, true);
      equal(runtimeFrame.rendererStats.pointLightCount >= 0, true);
    },
  };
  const gameSpec: ShooterGameSpec = {
    world: { width: 1600, height: 960 },
    player: { speed: 180 },
    atlas: {
      frames: {
        bullet: {
          texture: "bullet",
          uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
          size: { width: 8, height: 8 },
        },
      },
    },
    prefabs: {
      bullet: {
        frame: "bullet",
        collider: {
          halfWidth: 4,
          halfHeight: 3,
          offset: { x: 1, y: -1 },
          material: { friction: 0.8, surfaceVelocity: { x: 2 } },
        },
      },
    },
    tilemap: {
      tileWidth: 32,
      tileHeight: 32,
      tiles: {
        "1": { frame: "bullet", color: [1, 1, 1, 1], slope: { x0: 0, y0: 1, x1: 1, y1: 0 } },
      },
      layers: [{ columns: 1, rows: 1, collision: true, collisionOnly: false, data: [1] }],
    },
    camera: { preset: "look-ahead", lookAhead: { distance: 96 } },
    postProcessing: postProcessConfigInput,
    enemies: {
      orbit: { radius: 180, radialBand: 24 },
      presets: { bruiser: { health: 4, scoreReward: 8 } },
      waves: [{ enemy: "bruiser", duration: 12, spawnInterval: 1, enemyCount: 6 }],
    },
    audio: { masterVolume: 0.9, sfxVolume: 0.7, events: { shoot: { volume: 0.3, pitch: 1.1 } } },
    physics: {
      mode: "rigid",
      gravity: [0, 700],
      materials: { wood: { friction: 0.6, restitution: 0.2, density: 0.8 } },
      layers: { player: { mask: ["world"] }, world: { mask: ["player"] } },
      bodies: {
        crate: {
          type: "dynamic",
          position: [320, 120],
          material: "wood",
          layer: "world",
          collider: { shape: "box", size: [32, 32] },
        },
      },
      joints: {
        hinge: { type: "revolute", bodyA: "world", bodyB: "crate", anchor: [320, 120] },
      },
      debug: { colliders: true },
    },
  };
  const physicsMode: PhysicsMode = gameSpec.physics?.mode ?? "arcade";
  const physicsSpec: PhysicsSpec = gameSpec.physics ?? {};
  const physicsLayerSpec: PhysicsLayerSpec = physicsSpec.layers?.player ?? {};
  const physicsDebugSpec: PhysicsDebugSpec = typeof physicsSpec.debug === "object" ? physicsSpec.debug : {};
  const physicsDebugOptions: PhysicsDebugOptions = physicsDebugSpec;
  const cameraPreset: ShooterCameraPreset = "look-ahead";
  const cameraSpec: ShooterCameraSpec = { preset: cameraPreset };
  const atlasSpec: ShooterAtlasSpec = gameSpec.atlas ?? {};
  const atlasFrameSpec: ShooterAtlasFrameSpec = atlasSpec.frames?.bullet ?? {};
  const atlasAnimationStateSpec: ShooterAtlasAnimationStateSpec = { frames: ["bullet"], fps: 1 };
  const atlasAnimationSpec: ShooterAtlasAnimationSpec = { idle: atlasAnimationStateSpec };
  const prefabColliderSpec: ShooterPrefabColliderSpec = gameSpec.prefabs?.bullet?.collider ?? {};
  const prefabColliderType: ShooterPrefabColliderType = prefabColliderSpec.type ?? "aabb";
  const physicsMaterialSpec: ShooterPhysicsMaterialSpec = prefabColliderSpec.material ?? {};
  const enemyPresetSpec: ShooterEnemyPresetSpec = gameSpec.enemies?.presets?.bruiser ?? {};
  const enemyOrbitSpec: ShooterEnemyOrbitSpec = gameSpec.enemies?.orbit ?? {};
  const orbitEnemyPresetSpec: ShooterEnemyPresetSpec = { behavior: "orbit", speed: 84 };
  const waveSpec: ShooterWaveSpec = gameSpec.enemies?.waves?.[0] ?? {};
  const tilemapSpec: ShooterTilemapSpec = gameSpec.tilemap ?? {};
  const tileSpec: ShooterTileSpec = tilemapSpec.tiles?.["1"] ?? {};
  const tileSlopeSpec: ShooterTileSlopeSpec = tileSpec.slope ?? { x0: 0, y0: 1, x1: 1, y1: 0 };
  const tileLayerSpec: ShooterTileLayerSpec = tilemapSpec.layers?.[0] ?? {};
  const audioBusConfig: AudioBusConfig = { masterVolume: 0.9, sfxVolume: 0.7 };
  const audioBus: AudioBus = "bgm";
  const audioManagerConfig: AudioManagerConfig = { masterVolume: 0.9, bgmVolume: 0.2, uiVolume: 0.4 };
  const playBgmOptions: PlayBgmOptions = { volume: 0.8, loop: true, fadeInSeconds: 0.5, fadeMs: 500 };
  const stopBgmOptions: StopBgmOptions = { fadeOutSeconds: 0.25, fadeMs: 250 };
  const spatialAudioOptions: SpatialAudioOptions = { x: 1, y: 2, z: 0 };
  const audioManagerState: AudioManagerState = {
    masterVolume: 0.9,
    bgmVolume: 0.2,
    sfxVolume: 0.7,
    uiVolume: 0.4,
    bgmPlaying: false,
    bgmLoop: false,
  };
  const diagnosticCode: DiagnosticCode = "FERRUM_ASSET_LOAD";
  const diagnosticContext: DiagnosticContext = {
    kind: "texture",
    name: "player",
    url: "/assets/player.png",
    detail: "HTTP 404 Not Found",
  };
  const diagnosticReport: DiagnosticReport = {
    code: diagnosticCode,
    message: "Asset load error",
    context: diagnosticContext,
  };
  const debugGizmoCategory: DebugGizmoCategory = "collider";
  const debugGizmoColor: DebugGizmoColor = [1, 0, 0, 0.75];
  const resolvedDebugGizmoColor: ResolvedDebugGizmoColor = [1, 0, 0, 0.75];
  const debugGizmoPoint: DebugGizmoPoint = { x: 0, y: 0 };
  const debugGizmoPath: DebugGizmoPathSpec = {
    id: "route",
    points: [debugGizmoPoint, { x: 8, y: 0 }],
    color: debugGizmoColor,
  };
  const debugGizmoSpawn: DebugGizmoSpawnSpec = { id: "spawn", x: 4, y: 4 };
  const debugGizmoBounds: DebugGizmoBoundsSpec = { id: "hitbox", x: 0, y: 0, width: 8, height: 8 };
  const debugGizmoScene: DebugGizmoSceneSpec = {
    paths: [debugGizmoPath],
    spawns: [debugGizmoSpawn],
    colliders: [debugGizmoBounds],
  };
  const debugGizmoOptions: DebugGizmoOptions = { categories: { [debugGizmoCategory]: true } };
  const publicBuildDebugGizmoLines: PublicApi["buildDebugGizmoLines"] = buildDebugGizmoLines;
  const publicDebugGizmoLinesToBuffer: PublicApi["debugGizmoLinesToBuffer"] = debugGizmoLinesToBuffer;
  const publicBuildDebugGizmoLineBuffer: PublicApi["buildDebugGizmoLineBuffer"] =
    buildDebugGizmoLineBuffer;
  const debugGizmoLines: readonly DebugGizmoLine[] =
    publicBuildDebugGizmoLines(debugGizmoScene, debugGizmoOptions);
  const firstDebugGizmoLine: DebugGizmoLine = debugGizmoLines[0] as DebugGizmoLine;
  const debugGizmoLineBufferResult: DebugGizmoLineBufferResult =
    publicBuildDebugGizmoLineBuffer(debugGizmoScene);
  const debugGizmoLineBuffer = publicDebugGizmoLinesToBuffer(debugGizmoLines);
  const resolvedTileDefinition: ResolvedShooterTileDefinition = {
    id: 1,
    frame: { name: "bullet", texture: "bullet", width: 8, height: 8, u0: 0, v0: 0, u1: 1, v1: 1 },
    color: [1, 1, 1, 1],
    slope: { x0: 0, y0: 1, x1: 1, y1: 0 },
  };
  const resolvedAtlasAnimationState: ResolvedShooterAtlasAnimationState = {
    frames: [resolvedTileDefinition.frame],
    fps: 1,
  };
  const resolvedAtlasAnimation: ResolvedShooterAtlasAnimation = {
    texture: "bullet",
    width: 8,
    height: 8,
    idle: resolvedAtlasAnimationState,
    move: resolvedAtlasAnimationState,
  };
  const resolvedTileSlope: ResolvedShooterTileSlopeDefinition = resolvedTileDefinition.slope ?? {
    x0: 0,
    y0: 1,
    x1: 1,
    y1: 0,
  };
  const resolvedTilemap: ResolvedShooterTilemap = { tiles: [resolvedTileDefinition], layers: [] };
  const resolvedPhysicsMaterial: ResolvedShooterPhysicsMaterial = {
    restitution: 0,
    friction: 0.8,
    surfaceVelocityX: 2,
    surfaceVelocityY: 0,
    density: 1,
    contactBaumgarteBiasScale: 1,
    maxContactBaumgarteBiasVelocityScale: 1,
    contactPositionCorrectionScale: 1,
    contactPositionCorrectionSlopScale: 1,
  };
  const resolvedPrefabColliderBase: ResolvedShooterPrefabColliderBase = {
    type: "aabb",
    offsetX: 1,
    offsetY: -1,
    enabled: true,
    trigger: true,
    material: resolvedPhysicsMaterial,
  };
  const resolvedPrefabColliderVertex: ResolvedShooterPrefabColliderVertex = { x: -2, y: -1 };
  const resolvedPrefabCollider: ResolvedShooterPrefabCollider = {
    ...resolvedPrefabColliderBase,
    type: "aabb",
    halfWidth: 4,
    halfHeight: 3,
  };
  const atlasSprite: AtlasSpriteInput = { name: "compat", width: 8, height: 8 };
  const atlasPlacement: AtlasSpritePlacement = {
    name: atlasSprite.name,
    x: 0,
    y: 0,
    width: atlasSprite.width,
    height: atlasSprite.height,
    u0: 0,
    v0: 0,
    u1: 1,
    v1: 1,
  };
  const atlasLayoutFn: typeof generateTextureAtlasLayout = (() => ({
    width: 8,
    height: 8,
    sprites: [atlasPlacement],
  })) as typeof generateTextureAtlasLayout;
  const publicPackTextureAtlas: PublicApi["packTextureAtlas"] = packTextureAtlas;
  const publicTextureAtlasDocumentToShooterAtlas: PublicApi["textureAtlasDocumentToShooterAtlas"] =
    textureAtlasDocumentToShooterAtlas;
  const publicTextureAtlasPackFormat: PublicApi["TEXTURE_ATLAS_PACK_FORMAT"] = TEXTURE_ATLAS_PACK_FORMAT;
  const atlasPackInput: TextureAtlasPackInput = { name: "hero", source: "hero.png", width: 16, height: 16 };
  const atlasPackOptions: TextureAtlasPackOptions = { texture: "packed", padding: 1 };
  const atlasLayout: TextureAtlasLayout = atlasLayoutFn([atlasSprite]);
  const packedAtlasDocument: PackedTextureAtlasDocument =
    publicPackTextureAtlas([atlasPackInput], atlasPackOptions);
  const packedAtlasFrame: PackedTextureAtlasFrame = packedAtlasDocument.placements[0];
  const packedShooterAtlas: ShooterAtlasSpec =
    publicTextureAtlasDocumentToShooterAtlas(packedAtlasDocument);
  const screenshotCaptureSpec: ScreenshotCaptureSpec = {
    name: "Topdown Title",
    comparison: { maxAverageColorDelta: 0.01 },
  };
  const publicScreenshotCaptureSummaryFormat: PublicApi["SCREENSHOT_CAPTURE_SUMMARY_FORMAT"] =
    SCREENSHOT_CAPTURE_SUMMARY_FORMAT;
  const publicScreenshotCaptureSummaryVersion: PublicApi["SCREENSHOT_CAPTURE_SUMMARY_VERSION"] =
    SCREENSHOT_CAPTURE_SUMMARY_VERSION;
  const publicResolveScreenshotCaptureSpec: PublicApi["resolveScreenshotCaptureSpec"] =
    resolveScreenshotCaptureSpec;
  const publicSummarizeScreenshotPixels: PublicApi["summarizeScreenshotPixels"] =
    summarizeScreenshotPixels;
  const publicAssertScreenshotCaptureSummary: PublicApi["assertScreenshotCaptureSummary"] =
    assertScreenshotCaptureSummary;
  const publicCompareScreenshotSummaries: PublicApi["compareScreenshotSummaries"] =
    compareScreenshotSummaries;
  const resolvedScreenshotCaptureSpec: ResolvedScreenshotCaptureSpec =
    publicResolveScreenshotCaptureSpec(screenshotCaptureSpec);
  const screenshotColorSummary: ScreenshotColorSummary = { r: 1, g: 1, b: 1, a: 1 };
  const screenshotSummary: ScreenshotPixelSummary = publicSummarizeScreenshotPixels(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
  );
  const screenshotThreshold: ScreenshotComparisonThreshold = { maxAverageColorDelta: 0 };
  const screenshotComparison: ScreenshotComparisonReport =
    publicCompareScreenshotSummaries(screenshotSummary, screenshotSummary, screenshotThreshold);
  const assertedScreenshotSummary: ScreenshotPixelSummary =
    publicAssertScreenshotCaptureSummary(screenshotSummary, resolvedScreenshotCaptureSpec);
  const webGpuCreate: typeof WebGPURenderer.create = async () => {
    throw new Error("WebGPU compatibility shim");
  };
  const nullableCreatedRenderer: CreatedRenderer | undefined = undefined;
  const nullableRuntimeRenderer: FerrumRuntimeRenderer | undefined = undefined;
  const runtimeCreate: typeof createFerrumRuntime = async () => ({
    engine: {} as FerrumEngine,
    renderer: {} as FerrumRuntime["renderer"],
    input: {} as FerrumRuntime["input"],
    assetHost: {} as AssetHost,
    start: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    stop: () => undefined,
    destroy: () => undefined,
  });

  const onFrame: FrameHandler = (frame: FrameState) => {
    const commandCount = frame.renderCommandBuffer.commandCount;
    equal(commandCount >= 0, true);
    equal(frame.physics.fixedSteps >= 0, true);
    equal(frame.collisionEventBuffer.eventCount >= 0, true);
    equal(frame.physicsDebugLineBuffer.lineCount >= 0, true);
  };
  const physicsStats: PhysicsFrameStats = {
    mode: "arcade",
    gravityX: 0,
    gravityY: 0,
    continuous: false,
    fixedTimestepEnabled: true,
    fixedStepSeconds: 1 / 60,
    fixedSteps: 1,
    fixedAlpha: 0.25,
    fixedConsumedSeconds: 1 / 60,
    fixedDroppedSeconds: 0,
    kinematicMoves: 0,
    kinematicHits: 0,
    kinematicEntityHits: 0,
    kinematicTileHits: 0,
    solidCandidateChecks: 0,
    tileCandidateChecks: 0,
    collisionPairs: 1,
    collisionSolidPairs: 1,
    collisionTriggerPairs: 0,
    collisionEnterEvents: 1,
    collisionStayEvents: 0,
    collisionExitEvents: 0,
    collisionHitEvents: 0,
    collisionTriggerEnterEvents: 0,
    collisionTriggerStayEvents: 0,
    collisionTriggerExitEvents: 0,
    collisionEventCount: 1,
    ccdChecks: 0,
    ccdHits: 0,
    sleepingBodies: 0,
    brokenJoints: 0,
  };
  const rigidBodyStepOptions: PhysicsRigidBodyStepOptions = {
    gravityY: 980,
    velocityIterations: 6,
    contactSplitImpulse: true,
  };
  const rigidBodyStepStats: PhysicsRigidBodyStepStats = {
    substeps: 1,
    dynamicBodies: 1,
    angularBodies: 1,
    islandCount: 1,
    islandBodies: 2,
    activeIslands: 1,
    sleepingIslands: 0,
    largestIslandBodies: 2,
    contactChecks: 1,
    velocityImpulses: 2,
    contactBlockSolves: 0,
    baumgarteVelocityBiases: 1,
    splitVelocityImpulses: 0,
    restitutionVelocityThresholdSkips: 0,
    warmStartImpulses: 0,
    contactCacheEntries: 1,
    sleepingBodies: 0,
    bodiesPutToSleep: 0,
    bodiesWoken: 0,
    islandsWoken: 0,
    islandsPutToSleep: 0,
    ccdChecks: 0,
    ccdHits: 0,
    positionCorrections: 1,
    splitPositionCorrections: 0,
    constraintVelocityCorrections: 0,
    constraintPositionCorrections: 0,
    brokenJoints: 0,
  };
  const rigidBodyType: PhysicsRigidBodyType = "dynamic";
  const colliderType: PhysicsColliderType = "aabb";
  const edgeColliderType: PhysicsColliderType = "edge";
  const chainColliderType: PhysicsColliderType = "chain";
  const collisionLayer: PhysicsCollisionLayer = "player";
  const rigidBodyMaterial: PhysicsRigidBodyMaterial = {
    restitution: 0.1,
    friction: 0.6,
    surfaceVelocityX: 0,
    surfaceVelocityY: 0,
    density: 1.2,
  };
  const colliderMaterial: PhysicsRigidBodyMaterial = {
    friction: 0.8,
    surfaceVelocityX: 2,
  };
  const colliderMaterialSnapshot: PhysicsMaterialSnapshot = {
    restitution: 0.1,
    friction: 0.8,
    surfaceVelocityX: 2,
    surfaceVelocityY: 0,
    density: 1.2,
    contactBaumgarteBiasScale: 1,
    maxContactBaumgarteBiasVelocityScale: 1,
    contactPositionCorrectionScale: 1,
    contactPositionCorrectionSlopScale: 1,
  };
  const rigidBodyMassProperties: PhysicsRigidBodyMassProperties = {
    mass: 2,
    inertia: 8,
  };
  const rigidBodyTuning: PhysicsRigidBodyTuning = {
    gravityScale: 0.75,
    linearDamping: 0.1,
  };
  const rigidBodyCollider: PhysicsRigidBodyCollider = {
    type: colliderType,
    halfWidth: 8,
    halfHeight: 6,
    offsetX: 1,
  };
  const edgeRigidBodyCollider: PhysicsRigidBodyCollider = {
    type: "edge",
    startX: -16,
    startY: 0,
    endX: 16,
    endY: 0,
  };
  const chainRigidBodyCollider: PhysicsRigidBodyCollider = {
    type: "chain",
    vertices: [0, 0, 16, 0, 16, 16],
    loop: false,
  };
  const rigidBodySpawnOptions: PhysicsRigidBodySpawnOptions = {
    x: 10,
    y: 20,
    bodyType: rigidBodyType,
    collider: rigidBodyCollider,
    layer: collisionLayer,
    velocityX: 4,
    material: rigidBodyMaterial,
    colliderMaterial,
  };
  const bodyColliderOptions: PhysicsBodyColliderOptions = {
    collider: {
      type: "circle",
      radius: 4,
      offsetY: 2,
    },
    layer: collisionLayer,
    isTrigger: true,
  };
  const bodyColliderSnapshot: PhysicsBodyColliderSnapshot = {
    colliderIndex: 1,
    colliderType: "circle",
    colliderEnabled: true,
    colliderIsTrigger: true,
    colliderOffsetX: 0,
    colliderOffsetY: 2,
    colliderMaterialOverride: true,
    colliderMaterial: colliderMaterialSnapshot,
    categoryBits: 1,
    maskBits: 0xffffffff,
  };
  const physicsEntityHandle: PhysicsEntityHandle = {
    entityId: 9,
    entityGeneration: 0,
  };
  const physicsEntitySnapshot: PhysicsEntitySnapshot = {
    ...physicsEntityHandle,
    x: 10,
    y: 20,
    velocityX: 4,
    velocityY: 0,
    rotationRadians: 0,
    angularVelocityRadiansPerSecond: 0,
    bodyType: rigidBodyType,
    bodyEnabled: true,
    isSleeping: false,
    colliderType,
    colliderEnabled: true,
    colliderIsTrigger: false,
    colliderOffsetX: 1,
    colliderOffsetY: 0,
    colliderMaterialOverride: true,
    colliderMaterial: colliderMaterialSnapshot,
    mass: 2,
    inverseMass: 0.5,
    inertia: 8,
    inverseInertia: 0.125,
    gravityScale: 0.75,
    linearDamping: 0.1,
    angularDamping: 0,
    restitution: 0.1,
    friction: 0.6,
    surfaceVelocityX: 0,
    surfaceVelocityY: 0,
    density: 1.2,
    contactBaumgarteBiasScale: 1,
    maxContactBaumgarteBiasVelocityScale: 1,
    contactPositionCorrectionScale: 1,
    contactPositionCorrectionSlopScale: 1,
  };
  const publicCreatePhysicsBodyStateBufferSnapshot: PublicApi["createPhysicsBodyStateBufferSnapshot"] =
    createPhysicsBodyStateBufferSnapshot;
  const physicsBodyStateBuffer: PhysicsBodyStateBufferSnapshot =
    publicCreatePhysicsBodyStateBufferSnapshot([physicsEntitySnapshot]);
  const jointType: PhysicsJointType = "distance";
  const jointBaseOptions: PhysicsJointBaseOptions = {
    entityA: physicsEntityHandle,
    entityB: { entityId: 10, entityGeneration: 0 },
    stiffness: 1,
    damping: 0.25,
  };
  const jointSpawnOptions: PhysicsJointSpawnOptions = {
    ...jointBaseOptions,
    type: jointType,
    restLength: 12,
  };
  const weldJointSpawnOptions: PhysicsJointSpawnOptions = {
    ...jointBaseOptions,
    type: "weld",
    localAnchorAX: 0,
    localAnchorAY: 0,
    localAnchorBX: -8,
    localAnchorBY: 0,
    referenceAngle: 0,
    breakDistance: 16,
    breakAngle: 1,
  };
  const pulleyJointSpawnOptions: PhysicsJointSpawnOptions = {
    ...jointBaseOptions,
    type: "pulley",
    groundAnchorAX: -16,
    groundAnchorAY: 0,
    groundAnchorBX: 16,
    groundAnchorBY: 0,
    restLength: 32,
    ratio: 1,
  };
  const physicsJointHandle: PhysicsJointHandle = {
    jointType,
    jointIndex: 2,
    jointGeneration: 0,
  };
  const physicsJointSnapshot: PhysicsJointSnapshot = {
    ...physicsJointHandle,
    entityA: physicsEntityHandle,
    entityB: jointBaseOptions.entityB,
    enabled: true,
    restLength: 12,
    maxLength: 0,
    ratio: 0,
    referenceAngle: 0,
    breakDistance: Number.POSITIVE_INFINITY,
    breakAngle: 0,
    stiffness: 1,
    damping: 0.25,
    angularStiffness: 0,
    angularDamping: 0,
    localAnchorAX: 0,
    localAnchorAY: 0,
    localAnchorBX: 0,
    localAnchorBY: 0,
    localAxisAX: 0,
    localAxisAY: 0,
    groundAnchorAX: 0,
    groundAnchorAY: 0,
    groundAnchorBX: 0,
    groundAnchorBY: 0,
    limitEnabled: false,
    lowerAngle: 0,
    upperAngle: 0,
    lowerTranslation: 0,
    upperTranslation: 0,
    motorEnabled: false,
    motorSpeed: 0,
    maxMotorForce: 0,
    maxMotorTorque: 0,
  };
  const nearestBodyQuery: PhysicsNearestBodyQuery = { x: 0, y: 0, maxDistance: 64, queryMaskBits: 0xffffffff };
  const nearestBodyHit: PhysicsNearestBodyHit = {
    entityId: 1,
    entityGeneration: 0,
    pointX: 8,
    pointY: 0,
    distance: 8,
  };
  const nearestTileQuery: PhysicsNearestTileObstacleQuery = { x: 0, y: 0, maxDistance: 64 };
  const nearestTileHit: PhysicsNearestTileObstacleHit = {
    layerIndex: 0,
    tileIndex: 1,
    pointX: 16,
    pointY: 0,
    distance: 16,
  };
  const navigationWaypointQuery: TilemapNavigationWaypointQuery = {
    fromX: 0,
    fromY: 0,
    toX: 32,
    toY: 0,
  };
  const navigationWaypoint: TilemapNavigationWaypoint = { x: 16, y: 0, distance: 16 };
  const navigationPathQuery: TilemapNavigationPathQuery = navigationWaypointQuery;
  const navigationPathPoint: TilemapNavigationPathPoint = { x: 16, y: 0 };
  const navigationPath: TilemapNavigationPath = {
    pointBuffer: new Float32Array([16, 0, 32, 0]),
    pointCount: 2,
    points: [navigationPathPoint, { x: 32, y: 0 }],
    distance: 32,
    debugLineBuffer: {
      buffer: new Float32Array([0, 0, 16, 0, 0.1, 0.75, 1, 1]),
      lineCount: 1,
      floatsPerLine: 8,
    },
    debugLines: [{ x0: 0, y0: 0, x1: 16, y1: 0, color: [0.1, 0.75, 1, 1] }],
  };
  const tilemapRectEditOptions: TilemapRectEditOptions = { maxCollisionRebuildChunks: 2 };
  const pointBodyQuery: PhysicsPointBodyQuery = { x: 10, y: 20, queryMaskBits: 0xffffffff };
  const bodyContactQuery: PhysicsBodyContactQuery = { categoryABits: 1, categoryBBits: 2 };
  const bodyManifoldQuery: PhysicsBodyManifoldQuery = bodyContactQuery;
  const aabbBodyQuery: PhysicsAabbBodyQuery = { x: 10, y: 20, halfWidth: 4, halfHeight: 5 };
  const circleBodyQuery: PhysicsCircleBodyQuery = { x: 10, y: 20, radius: 6 };
  const orientedBoxBodyQuery: PhysicsOrientedBoxBodyQuery = {
    x: 10,
    y: 20,
    halfWidth: 4,
    halfHeight: 5,
    rotationRadians: 0.25,
  };
  const capsuleBodyQuery: PhysicsCapsuleBodyQuery = {
    startX: 0,
    startY: 0,
    endX: 10,
    endY: 0,
    radius: 2,
  };
  const convexPolygonVertices: PhysicsConvexPolygonVertexBuffer = new Float32Array([
    0, 0, 10, 0, 10, 10, 0, 10,
  ]);
  const convexPolygonBodyQuery: PhysicsConvexPolygonBodyQuery = {
    vertices: convexPolygonVertices,
  };
  const bodyQueryHit: PhysicsBodyQueryHit = {
    entityId: 2,
    entityGeneration: 0,
  };
  const bodyContactHit: PhysicsBodyContactHit = {
    aEntityId: 1,
    aEntityGeneration: 0,
    bEntityId: 2,
    bEntityGeneration: 0,
    normalX: 1,
    normalY: 0,
    penetration: 2,
    pointX: 12,
    pointY: 0,
  };
  const bodyManifoldHit: PhysicsBodyManifoldHit = {
    aEntityId: 1,
    aEntityGeneration: 0,
    bEntityId: 2,
    bEntityGeneration: 0,
    pointCount: 2,
    normalX: 1,
    normalY: 0,
    penetration: 2,
    points: [
      { pointX: 12, pointY: -4, penetration: 2 },
      { pointX: 12, pointY: 4, penetration: 2 },
    ],
  };
  const rigidContactImpulseHit: PhysicsRigidContactImpulseHit = {
    aEntityId: 1,
    aEntityGeneration: 0,
    bEntityId: 2,
    bEntityGeneration: 0,
    pointX: 12,
    pointY: 0,
    normalX: 1,
    normalY: 0,
    normalImpulse: 3,
    tangentImpulse: -0.5,
  };
  const raycastBodyQuery: PhysicsRaycastBodyQuery = {
    originX: 0,
    originY: 0,
    directionX: 1,
    directionY: 0,
    maxDistance: 64,
  };
  const segmentCastBodyQuery: PhysicsSegmentCastBodyQuery = {
    startX: 0,
    startY: 0,
    endX: 64,
    endY: 0,
  };
  const raycastTileObstacleQuery: PhysicsRaycastTileObstacleQuery = {
    originX: 0,
    originY: 5,
    directionX: 1,
    directionY: 0,
    maxDistance: 64,
  };
  const segmentCastTileObstacleQuery: PhysicsSegmentCastTileObstacleQuery = {
    startX: 0,
    startY: 5,
    endX: 10,
    endY: 5,
  };
  const raycastBodyHit: PhysicsRaycastBodyHit = {
    entityId: 2,
    entityGeneration: 0,
    distance: 12,
    pointX: 12,
    pointY: 0,
    normalX: -1,
    normalY: 0,
  };
  const shapeCastBodyHit: PhysicsShapeCastBodyHit = raycastBodyHit;
  const tileShapeCastMotionQuery: PhysicsTileShapeCastMotionQuery = {
    directionX: 1,
    directionY: 0,
    maxDistance: 64,
  };
  const aabbTileShapeCastQuery: PhysicsAabbTileObstacleShapeCastQuery = {
    x: 0,
    y: 0,
    halfWidth: 2,
    halfHeight: 2,
    ...tileShapeCastMotionQuery,
  };
  const aabbTileContactQuery: PhysicsAabbTileObstacleContactQuery = {
    x: 9,
    y: 5,
    halfWidth: 2,
    halfHeight: 2,
  };
  const aabbTileManifoldQuery: PhysicsAabbTileObstacleManifoldQuery = {
    x: 9,
    y: 5,
    halfWidth: 2,
    halfHeight: 2,
  };
  const tileShapeCastHit: PhysicsTileShapeCastHit = {
    layerIndex: 2,
    tileIndex: 1,
    distance: 9,
    pointX: 9,
    pointY: 0,
    normalX: -1,
    normalY: 0,
  };
  const tileRaycastHit: PhysicsTileRaycastHit = tileShapeCastHit;
  const tileContactHit: PhysicsTileContactHit = {
    layerIndex: 2,
    tileIndex: 1,
    normalX: -1,
    normalY: 0,
    penetration: 1,
    pointX: 11,
    pointY: 5,
  };
  const tileManifoldHit: PhysicsTileManifoldHit = {
    layerIndex: 2,
    tileIndex: 1,
    pointCount: 2,
    normalX: -1,
    normalY: 0,
    penetration: 1,
    points: [
      { pointX: 11, pointY: 3, penetration: 1 },
      { pointX: 11, pointY: 7, penetration: 1 },
    ],
  };
  const aabbShapeCastQuery: PhysicsAabbBodyShapeCastQuery = {
    x: 0,
    y: 0,
    halfWidth: 2,
    halfHeight: 2,
    directionX: 1,
    directionY: 0,
    maxDistance: 64,
  };
  const circleShapeCastQuery: PhysicsCircleBodyShapeCastQuery = {
    x: 0,
    y: 0,
    radius: 2,
    directionX: 1,
    directionY: 0,
    maxDistance: 64,
  };
  const orientedBoxShapeCastQuery: PhysicsOrientedBoxBodyShapeCastQuery = {
    x: 0,
    y: 0,
    halfWidth: 2,
    halfHeight: 2,
    rotationRadians: 0,
    directionX: 1,
    directionY: 0,
    maxDistance: 64,
  };
  const capsuleShapeCastQuery: PhysicsCapsuleBodyShapeCastQuery = {
    startX: 0,
    startY: -2,
    endX: 0,
    endY: 2,
    radius: 1,
    directionX: 1,
    directionY: 0,
    maxDistance: 64,
  };
  const convexPolygonShapeCastQuery: PhysicsConvexPolygonBodyShapeCastQuery = {
    vertices: convexPolygonVertices,
    directionX: 1,
    directionY: 0,
    maxDistance: 64,
  };
  const particleTexture: ParticleTextureRef = "hit";
  const particleRange: ParticleRangeInput = [0.1, 0.2];
  const particleColor: ParticleColor = [1, 0.5, 0.25, 1];
  const particleUv: ParticleUvRect = { u0: 0, v0: 0, u1: 0.5, v1: 0.5 };
  const particlePreset: ParticlePresetConfig = {
    texture: particleTexture,
    uv: particleUv,
    burstCount: 6,
    lifetime: particleRange,
    speed: 120,
    startSize: [8, 12],
    endSize: 2,
    startColor: particleColor,
    endColor: [1, 0.5, 0.25, 0],
    accelerationY: 32,
    damping: 0.1,
  };
  const particleVfxName: ParticleVfxPresetName = "motion-trail";
  const particleVfxMode: ParticleVfxEmitterMode = "trail";
  const particleVfxEmitterConfig: ParticleVfxEmitterConfig = {
    mode: particleVfxMode,
    intervalSeconds: 0.04,
    distance: 8,
    autostart: true,
  };
  const particleVfxPresetConfig: ParticleVfxPresetConfig = {
    particle: particlePreset,
    emitter: particleVfxEmitterConfig,
  };
  const resolvedParticleVfx: ResolvedParticleVfxPresetConfig =
    resolveParticleVfxPresetConfig(particleVfxPresetConfig);
  const resolvedParticleVfxEmitter: ResolvedParticleVfxEmitterConfig = resolvedParticleVfx.emitter;
  const particleVfxTarget: ParticleVfxEmitterTarget = {
    setParticlePreset: () => undefined,
    spawnParticleBurst: () => 1,
  };
  const particleVfxEmitterOptions: ParticleVfxEmitterOptions = {
    target: particleVfxTarget,
    presetId: 3,
    preset: particleVfxName,
    texture: particleTexture,
  };
  const particleVfxEmitter = ParticleVfxEmitter.create(particleVfxEmitterOptions);
  const particleVfxSnapshot: ParticleVfxEmitterSnapshot = particleVfxEmitter.snapshot();
  const publicParticleVfxPresets: PublicApi["PARTICLE_VFX_PRESETS"] = PARTICLE_VFX_PRESETS;
  const publicParticleVfxPreset: PublicApi["particleVfxPreset"] = particleVfxPreset;
  const publicResolveParticleVfxPresetConfig: PublicApi["resolveParticleVfxPresetConfig"] =
    resolveParticleVfxPresetConfig;
  const publicParticleVfxEmitter: PublicApi["ParticleVfxEmitter"] = ParticleVfxEmitter;
  const collisionEventBuffer: CollisionEventBufferView = {
    buffer: new Uint32Array([4, 0, 0, 1, 0, f32Bits(2)]),
    eventCount: 1,
    u32sPerEvent: 6,
  };
  const publicDecodeCollisionEvents: PublicApi["decodeCollisionEvents"] = decodeCollisionEvents;
  const collisionEvent: CollisionEventView = publicDecodeCollisionEvents(collisionEventBuffer)[0];
  const physicsDebugLineBuffer: PhysicsDebugLineBufferView = {
    buffer: new Float32Array([0, 0, 16, 0, 1, 0.2, 0.1, 1]),
    lineCount: 1,
    floatsPerLine: 8,
  };
  const publicDecodePhysicsDebugLines: PublicApi["decodePhysicsDebugLines"] = decodePhysicsDebugLines;
  const physicsDebugLine: PhysicsDebugLineView = publicDecodePhysicsDebugLines(physicsDebugLineBuffer)[0];
  const physicsQueryHitBuffer: PhysicsQueryHitBufferView = {
    buffer: new Uint32Array([2, 0]),
    hitCount: 1,
    u32sPerHit: 2,
  };
  const publicDecodePhysicsQueryHits: PublicApi["decodePhysicsQueryHits"] = decodePhysicsQueryHits;
  const physicsQueryHit: PhysicsBodyQueryHit = publicDecodePhysicsQueryHits(physicsQueryHitBuffer)[0];
  const physicsBodyContactBufferBytes = 36;
  const physicsBodyContactHitBuffer: PhysicsBodyContactHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsBodyContactBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsBodyContactBufferBytes,
  };
  physicsBodyContactHitBuffer.buffer.setUint32(0, bodyContactHit.aEntityId, true);
  physicsBodyContactHitBuffer.buffer.setUint32(4, bodyContactHit.aEntityGeneration, true);
  physicsBodyContactHitBuffer.buffer.setUint32(8, bodyContactHit.bEntityId, true);
  physicsBodyContactHitBuffer.buffer.setUint32(12, bodyContactHit.bEntityGeneration, true);
  physicsBodyContactHitBuffer.buffer.setFloat32(16, bodyContactHit.normalX, true);
  physicsBodyContactHitBuffer.buffer.setFloat32(20, bodyContactHit.normalY, true);
  physicsBodyContactHitBuffer.buffer.setFloat32(24, bodyContactHit.penetration, true);
  physicsBodyContactHitBuffer.buffer.setFloat32(28, bodyContactHit.pointX, true);
  physicsBodyContactHitBuffer.buffer.setFloat32(32, bodyContactHit.pointY, true);
  const publicDecodePhysicsBodyContactHits: PublicApi["decodePhysicsBodyContactHits"] =
    decodePhysicsBodyContactHits;
  const physicsBodyContactHit: PhysicsBodyContactHit =
    publicDecodePhysicsBodyContactHits(physicsBodyContactHitBuffer)[0];
  const physicsBodyManifoldBufferBytes = 56;
  const physicsBodyManifoldHitBuffer: PhysicsBodyManifoldHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsBodyManifoldBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsBodyManifoldBufferBytes,
  };
  physicsBodyManifoldHitBuffer.buffer.setUint32(0, bodyManifoldHit.aEntityId, true);
  physicsBodyManifoldHitBuffer.buffer.setUint32(4, bodyManifoldHit.aEntityGeneration, true);
  physicsBodyManifoldHitBuffer.buffer.setUint32(8, bodyManifoldHit.bEntityId, true);
  physicsBodyManifoldHitBuffer.buffer.setUint32(12, bodyManifoldHit.bEntityGeneration, true);
  physicsBodyManifoldHitBuffer.buffer.setUint32(16, bodyManifoldHit.pointCount, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(20, bodyManifoldHit.normalX, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(24, bodyManifoldHit.normalY, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(28, bodyManifoldHit.penetration, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(32, bodyManifoldHit.points[0]?.pointX ?? 0, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(36, bodyManifoldHit.points[0]?.pointY ?? 0, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(
    40,
    bodyManifoldHit.points[0]?.penetration ?? 0,
    true,
  );
  physicsBodyManifoldHitBuffer.buffer.setFloat32(44, bodyManifoldHit.points[1]?.pointX ?? 0, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(48, bodyManifoldHit.points[1]?.pointY ?? 0, true);
  physicsBodyManifoldHitBuffer.buffer.setFloat32(
    52,
    bodyManifoldHit.points[1]?.penetration ?? 0,
    true,
  );
  const publicDecodePhysicsBodyManifoldHits: PublicApi["decodePhysicsBodyManifoldHits"] =
    decodePhysicsBodyManifoldHits;
  const physicsBodyManifoldHit: PhysicsBodyManifoldHit =
    publicDecodePhysicsBodyManifoldHits(physicsBodyManifoldHitBuffer)[0];
  const physicsRigidContactImpulseBufferBytes = 40;
  const physicsRigidContactImpulseHitBuffer: PhysicsRigidContactImpulseHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsRigidContactImpulseBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsRigidContactImpulseBufferBytes,
  };
  physicsRigidContactImpulseHitBuffer.buffer.setUint32(0, rigidContactImpulseHit.aEntityId, true);
  physicsRigidContactImpulseHitBuffer.buffer.setUint32(
    4,
    rigidContactImpulseHit.aEntityGeneration,
    true,
  );
  physicsRigidContactImpulseHitBuffer.buffer.setUint32(8, rigidContactImpulseHit.bEntityId, true);
  physicsRigidContactImpulseHitBuffer.buffer.setUint32(
    12,
    rigidContactImpulseHit.bEntityGeneration,
    true,
  );
  physicsRigidContactImpulseHitBuffer.buffer.setFloat32(16, rigidContactImpulseHit.pointX, true);
  physicsRigidContactImpulseHitBuffer.buffer.setFloat32(20, rigidContactImpulseHit.pointY, true);
  physicsRigidContactImpulseHitBuffer.buffer.setFloat32(24, rigidContactImpulseHit.normalX, true);
  physicsRigidContactImpulseHitBuffer.buffer.setFloat32(28, rigidContactImpulseHit.normalY, true);
  physicsRigidContactImpulseHitBuffer.buffer.setFloat32(
    32,
    rigidContactImpulseHit.normalImpulse,
    true,
  );
  physicsRigidContactImpulseHitBuffer.buffer.setFloat32(
    36,
    rigidContactImpulseHit.tangentImpulse,
    true,
  );
  const publicDecodePhysicsRigidContactImpulseHits: PublicApi["decodePhysicsRigidContactImpulseHits"] =
    decodePhysicsRigidContactImpulseHits;
  const physicsRigidContactImpulseHit: PhysicsRigidContactImpulseHit =
    publicDecodePhysicsRigidContactImpulseHits(physicsRigidContactImpulseHitBuffer)[0];
  const physicsRaycastBufferBytes = 28;
  const physicsRaycastHitBuffer: PhysicsRaycastHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsRaycastBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsRaycastBufferBytes,
  };
  physicsRaycastHitBuffer.buffer.setUint32(0, raycastBodyHit.entityId, true);
  physicsRaycastHitBuffer.buffer.setUint32(4, raycastBodyHit.entityGeneration, true);
  physicsRaycastHitBuffer.buffer.setFloat32(8, raycastBodyHit.distance, true);
  physicsRaycastHitBuffer.buffer.setFloat32(12, raycastBodyHit.pointX, true);
  physicsRaycastHitBuffer.buffer.setFloat32(16, raycastBodyHit.pointY, true);
  physicsRaycastHitBuffer.buffer.setFloat32(20, raycastBodyHit.normalX, true);
  physicsRaycastHitBuffer.buffer.setFloat32(24, raycastBodyHit.normalY, true);
  const publicDecodePhysicsRaycastHits: PublicApi["decodePhysicsRaycastHits"] =
    decodePhysicsRaycastHits;
  const physicsRaycastHit: PhysicsRaycastBodyHit =
    publicDecodePhysicsRaycastHits(physicsRaycastHitBuffer)[0];
  const physicsShapeCastHitBuffer: PhysicsShapeCastHitBufferView = physicsRaycastHitBuffer;
  const publicDecodePhysicsShapeCastHits: PublicApi["decodePhysicsShapeCastHits"] =
    decodePhysicsShapeCastHits;
  const physicsShapeCastHit: PhysicsShapeCastBodyHit =
    publicDecodePhysicsShapeCastHits(physicsShapeCastHitBuffer)[0];
  const physicsTileShapeCastHitBuffer: PhysicsTileShapeCastHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsRaycastBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsRaycastBufferBytes,
  };
  physicsTileShapeCastHitBuffer.buffer.setUint32(0, tileShapeCastHit.layerIndex, true);
  physicsTileShapeCastHitBuffer.buffer.setUint32(4, tileShapeCastHit.tileIndex, true);
  physicsTileShapeCastHitBuffer.buffer.setFloat32(8, tileShapeCastHit.distance, true);
  physicsTileShapeCastHitBuffer.buffer.setFloat32(12, tileShapeCastHit.pointX, true);
  physicsTileShapeCastHitBuffer.buffer.setFloat32(16, tileShapeCastHit.pointY, true);
  physicsTileShapeCastHitBuffer.buffer.setFloat32(20, tileShapeCastHit.normalX, true);
  physicsTileShapeCastHitBuffer.buffer.setFloat32(24, tileShapeCastHit.normalY, true);
  const publicDecodePhysicsTileShapeCastHits: PublicApi["decodePhysicsTileShapeCastHits"] =
    decodePhysicsTileShapeCastHits;
  const physicsTileShapeCastHit: PhysicsTileShapeCastHit =
    publicDecodePhysicsTileShapeCastHits(physicsTileShapeCastHitBuffer)[0];
  const physicsTileRaycastHitBuffer: PhysicsTileRaycastHitBufferView =
    physicsTileShapeCastHitBuffer;
  const publicDecodePhysicsTileRaycastHits: PublicApi["decodePhysicsTileRaycastHits"] =
    decodePhysicsTileRaycastHits;
  const physicsTileRaycastHit: PhysicsTileRaycastHit =
    publicDecodePhysicsTileRaycastHits(physicsTileRaycastHitBuffer)[0];
  const physicsTileContactHitBuffer: PhysicsTileContactHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsRaycastBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsRaycastBufferBytes,
  };
  physicsTileContactHitBuffer.buffer.setUint32(0, tileContactHit.layerIndex, true);
  physicsTileContactHitBuffer.buffer.setUint32(4, tileContactHit.tileIndex, true);
  physicsTileContactHitBuffer.buffer.setFloat32(8, tileContactHit.normalX, true);
  physicsTileContactHitBuffer.buffer.setFloat32(12, tileContactHit.normalY, true);
  physicsTileContactHitBuffer.buffer.setFloat32(16, tileContactHit.penetration, true);
  physicsTileContactHitBuffer.buffer.setFloat32(20, tileContactHit.pointX, true);
  physicsTileContactHitBuffer.buffer.setFloat32(24, tileContactHit.pointY, true);
  const publicDecodePhysicsTileContactHits: PublicApi["decodePhysicsTileContactHits"] =
    decodePhysicsTileContactHits;
  const physicsTileContactHit: PhysicsTileContactHit =
    publicDecodePhysicsTileContactHits(physicsTileContactHitBuffer)[0];
  const physicsTileManifoldBufferBytes = 48;
  const physicsTileManifoldHitBuffer: PhysicsTileManifoldHitBufferView = {
    buffer: new DataView(new ArrayBuffer(physicsTileManifoldBufferBytes)),
    hitCount: 1,
    bytesPerHit: physicsTileManifoldBufferBytes,
  };
  physicsTileManifoldHitBuffer.buffer.setUint32(0, tileManifoldHit.layerIndex, true);
  physicsTileManifoldHitBuffer.buffer.setUint32(4, tileManifoldHit.tileIndex, true);
  physicsTileManifoldHitBuffer.buffer.setUint32(8, tileManifoldHit.pointCount, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(12, tileManifoldHit.normalX, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(16, tileManifoldHit.normalY, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(20, tileManifoldHit.penetration, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(24, tileManifoldHit.points[0]?.pointX ?? 0, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(28, tileManifoldHit.points[0]?.pointY ?? 0, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(
    32,
    tileManifoldHit.points[0]?.penetration ?? 0,
    true,
  );
  physicsTileManifoldHitBuffer.buffer.setFloat32(36, tileManifoldHit.points[1]?.pointX ?? 0, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(40, tileManifoldHit.points[1]?.pointY ?? 0, true);
  physicsTileManifoldHitBuffer.buffer.setFloat32(
    44,
    tileManifoldHit.points[1]?.penetration ?? 0,
    true,
  );
  const publicDecodePhysicsTileManifoldHits: PublicApi["decodePhysicsTileManifoldHits"] =
    decodePhysicsTileManifoldHits;
  const physicsTileManifoldHit: PhysicsTileManifoldHit =
    publicDecodePhysicsTileManifoldHits(physicsTileManifoldHitBuffer)[0];
  const uiOverlay: Pick<UiOverlay, "update" | "destroy"> = {
    update: () => undefined,
    destroy: () => undefined,
  };
  const inputProvider: InputProvider = () => ({
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
    enter: false,
    mouseLeft: false,
    mouseX: 0,
    mouseY: 0,
  });
  const viewportProvider: ViewportProvider = () => ({ width: 800, height: 480 });
  const stats: RendererStats = {
    drawCalls: 0,
    batchCount: 0,
    spriteCount: 0,
    renderCommandCount: 0,
    textureBindCount: 0,
    textureSwitchCount: 0,
    physicsDebugLineCount: 0,
    lightingDrawCalls: 0,
    pointLightCount: 0,
    tileOccluderCount: 0,
    shadowDrawCalls: 0,
    shadowCasterCount: 0,
    postProcessDrawCalls: 0,
    postProcessPassCount: 0,
  };
  const renderer: Pick<Renderer, "stats"> = { stats: () => stats };
  const assetHost: Pick<AssetHost, "textureId"> = { textureId: () => 1 };
  const browserPlatformHost: Pick<BrowserPlatformHost, "textureId" | "destroy"> = {
    textureId: () => 1,
    destroy: () => undefined,
  };
  const audioAssetLoader: Pick<AudioAssetLoader, "load"> = {
    load: async () => ({}) as AudioBuffer,
  };
  const engine: Pick<
    FerrumEngine,
    "setGameSpec" | "captureShooterStateSnapshot" | "restoreShooterStateSnapshot" |
      "useBreakoutGame" | "configurePhysicsRuntime" | "configureFixedTimestep" |
      "configureAutoRigidBodyStep" | "stepRigidBodies" |
      "spawnRigidBody" | "addPhysicsBodyCollider" | "getPhysicsBodyColliderCount" |
      "getPhysicsBodyCollider" | "getPhysicsEntity" | "despawnPhysicsEntity" |
      "capturePhysicsBodyStateBuffer" | "restorePhysicsBodyStateBuffer" |
      "setPhysicsBodyVelocity" | "setPhysicsBodyRotation" | "setPhysicsBodyAngularVelocity" |
      "setPhysicsBodyEnabled" | "setPhysicsColliderOffset" | "setPhysicsColliderEnabled" |
      "setPhysicsColliderMaterial" | "setPhysicsBodyColliderMaterial" | "clearPhysicsColliderMaterial" |
      "setPhysicsBodyMassProperties" |
      "setPhysicsBodyTuning" | "setPhysicsBodyMaterial" |
      "applyPhysicsBodyForce" | "applyPhysicsBodyImpulse" |
      "applyPhysicsBodyTorque" | "applyPhysicsBodyAngularImpulse" |
      "spawnPhysicsJoint" | "getPhysicsJoint" | "clearPhysicsJoint" | "setPhysicsJointEnabled" |
      "queryNearestBody" | "queryNearestTileObstacle" |
      "queryBodyContacts" | "queryBodyManifolds" |
      "queryRigidContactImpulses" |
      "queryPointBodies" | "queryAabbBodies" | "queryCircleBodies" | "queryOrientedBoxBodies" |
      "queryCapsuleBodies" | "queryConvexPolygonBodies" | "raycastBodies" | "segmentCastBodies" |
      "raycastTileObstacles" | "segmentCastTileObstacles" |
      "shapeCastAabbBodies" | "shapeCastCircleBodies" | "shapeCastOrientedBoxBodies" |
      "shapeCastCapsuleBodies" | "shapeCastConvexPolygonBodies" | "shapeCastAabbTileObstacles" |
      "queryAabbTileObstacleContacts" | "queryAabbTileObstacleManifolds" |
      "setShooterTilemapTile" | "setShooterTilemapTilesRect" |
      "setShooterTilemapNavigationCost" | "queryTilemapNavigationWaypoint" | "queryTilemapNavigationPath" |
      "setParticlePreset" | "clearParticlePresets" | "setShooterHitParticlePreset" |
      "clearShooterHitParticlePreset" | "setParticleSeed" | "spawnParticleBurst" | "clearParticles" |
      "particleCount" | "particleCapacity"
  > = {
    setGameSpec: () => ({
      worldWidth: 1600,
      worldHeight: 960,
      playerSpeed: 180,
      enemySpeed: 72,
      enemySpawnInterval: 1,
      bulletSpeed: 360,
      fireCooldown: 0.12,
      bulletLifetime: 1.8,
      playerWidth: 36,
      playerHeight: 36,
      enemyWidth: 24,
      enemyHeight: 24,
      bulletWidth: 8,
      bulletHeight: 8,
      playerAnimationFrames: 1,
      playerAnimationFps: 0,
      playerAnimationColumns: 1,
      playerAnimationRows: 1,
      playerAnimationIdleRow: 0,
      playerAnimationIdleFrames: 1,
      playerAnimationIdleFps: 1,
      playerAnimationMoveRow: 0,
      playerAnimationMoveFrames: 1,
      playerAnimationMoveFps: 1,
      enemyAnimationFrames: 1,
      enemyAnimationFps: 0,
      enemyAnimationColumns: 1,
      enemyAnimationRows: 1,
      enemyAnimationIdleRow: 0,
      enemyAnimationIdleFrames: 1,
      enemyAnimationIdleFps: 1,
      enemyAnimationMoveRow: 0,
      enemyAnimationMoveFrames: 1,
      enemyAnimationMoveFps: 1,
      bulletAnimationFrames: 1,
      bulletAnimationFps: 0,
      bulletAnimationColumns: 1,
      bulletAnimationRows: 1,
      bulletAnimationIdleRow: 0,
      bulletAnimationIdleFrames: 1,
      bulletAnimationIdleFps: 1,
      bulletAnimationMoveRow: 0,
      bulletAnimationMoveFrames: 1,
      bulletAnimationMoveFps: 1,
      enemyBehavior: "chase",
      enemyBehaviorCode: 0,
      enemySpawnPattern: "edge",
      enemySpawnPatternCode: 0,
      enemyHealth: 1,
      bulletDamage: 1,
      scoreReward: 1,
      orbitRadius: 180,
      orbitRadialBand: 24,
      cameraPreset: "look-ahead",
      cameraPresetCode: 2,
      cameraDeadZoneWidth: 160,
      cameraDeadZoneHeight: 96,
      cameraLookAheadDistance: 96,
      cameraShakeAmplitude: 6,
      cameraShakeFrequency: 8,
      atlasFrames: {},
      bulletAtlasAnimation: resolvedAtlasAnimation,
      playerCollider: { type: "aabb", halfWidth: 18, halfHeight: 18, offsetX: 0, offsetY: 0, enabled: true, trigger: true },
      enemyCollider: { type: "aabb", halfWidth: 12, halfHeight: 12, offsetX: 0, offsetY: 0, enabled: true, trigger: true },
      bulletCollider: resolvedPrefabCollider,
      tilemap: resolvedTilemap,
      waves: [],
      audioMasterVolume: 0.9,
      audioSfxVolume: 0.7,
      shootVolume: 0.3,
      shootPitch: 1.1,
      hitVolume: 0.45,
      hitPitch: 1,
      gameOverVolume: 0.65,
      gameOverPitch: 0.9,
      postProcessing: resolvedPostProcessPasses,
      physics: resolvePhysicsSpec(gameSpec.physics),
    }),
    captureShooterStateSnapshot: () => builtInShooterState,
    restoreShooterStateSnapshot: () => true,
    useBreakoutGame: () => undefined,
    configurePhysicsRuntime: (spec) => spec,
    configureFixedTimestep: () => undefined,
    configureAutoRigidBodyStep: () => undefined,
    stepRigidBodies: () => rigidBodyStepStats,
    spawnRigidBody: () => physicsEntityHandle,
    addPhysicsBodyCollider: () => true,
    getPhysicsBodyColliderCount: () => 2,
    getPhysicsBodyCollider: () => bodyColliderSnapshot,
    getPhysicsEntity: () => physicsEntitySnapshot,
    despawnPhysicsEntity: () => true,
    capturePhysicsBodyStateBuffer: () => physicsBodyStateBuffer,
    restorePhysicsBodyStateBuffer: () => true,
    setPhysicsBodyVelocity: () => true,
    setPhysicsBodyRotation: () => true,
    setPhysicsBodyAngularVelocity: () => true,
    setPhysicsBodyEnabled: () => true,
    setPhysicsColliderOffset: () => true,
    setPhysicsColliderEnabled: () => true,
    setPhysicsColliderMaterial: () => true,
    setPhysicsBodyColliderMaterial: () => true,
    clearPhysicsColliderMaterial: () => true,
    setPhysicsBodyMassProperties: () => true,
    setPhysicsBodyTuning: () => true,
    setPhysicsBodyMaterial: () => true,
    applyPhysicsBodyForce: () => true,
    applyPhysicsBodyImpulse: () => true,
    applyPhysicsBodyTorque: () => true,
    applyPhysicsBodyAngularImpulse: () => true,
    spawnPhysicsJoint: () => physicsJointHandle,
    getPhysicsJoint: () => physicsJointSnapshot,
    clearPhysicsJoint: () => true,
    setPhysicsJointEnabled: () => true,
    queryNearestBody: () => nearestBodyHit,
    queryNearestTileObstacle: () => nearestTileHit,
    queryBodyContacts: () => [bodyContactHit],
    queryBodyManifolds: () => [bodyManifoldHit],
    queryRigidContactImpulses: () => [rigidContactImpulseHit],
    queryPointBodies: () => [bodyQueryHit],
    queryAabbBodies: () => [bodyQueryHit],
    queryCircleBodies: () => [bodyQueryHit],
    queryOrientedBoxBodies: () => [bodyQueryHit],
    queryCapsuleBodies: () => [bodyQueryHit],
    queryConvexPolygonBodies: () => [bodyQueryHit],
    raycastBodies: () => [raycastBodyHit],
    segmentCastBodies: () => [raycastBodyHit],
    raycastTileObstacles: () => [tileRaycastHit],
    segmentCastTileObstacles: () => [tileRaycastHit],
    shapeCastAabbBodies: () => [shapeCastBodyHit],
    shapeCastCircleBodies: () => [shapeCastBodyHit],
    shapeCastOrientedBoxBodies: () => [shapeCastBodyHit],
    shapeCastCapsuleBodies: () => [shapeCastBodyHit],
    shapeCastConvexPolygonBodies: () => [shapeCastBodyHit],
    shapeCastAabbTileObstacles: () => [tileShapeCastHit],
    queryAabbTileObstacleContacts: () => [tileContactHit],
    queryAabbTileObstacleManifolds: () => [tileManifoldHit],
    setShooterTilemapTile: () => true,
    setShooterTilemapTilesRect: () => true,
    setShooterTilemapNavigationCost: () => true,
    queryTilemapNavigationWaypoint: () => navigationWaypoint,
    queryTilemapNavigationPath: () => navigationPath,
    setParticlePreset: () => undefined,
    clearParticlePresets: () => undefined,
    setShooterHitParticlePreset: () => undefined,
    clearShooterHitParticlePreset: () => undefined,
    setParticleSeed: () => undefined,
    spawnParticleBurst: () => 1,
    clearParticles: () => undefined,
    particleCount: () => 1,
    particleCapacity: () => 512,
  };
  const physicsSceneProfileResult: PhysicsSceneProfileApplyResult =
    publicApplyPhysicsSceneProfile(
      engine as unknown as FerrumEngine,
      physicsSceneProfileSpec,
      physicsSceneProfileOptions,
    );

  equal(manifest.textures?.player, "/assets/player.png");
  equal(asepriteImportResult.frameNames[0], "player");
  equal(publicImportAsepriteAtlasFrames({
    frames: {
      "enemy.png": { frame: { x: 0, y: 0, w: 8, h: 8 } },
    },
    meta: { size: { w: 16, h: 16 } },
  }, asepriteImportOptions).enemy.texture, "sprites");
  equal(tiledImportResult.usedGids[0], 1);
  equal(publicImportTiledGameSpec({
    orientation: "orthogonal",
    width: 1,
    height: 1,
    tilewidth: 8,
    tileheight: 8,
    tilesets: [{
      firstgid: 1,
      name: "terrain",
      imagewidth: 8,
      imageheight: 8,
      tilewidth: 8,
      tileheight: 8,
      columns: 1,
      tilecount: 1,
    }],
    layers: [{ type: "tilelayer", width: 1, height: 1, data: [1] }],
  }, tiledImportOptions).tilemap?.layers?.[0]?.data?.[0], 1);
  equal(tiledLayerDataDecoder(new Uint8Array(0), {
    compression: "zlib",
    path: "assetPipeline.tiled.layers.0.data",
    expectedByteLength: 0,
  }).byteLength, 0);
  equal(ldtkImportResult.usedTileIds[0], 1);
  equal(firstLDtkEntity?.fields.role, "player");
  equal(publicImportLDtkGameSpec({
    defs: {
      tilesets: [{
        uid: 1,
        identifier: "terrain",
        pxWid: 8,
        pxHei: 8,
        tileGridSize: 8,
      }],
    },
    levels: [{
      identifier: "Level_0",
      pxWid: 8,
      pxHei: 8,
      layerInstances: [{
        __identifier: "ground",
        __type: "Tiles",
        __cWid: 1,
        __cHei: 1,
        __gridSize: 8,
        __tilesetDefUid: 1,
        gridTiles: [{ px: [0, 0], src: [0, 0], t: 0, f: 0 }],
      }],
    }],
  }, ldtkImportOptions).tilemap?.layers?.[0]?.data?.[0], 1);
  equal(options.includeDeprecatedRenderCommands, false);
  equal(options.useWorkerClock, true);
  equal(fixedTimestepOptions.enabled, true);
  options.lifecycle?.onStart?.({
    timeSeconds: 0,
    score: 0,
    entityCount: 1,
    gameState: 0,
    spriteCount: 1,
  });
  equal(rendererOptions.preferred, "webgpu");
  equal(runtimeOptions.rendererPreference, "webgpu");
  equal(runtimeOptions.debug, false);
  equal(runtimeOptions.uiState?.({} as FerrumRuntimeFrame).panels?.[0]?.id, "hud");
  equal(publicHudThemePresets[hudThemeName].panelBorder, "#ffffff");
  equal(resolvedHudTheme.textColor, "#ffffff");
  equal(hudThemeTokens.textColor, "#ffffff");
  equal(publicAccessibilityPalettes["high-contrast"].colors.text, "#ffffff");
  equal(resolvedAccessibilityOptions.reducedMotion, true);
  equal(resolvedAccessibilityPalette.id, "custom");
  equal(resolvedAccessibilityInputAssist.holdToToggleActions[0], "fire");
  equal(accessibilityHudTheme.primaryButtonBackground, "#0072b2");
  equal(accessibilityCameraSpec.smoothTimeSeconds, 0);
  equal(accessibilityFadeSpec.durationSeconds, 0);
  equal(accessibilitySubtitlePanelState?.lines?.[1]?.text, "Move carefully.");
  equal(detectedAccessibilityEnvironment.prefersReducedMotion, true);
  equal(hudOverlayState.panels?.[0].id, "game-hud");
  equal(hudOverlayState.panels?.[0].lines?.[0].meter?.max, 5);
  equal(hudOverlayState.panels?.[0].actions?.[0].id, "pause");
  equal(hudComponentSpec.type, "meter");
  equal(uiPanel.ariaLive, "polite");
  equal(uiDialog.title, "Paused");
  equal(uiOptions.theme, hudThemeName);
  equal(gamepadMapping.actionButtons?.[1], 2);
  equal(publicDefaultInputActionProfile.axes?.moveX.positive, "moveRight");
  equal(publicTopdownInputActionProfile.actions.fire[0]?.control, "space");
  equal(publicPlatformerInputActionProfile.axes?.moveX.positive, "moveRight");
  equal(publicBreakoutInputActionProfile.axes?.paddleX.negative, "moveLeft");
  equal(publicInputActionProfiles[inputActionProfileId].actions.primary[0]?.control, "space");
  equal(inputActionState.actions.fire, true);
  equal(inputActionState.axes.horizontal, 1);
  equal(virtualControlsOptions.joystick, virtualJoystickOptions);
  equal(publicDefaultVirtualControlButtons[0]?.id, "primary");
  equal(virtualInputSnapshot.d, true);
  equal(virtualInputSnapshot.space, true);
  equal(typeof publicVirtualControls, "function");
  equal(publicNormalizeLightingScene(lightingScene).pointLights.length, 1);
  equal(publicDeriveTileOccludersFromTilemapGrid(tileOccluderGrid).length, 1);
  equal(resolvedLightingScene.tileOccluders[0]?.width, 16);
  equal(resolvedLightingShadows.projectionLength, 128);
  equal(shadowProjectionOptions.clipRect?.width, 320);
  equal(resolvedCameraBounds.maxX, 640);
  equal(resolvedCameraDeadZone.width, 96);
  equal(publicClampCameraToBounds(cameraPoint, resolvedCameraBounds, cameraViewport).x, 160);
  equal(cameraRigSnapshot.targetX, 100);
  equal(resolvedPostProcessColor[3], 0.25);
  equal(publicFadePostProcessPass(0.5).color[3], 0.5);
  equal(fadeTransitionSnapshot.opacity, 0.5);
  equal(resolvedCutsceneCommandBase.id, "wait-0");
  equal(resolvedCutsceneCommand.kind, "camera");
  equal(resolvedCutsceneWait.durationSeconds, 0.1);
  equal(resolvedCutsceneCamera.target.x, 10);
  equal(resolvedCutsceneAudio.bus, "bgm");
  equal(resolvedCutsceneDialogue.text, "Ready");
  equal(cutsceneSnapshot.currentCommand?.kind, "wait");
  equal(cutsceneEvent.command.kind, "wait");
  equal(publicLocalizationLocaleChain(resolvedLocalization, "ko-KR")[0], "ko");
  equal(resolvedLocalizationString.text, "Hello, {name}");
  equal(localizationBundle.t("start"), "시작");
  equal(localizedText.text, "Hello, Ferrum");
  equal(textLayoutLine.text.length > 0, true);
  equal(fontPolicy.cssFontFamily.includes("Ferrum UI"), true);
  equal(resolvedWebFont.display, "swap");
  equal(resolvedBitmapFont.image, "/fonts/pixel.png");
  equal(questStatus, "active");
  equal(resolvedQuestObjective.text, "Talk");
  equal(resolvedQuestUpdate.quest, "tutorial");
  equal(questProgress.stage, "intro");
  equal(questLogSnapshot.quests[0].id, "tutorial");
  equal(dialogueChoiceResult.ended, true);
  equal(dialogueSessionSnapshot.nodeId, "done");
  equal(dialogueUiState.dialog?.title, "Talk");
  equal(dialogueQuestSnapshot.format, "ferrum-dialogue-quest-state");
  equal(webgl2Options.lighting, lightingScene);
  equal(physicsDebugLineCamera.x, 0);
  equal(physicsDebugOptions.colliders, true);
  equal(gameSpec.world?.width, 1600);
  equal(cameraSpec.preset, "look-ahead");
  equal(atlasFrameSpec.texture, "bullet");
  equal(atlasAnimationSpec.idle?.frames?.[0], "bullet");
  equal(resolvedAtlasAnimation.idle.fps, 1);
  equal(prefabColliderType, "aabb");
  equal(prefabColliderSpec.offset?.x, 1);
  equal(physicsMaterialSpec.friction, 0.8);
  equal(resolvedPrefabCollider.material?.surfaceVelocityX, 2);
  equal(resolvedPrefabColliderVertex.x, -2);
  equal(tileSlopeSpec.y0, 1);
  equal(resolvedTileSlope.x1, 1);
  equal(enemyPresetSpec.health, 4);
  equal(enemyOrbitSpec.radius, 180);
  equal(orbitEnemyPresetSpec.behavior, "orbit");
  equal(waveSpec.enemyCount, 6);
  equal(tileSpec.frame, "bullet");
  equal(tileLayerSpec.columns, 1);
  equal(tileLayerSpec.collision, true);
  equal(tileLayerSpec.collisionOnly, false);
  equal(resolvedTilemap.layers.length, 0);
  equal(audioBusConfig.sfxVolume, 0.7);
  equal(audioManagerConfig.bgmVolume, 0.2);
  equal(audioManagerConfig.uiVolume, 0.4);
  equal(audioBus, "bgm");
  equal(playBgmOptions.loop, true);
  equal(playBgmOptions.fadeMs, 500);
  equal(stopBgmOptions.fadeOutSeconds, 0.25);
  equal(stopBgmOptions.fadeMs, 250);
  equal(spatialAudioOptions.x, 1);
  equal(audioManagerState.bgmPlaying, false);
  equal(audioManagerState.uiVolume, 0.4);
  equal(diagnosticReport.context?.kind, "texture");
  equal(firstDebugGizmoLine.category, "path");
  equal(resolvedDebugGizmoColor[3], 0.75);
  equal(debugGizmoLineBuffer.lineCount, debugGizmoLines.length);
  equal(debugGizmoLineBufferResult.bufferView.floatsPerLine, 8);
  equal(atlasPlacement.name, "compat");
  equal(atlasLayoutFn([atlasSprite]).sprites[0].name, "compat");
  equal(publicTextureAtlasPackFormat, "ferrum-texture-atlas-pack");
  equal(atlasLayout.width, 8);
  equal(packedAtlasFrame.name, "hero");
  equal(packedShooterAtlas.frames?.hero.texture, "packed");
  equal(publicScreenshotCaptureSummaryFormat, "ferrum-screenshot-capture-summary");
  equal(publicScreenshotCaptureSummaryVersion, 1);
  equal(resolvedScreenshotCaptureSpec.name, "Topdown-Title");
  equal(screenshotColorSummary.a, 1);
  equal(screenshotSummary.contentHash, assertedScreenshotSummary.contentHash);
  equal(screenshotComparison.passed, true);
  equal(typeof webGpuCreate, "function");
  equal(nullableCreatedRenderer, undefined);
  equal(nullableRuntimeRenderer, undefined);
  equal(typeof runtimeCreate, "function");
  equal(physicsStats.collisionPairs, 1);
  equal(physicsStats.collisionSolidPairs, 1);
  equal(physicsStats.collisionTriggerPairs, 0);
  equal(physicsStats.collisionEventCount, 1);
  equal(edgeColliderType, "edge");
  equal(chainColliderType, "chain");
  equal(edgeRigidBodyCollider.type, "edge");
  equal(chainRigidBodyCollider.type, "chain");
  equal(physicsSceneProfileResult.autoStep, true);
  equal(physicsSceneProfileResult.profile, "runtime");
  equal(engine.stepRigidBodies(1 / 60, rigidBodyStepOptions).dynamicBodies, 1);
  equal(engine.spawnRigidBody(rigidBodySpawnOptions).entityId, 9);
  equal(engine.addPhysicsBodyCollider(physicsEntityHandle, bodyColliderOptions), true);
  equal(engine.getPhysicsBodyColliderCount(physicsEntityHandle), 2);
  equal(engine.getPhysicsBodyCollider(physicsEntityHandle, 1)?.colliderMaterial.friction, 0.8);
  equal(engine.getPhysicsEntity(physicsEntityHandle)?.bodyType, "dynamic");
  equal(physicsBodyStateBuffer.format, PHYSICS_BODY_STATE_BUFFER_FORMAT);
  equal(physicsBodyStateBuffer.floatsPerBody, PHYSICS_BODY_STATE_FLOATS_PER_BODY);
  equal(physicsBodyStateBuffer.u32sPerBody, PHYSICS_BODY_STATE_U32S_PER_BODY);
  equal(engine.capturePhysicsBodyStateBuffer([physicsEntityHandle]).bodyCount, 1);
  equal(engine.restorePhysicsBodyStateBuffer(physicsBodyStateBuffer), true);
  equal(engine.setPhysicsBodyVelocity(physicsEntityHandle, 1, 2), true);
  equal(engine.setPhysicsBodyRotation(physicsEntityHandle, 0.25), true);
  equal(engine.setPhysicsBodyAngularVelocity(physicsEntityHandle, 3), true);
  equal(engine.setPhysicsColliderOffset(physicsEntityHandle, 1, 0), true);
  equal(engine.setPhysicsColliderEnabled(physicsEntityHandle, true), true);
  equal(engine.setPhysicsColliderMaterial(physicsEntityHandle, colliderMaterial), true);
  equal(engine.setPhysicsBodyColliderMaterial(physicsEntityHandle, 1, colliderMaterial), true);
  equal(engine.clearPhysicsColliderMaterial(physicsEntityHandle), true);
  equal(engine.setPhysicsBodyMassProperties(physicsEntityHandle, rigidBodyMassProperties), true);
  equal(engine.setPhysicsBodyTuning(physicsEntityHandle, rigidBodyTuning), true);
  equal(engine.setPhysicsBodyMaterial(physicsEntityHandle, rigidBodyMaterial), true);
  equal(engine.applyPhysicsBodyForce(physicsEntityHandle, 4, 0), true);
  equal(engine.applyPhysicsBodyImpulse(physicsEntityHandle, 4, 0), true);
  equal(engine.applyPhysicsBodyTorque(physicsEntityHandle, 5), true);
  equal(engine.applyPhysicsBodyAngularImpulse(physicsEntityHandle, 6), true);
  equal(engine.setPhysicsBodyEnabled(physicsEntityHandle, false), true);
  equal(engine.despawnPhysicsEntity(physicsEntityHandle), true);
  equal(engine.captureShooterStateSnapshot()?.entityCount, 1);
  equal(engine.restoreShooterStateSnapshot(builtInShooterState), true);
  equal(engine.spawnPhysicsJoint(jointSpawnOptions).jointType, "distance");
  equal(weldJointSpawnOptions.type, "weld");
  equal(pulleyJointSpawnOptions.type, "pulley");
  equal(engine.getPhysicsJoint(physicsJointHandle)?.restLength, 12);
  equal(engine.setPhysicsJointEnabled(physicsJointHandle, false), true);
  equal(engine.clearPhysicsJoint(physicsJointHandle), true);
  equal(engine.queryNearestBody(nearestBodyQuery)?.distance, 8);
  equal(engine.queryNearestTileObstacle(nearestTileQuery)?.tileIndex, 1);
  equal(engine.setShooterTilemapTilesRect(0, 1, 0, 2, 1, 0, tilemapRectEditOptions), true);
  equal(engine.setShooterTilemapNavigationCost(0, 1, 0, 4), true);
  equal(engine.queryTilemapNavigationWaypoint(navigationWaypointQuery)?.x, 16);
  equal(engine.queryTilemapNavigationPath(navigationPathQuery)?.points[0]?.x, 16);
  equal(engine.queryBodyContacts(bodyContactQuery)[0]?.penetration, 2);
  equal(engine.queryBodyManifolds(bodyManifoldQuery)[0]?.points.length, 2);
  equal(engine.queryRigidContactImpulses()[0]?.normalImpulse, 3);
  equal(engine.queryPointBodies(pointBodyQuery)[0]?.entityId, 2);
  equal(engine.queryAabbBodies(aabbBodyQuery)[0]?.entityGeneration, 0);
  equal(engine.queryCircleBodies(circleBodyQuery)[0]?.entityId, 2);
  equal(engine.queryOrientedBoxBodies(orientedBoxBodyQuery)[0]?.entityId, 2);
  equal(engine.queryCapsuleBodies(capsuleBodyQuery)[0]?.entityId, 2);
  equal(engine.queryConvexPolygonBodies(convexPolygonBodyQuery)[0]?.entityId, 2);
  equal(engine.raycastBodies(raycastBodyQuery)[0]?.normalX, -1);
  equal(engine.segmentCastBodies(segmentCastBodyQuery)[0]?.distance, 12);
  equal(engine.raycastTileObstacles(raycastTileObstacleQuery)[0]?.tileIndex, 1);
  equal(engine.segmentCastTileObstacles(segmentCastTileObstacleQuery)[0]?.distance, 9);
  equal(engine.shapeCastAabbBodies(aabbShapeCastQuery)[0]?.pointX, 12);
  equal(engine.shapeCastCircleBodies(circleShapeCastQuery)[0]?.normalX, -1);
  equal(engine.shapeCastOrientedBoxBodies(orientedBoxShapeCastQuery)[0]?.distance, 12);
  equal(engine.shapeCastCapsuleBodies(capsuleShapeCastQuery)[0]?.entityId, 2);
  equal(engine.shapeCastConvexPolygonBodies(convexPolygonShapeCastQuery)[0]?.normalY, 0);
  equal(engine.shapeCastAabbTileObstacles(aabbTileShapeCastQuery)[0]?.tileIndex, 1);
  equal(engine.queryAabbTileObstacleContacts(aabbTileContactQuery)[0]?.penetration, 1);
  equal(engine.queryAabbTileObstacleManifolds(aabbTileManifoldQuery)[0]?.points[1]?.pointY, 7);
  equal(convexPolygonVertices.length, 8);
  equal(engine.setShooterTilemapTile(0, 1, 2, 3), true);
  equal(engine.setShooterTilemapTilesRect(0, 1, 2, 3, 4, 5), true);
  equal(particlePreset.uv?.u1, 0.5);
  equal(publicParticleVfxPresets["motion-trail"].emitter?.mode, "trail");
  equal(publicParticleVfxPreset("hit-spark", particleTexture).particle.texture, particleTexture);
  equal(publicResolveParticleVfxPresetConfig(particleVfxName, particleTexture).emitter.mode, "trail");
  equal(typeof publicParticleVfxEmitter, "function");
  equal(resolvedParticleVfxEmitter.distance, 8);
  equal(particleVfxSnapshot.mode, "trail");
  engine.setParticleSeed(123);
  engine.setParticlePreset(0, particlePreset);
  engine.setShooterHitParticlePreset(0);
  equal(engine.spawnParticleBurst(0, 10, 20), 1);
  equal(engine.particleCount(), 1);
  equal(engine.particleCapacity(), 512);
  engine.clearParticles();
  engine.clearShooterHitParticlePreset();
  engine.clearParticlePresets();
  equal(collisionEvent.kind, "hit");
  equal(collisionEvent.damage, 2);
  equal(physicsRigidContactImpulseHit.tangentImpulse, -0.5);
  equal(physicsDebugLine.x1, 16);
  equal(physicsQueryHit.entityId, 2);
  equal(physicsBodyContactHit.pointX, 12);
  equal(physicsBodyManifoldHit.points[1]?.pointY, 4);
  equal(physicsRaycastHit.normalX, -1);
  equal(physicsShapeCastHit.distance, 12);
  equal(physicsTileShapeCastHit.layerIndex, 2);
  equal(physicsTileRaycastHit.normalX, -1);
  equal(physicsTileContactHit.pointX, 11);
  equal(physicsTileManifoldHit.points[1]?.pointY, 7);
  uiOverlay.update(uiState);
  uiOverlay.destroy();
  equal(inputManagerOptions.pointerGestures, true);
  equal(inputProvider().mouseX, 0);
  equal(viewportProvider().height, 480);
  equal(renderer.stats().drawCalls, 0);
  equal(assetHost.textureId("player"), 1);
  equal(browserPlatformHost.textureId("player"), 1);
  equal(typeof audioAssetLoader.load, "function");
  equal(physicsMode, "rigid");
  equal(physicsLayerSpec.mask?.[0], "world");
  equal(physicsDebugSpec.colliders, true);
  equal(engine.setGameSpec(gameSpec).enemyBehavior, "chase");
  engine.useBreakoutGame();
  onFrame({
    timeSeconds: 0,
    frameTimeMs: 16,
    rustUpdateTimeMs: 1,
    score: 0,
    entityCount: 1,
    gameState: 0,
    spriteCount: 1,
    mouseX: 0,
    mouseY: 0,
    cameraX: 0,
    cameraY: 0,
    audioEventCount: 0,
    audioEvents: [],
    physics: physicsStats,
    collisionEventBuffer,
    collisionEvents: [collisionEvent],
    physicsDebugLineBuffer,
    physicsDebugLines: [physicsDebugLine],
    renderCommands: [],
    renderCommandBuffer: {
      buffer: new Float32Array(0),
      commandCount: 0,
      floatsPerCommand: 14,
    },
  });
});

function f32Bits(value: number): number {
  const damage = new Float32Array([value]);
  return new Uint32Array(damage.buffer)[0];
}
