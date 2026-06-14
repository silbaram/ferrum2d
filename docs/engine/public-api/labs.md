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
