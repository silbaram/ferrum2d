# 런타임 확장성 고도화 로드맵

이 문서는 Ferrum2D를 게임별 하드코딩이 아니라 **Rust 범용 실행 코어 + TypeScript authoring 확장 레이어** 구조로 고도화하기 위한 planning 문서다. 구현이 완료된 public API, 사용법, 검증 기준은 [Runtime Extensibility](../engine/runtime-extensibility.md), [Public API](../engine/public-api.md), [Architecture](../development/architecture/architecture.md), [Smoke Check](../development/quality/smoke-check.md)로 옮기고 이 문서에서는 후속 계획과 결정 로그만 유지한다.

## 목표

- Rust core에는 빠른 계산, 물리, 충돌, query, entity lifecycle, gameplay event 생성 같은 범용 실행 기능을 둔다.
- TypeScript에는 게임 오브젝트, prefab, 무기, 발사체, 이펙트, asset 연결을 선언하는 authoring API를 둔다.
- 게임별 총알, 미사일, 폭발탄, 스킬, 아이템을 Rust 코드에 계속 추가하지 않고 TS/spec에서 조합할 수 있게 한다.
- frame hot path에서 entity별 JS/Wasm callback을 만들지 않는다.
- AI agent가 code-first보다 spec/builder/schema/smoke를 통해 게임 규칙을 안전하게 바꾸게 한다.

## 핵심 결정

Ferrum2D의 확장성은 TS가 시뮬레이션을 직접 실행하는 방식이 아니라, TS가 게임 규칙을 선언하고 Rust가 실행하는 방식으로 만든다.

```text
TypeScript builder/spec
  -> validate/compile
  -> numeric component/action/prefab commands
  -> Rust World storage
  -> Rust frame update
  -> render/audio/gameplay/effect event buffers
  -> TypeScript renderer/audio/VFX adapters
```

이 구조에서 TS의 OOP/builder는 게임 작성자가 쓰는 authoring facade다. 매 프레임 물리, 충돌, 유도, 폭발 피해, spawn/despawn을 TS class method로 실행하지 않는다.

## 책임 경계

| 영역 | Rust core | TypeScript authoring/platform |
| --- | --- | --- |
| 엔티티 상태 | `World`, component storage, entity lifecycle | public handle, prefab id, authoring registry |
| 물리/충돌 | collider, rigid body, tile query, shape cast, swept collision | Physics Spec/authoring 문서, debug view, validation |
| 발사체 | motion, lifetime, collision target, impact, damage, despawn | projectile/weapon definition builder |
| 폭발 | radius query, area damage, knockback, score/death event | explosion sprite, particle preset, sound id, screen shake preset |
| 타겟 탐색 | nearest/layer/faction/radius query | query preset 선언 |
| 렌더링 | render command buffer 생성 | WebGL2/WebGPU command 소비, texture/atlas loading |
| 사운드/VFX | audio/effect event 생성 | AudioManager/VFX registry 실행 |
| 게임 규칙 작성 | numeric preset/component 실행 | Game Spec, Behavior Recipe, prefab/projectile DSL |

## 제외 범위

- frame hot path의 entity별 TS callback
- 게임별 class를 Rust engine core에 계속 추가하는 방식
- full visual editor 중심 개발 방식
- user scripting/plugin runtime
- 멀티플레이어
- Wasm threads 또는 전체 게임 루프 Worker 이전
- soft body, fluid, cloth 같은 complex physics core 확장

## 목표 Authoring Surface

TS 사용자는 게임 오브젝트를 이런 식으로 작성할 수 있어야 한다.

```ts
const bullet = projectile("bullet")
  .sprite("bullet")
  .collider(circle(4))
  .motion(linear({ speed: 600 }))
  .onHit(damage({ amount: 1 }))
  .onHit(destroySelf());

const missile = projectile("homingMissile")
  .sprite("missile")
  .collider(circle(8))
  .motion(seekTarget({ query: nearestEnemy(), speed: 260, turnRate: 8 }))
  .onHit(areaDamage({ radius: 72, amount: 3 }))
  .onHit(spawnEffect("smallExplosion"))
  .onHit(destroySelf());

const launcher = weapon("missileLauncher")
  .fire(missile)
  .cooldown(0.4);
```

위 builder는 runtime object graph가 아니라 serializable authoring data로 compile되어야 한다.

```text
builder/spec
  -> ProjectileDefinition
  -> validated command list
  -> Rust component slots / prefab registry
```

## Rust 고도화 범위

### 1. Generic Prefab/Component Runtime

- 게임별 `Bullet`, `Missile`, `Bomb` 타입 대신 prefab id와 component set을 사용한다.
- prefab은 transform, sprite, collider, rigid body, lifetime, faction, damage, motion, impact 같은 범용 component 조합으로 표현한다.
- spawn은 `spawnPrefab(prefabId, transform, initialVelocity, owner/faction)` 형태의 낮은 빈도/이벤트 기반 command로 처리한다.

완료 기준:

- 같은 Rust spawn path로 bullet, enemy projectile, pickup, effect marker를 생성할 수 있다.
- prefab snapshot/replay가 deterministic hash에 포함된다.
- prefab registry는 public name이 아니라 numeric id로 frame loop에서 접근한다.

### 2. Motion System

발사체와 단순 오브젝트 이동을 범용 motion primitive로 분리한다.

| Motion | 목적 |
| --- | --- |
| `linear` | 기존 직선 총알, 낙하물, 단순 이동 |
| `seekTarget` | 유도미사일, 추적 투사체 |
| `accelerate` | 로켓, 감속/가속 탄 |
| `orbit` | 보호막, 회전 오브젝트 |
| `followPath` | waypoint 또는 tile navigation 기반 이동 |

완료 기준:

- 유도 계산은 Rust update loop에서 실행된다.
- target query는 Rust-owned query result를 사용한다.
- TS는 motion preset을 선언하지만 per-frame 위치 보정을 하지 않는다.

### 3. Target Query / Spatial Query

발사체, AI, 폭발, 상호작용이 공유하는 query primitive를 만든다.

- nearest entity by faction/layer/tag
- 현재 구현은 `chase.target`/`seekTarget.target`의 `"nearestPlayer" | "nearestEnemy" | "nearestLayer:*" | "nearestFaction:*" | "nearestTag:*"` query preset을 Rust `MovementTarget`으로 저장하고, source 위치 기준 가장 가까운 transform을 frame loop 안에서 해석한다.
- `nearestFaction:*`/`nearestTag:*`는 `World` 내부 derived index bucket으로 전체 alive scan을 피한다. bucket은 component setter, despawn, prefab/projectile spawn, snapshot restore, authoring rollback restore에서 동기화되며 public ABI에는 저장하거나 노출하지 않는다.
- `nearestTag:*`는 TypeScript authoring에서 `ids.tags` 또는 numeric `0..31` tag id로 컴파일되고, Rust `GameplayTags` bitmask component를 대상으로 동작한다. query result debug buffer는 후속 slice로 남긴다.
- entities in radius
- AABB/circle/capsule query
- raycast/shape cast result
- line-of-sight 또는 tile blocking option

완료 기준:

- query 결과는 Rust 내부에서 action/motion/impact system이 소비한다.
- debug/smoke용 결과만 bulk buffer 또는 telemetry로 TS에 노출한다.
- query preset은 numeric id와 mask 기반으로 compile된다.

### 4. Impact / Collision Reaction Pipeline

충돌 결과를 hardcoded bullet damage에서 범용 reaction list로 확장한다.

| Reaction | 목적 |
| --- | --- |
| `damage` | 단일 대상 피해 |
| `areaDamage` | 폭발/광역 피해 |
| `knockback` | 충돌 방향 또는 중심점 기준 impulse |
| `spawnPrefab` | 파편, pickup, 후속 투사체 생성 |
| `emitEffect` | VFX/audio/screen shake event 생성 |
| `destroySelf` | 투사체 또는 source 제거 |
| `bounce` | 충돌 normal 기반 반사 |
| `passThrough` | 특정 layer/tile 충돌 무시 |

완료 기준:

- 폭발탄은 Rust radius query와 damage reaction으로 처리된다.
- 이펙트 표현은 Rust `emitEffect` event와 TS registry로 분리된다.
- collision reaction은 TS callback이 아니라 Rust-owned data로 실행된다.

### 5. Physics Engine Product Surface

물리 엔진은 Rust에 두되, TS에서 authoring 가능한 계약을 넓힌다.

- collider primitive와 compound collider authoring
- rigid body material, restitution, friction, damping
- sensor/trigger와 collision layer/faction 분리
- shape query와 raycast/shape cast authoring helper
- opt-in debug line/event buffer

완료 기준:

- Physics Spec과 object/prefab authoring이 같은 collider/material contract를 사용한다.
- physics query 결과를 TS가 frame별 게임 로직으로 재계산하지 않는다.
- 새 physics field는 schema, docs, replay/smoke 기준을 함께 가진다.

### 6. Effect Event Pipeline

게임 효과와 표현 효과를 분리한다.

```text
Rust gameplay effect
- areaDamage
- knockback
- spawn/despawn
- score/death event

TypeScript presentation effect
- particle preset
- sound id
- camera shake
- sprite animation
```

완료 기준:

- Rust는 `effectId`, position, intensity, source/target handle 같은 numeric payload를 event buffer로 생성한다.
- TS는 event를 effect registry에 매핑해 particle/audio/camera presentation을 실행한다.
- effect event는 gameplay result를 바꾸지 않는다.

## TypeScript 고도화 범위

### 1. Builder/DSL Facade

- `object(...)`, `prefab(...)`, `projectile(...)`, `weapon(...)`, `effect(...)` 같은 authoring builder를 제공한다.
- builder 결과는 JSON 직렬화 가능한 definition이어야 한다.
- OOP는 사용 편의용 facade로만 사용하고 runtime simulation state를 보관하지 않는다.

### 2. Spec / Schema / Validation

- builder와 JSON spec은 같은 internal definition으로 resolve한다.
- invalid collider, motion, reaction, query, asset key는 Rust apply 전에 TS validation에서 진단한다.
- AI agent가 수정하기 쉬운 schema와 fixture를 유지한다.

### 3. Compile To Engine Commands

- TS definition은 raw object 전달이 아니라 numeric command/bulk buffer로 compile한다.
- scene load, prefab registration, weapon switch 같은 낮은 빈도 경로에서만 apply한다.
- frame마다 entity별 setter를 호출하지 않는다.

### 4. Asset And Presentation Registry

- sprite/atlas/sound/effect preset은 TS registry가 소유한다.
- Rust는 texture id, sound id, effect id 같은 숫자만 안다.
- missing asset은 validation/smoke에서 확인한다.

## 단계별 구현 계획

### 0단계: 현재 기능 진단과 계약 고정

- 기존 `projectileAction`, `collisionReaction`, `physicsAuthoring`, `BehaviorRecipe`가 제공하는 필드를 정리한다.
- starter-runtime/topdown-shooter에서 총알, 충돌, 이펙트가 어디에 하드코딩되어 있는지 목록화한다.
- public API와 raw Wasm setter 사이의 노출 경계를 확정한다.

#### 현재 진단 결과 (완료)

- `BehaviorRecipe`/TS 어댑터는 `projectileAction`, `dashAction`, `meleeAction`, `spawnPrefabAction`을 노출하고, 런타임 실행 가능한 값 조합은 여기서 이미 1차 제한된다.
  - `projectileAction`: 기본 허용은 `aim` 기준이 `input` 또는 `targetPlayer`, `collisionTarget` 기준이 `enemies` 또는 `player`, `tileImpact`는 `despawn`/`passThrough`/`bounce`.
  - `spawnPrefabAction`: `anchor`는 `self`, `phase`는 `prePhysics`만 통과.
- Rust setter/API 경계는 위 규약을 상위에서 선제 필터링한 뒤에도 동일 제약을 다시 강제한다.
  - `set_gameplay_action_projectile`/`_with_target`: `ActionAimSource`, `ProjectileCollisionTarget`, `ProjectileTileImpact` 코드셋만 해석.
  - `set_gameplay_action_spawn_prefab`: `prefab_id`는 `ShooterPrefabRegistry`에서 Enemy prefab으로 등록된 id만 허용.
  - `apply` 경로(`prepare`/`plan`/`spawn`)에서도 `SpawnPrefabSupport`/`Unsupported*` 실패 코드로 동일 제약 강화.
- `collisionReaction`은 `Damage/AreaDamage/Pickup/Despawn/Knockback/SpawnPrefab/PlaySound/SpawnParticle/CameraShake/EmitEffect`까지 확장됐다. `AreaDamage`는 entity impact와 tile impact 모두에서 동작하며, tile impact는 Rust 내부 swept contact point를 중심으로 사용한다.

#### Hardcoded hotspot(Top-down starter 기준)

- `crates/ferrum-core/src/components/gameplay.rs`
  - `ActionAimSource`: `Input | TargetPlayer`만 존재.
  - `ProjectileCollisionTarget`: `Enemies | Player`만 존재.
  - `ProjectileTileImpact`: `Despawn | PassThrough | Bounce`만 존재.
  - `MeleeTarget`: `Enemies | Player`만 존재.
  - `SpawnAnchor`: `SelfEntity`만 존재.
  - `SpawnPhase`: `PrePhysics`만 존재.
  - `CollisionReaction`: 현재는 gameplay mutation 계열 `Damage/AreaDamage/Pickup/Despawn/Knockback/SpawnPrefab`과 presentation side-effect 계열 `PlaySound/SpawnParticle/CameraShake/EmitEffect`로 나뉜다.
- `crates/ferrum-core/src/gameplay.rs`
  - `validate_projectile_action_support`/`validate_input_projectile_action_support`에서 지원 조합이 각각 `targetPlayer|player` 또는 `input|enemies`로 고정.
  - `validate_spawn_prefab_action_support`에서 `anchor=self`, `phase=PrePhysics` 고정.
  - 실패 사유도 `UNSUPPORTED_*`로 event telemetry에 고정 보고.
- `crates/ferrum-core/src/engine/gameplay_authoring.rs`
  - `set_gameplay_action_projectile_with_target`/`set_gameplay_action_spawn_prefab`에서 `ActionAimSource`/`ProjectileCollisionTarget`/`ProjectileTileImpact`/`Spawn*` 코드 매핑만 허용.
  - `set_gameplay_action_spawn_prefab`는 `ShooterPrefabRegistry` resolver로 비Enemy/unknown prefab을 차단.
- `crates/ferrum-core/src/shooter_scene/runtime/spawn.rs`
  - `plan_supported_spawn_prefab_action`은 `ShooterPrefabRegistry` resolver가 지원하는 prefab id만 통과시킨다. `spawnPrefabAction` dispatch는 projectile payload 없는 Enemy prefab과 projectile payload 있는 Bullet prefab을 처리하고, `collisionSpawnPrefab` dispatch는 현재 projectile payload 없는 Enemy prefab만 처리한다.
- `crates/ferrum-core/src/shooter_scene/runtime/combat.rs`
  - bullet-tile 처리 경로는 `PassThrough`/`Despawn`/`Bounce` 이 3가지 정책으로만 동작.
  - `apply_tile_collision_reaction_set`는 현재 `AreaDamage`, `PlaySound`/`SpawnParticle`/`CameraShake`/`EmitEffect` side-effect 및 self `Despawn`을 반영한다. `Damage`/`Pickup`/`Despawn(other)` 같은 단일 대응 entity가 필요한 반응은 tile impact에서 실행하지 않는다.
- `crates/ferrum-core/src/shooter_scene/config.rs`
  - `ShooterPrefabKind`가 Player/Enemy/Bullet 3종으로 고정되어, top-down starter prefab 확장 기반이 선행되어 있지 않음.
- `examples/topdown-shooter/public/authored-behavior.variant.json`
  - 기본 동작이 `primary`/`dash`/`spawnPrefabAction` 조합 중심으로 구성되어 있고, spawn 또한 enemy 중심 `prefabId:1`(enemy) 패턴이 상시 사용됨.

#### 0단계 산출물 기준 체크리스트 (다음 단계 진입 조건)

- [x] `projectileAction`, `collisionReaction`, `spawnPrefab` 현재 지원 범위와 한계를 위 항목으로 문서화.
- [x] Top-down starter에서 하드코딩/고정 열거 제약을 파일 단위로 목록화(확장 지점 식별).
- [x] public API ↔ raw Wasm setter 계약 경계를 확인(설계 상위 제한 + runtime 재확인 제약).
- [x] 다음 단계에서 `ActionAimSource/ProjectileCollisionTarget/ProjectileTileImpact` 및 prefab/반응 타입 확장 설계 확정.
- [x] `CollisionReaction` 타입셋을 gameplay mutation과 presentation side-effect로 1차 분리하고, tile/entity 반응 처리 분기의 현재 계약을 문서화.
- [x] 4단계 대비를 위해 `areaDamage`, `knockback`, `spawnPrefab`, `emitEffect` 추가 시 tile/entity 반응 순서와 default replacement 정책 확정.

#### Action/Prefab 확장 계약 (2~3단계 선행 결정)

1. `ActionAimSource`는 기존 numeric code를 유지한 채 additive enum으로 확장한다.
   - 기존 code `0 = Input`, `1 = TargetPlayer`는 ABI 호환을 위해 변경하지 않는다.
   - 다음 확장 후보는 `TargetQuery`, `FixedDirection`, `OwnerForward` 순서로 추가한다.
   - `TargetQuery`는 TS가 query를 실행하는 것이 아니라 numeric query preset id를 Rust action payload에 저장하고 Rust frame loop에서 평가한다.
   - `FixedDirection`은 authoring/apply 시점에 정규화된 x/y 벡터를 저장하고, 프레임마다 JS callback을 호출하지 않는다.
2. `ProjectileCollisionTarget`은 layer hardcode에서 query/mask preset으로 이동한다.
   - 기존 code `0 = Enemies`, `1 = Player`는 legacy shooter compatibility path로 유지한다.
   - 신규 target은 `CollisionLayer` 직접 노출보다 `TargetQueryPreset`/`FactionMask` 형태로 authoring한다.
   - friendly-fire와 neutral faction 동작은 현재 `GameplayFaction.damage_mask` gate를 우선 적용한다.
   - target query가 비어 있거나 unsupported이면 cooldown을 소비하지 않고 `actionFailed(unsupportedCollisionTarget)` 또는 더 구체적인 신규 failure code로 보고한다.
3. `ProjectileTileImpact`는 terminal policy와 reaction execution policy를 분리한다.
   - 기존 code `0 = Despawn`, `1 = PassThrough`, `2 = Bounce`는 유지한다.
   - 다음 확장은 `Stop`, `ReflectWithDamping`, `TriggerOnly` 후보로 열되, 4단계 전에는 code를 선점하지 않는다.
   - `PassThrough`는 tile reaction을 실행하지 않는 기존 의미를 유지한다.
   - `Despawn`/`Bounce` 및 향후 terminal/reflect 계열만 tile-side reaction set을 실행할 수 있다.
4. Prefab 확장은 `ShooterPrefabKind` hardcode를 public authoring id와 runtime resolver로 감싼 뒤 진행한다.
   - 기존 built-in ids는 compatibility alias로 유지한다: Player/Enemy/Bullet 의미는 깨지지 않는다.
   - `spawnPrefabAction`은 계속 `prefabId` numeric token을 사용하고, Rust는 resolver가 지원하는 prefab만 `SpawnPrefabSupport::Supported`로 인정한다.
   - generic prefab registry는 transform, sprite, collider, lifetime, faction, damage/motion/reaction component set을 numeric component bucket으로 정규화한다.
   - spawn은 즉시 `World` 구조 변경을 하지 않고 기존 pending spawn phase에 큐잉한다.
   - unsupported prefab, blocked placement, capacity full은 cooldown을 소비하지 않는 실패로 유지한다.
5. TS authoring surface는 builder/spec convenience를 제공하지만 runtime semantics의 source of truth는 Rust numeric contract다.
   - TS `ProjectileDefinition`/`WeaponDefinition`은 기존 `projectileAction`으로 compile 가능한 subset부터 유지한다.
   - query, prefab, reaction 확장은 `BehaviorRecipeCommand`/dry-run diagnostic 경로를 먼저 열고, raw Wasm setter는 public facade에 직접 노출하지 않는다.
   - JSON schema와 TS type은 같은 resolved definition shape을 바라보게 하고 중복 validation drift를 줄인다.
6. Snapshot/replay 호환성은 enum 확장 시점마다 version gate를 사용한다.
   - 기존 projectile action, bullet target, tile impact payload는 현재 snapshot 해석을 유지한다.
   - query preset, generic prefab id, component bucket이 save scope에 들어가면 shooter snapshot version을 올린다.
   - replay hash는 numeric enum code, prefab id, query preset id, normalized component bucket 순서로 canonicalize한다.

#### CollisionReaction 확장 계약 (4단계 선행 결정)

1. Reaction 타입은 두 계열로 유지한다.
   - Gameplay mutation: 현재 `Damage`, entity/tile-impact `AreaDamage`, `Pickup`, `Despawn`, entity-impact `Knockback`, entity/tile-impact `SpawnPrefab`.
   - Presentation side-effect: 현재 `PlaySound`, `SpawnParticle`, `CameraShake`, `EmitEffect`.
2. Entity/entity collision은 현재 런타임 순서를 계약으로 고정한다.
   - `CollisionReactionPair.source_index` entity의 reaction set을 먼저 적용한다.
   - 이후 `pair.reversed()`로 other entity의 reaction set을 적용한다.
   - 각 reaction set 내부는 authored slot order를 유지한다.
   - 같은 entity를 여러 reaction이 despawn 대상으로 삼아도 `marked_for_despawn`/pending despawn queue를 통해 한 번만 구조 변경한다.
3. Tile impact collision은 source entity의 reaction set만 실행한다.
   - 현재 허용된 tile reaction은 `AreaDamage`, presentation side-effect와 `Despawn(self)`다.
   - `Damage`, `Pickup`, `Despawn(other)`는 tile target entity가 없으므로 no-op로 유지한다.
   - `SpawnParticle(other)`도 tile target entity가 없으므로 no-op이고, `SpawnParticle(self)`만 source transform 위치를 사용한다.
   - tile impact는 terminal contact로 취급하므로 `trigger: "enter"`와 `trigger: "contact"`는 모두 해당 tile impact frame에서 허용한다.
4. 4단계 신규 reaction의 tile/entity 적용 범위는 다음으로 제한한다.
   - `AreaDamage`: entity impact에서는 source transform을 우선 사용하고 없으면 other transform으로 fallback한다. tile impact에서는 Rust 내부 swept tile contact point를 중심점으로 사용하며, world/contact `x/y`는 gameplay event ABI에 추가하지 않는다.
   - `Knockback`: entity impact에서만 우선 지원한다. tile impact knockback은 tile normal 기반 정책이 필요하므로 별도 승인 전 no-op diagnostic 후보로 둔다.
   - `SpawnPrefab`: entity impact와 tile impact 모두 허용하지만 즉시 `World`를 구조 변경하지 않고 기존 pending spawn phase에 큐잉한다. tile impact에서는 `target: "self"`만 source transform anchor로 동작하고 `target: "other"`는 대응 entity가 없어 no-op이다. 실패 원인은 `actionFailed` telemetry로 보고하며 cooldown을 소비하지 않는다.
   - `EmitEffect`: entity impact와 tile impact 모두 허용하며 gameplay state를 바꾸지 않고 presentation event만 enqueue한다.
5. Default replacement 정책은 gameplay와 presentation을 분리한다.
   - `Damage`, `AreaDamage`, `Pickup`, `Despawn`은 default gameplay를 대체할 수 있는 terminal gameplay reaction이다.
   - `Knockback`, `SpawnPrefab`은 기본값이 additive다. default gameplay suppress가 필요하면 향후 명시적 `replaceDefaultGameplay` 플래그를 따로 설계한다.
   - `PlaySound.replaceDefault`는 built-in audio만 suppress한다.
   - `SpawnParticle.replaceDefault`는 built-in particle만 suppress한다.
   - `CameraShake`와 `EmitEffect`는 기본값이 additive이며 default gameplay/audio/particle suppress를 하지 않는다.
6. Event/replay 순서는 deterministic하게 유지한다.
   - reaction application 순서는 source set slot order, other set slot order다.
   - gameplay event, presentation effect event, pending despawn/spawn enqueue는 같은 reaction application 순서에서 파생된다.
   - frame hot path에서 entity별 JS/Wasm callback은 추가하지 않고, Rust fixed-capacity buffer와 TS batch decode 경계만 사용한다.
7. Public authoring surface는 기존 `BehaviorRecipeCommand` 방식으로만 확장한다.
   - TS builder/spec은 `areaDamage`, `knockback`, `spawnPrefab`, `emitEffect`를 serializable authoring data로 만들고 numeric command로 compile한다.
   - Rust setter는 TS validation을 신뢰하지 않고 numeric code/range/capacity를 재검증한다.
   - public facade는 raw Wasm setter를 직접 노출하지 않고 typed command/dry-run path를 유지한다.

검증:

- 문서 변경 후 `git diff --check`
- API 변경이 없으면 빌드 생략 가능

### 1단계: Projectile/Weapon Authoring Facade

- TS에 projectile/weapon definition type과 builder를 추가한다.
- 기존 Rust `projectileAction`이 지원하는 `speed`, `damage`, `lifetime`, `aim`, `collisionTarget`, `tileImpact`로 compile한다.
- starter-runtime에 일반탄, 관통탄, 튕김탄 같은 현재 지원 가능한 변형을 추가한다.

검증:

- `pnpm --filter @ferrum2d/ferrum-web test`
- `pnpm --filter @ferrum2d/starter-runtime build`
- starter-runtime browser smoke

### 2단계: Generic Prefab Registration

- Rust에 prefab/component registry를 추가하거나 기존 template path를 public authoring에 맞게 정리한다.
- TS definition이 prefab id로 compile되어 spawn action과 연결되게 한다.
- projectile spawn도 bullet-specific path에서 prefab/component 기반 path로 옮긴다.

현재 진행:

- [x] `ShooterPrefabRegistry`를 추가해 spawnPrefabAction의 직접 `ShooterPrefabKind::Enemy` 비교를 resolver 경계로 이동.
- [x] spawnPrefabAction snapshot capture/restore가 `prefabId == 1` 하드코딩 대신 registered Enemy prefab alias id를 보존하도록 변경.
- [x] 기본 Enemy prefab id `1`은 compatibility registration으로 유지.
- [x] `register_gameplay_enemy_prefab(prefabId)`로 Enemy prefab alias id를 등록할 수 있게 함.
- [x] `register_gameplay_bullet_prefab(prefabId)`와 TS `registerGameplayPrefabs(... kind: "bullet")`로 Bullet prefab alias도 registry에 등록 가능.
- [x] TS authoring facade에 `registerGameplayPrefabs(...)`를 추가해 `ids.prefabs`로 해석한 Enemy prefab alias를 Rust registry에 낮은 빈도로 등록.
- [x] `ShooterPrefabRegistration`에 Player/Enemy/Bullet template/texture slot과 gameplay component source를 담는 component bucket 계약을 추가.
- [x] projectile spawn command의 bullet template/texture 조회를 built-in Bullet prefab bucket resolver 경유로 이동.
- [x] `ShooterPrefabKind::code()`로 built-in prefab id 매핑을 명시하고, unresolved prefab id가 Enemy로 fallback되지 않도록 spawn command helper를 fail-closed로 변경.
- [x] runtime prefab spawn command 계열을 generic `Prefab*` 명명과 resolved kind payload로 정리하고, Enemy-only 제약은 support check와 enemy entity-spawn adapter 경계에 남김.
- [x] `SpawnPrefabPlacement` 계약을 분리해 anchor/phase/offset 기반 위치 산출을 Enemy/Bullet/Pickup/Effect 공통 확장 지점으로 고정.
- [x] `ActionPattern::SpawnPrefab`에 optional `SpawnPrefabProjectilePayload`를 추가해 Bullet prefab dispatch에 필요한 speed/damage/lifetime/aim/collisionTarget/tileImpact payload 계약을 선반영.
- [x] Rust raw authoring API `set_gameplay_action_spawn_projectile_prefab(...)`와 TS optional engine method를 추가해 registered Bullet prefab id에 projectile payload를 설정할 수 있게 함.
- [x] `PrefabSpawnCommand.kind == Bullet` dispatch를 기존 projectile entity spawn path에 연결. `Enemy + projectile None`, `Bullet + projectile Some`만 supported로 인정하며 recipe adapter는 아직 미연결.
- [x] built-in Shooter snapshot version `12` header에 prefab registry canonical payload를 포함해 save/replay hash가 prefab registration 상태 차이를 감지하도록 변경.
- [x] built-in Shooter snapshot version `13`에서 `spawnPrefabAction.projectile` payload와 registered Bullet prefab alias id를 보존하도록 변경.
- [x] built-in Shooter snapshot version `14`에서 `ActionBindingSet` capacity를 8개로 확장하고 player spawnPrefab action 반복 슬롯 stride를 갱신.
- [x] built-in Shooter snapshot version `15`에서 prefab registry component bucket에 collision layer slot을 추가해 Player/Enemy/Bullet resolved bucket을 layer/template/texture/gameplay 공통 구조로 고정.
- [x] prefab component bucket/registry를 Player/Enemy/Bullet/Runtime 공통 구조로 일반화.
- [x] projectile spawn을 bullet-specific storage에서 prefab/component 기반 path로 이전.
- [x] snapshot/replay hash에 generic prefab/component registration payload 반영.

검증:

- `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
- `wasm-pack build crates/ferrum-core --target web --out-dir ../../packages/ferrum-web/pkg`
- `pnpm build`

### 3단계: Motion/Target Query 확장

- Rust에 `linear`, `seekTarget`, `accelerate` motion primitive를 추가한다.
- `nearestEnemy`, `nearestPlayer`, layer/faction mask query preset을 추가한다.
- 유도미사일은 `seekTarget + directDamage + emitEffect + destroySelf` 조합으로 구현한다.

현재 반영:

- Rust/Wasm authoring surface와 TS behavior recipe facade는 `linear`, `seekTarget`, `accelerate`, `nearestPlayer`, `nearestEnemy`, `nearestLayer:player|enemy|bullet|wall|pickup`, `nearestFaction:neutral|player|enemy|<0..31>`, `nearestTag:<tagName>|<0..31>`을 지원한다.
- Shooter runtime은 Enemy movement phase 이후 physics integration 이전에 Bullet layer authored movement를 적용하며, movement component가 없는 기존 projectile velocity는 linear fallback으로 유지한다.
- homing missile end-to-end fixture는 Rust Engine frame-loop에서 `seekTarget(nearestEnemy)`/`seekTarget(nearestTag:*)` unit coverage를 유지하고, committed `projectile-homing-nearest-tag` gameplay replay에서 TS `SceneComposition`/`BehaviorRecipe` binding, `GameplayTags` 설치, `seekTarget(nearestTag:hostile) + Damage + Particle + Despawn + Lifetime`, projectile movement, collision, despawn, `presentationEffect`, score reward를 검증한다.

검증:

- Rust unit test: target selection, turn rate clamp, deterministic movement
- gameplay replay smoke: 같은 input/seed에서 동일 hash
- starter-runtime missile demo smoke

### 4단계: Impact/Area Damage 확장

- Rust collision reaction에 `areaDamage`, `knockback`, `spawnPrefab`, `emitEffect`를 추가한다.
- 폭발탄은 `linear + areaDamage + emitEffect + destroySelf` 조합으로 구현한다.
- tile impact와 entity impact의 reaction 순서를 명확히 한다.

현재 반영:

- [x] `CollisionReaction::AreaDamage` entity-impact path 추가. Rust frame loop에서 circle query, target layer mask, faction gate, health/score/despawn, `collisionDamage`/`factionDamageDenied` telemetry를 처리한다.
- [x] `collisionAreaDamage` Behavior Recipe, TS facade command, public type export, Wasm declaration, atomic `set_gameplay_area_damage_reaction(...)` authoring setter 추가.
- [x] `CollisionReaction::Knockback` entity-impact path 추가. `collisionKnockback` Behavior Recipe, TS facade command, public type export, Wasm declaration, authoring setter를 통해 `self`/`other` velocity impulse를 additive로 적용한다.
- [x] `CollisionReaction::EmitEffect` path 추가. `collisionEmitEffect` Behavior Recipe, TS facade command, public type export, Wasm declaration, authoring setter를 통해 `presentationEffect` gameplay event를 additive로 emit한다.
- [x] `CollisionReaction::SpawnPrefab` path 추가. `collisionSpawnPrefab` Behavior Recipe, TS facade command, public type export, Wasm declaration, authoring setter를 통해 collision impact에서 registered Enemy prefab spawn을 pending spawn queue에 적재한다. queue 성공 후에만 reaction cooldown을 커밋하고 실패는 `actionFailed` telemetry로 노출한다.
- [x] `projectile-area-damage-entity-impact` gameplay replay fixture 추가. TS `SceneComposition`/`BehaviorRecipe` binding 경로에서 `collisionAreaDamage`, `collisionEmitEffect`, `collisionDespawn`, `accelerate`, lifetime command를 설치하고 반경 내 direct/splash enemy damage, score 합산, 반경 밖 enemy 생존, presentation effect telemetry를 exact replay hash로 고정한다.
- [x] Rust/TS unit coverage 추가. 한 impact의 recorded damage outcome은 기존 fixed reaction outcome cap 때문에 최대 4개로 제한된다.
- [x] tile impact contact point 기반 `AreaDamage` Rust runtime path 추가. Bullet/Tile collision에서 swept contact point 중심 circle query, faction gate, health/score/despawn, `collisionDamage`/`factionDamageDenied` telemetry를 entity impact와 같은 outcome 요약 경로로 처리한다.
- [x] explosive projectile replay fixture는 entity-impact 범위에서 완료됐다.
- [x] runtime extensibility code review 반영. 단순 gameplay authoring setter는 더 이상 physics history/fixed timestep/input latch를 초기화하지 않고, snapshot restore만 전체 physics history를 초기화한다.
- [x] bounded gameplay collection 보강. collision reaction slot은 8개, FSM transition/state-enter action slot은 각각 16개로 확장했고, fixed `Option` slot collection은 insert/upsert 전에 compact해 sparse slot/len drift를 회복한다.
- [x] TS `applyGameplayBehaviorCommands(...)` false-return diagnostic을 강화해 command type, entity key, stale handle, invalid runtime id/value, unsupported prefab, capacity limit 원인 후보를 함께 보고한다.

검증:

- Rust unit test: radius damage, faction gate, friendly fire denial, knockback, presentation effect emit
- gameplay event payload snapshot
- starter-runtime explosive projectile smoke

### 5단계: Effect Event Registry

- Rust effect event buffer에 `effectId`, position, intensity, source/target metadata를 추가한다.
- TS에 particle/audio/camera shake registry를 연결한다.
- visual effect는 gameplay state를 바꾸지 않는 presentation-only adapter로 둔다.

현재 반영:

- [x] TS `presentationEffects.ts` helper를 추가해 `presentationEffect` gameplay event action을 named presentation effect registry와 bind한다.
- [x] `GameplayBehaviorRuntimeIds.effects` namespace와 `collisionEmitEffect.effect` 문자열 참조를 추가해 authoring data가 numeric `effectId`를 직접 반복하지 않고 registry id로 컴파일될 수 있게 했다.
- [x] public API export, type smoke, unit test, architecture/public API 문서가 effect registry 1차 surface를 반영한다.
- [x] Rust `EffectEvent` buffer ABI를 추가하고 WasmBridge/DataView decoder/FrameState public surface로 연결했다.
- [x] authored collision presentation side effect가 actor/source entity handle, world position, 기본 intensity/radius payload를 `EffectEvent`로 함께 enqueue한다.
- [x] TS `effectDispatchesForEvents(...)`/`dispatchEffectEvents(...)` frame-end helper를 추가해 `EffectEvent`를 sound/particle/cameraShake/custom handler target으로 라우팅할 수 있게 했다.
- [x] `CreateEngineOptions.effectEvents` opt-in runtime hook과 `createEffectEventDispatchTarget(...)` factory를 추가해 browser runtime에서 audio/particle/camera/custom target으로 자동 dispatch할 수 있게 했다.
- [x] `assetValidation: "error"` runtime option을 추가해 loaded sound id, registered particle preset id, missing validator 상태를 frame-end diagnostic으로 검증한다. camera/custom handler 누락은 기존 `missingHandler: "error"` policy로 검증한다.
- [x] `collisionEmitEffect.intensity/radius` authoring payload와 `configureCollisionEmitEffect` command/API, Rust authoring setter를 추가해 `EffectEvent` detail buffer의 intensity/radius를 직접 설정할 수 있게 했다. 미지정 시 기존 기본값 `1.0`/`0.0`을 유지한다.

검증:

- TS decoder test
- renderer/audio smoke
- effect missing asset validation

### 6단계: Agent-First Template 적용

- `packages/create-game` starter template에 object/projectile/weapon authoring 예제를 추가한다.
- `packages/agents/templates/**`의 consumer agent 지침에 builder/spec 수정 및 검증 루프를 추가한다.
- docs/engine 문서에 확정 API를 옮긴다.

현재 반영:

- [x] `packages/create-game/templates/minimal`에 `ProjectileDefinition`/`WeaponDefinition` 기반 `standard`/`piercing`/`bounce` weapon profile 예제를 추가했다. 생성 프로젝트는 public `compileWeaponProfiles(...)`와 `behaviorRecipeCommandsForEntity(...)`만 사용해 selected profile을 built-in player에 적용하고, `?profile=` query로 같은 Rust core에서 variant를 교체할 수 있다.
- [x] minimal template harness와 create-game package check가 projectile/weapon authoring surface를 machine-readable report와 replay summary에 포함하도록 보강됐다.
- [x] `packages/agents/templates/**` consumer harness/skill에 projectile/weapon authoring loop를 추가했다. consumer agent는 `ProjectileDefinition`/`WeaponDefinition` data를 public `compileWeaponProfiles(...)`/`behaviorRecipeCommandsForEntity(...)`로 컴파일하고, public runtime facade `applyGameplayBehaviorCommands(...)`/`setInputActionBinding(...)`/`builtInShooterPlayerHandle()`로 적용한 뒤 authoring/replay/smoke report를 확인하도록 안내한다.
- [x] agents package QA가 consumer template에서 projectile/weapon authoring helper와 runtime apply helper 문구가 빠지면 실패하도록 보강됐다.
- [x] package consumer smoke가 `@ferrum2d/create-game` tarball로 생성한 프로젝트에 `@ferrum2d/agents init`을 실제 적용하고, 설치된 Codex/Claude/Gemini consumer 파일, projectile/weapon authoring contract, minimal authoring/replay report, public import/type smoke, production build를 함께 검증하도록 확장됐다.
- [x] package consumer smoke가 `minimal`뿐 아니라 `topdown`/`platformer` 템플릿에서도 실제 agents 설치, authoring/replay/runtime-replay report, public import/type smoke, production build를 검증하도록 확장됐다. `topdown` runtime replay fixture는 현재 built-in shooter snapshot ABI에 맞춰 갱신됐고, `platformer` replay coverage도 exact contract로 고정 검증한다.
- [x] package consumer smoke가 성공/실패 모두에서 `consumer-smoke-report.json` machine-readable summary를 생성할 수 있도록 보강됐다. `--artifact-dir` 사용 시 tarball, tool consumer, generated game snapshot을 `node_modules`/`dist` 없이 보존하고, 템플릿별 agents 설치/authoring/replay/runtime-replay/build 결과와 topdown drift rejection 결과를 요약한다.
- [x] CI consumer smoke가 `consumer-smoke-report.json` 계약을 `pnpm validate:consumer-smoke-report`로 검증하고, 성공/실패 모두 tarball과 경량 consumer snapshot artifact를 업로드하도록 연결됐다.
- [x] `pnpm smoke:consumer-smoke-report`가 초기 실패 report, 템플릿 중간 실패 report, 오염된 snapshot 실패를 synthetic artifact로 검증해 failed report validator 경로를 CI에서 고정한다.

검증:

- create-game scaffold smoke
- package check
- consumer import smoke

## 완료 기준

이 로드맵은 다음 조건을 만족하면 planning에서 제거하거나 확정 문서로 이관한다.

- starter-runtime에서 일반탄, 유도미사일, 폭발탄을 Rust core 수정 없이 TS/spec로 정의한다.
- Rust에는 게임별 projectile 이름이 추가되지 않고 범용 motion/impact/query/reaction만 남는다.
- TS builder와 JSON spec이 같은 validation/compile path를 사용한다.
- frame hot path에 entity별 JS/Wasm callback이 없다.
- replay/smoke에서 projectile, explosion, effect event가 deterministic하게 검증된다.
- public API, architecture, smoke 문서가 확정 계약으로 갱신된다.

## 리스크와 결정 필요 사항

- 범용 prefab system을 너무 크게 열면 MVP 범위를 넘어설 수 있으므로 projectile/weapon/use-case부터 제한적으로 시작한다.
- `areaDamage`, `knockback`, `spawnPrefab`의 실행 순서가 gameplay 결과에 영향을 주므로 deterministic ordering을 명시해야 한다.
- TS builder와 JSON spec을 동시에 제공하면 중복 validation이 생길 수 있으므로 내부 resolved definition을 하나로 유지해야 한다.
- effect event buffer ABI는 Rust size function, TS decoder, tests를 같은 변경으로 수정해야 하며, 이후 payload 확장 시 `DataView` decoder와 public docs를 함께 갱신해야 한다.
- complex physics 기능으로 확장하지 않도록 Physics Spec 범위와 product scope를 계속 분리해야 한다.
- 세력 관계를 entity별 `damage_mask`로 계속 둘지, 세션 단위 `FactionRelationTable`로 승격할지는 별도 ABI/API 설계가 필요하다. 이 변경은 Behavior Recipe 문법, Wasm setter, 충돌 gate, replay hash까지 영향을 주므로 단순 리팩터링이 아니라 후속 설계 단위로 다룬다.

## 다음 작업 후보

1. [x] 기존 `projectileAction`/`collisionReaction` 계약을 기반으로 `ProjectileDefinition` TS type 초안을 작성한다.
   - 반영: `packages/ferrum-web/src/projectileAuthoring.ts`(타입 유지), `examples/topdown-shooter/src/main.ts`(타입 객체 기반 weapon profile 적용).
2. [x] starter-runtime에 현재 엔진으로 가능한 projectile variant demo를 추가한다.
   - 반영: `examples/starter-runtime/src/main.ts`(builder 기반에서 `WeaponDefinition`/`ProjectileDefinition` 객체로 정리, standard/piercing/bounce variants 유지).
3. [x] Rust `World`의 bullet-specific storage를 prefab/component 기반으로 옮길 최소 변경 범위를 산정한다.
4. [x] `effectId` 기반 presentation event buffer의 ABI 초안을 작성한다.
5. [x] 유도미사일과 폭발탄을 각각 motion/impact primitive 조합으로 검증할 replay fixture를 설계한다.
   - 반영: `projectile-homing-nearest-tag` committed replay fixture는 유도미사일 motion/impact primitive 조합을 regression gate로 채택했다. `projectile-area-damage-entity-impact` committed replay fixture는 `collisionAreaDamage + collisionEmitEffect + collisionDespawn + accelerate` 조합으로 entity-impact 폭발탄을 regression gate로 채택했다.
6. [ ] 세션 단위 `FactionRelationTable` 설계 여부를 결정한다.
   - 후보 범위: TS authoring relation spec, Rust relation table storage, existing `GameplayFaction` compatibility path, damage gate/replay hash migration, public docs.

## 후보 4 산정 결과: effectId 기반 presentation event ABI 초안

1. 현재는 gameplay 이벤트가 `sound/particle` 등을 직접 해석하거나 고정 경로로 제한되어 있어, presentation layer로의 전달을 위한 고정된 `effectId` 정합 경로가 없다.
2. 최소 변경 목표는 `Rust gameplay event -> TS event decoder -> registry lookup` 1단계 고정 구조로 만들고, `effectId`를 런타임 전송 payload의 핵심 키로 표준화하는 것이다.
3. 제안하는 기본 ABI는 단일 `EffectEvent` 계열 버퍼/리스트를 추가한다.
   - `type`: `enum`으로 playback type(예: `Particle`, `Sound`, `ScreenShake`, `Decal`, `CameraFlash`) 구분
   - `effectId`: TS가 소유한 presentation registry의 정수 키(프레임 고정)
   - `position`: `x/y` (옵션, world-space)
   - `radius`: 폭발 반경 등 optional 스칼라
   - `intensity`: 소리/진동/진한 정도 등 optional 스칼라
   - `targetEntity`: optional 대상 엔티티 handle(정수)
   - `sourceEntity`: optional 발화/발생 주체 엔티티 handle(정수)
   - `ttlMs`/`life`: presentation만 필요한 수명(필요 시)
4. Rust 변경은 기존 gameplay 이벤트 생성 지점에서 `EffectEvent` enqueue를 병행하는 형태로 시작한다.
   - 1차 구현은 호환성을 위해 기존 audio event buffer와 particle spawn 경로를 유지하면서 `EffectEvent` detail buffer도 함께 생성한다.
   - enqueue-only 전환은 TS frame-end adapter와 smoke 검증이 붙은 뒤 별도 slice로 결정한다.
5. TypeScript 변경은 registry 중심으로 고정:
   - `effects.json`/`effect` builder가 `effectId`를 생성/캐싱
   - `effectId` 미정의 시 게임 시작 validate 실패 또는 개발 모드 warning (운영 모드에서는 안전 no-op)
   - decoder는 event type별 adapter로 `particle`, `audio`, `camera`로 라우팅.
6. hot path 제약 준수:
   - `EffectEvent` 생성은 gameplay loop의 결정 지점에서만 수행(기존 이벤트 생성과 동일 위치), `entity별 JS callback`은 만들지 않음.
   - TS측 처리도 request rate가 낮은 event batch 기반으로 frame drain.
7. deterministic replay/기록성:
   - `effectId`, `type`, `position`, `intensity`, `radius`, `target/source` 순으로 정규화해 해시/스냅샷 재현성에 포함.
   - 재생 시 playback ordering은 이벤트 생성 순서를 그대로 보존.
8. 최소 영향 파일:
   - Rust: `crates/ferrum-core/src/components/gameplay.rs`, `crates/ferrum-core/src/engine/gameplay_authoring.rs`, `crates/ferrum-core/src/gameplay.rs`, `crates/ferrum-core/src/world/snapshot.rs`(필요 시)
   - TS: `packages/ferrum-web/src/` 이벤트 decoder/registry 경로
   - docs: `docs/development/quality/smoke-check.md`의 event hash 항목 동기화
9. 구현 순서:
   - 1단계: `EffectEvent` ABI와 `effectId` 값 스키마 문서화 및 Rust/TS buffer bridge 추가(완료).
   - 2단계: TS frame-end audio/particle/camera shake adapter와 registry validation 추가.
   - 3단계: smoke에서 동일 seed 하의 effect payload hash 정합 테스트 추가.
10. 산정 결론: 4번은 5단계(Impact/Area Damage) 구현과 동시 병행 가능하며, 선행 문서 동기화 후 4a) 이벤트 스키마/bridge, 4b) frame-end adapter, 4c) smoke route의 3개 slice로 쪼개는 것이 리스크가 낮다.

## 후보 5 산정 결과: 유도미사일/폭발탄 replay fixture 설계

1. 목표는 `seed + 입력 시퀀스 + 스폰 조건`이 동일할 때 실행 결과와 해시가 항상 재현되는 검증 체계를 갖는 것이다.
2. 최소 2개 시나리오를 기준으로 작성한다.
   - `homing_missile.fixture`
     - `launch`: 플레이어/타깃 배치 고정, 쿨다운 기반 스폰 스케줄 고정.
     - `motion`: `seekTarget` + `turnRate clamp` + `maxSpeed`.
     - `impact`: `damage + emitEffect + destroySelf` 순환형 action.
     - 기대값: lock-on 시작 시점, 선회 각속도 범위, 목표 충돌 프레임, 생존/데미지 로그.
   - `explosive_projectile.fixture`
     - `launch`: 선형 발사 + 고정 lifetime 기반 소멸.
     - `impact`: `areaDamage + emitEffect + destroySelf`.
     - 기대값: 반경 내 hit 대상 count, 거리 가중(또는 균등) 피해 합계, effect 이벤트 순서.
3. fixture 구조는 최소 공통 헤더 + 시나리오 payload로 통일한다.
   - 공통 헤더: `seed`, `dt`, `fixedStep`, `worldBounds`, `entityIds`, `factionMap`.
   - 시나리오: `prefabRegistry`, `behaviorVariant`, `spawnPlan`, `expectedEvents`.
4. 비교 규격(Oracle)은 3축으로 분리한다.
   - Determinism: 스텝별 `worldStateHash` 정합.
   - Trajectory: frame 단위 transform의 quantized 좌표 diff max 1e-4 이내.
   - Combat/Event: `spawn/despawn`, `damage`, `effectId`, `effectPayload`의 이벤트 순서 정합.
5. 수용 가능한 오차/허용 범위를 문서화한다.
   - trajectory는 `position/velocity` 양자화 오차 ±`1e-4`.
   - 정수 기반 event payload는 strict equal.
   - 이벤트 총 개수 mismatch는 fail.
6. 테스트 배치(안전한 구현 순서)
   - 1단계: fixture 스펙과 expected 포맷 확정.
   - 2단계: 테스트 러너가 fixture를 읽어 replay 실행.
   - 3단계: 기존 projectile fixture(기존 탄도 기본치)와 함께 regression baseline 유지.
   - 4단계: 3번/4번 변경이 들어온 뒤 하위 호환 회귀 비교.
7. 후보 5 결과:
   - 유도미사일 쪽은 `tests/fixtures/gameplay-golden/projectile-homing-nearest-tag-replay.json`와 `projectileHomingNearestTag` runner로 replay regression gate에 채택했다.
   - 폭발탄 쪽은 `tests/fixtures/gameplay-golden/projectile-area-damage-entity-impact-replay.json`와 `projectileAreaDamageEntityImpact` runner로 entity-impact `areaDamage`/effect/despawn 조합을 replay regression gate에 채택했다. tile impact 폭발 중심점은 Rust runtime 단위/scene 테스트로 먼저 고정했고, committed replay fixture 확대는 후속으로 둔다.

## 후보 3 산정 결과: World bullet storage → prefab/component 최소 변경 범위

1. 이전 구조에서 bullet 하드코딩 경로는 `world.rs`의 bullet 전용 필드(`bullet_lifetimes`, `projectile_collision_targets`, `projectile_tile_impacts`), `world/spawning.rs`의 bullet 전용 request/스폰 함수, `shooter_scene/runtime/spawn.rs`의 prefab 제약(`ShooterPrefabKind::Enemy`), `components/gameplay.rs`의 projectile 열거형 코드셋이었다.
2. 최소 변경으로는 "대체 경로 병행"이 안전하다. 기존 `spawn_bullet*` API는 유지하면서 내부 구현만 prefab/component 흐름으로 위임하고, 신규 path에서 prefab 기반 스폰을 사용한다.
3. 핵심 변경 우선순위는 1) `World` 공용 storage 설계/맵핑, 2) `GameplayAction::Projectile` 스폰 데이터의 payload 확장, 3) `prefab_id` 제약 완화, 4) snapshot hash에 prefab 구성 재현성 반영이다.
4. 단계별 변경 범위는 다음이다.
5. 1단계: `World` 인터페이스는 `GameplayLifetime`/`ProjectilePolicy` 공통 component storage를 추가하고, 기존 bullet 벡터는 읽기 호환용 뷰로 남겨 새 storage를 shadow write한다.
6. 2단계: `spawning.rs`에서 `ProjectileSpawnRequest`를 `PrefabEntitySpawnRequest`에 라우팅한다. 기존 `spawn_bullet`, `spawn_bullet_with_lifetime`, `spawn_bullet_from_template`는 호환 wrapper로 유지한다.
7. 3단계: 런타임 쿼리/스폰 플랜 경계 정리. `ShooterPrefabKind`의 `Enemy`/`Bullet` 제약은 `ShooterPrefabRegistry` resolver와 resolved `CollisionLayer` support check 경계에 남기고, dispatch는 prefab component bucket 기반 request로 통합한다.
8. 4단계: snapshot/재생결과 안정화. built-in Shooter snapshot version `15`는 prefab registry canonical payload에 layer/template/texture/gameplay bucket을 포함한다.
9. 5단계: 0~1단계 회귀 체크(기본 사격/관통/튕김탄 3개 케이스) 먼저 통과 후, 단계별로 bullet path/legacy path를 A/B 비교하여 동작 일치 확인 후 legacy 삭제를 검토한다.
10. 구현 대상 파일은 `crates/ferrum-core/src/world.rs`, `crates/ferrum-core/src/world/spawning.rs`, `crates/ferrum-core/src/gameplay.rs`, `crates/ferrum-core/src/shooter_scene/runtime/spawn.rs`, `crates/ferrum-core/src/shooter_scene/config.rs`, `crates/ferrum-core/src/world/snapshot.rs`로 국한된다.
11. 산정 결론: 3번 후보의 최소 완성도는 한 번에 완전 이행보다 5단계 병행 마이그레이션으로 시행하고, 기존 bullet API 삭제는 마지막 단계에 별도 스펙 승인 후 수행한다.
