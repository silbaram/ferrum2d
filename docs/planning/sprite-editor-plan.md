# 엔진 내장 도트 제작 기능 개발 계획

기준일: 2026-10-31
상태: 기본 제작·2차·태그·노멀 생성/HD-2D 연결 완료 · 일반 2D 재질 설계 대기
작업 브랜치: `feat/pixel-authoring`
남은 범위: 일반 2D 게임 sprite의 노멀 재질·조명 계약 설계

기본 드로잉·저장/재열기·씬 적용, 이미지 레이어, 프레임 추가/복제/삭제/순서·시간·재생/정지를 구현하고 검증했다.
v3 편집 원본과 atlas 출력, 지원하는 시간 설정의 실제 2D/HD-2D 게임 재생과 어니언 스킨을 제공한다.
v4 고정 atlas는 프레임 rect/UV와 다른 픽셀을 보존하며 정적 선택 객체에 적용하고 저장·재열기한다.
v5 태그·안정적인 clip ID·명시적 변경 적용과 실제 저장/재열기·2D/HD-2D 복수 clip 재생도 제공한다.
자체 도트의 프레임별 노멀 생성·변경 감지·격리된 조명 미리보기·HD-2D color/normal 동시 적용과 저장/재시작 복원을 제공한다.
일반 2D에서는 노멀 생성·별도 조명 미리보기·내보내기까지 제공하며 게임 sprite의 노멀 재질 적용은 남은 범위다.
현재 schema·예산·호환 정책은 [Scene Authoring](../engine/data-scene-authoring.md#에디터-내장-도트-제작)을,
검증 명령과 범위는 [Smoke Check](../development/quality/smoke-check.md)를 따른다. 이 문서는 남은 개발 범위를 관리한다.

현재 작업의 저장 계약은 `public/assets/.ferrum-pixels/`의 불변 원본 JSON·PNG와 `catalog.json`이다.
기존 desktop allowlist·asset protocol·sprite 저장 transaction을 재사용한다.
열었을 때의 catalog SHA-256을 저장 요청에 포함해 외부 변경을 감지하고, 원본/PNG bytes를 다시 검증한 뒤 자산을 persisted로 표시한다.
씬 저장은 자산 저장 뒤 별도로 수행하며 씬 저장 실패가 이미 저장된 자산의 삭제나 기존 씬 덮어쓰기로 이어지지 않아야 한다.
완료 검증은 실제 Rust 파일 저장·실패 복원·재열기와 새 2D/HD-2D runtime의 상태·픽셀·렌더 비용을 포함한다.

## 목적과 범위

Ferrum2D 안에서 캐릭터·아이콘·타일을 직접 만들고 수정해 게임에 사용하는 도트 제작 편의 기능을 추가한다.
사용자는 **Assets → 새 도트 만들기 → 그리기 → 저장 → 씬에 적용 → 게임에서 확인**까지 엔진의 도구 안에서 진행한다.
빈 캔버스에서 시작하는 제작 흐름이 기준이며, Aseprite 설치·원본 파일·내보내기·CLI 없이 완료할 수 있어야 한다.

Aseprite는 검증된 도구의 코드·알고리즘·UX를 분석하는 참고 대상이다.
드로잉·편집 이력·팔레트·레이어·프레임·어니언 스킨에서 필요한 원리를 가져와 Ferrum2D의 제작 흐름과 기술 구조에 맞게 구현한다.
이 계획의 목표는 Aseprite 파일 호환성 확대가 아니며, 기존 import 지원 실적을 도트 제작 기능의 완료로 계산하지 않는다.

아래 단계는 남은 개발 범위다. 현재 제공하는 기능은 Scene Authoring과 앱 README를 기준으로 하며, 후속 단계를 순서대로 진행한다.

- 에셋 전용 편집 도구로 구성하고 기존 Assets에서 연다. 씬 편집과 에셋 편집의 문서·이력을 구분한다.
- AI agent가 생성·검사·수정할 수 있는 versioned 편집 문서와 검증 가능한 편집 연산을 설계한다.
- Behavior Recipe 본문, FSM/action graph, 게임 로직 timeline, 범용 visual editor는 포함하지 않는다.
- `.aseprite` 파일 호환성 확대와 외부 Aseprite 실행·CLI 연동은 이 계획의 개발 목표에 포함하지 않는다.
- 고급 필터·브러시·blend mode는 기본 제작 흐름이 완성된 뒤 실제 필요에 따라 판단한다.
- 새 production 의존성이나 저장소 최상위 구조 변경이 필요하면 필요성과 대안을 먼저 정리한다.

## 현재 구현과 재사용 지점

기본 도트 편집 모델·캔버스·에셋 문서 탭·브라우저 원본/PNG 내보내기·native 프로젝트 저장/재열기·자산 등록/씬 적용을 구현했다.
다중 이미지 레이어·프레임 애니메이션·어니언 스킨, 기존 고정 atlas frame 편집과 실제 게임 재생을 제공한다.
기존 JSON+PNG import·reimport, 노멀 생성, 원본 저장·재열기는 별도의 가져오기 기능이다.
그 과정에서 검증한 자산 등록·revision·저장·수명 관리 구현은 재사용하되, 새 도트 문서를 Aseprite metadata로 가장하거나 기존 import UI를 제작의 필수 단계로 삼지 않는다.

| 기준 소스 | 재사용할 책임 |
| --- | --- |
| `apps/placement-viewer/src/placementAsepriteTool.ts` | 기존 Assets 통합·취소·문서 수명 패턴. 새 제작 진입점은 별도로 구성 |
| `placementAsepriteAssets.ts`, `placementAsepriteAnimation.ts` | immutable revision과 runtime frame/clip 변환의 재사용 가능 부분 |
| `placementAsepriteProject.ts` | 프로젝트 원본/catalog 저장·검증과 씬 저장 연결 패턴. 새 도트 문서 저장 계약은 별도로 정의 |
| `placementSpriteRevisions.ts`, `placementCatalogTools.ts` | 세션 revision 예산·정리와 참조 보존 경계 |
| `placementPixelDocument.ts`, `placementPixelFrames.ts`, `placementPixelCanvas.ts` | 공통 레이어·프레임별 cel/Undo, UI 전용 미리보기 시계·선택, 캔버스 표시/입력 |
| `placementPixelAnimation.ts`, `placementPixelAssets.ts`, `placementPixelProject.ts` | 프레임 시간의 runtime 변환·진단, 소유한 animation 보호, 불변 revision·저장/재열기 |
| `placementImportDiagnostics.ts` | 원본 항목·씬 경로 진단, 최신 보고 상태와 순회 상한 |
| `placementAsepriteNormals.ts`, `placementAsepriteNormalPng.ts` | frame 경계에 따른 노멀 생성과 source hash 확인 |
| `packages/ferrum-web/src/assetPipelineAseprite.ts` | 기존 가져오기 회귀 경계. 새 도트 제작의 필수 경로로 사용하지 않음 |
| `tests/smoke/aseprite-assets-smoke.mjs`, `aseprite-project-smoke.mjs` | 실제 UI와 Rust 파일 저장·fresh runtime 회귀 패턴 |

현재 사용 계약은 [Aseprite Assets](../engine/data-scene-authoring.md#aseprite-assets-가져오기재import)와
[애니메이션 import](../engine/data-scene-authoring.md#aseprite-애니메이션-import와-migration)를 확인한다.
뷰어 UI 설명은 `apps/placement-viewer/README.md`를 따른다.

## Aseprite 코드 참고 절차

참고 소스는 공식 저장소의 `3669f4774d181d77deb3e6db95fe6df8ca347410` commit을 기준으로 고정했다.
분석용 사본은 `/tmp/ferrum2d-references/aseprite`에 있으며 프로젝트 의존성에 포함하지 않는다.
임시 사본이 삭제되면 위 commit을 다시 받아 재개한다. 아래 책임을 필요한 기능의 구현에 참고한다.

| 참고 소스 | 분석할 내용 | Ferrum2D 적용 기준 |
| --- | --- | --- |
| [드로잉 도구](https://github.com/aseprite/aseprite/tree/3669f4774d181d77deb3e6db95fe6df8ca347410/src/app/tools) | `tool_loop_manager.cpp`, `intertwiners.h`의 입력·stroke·보간·확정/취소 흐름 | UI 이벤트와 픽셀 연산을 분리하고 빠른 드래그에서도 끊김 없는 드로잉 제공 |
| [영역 채우기](https://github.com/aseprite/aseprite/blob/3669f4774d181d77deb3e6db95fe6df8ca347410/src/doc/algorithm/floodfill.cpp) | 연결 영역 탐색과 픽셀 경계 처리 | 문서 크기에 따른 작업·메모리 상한과 Undo/취소 검증 |
| [문서·이미지 구조](https://github.com/aseprite/aseprite/tree/3669f4774d181d77deb3e6db95fe6df8ca347410/src/doc) | `image`, `palette`, `sprite`, `layer`, `cel`의 책임과 관계 | 자체 versioned 편집 문서와 게임용 출력물을 분리 |
| [편집 transaction](https://github.com/aseprite/aseprite/blob/3669f4774d181d77deb3e6db95fe6df8ca347410/src/app/transaction.cpp) | `transaction.cpp`, `cmd_transaction.cpp`와 도구 입력에서 이어지는 Undo/Redo 경계 | 한 stroke당 한 Undo, 문서별 이력과 취소·수명 보장 |
| [어니언 설정](https://github.com/aseprite/aseprite/blob/3669f4774d181d77deb3e6db95fe6df8ca347410/src/render/onionskin_options.h), [합성](https://github.com/aseprite/aseprite/blob/3669f4774d181d77deb3e6db95fe6df8ca347410/src/render/render.cpp) | `OnionskinOptions`, `Render::renderOnionskin`의 인접 범위·자기 제외·tint·opacity·뒤쪽 표시 | 자체 UI 보기 상태와 최대2개 인접 합성으로 구현. 원본/게임 출력에 섞지 않음 |

분석 산출물에는 참고 commit/파일·선택한 원리·Ferrum2D 적용 위치·회귀 검증을 남긴다.
직접 코드를 재사용할 경우 해당 소스의 사용 조건을 확인하고 출처를 기록한다.
C++ 데스크톱 UI나 문서 구조 전체를 옮기지 않고, 필요한 알고리즘과 설계 원리를 TS 편집 모델·canvas·기존 asset 경계에 맞춘다.

적용 근거:

- `ToolLoopManager::end`와 `Transaction`의 확정/rollback 경계를 참고해 픽셀 transaction을 분리했다.
  `placementPixelDocument.ts`가 stroke/fill과 Undo를 소유하고 `placementPixelCanvas.ts`는 입력·보기 상태만 소유한다.
- stroke의 점 연결 원리를 정수 선 보간과 선분 clipping에 적용했다. flood fill의 연결 영역·투명 픽셀 동등성은 문서 크기로 제한한 자체 queue 연산으로 구현했다.
- `Image`와 `Cel`의 이미지/레이어/프레임 책임 분리를 참고해 자체 원본에 stable layer/frame ID를 둔다.
  기존 v1을 유지하고 현재 v3의 공통 layer metadata·프레임별 cel과 연결한다.
- 외부 C++ 코드를 복사하거나 Aseprite 앱에 실행 의존성을 추가하지 않았다.

## 단계별 개발

### 남은 3차: 일반 2D 게임용 노멀 재질 설계

현재 제공하는 생성·미리보기·HD-2D 적용·저장 계약은 [도트 노멀 생성](../engine/data-scene-authoring.md#도트-노멀-생성과-조명-미리보기)을 따른다.
일반 2D sprite에는 노멀 재질 연결 API가 없어 별도 dialog에서 보는 조명을 실제 2D 게임 조명으로 간주하지 않는다.

착수 전 결정할 사항:

- 2D sprite 재질과 광원 좌표·감쇠·alpha·색 공간 계약, 기존 unlit 출력과의 호환 정책.
- render command/Wasm ABI 및 WebGL2/WebGPU 경계의 영향과 draw/texture/memory 예산.
- 기존 도트 frame/태그 UV·source hash·normal binding 재사용 범위와 저장 migration.
- 기존 2D 조명·그림자 기능과 통합할 범위, 미리보기와 실제 게임 출력의 대응 기준.

구현 범위는 설계를 확인한 뒤 확정한다. 완료 시 새 2D runtime에서 frame별 normal/flat 조명 차이·재생·저장/재열기·자원 해제를 검증하고 기존 unlit 출력 회귀를 통과해야 한다.

## 화면과 입력

Assets의 **새 도트 만들기** 또는 기존 자산의 **도트 편집**으로 에셋 문서 탭을 연다.
그리기와 씬 적용은 별도 명시적 동작으로 구분한다. 기존 클릭 배치/드래그 동작을 유지하고 상단 전역 버튼을 늘리지 않는다.

| 영역 | 내용 |
| --- | --- |
| 왼쪽 | 그리기 도구, 전경색/투명도, 팔레트 |
| 가운데 | 픽셀 캔버스, 격자, 확대/이동 |
| 오른쪽 | 문서 크기·속성·이미지 레이어 |
| 아래 | 프레임 목록·시간·재생과 접이식 어니언 스킨 설정 |

- Ctrl/Cmd+Z, Space 이동 등 단축키는 활성 편집 문서에만 전달한다. 텍스트 입력과 게임 입력을 가로채지 않는다.
- 씬의 Undo/Redo와 스프라이트 픽셀 이력을 분리한다. 탭 전환 시 활성 문서와 변경 상태를 명확히 표시한다.
- pointer 좌표는 CSS 크기·DPR·확대·pan을 반영해 정수 픽셀로 변환하고 캔버스 밖 쓰기를 차단한다.
- UI 구현 시 `pixelforge-design-system`과 기존 한국어/영어 전환을 적용한다.

## 데이터·저장·책임 경계

- 편집 원본에는 version, dimensions, 안정적인 frame/layer ID, 팔레트, 픽셀 데이터를 저장한다.
  구체적인 schema·파일명·경로·migration 정책은 1차 설계 산출물로 확정한다.
- 픽셀 데이터의 기준 표현과 허용할 합성/색 공간을 하나로 정한다. 저장 원본에 전체 Undo history를 누적하지 않는다.
- AI 편집은 검증 가능한 stroke/fill/palette/frame 연산과 동일한 검증 경계를 사용하도록 설계한다.
  UI 전용 상태와 게임 simulation state를 편집 문서에 넣지 않는다.
- 편집 원본과 게임용 PNG/atlas/manifest의 관계·revision/hash를 기록한다. PNG만 저장해 편집 정보를 잃지 않도록 한다.
- 열려 있는 픽셀 문서·해당 Undo/Redo가 사용하는 원본 revision도 Catalog 정리의 보존 대상에 연결한다.
  현재 씬·Import 후보의 보존만으로 픽셀 문서의 참조까지 보호된다고 가정하지 않는다.
- 새 도트는 Ferrum2D 편집 문서를 원본으로 저장한다. PNG 등 외부 이미지에서 시작해도 입력 파일을 덮어쓰지 않고 별도 편집 원본과 출력물을 만든다.
- native 저장은 프로젝트 allowlist·파일 검증·동시 수정 충돌 감지를 사용한다. 실패 시 이전 catalog/씬을 유효하게 유지한다.
- browser-only 환경은 다운로드/export와 재열기를 제공한다. native 프로젝트 저장 성공과 구분해 표시한다.
- color/frame 변경 시 normal binding을 재검증하고 재생성 필요 상태를 표시한다.
- TypeScript는 편집 데이터·브라우저 canvas·asset 변환을 담당한다. Rust는 기존 simulation·runtime animation·render command 소유권을 유지한다.
- 픽셀 stroke마다 씬을 재생성하거나 엔티티별 Wasm 호출을 하지 않는다. 명시적 적용 시 기존 asset/placement 경로로 반영한다.

1차 편집기 예산은 문서 한 변 최대 256픽셀, 원본 JSON 400,000 bytes, Undo/Redo 합계 최대 64단계와 pixel history 16 MiB다.
단계 수와 실제 snapshot byte 상한을 함께 적용한다. 256×256에서는 before/after RGBA snapshot 32단계가 byte 상한이다.
현재 이미지 레이어는 최대 8개, v2 원본은 3 MiB이며 전체 layer snapshot이 같은 16 MiB history 예산을 사용한다.
v3는 최대 16프레임·8레이어이며 전체 cel 합계 2,097,152픽셀(8 MiB RGBA), 원본 12 MiB다.
전체 cel snapshot이 같은 16 MiB history 예산을 공유한다. 기존 catalog 예산은 자동으로 확대하지 않는다.

현재 원본은 `ferrum2d.pixel-document` v1/v2/v3/v4/v5로 width/height·sRGB·layer/frame ID·팔레트·straight-alpha RGBA8 base64를 담는다.
v1은 기존 단일 layer/rgba, v2는 아래→위 순서 layers 배열과 각 표시·잠금·독립 RGBA를 저장한다.
v3는 공통 layer metadata와 프레임별 시간·cel을 저장하며, 모든 프레임 합성을 최대4×4 atlas PNG로 출력한다.
runtime은 GCD 시간 단위의 반복 UV로 태그가 없으면 단일 clip, v5 태그가 있으면 태그별 clip을 생성한다. 각 clip의32 native frame/FPS 한도를 넘으면 게임 적용을 막고 진단한다.
v4 고정 atlas와 v5 태그의 계약·한도·참조 보존 정책은 Scene Authoring을 따른다.
UI 상태·Undo 이력은 저장하지 않으며 PNG는 RGBA를 직접 인코딩해 canvas premultiplication으로 인한 원본 수치 손실을 피한다.
게임용 `ferrum2d.pixel-assets` v1 bundle은 불변 PNG revision·SHA-256·원본·manifest·현재 scene document를 담는다.
PNG 생성 전 원본 snapshot을 확정하며 적용 실패의 미확정 revision만 rollback한다.
runtime 숫자 ID는 scene 저장·문서 경계에서도 확인하고, export scene 사본의 지원하는 texture/normal 경로는 안정적인 이름으로 변환한다.
등록은 최대 8 revision/64 MiB인 별도 세션 store를 사용하며 열린 씬·Undo/Redo·현재 배치 도구의 참조를 보존한 뒤 명시적으로 정리한다.

브라우저의 내보내기는 프로젝트 디스크 저장 완료가 아니다. 미설치 세션 자산을 참조하는 scene Save는 차단한다.
현재는 내보낸 원본을 재열거나, bundle의 PNG/manifest/scene을 프로젝트에 설치해 사용한다.
native 프로젝트 allowlist·원본/catalog 등록·충돌 감지·실제 파일 저장/재열기는 구현했다.
저장 계약과 현재 검증은 Scene Authoring과 Smoke Check를 기준으로 하며 native GUI·실물 GPU 검증은 별도다.

## 검증과 문서 반영

| 범위 | 검증할 내용 |
| --- | --- |
| 편집 연산 | 정수 좌표·경계 clipping, 보간 stroke, alpha, fill의 메모리/작업 상한, 한 stroke의 Undo/Redo·취소 |
| 원본/출력 | 잘못된 version·치수·pixel 길이·hash, 원본 불변, serialize/reopen·PNG export roundtrip |
| UI | DPR 1/2와 zoom/pan 좌표, 입력 focus, 탭/dirty 상태, 키보드 조작과 한국어/영어 |
| 저장 | 실패·취소·동시 수정·늦은 응답, 실제 Rust 파일 저장/재열기, browser export 구분 |
| 씬 통합 | 새 revision 적용·단일 Undo/Redo, collider/behavior 보존, fresh game 렌더링, 오래된 노멀 차단 |
| 수명/예산 | 문서·history 상한, 반복 열기/닫기, URL·bitmap·GPU 자원과 진행 작업 정리 |

구현 파일의 단위 검사와 실제 브라우저 smoke를 단계별로 추가하고 CI의 실제 실행 gate에 연결한다. 새 smoke 이름은 구현할 때 등록하며 현재 명령처럼 안내하지 않는다.
기존 회귀 명령은 변경 범위에 맞춰 실행한다.

```bash
pnpm lint
pnpm --filter @ferrum2d/ferrum-web test
pnpm --filter @ferrum2d/placement-viewer build
pnpm smoke:placement-viewer
pnpm smoke:aseprite-assets
pnpm smoke:aseprite-project
pnpm test:pixel-authoring
pnpm smoke:pixel-authoring
pnpm smoke:pixel-project
pnpm validate:public-api-surface
```

SDK API/package/consumer template가 실제로 바뀌면 해당 public surface·package·consumer 검증을 추가한다.
Rust/ABI 변경이 없는 에셋 제작 작업에 simulation 기능을 함께 추가하지 않는다.

기능이 구현된 단계부터 app README·Scene Authoring·architecture·Smoke Check에 현재 계약을 반영한다.
완료 단계의 로그는 `artifacts/`에 남기고 이 문서는 남은 범위 중심으로 갱신한다. 전체 완료 시 사용법을 기준 문서로 옮기고 이 계획과 목록 링크를 삭제한다.

## 작업 체크리스트와 재개 절차

- [x] 1차: Aseprite 참고 commit·관련 코드 분석과 Ferrum2D 적용 원리 정리
- [x] 1차: 자체 편집 원본·입력·브라우저 내보내기·session revision·예산 계약
- [x] 1차: 캔버스·기본 도구·팔레트·Undo/Redo·취소
- [x] 1차: 브라우저 원본 재열기·PNG export·Assets 등록·씬 적용 통합 검증
- [x] 1차: native 프로젝트 원본/catalog 저장 위치·충돌 감지·실패 복원·실제 저장/재열기
- [x] 1차: Aseprite 설치·파일 없이 새 도트 제작→저장→씬 적용→fresh game 검증과 사용법 동기화
- [x] 2차: 이미지 레이어·합성·잠금·Undo/Redo·원본 보존·저장/재열기·fresh game 검증
- [x] 2차: 프레임·시간·미리보기·어니언 스킨·고정 atlas frame 편집
- [x] 2차: 출력/재생 호환·원본 보존·예산 회귀
- [x] 3차: frame tag·안정적인 clip ID·명시적 migration·저장/재열기·실제 복수 clip 재생
- [x] 3차: 노멀 재생성·원본 hash/frame 경계·normal binding 검증
- [x] 3차: 2D 격리 조명 미리보기·HD-2D 게임 적용·저장/재시작·자원 정리·문서 동기화
- [ ] 3차 후속: 일반 2D 게임 sprite의 노멀 재질 계약·예산 설계와 범위 확정
- [ ] 3차 후속: 확정된 2D 재질 구현·실제 게임 조명·저장/재열기·회귀 검증

세션 재개 시 이 문서와 planning 목록, 현재 branch/diff를 먼저 확인한다.
첫 미완료 항목부터 진행하고 기존 미커밋 변경을 보존한다. 실제 검증이 통과한 항목만 완료로 표시한다.

## 참고

- [Aseprite 소스 저장소](https://github.com/aseprite/aseprite)
- [Aseprite 드로잉 도구 소스](https://github.com/aseprite/aseprite/tree/3669f4774d181d77deb3e6db95fe6df8ca347410/src/app/tools)
- [Aseprite 문서·이미지 소스](https://github.com/aseprite/aseprite/tree/3669f4774d181d77deb3e6db95fe6df8ca347410/src/doc)
- [기존 제작 편의성 후보](game-development-convenience-review.md)
- [개발 검증 기준](../development/quality/smoke-check.md)
