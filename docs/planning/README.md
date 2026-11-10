# 개발 계획과 개선 후보

기준일: 2026-11-09

`docs/planning/`은 진행 중인 작업, 미착수 후보, 제품 결정이 필요한 항목만 관리한다.
완료된 계획·단계별 결과 기록은 삭제하고 아카이브로 옮기지 않는다.
현재 사용법과 검증 계약은 `docs/engine/`, `docs/development/`를 기준으로 한다.

에디터의 현재 사용법은 [Scene Authoring](../engine/data-scene-authoring.md),
회귀 검증은 [Smoke Check](../development/quality/smoke-check.md)를 따른다.
아래 문서는 진행 중인 개발, 미착수 설계, 환경 검증 대기 또는 제품 결정 대기를 관리한다.
완료된 도트 개발계획과 리뷰 결과는 새 미완료 작업으로 등록하지 않는다.

도트 제작의 현재 계약은
[Scene Authoring](../engine/data-scene-authoring.md#에디터-내장-도트-제작)과
앱 안내(`apps/placement-viewer/README.md`)를 따른다.

## 다음 개선 추천

아래는 다음 작업의 우선순위다. 개발 계획과 설계 후보를 구분하며, 순서 자체가 구현 착수나 완료를 뜻하지 않는다.

| 순서 | 개선 | 추천 이유 | 범위와 완료 조건 |
| --- | --- | --- | --- |
| 1 | 조명·태양광 그림자 품질 | 카메라에 따른 그림자 변화와 여러 광원·화면 효과의 결합을 재현하고 개선한다. | [조명 고도화 계획](lighting-quality-upgrade-plan.md)의 M2-a flat lit, M3a 성분 분리, M3b flat HDR과 M3c WebGPU 선형 색공간은 개발 소스 구현·자동 회귀를 완료했다. 다음은 M4/M5이며 실게임·실기기 검증은 개발 완료 후 진행한다. |
| 2 | 게임 개발 연동 편의성 | 실제 프로젝트에서 반복되는 가져오기·진단 비용을 줄인다. | [외부 맵·실행 진단 후보](game-development-convenience-review.md)의 필요성과 저장 경계를 먼저 정한다. 도트 제작과 9-slice 지원 여부는 공식 사용법을 따른다. |
| 3 | 공용 VFX 리소스·게임 연동 | 예제 효과와 독립 Studio 출력물을 게임에서 재사용하게 한다. | [VFX 개발 계획](vfx-resource-system-plan.md)의 VX-00 실게임 검증 → VX-01 공용 리소스화 순서다. Studio 검토 사항과 엔진의 책임·합성·출력 계약을 함께 관리한다. |

AI 생성 서비스 직접 연결은 [보류 후보](game-development-convenience-review.md#도트-제작-후보)다. 현재는 웹에서 생성한 PNG의 도트 변환·편집을 우선한다.

[실물 GPU·장시간·LOD 외형](feature-candidates.md#실게임-품질-후속-검증)과 [실제 설치·GUI·서명](deployment-roadmap.md#남은-검증-후보)은 후속 검증이다.
필요한 기기·설치 자료·실행 조건을 먼저 확보하며, 기능 구현을 다시 시작하는 항목으로 취급하지 않는다.

## 문서별 관리 범위

| 문서 | 구분·상태 | 다음 판단 또는 작업 |
| --- | --- | --- |
| [조명·그림자·화면 효과 고도화](lighting-quality-upgrade-plan.md) | M2-a·M3a·M3b·M3c 자동 회귀 완료 · M4/M5 잔여 | 제한 재질·수신 제어·광원 선택·Bloom 개선, 이후 실게임·실기기 검증 |
| [공용 VFX 리소스와 실행 기능](vfx-resource-system-plan.md) | 엔진 단계 미착수 / 독립 Studio는 첨부 문서상 진행 중 | VX-00 최소 출력·실게임 검증부터 시작. Studio의 실제 구현 재검증과 공용 리소스·이벤트 연결, 후속 표현 확장 구분 |
| [HD-2D 후속 기능·검증 후보](feature-candidates.md) | 설계 후보 / 환경 검증·제품 결정 대기 | 대상 씬·측정 환경·완료 조건을 정한 뒤 필요한 최적화 선택. 추가 GPU 계측·복구 학습 예제의 필요성 판단 |
| [게임 개발 편의성 후보](game-development-convenience-review.md) | 설계 후보 · 미착수 / 제품 결정 대기 | 보류한 생성/호환 후보·외부 맵·reload의 실제 필요와 저장 경계 확정. Agent Workflow 추가 공개의 필요성 판단 |
| [배포 후속 검증 후보](deployment-roadmap.md) | 설치 환경 검증 / 운영 정책 결정 대기 | 실제 앱·기기·서명 자료를 확보한 뒤 검증 |

현재 엔진 기능은 [Core API](../engine/public-api/core.md)와 [공간 계약](../engine/data-scene-spatial.md),
자산 제작·가져오기·정리는 [Scene Authoring](../engine/data-scene-authoring.md)를 따른다.
이미 제공하는 기능을 미완료 후보로 다시 등록하지 않는다.

## 관리 규칙

- 후보마다 사용자 가치, 현재 한계, 착수 시 검증 조건을 기록한다.
- 개발 계획, 설계 후보, 환경 검증 대기, 제품 결정 대기를 구분한다. 후보의 나열 순서를 구현 착수나 완료로 해석하지 않는다.
- 완료한 단계의 로그·테스트 개수·임시 경로를 계획에 누적하지 않는다. 현재 검증 명령은 [Smoke Check](../development/quality/smoke-check.md)에 둔다.
- 일부 후보가 남은 문서는 남은 범위만 유지한다. 전체가 끝나면 삭제하고 문서 지도와 Pages 메뉴의 참조도 정리한다.
- 실제 구현·저장/API 계약과 제안은 구분한다. 원격 이슈·배포 상태는 확인 없이 완료로 바꾸지 않는다.
- 문서 삭제·경로·Pages 메뉴 변경은 `pnpm validate:docs-links`, `pnpm build:pages`, `pnpm validate:pages-artifact`로 확인한다.
- Wasm threads, full visual editor, multiplayer, scripting/plugin runtime, skeletal animation, complex physics, 범용 3D는 별도 설계/승인 범위다.
