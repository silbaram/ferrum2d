# Data Scene Authoring Contract

상태: P2 최소 계약

이 문서는 Top-down Shooter, Breakout, Platformer 같은 built-in starter scene을 복사하지 않고도 작은 data-driven scene을 설명하기 위한 최소 authoring 계약을 정리한다. 확정 source of truth는 `packages/ferrum-web/src/sceneAuthoringDocument.ts`, `packages/ferrum-web/src/sceneComposition.ts`, `packages/ferrum-web/src/dataSceneComponents.ts`, `packages/ferrum-web/src/behaviorRecipes.ts`와 샘플 fixture다.

## 최소 문서 형식

Data Scene authoring 문서는 다음 envelope를 사용한다.

| 필드 | 필수 | 역할 |
| --- | --- | --- |
| `format` | 예 | `ferrum2d.consumer.scene-authoring` |
| `version` | 예 | 현재 `1` |
| `sceneComposition` | 예 | prefab, fragment, instance 배치를 정의한다. |
| `behaviorRecipes` | 예 | instance에 바인딩할 gameplay behavior profile을 정의한다. |
| `ids` | 아니오 | action/item/timer 같은 이름을 runtime numeric id로 고정할 때 사용한다. |

최소 scene은 `sceneComposition.prefabs`, `sceneComposition.fragments`, `behaviorRecipes.entities`만으로 검증 가능해야 한다. starter scene adapter가 쓰는 `runtimeEntity`, `builtinShooterPlayer`, `builtinBreakoutPaddle` 같은 binding은 create-game 템플릿용 확장이지 최소 Data Scene 계약이 아니다.

## 최소 동작 계약

- `sceneComposition.initialFragment`는 생성할 root fragment를 가리킨다.
- 각 instance는 `prefab`을 참조하고, `id`가 없으면 resolver가 deterministic id를 만든다.
- prefab/variant/instance `props.behaviorRecipes`는 `behaviorRecipes.entities`의 key를 참조한다.
- spawn 가능한 Data Scene fixture는 prefab/variant/instance merge 후 `props.components`를 가져야 하며, `resolveDataSceneComponentsSpec(...)`가 통과해야 한다.
- `resolveSceneAuthoringDocument(..., { validateBindings: true, validateComponents: true, missingBehavior: "error" })`가 통과해야 한다.
- `instantiateSceneFragment(...)` 결과는 최소 1개 instance를 가져야 한다.
- 문서 안에 장르 전용 Game Spec 필드나 built-in starter runtime entity binding을 섞지 않는다.

## Authoring Role

Data Scene은 `Actor`/`GameObject` 같은 별도 runtime class나 저장 필드를 추가하지 않는다.
authoring 도구가 구분이 필요할 때는 `classifySceneInstance(instance)`로 role을 파생한다.

- `worldObject`: `props.behaviorRecipes` 바인딩이 없는 배치 객체다. `props.components`가 있으면
  `createDataSceneRuntimeTarget(...)`으로 `World` entity는 spawn되지만 gameplay behavior command는
  생성되지 않는다.
- `actor`: `props.behaviorRecipes` 바인딩이 하나 이상 있는 객체다. spawn 뒤 해당 behavior recipe가
  `applySceneBehaviorRecipes(...)`를 통해 gameplay component command로 적용된다.

이 구분은 UI/agent 설명용 authoring helper이며 Rust `World`의 별도 저장소나 상속 구조가 아니다.

## `props.components` v1

`props.components`는 `SceneCompositionProps` 안의 reserved key다. `SceneCompositionProps` 자체는 계속 JSON-compatible object지만, Data Scene runtime spawn 대상은 아래 contract를 따른다.

| 필드 | 필수 | 역할 |
| --- | --- | --- |
| `sprite.texture` | 예 | texture asset id string 또는 resolved numeric texture id |
| `sprite.width` / `sprite.height` | 예 | sprite render size |
| `sprite.frame` | 아니오 | normalized `u0`/`v0`/`u1`/`v1`, 기본값은 full frame |
| `sprite.animation` | 아니오 | horizontal animation용 `frameCount`/`fps` |
| `collider` | 예 | `"none"` 또는 `aabb`/`circle`/`capsule`/`orientedBox`/`convexPolygon` descriptor |
| `layer` | 예 | `player`, `enemy`, `bullet`, `wall`, `pickup` 또는 layer code `0..4` |
| `template` | 아니오 | catalog template reference. 있으면 `sprite`/`collider`/`layer`와 함께 쓰지 않는다. |

`components.template`은 catalog reference mode이고, `components.sprite`/`collider`/`layer`는 inline descriptor mode다. 두 mode를 섞으면 resolver가 diagnostic error를 낸다.
기본 `createDataSceneRuntimeTarget(...)` v1은 inline descriptor mode만 spawn한다. `components.template`은 catalog workflow용으로 resolver가 보존하지만, runtime spawn 검증(`resolveSceneAuthoringDocument(..., { validateComponents: true })` 기본값 포함)에서는 `allowComponentTemplates: true`를 명시하지 않는 한 거절된다.

`SceneComposition`의 instance `x`/`y`/`scale`은 default Data Scene runtime target이 반영한다. instance `rotationRadians`와 `layer`는 아직 render command/World transform 계약에 연결되지 않았으므로 `createDataSceneRuntimeTarget(...)`에서는 `0`만 허용한다. 회전된 충돌체가 필요하면 instance transform이 아니라 `components.collider.rotationRadians`를 사용한다. `components.layer`는 collision layer이며 render/sort layer가 아니다.

## Runtime Spawn Hook

Rust/Wasm에는 낮은 빈도 scene load/apply 전용 raw hook인 `Engine::spawn_data_scene_entity(...)`가 있다. 이 hook은 Data Scene mode에서만 inline sprite, optional horizontal animation, collider shape, layer를 `World` entity로 설치하고, 성공 후 `data_scene_entity_id()`/`data_scene_entity_generation()`으로 최신 handle을 노출한다.

package-facing default `spawnSceneInstance` target은 `createDataSceneRuntimeTarget(engine, options?)`가 제공한다. 기본값은 첫 번째 유효한 spawn 직전에 한 번 `engine.useDataScene()`을 호출한다. authoring validation 실패나 target 생성만으로 기존 scene을 비우지 않으며, 이 자동 활성화가 싫으면 `activateDataScene: false`를 넘긴다. consumer 코드는 generated Wasm `pkg/*`나 `@ferrum2d/ferrum-web/src/*` 내부 경로를 직접 import하지 않는다.

## 샘플

검증 샘플은 `docs/engine/samples/data-scene-minimum.scene-authoring.json`이다. 이 샘플은 두 개의 generic `agent` instance와 `health`, `faction`, `seekTarget` behavior recipe만 사용한다.

```bash
pnpm validate:data-scene-authoring
```

이 명령은 ferrum-web public package를 빌드한 뒤 샘플을 resolver로 검증한다. 검증 범위는 envelope, fragment/behavior binding, `props.components` schema, starter scene 전용 runtime binding 금지를 포함한다. 샘플은 ferrum-web test suite에서도 `createEngine(...)`, `createDataSceneRuntimeTarget(...)`, `applySceneBehaviorRecipes(...)`를 통해 실제 Data Scene entity spawn smoke로 검증한다.

## create-game 연결

`packages/create-game/templates/*/public/scene-authoring.json`은 같은 `ferrum2d.consumer.scene-authoring` envelope를 사용한다. 템플릿 파일은 built-in starter scene과 연결하기 위해 `runtimeEntity` 같은 adapter prop을 사용할 수 있지만, 이는 template surface contract이며 최소 Data Scene contract와 분리해서 다룬다.
