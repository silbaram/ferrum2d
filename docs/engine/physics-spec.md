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
- Physics Spec 기반 world snapshot/restore/replay helper
- Wasm bulk body state buffer 기반 snapshot/restore ABI와 TypeScript fallback helper
- editor/AI 도구용 `physicsEditor` authoring metadata strip helper와 JSON Schema
- HD-2D `physics.hd2d` authoring/resolved 필드와 body별 `floor`/`elevation`/`height` 검증
- HD-2D body `heightSpan` 기반 collision filter와 body query/raycast/shape-cast optional filter
- `examples/physics-sandbox` browser sandbox와 `pnpm smoke:physics-sandbox`
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

Shooter Game Spec tile definition도 `floor`, `elevation`, `height`, `kind`, `ramp`, `bridgePortal`, `blocksMovement`, `blocksProjectile`, `blocksVision`, `occluderHeight` metadata를 받을 수 있다. `physics.hd2d.enabled`가 켜져 있으면 tile `height` 기본값은 `physics.hd2d.defaultHeight`이고, Rust tilemap collision cache는 height span이 다른 solid run을 합치지 않는다. `blocksMovement: false`는 양수 collision layer tile을 이동 obstacle에서 제외하며, Rust merged collision cache, kinematic tile movement, tilemap navigation, TypeScript boundary extraction이 같은 의미를 사용한다. `moveHd2dKinematicBodyWithTilemap(...)`은 body `heightSpan`을 사용해 다른 floor의 entity/tile obstacle을 필터링하고, tile `kind/ramp` metadata로 step up/down, stair/ramp elevation 보간, ledge drop opt-in, bridge under-pass를 처리한다. `bridgePortal`은 같은 XY tile에서 lower/upper floor edge를 만들어 `queryTilemapNavigationPath({ heightSpan, toHeightSpan })`가 다층 path를 반환하게 한다. Shooter projectile arc는 bullet height span을 갱신하고, combat/projectile tile hit는 height span overlap과 `blocksProjectile` metadata를 함께 사용한다. `blocksVision`/`occluderHeight`는 `deriveHd2dTileOccludersFromTilemapGrid(...)` helper로 lighting shadow occluder 입력에 연결할 수 있다.

`FerrumEngine.setShooterTileHeightSpan(...)` / `clearShooterTileHeightSpan(...)`은 낮은 빈도 runtime tile height metadata 변경용 API이고, `setShooterTileHd2dMetadata(...)` / `clearShooterTileHd2dMetadata(...)`는 tile kind/ramp/blocking metadata 변경용 API다. tile nearest/raycast/segment-cast/shape-cast/contact/manifold query와 tilemap navigation waypoint/path query도 optional `heightSpan` filter를 지원한다. explicit tile obstacle query filter가 지정되면 height span이 없는 legacy tile은 결과에서 제외된다. explicit navigation filter가 지정되면 height span이 없는 legacy obstacle tile은 해당 filtered path에서 장애물로 취급하지 않는다. Frame telemetry와 DebugOverlay는 HD-2D height filter로 제외된 kinematic entity/tile candidate 수를 노출한다.

Physics world snapshot/replay는 bulk body state ABI v1(`31 floats / 5 u32s`)을 유지한다. Height span은 snapshot `state.heightSpan` sidecar로 보존하고 restore 시 bulk body state 복원 뒤 별도 body API로 복원한다.

별도 multi-hitbox/hurtbox authoring DSL, 고급 roof/wall visibility rule, entity shadow scale/offset, material 기반 lighting response, 3D rigid body solver는 이 HD-2D foundation 범위에 포함하지 않는다.

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

`applyPhysicsSceneProfile(...)`은 같은 world apply 결과를 감싸고, `runtime` profile에서는 Rust `Engine.update()` 내부 auto rigid-body step을 켠다. `manual` profile은 body/joint만 적용하고 사용자가 `stepRigidBodies(...)`를 직접 호출하는 기존 경로를 유지한다. 이 통합은 scene 생성/교체 시점의 opt-in API이며 frame hot path에서 entity별 JS/Wasm 왕복을 만들지 않는다.

Apply 정책:

- `physics.mode: "none"`에서 body/joint가 있으면 diagnostic으로 실패한다.
- body당 1개 이상의 collider를 runtime apply한다. `collider`는 단일 collider shorthand이고, `colliders` 배열은 primary collider(index `0`)와 secondary collider(index `1+`)로 적용된다.
- contact/query/debug result는 현재 body/entity 단위로 반환한다. Rust 내부는 collider pair를 순회하지만 public result에는 collider index를 노출하지 않는다.
- collider별 layer/filter/trigger/enabled/material은 runtime apply와 collision/query/debug/contact solver에 반영된다. 낮은 빈도 tooling은 `getPhysicsBodyColliderCount(...)`와 `getPhysicsBodyCollider(...)`로 collider index, type, enabled/trigger, offset, material override, category/mask bit를 조회할 수 있다.
- `bodyA`/`bodyB`의 `"world"`는 helper가 collision-disabled static anchor body로 변환한다.
- `chain`은 하나의 authoring collider이자 하나의 runtime collider로 적용된다. segment별 collision/query/debug 처리는 Rust 내부 구현 세부사항이며 public collider index를 늘리지 않는다.
- apply는 authoring 시점의 낮은 빈도 호출을 대상으로 하며 frame hot path에서 body별 JS/Wasm stream을 만들지 않는다.

## Tilemap/Pixel Mask Helper

`extractTilemapBoundaryChains(...)`는 resolved Shooter tilemap의 `collision: true` layer를 Physics Spec static body map으로 변환한다. 일반 layer에서는 `slope` 또는 `oneWayPlatform` tile을 regular solid boundary에서 제외하고, `collisionOnly: true` layer에서는 양수 tile id를 solid cell로 처리한다. 긴 외곽선은 runtime chain vertex limit에 맞춰 여러 body로 분할된다.

`PixelMaskTerrain`은 alpha mask를 낮은 빈도로 편집하고, dirty rect/alpha patch를 조회하며, collision-only tilemap layer 또는 chain boundary body로 변환하는 helper다. `PixelMaskTerrainRuntime`은 이 helper를 WebGL2 texture와 Physics Spec world apply에 연결한다. 생성 시 전체 texture를 만들고, 이후 dirty alpha patch만 `texSubImage2D`로 업로드할 수 있으며, physics 쪽은 chunk 단위로 boundary chain body를 재생성하고 이전 chunk world를 `clear()`로 교체한다. 큰 편집이 한 번에 너무 많은 chunk를 건드리는 경우 `maxDirtyChunksPerSync`로 rebuild budget을 제한한다.

```ts
import {
  createPixelMaskTerrain,
  createPixelMaskTerrainRuntime,
} from "@ferrum2d/ferrum-web";

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
```

이 runtime helper는 낮은 빈도의 destructible terrain 편집용이다. 프레임 hot path에서 매 entity 단위 JS/Wasm 왕복을 만들지 않는다.

## Joint Type

| type | 주요 필드 | runtime apply |
| --- | --- | --- |
| `distance` | `restLength`, `stiffness`, `damping`, `breakDistance` | 지원 |
| `rope` | `maxLength`, `stiffness`, `damping`, `breakDistance` | 지원 |
| `spring` | `restLength`, `stiffness`, `damping`, `breakDistance` | 지원 |
| `pulley` | `groundAnchorA`, `groundAnchorB`, local anchor, `restLength`, `ratio`, `breakDistance` | 지원 |
| `revolute` | `anchor` 또는 local anchor, `limit`, `motor`, `breakDistance` | 지원 |
| `prismatic` | local anchor, `localAxisA`, `referenceAngle`, `limit`, `motor`, `breakDistance` | 지원 |
| `weld` | local anchor, `referenceAngle`, `stiffness`, `damping`, `breakDistance`, `breakAngle` | 지원 |
| `gear` | `ratio`, `referenceAngle`, `breakAngle` | 지원 |

`pulley`는 두 body anchor와 두 world-space ground anchor 사이의 총 길이 `lengthA + ratio * lengthB = restLength`를 유지한다. `groundAnchorA`/`groundAnchorB`는 world 좌표이고, `localAnchorA`/`localAnchorB`는 각 body local 좌표다. `ratio`는 양수만 허용하며, `breakDistance`는 가중 길이 오차가 지정값을 넘으면 joint를 제거한다.

`weld`는 두 body의 local anchor와 상대 각도를 고정하는 목적형 joint다. Physics Spec의 `stiffness`/`damping`은 runtime apply 시 anchor constraint와 angular constraint에 함께 적용된다. 더 세밀하게 나누어야 하는 low-level Web API에서는 `spawnPhysicsJoint({ type: "weld", angularStiffness, angularDamping })`을 사용할 수 있다. `breakDistance`는 두 anchor 간 거리 오차, `breakAngle`은 상대 각도 오차가 지정값을 넘으면 joint를 제거한다. `frequencyHz`/`dampingRatio`/force 기반 break event는 현재 공식 Physics Spec 필드가 아니며, 필요 시 별도 설계 후 추가한다.

## Snapshot/replay API

Physics Spec으로 만든 generic world는 낮은 빈도 tooling 용도로 snapshot을 만들 수 있다.

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

- `format: "ferrum2d.physics-world.snapshot"`와 `version: 1`을 포함한다.
- `ResolvedPhysicsSpec`, body/joint logical id, runtime handle, body/joint snapshot, Physics Spec 기반 collider snapshot, step option, replay hash를 포함한다.
- restore는 `ResolvedPhysicsSpec`을 다시 적용한 뒤 position, velocity, rotation, body/collider enabled state, mass/tuning/material, secondary collider material override, joint enabled state를 복원한다.
- body state는 가능하면 `capturePhysicsBodyStateBuffer(...)`/`restorePhysicsBodyStateBuffer(...)` bulk ABI를 사용하고, 해당 API가 없는 호환 target에서는 기존 per-body setter 경로로 fallback한다.
- hash는 기본적으로 logical id와 runtime state를 기준으로 하며 새 handle/generation 차이는 제외한다. handle까지 비교해야 하면 `hashPhysicsWorldSnapshot(snapshot, { includeHandles: true })`를 사용한다.
- snapshot은 `PhysicsWorldApplyResult.spec`에 포함된 collider 집합을 기준으로 한다. `addPhysicsBodyCollider(...)`로 spec 밖 runtime collider를 추가한 world는 shape metadata를 안정적으로 복원할 수 없으므로 snapshot capture 시 diagnostic으로 거부한다.
- force/impulse accumulator, island graph, warm-start contact cache는 현재 public JSON snapshot에 포함하지 않는다. Rust-native `World::snapshot()`은 accumulator, sleep state, warm-start contact impulse cache를 보존하지만 island graph는 step 시점의 derived state로 재계산한다.

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
| `broadphase` | collider AABB proxy line |
| `contacts`, `manifolds` | contact normal과 contact point marker |
| `colliders` | collider outline line |
| `joints` | joint 연결 line. pulley는 ground anchor와 body anchor line을 함께 표시한다. |
| `sleeping` | sleeping/awake body color 분리 |
| `layers` | layer/mask 진단용 category flag. 현재 line ABI에는 text label을 넣지 않는다. |
| `ccd` | CCD hit 위치를 cross marker로, hit normal을 짧은 line으로 기존 physics debug line buffer에 기록한다. DebugOverlay의 `ccd checks`, `ccd hits` metric과 함께 확인한다. |

## 검증 규칙

- 알 수 없는 `physics` 하위 필드는 diagnostic으로 거부한다.
- `materials`, `layers`, `bodies`, `joints`의 id는 빈 문자열이면 안 된다.
- body/collider의 `material`, `layer`는 기존 id를 참조해야 한다.
- joint의 `bodyA`, `bodyB`는 기존 body id 또는 `"world"`를 참조해야 한다.
- `collider`와 `colliders`는 동시에 사용할 수 없다.
- `layers`는 최대 31개까지 허용하며 resolver가 bit mask를 계산한다.
- `convexPolygon`은 3-16개 convex vertex만 허용한다.

진단은 `FerrumDiagnosticError`를 사용하며 Physics Spec 오류는 `FERRUM_PHYSICS_SPEC_INVALID`, `kind=physics-spec`으로 보고한다. 대표 예:

- `physics.bodies.crate.mass`가 0 이하이면 positive number diagnostic
- `physics.layers.player.mask`가 없는 layer를 참조하면 unknown layer diagnostic
- `physics.bodies.wall.collider.vertices`가 concave polygon이면 convex polygon diagnostic
- `physics.bodies.wall.collider.vertices`가 2개 미만이면 chain vertex count diagnostic

## Runtime 경계

- Rust core가 simulation state와 solver state를 소유한다.
- TypeScript는 authoring JSON 검증, 낮은 빈도의 runtime option 병합, debug 표시를 담당한다.
- `physics.mode`는 built-in Shooter/Breakout/Platformer scene을 generic rigid solver 기반으로 자동 재작성하지 않는다.
- Web hot path에서 body별 JS/Wasm 왕복 호출을 만들지 않는다.
