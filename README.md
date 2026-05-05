# Ferrum2D

Ferrum2D는 Rust core, WebAssembly, TypeScript 플랫폼 레이어, WebGL2 렌더러로 구성한 2D 웹 게임 엔진 MVP다.

현재 저장소는 `v0.1.0` MVP 릴리스 준비 상태이며, 포함된 예제는 `examples/topdown-shooter` 하나다. 이 예제는 플레이어 이동, 마우스 조준 발사, 적 스폰, 충돌, 점수, 게임 오버, 재시작, 에셋 로딩, 효과음, 디버그 오버레이를 검증한다.

![Top-down Shooter MVP preview](docs/screenshots/topdown-shooter-title.png)

위 이미지는 MVP 화면 구성을 보여주는 릴리스 preview다. 실제 브라우저 캡처를 갱신할 때는 [docs/screenshots/README.md](docs/screenshots/README.md)를 따른다.

## 현재 구현된 것

- Rust `World` 기반 entity, transform, velocity, sprite, collider 저장
- AABB 충돌 판정과 bullet/enemy, player/enemy 충돌 처리
- Title, Playing, GameOver scene state
- Top-down Shooter 전용 `ShooterScene`과 Engine orchestration 분리
- W/A/S/D 이동, 마우스 위치 기준 발사 방향 계산
- Mouse Left 또는 Space 발사, Space 재시작
- player-follow 2D camera와 viewport size 전달
- 주기적 enemy spawn과 player chase
- JSON Game Spec 기반 world/player/enemy/weapon/prefab/behavior 조정
- Rust render command buffer 생성, TypeScript typed array 소비
- WebGL2 sprite renderer와 texture_id 기반 draw
- `loadAssets()` 기반 texture, sound, JSON manifest 로딩
- Rust `AudioEvent` buffer와 TypeScript Web Audio 효과음 재생
- DOM 기반 DebugOverlay와 FPS/frame/update/render/mouse/camera/score/entity/renderer stats 표시
- Rust unit test와 TypeScript Node test runner 기반 최소 회귀 테스트

## MVP에서 하지 않는 것

- WebGPU 렌더러
- Web Worker 또는 Wasm threads
- 3D 렌더링
- 에디터
- 멀티플레이어
- 복잡한 물리 엔진
- IndexedDB asset cache
- texture atlas 자동 생성
- spatial audio, BGM, 복잡한 mixer

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

권장 릴리스 전 검증:

```bash
cargo test --manifest-path crates/ferrum-core/Cargo.toml
pnpm test
pnpm build
```

현재 TypeScript 테스트는 Node 내장 test runner를 사용하며 `GameLoop`, `InputManager`, asset manifest parsing, render command parsing을 검증한다. WebGL2 실제 렌더링은 자동 e2e 범위에서 제외하고 예제 실행 후 manual smoke check로 확인한다.

## 프로젝트 구조

```text
crates/ferrum-core/          Rust core, shooter scene, game state, collision, render/audio command
packages/ferrum-web/        TypeScript platform layer, WasmBridge, WebGL2 renderer
examples/topdown-shooter/   MVP 샘플 게임
docs/                       아키텍처, MVP 범위, 로드맵, 리뷰 기준
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

Rust는 texture URL이나 WebGL 객체를 알지 않고 numeric `texture_id`만 render command에 기록한다. TypeScript `TextureManager`는 `texture_id`와 `WebGLTexture`를 매핑한다. 사운드도 같은 방식으로 Rust가 `sound_id` 기반 `AudioEvent`만 만들고 TypeScript `AudioManager`가 Web Audio로 재생한다.

Top-down Shooter 예제는 `json.game`을 Game Spec으로 해석한다. TypeScript가 JSON을 검증하고 기본값을 채운 뒤 Rust `Engine.set_shooter_resolved_config(...)`에 숫자형 설정만 한 번에 전달한다. `ferrum-web`의 `loadAssets()`는 asset을 로드만 하며, 예제가 texture/sound id와 Game Spec 적용을 명시적으로 수행한다.

프레임 렌더링에서는 `FrameState.renderCommandBuffer`를 사용한다. `FrameState.renderCommands`는 호환성 유지용 deprecated API이며 기본값으로는 빈 배열을 반환한다. command object 배열이 꼭 필요한 기존 코드는 `createEngine(..., { includeDeprecatedRenderCommands: true })`로 명시적으로 켤 수 있다.

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
    "scoreReward": 1
  },
  "weapons": { "bulletSpeed": 360, "cooldown": 0.12, "lifetime": 1.8, "damage": 1 },
  "prefabs": {
    "player": { "width": 36, "height": 36 },
    "enemy": { "width": 24, "height": 24 },
    "bullet": { "width": 8, "height": 8 }
  }
}
```

## Buffer ABI

`SpriteRenderCommand`는 Rust에서 `#[repr(C)]`로 선언되어 C ABI 레이아웃을 강제한다. 현재 포맷은 `f32` 13개, 총 52 bytes이며 TypeScript는 동일 순서의 `Float32Array`로 해석한다.

`AudioEvent`도 `#[repr(C)]`이며 현재 포맷은 `f32` 3개, 총 12 bytes다. 필드 순서는 `sound_id`, `volume`, `pitch`다.

필드 순서, 타입, 정렬이 바뀌면 Rust export와 TypeScript ABI 검증 및 decoder를 함께 수정해야 한다.

## 문서

- [사용자 설명서](docs/user-guide.md)
- [아키텍처](docs/architecture.md)
- [MVP 범위](docs/mvp.md)
- [Game Spec](docs/game-spec.md)
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
- `pnpm build`

로컬에서는 CI 명령에 더해 `pnpm test`와 `pnpm lint`를 함께 실행하는 것을 권장한다.
