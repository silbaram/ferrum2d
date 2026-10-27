# Planning 문서

`docs/planning`은 진행 중인 개발 계획, 미구현 기능 후보, 승인 필요 기능을 관리한다. 개발이 완료된 계획과 결과 기록은 삭제하고 별도 완료 요약·아카이브 문서를 만들지 않는다. 사용법, public contract, 검증 기준은 기존 `docs/engine`과 `docs/development`의 확정 문서에서 관리한다.

## 현재 문서

아래 상태는 각 문서의 기준일과 해당 코드·검증 기록을 함께 반영한 planning 요약이다. `활성 후보`는 착수된 task가 아니라 다음 범위를 고를 때 사용할 후보이며, 실제 개발을 시작할 때 별도 task 또는 이슈로 검증 기준을 확정한다.

| 문서 | 현재 상태 | 활성 후보 |
| --- | --- | --- |
| [HD-2D 후속 기능·검증 후보](feature-candidates.md) | 완료 계획에서 미착수 후보만 분리 | 실제 게임 성능·LOD 외형·다른 기기, WebGPU 통계/복구·전체 scene GPU transaction·추가 모델 계약 |
| [데모 게임 포트폴리오 후속 계획](demo-game-showcase-plan.md) | Showcase Hub와 6개 public route 기반 완료 | Content/UX, Renderer/Streaming lab, Agent Workflow report의 사용자-facing 노출 결정 |
| [게임 개발 편의성 실사용 검토](game-development-convenience-review.md) | built-in Scene Authoring, Aseprite import/reimport·animation+normal 동시 생성·native 저장/복원, Tiled/LDtk tileset 선택·외부 TSJ frame·native 원본 저장/재열기, 폴더 감지·GLB/texture·runtime 진단, 게임 카메라 구도·확대 작성/patch 저장 반영 | Tiled/LDtk 추가 형식·map 연결, catalog 예산/정리·추가 문서 저장, collision/effect timeline·실행 근거 |
| [배포 후속 계획](deployment-roadmap.md) | 정적 Pages, Tauri authoring host, 로컬 Linux package smoke·native GUI 검증 기반 | release artifact GUI·CI 편입, generated game wrapper와 macOS/Windows release matrix 필요성 판단 |

활성 작업 목록은 planning 문서에 중복 관리하지 않는다. 진행 중인 작업은 별도 task 또는 이슈로 범위와 검증 기준을 확정하고, 완료된 사용법과 운영 계약은 확정 문서에만 남긴다.

## Pages 노출 원칙

`docs/planning` 문서는 GitHub Pages docs navigation에 포함되지만 제품 사용 계약처럼 보이면 안 된다. Pages 홈과 docs navigation의 상단 진입점은 [문서 지도](../README.md)의 Pages 홈 노출 기준을 따른다. planning 문서는 진행 중인 개발 계획, 신규 기능 후보, 승인 필요 항목의 보조 경로로 유지한다.

## 관리 규칙

- 기능 후보는 사용자-facing 가치, Ferrum2D 제품 방향, 검증 가능성을 함께 기록한다.
- 개발을 시작하려면 후보 항목을 별도 task 또는 이슈로 분리하고 범위/검증 기준을 확정한다.
- 개발 계획 전체가 완료되면 해당 문서를 삭제한다. 완료 기록을 다른 경로의 요약·아카이브로 다시 만들지 않는다. 사용법/public contract/검증 기준은 기존 확정 문서에서 관리한다.
- 일부 단계만 완료됐거나 검증이 남은 계획은 유지한다. 데모·배포·편의성 문서의 미착수 후보는 완료 문서로 삭제하지 않는다.
- `docs/README.md`, `docs/engine/**`, `docs/development/**`가 운영 계약의 기준 소스다. 진행 중인 계획의 단계별 기록은 작업 재개에 필요한 범위로 유지하며, 운영 계약과 충돌하면 확정 문서를 우선한다.
- 문서 구조나 Pages 진입점이 바뀌면 `pnpm validate:docs-links`, `pnpm build:pages`, `pnpm validate:pages-artifact`로 Markdown 링크와 generated HTML route를 함께 확인한다.
- Wasm threads, full visual editor, multiplayer, scripting/plugin runtime, skeletal animation, complex physics, 3D rendering은 별도 설계/승인 전 production 코드로 구현하지 않는다.
