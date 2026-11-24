# 런타임 시작·화면 맞춤 개선

상태: 사용자 승인·결정 D1~D4 확정(2026-11-24). 단계(R1→F1→R2a→F2→R2b→R3)마다 Codex가 구현하고 통합 담당이 검증한다.
- R1 완료(`77f94fa`): 통합 검증에서 SDK 테스트 2,053개, 에셋 로딩 smoke, Data Scene smoke의 R1 시작 사례 통과.
- [선행 수정 F1](#선행-수정-f1-data-scene-smoke의-hd-2d-이동-실패) 완료(`e09767d`): Data Scene smoke 전체 통과.
- R2a 완료(`fd200dd`, 2026-11-25): 통합 검증에서 SDK 테스트 2,061개, Data Scene smoke 전체(화면 맞춤 사례 포함), 예제 사이트 smoke 통과.
- 다음은 [선행 수정 F2](#선행-수정-f2-픽셀-퍼펙트-smoke의-shooter-스냅샷-실패), 그다음 R2b다.

우선순위: 엔진 개선이 1순위다. [예제 사이트](example-site-rebuild-plan.md) 작업은 이 계획의 R1~R3을 마친 뒤
새 API로 예제를 옮기는 일부터 다시 시작한다.

## 배경: 예제를 만들며 드러난 문제

예제 사이트의 예제 3개(스프라이트·충돌과 트리거·벽돌 깨기)는 시작 코드가 각 60줄 남짓이고 거의 같다.
대부분은 게임 규칙이 아니라 엔진이 맡아야 할 시작·화면·정리 일이다.

| # | 문제 | 지금 앱이 하는 일 |
| --- | --- | --- |
| 1 | 그림 이름을 쓰는 Data Scene은 적용 시점에 텍스처가 등록돼 있어야 한다(`TextureRegistry.textureId`가 없으면 오류). 그런데 `createFerrumRuntime`이 렌더러를 만들면 씬 적용 전에 그림을 읽을 방법이 없다. | `createRenderer` → `new AssetLoader(renderer).loadAssets` → `createFerrumRuntime({ renderer, assetHost })` 3단계를 직접 하고 렌더러 수명도 직접 관리한다. |
| 2 | 시작을 취소할 수 없다. | 화면을 떠나도 시작이 끝나길 기다렸다가 정리한다. 앱이 먼저 렌더러를 정리하면, 시작 중 붙은 크기 감시가 정리된 렌더러에 `resize()`를 부를 수 있다(예제 사이트 계획의 기존 후보). |
| 3 | WebGPU를 요청했다가 WebGL2로 대체됐는지 알 공식 방법이 없다. `createRenderer`의 `onFallback`도 런타임에서 넘길 수 없다. | `"gpuDevice" in renderer`로 추정한다. |
| 4 | 고정 크기 월드(예: 640 × 384)를 크기가 바뀌는 캔버스에 비율 유지로 맞추는 기능이 없다. `pixelPerfect`는 가상 해상도·정수 배율·여백으로 픽셀아트용이다. | 예제마다 `createDataSceneView` + `ResizeObserver` + `setZoom(min(w/640, h/384))`, 씬을 다시 적용할 때마다 view를 다시 만든다. |
| 5 | `renderer.destroy()`는 GPU 자원은 풀지만 WebGL 컨텍스트를 남긴다(같은 캔버스 재사용용). 런타임을 만들고 없애는 SPA는 컨텍스트가 쌓여 브라우저 한도(보통 16)에 닿는다. | 예제 사이트 틀이 `WEBGL_lose_context`로 직접 놓아준다. |

## 목표

완료 뒤 예제의 시작 코드는 아래 정도가 된다. 옵션을 쓰지 않는 기존 호출은 동작이 완전히 같아야 한다.

```ts
const runtime = await createFerrumRuntime({
  canvas,
  signal,                                   // R1: cancels startup
  rendererPreference: "webgpu",
  onRendererFallback: info => console.info(info.reason),
  assets: { textures: { robot: url("robot.png"), panel: url("panel.png") } }, // R1: before the scene applies
  dataScene: document,                      // R2: document.display.fit = { width: 640, height: 384 }
  releaseCanvasContext: true,               // R3: the canvas belongs to this runtime only
  onFrame,
});
runtime.rendererBackend;                    // R1: "webgl2" | "webgpu" | "custom"
runtime.dataScene?.view.pointerToWorld({ x: event.clientX, y: event.clientY }); // R2: survives reapply
```

범위 밖: Rust/Wasm 변경, 새 프로덕션 의존성, 예제 사이트 코드 변경(이 계획 완료 뒤 별도 단계), 공간(spatial) 화면 맞춤.

## 결정 (2026-11-24 확정)

| # | 질문 | 결정 | 이유 |
| --- | --- | --- | --- |
| D1 | `signal`을 시작 뒤에 abort하면? | 시작만 취소한다. 시작이 끝난 뒤의 abort는 무시하고 `runtime.destroy()`는 호출자가 부른다. | `fetch`·`loadAssets`와 같은 의미. 성공 뒤 자동 정리는 소유권이 흐려진다. |
| D2 | 화면 맞춤을 어디에 두나? | 씬 문서 `display.fit` + 런타임 기본값 `fit` 옵션. 우선순위는 `pixelPerfect`와 같다(문서 값 우선, 문서 `false`는 해제, 생략은 런타임 기본값). | 이미 있는 `display.pixelPerfect`와 같은 구조라 배우기 쉽고, 씬마다 월드 크기가 달라도 된다. |
| D3 | `releaseCanvasContext` 기본값 | `false`(지금과 같음). | 같은 캔버스에 런타임을 다시 만드는 기존 앱이 깨지지 않는다. |
| D4 | Studio 미리보기에 `display.fit` 반영 | R2에 포함(별도 커밋 R2b). | Studio가 이미 `display.pixelPerfect`를 미리보기·실행에 적용하므로(`apps/studio/src/placementPixelPresentation.ts`), fit만 무시하면 화면이 달라진다. |

## R1. 시작: 에셋 미리 읽기·시작 취소·렌더러 종류

### 공개 API

```ts
// packages/ferrum-web/src/createFerrumRuntime.ts
interface FerrumRuntimeOptions {
  /** Loaded into the runtime's asset host after the renderer exists and before the Data Scene applies. */
  assets?: AssetManifest;
  /** Concurrency etc. for `assets`; the startup `signal` is used for cancellation. */
  assetLoadOptions?: Omit<AssetLoadOptions, "signal">;
  onAssetProgress?: AssetLoadProgressCallback;
  /** Cancels startup only. After the promise resolves, the caller owns `runtime.destroy()`. */
  signal?: AbortSignal;
  /** Forwarded to `createRenderer` when the runtime creates the renderer. */
  onRendererFallback?: (info: RendererFallbackInfo) => void;
}
interface FerrumRuntime {
  /** Result of `options.assets`; absent when no manifest was given. */
  readonly assets?: LoadedAssets;
  /** The backend that actually runs. "custom" for an injected renderer the SDK does not recognize. */
  readonly rendererBackend: "webgl2" | "webgpu" | "custom";
}
```

### 동작 규칙

1. **순서:** 렌더러 생성 → 에셋 호스트 준비 → `assets` 읽기 시작과 엔진(Wasm) 생성을 **함께** 진행 → 둘 다 끝나면 Data Scene 적용 →
   `physicsScene` 적용 → 반환. 읽기는 런타임이 쓰는 그 에셋 호스트(소유한 `BrowserPlatformHost` 또는 주입한 `assetHost`)에 한다.
2. **주입한 에셋 호스트:** `assets`는 그 호스트로 읽고, 소유권은 바뀌지 않는다(런타임이 주입 호스트를 정리하지 않는다).
3. **실패:** 첫 오류를 그대로 reject하고 소유 자원을 모두 정리한다(기존 `catch` 정리 경로). 에셋 읽기와 엔진 생성이 둘 다 실패해도
   처리되지 않은 promise 거절(unhandled rejection)이 생기면 안 된다.
4. **취소(`signal`):**
   - 호출 시점에 이미 abort면 아무것도 만들지 않고 `AbortError`(`DOMException`)로 reject한다.
   - 각 `await` 뒤(렌더러, 엔진, 에셋)에 확인하고, `loadAssets`에는 같은 signal을 넘긴다.
   - abort되면 소유 자원을 정리하고 `AbortError`로 reject한다. 주입한 renderer/engine/assetHost는 정리하지 않는다.
   - 시작이 끝난 뒤의 abort는 무시한다(D1).
5. **크기 감시:** 시작이 성공하기 전에는 크기 감시(`observeRendererResize`)가 렌더러를 부르지 않아야 한다.
   권장 구현은 반환 직전에 감시를 붙이고 `resize()`를 한 번 더 부르는 것(엔진 생성 중 놓친 크기 변화를 반영).
   어떤 실패·취소·`destroy` 뒤에도 `renderer.resize()`가 불리지 않는다.
6. **렌더러 종류:** 런타임이 만든 렌더러는 `createRenderer`의 실제 결과(`WebGPURenderer`면 `"webgpu"`, 아니면 `"webgl2"`)로 정한다.
   주입한 렌더러는 SDK의 두 클래스면 그 값, 아니면 `"custom"`. `onRendererFallback`은 `createRenderer`의 `onFallback`으로 넘긴다
   (기존 경고 출력 기본값은 유지).
7. **프로파일러:** 프로파일러가 켜져 있으면 에셋 진행률을 `profiler.recordAssetProgress`에도 넘긴다(레벨 스트리밍과 같은 방식).

### 테스트 (`packages/ferrum-web/test/`)

기존 `createFerrumRuntime.integration.test.ts`의 가짜 renderer·engine 주입 방식과, 기존 에셋 로더 테스트의 가짜 로딩 방식을 재사용한다.
새 파일이 깔끔하면 `createFerrumRuntimeStartup.test.ts`로 분리해도 된다.

| 테스트 | 확인할 것 |
| --- | --- |
| 에셋 먼저, 씬 나중 | 이름 텍스처(`"hero"`)를 쓰는 Data Scene이 `assets`와 함께 성공하고, 같은 문서를 `assets` 없이 주면 지금처럼 텍스처 오류다. |
| 진행률·결과 | `onAssetProgress`가 불리고 `runtime.assets`에 읽은 결과가 있다. |
| 시작 전 abort | 이미 abort된 signal이면 `AbortError`, 렌더러·엔진·에셋 호스트를 만들지 않는다. |
| 읽는 중 abort | `AbortError`, 소유 에셋 호스트 정리, 주입 renderer/engine은 정리하지 않음, Data Scene 미적용. |
| 에셋 실패 | 같은 오류로 reject, 소유 자원 정리, unhandled rejection 없음(테스트에서 `process.on("unhandledRejection")` 감시). |
| 크기 감시 | 실패·abort·destroy 뒤 `window` resize 이벤트를 보내도 `renderer.resize` 호출 수가 늘지 않는다. |
| 렌더러 종류 | 주입한 가짜 renderer는 `"custom"`. |
| 기존 호출 | 새 옵션 없이 부르면 호출 순서·결과가 지금과 같다(기존 테스트 전부 통과). |

브라우저 smoke: `tests/smoke/data-scene-browser-smoke.mjs`(`pnpm smoke:data-scene`)에 사례 하나를 더한다.
런타임이 렌더러를 만들고(`rendererPreference: "webgpu"`, 헤드리스에선 WebGL2로 대체) `assets`로 읽은 텍스처의 스프라이트가 실제로 그려지는지(픽셀 확인),
`rendererBackend`가 실제 값인지, 에셋 읽기 중 abort하면 `AbortError`이고 그리기가 시작되지 않는지 본다.

### 문서

- `docs/engine/public-api/core.md`: "Runtime 생성"에 `assets`·`assetLoadOptions`·`onAssetProgress`·`signal`·`onRendererFallback`·`rendererBackend`,
  "에셋 묶음 로딩과 취소"에 런타임 시작 경로 한 단락.
- `docs/engine/public-api-surface.json`: 새로 export하는 타입이 있으면 등록(`pnpm validate:public-api-surface`).
- `docs/development/architecture/architecture.md`: 런타임 시작 순서(에셋 → 씬)와 취소 규칙 한 줄.
- `CHANGELOG.md` `Unreleased`.

## 선행 수정 F1: Data Scene smoke의 HD-2D 이동 실패

R1 통합 검증에서 찾은 결함이다. 기존 소비자 smoke가 첫 이동에서 멈춰 R2a 착수 전에 수정했다.

- **증상:** `node tests/smoke/data-scene-browser-smoke.mjs`가 첫 소비자 사례에서
  `Expected a current kinematic actor with a height span`(`examples/data-scene-native/main.mjs`의 `move`)으로 멈춘다.
  `engine.moveHd2dKinematicBodyWithTilemap(actor, …)`가 결과 없이 돌아온다. smoke의 `s.move(0, 50)` 단계다.
- **재현:** 같은 Wasm으로 R1 이전 커밋 `13715b6`과 R1 `77f94fa`에서 같은 이동 오류가 발생했다.
- **원인:** Data Scene의 `isTrigger` 기본값은 `true`이고, 평면 native 이동은 단일 solid AABB kinematic actor를 요구한다
  ([물리 문서](../engine/physics-spec.md)). 같은 SDK와 Wasm으로 비교했을 때 높이 정보가 정상인 트리거 actor는 Y=600에 남았고,
  `isTrigger: false`를 명시한 actor는 Y=650까지 이동했다. 두 경우 모두 백엔드는 `unified-3d`였다.
- **수정:** 레시피의 actor와 [Data Scene native 문서](../engine/data-scene-native-runtime.md) 예시에 `isTrigger: false`를 명시했다.
  스모크는 실제 actor가 solid AABB kinematic이고 50 단위 이동하는지 확인한다.
- **검증:** 준비된 Wasm으로 SDK를 빌드했다. SDK 테스트 2,053개, 브라우저 소비자 4개 조합과 R1 시작 사례,
  `pnpm validate:docs-links`, `pnpm validate:public-api-surface`가 통과했다.

## 선행 수정 F2: 픽셀 퍼펙트 smoke의 Shooter 스냅샷 실패

R2a 통합 검증에서 찾은 기존 결함이다. R2b의 검증 명령(`pnpm smoke:flat-pixel-perfect`)이 이 smoke 뒤에 Studio viewer smoke를 이어 실행하므로
R2b보다 먼저 고친다.

- **증상:** `node tests/smoke/flat-pixel-perfect-smoke.mjs`가 `native tile snap: missing native snapshot`으로 멈춘다.
  `tests/smoke/pixel-snap-native-tiles-fixture.mjs`가 `createFerrumRuntime`의 기본 엔진에 `setGameSpec`(내장 Shooter)을 넣고
  `runtime.engine.captureShooterStateSnapshot()`으로 카메라 위상을 바꾸려 하는데, 결과가 `undefined`다.
- **R2a와 무관함:** R2a 이전 커밋 `e09767d`와 R2a `fd200dd`에서 같은 오류로 실패한다(같은 Wasm).
- **추정 원인(확인 필요):** 이 조각은 2026-11-02(`6de0e11`)에 만들어졌고, 그 뒤 엔진 기본 물리가 native로 바뀌었다.
  [Core API](../engine/public-api/core.md)는 "Native Shooter에서는 legacy Shooter snapshot capture/restore를 상태 변경 전에 거절한다"고 적는다.
  즉 엔진 결함이 아니라 낡은 검사일 가능성이 높다. 이 조각이 확인하려는 것은 물리가 아니라 native 타일 렌더링의 픽셀 맞춤이다.
- **고칠 범위 판단:** (a) 이 조각만 legacy 물리로 엔진을 만들게 한다(`engine: { physicsBackend: "legacy" }` 등).
  (b) 스냅샷 없이 카메라 위상을 정하는 다른 공개 경로가 있으면 그것으로 바꾼다. 엔진의 Shooter 스냅샷 계약은 바꾸지 않는다.
- **완료 조건:** `pnpm --filter @ferrum2d/ferrum-web build && node tests/smoke/flat-pixel-perfect-smoke.mjs` 통과(WebGL2·WebGPU 요청 모두, 배율 1·2).
  원인과 선택한 수정을 커밋 메시지와 이 절에 기록한다. Rust 변경이 필요하면 구현 전에 보고한다.

## R2. 화면 맞춤: `display.fit`와 `runtime.dataScene.view`

### 문서 형식

```json
{ "display": { "fit": { "width": 640, "height": 384 } } }
```

```ts
// packages/ferrum-web/src/sceneDisplay.ts
interface SceneFitSpec {
  /** World rectangle kept fully visible; the canvas shows it as large as possible at its aspect ratio. */
  width: number;
  height: number;
  /** Top-left of the rectangle in world units. Default 0, 0. */
  x?: number;
  y?: number;
}
interface SceneDisplaySpec {
  pixelPerfect?: PixelPerfectOptions | false;
  fit?: SceneFitSpec | false;
}
// createFerrumRuntime option: runtime default, same precedence as pixelPerfect.
interface FerrumRuntimeOptions { fit?: SceneFitSpec | false; }
interface FerrumRuntimeDataScene {
  /** Coordinate helper bound to this runtime. Stays valid across reapply/transition. */
  readonly view: DataSceneView;
}
```

### 검증

- `width`·`height`: 유한한 양수, 상한 100,000. `x`·`y`: 유한한 수, 기본 0. 알 수 없는 필드는 오류(`display` 규칙과 같음).
- 한 문서에 `fit`와 `pixelPerfect`가 둘 다 켜지면 경로가 있는 진단 오류. `spatial` 문서에 `fit`가 켜져도 오류.
- 런타임 기본값과 문서 값의 조합 규칙은 `pixelPerfect`와 같다. 기본값 `fit`와 문서의 `pixelPerfect`처럼 결과적으로 둘 다 켜지면 오류.

### 동작 규칙

1. **적용(처음·`reapply`·`transition`의 commit):** fit가 켜지면 zoom = min(캔버스 CSS 폭 / width, 캔버스 CSS 높이 / height)
   (기존 `validateZoom` 범위로 제한), `renderer.setViewportZoom(zoom)`, `engine.setViewportSize(viewport)`,
   카메라 중심 = (x + width/2, y + height/2)(`setDataSceneCamera`, follow·bounds 없음).
   기존 `configureDisplay`의 commit/rollback 흐름에 넣어, 적용이 실패하면 이전 zoom·카메라·fit 상태로 되돌린다.
2. **크기 변화:** 렌더러 크기 감시에서 zoom만 다시 계산한다. 카메라 중심은 건드리지 않는다(게임이 옮긴 카메라·follow를 유지).
3. **숨은 캔버스:** CSS 크기가 0이면 건너뛰고, 보이게 되면 다음 크기 변화에서 적용한다.
4. **fit가 꺼진 문서로 바뀔 때:** zoom을 1로 되돌린다(`pixelPerfect: false`가 기본 표시로 돌아가는 것과 같은 원칙). 카메라는 건드리지 않는다.
5. **fit가 없을 때:** 런타임은 zoom·카메라를 건드리지 않는다(지금과 같음).
6. **여백:** fit 사각형 밖은 렌더러 배경색으로 보인다. fit는 그리기를 자르지 않는다.
7. **`view.setZoom`과의 관계:** fit가 켜져 있으면 zoom은 런타임이 정한다. 게임이 `view.setZoom`을 불러도 다음 크기 변화·적용에서 덮인다(문서에 명시).

### `runtime.dataScene.view`

- 런타임이 만들고, `reapply`·`transition` 뒤에도 같은 객체로 계속 쓸 수 있다. 변환(`worldToScreen`·`screenToWorld`·`pointerToWorld`·`snapshot`)은
  항상 지금의 zoom·카메라를 반영한다.
- 지금 `createDataSceneView`는 만들 때 zoom·카메라를 설정한다. 런타임 view는 만들 때 아무것도 바꾸지 않아야 하므로,
  내부에서 "연결"과 "설정"을 나눈다. 공개 함수 `createDataSceneView`의 동작은 그대로 둔다.
- fit가 꺼진 문서에서도 view는 있다(변환만 제공).

### Studio (R2b, 별도 커밋)

`apps/studio/src/placementPixelPresentation.ts`가 `display.pixelPerfect`를 미리보기·실행에 적용하는 것과 같은 자리에서 `display.fit`도 적용한다.
2D 편집 화면은 지금처럼 넓은 편집 viewport를 유지하고, 게임 미리보기·실행에서만 맞춘다. 알 수 없는 필드로 거절되지 않는지도 확인한다.

### 테스트

| 테스트 | 확인할 것 |
| --- | --- |
| 형식 검증(`sceneDisplay`) | 올바른 fit, 0·음수·무한·알 수 없는 필드 오류, `pixelPerfect`와 동시 사용 오류, spatial과 함께 오류, 기본값·`false` 조합. |
| zoom 계산 | 가짜 캔버스 CSS 1000 × 500에 640 × 384 → zoom 1000/640·500/384 중 작은 값. 크기를 바꾸면 다시 계산. |
| 카메라 | 적용 시 중심 (320, 192), 크기 변화에서는 중심 유지, `x`·`y`가 있으면 그만큼 이동. |
| reapply·transition | 같은 view 객체 유지, fit 유지, fit 없는 문서로 바꾸면 zoom 1, 적용 실패 시 이전 상태 복원. |
| 변환 | fit 상태에서 월드 중심의 `worldToScreen`이 캔버스 중심, `pointerToWorld`가 그 역. |
| 기존 호출 | fit 없이 부르면 zoom·카메라 호출이 지금과 같다. |

브라우저 smoke: `tests/smoke/flat-pixel-perfect-smoke.mjs`(`pnpm smoke:flat-pixel-perfect`) 또는 data-scene smoke에 fit 사례를 더한다.
두 캔버스 크기에서 월드 네 모서리 표식이 모두 보이고(잘리지 않음) 비율이 유지되는지, 크기를 바꾼 뒤 포인터 변환이 맞는지 본다.
R2b는 Studio viewer smoke(`flat-pixel-perfect-viewer-smoke.mjs`)에 fit 문서 미리보기 한 사례를 더한다.

R2a 검증에서 SDK 테스트 2,061개와 Data Scene 브라우저 스모크 전체가 통과했다. fit 사례는 DPR 2의
1000×500 및 390×844 캔버스에서 네 모서리 픽셀, 사각형 배율, 포인터 변환과 같은 view의 재사용을 확인했다.
기존 SDK 픽셀 퍼펙트 스모크는 변경 전 커밋에서도 Shooter 스냅샷 단계에서 실패한다. 선행 수정 F2에서 다룬다.

### 문서

- `docs/engine/data-scene-authoring.md` "기본 2D 표시 설정": `display.fit` 형식·검증·`pixelPerfect`와의 차이(연속 배율 vs 정수 배율 픽셀아트).
- `docs/engine/public-api/core.md`: "기본 2D 픽셀 퍼펙트 표시" 옆에 "화면 맞춤" 절, `runtime.dataScene.view`.
- `public-api-surface.json`(새 타입), `architecture.md`(표시 설정 흐름), `CHANGELOG.md`.

## R3. 정리: 캔버스 컨텍스트 놓기 (선택)

```ts
interface FerrumRuntimeOptions {
  /** The canvas is used by this runtime only: release its GPU context on destroy and on failed startup. */
  releaseCanvasContext?: boolean; // default false (D3)
}
```

- 렌더러에 선택 capability `releaseContext()`를 둔다. WebGL2는 `destroy()` 뒤 `WEBGL_lose_context.loseContext()`,
  WebGPU는 `destroy()`가 이미 하는 일을 확인하고 남는 것(컨텍스트 unconfigure 등)을 놓는다.
- 런타임은 `releaseCanvasContext: true`이고 **자기가 만든 렌더러**일 때 `destroy`와 시작 실패·취소 정리에서 부른다.
  주입한 렌더러와 함께 `true`를 주면 시작 시 오류로 거절한다(호출자 소유를 런타임이 깨지 않게).
- 문서에 "컨텍스트를 놓은 캔버스는 새 런타임에 다시 쓸 수 없다. 새 런타임에는 새 캔버스를 쓴다"를 적는다.
- 테스트: 노드 테스트는 옵션 검증(주입 렌더러와 함께 쓰면 오류)과 호출 순서. 브라우저 smoke는 새 캔버스로 런타임 20개를 만들고 없앤 뒤
  살아 있는 WebGL2 컨텍스트가 0인지(예제 사이트 smoke의 `getContext` 감시 방식), 옵션이 없으면 지금처럼 남는지 본다.
- 문서: `core.md` "Runtime 생성"의 렌더러 수명 단락, `CHANGELOG.md`.

## 예제 반영 (2순위, R1~R3 뒤)

1. 예제 사이트의 세 예제를 새 API로 옮긴다: `createRenderer`·`AssetLoader`·`createDataSceneView`·`ResizeObserver`·view 재생성 제거,
   `signal`·`assets`·`display.fit`·`rendererBackend`·`releaseCanvasContext` 사용. 사이트 틀의 `releaseCanvas` 제거.
   예제 소스 탭에서 "엔진으로 이렇게 시작한다"가 보이게 하는 것이 목적이다.
2. 그 다음 사이트 전용 공통 도우미(수치 보내기·'표시' 메뉴·이벤트 연결)와 벽돌 깨기의 엔진 HUD·입력 전환을 판단한다.

## 이 계획 다음의 엔진 후보 (예제에서 찾은 것, 범위 밖)

| 후보 | 문제 | 제안 |
| --- | --- | --- |
| 연속 충돌(CCD) 작업 한도 오류 | planar native에서 CCD를 켠 채 dynamic 공이 static 상자 사이 한 칸 틈에 들어가면 프레임 단계가 `physics capacity exceeded`를 던지고 시뮬레이션이 멈춘다. 재현과 관련 원인은 [통합 3D 물리의 미해결 항목](unified-3d-physics-plan.md#미해결-회전-상자-접촉의-운동-증명-2026-11-22)에 합쳤다. | 우선 높음(정확성). 그 항목의 수정 방향 결정과 함께 진행하고, 작업 한도 초과는 멈춤 대신 구분되는 오류로 알린다. |
| 충돌 쌍 수치의 의미 | `frame.physics.collisionSolidPairs`·`collisionTriggerPairs`는 한 출력 프레임 안 물리 단계마다 더한 값이라 "지금 겹친 쌍"으로 읽으면 틀린다. | 문서 명확화, 필요하면 "지금 쌍 수" 추가. |
| 고정 속도 body | 벽돌 깨기 공처럼 속도를 일정하게 유지하려면 매 프레임 코드로 맞춰야 한다. | dynamic body의 최대·고정 속도 옵션 검토. |
| 전투 모드 없는 충돌 시 제거 | `collisionDespawn` 레시피는 씬 문서에서 HD-2D 전투 모드(`gameplay.combat`)가 필요하다. | 탐험 모드에서도 쓸 수 있게 할지 검토. |
| 입력의 편집 대상 판정 | `InputManager`는 `input·textarea·select·button`만 제외한다. 키로 조작하는 `role="separator"`·슬라이더 등에 초점이 있어도 게임 키로 받는다. | 제외 규칙 확장 또는 옵션 검토. |
| 충돌체 기본값이 트리거인 함정 | Data Scene 충돌체는 `isTrigger`를 생략하면 트리거다. body를 붙이고 `isTrigger: false`를 잊으면 막지도 않고 HD-2D 이동도 거절된다(F1의 원인). | body가 있는 충돌체의 기본값을 solid로 바꿀지(기존 문서 동작이 바뀌므로 제품 결정) 또는 body+트리거 조합에 진단을 낼지 검토. |
| 이동 실패 이유 | `moveHd2dKinematicBodyWithTilemap`은 actor가 조건(단일 solid AABB kinematic, 높이 정보)에 맞지 않으면 이유 없이 결과 없음으로 돌아온다. | 거절 이유를 돌려주거나 개발 모드 진단을 낸다. |
| WebGPU 복구 중 화면 맞춤 크기 변화 | R2a 뒤 화면 맞춤이 켜지면 캔버스 크기 변화에서 `renderer.resize()` 대신 `setViewportZoom`을 부른다. `WebGPURenderer.setViewportZoom`은 준비 상태가 아니면 오류를 던지므로, 장치 손실 복구 중 크기가 바뀌면 크기 감시 콜백에서 오류가 날 수 있다(맞춤이 꺼진 경로는 준비 전이면 건너뜀). | 작다. R2b 또는 R3 때 준비 전이면 미뤘다가 복구 뒤 맞추도록 함께 고친다. |

## Codex 작업 지시

**먼저 읽을 것:** `AGENTS.md`, 이 문서, `docs/engine/public-api/core.md`("Runtime 생성", "에셋 묶음 로딩과 취소", "기본 2D 픽셀 퍼펙트 표시"),
`docs/engine/data-scene-authoring.md`("기본 2D 표시 설정"), `packages/ferrum-web/src/`의 `createFerrumRuntime.ts`·`createRenderer.ts`·
`browserPlatformHost.ts`·`assetLoader.ts`·`sceneDisplay.ts`·`dataSceneView.ts`, `packages/ferrum-web/test/createFerrumRuntime.integration.test.ts`·`dataSceneView.test.ts`.

**작업 단위:** R1, F1·F2(선행 수정), R2a(SDK), R2b(Studio), R3을 각각 한 커밋으로 한다(AGENTS "한 작업에 한 논리적 변경"). 코드·테스트·문서·CHANGELOG를 같은 커밋에 넣는다.
앞 단계가 검증을 통과한 뒤 다음 단계로 간다.

**지킬 것:**
- 새 옵션을 쓰지 않는 기존 호출은 동작·호출 순서·오류가 완전히 같아야 한다.
- Rust/Wasm, 새 의존성, `examples/site` 변경 금지. 프레임 hot path에 새 JS↔Wasm 왕복을 넣지 않는다(화면 맞춤은 크기 변화·적용 때만).
- 코드 주석은 영어, 문서는 한국어. 공개 타입에는 짧은 TSDoc.
- 설계가 이 문서와 달라져야 하면 구현 전에 이유를 보고하고 문서를 먼저 고친다.

**검증 (AGENTS "검증 명령 실행 원칙"):**
- 개발 중: 바꾼 파일의 타입 검사(`pnpm --filter @ferrum2d/ferrum-web lint`)와 관련 테스트만.
- 단계 끝: `pnpm --filter @ferrum2d/ferrum-web test`, `pnpm validate:public-api-surface`, `pnpm validate:docs-links`,
  해당 브라우저 smoke(R1 `pnpm smoke:data-scene`·`pnpm smoke:asset-loading`, R2 `pnpm smoke:flat-pixel-perfect`, R3 추가한 smoke).
  R2b는 `pnpm --filter @ferrum2d/studio build`와 Studio viewer smoke.
- 전체 끝(통합 담당이 한 번): `pnpm lint`, `pnpm build`, `pnpm package:check:ferrum-web`, `pnpm smoke:example-site`(기존 예제 회귀).
- Rust를 바꾸지 않으므로 `cargo` 검사는 생략하고 그 사유를 보고에 적는다.

**보고:** AGENTS "Review Rule" 형식(변경 파일, 이유, 실행한 명령, 못 한 명령과 사유, 위험·후속). 이 문서의 "결정"과 다르게 구현해야 했던 것이 있으면 함께 적는다.

## 완료 조건

- R1: 렌더러를 런타임에 맡기고도 이름 텍스처를 쓰는 Data Scene이 시작되고, 시작을 취소할 수 있으며, 실제 렌더러 종류를 알 수 있다.
- R2: 씬 문서 한 줄(`display.fit`)로 고정 월드가 크기가 바뀌는 캔버스에 맞고, `runtime.dataScene.view`가 다시 적용해도 그대로 쓰인다. Studio 미리보기도 같다.
- R3: 옵션 하나로 런타임을 없앨 때 캔버스 컨텍스트가 풀린다.
- 각 단계의 테스트·smoke·문서·CHANGELOG가 함께 들어가고, 기존 예제 사이트 smoke가 그대로 통과한다.
