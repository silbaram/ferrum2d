# 개발 계획과 개선 후보

기준일: 2026-11-24

`docs/planning/`은 진행 중·미착수 개발, 환경 검증 대기와 제품 결정을 관리한다.
완료한 계획은 삭제하며, 사용 계약은 [엔진 문서](../README.md), 재현 명령은
[Smoke Check](../development/quality/smoke-check.md)에 남긴다.

## 다음 개선 추천

지금 진행 순서(2026-11-24 사용자 결정): 엔진 개선이 1순위, 예제가 2순위다. [런타임 시작·화면 맞춤](runtime-startup-view-plan.md)을
먼저 구현하고, 끝나면 [예제 사이트](example-site-rebuild-plan.md)의 예제를 새 API로 옮긴 뒤 예제 추가를 이어 간다.
그 밖의 후보는 실제 게임 요구와 완료 조건을 정한 뒤 선택한다. 아래 표의 나머지 순서는 착수 승인이 아니다.
조명 고도화의 남은 일은 실제 게임·목표 기기의 수용 검증이며 [조명 수용 검증](feature-candidates.md#조명-수용-검증)에서 관리한다.

| 문서 | 상태 | 다음 작업 또는 판단 |
| --- | --- | --- |
| [런타임 시작·화면 맞춤](runtime-startup-view-plan.md) | 사용자 승인·R1~R3, F1~F5·F5b, E1, C1(C1b·C1c·C1d 포함) 로컬 검증 완료(엔진 개선 1순위) | 남은 일은 PR CI 정리이며 [PR CI 정리와 Studio 배포 분리](ci-and-studio-distribution-plan.md)로 넘겼다. |
| [PR CI 정리와 Studio 배포 분리](ci-and-studio-distribution-plan.md) | S1 완료·S1b와 S1c 로컬 검증 완료 | PR 기본 검사와 수동 브라우저 job을 각각 통합 검증한다. S2는 Studio 검사 단언을 분류하는 일부터 시작한다. |
| [통합 3D 물리](unified-3d-physics-plan.md) | 사용자 승인·개발 진행 중 | 오픈소스 비교, Rust/Wasm 3D 백엔드 도입, 2D 평면·HD-2D 통합 및 수용 검증. 회전 상자 접촉의 운동 증명 한계(물리 실험실 4개 시나리오, 벽돌 깨기 CCD 멈춤)는 [운동 증명 방식 검토](physics-motion-proof-review.md)의 B 결정으로 처리 |
| [3D 물리 운동 증명 방식 검토](physics-motion-proof-review.md) | B 확정·P2a 강체 전환 완료(PR #114 main 머지)·P2b 작업 브랜치 재개 | 군중 길막힘을 수정했다. 빠른 상자와 캡슐의 겹침이 5틱 안에 회복되는 기준은 일반 Rapier에서도 미달했다 |
| [게임 개발 편의성](game-development-convenience-review.md) | 설계 후보·미착수 / 제품 결정 대기 | 외부 맵·실행 진단·reload의 실제 필요와 저장 경계 확정 |
| [공용 VFX 리소스와 실행 기능](vfx-resource-system-plan.md) | 엔진 연동 미착수 | VX-00 최소 출력·실게임 검증 후 공용 리소스화. 외부 VFX 제작 도구와 Ferrum2D Studio를 구분 |
| [HD-2D 후속 기능·검증](feature-candidates.md) | 설계 후보 / 환경 검증·제품 결정 대기 | 대상 씬·GPU·브라우저·성능/외형 수용 조건 확보 후 검증 또는 확장 선택. 복원한 Engine의 Data Scene 도구 재연결, 실행 중 native world 재적용 결정 포함 |
| [배포 후속 검증](deployment-roadmap.md) | 설치 환경 검증 / 운영 정책 결정 대기 | 실제 앱·기기·서명 자료를 확보한 뒤 설치·GUI·업데이트 검증 |
| [예제 사이트 다시 만들기](example-site-rebuild-plan.md) | 사용자 승인·예제 3개와 새 API 이관 완료 | 편집기형 예제 사이트에 예제를 하나씩 추가한다. |

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
