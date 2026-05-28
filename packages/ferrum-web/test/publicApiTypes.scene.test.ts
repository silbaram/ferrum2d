import {
  AnimationTimelinePlayer,
  CutsceneSequencePlayer,
  animationTimelineFrameAt,
  applyBehaviorRecipes,
  applyCutsceneSequenceEvent,
  applySceneCompositionFragment,
  behaviorRecipeCommandsForEntity,
  equal,
  instantiateSceneFragment,
  resolveAnimationTimelineSpec,
  resolveBehaviorRecipeDocument,
  resolveCutsceneSequenceSpec,
  resolveSceneCompositionSpec,
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
  ApplySceneCompositionOptions,
  BehaviorRecipeApplyResult,
  BehaviorRecipeCommand,
  BehaviorRecipeCommandBase,
  BehaviorRecipeCommandOptions,
  BehaviorRecipeDamageTarget,
  BehaviorRecipeDocumentSpec,
  BehaviorRecipeEntitySpec,
  BehaviorRecipeEntrySpec,
  BehaviorRecipeHealthZeroAction,
  BehaviorRecipeKind,
  BehaviorRecipeReferenceSpec,
  BehaviorRecipeRuntimeTarget,
  BehaviorRecipeSpec,
  CameraPoint,
  ChaseBehaviorRecipeSpec,
  ConfigureChaseBehaviorCommand,
  ConfigureDamageBehaviorCommand,
  ConfigureHealthBehaviorCommand,
  ConfigureInteractionBehaviorCommand,
  ConfigurePickupBehaviorCommand,
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
  DamageBehaviorRecipeSpec,
  HealthBehaviorRecipeSpec,
  InstantiateSceneFragmentOptions,
  InteractionBehaviorRecipeSpec,
  LocalizationDocumentSpec,
  LocalizationLocaleSpec,
  LocalizationPlaceholderValue,
  LocalizationStringEntrySpec,
  LocalizationStringSpec,
  PickupBehaviorRecipeSpec,
  PublicApi,
  RendererStats,
  ResolveBehaviorRecipeDocumentOptions,
  ResolveCutsceneSequenceOptions,
  ResolveSceneCompositionOptions,
  ResolvedAnimationTimelineEvent,
  ResolvedAnimationTimelineSpec,
  ResolvedAnimationTimelineState,
  ResolvedAnimationTimelineTransition,
  ResolvedBehaviorRecipe,
  ResolvedBehaviorRecipeBase,
  ResolvedBehaviorRecipeDocument,
  ResolvedBehaviorRecipeEntity,
  ResolvedChaseBehaviorRecipe,
  ResolvedCutsceneAudioCommand,
  ResolvedCutsceneCameraCommand,
  ResolvedCutsceneCommandBase,
  ResolvedCutsceneDialogueCommand,
  ResolvedCutsceneSequenceCommand,
  ResolvedCutsceneSequenceSpec,
  ResolvedCutsceneWaitCommand,
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
