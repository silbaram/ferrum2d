# Runtime Extensibility

이 문서는 Ferrum2D의 런타임 확장성 고도화로 추가된 범용 기능을 확정 계약 기준으로 정리한다. 목표는 Top-down Shooter 같은 특정 장르의 하드코딩을 늘리는 것이 아니라, **Rust core 범용 실행 primitive + TypeScript authoring facade + AI agent 검증 루프**로 여러 2D 게임 규칙을 조합할 수 있게 하는 것이다.

## 요약

추가된 기능은 다음 네 층으로 나뉜다.

| 층 | 추가된 기능 | 역할 |
| --- | --- | --- |
| Rust core | prefab/component registry, projectile motion/query, collision reaction, effect event buffer | 실제 frame update와 game state mutation을 실행한다. |
| TypeScript authoring | projectile/weapon builder, Behavior Recipe command, presentation effect registry | 게임 규칙을 serializable data와 numeric command로 컴파일한다. |
| Template/agent | create-game template, consumer agent/skill, generated project reports | AI agent가 새 게임 프로젝트에서 같은 contract를 수정/검증하게 한다. |
| 검증 | gameplay replay, template report smoke, package consumer smoke, CI report validator | 변경이 deterministic하고 package consumer에서 동작하는지 확인한다. |

이 구조에서 TypeScript builder는 runtime simulation object가 아니다. TypeScript는 낮은 빈도 authoring/apply 경로에서 Rust에 숫자형 command를 설치하고, 매 프레임 이동/충돌/피해/스폰/이펙트 결정은 Rust가 수행한다.

```text
TypeScript builder/spec
  -> validation
  -> BehaviorRecipeCommand / numeric runtime id
  -> Rust component storage
  -> Rust frame update
  -> render/audio/gameplay/effect buffers
  -> TypeScript renderer/audio/VFX adapters
```

## Projectile And Weapon Authoring

`projectile(...)`, `weapon(...)`, `compileWeaponProfiles(...)`가 package public entrypoint에 추가됐다.

| API | 용도 |
| --- | --- |
| `projectile(id)` | speed, damage, lifetime, aim, collision target, tile impact 같은 projectile definition을 만든다. |
| `weapon(id)` | action id, cooldown, fired projectile을 묶은 weapon definition을 만든다. |
| `compileWeaponProfiles(definitions, options)` | weapon/projectile definition을 `BehaviorRecipeDocumentSpec`으로 컴파일한다. |
| `behaviorRecipeCommandsForEntity(document, entityId)` | 특정 entity에 적용할 runtime command를 추출한다. |

예시는 `packages/create-game/templates/minimal`에 들어 있다. generated minimal project는 `standard`, `piercing`, `bounce` profile을 같은 Rust core에 설치하고, `?profile=piercing` 또는 `?profile=bounce` query로 projectile behavior를 바꾼다.

```ts
const profiles = compileWeaponProfiles([
  weapon("standard")
    .action("primary")
    .actionId(1)
    .cooldown(0.18)
    .fire(projectile("standard-shot").speed(520).damage(1).lifetime(1.8)),
  weapon("piercing")
    .action("primary")
    .actionId(1)
    .fire(projectile("piercing-shot").speed(480).tileImpact("passThrough")),
]);
```

## Generic Prefab And Component Runtime

Projectile spawn은 기존 bullet-specific storage에서 prefab/component 기반 path로 이전됐다. built-in compatibility는 유지하지만, runtime 내부는 prefab id와 component bucket을 기준으로 처리한다.

| 기능 | 계약 |
| --- | --- |
| `ShooterPrefabRegistry` | Player/Enemy/Bullet/Runtime prefab registration과 alias id를 관리한다. |
| component bucket | transform, sprite/template/texture, collision layer, gameplay component source를 canonical payload로 묶는다. |
| projectile spawn payload | speed, damage, lifetime, aim, collision target, tile impact를 prefab spawn command와 함께 보존한다. |
| snapshot version 15 | prefab registry component bucket과 projectile source faction metadata를 save/replay hash에 포함한다. |

spawn은 frame 중간에 즉시 `World` 구조를 바꾸지 않고 pending spawn queue를 통해 처리한다. unsupported prefab, blocked placement, capacity full은 cooldown을 소비하지 않는 실패로 보고된다.

## Motion And Target Query

Projectile과 단순 object movement는 범용 `MovementPattern` primitive로 실행된다.

| Motion | 지원 상태 | 설명 |
| --- | --- | --- |
| `linear` | 완료 | 기존 projectile velocity fallback과 authored linear movement를 처리한다. |
| `seekTarget` | 완료 | Rust frame loop가 target query를 평가하고 turn-rate/speed를 적용한다. |
| `accelerate` | 완료 | 가속/감속 projectile movement를 처리한다. |

지원하는 target query preset은 다음과 같다.

| Preset | 설명 |
| --- | --- |
| `nearestPlayer`, `nearestEnemy` | built-in shooter compatibility target |
| `nearestLayer:player|enemy|bullet|wall|pickup` | collision layer 기반 nearest query |
| `nearestFaction:neutral|player|enemy|<0..31>` | Rust `GameplayFaction` 기반 nearest query |
| `nearestTag:<tagName>|<0..31>` | Rust `GameplayTags` bitmask 기반 nearest query |

`nearestFaction:*`와 `nearestTag:*`는 `World` 내부 derived index bucket을 먼저 순회하고, stale handle 방어를 위해 live component와 transform 존재를 다시 확인한다. 이 index는 public ABI에 노출되지 않고 component setter, spawn/despawn, snapshot restore, authoring rollback restore에서 동기화된다.

## Collision Reaction Pipeline

충돌 처리도 bullet hardcode 대신 authored reaction list로 확장됐다.

| Reaction | 적용 범위 | 설명 |
| --- | --- | --- |
| `collisionDamage` | entity impact | 단일 대상 피해와 faction gate를 처리한다. |
| `collisionAreaDamage` | entity impact, tile impact | radius query로 direct/splash damage, score/death telemetry를 만든다. Tile impact는 swept contact point를 중심으로 사용한다. |
| `collisionKnockback` | entity impact | self/other velocity impulse를 additive로 적용한다. |
| `collisionSpawnPrefab` | entity impact | registered prefab spawn을 pending queue에 적재한다. |
| `collisionDespawn` | entity impact, tile impact self | source/target despawn을 deferred queue로 처리한다. |
| `collisionSound`, `collisionParticle` | presentation side-effect | built-in audio/particle side effect를 emit한다. |
| `collisionEmitEffect` | presentation side-effect | `presentationEffect` gameplay event와 `EffectEvent` detail buffer를 생성한다. |

reaction execution order는 deterministic하다. Source reaction set slot order를 먼저 실행하고, entity/entity collision에서는 reversed pair의 other reaction set을 이어 실행한다. Tile impact는 source reaction set만 실행한다. `passThrough` tile impact는 blocking tile reaction을 실행하지 않는다.

## Authoring Apply Safety

gameplay authoring setter는 scene load, agent apply, FSM state command apply 같은 낮은 빈도 경로에서 Rust component 값을 주입한다. 단순 component setter는 fixed timestep accumulator, previous input sample, collision lifecycle history 같은 physics timeline state를 초기화하지 않는다. 전체 slot rollback에 가까운 `restore_gameplay_authoring_snapshot(...)`만 physics history를 초기화한다.

고정 배열 기반 gameplay collection은 runtime heap allocation을 피하기 위해 계속 bounded storage를 사용한다. 현재 collision reaction slot은 entity당 8개, FSM transition과 state-enter action slot은 각각 entity당 16개다. authoring insert/upsert는 전체 `Option` slot을 compact한 뒤 중복과 가용 slot을 확인하므로 snapshot/rollback 경로에서 sparse slot이 생겨도 다음 authoring 변경에서 조밀한 순서를 회복한다.

TypeScript `applyGameplayBehaviorCommands(...)` facade는 raw Wasm setter가 `false`를 반환하면 JSON path가 포함된 gameplay authoring diagnostic을 throw한다. 메시지는 command type, entity key, stale handle, invalid runtime id/value, unsupported prefab, capacity limit 같은 주요 원인 후보를 포함한다.

## Effect Event Pipeline

`EffectEvent` buffer는 gameplay result와 presentation playback을 분리한다.

| 항목 | 설명 |
| --- | --- |
| Rust payload | `effectId`, position, intensity, radius, source/target entity metadata를 bulk buffer로 기록한다. |
| TypeScript decoder | `FrameState.effectEvents`와 `FrameState.effectEventBuffer`로 노출한다. |
| Registry | `resolvePresentationEffectRegistry(...)`, `bindPresentationEffectActions(...)`가 named effect를 numeric id로 연결한다. |
| Runtime hook | `CreateEngineOptions.effectEvents`를 켜면 frame-end dispatch가 audio/particle/camera/custom target으로 라우팅한다. |
| Asset validation | `assetValidation: "error"`는 missing sound/particle/custom handler를 diagnostic으로 보고한다. |

`EffectEvent`는 gameplay state를 바꾸지 않는다. Rust는 event를 enqueue하고, TypeScript는 frame-end adapter에서 browser/audio/VFX side effect만 실행한다.


## Breakout Authoring Convergence Proof

P2 `범용 authoring 경로 수렴·입증`의 첫 Breakout slice는 built-in Breakout scene의 public `useBreakoutGame()` API와 render/audio/event buffer layout을 유지하면서 Rust core 내부 조립 경로를 prefab/component/reaction primitive로 옮기는 방식으로 진행한다. 이 proof는 create-game/template로 공개하기 전 단계의 runtime proof이며, frame hot path에 entity별 JS/Wasm callback을 추가하지 않는다.

현재 proof 범위:

| 항목 | 상태 | 계약 |
| --- | --- | --- |
| prefab/component spawn | 완료 | paddle, ball, wall, brick body는 `PrefabEntitySpawnRequest`/`EntityTemplate` 기반으로 생성한다. |
| paddle movement component | 완료 | paddle speed는 `MovementPattern::TopdownInput` component에 저장하고 Breakout runtime은 x축 clamp만 scene rule로 유지한다. |
| brick gameplay metadata | 완료 | ball damage, brick health, brick score reward를 component로 저장한다. |
| brick damage/score/despawn | 완료 | brick hit는 shared collision damage helper로 health/score/despawn outcome을 계산한다. |
| brick particle side effect | 완료 | brick에 authored `CollisionReaction::SpawnParticle`를 설치하고 shared side-effect evaluator를 통해 기존 particle sink로 dispatch한다. |
| bounce response | 완료(내부 primitive) | wall/brick surface bounce와 paddle contact-offset bounce는 generic velocity reflection helper를 사용한다. |
| swept hit selection | 완료(내부 primitive) | ball의 earliest swept AABB hit는 scene-neutral swept kinematic helper로 계산하고, Breakout은 target role ordering만 제공한다. |
| create-game 연결 | proof only | 아직 consumer template/schema로 공개하지 않고, Breakout unit tests와 runtime-extensibility 문서가 proof contract를 고정한다. |

후속으로 create-game template/schema에 공개하려면 `breakout` template 추가, replay fixture, package consumer smoke allowlist, docs/public API 문서 갱신을 별도 논리 변경으로 진행한다.

## Agent-First Template And Package QA

AI agent가 consumer project에서 같은 범용 contract를 사용할 수 있도록 package/template 검증이 확장됐다.

| 영역 | 추가된 기능 |
| --- | --- |
| `packages/create-game/templates/minimal` | projectile/weapon profile authoring example, authoring/replay report, runtime replay fixture |
| `packages/agents/templates/**` | Codex/Claude/Gemini consumer agent/skill/command template에 projectile/weapon authoring loop와 검증 명령 반영 |
| `pnpm package:consumer-smoke` | create-game tarball로 generated project 생성, agents init 실제 적용, public import/type smoke, authoring/replay/runtime replay/build matrix 검증 |
| `consumer-smoke-report.json` | success/failure status, tarball, template checks, agents install, replay/runtime replay summary, topdown drift rejection 결과를 machine-readable JSON으로 기록 |
| `pnpm validate:consumer-smoke-report` | CI artifact의 report/tarball/snapshot contract를 검증 |
| `pnpm smoke:consumer-smoke-report` | early failure, partial failure, dirty snapshot synthetic artifact로 failed report validator를 검증 |

CI consumer smoke는 성공/실패 모두 `artifacts/consumer-smoke`를 업로드하고, smoke outcome에 맞춰 report validator를 실행한다.

## 검증 기준

기능 변경 후 범위에 맞춰 다음 검증을 사용한다.

| 명령 | 검증 대상 |
| --- | --- |
| `pnpm smoke:gameplay-replay` | homing missile, explosive projectile, tile impact area damage 등 committed gameplay replay fixture |
| `pnpm smoke:create-game-template-reports` | create-game template authoring/replay/runtime-replay report envelope |
| `pnpm smoke:topdown-template-replay-report` | generated topdown template replay drift/recovery contract |
| `pnpm package:consumer-smoke` | local tarball install, generated project build, agents install, public import/type smoke |
| `pnpm validate:consumer-smoke-report` | consumer smoke artifact report contract |
| `pnpm smoke:consumer-smoke-report` | failed report validator path |
| `pnpm smoke:mass-objects` | 1,000개 이상 enemy/projectile Rust frame path와 collision pair budget 회귀 |
| `pnpm smoke:topdown-mass-objects` | 1,024개 Top-down Shooter enemy snapshot restore와 WebGL2 render command budget |
| `pnpm package:check` | package allowlist, tarball contents, generated Wasm artifact |

Rust/Wasm/API 변경은 `cargo fmt`, `cargo clippy`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml`, `pnpm build`까지 함께 확인한다.

## 완료 상태와 후속 선택 항목

런타임 확장성 고도화의 핵심 구현은 완료됐고, 이 문서가 planning 로드맵을 대체하는 확정 기준이다.

완료된 기준:

- Rust core는 prefab/component registry, projectile motion/query, collision reaction, area damage, `EffectEvent`를 frame loop 안에서 실행한다.
- TypeScript authoring은 projectile/weapon, Behavior Recipe, presentation effect 정의를 serializable data와 numeric command로 compile한다.
- frame hot path에는 entity별 JS/Wasm callback을 추가하지 않고, render/audio/gameplay/effect/debug/profiler output은 bulk buffer 또는 telemetry로 전달한다.
- gameplay replay, mass object smoke, Top-down browser mass smoke, template report smoke, package consumer smoke가 regression gate를 제공한다.
- Public API는 `docs/engine/public-api.md`, architecture boundary는 `docs/development/architecture/architecture.md`, smoke 기준은 `docs/development/quality/smoke-check.md`를 따른다.

후속 선택 항목:

- starter-runtime에서 homing missile/explosive projectile demo profile을 더 직접 보여주기. 핵심 primitive 검증은 committed gameplay replay에 있으므로 demo polish로 취급한다.
- query result debug buffer로 nearest target 선택 결과를 bulk telemetry에 노출하기.
- 세션 단위 `FactionRelationTable` 설계 여부 결정. TS relation spec, Rust relation table storage, 기존 `GameplayFaction` compatibility, damage gate, replay hash migration까지 영향을 주는 별도 ABI/API 설계 단위다.
