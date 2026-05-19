# Ferrum2D Smoke Check

이 문서는 `v0.2` 안정화 이후 릴리스 후보나 큰 변경 후 실행할 smoke check 기준을 고정한다. 자동 검증은 빠른 회귀 확인을 담당하고, WebGL2 실제 렌더링/입력/오디오는 브라우저 수동 확인으로 보완한다.

## 로컬 자동 sanity check

권장 명령:

```bash
pnpm smoke:check
```

이 명령은 다음 순서로 실행한다.

1. `pnpm lint`
2. `pnpm test`
3. `pnpm validate:game-spec`
4. `pnpm build`

`pnpm smoke:check`는 WebGL2 실제 화면, 키보드/마우스 입력, 브라우저 오디오 unlock 상태를 확인하지 않는다. 이 항목은 아래 수동 smoke check에서 확인한다.

Rust 코드나 Rust/Wasm 경계를 바꾼 경우에는 `pnpm smoke:check`와 별도로 다음을 실행한다.

```bash
cargo fmt --manifest-path crates/ferrum-core/Cargo.toml --check
cargo clippy --manifest-path crates/ferrum-core/Cargo.toml -- -D warnings
```

## CI와 로컬 검증 차이

GitHub Actions CI는 main push/PR에서 headless 환경으로 실행된다.

현재 CI 기준:

1. `pnpm install`
2. `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
3. `wasm-pack build crates/ferrum-core --target web --out-dir ../../packages/ferrum-web/pkg`
4. `pnpm lint`
5. `pnpm test`
6. `pnpm build`

로컬 릴리스 후보 검증은 CI 명령에 더해 Game Spec 검증과 브라우저 수동 확인을 포함한다.

- `pnpm lint`로 TypeScript source/test type check를 확인한다.
- `pnpm test`로 TypeScript Node tests와 Rust tests를 모두 실행한다.
- `pnpm validate:game-spec`로 예제 `game.json`이 runtime validator와 같은 경로를 통과하는지 확인한다.
- `pnpm build`로 Wasm package와 Top-down Shooter production build를 확인한다.
- 브라우저 수동 smoke check로 WebGL2, 입력, 오디오, DebugOverlay 표시를 확인한다.

CI는 브라우저 실제 렌더링, 사용자 입력, Web Audio 재생, screenshot 갱신을 검증하지 않는다.

## Top-down Shooter 수동 smoke check

사전 조건:

- `pnpm install`이 완료되어 있어야 한다.
- `wasm-pack`과 Rust `wasm32-unknown-unknown` target이 설치되어 있어야 한다.
- WebGL2를 지원하는 브라우저에서 확인한다.

실행:

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/topdown-shooter dev
```

브라우저에서 Vite URL에 접속한 뒤 [Top-down Shooter 수동 체크리스트](topdown-shooter-smoke-checklist.md)를 따른다. 이 문서는 자동/CI/수동 검증의 관계만 유지하고, 실제 브라우저 확인 항목은 체크리스트 문서를 기준으로 한다.

## Screenshot 갱신

README preview용 스크린샷 절차는 [screenshots README](screenshots/README.md)를 따른다. smoke check에서 화면이 바뀐 것을 의도했다면 `docs/screenshots/topdown-shooter-title.png` 갱신 여부를 함께 판단한다.

## 실패 기록 형식

검증 실패가 있으면 작업 결과에 다음을 남긴다.

- 실패 명령 또는 수동 확인 항목
- 실패 원인
- 사용자 영향
- 후속 조치 또는 보류 사유
