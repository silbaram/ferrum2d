# Agent Review Checklist

AI agent 또는 subagent가 Ferrum2D 변경을 마친 뒤 확인할 항목이다.

## Game Spec 변경

- `examples/topdown-shooter/public/game.json` 또는 variant JSON이 유효한 JSON인가?
- 모든 숫자 필드가 positive finite number인가?
- `enemies.behavior`가 `chase`, `drift`, `static` 중 하나인가?
- `enemies.spawnPattern`이 `edge`, `corners`, `center` 중 하나인가?
- `enemies.health`, `weapons.damage`가 positive number인가?
- `enemies.scoreReward`가 positive integer인가?
- `pnpm validate:game-spec`를 실행했는가?
- 의도한 난이도 변화가 문서나 응답에 설명되었는가?

## Schema/Validator 변경

- `docs/game-spec.md`가 새 필드를 설명하는가?
- `schemas/shooter-game-spec.schema.json`가 새 필드를 반영하는가?
- `packages/ferrum-web/src/gameSpec.ts`가 기본값, 검증, 에러 메시지를 제공하는가?
- `packages/ferrum-web/test/gameSpec.test.ts`에 성공/실패 케이스가 있는가?
- `pnpm lint`와 `pnpm test:web`이 통과했는가?

## Rust/Wasm 변경

- Rust가 원본 JSON/string object를 받지 않는가?
- Wasm API가 프레임 hot path에서 entity별 호출을 만들지 않는가?
- `packages/ferrum-web/src/wasm.d.ts`와 generated `packages/ferrum-web/pkg/ferrum_core.d.ts`가 동기화되었는가?
- `cargo fmt`, `cargo clippy`, `cargo test`가 통과했는가?
- Wasm 변경 후 `pnpm build`가 통과했는가?

## 문서 변경

- README에 사용자-facing 사용법이 있는가?
- `docs/architecture.md`가 Rust/TS 경계를 설명하는가?
- `docs/mvp.md`가 구현 상태와 검증 명령을 반영하는가?
- MVP 금지 범위(WebGPU, Worker, editor, multiplayer 등)를 위반하지 않았는가?

## 최종 보고

- 변경 파일 요약
- 각 변경의 이유
- 실행한 명령 목록과 결과
- 실행하지 못한 명령과 사유
- 리스크 또는 후속 작업
