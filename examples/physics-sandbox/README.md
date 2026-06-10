# Ferrum2D Physics Sandbox

Ferrum2D generic Physics Spec fixtures를 브라우저에서 실행하는 예제다. 장르 demo라기보다 collider, rigid body, joint, projectile CCD, platformer physics authoring 데이터를 검증하는 sandbox다.

## 확인 기술

| 기술 | 설명 |
| --- | --- |
| Physics Spec authoring | JSON fixture로 collider, material, layer, body, joint를 구성한다. |
| Debug visualization | physics debug line/counter와 browser render smoke를 확인한다. |
| Joint fixtures | distance, rope, spring, revolute, prismatic, gear, weld joint를 분리된 demo로 검증한다. |
| Projectile CCD | 빠른 projectile과 얇은 collider 충돌을 smoke로 확인한다. |
| Platformer physics fixture | capsule player, slope, moving platform, step block을 physics data로 검증한다. |

## 실행

```bash
pnpm dev:physics-sandbox
```

직접 package만 실행하려면 다음 명령을 사용한다.

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/physics-sandbox dev
```

## Fixture Catalog

브라우저 UI의 demo selector와 `pnpm smoke:physics-demo-suite`는 같은 catalog id를 사용한다. 새 fixture를 추가할 때는 JSON 파일, selector entry, smoke suite id를 함께 갱신한다.

| Demo id | Fixture | 검증 초점 | 현재 규모 |
| --- | --- | --- | --- |
| `sandbox` | `physics.json` | collider shape, material, layer, 기본 joint 혼합 샌드박스 | body 10, joint 6 |
| `joint-playground` | `demos/joint-playground.json` | distance, rope, spring, revolute, prismatic, gear joint | body 9, joint 6 |
| `projectile-ccd` | `demos/projectile-ccd.json` | 빠른 projectile과 얇은 collider의 CCD 경로 | body 5, joint 0 |
| `platformer-physics` | `demos/platformer-physics.json` | capsule player, slope, moving platform, step block authoring | body 6, joint 1 |
| `compound-collider` | `demos/compound-collider.json` | body-local compound collider와 trigger sensor | body 5, joint 1 |
| `weld-joint` | `demos/weld-joint.json` | weld joint로 고정된 복합 rigid body fixture | body 4, joint 2 |

## 검증

```bash
pnpm --filter @ferrum2d/physics-sandbox build
pnpm smoke:physics
pnpm smoke:physics-sandbox
pnpm smoke:physics-sandbox-budget
pnpm smoke:physics-demo-suite
```

`pnpm smoke:physics-sandbox`는 production build를 `demo=sandbox&physicsDebugLines=true`로 열고 `window.ferrumPhysicsSandboxSmokeFrame`의 `demoId`, `bodyCount >= 2`, `physicsDebugLineCount > 0`, `frameCount > 1`을 확인한다. `pnpm smoke:physics-demo-suite`는 위 catalog의 6개 demo id를 `window.ferrumPhysicsSandboxLoadDemo(id)`로 순회하며 같은 조건을 demo별로 확인한다. Solver determinism, scenario hash, query/CCD 세부 assertion은 Node 기반 physics smoke/replay gate의 책임이며 세부 명령은 Smoke Check 문서에서 관리한다.

## Pages 노출

현재 `pnpm build:pages` 홈에는 직접 노출하지 않는다. Physics Sandbox는 public demo portfolio보다 Physics Spec authoring과 regression fixture 역할을 우선한다.

## 참고 문서

- [Physics Spec](../../docs/engine/physics-spec.md)
- [2D physics engine map](../../docs/development/architecture/physics-engine.md)
- [Smoke Check](../../docs/development/quality/smoke-check.md)

## 다음 단계

- 새 fixture를 추가하면 JSON 파일, demo selector, `pnpm smoke:physics-demo-suite` id 목록, 이 catalog를 함께 갱신한다.
- 장르 runtime에 승격할 fixture는 `examples/platformer` 또는 별도 scene API와 책임을 나눠 설계한다.
