# 데모 게임 포트폴리오 보강 계획

이 문서는 Ferrum2D demo가 엔진 기능을 어떻게 보여줘야 하는지 정리하는 planning 문서다. 목적은 **한 개의 거대한 데모에 모든 기능을 밀어 넣는 것**이 아니라, 엔진 기능군을 가장 잘 표현하는 여러 개의 focused demo를 구성하고 Pages에서 하나의 showcase portfolio처럼 탐색하게 만드는 것이다.

구현 착수 전 범위와 검증 기준을 정리하는 문서이며, 실제 public API와 운영 계약은 `docs/engine` 및 `docs/development` 문서가 우선한다.

## 현재 계획 상태

- **완료**: [Showcase Hub](../engine/showcase-hub.md), Pages build의 demo gallery, `starter-runtime`, `topdown-shooter`, `placement-viewer`, `physics-sandbox`, `breakout`, `platformer` 6개 public route가 build artifact에 구성돼 있다.
- **완료**: Starter Runtime, Top-down Shooter, Breakout, Platformer, Physics Sandbox README가 각 예제의 대표 기능과 검증 명령을 설명한다.
- **활성 후보**: smoke 중심인 Content/UX, Renderer/WebGPU, Level Streaming을 별도 public lab으로 승격할지 결정한다.
- **활성 후보**: create-game/package/consumer report를 Agent Workflow report route로 노출할지 결정한다.
- **별도 승인**: 새 시각 asset과 Pages 배포 실행은 asset 정책과 외부 상태 변경 승인을 따른다.

운영 중인 demo route와 명령의 기준은 [Showcase Hub](../engine/showcase-hub.md)와 [GitHub Pages 데모/문서 배포](../development/operations/demo-deploy.md)다.

## 결론

현재 데모 구성은 P0/P1 portfolio 기반을 갖췄다. 남은 과제는 기존 route를 다시 만드는 것이 아니라 smoke/report 중심 기능을 어떤 사용자-facing route로 승격할지 결정하는 것이다.

- `examples/topdown-shooter`는 Game Spec, wave, sprite/tilemap, audio, camera, replay 흐름을 보여주는 대표 데모로 적합하다.
- `examples/starter-runtime`, `examples/breakout`, `examples/platformer`, `examples/physics-sandbox`는 각자 대표 기능과 검증 명령을 README와 Showcase Hub에 연결했다.
- WebGPU/material, level streaming, mobile input, localization/dialogue/accessibility, package/template/agent workflow는 smoke 또는 report로는 검증되지만 사용자-facing demo portfolio에 충분히 연결되어 있지 않다.

따라서 다음 방향은 **Showcase Hub + 기능군별 데모 라인업**을 유지하면서, smoke/report 중심 기능의 public 승격 여부를 개별 판단하는 것이다.

## 원칙

- 데모 하나는 하나의 핵심 메시지를 가져야 한다. 기능을 과하게 합치면 플레이 목표와 검증 기준이 흐려진다.
- 엔진 기능별로 primary demo, secondary smoke/report, 관련 문서를 명시한다.
- 기존 예제를 우선 활용하고, 기존 장르에 억지로 맞지 않는 기능만 새 demo 또는 lab route로 분리한다.
- AI agent-first 흐름을 보여주기 위해 Game Spec, Physics Spec, scene authoring, replay, smoke report, template feedback을 데모 설명과 함께 노출한다.
- Rust core와 TypeScript platform layer 경계를 유지한다. frame hot path에서 entity별 JS/Wasm 왕복 호출을 추가하지 않는다.
- WebGPU, Pages 배포, package publish, release 같은 외부 상태 변경은 명시적 승인 전 실행하지 않는다.

## 데모 포트폴리오 목표

Pages build의 첫 진입은 개별 게임 하나가 아니라 demo gallery로 구성돼 있다. 사용자는 "이 엔진이 무엇을 할 수 있나"를 기능군별로 확인하고, 각 데모로 들어가 실제 플레이나 report를 볼 수 있어야 한다.

| 우선순위 | 데모/route | 담당 기능 | 현재 상태 | 보강 방향 |
| --- | --- | --- | --- | --- |
| P0 | Showcase Hub | 기능별 데모 지도, smoke/report 링크, Pages 진입점 | 완료 | 새 public route가 생길 때 기능/명령/문서 mapping 동기화 |
| P0 | Starter Runtime Demo | engine boot, Rust/Wasm bridge, GameLoop, canvas resize, input, WebGL2 기본 렌더 | 완료 | 가장 작은 통합 예제 역할 유지 |
| P0 | Top-down Shooter | Game Spec, wave, enemy behavior, sprite atlas, tilemap collision, camera, audio, replay, authored behavior variant | 완료 | 대표 gameplay demo로 유지하되 모든 기능을 넣지는 않음 |
| P1 | Physics Sandbox | Physics Spec, solver, collision query, debug line, joints/contacts, replay Worker 경계 | 완료 | physics 기능 대표 demo 역할 유지 |
| P1 | Platformer | tilemap 기반 이동, kinematic controller, slope/one-way/terrain 계열 기능 | 완료 | platform movement/terrain demo 역할 유지 |
| P1 | Breakout | 간단한 scene loop, collision, score/effect, minimal gameplay template 감각 | 완료 | 작은 게임 template demo 역할 유지 |
| P1 | Content/UX Demo | HUD, localization, dialogue/quest, cutscene, accessibility/reduced motion | smoke 중심 | 별도 demo 또는 `minimal-game` lab route로 분리 후보 |
| P2 | Renderer Lab | WebGL2 material, lighting, post-process, texture atlas, optional WebGPU fallback | smoke/lab 중심 | 사용자-facing lab route와 fallback 상태 표시 |
| P2 | Level Streaming Demo | chunk load/unload, large world readiness, asset lifetime, runtime budget | smoke 중심 | browser demo 또는 report route로 노출 |
| P2 | Agent Workflow Demo | create-game template, consumer smoke, replay report, package contract | report 중심 | playable demo가 아니라 report/demo docs route로 구성 |
| P3 | Visual polish pack | screenshot, thumbnail, audio/sprite polish, Pages presentation | 일부 | 새 asset은 용량/라이선스/승인 후 진행 |

## 기능 Coverage Matrix

| 엔진 기능군 | Primary demo | 보조 검증 |
| --- | --- | --- |
| Rust/Wasm update loop, render command buffer | Starter Runtime, Top-down Shooter | `pnpm smoke:starter-runtime`, `pnpm smoke:topdown` |
| WebGL2 sprite renderer, texture atlas, batching | Top-down Shooter, Renderer Lab | `pnpm smoke:texture-atlas`, `pnpm smoke:topdown-tilemap-budget` |
| optional WebGPU renderer/fallback | Renderer Lab | `pnpm smoke:material-webgpu`, `pnpm smoke:lighting-webgpu` |
| input, viewport, camera | Starter Runtime, Top-down Shooter | `pnpm smoke:starter-runtime`, `pnpm smoke:topdown`, `pnpm smoke:mobile-input` |
| Game Spec authoring | Top-down Shooter | `pnpm validate:game-spec`, `pnpm smoke:topdown-authored-behavior-runtime` |
| scene authoring, behavior recipe, FSM | Top-down Shooter, Agent Workflow Demo | `pnpm validate:data-scene-authoring`, `pnpm smoke:topdown-authored-behavior-variant` |
| replay/save-load/report | Top-down Shooter, Agent Workflow Demo | `pnpm smoke:topdown-save-load`, `pnpm smoke:gameplay-replay:report` |
| physics solver, collision, debug line | Physics Sandbox | `pnpm smoke:physics`, `pnpm validate:physics-authoring` |
| platform/terrain movement | Platformer | `pnpm smoke:platformer`, `pnpm smoke:platformer-budget` |
| HD-2D/tilemap navigation/projectile arc | Physics Sandbox 또는 전용 terrain lab | `pnpm smoke:topdown-hd2d`, `pnpm smoke:physics-demo-suite` |
| audio, VFX, camera effect | Top-down Shooter, Breakout | `pnpm smoke:topdown`, `pnpm smoke:breakout-effects` |
| HUD/content/localization/dialogue/accessibility | Content/UX Demo | `pnpm smoke:hud-toolkit`, `pnpm smoke:localization`, `pnpm smoke:dialogue-quest`, `pnpm smoke:accessibility-options` |
| asset preload/cache/pipeline | Starter Runtime, Renderer Lab | `pnpm smoke:asset-pipeline`, `pnpm smoke:preload` |
| level streaming/large world readiness | Level Streaming Demo | `pnpm smoke:level-streaming`, `pnpm smoke:level-streaming-browser` |
| create-game/package/consumer agent workflow | Agent Workflow Demo | `pnpm smoke:create-game-template-reports`, `pnpm smoke:topdown-template-replay-report`, `pnpm package:consumer-smoke` |
| Pages demo readiness | Showcase Hub | `pnpm build:pages`, `pnpm validate:pages-artifact` |

## 남은 부족한 부분

기존 예제의 ownership과 Pages portfolio 기반은 정리됐다. 현재 남은 공백은 **smoke/report 기능의 선택적 제품 노출**이다.

- Content/UX, Renderer/WebGPU, Level Streaming, Agent Workflow는 검증 surface는 있으나 별도 public demo/report route가 없다.
- 어떤 smoke profile을 public route로 승격할지 판단하는 공통 기준이 아직 없다.
- Top-down Shooter가 대표 데모라는 이유로 새 기능을 계속 흡수하지 않도록 현재 ownership 경계를 유지해야 한다.
- 새 route를 만들 경우 thumbnail, asset license/size, Pages artifact 검증 범위를 함께 정해야 한다.

## 구현 Slice

### Slice 0: 문서 기준 정리 (완료)

산출물:

- 이 planning 문서
- planning README에서 demo portfolio 문서 링크
- 기능군별 primary demo와 검증 명령 매핑

검증:

- `pnpm validate:docs-links`
- `git diff --check`

### Slice 1: P0 Showcase Hub 설계 (완료)

산출물:

- Pages home 또는 docs route에서 demo gallery 구조 정의
- 각 demo card에 "보여주는 엔진 기능", "실행/검증 명령", "관련 문서" 표시
- 기존 demo route와 smoke/report artifact 연결 방식 정리

검증:

- `pnpm build:pages`
- `pnpm validate:pages-artifact`

### Slice 2: P0 기존 데모 역할 정리 (완료)

산출물:

- Starter Runtime README: 최소 통합 demo 역할 명시
- Top-down Shooter README: Game Spec/gameplay/replay 대표 demo 역할 명시
- Breakout/Platformer/Physics Sandbox README: 각 기능군 ownership 명시

검증:

- `pnpm validate:docs-links`
- 변경 demo별 smoke: `pnpm smoke:starter-runtime`, `pnpm smoke:topdown`, `pnpm smoke:breakout`, `pnpm smoke:platformer`, `pnpm smoke:physics-sandbox`

### Slice 3: P1 Content/UX Demo 분리 여부 결정

산출물:

- `examples/content-ux-demo` 신설 또는 `examples/minimal-game` lab mode 확장 결정
- HUD/localization/dialogue/cutscene/accessibility/reduced motion을 한 데모에서 보여주는 범위 정의
- Top-down Shooter에 억지로 content 기능을 추가하지 않는 경계 문서화

검증:

- `pnpm smoke:hud-toolkit`
- `pnpm smoke:localization`
- `pnpm smoke:dialogue-quest`
- `pnpm smoke:accessibility-options`

### Slice 4: P2 Renderer/Streaming Lab 노출

산출물:

- Renderer Lab: WebGL2 material/post-process/lighting/texture atlas/WebGPU fallback 상태 표시
- Level Streaming Demo: chunk lifecycle, asset preload, budget report를 사용자-facing route로 노출
- 기본 CI gate 확대 여부는 별도 승인 항목으로 유지

검증:

- `pnpm smoke:material`
- `pnpm smoke:lighting`
- `pnpm smoke:material-webgpu`
- `pnpm smoke:lighting-webgpu`
- `pnpm smoke:level-streaming`
- `pnpm smoke:level-streaming-browser`

### Slice 5: P2 Agent Workflow Demo 정리

산출물:

- create-game template, replay report, package consumer smoke를 "playable game"이 아니라 agent workflow showcase로 노출
- `packages/agents/templates/**`와 consumer harness는 Ferrum2D 엔진 자체 개발용이 아니라 consumer game project 설치용임을 명시
- report artifact schema와 demo docs route 연결

검증:

- `pnpm smoke:create-game-template-reports`
- `pnpm smoke:topdown-template-replay-report`
- `pnpm package:consumer-smoke`

### Slice 6: P3 Visual polish

산출물:

- 데모별 thumbnail/screenshot 정책
- asset 용량/라이선스/생성 asset 승인 기준
- Pages gallery 시각 정리

검증:

- `pnpm build:pages`
- `pnpm validate:pages-artifact`

## 판단 기준

새 데모나 데모 기능을 추가할 때 다음 질문에 답해야 한다.

| 질문 | 판단 |
| --- | --- |
| 이 기능군의 primary demo가 이미 있는가? | 있으면 기존 demo README/route를 보강하고, 새 demo는 만들지 않는다. |
| 기존 demo의 플레이 목표를 흐리게 만드는가? | 흐리면 별도 lab/demo/report route로 분리한다. |
| Game Spec, Physics Spec, scene authoring, public API 중 어디에 속하는가? | 위치가 불명확하면 demo-only code로 먼저 격리한다. |
| Rust frame hot path에 JS callback이나 object/string 전달이 늘어나는가? | 늘어나면 보류한다. |
| replay 또는 smoke로 drift를 잡을 수 있는가? | 없으면 검증 slice를 함께 추가한다. |
| create-game template 사용자가 재사용할 수 있는가? | 재사용 가능하면 template 후보로 기록한다. |
| Pages에서 사용자가 기능을 이해할 수 있는가? | 기능 설명, 데모 링크, 검증 명령을 같이 노출한다. |

## 다음 작업 추천

P0/P1 기반은 완료됐다. 다음 작업은 아래 후보 중 하나를 별도 task로 분리해 제품 노출 범위와 smoke 기준을 먼저 확정한다.

1. `minimal-game`의 Content/UX smoke profile을 public demo로 승격할지 결정한다.
2. Renderer/WebGPU와 Level Streaming을 별도 lab route로 노출할지 결정한다.
3. create-game/package consumer report를 Agent Workflow report route로 연결할지 결정한다.
4. public route를 추가하는 경우에만 thumbnail/asset 정책과 Pages artifact 검증 범위를 함께 확정한다.
