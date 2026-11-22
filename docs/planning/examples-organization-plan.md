# 예제·데모 정리 (A: 보이는 구조 정리)

상태: 사용자 승인(방향 A), 1~5단계 완료, 예제 보기 화면 개선 1~2단계 완료·3단계 대기. 기준일 2026-11-22, 기준 커밋 `7b23edb`,
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
| 6. 최신 기능 실험(선택) | 후보: 캐릭터 이동과 이동 발판, 군중 회피, 네이티브 게임 파일 저장·복원. 2~5단계 완료 후 항목을 골라 별도로 진행한다. | 기능 추가 |

## 진행 결과

| 단계 | 결과 |
| --- | --- |
| 1. 현재 상태 확인 | 통합 물리(#107) 이후 깨진 데모를 찾아 고쳤다. 물리 재질·지형 파괴 실험과 Engine Playground는 바디가 연결된 world를 다시 설정하다 `BodiesStillBound`로 시작하지 못했다. 이제 기본 native world를 쓰고 `configureAutoRigidBodyStep`·`configureFixedTimestep`으로 설정한다. 물리 갱신 30/60/120Hz는 world 고정 스텝이므로 `?physicsRate=`로 페이지를 다시 연다. `?mode=starter`는 호환 물리로 실행한다. SDK 게임 루프가 0.1ms 미만 프레임 간격에서 멈추던 회귀(0.1.0-beta.10 포함)도 고쳤다. |
| 2. 코드 레시피 정리 | `data-scene-native` README와 `examples/README.md`의 '코드 레시피' 항목을 추가했다. |
| 3. 물리 이름 통일 | 물리 실험실이 `physicsExamples.json`의 이름을 쓰고, 자체 `titleKo`는 카탈로그 검사로 막는다. 분류 탭 "조인트"는 "관절"이다. 이웃한 캔버스 라벨은 높이를 번갈아 둔다. |
| 4. 메뉴·표시 정리 | 게임 이름을 `<게임 이름> · <배우는 기능>`으로 맞추고, 카탈로그 `parent`로 물리 실험실 헤더에 "엔진 기능 실험실 › 물리"를 표시한다. |
| 5. 문서 동기화 | 예제·실험실·물리 실험실 README, 기능·예제 지도, 이 계획을 갱신했다. |

### 전체 검사에서 찾은 결함

데모 쪽에서 고친 것:

- 씬 전환 실험이 프레임 콜백 안에서 장면을 바꾸다 거부돼 암전에서 멈췄다. 전환을 프레임이 끝난 뒤로 미룬다.
- 저장·불러오기 실험과 HD-2D 그림자 대역 실험의 "재생 상태 JSON"은 JSON 진행 저장을 쓴다. 통합 물리에서는
  Data Scene 물리의 JSON 저장을 지원하지 않으므로 두 실험만 호환 물리로 실행한다.
- HD-2D 환경 실험의 그림자 검사가 혼합 조명에서 7번 그리기를 기대했다. 그림자는 조명별로 캐시되므로
  점광을 더하면 큐브 6면만 새로 그리고 태양 그림자는 재사용한다. 검사를 이 동작에 맞췄다.

엔진에서 고친 것과 고치는 것:

- 물리 재질 실험의 30Hz에서 공이 첫 벽 충돌 무렵 `UnresolvedMotion`으로 멈췄다(#107부터). 회전하는 중심 공의
  운동 승인을 고쳐 반영했다.
- 물리 실험실의 강체·충돌체·접촉·관절 시나리오가 약 2초 안에 `CapacityExceeded`로 멈춘다(#107부터). 센서
  쪽 원인 하나는 고쳤지만, 회전 상자 접촉의 운동 증명 한계는 물리 불변식을 바꾸는 설계 결정이 필요하다.
  [통합 3D 물리 계획](unified-3d-physics-plan.md#미해결-회전-상자-접촉의-운동-증명-2026-11-22)으로 분리했다.
  rigid 물리 설정은 엔진 backend와 무관하게 통합 물리를 쓰므로 호환 물리로 우회할 수 없다. 실험실은 멈추면
  "실행 중" 대신 오류와 원인을 표시하고, 실험실 smoke는 이 4개를 알려진 오류로 두고 나머지 3개의 무오류를 검사한다.
- `physics`를 생략한 HD-2D 장면의 heightSpan 주인공을 엔진 기본 native world가 거부했다. HD-2D 이동·AI 전투
  실험과 `data-scene-native/spatial.mjs` 레시피가 시작하지 못했다. 내장 장면에서 처음 전환하고 기본 물리 설정이
  그대로면 호환 물리로 실행하도록 고쳐 반영했다. 이미 native world로 실행 중인 Data Scene에 이런 문서를 다시
  적용하는 경우(예: Studio 같은 Engine의 편집→게임 재적용)는 여전히 거부하며, 실행한 world를 버릴지는 제품 결정이 필요하다.
- 통합 물리에서 `configureAutoRigidBodyStep({ ... })`가 중력을 바꿔도 `frame.physics` 중력 표시가 그대로였다
  (지형 파괴 실험 검사). native가 수용한 중력·연속 충돌을 표시하도록 SDK를 고쳤다.

네이티브 게임 파일로 바꾼 저장 실험은 복원한 Engine에 Data Scene 도구를 다시 연결하는 SDK 공개 API가 먼저
필요하다. 6단계 후보로 따로 진행한다.

## 예제 보기 화면 개선

### 배경

공개 사이트의 `/`는 기능 실험실로 바로 이동한다. 다른 예제로는 머리글의 "예제 이동" 드롭다운으로만 간다. 실험실의 주제·실험
목록은 같은 모양의 글자 버튼이라, 눌러 보기 전에는 무엇을 보여주는 실험인지 알기 어렵다. 2026-11-09에는 글자 카드로 된
이전 허브를 없애고 실험실로 바로 연결했다(실험실 탐색과 겹쳤다).

Phaser·Bevy·PixiJS·Defold 예제 사이트를 확인한 공통 방식은 다음과 같다. 카드마다 실제 화면 스크린샷·이름·한 줄 설명을 두고,
분류별로 묶어 개수를 보이며, 예제 페이지에서는 실행 화면 바로 아래에 소스와 이전/다음 이동을 둔다. 난이도 배지는 없다.

### 결정 (2026-11-22 사용자 승인)

- 시안(첫 화면 갤러리·실험 페이지)의 방향을 승인했다. 시각 스타일은 Studio와 같은 Pixelforge 디자인 체계를 따른다.
- 아래 4단계로 나누고 1단계부터 구현한다. 게임 데모와 물리 실험실도 4단계에서 같은 틀로 맞춘다.
- 썸네일은 검사 도구로 자동 생성해 저장소에 둔다(약 1MB).

| 단계 | 내용 |
| --- | --- |
| 1. 첫 화면 갤러리 | 완료. `/`가 예제 갤러리다. 아래 1단계 범위 참조. |
| 2. 실험 페이지 탐색 | 완료. 1280px 이상에서 왼쪽 주제 목록(아이콘·색·개수·썸네일), 더 좁으면 선택 상자, 실행 화면 아래 이전/다음. |
| 3. 코드 보기 | 실행 화면 아래에 설명·씬 JSON·API 탭을 두고 실제 씬 파일과 GitHub 링크를 보인다. |
| 4. 공통 틀 | 실험실·물리 실험실·게임 데모가 같은 Pixelforge 머리글·패널 틀을 쓰게 한다. |

### 1단계 범위

- 빌드할 때 `exampleCatalog.json`·`featureCatalog.json`·`featureTopics.json`·`physicsExamples.json`에서 갤러리 HTML을
  만든다. 두 번째 예제 목록을 따로 두지 않는다. JavaScript 없이도 모든 카드와 링크가 동작하고, 스크립트는 분류·검색만 더한다.
- 분류: 게임 데모, 기능 실험(주제 10개), 물리 심화 실험실, 도구·코드 레시피. 왼쪽 목록에 개수를 보이고 분류·검색어는 주소에 남긴다.
- 카드: 썸네일, 이름, 실험의 "어떤 때 쓰는지"(`lesson.useCase`), 주제 색과 2D/HD-2D 표시. 게임은 "배우는 기능"을 따로 표시한다.
- 알려진 문제: `physicsExamples.json`의 `knownIssue`를 단일 원본으로 배지를 표시한다. 물리 실험실 smoke의 예외 목록도 이 값을 읽는다.
- 썸네일: `examples/shared/thumbnails/`에 두고 `pnpm thumbnails:examples`로 다시 만든다. 카탈로그 검사가 누락을 거부한다.
- 각 예제 머리글의 "Ferrum2D 예제"는 사이트 안에서 갤러리로 돌아가는 링크가 된다. 예제 주소·폴더·패키지 이름은 그대로다.
- 외부 글꼴·CDN을 쓰지 않는다. 한글은 기존 Noto Sans KR 부분집합, 아이콘은 Lucide 일부를 라이선스와 함께 저장소에 둔다.
- 검증: 카탈로그 빌드 테스트, `pnpm smoke:example-suite`(카드 수·링크·썸네일·검색·JavaScript 없음·390/320px), Pages 산출물 검사.

## 유지하는 것과 이유

- `minimal-game`: 렌더 smoke 10여 개가 `@ferrum2d/minimal-game`으로 빌드해 사용한다. 이동 비용 대비 이득이 작아 위치를 유지하고, 메뉴에서는 지금처럼 숨긴다.
- `?mode=playground`, `?mode=starter`: 회귀 검사가 사용하며 이미 메뉴에서 숨긴다. URL과 코드를 유지한다.
- 예제 폴더·패키지 이름과 Pages 주소(`starter-runtime/`, `physics-sandbox/` 등): 공개 링크와 스크립트를 깨지 않는다.

## 검증

- 각 단계 후 `pnpm validate:example-catalog`, `pnpm lint`, 영향받는 smoke를 실행한다.
- 마지막에 `pnpm smoke:example-suite`, `pnpm smoke:feature-examples`, `pnpm build:pages`를 실행한다.
- GitHub Pages 재배포는 원격 상태 변경이므로 별도 승인 후 진행한다.
