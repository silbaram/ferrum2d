# 개발 계획과 개선 후보

기준일: 2026-11-12

`docs/planning/`은 미착수 개발, 환경 검증 대기와 제품 결정만 관리한다.
완료한 계획은 삭제하며, 사용 계약은 [엔진 문서](../README.md), 재현 명령은
[Smoke Check](../development/quality/smoke-check.md)에 남긴다.

## 다음 개선 추천

조명 고도화의 계획된 기능 구현은 완료했다. 실제 문제 게임·목표 기기의 수용 검증은 남아 있으며,
[조명 수용 검증](feature-candidates.md#조명-수용-검증)에서 관리한다. 이를 기능 미구현으로 세지 않는다.
다음 후보는 실제 게임 요구와 완료 조건을 정한 뒤 선택한다. 아래 나열 순서는 착수 승인이 아니다.

| 문서 | 상태 | 다음 작업 또는 판단 |
| --- | --- | --- |
| [게임 개발 편의성](game-development-convenience-review.md) | 설계 후보·미착수 / 제품 결정 대기 | 외부 맵·실행 진단·reload의 실제 필요와 저장 경계 확정 |
| [공용 VFX 리소스와 실행 기능](vfx-resource-system-plan.md) | 엔진 연동 미착수 | VX-00 최소 출력·실게임 검증 후 공용 리소스화. 외부 VFX 제작 도구와 Ferrum2D Studio를 구분 |
| [HD-2D 후속 기능·검증](feature-candidates.md) | 설계 후보 / 환경 검증·제품 결정 대기 | 대상 씬·GPU·브라우저·성능/외형 수용 조건 확보 후 검증 또는 확장 선택 |
| [배포 후속 검증](deployment-roadmap.md) | 설치 환경 검증 / 운영 정책 결정 대기 | 실제 앱·기기·서명 자료를 확보한 뒤 설치·GUI·업데이트 검증 |

자동 라이트맵 베이크·IBL·캐스케이드 그림자는 별도 확장 후보다. 기존 조명 계획의 미완료 항목이나
현재 제품의 필수 기능으로 취급하지 않는다. AI 이미지 생성 서비스 직접 연결도
[보류 후보](game-development-convenience-review.md#도트-제작-후보)이며, 현재는 외부 PNG의 도트 변환·편집을 사용한다.

## 현재 기능의 기준 문서

- 씬·에셋 제작과 Studio 저장: [Scene Authoring](../engine/data-scene-authoring.md)
- 조명·그림자·HD-2D: [공간 계약](../engine/data-scene-spatial.md), [화면 표현](../engine/data-scene-presentation.md)
- 공개 API와 지원 수준: [Public API](../engine/public-api.md)
- 실물 GPU·장시간·LOD 외형: [후속 검증](feature-candidates.md#실게임-품질-후속-검증)

## 관리 규칙

- 후보마다 사용자 가치, 현재 한계, 착수 조건과 검증 기준을 기록한다.
- 기능 개발, 환경 검증, 제품 결정을 구분한다. 이미 제공하는 기능을 새 후보로 등록하지 않는다.
- 완료 단계의 로그·테스트 개수·임시 경로를 누적하지 않는다. 일부가 남으면 남은 범위만 유지하고, 전체가 끝나면 문서를 삭제한다.
- 배포·원격 이슈 상태는 확인 없이 완료로 바꾸지 않는다. 개발 소스 지원과 설치 버전 지원을 구분한다.
- 경로·메뉴 변경은 `pnpm validate:docs-links`, `pnpm build:pages`, `pnpm validate:pages-artifact`로 확인한다.
- Wasm threads, full visual editor, multiplayer, scripting/plugin runtime, skeletal animation, complex physics, 범용 3D는 별도 설계/승인 범위다.
