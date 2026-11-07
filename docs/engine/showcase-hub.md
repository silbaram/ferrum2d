# Ferrum2D Showcase Hub

이 문서는 Ferrum2D가 현재 제공하는 제품 기능을 demo, 기준 문서, 검증 명령 기준으로 묶은 기능 지도다. 목적은 새 사용자가 "무엇을 어디서 볼 수 있고, agent가 어떤 파일과 report를 기준으로 작업해야 하는지"를 빠르게 파악하게 하는 것이다.

Ferrum2D는 visual editor 중심 제품이 아니라 AI agent-first 2D game engine이다. 따라서 showcase의 기준도 화면 효과만이 아니라 public API, spec, authoring data, replay, smoke report가 함께 있는지로 판단한다.

## 기능 지도

엔진 기능을 하나씩 체험하려면 `pnpm dev:starter-runtime`으로 **기능 실험실**을 연다.
상단에서 주제를 고르면 그 기능만 있는 씬과 조작·관찰·구현 API를 함께 확인한다.
[GitHub Pages 홈](https://silbaram.github.io/ferrum2d/)도 같은 기능 목록에서 직접 진입한다.
웹에서 설치 없이 체험한 뒤 로컬 실행·프로젝트 생성으로 이어갈 수 있다.

| 실험 | Starter Runtime query | 바꿔볼 설정 |
| --- | --- | --- |
| 스프라이트 애니메이션 | `?feature=animation` | 재생 설정, 이동/대기, 프레임 소리·표식, 단발 완료 |
| 길 찾기 | `?feature=navigation` | 벽 반대편 목적지, 포인터·키보드 이동 |
| 물리 재질 | `?feature=physics` | 고무/점토, 동일한 초기 힘 |
| 노멀 조명 | `?feature=lighting` | 노멀 적용, 광원 위치, 원본 색상 |
| 후처리 | `?feature=postprocess` | 원본, bloom, CRT |
| 카메라 | `?feature=camera` | 고정/추적, 확대, 이동 목적지 |
| 9-slice | `?feature=nine-slice` | 단순 확대와 비교, 적용/해제, 테두리 배율 |
| 타일맵·충돌 | `?feature=tilemap` | 벽/바닥 브러시, 통로, native 통과 여부 |
| 그리기 레이어 | `?feature=layers` | 같은 위치에서 로봇의 앞뒤 순서 |
| 파티클·VFX | `?feature=particles` | 불꽃/먼지/포인터 잔상, 수량·수명·속도 |
| 공간 오디오 | `?feature=audio` | 음원 좌우·거리·볼륨, 재생/정지 |
| 입력 전환 | `?feature=input` | 키보드/게임패드/가상 조이스틱, 모달 입력 차단 |
| 씬 전환과 페이드 | `?feature=scenes` | A/B 왕복·씬/전역 카운터·전환 중 pause |
| 상호작용과 트리거 | `?feature=interaction` | 거리·스위치 조건·문 사용·구역 출입 |
| 저장과 불러오기 | `?feature=save-load` | 위치·수집 진행 저장/복원·전용 슬롯 삭제 |
| 대화와 퀘스트 | `?feature=dialogue` | 수락/거절·소포 조건·목표 완료 |
| HUD·다국어·접근성 | `?feature=hud` | 체력·한국어/영어·글자 크기·대비 |
| 사격과 벽 충돌 | `?feature=projectiles` | 동일 속도 일반·벽 관통·반사 |
| 컷신과 동작 감소 | `?feature=cutscene` | 재생·건너뛰기·자막·효과음·동작 감소 |
| 에셋 로딩과 캐시 | `?feature=asset-loading` | fetch·세션 메모리 캐시·취소·실패 후 재시도 |
| 레벨 스트리밍 | `?feature=streaming` | 구역 변경·고유 텍스처 해제·공통 바닥 유지 |
| HD-2D 공간 이동 | `?feature=hd2d-movement` | 경사로·층 전환·승강/수평 발판 탑승 |
| AI 추적과 전투 | `?feature=ai-combat` | 장애물 우회·근접 피해·원거리 발사체 |
| 부모·자식 연결 | `?feature=attachments` | 수레 위치/회전·자식 연결 해제/복귀 |
| HD-2D 조명·그림자·안개 | `?feature=hd2d-environment` | 광원 이동·그림자·거리 안개 전후 비교 |
| 지형 파괴와 충돌 갱신 | `?feature=destructible-terrain` | 마스크 깎기·공 낙하·충돌 청크 갱신·초기화 |

각 실험은 기본 설정과 씬으로 초기화할 수 있다. 물리 심화는 `physics-sandbox`의 7개 시나리오,
여러 기능을 조합한 게임은 아래 통합 예제로 이어진다. 기능 실험실 검증은 `pnpm smoke:feature-examples`다.

| 기능군 | 대표 demo 또는 경로 | 기준 문서 | 검증 명령 |
| --- | --- | --- | --- |
| Runtime baseline | Starter Runtime, Platformer, Breakout | [User Guide](user-guide.md), [Public API](public-api.md) | `pnpm build`, `pnpm smoke:starter-runtime`, `pnpm smoke:platformer`, `pnpm smoke:breakout` |
| 도트 게임 제작 | 작은 빛의 정원 · Pixel Art | [도트 제작](data-scene-authoring.md#에디터-내장-도트-제작), [도트 후처리](public-api/core.md#도트-후처리) | `pnpm dev:pixel-art`, `pnpm smoke:pixel-showcase` |
| Game Spec authoring | Top-down Shooter | [Top-down Shooter Game Spec](../examples/topdown-shooter/game-spec.md) | `pnpm validate:game-spec`, `pnpm smoke:headless`, `pnpm smoke:topdown-authored-behavior-runtime` |
| Scene/Object authoring | Placement Viewer, generated placement viewer | [Data Scene Authoring](data-scene-authoring.md), [Authoring API](public-api/authoring.md) | `pnpm smoke:placement-viewer`, `pnpm smoke:placement-viewer-save`, `pnpm smoke:placement-viewer-mass-authoring`, `pnpm smoke:placement-viewer-desktop-assets` |
| Physics authoring | Physics Sandbox | [Physics Spec](physics-spec.md), [2D Physics Map](../development/architecture/physics-engine.md) | `pnpm validate:physics-authoring`, `pnpm smoke:physics`, `pnpm smoke:physics-demo-suite` |
| Runtime extensibility | projectile, weapon, behavior, VFX, replay helpers | [Runtime Extensibility](runtime-extensibility.md), [Public API](public-api.md) | `pnpm validate:gameplay-authoring:report`, `pnpm smoke:gameplay-replay:report` |
| HD-2D 공간·전투 (개발 소스) | 기능 실험실의 공간 이동·AI 전투·부모/자식 연결 및 packed 공간 browser fixture | [공간 지형·모델·WebGPU](data-scene-spatial.md), [전투 authoring](data-scene-authoring.md#선택적-hd-2d-전투-실행-개발-소스) | `pnpm smoke:spatial-scene`, `pnpm smoke:spatial-webgpu-offscreen`, `pnpm smoke:hd2d-combat` |
| Consumer project workflow | create-game templates, consumer agents | [Developer Quickstart](developer-quickstart.md), [npm Package Strategy](../development/operations/npm-package-strategy.md) | `pnpm smoke:create-game-template-catalog`, `pnpm smoke:create-game-template-reports`, `pnpm package:consumer-smoke` |
| Package/release readiness | local tarball install and release rehearsal | [npm Release Procedure](../development/operations/npm-release.md) | `pnpm package:check`, `pnpm package:consumer-smoke`, `pnpm release:local-check` |

## Demo Gallery 기준

| Demo | 사용자가 확인하는 것 | Agent가 읽는 기준 |
| --- | --- | --- |
| 기능 실험실 / Engine Playground | 기본 진입은 위의 26개 독립 실험. 통합 게임은 `?mode=playground`, 사격 프로필·리플레이는 `?mode=starter` | `createFerrumRuntime(...)`, Data Scene, `pnpm smoke:feature-examples`, `pnpm smoke:engine-playground` |
| Pixel Art · 작은 빛의 정원 | 실제 이동·씨앗 수집, 노멀 조명·팔레트·후처리 비교 | `examples/pixel-art/public/scene.json`, 편집 가능한 `.pixel.json` 원본, pixel-art profile, showcase smoke |
| Top-down Shooter | Game Spec 기반 shooter, asset/audio/tilemap/gameplay authoring | `examples/topdown-shooter/public/game.json`, Game Spec 문서, replay fixture |
| Placement Viewer | instance 선택, transform patch, ObjectDefinition 생성, behavior binding reference | `scene-authoring.json`, placement handoff state, authoring report |
| Physics Sandbox | Physics Spec apply, debug line, solver fixture catalog | Physics Spec sample, physics smoke suite, demo-suite browser smoke |
| Platformer | 점프·단방향/이동 발판의 기능 안내와 해당 위치 바로 이동 | create-game `platformer` template, runtime replay fixture |
| Breakout | 반사·충돌 이벤트·파티클 관찰 안내와 충돌 영역 표시 | create-game `breakout` template, scene authoring report |

## Agent-first 작업 흐름

새 consumer game에서 Ferrum2D의 기본 작업 단위는 source file 하나가 아니라 report와 검증 명령까지 포함한 작은 루프다.

1. [개발자 퀵스타트](developer-quickstart.md)에 따라 GitHub Release의 create-game `.tgz`로 `minimal` 프로젝트를 생성하고 `npm install`을 실행한다.
2. 생성 프로젝트에서 `npm run ferrum:agents`로 같은 버전의 consumer 지침을 설치한다.
3. `npm run ferrum:check`로 기본 검증을 실행하고, 상세 입력은 `npm run ferrum:report`로 확인한다.
4. `npm run ferrum:validate`
5. `npm run ferrum:smoke`
6. 필요한 경우 `npm run ferrum:placement-viewer`

Agent는 `ferrum:report`, authoring report, replay report, runtime replay report를 읽고 Game Spec, scene authoring, template source를 수정한다. 사람이 확인하는 viewer는 위치, visual/collider/layer, ObjectDefinition, behavior recipe id reference 같은 authoring 보조 범위에 머문다.

## Pages에서 보는 순서

로컬 Pages artifact를 만들면 브라우저에서 home, docs, demo route를 함께 확인할 수 있다.

```bash
pnpm build
pnpm build:pages
pnpm validate:pages-artifact
```

Pages home은 runtime, authoring, physics demo route와 핵심 문서 카드를 제공한다. 현재 Pages artifact의 demo route는 `starter-runtime`, `topdown-shooter`, `placement-viewer`, `physics-sandbox`, `breakout`, `platformer`, `pixel-art`다. 새 route의 원격 공개 여부는 실제 배포 상태를 별도로 확인한다. Pages의 문서와 예제는 배포한 개발 소스 기준이며, GitHub Release 설치 파일의 버전과는 별개다.
웹 뷰어의 내장 예제는 내보내기 전용이다. 파일 저장·프로젝트 접근 조건은 [사용자 설명서](user-guide.md#뷰어에서-작성하고-실행하기)를 따른다.

## 보류 범위

다음 항목은 showcase에 포함하지 않는다. 별도 승인과 설계가 있기 전에는 제품 기능처럼 소개하지 않는다.

- full visual editor
- Behavior Recipe Body Editor
- FSM/action graph/timeline visual editor
- multiplayer
- full game loop Worker migration 또는 Wasm threads
- complex physics 확장

## 다음에 볼 문서

| 목적 | 문서 |
| --- | --- |
| 새 프로젝트 시작 | [Developer Quickstart](developer-quickstart.md) |
| public import 확인 | [Public API](public-api.md) |
| data-driven scene authoring | [Data Scene Authoring](data-scene-authoring.md) |
| runtime primitive와 확장성 | [Runtime Extensibility](runtime-extensibility.md) |
| 품질 검증 기준 | [Smoke Check](../development/quality/smoke-check.md) |
| 패키지/릴리스 준비 | [npm Release Procedure](../development/operations/npm-release.md) |
