# 게임 개발 편의성 후보

기준일: 2026-10-30
상태: 설계 후보·미착수. 개별 항목의 필요성과 완료 조건을 정한 뒤 개발 계획으로 구체화한다.

현재 제작 흐름은 [개발자 퀵스타트](../engine/developer-quickstart.md),
[Scene Authoring](../engine/data-scene-authoring.md), [Authoring API](../engine/public-api/authoring.md),
[Smoke Check](../development/quality/smoke-check.md)가 기준이다.
프로젝트별 runtime 입력과 `ferrum:check`/report 계약도 해당 문서를 따른다.

## Asset 반복 작업

가져오기·세션 revision 정리·Import 진단의 현재 계약은 [Scene Authoring](../engine/data-scene-authoring.md#tiledldtk-타일-프레임-assets)을 따른다.
도트 제작과2D/HD-2D 노멀 적용의 현재 계약은 [Scene Authoring](../engine/data-scene-authoring.md#에디터-내장-도트-제작)을 따른다. 여기에서는 후속 후보만 관리한다.

| 후보 | 착수 시 완료 조건 |
| --- | --- |
| 외부 맵 지원 범위 확대 | [현재 전체 맵](../engine/data-scene-authoring.md#tiledldtk-전체-맵-적용-개발-소스) 이후 실제 필요를 확인해 다중 PNG·2,048개 초과·flip/animation·TSX·외부 level·IntGrid 어댑터를 각각 설계. 좌표/게임 상태·실패 원자성·원본 저장을 검증 |
| 프로젝트 디스크 Catalog 정리 | 저장된 revision·원본 파일의 제거 후보만 다룬다. 닫힌 모든 프로젝트 씬의 참조·동시 수정 충돌 감지·실패 복원을 설계한 뒤 삭제 범위를 정함. 기존 8 revision/64 MiB 예산은 실제 부족 사례를 측정한 뒤 확대 판단 |
| 추가 문서의 host 저장 | 기본 문서 밖 저장 대상과 project-root allowlist·동시 수정·원본/catalog 관계를 정함. browser-only export 경계 유지 |
| Generated game 개발 reload | runtime 교체 시 asset/handle/input/오디오 수명과 stale 결과 차단을 정하고 실제 게임에서 재로딩 검증 |

전체 map import는 타일 프레임을 자동으로 gameplay/충돌로 해석하는 기능이 아니다.
새 source 형식을 추가하기 전에 기존 authoring/patch와 agent handoff의 변환 계약을 확정한다.
공식 desktop의 폴더 감지·texture/GLB 명시적 reimport와 기본 문서 저장은 다시 구현할 후보가 아니다.

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
