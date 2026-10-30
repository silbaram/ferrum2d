# 개발 계획과 개선 후보

기준일: 2026-10-30

`docs/planning/`은 진행 중인 작업, 미착수 후보, 제품 결정이 필요한 항목만 관리한다.
완료된 계획·단계별 결과 기록은 삭제하고 아카이브로 옮기지 않는다.
현재 사용법과 검증 계약은 `docs/engine/`, `docs/development/`를 기준으로 한다.

문서화된 신규 계획: [스프라이트 픽셀 편집기](sprite-editor-plan.md). 계획 작성 완료·구현 미착수이며, 1차 기본 드로잉·저장·씬 적용부터 진행한다.

## 다음 개선 추천

아래 순서는 개발 착수나 완료를 뜻하지 않는다. 작업을 시작할 때 대상과 검증 조건을 확정한다.

| 순서 | 개선 | 추천 이유 | 범위와 완료 조건 |
| --- | --- | --- | --- |
| 1 | 실제 마을 렌더 비용·실물 GPU 검증 | 현재 원본/LOD 비교를 토대로 실제 기기에서 효과/제출 병목을 확인한다. | [실게임 품질 후속](feature-candidates.md#실게임-품질-후속-검증): 해상도/DPR·장시간 실행, 원본 대비 측정과 외형 확인 후 최적화 선택 |
| 2 | WebGPU GPU 시간·자원 통계 | 장치 손실 복구 다음으로 실제 병목을 profiler에서 읽을 수 있게 한다. | [엔진 확장 후보](feature-candidates.md#엔진-확장-후보): timestamp 미지원 처리와 자원 소유/정리·복구 전후 검증 |
| 3 | Catalog 정리와 import 진단 | 전체 맵 반복 작성 시 원본 revision 예산과 오류 원인을 다루기 쉽게 한다. | [제작 편의성 후보](game-development-convenience-review.md#asset-반복-작업): 참조/Undo 보존·명시적 정리·실패 rollback·원본 위치 진단 |

## 문서별 관리 범위

| 문서 | 남은 범위 |
| --- | --- |
| [HD-2D 후속 기능·검증 후보](feature-candidates.md) | 실물 GPU·LOD 전환, WebGPU 통계, 자원 요청, 추가 모델, 물리 탐색·표시 보간 |
| [게임 개발 편의성 후보](game-development-convenience-review.md) | 외부 맵 지원 범위 확대, catalog 정리·저장, 개발 reload, 읽기 전용 실행 진단 |
| [스프라이트 픽셀 편집기 개발 계획](sprite-editor-plan.md) | 기본 드로잉·저장·씬 적용, 이미지 레이어/프레임, 노멀·게임 미리보기의 단계별 범위와 완료 조건 |
| [데모 포트폴리오 후보](demo-game-showcase-plan.md) | 기존 기능을 public demo/report로 노출할 필요성 판단 |
| [배포 후속 검증 후보](deployment-roadmap.md) | 실제 설치·GUI·플랫폼 서명 증거와 추가 host 필요성 판단 |

완료한 공간 오디오·에셋 로딩·glTF 변환 등의 사용법은 [Core API](../engine/public-api/core.md)와
[공간 계약](../engine/data-scene-spatial.md)을 따른다. 이미 제공하는 기능을 미완료 후보로 다시 등록하지 않는다.

## 관리 규칙

- 후보마다 사용자 가치, 현재 한계, 착수 시 검증 조건을 기록한다.
- 완료한 단계의 로그·테스트 개수·임시 경로를 계획에 누적하지 않는다. 현재 검증 명령은 [Smoke Check](../development/quality/smoke-check.md)에 둔다.
- 일부 후보가 남은 문서는 남은 범위만 유지한다. 전체가 끝나면 삭제하고 문서 지도와 Pages 메뉴의 참조도 정리한다.
- 실제 구현·저장/API 계약과 제안은 구분한다. 원격 이슈·배포 상태는 확인 없이 완료로 바꾸지 않는다.
- 문서 삭제·경로·Pages 메뉴 변경은 `pnpm validate:docs-links`, `pnpm build:pages`, `pnpm validate:pages-artifact`로 확인한다.
- Wasm threads, full visual editor, multiplayer, scripting/plugin runtime, skeletal animation, complex physics, 범용 3D는 별도 설계/승인 범위다.
