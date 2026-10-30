# 게임 개발 편의성 후보

기준일: 2026-10-30
상태: 미착수 후보. 구현된 사용법과 완료된 검증 결과는 이 문서에서 반복하지 않는다.

현재 제작 흐름은 [개발자 퀵스타트](../engine/developer-quickstart.md),
[Scene Authoring](../engine/data-scene-authoring.md), [Authoring API](../engine/public-api/authoring.md),
[Smoke Check](../development/quality/smoke-check.md)가 기준이다.
프로젝트별 runtime 입력과 `ferrum:check`/report 계약도 해당 문서를 따른다.

## Asset 반복 작업

Aseprite frame·animation·normal import/reimport와 native 저장/재열기,
Tiled embedded/외부 TSJ·LDtk embedded tileset의 used frame 선택과 2D 단일 선택 tileset 전체 맵 적용은 이미 제공한다.
[타일 프레임 사용 범위](../engine/data-scene-authoring.md#tiledldtk-타일-프레임-assets)를 출발점으로 다음을 검토한다.

| 후보 | 착수 시 완료 조건 |
| --- | --- |
| 스프라이트 픽셀 제작 | [개발 계획](sprite-editor-plan.md)의 1차 기본 드로잉·저장·씬 적용부터 진행. 이미지 레이어/프레임·노멀 미리보기는 후속 단계이며 구현 미착수 |
| 외부 맵 지원 범위 확대 | [현재 전체 맵](../engine/data-scene-authoring.md#tiledldtk-전체-맵-적용-개발-소스) 이후 실제 필요를 확인해 다중 PNG·2,048개 초과·flip/animation·TSX·외부 level·IntGrid 어댑터를 각각 설계. 좌표/게임 상태·실패 원자성·원본 저장을 검증 |
| Catalog 예산과 정리 | 현재 8 revision/64 MiB 예산에서 실제 부족 사례를 확인. 참조 중 revision은 보존하고 명시적 정리·실패 rollback·저장 후 복원을 검증한 뒤 예산 확대 판단 |
| 추가 문서의 host 저장 | 기본 문서 밖 저장 대상과 project-root allowlist·동시 수정·원본/catalog 관계를 정함. browser-only export 경계 유지 |
| Generated game 개발 reload | runtime 교체 시 asset/handle/input/오디오 수명과 stale 결과 차단을 정하고 실제 게임에서 재로딩 검증 |
| Import 오류와 진단 연결 | missing asset/frame을 원본 import 항목·scene JSON pointer와 연결하고 수정 가능한 report로 출력 |

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
