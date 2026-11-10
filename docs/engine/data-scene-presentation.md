# Data Scene 애니메이션·지면 투영·태양 그림자

#68~#70에서 추가한 공개 API이며 `0.1.0-beta.3`부터 제공한다.
아래 `shape: "alpha"`는 #73 B2 후속 구현이며 **`0.1.0-beta.5`부터 제공한다**.
beta.4 이하에서는 ellipse/box를 사용하거나 패키지를 업그레이드한다.
프레임별 시간·재생 방향·256프레임·재생 이벤트(PX-04)는 현재 개발 소스의 확장이다.
SDK와 함께 빌드한 v2 configure 지원 Wasm이 필요하며 기존 배포 버전의 지원으로 간주하지 않는다.
[native actor 조립](data-scene-native-runtime.md)에
이어 적용한다. 초기 설치용 템플릿은 예제 게임이나 아래 recipe를 자동 생성하지 않는다.

이 문서는 기존 평면 투영과 지면 그림자의 계약이다. 개발 소스의 입체 지형·직교/원근 카메라·
깊이 버퍼·물리 높이 자동 반영은 별도 opt-in [공간 경로](data-scene-spatial.md)에서 제공한다.

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

- clip ID는 0~65535 정수, 한 set은 1~64 clips, clip마다 1~256 UV frames이고 원본 frame 합계는 4096 이하다.
- 시간은 `fps: 0.001..1000` 또는 `frameDurationsMs` 중 하나만 지정한다. ms 배열은 frames와 같은 길이이며 각 값은 1..1,000,000의 유한 f32다.
- `initialClip` 기본값은 첫 clip ID, `loop` 기본값은 true다. UV는 f32 변환 후에도 양의 면적을 갖는 [0,1] 범위다.
- `clip` 변경 시 `restart` 기본값은 true다. false이면 경과한 **초**를 보존하고 새 clip 길이에 따라 반복 또는 끝으로 제한한다.
- `frame`은 원본 frames의 0 기반 index다. reverse에서도 같은 원본 index를 쓰고 pingpong은 첫 등장(outbound)을 선택한다.
  seek 자체는 정지하지 않으므로 고정하려면 `paused: true`를 함께 전달한다.
- `flipX/flipY`는 UV만 바꾼다. entity, origin, body, collider, depth 기준, texture ID는 유지한다.
- `loop: false`는 재생 순서의 마지막 frame을 유지하며 재생 길이에 도달하면 `finished: true`가 된다.
- scene pause 중 시간은 진행하지 않는다. clip pause와 scene pause는 별도 상태다.
- 형식 오류는 diagnostic을 던진다. 없는 clip/frame, 중복 handle 또는 stale handle이면 batch 전체가 false로 거부되고 아무 항목도 변경하지 않는다.
  명시적인 `clip: null`·`frame: null`과 빈 항목이 있는 배열도 형식 오류이며 native batch를 호출하기 전에 거절한다.
- `dataSceneSpriteAnimationState(handle)`는 진단용 snapshot이다. 없는/stale handle은 undefined이며 destroy 이후 API는 오류를 던진다.

기존 `animation: { frameCount, fps }`와 명시적인 animation frames는 그대로 쓸 수 있다.
`animation`과 `animationSet`을 동시에 지정하면 모호한 재생을 피하기 위해 거부한다. 재설정은 clock/pause/flip을 초기화한다.
scene reapply 시 새 handle로 다시 연결한다. AnimationTimeline은 앱의 연출 이벤트를 구성할 때
전환 batch를 호출할 수 있지만 native clip의 시간을 매 frame JS에서 계산할 필요는 없다.

### 프레임별 시간과 재생 방향

```ts
engine.configureDataSceneSpriteAnimation(actor, {
  initialClip: 10,
  clips: [{
    id: 10,
    frames: [
      { u0: 0, v0: 0, u1: 0.25, v1: 1 },
      { u0: 0.25, v0: 0, u1: 0.5, v1: 1 },
      { u0: 0.5, v0: 0, u1: 0.75, v1: 1 },
    ],
    frameDurationsMs: [90, 180, 90],
    direction: "pingpong", loop: true, emitEvents: true,
  }],
});
```

`direction`은 생략 시 `forward`다. `reverse`는 마지막 원본 frame부터 시작하고 각 frame의 시간을 역순으로 소비한다.
3프레임 pingpong loop는 `0,1,2,1`이며 끝점을 중복하지 않는다. nonloop는 `0,1,2,1,0`의 마지막 0번 frame 시간까지
재생한 뒤 0에서 완료한다. 1프레임은 어느 방향이든 한 step이다. UV를 GCD tick으로 복제하지 않아 위 예제는 원본 3프레임 그대로다.

명시적인 `animationSet`을 확장하며 기존 고정 배열 기반 legacy SpriteAnimation은 유지한다.
기존 가져오기/노멀 변환기의 GCD·프레임 한도는 해당 도구의 별도 계약이다.
새 필드 또는 33프레임 이상은 v2 bulk configure를 사용하고, 없는 Wasm에서는 명확한 오류로 거절한다.
runtime target은 설정 검증과 capability 준비를 entity 생성 전에 수행한다.

### 프레임·완료 이벤트

`emitEvents`는 기본 false다. true이면 기존 `onFrame`의 `FrameState.gameplayEvents`에서 관측한다.
`includeGameplayEvents: false`면 decoded 배열을 받지 않으므로 이 옵션을 함께 확인한다.

| kind / code | tokenId | payloadBits | 의미 |
| --- | --- | --- | --- |
| `spriteAnimationFrame` / 12 | clip ID | 원본 frame index | 양의 시간 진행으로 다음 frame에 진입 |
| `spriteAnimationCompleted` / 13 | clip ID | 완료 시 원본 frame index | nonloop 끝을 통과한 완료 전이 |
| `spriteAnimationOverflow` / 14 | 0 | 누락 이벤트 수 | frame 전체 애니메이션 이벤트 예산 초과 |

12/13은 actor/source에 같은 entity id·generation을 담고 flags는 0이다. 14는 actor/source id가 `0xffffffff`,
generation이 0인 전역 진단이며 누락 수는 u32 최대에서 포화한다. overflow도 처리해 과부하 시 이벤트 손실을 감지한다.

```ts
for (const event of frame.gameplayEvents) {
  if (event.kind === "spriteAnimationFrame" && event.tokenId === 10 && event.payloadBits === 1) {
    // 해당 프레임의 소리·표현 효과를 연결한다.
  }
}
```

한 update가 여러 frame/loop를 통과해 최종 frame이 같아도 중간 진입을 순서대로 발행한다.
순서는 fixed step, 살아 있는 entity 순회, 해당 clip의 시간 순서다.
configure·seek·restart·복원은 초기/과거 frame 이벤트를 발행하지 않는다. 1프레임 loop는 주기마다 frame 0을 발행한다.
완료 상태는 다음 update에서 반복 통지하지 않으며 완료 상태를 복원해도 재발행하지 않는다.
scene/clip pause 중 시간과 이벤트는 진행하지 않는다.

기존 8u32 GameplayEvent ABI를 유지한다. frame buffer의 첫 4096개 범위에서 새 애니메이션 이벤트를 제공하며
다른 gameplay 이벤트도 이 범위를 차지할 수 있다. 초과 시 새 frame/완료 이벤트를 생략하고 전역 overflow 레코드 한 개에
누락 수를 누적한다. 기존 gameplay 이벤트를 제거하지 않는다. 기본 비활성으로 기존 replay/event 출력을 유지한다.
FSM/Behavior Recipe의 새 이벤트 binding이나 타임라인 편집 UI는 이 관측 API에 포함하지 않는다.

재생 위치는 기존 `elapsedSeconds` phase로 저장한다. frame/finished와 pingpong 진행 방향은 authored clip에서 다시 계산하므로
기존 progress 포맷·spawned actor checkpoint·WorldSnapshot을 유지한다. FPS-only duration은 기존 나눗셈을 그대로 사용하며,
variable ms는 재생 순서대로 f32 ms를 f64 초로 누적한다.

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

WebGL2와 WebGPU의 legacy/linear-sRGB에서 지원한다. WebGPU 초기화 실패 시에는
`createRenderer`의 명시적 WebGL2 fallback을 사용한다. 3D perspective, camera tilt/yaw, CSS 회전/skew,
sprite normal map 또는 여러 층 사이의 shadow receiver 판정은 제공하지 않는다.
물리 `elevation`은 이 flat projection에서 sprite 위치를 자동으로 상승시키지 않는다.
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

그림자는 명시적인 **ellipse/box**, 또는 opt-in **alpha**를 사용하며 collider와 별개다.
ellipse/box는 texture alpha와 무관한 저비용 경로이고, 기존 설정의 모양·길이 계산은 유지한다.
width/height는 생략하면 visual 크기, opacity는 1, layer는 소유 sprite보다 1 낮은 band다.
instance scale을 적용한 height에 `shadowLengthScale`(0.01~100)을 곱해 길이를 정한다.
회전된 이미지의 하단 중앙에서 시작하므로 `originX: 0.5, originY: 1`이면 entity 발 위치와 일치한다.
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

### 스프라이트 alpha 윤곽

```ts
// visual: { kind: "sprite", texture: "tree", width: 48, height: 96,
//           originX: 0.5, originY: 1, shadow: { shape: "alpha", opacity: 0.8 } }
// animationSet, frame, flipX/flipY는 소유 sprite의 현재 값을 그대로 따른다.
```

이미 로드한 atlas의 **현재 UV frame과 alpha**를 GPU에서 샘플링한다. 잎 사이의 구멍은 투명하게
남고 반투명 픽셀도 유지한다. texture RGB는 그림자 색에 영향을 주지 않는다. 기본색은 검정이며
최종 alpha는 texture alpha × sprite alpha × caster opacity × sun shadowOpacity다.
별도 flat 태양 조명 없이 사용하는 기존 전역 `spriteMaterial`은 모든 sprite command에 적용된다. 따라서 ellipse/box와 마찬가지로
flash/outline의 추가 tint/pass나 additive blend가 그림자에도 영향을 준다. 일반적인 검정 지면
그림자는 기본 `unlit`/alpha blend에서 사용한다.

이는 **2D 이미지를 지면에 내려놓는 근사 표현**이다. 원본 이미지의 하단 중앙을 발로 삼고,
caster의 width/height를 적용한 뒤 sprite 회전, 태양 방향 투영, groundYScale 순서로 변환한다.
폭 축은 태양 진행 방향의 수직 방향이며 높이 축은 이미지 위쪽에서 태양 진행 방향으로 뻗는다.
따라서 수평 태양에서도 폭이 사라지지 않는다. width/height 조정이나 UV flip은 발 기준을 이동시키지
않는다. flipY로 이미지 자체를 뒤집어도 geometry의 하단 중앙이 발이다. 회전된 윤곽은 발 주변의
반대쪽 지면까지 뻗을 수 있으며 실제 3D 높이·광선·receiver 판정으로 해석하지 않는다.

Rust가 같은 affine 변환으로 중심과 culling bounds를 계산한다. 화면 밖에 있는 소유 sprite의
그림자만 화면에 걸쳐도 제출한다. geometry cache는 transform/pivot/크기/회전/alpha/sun/지면
투영 변화에 갱신하고, texture/frame/flip만 바뀌면 캐시를 유지하면서 현재 샘플 좌표를 전달한다.
카메라/zoom/DPR 변경은 geometry를 재생성하거나 texture를 재업로드하지 않는다.

caster마다 기존 command 한 개와 texture sample을 추가한다. CPU 윤곽 추출, frame별 asset texture upload는 없다.
flat 태양 조명이 없으면 기존 sprite 합성을 사용하며 별도 mask/FBO를 만들지 않는다.
flat 태양 조명이 있으면 아래의 광원별 마스크 합성을 사용한다. scene reset/despawn은 caster cache를 제거하며
atlas는 원래 asset 소유자가 공유한다. 다른 sprite도 사용할 수 있으므로 despawn이 공유 atlas를
자동 삭제하지 않는다. 필요 없어진 atlas는 기존 asset/renderer 수명 관리로 해제한다.
alpha가 전부 0인 **texture 내용**은 CPU에서 검사하지 않으므로 visible caster budget을 소비한다.
과도한 overdraw는 maxCasters와 caster 크기로 제한하고 여러 atlas의 배치 전환 비용도 고려한다.

양 backend의 legacy/linear-sRGB 모두 같은 윤곽을 지원한다. 실제 WebGPU 초기화 실패는
기존 `createRenderer` 정책대로 WebGL2 fallback을 선택한다. custom renderer나 이전 패키지를
위해서는 authoring에서 `shape: "ellipse"` 또는 `"box"`를 명시한다. 자동 contour 추출/자동 도형
대체는 하지 않는다. alpha가 없는 이미지나 primitive의 불투명 texture는 사각 윤곽이 된다.

custom buffer/renderer 계약: 15-float command의 필드 의미는 유지하고 `effectFlags & 32`를
alpha shadow로 처리한다. `RenderCommandBufferView.groundShadowProjection`의 세 f32는
정규화된 directionX/directionY와 shadowLengthScale이다. Wasm memory를 빌린 view이므로 다음
frame에서 다시 읽고, buffer 복사 시 이 metadata도 함께 복사한다. 내장 renderer는 alpha command에
metadata가 없거나 유효하지 않으면 오류를 낸다. RenderTexture 경로에도 같은 metadata가 필요하다.
이 정보와 groundYScale은 렌더 명령을 만드는 시점에 함께 확정한다. 다음 frame용 태양·지면 설정을
바꿔도 이미 만들어진 frame의 중심/투영 조합은 바뀌지 않는다.

프레임을 나중에 다시 그릴 때는 frame callback 안에서 command와 projection을 모두 복사한다.
객체 spread만 하면 typed array는 계속 Wasm memory를 참조한다. engine 파괴·메모리 재사용·증가
이후에는 해당 view가 덮어써지거나 무효화될 수 있다.

```ts
const commands = frame.renderCommandBuffer;
const captured = {
  ...commands,
  buffer: commands.buffer.slice(),
  groundShadowProjection: commands.groundShadowProjection?.slice(),
};
// captured는 이후 RenderTexture 등에 재사용할 수 있다. 매 프레임 즉시 그릴 때는 복사가 필요 없다.
```

### 건물의 입체 그림자 도형

현재 소스의 선택형 `shape:"volume"`은 건물 PNG를 눕히지 않고 직사각형 바닥·벽·박공지붕을
지면에 투영한다. 화면의 sprite와 물리 collider/body는 그대로 사용한다.

```json
{
  "shape": "volume",
  "width": 86,
  "depth": 30,
  "height": 52,
  "roofHeight": 44,
  "offsetY": -15,
  "opacity": 0.8
}
```

`visual.shadow`에 작성하며 `width/depth/height`는 필수 world 단위 바닥 폭/깊이/벽 높이다.
각각 `0.001..1,000,000`이며 기존 ellipse/box/alpha의 이미지 크기 기본값을 사용하지 않는다.
`roofHeight`는 벽 위 박공지붕의 높이(`0..1,000,000`, 기본 0)이고 용마루는 local Y축을 따른다.
`offsetX/offsetY`는 sprite 하단 중앙에서 바닥 중심까지의 이동(`±1,000,000`)이다.
기본값은 `0/-depth/2`로 앞쪽 바닥 모서리를 sprite 발 기준에 맞춘다.
치수·offset은 instance scale을 함께 적용하고, 바닥 방향은 owner rotation을 따른다.
물리 `body.heightSpan`은 이 값으로 바꾸지 않는다. 지붕 돌출·구멍·오목한 건물은 이 도형의 범위 밖이다.

바닥 네 점, 벽 위 네 점, 용마루 두 점을 `groundXY + sunDirection * height * shadowLengthScale`로
투영한 convex hull을 사용한다. 바닥은 태양 방향으로 회전하지 않으며 모든 각도에서 원래 바닥을 포함한다.
원본 alpha·flip·animation frame과 독립적이고, 캐시·culling·despawn/reset·prototype/World 복원을 기존 caster 수명과 공유한다.
기존 silhouette와 `maxCasters` 예산을 공유한다. 반투명 sprite와 지면 수신 제외는 같은 태양 마스크 계약을 따른다.

기존 세 shape의 작성 값·60-byte sprite command·normal sidecar 정렬은 유지한다.
작성/정규화 타입은 shape를 구분하는 union으로 확장되어 volume에는 물리 치수가 필요하다.
구형 Wasm의 기존 shape 사용은 허용하며 volume 요청은 새 native export가 없으면 명시적 오류를 낸다.
새 도형은 flat `LightingScene2D.directionalLight`와 함께 사용한다. standalone silhouette와 달리
sprite-only `renderToTexture`에 volume sidecar를 넘기면 지원하지 않는 조합으로 거절한다.
custom renderer는 `supportsGroundShadowVolumes:true`를 선언하고 아래 sidecar를 소비해야 한다.

`RenderCommandBufferView.groundShadowVolumes`는 선택형 version 1/stride 3이며
`vertexCount/casterCount/buffer`를 가진다. 정점마다 screen X/Y/opacity 세 f32(12 bytes),
삼각형마다 세 정점이며 caster당 최대 24정점·전체 최대 10,000 caster다.
Rust는 고정 크기 hull과 재사용 Vec로 기하를 만들고 TS는 프레임별 typed view를 GPU에 bulk upload한다.
카메라와 ground scale은 이미 반영되어 있으며 renderer는 화면 offset/pixel snap만 적용한다.
`buffer`는 Float32Array다. borrowed buffer는 다음 native 호출/메모리 증가 이후 보관하지 않는다. frame snapshot은 이 buffer도 복사한다.
custom buffer의 version/stride/count/길이/finite/opacity와 지원 조합은 GPU 제출 전에 검사한다.

두 backend는 기존 R8 태양 마스크 안에 volume 전체를 한 번의 triangle draw로 합친다.
추가 target·caster별 GPU 객체·frame별 entity 호출은 없다. vertex buffer는 최대 필요 크기까지 성장해 재사용하며
draw/caster/GPU buffer 비용을 기존 renderer 통계에 포함한다. volume은 sprite command 수에 합산하지 않는다.

`engine.dataSceneGroundShadowStats()`는 직전 render build의 `casters`, `cacheHits`, `rebuilds`,
`culled`, `skippedByBudget`를 반환한다. cache counter에는 culling/budget으로 제출하지 않은 항목도
포함된다. 그림자를 끈 경우에는 cache 계산도 생략하고 counter는 모두 0이다. 기존 silhouette 명령은
일반 sprite command 통계에 포함되며 volume은 별도 triangle sidecar다. flat 태양 조명을 함께 사용할 때의 mask draw와 caster 수도
`RendererStats.shadowDrawCalls/shadowCasterCount`에 포함한다. 배치 수는 texture/layer 순서에 따라 달라진다.

## Flat 태양광의 지면 그림자 합성

`LightingScene2D.directionalLight`와 native 지면 caster를 함께 사용하면 ellipse/box/alpha 명령을
기본 sprite 색에 그리지 않고 renderer당 한 장의 R8 마스크에 MAX union으로 합친다.
이 마스크는 태양 additive 기여만 차폐한다. 주변광·점광원·원본 sprite 색은 보존하며
태양 세기가 0이면 검은 silhouette도 남지 않는다. 겹친 caster는 차폐율을 누적하지 않는다.
upright sprite의 원본 texture/tint alpha로 지면 마스크를 제거해 벽·지붕·캐릭터를 지면 수신면으로 취급하지 않는다.
반투명 sprite는 alpha만큼 차폐율을 줄이는 근사이며 높이에 따른 벽 수신/3D 그림자를 제공하지 않는다.

마스크는 기존 UV/frame/flip·projection·groundYScale·pixel snap·화면 offset을 그대로 사용한다.
global outline/flash/palette의 추가 pass나 색은 마스크에 반영하지 않는다. 원본 sprite와 normal pass에서는
지면 caster를 생략한다. `renderToTexture`의 sprite-only 경로와 별도 flat 태양 설정이 없는 기존
`engine.setDataSceneSun` 사용은 이전 sprite 합성을 유지한다. `enabled:false`인 태양 설정은 마스크와
native silhouette의 표시를 모두 끈다.

마스크는 DPR/pixelPerfect 실제 타깃 크기와 같고 `width × height` byte를 사용한다. point 마스크와
별도로 자원·draw 통계에 포함하며 caster/foreground의 연속 texture 범위별로 그린다.
warm frame은 texture/buffer/bind group을 재사용한다. 태양 OFF·caster 없음에서 타깃을 해제하고
resize·device recovery·destroy의 기존 renderer 수명을 따른다. 새 Wasm 호출·command ABI는 없다.
정원 데모의 네 건물은 고정 바닥·벽·지붕의 volume을 명시하고, 이미지 하단의 투명 3행을
frame/표시 높이에서 함께 제외해 실제 기단을 접지 기준에 맞춘다. 지면 수신 sprite는 `projection:"ground"`로 작성한다.

## Flat 점광원의 차폐 합성

`LightingScene2D.shadows`의 tile occluder 투영은 해당 점광원의 기여에만 적용한다.
A의 그림자가 주변광, 태양 additive, B 광원이나 기존 sprite 색을 지우지 않는다.
같은 광원의 차폐 투영은 MAX blend로 합치므로 중복·겹친 차폐물이 차폐율을 누적하지 않는다.
반경 86%부터 끝까지의 기존 feather와 CPU geometry cache는 유지한다.

`shadows.color`의 RGB는 **투과 필터**, alpha는 차폐율이다.
mask를 `m`이라 하면 해당 빛의 RGB 기여에 `mix([1,1,1], color.rgb, m)`을 곱한다.
검정은 차폐, 흰색은 투과, 빨강은 빨간 성분의 투과를 뜻하며 새로운 빛을 방출하지 않는다.
alpha 0은 차폐를 해제한다. 기존의 장면 전체에 색을 덧칠하던 결과와 달라지는 버그 수정이다.
이 변경은 flat 표면색에 조도를 곱하는 albedo 모델을 추가하지 않는다. 기존 additive·노멀 반응,
지면 silhouette와 반투명 layer의 근사도 유지한다.

따라서 검은 sprite나 빈 배경·투명 구멍도 후단 광원으로 밝아질 수 있다. 기본 `unlit` sprite 프리셋은
이 전체 조명의 개별 수신 제외를 뜻하지 않는다. HUD를 제외하려면 조명 합성 뒤 `setLighting(false)`로
별도 command를 제출하고, 두 제출이 끝난 뒤 `renderPostProcess()`로 최종 표시한다. 기존 legacy WebGL2 sRGB 이미지의 premultiplied 업로드와 WebGPU의 straight-alpha
업로드 차이도 유지한다. 새 lit 수신 합성은 아직 미구현이며 [선행 설계·기준선](../development/architecture/flat-lighting-composition.md)에서 구분한다.

WebGL2/WebGPU는 renderer마다 물리 타깃 크기의 R8 마스크 **한 장**을 재사용한다.
DPR을 적용한 canvas 크기이며, pixelPerfect에서는 가상 framebuffer 크기다.
기본 mip의 추정 비용은 `width × height` byte다. 매 광원마다 clear와 geometry union 후
해당 빛을 합산하며, 광원별 texture 배열이나 caster별 GPU 객체를 만들지 않는다.
차폐 geometry가 있는 광원 M개는 mask draw M회를 사용한다. WebGL2는 기존처럼 광원당
light draw 1회와 mask draw 1회이고, WebGPU는 기존 일괄 shadow draw 대신 M회의 mask pass와
M회의 light pass를 사용한다. 차폐 없는 연속 광원은 batch를 유지하며 실제 비용을 통계에 포함한다.
WebGPU의 추가 pass는 호출자가 만든 command encoder와 한 번의 submit을 공유한다.
비활성·alpha 0·광원 없음·유효 차폐 geometry 없음에서는 추가 mask pass를 생략하고 타깃을 해제한다.
크기 변경은 자원을 교체하고, WebGPU 복구는 새 장치에서 재생성하며 destroy는 모든 소유 자원을 해제한다.

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
alpha 검사는 두 frame의 투명 구멍/반투명 픽셀, flipX/flipY, 비정사각 caster의 회전·origin·instance
scale·ground/upright·zoom·resize를 확인한다. 100/500/1000 alpha caster의 draw/command 수,
GPU texture/buffer 생존 수, frame 중 upload/readback 부재, maxCasters와 despawn/reapply도 검사한다.

같은 smoke는 WebGPU에서도 실제 texture/command queue/WGSL을 사용해 DPR 1/2의 GPU readback
픽셀과 validation error를 검사한다. headless canvas swapchain과 분리한 offscreen target을 사용하며
`--webgpu-only`는 이 두 사례만 실행한다. WebGL2 fallback을 성공으로 집계하지 않는다.
소프트웨어 adapter의 수치는 실제 GPU 성능이나 native canvas presentation 검증을 대체하지 않는다.


## Flat 2D 표면 조명 · 개발 소스

기존 `LightingScene2D`는 전체 화면에 빛을 더하는 overlay다. `profile:"lit"`을 명시하면
수광 sprite의 선형 원본 색에 조도를 곱한다. `ambientIrradiance`는 0..1의 선형 RGB이고 기본값은 `[1,1,1]`이다.
기존 `ambient` RGBA overlay와 동시에 지정할 수 없다(정규화 저장값 `[0,0,0,0]`은 허용).

```ts
await renderer.loadTexture(1, "hero.png", { colorSpace: "srgb", alphaMode: "straight" });
engine.configureSpriteLightingMaterials([{entity: hero, lighting:{mode:"cutout", alphaCutoff:0.5}}]);
renderer.setLighting({profile:"lit", ambientIrradiance:[0.15,0.15,0.15],
  pointLights:[{x:200,y:100,radius:240,height:120,color:[1,0.8,0.6,1],intensity:1}]});
```

- `components.visual`의 sprite 또는 `components.sprite`에 `lighting:{mode:"unlit"|"opaque"|"cutout",alphaCutoff?}`를 저장한다.
  생략/unlit은 수광 제외, opaque는 source alpha를 1로 처리, cutout은 texture×tint alpha가 cutoff 미만이면 버린다. cutoff 기본0.5, 유한0..1 f32다.
- normal은 선택이다. 생략하면 +Z 표면, 연결하면 기존 UV·flip·회전을 공유한 normal로 Lambert 응답을 계산한다.
- `applyDataSceneAuthoringDocument(engine, document, {flatLightingPreparer:renderer})`로 사전 자산 검증을 전달한다.
  lit snapshot restore에도 `dataSceneAuthoringApplyOptions.flatLightingPreparer`를 전달한다. 함수/renderer는 JSON에 저장하지 않는다.
  선택한 fragment·인스턴스 override의 자산을 검사하며, 한 번에 65,536개를 넘는 수광 binding은 자산 조회·씬 활성화 전에 거절한다.
- color texture는 알려진 straight alpha여야 한다. 기본 legacy GL premultiplied 자산은 명시적으로 다시 로드한다.
  normal/data texture에는 색 변환을 적용하지 않는다. 기존 업로드 기본값과 overlay 외관은 유지한다.
- 점광원 최대32개, 점광원/태양 intensity 최대64다. HDR을 생략하면 기존 SDR clamp를 유지하며, 아래 선택형 HDR은 float 월드와 노출·톤매핑을 추가한다.
- sprite base alpha material만 지원한다. primitive 수광·Spatial·outline/palette/colorMix/additive 결합은 거절한다.
- `enabled:false`는 profile/재질을 유지하며 조명 추가 비용을 없앤다. `setLighting(false)`는 기존 비활성 경로로 돌아간다.
  HUD를 별도 제출할 때는 조명을 끄고 그린 뒤 한 번 `renderPostProcess()`로 마친다.

공개 ABI·자원 비용과 회귀 기준은 [합성 구조](../development/architecture/flat-lighting-composition.md)를 따른다.


## Flat HDR · 개발 소스

`profile:"lit"`에서 `hdr:{exposure:0,toneMapping:"reinhard"}`를 선택하면 양 backend가
월드를 RGBA16F/rgba16float에 선형으로 누적한다. HDR 생략 또는 `hdr:false`,
`hdr:{enabled:false}`는 기존 SDR 경로다. `FlatHdrOptions`와 `ResolvedFlatHdrOptions`는 `/core`에서 import한다.

```ts
renderer.setLighting({profile:"lit", hdr:{exposure:0,toneMapping:"reinhard"},
  ambientIrradiance:[0.1,0.1,0.1], directionalLight:{directionX:1,directionY:0,intensity:4}});
renderer.render();
renderer.renderCommands(worldCommands);
renderer.renderCommands(worldForegroundCommands); // 같은 선형 HDR 월드에 추가
renderer.setLighting(false); // 월드를 먼저 resolve하고 HUD 경계를 시작
renderer.renderCommands(hudCommands);
renderer.renderPostProcess();
```

- `exposure`는 -10..10 stop이며 기본0이다. `toneMapping`은 `none|reinhard|aces`, 기본`reinhard`다.
  none도 마지막 SDR 출력에서 0..1로 제한한다. HDR canvas/display 출력이나 Display-P3 지원을 뜻하지 않는다.
- color는 sRGB 입력을 한 번 decode하며 linear/none·normal·mask는 decode하지 않는다.
  월드의 숫자 tint와 광원 색은 선형 값이다. textured unlit 전경을 포함해 월드의 모든 색 texture는
  알려진 straight alpha가 필요하다. `loadTexture(...,{alphaMode:"straight"})`로 준비한다.
  기존 premultiplied 입력·알 수 없는 RenderTexture 색 texture는 활성화/그리기 전에 거절한다.
- unlit 월드 전경은 조도를 받지 않지만 HDR 합성과 출력 변환을 공유한다. HUD는 위 경계 뒤에 제출한다.
  HDR 월드는 premultiplied linear로 누적하고, 출력 시 alpha를 풀어 노출·톤매핑을 적용한 뒤
  표시 색공간에서 다시 premultiply한다. 수광 sprite의 opaque/cutout 제한은 유지한다.
- 여러 월드 command를 제출해도 resolve는 한 번이다. 경계를 생략하면 `renderPostProcess()`에서 resolve한다.
  SDR 그리기 이후 HDR을 켜거나 활성 월드 중 노출/톤매핑을 바꾸면 사전에 거절한다.
  resize·zoom 변경은 `renderPostProcess()` 후 프레임 사이에 수행한다.
- 전역 화면 효과는 HDR resolve 뒤 적용한다. 기존 전역 Bloom threshold는 SDR 화면 효과의 계약을 유지한다.
  이 옵션은 별도 scene-linear Bloom을 추가하지 않는다. WebGPU 전역 `linear-srgb`와 함께 사용할 때는 선형 장면에 resolve한 뒤 최종 표시에서 변환한다.
- HDR 월드는 pixel당8 bytes, 수광 scratch는 pixel당24 bytes(기존 SDR20)다.
  광원 차폐·전역 후처리·pixel-perfect target 비용은 별도다. 활성 수광 장면은 합계32 bytes/pixel이다.
  출력 draw1회는 `postProcessDrawCalls/postProcessPassCount`와 전체 draw·texture bind 통계에 포함한다.
  HDR 비활성 시 추가 target/pass는 없으며 선택 설정은 authoring·patch·snapshot에서 보존한다.

실제 GPU readback·복구·비용 검증은 `pnpm smoke:flat-lit`에 포함한다.


## Flat sprite 표면 재질 · 개발 소스

명시적 flat lit opaque/cutout sprite에 `surface`를 연결하면 선형 발광과 제한된 비금속 직접 반사를 추가한다.
normal이 없으면 +Z, 관찰 방향은 화면 앞쪽 +Z다. ambient는 diffuse만 비추며 반사나 emission을 만들지 않는다.
전체 glTF PBR·금속·IBL·transmission·반투명 수광층은 이 profile의 범위가 아니다.

| 필드 | 범위·기본값 | map 채널 |
| --- | --- | --- |
| `emission` | 선형 RGB0..64, 기본 검정 | `emissionTexture`의 RGB와 곱함. sRGB는 한 번만 decode |
| `specular` | 0..1, 기본0 | `specularTexture`의 raw A와 곱함. RGB 미사용 |
| `roughness` | 0..1, 기본1 | `roughnessTexture`의 raw G와 곱함. 나머지 채널 미사용 |

map 생략은 해당 계수에1을 곱하는 것과 같다. emission은 base albedo·tint RGB와 독립적이며 수광 coverage로 가려진다.
cutout discard는 모든 성분을 함께 버리고, opaque는 source alpha를1로 취급한다.
반투명 unlit 전경은 아래 기여를 source-over로 가린다. map의 alpha는 coverage를 새로 만들지 않는다.

map3개는 base texture와 같은 크기의 알려진 straight-alpha 자산이어야 한다.
발광 map은 `srgb|linear|none`, specular/roughness map은 `linear|none`이며 sRGB data map은 거절한다.
base와 같은 atlas UV·프레임 애니메이션·flip·회전을 사용한다. 추가 map은 clamp·nearest의 level0 texel load이며
독립 UV transform/filter/mipmap은 없다. 각 자산의 upload Y flip은 따로 적용한다.
같은 ID를 재import하면 다음 제출부터 새 GPU view와 pixels를 사용한다.

직접광은 기존 attenuation·RGB shadow visibility 뒤에 `albedo×Lambert + specular`를 합산한다.
반사는 Spatial과 같은 bounded GGX이며 F0는0.04, roughness 최소0.12, lobe 최대16이다.
세기 계수는 Fresnel 전체에 곱하므로0이면 정확히 반사가 없다. 에너지 보존형 전체 PBR를 보장하지 않는다.
재질 세기·roughness는 data attachment의8-bit 정밀도로 양자화하며 emission은 float16으로 보관한다.
SDR은 최종0..1 clamp, HDR은 발광1초과를 월드에 보존한 뒤 노출·톤매핑·표시 변환을 한 번 수행한다.

작성·저장 예제는 [Scene Authoring](data-scene-authoring.md#flat-sprite-emissionspecularroughness-개발-소스),
numeric ID bulk API는 [Core API](public-api/core.md#flat-sprite-표면-재질-개발-소스)를 따른다.
비활성 값·patch·Undo/Redo·JSON 복원에서 stable map 참조를 유지하며 apply/restore 전에 renderer 자산 검증이 필요하다.
활성 emission/specular 계수가 없는 packet은 기존 경로를 사용한다. `enabled:false`는 추가 pass/target이 없다.
선택한 Surface metadata는 lit profile을 요구하므로 HUD는 별도 unlit packet으로 제출한다.

활성 재질 packet은 기존 수광 scratch에 RGBA16F emission target1개(8 bytes/pixel)를 추가하고 같은 data pass의 MRT를4개로 늘린다.
반사는 기존 조도 target에 계산하므로 별도 반사 target/pass는 없다. SDR scratch28, HDR scratch32 bytes/pixel이며
HDR world8 bytes/pixel·광원 mask·전역 후처리·표시 target은 별도다. 재질 유무가 다른 여러 packet은 프레임 안에서
각 variant의 target을 재사용하고 사용하지 않은 variant는 프레임 종료에 회수한다.
같은 프레임에 기본/Surface packet이 함께 있으면 수광 scratch 합계는 SDR48/HDR56 bytes/pixel이며 HDR world는 별도다.
검증은 `pnpm smoke:flat-lit`의 Surface fixture와 [Smoke Check](../development/quality/smoke-check.md#flat-sprite-surface-재질-회귀)를 따른다.
