# Ferrum2D 문서 지도

이 디렉터리의 문서는 역할별로 나누고, 같은 내용을 여러 파일에 길게 반복하지 않는다. 코드와 문서가 충돌할 때는 아래 기준 소스를 먼저 확인한다.

## 읽는 순서

| 문서 | 역할 |
| --- | --- |
| [사용자 설명서](user-guide.md) | 예제 실행, 조작, Game Spec 수정 흐름을 빠르게 안내한다. |
| [아키텍처](architecture.md) | Rust core, Wasm 경계, TypeScript platform layer, WebGL2 renderer 책임을 고정한다. |
| [Public API](public-api.md) | `@ferrum2d/ferrum-web` entrypoint에서 import 가능한 계약과 deprecated 호환 정책을 정리한다. |
| [Game Spec](game-spec.md) | `examples/topdown-shooter/public/game.json` 구조, 필드, 기본값, 검증 규칙의 상세 기준이다. |
| [Physics v2 범위](physics-v2.md) | post-MVP 물리 고도화의 포함/제외 범위, 실행 예제, 검증 기준이다. |
| [MVP 범위](mvp.md) | 현재 MVP 포함/제외 범위와 완료 기준을 정리한다. |
| [Smoke Check](smoke-check.md) | 자동 검증, CI 검증, 브라우저 수동 검증의 관계를 설명한다. |
| [Top-down Shooter 수동 체크리스트](topdown-shooter-smoke-checklist.md) | 브라우저에서 실제 예제를 점검할 때 쓰는 상세 체크리스트다. |
| [로드맵](roadmap.md) | 완료된 마일스톤과 다음 후보 작업을 추적한다. |
| [고도화 개발 계획](advanced-development-plan.md) | 로드맵 항목의 실행 순서와 완료 기준을 자세히 기록한다. |
| [Agent Workflow](agent-workflow.md) | AI agent와 subagent 작업 순서, 역할, 검증 기준을 정리한다. |
| [Agent Review Checklist](agent-review-checklist.md) | agent 변경 후 확인할 항목을 체크리스트로 제공한다. |
| [코드 리뷰 기준](code_review.md) | MVP 범위에서 리뷰할 아키텍처, 테스트, 문서 기준이다. |
| [스크린샷 README](screenshots/README.md) | README preview 스크린샷 갱신 절차다. |

## 기준 소스

| 내용 | 기준 소스 |
| --- | --- |
| package entrypoint export | `packages/ferrum-web/src/index.ts` |
| renderer/debug stats 필드 | `packages/ferrum-web/src/renderer.ts`, `packages/ferrum-web/src/debugOverlay.ts` |
| Game Spec 타입과 기본값 | `packages/ferrum-web/src/gameSpec.ts` |
| Game Spec 구조 보조 JSON Schema | `schemas/shooter-game-spec.schema.json` |
| 실제 Top-down Shooter 설정 | `examples/topdown-shooter/public/game.json` |
| Rust/Wasm ABI | `crates/ferrum-core/src/render_command.rs`, `crates/ferrum-core/src/audio_event.rs`, `packages/ferrum-web/src/wasmBridge.ts` |
| 검증 스크립트 | 루트 `package.json`, `.github/workflows/ci.yml` |

`schemas/shooter-game-spec.schema.json`은 편집기 자동완성과 구조 검토를 돕는 보조 기준이다. 런타임과 CLI에서 실제로 적용되는 기본값, preset 해석, 교차 필드 검증의 최종 기준은 `packages/ferrum-web/src/gameSpec.ts`의 `resolveShooterGameSpec(...)`이다.

## 중복 방지 규칙

- Game Spec의 필드별 상세 설명은 [Game Spec](game-spec.md)에 둔다. 다른 문서는 예시와 링크만 유지한다.
- 자동/CI 검증 정책은 [Smoke Check](smoke-check.md)에 둔다. 브라우저 수동 점검 항목은 [Top-down Shooter 수동 체크리스트](topdown-shooter-smoke-checklist.md)에 둔다.
- public import 계약은 [Public API](public-api.md)에 둔다. 아키텍처 문서는 책임 경계와 데이터 흐름만 설명한다.
- 완료 상태와 계획은 [MVP 범위](mvp.md), [로드맵](roadmap.md), [고도화 개발 계획](advanced-development-plan.md) 중 하나에만 상세하게 기록하고, 다른 문서는 링크로 연결한다.
