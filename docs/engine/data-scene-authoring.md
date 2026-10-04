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
- instance가 있는 문서는 `instantiateSceneFragment(...)` 결과를 deterministic spawn list로 사용한다.
- instance가 0개인 initial fragment도 유효하다. full document apply에서는 빈 scene 전환으로 취급해 기존 runtime state를 정리한다.
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

`resolveSceneAuthoringDocument(...)`는 선언 배열, 필드, 기본값 타입, 중복 이름을 검증하고 선언 순서대로 `1..64` runtime slot을 만든다. `ids.variables`를 명시하면 모든 선언 이름에 고유한 `1..64` slot을 제공해야 한다.
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

이 규칙은 Issue #38의 scene/level 전환 생존 축과 공유하는 Y0 계약이다. 현재 runtime 값은 TypeScript `Map`이 아니라 Rust `World`의 고정 64-slot slab에 저장된다. `DataSceneVariableStore`는 낮은 빈도 facade로 같은 Rust slot을 읽고 쓰며, custom `FerrumEngine`을 주입하는 host는 `attachDataSceneVariableRuntimeEngineAdapter(...)`로 `clear/configure/get/set` adapter를 연결해야 한다. 변수 선언이 없는 기존 custom runtime은 adapter 없이도 호환된다.

Behavior Recipe의 `setVariable`/`incrementVariable`은 gameplay event에 반응해 Rust frame 안에서 값을 바꾼다. recipe 소유 entity가 event의 `actor` 또는 `source`와 generation까지 일치하면 trigger가 발화하므로 damage source의 명중 횟수, damage actor의 피격 횟수, collector 또는 pickup에 붙인 수집 상태를 모두 표현할 수 있다. actor와 source가 같은 event는 한 번만 적용한다. collision reaction, `interaction`, `timerTrigger`의 `guard`와 FSM의 `variableComparison` transition도 같은 numeric slot을 사용한다. 비교식은 한 개의 literal 또는 다른 변수만 RHS로 받을 수 있으며 논리식/산술식 nesting은 거절된다. Scene Authoring resolver는 변수 이름/slot 존재 여부, bool increment, literal 타입, bool ordering 비교를 runtime activation 전에 검사한다.

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

`SceneComposition`의 instance `x`/`y`/`scale`/`rotationRadians`/`layer`는 default Data Scene runtime target이 반영한다. instance `rotationRadians`는 visible sprite rotation으로 `SpriteRenderCommand`에 기록되고 collider runtime geometry에도 합성된다. 예를 들어 rotated AABB는 oriented-box collider로 컴파일되고, collider offset/capsule endpoint는 instance rotation을 반영해 회전된다. render layer는 `visual.layer ?? instance.layer`를 사용하고 Data Scene entity render band 안에서 `1000 + layer` sort key로 저장되어 같은 Data Scene entity끼리 render 순서를 정한다. `components.layer`는 collision layer이며 render/sort layer가 아니다.

## Runtime Spawn Hook

Rust/Wasm에는 낮은 빈도 scene load/apply 전용 raw hook인 `Engine::spawn_data_scene_entity(...)`가 있다. 이 hook은 Data Scene mode에서만 inline sprite, optional horizontal animation, collider shape, layer를 `World` entity로 설치하고, 성공 후 `data_scene_entity_id()`/`data_scene_entity_generation()`으로 최신 handle을 노출한다.

package-facing full document apply helper는 `applyDataSceneAuthoringDocument(engine, document, options?)`다.
이 helper는 `resolveSceneAuthoringDocument(...)`를 `validateBindings: true`,
`validateComponents: true` 기본값으로 실행하고, 검증이 끝난 문서를 `createDataSceneRuntimeTarget(...)`과
`applySceneBehaviorRecipes(...)`로 연결한다. 문서의 `ids`는 behavior command id 해석에 사용하며,
`options.ids`가 있으면 caller override를 우선한다. `componentTemplates`를 넘기면
`allowComponentTemplates`도 기본 활성화된다. 검증 실패는 runtime activation 전에 발생하므로 기존
built-in/data scene state를 reset하지 않는다.

package-facing default `spawnSceneInstance` target은 `createDataSceneRuntimeTarget(engine, options?)`가 제공한다. 기본값은 첫 번째 유효한 spawn 직전에 한 번 `engine.useDataScene()`을 호출한다. full `applyDataSceneAuthoringDocument(...)`는 spawn 결과가 0개여도 validation 성공 뒤 `useDataScene()`을 호출하므로 빈 문서도 실제 cleanup/reset 전환이다. full apply는 Rust variable slot을 guarded recipe보다 먼저 구성하며, 이후 spawn/recipe apply가 실패하면 이전 변수 declaration/slot/current value를 복원한다. authoring validation 실패나 target 생성만으로 기존 scene을 비우지 않으며, 이 자동 활성화가 싫으면 `activateDataScene: false`를 넘긴다. consumer 코드는 generated Wasm `pkg/*`나 `@ferrum2d/ferrum-web/src/*` 내부 경로를 직접 import하지 않는다.

`createFerrumRuntime({ dataScene })`은 같은 document apply helper를 startup 단계에 연결한다.
`dataScene` 값은 문서 자체이거나 `{ document, ...applyOptions }` object일 수 있다.
runtime은 적용 결과를 `runtime.dataScene.result`로 노출한다. 같은 handle의 필수 문서 인자
`transition(document, options?)`는 A→B scene/level 전환을, `reapply(document?, options?)`는 현재 문서의
낮은 빈도 reload를 표현한다. `transition(...)`은 startup option이 `activateDataScene: false`였더라도
activation/reset을 강제하며 per-call option에서는 `activateDataScene`을 받지 않는다. `reapply(...)`는
기존 low-level opt-out 호환을 위해 이 option을 유지한다. 두 method 모두
`applyDataSceneAuthoringDocument(...)`와 같은 validation/spawn/binding 경로를 사용한다. resolver 단계에서
실패하면 현재 document/result/variable store를 교체하지 않으며, 이후 인자 없는 `reapply()`는 마지막으로
성공한 문서를 다시 사용한다.

## Scene/Level Flow v1

Data Scene lifecycle은 Rust가 소유하는 고정 상태 집합이다. 임의 문자열 상태나 runtime scene graph를
추가하지 않으며 public `GAME_STATE_CODE`와 `gameStateName(...)`으로 숫자 ABI를 해석한다.

| 상태 | 코드 | 진행 계약 |
| --- | ---: | --- |
| `playing` | `1` | normal simulation을 진행한다. |
| `paused` | `3` | render는 유지하고 tween, rigid physics, gameplay timer/FSM, particle simulation을 진행하지 않는다. |
| `levelComplete` | `4` | 완료 화면/다음 문서 선택을 위해 `paused`와 같은 simulation freeze를 유지한다. |

`runtime.dataScene.state()`, `pause()`, `resume()`, `complete()`가 상위 API이며 저수준
`FerrumEngine`은 `dataSceneState()`, `pauseDataScene()`, `resumeDataScene()`,
`completeDataScene()`을 제공한다. `pause`는 `playing → paused`, `resume`은 `paused → playing`,
`complete`는 `playing|paused → levelComplete`에서만 `true`를 반환한다. Data Scene이 아니거나 허용되지
않은 전이는 `false`이고 상태를 바꾸지 않는다. `transition(...)`, 기본 `reapply(...)`, `useDataScene()` 성공은
새 Data Scene을 `playing`으로 시작한다. `reapply(..., { activateDataScene: false })`는 caller가 이미 준비한
Data Scene에 문서를 적용하는 low-level 호환 경로이므로 전환/reset 계약으로 취급하지 않는다.

문서 A에서 B로 전환할 때의 생존 계약은 다음과 같다.

| 상태 | A→B 결과 |
| --- | --- |
| 같은 이름·타입의 `global` 변수 | 현재 값을 유지한다. B에도 같은 선언이 있어야 한다. |
| `scene` 변수 | B 선언의 `default`로 초기화한다. |
| World entity/component, tilemap, particle, tween | 제거하고 B에서 다시 구성한다. |
| physics contact/history, fixed-step accumulator와 input latch | 제거한다. 첫 B frame은 A의 접촉/input edge를 상속하지 않는다. |
| collision/gameplay/effect/render/audio event buffer | 제거한다. A의 frame event를 B에서 소비하지 않는다. |
| pending spawn/deferred despawn queue | 제거한다. A에서 예약된 구조 변경을 B에 적용하지 않는다. |
| lifecycle state | `playing`으로 초기화한다. |

이 전환은 낮은 빈도 document apply 경계다. additive scene load, runtime scene graph, visual FSM/action graph,
내장 3-slot save UI는 이 계약 범위가 아니다.

## Snapshot/Restore

`GameStateSnapshot.dataScene`은 optional `authoringDocument` JSON payload를 가질 수 있다.
`captureGameStateSnapshot(engine, { includeDataSceneState: true, dataSceneAuthoringDocument })`는
실제 Data Scene mode에서만 허용되며 이 문서를 clone해서 snapshot hash 범위에 포함한다. built-in scene에서
Data Scene payload capture를 요청하면 자체 복원 불가능한 snapshot을 만들지 않고 즉시 거절한다.

`0.1.0-beta.7`의 `GameStateSnapshot` version은 `2`, 신규 `DataSceneStateSnapshot` version은 `3`다.
기존 Data Scene v2도 읽는다. lifecycle state가
snapshot/replay hash 범위에 들어가므로 같은 scene이라도 `playing`, `paused`, `levelComplete` snapshot은
서로 다른 hash를 가진다. version `1` snapshot은 자동 추론하지 않고 validation에서 거절한다. 저장 데이터를
유지해야 하는 consumer는 원래 authoring document와 custom/variable payload로 새 snapshot을 다시
캡처하거나 명시적 migration을 수행해야 한다.

`restoreGameStateSnapshot(...)`은 `DataSceneStateSnapshot.authoringDocument`가 있으면 기본적으로
`applyDataSceneAuthoringDocument(...)`를 실행해 Data Scene entity와 behavior binding을 다시 조립한 뒤
global/scene 변수와 `playing|paused|levelComplete` lifecycle을 복원하고
`applyDataSceneCustomState` callback을 호출한다. 따라서 callback은 최종 lifecycle state를 관찰한다.
restore의 `dataSceneAuthoringApplyOptions.activateDataScene: false`는 기존 World 위에 snapshot entity를
겹칠 수 있으므로 mutation 전에 거절한다.
`restoreDataSceneAuthoringDocument: false`를 넘기면
문서를 재적용하지 않고 빈 Data Scene mode만 활성화한다. 이 필드는 optional이므로 기존 snapshot은
문서 payload 없이도 동작하며, runtime 전체 `World` binary snapshot을 새로 추가하는 계약은 아니다.
이 capture/restore 경로는 `pnpm smoke:gameplay-replay -- --scenario data-scene-authoring-snapshot-restore`의
committed golden fixture로도 검증한다.

선언 변수가 있는 Data Scene을 apply한 엔진에서
`captureGameStateSnapshot(..., { includeDataSceneState: true })`를 호출하면 두 scope를 다음 custom slot에
넣는다. Data Scene state를 opt-in하지 않은 일반/built-in snapshot에는 이전 Data Scene 변수 저장소를
자동으로 주입하지 않는다.

- `global`: `snapshot.custom["ferrum2d.variables"]`
- `scene`: `snapshot.dataScene.custom["ferrum2d.variables"]`

두 custom 슬롯은 기존 Data Scene snapshot hash 범위다. Built-in Shooter snapshot version `19`는 같은 Rust slab을 header에 exact bit로 포함하므로 gameplay replay hash에도 직접 반영된다.
Scene/Level Flow v1은 Data Scene snapshot v2부터 지원한다. 현재 소스는 progress용 v3를 생성하며,
같은 문서와 같은 최종 변수 값은 변수 설정 순서와 무관하게 같은 snapshot hash를 만든다.
기존 custom state와 함께 캡처할 때는 custom state가 object여야 하며
`"ferrum2d.variables"`는 consumer가 직접 쓰지 않는 reserved key이며 public
`DATA_SCENE_VARIABLES_SNAPSHOT_KEY` 상수로도 노출한다. 변수가 없는 문서는 custom payload shape에
변수 slot을 추가하지 않는다. v3로 새로 캡처하면 version 필드 변경으로 전체 snapshot hash는 갱신된다.

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

## Native runtime 연결 (#62~#65)

`visual`의 origin/tint/layer/sortOrder는 실제 Rust render command에 반영된다. `visual.layer`가 instance.layer보다 우선하며, `visual.depthSort: "hd2d"`는 같은 layer 안에서만 floor/elevation/발 위치 정렬을 활성화한다. Data Scene에서는 heightSpan 추가만으로 전역 정렬 모드가 바뀌지 않는다.

optional `components.body: { type: "static" | "kinematic", heightSpan? }`는 sprite와 같은 entity에 물리 바디를 설치한다. 생략한 기존 collider-only 객체는 그대로다. [계약·공개 API recipe·검증](data-scene-native-runtime.md)을 참고한다. 이 연결은 `0.1.0-beta.2`부터 제공한다.


## Data Scene 탐험 gameplay와 navigation (beta.7부터)

이 절은 `0.1.0-beta.7`부터 제공하는 계약이다. beta.6 이하 tarball에는 아래 API가 없다. 설치된 타입에
`configureDataSceneGameplay` / `configureDataSceneNavigation`이 있는지 먼저 확인한다.

문서에 optional `gameplay`와 `navigation`을 선언한다. 기존 필드만 있는 배치 문서는 그대로 적용된다.
`interaction`, `pickup`, `collisionPickup`을 실행하려면 `gameplay`를 명시해야 하며, 누락하면
씬 활성화 전에 경로가 있는 diagnostic으로 거절한다. 기존에 이 recipe가 성공으로 저장되지만 실행되지
않던 Data Scene은 이 진단을 받을 수 있으므로 아래 설정을 추가한다.

```json
{
  "gameplay": { "primaryActor": "player", "interactionInputActionId": 91 },
  "navigation": {
    "columns": 5, "rows": 5, "cellWidth": 24, "cellHeight": 24,
    "originX": 0, "originY": 0,
    "costs": [1,1,1,1,1, 1,1,1,1,1, 1,1,0,1,1, 1,1,1,1,1, 1,1,1,1,1]
  }
}
```

위 조각을 `format/version/sceneComposition/behaviorRecipes`가 있는 문서에 병합한다.
`primaryActor`는 적용할 fragment의 instance ID다. `player` collision layer만으로 주인공을 추론하지
않으며, apply/reapply마다 새 generation handle에 연결한다. pickup만 쓰면 `gameplay: {}`도 가능하다.

- `interactionInputActionId` 생략: 반경 안의 모든 유효한 interaction이 자동 발생한다. `once: true`이면
  해당 entity 생존 기간 중 한 번만 발생하고, false이면 출력 frame마다 최대 한 번이다.
- 지정: `engine.setInputActionBinding(91, 0, { control: "space", activation: "pressed" })`처럼
  **엔진 input action**을 별도로 등록한다. 활성 입력에서 가장 가까운 interaction 한 곳을 선택한다.
  같은 거리면 entity 순서로 결정한다. `InputManager`의 문자열 action 이름과 자동 연결되는 것은 아니다.
  E 키를 쓰려면 `InputManager`의 `keyBindings.space: ["KeyE"]`처럼 control에 매핑할 수 있다.
- recipe의 `action`/`actionId`는 이벤트 식별자이고 입력 gate ID와 독립적이다.
  pause/complete에서 실행을 멈추며, 잘못된/stale actor handle은 기존 설정을 바꾸지 않고 거절한다.
  fixed step 사이의 짧은 누름은 다음 step에 한 번 전달하며 연속한 step의 별도 누름도 유지한다.
  gameplay 재설정과 pause/resume은 이전에 대기하던 입력을 버린다. 계속 누르는 `down` 바인딩은
  재개 이후에도 활성 상태이며, 한 번씩 조사하려면 `pressed`를 사용한다.
- `collisionPickup`은 실제 collider overlap/filter/heightSpan 검사 뒤 동작한다. collider-only와 native
  body 모두 사용 가능하며 `includeCollisionEvents` 옵션에 의존하지 않는다. `target: "other"`이면 상대
  entity의 `pickup`을 수집한다. `target: "self"`이면 recipe 소유 pickup을 상대가 수집한다.
- Data Scene pickup은 양수 uint32 item ID와 count, `despawn: true`를 지원한다. 수집 이벤트의
  actorId/actorGeneration=collector, sourceId/sourceGeneration=pickup, tokenId=item ID, payloadBits=count를 전달하고 entity를 한 번 제거한다. 모든 ID는 Data Scene에서
  게임이 정의하는 아이템이며 자동 점수 증가는 없다. 기존 Shooter는 점수 ID 1 전용 계약을 유지한다.
  `despawn: false`는 반복 지급 방지 상태를 제공하지 않으므로 거절한다.
- `gameplay`를 명시한 문서는 interaction/pickup/timer와 변수 이벤트 처리 및 metadata 저장만 지원한다.
  health/damage/faction/tags/lifetime/scoreReward는 기존 component 저장 계약을 따른다. chase/seekTarget/
  accelerate, projectile/dash/melee/spawn action 및 pickup 이외 collision reaction은 executor가 없으므로
  적용 전에 거절한다. 이 모드의 변수 이벤트 조건은 interaction/timer/pickupCollected로 한정한다.
  timer는 이벤트 발생만 지원하므로 action 실행 설정은 거절한다. metadata 저장도 기존 adapter의
  제약(health의 start=max, damage cooldown=0 등)을 적용 전에 검사한다. 변수 이벤트 trigger는
  entity별 고유 event/token/variable/operation 조합 최대 16개이며 같은 조합 재설정은 한 칸을 사용한다.
  apply 옵션으로 variable ID를 바꾸더라도 실제 선언 타입·참조를 다시 검사한다.
  `gameplay` 없는 기존 authoring primitive 문서의 component 저장 성공을 실행 지원으로 해석하지 않는다.

navigation은 렌더링·물리 collider와 별도인 **단일 XY 평면 격자**다. 최대 4096칸, 양수 float32 셀 크기,
행 우선 `costs` 배열을 사용한다. 비용 0은 통행 불가, 1..65535는 통행 비용이다. 맵 이미지나 body에서
자동으로 장애물을 생성하지 않으며 게임이 이동 가능한 영역과 캐릭터 여유 폭을 반영해 격자를 작성한다.
`queryTilemapNavigationPath/Waypoint`를 그대로 사용하고 `setDataSceneNavigationCost(column,row,cost)`로
문/장애물 비용을 바꾼다. 동일 값 또는 범위 밖 수정은 false다. 높이 span을 전달해도 동일 XY 격자의
장애물과 비용을 사용한다. 서로 다른 시작/도착 heightSpan을 연결하는 경사로·층간 portal은 지원하지 않는다.
경로 조회는 waypoint 반환까지다. 아래 목적지 이동 API로 주인공의 경로 추종을 실행할 수 있다.
NaN/Infinity가 들어간 좌표 조회는 경로·waypoint를 반환하지 않는다.

`useDataScene`, reset, transition은 navigation과 gameplay binding을 초기화한다. 문서 reapply는 새
격자와 주인공을 다시 설치한다. invalid grid/actor/지원하지 않는 opted-in recipe는 기존 씬을 지우기 전에
거절한다. `activateDataScene: false`는 기존 씬을 유지하는 저수준 apply로, 생략한 gameplay/navigation은
기존 설정을 유지한다. Shooter tile 설정 API는 Data Scene에서 씬을 전환하지 않고 false 또는 void no-op로
거절한다. 실제 Shooter 전환은 `setGameSpec` 등 명시적인 씬 구성 경로를 사용한다.

### 목적지 이동 (beta.7부터)

`gameplay.primaryActor`와 `navigation`을 적용한 뒤 월드 좌표를 지정한다.
주인공은 활성 native `kinematic` body와 활성 non-trigger AABB 하나를 가져야 한다.

```ts
import type { DataSceneMoveOptions } from "@ferrum2d/ferrum-web/core";

const destination: DataSceneMoveOptions = {
  x: 108, y: 60, speed: 120, arrivalRadius: 0.5, cancelOnInput: true,
};
const accepted = engine.moveDataSceneActorTo(destination);
// "idle" | "moving" | "arrived" | "blocked" | "cancelled"
const status = engine.dataSceneMoveStatus();
// 사용자 취소 버튼 등에서 호출한다. 이동 중일 때만 true다.
engine.cancelDataSceneMove();
```

클릭 이동은 `DataSceneView.pointerToWorld({ x: event.clientX, y: event.clientY })`의 결과를
목적지로 전달한다. 카메라·줌·지면 투영을 반영하므로 화면 좌표를 직접 목적지로 쓰지 않는다.

- `speed`는 simulation 초당 월드 거리이며 양수 float32다. `x/y`와 `arrivalRadius`도 유한 float32이고
  반경은 0 이상이다. 반경 기본값은 0.5이며 마지막 구간에만 적용한다. 0이면 float32 목적지까지 이동한다.
  `solidMaskBits`는 uint32이며 기본값은 모든 layer다. 0이면 물리 solid 검사를 제외하지만 grid는 유지한다.
- 성공한 명령은 이전 경로를 교체하고 주인공 velocity를 0으로 만든다. 잘못된 JS 옵션은 throw,
  씬/주인공 조건 불충족·격자 밖·경로 없음·완료된 씬은 false이며 기존 경로를 보존한다.
  `dataSceneMoveStatus()`는 Data Scene 밖에서 undefined다. 이미 도착한 곳도 명령 직후 moving이며 다음 step에 판정한다.
- Rust가 셀 중심을 순서대로 지나 마지막 목적지로 이동한다. 큰 delta에서도 구간을 건너뛰지 않으며,
  작은 셀의 중간 코너도 정확히 거친다. 매우 느린 이동의 미소 거리는 다음 step으로 누적한다.
  큰 원점/작은 셀 조합에서 float32 셀 중심이 다른 칸으로 반올림되는 경로는 이동 요청을 false로 거절한다.
  기존 경로는 보존하며 이동 중 재탐색이 이런 경로를 만나면 blocked다. 월드 원점이나 셀 크기를 조정해야 한다.
  비용은 경로 선택에만 사용하며 속도 배율이 아니다.
- 실제 이동은 기존 AABB sweep으로 primary AABB solid를 검사한다. collision filter·heightSpan을 따르고
  trigger를 차단물로 취급하지 않는다. 원/다각형·compound의 추가 collider를 장애물로 추출하거나
  회피하지 않는다. 격자에 캐릭터 폭과 장애물 여유를 반영해야 한다. 물리 solid에 막히면 blocked로 정지한다.
- grid 교체/비용 수정/clear 또는 외부 위치 변경은 다음 simulation step에 경로를 다시 계산한다.
  경로가 없어지면 blocked다. 이미 blocked인 이동은 자동 재시도하지 않으므로 목적지를 다시 지정한다.
- pause는 경로를 보존하고 resume 후 이어간다. complete, gameplay 재설정, actor 제거/세대 변경은
  이동을 취소한다. reset/문서 전체 reapply는 idle로 초기화한다.
  기본 `cancelOnInput: true`는 W/A/S/D control 중 하나가 활성화되면 취소하며, 같은 입력 sample에서
  게임이 설정한 수동 velocity를 보존한다. false일 때 이동 중 velocity는 엔진이 0으로 유지한다.
- 한 씬의 primary actor 한 명만 지원한다. 애니메이션/방향 전환은 아래 opt-in 설정으로 연결한다.
  pickup/interaction은 각 simulation step 끝의 실제 overlap/거리로 처리하며 지나친 trigger의 연속 감지는 제공하지 않는다.
  진행 snapshot에는 경로·이동 상태·현재 위치를 저장하지 않는다. 문서를 포함한 복원은 authored 위치와 idle로 시작한다.

### 이동·애니메이션 자동 연결 (beta.7부터)

`gameplay.primaryActor`와 캐릭터의 `visual.animationSet`을 적용한 뒤 아래 설정으로 연결한다.
`configureDataSceneSpriteAnimation`으로 먼저 설치한 clip도 사용할 수 있다. clip ID는 게임이 정하며,
아래 숫자는 예시다. 각 상태에 네 방향을 모두 지정해야 하지만 같은 clip을 여러 방향에 재사용할 수 있다.

```ts
import type { DataSceneMovementAnimationSpec } from "@ferrum2d/ferrum-web/core";

const movementAnimation: DataSceneMovementAnimationSpec = {
  idle: {
    up: { clip: 0 }, down: { clip: 1 },
    left: { clip: 2, flipX: true }, right: { clip: 2 },
  },
  walk: {
    up: { clip: 4 }, down: { clip: 5 },
    left: { clip: 7, flipX: true }, right: { clip: 7 },
  },
  initialDirection: "down",
};
const bound = engine.configureDataSceneMovementAnimation(movementAnimation);
// 해제는 현재 clip/시간/flip을 보존한다.
engine.configureDataSceneMovementAnimation(false);
```

- 주인공에 sprite와 기존 clip playback이 필요하다. 잘못된 JS 필드/clip ID 범위는 throw한다.
  Data Scene 밖, 주인공/playback 없음, 등록하지 않은 clip 참조는 false이며 기존 설정을 보존한다.
  `clip`은 0..65535 정수, `flipX/flipY`는 optional boolean이다. 초기 방향은 down, flip 기본값은 false다.
- 활성화 즉시 초기 방향의 idle을 선택하고 playback pause를 해제한다. 씬의 paused/complete 상태는 바꾸지 않는다.
  Rust가 다음 simulation step부터 경로 이동은 walk, 도착·막힘은 idle로 선택한다.
  도착 step에 여러 코너를 지나도 마지막 실제 이동 구간의 방향을 유지한다.
- 경로 추종 중이 아니면 해당 step의 실제 위치 변화를 기준으로 walk/idle을 고른다. 따라서 게임이
  설정한 수동 velocity도 연결된다. step 사이의 teleport와 step 시작 전 tween 변경은 이동으로 세지 않는다.
  별도 키 입력이나 수동 이동 controller를 만드는 API는 아니다.
- 월드 +Y는 down이며, 대각선은 큰 축을 선택하고 양축 크기가 같으면 좌우를 선택한다.
  같은 clip의 방향/flip만 바뀌면 경과 시간을 유지한다. 다른 clip으로 바뀌면 첫 프레임부터 시작해
  다음 simulation step부터 시간을 진행한다. playback 시간을 한 step에 두 번 증가시키지 않는다.
- pause와 delta 0에서는 자동 전환/시간 진행이 멈춘다. 명시적 이동 취소와 complete는 즉시 idle로
  전환한다. W/A/S/D가 경로를 취소한 step에 수동 velocity가 실제로 움직이면 walk로 이어진다.
- 주인공에 성공한 `updateDataSceneSpriteAnimations` 명령을 보내거나 clip을 재설정하면 자동 연결을
  해제한다. 실패한 batch, 빈 batch, 필드 없는 명령, 다른 entity 명령은 연결을 유지한다.
  공격·대화 등의 수동 연출이 끝나면 위 설정을 다시 호출해 자동 연결을 켠다.
- `false`는 Data Scene에서 이미 해제되어도 true다. gameplay 재설정은 기존 주인공을 idle로 바꾼 뒤
  연결을 해제한다. reset/전체 reapply/씬 전환도 연결을 초기화한다. 대상은 primary actor 한 명이다.
- 이 설정과 runtime clip/시간/flip은 진행 snapshot에 저장하지 않는다. 문서의 `visual.animationSet`은
  복원되므로 restore 후 위 설정을 다시 호출한다. runtime에서만 설치한 clip은 먼저 재설치한다.

### 진행 저장·복원 (beta.7부터)

기본 Data Scene snapshot은 문서 재적용 + variables/custom 복원이다. 탐험 진행 상태도 저장하려면
`includeDataSceneProgress: true`를 명시한다. 수집 등으로 제거된 authored entity, `once` interaction의
consumed 상태, 현재 navigation 전체(크기·원점·비용 또는 clear)를 함께 저장한다.

```ts
import { captureGameStateSnapshot, restoreGameStateSnapshot } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";

applyDataSceneAuthoringDocument(engine, document);
const saved = captureGameStateSnapshot(engine, {
  includeDataSceneState: true,
  includeDataSceneProgress: true,
  dataSceneAuthoringDocument: document,
});
// saved는 JSON 직렬화/저장 후 새 engine에서도 복원할 수 있다.
restoreGameStateSnapshot(engine, saved);
```

저장 payload의 `dataScene.progress`는 stable instance ID를 사용한다. 새 handle/generation은 문서 재적용
결과에서 다시 연결하며 제거 상태를 복원할 때 수집 이벤트나 변수 증가를 재실행하지 않는다.
문서 apply → 진행 상태 → 변수 → lifecycle → custom callback 순서로 복원한다. 입력 바인딩은 게임이
새 엔진에 다시 설치한다. 진행 상태에는 위치·속도·카메라 설정·타이머 경과·FSM·추가 spawn·임의 JS 상태가
포함되지 않는다. 필요한 게임 데이터는 기존 variables/custom 또는 별도 physics snapshot 정책으로 관리한다.

이번 진행 저장은 **기본 binding 옵션으로 전체 apply한 단일 문서**를 대상으로 한다. 같은 원본 문서를
capture에 전달해야 한다. fragment/idPrefix/transform/ids/kinds override, 외부 componentTemplates,
`activateDataScene: false` 누적 apply 뒤에는 진행 capture를 거절한다. 설정을 문서에 넣고 전체 적용한다.
`path`, `textureId`, `colorManagement`, `instanceHandleRegistry` 옵션은 허용한다.
reset/씬 전환 뒤 이전 apply 메타데이터로 모든 객체가 제거됐다고 저장하지 않도록 epoch를 확인한다.
진행 payload가 있으면 `restoreDataSceneAuthoringDocument: false`를 거절한다.
`restoreDataSceneState: false`는 문서와 진행 복원 모두 건너뛴다.

새 Data Scene state version은 `3`이며 바깥 GameStateSnapshot version은 `2`를 유지한다.
기존 Data Scene v2 파일은 해시를 변경하지 않고 읽으며 progress 없이 종전 동작으로 복원한다.
v2 엔진은 새 v3 파일을 거절하므로 진행 상태를 무시한 복원으로 아이템이 다시 나타나는 일을 방지한다.
잘못된 progress ID/중복/consumed 조합/grid/버전은 씬 초기화 전에 거절하며 payload도 snapshot hash에 포함된다.

실행 검증: `pnpm smoke:data-scene-gameplay`. 실제 packed package의 `/core`와 `/authoring`만 사용해
입력·수집·변수·navigation·실패 시 씬 보존·generation reset을 검증한다.
