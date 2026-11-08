# 게임 개발 편의성 후보

기준일: 2026-11-09
상태: 설계 후보·미착수. Agent Workflow 추가 공개는 제품 결정 대기다. 개별 항목의 필요성과 완료 조건을 정한 뒤 개발 계획으로 구체화한다.

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
| Data Scene 대규모 타일 맵 | 기존 sprite instance 기반 맵의 규모·CPU/draw 비용을 먼저 측정하고 native 타일 렌더 연결 필요성을 판단. 슈터용 오토타일·애니메이션을 다시 구현하는 항목으로 취급하지 않으며 navigation·충돌·저장·메모리 상한을 함께 검증 |
| 외부 원본 변경의 자동 적용 | 기존 감지·명시적 재가져오기를 기준으로 자동 적용의 필요성 판단. 미저장 편집·Undo·clip ID·원본/catalog 관계·실패 복원과 오래된 결과 차단부터 설계 |
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

### 외부 도구 호환 후보 (보류)

| 후보 | 다시 검토할 조건 |
| --- | --- |
| `.ase` 바이너리 직접 읽기 | 기존 JSON+PNG 흐름으로 해결되지 않는 실제 제작 사례가 있을 때 검토. 파서·의존성 필요성, 압축 해제/파일 크기 상한, 손상 파일 진단과 원본 보존을 먼저 정의 |
| 외부 slice center의 명시적 적용 | 현재 slice metadata/pivot과 일반 2D 9-slice API를 재사용하되, center를 크기 설정으로 적용하는 UI의 필요성을 먼저 판단. 기존 origin/size·Undo·미지원 공간 조합 진단 유지 |
| 외부 도구용 JSON 내보내기 | 현재 원본 JSON·PNG·GIF/APNG로 부족한 연동 사례가 있을 때만 범위 결정. 프레임 시간·태그·원점·출력 상한과 실패 시 원본 보존 검증 |

내장 도트 제작이 우선이며 외부 도구 호환 확대를 필수 후속 개발로 간주하지 않는다.

## 읽기 전용 실행 진단

선택 entity의 variable/FSM state/timer/cooldown과 bounded 최근 gameplay event를 출발점으로 한다.

| 후보 | 착수 시 완료 조건 |
| --- | --- |
| Collision/effect event timeline | actor·event·frame의 상관관계와 기록 상한·비활성 비용을 정하고 실제 입력에 따른 이벤트로 검증 |
| Source와 실행 근거 연결 | JSON pointer·source diff에 behavior command의 실행/실패 근거를 연결. source를 고친 뒤 같은 검증으로 확인 |
| Replay mismatch 원인 표시 | 첫 불일치 frame·instance id·예상/실제 상태를 기존 replay report와 연결하고 실패 fixture로 검증 |

Rust가 simulation state를 소유하고 TS는 bulk telemetry나 낮은 빈도 query만 읽는다.
Behavior Recipe 본문·FSM/action graph를 UI에서 편집하는 기능으로 확대하지 않는다.

## Agent Workflow 추가 공개 판단

현재 생성·검증 흐름은 [개발자 퀵스타트](../engine/developer-quickstart.md)와
[Showcase Hub](../engine/showcase-hub.md)를 따른다.
`create-game` → consumer agent 설정 → `ferrum:check` → replay/report 흐름을
별도 조작형 예제나 report 페이지로 설명할 가치가 있는지 판단한다.

- 기존 문서로 부족한 사용자 질문과 실제 조작할 입력·출력부터 정한다. SDK 기능 미구현으로 취급하지 않는다.
- 필요하면 실제 공개·설치 가능한 package와 개발 소스의 차이를 표시하고, 재현 가능한 report·검증 명령을 연결한다.
- 기존 안내 보강으로 해결할 수 있는지 먼저 확인한다. 새 route는 브라우저 검증·Pages 용량·CI 비용을 정한 뒤 결정한다.
- full visual editor나 Behavior Recipe 본문·FSM/action graph 편집으로 확대하지 않는다. 실제 Pages 배포는 별도 승인 범위다.

## 별도 결정

현재 공개 예제는 [Showcase Hub](../engine/showcase-hub.md), 추가 GPU 학습 노출 판단은
[기능 후보](feature-candidates.md), 실제 packaged GUI·서명 증거는
[배포 후보](deployment-roadmap.md)를 따른다. full visual editor, scripting/plugin runtime,
multiplayer, 범용 3D, complex physics는 별도 설계 범위다.
