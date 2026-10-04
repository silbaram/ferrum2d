# Core Runtime Public API

`@ferrum2d/ferrum-web/core`는 Ferrum2D의 stable runtime entrypoint다. 게임 실행,
WebGL2 renderer, asset/audio/input, physics runtime, snapshot, buffer decoder를
사용할 때 이 subpath를 우선 import한다.

```ts
import {
  createFerrumRuntime,
  createEngine,
  createRenderer,
  WebGL2Renderer,
  AudioManager,
  GAME_STATE_CODE,
  gameStateName,
  resolvePhysicsSpec,
  bodyLocalToWorld2D,
  writePhysicsColliderWorldReferencePoints,
  captureGameStateSnapshot,
} from "@ferrum2d/ferrum-web/core";
```

## Runtime 생성

| API | 계약 |
| --- | --- |
| `createFerrumRuntime(...)` | canvas, assets, renderer, input, audio, engine loop를 묶은 browser runtime을 만든다. |
| `createEngine(...)` | Wasm `Engine`과 platform provider를 직접 연결할 때 사용한다. |
| `createRenderer(...)` | WebGL2 renderer를 생성하고 fallback 정보를 반환한다. |
| `WebGL2Renderer` | 기본 renderer 구현체다. Rust render command buffer만 소비한다. |
| `AudioManager` | browser audio channel, BGM, SFX playback을 담당한다. |

`FerrumRuntime`은 browser app에서 권장되는 상위 wrapper다. 더 세밀한 제어가 필요하면
`createEngine(...)`으로 `FerrumEngine`을 직접 만들 수 있다.
`createFerrumRuntime({ dataScene })`은 `ferrum2d.consumer.scene-authoring`
문서를 startup 단계에서 `applyDataSceneAuthoringDocument(...)`로 적용하고,
`runtime.dataScene` handle을 통해 적용 결과와 `transition(...)`/`reapply(...)` 경로를 제공한다.
handle의 `variables`는 현재 문서에 선언된 Data Scene 변수만 읽고 쓸 수 있다. `reapply(...)`는
동일 이름·동일 타입의 global 값을 유지하고 scene 값을 다음 문서의 default로 초기화한다. 검증 실패 시
현재 document/result/variable store와 인자 없는 다음 reapply의 기준 문서는 마지막 성공 상태를 유지한다.

## 입력 액션과 context

`InputManager`는 기존 `snapshot()` 외에 `keyBindings`, `actionProfile`,
`actionSnapshot()`, `setEnabled()`, `clear()`, `setVirtualInput()`을 제공한다.
`InputActionSnapshot`, `InputKeyBindings`, `VirtualInputState`, `resolveInputActionProfile`은
core/root에서 import한다. `0.1.0-beta.4`부터 제공하며 [입력 계약과 기존 게임 이행](../input-actions.md)을 참고한다.

## GPU 자원 통계

`WebGL2Renderer.resourceStats()`는 renderer가 소유한 현재 자원을 독립된
`RendererResourceStats` snapshot으로 반환한다. `render()`로 초기화되는 draw 통계와 달리
생성/교체/resize/evict/destroy 수명주기를 따른다. destroy 뒤에도 조회할 수 있으며 모두 0이다.
타 renderer의 자원과 외부에서 직접 생성·수정한 GL 자원은 집계하지 않는다.

| 필드 | 계산/범위 |
| --- | --- |
| `textureCount` | 중복 없는 texture 객체 수. 기본 placeholder, raw load, asset, 내부 후처리와 공개 RenderTexture의 color attachment 포함 |
| `bufferCount` | sprite, physics debug line, lighting shadow buffer 객체 수. 아직 storage를 할당하지 않은 객체도 포함 |
| `programCount` | 현재 소유한 linked WebGL program 수 |
| `renderTargetCount` | 내부 후처리 및 공개 RenderTexture framebuffer 수. attachment는 `textureCount`에 이미 포함 |
| `textureBytes` | 모든 texture의 `width × height × 4` 합. RGBA8/SRGB8_ALPHA8의 base mip level만 사용 |
| `bufferBytes` | `bufferData`로 할당한 GPU buffer 용량 합. 실제 frame에서 사용하지 않는 여유 용량도 포함 |
| `estimatedBytes` | `textureBytes + bufferBytes`. render target attachment를 중복 합산하지 않음 |
| `unmeasuredTextureCount` | 크기를 모르는 외부 texture나 직접 업로드한 DOM image/video source의 수. 하나라도 있으면 `textureBytes`와 `estimatedBytes`는 `undefined` |

메모리 값은 저장 형식/크기에 따른 **추정치**다. 실제 VRAM 점유, driver 정렬·캐시,
shader 실행 코드, VAO/FBO metadata, browser canvas backbuffer, CPU image/staging은 포함하지 않는다.
WebGL context loss나 외부 GL 호출로 변경된 실제 driver 상태를 탐지하는 API도 아니다.
일반 URL 로딩은 ImageBitmap 크기를 사용한다. 저수준 `createTextureFromSource`의
HTMLImageElement/video/VideoFrame은 SVG·해상도 보정·frame 표현에 따라 표시 크기와
업로드 픽셀 크기가 달라질 수 있어 추정을 생략한다.
[WebGL texture 크기 규약](https://registry.khronos.org/webgl/specs/latest/1.0/#TEXTURE_UPLOAD_SIZE)을 따른다.

```ts
const runtime = await createFerrumRuntime({
  canvas,
  debug: true,
  profiler: { budget: { maxGpuTextureCount: 64, maxGpuEstimatedBytes: 64 * 1024 * 1024 } },
});
const resources = runtime.renderer.resourceStats?.();
```

지원 여부는 실제 renderer 기준이다. WebGL2는 두 색 공간 모드에서 지원하고,
native WebGPU의 `resourceStats()`는 아직 `undefined`다. WebGL2로 fallback하면 통계를 제공한다.
`Renderer` 인터페이스의 method는 optional이므로 기존 custom renderer는 구현 없이 호환된다.
미지원 값을 0으로 대체하지 않는다. GPU 예산을 설정한 경우 누락된 측정은 `missingMetric` 위반이다.

후처리 target과 batch buffer 용량은 재사용을 위해 유지한다. 따라서 반복 씬 전환은
충분히 큰 scene/후처리/debug 경로를 한 번 실행한 **warmup 기준값**과 비교한다.
asset은 명시적으로 `evictTexture`하고 RenderTexture는 `destroyRenderTexture`로 해제한다.
raw `loadTexture(url)` 자원은 renderer destroy까지 소유한다. 등록된 여러 ID가 같은 texture를
참조하면 한 번만 집계하고 마지막 ID가 교체/evict될 때 해제한다. 다른 renderer 사이의 공유는 지원하지 않는다.

`createFerrumRuntime`은 frame의 render/post-process가 끝난 시점에 자원을 snapshot하고
DebugOverlay와 RuntimeProfiler에 같은 값을 전달한다. 이후 `onFrame`에서 직접 실행한
추가 offscreen 작업은 즉시 `resourceStats()`로 조회하거나 다음 runtime frame에서 관찰한다.
자세한 예산 필드는 [Quality API](quality.md#gpu-자원-예산)를 따른다.

## 색 공간 관리

기본 `colorManagement: "legacy"`는 기존 출력과 asset URL 문자열 계약을 유지한다.
`"linear-srgb"`는 WebGL2의 opt-in 모드이며 texture 입력, 혼합·조명·후처리 계산,
canvas 출력을 구분한다. 실행 중 모드를 바꾸려면 renderer와 asset을 새로 만든다.

```ts
import { createFerrumRuntime, srgbToLinear } from "@ferrum2d/ferrum-web/core";

const gray = srgbToLinear(128 / 255);
const runtime = await createFerrumRuntime({
  canvas,
  colorManagement: "linear-srgb",
  rendererPreference: "webgpu", // 현재는 진단 후 WebGL2로 fallback
  webgl2: { clearColor: [gray, gray, gray, 1] },
});
await runtime.engine.loadAssets({
  textures: { sprite: "/sprite.png", mask: "/mask.png", lightMap: "/linear-light.png" },
  textureOptions: {
    sprite: { colorSpace: "srgb" }, // 생략 시 기본값
    mask: { colorSpace: "none" },
    lightMap: { colorSpace: "linear" },
  },
});
```

`ColorManagementMode`, `TextureColorSpace`, `TextureLoadOptions`, `srgbToLinear`,
`linearToSrgb`는 core/root entrypoint에서 제공한다. 변환 함수는 0..1의 유한한
RGB 채널을 받으며 alpha에는 적용하지 않는다. `createRenderer`와 `WebGL2Renderer`
직접 생성에도 같은 option을 사용할 수 있다. runtime에 renderer를 직접 주입했다면
색 공간은 그 renderer를 생성한 쪽에서 설정한다.

| 입력/단계 | `linear-srgb` 계약 |
| --- | --- |
| 색상 이미지 | 기본 `srgb`. `SRGB8_ALPHA8` texture가 샘플을 linear RGB로 변환한다. |
| linear 이미지/수치 데이터 | `linear`/`none`. RGB 전송함수 변환을 생략한다. data 이미지의 브라우저 색 보정도 끈다. |
| 숫자 색상 | sprite command/tint, material, clear, light, shadow, fade/vignette, debug RGB는 **linear 값**이다. alpha는 선형 coverage 값이다. |
| 중간 target/RenderTexture | `SRGB8_ALPHA8`에 저장한다. GPU가 저장·샘플·blend 경계의 변환을 담당하므로 계산은 linear이며 어두운 색의 8-bit 정밀도를 유지한다. |
| 후처리 | linear 샘플에 적용한다. bloom threshold와 intensity도 linear 기준이다. |
| 화면 | 마지막 fullscreen pass에서 sRGB로 변환한다. 투명 canvas는 linear premultiplied RGB를 풀어서 변환한 뒤 sRGB에서 다시 premultiply한다. |

`renderer.loadTexture(id, url, { colorSpace })`, raw texture 반환형인
`renderer.loadTexture(url, { colorSpace })`, `TextureManager`에도 metadata를 전달할 수 있다.
`AssetManifest.textureOptions`의 키는 같은 manifest의 `textures`에 있어야 하며,
잘못된 값은 load/preload 전에 거절한다. 숫자 id와 기존 progress/release URL 계약은 유지한다.
preload fingerprint에는 기본값이 아닌 색 공간도 포함한다. 이 metadata는 직접
`loadAssets`/preload manifest용이며 Level Streaming의 chunk asset schema에는 추가하지 않는다.
PixelMaskTerrain의 RGB byte 색상은 sRGB, alpha byte는 coverage로 처리한다.

기존 프로젝트를 전환할 때는 이미지의 color/data 의미부터 표시하고, sRGB로 작성했던
숫자 RGB를 `srgbToLinear`로 변환한다. Data Scene hex authoring은 apply의 `colorManagement`를 명시하면 RGB를 변환하며,
runtime이 렌더러를 생성하면 최상위 또는 `webgl2`/`webgpu`의 최종 색 공간을
Data Scene 초기 적용·reapply·transition에 동일하게 전달한다. 충돌하는 Data Scene 색 공간은
적용 전에 거부한다. 외부 renderer를 주입할 때는 caller가 `dataScene.colorManagement`를
renderer와 일치시켜야 한다. 다른 CSS/hex authoring 경로는
출력한 숫자 tint가 이 계약을 따르는지 별도로 확인한다.
밝기와 bloom 수치는 linear 기준으로 다시 확인한다. `legacy`는 metadata를 받아도
GPU의 sRGB decode/출력 변환을 활성화하지 않는다.

낮은 수준 API는 매 frame `render()` → `renderCommands(...)` → `renderPostProcess()`를
호출해야 한다. 명시적 후처리가 없어도 managed 모드는 출력 변환에 fullscreen draw 1회를
사용하며 `postProcessDrawCalls`와 전체 `drawCalls`에 포함한다. 후처리가 있으면 마지막
pass에 변환을 합친다. managed 기본 출력에는 scene framebuffer 1개만 사용하고,
여러 후처리 pass를 연결할 때 scratch framebuffer 2개를 추가한다. 크기 변경 외에는 재사용한다.
현재는 8-bit LDR이며 HDR, tone mapping, Display-P3는 제공하지 않는다.

WebGPU 직접 생성은 `linear-srgb`를 canvas 취득 전에 명시적으로 거절한다.
`createRenderer`는 같은 색 공간 설정으로 WebGL2에 fallback하고 `onFallback`으로 이유를 알린다.
renderer별 option에 서로 다른 모드를 지정하면 오류다. 양쪽 renderer의 기본 legacy 동작은 유지한다.

예제는 `examples/minimal-game`의 `?colorManagement=linear-srgb`로 확인한다.
구현 추적: [#54](https://github.com/silbaram/ferrum2d/issues/54).
설계 참고: [three.js Color Management](https://threejs.org/manual/pages/color-management.html),
[WebGL sRGB 규격](https://registry.khronos.org/webgl/extensions/EXT_sRGB/).

## RenderTexture (WebGL2)

`WebGL2Renderer`는 기존 sprite command buffer를 불투명 8-bit RGBA 텍스처에 그리는
낮은 수준 API를 제공한다. 장면 전환 전 화면을 캡처하거나 기존 화면 좌표를 축소해서
다시 표시할 때 사용한다. `RenderTexture`, `RenderTextureOptions`,
`RenderToTextureOptions` 타입은 `@ferrum2d/ferrum-web/core`에서 import한다.

| Method | 계약 |
| --- | --- |
| `createRenderTexture(textureId, { width, height, filter? })` | 물리 texel 크기로 할당한다. 크기는 양의 정수이고 `MAX_TEXTURE_SIZE` 이하여야 한다. 필터는 `nearest` 기본값 또는 `linear`다. |
| `resizeRenderTexture(target, width, height)` | 같은 크기는 재할당하지 않는다. 크기가 바뀌면 픽셀을 버리고 다시 그려야 한다. 할당 실패 시 기존 이미지와 크기를 유지한다. |
| `renderToTexture(target, commands, options?)` | 현재 sprite material/screen offset으로 sprite만 그린다. 기존 main framebuffer/viewport/clear color/color mask/scissor 상태를 복구한다. 반환값은 해당 pass의 `RendererStats`다. |
| `destroyRenderTexture(target)` | 자원을 해제하고 id를 다시 사용할 수 있게 한다. 동일 handle의 중복 해제는 `false`를 반환한다. |

handle은 renderer 소유의 readonly 객체이며 `textureId`, 현재 `width`/`height`,
`uv: [0, 0, 1, 1]`만 제공한다. raw GPU 객체는 노출하지 않는다. 일반 asset과 같은
좌상단 기준 UV를 사용하며, renderer가 target texture를 읽는 batch에서만 V 방향을
보정한다. Data Scene `sprite.frame`과 Rust sprite의 기존 UV 검증을 그대로 통과하며,
부분 영역 UV도 같은 규칙을 따른다. 같은 renderer가 소유한 texture id로 기존 sprite
batch가 결과를 읽는다. caller가 UV를 다시 뒤집으면 안 된다.

```ts
import { WebGL2Renderer } from "@ferrum2d/ferrum-web/core";
import type { RenderCommandBufferView } from "@ferrum2d/ferrum-web/core";

const renderer = new WebGL2Renderer(canvas);
// asset manifest/TextureRegistry와 겹치지 않는 id를 호출자가 배정한다.
const preview = renderer.createRenderTexture(100, { width: 256, height: 144 });

function renderFrame(source: RenderCommandBufferView, main: RenderCommandBufferView) {
  renderer.render();
  renderer.renderToTexture(preview, source, {
    viewport: { width: 1280, height: 720 },
    clearColor: [0.08, 0.1, 0.15],
  });
  // main의 표시용 sprite는 preview.textureId와 preview.uv를 사용한다.
  // source에는 preview 자체를 읽는 sprite가 포함되면 안 된다.
  renderer.renderCommands(main);
  renderer.renderPostProcess();
  return renderer.stats();
}

// 더 이상 사용하지 않을 때 호출한다. renderer.destroy()도 남은 target을 모두 해제한다.
renderer.destroyRenderTexture(preview);
```

`options.viewport`는 **입력 command의 논리 화면 크기**이며 생략하면 현재 canvas의
논리 viewport를 사용한다. 실제 target texel 크기와 분리하므로 DPR 1/2에서도 같은
영역을 캡처한다. `clearColor`는 `[r, g, b]`의 0..1 값이며 기본값은 검정이다.
target alpha는 항상 1이다. 반투명 sprite도 배경과 합성된 불투명 이미지가 된다.
생성/resize 직후에는 먼저 `renderToTexture`로 초기화한 다음 sampling한다.
저장 형식은 legacy 모드의 `RGBA8`, managed 모드의 `SRGB8_ALPHA8`이다.
managed target은 sampling 때 GPU가 linear RGB로 복원하므로 caller가 색 공간을 재변환하지 않는다.

id는 기존 f32 command ABI에서 정확하게 표현되는 `1..16777215` 정수로 제한한다.
이미 로드했거나 비동기 로드 중인 asset id, 다른 target id와의 충돌을 거절한다.
반대로 target id에 asset을 로드하거나 `evictTexture`/PixelMaskTerrain API로 변경할 수 없다.
다른 renderer의 handle, 해제한 handle, 잘못된 크기/viewport/clear color/buffer layout,
누락된 입력 texture 및 출력 texture를 동시에 읽는 feedback은 오류다.
feedback/누락 입력 검증은 clear 전에 수행하므로 기존 target 이미지를 보존한다.

`render()`는 main/offscreen 통계를 초기화한다. 그 뒤 실행한 `renderToTexture`의
draw/batch/sprite/command/texture 비용은 main 렌더 통계에 더해진다. `stats()` 및
`renderCommands`/`renderPostProcess` 반환값에 합계가 반영되므로 추가 pass 비용이 숨지 않는다.
`renderToTexture` 자체의 반환값은 해당 pass만 나타낸다. 일반 sprite batch와 동일하게
GPU buffer를 재사용하며 target 자원은 생성/resize 때만 할당한다.

첫 버전은 WebGL2 전용이다. `createRenderer`의 결과는 `instanceof WebGL2Renderer`로
확인하거나 필요한 게임에서 `preferred: "webgl2"`를 지정한다. `createFerrumRuntime`에
자동 캡처 option을 추가하지 않으며 낮은 수준 frame integration에서 명시적으로 호출한다.
offscreen pass에는 lighting/debug line/post-process를 적용하지 않지만, main framebuffer의
후처리 체인과 함께 사용할 수 있다. 현재 Rust command는 기존 카메라에서 컬링된 화면 좌표이므로
이 기능만으로 독립 카메라나 월드 전체 미니맵을 생성하지 않는다. 독립 카메라/layer 선택,
투명 target 합성, offscreen 후처리, WebGPU 지원은 후속 범위다.

구현 추적: [#53](https://github.com/silbaram/ferrum2d/issues/53).

## FerrumEngine 그룹

`FerrumEngine`은 여러 facade interface의 합성이다.

| 그룹 | 주요 method |
| --- | --- |
| Lifecycle | `start`, `pause`, `resume`, `stop`, `destroy`, `time`, `version` |
| Scene | `resetGame`, `setViewportSize`, `setGameSpec`, `useDataScene`, `dataSceneState`, `pauseDataScene`, `resumeDataScene`, `completeDataScene`, `useBreakoutGame`, `usePlatformerGame`, `builtIn*Handle`, `setBuiltInSceneEntityPosition` |
| Asset | `loadAssets`, `releaseAssets`, `textureId`, `soundId`, `setTextureIds`, `setSoundIds` |
| Bitmap text | `loadBitmapFont`, `registerBitmapFont`, `setWorldText`, `removeWorldText`, `worldTextGlyphCount` |
| Particle | `setParticlePreset`, `spawnParticleBurst`, `clearParticles`, `particleCount` |
| Physics runtime | `configurePhysicsRuntime`, `configureFixedTimestep`, `stepRigidBodies` |
| Physics body/joint | `spawnRigidBody`, `despawnPhysicsEntity`, `addPhysicsBodyCollider`, `spawnPhysicsJoint`, `clearPhysicsJoint` |
| Physics query | body query, raycast, shape cast, tile obstacle query |
| Gameplay authoring | 낮은 빈도 behavior command apply. 세부는 [Authoring](authoring.md)을 본다. |
| Input action | `setInputActionBinding`, `clearInputActionBindings`, `resetInputActionBindings` |

scene 전체를 다시 적용하는 method와 부분 변경 method를 구분한다.

| Method | 상태 영향 |
| --- | --- |
| `setGameSpec(...)` | Shooter scene config를 다시 적용한다. 진행 중 enemy/wave 상태가 초기화될 수 있다. |
| `setShooterAtlasFrame(...)` | prefab의 texture/frame만 교체한다. world config와 wave는 다시 적용하지 않는다. |
| tilemap edit helper | 낮은 빈도 runtime tile metadata 변경용이다. 대량 편집은 spec 단계에서 처리한다. |
| `builtInShooterPlayerHandle()`, `builtInPlatformerPlayerHandle()`, `builtInBreakoutPaddleHandle()`, `builtInBreakoutBallHandle()` | 현재 활성 built-in scene의 generation-safe authoring handle만 반환한다. 다른 scene에서는 `undefined`다. |
| `setBuiltInSceneEntityPosition(...)` | 현재 활성 built-in scene이 소유한 generation-safe player/paddle/ball entity의 x/y만 낮은 빈도로 바꾼다. Scene Authoring adapter용이며 frame별 이동 API가 아니다. |

`FerrumRuntimeOptions.dataScene`은 built-in starter scene을 거치지 않는 generic
Data Scene boot path다. 옵션이 문서 자체이면 기본 apply option을 쓰고,
`{ document, ...applyOptions }` 형태이면 texture resolver, binding id,
instance handle registry 같은 `applyDataSceneAuthoringDocument(...)` option을 함께
전달한다. 이 경로는 낮은 빈도 scene load/apply 단계에서만 실행되며 frame마다
TypeScript callback을 만들지 않는다.

## Data Scene Flow

`runtime.dataScene.transition(nextDocument, options?)`은 문서 A에서 B로 이동하는 명시적 scene/level
전환이고, `reapply(document?, options?)`는 현재 문서를 다시 적용하는 reload다. `transition(...)`과 기본
`reapply(...)`는 validation 성공 뒤 Rust Data Scene reset boundary를 통과하며 빈 instance 문서도 실제
전환으로 처리한다. 기존 low-level 호환용 `reapply(..., { activateDataScene: false })`만 caller-prepared
Data Scene에 reset 없이 적용되며 `transition(...)`은 activation opt-out을 허용하지 않는다.

| API | 계약 |
| --- | --- |
| `runtime.dataScene.state()` | `playing`, `paused`, `levelComplete` 또는 Data Scene 외부의 `undefined`를 반환한다. |
| `pause()` / `resume()` | `playing ↔ paused`의 허용된 방향에서만 `true`를 반환한다. |
| `complete()` | `playing` 또는 `paused`를 `levelComplete`로 바꾼다. |
| `transition(document)` | 새 문서를 적용하고 lifecycle을 `playing`으로 초기화한다. |
| `GAME_STATE_CODE`, `gameStateName(...)` | stable numeric ABI `title=0`, `playing=1`, `gameOver=2`, `paused=3`, `levelComplete=4`를 해석한다. |

`paused`와 `levelComplete`에서는 render는 계속되지만 Rust tween, rigid physics, gameplay timer/FSM,
particle simulation은 진행하지 않는다. 전환 시 같은 이름·타입의 `global` 변수만 다음 문서에 생존하고
`scene` 변수는 default로 돌아간다. World/tilemap/particle/tween, physics history/fixed-step/input latch,
frame event/render/audio buffer, pending spawn/deferred despawn queue는 모두 정리된다.

## 월드 공간 비트맵 텍스트

`FerrumBitmapTextApi`는 시스템 폰트/Canvas `fillText` 대신 기존 sprite renderer를
사용한다. `loadBitmapFont(fontId, policy)`는 `BitmapFontPolicySpec.image` texture와
`data` atlas JSON을 기존 `AssetHost`로 로드하고 Rust cache에 등록한다. `data`는 기존
URL string을 그대로 지원하며, `BitmapFontAtlasSpec` inline object도 선택할 수 있다.
정책의 optional `lineHeight`는 atlas `lineHeight`를 override하므로 기존 URL 기반
정책과 하위 호환된다.

```ts
const atlas = {
  format: "ferrum-bitmap-font",
  version: 1,
  lineHeight: 12,
  glyphs: {
    A: {
      uv: { u0: 0, v0: 0, u1: 0.5, v1: 1 },
      size: { width: 8, height: 10 },
      advance: 9,
    },
  },
} as const;

engine.registerBitmapFont(1, engine.textureId("font-atlas"), atlas);
engine.setWorldText(10, {
  fontId: 1,
  text: "AAA",
  x: 320,
  y: 180,
  alignment: "center",
  color: [1, 0.85, 0.25, 1],
  scale: 2,
  renderLayer: 20,
});
```

`WorldTextSpec`의 `alignment` 기본값은 `left`, `scale`은 `1`, `color`는 흰색,
`maxWidth`/`renderLayer`/`floorId`/`elevation`은 `0`이다. `maxWidth > 0`이면 glyph
advance 기준으로 줄을 나누고 명시적 `\n`도 지원한다. `anchor`에 generation을 포함한
entity handle을 주면 `x/y`가 local offset이 되어 Rust transform을 따라간다. 따라서
오브젝트 label을 위해 frame마다 위치나 문자열을 다시 전달할 필요가 없다.
`x/y`는 첫 줄의 layout origin이며 `center`/`right` 정렬은 각 줄을 이 origin 기준으로
왼쪽으로 이동한다.

같은 `textId`와 같은 normalized spec을 다시 설정하면 TypeScript facade가 Wasm 호출을
생략한다. 문자열 내용은 같고 좌표·색상 같은 속성만 바뀌면 숫자 전용 update 경로를
사용한다. 좌표·render/HD-2D metadata·anchor만 바뀌는 update는 glyph command도 다시
만들지 않는다. 변경된 문자열만 Wasm 문자열 경계를 지나 Rust에서 다시 glyph command로
전개되며, 변경 없는 frame은 cache를 재사용해 camera 변환·glyph 단위 culling·기존
sprite sort만 수행한다.
텍스트 하나와 font 하나는 각각 최대 4,096 glyph, font는 최대 16,384 kerning pair를
허용한다. 이 기능은 월드 공간 표현용이며 화면 고정 HUD/dialogue DOM overlay를
대체하지 않는다.

폰트와 텍스트 등록은 engine 수명에 속하며 `resetGame()`이나 scene 전환이 자동으로
제거하지 않는다. scene 단위로 소유하는 label은 teardown에서 `removeWorldText(...)`나
`clearWorldTexts()`를 호출한다. entity anchor는 해당 handle이 현재 world에서 resolve될
때만 render command를 만든다.

## FrameState

`FrameState`는 한 frame에서 관측된 runtime output이다. render/audio/collision/gameplay,
effect, physics debug, profiler용 snapshot을 포함할 수 있다.
`gameState`는 `GameStateCode`이며 기본 debug label은 `Title`, `Playing`, `GameOver`, `Paused`,
`LevelComplete`를 사용한다. 알 수 없는 telemetry code는 임의 숫자로 통과시키지 않고 frame 조립 시 거절한다.

Typed-array view는 해당 frame에서 동기 소비한다. frame 밖에 보관하거나 `await` 이후
읽어야 하면 먼저 복사한다.

| 옵션 | 기본값 | 영향 |
| --- | --- | --- |
| `includeAudioEvents` | `true` | decoded audio event 배열 포함 여부 |
| `includeCollisionEvents` | `false` | collision lifecycle tracking과 decoded collision event 포함 여부 |
| `includeGameplayEvents` | `true` | gameplay event buffer와 decoded event 포함 여부 |
| `includeEffectEvents` | `true` | presentation effect event buffer와 decoded event 포함 여부 |
| `enablePhysicsDebugLines` | `false` | Rust physics debug line buffer 생성 여부 |
| `includePhysicsDebugLines` | `false` | decoded physics debug line 배열 포함 여부 |

`FrameState`는 game simulation의 source of truth가 아니다. 장기 상태는 Rust core와
snapshot/replay API를 기준으로 관리한다.

`createFerrumRuntime(...)`의 `physicsDebugLineComposer`는 `physicsDebugLines`가 활성화된
frame에서 Rust `PhysicsDebugLineBufferView`를 받아 renderer에 넘길 최종 buffer를 반환한다.
`DebugGizmoLineBufferWriter`로 원본 buffer를 append한 뒤 line/polyline/arrow/circle을 추가하면
WebGL2/WebGPU가 기존 8-float debug line ABI를 그대로 소비한다. 옵션이 비활성화되면 composer도
호출되지 않는다. composer와 반환 buffer는 frame 안에서 동기 처리하고 보관하지 않는다.

## Physics Runtime

Core subpath는 Physics Spec resolver와 imperative Physics API를 함께 노출한다.

| API | 계약 |
| --- | --- |
| `resolvePhysicsSpec(...)` | JSON authoring 입력을 resolved physics spec으로 정규화한다. |
| `configurePhysicsRuntime(...)` | resolved spec을 runtime physics 설정에 적용한다. |
| `spawnRigidBody(...)` | 낮은 빈도 rigid body 생성용 imperative API다. |
| `despawnPhysicsEntity(...)` | body와 그 body를 endpoint로 참조하는 모든 joint를 함께 제거하고 기존 joint handle을 무효화한다. |
| `stepRigidBodies(...)` | manual stepping 또는 테스트 harness에서 사용한다. |
| body/tile query | nearest, overlap, raycast, segment cast, shape cast query를 제공한다. |

Physics authoring 세부 계약은 [Physics Spec](../physics-spec.md)을 기준으로 한다.

`spawnPhysicsJoint(...)`의 `distance`/`rope`/`spring` 옵션은 `localAnchorAX/Y`,
`localAnchorBX/Y`를 선택값으로 받을 수 있다. 생략하면 각 body center(`0, 0`)에
연결되며, off-center anchor는 Rust solver에서 회전 관성까지 반영된다.
`pulley` 옵션의 `slack`은 기본 `false`이고, `true`이면 rest length 이하에서는
느슨한 줄로 취급해 correction을 적용하지 않는다.
`revolute` 옵션의 `continuousLimit`은 기본 `false`이고, `true`이면
`lowerAngle`/`upperAngle`을 정규화하지 않은 누적 상대 각도 기준으로 적용한다.

`setPhysicsBodyMassProperties(...)`의 `mass`/`inertia`는 양수·finite이고 Rust
`f32`에서 역수도 finite여야 한다. TypeScript API는 0·음수·NaN·Infinity를
Wasm 호출 전에 예외로 거부한다. TypeScript 검증을 통과했더라도 Rust `f32`
변환 결과가 양수·finite가 아니거나 역수가 finite가 아니면 body 상태를 변경하지
않고 `false`를 반환한다. bulk body snapshot restore도 dynamic body의
mass/inertia에 같은 Rust 경계를 적용하고, 위반 시 `false`를 반환한다.

## 2D 기하 변환

Core subpath는 엔진 상태에 접근하지 않는 순수 기하 변환 helper를 제공한다.

| API | 계약 |
| --- | --- |
| `rotatePoint2D(...)` | 원점 기준으로 점을 회전한다. |
| `transformPoint2D(...)`, `inverseTransformPoint2D(...)` | scale → rotation → translation 합성과 그 역변환을 수행한다. |
| `bodyLocalToWorld2D(...)`, `bodyWorldToLocal2D(...)` | body 원점 기준 local/world 점을 상호 변환한다. |
| `physicsColliderWorldCenter2D(...)` | resolved AABB/box, circle, capsule, oriented box, convex polygon의 Rust 기준 world center를 계산한다. |
| `physicsColliderWorldReferencePointCount(...)` | caller buffer에 필요한 point 개수를 반환한다. |
| `writePhysicsColliderWorldReferencePoints(...)` | `[x0, y0, ...]` numeric buffer에 collider reference point를 기록한다. |

```ts
import {
  bodyLocalToWorld2D,
  physicsColliderWorldReferencePointCount,
  writePhysicsColliderWorldReferencePoints,
  type MutablePoint2D,
  type PhysicsGeometryCollider2D,
} from "@ferrum2d/ferrum-web/core";

const body = { x: 320, y: 180, rotationRadians: Math.PI / 2 };
const scratch: MutablePoint2D = { x: 0, y: 0 };
bodyLocalToWorld2D({ x: 16, y: 0 }, body, scratch);

const collider: PhysicsGeometryCollider2D = {
  shape: "orientedBox",
  halfWidth: 16,
  halfHeight: 8,
  rotationRadians: 0,
  offsetX: 0,
  offsetY: 0,
  trigger: false,
  enabled: true,
};
const points = new Float32Array(
  physicsColliderWorldReferencePointCount(collider) * 2,
);
writePhysicsColliderWorldReferencePoints(collider, body, points);
```

단일 점 helper에 `out`을 넘기면 객체를 새로 만들지 않는다. collider helper는 caller가
할당·재사용하는 buffer에 기록하며 point 객체 배열을 만들지 않는다. AABB/box는 world
좌상단부터 시계 방향인 네 꼭짓점, oriented box는 local 좌상단부터 시계 방향인 꼭짓점을
world로 변환한 순서, circle은 중심 한 점, capsule은 start/end, convex polygon은 authored
vertex 순서를 반환한다. 좌표축, anchor, 회전 및 collider별 offset 규칙은
[좌표계와 2D 기하 변환](../coordinate-system.md)을 기준으로 한다.

## Snapshot And Buffer Decoder

| API | 계약 |
| --- | --- |
| `captureGameStateSnapshot(...)` | game state를 저장 가능한 snapshot으로 캡처한다. |
| `restoreGameStateSnapshot(...)` | snapshot을 runtime에 복원한다. |
| `capturePhysicsBodyStateBuffer(...)` | physics body state bulk buffer snapshot을 만든다. |
| `decodeRenderCommands(...)` | Rust render command buffer를 renderer 입력으로 decode한다. |
| `decodeGameplayEvents(...)` | gameplay event buffer를 telemetry object로 decode한다. |
| `decodeEffectEvents(...)` | presentation-only effect detail buffer를 decode한다. |
| `createRenderCommandAccessor()` | Rust `SpriteRenderCommand` layout을 읽어 재사용 가능한 named-field accessor를 만든다. |
| `createBuiltInShooterStateAccessor()` | Built-in Shooter snapshot layout을 읽어 재사용 가능한 named-field accessor를 만든다. |

저수준 `createEngine(...)` 경로에서 raw offset을 직접 계산하지 않는다. accessor는
engine 생성 시 Rust가 내보낸 field enum/offset으로 초기화되며, layout stride가
일치하지 않으면 ABI mismatch로 즉시 실패한다.

```ts
const renderAccessor = engine.createRenderCommandAccessor();

const onFrame = (frame) => {
  renderAccessor.bind(frame.renderCommandBuffer);
  for (let index = 0; index < frame.renderCommandBuffer.commandCount; index += 1) {
    renderAccessor.select(index);
    drawDebugLabel(renderAccessor.x, renderAccessor.y, renderAccessor.textureId);
  }
};
```

`RenderCommandAccessor.bind(...)`와 `select(...)`는 내부 buffer reference와 index만
갱신한다. field getter는 scalar를 직접 반환하므로 accessor 자체가 frame마다 객체나
배열을 만들지 않는다. Wasm memory view는 기존 계약대로 현재 frame 안에서만 소비한다.
`bind(...)` 검증이 실패하면 이전 buffer와 선택을 지우고, `select(...)`가 실패하면
이전 선택을 지운다. 따라서 오류 이후 getter가 오래된 frame을 계속 읽지 않는다.

Shooter snapshot은 `bind(snapshot)` 후 `select(...)` 또는 `selectFirst(...)`로 읽는다.
smoke fixture처럼 snapshot copy를 수정해야 하는 낮은 빈도 경로는
`bindMutable(...)`을 사용한다. `gameState`, `enemySpawnTimer`, `kind`, `x`, `health`,
primary action, dash, melee 같은 명명 필드를 제공하며, raw header/entity index에
의존하지 않는다. `bind(...)`으로 연결한 read-only snapshot에 쓰려고 하면 실패한다.
bind/select 검증 실패는 이전 snapshot 참조, mutable 쓰기 권한, entity 선택을 함께
해제하므로 accessor를 다시 bind하기 전에는 읽거나 쓸 수 없다.

`captureGameStateSnapshot(..., { includeDataSceneState: true })`는 optional
`dataSceneAuthoringDocument`를 함께 받을 수 있다. 이 값은 JSON-compatible
`DataSceneStateSnapshot.authoringDocument`로 hash에 포함되며,
`restoreGameStateSnapshot(...)`은 기본적으로 이를 `applyDataSceneAuthoringDocument(...)`로
다시 적용한 뒤 `applyDataSceneCustomState` callback을 호출한다. 문서가 없거나
`restoreDataSceneAuthoringDocument: false`이면 restore는 기존처럼 빈 Data Scene mode만
활성화한다.

선언 변수가 있는 Data Scene을 `includeDataSceneState: true`로 캡처하면 global 값은
`snapshot.custom[DATA_SCENE_VARIABLES_SNAPSHOT_KEY]`, scene 값은
`snapshot.dataScene.custom[DATA_SCENE_VARIABLES_SNAPSHOT_KEY]`에 기록된다. 일반/built-in snapshot에는
이 저장소를 자동 주입하지 않는다. restore는 적용되거나 이미 연결된 authoring 선언과 두 스코프의
값을 runtime activation 전에 대조하고, reserved payload를 제외한 consumer custom state만 callback에
전달한다. 결과의
`dataSceneVariables`/`globalVariablesApplied`/`sceneVariablesApplied`로 적용 여부를 보고한다.

현재 `GameStateSnapshot.version`과 `DataSceneStateSnapshot.version`은 `2`다. Data Scene lifecycle state는
snapshot/replay hash에 포함되며 restore는 변수 복원 뒤 lifecycle을 복원한 다음 custom callback을 호출한다.
따라서 `paused`와 `levelComplete` 저장은 fresh runtime에서도 같은 상태로 복원된다. version `1`은
validation에서 거절하므로 저장 데이터가 필요한 consumer는 version `2` 재캡처 또는 명시적 migration이
필요하다. Built-in Shooter state ABI는 lifecycle code 계약 변경과 함께 version `18`이다. Built-in snapshot은
기존 `title|playing|gameOver`만 허용하고 Data Scene 전용 `paused|levelComplete` code는 복원에서 거절한다.
`includeDataSceneState: true` capture는 active Data Scene에서만 허용되며 restore authoring option의
`activateDataScene: false`는 mutation 전에 거절한다.

일반 consumer는 decoder를 직접 호출하기보다 `FerrumEngine`과 `FrameState`를 우선
사용한다. decoder는 custom renderer, replay, smoke, diagnostic adapter에서 사용한다.


## KTX2 / Basis 압축 텍스처

`TextureLoadOptions.ktx2Url`로 압축 후보 URL을 지정한다. 원래 URL은 필수 이미지 fallback이다.
`AssetManifest.textureOptions`에서도 같은 옵션을 사용할 수 있다.

```ts
await renderer.loadTexture(1, "/assets/atlas.png", {
  ktx2Url: "/assets/atlas.ktx2",
  colorSpace: "srgb",
  signal: abortController.signal,
});
```

WebGL2는 ASTC 4×4 → BC7 → ETC2 RGBA 순으로 실제 지원하는 형식을 선택한다.
ETC1S/UASTC LDR, 단일 2D 이미지, right/down 방향, 4의 배수인 4..8192 크기를 지원한다.
장치 최대 크기가 더 작으면 그 제한을 적용한다. 입력은 64 MiB 이하, mip은 level 0만 업로드한다.
array/cube/HDR/premultiplied 입력과 색 공간 metadata 불일치는 이미지로 fallback한다.
legacy 모드의 alpha 입력도 기존 이미지 혼합 결과를 유지하도록 fallback한다.
`linear-srgb`에서는 straight alpha 압축 텍스처를 지원한다. Native WebGPU는 이미지 URL을 사용한다.
GPU 통계에는 RGBA 환산값 대신 실제 block byte 크기를 기록한다.

기본 decoder는 첫 압축 요청에서만 생성되는 module Worker다. `WebGL2Renderer`의
`ktx2: false`로 끄거나 `ktx2: createKtx2Transcoder(...)`로 공유할 수 있다.
주입한 `Ktx2Transcoder`는 caller가 `destroy()`한다. 내부 생성 decoder는 renderer가 해제한다.
`onKtx2Fallback({ url, ktx2Url, reason })`은 지원 실패, fetch/변환/업로드 실패를 알린다.
`signal` 취소, 같은 ID의 새 load, evict, destroy는 대기 작업을 취소하고 늦은 GPU 업로드를 막는다.
취소는 `AbortError`로 reject하며 fallback이나 placeholder를 만들지 않는다.

| API | 계약 |
| --- | --- |
| `createKtx2Transcoder(options?)` | lazy Worker decoder 생성. 입력 bytes를 복사해서 전송하므로 caller buffer를 detach하지 않는다. |
| `Ktx2Transcoder` | `transcode(data, options)`와 idempotent `destroy()` 계약. |
| `Ktx2TranscoderOptions` | `workerUrl`, `transcoderJsUrl`, `transcoderWasmUrl`로 배포 URL 지정 가능. |
| `Ktx2TranscodeOptions` | `format`, `srgb`, `allowAlpha`, `maxDimension`, optional `signal`. |
| `Ktx2TranscodedImage` | `width`, `height`, `format`, GPU block `data`. |
| `Ktx2TextureFormat` | `astc-4x4`, `bc7`, `etc2-rgba`. |

Worker당 대기 요청 32개, 요청당 timeout 30초다. 마지막 요청 취소 시 Worker를 종료한다.
[압축 텍스처 측정·배포 정책](../../development/quality/compressed-textures.md)을 함께 참고한다.


## 선택적 셰이더 준비

`new WebGL2Renderer(canvas, options)`는 기존 동기 생성 계약을 유지한다.
`await WebGL2Renderer.create(canvas, options, preparation)`는 선택적 async 생성 경로다.
`createRenderer(canvas, { shaderPreparation })` 및 `createFerrumRuntime({ shaderPreparation })`도
같은 준비 경로를 사용한다.
Native WebGPU 성공 경로에는 WebGL2 준비 callback이 없으며 WebGL2 fallback에는 적용된다.

```ts
const loading = new LoadingOverlay(document.body);
const abort = new AbortController();
try {
  const runtime = await createFerrumRuntime({
    canvas,
    shaderPreparation: {
      signal: abort.signal,
      onProgress: (progress) => loading.updateShaderPreparation(progress),
    },
  });
  loading.hide();
  runtime.start();
} catch (error) {
  loading.fail(error);
}
```

`ShaderPreparationOptions`는 `signal`, `timeoutMs`(기본 30,000, 0 초과 120,000 이하),
`onProgress`를 받는다. 준비 중에는 renderer 객체를 반환하지 않는다. 화면 이탈이나 요청 취소 시
AbortController를 abort하면 `AbortError`로 종료하고 중간 Shader/Program을 해제한다.
완료 후에는 기존 `renderer.destroy()`로 해제한다. callback 오류도 생성 실패로 처리한다.

`ShaderPreparationProgress`는 `phase: compiling | ready`, `completedPrograms`, `totalPrograms`,
`parallelCompile`, `elapsedMs`를 제공한다. 현재 sprite/debug/lighting/shadow/fullscreen 총 5개다.
`ready`는 프로그램뿐 아니라 renderer 구성 완료를 뜻하며 게임 에셋이나 첫 GPU frame의 완료를 뜻하지 않는다.
`LoadingOverlay.updateShaderPreparation`는 진행률과 준비 상태를 표시하되 전체 로딩 완료를 선언하지 않는다.
전체 runtime/에셋 준비 뒤 caller가 hide/complete한다.

지원 기기는 `KHR_parallel_shader_compile` 완료 상태를 poll한 뒤 link 상태와 uniform을 조회한다.
미지원 기기는 프로그램 사이에 event loop를 양보하지만 link 상태 조회가 동기적으로 멈출 수 있다.
shader compile/link driver 호출 자체나 첫 draw의 지연까지 제거하지 않는다.
context loss, timeout, 컴파일/링크 실패는 reject하며 context 자동 복구는 제공하지 않는다.
[측정과 검증 범위](../../development/quality/shader-preparation.md)를 참고한다.


## Data Scene native runtime

`createDataSceneView`, `DataSceneView`, `DataSceneViewOptions`, `DataSceneViewSnapshot`,
`DataSceneCameraOptions`는 `/core`에서 제공한다. `CameraRigController`, `resolveCameraRigSpec`,
`clampCameraToBounds`도 `/core`에서 사용할 수 있다. `/authoring`의 `DataSceneBodySpec`은 optional
static/kinematic body와 sprite의 같은 핸들 연결을 정의한다.
[Data Scene native runtime](../data-scene-native-runtime.md)에서 정렬·원점·색 공간·카메라·좌표·조명 계약을 확인한다.

## Data Scene 표현 확장 (#68~#70, 0.1.0-beta.3)

`/core`, `/authoring`은 `DataSceneSpriteAnimationSetSpec`, `DataSceneSpriteAnimationUpdate`,
`DataSceneSpriteAnimationState`, `resolveDataSceneSpriteAnimationSet`, `DirectionalLight2D`,
`resolveDirectionalLight2D`, `DataSceneGroundShadowSpec`, `DataSceneGroundShadowStats`를 제공한다.
`FerrumEngine.configureDataSceneSpriteAnimation`, `updateDataSceneSpriteAnimations`,
`dataSceneSpriteAnimationState`, `setDataSceneGroundYScale`, `cameraGroundYScale`, `setDataSceneSun`,
`dataSceneGroundShadowStats`와 `view.setGroundYScale/setSun`의 사용법은
[애니메이션·투영·태양 그림자](../data-scene-presentation.md)에 정리했다.

#73 B2의 `DataSceneGroundShadowSpec.shape: "alpha"`는 기존 texture/frame/flip의 alpha를
지면에 투영한다. 기존 ellipse/box는 유지한다. render buffer의 `groundShadowProjection` 세 f32와
flag 32를 함께 소비하며 15-float command layout은 유지한다. beta.4 배포본에는 없는 후속 변경이다.
