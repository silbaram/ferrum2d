# 오브젝트 Authoring 모델 · 공식 배치 툴 고도화 계획

이 문서는 Ferrum2D가 2D 게임 엔진으로서 "오브젝트를 만들고, 배치하고, 저장하고, AI agent가 기능을 붙이는" 흐름을 어떻게 제품 기능으로 가져갈지 정리한다. 기존 [오브젝트 배치 UI · 데이터 씬 authoring 보강 계획](object-placement-authoring-plan.md)의 후속 상세화이며, 운영 계약은 `docs/engine/**`, `docs/development/**`, public API 문서가 우선한다.

핵심 방향은 투트랙이다.

- **Track A: 공식 UI 배치 툴**: 사용자가 화면을 보면서 오브젝트를 선택, 이동, 추가, 저장한다.
- **Track B: 오브젝트 모델 고도화**: primitive, sprite, collider, behavior, prefab, instance를 engine authoring contract로 정리한다.

중요한 전제: Ferrum2D는 full visual editor 중심 엔진이 아니다. UI는 사람이 모든 로직을 클릭으로 만드는 제품이 아니라, AI agent-first 개발 흐름에서 위치/시각/충돌 같은 authoring 데이터를 안전하게 편집하고 검증하는 공식 도구다.

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
| `visual.sprite` | `props.components.sprite` | 기존 Data Scene components resolver를 확장한다. |
| `visual.primitive` | 신규 `props.components.visual` 또는 `primitive` descriptor | sprite가 없는 rect/circle/point 표시를 추가한다. |
| `collider` | `props.components.collider` | visual과 분리하고 inspector 편집 대상으로 승격한다. |
| `behaviorBindings` | `props.behaviorRecipes`, `behaviorRecipes.entities` | UI는 binding preview만 제공하고 본문 편집은 agent 소유로 둔다. |
| 런타임 spawn | `createDataSceneRuntimeTarget(...)` | 낮은 빈도 scene apply 경로에서만 compile/spawn한다. |

## Track A: 공식 UI 배치 툴

Track A의 목표는 사용자가 실제 게임 화면을 보면서 오브젝트를 추가/선택/이동/저장하고, AI agent가 같은 `instance.id`를 기준으로 기능을 붙일 수 있게 하는 것이다.

### A0. 공식 제품 경계 확정

현재 `examples/placement-viewer`는 검증 host 역할을 한다. 공식화는 "예제에 코드가 있으니 임시"가 아니라 다음 경계로 정리한다.

| 영역 | 권장 위치 | 설명 |
| --- | --- | --- |
| public controller/API | `packages/ferrum-web/src/scenePlacementViewer.ts`, `authoring.ts` export | 제품 기능의 source of truth다. |
| UI host | 현 단계는 `examples/placement-viewer`, 후속 승인 시 `packages/ferrum-authoring-viewer` 후보 | 실행 가능한 browser app이다. |
| create-game 통합 | `packages/create-game` template | consumer project에서 `npm run ferrum:placement-viewer`로 실행한다. |
| smoke fixture | `tests/smoke/browser-render-smoke.mjs` | 공식 동작을 회귀 검증한다. |

새 workspace package 도입은 구조 변경이므로 이 문서를 근거로 별도 승인 후 진행한다. 단기적으로는 product API를 `packages/ferrum-web`에 두고, `examples/placement-viewer`는 공식 host/fixture로 유지한다.

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

v1 범위:

- visual primitive: `rect`, `circle`, `point`
- collider primitive: `none`, `aabb`, `circle`
- 색상/tint는 debug/editor visual로 허용하되 runtime material 정책과 분리한다.
- resize handle은 rect/circle부터 지원한다.

보류:

- polygon vertex editor
- bezier/path editor
- terrain paint

이 보류 항목은 Tiled식 advanced map editor 영역에 가깝다.

### A4. Sprite asset picker

이미지를 오브젝트 visual로 연결한다.

v1 범위:

- 현재 project manifest 또는 texture registry에 있는 asset 목록 표시
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

섹션:

- `Transform`: x, y, rotation, scale, layer, snap
- `Visual`: primitive/sprite, asset/frame, size, color/tint
- `Collider`: enabled, shape, offset, size, trigger/layer
- `Behavior`: 붙은 recipe id 목록, agent handoff command, binding migration preview
- `Identity`: instance id, prefab id, variant, role

Behavior 본문 편집은 UI v1 범위가 아니다. UI는 "이 객체에 behavior를 붙여줘"라고 agent에게 넘길 수 있는 상태와 id를 안정적으로 제공한다.

### A6. 저장과 handoff

저장 계층은 세 단계로 유지한다.

| 단계 | 설명 | 기본 상태 |
| --- | --- | --- |
| patch export | JSON patch를 export하고 agent가 workspace 파일에 적용한다. | 항상 가능 |
| host save adapter | dev server/create-game host가 allowlist 파일만 저장한다. | dev opt-in |
| File System Access API | 사용자가 브라우저에서 직접 파일 권한을 준 경우 저장한다. | enhancement |

handoff 파일은 저장 기능의 대체물이 아니라 agent가 현재 선택/draft 상태를 읽는 보조 데이터다.

### A7. 공식 packaging 판단

단기 권장:

- `packages/ferrum-web`에 official viewer controller/API 유지
- `examples/placement-viewer`는 official host + smoke fixture로 유지
- create-game template에 consumer host 제공

중기 후보:

- `packages/ferrum-authoring-viewer`: 독립 browser app package
- Tauri wrapper: 파일 저장/프로젝트 선택/desktop 배포 요구가 명확해진 뒤 spike
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
- `examples/placement-viewer` README 또는 docs entry 추가
- production save disabled gate 유지

검증:

- `pnpm smoke:placement-viewer`
- `pnpm validate:public-api-surface`
- `pnpm validate:docs-links`

### Phase 2: Add Primitive

목표:

- 이미지 없이 rect/circle/point를 추가하고 저장한다.

작업:

- `ObjectVisualSpec` primitive descriptor 추가
- resolver diagnostic 추가
- viewer palette `Add Rect`, `Add Circle`, `Add Point`
- primitive preview/render fallback 추가
- save/reload smoke

검증:

- unit: primitive descriptor validation
- browser smoke: add rect -> save -> reload -> marker/instance 유지
- runtime smoke: primitive가 Data Scene에서 visible debug/sprite command로 렌더됨

### Phase 3: Add Sprite

목표:

- texture/atlas frame 기반 오브젝트를 UI에서 추가한다.

작업:

- asset list provider public interface
- sprite picker UI
- `visual.sprite` descriptor와 기존 `components.sprite` 호환
- missing asset diagnostic
- sprite size/origin/layer inspector

검증:

- texture registry fixture
- browser smoke: add sprite -> save -> reload -> visible
- package check: consumer import가 package 내부 경로를 쓰지 않음

### Phase 4: Prefab/ObjectDefinition catalog

목표:

- 재사용 가능한 object definition을 catalog로 관리하고 instance가 참조한다.

작업:

- object definition list inspector
- prefab variant/override validation
- add prefab palette
- id auto-generation policy
- rename migration preview 강화

검증:

- unit: prefab inheritance/override
- browser smoke: add prefab instance, rename, save, reload
- agent dry-run: renamed id에 behavior binding migration preview 생성

### Phase 5: Collider inspector

목표:

- visual과 독립된 collider shape를 보고 수정한다.

작업:

- collider overlay
- collider shape selector
- offset/size input
- trigger/layer input
- Rust spawn compile 연결 확인

검증:

- unit: collider descriptor -> runtime args
- browser smoke: collider overlay nonblank
- physics/collision smoke 중 영향 범위 확인

### Phase 6: Agent co-authoring loop

목표:

- 사용자가 "이 객체를 이렇게 해줘"라고 말하면 agent가 handoff state와 scene-authoring JSON을 기준으로 안전하게 수정한다.

작업:

- handoff JSON schema 문서화
- selected object summary command 추가
- agent patch preflight
- behavior attachment smoke
- conflict report: UI-owned field와 agent-owned field 동시 변경 감지

검증:

- `pnpm validate:gameplay-authoring:report`
- placement viewer handoff smoke
- behavior attachment replay

## 성능 요구사항

초기 목표는 1000개 이상 object authoring scene에서도 editor가 구조적으로 망가지지 않는 것이다.

| 영역 | 요구사항 |
| --- | --- |
| picking | TS bounds cache 또는 bulk query를 사용한다. pointer move마다 entity별 Wasm call 금지. |
| overlay | 모든 object DOM 노드를 매 프레임 갱신하지 않는다. selected/hovered/draft 중심으로 제한한다. |
| save | full document pretty print는 user action에서만 수행한다. frame loop와 분리한다. |
| resolver | schema validation과 compile은 load/save/apply 경로에만 둔다. |
| runtime | spawn 결과는 Rust `World` component storage에 설치하고 frame loop는 JSON/object graph를 읽지 않는다. |
| smoke | mass object authoring smoke를 Phase 4 이후 추가한다. |

## 안전 요구사항

- 파일 저장은 기본 비활성이고 dev/host allowlist 또는 user-granted file handle에서만 허용한다.
- host save adapter는 workspace 밖 임의 경로를 쓰지 않는다.
- UI patch merge는 UI-owned field만 갱신한다.
- behavior recipe 본문은 UI가 저장 시 보존한다.
- rename/remove는 reference migration preview 또는 conflict diagnostic 없이는 저장하지 않는다.
- public API는 `@ferrum2d/ferrum-web/authoring`을 통하고 `src/*`, `dist/*`, generated `pkg/*` direct import를 금지한다.

## 완료 기준

Track A와 Track B를 묶은 product-ready 기준은 다음이다.

- 사용자가 viewer에서 primitive/sprite/prefab object를 추가할 수 있다.
- 사용자가 object를 선택/이동/좌표 수정/저장할 수 있다.
- 저장 후 reload해도 위치와 visual/collider가 유지된다.
- agent가 handoff state 또는 `instance.id`를 기준으로 behavior를 붙일 수 있다.
- UI 저장은 behavior recipe 본문을 보존한다.
- Data Scene runtime이 같은 scene-authoring 문서를 spawn한다.
- browser smoke, unit validation, public API validation, docs link validation이 통과한다.

## 보류 항목

다음은 별도 승인 전 production 구현하지 않는다.

- full visual editor
- 노드 트리/계층 편집 UI
- polygon/path 전문 editor
- tile painting/editor
- animation timeline visual editor
- multiplayer/collaborative editor
- Electron/Tauri desktop app packaging
- runtime scripting/plugin editor

## 오픈 결정

| 결정 | 추천 | 이유 |
| --- | --- | --- |
| 공식 viewer host 위치 | 단기 `examples/placement-viewer`, 중기 별도 package 후보 | 지금은 smoke/fixture와 제품 API를 분리하는 것이 비용이 낮다. |
| primitive visual 구현 | v1은 debug/sprite fallback, v2는 material/shape command 검토 | render command ABI 변경을 피하면서 빠르게 authoring 가능하다. |
| sprite asset picker | project manifest/texture registry provider interface | 브라우저 파일 시스템 권한과 asset pipeline을 분리한다. |
| prefab 명명 | public 문서에는 `ObjectDefinition/Prefab` 병기 | 기존 SceneComposition 호환을 유지하면서 엔진 용어를 정리한다. |
| desktop wrapper | Tauri 우선 spike, Electron은 빠른 prototype 후보 | 파일 권한과 보안 surface를 분리하기 위해 web-first가 안전하다. |

## 다음 실행 항목

1. Phase 1 문서 정리: current placement viewer를 official authoring surface로 명시한다.
2. Phase 2 설계 착수: `ObjectVisualSpec` primitive descriptor와 validation test를 먼저 추가한다.
3. Add Object palette UI를 `Add Rect`부터 구현한다.
4. save/reload browser smoke를 primitive 추가까지 확장한다.
5. Phase 3 전 asset provider interface를 확정한다.
