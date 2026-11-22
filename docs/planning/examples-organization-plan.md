# 예제·데모 정리 (A: 보이는 구조 정리)

상태: 사용자 승인(방향 A), 1~5단계 완료·엔진 결함 수정 대기. 기준일 2026-11-22, 기준 커밋 `7b23edb`,
작업 브랜치 `chore/examples-organization`.

AGENTS.md의 "구조 변경은 문서 합의 먼저" 규칙에 따라 범위와 순서를 먼저 정한다.
이번 정리는 **공개 URL·예제 폴더 이름·패키지 이름을 유지**하고, 사용자에게 보이는 구성과 이름을 정돈한다.
엔진 코어에 내장된 Breakout·Platformer·Shooter 규칙을 예제로 분리하는 일(방향 C)과 폴더 재배치(방향 B)는 범위 밖이다.

## 현재 구성

| 구분 | 항목 |
| --- | --- |
| 공개 앱 7개 | 엔진 기능 실험실(`starter-runtime`, 실험 31종·주제 10개), 물리 심화 실험실(`physics-sandbox`, 시나리오 7종), Breakout, Platformer, Neon Outpost(`topdown-shooter`), 작은 빛의 정원(`pixel-art`), Ferrum2D Studio |
| 숨긴 참고 경로 3개 | `minimal-game`, `starter-runtime/?mode=playground`, `starter-runtime/?mode=starter` |
| 코드 레시피 | `examples/data-scene-native` (엔진 문서가 링크하는 공개 API 레시피와 검증용 glTF, README 없음) |

`examples/README.md`와 `examples/shared/*Catalog.json`의 목록·개수는 서로 일치한다.
공개 Pages는 2026-11-12(`3c023eb`) 배포본이라 통합 물리 변경(#107, #110)을 반영하지 않았다.

## 정리가 안 돼 보이는 원인

1. 물리 시나리오의 이름 원본이 두 곳이다. 실험실은 `examples/shared/physicsExamples.json`("질량·마찰·반발" 등),
   물리 실험실은 자체 `examples/physics-sandbox/public/catalog.json`("강체와 재질 (Rigid Bodies & Materials)" 등)을 쓴다.
   같은 시나리오가 화면마다 다른 이름으로 보이고, 물리 실험실에는 영어 병기가 섞인다.
2. 물리 실험실은 다른 공개 앱과 화면 형식이 다르다. 캔버스에 영문 대문자 디버그 라벨이 겹쳐 그려지고
   (`RUBBER`, `ACTIVE` 등), 기능 실험실의 주제 탐색 없이 별도 앱처럼 보인다.
   실험실의 "물리" 주제는 이미 이 7종을 함께 연결한다.
3. 게임 표시 이름의 형식이 섞여 있다("충돌 반응 · Breakout", "전투 구성 · Neon Outpost", "도트 자산 · 작은 빛의 정원").
4. `data-scene-native`는 실행 앱이 아닌 코드 레시피인데 README와 목록 안내가 없어 역할이 보이지 않는다.
5. 실험 31종 중 HD-2D는 5종이며, 통합 3D 물리의 캐릭터·이동 발판·회전 CCD·군중·네이티브 저장 파일을
   직접 보여 주는 실험이 없다.

## 작업

| 단계 | 내용 | 영향 |
| --- | --- | --- |
| 1. 현재 상태 확인 | `pnpm smoke:example-suite`, `pnpm smoke:feature-examples`로 현재 main의 데모가 모두 동작하는지 기준선을 만든다. 실패는 정리와 별개로 기록·수정한다. | 없음 |
| 2. 코드 레시피 정리 | `examples/data-scene-native`는 엔진 문서 4곳이 공개 API 레시피로 링크하므로 옮기지 않는다. 파일별 역할을 적은 README를 추가하고 `examples/README.md`에 '코드 레시피' 항목으로 올린다. | 경로·링크 유지 |
| 3. 물리 이름 통일 | `physicsExamples.json`을 시나리오 이름·설명의 단일 원본으로 하고, 물리 실험실이 이 이름을 쓰게 한다. 영어 병기와 캔버스 라벨 겹침을 정리한다. 시나리오 id와 `?demo=` 주소는 유지한다. | 화면 문구 변경 |
| 4. 메뉴·표시 정리 | 게임 표시 이름을 `<게임 이름> · <배우는 기능>` 형식으로 맞춘다. 물리 실험실 상단에 "엔진 기능 실험실 › 물리" 경로를 표시해 실험실의 일부로 보이게 한다. | 화면 문구 변경 |
| 5. 문서 동기화 | `examples/README.md`, `docs/engine/showcase-hub.md`, 카탈로그 검증(`validate:example-catalog`)을 갱신한다. | 문서 |
| 6. 최신 기능 실험(선택) | 후보: 캐릭터 이동과 이동 발판, 군중 회피, 물리 상태 저장·복원. 2~5단계 완료 후 항목을 골라 별도로 진행한다. | 기능 추가 |

## 진행 결과

| 단계 | 결과 |
| --- | --- |
| 1. 현재 상태 확인 | 통합 물리(#107) 이후 깨진 데모를 찾아 고쳤다. 물리 재질·지형 파괴 실험과 Engine Playground는 바디가 연결된 world를 다시 설정하다 `BodiesStillBound`로 시작하지 못했다. 이제 기본 native world를 쓰고 `configureAutoRigidBodyStep`·`configureFixedTimestep`으로 설정한다. 물리 갱신 30/60/120Hz는 world 고정 스텝이므로 `?physicsRate=`로 페이지를 다시 연다. `?mode=starter`는 호환 물리로 실행한다. SDK 게임 루프가 0.1ms 미만 프레임 간격에서 멈추던 회귀(0.1.0-beta.10 포함)도 고쳤다. |
| 2. 코드 레시피 정리 | `data-scene-native` README와 `examples/README.md`의 '코드 레시피' 항목을 추가했다. |
| 3. 물리 이름 통일 | 물리 실험실이 `physicsExamples.json`의 이름을 쓰고, 자체 `titleKo`는 카탈로그 검사로 막는다. 분류 탭 "조인트"는 "관절"이다. 이웃한 캔버스 라벨은 높이를 번갈아 둔다. |
| 4. 메뉴·표시 정리 | 게임 이름을 `<게임 이름> · <배우는 기능>`으로 맞추고, 카탈로그 `parent`로 물리 실험실 헤더에 "엔진 기능 실험실 › 물리"를 표시한다. |
| 5. 문서 동기화 | 예제·실험실·물리 실험실 README, 기능·예제 지도, 이 계획을 갱신했다. |

### 엔진 결함 (별도 수정 중)

두 결함은 통합 물리(#107)부터 있었다. #110 이전 Wasm으로도 같은 결과가 나온다.

- 물리 재질 실험의 30Hz(스텝 1/30초)에서 공이 첫 벽 충돌 무렵 `UnresolvedMotion`("actual motion could not be
  certified or resolved")으로 멈춘다. 60·120Hz는 정상이다.
- 물리 실험실의 강체·충돌체·접촉·관절 시나리오가 약 2초 뒤 `CapacityExceeded`("physics capacity exceeded")로
  멈춘다. 상태 표시는 "실행 중"으로 남는다.

두 오류 모두 `physics3d/character_motion/backend.rs`의 실제 운동 승인 경로에서 나는 것으로 보고, 별도 worktree에서
원인을 수정한다. 수정을 반영한 뒤 `smoke:feature-examples`, `smoke:example-suite`를 끝까지 통과시킨다.

## 유지하는 것과 이유

- `minimal-game`: 렌더 smoke 10여 개가 `@ferrum2d/minimal-game`으로 빌드해 사용한다. 이동 비용 대비 이득이 작아 위치를 유지하고, 메뉴에서는 지금처럼 숨긴다.
- `?mode=playground`, `?mode=starter`: 회귀 검사가 사용하며 이미 메뉴에서 숨긴다. URL과 코드를 유지한다.
- 예제 폴더·패키지 이름과 Pages 주소(`starter-runtime/`, `physics-sandbox/` 등): 공개 링크와 스크립트를 깨지 않는다.

## 검증

- 각 단계 후 `pnpm validate:example-catalog`, `pnpm lint`, 영향받는 smoke를 실행한다.
- 마지막에 `pnpm smoke:example-suite`, `pnpm smoke:feature-examples`, `pnpm build:pages`를 실행한다.
- GitHub Pages 재배포는 원격 상태 변경이므로 별도 승인 후 진행한다.
