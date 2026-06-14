# Physics Sandbox 재작성 계획

이 문서는 `examples/physics-sandbox`를 물리엔진 기능을 이해하기 쉬운 사용자-facing demo로 재작성하기 위한 planning 문서다. 현재 문서는 구현 전 범위와 검증 기준을 정리하는 용도이며, 확정된 public API나 운영 계약은 `docs/engine` 및 `docs/development` 문서가 우선한다.

## 결론

현재 Physics Sandbox는 기술적으로는 유효하지만, 제품 demo로는 목적이 흐리다.

- 현재 README도 이 예제를 "장르 demo라기보다 collider, rigid body, joint, projectile CCD, platformer physics authoring 데이터를 검증하는 sandbox"로 설명한다.
- 화면은 physics debug line과 counter 중심이라 rigid body, collider, contact, joint, CCD가 실제로 무엇을 하는지 한눈에 보이지 않는다.
- 사용자가 조작 가능한 물리 변수와 즉시 보이는 결과가 부족하다.

따라서 다음 작업은 기존 fixture viewer를 조금 다듬는 것이 아니라, **Physics Showcase Lab** 성격으로 다시 구성하는 것이다. 단, 1차 구현은 엔진/API를 바꾸지 않고 예제 코드와 demo data만 재작성한다.

## 외부 참고 패턴

물리엔진 demo는 기능별로 짧고 명확한 장면을 제공할 때 이해하기 쉽다.

| 참고 | 가져갈 점 |
| --- | --- |
| [Matter.js](https://brm.io/matter-js/) / [examples](https://github.com/liabru/matter-js/tree/master/examples) | friction, restitution, constraints, sensors, raycasting처럼 기능별 예제를 분리한다. |
| [Box2D documentation](https://box2d.org/documentation/) / [samples](https://github.com/erincatto/box2d/tree/main/samples) | rigid body, shape, contact, joint, CCD, sample app를 명확히 구분하고 debug draw를 보조 수단으로 쓴다. |
| [Rapier](https://rapier.rs/) / [JavaScript guide](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/) | body, collider, collision event, scene query, joint를 독립 주제로 설명하고 demo route와 문서를 연결한다. |
| [Phaser physics examples](https://phaser.io/examples/v3.85.0/physics) | Arcade/Matter physics 예제를 폴더와 단일 주제별로 탐색하게 한다. |

## 목표

- 첫 화면에서 물리 현상이 바로 보이게 한다.
- debug line은 주 시각화가 아니라 보조 레이어로 둔다.
- Physics Spec authoring JSON이 실제 runtime 결과로 어떻게 바뀌는지 연결해서 보여준다.
- rigid body, collider, contact, joint, CCD, scene query, platformer physics를 기능별 scenario로 분리한다.
- smoke 검증은 유지하되, "그림이 보이는지", "contact/joint/event가 변하는지"까지 검증한다.
- Rust core와 TypeScript platform layer 경계를 유지한다.

## 제외 범위

- visual editor 구현
- 복잡한 물리엔진 확장
- 새 production physics dependency 도입
- frame hot path에서 entity별 JS/Wasm 왕복 호출 추가
- 엔진 public API 변경을 예제 수정에 섞기
- Physics Spec schema를 demo 설명용 metadata로 오염시키기

## 새 Demo 구조

화면은 하나의 game UI가 아니라 physics lab UI로 구성한다.

| 영역 | 역할 |
| --- | --- |
| 중앙 canvas | 채워진 body/collider, contact point, joint anchor, velocity vector, query ray를 표시 |
| scenario navigator | 기능군별 demo 선택: Rigid Bodies, Colliders, Contacts, Joints, CCD, Platformer, Queries |
| inspector panel | 선택 body의 type, mass, velocity, material, collider, sleeping 상태 표시 |
| controls panel | restitution, friction, gravity, impulse, CCD toggle 같은 scenario별 조절값 |
| event strip | contact begin/end, sensor enter/exit, CCD hit, sleep/wake, query hit 로그 |
| debug layer toggle | broadphase/contact/joint/sleeping/debug line 표시를 보조 기능으로 제공 |

## Scenario 목록

| ID 후보 | 목적 | 보여줄 내용 |
| --- | --- | --- |
| `rigid-materials` | rigid body와 material 차이를 즉시 이해 | 같은 높이에서 떨어지는 box/circle, friction/restitution slider |
| `collider-gallery` | collider shape 차이 확인 | aabb, circle, capsule, orientedBox, convexPolygon, compound collider |
| `contacts-sensors` | contact와 sensor 차이 확인 | contact point/normal, sensor zone enter/exit, collision filter |
| `joints-lab` | joint 계열 비교 | distance, spring, rope, revolute, prismatic, gear, weld joint와 anchor/limit |
| `ccd-tunnel-test` | 빠른 projectile과 CCD 이해 | 얇은 wall을 discrete/continuous 모드로 비교 |
| `platformer-physics` | platformer용 물리 authoring 확인 | capsule body, slope, step block, moving platform, ground normal |
| `scene-queries` | query API 사용성 확인 | raycast, segment cast, point/aabb/circle query, hit normal 표시 |

## 데이터 설계

Physics Spec은 runtime 물리 데이터만 담고, demo UI metadata는 별도 catalog로 분리한다.

```text
examples/physics-sandbox/
  public/
    catalog.json
    demos/
      rigid-materials.physics.json
      collider-gallery.physics.json
      contacts-sensors.physics.json
      joints-lab.physics.json
      ccd-tunnel-test.physics.json
      platformer-physics.physics.json
      scene-queries.physics.json
```

`catalog.json`에는 demo 전용 metadata만 둔다.

- `id`, `title`, `category`, `summary`
- `physicsSpec`
- `camera`
- `defaultDebug`
- `bodyStyles`, `labels`, `focusBodies`
- `controls`
- `expectedSignals`
- `smokeThresholds`

## 코드 구조

현재 `src/main.ts`에 몰려 있는 책임을 나눈다.

| 파일 후보 | 책임 |
| --- | --- |
| `src/main.ts` | bootstrap과 runtime 연결 |
| `src/catalog.ts` | catalog load/validate, scenario 선택 |
| `src/shell.ts` | DOM layout, toolbar, panel, event strip |
| `src/physicsScenario.ts` | Physics Spec apply, reset, step, handle map 관리 |
| `src/visualization.ts` | body/collider fill, contact point, joint anchor, vector overlay |
| `src/inspector.ts` | selected body/contact/joint 표시 |
| `src/controls.ts` | scenario별 slider/toggle/button 동작 |
| `src/smokeHarness.ts` | browser smoke용 window hook과 scenario 순회 |
| `src/styles.css` | lab layout과 responsive UI |

## 엔진/API 변경 기준

1차 구현은 기존 API만 사용한다.

- `createPhysicsWorldFromSpec(...)`
- `stepRigidBodies(...)`
- `capturePhysicsBodyStateBuffer(...)`
- `queryBodyContacts(...)`
- `queryBodyManifolds(...)`
- `queryRigidContactImpulses(...)`
- `raycastBodies(...)`, `shapeCast*Bodies(...)`, `query*Bodies(...)`
- physics debug line buffer

만약 예제 재작성 중 엔진 API가 부족하면 바로 수정하지 않고 별도 task로 분리한다. 후보는 다음 정도로 제한한다.

- all-body bulk snapshot을 더 쉽게 얻는 helper
- joint snapshot bulk capture
- contact/event history를 smoke에서 안정적으로 읽는 helper

이 경우 `engine_reviewer` 검토, Wasm ABI 영향 확인, `docs/engine/public-api.md` 및 관련 architecture 문서 동기화를 별도 작업으로 진행한다.

## 구현 Slice

### Slice 0: 계획 확정

산출물:

- 이 planning 문서
- `docs/planning/README.md` 링크 추가

검증:

- `pnpm validate:docs-links`
- `git diff --check`

### Slice 1: Lab shell 재작성

산출물:

- 기존 selector/debug 중심 UI를 lab layout으로 교체
- canvas와 panel이 겹치지 않게 responsive layout 구성
- `?debug=true`에서도 debug overlay가 게임 화면을 가리지 않게 배치

검증:

- `pnpm --filter @ferrum2d/physics-sandbox build`
- browser screenshot 확인

### Slice 2: Catalog와 scenario loader

산출물:

- `catalog.json`
- 기존 fixture id를 새 scenario id로 정리
- scenario별 `expectedSignals`와 smoke threshold 정의

검증:

- `pnpm smoke:physics-sandbox`
- `pnpm smoke:physics-demo-suite`

### Slice 3: 물리 시각화 레이어

산출물:

- body fill/outline
- collider shape 표시
- contact point/normal 표시
- joint anchor/limit 표시
- velocity/force/query vector 표시

검증:

- body snapshot count와 visible overlay count 비교
- debug line 없이도 주요 물리 현상이 보이는지 browser 확인

### Slice 4: Scenario data 재작성

산출물:

- `rigid-materials`
- `collider-gallery`
- `contacts-sensors`
- `joints-lab`
- `ccd-tunnel-test`
- `platformer-physics`
- `scene-queries`

검증:

- `pnpm validate:physics-authoring`
- `pnpm smoke:physics`
- `pnpm smoke:physics-demo-suite`

### Slice 5: 상호작용 controls

산출물:

- scenario별 slider/toggle/button
- impulse/reset/drop/fire/raycast 같은 명확한 action
- selected body inspector

검증:

- browser smoke에서 최소 action 1개 이상 실행
- frame budget regression 확인

### Slice 6: 문서와 Pages 노출 정리

산출물:

- `examples/physics-sandbox/README.md` 갱신
- showcase planning 또는 Pages demo gallery에 Physics Showcase Lab 역할 연결
- smoke 문서에 새 검증 기준 반영

검증:

- `pnpm validate:docs-links`
- `pnpm build:pages`
- `pnpm validate:pages-artifact`

## 완료 기준

- 사용자가 첫 화면만 봐도 물리엔진 demo라는 점을 이해할 수 있다.
- 각 scenario가 하나의 물리 개념만 명확히 보여준다.
- debug line을 꺼도 body/contact/joint/query가 시각적으로 확인된다.
- `?debug=true` overlay와 demo UI가 canvas를 가리지 않는다.
- 기존 smoke 검증이 유지되고, scenario별 시각/이벤트 검증이 추가된다.
- 엔진/API 변경이 필요한 항목은 별도 문서/승인/검증 task로 분리되어 있다.

## 리스크

- collider fill overlay를 TypeScript에서 그릴 때 runtime 상태와 spec metadata 매핑이 틀어질 수 있다.
- compound collider와 rotated collider는 시각화 난도가 높아 Slice 3에서 범위를 제한할 수 있다.
- controls가 많아지면 visual editor처럼 보일 수 있으므로 scenario별 최소 조작만 허용한다.
- smoke에서 시각 품질을 완전히 보장하기 어렵기 때문에 screenshot 기반 수동 확인이 필요하다.

## 다음 작업 추천

다음 작업은 Slice 1부터 시작한다. 즉, 엔진이나 Physics Spec schema를 바꾸지 말고 `examples/physics-sandbox`의 UI shell과 layout을 먼저 갈아엎는다. 그 다음 catalog와 scenario data를 단계적으로 옮기면 기존 smoke를 유지하면서 demo 품질을 올릴 수 있다.
