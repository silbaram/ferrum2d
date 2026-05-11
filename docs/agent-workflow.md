# Agent Workflow

Ferrum2D에서 AI agent와 subagent는 코드 변경보다 데이터 변경을 우선한다. Top-down Shooter 변형은 `game.json`과 Game Spec 검증 흐름을 통해 만든다.

## 역할

| 역할 | 소유 파일 | 책임 |
| --- | --- | --- |
| `game-designer` | `examples/topdown-shooter/public/*.json` | Game Spec tuning, variant 생성 |
| `schema-agent` | `docs/game-spec.md`, `schemas/*`, `packages/ferrum-web/src/gameSpec.ts` | spec 구조, 검증 규칙, schema 동기화 |
| `engine-worker` | `crates/ferrum-core/src/*`, `packages/ferrum-web/src/*` | 새 preset/API가 필요할 때 최소 엔진 변경 |
| `qa-agent` | 변경 없음 | 검증 명령 실행과 실패 원인 보고 |
| `docs-agent` | `README.md`, `docs/*` | public API, workflow, MVP 문서 동기화 |

동시에 작업할 때는 한 파일을 한 역할만 소유한다. 같은 파일을 여러 subagent가 병렬 수정하지 않는다.

## 기본 순서

1. `game-designer`가 Game Spec 또는 variant를 만든다.
2. `qa-agent`가 `pnpm validate:game-spec`를 실행한다.
3. spec 구조가 부족하면 `schema-agent`가 검증기와 schema를 갱신한다.
4. Rust 동작이 부족하면 `engine-worker`가 preset enum과 Wasm API를 추가한다.
5. `docs-agent`가 README와 docs를 동기화한다.
6. `qa-agent`가 최종 검증을 실행한다.

## 권장 검증

데이터만 바꾼 경우:

```bash
pnpm validate:game-spec
```

TypeScript 검증기를 바꾼 경우:

```bash
pnpm lint
pnpm test:web
```

Rust behavior/API를 바꾼 경우:

```bash
cargo fmt --manifest-path crates/ferrum-core/Cargo.toml
cargo clippy --manifest-path crates/ferrum-core/Cargo.toml -- -D warnings
cargo test --manifest-path crates/ferrum-core/Cargo.toml
pnpm build
```

릴리스 또는 큰 변경 전:

```bash
pnpm validate:game-spec
pnpm lint
pnpm test
pnpm build
```

## 금지 범위

MVP/Phase 10 stabilization 계열 작업에서는 다음을 subagent에게 맡기지 않는다.

- WebGPU 구현
- Worker/멀티스레딩
- editor
- multiplayer
- scripting/plugin runtime
- complex physics
- Rust에서 DOM/WebGL/Web Audio 직접 호출

## 결과 보고

각 agent는 다음을 짧게 보고한다.

- 변경 파일
- 변경 이유
- 실행한 검증 명령
- 실패 또는 미실행 명령과 사유
- 남은 리스크
