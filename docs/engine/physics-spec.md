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
- `createRigidBody(...)`, `createCollider(...)`, `createJoint(...)` authoring helper
- distance/rope/spring/revolute/prismatic/weld/gear joint validation과 runtime apply
- material preset과 layer/mask helper
- `CreateEngineOptions.physicsMode`, `FerrumRuntimeOptions.physicsMode` runtime override
- `FrameState.physics.mode`와 debug overlay의 physics mode 표시
- Top-down Shooter `game.json`의 명시적 `physics.mode`
- generic runtime `edge` collider 생성/API, collision/query/raycast/shape-cast 지원
- category별 physics debug line flags와 DebugOverlay physics metric 표시
- `pnpm smoke:physics` stress/replay smoke runner
- Physics Spec 기반 world snapshot/restore/replay helper
- editor/AI 도구용 `physicsEditor` authoring metadata strip helper와 JSON Schema
- `examples/physics-sandbox` browser sandbox와 `pnpm smoke:physics-sandbox`
- compound collider runtime apply, collider snapshot 조회, body 단위 contact/query/debug

후속 구현 범위:

- Wasm bulk world snapshot/restore ABI
- dedicated `chain` collider runtime storage와 tilemap boundary extraction 구현
- CCD hit 위치를 별도 marker로 인코딩하는 debug buffer 확장

따라서 현재 `physics` namespace는 사용자-facing 계약, 검증, 낮은 빈도의 runtime apply 기준을 제공한다. Generic rigid body world는 `createPhysicsWorldFromSpec(...)`로 만들고, 더 직접적인 제어가 필요하면 imperative Physics API인 `spawnRigidBody(...)`, `spawnPhysicsJoint(...)`, `stepRigidBodies(...)`를 사용한다.

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

## Collider Shape

| shape | 필수 필드 | 상태 |
| --- | --- | --- |
| `aabb`, `box` | `size` 또는 `halfSize` | spec validation, runtime apply |
| `circle` | `radius` | spec validation, runtime apply |
| `capsule` | `start`, `end`, `radius` | spec validation, runtime apply |
| `orientedBox` | `size` 또는 `halfSize` | spec validation, runtime apply |
| `convexPolygon` | `vertices` | spec validation, runtime apply |
| `edge` | `start`, `end` | spec validation, runtime apply |
| `chain` | `vertices`, optional `loop` | spec validation, runtime apply via edge segments |

`convexPolygon`은 3-16개 convex vertex만 runtime apply에 사용한다. `chain`은 `createPhysicsWorldFromSpec(...)`에서 인접 vertex pair를 edge segment로 낮춰 적용한다. `loop: true`이고 마지막 vertex가 첫 vertex와 다르면 closing edge도 추가한다. dedicated Rust chain storage와 tilemap boundary extraction 구현은 후속 범위다.

## Authoring/apply API

`@ferrum2d/ferrum-web` entrypoint는 Physics Spec을 runtime world로 적용하는 helper를 export한다.

```ts
import {
  createPhysicsWorldFromSpec,
  resolvePhysicsSpec,
} from "@ferrum2d/ferrum-web";

const raw = await fetch("/physics.json").then((response) => response.json());
const resolved = resolvePhysicsSpec(raw, { path: "physics" });
const world = createPhysicsWorldFromSpec(runtime.engine, resolved);

runtime.engine.stepRigidBodies(world.stepSeconds, world.stepOptions);
```

반환값은 body id -> `PhysicsEntityHandle`, joint id -> `PhysicsJointHandle`, body/joint count, warning, `stepOptions`, `clear()`를 포함한다. 같은 fixture를 다시 적용할 때는 `createPhysicsWorldFromSpec(engine, next, { replace: previousWorld })`를 사용한다.

Apply 정책:

- `physics.mode: "none"`에서 body/joint가 있으면 diagnostic으로 실패한다.
- body당 1개 이상의 collider를 runtime apply한다. `collider`는 단일 collider shorthand이고, `colliders` 배열은 primary collider(index `0`)와 secondary collider(index `1+`)로 적용된다.
- contact/query/debug result는 현재 body/entity 단위로 반환한다. Rust 내부는 collider pair를 순회하지만 public result에는 collider index를 노출하지 않는다.
- collider별 layer/filter/trigger/enabled/material은 runtime apply와 collision/query/debug/contact solver에 반영된다. 낮은 빈도 tooling은 `getPhysicsBodyColliderCount(...)`와 `getPhysicsBodyCollider(...)`로 collider index, type, enabled/trigger, offset, material override, category/mask bit를 조회할 수 있다.
- `bodyA`/`bodyB`의 `"world"`는 helper가 collision-disabled static anchor body로 변환한다.
- `chain`은 하나의 authoring collider로 보존되지만 runtime에서는 여러 edge collider로 적용된다. 첫 segment는 primary collider, 나머지 segment는 secondary collider index로 들어간다.
- apply는 authoring 시점의 낮은 빈도 호출을 대상으로 하며 frame hot path에서 body별 JS/Wasm stream을 만들지 않는다.

## Joint Type

| type | 주요 필드 | runtime apply |
| --- | --- | --- |
| `distance` | `restLength`, `stiffness`, `damping`, `breakDistance` | 지원 |
| `rope` | `maxLength`, `stiffness`, `damping`, `breakDistance` | 지원 |
| `spring` | `restLength`, `stiffness`, `damping`, `breakDistance` | 지원 |
| `revolute` | `anchor` 또는 local anchor, `limit`, `motor`, `breakDistance` | 지원 |
| `prismatic` | local anchor, `localAxisA`, `referenceAngle`, `limit`, `motor`, `breakDistance` | 지원 |
| `weld` | local anchor, `referenceAngle`, `stiffness`, `damping`, `breakDistance`, `breakAngle` | 지원 |
| `gear` | `ratio`, `referenceAngle`, `breakAngle` | 지원 |

`weld`는 두 body의 local anchor와 상대 각도를 고정하는 목적형 joint다. Physics Spec의 `stiffness`/`damping`은 runtime apply 시 anchor constraint와 angular constraint에 함께 적용된다. 더 세밀하게 나누어야 하는 low-level Web API에서는 `spawnPhysicsJoint({ type: "weld", angularStiffness, angularDamping })`을 사용할 수 있다. `breakDistance`는 두 anchor 간 거리 오차, `breakAngle`은 상대 각도 오차가 지정값을 넘으면 joint를 제거한다. `frequencyHz`/`dampingRatio`/force 기반 break event는 현재 공식 Physics Spec 필드가 아니며, 필요 시 별도 설계 후 추가한다.

## Snapshot/replay API

Physics Spec으로 만든 generic world는 낮은 빈도 tooling 용도로 snapshot을 만들 수 있다.

```ts
import {
  capturePhysicsWorldSnapshot,
  createPhysicsReplayInputStream,
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
```

Snapshot 계약:

- `format: "ferrum2d.physics-world.snapshot"`와 `version: 1`을 포함한다.
- `ResolvedPhysicsSpec`, body/joint logical id, runtime handle, body/joint snapshot, Physics Spec 기반 collider snapshot, step option, replay hash를 포함한다.
- restore는 `ResolvedPhysicsSpec`을 다시 적용한 뒤 position, velocity, rotation, body/collider enabled state, mass/tuning/material, secondary collider material override, joint enabled state를 복원한다.
- hash는 기본적으로 logical id와 runtime state를 기준으로 하며 새 handle/generation 차이는 제외한다. handle까지 비교해야 하면 `hashPhysicsWorldSnapshot(snapshot, { includeHandles: true })`를 사용한다.
- snapshot은 `PhysicsWorldApplyResult.spec`에 포함된 collider 집합을 기준으로 한다. `addPhysicsBodyCollider(...)`로 spec 밖 runtime collider를 추가한 world는 shape metadata를 안정적으로 복원할 수 없으므로 snapshot capture 시 diagnostic으로 거부한다.
- force/impulse accumulator, island graph, warm-start contact cache는 현재 public JSON snapshot에 포함하지 않는다. Rust-native `World::snapshot()`은 accumulator, sleep state, warm-start contact impulse cache를 보존하지만 island graph는 step 시점의 derived state로 재계산한다.

Replay input stream 계약:

- `format: "ferrum2d.physics-replay.input-stream"`와 `version: 1`을 포함한다.
- `frameCount`, optional `fixedStepSeconds`, optional `seed`, optional `snapshotIntervalFrames`를 기록한다.
- event는 logical body id와 frame을 기준으로 하며 `setPosition`, `setVelocity`, `setEnabled`, `applyForce`, `applyImpulse`를 지원한다.
- event는 해당 frame의 physics step 직전에 적용된다.
- interval snapshot은 frame `0`, 지정 interval, final frame에 남는다.

Replay helper와 `pnpm smoke:physics-replay`는 deterministic regression gate다. multiplayer/network rollback protocol은 포함하지 않는다.

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

샘플 authoring document는 `docs/engine/physics-authoring-sample.json`에 있으며, 다음 명령으로 runtime export와 Physics Spec resolver 통과 여부를 확인한다.

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
| `joints` | joint 연결 body line |
| `sleeping` | sleeping/awake body color 분리 |
| `layers` | layer/mask 진단용 category flag. 현재 line ABI에는 text label을 넣지 않는다. |
| `ccd` | DebugOverlay의 `ccd checks`, `ccd hits` metric으로 확인한다. per-hit 위치 marker는 후속 buffer 확장 대상이다. |

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
