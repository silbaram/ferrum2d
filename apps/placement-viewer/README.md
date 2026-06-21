# Ferrum2D Placement Viewer

Data Scene 기반 Scene Placement/Object Authoring viewer를 실행하는 공식 authoring app이다. 목적은 사람이 위치, visual, collider, layer, ObjectDefinition, 기존 behavior recipe id reference를 확인/수정하고, agent가 같은 scene-authoring JSON과 handoff report를 기준으로 후속 작업을 이어가는 흐름을 제공하는 것이다.

이 app은 full visual editor가 아니다. Behavior Recipe 본문, FSM/action graph, animation timeline, tile painting은 이 viewer에서 편집하지 않는다.

## 확인 기술

| 기술 | 설명 |
| --- | --- |
| Data Scene preview | `public/placement.scene-authoring.json`을 로드해 `createDataSceneRuntimeTarget(...)`로 Rust `World`에 배치 instance를 spawn한다. |
| Engine-style authoring shell | `@ferrum2d/authoring-viewer` app chrome helper로 top toolbar, left object list, center viewport, right inspector, bottom runtime/status bar 구조를 만든다. |
| Sectioned inspector | `@ferrum2d/authoring-viewer` disclosure section helper로 Document, Identity, Transform, Object, Visual, Collider, Behavior Binding, Handoff를 접힘 섹션으로 묶는다. |
| Placement viewer state | `createScenePlacementViewer(...)`가 selected instance, entity handle, bounds, draft patch, diagnostics를 machine-readable state로 노출한다. |
| Transform patch | numeric input, snap grid, keyboard nudge, pointer drag가 `ScenePlacementPatch` draft로 기록된다. |
| ObjectDefinition catalog | sprite/primitive/prefab object를 추가하고 ObjectDefinition 기반 prefab reference를 draft patch로 만든다. |
| Component inspector | visual kind, sprite frame, collider shape, collision layer, size/offset 값을 `props.components` 경로로 편집한다. |
| Behavior binding inspector | 기존 recipe id reference attach/detach만 `updateBehaviorBinding` patch로 처리하고 recipe 본문은 보존한다. |
| Agent handoff | `createScenePlacementAgentHandoff(...)`로 selected object, draft patch, ownership field, diagnostics summary를 남기고, Handoff 섹션에서 Copy Patch/Copy Handoff/Save Draft 상태를 분리해 보여준다. |
| Save boundary | 기본 저장은 비활성이다. host save adapter와 dev endpoint는 명시 opt-in에서만 사용한다. |

## 실행

```bash
pnpm dev:placement-viewer
```

직접 package만 실행하려면 다음 명령을 사용한다.

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/ferrum-web build
pnpm --filter @ferrum2d/placement-viewer dev
```

저장 adapter smoke를 확인할 때만 opt-in 환경을 사용한다.

```bash
VITE_FERRUM_PLACEMENT_VIEWER_SAVE=true pnpm --filter @ferrum2d/placement-viewer dev
```

## 검증

```bash
pnpm --filter @ferrum2d/placement-viewer build
pnpm smoke:placement-viewer
pnpm smoke:placement-viewer-save
pnpm smoke:placement-viewer-mass-authoring
```

`pnpm smoke:placement-viewer`는 production build를 열고 canvas nonblank, selected id/entity handle, draft patch, Project Assets Add Sprite, ObjectDefinition 생성, Behavior Binding attach/detach reference patch, Handoff copy/save action 상태를 확인한다. `pnpm smoke:placement-viewer-mass-authoring`은 1,024개 추가 object scene에서 selection/patch/handoff summary와 render/runtime 규모를 확인한다.

## Pages 노출

`pnpm build:pages`는 production build를 `dist-pages/placement-viewer/`에 복사하고 Pages 홈의 Demos 목록에 노출한다.

## Desktop spike

`apps/placement-viewer-desktop`는 이 app의 production/dev frontend를 Tauri window에서 열고, Tauri command가 있을 때 샘플 `placement.scene-authoring.json`을 로컬 파일로 읽고 저장한다. Tauri가 없는 일반 브라우저와 Pages에서는 기존 fetch/Vite dev endpoint 흐름을 유지한다. 문서 전환 전에 draft patch가 남아 있으면 기존 변경을 버릴지 확인한다.

## 참고 문서

- [Showcase Hub](../../docs/engine/showcase-hub.md)
- [Data Scene Authoring](../../docs/engine/data-scene-authoring.md)
- [Authoring public API](../../docs/engine/public-api/authoring.md)
- [Object Authoring Tool Plan](../../docs/planning/object-authoring-tool-plan.md)
- [Smoke Check](../../docs/development/quality/smoke-check.md)

## 다음 단계

- generated consumer project viewer 동작은 `pnpm package:consumer-smoke`와 `pnpm smoke:create-game-template-reports`로 검증한다.
- recipe 본문 편집, FSM/action graph, timeline UI가 필요하면 visual-editor급 별도 승인 범위로 다룬다.
