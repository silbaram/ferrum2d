import {
  AnimationTimelinePlayer,
  BEHAVIOR_STATE_MACHINE_RUNTIME_MAX_TRANSITIONS,
  CutsceneSequencePlayer,
  animationTimelineFrameAt,
  applyBehaviorRecipes,
  applyCutsceneSequenceEvent,
  applyFactionRelationTable,
  applyGameplayBehaviorCommands,
  applyBehaviorStateMachineStateCommands,
  applyGameplayEventActions,
  applySceneCompositionFragment,
  applySceneBehaviorRecipes,
  behaviorRecipeCommandsForEntity,
  behaviorStateMachineBehaviorProfilesForState,
  behaviorStateMachineCommandsForState,
  bindPresentationEffectActions,
  bindSceneBehaviorRecipes,
  classifySceneInstance,
  createDataSceneRuntimeTarget,
  BYTES_PER_EFFECT_EVENT,
  compareBehaviorStateMachineReplay,
  compareGameplayReplayRuns,
  createBehaviorStateMachineCurrentStateCommandPlan,
  createBehaviorStateMachineRuntimeInstallPlan,
  createEffectEventDispatchTarget,
  createBehaviorStateMachineStateCommandPlan,
  createGameplayBehaviorRuntimeTarget,
  createGameplayReplayRun,
  DATA_SCENE_COLLISION_LAYER_CODES,
  DATA_SCENE_COMPONENTS_PROP,
  DATA_SCENE_MAX_CONVEX_POLYGON_VERTICES,
  decodeEffectEvents,
  dispatchEffectEvents,
  dispatchRuntimeEffectEvents,
  dryRunSceneBehaviorRecipes,
  effectDispatchesForEvents,
  equal,
  EMPTY_EFFECT_EVENTS,
  GAMEPLAY_BEHAVIOR_BINDING_PROP,
  GAMEPLAY_REPLAY_RUN_FORMAT,
  GAMEPLAY_REPLAY_RUN_VERSION,
  GAMEPLAY_EVENT_KIND_PRESENTATION_EFFECT,
  GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
  gameplayActionDiagnosticReports,
  gameplaySpawnDiagnosticReports,
  gameplayActionFailureReasonForCode,
  gameplayEventActionMetadataForCommands,
  gameplayActionsForEvents,
  gameplayTileImpactForCode,
  gameplayTileImpactNormalForFlags,
  hashGameStateSnapshot,
  hashGameplayReplayRun,
  instantiateSceneFragment,
  installBehaviorStateMachineRuntime,
  preflightBehaviorStateMachineStateCommands,
  resolveAnimationTimelineSpec,
  resolveBehaviorRecipeDocument,
  resolveBehaviorStateMachineDocument,
  resolveCutsceneSequenceSpec,
  resolveDataSceneComponentsSpec,
  resolveDataSceneInstanceComponents,
  resolveGameplayBehaviorRuntimeIds,
  resolvePresentationEffectRegistry,
  runBehaviorStateMachineReplay,
  SCENE_AUTHORING_DOCUMENT_FORMAT,
  SCENE_AUTHORING_DOCUMENT_VERSION,
  resolveSceneAuthoringDocument,
  resolveSceneCompositionSpec,
  unpackTileImpactLayerIndex,
  unpackTileImpactTileIndex,
  test,
} from "./publicApiTypes.shared.js";

import type {
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
  ApplyBehaviorStateMachineStateCommandsOptions,
  ApplyFactionRelationTableOptions,
  ApplyFactionRelationTableResult,
  ApplyGameplayBehaviorCommandsOptions,
  ApplySceneCompositionOptions,
  ApplySceneBehaviorRecipesOptions,
  BehaviorRecipeApplyResult,
  BehaviorRecipeActionAim,
  BehaviorRecipeCommand,
  BehaviorRecipeCommandBase,
  BehaviorRecipeCommandOptions,
  BehaviorRecipeCollisionLayer,
  BehaviorRecipeCollisionTrigger,
  BehaviorRecipeDamageTarget,
  BehaviorRecipeDocumentSpec,
  BehaviorRecipeEntitySpec,
  BehaviorRecipeEntrySpec,
  BehaviorRecipeFaction,
  BehaviorRecipeHealthZeroAction,
  BehaviorRecipeKind,
  BehaviorRecipeProjectileCollisionTarget,
  BehaviorRecipeProjectileTileImpact,
  BehaviorRecipePresentationEffectKind,
  BehaviorRecipeReferenceSpec,
  BehaviorRecipeRuntimeTarget,
  BehaviorRecipeSpec,
  BehaviorStateMachineBehaviorBinding,
  BehaviorStateMachineCommandOptions,
  BehaviorStateMachineDocumentSpec,
  BehaviorStateMachineGameplayEventKind,
  BehaviorStateMachineReplayComparison,
  BehaviorStateMachineReplayEventMatch,
  BehaviorStateMachineReplayFrame,
  BehaviorStateMachineReplayInput,
  BehaviorStateMachineReplayOptions,
  BehaviorStateMachineReplayResult,
  BehaviorStateMachineReplayStep,
  BehaviorStateMachineRuntimeEngine,
  BehaviorStateMachineRuntimeInstallOptions,
  BehaviorStateMachineRuntimeInstallPlan,
  BehaviorStateMachineRuntimeInstallResult,
  BehaviorStateMachineRuntimeStateQueryEngine,
  BehaviorStateMachineRuntimeStateId,
  BehaviorStateMachineRuntimeTransitionInstall,
  BehaviorStateMachineStateCommandApplyResult,
  BehaviorStateMachineStateCommandApplyMode,
  BehaviorStateMachineStateCommandOptions,
  BehaviorStateMachineStateCommandPlan,
  BehaviorStateMachineStateCommandPreflightResult,
  BehaviorStateMachineSpec,
  BehaviorStateMachineStateSpec,
  BehaviorStateMachineTransitionPredicateSpec,
  BehaviorStateMachineTransitionSpec,
  BehaviorStateMachineTriggerKind,
  BoundBehaviorRecipeCommand,
  CameraPoint,
  ChaseBehaviorRecipeSpec,
  ClassifySceneInstanceOptions,
  ConfigureChaseBehaviorCommand,
  ConfigureCollisionAreaDamageBehaviorCommand,
  ConfigureCollisionDespawnBehaviorCommand,
  ConfigureCollisionEmitEffectBehaviorCommand,
  ConfigureCollisionKnockbackBehaviorCommand,
  ConfigureCollisionPickupBehaviorCommand,
  ConfigureCollisionParticleBehaviorCommand,
  ConfigureCollisionShakeBehaviorCommand,
  ConfigureCollisionSpawnPrefabBehaviorCommand,
  ConfigureCollisionSoundBehaviorCommand,
  ConfigureDamageBehaviorCommand,
  ConfigureDashActionBehaviorCommand,
  ConfigureFactionBehaviorCommand,
  ConfigureHealthBehaviorCommand,
  ConfigureInteractionBehaviorCommand,
  ConfigureLifetimeBehaviorCommand,
  ConfigureMeleeActionBehaviorCommand,
  ConfigurePickupBehaviorCommand,
  ConfigureProjectileActionBehaviorCommand,
  ConfigureScoreRewardBehaviorCommand,
  ConfigureSpawnPrefabActionBehaviorCommand,
  ConfigureTimerTriggerBehaviorCommand,
  ConfigureTagsBehaviorCommand,
  CreateDataSceneRuntimeTargetOptions,
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
  DataSceneCollisionLayerName,
  DataSceneComponentsSpec,
  DataSceneRuntimeTextureIdResolver,
  CollisionAreaDamageBehaviorRecipeSpec,
  CollisionDespawnBehaviorRecipeSpec,
  CollisionEmitEffectBehaviorRecipeSpec,
  CollisionKnockbackBehaviorRecipeSpec,
  CollisionPickupBehaviorRecipeSpec,
  CollisionParticleBehaviorRecipeSpec,
  CollisionShakeBehaviorRecipeSpec,
  CollisionSpawnPrefabBehaviorRecipeSpec,
  CollisionSoundBehaviorRecipeSpec,
  DamageBehaviorRecipeSpec,
  DashActionBehaviorRecipeSpec,
  FactionRelation,
  FactionRelationEntrySpec,
  FactionRelationRuntimeEngine,
  FactionRelationTableSpec,
  FactionBehaviorRecipeSpec,
  EffectCustomEventDispatch,
  EffectEventDispatch,
  EffectEventDispatchOptions,
  EffectEventDispatchSummary,
  EffectEventDispatchTarget,
  EffectEventAssetValidationPolicy,
  EffectEventDispatchTargetFactoryOptions,
  EffectEventRuntimeOptions,
  EffectEventBufferView,
  EffectEventView,
  FerrumEngine,
  FrameState,
  MissingEffectEventHandlerPolicy,
  HealthBehaviorRecipeSpec,
  LifetimeBehaviorRecipeSpec,
  MeleeActionBehaviorRecipeSpec,
  GameStateSnapshot,
  GameplayBehaviorBindingSpec,
  GameplayBehaviorRuntimeIds,
  GameplayEntityHandle,
  GameplayEntityHandleMap,
  GameplayFactionReference,
  ResolveGameplayBehaviorRuntimeIdsOptions,
  GameplayActionDiagnosticCode,
  GameplayActionDiagnosticReport,
  GameplayActionDiagnosticReportOptions,
  GameplayActionDiagnosticValue,
  GameplaySpawnDiagnosticCode,
  GameplaySpawnDiagnosticExpectation,
  GameplaySpawnDiagnosticMetric,
  GameplaySpawnDiagnosticReport,
  GameplaySpawnDiagnosticReportOptions,
  GameplaySpawnDiagnosticValue,
  GameplayActionFailedEventAction,
  GameplayActionFailureReason,
  GameplayBehaviorStateChangedEventAction,
  GameplayCollisionDamageEventAction,
  GameplayCollisionDespawnEventAction,
  GameplayEventAction,
  GameplayEventActionApplyResult,
  GameplayEventActionMetadataMap,
  GameplayEventActionMetadataOptions,
  GameplayEventActionNameMap,
  GameplayEventActionOptions,
  GameplayEventActionTarget,
  GameplayFactionDamageDeniedEventAction,
  GameplayInteractionActionMetadata,
  GameplayInteractionEventAction,
  GameplayPickupCollectedEventAction,
  GameplayPresentationEffectEventAction,
  GameplayPresentationEffectKind,
  GameplayPrefabSpawnedEventAction,
  GameplayTimerEventAction,
  GameplayTileImpactEventAction,
  GameplayTileImpactNormal,
  GameplayTileImpactPolicy,
  UnknownEffectEventPolicy,
  PresentationEffectActionBinding,
  PresentationEffectActionBindingOptions,
  PresentationEffectDefinitionSpec,
  PresentationEffectKind,
  PresentationEffectRegistrySpec,
  ResolvePresentationEffectRegistryOptions,
  ResolvedPresentationEffectDefinition,
  ResolvedPresentationEffectRegistry,
  GameplayReplayComparison,
  GameplayReplayFrameSnapshot,
  GameplayReplayRun,
  GameplayReplaySnapshotDiff,
  InstantiateSceneFragmentOptions,
  InteractionBehaviorRecipeSpec,
  LocalizationDocumentSpec,
  LocalizationLocaleSpec,
  LocalizationPlaceholderValue,
  LocalizationStringEntrySpec,
  LocalizationStringSpec,
  MissingSceneBehaviorBinding,
  PickupBehaviorRecipeSpec,
  ProjectileActionBehaviorRecipeSpec,
  SpawnPrefabActionBehaviorRecipeSpec,
  TimerTriggerBehaviorRecipeSpec,
  PublicApi,
  RendererStats,
  ResolveBehaviorRecipeDocumentOptions,
  ResolveBehaviorStateMachineDocumentOptions,
  ResolveCutsceneSequenceOptions,
  ResolveDataSceneComponentsOptions,
  ResolveDataSceneInstanceComponentsOptions,
  ResolveSceneAuthoringDocumentOptions,
  ResolveSceneCompositionOptions,
  ResolvedAnimationTimelineEvent,
  ResolvedAnimationTimelineSpec,
  ResolvedAnimationTimelineState,
  ResolvedAnimationTimelineTransition,
  ResolvedBehaviorRecipe,
  ResolvedBehaviorRecipeBase,
  ResolvedBehaviorRecipeDocument,
  ResolvedBehaviorRecipeEntity,
  ResolvedBehaviorStateMachine,
  ResolvedBehaviorStateMachineDocument,
  ResolvedBehaviorStateMachineState,
  ResolvedBehaviorStateMachineTransition,
  ResolvedBehaviorStateMachineTransitionPredicate,
  ResolvedChaseBehaviorRecipe,
  ResolvedCollisionAreaDamageBehaviorRecipe,
  ResolvedCollisionEmitEffectBehaviorRecipe,
  ResolvedCollisionKnockbackBehaviorRecipe,
  ResolvedCutsceneAudioCommand,
  ResolvedCutsceneCameraCommand,
  ResolvedCutsceneCommandBase,
  ResolvedCutsceneDialogueCommand,
  ResolvedCutsceneSequenceCommand,
  ResolvedCutsceneSequenceSpec,
  ResolvedCutsceneWaitCommand,
  ResolvedCollisionDespawnBehaviorRecipe,
  ResolvedCollisionPickupBehaviorRecipe,
  ResolvedCollisionParticleBehaviorRecipe,
  ResolvedCollisionShakeBehaviorRecipe,
  ResolvedCollisionSpawnPrefabBehaviorRecipe,
  ResolvedCollisionSoundBehaviorRecipe,
  ResolvedDataSceneColliderBase,
  ResolvedDataSceneColliderComponent,
  ResolvedDataSceneCollisionLayer,
  ResolvedDataSceneComponents,
  ResolvedDataSceneSpriteAnimation,
  ResolvedDataSceneSpriteComponent,
  ResolvedDataSceneSpriteFrame,
  ResolvedDataSceneTextureRef,
  ResolvedDamageBehaviorRecipe,
  ResolvedDashActionBehaviorRecipe,
  ResolvedFactionBehaviorRecipe,
  ResolvedHealthBehaviorRecipe,
  ResolvedInteractionBehaviorRecipe,
  ResolvedLifetimeBehaviorRecipe,
  ResolvedMeleeActionBehaviorRecipe,
  ResolvedPickupBehaviorRecipe,
  ResolvedProjectileActionBehaviorRecipe,
  ResolvedScoreRewardBehaviorRecipe,
  ResolvedSpawnPrefabActionBehaviorRecipe,
  ResolvedTimerTriggerBehaviorRecipe,
  ResolvedSceneCompositionFragment,
  UnknownGameplayEventPolicy,
  ResolvedSceneCompositionFragmentInclude,
  ResolvedSceneCompositionFragmentInstance,
  ResolvedSceneCompositionInstance,
  ResolvedSceneCompositionPrefab,
  ResolvedSceneCompositionPrefabVariant,
  ResolvedSceneCompositionSpec,
  ResolvedSceneCompositionTransform,
  ResolvedSceneAuthoringDocument,
  SceneBehaviorBindingDryRunResult,
  SceneBehaviorBindingOptions,
  SceneBehaviorBindingPlan,
  SceneBehaviorApplyResult,
  SceneBehaviorRuntimeTarget,
  SceneInstanceAuthoringClassification,
  SceneInstanceAuthoringKind,
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
  SceneAuthoringDocumentSpec,
  ScoreRewardBehaviorRecipeSpec,
  TextDirection,
} from "./publicApiTypes.shared.js";

test("public API animation, scene composition, behavior recipe, and cutscene types", () => {
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
  const gameplayBehaviorBinding: GameplayBehaviorBindingSpec = "enemy";
  const dataSceneLayerName: DataSceneCollisionLayerName = "enemy";
  const dataSceneComponentsProp: typeof DATA_SCENE_COMPONENTS_PROP = DATA_SCENE_COMPONENTS_PROP;
  const dataSceneLayerCodes: typeof DATA_SCENE_COLLISION_LAYER_CODES = DATA_SCENE_COLLISION_LAYER_CODES;
  const dataSceneMaxConvexPolygonVertices: typeof DATA_SCENE_MAX_CONVEX_POLYGON_VERTICES =
    DATA_SCENE_MAX_CONVEX_POLYGON_VERTICES;
  const dataSceneComponents: DataSceneComponentsSpec = {
    sprite: {
      texture: "enemy",
      width: 16,
      height: 16,
      frame: { u0: 0, v0: 0, u1: 1, v1: 1 },
      animation: { frameCount: 2, fps: 8 },
    },
    collider: {
      type: "aabb",
      halfWidth: 8,
      halfHeight: 8,
    },
    layer: dataSceneLayerName,
  };
  const sceneCompositionProps: SceneCompositionProps = {
    kind: "enemy",
    stats: sceneCompositionJson,
    behaviorRecipes: gameplayBehaviorBinding,
    [dataSceneComponentsProp]: {
      sprite: {
        texture: "enemy",
        width: 16,
        height: 16,
        frame: { u0: 0, v0: 0, u1: 1, v1: 1 },
      },
      collider: { type: "aabb", halfWidth: 8, halfHeight: 8 },
      layer: dataSceneLayerName,
    },
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
  const dataSceneComponentsOptions: ResolveDataSceneComponentsOptions = {
    allowTemplate: true,
    path: "props.components",
  };
  const dataSceneInstanceComponentsOptions: ResolveDataSceneInstanceComponentsOptions = {
    allowTemplate: false,
    path: "scene.instances.0",
  };
  const publicResolveDataSceneComponentsSpec: PublicApi["resolveDataSceneComponentsSpec"] =
    resolveDataSceneComponentsSpec;
  const publicResolveDataSceneInstanceComponents: PublicApi["resolveDataSceneInstanceComponents"] =
    resolveDataSceneInstanceComponents;
  const publicCreateDataSceneRuntimeTarget: PublicApi["createDataSceneRuntimeTarget"] =
    createDataSceneRuntimeTarget;
  const dataSceneRuntimeTextureId: DataSceneRuntimeTextureIdResolver = (name) => name.length;
  const dataSceneRuntimeTargetOptions: CreateDataSceneRuntimeTargetOptions = {
    activateDataScene: false,
    textureId: dataSceneRuntimeTextureId,
  };
  const resolvedDataSceneComponents: ResolvedDataSceneComponents =
    publicResolveDataSceneComponentsSpec(dataSceneComponents, dataSceneComponentsOptions);
  const resolvedDataSceneInstanceComponents: ResolvedDataSceneComponents =
    publicResolveDataSceneInstanceComponents(resolvedSceneCompositionInstance, dataSceneInstanceComponentsOptions);
  if (resolvedDataSceneComponents.mode !== "inline") {
    throw new Error("expected inline data scene components");
  }
  const resolvedDataSceneSprite: ResolvedDataSceneSpriteComponent = resolvedDataSceneComponents.sprite;
  const resolvedDataSceneTexture: ResolvedDataSceneTextureRef = resolvedDataSceneSprite.texture;
  const resolvedDataSceneFrame: ResolvedDataSceneSpriteFrame = resolvedDataSceneSprite.frame;
  const resolvedDataSceneAnimation: ResolvedDataSceneSpriteAnimation | undefined =
    resolvedDataSceneSprite.animation;
  const resolvedDataSceneCollider: ResolvedDataSceneColliderComponent = resolvedDataSceneComponents.collider;
  if (resolvedDataSceneCollider.type !== "aabb") {
    throw new Error("expected aabb data scene collider");
  }
  const resolvedDataSceneColliderBase: ResolvedDataSceneColliderBase = resolvedDataSceneCollider;
  const resolvedDataSceneLayer: ResolvedDataSceneCollisionLayer = resolvedDataSceneComponents.layer;
  equal(dataSceneLayerCodes.enemy, 1);
  equal(dataSceneMaxConvexPolygonVertices, 16);
  equal(resolvedDataSceneTexture.kind, "asset");
  equal(resolvedDataSceneFrame.u1, 1);
  equal(resolvedDataSceneAnimation?.frameCount, 2);
  equal(resolvedDataSceneColliderBase.enabled, true);
  equal(resolvedDataSceneLayer.code, 1);
  equal(resolvedDataSceneInstanceComponents.mode, "inline");
  equal(dataSceneRuntimeTargetOptions.activateDataScene, false);
  equal(typeof publicCreateDataSceneRuntimeTarget, "function");
  const sceneCompositionTarget: SceneCompositionTarget = {
    spawnSceneInstance: (instance) => instance.id,
  };
  const sceneCompositionApplyResult: SceneCompositionApplyResult =
    publicApplySceneCompositionFragment(sceneCompositionTarget, resolvedSceneComposition, applySceneCompositionOptions);
  const sceneAuthoringDocument: SceneAuthoringDocumentSpec = {
    format: SCENE_AUTHORING_DOCUMENT_FORMAT,
    version: SCENE_AUTHORING_DOCUMENT_VERSION,
    sceneComposition: sceneCompositionSpec,
    behaviorRecipes: {
      entities: {
        enemy: {
          recipes: [{ kind: "health", max: 2 }],
        },
      },
    },
  };
  const sceneAuthoringOptions: ResolveSceneAuthoringDocumentOptions = {
    allowComponentTemplates: false,
    path: "sceneAuthoring",
    validateBindings: true,
    validateComponents: true,
    missingBehavior: "ignore",
  };
  const publicResolveSceneAuthoringDocument: PublicApi["resolveSceneAuthoringDocument"] =
    resolveSceneAuthoringDocument;
  const resolvedSceneAuthoringDocument: ResolvedSceneAuthoringDocument =
    publicResolveSceneAuthoringDocument(sceneAuthoringDocument, sceneAuthoringOptions);
  equal(resolvedSceneAuthoringDocument.format, SCENE_AUTHORING_DOCUMENT_FORMAT);
  equal(resolvedSceneAuthoringDocument.bindingPlan?.fragment, "room");
  const behaviorRecipeKind: BehaviorRecipeKind = "health";
  const behaviorRecipeZeroAction: BehaviorRecipeHealthZeroAction = "event";
  const behaviorRecipeDamageTarget: BehaviorRecipeDamageTarget = "other";
  const behaviorRecipeFaction: BehaviorRecipeFaction = "enemy";
  const customBehaviorRecipeFaction: BehaviorRecipeFaction = 7;
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
  const factionBehaviorRecipe: FactionBehaviorRecipeSpec = {
    kind: "faction",
    faction: behaviorRecipeFaction,
    damages: ["player", customBehaviorRecipeFaction],
  };
  const lifetimeBehaviorRecipe: LifetimeBehaviorRecipeSpec = {
    kind: "lifetime",
    seconds: 0.5,
  };
  const scoreRewardBehaviorRecipe: ScoreRewardBehaviorRecipeSpec = {
    kind: "scoreReward",
    reward: 2,
  };
  const pickupBehaviorRecipe: PickupBehaviorRecipeSpec = { kind: "pickup", item: "coin", itemId: 1, count: 1 };
  const collisionPickupBehaviorRecipe: CollisionPickupBehaviorRecipeSpec = {
    kind: "collisionPickup",
    target: "self",
  };
  const collisionAreaDamageTargetLayer: BehaviorRecipeCollisionLayer = "enemy";
  const collisionAreaDamageBehaviorRecipe: CollisionAreaDamageBehaviorRecipeSpec = {
    kind: "collisionAreaDamage",
    amount: 4,
    radius: 72,
    targetLayer: collisionAreaDamageTargetLayer,
  };
  const collisionKnockbackBehaviorRecipe: CollisionKnockbackBehaviorRecipeSpec = {
    kind: "collisionKnockback",
    target: behaviorRecipeDamageTarget,
    impulse: 180,
  };
  const presentationEffectKind: BehaviorRecipePresentationEffectKind = "custom";
  const collisionEmitEffectBehaviorRecipe: CollisionEmitEffectBehaviorRecipeSpec = {
    kind: "collisionEmitEffect",
    effect: "impactSpark",
    effectId: 99,
    effectKind: presentationEffectKind,
    target: "self",
    intensity: 0.65,
    radius: 48,
    cooldownSeconds: 0.25,
    trigger: "enter",
  };
  const collisionSpawnPrefabBehaviorRecipe: CollisionSpawnPrefabBehaviorRecipeSpec = {
    kind: "collisionSpawnPrefab",
    action: "split",
    actionId: 7,
    prefab: "enemy",
    prefabId: 1,
    target: "other",
    cooldownSeconds: 0.5,
    trigger: "enter",
    offsetX: 6,
    offsetY: -3,
  };
  const collisionTrigger: BehaviorRecipeCollisionTrigger = "enter";
  const collisionSoundBehaviorRecipe: CollisionSoundBehaviorRecipeSpec = {
    kind: "collisionSound",
    soundId: 2,
    volume: 0.8,
    pitch: 1,
    cooldownSeconds: 0.1,
    trigger: collisionTrigger,
  };
  const collisionParticleBehaviorRecipe: CollisionParticleBehaviorRecipeSpec = {
    kind: "collisionParticle",
    presetId: 3,
    target: behaviorRecipeDamageTarget,
  };
  const collisionShakeBehaviorRecipe: CollisionShakeBehaviorRecipeSpec = {
    kind: "collisionShake",
    cooldownSeconds: 0.2,
    trigger: collisionTrigger,
  };
  const collisionDespawnBehaviorRecipe: CollisionDespawnBehaviorRecipeSpec = {
    kind: "collisionDespawn",
    target: "self",
  };
  const chaseBehaviorRecipe: ChaseBehaviorRecipeSpec = { kind: "chase", target: "player", speed: 80 };
  const interactionBehaviorRecipe: InteractionBehaviorRecipeSpec = {
    kind: "interaction",
    action: "inspect",
    actionId: 2,
    radius: 24,
    prompt: "Inspect",
  };
  const projectileAim: BehaviorRecipeActionAim = "input";
  const projectileCollisionTarget: BehaviorRecipeProjectileCollisionTarget = "enemies";
  const projectileTileImpact: BehaviorRecipeProjectileTileImpact = "despawn";
  const passThroughTileImpact: BehaviorRecipeProjectileTileImpact = "passThrough";
  const bounceTileImpact: BehaviorRecipeProjectileTileImpact = "bounce";
  const projectileActionBehaviorRecipe: ProjectileActionBehaviorRecipeSpec = {
    kind: "projectileAction",
    action: "primary",
    actionId: 1,
    cooldownSeconds: 0.15,
    speed: 360,
    damage: 1,
    lifetimeSeconds: 1.2,
    aim: projectileAim,
    collisionTarget: projectileCollisionTarget,
    tileImpact: projectileTileImpact,
  };
  const passThroughProjectileActionBehaviorRecipe: ProjectileActionBehaviorRecipeSpec = {
    ...projectileActionBehaviorRecipe,
    tileImpact: passThroughTileImpact,
  };
  const bounceProjectileActionBehaviorRecipe: ProjectileActionBehaviorRecipeSpec = {
    ...projectileActionBehaviorRecipe,
    tileImpact: bounceTileImpact,
  };
  const dashActionBehaviorRecipe: DashActionBehaviorRecipeSpec = {
    kind: "dashAction",
    action: "dash",
    actionId: 3,
    cooldownSeconds: 0.75,
    distance: 96,
  };
  const meleeActionBehaviorRecipe: MeleeActionBehaviorRecipeSpec = {
    kind: "meleeAction",
    action: "slash",
    actionId: 4,
    cooldownSeconds: 0.35,
    range: 36,
    damage: 3,
  };
  const spawnPrefabActionBehaviorRecipe: SpawnPrefabActionBehaviorRecipeSpec = {
    kind: "spawnPrefabAction",
    action: "summon",
    actionId: 5,
    prefab: "enemy",
    prefabId: 1,
    cooldownSeconds: 1,
    anchor: "self",
    phase: "prePhysics",
    offsetX: 8,
    offsetY: -4,
  };
  const timerTriggerBehaviorRecipe: TimerTriggerBehaviorRecipeSpec = {
    kind: "timerTrigger",
    timer: "wake",
    timerId: 6,
    seconds: 0.5,
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
    recipes: [
      healthBehaviorRecipe,
      behaviorRecipeEntry,
      factionBehaviorRecipe,
      chaseBehaviorRecipe,
      lifetimeBehaviorRecipe,
      scoreRewardBehaviorRecipe,
      collisionPickupBehaviorRecipe,
      collisionAreaDamageBehaviorRecipe,
      collisionKnockbackBehaviorRecipe,
      collisionEmitEffectBehaviorRecipe,
      collisionSpawnPrefabBehaviorRecipe,
      collisionSoundBehaviorRecipe,
      collisionParticleBehaviorRecipe,
      collisionShakeBehaviorRecipe,
      collisionDespawnBehaviorRecipe,
      projectileActionBehaviorRecipe,
      dashActionBehaviorRecipe,
      meleeActionBehaviorRecipe,
      spawnPrefabActionBehaviorRecipe,
      timerTriggerBehaviorRecipe,
      passThroughProjectileActionBehaviorRecipe,
      bounceProjectileActionBehaviorRecipe,
    ],
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
  const behaviorStateMachineTriggerKind: BehaviorStateMachineTriggerKind = "gameplayEvent";
  const behaviorStateMachineEventKind: BehaviorStateMachineGameplayEventKind = "interaction";
  const behaviorStateMachineCollisionEventKind: BehaviorStateMachineGameplayEventKind = "collisionDamage";
  const behaviorStateMachinePickupEventKind: BehaviorStateMachineGameplayEventKind = "pickupCollected";
  const behaviorStateMachineBinding: BehaviorStateMachineBehaviorBinding = ["enemy", "coin"];
  const behaviorStateMachinePredicate: BehaviorStateMachineTransitionPredicateSpec = {
    type: behaviorStateMachineTriggerKind,
    event: behaviorStateMachineEventKind,
    action: "inspect",
    actionId: 2,
  };
  const behaviorStateMachineTransition: BehaviorStateMachineTransitionSpec = {
    to: "alert",
    when: behaviorStateMachinePredicate,
  };
  const behaviorStateMachineState: BehaviorStateMachineStateSpec = {
    behaviorRecipes: behaviorStateMachineBinding,
    transitions: [behaviorStateMachineTransition],
  };
  const behaviorStateMachineSpec: BehaviorStateMachineSpec = {
    initial: "idle",
    states: {
      idle: behaviorStateMachineState,
      alert: { behaviorRecipes: "enemy" },
    },
  };
  const behaviorStateMachineDocument: BehaviorStateMachineDocumentSpec = {
    machines: {
      enemyAi: behaviorStateMachineSpec,
    },
  };
  const behaviorStateMachineResolveOptions: ResolveBehaviorStateMachineDocumentOptions = {
    behaviorRecipes: behaviorRecipeDocument,
  };
  const gameplayBehaviorRuntimeIdsOptions: ResolveGameplayBehaviorRuntimeIdsOptions = {
    requiredItems: ["coin"],
    requiredActions: ["inspect", "primary", "dash"],
    requiredPrefabs: ["enemy"],
    requiredTimers: ["wake"],
    requiredTags: ["hostile"],
    requiredEffects: ["impactSpark"],
  };
  const gameplayBehaviorRuntimeIds: GameplayBehaviorRuntimeIds = resolveGameplayBehaviorRuntimeIds({
    items: { coin: 1 },
    actions: { inspect: 2, primary: 1, dash: 3 },
    prefabs: { enemy: 1 },
    timers: { wake: 6 },
    tags: { hostile: 5 },
    effects: { impactSpark: 99 },
  }, gameplayBehaviorRuntimeIdsOptions);
  const behaviorStateMachineCommandOptions: BehaviorStateMachineCommandOptions = {
    kinds: ["chase"],
  };
  const publicResolveBehaviorStateMachineDocument: PublicApi["resolveBehaviorStateMachineDocument"] =
    resolveBehaviorStateMachineDocument;
  const resolvedBehaviorStateMachineDocument: ResolvedBehaviorStateMachineDocument =
    publicResolveBehaviorStateMachineDocument(behaviorStateMachineDocument, behaviorStateMachineResolveOptions);
  const resolvedBehaviorStateMachine: ResolvedBehaviorStateMachine =
    resolvedBehaviorStateMachineDocument.machines.enemyAi;
  const resolvedBehaviorStateMachineState: ResolvedBehaviorStateMachineState =
    resolvedBehaviorStateMachine.states.idle;
  const resolvedBehaviorStateMachineTransition: ResolvedBehaviorStateMachineTransition =
    resolvedBehaviorStateMachineState.transitions[0];
  const resolvedBehaviorStateMachinePredicate: ResolvedBehaviorStateMachineTransitionPredicate =
    resolvedBehaviorStateMachineTransition.when;
  const publicBehaviorStateMachineProfilesForState: PublicApi["behaviorStateMachineBehaviorProfilesForState"] =
    behaviorStateMachineBehaviorProfilesForState;
  const publicBehaviorStateMachineCommandsForState: PublicApi["behaviorStateMachineCommandsForState"] =
    behaviorStateMachineCommandsForState;
  const resolvedBehaviorRecipeDocument: ResolvedBehaviorRecipeDocument =
    publicResolveBehaviorRecipeDocument(behaviorRecipeDocument, behaviorRecipeResolveOptions);
  const resolvedProjectileActionBehaviorRecipe: ResolvedProjectileActionBehaviorRecipe =
    resolvedBehaviorRecipeDocument.entities.enemy.recipes[15] as ResolvedProjectileActionBehaviorRecipe;
  const resolvedDashActionBehaviorRecipe: ResolvedDashActionBehaviorRecipe =
    resolvedBehaviorRecipeDocument.entities.enemy.recipes[16] as ResolvedDashActionBehaviorRecipe;
  const resolvedMeleeActionBehaviorRecipe: ResolvedMeleeActionBehaviorRecipe =
    resolvedBehaviorRecipeDocument.entities.enemy.recipes[17] as ResolvedMeleeActionBehaviorRecipe;
  const resolvedSpawnPrefabActionBehaviorRecipe: ResolvedSpawnPrefabActionBehaviorRecipe =
    resolvedBehaviorRecipeDocument.entities.enemy.recipes[18] as ResolvedSpawnPrefabActionBehaviorRecipe;
  const resolvedTimerTriggerBehaviorRecipe: ResolvedTimerTriggerBehaviorRecipe =
    resolvedBehaviorRecipeDocument.entities.enemy.recipes[19] as ResolvedTimerTriggerBehaviorRecipe;
  const resolvedCollisionPickupBehaviorRecipe: ResolvedCollisionPickupBehaviorRecipe =
    resolvedBehaviorRecipeDocument.entities.enemy.recipes[6] as ResolvedCollisionPickupBehaviorRecipe;
  const resolvedCollisionAreaDamageBehaviorRecipe: ResolvedCollisionAreaDamageBehaviorRecipe =
    resolvedBehaviorRecipeDocument.entities.enemy.recipes[7] as ResolvedCollisionAreaDamageBehaviorRecipe;
  const resolvedCollisionKnockbackBehaviorRecipe: ResolvedCollisionKnockbackBehaviorRecipe =
    resolvedBehaviorRecipeDocument.entities.enemy.recipes[8] as ResolvedCollisionKnockbackBehaviorRecipe;
  const resolvedCollisionEmitEffectBehaviorRecipe: ResolvedCollisionEmitEffectBehaviorRecipe =
    resolvedBehaviorRecipeDocument.entities.enemy.recipes[9] as ResolvedCollisionEmitEffectBehaviorRecipe;
  const resolvedCollisionSpawnPrefabBehaviorRecipe: ResolvedCollisionSpawnPrefabBehaviorRecipe =
    resolvedBehaviorRecipeDocument.entities.enemy.recipes[10] as ResolvedCollisionSpawnPrefabBehaviorRecipe;
  const resolvedCollisionSoundBehaviorRecipe: ResolvedCollisionSoundBehaviorRecipe =
    resolvedBehaviorRecipeDocument.entities.enemy.recipes[11] as ResolvedCollisionSoundBehaviorRecipe;
  const resolvedCollisionParticleBehaviorRecipe: ResolvedCollisionParticleBehaviorRecipe =
    resolvedBehaviorRecipeDocument.entities.enemy.recipes[12] as ResolvedCollisionParticleBehaviorRecipe;
  const resolvedCollisionShakeBehaviorRecipe: ResolvedCollisionShakeBehaviorRecipe =
    resolvedBehaviorRecipeDocument.entities.enemy.recipes[13] as ResolvedCollisionShakeBehaviorRecipe;
  const resolvedCollisionDespawnBehaviorRecipe: ResolvedCollisionDespawnBehaviorRecipe =
    resolvedBehaviorRecipeDocument.entities.enemy.recipes[14] as ResolvedCollisionDespawnBehaviorRecipe;
  const configureCollisionPickupCommand: ConfigureCollisionPickupBehaviorCommand = {
    entity: "enemy",
    recipe: "collisionPickup",
    tags: [],
    type: "configureCollisionPickup",
    target: resolvedCollisionPickupBehaviorRecipe.target,
  };
  const configureCollisionAreaDamageCommand: ConfigureCollisionAreaDamageBehaviorCommand = {
    entity: "enemy",
    recipe: "collisionAreaDamage",
    tags: [],
    type: "configureCollisionAreaDamage",
    amount: resolvedCollisionAreaDamageBehaviorRecipe.amount,
    radius: resolvedCollisionAreaDamageBehaviorRecipe.radius,
    targetLayer: resolvedCollisionAreaDamageBehaviorRecipe.targetLayer,
  };
  const configureCollisionKnockbackCommand: ConfigureCollisionKnockbackBehaviorCommand = {
    entity: "enemy",
    recipe: "collisionKnockback",
    tags: [],
    type: "configureCollisionKnockback",
    target: resolvedCollisionKnockbackBehaviorRecipe.target,
    impulse: resolvedCollisionKnockbackBehaviorRecipe.impulse,
  };
  const configureCollisionEmitEffectCommand: ConfigureCollisionEmitEffectBehaviorCommand = {
    entity: "enemy",
    recipe: "collisionEmitEffect",
    tags: [],
    type: "configureCollisionEmitEffect",
    effect: resolvedCollisionEmitEffectBehaviorRecipe.effect,
    effectId: resolvedCollisionEmitEffectBehaviorRecipe.effectId,
    effectKind: resolvedCollisionEmitEffectBehaviorRecipe.effectKind,
    effectType: resolvedCollisionEmitEffectBehaviorRecipe.effectType,
    target: resolvedCollisionEmitEffectBehaviorRecipe.target,
    intensity: resolvedCollisionEmitEffectBehaviorRecipe.intensity,
    radius: resolvedCollisionEmitEffectBehaviorRecipe.radius,
    cooldownSeconds: resolvedCollisionEmitEffectBehaviorRecipe.cooldownSeconds,
    trigger: resolvedCollisionEmitEffectBehaviorRecipe.trigger,
  };
  const configureCollisionSpawnPrefabCommand: ConfigureCollisionSpawnPrefabBehaviorCommand = {
    entity: "enemy",
    recipe: "collisionSpawnPrefab",
    tags: [],
    type: "configureCollisionSpawnPrefab",
    action: resolvedCollisionSpawnPrefabBehaviorRecipe.action,
    actionId: resolvedCollisionSpawnPrefabBehaviorRecipe.actionId,
    prefab: resolvedCollisionSpawnPrefabBehaviorRecipe.prefab,
    prefabId: resolvedCollisionSpawnPrefabBehaviorRecipe.prefabId,
    target: resolvedCollisionSpawnPrefabBehaviorRecipe.target,
    cooldownSeconds: resolvedCollisionSpawnPrefabBehaviorRecipe.cooldownSeconds,
    trigger: resolvedCollisionSpawnPrefabBehaviorRecipe.trigger,
    offsetX: resolvedCollisionSpawnPrefabBehaviorRecipe.offsetX,
    offsetY: resolvedCollisionSpawnPrefabBehaviorRecipe.offsetY,
  };
  const configureCollisionSoundCommand: ConfigureCollisionSoundBehaviorCommand = {
    entity: "enemy",
    recipe: "collisionSound",
    tags: [],
    type: "configureCollisionSound",
    soundId: resolvedCollisionSoundBehaviorRecipe.soundId,
    volume: resolvedCollisionSoundBehaviorRecipe.volume,
    pitch: resolvedCollisionSoundBehaviorRecipe.pitch,
    cooldownSeconds: resolvedCollisionSoundBehaviorRecipe.cooldownSeconds,
    trigger: resolvedCollisionSoundBehaviorRecipe.trigger,
  };
  const configureCollisionParticleCommand: ConfigureCollisionParticleBehaviorCommand = {
    entity: "enemy",
    recipe: "collisionParticle",
    tags: [],
    type: "configureCollisionParticle",
    presetId: resolvedCollisionParticleBehaviorRecipe.presetId,
    target: resolvedCollisionParticleBehaviorRecipe.target,
  };
  const configureCollisionShakeCommand: ConfigureCollisionShakeBehaviorCommand = {
    entity: "enemy",
    recipe: "collisionShake",
    tags: [],
    type: "configureCollisionShake",
    cooldownSeconds: resolvedCollisionShakeBehaviorRecipe.cooldownSeconds,
    trigger: resolvedCollisionShakeBehaviorRecipe.trigger,
  };
  const configureCollisionDespawnCommand: ConfigureCollisionDespawnBehaviorCommand = {
    entity: "enemy",
    recipe: "collisionDespawn",
    tags: [],
    type: "configureCollisionDespawn",
    target: resolvedCollisionDespawnBehaviorRecipe.target,
  };
  const configureProjectileActionCommand: ConfigureProjectileActionBehaviorCommand = {
    entity: "enemy",
    recipe: "projectileAction",
    tags: [],
    type: "configureProjectileAction",
    action: resolvedProjectileActionBehaviorRecipe.action,
    actionId: resolvedProjectileActionBehaviorRecipe.actionId,
    cooldownSeconds: resolvedProjectileActionBehaviorRecipe.cooldownSeconds,
    speed: resolvedProjectileActionBehaviorRecipe.speed,
    damage: resolvedProjectileActionBehaviorRecipe.damage,
    lifetimeSeconds: resolvedProjectileActionBehaviorRecipe.lifetimeSeconds,
    aim: resolvedProjectileActionBehaviorRecipe.aim,
    collisionTarget: resolvedProjectileActionBehaviorRecipe.collisionTarget,
    tileImpact: resolvedProjectileActionBehaviorRecipe.tileImpact,
  };
  const configureDashActionCommand: ConfigureDashActionBehaviorCommand = {
    entity: "enemy",
    recipe: "dashAction",
    tags: [],
    type: "configureDashAction",
    action: resolvedDashActionBehaviorRecipe.action,
    actionId: resolvedDashActionBehaviorRecipe.actionId,
    cooldownSeconds: resolvedDashActionBehaviorRecipe.cooldownSeconds,
    distance: resolvedDashActionBehaviorRecipe.distance,
    aim: resolvedDashActionBehaviorRecipe.aim,
  };
  const configureMeleeActionCommand: ConfigureMeleeActionBehaviorCommand = {
    entity: "enemy",
    recipe: "meleeAction",
    tags: [],
    type: "configureMeleeAction",
    action: resolvedMeleeActionBehaviorRecipe.action,
    actionId: resolvedMeleeActionBehaviorRecipe.actionId,
    cooldownSeconds: resolvedMeleeActionBehaviorRecipe.cooldownSeconds,
    range: resolvedMeleeActionBehaviorRecipe.range,
    damage: resolvedMeleeActionBehaviorRecipe.damage,
  };
  const configureSpawnPrefabActionCommand: ConfigureSpawnPrefabActionBehaviorCommand = {
    entity: "enemy",
    recipe: "spawnPrefabAction",
    tags: [],
    type: "configureSpawnPrefabAction",
    action: resolvedSpawnPrefabActionBehaviorRecipe.action,
    actionId: resolvedSpawnPrefabActionBehaviorRecipe.actionId,
    prefab: resolvedSpawnPrefabActionBehaviorRecipe.prefab,
    prefabId: resolvedSpawnPrefabActionBehaviorRecipe.prefabId,
    cooldownSeconds: resolvedSpawnPrefabActionBehaviorRecipe.cooldownSeconds,
    anchor: resolvedSpawnPrefabActionBehaviorRecipe.anchor,
    phase: resolvedSpawnPrefabActionBehaviorRecipe.phase,
    offsetX: resolvedSpawnPrefabActionBehaviorRecipe.offsetX,
    offsetY: resolvedSpawnPrefabActionBehaviorRecipe.offsetY,
  };
  const configureTimerTriggerCommand: ConfigureTimerTriggerBehaviorCommand = {
    entity: "enemy",
    recipe: "timerTrigger",
    tags: [],
    type: "configureTimerTrigger",
    timer: resolvedTimerTriggerBehaviorRecipe.timer,
    timerId: resolvedTimerTriggerBehaviorRecipe.timerId,
    seconds: resolvedTimerTriggerBehaviorRecipe.seconds,
  };
  const behaviorStateMachineRuntimeEngine: BehaviorStateMachineRuntimeEngine = {
    clear_gameplay_behavior_state_machine: () => true,
    set_gameplay_behavior_state_machine: () => true,
    add_gameplay_behavior_transition: () => true,
    add_gameplay_behavior_event_transition: () => true,
  };
  const behaviorStateMachineRuntimeOptions: BehaviorStateMachineRuntimeInstallOptions = {
    behaviorRecipes: resolvedBehaviorRecipeDocument,
  };
  const publicBehaviorStateMachineRuntimeMaxTransitions:
    typeof BEHAVIOR_STATE_MACHINE_RUNTIME_MAX_TRANSITIONS =
      BEHAVIOR_STATE_MACHINE_RUNTIME_MAX_TRANSITIONS;
  const publicCreateBehaviorStateMachineRuntimeInstallPlan:
    PublicApi["createBehaviorStateMachineRuntimeInstallPlan"] =
      createBehaviorStateMachineRuntimeInstallPlan;
  const publicCreateBehaviorStateMachineStateCommandPlan:
    PublicApi["createBehaviorStateMachineStateCommandPlan"] =
      createBehaviorStateMachineStateCommandPlan;
  const publicCreateBehaviorStateMachineCurrentStateCommandPlan:
    PublicApi["createBehaviorStateMachineCurrentStateCommandPlan"] =
      createBehaviorStateMachineCurrentStateCommandPlan;
  const publicInstallBehaviorStateMachineRuntime: PublicApi["installBehaviorStateMachineRuntime"] =
    installBehaviorStateMachineRuntime;
  const behaviorStateMachineRuntimeInstallPlan: BehaviorStateMachineRuntimeInstallPlan =
    publicCreateBehaviorStateMachineRuntimeInstallPlan(
      resolvedBehaviorStateMachineDocument,
      "enemyAi",
      behaviorStateMachineRuntimeOptions,
    );
  const behaviorStateMachineRuntimeStateId: BehaviorStateMachineRuntimeStateId =
    behaviorStateMachineRuntimeInstallPlan.states[0];
  const behaviorStateMachineRuntimeTransition: BehaviorStateMachineRuntimeTransitionInstall =
    behaviorStateMachineRuntimeInstallPlan.transitions[0];
  const behaviorStateMachineRuntimeStateQueryEngine: BehaviorStateMachineRuntimeStateQueryEngine = {
    gameplay_behavior_state: () => behaviorStateMachineRuntimeStateId.stateId,
  };
  const behaviorStateMachineStateCommandOptions: BehaviorStateMachineStateCommandOptions = {
    entity: "a.enemy",
    kinds: ["lifetime"],
  };
  const behaviorStateMachineStateCommandApplyMode: BehaviorStateMachineStateCommandApplyMode = "overlay";
  const behaviorStateMachineStateCommandPlan: BehaviorStateMachineStateCommandPlan =
    publicCreateBehaviorStateMachineStateCommandPlan(
      resolvedBehaviorStateMachineDocument,
      resolvedBehaviorRecipeDocument,
      behaviorStateMachineRuntimeInstallPlan,
      behaviorStateMachineRuntimeStateId.stateId,
      behaviorStateMachineStateCommandOptions,
    );
  const behaviorStateMachineCurrentStateCommandPlan: BehaviorStateMachineStateCommandPlan =
    publicCreateBehaviorStateMachineCurrentStateCommandPlan(
      behaviorStateMachineRuntimeStateQueryEngine,
      resolvedBehaviorStateMachineDocument,
      resolvedBehaviorRecipeDocument,
      behaviorStateMachineRuntimeInstallPlan,
      { entityId: 7, entityGeneration: 2 },
      behaviorStateMachineStateCommandOptions,
    );
  const behaviorStateMachineRuntimeInstallResult: BehaviorStateMachineRuntimeInstallResult =
    publicInstallBehaviorStateMachineRuntime(
      behaviorStateMachineRuntimeEngine,
      resolvedBehaviorStateMachineDocument,
      "enemyAi",
      { entityId: 7, entityGeneration: 2 },
      behaviorStateMachineRuntimeOptions,
    );
  const resolvedBehaviorRecipeEntity: ResolvedBehaviorRecipeEntity =
    resolvedBehaviorRecipeDocument.entities.enemy;
  const resolvedBehaviorRecipeBase: ResolvedBehaviorRecipeBase = resolvedBehaviorRecipeEntity.recipes[0];
  const resolvedBehaviorRecipe: ResolvedBehaviorRecipe = resolvedBehaviorRecipeEntity.recipes[1];
  const resolvedHealthBehaviorRecipe: ResolvedHealthBehaviorRecipe =
    resolvedBehaviorRecipeEntity.recipes[0] as ResolvedHealthBehaviorRecipe;
  const resolvedDamageBehaviorRecipe: ResolvedDamageBehaviorRecipe =
    resolvedBehaviorRecipeEntity.recipes[1] as ResolvedDamageBehaviorRecipe;
  const resolvedFactionBehaviorRecipe: ResolvedFactionBehaviorRecipe =
    resolvedBehaviorRecipeEntity.recipes[2] as ResolvedFactionBehaviorRecipe;
  const resolvedChaseBehaviorRecipe: ResolvedChaseBehaviorRecipe =
    resolvedBehaviorRecipeEntity.recipes[3] as ResolvedChaseBehaviorRecipe;
  const resolvedLifetimeBehaviorRecipe: ResolvedLifetimeBehaviorRecipe =
    resolvedBehaviorRecipeEntity.recipes[4] as ResolvedLifetimeBehaviorRecipe;
  const resolvedScoreRewardBehaviorRecipe: ResolvedScoreRewardBehaviorRecipe =
    resolvedBehaviorRecipeEntity.recipes[5] as ResolvedScoreRewardBehaviorRecipe;
  const resolvedPickupBehaviorRecipe: ResolvedPickupBehaviorRecipe =
    resolvedBehaviorRecipeDocument.entities.coin.recipes[0] as ResolvedPickupBehaviorRecipe;
  const resolvedInteractionBehaviorRecipe: ResolvedInteractionBehaviorRecipe =
    resolvedBehaviorRecipeDocument.entities.coin.recipes[1] as ResolvedInteractionBehaviorRecipe;
  const behaviorRecipeCommandOptions: BehaviorRecipeCommandOptions = {
    kinds: ["damage"],
    includeEntityTags: true,
  };
  const behaviorRecipeCommands: BehaviorRecipeCommand[] =
    publicBehaviorRecipeCommandsForEntity(resolvedBehaviorRecipeDocument, "enemy", behaviorRecipeCommandOptions);
  const behaviorRecipeCommandBase: BehaviorRecipeCommandBase = behaviorRecipeCommands[0];
  const tagsBehaviorCommand: ConfigureTagsBehaviorCommand = behaviorRecipeCommands[0] as ConfigureTagsBehaviorCommand;
  const healthBehaviorCommand: ConfigureHealthBehaviorCommand =
    publicBehaviorRecipeCommandsForEntity(resolvedBehaviorRecipeDocument, "enemy")[0] as ConfigureHealthBehaviorCommand;
  const damageBehaviorCommand: ConfigureDamageBehaviorCommand = behaviorRecipeCommands[1] as ConfigureDamageBehaviorCommand;
  const factionBehaviorCommand: ConfigureFactionBehaviorCommand =
    publicBehaviorRecipeCommandsForEntity(resolvedBehaviorRecipeDocument, "enemy", { kinds: ["faction"] })[0] as ConfigureFactionBehaviorCommand;
  const chaseBehaviorCommand: ConfigureChaseBehaviorCommand =
    publicBehaviorRecipeCommandsForEntity(resolvedBehaviorRecipeDocument, "enemy", { kinds: ["chase"] })[0] as ConfigureChaseBehaviorCommand;
  const pickupBehaviorCommand: ConfigurePickupBehaviorCommand =
    publicBehaviorRecipeCommandsForEntity(resolvedBehaviorRecipeDocument, "coin", { kinds: ["pickup"] })[0] as ConfigurePickupBehaviorCommand;
  const interactionBehaviorCommand: ConfigureInteractionBehaviorCommand =
    publicBehaviorRecipeCommandsForEntity(resolvedBehaviorRecipeDocument, "coin", { kinds: ["interaction"] })[0] as ConfigureInteractionBehaviorCommand;
  const lifetimeBehaviorCommand: ConfigureLifetimeBehaviorCommand =
    publicBehaviorRecipeCommandsForEntity(resolvedBehaviorRecipeDocument, "enemy", { kinds: ["lifetime"] })[0] as ConfigureLifetimeBehaviorCommand;
  const scoreRewardBehaviorCommand: ConfigureScoreRewardBehaviorCommand =
    publicBehaviorRecipeCommandsForEntity(resolvedBehaviorRecipeDocument, "enemy", { kinds: ["scoreReward"] })[0] as ConfigureScoreRewardBehaviorCommand;
  const behaviorRecipeRuntimeTarget: BehaviorRecipeRuntimeTarget = {
    applyBehaviorRecipeCommand: (command) => command.type,
  };
  const applyBehaviorRecipesOptions: ApplyBehaviorRecipesOptions = { entity: "coin" };
  const behaviorRecipeApplyResult: BehaviorRecipeApplyResult =
    publicApplyBehaviorRecipes(behaviorRecipeRuntimeTarget, resolvedBehaviorRecipeDocument, applyBehaviorRecipesOptions);
  const missingSceneBehaviorBinding: MissingSceneBehaviorBinding = "ignore";
  const sceneBehaviorBindingOptions: SceneBehaviorBindingOptions = {
    kinds: ["damage"],
    missingBehavior: missingSceneBehaviorBinding,
  };
  const publicGameplayBehaviorBindingProp: typeof GAMEPLAY_BEHAVIOR_BINDING_PROP = GAMEPLAY_BEHAVIOR_BINDING_PROP;
  const publicBindSceneBehaviorRecipes: PublicApi["bindSceneBehaviorRecipes"] = bindSceneBehaviorRecipes;
  const publicClassifySceneInstance: PublicApi["classifySceneInstance"] = classifySceneInstance;
  const publicDryRunSceneBehaviorRecipes: PublicApi["dryRunSceneBehaviorRecipes"] = dryRunSceneBehaviorRecipes;
  const publicApplyGameplayBehaviorCommands: PublicApi["applyGameplayBehaviorCommands"] = applyGameplayBehaviorCommands;
  const publicApplyFactionRelationTable: PublicApi["applyFactionRelationTable"] = applyFactionRelationTable;
  const publicApplySceneBehaviorRecipes: PublicApi["applySceneBehaviorRecipes"] = applySceneBehaviorRecipes;
  const publicCreateGameplayBehaviorRuntimeTarget: PublicApi["createGameplayBehaviorRuntimeTarget"] =
    createGameplayBehaviorRuntimeTarget;
  const sceneBehaviorBindingPlan: SceneBehaviorBindingPlan =
    publicBindSceneBehaviorRecipes(resolvedSceneComposition, resolvedBehaviorRecipeDocument, sceneBehaviorBindingOptions);
  const sceneInstanceAuthoringKind: SceneInstanceAuthoringKind = "actor";
  const classifySceneInstanceOptions: ClassifySceneInstanceOptions = {
    behaviorProp: publicGameplayBehaviorBindingProp,
  };
  const sceneInstanceAuthoringClassification: SceneInstanceAuthoringClassification =
    publicClassifySceneInstance(resolvedSceneCompositionInstance, classifySceneInstanceOptions);
  equal(sceneInstanceAuthoringClassification.kind, sceneInstanceAuthoringKind);
  const boundBehaviorRecipeCommand: BoundBehaviorRecipeCommand = sceneBehaviorBindingPlan.bindings[0];
  const sceneBehaviorBindingDryRun: SceneBehaviorBindingDryRunResult =
    publicDryRunSceneBehaviorRecipes(sceneCompositionSpec, behaviorRecipeDocument);
  const sceneBehaviorDryRunCommandCount = sceneBehaviorBindingDryRun.ok
    ? sceneBehaviorBindingDryRun.plan.commands.length
    : 0;
  const gameplayEntityHandle: GameplayEntityHandle = { entityId: 7, entityGeneration: 2 };
  const gameplayEntityHandleMap: GameplayEntityHandleMap = { "a.enemy": gameplayEntityHandle };
  const gameplayBehaviorRuntimeEngine: Parameters<typeof publicApplyGameplayBehaviorCommands>[0] = {
    gameplay_entity_exists: () => true,
    set_gameplay_health: () => true,
    clear_gameplay_health: () => true,
    set_gameplay_damage: () => true,
    clear_gameplay_damage: () => true,
    set_gameplay_damage_reaction: () => true,
    set_gameplay_faction: () => true,
    clear_gameplay_faction: () => true,
    set_gameplay_tags: () => true,
    clear_gameplay_tags: () => true,
    set_gameplay_lifetime: () => true,
    clear_gameplay_lifetime: () => true,
    set_gameplay_score_reward: () => true,
    clear_gameplay_score_reward: () => true,
    set_gameplay_pickup: () => true,
    clear_gameplay_pickup: () => true,
    set_gameplay_interaction: () => true,
    clear_gameplay_interaction: () => true,
    set_gameplay_timer_trigger: () => true,
    clear_gameplay_timer_trigger: () => true,
    set_gameplay_action_projectile: () => true,
    set_gameplay_action_projectile_with_target: () => true,
    set_gameplay_action_dash: () => true,
    set_gameplay_action_spawn_prefab: () => true,
    clear_gameplay_actions: () => true,
    set_gameplay_movement_chase_player: () => true,
    set_gameplay_movement_chase_entity: () => true,
    add_gameplay_collision_damage: () => true,
    add_gameplay_collision_pickup: () => true,
    add_gameplay_collision_knockback: () => true,
    add_gameplay_collision_emit_effect: () => true,
    add_gameplay_collision_emit_effect_with_payload: () => true,
    add_gameplay_collision_spawn_prefab: () => true,
  };
  const applyGameplayBehaviorCommandsOptions: ApplyGameplayBehaviorCommandsOptions = {
    path: "gameplay",
    ids: gameplayBehaviorRuntimeIds,
  };
  const gameplayBehaviorApplyResult: BehaviorRecipeApplyResult = publicApplyGameplayBehaviorCommands(
    gameplayBehaviorRuntimeEngine,
    sceneBehaviorBindingPlan.commands,
    gameplayEntityHandleMap,
    applyGameplayBehaviorCommandsOptions,
  );
  const factionRelation: FactionRelation = "hostile";
  const factionReference: GameplayFactionReference = "player";
  const factionRelationEntry: FactionRelationEntrySpec = {
    source: factionReference,
    target: "enemy",
    relation: factionRelation,
  };
  const factionRelationTable: FactionRelationTableSpec = {
    defaultRelation: "neutral",
    relations: [factionRelationEntry],
  };
  const factionRelationRuntimeEngine: FactionRelationRuntimeEngine = {
    clear_gameplay_faction_relations: () => {},
    set_gameplay_faction_default_relation: () => true,
    set_gameplay_faction_relation: () => true,
  };
  const applyFactionRelationTableOptions: ApplyFactionRelationTableOptions = {
    path: "factions",
  };
  const factionRelationApplyResult: ApplyFactionRelationTableResult = publicApplyFactionRelationTable(
    factionRelationRuntimeEngine,
    factionRelationTable,
    applyFactionRelationTableOptions,
  );
  const gameplayBehaviorRuntimeTarget: BehaviorRecipeRuntimeTarget =
    publicCreateGameplayBehaviorRuntimeTarget(gameplayBehaviorRuntimeEngine, gameplayEntityHandleMap);
  const sceneBehaviorRuntimeTarget: SceneBehaviorRuntimeTarget = {
    spawnSceneInstance: () => gameplayEntityHandle,
  };
  const applySceneBehaviorRecipesOptions: ApplySceneBehaviorRecipesOptions = {
    ...sceneBehaviorBindingOptions,
    ids: gameplayBehaviorRuntimeIds,
  };
  const sceneBehaviorApplyResult: SceneBehaviorApplyResult =
    publicApplySceneBehaviorRecipes(
      gameplayBehaviorRuntimeEngine,
      sceneBehaviorRuntimeTarget,
      resolvedSceneComposition,
      resolvedBehaviorRecipeDocument,
      applySceneBehaviorRecipesOptions,
    );
  const publicApplySceneBehaviorRecipesWithFerrumEngine: (
    engine: FerrumEngine,
    target: SceneBehaviorRuntimeTarget,
    composition: ResolvedSceneCompositionSpec,
    recipes: ResolvedBehaviorRecipeDocument,
    options?: ApplySceneBehaviorRecipesOptions,
  ) => SceneBehaviorApplyResult = publicApplySceneBehaviorRecipes;
  equal(typeof publicApplySceneBehaviorRecipesWithFerrumEngine, "function");
  const publicApplyBehaviorStateMachineStateCommands:
    PublicApi["applyBehaviorStateMachineStateCommands"] =
      applyBehaviorStateMachineStateCommands;
  const applyBehaviorStateMachineStateCommandsOptions: ApplyBehaviorStateMachineStateCommandsOptions = {
    entity: "a.enemy",
    ids: gameplayBehaviorRuntimeIds,
    mode: behaviorStateMachineStateCommandApplyMode,
  };
  const behaviorStateMachineStateCommandApplyResult: BehaviorStateMachineStateCommandApplyResult =
    publicApplyBehaviorStateMachineStateCommands(
      gameplayBehaviorRuntimeEngine,
      behaviorStateMachineStateCommandPlan,
      gameplayEntityHandle,
      applyBehaviorStateMachineStateCommandsOptions,
    );
  const publicPreflightBehaviorStateMachineStateCommands:
    PublicApi["preflightBehaviorStateMachineStateCommands"] =
      preflightBehaviorStateMachineStateCommands;
  const behaviorStateMachineStateCommandPreflightResult: BehaviorStateMachineStateCommandPreflightResult =
    publicPreflightBehaviorStateMachineStateCommands(
      gameplayBehaviorRuntimeEngine,
      behaviorStateMachineStateCommandPlan,
      gameplayEntityHandle,
      applyBehaviorStateMachineStateCommandsOptions,
    );
  const unknownGameplayEventPolicy: UnknownGameplayEventPolicy = "error";
  const gameplayEventActionNameMap: GameplayEventActionNameMap = { 2: "inspect" };
  const gameplayInteractionActionMetadata: GameplayInteractionActionMetadata = {
    actionId: 2,
    action: "inspect",
    prompt: "Inspect",
  };
  const gameplayEventActionMetadataMap: GameplayEventActionMetadataMap = {
    2: gameplayInteractionActionMetadata,
  };
  const gameplayEventActionMetadataOptions: GameplayEventActionMetadataOptions = {
    ids: gameplayBehaviorRuntimeIds,
  };
  const publicGameplayEventActionMetadataForCommands: PublicApi["gameplayEventActionMetadataForCommands"] =
    gameplayEventActionMetadataForCommands;
  const gameplayEventActionOptions: GameplayEventActionOptions = {
    actionNames: gameplayEventActionNameMap,
    actionMetadata: gameplayEventActionMetadataMap,
    requireActionNames: true,
    unknownEvent: unknownGameplayEventPolicy,
  };
  const gameplayEventActionTarget: GameplayEventActionTarget = {
    applyGameplayEventAction: (action) => action.type,
  };
  const publicApplyGameplayEventActions: PublicApi["applyGameplayEventActions"] =
    applyGameplayEventActions;
  const gameplayEventActionApplyResult: GameplayEventActionApplyResult =
    publicApplyGameplayEventActions(gameplayEventActionTarget, [
      {
        kind: "interaction",
        kindCode: 1,
        actorId: 7,
        actorGeneration: 2,
        sourceId: 8,
        sourceGeneration: 3,
        tokenId: 2,
        flags: 1,
        payloadBits: 0,
        once: true,
        consumedThisFrame: false,
        targetRemoved: false,
      },
    ], gameplayEventActionOptions);
  const gameplayEventAction: GameplayEventAction = gameplayEventActionApplyResult.actions[0];
  const gameplayInteractionEventAction: GameplayInteractionEventAction =
    gameplayEventAction as GameplayInteractionEventAction;
  const gameplayCollisionDamageEventAction: GameplayCollisionDamageEventAction = {
    type: "collisionDamage",
    actor: gameplayEntityHandle,
    source: gameplayEntityHandle,
    damage: 1,
    targetRemoved: true,
    flags: 4,
    payloadBits: 0x3f800000,
    event: gameplayEventActionApplyResult.events[0],
  };
  const gameplayCollisionDespawnEventAction: GameplayCollisionDespawnEventAction = {
    type: "collisionDespawn",
    actor: gameplayEntityHandle,
    source: gameplayEntityHandle,
    targetRemoved: true,
    flags: 4,
    payloadBits: 0,
    event: gameplayEventActionApplyResult.events[0],
  };
  const gameplayPrefabSpawnedEventAction: GameplayPrefabSpawnedEventAction = {
    type: "prefabSpawned",
    actor: gameplayEntityHandle,
    source: gameplayEntityHandle,
    prefabId: 1,
    actionId: 11,
    flags: 0,
    payloadBits: 11,
    event: gameplayEventActionApplyResult.events[0],
  };
  equal(gameplayPrefabSpawnedEventAction.actionId, 11);
  const gameplayActionFailureReason: GameplayActionFailureReason = "spawnQueueFull";
  const gameplayActionFailedEventAction: GameplayActionFailedEventAction = {
    type: "actionFailed",
    actor: gameplayEntityHandle,
    source: gameplayEntityHandle,
    actionId: 11,
    reasonCode: 5,
    reason: gameplayActionFailureReason,
    flags: 0,
    payloadBits: 5,
    event: gameplayEventActionApplyResult.events[0],
  };
  equal(gameplayActionFailedEventAction.reason, "spawnQueueFull");
  equal(gameplayActionFailureReasonForCode(5), "spawnQueueFull");
  const gameplayActionDiagnosticCode: GameplayActionDiagnosticCode = "FERRUM_GAMEPLAY_ACTION_TRIGGER_FAILURE";
  const gameplayActionDiagnosticValue: GameplayActionDiagnosticValue = 0;
  const gameplayActionDiagnosticOptions: GameplayActionDiagnosticReportOptions = {
    actionFailures: [gameplayActionFailedEventAction],
    actionNames: { 11: "summon" },
  };
  const gameplayActionDiagnosticReportsResult = gameplayActionDiagnosticReports({
    triggerAttempts: 1,
    triggerFailures: 1,
    triggerFailureEventsPushed: 1,
    triggerCommitSkips: 0,
    lastPreparedTriggerFailureReasonCode: 5,
    failureReasonCounts: [0, 0, 0, 0, 0, 1],
  }, gameplayActionDiagnosticOptions);
  const gameplayActionDiagnosticReport: GameplayActionDiagnosticReport = gameplayActionDiagnosticReportsResult[0] ?? {
    kind: "gameplay-action",
    code: gameplayActionDiagnosticCode,
    path: "frame.actionDiagnostics.failureReasonCounts.5",
    message: "example",
    expected: gameplayActionDiagnosticValue,
    actual: 1,
    suggestion: "example",
  };
  equal(gameplayActionDiagnosticReport.kind, "gameplay-action");
  const gameplaySpawnDiagnosticCode: GameplaySpawnDiagnosticCode = "FERRUM_GAMEPLAY_SPAWN_FLUSH_EXPECTATION_MISMATCH";
  const gameplaySpawnDiagnosticValue: GameplaySpawnDiagnosticValue = 1;
  const gameplaySpawnDiagnosticMetric: GameplaySpawnDiagnosticMetric = "prefabSpawns";
  const gameplaySpawnDiagnosticExpectation: GameplaySpawnDiagnosticExpectation = {
    metric: gameplaySpawnDiagnosticMetric,
    expected: 1,
  };
  const gameplaySpawnDiagnosticOptions: GameplaySpawnDiagnosticReportOptions = {
    expectations: [gameplaySpawnDiagnosticExpectation],
  };
  const gameplaySpawnDiagnosticReportsResult = gameplaySpawnDiagnosticReports({
    commandsDrained: 0,
    projectileSpawns: 0,
    projectileArcsApplied: 0,
    projectileShootAudioEventsPushed: 0,
    prefabSpawns: 0,
    prefabSpawnedPayloads: 0,
    prefabSpawnedEventsPushed: 0,
  }, gameplaySpawnDiagnosticOptions);
  const gameplaySpawnDiagnosticReport: GameplaySpawnDiagnosticReport = gameplaySpawnDiagnosticReportsResult[0] ?? {
    kind: "gameplay-spawn",
    code: gameplaySpawnDiagnosticCode,
    path: "frame.spawnDiagnostics.prefabSpawns",
    message: "example",
    expected: gameplaySpawnDiagnosticValue,
    actual: 0,
    suggestion: "example",
    metric: gameplaySpawnDiagnosticMetric,
  };
  equal(gameplaySpawnDiagnosticReport.kind, "gameplay-spawn");
  const gameplayBehaviorStateChangedEventAction: GameplayBehaviorStateChangedEventAction = {
    type: "behaviorStateChanged",
    actor: gameplayEntityHandle,
    source: gameplayEntityHandle,
    previousStateId: 1,
    nextStateId: 2,
    flags: 0,
    payloadBits: 1,
    event: gameplayEventActionApplyResult.events[0],
  };
  equal(gameplayBehaviorStateChangedEventAction.nextStateId, 2);
  const gameplayTimerEventAction: GameplayTimerEventAction = {
    type: "timer",
    actor: gameplayEntityHandle,
    source: gameplayEntityHandle,
    timerId: 6,
    durationSeconds: 0.5,
    flags: 0,
    payloadBits: 0x3f000000,
    event: gameplayEventActionApplyResult.events[0],
  };
  const gameplayPickupCollectedEventAction: GameplayPickupCollectedEventAction = {
    type: "pickupCollected",
    actor: gameplayEntityHandle,
    source: gameplayEntityHandle,
    itemId: 1,
    count: 3,
    targetRemoved: true,
    flags: 4,
    payloadBits: 3,
    event: gameplayEventActionApplyResult.events[0],
  };
  const gameplayTileImpactPolicy: GameplayTileImpactPolicy = gameplayTileImpactForCode(2);
  const gameplayTileImpactNormal: GameplayTileImpactNormal = gameplayTileImpactNormalForFlags(8 | (1 << 8));
  const gameplayTileImpactEventAction: GameplayTileImpactEventAction = {
    type: "tileImpact",
    actor: gameplayEntityHandle,
    source: gameplayEntityHandle,
    projectile: gameplayEntityHandle,
    tileImpactCode: 2,
    tileImpact: gameplayTileImpactPolicy,
    layerIndex: unpackTileImpactLayerIndex(1 << 24),
    tileIndex: unpackTileImpactTileIndex((1 << 24) | 4),
    normal: gameplayTileImpactNormal,
    bounced: true,
    identityTruncated: false,
    targetRemoved: false,
    flags: 8 | (1 << 8),
    payloadBits: (1 << 24) | 4,
    event: gameplayEventActionApplyResult.events[0],
  };
  equal(gameplayTileImpactEventAction.tileImpact, "bounce");
  const gameplayFactionDamageDeniedEventAction: GameplayFactionDamageDeniedEventAction = {
    type: "factionDamageDenied",
    actor: gameplayEntityHandle,
    source: gameplayEntityHandle,
    sourceFactionId: 2,
    targetFactionId: 1,
    flags: 0,
    payloadBits: 1,
    event: gameplayEventActionApplyResult.events[0],
  };
  equal(gameplayFactionDamageDeniedEventAction.sourceFactionId, 2);
  const gameplayPresentationEffectKind: GameplayPresentationEffectKind = "custom";
  const gameplayPresentationEffectEventAction: GameplayPresentationEffectEventAction = {
    type: "presentationEffect",
    actor: gameplayEntityHandle,
    source: gameplayEntityHandle,
    effectId: 99,
    effectType: GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
    effectKind: gameplayPresentationEffectKind,
    flags: 0,
    payloadBits: GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
    event: gameplayEventActionApplyResult.events[0],
  };
  equal(gameplayPresentationEffectEventAction.effectType, GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM);
  const presentationEffectKindForRegistry: PresentationEffectKind = "custom";
  const presentationEffectDefinitionSpec: PresentationEffectDefinitionSpec = {
    effectId: 99,
    kind: presentationEffectKindForRegistry,
    key: "impact-spark",
    intensity: 1,
    tags: ["impact"],
  };
  const presentationEffectRegistrySpec: PresentationEffectRegistrySpec = {
    impactSpark: presentationEffectDefinitionSpec,
  };
  const presentationEffectRegistryOptions: ResolvePresentationEffectRegistryOptions = {
    ids: gameplayBehaviorRuntimeIds,
  };
  const resolvedPresentationEffectRegistry: ResolvedPresentationEffectRegistry =
    resolvePresentationEffectRegistry(presentationEffectRegistrySpec, presentationEffectRegistryOptions);
  const resolvedPresentationEffectDefinition: ResolvedPresentationEffectDefinition =
    resolvedPresentationEffectRegistry.effects.impactSpark;
  const presentationEffectBindingOptions: PresentationEffectActionBindingOptions = {
    requireKindMatch: true,
  };
  const presentationEffectBindings: readonly PresentationEffectActionBinding[] =
    bindPresentationEffectActions([gameplayPresentationEffectEventAction], resolvedPresentationEffectRegistry, presentationEffectBindingOptions);
  equal(resolvedPresentationEffectDefinition.effectId, 99);
  equal(presentationEffectBindings[0]?.effect.effect, "impactSpark");
  equal(GAMEPLAY_EVENT_KIND_PRESENTATION_EFFECT, 11);
  const effectEventBuffer: EffectEventBufferView = {
    buffer: new DataView(new ArrayBuffer(0)),
    eventCount: 0,
    bytesPerEvent: BYTES_PER_EFFECT_EVENT,
  };
  const publicDecodeEffectEvents: PublicApi["decodeEffectEvents"] = decodeEffectEvents;
  const effectEvents: readonly EffectEventView[] = publicDecodeEffectEvents(effectEventBuffer);
  equal(effectEvents, EMPTY_EFFECT_EVENTS);
  const effectEventDispatchOptions: EffectEventDispatchOptions = { unknownEffect: "passthrough" };
  const unknownEffectEventPolicy: UnknownEffectEventPolicy = "passthrough";
  const missingEffectEventHandlerPolicy: MissingEffectEventHandlerPolicy = "ignore";
  const customEffectEvent: EffectEventView = {
    effectId: 99,
    effectType: GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
    effectKind: "custom",
    actorId: gameplayEntityHandle.entityId,
    actorGeneration: gameplayEntityHandle.entityGeneration,
    sourceId: gameplayEntityHandle.entityId,
    sourceGeneration: gameplayEntityHandle.entityGeneration,
    x: 4,
    y: 5,
    intensity: 1,
    radius: 0,
  };
  const publicEffectDispatchesForEvents: PublicApi["effectDispatchesForEvents"] =
    effectDispatchesForEvents;
  const effectEventDispatches: readonly EffectEventDispatch[] =
    publicEffectDispatchesForEvents([customEffectEvent], resolvedPresentationEffectRegistry, effectEventDispatchOptions);
  const customEffectDispatches: EffectCustomEventDispatch[] = [];
  const effectEventDispatchTarget: EffectEventDispatchTarget = {
    applyCustomEffect: (dispatch) => {
      customEffectDispatches.push(dispatch);
    },
  };
  const publicDispatchEffectEvents: PublicApi["dispatchEffectEvents"] = dispatchEffectEvents;
  const effectEventDispatchSummary: EffectEventDispatchSummary =
    publicDispatchEffectEvents([customEffectEvent], resolvedPresentationEffectRegistry, effectEventDispatchTarget, {
      unknownEffect: unknownEffectEventPolicy,
      missingHandler: missingEffectEventHandlerPolicy,
    });
  const effectEventDispatchTargetFactoryOptions: EffectEventDispatchTargetFactoryOptions = {
    assetValidation: "ignore",
    target: effectEventDispatchTarget,
  };
  const publicCreateEffectEventDispatchTarget: PublicApi["createEffectEventDispatchTarget"] =
    createEffectEventDispatchTarget;
  const runtimeEffectEventDispatchTarget: EffectEventDispatchTarget =
    publicCreateEffectEventDispatchTarget(effectEventDispatchTargetFactoryOptions);
  const runtimeEffectEventFrame: FrameState = {
    effectEvents: [customEffectEvent],
  } as unknown as FrameState;
  const effectEventRuntimeOptions: EffectEventRuntimeOptions = {
    registry: resolvedPresentationEffectRegistry,
    assetValidation: "ignore",
    target: runtimeEffectEventDispatchTarget,
    onDispatchSummary: (summary) => {
      equal(summary.customEffects, 1);
    },
  };
  const publicDispatchRuntimeEffectEvents: PublicApi["dispatchRuntimeEffectEvents"] =
    dispatchRuntimeEffectEvents;
  const effectEventAssetValidationPolicy: EffectEventAssetValidationPolicy = "error";
  const runtimeEffectEventDispatchSummary: EffectEventDispatchSummary =
    publicDispatchRuntimeEffectEvents(
      runtimeEffectEventFrame,
      effectEventRuntimeOptions,
      runtimeEffectEventDispatchTarget,
    );
  equal(effectEventDispatches[0]?.kind, "custom");
  equal(customEffectDispatches[0]?.effect?.effect, "impactSpark");
  equal(effectEventDispatchSummary.customEffects, 1);
  equal(effectEventAssetValidationPolicy, "error");
  equal(runtimeEffectEventDispatchSummary.customEffects, 1);
  const behaviorStateMachineReplayFrame: BehaviorStateMachineReplayFrame = {
    frame: 0,
    events: [gameplayInteractionEventAction, gameplayCollisionDamageEventAction, gameplayTimerEventAction],
  };
  const behaviorStateMachineReplayEntity: GameplayEntityHandle = { entityId: 8, entityGeneration: 3 };
  const behaviorStateMachineReplayInput: BehaviorStateMachineReplayInput = {
    machine: "enemyAi",
    entity: behaviorStateMachineReplayEntity,
    frames: [behaviorStateMachineReplayFrame],
  };
  const behaviorStateMachineReplayOptions: BehaviorStateMachineReplayOptions = {
    path: "fsmReplay",
  };
  const publicRunBehaviorStateMachineReplay: PublicApi["runBehaviorStateMachineReplay"] =
    runBehaviorStateMachineReplay;
  const behaviorStateMachineReplayResult: BehaviorStateMachineReplayResult =
    publicRunBehaviorStateMachineReplay(
      resolvedBehaviorStateMachineDocument,
      behaviorStateMachineReplayInput,
      behaviorStateMachineReplayOptions,
    );
  const behaviorStateMachineReplayStep: BehaviorStateMachineReplayStep =
    behaviorStateMachineReplayResult.steps[0];
  const behaviorStateMachineReplayResultEntity: GameplayEntityHandle = behaviorStateMachineReplayResult.entity;
  const behaviorStateMachineReplayEvent: BehaviorStateMachineReplayEventMatch =
    behaviorStateMachineReplayStep.event as BehaviorStateMachineReplayEventMatch;
  const publicCompareBehaviorStateMachineReplay: PublicApi["compareBehaviorStateMachineReplay"] =
    compareBehaviorStateMachineReplay;
  const behaviorStateMachineReplayComparison: BehaviorStateMachineReplayComparison =
    publicCompareBehaviorStateMachineReplay(behaviorStateMachineReplayResult, behaviorStateMachineReplayResult);
  const gameplayReplayRunFormat: typeof GAMEPLAY_REPLAY_RUN_FORMAT = GAMEPLAY_REPLAY_RUN_FORMAT;
  const gameplayReplayRunVersion: typeof GAMEPLAY_REPLAY_RUN_VERSION = GAMEPLAY_REPLAY_RUN_VERSION;
  const gameplayReplaySnapshotBase: Omit<GameStateSnapshot, "snapshotHash"> = {
    format: "ferrum2d.game-state.snapshot",
    version: 1,
    frame: 0,
    source: "ferrum-runtime",
    scene: {
      score: 0,
      gameState: 1,
      entityCount: 1,
      spriteCount: 1,
      cameraX: 0,
      cameraY: 0,
    },
  };
  const gameplayReplaySnapshot: GameStateSnapshot = {
    ...gameplayReplaySnapshotBase,
    snapshotHash: hashGameStateSnapshot(gameplayReplaySnapshotBase),
  };
  const publicCreateGameplayReplayRun: PublicApi["createGameplayReplayRun"] = createGameplayReplayRun;
  const publicHashGameplayReplayRun: PublicApi["hashGameplayReplayRun"] = hashGameplayReplayRun;
  const publicCompareGameplayReplayRuns: PublicApi["compareGameplayReplayRuns"] = compareGameplayReplayRuns;
  const gameplayReplayRun: GameplayReplayRun = publicCreateGameplayReplayRun([gameplayReplaySnapshot]);
  const gameplayReplayFrameSnapshot: GameplayReplayFrameSnapshot = gameplayReplayRun.snapshots[0];
  const gameplayReplayHash: string = publicHashGameplayReplayRun(gameplayReplayRun);
  const gameplayReplayComparison: GameplayReplayComparison =
    publicCompareGameplayReplayRuns(gameplayReplayRun, gameplayReplayRun);
  const gameplayReplayDiff: GameplayReplaySnapshotDiff | undefined = gameplayReplayComparison.firstMismatch;
  const cameraPoint: CameraPoint = { x: 10, y: 12 };
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
  equal(resolvedFactionBehaviorRecipe.faction, "enemy");
  equal(resolvedFactionBehaviorRecipe.damages[0], "player");
  equal(resolvedChaseBehaviorRecipe.target, "player");
  equal(resolvedLifetimeBehaviorRecipe.seconds, 0.5);
  equal(resolvedScoreRewardBehaviorRecipe.reward, 2);
  equal(resolvedPickupBehaviorRecipe.item, "coin");
  equal(resolvedPickupBehaviorRecipe.itemId, 1);
  equal(resolvedInteractionBehaviorRecipe.action, "inspect");
  equal(resolvedInteractionBehaviorRecipe.actionId, 2);
  equal(resolvedProjectileActionBehaviorRecipe.action, "primary");
  equal(resolvedProjectileActionBehaviorRecipe.actionId, 1);
  equal(resolvedDashActionBehaviorRecipe.action, "dash");
  equal(resolvedDashActionBehaviorRecipe.distance, 96);
  equal(resolvedDashActionBehaviorRecipe.aim, "input");
  equal(resolvedMeleeActionBehaviorRecipe.action, "slash");
  equal(resolvedMeleeActionBehaviorRecipe.range, 36);
  equal(resolvedSpawnPrefabActionBehaviorRecipe.action, "summon");
  equal(resolvedSpawnPrefabActionBehaviorRecipe.prefabId, 1);
  equal(behaviorRecipeKind, "health");
  equal(healthBehaviorCommand.type, "configureHealth");
  equal(tagsBehaviorCommand.type, "configureTags");
  equal(tagsBehaviorCommand.tags[0], "hostile");
  equal(damageBehaviorCommand.amount, 2);
  equal(factionBehaviorCommand.type, "configureFaction");
  equal(factionBehaviorCommand.faction, "enemy");
  equal(chaseBehaviorCommand.type, "configureChase");
  equal(lifetimeBehaviorCommand.seconds, 0.5);
  equal(scoreRewardBehaviorCommand.reward, 2);
  equal(resolvedCollisionPickupBehaviorRecipe.target, "self");
  equal(configureCollisionPickupCommand.type, "configureCollisionPickup");
  equal(resolvedCollisionAreaDamageBehaviorRecipe.radius, 72);
  equal(configureCollisionAreaDamageCommand.type, "configureCollisionAreaDamage");
  equal(resolvedCollisionKnockbackBehaviorRecipe.impulse, 180);
  equal(configureCollisionKnockbackCommand.type, "configureCollisionKnockback");
  equal(resolvedCollisionEmitEffectBehaviorRecipe.effectKind, "custom");
  equal(resolvedCollisionEmitEffectBehaviorRecipe.effectType, GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM);
  equal(resolvedCollisionEmitEffectBehaviorRecipe.intensity, 0.65);
  equal(resolvedCollisionEmitEffectBehaviorRecipe.radius, 48);
  equal(configureCollisionEmitEffectCommand.type, "configureCollisionEmitEffect");
  equal(configureCollisionEmitEffectCommand.intensity, 0.65);
  equal(configureCollisionEmitEffectCommand.radius, 48);
  equal(configureCollisionEmitEffectCommand.trigger, "enter");
  equal(resolvedCollisionSpawnPrefabBehaviorRecipe.actionId, 7);
  equal(resolvedCollisionSpawnPrefabBehaviorRecipe.prefabId, 1);
  equal(configureCollisionSpawnPrefabCommand.type, "configureCollisionSpawnPrefab");
  equal(configureCollisionSpawnPrefabCommand.offsetY, -3);
  equal(resolvedCollisionSoundBehaviorRecipe.soundId, 2);
  equal(configureCollisionSoundCommand.type, "configureCollisionSound");
  equal(resolvedCollisionParticleBehaviorRecipe.presetId, 3);
  equal(configureCollisionParticleCommand.type, "configureCollisionParticle");
  equal(resolvedCollisionShakeBehaviorRecipe.trigger, "enter");
  equal(configureCollisionShakeCommand.type, "configureCollisionShake");
  equal(resolvedCollisionDespawnBehaviorRecipe.target, "self");
  equal(configureCollisionDespawnCommand.type, "configureCollisionDespawn");
  equal(pickupBehaviorCommand.type, "configurePickup");
  equal(pickupBehaviorCommand.itemId, 1);
  equal(interactionBehaviorCommand.type, "configureInteraction");
  equal(interactionBehaviorCommand.actionId, 2);
  equal(configureProjectileActionCommand.type, "configureProjectileAction");
  equal(configureProjectileActionCommand.speed, 360);
  equal(configureDashActionCommand.type, "configureDashAction");
  equal(configureDashActionCommand.distance, 96);
  equal(configureDashActionCommand.aim, "input");
  equal(configureMeleeActionCommand.type, "configureMeleeAction");
  equal(configureMeleeActionCommand.damage, 3);
  equal(configureSpawnPrefabActionCommand.type, "configureSpawnPrefabAction");
  equal(configureSpawnPrefabActionCommand.phase, "prePhysics");
  equal(configureTimerTriggerCommand.type, "configureTimerTrigger");
  equal(configureTimerTriggerCommand.timerId, 6);
  equal(behaviorRecipeCommandBase.entity, "enemy");
  equal(behaviorRecipeCommands.length, 2);
  equal(behaviorRecipeApplyResult.results[0], "configurePickup");
  equal(behaviorRecipeSpec.kind, "damage");
  equal(lifetimeBehaviorRecipe.kind, "lifetime");
  equal(scoreRewardBehaviorRecipe.kind, "scoreReward");
  equal(behaviorRecipeResolveOptions.path, "recipes");
  equal(typeof publicApplyBehaviorRecipes, "function");
  equal(resolvedBehaviorStateMachine.initial, "idle");
  equal(resolvedBehaviorStateMachineState.behaviorRecipes[0], "enemy");
  equal(resolvedBehaviorStateMachineTransition.to, "alert");
  equal(resolvedBehaviorStateMachinePredicate.actionId, 2);
  equal(behaviorStateMachineCollisionEventKind, "collisionDamage");
  equal(behaviorStateMachinePickupEventKind, "pickupCollected");
  equal(
    publicBehaviorStateMachineProfilesForState(resolvedBehaviorStateMachineDocument, "enemyAi", "alert")[0],
    "enemy",
  );
  equal(
    publicBehaviorStateMachineCommandsForState(
      resolvedBehaviorStateMachineDocument,
      resolvedBehaviorRecipeDocument,
      "enemyAi",
      "alert",
      behaviorStateMachineCommandOptions,
    )[0]?.type,
    "configureChase",
  );
  equal(typeof publicResolveBehaviorStateMachineDocument, "function");
  equal(publicBehaviorStateMachineRuntimeMaxTransitions, 32);
  equal(behaviorStateMachineRuntimeInstallPlan.initial, "idle");
  equal(behaviorStateMachineRuntimeStateId.state.length > 0, true);
  equal(behaviorStateMachineRuntimeTransition.actionId, 2);
  equal(behaviorStateMachineRuntimeTransition.eventKind, 1);
  equal(behaviorStateMachineRuntimeTransition.tokenId, 2);
  equal(behaviorStateMachineRuntimeInstallResult.applied, true);
  equal(behaviorStateMachineStateCommandPlan.targetEntity, "a.enemy");
  equal(behaviorStateMachineStateCommandPlan.commands[0]?.entity, "a.enemy");
  equal(behaviorStateMachineCurrentStateCommandPlan.state, behaviorStateMachineStateCommandPlan.state);
  equal(behaviorStateMachineStateCommandApplyResult.plan.targetEntity, "a.enemy");
  equal(behaviorStateMachineStateCommandApplyResult.results[0], true);
  equal(behaviorStateMachineStateCommandPreflightResult.plan.targetEntity, "a.enemy");
  equal(behaviorStateMachineStateCommandPreflightResult.mode, "overlay");
  equal(typeof publicCreateBehaviorStateMachineRuntimeInstallPlan, "function");
  equal(typeof publicCreateBehaviorStateMachineStateCommandPlan, "function");
  equal(typeof publicCreateBehaviorStateMachineCurrentStateCommandPlan, "function");
  equal(typeof publicInstallBehaviorStateMachineRuntime, "function");
  equal(typeof publicApplyBehaviorStateMachineStateCommands, "function");
  equal(typeof publicPreflightBehaviorStateMachineStateCommands, "function");
  equal(publicGameplayBehaviorBindingProp, "behaviorRecipes");
  equal(sceneBehaviorBindingPlan.commands[0]?.entity, "a.enemy");
  equal(boundBehaviorRecipeCommand.behaviorEntity, "enemy");
  equal(sceneBehaviorDryRunCommandCount, 23);
  equal(gameplayBehaviorApplyResult.results[0], true);
  equal(gameplayBehaviorRuntimeTarget.applyBehaviorRecipeCommand(sceneBehaviorBindingPlan.commands[1]), true);
  equal(sceneBehaviorApplyResult.behaviorApplyResult.results[0], true);
  equal(sceneBehaviorApplyResult.spawnResults[0]?.entityId, 7);
  equal(typeof publicBindSceneBehaviorRecipes, "function");
  equal(typeof publicDryRunSceneBehaviorRecipes, "function");
  equal(typeof publicApplyGameplayBehaviorCommands, "function");
  equal(typeof publicApplySceneBehaviorRecipes, "function");
  equal(typeof publicCreateGameplayBehaviorRuntimeTarget, "function");
  equal(gameplayInteractionEventAction.action, "inspect");
  equal(gameplayInteractionEventAction.prompt, "Inspect");
  equal(gameplayInteractionEventAction.source.entityId, 8);
  equal(gameplayEventActionApplyResult.results[0], "interaction");
  equal(gameplayCollisionDamageEventAction.damage, 1);
  equal(gameplayCollisionDespawnEventAction.type, "collisionDespawn");
  equal(gameplayTimerEventAction.timerId, 6);
  equal(gameplayPickupCollectedEventAction.count, 3);
  equal(publicGameplayEventActionMetadataForCommands([interactionBehaviorCommand], gameplayEventActionMetadataOptions)[2]?.prompt, "Inspect");
  const eventActionFromMetadata = gameplayActionsForEvents(
    [gameplayEventActionApplyResult.events[0]],
    { actionMetadata: gameplayEventActionMetadataMap },
  )[0];
  equal(eventActionFromMetadata?.type === "interaction" ? eventActionFromMetadata.prompt : undefined, "Inspect");
  equal(typeof publicApplyGameplayEventActions, "function");
  equal(behaviorStateMachineReplayResult.finalState, "alert");
  equal(behaviorStateMachineReplayResultEntity.entityId, behaviorStateMachineReplayEntity.entityId);
  equal(behaviorStateMachineReplayResult.replayHash.length, 8);
  equal(behaviorStateMachineReplayStep.transition, "idle.0");
  equal(behaviorStateMachineReplayEvent.actionId, 2);
  equal(behaviorStateMachineReplayComparison.passed, true);
  equal(typeof publicRunBehaviorStateMachineReplay, "function");
  equal(typeof publicCompareBehaviorStateMachineReplay, "function");
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
  equal(resolvedCutsceneCommandBase.id, "wait-0");
  equal(resolvedCutsceneCommand.kind, "camera");
  equal(resolvedCutsceneWait.durationSeconds, 0.1);
  equal(resolvedCutsceneCamera.target.x, 10);
  equal(resolvedCutsceneAudio.bus, "bgm");
  equal(resolvedCutsceneDialogue.text, "Ready");
  equal(cutsceneSnapshot.currentCommand?.kind, "wait");
  equal(cutsceneEvent.command.kind, "wait");
});
