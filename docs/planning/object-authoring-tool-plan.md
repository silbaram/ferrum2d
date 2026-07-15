# 오브젝트 Authoring 모델 · 공식 배치 툴 고도화 계획

이 문서는 Ferrum2D가 2D 게임 엔진으로서 "오브젝트를 만들고, 배치하고, 저장하고, AI agent가 기능을 붙이는" 흐름을 어떻게 제품 기능으로 가져갈지 정리한다. 기존 [오브젝트 배치 UI · 데이터 씬 authoring 보강 계획](object-placement-authoring-plan.md)의 후속 상세화이며, 운영 계약은 `docs/engine/**`, `docs/development/**`, public API 문서가 우선한다.

핵심 방향은 투트랙이다.

- **Track A: 공식 UI 배치 툴**: 사용자가 화면을 보면서 오브젝트를 선택, 이동, 추가, 저장한다.
- **Track B: 오브젝트 모델 고도화**: primitive, sprite, collider, behavior, prefab, instance를 engine authoring contract로 정리한다.

중요한 전제: Ferrum2D는 full visual editor 중심 엔진이 아니다. UI는 사람이 모든 로직을 클릭으로 만드는 제품이 아니라, AI agent-first 개발 흐름에서 위치/시각/충돌 같은 authoring 데이터를 안전하게 편집하고 검증하는 공식 도구다.

## 현재 계획 상태

- **v1 완료**: primitive/sprite/prefab 배치, transform/visual/collider 편집, ObjectDefinition 생성, patch/save/handoff, Behavior Binding Inspector, Data Scene runtime 연결, official/generated viewer smoke가 product-ready 기준을 충족한다.
- **완료 기록의 기준**: 이 문서의 Track A/B와 2026-06-18~19 worktree 기록은 결정 근거다. 실제 사용법과 public contract는 `docs/engine/**`, `docs/development/**`, package README가 우선한다.
- **활성 후보**: `@ferrum2d/authoring-viewer` 독립 browser app 확장과 npm release checklist/beta pin을 각각 별도 task로 판단한다. local image dimension metadata는 완료됐다.
- **별도 승인**: Tauri package/GUI release, Behavior Recipe Body Editor, FSM/action graph, node hierarchy, tile/path/timeline editor는 v1 후속 작업으로 자동 착수하지 않는다.

## 조사 기준

조사는 2026-06-17 기준 공식 문서를 우선했다.

| 엔진/툴 | 참고 문서 | Ferrum2D에 반영할 관찰 |
| --- | --- | --- |
| Unity | [GameObjects](https://docs.unity3d.com/Manual/GameObjects.html), [Prefabs](https://docs.unity3d.com/Manual/Prefabs.html), [Sprite Renderer](https://docs.unity3d.com/Manual/class-SpriteRenderer.html), [Collision](https://docs.unity3d.com/Manual/CollidersOverview.html) | GameObject는 빈 컨테이너이고 기능은 Component가 담당한다. Prefab은 컴포넌트/값/자식 오브젝트를 저장하는 재사용 템플릿이다. Sprite와 Collider는 별도 컴포넌트다. |
| Godot | [Nodes and Scenes](https://docs.godotengine.org/en/stable/getting_started/step_by_step/nodes_and_scenes.html), [2D Sprite Animation](https://docs.godotengine.org/en/stable/tutorials/2d/2d_sprite_animation.html) | Node와 Scene이 기본 단위이며 Scene은 저장, 인스턴스화, 중첩 가능한 단위다. 2D 표시/애니메이션은 Sprite2D/AnimatedSprite2D 같은 노드 조합으로 표현한다. |
| Cocos Creator | [Nodes and Components](https://docs.cocos.com/creator/3.8/manual/en/concepts/scene/node-component.html), [Prefab](https://docs.cocos.com/creator/3.8/manual/en/asset/prefab.html), [Sprite Component](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/editor/sprite.html) | Node + Component 구조이며 Prefab은 재사용 가능한 scene object 데이터를 저장한다. Sprite는 이미지 리소스를 읽는 2D 렌더 컴포넌트다. |
| Defold | [Building blocks](https://defold.com/manuals/building-blocks/), [Components](https://defold.com/manuals/components/), [Factory](https://defold.com/manuals/factory/), [Sprite](https://defold.com/manuals/sprite/), [Collision objects](https://defold.com/manuals/physics-objects/) | Collection, Game Object, Component가 분리된다. Factory는 prototype/prefab 역할의 game object file로 런타임 spawn을 수행한다. Collision object는 visual과 별도다. |
| Phaser | [Game Objects](https://docs.phaser.io/phaser/concepts/gameobjects), [Scenes](https://docs.phaser.io/phaser/concepts/scenes), [Game Object Components](https://docs.phaser.io/phaser/concepts/gameobjects/components) | Game Object는 Scene에 속하고 display/update list, texture/frame, active/visible 상태를 가진다. 코드 중심 엔진에서도 object 생성과 scene 소속은 명확히 분리한다. |
| Tiled | [Working with Objects](https://doc.mapeditor.org/en/stable/manual/objects/), [Working with Layers](https://doc.mapeditor.org/en/stable/manual/layers/), [Custom Properties](https://doc.mapeditor.org/en/stable/manual/custom-properties/) | 레벨 authoring 툴은 rectangle, point, ellipse, polygon, tile object, template 같은 placement primitive와 custom property를 제공한다. 선택, 이동, 리사이즈, 회전, layer order가 기본 편집 UX다. |

## 공통 패턴

다른 2D 엔진과 툴에서 반복되는 패턴은 다음이다.

| 패턴 | 설명 | Ferrum2D 적용 |
| --- | --- | --- |
| 빈 오브젝트와 기능 분리 | 오브젝트 자체는 위치/식별자 컨테이너이고 기능은 component/node/script가 붙는다. | `ObjectInstance`는 id/transform/ref 중심으로 두고 visual/collider/behavior는 data component로 둔다. |
| 정의와 인스턴스 분리 | Prefab, Scene, Template, Prototype은 재사용 정의이고, Scene/Room/Map에는 instance가 배치된다. | `sceneComposition.prefabs[]`를 object definition catalog로 승격하고, `fragments[].instances[]`는 배치 instance로 유지한다. |
| 시각과 충돌 분리 | Sprite는 보이는 이미지이고 Collider는 보이지 않는 충돌 shape다. 같은 모양일 필요가 없다. | `visual`과 `collider`를 별도 authoring component로 둔다. |
| primitive placeholder | rect/circle/point/polygon 같은 기본 도형은 이미지가 없어도 배치/충돌/영역 지정에 필요하다. | `primitive` visual/collider를 v1부터 공식 object type으로 둔다. |
| prefab override | instance는 prefab 기본값을 상속하되 위치, variant, 일부 속성을 override한다. | `ObjectInstance.overrides` 또는 기존 `props` overlay로 제한된 override를 허용한다. |
| editor 저장은 데이터 저장 | editor는 런타임 객체 자체가 아니라 scene/prefab/map 데이터를 저장한다. | UI는 `ferrum2d.consumer.scene-authoring` 문서의 UI-owned field만 merge 저장한다. |
| runtime compile 단계 | authoring data는 runtime spawn/template/component로 변환된다. | TS resolver가 authoring JSON을 검증하고 낮은 빈도 spawn facade가 Rust `World`에 숫자형 값으로 설치한다. |

## Ferrum2D 제품 원칙

Ferrum2D는 위 패턴을 그대로 복제하지 않는다. 다음 제약을 유지한다.

- Rust core가 게임 상태, entity/component storage, collision/physics, render command 생성을 소유한다.
- TypeScript는 browser/platform, asset loading, authoring validation, low-frequency adapter를 소유한다.
- frame loop에서 entity별 JS/Wasm 왕복 호출을 만들지 않는다.
- UI 배치 툴은 official product surface지만, full visual editor나 런타임 scene graph 도입은 아니다.
- AI agent가 수정하기 쉬운 JSON/spec/schema, validation, smoke check가 우선이다.
- UI는 agent-owned behavior 본문을 덮어쓰지 않는다.

## Ferrum2D 용어 정리

| 범용 엔진 용어 | Ferrum2D 권장 용어 | 의미 |
| --- | --- | --- |
| GameObject, Node, Object | `ObjectDefinition` / `ObjectInstance` | 정의와 배치 instance를 명확히 구분한다. |
| Primitive | `visual.primitive`, `collider.shape` | rect, circle, capsule, polygon 같은 기본 도형이다. |
| Sprite, Image | `visual.sprite` | texture/atlas frame 기반 2D 표시다. |
| Texture, SpriteFrame | `assetRef`, `textureId`, `frame` | asset authoring id와 runtime numeric id를 분리한다. |
| Collider, Collision Shape | `collider` | gameplay/physics 충돌용 shape다. visual과 독립이다. |
| Prefab, PackedScene, Template, Prototype | `ObjectDefinition` 또는 `Prefab` | 재사용 가능한 오브젝트 템플릿이다. |
| Scene, Collection, Room, Map | `SceneAuthoringDocument` | 배치 instance와 behavior recipe를 담는 authoring 문서다. |
| Script, Behavior | `BehaviorRecipe` | AI agent가 붙이는 기능 정의다. |

## 목표 아키텍처

오브젝트 authoring의 장기 목표는 다음 구조다.

```text
SceneAuthoringDocument
  sceneComposition
    prefabs[] / objectDefinitions[]
      id
      visual
        primitive | sprite
      collider
      physics
      behaviorBindings
      defaults
    fragments[]
      instances[]
        id
        prefab/object reference
        transform
        layer
        overrides
  behaviorRecipes
    entities[]
      id
      commands / FSM / gameplay components
```

현재 Ferrum2D 구현과의 매핑은 다음으로 시작한다.

| 목표 개념 | 현재 위치 | 방향 |
| --- | --- | --- |
| `ObjectDefinition` | `sceneComposition.prefabs[]` | 이름은 당장 바꾸지 않고 문서/타입 alias로 의미를 명확히 한다. |
| `ObjectInstance` | `sceneComposition.fragments[].instances[]` | `instance.id`를 사람과 agent의 공용 어휘로 유지한다. |
| `visual.sprite` | `props.components.visual(kind: "sprite")`, legacy `props.components.sprite` | 신규 authoring은 `visual`을 우선하고 기존 sprite shorthand는 호환 유지한다. |
| `visual.primitive` | `props.components.visual(kind: "primitive")` | sprite가 없는 rect/circle/point 표시를 Data Scene runtime fallback sprite로 컴파일한다. |
| `collider` | `props.components.collider` | visual과 분리하고 inspector 편집 대상으로 승격한다. |
| `behaviorBindings` | `props.behaviorRecipes`, `behaviorRecipes.entities` | UI는 binding preview만 제공하고 본문 편집은 agent 소유로 둔다. |
| 런타임 spawn | `createDataSceneRuntimeTarget(...)` | 낮은 빈도 scene apply 경로에서만 compile/spawn한다. |

## Track A: 공식 UI 배치 툴

Track A의 목표는 사용자가 실제 게임 화면을 보면서 오브젝트를 추가/선택/이동/저장하고, AI agent가 같은 `instance.id`를 기준으로 기능을 붙일 수 있게 하는 것이다.

### A0. 공식 제품 경계 확정

현재 `apps/placement-viewer`는 공식 실행 host와 smoke fixture 역할을 한다. 공식화는 "예제에 코드가 있으니 임시"가 아니라 다음 경계로 정리한다.

| 영역 | 권장 위치 | 설명 |
| --- | --- | --- |
| public controller/API | `packages/ferrum-web/src/scenePlacementViewer.ts`, `authoring.ts` export | 제품 기능의 source of truth다. |
| UI host | `apps/placement-viewer` | 실행 가능한 공식 browser app이다. |
| 공통 viewer helper | `packages/ferrum-authoring-viewer` | 공식 app과 generated viewer가 공유하는 UI shell/control/evidence helper다. |
| create-game 통합 | `packages/create-game` template | consumer project에서 `npm run ferrum:placement-viewer`로 실행한다. |
| smoke fixture | `tests/smoke/browser-render-smoke.mjs` | 공식 동작을 회귀 검증한다. |

제품 API는 `packages/ferrum-web`에 두고, 공통 viewer helper는 `packages/ferrum-authoring-viewer`에 둔다. 실행 가능한 공식 host와 smoke fixture는 `apps/placement-viewer`로 유지한다.

### A1. 선택/이동/저장 안정화

이미 진행한 흐름을 공식 acceptance로 고정한다.

- canvas nonblank preview가 Data Scene spawn 결과를 보여준다.
- click/hover로 `selectedInstanceId`, `hoveredInstanceId`, entity handle을 노출한다.
- drag, arrow nudge, numeric input으로 transform draft를 만든다.
- draft marker는 선택 변경 후에도 남는다.
- `Save`는 UI-owned transform/add/remove/rename patch만 scene-authoring JSON에 merge한다.
- production build에서는 임의 파일 쓰기가 비활성화된다.

검증:

- `pnpm --filter @ferrum2d/placement-viewer build`
- `pnpm smoke:placement-viewer`
- `pnpm validate:docs-links`

### A2. Add Object 팔레트

UI에 새 오브젝트 추가 흐름을 넣는다.

현재 상태(2026-06-17):

- `apps/placement-viewer`에 `Rect`, `Circle`, `Point`, `Sprite`, `Prefab` palette 버튼을 추가했다.
- Rect/Circle/Point/Sprite는 `object` prefab instance에 inline `props.components.visual`/`collider`/`layer`를 저장한다.
- Prefab은 기존 `crate` prefab reference를 추가한다.
- 신규 id는 `{kind}_{index}` 규칙으로 자동 생성하고, `new id` 입력으로 명시 override할 수 있으며, 생성 직후 선택 상태가 된다.
- Add mode 진입 후 canvas hover preview를 표시하고, canvas click으로 배치한다.
- Sprite/Prefab 선택 control로 기본 sprite asset과 prefab id를 고를 수 있다.
- draft patch와 draft marker는 add/remove 흐름에 반영된다.
- 저장 전 reference conflict diagnostic UI를 표시하고, agent-owned reference가 남아 있으면 Save를 비활성화한다.

초기 팔레트:

- `Add Rect`
- `Add Circle`
- `Add Point`
- `Add Sprite`
- `Add Prefab`

필수 UX:

- 추가 전 hover preview를 표시한다.
- click으로 배치하고 바로 id 입력/자동 id 생성이 가능해야 한다.
- 생성 직후 선택 상태가 된다.
- 저장 전에는 draft marker로 표시한다.
- id 중복, 빈 id, agent binding reference 충돌은 저장 전 diagnostic으로 보여준다.

저장 범위:

- UI가 만든 instance는 `sceneComposition.fragments[].instances[]`에만 추가한다.
- 새 prefab/object definition 생성은 A3 이후 명시 action으로 분리한다.

### A3. Primitive authoring UI

rect/circle/point/capsule/polygon을 이미지 없이 배치할 수 있게 한다.

현재 상태(2026-06-17):

- `ObjectVisualSpec`/`DataSceneObjectVisualSpec`에 `primitive` visual descriptor를 추가했다.
- v1 visual primitive `rect`, `circle`, `point`와 collider `none`, `aabb`, `circle` 조합을 placement viewer에서 생성한다.
- Runtime target은 primitive visual을 `DATA_SCENE_PRIMITIVE_TEXTURES.*` fallback sprite로 컴파일한다.
- placement viewer inspector에서 primitive/sprite visual kind, rect/circle/point shape, width/height/radius, color, collider none/aabb/circle/capsule/orientedBox/convexPolygon, offset, enabled/trigger/layer를 직접 편집할 수 있다.
- 편집은 `updateInstanceComponents(...)` draft patch로 기록하고, 새로 추가한 instance의 component edit은 `addInstance` patch 안으로 접는다.
- 선택 collider overlay를 공식 placement viewer에 추가해 visual bounds와 collider bounds를 별도 확인할 수 있다.
- v1 resize는 inspector의 numeric width/height/radius control과 선택 overlay의 rect/circle southeast resize handle로 지원한다. Capsule/polygon 같은 advanced primitive 편집은 후속 visual-editor급 작업으로 분리한다.

v1 범위:

- visual primitive: `rect`, `circle`, `point`
- collider primitive: `none`, `aabb`, `circle`
- 색상/tint는 debug/editor visual로 허용하되 runtime material 정책과 분리한다.
- rect/circle 크기 변경은 inspector numeric control로 지원한다.

보류:

- polygon vertex editor
- bezier/path editor
- terrain paint

이 보류 항목은 Tiled식 advanced map editor 영역에 가깝다.

### A4. Sprite asset picker

이미지를 오브젝트 visual로 연결한다.

현재 상태(2026-06-17):

- `createScenePlacementAssetProvider(...)` public authoring helper를 추가해 sprite asset id, 기본 size, thumbnail metadata를 placement tool이 읽을 수 있게 했다.
- `ScenePlacementSpriteAsset.frames[]` metadata와 `resolveSpriteFrame(...)`, `diagnoseSpriteAssetReference(...)`를 추가해 atlas frame picker와 missing asset/frame diagnostic을 public contract로 고정했다.
- 공식 placement viewer의 Add Sprite select는 asset provider 목록을 사용하고 thumbnail/size preview를 표시한다.
- 공식 placement viewer의 frame select는 provider frame metadata를 사용하고 선택한 UV rect/size를 `visual.kind: "sprite"` add patch에 반영한다.
- Add Sprite는 provider/frame size를 `visual.kind: "sprite"`와 기본 aabb collider에 반영한다.
- `createScenePlacementAssetProviderFromProjectAssets(...)`를 추가해 project `AssetManifest.textures`, runtime `TextureRegistry.entries()`, Game Spec `atlas.frames`에서 placement asset provider를 자동 생성할 수 있게 했다.
- `apps/placement-viewer`는 같은 adapter로 fixture sprite provider를 구성한다.
- create-game 공유 placement viewer는 optional `public/game.json` atlas와 `public/assets/texture-atlas.input.json`을 읽어 project asset catalog, Add Sprite draft action, handoff asset diagnostic을 노출한다.

v1 범위:

- host가 제공한 asset provider 목록 표시
- texture/atlas frame 선택
- preview thumbnail
- sprite size, origin/pivot, render layer, sort order 입력
- missing asset diagnostic

저장 형태:

```json
{
  "components": {
    "sprite": {
      "asset": "tree",
      "frame": "idle_0",
      "width": 48,
      "height": 64
    }
  }
}
```

주의:

- UI는 PNG 자체를 생성하거나 수정하지 않는다.
- asset import/atlas packing은 기존 asset pipeline 또는 별도 helper가 담당한다.

### A5. Inspector 고도화

Inspector는 오브젝트 구조를 그대로 보여줘야 한다.

현재 상태(2026-06-17):

- `ScenePlacementViewerState.selected`가 resolved `visual`, `collider`, `componentLayer` summary를 노출한다.
- `ScenePlacementViewerState.objectDefinitions`가 Prefab/ObjectDefinition catalog id, variants, 기본 visual/collider/layer summary를 노출한다.
- 공식 placement viewer inspector가 `Identity`, `Visual`, `Collider`, `Behavior` 정보를 표시한다.
- 공식 placement viewer inspector는 `Document`, `Identity`, `Transform`, `Object`, `Visual`, `Collider`, `Behavior Binding`, `Handoff`를 접힘 섹션으로 묶고, 기존 `placement-details` row와 control data attribute는 유지한다.
- generated create-game placement viewer도 Selected Inspector를 `Identity`, `Visual`, `Collider`, `Behavior` 그룹으로 나누고, consumer smoke가 선택 상태와 DOM detail 값을 동기화 검증한다.
- 공식 placement viewer shell은 엔진 authoring tool에서 익숙한 left object list, center viewport, right inspector, bottom runtime/status bar 구조를 사용한다.
- top file strip은 scene-authoring 문서명/경로, saved/unsaved/blocked/read-only 상태, draft 변경 수를 표시한다.
- Visual/Collider/Layer 직접 편집 control이 primitive/sprite visual, collider none/aabb/circle/capsule/orientedBox/convexPolygon, offset, trigger/layer 값을 `props.components` draft patch로 저장한다.
- 공식 placement viewer overlay가 selected collider bounds를 visual selection bounds와 별도 표시한다.
- Binding reference report가 rename/remove patch의 agent-owned reference를 표시하고, conflict가 있으면 save를 막는다.
- `createScenePlacementAgentHandoff(...)` public helper가 selection, draft patch, migration preview, asset diagnostics를 agent handoff envelope로 묶는다.
- Handoff 섹션은 patch operation 수, blocked reference 수, asset diagnostic 수를 표시하고 Copy Patch, Copy Handoff, Save Draft action 상태를 분리한다.
- 문서 전환 전에 draft patch가 남아 있으면 unsaved change 확인을 거친다.
- 남은 항목: behavior recipe 본문 생성 UI는 full visual editor 영역으로 분리하고, v1은 handoff JSON/API를 공식 계약으로 둔다.

섹션:

- `Transform`: x, y, rotation, scale, layer, snap
- `Visual`: primitive/sprite, asset/frame, size, color/tint
- `Collider`: enabled, shape, offset, size, trigger/layer
- `Behavior`: 붙은 recipe id 목록, agent handoff command, binding migration preview
- `Identity`: instance id, prefab id, variant, role

Behavior 본문 편집은 UI v1 범위가 아니다. UI는 "이 객체에 behavior를 붙여줘"라고 agent에게 넘길 수 있는 상태와 id를 안정적으로 제공한다.

#### A5.1 Behavior UI 허용 경계

Ferrum2D의 agent-first 철학을 유지하려면 placement viewer의 behavior UI는 **Behavior Binding Inspector**까지로 제한한다. 이 경계는 UI가 gameplay logic을 조립하는 제품이 아니라, 사람이 선택한 object와 agent/spec/report 루프를 연결하는 보조 도구라는 의미다.

현재 상태(2026-06-18):

- `ScenePlacementPatch`에 `updateBehaviorBinding` operation을 추가해 instance/ObjectDefinition의 `props.behaviorRecipes` reference만 attach/detach할 수 있게 했다.
- 공식 `apps/placement-viewer`는 선택 instance에 대해 기존 recipe id 목록을 표시하고 attach/detach draft patch를 만든다.
- generated create-game 공유 placement viewer도 같은 attach/detach reference patch와 smoke 검증을 제공한다.
- `mergeScenePlacementPatch(...)`는 `behaviorRecipes.entities` 본문을 보존하고, binding reference만 scene composition props에 반영한다.
- unit test와 `pnpm smoke:placement-viewer`가 binding attach/detach patch export와 inspector state를 검증한다.

허용 범위:

- 선택 instance/prefab/ObjectDefinition에 현재 연결된 `props.behaviorRecipes` id를 표시한다.
- 기존 `behaviorRecipes.entities` catalog id 목록을 읽어 선택 가능하게 보여준다.
- 사용자가 명시적으로 선택한 기존 recipe id를 instance 또는 ObjectDefinition/Prefab binding reference로 attach/detach한다.
- attach/detach는 recipe 본문이 아니라 binding reference만 수정하는 별도 patch로 export한다.
- 저장 전 `previewScenePlacementBindingMigration(...)`, authoring validation, handoff/report evidence로 reference 충돌을 표시한다.
- agent handoff에는 selected `instanceId`, `prefab`, `role`, resolved visual/collider, 현재 binding id, draft binding patch를 포함한다.

금지 범위:

- UI에서 `behaviorRecipes.entities` 본문을 생성/수정하지 않는다.
- UI에서 health/damage/faction/movement/timer/collision reaction 같은 gameplay component 값을 폼으로 조립하지 않는다.
- UI에서 FSM state/transition, action graph, timeline, trigger/action editor를 제공하지 않는다.
- UI가 TypeScript callback/script 또는 runtime logic을 생성하지 않는다.
- placement-only save와 behavior binding save를 묵시적으로 섞지 않는다.

따라서 개발명은 `Behavior Recipe Editor`가 아니라 `Behavior Binding Inspector`로 둔다. recipe 본문 편집, FSM/action graph, visual scripting은 별도 승인 전 production 구현하지 않는 visual-editor급 범위다.

### A6. 저장과 handoff

저장 계층은 세 단계로 유지한다.

| 단계 | 설명 | 기본 상태 |
| --- | --- | --- |
| patch export | JSON patch를 export하고 agent가 workspace 파일에 적용한다. | 항상 가능 |
| host save adapter | dev server/create-game host가 allowlist 파일만 저장한다. | dev opt-in |
| File System Access API | 사용자가 브라우저에서 직접 파일 권한을 준 경우 저장한다. | enhancement |

handoff 파일은 저장 기능의 대체물이 아니라 agent가 현재 선택/draft 상태를 읽는 보조 데이터다.

현재 공식 viewer와 generated create-game viewer는 Handoff 섹션에서 draft patch JSON과 agent handoff JSON을 클립보드로 복사할 수 있게 하고, draft operation 수, blocked reference 수, asset diagnostic 수, Save Draft action 상태를 분리한다. reference 충돌이 있으면 Save Draft action은 blocked 상태로 유지한다. 이 UI는 patch/handoff evidence를 사람이 agent에게 넘기는 보조 흐름이며, behavior recipe 본문 편집이나 visual scripting UI가 아니다.

### A7. 공식 packaging 판단

현재 상태(2026-06-18):

- `packages/ferrum-web`에 official viewer controller/API 유지
- `apps/placement-viewer`는 official host + smoke fixture로 유지
- `apps/placement-viewer-desktop` Tauri spike를 추가해 공식 viewer frontend를 Tauri window에서 열고, 기본 샘플, `FERRUM_PLACEMENT_SCENE_DOCUMENT`, 명시 scene 문서 경로 입력, project root 직접 경로 입력, Tauri native file dialog `Browse`, 또는 `Choose` directory dialog로 선택한 consumer project의 `public/scene-authoring.json`을 Rust command로 읽고 저장하는 1~4단계 확인을 완료했다. Inspector는 현재 프로젝트 경로, asset folder 상태, 문서 경로, handoff 경로, 저장 모드를 표시한다. 명시 프로젝트 또는 명시 scene 문서를 연 상태에서는 `.ferrum-placement-handoff.json`을 debounce 후 자동 sync하고, Handoff 섹션의 `Save Handoff`는 같은 payload를 즉시 수동 저장한다. project 기본 `<project>/public/assets` 또는 명시 asset folder의 이미지 파일 목록/`texture-atlas.input.json`/missing diagnostic을 handoff `assetFolder` evidence로 남긴다. Tauri custom protocol 기반 `ferrum-asset://...` preview URL, Add Sprite local thumbnail preview, initial runtime texture registration, Add Sprite local draft preview/handoff 동기화, asset folder 변경 후 runtime texture reload는 완료했고 `pnpm smoke:placement-viewer-desktop-assets`가 local texture id, runtime reload status, pending/draft marker, draft patch, canvas readback을 검증한다. 이 app은 packaging 검증 전 단계의 실험 host다.
- create-game template에 consumer host 제공
- `packages/ferrum-authoring-viewer` workspace-private 패키지를 추가해 viewer title, app chrome, workflow owner, behavior binding path/evidence, DOM control/shell/panel primitive helper 같은 공통 viewer 계약을 분리했다.
- 공식 `apps/placement-viewer`는 새 패키지의 app chrome helper로 top file strip/status bar를 만들고, generated create-game viewer/harness는 title, behavior profile 표시, key-value row/number control, generated viewer shell, panel primitive, ownership/evidence helper를 사용한다.
- generated create-game placement viewer는 ObjectDefinition, Project Assets, Selected detail 패널 렌더링을 `ferrum-placement-viewer-object-panels.ts` 모듈로 분리했고, Selected Inspector를 `Identity`, `Visual`, `Collider`, `Behavior` grouped detail로 정리했다. Transform/actions 패널 렌더링과 memory save action은 `ferrum-placement-viewer-transform-panel.ts` 모듈로 분리했다. Stage/list 렌더링, viewport resize, pointer selection, session 생성은 `ferrum-placement-viewer-stage-session.ts` 모듈로 분리했고, smoke hook/window publish와 handoff/patch output, Copy Patch, Copy Handoff, Save Draft action state 갱신은 `ferrum-placement-viewer-publish.ts` 모듈로 분리했다. Scene authoring document와 project asset provider loading은 `ferrum-placement-viewer-assets.ts` 모듈로 분리했고, startup error diagnostic/rendering은 `ferrum-placement-viewer-startup-error.ts` 모듈로 분리했다. package check가 이 shared template module들의 module-set drift, tarball 포함, public import 경계와 generated Handoff action state 및 grouped Selected Inspector guard를 검증한다.
- create-game CLI는 `--authoring-viewer-version`으로 generated project의 `@ferrum2d/authoring-viewer` dependency를 주입한다.
- package check와 consumer smoke는 `@ferrum2d/authoring-viewer` tarball을 함께 검증한다.

완료된 정리/스테이징 기준(결정 기록):

- generated viewer 모듈화만 별도 변경으로 묶을 때는 `packages/create-game/templates/_shared/src/ferrum-placement-viewer*`, `packages/create-game/README.md`, `scripts/package/check-create-game-package.mjs`, 이 문서의 A7 상태만 포함한다.
- 단, generated viewer가 `@ferrum2d/authoring-viewer`를 import하는 상태에서는 `packages/ferrum-authoring-viewer`, root workspace/package metadata, create-game CLI의 `--authoring-viewer-version`, template `package.json`, package QA script 변경도 같은 통합 범위에 포함하거나 선행 변경으로 먼저 병합해야 한다.
- `packages/ferrum-web/src/scenePlacementAssets.ts`, `scenePlacementHandoff.ts`, 관련 public API/test/doc 변경은 placement asset provider와 handoff public API 범위다. generated viewer UI 모듈화 commit에 섞지 않고, public authoring API 변경으로 별도 검토한다.
- agent/skill 파일 변경은 consumer/development workflow 범위다. viewer UI 모듈화와 함께 배포할 필요가 있는지 별도 release note 기준으로 판단한다.

완료된 worktree 분할 기록:

| 순서 | 변경 묶음 | 포함 후보 | 대표 검증 |
| --- | --- | --- | --- |
| 1 | Public authoring API | `packages/ferrum-web/src/scenePlacementAssets.ts`, `scenePlacementHandoff.ts`, `authoring.ts`, `public/workflowExports.ts`, 관련 test/docs/public API surface | `pnpm --filter @ferrum2d/ferrum-web test`, `pnpm validate:public-api-surface`, `pnpm validate:docs-links` |
| 2 | `@ferrum2d/authoring-viewer` package | `packages/ferrum-authoring-viewer/**`, root package/workspace metadata, authoring-viewer package check, npm package strategy | `pnpm package:check:authoring-viewer`, `pnpm package:check:create-game` |
| 3 | create-game dependency/harness integration | `packages/create-game/bin/create-game.mjs`, template `package.json`, shared harness/report files, consumer smoke report validation updates | `pnpm smoke:create-game-template-reports`, `pnpm package:check:create-game`, `pnpm package:consumer-smoke -- --skip-build --skip-package-check` |
| 4 | Generated placement viewer UI module split | `packages/create-game/templates/_shared/src/ferrum-placement-viewer*`, `packages/create-game/README.md`, `scripts/package/check-create-game-package.mjs`, A7 status docs | `pnpm package:check:create-game`, full create-game consumer smoke matrix |
| 5 | Agent/skill workflow updates | `.agents`, `.codex`, `.claude`, `.gemini`, `packages/agents/**`, agent package check | `pnpm package:check:agents`, consumer agent install smoke |
| 6 | Repo instruction and roadmap sync | `AGENTS.md`, `GEMINI.md`, development quality docs, broader planning docs | `pnpm validate:docs-links` |

상태 업데이트(2026-06-18):

- 1번 Public authoring API 묶음은 placement asset provider/handoff value export, 대표 type export,
  public API reference, `publicApiTypes` smoke를 같은 변경 단위로 본다.
- 이 묶음의 acceptance는 `@ferrum2d/ferrum-web/authoring`과 root compatibility aggregate에서
  내부 `src/*` 경로 없이 asset provider/handoff 계약을 사용할 수 있고, public API surface 검증과
  ferrum-web test가 통과하는 것이다.
- 2번 `@ferrum2d/authoring-viewer` package 묶음은 helper-only package contract, root workspace
  metadata, package check script, npm package strategy, 공식/generated viewer public package import를
  같은 변경 단위로 본다.
- 이 묶음의 acceptance는 tarball이 `LICENSE`, `README.md`, `dist/**`만 포함하고 runtime/peer
  dependency와 CLI bin을 추가하지 않으며, `pnpm package:check:authoring-viewer`와
  `pnpm package:check:create-game`이 통과하는 것이다.
- 3번 create-game dependency/harness integration 묶음은 `--authoring-viewer-version` CLI 옵션,
  template `package.json` dependency 치환, generated project report의 `project.authoringViewer`,
  shared harness의 authoring ownership/evidence import, consumer smoke report validator를 같은 변경 단위로 본다.
- 이 묶음의 acceptance는 override 없는 기본 생성과 tarball/file dependency 생성 모두
  `@ferrum2d/authoring-viewer` dependency를 남기고 placeholder가 새지 않으며,
  `pnpm smoke:create-game-template-reports`, `pnpm package:check:create-game`,
  최소 1개 template의 `pnpm package:consumer-smoke -- --skip-build --skip-package-check`가 통과하는 것이다.
- 4번 Generated placement viewer UI module split 묶음은 shared placement viewer module 파일, module
  export contract, main viewer thin-module guard, package tarball allowlist, create-game README/A7 문서 상태를
  같은 변경 단위로 본다.
- 이 묶음의 acceptance는 package check가 generated viewer module-set drift, 각 module의 대표 export,
  public package import 경계, main viewer line budget을 검증하고, full `pnpm package:consumer-smoke` template
  matrix가 generated placement viewer smoke까지 통과하는 것이다.
- 5번 Agent/skill workflow updates 묶음은 development authoring agent/skill 경계와 consumer gameplay
  agent/skill/harness의 Behavior Binding handoff evidence 문구, package README, package check guard를 같은
  변경 단위로 본다.
- 이 묶음의 acceptance는 `pnpm package:check:agents`가 `updateBehaviorBinding`,
  `behaviorBindings[].recipeId`/`bindingPath`/`behaviorRecipePath`, placement-only save와
  `behaviorRecipes.entities` 분리 경계를 README, shared harness, consumer gameplay skill, Codex/Claude/Gemini
  gameplay agent prompt에서 검증하고, 최소 consumer smoke가 agents install과 generated placement viewer
  behavior binding smoke까지 통과하는 것이다.
- 6번 Repo instruction and roadmap sync 묶음은 `AGENTS.md`, `GEMINI.md`, smoke-check 문서, 이 planning
  status가 현재 authoring/package/agent workflow 경계를 같은 말로 설명하는지를 완료 기준으로 본다.
- 이 묶음의 acceptance는 repo instruction이 `packages/ferrum-authoring-viewer`, `apps/placement-viewer`,
  `authoring_agent`, Behavior Binding Inspector 허용 범위, Behavior Recipe Body Editor/FSM/action graph 금지 범위,
  create-game/agents template 검증 명령을 반영하고, `pnpm validate:docs-links`가 통과하는 것이다.

당시 적용 순서는 1 -> 2 -> 3 -> 4 -> 5 -> 6이었다. 4번은 2번과 3번이 준비된 뒤에 독립 검증 가능했고, 4번만 먼저 분리하면 generated viewer의 `@ferrum2d/authoring-viewer` import와 template dependency 주입이 빠져 consumer build가 깨지는 구조였다.

스테이징/리뷰 체크리스트(2026-06-18):

| 순서 | 리뷰 상태 | 커밋/PR 전 확인 |
| --- | --- | --- |
| 1 | Public authoring API는 public export, docs, type smoke, unit test를 한 묶음으로 리뷰한다. | `pnpm --filter @ferrum2d/ferrum-web test`, `pnpm validate:public-api-surface`, `pnpm validate:docs-links` |
| 2 | `@ferrum2d/authoring-viewer`는 helper-only package로 리뷰한다. runtime/peer dependency, CLI bin, source/test tarball 포함은 허용하지 않는다. | `pnpm package:check:authoring-viewer`, `pnpm package:check:create-game` |
| 3 | create-game dependency/harness integration은 `@ferrum2d/authoring-viewer` dependency 주입과 generated report evidence를 함께 리뷰한다. | `pnpm smoke:create-game-template-reports`, `pnpm package:check:create-game`, 최소 `pnpm package:consumer-smoke -- --skip-build --skip-package-check --templates minimal` |
| 4 | Generated placement viewer module split은 shared module 파일 set, 대표 export, public import 경계, main viewer thin-module budget을 함께 리뷰한다. | `pnpm package:check:create-game`, full `pnpm package:consumer-smoke -- --skip-build --skip-package-check` |
| 5 | Agent/skill workflow update는 development agent와 consumer template agent를 분리해 리뷰한다. consumer package에는 engine release/package/pages agent가 들어가면 안 된다. | `pnpm package:check:agents`, 최소 consumer agent install smoke |
| 6 | Repo instruction/roadmap sync는 코드 변경 없이 현재 경계와 검증 명령을 설명하는 문서-only 묶음으로 리뷰한다. | `pnpm validate:docs-links`, `git diff --check` |

로컬 산출물 주의:

- `packages/ferrum-authoring-viewer/node_modules/**`는 로컬 설치 산출물이며 staging 대상이 아니다.
- consumer smoke artifact는 재현/evidence 용도로 보존할 수 있지만, 커밋 대상은 아니다.
- `dist/**` 포함 여부는 package별 전략을 따른다. `@ferrum2d/authoring-viewer` tarball은 `LICENSE`, `README.md`, `dist/**`만 포함해야 하지만, repo commit에 build artifact를 포함할지는 release/package policy와 함께 별도 리뷰한다.

커밋 준비 확인(2026-06-18~2026-06-19):

- 1번 Public authoring API 묶음은 `pnpm --filter @ferrum2d/ferrum-web test`,
  `pnpm validate:public-api-surface`, `pnpm validate:docs-links`를 통과했다. 다음 커밋 준비 점검은
  2번 `@ferrum2d/authoring-viewer` package 묶음부터 진행한다.
- 2번 `@ferrum2d/authoring-viewer` package 묶음은 `pnpm package:check:authoring-viewer`,
  `pnpm package:check:create-game`을 통과했다. 최초 create-game check는 sandbox의 Wasm build 권한 문제로
  실패했고, 같은 명령을 승인 모드로 재실행해 통과했다. 다음 커밋 준비 점검은 3번 create-game
  dependency/harness integration 묶음부터 진행한다.
- 3번 create-game dependency/harness integration 묶음은 `pnpm smoke:create-game-template-reports`,
  `pnpm package:check:create-game`, 최소 `pnpm package:consumer-smoke -- --skip-build --skip-package-check --templates minimal --artifact-dir artifacts/consumer-smoke-create-game-integration`,
  `pnpm validate:consumer-smoke-report -- --report artifacts/consumer-smoke-create-game-integration/consumer-smoke-report.json --artifact-dir artifacts/consumer-smoke-create-game-integration`를 통과했다.
  package check와 consumer smoke는 Wasm build/install/browser smoke 경로 때문에 승인 모드로 실행했다. 다음 커밋
  준비 점검은 4번 Generated placement viewer UI module split 묶음부터 진행한다.
- 4번 Generated placement viewer UI module split 묶음은 shared module 파일 set, 대표 export/import 경계,
  main viewer thin-module budget을 확인했고 `node --check scripts/package/check-create-game-package.mjs`,
  `pnpm package:check:create-game`, full `pnpm package:consumer-smoke -- --skip-build --skip-package-check --artifact-dir artifacts/consumer-smoke-generated-viewer-module-split`,
  `pnpm validate:consumer-smoke-report -- --report artifacts/consumer-smoke-generated-viewer-module-split/consumer-smoke-report.json --artifact-dir artifacts/consumer-smoke-generated-viewer-module-split`를 통과했다.
  package check와 consumer smoke는 Wasm build/install/browser smoke 경로 때문에 승인 모드로 실행했다. 다음 커밋
  준비 점검은 5번 Agent/skill workflow updates 묶음부터 진행한다.
- 5번 Agent/skill workflow updates 묶음은 package README, shared consumer harness, consumer gameplay skill,
  Codex/Claude/Gemini gameplay agent prompt가 `updateBehaviorBinding`,
  `behaviorBindings[].recipeId`/`bindingPath`/`behaviorRecipePath`, placement-only save와
  `behaviorRecipes.entities` 분리 경계를 설명하는지 확인했고 `node --check scripts/package/check-agents-package.mjs`,
  `pnpm package:check:agents`, 최소 `pnpm package:consumer-smoke -- --skip-build --skip-package-check --templates minimal --artifact-dir artifacts/consumer-smoke-agent-workflow-updates`,
  `pnpm validate:consumer-smoke-report -- --report artifacts/consumer-smoke-agent-workflow-updates/consumer-smoke-report.json --artifact-dir artifacts/consumer-smoke-agent-workflow-updates`를 통과했다.
  package check는 consumer package에 engine release/package/pages agent가 섞이지 않는 guard를 검증했고,
  consumer smoke는 agents install과 generated placement viewer behavior binding smoke를 통과했다. consumer smoke는
  install/browser smoke 경로 때문에 승인 모드로 실행했다. 다음 커밋 준비 점검은 6번 Repo instruction and roadmap sync
  묶음부터 진행한다.
- 6번 Repo instruction and roadmap sync 묶음은 `AGENTS.md`, `GEMINI.md`,
  `docs/development/quality/smoke-check.md`, 이 planning 문서가 `packages/ferrum-authoring-viewer`,
  `apps/placement-viewer`, `authoring_agent`, Behavior Binding Inspector 허용 범위,
  Behavior Recipe Body Editor/FSM/action graph 금지 범위, create-game/agents template 검증 명령을
  같은 경계로 설명하는지 확인했고 repo instruction sync keyword check, `pnpm validate:docs-links`,
  `git diff --check`를 통과했다. 이로써 1~6번 worktree 분할 후보의 커밋 준비 점검은 모두 완료 상태다.

중기 후보:

- `packages/ferrum-authoring-viewer`: reusable DOM/control helper, generated viewer shell helper, generated viewer panel primitive helper는 시작 완료. create-game generated viewer는 ObjectDefinition/Project Assets/Selected detail 패널, Transform/actions 패널, stage/session controller, publish/output module, asset loading module, startup error module 분리까지 완료했고, 후속으로 독립 browser app package 확장 검토
- 실제 npm publish 전 package별 release checklist와 beta version pin 결정
- Tauri wrapper: `apps/placement-viewer-desktop`에서 window open, 기본 샘플/환경변수/직접 scene 문서 경로/project root 직접 경로/native file dialog/project folder 기반 scene-authoring JSON load, asset folder picker/inspect, Save action local write, `.ferrum-placement-handoff.json` 자동 sync/수동 저장, Inspector project/assets/source/handoff/save 상태 표시, `ferrum-asset://...` preview URL, Add Sprite local thumbnail preview, desktop project open 시 initial runtime texture registration, Add Sprite local draft preview/handoff 동기화, asset folder 변경 후 runtime texture reload, local image width/height 기반 Add Sprite visual/AABB 크기와 `pnpm smoke:placement-viewer-desktop-assets` 검증까지 완료. 다음은 packaging/GUI 수동 검증 판단이다.
- Electron wrapper: 빠른 prototype 후보지만 보안/패키징 surface가 커서 기본값은 아님

## Track B: 오브젝트 모델 고도화

Track B의 목표는 UI가 편집하는 데이터와 런타임이 spawn하는 데이터가 같은 개념을 공유하게 하는 것이다.

### B0. Object model 문서/API 명명 정리

산출물:

- `docs/engine/data-scene-authoring.md`에 ObjectDefinition/ObjectInstance 용어 추가
- `docs/engine/public-api.md`에 authoring object API 추가
- `packages/ferrum-web/src/authoring.ts`에서 타입 export 정리

정책:

- 기존 `SceneCompositionPrefabSpec` 이름은 호환 유지한다.
- 문서에서는 `Prefab/ObjectDefinition`을 같이 표기하고 점진적으로 object terminology를 도입한다.

### B1. Visual descriptor 분리

현재 `props.components.sprite` 중심 구조에 primitive visual을 추가한다.

현재 상태(2026-06-17):

- `props.components.visual`을 추가했고, legacy `components.sprite`는 `visual.kind === "sprite"` shorthand로 정규화한다.
- `visual`과 `sprite`를 동시에 쓰면 resolver가 diagnostic error를 낸다.
- `dataSceneObjectVisualBounds(...)`와 `DATA_SCENE_PRIMITIVE_TEXTURES`를 public authoring API로 노출했다.

후보 shape:

```ts
type ObjectVisualSpec =
  | { kind: "primitive"; shape: "rect" | "circle" | "point"; color?: string; width?: number; height?: number; radius?: number }
  | { kind: "sprite"; asset: string; frame?: string; width?: number; height?: number; origin?: { x: number; y: number } };
```

호환:

- 기존 `components.sprite`는 `visual.kind === "sprite"`의 shorthand로 유지한다.
- resolver는 둘을 동시에 쓰면 diagnostic을 낸다.

### B2. Collider descriptor 강화

visual과 collider를 독립시킨다.

v1:

- `none`
- `aabb`
- `circle`
- `capsule`
- `orientedBox`

v2:

- `polygon`
- `polyline`
- multi-shape compound collider

성능 원칙:

- editor validation은 TS에서 한다.
- runtime collision component 설치는 낮은 빈도 scene apply에서만 수행한다.
- frame loop에서 collider authoring JSON을 읽지 않는다.

### B3. Prefab/default/override 계약

Prefab은 default component set이고 instance는 제한된 override만 가진다.

허용 override:

- transform
- visual size/color/frame
- collider offset/size/enabled
- layer
- behavior binding reference

초기에는 arbitrary deep merge를 금지한다. arbitrary merge는 agent와 UI가 같은 field를 덮어쓸 가능성이 크고 validation이 어려워진다.

### B4. ID와 reference migration

`instance.id`는 사람과 agent의 공용 어휘다.

필수 정책:

- 신규 id 자동 생성: `{prefab}_{index}` 또는 `{kind}_{index}`
- rename 시 behavior binding reference migration preview 제공
- 저장 전 duplicate/missing/stale reference diagnostic
- `instance.id` 변경은 patch operation으로 기록

이 기능은 agent가 "`turret_left` 수정해" 같은 지시를 안정적으로 처리하기 위한 기반이다.

### B5. Runtime compiler

ObjectDefinition/ObjectInstance를 Rust `World` entity로 낮춘다.

경로:

```text
SceneAuthoringDocument
  -> resolveSceneAuthoringDocument(...)
  -> resolve object definitions / instances
  -> createDataSceneRuntimeTarget(...)
  -> spawnSceneInstance(instance)
  -> Rust EntityTemplate / World spawn
```

원칙:

- compile/apply는 scene load, save preview, agent apply 같은 낮은 빈도 경로다.
- Rust frame loop는 이미 설치된 component storage만 읽는다.
- TypeScript는 simulation state를 소유하지 않는다.

### B6. Agent workflow 고정

AI agent가 볼 수 있어야 하는 정보:

- selected instance id
- prefab/object definition id
- visual/collider summary
- current transform
- pending draft patch
- behavior binding summary
- validation diagnostics

agent가 수정해야 하는 정보:

- behavior recipe 본문
- prefab binding
- object definition 추가/수정 후보
- schema migration

UI가 직접 수정하지 않는 정보:

- FSM transition logic
- gameplay command sequence
- Rust runtime state
- physics solver internals

## 추천 개발 순서

### Phase 1: 현재 viewer를 official placement tool로 고정

목표:

- 이미 만든 선택/이동/저장 흐름을 공식 제품 기능으로 문서화하고 smoke로 고정한다.
- "examples에 있어서 임시"라는 혼선을 줄이기 위해 public API와 host 역할을 분명히 한다.

작업:

- `docs/engine/user-guide.md`와 `docs/engine/data-scene-authoring.md`에 official placement viewer 섹션 추가
- `docs/planning/object-placement-authoring-plan.md`에 현재 상태 반영
- `apps/placement-viewer` README 또는 docs entry 추가
- production save disabled gate 유지

검증:

- `pnpm smoke:placement-viewer`
- `pnpm validate:public-api-surface`
- `pnpm validate:docs-links`

### Phase 2: Add Primitive

목표:

- 이미지 없이 rect/circle/point를 추가하고 저장한다.

상태: 핵심 구현, browser smoke의 primitive add/component patch export 검증, opt-in host save/reload persistence smoke까지 완료했다.

작업:

- `ObjectVisualSpec` primitive descriptor 추가
- resolver diagnostic 추가
- viewer palette `Add Rect`, `Add Circle`, `Add Point`
- primitive preview/render fallback 추가
- save/reload smoke는 patch export/add/remove browser smoke, primitive add merge/reload unit test, opt-in host save/reload browser persistence smoke까지 완료했다.

검증:

- unit: primitive descriptor validation
- browser smoke: add rect -> save -> reload -> marker/instance 유지
- runtime smoke: primitive가 Data Scene에서 visible debug/sprite command로 렌더됨

### Phase 3: Add Sprite

목표:

- texture/atlas frame 기반 오브젝트를 UI에서 추가한다.

상태: descriptor, Add Sprite, inspector의 sprite size/color 편집, asset provider 기반 select/thumbnail UI, atlas frame picker, missing asset/frame diagnostic contract는 완료했다. Project manifest/texture registry 기반 provider 자동 생성, create-game host catalog 연결, create-game Project Assets 패널의 Add Sprite draft action도 완료했다.

작업:

- asset list provider public interface 완료
- sprite picker UI: provider select/thumbnail, atlas frame picker 완료
- `visual.sprite` descriptor와 기존 `components.sprite` 호환은 완료
- missing asset/frame diagnostic 완료
- sprite size/origin/layer inspector

검증:

- texture registry fixture
- browser smoke: add sprite -> save -> reload -> visible
- package check: consumer import가 package 내부 경로를 쓰지 않음

### Phase 4: Prefab/ObjectDefinition catalog

목표:

- 재사용 가능한 object definition을 catalog로 관리하고 instance가 참조한다.

상태: Add Prefab, ObjectDefinition catalog summary, limited placement override validation, 선택 instance 기반 ObjectDefinition 생성 action, create-game 공유 placement viewer의 ObjectDefinition 생성/참조 흐름까지 완료했다. 독립 ObjectDefinition 자유형 편집 화면은 후속 visual-editor급 범위로 분리한다.

작업:

- object definition list summary public API 완료
- prefab variant/reference validation 완료
- placement patch/add instance props는 UI-owned `props.components` 외 agent-owned props를 쓰지 못하도록 제한
- add prefab palette 완료
- selected instance -> ObjectDefinition 생성 action 완료
- `addObjectDefinition` placement patch merge/save 완료
- create-game 공유 placement viewer ObjectDefinition 생성/참조 UI와 consumer smoke 완료
- id auto-generation policy 완료
- rename migration preview 강화 완료

검증:

- unit: prefab inheritance/override, viewer catalog summary, placement override 제한
- browser smoke: add prefab instance, rename, save, reload
- agent handoff: renamed id에 behavior binding migration preview 생성

### Phase 5: Collider inspector

목표:

- visual과 독립된 collider shape를 보고 수정한다.

상태: v1 inspector 직접 편집, selected collider overlay, rect/circle direct resize handle, collider offset drag handle, capsule/orientedBox/convexPolygon inspector patch 편집은 완료했다. UI는 collider none/aabb/circle/capsule/orientedBox/convexPolygon, offset, enabled, trigger, collision layer를 selected instance의 `props.components` draft patch로 저장한다. Capsule/polygon 자유형 drag 편집은 visual-editor급 후속 범위다.

작업:

- collider overlay 완료
- collider shape selector: none/aabb/circle/capsule/orientedBox/convexPolygon 완료
- offset/size input: size/radius/offset 완료
- advanced collider fields: capsule endpoint/radius, orientedBox size/rotation, convexPolygon vertices JSON/rotation 완료
- direct resize handle: primitive rect/circle 완료
- collider offset drag handle 완료
- trigger/layer input 완료
- Rust spawn compile 연결 확인 완료

검증:

- unit: collider descriptor -> runtime args
- browser smoke: component inspector edit -> patch export
- browser smoke: collider overlay visible
- browser smoke: collider offset drag handle -> patch export
- browser smoke: capsule/orientedBox/convexPolygon inspector edit -> patch export
- physics/collision smoke 중 영향 범위 확인

### Phase 6: Agent co-authoring loop

목표:

- 사용자가 "이 객체를 이렇게 해줘"라고 말하면 agent가 handoff state와 scene-authoring JSON을 기준으로 안전하게 수정한다.

작업:

- handoff JSON schema/helper 문서화 완료
- selected object summary는 `ScenePlacementAgentHandoff.selected`와 `ScenePlacementViewerState.selected`로 제공
- agent patch preflight는 `previewScenePlacementBindingMigration(...)`, asset diagnostics, placement props 제한 validation으로 고정
- behavior attachment dry-run 검증은 `validate:gameplay-authoring:report`의 default placement handoff fixture와 `gameplayAuthoringDryRun.placementHandoff` summary로 연결 완료
- placement viewer handoff smoke는 selected instance, draft patch, ownership fields, asset diagnostics array 검증까지 완료
- conflict report: UI-owned field와 agent-owned field 동시 변경 감지 완료
- consumer agent/skill/harness는 placement handoff, ObjectDefinition catalog, `addObjectDefinition` patch, behavior recipe 소유권 분리 안내와 `ferrum:authoring-report`의 `behaviorBindings[].recipeId`/`bindingPath`/`behaviorRecipePath` evidence까지 완료
- Behavior Binding Inspector v1 완료: 기존 recipe id attach/detach와 binding diagnostics 경계까지만 허용하고, generated create-game placement viewer 동기화까지 완료했다. recipe 본문 편집은 visual-editor급 범위로 보류한다.

검증:

- `pnpm validate:gameplay-authoring:report`
- placement viewer handoff smoke
- behavior attachment replay
- `pnpm package:check:agents`
- binding attach/detach patch unit test, generated handoff report, `ferrum:authoring-report` behavior binding evidence smoke

## 성능 요구사항

초기 목표는 1000개 이상 object authoring scene에서도 editor가 구조적으로 망가지지 않는 것이다.

| 영역 | 요구사항 |
| --- | --- |
| picking | TS bounds cache 또는 bulk query를 사용한다. pointer move마다 entity별 Wasm call 금지. |
| overlay | 모든 object DOM 노드를 매 프레임 갱신하지 않는다. selected/hovered/draft 중심으로 제한한다. |
| save | full document pretty print는 user action에서만 수행한다. frame loop와 분리한다. |
| resolver | schema validation과 compile은 load/save/apply 경로에만 둔다. |
| runtime | spawn 결과는 Rust `World` component storage에 설치하고 frame loop는 JSON/object graph를 읽지 않는다. |
| smoke | `pnpm smoke:placement-viewer-mass-authoring`으로 1,024개 추가 object authoring scene의 instance/entity/render command 규모, draw call 상한, 단일 object 선택/patch latency, 단일 draft marker, handoff selected/draft summary를 검증한다. |

## 안전 요구사항

- 파일 저장은 기본 비활성이고 dev/host allowlist 또는 user-granted file handle에서만 허용한다.
- host save adapter는 workspace 밖 임의 경로를 쓰지 않는다.
- UI patch merge는 UI-owned field만 갱신한다.
- behavior recipe 본문은 UI가 저장 시 보존한다.
- Behavior Binding Inspector를 구현하더라도 UI는 기존 recipe id reference attach/detach까지만 수행하고, recipe 본문 생성/수정은 agent/spec 소유로 유지한다.
- rename/remove는 reference migration preview 또는 conflict diagnostic 없이는 저장하지 않는다.
- public API는 `@ferrum2d/ferrum-web/authoring`을 통하고 `src/*`, `dist/*`, generated `pkg/*` direct import를 금지한다.

## 완료 기준

Track A와 Track B를 묶은 product-ready 기준은 다음이다.

- 사용자가 viewer에서 primitive/sprite/prefab object를 추가할 수 있다.
- 사용자가 object를 선택/이동/좌표 수정/저장할 수 있다.
- 저장 후 reload해도 위치와 visual/collider가 유지된다.
- agent가 handoff state 또는 `instance.id`를 기준으로 behavior를 붙일 수 있다.
- 선택 object의 기존 behavior binding을 preview하고, 후속 Binding Inspector가 구현된 경우 기존 recipe id reference만 명시적으로 attach/detach할 수 있다.
- UI 저장은 behavior recipe 본문을 보존한다.
- Data Scene runtime이 같은 scene-authoring 문서를 spawn한다.
- browser smoke, unit validation, public API validation, docs link validation이 통과한다.

현재 v1 product-ready 범위는 위 기준을 충족했다. 이후 변경은 아래 후속 후보 또는 별도 승인 범위에서 새 acceptance를 정한다.

## 보류 항목

다음은 별도 승인 전 production 구현하지 않는다.

- full visual editor
- Behavior Recipe Body Editor
- FSM/action graph/timeline visual editor
- 노드 트리/계층 편집 UI
- polygon/path 전문 editor
- tile painting/editor
- animation timeline visual editor
- multiplayer/collaborative editor
- Electron/Tauri desktop app packaging
- runtime scripting/plugin editor

## 결정 기준과 남은 판단

| 결정 | 상태/추천 | 이유 |
| --- | --- | --- |
| 공식 viewer host 위치 | 완료: `apps/placement-viewer` + workspace-private `@ferrum2d/authoring-viewer`; 독립 package 확장은 후속 판단 | smoke/fixture와 제품 API를 분리하면서 공식/generated viewer가 공통 viewer 계약과 DOM control/shell/panel primitive helper를 공유한다. |
| primitive visual 구현 | 완료: v1 debug/sprite fallback; v2 material/shape command는 요구 발생 시 검토 | render command ABI 변경을 피하면서 빠르게 authoring 가능하다. |
| sprite asset picker | 완료: project asset provider/texture registry interface | 브라우저 파일 시스템 권한과 asset pipeline을 분리한다. |
| prefab 명명 | 완료: public 문서에 `ObjectDefinition/Prefab` 병기 | 기존 SceneComposition 호환을 유지하면서 엔진 용어를 정리한다. |
| desktop wrapper | 부분 완료: `apps/placement-viewer-desktop` Tauri spike 유지; package/GUI release는 승인 필요 | 웹 viewer를 유지하면서 로컬 파일 권한과 보안 surface를 desktop shell로 분리한다. |

## 후속 후보

v1 완료 항목은 위 상태와 완료 기록으로 관리한다. 실제로 남은 후보는 다음과 같다.

1. `packages/ferrum-authoring-viewer`를 workspace-private helper에서 독립 browser app package로 확장할지 제품 판단한다.
2. 실제 npm publish 전 package별 release checklist와 beta version pin을 결정한다.
3. Tauri packaged app과 실제 GUI 검증을 release 범위에 넣을지는 별도 승인한다.
4. Behavior Recipe Body Editor, FSM/action graph, node hierarchy 등 visual-editor급 기능은 별도 승인 전 보류한다.

완료 기록: local image width/height metadata는 2026-07-15에 preview asset provider, Add Sprite visual/AABB 기본 크기, handoff evidence, desktop asset smoke까지 연결했다.
