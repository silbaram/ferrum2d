# Ferrum2D 고도화 개발 계획

이 문서는 `v0.1.0` MVP 개발 완료 이후의 고도화 작업을 실제 진행 순서대로 정리한다. 기준일은 2026-05-17이며, 새 기능보다 안정화와 확장 기반을 먼저 고정한다.

## 목표

- MVP 수직 슬라이스를 깨지 않고 public API와 실행 품질을 안정화한다.
- Rust core와 TypeScript platform layer의 책임 경계를 유지한다.
- 다음 기능이 추가될 때마다 Game Spec, 문서, 테스트가 함께 따라가도록 작업 단위를 작게 유지한다.
- WebGPU, Worker, editor, multiplayer, complex physics는 별도 설계 전까지 제외한다.

## 진행 원칙

- 한 작업은 한 가지 논리적 변경만 포함한다.
- hot path에서 entity별 JS/Wasm 왕복 호출을 만들지 않는다.
- Game Spec 확장은 TypeScript에서 JSON/name 검증과 numeric id 해석을 끝낸 뒤 Rust에는 숫자형 설정만 전달한다.
- Rust는 게임 상태, 충돌, 카메라 계산, render/audio command 생성을 담당한다.
- TypeScript는 브라우저 API, asset/audio loading, renderer, input, debug UI를 담당한다.
- public API나 구조가 바뀌면 `README.md`, `docs/architecture.md`, 관련 세부 문서를 함께 갱신한다.

## v0.2 안정화 순서

v0.2는 다음 기능 개발을 위한 기반 안정화 단계다. 기능 욕심보다 API, 오류 진단, lifecycle, 검증 자동화를 먼저 고정한다.

### 1. Public API 정리

상태: 완료

목표:

- `FerrumEngine`, `FrameState`, `Renderer`, `RendererStats`, `AssetManifest`, `ShooterGameSpec`의 권장 사용 경로를 명확히 한다.
- deprecated `FrameState.renderCommands` 호환 경로의 유지 범위와 제거 조건을 문서화한다.
- README의 public API 예시를 현재 코드와 맞춘다.

완료 기준:

- public API 표가 `docs/architecture.md` 또는 별도 API 문서에 정리되어 있다.
- deprecated API는 "기본 비활성, 옵션으로만 활성" 정책이 문서화되어 있다.
- `pnpm test:web` 통과.

### 2. Asset/Error 진단 표준화

상태: 완료

목표:

- texture, sound, JSON, Game Spec 검증 실패 메시지 형식을 통일한다.
- 오류 메시지에 asset kind, name, URL, 원인 detail을 포함한다.
- 누락된 texture/sound id를 예제 적용 단계에서 명확히 보고한다.

완료 기준:

- `AssetLoader`, `AudioManager`, Game Spec validator의 주요 실패 케이스가 테스트에 포함되어 있다.
- 예제 실행 중 asset 적용 실패 원인을 console 또는 HUD에서 추적할 수 있다.
- `pnpm test:web` 통과.

### 3. Lifecycle Cleanup 재점검

상태: 완료

목표:

- `InputManager.destroy()`, `DebugOverlay.destroy()`, `WebGL2Renderer.destroy()`, `AudioManager.destroy()`, `FerrumEngine.destroy()`가 중복 호출되어도 안전한지 확인한다.
- page unload, dev reload, 예제 재시작 흐름에서 listener/resource가 남지 않도록 한다.

완료 기준:

- destroy 계열 메서드의 중복 호출 테스트 또는 명시적 smoke 절차가 있다.
- WebGL buffer/program/texture, AudioContext, DOM node, event listener 정리 책임이 문서화되어 있다.
- `pnpm test:web` 통과.

완료 내용:

- `FerrumEngine`, `WebGL2Renderer`, `SpriteBatch`, `TextureManager`, `AudioManager`, `BrowserPlatformHost`, `InputManager`, `DebugOverlay`의 `destroy()` 중복 호출을 no-op으로 정리했다.
- `InputManager`, `DebugOverlay`, `BrowserPlatformHost`, `AudioManager`는 Node 테스트로 cleanup idempotency를 고정했다.
- WebGL/Wasm resource 정리 책임은 `docs/architecture.md`와 `docs/public-api.md`에 문서화했다.

### 4. Debug/Renderer Stats 이름 고정

상태: 완료

목표:

- FPS, frame time, Rust update time, render time, entity count, sprite count, render command count, draw calls, batches, texture binds/switches, audio events/s의 표시명과 단위를 고정한다.
- `RendererStats` 필드 의미가 `WebGL2Renderer.stats()`와 DebugOverlay에서 일치하도록 문서화한다.

완료 기준:

- stats naming 표가 문서화되어 있다.
- renderer stats 테스트가 현재 의미를 고정한다.
- DebugOverlay 출력 항목이 문서와 일치한다.

완료 내용:

- `DEBUG_OVERLAY_ROW_CONTRACT`와 `formatDebugOverlayMetrics(...)`로 DebugOverlay 표시명, 순서, 단위를 고정했다.
- `RENDERER_STATS_FIELD_CONTRACT`와 renderer stats 테스트로 `RendererStats` 필드 표시명과 단위를 고정했다.
- `docs/architecture.md`와 `docs/public-api.md`에 stats 계약 표를 추가했다.

### 5. Smoke Check 자동화 기반

상태: 완료

목표:

- 기존 `pnpm build`, `pnpm test`, `pnpm validate:game-spec` 외에 예제 build sanity check를 정리한다.
- WebGL2 실제 렌더링은 manual smoke로 유지하되 체크리스트를 고정한다.
- 가능하면 headless-friendly render command sanity test를 추가한다.

완료 기준:

- `docs/screenshots/README.md` 또는 새 smoke 문서에 수동 확인 절차가 정리되어 있다.
- CI와 로컬 권장 검증 명령의 차이가 문서화되어 있다.
- `cargo test --manifest-path crates/ferrum-core/Cargo.toml`, `pnpm test`, `pnpm build`, `pnpm validate:game-spec` 통과.

완료 내용:

- `pnpm smoke:check`를 추가해 lint, test, Game Spec validation, production build sanity check를 한 번에 실행할 수 있게 했다.
- `docs/smoke-check.md`에 CI/로컬 검증 차이, Top-down Shooter 수동 smoke checklist, 실패 기록 형식을 정리했다.
- `docs/screenshots/README.md`를 smoke checklist와 연결했다.

## v0.3 기능 고도화 순서

v0.3은 사용자가 바로 체감할 수 있는 기능과 콘텐츠 제작 기반을 추가한다. 순서는 카메라, atlas metadata, wave spec 순으로 진행한다.

### 1. Camera Preset

상태: 완료

목표:

- 기존 player-follow 카메라를 preset 기반으로 일반화한다.
- 우선 범위는 follow, dead-zone, look-ahead, time-based shake다.
- 카메라 계산은 Rust core가 담당하고 TypeScript는 viewport 전달과 renderer 적용만 담당한다.

완료 기준:

- Game Spec 또는 별도 config에서 camera preset을 설정할 수 있다.
- Top-down Shooter 예제에 최소 하나의 preset이 적용된다.
- camera unit test와 manual smoke check가 있다.
- Rust/TS 경계에서 카메라 관련 entity별 호출이 없다.

완료 내용:

- Rust `Camera2D`에 follow, dead-zone, look-ahead, time-based shake preset을 추가했다.
- Game Spec `camera` 필드를 추가하고 TypeScript 검증 후 `set_shooter_camera_preset(...)`로 numeric code와 수치만 Rust에 전달한다.
- Top-down Shooter 예제 `game.json`에 `look-ahead` camera preset을 적용했다.
- Rust camera/engine 테스트와 TypeScript Game Spec 성공/실패 테스트를 추가했다.

### 2. Texture Atlas Metadata

상태: 완료

목표:

- texture name/id, frame name, UV rect, frame size를 표현하는 metadata 포맷을 설계한다.
- 기존 horizontal sprite sheet animation과 충돌하지 않는 방식으로 atlas frame을 해석한다.
- TypeScript가 JSON/name 검증과 id 해석을 담당하고 Rust는 숫자형 UV/frame 설정을 받는다.

완료 기준:

- atlas metadata 예시 JSON과 검증 경로가 있다.
- player/enemy/bullet 중 최소 하나가 atlas metadata를 통해 frame을 설정한다.
- render command ABI는 불필요하게 변경하지 않는다.
- `pnpm validate:game-spec` 또는 별도 atlas 검증 명령이 있다.

완료 내용:

- Game Spec `atlas.frames`와 `prefabs.*.frame`을 추가해 frame name, texture name/id, normalized UV rect, frame size를 검증한다.
- TypeScript가 texture name을 `AssetHost.textureId(name)`으로 해석한 뒤 Rust `set_shooter_atlas_frame(...)`에 numeric texture id와 UV/size만 전달한다.
- Rust `EntityTemplate`에 static `SpriteFrame`을 추가하고 player/enemy/bullet prefab별 atlas frame 적용을 지원한다.
- Top-down Shooter 예제 `game.json`의 bullet이 `bullet.default` atlas frame을 사용한다.
- render command ABI는 변경하지 않고 기존 `texture_id`, `u0/v0/u1/v1` 필드를 사용한다.

### 3. Spawn/Wave Spec

목표:

- 현재 수치 중심 Game Spec을 spawn table, wave timeline, enemy preset까지 확장한다.
- Top-down Shooter를 더 게임답게 만들되, 범용 scene graph나 editor는 도입하지 않는다.
- Rust는 wave 진행 상태와 spawn 실행을 소유한다.

완료 기준:

- enemy preset, spawn interval, wave duration, wave enemy count를 data-driven으로 설정할 수 있다.
- Game Spec 검증 실패 메시지가 필드 path를 포함한다.
- wave 진행 테스트와 예제 manual smoke check가 있다.

### 4. Audio UX 개선

목표:

- browser audio unlock UX와 volume/pitch 정책을 명확히 한다.
- 효과음 중복 재생, game over sound, hit/shoot sound의 volume 기본값을 문서화한다.

완료 기준:

- AudioManager 동작 정책이 문서화되어 있다.
- user gesture 전후 audio 동작이 manual smoke checklist에 포함된다.

## v0.4+ 기반 확장 순서

v0.4 이후는 콘텐츠 제작 기반 위에 런타임 기능을 보강한다. 이 단계에서도 editor, multiplayer, WebGPU는 별도 설계 전까지 제외한다.

### 1. Tilemap Runtime v1

범위:

- 정적 tile layer 렌더링
- tile id -> UV 매핑
- collision layer의 AABB 변환

비범위:

- 내장 editor
- 자동 타일링
- isometric/hex tilemap
- per-tile script

### 2. Lightweight Navigation Grid

범위:

- 2D grid A*
- obstacle layer 연동
- 적이 장애물을 우회해 player를 추적하는 예제

비범위:

- navmesh
- crowd simulation
- 연속 공간 회피
- 복잡한 steering

### 3. Extension Point 문서화

범위:

- Rust-side init/update hook 후보 정리
- TypeScript platform lifecycle hook 후보 정리
- bulk-buffer render-prep extension 후보 정리

제약:

- TypeScript simulation update hook은 금지한다.
- hot path에서 entity별 JS/Wasm 호출을 만들지 않는다.

## 당장 시작할 작업 큐

다음 순서로 진행한다.

1. `v0.2-1-public-api`: public API 표와 deprecated API 정책 정리 (완료)
2. `v0.2-2-error-diagnostics`: asset/audio/Game Spec 오류 메시지 표준화 (완료)
3. `v0.2-3-lifecycle-cleanup`: destroy/resource cleanup 점검 (완료)
4. `v0.2-4-stats-contract`: DebugOverlay/RendererStats 이름과 단위 고정 (완료)
5. `v0.2-5-smoke-check`: smoke checklist와 build sanity 검증 정리 (완료)
6. `v0.3-1-camera-preset`: camera preset 설계와 Top-down Shooter 적용 (완료)
7. `v0.3-2-atlas-metadata`: texture atlas metadata 설계와 적용 (완료)
8. `v0.3-3-wave-spec`: spawn/wave spec 확장
9. `v0.3-4-audio-ux`: audio unlock/volume 정책 정리

각 작업을 시작하기 전에 해당 항목의 목표와 완료 기준을 먼저 확인하고, 범위를 넘는 기능은 다음 작업으로 분리한다.

## 공통 검증 명령

변경 성격에 따라 다음 검증을 실행한다.

문서만 바꾼 경우:

```bash
git diff --check
```

Game Spec 또는 TypeScript platform layer를 바꾼 경우:

```bash
pnpm lint
pnpm test:web
pnpm validate:game-spec
```

Rust/Wasm boundary 또는 Rust core를 바꾼 경우:

```bash
cargo fmt --manifest-path crates/ferrum-core/Cargo.toml
cargo clippy --manifest-path crates/ferrum-core/Cargo.toml -- -D warnings
cargo test --manifest-path crates/ferrum-core/Cargo.toml
pnpm build
```

릴리스 후보 또는 milestone 종료 시:

```bash
cargo test --manifest-path crates/ferrum-core/Cargo.toml
pnpm test
pnpm build
pnpm validate:game-spec
```
