# Data Scene native actor와 카메라 연결

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

`components.body`는 같은 entity에 `static` 또는 `kinematic` body를 설치한다. 생략하면 기존
collider-only 장식/trigger 계약을 유지한다. `dynamic`이나 지원하지 않는 body 필드는 경로를 포함한 diagnostic으로 거부한다. `collider: "none"`과 body를 함께 쓰는 것은 거부한다.
`heightSpan`은 optional이며 HD-2D mover를 사용할 때 명시한다. 높이의 `height`는 이 authoring
경로에서 양수다. 별도 body를 생성하거나 sprite transform을 JS에서 매 frame 복사하지 않는다.

렌더와 collider는 하나의 Rust transform을 읽는다. visual origin은 collider를 이동하지 않는다.
`originY: 1`이면 entity 위치가 sprite 하단 중앙이고 작은 발 collider를 같은 위치에 둘 수 있다.
instance scale은 sprite 크기와 collider geometry/offset에 적용하며 물리 높이 정보는 바꾸지 않는다.
body rotation은 초기 instance 회전에 더해진다. AABB/circle/capsule의 body 회전 및 collider offset은
기존 [좌표계 계약](coordinate-system.md)을 따른다. 회전하는 충돌 형상이 필요하면 orientedBox를 사용한다.

`despawnPhysicsEntity`, Data Scene reset/reapply는 sprite와 body를 함께 제거한다.
장면 초기화는 슬롯 generation을 보존·증가시키므로 이전 handle을 새 객체에 사용할 수 없다.
재적용 결과의 `entityHandles`를 다시 받으며, 카메라/라벨의 anchor도 새 handle로 연결한다.
Placement Viewer의 visual/collider 편집과 ObjectDefinition 생성은 기존 body, heightSpan, depthSort와
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

2.5D affine 지면 투영/직립 sprite 역보정/회전·skew CSS 변환은 이 경로가 제공하지 않는다.
world는 평면 2D이며 지원 zoom은 균일하다. 앱이 별도 투영을 추가하면 렌더·입력·light/occluder·culling
역변환도 앱에서 함께 책임진다. HTML HUD/일지는 화면 공간으로 유지할 수 있고, 월드 sprite와
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
