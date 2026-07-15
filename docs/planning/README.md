# Planning 문서

`docs/planning`은 Ferrum2D의 미구현 신규 기능 후보, 승인 필요 기능, 리팩토링 후보를 관리하는 영역이다. 구현이 완료된 기능의 사용법, public contract, 검증 기준은 `docs/engine` 또는 `docs/development`로 옮기고 planning 문서에서는 삭제한다. 단, 장기 roadmap에서 다음 slice의 근거가 되는 결정 로그와 완료 기록은 남길 수 있으며, 이 경우 운영 계약의 source of truth는 확정 문서임을 명시한다.

## 현재 문서

아래 상태는 2026-07-14 코드, 검증 스크립트, 확정 문서를 기준으로 한 planning 요약이다. `활성 후보`는 착수된 task가 아니라 다음 범위를 고를 때 사용할 후보이며, 실제 개발을 시작할 때 별도 task 또는 이슈로 검증 기준을 확정한다.

| 문서 | 현재 상태 | 활성 후보 |
| --- | --- | --- |
| [데모 게임 포트폴리오 보강 계획](demo-game-showcase-plan.md) | Showcase Hub, 6개 public demo route, 기존 예제 역할 문서화 완료 | Content/UX, Renderer/Streaming lab, Agent Workflow report의 사용자-facing 노출 결정 |
| [오브젝트 배치 UI · 데이터 씬 authoring 보강 계획](object-placement-authoring-plan.md) | Slice 1~6과 공식/generated placement viewer 기반 완료 | fragment hierarchy v2, scene-specific compatibility API, desktop release 범위 결정 |
| [오브젝트 Authoring 모델 · 공식 배치 툴 고도화 계획](object-authoring-tool-plan.md) | v1 product-ready 기준과 Behavior Binding Inspector 완료 | 독립 browser package, image dimension metadata, Tauri packaging/GUI release 판단 |
| [Placement Viewer runtime texture loading 설계](placement-runtime-texture-loading-plan.md) | Slice 1~4와 desktop asset runtime reload smoke 완료 | 실제 GUI/package 검증과 image dimension metadata |
| [배포 전략 초기 계획](deployment-roadmap.md) | 정적 Pages와 create-game build/preview/deploy-readiness 완료, Tauri 경로 부분 완료 | 공식 hosting 확대 필요성 및 desktop packaging 승인 판단 |
| [물리 엔진 개선 개발계획](physics_review.md) | Slice 0~5, joint despawn 정리, singular matrix 입력 방어 완료 | coupled solver fallback 중복 연산, 고차수 despawn profiling |

활성 작업 목록은 planning 문서에 중복 관리하지 않는다. 진행 중인 작업은 별도 task 또는 이슈로 범위와 검증 기준을 확정하고, 완료된 사용법과 운영 계약은 확정 문서에만 남긴다.

## 완료되어 planning에서 제거한 항목

| 항목 | 확정 문서/코드 |
| --- | --- |
| Physics Sandbox 재작성 계획 | 확정 구현: `examples/physics-sandbox`; 확정 문서: [Physics Engine](../development/architecture/physics-engine.md), [Smoke Check](../development/quality/smoke-check.md) |

## Pages 노출 원칙

`docs/planning` 문서는 GitHub Pages docs navigation에 포함되지만 제품 사용 계약처럼 보이면 안 된다. Pages 홈과 docs navigation의 상단 진입점은 [문서 지도](../README.md)의 Pages 홈 노출 기준을 따른다. planning 문서는 신규 기능 후보, 승인 필요 항목, 완료 slice의 근거를 찾는 보조 경로로 유지한다.

## 관리 규칙

- 기능 후보는 사용자-facing 가치, Ferrum2D 제품 방향, 검증 가능성을 함께 기록한다.
- 개발을 시작하려면 후보 항목을 별도 task 또는 이슈로 분리하고 범위/검증 기준을 확정한다.
- 기능이 코드, 테스트, 문서까지 완료되면 planning 문서에서 제거하고 사용법/public contract/검증 기준은 확정 문서에만 남긴다. 후속 계획을 설명하는 데 필요한 완료 slice 기록은 결정 로그로 유지할 수 있지만, 확정 문서와 충돌하면 확정 문서가 우선한다.
- `docs/README.md`, `docs/engine/**`, `docs/development/**`가 운영 계약의 기준 소스다. `docs/planning/**`의 완료 기록은 진행 근거이며, 충돌하면 확정 문서를 우선한다.
- 문서 구조나 Pages 진입점이 바뀌면 `pnpm validate:docs-links`, `pnpm build:pages`, `pnpm validate:pages-artifact`로 Markdown 링크와 generated HTML route를 함께 확인한다.
- Wasm threads, full visual editor, multiplayer, scripting/plugin runtime, skeletal animation, complex physics, 3D rendering은 별도 설계/승인 전 production 코드로 구현하지 않는다.
