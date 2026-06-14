# Planning 문서

`docs/planning`은 Ferrum2D의 미구현 신규 기능 후보, 승인 필요 기능, 리팩토링 후보를 관리하는 영역이다. 구현이 완료된 기능의 사용법, public contract, 검증 기준은 `docs/engine` 또는 `docs/development`로 옮기고 planning 문서에서는 삭제한다. 단, 장기 roadmap에서 다음 slice의 근거가 되는 결정 로그와 완료 기록은 남길 수 있으며, 이 경우 운영 계약의 source of truth는 확정 문서임을 명시한다.

## 현재 문서

| 문서 | 역할 |
| --- | --- |
| [데모 게임 포트폴리오 보강 계획](demo-game-showcase-plan.md) | Ferrum2D 사용자-facing 엔진 기능을 여러 focused demo와 Pages showcase hub로 노출하기 위한 계획 |
| [배포 전략 초기 계획](deployment-roadmap.md) | 정적 웹 배포, 로컬 preview, Electron/Tauri desktop wrapper 후보를 정리한 초기 배포 planning |
| [신규 기능 후보 템플릿](feature-candidates.md) | 새 기능 후보 작성 형식 |
| [리팩토링 로드맵 템플릿](refactor-roadmap.md) | 새 리팩토링 후보 작성 형식 |

활성 작업 목록은 planning 문서에 중복 관리하지 않는다. 진행 중인 작업은 별도 task 또는 이슈로 범위와 검증 기준을 확정하고, 완료된 내용은 확정 문서에만 남긴다.

## Pages 노출 원칙

`docs/planning` 문서는 GitHub Pages docs navigation에 포함되지만 제품 사용 계약처럼 보이면 안 된다. Pages 홈과 docs navigation의 상단 진입점은 [문서 지도](../README.md)의 Pages 홈 노출 기준을 따른다. planning 문서는 신규 기능 후보, 승인 필요 항목, 완료 slice의 근거를 찾는 보조 경로로 유지한다.

## 관리 규칙

- 기능 후보는 사용자-facing 가치, Ferrum2D 제품 방향, 검증 가능성을 함께 기록한다.
- 개발을 시작하려면 후보 항목을 별도 task 또는 이슈로 분리하고 범위/검증 기준을 확정한다.
- 기능이 코드, 테스트, 문서까지 완료되면 planning 문서에서 제거하고 사용법/public contract/검증 기준은 확정 문서에만 남긴다. 후속 계획을 설명하는 데 필요한 완료 slice 기록은 결정 로그로 유지할 수 있지만, 확정 문서와 충돌하면 확정 문서가 우선한다.
- `docs/README.md`, `docs/engine/**`, `docs/development/**`가 운영 계약의 기준 소스다. `docs/planning/**`의 완료 기록은 진행 근거이며, 충돌하면 확정 문서를 우선한다.
- 문서 구조나 Pages 진입점이 바뀌면 `pnpm validate:docs-links`, `pnpm build:pages`, `pnpm validate:pages-artifact`로 Markdown 링크와 generated HTML route를 함께 확인한다.
- Wasm threads, full visual editor, multiplayer, scripting/plugin runtime, skeletal animation, complex physics, 3D rendering은 별도 설계/승인 전 production 코드로 구현하지 않는다.
