# Data Scene 입체 지형·카메라·빌보드

현재 개발 소스는 **WebGL2 전용, opt-in 공간 렌더링의 첫 구현**을 제공한다.
높이가 있는 사각 지형과 2D 스프라이트를 같은 깊이 버퍼로 그린다. 직교/원근 카메라,
실제 지형 클릭, native kinematic 계단·경사 이동, 물리 elevation에 연결한 빌보드를 포함한다.
선택 `environment`로 고정 해상도·픽셀 스냅, normal atlas·점광원/태양광·PCF·그림자 캐시/컬링,
실제 거리 DOF·actor 초점·색 보정·안개를 제공한다.
기존 beta 설치본에 이 기능이 있다고 가정하지 말고 아래 API가 포함된 빌드를 사용한다.

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
| `color` | 기본 `[0.6, 0.65, 0.7, 1]`, 채널 0..1, alpha=1. renderer 작업 색 공간의 RGB |
| `textureId` | 선택 numeric asset texture id 0..16777214, 생략하면 단색 |

최대 256개 surface를 지원하며 같은 floor의 footprint 겹침은 거절한다. 서로 다른 floor는 겹칠 수 있다.
한 원천에서 윗면·옆면·아랫면의 12개 삼각형과 기존 native tile height metadata를 만든다.
텍스처 UV는 각 면의 0..1이다. 임의 mesh, 다각형 지형, mesh 모델링 API는 제공하지 않는다.

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
추산은 collider 없는 alive entity도 포함하며 한 frame의 최소 이동조차 실행할 수 없는 요청은 미리 거절한다.
미세 속도는 f64 잔여 이동량을 다음 frame으로 이어가고 실제 변위만 차감한다.

`dataSceneSpatialMoveStats(): SpatialMoveStats | undefined`는 낮은 빈도로 읽는 진단이다.
`searchNodeCount`(확장 node), `edgeProbeCount`, `probeWorkUnits`는 마지막 탐색 시도,
`waypointCount`/`remainingWaypointCount`는 설치한 경로, `searchCount`는 현재 공간 설정의 누적 탐색 횟수다.
frame 추종은 검색 횟수를 늘리지 않는다. 전체 지형 격자가 너무 크거나 통로가 선택한 격자보다 좁으면
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

`WebGL2Renderer.supportsSpatialScene`은 true다. WebGPU와 이 capability가 없는 custom renderer는
공간 packet을 명시적으로 거절한다. `renderToTexture`의 공간 capture도 아직 지원하지 않는다.
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

`SpatialBillboardSpec.normalTextureId`는 선택 numeric texture ID다. color/normal은 같은 크기의 atlas이며
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
GPU buffer는 첫 nonempty frame에 생성하고 native `vertexCount×44` bytes를 매 frame 업로드한다.
debug off에서는 line draw/upload가 0이다. 이 상한은 실제 GPU 시간/FPS 보장이 아니다.

## Buffer·저장·비용

현재 `renderCommandBuffer.spatial`은 version 2 / vertexStride 11의 borrowed Wasm view다.
각 vertex는 position3, UV2, RGBA4, texture ID, cutoff로 44 bytes다. camera는 행렬16 + numeric camera12다.
terrainRevision과 vertex count를 함께 전달하며, 지형은 revision 또는 Wasm memory 변경 때만 GPU에 재업로드한다.
v2의 필수 `terrainDrawRanges`는 `Uint32Array`의 `[firstVertex, vertexCount]` 쌍이다. Rust `repr(C)` range는
8 bytes/u32 stride 2이며 각 범위는 전체 static terrain을 기준으로 한 절대 vertex index다.
범위는 정렬·비중복이며 first/count는 surface의 36 vertices에 맞고 count>0, 끝은 전체 vertex count 이하다.
빈 배열은 지형 전체 cull이다. 누락/잘못된 범위는 draw 전에 거절하며 full terrain으로 조용히 대체하지 않는다.
`terrainVertexCount`와 `terrain`은 가림 여부와 무관하게 전체 메시를 유지한다. camera-only 변화는
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
v2의 `terrainChunkCount`는 전체 surface 수, `visibleTerrainChunkCount`는 제출한 수,
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
authored 또는 runtime environment가 있는 공간 진행 capture는 **v7**이다. 일반 capture는 v5를 유지한다.
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
