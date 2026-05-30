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
  behaviorRecipeCommandsForEntity,
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
  createPixelMaskTerrain,
  createPixelMaskTerrainRuntime,
  createPhysicsWorldFromSpec,
  createRigidBody,
  createRenderer,
  createAssetPreloadCachePolicy,
  DEFAULT_INPUT_ACTION_PROFILE,
  TOPDOWN_SHOOTER_INPUT_ACTION_PROFILE,
  deriveHd2dTileOccludersFromTilemapGrid,
  deriveTileOccludersFromTilemapGrid,
  evaluateRuntimeProfilerBudget,
  extractPixelMaskBoundaryChains,
  extractTilemapBoundaryChains,
  createHudOverlayState,
  HUD_THEME_PRESETS,
  IndexedDbAssetCache,
  instantiateSceneFragment,
  LoadingOverlay,
  invalidatePreloadedAssetCache,
  preloadAssetManifest,
  resolveAnimationTimelineSpec,
  resolveAccessibilityOptions,
  resolveBehaviorRecipeDocument,
  resolveAssetPreloadPlan,
  resolveAccessibilityHudTheme,
  resolveHudTheme,
  resolveSceneCompositionSpec,
  runPhysicsReplayInputStream,
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
  SPRITE_MATERIAL_PRESETS,
  VirtualControls,
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
| `RuntimeProfiler`, `runtimeDiagnosticsFrameSample(...)`, `evaluateRuntimeProfilerBudget(...)` | frame/render/physics/asset progress sample을 모으고 budget 위반을 보고한다. |
| `capturePhysicsWorldSnapshot(...)`, `restorePhysicsWorldSnapshot(...)`, `verifyPhysicsReplayRollback(...)` | Physics Spec으로 만든 world의 낮은 빈도 snapshot/restore/replay 검증을 수행한다. |
| `createPhysicsBodyStateBufferSnapshot(...)` | `PhysicsEntitySnapshot[]`를 Wasm bulk restore용 typed-array body state buffer로 변환한다. |
| `createPhysicsReplayInputStream(...)`, `runPhysicsReplayInputStream(...)`, `verifyPhysicsReplayInputStreamRollback(...)` | frame/seed/fixed step/body event 기반 replay stream과 rollback 검증을 수행한다. |
| `createPhysicsReplayWorkerClient(...)` | Physics Spec snapshot/replay를 Web Worker에서 실행하고 transfer benchmark를 측정하는 opt-in client를 만든다. |
| `compilePhysicsAuthoringDocument(...)` | `physicsEditor` metadata를 제거하고 runtime `PhysicsSpec`만 export한다. |
| `diagnosticReport(...)` | runtime/package 진단 정보를 만든다. |
| `buildDebugGizmoLines(...)`, `buildDebugGizmoLineBuffer(...)` | AI/tooling이 만든 path/spawn/prefab/collider debug spec을 renderer의 physics debug line buffer 계약으로 변환한다. |

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

`FrameState`는 render/audio/collision/debug snapshot이다. `FrameState.physics.mode`는 현재 runtime physics mode 표시용이며, 게임 규칙의 source of truth가 아니므로 장기 simulation state로 사용하지 않는다. `FrameState.spriteCount`는 Rust-side culling 이후 보이는 render command 수를 뜻한다. HD-2D scene에서는 debug/profiler 용도로 `playerFloorId`, `playerElevation`, `playerHeight`, HD-2D filtered entity/tile candidate counters가 함께 노출된다. `renderCommandBuffer`, `collisionEventBuffer`, `physicsDebugLineBuffer` 같은 Wasm typed-array view는 해당 frame에서 동기 소비하는 용도다. frame 밖에 보관하거나 `await` 이후 읽어야 하면 먼저 복사한다.

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

`InputManager`는 keyboard/mouse/pointer/touch/gamepad 입력을 `InputSnapshot`으로 합성한다. 게임 규칙은 이 snapshot을 직접 읽거나 action profile helper로 장르별 action/axis state를 만들 수 있다.

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
| `BuiltInShooterStateSnapshot`, `captureShooterStateSnapshot()`, `restoreShooterStateSnapshot(...)` | built-in shooter의 score, game state, spawn/wave timer, camera, player/enemy/bullet runtime state를 낮은 빈도 save/load용 buffer로 캡처하고 복원한다. |
| `GameStateSnapshotJsonValue` | custom state가 JSON-compatible 값임을 드러내는 타입이다. |

주의: built-in shooter restore는 gameplay state를 대상으로 한다. 점수, game state, spawn/wave timer, camera, player/enemy/bullet position/velocity/health/damage/lifetime/reward는 복원하지만, hit flash, particle, tween, pending audio event 같은 순간 효과는 세이브 파일에 포함하지 않는다. `restoreGameStateSnapshot(..., { restoreBuiltInShooterState: false })`로 built-in shooter state 적용을 끌 수 있다.

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

Behavior recipe는 health, damage, pickup, chase, interaction 같은 흔한 게임 행동을 Game Spec 친화적인 데이터로 표현하고, runtime adapter가 처리할 command로 변환한다. 이 계층은 gameplay loop를 직접 소유하지 않고, 장르 템플릿이나 agent-generated adapter가 `BehaviorRecipeCommand`를 받아 실제 entity state, physics, inventory, UI와 연결한다.

| 타입/API | 역할 |
| --- | --- |
| `BehaviorRecipeDocumentSpec` | reusable recipe와 entity별 recipe 목록을 담는 JSON-friendly schema |
| `resolveBehaviorRecipeDocument(...)` | recipe kind, reusable reference, override, entity별 중복 id, numeric/string 값을 검증한다. |
| `behaviorRecipeCommandsForEntity(...)` | 특정 entity recipe를 `configureHealth`, `configureDamage`, `configurePickup`, `configureChase`, `configureInteraction` command로 변환한다. |
| `applyBehaviorRecipes(...)` | `BehaviorRecipeRuntimeTarget.applyBehaviorRecipeCommand(command)` adapter를 호출한다. |
| `BehaviorRecipeCommand` | 장르 runtime이 실제 구현으로 변환할 command union |

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
        { kind: "chase", target: "player", speed: 96 },
      ],
    },
  },
});

applyBehaviorRecipes({
  applyBehaviorRecipeCommand: (command) => {
    // 장르별 adapter가 command를 ECS/state/physics/inventory/UI hook으로 연결한다.
  },
}, recipes);
```

주의: 이번 범위는 schema 검증과 generated runtime adapter command 경로다. damage event 처리, collision trigger binding, inventory state mutation 같은 실제 gameplay execution은 장르 템플릿의 adapter에서 구현한다.

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

Top-down Shooter Game Spec의 상세 필드와 예시는 [Top-down Shooter Game Spec](topdown-shooter-game-spec.md)에 둔다. Public API 문서에서는 코드 계약만 요약한다.

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
- Top-down Shooter Game Spec 필드가 바뀌면 [Top-down Shooter Game Spec](topdown-shooter-game-spec.md), schema, 예제 `game.json`, validation을 함께 갱신한다.
- Architecture나 physics 책임 경계가 바뀌면 [아키텍처](../development/architecture/architecture.md), [2D 물리엔진 기능 맵](../development/architecture/physics-engine.md)을 함께 갱신한다.
