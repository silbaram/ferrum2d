# Ferrum2D Public API

이 문서는 `@ferrum2d/ferrum-web` package entrypoint에서 애플리케이션이 직접 import해도 되는 API 계약을 요약한다. 코드 기준은 `packages/ferrum-web/src/index.ts`다.

## Import 원칙

애플리케이션과 예제 코드는 package entrypoint만 사용한다.

```ts
import {
  AnimationTimelinePlayer,
  animationTimelineFrameAt,
  applySceneCompositionFragment,
  applyBehaviorRecipes,
  applyBehaviorStateMachineStateCommands,
  applyGameplayBehaviorCommands,
  applyGameplayEventActions,
  behaviorRecipeCommandsForEntity,
  bindSceneBehaviorRecipes,
  BEHAVIOR_STATE_MACHINE_RUNTIME_MAX_TRANSITIONS,
  AudioManager,
  BrowserPlatformHost,
  ACCESSIBILITY_CONTRAST_PALETTES,
  accessibilitySubtitlePanel,
  applyAccessibilityToCameraRigSpec,
  applyAccessibilityToScreenFadeSpec,
  buildDebugGizmoLineBuffer,
  buildDebugGizmoLines,
  captureGameStateSnapshot,
  capturePhysicsWorldSnapshot,
  compilePhysicsAuthoringDocument,
  createPhysicsBodyStateBufferSnapshot,
  createPhysicsReplayInputStream,
  createPhysicsReplayWorkerClient,
  WebGL2Renderer,
  createEngine,
  createFerrumRuntime,
  createBehaviorStateMachineCurrentStateCommandPlan,
  createGameplayReplayRun,
  createPixelMaskTerrain,
  createPixelMaskTerrainRuntime,
  createPhysicsWorldFromSpec,
  createRigidBody,
  createRenderer,
  createAssetPreloadCachePolicy,
  createBehaviorStateMachineStateCommandPlan,
  createGameplayBehaviorRuntimeTarget,
  DEFAULT_INPUT_ACTION_PROFILE,
  TOPDOWN_SHOOTER_INPUT_ACTION_PROFILE,
  deriveHd2dTileOccludersFromTilemapGrid,
  deriveTileOccludersFromTilemapGrid,
  evaluateRuntimeProfilerBudget,
  extractPixelMaskBoundaryChains,
  extractTilemapBoundaryChains,
  createHudOverlayState,
  HUD_THEME_PRESETS,
  hashGameplayReplayRun,
  IndexedDbAssetCache,
  instantiateSceneFragment,
  LoadingOverlay,
  preflightBehaviorStateMachineStateCommands,
  invalidatePreloadedAssetCache,
  preloadAssetManifest,
  dryRunSceneBehaviorRecipes,
  bindPresentationEffectActions,
  gameplayActionsForEvents,
  gameplayActionDiagnosticReports,
  gameplaySpawnDiagnosticReports,
  gameplayEventActionMetadataForCommands,
  resolveAnimationTimelineSpec,
  resolveAccessibilityOptions,
  resolveBehaviorRecipeDocument,
  resolveBehaviorStateMachineDocument,
  resolveGameplayBehaviorRuntimeIds,
  resolvePresentationEffectRegistry,
  createBehaviorStateMachineRuntimeInstallPlan,
  installBehaviorStateMachineRuntime,
  compileWeaponProfiles,
  projectile,
  weapon,
  resolveAssetPreloadPlan,
  resolveAccessibilityHudTheme,
  resolveHudTheme,
  resolveSceneCompositionSpec,
  runPhysicsReplayInputStream,
  compareGameplayReplayRuns,
  restoreGameStateSnapshot,
  restorePhysicsWorldSnapshot,
  saveGameStateSnapshotToStorage,
  summarizeScreenshotPixels,
  verifyPhysicsReplayInputStreamRollback,
  WebGPURenderer,
  physicsMaterial,
  normalizeLightingScene,
  PARTICLE_VFX_PRESETS,
  particleVfxPreset,
  ParticleVfxEmitter,
  resolveSpriteMaterialPreset,
  resolveParticleVfxPresetConfig,
  resolveInputActionState,
  resolvePhysicsSpec,
  resolveShooterGameSpec,
  RuntimeProfiler,
  runBehaviorStateMachineReplay,
  SPRITE_MATERIAL_PRESETS,
  VirtualControls,
  type ActionFrameDiagnostics,
  type FerrumEngine,
  type FerrumRuntime,
  type FrameState,
  type AnimationTimelineEmittedEvent,
  type AnimationTimelineEventSpec,
  type AnimationTimelineSpec,
  type AudioManagerState,
  type PlayBgmOptions,
  type StopBgmOptions,
  type BehaviorRecipeCommand,
  type BehaviorRecipeDocumentSpec,
  type BehaviorRecipeRuntimeTarget,
  type BehaviorStateMachineDocumentSpec,
  type BehaviorStateMachineReplayInput,
  type BehaviorStateMachineReplayResult,
  type BehaviorStateMachineRuntimeInstallPlan,
  type BehaviorStateMachineStateCommandPlan,
  type BoundBehaviorRecipeCommand,
  type GameplayBehaviorBindingSpec,
  type GameplayBehaviorRuntimeIds,
  type GameplayEventAction,
  type PresentationEffectRegistrySpec,
  type ResolvedPresentationEffectRegistry,
  type ResolveGameplayBehaviorRuntimeIdsOptions,
  type ResolvePresentationEffectRegistryOptions,
  type GameplayReplayComparison,
  type GameplayReplayRun,
  type ProjectileActionAim,
  type ProjectileAuthoringCompileOptions,
  type ProjectileCollisionTarget,
  type ProjectileDefinition,
  type ProjectileDefinitionBuilder,
  type ProjectileTileImpact,
  type WeaponDefinition,
  type WeaponDefinitionBuilder,
  type AccessibilityOptionsSpec,
  type ResolvedAccessibilityOptions,
  type ScreenshotPixelSummary,
  type DebugGizmoSceneSpec,
  type HudComponentSpec,
  type HudThemeInput,
  type ResolvedSceneCompositionInstance,
  type SceneCompositionSpec,
  type SceneCompositionTarget,
  type LightingScene2D,
  type LightingShadowOptions,
  type Hd2dTileOccluderDefinition,
  type Hd2dTileOccluderGridInput,
  type PointLight2D,
  type SpriteMaterialPreset,
  type SpriteMaterialPresetInput,
  type SpriteMaterialPresetName,
  type SpriteMaterialProvider,
  type ParticleVfxPresetConfig,
  type ParticleVfxPresetName,
  type ParticleVfxEmitterConfig,
  type ShadowClipRect,
  type ShadowProjectionOptions,
  type PhysicsBodyColliderOptions,
  type PhysicsBodyHeightSpan,
  type PhysicsBodyHeightSpanQuery,
  type PhysicsHd2dKinematicMoveOptions,
  type PhysicsHd2dKinematicMoveResult,
  type PhysicsTileHeightSpan,
  type PhysicsTileHeightSpanQuery,
  type PhysicsBodyColliderSnapshot,
  type PhysicsBodyStateBufferSnapshot,
  type PhysicsDebugOptions,
  type PhysicsMode,
  type ShooterGameSpec,
  type ShooterProjectileArcSpec,
  type ShooterTileBridgePortalSpec,
} from "@ferrum2d/ferrum-web";
```

다음 경로는 public API가 아니다.

- `@ferrum2d/ferrum-web/dist/*`
- `@ferrum2d/ferrum-web/pkg/*`
- `packages/ferrum-web/src/*`
- generated wasm-bindgen API인 `../pkg/ferrum_core`

## 주요 엔트리포인트

| API | 용도 |
| --- | --- |
| `createEngine(...)` | Wasm `Engine`, input/viewport provider, asset host, frame callback을 묶어 `FerrumEngine`을 만든다. |
| `createFerrumRuntime(...)` | canvas, WebGL2/WebGPU renderer, input, asset/audio host, UI/debug overlay를 포함한 browser runtime을 만든다. |
| `createRenderer(...)` | 기본 WebGL2 renderer를 생성하며, `preferred: "webgpu"`가 들어오면 WebGPU를 먼저 시도한 뒤 실패 시 WebGL2로 fallback한다. |
| `resolveAssetPreloadPlan(...)`, `preloadAssetManifest(...)`, `createAssetPreloadCachePolicy(...)`, `LoadingOverlay` | asset manifest를 loading-screen용 plan/progress/cache version으로 펼치고 texture/sound/json URL을 미리 fetch하며 DOM loading preset에 연결한다. |
| `AudioManager` | Web Audio 기반 BGM/SFX/UI 재생, master/bgm/sfx/ui bus volume, BGM loop/fade, unlock을 관리한다. |
| `resolveInputActionState(...)` | `InputSnapshot`과 JSON-friendly action profile/virtual button state를 action/axis state로 변환한다. |
| `VirtualControls`, `applyVirtualControlStateToSnapshot(...)` | DOM joystick/button preset을 만들고 virtual input state를 `InputSnapshot`에 합성한다. |
| `normalizeLightingScene(...)`, `deriveTileOccludersFromTilemapGrid(...)`, `deriveHd2dTileOccludersFromTilemapGrid(...)` | renderer lighting pass용 ambient/point light/tile occluder 데이터를 검증하고 tilemap solid rectangular run 또는 HD-2D `blocksVision`/`occluderHeight` metadata를 debug/shadow occluder로 변환한다. |
| `SPRITE_MATERIAL_PRESETS`, `resolveSpriteMaterialPreset(...)` | WebGL2/WebGPU sprite pass에서 쓰는 built-in material preset과 JSON-friendly custom material을 검증한다. |
| `PARTICLE_VFX_PRESETS`, `particleVfxPreset(...)`, `ParticleVfxEmitter` | 기존 particle burst API 위에서 burst/loop/trail VFX preset과 emitter runtime을 제공한다. |
| `resolveAnimationTimelineSpec(...)`, `AnimationTimelinePlayer` | sprite frame timeline의 frame event metadata와 signal/atEnd state transition을 검증하고 재생한다. |
| `resolveSceneCompositionSpec(...)`, `instantiateSceneFragment(...)`, `applySceneCompositionFragment(...)` | prefab variant/override와 reusable scene fragment를 검증하고 runtime adapter에 flat instance로 전달한다. |
| `resolveBehaviorRecipeDocument(...)`, `behaviorRecipeCommandsForEntity(...)`, `applyBehaviorRecipes(...)` | common gameplay recipe를 검증하고 장르별 runtime adapter가 처리할 command로 변환한다. |
| `compileWeaponProfiles(...)`, `projectile(...)`, `weapon(...)` | 발사체/무기 authoring DSL/definition을 `BehaviorRecipeDocumentSpec`으로 compile해 entity별 `projectileAction` 구성요소로 변환한다. |
| `resolveBehaviorStateMachineDocument(...)`, `createBehaviorStateMachineRuntimeInstallPlan(...)`, `installBehaviorStateMachineRuntime(...)` | FSM authoring data를 검증하고 Rust-owned numeric FSM component에 낮은 빈도로 설치한다. |
| `createHudOverlayState(...)`, `resolveHudTheme(...)`, `HUD_THEME_PRESETS` | HUD meter/counter/prompt/message preset과 theme token을 DOM `UiOverlayState`로 변환한다. |
| `resolveAccessibilityOptions(...)`, `resolveAccessibilityHudTheme(...)`, `accessibilitySubtitlePanel(...)` | reduced motion, subtitle toggle, contrast palette, input assist metadata를 검증하고 UI/camera adapter hook으로 변환한다. |
| `summarizeScreenshotPixels(...)`, `compareScreenshotSummaries(...)` | browser smoke/readback screenshot summary와 baseline threshold 비교 report를 만든다. |
| `resolveShooterGameSpec(...)` | Shooter Game Spec 기본값과 검증을 적용한다. |
| `applyShooterGameSpec(...)` | 검증된 Shooter Game Spec을 Rust engine에 적용한다. |
| `resolvePhysicsSpec(...)` | `physics` namespace의 mode/material/layer/body/collider/joint metadata 기본값과 검증을 적용한다. |
| `createPhysicsWorldFromSpec(...)` | resolved/raw Physics Spec body/joint metadata를 runtime rigid body world로 적용한다. |
| `applyPhysicsSceneProfile(...)` | Physics Spec world를 `manual` 또는 `runtime` scene profile로 적용하고 runtime profile에서는 Rust update loop의 auto rigid-body step을 켠다. |
| `createRigidBody(...)`, `createCollider(...)`, `createJoint(...)`, `createVehicleRig(...)` | 낮은 수준 scalar API 대신 intent 중심 physics object와 차량/서스펜션 rig를 생성한다. |
| `extractTilemapBoundaryChains(...)` | resolved Shooter tilemap collision layer를 Physics Spec static chain body map으로 변환한다. |
| `createPixelMaskTerrain(...)`, `extractPixelMaskBoundaryChains(...)` | alpha mask 기반 destructible terrain helper와 Physics Spec chain boundary 변환을 제공한다. |
| `createPixelMaskTerrainRuntime(...)` | pixel mask terrain의 WebGL2 texture upload와 chunk collider rebuild/ownership을 조율한다. |
| `captureGameStateSnapshot(...)`, `restoreGameStateSnapshot(...)` | scene metric, optional built-in shooter state, optional PhysicsWorld snapshot, custom JSON state를 versioned game save envelope로 묶고 복원한다. |
| `stringifyGameStateSnapshot(...)`, `parseGameStateSnapshot(...)`, `saveGameStateSnapshotToStorage(...)` | game save snapshot을 JSON/localStorage-compatible storage에 저장하고 hash 검증과 함께 읽는다. |
| `createGameplayReplayRun(...)`, `compareGameplayReplayRuns(...)` | `GameStateSnapshot` frame sequence를 golden gameplay replay run으로 묶고 machine-actionable JSON path diff를 만든다. `pnpm smoke:gameplay-replay`는 이 helper로 committed Top-down Shooter fixture를 비교한다. |
| `RuntimeProfiler`, `runtimeDiagnosticsFrameSample(...)`, `evaluateRuntimeProfilerBudget(...)` | frame/render/physics/asset progress sample을 모으고 budget 위반을 보고한다. |
| `capturePhysicsWorldSnapshot(...)`, `restorePhysicsWorldSnapshot(...)`, `verifyPhysicsReplayRollback(...)` | Physics Spec으로 만든 world의 낮은 빈도 snapshot/restore/replay 검증을 수행한다. |
| `createPhysicsBodyStateBufferSnapshot(...)` | `PhysicsEntitySnapshot[]`를 Wasm bulk restore용 typed-array body state buffer로 변환한다. |
| `createPhysicsReplayInputStream(...)`, `runPhysicsReplayInputStream(...)`, `verifyPhysicsReplayInputStreamRollback(...)` | frame/seed/fixed step/body event 기반 replay stream과 rollback 검증을 수행한다. |
| `createPhysicsReplayWorkerClient(...)` | Physics Spec snapshot/replay를 Web Worker에서 실행하고 transfer benchmark를 측정하는 opt-in client를 만든다. |
| `compilePhysicsAuthoringDocument(...)` | `physicsEditor` metadata를 제거하고 runtime `PhysicsSpec`만 export한다. |
| `diagnosticReport(...)` | runtime/package 진단 정보를 만든다. |
| `buildDebugGizmoLines(...)`, `buildDebugGizmoLineBuffer(...)` | AI/tooling이 만든 path/spawn/prefab/collider debug spec을 renderer의 physics debug line buffer 계약으로 변환한다. |

## Runtime Extensibility 기능 맵

projectile/weapon/prefab/motion/query/reaction/effect event 고도화로 추가된 범용 기능의 제품 기준 요약은 [Runtime Extensibility](runtime-extensibility.md)에 둔다. 이 문서는 기능별 import 가능 API와 타입을 나열하고, Runtime Extensibility 문서는 해당 API들이 Rust core와 TypeScript authoring 경계에서 어떻게 조합되는지 설명한다.

| 기능 | Public API 표면 | 실행 책임 |
| --- | --- | --- |
| Projectile/Weapon authoring | `projectile(...)`, `weapon(...)`, `compileWeaponProfiles(...)`, `behaviorRecipeCommandsForEntity(...)` | TS가 definition을 검증/컴파일하고 Rust가 action/movement/collision component를 실행한다. |
| Scene/behavior composition | `resolveSceneCompositionSpec(...)`, `bindSceneBehaviorRecipes(...)`, `applyGameplayBehaviorCommands(...)` | TS가 낮은 빈도 command를 설치하고 Rust frame loop가 gameplay state를 변경한다. |
| Motion/target query | `resolveBehaviorRecipeDocument(...)`의 `linear`/`seekTarget`/`accelerate`, `nearest*` preset | Rust `World`/Shooter runtime이 target selection과 projectile velocity를 계산한다. |
| Collision reaction | `collisionAreaDamage`, `collisionKnockback`, `collisionSpawnPrefab`, `collisionEmitEffect`, `collisionDespawn` command | Rust가 damage, score, despawn, pending spawn, effect event를 deterministic order로 처리한다. |
| Presentation effect | `resolvePresentationEffectRegistry(...)`, `bindPresentationEffectActions(...)`, `CreateEngineOptions.effectEvents` | Rust는 `EffectEvent` buffer를 만들고 TS frame-end adapter가 audio/particle/camera/custom handler로 dispatch한다. |
| Agent/package QA | `pnpm package:consumer-smoke`, `pnpm validate:consumer-smoke-report`, `pnpm smoke:consumer-smoke-report` | generated consumer project에서 public import/type/build/replay/agent install contract를 검증한다. |

## FerrumEngine API 그룹

`FerrumEngine`은 `packages/ferrum-web/src/createEngine.ts`의 인터페이스 조합이다.

| 그룹 | 대표 API |
| --- | --- |
| Lifecycle | `start`, `pause`, `resume`, `stop`, `destroy`, `time`, `version` |
| Scene | `score`, `entityCount`, `gameState`, `resetGame`, `useBreakoutGame`, `usePlatformerGame`, `setGameSpec`, `setViewportSize`, tilemap edit helpers |
| Asset | `loadAssets`, `textureId`, `soundId`, `setTextureIds`, `setSoundIds` |
| Particle | `setParticlePreset`, `spawnParticleBurst`, `clearParticles`, `particleCount`, `ParticleVfxEmitter` |
| Physics runtime | `configureFixedTimestep`, `setPhysicsDebugLinesEnabled`, `setPhysicsDebugOptions`, `stepRigidBodies` |
| Physics body | `spawnRigidBody`, `addPhysicsBodyCollider`, `getPhysicsBodyColliderCount`, `getPhysicsBodyCollider`, `getPhysicsEntity`, `despawnPhysicsEntity`, body/collider/height span control, force/impulse/torque |
| Physics joint | `spawnPhysicsJoint`, `getPhysicsJoint`, `clearPhysicsJoint`, `setPhysicsJointEnabled` |
| Physics query | nearest, overlap, raycast, segment-cast, shape-cast, contact/manifold, contact impulse snapshot |

`FrameState`는 render/audio/collision/debug snapshot이다. `FrameState.physics.mode`는 현재 runtime physics mode 표시용이며, 게임 규칙의 source of truth가 아니므로 장기 simulation state로 사용하지 않는다. `FrameState.spriteCount`는 Rust-side culling 이후 보이는 render command 수를 뜻한다. `FrameState.actionDiagnostics`는 Rust-owned action trigger phase의 frame telemetry snapshot이며 `triggerAttempts`, `triggerFailures`, `triggerFailureEventsPushed`, `triggerCommitSkips`, optional `lastPreparedTriggerFailureReasonCode`, `failureReasonCounts`를 제공한다. `triggerAttempts`는 render frame 안에서 처리된 trigger 수이며 preparation failure와 noop도 포함한다. `failureReasonCounts[reasonCode]`는 Rust `GAMEPLAY_ACTION_FAILURE_*` reason code와 같은 index를 사용하고, 길이는 `GAMEPLAY_ACTION_FAILURE_MAX_REASON_CODE + 1`이며 reason `0`은 no-reason bucket이다. `FrameState.spawnDiagnostics`는 Rust-owned deferred spawn flush 결과이며 `commandsDrained`, `projectileSpawns`, `projectileArcsApplied`, `projectileShootAudioEventsPushed`, `prefabSpawns`, `prefabSpawnedPayloads`, `prefabSpawnedEventsPushed`를 제공한다. fixed timestep에서는 같은 render frame 안의 substep 결과를 합산한다. 이 값들은 agent/debug/reporting용 관측 신호이고 TS에서 action 실행을 되돌려 호출하는 callback surface가 아니다. HD-2D scene에서는 debug/profiler 용도로 `playerFloorId`, `playerElevation`, `playerHeight`, HD-2D filtered entity/tile candidate counters가 함께 노출된다. `renderCommandBuffer`, `collisionEventBuffer`, `gameplayEventBuffer`, `physicsDebugLineBuffer` 같은 Wasm typed-array view는 해당 frame에서 동기 소비하는 용도다. frame 밖에 보관하거나 `await` 이후 읽어야 하면 먼저 복사한다.

## Runtime API

`createFerrumRuntime(...)`은 browser app에서 우선 사용하는 high-level entrypoint다.

| 타입/API | 역할 |
| --- | --- |
| `FerrumRuntime` | `engine`, `renderer`, `input`, `assetHost`, optional `debugOverlay`/`uiOverlay`와 lifecycle method를 묶는다. |
| `FerrumRuntimeOptions` | canvas, renderer/input/ui/debug/engine/profiler/physicsScene option, per-frame callback을 받는다. |
| `FerrumRuntimeFrame` | `FrameState`, renderer stats, debug metrics, fps/render time snapshot이다. |
| `UiOverlayStateProvider` | runtime frame을 읽어 HUD/menu/dialog state를 만든다. |
| `LightingSceneProvider` | frame snapshot을 읽어 renderer lighting scene을 갱신한다. |
| `SpriteMaterialProvider` | frame snapshot을 읽어 renderer sprite material preset을 갱신한다. |

`FerrumRuntimeOptions.profiler`에 `true`, `RuntimeProfilerOptions`, 또는 기존 `RuntimeProfiler` instance를 전달하면 runtime이 매 frame의 `DebugOverlayMetrics`를 profiler에 기록한다. profiler가 켜져 있으면 debug/ui/onFrame callback이 없어도 runtime frame snapshot을 구성한다.

`FerrumRuntimeOptions.physicsScene`에 `PhysicsSceneProfileSpec`을 전달하면 runtime 생성 직후 `applyPhysicsSceneProfile(...)`을 실행한다. 기본 `runtime` profile은 Rust `Engine.update()` 내부 auto rigid-body step을 켜며, per-entity JS/Wasm callback을 만들지 않는다.

`FerrumRuntimeOptions.lighting`에는 고정 `LightingScene2D` 또는 `(frame) => LightingScene2D` provider를 전달할 수 있다. WebGL2/WebGPU renderer는 sprite pass 이후 ambient overlay, point light pass, opt-in light-radius-clipped tile occluder shadow projection을 적용한다. 자동 browser smoke는 WebGL2 경로와 WebGPU 가능 환경의 WebGPU 경로를 나눠 확인한다.

`FerrumRuntimeOptions.spriteMaterial`에는 고정 `SpriteMaterialPresetInput` 또는 `(frame) => SpriteMaterialPresetInput` provider를 전달할 수 있다. 이 옵션은 Rust render command ABI를 바꾸지 않고 TS renderer의 sprite pass에서 preset을 적용한다.

## Input API

`InputManager`는 keyboard/mouse/pointer/touch/gamepad 입력을 `InputSnapshot`으로 합성한다. 게임 규칙은 이 snapshot을 직접 읽거나 action profile helper로 장르별 action/axis state를 만들 수 있다. 이 TS action profile은 UI/helper 계층의 해석이며, Rust gameplay action 실행의 source of truth는 별도 Rust-owned input action registry다.

| 타입/API | 역할 |
| --- | --- |
| `InputManagerOptions.gamepadMapping` | standard gamepad axis/button index를 `InputSnapshot`의 movement/action/menu/pointer 입력으로 다시 매핑한다. |
| `GamepadInputMapping` | `moveXAxis`, `moveYAxis`, `actionButtons`, `menuButtons`, `pointerButtons`를 담는 JSON-friendly rebind 구조 |
| `DEFAULT_INPUT_ACTION_PROFILE` | `moveUp/moveLeft/moveDown/moveRight/primary/menu` action과 `moveX/moveY` axis 기본값 |
| `TOPDOWN_SHOOTER_INPUT_ACTION_PROFILE`, `PLATFORMER_INPUT_ACTION_PROFILE`, `BREAKOUT_INPUT_ACTION_PROFILE`, `INPUT_ACTION_PROFILES` | 장르별 action id(`fire`, `jump`, `launch`)와 movement axis를 담은 JSON-friendly preset |
| `resolveInputActionState(...)` | `InputSnapshot`, `InputActionProfile`, optional `virtualButtons`를 `actions`, `axes`, `pressedActions`로 변환한다. |
| `InputActionProfile` | action id별 `control`/`virtualButton` binding과 action 기반 axis binding을 담는 rebind JSON 구조 |
| `VirtualControls` | DOM joystick과 `primary`/`menu` button preset을 만들고 `applyToSnapshot(...)`, `virtualButtons(...)`, `state(...)`를 제공한다. |
| `DEFAULT_VIRTUAL_CONTROL_BUTTONS` | `primary -> space/mouseLeft`, `menu -> enter` 기본 button mapping |
| `applyVirtualControlStateToSnapshot(...)` | DOM 없이도 virtual control state를 `InputSnapshot`에 합성하는 테스트 가능한 helper |

`VirtualControls`는 browser platform layer 전용 DOM preset이다. 게임 규칙은 `VirtualControls.applyToSnapshot(input.snapshot())`로 raw snapshot을 합성하거나, `VirtualControls.virtualButtons()`를 `resolveInputActionState(...)`의 `virtualButtons` 옵션에 전달해 action profile과 연결할 수 있다. touch/pen drag는 기존처럼 `InputManager`가 movement snapshot으로 합성한다.

## Game State Snapshot API

`GameStateSnapshot`은 세이브 파일용 versioned JSON envelope다. 현재 범위는 `FerrumEngine`에서 조회 가능한 scene metric(`score`, `gameState`, entity/sprite count, camera), 선택적 built-in shooter state, 선택적 `PhysicsWorldSnapshot`, 게임별 `custom` JSON state를 하나로 묶는 것이다.

| 타입/API | 역할 |
| --- | --- |
| `captureGameStateSnapshot(...)` | runtime scene metric을 캡처하고, `includeBuiltInShooterState`가 `true`이면 built-in shooter state를, `physicsWorld`가 전달되면 `capturePhysicsWorldSnapshot(...)` 결과를 포함한다. |
| `restoreGameStateSnapshot(...)` | snapshot의 built-in shooter state와 PhysicsWorld를 복원하고, `applyCustomState` callback이 있으면 게임별 custom JSON을 적용한다. |
| `hashGameStateSnapshot(...)` | scene/physics/custom 내용을 canonical JSON hash로 계산한다. |
| `stringifyGameStateSnapshot(...)`, `parseGameStateSnapshot(...)` | snapshot hash를 검증하면서 JSON 문자열로 export/import한다. |
| `saveGameStateSnapshotToStorage(...)`, `loadGameStateSnapshotFromStorage(...)`, `removeGameStateSnapshotFromStorage(...)` | browser `localStorage`와 같은 `getItem`/`setItem`/`removeItem` storage에 slot을 저장, 로드, 삭제한다. |
| `FerrumEngine.builtInShooterPlayerHandle()` | 현재 built-in Shooter player entity의 generation-checked handle을 낮은 빈도로 반환한다. `resetGame()` 이후에는 새 handle을 다시 조회해야 한다. |
| `BuiltInShooterStateSnapshot`, `captureShooterStateSnapshot()`, `restoreShooterStateSnapshot(...)` | built-in shooter의 score, game state, spawn/wave timer, camera, player/enemy/bullet runtime state와 player primary projectile/dash/melee/spawnPrefab action binding/cooldown을 낮은 빈도 save/load용 buffer로 캡처하고 복원한다. |
| `FerrumEngine.setInputActionBinding(...)`, `clearInputActionBindings(...)`, `resetInputActionBindings()` | built-in Shooter action id와 physical control을 낮은 빈도 경계에서 매핑한다. 현재 public facade control은 `space`, `enter`, `mouseLeft`, activation은 `down`, `pressed`다. |
| `GameStateSnapshotJsonValue` | custom state가 JSON-compatible 값임을 드러내는 타입이다. |
| `createGameplayReplayRun(...)` | strictly increasing `GameStateSnapshot[]`를 `GameplayReplayRun`으로 묶고 frame별 snapshot hash와 run hash를 만든다. |
| `compareGameplayReplayRuns(...)` | expected/actual replay run hash를 비교하고 첫 mismatch frame과 JSON path(`gameplayReplay.snapshots.1.snapshot...`)를 반환한다. |
| `hashGameplayReplayRun(...)` | frame 번호와 frame snapshot hash 목록을 canonical run hash로 계산한다. |

Top-down Shooter의 committed baseline scenario 계약은 `tests/fixtures/gameplay-golden/scenarios.json` manifest가 정의한다. 현재 manifest는 basic/authored behavior/authored player damage/wave action/state-enter spawn success, dash/projectile/melee success/failure, authored homing missile/explosive projectile fixture를 `pnpm smoke:gameplay-replay`로 함께 검증한다. 장르별 setup과 exact payload assertion은 smoke runner가 소유하고, manifest는 description, kebab-case `coverageTags`, coverage vocabulary path, runner id, input/capture metadata, expected replay hash와 score/event/FSM metadata, optional `expected.spawnDiagnostics` frame metric을 고정한다. coverage vocabulary의 source of truth는 `tests/fixtures/gameplay-golden/coverage-tags.json`이며, 여기에는 active `coverageTagDefinitions`, 사람이 빠르게 읽기 위한 `coverageTagGroups`, 폐기 tag를 보존하기 위한 `deprecatedCoverageTags`가 들어간다. 이 vocabulary는 현재 커밋된 replay scenario coverage tag contract이며, planning용 gameplay taxonomy가 아니다. 정의된 active tag는 최소 하나의 scenario에서 실제 사용되어야 하고, 모든 active tag는 최소 하나의 group에 속해야 하며, scenario tag는 active definition만 참조하고 deprecated tag를 사용할 수 없다. `tests/fixtures/gameplay-golden/fixture-index.json`은 manifest의 `fixtureIndexPath`가 가리키는 파생 catalog이며, agent가 scenario id, description, coverage tags, coverage vocabulary path, runner, fixture path, replay hash, frame count를 작게 읽기 위한 보조 artifact다. 기본 fixture는 deterministic enemy spawn, projectile travel, enemy damage, score reward를 본다. authored behavior fixture는 raw Wasm authoring setter로 score pickup, interaction event, collisionDamage reaction, one-shot timer trigger, source-scoped FSM transition을 설치한 뒤 scene/built-in shooter/custom JSON state를 replay hash에 포함한다. homing missile fixture는 TS `SceneComposition`/`BehaviorRecipe` binding으로 `seekTarget(nearestTag:hostile)`, damage, particle, despawn, lifetime command를 설치하고 Rust frame loop의 projectile movement, tagged target collision, `presentationEffect` payload, score reward를 hash 범위에 포함한다. explosive projectile fixture는 같은 TS binding 경로로 `collisionAreaDamage`, `collisionEmitEffect`, `collisionDespawn`, `accelerate`, lifetime command를 설치하고 반경 내 복수 enemy damage/score/despawn, 반경 밖 enemy 생존, `presentationEffect` payload를 replay hash에 포함한다. authored player damage fixture는 enemy contact damage reaction이 player health를 0으로 만들 때 `GameOver`가 되지만 player/enemy entity count와 score가 유지되고 `collisionDamage.targetRemoved === false`인지 고정한다. smoke는 각 scenario를 같은 build에서 두 번 실행해 actual-vs-actual hash가 같은지도 먼저 확인한다. authored fixture의 input metadata에는 enter 입력, authoring phase, body spawn data, component/timer/FSM setup data, 기대 event/FSM/score가 들어간다. timer coverage는 state-enter command 자동 실행이 아니라 낮은 빈도 authoring setup으로 설치한 timer component가 Rust frame loop에서 `timer` event를 emit하고 같은 frame FSM transition으로 관측되는지만 고정한다. authored timer spawn, wave action spawn, state-enter spawn/projectile success 경로는 `expected.spawnDiagnostics`로 spawn queue drain과 actual projectile/prefab spawn count를 고정한다. smoke 출력의 `actionDiagnostics`와 `spawnDiagnostics`는 replay snapshot hash에는 포함하지 않는 agent-facing summary이며, `gameplayActionDiagnosticReports(...)`와 `gameplaySpawnDiagnosticReports(...)`로 Rust-owned telemetry를 `path`/`expected`/`actual`/`suggestion` report로 변환한다. expectation 없이 positive spawn activity가 관측되면 `spawnExpectationPatches`가 `expected.spawnDiagnostics` object 후보를 제공한다. `expected.spawnDiagnostics` mismatch는 smoke 실패로 승격되지만 golden fixture에는 저장하지 않는다. `gameplay-authoring-dry-run-report`와 `gameplay-replay-smoke-report` artifact envelope는 각각 `schemas/gameplay-authoring-dry-run-report.schema.json`, `schemas/gameplay-replay-smoke-report.schema.json`으로 self-validation된다. 이 smoke는 internal raw-Wasm harness라서 public runtime wrapper를 만들지 않고, `Engine` getter와 built-in shooter snapshot buffer로 `captureGameStateSnapshot(..., { includeBuiltInShooterState: true })`와 같은 canonical shape를 직접 구성한다. 의도한 gameplay behavior 변경으로 baseline을 갱신할 때는 `pnpm update:gameplay-replay-golden`을 실행하고, replay hash 변경 이유를 변경 기록에 남긴다.

주의: built-in shooter restore는 gameplay state를 대상으로 한다. 점수, game state, spawn/wave timer, camera, player/enemy/bullet position/velocity/health/damage/lifetime/reward와 in-flight bullet collision target/tile impact/source faction, player primary projectile/dash/melee/spawnPrefab action binding/cooldown은 복원하지만, hit flash, particle, tween, pending spawn/melee command, pending audio event 같은 순간 효과는 세이브 파일에 포함하지 않는다. `BuiltInShooterStateSnapshot` version `15`는 player primary action의 projectile tile impact policy, in-flight bullet collision target/tile impact/source faction policy, dash/melee action binding/cooldown slot, player spawnPrefab action binding/cooldown 반복 슬롯, registered Enemy/Bullet prefab alias id, spawnPrefab projectile payload, Rust input action registry, full previous `InputState` edge snapshot, prefab registry canonical payload를 포함한다. version `15`는 header float `8`, header u32 `85`, entity float stride `75`, entity u32 stride `61`을 public validation에서 고정한다. version `15`는 version `14`에서 prefab registry component bucket에 collision layer slot을 추가한 format bump다. spawnPrefab 반복 슬롯은 현재 `ActionBindingSet` capacity에 맞춰 최대 8개를 action id 오름차순 canonical order로 저장하고, restore도 gap이나 내림차순 slot을 거부해 recapture hash drift를 막는다. snapshot `version`과 `headerU32s[0]`는 같은 version code여야 하며, restore는 중복 action id 또는 capacity 초과 action binding snapshot을 거부한다. `restoreGameStateSnapshot(..., { restoreBuiltInShooterState: false })`로 built-in shooter state 적용을 끌 수 있다.

Gameplay replay helper는 `GameStateSnapshot`을 frame 단위 canonical gameplay snapshot으로 사용한다. golden 비교 대상은 scene metric, built-in shooter state, optional PhysicsWorld/custom JSON이며 render command, audio event, wall-clock profiler, debug overlay는 snapshot/hash 범위에 들어가지 않는다. 이 API는 runtime loop를 대신 실행하지 않는다. smoke나 예제 harness가 fixed timestep/seed/input sequence로 프레임을 실행하면서 필요한 frame에서 `captureGameStateSnapshot(..., { includeBuiltInShooterState: true })`를 호출하고, 그 결과를 `createGameplayReplayRun(...)`에 넘기는 구조다.

## Renderer API

기본 제품 renderer는 WebGL2다. WebGPU는 선택 renderer이며 browser support가 없거나 adapter/context 생성에 실패하면 WebGL2로 fallback한다.

- `WebGL2Renderer`: WebGL2 sprite/debug line/lighting/fullscreen post-processing renderer
- `WebGPURenderer`: WebGPU sprite/debug line/lighting/fade post-processing renderer. Rust render command ABI는 WebGL2와 동일하게 소비한다.
- `Renderer`: `render`, `resize`, `stats`, `destroy` 계약
- `RendererStats`: draw call, batch, sprite, texture bind/switch, physics debug line, lighting draw, point light, tile occluder, shadow draw/caster, post-process draw/pass count
- `createRenderer`: WebGL2/WebGPU renderer factory
- `WebGL2Renderer.createPixelMaskTerrainTexture(...)`, `updatePixelMaskTerrainTexture(...)`: `PixelMaskTerrain` alpha mask를 texture로 만들고 dirty patch만 부분 갱신한다.
- `WebGPURenderer.createPixelMaskTerrainTexture(...)`, `updatePixelMaskTerrainTexture(...)`: 같은 `PixelMaskTerrain` texture upload 계약을 WebGPU texture로 제공한다.

### Sprite Material API

Sprite material preset은 Rust render command ABI를 바꾸지 않는 platform renderer 기능이다. WebGL2와 WebGPU가 같은 preset 계약을 사용하며, material 효과가 켜진 경우 renderer가 필요한 추가 sprite pass를 그린다.

| 타입/API | 역할 |
| --- | --- |
| `SPRITE_MATERIAL_PRESETS` | built-in `unlit`, `flash`, `additive`, `outline` preset map |
| `SpriteMaterialPresetName` | built-in preset 이름 union |
| `SpriteMaterialPresetInput` | preset 이름, custom preset object, `false`, `undefined`를 받는 runtime 입력 타입 |
| `SpriteMaterialPreset` | `blendMode`, `colorMix`, `outline`을 담는 JSON-friendly custom preset |
| `resolveSpriteMaterialPreset(...)` | built-in/custom sprite material을 검증하고 renderer가 쓰는 resolved 구조로 변환 |

예시:

```ts
await createFerrumRuntime({
  canvas,
  spriteMaterial: "outline",
});

await createFerrumRuntime({
  canvas,
  spriteMaterial: (frame) => (frame.gameState === 1 ? "flash" : "unlit"),
});
```

주의: 현재 material preset은 frame 전체 sprite pass에 적용된다. per-sprite material id나 사용자 shader source injection은 render command ABI, batching, 보안 정책을 바꾸므로 별도 설계가 필요하다.

### Particle/VFX API

Rust core는 particle simulation과 render command 생성을 맡고, Web public API는 agent가 수정하기 쉬운 VFX preset schema와 emitter runtime을 제공한다. `ParticleVfxEmitter`는 기존 `FerrumEngine.setParticlePreset(...)`과 `spawnParticleBurst(...)`만 호출하므로 Wasm ABI를 늘리지 않는다.

| 타입/API | 역할 |
| --- | --- |
| `ParticlePresetConfig` | texture, lifetime, speed, size, color, acceleration, damping을 담는 단일 particle burst preset |
| `PARTICLE_VFX_PRESETS` | built-in `hit-spark`, `dust-loop`, `motion-trail` VFX preset map |
| `particleVfxPreset(name, texture)` | built-in VFX preset에 게임 texture id/name을 입혀 복사한다. |
| `ParticleVfxPresetConfig` | `particle` burst preset과 `emitter` mode 설정을 함께 담는 JSON-friendly VFX schema |
| `ParticleVfxEmitterConfig` | `burst`, `loop`, `trail` mode와 interval/distance/max burst 제한을 설정한다. |
| `resolveParticleVfxPresetConfig(...)` | VFX schema를 검증하고 default를 채운다. |
| `ParticleVfxEmitter` | frame마다 낮은 빈도로 `update(delta, x, y)`를 호출해 loop/trail burst를 생성한다. |

예시:

```ts
const emitter = ParticleVfxEmitter.create({
  target: runtime.engine,
  presetId: 5,
  preset: particleVfxPreset("motion-trail", "spark"),
});

emitter.start(player.x, player.y);
emitter.update(deltaSeconds, player.x, player.y);
```

주의: `ParticleVfxEmitter`는 gameplay 객체별 hot-path callback 시스템이 아니다. 장면 코드나 agent-generated adapter가 필요한 소수 emitter를 명시적으로 갱신하는 용도이며, sub-emitter나 GPU particle은 별도 성능 설계가 필요하다.

### Animation Timeline API

Animation timeline은 atlas/sprite sheet frame id와 frame event metadata를 데이터로 묶는 public helper다. Rust render command ABI를 바꾸지 않고, agent-generated scene adapter가 현재 animation frame, sound/VFX/hitbox event, state transition을 한 곳에서 읽을 수 있게 한다.

| 타입/API | 역할 |
| --- | --- |
| `AnimationTimelineSpec` | state별 frame 목록 또는 `frameCount`, fps, loop, event, transition을 담는 JSON-friendly schema |
| `resolveAnimationTimelineSpec(...)` | timeline 기본값을 채우고 event frame, transition target, initial state를 검증한다. |
| `animationTimelineFrameAt(...)` | 특정 state/elapsed time의 frame snapshot을 계산한다. |
| `AnimationTimelinePlayer` | `update(delta, { signals })`로 frame event를 방출하고 signal/atEnd transition을 적용한다. |
| `AnimationTimelineEmittedEvent` | frame index, frame id, event id, optional payload를 담는 낮은 빈도 gameplay hook 이벤트 |

예시:

```ts
const timeline = resolveAnimationTimelineSpec({
  initialState: "idle",
  states: {
    idle: {
      frames: ["idle.0", "idle.1"],
      fps: 2,
      transitions: [{ on: "move", to: "move" }],
    },
    move: {
      frames: ["move.0", "move.1", "move.2"],
      fps: 6,
      events: [{ frame: 1, id: "footstep", payload: { sound: "step" } }],
      transitions: [{ on: "stop", to: "idle" }],
    },
  },
});

const player = AnimationTimelinePlayer.create(timeline);
const update = player.update(deltaSeconds, { signals: ["move"] });
for (const event of update.events) {
  // scene adapter가 sound/VFX/hitbox hook으로 변환한다.
}
```

주의: 이번 범위는 frame event metadata와 state transition helper다. sprite renderer에 per-entity animation state를 자동 binding하거나 event를 audio/VFX 시스템에 자동 연결하는 adapter는 장르 템플릿 또는 scene composition 기능에서 확장한다.

### Scene Composition API

Scene composition은 AI agent가 prefab, variant, scene fragment를 데이터로 조립하기 위한 저빈도 authoring helper다. 엔진 core나 render command ABI를 바꾸지 않고, 게임별 runtime adapter가 flat instance 목록을 받아 entity/physics/UI spawn으로 변환하는 구조다.

| 타입/API | 역할 |
| --- | --- |
| `SceneCompositionSpec` | prefab props, variant props, reusable fragment include, fragment instance를 담는 JSON-friendly schema |
| `resolveSceneCompositionSpec(...)` | prefab/variant/fragment reference, variant inheritance cycle, JSON-compatible props, transform 값을 검증한다. |
| `instantiateSceneFragment(...)` | include transform/idPrefix/props를 합성해 `ResolvedSceneCompositionInstance[]`로 flatten한다. |
| `applySceneCompositionFragment(...)` | `SceneCompositionTarget.spawnSceneInstance(instance)` adapter를 호출하고 spawn 결과를 반환한다. |
| `ResolvedSceneCompositionInstance` | prefab id, variant id, transform, merged props, resolved id를 담는 runtime adapter 입력 |

예시:

```ts
const composition = resolveSceneCompositionSpec({
  prefabs: {
    enemy: {
      props: { kind: "enemy", stats: { hp: 1 } },
      variants: {
        elite: { props: { stats: { hp: 3 }, reward: 5 } },
      },
    },
  },
  fragments: {
    room: {
      include: [{ fragment: "spawn", idPrefix: "left.", x: 10 }],
    },
    spawn: {
      instances: [{ id: "enemy", prefab: "enemy", variant: "elite", x: 2 }],
    },
  },
});

applySceneCompositionFragment({
  spawnSceneInstance: (instance) => {
    // 게임별 adapter가 instance.props를 entity spawn, physics body, HUD element 등으로 변환한다.
  },
}, composition);
```

주의: 이번 범위는 variant/override 검증과 reusable fragment apply path다. nested prefab authoring, renderer/entity 자동 binding, built-in scene spawn semantics는 장르 템플릿과 Behavior Recipe Library에서 별도 확장한다.

### Behavior Recipe API

Behavior recipe는 health, damage, faction, lifetime, scoreReward, pickup, collisionPickup, collisionKnockback, collisionSpawnPrefab, collisionEmitEffect, collisionSound, collisionParticle, collisionShake, collisionDespawn, chase, interaction, projectileAction, dashAction, meleeAction, spawnPrefabAction, timerTrigger 같은 흔한 게임 행동과 scalar gameplay component를 Game Spec 친화적인 데이터로 표현하고, runtime adapter가 처리할 command로 변환한다. 이 계층은 gameplay loop를 직접 소유하지 않고, 장르 템플릿이나 agent-generated adapter가 `BehaviorRecipeCommand`를 받아 실제 entity state, physics, inventory, UI와 연결한다. `faction`은 `CollisionLayer`를 대체하지 않는 gameplay damage policy이며, 현재 Rust default adapter에서는 authored `CollisionReaction::Damage`, 기본 Bullet->Enemy/Bullet->Player damage path, 기본 melee Enemy/Player target path가 source/target `GameplayFaction`의 `damageMask`를 통과할 때만 damage 또는 GameOver를 적용한다. `faction: "neutral"`의 기본 `damages`는 빈 목록이므로 중립 source는 damage gate를 통과하지 못하고, 거부된 경우에도 다른 faction과 같은 `factionDamageDenied` telemetry를 남긴다. built-in alias는 `"neutral"=0`, `"player"=1`, `"enemy"=2`이며, custom faction은 `0..31` 정수 id로 직접 선언할 수 있다. custom numeric faction은 기본 `damages`가 빈 목록이므로 damage relation을 원하면 `damages`에 built-in alias 또는 numeric faction id를 명시해야 한다. projectile을 spawn할 때 source entity의 faction은 in-flight bullet에 복사되고 현재 built-in Shooter snapshot version `15`에 저장된다. 한쪽이라도 faction이 없으면 기존 legacy 동작을 유지한다. damage mask가 target faction을 거부하면 기본 bullet hit는 pass-through처럼 처리되어 bullet despawn, 기본 hit telemetry, 기본 hit audio/particle, score/game-over damage를 만들지 않는다. authored `CollisionReaction::Damage` deny도 같은 frame의 default hit presentation을 만들지 않는다. player/authored/Rust-owned `meleeAction.target = "enemies"`는 enemy kill 시 target의 `scoreReward`를 점수로 반영하지만, source/target faction이 모두 있고 mask가 거부하면 melee damage, score, hit presentation을 만들지 않는다. Rust-owned enemy-target melee는 source 중심 circle query를 사용하고 attacker 자신은 target으로 처리하지 않는다. Rust-owned `meleeAction.target = "player"`는 GameOver 경로이며 score를 만들지 않고, faction mask가 player damage를 거부하면 GameOver/audio/hit event를 만들지 않는다. authored `CollisionReaction::Damage` 또는 기본 projectile/melee damage gate에서 faction mask가 거부되면 frame `GameplayEvent.kind = "factionDamageDenied"` telemetry가 남고, actor는 target, source는 공격 주체, `tokenId`는 source faction id, `payloadBits`는 target faction id를 담는다. full generic friendly-fire matrix와 scene-level faction relation table은 아직 열지 않는다. `pickup`, `interaction`, `projectileAction`, `dashAction`, `meleeAction`, `spawnPrefabAction`, `collisionSpawnPrefab`, `timerTrigger`, `collisionEmitEffect`는 문자열 id 외에 optional numeric `itemId`/`actionId`/`prefabId`/`timerId`/`effectId`를 가질 수 있어 agent가 사람이 읽는 이름과 runtime token을 함께 관리할 수 있다. `pickup`은 pickup payload component를 설정하고, `collisionPickup`은 충돌한 target entity의 pickup component를 수집하는 authored collision reaction을 설정한다. `collisionKnockback`은 충돌 source와 target transform 방향을 기준으로 `self` 또는 `other` velocity에 impulse를 더하는 additive reaction이며, 기본 damage/despawn/pickup gameplay를 대체하지 않는다. `collisionSpawnPrefab`은 충돌한 `self` 또는 `other` entity transform을 anchor로 registered prefab spawn을 기존 pending spawn queue에 추가하는 additive reaction이다. `actionId`는 `prefabSpawned`/`actionFailed` telemetry correlation token으로 유지되고, spawn queue 성공 시에만 reaction cooldown을 커밋한다. 현재 기본 Rust runtime adapter는 projectile payload 없는 registered Enemy prefab만 collision spawn 대상으로 허용하며, tile collision에서 `target: "other"`는 대응 entity가 없으므로 no-op이다. `collisionEmitEffect`는 collision target entity를 actor로 하는 additive `GameplayEvent.kind = "presentationEffect"`를 내보내며, recipe의 `effect: string` 또는 `effectId`, `effectKind: "sound"|"particle"|"cameraShake"|"custom"`, `target`, `cooldownSeconds`, `trigger`를 adapter command의 numeric `effectType`과 함께 정규화한다. `effect` 문자열은 apply 시 `ids.effects`에서 numeric `effectId`로 해석되고, Rust에는 숫자 payload만 저장된다. tile collision에서 `target: "other"`는 대응 entity가 없으므로 no-op이다. `projectileAction.aim`은 `input` 또는 `targetPlayer`, `projectileAction.collisionTarget`은 `enemies` 또는 `player`를 표현한다. 현재 default Rust runtime adapter는 기존 player primary fire 의미인 `aim: "input"` + `collisionTarget: "enemies"`와 Rust-owned trigger projectile 의미인 `aim: "targetPlayer"` + `collisionTarget: "player"`만 적용한다. 다른 projectile 조합은 JSON-path diagnostic 또는 `actionFailed(unsupportedCollisionTarget)` telemetry로 실패한다. `dashAction.aim`은 기본값이 `input`이며 player input dash와 호환된다. timer/wave/state-enter 같은 Rust-owned trigger에서 dash를 실행하려면 `aim: "targetPlayer"`를 명시해야 하며, TS adapter는 이 경우 `set_gameplay_action_dash_with_aim(..., 1)`을 요구한다. `meleeAction.target`은 `enemies` 또는 `player`이며 기본값은 player input melee 호환 의미인 `enemies`다. Rust-owned trigger에서도 두 target을 모두 실행할 수 있다.

| 타입/API | 역할 |
| --- | --- |
| `BehaviorRecipeDocumentSpec` | reusable recipe와 entity별 recipe 목록을 담는 JSON-friendly schema |
| `resolveBehaviorRecipeDocument(...)` | recipe kind, reusable reference, override, entity별 중복 id, numeric/string 값을 검증한다. |
| `behaviorRecipeCommandsForEntity(...)` | 특정 entity recipe를 `configureHealth`, `configureDamage`, `configureFaction`, `configureLifetime`, `configureScoreReward`, `configurePickup`, `configureCollisionPickup`, `configureCollisionAreaDamage`, `configureCollisionKnockback`, `configureCollisionSpawnPrefab`, `configureCollisionEmitEffect`, `configureCollisionSound`, `configureCollisionParticle`, `configureCollisionShake`, `configureCollisionDespawn`, `configureChase`, `configureInteraction`, `configureProjectileAction`, `configureDashAction`, `configureMeleeAction`, `configureSpawnPrefabAction`, `configureTimerTrigger` command로 변환한다. resolver가 생성한 `configureFaction` command는 normalized `faction`과 `damages` mask source를, collision spawnPrefab/emitEffect/sound/particle/shake command는 normalized `trigger`를, `configureProjectileAction` command는 normalized `aim`/`collisionTarget`/`tileImpact`를, `configureMeleeAction` command는 normalized `target`을 항상 포함한다. 수동으로 만든 legacy projectile/melee command가 이 필드를 생략하면 default adapter는 기존 의미인 `input`/`enemies`/`despawn`, `enemies`로 취급한다. |
| `applyBehaviorRecipes(...)` | `BehaviorRecipeRuntimeTarget.applyBehaviorRecipeCommand(command)` adapter를 호출한다. |
| `BehaviorRecipeCommand` | 장르 runtime이 실제 구현으로 변환할 command union |

`collisionAreaDamage` recipe는 `configureCollisionAreaDamage` command로 변환되며, 기본 Rust adapter에서는 `set_gameplay_area_damage_reaction(...)`을 통해 source damage component와 `CollisionReaction::AreaDamage`를 한 번에 설정한다. entity/entity collision impact에서는 source transform을 우선 중심점으로 쓰고, tile impact에서는 Rust 내부 swept contact point를 중심으로 radius query를 실행한다. 이 동작은 public gameplay event ABI에 world/contact `x/y`를 추가하지 않고, 결과는 기존 `collisionDamage`/`factionDamageDenied` telemetry와 score/despawn outcome으로 노출된다. `collisionKnockback` recipe는 `configureCollisionKnockback` command로 변환되며, `target: "self"|"other"`와 positive finite `impulse`를 Rust `CollisionReaction::Knockback`으로 추가한다. `collisionSpawnPrefab` recipe는 `configureCollisionSpawnPrefab` command로 변환되며, 기본 Rust adapter에서는 `add_gameplay_collision_spawn_prefab(...)`로 `CollisionReaction::SpawnPrefab`을 추가한다. entity/entity collision에서는 `target` entity transform을 anchor로 쓰고, tile collision에서는 `target: "self"`만 source transform anchor로 동작한다. spawn은 collision phase에서 즉시 `World`를 변경하지 않고 기존 pending spawn queue에 들어가며, queue 성공 후 `prefabSpawned` telemetry가 기존 spawn flush 경로에서 생성된다. 실패는 `actionFailed` telemetry로 보고하고 cooldown은 소비하지 않는다. `collisionEmitEffect` recipe는 `configureCollisionEmitEffect` command로 변환되며, `effectId`를 직접 선언하거나 `effect` 문자열을 `ids.effects`로 해석할 수 있다. 기본 Rust adapter는 `add_gameplay_collision_emit_effect(...)`로 `CollisionReaction::EmitEffect`를 추가해 gameplay state mutation 없이 `presentationEffect` event만 생성하고, TS는 `resolvePresentationEffectRegistry(...)`와 `bindPresentationEffectActions(...)`로 frame-end adapter에 넘길 effect definition을 찾는다.

예시:

```ts
const recipes = resolveBehaviorRecipeDocument({
  recipes: {
    living: { kind: "health", max: 5, onZero: "event", event: "enemy.defeated" },
  },
  entities: {
    enemy: {
      recipes: [
        "living",
        { kind: "damage", amount: 2 },
        { kind: "faction", faction: "enemy", damages: ["player"] },
        { kind: "lifetime", seconds: 3 },
        { kind: "scoreReward", reward: 1 },
        { kind: "pickup", item: "score", count: 3 },
        { kind: "collisionPickup", target: "self" },
        { kind: "collisionAreaDamage", amount: 3, radius: 72, targetLayer: "enemy" },
        { kind: "collisionSpawnPrefab", action: "split", actionId: 7, prefab: "enemy", prefabId: 1, target: "other", trigger: "enter", offsetX: 6, offsetY: -3 },
        { kind: "collisionEmitEffect", effect: "impactSpark", effectKind: "custom", target: "self", intensity: 0.75, radius: 32, trigger: "enter" },
        { kind: "chase", target: "player", speed: 96 },
        { kind: "projectileAction", action: "primary", actionId: 1, cooldownSeconds: 0.15, speed: 360, damage: 1, lifetimeSeconds: 1.2, aim: "input", collisionTarget: "enemies" },
        { kind: "meleeAction", action: "slash", actionId: 3, cooldownSeconds: 0.35, range: 36, damage: 3, target: "player" },
        { kind: "spawnPrefabAction", action: "summon", actionId: 5, prefab: "enemy", prefabId: 1, cooldownSeconds: 1.2, anchor: "self", phase: "prePhysics", offsetX: 16, offsetY: 0 },
        { kind: "timerTrigger", timer: "wake", timerId: 6, seconds: 0.5 },
      ],
    },
  },
});

applyBehaviorRecipes({
  applyBehaviorRecipeCommand: (command) => {
    // 장르별 adapter가 command를 ECS/state/physics/inventory/UI hook으로 연결한다.
  },
}, recipes);

const effects = resolvePresentationEffectRegistry({
  impactSpark: { effectId: 99, kind: "custom", key: "impact-spark" },
});

const frameActions = gameplayActionsForEvents(frame.gameplayEvents);
const presentationBindings = bindPresentationEffectActions(frameActions, effects);
```

주의: 이번 범위는 schema 검증과 generated runtime adapter command 경로를 기본으로 하며, Rust gameplay component storage가 표현하는 일부 command는 기본 adapter가 직접 적용한다. inventory state mutation, interaction UI hook 같은 장르별 실행은 여전히 게임별 adapter에서 구현한다.

### Gameplay Authoring API

Gameplay authoring API는 `SceneComposition`의 resolved instance와 `BehaviorRecipe` profile을 묶는 저빈도 authoring helper다. prefab/variant/instance props의 `behaviorRecipes` 값을 읽어 recipe command를 생성하고, command의 `entity`를 recipe profile id가 아니라 resolved scene instance id로 retarget한다.

이 API는 runtime target을 호출하지 않는다. agent는 먼저 dry-run으로 composition/recipe reference를 검증하고, 통과한 binding plan만 게임별 adapter나 향후 Rust component 적용 경로에 넘긴다.

| 타입/API | 역할 |
| --- | --- |
| `GAMEPLAY_BEHAVIOR_BINDING_PROP` | 기본 binding prop 이름인 `behaviorRecipes` 상수 |
| `GameplayBehaviorBindingSpec` | instance props에 선언하는 behavior profile id 또는 id 배열 |
| `bindSceneBehaviorRecipes(...)` | scene instance를 flatten하고 각 instance의 behavior binding을 `BehaviorRecipeCommand[]`로 변환한다. |
| `dryRunSceneBehaviorRecipes(...)` | 외부 상태를 바꾸지 않고 binding plan 또는 `DiagnosticReport[]`를 반환한다. |
| `SceneBehaviorBindingPlan` | resolved fragment, instances, source command, retargeted command를 담는 실행 전 계획 |
| `resolveGameplayBehaviorRuntimeIds(...)` | `ids.items`/`ids.actions`/`ids.prefabs`/`ids.timers`/`ids.effects` registry를 positive runtime token map으로 검증하고, `requiredItems`/`requiredActions`/`requiredPrefabs`/`requiredTimers`/`requiredEffects` 누락을 diagnostic으로 반환한다. `ids.tags`만 bitmask component 제약 때문에 `0..31`을 허용한다. |
| `resolvePresentationEffectRegistry(...)` | named presentation effect registry를 `effectId`, `kind`, optional adapter metadata로 검증하고 `ids.effects` map을 생성한다. registry의 named effect id는 default fallback `0`과 구분하기 위해 positive u32여야 한다. |
| `bindPresentationEffectActions(...)` | frame-end `GameplayEventAction[]`에서 `presentationEffect` action만 골라 registry definition과 bind한다. missing effect id 또는 event kind/registry kind mismatch는 diagnostic으로 반환하고, opt-in `unknownEffect: "ignore"`로 안전 no-op 처리할 수 있다. |
| `effectDispatchesForEvents(...)` | frame-end `EffectEvent[]`를 registry definition과 결합해 `sound`/`particle`/`cameraShake`/`custom` dispatch object로 변환한다. registry가 없는 raw sound/particle id는 기본 `unknownEffect: "passthrough"` 정책으로 그대로 adapter에 넘길 수 있다. |
| `dispatchEffectEvents(...)` | `effectDispatchesForEvents(...)` 결과를 명시적 handler target의 `playSoundEffect`/`spawnParticleEffect`/`shakeCameraEffect`/`applyCustomEffect`로 라우팅하고 dispatch summary를 반환한다. handler가 없는 kind는 기본 no-op이며, `missingHandler: "error"`로 agent smoke용 diagnostic을 켤 수 있다. |
| `createEffectEventDispatchTarget(...)` | `AssetHost.playAudioEvents(...)`, `spawnParticleBurst(...)`, camera/custom callback을 `EffectEventDispatchTarget`으로 묶는 브라우저 runtime target factory다. `assetValidation: "error"`를 켜면 `AssetHost.hasSound(...)`/`hasSoundEffect(...)`와 `hasParticlePreset(...)`로 missing sound/preset을 dispatch 전에 diagnostic으로 차단한다. |
| `dispatchRuntimeEffectEvents(...)` | `FrameState.effectEvents`와 `EffectEventRuntimeOptions`를 받아 frame-end dispatch를 실행하고 `onDispatchSummary`를 호출한다. `CreateEngineOptions.effectEvents`가 내부적으로 이 경로를 사용한다. |
| `compileWeaponProfiles(...)` | `projectile(...)`와 `weapon(...)` DSL/definition을 받아 `BehaviorRecipeDocumentSpec`과 호환되는 `ResolvedBehaviorRecipeDocument`를 만든다. |
| `projectile(...)` | 발사체 전용 definition 빌더를 만들고 `speed`/`damage`/`lifetime`/`aim`/`collisionTarget`/`tileImpact`를 설정한다. |
| `weapon(...)` | 발사체를 참조하는 무기 definition 빌더를 만들고 `action`, `actionId`, `cooldown`, `fire(projectile)`를 설정한다. |
| `ProjectileDefinition` | `projectile(...)`이 생성하는 데이터 구조. |
| `WeaponDefinition` | `weapon(...)`이 생성하는 데이터 구조. |
| `ProjectileDefinitionBuilder`, `WeaponDefinitionBuilder` | fluent setter API. |
| `ProjectileActionAim`, `ProjectileCollisionTarget`, `ProjectileTileImpact`, `ProjectileAuthoringCompileOptions` | weapon profile builder/compile에서 쓰는 타입. |
| `applyGameplayBehaviorCommands(...)` | generation-checked entity handle map을 사용해 지원되는 behavior command를 Rust gameplay component setter로 적용한다. |
| `createGameplayBehaviorRuntimeTarget(...)` | 기존 `applyBehaviorRecipes(...)`와 연결할 수 있는 `BehaviorRecipeRuntimeTarget` adapter를 만든다. |
| `gameplayEventActionMetadataForCommands(...)` | `configureInteraction` command에서 runtime action id, action name, prompt metadata registry를 파생한다. |
| `gameplayActionsForEvents(...)` | decoded `GameplayEvent`를 UI/quest/cutscene/inventory adapter가 소비할 `GameplayEventAction[]`으로 변환한다. |
| `gameplayActionDiagnosticReports(...)` | `FrameState.actionDiagnostics`와 decoded `actionFailed` action을 agent가 읽기 쉬운 `path`/`expected`/`actual`/`suggestion` 리포트로 변환한다. |
| `gameplaySpawnDiagnosticReports(...)` | `FrameState.spawnDiagnostics`를 spawn flush activity 또는 expected count mismatch 리포트로 변환한다. |
| `applyGameplayEventActions(...)` | `GameplayEventActionTarget.applyGameplayEventAction(action)` adapter를 호출하고 action/result를 frame 단위로 반환한다. |
| `resolveBehaviorStateMachineDocument(...)` | JSON-friendly FSM authoring data를 검증하고 state/transition/profile reference를 resolved contract로 만든다. |
| `behaviorStateMachineBehaviorProfilesForState(...)` | 특정 machine/state가 참조하는 behavior profile 목록을 반환한다. |
| `behaviorStateMachineCommandsForState(...)` | 특정 machine/state의 behavior profile을 기존 `BehaviorRecipeCommand[]`로 펼친다. |
| `createBehaviorStateMachineRuntimeInstallPlan(...)` | FSM state 문자열과 transition predicate를 positive numeric state id, event kind, token id 설치 계획으로 변환한다. `interaction`은 action/actionId, `timer`는 timer/timerId, `pickupCollected`는 item/itemId, `tileImpact`는 emitted tile impact policy/code를 runtime token으로 해석한다. |
| `installBehaviorStateMachineRuntime(...)` | generation-checked entity handle에 Rust-owned FSM component를 낮은 빈도로 설치한다. 실패한 transition 적용은 clear로 rollback한다. |
| `createBehaviorStateMachineStateCommandPlan(...)` | 실제 install에 사용한 FSM install plan의 numeric state id를 state 문자열로 역매핑하고 해당 state의 behavior command plan을 만든다. |
| `createBehaviorStateMachineCurrentStateCommandPlan(...)` | 낮은 빈도 query로 Rust current state id를 읽고 install plan 기준 state command plan을 만든다. |
| `preflightBehaviorStateMachineStateCommands(...)` | state command plan을 실제 적용하기 전에 target retarget, runtime id lookup, command validation, `replaceSupported` clear capability를 mutation 없이 검증한다. |
| `applyBehaviorStateMachineStateCommands(...)` | state command plan을 generation-checked entity handle에 retarget해 지원되는 Rust gameplay component setter로 적용한다. |
| `BEHAVIOR_STATE_MACHINE_RUNTIME_MAX_TRANSITIONS` | 현재 Rust component가 entity별로 저장할 수 있는 FSM transition 상한. |
| `runBehaviorStateMachineReplay(...)` | 대상 entity handle과 readonly `GameplayEventAction` frame stream으로 FSM transition을 deterministic dry-run하고 replay hash를 만든다. |
| `compareBehaviorStateMachineReplay(...)` | 두 FSM replay hash/final state를 비교해 agent가 읽을 수 있는 diff summary를 반환한다. |
| `FerrumGameplayAuthoringApi` | `FerrumEngine`에 합성된 저빈도 gameplay authoring facade. raw Wasm setter를 public API로 노출하지 않고 아래 apply/install/query helper를 engine method로 제공한다. |
| `engine.gameplayEntityExists(...)` | Rust-owned generation/liveness check를 낮은 빈도로 읽어 agent apply가 stale handle을 clear/apply 전에 거부할 수 있게 한다. |
| `registerGameplayPrefabs(...)`, `engine.registerGameplayPrefabs(...)` | `ids.prefabs` 또는 직접 `prefabId`를 사용해 낮은 빈도 authoring 단계에서 Shooter prefab registry에 prefab alias를 등록한다. 현재 public kind는 `"enemy"`와 `"bullet"`을 지원하며 각각 Rust `register_gameplay_enemy_prefab(prefabId)`, `register_gameplay_bullet_prefab(prefabId)` 경로로 위임한다. Rust registry entry는 layer/template/texture/gameplay component bucket source를 함께 보관한다. Enemy `spawnPrefabAction`과 built-in Bullet projectile spawn은 같은 bucket resolver 계약으로 layer/template/texture/gameplay를 해석한다. projectile payload가 없는 `spawnPrefabAction`은 registered Enemy prefab id만 허용하고, projectile payload가 있는 `spawnPrefabAction`은 registered Bullet prefab id만 허용해 resolved Bullet prefab bucket 기반 projectile spawn path로 dispatch한다. Bullet prefab alias registration과 projectile payload binding은 save/replay hash에 포함된다. built-in reserved prefab id는 자기 kind로만 등록 가능하므로 Enemy id `1`을 Bullet로, Bullet id `2`를 Enemy로 재등록하면 실패한다. 등록되지 않은 prefab id는 Enemy fallback 없이 unsupported prefab failure로 처리한다. |
| `engine.applyGameplayBehaviorCommands(...)` | `applyGameplayBehaviorCommands(engine, ...)`와 같은 검증/적용 경로를 `FerrumEngine` method로 실행한다. |
| `engine.installBehaviorStateMachineRuntime(...)` | `installBehaviorStateMachineRuntime(engine, ...)`와 같은 FSM 설치 경로를 `FerrumEngine` method로 실행한다. |
| `engine.gameplayBehaviorState(...)` | generation-checked handle의 Rust-owned FSM current state id를 낮은 빈도로 읽는다. |
| `engine.createBehaviorStateMachineCurrentStateCommandPlan(...)` | `FerrumEngine`의 current state query를 사용해 state command plan을 만든다. |
| `engine.preflightBehaviorStateMachineStateCommands(...)` | `FerrumEngine`의 runtime capability 기준으로 state command apply를 mutation 없이 검증한다. |
| `engine.applyBehaviorStateMachineStateCommands(...)` | state command plan을 `FerrumEngine`의 Rust component setter 경로로 적용한다. |

FSM event predicate의 subject는 기본적으로 `GameplayEvent.source`와 FSM owner entity가 일치해야 한다. 예외는 `pickupCollected`이며, pickup source는 같은 collision phase에서 despawn될 수 있으므로 collector/player인 `actor` 기준으로 전이한다. 따라서 `pickupCollected` predicate는 플레이어나 collector entity에 설치하는 것이 현재 계약이고, collected pickup 자체의 FSM을 전이시키는 용도는 아니다.

```ts
const weaponProfiles = compileWeaponProfiles([
  weapon("player.primary")
    .action("primary")
    .cooldown(0.08)
    .fire(
      projectile("standard-shot")
        .speed(720)
        .damage(2)
        .lifetime(1.6),
    ),
  weapon("player.bounce")
    .action("bounce")
    .cooldown(0.1)
    .fire(
      projectile("bounce-shot")
        .speed(420)
        .damage(2)
        .tileImpact("bounce"),
    ),
], {
  path: "behaviorRecipes",
  actionIds: {
    primary: 1,
    bounce: 2,
  },
});

const mergedBehaviorRecipes = {
  ...existingBehaviorRecipes,
  recipes: {
    ...(weaponProfiles.recipes ?? {}),
    ...(existingBehaviorRecipes.recipes ?? {}),
  },
  entities: {
    ...(existingBehaviorRecipes.entities ?? {}),
    ...(weaponProfiles.entities ?? {}),
  },
};

const resolvedWeaponRecipes = resolveBehaviorRecipeDocument(mergedBehaviorRecipes, {
  path: "behaviorRecipes",
});
```

예시:

```ts
const composition = resolveSceneCompositionSpec({
  prefabs: {
    enemy: {
      props: {
        behaviorRecipes: "enemy.runner",
      },
    },
  },
  fragments: {
    main: {
      instances: [{ id: "runner-1", prefab: "enemy" }],
    },
  },
});

const recipes = resolveBehaviorRecipeDocument({
  entities: {
    "enemy.runner": {
      recipes: [
        { kind: "health", max: 2 },
        { kind: "damage", amount: 1, target: "other", cooldownSeconds: 0 },
        { kind: "lifetime", seconds: 4 },
        { kind: "scoreReward", reward: 1 },
        { kind: "chase", target: "player", speed: 80, stopDistance: 0 },
      ],
    },
  },
});
const runtimeIds = resolveGameplayBehaviorRuntimeIds({
  items: { coin: 1 },
  actions: { primary: 1, inspect: 2 },
  prefabs: { enemy: 1 },
  timers: { wake: 6 },
});

const dryRun = dryRunSceneBehaviorRecipes(composition, recipes);
if (dryRun.ok) {
  // dryRun.plan.commands[0].entity === "runner-1"
  engine.applyGameplayBehaviorCommands(dryRun.plan.commands, {
    "runner-1": { entityId: 12, entityGeneration: 3 },
  });
}
```

추가로 `configureFaction`의 damage mask는 기본 melee damage/GameOver gate에도 적용된다. player/authored `target: "enemies"` melee는 mask가 enemy faction을 거부하면 enemy health/score/hit presentation을 바꾸지 않고, Rust-owned `target: "player"` melee는 mask가 player faction을 거부하면 queued attack의 cooldown은 이미 소비된 상태로 유지하되 GameOver/audio/hit event를 만들지 않는다. 이 두 기본 melee deny 경로는 `factionDamageDenied` gameplay event로 source/target faction id를 남긴다.

`registerGameplayPrefabs(...)`는 `configureSpawnPrefabAction` 또는 `configureCollisionSpawnPrefab` 적용 전에 호출해 runtime registry와 `ids.prefabs` 해석을 맞추는 사전 등록 단계이며, 현재 public kind는 `"enemy"`와 `"bullet"`을 지원한다. `configureCollisionSpawnPrefab`의 기본 runtime dispatch는 이 중 projectile payload 없는 Enemy prefab alias만 사용한다.

`configureCollisionAreaDamage`는 positive finite `amount`, positive finite `radius`, `targetLayer: "player"|"enemy"|"bullet"|"wall"|"pickup"`를 요구한다. `targetLayer`는 gameplay faction이 아니라 Rust `CollisionLayer` mask이며, faction damage mask가 source/target 양쪽에 있으면 광역 피해 대상별로 같은 gate를 통과해야 한다. `configureCollisionEmitEffect`는 state mutation 없이 `GameplayEvent.kind = "presentationEffect"`와 `EffectEvent` detail buffer entry를 함께 생성한다. `intensity`와 `radius`를 지정하면 해당 값이 `EffectEvent` payload로 기록되고, 생략하면 기존 기본값 `1.0`/`0.0`을 쓴다.

주의: 이 API는 visual editor, scripting runtime, Wasm hot-path callback이 아니다. 적용 adapter는 scene load 또는 agent apply 같은 낮은 빈도 경로에서만 사용한다. public `FerrumEngine` facade는 raw `set_gameplay_*` Wasm setter를 노출하지 않고, `BehaviorRecipeCommand[]`, FSM document, generation-checked handle을 받는 typed method만 제공한다. input action registry도 `setInputActionBinding(...)` 같은 typed facade로만 노출한다. 일반 `applyGameplayBehaviorCommands(...)`는 batch transaction API가 아니므로 agent/runtime은 dry-run diagnostic 통과 후 적용해야 한다. FSM state command `replaceSupported` mode의 제한적 component-slot rollback은 아래 FSM 섹션의 범위를 따른다. `resetGame()`처럼 World를 새로 만드는 호출 이후에는 이전 physics/gameplay handle이 유효하지 않다. 새 World에서 entity id/generation 숫자가 재사용될 수 있으므로, runtime은 handle freshness를 숫자 차이로 판단하지 말고 해당 World/apply epoch 범위의 handle map을 다시 만들어 적용해야 한다. 현재 Rust component storage가 표현할 수 있는 subset만 허용하므로 `configureHealth`는 `current === max`, `onZero === "despawn"`, event 없음이어야 한다. `configureDamage`는 `cooldownSeconds === 0`만 허용하며 damage component와 collision damage reaction을 함께 설정한다. `configureFaction`은 public recipe type `BehaviorRecipeFaction` 값 `"neutral"|"player"|"enemy"|number`와 `damages` 목록을 Rust 내부 `GameplayFaction { faction_id, damage_mask }` component로 설정한다. numeric faction id와 numeric damage target은 Rust `GAMEPLAY_FACTION_MAX_ID`에 맞춰 `0..31`만 허용된다. 이 component는 `CollisionLayer`가 아니며 authored `Damage` collision reaction과 기본 projectile/melee damage gate에서 쓰인다. `configureCollisionPickup`은 `target: "self"|"other"`를 `CollisionReaction::Pickup`으로 추가한다. target은 collector가 아니라 `Pickup` component를 가진 entity다. 따라서 pickup entity에 붙이면 보통 `self`, player-side reaction으로 붙이면 `other`를 쓴다. 현재 runtime은 live player가 collector이고 target이 `CollisionLayer::Pickup` 및 score `Pickup` component를 가진 경우만 수집한다. `configureCollisionKnockback`은 `target: "self"|"other"`와 positive finite `impulse`를 `CollisionReaction::Knockback`으로 추가하며, entity/entity 충돌 source와 target transform 방향을 기준으로 target velocity에 impulse를 더한다. 이 reaction은 기본 damage/despawn/pickup gameplay를 대체하지 않는다. `configureCollisionSpawnPrefab`은 positive `actionId` 또는 `ids.actions[action]`, positive `prefabId` 또는 `ids.prefabs[prefab]`, `target: "self"|"other"`, optional non-negative finite `cooldownSeconds`, optional `trigger: "contact"|"enter"`, finite `offsetX/Y`를 `CollisionReaction::SpawnPrefab`으로 추가한다. runtime은 collision source를 telemetry source로 유지하고 target entity transform을 spawn anchor로 사용한다. tile impact에서는 `target: "self"`만 source transform anchor로 동작하고 `target: "other"`는 no-op이다. 현재 기본 Rust runtime은 registered Enemy prefab만 collision spawn 대상으로 큐잉하며, projectile payload를 가진 collision spawn은 아직 열지 않는다. `configureCollisionEmitEffect`는 non-negative safe u32 `effectId` 또는 `effect` + `ids.effects[effect]`, effect kind/type code `sound|particle|cameraShake|custom`, `target: "self"|"other"`, optional non-negative finite `cooldownSeconds`, optional `trigger: "contact"|"enter"`를 `CollisionReaction::EmitEffect`로 추가한다. runtime은 이를 state mutation 없이 `GameplayEvent.kind = "presentationEffect"`로 내보내며, tile impact에서 `target: "other"`는 대응 entity가 없어서 no-op이다. `configureCollisionSound`는 positive `soundId`, non-negative finite `volume`, positive finite `pitch`, optional non-negative finite `cooldownSeconds`, optional boolean `replaceDefault`, optional `trigger: "contact"|"enter"`를 `CollisionReaction::PlaySound`로 추가한다. `configureCollisionParticle`은 non-negative integer `presetId`, `target: "self"|"other"`, optional non-negative finite `cooldownSeconds`, optional boolean `replaceDefault`, optional `trigger: "contact"|"enter"`를 `CollisionReaction::SpawnParticle`로 추가하며, runtime은 해당 preset id가 등록되어 있을 때만 기존 `ParticleSystem`에 burst를 생성한다. `trigger` 기본값은 `"contact"`이고 기존 접촉 frame 단위 의미를 보존한다. `"enter"`는 entity/entity collision pair가 직전 collision frame에 없던 새 접촉일 때만 authored sound/particle/emitEffect/spawnPrefab side effect와 해당 reaction cooldown commit을 허용한다. reset/restore는 contact cache를 보존하지 않으므로 restore 직후 이미 겹친 pair는 새 enter처럼 다시 발화할 수 있다. `replaceDefault`는 Bullet/Enemy hit audio/particle 또는 authored Player/Enemy lethal damage의 game-over audio처럼 해당 collision path에 built-in default effect가 있을 때만 그 default effect를 suppress한다. sound/particle/emitEffect/spawnPrefab-only reaction은 default damage/despawn/game-over/pickup gameplay를 대체하지 않는다. Bullet/Tile impact에는 대체할 built-in audio/particle default가 없으므로 `replaceDefault`는 no-op이고 authored self side effect만 additive로 실행된다. tile impact는 terminal projectile hit이므로 `trigger: "enter"`도 허용된 enter contact로 취급한다. `configureCollisionShake`은 optional `cooldownSeconds`와 `trigger: "contact"|"enter"`를 받아 `CollisionReaction::CameraShake`를 추가한다.
 `configureCollisionDespawn`은 `target: "self"|"other"`를 `CollisionReaction::Despawn`으로 추가한다. `configureTags`는 behavior profile의 entity-level `tags`를 `ids.tags` 또는 numeric `nearestTag:<0..31>` 계약에 맞춘 Rust `GameplayTags` bitmask component로 설정한다. `configureChase`는 `stopDistance === 0`, `maxDistance` 없음만 허용하며 player target, `nearestPlayer`/`nearestEnemy` query preset, `nearestLayer:player|enemy|bullet|wall|pickup` layer query preset, `nearestFaction:neutral|player|enemy|<0..31>` faction query preset, `nearestTag:<tagName>|<0..31>` tag query preset, 또는 entity handle target을 `MovementPattern::Chase`로 설정한다. Shooter runtime은 player/entity target 모두 collision tilemap이 있으면 같은 tilemap navigation waypoint/cache 경로를 사용하고 cache key에 target identity를 포함한다. `configureSeekTarget`도 player target, entity handle target, `nearestPlayer`, `nearestEnemy`, `nearestLayer:*`, `nearestFaction:*`, `nearestTag:*` query preset을 지원한다. `nearestPlayer`는 live player transform을, `nearestEnemy`는 source 위치 기준 가장 가까운 Enemy layer transform을, `nearestLayer:*`는 source 위치 기준 지정 CollisionLayer의 가장 가까운 transform을, `nearestFaction:*`는 source 위치 기준 지정 `GameplayFaction.faction_id`를 가진 가장 가까운 transform을, `nearestTag:*`는 source 위치 기준 지정 `GameplayTags` bit를 가진 가장 가까운 transform을 Rust frame loop 안에서 해석한다. Shooter runtime은 Enemy movement phase 이후, physics integration 이전에 Bullet layer authored movement pattern을 적용한다. Bullet layer에 movement component가 없거나 지원하지 않는 movement가 있으면 기존 projectile velocity를 유지하므로 일반 `projectileAction` 탄도는 선형 이동을 유지하고, `seekTarget`이 있는 projectile만 유도탄처럼 steering된다. authored target query가 해석되지 않으면 해당 `MovementPattern`의 target-missing 동작을 따른다. 현재 `seekTarget` target이 없으면 projectile velocity는 0으로 떨어진다. `configureLifetime`은 `seconds > 0`, `configureScoreReward`는 0을 포함한 non-negative integer만 허용한다. `configurePickup`은 현재 `item: "score"` 또는 score item id `1`, positive integer `count`, `despawn: true`만 허용하고 Rust `Pickup` component로 적용한다. `configureInteraction`은 positive `actionId` 또는 `ids.actions[action]`, finite positive `radius`, boolean `once`만 Rust `Interaction` component로 적용한다. `configureTimerTrigger`는 positive `timerId` 또는 `ids.timers[timer]`, positive finite `seconds`를 요구하며 Rust `GameplayTimerTrigger` component로 적용한다. `action` 또는 `actionId`가 같이 있으면 `ids.actions[action]`으로 별도 action token을 해석해 `set_gameplay_timer_action_trigger(...)`로 설치한다. 이때 `timerId == actionId` 같은 암묵 매핑은 사용하지 않는다. action 없는 timer는 elapsed 후 `timer` gameplay event를 한 번만 emit하고, action 있는 timer는 같은 event를 emit한 뒤 Rust-owned `ActionTriggerQueue`에 action trigger를 적재한다. `configureProjectileAction`은 positive `actionId` 또는 `ids.actions[action]`, non-negative finite `cooldownSeconds`, positive finite `speed`/`damage`/`lifetimeSeconds`, optional `tileImpact: "despawn"|"passThrough"|"bounce"`를 요구한다. `tileImpact` 기본값은 `"despawn"`이다. `"passThrough"`는 blocking tile impact를 무시하고 tile-side authored sound/particle/despawn reaction도 실행하지 않는다. `"bounce"`는 blocking tile contact normal로 projectile velocity를 반사하고 tile-side authored self reaction을 additive로 실행한다. destructible terrain 같은 tile impact 의미는 diagnostic으로 실패한다. `aim: "input"`은 `collisionTarget: "enemies"`와 함께 legacy `set_gameplay_action_projectile(...)` path에 적용되지만, `tileImpact`가 `"passThrough"`이면 `set_gameplay_action_projectile_with_target(..., 0, 0, 1)` path를, `"bounce"`이면 `set_gameplay_action_projectile_with_target(..., 0, 0, 2)` path를 사용한다. `aim: "targetPlayer"`는 `collisionTarget: "player"`와 함께 `set_gameplay_action_projectile_with_target(..., 1, 1, tileImpactCode)` path에 적용된다. `input/player` 또는 `targetPlayer/enemies` 조합은 diagnostic으로 실패한다. `configureDashAction`은 positive `actionId` 또는 `ids.actions[action]`, non-negative finite `cooldownSeconds`, positive finite `distance`를 요구한다. `configureMeleeAction`은 positive `actionId` 또는 `ids.actions[action]`, non-negative finite `cooldownSeconds`, positive finite `range`/`damage`, optional `target` `enemies|player`를 요구한다. `target: "enemies"`는 legacy `set_gameplay_action_melee(...)` path에 적용되고, `target: "player"`는 `set_gameplay_action_melee_with_target(..., 1)` path에 적용된다. `configureSpawnPrefabAction`은 positive `actionId` 또는 `ids.actions[action]`, positive `prefabId` 또는 `ids.prefabs[prefab]`, non-negative finite `cooldownSeconds`, finite offset, `anchor: "self"`, `phase: "prePhysics"`를 요구한다. optional `projectile` payload가 있으면 positive finite `speed`/`damage`/`lifetimeSeconds`, `aim: "targetPlayer"`, `collisionTarget: "player"`, optional `tileImpact: "despawn"|"passThrough"|"bounce"`를 요구하고 projectile-prefab setter를 사용한다. 현재 기본 Rust setter/runtime은 Shooter prefab registry에 등록된 Enemy 또는 Bullet prefab id, `anchor: "self"`, `phase: "prePhysics"`만 허용한다. built-in Enemy prefab id `1`은 기본 등록되어 있고, `register_gameplay_enemy_prefab(prefabId)`로 Enemy prefab alias id를 추가할 수 있다. `register_gameplay_bullet_prefab(prefabId)`는 projectile payload가 있는 `spawnPrefabAction` dispatch 대상으로 사용할 Bullet prefab alias를 등록한다. player/unknown prefab code는 spawnPrefabAction에서 거부한다. Bullet prefab id는 projectile payload가 있을 때만 허용되고, Enemy prefab id는 projectile payload가 없어야 허용된다. projectile/dash/melee/spawnPrefab action command는 runtime engine이 각각 `set_gameplay_action_projectile(...)` 또는 targeted/non-default tileImpact projectile용 `set_gameplay_action_projectile_with_target(...)`, `set_gameplay_action_dash(...)`, legacy melee용 `set_gameplay_action_melee(...)` 또는 targeted melee용 `set_gameplay_action_melee_with_target(...)`, `set_gameplay_action_spawn_prefab(...)`를 제공할 때만 Rust `ActionBindingSet`에 적용한다. timer command는 action 없이면 runtime engine이 `set_gameplay_timer_trigger(...)`를, `action` 포함이면 `set_gameplay_timer_action_trigger(...)`를 제공할 때만 적용한다. 이 setter들은 public adapter 호환성을 위해 optional이며, command가 실제로 들어올 때 missing diagnostic을 낸다. built-in Shooter는 meleeAction도 action id `3`으로 소비하지만, 기본 physical binding은 두지 않는다. 사용자는 `setInputActionBinding(3, index, { control, activation })`으로 명시적으로 연결해야 한다. `spawnPrefabAction`도 기본 physical binding이 없지만, `timerTrigger`가 explicit action id를 참조하면 input binding 없이 Rust timer trigger가 실행할 수 있다.

Rust/Wasm authoring surface에는 generation-checked movement/action/collision/faction/tag/pickup/interaction/timer/FSM setter도 있다. `set_gameplay_movement_*`는 `MovementPattern` component data를, `set_gameplay_faction(...)`은 Rust 내부 `GameplayFaction` component data를, `set_gameplay_tags(...)`는 Rust 내부 `GameplayTags` bitmask component data를, `set_gameplay_action_projectile(...)`, targeted projectile용 `set_gameplay_action_projectile_with_target(...)`, `set_gameplay_action_dash(...)`, `set_gameplay_action_melee(...)`, targeted melee용 `set_gameplay_action_melee_with_target(...)`, `set_gameplay_action_spawn_prefab(...)`와 projectile payload authoring용 `set_gameplay_action_spawn_projectile_prefab(...)`는 fixed-capacity `ActionBindingSet`에 action config와 ready cooldown config를, `register_gameplay_enemy_prefab(prefabId)`와 `register_gameplay_bullet_prefab(prefabId)`는 Shooter prefab registry에 Enemy/Bullet prefab alias id를 등록하고, `add_gameplay_collision_damage(...)`, `add_gameplay_collision_pickup(...)`, `add_gameplay_collision_knockback(...)`, `add_gameplay_collision_spawn_prefab(...)`, `add_gameplay_collision_emit_effect(...)`, `add_gameplay_collision_sound(...)`, `add_gameplay_collision_particle(...)`, `add_gameplay_collision_despawn(...)`, `add_gameplay_collision_camera_shake(...)`, `add_gameplay_collision_camera_shake_with_cooldown(...)`, `add_gameplay_collision_camera_shake_with_trigger(...)`은 고정 크기 `CollisionReactionSet` component data를, `set_gameplay_pickup(...)`은 score pickup component data를, `set_gameplay_interaction(...)`은 radius 기반 interaction component data를, `set_gameplay_timer_trigger(...)`와 `set_gameplay_timer_action_trigger(...)`는 one-shot entity timer component data를 설정한다. `set_shooter_wave_action_trigger(waveIndex, sourceEntityId, sourceEntityGeneration, actionId)`는 낮은 빈도 authoring 경계에서 특정 wave 진입 시 source entity가 소유한 action id를 `ActionTriggerQueue`에 적재하도록 설정한다. `add_gameplay_behavior_state_enter_action(entity, generation, state, actionId, phase)`은 FSM이 해당 state로 전이된 뒤 source entity의 action id를 다음 Shooter frame의 pre-physics `ActionTriggerQueue`에 적재하도록 설정한다. 현재 phase code `0`만 지원하며 의미는 `NextFramePrePhysics`다. wave와 state-enter trigger 자체는 cooldown state를 소유하지 않으며 setter와 runtime queue 시점 모두 source entity generation freshness를 확인한다. Shooter runtime은 action id `1`을 기본 primary fire로, action id `2`를 player dash로, action id `3`을 player melee로 해석한다. player entity에 primary projectile binding이 있으면 기존 scene `fireCooldown`/`bulletSpeed`/`bulletDamage`/`bulletLifetime` 대신 binding의 cooldown/speed/damage/lifetime으로 bullet spawn command를 만든다. Rust-owned trigger projectile은 `targetPlayer/player` 조합에서 source에서 live player 방향으로 bullet을 발사하고, projectile spawn 시 source의 `GameplayFaction`을 bullet에 복사한다. player-target bullet은 enemy score path 대신 player game-over collision path를 타되, bullet과 player 양쪽 faction이 있고 damage mask가 player faction을 거부하면 기본 hit/game-over를 만들지 않고 통과한다. enemy-target bullet도 bullet과 enemy 양쪽 faction이 있고 damage mask가 enemy faction을 거부하면 기본 hit/despawn/damage/score/audio/particle을 만들지 않는다. dash binding은 Playing 상태에서 input action registry가 action id `2`를 active로 보고 cooldown이 ready이면 현재 이동 입력 방향, 없으면 mouse world 방향으로 player transform을 `distance`만큼 이동한다. melee binding은 action id `3`이 active이고 cooldown이 ready이면 player center 기준 circle query로 enemy mask를 조회해 `range` 안의 enemy에 `damage`를 적용하고, kill 시 score reward/despawn을 기존 combat phase에서 처리한다. source/target 양쪽에 faction이 있고 mask가 enemy faction을 거부하면 해당 enemy melee hit는 damage/score/presentation 없이 무시된다. melee whiff도 유효한 swing이면 cooldown을 소비한다. Rust-owned trigger melee는 `target: "player"`와 `target: "enemies"`를 모두 실행한다. `target: "player"`는 source가 generation-fresh이고 transform을 가지며 live player와 다른 entity이면 cooldown을 소비하고 pending melee command를 큐잉한다. combat phase에서 player가 range 안에 있고 faction mask가 player damage를 허용하면 game-over를 만들고 score/despawn/success gameplay event는 만들지 않는다. faction mask가 거부하거나 range 밖이면 GameOver/audio/hit event 없이 끝나며, 둘 다 유효한 공격으로 보고 cooldown은 소비한다. `target: "enemies"`는 source transform만 요구하며 live player target을 요구하지 않는다. combat phase에서 source 중심 circle query로 enemy layer를 조회하고, attacker 자신은 hit target에서 제외한다. enemy hit는 기존 enemy-target melee damage/score/despawn/presentation/`collisionDamage` event 경로를 재사용하고, faction mask가 거부하면 damage/score/presentation 없이 `factionDamageDenied`만 남긴다. `spawnPrefabAction` binding은 player input 또는 Rust-owned timer/wave/state-enter action trigger가 해당 action id를 발동하고 cooldown이 ready이면 prefab id와 `SpawnPrefabPlacement`(anchor/phase/offset/source transform), optional `SpawnPrefabProjectilePayload`, pending spawn capacity, enemy prefab AABB tilemap placement를 검증한 뒤 prefab spawn command를 pre-physics queue에 적재한다. TS facade는 `spawnPrefabAction.projectile` payload가 있으면 `set_gameplay_action_spawn_projectile_prefab(...)`를 호출하고, payload가 없으면 기존 `set_gameplay_action_spawn_prefab(...)` path를 사용한다. Rust raw authoring surface의 `set_gameplay_action_spawn_projectile_prefab(...)`는 registered Bullet prefab id에 projectile payload를 붙이고, runtime dispatch는 resolved Bullet layer bucket을 projectile prefab request로 생성한다. cooldown은 validation, capacity, placement check가 모두 성공한 뒤 소비된다. `collisionSpawnPrefab` reaction은 collision phase에서 collision owner의 `actionId`/`prefabId`, anchor target, offset을 평가해 같은 pending spawn queue에 적재한다. 이 reaction cooldown은 command 생성, placement/capacity pre-commit gate, queue가 모두 성공한 뒤에만 소비되고, 실패 시 `actionFailed` event로 관측된다. collision phase가 해당 frame의 spawn flush 이후라면 실제 entity 생성과 `prefabSpawned` event는 다음 flush에서 보인다. timer-driven spawn은 Shooter Playing phase에서 timer tick 후, wave-driven spawn은 wave advance 직후 `ActionTriggerQueue`를 거쳐 `flush_pending_spawns` 전에 처리되므로 같은 frame의 physics/world integration 전에 prefab이 생성된다. state-enter spawn/projectile/dash/melee는 FSM transition이 scene update 뒤에 발생하므로 다음 Shooter frame의 `ActionTriggerQueue` 처리에서 실행되고, 그 frame의 physics/world integration 전에는 spawn command, melee command 또는 transform update가 처리된다. wave trigger는 “새 active wave 진입” 시점의 additive action producer이며 기존 `spawn_enemy_if_needed(...)` wave spawn을 대체하지 않는다. unsupported prefab/anchor/phase, missing source transform, missing binding, pattern mismatch, cooling down, spawn queue full, blocked placement, unsupported aim source, missing action target, unsupported collision target는 cooldown을 소비하지 않고 `actionFailed` gameplay event로 관측된다. blocked placement는 현재 enemy prefab의 AABB footprint와 collision tilemap obstacle overlap만 의미하며 circle/capsule/oriented-box/convex exact placement 검증은 아직 포함하지 않는다. projectile/dash/melee도 authored action binding이 실제 실행을 시도했지만 pattern mismatch, missing source transform, missing action target, spawn queue full 같은 실행 전 검증 실패가 발생하면 cooldown을 소비하지 않고 `actionFailed`를 emit한다. 단 spawnPrefab binding이 action id `1`/`2`/`3`을 의도적으로 사용할 때 fixed projectile/dash/melee handler는 false `patternMismatch`를 내지 않고, spawnPrefab executor의 결과만 관측된다. inactive input, missing authored binding, cooling down은 player input path에서는 정상 no-op이라 실패 이벤트를 만들지 않지만, one-shot timer action trigger나 wave/state-enter action trigger에서는 재시도 기회가 없으므로 missing binding/cooling down도 telemetry로 남긴다. 기본 registry는 action id `1`을 Space down 또는 MouseLeft down에, action id `2`를 Enter pressed에 매핑하고 action id `3` 및 spawnPrefab action id는 기본 binding을 두지 않는다. 낮은 빈도 public facade `setInputActionBinding(actionId, bindingIndex, { control, activation })`, `clearInputActionBindings(actionId)`, `resetInputActionBindings()` 또는 Rust/Wasm setter `set_input_action_binding(actionId, bindingIndex, controlCode, activationCode)`, `clear_input_action_bindings(actionId)`, `reset_input_action_bindings()`로 이 매핑을 교체할 수 있다. control code는 Space `1`, Enter `2`, MouseLeft `3`이고 activation code는 Down `1`, Pressed `2`이다. 이 registry는 `InputState` ABI를 넓히지 않으며, 프레임마다 TS callback을 호출하지 않고 Rust frame loop 안에서 fixed-capacity 배열만 조회한다. configurable registry는 deterministic gameplay state이므로 built-in Shooter snapshot version `15`에 함께 저장된다. binding이 없으면 기존 Shooter config 기반 발사 경로를 유지한다. projectile/spawnPrefab spawn은 player input/action phase에서 `World`를 즉시 구조 변경하지 않고, Shooter pending spawn buffer에 적재된 뒤 physics/world integration 전에 flush된다. `prefabSpawned` gameplay event는 flush 성공 후 같은 frame event buffer에 기록된다. projectile success는 별도 gameplay event를 만들지 않고 collision/game-state 결과로 관측한다. melee damage도 input/action phase에서 바로 구조 변경하지 않고 pending command로 큐잉한 뒤 collision/action phase에서 scratch buffer를 재사용해 처리한다. 따라서 bullet/melee/spawnPrefab 모두 structural mutation 지점은 phase boundary로 고정된다. 현재 cooldown remaining state는 `ActionBindingSet` 안에서 tick되므로 같은 entity에 action config를 재적용하면 cooldown이 ready 상태로 재설정된다. 더 넓은 runtime action system으로 승격할 때는 authoring config 재적용과 runtime cooldown state 분리 정책을 다시 확정해야 한다. built-in Shooter snapshot version `15`는 player primary projectile action, dash/melee action binding/cooldown slot, 최대 8개의 player spawnPrefab action binding/cooldown 반복 슬롯과 registered Enemy/Bullet alias prefab id, spawnPrefab projectile payload, Rust input action registry, input action edge state, in-flight bullet collision target/tile impact/source faction metadata, prefab registry canonical payload를 포함한다. queued spawn/action command 자체는 snapshot에 포함하지 않으며 restore 시 pending queue를 비운다. authored non-player movement pattern과 `GameplayTags`는 World snapshot에는 포함되지만 현재 built-in Shooter compact snapshot save scope에는 포함되지 않는다. non-player action binding/timer/wave/state-enter action trigger를 built-in save scope에 넣으려면 snapshot version과 canonical slot 정책을 별도 slice로 올려야 한다. `set_gameplay_behavior_state_machine(...)`은 Rust-owned FSM state component를 설정한다. `add_gameplay_behavior_transition(...)`은 기존 interaction action id 전용 호환 setter이고, `add_gameplay_behavior_event_transition(...)`은 interaction/collisionDamage/collisionDespawn/timer/pickupCollected/tileImpact event kind와 token id를 함께 저장한다. `gameplay_behavior_state(...)`는 현재 state id를 낮은 빈도 query로 반환한다. Shooter runtime은 `CollisionLayer::Pickup` entity가 player와 겹치면 Rust 안에서 score를 올리고 deferred despawn queue를 사용한다. pickup collision pair에 authored `CollisionReaction::Pickup`이 있으면 해당 reaction이 legacy fallback보다 우선한다. target이 live player가 아닌 collector의 반대편 pickup이어야 하며, 잘못된 target은 no-op이지만 fallback을 다시 실행하지 않는다. interaction은 player/source radius overlap을 Rust에서 판정한 뒤 `GameplayEvent` frame buffer로 내보낸다. timer trigger는 fixed timestep에서 consumed simulation seconds만큼, variable timestep에서는 sanitized delta만큼 Rust 안에서 감소하고 elapsed frame에 `timer` event를 한 번 emit한다. Rust FSM runtime은 같은 frame의 `GameplayEvent` buffer를 render frame 끝에서 한 번 읽고, matching source entity에 붙은 FSM을 transition 순서대로 최대 1회 전이한다. 이 경로도 scene load/agent apply 전용 authoring과 Rust frame loop 처리만 사용하며, reaction별 또는 transition별 JS callback을 호출하지 않는다.

`clear_gameplay_faction(...)`, `clear_gameplay_tags(...)`, `clear_gameplay_actions(...)`, `clear_gameplay_timer_trigger(...)`, `clear_gameplay_behavior_state_enter_actions(...)`는 같은 낮은 빈도 authoring 경계에서 faction, tags, action binding config, timer trigger config, state-enter action config를 제거한다.

Raw Wasm에는 `set_gameplay_area_damage_reaction(entity, generation, amount, radius, targetLayerCode)`, `add_gameplay_collision_area_damage(entity, generation, radius, targetLayerCode)`, `add_gameplay_collision_knockback(entity, generation, targetCode, impulse)`, `add_gameplay_collision_spawn_prefab(entity, generation, actionId, prefabId, targetCode, cooldownSeconds, triggerCode, offsetX, offsetY)`, `add_gameplay_collision_emit_effect(entity, generation, effectId, effectType, targetCode, cooldownSeconds, triggerCode)`, `add_gameplay_collision_emit_effect_with_payload(entity, generation, effectId, effectType, targetCode, cooldownSeconds, triggerCode, intensity, radius)`가 추가됐다. public TS facade는 일반적으로 atomic setter를 사용해 damage amount와 area reaction을 함께 설치하고, low-level add setter는 테스트 harness나 직접 component authoring에서 이미 damage component가 있는 entity에 반응만 추가할 때 사용한다.

Player/Enemy 충돌에서 양쪽 모두 authored gameplay collision reaction이 없으면 기존 Shooter fallback처럼 접촉 즉시 `GameOver`가 된다. `Damage`, `Pickup`, `Despawn` 같은 gameplay reaction이 있으면 authored reaction이 fallback보다 우선하며 fallback GameOver는 실행되지 않는다. `PlaySound`/`SpawnParticle`만 있는 side-effect-only reaction은 fallback GameOver를 대체하지 않는다. `Damage` reaction은 source entity의 damage component를 사용해 target health를 차감한다. target이 Player이고 health가 0 이하가 되면 scene은 `GameOver`가 되지만 player entity는 despawn되지 않고 `collisionDamage.targetRemoved`는 `false`다. 명시적 `Despawn` reaction은 lethal `Damage`와 별개인 deferred removal reaction이다. 따라서 `configureDamage({ target: "other" })`를 enemy profile에 적용하면 enemy가 player와 접촉할 때 player health를 데이터 기반으로 깎을 수 있다. cooldown/invulnerability는 아직 지원하지 않으므로 접촉 중인 collision pair마다 frame 단위로 damage가 적용된다.

`AreaDamage` collision reaction은 entity/entity impact에서 source 또는 other transform을 중심으로 Rust circle query를 실행하고, `targetLayer`에 맞는 entity들에게 source damage component의 amount를 적용한다. target별 damage는 기존 `collisionDamage` telemetry와 score/deferred despawn 경로를 재사용하고, faction mask가 거부한 target은 `factionDamageDenied` telemetry만 남긴다. 결과 버퍼는 기존 fixed reaction outcome cap을 유지하므로 한 impact에서 실제 damage outcome은 최대 4개까지 기록된다. 현재 tile impact에서는 `AreaDamage`가 no-op이며, tile contact point 기반 폭발은 별도 detail buffer 또는 impact position ABI 확장 이후 다룬다.

`SpawnPrefab` collision reaction은 entity/entity, pickup collision, tile impact에서 authored slot order에 따라 평가된다. entity/entity에서는 `target: "self"|"other"`가 각각 source 또는 opposite entity transform을 spawn anchor로 쓰고, tile impact에서는 entity target이 없으므로 `target: "self"`만 source transform anchor로 동작한다. spawn command는 즉시 `World`를 변경하지 않고 Shooter pending spawn queue에 적재되며, collision phase가 해당 frame의 spawn flush 뒤에 실행된 경우 실제 entity 생성과 `prefabSpawned` gameplay event는 다음 flush에서 관측된다. 현재 default runtime은 projectile payload 없는 registered Enemy prefab만 지원하고, unsupported prefab 또는 placement/capacity 실패는 `actionFailed` event로 보고한다. `cooldownSeconds`가 있으면 command 생성과 queue가 성공한 뒤에만 source reaction slot의 cooldown을 커밋하므로 실패한 spawn 시도는 재시도 가능 상태를 유지한다. 이 reaction은 additive이며 기본 damage/despawn/pickup/game-over gameplay를 대체하지 않는다.

`PlaySound` collision reaction은 기존 audio event buffer에 `soundId`, `volume`, `pitch`를 추가하고, 같은 frame의 `presentationEffect` gameplay event와 `EffectEvent` detail buffer에도 sound effect payload를 남기는 side effect다. 기본은 additive라 Bullet/Enemy 충돌에서는 authored sound와 built-in hit audio가 모두 나갈 수 있고, side-effect-only sound는 Bullet/Enemy damage/despawn이나 Player/Enemy fallback GameOver를 대체하지 않는다. `replaceDefault: true`를 지정하면 해당 collision path의 built-in default audio만 suppress한다. 현재 적용 범위는 Bullet/Enemy hit audio와 authored Player/Enemy lethal damage가 발생시킨 game-over audio다. Tile impact에는 대체할 built-in audio가 없으므로 `replaceDefault`는 no-op이다. `trigger` 기본값은 `"contact"`이고 접촉 frame마다 side effect를 시도한다. `trigger: "enter"`는 entity/entity pair가 새로 접촉한 frame에만 side effect와 cooldown commit을 허용하며, contact key는 Rust가 entity id/generation pair로 추적한다. Tile impact는 terminal hit이므로 enter trigger도 true로 취급한다. `cooldownSeconds`를 지정하면 source entity의 reaction component 안에서 cooldown state가 tick되어 같은 entity의 반복 접촉 sound만 제한한다. 이는 global audio throttle이나 tile-wide impact throttle이 아니며, 같은 sound id를 다시 configure하면 기존 sound reaction slot을 교체하고 cooldown은 ready 상태로 reset된다. audio event는 deterministic gameplay replay hash 범위가 아니므로, collision sound는 golden replay fixture가 아니라 Rust/TS unit 또는 audio/frame smoke로 검증한다.

`SpawnParticle` collision reaction은 기존 particle preset registry의 numeric `presetId`를 조회해 `target` entity transform 위치에 particle burst를 생성하고, 같은 위치를 `presentationEffect` gameplay event와 `EffectEvent` detail buffer에도 남기는 visual side effect다. preset이 등록되어 있지 않거나 target transform이 없으면 no-op으로 처리한다. 기본은 additive라 Bullet/Enemy 충돌에서는 built-in hit particle과 authored particle이 함께 나갈 수 있고, side-effect-only particle은 Bullet/Enemy damage/despawn이나 Player/Enemy fallback GameOver를 대체하지 않는다. `replaceDefault: true`를 지정하면 Bullet/Enemy built-in hit particle만 suppress한다. Tile impact에는 대체할 built-in particle default가 없으므로 `replaceDefault`는 no-op이다. `trigger` 기본값은 `"contact"`이고 접촉 frame마다 side effect를 시도한다. `trigger: "enter"`는 entity/entity pair가 새로 접촉한 frame에만 burst와 cooldown commit을 허용하며, tile impact는 terminal hit이므로 enter trigger도 true로 취급한다. `cooldownSeconds`를 지정하면 source entity의 reaction component 안에서 cooldown state가 tick되어 같은 entity의 반복 burst만 제한한다. 같은 `presetId + target`을 다시 configure하면 기존 particle reaction slot을 교체하고 cooldown은 ready 상태로 reset된다. particle state/render output은 golden gameplay replay hash 범위가 아니므로, collision particle은 Rust/TS unit 또는 render/frame smoke로 검증한다.

`trigger: "enter"`의 entity/entity contact cache는 Rust `ShooterScene` frame scratch에 bounded sorted set으로 저장된다. 현재 cap을 초과한 authored contact pair는 unbounded allocation을 피하기 위해 enter-only side effect를 보수적으로 실행하지 않으며, `trigger: "contact"` reaction은 기존 frame contact 경로를 그대로 따른다.

Bullet/Tile 충돌은 public `CollisionTarget`에 `"tile"`을 추가하지 않는다. Tile은 현재 entity가 아니므로 `Damage(Tile)`, `Despawn(Tile)`, `SpawnParticle(target: "other")` 같은 entity target reaction은 no-op이다. 대신 `projectileAction.tileImpact`로 blocking tile impact 정책을 선언하며 public 값은 `"despawn"`, `"passThrough"`, `"bounce"`이다. policy code는 `0=despawn`, `1=passThrough`, `2=bounce`이다. 낮은 빈도 authoring/test harness가 이미 존재하는 projectile body의 정책을 바꿔야 할 때는 raw Wasm setter `set_gameplay_projectile_tile_impact(entityId, generation, tileImpactCode)`가 같은 component slot을 설정한다. 이 setter는 generation-checked handle과 valid policy code만 받으며, frame hot path callback surface가 아니다. `"despawn"` projectile이 blocking tile에 닿으면 기존 Shooter 의미처럼 bullet은 deferred despawn된다. authored bullet reaction set이 있으면 `AreaDamage`, `PlaySound`, `SpawnParticle(target: "self")`, `Despawn(target: "self")`를 additive로 실행한다. `AreaDamage`는 swept tile contact point를 중심으로 source damage, target layer, faction gate, health/score/despawn을 기존 entity-impact outcome 경로에 태운다. `Despawn(target: "self")`가 있으면 `collisionDespawn` telemetry가 남고, area damage 또는 sound/particle-only reaction이어도 legacy tile despawn은 유지된다. 이 경로는 bullet/enemy collision보다 먼저 실행되므로 `"despawn"` tile hit가 같은 frame의 enemy damage보다 우선한다. `"passThrough"` projectile은 blocking tile impact를 완전히 건너뛰며 authored tile-side area damage/sound/particle/despawn/cooldown/telemetry도 실행하지 않고 같은 frame의 entity collision phase로 진행한다. `"bounce"` projectile은 tile-side self reaction을 실행한 뒤 명시 self despawn이 없으면 contact normal로 velocity를 반사하고 contact 지점 근처로 transform을 되돌린다. `"despawn"`과 `"bounce"` blocking tile hit는 frame `GameplayEvent`에 `kind: "tileImpact"`로 노출된다. decoded action은 projectile handle, `tileImpact`, `layerIndex`, `tileIndex`, contact normal direction, `bounced`, `identityTruncated`, `targetRemoved`를 제공한다. FSM predicate는 `event: "tileImpact"`와 emitted policy인 `tileImpact: "despawn"|"bounce"` 또는 `tileImpactCode: 0|2`로 projectile-scoped transition을 선언할 수 있다. `passThrough`는 tile impact telemetry를 emit하지 않으므로 FSM predicate token으로 설치할 수 없다. 이 event는 8-u32 gameplay event ABI를 유지하기 위해 world/contact `x/y` position을 포함하지 않으며, payload는 layer 8비트 + tile index 24비트로 packed 된다. layer/tile identity가 이 packed 범위를 넘으면 하위 비트만 payload에 남고 `identityTruncated: true` flag가 켜진다. 정확한 초대형 tile identity나 impact position은 별도 detail buffer 또는 ABI 확장 설계가 필요하다. destructible terrain, bounce count/material policy는 별도 설계 전까지 제외한다.

`GameplayEvent`는 collision lifecycle event와 별도 ABI다. `WasmBridge.readGameplayEventBuffer()`는 `Uint32Array` 기반 buffer view를 반환하고, `decodeGameplayEvents(...)`는 `{ kind, actorId, actorGeneration, sourceId, sourceGeneration, tokenId, flags, payloadBits }` 형태로 decode한다. 현재 `kind: "interaction"`, `"collisionDamage"`, `"collisionDespawn"`, `"behaviorStateChanged"`, `"prefabSpawned"`, `"actionFailed"`, `"timer"`, `"pickupCollected"`, `"tileImpact"`, `"factionDamageDenied"`, `"presentationEffect"`가 지원된다. `interaction`의 `tokenId`는 action id이고 `flags`는 `once`와 `consumedThisFrame` 상태를 담는다. authored collision reaction event에서 `actor`는 영향을 받은 entity, `source`는 reaction을 가진 entity다. `collisionDamage`는 `payloadBits`에 damage `f32` bit pattern을 담고, `collisionDamage`/`collisionDespawn`은 target removal 여부를 `targetRemoved` flag로 노출한다. `behaviorStateChanged`는 Rust-owned FSM transition telemetry이며 `actor`와 `source`가 모두 FSM entity를 가리키고, `payloadBits`는 previous state id, `tokenId`는 next state id다. 이 state id는 runtime install plan 내부의 numeric id이므로 save data나 authoring spec의 source of truth로 쓰지 않는다. `prefabSpawned`는 `actor`가 새로 생성된 entity, `source`가 action owner, `tokenId`가 prefab id, `payloadBits`가 action id다. `actionFailed`는 `actor`와 `source`가 action owner, `tokenId`가 action id, `payloadBits`가 failure reason code다. `timer`는 `actor`와 `source`가 timer owner, `tokenId`가 timer id, `payloadBits`가 configured duration seconds의 `f32` bit pattern이다. `pickupCollected`는 `actor`가 collector/player entity, `source`가 collected pickup entity, `tokenId`가 pickup item id, `payloadBits`가 collected count이며 despawn된 pickup은 `targetRemoved` flag로 표시한다. 이 event에서 `targetRemoved`는 `actor`가 아니라 `source` pickup이 제거됐다는 뜻이다. `tileImpact`는 `actor`/`source`가 projectile entity이고, `tokenId`가 tile impact policy code, `payloadBits`가 layer 8비트 + tile index 24비트 packed identity다. `flags`는 `bounced`, `identityTruncated`, contact normal direction, `targetRemoved`를 담는다. `factionDamageDenied`는 authored `Damage` reaction 또는 기본 projectile/melee damage gate가 source/target faction mask 때문에 damage를 적용하지 않았다는 telemetry이며, `actor`는 target, `source`는 공격 주체, `tokenId`는 source faction id, `payloadBits`는 target faction id다. `presentationEffect`는 `tokenId`가 `effectId`, `payloadBits`가 effect type code이며, `gameplayActionsForEvents(...)`와 `bindPresentationEffectActions(...)`가 registry definition으로 변환한다. 현재 reason code는 unsupported prefab `1`, unsupported anchor `2`, unsupported phase `3`, missing source transform `4`, spawn queue full `5`, pattern mismatch `6`, blocked placement `7`, missing action binding `8`, cooling down `9`, unsupported aim source `10`, missing action target `11`, unsupported collision target `12`다. `FrameState.gameplayEventBuffer`와 `FrameState.gameplayEvents`에서도 같은 데이터를 읽을 수 있다.

`EffectEvent`는 presentation-only side effect의 detail ABI다. `WasmBridge.readEffectEventBuffer()`는 `DataView` 기반 buffer view를 반환하고, `decodeEffectEvents(...)`는 `{ effectId, effectType, effectKind, actorId, actorGeneration, sourceId, sourceGeneration, x, y, intensity, radius }` 형태로 decode한다. event 한 개는 40 bytes이며 u32 entity/effect id와 f32 position/detail 값이 섞여 있으므로 `Float32Array`가 아니라 `DataView`로 읽는다. `FrameState.effectEventBuffer`와 `FrameState.effectEvents`는 기본 포함되며, decode 비용이 필요 없는 consumer는 `CreateEngineOptions.includeEffectEvents = false`로 끌 수 있다. 단, `CreateEngineOptions.effectEvents`를 설정하면 runtime dispatch를 위해 effect buffer는 해당 frame에서 읽고 decode한다. 현재 Rust runtime은 authored collision presentation side effect 위치를 actor transform 우선, source transform fallback으로 기록하고, `collisionEmitEffect.intensity/radius`가 있으면 그 값을 `EffectEvent` payload로 기록한다. 생략 시 기본값은 `1.0`/`0.0`이다. `effectDispatchesForEvents(...)`와 `dispatchEffectEvents(...)`는 이 raw frame event를 registry-aware sound/particle/camera/custom dispatch로 바꾸는 opt-in frame-end helper이며, registry definition의 `intensity/radius`가 있으면 raw event payload보다 우선한다. `createEffectEventDispatchTarget(...)`/`dispatchRuntimeEffectEvents(...)`와 `CreateEngineOptions.effectEvents`는 같은 경로를 브라우저 runtime에 연결한다. runtime hook에서 `assetValidation: "error"`를 켜면 loaded sound id와 registered particle preset id를 dispatch 전에 검사한다. camera/custom handler 누락은 `missingHandler: "error"`로 agent smoke용 diagnostic을 켤 수 있다. 이 buffer와 helper는 audio/particle/camera shake adapter가 frame 끝에서 batch 소비하기 위한 정보이며 gameplay state의 source of truth가 아니다.

Rust-owned timer/wave/state-enter action trigger는 현재 `spawnPrefabAction`, 명시적 `aim: "targetPlayer"` `dashAction`, `aim: "targetPlayer"` + `collisionTarget: "player"` `projectileAction`, 그리고 `target: "player"` 또는 `target: "enemies"` `meleeAction`을 실행할 수 있다. Triggered projectile은 source transform에서 live player transform으로 향하는 bullet을 pre-physics spawn queue에 적재하고, bullet의 collision target metadata를 `player`로 저장한다. 이 bullet은 enemy/score path를 타지 않고 `Bullet -> Player` 충돌에서 game-over를 만들며, in-flight bullet target metadata는 built-in Shooter snapshot/replay에 포함된다. `targetPlayer/enemies` 같은 미지원 projectile 조합은 cooldown을 소비하지 않고 `actionFailed(unsupportedCollisionTarget)`로 실패한다. Triggered `dashAction`은 source transform에서 live player transform으로 향하는 normalized direction을 계산해 source transform을 pre-physics phase에서 이동시킨다. `aim: "input"` dash는 player input runtime 전용이므로 Rust-owned trigger에서 실행하면 cooldown을 소비하지 않고 `actionFailed(unsupportedAimSource)`를 낸다. live player가 없거나 source와 player가 같거나 zero-length target이면 `actionFailed(missingActionTarget)`로 실패한다. Triggered `meleeAction`은 source transform을 검증한 뒤 pending melee command를 큐잉한다. `target: "player"`는 live player target을 추가로 요구하고, player가 range 안에 있으면 combat phase에서 game-over가 되며 score/despawn/success gameplay event는 발생하지 않는다. `target: "enemies"`는 live player target 없이 source 중심 enemy query를 실행하고 attacker 자신은 제외한다. enemy hit는 기존 melee damage/score/despawn/presentation/`collisionDamage` 경로를 사용한다. 두 target 모두 whiff도 유효한 melee 실행이므로 cooldown을 소비한다. projectile/dash/melee 성공 경로는 별도 success gameplay event를 만들지 않는다. 기존 hidden fallback(source velocity -> player -> `+X`)은 제거됐으므로 non-player triggered dash를 쓰던 spec은 `dashAction`에 `aim: "targetPlayer"`를 추가하거나 Rust/Wasm에서 `set_gameplay_action_dash_with_aim(..., 1)`로 마이그레이션해야 한다.

`gameplayEventActionMetadataForCommands(...)`, `gameplayActionsForEvents(...)`, `applyGameplayEventActions(...)`는 이 decoded event를 게임별 reaction adapter가 받기 쉬운 `GameplayEventAction`으로 바꾸는 TS-side frame-end helper다. `interaction`은 prompt/UI/quest/cutscene adapter용 action metadata를 붙일 수 있고, collision reaction event는 Rust에서 이미 적용한 damage/despawn 결과를 telemetry, UI feedback, quest trigger adapter가 읽기 쉬운 `collisionDamage`/`collisionDespawn` action으로 변환한다. `behaviorStateChanged`는 `previousStateId`/`nextStateId`를 가진 telemetry action으로 변환되어 debug overlay, quest 조건, agent smoke summary가 FSM transition을 관측할 수 있게 한다. `prefabSpawned`는 `prefabId`/`actionId`와 actor/source handle을 가진 telemetry action으로 변환되어 agent smoke, debug overlay, quest trigger adapter가 spawn 결과를 관측할 수 있게 한다. `actionFailed`는 `actionId`, `reasonCode`, `reason` 문자열과 actor/source handle을 가진 telemetry action으로 변환된다. `gameplayActionDiagnosticReports(...)`는 `FrameState.actionDiagnostics`의 per-reason bucket, dropped failure event count, commit skip count, 그리고 decoded `actionFailed` action을 합쳐 machine-actionable report를 만든다. `gameplaySpawnDiagnosticReports(...)`는 `FrameState.spawnDiagnostics`의 spawn flush count를 activity report 또는 expected count mismatch report로 바꾼다. 두 report helper 모두 `path`, `expected`, `actual`, `suggestion`을 포함하므로 agent가 spec patch를 제안할 때 바로 사용할 수 있다. 이 helper들은 프레임 종료 후 관측 데이터를 요약할 뿐이며 Rust simulation을 되돌려 호출하는 callback surface가 아니다. `timer`는 `timerId`, `durationSeconds`, actor/source handle을 가진 trigger action으로 변환되며 FSM predicate와 replay에서 runtime timer token으로 쓸 수 있다. `pickupCollected`는 `itemId`, `count`, `targetRemoved`, actor/source handle을 가진 telemetry action으로 변환되어 score/inventory UI, quest trigger adapter, agent smoke가 pickup 수집 결과를 관측할 수 있고, collector/actor-scoped FSM predicate와 replay에서 runtime item token으로 쓸 수 있다. `tileImpact`는 tile impact policy/code, layer/tile index, normal, bounced/identityTruncated/targetRemoved, projectile actor/source handle을 가진 telemetry action으로 변환되며 projectile-scoped FSM predicate와 replay에서 runtime tile impact token으로 쓸 수 있다. `factionDamageDenied`는 actor/source handle과 `sourceFactionId`/`targetFactionId`를 가진 telemetry action으로 변환되어 agent smoke/debug/diagnostic adapter가 damage mask mismatch를 관측할 수 있게 한다. `actionFailed`와 `factionDamageDenied`는 현재 FSM predicate vocabulary로 자동 포함하지 않고, agent smoke/debug/diagnostic/quest adapter가 실패 또는 deny 결과를 관측하는 용도다. `gameplayEventActionMetadataForCommands(...)`는 binding plan의 `configureInteraction` command에서 action id/name/prompt registry를 파생하므로, `prompt` 같은 authoring metadata가 Rust simulation storage에 들어가지 않아도 frame-end UI adapter까지 전달된다. 같은 runtime action id가 서로 다른 action/prompt metadata를 가리키면 diagnostic으로 실패한다.

`actionNames` map을 넘기면 runtime action id를 사람이 읽는 action name으로 복원할 수 있고, `requireActionNames`가 켜진 상태에서 누락되면 JSON path가 포함된 diagnostic으로 실패한다. 알 수 없는 event kind는 기본적으로 error이며, forward-compatibility가 필요한 adapter만 `unknownEvent: "ignore"`를 명시한다.

주의: 이 helper는 Rust simulation을 되돌려 호출하는 callback runtime이 아니다. interaction radius 판정, authored collision reaction 적용, event emission은 Rust frame loop가 끝낸 뒤 bulk buffer로 전달되고, TS adapter는 frame 끝에서 prompt 표시, quest 진행, cutscene 시작, inventory 반영, telemetry 표시 같은 장르별 side effect만 수행한다.

`BehaviorStateMachineDocumentSpec`는 의사결정/시퀀싱을 flat enum 조합으로 계속 늘리지 않기 위한 최소 FSM 데이터 계약이다. 각 state는 기존 behavior profile id를 참조하고, transition은 `GameplayEventAction` vocabulary에 맞춰 `gameplayEvent` predicate를 사용한다. `interaction` predicate는 `actionId` 또는 authoring metadata용 `action`을 요구하며, deterministic replay/runtime install에는 inline `actionId` 또는 `ids.actions[action]`으로 해석되는 runtime token이 필요하다. `timer` predicate는 `timerId` 또는 `ids.timers[timer]`으로 해석되는 runtime token이 필요하다. `pickupCollected` predicate는 `itemId` 또는 `ids.items[item]`으로 해석되는 runtime token이 필요하며, replay/runtime은 collector인 event `actor`가 대상 FSM entity와 일치할 때만 전이한다. `tileImpact` predicate는 실제 event를 emit하는 `tileImpact: "despawn"|"bounce"` 또는 `tileImpactCode: 0|2`를 요구하며, replay/runtime은 projectile인 event `source` entity id/generation이 대상 FSM entity와 일치할 때만 전이한다. `passThrough` projectile은 telemetry를 emit하지 않으므로 FSM predicate에서 거부한다. `tileImpact`와 `tileImpactCode`를 함께 쓰는 경우 둘은 같은 policy를 가리켜야 한다. `collisionDamage`와 `collisionDespawn` predicate는 action id 없이 event kind 자체를 key로 삼고, replay/runtime은 event `source` entity id/generation이 대상 FSM entity와 일치할 때만 전이한다.

```ts
const machines = resolveBehaviorStateMachineDocument({
  machines: {
    enemyAi: {
      initial: "idle",
      states: {
        idle: {
          behaviorRecipes: "enemy.idle",
          transitions: [{
            to: "chasing",
            when: { type: "gameplayEvent", event: "interaction", action: "wake", actionId: 4 },
          }],
        },
        chasing: {
          behaviorRecipes: ["enemy.chase"],
        },
      },
    },
  },
}, {
  behaviorRecipes: recipes,
});

const commands = behaviorStateMachineCommandsForState(machines, recipes, "enemyAi", "chasing");

const fsmInstall = installBehaviorStateMachineRuntime(engine, machines, "enemyAi", {
  entityId: 12,
  entityGeneration: 3,
});

const currentStatePlan = createBehaviorStateMachineCurrentStateCommandPlan(
  engine,
  machines,
  recipes,
  fsmInstall.plan,
  { entityId: 12, entityGeneration: 3 },
  { entity: "runner-1", kinds: ["chase"] },
);
```

`runBehaviorStateMachineReplay(...)`는 production runtime이 아니라 agent validation용 transition dry-run이다. input은 `machine`, 대상 `entity` handle, strictly increasing `frames`를 요구한다. raw FSM document를 replay할 때는 `behaviorRecipes` option을 요구해 profile reference를 검증한다. replay는 Rust runtime과 동일하게 대부분의 frame event에서 `source` entity id/generation이 input `entity`와 일치하는 event만 transition 후보로 보며, `pickupCollected`만 collector `actor`를 subject로 삼는다. `interaction` replay predicate는 canonical `actionId` 또는 `ids.actions[action]`으로 해석 가능한 action name을 가져야 하며, `action` 문자열은 사람이 읽는 metadata와 registry key로 유지한다. `timer` replay predicate는 canonical `timerId` 또는 `ids.timers[timer]`으로 해석 가능한 timer name을 가져야 한다. `pickupCollected` replay predicate는 canonical `itemId` 또는 `ids.items[item]`으로 해석 가능한 item name을 가져야 한다. `tileImpact` replay predicate는 emitted tile impact policy/code `0(despawn)` 또는 `2(bounce)`를 canonical key로 삼는다. unknown tile impact telemetry는 replay input으로 관측될 수 있지만 어떤 predicate와도 match되지 않는다. `collisionDamage`/`collisionDespawn` replay predicate는 event kind 자체를 canonical key로 삼고 action id를 받지 않는다. transition 평가는 state의 transition 배열 순서를 우선하며 frame당 최대 1개 transition만 발생한다. replay hash에는 대상 entity handle, matched event의 actor/source entity id와 generation, collision damage/targetRemoved, timer id/duration, pickup item/count, tile impact policy/code와 tile identity/normal/flags metadata가 포함되어 stale handle과 event outcome 변화도 diff에 잡힌다.

`createBehaviorStateMachineRuntimeInstallPlan(...)`은 state id를 문자열 코드 단위 정렬 순서의 positive integer로 고정하고, runtime transition에는 event kind code와 token id를 넣는다. interaction token id는 positive `actionId` 또는 `ids.actions[action]`, timer token id는 positive `timerId` 또는 `ids.timers[timer]`, pickupCollected token id는 positive `itemId` 또는 `ids.items[item]`, tileImpact token id는 `0(despawn)` 또는 `2(bounce)`이며, collisionDamage/collisionDespawn token id는 `0`이다. 생성된 numeric state id는 install plan 내부 계약이다. save data나 authoring spec에는 생성된 숫자가 아니라 state 문자열을 유지해야 하며, state 추가/이름 변경 시 numeric id는 달라질 수 있다. 설치 helper는 scene load 또는 agent apply 같은 낮은 빈도 경로에서만 쓰며, 먼저 기존 FSM component를 clear한 뒤 initial state와 bounded transition set을 Rust setter로 넣는다. transition 적용 중 실패하면 다시 clear해 partial FSM component를 남기지 않는다. 이전 FSM을 복원하는 transaction API는 아니다.

`createBehaviorStateMachineStateCommandPlan(...)`과 `createBehaviorStateMachineCurrentStateCommandPlan(...)`은 state-enter callback runtime이 아니다. agent apply, scene load, save/load 복원 같은 낮은 빈도 경로에서 현재 numeric state id를 실제 install에 사용한 `BehaviorStateMachineRuntimeInstallPlan`으로 해석하고, 해당 state의 `behaviorRecipes`를 `BehaviorRecipeCommand[]`로 펼친다. `applyBehaviorStateMachineStateCommands(...)`도 production frame loop에서 state transition마다 호출하는 executor가 아니라 명시적 authoring/apply command다. 자동 state-enter 동작은 현재 Rust-owned `add_gameplay_behavior_state_enter_action(...)` action trigger만 지원하며, behavior profile component swap은 수동 helper 경계에 머문다. `stateId === 0`은 stale entity 또는 FSM 미설치 상태로 보고 initial state로 fallback하지 않는다. `preflightBehaviorStateMachineStateCommands(...)`는 이 plan을 실제 runtime entity로 retarget한 뒤 command validation과 id lookup을 mutation 없이 실행한다. preflight는 실제 runtime이 제공하는 optional setter/add method capability를 반영하므로, 지원하지 않는 command는 apply 전에 machine-actionable diagnostic으로 실패한다. `"replaceSupported"` mode에서는 clear를 호출하지 않고 runtime이 필요한 clear method를 제공하는지와 clear 대상 이름 목록만 반환한다. `applyBehaviorStateMachineStateCommands(...)`의 기본 적용 mode는 `"overlay"`다. overlay는 새 state command에 있는 component만 덮어쓰며, 새 state에 없는 이전 movement/damage/faction/interaction/action/timer component를 자동 clear하지 않는다. `"replaceSupported"` mode를 명시하면 같은 preflight를 먼저 통과한 경우 현재 지원하는 gameplay component subset인 health, damage/collision reaction, optional faction, lifetime, score reward, pickup, interaction, timer trigger, movement, action binding을 clear한 뒤 state command를 적용한다.

`"replaceSupported"`는 완전한 state profile을 entity에 재적용하는 낮은 빈도 도구다. `kinds`로 만든 부분 plan과 함께 쓰면 plan에 없는 지원 component도 지워질 수 있으므로, agent는 먼저 dry-run/diagnostic을 통과한 완전한 state command plan에만 사용해야 한다. command validation, runtime id lookup, target entity handle lookup 실패는 clear 전에 machine-actionable diagnostic으로 반환한다. `FerrumEngine`처럼 runtime engine이 `gameplay_entity_exists(...)`를 제공하면 stale gameplay handle도 clear 전에 diagnostic으로 실패한다. `FerrumEngine` runtime은 clear 직전에 Rust-owned supported component slot snapshot을 잡고, clear 또는 actual runtime setter가 실패하면 health, damage, lifetime, score reward, faction, pickup, interaction, timer trigger, movement, action binding, collision reaction slot을 이전 live value로 restore한다. 이 restore는 action/collision cooldown, timer fired/remaining, interaction consumed 같은 component 내부 runtime field를 그대로 되살린다. 다만 full engine transaction은 아니다. setter/clear 중 비워진 transient event buffer, physics history, spawn queue, audio/particle/tween side effect, 지원 subset 밖의 게임별 inventory/UI/quest state는 이 helper가 복원하지 않는다. hook 세 개(`capture_gameplay_authoring_snapshot`, `restore_gameplay_authoring_snapshot`, `clear_gameplay_authoring_snapshot`)를 모두 제공하지 않는 custom runtime은 기존 non-transactional clear/apply semantics를 유지한다. 또한 timer trigger, action, movement, collision reaction clear를 위해 runtime engine이 `clear_gameplay_timer_trigger(...)`, `clear_gameplay_actions(...)`, `clear_gameplay_movement(...)`, `clear_gameplay_collision_reactions(...)`를 제공해야 하며, 없으면 machine-actionable diagnostic을 반환한다. faction clear는 compatibility를 위해 optional이다. runtime engine이 `clear_gameplay_faction(...)`을 제공하면 replaceSupported clear subset에 포함하고, 제공하지 않으면 기존 faction component를 보존한다. timer policy도 이 mode에 묶여 있다. overlay mode는 기존 timer component를 유지하고, replaceSupported mode는 기존 one-shot timer를 먼저 clear한 뒤 state profile에 `timerTrigger`가 있으면 새 timer를 설치한다. timer id가 `ids.timers`로 해석되지 않으면 clear 전에 실패하므로, 잘못된 state apply가 기존 timer를 지우지 않는다. 지원 subset 밖의 게임별 side effect, inventory, UI, quest state는 이 helper가 clear하지 않는다.

주의: TS FSM API는 production transition executor가 아니라 authoring/dry-run/설치/저빈도 state command planning 도구다. 실제 transition 실행은 Rust numeric state/action id 기반 entity-scoped FSM state component와 frame-end gameplay system이 담당한다. 목적은 agent가 JSON으로 state, behavior profile, event transition reference를 검증 가능한 형태로 작성하고, Rust transition semantics와 같은 순서/1-frame-1-transition 계약을 미리 확인하게 하는 것이다. state-enter에서 behavior profile을 자동으로 clear/apply해야 한다면, 먼저 Rust-owned compiled component profile format과 deterministic failure policy를 설계해야 하며, TS `BehaviorRecipeCommand[]` helper를 frame loop에 연결하지 않는다. full gameplay golden replay 비교는 `GameStateSnapshot` 기반 `createGameplayReplayRun(...)` / `compareGameplayReplayRuns(...)` helper로 분리되어 있다.

### UI/HUD Toolkit API

UI/HUD toolkit은 DOM `UiOverlay` 위에서 체력바, 점수 카운터, 프롬프트, 메시지 같은 반복 HUD 요소를 `UiOverlayState`로 만드는 helper다. `UiOverlay`는 meter line을 `role="progressbar"`로 렌더링하고 panel/action의 기본 ARIA label을 채우며, theme token을 받아 HUD 색상과 radius/font를 조정한다.

| 타입/API | 역할 |
| --- | --- |
| `HUD_THEME_PRESETS` | built-in `dark`, `light`, `high-contrast` theme token |
| `resolveHudTheme(...)` | preset/custom theme token을 resolved token으로 변환한다. |
| `createHudOverlayState(...)` | meter/counter/prompt/message component를 `UiOverlayState` panel로 변환한다. |
| `HudComponentSpec` | HUD component preset union |
| `UiMeter`, `UiTextLine.meter` | `UiOverlay` progressbar line 입력 |

예시:

```ts
const uiState = createHudOverlayState([
  { type: "meter", id: "health", label: "HP", value: 3, max: 6 },
  { type: "counter", id: "score", label: "Score", value: 120 },
  { type: "prompt", id: "start", text: "Press Start", action: { id: "start", label: "Start" } },
], {
  panelId: "game-hud",
  title: "HUD",
  region: "top-right",
});

await createFerrumRuntime({
  canvas,
  ui: { theme: "high-contrast" },
  uiState: () => uiState,
});
```

주의: 현재 UI toolkit은 DOM overlay preset이다. Canvas text renderer, focus trap, animated menu transition, complex layout manager는 별도 UI adapter 범위에서 확장한다.

### Localization & Text API

Localization/text helper는 string table JSON, locale fallback, 텍스트 줄바꿈, font preload 정책을 public platform API로 제공한다. 게임 로직 상태는 소유하지 않고, UI/HUD/dialogue adapter가 낮은 빈도로 호출하는 데이터 변환 계층이다.

| 타입/API | 역할 |
| --- | --- |
| `resolveLocalizationDocument(...)` | `defaultLocale`, `fallbackLocale`, locale별 string table을 검증하고 resolved document로 변환한다. |
| `LocalizationBundle` | active locale을 관리하고 `t(...)`, `localize(...)`, `layout(...)`로 fallback locale chain과 placeholder interpolation을 적용한다. |
| `localizationLocaleChain(...)` | `ko-KR -> ko -> fallback -> default` 같은 lookup 순서를 계산한다. |
| `layoutLocalizedText(...)` | 최대 글자 수/줄 수와 ellipsis 정책에 맞춰 UI용 text line 배열을 만든다. |
| `resolveFontLoadingPolicy(...)` | web font/bitmap font policy를 CSS font-family, `@font-face`, preload URL 목록으로 변환한다. |
| `loadFontLoadingPolicy(...)` | browser `document.fonts` 같은 `FontFaceSet` 호환 객체에 preload web font load expression을 전달한다. |

주의: 현재 text layout은 DOM/HUD/dialogue용 줄바꿈 helper다. Canvas glyph atlas renderer, kerning/shaping, rich text markup, bitmap font draw command 생성은 별도 text renderer 설계가 필요하다.

### Dialogue & Quest API

Dialogue/quest helper는 튜토리얼, NPC 대화, 선택지, 간단한 quest 진행 상태를 JSON-friendly 데이터로 표현한다. Runtime adapter는 `UiOverlayState`로 현재 노드를 표시할 수 있고, save/load는 dialogue session과 quest log snapshot을 함께 캡처한다.

| 타입/API | 역할 |
| --- | --- |
| `resolveDialogueGraph(...)` | `initialNode`, node text/speaker, choice target, flag 조건, quest update를 검증한다. |
| `DialogueSession` | 현재 node, flag set, 선택지 진행, node/choice quest update 적용을 관리한다. |
| `resolveQuestDocument(...)`, `QuestLog` | quest/stage/objective 정의를 검증하고 active/completed/objective progress를 관리한다. |
| `dialogueNodeToUiOverlayState(...)` | 현재 dialogue node와 available choice를 `UiOverlay` dialog/action state로 변환한다. |
| `captureDialogueQuestState(...)`, `restoreDialogueQuestState(...)` | dialogue node/flag와 quest progress를 versioned JSON snapshot으로 캡처/복원한다. |

주의: 현재 조건 처리는 flag set 기반이다. Yarn/Ink parser, script expression language, localized branching copy, cinematic sequence 연결은 별도 narrative tooling 범위에서 확장한다.

### Lighting API

현재 lighting API는 Rust render command ABI를 바꾸지 않는 platform pass다. 좌표는 sprite render command와 같은 screen-space pixel 좌표로 해석한다.

| 타입/API | 역할 |
| --- | --- |
| `LightingScene2D` | `ambient`, `pointLights`, `tileOccluders`, `shadows`, `debug` 설정을 담는 JSON-friendly scene |
| `PointLight2D` | `x`, `y`, `radius`, optional `color`, `intensity`, `falloff`를 담는 radial light |
| `TileOccluder2D` | debug 표시와 shadow casting 입력으로 쓸 직사각형 occluder |
| `Hd2dTileOccluderDefinition`, `Hd2dTileOccluderGridInput` | tile id별 `blocksVision`/`occluderHeight` metadata를 lighting occluder로 변환하기 위한 입력 타입 |
| `LightingShadowOptions` | tile occluder shadow projection의 색상, 투영 길이, 최대 적용 거리를 설정한다. |
| `ShadowClipRect`, `ShadowProjectionOptions` | renderer가 screen-space shadow polygon을 viewport 안으로 자를 때 쓰는 projection 옵션 타입이다. |
| `normalizeLightingScene(...)` | lighting scene의 color/radius/falloff/occluder 값을 검증하고 기본값을 채운다. |
| `deriveTileOccludersFromTilemapGrid(...)` | row-major tile id grid에서 연속된 solid rectangular run을 `TileOccluder2D[]`로 변환한다. |
| `deriveHd2dTileOccludersFromTilemapGrid(...)` | row-major tile id grid에서 `blocksVision` tile만 occluder로 묶고 `occluderHeight`를 rect 높이에 반영한다. |

예시:

```ts
const lighting: LightingScene2D = {
  ambient: [0, 0, 0, 0.45],
  pointLights: [{ x: 240, y: 160, radius: 140, color: [1, 0.9, 0.65], intensity: 1.2 }],
  tileOccluders: deriveTileOccludersFromTilemapGrid({
    width: 4,
    height: 2,
    tileSize: 32,
    data: [0, 1, 1, 0, 2, 2, 0, 0],
  }),
  shadows: { enabled: true, projectionLength: 420 },
  debug: { tileOccluders: true },
};

await createFerrumRuntime({ canvas, lighting });
```

주의: 이번 범위의 shadow는 screen-space 직사각형 tile occluder를 point light 반대 방향으로 투영하고 viewport로 clipping한 뒤 point light 반경으로 alpha를 자르는 pass다. 복잡한 penumbra, normal map, material 기반 light response는 Material & Shader Presets 또는 별도 lighting 품질 작업에서 다룬다.

## Runtime Diagnostics & Profiler API

`RuntimeProfiler`는 기존 frame/debug/renderer metric을 낮은 빈도 tooling과 smoke에서 사용하기 위한 sample buffer다. Rust simulation 상태를 복제하지 않고 `DebugOverlayMetrics`와 `AssetLoadProgress`를 기록한다.

| 타입/API | 역할 |
| --- | --- |
| `RuntimeProfiler` | frame sample과 asset progress sample을 bounded window로 보관하고 aggregate snapshot을 만든다. |
| `RuntimeProfilerOptions` | `budget`, `maxFrameSamples`, `maxAssetSamples`를 지정한다. |
| `RuntimeDiagnosticsBudget` | frame/render/Rust update/draw call/render command/texture switch/physics/asset load elapsed limit를 지정한다. |
| `RuntimeProfilerSnapshot` | 평균/최대 frame time, Rust update, render time, draw call, texture switch, physics count, asset load elapsed를 요약한다. |
| `runtimeDiagnosticsFrameSample(...)` | `DebugOverlayMetrics`를 budget 검사용 numeric sample로 정규화한다. |
| `evaluateRuntimeDiagnosticsSample(...)` | 단일 frame sample이 budget을 넘는지 검사한다. |
| `evaluateRuntimeProfilerBudget(...)` | profiler aggregate snapshot 기준으로 budget 위반 목록을 만든다. |

`AssetLoadProgress.elapsedMs`는 manifest load 시작 이후 경과 시간이다. `RuntimeProfiler.recordAssetProgress(progress)`로 asset load budget smoke에 같은 값을 사용할 수 있다.

## Game Spec API

Top-down Shooter Game Spec의 상세 필드와 예시는 [Top-down Shooter Game Spec](../examples/topdown-shooter/game-spec.md)에 둔다. Public API 문서에서는 코드 계약만 요약한다.

- `ShooterGameSpec`: 사용자 입력 JSON 구조
- `ResolvedShooterGameSpec`: 기본값과 검증이 적용된 구조
- `ShooterGameSpecTarget`: Game Spec을 적용받는 target method 계약
- `ShooterPrefabSpec`, `ShooterPrefabColliderSpec`: prefab 크기, animation, collider metadata
- `ShooterTilemapSpec`, `ShooterTileSpec`, `ShooterTileKind`, `ShooterTileRampSpec`, `ShooterTileSlopeSpec`, `ShooterTileBridgePortalSpec`: tilemap, one-way, slope, bridge portal, HD-2D tile metadata
- `ShooterProjectileArcSpec`: Top-down bullet height span을 시간에 따라 갱신하는 projectile arc 설정
- `ShooterWaveSpec`, `ShooterEnemyPresetSpec`, `ShooterCameraSpec`, `ShooterAudioSpec`: shooter gameplay 설정
- `ShooterGameSpec.physics`: 범용 [Physics Spec](physics-spec.md) namespace. 계약/검증, runtime mode 병합, `createPhysicsWorldFromSpec(...)` 기반 generic body/joint apply에 사용한다.

Game Spec 검증의 코드 기준은 `packages/ferrum-web/src/gameSpec.ts`이며, JSON Schema는 AI agent와 tooling의 구조 검토를 돕는 보조 기준이다.

Runtime tilemap 변경은 shooter scene의 기존 tilemap occupancy를 수정하는 낮은 빈도 API다. `FerrumEngine.setShooterTilemapTile(...)`은 단일 cell을, `FerrumEngine.setShooterTilemapTilesRect(...)`는 폭발/드릴 같은 직사각형 cell 묶음을 바꾼다. `FerrumEngine.setShooterTileHeightSpan(...)` / `clearShooterTileHeightSpan(...)`은 tile definition의 HD-2D floor/elevation/height metadata를 바꾸며, collision cache는 height span이 다른 solid run을 병합하지 않는다. `FerrumEngine.setShooterTileHd2dMetadata(...)` / `clearShooterTileHd2dMetadata(...)`는 tile `kind`, `ramp`, `blocksMovement`, projectile/vision/occluder metadata를 바꾼다. `FerrumEngine.setShooterTileBridgePortal(...)` / `clearShooterTileBridgePortal(...)`은 bridge tile의 lower/upper floor edge와 navigation cost를 바꾼다. `blocksMovement: false`이면 양수 collision layer tile도 이동 obstacle, navigation obstacle, boundary extraction source에서 제외된다. `kind`와 `ramp`는 `moveHd2dKinematicBodyWithTilemap(...)`의 step/ramp/ledge/bridge-under 이동에도 사용된다. Rect edit의 `maxCollisionRebuildChunks` 옵션은 변경 범위가 지정한 dirty collision chunk budget을 넘으면 적용하지 않아 dynamic obstacle edit을 여러 frame으로 나눌 수 있게 한다. `FerrumEngine.setShooterTilemapNavigationCost(...)`는 collision layer의 walkable cell 비용을 설정하며 `0`은 기본 비용으로 되돌린다. `FerrumEngine.queryTilemapNavigationWaypoint(...)`는 같은 collision tilemap에서 Rust A* waypoint를 낮은 빈도 gameplay query로 반환하고, `FerrumEngine.queryTilemapNavigationPath(...)`는 전체 waypoint `Float32Array` buffer, decoded point 배열, debug line buffer를 반환한다. 두 navigation query는 optional `heightSpan`을 받을 수 있고, 지정한 height span과 겹치는 solid tile만 장애물로 취급한다. `toHeightSpan`을 함께 지정하면 bridge portal lower/upper floor edge를 포함한 multi-floor path를 반환하며 path point는 `x`, `y`, `heightSpan`을 포함한다. Collision layer 변경은 Rust tile obstacle cache를 dirty chunk 단위로 갱신하고 render command는 같은 tile occupancy에서 다시 생성된다. `weapons.projectileArc`가 켜진 built-in bullet은 height span을 갱신하고, bullet/tile 충돌은 `blocksProjectile`과 height overlap을 함께 검사한다. `extractTilemapBoundaryChains(...)`는 resolved tilemap collision layer를 generic Physics Spec chain body로 변환하며 HD-2D tile metadata가 있는 solid tile은 height span별로 body를 분리한다. `PixelMaskTerrain`은 alpha mask 편집과 dirty patch 조회, collision-only tilemap/chain boundary 변환을 제공한다. `createPixelMaskTerrainRuntime(...)`은 이 terrain을 WebGL2 texture upload와 Physics Spec chunk world 교체에 연결하며, `maxDirtyChunksPerSync`로 한 번에 rebuild할 chunk 수를 제한한다.

## Physics Spec API

범용 physics authoring 계약은 [Physics Spec](physics-spec.md)에 둔다.

| 타입/API | 역할 |
| --- | --- |
| `PhysicsMode` | `"none"`, `"arcade"`, `"rigid"` mode 계약 |
| `PhysicsSpec` | Game Spec `physics` namespace 입력 구조 |
| `ResolvedPhysicsSpec` | 기본값, layer bit mask, 참조 검증이 적용된 구조 |
| `resolvePhysicsSpec(...)` | `PhysicsSpec`을 검증하고 resolved 구조를 반환 |
| `createPhysicsWorldFromSpec(...)` | raw/resolved Physics Spec을 `FerrumEngine` generic rigid body world에 적용 |
| `applyPhysicsSceneProfile(...)` | Physics Spec world를 opt-in scene profile로 적용하고 `runtime` profile에서 자동 rigid-body step을 연결 |
| `PhysicsSceneProfileSpec` | `profile: "manual" | "runtime"`, `physics`, `autoStep`을 담는 JSON-friendly scene integration 입력 |
| `PhysicsSceneProfileApplyResult` | 적용된 world, auto-step 여부, body/joint count, step option, clear callback |
| `PhysicsWorldApplyResult` | body/joint handle mapping, summary, warning, step option, clear callback |
| `PhysicsWorldSnapshot` | versioned JSON snapshot. Physics Spec 기반 world의 body/joint runtime state와 replay hash를 담는다. |
| `PhysicsBodyStateBufferSnapshot` | body state를 `Float32Array`/`Uint32Array`로 묶은 Wasm bulk restore buffer |
| `createPhysicsBodyStateBufferSnapshot(...)` | JSON body snapshot 배열을 `PhysicsBodyStateBufferSnapshot`으로 인코딩 |
| `capturePhysicsWorldSnapshot(...)` | `PhysicsWorldApplyResult`의 body/joint handle을 조회해 snapshot을 만든다. |
| `restorePhysicsWorldSnapshot(...)` | snapshot의 `ResolvedPhysicsSpec`을 다시 적용하고 body/joint state를 복원한다. |
| `verifyPhysicsReplayRollback(...)` | snapshot restore 후 같은 frame 수를 재시뮬레이션해 hash를 비교한다. |
| `PhysicsReplayInputStream` | frame, seed, fixed step, snapshot interval, body event를 담는 replay input stream |
| `runPhysicsReplayInputStream(...)` | replay input stream을 실행하고 interval snapshot과 replay hash를 반환한다. |
| `verifyPhysicsReplayInputStreamRollback(...)` | 같은 input stream을 snapshot restore 이후 다시 실행해 hash를 비교한다. |
| `PhysicsAuthoringDocument` | runtime `physics`와 AI/tooling metadata `physicsEditor`를 분리한 authoring document |
| `compilePhysicsAuthoringDocument(...)` | authoring document에서 `physicsEditor` metadata를 제거해 runtime `PhysicsSpec`을 반환 |
| `createRigidBody(...)` | helper options를 `spawnRigidBody(...)` 호출로 정규화 |
| `createCollider(...)` | `box`/`aabb` alias와 shape option을 runtime collider 구조로 정규화 |
| `createJoint(...)` | `world` anchor, limit/motor option을 `spawnPhysicsJoint(...)` 호출로 정규화 |
| `createVehicleRig(...)` | 기존 `spring`/`prismatic` joint를 조합해 chassis, wheel body, suspension guide/spring joint를 생성 |
| `extractTilemapBoundaryChains(...)` | resolved Shooter tilemap collision layer를 static `chain` collider body map으로 변환 |
| `PixelMaskTerrain`, `createPixelMaskTerrain(...)` | alpha mask edit, dirty patch, collision-only tilemap layer 변환을 제공 |
| `extractPixelMaskBoundaryChains(...)` | pixel mask terrain을 Physics Spec static `chain` collider body map으로 변환 |
| `createPixelMaskTerrainRuntime(...)` | pixel mask terrain의 texture upload, dirty patch upload, chunk collider world ownership/rebuild를 조율 |
| `physicsMaterial(...)`, `PHYSICS_MATERIAL_PRESETS` | built-in material preset과 override helper |
| `createPhysicsLayerMap(...)`, `createPhysicsLayerSpec(...)`, `physicsLayerMaskBits(...)` | named layer pattern에서 category/mask bit 계산 |
| `PhysicsDebugOptions` | broadphase/contact/collider/joint/sleeping/layer/CCD debug category 옵션. `ccd`는 hit marker와 normal line을 physics debug line buffer에 추가한다. |
| `CreateEngineOptions.physicsMode` | Game Spec보다 우선하는 engine-level physics mode override |
| `CreateEngineOptions.includeCollisionEvents` | Rust collision lifecycle tracking과 `FrameState.collisionEvents` decode를 opt-in으로 켠다. 기본값은 `false`이며, 꺼져 있으면 per-frame collision lifecycle pair tracking을 실행하지 않고 debug/profiler의 collision pair/event metric도 생략한다. 고정 timestep에서는 substep마다 lifecycle tracking이 실행되므로 collision event가 필요 없는 production 경로에서는 끈다. |
| `CreateEngineOptions.includeEffectEvents` | `FrameState.effectEventBuffer`와 decoded `FrameState.effectEvents` 포함 여부를 제어한다. 기본값은 `true`이며, presentation adapter가 필요 없는 consumer는 `false`로 decode/read를 생략할 수 있다. 단, `CreateEngineOptions.effectEvents` runtime hook을 켜면 dispatch를 위해 해당 frame의 effect buffer read/decode는 강제로 수행된다. |
| `CreateEngineOptions.effectEvents` | `ResolvedPresentationEffectRegistry`와 optional handler target/camera/custom callback을 받아 `EffectEvent` frame-end dispatch를 opt-in으로 실행한다. 기본값은 disabled이며 기존 `onFrame` 수동 adapter와 중복 실행되지 않게 필요한 consumer만 켠다. `assetValidation: "error"`는 `BrowserPlatformHost.hasSound(...)`와 engine-local particle preset registration set을 사용해 missing asset을 diagnostic으로 보고한다. |
| `CreateEngineOptions.physicsDebugOptions` | engine 생성 시 적용할 physics debug category 옵션 |
| `FerrumRuntimeOptions.physicsMode` | `createFerrumRuntime(...)`에서 직접 지정하는 physics mode override |

## Asset Pipeline API

| API | 용도 |
| --- | --- |
| `AssetLoader` / `AudioAssetLoader` | texture/sound/JSON asset loading |
| `resolveAssetPreloadPlan(...)` | `AssetManifest`를 texture, sound, JSON preload entry와 count summary로 변환 |
| `assetManifestFingerprint(...)` | manifest의 texture/sound/JSON URL과 release salt를 deterministic fingerprint로 변환 |
| `createAssetPreloadCachePolicy(...)` | manifest fingerprint 기반 cache version과 JSON/texture/sound body cache 기본 정책 생성 |
| `invalidatePreloadedAssetCache(...)` | 같은 manifest와 cache policy로 저장된 JSON/binary preload entry를 명시적으로 무효화 |
| `preloadAssetManifest(...)` | loading screen에서 사용할 progress callback과 optional JSON/texture/sound binary cache policy를 적용해 manifest URL을 미리 fetch |
| `LoadingOverlay` | `AssetLoadProgress`를 DOM progress UI로 표시하는 loading screen preset |
| `IndexedDbAssetCache` | browser IndexedDB를 사용하는 opt-in JSON/binary asset cache. IndexedDB가 없는 환경에서는 cache miss/no-op으로 동작한다. |
| `importAsepriteAtlasFrames(...)` | Aseprite JSON frame metadata를 Game Spec atlas frame으로 변환 |
| `importTiledGameSpec(...)` / `importTiledTilemap(...)` | Tiled orthogonal JSON map을 atlas/tilemap 설정으로 변환. `externalTilesets`, tileset margin/spacing, hidden layer opt-in, uncompressed `encoding: "base64"` tile layer data 또는 명시적 `decodeCompressedLayerData` hook으로 푼 compressed base64 data를 지원한다. |
| `importLDtkGameSpec(...)` / `importLDtkTilemap(...)` | LDtk project/level data를 atlas/tilemap 설정으로 변환. padding/spacing이 있는 tileset source 좌표와 LDtk `Entities` layer metadata를 함께 처리한다. |
| `applyTileRules(...)`, `bakeAnimatedTileLayer(...)`, `resolveAnimatedTileFrame(...)` | row-major tile layer data에 ordered neighbor/animation rule을 적용해 Tiled/LDtk import 결과를 포함한 baked tile layer data 생성 |
| `generateTextureAtlasLayout(...)` | atlas layout compatibility helper |
| `packTextureAtlas(...)` | sprite name/size/source 목록을 deterministic atlas pack JSON(`ferrum-texture-atlas-pack` v1)으로 변환 |
| `textureAtlasDocumentToShooterAtlas(...)` | atlas pack JSON의 frame map을 `ShooterAtlasSpec`으로 변환 |
| `TEXTURE_ATLAS_PACK_FORMAT`, `TEXTURE_ATLAS_PACK_VERSION` | offline atlas pack artifact 식별자 |

Offline atlas pack prototype은 `scripts/texture-atlas-pack.mjs --input sprites.json --output atlas.json`으로 실행한다. 이 CLI는 실제 PNG 합성이나 trimming/rotation을 수행하지 않고, agent/tooling이 검증 가능한 deterministic frame 위치와 UV JSON을 생성하는 authoring 단계 helper다.

`AssetLoadProgress`는 `loaded`, `total`, `ratio`, `elapsedMs`, `kind`, `name`, `url`, `cached`를 포함한다. `preloadAssetManifest(...)`는 texture/sound URL body를 미리 fetch하고, `cachePolicy.json`, `cachePolicy.textures`, `cachePolicy.sounds`, 또는 `cachePolicy.binary`가 켜져 있으면 `IndexedDbAssetCache` 같은 cache 구현을 cache-first로 사용한다. `createAssetPreloadCachePolicy(...)`는 manifest URL과 `versionSalt`를 cache version에 반영하므로 release마다 salt를 갱신하면 stale body cache를 새 version으로 분리할 수 있다. 이 cache는 URL body를 재사용하는 preload layer이며, decoded WebGL texture 자체를 영속 저장하지는 않는다.

Asset pipeline helper는 metadata 변환을 담당한다. Runtime asset fetch/cache와 texture/audio resource 생성은 platform layer가 담당한다.

### Level Streaming API

Level streaming helper는 큰 tilemap을 chunk manifest로 나누고, viewport와 asset lifetime policy에 따라 active/preload/retain/load/unload chunk를 결정한다. 실제 chunk JSON fetch, `applyShooterGameSpec(...)` 반영, renderer texture eviction은 템플릿 runtime adapter가 담당한다.

| 타입/API | 역할 |
| --- | --- |
| `resolveLevelChunkManifest(...)` | tile size, chunk tile size, chunk grid 좌표, tilemap URL, chunk별 asset manifest를 검증하고 world bounds를 계산한다. |
| `resolveLevelStreamingPlan(...)` | viewport와 `LevelStreamingAssetLifetimePolicy`로 active/preload/retain/load/unload chunk id와 preload용 `AssetManifest`를 만든다. |
| `LevelChunkStreamer` | loaded chunk id set을 추적하고 다음 viewport plan과 snapshot을 반환한다. |
| `LevelChunkManifestSpec`, `LevelStreamingPlan` | AI/tooling이 생성하고 smoke로 검증할 chunk manifest/streaming plan 계약 |

### Audio System API

`AudioManager`는 Web Audio API 위에서 BGM, SFX, UI를 분리된 bus로 관리한다. `master`, `bgm`, `sfx`, `ui` bus는 각각 gain node를 가지며, BGM은 loop와 fade-in/fade-out을 지원한다. Spatial audio API는 아직 실제 위치 기반 panner가 아니라 기존 SFX fallback 경로로 유지된다.

| 타입/API | 역할 |
| --- | --- |
| `AudioManager.configure(...)` | `masterVolume`, `bgmVolume`, `sfxVolume`, `uiVolume`을 한 번에 적용한다. |
| `setBusVolume("master" | "bgm" | "sfx" | "ui", volume)` | bus gain을 즉시 갱신한다. |
| `playSfx(...)`, `playUi(...)`, `playEvents(...)`, `playEventBuffer(...)` | Rust audio event 또는 직접 호출을 channel id에 따라 BGM/SFX/UI bus로 라우팅한다. `channelId`가 없으면 기존 호환성을 위해 SFX로 처리한다. |
| `playBgm(soundId, { loop, volume, fadeMs, fadeInSeconds, fadeOutSeconds })` | 기존 BGM을 정리하고 새 BGM source를 BGM bus로 재생한다. |
| `stopBgm({ fadeMs, fadeOutSeconds })` | 현재 BGM을 즉시 또는 fade-out 후 중지한다. |
| `state()` | bus volume과 현재 BGM 재생 상태를 낮은 빈도 UI/debug 용도로 반환한다. |

주의: BGM은 browser autoplay 정책 때문에 `unlock()` 또는 사용자 입력 이후 재생해야 한다. Ducking automation, crossfade curve preset, spatial audio panner는 현재 범위에 포함하지 않는다.

### Camera & Post-processing API

Camera/post-processing pack은 장르 템플릿이나 agent-generated adapter가 공통으로 쓸 수 있는 platform helper다. Rust render command ABI는 바꾸지 않고, 카메라 위치 계산과 fullscreen fade pass를 TypeScript runtime/renderer 계층에서 처리한다.

| 타입/API | 역할 |
| --- | --- |
| `CameraRigController` | target 위치를 따라가며 dead-zone, bounds, optional smoothing을 적용한 camera center를 계산한다. |
| `resolveCameraRigSpec(...)`, `clampCameraToBounds(...)` | JSON-friendly camera rig spec을 검증하고 viewport-aware bounds clamp를 수행한다. |
| `ScreenFadeTransition` | `durationSeconds`, `fromOpacity`, `toOpacity`, `color`로 fade-in/out state와 post-process pass를 만든다. |
| `resolvePostProcessPasses(...)`, `fadePostProcessPass(...)` | renderer가 소비하는 fullscreen fade pass 배열을 검증/정규화한다. |
| `FerrumRuntimeOptions.postProcess` | static pass 또는 `FrameState` 기반 provider를 받아 WebGL2/WebGPU renderer의 fullscreen pass로 그린다. |

주의: WebGL2 renderer는 fade, bloom, CRT, vignette, glitch pass를 offscreen scene texture 기반 fullscreen pass로 처리한다. WebGPU renderer는 현재 fade pass만 지원하며, bloom/CRT/vignette/glitch pass가 전달되면 명시적인 camera/post-processing 진단 오류를 발생시킨다.

### Cutscene & Sequence API

Cutscene/sequence helper는 JSON-friendly timeline command를 검증하고, runtime adapter가 camera/audio/dialogue 이벤트를 순서대로 받을 수 있게 한다. 엔진 core나 render command ABI를 바꾸지 않으며, 실제 카메라 적용/오디오 재생/대화 UI 표시는 장르 템플릿 adapter가 담당한다.

| 타입/API | 역할 |
| --- | --- |
| `resolveCutsceneSequenceSpec(...)` | `wait`, `camera`, `audio`, `dialogue` command 배열을 검증하고 start/end time, default 값을 채운다. |
| `CutsceneSequencePlayer` | delta time으로 sequence를 진행하며 command event와 snapshot을 반환한다. |
| `applyCutsceneSequenceEvent(...)` | command event를 `CutsceneSequenceTarget`의 `moveCamera`, `playCutsceneAudio`, `showCutsceneDialogue` hook으로 전달한다. |
| `CutsceneSequenceSpec`, `ResolvedCutsceneSequenceSpec` | authoring JSON과 resolved runtime sequence 계약 |

주의: 현재 범위는 timeline command emission과 adapter hook이다. 화면 블렌드 트랙, branching cinematic graph, 컷신 전용 script expression은 별도 narrative tooling에서 확장한다.

### In-game Debug Gizmos API

Debug gizmo helper는 Game Spec/Physics Spec 주변의 보이지 않는 authoring 데이터를 검증 가능한 line primitive로 바꾼다. Rust render command ABI를 바꾸지 않고 기존 physics debug line buffer 계약을 재사용한다.

| 타입/API | 역할 |
| --- | --- |
| `buildDebugGizmoLines(...)` | `paths`, `spawns`, `prefabs`, `colliders`를 category/source metadata가 있는 line view 배열로 변환한다. |
| `debugGizmoLinesToBuffer(...)` | line view 배열을 `PhysicsDebugLineBufferView`로 pack한다. |
| `buildDebugGizmoLineBuffer(...)` | line view와 packed buffer를 한 번에 반환한다. |
| `DebugGizmoSceneSpec`, `DebugGizmoOptions`, `DebugGizmoLine` | AI/tooling authoring JSON, category filter/color override, line metadata 계약 |

주의: 현재 범위는 path/spawn/prefab/collider geometry helper다. trigger/region semantic metadata와 runtime overlay toggle UX는 장르 템플릿 adapter에서 확장한다.

### Accessibility Options API

Accessibility helper는 설정 UI나 Game Spec adapter가 공유할 reduced motion, subtitle, contrast palette, input assist metadata를 검증한다. 브라우저 플랫폼에서 `matchMedia("(prefers-reduced-motion: reduce)")` 결과를 읽을 수 있지만, runtime game state를 새로 소유하지 않는다.

| 타입/API | 역할 |
| --- | --- |
| `resolveAccessibilityOptions(...)` | `reducedMotion`, `subtitles`, `contrastPalette`, `inputAssist` 설정을 resolved contract로 검증한다. |
| `readAccessibilityEnvironment(...)` | optional `matchMedia` source에서 system reduced motion preference를 읽는다. |
| `resolveAccessibilityHudTheme(...)` | contrast palette에 맞는 `ResolvedHudThemeTokens`를 반환한다. |
| `applyAccessibilityToCameraRigSpec(...)` | reduced motion이 켜진 경우 camera smoothing을 제거한 spec을 반환한다. |
| `applyAccessibilityToScreenFadeSpec(...)` | reduced motion이 켜진 경우 screen fade duration을 0으로 줄인다. |
| `accessibilitySubtitlePanel(...)` | subtitle toggle을 적용해 `UiOverlay` status panel을 만들거나 숨긴다. |
| `ACCESSIBILITY_CONTRAST_PALETTES` | built-in `default`, `high-contrast`, `deuteranopia`, `protanopia`, `tritanopia` palette |

주의: 현재 범위는 engine/package helper다. 실제 설정 저장 UI, 장르별 control remap UX, 텍스트 크기 조절 UI는 템플릿 adapter에서 확장한다.

### Screenshot & Capture API

Screenshot capture helper는 browser smoke나 release tooling이 canvas pixel readback 결과를 deterministic summary로 저장하고 baseline summary와 threshold 비교를 수행하기 위한 API다. PNG 파일 작성과 Playwright 실행은 `scripts/browser-render-smoke.mjs`가 담당하고, package API는 summary/비교 계약만 제공한다.

| 타입/API | 역할 |
| --- | --- |
| `resolveScreenshotCaptureSpec(...)` | capture name, non-transparent pixel minimum, comparison threshold 기본값을 검증한다. |
| `summarizeScreenshotPixels(...)` | RGBA pixel buffer를 width/height, 평균 색상, opaque/non-transparent ratio, content hash summary로 변환한다. |
| `assertScreenshotCaptureSummary(...)` | summary format/version과 최소 non-transparent pixel ratio를 검증한다. |
| `compareScreenshotSummaries(...)` | actual/baseline summary의 average color, opaque ratio, non-transparent ratio delta를 threshold와 비교한다. |
| `SCREENSHOT_CAPTURE_SUMMARY_FORMAT`, `SCREENSHOT_CAPTURE_SUMMARY_VERSION` | screenshot summary JSON artifact 식별자 |

`browser-render-smoke.mjs --screenshot-artifact-dir artifacts/screenshot-capture-smoke --screenshot-name minimal-render examples/minimal-game/dist`는 browser PNG와 `minimal-render.summary.json`을 함께 저장한다.

## Physics API

Physics 구현 범위는 [2D 물리엔진 기능 맵](../development/architecture/physics-engine.md)을 기준으로 한다. Web public API는 낮은 빈도의 authoring/control/query 흐름을 대상으로 한다.

| 그룹 | 대표 타입/API |
| --- | --- |
| Spec apply/helper | `createPhysicsWorldFromSpec`, `PhysicsWorldApplyResult`, `createRigidBody`, `createCollider`, `createJoint`, `createVehicleRig`, `extractTilemapBoundaryChains`, `PixelMaskTerrain`, `createPixelMaskTerrainRuntime` |
| Material/layer authoring | `physicsMaterial`, `PHYSICS_MATERIAL_PRESETS`, `createPhysicsLayerMap`, `createPhysicsLayerSpec`, `physicsLayerMaskBits` |
| Step/stats | `stepRigidBodies`, `PhysicsRigidBodyStepOptions`, `PhysicsRigidBodyStepStats` |
| Body authoring | `PhysicsRigidBodySpawnOptions`, `PhysicsBodyHeightSpan`, `PhysicsEntityHandle`, `PhysicsEntitySnapshot` |
| Body control | `setPhysicsBodyPosition`, `setPhysicsBodyVelocity`, `setPhysicsBodyRotation`, `setPhysicsBodyEnabled`, `setPhysicsBodyHeightSpan`, `clearPhysicsBodyHeightSpan`, `getPhysicsBodyHeightSpan`, `moveHd2dKinematicBodyWithTilemap`, force/impulse/torque |
| Body snapshot buffer | `PhysicsBodyStateBufferSnapshot`, `capturePhysicsBodyStateBuffer`, `restorePhysicsBodyStateBuffer`, `createPhysicsBodyStateBufferSnapshot` |
| Body collider/material/tuning | `PhysicsBodyColliderOptions`, `PhysicsBodyColliderSnapshot`, `addPhysicsBodyCollider`, `getPhysicsBodyColliderCount`, `getPhysicsBodyCollider`, `setPhysicsBodyColliderMaterial`, `PhysicsRigidBodyMaterial`, `PhysicsMaterialSnapshot`, `PhysicsRigidBodyMassProperties`, `PhysicsRigidBodyTuning` |
| Joint authoring | `PhysicsJointSpawnOptions`, `PhysicsJointHandle`, `PhysicsJointSnapshot` |
| Snapshot/replay | `PhysicsWorldSnapshot`, `PhysicsReplayInputStream`, `capturePhysicsWorldSnapshot`, `restorePhysicsWorldSnapshot`, `hashPhysicsWorldSnapshot`, `runPhysicsReplayInputStream`, `verifyPhysicsReplayRollback`, `verifyPhysicsReplayInputStreamRollback` |
| Worker replay | `createPhysicsReplayWorkerClient`, `PhysicsReplayWorkerClient`, `PhysicsReplayWorkerRunResult`, `PhysicsReplayWorkerTransferBenchmarkResult` |
| AI/tooling authoring | `PhysicsAuthoringDocument`, `compilePhysicsAuthoringDocument`, `validatePhysicsAuthoringDocument`, `schemas/physics-authoring.schema.json` |
| Overlap query | `PhysicsBodyHeightSpanQuery`, `PhysicsPointBodyQuery`, `PhysicsAabbBodyQuery`, `PhysicsCircleBodyQuery`, `PhysicsOrientedBoxBodyQuery`, `PhysicsCapsuleBodyQuery`, `PhysicsConvexPolygonBodyQuery` |
| Cast query | `PhysicsBodyHeightSpanQuery`, `PhysicsRaycastBodyQuery`, `PhysicsSegmentCastBodyQuery`, shape별 `Physics...BodyShapeCastQuery` |
| Tile query | `PhysicsTileHeightSpanQuery`, `PhysicsNearestTileObstacleQuery`, `PhysicsRaycastTileObstacleQuery`, `PhysicsAabbTileObstacleShapeCastQuery`, tile contact/manifold query |
| Result buffers | `PhysicsBodyQueryHit`, `PhysicsRaycastBodyHit`, `PhysicsShapeCastBodyHit`, tile query hit types, `PhysicsRigidContactImpulseHit` |

Rust crate의 low-level `World`, `PhysicsSystem`, collider/joint helper는 Web package entrypoint에서 직접 re-export하지 않는다.

`PhysicsJointSpawnOptions`의 공식 joint type은 `distance`, `rope`, `spring`, `pulley`, `revolute`, `prismatic`, `weld`, `gear`다. `pulley`는 두 world-space ground anchor와 body local anchor 사이의 가중 길이를 유지하며 `ratio`와 `breakDistance`를 지원한다. `weld`는 local anchor와 `referenceAngle`을 기준으로 두 rigid body의 상대 위치/회전을 고정하며, `breakDistance`와 `breakAngle`을 지원한다. `createVehicleRig(...)`는 새 core joint type을 추가하지 않고 `prismatic` guide joint와 `spring` suspension joint를 조합한다.

`PhysicsRigidBodyCollider`는 generic runtime body 생성에서 AABB, circle, capsule, oriented box, convex polygon, edge, chain을 지원한다. `edge`는 `startX`, `startY`, `endX`, `endY` local segment와 optional offset을 사용하며, zero-length segment는 생성이 거부된다. `chain`은 2-64개 local vertex와 optional `loop`를 사용하며, public collider snapshot에는 하나의 chain collider로 유지된다.

`addPhysicsBodyCollider(handle, options)`는 기존 rigid body에 secondary collider를 추가한다. 첫 collider는 기존 `spawnRigidBody(...)`/단일 collider API의 primary collider(index `0`)이고, 추가 collider는 body-local index `1+`를 사용한다. `getPhysicsBodyColliderCount(...)`와 `getPhysicsBodyCollider(...)`는 낮은 빈도 tooling/snapshot 용도로 collider index, type, enabled/trigger, offset, material override, category/mask bit를 조회한다. Contact/query/debug 결과는 현재 public API에서 body/entity 단위로 반환된다. Collider별 material/filter/trigger/enabled 값은 runtime collision/query/debug와 contact solver에 반영된다.

`PhysicsBodyHeightSpan` / `PhysicsTileHeightSpan`은 HD-2D foundation용 optional height metadata다. `floorId`, `elevation`, `height`를 사용하며 `createPhysicsWorldFromSpec(...)`는 body `floor` 문자열을 deterministic numeric `floorId`로 변환해 spawn option에 적용한다. Height span이 양쪽 body에 모두 있을 때만 floor/height overlap을 entity/entity collision pair, swept pair, rigid contact solver, CCD filter에 AND로 적용한다. 이 collision pair 동작은 legacy body와의 호환을 위해 한쪽 span이 없으면 허용하지만, Body nearest/overlap/raycast/shape-cast query와 tile nearest/raycast/segment-cast/shape-cast/contact/manifold query는 `heightSpan` option을 지정하면 같은 floor이면서 높이 구간이 겹치는 대상만 반환하고, height span이 없는 legacy body/tile은 explicit filter 결과에서 제외한다. Shooter tile height metadata는 Game Spec `tilemap.tiles.*.floor/elevation/height` 또는 `setShooterTileHeightSpan(...)` / `clearShooterTileHeightSpan(...)`으로 설정한다. Shooter tile HD-2D kind/blocking metadata는 Game Spec `tilemap.tiles.*.kind/ramp/blocksMovement/...` 또는 `setShooterTileHd2dMetadata(...)` / `clearShooterTileHd2dMetadata(...)`으로 설정한다. `moveHd2dKinematicBodyWithTilemap(handle, options)`는 kinematic body를 shooter tilemap 기준으로 이동시키며 `PhysicsHd2dKinematicMoveOptions`의 `maxStepHeight`, `maxDropHeight`, `allowLedgeDrop`, `solidMaskBits`를 사용한다. 결과 `PhysicsHd2dKinematicMoveResult`는 이동 후 body snapshot, elevation delta, hit count, step/drop/bridge/filter flag를 반환한다. Physics body state bulk ABI는 유지되고, Physics world snapshot은 `state.heightSpan` sidecar로 값을 보존한다.

## UI와 Debug API

- `UiOverlay`: DOM 기반 HUD/menu/dialog/action overlay
- `UiOverlayState`, `UiPanel`, `UiDialog`, `UiAction`: UI state contract
- `DebugOverlay`: fps, renderer stats, physics stats, lifecycle/debug metrics 표시
- `DebugOverlayMetrics`, `RendererStats`: debug overlay와 renderer stats 계약
- `RuntimeProfiler`: DebugOverlay metric과 asset progress를 budget smoke용 sample로 축적
- `PhysicsDebugOptions`: `broadphase`, `contacts`, `manifolds`, `colliders`, `joints`, `sleeping`, `layers`, `ccd` category 계약. CCD category는 기존 debug line ABI를 사용해 hit 위치와 normal을 그린다.
- `buildDebugGizmoLines(...)`, `buildDebugGizmoLineBuffer(...)`: path/spawn/prefab/collider authoring spec을 physics debug line buffer로 변환
- `resolveAccessibilityOptions(...)`, `accessibilitySubtitlePanel(...)`: 접근성 설정과 subtitle status panel helper

UI/debug overlay는 platform layer 상태 표시용이다. Rust simulation state를 대체하지 않는다.

## Buffer Decoder Export

`wasmBridge.ts`의 buffer view와 decoder 타입은 advanced 사용자를 위해 export한다.

- render/audio/collision buffer view
- physics debug line buffer view
- physics query/cast/contact/manifold result buffer view
- rigid contact impulse result buffer view

이 buffer view들은 Wasm memory 위의 ephemeral typed-array view다. Wasm memory grow가 일어나면 기존 view가 detach될 수 있고, 다음 frame에서 같은 backing buffer가 덮어써질 수 있다. renderer처럼 같은 frame 안에서 동기 소비하거나, 비동기 처리와 장기 보관 전에는 `slice()` 등으로 복사한다.

일반 애플리케이션은 `FerrumEngine`과 `FrameState`를 우선 사용한다.

## Deprecated API 정책

호환을 위해 남아 있지만 신규 코드에서 사용하지 않는 항목이 있다.

- `CreateEngineOptions.includeDeprecatedRenderCommands`: 매 프레임 object 배열을 생성하므로 기본 buffer path를 사용한다.
- `CreateEngineOptions.useWorkerClock`: 현재 범위 밖이라 무시된다.
- generated wasm-bindgen API 직접 import: public API가 아니다.

Deprecated 항목을 제거하거나 동작을 바꿀 때는 README, 예제, release note를 함께 갱신한다.

## 오류 진단 정책

- 사용자 설정 오류는 `FerrumDiagnosticError`와 `DiagnosticReport`로 설명 가능한 메시지를 제공한다.
- Game Spec validation은 어떤 필드가 잘못됐는지 path를 포함한다.
- package/release artifact 검증은 `pnpm package:check`, `pnpm release:check`를 기준으로 한다.

## 기본 사용 예시

```ts
import {
  BrowserPlatformHost,
  createFerrumRuntime,
  type ShooterGameSpec,
} from "@ferrum2d/ferrum-web";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) throw new Error("missing #game canvas");

const platform = new BrowserPlatformHost();
const runtime = await createFerrumRuntime({
  canvas,
  assetHost: platform,
  environment: "development",
  debug: true,
});

const spec: ShooterGameSpec = await fetch("/game.json").then((res) => res.json());
runtime.engine.setGameSpec(spec);
runtime.start();
```

## API 변경 규칙

- Public export를 추가/삭제/rename하면 `packages/ferrum-web/src/index.ts`, 이 문서, README/예제를 함께 확인한다.
- Wasm buffer layout이 바뀌면 Rust size function, TypeScript decoder, 관련 tests를 함께 수정한다.
- Top-down Shooter Game Spec 필드가 바뀌면 [Top-down Shooter Game Spec](../examples/topdown-shooter/game-spec.md), schema, 예제 `game.json`, validation을 함께 갱신한다.
- Architecture나 physics 책임 경계가 바뀌면 [아키텍처](../development/architecture/architecture.md), [2D 물리엔진 기능 맵](../development/architecture/physics-engine.md)을 함께 갱신한다.
### `configureDamage` atomic apply note

`configureDamage`는 Rust/Wasm authoring surface의 `set_gameplay_damage_reaction(...)`을 통해 적용한다. 이 setter는 amount, target, generation handle, fixed-capacity collision reaction slot을 모두 검증한 뒤 damage component와 `CollisionReaction::Damage`를 같은 결과로 반영한다. 따라서 public adapter가 `set_gameplay_damage(...)`와 `add_gameplay_collision_damage(...)`를 순차 호출하면서 생기던 부분 적용 위험은 이 command에 한해 제거된다. 전체 `BehaviorRecipeCommand[]` batch apply는 여전히 transaction API가 아니므로 dry-run diagnostic과 replay/smoke 검증을 먼저 통과한 plan에 적용해야 한다.
