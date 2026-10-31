# 도트 제작 후속 고도화 개발 계획

기준일: 2026-11-01
상태: 6단계 여러 프레임 편집 모델 구현, UI 연결 전
현재 작업: 프레임 범위 UI·저장 통합 검증과 전체 리뷰

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
| 6 | 보통 | 여러 프레임 동시 편집 | 이동/반전 모델과 원자성 단위 검사는 있으나 프레임 범위 UI가 연결되지 않음 | 진행 중 |

완료한1~5단계의 현재 계약은 Scene Authoring을 따른다.6단계와 전체 통합 검증·리뷰를 마치기 전에는 전체 계획 완료로 취급하지 않는다.
별도 기반 개선인 차분 Undo는 아래 측정 조건을 충족할 때 독립 작업으로 진행한다.
단계별 구현과 검증 상태를 갱신하며 전체 완료 후 통합 검증·리뷰·수정을 진행한다.

## 공통 설계 원칙

- 원본/픽셀/이력은 `placementPixelDocument.ts`, 포인터/보기는 `placementPixelCanvas.ts`, 연결과 수명은 `placementPixelTool.ts`가 소유한다. 새 연산은 필요한 순수 함수나 전용 controls로 분리한다.
- source v1~v5, frame/layer/tag/clip ID, straight-alpha RGBA와 투명 픽셀 RGB를 보존한다. UI 선택·브러시·반복 보기 설정을 원본에 임의로 추가하지 않는다.
- 한 변256·레이어8·프레임16·전체2,097,152 cel 픽셀·이력64단계/16MiB의 기존 상한을 기준으로 한다. 추가 UI 버퍼도 별도로 상한을 둔다.
- preview/선택/설정 변경은 원본·dirty·Undo·씬·GPU 자산을 확정하지 않는다. 픽셀 확정은 한 Undo, 취소·blur·pointercancel은 이전 상태 복원이다.
- editor identity/revision·선택 frame/layer/atlas·씬/프로젝트가 바뀌면 오래된 preview/비동기 결과를 폐기한다. 잠금·숨김·재생 중 편집 정책과 atlas 인접 rect 보호를 유지한다.
- 원본이 변하면 기존 노멀의 provenance를 무효화하고 명시적 재생성/검증 cache 경로를 사용한다. 복구는 확정 원본만 기록한다.
- 씬 적용·프로젝트 저장은 기존 명시적 경로를 사용한다. 객체 크기·pivot·collider/body·behavior를 그림 편집 때문에 자동 변경하지 않는다.
- Rust simulation·Wasm ABI·게임 runtime을 확대하지 않는다. 새 production 의존성이나 source 형식이 필요해지면 필요성·대안·호환 범위를 먼저 설계한다.

## 6단계 — 여러 프레임 동시 편집

`placementPixelDocument.ts`의 미리보기/이동/반전 모델과 단위 검사5개를 추가했다. 모델만으로 UI·native 저장/재열기까지 완료했다고 판단하지 않는다.

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
- 별도 작업으로 완료 조건과 회귀를 정한 뒤 진행하며, 이번 1~6단계 작업의 필수 범위에는 넣지 않는다.

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

공식 저장소 `main`의 commit `3669f4774d181d77deb3e6db95fe6df8ca347410`을 이번 착수 시 원격 조회로 확인했다. 아래는 참고 구현 지점이다.
실제 단계 착수 시 사용한 commit SHA와 파일별 적용 가능한 라이선스를 확인·기록하며 임시 checkout 경로에 계획을 의존시키지 않는다.
코드를 직접 편입하는 것을 전제하지 않고 공개 동작/원리를 현재 TS 책임 경계에 맞게 구현한다.

- [intertwiners.h](https://github.com/aseprite/aseprite/blob/3669f4774d181d77deb3e6db95fe6df8ca347410/src/app/tools/intertwiners.h): stroke의 모서리 점 보정과 이전 영역 복원.
- [mask.cpp](https://github.com/aseprite/aseprite/blob/3669f4774d181d77deb3e6db95fe6df8ca347410/src/doc/mask.cpp): 픽셀 마스크·색상 선택·합집합/차집합/교집합.
- [outline_filter.cpp](https://github.com/aseprite/aseprite/blob/3669f4774d181d77deb3e6db95fe6df8ca347410/src/filters/outline_filter.cpp): 이웃 알파 판정과 안쪽/바깥쪽 외곽선.
- [cmd_new_brush.cpp](https://github.com/aseprite/aseprite/blob/3669f4774d181d77deb3e6db95fe6df8ca347410/src/app/commands/cmd_new_brush.cpp): 선택 이미지와 마스크를 브러시로 사용하는 흐름.
- [point_shape.cpp](https://github.com/aseprite/aseprite/blob/3669f4774d181d77deb3e6db95fe6df8ca347410/src/app/tools/point_shape.cpp): 축별 경계 wrap과 잘린 scanline 처리.
- [cmd_flip.cpp](https://github.com/aseprite/aseprite/blob/3669f4774d181d77deb3e6db95fe6df8ca347410/src/app/commands/cmd_flip.cpp): 선택 cel 범위를 한 transaction으로 처리하는 흐름.
- [copy_region.cpp](https://github.com/aseprite/aseprite/blob/3669f4774d181d77deb3e6db95fe6df8ca347410/src/app/cmd/copy_region.cpp): 변경 영역 보관/교환과 Undo/Redo.
