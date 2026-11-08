# 조명·그림자·화면 효과 품질 고도화 계획

기준일: 2026-11-09

상태: 개발 진행 중 · 태양광 안정화부터 구현 · 실제 사용자 문제 장면의 픽셀 재현 대기

목표는 flat 2D와 HD-2D에서 광원·재질·그림자·발광·화면 효과가 예측 가능하게 결합하도록 만드는 것이다.
태양광 그림자의 안정화와 여러 광원의 올바른 합성을 먼저 다룬다. HDR, 노멀맵, Bloom, AO, 안개,
톤매핑 등 이미 있는 기능은 재구현 목록으로 세지 않는다.

이 문서의 단계·필드 후보·검증 조건은 제안이다. 현재 공개 계약은
[Scene Authoring](../engine/data-scene-authoring.md), [공간 계약](../engine/data-scene-spatial.md),
[Core API](../engine/public-api/core.md), 검증 명령은 [Smoke Check](../development/quality/smoke-check.md)를 따른다.
광원별 flat 차폐 합성은 [현재 합성 계약](../engine/data-scene-presentation.md#flat-점광원의-차폐-합성),
점광원 radial depth·태양 PCF·bias는 [공간 계약](../engine/data-scene-spatial.md)을 기준으로 재사용한다.
전체 PBR, 범용 3D, GI, visual editor 개발로 자동 확대하지 않는다.

## 1. 검토 기준과 증거 수준

- Ferrum2D 초기 검토 코드 기준: `d2200d832bddb720d849c35d94aa791118bb51b5`. 이후 구현한 계약은 공식 문서로 옮기고 아래에는 남은 작업을 유지한다.
- Godot 비교 기준: `b47a795aa585d7bdb589f465e6ffcf15ebb31b9b`의 Canvas/GLES3 및 Forward Clustered 경로.
- three.js 비교 기준: `a75739a7ae5f2c08d1d9f3e2e4ac27fdceee83de`의 WebGL shader/light 및 postprocessing 경로.
- 외부 기준은 조회한 개발 브랜치의 고정 commit이다. 안정 버전 전체 또는 모든 backend의 보장으로 확대하지 않는다.
- 코드에서 계산·순서·상한을 직접 확인한 것은 **구현 확인**, 실제 함수의 기하 계산으로 확인한 것은 **수치 재현**,
  화면상 정도·발생 빈도가 미확인인 것은 **시각 재현 필요**로 구분한다.
- 의도적으로 문서화한 근사나 성능 상한은 **기존 계약의 한계**, 계약과 문서가 다른 것은 **문서 불일치**다.
  다른 엔진과 다르다는 이유만으로 버그로 판정하지 않는다.

## 2. 현재 기능 지도

| 영역 | flat 2D | HD-2D Spatial | 이번 판단 |
| --- | --- | --- | --- |
| 점광원 | 원/타원 반경, falloff, 색·강도, 노멀용 높이 | 반경 감쇠, cone/penumbra, native 추적·선택 | 존재. 합성과 선택 안정성 보강 |
| 태양광 | 화면 additive + 별도 ground silhouette | 방향광 + 단일 직교 depth map | 존재. 방향 의미·caster·bias·범위 안정화 우선 |
| 환경광 | 색/alpha overlay | ambient + 하늘/지면 hemisphere | 존재. 새 lit 경로에서는 표면색에 곱하는 조도와 구분 |
| 노멀맵 | normal/coverage MRT, atlas/flip/회전 | billboard normal atlas, 모델 tangent normal | 존재. 반투명 근사·카메라 의존성 검증 |
| 그림자 | 점광원 사각 tile occluder 투영, 태양 ellipse/box/alpha silhouette | point cube 1개 + sun map 1개, hard/PCF3, cast/receive | 존재. 광원별 차폐·접촉·동작 안정성 강화 |
| 캐시·컬링 | tile shadow geometry cache, native ground cache | native caster/range revision, GPU shadow cache | 존재. 새 재질·proxy의 무효화 조건 연결 |
| 재질 | tint/palette/flash/additive/outline, 별도 normal binding | base color/normal/emissive/unlit, OPAQUE/MASK | specular/roughness·light mask 확장 후보 |
| HDR·색공간 | legacy 기본, WebGL2 linear-sRGB 선택. 중간 target은 8-bit normalized | 양 backend RGBA16F/rgba16float 장면 target, exposure | flat linear 지원과 HDR 지원을 구별 |
| Bloom | 전체 화면 25-tap, WebGL2/WebGPU 지원 | HDR 장면 32-tap, 양 backend 지원 | 존재. threshold·해상도·후처리 순서·비용 검증 |
| AO | 전용 depth AO 없음 | depth 기반 접촉 음영, normal 재구성 4 + 주변 12 samples | 존재. 전체 합성 색을 어둡게 하는 의미 재정의 |
| 안개 | 별도 물리적 공간 fog 없음 | camera view-depth 기반 색 혼합 | 존재. AO·발광·Bloom 결합 검증 |
| 톤매핑·색보정 | 전용 Spatial 환경과 별도 | exposure, none/Reinhard/ACES 근사, contrast/saturation/tint | 존재. 입력 단위·출력 변환을 명확히 유지 |
| DOF | 별도 spatial depth 없음 | 표준 13/고품질 25 samples, actor focus | 존재. AO·발광·Bloom과의 순서 검토 |
| 기타 화면 효과 | fade/CRT/vignette/glitch/pixelArt, 가상 해상도 | Spatial 합성 뒤 flat HUD 및 전역 후처리 | 장면 효과와 HUD까지 포함하는 효과의 범위를 구분 |
| 간접광·반사 | baked art 활용 | ambient/hemisphere 근사 | IBL/lightmap/probe/GI/SSR은 별도 후보 |

기능 지도의 코드 근거:
[2D 조명 타입](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/lightingTypes.ts),
[Spatial 환경 타입·검증](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/spatialEnvironment.ts),
[GLSL 조명/효과](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/webgl2SpatialShaders.ts),
[WGSL 환경](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/webgpuSpatialEnvironment.ts),
[WebGPU 전체 화면 효과](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/webgpuPostProcessShaders.ts),
[색공간](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/colorManagement.ts),
[flat target 형식](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/webgl2RenderTarget.ts),
[모델 재질 계약](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/spatialModel.ts).

### 재검토에서 바로잡은 판단

- 노멀맵·스포트라이트·hemisphere·발광·HDR·Bloom·AO·톤매핑이 모두 없다는 평가는 현재 코드와 맞지 않는다.
- WebGPU는 전체 화면 Bloom과 Spatial HDR Bloom을 지원한다. renderer 전역 `linear-srgb` 모드는
  아직 WebGL2 fallback 대상이다. Spatial 내부 linear HDR 계산과 전역 renderer 옵션은 다른 계약이다.
- flat `elevationRadians`가 그림자 길이를 바꾸지 않는 것은 명시된 기존 계약이다.
  Godot DirectionalLight2D의 Height도 노멀 반응에 쓰이고 그림자 길이를 바꾸지 않는다.
  HD-2D에서 기대하는 고도 기반 길이를 flat 계약에 자동 소급하지 않는다.
- 태양 shadow matrix에는 이미 texel snapping이 있다. 떨림의 원인을 단순히 snapping 부재로 결론내리지 않는다.

## 3. 확인한 문제와 개선 후보

우선순위 P1은 시각적 일관성과 기존 효과의 결합, P2는 제작 표현력·규모, P3는 추가 제품 범위다.
아래 우선순위는 보안/크래시 심각도가 아니다.

### L01 · P1 · flat 조명과 표면색의 관계

**구현 확인 / 기존 계약의 한계.** `WebGL2LightingPass`와 `WebGpuLightingPass`는 장면 위에
광원 RGB × alpha를 더한다. normal response는 alpha에 반영하지만 광원 pass가 albedo를 읽지 않는다.
검은 표면과 밝은 표면에 같은 빛 기여가 더해지고, 빈 배경도 밝아질 수 있다.
현재 `unlit` sprite preset도 후단 전체 조명을 피하는 개별 수신 mask를 뜻하지 않는다.

**방향:** 기존 overlay 경로를 보존하고, 표면색·ambient·광원별 visibility를 계산하는 opt-in lit 경로를 설계한다.
장식용 additive sprite는 계속 별도 효과로 둔다. 기본 노멀, 광원 높이, receiver와 투명 픽셀의 의미를 먼저 확정한다.

근거: [2D GLSL](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/webgl2ShaderSources.ts),
[GL pass](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/webgl2LightingPass.ts),
[GPU pass](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/webgpuLightingPass.ts),
[sprite preset](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/spriteMaterial.ts).

### S01 · P1 · billboard shadow proxy 제작·동작 범위 검증

기본 billboard caster는 표시 평면과 함께 카메라를 따른다. 일정한 형상이 필요한 경우의
`shadowOnly` 모델 attachment 계약은 [공간 모델 문서](../engine/data-scene-spatial.md)를 따른다.

**남은 작업:** 실제 캐릭터·나무 asset에서 표시 애니메이션 UV/flip·높이 변화·화면 밖 caster를 포함해
적절한 volume 크기와 피벗을 검증한다. 카메라 거리별 LOD 교체가 shadow silhouette에 미치는 영향과
proxy GLB의 collision/navigation metadata를 사용하는 authoring helper의 명시적 동작을 확인한다.
자동 proxy 생성·애니메이션별 proxy 전환은 별도 요구와 비용이 있을 때만 설계한다.

근거: [native billboard/caster](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/crates/ferrum-core/src/spatial_scene.rs),
[현재 revision 테스트](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/crates/ferrum-core/src/engine/tests/spatial_environment.rs).

### S02 · P2 · 곡면 수신면·실기기 접촉 품질 후속

현재 비교식·진단·회귀 명령은
[수신면·그림자 계약](../engine/data-scene-spatial.md#수신면-해상도와-bias-진단)과
[Smoke Check](../development/quality/smoke-check.md)를 따른다.
저해상도 곡면 PCF의 단일 접평면 근사와, 작성한 bias/normalBias가 과도한 장면의 접촉 분리는 구분한다.

**남은 작업:** 실제 게임 장면에서 기존 해상도/normalBias 설정으로 수용 가능한지 확인한다.
수용할 수 없는 곡면이 재현될 때만 별도 receiver 정보/필터를 검토하고 비용·완료 조건을 먼저 정한다.
같은 품질 조합에서 작은 caster 그림자의 보존도 확인한다. 전역 bias를 키우거나 authored normalBias를 자동 변경하지 않는다.
실물 GPU에서 정밀도·품질·성능을 측정하며, 낮은 정밀도를 사용하는 기기의 결과를 software adapter 결과와 구분한다.

### S03 · P1 · 태양 그림자 coverage와 화면 밖 caster 여유

현재 한 장의 고정 extent map이 camera target을 따라간다.
고정 지점이 camera pan만으로 범위 안팎에 드는 것이 확인된다. 기준축·내부 경계 fade의 현재 동작과
극점 제한은 [태양 방향광 계약](../engine/data-scene-spatial.md#태양-방향광과-pcf)을 따른다.

**방향:** texel snapping과 내부 경계 fade를 유지하면서 receiver 범위·화면 밖 caster 여유를 설계한다.
기준축·경계 전환 회귀를 유지하면서 pan/zoom에 따른 유효 coverage의 급변을 줄인다.
큰 맵/원근 카메라에서 단일 map으로 목표를 만족하지 못할 때만 cascade를 별도 단계로 검토한다.

근거: [native sun matrix](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/crates/ferrum-core/src/spatial_scene/environment.rs),
[shadow 범위 판정](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/webgpuSpatialShadows.ts).

### S04 · P1 · 방향·고도·그림자 옵션의 작성 의미

**구현 확인 / 작성 UX 불일치.** flat `directionX/Y`는 그림자가 뻗는 방향,
Spatial `direction`은 표면에서 태양을 향하는 방향이다. 뷰어는 같은 `Direction (°)` 라벨로 각각의 값을 표시한다.
flat 노멀용 고도와 별도 길이 배율, Spatial 고도·coverage·bias도 서로 다른 의미다.

**방향:** 저장 좌표계를 강제로 뒤집지 않고 UI/agent 설명을 구체화한다.
‘태양 방위/그림자 방향/노멀 입사각/그림자 길이 배율’을 구별하고, 변환 예와 미리보기의 실제 backend를 제공한다.
별도 preview 카메라와 저장된 게임 카메라 양쪽에서 같은 태양 설정을 확인한다.

근거: [flat sun](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/dataSceneSun.ts),
[Spatial sun](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/spatialEnvironment.ts),
[뷰어 조명 입력](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/apps/placement-viewer/src/placementLighting.ts).

### E01 · P1 · AO·발광·안개·DOF·Bloom 결합

**구현 확인 / 합성 정책 개선.** Spatial geometry 단계에서 diffuse + emission에 fog를 적용한다.
composite는 그 색에 DOF를 먼저 적용하고 AO를 곱한다. 따라서 직접광·발광·안개 색도 AO로 어두워진다.
Bloom은 AO/DOF 결과가 아니라 원래 HDR color target을 읽는다. 밝은 물체 본체와 halo의 처리 경로가 달라진다.
이는 현재 화면 공간 접촉 음영의 근사이며, 간접광만 가리는 물리적 AO와 동일하다고 설명하면 안 된다.

**방향:** AO가 어느 조명 성분에 적용되는지와 Bloom의 입력 단계를 명시한다.
권장 새 경로는 opaque depth/normal → AO → ambient/indirect 성분에 적용 → 직접광·specular·emission 합성 →
fog → DOF → Bloom → exposure/tone map → 출력 변환이다. DOF와 Bloom의 세부 순서는 목표 연출 fixture로 확정한다.
이를 위해 필요한 prepass/MRT/중간 target 비용을 비교한다. 비용상 기존 접촉 음영을 유지하는 profile도 구별한다.

근거: [GL geometry/composite](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/webgl2SpatialShaders.ts),
[GPU geometry/composite](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/webgpuSpatialEnvironment.ts).

### E02 · P1 · 색공간·HDR·효과 범위의 경계

**구현 확인 / 지원 범위의 차이.** flat linear-sRGB는 선형 계산이지만 8-bit normalized target이라 HDR radiance를
그대로 저장하지 못한다. Spatial은 HDR target을 갖는다. 전역 WebGPU linear-sRGB는 명시적으로 거절하고
`createRenderer`가 context 선택 전에 WebGL2로 fallback한다. legacy와 linear 옵션을 혼합하면 threshold·색 반응도 달라진다.

**방향:** 새 lit/HDR profile은 입력 색 공간, 연산 공간, 저장 형식, 출력 변환을 하나의 계약으로 정의한다.
색 텍스처는 sRGB decode 1회, normal/roughness/mask는 data, alpha는 linear로 유지한다.
HDR → tone map → sRGB encode는 1회이며 HUD와 전역 화면 효과가 어느 단계에 들어가는지 고정한다.
기존 renderer 옵션의 기본값은 유지한다. WebGPU 전역 linear parity는 별도 완료 조건으로 다룬다.

근거: [색 관리](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/colorManagement.ts),
[flat target](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/webgl2RenderTarget.ts),
[renderer 선택](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/createRenderer.ts),
[WebGPU preflight](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/webgpuRendererBackend.ts),
[기존 색공간 픽셀 검증](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/tests/smoke/color-management-browser-page.mjs).

### E03 · P2 · Bloom·AO·DOF의 품질/비용 확장

**기존 계약의 한계.** flat Bloom은 25 samples, Spatial Bloom은 32 samples의 제한된 반경 gather다.
AO와 DOF까지 함께 켜면 한 composite draw여도 pixel당 sampling 비용은 커진다.
현재 draw count가 작다는 사실만으로 효과가 싸다고 판정할 수 없다.

**방향:** 작은 반경 경로를 보존하고, 넓은 halo가 필요한 경우에만 저해상도 bright-pass/분리 blur 또는 mip chain을 비교한다.
threshold를 exposure 전/후 어느 값으로 해석할지 정하고, emissive-only와 전체 밝기 기반 Bloom의 필요를 구분한다.
AO는 depth 경계 halo·얇은 geometry·카메라 이동, DOF는 foreground 누출·발광체·HUD 제외를 검증한다.
temporal history는 ghosting/카메라 cut/reset 계약을 설계하기 전 추가하지 않는다.

근거: [전체 화면 GLSL](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/webgl2ShaderSources.ts),
[Spatial GLSL](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/webgl2SpatialShaders.ts),
[효과 통계](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/renderer.ts).

### L03 · P2 · 광원 선택과 다중 그림자 예산

**구현 확인 / 상한과 전환 한계.** Spatial은 authored 16개 중 최대 4개를 camera target 기반 점수로 선택한다.
shadow owner는 우선 고정하고, 다른 광원은 순위로 교체한다. 점수의 연속성은 선택 집합의 연속성을 보장하지 않는다.
점광원 shadow는 1개다. ‘광원 16개 지원’은 16개가 동시에 모든 수신면을 비춘다는 뜻이 아니다.

**방향:** 우선 현재 상한 안에서 기여도·범위·화면 수신면을 고려한 선택과 전환 완화를 비교한다.
hysteresis/fade에 상태가 필요하면 Rust가 소유하고 snapshot/replay·teleport/reset 의미를 결정한다.
동시 shadow owner 증가는 atlas/face 비용·캐시 정책을 측정한 뒤 별도 예산 단계에서 결정한다.
화면에 중요한 빛이 빠졌을 때 authored/active/culled/dropped 이유를 report에 남긴다.

근거: [Rust 선택](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/crates/ferrum-core/src/spatial_scene/lighting_upgrade.rs),
[현재 상한](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/spatialEnvironment.ts),
[shadow cache](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/spatialShadowCache.ts).

### M01 · P2 · 재질과 빛 수신 제어

**기존 계약의 한계.** 모델은 명시적 diffuse profile이고 metallic/roughness texture를 거절한다.
flat에는 specular/shininess map·전용 emission map·광원 texture/cookie·light/shadow 수신 mask가 없다.
Spatial cast/receive bool은 존재하나 광원별 mask와 같지 않다. 반투명 BLEND 모델도 현재 계약 밖이다.

**방향:** 먼저 lit/unlit·emission·선택적 수신과 간단한 specular/roughness를 제한된 재질 profile로 설계한다.
색/normal/추가 map의 UV·atlas·flip·sampler·색공간·재import 계약을 함께 유지한다.
cookie/2D spot/다각형 occluder는 동일 lit 경로 위에서 추가한다. glTF 전체 PBR를 받아 조용히 무시하는 방식은 금지한다.

근거: [모델 importer](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/spatialModel.ts),
[sprite material](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/spriteMaterial.ts),
[2D light 계약](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/lightingTypes.ts).

### V01 · P1 · 검증 강도와 실행 위치

**구현 확인 / 검증 보강 필요.** normal 회전/flip, 실제 shadow pixel, PCF, cast/receive, 색공간,
복구·자원 수명 등의 browser fixture가 이미 있다. 일부 신규 효과 검증은 ‘ON/OFF 픽셀 차이’가 중심이다.
이것만으로 다중 광원 에너지 보존·접촉 위치·카메라 독립성·발광/AO 결합을 보장하지 못한다.

`ci.yml`은 현재 `workflow_dispatch` 전용이다. validate job에는 Spatial 양 backend·color management·normal 등의
검증이 있지만, 전용 `smoke:lighting`/`smoke:lighting-webgpu`는 조건부 extended matrix에 있다.
일반 push/PR에서 자동 검증된다고 기술하지 않는다. workflow trigger 정책 변경은 이 계획의 자동 실행 범위가 아니다.

근거: [CI 정의](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/.github/workflows/ci.yml),
[Spatial 품질 픽셀 검사](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/tests/smoke/spatial-quality-browser-fixture.mjs),
[GPU 효과 검사](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/tests/smoke/spatial-webgpu-environment-browser-fixture.mjs),
[normal 검사](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/tests/smoke/sprite-normal-2d-browser-fixture.mjs),
[profiler](https://github.com/silbaram/ferrum2d/blob/d2200d832bddb720d849c35d94aa791118bb51b5/packages/ferrum-web/src/runtimeProfiler.ts).

## 4. 외부 코드에서 가져올 원칙

| 참조 | 확인한 구현 | Ferrum2D 적용 범위 |
| --- | --- | --- |
| [Godot Canvas shader](https://github.com/godotengine/godot/blob/b47a795aa585d7bdb589f465e6ffcf15ebb31b9b/drivers/gles3/shaders/canvas.glsl) | 표면색·노멀·specular 반응, 광원별 그림자 후 합산 | 새 flat lit 합성과 다중 광원 fixture의 기준 |
| [Godot Light2D](https://github.com/godotengine/godot/blob/b47a795aa585d7bdb589f465e6ffcf15ebb31b9b/scene/2d/light_2d.h) | texture, item/shadow mask, blend, PCF 옵션 | 필요가 확인된 작성 옵션부터 제한적으로 도입 |
| [Godot Forward Clustered](https://github.com/godotengine/godot/blob/b47a795aa585d7bdb589f465e6ffcf15ebb31b9b/servers/rendering/renderer_rd/shaders/forward_clustered/scene_forward_clustered.glsl) | 입사각 기반 normal offset, 광원 방향 성분 제거, split sampling | bias와 필터를 함께 평가하는 기준. 전체 renderer 이식은 아님 |
| [three.js LightShadow](https://github.com/mrdoob/three.js/blob/a75739a7ae5f2c08d1d9f3e2e4ac27fdceee83de/src/lights/LightShadow.js) | light/target 기반 shadow camera, bias/normalBias/radius/update 정책 분리 | shadow 원인 진단과 명시적 품질 옵션 |
| [three.js 직접광/재질](https://github.com/mrdoob/three.js/blob/a75739a7ae5f2c08d1d9f3e2e4ac27fdceee83de/src/renderers/shaders/ShaderChunk/lights_physical_pars_fragment.glsl.js) | diffuse/specular 성분 분리, roughness 기반 BRDF | 제한된 재질 확장의 수학적 참고 |
| [three.js AO 적용](https://github.com/mrdoob/three.js/blob/a75739a7ae5f2c08d1d9f3e2e4ac27fdceee83de/src/renderers/shaders/ShaderChunk/aomap_fragment.glsl.js) | indirectDiffuse/indirectSpecular 등에 occlusion 적용 | AO가 발광까지 곱하지 않도록 하는 성분 분리 참고. AO 생성 방식 비교는 아님 |
| [three.js UnrealBloomPass](https://github.com/mrdoob/three.js/blob/a75739a7ae5f2c08d1d9f3e2e4ac27fdceee83de/examples/jsm/postprocessing/UnrealBloomPass.js) | half-float bright pass, 여러 해상도의 분리 blur와 합성 | 넓은 halo의 품질/대역폭 비교 후보 |
| [three.js OutputShader](https://github.com/mrdoob/three.js/blob/a75739a7ae5f2c08d1d9f3e2e4ac27fdceee83de/examples/jsm/shaders/OutputShader.js) | tone mapping 후 output transfer | HDR 결과의 마지막 출력 변환을 명시적으로 분리 |

[three.js 색공간 문서](https://threejs.org/manual/pages/color-management.html)와
[Godot 환경 효과 문서](https://docs.godotengine.org/en/stable/tutorials/3d/environment_and_post_processing.html)는
입력/연산/출력 공간과 환경광/노출/후처리의 역할 구분에 참고한다.
[Godot 2D 조명 문서](https://docs.godotengine.org/en/stable/tutorials/2d/2d_lights_and_shadows.html)는
2D virtual height와 그림자 길이를 혼동하지 않는 근거다.
외부 엔진의 기본값·성능·기능 집합을 Ferrum2D의 보장으로 가져오지 않는다.

### 그림자 표현 추가 검토와 적용 판단

다음 비교는 그림자 전용 후속 검토다. Godot/three.js는 위 고정 commit을 사용하며 Unity URP는
`0efc28ea742b1966b9dd9cc4489e58b986a13faf`의 shader를 확인했다. 외부 API의 기본값이나 backend 지원을 그대로 복제하지 않는다.

| 관점·소스 | 확인한 차이 | Ferrum2D 적용 판단 |
| --- | --- | --- |
| [Godot directional bias·split·fade](https://github.com/godotengine/godot/blob/b47a795aa585d7bdb589f465e6ffcf15ebb31b9b/servers/rendering/renderer_rd/shaders/forward_clustered/scene_forward_clustered.glsl) | 입사각 기반 normal offset과 light 방향 bias 분리, split 혼합과 거리 fade | 현재 단일 map은 내부 경계에서 직접 조명으로 전환. coverage/외부 caster 여유는 남은 S03, cascade는 별도 비용 단계 |
| [three.js LightShadow](https://github.com/mrdoob/three.js/blob/a75739a7ae5f2c08d1d9f3e2e4ac27fdceee83de/src/lights/LightShadow.js) | depth bias·normalBias·filter radius·map 크기를 분리 | 기존 world 단위 bias 계약을 유지하면서 필터 때문에 생기는 접촉 손실을 별도로 해결 |
| [Unity URP bias](https://github.com/Unity-Technologies/Graphics/blob/0efc28ea742b1966b9dd9cc4489e58b986a13faf/Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl) | light 방향 offset과 입사각에 따른 normal offset을 구분 | caster/receiver 보정을 혼동하지 않으며 기존 normalBias 의미를 조용히 변경하지 않음 |
| [Microsoft 수신 평면 깊이 보정](https://learn.microsoft.com/en-us/windows/desktop/DxTechArts/cascaded-shadow-maps) | PCF 이웃 texel에서 수신 평면의 깊이를 계산해 큰 공통 bias로 인한 분리를 줄임 | 현재 태양 경로는 이 원칙을 기하 노멀·직교 basis로 구현. 실제 사용·허용 오차는 공식 태양 계약과 Smoke Check에서 관리 |
| [Godot shadow-only geometry](https://github.com/godotengine/godot/blob/b47a795aa585d7bdb589f465e6ffcf15ebb31b9b/scene/3d/visual_instance_3d.h)와 [three.js 별도 depth/distance 재질](https://github.com/mrdoob/three.js/blob/a75739a7ae5f2c08d1d9f3e2e4ac27fdceee83de/src/renderers/webgl/WebGLShadowMap.js) | 표시와 그림자 작성 역할을 분리할 수 있음 | 명시적 shadowOnly volume proxy를 사용. S01은 실제 asset·애니메이션·LOD 범위 검증을 이어감 |
| [three.js PCF/VSM](https://github.com/mrdoob/three.js/blob/a75739a7ae5f2c08d1d9f3e2e4ac27fdceee83de/src/renderers/webgl/WebGLShadowMap.js) | hardware 비교 필터와 VSM의 별도 target/blur, point VSM 제한 | 현재 deterministic hard/PCF3는 유지. 큰 soft shadow는 대역폭·메모리·light bleeding·pixel-art 기준을 정한 뒤 선택 |
| [Godot Canvas 광원별 shadow 합성](https://github.com/godotengine/godot/blob/b47a795aa585d7bdb589f465e6ffcf15ebb31b9b/drivers/gles3/shaders/canvas.glsl) | 해당 light_color에 shadow를 적용하고 다른 광원과 합산 | 현재 [flat 차폐 합성](../engine/data-scene-presentation.md#flat-점광원의-차폐-합성)을 L01에서 재사용. Ferrum2D의 RGB 투과 필터 계약을 유지 |

후속 검증은 S01의 실제 asset·애니메이션·LOD, S03의 coverage 확장에 집중한다.
S02의 곡률 인지 필터·실물 GPU 측정과 cascade는 필요·비용·대상 환경을 정한 뒤 별도로 착수한다.
기존 그림자 픽셀·자원 회귀와 근사 한계는 공식 공간 계약과 Smoke Check를 기준으로 유지한다.

## 5. 공통 설계·호환성 원칙

1. **기존 외관 보존:** legacy overlay/diffuse/current shadow 정책은 기존 문서에서 같은 의미를 유지한다.
   새 계산은 명시적인 profile 또는 version으로 선택한다. 버그 수정도 영향 장면과 before/after를 남긴다.
2. **공통 수학, backend별 자원:** 좌표·단위·attenuation·bias·threshold의 검증 벡터를 공유한다.
   GLSL/WGSL은 같은 벡터와 실제 픽셀로 비교한다. 범용 render graph를 선행 도입하지 않는다.
3. **Rust 소유:** 동적 광원 pose/선택/추적, caster/proxy/receiver geometry, camera 기준 데이터와 revision은 Rust에서 결정한다.
   TS는 cold authoring/asset validation과 GPU allocation·pass·sampling을 담당한다. entity별 Wasm 호출을 추가하지 않는다.
4. **ABI 변경은 명시적으로:** 기존 15-float sprite command 및 environment v1~v4 reader를 보존한다.
   새 sidecar/environment version이 필요하면 repr(C), stride/size, 길이·finite·range validation,
   mixed-version 거절, wasm.d.ts/facade·snapshot/restore를 같은 단계에서 다룬다. 예약 영역을 무계약으로 재사용하지 않는다.
5. **자산·저장:** 추가 map/proxy/mask는 안정적인 asset ID와 deterministic JSON/patch를 사용한다.
   OFF 상태의 값, Undo/Redo, 저장/재열기, native 적용 실패의 원자성을 유지한다.
6. **실패와 복구:** capability 부족은 context 선택 전에 명시한다. 기능을 조용히 빼지 않는다.
   target 재할당 실패, resize/DPR, 장치 손실·복구, scene 교체 후 늦은 asset 완료를 검증한다.
7. **효과 범위:** Spatial scene 효과는 기존처럼 HUD 앞에서 끝낸다.
   전역 fade/CRT 등 화면 전체에 적용하는 효과는 별도다. flat lit 경로에서도 receiver/HUD 제외를 명시한다.
8. **비용:** disabled path의 추가 pass/target이 없어야 한다. warm frame의 자원 재사용·캐시 무효화 원인을 기록한다.
   HDR·normal·AO·Bloom 메모리와 texture sample 비용을 draw count와 별도로 평가한다.

## 6. 단계별 실행 계획

M0/M1을 진행 중이며 M2 이후는 미착수다. 아래 표는 남은 범위다.
각 단계는 아래 하위 작업별로 작은 논리적 변경으로 나누며, 전체 단계를 한 PR로 묶지 않는다.
`lightingProfile`, `shadowCasterMode`, `lightMask` 같은 명칭은 설계 후보이지 새 공개 API가 아니다.

| 단계 | 작업·주요 책임 경로 | 선행 조건 | 완료 기준 |
| --- | --- | --- | --- |
| M0 재현과 계약 | 문제 장면 최소화, 검증 행렬, 색/단위/profile 초안. `tests/smoke`, `docs/engine` 계약 설계 | 없음 | legacy baseline, 실패 재현 또는 한계 분류, backend/capability·허용 오차·성능 측정 환경 확정 |
| M1 태양광 안정화 | S01 proxy asset/LOD·애니메이션 검증, S03 coverage/caster 여유, S04 작성 설명. S02는 실제 장면의 필요·비용 판단 후 별도 확장. Rust spatial + 양 shader + viewer | M0 | 태양/카메라 sweep·접촉·범위 경계 fixture 통과, 기존 mode 저장/복원 유지 |
| M2 flat lit 합성 | L01. 기존 광원별 visibility를 재사용해 표면색·수신 제어 결합, opaque/cutout 우선. lighting pass + native sidecar가 필요하면 동반 | M0의 색/호환 계약 | 검은/흰 표면, red/blue 두 빛, 중복 차폐물, unlit/HUD, alpha fixture 통과 |
| M3 효과·색공간 정합 | E01/E02. AO 성분·emission·fog·DOF·Bloom 입력, flat HDR 선택, 전역 WebGPU linear parity | M0 계약. flat HDR 연결은 M2 새 lit 경로에 의존 | 조합 순서·HDR 범위·encode 1회·HUD·fallback·복구 검증, 기존 profile 보존 |
| M4 제작 표현력 | M01. emission/specular/roughness의 제한 profile, light/shadow mask, 2D spot/cookie·polygon occluder | M2/M3 | 자산 fixture·atlas/flip·mask 독립성·저장/재import·양 backend 결과 검증 |
| M5 규모·성능 | L03/E03. 광원 전환 안정화, 다중 shadow 예산, 넓은 Bloom, 필요 시 light 수신 후보 가속 | 앞 단계 대표 장면·측정 | 선택 경계 왕복 안정성, 실제 비용 개선 또는 명시적 품질 증가, preset별 예산·복구 검증 |
| M6 선택 확장 | baked lightmap/probe, 제한 IBL, height fog/light shaft, PCSS/cascade 등 | 실제 게임 요구·별도 비용/범위 설계 | 후보별 별도 완료 조건. 앞 단계 완료에 필수 아님 |

### 먼저 실행할 작업 단위

1. **M0-a:** 고정 태양 + billboard/mesh/지형 + orbit/pan, 발 접촉·창문·벽이 있는 최소 재현 씬을 만든다.
   문제 장면이 확보되면 같은 fixture에 축약하고, 원본 asset·설정·backend·GPU·DPR를 함께 보관한다.
2. **M0-b:** legacy/new profile의 기대값을 정한다. 기존 smoke를 늘리는 것과 바꿔야 하는 기대값을 구별한다.
3. **M1-a:** 캐릭터/나무 billboard에 작성한 shadowOnly volume proxy를 실제 asset에서 비교한다.
   회전 카메라, 애니메이션 UV/flip, 물체 회전, 높이 변화, offscreen caster를 포함한다.
4. **M1-b:** M0에서 새로 확보한 실제 문제 장면을 기존 접촉·bias 회귀와 비교한다.
   설정 문제·문서화한 근사 한계·새 결함을 분류하고, 새 결함이면 effective bias·해상도를 기록한 fixture로 고친다.
   곡면 필터 확장이 필요하면 S02의 대상 장면·비용 조건을 먼저 확정한다.
5. **M1-c:** 기존 기준축·경계 전환 회귀를 유지하면서 태양 고도 pole 근방·낮은 고도·카메라 pan/zoom에서 coverage와 외부 caster 여유를 검증한다.
6. **M2-a:** opaque/cutout flat 장면에서 광원별 visibility + albedo 합성을 먼저 완성한다.
   반투명 다중 layer의 완전한 광학 합성은 별도 범위로 남긴다.

M1과 M2의 수학적 계약은 M0에서 함께 정하지만, 시각 검증과 리뷰는 별도 변경으로 수행한다.
M3의 Spatial 효과 결합 검증은 M2의 flat renderer 구현을 기다리지 않고 진행할 수 있다.
M4/M5를 시작하기 위해 모든 M6 기능을 기다리지 않는다.

## 7. 회귀 장면과 판정 방법

아래는 추가하거나 유지할 검증 요구사항이다. 현재 통과한 테스트 목록을 뜻하지 않는다.
픽셀 오차는 M0에서 backend/색공간별로 고정하고, 큰 전체 이미지 차이 하나로 합격시키지 않는다.

| fixture | 핵심 판정 |
| --- | --- |
| 검은/회색/흰 표면 + 한 빛 | 새 lit의 반사 성분은 albedo에 비례. 검은 표면에 emission이 없으면 diffuse가 생기지 않음 |
| 빨강 A + 파랑 B + A만 차폐 | B 기여 유지. A를 완전히 가린 결과를 A 비활성 결과와 비교. ambient도 보존 |
| 한 광원 + 겹치는 두 occluder | 겹침 횟수로 차폐율이 반복 감쇠하지 않음 |
| 태양 + 고정 billboard + orbit | stable proxy mode의 world-space shadow footprint가 camera yaw에 독립. 현재 mode는 기존 결과 유지 |
| 태양 + mesh/terrain + pan/zoom | 카메라가 달라도 같은 world receiver의 차폐가 유지되는 내부 범위, 경계 fade·snap 허용 오차 측정 |
| 태양 고도 sweep | 0° 부근/81.9° 전후/90°에서 NaN 없음, grid/coverage 전환의 급변량 측정 |
| 얇은 상자·경사면·발 접촉 | acne 비율, contact gap, shadow 면적. hard/PCF·해상도·coverage·normalBias 교차 검사 |
| 발광체 + AO + 강한 직접광 | 선택한 AO 정책에서 emission/직접광 보존. body/halo와 fog 색의 일관성 |
| Bloom + exposure + DOF | 지정한 threshold 공간과 순서 준수, zero strength identity, HDR 하이라이트 구별, foreground 누출 제한 |
| normal atlas·회전·flip·반투명 | data texture로 샘플, 현재 UV 정합. 투명 layer 근사 한계와 fallback을 명시 |
| 5~16 authored lights + 경계 왕복 | 상한 준수, 선택/제외 사유, 단발성 pop·왕복 flicker·shadow owner 변화 기록 |
| lit/unlit·light mask·HUD | 지정한 수신/차폐 대상만 변화, Spatial HUD 제외, 전역 효과는 명시된 범위에만 적용 |
| save/restore·Undo·재import | 광원/proxy/material/quality 값과 OFF 설정 보존, stale asset/native rejection 원자성 |
| resize/DPR·pixelArt·device recovery | 위치/반경 단위 일관성, nearest 출력, 자원 회수, 복구 후 pixels/통계 정합 |

모든 fixture는 WebGL2와 실제 WebGPU 실행 여부를 기록한다. fallback 실행을 WebGPU 통과로 세지 않는다.
software adapter 결과와 실제 모바일/desktop GPU의 품질·성능 결과를 분리한다.

### 비용과 evidence

- 기존 `SpatialRendererStats`, `RendererResourceStats`, GPU timing, `RuntimeProfiler`/frame trace를 먼저 재사용한다.
- CPU frame/Rust/render, GPU frame 및 가능한 pass 시간, draw/triangle/upload, target 수·추정 bytes,
  shadow cache hit/miss 원인, authored/active/dropped lights, 실제 effect sample 설정을 남긴다.
- sample budget은 실행 시간 측정값이 아니다. 합쳐진 composite pass의 AO/Bloom 개별 비용은 ON/OFF 대조로도 측정한다.
- 해상도·DPR·pixelArt target, 광원/차폐물/재질 수, warmup·측정 프레임 수, 기기/브라우저를 함께 기록한다.
- preset의 절대 ms 예산은 M0 baseline과 목표 기기에서 정한다. 현재 smoke의 느슨한 상한을 제품 FPS 보장으로 해석하지 않는다.
- 비활성 기능의 추가 target/pass 0, 정적 shadow warm frame의 불필요한 draw/upload 0을 유지한다.
  새 buffer/metric은 수집 경로와 report validator까지 연결하고 미측정 값을 0으로 위장하지 않는다.
- 검증이 끝난 fixture는 의도한 aggregate와 현재 CI validate/extended 실행 위치에 연결한다.
  새 명령 이름만 추가하고 workflow에서 실행되지 않는 상태를 완료로 처리하지 않는다.

## 8. 단계별 변경 표면과 검증 명령

실행 위치·현재 계약은 [Smoke Check](../development/quality/smoke-check.md)를 우선한다.
아래 명령은 해당 표면을 구현할 때 적용하며 이 계획 문서 작성만으로 전부 실행할 의무를 만들지는 않는다.

| 변경 표면 | 적용할 기존 검증 |
| --- | --- |
| native 선택/caster/matrix/ABI | `cargo fmt`, `cargo clippy`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml`, `pnpm build:wasm`, `pnpm build` |
| TS renderer·공통 계약 | `pnpm --filter @ferrum2d/ferrum-web test`, 관련 lint/build, `pnpm validate:public-api-surface` |
| 2D light/normal/ground shadow | `pnpm smoke:lighting`, `pnpm smoke:lighting-webgpu`, `pnpm smoke:sprite-normal-2d`, `pnpm smoke:data-scene-presentation` |
| Spatial light/shadow/effects | `pnpm smoke:spatial-scene`, `pnpm smoke:spatial-webgpu-offscreen` |
| 색공간·전역 후처리·pixel 출력 | `pnpm smoke:color-management`, `pnpm smoke:camera-postprocess`, `pnpm smoke:pixel-postprocess`, `pnpm smoke:flat-pixel-perfect` |
| 자원·복구 | `pnpm smoke:gpu-resources`, `pnpm smoke:webgpu-recovery` |
| authoring·저장·템플릿 | `pnpm smoke:placement-viewer`, 변경 시 generated/template/package/consumer smoke 및 report validation |
| 문서·Pages | `pnpm validate:docs-links`, 문서 경로/사이트 변경 시 `pnpm build:pages`, `pnpm validate:pages-artifact` |

public API/아키텍처/회귀 기준이 실제로 바뀌는 구현 단계에서 `docs/engine/**`,
`docs/development/architecture/architecture.md`, `docs/development/quality/smoke-check.md`,
설치/사용이 달라지는 경우 `README.md`를 동기화한다.
구현이 끝난 항목의 현재 사용법·회귀 기준은 공식 문서에서 관리한다.

## 9. 범위 결정과 보류 조건

- **최우선:** 태양광 안정화, flat 광원별 합성, AO/발광 등 효과 결합, 재현 가능한 픽셀 검증.
- **다음:** 선택적 재질 반사·수신 제어·cookie/spot, 광원 선택 안정화, 비용이 검증된 Bloom 개선.
- **별도 설계 후보:** 제한 IBL/lightmap/probe, 다중 point shadow, cascade/PCSS, height fog/light shaft.
  필요 장면·메모리·shader 비용·WebGL2 fallback이 정해져야 착수한다.
- **현재 계획 밖:** 범용 3D 전환, 전체 glTF PBR, ray tracing/GI 시스템, volumetric froxel renderer,
  반투명 다중 depth의 완전한 합성, physical bokeh, 전체 게임 루프 Worker/threads, visual shader editor.
- 새 production 의존성은 계획에 없다. 외부 코드를 직접 가져오는 후속 작업은 해당 라이선스와 attribution을 유지한다.
- 실제 사용자 문제 장면·목표 기기가 아직 특정되지 않았으므로 시각적 심각도와 성능 예산은 확정하지 않는다.
  그 자료가 없어도 M0 최소 fixture와 기존 계약 분석은 진행할 수 있다.

각 단계가 완료되면 사용 계약과 검증 방법을 공식 문서로 옮기고 이 문서에는 남은 작업만 유지한다.
전체 완료 후에는 planning 관리 규칙에 따라 문서와 인덱스 참조를 정리한다.
