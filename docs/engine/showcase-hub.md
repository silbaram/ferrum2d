# Ferrum2D Showcase Hub

이 문서는 Ferrum2D가 현재 제공하는 제품 기능을 demo, 기준 문서, 검증 명령 기준으로 묶은 기능 지도다. 목적은 새 사용자가 "무엇을 어디서 볼 수 있고, agent가 어떤 파일과 report를 기준으로 작업해야 하는지"를 빠르게 파악하게 하는 것이다.

Ferrum2D는 visual editor 중심 제품이 아니라 AI agent-first 2D game engine이다. 따라서 showcase의 기준도 화면 효과만이 아니라 public API, spec, authoring data, replay, smoke report가 함께 있는지로 판단한다.

## 기능 지도

| 기능군 | 대표 demo 또는 경로 | 기준 문서 | 검증 명령 |
| --- | --- | --- | --- |
| Runtime baseline | Starter Runtime, Platformer, Breakout | [User Guide](user-guide.md), [Public API](public-api.md) | `pnpm build`, `pnpm smoke:starter-runtime`, `pnpm smoke:platformer`, `pnpm smoke:breakout` |
| Game Spec authoring | Top-down Shooter | [Top-down Shooter Game Spec](../examples/topdown-shooter/game-spec.md) | `pnpm validate:game-spec`, `pnpm smoke:headless`, `pnpm smoke:topdown-authored-behavior-runtime` |
| Scene/Object authoring | Placement Viewer, generated placement viewer | [Data Scene Authoring](data-scene-authoring.md), [Authoring API](public-api/authoring.md) | `pnpm smoke:placement-viewer`, `pnpm smoke:placement-viewer-save`, `pnpm smoke:placement-viewer-mass-authoring`, `pnpm smoke:placement-viewer-desktop-assets` |
| Physics authoring | Physics Sandbox | [Physics Spec](physics-spec.md), [2D Physics Map](../development/architecture/physics-engine.md) | `pnpm validate:physics-authoring`, `pnpm smoke:physics`, `pnpm smoke:physics-demo-suite` |
| Runtime extensibility | projectile, weapon, behavior, VFX, replay helpers | [Runtime Extensibility](runtime-extensibility.md), [Public API](public-api.md) | `pnpm validate:gameplay-authoring:report`, `pnpm smoke:gameplay-replay:report` |
| Consumer project workflow | create-game templates, consumer agents | [Developer Quickstart](developer-quickstart.md), [npm Package Strategy](../development/operations/npm-package-strategy.md) | `pnpm smoke:create-game-template-catalog`, `pnpm smoke:create-game-template-reports`, `pnpm package:consumer-smoke` |
| Package/release readiness | local tarball install and release rehearsal | [npm Release Procedure](../development/operations/npm-release.md) | `pnpm package:check`, `pnpm package:consumer-smoke`, `pnpm release:local-check` |

## Demo Gallery 기준

| Demo | 사용자가 확인하는 것 | Agent가 읽는 기준 |
| --- | --- | --- |
| Starter Runtime | 최소 runtime boot, UI overlay, debug/profiler path | `createFerrumRuntime(...)`, public root/core API, starter runtime smoke |
| Top-down Shooter | Game Spec 기반 shooter, asset/audio/tilemap/gameplay authoring | `examples/topdown-shooter/public/game.json`, Game Spec 문서, replay fixture |
| Placement Viewer | instance 선택, transform patch, ObjectDefinition 생성, behavior binding reference | `scene-authoring.json`, placement handoff state, authoring report |
| Physics Sandbox | Physics Spec apply, debug line, solver fixture catalog | Physics Spec sample, physics smoke suite, demo-suite browser smoke |
| Platformer | platform controller, runtime replay, generated template coverage | create-game `platformer` template, runtime replay fixture |
| Breakout | 두 번째 장르 runtime, collision/event path, scene authoring handle | create-game `breakout` template, scene authoring report |

## Agent-first 작업 흐름

새 consumer game에서 Ferrum2D의 기본 작업 단위는 source file 하나가 아니라 report와 검증 명령까지 포함한 작은 루프다.

1. `npm create @ferrum2d/game my-game -- --template minimal`
2. `npx @ferrum2d/agents init --tools codex,claude,gemini`
3. `npm run ferrum:report`
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

Pages home은 runtime, authoring, physics demo route와 핵심 문서 카드를 제공한다. 현재 public Pages demo route는 `starter-runtime`, `topdown-shooter`, `placement-viewer`, `physics-sandbox`, `breakout`, `platformer`다. 이 Showcase Hub는 기능을 설명하고, 실제 demo route는 Pages home의 demo 카드에서 진입한다.

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
