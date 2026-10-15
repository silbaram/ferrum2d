# Data Scene native actor와 카메라 연결

아래 카메라·정렬은 기존 평면 경로의 계약이다. 개발 소스의 선택적 입체 지형과 물리 elevation의
화면 높이·깊이 연결은 [공간 카메라·빌보드](data-scene-spatial.md)를 사용한다.

이 경로는 #62~#65에서 추가했으며 `0.1.0-beta.2`부터 제공한다.
해당 버전 이상의 엔진을 설치한 뒤 공개 `/core`, `/authoring` API로 사용한다.
초기 설치 단계에서 아래 recipe나 게임 파일을 자동 생성하지 않는다.

## Sprite와 body 조립

```ts
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";

const applied = applyDataSceneAuthoringDocument(engine, {
  format: "ferrum2d.consumer.scene-authoring", version: 1,
  sceneComposition: {
    initialFragment: "island",
    prefabs: {
      actor: { props: { components: {
        visual: { kind: "sprite", texture: 2, width: 32, height: 64,
          originX: 0.5, originY: 1, depthSort: "hd2d", tint: "#ffffff" },
        collider: { type: "aabb", halfWidth: 8, halfHeight: 8 },
        layer: "player",
        body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 1 } },
      } } },
    },
    fragments: { island: { instances: [{ id: "player", prefab: "actor", x: 800, y: 600 }] } },
  },
  behaviorRecipes: { entities: {} },
});
const actor = applied.entityHandles.player;
const movement = engine.moveHd2dKinematicBodyWithTilemap(actor, {
  displacementX: 20, displacementY: 0, solidMaskBits: 1 << 3,
});
```

`components.body`는 같은 entity에 `static`, `kinematic`, `dynamic` body를 설치한다. 생략하면 기존
collider-only 장식/trigger 계약을 유지한다. 지원하지 않는 body 필드는 경로를 포함한 diagnostic으로
거부한다. `collider: "none"`과 body를 함께 쓰는 것은 거부한다.
`heightSpan`은 optional이며 HD-2D mover를 사용할 때 명시한다. 높이의 `height`는 이 authoring
경로에서 양수다. 별도 body를 생성하거나 sprite transform을 JS에서 매 frame 복사하지 않는다.

현재 flat 경로의 `heightSpan.elevation`은 물리 높이 필터와 depth sort metadata에 반영되지만
sprite의 화면 높이를 자동으로 올리지는 않는다. `groundYScale`은 지면 XY의 압축 투영이며
입체 camera나 GPU depth buffer를 제공하지 않는다. 층별 충돌/정렬과 실제 입체 공간 표현을 구분한다.

현재 개발 소스는 authored dynamic body를 지원한다. 다음은 밀어서 이동하는 상자용 작성 예다.

```ts
// props.components의 visual/collider/layer와 함께 작성한다.
const body = {
  type: "dynamic", mass: 1, gravityScale: 0,
  linearDamping: 3, angularDamping: 3, canSleep: true,
  material: { friction: 0.6, restitution: 0 },
  heightSpan: { floorId: 0, elevation: 0, height: 1 },
};
// collider는 isTrigger:false로 작성하고, 적용 후 받은 authored handle을 사용한다.
const box = applied.entityHandles.box;
engine.configureAutoRigidBodyStep({ gravityX: 0, gravityY: 0 });
engine.applyPhysicsBodyImpulse(box, 0, -180);
```

`dynamic` 전용 optional 필드는 `mass`(기본 1), `canSleep`(true), `gravityScale`(1),
`linearDamping`/`angularDamping`(0), `material.friction`(0.4)/`material.restitution`(0)이다.
mass는 collider 면적·instance scale과 독립적인 명시적 질량이며 양수 finite f32와 유한한 역수가
필요하다. damping과 재질 값은 음수가 아닌 finite f32, gravityScale은 finite f32여야 한다.
`material`은 이 두 필드만 지원하며 density/solver tuning은 이 작성 계약에 포함하지 않는다.
`static`/`kinematic`에는 기존 `type`/`heightSpan`만 허용한다.
AABB/circle/capsule/orientedBox/convexPolygon의 관성은 scale이 적용된 native collider geometry로 계산한다.

body 작성만으로 자동 stepping을 켜지 않는다. 자동 실행은 `configureAutoRigidBodyStep`으로 설정하며,
수동 실행은 `stepRigidBodies`를 호출한다. Data Scene의 일반 velocity 이동은 dynamic/static/disabled
body를 적분하지 않는다. 자동 stepping이 켜진 Data Scene은 kinematic 이동도 solver에 맡겨
프레임마다 한 번만 적분한다. 자동 stepping이 꺼진 기존 kinematic velocity 이동은 유지한다.
`pauseDataScene()`은 자동 simulation을 멈춘다. 명시적 수동 `stepRigidBodies` 호출은 앱이 관리한다.

authored dynamic handle은 `navigation.obstacles: [{ instanceId: "box", collider: true }]`에도 그대로
사용할 수 있다. Rust가 현재 collider 위치/회전과 활성 상태로 차단 칸을 계산하므로 별도 authored
proxy나 JS transform 동기화가 필요 없다. obstacle은 활성 non-trigger collider를 요구하며
기본 Data Scene grid는 XY 평면으로 검사한다.
progress 저장은 authored identity, 활성 상태와 obstacle binding을 보존한다. 위치/속도/회전은
progress에 포함하지 않으며, 재진입 시 authored 초기 위치로 생성한다. 세션 내 물리 복구는
`capturePhysicsBodyStateBuffer`/`restorePhysicsBodyStateBuffer`를 사용한다.
raw runtime spawn을 authored ID 대신 obstacle에 연결한 progress 저장은 계속 거절한다.

`setPhysicsBodyEnabled(handle, false)`는 collider를 함께 끄지 않아도 충돌과 공간 query/raycast/shape-cast에서
body 전체를 제외한다. 다시 활성화하면 켜져 있던 collider가 query에 복귀한다. body 없는 collider-only
객체와 활성 sleeping body는 query에 남고, 비활성 body도 `getPhysicsEntity`/bulk state로 조회할 수 있다.
이 제외 동작과 authored dynamic 지원은 현재 개발 소스의 변경이며 기존 beta 배포와 구분한다.

렌더와 collider는 하나의 Rust transform을 읽는다. visual origin은 collider를 이동하지 않는다.
`originY: 1`이면 entity 위치가 sprite 하단 중앙이고 작은 발 collider를 같은 위치에 둘 수 있다.
instance scale은 sprite 크기와 collider geometry/offset에 적용하며 물리 높이 정보는 바꾸지 않는다.
body rotation은 초기 instance 회전에 더해진다. AABB/circle/capsule의 body 회전 및 collider offset은
기존 [좌표계 계약](coordinate-system.md)을 따른다. 회전하는 충돌 형상이 필요하면 orientedBox를 사용한다.

`despawnPhysicsEntity`, Data Scene reset/reapply는 sprite와 body를 함께 제거한다.
장면 초기화는 슬롯 generation을 보존·증가시키므로 이전 handle을 새 객체에 사용할 수 없다.
재적용 결과의 `entityHandles`를 다시 받으며, 카메라/라벨의 anchor도 새 handle로 연결한다.
Placement Viewer의 visual/collider 편집과 ObjectDefinition 생성은 기존 body, dynamic tuning/material, heightSpan, depthSort와
변경하지 않은 tint/alpha를 보존한다. body 자체의 작성과 수정은 agent/spec에서 수행한다.

## 정렬, 원점, 색조

Data Scene은 아래 우선순위로 그린다. 나중에 그린 객체가 앞에 보인다.

1. `1000 + (visual.layer ?? instance.layer)` — 배경/월드/전경을 분리하는 최우선 band.
2. `visual.depthSort: "hd2d"`인 sprite의 floor → elevation → 발 위치.
3. `visual.sortOrder` (기본 0), 동일하면 entity id.

`depthSort`의 기본값은 `"layer"`다. 해당 sprite의 depth 값은 0으로 정규화되며, 별개 body에
heightSpan을 붙여도 바뀌지 않는다. Y-sort할 actor/나무는 같은 layer와 `"hd2d"`를 함께 지정한다.
배경은 layer -10, 월드는 0, 전경은 10처럼 나눈다. 같은 layer에서 두 모드를 섞으면 일반 sprite는
floor/elevation/footY가 0인 항목으로 비교된다. 서로 다른 그룹은 layer로 명시적으로 분리한다.

HD-2D metadata가 없는 sprite의 floor/elevation은 0이다. 발 위치는
`entity.y + sprite.height × (1 - originY)`이며, 기울어진 그림과 무관한 지면상의 정렬 기준이다.
`0.1.0-beta.3`부터 제공하는 지면 투영에서는 upright의 높이 offset을 `groundYScale`로 나눠 같은 지면 단위로
비교한다. ground sprite는 이미지와 offset이 함께 압축되므로 위 식을 유지한다.
내장 Shooter/Breakout/Platformer의 기존 전역 HD-2D 정렬은 유지한다. Data Scene tilemap은 기존
배경 pass, particle은 월드 이후 pass를 유지한다. Data Scene world text의 `renderLayer`는
기존 absolute layer 값이므로 sprite의 `1000 + layer`와 맞춰 지정한다.

`originX/Y`는 기본 0.5다. 0/0.5/1 및 유한한 외부 pivot을 지원한다. instance scale 후 origin을
기준으로 회전하고, 최종 quad 중심과 회전된 bounds를 Rust에서 계산해 culling한다.
`SpriteRenderCommand`는 기존 15-float/60-byte ABI를 유지한다.

`tint`가 있으면 `color`보다 우선한다. 둘 다 없으면 흰색이다. primitive visual에도 `color`를
적용한다. 지원 형식은 sRGB hex `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`이고 다른 CSS 표현식은
조용히 무시하지 않고 diagnostic으로 거부한다. 직접 authoring apply에는 renderer와 같은
`{ colorManagement: "linear-srgb" }`를 전달하면 RGB만 linear로 변환한다. alpha는 변환하지 않는다.
`createFerrumRuntime`이 렌더러를 생성하면 최상위 또는 `webgl2`/`webgpu` 옵션에서 해석한 색 공간을 Data Scene 초기 적용·reapply·transition에 전달한다. Data Scene에 다른 색 공간을 지정하면 적용 전에 오류를 반환한다. 외부 renderer를 주입하는 경우 `dataScene.colorManagement`를 renderer와 일치시킨다.
사용자 renderer를 주입했다면 그 모드와 옵션을 일치시킨다. legacy sprite shorthand도 계속 지원한다.

## 카메라, zoom, pointer, lighting

```ts
import { createDataSceneView } from "@ferrum2d/ferrum-web/core";

const view = createDataSceneView(engine, renderer, canvas, {
  follow: actor, x: 800, y: 600, zoom: 1.5,
  bounds: { minX: 0, minY: 0, maxX: 1600, maxY: 1200 },
  smoothTimeSeconds: 0.15,
});
canvas.addEventListener("pointerdown", (event) => {
  const target = view.pointerToWorld({ x: event.clientX, y: event.clientY });
  // target은 물리 world 좌표다. 기존 이동/경로 찾기 API에 전달한다.
});
```

`engine.setDataSceneCamera(...)`는 center/follow/bounds/smoothing을 설정한다. follow는 generation-safe
handle이며 Rust simulation 뒤, render command/culling 전에 갱신한다. body가 없어도 transform이
있는 Data Scene sprite를 추적할 수 있다. invalid/stale handle은 false를 반환하고, 추적 대상이
제거되면 현재 위치에 멈춘다. reset/reapply는 follow와 bounds를 초기화한다.

`view.setCamera(...)`는 전체 camera 설정을 교체한다. 생략한 follow/bounds/smoothing은 해제된다.
zoom 변경은 이 view를 통해 한 곳에서 관리한다. `view.setZoom(...)`는 renderer의 `setViewportZoom(...)`과 engine viewport를 갱신한다.
WebGL2와 WebGPU 모두 이 capability를 제공한다. 주입한 renderer가 제공하지 않으면 명확히 실패한다.
`CameraRigController`, `resolveCameraRigSpec`, `clampCameraToBounds`도 `/core`에서 import할 수 있다.
기존 rig를 직접 계산하는 앱은 결과 center를 `setDataSceneCamera({ x, y })`로 전달할 수 있다.

좌표 관계는 다음과 같다.

- world → logical viewport: camera 좌상단을 뺀다. 이 값은 sprite/text/debug/lighting의 렌더 좌표다.
- logical → CSS: zoom을 곱한다. renderer 논리 크기는 `canvas.clientWidth/zoom`, `clientHeight/zoom`이다.
- CSS → device: 실제 canvas backbuffer/CSS 크기 비율을 곱한다. DPR은 world나 물리 크기를 바꾸지 않는다.

`view.snapshot(frame)`에 같은 frame의 cameraX/Y를 전달하고 그 snapshot을 `worldToScreen`,
`screenToWorld`, `pointerToWorld`, `lighting`에 공유한다. 반환 screen은 canvas-local CSS 좌표다.
`pointerToWorld`는 client 좌표의 canvas rect offset과 축 방향 CSS 크기 차이도 반영한다.
`lighting(worldLighting, snapshot)`은 point light와 occluder 위치를 logical 좌표로 변환한다.
radius/size는 world 단위를 유지한다. viewport zoom이 renderer의 해상도 변환을 담당하므로 여기서
한 번 더 확대하지 않는다. 객체 수가 많은 앱은 같은 snapshot과 bulk body buffer를 사용한다.

`0.1.0-beta.3`의 [표현 확장](data-scene-presentation.md)은 선택적인 `groundYScale` 지면 투영과
직립 sprite, 클립 전환, 태양 그림자를 제공한다. 기본값 1에서는 위 좌표 계약을 유지한다.
world는 평면 2D이며 zoom은 균일하다. 회전·skew CSS 변환은 지원하지 않는다. HTML HUD/일지는 화면 공간으로 유지할 수 있고, 월드 sprite와
world label은 native renderer를 사용한다. 모달 입력 차단은 consumer 입력 흐름에서 처리한다.

## 실행 가능한 recipe와 검증

[공개 API recipe](https://github.com/silbaram/ferrum2d/blob/main/examples/data-scene-native/main.mjs)는 불투명 배경, 나무, 발 기준 actor,
조개 trigger, world label, point light, occluder, collider debug를 하나의 카메라에 연결한다.
이 recipe는 QA 계측을 위해 frame command를 복사한다. 실제 게임에서는 해당 복사와 deprecated
command option을 제거하고 bulk render buffer를 그대로 소비한다.

```bash
pnpm smoke:data-scene
```

이 명령은 Wasm과 JS를 빌드하고 runtime을 실제 `pnpm pack`으로 포장·추출한 후 public import map으로 브라우저에서
recipe를 실행한다. 1280×720 / 390×844, DPR 1/2에서 픽셀 색조·가림 순서·높이 span 변경 안정성,
물리 이동/조개 위치, pan/zoom/resize, 실제 pointer 클릭, culling, label/light 좌표와 stale handle을
검사한다. 결과는 `artifacts/data-scene-consumer-*/report.json`에 남긴다.
설치만 요청한 게임 프로젝트에서 이 명령이나 recipe를 자동 생성/실행하지 않는다.
