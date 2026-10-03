# Data Scene 애니메이션·지면 투영·태양 그림자

#68~#70에서 추가한 공개 API다. **아직 릴리즈되지 않은 개발 브랜치 기능**이며,
`0.1.0-beta.2`에는 포함되지 않는다. [native actor 조립](data-scene-native-runtime.md)에
이어 적용한다. 초기 설치용 템플릿은 예제 게임이나 아래 recipe를 자동 생성하지 않는다.

## 캐릭터별 atlas 클립

`components.visual`의 sprite 또는 기존 `components.sprite`에 `animationSet`을 지정한다.
동일 texture ID를 공유해도 entity마다 재생 시간과 방향은 독립적이다.

```ts
const animationSet = {
  initialClip: 0,
  clips: [
    { id: 0, fps: 8, frames: [{ u0: 0, v0: 0, u1: 0.25, v1: 1 }] },
    { id: 1, fps: 8, loop: true, frames: [
      { u0: 0.25, v0: 0, u1: 0.5, v1: 1 },
      { u0: 0.5, v0: 0, u1: 0.75, v1: 1 },
    ] },
  ],
};
// authoring: visual: { kind: "sprite", texture: 2, width: 32, height: 48, animationSet }
engine.configureDataSceneSpriteAnimation(actor, animationSet); // 이미 생성한 actor에도 설치 가능
engine.updateDataSceneSpriteAnimations([
  { entity: actor, clip: 1, flipX: true },
  { entity: anotherActor, clip: 0, flipX: false, paused: true },
]);
```

- clip ID는 0~65535 정수, 한 set은 1~64 clips, clip마다 1~32 UV frames와 fps 0.001~1000이다.
- `initialClip` 기본값은 첫 clip ID, `loop` 기본값은 true다. UV는 f32 변환 후에도 양의 면적을 갖는 [0,1] 범위다.
- `clip` 변경 시 `restart` 기본값은 true다. false이면 경과한 **초**를 보존하고 새 clip 길이에 따라 반복 또는 끝으로 제한한다.
- `frame`은 선택 clip의 0 기반 위치다. seek 자체는 정지하지 않으므로 고정하려면 `paused: true`를 함께 전달한다.
- `flipX/flipY`는 UV만 바꾼다. entity, origin, body, collider, depth 기준, texture ID는 유지한다.
- `loop: false`는 마지막 frame을 유지하며 재생 길이에 도달하면 `finished: true`가 된다.
- scene pause 중 시간은 진행하지 않는다. clip pause와 scene pause는 별도 상태다.
- 형식 오류는 diagnostic을 던진다. 없는 clip/frame, 중복 handle 또는 stale handle이면 batch 전체가 false로 거부되고 아무 항목도 변경하지 않는다.
- `dataSceneSpriteAnimationState(handle)`는 진단용 snapshot이다. 없는/stale handle은 undefined이며 destroy 이후 API는 오류를 던진다.

기존 `animation: { frameCount, fps }`와 명시적인 animation frames는 그대로 쓸 수 있다.
`animation`과 `animationSet`을 동시에 지정하면 모호한 재생을 피하기 위해 거부한다. 재설정은 clock/pause/flip을 초기화한다.
scene reapply 시 새 handle로 다시 연결한다. AnimationTimeline은 앱의 연출 이벤트를 구성할 때
전환 batch를 호출할 수 있지만 native clip의 시간을 매 frame JS에서 계산할 필요는 없다.

## 지면과 직립 이미지

```ts
import { createDataSceneView } from "@ferrum2d/ferrum-web/core";

const view = createDataSceneView(engine, renderer, canvas, {
  follow: actor, zoom: 1.5, groundYScale: 0.72,
});
// 지면: visual.projection = "ground"
// 캐릭터/나무: visual.projection = "upright" (기본값), originY = 1 권장
```

`groundYScale`은 0.01~1이며 기본값 1은 기존 평면 렌더다. 지면의 Y만 화면에서 압축한다.
Wasm의 f32로 반올림된 값이 frame snapshot에 반환되며 최솟값 0.01도 같은 경계로 검증한다.
world/physics/tilemap/heightSpan 데이터는 바뀌지 않는다. 카메라 중심 `(cx,cy)`에 대해
논리 좌표는 `(world.x-cx+viewportWidth/2, (world.y-cy)*groundYScale+viewportHeight/2)`다.
CSS 좌표는 여기에 zoom을 곱하며 DPR은 backbuffer에만 적용한다.

`ground` quad는 회전 후 local Y도 압축한다. `upright`는 anchor만 투영하고 pivot에서 이미지까지의
거리와 크기는 유지한다. tilemap은 지면, particle은 직립 quad, world text는 투영한 anchor와
직립 glyph를 사용한다. world text의 local offset은 world 단위다. collider debug는 지면 투영을 따른다.
화면 공간 HTML HUD에는 이 변환을 적용하지 않는다.

`depthSort: "hd2d"`는 upright의 발 기준을 `entity.y + height × (1 - originY) / groundYScale`로
비교한다. 기본 originY 0.5와 발에 고정한 originY 1을 섞어도 투영된 발 순서를 따른다.
ground sprite는 분모 1을 사용한다. 기존 계약대로 이미지 회전은 깊이 정렬 기준에 반영하지 않는다.
world text도 직립 block 높이를 scale로 나눠 같은 지면 단위로 정렬하며 glyph layout은 재생성하지 않는다.

`view.snapshot(frame)`을 해당 frame의 pointer/좌표/lighting 계산에 공유한다. 반환된
`groundYScale`, worldMin/Max와 worldHeight는 Rust의 실제 카메라와 일치한다. light/occluder의 Y와
높이를 함께 변환하며 point light의 타원 falloff는 `radiusY`로 표현한다. 카메라 bounds/follow와
culling은 늘어난 지면 시야 및 화면에 남은 직립 sprite의 윗부분까지 고려한다.
점광원 그림자의 `maxDistance`와 `projectionLength`도 `radius`와 같은 단위로 계산하며,
Y 거리는 `radiusY / radius`로 정규화한다. 세로 반경 변경은 차폐물 culling과 geometry cache에 반영된다.
resize나 zoom 변경 직후 입력에는 **표시된 frame snapshot**을 사용한다.

Data Scene reapply는 ground scale을 유지하고 follow/bounds를 해제한다. 새 handle로 view를 다시
만들거나 camera follow를 재설정한다. 내장 게임 씬으로 전환하면 scale은 1로 돌아가고 renderer는
render buffer의 frame metadata를 따라간다. 사용자 renderer는 `setGroundYScale`과 ground flag를
지원해야 한다. capability가 없는 renderer에 1 이외의 값을 설정하면 오류다.

WebGL2와 WebGPU legacy에서 지원한다. WebGPU의 `linear-srgb`는 기존과 같이 미지원이며
`createRenderer`의 명시적 WebGL2 fallback을 사용한다. 3D perspective, camera tilt/yaw, CSS 회전/skew,
sprite normal map 또는 여러 층 사이의 shadow receiver 판정은 제공하지 않는다.
앱에서 이미 지면 좌표를 압축하고 있었다면 그 변환을 제거하고 native view 하나로 통일한다.

## 방향광과 지면 그림자

```ts
view.setSun({
  directionX: 1, directionY: 0.5, intensity: 0.15,
  color: [1, 0.98, 0.9], shadowOpacity: 0.35,
  shadowLengthScale: 0.8, maxCasters: 512,
});
// authoring visual.shadow: { shape: "ellipse", width: 24, height: 48, opacity: 1 }
// render callback:
const snapshot = view.snapshot(frame);
renderer.setLighting(view.lighting({ ambient: [0, 0, 0, 0.2], pointLights: [] }, snapshot));
renderer.render();
renderer.renderCommands(frame.renderCommandBuffer);
renderer.renderPostProcess();
```

direction은 **그림자가 뻗는 지면 방향**이며 내부에서 정규화한다. 방향광은 normal 없이 화면 전체에
가산되는 2D light다. 색은 기존 point light와 같은 working-space 수치이며 intensity는 0~1이다.
shadowOpacity는 별도의 0~1 미술 설정이다. intensity 0 또는 `view.setSun(false)`는 native caster도
끄며, `maxCasters: 0`은 광원은 유지하고 그림자만 끈다. `engine.setDataSceneSun`을 직접 호출할 때는
renderer의 `directionalLight`도 따로 설정한다. `view.setSun`과 `view.lighting` 조합이 둘을 연결한다.

그림자는 명시적인 **ellipse/box**를 사용한다. alpha silhouette를 추출하지 않으며 collider와 별개다.
width/height는 생략하면 visual 크기, opacity는 1, layer는 소유 sprite보다 1 낮은 band다.
instance scale을 적용한 height에 `shadowLengthScale`(0.01~100)을 곱해 길이를 정한다.
회전된 이미지의 하단 중앙에서 시작하므로 `originY: 1`이면 entity 발 위치와 일치한다.
최종 alpha는 caster.opacity × sun.shadowOpacity × sprite alpha다. 배경은 이 layer보다 낮게 배치한다.

색/alpha 합성은 기존 renderer 계약을 유지한다. WebGL2 legacy의 SRC_ALPHA 합성에서는 불투명
배경에 alpha 0.5 shadow를 그린 readback alpha가 약 191이고, linear-sRGB는 255를 유지한다.
native WebGPU는 기존 separate-alpha 합성을 사용한다. 투명 canvas와 정확한 합성 색이 필요하면
WebGL2 linear-sRGB를 사용한다.

Rust가 transform/pivot/alpha/sun/투영 변화에 따라 geometry를 갱신하고 정적 caster는 재사용한다.
camera 이동은 cache를 재생성하지 않는다. despawn/reapply는 entity와 cache를 함께 제거한다.
caster마다 texture/FBO/pass를 생성하지 않으며 기존 sprite batch에 command 한 개를 추가한다.
renderer destroy는 공유 GPU 자원을 해제한다. 화면 밖 caster를 제외한 뒤 `maxCasters`(기본 512,
최대 10000)까지 안정적인 entity 순서로 제출한다. opacity 또는 sprite alpha가 0인 caster는 이
budget을 소비하지 않는다. cache 검사/culling 자체는 등록 caster 수에 비례한다.

`engine.dataSceneGroundShadowStats()`는 직전 render build의 `casters`, `cacheHits`, `rebuilds`,
`culled`, `skippedByBudget`를 반환한다. cache counter에는 culling/budget으로 제출하지 않은 항목도
포함된다. 그림자를 끈 경우에는 cache 계산도 생략하고 counter는 모두 0이다. 태양 그림자 command는 일반 sprite draw 통계에 들어가며 point-light occluder의
`shadowDrawCalls`와 구분된다. 배치 수는 texture/layer 순서와 material 추가 pass에 따라 달라진다.

## 실행과 검증

[공개 API recipe](https://github.com/silbaram/ferrum2d/blob/main/examples/data-scene-native/presentation.mjs)는
공유 atlas의 두 actor, 지면/나무, label/particle, sun/point light와 debug를 조합한다.
QA용 command 복사를 켠 예제이므로 제품 게임에서는 복사를 제거하고 buffer를 직접 소비한다.

`pnpm smoke:data-scene-presentation`은 실제 Wasm 및 runtime tarball을 사용한다.
1280×720 / 390×844 × DPR 1/2 × legacy/linear-sRGB에서 frame/flip 픽셀,
투영/입력/가림/그림자와 lifecycle을 검사한다. caster 100/500/1000의 command/draw/resource 비용도
기록한다. 결과와 스크린샷은 `artifacts/data-scene-presentation-*/`에 남는다.
기본/발 pivot 혼용과 world text의 가림 픽셀, 타원 점광원 차폐물 픽셀과 반경 변경, f32 최솟값 0.01의
실제 frame 진행도 두 renderer에서 확인한다.

같은 smoke는 WebGPU에서도 실제 texture/command queue/WGSL을 사용해 DPR 1/2의 GPU readback
픽셀과 validation error를 검사한다. headless canvas swapchain과 분리한 offscreen target을 사용하며
`--webgpu-only`는 이 두 사례만 실행한다. WebGL2 fallback을 성공으로 집계하지 않는다.
소프트웨어 adapter의 수치는 실제 GPU 성능이나 native canvas presentation 검증을 대체하지 않는다.
