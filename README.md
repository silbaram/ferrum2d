# Ferrum2D

Ferrum2D는 Rust core, WebAssembly, TypeScript 플랫폼 레이어, WebGL2 렌더러로 구성한 2D 웹 게임 엔진이다.

현재 package version은 `0.1.0`이지만, 기능 상태는 **MVP 개발 완료, 상용제품 기능 개발** 단계다. `examples/minimal-game`은 제품용 starter runtime 흐름을 보여주고, `examples/topdown-shooter`는 플레이어 이동, 마우스 조준 발사, 적 스폰과 wave, tilemap 장애물, collision layer 기반 navigation, 충돌, 점수, 게임 오버, 재시작, 에셋 로딩, 효과음, 디버그 오버레이를 검증한다. `examples/breakout`과 `examples/platformer`는 같은 runtime/API가 shooter 전용이 아님을 검증하는 장르 예제다.

![Top-down Shooter preview](docs/screenshots/topdown-shooter-title.png)

위 이미지는 Top-down Shooter 화면 구성을 보여주는 릴리스 preview다. 실제 브라우저 캡처를 갱신할 때는 [docs/screenshots/README.md](docs/screenshots/README.md)를 따른다.

## 현재 구현된 것

- Rust `World` 기반 entity, transform, velocity, sprite, collider 저장
- AABB 충돌 판정과 bullet/enemy, player/enemy 충돌 처리
- sweep-and-prune broadphase, collision filter, point/AABB/circle/shape/raycast/shape-cast/nearest body query, AABB/circle contact, swept AABB 기반 빠른 bullet/enemy 터널링 방지
- world collider와 tilemap obstacle 대상 swept AABB 기반 kinematic move-and-slide, entity one-way platform, moving platform carry, tilemap nearest obstacle query, platformer ground probe/controller, coyote time, jump buffering, step offset
- opt-in fixed timestep runtime, physics counters/API, collision event buffer with damage payload
- opt-in broadphase/contact physics debug line buffer/API와 WebGL2 debug line rendering
- Title, Playing, GameOver scene state
- Top-down Shooter 전용 `ShooterScene`과 Engine orchestration 분리
- `FerrumEngine.useBreakoutGame()` 기반 Breakout scene mode와 paddle/ball/brick/wall 충돌 예제
- `FerrumEngine.usePlatformerGame()` 기반 Platformer scene mode와 kinematic platformer controller 예제
- W/A/S/D 이동, 마우스 위치 기준 발사 방향 계산
- `InputManager`의 keyboard/mouse, touch fallback, non-mouse pointer drag gesture, gamepad stick/button snapshot 합성
- Mouse Left 또는 Space 발사, Space 재시작
- camera preset 기반 2D camera와 viewport size 전달
- enemy preset, wave timeline, spawn pattern, player chase
- JSON Game Spec 기반 world/player/enemy/weapon/prefab/behavior/camera/atlas frame/tilemap/audio 조정
- `collision: true` tilemap layer 기반 player/enemy merged AABB 장애물과 chase enemy Navigation Grid v1
- Horizontal sprite sheet와 idle/move state 기반 player/enemy/bullet sprite animation
- Rust render command buffer 생성, TypeScript typed array 소비
- WebGL2 sprite renderer와 texture_id 기반 draw
- `loadAssets()` 기반 texture, sound, JSON manifest 로딩
- Aseprite JSON metadata, Tiled JSON tilemap, LDtk JSON tilemap을 Game Spec 조각으로 변환하는 Asset pipeline v2 helper
- `FerrumDiagnosticError`와 `diagnosticReport()` 기반 asset/audio/Game Spec 오류 code/context 보고
- Rust `AudioEvent` buffer와 TypeScript Web Audio 효과음 재생
- `createFerrumRuntime()` 기반 browser runtime entrypoint
- `CreateEngineOptions.lifecycle` 기반 start/pause/resume/stop/destroy platform lifecycle hook
- `UiOverlay` 기반 DOM text/UI rendering과 runtime `uiState` HUD/menu/dialog 갱신 경로
- DOM 기반 DebugOverlay와 FPS/frame/update/render/mouse/camera/score/entity/render command/texture/audio/physics/collision event stats 표시
- WebGPU/Worker/IndexedDB/BGM/spatial audio compatibility shim은 deprecated no-op 또는 unsupported 경로로 제한
- Rust unit test, TypeScript Node test runner, Game Spec validation, GitHub Actions 기반 회귀 테스트
- Product Alpha 시작점인 `examples/minimal-game` starter 예제
- Product Beta 장르 검증용 `examples/breakout`, `examples/platformer` 예제

## 현재 제품 범위에서 하지 않는 것

- WebGPU 렌더러
- Web Worker 또는 Wasm threads
- 3D 렌더링
- 에디터
- 멀티플레이어
- 복잡한 물리 엔진
- IndexedDB asset cache
- texture atlas 자동 생성
- spatial audio, BGM, 복잡한 mixer

일부 제외 항목의 이전 public API 이름은 마이그레이션 리스크를 줄이기 위한 deprecated compatibility shim으로만 남아 있을 수 있다. 이 shim은 제품 런타임 기능을 제공하지 않으며, 기본 실행 경로는 WebGL2, requestAnimationFrame, SFX, 직접 asset loading으로 제한한다.

## 개발환경 설정

Ferrum2D는 Rust/Wasm core와 TypeScript web package를 함께 빌드한다. 따라서 Rust toolchain, Wasm target, wasm-pack, Node.js, pnpm이 모두 필요하다.

### 1. Rust stable과 rustup 준비

Rust는 `rustup`으로 설치한 toolchain을 사용하는 것을 권장한다. Homebrew로 설치한 `rustc`가 PATH에서 먼저 잡히면 `wasm32-unknown-unknown` target을 찾지 못해 `pnpm build`가 실패할 수 있다.

설치 또는 확인:

```bash
rustup --version
rustup default stable
rustup target add wasm32-unknown-unknown
```

현재 셸에서 어떤 Rust가 잡히는지 확인한다.

```bash
which rustc
rustup which rustc
rustup target list --installed
```

`which rustc`가 `/opt/homebrew/bin/rustc`처럼 Homebrew 경로를 가리키면 rustup proxy가 먼저 잡히도록 PATH를 조정한다. zsh를 사용한다면 다음 설정을 `~/.zshrc` 앞쪽에 둔다.

```bash
source "$HOME/.cargo/env"
```

현재 터미널에도 바로 반영한다.

```bash
source "$HOME/.cargo/env"
```

다시 확인했을 때 `which rustc`가 `$HOME/.cargo/bin/rustc` 또는 rustup 관리 경로를 가리키면 된다.

### 2. wasm-pack 설치

Wasm package 생성에는 `wasm-pack`이 필요하다.

```bash
cargo install wasm-pack
wasm-pack --version
```

이미 설치되어 있다면 `wasm-pack --version`만 확인하면 된다.

### 3. Node.js와 pnpm 준비

Node.js는 22 버전을 권장한다. Node.js 설치 후 Corepack으로 pnpm 10.8.0을 활성화한다.

```bash
node --version
corepack enable
corepack prepare pnpm@10.8.0 --activate
pnpm --version
```

`node --version`은 `v22.x.x`, `pnpm --version`은 `10.8.0`이면 된다.

### 4. 프로젝트 의존성 설치

저장소 루트에서 Node workspace 의존성을 설치한다.

```bash
pnpm install
```

### 5. 설정 검증

개발환경 설정이 끝나면 전체 테스트와 빌드를 실행한다.

```bash
pnpm test
pnpm build
```

`pnpm build`가 `wasm32-unknown-unknown target not found`로 실패하면 Rust code 문제가 아니라 PATH에서 rustup Rust가 아닌 다른 Rust가 먼저 잡힌 상태일 가능성이 높다. 이 경우 `which rustc`와 `rustup which rustc`를 다시 확인한다.

## 예제 실행

최소 starter 예제는 별도 asset 없이 engine loop와 WebGL2 render path를 확인한다.

```bash
pnpm dev:minimal
```

장르 검증 예제는 별도 asset 없이 같은 runtime/API 위에서 실행된다.

```bash
pnpm dev:breakout
pnpm dev:platformer
```

처음 실행하거나 Rust core를 수정한 뒤에는 Wasm package를 먼저 만든다.

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/topdown-shooter dev
```

Vite가 출력하는 로컬 URL을 브라우저에서 연다. 기본 포트라면 다음 주소다.

```text
http://localhost:5173
```

DebugOverlay를 숨기려면 URL에 `?debug=false`를 붙인다.

```text
http://localhost:5173?debug=false
```

## 조작법

- `Enter` 또는 `Space`: Title에서 게임 시작
- `W/A/S/D`: 플레이어 이동
- `Mouse Left` 또는 `Space`: 마우스 방향으로 발사
- `Space`: GameOver에서 재시작

## 빌드와 검증

전체 빌드:

```bash
pnpm build
```

Rust 테스트:

```bash
cargo test --manifest-path crates/ferrum-core/Cargo.toml
```

TypeScript 테스트:

```bash
pnpm test:web
```

전체 테스트:

```bash
pnpm test
```

로컬 smoke check:

```bash
pnpm smoke:check
```

브라우저 없이 Game Spec 적용 경로와 render command buffer 형태만 빠르게 확인하려면 headless smoke check를 실행한다.

```bash
pnpm smoke:headless
```

패키지 공개 후보의 entrypoint, 포함 파일, generated Wasm artifact, 실제 `pnpm pack` tarball 구성을 확인한다.

```bash
pnpm package:check
```

npm beta package 절차는 [docs/npm-release.md](docs/npm-release.md)에 고정한다. 실제 publish는 `private: true` 해제와 npm 권한 확인이 승인된 뒤 별도로 수행한다.

상용제품 기능 개발 기본 검증:

```bash
cargo test --manifest-path crates/ferrum-core/Cargo.toml
pnpm lint
pnpm test
pnpm validate:game-spec
pnpm smoke:headless
pnpm package:check
pnpm build
```

MVP 개발 완료 이후 상용제품 기능 개발 단계에서는 위 자동 검증과 Top-down Shooter manual smoke check를 회귀 기준으로 유지한다. 자세한 로컬/CI 검증 차이와 브라우저 수동 확인 절차는 [docs/smoke-check.md](docs/smoke-check.md)를 따른다.

현재 TypeScript 테스트는 Node 내장 test runner를 사용하며 `GameLoop`, `InputManager`, `AssetLoader`, Aseprite/Tiled/LDtk asset pipeline import, `BrowserPlatformHost`, `AudioManager`, diagnostic report, Game Spec validation/application, Wasm buffer decoder, collision event decoder, renderer stats, DebugOverlay, UiOverlay, public API type export, deprecated compatibility shim을 검증한다. WebGL2 실제 렌더링은 자동 e2e 범위에서 제외하고 예제 실행 후 manual smoke check로 확인한다.

Top-down Shooter 수동 점검 기준은 `docs/topdown-shooter-smoke-checklist.md`를 따른다.

## 프로젝트 구조

```text
crates/ferrum-core/          Rust core, shooter scene, game state, collision, render/audio command
packages/ferrum-web/        TypeScript platform layer, WasmBridge, WebGL2 renderer
examples/minimal-game/      Product Alpha starter 예제
examples/breakout/          Breakout 장르 검증 예제
examples/platformer/        Platformer controller 검증 예제
examples/topdown-shooter/   Top-down Shooter 검증 예제
docs/                       아키텍처, 완료된 MVP 기준, 제품 로드맵, 리뷰 기준
scripts/                    저장소 보조 스크립트
```

## Asset manifest 예시

```ts
await engine.loadAssets({
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
});
```

## Asset pipeline metadata 예시

Product Beta Asset pipeline v2의 현재 범위는 Aseprite JSON metadata, Tiled JSON tilemap, LDtk JSON tilemap을 Ferrum2D Game Spec 조각으로 변환하는 authoring helper다. 변환은 TypeScript에서만 수행하고 Rust/Wasm render command ABI는 바꾸지 않는다.

```ts
import { importAsepriteAtlasFrames, type ShooterGameSpec } from "@ferrum2d/ferrum-web";

const loaded = await engine.loadAssets({
  textures: { sprites: "/assets/sprites.png" },
  json: { sprites: "/assets/sprites.json" },
});
const gameSpec: ShooterGameSpec = {
  atlas: {
    frames: importAsepriteAtlasFrames(loaded.json.sprites, { texture: "sprites" }),
  },
  prefabs: {
    player: { frame: "player.idle.0" },
  },
};
```

Tiled orthogonal JSON map은 `atlas`와 `tilemap` Game Spec 조각으로 변환할 수 있다.

```ts
import { importTiledGameSpec } from "@ferrum2d/ferrum-web";

const tiled = importTiledGameSpec(loaded.json.map, {
  collisionLayerNames: ["walls"],
});
engine.setGameSpec({
  ...gameSpec,
  atlas: { frames: { ...gameSpec.atlas?.frames, ...tiled.atlas?.frames } },
  tilemap: tiled.tilemap,
});
```

LDtk project JSON도 embedded level의 Tiles/AutoLayer tile instances를 같은 `atlas`와 `tilemap` Game Spec 조각으로 변환할 수 있다.

```ts
import { importLDtkGameSpec } from "@ferrum2d/ferrum-web";

const ldtk = importLDtkGameSpec(loaded.json.world, {
  levelIdentifier: "Level_0",
  collisionLayerNames: ["walls"],
});
engine.setGameSpec({
  ...gameSpec,
  atlas: { frames: { ...gameSpec.atlas?.frames, ...ldtk.atlas?.frames } },
  tilemap: ldtk.tilemap,
});
```

## Public API 예시

브라우저 앱은 `@ferrum2d/ferrum-web` entrypoint에서 API를 import한다. `dist/*`, `pkg/*`, `src/*`, generated wasm-bindgen API는 public API로 취급하지 않는다.

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
if (!canvas) throw new Error("canvas element is required");

const renderer = new WebGL2Renderer(canvas);
const platformHost = new BrowserPlatformHost(renderer);
const input = new InputManager(canvas, {
  gamepad: true,
  pointerGestures: true,
});

const onFrame: FrameHandler = (frame) => {
  renderer.render();
  renderer.renderCommands(frame.renderCommandBuffer);
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

세부 API 계약은 [docs/public-api.md](docs/public-api.md)를 따른다.

Rust는 texture URL이나 WebGL 객체를 알지 않고 numeric `texture_id`만 render command에 기록한다. TypeScript `TextureManager`는 `texture_id`와 `WebGLTexture`를 매핑한다. 사운드도 같은 방식으로 Rust가 `sound_id` 기반 `AudioEvent`만 만들고 TypeScript `AudioManager`가 Web Audio로 재생한다.

Top-down Shooter 예제는 `json.game`을 Game Spec으로 해석한다. TypeScript가 JSON을 검증하고 기본값을 채운 뒤 Rust `Engine.set_shooter_resolved_config(...)`, `Engine.set_shooter_animations(...)`, `Engine.set_shooter_camera_preset(...)`, `Engine.set_shooter_atlas_frame(...)`, `Engine.set_shooter_tile(...)`, `Engine.set_shooter_tilemap_layer(...)`, `Engine.set_shooter_wave(...)`, `Engine.set_shooter_audio_policy(...)`에 숫자형 설정과 typed array를 전달한다. `prefabs.*.animation`은 horizontal sprite sheet의 frame count/fps 또는 `idle`/`move` state row를 설정하며, Rust가 매 프레임 UV를 갱신한다. `atlas.frames`와 `prefabs.*.frame`은 texture name/id, normalized UV rect, frame size를 검증해 static atlas frame을 prefab에 연결한다. `tilemap`은 atlas frame 기반 정적 tile layer를 렌더링 command로 추가하고, `collision: true` layer의 양수 tile은 player/enemy 이동을 막는 AABB 장애물이자 chase enemy navigation 장애물로 사용한다. `enemies.presets`와 `enemies.waves`는 wave timeline을 구성하고 Rust가 wave 진행과 spawn count를 소유한다. `enemies.orbit`은 orbit behavior의 목표 반경과 보정 폭을 숫자 설정으로 전달한다. `audio`는 Web Audio bus volume과 Rust audio event volume/pitch를 조정한다. `camera.preset`은 follow, dead-zone, look-ahead, shake를 지원하며 Rust가 카메라 위치를 계산한다.

프레임 렌더링에서는 `FrameState.renderCommandBuffer`를 사용한다. `FrameState.physics`는 fixed timestep/kinematic/collision event frame stats를 담고, `FrameState.collisionEventBuffer`는 collision enter/stay/exit/hit raw buffer를 제공한다. `decodeCollisionEvents(...)`가 만드는 `CollisionEventView.damage`는 bullet/enemy hit에 적용된 bullet damage이며, lifecycle event와 player/enemy game-over hit는 `0`이다. `FrameState.physicsDebugLineBuffer`는 broadphase AABB proxy bounds와 contact normal debug line raw buffer를 제공하지만, Rust line 생성은 `enablePhysicsDebugLines`, `includePhysicsDebugLines`, 또는 runtime의 `physicsDebugLines`를 켠 경우에만 수행한다. `WebGL2Renderer.renderPhysicsDebugLines(...)`와 `createFerrumRuntime(..., { physicsDebugLines: true })`는 이 buffer를 같은 frame의 debug line pass로 그린다. `FrameState.renderCommands`는 호환성 유지용 deprecated API이며 기본값으로는 빈 배열을 반환한다. command object 배열이 꼭 필요한 기존 코드는 `createEngine(..., { includeDeprecatedRenderCommands: true })`로 명시적으로 켤 수 있다.

Host 앱이 엔진 lifecycle과 platform side effect를 동기화해야 하면 `createEngine(..., { lifecycle })`에 `onStart`, `onPause`, `onResume`, `onStop`, `onDestroy` callback을 전달한다. 이 callback은 score/state/entity/sprite/time snapshot만 받으며 TypeScript simulation update hook으로 사용하지 않는다.

`WebGL2Renderer.stats()`는 draw call, batch, sprite, render command, texture bind, texture switch 수를 반환한다. Top-down Shooter 예제는 이 값과 초당 audio event 수, physics frame stats, collision event 수를 DebugOverlay에 표시한다. 표시명과 단위 계약은 [docs/architecture.md](docs/architecture.md)의 `DebugOverlay와 stats` 표를 따른다.

`createFerrumRuntime()`의 `ui`와 `uiState` 옵션은 canvas 위에 HUD/menu/dialog용 DOM overlay를 렌더링한다. Rust core는 여전히 UI DOM을 소유하지 않고, TypeScript가 같은 frame의 `FrameState`와 renderer stats를 읽어 `UiOverlayState`를 만든다.

종료 경로에서는 `engine.destroy()`, `input.destroy()`, `platformHost.destroy()`, `renderer.destroy()`를 호출한다. 이 `destroy()` 계열 메서드는 중복 호출되어도 no-op이며, 종료된 객체는 새 runtime에 재사용하지 않고 다시 생성한다.

예제 Game Spec 검증:

```bash
pnpm validate:game-spec
```

```json
{
  "world": { "width": 1600, "height": 960 },
  "player": { "speed": 180 },
  "enemies": {
    "speed": 72,
    "spawnInterval": 1.0,
    "behavior": "chase",
    "spawnPattern": "edge",
    "health": 1,
    "scoreReward": 1,
    "orbit": { "radius": 180, "radialBand": 24 },
    "presets": {
      "runner": { "speed": 96, "behavior": "chase", "health": 1, "scoreReward": 1 },
      "bruiser": { "speed": 54, "behavior": "drift", "spawnPattern": "corners", "health": 3, "scoreReward": 4 },
      "orbiter": { "speed": 84, "behavior": "orbit", "health": 2, "scoreReward": 3 }
    },
    "waves": [
      { "enemy": "runner", "duration": 18, "spawnInterval": 0.85, "enemyCount": 18 },
      { "enemy": "bruiser", "duration": 16, "spawnInterval": 1.25, "enemyCount": 10, "spawnPattern": "corners" },
      { "enemy": "orbiter", "duration": 18, "spawnInterval": 1.1, "enemyCount": 12 }
    ]
  },
  "weapons": { "bulletSpeed": 360, "cooldown": 0.12, "lifetime": 1.8, "damage": 1 },
  "prefabs": {
    "player": { "width": 36, "height": 36 },
    "enemy": { "width": 24, "height": 24 },
    "bullet": { "frame": "bullet.default" }
  },
  "atlas": {
    "frames": {
      "bullet.default": {
        "texture": "bullet",
        "uv": { "u0": 0, "v0": 0, "u1": 1, "v1": 1 },
        "size": { "width": 8, "height": 8 }
      },
      "tiles.floor": {
        "texture": 0,
        "uv": { "u0": 0, "v0": 0, "u1": 1, "v1": 1 },
        "size": { "width": 160, "height": 160 }
      },
      "tiles.block": {
        "texture": 0,
        "uv": { "u0": 0, "v0": 0, "u1": 1, "v1": 1 },
        "size": { "width": 160, "height": 160 }
      }
    }
  },
  "tilemap": {
    "tileWidth": 160,
    "tileHeight": 160,
    "tiles": {
      "1": { "frame": "tiles.floor", "color": [0.16, 0.22, 0.2, 0.42] },
      "4": { "frame": "tiles.block", "color": [0.42, 0.46, 0.5, 0.72] }
    },
    "layers": [
      { "name": "arena-floor", "columns": 2, "rows": 2, "data": [1, 1, 1, 1] },
      { "name": "arena-obstacles", "columns": 2, "rows": 2, "collision": true, "data": [0, 4, 0, 0] }
    ]
  },
  "camera": {
    "preset": "look-ahead",
    "lookAhead": { "distance": 96 },
    "deadZone": { "width": 160, "height": 96 },
    "shake": { "amplitude": 6, "frequency": 8 }
  },
  "audio": {
    "masterVolume": 1,
    "sfxVolume": 0.85,
    "events": {
      "shoot": { "volume": 0.28, "pitch": 1.05 },
      "hit": { "volume": 0.48, "pitch": 0.95 },
      "gameOver": { "volume": 0.7, "pitch": 0.8 }
    }
  }
}
```

## Buffer ABI

`SpriteRenderCommand`는 Rust에서 `#[repr(C)]`로 선언되어 C ABI 레이아웃을 강제한다. 현재 포맷은 `f32` 13개, 총 52 bytes이며 TypeScript는 동일 순서의 `Float32Array`로 해석한다.

`AudioEvent`도 `#[repr(C)]`이며 현재 포맷은 `f32` 3개, 총 12 bytes다. 필드 순서는 `sound_id`, `volume`, `pitch`다.

필드 순서, 타입, 정렬이 바뀌면 Rust export와 TypeScript ABI 검증 및 decoder를 함께 수정해야 한다.

## 문서

- [사용자 설명서](docs/user-guide.md)
- [문서 지도](docs/README.md)
- [아키텍처](docs/architecture.md)
- [완료된 MVP 기준](docs/mvp.md)
- [Game Spec](docs/game-spec.md)
- [Public API](docs/public-api.md)
- [Physics v2 범위](docs/physics-v2.md)
- [Physics v3 기반](docs/physics-v3.md)
- [고도화 개발 계획](docs/advanced-development-plan.md)
- [Agent workflow](docs/agent-workflow.md)
- [Agent review checklist](docs/agent-review-checklist.md)
- [로드맵](docs/roadmap.md)
- [코드 리뷰 기준](docs/code_review.md)
- [변경 기록](CHANGELOG.md)

## GitHub Actions

현재 CI는 `main` push와 `main` 대상 pull request에서 Rust stable, wasm target, wasm-pack, Node.js 22, pnpm 10.8.0을 준비한 뒤 다음을 실행한다.

- `pnpm install`
- `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
- `wasm-pack build crates/ferrum-core --target web --out-dir ../../packages/ferrum-web/pkg`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

로컬 릴리스 후보 검증에서는 CI 명령에 더해 `pnpm validate:game-spec`와 브라우저 수동 smoke check를 함께 실행하는 것을 권장한다.

## License

Ferrum2D는 `MIT OR Apache-2.0` 듀얼 라이선스로 배포한다. 자세한 내용은 [LICENSE](LICENSE)를 확인한다.
