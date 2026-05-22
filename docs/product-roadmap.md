# Ferrum2D 제품화 개발 순서

이 문서는 **MVP 개발 완료, 상용제품 기능 개발** 단계의 우선순위를 고정한다. 기준은 새 사용자가 새 게임을 만들고, 검증하고, 배포 후보를 만들 수 있는지다.

## Product Alpha

| 순서 | 작업 | 목적 | 상태 |
| --- | --- | --- | --- |
| 1 | Minimal starter example | asset 없이도 엔진 실행 흐름을 확인하는 새 프로젝트 출발점 제공 | 완료 |
| 2 | Product runtime API 설계 | Top-down Shooter 전용 경로와 일반 게임 runtime 경로 분리 | 완료 |
| 3 | Browser render smoke | WebGL2 실제 화면 black-frame 회귀 방지 | 완료 |
| 4 | npm beta package 절차 | `private: true` 해제 전 artifact, semver, release tag 기준 고정 | 완료 |

## Product Beta

| 순서 | 작업 | 목적 | 상태 |
| --- | --- | --- | --- |
| 1 | 두 번째 장르 예제 | 엔진이 shooter 전용이 아님을 검증 | 완료: `examples/breakout` |
| 2 | Input 확장 | touch, gamepad, pointer gesture 기반 게임 제작 지원 | 완료: `InputManagerOptions`, pointer/touch/gamepad snapshot 합성 |
| 3 | Text/UI rendering | HUD, menu, score, dialog를 엔진 기능으로 처리 | 완료: `UiOverlay`, runtime `uiState` |
| 4 | Asset pipeline v2 | Aseprite/Tiled/LDtk metadata import로 새 사용자 authoring 흐름 지원 | 완료: Aseprite metadata import, Tiled tilemap import v1, LDtk tilemap import v1 |

## Product 1.0 후보

| 순서 | 작업 | 목적 |
| --- | --- | --- |
| 1 | Particles/Tweens | hit effect, transition, UI animation polish |
| 2 | Audio v2 | BGM, mixer bus, fade, random pitch pool |
| 3 | Physics query v3/v4/v5 기반 | query/kinematic/counter/API/event payload/circle/tile-merge/shape-query/shape-cast/contact-broadphase debug line buffer/rendering bridge, nearest body/tilemap obstacle query, platformer ground probe, entity one-way platform, moving platform carry, kinematic platformer controller, coyote time, jump buffering, step offset, `examples/platformer` 완료 |
| 4 | Release automation | changelog, package publish dry-run, docs/demo deploy |
| 5 | Asset pipeline v2 확장 | atlas animation binding과 asset pipeline 제한 해소 검토 |

## 당장 미루는 것

- WebGPU
- Worker/멀티스레딩
- 내장 editor
- multiplayer
- full rigid body solver
- skeletal animation

위 기능은 제품성을 높일 수 있지만 현재는 범위와 리스크가 크다. Product Alpha에서는 새 사용자의 시작, 검증, 배포 가능성부터 해결한다.
