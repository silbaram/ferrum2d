# Gameplay Authoring 고도화 방향

이 문서는 적 행동 패턴, 사물 이동 패턴, 충돌 반응을 Ferrum2D에서 더 확장성 있게 개발하기 위한 planning 문서다. 현재 구현된 Top-down Shooter, Breakout, Platformer의 사용법과 public contract는 `docs/engine` 문서를 기준으로 하며, 이 문서에는 gameplay authoring 고도화 방향과 완료된 vertical slice의 결정 기록을 함께 남긴다.

## 배경

현재 Ferrum2D의 gameplay hot path는 Rust core가 소유한다. TypeScript는 입력 snapshot, asset id, renderer/audio/browser API를 담당하고, 매 프레임에는 Rust `Engine::update_frame(...)`을 호출한 뒤 render/audio/debug buffer를 bulk로 읽는다.

Top-down Shooter 기준으로 실제 행동은 `ShooterScene` runtime에 직접 구현되어 있다.

```text
ShooterScene::update_internal(...)
  -> tick_playing_timers(...)
  -> advance_wave_if_needed(...)
  -> apply_player_movement_input(...)
  -> apply_player_actions_with_input(...)
  -> process_action_triggers(...)
  -> flush_pending_spawns_with_events(...)
  -> apply_enemy_movement_phase(...)
  -> world.update(...)
  -> tilemap.resolve_dynamic_collisions(...)
  -> update_bullets(...)
  -> spawn_enemy_if_needed(...)
  -> handle_collisions(...)
```

이 구조는 MVP와 기준 예제에는 단순하고 빠르다. 그러나 새 적 행동, 이동 패턴, 충돌 반응이 계속 늘어나면 enum/match, scene 전용 함수, Game Spec 적용 코드, 문서/schema/test가 함께 증가한다. 엔진 개발자는 확장할 수 있지만, 게임 개발자가 데이터만으로 다양한 행동을 조합하기에는 아직 authoring surface가 좁다.

## 판단

현재 방향 중 유지해야 할 점은 다음이다.

- 게임 상태, 엔티티, 충돌, 물리, render/audio command 생성은 Rust core가 소유한다.
- TypeScript는 브라우저 API와 낮은 빈도 authoring 검증/적용을 담당한다.
- hot path에서 entity별 JS/Wasm callback을 만들지 않는다.
- render/audio/collision/debug 결과는 bulk buffer로 전달한다.

보완해야 할 점은 다음이다.

- 행동 패턴 추가가 Shooter scene 전용 코드에 묶여 있다.
- `behaviorRecipes`는 TypeScript 검증과 command 변환까지는 있으나, Rust gameplay runtime의 일반 component/system으로 깊게 연결되어 있지 않다.
- 충돌 반응이 `handle_collisions(...)` 같은 장르별 함수에 하드코딩되어 있다.
- 행동 종류가 늘면 world scan과 broadphase 호출이 여러 system에 중복될 수 있다.

## 목표 방향

Unreal식 per-Actor Tick이나 JS 사용자 scripting runtime으로 가지 않는다. Ferrum2D의 목표는 Rust hot path를 유지하면서 AI agent가 수정하기 쉬운 spec, schema, validation, smoke check를 제공하는 것이다.

목표 구조는 다음과 같다.

```text
Game Spec / Behavior Spec
  -> TypeScript validation / asset id resolution
  -> Rust component data 적용
  -> Rust gameplay systems 실행
  -> collision event / reaction 처리
  -> render/audio command buffer 생성
```

즉 `ShooterScene` 전용 함수에 박힌 규칙을 점진적으로 다음과 같은 데이터 기반 component/system으로 옮긴다.

| 영역 | 예시 |
| --- | --- |
| Movement pattern | `topdownInput`, `linear`, `chase`, `flee`, `orbit`, `patrol`, `sine`, `dash`, `homing` |
| Action pattern | `projectile`, `melee`, `dash`, `spawnPrefab`, `interact`, `toggleState` |
| Lifetime/state | `ttl`, `cooldown`, `health`, `damage`, `scoreReward`, `faction` |
| Collision reaction | `damage`, `despawn`, `pickup`, `bounce`, `triggerEvent`, `setGameState`, `playSound`, `spawnParticle` |
| Spawn pattern | `edge`, `corners`, `center`, `pointList`, `area`, `wave`, `timer` |

## 목표 동작 예시

일반 gameplay authoring의 기본 경로는 코드 callback이 아니라 검증 가능한 spec 선언이다. 다만 모든 로직을 spec만으로 표현한다는 뜻은 아니다. 사용자는 `movement`, `action`, `collision`, `FSM/BT` 같은 조합을 spec으로 선언하고, 엔진은 이를 Rust-owned built-in component/system/action primitive로 실행한다.

```json
{
  "entities": {
    "player": {
      "movement": { "type": "topdownInput", "speed": 220 },
      "actions": {
        "primary": {
          "type": "projectile",
          "cooldown": 0.12,
          "speed": 420,
          "damage": 1
        },
        "dash": {
          "type": "dash",
          "distance": 90,
          "cooldown": 1.0
        }
      },
      "health": { "max": 5 }
    },
    "enemy.runner": {
      "movement": {
        "type": "chase",
        "target": "player",
        "speed": 95
      },
      "collision": {
        "onTouch": [
          { "type": "damage", "target": "player", "amount": 1 },
          { "type": "despawn", "target": "self" }
        ]
      },
      "health": {
        "max": 1,
        "onZero": [
          { "type": "addScore", "amount": 1 }
        ]
      }
    }
  }
}
```

TypeScript는 문자열, 숫자 범위, asset reference, prefab reference를 검증하고 Rust에는 enum code와 numeric/buffer 형태로 전달한다.

```text
"topdownInput" -> MovementKind::TopdownInput
"chase"        -> MovementKind::Chase
"projectile"   -> ActionKind::Projectile
"damage"       -> CollisionReactionKind::Damage
```

Rust frame 순서는 장기적으로 다음 형태를 목표로 한다.

```text
Engine::update_frame(delta)
  -> input_action_system
  -> movement_pattern_system
  -> action_system
  -> physics/integration
  -> tilemap_collision_system
  -> collision_detection_system
  -> collision_reaction_system
  -> lifetime_despawn_system
  -> camera_system
  -> render_command_system
```

## Behavior 합성 모델 결정

위 표의 movement/action/reaction을 flat kind enum으로만 계속 늘리면 조합 폭발(complexity ceiling)에 부딪힌다. 새 조합마다 enum variant와 Rust 코드가 늘어 "데이터만으로 조합"이라는 목표를 스스로 약화시킨다. Construct event sheet가 수년 걸린 이유, Godot용 LimboAI(BT/FSM)의 존재가 같은 교훈을 준다.

- movement, collision, lifetime 같은 물리/상태 단위는 종류가 bounded하므로 component로 유지하고 Rust enum/match 명시성을 그대로 둔다.
- 그러나 의사결정/시퀀싱(언제 `chase`에서 `flee`로 바꾸는가, 조건부 action 발동)은 flat enum이 아니라 작은 behavior tree 또는 FSM 데이터로 표현한다.
- 이 BT/FSM은 JSON으로 직렬화 가능한 최소 데이터 모델이며 노드 실행은 Rust system이 담당한다. visual behavior tree editor가 아니다(제외 범위 유지). LLM이 JSON 트리를 생성·순회하기 좋다는 점이 agent-first 목표와 맞는다.

목표는 순수 flat enum(표현력 천장)과 사용자 scripting runtime(제외 범위) 사이의 의도된 중간 지점이다. 즉 스크립팅 런타임 없이도 신규 동작을 데이터로 표현하는 것이 이 결정의 핵심이다.

## Composition 모델 (prefab/variant)

목표 동작 예시의 flat `entities`는 재사용과 agent 편집에서 한계가 있다. Defold(prototype→instance), Godot scene 중첩, Bevy BSN(inheritance + patch override)는 모두 프리팹 정의 + 인스턴스 override를 중심에 둔다. Ferrum2D에는 이미 `SceneComposition`의 prefab, variant, reusable fragment, flat instance authoring helper가 있으므로 새 중복 모델을 만들지 않는다.

- 기존 `SceneComposition` 계약을 gameplay prefab/behavior binding까지 확장하는 방향으로 사용한다.
- `prefab` 정의 + `instance`별 override(patch) + `variant`를 gameplay authoring의 기본 단위로 삼는다.
- override는 전체 교체가 아니라 필드 단위 patch로 정의해 작은 차이만 데이터로 남긴다.
- 이 모델은 agent가 "기존 prefab을 복제해 한두 필드만 바꾸는" 흔한 작업을 적은 diff로 수행하게 한다.

## Agent 저작 루프

제품 목표는 agent-first이지만 schema validation만으로는 신호가 약하다. 게임 엔진 생태계에서도 MCP류 tool protocol과 editor/runtime automation 실험이 늘고 있으며, 공통 교훈은 LLM을 자유로운 코드 생성기가 아니라 구조화 커맨드와 검증 신호에 제약된 에이전트로 다뤄야 한다는 점이다. Ferrum2D도 저작 루프를 1급 산출물로 둔다.

```text
propose   : agent가 spec patch 제안
validate  : dry-run 적용으로 구조/참조/범위 검증
apply     : 검증 통과 시 component data 적용
run       : 결정적 프레임 실행
telemetry : replay diff / budget / 충돌·점수 telemetry 회수
```

- validate는 통과/실패만이 아니라 machine-actionable 진단(JSON path + 기댓값 + 수정 제안)을 반환한다. 이는 LLM에 대한 컴파일러 에러 루프 등가물이다.
- dry-run apply는 외부 상태를 바꾸지 않고 진단만 돌려주는 경로를 제공한다.
- run 단계의 신호는 smoke pass/fail보다 결정적 replay diff가 강하다(아래 결정성 섹션 참조).

## 성능 원칙

- gameplay system은 Rust 안에서 entity/component storage를 순회한다.
- JS/TS의 per-entity `onUpdate`, `onCollision`, `onTrigger` callback은 production hot path에 넣지 않는다.
- 낮은 빈도 authoring 적용은 TypeScript object/JSON을 허용하되, 프레임 루프는 숫자형 component와 scratch buffer를 사용한다.
- collision detection은 가능하면 frame당 공통 event pipeline으로 모아 broadphase/proxy 구성 중복을 줄인다.
- system별 world scan이 많아질 경우 layer/tag/component index 또는 dirty list를 도입한다.
- behavior/pattern 종류 추가는 Rust enum/match의 명시성을 유지하되, scene별 match가 아니라 공통 gameplay system의 match로 모은다.

## 결정성과 replay 검증

신규 gameplay system은 결정적이어야 한다. Unity/Godot 물리는 대체로 비결정적이지만, 저장소는 physics replay Worker와 budget smoke 인프라를 이미 갖고 있다. "데이터 기반 + 결정적 + agent 저작 + replay 검증"은 메인스트림 엔진이 갖지 못한 방어 가능한 차별점이다.

- 모든 신규 gameplay system은 동일 Wasm build, 동일 seed, fixed timestep, 동일 입력 시퀀스에 대해 canonical gameplay snapshot이 동일해야 한다(부동소수 연산 순서 고정, RNG seed 고정).
- render command, audio playback, wall-clock metric, debug overlay는 golden gameplay snapshot 범위에서 제외하고 별도 smoke/budget 검증으로 다룬다.
- scan 중 world structural mutation은 직접 수행하지 않는다. spawn/despawn, entity/component add/remove, gameplay event emission은 deferred command buffer로 모아 phase 경계에서 일괄 적용한다.
- velocity, cooldown, local timer처럼 같은 phase의 다음 system이 즉시 읽어야 하는 값은 즉시 component write를 허용한다. deferred command는 `pre-physics`, `post-collision`, `end-of-frame` 같은 phase를 명시해야 한다.
- 검증 신호로 golden replay diff를 사용한다. agent는 이 diff로 자기 변경의 회귀 여부를 smoke보다 정밀하게 판단한다.

## 단계별 계획

### 1단계: 현재 행동의 taxonomy 정리

- Shooter의 `apply_player_movement_input`, `apply_player_actions_with_input`, `apply_enemy_movement_phase`, `update_bullets`, `spawn_enemy_if_needed`, `handle_collisions`를 movement/action/lifetime/collision reaction 단위로 분류한다.
- Breakout과 Platformer에서 공통화 가능한 movement/action/reaction을 함께 분류한다.
- `behaviorRecipes`의 현재 command 종류와 Rust runtime에 필요한 component 종류를 대응표로 만든다.

완료 기준:

- planning 또는 architecture 문서에 movement/action/reaction taxonomy가 있다.
- 기존 Shooter behavior를 새 taxonomy로 모두 설명할 수 있다.

### 2단계: Rust gameplay component 최소 세트 추가

최소 범위는 새 scripting runtime이 아니라 built-in component data다.

- `MovementPattern`
- `ActionPattern` 또는 `ActionBinding`
- `Cooldown`
- `Health`
- `Damage`
- `Lifetime`
- `CollisionReaction`
- `TargetRef` 또는 tag/layer 기반 target selector

완료 기준:

- 기존 Shooter player 이동, enemy chase/orbit/static/drift, bullet lifetime을 새 component/system으로 일부 이전할 수 있다.
- public API와 Wasm ABI 변경이 있다면 size/layout 검증과 문서를 함께 갱신한다.

### 3단계: 공통 gameplay systems 도입

- `movement_pattern_system`: input/chase/orbit/patrol/homing 같은 velocity 또는 transform 갱신을 담당한다.
- `action_system`: 입력 action, cooldown, projectile spawn, dash 같은 낮은 수준 action을 담당한다.
- `lifetime_system`: TTL과 despawn queue를 담당한다.
- `collision_event_system`: layer/mask 기반 충돌 event를 공통 생성한다.
- `collision_reaction_system`: damage/despawn/pickup/event/audio/particle 같은 반응을 처리한다.

완료 기준:

- Shooter runtime의 직접 처리 함수가 공통 system 호출로 줄어든다.
- collision broadphase 호출 중복이 현재보다 증가하지 않는다.
- existing smoke가 통과한다.

### 4단계: Behavior Spec/Recipe를 runtime 적용 경로에 연결

- 현재 `behaviorRecipes`의 TS command를 Rust component 적용 command로 연결한다.
- entity/prefab 단위 recipe를 Game Spec 또는 별도 Behavior Spec에서 참조할 수 있게 한다.
- schema/validation/report가 agent가 수정하기 쉬운 오류 메시지를 제공한다.

완료 기준:

- 간단한 `health`, `damage`, `chase`, `pickup`, `interaction` recipe가 실제 runtime behavior로 반영된다.
- `pnpm validate:game-spec` 또는 신규 validation command가 recipe 구조 오류를 잡는다.
- 예제 하나가 recipe 기반 행동을 사용한다.

### 5단계: 예제와 smoke 확장

작은 예제로 기능을 분리해 검증한다.

- dash action 예제
- pickup collision reaction 예제
- patrol/chase enemy 예제
- projectile weapon 예제
- trigger zone 예제

완료 기준:

- 각 예제는 README에 확인 기술과 smoke/manual check를 가진다.
- `examples/topdown-shooter`는 장르 데모로 유지하되, 새 gameplay authoring 경로를 보여주는 대표 예제가 된다.
- `examples/topdown-shooter/public/authored-behavior.variant.json`은 메인 `game.json`과 분리된 authoring artifact로 유지하며, `SceneComposition`, `BehaviorRecipe`, `BehaviorStateMachine`, replay scenario를 한 파일에서 연결한다.

## 제외 범위

다음은 이 로드맵의 목표가 아니다.

- full visual editor
- user scripting/plugin runtime
- JS/TS per-entity update callback
- multiplayer
- Wasm threads 또는 전체 게임 루프 Worker 이전
- 복잡한 AI planner, behavior tree editor, navmesh/crowd simulation
- 외부 physics engine 의존성

## 주요 리스크

| 리스크 | 대응 |
| --- | --- |
| component 종류가 과도하게 늘어남 | Shooter/Breakout/Platformer에서 실제 공유되는 행동부터 최소 세트로 시작한다. |
| spec이 너무 복잡해짐 | recipe preset, reusable fragment, schema error message를 우선한다. |
| Rust hot path scan이 증가함 | component index, layer index, dirty list, collision event pipeline으로 중복 순회를 줄인다. |
| public API가 불안정해짐 | experimental namespace 또는 examples-only 적용 단계를 둔다. |
| 기존 예제 회귀 | 단계마다 topdown/breakout/platformer smoke를 유지한다. |
| 의사결정 표현력 한계 | flat enum 대신 의사결정/시퀀싱은 소형 BT/FSM 데이터로 표현해 조합 폭발을 피한다. |
| agent 자기수정 신호 부족 | dry-run validate가 machine-actionable 진단을 반환하고, run은 golden replay diff를 신호로 제공한다. |

## 검증 후보

- Rust core: `cargo fmt`, `cargo clippy`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
- Wasm/API: `wasm-pack build crates/ferrum-core --target web --out-dir ../../packages/ferrum-web/pkg`, `pnpm build`
- Spec: `pnpm validate:game-spec`
- 예제: `pnpm smoke:topdown`, `pnpm smoke:starter-runtime`, 관련 신규 gameplay smoke
- 성능: `pnpm smoke:topdown-budget` 또는 신규 gameplay budget smoke
- 결정성: 신규 gameplay system은 동일 Wasm build, 동일 seed, fixed timestep, 동일 입력 시퀀스에 대한 canonical gameplay snapshot/replay diff가 0이어야 한다(golden replay). `createGameplayReplayRun(...)` / `compareGameplayReplayRuns(...)`는 `GameStateSnapshot` frame sequence를 이 비교 단위로 묶고 JSON path diff를 반환한다.

## 진행 기록

### 2026-06-01: Frame input snapshot phase contract slice

Movement/action phase가 공유하는 frame input snapshot 모양을 `crate::gameplay`로 옮겼다.

- `FrameInputSnapshot`은 current input과 previous input을 하나의 value object로 묶고, production path는 `new(...)` constructor를 사용한다. `current_only(...)`는 기존 test compatibility wrapper용 constructor로만 유지한다.
- `TopdownInputMovementPhaseConfig`는 raw `InputState` 대신 `FrameInputSnapshot`을 받으며, movement phase는 `snapshot.current`만 velocity 계산에 사용한다.
- Shooter Playing frame loop는 `FrameInputSnapshot`을 한 번 만든 뒤 player movement phase와 player action phase에 같은 snapshot을 전달한다.
- 기존 `apply_player_actions_with_input(...)`/`apply_player_movement_input(...)` wrapper는 compatibility surface로 남기되 내부에서 snapshot 기반 phase helper로 위임한다.
- unit test는 snapshot이 current/previous input을 보존하고, movement phase config가 current input snapshot으로 velocity를 쓰며 stale entity를 거부하는 의미를 고정한다.

이 slice 이후 frame input pair의 데이터 모양은 Shooter runtime local 변수 두 개가 아니라 `crate::gameplay`의 phase contract로 표현된다. 다만 frame input snapshot을 언제 만들고 previous button state를 언제 갱신할지는 아직 Shooter runtime compatibility path가 소유한다. 현재 `previous` snapshot은 `InputActionRegistry`가 지원하는 edge controls(`space`/`enter`/`mouse_left`)만 이전 frame 값을 반영하고, axis/pointer 값은 current frame과 동일하게 유지한다. 향후 input action control이 axis/pointer까지 확장되면 full previous `InputState` 저장으로 승격해야 한다.

### 2026-06-01: Topdown input movement phase config slice

Player topdown input movement phase의 입력 snapshot 계약을 `crate::gameplay`로 옮겼다.

- `TopdownInputMovementPhaseConfig`는 target entity, frame input snapshot, default speed를 하나의 phase config로 묶는다. 이후 `Frame input snapshot phase contract slice`에서 이 input snapshot은 `FrameInputSnapshot` value object로 승격됐다.
- `apply_topdown_input_movement_phase(...)`는 generation-checked entity에만 `TopdownInput` movement를 적용하고, authored `MovementPattern::TopdownInput` speed가 있으면 default speed보다 우선한다.
- 기존 `run_topdown_input_movement_system(...)`은 compatibility entry point로 남기되 새 phase config helper에 위임한다.
- Shooter player movement phase는 더 이상 `entity/input/default_speed`를 개별 인자로 공통 helper에 넘기지 않고 `TopdownInputMovementPhaseConfig`를 구성해 전달한다.
- unit test는 phase config가 input snapshot을 velocity write로 전달하고 stale entity를 거부하는 의미를 고정한다.

이 slice 이후 player movement의 input snapshot 모양은 Shooter runtime local call signature가 아니라 `crate::gameplay` phase config로 표현된다. 이후 `Frame input snapshot phase contract slice`에서 movement/action이 같은 `FrameInputSnapshot`을 공유하도록 production path를 정리했다. 다만 snapshot 생성 시점과 previous button state 갱신은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: Layer movement default fallback phase config helper slice

Layer movement phase config의 default fallback 조립을 `crate::gameplay` helper로 옮겼다.

- `LayerMovementPatternDefaultFallbackConfig`는 target layer, player target transform, navigation policy, `DefaultMovementPatternConfig`를 하나의 authoring/runtime bridge 입력으로 묶는다.
- `layer_movement_pattern_phase_config_with_default_fallback(...)`는 default fallback preset을 `MovementPattern`으로 변환한 뒤 `LayerMovementPatternPhaseConfig`를 만든다.
- Shooter enemy movement phase는 active wave/config에서 읽은 speed, behavior kind, world/orbit 값을 이 helper에 넘기며, 더 이상 `default_movement_pattern(...)`을 직접 호출하지 않는다.
- unit test는 helper가 default fallback preset을 공통 phase config의 fallback `MovementPattern`으로 정확히 변환하는지 고정한다.

이 slice 이후 movement phase config 조립의 공통 모양과 fallback preset 변환은 `crate::gameplay`가 담당한다. 다만 Shooter의 active wave/config가 어떤 default preset kind를 고를지, tilemap scratch resolver를 어떻게 연결할지는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: Layer movement phase config contract slice

Layer-filtered movement pattern phase의 공통 입력 계약을 `crate::gameplay`로 옮겼다.

- `LayerMovementPatternPhaseConfig`는 target layer, player target transform, navigation policy, fallback `MovementPattern`을 하나의 phase config로 묶는다.
- `apply_layer_movement_pattern_phase(...)`는 phase config와 navigation cache, waypoint resolver만 받아 기존 stats-free layer movement batch system을 호출한다.
- Shooter enemy movement phase는 더 이상 layer/player/policy/fallback 인자를 개별로 batch system에 넘기지 않고, `EnemyMovementPhaseContext` 안의 `phase` config를 전달한다.
- test/diagnostic용 `run_layer_movement_pattern_phase(...)`는 같은 phase config 계약으로 stats를 반환해 layer filter, authored override, fallback contract, player-target chase navigation propagation을 unit test로 고정한다.

이 slice 이후 movement phase의 공통 인자 모양은 Shooter runtime이 아니라 `crate::gameplay`가 소유한다. 이후 `Layer movement default fallback phase config helper slice`에서 default fallback을 포함한 phase config 조립도 공통 helper로 이동했다. 다만 active wave/config의 fallback preset 선택과 tilemap scratch resolver wiring은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: Enemy movement phase context slice

Shooter enemy movement phase가 필요로 하는 scene-local 의존성을 `EnemyMovementPhaseContext`로 묶었다.

- `apply_enemy_movement_phase(...)`는 target layer, player target transform, navigation cache policy, fallback `MovementPattern`, tilemap waypoint resolver, navigation scratch를 한 context에서 구성한다.
- 실제 entity scan과 authored/fallback movement dispatch는 계속 stats-free `apply_layer_movement_pattern_with_navigation_batch_system(...)`에 위임한다.
- context는 stack-only Rust 구조체이며 allocation, dynamic dispatch, JS/Wasm callback, public API, Wasm ABI를 추가하지 않는다.
- 이 slice는 behavior를 바꾸지 않는다. enemy navigation target tick, active wave/config fallback 선택, tilemap waypoint/cache 사용 순서는 기존과 같다.

이 slice 이후 target `CollisionLayer` 선택과 tilemap navigation scratch 제공은 흩어진 local 변수 대신 명시적인 phase context로 드러난다. 다만 context ownership 자체는 아직 Shooter runtime compatibility path에 남아 있으며, active wave/config가 어떤 fallback preset을 선택하는지도 계속 Shooter scene이 담당한다.

### 2026-06-01: Default movement fallback pattern helper slice

Shooter enemy fallback movement를 runtime phase 내부 match에서 공통 default movement preset helper로 옮겼다.

- `DefaultMovementPatternKind`, `DefaultMovementPatternConfig`, `default_movement_pattern(...)`을 `crate::gameplay`에 추가했다.
- `EnemyBehavior`는 `default_movement_pattern_kind()`로 공통 preset kind만 선택하고, 실제 `MovementPattern` 구성은 `crate::gameplay` helper가 담당한다.
- `apply_enemy_movement_phase(...)`는 active wave/config에서 speed와 behavior를 읽고, world size/orbit config를 helper에 전달할 뿐 `Chase`/`Drift`/`Static`/`Orbit`별 `MovementPattern` match를 직접 소유하지 않는다.
- default fallback pattern helper는 `Chase(Player)`, `MoveToPoint(world center)`, `Static`, `Orbit(Player)` mapping을 unit test로 고정한다.

이 slice는 scene-level fallback을 완전히 제거하지 않는다. active wave/config가 어떤 fallback preset을 쓸지 선택하는 책임은 Shooter compatibility path에 남아 있다. 다만 fallback을 어떤 `MovementPattern` primitive로 구성할지는 공통 gameplay helper가 담당하므로, 이후 prefab/default movement binding이나 variant override로 승격할 때 runtime phase의 장르별 match를 다시 건드리지 않아도 된다.

### 2026-06-01: Enemy movement phase naming slice

Shooter frame loop의 enemy movement 호출 지점을 velocity 구현 디테일이 아니라 gameplay phase 이름으로 드러내도록 정리했다.

- production Playing frame loop는 `update_enemy_velocity(...)` 대신 `apply_enemy_movement_phase(...)`를 호출한다.
- `apply_enemy_movement_phase(...)`는 기존 enemy navigation target tick, player target transform 조회, scene fallback `MovementPattern`, layer-filtered movement batch helper 호출 순서를 유지한다.
- 기존 테스트 호환용 `update_enemy_velocity(...)` wrapper는 `#[cfg(test)]`로 좁히고 새 phase entry point에 위임한다.
- 대표 enemy behavior/cache tests가 새 phase entry point를 직접 호출해 production 이름과 navigation cache 의미를 고정한다.
- production enemy movement phase는 stats-free `apply_layer_movement_pattern_with_navigation_batch_system(...)`을 호출한다. stats 수집은 test/diagnostic wrapper인 `run_layer_movement_pattern_with_navigation_batch_system(...)`에만 남겨 hot path counter write를 피한다.

이 slice는 새 movement behavior나 world scan을 추가하지 않는다. 목표는 `movement_pattern_system`으로 옮긴 component 실행 경계와 Shooter runtime의 phase call placement를 같은 어휘로 맞춰, 다음 단계에서 phase scheduler나 movement phase table을 만들 때 `velocity update`라는 장르 구현 이름에 묶이지 않게 하는 것이다.

### 2026-06-01: Player movement/action phase split slice

Shooter `apply_player_input_with_actions(...)`에 함께 묶여 있던 player movement write와 action dispatch를 runtime frame loop에서 별도 phase로 분리했다.

- `apply_player_movement_input(...)`은 player `TopdownInput` velocity write만 담당하고, `run_topdown_input_movement_system(...)`을 호출한다.
- `apply_player_actions_with_input(...)`은 dash/melee/spawnPrefab/projectile action dispatch만 담당하며 player velocity를 직접 쓰지 않는다.
- 기존 test helper와 compatibility caller인 `apply_player_input_with_actions(...)`는 movement 후 action을 순서대로 호출해 기존 테스트/동작 표면을 유지한다.
- Playing frame loop는 이제 player movement phase를 action dispatch phase 앞에 명시적으로 호출한다.
- action-only phase가 velocity를 바꾸지 않고 movement phase만 velocity를 쓰는 것을 focused test로 고정했다.

이 slice는 새 system scheduler나 world scan을 추가하지 않는다. 단일 player entity write는 기존 그대로 유지하되, `movement_pattern_system` 후보와 `action_system` 후보의 phase 경계를 코드상 분리해 이후 공통 scheduler/phase table로 옮기기 쉬운 형태로 만든다.

### 2026-06-01: Layer MovementPattern batch wrapper slice

Shooter가 직접 넘기던 enemy include predicate와 unsupported default velocity hook을 layer 기반 공통 helper로 한 단계 더 묶었다.

- `apply_layer_movement_pattern_with_navigation_batch_system(...)`을 추가해 `CollisionLayer` 일치 + transform 존재 필터와 unsupported zero-velocity write를 공통화했다. test/diagnostic 경로는 stats를 반환하는 `run_layer_movement_pattern_with_navigation_batch_system(...)` wrapper를 사용한다.
- Shooter `apply_enemy_movement_phase(...)`는 이제 `CollisionLayer::Enemy`, scene fallback `MovementPattern`, tilemap waypoint resolver만 전달한다.
- layer helper는 authored movement가 적용된 entity에는 fallback provider를 호출하지 않는 lazy 정책을 유지한다.
- no-transform entity는 include되지 않아 기존 velocity를 유지하고, 다른 layer entity는 movement batch 대상에서 제외되는 것을 test로 고정했다. transformed Enemy가 지원 불가 pattern으로 끝나면 unsupported policy가 velocity를 `Velocity::default()`로 zeroing하는 것도 별도 test로 고정했다.
- 새 world scan, heap allocation, dynamic dispatch, JS/Wasm callback은 추가하지 않았다.

이 slice 이후 Shooter에 남은 movement 책임은 phase call placement, target `CollisionLayer` 선택, scene-level fallback pattern 선택, tilemap scratch/resolver 제공이다. layer/transform include predicate와 unsupported default velocity policy는 공통 gameplay helper로 이동했다. generic batch helper는 같은 module 내부 helper로 좁혀 structural mutation 없는 component write 계약을 production caller 밖으로 넓히지 않는다.

### 2026-06-01: MovementPattern batch system slice

Shooter enemy movement의 alive loop를 scene 전용 코드에서 `gameplay.rs`의 batch-style movement system으로 옮겼다.

- `MovementPatternBatchRunStats`와 `run_movement_pattern_with_navigation_batch_system(...)`을 추가했다.
- batch system은 alive entity 순회, include predicate 평가, current slot의 authored/fallback movement 실행, unsupported hook 호출을 담당한다.
- Shooter scene은 enemy include predicate, scene fallback `MovementPattern`, unsupported 시 default velocity write, tilemap waypoint resolver만 전달한다.
- 기존 enemy filter(`CollisionLayer::Enemy` + transform 존재), authored pattern 우선, `TopdownInput` unsupported fallback, chase navigation cache/waypoint 정책은 유지했다. fallback provider는 authored pattern이 적용된 entity에서는 호출하지 않도록 lazy 처리한다.
- 새 heap allocation, dynamic dispatch, JS/Wasm callback은 추가하지 않았다. 기존 enemy alive loop를 공통 system 함수로 이동한 것이며, 순회 횟수는 증가하지 않는다.

이 slice로 `movement_pattern_system`의 ownership이 더 명확해졌다. 아직 tilemap scratch와 scene fallback provider는 Shooter가 제공하지만, loop와 component 실행 경계는 공통 gameplay module로 이동했다.

### 2026-06-01: Scene EnemyBehavior fallback as MovementPattern slice

scene-level `EnemyBehavior` fallback도 직접 velocity match가 아니라 공통 `MovementPattern` 실행 경로로 통과시켰다.

- `run_movement_pattern_with_navigation_or_fallback_system(...)`을 추가해 valid live entity의 authored component pattern을 먼저 적용하고, pattern이 없거나 현재 system에서 unsupported인 경우 fallback `MovementPattern`을 적용한다. stale/despawned entity는 fallback 없이 `Unsupported`를 반환한다.
- Shooter `EnemyBehavior::Chase/Drift/Static/Orbit`은 각각 `MovementPattern::Chase(Player)`, `MoveToPoint(world center)`, `Static`, `Orbit(Player)`으로 변환된다.
- authored movement pattern이 있으면 우선한다. 단, enemy path에서 의미 없는 `TopdownInput`처럼 unsupported인 authored pattern은 기존 behavior와 동일하게 scene fallback으로 내려간다.
- fallback이 `Chase`인 경우에도 같은 tilemap waypoint resolver와 navigation cache 정책을 사용한다.
- 새 world scan, allocation, dynamic dispatch, JS/Wasm callback은 추가하지 않았다. 기존 enemy alive loop 안에서 pattern 선택과 실행 경계만 바꿨다.

이 slice는 scene-level fallback 정책을 완전히 제거하지 않는다. 다만 fallback도 `MovementPattern` primitive로 표현되므로, 장기적으로 `movement_pattern_system`이 scene별 enum을 직접 알 필요 없이 `fallback pattern provider` 또는 prefab 기본값으로 흡수할 수 있는 형태가 됐다.

### 2026-06-01: MovementPattern component-owned navigation wrapper follow-up

navigation-backed enemy movement wrapper가 `MovementPattern` 인자를 외부에서 받지 않고 entity component를 직접 읽도록 좁혔다.

- `run_movement_pattern_with_navigation_system(...)`은 valid `Entity`의 `world.movement_patterns[index]`만 실행한다. pattern이 없거나 stale/despawned entity이면 `Unsupported`를 반환한다.
- Shooter `update_enemy_velocity(...)`는 raw `world.movement_patterns[i]` 분기를 직접 하지 않고 wrapper를 호출한다. wrapper가 `Unsupported`를 반환하면 기존 scene-level `EnemyBehavior` fallback을 적용한다.
- pattern 없는 entity는 wrapper 단위에서 velocity/cache/resolver를 건드리지 않는 것을 test로 고정했다. Shooter `update_enemy_velocity(...)` 시작 시 기존처럼 전체 navigation cache TTL을 tick하는 전역 side effect는 유지한다.
- 이 변경으로 scene 호출자가 entity와 분리된 detached `MovementPattern`을 wrapper에 넘기는 경로를 제거했다.

이 slice도 완전한 scheduler 기반 `movement_pattern_system`은 아니다. 다만 system entry point의 입력을 `Entity + World component`로 정리해, 이후 공통 movement system으로 빼낼 때 component ownership을 유지하기 쉬워졌다. 남은 큰 책임은 enemy loop/phase ownership과 scene-level fallback 정책의 장기 위치 결정이다.

### 2026-06-01: Navigation-backed enemy movement system wrapper slice

enemy `MovementPattern` 적용 경로도 entity-aware 공통 system wrapper로 감쌌다.

- `run_movement_pattern_with_navigation_system(...)`을 `crate::gameplay`에 추가해 `Entity`의 alive/generation을 확인한 뒤 기존 navigation-backed movement application에 위임한다.
- Shooter `update_enemy_velocity(...)`는 `apply_movement_pattern_with_navigation(world, index, ...)`를 직접 호출하지 않고, 현재 alive enemy index/generation으로 만든 `Entity` handle을 wrapper에 전달한다.
- enemy movement의 player target transform 조회도 `world.player_entity().and_then(|p| world.transform(p))`로 맞춰 stale player handle을 거른다.
- raw index 기반 `apply_movement_pattern_with_navigation(...)`은 `gameplay.rs` 내부 private helper로 낮춰 crate 외부 gameplay 호출 지점이 generation check를 우회하지 않게 했다.
- stale generation/despawned actor는 `Unsupported`를 반환하고 velocity/cache/resolver를 건드리지 않는 것을 test로 고정했다.
- stale player handle은 player target transform이 `None`으로 처리되어 chase movement가 정지 velocity를 쓰고 navigation cache를 만들지 않는 것을 shooter regression으로 고정했다.
- 기존 enemy alive loop, tilemap navigation scratch, cache resize 정책은 유지했다. 새 world scan, allocation, dynamic dispatch, JS/Wasm callback은 추가하지 않았다.

이 slice는 완전한 `movement_pattern_system` 도입이 아니라, Shooter enemy loop 안의 movement override 적용을 entity-aware system boundary로 좁힌 것이다. 남은 큰 책임은 enemy loop/phase ownership, scene-level `EnemyBehavior` fallback 정책의 장기 위치를 결정하는 일이다.

### 2026-06-01: Topdown input movement system wrapper slice

player 이동 호출부를 entity-aware 공통 system wrapper로 한 단계 감쌌다.

- `run_topdown_input_movement_system(...)`을 `crate::gameplay`에 추가해 `Entity`의 alive/generation을 확인한 뒤 기존 `apply_topdown_input_movement(...)`에 위임한다.
- Shooter player input phase는 더 이상 `player.id as usize`를 직접 넘기지 않고 `run_topdown_input_movement_system(world, player, input, config_speed)`를 호출한다.
- `MovementPattern::TopdownInput { speed }`가 있으면 component speed가 config speed보다 우선하고, 패턴이 없거나 non-topdown이면 기존 config fallback을 유지한다.
- stale generation/despawned entity는 `Unsupported`를 반환하고 velocity를 건드리지 않는 것을 test로 고정했다.
- raw index 기반 `apply_topdown_input_movement(...)` helper는 `gameplay.rs` 내부 private helper로 낮추고, crate 외부 gameplay 호출 지점은 entity-aware wrapper를 entry point로 사용하게 했다.

이 slice는 새 world scan을 추가하지 않는다. 기존 player input phase의 단일 entity write를 유지하면서, input movement도 action planner들과 같은 "entity-aware gameplay system boundary"를 갖도록 정리했다. 완전한 `movement_pattern_system` 분리는 아직 아니며, 남은 큰 경계는 enemy loop/phase 소유권과 tilemap navigation scratch 제공이다.

### 2026-06-01: Player input melee planner slice

player input melee 경로도 직접 command를 만드는 대신 crate-private gameplay planner를 통과하도록 맞췄다.

- `validate_input_melee_action_support(...)`와 `plan_input_melee_action(...)`을 추가해 player melee의 지원 target(`Enemies`)을 Rust core의 typed error로 검증한다.
- queued trigger melee는 `target: Player`, player input melee는 `target: Enemies`를 각각 별도 validator로 다룬다. 두 경로를 억지로 하나의 validator에 합치지 않아 target 의미가 섞이지 않게 했다.
- `melee_action_plan_failure_reason(...)`을 shooter runtime 내부 공용 mapper로 열어 input melee와 trigger melee가 같은 failure reason code를 사용한다.
- player input melee는 기존 우선순위처럼 source transform 누락을 planning보다 먼저 검사한다. 즉 source transform이 없으면 `missingSourceTransform`, source는 있으나 unsupported target이면 `unsupportedCollisionTarget`이 보고된다.
- 실패 시 cooldown을 소비하지 않는 것을 focused test로 고정했다.

이 slice는 pending melee collision 처리나 target discovery를 바꾸지 않는다. action authoring 경계를 `payload -> plan -> pending command`로 정리해 이후 공통 `action_system` 추출 시 dash/projectile/melee가 같은 실패 진단 패턴을 갖게 한다.

### 2026-06-01: Player input dash failure mapper slice

player input dash 경로도 queued trigger dash 경로와 같은 `DashActionPlanError -> gameplay failure reason code` mapper를 공유하도록 맞췄다.

- `dash_action_plan_failure_reason(...)`을 shooter runtime 내부 공용 mapper로 열었다.
- `try_dash_player(...)`는 `plan_input_dash_action_transform(...)` 실패를 `Err(_)`로 접지 않고 mapper를 통해 명시적 reason code로 이벤트를 낸다.
- player input dash는 source transform 누락을 planning보다 먼저 검사하는 기존 우선순위를 유지한다. 즉 source transform이 없으면 `missingSourceTransform`, source는 있으나 지원하지 않는 aim이면 `unsupportedAimSource`가 보고된다.
- 실패 시 cooldown을 소비하지 않는 것을 focused test로 고정했다.

이 slice는 새 action primitive를 추가하지 않고, input action과 trigger action의 진단 경계를 같은 형태로 좁히는 정리다. 이후 공통 `action_system`으로 옮길 때 dash/projectile 모두 `Result<plan, typed_error> -> reason_code -> gameplay event` 흐름을 공유할 수 있다.

### 2026-06-01: Player input projectile failure boundary slice

`ActionPattern::Projectile`의 player input 경로가 `plan_input_projectile_action(...).ok()?`로 계획 실패를 `Option`에 접던 부분을 queued trigger projectile 경로와 같은 `Result<ProjectileSpawnCommand, reason_code>` 경계로 맞췄다.

- `projectile_action_plan_failure_reason(...)`을 shooter runtime 내부 공용 mapper로 열어 input action과 trigger action이 같은 failure reason code를 사용한다.
- player primary projectile은 `aim`/`collisionTarget`이 projectile kind 안에서 지원되지 않는 경우 `patternMismatch`가 아니라 `unsupportedAimSource` 또는 `unsupportedCollisionTarget` 이벤트를 낸다.
- 지원하지 않는 projectile sub-config 진단은 source transform 누락보다 먼저 평가해 queued trigger projectile 경로와 실패 우선순위를 맞춘다.
- legacy `ShooterConfig` 기반 fire fallback은 기존처럼 실패 시 조용히 no-op으로 남겨 public behavior를 넓히지 않았다.
- 실패가 발생하면 pending spawn을 만들지 않고 cooldown도 소비하지 않는 것을 test로 고정했다.

이 slice는 새 Wasm ABI나 JS callback을 추가하지 않는다. action authoring 진단을 더 machine-actionable하게 만들고, 이후 `input_action_system`과 `action_system`을 합칠 때 input/trigger projectile이 같은 planning-result 경계를 공유하게 하기 위한 정리다.

### 2026-06-01: Shooter runtime taxonomy audit slice

1단계 완료 기준인 "기존 Shooter behavior를 새 taxonomy로 모두 설명"하기 위해 현재 `ShooterScene` runtime 함수를 movement/action/lifetime/collision reaction 단위로 분해했다. 이 slice는 새 runtime behavior를 추가하지 않고, 이후 agent가 남은 code-only fallback을 어느 component/system으로 옮길지 판단할 기준표를 고정한다.

| 현재 runtime 함수/phase | 현재 책임 | taxonomy 분류 | 현재 데이터 기반 coverage | 남은 code-only/fallback |
| --- | --- | --- | --- | --- |
| `apply_player_input(...)` / split player movement/action phase | player 이동, primary fire, dash/melee input dispatch, input action registry 조회 | Movement pattern, Action pattern, Cooldown | player movement는 `MovementPattern::TopdownInput` component를 우선하는 `TopdownInputMovementPhaseConfig`/`apply_topdown_input_movement_phase(...)`로 이동했고, player primary `projectileAction`, `dashAction`, `meleeAction`, `spawnPrefabAction`은 `ActionBindingSet`과 Rust input registry로 일부 선언 가능 | frame input snapshot ownership과 action dispatch orchestration은 Shooter runtime compatibility path에 남아 있음 |
| `apply_enemy_movement_phase(...)` | enemy `chase`/`orbit`/`static`/`drift` movement phase 실행 | Movement pattern | entity별 `MovementPattern` override가 `Static`, `Linear`, `MoveToPoint`, `Chase(Player/Entity)`, `Orbit`을 우선 처리하고 `Chase(Player/Entity)` 모두 tilemap waypoint/cache를 사용. layer/player/policy/fallback 입력 모양은 `LayerMovementPatternPhaseConfig`로 공통화됨 | scene-level `EnemyBehavior` fallback config assembly와 tilemap scratch resolver wiring은 Shooter runtime compatibility path에 남음 |
| `update_bullets(...)` | TTL 감소, 만료 despawn, projectile arc 갱신, bullet out-of-bounds despawn | Lifetime/state | `run_lifetime_system(...)`이 TTL이 붙은 모든 live entity를 tick하고 만료 despawn queue를 담당한다 | projectile arc와 bullet out-of-bounds despawn은 Shooter projectile phase에 남아 있음 |
| `spawn_enemy_if_needed(...)` / wave advance | wave timer, enemy spawn 위치/프리팹, wave-enter action trigger | Spawn pattern, Action pattern | `spawnPrefabAction`은 timer/wave/state-enter trigger로 pre-physics deferred spawn까지 연결됨 | legacy wave spawn 자체는 여전히 Shooter wave config path가 직접 처리하며 generic spawn pattern system은 아님 |
| `handle_bullet_enemy_collisions(...)` | projectile/enemy swept pair discovery, damage, score, hit audio/VFX, despawn | Collision reaction, Health/Damage/ScoreReward | `CollisionReaction::{Damage, Despawn, PlaySound, SpawnParticle}`와 authored event telemetry가 기존 pair discovery 위에서 실행됨 | pair discovery는 Shooter broadphase path에 남아 있고 built-in hit audio/VFX/tween은 additive fallback으로 유지 |
| `handle_bullet_player_collisions(...)` | player-target projectile collision과 GameOver | Collision reaction, Action target policy | target-player projectile action이 Rust-owned trigger/player collision path로 연결됨 | player health/armor/knockback/faction matrix 없이 GameOver fallback 중심 |
| `handle_player_enemy_collisions(...)` | player/enemy 접촉 GameOver 또는 authored player damage | Collision reaction, Health/Damage | authored `Damage(target: other)`가 player health를 감소시키고 lethal이면 GameOver를 만든다 | cooldown/invulnerability, generic faction/friendly-fire matrix, contact enter-only semantics는 없음 |
| `handle_player_pickup_collisions(...)` | player/pickup overlap, score increment, pickup despawn, pickupCollected event | Collision reaction, Pickup, GameplayEvent | `Pickup` component, `CollisionReaction::Pickup`, `pickupCollected` telemetry/FSM actor subject까지 연결됨 | non-player collector, persistent pickup, inventory component는 제외 범위로 남김 |
| tile projectile collision bridge | projectile blocking tile hit, bullet despawn/pass-through/bounce, additive sound/particle/self-despawn reaction, tile impact telemetry | Collision reaction, Tile impact policy | `tileImpact: "despawn"|"passThrough"|"bounce"`가 in-flight bullet state까지 연결되고, `despawn`/`bounce`는 `PlaySound`, `SpawnParticle(self)`, `Despawn(self)`를 tile hit에 additive로 실행하며 unsupported entity-target reaction은 no-op. blocking hit는 `tileImpact` gameplay event로 layer/tile index, normal, bounced/targetRemoved flag를 노출 | tile을 public target으로 열지 않았고 destructible terrain, world/contact impact position payload는 별도 detail buffer/ABI 정책 필요 |
| gameplay event/FSM frame-end phase | interaction/collision/timer/pickup/tile impact/action failure/prefab event를 FSM transition과 replay로 연결 | Decision sequencing, Replay validation | Rust-owned FSM transition, state-enter action queue, TS replay/install/state command helper, golden replay fixtures가 존재 | state command 자동 runtime apply, transactional rollback, visual editor/BT editor는 의도적으로 열지 않음 |

이 분해 기준으로 현재 roadmap 1단계는 Shooter 장르에 대해서는 충족된 것으로 본다. Breakout/Platformer까지 같은 표로 확장하는 것은 공통 gameplay system을 실제로 더 넓힐 때 별도 audit로 수행한다. 다음 구현 후보를 고를 때는 이 표의 "남은 code-only/fallback" 열에서 하나를 선택하고, 새 JS callback이나 per-entity Wasm 왕복 없이 Rust-owned component/system 또는 명시적 non-goal로 닫는다.

### 2026-05-31: TS authoring binding/dry-run vertical slice

`SceneComposition`을 gameplay prefab/instance의 단일 authoring authority로 유지하기 위해 별도 `GameSpec.entities` 모델을 만들지 않고, resolved scene instance의 `props.behaviorRecipes` 값을 `BehaviorRecipeDocumentSpec.entities` profile에 연결하는 helper를 추가했다.

- `bindSceneBehaviorRecipes(...)`는 scene fragment를 flatten한 뒤 각 instance의 `behaviorRecipes` 문자열 또는 문자열 배열을 읽고, recipe command의 `entity`를 behavior profile id에서 resolved instance id로 retarget한다.
- `dryRunSceneBehaviorRecipes(...)`는 runtime target을 호출하지 않고 `SceneBehaviorBindingPlan` 또는 `DiagnosticReport[]`를 반환한다.
- 이 slice는 Rust/Wasm ABI를 바꾸지 않으며, visual editor나 scripting runtime을 도입하지 않는다.

남은 핵심 runtime slice는 Rust 내부에서 `health + damage + scoreReward + lifetime/despawn-on-zero`를 shooter 전용 함수에서 crate-private gameplay module로 점진 추출하는 것이다. collision pair discovery는 새 broadphase를 만들지 않고 기존 shooter pair discovery 결과를 재사용한다.

### 2026-05-31: Rust health/damage/lifetime 내부 추출 slice

Shooter 전용 `combat.rs`/`bullets.rs` 안에 있던 반복 gameplay 처리를 crate-private `gameplay` 모듈로 1차 추출했다.

- `damage_at_or_default(...)`, `apply_damage_to_health(...)`가 bullet damage, target health 감소, kill 여부, score reward 산출을 담당한다.
- `tick_lifetime(...)`, `has_expired_lifetime(...)`가 TTL countdown과 expiry 판정을 담당한다.
- `queue_despawn(...)`, `queue_marked_despawn(...)`가 기존 deferred despawn queue와 marked scratch를 재사용한다.
- collision pair discovery, tile projectile collision query, player/game-over reaction, audio/VFX/tween side effect는 아직 shooter runtime에 남겨 두었다.

이 slice는 Rust/Wasm ABI와 public TS API를 바꾸지 않는다. broadphase를 새로 만들지 않고 기존 `CollisionSystem::build_swept_layer_pairs_into(...)` 결과에 reaction 적용만 분리했다.

### 2026-05-31: Behavior command -> Rust scalar component 적용 slice

`SceneBehaviorBindingPlan`에서 retarget된 `BehaviorRecipeCommand`를 실제 Rust `World` component storage에 적용하는 최소 경로를 추가했다.

- Rust `Engine`에 generation-checked gameplay component setter/clearer를 추가했다: health, damage, lifetime, score reward.
- `BehaviorRecipe`에 `lifetime`, `scoreReward` kind를 추가해 scalar component authoring이 health/damage와 같은 command 경로를 사용한다.
- TS `applyGameplayBehaviorCommands(...)`와 `createGameplayBehaviorRuntimeTarget(...)`가 entity id 문자열을 `{ entityId, entityGeneration }` handle map으로 검증한 뒤 Rust setter를 호출한다.
- adapter는 현재 Rust storage가 표현할 수 없는 semantics를 조용히 버리지 않는다. `configureHealth`는 `current === max`, `onZero === "despawn"`, event 없음만 허용하고, `configureDamage`는 `cooldownSeconds === 0`만 허용한다. `configureLifetime`은 `seconds > 0`, `configureScoreReward`는 0 포함 non-negative integer만 허용한다. 이 slice 시점에는 `pickup`, `chase`, `interaction`을 거부했고, 이후 vertical slice에서 표현 가능한 subset만 순차적으로 열었다.

이 slice도 frame hot path가 아니라 scene load/agent apply 같은 낮은 빈도 경로를 대상으로 한다. 다량의 command를 runtime 중 반복 적용해야 하는 단계가 오면 per-command Wasm 호출 대신 bulk numeric command buffer를 별도 설계한다.

### 2026-05-31: MovementPattern / CollisionReaction 데이터 layout slice

Shooter behavior enum과 `handle_collisions(...)` 하드코딩을 바로 교체하지 않고, 먼저 공통 gameplay system이 읽을 수 있는 Rust component data layout을 추가했다.

- `components/gameplay.rs`에 crate-private `MovementPattern`, `MovementTarget`, `CollisionReaction`, `CollisionTarget`, 고정 크기 `CollisionReactionSet`을 추가했다.
- `World`에는 generation-aligned `movement_patterns`, `collision_reactions` storage를 추가했고 spawn/despawn/snapshot restore에서 기존 component storage와 같은 lifecycle을 따른다.
- `engine/gameplay_authoring.rs`에는 scene load/agent apply용 generation-checked setter를 추가했다. movement는 static/topdown input/linear/move-to-point/chase/orbit을 표현하고, collision reaction은 damage/despawn 대상만 표현한다.
- damage amount는 `CollisionReaction`에 중복 저장하지 않고 기존 `world.damages` component를 source of truth로 둔다. navigation cache 같은 runtime state도 authoring data에 넣지 않고 향후 system state로 분리한다.

이 slice는 아직 Shooter runtime loop를 새 system으로 교체하지 않는다. 다음 단계는 기존 `update_enemy_velocity(...)`와 `handle_collisions(...)`가 이 component data를 선택적으로 읽도록 옮기는 것이다.

### 2026-05-31: Shooter enemy movement override runtime slice

Shooter의 `update_enemy_velocity(...)`가 entity별 `MovementPattern` component를 먼저 읽고, 처리 가능한 pattern이면 scene-level `EnemyBehavior`보다 우선 적용하도록 연결했다.

- `Static`, `Linear`, `MoveToPoint`, `Chase(Player)`, `Chase(Entity)`, `Orbit`을 Shooter enemy velocity path에서 처리한다.
- `Chase(Player)`는 기존 tilemap navigation waypoint/cache를 재사용한다.
- 당시 `Chase(Entity)`는 첫 slice에서 navigation cache에 target identity를 추가하지 않고 generation-checked `World::transform(...)`으로 직접 추적했다. 이후 `2026-06-01: Chase(Entity) tilemap navigation cache discriminator slice`에서 entity target도 같은 tilemap waypoint/cache 경로를 사용하도록 승격했다. target이 despawn되었거나 stale generation이면 명시 override가 기존 scene behavior로 조용히 fallback하지 않고 zero velocity가 된다.
- `TopdownInput`은 enemy runtime이 입력 상태를 갖지 않으므로 이 system에서는 미처리로 두고 기존 scene behavior fallback을 유지한다.
- 이 경로는 `Vec<Option<MovementPattern>>` 조회와 Rust match만 추가하며 allocation, dynamic dispatch, JS/Wasm per-entity callback을 만들지 않는다.

아직 공통 `movement_pattern_system`으로 분리한 것은 아니다. 현재는 Shooter runtime 안에서 component override를 소비하는 호환 slice이며, 다음 단계는 같은 원칙으로 `collision_reactions`를 `handle_collisions(...)`에 연결하는 것이다.

### 2026-05-31: Shooter bullet/enemy collision reaction runtime slice

Shooter의 bullet/enemy 충돌 처리에서 기존 swept pair discovery와 despawn queue를 유지한 채, pair 양쪽 entity의 `CollisionReactionSet`을 선택적으로 실행하는 경로를 추가했다.

- pair의 어느 한쪽이라도 `collision_reactions`를 가지면 authored reaction이 기존 hardcoded bullet damage + bullet despawn 기본 동작을 대체한다.
- `Damage { target }`는 source entity의 `world.damages` 값을 사용한다. damage amount는 reaction data에 중복 저장하지 않는다.
- `Despawn { target }`는 기존 `marked_for_despawn`/`pending_despawn` queue를 재사용해 같은 frame 중복 처리와 즉시 structural mutation을 피한다.
- authored damage로 enemy가 죽으면 기존 score reward component/default를 그대로 사용한다.
- `SelfEntity`/`OtherEntity` target은 pair source 기준으로 해석한다. 예를 들어 bullet에 `Damage(OtherEntity) + Despawn(SelfEntity)`를 붙이면 기존 bullet hit 동작을 spec으로 표현할 수 있다.

이 slice는 아직 player/enemy game-over, tile projectile collision, pickup/audio/particle reaction을 일반화하지 않는다. 또한 collision event discovery 자체를 공통 system으로 분리하지 않고 기존 Shooter broadphase 결과를 재사용한다.

### 2026-05-31: Behavior command -> movement/collision component 적용 slice

`applyGameplayBehaviorCommands(...)`가 기존 scalar component 외에 runtime에서 소비되는 movement/collision component도 일부 적용하도록 확장했다.

- `configureDamage`는 damage component를 설정한 뒤 `CollisionReaction::Damage`를 추가한다. `target`은 `self`/`other` 모두 지원하고, `cooldownSeconds === 0`만 허용한다.
- `configureChase`는 `MovementPattern::Chase`로 연결한다. `target: "player"`는 player chase를, 그 외 target 문자열은 generation-checked entity handle lookup을 사용한다.
- `configureChase`의 `stopDistance`와 `maxDistance`는 현재 Rust movement storage가 표현하지 않으므로 `stopDistance === 0`, `maxDistance` 없음만 adapter에서 허용한다.
- `CollisionReactionSet`은 같은 reaction을 중복 추가하지 않아 agent apply가 반복되어도 동일 damage reaction이 누적되지 않는다.

이 slice도 scene load/agent apply 경로에만 해당한다. frame loop에서 TS callback을 호출하거나 entity별 JS/Wasm 왕복을 추가하지 않는다.

### 2026-05-31: Score pickup component/runtime slice

`configurePickup`을 TS callback이나 임의 inventory mutation으로 처리하지 않고, Rust-owned `Pickup` component와 Shooter runtime 수집 phase로 연결했다.

- `Pickup { item_id, count, despawn_on_collect }` component storage를 `World`에 추가하고 spawn/despawn/snapshot restore lifecycle에 포함했다.
- runtime token은 우선 score pickup id `1`만 지원한다. TS recipe는 `item: "score"` 또는 `itemId: 1`을 `set_gameplay_pickup(...)`으로 적용하고, unknown item, unsupported item id, `despawn: false`는 machine-actionable diagnostic으로 거부한다.
- `CollisionLayer::Pickup`을 추가해 pickup entity를 `Enemy`로 위장하지 않는다. physics body authoring layer에도 `pickup`을 추가해 player/pickup pair를 명시적으로 만들 수 있다.
- Shooter `handle_collisions(...)`는 player/enemy game-over와 bullet/enemy swept collision을 그대로 두고, `Player`/`Pickup` pair만 별도 Rust phase에서 처리한다. score 증가는 `marked_for_despawn`/`pending_despawn` queue 성공 시 1회만 발생한다.
- 이 slice는 inventory, UI prompt, interaction event, generic cross-genre collision pipeline을 구현하지 않았다. pickup score 효과만 실제 runtime behavior로 닫고, interaction은 별도 event/output contract slice로 분리했다.

이 경로도 낮은 빈도 spec apply와 Rust frame loop 처리만 사용한다. player가 pickup과 겹치는 frame에 JS/TS callback을 호출하지 않고, Wasm boundary에는 component setter 호출만 들어간다.

### 2026-06-01: pickupCollected GameplayEvent telemetry slice

score pickup 수집 결과도 frame-end adapter와 replay에서 관측할 수 있도록 `GameplayEvent` bulk buffer에 연결했다. 범위는 기존 score pickup runtime에 대한 telemetry이며, pickup 효과 자체를 TS callback으로 옮기지 않는다.

- Rust `GameplayEvent` kind에 `pickupCollected`를 추가했다. ABI stride는 기존 8-u32 그대로 유지한다.
- event shape는 `actor = collector/player`, `source = collected pickup`, `tokenId = item_id`, `payloadBits = count`다. pickup이 deferred despawn queue에 실제로 들어간 경우 `targetRemoved` flag를 세운다.
- Shooter runtime은 score 증가와 pickup despawn queue가 성공한 경우에만 `pickupCollected`를 emit한다. unsupported item, persistent pickup, 이미 marked despawn된 pickup에는 score도 event도 중복 발생하지 않는다.
- TS `decodeGameplayEvents(...)`와 `gameplayActionsForEvents(...)`는 이 event를 `pickupCollected` frame-end action으로 변환한다. UI score feedback, quest trigger, inventory adapter, agent smoke가 수집 결과를 소비할 수 있지만 Rust simulation을 되돌려 호출하지 않는다.
- 이 slice 시점에는 FSM predicate vocabulary에 포함하지 않는다. 당시 production FSM은 event `source` entity에 붙은 FSM만 전이시켰고, pickup source는 같은 collision phase에서 despawn될 수 있어 subject 정책(`actor` vs `source`)을 먼저 설계해야 했다. 이후 actor-subject slice에서 collector 기준 predicate를 열었다.
- authored behavior golden replay의 event payload 검증에 pickup 수집 telemetry를 포함한다.

이 slice는 inventory component, persistent pickup collection, pickup-owned FSM transition, generic collision reaction `Pickup` variant를 열지 않는다.

### 2026-06-01: generic pickup collision reaction slice

score pickup payload component와 collection reaction을 분리했다. `pickup` recipe는 여전히 `Pickup { item_id, count, despawn_on_collect }` data를 설정하고, 새 `collisionPickup` recipe는 collision reaction set에 `Pickup { target }` reaction을 추가한다.

- Rust `CollisionReaction::Pickup { target }`와 `add_gameplay_collision_pickup(...)` setter를 추가했다. ABI는 새 per-entity callback이 아니라 기존 저빈도 authoring setter이며, collision reaction storage는 fixed-capacity component 그대로다.
- `target`은 collector가 아니라 `Pickup` component를 가진 entity다. pickup entity에 붙이면 보통 `self`, player-side reaction으로 붙이면 `other`를 쓴다. collector는 반대편 entity이며 현재 runtime은 live `Player` layer만 collector로 인정한다.
- Shooter runtime은 기존 `Player`/`Pickup` pair list를 재사용한다. 별도 broadphase pass를 추가하지 않고, authored `Pickup` reaction이 pair에 있으면 legacy score pickup fallback보다 우선한다.
- authored pickup reaction은 score pickup component, `CollisionLayer::Pickup`, `despawn_on_collect == true`를 만족할 때만 score 증가, deferred despawn, `pickupCollected` event를 만든다. 잘못된 target은 no-op이지만 fallback을 다시 실행하지 않아 spec 오류를 조용히 legacy behavior로 덮지 않는다.
- `pickupCollected`는 계속 actor=collector/player, source=pickup 의미를 유지한다. implicit pickup despawn은 별도 `collisionDespawn` event를 중복 emit하지 않는다.
- TS `BehaviorRecipe`에는 `collisionPickup` kind와 `configureCollisionPickup` command를 추가했다. `pickup` recipe와 이름을 합치지 않아 payload data와 collision reaction을 agent가 독립적으로 조합할 수 있다.
- 이 slice 시점의 `pickupCollected`는 여전히 FSM predicate vocabulary에 포함하지 않았다. `actor` 기준 transition과 `source` 기준 transition 중 무엇을 열지 정하는 subject policy는 이후 actor-subject slice에서 collector 기준으로 닫았다.

이 slice는 inventory, persistent pickup, non-player collector, one-shot/cooldown pickup policy를 열지 않는다.

### 2026-06-01: pickupCollected FSM actor-subject slice

`pickupCollected` telemetry를 FSM predicate vocabulary에도 포함하되, subject 정책은 `actor` 기준 단독으로 고정했다. 기존 collision/timer/interaction FSM은 event `source`와 FSM owner가 일치해야 전이하지만, `pickupCollected`의 `source`는 collected pickup이고 같은 collision phase에서 despawn될 수 있으므로 FSM owner로 안정적이지 않다.

- Rust FSM runtime은 `pickupCollected` event만 collector/player인 `actor`와 FSM owner entity를 비교한다. `source`는 계속 pickup telemetry로 유지한다.
- `BehaviorStateTransition` storage에는 subject field를 추가하지 않고 기존 `event_kind + token_id` 형식을 유지한다. `pickupCollected`의 `token_id`는 `item_id`이며 `0`은 invalid다.
- TS FSM schema/replay/install은 `event: "pickupCollected"` predicate를 허용하고 `item` 또는 `itemId`를 요구한다. runtime token은 `ids.items` 또는 inline `itemId`에서 해석한다.
- TS replay도 pickup event만 actor 기준으로 subject filtering을 수행하며, replay hash에는 actor/source generation, `itemId`, `count`, `targetRemoved`가 포함된다.
- collected pickup 자체의 FSM transition, `actor || source` 암묵 매칭, event source를 collector로 바꾸는 호환성 깨지는 우회는 열지 않는다. 나중에 둘 다 필요하면 `subject: "actor" | "source"` 같은 명시적 schema로 별도 설계한다.

이 slice는 pickup 수집 결과를 플레이어/collector 상태 전이에 사용할 수 있게 만든 범위다. inventory component, persistent pickup, non-player collector, pickup-owned despawn 직전 state-enter action은 여전히 후속 범위다.

### 2026-05-31: Interaction component / GameplayEvent buffer slice

`configureInteraction`을 JS callback으로 직접 실행하지 않고, Rust-owned `Interaction` component와 별도 bulk `GameplayEvent` output buffer로 연결했다.

- `Interaction { action_id, radius, once, consumed }` component storage를 `World`에 추가하고 spawn/despawn/snapshot restore lifecycle에 포함했다.
- `set_gameplay_interaction(...)` / `clear_gameplay_interaction(...)`은 generation-checked entity handle, positive action id, finite positive radius만 허용한다. TS adapter는 `actionId` 또는 `ids.actions[action]`으로 runtime token을 해석하고, prompt text는 Rust simulation에 저장하지 않는다.
- Shooter runtime은 player transform과 interaction source transform 사이의 radius check를 Rust frame loop 안에서 수행한다. collider layer를 `Enemy`나 `Pickup`으로 위장하지 않고, score/game-over/audio/collision lifecycle path와 분리한다.
- Rust `GameplayEvent` ABI는 `kind`, actor handle, source handle, `token_id`, `flags`, `payload_bits`를 모두 `u32` buffer로 노출한다. TS는 `gameplayEventBufferView(...)`와 `decodeGameplayEvents(...)`로 frame 단위 bulk read만 수행한다.
- fixed timestep에서 한 render frame 안에 여러 substep이 실행되어도 같은 actor/source interaction event는 frame buffer에 1회만 기록한다. `once` interaction은 emit한 frame에 `consumed`로 표시되어 다음 frame부터 재발행되지 않는다.

이 slice도 per-entity JS/Wasm hot-path callback을 만들지 않는다. 사용자는 행동을 `interaction` spec으로 선언하고, 런타임/게임 UI는 frame 끝에서 decoded `GameplayEvent`를 보고 prompt, cutscene, quest, inventory 같은 장르별 처리를 붙인다.

### 2026-05-31: GameplayEvent action adapter contract slice

decoded `GameplayEvent`를 게임별 UI/quest/cutscene/inventory 구현이 바로 소비할 수 있도록 TS-side frame-end adapter 계약을 추가했다. 이 계약은 Rust gameplay loop를 호출하는 callback이 아니라, 이미 Rust에서 판정된 event buffer를 장르별 side effect 경계로 넘기는 얇은 변환층이다.

- `gameplayActionsForEvents(...)`는 `interaction` event를 `{ type: "interaction", actionId, action?, actor, source, once, consumedThisFrame, flags, payloadBits, event }` 형태의 `GameplayEventAction`으로 변환한다.
- `actionNames`는 numeric runtime token을 사람이 읽는 action name으로 복원하는 optional map이다. `requireActionNames`를 켜면 누락된 token을 JSON path diagnostic으로 실패시켜 agent가 spec/id registry를 수정할 수 있게 한다.
- `gameplayEventActionMetadataForCommands(...)`는 binding plan의 `configureInteraction` command에서 action id/name/prompt metadata registry를 파생한다. 따라서 `prompt`는 Rust simulation component에 저장하지 않지만 frame-end adapter action에는 보존된다.
- 같은 runtime action id가 서로 다른 action/prompt metadata를 가리키면 diagnostic으로 실패한다. action id registry 충돌을 조용히 덮어쓰지 않는다.
- `applyGameplayEventActions(...)`는 `applyGameplayEventAction(action)`만 요구하는 target adapter를 호출한다. UI prompt, cutscene, quest, inventory는 이 target 뒤에서 게임별로 구현하며 Ferrum2D core simulation state가 되지 않는다.
- 알 수 없는 event kind는 기본적으로 error로 처리하고, forward-compatible consumer만 `unknownEvent: "ignore"`를 명시한다. 새 event kind가 조용히 유실되는 것을 기본값으로 두지 않는다.

이 slice로 decoded gameplay event를 game-specific reaction adapter로 소비하는 예제 계약은 닫았다. 남은 과제는 interaction 외 event kind를 늘릴 때 공통 collision/reaction event pipeline과 replay diff 검증을 함께 붙이는 것이다.

### 2026-05-31: Collision reaction gameplay event slice

`interaction` 전용 gameplay event buffer를 authored collision reaction 결과까지 확장했다. 이 slice는 collision reaction 실행을 TS callback으로 넘기는 것이 아니라, Rust가 이미 적용한 reaction 결과를 frame-end adapter와 agent telemetry가 읽을 수 있는 bulk event로 남기는 범위다.

- Rust `GameplayEvent` kind에 `collisionDamage`, `collisionDespawn`을 추가했다. ABI stride는 `u32` 8개 그대로 유지하고, damage 값은 `payload_bits`의 `f32` bit pattern으로 싣는다.
- authored `CollisionReaction::Damage`는 영향을 받은 entity를 actor, reaction component를 가진 entity를 source로 하는 `collisionDamage` event를 emit한다. kill/despawn이 발생하면 `targetRemoved` flag를 함께 세운다.
- authored `CollisionReaction::Despawn`은 실제 deferred despawn queue에 들어간 경우에만 `collisionDespawn` event를 emit한다.
- TS `decodeGameplayEvents(...)`와 `gameplayActionsForEvents(...)`는 이 event를 `collisionDamage` / `collisionDespawn` frame-end action으로 변환한다. 이 action은 telemetry, UI feedback, quest trigger adapter가 소비할 수 있지만 Rust simulation을 되돌려 호출하지 않는다.
- 이 slice 시점에는 Behavior FSM replay/install predicate가 `interaction` action id만 지원했고, collision reaction event의 FSM transition vocabulary 편입은 후속 slice로 남겼다.

이 slice로 interaction 외 event kind를 붙일 수 있는 ABI/decoder/adapter 경로를 열었다. 이어지는 slice에서 full gameplay golden replay diff의 최소 비교 단위를 추가했다.

### 2026-05-31: Gameplay golden replay diff slice

`GameStateSnapshot`과 built-in shooter snapshot을 canonical gameplay snapshot으로 삼는 golden replay comparison helper를 추가했다. 이 slice는 새 runtime loop를 만들지 않고, smoke/예제 harness가 fixed timestep/seed/input sequence로 실행하면서 캡처한 snapshot sequence를 비교하는 비-hot-path 검증 도구다.

- `createGameplayReplayRun(...)`은 strictly increasing `GameStateSnapshot[]`를 frame snapshot hash와 run hash를 가진 `GameplayReplayRun`으로 묶는다.
- `compareGameplayReplayRuns(...)`는 expected/actual run hash를 비교하고 첫 mismatch frame과 `gameplayReplay.snapshots.N.snapshot...` JSON path, expected/actual 값을 반환한다.
- canonical 범위는 scene metric, built-in shooter state, optional PhysicsWorld/custom JSON state다. render command, audio event, wall-clock profiler, debug overlay는 replay hash 범위에서 제외한다.
- 이 helper는 `GameStateSnapshot` validation/hash를 재사용하므로 built-in shooter의 score, game state, spawn/wave timer, camera, player/enemy/bullet position/velocity/health/damage/lifetime/reward drift를 agent가 smoke보다 정밀하게 볼 수 있다.

이 slice 자체는 helper/API만 추가하고 예제별 golden fixture나 smoke command 연결은 하지 않았다. 이어지는 slice에서 Top-down save/load smoke에 최소 비교 경로를 붙였다.

### 2026-05-31: Top-down save/load gameplay replay smoke 연결 slice

`pnpm smoke:topdown-save-load`의 기존 built-in shooter snapshot restore 검증에 `GameplayReplayRun` 비교를 연결했다. 이 smoke는 committed fixture 파일을 새로 만들지는 않지만, save 전 snapshot을 expected run으로, restore 후 snapshot을 actual run으로 만들어 같은 gameplay canonical 범위가 복원됐는지 검증한다.

- browser page는 저장 직전과 복원 직후의 scene metric, built-in shooter snapshot을 `GameStateSnapshot` base object로 반환한다.
- Node smoke runner는 public package build의 `hashGameStateSnapshot(...)`, `createGameplayReplayRun(...)`, `compareGameplayReplayRuns(...)`를 사용해 expected/actual run을 비교한다.
- mismatch가 있으면 기존 stringified shooter hash보다 더 구체적인 `gameplayReplay.snapshots.N.snapshot...` JSON path diff가 실패 report에 포함된다.
- render/audio/debug/profiler output은 golden replay 비교 범위에 넣지 않고 기존 browser render/budget smoke로 유지한다.

### 2026-05-31: Multi-frame gameplay golden fixture slice

deterministic input stream 기반 multi-frame golden fixture를 저장소에 고정하고 `smoke:check`에 연결했다. 이 slice는 browser rendering을 비교하지 않고, Top-down Shooter raw Wasm runtime의 canonical gameplay state만 비교한다.

- `scripts/gameplay-replay-smoke.mjs`는 raw Wasm `Engine`에 고정 Top-down Shooter spec, texture/sound id, 36 frame input stream, `1 / 60` fixed delta를 적용한다.
- capture frame은 `0, 1, 2, 4, 8, 16, 24, 32, 36`으로 고정하고 각 frame의 scene metric과 built-in shooter snapshot을 `GameStateSnapshot`으로 묶는다.
- fixture scenario는 deterministic enemy spawn, projectile travel, enemy damage, score reward까지 포함한다.
- `docs/engine/gameplay-golden/topdown-basic-replay.json`은 committed golden fixture이며 현재 expected replay hash는 `2f77d0f1`이다.
- `pnpm smoke:gameplay-replay`는 실제 실행 결과와 fixture를 `compareGameplayReplayRuns(...)`로 비교하고, mismatch 시 첫 frame/path/value diff를 출력한다.
- `pnpm update:gameplay-replay-golden`은 의도한 gameplay behavior 변경 이후 baseline을 재생성하는 명시적 명령이다. baseline update는 replay hash 변경 이유와 기대 gameplay 변화를 같이 리뷰해야 한다.
- fixture metadata(format/version/scenario/frame count/fixed delta/capture frames/input events)가 script 계약과 다르면 비교 전 실패한다. 입력 stream 자체를 바꾸는 변경은 script, fixture, 문서를 함께 갱신해야 한다.

이 slice는 full visual replay, screenshot golden, audio event golden이 아니다. render/audio/debug/profiler output은 기존 browser render/budget smoke 범위로 유지한다.

### 2026-06-01: Gameplay replay scenario manifest slice

golden replay의 scenario 계약을 smoke script 내부 상수에서 `docs/engine/gameplay-golden/scenarios.json` manifest로 분리했다. 이 manifest는 agent가 replay 입력과 기대 결과를 한 곳에서 읽고 patch할 수 있게 하는 비-hot-path authoring artifact다.

- manifest는 format/version/fixed delta, scenario id, runner, fixture path, frame count, capture frame, input event, expected replay hash와 score/event/FSM metadata를 고정한다. 장르별 setup과 exact payload assertion은 runner가 소유한다.
- `scripts/gameplay-replay-smoke.mjs`는 manifest를 읽어 runner를 materialize하고, fixture metadata와 manifest의 input event가 일치하지 않으면 replay 비교 전에 실패한다. scenario가 `variantPath`를 가지면 Top-down authored behavior variant도 읽어 scene instance, physics body metadata, behavior recipe command, FSM expected state가 replay authoring event와 일치하는지 검증한다.
- input stream은 frame별 `press` event에서 계산한다. authored behavior scenario의 spawn body/component/FSM setup도 `authoring` event metadata에서 읽는다.
- `--scenario=<id>`는 manifest scenario id를 선택하고, `--manifest <path>`는 실험용 scenario manifest를 실행한다.
- 이 slice는 runtime API를 추가하지 않고, 결정적 replay smoke와 agent 자기수정 신호의 source of truth를 파일 기반 manifest로 옮긴다.

### 2026-06-01: Top-down authored behavior variant slice

raw Wasm smoke 전용으로 남아 있던 authored behavior fixture를 `examples/topdown-shooter`의 데이터 authoring artifact와 연결했다. 메인 `game.json` schema를 넓히지 않고, 별도 variant 파일이 기존 Game Spec을 참조한 뒤 SceneComposition/BehaviorRecipe/FSM/replay scenario를 함께 묶는다.

- `examples/topdown-shooter/public/authored-behavior.variant.json`은 `extendsGameSpec: "./game.json"`으로 기준 shooter spec을 참조하고, `replayScenario: "topdown-authored-behavior"`로 golden replay manifest와 연결한다.
- `docs/engine/gameplay-golden/scenarios.json`의 `topdown-authored-behavior.variantPath`도 이 파일을 가리키므로, replay smoke가 variant와 authored event metadata의 drift를 직접 잡는다.
- variant의 `sceneComposition`은 score pickup, interaction source, test projectile, rewarded enemy instance를 만들고 각 instance의 `props.behaviorRecipes`를 profile id에 묶는다. `props.replayBody`와 `props.physicsBody`는 replay scenario authoring body metadata와 일치해야 하며, `props.behaviorStateMachine`은 FSM machine id와 resolved instance id를 명시적으로 연결한다.
- `behaviorRecipes`는 score pickup, interaction action id `7`, projectile damage, enemy health/score reward `11`을 선언한다.
- `behaviorStateMachines`는 interaction event와 collisionDamage event를 받는 최소 FSM을 선언한다. 이 FSM은 runtime hot path callback이 아니라 public TS authoring API가 검증하고 Rust-owned FSM install plan으로 변환할 수 있는 데이터다. variant의 기대 상태는 numeric id가 아니라 `expected.states` 문자열로 저장하고, smoke가 install plan으로 numeric state id를 파생한다.
- `scripts/topdown-authored-behavior-variant-smoke.mjs`와 `pnpm smoke:topdown-authored-behavior-variant`는 public package build에서 base Game Spec, composition binding dry-run, FSM install plan, replay body metadata, replay hash/score/event metadata 연결을 검증한다.

이 slice는 authored behavior fixture를 실제 browser runtime data loading으로 연결하지 않는다. 그 대신 agent가 예제 하위 데이터 파일 하나를 patch하면 prefab/behavior/FSM/replay 계약이 모두 검증되는 중간 지점을 만든다.

### 2026-06-01: Top-down authored behavior runtime metadata slice

authored behavior variant를 browser runtime에서도 낮은 빈도 metadata로 로드하게 했다. 이 slice는 gameplay entity를 자동 spawn/apply하지 않고, 예제 런타임이 sidecar authoring artifact를 asset manifest로 읽고 public authoring API 검증 결과를 smoke가 관측할 수 있게 만드는 범위다.

- `examples/topdown-shooter/src/main.ts`는 `authored-behavior.variant.json`을 `AssetManifest.json.authoredBehaviorVariant`로 preload/load한다.
- 로드 후 `resolveBehaviorRecipeDocument(...)`, `resolveSceneCompositionSpec(...)`, `dryRunSceneBehaviorRecipes(...)`, `resolveBehaviorStateMachineDocument(...)`, `createBehaviorStateMachineRuntimeInstallPlan(...)`를 실행해 summary를 만든다.
- summary는 `window.ferrumTopdownAuthoredBehaviorVariant`에 노출되며 replay scenario id, command count, instance count, machine id, expected replay hash, string state에서 파생한 runtime state id를 포함한다.
- `scripts/browser-render-smoke.mjs --mode=topdown-authored-behavior-variant`와 `pnpm smoke:topdown-authored-behavior-runtime`은 production Top-down build에서 이 summary가 노출되는지 확인한다.

이 경로는 여전히 visual editor나 scripting runtime이 아니며, TS가 production frame hot path behavior evaluation을 소유하지 않는다. 다음 단계가 필요하다면 이 metadata를 실제 scene load/apply toggle로 연결하되, replay/rollback 가능한 저빈도 apply 경계로 설계해야 한다.

### 2026-06-01: Top-down authored behavior browser playable smoke slice

metadata-only 단계에서 멈추지 않고, Production Top-down Shooter build에 query 기반 demo apply toggle을 추가했다. `authoredBehaviorVariantApply=true`가 있을 때만 sidecar variant를 scene load 이후 낮은 빈도 경계에서 실제 Rust runtime data로 적용한다.

- `FerrumEngine`에 `FerrumGameplayAuthoringApi` typed facade를 합성했다. public API는 raw `set_gameplay_*` Wasm setter를 노출하지 않고, `applyGameplayBehaviorCommands(...)`, `installBehaviorStateMachineRuntime(...)`, `gameplayBehaviorState(...)`, current-state command plan/apply method만 제공한다.
- Top-down 예제는 variant의 resolved `SceneComposition` instance를 `spawnRigidBody(...)`로 만들고, `props.physicsBody`의 numeric layer를 public `PhysicsCollisionLayer` 이름으로 변환한다. Production `game.json`의 타일맵 장애물을 피하기 위해 browser demo placement는 variant `semantics.browserPlacement`의 anchor/target/scale 계약으로 replay fixture 좌표를 player 중심 주변에 압축한다.
- 생성된 instance handle map으로 `BehaviorRecipeCommand[]`를 적용하고, `props.behaviorStateMachine`이 있는 instance에는 resolved FSM을 Rust-owned FSM component로 설치한다.
- `window.ferrumTopdownAuthoredBehaviorVariant.runtimeApply`는 applied instance count, command count, installed FSM count, handle map, placement offset/scale, initial/current state id와 `applyId`를 노출한다.
- `window.ferrumTopdownAuthoredBehaviorFrame`은 onFrame에서 decoded `FrameState.gameplayEvents`를 plain object로 복사/누적한다. Wasm buffer view를 보관하지 않고 event summary와 현재 `applyId`만 저장한다.
- `scripts/browser-render-smoke.mjs --mode=topdown-authored-behavior-variant`는 smoke URL에 `authoredBehaviorVariantApply=true`를 붙이고 runtime apply summary를 검증한 뒤, shooter를 Title에서 Playing으로 진행시켜 score `14`, `interaction`/`collisionDamage` event payload, one-shot interaction non-repeat, authored FSM state `2/2`를 검증한다.

이 slice도 frame hot path에 TS callback을 추가하지 않는다. 적용은 scene load/user-triggered/agent apply 같은 낮은 빈도 경계이고, state entry마다 behavior profile을 자동 apply/clear하는 runtime은 아니다. 현재 apply path는 transaction이 아니므로 agent는 dry-run diagnostic과 replay smoke를 통과한 뒤 적용해야 한다. 실제 gameplay transition 후 state-enter command를 자동 적용하려면 Rust-owned state-enter system 또는 rollback 가능한 state diff를 별도 설계해야 한다.

### 2026-06-01: Top-down authored behavior reset/re-apply smoke slice

browser playable smoke에 reset 경계를 추가했다. `resetGame()`은 Shooter World를 새로 만들기 때문에 이전 authored instance handle은 World epoch 안에서만 유효하다. 새 World의 entity id/generation 숫자가 우연히 같을 수 있으므로 handle freshness를 id 차이로 판단하지 않고, demo apply마다 증가하는 `applyId`를 smoke 계약으로 둔다.

- `ferrumTopdownAuthoredBehaviorResetAndReapply()`는 public `FerrumEngine` API가 아니라 `authoredBehaviorVariantApply=true` browser smoke/demo 모드에서만 노출되는 window-only helper다.
- helper는 smoke frame summary를 비우고, `resetGame()`을 호출한 뒤, prepared variant를 다시 spawn/apply/install하고 `runtimeApply`를 새 handle map과 새 `applyId`로 교체한다.
- smoke는 reset 직후 frame summary가 비어 있는지, re-apply summary가 instance `5`, command `6`, FSM `2`, initial/current FSM `1/1`, `applyId=2`인지 확인한다.
- 두 번째 Playing run에서도 score `14`, `interaction`/`collisionDamage` event payload, source/actor handle, FSM state `2/2`가 현재 `runtimeApply.handles`와 일치하는지 검증한다.
- 추가 follow-up wait로 one-shot interaction event가 두 번째 apply run 안에서도 중복 발행되지 않는지 확인한다.

이 slice는 reset을 자동으로 hook하거나 public reset lifecycle API를 추가하지 않는다. agent/runtime이 World를 재생성하는 경우에는 해당 World/apply epoch의 handle map을 다시 만들고 낮은 빈도 apply 경계에서 재적용해야 한다는 정책만 browser smoke로 고정한다.

### 2026-06-01: Top-down authored behavior current-state command apply smoke slice

FSM transition 후 state behavior profile을 실제 component apply 경로와 연결하는 smoke를 추가했다. 이 slice도 자동 state-enter runtime이 아니라, browser smoke/demo helper가 명시적으로 호출하는 낮은 빈도 apply 경계다.

- variant `semantics.fsmStateEntryMode`를 `manualReplaceSupported`로 명시했다. 이는 runtime frame loop가 state-enter callback을 실행한다는 뜻이 아니라, helper가 current state command plan을 `replaceSupported` mode로 적용한다는 뜻이다.
- `runtimeApply`는 FSM install plan을 함께 보관한다. install plan은 numeric state id를 authored state 문자열로 역매핑하는 source of truth이며, spec을 다시 해석한 최신 plan으로 현재 runtime state id를 추정하지 않는다.
- `ferrumTopdownAuthoredBehaviorApplyCurrentStateCommands()`는 public `FerrumEngine` method를 조합하는 window-only helper다. `createBehaviorStateMachineCurrentStateCommandPlan(...)`으로 현재 state를 읽고, `applyBehaviorStateMachineStateCommands(..., { mode: "replaceSupported" })`로 현재 지원 component subset을 clear/apply한다.
- 현재 authored variant의 final state 중 `triggered`는 비어 있어 이전 interaction component와 action binding을 clear하는 경로를 보고, `spent`는 `projectile.spent` behavior profile의 `configureLifetime` 1건을 적용한다. smoke는 `triggered` command count `0`/result count `9`, `spent` command type `configureLifetime`/result count `10`, state id `2/2`를 검증해 clear-only와 non-empty state profile apply를 함께 본다.
- reset/re-apply 이후 같은 helper가 두 번째 `applyId`에서도 동작해야 한다. stale handle을 피하기 위해 helper는 항상 현재 `runtimeApply.handles`와 같은 `runtimeApply.installPlans`를 사용한다.

이 slice는 state transition 순간마다 자동으로 command를 apply하지 않는다. 완전한 state-enter runtime이 필요해지면 Rust-owned state-enter system 또는 rollback 가능한 state diff를 별도 설계해야 한다. 현재는 agent가 replay/smoke 신호를 보고 명시적으로 apply할 수 있는 제품 경계를 검증한 것이다.

### 2026-06-01: Behavior FSM state-change telemetry slice

Rust-owned FSM transition 결과를 `GameplayEvent` bulk buffer로 관측할 수 있게 했다. 이 slice는 state-enter command 자동 적용이 아니라, transition 결과를 callback 없이 frame-end telemetry로 노출하는 범위다.

- Rust FSM runtime은 frame 끝에서 입력 `GameplayEvent` slice를 읽어 matching source entity의 FSM을 최대 1회 전이한 뒤, 같은 frame event buffer에 `behaviorStateChanged` event를 추가한다.
- 새 event kind code는 `4`다. actor/source는 모두 FSM entity handle이고, `payload_bits`는 previous runtime state id, `token_id`는 next runtime state id다.
- transition 판정은 함수 진입 시점의 input event count까지만 읽는다. 새로 추가한 `behaviorStateChanged` event가 같은 pass에서 다시 transition input으로 소비되지 않도록 막는다.
- TS decoder와 `gameplayActionsForEvents(...)`는 `behaviorStateChanged`를 decode/action으로 변환한다. action은 `previousStateId`, `nextStateId`, actor/source handle, 원본 event를 담는다.
- Top-down authored runtime smoke는 interaction-source와 test-projectile FSM이 각각 `1 -> 2`로 전이했는지 `behaviorStateChanged` 2건으로 검증하고, reset/re-apply 후에도 현재 `applyId`의 handle과 payload가 맞는지 확인한다.

이 slice는 여전히 per-entity JS callback, transition callback, 자동 state-entry runtime이 아니다. authoring agent와 demo harness가 Rust frame loop의 FSM 결과를 안정적으로 관측할 수 있게 하는 중간 단계다.

### 2026-06-01: Browser placement semantics slice

replay fixture 좌표와 production browser demo placement 차이를 code constant가 아니라 variant 데이터 계약으로 옮겼다.

- `semantics.browserPlacement`는 `anchorReplayBody`, `target`, `scale`을 가진다. 현재 Top-down authored variant는 replay body `pickup`을 browser world center에 맞추고 scale `0.4`로 fixture를 압축한다.
- `schemas/topdown-authored-behavior-variant.schema.json`을 추가하고 variant `$schema`가 이를 참조하게 했다. schema는 envelope, `semantics`, `sceneComposition`, `behaviorRecipes`, `behaviorStateMachines`, expected replay metadata의 기본 shape를 제공한다.
- `pnpm validate:topdown-authored-behavior-variant`는 기존 semantic smoke validator를 명시적 validation command로 노출한다.
- Top-down runtime은 `authoredBehaviorPlacement(...)`에서 이 계약을 읽고, anchor replay body가 scene instance에 없거나 target/scale이 유효하지 않으면 bootstrap diagnostic으로 실패한다.
- `runtimeApply` summary는 `placementAnchorReplayBody`, `placementTarget`, `placementScale`을 노출한다. smoke는 hardcoded 계산 결과뿐 아니라 variant가 선언한 placement 계약이 runtime summary에 반영됐는지도 확인한다.
- `scripts/topdown-authored-behavior-variant-smoke.mjs`는 `semantics.browserPlacement` 구조와 anchor replay body가 실제 scene instance에 존재하는지 검증한다.

이 slice는 replay fixture 자체를 browser용으로 바꾸지 않는다. raw Wasm replay는 원래 좌표를 유지하고, browser demo만 production tilemap 장애물을 피하기 위해 명시된 placement transform을 적용한다.

### 2026-05-31: Behavior FSM authoring schema/API slice

의사결정/시퀀싱을 flat enum으로 계속 늘리지 않기 위해, visual editor나 scripting runtime 없이 JSON-friendly 최소 FSM authoring 계약을 추가했다. 이 slice는 Rust executor가 아니라 schema/API 초안이며, state가 기존 behavior profile을 참조하고 transition이 `GameplayEventAction` vocabulary를 참조하도록 범위를 제한했다.

- `resolveBehaviorStateMachineDocument(...)`는 machine/state/transition 구조를 resolved contract로 만들고, initial state, transition target, behavior profile reference를 machine-actionable diagnostic으로 검증한다.
- state의 `behaviorRecipes`는 `SceneComposition`의 `behaviorRecipes` prop과 같은 문자열 또는 문자열 배열 모델을 사용한다. 별도 entity 모델을 만들지 않고 기존 `BehaviorRecipeDocumentSpec.entities` profile을 재사용한다.
- transition predicate는 현재 `type: "gameplayEvent"`, `event: "interaction"`만 지원하고, `action` 또는 `actionId` 중 하나 이상을 요구한다. 이는 직전 slice의 `GameplayEventAction` contract를 그대로 소비하기 위한 의도적인 최소 범위다.
- `behaviorStateMachineBehaviorProfilesForState(...)`와 `behaviorStateMachineCommandsForState(...)`는 특정 state가 적용할 behavior profile과 기존 `BehaviorRecipeCommand[]`를 dry-run/agent planning 단계에서 확인할 수 있게 한다.

이 slice는 TS가 frame hot path의 gameplay state machine을 실행한다는 뜻이 아니다. runtime transition 실행, Rust component storage, replay hash/diff는 후속 slice에서 Rust-owned system으로 별도 설계한다.

### 2026-05-31: Behavior FSM transition replay/diff slice

FSM executor를 Rust runtime에 넣기 전에, agent가 FSM transition semantics를 deterministic하게 검증할 수 있는 TS-only dry-run replay helper를 추가했다. 이 helper는 production frame loop가 아니라 offline validation 도구이며, interaction `GameplayEventAction` frame stream을 읽어 state transition 결과와 replay hash를 만든다.

- `runBehaviorStateMachineReplay(...)`는 resolved FSM 또는 `behaviorRecipes`로 검증 가능한 raw FSM을 입력으로 받고, frame별 `GameplayEventAction[]`에 따라 state transition을 계산한다.
- transition 평가는 state의 transition 배열 순서가 우선이며 frame당 최대 1개 transition만 발생한다. 이 ordering contract를 먼저 고정해 향후 Rust executor와 TS dry-run이 다른 순서를 쓰는 위험을 줄인다.
- 이 slice 시점의 replay용 predicate는 numeric `actionId`를 필수로 요구했다. `action` string은 사람이 읽는 metadata로 유지하되, `actionId`가 있으면 transition match와 replay/golden 비교의 canonical key로 쓰지 않는다.
- replay frame 번호는 strictly increasing이어야 한다. replay hash에는 actor/source entity id뿐 아니라 generation도 포함해 stale handle 차이를 잡는다.
- `compareBehaviorStateMachineReplay(...)`는 expected/actual hash, final state, first mismatch frame을 반환한다.

이 slice는 roadmap의 full golden gameplay replay를 완료한 것이 아니다. 다만 FSM transition vocabulary에 대한 작은 replay diff 신호를 먼저 제공해, agent가 schema 변경의 의미 차이를 smoke보다 정밀하게 볼 수 있게 했다.

### 2026-05-31: Rust-owned Behavior FSM state runtime slice

FSM transition 실행을 TS frame-end callback이나 per-entity Wasm setter 반복으로 처리하지 않고, Rust-owned entity component와 frame-end gameplay system으로 연결했다. 이 slice는 behavior profile 적용까지 자동화하지 않고, numeric state/action id로 state transition만 먼저 닫는다.

- `BehaviorStateMachine` component는 current state id와 bounded transition set을 generation-aligned `World` storage에 저장한다. spawn/despawn/snapshot restore lifecycle에 포함해 stale entity reuse와 save/replay drift를 피한다.
- authoring surface는 `set_gameplay_behavior_state_machine(...)`, `add_gameplay_behavior_transition(...)`, `clear_gameplay_behavior_state_machine(...)`, `gameplay_behavior_state(...)`로 제한했다. state/action은 모두 positive `u32` token이며 문자열은 Rust hot path에 들어가지 않는다.
- 이 slice 시점의 runtime은 이미 Rust에서 생성된 `GameplayEvent` buffer를 읽고, interaction event의 `source` entity에 붙은 FSM만 전이했다. predicate key는 `event.token_id == action_id`와 source generation이다.
- transition 평가는 component에 저장된 transition 순서를 우선하고, entity당 render frame마다 최대 1개 transition만 발생한다. fixed timestep에서 여러 substep이 같은 interaction event를 보더라도 FSM 적용은 `Engine::advance_simulation(...)` 끝에서 한 번만 실행한다.
- 이 slice는 behavior state에 따라 recipe command를 자동 적용하지 않는다. 다음 단계는 current state id를 TS-resolved behavior profile 또는 Rust component apply plan과 연결하는 것이다.

이 경로도 `GameplayEvent` ABI layout을 바꾸지 않고, 새 broadphase/충돌 query를 추가하지 않으며, TS가 production frame hot path의 behavior evaluation을 소유하지 않는다.

### 2026-05-31: Behavior FSM runtime install adapter slice

Rust-owned FSM runtime을 사용자가 작성한 문자열 기반 FSM spec과 연결하는 낮은 빈도 TS install helper를 추가했다. 이 adapter는 frame loop에서 transition을 실행하지 않고, scene load 또는 agent apply 시점에만 resolved FSM을 numeric runtime data로 변환해 Rust setter를 호출한다.

- 이 slice 시점의 `createBehaviorStateMachineRuntimeInstallPlan(...)`은 state 문자열을 deterministic code-unit 정렬 순서의 positive state id로 변환하고, transition을 `{ fromStateId, toStateId, actionId }` plan으로 만들었다.
- 이 slice 시점의 runtime transition predicate에는 positive safe `u32` `actionId`가 필수였다. `action` 문자열만 있는 predicate는 replay/authoring metadata로는 허용되더라도 Rust runtime install에서는 diagnostic으로 거부한다.
- 현재 Rust component cap에 맞춰 `BEHAVIOR_STATE_MACHINE_RUNTIME_MAX_TRANSITIONS = 8`을 public constant로 노출하고, 초과 transition은 setter 실패 전 TS validation에서 차단한다.
- `installBehaviorStateMachineRuntime(...)`은 기존 FSM component를 clear하고 initial state/transition set을 설치한다. transition 적용 중 실패하면 다시 clear해 partial install을 남기지 않지만, 이전 FSM을 복원하는 transaction은 아니다.

생성된 numeric state id는 install plan 내부 계약이다. save data, authored spec, agent patch에는 state 문자열을 source of truth로 유지해야 하며 state 추가/이름 변경 시 numeric id가 바뀔 수 있다. 아직 state enter 시 behavior profile command 자동 적용은 하지 않는다.

### 2026-05-31: Behavior FSM current-state command plan slice

FSM current state id를 behavior profile command apply plan과 연결하는 저빈도 helper를 추가했다. 이 slice는 state-enter callback runtime이 아니라, 실제 설치에 사용한 FSM install plan을 기준으로 numeric state id를 state 문자열로 역매핑하고 해당 state의 `behaviorRecipes`를 command plan으로 펼치는 authoring/apply 보조 경로다.

- `createBehaviorStateMachineStateCommandPlan(...)`은 `BehaviorStateMachineRuntimeInstallPlan`, current state id, resolved FSM/recipe를 입력으로 받아 `{ machine, stateId, state, behaviorProfiles, sourceCommands, commands }`를 만든다.
- `createBehaviorStateMachineCurrentStateCommandPlan(...)`은 `gameplay_behavior_state(...)`를 낮은 빈도로 호출해 current state id를 읽고 같은 plan을 만든다. `stateId === 0`은 FSM 미설치/stale handle로 보고 initial fallback을 하지 않는다.
- `applyBehaviorStateMachineStateCommands(...)`는 command를 실제 scene instance id와 generation-checked handle에 retarget한 뒤 기존 `applyGameplayBehaviorCommands(...)` 경로로 적용한다.
- numeric state id 해석 source는 “현재 spec으로 재생성한 plan”이 아니라 “실제로 install에 사용한 plan”이다. spec 변경 후 재생성한 plan으로 Rust current id를 해석하는 오류를 피하기 위해 이 계약을 public API에 명시했다.

현재 기본 적용 semantics는 overlay다. 새 state command에 있는 component만 덮어쓰며, 새 state에 없는 이전 movement/damage/interaction/timer component를 자동 clear하지 않는다.

필요한 경우 `applyBehaviorStateMachineStateCommands(..., { mode: "replaceSupported" })`로 현재 지원하는 gameplay component subset을 clear한 뒤 state command를 적용할 수 있다. 이 mode는 health, damage/collision reaction, lifetime, score reward, pickup, interaction, timer trigger, movement, action binding을 entity profile로 대체하는 낮은 빈도 agent apply/scene load 도구이며, 부분 `kinds` plan이 아니라 완전한 state profile에만 써야 한다. command validation, runtime id lookup, target entity handle lookup은 clear 전에 같은 apply 경로로 preflight해 실패 시 machine-actionable diagnostic을 반환한다. 단, clear 이후 실제 runtime setter 실패를 rollback하는 transaction은 아니므로, agent는 별도 dry-run/diagnostic과 replay 검증을 통과한 plan에만 사용해야 한다. 완전한 state transition apply runtime이 필요해지면 state diff/rollback 또는 Rust-owned state-enter system을 별도 설계한다.

### 2026-05-31: Collision event FSM predicate slice

collision reaction event를 telemetry/frame-end adapter 전용으로만 두지 않고 Behavior FSM transition vocabulary에 포함했다. 이 slice는 event별 JS callback을 추가하지 않고, 기존 Rust-owned `GameplayEvent` bulk buffer와 FSM component transition 평가를 확장한다.

- `BehaviorStateMachineGameplayEventKind`는 `interaction`, `collisionDamage`, `collisionDespawn`을 지원한다.
- `interaction` predicate는 기존처럼 `actionId` 또는 authoring metadata용 `action`을 받는다. deterministic replay/runtime install에는 positive `actionId`가 필요하다.
- `collisionDamage`/`collisionDespawn` predicate는 action id를 받지 않고 event kind 자체를 key로 삼는다. TS replay는 Rust runtime과 동일하게 input `entity` handle과 event `source` id/generation이 일치하는 이벤트만 전이 후보로 보며, replay hash에는 대상 entity, actor/source entity id와 generation, damage/targetRemoved metadata가 포함된다.
- `BehaviorStateTransition`은 기존 action id만 저장하지 않고 event kind와 token id를 저장한다. `add_gameplay_behavior_transition(...)`은 interaction 호환 setter로 유지하고, `add_gameplay_behavior_event_transition(...)`은 event kind + token id 기반 신규 setter로 추가했다.
- Rust runtime은 `Engine::advance_simulation(...)` frame 끝에서 누적 `GameplayEvent` buffer를 한 번 읽고, matching source entity에 붙은 FSM을 transition 순서대로 최대 1회 전이한다. authored collision damage event가 source entity FSM을 실제 `Engine::update_frame(...)`에서 전이시키는 회귀 테스트와 fixed timestep에서 render frame당 최대 1회 전이되는 회귀 테스트를 추가했다.
- TS install helper는 interaction-only runtime engine에는 기존 setter를 계속 사용할 수 있지만, collision predicate를 설치하려면 `add_gameplay_behavior_event_transition(...)`을 요구하고 없으면 machine-actionable diagnostic으로 실패한다. transition 적용 중 예외가 나도 기존 clear/set 이후 partial FSM을 다시 clear한다.

이후 authored behavior golden replay fixture에서 collision event, FSM 전이, state command apply 검증을 같은 deterministic replay gate로 묶었다.

### 2026-05-31: Authored behavior golden replay fixture slice

`smoke:gameplay-replay`에 기본 shooter fixture 외에 authored behavior fixture를 추가했다. 이 fixture는 browser rendering이 아니라 raw Wasm `Engine`에 낮은 빈도 authoring setter를 직접 적용한 뒤 `GameStateSnapshot.custom`까지 포함해 deterministic replay hash를 비교한다.

- `docs/engine/gameplay-golden/topdown-authored-behavior-replay.json`은 committed golden fixture이며, 이후 timer-driven spawnPrefabAction과 pickupCollected telemetry coverage까지 포함한 현재 expected replay hash는 `052aa729`이다.
- scenario는 physics body spawn authoring으로 pickup, interaction source, bullet/enemy pair를 만든 뒤 Rust gameplay setter로 score pickup, interaction event, collisionDamage reaction, source-scoped FSM transition을 설치한다.
- capture frame은 현재 `0, 1, 2, 3, 4, 5`이고, frame 2 custom state는 `collisionDamage`와 `interaction` gameplay event, interaction FSM state `2`, collision FSM state `2`를 포함한다. frame 3은 blocked `spawnPrefabAction` failure, frame 4는 timer-driven prefab spawn/FSM transition, frame 5는 event buffer clear 상태를 고정한다.
- final scene score는 pickup score `3`과 authored collision score reward `11`을 더한 `14`여야 한다.
- `pnpm smoke:gameplay-replay`는 이제 `topdown-basic`과 `topdown-authored-behavior` 두 fixture를 모두 비교한다. 각 scenario는 같은 Wasm build에서 두 번 실행해 actual-vs-actual determinism을 먼저 확인한다.
- authored fixture metadata에는 enter 입력, authoring phase, body spawn data, component/FSM setup data, 기대 event/FSM/score가 들어간다. `--update`도 exact event payload(actor/source id/generation, token, `payloadBits`, `targetRemoved`) 검증을 통과해야 fixture를 쓸 수 있다.
- `pnpm update:gameplay-replay-golden -- --scenario=topdown-authored-behavior`로 단일 fixture만 갱신할 수 있다.

이 slice로 collision reaction, pickup, GameplayEvent, Rust-owned FSM transition이 같은 replay gate 안에서 검증된다. 아직 state-enter command apply를 frame 자동 runtime으로 만든 것은 아니며, current state command plan/apply는 낮은 빈도 authoring helper로 남긴다.

### 2026-06-01: ActionPattern/Cooldown authoring data layout slice

roadmap 2단계의 남은 최소 component 축인 action/cooldown을 바로 runtime 실행으로 붙이지 않고, 먼저 Rust-owned authoring data layout과 lifecycle을 추가했다.

- `components/gameplay.rs`에 crate-private `ActionPattern::Projectile`, `Cooldown`, `ActionBinding`, fixed-capacity `ActionBindingSet`을 추가했다.
- `ActionBindingSet`은 action id 기준 upsert를 사용한다. 같은 action id를 다시 적용하면 binding을 교체하고, 다른 action id가 capacity를 넘으면 실패해 agent apply가 조용히 누락되지 않는다.
- `World`에는 generation-aligned `action_bindings` storage를 추가했고 spawn/despawn/snapshot restore lifecycle에 포함했다.
- `set_gameplay_action_projectile(...)` / `clear_gameplay_actions(...)`는 scene load/agent apply 같은 낮은 빈도 경계에서 generation-checked handle로 action config를 적용한다. `action_id`, cooldown, projectile speed/damage/lifetime 범위를 Rust에서 검증한다.
- 이 slice의 최초 커밋 범위는 projectile spawn, cooldown tick, input action dispatch를 아직 실행하지 않았고 data layout/lifecycle을 먼저 닫았다. 특히 `Cooldown::remaining_seconds`는 ready 상태로 초기화되는 runtime state이므로, 후속 `action_system`에서는 authoring config 재적용이 runtime cooldown을 무조건 reset하지 않도록 config/state 분리 또는 phase 정책을 명시해야 한다.

이 경로도 frame hot path에 JS/TS callback을 추가하지 않는다. 다음 단계는 `ActionBindingSet`을 읽는 Rust `action_system`을 설계하되, spawn/despawn은 deferred command buffer로 처리하고 input/action id 매핑은 bulk input snapshot 또는 Rust-side action state로 닫아야 한다.

### 2026-06-01: Shooter primary projectile ActionBinding runtime slice

`ActionBindingSet`을 runtime에서 실제 소비하는 첫 범위를 Shooter player primary fire로 제한해 붙였다. 이는 범용 action graph가 아니라, 기존 하드코딩 발사 경로를 유지하면서 authored projectile binding이 있을 때만 config를 덮어쓰는 호환 slice다.

- Shooter runtime은 player entity에 action id `1` binding이 있으면 이를 primary fire로 해석한다. `space`/`mouseLeft` 입력이 들어왔을 때 binding cooldown이 ready이면 projectile speed/damage/lifetime을 binding 값으로 사용해 bullet을 spawn한다.
- binding이 없으면 기존 `ShooterConfig`의 `fireCooldown`, `bulletSpeed`, `bulletDamage`, `bulletLifetime` 기반 발사 동작을 그대로 사용한다.
- `World::tick_action_cooldowns(...)`와 cooldown commit helper를 추가해 cooldown tick/commit을 Rust frame loop 안에서 처리한다. frame hot path에 JS/TS callback이나 entity별 Wasm 왕복을 추가하지 않는다.
- 현 구조는 `Cooldown::remaining_seconds`를 `ActionBindingSet` snapshot에 포함한다. 따라서 replay/snapshot restore는 runtime cooldown 상태까지 복원하지만, 낮은 빈도 authoring setter로 같은 action config를 재적용하면 cooldown은 ready로 재설정된다. 범용 `action_system`으로 확대할 때 config/state 분리 또는 재적용 phase 정책을 확정해야 한다.
- built-in Shooter snapshot version을 올려 player primary projectile action binding과 remaining cooldown을 save/load에 포함했다. 이로써 authored primary fire는 restore 뒤에도 기존 `ShooterConfig` fallback으로 조용히 되돌아가지 않는다.

이 slice는 roadmap 3단계의 `action_system` 전체 완료가 아니라, projectile action 실행의 첫 vertical slice다. 아직 action id registry, prefab/spec command 연결, deferred spawn command buffer, dash/melee/spawnPrefab action은 남아 있다.

### 2026-06-01: projectileAction BehaviorRecipe adapter slice

Shooter primary fire의 authored projectile binding을 raw Rust setter로만 적용하지 않고, TS authoring profile에서도 선언할 수 있도록 `BehaviorRecipe` 경로를 연결했다.

- `BehaviorRecipe`에 `projectileAction` kind와 `configureProjectileAction` command를 추가했다. 사용자는 `action`, optional `actionId`, `cooldownSeconds`, `speed`, `damage`, `lifetimeSeconds`를 spec으로 선언한다.
- `applyGameplayBehaviorCommands(...)`는 `actionId` 또는 `ids.actions[action]`으로 runtime action token을 해석한 뒤, scene load/agent apply 같은 낮은 빈도 경계에서 `set_gameplay_action_projectile(...)`을 호출한다. frame hot path JS callback이나 entity별 Wasm 왕복은 추가하지 않는다.
- `set_gameplay_action_projectile`은 `GameplayBehaviorRuntimeEngine`에서 optional method로 유지했다. 기존 custom adapter는 새 method를 즉시 구현하지 않아도 타입 호환성을 유지하고, `configureProjectileAction` command가 실제로 적용될 때만 JSON path가 포함된 diagnostic을 받는다.
- `replaceSupported` state command apply는 action binding도 supported component subset으로 보고 `clear_gameplay_actions(...)`를 요구한다. state-enter command를 재적용하는 경우 cooldown이 ready로 초기화되는 현 정책은 runtime config/state 분리 전까지 명시적 제약으로 남긴다.

이 slice는 “spec으로 projectile action을 선언해 Rust `ActionBindingSet`으로 적용”하는 adapter 경로까지 닫았다. 이후 built-in player handle을 variant binding map에 연결하는 대표 예제는 별도 slice로 추가됐고, dash/melee/spawnPrefab 같은 action kind의 공통 action system 일반화는 아직 남아 있다.

### 2026-06-01: built-in player projectileAction variant binding slice

`projectileAction` recipe가 실제 Top-down Shooter player primary fire에 spec으로 적용되는 대표 예제 경로를 추가했다.

- `FerrumEngine.builtInShooterPlayerHandle()`은 현재 built-in Shooter player entity의 generation-checked handle을 낮은 빈도로 반환한다. `resetGame()` 이후에는 새 player handle을 다시 조회해야 한다.
- authored behavior variant는 `builtin-player` scene instance에 `props.runtimeEntity: "builtinShooterPlayer"`와 `behaviorRecipes: "player.primary"`를 선언한다. 이 instance는 browser demo에서 새 rigid body를 spawn하지 않고 현재 built-in player handle에 retarget된다.
- `player.primary` recipe는 `projectileAction`으로 primary action `primary`, cooldown `0.08`, speed `720`, damage `2`, lifetime `1.6`을 선언한다. runtime action token은 variant `ids.actions.primary = 1` registry에서 해석한다. runtime apply는 기존 `applyGameplayBehaviorCommands(...)` 경로를 사용하므로 frame hot path callback이나 per-entity Wasm 왕복을 추가하지 않는다.
- browser authored behavior smoke는 `runtimeApply`의 built-in player handle과 `BuiltInShooterStateSnapshot` player action binding slot을 확인해, spec-declared projectile action이 Shooter primary fire binding까지 적용됐는지 검증한다.
- 이 slice는 built-in player handle binding의 첫 예제이며, 임의 built-in entity registry나 spawnPrefab/dash/melee action 일반화는 아직 하지 않는다.

### 2026-06-01: authored variant action id registry slice

Top-down authored behavior variant의 numeric gameplay token을 recipe/FSM 본문에 반복하지 않고 root `ids` registry로 모았다.

- variant root에 `ids.items.score = 1`, `ids.actions.primary = 1`, `ids.actions.dash = 2`, `ids.actions.collect-score = 7`을 선언한다. `schemas/topdown-authored-behavior-variant.schema.json`도 같은 registry shape와 필수 key를 검증한다.
- `resolveGameplayBehaviorRuntimeIds(...)`를 public authoring helper로 추가해 named runtime id registry를 positive safe `u32` token map으로 검증한다.
- `projectileAction`, `interaction`, FSM `interaction` predicate는 inline numeric `actionId` 없이 action name을 선언하고, browser runtime apply/FSM install/state command apply는 같은 `ids` registry를 넘겨 Rust component storage에 numeric id만 적용한다.
- `createBehaviorStateMachineRuntimeInstallPlan(...)`과 `runBehaviorStateMachineReplay(...)`는 interaction predicate의 `actionId`가 없을 때 `ids.actions[action]`을 canonical runtime token으로 사용한다. registry 없이 action string만 있는 deterministic replay/runtime install은 여전히 diagnostic으로 실패한다.
- 이 slice는 TS load/authoring validation 경계만 바꾸며, Rust hot path는 기존처럼 numeric `u32` action id를 `ActionBindingSet`과 FSM transition token으로 소비한다. Shooter primary fire가 action id `1`을 특별히 해석하는 제약은 공통 action system 전까지 유지한다.

### 2026-06-01: Shooter projectile deferred spawn buffer slice

Shooter primary fire가 input/action phase 중 `World`를 즉시 구조 변경하지 않고, phase-local spawn command buffer에 projectile spawn을 적재한 뒤 physics/world integration 전에 일괄 flush하도록 첫 deferred spawn 경로를 추가했다.

- `ShooterScene`은 `pending_spawns` buffer를 가지며, 현재 command vocabulary는 projectile spawn만 포함한다. command에는 transform, velocity, texture id, lifetime, template, damage, optional projectile arc, shoot audio event metadata가 모두 numeric/value data로 들어간다.
- `apply_player_input(...)`은 authored `ActionBindingSet` primary projectile fire와 기존 `ShooterConfig` fallback fire 모두 bullet을 직접 spawn하지 않고 `queue_projectile_spawn(...)`만 호출한다.
- `update_internal(...)`은 player input phase 직후, enemy movement/world update/tile collision 전에 `flush_pending_spawns(...)`를 호출한다. 따라서 spawned bullet은 기존처럼 같은 frame의 integration과 collision pipeline에 참여하면서도 structural mutation 위치는 phase boundary로 명시된다.
- 기존 테스트/호환 helper `fire_bullet_toward_mouse(...)`는 test-only 즉시 spawn helper로 남겨 prefab/audio/arc 단위 테스트를 크게 흔들지 않게 했다. production frame path는 deferred buffer를 사용한다.
- `reset_playing(...)`과 shooter snapshot restore는 pending spawn buffer를 clear해 reset/restore 이후 stale spawn command가 다음 frame에 적용되지 않게 했다.

이 slice는 deferred spawn command buffer의 첫 적용 지점이다. enemy wave spawn, state-enter spawnPrefab, dash/melee action은 아직 이 buffer를 사용하지 않는다. 다음 단계에서 command vocabulary를 `spawnPrefab` 또는 enemy/pickup spawn까지 넓힐 때는 phase(`pre-physics`, `post-collision`, `end-of-frame`)와 rollback/diagnostic 정책을 명시해야 한다.

### 2026-06-01: dashAction authoring/runtime slice

`dashAction`을 projectile과 같은 spec-first action 경로에 추가하되, 실행 범위는 built-in Shooter player의 discrete dash로 제한했다. 이는 visual editor나 JS callback이 아니라, 낮은 빈도 authoring command가 Rust `ActionBindingSet`을 설정하고 Rust frame loop가 action id `2`를 소비하는 vertical slice다.

- `BehaviorRecipe`에 `dashAction` kind와 `configureDashAction` command를 추가했다. 사용자는 `action`, optional `actionId`, `cooldownSeconds`, `distance`를 spec으로 선언한다.
- `applyGameplayBehaviorCommands(...)`는 `actionId` 또는 `ids.actions[action]`으로 runtime token을 해석하고, `set_gameplay_action_dash(...)`가 있는 runtime engine에만 적용한다. missing setter와 invalid value는 JSON path가 포함된 diagnostic으로 실패한다.
- Shooter runtime은 Playing 상태에서 Enter rising edge가 들어왔을 때 player의 action id `2` binding을 확인한다. binding pattern이 `Dash`가 아니면 cooldown을 소비하지 않고, Dash이면 현재 이동 입력 방향, 없으면 mouse world 방향으로 player transform을 `distance`만큼 이동한다.
- Top-down authored behavior variant는 `player.primary` profile에 `dashAction`을 함께 선언하고, `ids.actions.dash = 2`로 registry를 고정했다. browser smoke는 runtime command count `7`과 built-in player dash binding(action id `2`, cooldown `0.75`, distance `96`)을 확인한다.
- built-in Shooter snapshot version을 `3`으로 올려 player primary projectile action과 dash action binding/cooldown을 함께 save/load했다. 이후 action-to-input registry slice에서 input edge state 보존을 위해 version `4`로 다시 올렸다.

이 slice는 dash를 공통 `action_system`으로 일반화한 것이 아니다. input mapping은 아직 built-in Shooter의 Enter edge에 고정되어 있고, collision sweep/obstacle stop이 아닌 transform displacement다. obstacle-aware dash, melee, spawnPrefab, action-to-input registry 일반화는 다음 action vocabulary 확장에서 별도 결정해야 한다.

### 2026-06-01: meleeAction authoring data slice

`meleeAction`은 projectile/dash와 같은 `ActionBindingSet` vocabulary에 추가하되, 이번 slice에서는 runtime 실행을 의도적으로 붙이지 않았다. 현재 Rust `InputState`에는 `space`, `enter`, `mouse_left`만 있고 Shooter는 `primary=1`, `dash=2`를 하드코딩해서 소비하므로, melee를 지금 실행까지 연결하면 primary fire 또는 dash와 입력 충돌이 생긴다.

- `ActionPattern::Melee { range, damage }`와 `ActionBinding::melee(...)`를 추가했다. cooldown은 기존 `Cooldown`을 재사용하며, 고정 크기 `ActionBindingSet`에 action id 기준 upsert된다.
- `set_gameplay_action_melee(...)`는 scene load/agent apply 같은 낮은 빈도 경계에서 generation-checked handle, positive action id, non-negative cooldown, positive range/damage를 검증한 뒤 Rust-owned action binding data를 적용한다.
- `BehaviorRecipe`에는 `meleeAction` kind와 `configureMeleeAction` command를 추가했다. TS adapter는 `actionId` 또는 `ids.actions[action]`으로 runtime token을 해석하고, runtime engine이 `set_gameplay_action_melee(...)`를 제공하지 않으면 JSON path diagnostic으로 실패한다.
- public API 문서에는 `meleeAction`이 현재 authoring data/apply 경로만 제공하며, built-in Shooter frame loop 입력 실행은 action-to-input registry 또는 새 입력 비트 결정 뒤 별도 slice에서 연결해야 한다고 명시했다.

이 slice는 visual editor, scripting runtime, JS hot-path callback, 임시 hitbox entity를 추가하지 않는다. 다음 실행 slice는 melee runtime을 바로 하드코딩하기보다, 기존 `primary`/`dash`도 함께 보존하는 action-to-input registry를 먼저 도입해 action id와 physical control의 결합을 데이터화하는 것이 안전하다.

### 2026-06-01: action-to-input registry runtime slice

Shooter player action 실행에서 physical input과 runtime action id의 결합을 분리했다. `InputState` ABI는 그대로 유지하고, Rust `Engine`이 fixed-capacity `InputActionRegistry`를 소유한다.

- 기본 registry는 action id `1`을 Space down 또는 MouseLeft down에, action id `2`를 Enter pressed에 매핑한다. 따라서 기존 Shooter primary fire/dash UX는 유지된다.
- 낮은 빈도 Wasm authoring surface로 `set_input_action_binding(actionId, bindingIndex, controlCode, activationCode)`, `clear_input_action_bindings(actionId)`, `reset_input_action_bindings()`를 추가했다. control code는 Space `1`, Enter `2`, MouseLeft `3`이고 activation code는 Down `1`, Pressed `2`이다.
- `ShooterScene::apply_player_input`은 더 이상 primary fire를 `space || mouse_left`, dash를 `enter rising edge`로 직접 판단하지 않고, registry에 action id `1`/`2`가 active인지 질의한다. 이동 축, title start, game-over restart는 아직 장면 제어 입력이라 기존 raw input을 유지한다.
- fixed timestep latch는 기존 `InputState` edge 보존을 그대로 사용한다. registry의 `Pressed` activation은 Rust scene의 previous digital state와 current/latch-applied input을 비교하므로 추가 JS callback이나 per-frame boundary crossing이 없다.
- MouseLeft pressed 같은 custom binding도 결정적으로 replay되도록 Shooter snapshot version을 `4`로 올리고 Rust input action registry와 `previous_mouse_left` edge state를 snapshot header에 포함했다.

이 slice 시점에는 input action registry를 public `FerrumEngine` facade의 typed spec API까지 승격하지 않았고, Rust/Wasm authoring surface와 built-in Shooter runtime 연결만 완료했다. 이후 melee runtime slice에서 새 physical input bit를 추가하지 않고 이 registry에 action id `3` binding을 선언하는 방식으로 public facade까지 확장했다.

### 2026-06-01: meleeAction runtime slice

`meleeAction` authoring data를 built-in Shooter player runtime까지 연결했다. 이번 slice도 JS callback이나 임시 hitbox entity가 아니라, low-frequency spec/apply가 Rust `ActionBindingSet`과 input action registry를 설정하고 Rust frame loop가 deterministic하게 실행하는 vertical slice다.

- Shooter runtime은 action id `3`을 player melee로 해석한다. 기본 physical binding은 추가하지 않아 기존 primary fire/dash 입력과 충돌하지 않는다.
- public `FerrumEngine` facade에 `setInputActionBinding(...)`, `clearInputActionBindings(...)`, `resetInputActionBindings()`를 추가해 사용자가 action id `3`을 `space`/`enter`/`mouseLeft`와 `down`/`pressed` activation에 명시적으로 연결할 수 있게 했다. raw Wasm numeric setter는 계속 낮은 빈도 내부 surface로 남는다.
- player input phase는 melee 입력이 active이고 player에 `ActionPattern::Melee { range, damage }` binding이 있으면 cooldown ready 여부를 확인한 뒤 `pending_melee_attacks` command를 큐잉한다. valid swing은 enemy hit가 없어도 cooldown을 소비한다.
- collision/action phase는 persistent `melee_hits` scratch buffer와 `circle_query_with_height_span_into(...)`를 사용해 per-swing allocation을 피한다. enemy hit에는 `damage`를 적용하고, kill 시 기존 score reward/despawn path를 재사용한다.
- melee damage는 input phase에서 직접 `World` 구조를 바꾸지 않고 combat phase에서 처리한다. 따라서 projectile deferred spawn과 마찬가지로 structural mutation 지점이 phase boundary로 고정된다.
- `GameplayEvent::collisionDamage`와 collision hit telemetry는 melee damage 결과 관측에도 사용한다. 이는 물리 충돌 callback이 아니라 “Rust가 적용한 damage result” 신호라는 의미로 public API 문서를 갱신했다.
- built-in Shooter snapshot version을 `5`로 올려 player melee binding/cooldown, input action registry, input edge state를 save/load한다. restore 시 pending melee command는 버린다.

이 slice는 아직 공통 `action_system` 완료가 아니다. primary projectile, dash, melee가 같은 `ActionBindingSet`과 input registry를 사용하지만 실행 코드는 built-in Shooter player path에 남아 있다. 다음 후보는 이 세 경로의 phase, cooldown, telemetry, failure semantics를 표로 고정한 뒤 공통 action dispatch 함수로 묶을지 결정하는 것이다. `spawnPrefabAction`은 Rust-side prefab/template registry와 spawn phase policy가 정리된 뒤 다룬다.

### 2026-06-01: Shooter authored action dispatch commonization slice

primary projectile, dash, melee가 각각 `ActionBindingSet` lookup, expected pattern check, cooldown trigger를 반복하던 부분을 작은 Rust helper로 분리했다. 목표는 범용 action graph를 새로 만드는 것이 아니라, 이미 완료된 vertical slice들의 공통 실행 계약을 한 곳에 모아 `spawnPrefabAction` 같은 다음 action vocabulary를 붙일 때 의미 차이를 줄이는 것이다.

- `shooter_scene/runtime/actions.rs`에 `ActionPatternKind`, `InputActionTrigger`, `prepare_input_action_if_ready(...)`, `commit_prepared_input_action(...)`를 추가했다.
- helper는 `InputActionRegistry`의 active/pressed 판정과 `ActionBindingSet`의 pattern/cooldown ready check를 함께 처리하고, 최초 slice에서는 `Inactive`, `Missing`, `PatternMismatch`, `CoolingDown`, `Ready(ActionBinding)`을 구분했다. 이후 prepared action commit token slice에서 ready payload가 `Ready(PreparedAction)`으로 승격되어 prepare/commit 사이의 source entity, action id, pattern kind, binding identity를 보존한다. primary fire는 `Missing`일 때만 기존 `ShooterConfig` fallback fire를 유지하고, inactive/pattern mismatch/cooldown 중에는 기존처럼 fallback하지 않는다.
- dash/melee는 transform 확인 이후 helper를 호출해 transform이 없는 경우 cooldown을 소비하지 않는 기존 동작을 유지한다.
- helper는 `InputState`와 `ActionBinding`을 `Copy` 값으로 다루고 closure/dynamic dispatch를 쓰지 않는다. hot path에서 JS callback, heap allocation, entity별 Wasm 왕복은 추가하지 않는다.
- 새 단위 테스트는 inactive input/pressed edge, missing/pattern mismatch가 cooldown을 소비하지 않는지, ready preflight가 cooldown을 즉시 소비하지 않고 explicit commit 이후 `CoolingDown`으로 관측되는지 검증한다. 기존 `state_player` 테스트가 primary/dash/melee behavior regression을 계속 덮는다.

이 slice는 action 실행의 공통 “dispatch 전단”만 분리한다. projectile spawn command 생성, dash displacement, melee collision query/damage는 여전히 Shooter player runtime에 남아 있다. 다음 단계에서 완전한 `action_system`으로 승격하려면 action별 phase policy, target/aim source, side-effect telemetry, failure semantics를 먼저 표로 고정해야 한다.

### 2026-06-01: Action cooldown preflight/commit split slice

`spawnPrefabAction`의 실패 표면은 projectile/dash/melee보다 넓다. prefab id resolve, target/anchor resolve, placement validation, spawn queue capacity 같은 action-specific work가 실패할 수 있으므로, input/binding/cooldown 확인 시점에 cooldown을 먼저 소비하면 agent가 실패를 복구하기 어렵고 replay 의미도 흐려진다.

- `ActionBindingSet::commit_cooldown_if_ready(...)`와 `World::commit_action_cooldown_if_ready(...)`를 추가하고, 기존 action dispatch helper는 ready preflight만 수행하도록 바꿨다.
- Shooter player projectile은 spawn command 생성이 성공한 뒤 cooldown을 commit하고 pending spawn buffer에 넣는다. player transform이 없어 command를 만들 수 없으면 authored projectile cooldown을 소비하지 않는다.
- dash는 transform/direction 계산 뒤 cooldown을 commit하고 transform을 쓴다. melee는 transform/range/damage validation 뒤 cooldown을 commit하고 pending melee command를 넣는다.
- current primary fallback, dash, melee behavior는 기존 `state_player` regression으로 유지된다. 이 변경은 public TS API나 Wasm ABI를 바꾸지 않는다.

이 slice로 `spawnPrefabAction` 구현 전 필수 전제 중 하나인 "action-specific validation 성공 후 cooldown commit" 경로가 생겼다. 아직 phase-tagged spawn queue, prefab/template registry, spawn success/failure telemetry, snapshot versioning은 남아 있다.

### 2026-06-01: Action phase/targeting semantics 결정 slice

`spawnPrefabAction`을 바로 추가하기 전에, 이미 runtime에 연결된 projectile/dash/melee와 앞으로 추가할 action vocabulary의 실행 의미를 먼저 고정한다. 목표는 일반 gameplay authoring을 code callback이 아니라 spec으로 선언하되, 실행 primitive는 Rust-owned system이 deterministic phase 안에서 처리하게 하는 것이다.

중요한 경계도 함께 고정한다. `ActionBindingSet`은 entity에 action config를 저장할 수 있는 component storage이고, built-in Shooter runtime이 실제 실행하는 action은 현재 player action id `1` primary projectile, `2` dash, `3` melee뿐이다. 따라서 새 kind를 storage에 추가하는 것만으로 "runtime에서 실행된다"고 문서화하지 않는다. action 실행을 늘릴 때는 실행 id, phase, target source, telemetry, snapshot/replay 정책을 같이 추가해야 한다.

| Action kind | Trigger source | Target/aim source | Effect phase | Structural mutation | Cooldown consumption | Telemetry | Snapshot/replay | Failure semantics |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `projectileAction` | `InputActionRegistry` action id `1` 또는 향후 BT/FSM command | 현재 Shooter는 mouse world 방향. zero-length aim은 +X fallback | player input/action phase에서 spawn command queue, `pre-physics` flush | projectile entity spawn은 `ShooterSpawnCommand`로 deferred | authored binding이 있고 input active + pattern match + cooldown ready일 때 소비. binding `Missing`이면 Shooter config fallback, `Inactive`/`PatternMismatch`/`CoolingDown`은 fallback 없음 | shoot audio는 flush 시 발생. default projectile hit는 collision/audio/VFX path를 타며, `GameplayEvent`는 authored collision reaction이 있을 때만 보장된다. pattern mismatch, missing source transform, spawn queue full은 `actionFailed`로 관측된다 | player id `1` binding과 remaining cooldown은 snapshot에 포함. pending spawn queue는 restore 시 보존하지 않는다 | player transform 또는 spawn queue capacity가 없으면 command를 만들지 않고 cooldown을 소비하지 않는다. inactive input/missing binding/cooling down은 정상 no-op이라 failure event를 만들지 않는다 |
| `dashAction` | `InputActionRegistry` action id `2` | 이동 입력 방향, 없으면 mouse world 방향, 둘 다 없으면 +X | player input/action phase. 현재 순서는 dash → melee queue → projectile queue | 현재는 player transform 즉시 write, entity spawn/despawn 없음 | player transform이 있고 input active + pattern match + cooldown ready일 때 소비 | pattern mismatch 또는 missing source transform은 `actionFailed`로 관측된다. 별도 dash success event는 아직 없음. 후속 collision systems가 dash 후 overlap을 관측할 수 있다 | player id `2` binding과 remaining cooldown은 snapshot에 포함 | transform이 없으면 cooldown 미소비. inactive input/missing binding/cooling down은 정상 no-op. obstacle sweep/stop은 아직 범위 밖 |
| `meleeAction` | `InputActionRegistry` action id `3`; 기본 physical binding 없음. Rust-owned timer/wave/state-enter trigger는 `target: player`와 `target: enemies` 실행 | player input은 dash 이후 player center + authored range. Rust-owned `target: player`는 source transform -> live player target, `target: enemies`는 source transform 중심 enemy query. height span은 queue 시점에 capture | input/action phase 또는 trigger pre-physics phase에서 melee command queue, combat/collision phase에서 damage/game-over 적용 | hitbox entity를 만들지 않고 pending melee command + scratch query 사용. enemy kill/despawn은 기존 deferred despawn queue. player hit는 game-over만 적용 | valid swing이면 hit가 없어도 소비. missing source/target, unsupported target은 미소비 | enemy hit마다 collision hit, `collisionDamage`, hit particle/tween/audio를 관측. player hit는 game-over/no score/no success gameplay event. whiff event는 없음. pattern mismatch, missing source transform, missing action target, unsupported collision target은 `actionFailed`로 관측된다 | player id `3` binding과 remaining cooldown은 snapshot에 포함. pending melee queue는 restore 시 보존하지 않는다. non-player melee binding/trigger는 built-in save scope 밖 | player input은 `target: enemies`만 허용. Rust-owned trigger는 `target: player`와 `target: enemies`를 모두 허용. `target: enemies`는 live player target 없이 실행하고 attacker self-hit은 스킵 |
| `spawnPrefabAction` (player input runtime + failure telemetry complete) | 현재 slice는 player-owned `InputActionRegistry` action id. 이후 timer/wave/FSM state-enter producer도 같은 Rust-owned trigger queue를 사용한다 | 현재 runtime은 `self` anchor + offset만 실행한다. 확장 후보는 `target`, `worldPoint`, `socket/anchor`, input aim, movement direction, optional facing/offset이다 | 현재 runtime은 `prePhysics` phase token만 실행하고, spawn command를 player action phase 뒤 physics/world integration 전에 flush한다. `post-collision`/`end-of-frame`은 phase-tagged queue가 준비된 뒤 연다 | `ActionBindingSet`에 numeric prefab id/anchor/phase/offset을 저장하고, built-in Shooter runtime이 enemy prefab id `1`을 Rust template/config로 resolve해 `ShooterSpawnCommand::Prefab`에 적재한다. TS `SceneComposition` callback이나 browser `spawnRigidBody(...)`를 frame hot path에서 호출하지 않는다 | prefab id, anchor, phase, source transform, pending spawn capacity, enemy prefab AABB tilemap placement가 모두 성공한 뒤 cooldown을 소비한다. spawn command queue는 soft cap `64`를 사용한다. placement는 현재 collision tilemap obstacle overlap만 검사한다 | 성공 flush 시 `prefabSpawned` gameplay event를 emit한다. validation/capacity/placement 실패 시 `actionFailed` gameplay event를 emit한다. 공통 `actionTriggered`는 아직 없다 | built-in Shooter snapshot은 version `10` 기준이며 player action binding/cooldown 반복 슬롯, projectile tile impact policy, in-flight bullet source faction metadata를 포함한다. queued spawn command는 restore 시 버리며, queue와 flush 사이 state는 snapshot 보존 대상이 아니다 | setter/adapter는 invalid prefab id, unsupported anchor/phase, invalid offset을 diagnostic/false로 드러낸다. runtime의 unsupported prefab/anchor/phase, missing transform, queue full, blocked placement는 cooldown 미소비 `actionFailed`로 관측된다. blocked placement reason은 AABB footprint vs collision tilemap obstacle 검사이며 exact non-AABB placement는 후속 범위다 |
| `interact` | 현재는 `Interaction` component radius overlap + action id event | player/source transform과 authored radius | collision/interaction phase 뒤 frame-end event buffer | structural mutation 없음. UI/quest/cutscene은 frame-end adapter가 소비 | cooldown 개념 없음. `once`는 Rust component state로 consumed 표시 | `interaction` gameplay event | interaction component state와 FSM state는 snapshot/replay 범위에 포함 | callback 실행이 아니라 event emission. prompt text는 Rust simulation state에 저장하지 않는다 |
| `timerTrigger` | Rust-owned entity timer component. `BehaviorRecipe`는 `timer`/`timerId`와 `seconds`를 선언한다 | source entity itself | fixed timestep에서는 consumed simulation seconds, variable timestep에서는 sanitized delta로 tick한 뒤 FSM pass 직전 event emit | structural mutation 없음. elapsed 후 component는 one-shot fired 상태로 남고 재emit하지 않는다 | cooldown 개념 없음. 재시작은 낮은 빈도 authoring apply가 timer component를 다시 설정해야 한다 | `timer` gameplay event. `tokenId`는 timer id, `payloadBits`는 configured duration seconds f32 bits | World snapshot/lifecycle에 timer remaining/fired state를 포함한다. built-in Shooter save snapshot에는 별도 장르 slot을 추가하지 않는다 | one-shot, one timer per entity만 지원한다. repeat, multiple timers, pause/resume/reset, wildcard timer predicate는 후속 범위다 |
| `toggleState` (deferred) | BT/FSM event predicate 또는 explicit action command | source FSM/entity state | frame-end FSM transition phase 또는 별도 state command phase | state component write는 즉시 가능하나 state-enter component apply는 별도 phase/transaction 정책 필요 | action으로 노출할 경우 command validation 성공 뒤 소비 | `behaviorStateChanged` gameplay event | FSM current state와 transition table은 snapshot/replay 범위에 포함 | TS callback으로 state-enter behavior를 실행하지 않는다. 자동 state-enter runtime은 Rust-owned system 또는 rollback 가능한 state diff가 먼저 필요 |

이 결정에 따라 다음 구현 gate는 다음과 같다.

- `ActionBindingSet`에 새 kind를 추가하기 전에 action별 phase, target source, cooldown 소비 시점, failure telemetry를 문서화한다.
- world structural mutation이 필요한 action은 caller 안에서 즉시 spawn/despawn하지 않고 command buffer vocabulary를 확장한다.
- `spawnPrefabAction`은 data/apply slice를 먼저 완료했다. 다음 runtime slice는 Rust-side prefab/template registry와 spawn command phase policy를 추가한 뒤 예제 variant와 smoke에 연결한다.
- `spawnPrefabAction`은 TS `SceneComposition` / `spawnRigidBody(...)` adapter 경로를 frame hot path에 재사용하지 않는다. 해당 경로는 scene load, demo apply, agent apply 같은 낮은 빈도 경계에만 남긴다.
- 현재 action dispatch는 active/binding/ready preflight와 explicit cooldown commit으로 분리됐다. `spawnPrefabAction`은 이 경로를 사용해 prefab/target/phase/queue validation 성공 뒤 commit한다. 실패도 의도된 attempted execution으로 보고 cooldown을 소비하는 특수 동작은 spec flag와 telemetry가 있을 때만 허용한다.
- 첫 `spawnPrefabAction` slice는 `post-action/pre-physics` 단일 phase로 제한해도 된다. 단, action spec에는 future phase 확장 지점을 남기고, `post-collision`/`end-of-frame`은 phase-tagged queue가 준비된 뒤 열어야 한다.
- action telemetry는 kind별로 다르다. 현재 `prefabSpawned`와 `actionFailed`는 추가했지만, 공통 action system 승격 전에 `actionTriggered`와 실패 reason 확장 정책을 별도로 결정한다.
- snapshot 정책은 "queued command를 저장한다" 또는 "queue와 flush 사이 snapshot을 금지/flush한다" 중 하나로 고정한다. 현재 projectile/melee/spawn/action trigger queue는 restore 시 버리는 정책이며, built-in Shooter snapshot은 player action binding/cooldown과 in-flight projectile policy/source faction을 version `10` canonical scope로 보존한다. 새 player action 또는 non-player action을 public built-in save scope에 넣을 때는 snapshot version을 올려야 한다.
- helper `prepare_input_action_if_ready(...)` / `commit_prepared_input_action(...)`는 input/binding/cooldown dispatch 전단으로 유지하고, action별 target/phase validation은 action executor가 담당한다.
- 일반 사용자 gameplay authoring을 위한 code callback, visual editor, user scripting runtime은 계속 제외 범위다. 엔진 내부 built-in action/system 구현은 Rust 코드로 유지한다.

### 2026-06-01: spawnPrefabAction authoring data/apply slice

`spawnPrefabAction`을 runtime 실행까지 한 번에 붙이지 않고, 먼저 Rust-owned action binding data와 TS BehaviorRecipe apply 경로로 제한해 추가했다. 이 slice의 목표는 "spec으로 spawn prefab action을 선언하고 Rust storage에 검증된 numeric data로 저장"하는 것이다.

- `ActionPattern::SpawnPrefab { prefab_id, anchor, phase, offset_x, offset_y }`, `SpawnAnchor::SelfEntity`, `SpawnPhase::PrePhysics`를 추가했다. hot path storage에는 문자열, `SceneComposition` object, browser callback, `EntityTemplate` 복사본을 넣지 않는다.
- `set_gameplay_action_spawn_prefab(...)`은 generation-checked entity handle, positive action id, non-negative finite cooldown, finite offset, supported anchor/phase code를 검증한다. built-in Shooter prefab code는 우선 enemy prefab id `1`만 허용하고 player/bullet/unknown prefab code는 거부한다.
- `BehaviorRecipe`에는 `spawnPrefabAction` kind와 `configureSpawnPrefabAction` command를 추가했다. 사용자는 `action`, optional `actionId`, `prefab`, optional `prefabId`, `cooldownSeconds`, `anchor: "self"`, `phase: "prePhysics"`, offset을 spec으로 선언한다.
- `resolveGameplayBehaviorRuntimeIds(...)`는 `ids.prefabs`와 `requiredPrefabs`를 검증하고, `applyGameplayBehaviorCommands(...)`는 `actionId` 또는 `ids.actions[action]`, `prefabId` 또는 `ids.prefabs[prefab]`을 numeric token으로 해석해 낮은 빈도 경계에서 Rust setter를 호출한다.
- 이 slice는 built-in Shooter frame loop에서 spawnPrefab action을 실행하지 않는다. cooldown commit, queue enqueue, spawn success/failure telemetry, built-in Shooter snapshot version bump, golden replay diff는 후속 runtime slice 범위다.
- `spawnPrefabAction`은 TS `SceneComposition`/`spawnRigidBody(...)` browser adapter를 frame hot path에서 재사용하지 않는다. scene load, demo apply, agent apply 같은 낮은 빈도 authoring 경계만 사용한다.

이후 runtime coverage는 player input slice에서 남긴 실패 관측성과 snapshot 보존 정책을 먼저 닫고, 그 다음 timer/wave/FSM state-enter producer로 넓혔다.

### 2026-06-01: spawnPrefabAction player input runtime slice

`spawnPrefabAction`의 첫 runtime 실행 범위를 player-owned input action으로 닫았다. 이 slice는 "spec으로 선언한 spawn action을 Rust frame loop가 deterministic phase에서 실행한다"는 방향을 검증하기 위한 최소 범위다.

- player `ActionBindingSet`에서 `ActionPattern::SpawnPrefab` binding을 스캔하고, `InputActionRegistry`가 해당 action id를 active로 보고 cooldown이 ready일 때만 실행한다. 기본 physical binding은 없으므로 사용자가 `setInputActionBinding(...)`으로 명시적으로 연결해야 한다.
- runtime 실행은 built-in Shooter enemy prefab id `1`, `SpawnAnchor::SelfEntity`, `SpawnPhase::PrePhysics`만 허용한다. transform은 source player transform + offset으로 계산하고, enemy template/health/score reward는 현재 Shooter config/wave helper를 사용한다.
- structural mutation은 input phase에서 바로 하지 않고 `ShooterSpawnCommand::Prefab`으로 queue에 넣은 뒤 기존 pre-physics flush 지점에서 enemy entity를 생성한다. action-spawned enemy는 wave `spawn_index`, `wave_spawned_count`, wave timer를 변경하지 않는다.
- cooldown은 prefab id/anchor/phase/source transform 검증과 현재 `Vec` queue push 이후에만 소비한다. unsupported prefab/anchor/phase 또는 missing transform은 cooldown을 소비하지 않는다. recoverable queue capacity failure와 blocked spawn 정책은 아직 없다.
- spawn flush 성공 시 `prefabSpawned` gameplay event를 추가했다. event ABI는 기존 8-u32 stride를 유지하며 `actor`는 spawned entity, `source`는 action owner, `tokenId`는 prefab id, `payloadBits`는 action id다. TS decoder와 `gameplayActionsForEvents(...)`는 이를 `GameplayPrefabSpawnedEventAction`으로 변환한다.
- built-in Shooter snapshot은 version `6`으로 올라갔고, entity stride는 float `23`, u32 `9`로 확장됐다. 첫 player spawnPrefab binding/cooldown/prefab/anchor/phase/offset을 저장/복원한다. queued spawn command는 restore 시 비워지는 transient phase state로 유지한다. 이후 여러 spawnPrefab binding snapshot slice에서 version `7`, float `35`, u32 `21`로 확장했다.
- 이 slice 이후 남아 있던 blocked placement, projectile/dash/melee 공통 failure vocabulary, 여러 spawnPrefab binding snapshot 보존, non-player action executor, timer/wave/FSM state-enter producer, golden replay diff 확대는 후속 slice에서 닫았다.

### 2026-06-01: actionFailed/capacity telemetry slice

player input `spawnPrefabAction`의 실패 관측성을 닫았다. 목표는 agent가 "왜 spec 행동이 실행되지 않았는지"를 frame-end telemetry로 볼 수 있게 하면서도, 실패한 action이 cooldown을 소비하지 않게 하는 것이다.

- `GameplayEvent` ABI는 기존 8-u32 stride를 유지한다. `actionFailed`는 kind code `6`, `actor/source = action owner`, `tokenId = action id`, `payloadBits = reason code`, `flags = 0`으로 encode한다.
- reason code는 unsupported prefab `1`, unsupported anchor `2`, unsupported phase `3`, missing source transform `4`, spawn queue full `5`로 시작했고, 이후 projectile/dash/melee failure vocabulary slice에서 pattern mismatch `6`, blocked placement slice에서 blocked placement `7`을 추가했다. TS `gameplayActionsForEvents(...)`는 이를 `GameplayActionFailedEventAction`으로 변환하고 사람이 읽는 `reason` 문자열을 붙인다.
- `apply_player_input_with_actions(...)`는 optional `GameplayEventSink`를 받아 spawnPrefab executor에만 전달한다. player movement/input snapshot 구조와 기존 dash/melee/projectile 실행 경로는 넓히지 않았다.
- pending spawn queue는 soft cap `64`를 갖는다. `spawnPrefabAction`은 capacity를 cooldown commit 전에 검사하고, full이면 `actionFailed(spawnQueueFull)`를 emit한 뒤 cooldown을 그대로 둔다.
- unsupported prefab/anchor/phase, missing source transform, blocked placement도 cooldown을 소비하지 않고 `actionFailed`를 emit한다. blocked placement는 enemy prefab AABB footprint와 collision tilemap obstacle overlap만 검사한다. nav/line-of-sight, dynamic entity overlap, exact circle/capsule/oriented-box/convex placement는 아직 범위 밖이다.
- `actionFailed`는 현재 FSM predicate vocabulary에 넣지 않는다. 우선 agent smoke/debug/diagnostic adapter가 읽는 telemetry로 제한하고, 실패를 gameplay branching input으로 쓸지는 별도 설계가 필요하다.

이후 timer/wave/FSM state-enter trigger와 golden replay fixture 확대는 후속 slice에서 닫았다.

### 2026-06-01: multiple spawnPrefab snapshot slice

player `ActionBindingSet`이 여러 `spawnPrefabAction` binding을 가질 수 있는데 snapshot version `6`은 첫 번째 supported spawnPrefab binding만 저장했다. 이 slice는 runtime executor를 넓히지 않고 save/load/replay surface만 현재 component capacity와 맞춘다.

- built-in Shooter snapshot version을 `7`로 올리고 entity stride를 float `35`, u32 `21`로 확장했다.
- spawnPrefab snapshot slot은 `ActionBindingSet` capacity와 같은 최대 4개다. 각 slot은 cooldown duration/remaining, offset x/y, action id, prefab id, anchor, phase를 저장한다.
- snapshot capture는 현재 지원되는 `prefabId=1`, `anchor=self`, `phase=prePhysics` spawnPrefab binding만 action id 오름차순 canonical order로 기록한다. restore도 같은 순서로 `ActionBindingSet`에 재설치한다.
- malformed snapshot에서 primary/dash/melee/spawnPrefab action id가 중복되거나 non-zero action id 총수가 `ActionBindingSet` capacity를 넘으면 restore를 거부한다. 같은 runtime action id가 서로 다른 action pattern으로 조용히 덮어써지거나, capacity 초과로 일부 binding이 조용히 유실되는 것을 막기 위한 save/load 경계 검증이다.
- queued spawn command는 여전히 transient phase state라 snapshot에 포함하지 않는다. restore 시 pending spawn/melee queue는 비워진다.

이후 timer/wave/FSM state-enter trigger와 golden replay fixture 확대는 후속 slice에서 닫았다.

### 2026-06-01: projectile/dash/melee action failure vocabulary slice

`spawnPrefabAction`에서 시작한 `actionFailed` telemetry를 이미 runtime에 연결된 projectile/dash/melee authored action에도 맞췄다. 목표는 agent가 "spec action이 입력은 받았지만 왜 실행되지 않았는지"를 같은 frame-end vocabulary로 읽게 하는 것이며, 정상 no-op을 실패로 부풀리지 않는 것이다.

- `GameplayEvent` ABI stride는 유지하고 reason code만 확장했다. 새 reason code는 pattern mismatch `6`이다. 기존 missing source transform `4`, spawn queue full `5`도 projectile/dash/melee에서 재사용한다.
- inactive input, missing authored binding, cooling down은 정상 상태라 `actionFailed`를 emit하지 않는다. 특히 default registry에 action id가 있어도 binding이 없으면 authoring failure로 보지 않는다.
- primary projectile authored binding은 pending spawn queue capacity를 cooldown commit 전에 검사한다. queue full이면 `actionFailed(spawnQueueFull)`를 emit하고 cooldown을 소비하지 않는다.
- projectile/dash/melee 모두 expected pattern과 다른 binding이 action id에 설치되어 있으면 `actionFailed(patternMismatch)`를 emit하고 cooldown을 소비하지 않는다.
- 단, spawnPrefab binding이 action id `1`/`2`/`3` 같은 built-in fixed action id를 의도적으로 사용할 때는 fixed projectile/dash/melee handler가 false `patternMismatch`를 emit하지 않는다. 실제 spawnPrefab executor의 validation/success/failure event만 관측된다.
- dash/melee/projectile command 생성에 필요한 source transform이 없으면 `actionFailed(missingSourceTransform)`를 emit하고 cooldown을 소비하지 않는다.
- TS `gameplayActionsForEvents(...)`는 pattern mismatch reason을 사람이 읽는 `"patternMismatch"`로 변환한다. 이 event는 여전히 FSM predicate vocabulary가 아니라 agent smoke/debug/diagnostic adapter용 telemetry다.

이후 timer/wave/FSM state-enter trigger와 golden replay fixture 확대는 후속 slice에서 닫았다.

### 2026-06-01: spawnPrefabAction blocked placement failure slice

player input `spawnPrefabAction`의 마지막 기본 실패 reason으로 blocked placement를 추가했다. 이 slice도 visual editor나 JS callback이 아니라 Rust frame loop 안의 deterministic validation이다.

- 새 `actionFailed` reason code는 blocked placement `7`이다. 기존 `GameplayEvent` ABI stride 8 u32는 유지한다.
- placement check는 enemy prefab template의 AABB footprint, collider offset/enabled 값, `CollisionLayer::Enemy`를 사용해 collision tilemap obstacle overlap을 검사한다.
- queue capacity는 tilemap placement query보다 먼저 검사한다. pending spawn queue가 full이면 `spawnQueueFull`이 우선이며 불필요한 tilemap query를 하지 않는다.
- blocked placement는 cooldown을 소비하지 않고 spawn command를 queue하지 않는다. collision이 아닌 tilemap layer는 placement를 막지 않는다.
- 이 reason은 TS decoder/action adapter에서 `"blockedPlacement"`로 변환된다.

이 slice의 blocked placement는 AABB footprint vs static collision tilemap obstacle만 의미한다. dynamic entity overlap, nav/line-of-sight, exact non-AABB collider placement, 자동 위치 보정은 후속 범위다.

### 2026-06-01: gameplay golden replay action failure coverage slice

agent 저작 루프의 run/telemetry 신호를 강화하기 위해 authored behavior golden replay가 성공 이벤트뿐 아니라 실패 telemetry도 고정하도록 확장했다.

- `gameplay-replay-smoke.mjs`의 built-in Shooter snapshot version 기준을 Rust/TS public snapshot version과 맞췄다. 이 slice 시점에는 version `7`이었고, 이후 projectile tile impact pass-through slice에서 version `8`, projectile source faction default damage gate slice에서 version `9`, projectile bounce snapshot contract slice에서 version `10`으로 갱신했다. 기존 fixture가 version `5`로 label되던 상태는 replay drift와 fixture format drift를 섞어 보이게 하는 버그였으므로, basic/authored fixture를 모두 재생성했다.
- `topdown-authored-behavior` scenario는 기존 pickup/interaction/collision/FSM event frame 뒤에 player `spawnPrefabAction`을 입력으로 시도하고, collision tilemap obstacle 때문에 `actionFailed(blockedPlacement)`가 발생하는 frame을 추가로 capture한다.
- authored variant의 player recipe에 `spawnPrefabAction(action: "summon-enemy")`을 추가하고, scenario authoring metadata가 recipe command의 action id, prefab id, cooldown, offset과 일치하는지 smoke에서 검증한다.
- golden fixture는 frame `3`의 gameplay event buffer에 `kind=actionFailed`, `tokenId=11`, `payloadBits=7`을 exact payload로 저장한다. final frame은 gameplay event buffer가 clear되는지도 계속 검증한다.

이 slice는 새 runtime primitive를 추가하지 않는다. 이미 구현된 Rust-owned `spawnPrefabAction` 실패 경로를 deterministic replay/golden hash에 연결해 agent가 spec 변경 후 실패 원인을 diff로 확인할 수 있게 하는 검증 표면 확장이다.

### 2026-06-01: entity timer trigger event slice

full FSM state-enter command apply보다 작은 runtime primitive로 entity-scoped timer trigger를 먼저 고정했다. 목적은 적 행동 패턴의 "일정 시간 뒤 상태 전환"을 code callback 없이 spec/FSM으로 표현하고, 기존 Rust-owned FSM transition path가 같은 frame에 소비하게 하는 것이다.

- Rust `GameplayTimerTrigger` component는 entity별 one-shot 단일 timer다. `set_gameplay_timer_trigger(entity, generation, timerId, seconds)`는 positive timer id와 positive finite duration만 허용하고, despawn/lifecycle/snapshot restore에서 stale timer가 남지 않게 했다.
- timer tick은 fixed timestep에서는 실제 소비된 simulation seconds만큼만 진행한다. fixed step이 0이면 timer도 진행하지 않는다. variable timestep에서는 기존 update delta를 사용하되 non-positive/non-finite 값은 무시한다.
- elapsed timer는 기존 8-u32 `GameplayEvent` ABI를 유지한 `timer` event를 emit한다. `actor == source == owning entity`, `tokenId == timerId`, `payloadBits == durationSeconds.to_bits()`다.
- TS decoder/action adapter는 `timer` event를 `GameplayTimerEventAction`으로 변환하고, FSM predicate는 `timer` 또는 `timerId`를 받아 `ids.timers` namespace로 deterministic replay/runtime install token을 해석한다.
- `BehaviorRecipe`에는 `timerTrigger` kind와 `configureTimerTrigger` command를 추가했다. agent는 `timer: "wake", seconds: 0.5`처럼 선언하고, runtime ids 또는 inline `timerId`로 Rust timer component에 적용한다.
- repeat timer, multiple timers per entity, zero-delay/immediate timer, pause/resume/reset, wildcard timer predicate, state-enter BehaviorRecipe command 자동 적용은 후속 범위로 남겼다.

이 slice는 timer elapsed event와 FSM transition까지만 닫는다. "상태에 들어갈 때 timer를 자동 재설정"하거나 "timer elapsed가 spawn/action command를 직접 실행"하는 기능은 아직 만들지 않는다. 그런 동작은 phase/cooldown/config-state 분리 정책과 rollback 가능한 state command 적용 방식이 먼저 필요하다.

### 2026-06-01: authored behavior golden timer coverage slice

entity timer trigger를 agent 저작 루프의 replay 신호까지 연결했다. 목적은 `timerTrigger` recipe와 `ids.timers` registry가 예제 variant, scenario manifest, raw Wasm replay harness, golden fixture에서 같은 계약으로 검증되게 하는 것이다.

- Top-down authored behavior variant에 `timer-source` scene instance, `timer.source` recipe, `ids.timers.wake = 13`, `timer-source` FSM을 추가했다.
- `topdown-authored-behavior` scenario는 frame `1`의 authoring setup 이후 0.05초 one-shot timer를 tick하고, frame `4`에서 `timer` event와 `behaviorStateChanged` event를 exact payload로 capture한다.
- replay smoke는 `GAMEPLAY_EVENT_KIND_TIMER`, actor/source handle, `tokenId=13`, configured duration의 f32 `payloadBits`, timer FSM previous/next state를 검증한다.
- authored behavior variant smoke와 schema는 `ids.timers`, `configureTimerTrigger`, `timer-source` FSM binding, manifest/variant hash 동기화를 함께 검증한다.
- 이 slice 이후 authored replay는 timer-driven spawnPrefabAction coverage까지 확장됐고, 현재 authored replay hash는 `052aa729`다. 이 hash는 기존 pickup/interaction/collision/FSM/actionFailed coverage에 timer event/FSM frame, timer-driven prefab spawn success frame, pickupCollected telemetry를 더한 결과다.

이 slice도 state-enter command 자동 실행은 열지 않는다. timer component는 낮은 빈도 authoring setup에서 설치되고, replay는 Rust-owned timer system과 FSM telemetry만 관측한다.

### 2026-06-01: state command timer reset/clear policy slice

full state-enter runtime으로 가기 전, 현재 저빈도 `replaceSupported` state command helper의 timer 정책을 테스트와 문서로 고정했다. 목적은 timer가 state profile 재적용 과정에서 암묵적으로 남거나 잘못 clear되는 일을 agent가 검증할 수 있게 하는 것이다.

- `overlay` state command apply는 기존 timer component를 건드리지 않는다. state profile에 `timerTrigger`가 있으면 해당 command만 추가/덮어쓰는 낮은 빈도 apply다.
- `replaceSupported` state command apply는 지원 component subset을 clear할 때 `clear_gameplay_timer_trigger(...)`를 반드시 호출한다. 이후 state profile에 `timerTrigger`가 있으면 `ids.timers`로 runtime token을 해석해 새 one-shot timer를 설치한다.
- timer id/runtime id preflight는 clear보다 먼저 실행된다. `timer: "wake"`가 `ids.timers.wake`로 해석되지 않으면 machine-actionable diagnostic을 반환하고 기존 timer를 지우지 않는다.
- 이 정책은 자동 state-enter runtime이 아니다. FSM transition이 발생할 때마다 Rust/TS가 state profile을 자동 재적용하지 않으며, agent/scene load/demo helper가 명시적으로 호출하는 낮은 빈도 경계에만 해당한다.

이 slice로 state-enter timer reset/clear 정책은 `replaceSupported` helper 범위에서 닫았다. 더 넓은 자동 state-enter runtime이 필요하면 Rust-owned state-enter system 또는 rollback 가능한 state diff가 여전히 별도 설계 대상이다.

### 2026-06-01: non-player action executor phase/cooldown ownership 결정 slice

player input action은 `InputActionRegistry`가 trigger source이고, built-in Shooter player runtime이 `ActionBindingSet`을 직접 소비한다. 그러나 non-player action은 입력 snapshot이 없으므로 `timer event`, `wave`, `FSM state-enter` 같은 내부 trigger가 필요하다. 이 경계를 정하지 않고 바로 실행을 붙이면 `GameplayEvent`가 곧 action command가 되는 암묵 규칙이 생기고, state-enter 자동 apply와 cooldown reset 문제가 섞인다.

결정은 다음과 같다.

- non-player action executor는 Rust-owned system이어야 한다. TypeScript는 frame hot path에서 entity별 action callback이나 `spawnRigidBody(...)` adapter를 호출하지 않는다.
- `GameplayEvent` 자체를 바로 action command로 해석하지 않는다. timer/FSM/wave가 action을 실행하려면 Rust 안의 명시적 `ActionTriggerQueue` 또는 동등한 phase-tagged command queue에 `{ sourceEntity, actionId, triggerKind }`를 적재해야 한다.
- 첫 runtime 후보는 `spawnPrefabAction`으로 제한한다. 이미 player input path에서 prefab id/anchor/phase/source transform/capacity/placement/cooldown/failure telemetry 계약이 닫혀 있으므로, non-player executor는 같은 validation과 `ShooterSpawnCommand::Prefab` queue를 재사용할 수 있다.
- trigger source별 ownership은 분리한다.
  - `input`: 현재 player-only `InputActionRegistry`가 소유한다.
  - `timer`: elapsed timer가 action을 실행하려면 timer component와 action id를 연결하는 별도 authoring data가 필요하다. 단순히 `timerId == actionId`로 암묵 매핑하지 않는다.
  - `FSM state-enter`: 자동 state-enter runtime을 열기 전에는 Rust-owned state-enter system 또는 rollback 가능한 state diff가 필요하다. 현재 TS `replaceSupported` helper를 frame transition에 자동 호출하지 않는다.
  - `wave`: Shooter wave runtime이 action trigger를 발행할 수는 있지만, wave spawn counter/timer와 action cooldown state를 섞지 않는다.
- cooldown은 action executor가 소유한다. trigger가 발생해도 pattern/source/phase/capacity/placement validation이 실패하면 cooldown을 소비하지 않고 `actionFailed`를 emit한다. 성공 command가 phase queue에 적재된 뒤에만 cooldown을 commit한다.
- 기존 `ActionBindingSet`은 config와 cooldown remaining state를 함께 가진다. 따라서 낮은 빈도 authoring 재적용은 cooldown을 ready로 reset한다. 자동 state-enter runtime이나 반복 trigger runtime으로 넓힐 때는 config/state 분리 또는 "state-enter reapply가 cooldown reset을 의도한다"는 별도 정책을 먼저 확정해야 한다.
- non-player executor는 action owner entity의 `ActionBindingSet`을 읽는다. spawned prefab의 source는 trigger owner이며, `prefabSpawned`/`actionFailed` event의 `source`도 trigger owner로 남긴다. actor는 spawned entity 또는 failure owner다.
- snapshot/replay 정책은 두 단계로 둔다. `World` snapshot은 action binding/cooldown state를 이미 보존하므로 generic world replay에는 포함된다. built-in Shooter save snapshot은 현재 player action binding만 명시적으로 보존하므로, non-player authored action을 built-in save scope에 넣을 때는 snapshot version과 canonical slot 정책을 별도 slice로 올린다.

초기 구현 gate는 다음과 같다.

1. `ActionTriggerQueue` 또는 동등한 Rust-side scratch queue를 추가한다. queue item은 `source`, `actionId`, `triggerKind`, `phase`를 숫자 enum으로 갖고 frame-local transient state로 둔다.
2. 첫 producer는 자동 state-enter가 아니라 명시적 authoring component로 제한한다. 예: timer elapsed 시 action id를 enqueue하는 `TimerActionTrigger` 같은 bounded component. 이때 `timerId == actionId` 암묵 매핑은 금지한다.
3. 첫 consumer는 `SpawnPrefab` pattern만 실행한다. projectile/dash/melee non-player 실행은 target/aim source와 hit semantics가 별도라 후속으로 둔다.
4. consumer는 player spawnPrefab executor와 같은 `spawn_prefab_command`, queue capacity, blocked placement, cooldown commit, `prefabSpawned`/`actionFailed` telemetry vocabulary를 재사용하거나 공통 helper로 추출한다.
5. authored behavior golden fixture에 timer-driven non-player spawn success와 blocked placement failure 중 하나를 추가해 replay hash로 고정한다.

이 결정으로 "non-player action executor를 한다"는 말은 곧 "Rust frame loop 안의 명시적 trigger queue와 action executor를 추가한다"는 뜻이 된다. TS state command helper나 gameplay event adapter를 frame마다 호출하는 방향은 제외 범위다.

### 2026-06-01: trigger-agnostic action readiness helper slice

non-player executor 구현 전 첫 코드 전제로, 기존 player input action helper에서 input active 판정과 action binding/cooldown readiness 판정을 분리했다.

- `prepare_action_if_ready(...)`는 `InputActionRegistry`나 `InputState`를 받지 않고 `World`, source entity, action id, expected `ActionPatternKind`만으로 `Missing`/`PatternMismatch`/`CoolingDown`/`Ready`를 판정한다.
- 기존 `prepare_input_action_if_ready(...)`는 input active/pressed 여부만 먼저 확인한 뒤 같은 readiness helper를 호출한다. 따라서 player input path의 의미는 유지한다.
- `commit_prepared_action(...)`은 cooldown commit의 trigger-agnostic 이름을 제공하고, 기존 `commit_prepared_input_action(...)`은 호환 wrapper로 남긴다. 이후 prepared action commit token slice에서 두 함수 모두 `PreparedAction` token을 받도록 정리됐다.
- 새 단위 테스트는 `SpawnPrefab` binding이 입력 없이도 ready 판정되고, explicit commit 후 cooldown 상태로 바뀌며, expected pattern mismatch가 cooldown을 소비하지 않는지 검증한다.

이 slice는 아직 non-player action을 실행하지 않는다. 다음 구현은 이 helper를 소비하는 frame-local `ActionTriggerQueue`와 첫 producer/consumer를 붙이는 것이다.

### 2026-06-01: timer-driven spawnPrefabAction runtime slice

non-player action executor의 첫 runtime consumer를 timer-driven `spawnPrefabAction`으로 닫았다. 이 slice의 목적은 "일정 시간 뒤 적이 다른 적을 소환한다" 같은 행동을 TS callback 없이 Rust frame loop 안에서 실행하는 것이다.

- `GameplayTimerTrigger`는 기존 `timerId`와 별도로 optional `actionId`를 가진다. `timerId == actionId` 암묵 매핑은 여전히 금지하며, TS adapter도 `timer`/`action` runtime id namespace를 따로 해석한다.
- `set_gameplay_timer_action_trigger(entity, generation, timerId, seconds, actionId)` authoring setter를 추가했다. 기존 `set_gameplay_timer_trigger(...)`는 action 없는 one-shot timer event/FSM trigger 용도로 유지한다.
- Shooter Playing phase는 timer를 `apply_player_input`보다 먼저 tick하고, elapsed timer가 action id를 가지면 frame-local `ActionTriggerQueue`에 `{ source, actionId, triggerKind: Timer }`를 적재한다. 이후 player input action 처리와 함께 action trigger를 소비하고, `flush_pending_spawns` 전에 `ShooterSpawnCommand::Prefab`을 queue한다. 따라서 `phase: "prePhysics"` spawn은 같은 frame의 physics/world integration 전에 생성된다.
- 첫 consumer는 `ActionPattern::SpawnPrefab`만 실행한다. projectile/dash/melee non-player 실행은 aim/target/semantic이 다르므로 후속 범위다.
- executor는 source transform, prefab id, anchor, phase, pending spawn capacity, tilemap blocked placement를 검증하고, 성공적으로 spawn command를 queue한 뒤에만 cooldown을 commit한다. missing binding, pattern mismatch, cooling down, unsupported prefab/anchor/phase, missing source transform, queue full, blocked placement는 `actionFailed` telemetry로 관측한다.
- active Shooter scene이 timer를 phase 안에서 소유하므로 `Engine`의 generic timer event tick은 Shooter Playing 중에는 중복으로 timer를 tick하지 않는다. Shooter가 아닌 scene 또는 Shooter Title/GameOver 상태의 generic timer/FSM 테스트 경로는 기존처럼 유지한다.
- `ActionTriggerQueue`는 `ShooterScene`의 transient frame-local queue다. snapshot/save 대상이 아니며, existing pending spawn/melee command와 같은 transient policy를 따른다.

이 slice는 state-enter runtime이 아니다. FSM transition이 발생했을 때 state profile을 자동 apply하거나 TS event adapter가 spawn을 호출하지 않는다. 자동 state-enter action 실행은 Rust-owned state-enter system 또는 rollback 가능한 state diff 정책을 별도 설계한 뒤 열어야 한다.

### 2026-06-01: timer-driven spawnPrefabAction golden replay coverage slice

timer-driven `spawnPrefabAction` runtime을 agent 저작 루프의 replay 신호까지 연결했다. 이 slice의 목적은 non-player action executor가 실제로 timer producer와 spawnPrefab consumer를 같은 Rust frame loop 안에서 연결하는지, 그리고 그 결과가 deterministic replay/golden hash로 고정되는지 검증하는 것이다.

- Top-down authored behavior variant의 `timer.source` recipe는 `spawnPrefabAction(action: "summon-enemy")`과 `timerTrigger(timer: "wake", action: "summon-enemy")`를 함께 선언한다. timer id와 action id는 각각 `ids.timers.wake = 13`, `ids.actions.summon-enemy = 11`로 분리해 `timerId == actionId` 암묵 매핑을 금지한다.
- scenario manifest의 authoring metadata는 `components.timer.actionId = 11`과 별도 `components.timerSpawnPrefab` block을 가진다. smoke는 timer action id가 spawnPrefab action id와 일치하고 timer id와는 다르다는 계약을 검증한다.
- replay smoke는 timer frame의 event 순서를 `timer -> prefabSpawned -> behaviorStateChanged`로 고정한다. `prefabSpawned.source`는 timer source entity, `tokenId`는 prefab id, `payloadBits`는 action id여야 하며, spawned actor는 timer source와 달라야 한다.
- 같은 frame에서 scene entity count가 직전 capture frame보다 증가해야 한다. final frame에서는 gameplay event buffer가 비워져야 하므로 transient event가 다음 frame으로 누수되지 않는지도 검증한다.
- 현재 authored replay hash는 `052aa729`다. 이 hash는 timer event/FSM transition, timer-driven non-player prefab spawn success, pickupCollected telemetry까지 포함한다.

이 coverage도 TS frame hot path callback을 만들지 않는다. variant/spec은 낮은 빈도 authoring data이고, runtime 실행과 event emission은 Rust-owned timer/action/spawn system에서 끝난다.

### 2026-06-01: ActionTriggerQueue reset/restore transient hardening slice

`ActionTriggerQueue`를 frame-local transient queue로 둔 계약을 reset/snapshot restore 경계까지 맞췄다. timer-driven action trigger가 쌓인 직후 reset 또는 snapshot restore가 발생하면 이전 world entity handle을 가진 trigger가 새 world에 남을 수 있으므로, reset/restore에서 명시적으로 비운다.

- `ShooterScene::reset_playing(...)`은 `action_triggers`, `pending_spawns`, `pending_melee_attacks`, `pending_despawn`, `marked_for_despawn`, `collision_pairs`를 함께 clear한다.
- `ShooterScene::restore_snapshot(...)`은 기존 pending spawn/melee/despawn queue와 마찬가지로 `action_triggers`도 clear한다.
- 새 회귀 테스트는 queued action trigger가 snapshot restore와 reset 이후 모두 비워지는지 검증한다. 이는 queued spawn command와 같은 transient policy이며, snapshot/save surface에 action trigger queue를 포함하지 않는다.

이 slice는 새 authoring primitive를 추가하지 않는다. 목표는 timer/wave/FSM producer를 계속 늘리기 전에 stale entity handle이 다음 world/frame으로 새어 나가는 것을 막는 것이다.

### 2026-06-01: wave-enter spawnPrefabAction producer slice

timer 다음의 non-player action producer로 wave-enter trigger를 추가했다. 이 slice는 wave runtime이 action cooldown을 직접 소유하지 않고, 명시적으로 지정된 source entity의 `ActionBindingSet`에 있는 action id를 `ActionTriggerQueue`에 적재하는 범위로 제한한다.

- `ActionTriggerKind::Wave`와 `ActionTriggerCommand::wave(...)`를 추가하고, existing spawnPrefab consumer를 timer trigger와 동일하게 재사용한다.
- `set_shooter_wave_action_trigger(waveIndex, sourceEntityId, sourceEntityGeneration, actionId)`는 낮은 빈도 authoring setter다. source entity는 generation-checked handle이어야 하며, action id는 positive여야 한다.
- trigger timing은 “새 active wave 진입”이다. `advance_wave_if_needed(...)`가 wave index를 전환한 직후 새 wave에 설정된 action trigger를 queue한다. 이는 기존 `spawn_enemy_if_needed(...)` wave spawn을 대체하지 않는 additive trigger다.
- runtime queue 시점에도 source freshness를 다시 확인한다. source entity가 despawn되었거나 generation이 바뀐 경우 stale handle을 `ActionTriggerQueue`에 넣지 않는다.
- 성공 경로는 같은 frame에서 wave advance -> action trigger queue -> spawnPrefab validation/cooldown commit -> pending spawn flush -> `prefabSpawned` event 순서로 처리된다. 실패 경로는 기존 non-player spawnPrefab executor의 `actionFailed` vocabulary를 재사용한다.
- snapshot/restore는 wave action trigger side state를 아직 보존하지 않는다. `reset_playing(...)`, `clear_wave_configs(...)`, `restore_snapshot(...)`은 이 side state를 clear한다. built-in save scope에 non-player action binding/wave trigger를 넣으려면 snapshot version과 canonical policy를 별도 slice로 올린다.

### 2026-06-01: Behavior state-enter spawnPrefabAction producer slice

FSM state-enter action producer를 같은 frame callback이 아니라 Rust-owned next-frame producer로 열었다. 현재 FSM transition은 `Engine::advance_simulation(...)`의 scene update 뒤에서 처리되므로, state-enter action을 같은 frame pre-physics로 끼워 넣으면 이미 지나간 phase를 되돌려야 한다. 따라서 명시적으로 `NextFramePrePhysics` 의미를 선택했다.

- `BehaviorStateEnterActionSet`은 state id, action id, phase를 generation-aligned `World` storage에 bounded data로 저장한다. spawn/despawn/snapshot restore lifecycle에도 포함된다.
- authoring surface는 `add_gameplay_behavior_state_enter_action(entity, generation, state, actionId, phase)`와 `clear_gameplay_behavior_state_enter_actions(...)`다. 현재 phase code `0`은 `NextFramePrePhysics`만 의미하며, state/action id는 positive `u32`만 허용한다.
- `ActionTriggerCommand`는 trigger kind와 별도로 phase tag를 가진다. timer/wave는 current frame pre-physics producer이고, state-enter는 FSM transition event가 생성된 뒤 queue에 적재되어 다음 Shooter frame의 pre-physics action trigger 처리에서 실행된다.
- `ActionTriggerQueue` drain은 pending/processing `Vec`을 ping-pong swap하는 방식이다. 현재 processing buffer를 도는 동안 새로 적재된 trigger는 pending buffer에 남아 다음 처리 시점까지 보존되고, 두 buffer 모두 기존 capacity를 재사용한다.
- state-enter producer는 `behaviorStateChanged` event의 source entity generation freshness를 다시 확인하고, matching next state에 등록된 action만 queue한다. queue capacity 초과는 `actionFailed(spawnQueueFull)` telemetry로 관측한다.
- 첫 consumer는 기존 non-player `spawnPrefabAction` executor만 재사용한다. projectile/dash/melee state-enter 실행은 별도 aim/target semantics가 필요하므로 후속 범위다.

이 slice도 TS event callback을 만들지 않는다. 사용자는 FSM/spec으로 state-enter action을 선언하고, 런타임 실행은 Rust frame loop와 기존 `ActionBindingSet`/`ActionTriggerQueue`/spawn command pipeline이 담당한다.

### 2026-06-01: Behavior state-enter spawnPrefabAction golden replay coverage slice

state-enter producer도 deterministic replay fixture로 고정했다. 이 slice의 목적은 FSM transition이 발생한 frame과, 그 state-enter action이 다음 frame pre-physics에서 prefab spawn으로 실행되는 frame을 agent가 golden diff로 구분해 검증할 수 있게 하는 것이다.

- `docs/engine/gameplay-golden/scenarios.json`에 `topdown-state-enter-action-trigger` scenario를 추가했다.
- scenario는 authoring frame에서 source body를 만들고, source에 `timer -> FSM transition -> state-enter spawnPrefabAction`을 설치한다.
- transition frame의 gameplay event 순서는 `timer -> behaviorStateChanged`로 고정한다. 이 frame에서는 아직 prefab이 생성되지 않아야 한다.
- 다음 frame의 gameplay event는 `prefabSpawned` 하나여야 하며, source는 FSM entity, actor는 새로 생성된 prefab entity여야 한다.
- fixture `docs/engine/gameplay-golden/topdown-state-enter-action-trigger-replay.json`의 현재 replay hash는 `825f4359`다.

이 coverage는 state-enter semantics가 same-frame callback이 아니라 next-frame pre-physics producer라는 계약을 replay로 고정한다.

### 2026-06-01: Rust-owned trigger dashAction explicit aim runtime slice

non-player action executor의 다음 범위로 projectile/melee가 아니라 `dashAction`을 먼저 열었다. 단, 초기 구현의 hidden fallback(source velocity -> player -> `+X`)은 spec-owned semantics가 아니므로 제거하고, 명시적 `aim` data가 있을 때만 Rust-owned trigger dash가 실행되도록 hardening했다. projectile은 aim/target source와 bullet faction/layer semantics가 필요하고, melee는 attacker/target faction과 player damage/game-over semantics가 필요하다. 반면 dash는 `aim: "targetPlayer"` 하나만 명시하면 source transform만 deterministic하게 변경하면 되므로 `ActionTriggerQueue` consumer 확장에 가장 작은 안전한 slice다.

- `ActionTriggerQueue` consumer는 이제 source action binding을 먼저 읽고 `SpawnPrefab`과 `Dash`를 분기한다. missing binding, cooling down, 아직 지원하지 않는 projectile/melee pattern은 기존 `actionFailed` vocabulary로 관측한다.
- `dashAction.aim`은 기본값이 `input`이다. 기존 player input dash와 `set_gameplay_action_dash(...)` 호환성을 유지하기 위한 값이며, Rust-owned timer/wave/state-enter trigger에서 `input` aim dash를 실행하면 `unsupportedAimSource` failure를 내고 cooldown을 소비하지 않는다.
- Rust-owned timer/wave/state-enter trigger가 `ActionPattern::Dash { aim: TargetPlayer }`를 발동하면 source transform에서 live player transform으로 향하는 direction을 계산해 source transform을 pre-physics phase에서 갱신한다. state-enter trigger는 기존 정책대로 다음 frame pre-physics에서 실행된다.
- live player가 없거나 source와 player가 같거나 zero-length target이면 `missingActionTarget` failure를 내고 cooldown을 소비하지 않는다. source transform이 없으면 `missingSourceTransform` failure를 내고 cooldown을 소비하지 않는다.
- `set_gameplay_action_dash_with_aim(..., aimCode)`를 추가했다. aim code `0`은 `input`, `1`은 `targetPlayer`다. TS adapter는 `aim: "input"` 또는 missing aim이면 legacy `set_gameplay_action_dash(...)`를 호출하고, `aim: "targetPlayer"`이면 새 setter를 요구한다.
- 이 slice는 projectile/dash/melee 전체 공통 action system 완성이 아니다. 특히 projectile의 aim/target과 bullet collision target, melee의 faction/target damage 의미는 별도 결정 전까지 열지 않는다.

이 실행 경로도 TS callback을 만들지 않는다. action 선언과 trigger 연결은 낮은 빈도 authoring data이고, 실제 transform write와 cooldown state 변경은 Rust frame loop 안에서 끝난다.

### 2026-06-01: Rust-owned trigger dashAction golden replay coverage slice

`dashAction.aim = "targetPlayer"` state-enter trigger도 deterministic replay fixture로 고정했다. 이 slice의 목적은 successful triggered dash가 성공 이벤트 없이 source transform만 바꾸는 계약을 agent가 golden diff로 확인할 수 있게 하는 것이다.

- `docs/engine/gameplay-golden/scenarios.json`에 `topdown-state-enter-dash-action-trigger` scenario를 추가했다.
- scenario는 authoring frame에서 source body를 만들고, source에 `timer -> FSM transition -> state-enter dashAction`을 설치한다. `dashAction`은 action id `21`, distance `80`, aim code `1(targetPlayer)`로 고정한다.
- transition frame의 gameplay event 순서는 `timer -> behaviorStateChanged`다. 이 frame에서는 source body가 아직 이동하지 않아야 한다.
- 다음 frame은 state-enter `NextFramePrePhysics` dash 실행 frame이다. 성공 dash는 현재 success gameplay event를 만들지 않으므로 `gameplayEvents === []`를 기대하고, 대신 source physics query 결과가 `(720, 240)`에서 `(640, 240)`으로 이동했는지와 entity count가 증가하지 않았는지를 검증한다.
- fixture `docs/engine/gameplay-golden/topdown-state-enter-dash-action-trigger-replay.json`의 현재 replay hash는 `26cb02ea`다.

이 coverage도 frame hot path TS callback을 만들지 않는다. source position은 smoke의 저빈도 `query_physics_entity(...)`로 fixture custom state에만 캡처한다. non-player action cooldown commit은 built-in shooter snapshot에 직렬화되지 않으므로 golden에서 억지로 관측하지 않고 Rust unit test coverage에 맡긴다.

### 2026-06-01: Rust-owned trigger dashAction failure golden replay coverage slice

`dashAction.aim = "input"`을 Rust-owned state-enter trigger에서 실행하려는 실패 경로도 deterministic replay fixture로 고정했다. 이 slice의 목적은 player input 전용 aim source를 non-player trigger에서 암묵 fallback으로 처리하지 않고, agent가 `actionFailed(unsupportedAimSource)` telemetry와 무이동 결과를 golden diff로 확인하게 하는 것이다.

- `docs/engine/gameplay-golden/scenarios.json`에 `topdown-state-enter-dash-input-aim-failure` scenario를 추가했다.
- scenario는 success fixture와 같은 `timer -> FSM transition -> state-enter dashAction` 구조를 쓰되, `dashAction.aimCode = 0(input)`과 action id `22`를 사용한다.
- transition frame의 gameplay event 순서는 success fixture와 동일하게 `timer -> behaviorStateChanged`다. 이 frame에서는 source body가 아직 이동하지 않아야 한다.
- 다음 frame은 state-enter dash 실행 시도 frame이다. 기대 event는 `actionFailed` 하나이며, `payloadBits`는 `unsupportedAimSource(10)`이어야 한다. source physics query 결과는 `(720, 240)` 그대로이고 entity count도 증가하지 않아야 한다.
- fixture `docs/engine/gameplay-golden/topdown-state-enter-dash-input-aim-failure-replay.json`의 현재 replay hash는 `fa0cb297`다.

이 coverage는 실패를 TS callback이나 JS-side aim 계산으로 보정하지 않는다. `aim: "input"`은 player input dash 호환 기본값으로 남지만, timer/wave/state-enter trigger에서 쓰려면 실패 telemetry를 내고 cooldown을 소비하지 않는 Rust-owned 계약을 고정한다.

### 2026-06-01: projectileAction target/faction authoring contract slice

non-player projectile runtime을 바로 열지 않고, 먼저 projectile target/aim과 collision target을 authoring data로 고정했다. 이유는 현재 Shooter bullet이 player primary fire 의미를 강하게 갖고 있어, timer/wave/state-enter source가 player를 향해 발사하는 순간 bullet collision layer, target mask, player damage/game-over, score attribution 의미가 동시에 결정되어야 하기 때문이다.

- `projectileAction`은 이제 `aim`과 `collisionTarget`을 가진다. `aim`은 `input` 또는 `targetPlayer`, `collisionTarget`은 `enemies` 또는 `player`다.
- 기본값은 기존 behavior와 호환되는 `aim: "input"`, `collisionTarget: "enemies"`다. 따라서 built-in player primary fire recipe와 기존 `set_gameplay_action_projectile(...)` 경로는 유지된다.
- `behaviorRecipeCommandsForEntity(...)`는 이 두 필드를 `configureProjectileAction` command로 전달한다. agent는 non-player projectile을 쓰고 싶을 때 `aim: "targetPlayer"`, `collisionTarget: "player"`를 spec에 명시할 수 있다.
- default runtime adapter는 아직 `aim: "input"` + `collisionTarget: "enemies"`만 적용한다. 그 외 조합은 JSON path diagnostic으로 실패해, agent가 unsupported projectile semantics를 조용히 Rust storage에 적용하지 못하게 한다.
- Rust/Wasm ABI는 이번 slice에서 바꾸지 않는다. `ActionPattern::Projectile` storage와 built-in Shooter snapshot은 기존 player projectile 계약을 유지한다.

이 slice는 projectile runtime 완성이 아니라, 다음 runtime 구현 전의 machine-actionable 계약이다. 실제 Rust-owned triggered projectile을 열려면 hostile/player projectile faction, collision mask, player damage/game-over, score attribution, projectile success/failure telemetry, snapshot/replay 범위를 함께 결정해야 한다.

### 2026-06-01: Rust-owned trigger projectileAction targetPlayer/player runtime slice

`projectileAction` target/faction 계약을 실제 Rust-owned trigger runtime으로 연결했다. 범위는 기존 player primary fire 의미인 `aim: "input"` + `collisionTarget: "enemies"`와, timer/wave/state-enter 같은 Rust-owned trigger에서 쓰는 `aim: "targetPlayer"` + `collisionTarget: "player"` 두 조합으로 제한한다.

- `ActionPattern::Projectile`은 `aim`, `collisionTarget`, `tileImpact`를 함께 저장한다. legacy `set_gameplay_action_projectile(...)`는 player primary fire 호환 기본값 `input/enemies/despawn`을 유지하고, `set_gameplay_action_projectile_with_target(..., aimCode, collisionTargetCode, tileImpactCode)`가 targeted projectile을 낮은 빈도 authoring 경계에서 설치한다.
- TS `BehaviorRecipe` adapter는 `input/enemies`와 `targetPlayer/player`만 허용한다. `input/player`, `targetPlayer/enemies` 조합은 JSON path diagnostic으로 실패해 agent가 애매한 faction 의미를 조용히 적용하지 못하게 한다.
- Rust-owned action trigger가 `targetPlayer/player` projectile을 실행하면 source transform에서 live player transform으로 향하는 bullet spawn command를 pre-physics queue에 적재한다. cooldown은 aim/source/target/capacity 검증이 끝난 뒤에만 소비한다.
- bullet에는 `ProjectileCollisionTarget` metadata를 저장한다. `Enemies` bullet은 기존 Bullet->Enemy damage/score path를 타고, `Player` bullet은 Bullet->Player collision에서 game-over를 만들며 enemy score path를 타지 않는다.
- in-flight bullet collision target metadata는 `World` snapshot과 built-in Shooter snapshot/replay에 포함된다. queued spawn/action command 자체는 기존 정책대로 restore 시 보존하지 않는다.
- 미지원 collision target은 cooldown을 소비하지 않고 `actionFailed(unsupportedCollisionTarget)` reason code `12`로 관측된다. 성공 projectile은 별도 success gameplay event를 만들지 않고 game-state/collision 결과로 검증한다.

이 slice도 frame hot path TS callback을 만들지 않는다. spec 적용은 scene load/agent apply 같은 낮은 빈도 setter 경계이고, projectile 생성과 충돌 판정은 Rust frame loop 안에서 pending spawn queue와 collision phase로 처리된다.

### 2026-06-01: Rust-owned trigger projectileAction golden replay coverage slice

state-enter `projectileAction`도 deterministic replay fixture로 고정했다. 목적은 targeted projectile의 next-frame execution, Bullet->Player game-over, unsupported collision target failure를 agent가 golden diff로 확인할 수 있게 하는 것이다.

- `docs/engine/gameplay-golden/scenarios.json`에 `topdown-state-enter-projectile-action-trigger` scenario를 추가했다. action id `41`, aim code `1(targetPlayer)`, collision target code `1(player)`를 사용한다.
- transition frame의 gameplay event 순서는 기존 state-enter producer와 같이 `timer -> behaviorStateChanged`다. projectile 실행 frame에서는 성공 이벤트 없이 bullet/player collision 결과로 game state가 game-over가 되는지를 검증한다.
- fixture `docs/engine/gameplay-golden/topdown-state-enter-projectile-action-trigger-replay.json`의 현재 replay hash는 `ec17aeb7`다.
- 실패 fixture `topdown-state-enter-projectile-collision-target-failure`는 action id `42`, aim code `1(targetPlayer)`, collision target code `0(enemies)`를 사용한다.
- 실패 실행 frame은 `actionFailed` 하나를 기대하고 `payloadBits === unsupportedCollisionTarget(12)`를 검증한다. cooldown은 소비하지 않고, projectile이 player game-over path로 진행하지 않아야 한다.
- fixture `docs/engine/gameplay-golden/topdown-state-enter-projectile-collision-target-failure-replay.json`의 현재 replay hash는 `e92e25b5`다.

이 coverage로 projectile authoring contract와 Rust-owned runtime 의미가 같은 golden replay gate 안에 묶인다. melee는 별도 target/faction 의미를 닫은 뒤 후속 slice에서 연다.

### 2026-06-01: projectileAction tileImpact explicit despawn policy slice

Bullet/Tile 충돌도 code callback이 아니라 projectile action spec의 작은 정책 필드로 표현하도록 authoring surface를 닫았다. 현재 런타임 동작은 기존 Shooter 의미와 같지만, agent가 “타일에 닿으면 어떻게 되는가”를 암묵 구현 지식이 아니라 spec에서 읽고 검증할 수 있게 하는 것이 목적이다.

- `projectileAction.tileImpact`를 추가하고 기본값은 `"despawn"`으로 둔다. 최초 slice에서는 public 값이 `"despawn"` 하나뿐이었고, 아래 pass-through slice에서 `"passThrough"`, 이후 bounce slice에서 `"bounce"`를 열었다. `explode`, destructible terrain 같은 의미는 여전히 diagnostic으로 거부한다.
- TS recipe resolver와 `configureProjectileAction` command는 normalized `tileImpact`를 전달한다. Rust/Wasm targeted setter는 현재 `tileImpactCode = 0(despawn)`, `1(passThrough)`, `2(bounce)`를 허용하고 `ActionPattern::Projectile`에는 `ProjectileTileImpact`를 저장한다.
- legacy `set_gameplay_action_projectile(...)` path도 같은 `despawn` 기본값으로 delegation한다. 따라서 기존 player primary fire와 replay fixture 의미는 바뀌지 않는다.
- runtime Bullet/Tile behavior는 계속 blocking tile hit 시 bullet deferred despawn이다. authored `collisionSound`, `collisionParticle(target: "self")`, `collisionDespawn(target: "self")` side effect는 기존 충돌 reaction 경로를 재사용한다.
- 이 slice는 public `CollisionTarget`에 `"tile"`을 추가하지 않는다. Tile은 entity target이 아니므로 `Damage(Tile)`, `SpawnParticle(target: "other")`, destructible tile payload는 별도 tile event/query 설계 전까지 제외한다.

이 방향은 visual editor나 scripting runtime을 여는 것이 아니다. 반복되는 projectile impact 정책을 데이터로 선언하고, 실제 판정과 구조 변경은 Rust frame loop와 deferred command buffer 안에서 처리한다.

### 2026-06-01: projectileAction tileImpact passThrough runtime slice

tile impact policy의 두 번째 값을 작은 vertical slice로 열었다. 목표는 타일을 entity target으로 만들지 않고, projectile 자체가 blocking tile impact를 무시할 수 있는지 여부만 spec으로 선언하는 것이다.

- `ProjectileTileImpact::PassThrough` numeric code `1`을 추가했다. `despawn`은 code `0`으로 유지해 legacy/default 의미를 보존한다.
- `ProjectileSpawnCommand`와 `BulletSpawnRequest`에 tile impact를 싣고, `World.projectile_tile_impacts`에 in-flight bullet별 정책을 저장한다. action binding metadata에서 spawn된 bullet runtime state까지 정책이 끊기지 않는다.
- tile collision phase에서 `passThrough` projectile은 blocking tile impact를 완전히 건너뛴다. 이 경우 authored tile-side `PlaySound`, `SpawnParticle(self)`, `Despawn(self)`, cooldown commit, `collisionDespawn` telemetry도 실행하지 않고, 같은 frame의 bullet/enemy 또는 bullet/player collision phase로 진행한다.
- built-in Shooter snapshot version을 `8`로 올리고, in-flight bullet tile impact와 player primary projectile action tile impact를 저장/복원한다. entity stride는 유지하고 기존 projectile policy u32 slot에 collision target과 tile impact를 packed numeric value로 저장한다.
- TS adapter는 기본 `input/enemies` projectile이라도 `tileImpact: "passThrough"`이면 extended setter `set_gameplay_action_projectile_with_target(..., 0, 0, 1)`를 사용한다. legacy setter는 default `despawn` 경로로 남긴다.
- schema와 public docs는 `"despawn" | "passThrough" | "bounce"`를 허용한다.

이 slice도 public `CollisionTarget`에 `"tile"`을 추가하지 않는다. destructible terrain, impact position payload, tile event kind, JS/TS callback은 계속 제외한다.

### 2026-06-01: projectileAction tileImpact bounce runtime slice

tile impact policy의 세 번째 값을 열어, blocking tile에 닿은 projectile이 despawn이나 pass-through가 아니라 반사될 수 있게 했다. 이 slice도 tile을 entity target으로 만들지 않고 projectile 자체의 impact policy만 확장한다.

- `ProjectileTileImpact::Bounce` numeric code `2`를 추가했다. 기존 `despawn = 0`, `passThrough = 1` code는 유지한다.
- tile collision query는 blocking tile hit 여부만 반환하지 않고 가장 이른 swept AABB contact normal을 반환한다. 동률은 layer/tile index로 고정해 결정성을 유지한다.
- `bounce` projectile은 blocking tile hit frame에 contact normal로 velocity를 반사하고 contact 지점 근처로 transform을 되돌린다. 따라서 같은 frame의 enemy/player collision phase에서 벽 뒤 target을 관통해 맞추지 않는다.
- `bounce`는 tile impact side effect를 건너뛰지 않는다. authored `PlaySound`, `SpawnParticle(target: "self")`, `Despawn(target: "self")`는 `despawn`과 같은 tile-side reaction path로 additive 실행되며, `Despawn(self)`가 있으면 bounce보다 명시 despawn이 우선한다.
- TS recipe resolver, adapter, schema, public type은 `"bounce"`를 허용하고 `set_gameplay_action_projectile_with_target(..., tileImpactCode = 2)`로 전달한다.
- built-in Shooter snapshot version을 `10`으로 올렸다. collision target/tile impact packed u32 layout과 entity stride는 그대로지만, version `10`은 `tileImpactCode = 2(bounce)`가 public save/replay snapshot에 들어갈 수 있음을 명시한다. 기존 fixture에는 bounce in-flight bullet이 없어서 시뮬레이션 의미는 유지되지만, snapshot format bump가 replay input에 포함되므로 golden replay hash는 version `10` 기준으로 재생성했다. bounce projectile을 golden replay 대상으로 추가하는 시점에는 fixture metadata에서 `tileImpactCode = 2`를 명시한다.

이 slice는 restitution, bounce count, random spread, tile damage, impact position event를 열지 않는다. 더 복잡한 projectile material policy가 필요하면 별도 data field와 replay fixture로 확장한다.

### 2026-06-01: Rust-owned trigger meleeAction targetPlayer runtime slice

`meleeAction`도 code callback이 아니라 spec target 선언으로 실행 의미를 고정했다. 기존 player melee 의미는 `target: "enemies"` 기본값으로 유지하고, Rust-owned timer/wave/state-enter trigger에서 실행하는 non-player melee는 `target: "player"`만 허용한다.

- `ActionPattern::Melee`는 `target`을 함께 저장한다. legacy `set_gameplay_action_melee(...)`는 player input 호환 기본값 `enemies`를 유지하고, `set_gameplay_action_melee_with_target(..., targetCode)`가 targeted melee를 낮은 빈도 authoring 경계에서 설치한다.
- TS `BehaviorRecipe` adapter는 `meleeAction.target`을 `enemies|player`로 검증하고 command에 normalized target을 포함한다. `target: "enemies"`는 legacy setter path, `target: "player"`는 targeted setter path를 사용한다.
- player input melee는 계속 action id `3`, `target: "enemies"`만 실행한다. player가 `target: "player"` melee binding을 갖고 input으로 발동하면 pattern mismatch failure가 되고 cooldown을 소비하지 않는다.
- Rust-owned action trigger가 `target: "player"` melee를 실행하면 source transform과 live player target을 검증한 뒤 pending melee command를 pre-physics action phase에 적재한다. source가 live player 자신이거나 target이 없으면 `missingActionTarget(11)`로 실패한다.
- combat phase에서 player가 range 안에 있으면 `GameOver`가 되고 score/despawn/success gameplay event는 발생하지 않는다. range 밖 whiff도 유효한 공격으로 보고 cooldown을 소비한다.
- Rust-owned trigger에서 `target: "enemies"` melee를 실행하려 하면 cooldown을 소비하지 않고 `actionFailed(unsupportedCollisionTarget)` reason code `12`로 실패한다.
- built-in Shooter snapshot은 player melee binding/cooldown만 저장한다. non-player action binding과 timer/wave/state-enter trigger save scope는 넓히지 않는다.

이 slice도 frame hot path TS callback, 임시 hitbox entity, generic faction matrix를 만들지 않는다. 범위는 player input melee와 non-player target-player melee 두 계약만 닫는 최소 runtime 확장이다.

### 2026-06-01: Rust-owned trigger meleeAction golden replay coverage slice

state-enter `meleeAction`도 deterministic replay fixture로 고정했다. 목적은 target-player melee의 next-frame execution, player game-over, unsupported target failure를 agent가 golden diff로 확인할 수 있게 하는 것이다.

- `docs/engine/gameplay-golden/scenarios.json`에 `topdown-state-enter-melee-action-trigger` scenario를 추가했다. action id `51`, target code `1(player)`, range `64`, damage `1`을 사용한다.
- transition frame의 gameplay event 순서는 기존 state-enter producer와 같이 `timer -> behaviorStateChanged`다. melee 실행 frame에서는 성공 이벤트 없이 game state가 game-over가 되고 score가 `0`으로 유지되는지를 검증한다.
- fixture `docs/engine/gameplay-golden/topdown-state-enter-melee-action-trigger-replay.json`의 현재 replay hash는 `a12af011`다.
- 후속 변경 전 실패 fixture `topdown-state-enter-melee-target-failure`는 action id `52`, target code `0(enemies)`로 `unsupportedCollisionTarget(12)`를 검증했다.
- 2026-06-02 enemy-target slice 이후 이 coverage는 success fixture `topdown-state-enter-melee-enemy-target`로 대체됐고, 현재 replay hash는 `afa2aca6`다.

이 coverage로 melee authoring contract와 Rust-owned runtime 의미가 같은 golden replay gate 안에 묶인다. player/authored `target: enemies` melee는 기존 pending melee combat path를 사용하므로 enemy kill 시 target `scoreReward`를 점수로 반영한다. Rust-owned `target: player` melee는 GameOver 경로이며 score를 만들지 않는다. 이 slice 시점에는 아직 generic faction/friendly-fire matrix, non-player `target: enemies`, player health/armor/knockback, melee faction damage gate를 열지 않았다.

후속 2026-06-02 `Rust-owned meleeAction target enemies runtime slice`에서 non-player `target: enemies` 실행은 열렸고, 이 섹션의 unsupported-target fixture는 enemy-target success fixture로 대체됐다.

### 2026-06-01: authored Player damage collision reaction runtime slice

player/enemy 접촉 GameOver도 code-only fallback에서 한 단계 데이터 기반 collision reaction으로 끌어올렸다. 새 reaction enum을 만들지 않고 기존 `CollisionReaction::Damage`와 `configureDamage` 경로를 재사용한다.

- Player/Enemy 충돌에서 양쪽 모두 authored `CollisionReactionSet`이 없으면 기존처럼 접촉 즉시 `GameOver` fallback을 유지한다.
- 둘 중 하나라도 authored collision reaction이 있으면 authored reaction이 fallback보다 우선한다. 따라서 non-lethal player damage, explicit despawn, no-op reaction 같은 데이터가 기존 즉시 GameOver를 억제할 수 있다.
- enemy가 `Damage { target: OtherEntity }` reaction과 damage component를 가지면 player health를 차감한다. player health가 0 이하가 되면 scene은 `GameOver`가 되지만 player entity는 despawn되지 않는다.
- player lethal damage의 `collisionDamage` telemetry는 `targetRemoved: false`로 남긴다. 명시적 `Despawn` reaction만 deferred removal을 의미한다.
- cooldown/invulnerability는 아직 도입하지 않는다. 현재 계약은 collision pair당 frame damage이며, 여러 enemy가 같은 frame에 겹치거나 접촉이 지속되면 반복 damage가 가능하다.

이 slice는 frame hot path JS callback, 새 Wasm ABI, generic faction matrix를 추가하지 않는다. 기존 player/enemy broadphase 결과와 fixed-capacity collision reaction set을 재사용한다.

### 2026-06-01: authored Player damage collision golden replay coverage slice

player damage collision reaction도 deterministic replay fixture로 고정했다. 목적은 agent가 player contact damage를 spec으로 바꿨을 때 GameOver, entity 보존, event payload를 golden diff로 확인할 수 있게 하는 것이다.

- `docs/engine/gameplay-golden/scenarios.json`에 `topdown-authored-player-damage-collision` scenario를 추가했다.
- authoring event는 live player와 겹치는 enemy body를 만들고, player health `1`, enemy damage `1`, enemy `Damage(target: other)` reaction을 설치한다.
- 충돌 frame은 `collisionDamage` 하나를 기대한다. actor는 player, source는 enemy, payload는 damage `1.0`, `targetRemoved`는 `false`여야 한다.
- final score는 `0`, final game state는 `GameOver(2)`, entity count는 setup 이후와 동일해야 한다. 즉 player damage는 player/enemy despawn이나 score reward path를 타지 않는다.
- fixture `docs/engine/gameplay-golden/topdown-authored-player-damage-collision-replay.json`의 현재 replay hash는 `2ff60ec2`다.

이 coverage는 collision reaction/audio/tile/game-over 전부를 공통 reaction system으로 일반화한 것이 아니다. 다만 가장 위험한 player game-over fallback을 authored damage reaction과 같은 deterministic replay gate에 넣어 다음 reaction vocabulary 확장의 기준점을 만든다.

### 2026-06-01: collisionSound reaction runtime/API slice

audio side effect도 callback이 아니라 authored collision reaction vocabulary로 표현할 수 있게 했다. 범위는 기존 `AudioEvent` buffer를 재사용하는 additive SFX reaction으로 제한한다.

- `CollisionReaction::PlaySound { sound_id, volume, pitch }`를 fixed-capacity `CollisionReactionSet`에 추가했다. storage는 numeric/Copy data만 담고 문자열, asset object, TS callback을 넣지 않는다.
- `add_gameplay_collision_sound(entity, generation, soundId, volume, pitch)`는 generation-checked 낮은 빈도 authoring setter이며 positive sound id, non-negative finite volume, positive finite pitch만 허용한다.
- `BehaviorRecipe`에는 `collisionSound` kind와 `configureCollisionSound` command를 추가했다. TS adapter는 runtime engine이 `add_gameplay_collision_sound(...)`를 제공할 때만 적용하며 missing setter는 JSON path diagnostic으로 실패한다.
- Shooter authored collision reaction path는 existing `push_audio_event(...)`를 사용해 audio event를 추가한다. 새 Wasm frame buffer, per-entity callback, audio-specific replay hash는 만들지 않는다.
- 이 reaction은 기본적으로 기존 Shooter hit/game-over audio를 대체하지 않는 additive side effect다. Bullet/Enemy authored collision에서는 built-in hit audio와 함께 나갈 수 있고, sound-only reaction은 Bullet/Enemy damage/despawn 또는 Player/Enemy fallback GameOver를 대체하지 않는다.
- audio event는 gameplay golden replay canonical 범위에서 제외되어 있으므로 golden fixture/hash를 갱신하지 않는다. 검증은 Rust runtime/authoring unit test와 TS recipe/adapter test로 고정한다.

one-shot collision enter sound, sound cooldown, replace-default-audio, tile projectile collision reaction은 이 slice 밖으로 남겼고, 이후 cooldown/tile/replace-default/enter-trigger slice에서 닫힌 항목은 각 진행 기록에 별도로 고정했다.

### 2026-06-01: collisionParticle reaction runtime/API slice

particle side effect도 callback이 아니라 authored collision reaction vocabulary로 표현할 수 있게 했다. 범위는 기존 `ParticleSystem`과 particle preset registry를 재사용하는 additive visual burst reaction으로 제한한다.

- `CollisionReaction::SpawnParticle { preset_id, target }`를 fixed-capacity `CollisionReactionSet`에 추가했다. storage는 preset id와 collision target code만 담고 particle config object, JS callback, renderer handle은 넣지 않는다.
- `add_gameplay_collision_particle(entity, generation, presetId, target)`는 generation-checked 낮은 빈도 authoring setter이며 `presetId < MAX_PARTICLE_PRESETS`, `target` self/other code만 허용한다. preset id `0`은 기존 particle API와 동일하게 유효한 id로 남긴다.
- `BehaviorRecipe`에는 `collisionParticle` kind와 `configureCollisionParticle` command를 추가했다. TS adapter는 runtime engine이 `add_gameplay_collision_particle(...)`를 제공할 때만 적용하며 missing setter는 JSON path diagnostic으로 실패한다.
- Shooter authored collision reaction path는 existing `ParticleSystem::spawn_burst(...)`를 사용한다. preset이 등록되어 있지 않거나 target transform이 없으면 no-op이며, 새 Wasm frame buffer나 per-entity callback은 만들지 않는다.
- 이 reaction은 기본적으로 기존 Shooter hit particle을 대체하지 않는 additive side effect다. Bullet/Enemy authored collision에서는 built-in hit particle과 함께 나갈 수 있고, particle-only reaction은 Bullet/Enemy damage/despawn 또는 Player/Enemy fallback GameOver를 대체하지 않는다.
- particle state/render output은 gameplay golden replay canonical 범위에서 제외되어 있으므로 golden fixture/hash를 갱신하지 않는다. 검증은 Rust runtime/authoring unit test와 TS recipe/adapter/type test로 고정한다.

collision enter particle, particle cooldown, replace-default-particle 정책은 이 slice 밖으로 남겼고, 이후 cooldown/replace-default/enter-trigger slice에서 닫힌 항목은 각 진행 기록에 별도로 고정했다.

### 2026-06-01: collisionSound/collisionParticle per-entity cooldown slice

접촉이 유지되는 동안 authored sound/particle side effect가 매 프레임 반복되는 문제를 callback 없이 Rust-owned reaction state로 제어할 수 있게 했다. 범위는 source entity별 cooldown이며 global audio/VFX throttle이나 collision-enter event 정책은 아니다.

- `CollisionReaction::PlaySound`와 `CollisionReaction::SpawnParticle`에 `Cooldown` state를 추가했다. duration과 remaining은 fixed-size component data 안에 들어가며 frame hot path에서 TS callback이나 object allocation을 만들지 않는다.
- `World::tick_collision_reaction_cooldowns(delta)`가 Playing phase 초반에 alive entity의 reaction cooldown을 tick한다. pause/title/game-over 중에는 gameplay time 기준으로 cooldown이 진행되지 않는다.
- `add_gameplay_collision_sound_with_cooldown(...)` / `add_gameplay_collision_particle_with_cooldown(...)` 저빈도 setter를 추가했다. 기존 setter는 cooldown `0` 호환 path로 유지된다.
- TS `BehaviorRecipe`의 `collisionSound` / `collisionParticle`은 optional `cooldownSeconds`를 받는다. `cooldownSeconds > 0`이면 `_with_cooldown` setter를 요구하고, 없거나 `0`이면 기존 setter를 사용한다.
- 같은 sound id 또는 같은 particle `presetId + target`을 다시 configure하면 `CollisionReactionSet`이 기존 slot을 교체하고 cooldown은 ready 상태로 reset한다. cooldown duration만 바뀐 재적용이 fixed-capacity slot을 중복 소비하지 않게 했다.
- tile impact에서도 cooldown state는 bullet/source entity에 붙는다. sound/particle-only bullet은 legacy tile despawn으로 사라지므로 이 정책은 tile-wide spam suppression이 아니다. 여러 bullet의 tile impact를 전역으로 제한하려면 별도 audio/VFX bus throttle을 설계해야 한다.
- built-in Shooter snapshot은 authored non-player collision reaction config/state를 아직 canonical save scope에 포함하지 않는다. `WorldSnapshot` 기반 restore는 component clone으로 cooldown state를 보존하지만, public built-in shooter save/load 경로에서는 behavior recipe를 낮은 빈도로 다시 적용해야 한다.

이 slice는 one-shot collision-enter sound/particle, global cooldown bucket, tile-specific impact event kind를 열지 않는다. replace-default-audio/VFX와 enter trigger는 후속 policy slice에서 별도 데이터로 열었다.

### 2026-06-01: collisionSound/collisionParticle replace-default policy slice

기존 Shooter hit audio/particle과 authored side effect를 함께 낼 수 있는 additive 기본값은 유지하되, 필요한 경우 built-in default effect만 suppress할 수 있게 했다. 범위는 audio/VFX replacement policy이며 damage/despawn/game-over gameplay override가 아니다.

- `CollisionReaction::PlaySound`와 `CollisionReaction::SpawnParticle`에 `replace_default` boolean policy를 추가했다. 이 값도 numeric/Copy component data이며 frame hot path에서 TS callback이나 object allocation을 만들지 않는다.
- `add_gameplay_collision_sound_with_policy(...)` / `add_gameplay_collision_particle_with_policy(...)` 저빈도 setter를 추가했다. 기존 setter와 `_with_cooldown` setter는 `replace_default: false` 호환 path로 유지된다.
- TS `BehaviorRecipe`의 `collisionSound` / `collisionParticle`은 optional `replaceDefault`를 받는다. `replaceDefault: true`이면 `_with_policy` setter를 요구하고, 없거나 `false`이면 기존 additive/cooldown path를 사용한다.
- runtime outcome을 `overrides_default_gameplay`와 `replace_default_audio`/`replace_default_particle`로 분리했다. `PlaySound`/`SpawnParticle`만 있는 side-effect-only reaction은 Bullet/Enemy default damage/despawn과 Player/Enemy fallback GameOver를 끄지 않는다. `Damage`/`Pickup`/`Despawn` 같은 gameplay reaction만 fallback gameplay를 대체한다.
- Bullet/Enemy 충돌에서 `replaceDefault` sound는 built-in hit audio를 suppress하고, `replaceDefault` particle은 built-in hit particle을 suppress한다. 둘 다 default damage/despawn/score path는 유지한다.
- Player/Enemy authored lethal damage에서 `replaceDefault` sound는 built-in game-over audio를 suppress한다. non-lethal authored damage는 기존처럼 fallback GameOver를 대체한다.
- Bullet/Tile impact에는 대체할 built-in audio/particle default가 없으므로 `replaceDefault`는 no-op이다. tile path는 authored self sound/particle side effect와 legacy bullet despawn만 유지한다.

이 slice는 one-shot collision-enter, global audio/VFX bus throttle, tile-specific impact default effect, generic faction matrix를 열지 않는다. one-shot collision-enter는 후속 enter-trigger slice에서 `trigger: "enter"` 데이터로 열었다.

### 2026-06-01: collisionSound/collisionParticle enter trigger slice

authored sound/particle side effect를 매 접촉 frame이 아니라 새 collision contact가 시작된 frame에만 실행할 수 있게 했다. 범위는 `collisionSound`/`collisionParticle`의 side effect trigger policy이며, collision lifecycle event vocabulary나 generic trigger event bus가 아니다.

- TS `BehaviorRecipe`의 `collisionSound` / `collisionParticle`은 optional `trigger: "contact" | "enter"`를 받는다. 기본값은 `"contact"`이며 기존 additive/cooldown/replaceDefault 동작을 보존한다.
- Rust `CollisionReaction::PlaySound` / `CollisionReaction::SpawnParticle`에는 `CollisionReactionTrigger::{Contact, Enter}` fixed numeric data를 저장한다. `add_gameplay_collision_sound_with_trigger(...)` / `add_gameplay_collision_particle_with_trigger(...)`는 trigger code `0(contact)`, `1(enter)`만 허용하고, 기존 setter와 `_with_cooldown`, `_with_policy` setter는 contact 호환 path로 유지한다.
- Shooter runtime은 authored entity/entity collision reaction을 실행할 때 `(entity id, generation)` pair를 정렬한 deterministic key로 `previous/current` contact set에 기록한다. reset/restore는 이 transient contact set을 clear한다. 따라서 restore 직후 이미 겹쳐 있는 authored pair는 새 enter로 다시 관측될 수 있으며, 현재 built-in Shooter save scope에 authored non-player collision reaction runtime state를 넣지 않는 정책과 맞춘 의도적 transient semantics다.
- contact set은 Rust frame scratch의 bounded sorted vector로 유지한다. 이전 frame 조회는 `binary_search`를 사용하고, cap 초과 pair는 unbounded allocation을 피하기 위해 enter-only side effect를 보수적으로 drop한다. `trigger: "contact"` reaction은 이 cap과 무관하게 기존 contact frame path를 따른다.
- `trigger: "enter"`는 새 pair가 직전 collision frame에 없을 때만 authored sound/particle side effect와 해당 reaction cooldown commit을 허용한다. 접촉이 유지되는 stay frame에서는 cooldown도 소비하지 않는다.
- `trigger: "contact"`는 기존처럼 접촉 frame마다 실행 가능하고, `cooldownSeconds`가 있으면 source entity reaction state의 cooldown으로 제한된다.
- `replaceDefault`는 trigger와 독립적인 built-in effect suppression policy다. side-effect-only reaction은 여전히 default damage/despawn/game-over/pickup gameplay를 대체하지 않으며, `replaceDefault`도 audio/VFX default만 suppress한다.
- Bullet/Tile impact는 public `"tile"` target을 열지 않는다. tile impact는 terminal projectile hit이므로 `trigger: "enter"`도 true로 취급해 authored self sound/particle side effect를 한 번 실행할 수 있게 한다.
- 이 slice는 collision-exit/stay event, global audio/VFX bus throttle, tile-specific impact event kind, visual editor, user scripting runtime을 열지 않는다.

검증은 Rust enter-only runtime unit test, generation-checked authoring setter test, TS recipe/adapter test로 고정한다. audio/particle output은 gameplay replay canonical hash 범위가 아니므로 golden fixture를 갱신하지 않는다.

### 2026-06-01: tile projectile collision authored reaction bridge slice

projectile이 blocking tile에 닿는 경로도 authored collision reaction과 연결했다. 다만 tile을 public `CollisionTarget`으로 열지 않고 기존 Shooter projectile/tile 의미를 보존하는 bridge 범위로 제한한다.

- Bullet/Tile 충돌은 Bullet/Enemy 충돌보다 먼저 실행되는 기존 phase order를 유지한다. 따라서 같은 frame에 tile과 enemy를 모두 만나는 bullet은 tile에서 먼저 despawn되고 enemy damage/score path를 타지 않는다.
- projectile blocking tile hit는 authored reaction set 존재 여부와 무관하게 legacy default bullet despawn을 유지한다. sound-only 또는 particle-only projectile이 tile을 통과하는 의미 변화는 허용하지 않는다.
- `CollisionReaction::PlaySound`와 `CollisionReaction::SpawnParticle { target: SelfEntity }`는 tile impact에서 additive side effect로 실행된다. `CollisionReaction::Despawn { target: SelfEntity }`는 같은 deferred despawn queue를 사용하고, 실제 queue에 들어간 경우 `collisionDespawn` telemetry를 남긴다.
- `Damage`, `Despawn(target: OtherEntity)`, `SpawnParticle(target: OtherEntity)`는 tile impact에서 no-op이다. 현재 tile은 entity/health/storage owner가 아니므로 `Damage(Tile)` 또는 `Despawn(Tile)` semantics를 만들지 않는다.
- TS public recipe에는 `"tile"` target을 추가하지 않았다. `collisionDespawn` recipe는 기존 entity collision target vocabulary(`self`/`other`)만 사용하고, tile-specific policy는 후속 destructible terrain 또는 projectile impact policy 설계에서 다룬다.
- 검증은 legacy tile despawn, tile hit before enemy damage, height-span filtering, authored self despawn telemetry, sound-only legacy despawn, unsupported other-target no-op 테스트로 고정한다.

이 slice는 destructible terrain, tile health, impact position payload, projectile bounce policy, tile-specific gameplay event kind를 열지 않았다. 이후 pass-through와 bounce는 projectile 자체의 impact policy로만 열었고 tile entity/target semantics는 만들지 않았다.

### 2026-06-01: GameplayFaction authored damage gate slice

generic faction/friendly-fire matrix를 바로 열기 전에, spec으로 선언 가능한 최소 damage policy를 먼저 Rust-owned component로 고정했다. 목적은 `CollisionLayer`를 gameplay faction으로 오염시키지 않고, agent가 player/enemy damage 관계를 JSON recipe로 수정할 수 있는 작은 안전 범위를 만드는 것이다.

- `BehaviorRecipe`에는 `faction` kind와 `configureFaction` command를 추가했다. `faction`은 `"neutral" | "player" | "enemy"`이고, `damages`는 damage를 허용할 target faction 목록이다. 기본값은 player -> enemy, enemy -> player, neutral -> none이다.
- TS adapter는 `configureFaction`을 낮은 빈도 `set_gameplay_faction(entity, generation, factionId, damageMask)` 호출로 변환한다. hot path JS callback이나 per-entity Wasm 왕복 호출은 만들지 않는다.
- Rust core에는 별도 `GameplayFaction { faction_id, damage_mask }` component를 추가했다. 이 component는 physics `CollisionLayer`와 분리된 gameplay damage policy이며, broadphase/collision candidate 생성에는 관여하지 않는다.
- 첫 runtime 적용 범위는 authored `CollisionReaction::Damage` gate로 제한한다. source와 target 양쪽 모두 faction이 있을 때만 `source.damageMask`가 target faction을 허용하는지 검사하고, 한쪽이라도 faction이 없으면 기존 legacy 동작을 유지한다.
- projectile source faction은 bullet spawn 시 복사하고 built-in Shooter snapshot version `11`에 저장된다. 이 slice 시점에는 다만 melee faction damage gate, full generic friendly-fire matrix, scene-level faction relation table을 아직 열지 않았다.

이 slice는 visual editor, scripting runtime, collision layer taxonomy 변경이 아니다. faction은 agent가 patch하기 쉬운 spec data이고, 실행은 Rust frame loop의 기존 authored damage reaction 경로에 묶는다.

### 2026-06-01: projectile source faction default damage gate slice

authored `Damage` reaction에만 적용되던 `GameplayFaction`을 기본 projectile damage path까지 좁게 확장했다. 목적은 player/enemy projectile friendly-fire 정책을 code callback이 아니라 spec/component data로 표현하면서도 full faction matrix나 melee faction damage gate를 당시 한 번에 열지 않는 것이다.

- projectile spawn command는 source entity의 `GameplayFaction`을 `BulletSpawnRequest.source_faction`으로 복사한다. source에 faction이 없으면 bullet도 faction을 갖지 않아 기존 legacy 동작을 유지한다.
- `World::spawn_bullet_from_request(...)`는 in-flight bullet의 `gameplay_factions` slot에 source faction을 저장한다. 이 값은 physics `CollisionLayer`나 broadphase mask가 아니라 damage policy metadata다.
- 기본 Bullet->Enemy와 Bullet->Player damage path는 source bullet과 target 양쪽에 faction이 있을 때만 `source.damageMask`가 target faction을 허용하는지 검사한다. 한쪽이라도 faction이 없으면 기존 legacy allow 동작을 유지한다.
- damage mask가 거부하면 기본 bullet hit는 pass-through처럼 처리한다. bullet despawn, 기본 hit collision telemetry, 기본 hit audio/particle, score 증가, player game-over를 만들지 않는다. 별도 `actionFailed`나 faction-denied telemetry는 이번 slice에서 만들지 않는다.
- built-in Shooter snapshot version을 `10`으로 올리고, in-flight bullet source faction id/damage mask를 collision target/tile impact metadata와 함께 저장/복원한다.

이 slice는 full generic faction matrix가 아니다. 이 slice 시점에는 melee faction damage gate, team relation table, neutral policy 확장, faction-denied event kind를 후속 설계 범위로 남겼다.

### 2026-06-01: wave-enter spawnPrefabAction golden replay coverage slice

wave-enter producer를 단위 테스트와 engine 테스트에만 두지 않고, 별도 deterministic replay fixture로 고정했다. 이 slice의 목적은 wave advance가 Rust-owned `ActionTriggerQueue`를 통해 non-player `spawnPrefabAction` consumer까지 연결되는지 agent가 golden diff로 확인할 수 있게 하는 것이다.

- `docs/engine/gameplay-golden/scenarios.json`에 `topdown-wave-action-trigger` scenario를 추가했다. 이 scenario는 built-in Shooter player를 source entity로 사용하고, source의 `ActionBindingSet`에 `spawnPrefabAction(actionId: 11)`을 설치한 뒤 wave index `1` 진입에 같은 action id를 연결한다.
- wave 설정은 index `0`의 짧은 duration 뒤 index `1`로 전환되도록 고정했다. normal wave spawn은 긴 spawn interval로 사실상 억제하고, coverage 대상은 wave-enter action trigger의 additive prefab spawn이다.
- `scripts/gameplay-replay-smoke.mjs`에 `topdownWaveActionTrigger` runner를 추가했다. runner는 동일 build 안에서 두 번 실행해 replay hash가 같은지 확인하고, fixture와 actual run을 `compareGameplayReplayRuns(...)`로 비교한다.
- fixture `docs/engine/gameplay-golden/topdown-wave-action-trigger-replay.json`의 현재 replay hash는 `4ea16efc`다.
- replay validator는 event frame의 `prefabSpawned` payload를 검증한다. source는 built-in player handle, `tokenId`는 prefab id, `payloadBits`는 action id여야 하며, spawned actor는 source와 달라야 한다. 또한 event frame entity count가 직전 capture frame보다 증가하고, final frame gameplay event buffer가 비워졌는지 확인한다.

이 coverage도 snapshot/save scope를 넓히지 않는다. wave action trigger side state는 여전히 reset/restore에서 clear되는 낮은 빈도 authoring state이며, golden fixture는 "저장 보존"이 아니라 deterministic run/telemetry 신호를 고정한다.

### 2026-06-01: Chase(Entity) tilemap navigation cache discriminator slice

`MovementPattern::Chase`의 player target과 entity target이 같은 tilemap navigation 의미를 갖도록 Shooter enemy velocity path를 정리했다. 이 slice는 새 navigation system을 만들지 않고 기존 `ShooterScene` A* waypoint/cache를 재사용한다.

- `Chase(Player)`와 `Chase(Entity)` 모두 `navigation_target(...)`을 통해 collision tilemap waypoint를 먼저 사용하고, 경로가 없으면 기존 direct direction fallback을 사용한다.
- navigation cache에는 `NavigationTargetIdentity::Player` 또는 `NavigationTargetIdentity::Entity(handle)`를 저장해 repath interval 안에서도 player target cache가 entity target chase에 재사용되지 않는다.
- entity target transform 조회는 계속 generation-checked `World::transform(...)`을 사용한다. target이 stale/despawn 상태이면 명시 movement override가 scene-level fallback으로 조용히 떨어지지 않고 zero velocity를 반환한다.
- 구현 범위는 Shooter runtime compatibility slice다. 별도 direct-line chase 의미가 필요하면 향후 `DirectChase` 같은 명시 movement option으로 열어야 하며, `Chase(Entity)`를 암묵 direct tracking으로 되돌리지 않는다.
- 회귀 테스트는 entity target이 wall tilemap에서 waypoint를 따라 우회하는지, player cache가 entity target chase에 재사용되지 않는지, stale entity target이 zero velocity를 유지하는지를 고정한다.

### 2026-06-01: scene-neutral movement pattern evaluation slice

공통 `movement_pattern_system`을 한 번에 도입하지 않고, 먼저 scene-neutral한 movement 계산과 target resolution을 `crate::gameplay` helper로 추출했다. 이 slice는 Shooter의 tilemap navigation/cache를 유지하면서, 다음 system 분리에서 재사용할 순수 계산 단위를 만든다.

- `evaluate_movement_pattern(...)`은 `Static`, `Linear`, `MoveToPoint`, `Orbit`을 바로 `Velocity`로 계산하고, `Chase`는 target handle/player transform을 generation-checked transform으로 해석한 뒤 `Chase { target, targetTransform, speed }` evaluation으로 반환한다.
- `TopdownInput`은 여전히 player input phase 전용 의미이므로 `None`을 반환해 Shooter compatibility fallback이 처리한다.
- `Chase`의 tilemap waypoint/cache는 아직 `ShooterScene` runtime에 남긴다. navigation scratch와 repath interval은 scene/tilemap 상태이므로 공통 helper가 소유하지 않는다.
- stale/despawn entity target은 `Velocity::default()`로 평가되어 scene-level fallback으로 떨어지지 않는다.
- 회귀 테스트는 common helper가 linear/move-to-point/topdown-input/chase target/stale target 의미를 scene runtime 없이 검증한다.

이 slice로 `movement_pattern_system` 후보의 첫 경계는 닫혔다. 완전한 system 분리는 `World` 순회 위치, player input snapshot 의존성, tilemap navigation scratch 소유권을 별도 설계한 뒤 진행한다.

### 2026-06-01: scene-neutral movement pattern application slice

순수 velocity 산출에서 한 단계 더 나아가, scene-neutral movement 적용 결과를 `crate::gameplay`가 직접 `World` velocity slot에 반영하도록 좁혔다.

- `apply_scene_neutral_movement_pattern(...)`은 `Static`, `Linear`, `MoveToPoint`, stale-target `Chase`, `Orbit`처럼 scene 상태가 필요 없는 패턴을 즉시 `world.velocities[index]`에 쓴다.
- valid `Chase(Player/Entity)`는 `DeferredChase { target, targetTransform, speed }`로 반환한다. Shooter runtime은 이 결과만 받아 기존 tilemap waypoint/cache를 적용한다.
- `TopdownInput`은 `Unsupported`로 남긴다. 입력 snapshot, dash/fire action dispatch, player-specific movement clamp가 아직 Shooter input phase 책임이기 때문이다.
- Shooter `update_enemy_velocity(...)`는 순수 movement pattern의 velocity write를 더 이상 장르 함수 안에서 직접 하지 않고, 공통 gameplay helper 호출 결과만 처리한다. 같은 alive enemy loop 안에서 처리하므로 collision broadphase나 별도 world scan은 늘리지 않는다.
- 회귀 테스트는 common helper가 velocity write, deferred chase, unsupported topdown input을 구분하는지 검증한다.

이 slice는 아직 완전한 `movement_pattern_system`이 아니다. 하지만 code-only fallback은 `Chase` navigation과 `TopdownInput`으로 더 좁혀졌고, 공통 helper는 별도 JS callback이나 entity별 Wasm 왕복 없이 Rust frame loop 안에서만 동작한다.

### 2026-06-01: player TopdownInput runtime binding slice

player 이동도 config-only path에서 벗어나 `MovementPattern::TopdownInput` component를 우선 보도록 연결했다.

- `topdown_input_direction(...)` / `topdown_input_velocity(...)`를 `crate::gameplay` helper로 분리해 normalized WASD 계산을 scene code 밖으로 뺐다.
- Shooter player input phase는 player entity에 `MovementPattern::TopdownInput { speed }`가 있으면 config `player_speed` 대신 component speed로 velocity를 쓴다.
- player가 `TopdownInput`을 갖지 않으면 기존 config speed fallback을 유지한다. 기존 `game.json`과 built-in Shooter behavior는 그대로 유지된다.
- `TopdownInput`은 여전히 keyboard input snapshot이 필요하므로 scene-neutral application helper에는 넣지 않는다. 다만 runtime 의미는 이제 authoring setter와 연결되어 agent가 spec으로 player 이동 속도를 조정할 수 있다.
- 회귀 테스트는 player component speed가 config speed를 override하는지와 normalized input helper의 대각선 속도 보존을 검증한다.

이 slice로 `apply_player_input(...)`의 이동 속도 code-only fallback은 닫혔다. 남은 movement fallback은 입력 phase 자체의 소유권, `Chase` tilemap navigation/cache, scene-level enemy behavior fallback이다.

### 2026-06-01: generic lifetime system runtime slice

Shooter bullet phase에 남아 있던 TTL 만료 despawn을 crate-private gameplay system으로 올렸다.

- `run_lifetime_system(...)`은 live entity 중 lifetime storage가 있는 entity를 모두 tick하고, 만료된 entity handle을 기존 deferred despawn queue에 넣는다.
- Shooter `update_bullets(...)`는 이 system을 먼저 호출한 뒤 projectile arc 갱신과 bullet out-of-bounds despawn만 처리한다. 별도 world scan은 추가하지 않고 기존 phase의 live-entity 루프를 재사용한다.
- 만료된 bullet은 이미 lifetime system이 queue했으므로 out-of-bounds path에서 중복 queue하지 않는다.
- `configureLifetime`으로 lifetime이 붙은 non-bullet entity도 이제 runtime에서 despawn된다. 이는 `BehaviorRecipe`의 lifetime 의미를 bullet 전용 code path가 아니라 gameplay component 의미로 닫는 변경이다.
- 회귀 테스트는 common helper가 enemy/pickup/persistent entity를 layer와 무관하게 처리하는지, Shooter runtime에서 non-bullet lifetime이 실제 despawn되는지 검증한다.

이 slice는 projectile arc, world-bounds despawn, save snapshot storage 이름(`bullet_lifetimes`)까지 바꾸지는 않는다. 저장 포맷/API churn을 피하면서 runtime 의미만 먼저 generic lifetime으로 이동했다.

### 2026-06-01: collision reaction pair helper extraction slice

collision reaction executor 전체를 한 번에 옮기기 전에, scene-private reaction context와 faction damage gate를 `crate::gameplay`로 이동했다.

- `CollisionReactionPair`는 source/other entity handle과 index를 함께 들고, `target_index(...)`, `target_entity(...)`, `reversed()`로 `CollisionTarget::{self, other}` 해석을 공통화한다.
- `collision_damage_allowed(...)`는 source/target `GameplayFaction`이 모두 있을 때 damage mask를 검사하고, 한쪽이라도 faction이 없으면 legacy allow 동작을 유지한다.
- Shooter `combat.rs`의 default projectile damage path와 authored collision damage reaction은 같은 `collision_damage_allowed(...)` helper를 사용한다.
- pickup reaction, authored bullet/enemy reaction, player/enemy reaction은 아직 executor 자체가 Shooter runtime에 남아 있지만, target 해석과 faction gate는 다음 `apply_collision_reactions_for_pair(...)` 추출에서 재사용 가능한 형태가 됐다.
- 회귀 테스트는 `CollisionReactionPair`의 target/reverse semantics, optional faction gate, 기존 authored bullet/enemy와 player/enemy collision reaction을 고정한다.

이 slice도 새 broadphase를 만들지 않는다. 기존 pair discovery가 찾은 pair를 더 공통 executor로 넘기기 위한 내부 타입 정리다.

### 2026-06-01: authored damage/despawn reaction executor extraction slice

`CollisionReactionPair` 위에 실제 authored `Damage`/`Despawn` reaction의 상태 변경 helper를 추가했다.

- `apply_collision_despawn_reaction_for_pair(...)`는 `CollisionTarget`을 해석하고, 기존 marked despawn scratch와 pending despawn queue를 사용해 target despawn을 1회만 queue한다.
- `apply_collision_damage_reaction_for_pair(...)`는 alive/marked/faction gate를 확인한 뒤 source damage, target health, kill 판정, optional despawn-on-kill queue를 공통 처리한다.
- Shooter `combat.rs`는 이 helper 결과를 받아 score, GameOver, gameplay event, default audio/VFX 같은 장르별 outcome만 처리한다.
- 기존 bullet/enemy와 player/enemy pair discovery는 그대로 유지한다. broadphase 호출 수와 pair discovery path는 바꾸지 않았다.
- 회귀 테스트는 common helper가 enemy damage+despawn, killed-but-not-despawn target, despawn duplicate prevention을 처리하는지와 기존 authored bullet/enemy 및 player/enemy behavior를 고정한다.

이 slice 이후에도 `apply_collision_reaction_set(...)` 전체, pickup/audio/particle side effect, score/GameOver outcome orchestration은 아직 Shooter runtime에 남아 있다. 다음 공통화는 outcome 타입을 더 일반화해 `apply_collision_reactions_for_pair(...)`가 `Damage`/`Despawn`뿐 아니라 `Pickup`과 side effect policy까지 같은 executor로 처리할 수 있는지 검증해야 한다.

### 2026-06-01: configureDamage atomic authoring setter slice

`configureDamage`의 TS partial apply 위험을 Rust authoring boundary에서 좁혔다. 기존 adapter는 damage component setter와 collision damage reaction setter를 순차 호출할 수 있어 두 번째 호출 실패 시 damage component만 남을 수 있었다.

- Rust `set_gameplay_damage_reaction(...)`을 추가했다. 이 setter는 amount, target code, generation handle, collision reaction capacity를 모두 검증한 뒤에만 damage component와 `CollisionReaction::Damage`를 함께 반영한다.
- TS `configureDamage` adapter는 `set_gameplay_damage(...)` + `add_gameplay_collision_damage(...)` fallback을 쓰지 않고 atomic setter 하나만 요구한다. runtime engine이 setter를 제공하지 않으면 command path에 machine-actionable diagnostic을 낸다.
- Wasm declaration과 public API 문서를 새 setter에 맞춰 동기화했다.
- 회귀 테스트는 atomic setter success/update, capacity failure no-mutation, TS missing setter diagnostic, TS setter failure 시 split setter 미호출을 고정한다.

이 slice는 전체 `BehaviorRecipeCommand[]` apply를 transaction API로 바꾸지 않는다. batch 단위 rollback/diff는 여전히 별도 후보이며, 이번 변경은 damage + collision reaction composite command 하나의 부분 적용 위험을 닫는 범위다.

### 2026-06-01: pickup reaction state mutation helper extraction slice

`CollisionReaction::Pickup`의 상태 변경도 Shooter runtime 전용 메서드에서 `crate::gameplay` helper로 이동했다.

- `apply_collision_pickup_reaction_for_pair(...)`는 `CollisionReactionPair`와 `CollisionTarget`으로 pickup/collector 방향을 해석한다.
- helper는 collector가 live Player layer인지, target이 live Pickup layer인지, 양쪽이 이미 marked despawn 상태가 아닌지, `Pickup` payload가 score item이고 `despawn_on_collect`인지 검증한다.
- 성공 시 기존 deferred despawn queue와 marked scratch를 사용해 pickup entity를 1회만 queue하고, pickup/collector/item/count/targetRemoved payload를 outcome으로 반환한다.
- Shooter `combat.rs`는 helper outcome을 받아 score 증가와 `pickupCollected` gameplay event emission만 처리한다. collision pair discovery, audio/particle side effect, authored reaction ordering, legacy pickup fallback은 그대로 유지한다.
- 회귀 테스트는 common helper의 score pickup success, non-pickup target rejection, 기존 player pickup collision, authored pickup reaction, pickup sound/particle additive behavior를 고정한다.

이 slice 이후 `Damage`/`Despawn`/`Pickup`의 core state mutation은 공통 helper로 빠졌다. 다만 `PlaySound`/`SpawnParticle` side effect, score/game-over/default audio/VFX outcome orchestration, tile-specific side effect policy는 여전히 Shooter runtime 책임이다.

### 2026-06-01: collision side-effect reaction commit helper slice

`PlaySound`/`SpawnParticle` reaction의 trigger, cooldown commit, target 해석을 `crate::gameplay` helper로 분리했다.

- `commit_collision_side_effect_reaction_for_pair(...)`는 entity/entity collision pair에서 `trigger: contact|enter`, cooldown, particle target `self|other`, `replaceDefault` flag를 한 번에 해석한다.
- helper는 실제 audio event push나 particle spawn을 하지 않고 `CollisionSideEffectEvaluation`을 반환한다. Shooter runtime은 이 outcome을 받아 audio/particle sink 호출과 default audio/VFX suppress flag 반영만 수행한다.
- `replaceDefault`는 기존 의미처럼 side effect가 cooldown/trigger 때문에 발화하지 않아도 generic authored collision outcome에 반영된다.
- `commit_tile_collision_side_effect_reaction(...)`은 tile impact 전용 self-only policy를 고정한다. tile에는 other entity가 없으므로 `SpawnParticle { target: other }`는 no-op이며 cooldown도 소비하지 않는다. tile impact의 `replaceDefault`는 기존처럼 no-op이다.
- pickup collision path는 side effect만 적용하고 `replaceDefault` flag는 버린다. 기존 pickup default collection 유지 의미와 맞춘 의도적 분리다.
- 회귀 테스트는 sound cooldown, enter particle target, tile self-only/no-replace policy, authored sound/particle cooldown/enter, pickup sound/particle additive behavior를 고정한다.

이 slice 이후 `Damage`/`Despawn`/`Pickup` state mutation과 `PlaySound`/`SpawnParticle` side-effect commit decision은 공통 helper로 빠졌다. 아직 `apply_collision_reaction_set(...)`의 orchestration, score/game-over/default outcome aggregation, sink 호출은 Shooter runtime에 남아 있다.

### 2026-06-01: topdown input movement apply helper slice

player `TopdownInput` movement 적용도 Shooter runtime의 직접 match에서 `crate::gameplay` helper로 이동했다.

- `apply_topdown_input_movement(...)`는 entity velocity slot, `InputState`, default speed를 받아 `MovementPattern::TopdownInput` speed가 있으면 그 값을 우선하고, 없으면 기존 Shooter player speed fallback을 유지한다.
- helper는 `topdown_input_velocity(...)`를 재사용하므로 diagonal normalization 의미와 기존 player movement behavior를 바꾸지 않는다.
- Shooter `player.rs`는 player velocity 산출을 helper 호출로 축소하고, dash/melee/projectile/spawnPrefab input action orchestration은 그대로 소유한다.
- 회귀 테스트는 default speed fallback, authored `TopdownInput` speed override, invalid entity index no-op을 고정한다.

이 slice는 full `movement_pattern_system` 도입이 아니다. 그러나 player topdown input과 enemy scene-neutral movement가 모두 `crate::gameplay` helper를 통해 velocity를 쓰게 되어, 다음 단계에서 input/movement phase를 공통 system으로 분리할 때 scene별 match를 줄이는 발판이 된다.

### 2026-06-01: entity collision reaction set executor helper slice

entity/entity authored collision reaction set 순회도 Shooter runtime에서 `crate::gameplay` data-only executor로 이동했다.

- `apply_collision_reaction_set_for_pair(...)`는 `CollisionReactionSet`을 순회하며 `Damage`/`Despawn`/`Pickup` state mutation helper와 `PlaySound`/`SpawnParticle` side-effect commit helper를 한 곳에서 호출한다.
- executor outcome은 fixed-size array 기반 `CollisionReactionSetOutcome`으로 반환한다. reaction set의 기존 최대 개수(`MAX_COLLISION_REACTIONS_PER_ENTITY`)를 사용하므로 hot path에 새 `Vec` allocation을 추가하지 않는다.
- Shooter `combat.rs`는 outcome을 받아 score 증가, GameOver 전환, gameplay event emission, audio/particle sink 호출, default audio/VFX suppress aggregation만 수행한다.
- `Damage` 기본 health/score/despawn-on-kill 정책은 Shooter가 closure로 제공한다. 따라서 executor는 장르별 GameOver/score 정책을 소유하지 않는다.
- 회귀 테스트는 damage+despawn outcome, side-effect-only additive behavior, reversed pair target orientation, Shooter combat authored reaction 전체를 고정한다.

이 slice 이후 entity/entity collision reaction의 "reaction set 순회 + core mutation/commit outcome 생성"은 공통 helper가 담당한다. collision pair discovery, tile impact policy, pickup-only fallback policy, score/game-over/default outcome aggregation, sink 호출은 여전히 Shooter runtime 책임이다.

### 2026-06-01: tile collision reaction set policy helper slice

tile impact authored reaction set 순회도 `crate::gameplay` helper로 이동했다.

- `apply_tile_collision_reaction_set(...)`는 tile impact에서 허용되는 `Despawn(SelfEntity)`와 `PlaySound`/`SpawnParticle(SelfEntity)`만 실행하고, `Damage`, `Pickup`, `Despawn(OtherEntity)`, `SpawnParticle(OtherEntity)`는 기존처럼 no-op으로 유지한다.
- outcome은 `TileCollisionReactionSetOutcome`으로 반환한다. self despawn outcome과 side-effect evaluation을 fixed-size array로 담아 hot path allocation을 추가하지 않는다.
- tile에는 other entity가 없으므로 `OtherEntity` target reaction은 cooldown도 소비하지 않는다. 이 정책은 unit test로 고정했다.
- Shooter `combat.rs`는 tile collision query, `passThrough`/`bounce`/legacy despawn 결정, gameplay event emission, audio/particle sink 호출만 유지한다.
- 회귀 테스트는 tile self-despawn+side-effect, entity-only target no-op/no-cooldown, 기존 authored bullet tile collision behavior를 고정한다.

이 slice 이후 tile impact reaction set의 정책 판단은 공통 helper가 담당한다. 다만 tile collision discovery, bounce reflection, pass-through skip, legacy despawn fallback은 projectile/tilemap 장르 정책이므로 Shooter runtime에 남긴다.

### 2026-06-01: pickup-only collision reaction set policy helper slice

pickup collision 전용 authored reaction set 순회도 `crate::gameplay` helper로 이동했다. 이 경로는 generic entity/entity collision executor와 다르게 `Damage`/`Despawn`을 의도적으로 무시하므로 별도 helper로 분리했다.

- `apply_pickup_collision_reaction_set_for_pair(...)`는 `Pickup` reaction과 `PlaySound`/`SpawnParticle` side effect만 처리한다.
- `Pickup` reaction이 하나라도 있으면 target이 잘못되어 실제 collection outcome이 없어도 `handled_pickup == true`를 반환한다. 이는 기존처럼 잘못된 authored pickup reaction이 legacy fallback collection으로 조용히 덮이지 않게 하기 위한 정책이다.
- side-effect-only pickup reaction은 `handled_pickup == false`이며 legacy fallback collection을 막지 않는다.
- `Damage`/`Despawn` reaction은 pickup-only path에서 no-op이다.
- Shooter `combat.rs`는 outcome을 받아 score 증가, `pickupCollected` event emission, audio/particle sink 호출만 수행한다. contact cache와 양방향 reaction writeback은 기존 path를 유지한다.
- 회귀 테스트는 valid pickup outcome, side-effect-only additive behavior, wrong-target pickup fallback suppression, authored pickup integration, player pickup fallback, pickup-collected FSM transition을 고정한다.

이 slice 이후 pickup-only collision reaction set의 정책 판단도 공통 helper가 담당한다. pickup pair discovery, legacy fallback 호출 위치, score/event/sink 적용은 Shooter runtime에 남긴다.

### 2026-06-01: movement navigation cache policy helper slice

`MovementPattern::Chase`의 tilemap waypoint/cache 정책 중 scene-neutral한 cache 판단을 `crate::gameplay` helper로 이동했다.

- `MovementNavigationSource`, `MovementNavigationTargetIdentity`, `MovementNavigationTargetCache`를 공통 gameplay 타입으로 분리했다.
- `tick_movement_navigation_targets(...)`는 기존처럼 `delta.max(0.0)`로 cache TTL을 감소시키고, zero/negative delta는 no-op으로 유지한다.
- `resolve_movement_navigation_target(...)`는 source slot, generation, target identity, remaining time, reached-distance threshold를 기준으로 cache 재사용 여부를 결정한다.
- tilemap waypoint 계산은 helper가 소유하지 않는다. Shooter runtime이 closure로 `tilemap.navigation_waypoint_with_scratch(...)`를 제공하고, helper는 `None`일 때 direct target fallback만 고정한다.
- `MovementNavigationTargetIdentity::Entity(Entity)`는 entity generation을 포함한 handle을 key로 사용해 player cache와 entity cache, stale generation cache가 섞이지 않게 한다.
- Shooter `update_enemy_velocity(...)` loop, `navigation_scratch` storage, velocity phase, scene-level fallback은 그대로 유지한다.
- 회귀 테스트는 cache reuse/expiry, target identity/generation/reached-target invalidation, 기존 player/entity chase waypoint/cache integration, stale target zero velocity, enemy TopdownInput fallback을 고정한다.

이 slice는 full `movement_pattern_system` 도입이 아니다. 다만 `Chase`의 tilemap cache policy가 Shooter 전용 코드에서 빠져, Shooter runtime에 남은 movement 책임은 enemy loop/phase 소유권, tilemap scratch 호출, scene-level fallback 조정으로 더 좁아졌다.

### 2026-06-01: authored collision contact tracker helper slice

authored collision reaction의 `enter` trigger 판정을 위한 contact tracking 정책을 Shooter private key/method에서 `crate::gameplay` helper로 이동했다.

- `CollisionContactKey`는 두 entity handle을 generation 포함 canonical order로 정렬해 같은 pair를 양방향 reaction writeback에서 같은 contact로 본다.
- `register_collision_contact(...)`는 current frame 중복 contact를 무시하고, previous frame에 없던 contact만 `entered == true`로 반환한다.
- capacity 초과 시 contact를 기록하지 않고 `false`를 반환해 기존 `MAX_AUTHORED_COLLISION_CONTACTS` 한도와 silent degrade 의미를 유지한다.
- `finish_collision_contacts(...)`는 current/previous contact buffer를 swap하고 current를 비워, allocation 없이 다음 frame enter/stay 판정을 준비한다.
- Shooter runtime은 여전히 collision pair discovery와 reaction outcome aggregation을 소유하지만, enter/stay bookkeeping은 공통 helper를 통해 처리한다.
- 회귀 테스트는 same-frame duplicate, reversed pair canonicalization, next-frame stay 판정, capacity overflow no-recording을 고정한다.

이 slice는 broadphase, pair discovery, collision event ABI, reaction executor 의미를 바꾸지 않는다. 다음 collision 공통화 후보는 pair discovery 결과를 scene-neutral event 후보로 포장할지, 아니면 score/game-over/default audio/VFX aggregation을 먼저 분리할지 결정하는 것이다.

### 2026-06-01: authored entity pair reaction handoff helper slice

이미 discovery된 entity/entity collision pair에 대해 양쪽 entity의 authored reaction set을 읽고, forward/reversed 방향으로 적용하고, cooldown mutation을 `World.collision_reactions`에 writeback하는 책임을 `crate::gameplay` helper로 이동했다.

- `apply_collision_reaction_sets_for_pair(...)`는 `CollisionReactionPair`, `contact_entered`, marked despawn scratch, pending despawn queue, damage default closure를 받아 source와 other의 reaction set을 순서대로 적용한다.
- outcome은 `CollisionReactionSetsForPairOutcome`의 fixed two-slot buffer로 반환한다. 각 item은 적용 방향의 `CollisionReactionPair`와 `CollisionReactionSetOutcome`을 함께 담아 Shooter가 기존 score/game-over/event/audio/particle 집계를 그대로 수행할 수 있게 한다.
- helper는 reaction set이 없는 pair에는 `None`을 반환해 legacy fallback이 유지되도록 한다.
- broadphase, swept pair ordering, bullet/tile 선행 처리, score/game-over/default sink orchestration은 Shooter runtime에 남긴다.
- 회귀 테스트는 양방향 reaction 적용, reversed target orientation, side-effect cooldown writeback을 고정한다.

이 slice 이후 collision 쪽 code-only 결합은 pair discovery 자체와 장르별 outcome aggregation에 더 좁혀졌다. 다음 단계는 pair discovery를 공통 event 후보로 감쌀지, 또는 Shooter aggregation을 작은 policy closure로 나눌지 결정해야 한다.

### 2026-06-01: authored collision outcome summary helper slice

Shooter runtime에 남아 있던 authored collision reaction outcome 집계 중 data-only summary 계산을 `crate::gameplay` helper로 이동했다.

- `CollisionReactionOutcomeSummary`는 total damage, default override, enemy damaged/removed, player game-over, pickup collected, replace default audio/particle flag를 담는다.
- `summarize_collision_reaction_set_outcome(...)`은 `CollisionReactionSetOutcome`과 target role resolver를 받아 summary만 계산한다.
- Shooter runtime은 summary를 merge한 뒤 기존처럼 score, GameOver state, gameplay event emission, audio/particle sink 호출을 수행한다.
- target role resolver는 Shooter가 제공한다. 따라서 공통 helper는 player/enemy layer 정책을 직접 소유하지 않는다.
- 회귀 테스트는 Damage/Despawn/PlaySound outcome이 summary flag와 total damage로 접히는지 고정한다.

이 slice는 score/game-over/default sink orchestration 전체 이전이 아니다. 다만 장르별 side effect 실행과 순수 outcome classification 사이의 경계를 분리해, 다음 aggregation policy 분리의 입력 타입을 명확히 했다.

### 2026-06-01: default collision damage hit helper slice

authored reaction이 default gameplay를 override하지 않는 collision path 중 기본 damage/despawn 상태 변경을 `crate::gameplay` helper로 분리하기 시작했다.

- `apply_default_collision_damage_hit(...)`은 source/target entity, damage, target 기본 health/reward, source despawn 여부, kill 시 target despawn 여부를 받아 deferred despawn queue와 health mutation을 처리한다.
- outcome은 source/target entity, applied damage, kill 여부, source/target removed 여부, score reward를 반환한다.
- Shooter bullet->enemy 기본 hit branch는 이 helper를 사용하고, 기존처럼 hit event, hit particle, enemy hit tween, score 증가, hit sound orchestration은 Shooter runtime이 수행한다.
- helper는 marked despawn scratch와 pending despawn queue를 재사용해 같은 frame 중복 queue를 막는다.
- 회귀 테스트는 source와 killed target이 기존 순서대로 pending despawn에 들어가고, 이미 marked된 entity가 중복 queue되지 않는지 고정한다.

이 slice는 projectile target policy, player game-over policy, default audio/VFX policy를 공통화하지 않는다. 목표는 authored reaction executor와 legacy/default gameplay fallback 사이의 상태 변경 경계를 점진적으로 줄이는 것이다.

### 2026-06-01: default collision game-over hit helper slice

player game-over로 이어지는 default collision path의 data/state mutation 일부도 `crate::gameplay` helper로 분리했다.

- `apply_default_collision_game_over_hit(...)`은 source/target entity와 damage, source despawn 여부를 받아 source deferred despawn queue와 hit outcome을 만든다.
- helper는 target health나 GameState를 직접 바꾸지 않는다. player game-over 여부와 sound/event orchestration은 Shooter runtime 책임으로 유지한다.
- bullet->player 기본 hit path는 bullet despawn과 hit damage outcome 생성을 helper로 처리한다.
- player->enemy 기본 collision path는 no-damage game-over hit outcome 생성을 helper로 처리한다.
- 회귀 테스트는 source despawn 중복 queue 방지와 target health 비변경을 고정한다.

이 slice 이후 default gameplay fallback 중 상태 변경 helper가 damage hit와 game-over hit로 나뉘었다. 아직 projectile target policy, collision pair discovery, GameState/audio/event sink 실행은 Shooter runtime에 남아 있다.

### 2026-06-01: default projectile damage gate helper slice

projectile default damage path의 target/faction gate도 `crate::gameplay` helper로 이동했다.

- `projectile_collision_target_at(...)`은 projectile target metadata가 없으면 기존처럼 `Enemies`를 기본값으로 반환한다.
- `default_projectile_damage_allowed(...)`는 expected projectile target과 faction damage mask를 함께 검사한다.
- Shooter bullet->enemy path는 target mismatch를 authored reaction 적용 전에 거르고, faction damage gate는 기존 의미처럼 authored reaction 적용 후 default fallback damage에만 적용한다.
- Shooter bullet->player path는 authored override가 없는 default path이므로 target/faction gate를 한 번에 helper로 검사한다.
- 회귀 테스트는 default target fallback, explicit player target, faction-denied default damage gate를 고정한다.

이 slice는 authored reaction override semantics를 바꾸지 않는다. projectile target mismatch는 pair 자체를 skip하지만, faction-denied default damage는 authored override reaction을 막지 않는다.

### 2026-06-01: collision layer pair query helper slice

Shooter runtime이 직접 호출하던 layer/swept-layer collision pair discovery도 얇은 `crate::gameplay` helper를 통과하도록 정리했다.

- `build_collision_layer_pairs(...)`는 기존 `CollisionSystem::build_layer_pairs_into(...)`를 그대로 호출하며 scratch와 pair buffer를 재사용한다.
- `build_swept_collision_layer_pairs(...)`는 기존 `CollisionSystem::build_swept_layer_pairs_into(...)`를 그대로 호출한다.
- Shooter bullet->enemy, bullet->player, player->enemy, player->pickup pair discovery는 새 helper를 사용한다.
- helper는 pair ordering, broadphase algorithm, swept overlap semantics, buffer clearing policy를 바꾸지 않는다.
- 회귀 테스트는 layer pair와 swept-layer pair가 요청한 layer 순서와 기존 entity pair를 유지하는지 고정한다.

이 slice는 full collision event pipeline이 아니다. 다만 pair discovery 호출 지점이 `combat.rs`에서 `crate::gameplay` helper 경계로 이동해, 다음 단계에서 pair 후보를 scene-neutral event candidate로 감쌀 수 있는 발판을 만든다.

### 2026-06-01: authored collision score/GameOver summary slice

authored collision reaction outcome 처리 중 점수 증가와 player GameOver 판정도 `crate::gameplay` summary helper가 계산하도록 좁혔다.

- `CollisionReactionOutcomeSummary`에 `score_delta`를 추가했다. authored damage로 player가 아닌 target이 죽거나 pickup outcome이 발생하면 helper가 score 증가량을 saturating 합산한다.
- `summarize_collision_reaction_set_outcome(...)`은 기존 total damage, default override, enemy/player role flag에 더해 score delta까지 계산한다.
- Shooter `combat.rs`는 summary 결과를 받아 `self.score`와 `GameState::GameOver`만 반영하고, gameplay event emission과 audio/particle sink 호출은 그대로 runtime에 남긴다.
- target role resolver는 계속 Shooter가 제공한다. 따라서 공통 helper는 player/enemy layer 정책이나 장르별 score reward source를 직접 소유하지 않는다.
- 회귀 테스트는 killed enemy reward가 summary score delta로 접히는지 고정한다.

이 slice는 sink orchestration 전체 이전이 아니다. 다만 authored reaction 결과에서 "점수/GameOver로 집계되는 값"을 data-only helper로 분리해, 남은 Shooter 책임을 default audio/VFX emission과 event/sink 호출로 더 좁힌다.

### 2026-06-01: collision pair candidate normalization slice

subagent engine review에서 제안한 다음 좁은 경계로, 이미 발견된 `CollisionPair`를 runtime에서 바로 쓰기 전에 `crate::gameplay` helper가 scene-neutral `CollisionReactionPair` 후보로 검증하도록 했다.

- `collision_reaction_pair_for_layer_pair(...)`는 기존 pair buffer의 item 하나를 받아 source/other entity가 아직 live인지, generation이 stale하지 않은지, 요청한 layer 순서와 맞는지, deferred despawn으로 이미 marked 되었는지 확인한다.
- helper는 새 candidate `Vec`를 만들지 않고 `Option<CollisionReactionPair>`만 반환한다. 따라서 기존 `self.collision_pairs` reuse와 hot-path allocation profile을 유지한다.
- Shooter bullet->enemy, bullet->player, player->enemy, player->pickup loop는 반복하던 live/layer/marked 검사를 helper로 접고, bounce/projectile target/player identity 같은 장르별 정책만 각 loop에 남긴다.
- 이 helper는 collision event ABI, public TS API, broadphase, swept pair ordering을 바꾸지 않는다.
- 회귀 테스트는 valid pair, marked source, wrong layer, stale/despawned entity pair가 각각 올바르게 통과/거부되는지 고정한다.

이 slice는 full collision event candidate pipeline이 아니다. 다만 pair discovery 뒤의 공통 검증 경계를 만들었기 때문에, 이후 event 후보 구조나 default presentation policy를 분리할 때 반복 검증 로직을 다시 복제하지 않아도 된다.

### 2026-06-01: default collision presentation policy helper slice

authored collision outcome이 기존 Shooter 기본 audio/VFX를 suppress할지 결정하는 data-only 정책도 `crate::gameplay` helper로 이동했다.

- `DefaultCollisionPresentationPolicy`는 default audio와 default particle을 emit할지 두 boolean으로 표현한다.
- `default_collision_presentation_policy(...)`는 authored outcome이 없으면 둘 다 emit하고, authored `replaceDefault` flag가 있으면 해당 default audio/particle만 suppress한다.
- Shooter bullet->enemy collision path는 built-in hit audio와 hit particle emission 여부를 이 helper 결과로 결정한다.
- Shooter player->enemy authored GameOver path는 game-over audio emission 여부만 helper 결과로 판단한다.
- helper는 실제 `AudioEvent` push, particle spawn, tween, gameplay event sink 호출을 하지 않는다. 따라서 Wasm/TS ABI와 render/audio frame buffer는 바뀌지 않는다.
- 회귀 테스트는 authored outcome 없음, replace-default-audio, replace-default-particle 조합을 고정한다.

이 slice 이후 collision default presentation의 suppress 판정은 공통 helper가 담당하지만, 실제 sink 호출과 장르별 default effect 종류 선택은 여전히 Shooter runtime 책임이다.

### 2026-06-01: movement pattern navigation apply helper slice

`MovementPattern::Chase`가 scene-neutral evaluation 뒤 Shooter runtime에서 다시 navigation target과 velocity write를 처리하던 경계를 `crate::gameplay` helper로 한 단계 더 좁혔다.

- `MovementNavigationPolicy`는 repath interval과 reached-distance threshold를 data로 묶는다.
- `apply_movement_pattern_with_navigation(...)`는 기존 `apply_scene_neutral_movement_pattern(...)`을 먼저 호출하고, `DeferredChase`인 경우 navigation cache와 waypoint resolver closure를 사용해 target waypoint를 결정한 뒤 velocity를 쓴다.
- tilemap waypoint 계산은 여전히 Shooter가 closure로 제공한다. 따라서 helper는 tilemap, A*, scene config, renderer/platform state를 직접 소유하지 않는다.
- Shooter `update_enemy_velocity(...)`는 entity별 `MovementPattern` override 처리에서 helper 결과만 보고 `Applied`면 fallback을 건너뛴다. `TopdownInput` 같은 unsupported pattern은 기존처럼 scene-level enemy behavior fallback으로 흐른다.
- helper는 별도 entity scan, allocation, JS/Wasm callback을 추가하지 않고 기존 navigation cache `Vec<Option<_>>`와 Shooter `navigation_scratch`를 재사용한다.
- 회귀 테스트는 Chase waypoint velocity write와 cache update, 기존 player/entity chase waypoint, unsupported TopdownInput fallback을 고정한다.

이 slice는 full `movement_pattern_system` 도입이 아니다. 다만 scene-neutral movement evaluation과 navigation-backed Chase application이 같은 helper 경계로 묶여, Shooter runtime에 남은 movement 책임은 enemy loop ownership, tilemap scratch 제공, scene-level fallback 선택으로 줄었다.

### 2026-06-01: authored collision gameplay event payload helper slice

authored collision reaction outcome에서 gameplay event sink로 보낼 damage/despawn/pickup payload 생성도 `crate::gameplay` helper로 이동했다.

- `CollisionGameplayEventPayload`는 `Damage`, `Despawn`, `PickupCollected` payload를 scene-neutral data로 표현한다.
- `CollisionGameplayEventPayloadSet`은 `MAX_COLLISION_REACTIONS_PER_ENTITY * 3` fixed-size slot을 사용한다. 따라서 authored reaction hot path에 새 `Vec` allocation을 추가하지 않는다.
- `collision_gameplay_events_for_reaction_outcome(...)`은 `CollisionReactionSetOutcome`과 적용 방향의 `CollisionReactionPair`를 받아 source/target 방향을 보존한 payload set을 만든다.
- Shooter `combat.rs`는 payload를 받아 기존 `GameplayEventSink` 메서드로 push한다. 특히 `push_collision_despawn(...)`의 중복 제거 정책은 그대로 runtime sink에 남긴다.
- helper는 `AudioEvent`, particle/tween sink, collision hit event, Wasm/TS ABI를 바꾸지 않는다.
- 회귀 테스트는 damage, pickup, despawn payload 순서와 source/target 방향이 보존되는지 고정한다.

이 slice 이후 authored reaction outcome에서 gameplay event payload를 구성하는 책임은 공통 helper가 담당한다. 실제 event sink push/dedupe와 collision hit event/audio/VFX sink 호출은 여전히 Shooter runtime 책임이다.

### 2026-06-01: authored collision side-effect payload helper slice

authored collision side-effect evaluation을 실제 audio/particle sink가 소비할 payload로 해석하는 책임도 `crate::gameplay` helper로 이동했다.

- `CollisionSideEffectPayload`는 `PlaySound`와 `SpawnParticleAt` payload를 scene-neutral data로 표현한다.
- `collision_side_effect_payload(...)`은 `CollisionSideEffectEvaluation`과 `World`를 받아 sound payload를 그대로 전달하거나, particle target entity의 `Transform2D`를 찾아 위치 기반 payload로 변환한다.
- target transform이 없거나 evaluation effect가 없으면 `None`을 반환한다. 따라서 runtime sink는 빠진 transform을 다시 해석하지 않는다.
- Shooter `combat.rs`는 payload를 받아 기존 `push_audio_event(...)` 또는 `ParticleBurstSink::spawn_preset_at(...)`만 호출한다.
- helper는 `AudioEvent` channel 선택, particle preset lookup, tween, collision hit event, Wasm/TS ABI를 바꾸지 않는다.
- 회귀 테스트는 sound payload mapping, particle target transform resolution, missing transform skip을 고정한다.

이 slice 이후 authored side-effect에서 "어떤 sink payload를 만들 것인가"는 공통 helper가 담당한다. 실제 sink push, default sound id skip, particle preset id lookup, 장르별 default hit/audio/VFX 선택은 여전히 Shooter runtime 책임이다.

### 2026-06-01: pickup collision reaction set handoff helper slice

player/pickup 충돌의 authored reaction set 양방향 handoff도 `crate::gameplay` helper로 이동했다.

- `has_collision_reaction_sets_for_pair(...)`는 pair 양쪽에 reaction set이 있는지 scene-neutral하게 확인한다. Shooter는 이 결과가 있을 때만 contact tracker를 등록해 기존 enter-trigger 의미를 유지한다.
- `apply_pickup_collision_reaction_sets_for_pair(...)`는 source/other reaction set을 읽고, forward/reversed `apply_pickup_collision_reaction_set_for_pair(...)`를 적용한 뒤 cooldown-mutated reaction set을 `World`에 다시 기록한다.
- `PickupCollisionReactionSetsForPairOutcome`은 fixed two-slot outcome과 aggregate `handled_pickup`을 제공한다. 새 candidate `Vec` allocation을 추가하지 않는다.
- Shooter `combat.rs`는 helper 결과를 순회하며 기존 score, gameplay event, audio/particle sink를 적용한다.
- helper는 legacy fallback suppress semantics를 유지한다. 즉 authored `Pickup` reaction이 wrong target이라 실제 pickup outcome을 만들지 않아도 `handled_pickup`은 true가 될 수 있다.
- contact tracking, score mutation, `GameplayEventSink`, `AudioEvent`, particle preset lookup, Wasm/TS ABI는 바꾸지 않는다.
- 회귀 테스트는 양방향 handoff, cooldown write-back, reversed orientation, wrong-target fallback suppression을 고정한다.

이 slice 이후 pickup authored collision에서 reaction set read/apply/write-back 책임은 공통 helper가 담당한다. Shooter runtime에는 contact tracker 소유권, fallback 선택, score/event/audio/particle sink 적용만 남는다.

### 2026-06-01: default collision hit presentation payload helper slice

bullet/enemy 기본 hit presentation에서 collision event damage, default audio 여부, default particle 위치를 구성하는 책임도 `crate::gameplay` helper로 이동했다.

- `CollisionHitPresentationPayload`는 hit event source/target/damage, default audio emission 여부, optional particle position을 data로 표현한다.
- `collision_hit_presentation_payload(...)`은 `CollisionReactionPair`, damage, optional authored outcome summary를 받아 `default_collision_presentation_policy(...)`를 적용한다.
- particle 위치는 target transform을 우선 사용하고, 없으면 source transform으로 fallback한다. authored `replaceDefault`가 particle을 suppress하면 위치를 만들지 않는다.
- Shooter `combat.rs`는 payload를 받아 기존 `CollisionEventSink::push_hit(...)`, `ParticleBurstSink::spawn_at(...)`, `push_audio_event(...)`를 호출한다.
- helper는 sound id/volume/pitch, particle preset 선택, tween flash, score mutation, default damage mutation, Wasm/TS ABI를 바꾸지 않는다.
- 회귀 테스트는 target transform 우선순위, source transform fallback, replace-default suppress semantics를 고정한다.

이 slice 이후 bullet/enemy default presentation에서 "무엇을 emit할 수 있는가"는 공통 helper가 담당한다. 실제 sink push와 장르별 default sound/preset/tween 선택은 여전히 Shooter runtime 책임이다.

### 2026-06-01: authored collision contact tracker state slice

authored collision enter/contact 판정을 위해 Shooter runtime이 직접 들고 있던 previous/current contact `Vec` 두 개를 `crate::gameplay`의 state object로 묶었다.

- `CollisionContactTracker`는 previous/current contact set과 capacity를 함께 소유한다.
- `register(...)`는 기존 `register_collision_contact(...)` 의미를 유지한다. 동일 pair는 current frame에서 한 번만 기록되고, previous frame에 있던 pair는 enter가 아니라 stay로 취급된다.
- `finish(...)`는 frame 끝에서 previous/current를 swap하고 current를 clear한다.
- `clear_current(...)`는 frame 시작 scratch 준비에서 current만 비우고, previous contact는 유지한다.
- `clear(...)`는 scene reset/snapshot restore에서 previous/current를 모두 비운다.
- Shooter `combat.rs`는 `register_authored_collision_contact(...)`와 `finish_authored_collision_contacts(...)` wrapper만 유지하고, contact storage 세부 구조를 직접 다루지 않는다.
- 새 `Vec` allocation은 추가하지 않는다. tracker는 기존 capacity와 같은 `MAX_AUTHORED_COLLISION_CONTACTS`로 초기화된다.
- 회귀 테스트는 enter/stay 의미, capacity bound, reset clear를 고정한다.

이 slice 이후 authored collision contact storage ownership은 `crate::gameplay`로 이동했다. Shooter runtime에는 frame phase에서 언제 current를 clear하고 언제 finish할지에 대한 loop ownership만 남는다.

### 2026-06-01: action prepare/commit helper slice

authored action 실행 전에 action binding의 존재, pattern kind, cooldown 상태를 판정하고 cooldown을 commit하는 scene-neutral 경계도 `crate::gameplay`로 이동했다.

- `ActionPatternKind`는 `Projectile`/`Dash`/`Melee`/`SpawnPrefab` taxonomy를 표현한다. `from_pattern(...)`은 `ActionPattern` 전체 match를 사용해 새 variant가 추가되면 공통 action taxonomy 갱신을 컴파일 단계에서 요구한다.
- `ActionReadiness`는 최초 slice에서는 `Missing`/`PatternMismatch`/`CoolingDown`/`Ready(ActionBinding)`만 표현했다. 이후 prepared action commit token slice에서 `Ready(PreparedAction)`으로 승격되어 prepare 시점의 entity/action id/kind/binding identity를 함께 보존한다. input 비활성 상태는 gameplay readiness가 아니라 Shooter input policy이므로 `InputActionTrigger::Inactive` wrapper에 남겼다.
- `prepare_action_if_ready(...)`와 `commit_prepared_action(...)`는 `World`의 action binding/cooldown만 읽고 쓴다. projectile spawn, dash transform write, melee queue, prefab placement, 실패 gameplay event push는 Shooter runtime 책임으로 유지한다.
- `commit_prepared_action(...)`은 최초 slice에서는 expected pattern kind를 다시 받아 검증한 뒤 cooldown을 commit했다. 이후에는 `PreparedAction` token을 받아 준비 시점의 pattern과 현재 pattern이 같은지 재검증한 뒤 cooldown을 commit한다. 따라서 잘못된 kind token이나 prepare 이후 바뀐 binding은 cooldown을 소비하지 않는다.
- `prepare_input_action_if_ready(...)`와 `commit_prepared_input_action(...)`는 Shooter runtime wrapper로 유지한다. input edge detection, repeated press no-op, input failure telemetry는 scene/input policy이기 때문이다.
- 새 helper는 allocation, JS/Wasm callback, public TS API, Wasm ABI를 추가하지 않는다.
- 회귀 테스트는 readiness 상태, wrong-kind commit no-consume, current action pattern kind mapping, Shooter input inactive/repeated pressed policy를 고정한다.

이 slice 이후 action readiness/cooldown commit은 공통 gameplay helper가 담당한다. 실제 action 실행과 trigger queue phase processing loop, sink/event emission은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: queued action trigger readiness helper slice

queued timer/wave/behavior-state action trigger가 실제 실행 가능한 action binding인지 판정하는 binding/cooldown readiness도 `crate::gameplay` helper를 사용하도록 좁혔다.

- `prepare_any_action_if_ready(...)`는 expected pattern kind 없이 `World`의 action binding 존재 여부와 cooldown 상태만 판정한다.
- 이 helper는 generic queued trigger path를 위한 것이다. 따라서 `prepare_action_if_ready(...)`의 expected-kind ordering은 그대로 유지한다. 특정 action kind를 기대하는 player/input path에서는 pattern mismatch가 cooldown보다 먼저 보고된다.
- Shooter `process_action_trigger(...)`는 missing/cooling-down 판정은 helper 결과로 받지만, 실패 gameplay event push와 reason code 선택은 계속 runtime sink policy로 처리한다.
- pattern match 뒤의 projectile/dash/melee/spawn prefab 실행, prefab placement, queue capacity failure 처리, trigger phase processing loop는 `actions.rs`에 남겼다.
- 새 helper는 allocation, JS/Wasm callback, public TS API, Wasm ABI를 추가하지 않는다.
- 회귀 테스트는 any-action readiness가 pattern kind 없이 missing/ready/cooling-down을 보고하고, Shooter action trigger suite가 기존 failure/commit 의미를 유지하는지 고정한다.

이 slice 이후 queued trigger dispatch의 첫 readiness gate는 공통 gameplay helper가 담당한다. 다만 action execution system 자체는 아직 분리하지 않았고, trigger queue와 sink orchestration은 Shooter runtime 소유다.

### 2026-06-01: action trigger queue state slice

queued action trigger의 pending/processing `Vec` storage와 frame-local swap 정책도 generic `crate::gameplay` state object로 묶었다.

- `ActionTriggerQueue<T>`는 pending queue, processing queue, max pending capacity를 함께 소유한다. `processing_at(...)`이 값을 복사해 반환하므로 `T: Copy`인 value command queue이며, 임의 payload를 보관하는 일반 command buffer는 아니다.
- `queue(...)`는 기존 `MAX_PENDING_ACTION_TRIGGERS` 의미처럼 pending capacity를 넘으면 `false`를 반환한다.
- `begin_processing(...)`은 pending이 비어 있으면 false를 반환하고, pending/processing buffer를 swap해 현재 frame 처리 대상과 다음 frame에 새로 queue되는 command를 분리한다.
- `processing_at(...)`은 `Copy` command를 값으로 반환하므로 processing queue를 오래 빌리지 않는다. 따라서 Shooter runtime은 command 하나를 복사한 뒤 기존처럼 `&mut self` action execution을 호출할 수 있다.
- `finish_processing(...)`은 processing buffer만 clear한다. 처리 중 새로 queue된 command는 pending에 남아 다음 frame으로 넘어간다.
- 이 slice 시점에는 Shooter `ActionTriggerCommand`, `ActionTriggerKind`, `ActionTriggerPhase`, failure event push, trigger phase ownership이 runtime에 남아 있었다. 이후 action trigger command vocabulary slice에서 command type과 phase vocabulary는 `crate::gameplay`로 이동했고, producer policy와 phase processing loop는 Shooter runtime에 남겼다.
- reset/snapshot restore는 queue object의 `clear(...)`를 호출한다.
- 새 helper는 기존 두 `Vec` capacity reuse 구조를 보존하며, JS/Wasm callback, public TS API, Wasm ABI를 추가하지 않는다.
- 회귀 테스트는 bounded queue, processing order, processing 중 enqueue된 command의 next-frame 보존, storage capacity 유지, reset/snapshot restore clear를 고정한다.

이 slice 이후 action trigger queue storage ownership은 `crate::gameplay`로 이동했다. 현재 command vocabulary도 `crate::gameplay`가 소유하며, Shooter runtime에는 command producer, phase dispatch/processing loop, action execution, failure telemetry가 남아 있다.

### 2026-06-01: attempted action readiness failure reason helper slice

queued trigger처럼 "실행을 시도한 action"의 readiness 실패를 `actionFailed` telemetry reason code로 바꾸는 공통 매핑도 `crate::gameplay` helper로 분리했다.

- `attempted_action_readiness_failure_reason(...)`은 `Missing`, `PatternMismatch`, `CoolingDown`만 기존 `GAMEPLAY_ACTION_FAILURE_*` reason code로 매핑한다.
- `Ready(_)`는 실패가 아니므로 `None`을 반환한다.
- 이 helper는 action binding/cooldown/pattern taxonomy에 붙은 generic attempted-action failure vocabulary만 담당한다.
- player input path처럼 `Missing`/`CoolingDown`을 정상 no-op으로 취급하는 producer는 이 helper를 호출하지 않는다.
- missing source transform, unsupported aim source, unsupported collision target, spawn queue full, blocked placement 같은 action-specific validation failure는 Shooter runtime에 남겼다.
- queued trigger path는 `prepare_any_action_if_ready(...)` 결과를 이 helper로 변환해 missing/cooling-down telemetry를 push한다.
- spawnPrefab expected-kind guard도 helper를 사용해 pattern mismatch reason을 얻는다. 실제 event sink push와 source/actor 선택은 runtime sink policy에 남아 있다.
- 새 helper는 allocation, JS/Wasm callback, public TS API, Wasm ABI를 추가하지 않는다.
- 회귀 테스트는 readiness failure reason mapping, queued trigger missing/cooling-down reason code, Shooter action trigger suite를 고정한다.

이 slice 이후 attempted action의 generic readiness failure vocabulary는 `crate::gameplay`가 담당한다. 그러나 어떤 producer가 failure telemetry를 emit할지, telemetry emission timing, action-specific reason code 선택, sink dedupe/flush 정책은 아직 Shooter runtime 책임이다.

### 2026-06-01: spawnPrefab action payload helper slice

`ActionBinding`에서 `SpawnPrefab` 실행에 필요한 payload를 꺼내는 pattern-specific data helper도 `crate::gameplay`로 이동했다.

- `SpawnPrefabActionPayload`는 `prefab_id`, `anchor`, `phase`, `offset_x`, `offset_y`만 담는 copy data다.
- `prepare_spawn_prefab_action_payload(...)`는 `World`의 action binding을 읽고, `SpawnPrefab` pattern kind와 cooldown readiness를 확인한 뒤 payload를 반환한다.
- readiness 실패는 `ActionReadiness`로 반환한다. queued trigger runtime은 기존 `attempted_action_readiness_failure_reason(...)`을 통해 generic failure telemetry reason으로 변환한다.
- Shooter `process_spawn_prefab_trigger(...)`는 더 이상 `ActionBinding`을 직접 destructure하지 않고 payload helper 결과를 사용한다.
- prefab id resolve, anchor/phase support, source transform, spawn queue capacity, tilemap placement, cooldown commit, `prefabSpawned`/`actionFailed` sink push는 여전히 Shooter runtime 책임이다.
- helper는 allocation, JS/Wasm callback, public TS API, Wasm ABI를 추가하지 않는다.
- 회귀 테스트는 missing, pattern mismatch, ready payload, cooling-down 상태와 기존 spawnPrefab action runtime suite를 고정한다.

이 slice 이후 spawnPrefab action의 "binding에서 어떤 data를 읽는가"는 공통 gameplay helper가 담당한다. 하지만 "그 data로 어떤 scene command를 만들고 언제 commit/emission할 것인가"는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: dash action payload helper slice

`ActionBinding`에서 `Dash` 실행에 필요한 payload를 꺼내는 pattern-specific data helper도 `crate::gameplay`로 이동했다.

- `DashActionPayload`는 `distance`, `aim`만 담는 copy data다.
- `prepare_dash_action_payload(...)`는 `World`의 action binding을 읽고, `Dash` pattern kind와 cooldown readiness를 확인한 뒤 payload를 반환한다.
- readiness 실패는 `ActionReadiness`로 반환한다. queued trigger runtime은 기존 `attempted_action_readiness_failure_reason(...)`을 통해 generic failure telemetry reason으로 변환한다.
- Shooter `process_dash_trigger(...)`는 더 이상 dispatch 단계에서 꺼낸 `distance`/`aim` 값을 직접 전달받지 않고 payload helper 결과를 사용한다.
- 이 slice 시점에는 target-player aim resolve, source/player transform lookup, zero-length direction guard, transform write, cooldown commit, `actionFailed` sink push가 Shooter runtime 책임으로 남아 있었다. 이후 dash action transform plan helper slice에서 target-player aim support와 zero-length guard는 `crate::gameplay`로 이동했다.
- helper는 allocation, JS/Wasm callback, public TS API, Wasm ABI를 추가하지 않는다.
- 회귀 테스트는 missing, pattern mismatch, ready payload, successful prepare no-cooldown-commit, cooling-down 상태와 기존 dash action runtime suite를 고정한다.

이 slice 이후 dash action의 "binding에서 어떤 data를 읽는가"는 공통 gameplay helper가 담당한다. 하지만 "그 data로 scene transform을 어떻게 바꾸고 어떤 실패를 telemetry로 낼 것인가"는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: projectile action payload helper slice

`ActionBinding`에서 `Projectile` 실행에 필요한 payload를 꺼내는 pattern-specific data helper도 `crate::gameplay`로 이동했다.

- `ProjectileActionPayload`는 `speed`, `damage`, `lifetime_seconds`, `aim`, `collision_target`, `tile_impact`만 담는 copy data다.
- `prepare_projectile_action_payload(...)`는 `World`의 action binding을 읽고, `Projectile` pattern kind와 cooldown readiness를 확인한 뒤 payload를 반환한다.
- readiness 실패는 `ActionReadiness`로 반환한다. queued trigger runtime은 기존 `attempted_action_readiness_failure_reason(...)`을 통해 generic failure telemetry reason으로 변환한다.
- Shooter `process_projectile_trigger(...)`는 더 이상 dispatch 단계에서 꺼낸 `speed`/`damage`/`lifetime_seconds`/`aim`/`collision_target`/`tile_impact` 값을 직접 전달받지 않고 payload helper 결과를 사용한다.
- 이 slice 시점에는 target-player aim support, player collision target support, source/player transform lookup, zero-length direction guard, projectile spawn command construction, spawn queue capacity, cooldown commit, `actionFailed` sink push가 Shooter runtime 책임으로 남아 있었다. 이후 projectile action direction plan helper slice에서 target-player aim support, player collision target support, zero-length guard, normalized direction/velocity plan은 `crate::gameplay`로 이동했다.
- helper는 allocation, JS/Wasm callback, public TS API, Wasm ABI를 추가하지 않는다.
- 회귀 테스트는 missing, pattern mismatch, ready payload, successful prepare no-cooldown-commit, cooling-down 상태와 projectile runtime failure의 no-cooldown-consume 의미를 고정한다.

이 slice 이후 projectile action의 "binding에서 어떤 data를 읽는가"는 공통 gameplay helper가 담당한다. 하지만 "그 data로 projectile spawn command를 만들고 어떤 실패를 telemetry로 낼 것인가"는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: melee action payload helper slice

`ActionBinding`에서 `Melee` 실행에 필요한 payload를 꺼내는 pattern-specific data helper도 `crate::gameplay`로 이동했다.

- `MeleeActionPayload`는 `range`, `damage`, `target`만 담는 copy data다.
- `prepare_melee_action_payload(...)`는 `World`의 action binding을 읽고, `Melee` pattern kind와 cooldown readiness를 확인한 뒤 payload를 반환한다.
- readiness 실패는 `ActionReadiness`로 반환한다. queued trigger runtime은 기존 `attempted_action_readiness_failure_reason(...)`을 통해 generic failure telemetry reason으로 변환한다.
- Shooter `process_melee_trigger(...)`는 더 이상 dispatch 단계에서 꺼낸 `range`/`damage`/`target` 값을 직접 전달받지 않고 payload helper 결과를 사용한다.
- 이 slice 시점에는 player target support, source/player transform lookup, melee attack command queueing, cooldown commit, `actionFailed` sink push가 Shooter runtime 책임으로 남아 있었다. 이후 melee action plan helper slice에서 player target support와 missing/self target 판단은 `crate::gameplay`로 이동했다.
- helper는 allocation, JS/Wasm callback, public TS API, Wasm ABI를 추가하지 않는다.
- 회귀 테스트는 missing, pattern mismatch, ready payload, successful prepare no-cooldown-commit, cooling-down 상태와 melee runtime failure의 no-cooldown-consume 의미를 고정한다.

이 slice 이후 현재 `ActionPattern` variant의 payload extraction은 `spawnPrefab`/`dash`/`projectile`/`melee` 모두 공통 gameplay helper가 담당한다. 하지만 각 payload로 어떤 scene command를 만들고 어떤 실패를 telemetry로 낼 것인가는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: prepared action payload dispatch slice

queued action trigger dispatch가 action binding을 두 번 읽던 구조를 줄이기 위해 현재 action payload들을 하나의 prepared payload enum으로 묶었다.

- `PreparedActionPayload`는 `Projectile`, `Dash`, `Melee`, `SpawnPrefab` payload variant를 갖는 copy enum이다.
- `prepare_any_action_payload_if_ready(...)`는 `World`의 action binding 존재 여부와 cooldown readiness를 한 번 확인한 뒤 pattern-specific payload로 변환한다. 이후 prepared action commit token slice에서 queued trigger executor가 같은 준비 결과로 commit할 수 있도록 `(PreparedAction, PreparedActionPayload)`를 반환한다.
- `prepared_action_payload_from_binding(...)`과 `*_action_payload_from_binding(...)` helper는 이미 읽은 `ActionBinding`을 payload로 변환한다. 이 helper들은 cooldown을 읽거나 commit하지 않는다.
- Shooter queued trigger dispatch는 더 이상 `prepare_any_action_if_ready(...)`로 dispatch한 뒤 각 `process_*`에서 다시 `prepare_*_action_payload(...)`를 호출하지 않는다. dispatch 단계에서 받은 `PreparedActionPayload`를 `process_*`로 넘긴다.
- cooldown commit은 여전히 scene-specific validation, queue capacity, placement check가 끝난 뒤 `commit_prepared_action(...)`에서만 수행한다.
- input wrapper, producer별 no-op/failure 정책, trigger queue phase processing loop, action-specific failure reason 선택, sink push는 Shooter runtime compatibility path에 남아 있다. trigger command type과 phase vocabulary는 이후 action trigger command vocabulary slice에서 `crate::gameplay`로 이동했다.
- helper는 allocation, JS/Wasm callback, public TS API, Wasm ABI를 추가하지 않는다.
- 회귀 테스트는 prepared any-action payload가 typed payload를 반환하고 successful prepare가 cooldown을 commit하지 않으며, existing queued action runtime suite가 기존 failure/commit 의미를 유지하는지 고정한다.

이 slice 이후 queued action trigger의 first readiness gate와 payload dispatch는 `crate::gameplay`의 typed prepared payload를 사용한다. 남은 action system 분리 범위는 실제 projectile/dash/melee/spawnPrefab 실행과 scene side-effect orchestration이다.

### 2026-06-01: dash action transform plan helper slice

dash action 실행 중 target-player 방향 계산과 최종 transform 계산도 scene-neutral helper로 분리했다.

- `DashActionPlanError`는 `UnsupportedAimSource`, `MissingActionTarget`만 표현한다.
- `plan_dash_action_transform(...)`은 `DashActionPayload`, source entity, source transform, optional target entity/transform을 받아 최종 dash transform을 계산한다.
- helper는 `World`를 mutate하지 않고, cooldown을 commit하지 않고, gameplay event를 push하지 않는다.
- source transform lookup, player entity/transform lookup, failure reason code mapping, `actionFailed` sink push, cooldown commit, `world.set_transform(...)`은 Shooter runtime 책임으로 유지한다.
- target이 없거나, target이 source와 같거나, source/target 위치가 사실상 같은 경우는 `MissingActionTarget`으로 묶어 기존 telemetry 의미를 유지한다.
- helper는 allocation, JS/Wasm callback, public TS API, Wasm ABI를 추가하지 않는다.
- 회귀 테스트는 unsupported aim, missing/self/zero-length target, 성공 transform을 고정하고 기존 queued dash runtime suite가 기존 failure/commit 의미를 유지하는지 확인한다.

이 slice 이후 dash action의 수학적 transform plan은 `crate::gameplay`가 담당한다. 실제 transform write와 telemetry emission은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: player input dash transform plan helper slice

player input dash의 입력 방향 우선, 마우스 aim target fallback, zero-vector fallback transform 계산도 scene-neutral helper로 분리했다.

- `plan_input_dash_action_transform(...)`은 `DashActionPayload`, source transform, input direction, aim target transform을 받아 최종 dash transform을 계산한다.
- helper는 `ActionAimSource::Input`만 지원한다. 다른 aim source는 `UnsupportedAimSource`로 반환해 기존 `actionFailed` telemetry 의미를 유지한다.
- 입력 방향이 있으면 helper가 normalize한 입력 방향을 우선 사용하고, 입력이 없으면 aim target 방향을 사용한다. 둘 다 유효하지 않으면 기존 player dash 동작처럼 +X 방향 fallback을 사용한다.
- helper는 `World`를 mutate하지 않고, camera/screen 좌표계를 알지 않고, cooldown을 commit하지 않고, gameplay event를 push하지 않는다.
- mouse screen 좌표를 world 좌표로 바꾸는 일, source transform lookup, failure reason code mapping, `actionFailed` sink push, cooldown commit, `world.set_transform(...)`은 Shooter runtime 책임으로 유지한다.
- helper는 allocation, JS/Wasm callback, public TS API, Wasm ABI를 추가하지 않는다.
- 회귀 테스트는 unsupported aim, input 방향 우선, input 대각선 normalize, aim target fallback, zero-vector fallback을 고정한다.

이 slice 이후 dash action의 target-player transform plan과 player input transform plan은 모두 `crate::gameplay`가 담당한다. 실제 transform write와 telemetry emission은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: projectile action direction plan helper slice

projectile action 실행 중 target-player 지원 여부 판단과 발사 방향/속도 계산도 scene-neutral helper로 분리했다.

- `ProjectileActionPlanError`는 `UnsupportedAimSource`, `UnsupportedCollisionTarget`, `MissingActionTarget`만 표현한다.
- `ProjectileSpawnPlan`은 normalized direction, spawn transform, speed가 적용된 velocity를 담는다.
- `validate_projectile_action_support(...)`는 target-player aim/player collision target 지원 여부를 source/player transform lookup보다 먼저 확인해 기존 failure reason precedence를 보존한다.
- `plan_projectile_action_toward_target(...)`은 `ProjectileActionPayload`, source entity, source transform, optional target entity/transform, spawn offset을 받아 발사 방향, spawn transform, velocity를 계산한다.
- helper는 `World`를 mutate하지 않고, projectile spawn command를 만들지 않고, cooldown을 commit하지 않고, gameplay event를 push하지 않는다.
- source transform lookup, player entity/transform lookup, sprite/template half extent 기반 spawn offset 산출, projectile arc construction, texture/audio/template/faction 채우기, spawn queue capacity, failure reason code mapping, `actionFailed` sink push, cooldown commit은 Shooter runtime 책임으로 유지한다.
- target이 없거나, target이 source와 같거나, source/target 위치가 사실상 같은 경우는 `MissingActionTarget`으로 묶어 기존 telemetry 의미를 유지한다.
- helper는 allocation, JS/Wasm callback, public TS API, Wasm ABI를 추가하지 않는다.
- 회귀 테스트는 unsupported aim, unsupported collision target, missing/self/zero-length target, axis/diagonal success direction, spawn transform과 기존 queued projectile runtime suite의 no-cooldown-consume 의미를 고정한다.

이 slice 이후 projectile action의 수학적 direction/velocity/spawn transform plan은 `crate::gameplay`가 담당한다. 실제 projectile spawn command construction과 telemetry emission은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: queued projectile spawn transform plan helper slice

queued projectile target-player 경로도 player input projectile과 같은 수준으로 spawn transform 계산을 `crate::gameplay`로 옮겼다.

- `ProjectileSpawnPlan`에 spawn transform을 포함해, `ProjectileSpawnCommand` construction 전에 필요한 수학적 spawn 위치를 공통 helper가 산출한다.
- Shooter runtime은 source sprite half extent와 bullet template half extent로 spawn offset을 계산해 helper에 전달한다.
- helper는 offset 적용만 담당하고, sprite/template 조회나 bullet prefab 의미를 알지 않는다.
- projectile arc, texture id, bullet template, source faction, audio payload 조립은 Shooter runtime 책임으로 유지한다. 이후 projectile spawn core data slice에서 damage/collision target/tile impact는 plan/payload 기반 scene-neutral data로 `crate::gameplay`에 이동했다.
- 회귀 테스트는 target-player axis/diagonal projectile의 spawn transform이 direction과 같은 offset을 사용하는지 고정한다.

이 slice 이후 queued projectile의 spawn transform 계산은 `crate::gameplay`가 담당한다. 실제 `ProjectileSpawnCommand` struct 조립, spawn queue mutation, arc/audio/faction side-effect 조립은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: projectile spawn plan type unification slice

queued target-player projectile과 player input projectile의 plan data shape가 같아졌으므로 call path별 plan 타입을 `ProjectileSpawnPlan` 하나로 통합했다.

- 기존 target-player projectile의 `ProjectileActionPlan`과 input projectile의 `InputProjectileActionPlan`은 모두 direction, spawn transform, velocity만 담고 있었다.
- `ProjectileSpawnPlan`은 실행 producer와 무관하게 projectile spawn command 직전의 scene-neutral math result를 의미한다.
- `plan_projectile_action_toward_target(...)`과 `plan_input_projectile_action(...)`은 서로 다른 지원 aim/collision target과 failure semantics를 유지하되 같은 output type을 반환한다.
- helper는 여전히 `ProjectileSpawnCommand`를 만들지 않고, texture/template/audio/faction/arc/queue/cooldown/event 책임은 Shooter runtime에 남긴다.
- 이 통합은 public API나 Wasm ABI를 바꾸지 않는 crate-private 타입 정리다.

이 slice 이후 projectile spawn math result vocabulary는 `ProjectileSpawnPlan`으로 정렬됐다. 실제 projectile command construction과 side-effect 조립은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: player input projectile spawn plan helper slice

player input projectile의 aim target 방향, spawn offset 적용 transform, velocity 계산도 scene-neutral helper로 분리했다.

- `ProjectileSpawnPlan`은 input projectile과 queued target-player projectile이 공유하는 normalized direction, spawn transform, velocity copy data다.
- `plan_input_projectile_action(...)`은 `ProjectileActionPayload`, source transform, world-space aim target, spawn offset을 받아 projectile spawn에 필요한 수학적 plan을 만든다.
- helper는 `ActionAimSource::Input`과 `ProjectileCollisionTarget::Enemies`만 지원한다. 다른 aim/collision target은 기존 generic projectile failure vocabulary인 `UnsupportedAimSource`/`UnsupportedCollisionTarget`으로 반환한다.
- aim target 방향이 유효하지 않으면 기존 player fire 동작처럼 +X 방향 fallback을 사용한다.
- helper는 `World`, camera, raw input, template, texture id, audio id, faction, projectile arc를 알지 않고, cooldown을 commit하지 않고, spawn queue나 gameplay event를 mutate하지 않는다.
- camera screen 좌표를 world 좌표로 바꾸는 일, source transform lookup, player/bullet template 기반 spawn offset 산출, projectile arc/faction/template/audio payload 조립, queue mutation, cooldown commit, telemetry는 Shooter runtime 책임으로 유지한다.
- helper는 allocation, JS/Wasm callback, public TS API, Wasm ABI를 추가하지 않는다.
- 회귀 테스트는 unsupported aim, unsupported collision target, normalized direction/velocity/spawn transform, zero-vector fallback을 고정한다.

이 slice 이후 player input projectile의 수학적 spawn plan은 `crate::gameplay`가 담당한다. 실제 `ProjectileSpawnCommand` construction, queue mutation, audio/arc/faction side-effect 조립은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: melee action plan helper slice

melee action 실행 중 지원 target 검증과 queued melee attack의 scene-neutral plan 생성을 `crate::gameplay`로 분리했다.

- `MeleeActionPlanError`는 `UnsupportedTarget`, `MissingActionTarget`만 표현한다.
- `MeleeActionPlan`은 attack center, range, damage, target만 담는다.
- `validate_queued_melee_action_support(...)`는 queued trigger 경로에서 player target 지원 여부를 source transform lookup보다 먼저 확인해 기존 failure reason precedence를 보존한다. Player input melee의 `target: Enemies` 경로와 혼동하지 않도록 queued action helper로 범위를 좁힌다.
- `plan_melee_action(...)`은 `MeleeActionPayload`, source entity, source transform, optional target entity를 받아 pending melee attack에 필요한 scene-neutral plan을 만든다.
- helper는 `World`를 mutate하지 않고, pending queue에 push하지 않고, cooldown을 commit하지 않고, gameplay event를 push하지 않는다.
- source transform lookup, player entity lookup, height span lookup, `MeleeAttackCommand` push, failure reason code mapping, `actionFailed` sink push, cooldown commit은 Shooter runtime 책임으로 유지한다.
- target이 없거나 target이 source와 같은 경우는 `MissingActionTarget`으로 묶어 기존 telemetry 의미를 유지한다.
- helper는 allocation, JS/Wasm callback, public TS API, Wasm ABI를 추가하지 않는다.
- 회귀 테스트는 unsupported target, missing/self target, successful plan과 기존 queued melee runtime suite의 no-cooldown-consume 의미를 고정한다.

이 slice 이후 melee action의 지원 target 검증과 pending attack plan은 `crate::gameplay`가 담당한다. 실제 melee attack queue mutation과 collision hit resolution은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: spawnPrefab action transform plan helper slice

spawnPrefab action 실행 중 prefab 지원 여부, anchor/phase 지원 여부, source-relative spawn transform 계산을 `crate::gameplay`로 분리했다.

- `SpawnPrefabActionPlanError`는 `UnsupportedPrefab`, `UnsupportedAnchor`, `UnsupportedPhase`, `MissingSourceTransform`을 표현한다.
- `SpawnPrefabActionPlan`은 prefab id와 최종 spawn transform만 담는다. 어떤 prefab id가 지원되는지 해석하는 일은 Shooter runtime 책임으로 유지한다.
- `SpawnPrefabSupport`는 runtime이 특정 prefab id에 대해 계산한 지원 여부를 `Supported`/`Unsupported`로 전달하는 작은 value enum이다.
- `validate_spawn_prefab_action_support(...)`는 anchor/phase 지원 여부를 source transform lookup보다 먼저 확인해 common action-level failure precedence를 보존한다.
- `plan_spawn_prefab_action(...)`은 `SpawnPrefabActionPayload`와 optional source transform을 받아 source-relative offset이 적용된 action plan을 만든다.
- `plan_supported_spawn_prefab_action(...)`은 runtime이 계산한 prefab 지원 여부를 받아 unsupported prefab을 source transform missing보다 먼저 보고한다.
- helper는 `World`를 mutate하지 않고, `PrefabSpawnCommand`를 만들지 않고, placement를 검사하지 않고, cooldown을 commit하지 않고, gameplay event를 push하지 않는다.
- `ShooterPrefabKind` 기반 prefab id 지원 여부 산출, texture/template/health/score_reward 채우기, spawn queue capacity, tilemap placement, failure reason code mapping, `actionFailed`/`prefabSpawned` sink push, cooldown commit은 Shooter runtime 책임으로 유지한다.
- helper는 unsupported prefab id를 source transform missing보다 먼저 보고한다. common helper 내부에서는 unsupported prefab, unsupported anchor/phase, missing source 순서로 실패 precedence를 고정한다.
- helper는 allocation, JS/Wasm callback, public TS API, Wasm ABI를 추가하지 않는다.
- 회귀 테스트는 successful source-relative transform, missing source transform, unsupported prefab precedence와 queued spawnPrefab runtime suite의 no-cooldown-consume 의미를 고정한다.

이 slice 이후 spawnPrefab action의 supported-prefab gate와 source-relative transform plan은 `crate::gameplay`가 담당한다. 실제 scene prefab command construction, placement, queue mutation, telemetry emission은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: spawnPrefab placement footprint helper slice

spawnPrefab blocked placement 검사에서 tilemap query는 Shooter runtime에 남기되, prefab template에서 placement AABB collider를 만드는 footprint 계산은 `crate::gameplay`로 분리했다.

- `spawn_prefab_placement_collider(...)`는 `EntityTemplate`과 placement layer를 받아 `AabbCollider`를 만든다.
- helper는 template의 half extent, enabled flag, trigger flag, collider offset을 그대로 보존한다.
- non-AABB template collider는 현재 placement query용 AABB envelope로 취급한다. exact circle/capsule/oriented-box placement 검사는 후속 범위다.
- helper는 tilemap을 모르고, obstacle query를 실행하지 않고, scratch buffer를 소유하지 않고, cooldown을 commit하지 않고, gameplay event를 push하지 않는다.
- placement layer 선택(`CollisionLayer::Enemy`), `Tilemap::aabb_obstacle_contacts_into(...)` 호출, `spawn_obstacle_contacts` scratch reuse, blocked placement failure reason 선택은 Shooter runtime 책임으로 유지한다. scratch `Vec`는 frame 간 재사용하지만 capacity 초과 시 grow할 수 있으므로 hard allocation-free contract는 아니다.
- helper는 allocation, JS/Wasm callback, public TS API, Wasm ABI를 추가하지 않는다.
- 회귀 테스트는 template collider footprint 보존, non-AABB template의 AABB envelope 의도, 기존 blocked placement offset runtime suite를 고정한다.

이 slice 이후 spawnPrefab placement의 AABB footprint construction은 `crate::gameplay`가 담당한다. 실제 tilemap placement query, queue mutation, telemetry emission은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: spawnPrefab pre-commit gate helper slice

spawnPrefab 실행에서 command construction 이후 cooldown commit 전에 검사하는 queue capacity/blocked placement precedence를 `crate::gameplay` helper로 분리했다.

- `SpawnPrefabPreCommitError`는 `SpawnQueueFull`, `BlockedPlacement`만 표현한다.
- `validate_spawn_prefab_pre_commit_gates(...)`는 pending spawn capacity를 먼저 검사하고, capacity가 없으면 placement check closure를 호출하지 않는다.
- 이 precedence는 player input spawnPrefab과 Rust-owned trigger spawnPrefab 경로가 공유한다.
- helper는 tilemap을 모르고, placement query를 실행하지 않고, scratch buffer를 소유하지 않고, spawn queue를 mutate하지 않고, cooldown을 commit하지 않고, gameplay event를 push하지 않는다.
- `Tilemap::aabb_obstacle_contacts_into(...)` 호출, `spawn_obstacle_contacts` scratch reuse, `SpawnQueueFull`/`BlockedPlacement`를 telemetry reason code로 매핑하는 일은 Shooter runtime 책임으로 유지한다.
- 회귀 테스트는 queue full이면 placement query가 실행되지 않고, capacity 성공 뒤에만 blocked placement가 평가되는 precedence를 고정한다. Player input과 queued trigger spawnPrefab 경로 모두 queue full, blocked placement, cooldown 미소비 의미를 별도 테스트로 고정한다.

이 slice 이후 spawnPrefab action의 pre-commit gate precedence는 `crate::gameplay`가 담당한다. 실제 tilemap placement query, queue mutation, telemetry emission, cooldown commit은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: action trigger command vocabulary slice

queued action trigger command type과 phase vocabulary를 `crate::gameplay`로 이동해 이미 공통화된 `ActionTriggerQueue<T>`와 같은 layer에 정렬했다.

- `ActionTriggerKind`, `ActionTriggerPhase`, `ActionTriggerCommand`는 `crate::gameplay` 소유가 됐다.
- `ActionTriggerCommand::timer(...)`, `wave(...)`, `behavior_state_enter(...)` constructor는 모두 `PrePhysics` phase를 명시적으로 설정한다.
- Shooter runtime은 기존 call site 호환을 위해 `crate::gameplay::ActionTriggerCommand`를 re-export한다.
- trigger producer별 no-op/failure policy, queue phase processing loop, action-specific execution, failure event sink push는 Shooter runtime compatibility path에 남아 있다.
- helper는 allocation, JS/Wasm callback, public TS API, Wasm ABI를 추가하지 않는다.
- 회귀 테스트는 common command constructor가 kind/phase를 고정하고, 기존 bounded frame-local queue test와 runtime queued trigger suite가 동일하게 동작하는지 확인한다.

이 slice 이후 queued trigger의 저장소와 command vocabulary는 `crate::gameplay`가 담당한다. 실제 producer policy와 scene execution orchestration은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: full previous input snapshot slice

Frame input snapshot의 `previous` 계약을 button-edge 전용 partial snapshot에서 full `InputState` snapshot으로 확장했다.

- `ShooterScene`은 frame 종료 시 전체 `InputState`를 `previous_input`에 저장한다.
- Title/GameOver 전이와 legacy button edge state는 기존 `previous_space`/`previous_enter`/`previous_mouse_left` 필드를 유지하되, production `FrameInputSnapshot`의 previous 값은 `previous_input`에서 온다.
- built-in Shooter snapshot version을 `11`로 올리고 previous `w/a/s/d`, `space/enter/mouse_left`, `mouse_x/y`를 저장/복원한다.
- input action registry snapshot offset은 기존 `9`를 유지하고, 새 digital axis fields는 registry 뒤쪽에 추가해 기존 registry layout shift를 피했다.
- `packages/ferrum-web`의 public built-in shooter state version과 `gameplay-replay-smoke.mjs`의 expected version도 `11`로 맞췄다.
- public TS validation은 version `11`의 header/entity stride를 고정한다. replay smoke도 Wasm getter가 같은 stride를 반환하는지 먼저 확인한다.
- restore validation은 spawnPrefab 반복 슬롯의 gap과 action id 내림차순을 거부해 capture canonical order와 restore input 계약을 맞춘다.
- player `scoreReward`가 player projectile policy slot을 오염시키지 않도록 score reward snapshot write/read scope를 enemy snapshot으로 제한했다.
- 회귀 테스트는 snapshot capture/restore가 previous mouse 좌표와 previous digital movement/button state를 보존하는지, held `pressed` action이 restore/resume 뒤 다시 발동하지 않는지, player scoreReward가 restore를 깨지 않는지, spawnPrefab slot gap/unsorted input이 거부되는지 고정한다.

이 slice 이후 현재 action registry가 button control만 지원하더라도 replay/save state는 향후 axis/pointer 기반 action control이 추가될 때 필요한 previous input 기준을 이미 보존한다.

### 2026-06-01: input action readiness wrapper slice

player input action dispatch에서 쓰던 input-active/readiness wrapper를 Shooter runtime local 타입에서 `crate::gameplay`로 이동했다.

- `InputActionTrigger`는 최초 slice에서는 `Inactive`, `Missing`, `PatternMismatch`, `CoolingDown`, `Ready(ActionBinding)`을 표현했다. 이후 prepared action commit token slice에서 `Ready(PreparedAction)`으로 승격되어 input action도 prepare/commit identity를 공유한다.
- `prepare_input_action_if_ready(...)`는 `InputActionRegistry` activation check와 generic `prepare_action_if_ready(...)`를 같은 공통 helper에서 연결한다.
- `Inactive`는 gameplay readiness failure가 아니라 input policy 결과이므로 `attempted_action_readiness_failure_reason(...)`과 분리된 상태로 유지한다.
- Shooter player input path는 더 이상 runtime/actions.rs local wrapper를 소유하지 않고 `crate::gameplay` helper를 직접 사용한다.
- 회귀 테스트는 unpressed/repeated pressed input은 inactive, pressed input의 missing/pattern mismatch/ready는 기존 action readiness와 동일하게 동작함을 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "input wrapper"는 공통 gameplay layer로 이동했다. producer별 no-op/failure 정책, trigger queue phase processing loop, action-specific failure reason 선택, 실패 event sink push는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: action failure reason mapper slice

action planner typed error를 gameplay event failure reason code로 바꾸는 mapper를 Shooter runtime local helper에서 `crate::gameplay`로 이동했다.

- `DashActionPlanError`, `ProjectileActionPlanError`, `MeleeActionPlanError`, `SpawnPrefabActionPlanError`, `SpawnPrefabPreCommitError`의 reason-code mapping을 공통 gameplay helper가 소유한다.
- Shooter player input path와 queued trigger path는 같은 mapper를 import해 사용한다.
- mapper는 Rust-owned typed error와 기존 gameplay event code 사이의 deterministic 변환만 수행하며, event sink push 여부나 no-op 정책은 계속 Shooter runtime compatibility path가 결정한다.
- 새 public API, Wasm ABI, JS/TS callback, world scan, allocation은 추가하지 않았다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "action-specific failure reason 선택"은 공통 gameplay layer로 이동했다. producer별 no-op/failure 정책, trigger queue phase processing loop, projectile command construction, melee attack queue mutation/collision resolution, spawnPrefab command construction/placement query, dash transform write, 실패 event sink push는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: input action snapshot contract slice

`prepare_input_action_if_ready(...)`가 current/previous `InputState`를 별도 인자로 받지 않고 `FrameInputSnapshot`을 직접 받도록 정리했다.

- production Shooter player action phase는 이미 movement/action phase가 공유하는 `FrameInputSnapshot`을 갖고 있으므로, 그 snapshot을 그대로 공통 helper에 전달한다.
- helper 내부의 activation check는 `input.current`와 `input.previous`를 사용한다. 호출자가 서로 다른 frame의 current/previous 값을 실수로 조합할 여지를 줄인다.
- `current_only(...)`는 기존 compatibility/test helper에서만 사용하고, production path는 `FrameInputSnapshot::new(current, previous)` 계약을 유지한다.
- 회귀 테스트는 `Pressed` activation의 unpressed/repeated pressed/ready와 `Down` activation의 held ready 동작을 helper 레벨에서 고정한다.
- 새 public API, Wasm ABI, JS/TS callback, allocation, world scan은 추가하지 않았다.

이 slice 이후 input action readiness wrapper는 `FrameInputSnapshot` phase contract까지 공유한다. snapshot 생성 시점과 previous input 저장/복원은 여전히 Shooter runtime과 built-in shooter snapshot path가 소유한다.

### 2026-06-01: prepared action commit token slice

prepare와 commit 사이의 action identity를 명시하기 위해 `ActionReadiness::Ready`와 `InputActionTrigger::Ready`가 bare `ActionBinding` 대신 `PreparedAction` token을 들도록 정리했다.

- `PreparedAction`은 source entity, action id, action pattern kind, 준비 시점의 `ActionBinding`을 함께 보관한다.
- `commit_prepared_action(...)`은 entity/action id/kind를 다시 받지 않고 `PreparedAction`을 받는다.
- commit 시 token 내부의 binding action id가 token action id와 다르거나, 현재 binding의 pattern이 준비 시점과 달라졌거나, cooldown이 더 이상 ready가 아니면 cooldown을 소비하지 않는다. pattern 비교는 f32 `NaN` 때문에 derived `PartialEq`를 사용하지 않고, 준비 시점과 현재 시점의 bit-level payload identity를 비교한다.
- cooldown duration만 prepare와 commit 사이에 바뀐 경우에는 pattern identity가 아니므로 commit을 허용하고, 실제 cooldown 소비는 현재 stored binding의 duration을 따른다. 이 정책은 향후 opaque binding revision token을 도입할 때 다시 고정한다.
- `prepare_any_action_payload_if_ready(...)`는 queued trigger executor가 같은 token으로 commit할 수 있도록 `(PreparedAction, PreparedActionPayload)`를 반환한다.
- Shooter input action path와 queued trigger path 모두 planning/gate 성공 후 같은 token으로 commit한다.
- 회귀 테스트는 wrong-kind token과 binding action id mismatch token이 cooldown을 소비하지 않는지, prepare와 commit 사이 binding pattern이 바뀌면 commit이 거부되는지, 동일 `NaN` payload bit-pattern은 commit 가능하고 다른 `NaN` bit-pattern은 거부되는지, cooldown 선소비와 entity despawn/reuse가 commit을 거부하는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "prepare/commit identity revalidation"은 공통 gameplay layer로 이동했다. producer별 no-op/failure 정책, trigger queue phase processing loop, projectile command construction, melee attack queue mutation/collision resolution, spawnPrefab command construction/placement query, dash transform write, 실패 event sink push는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-01: action failure telemetry policy slice

producer별 no-op/failure telemetry 정책을 `crate::gameplay`의 작은 policy vocabulary로 분리했다. 목표는 event sink push 위치를 옮기는 것이 아니라, queued trigger와 player input이 readiness 실패를 다르게 취급한다는 계약을 코드로 드러내는 것이다.

- `ActionAttemptFailurePolicy`는 `Silent`, `ReportGenericReadinessFailures`, `ReportPatternMismatchOnly`, `PrimaryInputWithMissingFallback`을 표현한다.
- `ActionAttemptFailureDecision`은 `Noop`, `Fallback`, `Failure(reason_code)`를 표현한다.
- `action_readiness_failure_decision_for_policy(...)`는 `ActionReadiness` 실패를 policy에 따라 no-op, legacy fallback, gameplay failure reason code로 바꾼다.
- `input_action_trigger_failure_decision_for_policy(...)`는 `Inactive`와 `Ready`를 항상 no-op으로 두고, input producer가 missing/cooling-down/pattern-mismatch 중 무엇을 telemetry 또는 fallback으로 볼지 선택하게 한다.
- queued trigger readiness failure는 `ReportGenericReadinessFailures`를 사용해 기존처럼 missing/cooling-down을 `actionFailed`로 보고한다.
- player primary input은 `PrimaryInputWithMissingFallback`을 사용해 missing binding일 때만 legacy `ShooterConfig` fire fallback으로 흐르고, inactive/cooling-down은 no-op, pattern mismatch는 failure decision으로 둔다.
- player dash/melee fixed action input은 `ReportPatternMismatchOnly`를 사용해 기존처럼 inactive/missing/cooling-down은 no-op으로 두고 pattern mismatch만 보고한다. 단, spawnPrefab action이 primary/dash/melee 고정 action id를 사용하는 경우의 suppress guard는 여전히 Shooter runtime policy로 남긴다.
- scanned spawnPrefab input은 `Silent`를 사용해 non-ready binding을 continue/no-op으로 취급한다.
- 이 slice 시점에는 event sink push, source/actor 선택, dedupe/flush policy를 Shooter runtime compatibility path가 소유했다. 이후 queued action failure sink helper slice에서 queued executor의 optional sink push만 공통 helper로 이동했고, player/waves/source-actor policy는 계속 Shooter runtime에 남겼다. 새 policy helper는 작은 enum match만 수행하므로 Wasm/TS ABI, JS callback, allocation, world scan을 추가하지 않는다.
- 회귀 테스트는 generic readiness reporting, silent policy, pattern-mismatch-only policy, primary input missing fallback, input inactive/ready no-op을 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "producer별 readiness failure decision policy"는 공통 gameplay layer로 이동했다. trigger queue phase processing loop, projectile command construction, melee attack queue mutation/collision resolution, spawnPrefab command construction/placement query, dash transform write, 실패 event sink push와 spawnPrefab suppress guard는 이 slice 시점에는 Shooter runtime compatibility path에 남아 있었다.

### 2026-06-02: action trigger phase dispatch helper slice

queued action trigger processing loop에서 phase/kind filter를 `crate::gameplay` helper로 분리했다. 목표는 action 실행 본문을 옮기는 것이 아니라, `ActionTriggerCommand`의 phase dispatch 계약을 queue storage와 같은 layer에서 고정하는 것이다.

- `action_trigger_runs_in_phase(...)`는 `ActionTriggerCommand`가 특정 `ActionTriggerPhase`에서 실행될 수 있는지 판정한다.
- `ActionTriggerQueue<ActionTriggerCommand>::processing_at_phase(...)`는 processing buffer에서 index를 조회한 뒤 phase filter를 통과한 command만 반환한다.
- Shooter runtime `process_action_triggers(...)`는 더 이상 `(phase, kind)` match를 직접 소유하지 않고, `processing_at_phase(..., PrePhysics)`가 반환한 command만 실행한다.
- 현재 public trigger kind인 timer/wave/behavior-state-enter는 모두 `PrePhysics`에서만 실행된다. 향후 새 phase나 trigger kind가 추가되면 `crate::gameplay`의 phase dispatch helper와 테스트가 먼저 깨지거나 갱신된다.
- helper는 작은 `Copy` command match만 수행하므로 allocation, world scan, JS/Wasm callback, ABI 변경을 추가하지 않는다.
- 회귀 테스트는 모든 현재 trigger command constructor가 `PrePhysics` phase를 갖고, queue processing accessor가 phase에 맞는 command만 반환하는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "trigger queue phase filter/accessor"는 공통 gameplay layer로 이동했다. trigger processing loop의 실제 실행 orchestration, projectile command construction, melee attack queue mutation/collision resolution, spawnPrefab command construction/placement query, dash transform write, 실패 event sink push와 spawnPrefab suppress guard는 이 slice 시점에는 Shooter runtime compatibility path에 남아 있었다.

### 2026-06-02: projectile spawn core data slice

projectile action planner가 만든 `ProjectileSpawnPlan`과 `ProjectileActionPayload`를 scene-neutral spawn core data로 합치는 helper를 `crate::gameplay`에 추가했다. 목표는 Shooter-specific `ProjectileSpawnCommand` 전체를 옮기는 것이 아니라, queued projectile과 player input projectile이 공유하는 transform/velocity/damage/lifetime/collision policy 조립을 공통 layer로 고정하는 것이다.

- `ProjectileSpawnCoreData`는 transform, velocity, lifetime seconds, damage, collision target, tile impact만 담는다.
- `projectile_spawn_core_data_from_plan(...)`은 `ProjectileSpawnPlan`과 `ProjectileActionPayload`를 allocation 없이 `Copy` 값으로 합친다.
- queued projectile과 player input projectile runtime은 이 helper의 결과를 사용해 `ProjectileSpawnCommand`를 채운다.
- texture id, bullet template, projectile arc, source faction, shoot audio id/volume/pitch는 여전히 Shooter runtime compatibility path에서 채운다. 이 값들은 scene config, source entity faction, current height span, audio policy에 묶여 있기 때문이다.
- 새 helper는 Rust 내부 `pub(crate)` data helper이며 Wasm/TS ABI, JS callback, world scan, heap allocation을 추가하지 않는다.
- 회귀 테스트는 helper가 plan의 transform/velocity와 payload의 lifetime/damage/collision/tile-impact를 그대로 보존하는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "projectile command scene-neutral data construction"은 공통 gameplay layer로 이동했다. projectile command의 scene-specific enrichment와 queue mutation, trigger processing loop의 실제 실행 orchestration, melee attack queue mutation/collision resolution, spawnPrefab command construction/placement query, dash transform write, 실패 event sink push와 spawnPrefab suppress guard는 이 slice 시점에는 Shooter runtime compatibility path에 남아 있었다.

### 2026-06-02: spawnPrefab core data slice

spawnPrefab action planner가 만든 `SpawnPrefabActionPlan`과 producer metadata를 scene-neutral spawn core data로 합치는 helper를 `crate::gameplay`에 추가했다. 목표는 Shooter-specific `PrefabSpawnCommand` 전체를 옮기는 것이 아니라, player input과 queued trigger가 공유하는 source/action/prefab/transform data 조립을 공통 layer로 고정하는 것이다.

- `SpawnPrefabCoreData`는 source entity, action id, prefab id, spawn transform만 담는다.
- `spawn_prefab_core_data_from_plan(...)`은 source/action id와 `SpawnPrefabActionPlan`을 allocation 없이 `Copy` 값으로 합친다.
- Shooter runtime `spawn_prefab_command(...)`는 이 helper의 결과를 사용해 `PrefabSpawnCommand`의 core fields를 채운다.
- `ShooterPrefabKind` 지원 여부 판단, texture id, enemy template, health, score reward는 계속 Shooter runtime compatibility path에서 채운다. 이 값들은 built-in Shooter config와 scene prefab vocabulary에 묶여 있기 때문이다.
- placement query, queue capacity, cooldown commit, `prefabSpawned`/`actionFailed` event sink push는 여전히 Shooter runtime 책임이다.
- 새 helper는 Rust 내부 `pub(crate)` data helper이며 Wasm/TS ABI, JS callback, world scan, heap allocation을 추가하지 않는다.
- 회귀 테스트는 helper가 source/action id와 plan의 prefab id/transform을 그대로 보존하는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "spawnPrefab command scene-neutral core data construction"은 공통 gameplay layer로 이동했다. spawnPrefab command의 scene-specific enrichment, placement query, queue mutation, trigger processing loop의 실제 실행 orchestration, melee attack queue mutation/collision resolution, dash transform write, 실패 event sink push와 spawnPrefab suppress guard는 이 slice 시점에는 Shooter runtime compatibility path에 남아 있었다.

### 2026-06-02: dash action core data/apply slice

dash action planner가 계산한 최종 transform과 대상 entity를 scene-neutral core data로 묶고, 최종 transform component write를 `crate::gameplay` helper로 이동했다. 목표는 dash planning만 공통화한 상태에서 한 단계 더 나아가, queued dash와 player input dash가 같은 apply boundary를 통과하도록 만드는 것이다.

- `DashActionCoreData`는 dash 대상 entity와 최종 transform만 담는다.
- `dash_action_core_data_from_plan(...)`은 `PreparedAction`의 entity와 planner가 만든 transform을 allocation 없이 `Copy` 값으로 합친다.
- `apply_dash_action_core_data(...)`는 `World::set_transform(...)`만 호출한다. 같은 phase의 다음 system이 즉시 읽어야 하는 component write는 허용한다는 deferred command 원칙의 예외 범위에 해당한다.
- queued trigger dash와 player input dash는 planning 성공 및 prepared action commit 성공 후 이 helper를 호출한다.
- source/player transform lookup, aim target 계산, cooldown commit, 실패 event sink push는 여전히 Shooter runtime compatibility path가 소유한다.
- 새 helper는 Rust 내부 `pub(crate)` data/apply helper이며 Wasm/TS ABI, JS callback, world scan, heap allocation을 추가하지 않는다.
- 회귀 테스트는 helper가 entity/transform을 보존하고 target entity transform을 갱신하는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "dash transform write"는 공통 gameplay layer로 이동했다. trigger processing loop의 실제 실행 orchestration, projectile/spawnPrefab command scene-specific enrichment와 queue mutation, melee attack queue mutation/collision resolution, spawnPrefab placement query, 실패 event sink push와 spawnPrefab suppress guard는 이 slice 시점에는 Shooter runtime compatibility path에 남아 있었다.

### 2026-06-02: melee attack core data slice

melee action planner가 만든 `MeleeActionPlan`과 공격자 metadata를 scene-neutral pending attack core data로 합치는 helper를 `crate::gameplay`에 추가했다. 목표는 pending melee collision resolution을 옮기는 것이 아니라, queued melee와 player input melee가 공유하는 attacker/center/range/damage/target/height-span data 조립을 공통 layer로 고정하는 것이다.

- `MeleeAttackCoreData`는 attacker entity, attack center, range, damage, target, optional height span만 담는다.
- `melee_attack_core_data_from_plan(...)`은 `PreparedAction`의 entity, `MeleeActionPlan`, 공격자 height span을 allocation 없이 `Copy` 값으로 합친다. height span은 기존 pending melee command와 같이 queue 시점 snapshot으로 보존한다.
- queued trigger melee와 player input melee는 planning 성공 및 prepared action commit 성공 후 이 helper의 결과를 사용해 `MeleeAttackCommand`를 queue에 push한다.
- pending melee queue storage, collision query/resolution, score/audio/VFX/tween/gameplay-event side effect는 여전히 Shooter runtime compatibility path가 소유한다.
- 새 helper는 Rust 내부 `pub(crate)` data helper이며 Wasm/TS ABI, JS callback, world scan, heap allocation을 추가하지 않는다.
- 회귀 테스트는 helper가 attacker, plan fields, height span을 그대로 보존하는지, queued trigger/player input melee command가 queue 시점 height span을 담는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "melee attack command scene-neutral data construction"은 공통 gameplay layer로 이동했다. trigger processing loop의 실제 실행 orchestration, projectile/spawnPrefab command scene-specific enrichment와 queue mutation, melee attack queue mutation/collision resolution, spawnPrefab placement query, 실패 event sink push와 spawnPrefab suppress guard는 이 slice 시점에는 Shooter runtime compatibility path에 남아 있었다.

### 2026-06-02: queued action failure sink helper slice

queued action trigger executor의 `actionFailed` event push를 `crate::gameplay`의 작은 sink helper로 분리했다. 목표는 `GameplayEventSink` 전체를 공통 runtime으로 옮기는 것이 아니라, action system 후보가 actor/source/action/reason payload 조립과 optional sink push 정책을 Shooter local method에 직접 묶지 않도록 하는 것이다.

- `ActionFailureEventData`는 actor entity, source entity, action id, reason code만 담는다.
- `action_failure_event_data(...)`는 action failure payload를 allocation 없이 `Copy` 값으로 만든다.
- `ActionFailureEventSink` trait와 `push_action_failure_event(...)`는 optional sink push를 공통 helper로 표현한다.
- Shooter `GameplayEventSink`는 이 trait를 구현하고 내부에서 기존 `GameplayEvent::action_failed(...)` ABI를 그대로 사용한다.
- 이번 slice는 `runtime/actions.rs`의 queued trigger/timer action failure path에만 적용한다. player input action failure push, wave producer failure push, spawnPrefab suppress guard는 후속 범위로 남긴다.
- 새 helper는 Rust 내부 `pub(crate)` trait/data helper이며 Wasm/TS ABI, JS callback, heap allocation, world scan을 추가하지 않는다.
- 회귀 테스트는 helper가 sink가 있을 때만 data를 push하고, 기존 queued melee/wave trigger failure/success runtime suite가 같은 `actionFailed` payload를 유지하는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 queued trigger의 "failure event optional sink push" 일부는 공통 gameplay layer로 이동했다. trigger processing loop의 실제 실행 orchestration, projectile/spawnPrefab command scene-specific enrichment와 queue mutation, melee attack queue mutation/collision resolution, spawnPrefab placement query, player/wave failure event push, spawnPrefab suppress guard는 이 slice 시점에는 Shooter runtime compatibility path에 남아 있었다.

### 2026-06-02: player/wave action failure sink helper slice

player input action과 wave producer의 `actionFailed` event push도 `crate::gameplay`의 `ActionFailureEventSink` helper를 통과하도록 정리했다. 목표는 producer별 실패 판정이나 actor/source 선택을 공통 layer로 옮기는 것이 아니라, 모든 현재 action producer가 같은 payload construction/optional sink push boundary를 공유하게 만드는 것이다.

- player input projectile/dash/melee/spawnPrefab 실패 path는 `action_failure_event_data(...)`와 `push_action_failure_event(...)`를 사용한다.
- wave producer의 trigger queue-full failure path도 같은 helper를 사용한다.
- 모든 현재 producer가 helper를 통과하므로 더 이상 쓰이지 않는 Shooter-local `push_action_failed(...)` wrapper는 제거했다.
- actor/source 선택은 기존처럼 Shooter runtime 호출부에서 명시한다. player input은 `player/player`, wave producer는 `trigger.source/trigger.source`를 넘긴다.
- `input_action_trigger_failure_decision_for_policy(...)`, spawnPrefab pre-commit gate, suppress guard, source freshness check는 여전히 Shooter runtime compatibility policy로 남긴다.
- 새 public API, Wasm ABI, JS/TS callback, heap allocation, world scan은 추가하지 않았다.
- 회귀 테스트는 기존 player action failure telemetry suite와 wave action trigger suite가 같은 `actionFailed` payload를 유지하는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "failure event optional sink push"는 현재 action producer(player/queued trigger/wave) 기준으로 공통 helper를 통과한다. trigger processing loop의 실제 실행 orchestration, projectile/spawnPrefab command scene-specific enrichment와 queue mutation, melee attack queue mutation/collision resolution, spawnPrefab placement query, spawnPrefab suppress guard는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: fixed action spawnPrefab suppress guard slice

fixed player action id의 pattern mismatch telemetry suppress guard를 `crate::gameplay` helper로 분리했다. 목표는 World lookup이나 input producer orchestration을 옮기는 것이 아니라, "실제 binding이 spawnPrefab이면 고정 projectile/dash/melee action mismatch로 보고하지 않는다"는 action authoring compatibility policy를 공통 action layer에 고정하는 것이다.

- `should_report_fixed_action_pattern_mismatch(...)`는 actual `ActionPatternKind`만 받아 spawnPrefab kind일 때만 false를 반환한다.
- Shooter player runtime은 여전히 `World::action_binding(...)` 조회, fixed action id 선택, event sink push를 소유한다.
- primary/dash/melee fixed input path는 같은 helper를 사용해 spawnPrefab action이 기존 action id를 재사용할 때 false pattern mismatch telemetry를 내지 않는다.
- 새 helper는 `Option<ActionPatternKind>`를 받는 `const fn`이며 World, Entity, sink, allocation, JS/Wasm ABI를 추가하지 않는다.
- 회귀 테스트는 missing kind와 dash kind는 report, spawnPrefab kind는 suppress하는지 helper 레벨에서 고정하고, spawnPrefab이 primary/dash/melee fixed action id를 재사용하는 player path를 integration test로 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "spawnPrefab suppress guard의 pattern classification"은 공통 gameplay layer로 이동했다. trigger processing loop의 실제 실행 orchestration, projectile/spawnPrefab command scene-specific enrichment와 queue mutation, melee attack queue mutation/collision resolution, spawnPrefab placement query는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: spawnPrefab placement query helper slice

spawnPrefab placement blocking query를 `crate::gameplay` helper로 분리했다. 목표는 Shooter scene의 enemy prefab policy나 scratch storage ownership을 옮기는 것이 아니라, spawnPrefab pre-commit gate에서 사용하는 "placement collider를 만들고 tilemap obstacle contact scratch를 채운 뒤 blocked 여부를 반환한다"는 query operation을 공통 action layer에 고정하는 것이다.

- `spawn_prefab_placement_is_blocked_by_tilemap(...)`는 `Tilemap`, entity template, spawn transform, collision layer, reusable contact scratch를 받아 placement obstacle contact 여부를 반환한다.
- helper 내부에서 기존 `spawn_prefab_placement_collider(...)`를 사용하므로 template footprint와 collider offset/enabled/trigger/layer 정책은 기존 helper와 동일하다.
- Shooter runtime은 여전히 `PrefabSpawnCommand`의 template 선택, `CollisionLayer::Enemy` 선택, scratch `Vec<TilemapContactHit>` 소유, cooldown commit, queue mutation, event sink push를 소유한다.
- player input spawnPrefab path와 queued trigger spawnPrefab path는 같은 placement query helper를 사용한다.
- 새 helper는 Rust 내부 `pub(crate)` helper이며 JS/Wasm ABI, public API, heap allocation, dynamic dispatch를 추가하지 않는다. scratch buffer는 기존 `ShooterScene` storage를 재사용한다.
- 회귀 테스트는 helper가 blocked placement를 보고하고, 다음 query에서 scratch를 clear/reuse하는지 고정한다. 기존 player/queued trigger blocked-placement tests는 pre-commit gate behavior를 계속 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "spawnPrefab placement query operation"은 공통 gameplay layer로 이동했다. trigger processing loop의 실제 실행 orchestration, projectile/spawnPrefab command scene-specific enrichment와 queue mutation, melee attack queue mutation/collision resolution은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: bounded deferred spawn queue helper slice

Shooter pending spawn queue의 capacity check와 bounded push operation을 `crate::gameplay` helper로 분리했다. 목표는 `ShooterSpawnCommand` enum이나 spawn flush/spawn-now side effect를 공통 layer로 옮기는 것이 아니라, deferred command queue가 max pending limit을 넘지 않고 insertion order를 보존한다는 작은 queue mutation contract를 공통 action layer에 고정하는 것이다.

- `has_bounded_deferred_command_capacity(...)`는 caller-owned queue slice와 max pending 값을 받아 capacity 여부를 반환한다.
- `try_push_bounded_deferred_command(...)`는 caller-owned `Vec<T>`에 command를 push하되, max pending 이상이면 false를 반환하고 queue를 변경하지 않는다.
- Shooter runtime의 `queue_spawn_command(...)`와 `has_pending_spawn_capacity(...)`는 이 helper를 사용한다.
- `ShooterSpawnCommand`, projectile/prefab command shape, `MAX_PENDING_SPAWNS`, pending spawn storage ownership, spawn flush order, audio/gameplay event side effects는 계속 Shooter runtime이 소유한다.
- 새 helper는 Rust 내부 `pub(crate)` generic helper이며 JS/Wasm ABI, public API, dynamic dispatch를 추가하지 않는다. no-growth 성질은 caller가 `Vec::with_capacity(max_pending)`로 storage를 선할당할 때 보장되며, Shooter pending spawn queue는 기존 `with_capacity(64)` storage를 계속 재사용한다.
- 회귀 테스트는 helper가 capacity 전까지 insertion order를 보존하고, full queue에서는 false를 반환하며 queue를 변경하지 않는지, max pending `0`에서는 즉시 reject하는지, 선할당된 queue가 성공/실패 push 동안 capacity를 늘리지 않는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "spawn queue bounded capacity/push mutation"은 공통 gameplay layer로 이동했다. trigger processing loop의 실제 실행 orchestration, projectile/spawnPrefab command scene-specific enrichment와 spawn flush side effect, melee attack queue mutation/collision resolution은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: melee attack queue methodization slice

queued trigger melee와 player input melee가 `MeleeAttackCoreData`를 `MeleeAttackCommand`로 변환해 `pending_melee_attacks`에 push하던 중복을 `ShooterScene::queue_melee_attack(...)`으로 모았다. 목표는 melee collision resolution이나 queue capacity policy를 바꾸는 것이 아니라, scene-neutral melee core data를 scene runtime queue command로 적재하는 mutation boundary를 한 곳에 고정하는 것이다.

- `queue_melee_attack(...)`은 `MeleeAttackCoreData`를 받아 기존 `MeleeAttackCommand` 필드로 복사하고 기존 `pending_melee_attacks` storage에 push한다.
- queued trigger melee와 player input melee는 planning 성공 및 prepared action commit 성공 후 이 method를 호출한다.
- 기존 `pending_melee_attacks: Vec<_>`의 unbounded push semantics는 유지한다. `Vec::with_capacity(8)`은 soft cap이 아니라 allocation hint이므로 이 slice에서 `MAX_PENDING_MELEE_ATTACKS = 8` 같은 cap을 추가하지 않는다.
- melee queue full 실패 reason은 아직 public telemetry contract가 없으므로 `spawnQueueFull` reason을 재사용하지 않는다. 향후 cap을 도입하려면 capacity check는 cooldown commit 전에 실행하고, 별도 failure reason/TS mapping/문서를 함께 추가해야 한다.
- 회귀 테스트는 기존 queued trigger melee와 player input melee 경로가 attack command 필드, cooldown commit, collision outcome을 유지하는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "melee attack command queue mutation"은 Shooter runtime method boundary로 모였지만 아직 공통 gameplay layer로 이동하지는 않았다. trigger processing loop의 실제 실행 orchestration, projectile/spawnPrefab command scene-specific enrichment와 spawn flush side effect, melee attack collision resolution은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: projectile spawn command enrichment method slice

projectile action planner가 만든 `ProjectileSpawnCoreData`에 Shooter scene의 texture/template/faction/arc/audio metadata를 붙여 `ProjectileSpawnCommand`로 만드는 중복을 `ShooterScene::projectile_spawn_command_from_core_data(...)`로 모았다. 목표는 projectile planning이나 spawn queue/flush side effect를 바꾸는 것이 아니라, scene-neutral projectile core data를 scene-specific spawn command로 enrich하는 경계를 spawn runtime에 고정하는 것이다.

- player input projectile과 queued trigger projectile은 각각 source별 aim/plan을 만든 뒤 같은 enrichment method를 사용한다.
- enrichment method는 bullet texture id, bullet template, source gameplay faction, projectile arc policy, shoot sound id/volume/pitch를 기존 규칙 그대로 채운다.
- projectile arc 생성은 source entity의 queued 시점 `HeightSpan`을 사용하며, height span이 없으면 기존 기본 floor/elevation/height fallback을 유지한다.
- `ProjectileSpawnCommand`, pending spawn queue, spawn flush, actual `World::spawn_bullet_from_request(...)`, audio push는 계속 Shooter spawn runtime이 소유한다.
- 회귀 테스트는 enrichment method가 `ProjectileSpawnCoreData` 필드와 scene metadata, source faction, arc/audio policy를 보존하는지 고정한다.
- 서브에이전트 리뷰에서 legacy projectile fallback이 input 없이 발사될 수 있는 주변 회귀를 발견해, authored primary binding이 없을 때도 `space` 또는 `mouse_left` 입력이 active인 경우에만 fallback projectile을 queue하도록 guard를 복구했다. 회귀 테스트는 inactive input이 pending spawn/cooldown을 바꾸지 않고, fire input은 기존 fallback을 유지하는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "projectile command scene-specific enrichment"는 Shooter spawn runtime method boundary로 모였다. trigger processing loop의 실제 실행 orchestration, spawnPrefab command scene-specific enrichment와 spawn flush side effect, melee attack collision resolution은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: spawnPrefab command enrichment method slice

spawnPrefab action planner가 만든 `SpawnPrefabCoreData`에 Shooter scene의 enemy texture/template/health/score metadata를 붙여 `PrefabSpawnCommand`로 만드는 변환을 `ShooterScene::prefab_spawn_command_from_core_data(...)`로 모았다. 목표는 prefab support/anchor/phase/source transform planning이나 placement/capacity/cooldown 순서를 바꾸는 것이 아니라, scene-neutral prefab core data를 scene-specific spawn command로 enrich하는 경계를 spawn runtime에 고정하는 것이다.

- player input spawnPrefab과 queued trigger spawnPrefab은 기존 `spawn_prefab_command(...)` planning 경로를 유지하되, 최종 command enrichment는 `prefab_spawn_command_from_core_data(...)`를 사용한다.
- enrichment method는 enemy texture id, enemy template, active enemy health, active score reward를 기존 규칙 그대로 채운다.
- prefab id support, source-relative transform planning, tilemap placement pre-commit gate, pending spawn capacity, cooldown commit, `prefabSpawned` event push는 기존 위치에 남겨 failure precedence를 유지한다.
- `PrefabSpawnCommand`, pending spawn queue, spawn flush, actual `World::spawn_enemy_from_template(...)`, gameplay event push는 계속 Shooter spawn runtime이 소유한다.
- 회귀 테스트는 enrichment method가 `SpawnPrefabCoreData` 필드와 scene enemy metadata를 보존하는지, active wave의 health/score override를 사용하는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "spawnPrefab command scene-specific enrichment"는 Shooter spawn runtime method boundary로 모였다. trigger processing loop의 실제 실행 orchestration, spawn flush side effect, melee attack collision resolution은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: melee collision live predicate helper slice

pending melee collision resolution에서 attacker/target이 현재 처리 가능한 live entity인지 판단하는 layer/marked-despawn policy를 `crate::gameplay` helper로 분리했다. 목표는 melee query, damage, score, GameOver, audio/VFX/tween side effect를 공통화하는 것이 아니라, queued/player melee가 공유하는 "이미 despawn marked이거나 target layer가 맞지 않으면 resolution을 스킵한다"는 작은 eligibility contract를 공통 gameplay layer에 고정하는 것이다.

- `melee_attack_query_mask(...)`는 attack target별 collision query mask를 `Enemies` -> `CollisionMask::ENEMY`, `Player` -> `CollisionMask::PLAYER`로 고정한다.
- `melee_attack_attacker_can_resolve(...)`는 attack target이 `Enemies`이면 attacker가 live Player layer인지 확인하고, `Player`이면 기존 queued trigger 의미처럼 live entity이면 허용한다. marked despawn 또는 out-of-range mark storage는 false다.
- `melee_attack_target_can_receive_hit(...)`는 `Enemies` target은 live Enemy layer, `Player` target은 live Player layer만 허용하고 marked despawn이면 false다.
- Shooter combat은 이 helper를 사용해 pending melee command의 attacker precheck, enemy hit filter, player hit filter를 처리한다.
- circle query scratch, damage/health mutation, score/despawn queue, GameOver, collision/gameplay event, audio/VFX/tween side effects는 계속 `combat.rs`가 소유한다.
- 회귀 테스트는 player-target/enemy-target layer policy, out-of-range mark storage fail-closed, marked despawn skip을 helper 레벨에서 고정하고, 같은 frame의 후속 melee attack이 이미 marked된 enemy를 다시 score 처리하지 않는 combat call-site 동작을 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "melee collision query target mask"와 "melee collision live eligibility policy"는 `crate::gameplay`로 이동했다. 이후 melee collision query execution도 helper boundary로 이동했지만, trigger processing loop의 실제 실행 orchestration, spawn flush side effect, melee damage/score/GameOver/presentation side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: melee enemy default damage helper slice

pending melee enemy hit에서 health damage와 lethal target deferred-despawn queue mutation을 기존 `apply_default_collision_damage_hit(...)` 공통 helper로 연결했다. 목표는 melee hit presentation이나 score/event/audio/VFX/tween side effect를 공통화하는 것이 아니라, "source는 보존하고 target만 lethal 시 deferred despawn으로 mark한다"는 기본 damage mutation contract를 projectile default hit와 같은 helper에 태우는 것이다.

- `combat.rs`는 melee enemy hit마다 target live eligibility를 먼저 확인한 뒤 `apply_default_collision_damage_hit(..., despawn_source = false, despawn_target_on_kill = true, ...)`를 호출한다.
- `default_collision_damage_gameplay_event_payload(...)`는 default damage outcome에서 gameplay damage event payload를 만들며, target removal 여부는 `killed`가 아니라 `target_removed` 필드를 source of truth로 사용한다.
- `target_only_default_collision_damage_hit_presentation_payload(...)`는 default damage outcome에서 collision hit event/audio/particle presentation payload를 만든다. melee 기존 동작을 보존하기 위해 particle position은 target transform만 사용하고 source transform fallback은 하지 않는다.
- collision hit event, gameplay damage event, score 증가, hit particle, enemy flash tween, hit audio는 계속 Shooter combat이 소유한다.
- gameplay helper 회귀 테스트는 source를 보존하면서 killed target만 pending despawn에 들어가는 contract, damage gameplay event payload의 `target_removed` source of truth, target-transform-only presentation payload를 고정한다.
- combat call-site 회귀 테스트는 같은 frame의 후속 melee attack이 이미 marked된 enemy를 다시 score 처리하지 않는 동작, custom score reward, melee damage gameplay event의 target-removed flag를 계속 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "melee enemy default damage/target-despawn state mutation", "melee default damage gameplay event payload construction", "melee default damage hit presentation payload construction"은 `crate::gameplay` helper 경계로 이동했다. 이후 melee collision query execution도 helper boundary로 이동했지만, trigger processing loop의 실제 실행 orchestration, spawn flush side effect, score commit, GameOver, collision/gameplay event push, audio/VFX/tween sink side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: collision gameplay event sink payload method slice

`CollisionGameplayEventPayload`를 실제 `GameplayEventSink` 메서드 호출로 변환하는 glue를 `ShooterScene::push_collision_gameplay_event(...)`에서 `GameplayEventSink::push_collision_payload(...)`로 옮겼다. 목표는 event sink push/dedupe 정책을 공통 gameplay layer로 이동하는 것이 아니라, payload 생성은 `crate::gameplay`, payload commit은 Shooter runtime sink가 담당한다는 경계를 더 명확히 하는 것이다.

- `Damage`, `Despawn`, `PickupCollected` payload는 기존 `push_collision_damage(...)`, `push_collision_despawn(...)`, `push_pickup_collected(...)` 메서드로 그대로 위임한다.
- `CollisionGameplayEventPayload::Despawn`의 중복 제거 정책은 기존 `GameplayEventSink::push_collision_despawn(...)`에 남아 있다.
- `combat.rs`는 authored reaction과 melee default damage path에서 payload 생성 결과를 sink에 전달만 한다.
- 회귀 테스트는 `push_collision_payload(...)`가 damage/pickup payload 필드와 despawn dedupe 정책을 보존하는지 고정한다.

이 slice 이후 action/collision 쪽 남은 Shooter compatibility 책임 중 "collision gameplay event payload -> sink method dispatch"는 `GameplayEventSink` method boundary로 이동했다. 이후 melee collision query execution도 helper boundary로 이동했지만, trigger processing loop의 실제 실행 orchestration, spawn flush side effect, score commit, GameOver, collision event push, audio/VFX/tween sink side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: default damage score delta helper slice

default damage outcome에서 "죽은 target이면 score reward를 더한다"는 score delta 계산을 `default_collision_damage_score_delta(...)`로 분리했다. 목표는 scene score field mutation을 공통 gameplay layer로 옮기는 것이 아니라, projectile default damage와 melee default damage가 공유하는 data-only score 계산 정책을 같은 helper로 고정하는 것이다.

- helper는 `DefaultCollisionDamageHitOutcome`을 받아 `killed == true`이면 `score_reward`, 아니면 `0`을 반환한다.
- Shooter `combat.rs`는 helper 결과를 받아 score field에 commit한다. 이 slice 시점에는 직접 `saturating_add`를 호출했지만, 이후 score commit helper slice에서 commit arithmetic도 `commit_score_delta(...)`로 모았다.
- enemy hit flash 여부는 score delta가 아니라 기존 의미인 `outcome.killed` flag를 계속 사용한다. 따라서 score reward가 0인 lethal enemy도 "죽은 target"으로 처리되고 hit flash fallback을 타지 않는다.
- 회귀 테스트는 killed/non-killed/unrewarded-kill score delta를 고정하고, melee/projectile score path 집중 테스트로 기존 score commit 경로를 확인한다.

이 slice 이후 action/collision 쪽 남은 Shooter compatibility 책임 중 "default damage score delta calculation"은 `crate::gameplay` helper 경계로 이동했다. 이후 score commit arithmetic, score owner field write, melee collision query execution도 helper 경계로 이동했지만, trigger processing loop의 실제 실행 orchestration, spawn flush side effect, GameOver, collision hit event/audio/VFX/tween sink side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: collision hit presentation sink payload method slice

`CollisionHitPresentationPayload`를 실제 `CollisionEventSink` hit event로 변환하는 glue를 `CollisionEventSink::push_hit_payload(...)`로 모았다. 목표는 hit presentation payload 생성이나 audio/particle/tween side effect를 옮기는 것이 아니라, 이미 계산된 hit payload를 collision event buffer/count에 commit하는 책임을 sink method boundary로 고정하는 것이다.

- `push_hit_payload(...)`는 payload의 `source`, `target`, `damage`만 기존 `push_hit(...)`로 위임한다.
- `emit_audio`와 `particle_position`은 collision event sink가 해석하지 않는다. hit audio와 particle/tween sink 호출은 기존처럼 Shooter combat path에 남아 있다.
- Shooter `combat.rs`의 melee default hit path와 projectile/enemy hit presentation path는 payload를 만든 뒤 `CollisionEventSink`에 전달만 한다.
- 회귀 테스트는 hit payload가 collision event kind/id/generation/damage/count로 보존되는지 고정한다.

이 slice 이후 action/collision 쪽 남은 Shooter compatibility 책임 중 "collision hit presentation payload -> collision event sink dispatch"는 `CollisionEventSink` method boundary로 이동했다. 이후 score commit arithmetic, score owner field write, melee collision query execution도 helper 경계로 이동했지만, trigger processing loop의 실제 실행 orchestration, spawn flush side effect, GameOver, audio/VFX/tween sink side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: hit particle presentation sink payload method slice

`CollisionHitPresentationPayload`의 hit particle 위치를 실제 `ParticleBurstSink` 호출로 변환하는 glue를 `ParticleBurstSink::spawn_hit_payload(...)`로 모았다. 목표는 particle preset lookup과 spawn side effect를 공통 gameplay layer로 이동하는 것이 아니라, 이미 계산된 hit presentation payload를 Shooter runtime particle sink가 소비하는 경계를 고정하는 것이다.

- `spawn_hit_payload(...)`는 payload의 `particle_position`만 읽고, 위치가 있으면 기존 `spawn_at(...)`으로 위임한다.
- `particle_position == None`이면 `0`을 반환하며 particle을 만들지 않는다.
- `emit_audio`, `source`, `target`, `damage`는 particle sink가 해석하지 않는다. hit audio, collision event, tween 처리는 기존 sink/method 경계에 남아 있다.
- Shooter `combat.rs`의 melee default hit path와 projectile/enemy hit presentation path는 payload를 만든 뒤 particle sink에 전달만 한다.
- 회귀 테스트는 particle position이 있는 payload만 hit preset burst를 만들고, position 없는 payload는 spawn하지 않는지 고정한다.

이 slice 이후 action/collision 쪽 남은 Shooter compatibility 책임 중 "hit presentation payload -> particle sink dispatch"는 `ParticleBurstSink` method boundary로 이동했다. 이후 score commit arithmetic, score owner field write, melee collision query execution도 helper 경계로 이동했지만, trigger processing loop의 실제 실행 orchestration, spawn flush side effect, GameOver, audio/tween sink side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: hit audio presentation helper slice

`CollisionHitPresentationPayload`의 `emit_audio` 플래그를 실제 `AudioEvent` push로 변환하는 glue를 `push_hit_audio_event(...)`로 모았다. 목표는 audio event buffer 소유권이나 sound id 정책을 공통 gameplay layer로 옮기는 것이 아니라, 이미 계산된 hit presentation payload를 Shooter runtime audio helper가 소비하는 경계를 고정하는 것이다.

- `push_hit_audio_event(...)`는 payload의 `emit_audio`만 읽고, true이면 기존 `push_audio_event(...)`로 위임한다.
- `emit_audio == false`이면 audio event를 만들지 않는다.
- 기존 `push_audio_event(...)`의 `DEFAULT_SOUND_ID` skip 정책은 그대로 유지한다.
- `source`, `target`, `damage`, `particle_position`은 audio helper가 해석하지 않는다. collision event, particle, tween 처리는 기존 sink/method 경계에 남아 있다.
- Shooter `combat.rs`의 melee default hit path와 projectile/enemy hit presentation path는 payload를 만든 뒤 audio helper에 전달만 한다.
- 회귀 테스트는 `emit_audio`와 `DEFAULT_SOUND_ID` skip만 audio emission을 결정하고, 다른 hit payload 필드는 audio emission에 영향을 주지 않는지 고정한다. melee default hit call-site도 non-default hit sound는 1개 audio event를 만들고, default sound id는 audio를 만들지 않는지 고정했다.

이 slice 이후 action/collision 쪽 남은 Shooter compatibility 책임 중 "hit presentation payload -> audio event dispatch"는 Shooter runtime helper boundary로 이동했다. 이후 score commit arithmetic, score owner field write, melee collision query execution도 helper 경계로 이동했지만, trigger processing loop의 실제 실행 orchestration, spawn flush side effect, GameOver, tween sink side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: hit tween presentation helper slice

`CollisionHitPresentationPayload`의 target entity를 enemy hit flash tween으로 변환하는 glue를 `TweenSink::flash_enemy_hit_payload(...)`로 모았다. 목표는 tween system이나 sprite tint policy를 공통 gameplay layer로 옮기는 것이 아니라, 이미 계산된 hit presentation payload를 Shooter runtime tween sink가 소비하는 경계를 고정하는 것이다.

- `flash_enemy_hit_payload(...)`는 payload의 `target`만 enemy hit flash 대상으로 사용하고, 기존 `flash_enemy_hit(...)`로 위임한다.
- `source`, `damage`, `emit_audio`, `particle_position`은 tween sink가 해석하지 않는다. collision event, gameplay event, audio, particle 처리는 기존 sink/helper 경계에 남아 있다.
- lethal hit인지 여부는 계속 combat path가 판단한다. 즉 killed target에는 기존처럼 hit flash tween을 만들지 않는다.
- player-target melee와 GameOver path는 hit presentation payload가 없는 별도 game-over audio/transition 경로로 유지한다.
- Shooter `combat.rs`의 melee default hit path와 projectile/enemy hit presentation path는 payload를 만든 뒤 tween sink에 전달만 한다.
- 회귀 테스트는 payload target만 flash 대상이 되고 source sprite는 변경되지 않는지, non-lethal bullet/enemy hit가 combat call-site에서 1개 tween을 만들며, bullet/melee zero-reward kill이 tween을 만들지 않는지 고정한다.

이 slice 이후 action/collision 쪽 남은 Shooter compatibility 책임 중 "hit presentation payload -> tween sink dispatch"는 `TweenSink` method boundary로 이동했다. 이후 score commit arithmetic, score owner field write, melee collision query execution도 helper 경계로 이동했지만, trigger processing loop의 실제 실행 orchestration, spawn flush side effect, GameOver는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: score commit helper slice

Shooter combat path에 흩어진 `self.score = self.score.saturating_add(...)`를 `commit_score_delta(...)` helper로 모았다. 목표는 score ownership을 `crate::gameplay`로 옮기는 것이 아니라, collision/action 결과에서 나온 점수 delta를 commit할 때 사용하는 saturating arithmetic policy를 한 곳에 고정하는 것이다.

- `commit_score_delta(score, delta)`는 `u32::saturating_add`만 수행한다.
- helper는 `GameState`, `World`, `ShooterScene`을 알지 않는다. 따라서 GameOver, pickup despawn, enemy reward attribution 같은 장르별 정책은 기존 runtime path에 남아 있다.
- melee default damage, projectile default damage, authored collision summary, pickup reaction, legacy pickup fallback score commit은 모두 helper를 경유한다.
- 회귀 테스트는 helper의 zero/non-zero/saturation policy와 대표 score 경로인 bullet/enemy kill, authored collision, pickup collection, 실제 pickup combat path saturation을 고정한다.

이 slice 이후 action/collision 쪽 남은 Shooter compatibility 책임 중 "score field commit arithmetic"은 `crate::gameplay` helper boundary로 이동했다. 이후 melee collision query execution과 score owner field write도 helper/method boundary로 이동했지만, trigger processing loop의 실제 실행 orchestration, spawn flush side effect, GameOver state transition/audio policy는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: score owner field commit boundary slice

`combat.rs`가 `&mut self.score`를 직접 들고 `crate::gameplay::commit_score_delta(...)`를 호출하던 경로를 `ShooterScene::commit_score_delta(...)` 내부 method로 모았다. 이 slice는 score arithmetic policy를 바꾸지 않고, Shooter scene이 score field를 소유한다는 사실을 runtime boundary 안으로 숨기는 범위다.

- `ShooterScene::commit_score_delta(delta)`는 기존 `crate::gameplay::commit_score_delta(&mut self.score, delta)`로 위임한다.
- melee default damage, projectile default damage, authored collision summary, pickup reaction, legacy pickup fallback score commit은 모두 scene method를 경유한다.
- method는 `World`, `GameState`, collision/audio/event sink를 알지 않는다. 따라서 score attribution, pickup despawn, gameplay event emission, GameOver policy는 기존 call-site 책임으로 유지된다.
- snapshot save/restore, reset, test setup처럼 scene lifecycle 자체가 score field를 설정하는 경로는 이 compatibility slice 범위가 아니다.
- 회귀 테스트는 scene method의 zero/non-zero/saturation behavior와 대표 combat 경로인 bullet/enemy score, pickup saturation을 고정한다.

이 slice 이후 action/collision 쪽 남은 Shooter compatibility 책임 중 "score owner field write"는 Shooter runtime method boundary로 이동했다. trigger processing loop의 실제 실행 orchestration, spawn flush side effect, melee collision query execution, GameOver state transition/audio policy는 이후 helper boundary로 더 좁혔지만 아직 일부 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: GameOver state transition helper slice

Shooter combat path에 흩어진 `GameState::GameOver` 직접 write를 `ShooterScene::enter_game_over()` 내부 helper로 모았다. 목표는 GameOver policy를 공통 gameplay layer로 옮기는 것이 아니라, Shooter scene의 GameOver 전환이 idempotent하게 한 번만 성공한다는 상태 전환 primitive를 runtime boundary에 고정하는 것이다.

- `enter_game_over()`는 현재 state가 `GameOver`이면 `false`, 아니면 state를 `GameOver`로 바꾸고 `true`를 반환한다.
- helper는 audio event, collision event, damage, score, despawn queue를 알지 않는다. game-over audio emission과 event push 여부는 기존 collision call-site가 계속 결정한다.
- player-target melee, bullet/player collision, player/enemy fallback collision은 helper의 반환값으로 기존 "첫 GameOver 전환에만 audio/event push" 의미를 유지한다.
- authored collision summary의 player game-over 결과도 helper를 경유한다. authored path는 `enter_game_over()` 반환값을 별도 outcome wrapper로 caller에 전달해, repeated collision frame에서 default game-over audio가 중복 emit되지 않게 한다.
- authored `replaceDefault` audio policy 자체는 이후 `should_emit_default_game_over_audio(...)` helper로 분리했으며, `enter_game_over()` helper는 여전히 audio replacement 의미를 알지 않는다.
- 회귀 테스트는 helper의 first-transition-only 반환값, 기존 game-over audio once behavior, triggered melee player GameOver/no-score behavior, authored lethal player/enemy collision의 repeated default game-over audio one-shot behavior를 고정한다.

이 slice 이후 action/collision 쪽 남은 Shooter compatibility 책임 중 "GameOver state transition idempotency"는 Shooter runtime helper boundary로 이동했다. 이후 melee collision query execution도 helper boundary로 이동했지만, trigger processing loop의 실제 실행 orchestration, spawn flush side effect, GameOver audio/default emission construction은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: GameOver audio event helper slice

GameOver audio event 생성도 `combat.rs` 직접 필드 조합에서 `runtime/effects.rs` helper로 좁게 옮겼다. 이 slice는 GameOver transition, authored `replaceDefault` 판정, collision event push 순서를 바꾸지 않고, `sound_ids.game_over`와 `ShooterAudioPolicy::{game_over_volume, game_over_pitch}`를 `AudioEvent`로 만드는 책임만 모은다.

- `push_game_over_audio_event(...)`는 기존 `push_audio_event(...)`로 위임하므로 `DEFAULT_SOUND_ID` skip, SFX channel, volume/pitch payload 의미가 그대로 유지된다.
- player-target melee, bullet/player collision, player/enemy authored/fallback GameOver path는 모두 같은 helper를 사용한다.
- helper는 `enter_game_over()`를 호출하지 않고, authored `replaceDefault` policy도 판단하지 않는다. "언제 emit할지"는 기존 call-site가 담당하고, "어떤 GameOver audio payload를 emit할지"만 helper가 담당한다.
- 회귀 테스트는 helper의 policy volume/pitch 적용과 default sound skip, 기존 GameOver audio once behavior, authored repeated lethal collision one-shot behavior를 고정한다.

이 slice 이후 action/collision 쪽 남은 Shooter compatibility 책임 중 "GameOver audio/default emission construction"은 runtime effects helper boundary로 이동했다. 이후 GameOver audio/default emission gating, authored replacement 판단, melee collision query execution도 helper boundary로 이동했지만, trigger processing loop의 실제 실행 orchestration과 spawn flush side effect는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: GameOver default audio gating helper slice

GameOver default audio를 emit할지 결정하는 data-only 판단도 `crate::gameplay` helper로 옮겼다. 이 slice는 `GameState` 전환이나 `AudioEvent` 생성 책임을 옮기지 않고, 이미 계산된 `game_over_entered` bool과 optional authored collision outcome summary를 바탕으로 default GameOver audio emission 여부만 결정한다.

- `should_emit_default_game_over_audio(game_over_entered, authored_outcome)`는 `game_over_entered == true`이고 `default_collision_presentation_policy(authored_outcome).emit_audio == true`일 때만 true를 반환한다.
- non-authored melee/player, bullet/player, player/enemy fallback path는 `enter_game_over()` 결과를 helper에 넘겨 기존 one-shot audio/event 의미를 유지한다.
- authored player/enemy lethal collision path는 기존 `AuthoredCollisionReactionOutcome::game_over_entered`와 summary를 helper에 넘긴다. 따라서 repeated lethal contact와 authored `replaceDefault` audio suppression이 같은 data-only gate를 통과한다.
- helper는 `GameState`, `ShooterScene`, `AudioEvent`, sound id, volume/pitch를 알지 않는다. `enter_game_over()`와 `push_game_over_audio_event(...)`는 계속 Shooter runtime/effects boundary에 남아 있다.
- 회귀 테스트는 transition bool, authored replace-default-audio, replace-default-particle-only 조합을 고정하고, 기존 authored GameOver default one-shot, authored damage+sound replacement, side-effect-only replacement fallback 경로를 함께 검증한다.

이 slice 이후 action/collision 쪽 남은 Shooter compatibility 책임 중 "GameOver audio/default emission gating과 authored replacement 판단"은 `crate::gameplay` data-only helper boundary로 이동했다. 이후 melee collision query execution도 `crate::gameplay` helper boundary로 이동했지만, trigger processing loop의 실제 실행 orchestration, spawn flush side effect, collision phase ownership, particle preset lookup, 장르별 default effect 종류 선택은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: melee collision query execution helper slice

pending melee collision resolution에서 실제 circle query 호출을 `run_melee_attack_query(...)` helper로 좁혔다. 목표는 melee damage, score, GameOver, event/audio/particle/tween side effect를 공통화하는 것이 아니라, melee attack command가 만든 center/range/target/height span을 어떤 collision query로 실행하는지에 대한 scene-neutral 경계를 `crate::gameplay`에 고정하는 것이다.

- `run_melee_attack_query(...)`는 `CollisionSystem::circle_query_with_height_span_into(...)`를 감싸고, target별 layer mask는 기존 `melee_attack_query_mask(target)` helper를 사용한다.
- helper는 caller가 넘긴 `Vec<CircleQueryHit>` scratch buffer를 그대로 재사용한다. 따라서 기존 `self.melee_hits` 기반 per-swing allocation 회피 정책을 유지한다.
- `HeightSpan` 필터링은 기존 collision query에 그대로 위임한다. helper는 height policy를 새로 해석하지 않는다.
- enemy-target pending melee와 player-target pending melee가 모두 같은 helper를 사용한다.
- damage/score/GameOver, collision/gameplay event push, audio/VFX/tween sink side effect, hit iteration order와 live eligibility filter는 계속 Shooter combat path가 소유한다.
- 회귀 테스트는 helper가 target mask를 적용하고 hit buffer를 재사용하며 `HeightSpan` filter를 그대로 위임하는지 고정한다. 기존 pending melee enemy hit event와 player-target GameOver path 테스트로 call-site 동작도 함께 확인한다.

이 slice 이후 action/collision 쪽 남은 Shooter compatibility 책임 중 "melee collision query execution"은 `crate::gameplay` helper boundary로 이동했다. trigger processing loop의 실제 실행 orchestration, spawn flush side effect, melee damage/score/GameOver/presentation side effects, collision phase ownership, particle preset lookup, 장르별 default effect 종류 선택은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: action trigger phase collection helper slice

queued action trigger processing loop의 begin/filter/finish orchestration을 `collect_action_triggers_for_phase(...)` helper로 좁혔다. 목표는 trigger별 action 실행 본문을 공통화하는 것이 아니라, `ActionTriggerQueue`의 pending/processing swap, phase filter, processing buffer clear 순서를 queue storage와 같은 `crate::gameplay` layer에 고정하는 것이다.

- `collect_action_triggers_for_phase(...)`는 `ActionTriggerQueue<ActionTriggerCommand>`에서 현재 phase에 맞는 command를 caller-owned scratch `Vec<ActionTriggerCommand>`로 복사한다.
- helper는 processing buffer를 닫은 뒤 반환하므로, runtime의 per-trigger pattern dispatch 중 새로 queue되는 trigger는 기존 pending buffer에 남아 다음 처리 시점으로 넘어간다.
- `ShooterScene`은 `action_trigger_commands` scratch buffer를 보유해 pre-physics trigger list 수집에 재사용한다.
- trigger별 `prepare_any_action_payload_if_ready(...)`, pattern dispatch, cooldown commit, failure event push, projectile/dash/melee/spawnPrefab 실행은 계속 Shooter action runtime이 소유한다.
- reset/snapshot restore는 `action_triggers`와 함께 `action_trigger_commands` scratch도 clear해 stale entity handle이 transient scratch에 남지 않게 한다.
- 회귀 테스트는 helper가 phase command 순서를 보존하고 processing queue를 drain하며 scratch capacity를 재사용하는지 고정한다. 기존 action trigger queue bounded/frame-local 테스트로 call-site 동작도 함께 확인한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "trigger queue begin/phase collection/finish orchestration"은 `crate::gameplay` helper boundary로 이동했다. per-trigger pattern dispatch와 scene-specific command enrichment/queue mutation, spawn flush side effect는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: deferred spawn flush drain helper slice

Shooter pending spawn flush에서 queue drain/order/scratch reuse를 `drain_deferred_commands_into(...)` helper로 좁혔다. 목표는 projectile/prefab spawn side effect를 공통화하는 것이 아니라, deferred command queue를 flush 대상 scratch buffer로 옮기고 원 queue를 비우는 작은 command-buffer contract를 `crate::gameplay` layer에 고정하는 것이다.

- `drain_deferred_commands_into(queue, commands)`는 caller-owned pending queue를 caller-owned scratch `Vec`으로 이동하고, 기존 scratch 내용을 먼저 clear한다.
- helper는 command 순서를 보존하고 pending queue capacity와 scratch capacity를 재사용한다.
- `ShooterScene`은 `spawn_commands` scratch buffer를 보유해 `pending_spawns` drain 결과를 재사용한다.
- `flush_pending_spawns_with_events(...)`는 drain 이후 scratch command list를 순회하며 기존 `spawn_projectile_now(...)`, `spawn_prefab_now(...)`, shoot audio, `prefabSpawned` event side effect를 그대로 실행한다.
- reset/snapshot restore는 `pending_spawns`와 함께 `spawn_commands` scratch도 clear해 transient spawn command가 world reset/restore 경계 밖으로 남지 않게 한다.
- 회귀 테스트는 generic helper의 order/drain/scratch reuse를 고정하고, 기존 authored player spawnPrefab flush와 wave-enter spawnPrefab flush 테스트로 call-site 동작을 확인한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "spawn flush queue drain/order/scratch reuse"는 `crate::gameplay` helper boundary로 이동했다. actual projectile/prefab entity spawn, shoot audio emission, `prefabSpawned` event push, per-trigger pattern dispatch와 scene-specific command enrichment/queue mutation은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: prefab spawned event payload helper slice

spawnPrefab flush 성공 시 생성되는 `prefabSpawned` gameplay event의 payload construction을 `prefab_spawned_event_payload(...)`로 좁혔다. 목표는 actual prefab entity spawn이나 event buffer ownership을 공통화하는 것이 아니라, spawned actor/source/prefab id/action id를 어떤 telemetry payload로 해석하는지 `crate::gameplay` data helper에 고정하는 것이다.

- `PrefabSpawnedEventPayload`는 `spawned`, `source`, `prefab_id`, `action_id`만 가진 data-only payload다.
- `prefab_spawned_event_payload(...)`는 actual spawn 결과 entity와 spawn command metadata를 event payload로 결합한다.
- `GameplayEventSink::push_prefab_spawned_payload(...)`는 payload를 기존 `GameplayEvent::prefab_spawned(...)`로 commit한다.
- `flush_pending_spawns_with_events(...)`는 prefab entity spawn 후 payload helper와 sink method를 사용한다.
- projectile spawn, prefab entity creation, shoot audio emission, event buffer ownership은 계속 Shooter spawn/effects runtime이 소유한다.
- 회귀 테스트는 payload field 보존, sink dispatch 결과의 ABI field mapping, 기존 authored player spawnPrefab flush path를 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "`prefabSpawned` event payload construction/dispatch glue"는 `crate::gameplay` helper와 `GameplayEventSink` method boundary로 이동했다. actual projectile/prefab entity spawn, shoot audio emission, per-trigger pattern dispatch와 scene-specific command enrichment/queue mutation은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: action trigger dispatch preparation helper slice

queued action trigger 한 건을 실제 payload별 실행으로 넘기기 전에 필요한 readiness/payload/failure-event 준비를 `prepare_action_trigger_for_dispatch(...)` helper로 좁혔다. 목표는 dash/projectile/melee/spawnPrefab의 실행 본문을 공통화하는 것이 아니라, trigger source/action id가 어떤 준비 결과로 해석되는지 `crate::gameplay` layer에 고정하는 것이다.

- `PreparedActionTrigger`는 원 trigger, commit 가능한 `PreparedAction`, typed `PreparedActionPayload`를 하나의 dispatch-ready value object로 묶는다.
- `ActionTriggerPreparation`은 `Ready`, `Failure(ActionFailureEventData)`, `Noop`으로 준비 결과를 표현한다.
- helper는 기존 `prepare_any_action_payload_if_ready(...)`와 `ActionAttemptFailurePolicy`를 사용해 missing/cooling-down 같은 readiness 실패를 `ActionFailureEventData`로 변환한다.
- Shooter `process_action_trigger(...)`는 helper 결과를 받아 failure event를 push하거나, ready payload의 variant별 실행 method로 넘기는 역할만 남긴다.
- helper는 cooldown commit, world mutation, spawn queue mutation, dash transform write, projectile/melee command queue mutation을 수행하지 않는다. 따라서 실제 side effect 순서와 per-pattern 실행 정책은 기존 Shooter runtime path가 유지한다.
- 회귀 테스트는 ready typed payload가 cooldown을 commit하지 않는지, generic/silent failure policy가 failure event 또는 noop으로 변환되는지, 기존 queued trigger cooling-down telemetry가 유지되는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "per-trigger readiness/payload/failure preparation"은 `crate::gameplay` helper boundary로 이동했다. payload variant match, scene-specific command enrichment/queue mutation, actual projectile/prefab entity spawn, shoot audio emission은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: gameplay timer dispatch helper slice

timer component가 elapsed 되었을 때 생성되는 gameplay event와 optional action trigger command의 공통 의미를 `GameplayTimerDispatch`로 묶었다. 목표는 timer producer가 action queue를 직접 소유하게 만드는 것이 아니라, timer tick 결과를 event/action command로 해석하는 data boundary를 `crate::gameplay`에 고정하는 것이다.

- `GameplayTimerDispatch`는 `source`, `timer_id`, `duration_seconds`, optional `action_id`를 가진다.
- `tick_gameplay_timer_trigger_for_dispatch(...)`는 `GameplayTimerTrigger::tick(...)`을 단 한 번 호출하고, elapsed frame에만 dispatch payload를 반환한다.
- `GameplayTimerDispatch::event()`는 기존 `GameplayEvent::timer(...)` mapping을 보존한다.
- `GameplayTimerDispatch::action_trigger()`는 optional non-zero action id만 `ActionTriggerCommand::timer(...)`로 변환한다. `timerId == actionId` 같은 암묵 매핑은 여전히 만들지 않는다.
- action 없는 generic engine timer path와 Shooter timer-action path가 같은 helper를 사용한다.
- `GameplayEventSink::push_timer_dispatch(...)`는 dispatch payload를 timer event로 commit한다. Shooter timer producer는 dispatch를 event sink와 action queue에 나누어 전달하되, queue full failure event와 action execution은 기존 Shooter action runtime에 남긴다.
- 회귀 테스트는 dispatch가 timer event/action command를 보존하고 zero action id를 command로 만들지 않는지, 기존 timer-driven spawnPrefab runtime이 같은 frame에 `timer -> prefabSpawned` event를 유지하는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "timer elapsed result -> timer event/action trigger data mapping"은 `crate::gameplay` helper와 `GameplayEventSink` method boundary로 이동했다. timer action queue full failure push, payload variant match, scene-specific command enrichment/queue mutation, actual spawn side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: action trigger failure event data helper slice

queued action trigger 실행/producer 경로에서 반복되던 `actor == source == trigger.source`, `token == trigger.action_id` failure event payload 조립을 `action_trigger_failure_event_data(...)`와 `action_trigger_queue_full_event_data(...)`로 좁혔다. 목표는 action trigger queue 소유권이나 queue full 정책을 공통화하는 것이 아니라, trigger 기반 실패 telemetry의 subject/action mapping을 `crate::gameplay` data helper에 고정하는 것이다.

- `action_trigger_failure_event_data(trigger, reason_code)`는 trigger source를 actor/source 양쪽에 쓰고 trigger action id를 token으로 쓰는 기존 mapping을 보존한다.
- `action_trigger_queue_full_event_data(trigger)`는 queue full reason code를 같은 mapping으로 감싼다.
- `prepare_action_trigger_for_dispatch(...)`의 readiness failure, Shooter timer action trigger queue full, wave action trigger queue full, queued dash/projectile/melee/spawnPrefab failure paths가 helper를 사용한다.
- helper는 queue capacity 검사, queue mutation, cooldown commit, action execution, spawn side effect를 수행하지 않는다.
- 회귀 테스트는 helper의 subject/action/reason mapping, 기존 bounded action trigger queue failure telemetry, wave-enter spawnPrefab trigger success path를 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "trigger-sourced action failure event payload construction"은 `crate::gameplay` helper boundary로 이동했다. queue full 발생 시점 판단, queue mutation, payload variant match, scene-specific command enrichment/queue mutation, actual spawn side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: action trigger queue result helper slice

`ActionTriggerQueue<ActionTriggerCommand>`가 queue full 여부와 failure payload를 함께 반환하는 `queue_action_trigger(...) -> Result<(), ActionFailureEventData>` helper를 갖도록 했다. 목표는 trigger producer의 실행 정책을 공통화하는 것이 아니라, 이미 `crate::gameplay`가 소유한 bounded action trigger queue의 enqueue/failure-result 계약을 queue 타입 안으로 모으는 것이다.

- helper는 기존 `queue(command)`와 같은 pending queue/capacity를 사용한다.
- enqueue 성공 시 `Ok(())`를 반환하고, queue full이면 queue를 변경하지 않은 채 `action_trigger_queue_full_event_data(command)`를 반환한다.
- Shooter timer action producer와 wave action producer는 bool 결과와 별도 failure payload 조립 대신 helper의 `Err(data)`를 event sink에 전달한다.
- 기존 `ShooterScene::queue_action_trigger(...) -> bool` wrapper는 테스트 호환 surface로 유지한다.
- helper는 event buffer push, cooldown commit, action execution, spawn side effect를 수행하지 않는다.
- 회귀 테스트는 queue full 시 pending queue가 변하지 않고 failure data만 반환되는지, 기존 timer/wave trigger runtime이 유지되는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "bounded action trigger enqueue 실패 판정과 queue-full failure data 반환"은 `ActionTriggerQueue<ActionTriggerCommand>` helper boundary로 이동했다. 실패 event push, payload variant match, scene-specific command enrichment/queue mutation, actual spawn side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: state-enter action trigger enqueue result surface slice

Engine runtime의 behavior state-enter action producer가 queue full failure payload를 직접 조립하지 않고, ShooterScene의 `queue_action_trigger_result(...) -> Result<(), ActionFailureEventData>` surface와 `action_failure_gameplay_event(...)` helper를 사용하도록 좁혔다. 목표는 behavior state-enter producer를 Shooter runtime 밖으로 완전히 일반화하는 것이 아니라, Engine-owned producer가 queue full의 subject/action/reason mapping과 raw event construction 세부사항을 반복하지 않게 하는 것이다.

- `action_failure_gameplay_event(data)`는 `ActionFailureEventData`를 raw `GameplayEvent::action_failed(...)`로 변환하는 단일 helper다.
- `GameplayEventSink::push_action_failure(...)`와 Engine behavior state-enter producer는 같은 helper를 통해 action failure event를 만든다.
- `ShooterScene::queue_action_trigger_result(...)`는 기존 bounded queue helper를 노출하고, 기존 `queue_action_trigger(...) -> bool` wrapper는 테스트 호환 surface로 유지한다.
- Engine behavior state-enter producer는 frame loop 안에서 별도 command `Vec`를 만들지 않고, behavior state changed event 구간을 인덱스 기반으로 복사해 즉시 enqueue한다.
- helper는 scene active 여부 판단, behavior event scan, queue capacity 자체, cooldown commit, action execution, spawn side effect를 수행하지 않는다.
- 회귀 테스트는 raw failure event field mapping, scene-level result wrapper의 queue full failure data, Engine state-enter producer가 queue cap 초과 시 `actionFailed` event를 직접 기록하는 통합 실패 경로를 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "Engine-side state-enter action producer의 bounded enqueue 실패 결과 surface"는 ShooterScene wrapper/helper boundary로 이동했다. behavior state-enter action producer의 event scan과 active-scene guard, payload variant match, scene-specific command enrichment/queue mutation, actual spawn side effects는 아직 runtime compatibility path에 남아 있다.

### 2026-06-02: prepared action trigger payload dispatcher slice

queued trigger 실행에서 `PreparedActionPayload` variant match를 Shooter runtime method가 직접 소유하지 않고, `crate::gameplay`의 `dispatch_prepared_action_trigger(...)` helper와 `PreparedActionTriggerDispatcher` trait로 좁혔다. 목표는 action 실행 전체를 scene-neutral로 옮기는 것이 아니라, "준비된 action trigger payload를 어느 실행 branch로 보낼지"라는 taxonomy dispatch를 gameplay boundary에 고정하는 것이다.

- `PreparedActionTriggerDispatcher`는 projectile/dash/melee/spawnPrefab trigger dispatch method만 요구한다.
- `dispatch_prepared_action_trigger(...)`는 `PreparedActionTrigger`의 payload variant를 match하고, trigger/prepared/payload를 해당 dispatcher method로 전달한다.
- Shooter runtime은 `ShooterActionTriggerDispatchContext`로 world/tilemap/event sink를 보유하고, 실제 scene-specific command enrichment/queue mutation은 기존 method에 위임한다.
- helper는 readiness 판정, cooldown commit, queue capacity 검사, command enrichment, spawn side effect를 수행하지 않는다.
- 회귀 테스트는 projectile/dash/melee/spawnPrefab payload가 각각 대응 dispatcher branch로 전달되는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "queued trigger prepared payload variant dispatch"는 `crate::gameplay` helper boundary로 이동했다. scene-specific command enrichment/queue mutation, failure event push, actual spawn side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: action trigger failure push helper slice

queued trigger 실행 branch에서 반복되던 `trigger + reason_code -> ActionFailureEventData -> sink push` glue를 `crate::gameplay`의 `push_action_trigger_failure_event(...)` helper로 좁혔다. 목표는 failure 발생 조건이나 scene-specific 실행을 공통화하는 것이 아니라, trigger-sourced failure event push의 subject/action/reason mapping을 한 경계에서 사용하게 하는 것이다.

- `push_action_trigger_failure_event(sink, trigger, reason_code)`는 기존 `action_trigger_failure_event_data(...)` mapping으로 data를 만들고 sink가 있을 때만 push한다.
- queue-full reason도 `push_action_trigger_failure_event(sink, trigger, GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL)`로 같은 mapping을 탄다.
- Shooter queued melee/projectile/dash/spawnPrefab failure branches는 직접 `ActionFailureEventData`를 조립하지 않고 helper를 호출한다.
- helper는 failure 조건 판정, queue capacity 검사, cooldown commit, command enrichment, spawn side effect를 수행하지 않는다.
- 회귀 테스트는 sink가 없을 때 no-op인지, trigger source/action id와 queue-full reason mapping이 보존되는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "trigger-sourced failure event push glue"는 `crate::gameplay` helper boundary로 이동했다. scene-specific command enrichment/queue mutation과 actual spawn side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: queued projectile spawn command boundary slice

queued projectile trigger 경로의 `target-player plan -> ProjectileSpawnCoreData -> ProjectileSpawnCommand` adapter를 action runtime 파일에서 spawn runtime boundary로 이동했다. 목표는 projectile spawn side effect를 공통화하는 것이 아니라, scene-neutral projectile core data에 Shooter texture/template/faction/arc/audio metadata를 붙이는 command enrichment 책임을 spawn runtime 모듈에 고정하는 것이다.

- `ShooterScene::projectile_spawn_command_toward_player(...)`는 `spawn.rs`에 위치하며, source transform/player target/half extents를 읽어 projectile plan을 만들고 `projectile_spawn_command_from_core_data(...)`로 command를 완성한다.
- queued trigger action runtime은 command 생성 결과와 reason code만 받아 capacity gate, cooldown commit, queue mutation을 처리한다.
- `actions.rs`는 `ProjectileSpawnCommand` 타입과 projectile plan/core-data helper를 직접 import하지 않는다.
- helper는 queue capacity 검사, cooldown commit, pending spawn queue mutation, flush, actual bullet spawn/audio push를 수행하지 않는다.
- 회귀 테스트는 target-player plan 결과와 Shooter scene-specific command fields(texture/template/audio/collision policy)가 유지되는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "queued projectile command scene-specific enrichment"는 spawn runtime method boundary로 이동했다. projectile queue mutation과 actual spawn side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: spawnPrefab command boundary slice

player input과 queued trigger 양쪽에서 공유하던 `spawn_prefab_command(...)` adapter를 player runtime 파일에서 spawn runtime boundary로 이동했다. 목표는 prefab spawn side effect를 공통화하는 것이 아니라, `SpawnPrefabActionPayload` planning과 `SpawnPrefabCoreData -> PrefabSpawnCommand` scene metadata enrichment가 spawn command 모듈에 모이도록 하는 것이다.

- `ShooterScene::spawn_prefab_command(...)`는 `spawn.rs`에 위치하며, prefab support 판정, source transform 기반 plan, core data 생성, Shooter enemy metadata enrichment를 수행한다.
- command boundary는 field list가 아니라 `SpawnPrefabActionPayload`를 받아 anchor/phase/offset 확장 시 인자 순서 drift 위험을 줄인다.
- player input과 queued trigger runtime은 같은 command adapter를 호출하고, capacity/placement/cooldown/queue mutation 정책은 기존 호출 위치에서 유지한다.
- `player.rs`는 spawnPrefab planning/core-data helper와 `PrefabSpawnCommand` 타입을 직접 import하지 않는다.
- helper는 queue capacity 검사, tile placement 검사, cooldown commit, pending spawn queue mutation, flush, actual enemy spawn/event push를 수행하지 않는다.
- 회귀 테스트는 source-relative prefab plan과 Shooter scene-specific command fields(texture/template/health/score)가 유지되는지 고정한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "spawnPrefab command scene-specific enrichment"는 spawn runtime method boundary로 이동했다. spawnPrefab placement/capacity gate, queue mutation, actual spawn side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: spawn queue push result boundary slice

Shooter pending spawn queue push API가 `bool` 대신 `Result<(), reason_code>`를 반환하도록 좁혔다. 목표는 pending spawn storage나 flush side effect를 공통 gameplay system으로 옮기는 것이 아니라, projectile/spawnPrefab queue mutation이 실패할 때 public gameplay failure vocabulary의 `spawnQueueFull` reason으로 고정되도록 하는 것이다.

- `queue_projectile_spawn(...)`와 `queue_prefab_spawn(...)`는 내부 `queue_spawn_command(...)`를 통해 bounded push를 실행하고, full이면 `GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL`을 반환한다.
- player input과 queued trigger runtime은 cooldown commit 전에 기존 capacity/placement gate를 유지하고, commit 후 queue push는 항상 실행한다. 반환 결과만 debug assertion으로 "사전 gate 통과 후 push 성공" 불변식을 고정해 release build에서도 side effect가 유지되도록 한다.
- legacy projectile fallback은 기존처럼 queue push 성공 여부를 boolean으로 사용하되, 내부 API의 실패 reason mapping은 spawn boundary에 남긴다.
- 회귀 테스트는 projectile/prefab push 성공 시 pending count 증가, full 상태에서 reason code 반환 및 queue 무변경, queued projectile full 경로의 cooldown 미소비와 `actionFailed(spawnQueueFull)` event를 고정한다.
- helper는 cooldown commit, failure event push, placement query, flush, actual bullet/enemy spawn을 수행하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "spawn queue push full reason mapping"은 spawn runtime method boundary로 명시됐다. projectile/spawnPrefab pre-commit admission orchestration과 actual spawn side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: projectile spawn admission helper slice

projectile action의 `capacity gate -> cooldown commit -> pending spawn queue push` 순서를 `ShooterScene::commit_projectile_spawn_with_pre_commit_gate(...)`로 묶었다. 목표는 trigger/input별 실패 event shape를 공통화하는 것이 아니라, projectile queue admission의 side-effect 순서를 spawn runtime boundary에 고정하는 것이다.

- helper는 pending spawn capacity를 cooldown commit 전에 검사하고, full이면 `GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL`을 반환하며 commit closure를 호출하지 않는다.
- capacity가 있으면 caller가 전달한 commit closure를 실행한다. closure가 `true`를 반환한 경우에만 projectile command를 pending spawn queue에 넣는다.
- closure가 `false`를 반환하면 queue mutation 없이 `Ok(false)`를 반환한다. 이 경로는 commit token이 이미 다른 이유로 소진되었거나 caller policy가 no-op을 선택하는 경우를 보존한다.
- player input과 queued trigger runtime은 같은 helper를 사용하되, `actionFailed(...)` event construction은 기존 call site에 남겨 producer별 actor/source/action id shape를 유지한다.
- 회귀 테스트는 success commit 후 queue 증가, commit false 시 queue 무변경, queue full 시 commit closure 미호출과 queue 무변경을 고정한다.
- helper는 projectile command construction, failure event push, flush, actual bullet spawn/audio push를 수행하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "projectile pre-commit admission order"는 spawn runtime method boundary로 이동했다. spawnPrefab admission orchestration과 actual spawn side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: spawnPrefab admission helper slice

spawnPrefab action의 `capacity gate -> placement gate -> cooldown commit -> pending spawn queue push` 순서를 `ShooterScene::commit_prefab_spawn_with_pre_commit_gate(...)`로 묶었다. 목표는 input/trigger별 실패 event shape를 공통화하는 것이 아니라, prefab spawn admission의 gate precedence와 side-effect 순서를 spawn runtime boundary에 고정하는 것이다.

- helper는 pending spawn capacity를 cooldown commit 전에 먼저 검사하고, full이면 `GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL`을 반환한다.
- capacity가 있으면 tilemap placement query를 실행한다. blocked placement면 `GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT`를 반환하고 commit closure를 호출하지 않는다.
- gate가 모두 통과하면 caller가 전달한 commit closure를 실행한다. closure가 `true`를 반환한 경우에만 prefab command를 pending spawn queue에 넣는다.
- player input과 queued trigger runtime은 같은 helper를 사용하되, `actionFailed(...)` event construction은 기존 call site에 남겨 producer별 actor/source/action id shape를 유지한다.
- 회귀 테스트는 success commit 후 queue 증가, commit false 시 queue 무변경, blocked placement 시 commit 미호출, queue full이 blocked placement보다 우선하는 것을 고정한다. queued trigger와 player input integration도 full+blocked 동시 조건에서 `spawnQueueFull` event와 cooldown 미소비를 확인한다.
- helper는 prefab command construction, failure event push, flush, actual enemy spawn/gameplay event push를 수행하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "spawnPrefab pre-commit admission orchestration"은 spawn runtime method boundary로 이동했다. actual spawn side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: prefab spawned command payload boundary slice

spawn flush loop 안에서 `PrefabSpawnCommand` field를 직접 풀어 `prefab_spawned_event_payload(...)`에 넘기던 glue를 `prefab_spawned_payload_from_command(...)`로 좁혔다. 목표는 actual enemy spawn이나 gameplay event sink ownership을 공통화하는 것이 아니라, spawned entity와 prefab command metadata가 `prefabSpawned` telemetry payload로 결합되는 mapping을 spawn runtime boundary에 고정하는 것이다.

- `prefab_spawned_payload_from_command(spawned, command)`는 spawned actor, command source, prefab id, action id를 기존 `prefab_spawned_event_payload(...)` helper에 전달한다.
- `flush_pending_spawns_with_events(...)`는 prefab spawn side effect 이후 이 helper 결과를 `GameplayEventSink::push_prefab_spawned_payload(...)`에 넘긴다.
- 회귀 테스트는 spawned entity와 command source/prefab id/action id가 payload에 그대로 보존되는지 고정한다.
- helper는 actual entity spawn, event sink push, queue drain/order, projectile audio emission을 수행하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "`prefabSpawned` command metadata -> payload mapping"은 spawn runtime helper boundary로 이동했다. actual spawn side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: projectile spawn request mapping boundary slice

projectile flush side effect 안에서 `ProjectileSpawnCommand` field를 직접 풀어 `BulletSpawnRequest`를 만들던 glue를 `bullet_spawn_request_from_projectile_command(...)`로 좁혔다. 목표는 actual bullet entity spawn, projectile arc write, shoot audio emission을 공통화하는 것이 아니라, deferred projectile command가 world spawn request로 투영되는 mapping을 spawn runtime boundary에 고정하는 것이다.

- `bullet_spawn_request_from_projectile_command(command)`는 transform, velocity, texture, lifetime, template, damage, collision target, tile impact, source faction을 기존 `BulletSpawnRequest` field로 전달한다.
- `spawn_projectile_now(...)`는 이 helper 결과를 `World::spawn_bullet_from_request(...)`에 넘긴 뒤 기존처럼 projectile arc와 shoot audio side effect를 처리한다.
- 회귀 테스트는 projectile command의 spawn 관련 field가 request에 그대로 보존되는지 고정한다. arc와 audio field는 world spawn request가 아니라 side-effect field이므로 request mapping 테스트 범위에서 제외한다.
- helper는 actual entity spawn, projectile arc write, audio event push, queue drain/order를 수행하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "`ProjectileSpawnCommand` -> `BulletSpawnRequest` mapping"은 spawn runtime helper boundary로 이동했다. actual projectile spawn side effects와 shoot audio emission은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: prefab enemy spawn data mapping boundary slice

prefab flush side effect 안에서 `PrefabSpawnCommand` field를 직접 풀어 `World::spawn_enemy_from_template(...)`에 넘기던 glue를 `prefab_enemy_spawn_data_from_command(...)`로 좁혔다. 목표는 actual enemy entity spawn이나 `prefabSpawned` telemetry emission을 공통화하는 것이 아니라, deferred prefab command가 enemy spawn data로 투영되는 mapping을 spawn runtime boundary에 고정하는 것이다.

- `prefab_enemy_spawn_data_from_command(command)`는 transform, texture, template, health, score reward를 enemy spawn data로 전달한다.
- `spawn_prefab_now(...)`는 이 helper 결과를 `World::spawn_enemy_from_template(...)`에 넘기며, 기존처럼 spawned `Entity`를 반환한다.
- 회귀 테스트는 prefab command의 enemy spawn 관련 field가 data에 그대로 보존되는지, 그리고 actual spawn helper가 Enemy layer entity에 transform/texture/template-derived sprite size/health/score reward를 적용하는지 고정한다. source/action id/prefab id는 `prefabSpawned` telemetry metadata이므로 enemy spawn data mapping 범위에서 제외한다.
- helper는 actual entity spawn, gameplay event push, queue drain/order를 수행하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "`PrefabSpawnCommand` -> enemy spawn data mapping"은 spawn runtime helper boundary로 이동했다. actual enemy spawn side effect와 `prefabSpawned` telemetry emission은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: spawn command dispatch result boundary slice

spawn flush loop가 projectile/prefab command variant match와 side-effect result 조립을 직접 소유하던 구조를 `dispatch_spawn_command(...) -> SpawnCommandDispatchResult` 경계로 좁혔다. 목표는 actual spawn side effect를 공통 gameplay system으로 옮기는 것이 아니라, deferred spawn command 실행 결과 중 gameplay event로 이어지는 payload를 명시적인 internal result로 표현하는 것이다.

- `dispatch_spawn_command(world, audio_events, command)`는 projectile command면 기존처럼 bullet spawn, projectile arc write, shoot audio push를 수행하고 `prefab_spawned: None`을 반환한다.
- prefab command면 기존처럼 enemy spawn을 수행하고 `prefab_spawned_payload_from_command(...)` 결과를 `prefab_spawned: Some(...)`으로 반환한다.
- `flush_pending_spawns_with_events(...)`는 drain/order와 optional `GameplayEventSink` push를 유지하되, command variant별 actual spawn dispatch는 helper에 위임한다.
- 회귀 테스트는 projectile dispatch가 bullet/audio side effect를 만들고 prefab payload를 반환하지 않는지, prefab dispatch가 enemy spawn 이후 `prefabSpawned` payload를 반환하고 shoot audio를 만들지 않는지, mixed projectile→prefab pending queue flush가 command order를 유지해 bullet id 뒤에 prefab-spawned enemy id를 만드는지 고정한다.
- helper는 queue drain/order, event sink push, pending queue mutation을 수행하지 않는다. actual spawn/audio side effect는 아직 Shooter spawn runtime helper가 수행한다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "deferred spawn command dispatch result"는 spawn runtime helper boundary로 이동했다. actual projectile/prefab spawn side effects와 shoot audio emission은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: projectile shoot audio data boundary slice

projectile spawn side effect 안에서 `ProjectileSpawnCommand`의 shoot audio field를 직접 풀어 `push_audio_event(...)`에 넘기던 glue를 `projectile_shoot_audio_data_from_command(...)`와 `push_projectile_shoot_audio_event(...)`로 좁혔다. 목표는 audio event buffer 소유권이나 sound id 정책을 공통화하는 것이 아니라, deferred projectile command의 shoot audio metadata가 기존 Shooter audio helper로 전달되는 경계를 명시하는 것이다.

- `projectile_shoot_audio_data_from_command(command)`는 sound id, volume, pitch만 `ProjectileShootAudioData`로 투영한다.
- `push_projectile_shoot_audio_event(...)`는 기존 `push_audio_event(...)`로 위임하므로 `DEFAULT_SOUND_ID` skip, SFX channel, volume/pitch 의미가 그대로 유지된다.
- `spawn_projectile_now(...)`는 bullet spawn과 optional projectile arc write 이후 이 helper로 shoot audio를 push한다. 기존 side-effect 순서인 bullet spawn -> arc write -> shoot audio push는 유지한다.
- 회귀 테스트는 command audio field mapping, default sound id skip 정책, non-default audio event payload와 SFX channel, 기존 projectile spawn side-effect 경로를 고정한다.
- helper는 actual projectile entity spawn, projectile arc write, queue drain/order, event sink push를 수행하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "projectile shoot audio metadata -> AudioEvent push boundary"는 spawn runtime helper boundary로 이동했다. actual projectile/prefab entity spawn side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: collision hit presentation dispatch result boundary slice

collision phase 안에서 `CollisionHitPresentationPayload`를 collision event sink와 hit particle sink에 각각 직접 push하던 반복 glue를 `dispatch_collision_hit_presentation_payload(...) -> CollisionHitPresentationDispatchResult` 경계로 묶었다. 목표는 collision phase ownership이나 장르별 default effect 선택을 공통 system으로 옮기는 것이 아니라, 이미 계산된 hit presentation payload가 관측/시각 feedback sink로 전달되는 방식을 명시적인 runtime helper result로 고정하는 것이다.

- helper는 collision event sink가 있으면 `CollisionEventSink::push_hit_payload(...)`를 먼저 호출하고, particle sink가 있으면 `ParticleBurstSink::spawn_hit_payload(...)`를 호출한다.
- 반환값은 `collision_event_pushed`와 `particles_spawned`를 담아, 이후 dry-run/telemetry 진단에서 "payload는 생성됐지만 sink가 없어서 관측되지 않음" 같은 상태를 분리할 수 있게 했다.
- melee enemy hit와 bullet enemy hit 경로는 같은 helper를 사용한다. gameplay event push, score commit, tween flash, hit audio push의 기존 순서는 유지했다.
- 회귀 테스트는 event+particle sink가 모두 있을 때 hit count/event damage/particle burst count가 보존되는지, sink가 없을 때 result가 no-op으로 보고되는지 고정한다.
- helper는 hit presentation payload 생성, gameplay event dispatch, audio event push, tween dispatch, damage/despawn state mutation을 수행하지 않는다.

이 slice 이후 action/collision 쪽 남은 Shooter compatibility 책임 중 "collision hit presentation payload -> collision event/particle sink dispatch"는 runtime helper result boundary로 이동했다. collision phase ownership, particle preset 선택 정책, hit audio/tween dispatch, actual damage/despawn side effects는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: hit audio dispatch result boundary slice

`push_hit_audio_event(...)`가 단순 side-effect helper에서 `HitAudioDispatchResult`를 반환하도록 조정했다. 목표는 audio event buffer 소유권이나 sound id 정책을 공통화하는 것이 아니라, 이미 계산된 `CollisionHitPresentationPayload`가 실제 hit audio event로 이어졌는지 runtime helper result로 구분하는 것이다.

- 반환값은 `audio_event_pushed`만 가진다. `emit_audio: false` 또는 `DEFAULT_SOUND_ID` skip이면 `false`, 실제 `AudioEvent`가 push되면 `true`다.
- 기존 call site의 side-effect 순서와 audio buffer push 정책은 그대로 유지했다. melee enemy hit와 bullet enemy hit 경로는 기존처럼 반환값을 사용하지 않고 side effect만 소비한다.
- 회귀 테스트는 muted payload, default sound id skip, 실제 non-default hit audio push의 결과값과 SFX channel/audio payload를 함께 고정한다.
- helper는 game-over audio, projectile shoot audio, authored collision sound side effect, audio event buffer 소유권을 변경하지 않는다.

이 slice 이후 hit audio presentation dispatch는 "payload -> audio event push 여부"를 내부 result로 관측할 수 있게 됐다. collision phase ownership, sound id selection, game-over/projectile/authored side-effect audio는 아직 각 Shooter runtime helper path에 남아 있다.

### 2026-06-02: collision gameplay event dispatch result boundary slice

`GameplayEventSink::push_collision_payload(...)`가 `CollisionGameplayEventDispatchResult`를 반환하도록 조정했다. 목표는 gameplay event buffer 소유권이나 event schema를 바꾸는 것이 아니라, collision reaction payload가 실제 frame-end `GameplayEvent`로 push됐는지 runtime sink result로 구분하는 것이다.

- 반환값은 `event_pushed`만 가진다. `Damage`와 `PickupCollected`는 기존처럼 event를 push하면 `true`를 반환한다.
- `Despawn`은 기존 per-frame dedupe 정책을 그대로 따른다. 첫 `collisionDespawn` push는 `true`, 같은 actor/source 중복 despawn payload는 event를 추가하지 않고 `false`를 반환한다.
- 기존 call site는 반환값을 사용하지 않으므로 side-effect 순서와 event buffer 내용은 그대로 유지된다.
- 회귀 테스트는 damage/despawn/duplicate despawn/pickup payload별 결과와 기존 event shape를 함께 고정한다.
- helper는 action failure, interaction, prefab spawned, timer, pickup direct push, replay/TS decoder schema를 변경하지 않는다.

이 slice 이후 collision gameplay event payload dispatch는 "payload 처리 -> 실제 event 추가 여부"를 내부 result로 관측할 수 있게 됐다. collision phase ownership, event buffer 소유권, public GameplayEvent ABI, replay decoder는 기존 경계에 남아 있다.

### 2026-06-02: hit tween dispatch result boundary slice

`TweenSink::flash_enemy_hit_payload(...)`가 bool 대신 `HitTweenDispatchResult`를 반환하도록 조정했다. 목표는 tween system이나 sprite tint policy를 공통 gameplay layer로 옮기는 것이 아니라, 이미 계산된 `CollisionHitPresentationPayload`가 실제 enemy hit tween 시작으로 이어졌는지 runtime sink result로 구분하는 것이다.

- 반환값은 `tween_started`만 가진다. payload target에 sprite tint tween을 시작하면 `true`, target이 missing/stale/non-tweenable이거나 tween capacity로 거부되면 기존 `flash_enemy_hit(...)` 실패 의미를 그대로 `false`로 반환한다.
- 기존 call site는 반환값을 사용하지 않으므로 melee enemy hit와 bullet enemy hit의 side-effect 순서와 tween start policy는 그대로 유지된다.
- 회귀 테스트는 payload의 `target`만 tween 대상으로 사용하고 `source` tint는 변경하지 않는지, missing target이면 tween을 만들지 않고 `tween_started: false`를 반환하는지 고정한다.
- helper는 tween capacity policy, tint/easing/duration 값, render command generation, damage/despawn state mutation을 변경하지 않는다.

이 slice 이후 hit tween presentation dispatch는 "payload -> tween start 여부"를 내부 result로 관측할 수 있게 됐다. collision phase ownership, target 선택 정책, tween storage 소유권은 기존 Shooter runtime sink boundary에 남아 있다.

### 2026-06-02: projectile actual spawn dispatch result boundary slice

`spawn_projectile_now(...)`가 actual bullet spawn side effect를 실행한 뒤 `ProjectileSpawnDispatchResult`를 반환하도록 조정했다. 목표는 projectile spawn side effect를 공통 gameplay system으로 옮기는 것이 아니라, deferred projectile command가 실제 world entity와 arc write로 이어진 결과를 spawn runtime helper result로 명시하는 것이다.

- result는 `spawned` bullet entity와 `arc_applied` bool을 가진다. command에 arc가 있으면 bullet spawn 이후 기존처럼 `World::set_projectile_arc(...)`를 호출하고 `arc_applied: true`를 반환한다.
- `dispatch_spawn_command(...)`는 projectile command 실행 결과를 `SpawnCommandDispatchResult.projectile_spawned`에 담는다. 기존 flush call site는 아직 이 값을 소비하지 않으므로 event/audio side-effect 순서는 유지된다.
- 기존 side-effect 순서인 bullet spawn -> optional arc write -> shoot audio push는 유지했다.
- 회귀 테스트는 direct spawn helper가 spawned entity와 arc 적용 여부를 반환하고, dispatch helper가 projectile result를 반환하면서 prefab payload는 만들지 않는지 고정한다.
- helper는 queue drain/order, pending queue mutation, gameplay event push, prefab enemy spawn, shoot audio result 관측을 수행하지 않는다.

이 slice 이후 actual projectile spawn side effect는 "command -> spawned bullet entity/arc write result"를 내부 result로 관측할 수 있게 됐다. projectile spawn 자체, audio emission, prefab actual spawn side effect, flush result 소비 정책은 아직 Shooter spawn runtime compatibility path에 남아 있다.

### 2026-06-02: prefab actual spawn dispatch result boundary slice

`spawn_prefab_now(...)`가 actual enemy spawn side effect를 실행한 뒤 `PrefabSpawnDispatchResult`를 반환하도록 조정했다. 목표는 prefab spawn side effect를 공통 gameplay system으로 옮기는 것이 아니라, deferred prefab command가 실제 world entity로 이어진 결과와 `prefabSpawned` telemetry payload construction을 spawn runtime result 경계에서 분리하는 것이다.

- result는 `spawned` enemy entity를 가진다. 기존 `World::spawn_enemy_from_template(...)` 호출과 enemy template/health/score reward 적용 순서는 유지했다.
- `dispatch_spawn_command(...)`는 prefab command 실행 결과를 `SpawnCommandDispatchResult.prefab_spawn`에 담고, 같은 spawned entity와 command metadata로 기존 `PrefabSpawnedEventPayload`를 만든다.
- projectile dispatch와 prefab dispatch는 서로 다른 result field를 채운다. projectile command는 `projectile_spawned: Some`, `prefab_spawn: None`, `prefab_spawned: None`이고, prefab command는 `projectile_spawned: None`, `prefab_spawn: Some`, `prefab_spawned: Some`이다.
- 기존 flush call site는 아직 `prefab_spawned` telemetry payload만 소비하므로 gameplay event side-effect 순서는 유지된다.
- 회귀 테스트는 direct prefab spawn helper가 spawned entity를 반환하고, dispatch helper가 actual prefab spawn result와 telemetry payload의 spawned entity를 일치시키는지 고정한다.
- helper는 queue drain/order, pending queue mutation, projectile spawn/audio, gameplay event sink push, prefab spawn result 소비 정책을 변경하지 않는다.

이 slice 이후 actual prefab spawn side effect는 "command -> spawned enemy entity result"를 내부 result로 관측할 수 있게 됐다. spawn flush result 소비 정책과 actual spawn side effect의 공통 gameplay system 승격은 아직 Shooter spawn runtime compatibility path에 남아 있다.

### 2026-06-02: spawn flush result consumption policy slice

spawn flush loop가 `SpawnCommandDispatchResult.prefab_spawned`를 직접 검사해 event sink에 push하던 정책을 `consume_spawn_command_dispatch_result(...) -> SpawnFlushResultConsumption` 경계로 분리했다. 목표는 spawn side effect나 queue drain 순서를 바꾸는 것이 아니라, flush phase가 어떤 dispatch result를 runtime telemetry로 소비하는지 명시하는 것이다.

- `SpawnFlushResultConsumption`은 현재 flush phase가 `prefabSpawned` gameplay event를 실제로 push했는지만 반환한다.
- projectile actual spawn result와 prefab actual spawn result는 dispatch result 안에 남지만, flush phase에서는 gameplay event로 소비하지 않는다.
- event sink가 없으면 prefab payload가 있어도 event push result는 `false`가 되며, 이는 기존 `flush_pending_spawns(...)` test compatibility path의 동작과 같다.
- 회귀 테스트는 prefab payload가 있을 때만 `prefabSpawned` event가 push되고, projectile dispatch result는 gameplay event를 추가하지 않으며, event sink 부재 시 payload가 있어도 push되지 않는 정책을 고정한다.
- helper는 pending queue drain/order, actual projectile/prefab spawn side effect, shoot audio emission, event ABI를 변경하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "spawn flush result 소비 정책"은 spawn runtime helper boundary로 이동했다. actual spawn side effect의 공통 gameplay system 승격과 flush result telemetry 확대 여부는 아직 별도 결정으로 남아 있다.

### 2026-06-02: spawn flush aggregate telemetry result slice

spawn flush phase가 command별 dispatch/consumption result만 만들고 끝나던 구조를 `SpawnFlushResult` aggregate result로 확장했다. 목표는 spawn side effect를 공통 gameplay system으로 옮기는 것이 아니라, 한 flush phase가 실제로 drain/dispatch/telemetry push한 결과를 agent 진단과 dry-run 검증에서 읽을 수 있는 내부 카운터로 남기는 것이다.

- `flush_pending_spawns(...)`와 `flush_pending_spawns_with_events(...)`는 `SpawnFlushResult`를 반환한다. 기존 call site는 이 값을 무시하므로 world mutation, audio/event push 순서는 유지된다.
- `SpawnFlushResult`는 `commands_drained`, `projectile_spawns`, `projectile_arcs_applied`, `prefab_spawns`, `prefab_spawned_payloads`, `prefab_spawned_events_pushed`를 담는다.
- result는 `dispatch_spawn_command(...)`의 projectile/prefab spawn 결과와 `consume_spawn_command_dispatch_result(...)`의 event push 결과를 누적한다.
- event sink가 없는 compatibility path에서도 prefab payload 생성 수와 실제 event push 수를 분리해 보고한다.
- 회귀 테스트는 mixed projectile→prefab flush가 기존 spawn/audio/event 순서를 유지하면서 aggregate result를 반환하는지, event sink가 없는 flush도 spawn/payload count는 보고하고 event push count는 0으로 남기는지 고정한다.
- helper는 pending queue drain/order, actual projectile/prefab spawn side effect, shoot audio emission, `prefabSpawned` event ABI를 변경하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "flush result telemetry 확대 여부"는 spawn runtime aggregate result boundary로 이동했다. actual spawn side effect의 공통 gameplay system 승격은 아직 별도 결정으로 남아 있다.

### 2026-06-02: actual spawn entity side-effect gameplay helper slice

deferred spawn command가 실제 `World` entity 생성으로 이어지는 핵심 side effect를 `crate::gameplay` helper 경계로 이동했다. 목표는 Shooter command orchestration이나 audio/event sink ownership을 바꾸는 것이 아니라, projectile/prefab spawn의 실제 entity mutation을 장르별 runtime 밖에서도 검증 가능한 Rust gameplay helper로 분리하는 것이다.

- `ProjectileEntitySpawnData`/`ProjectileEntitySpawnResult`와 `spawn_projectile_entity(...)`를 추가해 `BulletSpawnRequest` 기반 bullet 생성과 optional projectile arc 적용을 공통 helper로 묶었다.
- `PrefabEnemyEntitySpawnData`/`PrefabEnemyEntitySpawnResult`와 `spawn_prefab_enemy_entity(...)`를 추가해 enemy prefab entity 생성, transform/template/health/score reward 적용을 공통 helper로 묶었다.
- Shooter `spawn_projectile_now(...)`는 command -> `BulletSpawnRequest` mapping과 shoot audio emission을 계속 소유하고, actual bullet/arc world mutation만 `spawn_projectile_entity(...)`에 위임한다.
- Shooter `spawn_prefab_now(...)`는 command -> enemy spawn data mapping과 `prefabSpawned` metadata construction을 계속 소유하고, actual enemy world mutation만 `spawn_prefab_enemy_entity(...)`에 위임한다.
- 회귀 테스트는 common gameplay helper가 bullet layer/transform/velocity/arc/height span과 enemy layer/transform/health/score reward를 적용하는지, 기존 Shooter spawn helper가 동일 결과를 유지하는지 고정한다.
- helper는 deferred queue drain/order, spawn command enrichment, projectile shoot audio emission, `prefabSpawned` event ABI, gameplay event sink push를 변경하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "actual projectile/prefab entity spawn side effect"는 `crate::gameplay` helper boundary로 이동했다. Shooter spawn runtime에는 command enrichment, shoot audio, prefab metadata/event push orchestration이 남아 있다.

### 2026-06-02: spawn command dispatch enum contract slice

deferred spawn command dispatch 결과를 여러 `Option` field 조합이 아니라 `SpawnCommandDispatchResult::Projectile(...)` / `SpawnCommandDispatchResult::Prefab(...)` enum으로 정리했다. 목표는 spawn side effect나 flush 순서를 바꾸는 것이 아니라, 한 command가 projectile 또는 prefab 중 하나의 결과만 만들 수 있다는 사실을 타입 계약으로 고정하는 것이다.

- projectile dispatch는 actual projectile spawn result만 반환하고, prefab metadata payload를 가질 수 없다.
- prefab dispatch는 actual prefab spawn result의 `spawned` entity로 `prefabSpawned` telemetry payload를 만든 뒤, 그 payload 하나만 enum variant에 담는다. spawned entity를 중복 보관해 서로 어긋나는 상태를 만들지 않는다.
- `SpawnFlushResult::record_dispatch(...)`와 `consume_spawn_command_dispatch_result(...)`는 enum `match`로 variant를 소비한다. prefab payload가 없는 prefab dispatch 같은 상태는 더 이상 테스트 fixture로 만들지 않는다.
- 회귀 테스트는 projectile variant가 bullet/audio side effect만 만들고, prefab variant payload의 spawned entity가 실제 spawned enemy와 일치하며, aggregate result가 variant별 spawn/payload count를 보고하는지 고정한다.
- helper는 pending queue drain/order, actual projectile/prefab spawn side effect, shoot audio emission, `prefabSpawned` event ABI, gameplay event sink push 순서를 변경하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "deferred spawn command dispatch result"는 impossible `Option` 조합을 허용하지 않는 enum contract로 좁아졌다. Shooter spawn runtime에는 여전히 command enrichment, producer-specific dispatch loop, shoot audio, prefab metadata/event push 같은 장르별 policy glue가 남아 있다.

### 2026-06-02: action trigger phase aggregate result slice

queued action trigger phase가 trigger를 drain/prepare/dispatch한 결과를 `ActionTriggerPhaseProcessResult`로 반환하도록 조정했다. 목표는 producer-specific dispatch loop를 즉시 공통 scheduler로 옮기는 것이 아니라, 한 phase가 실제로 처리한 trigger 수와 준비 단계 결과를 agent 진단/dry-run 신호로 관측할 수 있게 하는 것이다.

- `process_action_triggers(...)`는 `triggers_collected`, `triggers_processed`, `prepared_dispatch_attempts`, `preparation_failures`, `preparation_failure_events_pushed`, `noops`를 반환한다. 기존 production call site는 결과를 무시하므로 frame loop behavior는 유지된다.
- `process_action_trigger(...)`는 prepared payload를 branch dispatcher에 넘긴 시도, 준비 실패, no-op을 `ActionTriggerProcessResult`로 반환한다. dash/projectile/melee/spawnPrefab branch 내부의 장르별 plan/commit failure 정책은 기존처럼 각 branch가 event sink를 처리하므로, `prepared_dispatch_attempts`는 action 성공 수가 아니다.
- event sink가 없으면 preparation failure 자체는 카운트하지만 `preparation_failure_events_pushed`는 0으로 남는다.
- 현재 queued trigger policy는 readiness failure를 generic failure로 보고하므로 `noops`는 보통 0이다. 이 필드는 이후 silent/skip policy를 같은 phase result에 태울 수 있도록 남겨 둔 reserved count다.
- 회귀 테스트는 missing-binding trigger batch가 drain 순서와 failure event push count를 보고하는지, event sink가 없는 preparation failure가 unpushed로 보고되는지, dash trigger가 prepared dispatch로 집계되는지 고정한다.
- helper는 action trigger queue drain/order, cooldown commit, pending spawn/melee queue mutation, dash transform write, gameplay event ABI를 변경하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "producer-specific dispatch loop"는 아직 Shooter runtime에 남아 있지만, phase-level 처리 결과를 내부 aggregate로 관측할 수 있게 됐다. 다음 단계가 필요하면 branch 내부 plan/commit result도 같은 방식으로 좁힐 수 있다.

### 2026-06-02: queued dash trigger branch result slice

queued dash trigger branch가 plan/commit/apply 결과를 `DashActionTriggerProcessResult`로 반환하도록 조정했다. 목표는 dash 실행 정책을 바꾸는 것이 아니라, phase aggregate에서 아직 보이지 않던 branch 내부 결과를 dash부터 관측 가능한 값으로 좁히는 것이다.

- `process_dash_trigger(...)`는 `plan_succeeded`, `commit_succeeded`, `dash_applied`, `failure_event_pushed`를 반환한다.
- source transform 누락이나 dash plan 실패는 기존처럼 `actionFailed` event를 push하고, event sink가 있을 때만 `failure_event_pushed`가 true가 된다.
- planning은 성공했지만 prepare 이후 binding이 바뀌어 `commit_prepared_action(...)`이 거부한 경우 `plan_succeeded: true`, `commit_succeeded: false`, `dash_applied: false`, `failure_event_pushed: false`로 보고한다. cooldown과 transform은 변경하지 않는다.
- 이 slice 시점에는 `PreparedActionTriggerDispatcher`의 dash branch가 result를 phase aggregate에 합치지 않고 무시했다. 이후 branch result aggregate slice에서 private aggregate로 연결했으며, production behavior와 public telemetry는 유지된다.
- 회귀 테스트는 applied dash, missing-source failure event push, event sink 없는 plan failure, prepare 후 binding 변경으로 인한 skipped commit을 각각 고정한다.
- helper는 dash target selection, transform write helper, cooldown commit policy, gameplay event ABI, action trigger queue drain/order를 변경하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "dash branch 내부 plan/commit result"는 내부 result boundary로 관측 가능해졌다. projectile/melee/spawnPrefab branch 내부 plan/commit result는 아직 같은 수준으로 분리되지 않았다.

### 2026-06-02: queued melee trigger branch result slice

queued melee trigger branch가 support/plan/commit/queue 결과를 `MeleeActionTriggerProcessResult`로 반환하도록 조정했다. 목표는 melee 실행 정책이나 pending melee queue semantics를 바꾸는 것이 아니라, dash와 같은 branch 내부 outcome 경계를 melee에도 추가하는 것이다.

- `process_melee_trigger(...)`는 `plan_succeeded`, `commit_succeeded`, `melee_queued`, `failure_event_pushed`를 반환한다.
- queued melee에서 지원하지 않는 target, source transform 누락, target plan 실패는 기존처럼 `actionFailed` event를 push하고, event sink가 있을 때만 `failure_event_pushed`가 true가 된다.
- planning은 성공했지만 prepare 이후 binding이 바뀌어 `commit_prepared_action(...)`이 거부한 경우 `plan_succeeded: true`, `commit_succeeded: false`, `melee_queued: false`, `failure_event_pushed: false`로 보고한다. cooldown과 pending melee queue는 변경하지 않는다.
- 이 slice 시점에는 `PreparedActionTriggerDispatcher`의 melee branch가 result를 phase aggregate에 합치지 않고 무시했다. 이후 branch result aggregate slice에서 private aggregate로 연결했으며, production behavior와 public telemetry는 유지된다.
- 회귀 테스트는 queued melee success, missing-source failure event push, target plan failure event push, event sink 없는 unsupported target failure, prepare 후 binding 변경으로 인한 skipped commit을 각각 고정한다.
- helper는 queued melee target policy, melee plan helper, cooldown commit policy, pending melee queue mutation, gameplay event ABI, action trigger queue drain/order를 변경하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "melee branch 내부 plan/commit/queue result"는 내부 result boundary로 관측 가능해졌다. projectile/spawnPrefab branch 내부 plan/commit result는 아직 같은 수준으로 분리되지 않았다.

### 2026-06-02: queued projectile trigger branch result slice

queued projectile trigger branch가 support/plan/commit/queue 결과를 `ProjectileActionTriggerProcessResult`로 반환하도록 조정했다. 목표는 projectile spawn 정책이나 pending spawn queue semantics를 바꾸는 것이 아니라, dash/melee와 같은 branch 내부 outcome 경계를 projectile에도 추가하는 것이다.

- `process_projectile_trigger(...)`는 `plan_succeeded`, `commit_succeeded`, `projectile_queued`, `failure_event_pushed`를 반환한다.
- queued projectile에서 지원하지 않는 aim/collision target, target plan 실패, source transform 누락은 기존처럼 `actionFailed` event를 push하고, event sink가 있을 때만 `failure_event_pushed`가 true가 된다.
- projectile command planning은 성공했지만 pending spawn queue가 가득 찬 경우 `plan_succeeded: true`, `commit_succeeded: false`, `projectile_queued: false`, `failure_event_pushed: true`로 보고한다. cooldown은 변경하지 않는다.
- planning은 성공했지만 prepare 이후 binding이 바뀌어 `commit_prepared_action(...)`이 거부한 경우 `plan_succeeded: true`, `commit_succeeded: false`, `projectile_queued: false`, `failure_event_pushed: false`로 보고한다. cooldown과 pending spawn queue는 변경하지 않는다.
- 이 slice 시점에는 `PreparedActionTriggerDispatcher`의 projectile branch가 result를 phase aggregate에 합치지 않고 무시했다. 이후 branch result aggregate slice에서 private aggregate로 연결했으며, production behavior와 public telemetry는 유지된다.
- 회귀 테스트는 queued projectile success, unsupported support failure event push, target plan failure event push, queue-full pre-commit failure, prepare 후 binding 변경으로 인한 skipped commit을 각각 고정한다.
- helper는 projectile target selection, spawn command enrichment, pending spawn queue capacity policy, cooldown commit policy, gameplay event ABI, action trigger queue drain/order를 변경하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "projectile branch 내부 plan/commit/queue result"는 내부 result boundary로 관측 가능해졌다. spawnPrefab branch 내부 plan/commit result는 아직 같은 수준으로 분리되지 않았다.

### 2026-06-02: queued spawnPrefab trigger branch result slice

queued spawnPrefab trigger branch가 plan/commit/queue 결과를 `SpawnPrefabActionTriggerProcessResult`로 반환하도록 조정했다. 목표는 prefab spawn 정책, placement gate, pending spawn queue semantics를 바꾸는 것이 아니라, dash/melee/projectile과 같은 branch 내부 outcome 경계를 spawnPrefab에도 추가하는 것이다.

- `process_spawn_prefab_trigger(...)`는 `plan_succeeded`, `commit_succeeded`, `prefab_queued`, `failure_event_pushed`를 반환한다.
- unsupported prefab, unsupported anchor/phase, source transform 누락은 기존처럼 `actionFailed` event를 push하고, event sink가 있을 때만 `failure_event_pushed`가 true가 된다.
- prefab command planning은 성공했지만 pending spawn queue가 가득 차거나 placement가 막힌 경우 `plan_succeeded: true`, `commit_succeeded: false`, `prefab_queued: false`, `failure_event_pushed: true`로 보고한다. cooldown은 변경하지 않는다.
- planning은 성공했지만 prepare 이후 binding이 바뀌어 `commit_prepared_action(...)`이 거부한 경우 `plan_succeeded: true`, `commit_succeeded: false`, `prefab_queued: false`, `failure_event_pushed: false`로 보고한다. cooldown과 pending spawn queue는 변경하지 않는다.
- 이 slice 시점에는 `PreparedActionTriggerDispatcher`의 spawnPrefab branch가 result를 phase aggregate에 합치지 않고 무시했다. 이후 branch result aggregate slice에서 private aggregate로 연결했으며, production behavior와 public telemetry는 유지된다.
- 회귀 테스트는 queued prefab success, missing-source plan failure event push, event sink 없는 unsupported prefab failure, blocked-placement pre-commit failure, queue-full pre-commit failure, prepare 후 binding 변경으로 인한 skipped commit을 각각 고정한다.
- helper는 supported prefab policy, source-relative transform plan, placement AABB/tilemap gate, pending spawn queue capacity policy, cooldown commit policy, gameplay event ABI, action trigger queue drain/order를 변경하지 않는다.

이 slice 이후 현재 queued trigger action branch(dash/melee/projectile/spawnPrefab)의 내부 plan/commit/apply-or-queue result는 모두 private result boundary로 관측 가능해졌다. 이후 branch result aggregate slice에서 dispatcher context가 이 private branch result를 phase aggregate에 연결했다.

### 2026-06-02: action trigger branch result aggregate slice

queued trigger action branch(dash/melee/projectile/spawnPrefab)의 private result boundary를 `PreparedActionTriggerBranchResult` enum으로 합치고 `ActionTriggerPhaseProcessResult` aggregate에 연결했다. 목표는 action 실행 정책을 바꾸는 것이 아니라, prepare 이후 dispatch branch에서 실제 effect가 커밋됐는지, 실패 reason이 무엇인지, event sink에 실패 event가 push됐는지, prepare 이후 binding 변경으로 commit이 skip됐는지를 agent 진단/dry-run 신호로 관측할 수 있게 하는 것이다.

- `ShooterActionTriggerDispatchContext`는 `dispatch_prepared_action_trigger(...)`가 호출한 branch result를 private `PreparedActionTriggerBranchResult`로 보관한다. `PreparedActionTriggerDispatcher` trait signature는 변경하지 않는다.
- `ActionTriggerPhaseProcessResult`는 `prepared_dispatch_successes`, `prepared_dispatch_failures`, `prepared_dispatch_failure_events_pushed`, `prepared_dispatch_commit_skips`, `last_prepared_dispatch_failure_reason_code`를 추가로 집계한다.
- branch result는 effect가 실제로 적용/queue된 경우만 success로 세고, `failure_reason_code`가 있는 경우만 failure로 센다. 따라서 queue-full/blocked-placement 같은 pre-commit failure는 commit skip과 중복 집계되지 않는다.
- dash/melee/projectile/spawnPrefab branch result는 event sink가 없어도 실패 reason code를 보존한다. 이는 "event push 여부"와 "실패 원인"을 분리해 agent dry-run 진단에서 사용할 수 있게 하기 위한 것이다.
- 회귀 테스트는 phase aggregate의 branch failure reason/commit skip 분리, event sink 없는 branch failure aggregate, projectile queue-full branch failure aggregate, 기존 branch별 success/failure/commit skip 결과를 고정한다.
- helper는 action trigger queue drain/order, cooldown commit policy, dash transform write, pending spawn/melee queue mutation, gameplay event ABI, Wasm/TypeScript public boundary를 변경하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "queued branch 내부 outcome aggregate"는 private telemetry boundary로 이동했다. 이후 action trigger failure reason summary slice에서 phase-level per-reason count를 추가했다.

### 2026-06-02: action trigger failure reason summary slice

action trigger phase aggregate가 마지막 실패 reason만 보존하던 한계를 줄이기 위해 fixed bucket 기반 `action_failure_reason_counts`를 추가했다. 목표는 public telemetry나 event ABI를 바꾸는 것이 아니라, 한 phase에서 여러 failure reason이 섞여도 agent dry-run 진단이 원인별 빈도를 읽을 수 있는 내부 요약 신호를 제공하는 것이다.

- `ActionTriggerPhaseProcessResult`는 action failure reason code별 count bucket을 보관한다. 현재 reason code 범위는 `GAMEPLAY_ACTION_FAILURE_*` 1..12이며, `GAMEPLAY_ACTION_FAILURE_MAX_REASON_CODE`를 명시 sentinel로 사용한다. bucket은 stack array라 heap allocation이 없다.
- preparation failure와 prepared dispatch branch failure를 같은 reason summary에 기록한다. 따라서 missing binding/cooling down 같은 준비 단계 실패와 blocked placement/queue full 같은 branch 실패를 같은 phase 진단에서 비교할 수 있다.
- `last_prepared_dispatch_failure_reason_code`는 기존 의미대로 prepared dispatch branch의 마지막 실패 reason만 유지한다. 전체 phase의 원인별 분석은 `action_failure_reason_counts`가 담당한다.
- 알려진 bucket 범위를 벗어난 reason code는 count에 기록하지 않는다. 기존 event payload와 last reason 보존 정책은 바꾸지 않는다.
- 회귀 테스트는 known reason code가 bucket 범위에 들어가는지, preparation failure count, event sink 없는 branch failure count, 실제 phase 처리에서 서로 다른 preparation/branch reason이 함께 count되는지, projectile queue-full branch failure count를 고정한다.
- helper는 action trigger queue drain/order, cooldown commit policy, gameplay event ABI, Wasm/TypeScript public boundary를 변경하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "phase-level failure reason summary"는 private aggregate boundary로 이동했다. 이어지는 frame telemetry diagnostic surface slice에서 이 summary를 runtime frame surface로 노출했다.

### 2026-06-02: action trigger frame telemetry diagnostic surface slice

private aggregate로 남아 있던 action trigger phase result를 runtime frame telemetry와 TypeScript `FrameState`에서 읽을 수 있는 diagnostic surface로 연결했다. 목표는 action 실행 정책이나 gameplay event ABI를 바꾸는 것이 아니라, agent/runtime debug path가 "이번 frame에 trigger action이 몇 번 시도됐고 왜 실패했는지"를 bulk telemetry에서 읽게 하는 것이다.

- `ShooterScene`은 마지막 action trigger phase result를 보관하고, Title/GameOver/reset 경계에서는 기본값으로 clear한다. Shooter 외 scene은 같은 telemetry slot을 `0`으로 채운다.
- Rust `FrameTelemetry`는 기존 37개 f64 slot을 유지한 뒤 action trigger attempts/failures/failure event pushed/commit skips/last prepared failure reason/per-reason count bucket을 append-only로 추가했다. `FRAME_TELEMETRY_F64S`는 `55`이며, 기존 telemetry index는 이동하지 않는다. attempts는 render frame 안에서 처리된 trigger 수이며 preparation failure와 noop도 포함한다.
- TypeScript `FrameState.actionDiagnostics`는 같은 bulk frame telemetry buffer에서 값을 decode한다. `failureReasonCounts[reasonCode]`는 Rust `GAMEPLAY_ACTION_FAILURE_*` reason code와 같은 index를 사용하고, reason `0`은 no-reason bucket으로 남긴다.
- `GAMEPLAY_ACTION_FAILURE_MAX_REASON_CODE`를 TS decoder에도 노출해 Rust/TS의 reason bucket 길이 계약을 명시했다.
- public type export에는 `ActionFrameDiagnostics`를 추가했고, test fixture도 기본 빈 diagnostic 값을 갖도록 맞췄다.
- Engine frame 시작에서 diagnostic aggregate를 clear하고 fixed substep마다 action trigger phase result를 누적한다. 따라서 fixed timestep render frame에서 첫 substep failure가 마지막 noop substep에 덮이지 않는다.
- 검증은 `cargo fmt --manifest-path crates/ferrum-core/Cargo.toml -- --check`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml runtime_outputs -- --nocapture`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml shooter_scene::runtime::actions -- --nocapture`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml`, `cargo clippy --manifest-path crates/ferrum-core/Cargo.toml -- -D warnings`, `pnpm build:wasm`, `pnpm --filter @ferrum2d/ferrum-web test`, `pnpm lint`로 확인했다.

이 slice 이후 action trigger failure reason summary는 더 이상 Rust private aggregate에만 머물지 않는다. 다만 아직 machine-actionable JSON diagnostic report(`path`, expected value, suggestion)로 변환하지는 않았으므로, 다음 후보는 `FrameState.actionDiagnostics`와 decoded `actionFailed` event를 묶는 agent report builder다.

### 2026-06-02: action trigger agent diagnostic report slice

`FrameState.actionDiagnostics`와 decoded `actionFailed` event를 agent가 바로 소비할 수 있는 machine-actionable report로 변환하는 `gameplayActionDiagnosticReports(...)` helper를 추가했다. 목표는 action 실행 정책이나 Rust gameplay event ABI를 바꾸는 것이 아니라, spec patch 루프가 "어느 path가 기대값과 달랐고 어떤 수정이 필요한지"를 구조화 데이터로 받게 하는 것이다.

- report는 `kind: "gameplay-action"`, `code`, `path`, `message`, `expected`, `actual`, `suggestion`을 가진다. 필요하면 `reasonCode`, `reason`, `count`, `actionId`, `action`, actor/source entity handle도 포함한다.
- `failureReasonCounts[reasonCode]`의 non-zero bucket은 `frame.actionDiagnostics.failureReasonCounts.<reasonCode>` path를 가진 summary report로 변환된다. reason `0` bucket은 기본적으로 제외하고, 명시 옵션에서만 포함한다.
- `triggerFailureEventsPushed < triggerFailures`이면 dropped-event report를 생성한다. event sink를 연결하지 않았거나 bounded event buffer가 모든 failure를 담지 못한 상황에서 agent가 aggregate telemetry를 함께 보도록 유도한다.
- `triggerCommitSkips > 0`이면 commit-skip report를 생성한다. prepare와 commit 사이 action binding 변경 또는 다음 frame retry가 필요한 상황을 분리해 보여준다.
- decoded `GameplayActionFailedEventAction[]`을 넘기면 action id/name과 actor/source handle이 포함된 per-event report를 생성한다. 이 report는 UI callback이나 simulation callback이 아니라 frame-end diagnostic adapter다.
- `gameplayActionFailureReasonForCode(...)`를 public helper로 열어 Rust/TS reason code 동기화와 report builder가 같은 vocabulary를 쓰게 했다.
- 검증은 `pnpm --filter @ferrum2d/ferrum-web test -- gameplayActionDiagnostics`, `pnpm --filter @ferrum2d/ferrum-web test`, `pnpm lint`로 확인한다.

이 slice 이후 action trigger telemetry는 agent 저작 루프의 `telemetry -> diagnostic -> patch proposal` 단계까지 연결된다. 이어지는 replay smoke diagnostic summary slice에서 이 report를 실제 smoke command 출력에 묶었다.

### 2026-06-02: replay smoke action diagnostic summary slice

`pnpm smoke:gameplay-replay`의 Node raw-Wasm runner가 action failure telemetry를 agent-facing summary로 출력하도록 연결했다. 목표는 golden replay hash 범위를 넓히는 것이 아니라, replay 실패/성공 여부 옆에 spec patch에 바로 쓸 수 있는 action diagnostic report를 제공하는 것이다.

- replay runner는 simulation update에서 frame telemetry write를 켜고, capture frame마다 `FrameTelemetry`의 action trigger slots와 decoded gameplay event buffer를 읽는다.
- `gameplayActionDiagnosticReports(...)`를 사용해 per-reason bucket report와 per-`actionFailed` event report를 `actionDiagnostics` 배열로 출력한다. report path는 `gameplayReplay.frames.<frame>.actionDiagnostics...` 형태라 agent가 replay frame과 수정 후보를 연결하기 쉽다.
- 이 `actionDiagnostics` summary는 `GameStateSnapshot`이나 `GameplayReplayRun` hash에 포함하지 않는다. 따라서 canonical gameplay replay hash는 scene/built-in shooter/custom gameplay state만 계속 비교하고, diagnostic은 smoke command output에만 붙는다.
- `--update`로 golden fixture를 재생성할 때도 `actionDiagnostics`는 fixture 파일에 저장하지 않는다. 이는 diagnostic vocabulary 변경이 golden gameplay state hash를 불필요하게 흔들지 않게 하기 위한 정책이다.
- frame telemetry는 `f64` bulk buffer이므로 smoke runner는 `Float64Array`로 복사한다. `Float32Array`로 읽으면 reason bucket count가 깨질 수 있어 별도 copy helper로 분리했다.
- 검증은 `node --check scripts/gameplay-replay-smoke.mjs`, `pnpm --filter @ferrum2d/ferrum-web build`, `node scripts/gameplay-replay-smoke.mjs --scenario topdown-authored-behavior`, `node scripts/gameplay-replay-smoke.mjs --scenario topdown-state-enter-dash-input-aim-failure`로 확인했다.

이 slice 이후 action diagnostic report는 public helper에 머물지 않고 실제 replay smoke command 출력까지 연결됐다. 이어지는 replay smoke agent report artifact slice에서 이 report를 파일 산출물로 저장하는 경로를 추가했다.

### 2026-06-02: replay smoke agent report artifact slice

`gameplay-replay-smoke.mjs`에 `--artifact-dir <path>` 옵션을 추가하고, 표준 npm script `pnpm smoke:gameplay-replay:report`를 제공했다. 목표는 agent가 콘솔 로그 파싱에 의존하지 않고 replay smoke 결과와 action diagnostic report를 안정적인 JSON artifact로 읽게 하는 것이다.

운영 계약과 실행 기준의 source of truth는 `docs/development/quality/smoke-check.md`이며, 이 섹션은 agent 저작 루프 고도화의 결정 로그로 유지한다.

- `--artifact-dir`을 넘기면 smoke runner가 기존 콘솔 출력과 같은 summary를 `<artifact-dir>/gameplay-replay-smoke-report.json`에 저장한다.
- `FERRUM_GAMEPLAY_REPLAY_ARTIFACT_DIR` 환경변수도 같은 역할을 한다. 빈 환경변수는 unset으로 취급하고, 빈 `--artifact-dir=`는 repo root 쓰기를 피하기 위해 오류로 거부한다. 명시 옵션이 없으면 기존처럼 파일을 만들지 않는다.
- 표준 script는 `artifacts/gameplay-replay-smoke/gameplay-replay-smoke-report.json`에 저장한다. CI나 agent는 이 파일에서 scenario별 replay hash, snapshot count, actionDiagnostics report를 읽을 수 있다.
- report root에는 `format: "ferrum2d.gameplay-replay.smoke-report"`, `version`, `ok`, `gameplayReplaySmoke`, 실패 시 `errors`를 둔다. 이는 agent artifact schema를 fixture/manifest처럼 versioning하기 위한 최소 envelope다.
- artifact는 golden fixture가 아니다. `--update`로 fixture를 갱신할 때도 action diagnostic summary는 fixture 파일에 저장하지 않고, 별도 report artifact에만 남긴다.
- golden mismatch나 assertion failure가 나도 artifact dir이 지정되어 있으면 가능한 범위의 scenario summary와 error summary를 먼저 저장한 뒤 non-zero로 종료한다. agent는 실패 상황에서도 replay comparison과 actionDiagnostics를 읽을 수 있다.
- manifest의 `fixturePath`/`variantPath`는 기존 committed manifest와 호환되도록 기본 repo-root 기준으로 해석한다. 실험 manifest가 manifest 파일 위치 기준 경로를 원하면 `./fixture.json` 또는 `../fixtures/foo.json`처럼 명시적인 relative prefix를 사용한다.
- 기본 `pnpm smoke:gameplay-replay` gate는 artifact 쓰기를 하지 않으므로 기존 smoke check의 파일 side effect는 유지된다.
- 검증은 `node --check scripts/gameplay-replay-smoke.mjs`, `node scripts/gameplay-replay-smoke.mjs --scenario topdown-state-enter-dash-input-aim-failure --artifact-dir /private/tmp/ferrum-gameplay-replay-smoke`, 임시 manifest-local `./fixture` replay smoke, 임시 golden mismatch artifact smoke, `pnpm smoke:gameplay-replay:report -- --scenario topdown-state-enter-dash-input-aim-failure`, `pnpm lint`로 확인한다.

이 slice 이후 replay smoke의 agent-facing diagnostic은 helper API, smoke command output, JSON artifact까지 이어진다. 이어지는 dry-run authoring report artifact slice에서 validate 단계도 같은 envelope 계열로 맞췄다.

### 2026-06-02: gameplay authoring dry-run report artifact slice

`gameplay-authoring-dry-run.mjs`와 표준 npm script `pnpm validate:gameplay-authoring:report`를 추가했다. 목표는 agent 저작 루프의 `validate` 단계가 replay smoke와 같은 versioned report envelope를 사용해, apply/run 전에 authoring proposal의 구조 오류를 JSON path 기반으로 읽을 수 있게 하는 것이다.

운영 계약과 실행 기준의 source of truth는 `docs/development/quality/smoke-check.md`이며, 이 섹션은 agent 저작 루프 고도화의 결정 로그로 유지한다.

- report root는 `format: "ferrum2d.gameplay-authoring.dry-run-report"`, `version`, `ok`, `gameplayAuthoringDryRun`, 실패 시 `diagnostics`/`reports`/`errors`를 둔다. replay smoke report와 envelope shape는 맞추되 format과 payload key는 분리해 agent/CI consumer가 의미를 혼동하지 않게 했다.
- `--artifact-dir <path>`와 `FERRUM_GAMEPLAY_AUTHORING_ARTIFACT_DIR`를 지원한다. 표준 script는 `artifacts/gameplay-authoring-dry-run/gameplay-authoring-dry-run-report.json`에 저장한다.
- dry-run 범위는 Top-down authored behavior variant의 base Game Spec 참조, runtime id registry, `SceneComposition` + `BehaviorRecipe` binding plan, command count/type summary, FSM install plan summary, replay manifest link다.
- exact command ordering, replay hash fixture 비교, numeric FSM state 기대값은 기존 `topdown-authored-behavior-variant-smoke.mjs`와 `gameplay-replay-smoke.mjs`의 책임으로 유지한다. 새 dry-run report는 agent proposal 검증용 summary와 machine-actionable diagnostics를 담당한다.
- 실패 report는 raw `diagnostics`와 함께 `reports` 배열을 제공한다. `reports`는 `path`, `expected`, `actual`, `suggestion`을 포함하므로 agent가 "어느 JSON path를 어떻게 고쳐야 하는지"를 콘솔 문자열 파싱 없이 읽을 수 있다.
- 이 CLI는 `packages/ferrum-web/dist/index.js`의 resolver/dry-run helper만 사용하며 Wasm `Engine`, browser runtime, `applyGameplayBehaviorCommands(...)`, frame hot path callback을 호출하지 않는다.
- 검증은 `node --check scripts/gameplay-authoring-dry-run.mjs`, `node scripts/gameplay-authoring-dry-run.mjs --artifact-dir /private/tmp/ferrum-gameplay-authoring-dry-run`, invalid variant dry-run failure artifact, `pnpm validate:gameplay-authoring:report`, `pnpm lint`로 확인한다.

이 slice 이후 `propose -> validate -> apply -> run -> telemetry` 중 validate와 run 단계가 모두 versioned JSON artifact를 가진다. 이어지는 consumer agent gameplay report workflow slice에서 이 report 계열을 consumer agent template의 선택적 workflow로 연결했다.

### 2026-06-02: consumer agent gameplay report workflow slice

`@ferrum2d/agents` consumer harness와 gameplay/playtest skill에 data-driven gameplay report workflow를 연결했다. 목표는 엔진 repo에서 만든 validate/run report artifact 흐름을 consumer game development agent가 이해하되, 일반 consumer 프로젝트에 엔진 workspace 전용 `pnpm` 명령을 강제하지 않는 것이다.

- shared harness는 `npm run ferrum:authoring-report`와 `npm run ferrum:replay-report`가 프로젝트에 있을 때 agent-first gameplay evidence로 우선 사용하도록 안내한다.
- Ferrum2D 엔진 workspace의 대응 명령은 `pnpm validate:gameplay-authoring:report`, `pnpm smoke:gameplay-replay:report`라고 명시하되, ordinary consumer game에는 wrapper script가 없으면 요구하지 않는다.
- `ferrum-consumer-gameplay` skill은 data-driven gameplay/behavior authoring 변경 전에 `ferrum:authoring-report`를 먼저 사용하도록 안내한다.
- `ferrum-consumer-playtest` skill은 deterministic gameplay regression evidence로 `ferrum:replay-report`를 사용할 수 있게 했다.
- `ferrum2d-agents` installer가 AGENTS/CLAUDE/GEMINI instruction block에 삽입하는 기본 안내와 `packages/agents/README.md`도 같은 용어로 맞췄다.
- 이 slice는 consumer package에 engine 개발 agent를 추가하지 않고, publish/release/engine internals 경계도 유지한다.
- 검증은 `node --check packages/agents/bin/ferrum2d-agents.mjs`, `node packages/agents/bin/ferrum2d-agents.mjs init --target /private/tmp/ferrum-agents-template-check --tools codex --dry-run`, `pnpm package:check:agents`로 확인한다.

이 slice 이후 consumer agent template도 `propose -> validate -> apply -> run -> telemetry` 루프의 validate/run report를 인지한다. 이어지는 create-game report wrapper slice에서 신규 consumer 프로젝트가 기본 script로 이 루프를 사용할 수 있게 했다.

### 2026-06-02: create-game report wrapper slice

`@ferrum2d/create-game` 템플릿에 `ferrum:authoring-report`와 `ferrum:replay-report` scripts를 추가했다. 목표는 consumer agent template이 안내하는 validate/run report workflow가 신규 generated project에서도 바로 실행 가능한 명령으로 존재하게 하는 것이다.

- `ferrum:authoring-report`는 `scripts/ferrum-harness.mjs authoring-report`를 호출해 public import, dependency, `src/main.ts`, Game Spec이 있는 경우 `resolveShooterGameSpec(...)` 결과를 versioned JSON report로 출력한다.
- report format은 `ferrum2d.consumer.gameplay-authoring.report`이며, 실패 시 `diagnostics`와 `reports`에 `path`/`expected`/`actual`/`suggestion`을 담는다.
- `topdown` 템플릿은 `public/game.json`을 필수 authoring 입력으로 검증한다. `minimal`/`platformer`는 Game Spec이 없으면 `not-configured`로 보고하되 dependency/import 같은 project authoring 오류는 실패 처리한다.
- `ferrum:replay-report`는 `ferrum2d.consumer.gameplay-replay.report`를 출력한다. replay fixture가 없는 템플릿은 `status: "not-configured"`를 명시하고, 실제 replay gate가 필요한 consumer project가 별도 replay harness를 추가해야 함을 suggestion으로 제공한다. 이후 topdown template replay fixture slice에서 `topdown`은 template Game Spec contract replay를 기본 제공하게 됐다.
- package consumer smoke는 generated project install 후 `ferrum:authoring-report`와 `ferrum:replay-report`를 실행해 tarball 소비자 경로에서 wrapper 존재와 기본 동작을 검증한다.
- 이 slice는 consumer project에 engine repo 전용 `pnpm validate:gameplay-authoring:report` 또는 `pnpm smoke:gameplay-replay:report`를 강제하지 않는다.
- 검증은 각 template `scripts/ferrum-harness.mjs`의 `node --check`, `pnpm package:check:create-game`, 이후 package consumer smoke 경로로 확인한다.

이 slice 이후 신규 consumer project는 기본 harness script만으로 agent-first validate/run report 루프를 시작할 수 있다. 남은 후보는 실제 deterministic replay fixture를 consumer game template에 포함할 만큼 product surface가 성숙했는지 판단하는 일이었다. 이후 topdown template replay fixture slice와 create-game basic template replay fixture slice에서 이 범위를 기본 template 전체로 넓혔다.

### 2026-06-02: melee attack queue result boundary slice

`queue_melee_attack(...)`이 `MeleeAttackCoreData`를 `MeleeAttackCommand`로 변환해 `pending_melee_attacks`에 push한 뒤 `MeleeAttackQueueResult`를 반환하도록 조정했다. 목표는 melee queue capacity policy나 collision resolution을 바꾸는 것이 아니라, action phase가 생성한 scene-neutral melee core data가 실제 runtime queue command로 적재된 결과를 내부 result로 관측할 수 있게 하는 것이다.

- `MeleeAttackQueueResult`는 실제 큐에 들어간 `MeleeAttackCommand`를 담는다.
- player input melee와 queued trigger melee 호출부는 기존처럼 결과를 무시하므로 cooldown commit, queue mutation, collision resolution 순서는 유지된다.
- 기존 `pending_melee_attacks: Vec<_>`의 unbounded push semantics는 유지한다. capacity gate나 failure reason은 이 slice에서 추가하지 않는다.
- 회귀 테스트는 `MeleeAttackCoreData`의 attacker/center/range/damage/target/height span이 queue command와 반환 result에 그대로 보존되는지 고정한다.
- helper는 pending melee drain, melee collision query, damage/despawn/score/event/audio/VFX/tween side effect를 수행하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "melee attack queue mutation result"는 Shooter runtime helper boundary로 이동했다. melee collision resolution과 pending melee drain phase ownership은 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: pending melee attack drain helper slice

pending melee attack 처리 phase가 `pending_melee_attacks`를 직접 순회하고 마지막에 clear하던 구조를 `drain_pending_melee_attacks_for_phase(...) -> PendingMeleeAttackDrainResult` 경계로 분리했다. 목표는 melee collision resolution이나 hit side effect를 공통화하는 것이 아니라, action phase가 적재한 deferred melee command queue를 combat phase scratch command list로 옮기는 drain/order/reuse contract를 명시하는 것이다.

- `ShooterScene`은 spawn flush의 `spawn_commands`와 같은 용도의 `melee_attack_commands` scratch buffer를 보유한다.
- combat phase는 `drain_deferred_commands_into(...)`로 pending melee queue를 scratch로 이동한 뒤 scratch command list를 순회한다.
- 처리 후 scratch는 clear하지만 capacity는 유지한다. pending queue는 drain 시점에 비워진다.
- drain 이후 같은 phase 처리 중 새 melee command가 적재되면 현재 scratch list에는 포함되지 않으므로 다음 collision phase까지 pending queue에 남는다. 현재 collision 처리 중 새 melee를 queue하는 경로는 없지만, 이 semantics가 deferred command phase boundary다.
- 회귀 테스트는 stale scratch가 먼저 지워지고 pending melee command 순서가 유지되며 pending queue가 비워지는지 고정한다.
- reset/snapshot restore는 `pending_melee_attacks`와 `melee_attack_commands`를 함께 clear한다.
- helper는 attacker/target eligibility, melee collision query, damage/despawn/score/event/audio/VFX/tween side effect를 수행하지 않는다.

이 slice 이후 action/combat 쪽 남은 Shooter compatibility 책임 중 "pending melee drain phase ownership"은 Shooter runtime helper boundary로 이동했다. melee collision resolution과 hit side-effect dispatch policy는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: enemy-target melee resolution result boundary slice

enemy-target pending melee 처리 helper가 default melee hit를 적용한 뒤 `PendingEnemyTargetMeleeResolutionResult`를 반환하도록 조정했다. 목표는 melee collision query나 hit side-effect dispatch를 공통 gameplay system으로 옮기는 것이 아니라, enemy-target melee resolution이 실제 damage/removal/score outcome을 얼마나 만들었는지 내부 result로 관측하는 것이다.

- `PendingEnemyTargetMeleeResolutionResult`는 `targets_damaged`, `targets_removed`, `score_delta`를 담는다.
- caller인 pending melee phase는 기존처럼 result를 소비하지 않으므로 처리 순서와 side effect는 유지된다.
- result 누적은 `apply_default_collision_damage_hit(...)`가 실제 outcome을 반환한 경우에만 수행한다.
- `score_delta`는 기존 `commit_score_delta(...)`에 전달한 값과 같은 값을 saturating add로 누적한다.
- 회귀 테스트는 lethal enemy-target melee hit가 damage 1건, removed 1건, score delta 7을 반환하고 기존 score/pending despawn side effect도 유지하는지 고정한다.
- helper는 player-target melee GameOver, melee query construction, hit presentation/event/audio/VFX/tween dispatch 정책을 변경하지 않는다.

이 slice 이후 action/combat 쪽 남은 Shooter compatibility 책임 중 "enemy-target melee damage/removal/score result"는 Shooter runtime helper result boundary로 이동했다. melee collision query construction, player-target melee resolution, hit side-effect dispatch policy는 아직 Shooter runtime compatibility path에 남아 있다.

### 2026-06-02: player-target melee resolution result boundary slice

player-target pending melee 처리 helper가 GameOver 전환, hit collision event push, game-over audio push 여부를 `PendingPlayerTargetMeleeResolutionResult`로 반환하도록 조정했다. 목표는 player-target melee GameOver 정책을 바꾸는 것이 아니라, 기존 `enter_game_over() -> should_emit_default_game_over_audio(...) -> collision hit/audio push` 경로의 outcome을 내부 result로 관측하는 것이다.

- `PendingPlayerTargetMeleeResolutionResult`는 `game_over_entered`, `collision_event_pushed`, `game_over_audio_pushed`를 담는다.
- caller인 pending melee phase는 기존처럼 result를 소비하지 않으므로 처리 순서와 side effect는 유지된다.
- player가 없거나, target이 live/eligible하지 않거나, melee query가 player를 맞히지 못하면 default false result를 반환한다.
- `enter_game_over()`는 항상 기존 위치에서 한 번 호출하고, audio/event push는 기존처럼 `should_emit_default_game_over_audio(...)`가 true일 때만 수행한다.
- 회귀 테스트는 첫 player-target melee hit가 GameOver/audio/collision hit event를 만들고, 이미 GameOver 상태인 다음 호출은 추가 audio/event 없이 false result를 반환하는지 고정한다.
- helper는 melee query construction, authored replacement audio policy, GameOver audio payload construction, collision event ABI를 변경하지 않는다.

이 slice 이후 action/combat 쪽 남은 Shooter compatibility 책임 중 "player-target melee GameOver/audio/hit event result"는 Shooter runtime helper result boundary로 이동했다. melee collision query construction과 hit side-effect dispatch policy의 공통화는 아직 별도 결정으로 남아 있다.

### 2026-06-02: melee enemy hit side-effect dispatch result slice

enemy-target pending melee 처리 중 default damage outcome 이후 발생하는 hit presentation/gameplay event/score/audio/VFX/tween dispatch를 `dispatch_melee_enemy_hit_side_effects(...) -> MeleeHitSideEffectDispatchResult` 메서드 경계로 묶었다. 목표는 melee side effect를 공통 gameplay system으로 승격하는 것이 아니라, 기존 Shooter runtime 순서와 sink 정책을 유지한 채 한 hit가 만든 외부 관측 side effect와 score delta를 내부 result로 관측하는 것이다.

- `MeleeHitSideEffectDispatchResult`는 `collision_event_pushed`, `gameplay_event_pushed`, `particles_spawned`, `hit_tween_started`, `hit_audio_event_pushed`, `score_delta`를 담는다.
- helper 내부 순서는 기존과 같이 hit presentation dispatch, gameplay event dispatch, score commit, non-lethal tween, hit audio dispatch 순서를 유지한다.
- `score_delta`는 `commit_score_delta(...)`에 전달한 awarded delta이며, saturation 이후 score field의 실제 증가분을 별도 계산하는 값은 아니다.
- caller는 기존처럼 aggregate enemy-target melee result만 갱신하며, helper result 자체를 외부 ABI나 public event로 노출하지 않는다.
- 회귀 테스트는 lethal enemy melee hit에서 collision event, gameplay damage event, particle, audio, awarded score delta가 보고되고 lethal hit tween은 시작되지 않는지, non-lethal hit에서는 tween이 시작되고 score delta가 0인지 고정한다.
- helper는 melee collision query construction/execution, damage application, despawn queue, authored replacement policy, particle preset lookup policy를 변경하지 않는다.

이 slice 이후 action/combat 쪽 남은 Shooter compatibility 책임 중 "melee hit side-effect dispatch policy"는 Shooter runtime method result boundary로 이동했다. melee collision query construction/execution은 이미 `run_melee_attack_query(...)` helper boundary에 있다.

### 2026-06-02: create-game report wrapper consumer smoke follow-up

`@ferrum2d/create-game` report wrapper slice의 소비자 경로를 실제 generated project smoke로 확인하면서 발견된 smoke fixture/API drift를 조정했다. 목표는 신규 `ferrum:authoring-report`/`ferrum:replay-report` wrapper가 template tarball 안에 존재하는지만 보는 것이 아니라, 설치된 consumer project에서 public package type check 이후 실제로 실행되는지 검증하는 것이다.

- `scripts/package-consumer-smoke.mjs`의 public type smoke mock `GameplayBehaviorRuntimeEngine`에 현재 필수 setter인 pickup, interaction, chase movement, collision damage setter를 추가했다. 이는 public API 타입 확장에 consumer smoke fixture가 뒤처져 generated project 검증이 report wrapper 실행 전에 실패하던 문제를 고친 것이다.
- `minimal`/`topdown`/`platformer` template harness의 authoring report status를 더 명확히 했다. 유효한 Game Spec은 `validated`, 잘못된 Game Spec은 `invalid`, topdown의 누락 Game Spec은 `missing`, Game Spec이 기본 범위가 아닌 template은 `not-configured`로 보고한다.
- `scripts/package-consumer-smoke.mjs`는 이제 `ferrum:authoring-report`와 `ferrum:replay-report`를 실행만 하지 않고 stdout의 versioned JSON envelope를 파싱해 `format`, `version`, `ok`, template별 `status`, replay `FERRUM_CONSUMER_REPLAY_NOT_CONFIGURED` code를 assert한다.
- package QA subagent review에서 지적된 normal package check 공백도 닫았다. `scripts/check-create-game-package.mjs`는 generated project의 `scripts/ferrum-harness.mjs`에 대해 `node --check`를 실행하므로, template wrapper syntax regression을 `pnpm package:check:create-game`에서 바로 잡는다.
- consumer harness 문구는 file artifact를 항상 기대하지 않도록 stdout machine-readable report와 project-specific file artifact를 구분했다. 기본 create-game wrapper는 stdout JSON report 계약이다.
- `pnpm package:consumer-smoke -- --skip-build --skip-package-check --artifact-dir /private/tmp/ferrum-consumer-smoke-artifacts-full`를 네트워크 허용 상태에서 실행해 generated `minimal`/`platformer`/`topdown` project의 `ferrum:validate`, `ferrum:authoring-report`, `ferrum:replay-report`, production build가 모두 통과하는지 확인했다.
- `minimal`/`platformer` template의 `ferrum:authoring-report`는 Game Spec 부재를 `ok: true`, `status: "not-configured"`로 구조화했고, `topdown` template은 `public/game.json`을 `status: "validated"`로 보고했다. 모든 기본 template의 `ferrum:replay-report`는 deterministic replay fixture 부재를 `FERRUM_CONSUMER_REPLAY_NOT_CONFIGURED` report로 구조화했다.
- follow-up 검증은 `node --check scripts/package-consumer-smoke.mjs`, `node --check scripts/check-create-game-package.mjs`, `pnpm package:check:create-game`, `pnpm package:check:agents`, `pnpm lint`로 확인했다. payload assertion 추가 후 full matrix consumer smoke는 `pnpm package:consumer-smoke -- --skip-build --skip-package-check --artifact-dir /private/tmp/ferrum-consumer-smoke-artifacts-full`로 통과했다.

이 follow-up 이후 consumer agent harness가 권장하는 report 명령은 전체 기본 template matrix에서 실제 실행 가능하며, package consumer smoke가 report payload shape까지 회귀 gate로 고정한다. 다만 이 시점의 기본 replay report는 아직 실제 deterministic replay pass가 아니라 구조화된 `not-configured` 신호였고, consumer template에 replay fixture를 포함할지는 별도 제품 판단으로 남아 있었다. 이후 topdown template replay fixture slice에서 이 공백을 topdown부터 줄였다.

### 2026-06-02: topdown template replay fixture slice

`@ferrum2d/create-game`의 `topdown` 템플릿에 `public/gameplay-replay.fixture.json`을 추가하고, `ferrum:replay-report`가 public replay helper로 fixture와 현재 Game Spec 기반 replay contract를 비교하도록 했다. 목표는 consumer project의 replay report가 모든 템플릿에서 `not-configured`에 머무르지 않고, Game Spec을 가진 starter부터 agent가 읽을 수 있는 deterministic hash evidence를 제공하게 하는 것이다.

- fixture format은 `ferrum2d.consumer.gameplay-replay.fixture`, version `1`, scenario `topdown-template-game-spec`이다.
- topdown harness는 `resolveShooterGameSpec(...)` 결과를 작게 요약해 `GameStateSnapshot.custom.templateReplay.spec`에 넣고, `createGameplayReplayRun(...)` / `compareGameplayReplayRuns(...)`로 expected fixture와 actual contract run을 비교한다.
- 이 fixture는 browser frame runner나 raw Wasm gameplay runner가 아니다. `pnpm smoke:gameplay-replay`가 담당하는 full Top-down Shooter golden replay와 구분되는 template-level Game Spec replay contract다.
- `ferrum:replay-report`는 통과 시 `status: "validated"`, `configured: true`, `fixture: "public/gameplay-replay.fixture.json"`, expected/actual replay hash와 comparison을 출력한다. Game Spec 또는 fixture가 깨지면 machine-actionable report를 반환하고 non-zero로 종료한다.
- `ferrum:update-replay-fixture`는 현재 Game Spec contract에서 같은 fixture를 재생성하고 `ferrum2d.consumer.gameplay-replay.fixture-update-report`를 stdout으로 출력한다. agent harness는 replay 실패를 덮기 위해 이 명령을 자동 실행하지 말고, 의도한 Game Spec 변경을 이해하고 보고한 뒤에만 사용하도록 안내한다.
- 이 시점의 `minimal`/`platformer`는 아직 runtime replay fixture가 없으므로 `not-configured`를 유지했다. 이후 create-game basic template replay fixture slice에서 template surface replay fixture를 기본 제공하도록 바뀌었다.
- package check는 `topdown/public/gameplay-replay.fixture.json`을 required template file로 포함하고, package consumer smoke는 topdown replay report가 `validated/configured`인지 assert한다. update command follow-up에서 topdown consumer smoke는 fixture hash를 stale 값으로 바꾼 뒤 `ferrum:replay-report`가 non-zero와 `FERRUM_CONSUMER_REPLAY_FIXTURE_INVALID` code, `public/gameplay-replay.fixture.json` 경로 report를 반환하는지 확인한다. 이어서 generated project의 `public/game.json` player speed를 임시 변경해 유효한 fixture와 현재 Game Spec이 갈라진 drift case가 `FERRUM_CONSUMER_REPLAY_MISMATCH` code와 changed JSON path를 반환하는지도 확인한다. 두 실패 경로 모두 `ferrum:update-replay-fixture` 실행, fixture update report hash, 갱신 후 replay report까지 함께 assert한다.
- 검증은 `node --check packages/create-game/templates/topdown/scripts/ferrum-harness.mjs`, `node --check scripts/check-create-game-package.mjs`, `node --check scripts/package-consumer-smoke.mjs`, `pnpm package:check:create-game`, `pnpm package:consumer-smoke -- --skip-build --skip-package-check --templates topdown --artifact-dir /private/tmp/ferrum-consumer-smoke-topdown-stale-fixture`로 확인했다.

이 slice 이후 신규 topdown consumer project는 기본 report command만으로 Game Spec drift를 replay hash mismatch로 볼 수 있다. 남은 후보는 이 template-level contract를 실제 browser/runtime frame replay로 확장할지, 또는 project-specific harness로 남길지 결정하는 것이다.

### 2026-06-02: consumer action diagnostic public smoke slice

`gameplayActionDiagnosticReports(...)`와 `suggestionForActionFailureReason(...)`가 engine workspace unit/type test에만 머물지 않고, `@ferrum2d/ferrum-web` tarball을 설치한 generated consumer project에서도 public entrypoint로 사용할 수 있는지 package consumer smoke에 추가했다. 목표는 roadmap의 agent 자기수정 신호 중 action failure report builder가 npm package surface에서 실수로 빠지지 않게 고정하는 것이다.

- `scripts/package-consumer-smoke.mjs`의 public import smoke는 `failureReasonCounts[5]`와 decoded `actionFailed(spawnQueueFull)` event를 넣어 `FERRUM_GAMEPLAY_ACTION_TRIGGER_FAILURE` report가 생성되는지 확인한다.
- public type smoke는 `ActionFrameDiagnostics`, `GameplayActionFailedEventAction`, `GameplayActionDiagnosticReport` 타입과 helper 호출을 generated project TypeScript compile 경로에서 확인한다.
- 이 검증은 Rust gameplay event ABI나 frame hot path를 바꾸지 않고, package consumer가 agent-facing action diagnostic helper를 public API로 사용할 수 있는지 확인하는 package-surface gate다.
- 검증은 `node --check scripts/package-consumer-smoke.mjs`, `pnpm package:check:create-game`, `pnpm lint`, `pnpm package:consumer-smoke -- --skip-build --skip-package-check --templates topdown --artifact-dir /private/tmp/ferrum-consumer-smoke-topdown-action-diagnostics`로 확인한다.

### 2026-06-02: prefab spawned event dispatch result slice

`GameplayEventSink::push_prefab_spawned_payload(...)`가 단순 side-effect helper에서 `PrefabSpawnedEventDispatchResult`를 반환하도록 조정했다. 목표는 `prefabSpawned` event ABI나 spawn flush 순서를 바꾸는 것이 아니라, prefab payload가 실제 frame-end gameplay event로 push됐는지 spawn flush aggregate가 typed result로 소비하게 하는 것이다.

- `PrefabSpawnedEventDispatchResult`는 `event_pushed`만 담는다. 현재 `prefabSpawned`는 dedupe/skip 정책이 없으므로 sink가 있으면 항상 `true`를 반환한다.
- `consume_spawn_command_dispatch_result(...)`는 더 이상 push 후 무조건 `true`를 쓰지 않고, sink helper의 `event_pushed` 값을 `SpawnFlushResultConsumption`에 전달한다.
- event sink가 없는 compatibility path는 기존처럼 prefab payload는 만들어도 pushed count를 0으로 남긴다.
- 회귀 테스트는 payload helper와 direct helper가 `event_pushed: true`를 반환하면서 기존 `GAMEPLAY_EVENT_PREFAB_SPAWNED` field shape를 유지하는지 고정한다.
- helper는 queue drain/order, actual projectile/prefab spawn side effect, projectile shoot audio emission, public gameplay event ABI를 변경하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "`prefabSpawned` event sink push 여부"는 runtime sink result boundary로 이동했다. actual spawn side effect의 공통 gameplay system 승격과 spawn flush telemetry의 public exposure 여부는 아직 별도 결정으로 남아 있다.

### 2026-06-02: projectile shoot audio dispatch result slice

projectile spawn side effect에서 shoot audio push 여부를 단순 side effect로 흘려보내지 않고 `ProjectileShootAudioDispatchResult`와 `ProjectileSpawnDispatchResult::shoot_audio_event_pushed`로 관측하게 했다. 목표는 projectile audio policy나 event buffer 소유권을 공통화하는 것이 아니라, deferred projectile command가 실제 shoot audio event까지 만들었는지 spawn dispatch/flush aggregate가 구분하게 하는 것이다.

- `push_projectile_shoot_audio_event(...)`는 기존 `push_audio_event(...)` skip 정책을 유지하면서, audio event buffer 길이 변화로 `audio_event_pushed`를 반환한다.
- `spawn_projectile_now(...)`는 bullet spawn, optional arc write, shoot audio push 순서를 유지하고, spawn result에 `shoot_audio_event_pushed`를 포함한다.
- `SpawnFlushResult`는 `projectile_shoot_audio_events_pushed`를 누적해 projectile spawn 수와 shoot audio event 수를 분리한다.
- 회귀 테스트는 non-default sound id가 dispatch/flush result에서 pushed로 보고되는지, `DEFAULT_SOUND_ID`가 helper와 direct projectile spawn result에서 pushed false로 남는지 고정한다.
- helper는 queue drain/order, actual projectile entity spawn, projectile arc write, public audio event ABI를 변경하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "projectile shoot audio event push 여부"는 spawn runtime result/aggregate boundary로 이동했다. shoot sound id/volume/pitch 선택 정책과 projectile command scene-specific enrichment는 아직 Shooter scene config path에 남아 있다.

### 2026-06-02: prefab spawn command dispatch result slice

prefab spawn command dispatch가 `PrefabSpawnedEventPayload`만 반환하던 구조를 `PrefabSpawnCommandDispatchResult`로 확장했다. 목표는 actual prefab entity spawn과 `prefabSpawned` event payload 생성 순서를 바꾸는 것이 아니라, "spawned entity result"와 "event metadata payload"가 같은 command dispatch 결과 안에서 함께 보존되게 하는 것이다.

- `SpawnCommandDispatchResult::Prefab(...)`은 이제 `PrefabSpawnCommandDispatchResult { prefab_spawn, spawned_event_payload }`를 담는다.
- `prefab_spawn.spawned`와 `spawned_event_payload.spawned`는 같은 spawned enemy entity를 가리키며, dispatch test가 이 결합을 고정한다.
- `consume_spawn_command_dispatch_result(...)`는 prefab dispatch result에서 event payload만 꺼내 `GameplayEventSink::push_prefab_spawned_payload(...)`에 전달한다.
- flush aggregate는 기존처럼 prefab spawn 수와 prefab spawned payload 수를 누적한다. payload push 여부는 이전 slice의 `PrefabSpawnedEventDispatchResult`를 그대로 사용한다.
- helper는 queue drain/order, actual enemy spawn side effect, event sink ownership, public gameplay event ABI를 변경하지 않는다.

이 slice 이후 action 쪽 남은 Shooter compatibility 책임 중 "actual prefab spawn result + prefabSpawned metadata payload 결합"은 spawn runtime typed result boundary로 이동했다. prefab texture/template/health/score enrichment와 event push public exposure 여부는 아직 별도 결정으로 남아 있다.

### 2026-06-02: spawn flush frame diagnostics retention slice

`flush_pending_spawns_with_events(...)`가 반환한 `SpawnFlushResult`를 frame loop에서 버리지 않고 `ShooterScene`의 last-frame diagnostics로 보존하게 했다. 목표는 public frame telemetry ABI를 즉시 늘리는 것이 아니라, projectile/prefab spawn flush 결과가 runtime frame 경계에서 관측 가능한 내부 state로 남도록 하는 것이다.

- `ShooterScene`은 `last_spawn_flush_result`를 보유하고, Playing frame의 spawn flush 결과를 여기에 누적한다.
- fixed timestep substep이 여러 번 실행될 수 있으므로 `SpawnFlushResult::accumulate(...)`를 추가해 substep 결과를 saturating add로 합산한다.
- 기존 frame 시작 reset 경로인 `reset_action_trigger_frame_diagnostics(...)`는 action trigger result와 spawn flush result를 함께 초기화한다.
- 회귀 테스트는 projectile fire frame이 `commands_drained`, `projectile_spawns`, `projectile_shoot_audio_events_pushed`를 last-frame result로 남기는지, reset이 이를 `Default`로 돌리는지 고정한다.
- helper는 public frame telemetry slot, Wasm ABI, render/audio command ABI, spawn side-effect 순서를 변경하지 않는다.

이 slice 이후 spawn flush aggregate는 더 이상 production frame loop에서 즉시 폐기되지 않는다. 다음 후보는 이 internal diagnostics를 public `FrameTelemetry`/TS `FrameState`로 노출할지, 아니면 replay/dry-run report 전용 surface로 유지할지 결정하는 일이다.

### 2026-06-02: spawn flush public frame telemetry slice

이전 slice에서 보존한 `SpawnFlushResult`를 Rust `FrameTelemetry` bulk buffer와 TypeScript `FrameState.spawnDiagnostics`로 노출했다. 목표는 spawn flush outcome을 TS callback으로 실행시키는 것이 아니라, agent/debug/reporting이 같은 frame snapshot에서 action diagnostic과 spawn diagnostic을 함께 읽게 하는 것이다.

- Rust `FrameTelemetry` 끝에 spawn flush counter 7개를 append했다. 기존 scalar/action diagnostic index는 유지하고, `frame_telemetry_f64s()`/`frame_telemetry_bytes()` ABI check가 TS 상수와 맞지 않으면 기존처럼 즉시 실패한다.
- `FrameState.spawnDiagnostics`는 `commandsDrained`, `projectileSpawns`, `projectileArcsApplied`, `projectileShootAudioEventsPushed`, `prefabSpawns`, `prefabSpawnedPayloads`, `prefabSpawnedEventsPushed`를 제공한다.
- fixed timestep에서는 `ShooterScene.last_spawn_flush_result`에 substep 결과가 합산된 뒤 telemetry로 기록되므로, render frame 단위 agent report가 substep별 spawn 결과를 놓치지 않는다.
- Breakout/Platformer 같은 non-shooter scene은 spawn diagnostics를 0으로 노출한다. 이는 field shape를 안정화하면서 Shooter-specific spawn flush를 public scene API로 직접 노출하지 않기 위한 선택이다.
- 회귀 테스트는 Engine frame telemetry에서 player projectile fire frame의 spawn/audio count를 확인하고, TS frame pipeline이 same buffer index에서 `FrameState.spawnDiagnostics`를 구성하는지 고정한다.
- helper는 spawn command queue drain/order, projectile/prefab actual spawn side effect, audio/gameplay event ABI, per-entity JS/Wasm callback 정책을 변경하지 않는다.

이 slice 이후 spawn flush aggregate는 public frame snapshot까지 연결됐다. 다음 후보는 `gameplayActionDiagnosticReports(...)`처럼 spawn diagnostics를 machine-actionable report helper로 요약할지, replay smoke artifact summary에 포함할지 결정하는 일이다.

### 2026-06-02: spawn diagnostics report helper slice

`FrameState.spawnDiagnostics`를 agent-facing report로 변환하는 `gameplaySpawnDiagnosticReports(...)` helper를 추가하고, replay smoke artifact summary에 연결했다. 목표는 spawn flush 자체의 정책을 바꾸는 것이 아니라, agent가 "어느 frame에서 어떤 spawn flush metric이 관측됐는지"를 snapshot hash 밖의 구조화 데이터로 읽게 하는 것이다.

- report shape는 action diagnostic helper와 같이 `kind`, `code`, `path`, `expected`, `actual`, `suggestion`을 포함한다. `kind`는 `"gameplay-spawn"`으로 분리해 action failure report와 혼동하지 않게 했다.
- 기본 호출은 깨끗한 frame에서 report를 만들지 않는다. `includeActivity: true`를 넘기면 positive spawn flush metric을 activity report로 요약한다.
- `expectations`를 넘기면 특정 metric의 expected count와 actual count가 다를 때 mismatch report를 만든다. 이 경로는 향후 scenario별 spawn expectation을 replay manifest에 넣을 때 사용할 수 있다.
- `gameplay-replay-smoke`는 `spawnDiagnostics`를 `actionDiagnostics`처럼 golden fixture에서 제외하고 smoke summary/report artifact에만 포함한다. 따라서 replay hash와 committed golden snapshot은 흔들지 않는다.
- package consumer smoke와 public type smoke는 `gameplaySpawnDiagnosticReports(...)`, `suggestionForSpawnDiagnosticMetric(...)`, `SpawnFrameDiagnostics`, `GameplaySpawnDiagnosticReport`가 npm public entrypoint에서 import 가능한지 확인한다.

이 slice 이후 agent 저작 루프는 action failure뿐 아니라 successful projectile/prefab spawn flush 결과도 JSON path report로 읽을 수 있다. 다음 후보는 replay manifest에 scenario별 expected spawn metric을 넣어 spawn count mismatch를 pass/fail diagnostic으로 승격할지 결정하는 일이다.

### 2026-06-02: replay manifest spawn expectation slice

`docs/engine/gameplay-golden/scenarios.json`의 scenario `expected.spawnDiagnostics`를 smoke pass/fail 계약으로 연결했다. 목표는 replay hash로는 잘 보이지 않는 deferred spawn flush count를 agent가 수정 가능한 manifest expectation으로 고정하는 것이다.

- manifest schema validation은 `expected.spawnDiagnostics[].frame`이 capture frame에 포함되는지, metric 이름이 `FrameState.spawnDiagnostics` vocabulary에 속하는지, expected count가 non-negative integer인지 확인한다.
- replay runner는 snapshot capture 시점에 해당 frame의 expectation을 `gameplaySpawnDiagnosticReports(...)`에 넘긴다. count가 다르면 `FERRUM_GAMEPLAY_SPAWN_FLUSH_EXPECTATION_MISMATCH` report가 생성되고 smoke가 `phase: "spawn-diagnostics"`로 실패한다.
- state-enter spawnPrefab success scenario는 frame 4의 `commandsDrained`, `prefabSpawns`, `prefabSpawnedPayloads`, `prefabSpawnedEventsPushed`를 기대값으로 고정한다.
- state-enter projectile success scenario는 frame 4의 `commandsDrained`, `projectileSpawns`, `projectileShootAudioEventsPushed`를 기대값으로 고정한다.
- expectation이 있는 metric은 성공 시 activity report를 중복 생성하지 않는다. smoke summary에는 frame `diagnostics` 값이 남고, report는 mismatch가 있을 때만 `expected` 값을 manifest expectation으로 담는다.
- replay smoke runner는 `FrameState`를 만드는 `buildActionFrameDiagnostics(...)` / `buildSpawnFrameDiagnostics(...)`를 재사용해 action/spawn telemetry decode offset을 public runtime frame pipeline과 공유한다.
- `spawnDiagnostics`는 계속 golden fixture에서 제외된다. 따라서 spawn expectation mismatch는 agent-facing smoke report로 실패하지만 committed replay snapshot/hash를 불필요하게 흔들지 않는다.

이 slice 이후 replay smoke는 "projectile/prefab이 관측됐다"가 아니라 "manifest가 기대한 frame에 기대한 spawn flush count가 나왔다"를 검증한다. 다음 후보는 같은 expectation 모델을 wave/timer spawn coverage까지 넓힐지, 또는 authoring report artifact가 manifest patch 후보를 자동 제안하도록 연결할지 결정하는 일이다.

### 2026-06-02: replay manifest wave/timer spawn expectation coverage

직전 slice의 `expected.spawnDiagnostics` 모델을 authored timer spawn과 wave action spawn까지 확장했다. 목표는 state-enter success path만 검증하는 데서 멈추지 않고, 서로 다른 producer가 같은 deferred spawn flush boundary를 통과하는지 manifest가 고정하게 만드는 것이다.

- `topdown-authored-behavior`는 frame 4의 timer-driven `spawnPrefabAction` 결과를 `commandsDrained`, `prefabSpawns`, `prefabSpawnedPayloads`, `prefabSpawnedEventsPushed` 기대값으로 고정한다.
- `topdown-wave-action-trigger`는 frame 4의 wave-triggered `spawnPrefabAction` 결과를 같은 metric 기대값으로 고정한다.
- 성공 run에서는 expectation 대상 metric의 activity report를 만들지 않고 `diagnostics` 값만 남긴다. 따라서 report 배열은 mismatch가 있거나 expectation이 없는 activity를 관측할 때만 agent 수정 신호로 읽힌다.
- 이 coverage는 Rust simulation이나 spawn flush 정책을 바꾸지 않는다. manifest가 기존 telemetry를 더 많이 검증할 뿐이며 golden fixture/hash에는 여전히 포함하지 않는다.

이 slice 이후 spawn expectation은 authored timer, wave action, state-enter spawnPrefab, state-enter projectile의 서로 다른 producer 경로를 모두 덮는다. 남은 연결점은 report artifact가 현재 `spawnDiagnostics` activity에서 `expected.spawnDiagnostics` patch 후보를 자동 제안하게 만드는 일이었다.

### 2026-06-02: replay smoke spawn expectation patch candidate slice

`gameplay-replay-smoke` summary에 `spawnExpectationPatches`를 추가했다. 목표는 agent가 positive spawn activity를 발견한 뒤 수동으로 metric을 옮겨 적지 않고, manifest에 추가할 `expected.spawnDiagnostics` object 후보를 report artifact에서 바로 읽게 하는 것이다.

- candidate는 `FERRUM_GAMEPLAY_SPAWN_EXPECTATION_PATCH_CANDIDATE` code와 `kind: "gameplay-spawn-expectation"`을 가진다.
- candidate `path`는 실행 중인 manifest의 `scenarios[id=<scenario>].expected.spawnDiagnostics`를 가리키고, `expected`는 `{ frame, metrics }` object다. 기본 manifest를 사용할 때는 repo-relative `docs/engine/gameplay-golden/scenarios.json...` path를 쓰고, `--manifest <path>`로 실험 manifest를 실행하면 해당 manifest path를 그대로 사용한다.
- 이미 manifest expectation으로 검증된 metric은 성공 run에서 activity report와 patch candidate를 만들지 않는다. 따라서 candidate는 "관측됐지만 아직 manifest가 고정하지 않은 spawn metric"만 나타낸다.
- candidate는 smoke pass/fail을 바꾸지 않는다. 의도한 spawn이면 agent가 manifest에 추가하고, 의도하지 않은 spawn이면 spec/action/producer 쪽을 수정한 뒤 replay smoke를 다시 실행한다.
- golden fixture/hash에는 계속 포함하지 않는다. 이 값은 agent-facing smoke report artifact의 patch suggestion surface다.

이 slice 이후 spawn authoring 루프는 observe(activity) -> propose(`expected.spawnDiagnostics` patch) -> validate(smoke mismatch/pass) 경로를 구조화 데이터로 닫는다. 다음 후보는 이 candidate를 consumer project `ferrum:replay-report`에도 연결할지, 또는 engine repo manifest에 자동 apply하는 별도 dry-run command를 둘지 결정하는 일이다.

### 2026-06-02: replay smoke manifest-aware spawn patch path fix

서브에이전트 리뷰에서 `spawnExpectationPatches`의 `path`가 기본 `docs/engine/gameplay-golden/scenarios.json`으로 고정돼 있어, `--manifest <path>` 실험 manifest 실행 시 agent가 잘못된 파일을 patch 대상으로 읽는 문제가 확인됐다.

- `runDeterministicScenario(...)`가 scenario의 `manifestPath`/`manifestIndex`를 replay summary metadata로 전달한다.
- `spawnExpectationPatchCandidates(...)`는 이 metadata를 사용해 기본 manifest에서는 repo-relative path를, repo 밖 실험 manifest에서는 absolute manifest path를 candidate `path`로 사용한다.
- default manifest `topdown-basic`, `/private/tmp` 실험 manifest `topdown-basic`, 기존 expectation이 있는 `topdown-state-enter-projectile-action-trigger` smoke로 확인했다.

이 보정은 replay hash, golden fixture, spawn diagnostics metric 계산을 바꾸지 않는다. agent-facing patch suggestion의 파일 경로만 실행 manifest 기준으로 바로잡는다.

### 2026-06-02: topdown basic spawn expectation manifest promotion

`topdown-basic` replay에서 frame 4의 player projectile spawn activity가 계속 `spawnExpectationPatches` 후보로 남아 있었으므로, 의도된 baseline 동작으로 판단해 manifest expectation으로 승격했다.

- `topdown-basic.expected.spawnDiagnostics`에 frame 4의 `commandsDrained`, `projectileSpawns`, `projectileShootAudioEventsPushed` count를 고정했다.
- 같은 scenario에 `expected.spawnExpectationPatchCount: 0`을 추가해, candidate가 단순히 관측상 비어 있는 것이 아니라 smoke summary 계약으로도 비어 있어야 함을 직접 assert한다.
- replay fixture hash `2f77d0f1`은 변경하지 않았다. spawn diagnostics는 agent-facing telemetry expectation이며 golden snapshot/hash 범위가 아니다.
- `node scripts/gameplay-replay-smoke.mjs --scenario topdown-basic`에서 `spawnDiagnostics.reports`가 빈 배열이고 `spawnExpectationPatches`가 더 이상 출력되지 않는 것을 확인했다.

이 slice 이후 기본 replay manifest의 intentional spawn activity는 모두 `expected.spawnDiagnostics`로 고정된다. 새 spawn producer나 projectile/audio side effect가 추가되면 activity report가 먼저 candidate를 내고, 의도된 변화는 manifest expectation으로 승격하는 루프를 따른다.

### 2026-06-02: consumer replay fixture patch candidate slice

engine repo replay smoke의 patch candidate 루프를 consumer topdown template에도 연결했다. 목표는 생성 프로젝트에서 Game Spec drift가 발생했을 때 agent가 mismatch path만 보는 데서 멈추지 않고, 갱신 가능한 fixture 후보를 같은 report에서 읽게 하는 것이다.

- topdown template `ferrum:replay-report`는 replay mismatch 시 `gameplayReplay.replayFixturePatches`에 `FERRUM_CONSUMER_REPLAY_FIXTURE_PATCH_CANDIDATE`를 포함한다.
- patch candidate의 `path`는 `public/gameplay-replay.fixture.json`이고, `expected`는 현재 Game Spec으로 만든 `ferrum2d.consumer.gameplay-replay.fixture` 전체 후보다.
- 기본 validated report와 fixture-invalid report는 patch candidate를 만들지 않는다. 후보는 유효한 fixture와 유효한 current Game Spec이 서로 갈라진 drift case에만 붙는다.
- `package-consumer-smoke`는 drift report에서 candidate code/path/format/hash가 actual replay hash와 맞는지 assert한다.

이 slice 이후 consumer agent 루프는 detect(mismatch) -> inspect(`replayFixturePatches`) -> apply(`npm run ferrum:update-replay-fixture`) -> validate(`npm run ferrum:replay-report`)로 이어진다. 이는 browser frame runner나 engine repo golden fixture 갱신이 아니라 template-level Game Spec replay contract에 한정된다.

### 2026-06-02: topdown template replay report smoke slice

consumer topdown replay fixture patch candidate를 full generated install 없이도 검증할 수 있도록 `topdown-template-replay-report-smoke.mjs`를 추가했다.

- smoke는 `packages/create-game/templates/topdown`을 임시 폴더로 복사하고 workspace `packages/ferrum-web`를 `node_modules/@ferrum2d/ferrum-web`에 symlink한다.
- 기본 `replay-report`가 `validated`인지, Game Spec drift가 `FERRUM_CONSUMER_REPLAY_FIXTURE_PATCH_CANDIDATE`를 포함하는지, `update-replay-fixture` 이후 다시 `validated`가 되는지 검증한다.
- 표준 명령은 `pnpm smoke:topdown-template-replay-report`이며, public package build를 먼저 수행한 뒤 smoke를 실행한다.
- 이 smoke는 package tarball install, generated project public import/type smoke, production build를 대체하지 않는다. 해당 범위는 계속 `pnpm package:consumer-smoke`가 담당한다.

이 slice는 package consumer smoke가 새 머신/offline store에서 dependency tarball 부재로 실패할 수 있는 상황에서도, agent-facing topdown replay report 계약 자체를 빠르게 고정하기 위한 보조 gate다. 이번 확인에서 online consumer smoke는 generated project install 단계에서 장시간 무출력으로 걸렸고, offline consumer smoke는 store에 `typescript-5.9.3.tgz`가 없어 `ERR_PNPM_NO_OFFLINE_TARBALL`로 실패했다.

### 2026-06-02: behavior state command preflight public helper slice

state command apply의 mutation-free preflight를 public authoring surface로 승격했다. 목표는 agent가 `replaceSupported` state profile 적용 전에 command/id/entity retarget과 runtime clear capability를 dry-run으로 확인하고, clear/apply mutation은 검증된 plan에만 수행하게 만드는 것이다.

- `preflightBehaviorStateMachineStateCommands(...)`는 `BehaviorStateMachineStateCommandPlan`을 runtime entity로 retarget하고 기존 behavior command validation 경로를 preflight runtime에서 실행한다.
- `replaceSupported` mode에서는 clear를 호출하지 않고 필요한 clear method 지원 여부와 clear 대상 이름 목록을 반환한다. missing clear capability는 기존 apply와 같은 machine-actionable diagnostic path를 사용한다.
- `applyBehaviorStateMachineStateCommands(...)`는 같은 preflight helper를 먼저 통과한 뒤에만 clear/apply를 실행한다. 이 helper는 rollback/transaction API가 아니며 frame별 state-enter executor도 아니다.
- `FerrumEngine` facade와 package workflow export 모두에 preflight method/type을 노출했다.

이 slice 이후 agent apply 루프는 propose(plan) -> preflight(command/id/clear capability) -> apply(clear/apply) -> replay 검증 순서로 더 명확해졌다. 남은 판단은 preflight가 아니라 실제 apply 실패 rollback이 필요한지, 또는 완전한 Rust-owned state-enter apply runtime으로 승격할지다.

### 2026-06-02: gameplay authoring dry-run state command preflight report slice

public state command preflight를 agent-facing dry-run report에 연결했다. 목표는 agent가 browser helper나 runtime apply를 실행하기 전, authored variant의 FSM state profile이 `replaceSupported` apply 경계에서 어떤 command/clear operation으로 해석되는지 artifact에서 읽게 만드는 것이다.

- `scripts/gameplay-authoring-dry-run.mjs`는 `gameplayAuthoringDryRun.stateCommandPreflight`를 출력한다.
- 각 FSM machine은 target entity, deterministic fake handle, initial/expected state, state별 command type/result count/clear operation을 포함한다.
- report는 실제 Wasm `Engine` setter나 clear method를 호출하지 않는다. public `preflightBehaviorStateMachineStateCommands(...)`와 dry-run capability stub으로 command/id/clear capability만 검증한다.
- dry-run report 연결 중 기존 `PREFLIGHT_GAMEPLAY_BEHAVIOR_RUNTIME_ENGINE`이 `damageReaction`, timer-triggered action, targeted projectile/dash/melee, collision pickup/sound/particle/despawn command vocabulary를 빠뜨린 점을 보정했다.
- `preflightBehaviorStateMachineStateCommands` 테스트에 damage reaction과 timer-triggered action command를 추가해 public preflight가 현재 state command vocabulary를 따라가도록 고정했다.

이 slice 이후 `pnpm validate:gameplay-authoring:report`는 scene binding과 FSM install plan뿐 아니라 manual `replaceSupported` state command apply 후보까지 mutation 없이 검증한다. 남은 판단은 여전히 실제 apply 실패 rollback이나 Rust-owned state-enter apply runtime이 필요한지다.

### 2026-06-02: state command preflight runtime capability gate slice

`replaceSupported` state command apply에서 clear 이후 actual runtime setter 실패로 빠질 수 있는 범위를 줄였다. 기존 public preflight는 command/id를 full stub runtime으로 검증해, 실제 `FerrumEngine` 또는 test runtime이 optional command setter를 제공하지 않아도 preflight가 통과할 수 있었다.

- `preflightBehaviorStateMachineStateCommands(...)`는 이제 actual runtime의 optional setter/add method 존재 여부를 반영한 no-op capability engine으로 command apply를 dry-run한다.
- 실제 runtime이 `set_gameplay_timer_action_trigger(...)`, targeted action setter, collision side-effect setter 같은 optional command capability를 제공하지 않으면 clear 전에 diagnostic을 반환한다.
- 이 dry-run은 actual setter/clear method를 호출하지 않는다. method 존재 여부만 반영하고 command validation/id resolution은 기존 `applyGameplayBehaviorCommands(...)` 경로를 재사용한다.
- 테스트는 timer-triggered action command가 missing runtime capability일 때 `replaceSupported` clear call이 발생하지 않는지 검증한다.

이 slice는 transaction/rollback API가 아니다. 다만 agent apply에서 "preflight 통과 후 clear, 그 다음 missing setter로 실패"하는 구멍을 줄여 rollback이 필요한 실패 범위를 actual setter return failure나 runtime stale handle 같은 적용 시점 실패로 좁혔다.

### 2026-06-02: state command preflight runtime handle liveness gate slice

`replaceSupported` state command apply에서 stale runtime entity handle 때문에 clear 이후 actual setter가 실패하는 범위를 줄였다. 서브에이전트 리뷰는 TS-only actual setter 예측이 Rust ECS 상태와 bounded component semantics를 중복하므로 부적절하고, 최종 방향은 Rust-owned transactional apply primitive 또는 Rust-owned state-enter apply runtime이어야 한다고 판단했다. 이번 slice는 그 판단을 유지하면서, Rust가 이미 보유한 generation/liveness source of truth만 읽기 전용 query로 preflight에 연결했다.

- Rust `Engine::gameplay_entity_exists(...)`는 `entity_from_handle(...)`과 같은 generation check를 mutation 없이 노출한다.
- public `FerrumGameplayAuthoringApi.gameplayEntityExists(...)`는 raw `set_gameplay_*` setter를 노출하지 않고 저빈도 handle freshness query만 제공한다.
- `preflightBehaviorStateMachineStateCommands(...)`는 runtime이 `gameplay_entity_exists(...)`를 제공하면 target entity handle을 clear/apply 전에 검증한다.
- preflight no-op capability engine도 같은 Rust-owned liveness query를 사용하므로, state command validation 중 source/target handle이 stale이면 실제 setter 호출 전에 diagnostic을 반환한다.
- 테스트는 stale handle에서 `replaceSupported` clear call이 발생하지 않는지 검증한다.

이 slice도 transaction/rollback API가 아니다. 남은 실제 setter 실패 범위는 invalid runtime scalar, fixed-capacity component set overflow, apply 중 runtime state drift처럼 Rust apply 시점에서만 알 수 있는 케이스다. 해당 범위는 TS preflight 확장이 아니라 Rust-owned transactional component apply primitive 또는 Rust-owned state-enter component apply runtime으로 닫아야 한다.

### 2026-06-02: replaceSupported component-slot rollback slice

`replaceSupported` state command apply의 실제 적용 실패 범위를 Rust-owned supported component slot rollback으로 닫았다. 서브에이전트 리뷰는 setter 재호출 기반 복원이 action cooldown, collision reaction cooldown, timer fired/remaining, interaction consumed 같은 live runtime field를 잃는다고 지적했고, snapshot coverage도 state command vocabulary가 아니라 clear scope와 맞춰야 한다고 확인했다.

- Rust `Engine`은 낮은 빈도 authoring 경계에서 단일 entity의 supported gameplay component slot snapshot을 capture/restore/clear할 수 있다.
- snapshot은 `replaceSupported` clear scope와 동일한 health, damage, lifetime, score reward, faction, pickup, interaction, timer trigger, movement, action binding, collision reaction slot을 실제 `World` value copy로 저장한다.
- TypeScript `applyBehaviorStateMachineStateCommands(..., { mode: "replaceSupported" })`는 runtime이 `capture_gameplay_authoring_snapshot(...)`, `restore_gameplay_authoring_snapshot(...)`, `clear_gameplay_authoring_snapshot(...)` hook을 모두 제공할 때만 capture -> clear/apply -> restore-on-failure -> clearSnapshot 순서로 동작한다.
- custom runtime이 hook을 제공하지 않으면 기존 non-transactional clear/apply semantics를 유지한다. hook 일부만 있는 runtime도 transaction으로 간주하지 않는다.
- restore 성공 시 component slot은 되살리지만 full engine transaction은 아니다. setter/clear 중 정리된 physics history, event buffer, spawn/action queue, audio/particle/tween side effect, 지원 subset 밖의 inventory/UI/quest state는 복원 범위가 아니다.
- 테스트는 Rust actual slot restore, stale/despawn handle 거부, TS apply failure/throw/clear failure/capture failure call order, no-hook custom runtime의 legacy non-transactional 동작을 고정한다.

이 slice 이후 `replaceSupported`는 agent가 manual state profile apply를 시도할 때 부분 clear 상태로 남는 주요 위험을 줄인다. 남은 방향은 이 helper를 계속 낮은 빈도 manual apply로 둘지, Rust-owned state-enter component apply runtime으로 승격해 per-frame FSM state enter와 직접 연결할지 결정하는 것이다.

### 2026-06-02: state-enter component apply deferral decision

서브에이전트 아키텍처 리뷰 결과, 다음 vertical slice에서 `applyBehaviorStateMachineStateCommands(...)`를 state-enter runtime에 연결하지 않기로 했다. 이 TS helper는 `BehaviorRecipeCommand[]`를 순회하고 여러 optional Wasm setter/clear hook을 호출하는 낮은 빈도 authoring adapter이므로, frame transition마다 호출하면 Ferrum2D의 Rust-owned hot path와 Wasm boundary 원칙을 깨뜨린다.

- 현재 자동 state-enter runtime은 Rust-owned numeric FSM transition 뒤 bounded `ActionTriggerQueue`에 action id를 적재하는 범위만 지원한다.
- behavior profile command apply는 public preflight/manual apply 경계에 남긴다. scene load, save/load 복원, agent apply처럼 낮은 빈도 명시 호출에서만 사용한다.
- 자동 state-enter component swap이 제품 요구가 되면 먼저 Rust-owned compiled component profile/delta format, deterministic failure policy, frame-loop rollback이 아닌 phase-safe apply 정책을 설계한다.
- 기존 authoring snapshot restore는 component-slot rollback 도구이며 frame-loop transaction으로 승격하지 않는다. physics history, queued spawn/action command, event/audio/particle side effect는 복원 범위가 아니기 때문이다.

### 2026-06-02: gameplay replay fixture index slice

예제별 golden baseline이 늘어난 상태에서 agent가 `scenarios.json`의 큰 input/event metadata 전체를 매번 파싱하지 않아도 되도록 compact fixture index를 추가했다. 이 slice는 runtime semantics를 바꾸지 않고, replay manifest와 fixture inventory의 검증/갱신 루프를 강화하는 tooling 작업이다.

- `docs/engine/gameplay-golden/scenarios.json`은 계속 source of truth이며 `fixtureIndexPath`로 `docs/engine/gameplay-golden/fixture-index.json`을 가리킨다.
- fixture index는 scenario id, runner, fixture path, replay hash, frame count, capture frame count만 담는 파생 catalog다.
- `pnpm smoke:gameplay-replay`는 index가 manifest와 같은 scenario set/hash/path/count를 가리키는지 검증한다.
- `pnpm update:gameplay-replay-golden`은 fixture를 갱신한 뒤 manifest에서 fixture index를 다시 생성한다. 따라서 agent는 index를 손으로 patch하지 않고 manifest/fixture 변경을 source로 삼는다.
- `pnpm validate:gameplay-authoring:report`와 authored behavior variant smoke는 variant의 replay scenario가 fixture index에도 연결되는지 확인해 agent-facing dry-run report에서 hash/path drift를 더 빨리 찾게 한다.

이 slice는 tile impact, faction matrix, movement/collision/action hot-path extraction 같은 새 gameplay semantics를 열지 않는다. 목적은 propose -> validate -> run -> telemetry 루프에서 agent가 golden replay catalog를 더 작은 machine-readable artifact로 읽게 만드는 것이다.

### 2026-06-02: gameplay replay fixture index metadata slice

fixture index를 단순 path/hash 목록에서 agent가 coverage를 빠르게 판단할 수 있는 catalog로 보강했다. source of truth는 계속 `scenarios.json`이고, index는 `pnpm update:gameplay-replay-golden`에서 파생 생성된다.

- 각 scenario는 `description`과 kebab-case `coverageTags`를 필수로 가진다.
- fixture index는 scenario id, description, coverage tags, runner, fixture path, replay hash, frame count, capture frame count를 포함한다.
- `pnpm smoke:gameplay-replay`는 manifest와 index의 description/tag/path/hash/count drift를 검증한다.
- `pnpm validate:gameplay-authoring:report`는 variant가 연결한 replay scenario의 fixture index description/tag/hash를 report에 포함한다.

이 slice 이후 agent는 큰 authoring input metadata를 모두 펼치기 전에 fixture index만 읽고 "어떤 replay가 projectile/state-enter/spawn-diagnostics/action-failure를 검증하는지"를 필터링할 수 있다.

### 2026-06-02: gameplay replay scenario coverage tag vocabulary slice

fixture index metadata를 문자열 관례에만 맡기지 않고 manifest source-of-truth vocabulary로 닫았다. 이 vocabulary는 movement/action/reaction gameplay taxonomy가 아니라 현재 커밋된 golden replay scenario coverage label 목록이다.

- `scenarios.json` root에 `coverageTagDefinitions`를 추가해 모든 tag의 의미를 정의한다.
- `pnpm smoke:gameplay-replay`는 모든 scenario tag가 root vocabulary에 존재하고, 정의된 tag가 최소 하나의 scenario에서 쓰이는지 검증한다. 아직 scenario coverage가 없는 계획용 tag는 이 manifest가 아니라 roadmap에만 둔다.
- fixture index는 `coverageTagDefinitions`도 함께 파생해 agent가 index 파일 하나만 읽어도 tag 의미와 scenario coverage를 함께 볼 수 있다.
- `spawn-diagnostics`, `action-failure`, `variant`는 각각 `expected.spawnDiagnostics`, `expected.actionFailureReason`, `variantPath`와 함께 쓰이는지 가벼운 semantic invariant로 고정한다.
- `pnpm validate:gameplay-authoring:report`는 variant가 연결한 fixture index의 tag definitions도 report에 포함한다.

이 slice도 runtime behavior, replay hash, Wasm ABI를 바꾸지 않는다. agent-facing golden replay catalog의 품질만 높인다.

### 2026-06-02: gameplay authoring dry-run fixture index vocabulary drift slice

`validate:gameplay-authoring:report`가 replay smoke보다 먼저 실행되는 agent validate 단계이므로, fixture index의 coverage tag vocabulary drift도 여기서 machine-actionable report로 잡도록 보강했다.

- `scripts/gameplay-authoring-dry-run.mjs`는 linked fixture index의 `coverageTagDefinitions`가 replay manifest의 `coverageTagDefinitions`와 같은지 비교한다.
- mismatch는 `gameplayAuthoring.replayManifest.fixtureIndex.coverageTagDefinitions` path, expected/actual, 수정 제안을 가진 report로 실패한다.
- `scripts/topdown-authored-behavior-variant-smoke.mjs`도 같은 invariant를 exact assertion으로 고정해 authored variant smoke가 stale fixture index vocabulary를 놓치지 않는다.
- 이 slice는 manifest/index/report 검증만 바꾸며 runtime behavior, replay hash, Wasm ABI, frame hot path를 바꾸지 않는다.

### 2026-06-02: gameplay report artifact schema contract slice

agent 저작 루프의 validate/run 산출물이 JSON envelope만 갖고 schema 계약이 없으면, 소비자 agent나 CI가 report shape drift를 늦게 발견한다. 그래서 report 생성 스크립트가 자기 output을 schema로 즉시 검증하게 했다.

- `schemas/gameplay-authoring-dry-run-report.schema.json`은 `format`, `version`, `ok`, `gameplayAuthoringDryRun`, optional `diagnostics`/`reports`/`errors`, replay fixture index summary의 최소 shape를 고정한다.
- `schemas/gameplay-replay-smoke-report.schema.json`은 `format`, `version`, `ok`, `gameplayReplaySmoke[]`, scenario id, replay hash, diagnostics report envelope, optional errors의 최소 shape를 고정한다.
- `scripts/json-schema-contract.mjs`는 repo가 사용하는 schema subset(`type`, `const`, `enum`, `required`, `properties`, `additionalProperties`, `items`, local `$ref`, `anyOf`, 기본 numeric/string 제약)만 검증하는 작은 helper다. 새 production dependency를 추가하지 않는다.
- `scripts/gameplay-authoring-dry-run.mjs`와 `scripts/gameplay-replay-smoke.mjs`는 report를 콘솔 출력하거나 artifact로 쓰기 전에 각 schema로 self-validate한다.

schema는 volatile telemetry payload 전체를 닫지 않는다. agent가 의존하는 envelope, path/report/suggestion, replay hash 같은 contract만 고정해 report를 진화시킬 여지를 남긴다. 이 slice도 runtime behavior, replay hash, Wasm ABI, frame hot path를 바꾸지 않는다.

### 2026-06-02: gameplay report artifact validator slice

report schema 계약을 생성 시점 self-validation에만 묶지 않고, 기존 artifact 파일을 독립적으로 검증하는 명령도 추가했다.

- `scripts/validate-gameplay-report-artifacts.mjs`는 기본적으로 `artifacts/gameplay-authoring-dry-run/gameplay-authoring-dry-run-report.json`과 `artifacts/gameplay-replay-smoke/gameplay-replay-smoke-report.json`을 읽어 각 schema로 검증한다.
- 이 스크립트는 report를 생성하지 않고, Wasm/Rust를 실행하지 않으며, 이미 존재하는 artifact의 envelope drift만 확인한다.
- `--authoring-report`, `--replay-report`, `--skip-authoring`, `--skip-replay`로 CI나 agent가 특정 artifact만 검증할 수 있다.
- `package.json`에는 `pnpm validate:gameplay-report-artifacts`를 추가했다.

이 slice는 agent가 `validate`/`run` artifact를 별도 단계에서 재검증할 수 있게 하는 tooling-only 작업이다. runtime behavior, replay hash, Wasm ABI, frame hot path는 바꾸지 않는다.

### 2026-06-02: consumer agent report contract guidance slice

엔진 repo의 report schema/validator를 consumer agent template에 그대로 배포하지 않고, consumer-facing harness가 report envelope를 evidence로 읽는 기준을 명시했다.

- shared harness는 report evidence의 최소 조건을 `format`, `version`, `ok`, 실패 시 `reports[].path/message/suggestion`으로 설명한다.
- engine workspace report format(`ferrum2d.gameplay-authoring.dry-run-report`, `ferrum2d.gameplay-replay.smoke-report`)과 generated consumer report format(`ferrum2d.consumer.gameplay-authoring.report`, `ferrum2d.consumer.gameplay-replay.report`)을 구분한다.
- `ferrum-consumer-gameplay`와 `ferrum-consumer-playtest` skill은 report를 evidence로 삼기 전 envelope를 확인하고, 프로젝트가 자체 artifact validator를 제공할 때만 실행하도록 안내한다.
- `@ferrum2d/agents` README와 설치 시 생성되는 AGENTS/CLAUDE/GEMINI 안내도 같은 report evidence 기준을 포함한다.
- `scripts/check-agents-package.mjs`는 agents template source allowlist와 packed tarball forbidden prefix를 보강해 engine dev-only agent/skill, release/package/pages tooling, Gemini 비공식 agent/skill wrapper가 `@ferrum2d/agents`에 섞이지 않게 한다.

이 slice는 consumer agent가 engine repo 전용 schema 파일이나 `pnpm validate:gameplay-report-artifacts`를 일반 consumer 프로젝트에 강제하지 않게 하는 boundary를 유지한다. runtime behavior, package export, replay hash, Wasm ABI, frame hot path는 바꾸지 않는다.

### 2026-06-02: consumer report envelope smoke hardening slice

consumer agent가 report를 evidence로 삼는 기준을 문서에만 두지 않고, generated project smoke가 실제 report envelope shape를 확인하도록 보강했다.

- `scripts/package-consumer-smoke.mjs`는 `gameplayAuthoring.reports`, `gameplayReplay.reports`, top-level failure `reports`, replay fixture patch candidate가 있으면 각 item의 `kind`, `code`, `path`, `message`, `suggestion`이 non-empty string인지 확인한다.
- 성공 report에서는 top-level `reports`를 요구하지 않는다. generated wrapper는 실패 시에만 top-level `reports`를 붙이고, nested `gameplayAuthoring.reports`/`gameplayReplay.reports`를 안정적인 확인 위치로 유지한다.
- `scripts/topdown-template-replay-report-smoke.mjs`도 Game Spec drift patch candidate가 machine-actionable report shape를 갖는지 확인한다.
- exact `message`, exact `suggestion`, `expected`/`actual` payload, telemetry metric key set은 고정하지 않는다. agent-facing payload가 진화할 여지를 남긴다.

이 slice는 consumer report contract smoke만 강화한다. runtime behavior, package export, replay hash, Wasm ABI, frame hot path는 바꾸지 않는다.

### 2026-06-02: create-game template report envelope smoke slice

package consumer smoke의 install/pack/build 범위와 별도로, create-game template harness의 agent-facing report envelope만 빠르게 고정하는 smoke를 추가했다.

- `scripts/create-game-template-report-envelope-smoke.mjs`는 `packages/create-game/templates/manifest.json`의 모든 template을 temp copy로 실행한다.
- temp copy의 `package.json` placeholder만 정규화하고, Game Spec/replay fixture가 있는 template에만 workspace `@ferrum2d/ferrum-web` package를 symlink한다.
- 각 template에서 `ferrum-harness.mjs authoring-report`와 `replay-report`를 직접 실행해 `format`, `version`, `ok`, nested `gameplayAuthoring`/`gameplayReplay`, `packageName`, report array, machine-actionable report item shape를 검증한다.
- `topdown`은 authoring/replay가 `validated`이고 expected/actual replay hash가 일치해야 한다. `minimal`/`platformer`는 deterministic replay fixture 부재를 `not-configured`와 `FERRUM_CONSUMER_REPLAY_NOT_CONFIGURED`로 구조화해야 한다.
- `package.json`에는 `pnpm smoke:create-game-template-reports`를 추가했다.

이 slice는 consumer agent가 template report를 evidence로 삼을 수 있는 최소 envelope drift를 install 없이 빠르게 잡는 보조 gate다. create-game CLI token replacement, package tarball install, public import/type smoke, generated production build는 계속 `pnpm package:consumer-smoke`와 package check가 담당한다. runtime behavior, package export, replay hash, Wasm ABI, frame hot path는 바꾸지 않는다.

### 2026-06-02: tile impact gameplay event telemetry slice

`projectileAction.tileImpact`의 runtime 결과를 agent/replay가 frame event로 관측할 수 있도록 blocking tile hit telemetry를 추가했다. 이 slice는 새 tile policy가 아니라 기존 `"despawn"|"passThrough"|"bounce"` 결과를 구조화해 노출하는 범위다.

- Rust `GameplayEvent`에 `GAMEPLAY_EVENT_TILE_IMPACT = 9`를 추가했다. event ABI는 기존 8 u32 stride를 유지한다.
- `despawn`과 `bounce` blocking tile hit는 projectile entity를 actor/source로 하는 `tileImpact` event를 emit한다. `passThrough`는 기존 의미처럼 tile hit와 tile-side reaction/telemetry를 모두 건너뛴다.
- `tokenId`는 tile impact policy code(`0=despawn`, `1=passThrough`, `2=bounce`)이고, `payloadBits`는 layer index 8비트 + tile index 24비트 packed identity다.
- `flags`는 `targetRemoved`, `bounced`, `identityTruncated`, contact normal direction을 담는다. normal은 world position이 아니라 contact direction vocabulary다.
- TS `decodeGameplayEvents(...)`와 `gameplayActionsForEvents(...)`는 `kind: "tileImpact"`를 decoded action으로 변환하고 `gameplayTileImpactForCode(...)`, `gameplayTileImpactNormalForFlags(...)`, `unpackTileImpactLayerIndex(...)`, `unpackTileImpactTileIndex(...)` helper를 public workflow surface로 노출한다.
- `scripts/gameplay-replay-smoke.mjs`의 gameplay event summary는 `flags`를 포함해 tile normal/bounced/targetRemoved 회귀를 artifact에서 볼 수 있게 했다.

이 slice는 8-u32 event ABI를 넓히지 않으므로 world/contact `x/y` impact position은 아직 제공하지 않는다. 큰 tilemap에서 24비트 tile index 또는 8비트 layer index를 넘는 identity는 packed payload의 하위 비트와 `identityTruncated` flag로만 관측하고, 정확한 identity는 별도 detail buffer/ABI 설계가 필요하다. destructible terrain, bounce count/material policy는 별도 설계 대상이다.

### 2026-06-02: tile impact identity truncation flag slice

tile impact telemetry의 packed identity 한계를 silent truncation으로 두지 않도록 event flag를 추가했다.

- Rust `GameplayEvent::tile_impact(...)`는 layer index가 8비트를 넘거나 tile index가 24비트를 넘으면 `GAMEPLAY_EVENT_FLAG_TILE_IMPACT_IDENTITY_TRUNCATED`를 켠다.
- payload packing은 기존 8-u32 event ABI를 유지하기 위해 그대로 layer 하위 8비트 + tile index 하위 24비트를 담는다.
- TS decoded `GameplayTileImpactEventAction`은 `identityTruncated` boolean을 제공한다. agent/replay는 이 값이 true이면 `layerIndex`/`tileIndex`를 정확한 identity가 아니라 packed fallback으로 취급해야 한다.

이 slice는 impact position detail buffer나 정확한 64-bit tile identity를 열지 않는다.

### 2026-06-02: tile impact golden replay coverage slice

tile impact telemetry가 unit test와 decoder test에만 머물지 않도록 gameplay golden replay coverage를 추가했다.

- `topdown-state-enter-projectile-tile-impact` scenario는 Rust-owned FSM state-enter action trigger가 targetPlayer projectile을 발사하고, 그 projectile이 player에 도달하기 전 blocking tile에 막히는 경로를 고정한다.
- scenario는 `tile-impact` coverage tag를 manifest/index vocabulary에 추가하고, fixture index에도 같은 tag definition과 replay hash를 노출한다.
- captured frame 4는 exact `tileImpact` gameplay event를 검증한다. `kindCode = 9`, `tokenId = 0(despawn)`, `targetRemoved = true`, negative-x contact normal flag, packed layer/tile payload를 fixture와 manifest validation에서 함께 확인한다.
- 같은 frame의 spawn diagnostics도 `projectileSpawns`/`projectileShootAudioEventsPushed`를 유지해 action trigger -> deferred spawn -> tile collision telemetry 흐름이 하나의 replay에서 연결된다.

이 slice는 새 tile policy를 추가하지 않는다. 목적은 agent가 golden replay diff만 봐도 tile impact telemetry 회귀를 잡을 수 있게 하는 것이다.

### 2026-06-02: tile impact FSM predicate slice

tile impact telemetry를 debug/replay 관측에만 두지 않고, projectile-scoped FSM 전이 vocabulary에도 연결했다. 목적은 "타일에 부딪히면 spent/bounce/retry 상태로 간다" 같은 projectile 행동을 JS callback 없이 spec으로 선언하고 Rust-owned FSM이 같은 frame-end event buffer에서 처리하게 하는 것이다.

- TS `BehaviorStateMachineGameplayEventKind`는 `event: "tileImpact"`를 허용하고, predicate에는 실제 telemetry를 emit하는 `tileImpact: "despawn"|"bounce"` 또는 `tileImpactCode: 0|2` 중 하나 이상을 요구한다. 둘을 함께 쓰면 같은 policy를 가리켜야 한다. `"passThrough"`는 tile impact telemetry를 만들지 않으므로 FSM predicate로 거부하고, `"unknown"` decoded telemetry 값은 replay 관측값으로는 남을 수 있지만 authoring predicate로는 허용하지 않는다.
- `runBehaviorStateMachineReplay(...)`는 기존 source-scoped policy를 그대로 사용해 `tileImpact` event의 projectile actor/source가 replay 대상 entity와 일치할 때만 전이 후보로 본다. replay event diff에는 tile impact policy/code, layer/tile index, normal, bounced, identityTruncated, targetRemoved가 포함된다.
- `createBehaviorStateMachineRuntimeInstallPlan(...)`은 `tileImpact` predicate를 event kind `9`, token id `0(despawn)` 또는 `2(bounce)`로 컴파일한다. Rust `add_gameplay_behavior_event_transition(...)` validation도 같은 token 범위만 허용한다.
- Rust FSM runtime은 새 callback surface 없이 기존 frame-end `GameplayEvent` bulk buffer를 읽고, matching projectile entity에 설치된 FSM을 transition 순서대로 최대 1회 전이한다. `tileImpact` 전이 결과는 기존 `behaviorStateChanged` telemetry로 관측된다.
- TS unit test는 offline replay와 runtime install plan에서 `tileImpact: "despawn"`이 token `0`, bounce predicate가 token `2`로 연결되는지 검증하고, `passThrough`/conflicting name-code predicate를 diagnostic으로 거부한다. Rust unit/authoring validation은 invalid tile impact token과 non-emitted token `1`을 거부하는지 검증한다.

이 slice는 impact position detail buffer, destructible terrain, bounce count/material policy, tile-specific BT node를 열지 않는다. FSM predicate는 small data model이며 visual editor나 scripting runtime이 아니다.

### 2026-06-02: authored projectile tileImpact FSM golden slice

tileImpact FSM predicate가 TS unit/offline replay와 Rust setter validation에만 머물지 않도록, 실제 Rust frame loop에서 `tileImpact -> behaviorStateChanged`가 같은 frame에 이어지는 golden replay를 추가했다.

- raw Wasm authoring setter `set_gameplay_projectile_tile_impact(entityId, generation, tileImpactCode)`를 추가했다. 이 setter는 이미 존재하는 authored projectile body의 `World.projectile_tile_impacts` component slot을 generation-checked handle로 설정하는 낮은 빈도 API이며, per-frame JS callback이나 새 runtime action primitive가 아니다.
- `topdown-authored-projectile-tile-impact-fsm` scenario는 authored Bullet layer AABB body에 velocity, `tileImpactCode = 2(bounce)`, projectile-scoped FSM transition을 설치하고 blocking tilemap을 둔다.
- captured frame 2는 exact `tileImpact` event(`kindCode = 9`, token `2`, bounced flag, negative-x normal, targetRemoved false) 뒤에 같은 projectile handle의 `behaviorStateChanged` event가 붙는지 검증한다.
- replay hash `5937ad27`와 fixture-index entry를 고정해 agent가 tile impact predicate runtime regression을 golden diff로 볼 수 있게 했다.

이 slice는 `despawn` tileImpact FSM golden을 열지 않는다. despawn projectile은 collision phase에서 제거될 수 있으므로 stateful FSM owner로 안정적이지 않다. terminal despawn 분기는 telemetry/replay 관측으로 유지하고, 상태 전이를 검증하는 end-to-end path는 살아남는 `bounce` projectile로 고정한다.

### 2026-06-02: melee score attribution scope cleanup

`melee score attribution`을 generic faction matrix의 남은 범위로 계속 적어 두면 이미 닫힌 player/authored melee kill score 경로와 후속 melee faction gate 설계가 섞인다. 현재 구현은 player input 또는 authored `meleeAction.target = "enemies"`가 pending melee combat path를 거쳐 enemy에 damage를 적용하고, kill이면 target entity의 `scoreReward` 또는 기본 score reward를 점수에 반영한다.

- `authored_melee_action_damages_enemy_in_range_and_uses_cooldown`은 player action id `3` melee가 enemy kill 후 `DEFAULT_SCORE_REWARD`를 score에 반영하는 public-ish Shooter test다.
- `pending_melee_enemy_hit_uses_custom_reward_and_damage_event_removed_flag`와 `pending_enemy_target_melee_resolution_reports_damage_removal_and_score`는 custom `scoreReward`가 pending melee resolution과 gameplay damage event 경로에서 유지되는지 고정한다.
- Rust-owned `meleeAction.target = "player"`는 GameOver 경로이며 score/despawn/success event를 만들지 않는다. 이 의미는 `action_trigger_melee_target_player_causes_game_over_without_score`와 `pending_player_target_melee_resolution_reports_game_over_audio_and_hit_event`가 고정한다.

따라서 이 cleanup 시점의 다음 faction 후보에서 `melee score attribution`은 제거하고, 남은 범위는 melee에 `GameplayFaction.damageMask`를 적용할지, non-player `target: enemies`를 열지, full friendly-fire matrix와 scene-level relation table을 둘지의 설계로 좁혔다. 이 cleanup 자체는 새 runtime semantics, Wasm ABI, visual editor, scripting callback을 추가하지 않았다.

### 2026-06-02: melee faction damage gate slice

player/authored melee score 경로와 Rust-owned target-player melee 경로에 같은 `GameplayFaction.damageMask` 정책을 적용했다. 목적은 projectile과 authored collision damage에서 열린 faction authoring을 melee default damage/GameOver에도 연결하되, full relation table이나 non-player `target: enemies` melee를 동시에 열지 않는 것이다.

- `default_melee_damage_allowed(...)`는 `collision_damage_allowed(...)`를 재사용해 source/target 양쪽에 faction이 있을 때만 damage mask를 검사하고, 한쪽이라도 faction이 없으면 legacy allow 동작을 유지한다.
- player/authored `meleeAction.target = "enemies"`는 circle query로 enemy를 찾은 뒤, faction mask가 target enemy를 거부하면 damage, score, hit presentation, gameplay damage event를 만들지 않는다. 유효한 swing 자체의 cooldown 소비 정책은 유지한다.
- Rust-owned `meleeAction.target = "player"`는 player가 range 안에 있어도 source/target faction mask가 player damage를 거부하면 GameOver, game-over audio, hit collision event를 만들지 않는다. trigger가 이미 검증을 통과한 공격이므로 cooldown 소비 정책은 유지한다.
- 회귀 테스트는 scene-neutral faction gate helper, authored player melee denied score path, Rust-owned player-target melee denied GameOver path를 고정한다.

이 slice는 faction-denied telemetry, team relation table, neutral policy 확장, non-player `target: enemies` melee, player health/armor/knockback을 열지 않는다. 실행은 Rust combat phase 안에서 기존 pending melee command와 scratch query를 재사용하며 JS callback이나 per-entity Wasm hot path 호출을 만들지 않는다.

### 2026-06-02: faction damage denied telemetry slice

기본 projectile/melee damage gate가 `GameplayFaction.damageMask` 때문에 damage를 적용하지 않은 이유를 agent/replay가 frame event로 관측할 수 있도록 `factionDamageDenied` gameplay telemetry를 추가했다. 이 slice는 full relation table이나 새 faction semantics가 아니라, 이미 존재하는 default faction gate의 deny 결과를 구조화해 노출하는 범위다.

- Rust `GameplayEvent` ABI는 8-u32 layout을 유지하고 event kind `10`을 추가했다. actor는 damage target, source는 공격 주체이며 `tokenId`는 source faction id, `payloadBits`는 target faction id다.
- `faction_damage_denial(...)` helper는 allow/deny boolean 뒤에 숨겨져 있던 source/target entity와 faction id를 같은 검사 기준으로 반환한다. 한쪽 faction이 없으면 legacy allow이므로 deny telemetry도 만들지 않는다.
- 기본 Bullet->Enemy, Bullet->Player, player/authored enemy-target melee, Rust-owned player-target melee deny 경로가 `factionDamageDenied`를 emit한다. 이 deny는 기존처럼 damage, score, GameOver, hit presentation, default hit audio/particle을 만들지 않는다.
- TS `decodeGameplayEvents(...)`와 `gameplayActionsForEvents(...)`는 `kind: "factionDamageDenied"`를 decoded action으로 변환하고 `sourceFactionId`/`targetFactionId`를 agent-facing field로 노출한다.
- 회귀 테스트는 Rust ABI packing, faction denial helper payload, bullet enemy/player default gate, authored player melee deny, Rust-owned player-target melee deny, TS decoder/action/public API surface를 고정한다.

이 slice는 authored `CollisionReaction::Damage` deny telemetry, faction relation table, neutral/team policy 확장, faction-denied FSM predicate를 열지 않는다. event는 frame-end bulk buffer에만 추가되며 JS callback이나 per-entity Wasm hot path 호출을 만들지 않는다.

### 2026-06-02: authored Damage reaction faction-denied telemetry slice

기본 projectile/melee gate에만 남던 `factionDamageDenied` telemetry를 authored `CollisionReaction::Damage` gate에도 연결했다. 목적은 authored collision reaction이 faction mask 때문에 damage를 적용하지 않은 경우에도 agent/replay가 같은 event contract로 원인을 관측하게 하는 것이다.

- `CollisionReactionSetOutcome`에 bounded `FactionDamageDenial` 결과를 추가해, 성공한 damage outcome과 deny outcome을 같은 authored reaction outcome 흐름에서 보존한다.
- authored `Damage` reaction target이 alive이고 despawn 예정이 아니며 source/target faction mask가 damage를 거부한 경우에만 deny outcome을 기록한다. dead/stale/marked target은 기존처럼 no-op이고 deny telemetry를 만들지 않는다.
- authored outcome summary에 `faction_damage_denied`를 보존해 summary 기반 caller가 "damage 0"과 "faction deny"를 구분한다. Bullet->Enemy authored `Damage` deny는 default projectile deny와 같이 collision hit event, hit audio/particle, score, despawn을 만들지 않는다.
- `collision_gameplay_events_for_reaction_outcome(...)`은 deny outcome을 `CollisionGameplayEventPayload::FactionDamageDenied`로 변환하고, Shooter `GameplayEventSink`는 이를 기존 event kind `10` `factionDamageDenied`로 emit한다.
- event ABI와 TS public surface는 바꾸지 않는다. actor/source/token/payload 의미는 기본 projectile/melee deny telemetry와 동일하게 actor=target, source=attacker/reaction owner, `tokenId=sourceFactionId`, `payloadBits=targetFactionId`다.
- 회귀 테스트는 scene-neutral authored damage deny payload, marked target no-op, Shooter player/enemy authored collision damage deny event, Bullet->Enemy authored deny의 default hit presentation suppression을 고정한다.

이 slice는 full relation table, neutral/team policy 확장, faction-denied FSM predicate, authored collision reaction별 별도 failure reason enum을 열지 않는다. 실행은 기존 collision reaction phase 안에서 bounded outcome slot을 하나 더 채우는 범위이며 JS callback이나 per-entity Wasm hot path 호출을 만들지 않는다.

### 2026-06-02: Rust-owned meleeAction target enemies runtime slice

Rust-owned timer/wave/state-enter trigger에서 `meleeAction.target = "enemies"`를 실행할 수 있게 열었다. 목적은 "함정/소환체/비플레이어 entity가 주변 enemy를 공격한다"는 행동을 JS callback이나 임시 hitbox entity 없이 기존 pending melee command와 combat phase로 표현하게 하는 것이다.

- queued melee planner는 이제 `Player`와 `Enemies` target을 모두 지원한다. `Player` target은 기존처럼 live player entity가 필요하고 source 자신을 target으로 삼으면 `missingActionTarget`이다. `Enemies` target은 source transform만 있으면 plan 가능하며 live player target을 요구하지 않는다.
- Rust-owned trigger `target: enemies`는 검증 성공 시 cooldown을 소비하고 pending melee command를 큐잉한다. whiff도 유효한 공격으로 보아 cooldown을 소비한다.
- combat phase는 기존 enemy-target melee query/damage/score/despawn/presentation/`collisionDamage` event/faction deny 경로를 재사용한다. 다만 attacker 자신이 enemy query에 잡히면 self-hit을 스킵한다.
- 한쪽 faction이 없으면 기존 legacy allow를 유지하고, source/target faction이 모두 있으며 damage mask가 target enemy faction을 거부하면 damage/score/presentation 없이 `factionDamageDenied` telemetry만 남긴다.
- 회귀 테스트는 queued planner success, missing-source precedence, live player target 불필요, cooldown commit, non-player enemy-target melee의 self-hit skip과 other enemy damage/score/event를 고정한다.

이 slice는 full friendly-fire matrix, scene-level relation table, neutral/team policy, player health/armor/knockback, 별도 melee success event, built-in Shooter save snapshot의 non-player action binding 보존을 열지 않는다. 실행은 Rust frame loop 안의 기존 trigger queue와 pending melee command를 사용하므로 Wasm ABI나 TS frame hot path callback surface를 바꾸지 않는다.

### 2026-06-02: neutral faction no-damage contract hardening slice

`faction: "neutral"`이 특별한 runtime 분기가 아니라 `factionId = 0`, 기본 `damages = []`, `damageMask = 0`인 일반 `GameplayFaction`으로 동작한다는 계약을 테스트와 문서에 고정했다. 목적은 neutral/team policy를 넓히기 전에 현재 중립 의미를 agent가 예측 가능한 no-damage source로 사용할 수 있게 하는 것이다.

- TS behavior recipe resolver는 `faction: "neutral"`에 명시적 `damages`가 없으면 빈 damage list를 생성하고, gameplay authoring adapter는 이를 Rust setter의 mask `0`으로 적용한다.
- Rust scene-neutral faction gate는 neutral source와 target faction이 모두 있는 경우 damage를 거부하고 `FactionDamageDenial { sourceFactionId: 0, targetFactionId }`를 만든다.
- Shooter 기본 Bullet->Enemy damage path는 neutral source deny 시 bullet/enemy를 살리고 score, default hit presentation, audio를 만들지 않으며 `factionDamageDenied` telemetry를 남긴다.

이 slice는 full relation table, team alias, neutral target invulnerability, neutral pickup/interaction policy, custom relation override를 열지 않는다. 실행은 기존 bitmask gate와 frame event buffer를 재사용하므로 Wasm ABI나 JS callback surface를 바꾸지 않는다.

### 2026-06-02: neutral faction recipe-to-runtime golden slice

neutral faction 계약을 단위 테스트에만 두지 않고 Top-down authored behavior golden replay에 연결했다. 목적은 `faction: "neutral"` recipe가 TS resolver/dry-run command, `applyGameplayBehaviorCommands(...)` runtime adapter, raw Wasm setter, Rust collision phase, decoded `factionDamageDenied` replay event까지 실제 end-to-end 경로로 통과하는지 고정하는 것이다.

- `topdown-authored-behavior` variant에 `neutral-projectile`/`neutral-enemy` pair를 추가했다. neutral projectile은 `damage + faction: neutral + lifetime` recipe를 갖고, target enemy는 `health + faction: enemy` recipe를 갖는다.
- replay runner는 이 neutral pair만 dry-run에서 생성된 `BehaviorRecipeCommand[]`를 `applyGameplayBehaviorCommands(...)`로 실제 Wasm engine에 적용한다. 기존 authored collision/pickup/interaction/timer coverage는 raw setter 경로를 유지해 기존 baseline 의미를 보존한다.
- golden event frame은 기존 `collisionDamage`와 함께 `factionDamageDenied`를 기대하며, neutral source deny가 실제 decoded replay event와 stable replay hash에 포함되는지 검증한다. score/hit presentation suppression은 별도 Rust 단위 테스트가 직접 고정한다.
- neutral projectile lifetime은 deny가 매 frame 반복되지 않도록 one-shot telemetry coverage로 고정한다.

이 slice는 generic relation table, custom team alias, production frame-loop command apply, visual editor, JS gameplay callback을 열지 않는다. 적용은 authoring frame의 낮은 빈도 command path로 제한되며, frame hot path는 기존 Rust collision/event buffer를 재사용한다.

### 2026-06-02: gameplay replay fixture provenance hardening slice

golden replay fixture가 로컬 checkout 절대경로를 저장하지 않도록 scenario provenance metadata를 repo-relative 값으로 고정했다. 목적은 agent가 replay diff를 읽을 때 개발자 머신 경로 차이 때문에 불필요한 fixture churn을 만들지 않게 하는 것이다.

- `replayWithScenarioMetadata(...)`는 `manifestPath`를 `relativeManifestPath(...)`로 정규화해 fixture에 저장한다.
- 기존 `docs/engine/gameplay-golden/*-replay.json` fixture의 `manifestPath`는 `docs/engine/gameplay-golden/scenarios.json`로 갱신했다.
- read-mode golden fixture validation은 `manifestPath`와 `manifestIndex`가 현재 scenario manifest와 일치하는지도 검증한다. 이 과정에서 stale `manifestIndex` fixture를 실제로 잡았고, 전체 `--update`로 provenance metadata를 재생성했다.

이 slice는 replay hash, runtime behavior, Wasm ABI, public API를 바꾸지 않는다. 변경 범위는 agent-facing replay artifact provenance와 fixture validation contract에 한정된다.

### 2026-06-02: custom numeric faction authoring slice

full generic faction relation table을 열기 전에, Rust가 이미 지원하는 `GameplayFaction` id/mask 범위를 TS authoring surface에서 안전하게 사용할 수 있도록 연결했다. 목적은 agent가 `"player"`/`"enemy"` alias만으로 표현하기 어려운 팀을 숫자 faction id로 선언하되, runtime hot path나 Wasm ABI를 새로 넓히지 않게 하는 것이다.

- `BehaviorRecipeFaction`은 기존 `"neutral"|"player"|"enemy"` alias에 더해 `0..31` numeric faction id를 허용한다.
- resolver와 runtime adapter는 `faction` 및 `damages` 배열의 numeric id를 같은 `0..31` 범위로 검증하고, Rust `set_gameplay_faction(..., factionId, damageMask)`에 기존 bitmask 형식으로 전달한다.
- built-in alias 의미는 그대로 유지한다. `"neutral"=0`, `"player"=1`, `"enemy"=2`이고, custom numeric faction은 기본 `damages`가 빈 목록이라 damage relation을 명시적으로 적어야 한다.
- topdown authored behavior variant schema도 faction reference를 built-in alias 또는 `0..31` integer로 허용한다.
- schema smoke는 recipe 본문뿐 아니라 reusable recipe override 안의 `faction`/`damages`도 같은 `0..31` 계약으로 검증한다. local schema helper는 이 schema가 쓰는 `allOf`/`if`/`then`/`not` 키워드를 해석해 `kind: "faction"` 필수 `faction`과 reference object shape를 focused negative case로 고정한다.
- public type smoke, resolver test, runtime adapter test는 custom id와 최상위 bit `31` damage mask 변환을 고정한다.

이 slice는 scene-level relation table, friendly-fire matrix preset, faction alias registry, custom neutral relation override를 열지 않는다. 실행은 낮은 빈도 authoring adapter와 기존 Rust `GameplayFaction` bitmask runtime을 재사용한다.

### 2026-06-02: replay coverage vocabulary source-of-truth slice

예제별 golden baseline index가 커지면서 `scenarios.json`과 `fixture-index.json` 양쪽에 `coverageTagDefinitions`가 중복되는 구조를 정리했다. 목적은 agent가 replay coverage vocabulary drift를 한 파일에서 추적하고, manifest/index는 같은 vocabulary source를 참조하도록 만드는 것이다.

- `docs/engine/gameplay-golden/coverage-tags.json`을 추가해 replay coverage tag definition의 source of truth로 삼았다.
- `scenarios.json`과 `fixture-index.json`은 inline definition을 제거하고 `coverageTagDefinitionsPath`로 같은 파일을 참조한다.
- replay smoke는 vocabulary 파일 format/version/definition shape를 검증한 뒤 기존 invariant를 유지한다. 모든 scenario tag는 정의돼야 하고, 모든 정의는 최소 하나의 scenario에서 사용돼야 하며, fixture index는 manifest와 같은 vocabulary path를 가리켜야 한다.
- fixture index generation도 inline definition을 다시 쓰지 않고 `coverageTagDefinitionsPath`를 유지한다.
- gameplay authoring dry-run report와 topdown authored behavior variant smoke는 manifest/index의 vocabulary path와 resolved definition content를 모두 비교한다. fixture `coverageTags` 배열은 기존처럼 scenario 배열과 exact order까지 같아야 한다.

이 slice는 replay scenario 의미, replay hash, fixture body, coverage tag vocabulary 자체를 바꾸지 않는다. 중복 metadata ownership만 분리해 agent-facing validation 신호를 강화한다.

### 2026-06-02: consumer replay coverage metadata slice

engine repo golden replay뿐 아니라 create-game Top-down consumer template의 replay report도 coverage metadata를 노출하도록 보강했다. 목적은 consumer project agent가 `ferrum:replay-report` 출력만 보고 해당 fixture가 어떤 gameplay authoring 범위를 검증하는지 구조화 데이터로 확인하게 하는 것이다.

- Top-down template에 `public/gameplay-replay.coverage-tags.json`을 추가하고, consumer replay fixture가 `coverageTagDefinitionsPath`와 `coverageTags`를 가진다.
- `scripts/ferrum-harness.mjs replay-report`는 fixture의 coverage vocabulary file format/version/definition shape, tag uniqueness, definition usage를 검증하고 report에 `coverageTagDefinitionsPath`, `coverageTags`, resolved `coverageTagDefinitions`를 포함한다.
- `update-replay-fixture`는 fixture를 재생성할 때도 coverage metadata를 유지하고 update report에 같은 path/tags를 출력한다.
- package consumer smoke는 validated/stale/drift/update report와 patch candidate가 coverage metadata를 유지하는지 검증한다.

이 slice는 consumer fixture replay hash나 snapshot 의미를 바꾸지 않는다. coverage metadata는 agent-facing report와 fixture provenance를 강화하는 저빈도 검증 데이터다.

### 2026-06-02: consumer smoke command timeout diagnostic slice

`package-consumer-smoke`가 generated project install 같은 외부 dependency 단계에서 장시간 무출력으로 멈추면 agent 검증 루프도 멈춘다. consumer replay coverage metadata smoke 중 이 문제가 재현됐으므로, package consumer smoke에 child command timeout을 추가했다.

- `scripts/package-consumer-smoke.mjs`는 `--command-timeout-ms`와 `FERRUM_CONSUMER_SMOKE_COMMAND_TIMEOUT_MS`를 지원한다. 기본값은 5분이다.
- 각 child command는 timeout 시 `SIGTERM` 후 짧은 grace period를 두고 `SIGKILL`을 시도하며, 실패 메시지는 `command timed out after ...ms`로 command label과 stdout/stderr를 함께 남긴다.
- timeout은 full consumer smoke가 무기한 대기하지 않게 만드는 QA 도구 보강이며, game runtime, template replay hash, package contents를 바꾸지 않는다.

이 slice는 install 문제를 성공으로 처리하지 않는다. 실패를 빠르고 machine-readable한 실패 상태로 바꿔 agent가 원인/후속 조치를 기록할 수 있게 한다.

### 2026-06-02: replay coverage grouping policy slice

coverage tag vocabulary가 단일 파일로 분리된 뒤, 더 큰 scenario set에서 tag의 의도를 빠르게 읽을 수 있도록 grouping/deprecation metadata를 추가했다. 목적은 새 replay scenario를 추가하는 agent가 단순 문자열 목록이 아니라 "어떤 gameplay 영역을 검증하는 tag인가"까지 구조화해서 확인하게 하는 것이다.

- `docs/engine/gameplay-golden/coverage-tags.json`은 `coverageTagGroups`와 `deprecatedCoverageTags`를 가진다.
- `coverageTagGroups`는 group description과 tag 배열을 가지며, replay smoke는 모든 group tag가 active definition에 존재하는지 검증한다.
- replay smoke는 모든 active coverage tag가 최소 하나의 group에 포함돼야 한다고 검증한다.
- `deprecatedCoverageTags`는 active definition과 겹칠 수 없고, scenario `coverageTags`에서 사용될 수 없다.
- `scripts/gameplay-authoring-dry-run.mjs`와 `scripts/topdown-authored-behavior-variant-smoke.mjs`도 같은 coverage registry를 읽을 때 group/deprecated invariant를 검증하고, manifest와 fixture index가 같은 registry metadata를 참조하는지 비교한다.
- `docs/engine/public-api.md`와 `docs/development/quality/smoke-check.md`는 coverage vocabulary가 `coverageTagDefinitions`만이 아니라 `coverageTagGroups`/`deprecatedCoverageTags`까지 포함하는 source-of-truth contract임을 설명한다.

이 slice는 scenario coverage tag 자체, replay hash, fixture body를 바꾸지 않는다. agent-facing vocabulary governance만 추가한다.

### 2026-06-02: consumer replay coverage common-shape slice

engine golden replay와 consumer template replay는 같은 tag set을 공유하지 않는다. engine tag는 Rust-owned gameplay scenario coverage를 설명하고, consumer topdown tag는 생성된 Game Spec template replay contract를 설명한다. 따라서 공통화 대상은 tag vocabulary 자체가 아니라 registry shape와 검증 invariant로 정했다.

- `packages/create-game/templates/topdown/public/gameplay-replay.coverage-tags.json`도 `coverageTagDefinitions`, `coverageTagGroups`, `deprecatedCoverageTags`를 가진다.
- `packages/create-game/templates/topdown/scripts/ferrum-harness.mjs`는 consumer registry의 group/deprecated shape, group tag reference, every-active-tag-grouped, active/deprecated overlap, fixture deprecated tag 사용 금지를 검증한다.
- `ferrum:replay-report`와 `ferrum:update-replay-fixture` report는 resolved `coverageTagDefinitions`, `coverageTagGroups`, `deprecatedCoverageTags`를 포함한다.
- `scripts/check-create-game-package.mjs`, `scripts/package-consumer-smoke.mjs`, `scripts/topdown-template-replay-report-smoke.mjs`, `scripts/create-game-template-report-envelope-smoke.mjs`는 topdown template coverage registry shape와 report metadata를 회귀 gate로 확인한다.
- `update-replay-fixture`는 fixture를 쓰기 전에 생성될 `coverageTags`가 loaded registry active tag이고 deprecated tag가 아닌지 검증한다.

이 slice는 consumer fixture hash, fixture body, engine golden tag set을 바꾸지 않는다. consumer와 engine은 별도 format/tag vocabulary를 유지하지만 agent가 읽는 registry governance shape는 같게 유지한다.

### 2026-06-02: create-game replay catalog manifest slice

여러 consumer template이 서로 다른 replay 준비 상태를 가질 수 있으므로 `packages/create-game/templates/manifest.json`에 template별 `gameplayReplay` catalog metadata를 추가했다. 목적은 agent가 template harness를 실행하기 전에도 어떤 template이 deterministic replay fixture를 기본 제공하는지, 어떤 template이 의도적으로 `not-configured`인지 알 수 있게 하는 것이다.

- `minimal`/`platformer`는 `gameplayReplay.configured: false`와 reason을 가진다.
- `topdown`은 `gameplayReplay.configured: true`, `scenario`, `fixturePath`, `coverageTagDefinitionsPath`를 가진다.
- `scripts/check-create-game-package.mjs`는 manifest replay metadata shape를 검증하고, replay가 configured인 template의 fixture/coverage file 존재, coverage registry shape, fixture envelope, replay run hash/snapshot shape를 함께 검증한다.
- `scripts/create-game-template-report-envelope-smoke.mjs`는 harness `gameplayReplay.configured` 값이 manifest catalog와 일치하는지 검증한다.
- `packages/create-game/README.md`와 `docs/development/quality/smoke-check.md`는 manifest가 consumer replay readiness catalog임을 설명한다.

이 slice는 template replay fixture hash나 runtime behavior를 바꾸지 않는다. replay readiness의 source-of-truth를 package template manifest에 추가한 tooling/catalog 변경이다. 이후 create-game basic template replay fixture slice에서 `minimal`/`platformer`도 configured replay로 전환했다.

### 2026-06-02: create-game basic template replay fixture slice

`minimal`/`platformer`가 계속 `not-configured`이면 consumer agent가 기본 template matrix에서 replay pass/fail evidence를 일관되게 얻지 못한다. 따라서 두 template에도 browser frame runner가 아닌 template surface replay fixture를 추가했다.

- `minimal`/`platformer` package script에 `ferrum:update-replay-fixture`를 추가했다.
- 각 template은 `public/gameplay-replay.coverage-tags.json`과 `public/gameplay-replay.fixture.json`을 가진다.
- `minimal-template-surface` replay는 package dependency 존재, main source 존재, public asset 목록, 기본 harness script 목록을 `GameStateSnapshot.custom.templateReplay`에 고정한다.
- `platformer-template-surface` replay는 built-in platformer template identity, package dependency 존재, main source 존재, 기본 harness script 목록을 `GameStateSnapshot.custom.templateReplay`에 고정한다.
- 두 harness의 `ferrum:replay-report`는 fixture와 현재 template surface replay를 `compareGameplayReplayRuns(...)`로 비교하고, drift 시 `FERRUM_CONSUMER_REPLAY_MISMATCH`와 fixture patch candidate를 제공한다.
- `scripts/package-consumer-smoke.mjs`와 `scripts/create-game-template-report-envelope-smoke.mjs`는 이제 모든 기본 template의 replay report가 `validated`/`configured: true`인지 확인한다.

이 slice는 실제 browser runtime frame replay를 열지 않는다. 목적은 생성 직후 template surface contract와 public replay helper hashing을 모든 기본 template에서 deterministic evidence로 제공하는 것이다.

### 2026-06-02: consumer project-specific runtime replay harness scaffold slice

기본 template surface replay가 준비된 뒤, 실제 consumer game runtime replay를 원하는 프로젝트가 어떤 계약으로 자체 fixture/runner를 추가해야 하는지 agent template surface에 고정했다. 목적은 `@ferrum2d/agents`를 설치한 consumer 프로젝트가 engine workspace 내부 파일에 의존하지 않고 public replay helper만으로 project-specific deterministic evidence를 만들 수 있게 하는 것이다.

- `packages/agents/templates/shared/.agents/harness/ferrum-runtime-replay.md`를 추가해 project-specific runtime replay fixture, coverage registry, report envelope, mismatch diagnostic, update command 규칙을 설명한다.
- 기존 shared game development harness와 `ferrum-consumer-gameplay` skill은 template surface replay가 충분하지 않을 때 새 runtime replay harness를 참조한다.
- runtime replay harness는 `@ferrum2d/ferrum-web` public entrypoint의 `createGameplayReplayRun(...)`, `compareGameplayReplayRuns(...)`, `hashGameStateSnapshot(...)` 사용만 허용하고 `dist/*`, `pkg/*`, `src/*`, generated Wasm binding import를 금지한다.
- `scripts/check-agents-package.mjs`는 새 harness가 template allowlist, pack required files, installer output에 포함되는지 검증하고, public API boundary, forbidden import, coverage registry common shape, `FERRUM_CONSUMER_REPLAY_MISMATCH`, `patchCandidate`, `ferrum:update-replay-fixture`, `gameplayReplay.snapshots.N.snapshot...` 진단 문구를 invariant로 고정한다.
- `packages/agents/README.md`는 설치되는 shared harness 목록과 runtime replay public API boundary를 문서화한다.

이 slice는 consumer 프로젝트에 새 runtime runner 파일을 자동 생성하지 않는다. 범위는 `@ferrum2d/agents`가 설치하는 agent-facing harness 계약과 package QA gate이며, 실제 프로젝트별 runner는 각 게임의 runtime state capture 방식이 명확할 때 이 계약을 따라 추가한다.

### 2026-06-02: create-game runtime replay scaffold slice

`@ferrum2d/agents`에 project-specific runtime replay 계약을 설치한 뒤, `@ferrum2d/create-game` 기본 템플릿에도 선택형 runner scaffold를 추가했다. 목적은 consumer 프로젝트가 template surface replay를 넘어 실제 runtime replay gate를 원할 때 새 파일 구조를 처음부터 만들지 않고, public API boundary를 지키는 `not-configured -> configure -> update fixture -> replay report` 루프를 바로 채울 수 있게 하는 것이다.

- `minimal`/`topdown`/`platformer` template에 `scripts/ferrum-runtime-replay.mjs`를 추가했다.
- 생성 프로젝트 package script에 `ferrum:runtime-replay-report`와 `ferrum:update-runtime-replay-fixture`를 추가했다.
- 기본 scaffold는 `PROJECT_RUNTIME_REPLAY_CONFIGURED = false`라서 생성 직후 `ferrum:runtime-replay-report`는 `ferrum2d.consumer.runtime-gameplay-replay.report` envelope로 `runtimeGameplayReplay.configured: false`, `status: "not-configured"`, `FERRUM_CONSUMER_RUNTIME_REPLAY_NOT_CONFIGURED`를 반환하고 성공한다.
- `ferrum:update-runtime-replay-fixture`는 not-configured 상태에서 `ok: false`, `updateAttempted: true` report를 내고 실패한다. fixture write는 프로젝트별 deterministic `captureProjectRuntimeSnapshots(...)` 구현 뒤에만 가능하다.
- configured 상태의 scaffold는 `@ferrum2d/ferrum-web` public entrypoint에서 `createGameplayReplayRun(...)`, `compareGameplayReplayRuns(...)`, `hashGameStateSnapshot(...)`을 dynamic import하고, generated Wasm binding이나 `dist/*`/`pkg/*`/`src/*`/engine workspace import를 사용하지 않는다.
- `scripts/check-create-game-package.mjs`는 새 runner 파일, generated package script wiring, node syntax, public import boundary, 기본 not-configured report, runtime fixture/coverage file 미포함 정책을 검증한다.
- `scripts/create-game-template-report-envelope-smoke.mjs`와 `scripts/package-consumer-smoke.mjs`는 생성/복사된 template에서 `ferrum:runtime-replay-report`의 machine-actionable not-configured envelope를 확인한다.

이 slice는 actual gameplay runtime capture를 자동 구현하지 않는다. 생성 프로젝트가 어떤 runtime state를 canonical snapshot에 넣을지는 게임별로 다르기 때문에, 기본 scaffold는 capture hook과 replay fixture/update/report 계약만 제공한다.

### 2026-06-02: runtime replay scaffold negative update gate slice

선택형 runtime replay scaffold가 생성 직후 fixture를 실수로 만들지 않도록 not-configured update 경로를 검증 gate로 고정했다. 목적은 agent가 아직 deterministic capture를 구현하지 않은 상태에서 `update-runtime-replay-fixture`로 실패를 덮어쓰는 일을 막는 것이다.

- `scripts/ferrum-runtime-replay.mjs`의 `captureProjectRuntimeSnapshots(...)` 주석을 보강해 fixed timestep, canonical `GameStateSnapshot[]`, public `captureGameStateSnapshot(...)` 사용 가능성, render/audio/DOM/wall-clock/debug/profiler 제외 범위를 명시했다.
- `scripts/check-create-game-package.mjs`는 생성 프로젝트에서 `scripts/ferrum-runtime-replay.mjs update-fixture`가 not-configured 상태에서 non-zero로 실패하고, `ok: false`, `runtimeGameplayReplay.updateAttempted: true`, `FERRUM_CONSUMER_RUNTIME_REPLAY_NOT_CONFIGURED`를 반환하는지 검증한다.
- 같은 package check는 기본 template이 `public/gameplay-runtime-replay.fixture.json`과 `public/gameplay-runtime-replay.coverage-tags.json`을 포함하지 않는 것도 검증한다.
- `scripts/create-game-template-report-envelope-smoke.mjs`는 install 없이 template copy에서 runtime replay report와 update negative path envelope를 함께 확인한다.
- `scripts/package-consumer-smoke.mjs`는 실제 generated consumer install에서도 `ferrum:update-runtime-replay-fixture`가 not-configured 상태에서 실패하고 fixture/coverage file을 만들지 않는지 검증한다.
- `packages/create-game/README.md`와 smoke 문서는 runtime replay report는 선택형 성공 신호이고, update는 configure 전 실패해야 한다는 정책을 설명한다.

이 slice도 runtime capture 자체를 자동 구현하지 않는다. capture 구현 전 fixture write를 막고, 구현 후에는 같은 public replay helper 경로로 비교/갱신하게 만드는 guardrail이다.

### 2026-06-02: runtime replay capture recipe slice

선택형 runtime replay scaffold가 "어떤 상태를 캡처해야 하는가"를 사람이 주석으로만 읽지 않도록, template별 machine-readable recipe 명령을 추가했다. 목적은 consumer agent가 runtime replay 구현 전에 fixed timestep, seed/input sequence, capture frame, canonical/excluded state를 구조화 데이터로 읽고 patch 계획을 세우게 하는 것이다.

- `minimal`/`topdown`/`platformer` template의 `scripts/ferrum-runtime-replay.mjs`는 `recipe` command를 지원한다.
- 생성 프로젝트 package script에 `ferrum:runtime-replay-recipe`를 추가했다.
- recipe format은 `ferrum2d.consumer.runtime-gameplay-replay.recipe`이며, `template`, `scenario`, `fixture`, `coverageTagDefinitionsPath`, `coverageTags`, `deterministicRun`, `canonicalState`, `implementationSteps`를 포함한다.
- `minimal` recipe는 runtime/HUD/debug starter의 scene/custom runtime state를 중심으로 둔다.
- `topdown` recipe는 fixed input sequence와 `builtInShooter`, `custom.gameSpec`, runtime state 캡처를 권장한다.
- `platformer` recipe는 built-in platformer runtime에 대해 project-owned `custom.platformer` JSON state를 캡처하는 방향으로 둔다.
- 모든 recipe는 render commands, audio playback, DOM state, wall-clock timing, debug overlay, profiler output을 canonical replay hash에서 제외한다.
- runtime replay report/update not-configured envelope에도 recipe를 포함해 agent가 실패 보고만 보고도 다음 구현 단계를 알 수 있게 했다.
- `scripts/check-create-game-package.mjs`, `scripts/create-game-template-report-envelope-smoke.mjs`, `scripts/package-consumer-smoke.mjs`는 recipe command와 recipe shape를 검증한다.
- 같은 검증 경로는 recipe `inputSequence` 항목을 `{ frame, action, control }` 계약으로 고정하고, package consumer smoke는 configured runtime replay scaffold가 쓰는 public helper `createGameplayReplayRun`, `compareGameplayReplayRuns`, `hashGameStateSnapshot` import도 직접 호출한다.

이 slice는 여전히 browser/runtime capture를 자동으로 실행하지 않는다. 대신 각 template이 deterministic runtime replay로 승격될 때 따라야 할 capture recipe를 agent-facing 계약으로 고정한다.

### 2026-06-02: minimal headless runtime replay fixture slice

runtime replay recipe를 실제 capture 구현으로 승격하는 첫 template으로 `minimal`을 선택했다. `minimal`은 Game Spec이나 장르별 custom state가 없어, public engine API만으로 headless deterministic runtime replay를 닫기에 가장 작다.

- `packages/create-game/templates/minimal/scripts/ferrum-runtime-replay.mjs`는 `PROJECT_RUNTIME_REPLAY_CONFIGURED = true`로 전환했다.
- capture는 internal `runFrame`, `WasmBridge`, generated wasm binding을 직접 import하지 않고, public `@ferrum2d/ferrum-web` entrypoint의 `createEngine(...)`, `captureGameStateSnapshot(...)`, `createGameplayReplayRun(...)`, `compareGameplayReplayRuns(...)`, `hashGameStateSnapshot(...)`만 사용한다.
- Node의 file URL Wasm fetch 한계를 runtime replay script 내부의 scoped fetch shim으로 보강하고, deterministic `requestAnimationFrame` queue를 사용해 `engine.start()` lifecycle을 fixed timestamp로 전진시킨다.
- recipe와 fixture의 input sequence는 숨은 auto-start가 아니라 `{ frame: 1, action: "press", control: "Enter" }`, `{ frame: 2, action: "release", control: "Enter" }`로 명시한다.
- canonical snapshot은 `captureGameStateSnapshot(...)`의 scene counters와 project-owned `custom.template/runtime` JSON만 포함한다. render commands, audio playback, DOM state, wall-clock timing, debug overlay, profiler output은 계속 제외한다.
- `packages/create-game/templates/minimal/public/gameplay-runtime-replay.fixture.json`과 `gameplay-runtime-replay.coverage-tags.json`을 추가했다.
- runtime replay fixture 파일 추가로 `minimal` template surface public asset 목록도 바뀌었으므로 `public/gameplay-replay.fixture.json`도 함께 갱신했다.
- `packages/create-game/templates/manifest.json`에 `runtimeGameplayReplay` catalog를 추가했다. 이 slice 시점에는 `minimal`만 configured runtime replay를 제공하고, `topdown`/`platformer`는 project-specific canonical state 선택이 필요해 not-configured scaffold로 남았다. 이후 topdown headless runtime replay fixture slice에서 `topdown`도 configured로 승격했다.
- `scripts/check-create-game-package.mjs`, `scripts/create-game-template-report-envelope-smoke.mjs`, `scripts/package-consumer-smoke.mjs`는 manifest의 `runtimeGameplayReplay.configured` 값에 따라 configured fixture/report/update success와 not-configured report/update failure를 분기 검증한다.

이 slice는 browser DOM/canvas replay가 아니다. 하지만 public engine lifecycle을 실제로 boot하고 Rust/Wasm frame update를 fixed clock으로 전진시킨 뒤 `GameStateSnapshot`을 캡처하므로, 이전 scaffold/recipe보다 강한 actual headless runtime evidence다. 다음 승격 후보는 `topdown` 또는 `platformer`지만, 둘은 built-in shooter/platformer state, Game Spec, input sequence, browser placement 같은 canonical state 선택을 먼저 좁혀야 한다.

### 2026-06-02: topdown headless runtime replay fixture slice

`minimal` runtime replay가 public engine lifecycle로 닫힌 뒤, 실제 Game Spec 기반 template인 `topdown`도 configured runtime replay로 승격했다. 목적은 agent가 template surface replay만 보지 않고, generated Top-down Shooter project가 `public/game.json`을 실제 runtime에 적용한 뒤 built-in shooter state까지 deterministic replay evidence로 확인하게 하는 것이다.

- `packages/create-game/templates/topdown/scripts/ferrum-runtime-replay.mjs`는 `PROJECT_RUNTIME_REPLAY_CONFIGURED = true`로 전환했다.
- runtime capture는 `@ferrum2d/ferrum-web` public entrypoint의 `createEngine(...)`, `resolveShooterGameSpec(...)`, `captureGameStateSnapshot(..., { includeBuiltInShooterState: true })`, `createGameplayReplayRun(...)`, `compareGameplayReplayRuns(...)`, `hashGameStateSnapshot(...)`만 사용한다. generated Wasm binding, `dist/*`, `pkg/*`, `src/*`, engine workspace path import는 계속 금지한다.
- Node file URL Wasm fetch shim과 deterministic `requestAnimationFrame` queue로 public engine lifecycle을 headless에서 전진시킨다.
- recipe는 fixed delta `1 / 60`, seed `topdown-project-runtime-seed`, input sequence `ArrowRight` press/release와 `Space` press/release, capture frames `[0, 1, 8, 16, 32]`를 사용한다.
- canonical snapshot은 `GameStateSnapshot.scene`, `builtInShooter`, resolved `custom.gameSpec`, `custom.runtime`을 포함한다. render commands, audio playback, DOM state, wall-clock timing, debug overlay, profiler output은 계속 제외한다.
- `packages/create-game/templates/topdown/public/gameplay-runtime-replay.fixture.json`과 `gameplay-runtime-replay.coverage-tags.json`을 추가했다. 현재 fixture replay hash는 `f4a9044f`, snapshot count는 5다.
- `packages/create-game/templates/manifest.json`은 이 slice 시점에 `minimal`과 `topdown`의 `runtimeGameplayReplay.configured`를 `true`로 선언하고, `platformer`만 not-configured scaffold로 남겼다. 이후 platformer headless runtime replay fixture slice에서 `platformer`도 configured로 승격했다.
- `scripts/check-create-game-package.mjs`, `scripts/create-game-template-report-envelope-smoke.mjs`, `scripts/package-consumer-smoke.mjs`는 hardcoded `minimal` 분기 대신 manifest의 `runtimeGameplayReplay.configured` catalog를 source of truth로 사용한다.

이 slice도 browser DOM/canvas replay는 아니다. 다만 `topdown`의 Game Spec resolve, Rust/Wasm update loop, input/action frame 진행, built-in shooter state capture를 public API로 실제 실행하므로, create-game 기본 shooter template에 대해 agent가 소비할 수 있는 runtime regression gate가 생긴다. 남은 승격 후보는 `platformer`이며, platformer는 built-in scene의 canonical state 선택과 입력 시퀀스가 명확해질 때 configured runtime replay로 전환한다.

### 2026-06-02: platformer headless runtime replay fixture slice

`minimal`/`topdown`에 이어 `platformer` template도 configured runtime replay로 승격했다. 목적은 기본 create-game template matrix 전체가 `runtimeGameplayReplay.configured: true` evidence를 제공하게 하고, consumer agent가 template별 runtime replay readiness를 별도 예외 없이 처리하게 하는 것이다.

- `packages/create-game/templates/platformer/scripts/ferrum-runtime-replay.mjs`는 `PROJECT_RUNTIME_REPLAY_CONFIGURED = true`로 전환했다.
- runtime capture는 `@ferrum2d/ferrum-web` public entrypoint의 `createEngine(...)`, `captureGameStateSnapshot(...)`, `createGameplayReplayRun(...)`, `compareGameplayReplayRuns(...)`, `hashGameStateSnapshot(...)`만 사용한다. generated Wasm binding, `dist/*`, `pkg/*`, `src/*`, engine workspace path import는 계속 금지한다.
- Node file URL Wasm fetch shim과 deterministic `requestAnimationFrame` queue는 `minimal`/`topdown`과 같은 방식으로 scoped restore를 수행한다.
- `setTextureIds(...)`가 현재 shooter scene으로 active scene을 바꾸는 public wrapper 특성을 피하기 위해, platformer runner는 texture id 설정을 먼저 수행한 뒤 `usePlatformerGame()`으로 built-in platformer scene을 boot한다.
- recipe는 fixed delta `1 / 60`, seed `platformer-project-runtime-seed`, 명시적 `Enter` start press/release, `ArrowRight` 이동, `Space` jump press/release, capture frames `[0, 1, 12, 24, 40]`를 사용한다.
- canonical snapshot은 `GameStateSnapshot.scene`, `custom.template`, `custom.platformer`, `custom.runtime`을 포함한다. platformer 전용 built-in snapshot API는 아직 없으므로, platformer scene identity와 controls는 project-owned JSON state로 고정한다. render commands, audio playback, DOM state, wall-clock timing, debug overlay, profiler output은 계속 제외한다.
- `packages/create-game/templates/platformer/public/gameplay-runtime-replay.fixture.json`과 `gameplay-runtime-replay.coverage-tags.json`을 추가했다. 현재 fixture replay hash는 `275b73cb`, snapshot count는 5다.
- `packages/create-game/templates/manifest.json`은 이제 `minimal`/`topdown`/`platformer` 세 기본 template 모두 `runtimeGameplayReplay.configured: true`로 선언한다.
- `scripts/check-create-game-package.mjs`, `scripts/create-game-template-report-envelope-smoke.mjs`, `scripts/package-consumer-smoke.mjs`는 manifest catalog에 따라 세 template 모두 configured runtime fixture/report/update success path를 검증한다.

이 slice도 browser DOM/canvas replay는 아니다. 하지만 기본 Platformer scene 전환, title start input, movement/jump input sequence, Rust/Wasm update loop, canonical scene/custom runtime snapshot을 public API로 실제 실행한다. 따라서 create-game 기본 template matrix의 runtime replay readiness gap은 닫혔다. 남은 후속 후보는 platformer 전용 built-in snapshot API를 별도로 열지 여부지만, 현재 제품 목표에서는 custom JSON canonical state로 충분하다.

## 다음 작업 후보

1. tile-specific impact policy를 더 넓힐지 결정한다. 현재 public 값은 `despawn`/`passThrough`/`bounce`이고 tile event kind는 `tileImpact` telemetry로 열었다. tile identity packing 한계 초과는 `identityTruncated` flag로 관측 가능하게 닫았으며, state-enter projectile -> blocking tile impact telemetry golden replay와 authored bounce projectile -> tileImpact FSM golden replay도 추가했다. 남은 범위는 destructible terrain, world/contact impact position detail buffer, exact large tile identity detail buffer, bounce count/material policy다.
2. full generic faction matrix를 열지 결정한다. 현재 `GameplayFaction`은 authored `Damage` reaction gate, 기본 projectile damage gate, 기본 melee damage/GameOver gate에 적용되고, player/authored/Rust-owned enemy-target melee kill score와 기본 projectile/melee/authored Damage deny telemetry, neutral source no-damage 기본 계약, neutral recipe-to-runtime golden replay, TS authoring의 `0..31` custom numeric faction id는 닫혀 있다. 남은 범위는 full generic friendly-fire matrix, scene-level relation table, named team alias registry, custom neutral relation override다.
3. 공통 `movement_pattern_system` 분리가 필요한 지점을 계속 검증한다. 현재 scene-neutral movement evaluation/application, player `TopdownInput` velocity apply, topdown input movement phase config, frame input snapshot phase contract, full previous input snapshot persistence, player movement/action phase split, enemy movement phase call placement naming, default movement fallback pattern construction, enemy movement phase context, layer movement phase config contract, default fallback 기반 layer phase config helper, `MovementPattern::Chase(Player/Entity)` cache policy와 navigation-backed velocity application, enemy alive loop와 authored/fallback movement dispatch, layer/transform include predicate, unsupported zero-velocity policy는 `crate::gameplay` 또는 명시적 Shooter phase boundary로 빠졌지만, frame input snapshot 생성, active wave/config의 fallback preset 선택, tilemap scratch resolver wiring은 Shooter runtime compatibility path 안에 남아 있다.
4. collision reaction executor 공통화가 필요한 지점을 계속 검증한다. 현재 `CollisionReactionPair`, faction damage gate, authored contact enter/stay tracker와 contact storage, authored `Damage`/`Despawn`/`Pickup` state mutation, sound/particle side-effect commit decision, side-effect sink payload construction, default hit presentation payload construction, entity/entity 양방향 reaction set handoff, pickup 양방향 reaction set handoff, authored collision outcome summary, authored score/GameOver summary, authored gameplay event payload construction, default projectile damage gate, default collision damage/game-over hit state mutation, default damage score delta calculation, score commit arithmetic, score owner field write, GameOver transition idempotency, GameOver audio payload construction, GameOver default audio emission gating, layer/swept-layer pair query helper, pair candidate normalization helper, default presentation suppress policy, tile impact reaction set policy, pickup-only reaction set policy, collision hit presentation event/particle dispatch result, hit audio dispatch result, collision gameplay event dispatch result, hit tween dispatch result는 `crate::gameplay` 또는 Shooter runtime helper로 빠졌지만, collision phase ownership, particle preset lookup, 장르별 default effect 종류 선택은 아직 `combat.rs` 또는 Shooter runtime sink/helper에 남아 있다.
5. 공통 `action_system` 분리가 필요한 지점을 계속 검증한다. 현재 action readiness, prepared action commit token, input action readiness wrapper, input action `FrameInputSnapshot` phase contract, attempted-action readiness failure reason mapping, producer별 readiness failure decision policy, action planner typed-error reason mapping, any-action queued trigger readiness, pattern-kind taxonomy, cooldown commit, action trigger queue storage와 command vocabulary, action trigger phase filter/accessor, action trigger phase collection/drain, action trigger phase aggregate result, bounded action trigger enqueue 실패 판정과 queue-full failure data 반환, Engine-side state-enter action producer의 bounded enqueue 실패 결과 surface, action failure sink helper, trigger-sourced action failure event payload construction, trigger-sourced failure event push glue, 모든 현재 action pattern의 payload extraction(`spawnPrefab`/`dash`/`projectile`/`melee`), queued trigger용 prepared payload dispatch, queued trigger prepared payload variant dispatch, trigger dispatch readiness/payload/failure preparation, timer elapsed result의 timer event/action trigger data mapping, dash target-player transform plan, player input dash transform plan, dash core data/apply helper, queued dash trigger branch result, projectile target-player direction/velocity/spawn transform plan, player input projectile spawn plan, projectile command scene-neutral data construction, queued projectile command scene-specific enrichment, queued projectile trigger branch result, projectile pre-commit admission order, projectile command -> `BulletSpawnRequest` mapping, projectile actual spawn dispatch result, projectile actual entity spawn side effect, projectile shoot audio metadata -> `AudioEvent` push boundary, projectile shoot audio dispatch/aggregate result, melee target support/attack plan, melee attack command scene-neutral data construction, queued melee trigger branch result, melee attack queue result boundary, pending melee drain helper, melee collision query target mask, melee collision live eligibility policy, melee collision query execution, melee enemy default damage/target-despawn state mutation, enemy-target melee resolution result, player-target melee resolution result, melee enemy hit side-effect dispatch result, melee default damage gameplay event payload construction, melee default damage hit presentation payload construction, melee/projectile default damage score delta calculation, score commit arithmetic, score owner field write, GameOver transition idempotency, GameOver audio payload construction, GameOver default audio emission gating, spawnPrefab supported-prefab/source-relative transform plan, spawnPrefab command scene-neutral core data construction, spawnPrefab command scene-specific enrichment, queued spawnPrefab trigger branch result, queued branch result aggregate 연결, action trigger failure reason summary와 frame telemetry diagnostic surface, `FrameState.actionDiagnostics`와 decoded `actionFailed` event를 묶는 public `gameplayActionDiagnosticReports(...)` helper, spawnPrefab placement AABB footprint construction, spawnPrefab pre-commit gate precedence, fixed action spawnPrefab suppress guard, spawnPrefab placement query helper, spawnPrefab pre-commit admission orchestration, spawnPrefab command -> enemy spawn data mapping, prefab actual spawn dispatch result, prefab actual entity spawn side effect, prefab spawn command dispatch result, bounded deferred spawn queue helper, spawn queue push full reason mapping, deferred spawn flush drain/order helper, deferred spawn command dispatch enum contract, prefabSpawned event payload construction/dispatch glue, prefabSpawned command metadata payload mapping, prefabSpawned event sink push result, spawn flush result consumption policy, spawn flush aggregate telemetry result, spawn flush frame diagnostics retention, spawn flush public frame telemetry surface, spawn diagnostics report helper와 replay artifact summary는 `crate::gameplay` 또는 Shooter runtime/helper/public telemetry/report boundary로 빠졌고, collision gameplay event payload dispatch, collision hit presentation payload dispatch, hit particle presentation payload dispatch, hit audio presentation payload dispatch, hit tween presentation payload dispatch는 Shooter runtime method boundary로 모였다. 남은 Shooter runtime orchestration 후보는 command enrichment처럼 장르별 policy가 붙은 glue다.
6. 더 일반적인 Rust-owned state-enter component apply runtime은 즉시 구현하지 않고 요구가 명확해질 때 설계부터 진행한다. 전제는 compiled component profile/delta format, deterministic failure policy, component config와 runtime cooldown/timer state 분리, golden replay coverage다. 현재 `replaceSupported` manual helper는 supported component slot rollback을 갖지만, 자동 state-enter action producer는 action trigger만 실행하며 behavior profile command apply는 public preflight와 manual helper 경계로 유지한다.
7. 예제별 golden baseline index는 `fixture-index.json` 파생 catalog로 분리했고, description/tag/coverage vocabulary까지 검증한다. coverage tag vocabulary는 `coverage-tags.json` source-of-truth 파일로 분리해 manifest/index drift를 닫았고, grouping/deprecation metadata도 replay smoke로 검증한다. Consumer template도 replay fixture/report coverage metadata를 제공하며, engine/consumer는 tag set이 아니라 registry shape와 invariant를 공통화했다. Create-game template manifest는 template별 replay readiness catalog를 가지며, 기본 `minimal`/`topdown`/`platformer` template 모두 deterministic template-surface replay fixture를 제공한다. `@ferrum2d/agents`에는 consumer project-specific runtime replay harness 계약이 설치되고, `@ferrum2d/create-game` 기본 template에는 선택형 `ferrum-runtime-replay.mjs`와 `ferrum:runtime-replay-recipe` capture recipe가 포함된다. `minimal`/`topdown`/`platformer` 세 기본 template 모두 public engine API 기반 headless runtime replay fixture까지 configured 상태로 승격됐다. 남은 범위는 기본 template runtime replay 자체가 아니라, platformer 전용 built-in snapshot API를 열지 여부와 browser playable smoke를 더 긴 showcase로 확장할지 여부다.
8. browser playable smoke를 더 긴 showcase로 확장할지 결정한다. 이 경우 authored state-enter command apply를 자동 runtime으로 승격할지, manual helper로 유지할지 먼저 결정해야 한다.
