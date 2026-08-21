# 데모 게임 포트폴리오 후속 계획

상태: P0/P1 기반 완료, 신규 public 노출 후보 결정 대기
기준일: 2026-08-21

이 문서는 이미 구현된 데모의 사용법을 반복하지 않고, smoke/report로만 확인되는 기능을 public
showcase로 승격할지 결정하기 위한 planning 기록이다. 현재 route와 운영 계약은
[Showcase Hub](../engine/showcase-hub.md)와
[GitHub Pages 데모/문서 배포](../development/operations/demo-deploy.md)가 기준이다.

## 확정된 기반

Pages artifact에는 다음 여섯 public route가 있다.

| Route | 역할 | 대표 검증 |
| --- | --- | --- |
| Starter Runtime | 가장 작은 runtime 통합 예제 | `pnpm smoke:starter-runtime` |
| Top-down Shooter | Game Spec, gameplay, replay 대표 데모 | `pnpm smoke:topdown` |
| Placement Viewer | Scene Placement/Object Authoring workflow | `pnpm smoke:placement-viewer` |
| Physics Sandbox | Physics Spec, solver, query, debug 대표 데모 | `pnpm smoke:physics-sandbox` |
| Breakout | 작은 arcade starter와 effect 흐름 | `pnpm smoke:breakout` |
| Platformer | platform movement와 terrain starter | `pnpm smoke:platformer` |

이 route를 다시 만들거나 Top-down Shooter에 모든 기능을 추가하는 작업은 후보가 아니다.

## 남은 public 노출 후보

| 순서 | 후보 | 현재 증거 | 결정할 내용 |
| ---: | --- | --- | --- |
| 1 | Content/UX | HUD, localization, dialogue/quest, cutscene, accessibility smoke | `minimal-game` mode로 노출할지 별도 demo로 만들지 결정 |
| 2 | Renderer/WebGPU Lab | material, lighting, post-process, WebGPU fallback smoke | 사용자-facing lab 가치와 fallback 상태 표시 범위 결정 |
| 3 | Level Streaming | chunk lifecycle, preload, browser/budget smoke | playable demo가 필요한지 report route로 충분한지 결정 |
| 4 | Agent Workflow | create-game, replay, package consumer report | playable game이 아닌 report/docs route로 노출할지 결정 |
| 5 | Visual polish | 기존 route screenshot/thumbnail | 새 asset의 용량, 라이선스, 생성 승인 후 진행 |

후보는 구현 우선순위가 아니라 제품 노출 결정을 위한 검토 순서다. 현재 smoke가 있다는 이유만으로
새 route를 만들지 않는다.

## 기능별 현재 위치

| 기능군 | 현재 primary surface | public 노출 판단에 사용할 검증 |
| --- | --- | --- |
| Content/localization/dialogue/accessibility | library + smoke | `pnpm smoke:hud-toolkit`, `pnpm smoke:localization`, `pnpm smoke:dialogue-quest`, `pnpm smoke:accessibility-options` |
| Material/lighting/WebGPU | renderer lab API + smoke | `pnpm smoke:material`, `pnpm smoke:lighting`, `pnpm smoke:material-webgpu`, `pnpm smoke:lighting-webgpu` |
| Level streaming/large world | runtime API + smoke | `pnpm smoke:level-streaming`, `pnpm smoke:level-streaming-browser` |
| Agent-first project workflow | create-game/package report | `pnpm smoke:create-game-template-reports`, `pnpm package:consumer-smoke` |

## 착수 판단 기준

새 demo나 report route를 시작하려면 다음 질문에 먼저 답한다.

1. 기존 route나 Showcase Hub 설명만으로 기능을 이해할 수 없는가?
2. 사용자가 브라우저에서 직접 조작해야만 가치가 드러나는가?
3. 기존 primary demo의 플레이 목표를 흐리지 않는가?
4. public API와 제품 지원 수준이 lab/demo 노출을 감당할 만큼 안정적인가?
5. replay, browser smoke 또는 report로 drift를 잡을 수 있는가?
6. Pages artifact 크기와 CI runtime budget 증가를 수용할 것인가?

하나라도 불명확하면 구현 전에 별도 task에서 사용자-facing 목표와 acceptance를 확정한다.

## 후보별 최소 acceptance

### Content/UX

- HUD, locale 전환, dialogue/quest, cutscene, reduced motion을 한 흐름에서 확인한다.
- Top-down 대표 gameplay에 기능을 계속 누적하지 않는다.
- keyboard와 기본 accessibility smoke를 함께 유지한다.

### Renderer/WebGPU Lab

- WebGL2 기본 경로와 WebGPU opt-in/fallback 상태를 화면에 명시한다.
- Rust render command ABI와 WebGL2 fallback을 변경하지 않는다.
- material/lighting/post-process 차이를 사용자에게 설명할 수 있어야 한다.

### Level Streaming

- chunk load/unload와 asset lifetime을 화면 또는 machine-readable report로 확인한다.
- browser runtime budget을 함께 제시한다.
- 단순히 큰 map을 보여주는 데모로 끝내지 않는다.

### Agent Workflow

- create-game → `ferrum:check` → replay/report 흐름을 보여준다.
- consumer agent template과 엔진 개발용 agent를 혼동하지 않는다.
- private package 상태에서는 public 설치가 가능하다고 표현하지 않는다.

## 비목표와 승인 경계

- full visual editor나 Behavior Recipe Body Editor를 데모 명목으로 추가하지 않는다.
- 새 시각 asset은 용량, 라이선스, 생성 방식 승인 전 추가하지 않는다.
- Pages 실제 배포는 별도 사용자 승인 없이는 실행하지 않는다.
- 기본 CI gate 확대는 route 구현과 별도로 runtime/비용을 검토한다.

## 다음 결정

가장 먼저 Content/UX를 public route로 승격할 실사용 가치가 있는지 판단한다. 가치가 불명확하면 신규
route 대신 Showcase Hub의 기능 coverage와 smoke/report 링크만 보강한다. Renderer/Streaming/Agent
Workflow도 같은 기준을 순서대로 적용한다.
