# Ferrum2D Public API

이 문서는 `@ferrum2d/ferrum-web` 패키지에서 사용자가 직접 import해도 되는 API와 권장 사용 경로를 고정한다. MVP 이후 고도화에서도 Rust core와 TypeScript platform layer의 책임 경계를 유지하는 것을 우선한다.

## Import 원칙

애플리케이션과 예제 코드는 패키지 entrypoint만 사용한다.

```ts
import {
  BrowserPlatformHost,
  InputManager,
  WebGL2Renderer,
  createEngine,
  type AssetManifest,
  type FerrumEngine,
  type FrameHandler,
  type RendererStats,
  type ShooterGameSpec,
} from "@ferrum2d/ferrum-web";
```

다음 경로는 public API가 아니다.

- `@ferrum2d/ferrum-web/dist/*`
- `@ferrum2d/ferrum-web/pkg/*`
- `packages/ferrum-web/src/*`
- generated wasm-bindgen API인 `../pkg/ferrum_core`

## 권장 API 표

| API | 종류 | 권장 용도 |
| --- | --- | --- |
| `createEngine(...)` | function | Wasm `Engine`, frame loop, input, asset host, viewport provider를 묶어 `FerrumEngine`을 만든다. |
| `FerrumEngine` | interface | start/pause/resume/stop/destroy, asset loading, texture/sound id 적용, Game Spec 적용, score/state 조회를 제공한다. |
| `FrameHandler` | type | `createEngine`의 frame callback 타입이다. 매 프레임 `FrameState`를 받는다. |
| `FrameState` | interface | 렌더링, 디버그, HUD 갱신에 필요한 per-frame snapshot이다. 게임 규칙의 source of truth는 아니다. |
| `InputProvider` | type | `InputSnapshot`을 제공하는 callback 타입이다. 보통 `InputManager.snapshot()`을 연결한다. |
| `ViewportProvider` | type | canvas logical viewport size를 제공하는 callback 타입이다. 보통 renderer resize 결과를 연결한다. |
| `CreateEngineOptions` | interface | compatibility 옵션을 담는다. 신규 코드는 기본값을 사용한다. |
| `AssetHost` | interface | `createEngine`이 asset loading과 audio playback을 위임하는 host 계약이다. |
| `BrowserPlatformHost` | class | texture/sound/JSON asset loading과 audio playback을 묶는 browser platform host다. |
| `WebGL2Renderer` | class | MVP의 기본 WebGL2 renderer다. texture id 기반 sprite command를 그린다. |
| `Renderer` | interface | renderer lifecycle의 최소 interface다. MVP 구현체는 `WebGL2Renderer` 하나다. |
| `RendererStats` | interface | draw call, batch, sprite, render command, texture bind/switch 수를 나타낸다. |
| `AudioManager` | class | Web Audio context, bus volume, unlock, SFX/BGM playback을 관리한다. |
| `AudioBusConfig` | interface | `AssetHost.configureAudio(...)`에 전달되는 master/sfx bus volume 계약이다. |
| `AudioAssetLoader` | class | sound fetch/decode 책임을 담당한다. 일반 앱은 보통 `BrowserPlatformHost`를 통해 간접 사용한다. |
| `InputManager` | class | keyboard/mouse 입력을 browser event에서 수집해 `InputSnapshot`으로 제공한다. |
| `DebugOverlay` | class | DOM 기반 debug metrics 표시용 helper다. |
| `AssetManifest` | interface | texture, sound, JSON asset URL manifest다. |
| `LoadedAssets` | interface | 로드된 texture/sound registry와 JSON asset 결과다. |
| `ShooterGameSpec` | interface | Top-down Shooter 설정 입력 타입이다. |
| `ResolvedShooterGameSpec` | interface | 기본값과 preset code가 적용된 Game Spec 결과 타입이다. |
| `ResolvedShooterWave` | interface | Game Spec wave 항목이 enemy preset과 함께 해석된 결과 타입이다. |
| `ResolvedShooterTilemap` | interface | Game Spec tilemap 항목이 atlas frame과 함께 해석된 결과 타입이다. |
| `ResolvedShooterTileDefinition` | interface | positive tile id, atlas frame, tint color를 포함하는 resolved tile definition이다. |
| `ResolvedShooterTileLayer` | interface | tile layer dimension, origin, row-major tile data를 포함하는 resolved layer다. |
| `resolveShooterGameSpec(...)` | function | unknown JSON을 검증하고 resolved spec으로 변환한다. CLI와 runtime이 같은 경로를 사용한다. |
| `applyShooterGameSpec(...)` | function | resolved Game Spec 값을 Rust `Engine` compatible target에 적용한다. |
| `ApplyShooterGameSpecOptions` | interface | atlas frame texture name을 numeric texture id로 해석하는 resolver 옵션이다. |
| `RenderCommandBufferView` | interface | Wasm render command buffer를 매 프레임 새 `Float32Array` view로 읽은 결과다. |
| `AudioEventView` | interface | Rust audio event buffer를 TypeScript에서 해석한 결과다. |

## RendererStats 계약

`WebGL2Renderer.stats()`와 `renderCommands(...)`가 반환하는 `RendererStats`는 현재 frame의 renderer 관측값이다. 모든 필드는 count 단위다.

| 필드 | 표시명 | 의미 |
| --- | --- | --- |
| `drawCalls` | `draw calls` | WebGL draw call 수 |
| `batchCount` | `batches` | texture-contiguous sprite batch 수 |
| `spriteCount` | `sprites` | renderer가 소비한 sprite command 수 |
| `renderCommandCount` | `render commands` | Wasm render command buffer의 command 수 |
| `textureBindCount` | `texture binds` | batch 렌더링에 따른 texture bind 수 |
| `textureSwitchCount` | `texture switches` | texture-id batching 경로에서 인접 `texture_id`가 바뀐 횟수. 명시적 단일 texture 렌더 경로는 0 |

DebugOverlay는 이 계약을 `fps`, `frame time`, `rust update`, `render`, `mouse`, `camera`, `state`, `score`, `audio events`와 함께 표시한다. 표시 문자열은 `fps: 60.0 fps`, `frame time: 16.67 ms`, `audio events: 4.3 events/s`처럼 label과 unit을 포함한다.

## Game Spec Camera 계약

`ShooterGameSpec.camera`는 브라우저에서 문자열 preset과 수치를 검증한 뒤 Rust에는 숫자형 preset code와 수치만 전달한다.

지원 preset:

- `follow`
- `dead-zone`
- `look-ahead`
- `shake`

관련 resolved 필드는 `cameraPreset`, `cameraPresetCode`, `cameraDeadZoneWidth`, `cameraDeadZoneHeight`, `cameraLookAheadDistance`, `cameraShakeAmplitude`, `cameraShakeFrequency`이다. 실제 per-frame camera position 계산은 Rust core가 담당한다.

## Game Spec Atlas 계약

`ShooterGameSpec.atlas.frames`는 frame name, texture name/id, normalized UV rect, frame size를 표현한다. `prefabs.player.frame`, `prefabs.enemy.frame`, `prefabs.bullet.frame`은 이 frame name을 참조한다.

TypeScript 검증 범위:

- `prefabs.*.frame`은 `atlas.frames`에 존재해야 한다.
- `atlas.frames.*.texture`는 non-empty texture name 또는 non-negative integer texture id여야 한다.
- `atlas.frames.*.uv`는 `0..1` 범위이고 `u1 > u0`, `v1 > v0`이어야 한다.
- `atlas.frames.*.size.width/height`는 positive number여야 한다.
- 같은 prefab에서 `frame`과 `animation`은 동시에 사용할 수 없다.

Runtime 적용 범위:

- `texture`가 string이면 `createEngine()`은 연결된 `AssetHost.textureId(name)`으로 numeric id를 해석한다.
- `applyShooterGameSpec(...)`를 직접 호출하면서 named texture atlas frame을 쓰는 경우 `ApplyShooterGameSpecOptions.textureId`를 제공해야 한다.
- Rust에는 `set_shooter_atlas_frame(...)`을 통해 prefab code, texture id, width, height, `u0/v0/u1/v1` 숫자만 전달한다.
- `SpriteRenderCommand` ABI는 바뀌지 않는다. 기존 `texture_id`와 `u0/v0/u1/v1` 필드를 그대로 사용한다.

## Game Spec Tilemap 계약

`ShooterGameSpec.tilemap`은 정적 tile layer 렌더링과 단순 collision layer 설정이다. `tilemap.tiles`는 positive integer string tile id를 atlas frame과 tint color에 연결하고, `tilemap.layers`는 row-major `data`로 tile id를 배치한다. `0`은 빈 타일로 예약되어 layer data에서만 사용할 수 있다.

TypeScript 검증 범위:

- `tilemap.tiles.*.frame`은 `atlas.frames`에 존재해야 한다.
- `tilemap.tiles.*.color`는 `[r,g,b,a]` 형태의 `0..1` 숫자 네 개여야 한다.
- `tilemap.layers.*.columns/rows`는 positive integer여야 한다.
- `tilemap.layers.*.collision`은 boolean이어야 하며 생략하면 `false`다.
- `tilemap.layers.*.data` 길이는 `columns * rows`와 같아야 한다.
- `tilemap.layers.*.data`의 positive tile id는 `tilemap.tiles`에 존재해야 한다.

Runtime 적용 범위:

- `applyShooterGameSpec(...)`는 먼저 `clear_shooter_tilemap()`을 호출한 뒤 `set_shooter_tile(...)`로 tile definition을, `set_shooter_tilemap_layer(...)`로 collision flag와 layer data `Uint32Array`를 전달한다.
- Rust `Tilemap`은 entity를 만들지 않고 기존 `SpriteRenderCommand` buffer 앞쪽에 static tile command를 추가한다.
- `collision: true` layer의 양수 tile은 Rust에서 player/enemy 이동을 막는 정적 AABB 장애물로 사용한다. pathfinding과 bullet-wall 충돌은 이 계약에 포함하지 않는다.

## Game Spec Wave 계약

`ShooterGameSpec.enemies.presets`와 `ShooterGameSpec.enemies.waves`는 TypeScript가 이름과 수치를 검증한다. `ResolvedShooterWave`는 `enemy`, `duration`, `spawnInterval`, `enemyCount`, `enemySpeed`, `enemyBehaviorCode`, `enemySpawnPatternCode`, `enemyHealth`, `scoreReward`를 포함한다.

Runtime 적용 범위:

- `applyShooterGameSpec(...)`는 먼저 `clear_shooter_waves()`를 호출한 뒤 resolved wave마다 `set_shooter_wave(...)`를 호출한다.
- Rust에는 enemy preset name이나 raw JSON을 전달하지 않는다.
- Rust `ShooterScene`이 active wave, elapsed time, spawn count, spawn timer를 소유한다.

## Audio 계약

`ShooterGameSpec.audio.masterVolume`과 `audio.sfxVolume`은 `AssetHost.configureAudio(...)`를 통해 platform audio bus에 적용된다. `audio.events.shoot/hit/gameOver`의 volume과 pitch는 `set_shooter_audio_policy(...)`로 Rust에 전달되어 `AudioEvent` buffer에 기록된다.

`AudioManager.unlock()`은 user gesture 이후 `AudioContext.resume()`을 명시적으로 시도하고 성공 여부를 boolean으로 반환한다. Top-down Shooter 예제는 첫 key/pointer 입력에서 `BrowserPlatformHost.unlockAudio()`를 호출한다.

## FrameState 정책

`FrameState`는 렌더러, HUD, DebugOverlay가 읽는 frame snapshot이다.

권장 경로:

- `renderCommandBuffer`: 기본 렌더링 경로다. 매 프레임 Wasm memory에서 새 `Float32Array` view로 만든다.
- `audioEvents`: `createEngine` 내부에서 asset host로 전달해 재생한 뒤 같은 frame에 관측할 수 있는 이벤트 배열이다.
- `score`, `entityCount`, `gameState`, `spriteCount`, `cameraX`, `cameraY`: HUD와 debug 표시용 snapshot이다.

주의:

- `FrameState` 값을 다음 프레임의 게임 로직 입력으로 사용하지 않는다.
- `renderCommandBuffer.buffer` view를 장기 보관하지 않는다. Wasm memory가 grow되면 기존 view가 무효가 될 수 있다.

## Deprecated API 정책

`FrameState.renderCommands`는 deprecated compatibility path다.

현재 정책:

- 기본값은 빈 배열이다.
- object 배열이 필요한 기존 코드만 `createEngine(..., { includeDeprecatedRenderCommands: true })`로 명시적으로 켠다.
- 이 옵션을 켜면 매 프레임 command object 배열 decode가 발생하므로 hot path에서 권장하지 않는다.
- 신규 코드는 반드시 `FrameState.renderCommandBuffer`를 사용한다.
- 제거 시점은 별도 migration 문서와 changelog가 준비된 뒤 결정한다. `v0.2`에서는 기본 비활성 정책을 유지한다.

## 오류 진단 정책

Asset, audio, Game Spec 오류 메시지는 사람이 바로 원인을 추적할 수 있도록 공통 context를 포함한다.

공통 형식:

- asset/audio: `kind`, `name` 또는 `id`, `url`, `detail`
- Game Spec: `kind=game-spec`, `path`, `detail`

예:

```text
Asset load error: kind=texture name='player' url='/assets/player.png' detail='HTTP 404 Not Found'.
Invalid shooter game spec: kind=game-spec path='weapons.cooldown' detail='must be a positive finite number'.
```

## Lifecycle 정책

브라우저 reload, HMR, 예제 재시작, bootstrap 실패 경로에서 cleanup을 반복 호출해도 안전해야 한다.

- `FerrumEngine.destroy()`는 `GameLoop`를 멈추고 Rust/Wasm `Engine.free()`를 한 번만 호출한다. 중복 호출은 no-op이다.
- `WebGL2Renderer.destroy()`는 `SpriteBatch` buffer/program과 `TextureManager` texture를 한 번만 해제한다. 중복 호출은 no-op이다.
- `BrowserPlatformHost.destroy()`는 내부 `AudioManager.destroy()`를 한 번만 호출한다.
- `AudioManager.destroy()`는 loaded buffer registry를 비우고 열린 `AudioContext`를 한 번만 close 요청한다.
- `InputManager.destroy()`는 window/canvas event listener를 제거한다. 제거 후 들어오는 이벤트는 input state를 바꾸지 않는다.
- `DebugOverlay.destroy()`는 DOM node를 제거하고 이후 `update(...)` 호출을 무시한다.

`destroy()` 이후 객체는 active runtime에 재사용하지 않는다. 새 게임 세션이나 reload 흐름에서는 `WebGL2Renderer`, `BrowserPlatformHost`, `InputManager`, `DebugOverlay`, `FerrumEngine`을 새로 만든다.

## 기본 사용 예시

```ts
import {
  BrowserPlatformHost,
  InputManager,
  WebGL2Renderer,
  createEngine,
  type AssetManifest,
  type FrameHandler,
  type ShooterGameSpec,
} from "@ferrum2d/ferrum-web";

const canvas = document.querySelector("canvas");
if (!canvas) {
  throw new Error("canvas element is required");
}

const renderer = new WebGL2Renderer(canvas);
const platformHost = new BrowserPlatformHost(renderer);
const input = new InputManager(canvas);

const onFrame: FrameHandler = (frame) => {
  renderer.render();
  const stats = renderer.renderCommands(frame.renderCommandBuffer);
  console.log(frame.score, stats.drawCalls);
};

const engine = await createEngine(
  onFrame,
  () => input.snapshot(),
  platformHost,
  () => {
    renderer.resize();
    return renderer.viewportSize();
  },
);

const assets: AssetManifest = {
  textures: {
    player: "/assets/player.png",
    enemy: "/assets/enemy.png",
    bullet: "/assets/bullet.png",
  },
  sounds: {
    shoot: "/assets/shoot.wav",
    hit: "/assets/hit.wav",
    gameOver: "/assets/game-over.wav",
  },
  json: {
    game: "/game.json",
  },
};

const loaded = await engine.loadAssets(assets);
engine.setTextureIds({
  player: loaded.textures.textureId("player"),
  enemy: loaded.textures.textureId("enemy"),
  bullet: loaded.textures.textureId("bullet"),
});
engine.setSoundIds({
  shoot: loaded.sounds.soundId("shoot"),
  hit: loaded.sounds.soundId("hit"),
  gameOver: loaded.sounds.soundId("gameOver"),
});
engine.setGameSpec(loaded.json.game as ShooterGameSpec);
engine.start();
```

## API 변경 규칙

- public type이나 method를 제거하려면 먼저 deprecated 기간과 migration 경로를 문서화한다.
- `SpriteRenderCommand`, `AudioEvent`, `RenderCommandBufferView`, `AudioEventView`의 ABI나 필드 의미가 바뀌면 Rust export, TypeScript decoder, 문서, 테스트를 함께 수정한다.
- public API 변경 후에는 `pnpm test:web`을 실행한다.
- Wasm boundary 변경이 포함되면 `pnpm build`와 Rust 테스트도 실행한다.
