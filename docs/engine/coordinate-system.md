# 좌표계와 2D 기하 변환

이 문서는 Ferrum2D world 좌표와 `@ferrum2d/ferrum-web/core`의 public 2D 기하 변환
helper가 따르는 계약을 정의한다. 화면 좌표를 Scene Placement world 좌표로 바꾸는
authoring viewport helper는 [Authoring Public API](public-api/authoring.md)를 본다.

## 축, 단위, 각도

- world의 x축 양의 방향은 오른쪽, y축 양의 방향은 아래쪽이다.
- 위치, 크기, collider 반지름과 vertex는 논리적 world unit을 사용한다. CSS pixel이나
  device pixel과 1:1임을 보장하지 않으며 camera, zoom, viewport, DPR 변환은 renderer나
  authoring viewport가 담당한다.
- 회전은 radian 단위다. `0`은 +x 방향이고, 양의 각도는 y-down 화면에서 시계 방향으로
  보인다.
- public point transform의 회전식은 Rust와 동일한
  `x' = x cos(θ) - y sin(θ)`, `y' = x sin(θ) + y cos(θ)`다.

`transformPoint2D(...)`의 합성 순서는 local scale, 원점 기준 rotation, world
translation이다. `inverseTransformPoint2D(...)`는 translation 제거, inverse rotation,
inverse scale 순서로 되돌리며 scale이 0이면 역변환이 없으므로 거부한다.

## 원점과 anchor

`Transform2DInput.x/y`와 `PhysicsBodyTransform2D.x/y`는 변환의 world 원점이다.
`bodyLocalToWorld2D(...)`에 전달하는 local `{ x: 0, y: 0 }`은 body 원점으로 이동한다.
helper는 sprite pivot, texture UV, DOM 좌표 또는 camera 좌표를 암묵적으로 적용하지 않는다.

Physics body에서 이 원점은 body center다. collider의 `offsetX/offsetY`와 capsule
`startX/startY`, `endX/endY`, polygon vertex는 이 body 원점을 기준으로 authoring한다.
joint의 `localAnchorA/B`도 각 body 원점 기준 local 좌표지만, joint solver 계약은
[Physics Spec](physics-spec.md)을 따른다.

## Generic body transform과 collider transform의 차이

`bodyLocalToWorld2D(...)`와 `bodyWorldToLocal2D(...)`는 일반적인 body translation +
rotation을 적용한다. 반면 collider reference helper는 현재 Rust collision query/debug
geometry를 그대로 맞춘다. 두 규칙을 임의로 섞지 않는다.

| Collider | World center/reference point 규칙 |
| --- | --- |
| AABB/box | body 위치에 offset을 world 축으로 더하며 body rotation을 적용하지 않는다. 네 꼭짓점은 좌상단부터 시계 방향이다. |
| Circle | body 위치에 offset을 world 축으로 더한 중심 한 점이다. body rotation을 적용하지 않는다. |
| Capsule | offset을 world 축으로 더한 뒤 local start/end를 그대로 더한다. 현재 Rust 계약에서는 body rotation을 적용하지 않는다. |
| Oriented box | offset은 world 축으로 더하고, 네 local 꼭짓점은 그 중심에서 `body.rotationRadians + collider.rotationRadians`만큼 회전한다. |
| Convex polygon | offset은 world 축으로 더하고, authored vertex는 그 원점에서 `body.rotationRadians + collider.rotationRadians`만큼 회전한다. center는 변환된 vertex의 centroid다. |

따라서 회전하는 capsule endpoint나 body rotation을 따르는 collider offset이 필요한
consumer는 generic body transform으로 별도 geometry를 계산할 수 있지만, 그 결과를 현재
Rust collider의 실제 query/debug shape라고 간주하면 안 된다.

## 할당 제어

`rotatePoint2D(...)`, `transformPoint2D(...)`, `inverseTransformPoint2D(...)`, body
local/world helper와 collider center helper는 optional `out` 객체를 받는다. 반복 호출에서는
동일한 `MutablePoint2D`를 재사용한다.

Collider vertices는 먼저 `physicsColliderWorldReferencePointCount(...)`로 point 수를 얻고,
`writePhysicsColliderWorldReferencePoints(...)`에 `Float32Array`, `Float64Array` 또는 호환
mutable numeric buffer를 전달한다. 함수는 point 객체나 배열을 만들지 않고
`[x0, y0, x1, y1, ...]` 순서로 기록한다. `floatOffset`을 사용하면 더 큰 frame scratch
buffer의 일부에 이어 쓸 수 있다.

## 동등성 검증

TypeScript unit test와 Rust collision test는 같은 canonical body/collider vector를 각각
계산해 AABB, circle, capsule, oriented box, convex polygon의 center/reference point가
일치하는지 검증한다. 이 helper는 순수 TypeScript API이므로 새 Wasm 호출, frame별
JS/Wasm 왕복 또는 공유 ABI 변경을 만들지 않는다.
