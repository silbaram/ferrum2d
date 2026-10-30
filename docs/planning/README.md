# 개발 계획과 개선 후보

기준일: 2026-10-30

`docs/planning/`은 진행 중인 작업, 미착수 후보, 제품 결정이 필요한 항목만 관리한다.
완료된 계획·단계별 결과 기록은 삭제하고 아카이브로 옮기지 않는다.
현재 사용법과 검증 계약은 `docs/engine/`, `docs/development/`를 기준으로 한다.

현재 구체적인 단계와 완료 조건이 정리된 개발 계획은 [엔진 내장 도트 제작 기능](sprite-editor-plan.md)이다.
Aseprite는 코드·알고리즘·UX의 참고 대상이며, 외부 도구 설치·파일 없이 엔진 안에서 새 도트를 만들어 게임에 쓰는 흐름이 목표다.
1차 기본 제작·브라우저 내보내기·native 프로젝트 저장/재열기·씬 적용을 구현하고 검증했다. 다음 구현은 이미지 레이어·프레임 애니메이션이다.
다른 문서는 설계 후보, 후속 검증 또는 제품 결정 대기를 관리한다.

## 다음 개선 추천

아래 순서는 개발 착수나 완료를 뜻하지 않는다. 작업을 시작할 때 대상과 검증 조건을 확정한다.

| 순서 | 개선 | 추천 이유 | 범위와 완료 조건 |
| --- | --- | --- | --- |
| 1 | 엔진 내장 도트 제작 2차 | 정적 이미지에서 다중 이미지 레이어·프레임 애니메이션으로 확장한다. | [개발 계획](sprite-editor-plan.md): 레이어 합성/잠금·프레임 시간·어니언 스킨·저장/재생 검증 |
| 2 | 프로젝트 디스크 Catalog 정리 설계 | 닫힌 씬이 참조하는 프로젝트 원본을 보호한다. | [제작 편의성 후보](game-development-convenience-review.md#asset-반복-작업): 프로젝트 전체 참조·동시 수정·실패 복원을 설계한 뒤 삭제 범위 결정. 구현 착수 전 설계 후보 |

[실물 GPU·장시간·LOD 외형](feature-candidates.md#실게임-품질-후속-검증)과 [실제 설치·GUI·서명](deployment-roadmap.md#남은-검증-후보)은 후속 검증이다.
필요한 기기·설치 자료·실행 조건을 먼저 확보하며, 기능 구현을 다시 시작하는 항목으로 취급하지 않는다.

## 문서별 관리 범위

| 문서 | 구분·상태 | 다음 판단 또는 작업 |
| --- | --- | --- |
| [엔진 내장 도트 제작 개발 계획](sprite-editor-plan.md) | 1차 완료 · 2차 미착수 | 이미지 레이어·프레임·어니언 스킨과 저장/재생 호환 검증 |
| [HD-2D 후속 기능·검증 후보](feature-candidates.md) | 설계 후보 / 환경 검증 대기 | 대상 씬·측정 환경·완료 조건을 정한 뒤 필요한 최적화 선택 |
| [게임 개발 편의성 후보](game-development-convenience-review.md) | 설계 후보 · 미착수 | 프로젝트 디스크 정리·외부 맵·reload 등의 실제 필요와 저장 경계 확정 |
| [데모 포트폴리오 후보](demo-game-showcase-plan.md) | 제품 결정 대기 | 기존 기능을 별도 public demo/report로 노출할 가치 판단 |
| [배포 후속 검증 후보](deployment-roadmap.md) | 설치 환경 검증 / 운영 정책 결정 대기 | 실제 앱·기기·서명 자료를 확보한 뒤 검증 |

공간 오디오·에셋 로딩·glTF 변환·WebGPU 계측의 사용법은 [Core API](../engine/public-api/core.md)와
[공간 계약](../engine/data-scene-spatial.md), 세션 revision 정리·Import 진단은 [Scene Authoring](../engine/data-scene-authoring.md#tiledldtk-타일-프레임-assets)을 따른다.
이미 제공하는 기능을 미완료 후보로 다시 등록하지 않는다.

## 관리 규칙

- 후보마다 사용자 가치, 현재 한계, 착수 시 검증 조건을 기록한다.
- 개발 계획, 설계 후보, 환경 검증 대기, 제품 결정 대기를 구분한다. 후보의 나열 순서를 구현 착수나 완료로 해석하지 않는다.
- 완료한 단계의 로그·테스트 개수·임시 경로를 계획에 누적하지 않는다. 현재 검증 명령은 [Smoke Check](../development/quality/smoke-check.md)에 둔다.
- 일부 후보가 남은 문서는 남은 범위만 유지한다. 전체가 끝나면 삭제하고 문서 지도와 Pages 메뉴의 참조도 정리한다.
- 실제 구현·저장/API 계약과 제안은 구분한다. 원격 이슈·배포 상태는 확인 없이 완료로 바꾸지 않는다.
- 문서 삭제·경로·Pages 메뉴 변경은 `pnpm validate:docs-links`, `pnpm build:pages`, `pnpm validate:pages-artifact`로 확인한다.
- Wasm threads, full visual editor, multiplayer, scripting/plugin runtime, skeletal animation, complex physics, 범용 3D는 별도 설계/승인 범위다.
