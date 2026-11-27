# Physics Spec

Physics Spec은 Ferrum2D의 범용 physics authoring 계약이다. Top-down Shooter 전용 prefab/tilemap 설정과 분리된 `physics` namespace를 사용한다.

코드 기준:

- 타입과 resolver: `packages/ferrum-web/src/physicsSpec.ts`
- authoring/apply helper: `packages/ferrum-web/src/physicsAuthoring.ts`
- Shooter Game Spec 연결: `packages/ferrum-web/src/gameSpec.ts`
- Web runtime mode override: `packages/ferrum-web/src/createEngine.ts`, `packages/ferrum-web/src/createFerrumRuntime.ts`
- sandbox 예제: `examples/physics-sandbox`
- JSON Schema 보조 기준: `schemas/shooter-game-spec.schema.json`

## 현재 적용 범위

현재 구현된 범위:

- `PhysicsMode`: `"none"`, `"arcade"`, `"rigid"`
- `physics` namespace validation/default resolver
- material, layer, body, collider, joint metadata 구조 검증
- material/layer/body/joint 참조 오류 diagnostic
- `createPhysicsWorldFromSpec(...)` 기반 resolved body/joint runtime apply
- `applyPhysicsSceneProfile(...)` 기반 `manual`/`runtime` scene profile apply와 Rust update loop 내부 auto rigid-body step
- `createRigidBody(...)`, `createCollider(...)`, `createJoint(...)` authoring helper
- `createVehicleRig(...)` 기반 chassis/wheel/suspension helper
- distance/rope/spring/pulley/revolute/prismatic/weld/gear joint validation과 runtime apply
- material preset과 layer/mask helper
- `CreateEngineOptions.physicsMode`, `FerrumRuntimeOptions.physicsMode` runtime override
- `FrameState.physics.mode`와 debug overlay의 physics mode 표시
- Top-down Shooter `game.json`의 명시적 `physics.mode`
- generic runtime `edge` collider 생성/API, collision/query/raycast/shape-cast 지원
- category별 physics debug line flags와 DebugOverlay physics metric 표시
- `ccd` debug category의 per-hit 위치 marker와 normal line 표시
- `pnpm smoke:physics` stress/replay smoke runner
- legacy world용 JSON snapshot/restore/replay helper와 native world용 동일 Engine 메모리 checkpoint
- Wasm bulk body state buffer 기반 snapshot/restore ABI와 TypeScript fallback helper
- editor/AI 도구용 `physicsEditor` authoring metadata strip helper와 JSON Schema
- HD-2D `physics.hd2d` authoring/resolved 필드와 body별 `floor`/`elevation`/`height` 검증
- HD-2D body `heightSpan` 기반 collision filter와 body query/raycast/shape-cast optional filter
- `examples/physics-sandbox` browser sandbox, fixture catalog, `pnpm smoke:physics-sandbox`, `pnpm smoke:physics-demo-suite`
- compound collider runtime apply, collider snapshot 조회, body 단위 contact/query/debug
- dedicated `chain` collider runtime storage, collision/query/raycast/shape-cast/debug/snapshot 지원
- `extractTilemapBoundaryChains(...)` 기반 collision tilemap 외곽선 -> Physics Spec chain body 변환
- `PixelMaskTerrain` helper 기반 alpha mask 편집, dirty patch 조회, collision-only tilemap/chain boundary 변환
- `PixelMaskTerrainRuntime` 기반 renderer texture upload, dirty alpha patch upload, chunk collider ownership/rebuild orchestration

따라서 현재 `physics` namespace는 사용자-facing 계약, 검증, 낮은 빈도의 runtime apply 기준을 제공한다. Generic rigid body world는 `createPhysicsWorldFromSpec(...)`로 만들고, built-in runtime loop에 붙일 때는 `applyPhysicsSceneProfile(...)` 또는 `FerrumRuntimeOptions.physicsScene`을 사용한다. 더 직접적인 제어가 필요하면 imperative Physics API인 `spawnRigidBody(...)`, `spawnPhysicsJoint(...)`, `stepRigidBodies(...)`를 사용한다.

`createVehicleRig(...)`는 Physics Spec JSON 필드가 아니라 TypeScript authoring helper다. 새 solver primitive를 추가하지 않고 차체 AABB body, wheel circle body, `prismatic` guide joint, `spring` suspension joint를 생성해 차량/플랫폼 prototype을 빠르게 구성한다.

## 기본 구조

```json
{
  "physics": {
    "mode": "rigid",
    "gravity": [0, 700],
    "continuous": true,
    "solver": {
      "fixedTimestep": true,
      "stepSeconds": 0.0166667,
      "velocityIterations": 8,
      "positionIterations": 8,
      "sleep": true
    },
    "materials": {
      "wood": { "friction": 0.6, "restitution": 0.2, "density": 0.8 }
    },
    "layers": {
      "player": { "mask": ["world"] },
      "world": { "mask": ["player"] }
    },
    "bodies": {
      "crate": {
        "type": "dynamic",
        "position": [320, 120],
        "material": "wood",
        "layer": "world",
        "collider": { "shape": "box", "size": [32, 32] }
      }
    },
    "joints": {
      "hinge": {
        "type": "revolute",
        "bodyA": "world",
        "bodyB": "crate",
        "anchor": [320, 120],
        "limit": { "enabled": true, "lower": -1, "upper": 1 }
      }
    },
    "debug": {
      "colliders": true,
      "contacts": true
    }
  }
}
```

## Physics Mode

| mode | 목적 | 기본 gravity | continuous | fixed timestep | solver iterations |
| --- | --- | --- | --- | --- | --- |
| `none` | 물리 비활성화 또는 직접 제어 | `[0, 0]` | `false` | `false` | `0/0` |
| `arcade` | 가벼운 collision/kinematic 중심 게임 | `[0, 0]` | `false` | `true` | `1/1` |
| `rigid` | dynamic rigid body, joint, stack, realistic response | `[0, 700]` | `true` | `true` | `8/8` |

명시적 `CreateEngineOptions.physicsMode` 또는 `FerrumRuntimeOptions.physicsMode`는 Game Spec의 `physics.mode`보다 우선한다.

## Rigid와 arcade의 기본 backend

활성 Data Scene에서 `createPhysicsWorldFromSpec` 또는 `applyPhysicsSceneProfile`로 `rigid` 또는 `arcade` Spec을 적용하면 고정·가변 시간 모두 기존 2D body·collider·joint를 평면 XY로 제한한 Rapier3D world에 연결한다. 별도의 `configureUnifiedPhysics` 호출은 필요 없다. `mode`를 생략한 Physics Spec도 기본 `arcade`와 기본 `solver.fixedTimestep: true`를 사용하므로 이 경로에 포함된다. `arcade`라는 mode 표시와 중력 `[0, 0]`·CCD 꺼짐·solver `1/1`·sleep 꺼짐 기본값은 유지한다.

`solver.fixedTimestep: false`는 같은 native backend에서 실제 가변 시간 구간을 선택한다. `none`은 native backend를 선택하지 않으며 body/joint 작성은 거절한다. 이 선택은 Spec을 실제 runtime에 적용할 때 수행한다. 인자 없는 `createEngine()`은 [Core 생성 정책](public-api/core.md#생성-시-backend-기본-정책)의 planar native 기본 world를 사용하고, `physics`를 생략한 Data Scene도 이를 따른다. 예외로 `physics`를 생략한 HD-2D heightSpan/AABB actor 문서는 [통합 캐릭터 이동](data-scene-spatial.md#통합-3d-물리의-캐릭터-이동)의 legacy 호환 선택을 따른다. 내장 Shooter·Breakout·Platformer는 기존 `configureUnifiedPhysics`로 별도 planar opt-in을 제공한다. Physics Spec의 `configurePhysicsRuntime`은 Data Scene 전용이며 built-in을 자동 선택하지 않는다. `CreateEngineOptions.physicsBackend: "unified"`는 후속 씬과 physics 생략 Data Scene에 저장된 planar 설정과 clock mode를 적용한다. `"legacy"`는 명시적 호환 선택이며 외부 native 파일 저장·복원은 미완이다.

- `rigid`와 `arcade`의 `solver.fixedTimestep`은 모두 boolean이며 `false`도 허용한다. `CreateEngineOptions.fixedTimestep` override가 있으면 f32 `stepSeconds`가 일치해야 한다. 최초 native 설정의 mode는 생성 override와 비교하고, 이미 활성 native world에서는 Rust의 현재 mode와 비교한다. 따라서 성공한 `configureFixedTimestep(...)`으로 mode를 바꾼 뒤 그 mode의 Spec을 적용할 수 있다. `stepSeconds`는 가변 시간에서도 유지되는 nominal 설정이며 실제 frame 구간 길이와 구분한다.
- 두 mode의 solver는 clock 선택과 무관하게 native `WorldConfig` 범위를 따른다. Velocity/position 반복 수는 각각 정수 `1..32`다. F32 변환 뒤 `stepSeconds`는 `0.0001..0.1`, 중력 각 성분은 유한하고 절댓값 `1,000,000` 이하여야 한다. 범위 밖 값은 설정 전에 거절한다.
- 길이 단위는 `lengthUnit: 1`이며 작성 좌표를 그대로 사용한다. 중력은 `[gravityX, gravityY, 0]`이다. 기존 native solver·capacity 제한도 적용된다.
- native 관절은 적어도 한 endpoint가 dynamic이어야 한다. 모터·limit으로 제어하는 발판은 gravityScale 0인 dynamic 바디로 작성한다.
- 전체 body·joint 생성 후 설정하며 반환 직후 native 일괄 상태 조회가 가능하다. 설정은 물리 tick이나 예약 impulse를 소비하지 않는다.
- 동일한 world 설정과 clock mode로 추가 그룹을 적용하면 기존 누적 시간·예약 입력·frame/step 상한·보간 설정·native identity·solver 상태를 유지한다. 실제 clock mode만 바꿀 때도 현재 frame/step 상한과 보간 설정은 유지한다. 연결된 바디가 있는 world의 다른 전역 설정은 거절한다.
- `createPhysicsWorldFromSpec`의 `configureRuntime: false`는 이미 설정한 world에 geometry만 추가한다. backend를 고르는 옵션이 아니다. `PixelMaskTerrainRuntime`의 chunk도 이 경로를 사용한다.
- scene profile은 전역 설정과 자동/수동 실행을 소유한다. `manual`은 native 물체를 직접 `stepRigidBodies` 호출까지 정지시키고, `runtime`은 `autoStep: false`가 아니면 자동 step을 켠다. 이 계산은 mode와 별개이므로 body/joint가 없는 `none` runtime profile의 `autoStep` 반환도 기존처럼 `true`일 수 있다. `solver.sleep: false`는 개별 body의 `canSleep`보다 우선한다. Native의 `configureAutoRigidBodyStep(boolean)`은 실행 여부만 바꾸며 기존 중력·solver 설정을 유지한다.
- native world에서 `rigid`와 `arcade` 적용은 모두 native 요청이다. 동일한 world 설정은 추가 그룹 동기화에 사용할 수 있지만, 연결된 바디가 있는 world의 전역 설정 변경 제한은 그대로 적용한다. `none`으로 metadata만 바꿔 legacy로 내리는 요청은 기존 world/그룹을 지우기 전에 거절한다. Data Scene의 `useDataScene()` 재활성화는 native 설정을 유지한다. 같은 활성 Shooter·Breakout·Platformer 선택/reset은 해당 native 설정을 유지한다. 다른 built-in 또는 Data Scene 전환은 현재 world를 폐기하며 unified 생성 정책이 있으면 저장 기본값으로 새 native world를 설치한다. 생성 정책 없이 명시적으로 설정한 built-in native는 기존처럼 해제한다.
- `validatePhysicsRuntime(spec)`은 설정 전 capability·clock·mode를 검사한다. `physicsBackend()`는 Rust의 실제 `"legacy" | "unified-3d"` 상태를 반환한다.

생성 시 `physicsBackend`는 `"legacy" | "unified"` 정책이며 `physicsBackend()`가 반환하는 현재 `"legacy" | "unified-3d"` backend와 구분한다.
Unified 정책은 `physicsMode`와 `fixedTimestep`에서 기본 world·clock 설정을 만들며 `none`은 Wasm Engine 생성 전에 거절한다. `fixedTimestep: false`는 native 가변 시간을 선택한다.
같은 scene reset은 current world·manual auto=false·frame/step 상한을 유지하고 다른 scene은 저장 default를 적용한다.
`setGameSpec`의 physics 생략은 같은 Shooter면 현재 native 설정을 유지하고 다른 씬에서 Shooter로 전환하면 생성 default를 상속한다.
명시 physics는 mode override 뒤 선택 대상과 비교하며 같은 Shooter의 현재 설정 또는 전환할 Shooter의 생성 default와 clock mode·중력·nominal step·solver·continuous가 다르면 scene/entity 변경 전에 거절한다. `none`도 거절한다.
Unified policy의 `setGameSpec`은 debug만 적용하고 생성 clock override를 다시 적용하지 않는다. Rust가 현재 clock과 다음 scene의 저장 clock mode를 소유한다. 직접 `configureUnifiedPhysics`는 현재 scene을 고정 시간으로 구성하며, 명시 `configureFixedTimestep`은 현재 clock과 다음 scene에 적용할 저장 mode를 바꾼다.
기존 scene-local `configureUnifiedPhysics`와 Data-only `configurePhysicsRuntime`은 유지한다. Aggregate shape authoring에는 여전히 명시 physics가 필요하다.
전체 사용 예제와 이전 Wasm 거절·메모리 checkpoint 범위는 [Core 생성 정책](public-api/core.md#생성-시-backend-기본-정책)을 따른다.
생성 options/fixedTimestep과 반환 physics metadata는 저장 기본값에서 분리한다. 암묵적 Shooter 전환 뒤의 FrameState와 frame 없는 checkpoint capture도 씬 metadata를 동기화하고, restore는 Spec과 씬 식별 정보를 함께 복구한다.

가변 frame은 `maxFrameSeconds`와 `maxStepsPerUpdate` 안에서 실제 승인 시간을 균등 구간으로 나눈다. 각 구간은 `0.0001..0.1`초이며 Rust의 scene·이동·지형·캐릭터·물리가 같은 길이를 사용한다. 입력 edge는 첫 구간에서 한 번 소비하고 held input은 유지한다. 수동 가변 step은 `0.0001..0.1`초의 한 구간이고, 수동 고정 step은 nominal 값과 일치해야 한다. 잘못된 시간 요청은 입력·예약 impulse를 부분 소비하지 않으며 0초 frame은 시뮬레이션 없이 렌더 출력과 frame 통계를 갱신한다. 상한·실제 소비/제외 시간·설정 실패 계약은 [Core 시간 실행](public-api/core.md#고정가변-시간-실행)을 따른다.

`moveDataSceneActorTo`의 기존 단일 AABB kinematic 주인공은 같은 planar native world에서 실제 충돌체로 검색한다. Native-only 장애물과 타일을 포함하며, query 실패 시 기존 AABB 검색으로 전환하지 않는다. 목적지 grid·이동 상태·애니메이션 API는 유지한다. 전체 Engine/actor 기본 전환이나 HD-2D height controller 전체 이전은 별도 작업이다.

`capturePhysicsBodyStateBuffer`는 component 소유 2D 바디의 읽기 전용 일괄 projection을 제공한다. 행은 기존 31-float/5-u32 형식이며 native solver 저장 형식이 아니다. 직접 생성한 native-only 바디의 XYZ 상태는 `queryUnifiedPhysicsBodyStates`로 조회한다.

### Collider-only 이동 소유권

Data Scene의 native world에서는 명시적 `RigidBody`가 없어도 collider와 0이 아닌 선형·각속도 또는 `Static` 이외의 AI movement pattern이 있는 객체를 implicit kinematic으로 가져온다. 이동 의도가 없는 collider-only 객체는 fixed로 유지한다. 한번 implicit mover가 된 바디는 속도0이나 정지 pattern에서도 kinematic 소유권을 유지하며, 이후 명시적 body component를 붙이면 그 type이 우선한다. Native world 활성화 뒤 새로 생성한 collider-only mover도 World와 native에서 두 번 적분하지 않는다.

지원하는 convex implicit mover의 자동 이동은 기본 mask all·반복4·step/drop0·ledge drop 비허용 controller를 사용한다. 캐릭터별 custom 설정은 명시적 `RigidBody` component가 있는 kinematic에만 지정한다. 명시적 body component를 제거하면 다음 native 준비에서 해당 custom 설정도 지우고 collider-only 후속 body에는 기본값을 적용한다. Rigid body와 collider가 모두 없는 일반 velocity entity는 기존 World 이동을 사용한다. 이 일반 Data Scene 규칙만으로 built-in 전용 실행기를 이전하지 않는다. 내장 Shooter의 별도 단계·Wall mask·기존 swept gameplay 정책은 [Core API](public-api/core.md#내장-shooter의-planar-native-선택)를 따른다. Breakout은 scene 소유 paddle/ball과 first-hit 반응을 별도로 관리하며 [Breakout native 계약](public-api/core.md#내장-breakout의-planar-native-선택)을 따른다. 특히 auto=false update는 입력 명령만 저장하고 직접 승인 물리 구간이 이동·반사·HIT·점수·종료 판정도 실행하므로 Shooter·Data Scene의 수동 실행과 구분한다. [Platformer native 계약](public-api/core.md#내장-platformer의-planar-native-선택)은 기존 AABB·점프 튜닝과 one-way·ground/step·이동 발판 carry를 유지한다. Platformer의 manual update는 axis/jump edge를 누적하고 직접 승인 물리 구간이 이동·점프 타이머·물리 시간/점수·landing까지 처리한다. 예약 jump는 성공한 step에서만 소비하며 동일 Engine memory checkpoint에 포함한다.

## HD-2D Authoring

`physics.hd2d`는 2D XY 물리 위에 floor/elevation/height authoring 정보를 얹기 위한 opt-in 계약이다. 기본값은 disabled이며 기존 Physics Spec body는 `floor: "default"`, `elevation: 0`, `height: 0`으로 resolve되어 기존 런타임 동작을 유지한다.

```json
{
  "physics": {
    "mode": "rigid",
    "hd2d": {
      "enabled": true,
      "defaultHeight": 32,
      "maxStepHeight": 8,
      "maxDropHeight": 16
    },
    "bodies": {
      "player": {
        "type": "kinematic",
        "position": [120, 80],
        "floor": "ground",
        "elevation": 0,
        "height": 32,
        "collider": {
          "shape": "capsule",
          "start": [0, -8],
          "end": [0, 8],
          "radius": 8
        }
      }
    }
  }
}
```

필드 정책:

- `physics.hd2d.enabled`: boolean, 기본 `false`
- `physics.hd2d.defaultHeight`: non-negative finite number, 기본 `0`
- `physics.hd2d.maxStepHeight`: non-negative finite number, 기본 `0`
- `physics.hd2d.maxDropHeight`: non-negative finite number, 기본 `0`
- `body.floor`: non-empty string, 기본 `"default"`
- `body.elevation`: finite number, 기본 `0`
- `body.height`: non-negative finite number, 기본은 `hd2d.enabled`가 `true`이면 `physics.hd2d.defaultHeight`, 아니면 `0`

현재 구현 단계는 `physics.hd2d` authoring/resolved metadata를 runtime body `heightSpan`으로 적용한다. `createPhysicsWorldFromSpec(...)`는 body `floor` 문자열을 deterministic numeric `floorId`로 변환해 `spawnRigidBody(..., { heightSpan })`에 전달한다. `FerrumEngine` body API도 `setPhysicsBodyHeightSpan(...)`, `clearPhysicsBodyHeightSpan(...)`, `getPhysicsBodyHeightSpan(...)`을 제공한다.

Rust core는 `PhysicsFloorId`와 `HeightSpan`을 `World` 선택 component로 저장하며 entity/entity 충돌 pair, swept pair, rigid contact solver, CCD contact filter에서 기존 layer/category filter와 height/floor filter를 AND로 적용한다. 둘 중 하나에 height span이 없으면 기존 호환을 위해 height filter를 통과한다. Body query/raycast/shape-cast API는 query option의 `heightSpan`이 지정된 경우에만 explicit floor/elevation/height 필터를 적용하며, 이때 height span이 없는 legacy body는 결과에서 제외된다.

Shooter Game Spec tile definition도 `floor`, `elevation`, `height`, `kind`, `ramp`, `bridgePortal`, `blocksMovement`, `blocksProjectile`, `blocksVision`, `occluderHeight` metadata를 받을 수 있다. `physics.hd2d.enabled`가 켜져 있으면 tile `height` 기본값은 `physics.hd2d.defaultHeight`이고, Rust tilemap collision cache는 height span이 다른 solid run을 합치지 않는다. `blocksMovement: false`는 양수 collision layer tile을 이동 obstacle에서 제외하며, Rust merged collision cache, kinematic tile movement, tilemap navigation, TypeScript boundary extraction이 같은 의미를 사용한다. `moveHd2dKinematicBodyWithTilemap(...)`은 body `heightSpan`을 사용해 다른 floor의 entity/tile obstacle을 필터링하고, tile `kind/ramp` metadata로 step up/down, stair/ramp elevation 보간, ledge drop opt-in, bridge under-pass를 처리한다. Bridge under-pass 후보는 start/end fixed sample이 아니라 swept segment/tile traversal로 찾으므로, 고속 이동에서도 지나간 bridge tile을 놓치지 않는다. `bridgePortal`은 같은 XY tile에서 lower/upper floor edge를 만들어 `queryTilemapNavigationPath({ heightSpan, toHeightSpan })`가 다층 path를 반환하게 한다. Shooter projectile arc는 bullet height span을 갱신하고, combat/projectile tile hit는 height span overlap과 `blocksProjectile` metadata를 함께 사용한다. `blocksVision`/`occluderHeight`는 `deriveHd2dTileOccludersFromTilemapGrid(...)` helper로 lighting shadow occluder 입력에 연결할 수 있다.

`FerrumEngine.setShooterTileHeightSpan(...)` / `clearShooterTileHeightSpan(...)`은 낮은 빈도 runtime tile height metadata 변경용 API이고, `setShooterTileHd2dMetadata(...)` / `clearShooterTileHd2dMetadata(...)`는 tile kind/ramp/blocking metadata 변경용 API다. tile nearest/raycast/segment-cast/shape-cast/contact/manifold query와 tilemap navigation waypoint/path query도 optional `heightSpan` filter를 지원한다. explicit tile obstacle query filter가 지정되면 height span이 없는 legacy tile은 결과에서 제외된다. explicit navigation filter가 지정되면 height span이 없는 legacy obstacle tile은 해당 filtered path에서 장애물로 취급하지 않는다. Frame telemetry와 DebugOverlay는 HD-2D height filter로 제외된 kinematic entity/tile candidate 수를 노출한다.

Physics world snapshot/replay는 bulk body state ABI v1(`31 floats / 5 u32s`)을 유지한다. Height span은 snapshot `state.heightSpan` sidecar로 보존하고 restore 시 bulk body state 복원 뒤 별도 body API로 복원한다.

별도 multi-hitbox/hurtbox authoring DSL, 고급 roof/wall visibility rule, entity shadow scale/offset, material 기반 lighting response, 3D rigid body solver는 이 HD-2D foundation 범위에 포함하지 않는다.

## Native HD-2D 수동 이동과 충돌 타일맵

일반 자동 물리는 component 소유 kinematic의 입력 속도·AI 이동을 승인 물리 구간마다 native sweep/slide로 처리한다.
지원 source는 AABB·회전 박스·원·캡슐·볼록 다각형과 이 형상들을 여러 fixture로 구성한 복합 충돌체다.
비활성·sensor source fixture를 제외하고 활성 solid fixture의 실제 형상·회전·offset을 각각 검색한다.
상호 mask·sensor/enable·floor/height를 적용하고 높이·층 전환 뒤에는 활성 solid fixture 전체의 도착 겹침을 검사한다.
Edge·chain·mesh source 및 직접 만든 native 바디에는 이 component controller를 자동 부착하지 않는다.
지형 surface 참조점은 단일 AABB의 collider 중심, 다른 형상·복합 source의 body/entity 원점이다.
복합 충돌체 전체 footprint의 타일 rasterization을 수행하는 계약은 아니다.

캐릭터별 한도는 `configureDataSceneKinematicController(handle, options | false)`로 지정한다. 기본값은
`solidMaskBits: 0xffffffff`, `maxIterations: 4`, `maxStepHeight: 0`, `maxDropHeight: 0`, `allowLedgeDrop: false`다.
`maxIterations`는 정수1..8, step/drop은 유한 f32 0..65536이며 옵션은 생략 필드를 기본값으로 채워 전체 교체한다.
`false`는 해당 캐릭터의 설정을 지우고 기본값을 복원하며 controller를 비활성화하지 않는다.
현재 세대의 component 소유 entity라면 비활성·미지원 source 또는 dynamic으로 바뀐 뒤에도 이 초기화를 허용한다.
예를 들어 `engine.configureDataSceneKinematicController(actor, { maxStepHeight: 8, maxDropHeight: 16 })`로
입력·AI 속도 이동에 계단·낙차 한도를 적용한다. 명령 속도는 다음 틱에도 유지하며 WASD 등의 속도 변환은 게임이 담당한다.
자세한 실패·타입 계약은 [자동 이동 설정](public-api/core.md#자동-planar-캐릭터-이동-설정)을 따른다.
같은 옵션 객체를 Physics Spec `bodies[id].kinematicController`와 planar Scene JSON의 기존
`components.body.kinematicController`에도 작성할 수 있다. [JSON 작성 계약](#자동-controller-json-작성)을 따른다.
Studio는 작성 JSON을 읽기 전용으로 표시하며 설정 편집 폼은 제공하지 않는다.
동적 밀기·상대 운동·회전 CCD 수용과 일반 Engine·arcade·기본 씬의 전체 backend 전환은 남아 있다.

활성 planar native world에서 `moveHd2dKinematicBodyWithTilemap`은 component 소유의 단일 solid AABB kinematic body를 native 형상으로 검색한다. 최대 8회 병진 sweep으로 벽을 따라 미끄러지며 native-only 장애물도 검사한다. 기존 ramp/stair 보간, step/drop 한도, ledge opt-in, bridge 아래 통과 규칙은 공통 Rust surface metadata 처리를 사용한다. 높이·층 변경 후 도착 형상이 새 범위의 장애물과 겹치면 위치·heightSpan을 되돌린다. Native pose·pair span과 World 출력은 함께 반영한다.

호출은 물리 tick·fixed remainder나 예약 impulse를 소비하지 않고 기존 속도·누적 회전각을 유지한다. Spatial world·직접 native-only body·compound/다른 source collider는 이 API에서 지원하지 않으며 실패 시 legacy controller를 실행하지 않는다. 이 기능은 일반 입력·AI 전체의 자동 이동 이전이나 회전 CCD·동적 밀기를 완료하지 않는다.

`engine.configureDataSceneCollisionTilemap(options | false)`는 Data Scene의 단일 격자와 HD-2D 정의를 한 번에 교체한다. 같은 grid를 planar Scene JSON의 `physics.collisionTilemap`에도 작성한다. 정의에 `visual`을 생략하면 충돌 전용이며, 선택 `visual`은 기존 2D 타일 렌더러로 셀 크기의 그래픽을 표시한다. 예:

```ts
engine.configureDataSceneCollisionTilemap({
  columns: 1, rows: 1, tileWidth: 10, tileHeight: 10,
  tiles: [1],
  definitions: [{ id: 1, kind: "ramp", blocksMovement: false,
    ramp: { axis: "x", startElevation: 0, endElevation: 8 } }],
});
const moved = engine.moveHd2dKinematicBodyWithTilemap(actor, {
  displacementX: 5, displacementY: 0, maxStepHeight: 8,
});
```

`columns/rows`는 각각 1..256, 정의·tile ID는 최대 256개이며 ID 0은 빈 칸이다. `tiles`는 정확한 row-major 길이의 배열 또는 Uint32Array다. `originX/Y` 기본 0, 양수 tile 크기와 최종 bounds는 유한한 f32 ±1,000,000 범위다. `definitions`에는 사용하는 모든 양수 ID를 한 번씩 선언한다. floorId/elevation/height 기본 0, kind 기본 flat, blocksMovement 기본 true이며 projectile/vision 기본값은 movement를 따른다. ramp는 kind ramp에서만 필수이고 axis는 x/y다. occluderHeight는 height를 기본으로 사용한다.

그래픽은 정의별 `visual: { texture: "loaded-tiles", frame: { u0: 0, v0: 0, u1: 0.5, v1: 1 }, tint: "#ffffff" }`로 작성한다.
`texture`는 이미 로드한 텍스처 이름 또는 0..16,777,215의 정수 ID이며 새 에셋을 자동으로 로드하지 않는다.
`frame`을 생략하면 전체 텍스처를 사용하고 각 UV는 0..1, f32 변환 후에도 너비·높이가 양수여야 한다.
`tint`는 sRGB hex이며 생략하면 흰색이다. 전체 문서 적용은 `colorManagement`에 맞춰 색을 변환한다.
그래픽은 기존 layer 0 배경 타일로 표시하며 별도 entity·스프라이트·렌더 명령 ABI를 추가하지 않는다.
공간 카메라와 그래픽 격자의 조합은 거절한다. 충돌 전용 격자는 기존 planar HD-2D 조합에서 계속 사용할 수 있다.
기존 충돌 packet v1은 유지하며 그래픽이 있을 때만 명시적 native capability v2를 요구한다.
전체 문서 적용은 텍스처 이름을 사전 해석하고 같은 compiled packet을 임시 native 검증과 실제 적용에 사용한다.
이전 충돌 전용 문서에 필드 추가나 변환은 필요하지 않으며 `visual`을 제거하면 충돌 전용 정의로 돌아간다.

잘못된 JS 입력·미지원 Wasm은 throw, 다른 scene·Rust admission 실패는 false다. Native 설정 중에는 후보 지형과 현재 연결된 native body/collider capacity를 검증한 뒤 publish하며 이전 grid·live geometry를 실패로 교체하지 않는다. 아직 import되지 않은 별도 component 편집은 이후 일반 physics admission 대상이다. 새 grid는 단조 revision을 사용하고 다음 native query/tick에서 반영된다. false는 grid를 비우며 씬을 전환하지 않는다. 기존 Shooter 전용 타일 설정 API는 Data Scene에 사용할 수 없다.

## 자동 controller JSON 작성

선택 `PhysicsBodySpec.kinematicController`는 기존 `PhysicsKinematicControllerOptions` 객체다.
생략하면 기본 자동 controller를 사용하고 `{}`는 기본값으로 정규화한다. 작성 값으로 `false`·`null`·배열은
허용하지 않는다. `false` 초기화는 위 runtime API 전용이다. 기존 문서에는 새 필드가 필요하지 않다.

```json
{
  "type": "kinematic",
  "collider": { "shape": "circle", "radius": 8 },
  "kinematicController": { "maxStepHeight": 8, "maxDropHeight": 16, "allowLedgeDrop": false }
}
```

이 객체를 `physics.bodies.player` 같은 body 항목에 둔다. 명시적 `type: "kinematic"`과 enabled body,
하나 이상의 enabled non-trigger convex source가 필요하다. 비활성·trigger fixture는 source 검사에서 제외하며,
활성 solid edge/chain은 허용하지 않는다. `rigid` 또는 `arcade`의 고정·가변 시간에서 적용하고 `none`은
runtime 변경 전에 거절한다. 설정은 runtime을 구성하는 Spec apply 경로에서 설치한다.
`configureRuntime:false`와 authored controller의 조합은 clear/spawn 전에 거절한다.

선택 필드의 기본값·범위는 [자동 이동 설정](public-api/core.md#자동-planar-캐릭터-이동-설정)과 같다.
알 수 없는 키·잘못된 타입·범위를 순수 검증에서 거절하고 입력 객체를 변경하지 않는다. Step/drop은
instance scale과 무관한 월드 단위다. Scene JSON의 기존 body는 `type: "kinematic"`과 별도
`components.collider`를 사용하며 명시적 root `physics.space: "planar-xy"`가 필요하다.
새 shape body의 `body.character`와는 별도 계약이다.

Canonical SDK의 native Spec apply는 전체 Rust checkpoint로 보호한다. 생성·관절·controller admission 실패는
기존 물리 씬·clock·SDK physics metadata와 교체 대상 world의 `clear()` 상태를 복원한다.
Canonical world 결과의 `replace`는 같은 Engine에서만 허용하며 다른 Engine의 결과는 clear 전에 거절한다.
Native apply에는 scene-authoring version1·finalize·runtime checkpoint capability가 모두 필요하며 일부만 제공하는 Wasm도 사전에 거절한다.
이 보호는 외부 asset/GPU 자원이나 custom facade의 부수 효과를 복원하는 계약은 아니다.

## Collider Shape

| shape | 필수 필드 | 상태 |
| --- | --- | --- |
| `aabb`, `box` | `size` 또는 `halfSize` | spec validation, runtime apply |
| `circle` | `radius` | spec validation, runtime apply |
| `capsule` | `start`, `end`, `radius` | spec validation, runtime apply |
| `orientedBox` | `size` 또는 `halfSize` | spec validation, runtime apply |
| `convexPolygon` | `vertices` | spec validation, runtime apply |
| `edge` | `start`, `end` | spec validation, runtime apply |
| `chain` | `vertices`, optional `loop` | spec validation, dedicated runtime apply |

`convexPolygon`은 3-16개 convex vertex만 runtime apply에 사용한다. `chain`은 2-64개 vertex를 하나의 Rust `ChainCollider`로 저장한다. `loop: true`이면 마지막 vertex와 첫 vertex 사이의 closing segment도 collision/query/debug 경로에 참여한다. Rust 내부 broadphase와 narrowphase는 chain segment를 순회하지만 public collider snapshot과 Physics Spec에는 하나의 `chain` collider로 유지된다.

## Authoring/apply API

`@ferrum2d/ferrum-web` entrypoint는 Physics Spec을 runtime world로 적용하는 helper를 export한다.

```ts
import {
  applyPhysicsSceneProfile,
  createPhysicsWorldFromSpec,
  resolvePhysicsSpec,
} from "@ferrum2d/ferrum-web";

const raw = await fetch("/physics.json").then((response) => response.json());
const resolved = resolvePhysicsSpec(raw, { path: "physics" });
const world = createPhysicsWorldFromSpec(runtime.engine, resolved);

runtime.engine.stepRigidBodies(world.stepSeconds, world.stepOptions);

const scene = applyPhysicsSceneProfile(runtime.engine, {
  profile: "runtime",
  physics: resolved,
});
```

반환값은 body id -> `PhysicsEntityHandle`, joint id -> `PhysicsJointHandle`, body/joint count, warning, `stepOptions`, `clear()`를 포함한다. 같은 fixture를 다시 적용할 때는 `createPhysicsWorldFromSpec(engine, next, { replace: previousWorld })`를 사용한다.

`stepOptions.continuous`는 해석을 마친 CCD 설정이다. 캐릭터·지정 경로·step-motion이 없는 통합 물리 world에서
`true`이면 Rapier가 빠른 동적 물체와 고정 콜라이더의 충돌을 검사한다. 동적 물체에서 `ccd: true`를 사용하면
운동학적 물체와 `ccd`를 켜지 않은 동적 물체도 검사 대상에 들어간다. 첫 접촉 틱에 일시적으로 겹칠 수 있고,
이후 접촉 solver가 겹침을 보정한다.
`false`는 CCD를 끈다. 캐릭터 또는 지정 경로·step-motion이 운동 증명 경로를 쓰는 장면에서는 해당 경로의
`CapacityExceeded`와 `UnresolvedMotion`이 계속 보고될 수 있다.

Imperative API에서 `despawnPhysicsEntity(bodyHandle)`이 성공하면 해당 body를 참조하는 모든 joint도 함께 제거된다. 이 cascade는 8종 joint의 양쪽 endpoint에 동일하게 적용되며, 기존 `PhysicsJointHandle`은 즉시 무효화된다. 따라서 body를 먼저 제거한 consumer가 연결 joint마다 `clearPhysicsJoint(...)`를 다시 호출할 필요는 없다. 이미 무효화된 body handle을 전달해 `false`가 반환되는 경우에는 joint 상태도 변경하지 않는다.

`applyPhysicsSceneProfile(...)`은 같은 world apply 결과를 감싸고, `runtime` profile에서는 Rust `Engine.update()` 내부 auto rigid-body step을 켠다. `manual` profile은 body/joint만 적용하고 사용자가 `stepRigidBodies(...)`를 직접 호출하는 기존 경로를 유지한다. 이 통합은 scene 생성/교체 시점의 opt-in API이며 frame hot path에서 entity별 JS/Wasm 왕복을 만들지 않는다.

Apply 정책:

- `physics.mode: "none"`에서 body/joint가 있으면 diagnostic으로 실패한다.
- body당 1개 이상의 collider를 runtime apply한다. `collider`는 단일 collider shorthand이고, `colliders` 배열은 primary collider(index `0`)와 secondary collider(index `1+`)로 적용된다.
- contact/query/debug result는 현재 body/entity 단위로 반환한다. Rust 내부는 collider pair를 순회하지만 public result에는 collider index를 노출하지 않는다.
- collider별 layer/filter/trigger/enabled/material은 runtime apply와 collision/query/debug/contact solver에 반영된다. 낮은 빈도 tooling은 `getPhysicsBodyColliderCount(...)`와 `getPhysicsBodyCollider(...)`로 collider index, type, enabled/trigger, offset, material override, category/mask bit를 조회할 수 있다.
- 현재 개발 소스는 body enabled도 collision/query/raycast/shape-cast 필터에 반영한다. 비활성 body의
  모든 collider는 제외되며 body 없는 collider-only 객체와 활성 sleeping body는 포함한다.
  body snapshot은 비활성 상태도 조회한다. 기존 beta에서 비활성 body의 collider를 query에 남기던
  동작과 달라지므로 게임은 활성 collider-only 객체 또는 명시적 body snapshot으로 조회 목적을 구분한다.
- `bodyA`/`bodyB`의 `"world"`는 helper가 collision-disabled static anchor body로 변환한다.
- `chain`은 하나의 authoring collider이자 하나의 runtime collider로 적용된다. segment별 collision/query/debug 처리는 Rust 내부 구현 세부사항이며 public collider index를 늘리지 않는다.
- apply는 authoring 시점의 낮은 빈도 호출을 대상으로 하며 frame hot path에서 body별 JS/Wasm stream을 만들지 않는다.

## Tilemap/Pixel Mask Helper

`extractTilemapBoundaryChains(...)`는 resolved Shooter tilemap의 `collision: true` layer를 Physics Spec static body map으로 변환한다. 일반 layer에서는 `slope` 또는 `oneWayPlatform` tile을 regular solid boundary에서 제외하고, `collisionOnly: true` layer에서는 양수 tile id를 solid cell로 처리한다. 긴 외곽선은 runtime chain vertex limit에 맞춰 여러 body로 분할된다.

`PixelMaskTerrain`은 alpha mask를 낮은 빈도로 편집하고, dirty rect/alpha patch를 조회하며, collision-only tilemap layer 또는 chain boundary body로 변환하는 helper다. `PixelMaskTerrainRuntime`은 이 helper를 WebGL2 texture와 Physics Spec world apply에 연결한다. 생성 시 전체 texture를 만들고, 이후 dirty alpha patch만 `texSubImage2D`로 업로드할 수 있으며, physics 쪽은 chunk 단위로 boundary chain body를 재생성하고 이전 chunk world를 `clear()`로 교체한다. 큰 편집이 한 번에 너무 많은 chunk를 건드리는 경우 `maxDirtyChunksPerSync`로 rebuild budget을 제한한다. Level streaming manifest와 같은 chunk 단위를 써야 할 때는 `createLevelStreamingPixelMaskTerrainPhysicsOptions(...)`로 `chunkWidth`/`chunkHeight`, boundary tile size/origin을 맞추고, static tilemap chunk는 `tilemapLayerForLevelStreamingChunk(...)` 또는 `extractLevelStreamingTilemapChunkBoundaryChains(...)`로 `ResolvedLevelChunk` 단위 boundary chain을 만든다.

```ts
import {
  initializeFerrumWasm,
  createPixelMaskTerrain,
  createPixelMaskTerrainRuntime,
} from "@ferrum2d/ferrum-web";

await initializeFerrumWasm();
const terrain = createPixelMaskTerrain({ width: 128, height: 64, fill: "solid" });
const runtime = createPixelMaskTerrainRuntime({
  terrain,
  texture: {
    target: renderer,
    textureId: 12,
    upload: { color: [255, 255, 255], alphaScale: 1 },
  },
  physics: {
    engine: ferrum.engine,
    chunkWidth: 32,
    chunkHeight: 32,
    maxDirtyChunksPerSync: 4,
    boundary: { tileWidth: 4, tileHeight: 4, physicsLayer: "world" },
  },
});

runtime.carveCircle(48, 24, 8);
// 최종 사용 후: runtime.destroy(); terrain.destroy();
```

이 runtime helper는 낮은 빈도의 destructible terrain 편집용이다. 프레임 hot path에서 매 entity 단위 JS/Wasm 왕복을 만들지 않는다.

## Joint Type

| type | 주요 필드 | runtime apply |
| --- | --- | --- |
| `distance` | local anchor, `restLength`, `stiffness`, `damping`, `breakDistance` | 지원 |
| `rope` | local anchor, `maxLength`, `stiffness`, `damping`, `breakDistance` | 지원 |
| `spring` | local anchor, `restLength`, `stiffness`, `damping`, `breakDistance` | 지원 |
| `pulley` | `groundAnchorA`, `groundAnchorB`, local anchor, `restLength`, `ratio`, `slack`, `breakDistance` | 지원 |
| `revolute` | `anchor` 또는 local anchor, `limit`, `motor`, `breakDistance` | 지원 |
| `prismatic` | local anchor, `localAxisA`, `referenceAngle`, `limit`, `motor`, `breakDistance` | 지원 |
| `weld` | local anchor, `referenceAngle`, `stiffness`, `damping`, `breakDistance`, `breakAngle` | 지원 |
| `gear` | `ratio`, `referenceAngle`, `breakAngle` | 지원 |

`distance`/`rope`/`spring`의 `localAnchorA`/`localAnchorB`는 각 body local 좌표의 연결점을 지정한다. 생략하면 `{ x: 0, y: 0 }`으로 해석되어 기존 center-to-center 동작과 같다. off-center anchor는 Rust solver에서 anchor point velocity와 회전 관성까지 함께 반영되므로 차량 suspension, hanging object, rope endpoint처럼 body center가 아닌 지점에 힘을 전달하는 authoring에 사용한다. `spring`의 `stiffness`는 0..1 범위의 기존 authoring 값을 유지하며, partial stiffness는 runtime velocity solve에서 soft denominator로 적용된다. `spring`에만 `frequencyHz: 0..1000`과 `dampingRatio: 0..10`을 선택적으로 지정할 수 있다. 주파수가 있으면 기존 stiffness/damping 대신 양 끝점의 유효 질량을 반영하는 implicit spring 응답을 사용한다. 감쇠비 기본값은 1(임계 감쇠)이며 단독 지정은 거부한다. 주파수 0은 spring 응답을 끄고, 계산 주파수는 substep 주파수의 절반 이하로 제한한다. 옵션을 생략하면 기존 동작을 유지한다.

`pulley`는 기본적으로 두 body anchor와 두 world-space ground anchor 사이의 총 길이 `lengthA + ratio * lengthB = restLength`를 유지한다. `groundAnchorA`/`groundAnchorB`는 world 좌표이고, `localAnchorA`/`localAnchorB`는 각 body local 좌표다. `ratio`는 양수만 허용한다. `slack: true`이면 `lengthA + ratio * lengthB <= restLength` 상태에서는 correction과 break 판정을 적용하지 않고, rest length를 초과해 줄이 팽팽해졌을 때만 당긴다. `breakDistance`는 기본 equality pulley에서는 가중 길이 오차의 절댓값, slack pulley에서는 초과 길이 오차가 지정값을 넘으면 joint를 제거한다.

`revolute.limit`은 기본적으로 상대 각도를 `[-pi, pi]` 범위로 정규화한 뒤 `lower`/`upper`와 비교한다. 이 기본값은 기존 hinge authoring과 wrap-around 회전 동작을 보존한다. `limit.continuous: true`이면 정규화하지 않은 누적 상대 각도를 사용하므로 `lower`/`upper`에 `2pi`를 넘는 multi-turn 제한을 줄 수 있다. `limit.continuous`는 revolute joint 전용이며 root `physics.continuous` CCD 설정과 별개다.

`weld`는 두 body의 local anchor와 상대 각도를 고정하는 목적형 joint다. Physics Spec의 `stiffness`/`damping`은 runtime apply 시 anchor constraint와 angular constraint에 함께 적용된다. Rust solver는 off-center anchor position correction을 relative angle correction과 coupled solve로 처리해, anchor gap 보정이 회전 응답 없이 body center만 밀리는 동작을 피한다. 더 세밀하게 나누어야 하는 low-level Web API에서는 `spawnPhysicsJoint({ type: "weld", angularStiffness, angularDamping })`을 사용할 수 있다. `breakDistance`는 두 anchor 간 거리 오차, `breakAngle`은 상대 각도 오차가 지정값을 넘으면 joint를 제거한다. 공통 `breakForce`/`breakTorque` 하중 제한과 파손 이벤트도 지원한다. Hz/감쇠비 옵션은 spring 전용이며 weld에는 적용하지 않는다.

## Snapshot/replay API

다음 JSON snapshot/replay helper는 기존 legacy 저장 형식 전용이다. 실제 native backend에서는 clock mode와 무관하게 `capturePhysicsWorldSnapshot`과 Data Scene 진행 JSON 저장을 거절한다. 새 `rigid`·`arcade` authoring은 가변 시간도 native를 선택하므로 기존 JSON 저장 경로와 구분한다.

Physics world JSON의 capture/restore는 실제 backend뿐 아니라 world/snapshot의 Spec도 사전 검사한다. `physicsBackend()`가 명시적으로 `legacy`를 반환해야 하며 getter가 없거나 결과가 native/unknown이면 거절한다. 현재 Engine이 legacy여도 Spec이 `rigid` 또는 고정 시간 `arcade`이면 거절한다. 복원 거절은 staging·기존 world 제거·restore transaction을 시작하기 전에 이루어지므로 옛 fixed-arcade 파일을 새 SDK에서 복원하면서 native로 전환하지 않는다. `none` 또는 `solver.fixedTimestep: false`가 명시된 `arcade` Spec만 legacy JSON helper의 대상이다. Arcade의 누락·비boolean clock 값을 가변 시간의 의미로 해석하지 않으며, 기존 고정 시간 arcade 파일의 자동 migration이나 legacy solver 상태의 native 변환은 제공하지 않는다.

기존 JSON 복원은 명시적으로 legacy인 runtime에서만 geometry를 staging하고 legacy clock·metadata를 복구한다. 일반 native Spec 적용을 다시 실행하거나 legacy solver 상태를 native로 자동 변환하지 않는다. `configureRuntime:false`는 이미 선택된 runtime에 geometry만 추가하는 경로이며, 가변 시간을 legacy로 선택하는 일반 authoring 옵션이 아니다.

Native world는 `engine.captureRuntimeCheckpoint()` / `engine.restoreRuntimeCheckpoint(checkpoint)`로 동일 Engine 안에서 메모리 rollback을 사용한다. 전체 파일 importer·버전 간 이전은 아직 지원하지 않는다. 아래 코드는 기존 legacy world의 tooling 계약이다.

```ts
import {
  capturePhysicsWorldSnapshot,
  createPhysicsReplayInputStream,
  createPhysicsReplayWorkerClient,
  runPhysicsReplayInputStream,
  restorePhysicsWorldSnapshot,
  verifyPhysicsReplayInputStreamRollback,
  verifyPhysicsReplayRollback,
} from "@ferrum2d/ferrum-web";

const snapshot = capturePhysicsWorldSnapshot(runtime.engine, world, { frame: 120 });
const restoredWorld = restorePhysicsWorldSnapshot(runtime.engine, snapshot, {
  replace: world,
});
const replay = verifyPhysicsReplayRollback(runtime.engine, restoredWorld, {
  frames: 60,
});

const inputStream = createPhysicsReplayInputStream({
  frameCount: 120,
  fixedStepSeconds: world.stepSeconds,
  seed: 7,
  snapshotIntervalFrames: 30,
  events: [
    { frame: 20, body: "crate", type: "applyImpulse", impulseX: 120, impulseY: 0 },
  ],
});
const replayRun = runPhysicsReplayInputStream(runtime.engine, world, inputStream);
const rollback = verifyPhysicsReplayInputStreamRollback(runtime.engine, world, inputStream);

const workerClient = createPhysicsReplayWorkerClient();
const workerReplayRun = await workerClient.runReplay(snapshot, inputStream);
const transferBenchmark = await workerClient.benchmarkTransfer({ byteLength: 1024 * 1024 });
workerClient.destroy();
```

Snapshot 계약:

- `format: "ferrum2d.physics-world.snapshot"`와 `version: 2`를 기록한다. reader는 v1/v2를 지원한다. solver-state API가 없는 구형 호환 engine에서는 v1을 기록하며, 해당 engine으로 v2를 복원하려 하면 변경 전에 거부한다.
- `ResolvedPhysicsSpec`, body/joint logical id, runtime handle, body/joint snapshot, Physics Spec 기반 collider snapshot, step option, replay hash를 포함한다.
- restore는 `ResolvedPhysicsSpec`을 다시 적용한 뒤 position, velocity, rotation, body/collider enabled state, mass/tuning/material, secondary collider material override, joint enabled state를 복원한다.
- body state는 가능하면 `capturePhysicsBodyStateBuffer(...)`/`restorePhysicsBodyStateBuffer(...)` bulk ABI를 사용하고, 해당 API가 없는 호환 target에서는 기존 per-body setter 경로로 fallback한다.
- hash는 기본적으로 logical id와 runtime state를 기준으로 하며 새 handle/generation 차이는 제외한다. handle까지 비교해야 하면 `hashPhysicsWorldSnapshot(snapshot, { includeHandles: true })`를 사용한다.
- snapshot은 `PhysicsWorldApplyResult.spec`에 포함된 collider 집합을 기준으로 한다. `addPhysicsBodyCollider(...)`로 spec 밖 runtime collider를 추가한 world는 shape metadata를 안정적으로 복원할 수 없으므로 snapshot capture 시 diagnostic으로 거부한다.
- v2 `solverState`는 힘/impulse XY, torque/angular impulse, canSleep/sleep timer 및 warm-start 접점·법선·normal/tangent impulse를 보존한다. `body:<logical id>`와 `anchor:<index>`로 handle을 재매핑하며 접촉 배열 순서를 보존한다. 대상 world 밖 body와 접촉 캐시가 연결되어 있으면 불완전한 저장을 피하기 위해 capture를 거부한다. island graph는 파생 상태로 재계산한다.
- body/collider 복원 이후 solverState를 마지막에 적용한다. 새 엔진의 복원은 기존 world를 유지한 채 후보 world를 staging하고, 실패 시 native transaction으로 물체·수면·접촉 상태를 되돌린다. 기존 world의 `clear()`와 runtime 설정 변경은 후보 복원 성공 후 실행한다. bulk body/solver-state 복원도 전체 입력 검증 후 반영한다.
- 무제한 joint break distance/angle과 static/kinematic의 무한 질량·관성은 JSON에 Infinity를 넣지 않고 `0` sentinel로 저장한다. 비동적 body의 질량·관성은 복원 시 bodyType으로 결정한다. v1에는 solverState를 넣지 않으며 기존 v1 hash 계약을 유지한다. v2 hash는 접촉의 logical endpoint 방향을 정규화해 handle 재할당으로 A/B 순서가 뒤집혀도 동일하다.

Replay input stream 계약:

- `format: "ferrum2d.physics-replay.input-stream"`와 `version: 1`을 포함한다.
- `frameCount`, optional `fixedStepSeconds`, optional `seed`, optional `snapshotIntervalFrames`를 기록한다.
- event는 logical body id와 frame을 기준으로 하며 `setPosition`, `setVelocity`, `setEnabled`, `applyForce`, `applyImpulse`를 지원한다.
- event는 해당 frame의 physics step 직전에 적용된다.
- interval snapshot은 frame `0`, 지정 interval, final frame에 남는다.

Replay helper와 `pnpm smoke:physics-replay`는 deterministic regression gate다. `PhysicsReplayWorkerClient`는 같은 snapshot/replay 계약을 Web Worker에서 opt-in으로 실행하고 transferable `ArrayBuffer` round-trip 비용을 측정한다. 전체 scene loop Worker 이전, Wasm threads, multiplayer/network rollback protocol은 포함하지 않는다.

## Editor/AI authoring schema

Editor 또는 AI agent가 runtime Physics Spec을 수정할 때는 다음 authoring document를 사용할 수 있다.

```json
{
  "physics": {
    "mode": "rigid",
    "bodies": {
      "crate": {
        "type": "dynamic",
        "collider": { "shape": "box", "size": [32, 32] }
      }
    }
  },
  "physicsEditor": {
    "version": 1,
    "lockedFields": ["physics.bodies.crate.collider.shape"],
    "agentEditableFields": ["physics.bodies.crate.mass"],
    "bodies": {
      "crate": { "displayName": "Crate", "gizmo": "box" }
    }
  }
}
```

`compilePhysicsAuthoringDocument(...)`는 `physicsEditor` metadata를 제거하고 runtime `PhysicsSpec`만 반환한다. `lockedFields`와 `agentEditableFields`는 `physics.`로 시작하는 runtime path만 허용하며, metadata가 없는 body/joint를 참조하면 path 포함 diagnostic으로 실패한다. JSON Schema 보조 기준은 `schemas/physics-authoring.schema.json`이다.

샘플 authoring document는 `docs/engine/samples/physics-authoring-sample.json`에 있으며, 다음 명령으로 runtime export와 Physics Spec resolver 통과 여부를 확인한다.

```bash
pnpm validate:physics-authoring
```

직접 authoring helper도 export한다.

```ts
const crate = createRigidBody(runtime.engine, {
  type: "dynamic",
  position: [320, 120],
  collider: { type: "box", size: [32, 32] },
  material: "wood",
  layer: "player",
});

createJoint(runtime.engine, {
  type: "revolute",
  bodyA: "world",
  bodyB: crate,
  anchor: [320, 120],
});
```

## Material/layer helper

Built-in material preset:

| preset | 값 |
| --- | --- |
| `default` | 일반 rigid body |
| `ice` | 낮은 friction |
| `rubber` | 높은 restitution |
| `wood` | 중간 friction/density |
| `metal` | 높은 density, 낮은 restitution |
| `platform` | static/kinematic terrain |

Layer helper:

```ts
const layers = createPhysicsLayerMap({
  player: ["world", "enemy"],
  world: ["player", "projectile"],
  projectile: ["world", "enemy"],
});
```

`createPhysicsLayerMap(...)`은 `categoryBits`와 `maskBits`를 계산한다. `createPhysicsLayerSpec(...)`은 같은 pattern을 Physics Spec JSON에 넣을 수 있는 `{ mask: [...] }` 구조로 변환한다.

## Debug

`physics.debug` 또는 `CreateEngineOptions.physicsDebugOptions`는 다음 category를 지원한다.

| field | 동작 |
| --- | --- |
| `broadphase` | collider shape의 실제 AABB line. Native BVH node/proxy 자체의 시각화는 아니다. |
| `contacts`, `manifolds` | contact normal과 contact point marker. Native는 현재 cached manifold의 witness/normal을 읽는다. |
| `colliders` | collider wire geometry. Native의 sphere·box·capsule·convex·mesh·heightfield·compound를 포함한다. |
| `joints` | legacy 연결선 또는 현재 native 관절의 body link·local frame. Native Pulley ground 경로와 Gear association도 표시한다. |
| `sleeping` | sleeping/awake body color 분리 |
| `layers` | 기존 collider 표시 bit를 사용한다. 현재 line ABI에는 layer/mask text label을 넣지 않는다. |
| `ccd` | Engine frame에 보존한 CCD witness 위치 marker와 normal line. 전체 이동 궤적은 아니다. |

기존6개 bit를 사용하며 contacts/manifolds와 colliders/layers는 각각 같은 bit를 선택한다. Sleeping은 collider 표시도 켠다.
Native wire는 body pose와 fixture local pose를 결합하며 visual origin·render offset이나 legacy World AABB를 대신 그리지 않는다.
곡선은16분할 근사다. 관절13종의 현재 native frame/연결을 그리며, 일시정지 중 수정한 legacy joint component를 새로 admit하는 기능은 아니다.
Contacts는 마지막 tick의 cached local manifold를 현재 pose로 재투영한다. Teleport 뒤 다음 tick까지 cache가 남을 수 있으며 새 collision query/solve 결과가 아니다.
CCD는 frame의 이른 물리 구간과 entity 없는 native tile/surface witness도 포함한다. 최대4,096개 frame 기록 또는 native CCD 기록이 누락되면 debug도 truncated다.

Engine은 debug 추출 전에 component/terrain을 cold prepare_query로 한 번 동기화한다. Tick·예약 force/impulse는 소비하지 않으며,
이 admission 비용은 추출 work 상한에 포함하지 않는다. Native 추출은 geometry와 CCD를 합쳐 최대16,384선·65,536 work unit이며 빈 arena slot·형상·fixture·mesh/cell·선 시도 방문도 센다.
한도·미지원 형상은 truncated로 알리고 native admission 실패는 rejected도 표시한다. 실패 시 legacy 형상으로 대체하지 않는다.
이는 CPU 시간·GPU 시간·밀집 성능의 보장이 아니다.

공간 camera가 활성이라면 native 선은 기존11-float XYZ packet으로만 출력하고 flat 선으로 중복 출력하지 않는다.
Native Spatial의 XYZ는 그대로, Planar의 `[x,y,z]`는 `[x,z,-y]`로 표시한다. 이 높이는 backend의 수치적 extrusion이며 authored heightSpan이 아니다.
공간 camera가 없으면 Planar는 flat XY, Spatial은 `(x,-z)`의 flat XZ footprint로 표시한다. Footprint를 전체3D 형상 표시로 해석하지 않는다.
Engine debug 옵션만으로 XYZ 출력할 수 있으며 `{ depthTest: true }`만 지정해 joint-only 선의 깊이 검사를 켤 수 있다. False는 overlay다.

`queryUnifiedPhysicsDiagnostics().debug`와 `FrameState.unifiedPhysics.debug`는 마지막 추출의
lineCount·workUnits·truncated·unsupportedShapes·rejected·projection(`xy`/`xz`/`xyz`)을 소유 숫자/boolean 객체로 제공한다.
비활성 상태는 debug를 생략하고 native 상태 buffer를0으로 지운다. 같은 Engine 메모리 checkpoint는 이 통계·geometry 상태도 보존하지만 JSON 진행 저장은 아니다.
Runtime의 기존 physicsDebugLineCount는 제출한 flat+spatial 전체 debug 선을 합산하므로 공간 metadata 선도 포함한다. 물리 전용 계수와 구분한다.
Active native의 직접 debug setter는 capability를 검사한다. 수동 setter와 달리 passive Spec debug 적용에는 guard가 없어 이전 Wasm의 native 설정 자체는 성공할 수 있지만 미지원 debug 출력 소비는 거절한다.
Debug-off native 실행과 구분하며 모든 이전 Wasm의 world 설정 전 거절을 보장하지 않는다. Renderer/shader line ABI·authoring schema와 backend 기본 선택은 바꾸지 않는다.

## 검증 규칙

- 알 수 없는 `physics` 하위 필드는 diagnostic으로 거부한다.
- `materials`, `layers`, `bodies`, `joints`의 id는 빈 문자열이면 안 된다.
- body/collider의 `material`, `layer`는 기존 id를 참조해야 한다.
- joint의 `bodyA`, `bodyB`는 기존 body id 또는 `"world"`를 참조해야 한다.
- `collider`와 `colliders`는 동시에 사용할 수 없다.
- `layers`는 최대 31개까지 허용하며 resolver가 bit mask를 계산한다.
- `convexPolygon`은 3-16개 convex vertex만 허용한다.
- dynamic body의 명시적 `mass`/`inertia`는 양수·finite여야 하고 Rust `f32`에서 역수도 finite여야 한다. 역수가 표현되지 않는 극소 양수는 runtime apply에서 body 상태를 변경하지 않고 거부한다.

진단은 `FerrumDiagnosticError`를 사용하며 Physics Spec 오류는 `FERRUM_PHYSICS_SPEC_INVALID`, `kind=physics-spec`으로 보고한다. 대표 예:

- `physics.bodies.crate.mass`가 0 이하이면 positive number diagnostic
- `physics.bodies.crate.mass` 또는 `inertia`의 역수가 Rust `f32`에서 finite가 아니면 runtime mass properties diagnostic
- `physics.layers.player.mask`가 없는 layer를 참조하면 unknown layer diagnostic
- `physics.bodies.wall.collider.vertices`가 concave polygon이면 convex polygon diagnostic
- `physics.bodies.wall.collider.vertices`가 2개 미만이면 chain vertex count diagnostic

## Runtime 경계

- Rust core가 simulation state와 solver state를 소유한다.
- TypeScript는 authoring JSON 검증, 낮은 빈도의 runtime option 병합, debug 표시를 담당한다.
- `physics.mode`는 built-in Shooter/Breakout/Platformer scene을 generic rigid solver 기반으로 자동 재작성하지 않는다.
- Web hot path에서 body별 JS/Wasm 왕복 호출을 만들지 않는다.

## 회전 고정과 관절 하중 제한

`bodies.<id>.fixedRotation`은 기본 `false`다. `true`면 이동·충돌은 유지하고
물리 각속도·토크·각충격을 차단한다. 명시적인 배치 회전은 허용한다.
해제하면 authored `inertia`로 역관성을 복구한다. kinematic body에도 적용한다.

`joints.<id>.breakForce`, `breakTorque`는 선택적인 0 이상의 유한수다.
생략하면 제한하지 않으며 **0은 힘이 발생하면 파손**을 뜻한다. 기존
`breakDistance`/`breakAngle`의 authoring 0 sentinel과 다르다.

```json
{
  "mode": "rigid",
  "gravity": [0, 100],
  "bodies": {
    "crate": { "type": "dynamic", "fixedRotation": true,
      "collider": { "shape": "box", "size": [16, 16] } }
  },
  "joints": {
    "tether": { "type": "distance", "bodyA": "world", "bodyB": "crate",
      "restLength": 40, "breakForce": 800 }
  }
}
```

하중은 velocity solver에서 해당 관절만이 두 endpoint에 준 순 운동량 변화를
반복 전체에 걸쳐 합산한 뒤 **substep 초**로 나눈 값이다. force는
질량×world-unit/s², torque는 관성×rad/s²다. 토크에는 anchor 지렛팔의 반작용도
포함된다. 위치 보정량은 힘으로 환산하지 않는다. 힘·토크 중 큰 endpoint
반작용을 사용하고, force와 torque가 동시에 초과하면 force 사유를 우선한다.
8종 관절 모두 지원한다. 질량/관성을 가진 dynamic endpoint가 없는 관절은
하중이 0이며 기존 기하 제한을 사용할 수 있다.

`setPhysicsJointLoadLimits(handle, { breakForce, breakTorque })`는 두 제한을
교체한다. 생략한 제한은 해제한다. JSON world snapshot은 회전 고정과
런타임 하중 제한도 저장·복원한다. 예전 snapshot의 누락 필드는 기존 기본값이다.

## 통합 3D 물리의 씬 작성 경로

Scene Authoring의 새 root `physics`는 `space/gravity XYZ/lengthUnit`을 지정하고,
객체 `props.components.body`의 `kind/collider`를 같은 native 백엔드에 연결한다.
`body.character`는 native capsule controller를, `physics.joints`는 instance ID로 참조하는
native 관절을 구성한다. 기존 Physics Spec의 body/joint 이름 체계와 구분한다.
Planar Scene JSON은 기존 `type` body·collider-only 객체와 새 shape body를 서로 다른 객체에 함께 작성할 수 있다.
선택 `physics.collisionTilemap`은 위 collision-only grid와 같은 계약이며 spatial에서는 거절한다.
같은 body 안의 두 encoding 혼합은 거절하며, 기존 `mode/bodies/joints` Physics Spec 문서를 Scene JSON으로
자동 변환하지 않는다. 기존 Physics Spec 전체 이전과 기본 백엔드 전환은 진행 중이다.
[작성 형식과 실행·이전 제한](data-scene-authoring.md#단일-3d-물리-월드-작성)을 참고한다.
