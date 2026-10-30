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
