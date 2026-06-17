# Core Runtime Public API

`@ferrum2d/ferrum-web/core`는 Ferrum2D의 stable runtime entrypoint다. 게임 실행,
WebGL2 renderer, asset/audio/input, physics runtime, snapshot, buffer decoder를
사용할 때 이 subpath를 우선 import한다.

```ts
import {
  createFerrumRuntime,
  createEngine,
  createRenderer,
  WebGL2Renderer,
  AudioManager,
  resolvePhysicsSpec,
  captureGameStateSnapshot,
} from "@ferrum2d/ferrum-web/core";
```

## Runtime 생성

| API | 계약 |
| --- | --- |
| `createFerrumRuntime(...)` | canvas, assets, renderer, input, audio, engine loop를 묶은 browser runtime을 만든다. |
| `createEngine(...)` | Wasm `Engine`과 platform provider를 직접 연결할 때 사용한다. |
| `createRenderer(...)` | WebGL2 renderer를 생성하고 fallback 정보를 반환한다. |
| `WebGL2Renderer` | 기본 renderer 구현체다. Rust render command buffer만 소비한다. |
| `AudioManager` | browser audio channel, BGM, SFX playback을 담당한다. |

`FerrumRuntime`은 browser app에서 권장되는 상위 wrapper다. 더 세밀한 제어가 필요하면
`createEngine(...)`으로 `FerrumEngine`을 직접 만들 수 있다.

## FerrumEngine 그룹

`FerrumEngine`은 여러 facade interface의 합성이다.

| 그룹 | 주요 method |
| --- | --- |
| Lifecycle | `start`, `pause`, `resume`, `stop`, `destroy`, `time`, `version` |
| Scene | `resetGame`, `setViewportSize`, `setGameSpec`, `useDataScene`, `useBreakoutGame`, `usePlatformerGame` |
| Asset | `loadAssets`, `releaseAssets`, `textureId`, `soundId`, `setTextureIds`, `setSoundIds` |
| Particle | `setParticlePreset`, `spawnParticleBurst`, `clearParticles`, `particleCount` |
| Physics runtime | `configurePhysicsRuntime`, `configureFixedTimestep`, `stepRigidBodies` |
| Physics body/joint | `spawnRigidBody`, `addPhysicsBodyCollider`, `spawnPhysicsJoint`, `clearPhysicsJoint` |
| Physics query | body query, raycast, shape cast, tile obstacle query |
| Gameplay authoring | 낮은 빈도 behavior command apply. 세부는 [Authoring](authoring.md)을 본다. |
| Input action | `setInputActionBinding`, `clearInputActionBindings`, `resetInputActionBindings` |

scene 전체를 다시 적용하는 method와 부분 변경 method를 구분한다.

| Method | 상태 영향 |
| --- | --- |
| `setGameSpec(...)` | Shooter scene config를 다시 적용한다. 진행 중 enemy/wave 상태가 초기화될 수 있다. |
| `setShooterAtlasFrame(...)` | prefab의 texture/frame만 교체한다. world config와 wave는 다시 적용하지 않는다. |
| tilemap edit helper | 낮은 빈도 runtime tile metadata 변경용이다. 대량 편집은 spec 단계에서 처리한다. |

## FrameState

`FrameState`는 한 frame에서 관측된 runtime output이다. render/audio/collision/gameplay,
effect, physics debug, profiler용 snapshot을 포함할 수 있다.

Typed-array view는 해당 frame에서 동기 소비한다. frame 밖에 보관하거나 `await` 이후
읽어야 하면 먼저 복사한다.

| 옵션 | 기본값 | 영향 |
| --- | --- | --- |
| `includeAudioEvents` | `true` | decoded audio event 배열 포함 여부 |
| `includeCollisionEvents` | `false` | collision lifecycle tracking과 decoded collision event 포함 여부 |
| `includeGameplayEvents` | `true` | gameplay event buffer와 decoded event 포함 여부 |
| `includeEffectEvents` | `true` | presentation effect event buffer와 decoded event 포함 여부 |
| `enablePhysicsDebugLines` | `false` | Rust physics debug line buffer 생성 여부 |
| `includePhysicsDebugLines` | `false` | decoded physics debug line 배열 포함 여부 |

`FrameState`는 game simulation의 source of truth가 아니다. 장기 상태는 Rust core와
snapshot/replay API를 기준으로 관리한다.

## Physics Runtime

Core subpath는 Physics Spec resolver와 imperative Physics API를 함께 노출한다.

| API | 계약 |
| --- | --- |
| `resolvePhysicsSpec(...)` | JSON authoring 입력을 resolved physics spec으로 정규화한다. |
| `configurePhysicsRuntime(...)` | resolved spec을 runtime physics 설정에 적용한다. |
| `spawnRigidBody(...)` | 낮은 빈도 rigid body 생성용 imperative API다. |
| `stepRigidBodies(...)` | manual stepping 또는 테스트 harness에서 사용한다. |
| body/tile query | nearest, overlap, raycast, segment cast, shape cast query를 제공한다. |

Physics authoring 세부 계약은 [Physics Spec](../physics-spec.md)을 기준으로 한다.

`spawnPhysicsJoint(...)`의 `distance`/`rope`/`spring` 옵션은 `localAnchorAX/Y`,
`localAnchorBX/Y`를 선택값으로 받을 수 있다. 생략하면 각 body center(`0, 0`)에
연결되며, off-center anchor는 Rust solver에서 회전 관성까지 반영된다.

## Snapshot And Buffer Decoder

| API | 계약 |
| --- | --- |
| `captureGameStateSnapshot(...)` | game state를 저장 가능한 snapshot으로 캡처한다. |
| `restoreGameStateSnapshot(...)` | snapshot을 runtime에 복원한다. |
| `capturePhysicsBodyStateBuffer(...)` | physics body state bulk buffer snapshot을 만든다. |
| `decodeRenderCommands(...)` | Rust render command buffer를 renderer 입력으로 decode한다. |
| `decodeGameplayEvents(...)` | gameplay event buffer를 telemetry object로 decode한다. |
| `decodeEffectEvents(...)` | presentation-only effect detail buffer를 decode한다. |

일반 consumer는 decoder를 직접 호출하기보다 `FerrumEngine`과 `FrameState`를 우선
사용한다. decoder는 custom renderer, replay, smoke, diagnostic adapter에서 사용한다.
