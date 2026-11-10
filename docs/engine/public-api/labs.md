# Labs Public API

`@ferrum2d/ferrum-web/labs`는 preview 상태의 optional renderer, visual helper, asset helper
surface다. 지원 환경이나 명시 opt-in이 필요한 기능은 이 entrypoint에 둔다.

```ts
import {
  WebGPURenderer,
  resolveSpriteMaterialPreset,
  ParticleVfxEmitter,
  createPixelMaskTerrain,
} from "@ferrum2d/ferrum-web/labs";
```

## Renderer And Material

| API | 계약 |
| --- | --- |
| `WebGPURenderer` | 지원 browser에서 선택적으로 사용하는 renderer다. WebGL2 fallback을 유지한다. |
| `resolveSpriteMaterialPreset(...)` | material preset input을 renderer command pass로 정규화한다. |
| `spriteMaterialPasses(...)` | sprite material pass 목록을 만든다. |
| `writeSpriteMaterialPassCommands(...)` | pass command를 buffer에 기록한다. |

WebGPU와 material helper는 Rust render command ABI를 바꾸지 않는다. Rust core는 renderer API를
직접 호출하지 않고, TypeScript renderer가 command buffer를 소비한다.
`WebGPURenderer.supportsSpatialScene`은 true이며 지형·빌보드·정적 모델을 지원한다.
모델은 `await preloadSpatialModels(assets)` 후 동기 `prepareSpatialModels` lease로 활성화한다.
환경 효과를 포함한 현재 제한은 [WebGPU 공간 경로](../data-scene-spatial.md#webgpu-공간-경로)를 따른다.

### 평면 2D 팔레트 스왑

`SpriteMaterialPreset.paletteSwap`은 원본 이미지를 수정하지 않고 RGB 색을 교체한다.
`SpritePaletteSwap` 타입은 root/labs에서 가져온다. 기존 `createFerrumRuntime({ spriteMaterial })`,
renderer의 `setSpriteMaterial(...)` 또는 renderer 생성 옵션의 `webgl2.spriteMaterial`/`webgpu.spriteMaterial`을 사용한다.

```ts
// 두 ID는 같은 원본 PNG를 사용한다. 현재 로더는 ID마다 GPU 이미지를 소유한다.
await renderer.loadTexture(1, "/assets/hero.png", { colorSpace: "none" });
await renderer.loadTexture(2, "/assets/hero.png", { colorSpace: "none" });
renderer.setSpriteMaterial({
  paletteSwap: [
    { textureId: 1, colors: [{ from: "#b03030", to: "#4080d0" }] },
    { textureId: 2, colors: [{ from: "#b03030", to: "#40b060" }] },
  ],
});
// 기존 sprite/animation frame의 texture ID로 팀별 색을 선택한다.
// 해제: renderer.setSpriteMaterial(false);
```

- 최대 64개 texture binding, 각 1~32색이다. `#rrggbb`만 받으며 대소문자는 구분하지 않는다.
  texture ID는 정수 `0..16777215`, 중복 ID/원본색과 잘못된 값은 거절한다. 빈 배열은 비활성이다.
- 업로드된 RGB8 색을 정확히 매칭하고 **한 번만** 교체한다. `red→blue`, `blue→green`을 함께 지정해도 red는 blue가 된다.
  알파는 유지하며 투명 texel·매칭되지 않은 색은 유지한다. 텍스처 필터는 기존 nearest를 사용한다.
- 교체한 RGB에 기존 tint/colorMix와 조명을 적용한다. outline·ground shadow·절차적 도형·normal/coverage pass는 기존 결과를 유지한다.
  같은 atlas의 다른 UV 프레임에도 같은 ID의 팔레트가 적용된다.
- 양쪽 renderer에서 동일하게 쓰려면 PNG를 `colorSpace: "none"`으로 로드한다.
  `AssetLoader`는 `textureOptions: { hero: { colorSpace: "none" } }`을 지원한다.
  WebGL2 `linear-srgb`의 sRGB 이미지는 linear sample을 RGB8 키로 변환하고 교체색을 linear로 돌려 조명에 전달한다.
  WebGL2 legacy sRGB는 업로드 시 premultiply로 정보가 소실되어 진단 오류를 낸다.
  WebGPU는 straight-alpha 이미지이므로 sRGB 입력도 지원한다. `linear-srgb`에서는 양 backend가 표시용 RGB8 키를 비교하고 교체색을 선형으로 복귀시킨다.
- 압축 KTX2·메타데이터 없는 texture·RenderTexture **입력**·HD-2D spatial packet은 지원하지 않고 오류를 낸다.
  KTX2 대상은 `ktx2Url` 없이 PNG를 로드한다. WebGL2 `renderToTexture` **출력**에는 팔레트를 적용할 수 있다.
  raw `renderCommands(texture, commands)` 대신 texture ID를 사용하는 `renderCommands(commands)`를 사용한다.
- 추가 패스나 palette texture fetch 없이 bounded uniform 테이블을 사용한다. WebGPU는 binding별 독립 uniform을 유지하며
  동일한 provider 설정은 GPU 자원을 재생성하지 않는다. 비활성 상태는 기존 shader/pipeline이고 추가 draw·texture·palette buffer가 없다.
  WebGPU 장치 복구는 마지막 팔레트 설정을 복구한다. 원본 PNG 저장·씬 JSON schema·Wasm 15-float ABI는 바꾸지 않는다.

현재는 runtime API다. 내장 도트 편집기의 원본 색상 교체와 별개이며 에디터 팔레트 재질 UI는 추가하지 않는다.
검증 범위는 [팔레트 smoke](../../development/quality/smoke-check.md#평면-2d-팔레트-스왑)를 따른다.

## WebGPU 장치 수명과 복구

개발 소스의 `WebGPURenderer.deviceState()`는 `status`(`ready`/`lost`/`recovering`/`destroyed`),
`generation`(최초 1), 선택 `reason`/`message`를 독립 객체로 반환한다.
`GPUDevice.lost`를 받으면 소유 GPU 자원을 정리하고 render·renderCommands·debug·postprocess 제출을 중단한다.
Rust 시뮬레이션과 씬/입력 상태는 변경하지 않는다. 게임 일시정지는 애플리케이션 정책이다.

```ts
import { WebGPURenderer } from "@ferrum2d/ferrum-web/labs";
// createRenderer가 반환한 기존 renderer 참조를 유지한다.
if (renderer instanceof WebGPURenderer && renderer.deviceState().status === "lost") {
  await renderer.recoverDevice();
}
```

- 복구는 명시적 cold 작업이다. 동시 `recoverDevice()`는 같은 Promise를 공유하고 성공 시 true와 새 generation을 제공한다.
  새 adapter/device와 pipeline·버퍼·소유 target을 만들고 준비한 자원을 검증한 뒤 backend를 교체한다.
- ID를 지정한 이미지 텍스처는 로드한 원본 Blob을 보관하므로 원래 URL이 폐기되거나 네트워크가 끊겨도 복구한다.
  pixel-mask texture는 색상/alpha patch가 반영된 RGBA 사본을 보관한다. 캐시는 현재 관리하는 ID의 수명에 묶이며 교체·evict·destroy에서 해제한다.
  이 CPU 저장량은 GPU 사용량 통계와 별개다.
- 최근 제출한 모델의 opaque CPU asset과 가장 최근 준비 batch의 모델을 사용한다. 이전 frame의 borrowed Wasm view는 보관하지 않는다.
  과거 씬의 모든 preload를 영구 보존하지 않으며 다른 모델은 기존 준비/업로드 경로를 사용한다.
  현재 씬과 다음 준비 씬은 각각 기존 최대 16개 묶음으로 복원한다. 현재 자원을 먼저 pin한 뒤 다음 묶음을 준비해 pruning으로 잃지 않으며, 전체 GPU 자원 예산은 유지한다.
  내용 hash가 같아도 별도로 로드한 opaque asset handle은 각각 복구한다.
- renderer 설정과 zoom·지면 투영은 유지하고 현재 canvas 크기를 다시 읽는다. texture ID와 엔진의 entity handle은 유지한다.
  이전 `gpuDevice()`·`GPUTexture`·외부 pipeline/buffer 참조는 무효다. ID 없는 raw texture나 호출자가 직접 만든 GPU 자원은 호출자가 다시 만든다.
- `isRenderReady()`는 lost/recovering에서 false, ready에서 true이며 destroy 이후에는 오류를 낸다.
  runtime은 준비되지 않은 동안 visual provider와 GPU 제출만 건너뛰고 native update·프레임 콜백은 유지한다.
  복구 직후 provider의 최신 팔레트/해제 값을 적용한다. 수동 setter 호출은 계속 ready 상태를 요구한다.
- lighting/material/postprocess 설정은 먼저 복구용 snapshot을 만든 뒤 같은 snapshot을 backend에 적용한다.
  복사·검증이 실패하면 이전 live 설정과 복구 설정을 유지한다.
- 실패하면 Promise를 reject하고 `lost`를 유지해 재시도할 수 있다. 복구 중 destroy는 작업을 취소하고 새 자원을 폐기한다.
  진행 중이던 기존 texture load는 취소되며 성공한 등록을 임의로 대체하지 않는다.
- 이미 선택한 WebGPU canvas를 WebGL2로 조용히 교체하지 않는다. 초기 context 선택 전 fallback은 기존 factory 계약을 유지한다.
  렌더링 중 장치 손실과 명시적 앱 종료를 구분하고 자동 무한 재시도는 하지 않는다.

플랫폼 기준은 [GPUDevice.lost](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/lost)다.
실제 GPU loss 주입·폐기한 URL·모델/재질·픽셀 복원과 미지원 범위는
[검증 기준](../../development/quality/smoke-check.md#webgpu-장치-손실-복구)을 따른다.

## Particle And VFX

| API | 계약 |
| --- | --- |
| `ParticleVfxEmitter` | presentation-only particle emitter다. |
| `PARTICLE_VFX_PRESETS` | built-in particle preset catalog다. |
| `resolveParticleVfxPresetConfig(...)` | preset input을 runtime config로 정규화한다. |
| `particleVfxPreset(...)` | named preset 조회 helper다. |

Particle/VFX helper는 gameplay state의 source of truth가 아니다. gameplay 결과는 Rust event
buffer에 남고, VFX는 frame-end presentation adapter에서 재생한다.

## Asset And Atlas

| API | 계약 |
| --- | --- |
| `IndexedDbAssetCache` | browser IndexedDB 기반 binary/json asset cache다. |
| `generateTextureAtlasLayout(...)` | atlas packing layout을 만든다. |
| `packTextureAtlas(...)` | texture atlas document를 생성한다. |
| `textureAtlasDocumentToShooterAtlas(...)` | atlas document를 Shooter atlas spec으로 변환한다. |

Asset helper는 build/import pipeline 또는 explicit runtime preload 경로에서 사용한다.

### PNG 아틀라스의 가장자리 보호

저장소의 PNG 합성 CLI는 기존 padding 안에 가장자리 RGBA를 복제하는 선택형 extrusion을 제공한다.

```bash
pnpm pack:textures --input-dir ./assets/raw --output-image ./public/atlas.png --output-json ./public/atlas.json --padding 2 --extrude 2
```

- config JSON의 `extrude` 또는 CLI `--extrude`를 쓴다. CLI 값이 config보다 우선한다.
- 기본은 `0`이다. 기존 투명 padding과 PNG 출력이 유지된다. `extrude`는 정수 `0..padding`이며
  null·문자열·boolean·소수·음수·범위 밖 값은 거절한다. CLI의 숫자 문자열은 숫자로 읽으며 빈 값·공백은 거절한다.
  padding은 정규화 전에 유한 숫자인지 확인해 `-Infinity`가 0 여백으로 바뀌는 것도 거절한다.
- `padding`은 프레임마다 예약한 여백, `extrude`는 그 안쪽에 복제할 폭이다. `padding: 2, extrude: 1`이면
  가장 가까운 1픽셀만 복제하고 바깥 1픽셀은 투명하게 남긴다. 모서리·알파 0의 RGB·반투명 RGBA도 원본 바이트를 보존한다.
- layout·프레임 크기·UV·atlas v1·Game Spec frame은 바뀌지 않는다. half-texel inset이나 런타임 셰이더 변경은 적용하지 않는다.
  잘못된 extrusion은 PNG/JSON/Game Spec을 쓰기 전에 거절한다.
- `packTextureAtlas(...)`는 위치/UV 메타데이터만 생성한다. 이 helper에 `extrude` 옵션을 넣거나
  metadata JSON만 수정해도 PNG의 픽셀이 합성되는 것은 아니다. CLI는 저장소 개발 도구이며 SDK tarball에 포함되지 않는다.
- color/normal 애니메이션 변환의 기존 `animation.padding`은 이미 같은 layout과 edge 복제를 사용한다.
  이 CLI의 `extrude`는 그 변환 옵션을 변경하지 않는다. 일반 CLI는 normal pair를 자동으로 구성하지 않는다.

extrusion은 프레임 밖을 잘못 샘플링할 때 제한된 보호 여백을 제공한다. 정상 nearest 샘플링에서 항상 번짐이
발생하는 것은 아니며, 큰 아틀라스의 내부 텍셀 선택 오차·압축 손실·모든 모바일 GPU 정밀도를 해결하는 옵션은 아니다.
검증 명령과 측정 경계는 [Smoke Check](../../development/quality/smoke-check.md#png-아틀라스-가장자리-보호-gate)를 따른다.

## Pixel Mask And HD-2D Helpers

| API | 계약 |
| --- | --- |
| `createPixelMaskTerrain(...)` | alpha mask 기반 terrain authoring helper를 만든다. |
| `createPixelMaskTerrainRuntime(...)` | dirty alpha patch와 collider rebuild orchestration을 돕는다. |
| `extractPixelMaskBoundaryChains(...)` | alpha mask boundary를 chain collider 입력으로 변환한다. |
| `pixelMaskTerrainToTilemapLayer(...)` | terrain mask를 collision tile layer로 변환한다. |
| `deriveHd2dTileOccludersFromTilemapGrid(...)` | HD-2D tile metadata에서 lighting occluder를 만든다. |

이 helper들은 optional authoring/runtime 보조 기능이다. 복잡한 destructible terrain이나 3D
solver로 확장하는 것은 별도 설계 대상이다.


### PixelMaskTerrain의 데이터·수명

생성 전에 `createEngine()` 또는 `/core`의 `initializeFerrumWasm()`을 기다린다.
Rust가 alpha 원본·solid 판정·편집·dirty/version을 소유한다. 한 변은 1~4096, 전체는 최대 16,777,216픽셀이다.
`data`는 alpha 복사본, `solidData()`는 0/1 occupancy 복사본이다. 복사본 수정은 지형에 반영되지 않는다.
`setPixel`, `carveRect`, `carveCircle`로 편집하며 `version`은 읽기 전용이다.
`PixelMaskTerrainRuntime.sync()`는 한 revision의 solidity를 bulk로 받아 collider chunk들에 재사용한다.
texture callback 중 추가 편집은 dirty를 유지해 다음 sync에 적용한다.

호출자는 마지막 사용 후 `terrain.destroy()`를 호출한다. `runtime.destroy()`는 자신이 만든 collider chunk를
해제하지만 전달받은 terrain이나 texture target은 해제하지 않는다. texture ID의 eviction과 target 수명은 호출자가 관리한다.
두 객체를 모두 소유하면 runtime부터 해제한 뒤 terrain을 해제한다.


`sync()` 실행 중 같은 runtime의 `sync`/`setPixel`/`carveRect`/`carveCircle` 재진입은 편집 전에 오류로 거절한다.
callback에서 native `terrain`만 직접 편집하면 다음 sync를 위해 dirty가 유지된다.
callback 중 runtime을 해제하면 진행 중 sync는 오류로 중단하고 등록 전 collider도 회수한다.
생성 실패 시 이미 생성한 collider chunk를 회수한다. force sync가 도중에 실패한 경우에는 native mask가
깨끗하더라도 다음 일반 sync에서 다시 전달한다. 교체 collider가 준비될 때까지 기존 collider는 유지한다.
여러 chunk를 한 번에 교체하는 전체 transaction은 아니며, 성공한 앞 chunk는 유지하고 실패한 전달은 재시도한다.

## Flat 점광원 원뿔 · 개발 소스

`PointLight2D.spot?: PointLightSpot2D`의 `directionX`, `directionY`, `angleDegrees`와
선택형 `penumbra`를 지정한다. `ResolvedPointLightSpot2D`는 정규화된 방향과 기본 penumbra0을 포함한다.
범위·타원 좌표·비활성 검증·저장 및 private GPU 비용은
[Flat 2D spot 조명](../data-scene-presentation.md#flat-2d-spot-조명-개발-소스)을 따른다.
기존 legacy overlay는 새 원뿔 요청을 거절하고 선택형 lit profile에서 사용한다.

## Flat 점광원 cookie · 개발 소스

`PointLight2D.cookie?: PointLightCookie2D`는 `texture`(이름/숫자) 또는 `textureId` 중 하나와 선택형
`rotationRadians`·`uv`를 받는다. `ResolvedPointLightCookie2D`는 기본 회전0과 전체 UV를 포함하며 이름을 보존한다.
raw R*A·좌표·data 이미지 준비·원본 저장·renderer의 숫자 ID 요구·GPU 비용은
[Flat cookie 계약](../data-scene-presentation.md#flat-2d-cookie-조명-개발-소스)을 따른다.
