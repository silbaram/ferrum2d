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
  GAME_STATE_CODE,
  gameStateName,
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
`createFerrumRuntime({ dataScene })`은 `ferrum2d.consumer.scene-authoring`
문서를 startup 단계에서 `applyDataSceneAuthoringDocument(...)`로 적용하고,
`runtime.dataScene` handle을 통해 적용 결과와 `transition(...)`/`reapply(...)` 경로를 제공한다.
handle의 `variables`는 현재 문서에 선언된 Data Scene 변수만 읽고 쓸 수 있다. `reapply(...)`는
동일 이름·동일 타입의 global 값을 유지하고 scene 값을 다음 문서의 default로 초기화한다. 검증 실패 시
현재 document/result/variable store와 인자 없는 다음 reapply의 기준 문서는 마지막 성공 상태를 유지한다.

## FerrumEngine 그룹

`FerrumEngine`은 여러 facade interface의 합성이다.

| 그룹 | 주요 method |
| --- | --- |
| Lifecycle | `start`, `pause`, `resume`, `stop`, `destroy`, `time`, `version` |
| Scene | `resetGame`, `setViewportSize`, `setGameSpec`, `useDataScene`, `dataSceneState`, `pauseDataScene`, `resumeDataScene`, `completeDataScene`, `useBreakoutGame`, `usePlatformerGame` |
| Asset | `loadAssets`, `releaseAssets`, `textureId`, `soundId`, `setTextureIds`, `setSoundIds` |
| Bitmap text | `loadBitmapFont`, `registerBitmapFont`, `setWorldText`, `removeWorldText`, `worldTextGlyphCount` |
| Particle | `setParticlePreset`, `spawnParticleBurst`, `clearParticles`, `particleCount` |
| Physics runtime | `configurePhysicsRuntime`, `configureFixedTimestep`, `stepRigidBodies` |
| Physics body/joint | `spawnRigidBody`, `despawnPhysicsEntity`, `addPhysicsBodyCollider`, `spawnPhysicsJoint`, `clearPhysicsJoint` |
| Physics query | body query, raycast, shape cast, tile obstacle query |
| Gameplay authoring | 낮은 빈도 behavior command apply. 세부는 [Authoring](authoring.md)을 본다. |
| Input action | `setInputActionBinding`, `clearInputActionBindings`, `resetInputActionBindings` |

scene 전체를 다시 적용하는 method와 부분 변경 method를 구분한다.

| Method | 상태 영향 |
| --- | --- |
| `setGameSpec(...)` | Shooter scene config를 다시 적용한다. 진행 중 enemy/wave 상태가 초기화될 수 있다. |
| `setShooterAtlasFrame(...)` | prefab의 texture/frame만 교체한다. world config와 wave는 다시 적용하지 않는다. |
| tilemap edit helper | 낮은 빈도 runtime tile metadata 변경용이다. 대량 편집은 spec 단계에서 처리한다. |

`FerrumRuntimeOptions.dataScene`은 built-in starter scene을 거치지 않는 generic
Data Scene boot path다. 옵션이 문서 자체이면 기본 apply option을 쓰고,
`{ document, ...applyOptions }` 형태이면 texture resolver, binding id,
instance handle registry 같은 `applyDataSceneAuthoringDocument(...)` option을 함께
전달한다. 이 경로는 낮은 빈도 scene load/apply 단계에서만 실행되며 frame마다
TypeScript callback을 만들지 않는다.

## Data Scene Flow

`runtime.dataScene.transition(nextDocument, options?)`은 문서 A에서 B로 이동하는 명시적 scene/level
전환이고, `reapply(document?, options?)`는 현재 문서를 다시 적용하는 reload다. `transition(...)`과 기본
`reapply(...)`는 validation 성공 뒤 Rust Data Scene reset boundary를 통과하며 빈 instance 문서도 실제
전환으로 처리한다. 기존 low-level 호환용 `reapply(..., { activateDataScene: false })`만 caller-prepared
Data Scene에 reset 없이 적용되며 `transition(...)`은 activation opt-out을 허용하지 않는다.

| API | 계약 |
| --- | --- |
| `runtime.dataScene.state()` | `playing`, `paused`, `levelComplete` 또는 Data Scene 외부의 `undefined`를 반환한다. |
| `pause()` / `resume()` | `playing ↔ paused`의 허용된 방향에서만 `true`를 반환한다. |
| `complete()` | `playing` 또는 `paused`를 `levelComplete`로 바꾼다. |
| `transition(document)` | 새 문서를 적용하고 lifecycle을 `playing`으로 초기화한다. |
| `GAME_STATE_CODE`, `gameStateName(...)` | stable numeric ABI `title=0`, `playing=1`, `gameOver=2`, `paused=3`, `levelComplete=4`를 해석한다. |

`paused`와 `levelComplete`에서는 render는 계속되지만 Rust tween, rigid physics, gameplay timer/FSM,
particle simulation은 진행하지 않는다. 전환 시 같은 이름·타입의 `global` 변수만 다음 문서에 생존하고
`scene` 변수는 default로 돌아간다. World/tilemap/particle/tween, physics history/fixed-step/input latch,
frame event/render/audio buffer, pending spawn/deferred despawn queue는 모두 정리된다.

## 월드 공간 비트맵 텍스트

`FerrumBitmapTextApi`는 시스템 폰트/Canvas `fillText` 대신 기존 sprite renderer를
사용한다. `loadBitmapFont(fontId, policy)`는 `BitmapFontPolicySpec.image` texture와
`data` atlas JSON을 기존 `AssetHost`로 로드하고 Rust cache에 등록한다. `data`는 기존
URL string을 그대로 지원하며, `BitmapFontAtlasSpec` inline object도 선택할 수 있다.
정책의 optional `lineHeight`는 atlas `lineHeight`를 override하므로 기존 URL 기반
정책과 하위 호환된다.

```ts
const atlas = {
  format: "ferrum-bitmap-font",
  version: 1,
  lineHeight: 12,
  glyphs: {
    A: {
      uv: { u0: 0, v0: 0, u1: 0.5, v1: 1 },
      size: { width: 8, height: 10 },
      advance: 9,
    },
  },
} as const;

engine.registerBitmapFont(1, engine.textureId("font-atlas"), atlas);
engine.setWorldText(10, {
  fontId: 1,
  text: "AAA",
  x: 320,
  y: 180,
  alignment: "center",
  color: [1, 0.85, 0.25, 1],
  scale: 2,
  renderLayer: 20,
});
```

`WorldTextSpec`의 `alignment` 기본값은 `left`, `scale`은 `1`, `color`는 흰색,
`maxWidth`/`renderLayer`/`floorId`/`elevation`은 `0`이다. `maxWidth > 0`이면 glyph
advance 기준으로 줄을 나누고 명시적 `\n`도 지원한다. `anchor`에 generation을 포함한
entity handle을 주면 `x/y`가 local offset이 되어 Rust transform을 따라간다. 따라서
오브젝트 label을 위해 frame마다 위치나 문자열을 다시 전달할 필요가 없다.
`x/y`는 첫 줄의 layout origin이며 `center`/`right` 정렬은 각 줄을 이 origin 기준으로
왼쪽으로 이동한다.

같은 `textId`와 같은 normalized spec을 다시 설정하면 TypeScript facade가 Wasm 호출을
생략한다. 문자열 내용은 같고 좌표·색상 같은 속성만 바뀌면 숫자 전용 update 경로를
사용한다. 좌표·render/HD-2D metadata·anchor만 바뀌는 update는 glyph command도 다시
만들지 않는다. 변경된 문자열만 Wasm 문자열 경계를 지나 Rust에서 다시 glyph command로
전개되며, 변경 없는 frame은 cache를 재사용해 camera 변환·glyph 단위 culling·기존
sprite sort만 수행한다.
텍스트 하나와 font 하나는 각각 최대 4,096 glyph, font는 최대 16,384 kerning pair를
허용한다. 이 기능은 월드 공간 표현용이며 화면 고정 HUD/dialogue DOM overlay를
대체하지 않는다.

폰트와 텍스트 등록은 engine 수명에 속하며 `resetGame()`이나 scene 전환이 자동으로
제거하지 않는다. scene 단위로 소유하는 label은 teardown에서 `removeWorldText(...)`나
`clearWorldTexts()`를 호출한다. entity anchor는 해당 handle이 현재 world에서 resolve될
때만 render command를 만든다.

## FrameState

`FrameState`는 한 frame에서 관측된 runtime output이다. render/audio/collision/gameplay,
effect, physics debug, profiler용 snapshot을 포함할 수 있다.
`gameState`는 `GameStateCode`이며 기본 debug label은 `Title`, `Playing`, `GameOver`, `Paused`,
`LevelComplete`를 사용한다. 알 수 없는 telemetry code는 임의 숫자로 통과시키지 않고 frame 조립 시 거절한다.

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

`createFerrumRuntime(...)`의 `physicsDebugLineComposer`는 `physicsDebugLines`가 활성화된
frame에서 Rust `PhysicsDebugLineBufferView`를 받아 renderer에 넘길 최종 buffer를 반환한다.
`DebugGizmoLineBufferWriter`로 원본 buffer를 append한 뒤 line/polyline/arrow/circle을 추가하면
WebGL2/WebGPU가 기존 8-float debug line ABI를 그대로 소비한다. 옵션이 비활성화되면 composer도
호출되지 않는다. composer와 반환 buffer는 frame 안에서 동기 처리하고 보관하지 않는다.

## Physics Runtime

Core subpath는 Physics Spec resolver와 imperative Physics API를 함께 노출한다.

| API | 계약 |
| --- | --- |
| `resolvePhysicsSpec(...)` | JSON authoring 입력을 resolved physics spec으로 정규화한다. |
| `configurePhysicsRuntime(...)` | resolved spec을 runtime physics 설정에 적용한다. |
| `spawnRigidBody(...)` | 낮은 빈도 rigid body 생성용 imperative API다. |
| `despawnPhysicsEntity(...)` | body와 그 body를 endpoint로 참조하는 모든 joint를 함께 제거하고 기존 joint handle을 무효화한다. |
| `stepRigidBodies(...)` | manual stepping 또는 테스트 harness에서 사용한다. |
| body/tile query | nearest, overlap, raycast, segment cast, shape cast query를 제공한다. |

Physics authoring 세부 계약은 [Physics Spec](../physics-spec.md)을 기준으로 한다.

`spawnPhysicsJoint(...)`의 `distance`/`rope`/`spring` 옵션은 `localAnchorAX/Y`,
`localAnchorBX/Y`를 선택값으로 받을 수 있다. 생략하면 각 body center(`0, 0`)에
연결되며, off-center anchor는 Rust solver에서 회전 관성까지 반영된다.
`pulley` 옵션의 `slack`은 기본 `false`이고, `true`이면 rest length 이하에서는
느슨한 줄로 취급해 correction을 적용하지 않는다.
`revolute` 옵션의 `continuousLimit`은 기본 `false`이고, `true`이면
`lowerAngle`/`upperAngle`을 정규화하지 않은 누적 상대 각도 기준으로 적용한다.

`setPhysicsBodyMassProperties(...)`의 `mass`/`inertia`는 양수·finite이고 Rust
`f32`에서 역수도 finite여야 한다. TypeScript API는 0·음수·NaN·Infinity를
Wasm 호출 전에 예외로 거부한다. TypeScript 검증을 통과했더라도 Rust `f32`
변환 결과가 양수·finite가 아니거나 역수가 finite가 아니면 body 상태를 변경하지
않고 `false`를 반환한다. bulk body snapshot restore도 dynamic body의
mass/inertia에 같은 Rust 경계를 적용하고, 위반 시 `false`를 반환한다.

## Snapshot And Buffer Decoder

| API | 계약 |
| --- | --- |
| `captureGameStateSnapshot(...)` | game state를 저장 가능한 snapshot으로 캡처한다. |
| `restoreGameStateSnapshot(...)` | snapshot을 runtime에 복원한다. |
| `capturePhysicsBodyStateBuffer(...)` | physics body state bulk buffer snapshot을 만든다. |
| `decodeRenderCommands(...)` | Rust render command buffer를 renderer 입력으로 decode한다. |
| `decodeGameplayEvents(...)` | gameplay event buffer를 telemetry object로 decode한다. |
| `decodeEffectEvents(...)` | presentation-only effect detail buffer를 decode한다. |
| `createRenderCommandAccessor()` | Rust `SpriteRenderCommand` layout을 읽어 재사용 가능한 named-field accessor를 만든다. |
| `createBuiltInShooterStateAccessor()` | Built-in Shooter snapshot layout을 읽어 재사용 가능한 named-field accessor를 만든다. |

저수준 `createEngine(...)` 경로에서 raw offset을 직접 계산하지 않는다. accessor는
engine 생성 시 Rust가 내보낸 field enum/offset으로 초기화되며, layout stride가
일치하지 않으면 ABI mismatch로 즉시 실패한다.

```ts
const renderAccessor = engine.createRenderCommandAccessor();

const onFrame = (frame) => {
  renderAccessor.bind(frame.renderCommandBuffer);
  for (let index = 0; index < frame.renderCommandBuffer.commandCount; index += 1) {
    renderAccessor.select(index);
    drawDebugLabel(renderAccessor.x, renderAccessor.y, renderAccessor.textureId);
  }
};
```

`RenderCommandAccessor.bind(...)`와 `select(...)`는 내부 buffer reference와 index만
갱신한다. field getter는 scalar를 직접 반환하므로 accessor 자체가 frame마다 객체나
배열을 만들지 않는다. Wasm memory view는 기존 계약대로 현재 frame 안에서만 소비한다.
`bind(...)` 검증이 실패하면 이전 buffer와 선택을 지우고, `select(...)`가 실패하면
이전 선택을 지운다. 따라서 오류 이후 getter가 오래된 frame을 계속 읽지 않는다.

Shooter snapshot은 `bind(snapshot)` 후 `select(...)` 또는 `selectFirst(...)`로 읽는다.
smoke fixture처럼 snapshot copy를 수정해야 하는 낮은 빈도 경로는
`bindMutable(...)`을 사용한다. `gameState`, `enemySpawnTimer`, `kind`, `x`, `health`,
primary action, dash, melee 같은 명명 필드를 제공하며, raw header/entity index에
의존하지 않는다. `bind(...)`으로 연결한 read-only snapshot에 쓰려고 하면 실패한다.
bind/select 검증 실패는 이전 snapshot 참조, mutable 쓰기 권한, entity 선택을 함께
해제하므로 accessor를 다시 bind하기 전에는 읽거나 쓸 수 없다.

`captureGameStateSnapshot(..., { includeDataSceneState: true })`는 optional
`dataSceneAuthoringDocument`를 함께 받을 수 있다. 이 값은 JSON-compatible
`DataSceneStateSnapshot.authoringDocument`로 hash에 포함되며,
`restoreGameStateSnapshot(...)`은 기본적으로 이를 `applyDataSceneAuthoringDocument(...)`로
다시 적용한 뒤 `applyDataSceneCustomState` callback을 호출한다. 문서가 없거나
`restoreDataSceneAuthoringDocument: false`이면 restore는 기존처럼 빈 Data Scene mode만
활성화한다.

선언 변수가 있는 Data Scene을 `includeDataSceneState: true`로 캡처하면 global 값은
`snapshot.custom[DATA_SCENE_VARIABLES_SNAPSHOT_KEY]`, scene 값은
`snapshot.dataScene.custom[DATA_SCENE_VARIABLES_SNAPSHOT_KEY]`에 기록된다. 일반/built-in snapshot에는
이 저장소를 자동 주입하지 않는다. restore는 적용되거나 이미 연결된 authoring 선언과 두 스코프의
값을 runtime activation 전에 대조하고, reserved payload를 제외한 consumer custom state만 callback에
전달한다. 결과의
`dataSceneVariables`/`globalVariablesApplied`/`sceneVariablesApplied`로 적용 여부를 보고한다.

현재 `GameStateSnapshot.version`과 `DataSceneStateSnapshot.version`은 `2`다. Data Scene lifecycle state는
snapshot/replay hash에 포함되며 restore는 변수 복원 뒤 lifecycle을 복원한 다음 custom callback을 호출한다.
따라서 `paused`와 `levelComplete` 저장은 fresh runtime에서도 같은 상태로 복원된다. version `1`은
validation에서 거절하므로 저장 데이터가 필요한 consumer는 version `2` 재캡처 또는 명시적 migration이
필요하다. Built-in Shooter state ABI는 lifecycle code 계약 변경과 함께 version `18`이다. Built-in snapshot은
기존 `title|playing|gameOver`만 허용하고 Data Scene 전용 `paused|levelComplete` code는 복원에서 거절한다.
`includeDataSceneState: true` capture는 active Data Scene에서만 허용되며 restore authoring option의
`activateDataScene: false`는 mutation 전에 거절한다.

일반 consumer는 decoder를 직접 호출하기보다 `FerrumEngine`과 `FrameState`를 우선
사용한다. decoder는 custom renderer, replay, smoke, diagnostic adapter에서 사용한다.
