# 게임 개발 편의성 후보

기준일: 2026-11-04
상태: 설계 후보·미착수. 개별 항목의 필요성과 완료 조건을 정한 뒤 개발 계획으로 구체화한다.

현재 제작 흐름은 [개발자 퀵스타트](../engine/developer-quickstart.md),
[Scene Authoring](../engine/data-scene-authoring.md), [Authoring API](../engine/public-api/authoring.md),
[Smoke Check](../development/quality/smoke-check.md)가 기준이다.
프로젝트별 runtime 입력과 `ferrum:check`/report 계약도 해당 문서를 따른다.

## Asset 반복 작업

공식 뷰어의 읽기 전용 [에셋 사용처 조회](../engine/data-scene-authoring.md)는 씬 파일과 열린 작업공간 원본/draft의 근거를 제공한다.
코드·외부 매니페스트·GLB 내부·Undo 이력과 전체 디스크 검증은 포함하지 않는다.
데스크톱의 복구 가능한 관리 Catalog 정리는 [Scene Authoring](../engine/data-scene-authoring.md)의 현재 지원 범위를 따른다.

가져오기·세션 revision 정리·Import 진단의 현재 계약은 [Scene Authoring](../engine/data-scene-authoring.md#tiledldtk-타일-프레임-assets)을 따른다.

| 후보 | 착수 시 완료 조건 |
| --- | --- |
| 외부 맵 지원 범위 확대 | [현재 전체 맵](../engine/data-scene-authoring.md#tiledldtk-전체-맵-적용-개발-소스) 이후 실제 필요를 확인해 다중 PNG·2,048개 초과·flip/animation·TSX·외부 level·IntGrid 어댑터를 각각 설계. 좌표/게임 상태·실패 원자성·원본 저장을 검증 |
| 추가 문서의 host 저장 | 기본 문서 밖 저장 대상과 project-root allowlist·동시 수정·원본/catalog 관계를 정함. browser-only export 경계 유지 |
| Generated game 개발 reload | runtime 교체 시 asset/handle/input/오디오 수명과 stale 결과 차단을 정하고 실제 게임에서 재로딩 검증 |

전체 map import는 타일 프레임을 자동으로 gameplay/충돌로 해석하는 기능이 아니다.
새 source 형식을 추가하기 전에 기존 authoring/patch와 agent handoff의 변환 계약을 확정한다.
공식 desktop의 폴더 감지·texture/GLB 명시적 reimport와 기본 문서 저장은 다시 구현할 후보가 아니다.

## 도트 제작 후보

현재 지원 기능과 저장·복구 계약은 [Scene Authoring](../engine/data-scene-authoring.md#에디터-내장-도트-제작)을 따른다.
현재 선택한 제작 흐름은 웹에서 생성·다운로드한 PNG를 가져와 도트로 변환·편집하는 방식이다. 생성 서비스/API 직접 연결은 우선 개발 대상으로 두지 않는다.
완료된 도구 개발과 버그 수정 이력은 이 표에 누적하지 않는다. 아래 항목은 각각 별도 설계가 필요한 미착수 후보이며, 순서가 구현 승인을 뜻하지 않는다.

| 후보 | 착수 시 완료 조건 |
| --- | --- |
| AI 생성 서비스 직접 연결 (보류) | 외부 PNG 변환·편집 흐름으로 먼저 제작한다. 추후 실제 필요가 있으면 로컬 ComfyUI 또는 서비스의 실행 환경·품질·비용·출처·실패/취소 경계를 별도로 설계하며, 현재 구현된 기능으로 표기하지 않음 |
| 추가 도트 변형·외부 복사 | 임의 각도/보간 확대·OS 클립보드로 이미지 내보내기·indexed source·레이어 blend/opacity는 실제 요구와 메모리/호환·권한 범위를 먼저 설계. 기존 정수 변형·RGBA 원본·복구를 보호 |
| 측정 기반 차분 Undo | 같은 작은/최대 문서에서 한 픽셀·stroke·fill·크기 변경의 할당 byte/이력 수/편집·Undo 비용을 먼저 측정. 개선이 확인되면 픽셀 영역 차분과 metadata/크기 전체 snapshot fallback을 설계하고 혼합 trace의 원본·revision/dirty·Undo/Redo/no-op을 대조. 기존64단계/16MiB와 전체 원본 복구를 유지. 완료된 도구의 필수 후속 작업은 아님 |

## 읽기 전용 실행 진단

선택 entity의 variable/FSM state/timer/cooldown과 bounded 최근 gameplay event를 출발점으로 한다.

| 후보 | 착수 시 완료 조건 |
| --- | --- |
| Collision/effect event timeline | actor·event·frame의 상관관계와 기록 상한·비활성 비용을 정하고 실제 입력에 따른 이벤트로 검증 |
| Source와 실행 근거 연결 | JSON pointer·source diff에 behavior command의 실행/실패 근거를 연결. source를 고친 뒤 같은 검증으로 확인 |
| Replay mismatch 원인 표시 | 첫 불일치 frame·instance id·예상/실제 상태를 기존 replay report와 연결하고 실패 fixture로 검증 |

Rust가 simulation state를 소유하고 TS는 bulk telemetry나 낮은 빈도 query만 읽는다.
Behavior Recipe 본문·FSM/action graph를 UI에서 편집하는 기능으로 확대하지 않는다.

## 별도 결정

Public demo 노출은 [데모 후보](demo-game-showcase-plan.md), 실제 packaged GUI·서명 증거는
[배포 후보](deployment-roadmap.md)를 따른다. full visual editor, scripting/plugin runtime,
multiplayer, 범용 3D, complex physics는 별도 설계 범위다.
