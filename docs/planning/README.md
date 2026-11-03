# 개발 계획과 개선 후보

기준일: 2026-11-03

`docs/planning/`은 진행 중인 작업, 미착수 후보, 제품 결정이 필요한 항목만 관리한다.
완료된 계획·단계별 결과 기록은 삭제하고 아카이브로 옮기지 않는다.
현재 사용법과 검증 계약은 `docs/engine/`, `docs/development/`를 기준으로 한다.

에디터의 현재 사용법은 [Scene Authoring](../engine/data-scene-authoring.md),
회귀 검증은 [Smoke Check](../development/quality/smoke-check.md)를 따른다.
아래 5개 후보 문서는 미착수 설계, 환경 검증 대기 또는 제품 결정 대기를 관리한다.
완료된 도트 개발계획과 리뷰 결과는 새 미완료 작업으로 등록하지 않는다.

도트 제작의 현재 계약은
[Scene Authoring](../engine/data-scene-authoring.md#에디터-내장-도트-제작)과
앱 안내(`apps/placement-viewer/README.md`)를 따른다.

## 다음 개선 추천

아래는 다음 작업의 우선순위다. 개발 계획과 설계 후보를 구분하며, 순서 자체가 구현 착수나 완료를 뜻하지 않는다.

| 순서 | 개선 | 추천 이유 | 범위와 완료 조건 |
| --- | --- | --- | --- |
| 1 | AI 도트 생성 설계 | 직접 그리기 전에 초안 이미지를 준비하는 시간을 줄인다. | [도트 제작 후보](game-development-convenience-review.md#도트-제작-후보): 입력·결과 선택·인증/비용·출처·기존 원본 등록 경계 결정. 구현 착수 전 설계 후보 |
| 2 | 도트 게임 상용 수준 개선 | 편집 규모·임포트·타일 격차를 줄여 도트 게임 엔진으로서 상용 수준에 다가간다. | [개발 계획 후보](pixel-art-commercial-readiness-plan.md): PX-01~05와 PX-06a trim 복원·원본 보존, PX-06b slice/key/pivot 확인·명시적 origin 적용·저장 호환을 반영했다. [PX-03 실기기 검증](feature-candidates.md#평면-2d-아틀라스-실기기-검증)은 환경 검증 대기로 분리한다. PX-07a [작성 시점 오토타일·맵 미리보기](../engine/data-scene-authoring.md#작성-시점-오토타일과-맵-미리보기), PX-07b [타일 애니메이션·고정 충돌](../engine/data-scene-authoring.md#타일-애니메이션과-고정-충돌)을 제공한다. PX-08 [평면 2D 팔레트 스왑](../engine/public-api/labs.md#평면-2d-팔레트-스왑)은 runtime API로 제공한다. PX-09a [도트 후처리](../engine/public-api/core.md#도트-후처리)는 양쪽 renderer의 포스터라이즈·디더·정수 행 스캔라인을 제공한다. 기존 bloom·곡면 CRT 등의 WebGPU 동등성은 별도 후속 후보다. 9-slice 렌더링·직접 바이너리 읽기·자동 재임포트는 별도 필요성을 확인한다. |

[실물 GPU·장시간·LOD 외형](feature-candidates.md#실게임-품질-후속-검증)과 [실제 설치·GUI·서명](deployment-roadmap.md#남은-검증-후보)은 후속 검증이다.
필요한 기기·설치 자료·실행 조건을 먼저 확보하며, 기능 구현을 다시 시작하는 항목으로 취급하지 않는다.

## 문서별 관리 범위

| 문서 | 구분·상태 | 다음 판단 또는 작업 |
| --- | --- | --- |
| [HD-2D 후속 기능·검증 후보](feature-candidates.md) | 설계 후보 / 환경 검증 대기 | 대상 씬·측정 환경·완료 조건을 정한 뒤 필요한 최적화 선택 |
| [게임 개발 편의성 후보](game-development-convenience-review.md) | 설계 후보 · 미착수 | 도트 생성/변형·외부 맵·reload의 실제 필요와 저장 경계 확정 |
| [도트 게임 상용 수준 개선 계획](pixel-art-commercial-readiness-plan.md) | PX-01~05·PX-06a/b·PX-07a/b·PX-08·PX-09a 반영 · 후속 후보 | [기본 2D 표시](../engine/public-api/core.md#기본-2d-픽셀-퍼펙트-표시), [PNG 보호](../engine/public-api/labs.md#png-아틀라스의-가장자리-보호), [런타임 클립](../engine/data-scene-presentation.md#캐릭터별-atlas-클립)을 제공한다. [내장 도트 제작](../engine/data-scene-authoring.md#에디터-내장-도트-제작)은 v6·64프레임·8×8 시트와 기존 자원 예산을 제공한다. [영역·기준점](../engine/data-scene-authoring.md#영역slice-메타데이터와-명시적-기준점-적용)은 기존 원본·씬 계약으로 저장한다. 오토타일은 작성 시점 계산·미리보기·저장으로, 타일 애니메이션은 기존 Rust 클립 재생·시간 미리보기·고정 충돌로 제공한다. 팔레트와 도트 후처리는 runtime API로 제공하며 후속 편집 UI·공간 재질·기존 후처리 WebGPU 동등성은 개별 확정 |
| [데모 포트폴리오 후보](demo-game-showcase-plan.md) | 제품 결정 대기 | 기존 기능을 별도 public demo/report로 노출할 가치 판단 |
| [배포 후속 검증 후보](deployment-roadmap.md) | 설치 환경 검증 / 운영 정책 결정 대기 | 실제 앱·기기·서명 자료를 확보한 뒤 검증 |

현재 엔진 기능은 [Core API](../engine/public-api/core.md)와 [공간 계약](../engine/data-scene-spatial.md),
자산 제작·가져오기·정리는 [Scene Authoring](../engine/data-scene-authoring.md)를 따른다.
이미 제공하는 기능을 미완료 후보로 다시 등록하지 않는다.

## 관리 규칙

- 후보마다 사용자 가치, 현재 한계, 착수 시 검증 조건을 기록한다.
- 개발 계획, 설계 후보, 환경 검증 대기, 제품 결정 대기를 구분한다. 후보의 나열 순서를 구현 착수나 완료로 해석하지 않는다.
- 완료한 단계의 로그·테스트 개수·임시 경로를 계획에 누적하지 않는다. 현재 검증 명령은 [Smoke Check](../development/quality/smoke-check.md)에 둔다.
- 일부 후보가 남은 문서는 남은 범위만 유지한다. 전체가 끝나면 삭제하고 문서 지도와 Pages 메뉴의 참조도 정리한다.
- 실제 구현·저장/API 계약과 제안은 구분한다. 원격 이슈·배포 상태는 확인 없이 완료로 바꾸지 않는다.
- 문서 삭제·경로·Pages 메뉴 변경은 `pnpm validate:docs-links`, `pnpm build:pages`, `pnpm validate:pages-artifact`로 확인한다.
- Wasm threads, full visual editor, multiplayer, scripting/plugin runtime, skeletal animation, complex physics, 범용 3D는 별도 설계/승인 범위다.
