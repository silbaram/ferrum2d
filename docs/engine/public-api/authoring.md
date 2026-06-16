# Authoring Public API

`@ferrum2d/ferrum-web/authoring`은 preview authoring entrypoint다. AI agent와
template이 scene, behavior, projectile/weapon, FSM, physics authoring data를 검증하고
낮은 빈도로 runtime command를 적용할 때 사용한다.

```ts
import {
  resolveSceneCompositionSpec,
  resolveDataSceneComponentsSpec,
  createDataSceneRuntimeTarget,
  createSceneInstanceHandleRegistry,
  classifySceneInstance,
  resolveBehaviorRecipeDocument,
  compileWeaponProfiles,
  applyGameplayBehaviorCommands,
  resolvePhysicsSpec,
} from "@ferrum2d/ferrum-web/authoring";
```

## Scene And Behavior

| API | 계약 |
| --- | --- |
| `resolveSceneAuthoringDocument(...)` | data scene authoring envelope를 검증한다. |
| `resolveSceneCompositionSpec(...)` | prefab, fragment, instance 배치를 정규화한다. |
| `instantiateSceneFragment(...)` | fragment를 deterministic instance list로 펼친다. |
| `resolveDataSceneComponentsSpec(...)` | `props.components` v1 sprite/collider/layer/template descriptor를 검증하고 정규화한다. |
| `createDataSceneRuntimeTarget(...)` | `FerrumEngine`을 Data Scene spawn target으로 감싸 `applySceneBehaviorRecipes(...)`에 넘길 수 있게 한다. |
| `createSceneInstanceHandleRegistry(...)` | scene apply/reload 뒤 `instance.id`와 live entity handle을 양방향으로 조회한다. |
| `classifySceneInstance(...)` | resolved instance를 저장 필드 없이 `worldObject` 또는 `actor` authoring role로 파생한다. |
| `resolveBehaviorRecipeDocument(...)` | entity behavior recipe를 검증하고 정규화한다. |
| `behaviorRecipeCommandsForEntity(...)` | 특정 entity에 적용할 `BehaviorRecipeCommand[]`를 만든다. |
| `applyGameplayBehaviorCommands(...)` | command를 `FerrumEngine` gameplay facade로 낮은 빈도 적용한다. |

Behavior recipe는 health, damage, faction, pickup, interaction, projectile action,
dash/melee/spawn action, timer, collision reaction, movement 같은 데이터를 표현한다.
매 frame TypeScript callback을 등록하는 API가 아니다.

`createDataSceneRuntimeTarget(engine)`은 기본적으로 첫 번째 유효한 spawn 직전에 `engine.useDataScene()`을
한 번 호출해 빈 Data Scene runtime을 활성화한 뒤, 각
`ResolvedSceneCompositionInstance.props.components` inline descriptor를 raw Wasm
`spawn_data_scene_entity(...)`로 컴파일한다. authoring validation 실패나 target 생성만으로 기존 scene을
비우지 않는다. asset texture id는 `engine.textureId(name)` 또는 `options.textureId(name)`으로 해석한다.
consumer는 generated Wasm `pkg/*`, `dist/*`, `src/*` 내부 경로를 직접 import하지 않는다.

default target은 `components.sprite`/`collider`/`layer` inline descriptor만 spawn한다.
`components.template` catalog reference, instance `rotationRadians`, instance `layer`는 아직 default runtime
spawn 범위가 아니므로 diagnostic error로 거절된다. 회전 collider는
`components.collider.rotationRadians`를 사용한다.

`classifySceneInstance(instance)`는 `props.behaviorRecipes` 바인딩 존재 여부로 authoring role만
파생한다. behavior binding이 없으면 `worldObject`, 하나 이상 있으면 `actor`다. 이 값은 저장되는
schema 필드나 Rust runtime class가 아니며, UI/agent가 배치 객체와 기능 객체를 설명할 때 쓰는
낮은 빈도 authoring helper다. `props.components`가 있는지 여부는 `hasDataSceneComponents`로
함께 확인할 수 있다.

`createSceneInstanceHandleRegistry({ entityExists })`는
`applySceneBehaviorRecipes(..., { instanceHandleRegistry })`와 함께 사용한다.
scene apply 결과의 `ResolvedSceneCompositionInstance.id`와
`GameplayEntityHandle`을 동기화하고, `get(id)`, `require(id)`, `instanceIdForHandle(handle)`로
양방향 조회를 제공한다. `entityExists`를 넘기면 `validateLive: true` 조회나 `sync(...)` 시 stale
handle을 제거한다. 이 registry는 scene load, reload, reapply, agent patch 같은 낮은 빈도 경로용이며,
frame loop에서 entity별 JS/Wasm 호출을 추가하지 않는다. 배치 UI나 agent 타겟팅처럼 안정 id가 필요한
경로는 `requireExplicitInstanceIds: true`로 fallback id 의존을 막을 수 있다.

세부 primitive와 검증 기준은 [Runtime Extensibility](../runtime-extensibility.md)와
[Data Scene Authoring](../data-scene-authoring.md)을 따른다.

## Projectile And Weapon

| API | 계약 |
| --- | --- |
| `projectile(id)` | projectile speed, damage, lifetime, aim, collision target, tile impact를 정의한다. |
| `weapon(id)` | action id, cooldown, projectile fire rule을 묶는다. |
| `compileWeaponProfiles(...)` | weapon/projectile definition을 behavior recipe document로 컴파일한다. |

`compileWeaponProfiles(...)` 결과는 runtime simulation object가 아니다. agent나
template이 생성한 data를 검증하고, scene load 또는 profile 변경 같은 낮은 빈도
타이밍에 command로 적용한다.

## Gameplay Runtime Apply

`FerrumEngine`은 authoring apply용 gameplay facade를 제공한다.

| Method | 계약 |
| --- | --- |
| `registerGameplayPrefabs(...)` | runtime prefab id와 component source를 등록한다. |
| `applyGameplayBehaviorCommands(...)` | resolved command를 Rust-owned gameplay component에 적용한다. |
| `applyFactionRelationTable(...)` | session 단위 faction relation table을 적용한다. |
| `installBehaviorStateMachineRuntime(...)` | FSM document를 numeric runtime plan으로 설치한다. |
| `preflightBehaviorStateMachineStateCommands(...)` | state command apply 가능성을 mutation 없이 검사한다. |
| `applyBehaviorStateMachineStateCommands(...)` | 검증된 state command subset을 적용한다. |

이 API들은 scene load, agent patch, replay setup 같은 낮은 빈도 경로용이다. frame hot path에
entity별 JS/Wasm callback을 추가하지 않는다.

## Atomic Apply And Rollback

단일 command가 Rust에서 atomic setter를 제공하는 경우, 해당 component와 reaction은 한 번의
검증 결과로 반영된다. 예를 들어 `configureDamage`는 damage component와 damage collision
reaction을 같은 setter 결과로 적용한다.

전체 `BehaviorRecipeCommand[]` batch는 full engine transaction이 아니다. 실패 시 facade는
JSON path와 원인 후보를 포함한 diagnostic을 반환하거나 throw한다. agent loop에서는
`dryRunSceneBehaviorRecipes(...)`, preflight helper, replay/smoke를 먼저 통과한 plan을
runtime에 적용한다.

## Raw Wasm Boundary

raw Wasm `set_gameplay_*` setter는 public API가 아니다. 테스트 harness나 내부 bridge 검증에
필요한 구현 detail이며, consumer는 `FerrumEngine` gameplay facade와 authoring helper를
사용한다.

이 경계는 Rust/Wasm bulk buffer 원칙을 지키기 위한 것이다. TypeScript는 authoring data를
숫자형 command로 컴파일하고, Rust core가 frame update와 gameplay state mutation을 수행한다.

## Physics Authoring Facade

Authoring subpath는 Physics Spec helper도 노출한다.

| API | 계약 |
| --- | --- |
| `resolvePhysicsSpec(...)` | physics namespace를 resolved spec으로 정규화한다. |
| `compilePhysicsAuthoringDocument(...)` | editor/AI metadata를 runtime spec으로 변환한다. |
| `createRigidBody(...)`, `createCollider(...)`, `createJoint(...)` | TypeScript authoring helper다. |
| `createVehicleRig(...)` | body/joint 조합을 빠르게 만들기 위한 helper다. |
| `validatePhysicsAuthoringDocument(...)` | authoring document 구조를 검증한다. |

Physics solver와 runtime query 계약은 [Core Runtime](core.md)과
[Physics Spec](../physics-spec.md)을 기준으로 한다.
