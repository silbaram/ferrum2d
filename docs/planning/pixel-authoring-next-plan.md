# 도트 제작 후속 고도화 개발 계획

기준일: 2026-11-01
상태: 계획 정리 완료 · 기능 구현 미착수
다음 개발: 1단계 픽셀 퍼펙트 연필

## 목표와 현재 기준

직접 그린 도트의 선 품질과 부분 선택을 개선하고, 반복 무늬·타일·애니메이션을 수정하는 시간을 줄인다.
현재 구현과 사용법은 [Scene Authoring](../engine/data-scene-authoring.md#에디터-내장-도트-제작),
검증은 [Smoke Check](../development/quality/smoke-check.md)를 기준으로 한다.
이미 제공하는 선택 이동/반전/90도 회전·자동 복구·브러시 크기/대칭/도형·팔레트·여백/자르기·실제 크기 보기·어니언·노멀 생성을 신규 개발 항목으로 등록하지 않는다.

Aseprite는 동작·알고리즘과 책임 분리의 참고 대상이다. 자체 TS 도트 편집 모델에 맞게 구현하며
외부 Aseprite 설치·파일 호환성·CLI 실행은 이번 개발의 전제 조건이 아니다.
아래는 개발 예정 범위이며 현재 엔진에서 사용할 수 있다는 의미가 아니다.

## 우선순위와 진행 상태

| 순서 | 우선순위 | 개발 항목 | 현재 한계 | 상태 |
| --- | --- | --- | --- | --- |
| 1 | 높음 | 픽셀 퍼펙트 연필 | 선분 연결은 있지만 자유곡선의 불필요한 모서리 픽셀 보정은 없음 | 미착수 |
| 2 | 높음 | 선택 마스크 확장 | 사각형 선택만 있어 불규칙한 부분을 골라 수정하기 어려움 | 미착수 |
| 3 | 높음 | 자동 외곽선 | 도형 윤곽선은 있지만 이미지 실루엣을 따르는 테두리 생성은 없음 | 미착수 |
| 4 | 보통 | 선택 영역 이미지 브러시 | 사각 단색 브러시 중심이며 직접 그린 무늬를 반복 찍을 수 없음 | 미착수 |
| 5 | 보통 | 반복 타일 편집 | 단일 이미지 보기·경계 clip만 있어 반복 연결부를 확인하며 그리기 어려움 | 미착수 |
| 6 | 보통 | 여러 프레임 동시 편집 | 문서 전체 색 교체와 별개로 선택 프레임들의 같은 부분을 함께 이동/반전할 수 없음 | 미착수 |

기본 순서는 1→2→3→4→5→6이다. 2단계 마스크를 이후 부분 편집의 공통 기반으로 사용한다.
별도 기반 개선인 차분 Undo는 아래 측정 조건을 충족할 때 독립 작업으로 진행한다.
이번 문서 정리에서 기능 구현을 시작하지 않는다.

## 공통 설계 원칙

- 원본/픽셀/이력은 `placementPixelDocument.ts`, 포인터/보기는 `placementPixelCanvas.ts`, 연결과 수명은 `placementPixelTool.ts`가 소유한다. 새 연산은 필요한 순수 함수나 전용 controls로 분리한다.
- source v1~v5, frame/layer/tag/clip ID, straight-alpha RGBA와 투명 픽셀 RGB를 보존한다. UI 선택·브러시·반복 보기 설정을 원본에 임의로 추가하지 않는다.
- 한 변256·레이어8·프레임16·전체2,097,152 cel 픽셀·이력64단계/16MiB의 기존 상한을 기준으로 한다. 추가 UI 버퍼도 별도로 상한을 둔다.
- preview/선택/설정 변경은 원본·dirty·Undo·씬·GPU 자산을 확정하지 않는다. 픽셀 확정은 한 Undo, 취소·blur·pointercancel은 이전 상태 복원이다.
- editor identity/revision·선택 frame/layer/atlas·씬/프로젝트가 바뀌면 오래된 preview/비동기 결과를 폐기한다. 잠금·숨김·재생 중 편집 정책과 atlas 인접 rect 보호를 유지한다.
- 원본이 변하면 기존 노멀의 provenance를 무효화하고 명시적 재생성/검증 cache 경로를 사용한다. 복구는 확정 원본만 기록한다.
- 씬 적용·프로젝트 저장은 기존 명시적 경로를 사용한다. 객체 크기·pivot·collider/body·behavior를 그림 편집 때문에 자동 변경하지 않는다.
- Rust simulation·Wasm ABI·게임 runtime을 확대하지 않는다. 새 production 의존성이나 source 형식이 필요해지면 필요성·대안·호환 범위를 먼저 설계한다.

## 1단계 — 픽셀 퍼펙트 연필

### 범위

- 연필 옵션에 명시적 켜기/끄기를 추가한다. 첫 범위는 1픽셀 자유 그리기이며 일반 선분 보간 동작은 유지한다.
- 큰 브러시 등 미지원 조합은 옵션의 비활성 상태와 이유를 표시한다. 설정이 켜져 있는데 보정이 적용되지 않는 상태로 두지 않는다.
- 연속된 세 점이 만드는 L자 모서리의 불필요한 중간 픽셀을 보정한다. 지우개·큰 브러시·도형으로 자동 확대하지 않는다.
- 지워야 하는 점은 투명색으로 덮는 대신 해당 stroke 이전 픽셀로 복원한다. 기존 그림 위에 그려도 바탕을 손상하지 않는다.

### 완료 조건

- 느린/빠른 입력, 모든 방향의 모서리·직선·역주행·같은 좌표 반복에서 끊김과 이중 두께를 검사한다.
- 선택 마스크·대칭·atlas 경계·반투명 색을 함께 검사한다. 보정점 복원과 취소가 원래 RGBA를 보존한다.
- pointerup 한 Undo, Escape/blur/lost capture 취소와 no-op의 Redo 보존을 확인한다. 옵션은 UI 전용이다.

## 2단계 — 선택 마스크 확장

### 범위

- 선택을 bounding rect와 0/1 픽셀 마스크로 표현해 기존 사각형과 함께 사용한다. 한 프레임 최대256×256의 bounded 버퍼를 사용한다.
- 색상 선택·연결 영역 선택(마술봉)·자유형/다각형 선택과 교체/추가/빼기/교차를 제공한다.
- 색상 선택 기본은 정확한 RGBA다. 허용 오차와 연결 조건은 명시적으로 표시하고, 투명 RGB 처리도 기존 채우기의 정책과 구분해 정한다.
- 복사/잘라내기/이동/반전/90도 회전·그리기/채우기의 최종 쓰기 마스크에 연결한다. 선택 변경 자체는 현재처럼 UI 상태로 유지한다.

### 완료 조건

- 비선택 픽셀과 구멍을 보존하고, 겹치는 이동에서도 선택 밖 바탕을 지우지 않는다. 내부 clipboard는 RGBA와 마스크를 함께 유지한다.
- Shift/Alt 등 조합은 기존 pan·도형·텍스트 입력 단축키와 충돌하지 않도록 확정한다.
- 빈 마스크·분리된 영역·부분 clip·투명 픽셀·변형 후 mask/pixel 정렬을 검사한다. 선택만으로 원본/이력이 바뀌지 않는다.
- 확정 한 Undo, 취소/대상 전환 폐기와 v1~v5·고정 atlas·한글/영문 동작을 확인한다.

## 3단계 — 자동 외곽선

### 범위

- 이미지의 알파 실루엣을 기준으로 1픽셀 안쪽/바깥쪽 테두리와 4/8방향 이웃을 제공한다.
- 도형의 윤곽/채움 옵션과 구분해 **효과** 메뉴에서 실행한다. 기본 경계는 alpha>0이며 테두리 RGBA를 명시한다.
- 선택 cel 또는 선택 마스크에 미리보고 확정한다. 문서 크기 자동 확대나 인접 atlas rect 수정은 하지 않는다.

### 완료 조건

- 구멍·분리된 실루엣·모서리·프레임 가장자리·반투명 가장자리와 안쪽/바깥쪽 차이를 픽셀 단위로 검사한다.
- 선택 영역·기존 바탕·원본의 다른 cel을 보호하고 잘릴 부분을 표시한다. 취소/한 Undo·노멀 stale·복구/저장 경로를 유지한다.

## 4단계 — 선택 영역 이미지 브러시

### 범위

- 선택한 RGBA와 마스크를 세션 브러시로 만들어 꽃·잎·돌 같은 무늬를 반복 찍는다. 기본은 원본 색/알파 사용이며 투명·비선택 부분은 바탕을 덮지 않는다.
- 최초 상한은 브러시32×32·8슬롯·픽셀/마스크 합계64KiB를 제안한다. 초과 입력은 조용히 자르지 않고 거절한다.
- 중심점·찍기 간격·미리보기를 제공한다. 브러시 목록과 설정은 UI 세션 상태이며 원본 교체/종료 시 해제한다.

### 완료 조건

- 빠른 드래그의 간격·끝점·겹침과 알파 적용 규칙을 정하고, 선택 마스크/대칭/경계에서도 동일하게 동작한다.
- 원본 브러시 픽셀을 수정하지 않으며 드래그 한 Undo·취소 복원을 지킨다. 슬롯 교체와 탭/문서 전환의 오래된 preview를 해제한다.

## 5단계 — 반복 타일 편집

### 범위

- **보기**에 가로/세로 반복과3×3 미리보기를 추가한다. 주변 타일은 같은 원본을 표시하며 별도 원본/cel을 만들지 않는다.
- 중앙 타일에서 시작한 stroke가 경계를 넘으면 지정 축의 반대편으로 이어 그린다. 새 stroke의 시작 영역은 중앙 타일로 표시한다.
- floor modulo로 음수 좌표도 처리하고 선택 마스크는 wrap 이후 최종 제한으로 적용한다. 중복 좌표 쓰기 정책을 고정한다.
- 첫 버전은 고정 atlas v4에서 이 모드를 명시적으로 차단한다. standalone 프레임 제작과 씬의 tile map authoring을 구분한다.

### 완료 조건

- 양/음 방향의 가로·세로·모서리 횡단, 브러시가 한 변보다 큰 경우와 빠른 드래그를 bounded 연산으로 검사한다.
- pan/zoom·DPR1/2에서 동일한 좌표를 사용한다. 반복 보기 전환은 원본/dirty/Undo를 바꾸지 않고 PNG는 원본 한 장으로 내보낸다.
- 3×3 보기가 source/GPU 자산 수와 자체 재생 루프를 늘리지 않으며 접기·비활성·종료 시 표시 자원을 해제한다.

## 6단계 — 여러 프레임 동시 편집

### 범위

- 도트 프레임 막대에서 대상 프레임 범위를 선택하고 같은 레이어/선택 영역의 이동·좌우/상하 반전부터 제공한다.
- 현재 문서 전체 RGBA 교체 기능을 다시 구현하지 않는다. 대상 frame/layer ID·대상/제외 cel 수·잘림을 확인한 뒤 한 transaction으로 확정한다.
- 숨김/잠금 cel은 제외 사실을 표시한다. 대상 변경·잘못된 ID·예산 초과는 부분 적용 전에 거절한다.

### 완료 조건

- 선택 범위만 바뀌고 비대상 cel·태그·clip 순서/ID·초기 clip·시간 metadata가 유지된다.
- 프레임별 RGBA/mask 정렬, 겹치는 이동과 잘림, 실패 원자성·전체 한 Undo/Redo를 검사한다.
- 취소·재생/문서 전환·노멀 무효화·복구·내보내기·native 저장/재열기를 확인한다. 게임 behavior timeline 편집으로 확장하지 않는다.

## 별도 기반 개선 — 변경 영역 Undo

현재 이력은 모든 frame/layer의 before/after 픽셀 사본을 저장한다. 작은 수정도 문서가 크면 이력 예산을 빨리 사용하므로
변경 영역을 저장/교환하는 원리를 참고할 수 있다. 이 항목은 기능6개의 선행 필수 단계나 구현 완료 약속이 아니다.

- 같은 작은/최대 크기 fixture에서 한 픽셀·짧은 stroke·전체 fill·크기 변경의 할당 byte·보관 가능한 이력 수·편집/Undo 비용을 먼저 측정한다.
- 개선이 확인되면 픽셀 연산의 영역 차분과 metadata/크기 변경의 전체 snapshot fallback을 설계한다. 기존64단계/16MiB 상한은 유지한다.
- 혼합 연산 trace의 source bytes·revision/dirty·Undo/Redo·no-op/취소를 기존 구현과 대조한다. 임시 복구는 계속 전체 원본 JSON을 저장한다.
- 별도 작업으로 완료 조건과 회귀를 정한 뒤 진행하며, 이번 계획 작성으로 이력 구조를 변경하지 않는다.

## UI와 구현 경계

- 연필 관련 설정은 현재 도구 옵션, 마스크 조작은 선택 메뉴, 외곽선은 효과 메뉴, 반복 보기는 보기 메뉴, 범위 편집은 프레임 막대에 배치한다.
- 기존 Pixelforge 토큰·포커스·한글/영문 tooltip과 조건부 노출을 사용한다. 상단 고정 버튼 목록으로 기능을 누적하지 않는다.
- 표시는 기존 합성 cache·프레임/태그 재생 시계를 사용한다. DOM/canvas/Worker 수명과 저장소 adapter는 문서 모델 밖에 둔다.
- AI 생성 서비스, 임의 각도/보간 확대, OS 클립보드, indexed source, 레이어 blend/opacity는 이번6단계의 범위가 아니다.
  별도 후보는 [제작 편의성](game-development-convenience-review.md#asset-반복-작업)에서 관리한다.

## 단계별 검증과 세션 재개

다음 세션은 이 문서의 상태와 `git status`를 먼저 확인한다. 진행할 한 단계와 완료 조건을 선택하고,
현재 로컬 변경·기존 source fixture를 보존한다. 개발 완료 전에는 문서의 상태만 보고 기능이 있다고 가정하지 않는다.

| 검증 | 실행 기준 |
| --- | --- |
| `pnpm test:pixel-authoring` | 연산/마스크/이력의 경계·정확한 RGBA·원자성 회귀. 새 검사는 이 aggregate에 실제 연결 |
| `pnpm lint`, `pnpm --filter @ferrum2d/placement-viewer build` | 변경 단계의 타입·UI build |
| `pnpm smoke:pixel-authoring` | 실제 포인터/키보드·한글/영문·390px·2D DPR1/HD-2D DPR2·기존 전체 흐름. 집중 helper는 이 전체 gate에도 연결 |
| `pnpm smoke:pixel-project` | 픽셀/프레임/이력 변경의 실제 Rust 저장 host·원본/PNG·재열기·실행 회귀 |
| `pnpm smoke:pixel-normals`, `pnpm smoke:pixel-normals-project` | 노멀 경계 변경의 집중 진단. source stale·취소·검증 cache·paired 저장 확인 |
| `pnpm build`, 공식 placement viewer smoke의 실행 단계 | 전체 완료 시 기존 app/runtime 통합과 production 뷰어 회귀 |
| `pnpm validate:docs-links`, `pnpm build:pages`, `pnpm validate:pages-artifact` | 계약/계획 문서·참조 경로 변경 |

단계별로 관련 최소 검증을 실행하고, 전체 완료 시 authoring/native/production 통합 회귀와 코드리뷰·이슈 수정을 마친다.
새 실패는 원인·영향·후속 조치를 남긴다. 새 production 의존성·public API·source/native schema 변경이 생기면 해당 계약과 QA 범위를 함께 갱신한다.
현재 사용법은 engine 문서, 재현 명령은 quality 문서에 반영한다. 완료한 단계는 이 문서에서 제거하고 전체 완료 시 이 계획과 색인/allowlist 참조를 삭제한다.

## 참고 소스

공식 저장소 `main`에서 확인한 구현 지점이다. 기존 작업의 고정 commit 분석과 동일한 스냅샷이라고 간주하지 않는다.
실제 단계 착수 시 사용한 commit SHA와 파일별 적용 가능한 라이선스를 확인·기록하며 임시 checkout 경로에 계획을 의존시키지 않는다.
코드를 직접 편입하는 것을 전제하지 않고 공개 동작/원리를 현재 TS 책임 경계에 맞게 구현한다.

- [intertwiners.h](https://github.com/aseprite/aseprite/blob/main/src/app/tools/intertwiners.h): stroke의 모서리 점 보정과 이전 영역 복원.
- [mask.cpp](https://github.com/aseprite/aseprite/blob/main/src/doc/mask.cpp): 픽셀 마스크·색상 선택·합집합/차집합/교집합.
- [outline_filter.cpp](https://github.com/aseprite/aseprite/blob/main/src/filters/outline_filter.cpp): 이웃 알파 판정과 안쪽/바깥쪽 외곽선.
- [cmd_new_brush.cpp](https://github.com/aseprite/aseprite/blob/main/src/app/commands/cmd_new_brush.cpp): 선택 이미지와 마스크를 브러시로 사용하는 흐름.
- [point_shape.cpp](https://github.com/aseprite/aseprite/blob/main/src/app/tools/point_shape.cpp): 축별 경계 wrap과 잘린 scanline 처리.
- [cmd_flip.cpp](https://github.com/aseprite/aseprite/blob/main/src/app/commands/cmd_flip.cpp): 선택 cel 범위를 한 transaction으로 처리하는 흐름.
- [copy_region.cpp](https://github.com/aseprite/aseprite/blob/main/src/app/cmd/copy_region.cpp): 변경 영역 보관/교환과 Undo/Redo.
