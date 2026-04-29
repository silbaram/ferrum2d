# Ferrum2D

Ferrum2D는 **Rust + WebAssembly + TypeScript + WebGL2** 기반의 2D 웹 게임 엔진 프로젝트다.

## 현재 상태

현재 저장소는 **AABB + Render Command 기술 데모를 완료했고, Top-down Shooter MVP를 진행 중**이다.

포함된 구성:

- Rust `World`가 transform/sprite/velocity/collider 기반 Vec store를 관리
- `AabbCollider`, `CollisionPair`, `CollisionSystem` 구현
- O(n²) broad phase 기반 trigger collision pair 생성
- bullet vs enemy 충돌 시 trigger event 기반 제거 처리
- Rust에서 render command 생성, TypeScript에서 typed array로 소비
- 키보드/마우스 입력 수집 및 게임 루프 반영

## Command Buffer ABI 주의사항

`SpriteRenderCommand`는 Rust에서 `#[repr(C)]`로 선언되어 C ABI 레이아웃을 강제한다.
현재 포맷은 `f32` 12개(총 48 bytes, align 4)이며, TypeScript는 동일 순서로 `Float32Array`를 해석한다.
필드 순서/타입/정렬이 바뀌면 Rust export(`sprite_render_command_floats/bytes`)와 TypeScript 해석 코드(상수/검증/뷰)를 반드시 함께 수정해야 한다.
`FrameState`는 호환성을 위해 객체 배열(`renderCommands`)도 제공하지만, hot path에서는 typed view(`renderCommandBuffer`) 사용을 권장한다.

## 좌표계 기준 (DPR 포함)

- 현재 게임 월드 좌표, Rust render command, InputManager mouse 좌표는 **CSS logical pixel 기준**이다.
- WebGL2 렌더러는 내부 drawing buffer(`canvas.width/height`)에만 DPR을 반영하고, shader `u_resolution`은 CSS logical pixel을 사용한다.

## 빌드

```bash
pnpm install
pnpm build
```

세부 단계로 실행하려면:

```bash
pnpm build:wasm
pnpm build:web
```

## 실행

예제 개발 서버 실행:

```bash
pnpm --filter @ferrum2d/topdown-shooter dev
```

통합 체크(빌드 + Rust 테스트):

```bash
pnpm check
```

## 예제에서 확인할 항목

- W/A/S/D로 player sprite 이동
- 마우스 입력 반영 및 디버그 오버레이 정보 확인
- 초기 프레임 기준 **61개 sprite(플레이어 1 + 적 60)** 렌더링

> 참고: 기존 문서의 "100개 sprite" 표현은 현재 코드(`Engine::new()`) 기준과 불일치하며, 필요 시 별도 작업으로 스폰 수를 조정한다.


## CI 검증 (GitHub Actions)

`main` 브랜치 push와 `main` 대상 PR에서 아래 항목을 자동 검증한다.

- Ubuntu latest(`ubuntu-latest`)
- Rust stable + `wasm32-unknown-unknown` target
- `wasm-pack` 설치 및 Wasm 빌드
- Node.js 22 + pnpm 10.8.0
- `pnpm install`
- `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
- `wasm-pack build crates/ferrum-core --target web --out-dir ../../packages/ferrum-web/pkg`
- `pnpm build`

로컬에서 CI와 동일한 순서로 실행하려면:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
corepack enable
corepack prepare pnpm@10.8.0 --activate
pnpm install
cargo test --manifest-path crates/ferrum-core/Cargo.toml
wasm-pack build crates/ferrum-core --target web --out-dir ../../packages/ferrum-web/pkg
pnpm build
```

## DPR 수동 검증 방법

1. 예제 실행: `pnpm --filter @ferrum2d/topdown-shooter dev`
2. 브라우저에서 `http://localhost:5173` 접속 후 플레이어 sprite와 마우스 위치 오버레이를 확인한다.
3. DPR 1 환경(일반 디스플레이 또는 브라우저 zoom 100%)에서 이동/조준 시 sprite 위치/크기가 자연스러운지 확인한다.
4. DPR 2 환경(레티나 디스플레이 또는 DevTools device emulation)에서 동일하게 이동/조준 시 sprite 위치/크기가 동일 체감으로 유지되는지 확인한다.
5. debug overlay의 drawCalls/batchCount/spriteCount가 프레임별 렌더 상태와 일치하는지 확인한다.
