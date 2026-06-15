# Ferrum2D Physics Showcase Lab

Ferrum2D Physics Showcase Lab은 Physics Spec으로 작성한 rigid body, collider, contact, joint, CCD, platformer physics, scene query 동작을 브라우저에서 직접 확인하는 데모다.

기존 Physics Sandbox가 fixture/regression 확인에 가까웠다면, 현재 데모는 사용자가 물리엔진 기능을 눈으로 이해하는 것을 우선한다. WebGL2 debug line은 보조 레이어로 유지하고, TypeScript overlay canvas가 bulk body snapshot, contact/manifold, joint metadata, raycast result를 시각화한다.

## 확인 기술

| 기술 | 설명 |
| --- | --- |
| Physics Spec catalog | `public/catalog.json`이 scenario, 설명, focus body, action, smoke threshold를 관리한다. |
| Body/collider overlay | `capturePhysicsBodyStateBuffer(...)` 결과와 resolved Physics Spec을 합쳐 body fill, collider shape, label을 표시한다. |
| Contact visualization | `queryBodyContacts(...)`, `queryBodyManifolds(...)`, `queryRigidContactImpulses(...)`로 contact point, normal, impulse signal을 보여준다. |
| Joint visualization | resolved joint metadata와 runtime body snapshot으로 anchor와 constraint line을 표시한다. |
| Scene query demo | pointer 위치를 raycast target으로 사용하고 hit point/normal을 표시한다. |
| Debug line fallback | Rust core가 생성한 physics debug line을 WebGL2 renderer가 계속 렌더링한다. |

## 실행

```bash
pnpm dev:physics-sandbox
```

직접 package만 실행하려면 다음 명령을 사용한다.

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/physics-sandbox dev
```

디버그 오버레이를 같이 보려면 다음 URL을 사용한다.

```text
http://localhost:5173/?debug=true
```

## Scenario Catalog

브라우저 UI와 `pnpm smoke:physics-demo-suite`는 같은 scenario id를 사용한다.

| Scenario id | Fixture | 검증 초점 |
| --- | --- | --- |
| `rigid-materials` | `demos/rigid-materials.physics.json` | mass, friction, restitution, velocity, contact response |
| `collider-gallery` | `demos/collider-gallery.physics.json` | box, circle, capsule, oriented box, convex polygon, chain, compound collider |
| `contacts-sensors` | `demos/contacts-sensors.physics.json` | contact point/normal, trigger sensor, manifold/impulse signal |
| `joints-lab` | `demos/joints-lab.physics.json` | distance, rope, spring, revolute, prismatic, gear, weld joint |
| `ccd-tunnel-test` | `demos/ccd-tunnel-test.physics.json` | fast projectile, thin wall, CCD debug marker |
| `platformer-physics` | `demos/platformer-physics.physics.json` | capsule body, slope, moving platform, step block, slippery surface |
| `scene-queries` | `demos/scene-queries.physics.json` | pointer-driven raycast, hit point, hit normal |

## 검증

```bash
pnpm --filter @ferrum2d/physics-sandbox build
pnpm smoke:physics
pnpm smoke:physics-sandbox
pnpm smoke:physics-sandbox-budget
pnpm smoke:physics-demo-suite
```

`pnpm smoke:physics-sandbox`는 production build를 열고 `window.ferrumPhysicsSandboxSmokeFrame`의 `demoId`, `bodyCount`, `visibleBodyCount`, `physicsDebugLineCount`, `frameCount`를 확인한다. `pnpm smoke:physics-demo-suite`는 catalog의 핵심 scenario id를 순회한다.

## 구현 경계

- Rust core는 simulation, contact, query, debug line 생성을 담당한다.
- TypeScript는 browser UI, overlay canvas, action button, pointer input, bulk snapshot 소비를 담당한다.
- frame hot path에서 body별 JS/Wasm 왕복 호출을 늘리지 않는다. body state는 `capturePhysicsBodyStateBuffer(...)`로 묶어서 읽는다.
- demo 설명 metadata는 `catalog.json`에 두고 Physics Spec runtime 계약을 오염시키지 않는다.

## 참고 문서

- [Physics Spec](../../docs/engine/physics-spec.md)
- [2D physics engine map](../../docs/development/architecture/physics-engine.md)
- [Smoke Check](../../docs/development/quality/smoke-check.md)
