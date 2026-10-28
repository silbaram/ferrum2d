# Data Scene 입체 지형·카메라·빌보드

현재 개발 소스는 **WebGL2 기본, opt-in 공간 렌더링**을 제공한다.
높이가 있는 사각 지형과 2D 스프라이트를 같은 깊이 버퍼로 그린다. 직교/원근 카메라,
실제 지형 클릭, native kinematic 계단·경사 이동, 물리 elevation에 연결한 빌보드를 포함한다.
선택 `environment`로 고정 해상도·픽셀 스냅, normal atlas·점광원/태양광·PCF·그림자 캐시/컬링,
실제 거리 DOF·actor 초점·색 보정·안개를 제공한다.
기존 beta 설치본에 이 기능이 있다고 가정하지 말고 아래 API가 포함된 빌드를 사용한다.
선택 WebGPU의 지형·빌보드·정적 모델·환경 효과 지원 범위는 [WebGPU 공간 경로](#webgpu-공간-경로)를 따른다.

## 공개 작성 경로

`@ferrum2d/ferrum-web/authoring`의 `applyDataSceneAuthoringDocument`에 optional `spatial`을 작성한다.
기존 Scene Authoring envelope version 1을 유지하며 `spatial` 생략 시 기존 평면 경로를 사용한다.
`resolveDataSceneSpatialSpec`과 `resolveSpatialCameraSpec`은 `/core`, `/authoring`에서 제공한다.

```ts
const spatial = {
  camera: {
    projection: "orthographic",
    position: { x: 160, y: -200, elevation: 380 },
    target: { x: 32, y: 40, elevation: 24 },
    height: 360, near: 0.1, far: 2000,
  },
  terrain: [
    { id: "low", x: -96, y: -64, width: 64, depth: 128, elevation: 0 },
    { id: "step", x: -32, y: -64, width: 64, depth: 128, elevation: 16, kind: "stair" },
    { id: "upper", x: 32, y: -64, width: 64, depth: 128, elevation: 32, kind: "stair" },
  ],
  billboards: { actor: { unitsPerPixel: 1, alphaCutoff: 0.5 } },
  actor: { instanceId: "actor", speed: 80, maxStepHeight: 16, maxDropHeight: 32 },
};
// document의 선택 fragment에 actor가 있어야 한다.
// actor components: inline visual, enabled non-trigger AABB,
// body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 8 } }
const result = applyDataSceneAuthoringDocument(engine, { ...document, spatial });
```

전체 실행 recipe는 `examples/data-scene-native/spatial.mjs`다. 이 파일은 공개 `/core`·`/authoring`만
사용하며 Rust 입력 업데이트, 지형 이동, bitmap label과 DOM HUD를 연결한다.
걷기 atlas를 함께 사용하려면 기존 `gameplay.primaryActor`와 이동 애니메이션 설정을 같은 actor에 연결한다.

공식 Placement Viewer의 작업 격자·작업 평면은 authoring 보조 표시다. 맵 밖에도 표시되지만
`spatial.terrain`이나 보행 지지면을 자동 생성하지 않는다. 기본 지형 배치와 명시적 작업 평면 배치를 구분하며
sprite의 물리 높이·층과 visual-only 모델의 시각 높이는 기존 저장 계약을 따른다.
설정 방법은 [뷰어 사용법](../../apps/placement-viewer/README.md)을 참고한다.

공식 뷰어의 `카메라 → 게임 카메라`는 씬의 `spatial.camera`를 작성한다. 편집용 탐색 시점은 별도로 유지하고,
명시적인 현재 시점 적용·숫자 입력만 [spatial patch v5](public-api/authoring.md#hd-2d-spatial-placement-patch)의
`setCamera`로 저장한다. 게임 구도 확인은 실제 viewport/pixelArt를 사용하는 일시정지 미리보기이며,
camera-only patch도 기존 Undo/Redo·export·host 저장·다시 열기 계약을 따른다.

## 정적 GLB 배경 모델

`/core`의 `loadSpatialGlb(source, { materialProfile: "diffuse", signal? })`로 URL 또는 ArrayBuffer를
먼저 준비하고 `engine.registerDataSceneSpatialModel(id, asset)`로 등록한다. 반환 `SpatialModelAsset`은
불변 contentId(SHA-256)·bounds·primitiveCount·triangleCount·byteLength·diagnostics이며 geometry나 GPU handle을 노출하지 않는다.
`spatial.models`는 applied instance ID를 key로 사용하며 같은 instance를 billboard와 중복 연결할 수 없다.

```ts
const rock = await loadSpatialGlb("/models/rock.glb", { materialProfile: "diffuse" });
if (!engine.registerDataSceneSpatialModel("rock", rock)) throw new Error("model registration failed");
const models = { rockInstance: { asset: "rock", contentId: rock.contentId } };
applyDataSceneAuthoringDocument(engine, { ...document, spatial: { ...spatial, models } }, {
  spatialModelPreparer: renderer, // WebGL2Renderer: native 씬 교체 전에 모델 GPU 준비
});
```

- 자체 완결 GLB 2.0, 단일 embedded BIN, 선택 scene의 정적 TRIANGLES를 읽는다. POSITION/NORMAL은
  f32 VEC3, UV는 선택 f32 TEXCOORD_0이며 texture 사용 시 필수다. Blender에서는 UV/Normals를 내보내고
  normal map 사용 시 Tangents도 내보낸다. vertex color·animation·skin/morph는 제외한다. index는 unsigned 8/16/32-bit 또는 생략이다.
  node TRS/affine matrix를 합성하고 정점·inverse-transpose normal에 bake한다. pivot을 자동 중앙 정렬하지 않는다.
  mirrored/singular 변환, sparse/normalized accessor, skin/morph/animation·필수 확장·외부 URI는 거절한다.
- `OPAQUE`/`MASK` baseColorFactor/baseColorTexture, embedded PNG/JPEG와 glTF filter/wrap/mipmap sampler를 지원한다.
  `OPAQUE`는 factor alpha를 무시한다. 현재 diffuse subset에서 OPAQUE에 사용한 이미지의 alpha는 모두 255여야 한다.
  `MASK`는 image alpha × factor alpha가 `alphaCutoff` 이상인 fragment만 color/depth·point/sun shadow에 기록한다.
  cutoff는 기본 0.5이며 0 이상의 finite f32다. 0은 모든 fragment를 유지하고 1 초과는 모두 제거한다.
  양수가 f32에서 0으로 underflow하는 입력은 거절한다. 1 바로 위의 입력도 반올림으로 1이 되지 않도록
  정규화하며 cutoff는 보간하지 않는 primitive 값으로 main/shadow에 전달한다.
  `doubleSided`는 기본 false다. true이면 해당 primitive의 양면을 그리고 뒷면 조명 normal을 반전하며 그림자도 양면을 사용한다.
  재질 값은 GLB에 저장되며 instance마다 별도 레이어를 바꾸거나 정점을 양면 복제하지 않는다.
  base color texture는 sRGB, factor와 normal은 linear다. `diffuse`는 기존 조명으로 변환하는 명시적 프로파일이며
  metallic/roughness scalar를 PBR로 렌더링하지 않는다는 diagnostics를 반환한다.
- `normalTexture`는 linear RGB tangent-space normal이다. UV0와 f32 `TANGENT VEC4`가 필수이며
  자동 tangent 생성은 하지 않는다. Blender export에서 Tangents를 켜고 tangent가 없는 입력은 준비 전에 거절한다.
  tangent XYZ는 unit/normal과 직교, W는 ±1이며 한 triangle의 W가 섞인 입력도 거절한다.
  node의 inverse-transpose normal과 변환한 tangent를 정규직교화해 bake하며 root yaw도 함께 반영한다.
  bitangent는 `cross(normal, tangent.xyz) * tangent.w`다. `normalTexture.scale`은 기본 1,
  finite f32 -64..64이며 sampled normal의 X/Y에 곱한다. 0이면 정점 normal과 같은 조명을 사용한다.
  양면 뒷면에서는 normal map을 적용한 최종 normal을 반전한다. 공간 billboard의 기존 normal atlas 경로는 유지한다.
- `emissiveFactor`는 linear RGB 0..1, 기본 `[0,0,0]`이다. 선택 `emissiveTexture`는 UV0의 sRGB RGB를 사용하고
  alpha는 무시한다. texture가 없으면 factor 자체가 발광 색이다. diffuse 조명과 무관하게 더한 뒤
  기존 HDR 노출·톤 매핑·DOF·거리 안개를 적용하며 environment 없는 경로에도 표시한다.
  주변 사물을 밝히는 광원이나 GI로 변환하지 않는다. `KHR_materials_emissive_strength`의 finite 0..64 배율을 적용한다.
  `KHR_materials_unlit`은 base color/alpha만 표시하고 조명·발광을 무시한다. 두 확장의 같은 재질 조합은 거절한다.
  base/normal/emissive는 각각의 glTF sampler를 사용한다. 같은 이미지의 base/emissive GPU 자원은 공유하며
  두 renderer 색상 모드 모두 color는 sRGB8, normal은 RGBA8로 준비한다. 따라서 LINEAR 보간과
  mipmap 생성 전에 color가 linear RGB로 해석된다. normal과 color가 같은 이미지이면 별도 GPU texture를 사용한다.
  실제 복제 texture와 mipmap bytes도 resource stats에 포함하고 재질에서 참조하지 않는 image는 GPU에 올리지 않는다.
  BLEND·occlusion·metallic/roughness texture·texture transform은 후속이다.
- root 배치는 native entity XY와 heightSpan.elevation을 사용한다. 선택 `elevation`은 시각 offset(기본 0),
  `yawDegrees`는 Y-up 회전(-360..360, 기본 0), `scale`은 world units/meter인 양수 균일 배율(0.0001..10000, 기본 1)이다.
  Blender의 정상 Y-up glTF 출력에 Z-up 보정을 다시 적용하지 않는다. imported hierarchy는 정적 bake이며
  선택 native attachment는 아래 움직이는 묶음 계약을 따른다. native body yaw는 authored yaw에 더하며
  runtime scale 변경은 제공하지 않는다. inline components와 static/kinematic/생략 body를 허용한다.
- 충돌은 같은 instance의 기존 `components.collider` AABB와 `body.heightSpan`으로 명시한다. 이 proxy의
  크기·offset·높이는 **최종 world 단위**다. 모델 yaw/scale/시각 offset이 proxy를 자동 변형하지 않으므로
  일치하는 값을 작성한다. 삼각형 충돌·자동 보행층·모델 ray picking은 제공하지 않으며 지형 picking은 유지한다.
- 모델은 같은 camera/depth/HDR target에서 terrain/billboard와 가리고 point/sun cast/receive·DOF/fog에 참여한다.
  `castShadow`/`receiveShadow`는 기본 true다. native가 world bounds와 camera/light culling을 계산한다.
  TS는 공유 indexed GPU buffers와 decoded RGBA 자원을 관리하며 정적 정점을 매 frame 전송하지 않는다.
  같은 handle에 anchor한 world text도 공간 depth와 물리 elevation·시각 offset을 따른다.
  글꼴은 1 world unit/font pixel에 text scale을 적용하며 모델의 meter 배율로 확대하지 않는다.
- HTTP 입력은 최대 32 MiB의 연속 버퍼를 단계적으로 확장하며 작은 network chunk의 참조를 누적하지 않는다.
  제한은 파일 32 MiB/JSON 2 MiB, node 128/depth 32, bake 후 vertex 65,536/index 196,608, 소스 primitive 1,024(단일 mesh 256), 최종 재질 batch 32,
  image 16개/각 2048²/합계 8M pixels다. engine 등록은 asset 16개/CPU byteLength 합계 128 MiB,
  한 scene은 model instance 1,024개/제출 primitive 합계 4,096개/triangle 262,144개다. primitive/triangle은
  카메라 밖 모델도 포함한 입력 상한이다. 모델 shadow는 face당 최악 4,096 draw이며 기존 terrain/billboard
  face당 64와 별도 합산한다. 상한 통과는 실제 GPU frame time 보장이 아니다.
- `releaseDataSceneSpatialModel(id)`는 native binding이 남아 있으면 false다. 설정 해제/다른 document 적용 뒤
  release하며 engine destroy도 registry 참조를 해제한다. GPU 자원은 scene에서 참조가 사라진 다음 render 또는
  renderer destroy에서 해제한다. image decode는 `premultiplyAlpha: none` bitmap을 임시 WebGL2
  texture/FBO에서 읽어 alpha 0의 RGB·부분 alpha·행 방향을 보존한다. Canvas 2D 재출력을 거치지 않는다.
  이미지가 있는 GLB 준비에도 WebGL2가 필요하며 OffscreenCanvas 미지원 시 HTML canvas를 사용한다.
  각 이미지의 동기 readback 직후 texture/FBO·bitmap을 해제하고, 지원 시 임시 context도 lose한다.
  다음 async decode 전에 정리하므로 병렬 asset 준비에서도 GPU context를 여러 이미지에 걸쳐 유지하지 않는다.
  자원에는 CPU RGBA만 남고 caller renderer의 context/state는 사용하지 않는다.
- 기존 공간 진행 v6/v7의 stable authored ID·XY/heightSpan·physics enabled 상태를 재사용한다. asset/contentId·
  yaw/scale/시각 offset은 저장된 authoring document가 보존하며 GPU ID/bytes를 진행 상태로 저장하지 않는다.
  fresh engine에도 자원을 먼저 load/register해야 한다. 누락/다른 contentId와 잘못된 문서는 cold preflight에서 거절한다.
  GLB decode 실패도 활성 씬을 변경하지 않는다. capture도 native 모델 pose를 검사하여 GPU 변환 범위를
  벗어난 좌표를 복원 불가능한 저장 데이터로 반환하지 않는다. 모델의 영속 GPU 자원 upload는 첫 draw 시 수행한다.
  allocation/texture/buffer 업로드 오류 시 staging 자원을 회수하고 실패 자원을 캐시에 등록하지 않는다.
  upload 중 caller의 unpack row/skip·PBO 상태를 격리·복구하며 첫 upload에서만 WebGL 오류를 확인한다.
  실패의 후속 WebGL 오류도 제한된 횟수로 비워 정상 재시도가 이전 오류로 거절되지 않게 한다.
  null을 반환하는 texture/buffer/sampler 할당 실패도 오류 flag를 정리해 다음 정상 재시도를 막지 않는다.
  선택 GPU 준비 경로는 아래 계약을 사용한다. 기존 모델 없는 v5/v6/v7 포맷·hash 계약은 유지한다.

### 분리형 glTF 배경 모델

`loadSpatialGltf(source, { materialProfile: "diffuse", signal? })`와 `SpatialGltfOptions`를 `/core`에서 제공한다.
HTTP(S)의 `.gltf` JSON과 상대 경로의 `.bin`·PNG/JPEG를 미리 준비하고 기존 GLB와 같은 불투명
`SpatialModelAsset`을 반환한다. URI·이미지 표현의 기준은 [Khronos glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#uris)이다.
아래는 엔진이 지원하는 정적 subset이며 전체 glTF renderer나 Blender shader 호환을 뜻하지 않는다.

```ts
import { loadSpatialGltf } from "@ferrum2d/ferrum-web/core";
const house = await loadSpatialGltf("/models/house/scene.gltf", { materialProfile: "diffuse" });
if (!engine.registerDataSceneSpatialModel("house", house)) throw Error("model registration failed");
// 이후 models의 asset/contentId, 명시적 collider·보행면, GPU 준비와 저장은 GLB와 동일하다.
```

- document 최대 2 MiB, 외부 binary buffer 최대 16개, 이미지 최대 16개다. Fetch가 디코딩한 전체 고유 자원
  bytes(document 포함)와 정규화한 bundle은 각각 32 MiB 이하로 제한한다. 같은 URL은 한 요청 안에서 한 번만 읽는다.
  Content-Length 유무와 무관하게 stream을 검사하고 실패/취소 시 reader를 cancel·unlock한다.
  HTTP gzip/br 등의 Content-Length는 압축된 길이이므로 binary byteLength와 비교하지 않는다.
  CORS 응답은 Content-Encoding이 숨겨질 수 있어 Content-Length 사전 검사를 생략하고 실제 decoded stream 상한을 적용한다.
- root URL과 dependency는 HTTP(S)만 허용하고 userinfo·fragment는 거절한다. dependency는 document와 같은
  origin이어야 한다. 상대 경로·percent encoding·같은 origin의 절대 URL은 지원하며 redirect와 data/file/blob URI는
  이번 subset에서 지원하지 않는다. 서로 다른 origin의 CDN 파일은 하나의 asset origin에서 제공해야 한다.
- 외부 buffer byteLength는 실제 파일 길이와 같아야 한다. 모든 bufferView를 **원래 파일 범위**로 먼저 검사한다.
  여러 buffer를 4-byte 정렬로 병합한 뒤 view를 재배치하므로 다른 binary/image의 인접 bytes가 잘못된 view를
  유효하게 만들지 않는다. accessor/image의 bufferView 참조도 **원래 view 목록**에 대해 먼저 검사하므로
  외부 image를 위해 추가한 view가 잘못된 원래 참조를 유효하게 만들지 않는다. URI/bufferView를 동시에 지정한 image는 거절한다.
- external PNG/JPEG는 magic bytes로 MIME을 판별하고 명시한 mimeType과 일치하는지 검사한다.
  기존 bufferView image도 지원하며 2,048²/총 8M pixels·정적 mesh/재질/normal/tangent 한도는 GLB와 같다.
- 결과를 자체 포함 GLB로 정규화해 **기존 geometry·node bake·재질·이미지 디코더**로 넘긴다. `contentId`는 이
  정규화 bundle의 SHA-256이며 종속 binary/image bytes와 정규화에 남는 document 값을 포함한다.
  URL·전송 형식·JSON 공백만 달라져도 항상 다른 ID가 되는 raw document hash는 아니다. source URL을 진행 저장에 넣지 않는다.
- CPU load가 성공한 뒤 등록·authoring apply를 수행한다. 누락 파일/취소는 그 자체로 native 씬이나 renderer cache를
  변경하지 않는다. 변경된 contentId를 이전 authoring resource 참조에 적용하면 기존 preflight가 사전 거절한다.
  fresh engine 복원 전 stable ID로 자원을 다시 등록해야 한다. 저장에는 기존 asset/contentId·pose/proxy만 남기며
  네트워크 bytes·GPU handle·원본 glTF node hierarchy는 넣지 않는다.

네트워크를 stream으로 제한해 읽지만 실시간 geometry streaming/LOD는 제공하지 않는다. cold 준비 중 원본 자원·
정규화 bundle·기존 GLB 입력 사본이 일시적으로 함께 상주할 수 있다. 완료 후에는 기존 decoded CPU 자원만 유지한다.
실제 Blender 출력물 acceptance·추가 포맷/PBR·runtime parent graph는 별도다.

### 공유 모델 캐시와 preload 수명

`/core`의 `SpatialModelAssetCache`는 GLB/glTF를 여러 씬·청크에서 미리 준비할 때 쓰는 CPU 자원 캐시다.
같은 정규화 URL·명시적 format·선택 contentId revision의 요청은 한 번의 다운로드/디코딩과 같은 불투명
`SpatialModelAsset` handle을 공유한다. GPU cache도 기존 resource identity를 재사용할 수 있다.
소스별 형식·재질 제한과 HTTP 정책은 각각 기존 loader를 따른다. 별도 production 의존성은 없다.

```ts
import { SpatialModelAssetCache } from "@ferrum2d/ferrum-web/core";
const cache = new SpatialModelAssetCache({ maxEntries: 16, maxBytes: 64 * 1024 * 1024, maxPendingLoads: 2 });
const lease = await cache.acquire({
  url: "/models/house/scene.gltf", format: "gltf", materialProfile: "diffuse",
}, { signal: abortController.signal });
if (!engine.registerDataSceneSpatialModel("house", lease.asset)) {
  lease.release(); throw Error("registration failed");
}
// 기존 authoring apply/GPU 준비/저장 복원 경로를 사용한다.
// 씬에서 모델 사용을 끝내고 해당 engine 등록도 해제한 뒤:
if (!engine.releaseDataSceneSpatialModel("house")) throw Error("model still in use");
lease.release();
cache.evictUnused(); // 사용하지 않는 ready 항목만 제거한다.
```

- `maxEntries`는 pending 포함 기본 16/최대 64, `maxBytes`는 유지하는 decoded CPU 자원 합계의 기본/최대 128 MiB다.
  `maxPendingLoads`는 서로 다른 동시 다운로드·디코딩의 기본 2/최대 8이다. 상한은 양수 정수만 받는다.
  같은 요청을 기다리는 추가 소비자는 pending 슬롯을 더 쓰지 않는다. 한도를 넘는 새 요청은 큐잉 없이 거절하므로
  게임의 preload 계획에서 동시 요청을 제한하거나 재시도한다. engine 등록의 16개/128 MiB 한도는 별도다.
  취소한 로드도 실제 decoder/reader 정리가 끝날 때까지 동시 로드 슬롯을 유지한다. 반복 취소로 상한을 우회할 수 없다.
- URL은 1~16,384자 HTTP(S) 경로이며 credentials/fragment는 거절한다. 브라우저 상대 경로는 현재 document URL로
  정규화한다. contentId를 지정하면 loader가 반환하는 64자리 소문자 SHA-256 identity를 사용한다.
- `acquire(source, { signal? })`는 독립 lease를 반환한다. 한 소비자의 취소는 다른 소비자와 공유하는 로드를 중단하지 않는다.
  signal은 acquire 대기에 적용하며 이미 받은 lease는 자동 해제하지 않는다. 사용을 끝낸 호출자는 release해야 한다.
  마지막 대기자가 취소하면 내부 로드도 중단하고, 늦은 완료가 같은 key의 새 요청을 제거하거나 등록하지 못하게 한다.
  누락·디코딩·contentId 불일치·용량 실패 항목은 캐시에 남기지 않으며 다음 요청으로 재시도할 수 있다.
- lease가 있거나 acquire 대기자가 있는 항목은 제거하지 않는다. entry/byte 공간이 필요하면 최근 획득/해제 순서의
  오래된 idle 자원을 제거한다. 모두 사용 중이면 현재 lease를 보존하고 새 요청을 거절한다.
  byte admission은 필요한 idle 제거 목록을 먼저 검증한다. entry 슬롯 확보를 위한 idle 제거는 로드 시작 전에 일어날 수 있다.
- `lease.release()`는 멱등이며 이 lease의 `asset` 접근을 종료한다. 이후 접근은 거절한다. 다른 lease의 같은 handle은 유효하다.
  `evictUnused()`는 unused ready 자원을 모두 제거하고 개수를 반환한다. `destroy()`는 멱등이며 pending 대기자를 즉시 취소하고
  캐시 소유권을 제거한다. 이미 반환한 lease는 release 전까지 유효하고, destroy 뒤 acquire는 거절한다.
- `stats()`는 entry/pending load/대기 요청/active lease 수, 유지하는 decoded `byteLength`, eviction 수와 destroyed 상태를 반환한다.
  byteLength는 같은 handle의 여러 lease에 중복 청구하지 않는다. destroy 뒤 byteLength가 0이어도 외부 lease가 살아 있을 수 있다.
  원본·decoder 임시 사본, 캐시 밖 handle/engine 등록, GPU 자원은 이 CPU 캐시 예산에 포함하지 않는다.
  pendingLoadCount는 취소 후 정리 중인 작업도 포함하므로 destroy 직후에도 0보다 클 수 있다.
- URL 내용 변경을 자동 감지하지 않는다. versioned URL/새 contentId revision을 사용하거나 release 후 unused 항목을 제거해 다시 읽는다.
  contentId를 지정하면 실제 loader 결과와 일치해야 한다. format/revision이 다른 요청과 다른 URL은 별도 key다.

캐시는 native 씬을 교체하거나 engine 등록·GPU 자원을 해제하지 않는다. 모델을 사용하는 동안 lease를 보관하고,
씬/engine/GPU 수명은 기존 authoring·registration·preparer 계약으로 관리한다. 저장에는 캐시/lease를 넣지 않는다.
이는 spatial streaming의 자원 준비 기반이며 자동 청크 선택·동적 지형 활성화·geometry streaming/LOD를 제공하지 않는다.

## 정적 모델 로컬 proxy 묶음 배치

`/authoring`의 `addSpatialModelAssembly(document, assembly)`는 모델 원점 기준 로컬 AABB·보행면을
월드 좌표로 변환해 initial fragment에 추가한 새 `SceneAuthoringDocumentSpec`을 반환한다.
입력 문서는 변경하지 않는다. `SpatialModelAssemblySpec`와 `SpatialModelColliderProxy`도 공개한다.

```ts
import { addSpatialModelAssembly } from "@ferrum2d/ferrum-web/authoring";

const placed = addSpatialModelAssembly(document, {
  id: "house-a", x: 120, y: 32, elevation: 16, yawDegrees: 90, scale: 1.25,
  model: { asset: "building", contentId: building.contentId },
  colliders: [{ id: "wall", x: 46, y: 96, halfWidth: 2, halfDepth: 32,
    elevation: 32, height: 48, floorId: 1 }],
  terrain: [
    { id: "ramp", x: -16, y: 32, width: 32, depth: 32,
      elevation: 0, endElevation: 32, kind: "ramp" },
    { id: "upper", x: -48, y: 64, width: 96, depth: 64,
      elevation: 32, baseElevation: 24, kind: "bridge", floorId: 1 },
  ],
  connections: [{ from: "ramp", to: "upper" }],
  children: [{
    id: "sign", x: 0, y: 12, elevation: 48, yawDegrees: -90, scale: 0.5,
    model: { asset: "sign", contentId: sign.contentId },
  }],
});
```

로컬 ground XY·위쪽 elevation은 GLB의 X/Y-up/-Z와 대응한다. GLB 내부 node 변환은 import 때
이미 bake되어 있으므로 다시 적용하지 않는다. 위치·높이와 단일 양수 `scale`(기본 1, 0.0001~10000)을
모델·collider 크기·높이·보행면 모두에 적용한다. `yawDegrees`는 기본 0이며 -360~360이다.
보행면이 있는 묶음은 최종 world yaw가 90도 배수여야 한다. 일반 각도 collider는 OBB를 생성하며
카메라 표현뿐 아니라 native sweep·길찾기도 실제 회전 박스를 검사한다. pitch/roll·비균일/음수 배율은 지원하지 않는다.
`floorId`는 기본 0인 **전역 층 번호**이며 배치 때 자동 변경하지 않는다.

root instance ID는 `id`, collider ID는 `id/colliders/localId`, terrain ID는 `id/terrain/localId`,
생성 prefab은 `id/prefab`이다. 각 입력 ID는 1~128자, collider·terrain은 각각 최대 256개다.
문서 전체의 모델 1,024개·지형 256개 제한도 적용한다. 중복 ID·동일 층 지형 겹침·잘못된 연결·
숫자 범위 오류는 결과를 반환하기 전에 거절한다. 로컬 지형은 로컬 좌표에서 정규화한 뒤
최종 월드 위치/크기와 그 합을 f32로 반올림한 경계로 겹침·연결을 검증한다. JS double의 미세한
겹침을 실제 native 겹침으로 오판하지 않으며, f32에서 폭/깊이가 소실되는 배치는 activation 전에 거절한다.
반올림 뒤에도 실제로 겹치거나 떨어진 면을 임의 허용하는 tolerance는 추가하지 않는다. collider는 투명 visual과 static AABB 또는 OBB/heightSpan을 가진다.
지형은 항상 `render:false`이며 로컬 `render:true`·texture·shadow 활성은 거절한다.
결과는 기존 Scene Composition·spatial 데이터로 이루어져 JSON 저장·복원과 prefab/include 사용을 유지한다.
결과 문서는 기본 composition transform과 initial fragment로 적용한다. 다른 전역 fragment transform은
world-unit spatial 지형을 함께 변환하지 않는다.

선택 `children`은 같은 `SpatialModelAssemblySpec`의 배열이며 생략 시 빈 배열이다.
자식의 XY·높이는 부모 원점 기준이고 부모의 yaw·scale을 적용한다. 자식 yaw는 더하고 scale은 곱해
모델과 모든 proxy에 같은 월드 변환을 적용한다. 자식 자체의 scale은 부모 기준 위치 offset에는 적용하지 않는다.
각 노드의 로컬 scale과 합성한 월드 scale 모두 0.0001~10000이어야 하며, 자식의 월드 yaw는
0/90/180/270도로 정규화한다. 자식 ID는 `parentId/children/localId`이고 그 아래 collider·terrain·prefab도
같은 namespace를 사용한다. 완성된 자식 ID도 최대 128자다. 다른 부모 아래에서는 같은 로컬 ID를 재사용할 수 있다.
`floorId`는 자식에서도 전역 번호이며 부모로부터 상속하거나 자동 변경하지 않는다. 각 노드의 connection은
그 노드의 로컬 terrain ID만 참조한다. 노드마다 model은 필요하며 GLB 내부 node 이름과는 무관하다.
asset·castShadow/receiveShadow는 각 노드의 model 설정을 사용하며 부모 설정을 상속하지 않는다.

한 호출은 root 포함 최대 64개 assembly, root 포함 최대 깊이 8, 노드당 최대 63개 children을 허용한다.
순환 참조·중복 완성 ID·잘못된 자식·합성 overflow를 거절하며 기존 문서의 모델/지형 제한도 함께 적용한다.
모든 자식을 추가한 뒤 완성된 Scene을 검증하므로 자식 terrain이 actor의 보행면을 제공할 수 있다.
실패 시 입력 문서와 원본 계층은 변경하지 않는다. 동일한 자식 정의 객체를 다른 부모 아래에 재사용하는 것은 순환이 아니다.
colliders·terrain·connections·children 배열의 기본값은 생략할 때만 빈 배열이다. `null`이나 빈 칸이 있는
배열은 충돌체/연결을 조용히 누락시키지 않고 거절한다. 변환된 collider는 중심·크기 각각의 f32 유효성뿐
아니라 실제 `center ± halfExtent` 경계·전체 폭/깊이·`elevation + height` 구간도 유한하고 양수여야 한다.
큰 좌표에서 두 경계가 같은 f32 값이 되거나 높이가 소실되는 배치는 native 적용 전에 거절한다.

배치는 authoring 시점에 한 번 계산한다. 원본 assembly는 게임 제작 코드/데이터에서 보관하고 배치를
바꿀 때 원본 문서에서 다시 생성한다. 이후 native model 위치만 변경해도 proxy가 따라가는 runtime
parent graph는 제공하지 않는다. 진행 저장에는 생성된 일반 Scene JSON과 native model pose를 사용하며
assembly 입력이나 메시/GPU bytes를 별도로 직렬화하지 않는다. 저장 포맷 버전은 바뀌지 않는다.
`children`도 작성 입력에만 존재한다. 저장한 일반 Scene JSON은 합성된 위치·높이·yaw·scale과
안정된 전체 ID를 보존하지만 원본 부모 관계를 복원하지 않는다. 계층 편집에는 원본 assembly를 사용한다.

`SpatialTerrainSurface.rampAxis?: "x" | "y"`는 `kind:"ramp"`에만 허용된다. 기본은 Y이며 생략한
기존 문서는 필드/해시를 유지한다. X ramp는 x→x+width, Y ramp는 y→y+depth를 따라
`elevation`→`endElevation`으로 변한다. 90/270도 배치에서는 축을 교환하고 음의 방향이면 양 끝 높이를
뒤집는다. native 물리·층 연결·길찾기 추종·mesh/picking/debug는 같은 축을 사용한다.
기존 11-float/4-u32 cold terrain layout에서 bit 5를 사용하며 독립
`spatial_ramp_axis_abi_version() === 1` capability가 없는 Wasm은 X ramp를 씬 활성화 전에 거절한다.
기존 render buffer/물리 높이·surface proxy v1 ABI는 유지한다.
공간 보행면은 최소 경계를 포함하고 최대 경계를 제외하는 `[min,max)` 소유 규칙을 사용한다.
음의 방향으로 정확히 경계에 도착할 때 인접 아래층 surface를 잘못 선택하던 문제를 수정했다.
일반 tilemap query의 기존 경계 규칙은 유지한다. 정확한 cardinal model yaw도 삼각함수 잔차 없이
계산해 큰 배율에서 축 정렬 proxy와 일치시키며 근접한 일반 각도는 스냅하지 않는다.

## 모델 GPU 준비 후 활성화

평면 frame 사이 또는 frame 완료 직전에 commit된 새 모델 준비는 이전 flat frame 정리에서 보존한다.
실제 다음 flat frame에도 사용하지 않으면 해제하며, 모델 제출 뒤에는 공간 VAO의 index binding을
비워 cold commit으로 제거한 buffer를 다음 upload에서 다시 bind하지 않는다.

`applyDataSceneAuthoringDocument(engine, document, { spatialModelPreparer: renderer })`는
`WebGL2Renderer.prepareSpatialModels(assets)`를 CPU/content/pose 검증 뒤, 기존 씬·progress context를
교체하기 전에 호출한다. 원본 문서에는 callback/renderer를 저장하지 않는다. 옵션 생략 시 기존 첫 draw 업로드를 유지한다.

모든 모델의 texture·vertex/index buffer·sampler와 기본 공간 geometry shader를 동기 준비하고
WebGL 할당/업로드 오류를 확인한다. 한 모델이라도 실패하면 이번 batch의 새 자원 전부를 회수하고
기존 모델 GPU 자원·entity handle·playing/paused 상태·저장 context를 유지한다. 모델 준비는 framebuffer에 그리지 않는다.
실패 후 정상 재시도도 지원하며 caller의 active texture/texture 0, ARRAY/ELEMENT buffer·VAO element binding,
unpack/PBO·row/skip 상태를 복구한다. entity별 Wasm 호출이나 simulation 복제는 추가하지 않는다.

`/core`와 `/authoring`의 `SpatialModelPreparer`는 opaque `SpatialModelAsset[]`만 받는다.
반환 `SpatialModelPreparation`의 `uploadBytes`는 이번 준비의 CPU→GPU 전송량이며 mipmap 보관량은
renderer resource stats에서 확인한다. `commit()`은 준비한 자원을 활성 cache로 채택하고 이전 참조를 해제한다.
`dispose()`는 미commit 자원을 취소하며 반복 호출할 수 있다. commit/취소/destroy 뒤 stale commit과
같은 renderer의 중복 pending 준비는 거절한다. 수동 호출자는 반드시 commit 또는 dispose해야 한다.
authoring 경로는 native 설정 성공 뒤 commit하고 finally에서 dispose한다. 성공한 준비에서 생성한
기본 공간 pass/shader·64 KiB 모델 행렬 buffer는 renderer 수명의 cache로 유지하며, lease 취소는 모델 staging 자원을 해제한다.

pending 자원도 resource stats에 포함하며 준비 중에는 기존/신규 자원이 함께 상주한다. 새 자원 할당 실패 시
기존 cache를 먼저 비우지 않는다. cache는 엔진별 숫자 ID 대신 불변 CPU 자원 identity를 사용해
같은 asset을 새 engine ID로 복원해도 재업로드하지 않는다. 성공한 장면의 첫 render부터 modelUploadBytes는 0이며,
사전 전송량은 preparation.uploadBytes로 별도 측정한다. 정상 프레임에는 오류 polling을 추가하지 않는다.

fresh restore에서도 `dataSceneAuthoringApplyOptions: { spatialModelPreparer: renderer }`를 전달할 수 있다.
CPU 자원은 새 엔진에 미리 등록해야 한다. 모델 GPU 준비 실패는 기존 씬과 저장 context를 보존하며,
preparer 객체·GPU lease는 JSON/progress hash에 포함하지 않는다. 저장 버전과 native/frame ABI는 유지한다.

보호 범위는 **모델 GPU 준비 실패**다. environment HDR/shadow FBO·postprocess target·동적 frame buffer의
첫 렌더링 할당과 runtime context loss, custom texture/component callback 또는 native 적용 전체의 rollback을
보장하지 않는다. 준비 lease를 유지한 채 renderer를 파괴하거나 apply 중 재진입하는 callback도 지원하지 않는다.
이 범위를 넓히는 전체 scene GPU transaction은 별도 후속이다. GPU 실행 완료를 기다리는 fence API는 아니다.

독립 `spatial.models` buffer v1은 80-byte `repr(C)` record다. u32 asset ID/flags/visibility mask/reserved와
f32 column-major model matrix 16개를 bulk 소비한다. camera bit 0, point face bits 1..6, sun bit 7이며
미제출 instance도 자원 수명 참조로 유지한다. 기존 44-byte 정점과 shadow source 0/1 ABI는 바꾸지 않는다.
renderer도 record의 typed-array 형식과 실제 참조 geometry의 scene primitive/triangle 한도를 GPU 작업 전에 검사한다.
`RendererStats.spatial`의 modelCount/visibleModelCount/modelDrawCalls/modelTriangleCount/modelUploadBytes는
실제 모델 제출·정적 geometry/image 업로드이며 전체 draw/triangle/upload와 GPU resource stats에도 합산한다.
`modelInstancedDrawCalls`는 main pass에서 실제 실행한 인스턴싱 draw 수이고 `modelDrawCalls`에 포함된다.
`modelInstanceUploadBytes`는 main 및 재계산한 shadow pass의 동적 행렬 전송량이며 전체 `uploadBytes`에도 포함한다.
기존 `shadowUploadBytes`는 terrain/billboard caster 정점 전송량이다. 정적 자원의 warm `modelUploadBytes=0`과
동적 행렬 비용을 구분한다.

WebGL2는 pass별 native visibility mask로 제외한 뒤, 같은 불변 CPU resource와 main receiveShadow 설정을 가진
연속 모델을 인스턴싱한다. 서로 다른 자원의 제출 순서를 재정렬하지 않는다. 한 모델만 남으면 기존 uniform/draw 경로를
사용한다. 여러 primitive의 순서는 모델별 순회에서 primitive별 인스턴싱 순회로 바뀌므로 완전히 겹친 coplanar 면의
동점 소유권은 보장하지 않는다. 모델은 기존 OPAQUE/MASK 범위이며 반투명 정렬 기능은 추가하지 않는다.
renderer 수명에 64 KiB 행렬 buffer 하나와 CPU staging을 예약해 재사용한다. geometry/texture는 개체 수와 무관하게
공유하고 매 pass의 visible instance당 64 bytes를 전송한다. shadow cache hit에는 shadow 행렬 업로드가 없다.
1,000개 1-primitive 바위의 main draw는 1회, warm asset 전송은 0, 동적 행렬은 64,000 bytes다.
확장 입력 한도는 cold native batch capability v1을 확인하며, 구 Wasm에는 기존 64 instance/64 primitive 범위만 적용한다.
80-byte draw ABI·저장 버전·모델 자원 등록 한도는 그대로다.
renderer에 직접 전달하는 모델 packet도 실제로 참조하는 서로 다른 CPU 자원 16개·`byteLength` 합계 128 MiB를
모델 자원의 GPU 업로드 전에 검사한다. 미참조 handle은 업로드하지 않으며 같은 CPU 자원의 숫자 ID 별칭은 공유로 계산한다.
동일 CPU 자원의 재질/geometry 검증은 프레임당 한 번 수행하며 모든 instance의 행렬·메타데이터와 제출 예산은
개별 검사한다. 프레임 간 검증 생략이나 GPU cache 수명 연장은 하지 않는다. native output 공간은 설정 단계에서
예약해 첫 렌더 프레임의 개체 수 증가에 따른 buffer 재할당을 피한다.
CPU model vertex는 normal map이 없으면 XYZ/UV/normal 8 floats, 있으면 tangent XYZW를 추가한 12 floats다.
이는 TS asset 내부 포맷이며 native instance ABI와 terrain/billboard의 44-byte 포맷은 유지한다.

`examples/data-scene-native/assets/rock.glb`는 자체 제작한 8-triangle 검증 fixture다. 실제 Blender 프로젝트
출력물의 외관 검증을 대신하지 않는다. packed browser gate는 캐릭터 가림·shadow flag·AABB 차단/아래 통과·
높이 matrix·fresh engine 전체 픽셀 일치·실패 원자성·자원 해제를 검사한다.
`tree.glb`는 opaque 줄기와 MASK/양면 잎 2개 primitive·14 triangles의 자체 검증 fixture다.
`node tests/smoke/generate-spatial-tree-fixture.mjs`로 같은 파일을 재생성할 수 있다. 잎의 alpha 0/128/255,
factor alpha·cutoff 동등 비교, 앞/뒷면 조명·깊이와 point/sun shadow 구멍, 줄기 AABB와 fresh restore를 검사한다.
`tree-material.glb`는 같은 나무에 exported tangent·normal/emissive texture를 추가한 자체 검증 fixture다.
`node tests/smoke/generate-spatial-material-fixture.mjs`로 재생성한다. alpha 0의 normal/emissive RGB,
scale 0·handedness·양면 normal, 발광의 조명 독립성·HDR/fog·두 renderer 색상 모드와 LINEAR 색 경계,
point/sun MASK shadow·unit 4 state 복구·fresh restore 픽셀 일치·자원 해제를 검사한다.
`building.glb`는 열린 문·상층 바닥·경사로·벽을 가진 자체 제작 8 primitive/96 triangles fixture다.
`node tests/smoke/generate-spatial-building-fixture.mjs`로 재생성한다. imported node 계층은 정적으로 bake하고,
SceneComposition `include`의 `idPrefix`로 모델/벽 proxy assembly를 작성한다. 보행면은 `render:false`인
terrain 6개와 ramp→upper 연결, 벽은 층/높이가 있는 별도 world-unit AABB로 명시한다.
fragment 변환이 전역 terrain이나 모델 yaw/scale·충돌 proxy를 자동 동기화하지 않으므로 이 fixture는
identity assembly transform을 사용한다. 일반 runtime parent hierarchy는 후속이다.
같은 actor의 문 통과·층 이동과 상층 벽 차단/아래 통과, 모델 depth·point/sun 그림자, 직교/원근 picking,
목적지 이동·fresh v7 복원 픽셀 동일성·collision 유지와 GPU buffer 해제를 packed gate에서 검사한다.
`spatial-model-preparation-browser-fixture.mjs`는 texture/buffer/sampler/실제 업로드 오류 4종과
cold shader/pipeline allocation 실패를 주입한다. 기존 handle·paused·snapshot hash·framebuffer·GPU 수와
caller GL state 유지, 전체 batch 회수·재시도, 첫 render 10 draw/110 triangles·model upload 0,
fresh engine의 다른 numeric ID에서 재업로드/픽셀 차이 0, cancel/stale/destroy 해제를 같은 packed gate에서 검사한다.
재질 해석은 [glTF 2.0 additional textures·tangents 규격](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#additional-textures)과
[glTF 2.0 alpha coverage·double sided 규격](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#alpha-coverage)을 기준으로 한다.

## 좌표·지형과 이동

simulation의 `x/y`는 지면 좌표이고 `elevation`은 위쪽 높이다. 렌더 축은
`(x, elevation, -y)`이며 world 단위는 지면과 높이에서 동일하다. `floorId`는 이동/충돌 구역이고
가림은 실제 geometry depth로 결정한다. 층별 수동 layer 전환은 필요 없다.

각 terrain surface의 계약은 다음과 같다.

| 필드 | 계약 |
| --- | --- |
| `id` | 중복 없는 비어 있지 않은 문자열, picking의 stable identity |
| `x`, `y`, `width`, `depth` | 사각 footprint. 크기는 양수이며 좌표/끝점은 유한 f32 |
| `elevation` | 앞쪽(`y`) 윗면 높이 |
| `endElevation` | 뒤쪽(`y + depth`) 윗면 높이. 기본 `elevation`, ramp만 다른 값 허용 |
| `baseElevation` | 바닥면 높이. 기본 `min(0, elevation, endElevation)`, 양 끝 윗면 이하 |
| `kind` | 기본 `flat`, 또는 `stair`, `ramp`, `bridge`. 계단 한 칸은 한 surface |
| `floorId` | 기본 0, 정수 0..65535 |
| `walkable` | 기본 true. false는 진입을 막는 높이 volume으로 컴파일 |
| `render` | 선택 boolean, 기본 true. false이면 물리·보행·picking·debug만 유지하고 color/depth·그림자 제출에서 제외 |
| `color` | 기본 `[0.6, 0.65, 0.7, 1]`, 채널 0..1, alpha=1. renderer 작업 색 공간의 RGB |
| `textureId` | 선택 numeric asset texture id 0..16777214, 생략하면 단색 |

GLB 바닥과 같은 위치의 보행면은 `render: false`로 작성해 중복 면의 깊이 충돌을 막는다.
이 경우 `textureId`와 true인 `castShadow`/`receiveShadow`는 거절하고 shadow flags를 false로 정규화한다.
카메라 클릭은 계속 authored 사각 보행면을 판정하므로 GLB의 실제 높이·footprint와 맞춰 작성한다.
모델 삼각형 자체의 raycast/충돌을 생성하는 기능은 아니다. `render`를 생략한 과거 문서에는 필드를 주입하지 않아
기존 저장 hash를 유지한다. 새 필드를 쓰는 문서는 대응 JS/Wasm을 함께 설치해야 한다.

최대 256개 surface를 지원하며 같은 floor의 footprint 겹침은 거절한다. 서로 다른 floor는 겹칠 수 있다.
한 원천에서 윗면·옆면·아랫면의 12개 삼각형과 기존 native tile height metadata를 만든다.
텍스처 UV는 각 면의 0..1이다. 다각형 보행 지형·mesh 모델링 API는 제공하지 않는다. 정적 배경 mesh 입력은 위 GLB 경로로 제한한다.

`spatial.actor`는 선택적인 native WASD 이동 설정이다. 최대 step/drop 높이를 적용하고 이동 중
같은 entity의 `heightSpan.elevation`을 갱신한다. 목적지 기반 평면 navigation과 동시 구동하지 않으며
spatial actor 설정 시 기존 route를 취소한다. 이 controller가 설정되어 있으면 `moveDataSceneActorTo`
요청은 false다. 아래 명시적 `connections`를 통과할 때만 floor를 자동 전환한다.
연결되지 않은 다리 위·아래는 작성한 floor를 유지한다. 공간 목적지 이동은 아래 별도 API를 사용한다.

낮은 빈도 직접 이동은 `engine.moveDataSceneSpatialBody(handle, dx, dy, { maxStepHeight, maxDropHeight })`다.
enabled kinematic body, heightSpan, 단일 enabled non-trigger AABB가 필요하다.
true는 유효한 요청을 처리했다는 뜻이며 장애물로 일부만 이동할 수 있다. 높이 query와 이동 계산은 Rust가 소유한다.
기존 rigid-body solver의 자동 stepping/별도 velocity로 같은 actor를 중복 구동하지 않는다.

### 지형 연결과 자동 층 전환

`DataSceneSpatialSpec.connections?: readonly SpatialSurfaceConnection[]`은 선택 항목이다.
각 `{ from: string, to: string }`은 terrain의 stable surface ID를 참조하는 **양방향** 연결이다.
예를 들어 `connections: [{ from: "ramp", to: "bridge" }]`로 경사로 끝과 다리를 연결한다.
생략/빈 배열은 연결 없음이며 정규화 결과에도 빈 필드를 추가하지 않는다.

- 최대 256개 연결이다. 양 끝은 walkable이며 서로 다른 floor여야 한다. 같은 floor의 인접 이동은 연결 없이 기존 규칙을 따른다.
- 두 사각형은 f32로 컴파일된 좌표에서 길이가 양수인 동일 경계를 공유해야 한다.
  떨어진 지형, footprint 겹침, 모서리만 닿는 연결은 거절한다. 좌표를 자동 보정하거나 층을 높이로 추정하지 않는다.
- 중복/역방향 중복과 같은 출발 경계 구간에 목적지 층이 둘 이상인 모호한 연결은 activation 전에 diagnostic으로 거절한다.
  native도 bulk u32 ID pair를 검사하고 새 scene 전체를 검증한 뒤 교체한다.
- 같은 kinematic entity의 collider center가 실제 경계를 넘을 때 source support와 native 높이가 일치해야 한다.
  AABB가 공유 경계 폭 안에 들어가야 하고 도착 높이 차이는 `maxStepHeight`/`maxDropHeight` 이하여야 한다.
- 짧은 이동 구간을 source floor와 destination floor 양쪽의 collision filter·heightSpan으로 각각 검사한다.
  처음/끝에 solid와 겹치는 경우도 거절한다. 한쪽이라도 통과하지 못하면 해당 substep의 XY/floor/elevation을 복구한다.
  앞선 substep의 유효한 이동은 유지하므로 반환 true는 도착 보장이 아니다.
- 작은 경계 이동도 실제 XY가 목적지 내부로 넘어간 뒤에만 floor를 바꾼다.
  한 substep이 대각선으로 중간 지형을 지나 두 연결을 건너뛰면 그 substep을 거절한다. 입력을 나눠 이동할 수 있다.

WASD spatial actor와 `moveDataSceneSpatialBody` 모두 같은 native 연결을 사용한다.
entity ID/generation·body height는 유지하고 floor/elevation·billboard/label/debug 높이가 함께 갱신된다.
terrain revision·static mesh·render packet v2·기존 평면 ABI는 바뀌지 않는다. 이동 중 string/개체별 JS 왕복은 없다.

`connections`는 authoring document와 함께 JSON 저장되고 v6 progress는 전환 뒤의 실제 floor/elevation을 저장한다.
fresh engine restore에서 연결을 다시 구성하므로 역방향 이동도 이어진다. 별도 progress version은 추가하지 않는다.
연결을 지원하지 않는 과거 Wasm으로 nonempty 연결을 직접 configure하면 false이며 조용히 무시하지 않는다.
연결 없는 설정은 기존 raw configure 경로를 유지한다. 개발 소스에서 generic stair/ramp 추론으로 연결 없이
다른 floor로 바뀌던 경로는 차단한다. 의도한 cross-floor 이동은 명시적 연결로 작성한다.
낮은 수준 terrain 교체 성공 시 연결은 제거하며 실패 시 기존 terrain/연결을 모두 유지한다.
one-way/teleport/overlap portal, 임의 collider·3D vertical sweep는 이번 계약에 포함하지 않는다.

## 목적지 기반 다층 이동

`moveDataSceneSpatialActorTo(options: SpatialMoveOptions)`는 설정된 `spatial.actor` 한 개를 대상으로 한다.
Rust가 같은 floor의 인접 surface와 명시적 층 연결을 탐색하고, 기존 native 충돌·step/drop 검사를 통과한 경로를 추종한다.
목적지 `x/y`는 entity origin이며 collider offset을 반영해 실제 support를 찾는다. `floorId`는 필수다.
같은 XY라도 다른 floor는 도착으로 처리하지 않고 연결된 경로로 이동한다.

```ts
const accepted = engine.moveDataSceneSpatialActorTo({
  x: hit.x, y: hit.y, floorId: hit.floorId, speed: 96,
  cellSize: 8, arrivalRadius: 0.5, cancelOnInput: true,
});
const status = engine.dataSceneSpatialMoveStatus();
const stats = engine.dataSceneSpatialMoveStats();
// engine.cancelDataSceneSpatialMove();
```

| 옵션 | 계약 |
| --- | --- |
| `x`, `y` | 유한 f32 entity-origin 지면 좌표 |
| `floorId` | 목적지 support floor, 정수 0..65535 |
| `speed` | 양수 f32, world units/second |
| `cellSize` | 양수 f32, 기본 8. 지면 격자 간격 |
| `arrivalRadius` | 0 이상 유한 f32, 기본 0.5. 마지막 waypoint의 같은 surface/floor에서만 적용 |
| `cancelOnInput` | 기본 true. WASD가 같은 update에서 경로를 취소하고 수동 이동을 시작. false면 이동 중 WASD 무시 |

`true`는 경로를 설치했다는 뜻이다. 일시정지 중 요청할 수 있고 재개 후 이동한다. 잘못된 JS 옵션은
`spatial.move` diagnostic, 도달 불가·unsupported actor·예산 초과는 false다. 실패한 새 요청은
기존 route/status와 actor XY/span/velocity를 보존한다. 탐색은 시뮬레이션 tick·collision event를 발생시키지 않는다.
경로 이동 중 실제 native collision을 다시 검사하며, 새 장애물로 막히면 `blocked`로 멈춘다.
자동 재탐색은 하지 않는다. 게임이 새 요청을 보내 우회 경로를 계산한다. 높이와 billboard/label 및 기존 primary-actor 걷기/idle 애니메이션은 함께 갱신한다.

entity AABB의 접촉 검사는 native sweep과 같은 f32 최소/최대 모서리를 비교한다. 소수 크기의 모델
proxy 표면에 수동 이동으로 멈춘 뒤에도 접선 방향이나 바깥쪽 목적지로 이동할 수 있다. 경로 요청은
actor 위치를 보정하지 않으며, 모서리가 실제로 겹치는 시작/목적지는 거절하고 장애물 안쪽 이동은 계속 차단한다.
고정 epsilon으로 작은 겹침을 허용하지 않고 collider offset·floor/height 필터를 유지한다.

`dataSceneSpatialMoveStatus()`는 `idle | moving | arrived | blocked | cancelled`이며 Data Scene 밖에서는 undefined다.
`cancelDataSceneSpatialMove()`는 진행 중 route를 취소했을 때만 true다. actor 직접 이동·외부 teleport/span 변경·
유효하지 않은 body는 진행 경로를 취소한다. 다른 entity의 직접 이동은 취소하지 않는다.
terrain/billboard/actor 재설정은 route를 취소하고 전체 spatial configure/clear·scene reset·진행 복원은 idle로 초기화한다.
route/waypoint/탐색 통계는 저장하지 않는다. 기존 공간 v6 pose를 복원한 뒤 새 요청을 보낸다.
평면 `moveDataSceneActorTo`와 spatial follower를 동시에 구동하지 않는다. 카메라 변경은 경로에 영향을 주지 않는다.
과거 Wasm에 새 raw method가 없으면 요청/취소는 false, 상태/통계는 undefined다. render ABI와 authoring version은 유지한다.

탐색은 결정적 4방향 XY 격자 A*다. 같은 surface의 직접 이동은 먼저 검사한다.
격자 node 최대 4,096개(+정확한 시작/목적지 2개), edge probe와 대기 heap 최대 32,768개다.
추가로 native sweep/substep·proxy 정렬 비용을 보수적으로 추산해 요청 8,000,000 work units,
frame 1,000,000 work units와 follower 최대 64회 iteration으로 제한한다. work units는 CPU/GPU ms가 아니다.
탐색 요청/추종 frame 안에서 target AABB bounds를 한 번 준비·정렬하고 native sweep/overlap에 재사용한다.
다음 요청/frame에는 다시 준비하므로 동적 장애물 변경을 반영하며, ordinary 수동 이동에 snapshot을 남기지 않는다.
준비 비용은 alive 순회·target 정렬, 반복 probe 비용은 enabled target AABB 수·surface 수·substep과
candidate 정렬에 근거한다. collider 없는 장식 entity는 최초 순회 비용에만 포함한다.
한 frame의 준비와 최소 이동조차 실행할 수 없는 요청은 미리 거절하고, 수락 뒤 비용이 증가하면 follower는 blocked로 멈춘다.
미세 속도는 f64 잔여 이동량을 다음 frame으로 이어가고 실제 변위만 차감한다.
경사면에서는 현재/목적지 surface의 기울기와 step/drop 허용량으로 추종 조각 길이를 추가 제한한다.
전체 격자 edge의 분할 검사는 통과했지만 짧은 frame 조각의 높이 변화가 더 커져 멈추는 경우를 방지한다.

`dataSceneSpatialMoveStats(): SpatialMoveStats | undefined`는 낮은 빈도로 읽는 진단이다.
`searchNodeCount`(확장 node), `edgeProbeCount`, `probeWorkUnits`는 마지막 native 요청 시도,
`waypointCount`/`remainingWaypointCount`는 설치한 경로, `searchCount`는 현재 공간 설정의 누적 탐색 횟수다.
새 요청은 시도 통계를 초기화하고, 실제 탐색을 시작하면 `probeWorkUnits`에 준비 비용도 포함한다.
입력/actor/최소 frame 예산 사전 거절은 searchCount를 늘리지 않는다. frame 추종도 검색 횟수를 늘리지 않는다.

새 Wasm의 optional 진단 확장이 있으면 `lastRequest`를 함께 반환한다. 구 Wasm에는 이 필드가 없다.

| `lastRequest` 필드 | 의미 |
| --- | --- |
| `status` | `notRequested`, `accepted`, `invalidRequest`, `unsupportedActor`, `noPath`, `nodeBudgetExceeded`, `probeBudgetExceeded`, `workBudgetExceeded`, `frameBudgetExceeded` |
| `count` | native 요청 횟수. 탐색 전 거절도 포함하며 JS 옵션 검증에서 throw한 요청은 제외 |
| `collisionProxyCount` | 준비한 enabled target AABB 수. actor·terrain은 제외하고 narrow phase의 기존 trigger/filter/height 판정은 유지 |
| `preparationWorkUnits` | 최초 순회·정렬 비용. 탐색 시작 시 probeWorkUnits에 이미 포함되므로 합산하지 않음 |

`noPath`는 선택한 격자에서 경로를 찾지 못했다는 뜻이며 연속 공간에서 불가능하다는 증명은 아니다.
예산 거절 시 기존 route가 moving이어도 `lastRequest.status`는 해당 거절 사유다. `waypointCount`를
실패한 새 요청의 부분 경로로 해석하지 않는다. 구 raw 통계의 6개 u32 layout은 유지하며 새 진단은
독립 v1 `[version, status, count, collisionProxyCount, preparationWorkUnits]`의 5개 u32로 전달한다.
알 수 없는 진단 version/status는 생략하고 기존 통계는 읽는다. 경로·진단은 진행 저장에 추가하지 않는다.

전체 지형 격자가 너무 크거나 통로가 선택한 격자보다 좁으면
물리적으로 가능한 경로도 false일 수 있다. 적절한 cellSize/지형 분할을 선택한다.
navmesh·대규모 streaming·복수 actor 목적지 이동·자동 replan은 현재 범위 밖이다.

## Camera와 화면 클릭

`position`과 `target`으로 카메라 방향·기울기를 지정한다. 수직축은 고정이며 roll은 없다.
수평 바라보기 방향이 0인 카메라는 거절한다. 직교는 `height`(기본 240), 원근은
`fovDegrees`(기본 45, 1..170)를 사용한다. near 기본 0.1, far 기본 10000이며 far > near다.
aspect는 native viewport에서 frame마다 갱신된다. DPR은 물리 높이를 바꾸지 않는다.

```ts
import { createDataSceneSpatialView } from "@ferrum2d/ferrum-web/core";
const view = createDataSceneSpatialView(engine, canvas);
engine.setDataSceneSpatialCamera(camera, renderer.viewportSize());

// frame은 실제로 표시한 renderCommandBuffer.spatial이다.
const screen = view.project({ x: 80, y: 108, elevation: 64 }, frame);
const hit = view.pick({ x: event.clientX, y: event.clientY }, frame);
// hit: surfaceId, floorId, x, y, elevation, normal[x, elevation, -y], distance, walkable
```

`project`의 x/y는 **client 좌표**이며 `pick`과 바로 왕복할 수 있다. 캔버스 offset/CSS scale을 반영한다.
canvas 회전/skew는 지원하지 않는다. 뒤쪽 점의 projection은 undefined이고 clip 밖 점은 `visible: false`다.
클릭은 화면 frame의 camera로 가장 가까운 terrain triangle을 찾으며 sprite/투명 이미지 자체를 pick하지 않는다.
옆면·아랫면 hit는 walkable=false다. 걷기 목표의 도달 가능성은 앱에서 별도로 확인한다.
hit만으로 actor의 층/높이를 순간 변경하지 않는다. 지형 재작성·reset 뒤 오래된 terrain revision은 undefined다.

## 빌보드·문자·깊이

`billboards`는 선택 fragment의 instance ID를 참조한다. cylindrical billboard는 수직축을 유지하고
수평 방향만 카메라를 향한다. `unitsPerPixel` 기본 1, `alphaCutoff` 기본 0.5(0.001..1),
정적 추가 `elevation` 기본 0이다. body가 있는 entity는 native heightSpan 높이를 자동으로 더한다.
크기·발 pivot·atlas UV/clip/flip과 sprite 회전을 native renderable에서 읽는다.
같은 handle에 anchor한 bitmap world text도 같은 높이와 camera basis를 사용한다.

WebGL2에서 지형과 빌보드는 하나의 depth attachment를 검사/기록한다. alpha가 cutoff보다 작으면
discard하며 살아남은 픽셀은 불투명하게 출력한다. 반투명 blending, 별도 sprite material 효과는
이 spatial pass에 적용하지 않는다. nearest sampling을 사용하며 bound sprite는 평면 command로 중복 출력하지 않는다.
빌보드의 실제 quad로 frustum을 판정한다. 발 pivot이 화면 밖이어도 quad 일부가 보이면 유지하며,
회전한 bounds도 같은 판정을 사용한다. near/eye plane을 가로지르는 quad는 GPU가 잘라 그린다.
지형은 작성한 surface 하나를 chunk 하나로 사용한다. Rust가 top/side/bottom 전체 AABB를 camera의
6개 clip plane과 보수적으로 비교하고, 확실히 화면 밖인 chunk의 draw만 제외한다. 큰 절벽의 옆면이나
near/eye plane을 가로지르는 지형은 유지하고 실제 절단은 GPU에 맡긴다. 자동 grid 분할·LOD·streaming은 제공하지 않는다.
clip.w와 clip 축을 합치기 전의 matrix 계수 크기로 float32 오차 여유를 계산해, 특히 먼 far plane의
상쇄 오차로 GPU에 보이는 지형을 CPU가 먼저 제외하지 않도록 한다.

기존 15-float/60-byte sprite ABI와 평면 경로는 유지한다. spatial 설정 시 기존 flat tilemap 출력은 제외한다.
bound world text 외의 일반 sprite/particle/text는 기존 평면 좌표로 spatial 뒤에 그려진다.
이들을 공간 객체로 자동 해석하지 않는다. DOM HUD는 depth와 무관하다.
기존 `createDataSceneView`의 follow/bounds/groundYScale/평면 picking 대신 위 공간 camera/view를 사용한다.

`WebGL2Renderer.supportsSpatialScene`과 `WebGPURenderer.supportsSpatialScene`은 true다.
이 capability가 없는 custom renderer는 공간 packet을 명시적으로 거절한다.
`renderToTexture`의 공간 capture도 아직 지원하지 않는다.

## WebGPU 공간 경로

WebGPU는 같은 native v1/v2 geometry와 모델 확장 v1을 소비한다.
직교/원근 camera, terrain draw range, 발 피벗 billboard, alpha cutout, 정적 GLB/glTF 모델을
같은 depth24plus attachment로 그린다. clip-depth 변환만 GPU에서 수행하며 물리·카메라·LOD·컬링은 Rust가 결정한다.
모델은 indexed/instanced draw, 기본색·발광, MASK·양면, sRGB/data texture 분리와 glTF filter/wrap/mipmap을 지원한다.
공간 ambient·최대 4 point light·directional light, 지형의 표면 normal, 모델 tangent normal·발광·unlit과 billboard normal atlas를 지원한다.
normal atlas는 색 atlas와 같은 크기의 `colorSpace: "none"` 또는 `"linear"` 데이터 텍스처여야 한다.
환경 효과가 켜지면 rgba16float 색·depth24plus 깊이를 공유하며 DOF 표준13/고품질25 sample·actor focus,
노출·톤 매핑·색 보정·camera-depth fog를 합성한다. native pixelArt 내부 해상도/viewport와 공간 debug line도 소비한다.
flat HUD는 공간 합성 뒤에 그리므로 이 효과의 영향을 받지 않는다.

point light 6면과 directional sun의 그림자, hard/PCF3 필터, terrain/billboard/model cast·receive와 alpha cutout을 지원한다.
native face range·caster revision·모델 visibility/matrix를 사용하므로 카메라 밖 모델도 그림자를 드리운다.
같은 terrain/caster/광원/matrix/색 atlas revision이면 깊이 map을 재사용하며 shadow draw/upload는0이다.
카메라 이동으로 billboard caster 모양이 바뀌면 native revision에 따라 다시 그린다. normal atlas만 갱신하면 WebGPU 깊이 cache는 유지한다.
`linear-srgb` renderer 색 관리와 bloom은 기존 정책대로 WebGL2 fallback을 사용한다.
같은 평면 `LightingScene2D`를 공간 packet에 중복 적용할 수 없다.

```ts
const renderer = await createRenderer(canvas, { preferred: "webgpu", spatial: document.spatial });
if ("preloadSpatialModels" in renderer) {
  await renderer.preloadSpatialModels([rock]);
}
applyDataSceneAuthoringDocument(engine, document, { spatialModelPreparer: renderer });
```

`createRenderer`의 선택 `spatial`은 context 결정 전에 지원 요구사항을 검사한다. malformed spec은 오류이며,
지원 공간 요구사항은 WebGPU로 연결하며 adapter/GPU 준비 실패나 기존 미지원 renderer 옵션은 WebGL2 fallback으로 연결된다.
`createFerrumRuntime({ dataScene })`도 초기 문서의 공간 요구사항을 자동 전달한다.
생성 도중에는 옵션과 GPU pipeline 오류를 canvas 연결 전에 확인한다. 연결 후 configure/resize 실패는
같은 canvas에서 다른 API로 바꿀 수 없으므로 오류를 전파한다. 이 경우 새 canvas로 재생성해야 한다.
게임 진행 중 요구사항 변경에 따라 renderer를 자동 교체하지 않는다.

WebGPU 모델은 **먼저 `await renderer.preloadSpatialModels(assets)`** 해야 한다. 반환값은 새로 업로드한 바이트 수다.
업로드·밉맵 생성과 GPU validation/OOM 결과를 기다린 뒤에만 검증 완료 cache에 등록한다.
동기 `prepareSpatialModels`는 준비된 자원만 commit/dispose lease로 제공하고 uploadBytes는 0이다.
준비되지 않은 모델은 장면 활성화 전 또는 draw 전 거절한다. 실패한 preload는 기존 장면 자원을 유지한다.
preload 중 기존 장면을 계속 그려도 재사용 자원은 완료까지 보호한다.
현재 warm set은 최대 16 CPU 자원·128 MiB이며 staging을 포함한 GPU geometry/mip 추정량은 256 MiB로 제한한다.
preload 목록의 모든 LOD 자원은 GPU에 유지한다. 목록을 교체하거나 `preloadSpatialModels([])`로 비워서
현재 장면에서도 사용하지 않는 warm 자원을 해제한다. renderer destroy는 전체 자원을 해제한다.
terrain/billboard GPU buffer는 각각 64 MiB, depth/HDR target은 device texture limit과 8,388,608 pixel 상한을 검사한다.
HDR 저장량은 내부 해상도당 색8+깊이4 byte로 추정한다. warm frame은 같은 target을 재사용하고 disable/destroy 때 해제한다.
동기 target 생성 실패는 이전 target을 유지한다. 비동기 GPU allocation/validation 실패는 해당 target을 폐기하고
다음 렌더 호출에 오류를 전달한다. 그림자 target과 그 view를 참조하는 bind group도 같은 실패 계약을 따른다.
이는 cold 모델 활성화의 rollback 계약과 구분하며 HDR/그림자 resize의 원자적 복구를 보장하지 않는다.
그림자 저장량 추정은 point 해상도²×6면×4 byte와 sun 해상도²×4 byte이며 최대 해상도는 각각1024다.

`pnpm smoke:spatial-webgpu`는 packed public API의 실제 WebGPU와 WebGL2 픽셀을 비교한다.
미지원 adapter나 GPU 오류를 skip하지 않는다. Linux CI에는 `pnpm smoke:spatial-webgpu-offscreen`을 연결해
실제 WebGPU의 별도 GPU target에서 같은 전체 픽셀 조건과 context 전 fallback을 검증한다.
CI target adapter는 canvas presentation 성공으로 해석하지 않는다. 브라우저별 검증 범위와
Linux Chromium readback 제약은 [Smoke Check](../development/quality/smoke-check.md)를 따른다.
WebGPU GPU 시간·자원 통계와 context-loss 복구는 아직 제공하지 않는다.
fade 등 기존 fullscreen 후처리는 사용할 수 있으며 scene FBO에 depth attachment를 설치한다.
기존 `LightingScene2D`는 높이/표면을 계산하지 않으므로 spatial과 함께 활성화하면 거절한다.
공간 효과는 아래 `environment`를 사용한다. 공간 물리 진단의 범위는 아래 계약을 따른다.

## 높이 기반 조명·그림자와 분위기

`DataSceneSpatialSpec.environment?: SpatialEnvironmentSpec`는 기본 생략이다.
`resolveSpatialEnvironmentSpec`과 관련 `Spatial*Spec`/`SpatialRgb`/`SpatialEnvironmentBufferView` 타입은
root·`/core`·`/authoring`에서 제공한다. 잘못된 필드·범위는 authoring activation 전에 거절한다.

```ts
import type { SpatialEnvironmentSpec } from "@ferrum2d/ferrum-web/core";
const environment: SpatialEnvironmentSpec = {
  lighting: {
    ambient: [0.1, 0.1, 0.14],
    lights: [{ position: { x: 0, y: 40, elevation: 96 }, radius: 240,
      color: [1, 0.8, 0.6], intensity: 2 }],
    shadows: { lightIndex: 0, resolution: 256, bias: 0.1 },
  },
  depthOfField: { focusDistance: 400, focusRange: 24, aperture: 8, maxBlurRadius: 8 },
  colorGrading: { exposure: 0, toneMapping: "aces", contrast: 1, saturation: 1, tint: [1, 1, 1] },
  fog: { color: [0.04, 0.05, 0.08], start: 500, end: 1200 },
};
// authored: document.spatial.environment = environment
engine.setDataSceneSpatialEnvironment(environment);
engine.setDataSceneSpatialEnvironment(null); // 다음 frame부터 공간 효과 해제
```

런타임 setter는 낮은 빈도의 presentation 설정 변경이며 물리 pose·진행 중 경로·terrain source revision을
바꾸지 않는다. native preflight 실패는 false, 잘못된 JSON은 diagnostic이다. 공간 camera가 필요하며
구 Wasm에서는 false다. `{}`는 켜진 효과가 없는 설정이다. 명시적인 해제는 null을 사용한다.

| 설정 | 계약과 기본값 |
| --- | --- |
| `lighting.ambient` | linear RGB 0..4, 기본 `[0.15,0.15,0.15]` |
| `lighting.enabled` | 선택 boolean, 생략/true는 조명 활성화. false는 작성된 광원·그림자 설정을 보존하고 조명/그림자 렌더만 끔 |
| `lighting.lights` | 필수 배열, 최대 4개 점광원. 빈 배열은 ambient만 사용 |
| `lights[].position` | world `x/y/elevation`, 각 ±1,000,000의 유한 f32 |
| `lights[].radius` | 필수 0.1..1,000,000 world 단위, 범위 밖 기여 0 |
| `lights[].color/intensity` | linear RGB 0..1 기본 white, 강도 0..64 기본 1 |
| `lighting.shadows` | 선택 단일 광원 depth cube. `lightIndex`는 배열의 유효 index |
| `shadows.resolution/bias` | 각 면 128/256/512/1024, 기본 256. bias는 world 단위 0..10, 기본 0.05 |
| `depthOfField.focusDistance` | 필수 양수 0.001..1,000,000. 카메라 전방 축의 실제 view distance |
| `focusRange/aperture/maxBlurRadius` | 선명 영역의 반폭 world 단위 기본 10(0..1M), 조리개 계수 기본 8(0..32), blur 기본 8 CSS px(0..12) |
| `colorGrading.exposure` | EV -10..10, 기본 0. HDR에서 `2^EV` 적용 |
| `toneMapping` | `none`(기본)/`reinhard`/`aces`, HDR 공간 target에서 출력 범위를 조절 |
| `contrast/saturation/tint` | 각 0..2 기본 1, 0..2 기본 1, RGB 0..4 기본 white |
| `fog.color/start/end` | 필수 linear RGB 0..1, view distance 0..1M, end > start. 거리 사이 선형 혼합 |

조명은 실제 triangle 표면 방향과 광원 위치/높이·거리 감쇠를 사용한다. terrain의 top/side/bottom과
authoring에 연결한 cutout billboard가 그림자를 만들고 받는다. 동일 native atlas UV·flip·alpha cutoff와
물리 elevation을 사용하며 화면 밖 caster도 광원 기준으로 판정한다. 기본 그림자는 nearest depth의 hard shadow다.
깊이 비교는 작성한 bias에 해상도·입사각 기반의 제한된 receiver 보정을 더해 자기 그림자 줄무늬를 줄인다.
얇고 밀착한 geometry의 shadow offset은 해상도·bias 조정으로 관리한다.
billboard는 하나의 camera-facing 평면이므로 입체 캐릭터 메시나 normal map을 대신하지 않는다.
bitmap world label은 caster에 포함하지 않는다. 여러 point shadow light·PCSS는 후속이며, 방향광·PCF와 normal atlas는 아래 계약을 따른다.

효과가 켜지면 `EXT_color_buffer_float`가 필요한 RGBA16F color + depth24 target을 사용한다.
미지원 환경은 명시적 오류를 내며 효과를 조용히 생략하지 않는다. linear 공간에서 조명→안개→DOF→
노출/톤 매핑/색 보정을 적용한다. legacy는 공간 pass 안에서 decode/encode하고 `linear-srgb`는 기존
최종 renderer encode를 유지한다. HDR spatial composite는 현재 scene FBO에 출력한 뒤 flat sprite/text/HUD를
그린다. 따라서 이 효과들은 HUD에 적용하지 않는다. 별도 설정한 기존 전체 화면 bloom/CRT/fade 등은
그 뒤 실행되므로 기존 정책대로 HUD에도 적용될 수 있다. 공간 debug 선은 조명·안개를 생략하지만
DOF·색 보정에는 포함된다.

DOF는 실제 depth texture에서 직교/원근 view distance를 복원하며 중심+최대 12개 이웃을 읽는다.
초점 범위 안은 그대로 출력하고 깊이 불연속/빈 배경 샘플은 제외한다. opaque/cutout의 첫 표면을 처리하는
화면 공간 효과다. `quality: "high"`는 아래 전경 coverage 확장을 추가한다. 반투명 다중 depth·숨은 배경 복원은 제공하지 않는다.
수동 focusDistance와 opt-in native actor 초점 추적을 선택한다.

### 그림자 캐시·광원 기준 컬링

그림자 활성 시 authored billboard 최대 1,024개, terrain texture run과 caster texture group 합은
면당 최대 64개다. 점광원 6면 최대 384 draw, 방향광 1면 최대 64 draw이며 둘을 함께 켜면 최대 448 draw다.
비연속 컬링 범위 때문에 batch가 늘면 해당 면은 cast 허용 geometry 전체 범위로 되돌려 상한을 지킨다.
화면 밖 caster를 main camera visibility로 제거하지 않는다. Rust는 각 광원 면의 frustum에 대한
보수적 범위와 caster revision을 만들고 TS는 GPU 그림자 결과를 재사용한다.

지형·caster·광원·camera-facing 방향·atlas frame/flip/alpha와 texture 내용이 같으면 그림자 draw와
caster upload가 0이다. texture 등록/교체/제거와 pixel-mask patch는 cache를 무효화한다.
RenderTexture 또는 revision을 제공하지 않는 외부 texture source는 재계산한다. 캐시는 GPU 결과만
보관하며 JS가 entity pose를 소유하지 않는다. CPU의 native geometry 생성·packet 검증까지 생략하는 기능은 아니다.
구 packet에 제출 extension이 없으면 전체 재계산 경로를 유지한다.

HDR target은 최대 8,388,608 pixel·각 축 8,192이며, 추정 attachment 저장량은
`width×height×12 + pointResolution²×6×4 + sunResolution²×4` bytes다. normal atlas는 별도로 집계한다.
켜지지 않은 shadow 항의 resolution은 0이다. caster bulk 최대 크기는 `1,024×6×44` bytes이고
정적 지형 buffer는 재사용한다. warm frame GPU object 추가 생성 없이 resize/disable/destroy 시 회수한다.

### 고정 해상도와 픽셀 안정성

```ts
engine.setDataSceneSpatialEnvironment({
  pixelArt: { width: 320, height: 180, snapCamera: true },
});
```

`pixelArt.width/height`는 정수 1..2,048, 곱은 최대 1,048,576이다. 고정 내부 scene target을
nearest로 확대하고 CSS 크기의 정수 배율로 가운데 배치한다. 창이 더 작으면 비율을 유지하며
축소하고 여백은 기존 scene 배경을 유지한다. DPR 2에서도 같은 CSS 배율을 사용한다.
픽셀 모드도 공간 환경의 HDR capability 계약을 따른다. 물리 pose와 원본 camera는 반올림하지 않는다.

`snapCamera`는 기본 false이며 직교 camera의 표시 eye/target을 내부 pixel 격자에 맞춘다.
원근 camera에는 스냅을 적용하지 않으며 원근에서 모든 world pixel 크기가 일정해진다고 보장하지 않는다.
표시 camera·정규화 viewport를 native frame으로 전달해 지형 컬링·picking·project·label을 맞춘다.
여백을 클릭하면 hit가 없다. HUD는 기존 최종 해상도로 그리며 DOF 반경은 계속 CSS px 단위다.

### normal atlas와 개체별 그림자

```ts
await renderer.loadTexture(12, "/hero-color.png");
await renderer.loadTexture(13, "/hero-normal.png", { colorSpace: "none" });
document.spatial.billboards.hero = {
  normalTextureId: 13, castShadow: true, receiveShadow: true,
};
document.spatial.terrain[0].receiveShadow = false;
```

`SpatialBillboardSpec.normalTexture`는 선택 project texture 이름이다. `normalTextureId`는 기존 numeric ID 방식이며
두 필드는 동시에 지정할 수 없다. 이름은 앞뒤 공백이 없는 1..256자 문자열이고 null은 거절한다.
저장 문서에는 이름을 유지하고 apply 전에 현재 registry의 numeric ID로 해석한다. 이름 누락·잘못된 ID는
씬 activation 전에 거절한다. `applyDataSceneAuthoringDocument(..., { textureId })`의 resolver도 같은 경로에 사용한다.
직접 `engine.configureDataSceneSpatial` 호출은 engine의 AssetHost registry를 사용한다.
color/normal은 같은 크기의 atlas이며
UV·frame·pivot·rotation·flip을 공유한다. 별도 normal frame metadata를 만들지 않는다.
normal은 sprite-local X 오른쪽/Y 위쪽/Z 바깥쪽이며 RGB 0..1을 -1..1로 복원한다. shader는 UV·world
미분으로 basis를 만들어 flip 방향을 반영한다. 누락하면 기존 평면 normal을 사용한다.
알려진 크기의 color atlas와 `colorSpace: "none"` 또는 `"linear"` normal atlas를 미리 로드해야 한다.
크기 불일치·sRGB normal·metadata를 알 수 없는 외부 texture는 GPU 제출 전에 거절한다.
모든 alpha coverage·깊이·그림자는 color atlas를 기준으로 한다. normal 제작은 게임 에셋 작업이다.

terrain/billboard의 `castShadow`/`receiveShadow`는 선택 boolean이며 기본 true다. false는 각각
caster 제출 또는 직접 그림자 수신만 끈다. 조명 자체와 물리 충돌은 유지한다. normal/material이 다른
연속 geometry는 draw batch가 나뉠 수 있다. normal atlas는 공간 조명 경로에 적용하며 flat sprite
material이나 기존 15-float render command에 추가 ID를 포장하지 않는다.

#### 선택형 노멀맵 생성 CLI

저장소 개발 환경에서 [Sprite Fusion](https://github.com/Hugo-Dz/spritefusion-sprite-normals)을 선택형 asset 도구로 사용할 수 있다.
`scripts/tools/sprite-normals-tool.json`의 upstream commit과 Cargo.lock을 고정하여 설치하고,
`artifacts/tools/sprite-normals/`에 source·MIT LICENSE·binary·설치 provenance를 보관한다.
Rust/Cargo 1.85 이상과 Git이 필요하며 첫 설치는 네트워크를 사용한다. 엔진/npm runtime dependency나 기본 build에는 포함하지 않는다.

```bash
pnpm normals:install
pnpm normals:generate -- --config docs/engine/samples/sprite-normal-job.json
```

[예제 config](samples/sprite-normal-job.json)는 기존 Shooter player PNG에서 생성하고
`artifacts/sprite-normal-jobs/player/`에 결과를 둔다. 입력·outputDir은 **config 파일 기준** 상대 경로다.
새 작업은 config를 복사해 inputs·outputDir을 바꾼다. 성공한 outputDir은 재사용하지 않는다.

```json
{
  "format": "ferrum2d.sprite-normals.config",
  "version": 1,
  "inputs": ["hero.png", "crate.png"],
  "outputDir": "generated/normals-v1",
  "settings": { "normalStrength": 1.5, "detailStrength": 6, "detailScale": 0.6, "shapeStrength": 1.15 }
}
```

settings는 선택 사항이다. 위 기본값과 `shapeRadius: 4`, `shapeSoftness: 1.15`, `alphaThreshold: 0.03`을 사용한다.
normalStrength/detailStrength/shapeStrength/shapeSoftness는 0–8, detailScale은 0.6–8,
shapeRadius는 0.5–512, alphaThreshold는 0–0.99 범위다. 미지원 필드·null·범위 밖 값은 거절한다.
균일 PNG sheet에는 settings의 `frameSize: { "width": 32, "height": 32 }`를 사용한다.
셀은 이미지 크기를 나누어야 하며 최대 256개다. 외부 irregular/trimmed/rotated atlas 역변환은 지원하지 않는다.

최대 64개 PNG/GIF/APNG 입력을 처리한다. 입력당 64 MiB, upstream decoded/padded pixel 4,194,304,
animated/frame sidecar 256 frame 상한을 적용한다. PNG·uniform sheet와 GIF/APNG의 합성·프레임 복원,
시간 변환·native 재생/조명 연결을 검증했다. 입력 basename stem의 중복은 거절한다.

입력 스냅샷에서 생성하고 원본 변경·native 실패·잘못된 출력을 확정 전에 거절한다.
기존 결과·보고서·symlink를 덮어쓰지 않으며 `--force`는 제공하지 않는다.
다른 writer와 충돌하면 자기 작업이 새로 만든 파일만 정리한다. 완료 보고서를 마지막에 배치하므로
보고서가 없는 출력은 완료 결과로 소비하지 않는다.

- `<stem>_n.png`: OpenGL normal PNG. `colorSpace: "none"`으로 로드한다.
- animated/sheet의 `<stem>_n.color.png`, `<stem>_n.frames.json`: 같은 배치의 color atlas와 upstream frame/timing 정보.
- `normal-generation.report.json`: `ferrum2d.sprite-normals.report` v1. generator commit/binary SHA-256,
  config hash, settings, input/output SHA-256·bytes·PNG 크기와 sidecar 경로를 기록한다.
- stdout은 성공 JSON이다. 실패 stderr는 `ferrum2d.sprite-normals.error` v1과 code를 제공한다.
  도구 누락/불일치는 `FERRUM_NORMAL_TOOL_MISSING`/`FERRUM_NORMAL_TOOL_MISMATCH`,
  출력 충돌은 `FERRUM_NORMAL_OUTPUT_EXISTS`, 원본 변경은 `FERRUM_NORMAL_SOURCE_CHANGED`다.

cache의 commit·platform·binary hash가 다르면 실행하지 않는다. 손상된 해당 관리 cache를 확인·정리하고 다시 설치한다.
생성 파일의 배치·로딩은 host가 담당한다. stable project 이름 연결은 아래 binding API를 사용한다.

#### GIF/APNG와 균일 sheet의 Ferrum 애니메이션 변환

기존 v1 config에 선택형 `animation`을 추가하면 raw 결과를 유지하면서 패킹된 color/normal과
기존 `visual.animationSet`에 넣을 데이터를 함께 만든다. `animation`이 없으면 기존 출력 계약을 유지한다.

```json
{
  "format": "ferrum2d.sprite-normals.config",
  "version": 1,
  "inputs": ["hero.gif", "effect.apng"],
  "outputDir": "generated/animations-v1",
  "animation": { "loop": true, "clipId": 0, "padding": 1, "maxSize": 2048, "powerOfTwo": true }
}
```

- `loop`는 **필수 boolean**이다. upstream이 원본 반복 횟수를 내보내지 않으므로 true(무한 반복)/false(한 번 재생)를
  호출자가 정한다. 유한 N회 반복 횟수는 자동 복원하지 않는다.
- 나머지는 선택형이다. `clipId`는 0..65535(기본 0), `padding`은 0..8(기본 1), `maxSize`는 한 변의 상한
  1..4096(기본 2048), `powerOfTwo`는 boolean(기본 true)이다. null·미지원 필드는 거절한다.
- GIF/APNG 또는 `settings.frameSize`를 지정한 PNG만 변환한다. 단일 정적 PNG를 함께 지정하면 전체 작업을 거절한다.
  [실행 가능한 PNG sheet 예제](samples/sprite-normal-animation-job.json)도 같은 변환 경로를 사용한다.
  예제는 기존 32×32 player PNG를 16×16 셀 4개로 나누어 변환 경로를 확인한다.
- 각 프레임은 합성 완료된 원본 canvas 크기를 유지한다. 컬러·노멀은 하나의 비회전 layout을 공유하고,
  같은 edge pixel을 padding에 복제한다. UV는 padding 안쪽이며 원본 frame 크기·사용자 pivot을 바꾸지 않는다.
  decode·padding 면적·최종 아틀라스 각각 4,194,304 pixel 상한을 적용한다. 남는 source 셀은 투명해야 한다.
- APNG 반투명 Over 합성은 고정 upstream 디코더의 정수화로 예상 RGBA 대비 1바이트 차이가 날 수 있다.
  디코딩된 프레임에서 normal 생성·재패킹까지는 해당 픽셀과 알파를 그대로 보존한다.

추가 출력은 `<stem>_n.ferrum.color.png`, `<stem>_n.ferrum.normal.png`, `<stem>_n.ferrum.json`이다.
descriptor는 `ferrum2d.sprite-normal.animation` v1이며 다음을 기록한다.

- `textures`: descriptor 기준 상대 경로와 color=`srgb`, normal=`none` 로딩 계약.
- `atlas`: 기존 `ferrum-texture-atlas-pack` v1 형식의 frame UV·크기·배치. texture 이름은 `color`다.
- `animationSet`: 기존 `resolveDataSceneSpriteAnimationSet`/`visual.animationSet`에서 받는 clip 데이터.
- `timing`: `sourceDelaysMs`(유리수 밀리초 쌍), `tickMs`, `repeats`, `sourceFrameIndices`,
  `requestedFps`/`nativeFps`, `sourceCycleMs`/`nativeCycleMs`/`nativeCycleErrorMs`와 `sourceLoopCount: "not-exported"`.
- `packing`: padding·비회전/비trim 정책. `source`: raw color/normal SHA-256과 canonical JSON metadata SHA-256.
  실제 raw metadata 파일 hash는 완료 report의 `outputs`에 별도로 기록한다.

원본 지연 시간의 유리수 최대공약수를 tick으로 삼아 UV frame을 반복한다. 예를 들어 50/90/120/60ms는
10ms tick의 5/9/12/6 frame으로 변환된다. 기존 native clip의 **1..32 frame, 고정 FPS 0.001..1000** 한도 안에서만
변환하며, 0 지연·32개 초과·범위 밖 FPS는 `FERRUM_NORMAL_TIMING_UNSUPPORTED`로 거절한다.
타이밍을 임의로 반올림하거나 프레임을 버리지 않는다. native FPS는 f32로 저장하므로 descriptor에 cycle 오차를 남긴다.
이 수치는 FPS 표현 오차이며 프레임 루프 delta 누적·화면 표시 시점의 오차까지 보장하지 않는다.
메타데이터·레이아웃·알파·패킹 한도 불일치는 `FERRUM_NORMAL_ATLAS_INVALID`다.
변환 실패·새 출력 이름 충돌도 전체 생성 transaction의 정리·원본 보호 규칙을 따른다.

게임은 두 PNG에 직접 numeric texture ID를 할당해 로드하고 descriptor의 `animationSet`을 visual에 넣는다.
다음은 이미 로드한 color=101, normal=102를 연결하는 필드 예다. normal은 반드시 `{ colorSpace: "none" }`으로 로드한다.

```ts
const visual = {
  kind: "sprite", texture: 101, width: 32, height: 32,
  animationSet: generated.animationSet,
};
// spatial.billboards.<instanceId>:
const billboard = { normalTextureId: 102 };
```

descriptor 자체를 scene 문서로 적용하지 않는다. stable reference·patch/handoff는 다음 binding API로 연결한다.

#### 생성 에셋 binding과 패치·handoff

`@ferrum2d/ferrum-web/authoring`의 `createSpriteNormalAssetBinding`은 완료된 CLI/Worker report와 project asset 이름에서
`ferrum2d.sprite-normal.binding` v1 JSON을 만든다. 정적 PNG는 report만, 애니메이션/PNG grid는 Ferrum descriptor와
**descriptor 파일 bytes의 실제 SHA-256**도 전달한다. report의 `resultIndex`는 기본 0이다.
animated raw sidecar만 있는 결과는 거절하므로 먼저 `animation.loop`를 지정해 변환한다.

```ts
import {
  createSpriteNormalAssetBinding, diagnoseSpriteNormalAssetBinding,
  createSceneSpriteNormalPatch, mergeScenePlacementPatch,
  createScenePlacementAgentHandoff,
} from "@ferrum2d/ferrum-web/authoring";

const binding = createSpriteNormalAssetBinding({
  report, descriptor, descriptorSha256, // host가 읽은 JSON과 descriptor bytes의 SHA-256
  resultIndex: 0, colorAsset: "hero.color", normalAsset: "hero.normal",
});
const diagnostics = diagnoseSpriteNormalAssetBinding(binding, hostMeasuredTextures);
// hostMeasuredTextures: 실제 decoded/uploaded bytes에서 측정한 id, width, height,
// colorSpace, sha256, 선택형 frames. report 값을 그대로 복사해 검증을 대신하지 않는다.
if (diagnostics.length) throw new Error(diagnostics[0].message);

await engine.loadAssets({
  textures: { "hero.color": colorUrl, "hero.normal": normalUrl },
  textureOptions: { "hero.normal": { colorSpace: "none" } },
});
const { patch, evidence } = createSceneSpriteNormalPatch(sourceDocument, binding, {
  instanceId: "hero", assets: hostMeasuredTextures,
});
const merged = mergeScenePlacementPatch(sourceDocument, patch).document;
const handoff = createScenePlacementAgentHandoff({
  document: sourceDocument, state: viewer.state(), patch,
  normalBindings: [evidence], normalAssetDiagnostics: diagnostics,
});
```

binding을 별도 project JSON/asset catalog에 보관하고 `resolveSpriteNormalAssetBinding`으로 재검증한다.
binding의 `textures.color/normal`은 stable 이름·report path·SHA-256·색 공간을, `width/height/frames`와 선택형
`animationSet`은 두 이미지가 공유할 layout을 기록한다. `generation`은 generator repository/revision/binary hash,
config hash·settings·선택형 animation packing 설정, input path/hash·선택형 descriptor hash를 보존한다.
path는 provenance locator이며 URL로 자동 해석하거나 읽지 않는다. report digest는 출처의 주장이고,
실제 파일 hash·decode 크기·업로드 색 공간은 host가 측정해 검증해야 한다. 서명·신뢰 검증 기능은 아니다.

진단 code는 `missingTexture`, `duplicateTexture`, `colorSpaceMismatch`, `dimensionsMismatch`,
`contentHashMismatch`, `frameLayoutMismatch`다. normal은 none/linear, color는 srgb여야 한다.
선택형 asset frames를 제공하면 순서까지 shared layout과 같아야 한다. binding 내부 UV는 pixel 경계·native 유효 범위를
만족하고 animation clip의 UV는 shared frame 중 하나여야 한다. 원본 bytes가 바뀌면 이전 binding을 재사용하지 않고
명시적으로 재생성·재검증한다. binding API는 파일/GPU를 수정하지 않으므로 실패한 후보는 기존 결과를 보존한다.

patch는 기존 `updateComponents`와 spatial v4의 `setBillboardNormalTexture`를 함께 반환한다.
초기 fragment에서 적용된 기존 sprite billboard와 직접 편집 가능한 component 대상이 필요하다.
포함 fragment의 모호한 대상·primitive·template는 거절한다. 기존 collider/body·pose·pivot·visual 크기·behavior는 유지하며
texture/frame/animation을 생성 결과로 교체한다. 기존 legacy animation과 asset 별칭은 정리한다.
normal 참조 교체는 기존 numeric ID를 제거한다. 이 operation의 `normalTexture: null`은 두 참조를 모두 해제한다.
`viewer.updateSpatial`에서도 v4 참조 변경의 Undo/Redo·draft export를 지원한다.
source document·binding을 변경하지 않으며 파일 저장은 기존 host save adapter가 담당한다.

handoff의 선택형 `normalBindings`에는 instanceId와 검증한 binding이 들어간다.
handoff 생성 시 patch를 적용한 문서의 색/노멀 이름·clip·초기 frame과 일치하는지 확인하고 복사한다.
오래된 근거는 거절하며 `normalAssetDiagnostics`로 실패 후보의 진단을 별도 전달할 수 있다.
공식 Assets UI는 아래 생성·비교 화면 절을 따른다. 선택형 브라우저 생성 API는 다음 절을 따른다.

#### 선택형 브라우저 노멀맵 Worker

`createSpriteNormalWorkerClient`는 PNG·GIF·APNG를 별도 module Worker의 생성기 Wasm으로 처리한다.
기본 엔진 build와 npm 배포에는 생성기 binary를 포함하지 않는다. Rust toolchain·`wasm32-unknown-unknown` target과
`wasm-pack`을 준비한 개발 환경에서 선택형 bundle을 만든다.

```bash
pnpm normals:wasm:build
```

고정 upstream을 별도 staging에 checkout하고, Wasm에 빠진 CLI 설정 3개만
`scripts/tools/sprite-normals-wasm.patch`로 연결한다. 기존 CLI 설치 cache는 수정하지 않는다.
bundle은 `artifacts/tools/sprite-normals/<revision>/wasm-web/`에 생성하며 `manifest.json`,
`spritefusion_sprite_normals.js`, `spritefusion_sprite_normals_bg.wasm`, `LICENSE`를 host의 asset 경로에 함께 제공한다.
MIT 고지를 유지하고 stdout의 `manifestSha256`을 host 설정에 고정한다. 기존 cache의 hash가 다르거나 파일이 없으면
자동 복구하지 않고 오류를 반환하므로 변경 원인을 확인한 뒤 해당 관리 cache를 제거하고 다시 빌드한다.

```ts
import {
  createSpriteNormalWorkerClient, createSpriteNormalAssetBinding,
  SpriteNormalWorkerError,
} from "@ferrum2d/ferrum-web/authoring";

const client = createSpriteNormalWorkerClient({
  generator: {
    manifestUrl: "/assets/normal-generator/manifest.json",
    manifestSha256: generatorManifestSha256, // 빌드 stdout에서 고정한 실제 hash
  },
  cacheBytes: 8 * 1024 * 1024, // 0이면 결과 cache 비활성화
});
const controller = new AbortController();
try {
  const generated = await client.generate({
    name: "hero-sheet.png", bytes: sourceBytes,
    settings: { frameSize: { width: 32, height: 32 }, normalStrength: 1.5 },
    animation: { loop: true, clipId: 0 },
  }, { signal: controller.signal, timeoutMs: 30_000 });
  const binding = createSpriteNormalAssetBinding({
    report: generated.report, descriptor: generated.descriptor,
    descriptorSha256: generated.descriptorSha256,
    colorAsset: "hero.color", normalAsset: "hero.normal",
  });
  // generated.colorPng/normalPng는 caller 소유 ArrayBuffer다.
  // host가 실제 bytes의 hash·decode 크기·색 공간을 측정한 뒤 binding 진단과 patch 흐름을 수행한다.
} catch (error) {
  if (error instanceof SpriteNormalWorkerError) console.error(error.code, error.message);
  else throw error;
} finally {
  client.destroy(); // 실제 화면에서는 document/tool 수명이 끝날 때 해제한다.
}
```

client 생성은 Worker나 generator를 로드하지 않는다. 첫 요청에서 manifest SHA-256과 고정 provenance를 확인하고
JS·Wasm·LICENSE의 bytes/hash를 검증한 뒤 lazy init한다. host는 HTTP(S), WebCrypto와 module Worker를 제공해야 한다.
검증한 JS bytes를 Blob module로 import하므로 CSP에서 해당 `script-src blob:`과 Worker/Wasm 실행을 허용해야 한다.
환경이 지원하지 않으면 오류를 반환하며 main thread의 동기 생성으로 우회하지 않는다.
기본 Worker URL을 bundler가 처리하지 못하는 host는 `workerFactory`로 동일 entry를 빌드한 module Worker를 제공한다.
반환된 Worker는 client가 소유하고 종료한다. Worker 내부 entry를 package public subpath로 직접 import하지 않는다.

입력은 `name` basename·`bytes: Uint8Array`와 선택형 settings/animation이다. 원본 bytes를 복사한 뒤 복사본만 transfer한다.
7개 생성 설정과 `frameSize`의 범위·기본값은 위 CLI와 같다. 브라우저 v1은 upstream의 **원본 frame grid**를 유지한다.
추가 packing·padding·회전·trim 설정을 받지 않으며 `animation`은 명시적 `loop`와 선택형 `clipId`만 받는다.
descriptor의 padding은 0이고 color/normal은 같은 grid·UV를 쓴다. 유리수 delay와 32 native frame/FPS 한도는 CLI와 같다.
정적 PNG color는 원본 bytes이며 애니메이션 color는 생성된 RGBA8 atlas다. normal은 OpenGL 방향·non-color다.

결과에는 owned color/normal PNG, upstream `metadataJson`, CLI 호환 report, 선택형 descriptor/hash와 resource stats가 있다.
descriptor를 저장할 때 `JSON.stringify(descriptor, null, 2) + "\n"`로 직렬화해야 반환된 hash와 일치한다.
report의 `config.path`는 `worker:<name>` locator이며 파일이 아니다. generator provenance는 Wasm·manifest·adapter hash를 기록한다.
반환 자체가 씬/파일/GPU에 적용되지는 않으며 host가 기존 binding 진단·명시적 patch/저장을 수행한다.

| 자원 | 상한 |
| --- | --- |
| 입력 bytes·이름 | 16 MiB, 경로 없는 PNG/GIF/APNG basename 128자 |
| 이미지 | 각 변 4096, 전체 4,194,304 pixel, source frame 256 |
| native clip | 반복 UV를 포함해 32 frame, FPS 0.001..1000 |
| 결과·metadata | color/normal 합계 40 MiB, metadata 256 KiB |
| Wasm linear memory | linker에 최대 256 MiB를 인코딩하고 bundle 검사에서도 확인 |
| cache·시간 | LRU 최대 4건/8 MiB, 기본 30초·요청별 최대 120초 |

새 유효 요청은 이전 요청을 `superseded`로 끝낸다. 잘못된 설정이나 이미 abort된 요청은 진행 중 요청을 취소하지 않는다.
`cancel()`/AbortSignal·timeout은 동기 Rust 작업을 실행하는 Worker 전체를 종료한다. 오래된 응답은 Worker identity와
request id로 거절한다. 실패 후 다음 요청은 새 Worker에서 시작하며 기존 씬·원본·이미 적용된 결과는 수정하지 않는다.
정상 반환은 getter의 owned bytes를 복사한 뒤 `finally`에서 Rust result를 free한다. 강제 종료 시에는 Worker realm을 해제한다.
`clearCache()`는 진행 중 요청을 취소하고 compiled generator와 결과 cache를 버린다. `destroy()`는 반복 호출할 수 있고
이후 요청을 거절한다. cache hit 결과도 별도 복사하므로 결과 bytes를 변경하거나 transfer해도 cache를 손상시키지 않는다.

`SpriteNormalWorkerError.code`는 `invalidInput`, `unavailable`, `aborted`, `superseded`, `timeout`, `destroyed`,
`generatorInvalid`, `generationFailed`, `resultInvalid`다. 설정·취소·환경 오류를 구분해 처리한다.
stats의 `wasmMemoryBytes`는 할당된 linear memory 용량이며 JS heap/전체 process 메모리나 누수 부재의 증명은 아니다.
cache bytes는 보관한 PNG/직렬화 payload 기준이다. 메모리 증가가 필요한 입력은 hard cap에서 실패할 수 있다.

#### Assets 생성·비교 화면

공식 Placement Viewer의 Assets에서 `Generate Normal` 또는 sprite의 `Normal` 버튼을 연다.
Settings는 파일/원본 asset·7개 설정·preset·PNG grid와 animation/loop를, Preview는 color/normal·Flat/Normal과
고정/이동 광원 비교를 제공한다. Expand/Restore는 도구 영역만 임시로 넓힌다.
생성·비교는 원래 씬을 수정하지 않으며, Apply는 선택한 unlocked HD-2D sprite billboard에 한 번의 Undo로 적용한다.
2D에서는 생성·비교·export를 제공하고 공간 billboard를 자동 추가하지 않는다.
이 별도 Lambert 조명 preview는 asset 비교용이며 최종 씬의 환경/그림자/톤 매핑을 복제하지 않는다.

실제 생성 bytes에서 hash/decode 크기를 측정해 binding을 진단하고 내용 기반 이름으로 기존 에셋 충돌을 거절한다.
유효한 binding evidence만 handoff에 포함하며 Undo/다른 visual 수정으로 오래된 근거는 내보내지 않는다.
같은 오브젝트에 여러 생성 pair를 적용해도 pair별 근거를 문서 수명 동안 보관한다. Undo/Redo로 이전 pair에
돌아가면 해당 생성 근거를 복원하며, 현재 씬과 일치하는 근거만 handoff에 포함한다.
입력/설정/후보는 문서별로 보관하고 문서 전환·모드 변경은 진행 중 작업을 취소한다.
정상 적용한 pair는 Undo/Redo에 필요한 동안 유지하며 문서 닫기에서 해제한다.
source는 세션 전체 64 MiB, 생성 pair는 8건/64 MiB/8,388,608 pixel 한도다.
다른 문서의 session 참조를 복사한 JSON은 거절하고, project catalog에 설치한 뒤 다시 열도록 안내한다.

`Export Assets`는 PNG bytes/base64·hash, report/metadata/descriptor, binding과 texture manifest를 담은
`ferrum2d.sprite-normal.assets` v1 JSON이다. project 파일 저장과 구분하며 자동 덮어쓰기를 하지 않는다.
`Save Assets`는 app 전용 host adapter가 있을 때만 제공한다. host는 `overwrite:false`, AbortSignal과 파일 충돌 정책을
지켜 파일/이름/색 공간을 project catalog에 함께 등록한다. 반환된 durable URL의 bytes/hash·크기를 다시 검사한 뒤
저장 완료로 인정한다. 미저장 생성 에셋을 참조하는 Scene Save는 막는다.
host의 catalog 반영·재개방과 filesystem transaction은 host 책임이다. 기본 desktop/browser 쓰기 권한을 넓히지 않는다.
준비/adapter/상세 UI 사용법은 저장소의 `apps/placement-viewer/README.md`를 따른다.

Settings/Preview 탭은 방향키·Home/End로 전환하며 숨은 패널의 입력은 Tab 순서에서 제외된다.
Cancel은 일반 버튼처럼 Enter/Space로 실행한다. 한도 초과는 기존 씬과 생성 pair를 유지한 채 거절하며,
문서를 닫아 자원을 해제한 뒤 다시 생성할 수 있다.
PNG 측정·해시 확인 중 취소도 반영한다. 재사용한 pair는 원래 소유 문서가 계속 보관하며,
취소된 요청이 기존 pair를 해제하지 않는다. 취소 후에는 다시 생성해 설정 일치를 확인한 뒤 적용한다.

#### Export bundle로 agent 작업 재개

기본 host에서 프로젝트에 반영하려면 `Export Assets` bundle과 `Copy Patch` 또는 handoff를 함께 보관한다.
bundle의 `document`는 세션 문서 키이며 씬 JSON 자체가 아니다. 에셋 bundle만 설치해도 씬이 자동으로 바뀌지는 않는다.
bundle의 PNG는 출력 pair다. GIF/APNG 원본 bytes는 포함하지 않으므로 원래 입력 파일도 별도로 보관한다.

1. `resolveSpriteNormalAssetBinding(bundle.binding)`으로 binding을 읽고 report의 config/input/output provenance를 확인한다.
   각 `files[].base64`를 decode해 SHA-256·실제 PNG 크기를 측정한다. manifest의 이름/색 공간을 사용해
   `diagnoseSpriteNormalAssetBinding(binding, measuredAssets)`가 빈 배열인지 확인한다.
   descriptor가 있으면 `JSON.stringify(descriptor, null, 2) + "\n"` bytes의 SHA-256도 binding과 비교한다.
2. 프로젝트 에셋 디렉터리 안에 PNG를 기존 파일 덮어쓰기 없이 설치한다. manifest의 stable asset 이름을 유지하고
   URL만 프로젝트 경로로 바꾼다. color는 `srgb`, normal은 `none`으로 catalog에 함께 등록한다.
3. 동반 patch/handoff를 원래 씬에 검토·반영한다. 런타임은 `loadAssets({ textures, textureOptions })`를 마친 뒤
   씬을 적용한다. 새 세션에서는 numeric texture ID가 달라져도 문자열 참조로 같은 pair를 찾는다.
4. 새 세션에서 문서를 다시 열어 missing/hash/dimension/UV 진단과 조명을 확인한 뒤 씬을 저장한다.
   source/report/descriptor/binding은 다음 재생성·재import 검증을 위해 프로젝트 근거로 보관한다.

변경된 PNG를 이전 binding의 hash로 간주하지 않는다. 재import 후보의 bytes를 다시 측정하고 불일치하면
기존 pair를 유지한다. 새 생성 결과는 새 binding/patch로 명시적으로 교체한다.

### 태양 방향광과 PCF

```ts
engine.setDataSceneSpatialEnvironment({ lighting: {
  lights: [],
  directional: {
    direction: { x: -1, y: -1, elevation: 2 },
    color: [1, 0.95, 0.85], intensity: 2,
    shadows: { resolution: 512, extent: 256, distance: 512, bias: 0.1 },
  },
  shadowFilter: "pcf3",
} });
```

`SpatialDirectionalLightSpec.direction`은 표면에서 태양을 향하는 nonzero world 벡터다.
compiler가 정규화하며 color/intensity의 범위와 기본값은 point light와 같다. 점광원 최대 4개에
방향광 1개를 추가할 수 있다. shadows 생략 시 방향광 그림자는 꺼진다.
이미 정규화된 f32 방향은 저장·복원 때 다시 정규화하지 않아 numeric buffer를 그대로 보존한다.
`resolution`은 128/256/512/1024(기본 512), `extent`는 직교 맵 반폭 1..10,000(기본 256),
`distance`는 target 중심 앞/뒤 깊이의 반폭 1..10,000(기본 512), `bias`는 world 0..10(기본 0.05)다.
카메라 target 주변 유한 영역을 덮고 light-space texel에 중심을 맞춘다. 영역 밖에서는 직접 조명만
적용하며 무한 거리 그림자나 cascade를 제공하지 않는다.

`lighting.shadowFilter`는 `hard`(기본)/`pcf3`다. PCF는 최대 9회 깊이 비교를 평균하며 point cube의
면 경계를 건너는 방향 sampling도 포함한다. 추가 shadow target이나 pass를 만들지 않지만
수신 pixel의 sample 비용은 증가한다. PCSS처럼 물리적 광원 크기에 따른 가변 반그림자는 아니다.

### 고급 DOF와 native actor 초점

```ts
engine.setDataSceneSpatialEnvironment({ depthOfField: {
  focusDistance: 400, focusRange: 12, aperture: 8, maxBlurRadius: 8,
  quality: "high", focusTarget: "actor", focusOffset: 16,
} });
```

`quality`는 `standard`(기본, 중심 포함 최대 13개 sample 위치)/`high`(최대 25개)다.
high는 부호 있는 CoC로 전경/배경 색을 별도 누적한 뒤 전경 coverage를 합성한다. 선명한 전경 색을
배경 blur에 섞지 않으며 흐려진 전경을 이미 렌더된 배경 위로 확장한다. 단일 composite 안에서
누적하므로 중간 texture를 추가하지 않는다. 빈 투명 배경 바깥으로의 확장·물리적 bokeh·숨은 배경이나
여러 겹 반투명 복원은 지원하지 않는다. quality를 바꿔도 blur 상한 12 CSS px와 HUD 제외는 유지한다.

`focusTarget: "actor"`는 `spatial.actor`의 현재 native entity를 추적한다. 발의 물리 elevation과
billboard 시각 offset에 `focusOffset`(world ±1M, 기본 0)을 더해 camera 전방 축의 깊이를 계산한다.
원근·직교 모두 유클리드 거리를 사용하지 않는다. actor 부재/삭제/카메라 뒤·clip 범위 밖에서는
작성한 focusDistance로 돌아간다. 프레임마다 JS에서 pose를 복제하거나 entity별 Wasm 호출을 하지 않는다.
진행 v7은 수동 fallback·target 정책·품질을 저장하며 파생 focus 값은 저장하지 않는다.
fresh restore는 authored actor의 새 handle을 사용한다.

### 버퍼와 통계 호환

기존 spatial render ABI v2/vertex 44 bytes/flat ABI는 유지한다. environment v1 numeric80도 읽고 쓴다.
새 설정을 사용하는 경우에만 v2 numeric112를 사용한다. 80..82는 pixel 크기/snap, 83..94는 방향광,
95는 shadow filter, 96..98은 DOF 품질/actor focus/offset, 99는 frame 파생 focus, 100..111은 reserved 0이다.
설정 입력의 99는 0이며 capture는 설정 원본을 반환한다. matrix는 point 96/sun 16 floats를 순서대로
전달하므로 총 0/16/96/112다. 환경 없는 v5/v6 및 기존 v7 설정은 이전 capture 형태를 유지한다.
새 optional field를 쓰는 문서는 지원하는 JS/Wasm을 함께 설치해야 하며 과거 reader는 거절할 수 있다.
authoring 적용과 진행 복원은 실제 적용할 camera/environment 조합을 native에서 먼저 검사한다.
개별 필드가 유효해도 태양 shadow matrix를 유한하게 만들 수 없는 조합은 장면 교체 전에 거절하며
현재 장면과 entity handle을 보존한다.

독립 shadow submission v1은 u32 `[face, source, first, count]` 범위와 native caster revision이다.
face 0..5는 point cube, 6은 sun이며 source 0/1은 terrain/caster다. material v1은 object별
u32 `[normalTextureId, castReceiveFlags]`이고 기본 none ID는 16,777,215다. terrain object는 36 vertices,
billboard는 6 vertices다. bitmap label에 material이 없으면 기본값을 쓴다. presentation v1의 6 floats는
정규화된 top-left viewport x/y/w/h와 내부 width/height다. borrowed 배열은 지연 사용 전에 모두 복사한다.

`RendererStats.spatial`은 `lightCount`/`directionalLightCount`, `shadowPassCount`/`shadowDrawCalls`,
`shadowTriangleCount`/`shadowCulledTriangleCount`, `shadowUploadBytes`/`shadowCacheHit`, `effectDrawCalls`,
`effectTextureBytes`, `dofSampleBudget`을 제공한다. 전체 draw/triangle/upload에도 그림자와 composite를 합산한다.

## 공간 디버그 표시 (개발 소스)

```ts
// configureDataSceneSpatial 또는 spatial authoring apply 이후에 활성화한다.
engine.setDataSceneSpatialDebug({
  terrain: true,
  billboards: true,
  heightSpans: true,
  colliders: true,
  contacts: true,
  floorIds: true,
  depthTest: true,
});
// 가려진 선까지 확인할 때는 depthTest: false. 종료할 때:
engine.setDataSceneSpatialDebug(null);
```

`engine.setDataSceneSpatialPreviewFilter({ hiddenEntities, hiddenSurfaces })`는 authoring preview 전용 cold API다.
entity는 generational handle, surface는 authored ID를 사용한다. 한 번의 bulk 호출로 최대 16,384 entity와 256 surface를
검증한 뒤 교체하며 stale/unknown 입력은 전체 거절한다. `null`은 표시를 복원한다.
숨긴 대상은 terrain/billboard/model draw와 terrain picker에서 제외하지만 physics/support/navigation/저장 문서는 바꾸지 않는다.
전체 spatial 설정과 scene 교체 시 필터를 초기화한다. render command ABI는 유지한다.

`createSpatialModelThumbnailSvg(asset, size = 80)`는 `/core`의 cold utility다. loader가 발급한 실제 asset만 받으며
16–256px, 최대 2,048 triangle의 정적 diffuse SVG를 만든다. GPU/DOM·scene 상태를 변경하지 않는다.
재질/조명/그림자의 최종 렌더링을 재현하는 preview는 아니다.

`SpatialDebugOptions`의 category는 각각 기본 false이며 `depthTest`만 기본 true다.
옵션 객체의 알 수 없는 필드/잘못된 boolean은 diagnostic으로 거절한다. 공간 설정이 없거나
이 확장을 제공하지 않는 과거 Wasm이면 setter는 false다. 새 physics category bit를 모르는 과거 Wasm도 false로 거절한다. 기본은 꺼짐이며 선분 버퍼를 확보하지 않는다.

| 표시 | 색 | 원천과 범위 |
| --- | --- | --- |
| `terrain` | 청록 | 제출한 authored surface의 top/base 외곽과 네 옆모서리. ramp의 양 끝 높이도 반영 |
| `billboards` | 노랑 | live binding의 실제 제출 quad 외곽과 visual foot 십자. origin·회전·unitsPerPixel·visual elevation 포함 |
| `heightSpans` | 자홍 | live renderable billboard entity 원점에서 native elevation→elevation+height의 세로선과 양 끝 십자. visual elevation offset을 더하지 않음 |
| `colliders` | 초록, trigger는 주황 | native collider의 XY 선을 heightSpan bottom/top에 배치하고 세로 연결. visual 없는 body도 포함 |
| `contacts` | 빨강 | 마지막 유효한 spatial 이동의 sweep hit marker/normal 및 사용 가능한 rigid solver impulse contact |
| `floorIds` | 흰색 | 제출 지형과 visible collider entity의 camera-facing `F숫자` stroke label. heightSpan 없는 body는 `F-` |

`heightSpans`는 entity 원점 높이 표시다. footprint는 별도 `colliders`로 확인한다.
AABB·원·회전 박스·캡슐·edge·chain·convex polygon 및 compound child를 기존 native collider geometry에서 읽는다.
회전 박스/convex polygon은 entity 회전과 collider 회전을 반영하고 offset·enabled/body enabled를 공유한다.
캡슐은 기존 물리 debug와 같은 두 끝 원+축의 진단 glyph이며 원은 16선분 근사, edge/chain은 중심선이다.
heightSpan 없는 collider는 지면 높이 0의 XY 선만 그린다. 이는 무한 높이의 충돌 필터에 임의 3D 두께를 부여하는 계약이 아니다.
`F-`는 floor 0을 뜻하지 않는다. 층 문자에는 외부 font/texture가 필요 없고 같은 카메라를 향하는 native stroke를 쓴다.

`contacts`는 render 때 collision pair/narrowphase를 재실행하지 않는다. opt-in 상태의 마지막 nonzero
`moveDataSceneSpatialBody`/WASD/목적지 추종 이동에서 실제 선택된 sweep hit를 최대 128개 저장한다.
AABB 접촉면의 대표점과 native normal을 표시하며 solver manifold의 모든 접촉점을 뜻하지 않는다.
경로 탐색·gateway 가상 sweep·step/drop/floor rollback의 hit는 기록하지 않는다.
다음 nonzero 이동이 이전 기록을 교체하며 입력 0/일시정지는 유지한다. actor pose/span 변경·stale handle은 표시에서 제외한다.
rigid contact는 기존 solver의 nonzero impulse snapshot을 최대 256개 읽고 heightSpan 교집합의 가운데 높이에 표시한다.
zero-impulse resting contact·trigger overlap·gateway에서만 막힌 접촉·전체 tile/terrain 접촉은 이 snapshot 범위에 포함하지 않는다.
기록은 simulation state/progress에 저장하지 않는다. 이 진단을 전체 3D contact solver 또는 접촉 이력 수집기로 해석하지 않는다.
실제 scene depth를 따르거나 가려진 선까지 볼 수 있으며, 어느 모드에서도 depth buffer에 쓰지 않는다.
선은 공간 scene 뒤, 기존 flat sprite/text/HUD 앞에 그리며 fullscreen 후처리는 그대로 적용된다.
선 굵기는 WebGL `LINES` 기본 1 device pixel이며 coverage/MSAA는 브라우저에 따라 다를 수 있다.

Rust가 같은 frame camera·native entity에서 endpoint를 생성해 optional `spatial.debug`로 bulk 전달한다.
이 확장은 독립 `version: 1`이며 기본 공간 ABI v2와 기존 평면 ABI를 바꾸지 않는다.
`SpatialDebugBufferView`의 `vertexStride: 11`은 기존 공간 vertex와 같다. `vertices: Float32Array`의
인접 두 vertex가 선분 하나이고 `vertexCount`는 endpoint 수다. `depthTest`와 `truncated`는 boolean이다.
확장 부재는 꺼짐이며 version/stride/짝수 count/전체 길이/finite/boolean이 잘못되면 draw 전에 거절한다.

최대 32,768 vertices/16,384 lines/1,441,792 bytes의 native 버퍼를 enable 시 예약한다.
같은 크기까지 GPU buffer도 재사용하며 camera/toggle마다 새 GPU object를 만들지 않는다.
한도를 넘거나 비유한 진단 geometry를 생략하면 `truncated=true`다. 이때 일부 진단선은 표시되지 않는다.
physics 진단 순회는 frame당 alive entity 최대 4,096개·collider/chain segment 최대 2,048개다.
추가 접촉 상한(이동 hit 128, rigid snapshot 256)도 초과하면 truncated를 표시한다.
새 category도 같은 전체 vertex/1 draw 예산을 공유한다. 진단용 collision query는 실행하지 않는다.
disable 후 확보한 capacity는 재사용을 위해 유지한다. native 버퍼는 전체 scene 교체 때 정리하며
GPU 버퍼는 renderer destroy까지 재사용한다.
최초 enable은 Wasm memory grow를 일으킬 수 있으므로 모든 borrowed view를 다음 frame에서 다시 받는다.
지연 사용은 `debug.vertices`도 `.slice()`해야 한다.

디버그 설정·선분은 authoring document와 진행 저장에 포함하지 않는다. 전체 spatial configure,
scene reset와 public authoring/native progress restore 뒤에는 꺼지며 capture한 이동 접촉도 제거한다.
skip-render는 이전 frame 선분을 제거하고 다음 render에서 설정에 맞춰 재생성한다.
debug toggle은 simulation pose, camera, terrain revision, picking과 저장 progress를 변경하지 않는다.

`RendererStats.spatial`의 `debugLineCount`, `debugDrawCalls`, `debugUploadBytes`, `debugTruncated`가
진단 비용을 별도로 기록한다. 선분은 triangle/billboard 통계에 포함하지 않으며 aggregate drawCalls/uploadBytes에는
합산한다. nonempty debug는 texture와 무관하게 `LINES` 1 draw이고 depth write는 false다.
WebGL2는 선의 RGBA alpha를 반영하여 혼합한다. alpha 0은 framebuffer를 바꾸지 않으며
선 pass 전후의 blend enable·RGB/alpha factor·equation과 depth 상태를 복원한다.
GPU buffer는 첫 nonempty frame에 생성하고 native `vertexCount×44` bytes를 매 frame 업로드한다.
debug off에서는 line draw/upload가 0이다. 이 상한은 실제 GPU 시간/FPS 보장이 아니다.

## Buffer·저장·비용

현재 `renderCommandBuffer.spatial`은 version 2 / vertexStride 11의 borrowed Wasm view다.
선택 `models.assets`는 native asset ID→`SpatialModelAsset`의 `ReadonlyMap`이며 공개 load 함수가 반환한
동일한 불투명 핸들만 담는다. vertex/index·decoded RGBA 배열은 공개 frame에 노출하지 않고 renderer가
내부 자원 저장소에서 읽는다. 복제/위조한 핸들은 draw 전에 거절한다. 모델의 유효한 instance ID가
`constructor`·`__proto__`·`toString`이어도 origin 기본값 조회는 상속된 속성을 읽지 않는다.
각 vertex는 position3, UV2, RGBA4, texture ID, cutoff로 44 bytes다. camera는 행렬16 + numeric camera12다.
terrainRevision과 vertex count를 함께 전달하며, 지형은 revision 또는 Wasm memory 변경 때만 GPU에 재업로드한다.
v2의 필수 `terrainDrawRanges`는 `Uint32Array`의 `[firstVertex, vertexCount]` 쌍이다. Rust `repr(C)` range는
8 bytes/u32 stride 2이며 각 범위는 전체 static terrain을 기준으로 한 절대 vertex index다.
범위는 정렬·비중복이며 first/count는 surface의 36 vertices에 맞고 count>0, 끝은 전체 vertex count 이하다.
빈 배열은 지형 전체 cull이다. 누락/잘못된 범위는 draw 전에 거절하며 full terrain으로 조용히 대체하지 않는다.
`terrainVertexCount`와 `terrain`은 가림 여부와 무관하게 전체 메시를 유지한다.
`render:false`도 surface당 36 vertices의 index를 유지하며 main/shadow range만 제외한다. cold terrain metadata의
kind/walkable word bit 4(16)가 proxy 표시이며 native `spatial_surface_proxy_abi_version() === 1`을 요구한다.
지원하지 않는 native는 authoring 씬 교체 전에 거절하고 직접 configure도 변경 없이 false를 반환한다.
이는 cold 입력의 선택 확장이며 frame v2/vertex 44 bytes/model instance 80 bytes ABI는 유지한다. camera-only 변화는
configuration revision을 올리지 않고 범위만 갱신하므로 안정된 Wasm memory에서 지형 upload는 0이다.
physics·picking·stable surface ID·공간 저장은 원본 전체 지형을 사용한다. draw 범위는 저장하지 않는다.

새 reader/renderer는 범위가 없는 과거 v1 packet을 전체 terrain 제출로 처리한다. v1에 범위를 넣으면 거절한다.
이 호환은 새 reader가 v1/v2를 읽는 방향이며 구 JS가 새 v2 Wasm을 읽는 호환은 아니다.
개발 소스의 JS/Wasm은 함께 빌드·교체한다. authoring envelope v1, 공간 progress v6와 기존 60-byte sprite ABI는 바뀌지 않는다.

billboard 정점은 프레임마다 bulk upload한다. 지연 렌더/클릭에서는 camera·terrain·billboards·terrainDrawRanges(v2)·debug.vertices(활성 시)를 모두
`.slice()`하여 보존하거나 그 프레임의 view를 즉시 사용한다. 다음 update 뒤 이전 view의 내용은 보장하지 않는다.

문서의 spatial 설정은 JSON snapshot authoring document와 함께 저장·재적용된다.
`includeDataSceneProgress: true`를 함께 사용하면 아래 v6 공간 진행 데이터도 저장한다.
`clearDataSceneSpatial()`은 공간 설정을 해제하고 다음 frame부터 평면 경로로 돌아간다.

`RendererStats.spatial`은 triangleCount, billboardCount(anchored glyph 포함), drawCalls, billboardDrawCalls,
textureBindCount, textureSwitchCount,
uploadBytes, terrainUploadBytes, depthBufferBytes를 기록한다. depthBufferBytes는 pass가 소유한 FBO depth
storage의 합(width×height×4)이며 browser 기본 framebuffer 저장량은 제외한다.
v2의 `terrainChunkCount`는 proxy를 포함한 전체 surface 수, `visibleTerrainChunkCount`는 실제 제출한 수,
`culledTerrainChunkCount`는 제외한 수다. v1은 chunk 구분이 없어 세 값이 0이다.
`terrainTriangleCount`는 실제 제출 지형 삼각형 수이며 `triangleCount`는 여기에 billboard 삼각형을 더한다.
메모리는 전체 지형을 유지하며 JS의 finite/texture 검증도 전체 버퍼를 검사한다. 숨은 missing texture도 거절한다.
이 최적화는 GPU 제출량을 줄이며 CPU 검증 비용·GPU 상주 메모리가 같은 비율로 줄어든다는 보장은 아니다.
`resourceStats().bufferCount/bufferBytes`에는 공간 vertex buffer와 이 renderbuffer가 포함된다.
연속 texture 단위로 draw를 묶으며 최대 billboard binding은 10000이다. 상한은 성능 보장이 아니다.
일반 FrameState/profiler와 renderer의 spriteCount에는 spatial billboard도 포함한다.
renderer aggregate batchCount는 billboard batch를, textureBindCount/textureSwitchCount는 공간 texture
제출 비용을 합산한다. renderCommandCount는 기존 raw 15-float command 수를 유지한다.

## 공간 상태 저장·새 엔진 복원 (개발 소스)

```ts
import { captureGameStateSnapshot, restoreGameStateSnapshot } from "@ferrum2d/ferrum-web/core";
import { createSceneInstanceHandleRegistry } from "@ferrum2d/ferrum-web/authoring";
const saved = captureGameStateSnapshot(engine, {
  includeDataSceneState: true,
  includeDataSceneProgress: true,
  dataSceneAuthoringDocument: document,
});
// JSON 직렬화/디스크 저장 후 새 engine에서도 같은 API로 복원한다.
const registry = createSceneInstanceHandleRegistry();
restoreGameStateSnapshot(freshEngine, JSON.parse(JSON.stringify(saved)), {
  dataSceneAuthoringApplyOptions: { instanceHandleRegistry: registry },
});
const actor = registry.get("actor"); // 새 entity handle. 이전 engine의 handle을 사용하지 않는다.
```

authoring 문서에 `spatial`이 있는 기본 전체 apply가 대상이다. 저장하는 공간 정보는 다음과 같다.

| 위치 | 내용 |
| --- | --- |
| `dataScene.progress.spatial.camera` | 현재 native camera의 projection/position/target/height 또는 FOV/near/far. null은 공간 모드 명시 해제 |
| `dataScene.progress.instances[].spatialPose` | 살아 있는 authored billboard의 `x`, `y`, `heightSpan`(floorId/elevation/height 또는 null), 선택 `surfaceId` |

body 없는 장식도 XY를 저장하며 heightSpan은 null이다. body의 span 추가·해제·높이 변경도 명시적으로 보존한다.
native actor는 heightSpan이 필요하다. `surfaceId`는 entity origin이 실제 walkable terrain 위에 있을 때만
Rust가 기록한다. origin과 collider offset이 다른 경우 또는 지형 위에 있지 않은 객체는 이 링크가 없을 수 있다.
복원 시 링크가 있으면 해당 authored surface의 위치·floor·elevation이 일치하는지 검증한다.
제거된 instance와 billboard가 아닌 instance에는 spatialPose를 넣지 않는다.

camera는 마지막 render buffer가 아닌 현재 native state에서 읽는다. 저장에 viewport/DPR/matrix,
terrain revision, entity ID/generation 또는 GPU handle을 넣지 않는다. 새 엔진의 viewport로 행렬을 재생성한다.
pose/camera는 body/collider flag와 atlas playback, 기존 진행 상태와 함께 복원하고 playing/paused/complete도 유지한다.
속도·회전·타이머·FSM·동적 spawn·world text 내용과 DOM HUD는 저장하지 않는다. momentum은 이어지지 않는다.
label은 registry의 새 actor handle에 다시 anchor한다. recipe의 `save()`/`restore()`가 이 연결을 보여준다.

지형·billboard·actor의 runtime 재설정은 원래 문서와 다른 source revision이므로 capture를 거절한다.
동일한 설정을 다시 configure해도 해당한다. 변경한 문서를 전체 apply한 뒤 다시 저장한다.
`setDataSceneSpatialCamera`의 camera-only 변경은 지원하며 명시적으로 공간 모드를 clear한 상태도 저장한다.
문서에 spatial이 없는 장면에 runtime spatial 설정을 추가한 경우도 누락 저장을 허용하지 않는다.
camera:null 저장은 pose를 포함하지 않으므로 복원되는 개체 위치는 authored 기본값이다.

바깥 GameStateSnapshot version은 2다. 공간 pose/camera capture는 Data Scene v6이며,
authored 또는 runtime environment만 있는 공간 진행 capture는 **v7**이다. attachment·LOD·chunk 또는 model runtime yaw가 있으면 **v8**이다. 일반 capture는 v5를 유지한다.
`DATA_SCENE_STATE_VERSION`은 최신 지원값 7이다. v2~v6을 기본값 주입이나 재해시 없이 계속 읽으며,
과거 공간 문서에 pose/camera 진행이 없으면 authored 기본값으로 복원한다.
v5 이하에 새 공간 필드를 넣으면 거절한다. `includeDataSceneProgress` 생략 시에는 이전처럼 문서 설정만 복원한다.
v7의 `progress.spatial.environment`는 현재 native 설정이며 null은 authored 효과의 명시적 해제다.
필드 생략은 authored 설정 유지다. v6 이하에 environment progress를 넣으면 activation 전에 거절한다.
camera:null과 non-null environment의 조합도 거절한다. effect GPU object·그림자/색/depth texture는 저장하지 않고
새 renderer에서 재생성한다. runtime environment 변경은 source mismatch로 취급하지 않으며
flag/animation/pose/camera/environment를 같은 native progress batch에서 검증 후 commit한다.

잘못된 JSON/instance/surface/pose/camera와 환경 caster/texture 예산은 씬 활성화 전 검증한다.
texture 예산은 저장된 제거 상태를 반영해 최종 생존 caster 기준으로 계산하고 authored caster 상한은 유지한다.
native progress는
flag·animation·pose·camera 전체 batch를 검증한 뒤 commit하며, 실패 시 일부 개체에 먼저 적용하지 않는다.
navigation collider obstacle은 모든 pose/flag 적용 후 갱신한다. 문서 적용 전체나 custom callback까지
포함한 엔진 전체 rollback을 보장하는 계약은 아니다.

## 검증

```bash
pnpm smoke:spatial-scene
```

실제 packed `/core`·`/authoring` consumer에서 1280×720 / 390×844와 DPR 1/2를 검사한다.
직교/원근·camera tilt의 지형 클릭, canvas offset/CSS scale, 같은 entity의 계단 높이,
다리 위아래 픽셀·제출 순서 역전, alpha 구멍, postprocess FBO depth를 assert한다.
100/500/1000 billboard는 draw 2회, 정적 terrain upload 0, 동적 upload `count×6×44`,
반복 frame의 GPU object 추가 할당 0을 검사하고 CPU submission median/P95를 기록한다.
scene reset의 stale handle 제거와 destroy 이후 GPU object 잔여 0도 검사한다.
공간 화면 fixture는 atlas 2 frame × flipX/flipY × 직교/원근의 16개 조합에서 구분되는 색,
투명 구멍과 atlas 경계 안쪽의 nearest 픽셀을 확인한다. frame/flip 변경 시 비중앙 발 pivot과 native
body 위치·높이는 고정한다. 실제 시간 진행과 pause의 atlas 픽셀/상태도 검사한다.
cutout을 배경보다 먼저 제출한 경우에도 구멍을 통해 배경이 그려지고 불투명 부분은 가리는지 확인해
투명 픽셀의 depth 미기록을 검증한다. fixture 이후 원래 장면의 pose/camera/geometry와 전체 화면도 복원한다.
아래쪽/왼쪽 화면 밖 pivot, near plane의 부분 절단→완전 cull→복귀와 eye plane(w=0) 교차를
실제 framebuffer로 검증한다. RGB 오차 허용은 채널당 3이며 native billboard 수와 draw/upload 비용도
함께 assert한다. 회전한 발 pivot과 bounds는 native Rust 회귀에서도 검사한다.
v6 JSON을 fresh engine/renderer에 복원해 같은 actor XY/높이, 다리 floor, 변경 camera, 새 label anchor,
paused 상태와 저장 전후 전체 framebuffer 픽셀 동일성을 검사한다. 잘못된 pose/층/surface/버전의
씬 교체 전 거절, v5 해시 유지와 authored 기본 복원은 public Wasm test에서 검증한다.
`spatial-terrain-chunks-browser-fixture.mjs`는 256 surface/9216 static vertices에서 camera 이동·zoom·orbit·near·
전체 cull·복귀의 7개 조건을 검사한다. 각 조건에서 v2 culling과 같은 camera/전체 메시의 v1 제출을
framebuffer 전체로 비교하며 실제 range/triangle/draw/upload 비용을 확인한다. 잘못된 range 9종은 draw 0으로
거절하고, 명시적 빈 range는 draw 0이며 framebuffer를 남기지 않는지 확인한다. camera-only 이동 후 공간 저장도 유효해야 한다.
정상 v2/v1/빈 제출에서 실제 GL drawArrays의 first/count 합과 bufferData/bufferSubData 호출·bytes를 관찰해
엔진 통계와 독립적으로 비용을 검증한다. 큰 far depth의 float32 상쇄 경계에서도 v1과 실제 픽셀이 같아야 한다.
`spatial-navigation-browser-fixture.mjs`는 공개 목적지 API로 경사로→다리와 같은 XY의 아래층 이동,
실패한 요청의 기존 route 보존, WASD 취소, 동적 solid 정지와 명시적 우회 요청, paused v6 fresh restore의
pose 보존·idle 초기화·재이동을 검사한다. 도착 floor/elevation·지형 picking·terrain revision/upload와
탐색량 상한·추종 중 searchCount 불변을 함께 assert한다.
같은 debug fixture는 새 collider prism/층 label의 depth/overlay 픽셀과 실제 `LINES` 제출·업로드를 확인한다.
실제 wall sweep의 actor 정지·접촉 marker/normal 픽셀, navigation probe 후 동일 접촉 buffer,
disable 뒤 draw/upload 0과 progress 불변도 검사한다. native 회귀는 모든 shape·compound/chain·offset·
disabled body·floor/높이·rigid snapshot·생성량/순회 상한을 추가한다.
보고서·스크린샷은 `artifacts/spatial-scene-consumer-*/`에 남는다.
`spatial-environment-browser-fixture.mjs`는 다리/벽 receiver 차폐와 아래 광원의 윗면 비조명,
alpha 구멍·동적/화면 밖 caster, 직교/원근 실제 거리 DOF·refocus·노출/톤 매핑·색 보정·fog camera 이동,
HUD 불변·legacy/linear-sRGB 입력·현재 FBO composite·배경 debug coverage를 같은 gate에서 검사한다.
환경 진행 v7은 fresh Engine/renderer의 paused 상태·설정·전체 픽셀 차이 0을 확인한다.
실제 GL cube 6면·draw 비용, warm object 할당 0·terrain upload 0, HDR/cube bytes, invalid packet draw 0과
disable/destroy 해제를 확인한다. shadow/DOF PNG도 저장한다.
추가 회귀는 외부 scissor/color mask 상태의 유지와 내부 HDR/cube의 독립 작업,
cold/resize debug-only feedback 방지, 불완전 cube 생성 후 재시도, 같은 frame flat HUD 유지와
전체 flat frame 전환 후 effect target 해제를 검사한다.
소프트웨어 Chromium 정합성/CPU submission 측정은 실제 모바일 GPU 성능 보장을 대체하지 않는다.

## 모델 고도화: 재질 batch·움직이는 묶음·청크/LOD

소스 primitive가 32개 이하면 기존 순서와 draw 구성을 유지한다. 그보다 크면 동일한 정규화 재질
(base/normal/emissive texture·sampler·색·unlit·alpha cutoff·양면)을 공유하는 정적 geometry를 병합한다.
정점을 이어 붙이고 index를 다시 지정하며 최종 batch가 32개를 넘으면 거절한다. geometry·image·등록
상한은 유지한다. GLB/glTF의 알 수 없는 required extension과 지원하지 않는 material extension은
재질 이름/인덱스가 포함된 진단으로 거절한다. emissive strength는 광원/GI를 생성하지 않는다.

`addSpatialModelAssembly`의 `motion:"kinematic"`은 native root body와 `spatial.attachments`를 생성한다.
자식 model/collider는 static body와 heightSpan을 가지며 Rust가 root의 XY·elevation·yaw로부터 계산한다.
root의 native body rotation은 초기 authored yaw에 더해지고 자식 OBB에도 적용된다. floor를 생략한
proxy는 root floor를 따르고, 명시한 proxy floor는 유지한다. 움직이는 terrain/connection은 거절한다.
static 기본 묶음은 기존처럼 한 번 컴파일한다. moving root의 body는 collider proxy를 운반하는
kinematic transform이며 운반체 자체를 solid actor로 sweep하거나 탑승자를 함께 이동시키지는 않는다.

일반 attachment는 `{parent,x,y,elevation,yawDegrees,inheritFloor}`이며 수치는 parent body 좌표다.
x/y/elevation/yawDegrees 기본 0, inheritFloor 기본 true다. 최대 1,024개·깊이 8이고 순환·중복·
자기 참조·없는 handle·heightSpan 없는 parent·static이 아닌 child를 거절한다. root parent는 model이다.
연결된 root/child의 XY는 ±1,000,000 이내여야 하며 모델 GPU pose와 heightSpan도 유한해야 한다.
부모 제거는 자식을 연쇄 제거하며 generation이 다른 재사용 entity를 건드리지 않는다. 자식의 직접
position/height/rotation/velocity/force 변경은 거절한다. 유효하지 않은 root setter는 원복하며 자율
적분이 잘못된 pose를 만들면 마지막 유효 root pose로 복구하고 선속도·각속도를 중지한다.

저장 v8은 root model의 native `spatialPose.rotationRadians`를 선택적으로 보존한다. attachment child의
공간 pose는 별도 저장하지 않고 fresh restore 시 root에서 재계산한다. root yaw가 0인 기존 static
문서는 v5/v6/v7 capture/hash를 유지하며 v2~v7 읽기도 유지한다. 경로·LOD 선택 상태·GPU ID는 저장하지
않는다. fresh engine에는 모든 referenced model 자원을 먼저 등록한다. graph/pose/content를 cold preflight하며, 실패한 native progress restore는 기존 pose를 유지한다.

`spatial.modelChunks`는 visual GPU residency용 world AABB다. 물리·terrain·navigation은 내리지 않는다.
최대 64개이고 min/max는 `{x,y,elevation}`, `loadDistance`는 카메라에서 AABB까지의 진입 거리,
`unloadDistance`는 더 큰 이탈 거리다. 단위는 world unit이며 범위는 ±1M/거리 0..1M이다.
각 model의 `chunk`는 해당 ID를 참조한다. inactive chunk는 camera draw에서 제외하지만 light frustum에
있는 shadow caster는 유지한다. active chunk의 camera 밖 모델도 GPU resident 상태를 유지한다.

각 model의 `lods`에는 `{asset,contentId,minDistance}`를 최대 3개 추가한다. 기본 asset은 거리 0이고
거리값은 양의 오름차순이다. Rust가 camera-eye와 model origin의 3D 거리를 비교하며, 먼 단계 전환은
threshold×1.1, 가까운 단계 복귀는 threshold×0.9로 경계 진동을 줄인다. 모든 단계의 공통 보수 bounds를
사용하고 scene 제출 예산은 instance마다 단계별 최대 primitive/triangle 수로 검사한다.

```ts
spatial.modelChunks = {
  village: {
    min: { x: -100, y: -100, elevation: 0 },
    max: { x: 100, y: 100, elevation: 160 },
    loadDistance: 600, unloadDistance: 800,
  },
};
spatial.models.house = {
  asset: "house", contentId: house.contentId, chunk: "village",
  lods: [{ asset: "house-low", contentId: houseLow.contentId, minDistance: 400 }],
};
```

모든 LOD의 CPU asset은 apply 전에 load/register한다. `SpatialModelAssetCache` lease를 사용하면
다운로드·decode를 공유하고 사용하지 않는 CPU 자원을 LRU로 회수할 수 있다. 이 계약은 네트워크 지연을
프레임 안에 숨기는 자동 다운로드 시스템이 아니다. GPU는 native의 resident/그림자 reference로 준비·
공유·해제하며 warm frame upload는 0이다. 비활성화한 청크 재진입 시 bounded 동기 GPU upload가 필요하다.
`spatialModelPreparer`로 초기 모든 단계를 검증/준비할 수 있으며 실패 시 활성 씬을 유지한다.

모델 선택은 기존 80-byte render row ABI를 유지한다. TS는 frame마다 entity의 위치나 거리·층을
재계산하지 않는다. renderer의 `gpuTiming:true`, `beginGpuTiming/endGpuTiming/gpuTimingStats` 및
profiler의 GPU elapsed/resource/upload/draw metric으로 측정한다. timer unsupported/disjoint 상태는
측정값 0으로 위장하지 않는다. Headless software GPU 결과는 대상 기기의 frame-time 보장이 아니다.

### 밀집 모델의 instance 업로드와 그림자 캐시

프레임에서 실제 제출할 main/point 6면/sun의 연속 batch를 먼저 준비하고, instanced matrix를 한 번의
`bufferSubData`로 전송한다. 각 batch·face는 독립 offset을 사용해 같은 프레임에서 이미 제출한 matrix
영역을 다시 덮어쓰지 않는다. native 제출 순서·면별 visible subset과 단일 model의 uniform 경로를 유지한다.
shadow cache hit이면 main matrix만 준비한다. upload bytes는 실제 준비한 범위만 합산한다.
인스턴스 GPU 버퍼는 최대 1,024개×8 pass×64 bytes인 고정 512KiB이며 기존 64KiB보다 448KiB 크다.
모델의 primitive 색상·alpha cutoff는 main/shadow program의 uniform으로 전달한다. context-global
generic vertex attribute 값을 바꾸지 않으므로 frame마다 두 번 하던 `getVertexAttrib` 조회·복원이
필요 없다. terrain/billboard의 vertex color와 caller VAO/program 복원은 유지한다.
GPU object 수는 늘지 않으며 resourceStats.bufferBytes에 확보 용량을 반영한다.

model shadow key는 실제 shadow face mask·선택 asset/contentId·native matrix를 비교한다.
camera visibility/receiveShadow만의 변경, shadow mask가 없는 model의 변화나 미사용 자원 등록은
shadow map을 무효화하지 않는다. pose·선택 LOD·실제 cast/face 변경과 기존 terrain/caster/light/texture
revision은 계속 비교한다. cache는 CPU model handle이나 borrowed Wasm view를 frame 사이에 보관하지 않는다.
측정 가능한 구조적 비용을 줄이는 변경이며 특정 GPU의 지연 제거를 보장하는 계약은 아니다.
