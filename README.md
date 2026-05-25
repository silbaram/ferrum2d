# Ferrum2D

Ferrum2D는 Rust core, WebAssembly, TypeScript 플랫폼 레이어, WebGL2 기본 렌더러, 선택 WebGPU 렌더러로 구성한 2D 웹 게임 엔진이다.

현재 package version은 `0.1.0`이지만, 기능 상태는 **MVP 개발 완료, 상용제품 기능 개발** 단계다. `examples/minimal-game`은 제품용 starter runtime 흐름을 보여주고, `examples/topdown-shooter`, `examples/breakout`, `examples/platformer`, `examples/physics-sandbox`는 같은 runtime/API가 여러 장르와 물리 authoring 흐름에서 동작하는지 검증한다.

Ferrum2D의 제품 목표는 기존 게임 엔진처럼 비주얼 에디터를 중심에 두는 것이 아니라, AI agent가 Game Spec, Physics Spec, 프로젝트 템플릿, 검증 스크립트를 사용해 게임을 생성하고 수정하는 **AI agent-first 2D game engine**을 만드는 것이다.

![Top-down Shooter preview](docs/development/quality/screenshots/topdown-shooter-title.png)

위 이미지는 Top-down Shooter 화면 구성을 보여주는 릴리스 preview다. 실제 브라우저 캡처를 갱신할 때는 [docs/development/quality/screenshots/README.md](docs/development/quality/screenshots/README.md)를 따른다.

## 현재 구현 요약

- **Core runtime**
  Rust `World`와 TypeScript `createFerrumRuntime()` 기반으로 scene, entity, input, audio, renderer, UI/debug overlay를 실행한다.
- **Render command buffer**
  Rust가 렌더 명령을 숫자 buffer로 만들고 TypeScript renderer가 GPU API로 그린다.
- **2D rendering**
  WebGL2를 기본 renderer로 사용하고, 지원 환경에서는 선택 WebGPU renderer를 사용할 수 있다.
- **Game Spec authoring**
  JSON Game Spec, Aseprite/Tiled/LDtk import helper, atlas/tilemap/animation/prefab 설정을 제공한다.
- **AI agent authoring**
  AI agent가 spec, template, validation, smoke check를 반복하며 게임을 개발할 수 있도록 agent/skill 설치 패키지를 제공한다.
- **Scenes and examples**
  Minimal starter, Top-down Shooter, Breakout, Platformer, Physics Sandbox 예제가 같은 runtime/API 위에서 동작한다.
- **2D physics**
  kinematic controller, rigid body solver, collider/query/cast/contact/manifold, CCD, joint constraint, debug line을 제공한다.
- **Physics tooling**
  Physics Spec, snapshot/restore/replay, Worker replay, body state buffer, PixelMaskTerrain runtime을 제공한다.
- **Platform UX**
  InputManager, AssetLoader, AudioManager, UiOverlay, DebugOverlay, diagnostic report를 제공한다.
- **Packaging**
  runtime package, create-game CLI, AI agent/skill installer package와 package/release 검증 스크립트를 제공한다.

세부 기능과 API 계약은 [Public API](docs/engine/public-api.md), [2D 물리엔진 기능 맵](docs/development/architecture/physics-engine.md), [Top-down Shooter Game Spec](docs/engine/topdown-shooter-game-spec.md)을 기준으로 한다.

## 현재 제품 범위에서 하지 않는 것

- 3D 렌더링
- 전체 게임 루프의 Web Worker 이전
- Wasm threads / SharedArrayBuffer 기본 빌드
- Full visual editor 중심 개발 방식
- 멀티플레이어
- user scripting/plugin runtime
- skeletal animation
- soft body, cloth, fluid 같은 complex physics core 확장
- IndexedDB asset cache
- production texture atlas 자동 packing
- spatial audio, BGM, 복잡한 mixer

일부 제외 항목의 이전 public API 이름은 마이그레이션 리스크를 줄이기 위한 deprecated compatibility shim으로만 남아 있을 수 있다. 이 shim은 제품 런타임 기능을 제공하지 않으며, 기본 실행 경로는 WebGL2/WebGPU renderer, requestAnimationFrame, SFX, 직접 asset loading으로 제한한다.

## npm 패키지 구성

Ferrum2D npm 배포 단위는 역할별로 분리한다.

| package | 역할 |
| --- | --- |
| `@ferrum2d/ferrum-web` | 게임 실행에 필요한 엔진 런타임 본체 |
| `@ferrum2d/create-game` | 새 Ferrum2D 게임 프로젝트 생성 CLI |
| `@ferrum2d/agents` | AI로 Ferrum2D 게임을 개발할 때 사용하는 consumer agent/skill/command 설치 CLI |

새 게임 프로젝트는 다음 흐름으로 만든다.

```bash
npm create @ferrum2d/game my-game
cd my-game
npm install
npm run dev
```

AI agent/skill은 명시적으로 설치한다. `npm install @ferrum2d/ferrum-web`만으로 사용자 프로젝트의 `.agents`, `.codex`, `.claude`, `.gemini` 파일을 변경하지 않는다.

```bash
npx @ferrum2d/agents init --tools codex,claude,gemini
```

## 개발환경 설정

Ferrum2D는 Rust/Wasm core와 TypeScript web package를 함께 빌드한다. Rust toolchain, Wasm target, wasm-pack, Node.js, pnpm이 모두 필요하다.

Rust stable과 Wasm target을 준비한다.

```bash
rustup default stable
rustup target add wasm32-unknown-unknown
```

Wasm package 생성에는 `wasm-pack`이 필요하다.

```bash
cargo install wasm-pack
wasm-pack --version
```

Node.js는 22 버전을 권장한다. Corepack으로 pnpm 10.8.0을 활성화한다.

```bash
node --version
corepack enable
corepack prepare pnpm@10.8.0 --activate
pnpm --version
```

저장소 루트에서 workspace 의존성을 설치한다.

```bash
pnpm install
```

설정이 끝나면 기본 검증을 실행한다.

```bash
pnpm test
pnpm build
```

`pnpm build`가 `wasm32-unknown-unknown target not found`로 실패하면 PATH에서 rustup Rust가 아닌 다른 Rust가 먼저 잡힌 상태일 수 있다. 이 경우 `which rustc`, `rustup which rustc`, `rustup target list --installed`를 확인한다.

## 예제 실행

최소 starter 예제는 별도 asset 없이 engine loop와 WebGL2 render path를 확인한다.

```bash
pnpm dev:minimal
```

장르 검증 예제는 같은 runtime/API 위에서 실행된다.

```bash
pnpm dev:breakout
pnpm dev:platformer
```

Physics Spec 기반 generic rigid body sandbox는 다음으로 실행한다.

```bash
pnpm dev:physics-sandbox
```

Top-down Shooter 예제는 Rust core를 수정했거나 처음 실행하는 경우 Wasm package를 먼저 만든다.

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/topdown-shooter dev
```

기본 Vite URL은 다음과 같다.

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

Game Spec 검증과 smoke check:

```bash
pnpm validate:game-spec
pnpm smoke:headless
pnpm smoke:check
```

패키지와 릴리스 후보 검증:

```bash
pnpm package:check
pnpm release:check
```

GitHub Pages demo/docs artifact 생성:

```bash
pnpm build
pnpm build:pages
```

상용제품 기능 개발 기본 검증:

```bash
cargo test --manifest-path crates/ferrum-core/Cargo.toml
pnpm lint
pnpm test
pnpm validate:game-spec
pnpm smoke:headless
pnpm package:check
pnpm release:check
pnpm build
```

수동 smoke check 기준은 [Top-down Shooter 체크리스트](docs/development/quality/topdown-shooter-smoke-checklist.md)와 [Smoke Check 문서](docs/development/quality/smoke-check.md)를 따른다.

## 프로젝트 구조

```text
crates/ferrum-core/          Rust core, scenes, game state, collision/physics, render/audio command
packages/ferrum-web/        TypeScript platform layer, WasmBridge, WebGL2/WebGPU renderer
packages/create-game/       npm create용 게임 프로젝트 생성 CLI
packages/agents/            consumer game development용 AI agent/skill 설치 CLI
examples/minimal-game/      Product Alpha starter 예제
examples/breakout/          Breakout 장르 검증 예제
examples/platformer/        Platformer controller 검증 예제
examples/topdown-shooter/   Top-down Shooter 검증 예제
examples/physics-sandbox/   Physics Spec authoring/debug 검증 예제
docs/                       engine 설명과 development 기준 문서
scripts/                    저장소 보조 스크립트
```

## 상세 문서

- [문서 지도](docs/README.md)
- Engine: [사용자 설명서](docs/engine/user-guide.md), [Public API](docs/engine/public-api.md), [Top-down Shooter Game Spec](docs/engine/topdown-shooter-game-spec.md), [Physics Spec](docs/engine/physics-spec.md)
- Development Architecture: [아키텍처](docs/development/architecture/architecture.md), [2D 물리엔진 기능 맵](docs/development/architecture/physics-engine.md)
- Development Quality: [코드 리뷰 기준](docs/development/quality/code-review.md), [Smoke Check](docs/development/quality/smoke-check.md)
- Development Operations: [GitHub Pages 배포](docs/development/operations/demo-deploy.md), [npm 베타 패키징](docs/development/operations/npm-release.md), [릴리스 노트 템플릿](docs/development/operations/release-notes-template.md)
- [변경 기록](CHANGELOG.md)

## GitHub Actions

현재 CI는 `main` push와 `main` 대상 pull request에서 Rust stable, wasm target, wasm-pack, Node.js 22, pnpm 10.8.0을 준비한 뒤 다음을 실행한다.

- `pnpm install`
- `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
- `wasm-pack build crates/ferrum-core --target web --out-dir ../../packages/ferrum-web/pkg`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

로컬 릴리스 후보 검증에서는 CI 명령에 더해 `pnpm validate:game-spec`와 브라우저 수동 smoke check를 함께 실행하는 것을 권장한다. 실제 npm publish는 `private: true` 해제와 npm 권한 확인이 승인된 뒤 별도로 수행한다.

## License

Ferrum2D는 `MIT OR Apache-2.0` 듀얼 라이선스로 배포한다. 자세한 내용은 [LICENSE](LICENSE)를 확인한다.
