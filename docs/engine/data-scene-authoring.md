# Data Scene Authoring Contract

상태: P2 최소 계약

이 문서는 Top-down Shooter, Breakout, Platformer 같은 built-in starter scene을 복사하지 않고도
작은 data-driven scene을 설명하기 위한 최소 authoring 계약을 정리한다. 확정 source of truth는
`packages/ferrum-web/src/sceneAuthoringDocument.ts`, `packages/ferrum-web/src/dataSceneVariables.ts`,
`packages/ferrum-web/src/sceneComposition.ts`, `packages/ferrum-web/src/dataSceneComponents.ts`,
`packages/ferrum-web/src/behaviorRecipes.ts`와 샘플 fixture다.

## 최소 문서 형식

Data Scene authoring 문서는 다음 envelope를 사용한다.

| 필드 | 필수 | 역할 |
| --- | --- | --- |
| `format` | 예 | `ferrum2d.consumer.scene-authoring` |
| `version` | 예 | 현재 `1` |
| `sceneComposition` | 예 | prefab, fragment, instance 배치를 정의한다. |
| `behaviorRecipes` | 예 | instance에 바인딩할 gameplay behavior profile을 정의한다. |
| `ids` | 아니오 | action/item/timer 같은 이름을 runtime numeric id로 고정할 때 사용한다. |
| `variables` | 아니오 | 선언된 정수·실수·불리언 값을 `global` 또는 `scene` 생존 스코프로 정의한다. |

최소 scene은 `sceneComposition.prefabs`, `sceneComposition.fragments`, `behaviorRecipes.entities`만으로 검증 가능해야 한다. starter scene adapter가 쓰는 `runtimeEntity`, `builtinShooterPlayer`, `builtinBreakoutPaddle` 같은 binding은 create-game 템플릿용 확장이지 최소 Data Scene 계약이 아니다.

## Object Definition And Instance

Ferrum2D authoring 문서에서 `sceneComposition.prefabs`는 재사용 가능한
`ObjectDefinition` catalog 역할을 한다. 기존 타입명 `SceneCompositionPrefabSpec`은 호환을 위해 유지하지만,
문서와 placement tool에서는 `Prefab/ObjectDefinition`을 병기한다.

`sceneComposition.fragments[].instances[]`의 각 항목은 `ObjectInstance`다. instance는 안정적인
`instance.id`, 참조할 `prefab`, transform, optional `variant`, 제한된 `props.components` override를 가진다.
공식 placement viewer가 저장하는 patch는 UI-owned transform, add/remove/rename, `props.components`
전체 교체만 수행한다. behavior recipe 본문, FSM command, gameplay sequence는 agent-owned 영역으로 남기고,
rename/remove 시에는 binding migration preview 또는 conflict diagnostic을 먼저 노출한다.

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
  `applyDataSceneAuthoringDocument(...)` 또는 `createDataSceneRuntimeTarget(...)`으로 `World` entity는
  spawn되지만 gameplay behavior command는 생성되지 않는다.
- `actor`: `props.behaviorRecipes` 바인딩이 하나 이상 있는 객체다. spawn 뒤 해당 behavior recipe가
  `applySceneBehaviorRecipes(...)`를 통해 gameplay component command로 적용된다.

이 구분은 UI/agent 설명용 authoring helper이며 Rust `World`의 별도 저장소나 상속 구조가 아니다.

## Variables v1

`variables`는 optional 선언 배열이다. 배열이 없는 기존 v1 문서는 이전과 동일하게 통과한다.
각 이름은 문서 전체에서 한 번만 선언할 수 있으며 runtime에서 선언되지 않은 이름을 생성하거나
읽고 쓰는 것은 허용하지 않는다.

```json
{
  "variables": [
    { "name": "campaign.coins", "scope": "global", "type": "integer", "default": 0 },
    { "name": "player.speed", "scope": "global", "type": "real", "default": 1.25 },
    { "name": "wave.complete", "scope": "scene", "type": "bool", "default": false }
  ]
}
```

| 필드 | 값 | 계약 |
| --- | --- | --- |
| `name` | 비어 있지 않고 앞뒤 공백이 없는 문자열 | `global`/`scene`을 합쳐 유일해야 한다. |
| `scope` | `global` 또는 `scene` | scene apply/reapply 경계에서의 생존 여부를 정한다. |
| `type` | `integer`, `real`, `bool` | `integer`는 JavaScript safe integer, `real`은 finite number만 허용한다. |
| `default` | 선언 타입과 일치하는 값 | 최초 apply와 reset 값이다. `NaN`/무한대는 허용하지 않는다. |

`resolveSceneAuthoringDocument(...)`는 선언 배열, 필드, 기본값 타입, 중복 이름을 검증한다.
`applyDataSceneAuthoringDocument(...)` 결과의 `variables`와
`createFerrumRuntime(...).dataScene.variables`는 `has(name)`, `get(name)`, `set(name, value)`,
`values(scope)`, `restore(scope, values)`를 제공한다. `get`/`set`/`restore`는 선언되지 않은 이름과
타입이 맞지 않는 값을 diagnostic error로 거절하며 runtime 임의 변수 생성 API는 제공하지 않는다.

생존 계약은 다음과 같다.

- 최초 문서 apply에서는 모든 변수가 `default`로 시작한다.
- `runtime.dataScene.reapply(...)`와 같은 다음 문서 apply에서 이름·타입이 같은 `global` 변수는 현재 값을 유지한다.
- 모든 `scene` 변수는 다음 문서의 `default`로 초기화한다.
- global 선언이 제거되거나 scope/type이 달라지면 이전 값은 유지하지 않고, 다음 선언이 있다면 그 `default`를 사용한다.
- 다음 문서에서도 값을 읽으려면 그 문서에 같은 이름을 다시 선언해야 한다. 현재 문서에 없는 이름은 존재하지 않는다.

이 규칙은 Issue #38의 scene/level 전환 생존 축과 공유하는 Y0 계약이다. 현재 범위에서
behavior recipe/FSM이 값을 읽거나 쓰지는 않는다. 게임 코드는 낮은 빈도
`DataSceneVariableStore` API로 값을 변경하며, gameplay simulation에서의 변수 접근은 별도 계약이다.

## `props.components` v1

`props.components`는 `SceneCompositionProps` 안의 reserved key다. `SceneCompositionProps` 자체는 계속 JSON-compatible object지만, Data Scene runtime spawn 대상은 아래 contract를 따른다.

| 필드 | 필수 | 역할 |
| --- | --- | --- |
| `visual` | `visual` 또는 `sprite` 중 하나 | `primitive` 또는 `sprite` object visual descriptor. 신규 authoring 도구는 이 필드를 우선 사용한다. |
| `sprite` | `visual` 또는 `sprite` 중 하나 | legacy sprite shorthand. `visual`이 없을 때 `visual.kind: "sprite"`로 정규화된다. |
| `collider` | 예 | `"none"` 또는 `aabb`/`circle`/`capsule`/`orientedBox`/`convexPolygon` descriptor |
| `layer` | 예 | `player`, `enemy`, `bullet`, `wall`, `pickup` 또는 layer code `0..4` |
| `template` | 아니오 | catalog template reference. 있으면 `visual`/`sprite`/`collider`/`layer`와 함께 쓰지 않는다. |

`components.visual.kind: "primitive"`는 placement tool과 agent가 이미지 asset 없이 배치할 수 있는 editor/runtime debug visual이다. v1 shape는 `rect`, `circle`, `point`이며 `width`/`height`, `radius`, `color`를 가진다. Runtime target은 primitive 의미를 resolved visual에 보존하면서 현재 WebGL2 render path에는 `DATA_SCENE_PRIMITIVE_TEXTURES.rect|circle|point` fallback sprite로 컴파일한다. 공식 host는 이 texture id들을 로드해야 한다.

`components.visual.kind: "sprite"`는 `texture` 또는 `asset` texture reference, `width`/`height`, optional `frame`, `animation`, `originX`/`originY`, `layer`, `sortOrder`, `tint`/`color`를 가진다. `components.sprite`는 기존 문서 호환용 shorthand이고 `visual`과 동시에 쓰면 resolver가 diagnostic error를 낸다.

`components.template`은 catalog reference mode이고, `components.visual` 또는 legacy `components.sprite`/`collider`/`layer`는 inline descriptor mode다. 두 mode를 섞으면 resolver가 diagnostic error를 낸다.
`createDataSceneRuntimeTarget(engine, { componentTemplates })`는 catalog template id를 inline component spec으로 해소해 spawn할 수 있다. catalog entry는 `visual` 또는 legacy `sprite`, `collider`, `layer`를 가진 inline descriptor여야 하며, nested `components.template` reference는 runtime target에서 거절된다. `componentTemplates`를 제공하지 않으면 runtime spawn 검증(`resolveSceneAuthoringDocument(..., { validateComponents: true })` 기본값 포함)에서는 `allowComponentTemplates: true`를 명시하지 않는 한 template mode를 거절한다.

`props.components`는 prefab/variant/instance merge와 placement `updateComponents` patch에서 하나의 component set으로 취급한다. 일반 `props` 값은 기존처럼 JSON object merge를 사용할 수 있지만, `components` 내부만 부분 deep merge하지 않고 전체 교체한다. 이 정책은 legacy `components.sprite`와 신규 `components.visual`이 동시에 남거나 collider/layer 일부만 stale 값으로 유지되는 authoring 충돌을 막기 위한 것이다. 공식 placement viewer의 Visual/Collider/Layer inspector도 이 계약에 맞춰 selected instance의 `props.components` 전체를 낮은 빈도 draft patch로 교체하고, runtime entity를 직접 수정하지 않는다.

`SceneComposition`의 instance `x`/`y`/`scale`/`rotationRadians`/`layer`는 default Data Scene runtime target이 반영한다. instance `rotationRadians`는 visible sprite rotation으로 `SpriteRenderCommand`에 기록되고 collider runtime geometry에도 합성된다. 예를 들어 rotated AABB는 oriented-box collider로 컴파일되고, collider offset/capsule endpoint는 instance rotation을 반영해 회전된다. instance `layer`는 Data Scene entity render band 안에서 `1000 + layer` sort key로 저장되어 같은 Data Scene entity끼리 render 순서를 정한다. `components.layer`는 collision layer이며 render/sort layer가 아니다.

## Runtime Spawn Hook

Rust/Wasm에는 낮은 빈도 scene load/apply 전용 raw hook인 `Engine::spawn_data_scene_entity(...)`가 있다. 이 hook은 Data Scene mode에서만 inline sprite, optional horizontal animation, collider shape, layer를 `World` entity로 설치하고, 성공 후 `data_scene_entity_id()`/`data_scene_entity_generation()`으로 최신 handle을 노출한다.

package-facing full document apply helper는 `applyDataSceneAuthoringDocument(engine, document, options?)`다.
이 helper는 `resolveSceneAuthoringDocument(...)`를 `validateBindings: true`,
`validateComponents: true` 기본값으로 실행하고, 검증이 끝난 문서를 `createDataSceneRuntimeTarget(...)`과
`applySceneBehaviorRecipes(...)`로 연결한다. 문서의 `ids`는 behavior command id 해석에 사용하며,
`options.ids`가 있으면 caller override를 우선한다. `componentTemplates`를 넘기면
`allowComponentTemplates`도 기본 활성화된다. 검증 실패는 runtime activation 전에 발생하므로 기존
built-in/data scene state를 reset하지 않는다.

package-facing default `spawnSceneInstance` target은 `createDataSceneRuntimeTarget(engine, options?)`가 제공한다. 기본값은 첫 번째 유효한 spawn 직전에 한 번 `engine.useDataScene()`을 호출한다. authoring validation 실패나 target 생성만으로 기존 scene을 비우지 않으며, 이 자동 활성화가 싫으면 `activateDataScene: false`를 넘긴다. consumer 코드는 generated Wasm `pkg/*`나 `@ferrum2d/ferrum-web/src/*` 내부 경로를 직접 import하지 않는다.

`createFerrumRuntime({ dataScene })`은 같은 document apply helper를 startup 단계에 연결한다.
`dataScene` 값은 문서 자체이거나 `{ document, ...applyOptions }` object일 수 있다.
runtime은 적용 결과를 `runtime.dataScene.result`로 노출하고, 같은 handle의 `reapply(document?, options?)`로
낮은 빈도 scene reload를 수행할 수 있다. `reapply`도 새 Rust ABI를 열지 않고
`applyDataSceneAuthoringDocument(...)`와 같은 validation/spawn/binding 경로를 사용한다. resolver 단계에서
실패하면 현재 document/result/variable store를 교체하지 않으며, 이후 인자 없는 `reapply()`는 마지막으로
성공한 문서를 다시 사용한다.

## Snapshot/Restore

`GameStateSnapshot.dataScene`은 optional `authoringDocument` JSON payload를 가질 수 있다.
`captureGameStateSnapshot(engine, { includeDataSceneState: true, dataSceneAuthoringDocument })`는
이 문서를 clone해서 snapshot hash 범위에 포함한다.

`restoreGameStateSnapshot(...)`은 `DataSceneStateSnapshot.authoringDocument`가 있으면 기본적으로
`applyDataSceneAuthoringDocument(...)`를 실행해 Data Scene entity와 behavior binding을 다시 조립한 뒤
`applyDataSceneCustomState` callback을 호출한다. `restoreDataSceneAuthoringDocument: false`를 넘기면
문서를 재적용하지 않고 빈 Data Scene mode만 활성화한다. 이 필드는 optional이므로 기존 snapshot은
그대로 유효하며, runtime 전체 `World` binary snapshot을 새로 추가하는 계약은 아니다.
이 capture/restore 경로는 `pnpm smoke:gameplay-replay -- --scenario data-scene-authoring-snapshot-restore`의
committed golden fixture로도 검증한다.

선언 변수가 있는 Data Scene을 apply한 엔진에서
`captureGameStateSnapshot(..., { includeDataSceneState: true })`를 호출하면 두 scope를 다음 custom slot에
넣는다. Data Scene state를 opt-in하지 않은 일반/built-in snapshot에는 이전 Data Scene 변수 저장소를
자동으로 주입하지 않는다.

- `global`: `snapshot.custom["ferrum2d.variables"]`
- `scene`: `snapshot.dataScene.custom["ferrum2d.variables"]`

두 custom 슬롯은 기존 snapshot hash 범위이므로 snapshot version을 올리거나 별도 hash 경로를 만들지 않는다.
같은 문서와 같은 최종 변수 값은 변수 설정 순서와 무관하게 같은 snapshot hash를 만든다.
기존 custom state와 함께 캡처할 때는 custom state가 object여야 하며
`"ferrum2d.variables"`는 consumer가 직접 쓰지 않는 reserved key이며 public
`DATA_SCENE_VARIABLES_SNAPSHOT_KEY` 상수로도 노출한다. 변수가 없는 기존 문서는 custom payload와 hash
형태가 바뀌지 않는다.

restore는 authoring document와 변수 payload의 선언·타입 정합성을 runtime activation/spawn 전에
검사하고, 문서를 재적용해 선언 저장소를 구성한 뒤 global/scene 값을 복원한다. snapshot에 선언되지
않은 이름, 누락된 선언 값, 타입이 맞지 않는 값이 있으면 복원을 거절한다. reserved 변수 payload는
엔진이 소비하며 `applyCustomState`/`applyDataSceneCustomState` callback에는 나머지 consumer custom
payload만 전달한다.
`GameStateSnapshotRestoreResult`는 `dataSceneVariables`, `globalVariablesApplied`,
`sceneVariablesApplied`로 적용 결과를 보고한다.

`restoreDataSceneState: false`이면 `scene` 변수 복원은 건너뛰지만, 별도 global slot의 `global` 변수는
복원한다. authoring document를 적용하지 않는 snapshot이나 `restoreDataSceneAuthoringDocument: false`
상태에서 변수 payload를 복원하려면 엔진에 같은 이름·scope·type의 호환 가능한 선언 저장소가 이미
연결되어 있어야 한다.

## Instance Handle Registry

배치 UI, 선택 상태, agent 타겟팅처럼 authoring id로 runtime entity를 다시 찾아야 하는 경로는
`createSceneInstanceHandleRegistry(...)`를 사용한다. registry는 `applySceneBehaviorRecipes(...)`의
`instanceHandleRegistry` option으로 전달하면 scene apply 결과를 `instance.id` 기준으로 동기화한다.

- `get(id)` / `require(id)`는 `instance.id`에서 `GameplayEntityHandle`을 찾는다.
- `instanceIdForHandle(handle)`은 generational handle에서 authoring id를 역조회한다.
- `sync(instances, handles)`는 scene reload/reapply 뒤 사라진 id를 제거하고 새 handle로 교체한다.
- `entityExists` callback을 제공하면 stale handle은 `validateLive: true` 조회 또는 sync 시 제거된다.

이 registry는 TypeScript authoring layer의 낮은 빈도 cache다. Rust `World`에 `Actor`/`GameObject`
저장소를 추가하지 않고, frame loop에서 entity별 JS/Wasm 왕복 호출을 하지 않는다. UI가 저장하는
문서는 명시적 `instance.id`를 부여해야 하며, apply 경로에서는 `requireExplicitInstanceIds: true`로
resolver fallback id(`fragment.index`) 의존을 거절할 수 있다.

## 샘플

검증 샘플은 `docs/engine/samples/data-scene-minimum.scene-authoring.json`이다. 이 샘플은 global/scene 변수 선언, 두 개의 generic `agent` instance와 `health`, `faction`, `seekTarget` behavior recipe만 사용한다.

```bash
pnpm validate:data-scene-authoring
```

이 명령은 ferrum-web public package를 빌드한 뒤 샘플을 resolver로 검증한다. 검증 범위는 envelope, fragment/behavior binding, `props.components` schema, starter scene 전용 runtime binding 금지를 포함한다. 샘플은 ferrum-web test suite에서도 `createEngine(...)`과 `applyDataSceneAuthoringDocument(...)`를 통해 실제 Data Scene entity spawn smoke로 검증한다.

## create-game 연결

`packages/create-game/templates/*/public/scene-authoring.json`은 같은 `ferrum2d.consumer.scene-authoring` envelope를 사용한다. 템플릿 파일은 built-in starter scene과 연결하기 위해 `runtimeEntity` 같은 adapter prop을 사용할 수 있지만, 이는 template surface contract이며 최소 Data Scene contract와 분리해서 다룬다.
