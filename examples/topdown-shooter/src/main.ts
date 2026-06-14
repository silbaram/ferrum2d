import {
  BrowserPlatformHost,
  DebugOverlay,
  IndexedDbAssetCache,
  InputManager,
  LoadingOverlay,
  RuntimeProfiler,
  WebGL2Renderer,
  createBehaviorStateMachineRuntimeInstallPlan,
  createEngine,
  GAMEPLAY_PRESENTATION_EFFECT_TYPE_PARTICLE,
  GAMEPLAY_PRESENTATION_EFFECT_TYPE_CAMERA_SHAKE,
  GAMEPLAY_PRESENTATION_EFFECT_TYPE_SOUND,
  AUDIO_CHANNEL_SFX,
  gameplayActionsForEvents,
  createAssetPreloadCachePolicy,
  diagnosticReport,
  dryRunSceneBehaviorRecipes,
  type AudioEventView,
  preloadAssetManifest,
  resolveBehaviorRecipeDocument,
  resolveGameplayBehaviorRuntimeIds,
  resolveBehaviorStateMachineDocument,
  resolveSceneCompositionSpec,
  type AssetLoadProgress,
  type AssetManifest,
  type BehaviorRecipeDocumentSpec,
  type BehaviorStateMachineRuntimeInstallPlan,
  type BehaviorStateMachineStateCommandApplyMode,
  type BehaviorStateMachineDocumentSpec,
  type DiagnosticContext,
  type DiagnosticReport,
  type FerrumEngine,
  type GameplayBehaviorRuntimeIds,
  type GameplayEntityHandle,
  type GameplayEventView,
  type LoadedAssets,
  type ParticlePresetConfig,
  type PhysicsCollisionLayer,
  type PhysicsEntityHandle,
  type RendererStats,
  type SceneCompositionSpec,
  type SceneBehaviorBindingPlan,
  type ShooterGameSpec,
  type ResolvedBehaviorRecipeDocument,
  type ResolvedBehaviorStateMachineDocument,
  type ResolvedSceneCompositionSpec,
} from "@ferrum2d/ferrum-web";

const TOPDOWN_HIT_PARTICLE_PRESET_ID = 0;
const TOPDOWN_AUTHORED_RUNTIME_ENTITY_BUILTIN_PLAYER = "builtinShooterPlayer";
const SHOOTER_SNAPSHOT_ENTITY_PLAYER = 0;
const SHOOTER_SNAPSHOT_ENTITY_ENEMY = 1;
const SHOOTER_SNAPSHOT_HEADER_ENEMY_SPAWN_TIMER_FLOAT_OFFSET = 1;
const SHOOTER_SNAPSHOT_HEADER_GAME_STATE_U32_OFFSET = 1;
const SHOOTER_SNAPSHOT_GAME_STATE_PLAYING = 1;
const SHOOTER_SNAPSHOT_ENTITY_X_FLOAT_OFFSET = 0;
const SHOOTER_SNAPSHOT_ENTITY_Y_FLOAT_OFFSET = 1;
const SHOOTER_SNAPSHOT_ENTITY_HEALTH_FLOAT_OFFSET = 4;
const SHOOTER_SNAPSHOT_ENTITY_KIND_U32_OFFSET = 0;
const SHOOTER_SNAPSHOT_ENTITY_SCORE_REWARD_U32_OFFSET = 1;
const SHOOTER_SNAPSHOT_ACTION_COOLDOWN_DURATION = 7;
const SHOOTER_SNAPSHOT_ACTION_COOLDOWN_REMAINING = 8;
const SHOOTER_SNAPSHOT_ACTION_PROJECTILE_SPEED = 9;
const SHOOTER_SNAPSHOT_ACTION_PROJECTILE_DAMAGE = 10;
const SHOOTER_SNAPSHOT_ACTION_PROJECTILE_LIFETIME = 11;
const SHOOTER_SNAPSHOT_ACTION_ID = 2;
const SHOOTER_SNAPSHOT_DASH_COOLDOWN_DURATION = 12;
const SHOOTER_SNAPSHOT_DASH_COOLDOWN_REMAINING = 13;
const SHOOTER_SNAPSHOT_DASH_DISTANCE = 14;
const SHOOTER_SNAPSHOT_DASH_ACTION_ID = 3;
const FLOATS_PER_RENDER_COMMAND = 14;
const TOPDOWN_MASS_OBJECTS_SMOKE_COMMAND_COUNT = 1024;
const TOPDOWN_MASS_OBJECTS_SMOKE_COLUMNS = 32;
const TOPDOWN_MASS_OBJECTS_SMOKE_SPAWN_INTERVAL_SECONDS = 999;
const TOPDOWN_MASS_OBJECTS_SMOKE_COLLISION_PAIR_BUDGET = 2_000;
const COMMAND_COLOR_R_OFFSET = 8;
const COMMAND_COLOR_G_OFFSET = 9;
const COMMAND_COLOR_B_OFFSET = 10;
const COMMAND_COLOR_A_OFFSET = 11;
const COMMAND_TEXTURE_ID_OFFSET = 12;
const TOPDOWN_ASSET_CACHE_SALT = "topdown-shooter-v1";
const TOPDOWN_ASSET_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOPDOWN_CAMERA_SHAKE_DURATION_MS = 220;
const TOPDOWN_CAMERA_SHAKE_AMPLITUDE = 8;
const TOPDOWN_CAMERA_SHAKE_FREQUENCY = 24;
const TWO_PI = Math.PI * 2;
const TOPDOWN_AUTHORED_PHYSICS_LAYER_NAMES: Record<number, PhysicsCollisionLayer> = Object.freeze({
  0: "player",
  1: "enemy",
  2: "bullet",
  3: "wall",
  4: "pickup",
});
const TOPDOWN_MASS_OBJECTS_SMOKE_SPEC: ShooterGameSpec = {
  world: { width: 800, height: 480 },
  player: { speed: 1 },
  enemies: {
    speed: 1,
    spawnInterval: TOPDOWN_MASS_OBJECTS_SMOKE_SPAWN_INTERVAL_SECONDS,
    behavior: "static",
    spawnPattern: "edge",
    health: 1,
    scoreReward: 1,
    waves: [],
  },
  weapons: { bulletSpeed: 420, cooldown: 10, lifetime: 1, damage: 1 },
  prefabs: {
    player: { width: 16, height: 16 },
    enemy: { width: 8, height: 8 },
    bullet: { width: 6, height: 6 },
  },
  camera: { preset: "follow" },
};

interface TopdownTextureIds {
  player: number;
  enemy: number;
  bullet: number;
}

interface TopdownSmokeFrame {
  renderCommandCount: number;
  particleCount: number;
  enemyFlashCommandCount: number;
  maxEnemyFlashCommandCount: number;
  maxParticleCount: number;
  enemyTextureId: number;
  bulletTextureId: number;
  gameState: number;
  score: number;
}

interface TopdownMassObjectsSmokeFrame {
  requestedRenderCommandCount: number;
  restored: boolean;
  enemyCount: number;
  baseEntityCount: number;
  snapshotEntityCount: number;
  restoredEntityCount: number;
  renderCommandCount: number;
  maxRenderCommandCount: number;
  spriteCount: number;
  drawCalls: number;
  batchCount: number;
  textureBindCount: number;
  textureSwitchCount: number;
  collisionPairCount: number;
  maxCollisionPairCount: number;
  renderTimeMs: number;
  maxRenderTimeMs: number;
  entityCount: number;
  engineSpriteCount: number;
  gameState: number;
  rendererStats: RendererStats;
}

interface TopdownMassObjectsSnapshotApplySummary {
  restored: boolean;
  enemyCount: number;
  baseEntityCount: number;
  snapshotEntityCount: number;
  restoredEntityCount: number;
  floatsPerEntity: number;
  u32sPerEntity: number;
}

interface TopdownCameraShakeState {
  remainingMs: number;
  phaseRadians: number;
}

interface TopdownAuthoredBehaviorVariantSpec {
  format: string;
  version: number;
  replayScenario: string;
  semantics: TopdownAuthoredBehaviorVariantSemanticsSpec;
  ids: GameplayBehaviorRuntimeIds;
  sceneComposition: SceneCompositionSpec;
  behaviorRecipes: BehaviorRecipeDocumentSpec;
  behaviorStateMachines: BehaviorStateMachineDocumentSpec;
  expected?: {
    replayHash?: string;
    states?: Record<string, string>;
  };
}

interface TopdownAuthoredBehaviorVariantSemanticsSpec {
  fsmStateEntryMode: "manualReplaceSupported";
  browserPlacement: TopdownAuthoredBehaviorBrowserPlacementSpec;
}

interface TopdownAuthoredBehaviorBrowserPlacementSpec {
  anchorReplayBody: string;
  target: "worldCenter";
  scale: number;
}

interface TopdownAuthoredBehaviorVariantSummary {
  format: string;
  version: number;
  replayScenario: string;
  commandCount: number;
  instanceCount: number;
  machines: string[];
  ids: GameplayBehaviorRuntimeIds;
  expectedReplayHash?: string;
  expectedStateIds: Record<string, number>;
  runtimeApply?: TopdownAuthoredBehaviorVariantApplySummary;
}

interface TopdownAuthoredBehaviorVariantPrepared {
  variant: TopdownAuthoredBehaviorVariantSpec;
  recipes: ResolvedBehaviorRecipeDocument;
  composition: ResolvedSceneCompositionSpec;
  behaviorStateMachines: ResolvedBehaviorStateMachineDocument;
  ids: GameplayBehaviorRuntimeIds;
  bindingPlan: SceneBehaviorBindingPlan;
  summary: TopdownAuthoredBehaviorVariantSummary;
}

interface TopdownAuthoredBehaviorVariantApplySummary {
  applyId: number;
  instanceCount: number;
  commandCount: number;
  machineCount: number;
  handles: Record<string, GameplayEntityHandle>;
  builtInPlayerHandle?: GameplayEntityHandle;
  builtInPlayerAction?: TopdownAuthoredBehaviorPlayerActionSummary;
  builtInPlayerDashAction?: TopdownAuthoredBehaviorPlayerDashActionSummary;
  installPlans: Record<string, BehaviorStateMachineRuntimeInstallPlan>;
  placementAnchorReplayBody: string;
  placementTarget: "worldCenter";
  placementOffsetX: number;
  placementOffsetY: number;
  placementScale: number;
  initialStateIds: Record<string, number>;
  currentStateIds: Record<string, number>;
}

interface TopdownAuthoredBehaviorPlayerActionSummary {
  actionId: number;
  cooldownSeconds: number;
  remainingCooldownSeconds: number;
  speed: number;
  damage: number;
  lifetimeSeconds: number;
}

interface TopdownAuthoredBehaviorPlayerDashActionSummary {
  actionId: number;
  cooldownSeconds: number;
  remainingCooldownSeconds: number;
  distance: number;
}

interface TopdownAuthoredBehaviorStateCommandApplySummary {
  applyId: number;
  mode: BehaviorStateMachineStateCommandApplyMode;
  machineCount: number;
  states: Record<string, string>;
  stateIds: Record<string, number>;
  targetEntities: Record<string, string>;
  commandCounts: Record<string, number>;
  commandTypes: Record<string, string[]>;
  resultCounts: Record<string, number>;
}

interface TopdownAuthoredBehaviorFrameSummary {
  applyId: number;
  gameState: number;
  score: number;
  maxScore: number;
  entityCount: number;
  eventKinds: string[];
  observedEventKinds: string[];
  interactionEventCount: number;
  collisionDamageEventCount: number;
  behaviorStateChangedEventCount: number;
  interactionEvents: TopdownAuthoredBehaviorEventSummary[];
  collisionDamageEvents: TopdownAuthoredBehaviorEventSummary[];
  behaviorStateChangedEvents: TopdownAuthoredBehaviorEventSummary[];
  currentStateIds: Record<string, number>;
}

type TopdownAuthoredBehaviorEventSummary = Pick<
  GameplayEventView,
  | "kind"
  | "kindCode"
  | "actorId"
  | "actorGeneration"
  | "sourceId"
  | "sourceGeneration"
  | "tokenId"
  | "flags"
  | "payloadBits"
  | "once"
  | "consumedThisFrame"
  | "targetRemoved"
>;

interface TopdownPresentationEffectAudioEvent {
  volume: number;
  pitch: number;
}

type TopdownSmokeWindow = Window & {
  ferrumEngine?: FerrumEngine;
  ferrumRuntime?: { engine: FerrumEngine; renderer: WebGL2Renderer; profiler?: RuntimeProfiler };
  ferrumTopdownSmokeFrame?: TopdownSmokeFrame;
  ferrumTopdownAuthoredBehaviorVariant?: TopdownAuthoredBehaviorVariantSummary;
  ferrumTopdownAuthoredBehaviorFrame?: TopdownAuthoredBehaviorFrameSummary;
  ferrumTopdownAuthoredBehaviorStateCommandApply?: TopdownAuthoredBehaviorStateCommandApplySummary;
  ferrumTopdownMassObjectsSmokeFrame?: TopdownMassObjectsSmokeFrame;
  ferrumTopdownAuthoredBehaviorStart?: () => void;
  ferrumTopdownAuthoredBehaviorApplyCurrentStateCommands?: () => TopdownAuthoredBehaviorStateCommandApplySummary;
  ferrumTopdownAuthoredBehaviorResetAndReapply?: () => TopdownAuthoredBehaviorVariantApplySummary;
  ferrumTopdownSmokeStart?: () => void;
  ferrumTopdownSmokeFireAt?: (mouseX: number, mouseY: number) => void;
};

function gameStateText(code: number): string {
  if (code === 0) return "Title";
  if (code === 1) return "Playing";
  return "GameOver";
}

function assetApplyError(kind: "texture" | "sound" | "json", name: string, detail: string): Error {
  return new Error(`Asset apply error: kind=${kind} name='${name}' detail='${detail}'.`);
}

function diagnosticRows(report: DiagnosticReport): Array<[string, string]> {
  const rows: Array<[string, string]> = [["code", report.code], ["message", report.message]];
  const context = report.context;
  if (!context) {
    return rows;
  }

  appendDiagnosticContext(rows, context);
  return rows;
}

function appendDiagnosticContext(rows: Array<[string, string]>, context: DiagnosticContext): void {
  rows.push(["kind", context.kind]);
  if (context.name !== undefined) rows.push(["name", context.name]);
  if (context.id !== undefined) rows.push(["id", String(context.id)]);
  if (context.url !== undefined) rows.push(["url", context.url]);
  if (context.path !== undefined) rows.push(["path", context.path]);
  rows.push(["detail", context.detail]);
}

function applyBootstrapErrorStyles(container: HTMLElement, list: HTMLElement): void {
  container.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  container.style.maxWidth = "760px";
  container.style.margin = "48px auto";
  container.style.padding = "0 24px";
  container.style.color = "#17202a";
  list.style.display = "grid";
  list.style.gridTemplateColumns = "max-content minmax(0, 1fr)";
  list.style.gap = "8px 16px";
}

function publicAssetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

function topdownAssetManifest(): AssetManifest {
  return {
    textures: {
      player: publicAssetUrl("assets/player.png"),
      enemy: publicAssetUrl("assets/enemy.png"),
      bullet: publicAssetUrl("assets/bullet.png"),
    },
    sounds: {
      shoot: publicAssetUrl("assets/shoot.wav"),
      hit: publicAssetUrl("assets/hit.wav"),
      gameOver: publicAssetUrl("assets/game-over.wav"),
    },
    json: {
      game: publicAssetUrl("game.json"),
      authoredBehaviorVariant: publicAssetUrl("authored-behavior.variant.json"),
    },
  };
}

function assetProgressLabel(prefix: string, progress: AssetLoadProgress): string {
  const name = progress.name ? ` ${progress.name}` : "";
  const cached = progress.cached === true ? " cached" : "";
  return `${prefix}: ${progress.loaded}/${progress.total}${name}${cached}`;
}

async function preloadTopdownAssets(
  manifest: AssetManifest,
  overlay: LoadingOverlay,
  onProgressText: (text: string) => void,
): Promise<void> {
  const cache = new IndexedDbAssetCache({
    databaseName: "ferrum2d-topdown-shooter-assets",
    storeName: "json",
    binaryStoreName: "binary",
  });
  const cachePolicy = createAssetPreloadCachePolicy(manifest, {
    versionSalt: TOPDOWN_ASSET_CACHE_SALT,
    ttlMs: TOPDOWN_ASSET_CACHE_TTL_MS,
  });

  await preloadAssetManifest(manifest, {
    cache,
    cachePolicy,
    onProgress: (progress) => {
      onProgressText(assetProgressLabel("preload", progress));
      overlay.update(progress);
    },
  });
}

function requireTextureId(assets: LoadedAssets, name: "player" | "enemy" | "bullet"): number {
  const textureId = assets.textures.tryTextureId(name);
  if (textureId === undefined) {
    throw assetApplyError("texture", name, "Required texture is missing from loaded assets. Check textures manifest key.");
  }
  return textureId;
}

function requireSoundId(assets: LoadedAssets, name: "shoot" | "hit" | "gameOver" | "game_over"): number {
  const soundId = assets.sounds.trySoundId(name);
  if (soundId === undefined) {
    throw assetApplyError("sound", name, "Required sound is missing from loaded assets. Check sounds manifest key.");
  }
  return soundId;
}

function applyTopdownShooterAssets(engine: FerrumEngine, assets: LoadedAssets): TopdownTextureIds {
  const player = requireTextureId(assets, "player");
  const enemy = requireTextureId(assets, "enemy");
  const bullet = requireTextureId(assets, "bullet");
  engine.setTextureIds({ player, enemy, bullet });

  const shoot = requireSoundId(assets, "shoot");
  const hit = requireSoundId(assets, "hit");
  const gameOver = assets.sounds.trySoundId("gameOver") ?? assets.sounds.trySoundId("game_over");
  if (gameOver === undefined) {
    throw assetApplyError("sound", "gameOver", "Required sound is missing from loaded assets. Check sounds manifest key.");
  }
  engine.setSoundIds({ shoot, hit, gameOver });

  if (assets.json.game === undefined) {
    throw assetApplyError("json", "game", "Required Game Spec JSON is missing from loaded assets. Check json manifest key.");
  }
  engine.setGameSpec(assets.json.game as ShooterGameSpec);
  applyTopdownHitParticles(engine, bullet);
  return { player, enemy, bullet };
}

function prepareTopdownAuthoredBehaviorVariant(raw: unknown): TopdownAuthoredBehaviorVariantPrepared {
  if (!isRecord(raw)) {
    throw assetApplyError("json", "authoredBehaviorVariant", "Authored behavior variant must be an object.");
  }
  if (raw.format !== "ferrum2d.topdown-shooter.authored-behavior-variant") {
    throw assetApplyError("json", "authoredBehaviorVariant", "Unexpected authored behavior variant format.");
  }
  const variant = raw as unknown as TopdownAuthoredBehaviorVariantSpec;
  variant.semantics = authoredBehaviorSemantics(variant.semantics, "topdownAuthoredBehaviorVariant.semantics");
  const ids = resolveGameplayBehaviorRuntimeIds(variant.ids, {
    path: "topdownAuthoredBehaviorVariant.ids",
    requiredItems: ["score"],
    requiredActions: ["primary", "dash", "collect-score", "summon-enemy"],
  });
  const recipes = resolveBehaviorRecipeDocument(variant.behaviorRecipes, {
    path: "topdownAuthoredBehaviorVariant.behaviorRecipes",
  });
  const composition = resolveSceneCompositionSpec(variant.sceneComposition, {
    path: "topdownAuthoredBehaviorVariant.sceneComposition",
  });
  const dryRun = dryRunSceneBehaviorRecipes(composition, recipes, {
    path: "topdownAuthoredBehaviorVariant.gameplayAuthoring",
    missingBehavior: "error",
  });
  if (!dryRun.ok) {
    throw assetApplyError("json", "authoredBehaviorVariant", dryRun.diagnostics[0]?.message ?? "Gameplay authoring dry-run failed.");
  }
  const behaviorStateMachines = resolveBehaviorStateMachineDocument(variant.behaviorStateMachines, {
    path: "topdownAuthoredBehaviorVariant.behaviorStateMachines",
    behaviorRecipes: recipes,
  });
  const expectedStateIds: Record<string, number> = {};
  for (const [machineId, state] of Object.entries(variant.expected?.states ?? {})) {
    const plan = createBehaviorStateMachineRuntimeInstallPlan(behaviorStateMachines, machineId, {
      path: `topdownAuthoredBehaviorVariant.behaviorStateMachines.machines.${machineId}`,
      behaviorRecipes: recipes,
      ids,
    });
    const expectedState = plan.states.find((entry) => entry.state === state);
    if (expectedState === undefined) {
      throw assetApplyError(
        "json",
        "authoredBehaviorVariant",
        `Expected FSM state '${state}' is not defined for machine '${machineId}'.`,
      );
    }
    expectedStateIds[machineId] = expectedState.stateId;
  }

  const summary: TopdownAuthoredBehaviorVariantSummary = {
    format: variant.format,
    version: variant.version,
    replayScenario: variant.replayScenario,
    commandCount: dryRun.plan.commands.length,
    instanceCount: dryRun.plan.instances.length,
    machines: Object.keys(behaviorStateMachines.machines),
    ids,
    ...(variant.expected?.replayHash === undefined ? {} : { expectedReplayHash: variant.expected.replayHash }),
    expectedStateIds,
  };

  return {
    variant,
    recipes,
    composition,
    behaviorStateMachines,
    ids,
    bindingPlan: dryRun.plan,
    summary,
  };
}

function applyTopdownAuthoredBehaviorVariant(
  engine: FerrumEngine,
  prepared: TopdownAuthoredBehaviorVariantPrepared,
  baseGameSpec: ShooterGameSpec,
  applyId: number,
): TopdownAuthoredBehaviorVariantApplySummary {
  const handles: Record<string, GameplayEntityHandle> = {};
  const installPlans: Record<string, BehaviorStateMachineRuntimeInstallPlan> = {};
  const placement = authoredBehaviorPlacement(prepared, baseGameSpec);
  for (const instance of prepared.bindingPlan.instances) {
    handles[instance.id] = runtimeHandleForTopdownAuthoredBehaviorInstance(engine, instance, placement);
  }

  const applyResult = engine.applyGameplayBehaviorCommands(prepared.bindingPlan.commands, handles, {
    path: "topdownAuthoredBehaviorVariant.runtimeApply.behaviorCommands",
    ids: prepared.ids,
  });
  const initialStateIds: Record<string, number> = {};
  const currentStateIds: Record<string, number> = {};
  for (const instance of prepared.bindingPlan.instances) {
    const machineId = optionalStringProp(instance.props.behaviorStateMachine);
    if (machineId === undefined) {
      continue;
    }
    const handle = handles[instance.id];
    if (handle === undefined) {
      throw assetApplyError("json", "authoredBehaviorVariant", `Missing runtime handle for instance '${instance.id}'.`);
    }
    const install = engine.installBehaviorStateMachineRuntime(
      prepared.behaviorStateMachines,
      machineId,
      handle,
      {
        path: `topdownAuthoredBehaviorVariant.runtimeApply.behaviorStateMachines.${machineId}`,
        behaviorRecipes: prepared.recipes,
        ids: prepared.ids,
      },
    );
    installPlans[machineId] = install.plan;
    initialStateIds[machineId] = install.plan.initialStateId;
    currentStateIds[machineId] = engine.gameplayBehaviorState(handle);
  }

  return {
    applyId,
    instanceCount: prepared.bindingPlan.instances.length,
    commandCount: applyResult.results.length,
    machineCount: Object.keys(initialStateIds).length,
    handles,
    ...builtInPlayerRuntimeSummary(engine, prepared, handles),
    installPlans,
    placementAnchorReplayBody: placement.anchorReplayBody,
    placementTarget: placement.target,
    placementOffsetX: placement.offsetX,
    placementOffsetY: placement.offsetY,
    placementScale: placement.scale,
    initialStateIds,
    currentStateIds,
  };
}

function builtInPlayerRuntimeSummary(
  engine: FerrumEngine,
  prepared: TopdownAuthoredBehaviorVariantPrepared,
  handles: Record<string, GameplayEntityHandle>,
): Pick<TopdownAuthoredBehaviorVariantApplySummary, "builtInPlayerHandle" | "builtInPlayerAction" | "builtInPlayerDashAction"> {
  const instance = prepared.bindingPlan.instances.find(
    (candidate) => candidate.props.runtimeEntity === TOPDOWN_AUTHORED_RUNTIME_ENTITY_BUILTIN_PLAYER,
  );
  if (instance === undefined) {
    return {};
  }
  return {
    builtInPlayerHandle: handles[instance.id],
    builtInPlayerAction: builtInShooterPlayerAction(engine),
    builtInPlayerDashAction: builtInShooterPlayerDashAction(engine),
  };
}

function builtInShooterPlayerAction(engine: FerrumEngine): TopdownAuthoredBehaviorPlayerActionSummary | undefined {
  const snapshot = engine.captureShooterStateSnapshot();
  if (snapshot === undefined) {
    return undefined;
  }
  for (let entityIndex = 0; entityIndex < snapshot.entityCount; entityIndex += 1) {
    const floatOffset = entityIndex * snapshot.floatsPerEntity;
    const u32Offset = entityIndex * snapshot.u32sPerEntity;
    if (snapshot.entityU32s[u32Offset] !== SHOOTER_SNAPSHOT_ENTITY_PLAYER) {
      continue;
    }
    const actionId = snapshot.entityU32s[u32Offset + SHOOTER_SNAPSHOT_ACTION_ID] ?? 0;
    if (actionId === 0) {
      return undefined;
    }
    return {
      actionId,
      cooldownSeconds: snapshot.entityFloats[floatOffset + SHOOTER_SNAPSHOT_ACTION_COOLDOWN_DURATION] ?? 0,
      remainingCooldownSeconds: snapshot.entityFloats[floatOffset + SHOOTER_SNAPSHOT_ACTION_COOLDOWN_REMAINING] ?? 0,
      speed: snapshot.entityFloats[floatOffset + SHOOTER_SNAPSHOT_ACTION_PROJECTILE_SPEED] ?? 0,
      damage: snapshot.entityFloats[floatOffset + SHOOTER_SNAPSHOT_ACTION_PROJECTILE_DAMAGE] ?? 0,
      lifetimeSeconds: snapshot.entityFloats[floatOffset + SHOOTER_SNAPSHOT_ACTION_PROJECTILE_LIFETIME] ?? 0,
    };
  }
  return undefined;
}

function builtInShooterPlayerDashAction(engine: FerrumEngine): TopdownAuthoredBehaviorPlayerDashActionSummary | undefined {
  const snapshot = engine.captureShooterStateSnapshot();
  if (snapshot === undefined) {
    return undefined;
  }
  for (let entityIndex = 0; entityIndex < snapshot.entityCount; entityIndex += 1) {
    const floatOffset = entityIndex * snapshot.floatsPerEntity;
    const u32Offset = entityIndex * snapshot.u32sPerEntity;
    if (snapshot.entityU32s[u32Offset] !== SHOOTER_SNAPSHOT_ENTITY_PLAYER) {
      continue;
    }
    const actionId = snapshot.entityU32s[u32Offset + SHOOTER_SNAPSHOT_DASH_ACTION_ID] ?? 0;
    if (actionId === 0) {
      return undefined;
    }
    return {
      actionId,
      cooldownSeconds: snapshot.entityFloats[floatOffset + SHOOTER_SNAPSHOT_DASH_COOLDOWN_DURATION] ?? 0,
      remainingCooldownSeconds: snapshot.entityFloats[floatOffset + SHOOTER_SNAPSHOT_DASH_COOLDOWN_REMAINING] ?? 0,
      distance: snapshot.entityFloats[floatOffset + SHOOTER_SNAPSHOT_DASH_DISTANCE] ?? 0,
    };
  }
  return undefined;
}

function applyTopdownAuthoredBehaviorCurrentStateCommands(
  engine: FerrumEngine,
  prepared: TopdownAuthoredBehaviorVariantPrepared,
  apply: TopdownAuthoredBehaviorVariantApplySummary,
  mode: BehaviorStateMachineStateCommandApplyMode,
): TopdownAuthoredBehaviorStateCommandApplySummary {
  const states: Record<string, string> = {};
  const stateIds: Record<string, number> = {};
  const targetEntities: Record<string, string> = {};
  const commandCounts: Record<string, number> = {};
  const commandTypes: Record<string, string[]> = {};
  const resultCounts: Record<string, number> = {};
  for (const [machineId, handle] of Object.entries(authoredBehaviorMachineHandles(apply))) {
    const installPlan = apply.installPlans[machineId];
    if (installPlan === undefined) {
      throw assetApplyError("json", "authoredBehaviorVariant", `Missing FSM install plan for machine '${machineId}'.`);
    }
    const plan = engine.createBehaviorStateMachineCurrentStateCommandPlan(
      prepared.behaviorStateMachines,
      prepared.recipes,
      installPlan,
      handle,
      {
        path: `topdownAuthoredBehaviorVariant.runtimeApply.stateCommands.${machineId}`,
        entity: machineId,
      },
    );
    const result = engine.applyBehaviorStateMachineStateCommands(plan, handle, {
      path: `topdownAuthoredBehaviorVariant.runtimeApply.stateCommands.${machineId}`,
      entity: machineId,
      mode,
      ids: prepared.ids,
    });
    states[machineId] = result.plan.state;
    stateIds[machineId] = result.plan.stateId;
    targetEntities[machineId] = result.plan.targetEntity ?? machineId;
    commandCounts[machineId] = result.commands.length;
    commandTypes[machineId] = result.commands.map((command) => command.type);
    resultCounts[machineId] = result.results.length;
  }
  return {
    applyId: apply.applyId,
    mode,
    machineCount: Object.keys(states).length,
    states,
    stateIds,
    targetEntities,
    commandCounts,
    commandTypes,
    resultCounts,
  };
}

function spawnTopdownAuthoredBehaviorInstance(
  engine: FerrumEngine,
  instance: SceneBehaviorBindingPlan["instances"][number],
  placement: { anchorX: number; anchorY: number; offsetX: number; offsetY: number; scale: number },
): PhysicsEntityHandle {
  const body = authoredPhysicsBody(instance.props.physicsBody, `topdownAuthoredBehaviorVariant.sceneComposition.instances.${instance.id}.props.physicsBody`);
  return engine.spawnRigidBody({
    x: placement.anchorX + (instance.x - placement.anchorX) * placement.scale + placement.offsetX,
    y: placement.anchorY + (instance.y - placement.anchorY) * placement.scale + placement.offsetY,
    bodyType: "static",
    layer: body.layer,
    isTrigger: body.isTrigger,
    collider: {
      type: "aabb",
      halfWidth: body.halfWidth,
      halfHeight: body.halfHeight,
    },
  });
}

function runtimeHandleForTopdownAuthoredBehaviorInstance(
  engine: FerrumEngine,
  instance: SceneBehaviorBindingPlan["instances"][number],
  placement: { anchorX: number; anchorY: number; offsetX: number; offsetY: number; scale: number },
): GameplayEntityHandle {
  const runtimeEntity = optionalStringProp(instance.props.runtimeEntity);
  if (runtimeEntity === TOPDOWN_AUTHORED_RUNTIME_ENTITY_BUILTIN_PLAYER) {
    const handle = engine.builtInShooterPlayerHandle();
    if (handle === undefined) {
      throw assetApplyError("json", "authoredBehaviorVariant", `Runtime entity '${runtimeEntity}' is not available.`);
    }
    return handle;
  }
  if (runtimeEntity !== undefined) {
    throw assetApplyError("json", "authoredBehaviorVariant", `Unsupported runtime entity '${runtimeEntity}'.`);
  }
  return spawnTopdownAuthoredBehaviorInstance(engine, instance, placement);
}

function recordTopdownAuthoredBehaviorFrame(
  frame: { gameState: number; score: number; entityCount: number; gameplayEvents: readonly { kind: string }[] },
  summary: TopdownAuthoredBehaviorVariantSummary | undefined,
  engine: FerrumEngine | undefined,
): void {
  const apply = summary?.runtimeApply;
  if (apply === undefined || engine === undefined) {
    return;
  }
  const currentStateIds: Record<string, number> = {};
  for (const [machineId, handle] of Object.entries(authoredBehaviorMachineHandles(apply))) {
    currentStateIds[machineId] = engine.gameplayBehaviorState(handle);
  }
  const eventKinds = frame.gameplayEvents.map((event) => event.kind);
  const previous = (window as TopdownSmokeWindow).ferrumTopdownAuthoredBehaviorFrame;
  const copiedEvents = frame.gameplayEvents.map(copyGameplayEventSummary);
  const interactionEvents = [
    ...(previous?.interactionEvents ?? []),
    ...copiedEvents.filter((event) => event.kind === "interaction"),
  ];
  const collisionDamageEvents = [
    ...(previous?.collisionDamageEvents ?? []),
    ...copiedEvents.filter((event) => event.kind === "collisionDamage"),
  ];
  const behaviorStateChangedEvents = [
    ...(previous?.behaviorStateChangedEvents ?? []),
    ...copiedEvents.filter((event) => event.kind === "behaviorStateChanged"),
  ];
  const observedEventKinds = Array.from(new Set([
    ...(previous?.observedEventKinds ?? []),
    ...eventKinds,
  ])).sort();
  (window as TopdownSmokeWindow).ferrumTopdownAuthoredBehaviorFrame = {
    applyId: apply.applyId,
    gameState: frame.gameState,
    score: frame.score,
    maxScore: Math.max(previous?.maxScore ?? 0, frame.score),
    entityCount: frame.entityCount,
    eventKinds,
    observedEventKinds,
    interactionEventCount: interactionEvents.length,
    collisionDamageEventCount: collisionDamageEvents.length,
    behaviorStateChangedEventCount: behaviorStateChangedEvents.length,
    interactionEvents,
    collisionDamageEvents,
    behaviorStateChangedEvents,
    currentStateIds,
  };
}

function copyGameplayEventSummary(event: GameplayEventView): TopdownAuthoredBehaviorEventSummary {
  return {
    kind: event.kind,
    kindCode: event.kindCode,
    actorId: event.actorId,
    actorGeneration: event.actorGeneration,
    sourceId: event.sourceId,
    sourceGeneration: event.sourceGeneration,
    tokenId: event.tokenId,
    flags: event.flags,
    payloadBits: event.payloadBits,
    once: event.once,
    consumedThisFrame: event.consumedThisFrame,
    targetRemoved: event.targetRemoved,
  };
}

function applyTopdownPresentationEffects(
  frame: { gameplayEvents: readonly GameplayEventView[]; audioEvents: readonly AudioEventView[] },
  runtimeEngine: FerrumEngine | undefined,
  platformHost: BrowserPlatformHost,
  cameraShakeState: TopdownCameraShakeState,
): void {
  if (runtimeEngine === undefined) {
    return;
  }

  const actions = gameplayActionsForEvents(frame.gameplayEvents, { path: "frame.gameplayEvents" });
  const audioEventBudget = new Map<number, TopdownPresentationEffectAudioEvent[]>();
  for (const event of frame.audioEvents) {
    const soundId = Math.trunc(event.soundId);
    if (soundId <= 0 || !Number.isFinite(soundId)) {
      continue;
    }
    const bucket = audioEventBudget.get(soundId) ?? [];
    bucket.push({
      volume: Number.isFinite(event.volume) ? event.volume : 1,
      pitch: Number.isFinite(event.pitch) ? event.pitch : 1,
    });
    audioEventBudget.set(soundId, bucket);
  }

  for (const action of actions) {
    if (action.type === "presentationEffect" && action.effectType === GAMEPLAY_PRESENTATION_EFFECT_TYPE_PARTICLE) {
      const actorSnapshot = runtimeEngine.getPhysicsEntity(action.actor);
      const sourceSnapshot = runtimeEngine.getPhysicsEntity(action.source);
      const spawnTarget = actorSnapshot ?? sourceSnapshot;
      if (spawnTarget !== undefined) {
        runtimeEngine.spawnParticleBurst(action.effectId, spawnTarget.x, spawnTarget.y);
      }
      continue;
    }

    if (
      action.type === "presentationEffect" &&
      (action.effectKind === "cameraShake" || action.effectType === GAMEPLAY_PRESENTATION_EFFECT_TYPE_CAMERA_SHAKE)
    ) {
      cameraShakeState.remainingMs = Math.max(
        cameraShakeState.remainingMs,
        TOPDOWN_CAMERA_SHAKE_DURATION_MS,
      );
      cameraShakeState.phaseRadians += (action.actor.id + action.source.id) * 0.17;
      continue;
    }

    if (action.type !== "presentationEffect" || action.effectType !== GAMEPLAY_PRESENTATION_EFFECT_TYPE_SOUND) {
      continue;
    }

    const soundEventBudget = audioEventBudget.get(action.effectId);
    if (soundEventBudget !== undefined && soundEventBudget.length > 0) {
      soundEventBudget.shift();
      continue;
    }

    platformHost.playAudioEvents([{
      soundId: action.effectId,
      volume: 1,
      pitch: 1,
      channelId: AUDIO_CHANNEL_SFX,
    }]);
  }
}

function consumeTopdownCameraShake(
  frameMs: number,
  state: TopdownCameraShakeState,
): { x: number; y: number } {
  if (state.remainingMs <= 0) {
    state.remainingMs = 0;
    return { x: 0, y: 0 };
  }

  const deltaSeconds = Math.max(0, frameMs) / 1000;
  state.phaseRadians = (state.phaseRadians + deltaSeconds * TOPDOWN_CAMERA_SHAKE_FREQUENCY * TWO_PI) % TWO_PI;
  const intensity = (state.remainingMs / TOPDOWN_CAMERA_SHAKE_DURATION_MS);
  state.remainingMs = Math.max(0, state.remainingMs - frameMs);

  const amp = TOPDOWN_CAMERA_SHAKE_AMPLITUDE * intensity;
  return {
    x: Math.sin(state.phaseRadians) * amp,
    y: Math.cos(state.phaseRadians) * amp,
  };
}

function authoredBehaviorMachineHandles(
  apply: TopdownAuthoredBehaviorVariantApplySummary,
): Record<string, GameplayEntityHandle> {
  const handles: Record<string, GameplayEntityHandle> = {};
  for (const machineId of Object.keys(apply.initialStateIds)) {
    const handle = apply.handles[machineId];
    if (handle !== undefined) {
      handles[machineId] = handle;
    }
  }
  return handles;
}

function authoredBehaviorPlacement(
  prepared: TopdownAuthoredBehaviorVariantPrepared,
  baseGameSpec: ShooterGameSpec,
): {
  anchorReplayBody: string;
  target: "worldCenter";
  anchorX: number;
  anchorY: number;
  offsetX: number;
  offsetY: number;
  scale: number;
} {
  const placement = prepared.variant.semantics.browserPlacement;
  const anchor = prepared.bindingPlan.instances.find((instance) => instance.props.replayBody === placement.anchorReplayBody);
  if (anchor === undefined) {
    throw assetApplyError(
      "json",
      "authoredBehaviorVariant",
      `Browser placement anchor replayBody '${placement.anchorReplayBody}' does not match any scene instance.`,
    );
  }
  const worldWidth = baseGameSpec.world?.width ?? 800;
  const worldHeight = baseGameSpec.world?.height ?? 480;
  return {
    anchorReplayBody: placement.anchorReplayBody,
    target: placement.target,
    anchorX: anchor.x,
    anchorY: anchor.y,
    offsetX: worldWidth * 0.5 - anchor.x,
    offsetY: worldHeight * 0.5 - anchor.y,
    scale: placement.scale,
  };
}

function authoredBehaviorSemantics(value: unknown, path: string): TopdownAuthoredBehaviorVariantSemanticsSpec {
  const semantics = recordProp(value, path);
  if (semantics.fsmStateEntryMode !== "manualReplaceSupported") {
    throw assetApplyError("json", "authoredBehaviorVariant", `${path}.fsmStateEntryMode must be 'manualReplaceSupported'.`);
  }
  return {
    fsmStateEntryMode: "manualReplaceSupported",
    browserPlacement: authoredBehaviorBrowserPlacement(semantics.browserPlacement, `${path}.browserPlacement`),
  };
}

function authoredBehaviorBrowserPlacement(value: unknown, path: string): TopdownAuthoredBehaviorBrowserPlacementSpec {
  const placement = recordProp(value, path);
  const anchorReplayBody = nonEmptyStringProp(placement.anchorReplayBody, `${path}.anchorReplayBody`);
  if (placement.target !== "worldCenter") {
    throw assetApplyError("json", "authoredBehaviorVariant", `${path}.target must be 'worldCenter'.`);
  }
  return {
    anchorReplayBody,
    target: "worldCenter",
    scale: positiveFiniteNumberProp(placement.scale, `${path}.scale`),
  };
}

function authoredPhysicsBody(value: unknown, path: string): {
  halfWidth: number;
  halfHeight: number;
  layer: PhysicsCollisionLayer;
  isTrigger: boolean;
} {
  const body = recordProp(value, path);
  const halfWidth = positiveFiniteNumberProp(body.halfWidth, `${path}.halfWidth`);
  const halfHeight = positiveFiniteNumberProp(body.halfHeight, `${path}.halfHeight`);
  const layer = authoredPhysicsLayer(body.layer, `${path}.layer`);
  const isTrigger = body.isTrigger === undefined ? false : booleanProp(body.isTrigger, `${path}.isTrigger`);
  return { halfWidth, halfHeight, layer, isTrigger };
}

function authoredPhysicsLayer(value: unknown, path: string): PhysicsCollisionLayer {
  if (typeof value === "string" && Object.values(TOPDOWN_AUTHORED_PHYSICS_LAYER_NAMES).includes(value as PhysicsCollisionLayer)) {
    return value as PhysicsCollisionLayer;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    const layer = TOPDOWN_AUTHORED_PHYSICS_LAYER_NAMES[value];
    if (layer !== undefined) {
      return layer;
    }
  }
  throw assetApplyError("json", "authoredBehaviorVariant", `${path} must be a known physics collision layer.`);
}

function optionalStringProp(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nonEmptyStringProp(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw assetApplyError("json", "authoredBehaviorVariant", `${path} must be a non-empty string.`);
  }
  return value;
}

function recordProp(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw assetApplyError("json", "authoredBehaviorVariant", `${path} must be an object.`);
  }
  return value;
}

function positiveFiniteNumberProp(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw assetApplyError("json", "authoredBehaviorVariant", `${path} must be a positive finite number.`);
  }
  return value;
}

function booleanProp(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw assetApplyError("json", "authoredBehaviorVariant", `${path} must be a boolean.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function applyTopdownHitParticles(engine: FerrumEngine, bulletTextureId: number): void {
  const hitParticles: ParticlePresetConfig = {
    texture: bulletTextureId,
    burstCount: 10,
    lifetime: [0.16, 0.34],
    speed: [45, 155],
    startSize: [5, 9],
    endSize: 1.5,
    startColor: [1, 0.82, 0.28, 1],
    endColor: [1, 0.18, 0.05, 0],
    damping: 1.8,
  };

  engine.setParticlePreset(TOPDOWN_HIT_PARTICLE_PRESET_ID, hitParticles);
  engine.setShooterHitParticlePreset(TOPDOWN_HIT_PARTICLE_PRESET_ID);
}

function recordTopdownSmokeFrame(
  engine: FerrumEngine,
  renderCommandBuffer: { buffer: Float32Array; commandCount: number; floatsPerCommand: number },
  textureIds: TopdownTextureIds,
  gameState: number,
  score: number,
): void {
  let enemyFlashCommandCount = 0;
  const floatsPerCommand = renderCommandBuffer.floatsPerCommand || FLOATS_PER_RENDER_COMMAND;
  for (let commandIndex = 0; commandIndex < renderCommandBuffer.commandCount; commandIndex += 1) {
    const offset = commandIndex * floatsPerCommand;
    const textureId = Math.trunc(renderCommandBuffer.buffer[offset + COMMAND_TEXTURE_ID_OFFSET]);
    if (textureId !== textureIds.enemy) {
      continue;
    }

    const red = renderCommandBuffer.buffer[offset + COMMAND_COLOR_R_OFFSET];
    const green = renderCommandBuffer.buffer[offset + COMMAND_COLOR_G_OFFSET];
    const blue = renderCommandBuffer.buffer[offset + COMMAND_COLOR_B_OFFSET];
    const alpha = renderCommandBuffer.buffer[offset + COMMAND_COLOR_A_OFFSET];
    if (red >= 0.95 && green > 0.6 && blue > 0.32 && alpha >= 0.95) {
      enemyFlashCommandCount += 1;
    }
  }

  const smokeWindow = window as TopdownSmokeWindow;
  const previous = smokeWindow.ferrumTopdownSmokeFrame;
  const particleCount = engine.particleCount();
  smokeWindow.ferrumTopdownSmokeFrame = {
    renderCommandCount: renderCommandBuffer.commandCount,
    particleCount,
    enemyFlashCommandCount,
    maxEnemyFlashCommandCount: Math.max(previous?.maxEnemyFlashCommandCount ?? 0, enemyFlashCommandCount),
    maxParticleCount: Math.max(previous?.maxParticleCount ?? 0, particleCount),
    enemyTextureId: textureIds.enemy,
    bulletTextureId: textureIds.bullet,
    gameState,
    score,
  };
}

function restoreTopdownMassObjectsSnapshot(
  engine: FerrumEngine,
  viewport: { width: number; height: number },
): TopdownMassObjectsSnapshotApplySummary {
  const baseSnapshot = engine.captureShooterStateSnapshot?.();
  if (baseSnapshot === undefined) {
    throw assetApplyError("json", "massObjectsSmoke", "Base shooter snapshot capture is unavailable.");
  }
  const playerSlot = snapshotEntitySlot(baseSnapshot.entityU32s, baseSnapshot.u32sPerEntity, SHOOTER_SNAPSHOT_ENTITY_PLAYER);
  if (playerSlot < 0) {
    throw assetApplyError("json", "massObjectsSmoke", "Base shooter snapshot does not include a player entity.");
  }

  const enemyCount = TOPDOWN_MASS_OBJECTS_SMOKE_COMMAND_COUNT;
  const entityCount = enemyCount + 1;
  const floatsPerEntity = baseSnapshot.floatsPerEntity;
  const u32sPerEntity = baseSnapshot.u32sPerEntity;
  const headerFloats = [...baseSnapshot.headerFloats];
  const headerU32s = [...baseSnapshot.headerU32s];
  const entityFloats = new Array(entityCount * floatsPerEntity).fill(0);
  const entityU32s = new Array(entityCount * u32sPerEntity).fill(0);
  headerU32s[SHOOTER_SNAPSHOT_HEADER_GAME_STATE_U32_OFFSET] = SHOOTER_SNAPSHOT_GAME_STATE_PLAYING;
  headerFloats[SHOOTER_SNAPSHOT_HEADER_ENEMY_SPAWN_TIMER_FLOAT_OFFSET] =
    TOPDOWN_MASS_OBJECTS_SMOKE_SPAWN_INTERVAL_SECONDS;
  copySnapshotEntity(
    baseSnapshot.entityFloats,
    entityFloats,
    playerSlot,
    0,
    floatsPerEntity,
  );
  copySnapshotEntity(
    baseSnapshot.entityU32s,
    entityU32s,
    playerSlot,
    0,
    u32sPerEntity,
  );

  for (let enemyIndex = 0; enemyIndex < enemyCount; enemyIndex += 1) {
    writeTopdownMassObjectsEnemySnapshot(
      entityFloats,
      entityU32s,
      enemyIndex + 1,
      enemyIndex,
      floatsPerEntity,
      u32sPerEntity,
      viewport,
    );
  }

  const restored = engine.restoreShooterStateSnapshot?.({
    ...baseSnapshot,
    headerFloats,
    headerU32s,
    entityFloats,
    entityU32s,
    entityCount,
  }) === true;
  if (!restored) {
    throw assetApplyError("json", "massObjectsSmoke", "Mass object shooter snapshot restore returned false.");
  }
  const restoredSnapshot = engine.captureShooterStateSnapshot?.();
  return {
    restored,
    enemyCount,
    baseEntityCount: baseSnapshot.entityCount,
    snapshotEntityCount: restoredSnapshot?.entityCount ?? entityCount,
    restoredEntityCount: engine.entityCount(),
    floatsPerEntity,
    u32sPerEntity,
  };
}

function snapshotEntitySlot(entityU32s: readonly number[], u32sPerEntity: number, kind: number): number {
  const entityCount = Math.floor(entityU32s.length / u32sPerEntity);
  for (let slot = 0; slot < entityCount; slot += 1) {
    if (entityU32s[slot * u32sPerEntity] === kind) {
      return slot;
    }
  }
  return -1;
}

function copySnapshotEntity(
  source: readonly number[],
  target: number[],
  sourceSlot: number,
  targetSlot: number,
  stride: number,
): void {
  const sourceBase = sourceSlot * stride;
  const targetBase = targetSlot * stride;
  for (let field = 0; field < stride; field += 1) {
    target[targetBase + field] = source[sourceBase + field] ?? 0;
  }
}

function writeTopdownMassObjectsEnemySnapshot(
  entityFloats: number[],
  entityU32s: number[],
  slot: number,
  enemyIndex: number,
  floatsPerEntity: number,
  u32sPerEntity: number,
  viewport: { width: number; height: number },
): void {
  const columns = TOPDOWN_MASS_OBJECTS_SMOKE_COLUMNS;
  const rows = Math.ceil(TOPDOWN_MASS_OBJECTS_SMOKE_COMMAND_COUNT / columns);
  const cellWidth = Math.max(1, viewport.width / columns);
  const cellHeight = Math.max(1, viewport.height / rows);
  const column = enemyIndex % columns;
  const row = Math.floor(enemyIndex / columns);
  const floatBase = slot * floatsPerEntity;
  const u32Base = slot * u32sPerEntity;
  entityFloats[floatBase + SHOOTER_SNAPSHOT_ENTITY_X_FLOAT_OFFSET] = column * cellWidth + cellWidth * 0.5;
  entityFloats[floatBase + SHOOTER_SNAPSHOT_ENTITY_Y_FLOAT_OFFSET] = row * cellHeight + cellHeight * 0.5;
  entityFloats[floatBase + SHOOTER_SNAPSHOT_ENTITY_HEALTH_FLOAT_OFFSET] = 1;
  entityU32s[u32Base + SHOOTER_SNAPSHOT_ENTITY_KIND_U32_OFFSET] = SHOOTER_SNAPSHOT_ENTITY_ENEMY;
  entityU32s[u32Base + SHOOTER_SNAPSHOT_ENTITY_SCORE_REWARD_U32_OFFSET] = 1;
}

function recordTopdownMassObjectsSmokeFrame(
  engine: FerrumEngine,
  snapshotApply: TopdownMassObjectsSnapshotApplySummary,
  rendererStats: RendererStats,
  renderTimeMs: number,
  gameState: number,
  collisionPairCount: number,
): void {
  const smokeWindow = window as TopdownSmokeWindow;
  const previous = smokeWindow.ferrumTopdownMassObjectsSmokeFrame;
  const renderCommandCount = rendererStats.renderCommandCount;
  smokeWindow.ferrumTopdownMassObjectsSmokeFrame = {
    requestedRenderCommandCount: TOPDOWN_MASS_OBJECTS_SMOKE_COMMAND_COUNT,
    restored: snapshotApply.restored,
    enemyCount: snapshotApply.enemyCount,
    baseEntityCount: snapshotApply.baseEntityCount,
    snapshotEntityCount: snapshotApply.snapshotEntityCount,
    restoredEntityCount: snapshotApply.restoredEntityCount,
    renderCommandCount,
    maxRenderCommandCount: Math.max(previous?.maxRenderCommandCount ?? 0, renderCommandCount),
    spriteCount: rendererStats.spriteCount,
    drawCalls: rendererStats.drawCalls,
    batchCount: rendererStats.batchCount,
    textureBindCount: rendererStats.textureBindCount,
    textureSwitchCount: rendererStats.textureSwitchCount,
    collisionPairCount,
    maxCollisionPairCount: Math.max(previous?.maxCollisionPairCount ?? 0, collisionPairCount),
    renderTimeMs,
    maxRenderTimeMs: Math.max(previous?.maxRenderTimeMs ?? 0, renderTimeMs),
    entityCount: engine.entityCount(),
    engineSpriteCount: engine.spriteCount(),
    gameState,
    rendererStats: { ...rendererStats },
  };
}

function reportBootstrapError(error: unknown): void {
  console.error("Ferrum2D bootstrap failed", error);
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  const report = diagnosticReport(error);
  const container = document.createElement("section");
  const title = document.createElement("h1");
  const summary = document.createElement("p");
  const list = document.createElement("dl");
  title.textContent = "Ferrum2D Top-down Shooter MVP";
  summary.textContent = "Startup failed. Diagnostic details are shown below.";

  for (const [label, value] of diagnosticRows(report)) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    description.style.margin = "0";
    description.style.wordBreak = "break-word";
    list.append(term, description);
  }

  applyBootstrapErrorStyles(container, list);
  container.append(title, summary, list);
  app.replaceChildren(container);
}

function cleanupResources(cleanups: Array<() => void>): void {
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      cleanup();
    } catch (error) {
      console.warn("Ferrum2D cleanup failed", error);
    }
  }
}

async function bootstrap(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;
  const cleanups: Array<() => void> = [];

  try {
    const title = document.createElement("h1");
    const hudEl = document.createElement("p");
    title.textContent = "Ferrum2D Top-down Shooter MVP";
    const searchParams = new URLSearchParams(window.location.search);
    const preserveDrawingBuffer = searchParams.get("preserveDrawingBuffer") === "true";
    const effectSmokeEnabled = searchParams.get("effectSmoke") === "true";
    const massObjectsSmokeEnabled = searchParams.get("massObjectsSmoke") === "true";
    const profilerSmokeEnabled = searchParams.get("profilerSmoke") === "true";
    const authoredBehaviorVariantApplyEnabled = searchParams.get("authoredBehaviorVariantApply") === "true";

    const canvas = document.createElement("canvas");
    canvas.style.width = "800px";
    canvas.style.height = "480px";
    canvas.style.display = "block";
    const debugEnabled = searchParams.get("debug") === "true";
    const gameColumn = document.createElement("section");
    gameColumn.style.display = "flex";
    gameColumn.style.flexDirection = "column";
    gameColumn.style.alignItems = "flex-start";
    gameColumn.append(title, hudEl, canvas);
    const shell = document.createElement("div");
    shell.style.display = "flex";
    shell.style.alignItems = "flex-start";
    shell.style.gap = "16px";
    shell.style.flexWrap = "wrap";
    shell.append(gameColumn);
    const debugPanel = document.createElement("aside");
    debugPanel.dataset.testid = "topdown-debug-panel";
    debugPanel.setAttribute("aria-label", "Runtime debug metrics");
    if (debugEnabled) {
      shell.append(debugPanel);
    }
    app.replaceChildren(shell);

    const renderer = new WebGL2Renderer(canvas, { clearColor: [0.05, 0.08, 0.12, 1], preserveDrawingBuffer });
    cleanups.push(() => renderer.destroy());
    const resizeRenderer = (): void => renderer.resize();
    window.addEventListener("resize", resizeRenderer);
    cleanups.push(() => window.removeEventListener("resize", resizeRenderer));
    const platformHost = new BrowserPlatformHost(renderer);
    cleanups.push(() => platformHost.destroy());
    const unlockAudio = (): void => {
      void platformHost.unlockAudio();
    };
    window.addEventListener("keydown", unlockAudio, { once: true });
    canvas.addEventListener("pointerdown", unlockAudio, { once: true });
    cleanups.push(() => window.removeEventListener("keydown", unlockAudio));
    cleanups.push(() => canvas.removeEventListener("pointerdown", unlockAudio));
    const input = new InputManager(canvas);
    cleanups.push(() => input.destroy());
    const physicsDebugLines = searchParams.get("physicsDebugLines") === "true";
    const debugOverlay = new DebugOverlay(debugPanel, { enabled: debugEnabled, layout: "inline" });
    cleanups.push(() => debugOverlay.destroy());
    const runtimeProfiler = profilerSmokeEnabled ? new RuntimeProfiler() : undefined;
    const loadingOverlay = new LoadingOverlay(app, {
      title: "Loading assets",
      completeTitle: "Ready",
      autoHideOnComplete: true,
    });
    cleanups.push(() => loadingOverlay.destroy());
    let assetProgressText = "assets: 0/0";
    let audioEventRateWindowStartMs = performance.now();
    let audioEventRateCount = 0;
    let audioEventsPerSecond = 0;
    let runtimeEngine: FerrumEngine | undefined;
    let smokeTextureIds: TopdownTextureIds | undefined;
    let massObjectsSmokeApply: TopdownMassObjectsSnapshotApplySummary | undefined;
    let authoredBehaviorVariantSummary: TopdownAuthoredBehaviorVariantSummary | undefined;
    let authoredBehaviorVariantApplyId = 0;
    let smokeStartQueued = false;
    let smokeFireQueued: { mouseX: number; mouseY: number } | undefined;
    const topdownCameraShakeState: TopdownCameraShakeState = {
      remainingMs: 0,
      phaseRadians: 0,
    };
    const inputSnapshot = () => {
      const snapshot = input.snapshot();
      if (smokeStartQueued) {
        smokeStartQueued = false;
        return { ...snapshot, enter: true };
      }
      if (smokeFireQueued) {
        const fire = smokeFireQueued;
        smokeFireQueued = undefined;
        return { ...snapshot, mouseLeft: true, mouseX: fire.mouseX, mouseY: fire.mouseY };
      }
      return snapshot;
    };

    const engine = await createEngine((frame) => {
      applyTopdownPresentationEffects(
        { gameplayEvents: frame.gameplayEvents, audioEvents: frame.audioEvents },
        runtimeEngine,
        platformHost,
        topdownCameraShakeState,
      );
      const cameraShakeOffset = consumeTopdownCameraShake(frame.frameTimeMs, topdownCameraShakeState);
      const renderStartMs = performance.now();
      renderer.render();
      renderer.setSpriteScreenOffset(cameraShakeOffset.x, cameraShakeOffset.y);
      try {
        renderer.renderCommands(frame.renderCommandBuffer);
      } finally {
        renderer.setSpriteScreenOffset(0, 0);
      }
      if (physicsDebugLines) {
        renderer.renderPhysicsDebugLines(frame.physicsDebugLineBuffer, {
          x: frame.cameraX + cameraShakeOffset.x,
          y: frame.cameraY + cameraShakeOffset.y,
        });
      }
      const renderStats = renderer.renderPostProcess();
      const renderTimeMs = performance.now() - renderStartMs;
      audioEventRateCount += frame.audioEvents.length;
      const audioEventRateElapsedMs = performance.now() - audioEventRateWindowStartMs;
      if (audioEventRateElapsedMs >= 1000) {
        audioEventsPerSecond = audioEventRateCount / (audioEventRateElapsedMs / 1000);
        audioEventRateWindowStartMs = performance.now();
        audioEventRateCount = 0;
      }

      hudEl.textContent = `${assetProgressText} controls: Enter or Space start, W/A/S/D move, Mouse Left or Space fire, Space restart`;

      if (frame.gameState === 0) {
        hudEl.textContent = "Press Enter or Space to start";
      } else if (frame.gameState === 2) {
        hudEl.textContent = `Game Over - final score ${frame.score}. Press Space to restart.`;
      }

      if (effectSmokeEnabled && runtimeEngine && smokeTextureIds) {
        recordTopdownSmokeFrame(runtimeEngine, frame.renderCommandBuffer, smokeTextureIds, frame.gameState, frame.score);
      }
      if (massObjectsSmokeEnabled && runtimeEngine && massObjectsSmokeApply) {
        recordTopdownMassObjectsSmokeFrame(
          runtimeEngine,
          massObjectsSmokeApply,
          renderStats,
          renderTimeMs,
          frame.gameState,
          frame.physics.collisionPairs,
        );
      }
      if (authoredBehaviorVariantApplyEnabled) {
        recordTopdownAuthoredBehaviorFrame(frame, authoredBehaviorVariantSummary, runtimeEngine);
      }

      const debugMetrics = {
        fps: frame.frameTimeMs > 0 ? 1000 / frame.frameTimeMs : 0,
        frameTimeMs: frame.frameTimeMs,
        entityCount: frame.entityCount,
        spriteCount: frame.spriteCount,
        drawCalls: renderStats.drawCalls,
        batchCount: renderStats.batchCount,
        renderCommandCount: renderStats.renderCommandCount,
        textureBindCount: renderStats.textureBindCount,
        textureSwitchCount: renderStats.textureSwitchCount,
        physicsDebugLineCount: renderStats.physicsDebugLineCount,
        physicsFixedSteps: frame.physics.fixedSteps,
        physicsTileCandidateChecks: frame.physics.tileCandidateChecks,
        physicsCcdChecks: frame.physics.ccdChecks,
        physicsCcdHits: frame.physics.ccdHits,
        collisionPairCount: frame.physics.collisionPairs,
        collisionEventCount: frame.physics.collisionEventCount,
        audioEventsPerSecond,
        rustUpdateTimeMs: frame.rustUpdateTimeMs,
        renderTimeMs,
        mouseX: frame.mouseX,
        mouseY: frame.mouseY,
        cameraX: frame.cameraX,
        cameraY: frame.cameraY,
        gameState: gameStateText(frame.gameState),
        score: frame.score,
      };
      runtimeProfiler?.recordFrame(debugMetrics);
      debugOverlay.update(debugMetrics);
    }, inputSnapshot, platformHost, () => renderer.viewportSize(), { enablePhysicsDebugLines: physicsDebugLines });
    runtimeEngine = engine;
    cleanups.push(() => engine.destroy());

    const manifest = topdownAssetManifest();
    let assets: LoadedAssets;
    try {
      await preloadTopdownAssets(manifest, loadingOverlay, (text) => {
        assetProgressText = text;
      });
      assets = await engine.loadAssets(manifest, (progress) => {
        assetProgressText = assetProgressLabel("assets", progress);
        loadingOverlay.update(progress);
      });
      loadingOverlay.complete();
    } catch (error) {
      loadingOverlay.fail(error);
      throw error;
    }
    smokeTextureIds = applyTopdownShooterAssets(engine, assets);
    if (massObjectsSmokeEnabled) {
      engine.setGameSpec(TOPDOWN_MASS_OBJECTS_SMOKE_SPEC);
      engine.resetGame();
      massObjectsSmokeApply = restoreTopdownMassObjectsSnapshot(engine, renderer.viewportSize());
    }
    const authoredBehaviorVariant = assets.json.authoredBehaviorVariant;
    if (authoredBehaviorVariant === undefined) {
      throw assetApplyError("json", "authoredBehaviorVariant", "Required authored behavior variant JSON is missing from loaded assets.");
    }
    const authoredBehaviorVariantPrepared = prepareTopdownAuthoredBehaviorVariant(authoredBehaviorVariant);
    authoredBehaviorVariantSummary = authoredBehaviorVariantPrepared.summary;
    if (authoredBehaviorVariantApplyEnabled) {
      authoredBehaviorVariantSummary.runtimeApply = applyTopdownAuthoredBehaviorVariant(
        engine,
        authoredBehaviorVariantPrepared,
        assets.json.game as ShooterGameSpec,
        (authoredBehaviorVariantApplyId += 1),
      );
    }
    assetProgressText = `assets: ${assets.progress.loaded}/${assets.progress.total}`;

    const onBeforeUnload = (): void => cleanupResources(cleanups);
    window.addEventListener("beforeunload", onBeforeUnload);
    cleanups.push(() => window.removeEventListener("beforeunload", onBeforeUnload));
    engine.start();
    const smokeWindow = window as TopdownSmokeWindow;
    smokeWindow.ferrumEngine = engine;
    smokeWindow.ferrumRuntime = { engine, renderer, ...(runtimeProfiler === undefined ? {} : { profiler: runtimeProfiler }) };
    smokeWindow.ferrumTopdownAuthoredBehaviorVariant = authoredBehaviorVariantSummary;
    if (authoredBehaviorVariantApplyEnabled) {
      smokeWindow.ferrumTopdownAuthoredBehaviorStart = () => {
        if (engine.gameState() === 0) {
          smokeStartQueued = true;
        }
      };
      smokeWindow.ferrumTopdownAuthoredBehaviorApplyCurrentStateCommands = () => {
        if (authoredBehaviorVariantSummary?.runtimeApply === undefined) {
          throw assetApplyError("json", "authoredBehaviorVariant", "Authored behavior runtime apply summary is not initialized.");
        }
        const stateCommandApply = applyTopdownAuthoredBehaviorCurrentStateCommands(
          engine,
          authoredBehaviorVariantPrepared,
          authoredBehaviorVariantSummary.runtimeApply,
          "replaceSupported",
        );
        smokeWindow.ferrumTopdownAuthoredBehaviorStateCommandApply = stateCommandApply;
        return stateCommandApply;
      };
      smokeWindow.ferrumTopdownAuthoredBehaviorResetAndReapply = () => {
        if (authoredBehaviorVariantSummary === undefined) {
          throw assetApplyError("json", "authoredBehaviorVariant", "Authored behavior variant summary is not initialized.");
        }
        smokeWindow.ferrumTopdownAuthoredBehaviorFrame = undefined;
        engine.resetGame();
        const runtimeApply = applyTopdownAuthoredBehaviorVariant(
          engine,
          authoredBehaviorVariantPrepared,
          assets.json.game as ShooterGameSpec,
          (authoredBehaviorVariantApplyId += 1),
        );
        authoredBehaviorVariantSummary.runtimeApply = runtimeApply;
        smokeWindow.ferrumTopdownAuthoredBehaviorVariant = authoredBehaviorVariantSummary;
        smokeWindow.ferrumTopdownAuthoredBehaviorStateCommandApply = undefined;
        return runtimeApply;
      };
    }
    if (effectSmokeEnabled) {
      smokeWindow.ferrumTopdownSmokeStart = () => {
        smokeStartQueued = true;
      };
      smokeWindow.ferrumTopdownSmokeFireAt = (mouseX: number, mouseY: number) => {
        smokeFireQueued = { mouseX, mouseY };
      };
    }
  } catch (error) {
    cleanupResources(cleanups);
    throw error;
  }
}

void bootstrap().catch(reportBootstrapError);
