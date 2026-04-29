# Ferrum2D

Ferrum2D는 Rust core, WebAssembly, TypeScript 플랫폼 레이어, WebGL2 렌더러로 구성한 2D 웹 게임 엔진 MVP다.

현재 저장소는 `v0.1.0` MVP 릴리스 준비 상태이며, 포함된 예제는 `examples/topdown-shooter` 하나다. 이 예제는 플레이어 이동, 마우스 조준 발사, 적 스폰, 충돌, 점수, 게임 오버, 재시작, 에셋 로딩, 효과음, 디버그 오버레이를 검증한다.

![Top-down Shooter MVP preview](docs/screenshots/topdown-shooter-title.png)

위 이미지는 MVP 화면 구성을 보여주는 릴리스 preview다. 실제 브라우저 캡처를 갱신할 때는 [docs/screenshots/README.md](docs/screenshots/README.md)를 따른다.

## 현재 구현된 것

- Rust `World` 기반 entity, transform, velocity, sprite, collider 저장
- AABB 충돌 판정과 bullet/enemy, player/enemy 충돌 처리
- Title, Playing, GameOver scene state
- W/A/S/D 이동, 마우스 위치 기준 발사 방향 계산
- Mouse Left 또는 Space 발사, Space 재시작
- 주기적 enemy spawn과 player chase
- Rust render command buffer 생성, TypeScript typed array 소비
- WebGL2 sprite renderer와 texture_id 기반 draw
- `loadAssets()` 기반 texture, sound, JSON manifest 로딩
- Rust `AudioEvent` buffer와 TypeScript Web Audio 효과음 재생
- DOM 기반 DebugOverlay와 FPS/frame/update/render/mouse/score/entity/renderer stats 표시
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

## 요구 환경

- Rust stable
- `wasm32-unknown-unknown` target
- `wasm-pack`
- Node.js 22 권장
- pnpm 10.8.0
- WebGL2를 지원하는 최신 브라우저

초기 설정:

```bash
corepack enable
corepack prepare pnpm@10.8.0 --activate
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
pnpm install
```

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
crates/ferrum-core/          Rust core, game state, collision, render/audio command
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
});
```

Rust는 texture URL이나 WebGL 객체를 알지 않고 numeric `texture_id`만 render command에 기록한다. TypeScript `TextureManager`는 `texture_id`와 `WebGLTexture`를 매핑한다. 사운드도 같은 방식으로 Rust가 `sound_id` 기반 `AudioEvent`만 만들고 TypeScript `AudioManager`가 Web Audio로 재생한다.

## Buffer ABI

`SpriteRenderCommand`는 Rust에서 `#[repr(C)]`로 선언되어 C ABI 레이아웃을 강제한다. 현재 포맷은 `f32` 13개, 총 52 bytes이며 TypeScript는 동일 순서의 `Float32Array`로 해석한다.

`AudioEvent`도 `#[repr(C)]`이며 현재 포맷은 `f32` 3개, 총 12 bytes다. 필드 순서는 `sound_id`, `volume`, `pitch`다.

필드 순서, 타입, 정렬이 바뀌면 Rust export와 TypeScript ABI 검증 및 decoder를 함께 수정해야 한다.

## 문서

- [아키텍처](docs/architecture.md)
- [MVP 범위](docs/mvp.md)
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
