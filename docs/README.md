# Ferrum2D 문서 지도

이 디렉터리의 문서는 역할별로 나누고, 같은 내용을 여러 파일에 길게 반복하지 않는다. 코드와 문서가 충돌할 때는 아래 기준 소스를 먼저 확인한다.

Ferrum2D의 제품 목표는 비주얼 에디터 중심 엔진이 아니라 AI agent-first 2D game engine이다. 문서는 사람이 읽는 설명과 함께 AI agent가 Game Spec, Physics Spec, template, validation, smoke check를 안전하게 수정할 수 있는 기준 소스 역할을 한다.

## 큰 구분

| 디렉터리 | 역할 | 주요 문서 |
| --- | --- | --- |
| `engine/` | 엔진 사용자와 AI agent가 읽는 게임엔진 설명, 사용법, public contract | [개발자 퀵스타트](engine/developer-quickstart.md), [사용자 설명서](engine/user-guide.md), [Public API](engine/public-api.md), [Runtime Extensibility](engine/runtime-extensibility.md), [Data Scene Authoring](engine/data-scene-authoring.md), [Physics Spec](engine/physics-spec.md) |
| `examples/` | 공식 예제별 authoring contract와 예제 전용 설명 | [Top-down Shooter Game Spec](examples/topdown-shooter/game-spec.md) |
| `development/` | 엔진 개발, agent authoring 품질 검증, 배포 운영을 위한 내부 기준 | [아키텍처](development/architecture/architecture.md), [2D 물리엔진 기능 맵](development/architecture/physics-engine.md), [Smoke Check](development/quality/smoke-check.md), [npm 베타 패키징](development/operations/npm-release.md) |
| `planning/` | 신규 기능 후보와 승인 필요 기능을 관리하는 planning 영역 | [Planning 문서](planning/README.md) |

## Pages 홈 노출 기준

GitHub Pages 홈은 새 사용자와 AI agent가 핵심 문서를 2단계 이내로 찾는 것을 기준으로 한다. `scripts/build/build-pages.mjs`는 다음 문서를 홈 카드와 docs navigation 상단에 노출한다.

| 진입점 | 기준 문서 | 목적 |
| --- | --- | --- |
| Quickstart | [개발자 퀵스타트](engine/developer-quickstart.md) | 새 프로젝트 생성과 agent-first 개발 루프 시작 |
| Public API | [Public API](engine/public-api.md) | import 가능 API, 지원 수준, 목적별 reference 확인 |
| Authoring | [Data Scene Authoring](engine/data-scene-authoring.md) | generic scene composition과 behavior recipe 계약 확인 |
| Examples | [Top-down Shooter Game Spec](examples/topdown-shooter/game-spec.md) | 공식 예제 Game Spec 필드와 검증 규칙 확인 |
| Smoke/Budget | [Smoke Check](development/quality/smoke-check.md) | 자동, browser, runtime budget 검증 기준 확인 |
| Release | [npm 베타 패키징](development/operations/npm-release.md) | beta package, changelog, tag, publish gate 확인 |

## development 하위 구조

| 디렉터리 | 역할 | 주요 문서 |
| --- | --- | --- |
| `development/architecture/` | Rust core, Wasm boundary, Web platform layer, physics 구현 기준 | [아키텍처](development/architecture/architecture.md), [2D 물리엔진 기능 맵](development/architecture/physics-engine.md) |
| `development/quality/` | 테스트, smoke check, 리뷰 기준, 스크린샷 갱신 | [Smoke Check](development/quality/smoke-check.md), [Top-down Shooter 수동 체크리스트](development/quality/topdown-shooter-smoke-checklist.md), [코드 리뷰 기준](development/quality/code-review.md), [스크린샷 README](development/quality/screenshots/README.md) |
| `development/operations/` | 배포, 패키징, 릴리스 운영 절차 | [GitHub Pages 데모/문서 배포](development/operations/demo-deploy.md), [npm 패키지 구성 전략](development/operations/npm-package-strategy.md), [npm 베타 패키징](development/operations/npm-release.md), [릴리스 노트 템플릿](development/operations/release-notes-template.md) |

## 읽는 순서

1. 엔진을 처음 이해하고 새 프로젝트를 시작하는 경우: [개발자 퀵스타트](engine/developer-quickstart.md) -> [사용자 설명서](engine/user-guide.md) -> [Public API](engine/public-api.md)
2. Top-down Shooter 예제 설정을 바꾸는 경우: [Top-down Shooter Game Spec](examples/topdown-shooter/game-spec.md)
3. projectile/weapon/prefab/motion/reaction/effect 같은 범용 runtime 확장 기능을 확인하는 경우: [Runtime Extensibility](engine/runtime-extensibility.md) -> [Data Scene Authoring](engine/data-scene-authoring.md) -> [Public API](engine/public-api.md)
4. 엔진 구조나 경계를 확인하는 경우: [아키텍처](development/architecture/architecture.md) -> [2D 물리엔진 기능 맵](development/architecture/physics-engine.md)
5. 검증이나 릴리스 작업을 하는 경우: [Smoke Check](development/quality/smoke-check.md) -> [npm 베타 패키징](development/operations/npm-release.md) -> [릴리스 노트 템플릿](development/operations/release-notes-template.md)
6. Physics Spec 계약을 확인하는 경우: [Physics Spec](engine/physics-spec.md) -> [Public API](engine/public-api.md)
7. 신규 기능 후보와 승인 필요 항목을 확인하는 경우: [Planning 문서](planning/README.md) -> [신규 기능 후보](planning/feature-candidates.md)

## 기준 소스

| 내용 | 기준 소스 |
| --- | --- |
| package entrypoint export와 API tier | `packages/ferrum-web/src/index.ts`, `docs/engine/public-api-surface.json`, `scripts/validate/check-public-api-surface.mjs` |
| renderer/debug stats 필드 | `packages/ferrum-web/src/renderer.ts`, `packages/ferrum-web/src/debugOverlay.ts` |
| Asset pipeline helper | `packages/ferrum-web/src/assetPipeline.ts`, `packages/ferrum-web/src/assetPipeline*.ts` |
| Game Spec 타입과 기본값 | `packages/ferrum-web/src/gameSpec.ts`, `packages/ferrum-web/src/gameSpec*.ts` |
| Data Scene authoring 계약 | `packages/ferrum-web/src/sceneAuthoringDocument.ts`, `packages/ferrum-web/src/sceneComposition.ts`, `packages/ferrum-web/src/behaviorRecipes.ts`, `docs/engine/samples/data-scene-minimum.scene-authoring.json` |
| Game Spec 구조 보조 JSON Schema | `schemas/shooter-game-spec.schema.json` |
| AI agent/skill 배포 템플릿과 showcase | `packages/agents/README.md`, `packages/agents/templates/**` |
| 실제 Top-down Shooter 설정 | `examples/topdown-shooter/public/game.json` |
| Rust/Wasm ABI | `crates/ferrum-core/src/render_command.rs`, `crates/ferrum-core/src/audio_event.rs`, `packages/ferrum-web/src/wasmBridge.ts` |
| npm package 역할 분리 | `packages/ferrum-web/package.json`, `packages/create-game/package.json`, `packages/agents/package.json`, `docs/development/operations/npm-package-strategy.md` |
| package/release artifact 검증 | `scripts/package/check-package-files.mjs`, `scripts/package/check-create-game-package.mjs`, `scripts/package/check-agents-package.mjs`, `scripts/package/check-release-readiness.mjs`, `scripts/package/check-release-candidate.mjs`, `packages/*/package.json`, `CHANGELOG.md`, `.github/release.yml` |
| 검증/배포/문서 사이트 스크립트 | 루트 `package.json`, `scripts/build/build-pages.mjs`, `scripts/validate/**`, `tests/smoke/**`, `.github/workflows/ci.yml`, `.github/workflows/pages.yml` |
| 문서 링크와 Pages 산출물 검증 | `scripts/validate/check-docs-pages.mjs`, `pnpm validate:docs-links`, `pnpm validate:pages-artifact` |
| runtime budget 제품 기준 | `docs/development/quality/smoke-check.md`, `tests/smoke/runtime-budget-profiles.mjs`, `tests/smoke/browser-render-smoke.mjs`, `scripts/validate/check-runtime-budget-productization.mjs` |

`schemas/shooter-game-spec.schema.json`은 편집기 자동완성과 구조 검토를 돕는 보조 기준이다. 런타임과 CLI에서 실제로 적용되는 기본값, preset 해석, 교차 필드 검증의 최종 기준은 `packages/ferrum-web/src/gameSpec.ts`의 `resolveShooterGameSpec(...)`이다.

## 문서/Pages 검증

문서만 바뀐 경우 기본 검증은 다음 순서로 실행한다.

```bash
pnpm validate:docs-links
pnpm build:pages
pnpm validate:pages-artifact
```

`pnpm validate:docs-links`는 `docs/**/*.md`의 내부 Markdown 링크와 heading anchor를 검사한다. `pnpm validate:pages-artifact`는 `dist-pages/` 생성 후 Pages 홈, docs index, quickstart, public API, authoring, examples, smoke, release, demo route HTML과 generated HTML의 로컬 링크를 검사한다. `dist-pages/`는 generated artifact이므로 git에 포함하지 않는다.

## 중복 방지 규칙

- Top-down Shooter 예제 설정의 필드별 상세 설명은 [Top-down Shooter Game Spec](examples/topdown-shooter/game-spec.md)에 둔다. 다른 문서는 예시와 링크만 유지한다.
- 자동/CI 검증 정책은 [Smoke Check](development/quality/smoke-check.md)에 둔다. 브라우저 수동 점검 항목은 [Top-down Shooter 수동 체크리스트](development/quality/topdown-shooter-smoke-checklist.md)에 둔다.
- public import 계약은 [Public API](engine/public-api.md)에 둔다. 목적별 세부 reference는 `engine/public-api/*.md`에 나누고, API tier와 import allowlist의 machine-readable 기준은 [Public API surface manifest](engine/public-api-surface.json)에 둔다. 아키텍처 문서는 책임 경계와 데이터 흐름만 설명한다.
- projectile/weapon/prefab/motion/query/reaction/effect event 같은 런타임 확장성 기능의 제품 기준 요약은 [Runtime Extensibility](engine/runtime-extensibility.md)에 둔다. Data Scene 최소 authoring envelope와 generic fixture 기준은 [Data Scene Authoring](engine/data-scene-authoring.md)에 둔다. 세부 import/export 목록은 [Public API](engine/public-api.md)가 기준이다.
- npm package 역할 분리는 [npm 패키지 구성 전략](development/operations/npm-package-strategy.md)에 둔다. `@ferrum2d/ferrum-web` beta package와 release tag 검증 절차는 [npm 베타 패키징](development/operations/npm-release.md)에 둔다. GitHub Release 본문 구조는 [릴리스 노트 템플릿](development/operations/release-notes-template.md)에 둔다. 다른 문서는 `pnpm package:check`, `pnpm release:check`, `pnpm release:candidate-check`와 링크만 유지한다.
- 완료 상태와 현재 기준은 [아키텍처](development/architecture/architecture.md), [Smoke Check](development/quality/smoke-check.md), 기능별 기준 문서 중 하나에만 상세하게 기록하고, 다른 문서는 링크로 연결한다.
