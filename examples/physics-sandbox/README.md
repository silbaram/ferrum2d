# Ferrum2D Physics Showcase Lab

Ferrum2D Physics Showcase Lab은 Physics Spec으로 작성한 rigid body, collider, contact, joint, CCD, platformer physics, scene query 동작을 브라우저에서 직접 확인하는 데모다.

기존 Physics Sandbox가 fixture/regression 확인에 가까웠다면, 현재 데모는 사용자가 물리엔진 기능을 눈으로 이해하는 것을 우선한다. Rust가 생성한 physics debug line과 TypeScript `DebugGizmoLineBufferWriter`가 만든 동적 line/polyline/arrow/circle을 하나의 엔진 debug line buffer로 합쳐 WebGL2/WebGPU renderer에 전달한다. body label과 sleep 상태는 entity-anchored bitmap world text를 사용한다.

## 화면과 재생 기준

- 기능 실험실·게임 데모와 같은 상세 틀(`examples/shared/exampleDetail.css`)을 쓴다. 화면 폭이 1280px 이상이면 캔버스 왼쪽에
  시나리오 7개를 갤러리와 같은 썸네일·분류·알려진 문제 표시와 함께 나열하고, 더 좁으면 실행 화면 위 선택 상자를 쓴다.
  누르면 페이지를 다시 열지 않고 바꾸며, 주소의 `?demo=`가 따라 바뀌어 그대로 공유할 수 있다.
- 실행 화면 위 소개 줄에 시나리오 순서·분류·이름·설명과 알려진 문제를 보인다. 오른쪽 패널 맨 위 '체험 방법'에는 시나리오 동작 버튼과
  관찰 포인트를, 그 아래에 실행 상태·물리 설정·물리 신호를 둔다. 디버그 표시·재질 조절·선택한 물체는 실행 화면 아래에 있다.
- 레이아웃 아래 코드 보기는 지금 시나리오의 Physics Spec(시나리오를 바꾸면 따라 바뀜), 사용하는 공개 API, 코드 위치를 보여 준다.
  맨 아래 이전·다음은 카탈로그 순서의 시나리오로 제자리에서 바꾼다.
- 시나리오에 선언한 논리 화면(현재 800×480)과 카메라 중심을 사용한다. 기본 Shooter 캐릭터가 실험에 섞이지 않는다.
- 레터박스·배율·작은 창에서 `createDataSceneView(...)`로 포인터를 같은 월드 좌표로 변환한다. 본 물체를 클릭하면 해당 native body를 선택한다.
- 물체 형상은 native 충돌체 선으로 표시한다. 충돌체 표시를 끄면 형상선이 숨겨지며, label과 UI는 유지된다.
- 이 실험실은 빈 Data Scene을 paused로 두고 `stepRigidBodies(...)`로 물리만 직접 진행한다. 일시정지는 물체를 멈추고, 한 프레임은 solver를 한 번 호출한다. UI/frame loop는 계속 실행한다.
- native step이 거절되면 world를 일시정지하고 상태를 "오류"로 바꿔 원인을 표시한다. 리셋이나 다른 시나리오가 world를 다시 만든다. 현재 강체·충돌체·접촉·관절 시나리오는 회전 상자 접촉의 운동 증명 한계로 1~2초 안에 멈춘다([통합 3D 물리 계획](../../docs/planning/unified-3d-physics-plan.md#미해결-회전-상자-접촉의-운동-증명-2026-11-22)).
- `조회 물체`와 기존 smoke 필드 `visibleBodyCount`는 조회한 body 상태 수다. 화면 안에 실제 포함된 물체 수를 뜻하지 않는다. 카메라·선택·정지·단일 스텝은 별도 브라우저 검증으로 확인한다.

## 확인 기술

| 기술 | 설명 |
| --- | --- |
| Physics Spec catalog | `public/catalog.json`이 scenario 사양 경로, 설명, focus body, action, smoke threshold를 관리한다. 시나리오 표시 이름은 기능 실험실과 같은 `examples/shared/physicsExamples.json`에서 읽는다. |
| Body/collider debug | Rust core physics debug line과 entity-anchored bitmap label로 body, collider, sleep 상태를 표시한다. 캔버스 라벨은 영문 대문자 디버그 글꼴을 쓰며, 이웃한 관찰 대상은 라벨 높이를 번갈아 둔다. |
| Contact visualization | `queryBodyContacts(...)`, `queryBodyManifolds(...)`, `queryRigidContactImpulses(...)` 결과를 engine debug line primitive로 표시한다. |
| Joint visualization | Rust core가 resolved joint의 anchor와 constraint를 같은 debug line buffer에 생성한다. |
| Scene query demo | pointer 위치를 raycast target으로 사용하고 arrow, hit circle, hit normal을 표시한다. |
| Renderer parity | 같은 8-float physics debug line buffer를 WebGL2와 WebGPU renderer가 소비한다. |

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

한글 UI는 기존 Noto Sans KR subset을 재사용하며 OFL 고지와 출처는 `public/fonts/`에 포함한다.

제목 줄·목록·패널·코드 보기·이전/다음은 기능 실험실과 같은 Pixelforge 공용 틀이며, 캔버스 안 HUD와 디버그 라벨은 이 실험실의 표현을 유지한다.

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
pnpm --filter @ferrum2d/physics-sandbox lint
pnpm --filter @ferrum2d/physics-sandbox build
pnpm smoke:physics
pnpm smoke:physics-sandbox
pnpm smoke:physics-sandbox-budget
pnpm smoke:physics-demo-suite
```

`pnpm smoke:physics-sandbox`는 production build를 열고 `window.ferrumPhysicsSandboxSmokeFrame`의 `demoId`, `bodyCount`, `visibleBodyCount`, `physicsDebugLineCount`, `customDebugLineCount`, `worldTextCount`, `frameCount`를 확인한다. `pnpm smoke:physics-demo-suite`는 catalog의 7개 scenario id를 순회한다. `pnpm smoke:physics-sandbox-budget`은 `physicsDebugLines=false`에서 두 debug line count가 모두 `0`인지 확인해 비활성 경로의 비용 회귀를 막는다.


## Pages 노출

`pnpm build:pages`는 production build를 `dist-pages/physics-sandbox/`에 복사하고 Pages 홈의 Demos 목록에 노출한다.

## 구현 경계

- Rust core는 simulation, contact, query, collider/joint debug line 생성을 담당한다.
- TypeScript는 browser UI, action button, pointer input, bulk snapshot 소비와 demo 전용 동적 debug line 조합을 담당한다.
- runtime composer는 debug line이 활성화된 frame에서만 호출되며 Rust buffer를 재사용 가능한 writer에 append한다. Rust/TypeScript 공유 ABI는 바꾸지 않는다.
- frame hot path에서 body별 JS/Wasm 왕복 호출을 늘리지 않는다. body state는 `capturePhysicsBodyStateBuffer(...)`로 묶어서 읽는다.
- body label은 entity anchor를 사용하고 sleep label 문자열은 상태가 바뀔 때만 갱신한다.
- demo 설명 metadata는 `catalog.json`에 두고 Physics Spec runtime 계약을 오염시키지 않는다.
- Canvas2D overlay 제거 이후 demo 내부에는 collider local/world 변환이나 꼭짓점 생성 helper가 없다. consumer가 같은 계산이 필요하면 `@ferrum2d/ferrum-web/core`의 public 기하 변환 helper를 사용하며, demo는 Rust debug line을 계속 source of truth로 사용한다.

## 참고 문서

- [Physics Spec](../../docs/engine/physics-spec.md)
- [좌표계와 2D 기하 변환](../../docs/engine/coordinate-system.md)
- [2D physics engine map](../../docs/development/architecture/physics-engine.md)
- [Smoke Check](../../docs/development/quality/smoke-check.md)
