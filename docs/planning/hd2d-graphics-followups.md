# HD-2D 공간 기반과 그래픽 후속 설계

기준일: 2026-10-17. 상태: **P0 WebGL2·층 연결·다층 이동, P1/P2·다섯 그래픽 보강·N0 길찾기 예산 보강 구현. M1 정적 GLB 바위의 렌더링·충돌·저장 통합 및 M2 MASK/양면·normal/emissive 재질 구현. 자동 회귀 검증을 통과했으며 M3 WebGL2 공유 모델 인스턴싱·분리형 glTF 입력·공유 CPU 모델 캐시 구현. M2/M3 형식·runtime 부모 관계·실제 Blender/GPU gate 잔여**.
2026-10-04의 [#73 C1](https://github.com/silbaram/ferrum2d/issues/73) 효과 설계를 보존하되,
사용자 요구와 game-test 재현을 근거로 **입체 지형·카메라·높이/깊이·빌보드**를 먼저 구현한다.
아래 설계의 미구현 후보 필드와 확장 gate는 공개 API가 아니다. 현재 개발 소스의 P0 계약은
[Data Scene 공간 지형·카메라·빌보드](../engine/data-scene-spatial.md)에 정리했다. 기존 배포/평면 계약은
[Data Scene native runtime](../engine/data-scene-native-runtime.md),
[Data Scene presentation](../engine/data-scene-presentation.md),
[Physics Spec](../engine/physics-spec.md)을 따른다.

로컬 `artifacts/`는 영구 문서 저장소가 아니다. 완료된 과거 작업의 보고서·로그·검증 사본은
2026-10-17에 정리했으며, 아래 검증 결과는 당시의 실행 기록이다. 현재 미커밋 N0 검증은 `artifacts/hd2d-navigation-budget/`,
M1/M2 모델 검증은 `artifacts/hd2d-static-model/`에 유지한다. 사용 계약과 재검증 절차는 확정 문서·smoke 스크립트가 기준이다.

[옥토패스 개발진 인터뷰](https://www.unrealengine.com/spotlights/octopath-traveler-s-hd-2d-art-style-and-story-make-for-a-jrpg-dream-come-true?lang=ko)는
HD-2D의 시각적 콘셉트를 2D 픽셀과 3D 환경의 결합으로 설명한다. Ferrum2D의 다음 목표도
평면 효과의 추가보다 이 결합을 표현하는 공간 기반으로 잡는다. 특정 작품의 전체 미술 품질이나
기능 동등성을 구현 완료 기준으로 주장하지 않는다.

## 현재 재현과 공백

사용자가 제공한 `C:/Users/psj/projects/game-test/tests/repros/hd2d-presentation.json`은 설치 버전
`0.1.0-local.20261012083249491.ccc8e209`에서 다음 결과를 기록했다.

| 확인 항목 | 결과 | 해석 |
| --- | --- | --- |
| ground body Y / sprite Y | 480 / 312 | 평면 XY 투영 |
| floor 1, elevation 64 body Y / sprite Y | 480 / 312 | 물리 높이를 바꿔도 화면 높이가 같음 |
| 같은 층 벽 앞 ground 이동 X | 329, blockedX=true | 높이 기반 충돌 작동 |
| 다른 층 upper 이동 X | 400 | 다른 층 벽 통과 |
| 같은 층 / 다른 층 raycast | true / false | 높이 query 필터 작동 |

`ok: true`는 현재 제한을 재현했다는 뜻이다. 새 구현의 성공 조건으로 그대로 사용하면 안 된다.
2026-10-14에 현재 개발 소스의 실제 packed Wasm에서도 같은 재현 스크립트를 격리 실행했다.
body Y=480, sprite Y=312, `automaticVisualElevation=false`가 그대로 확인되었다.
결과는 위 재현 기록과 이 문서에 요약했으며 원본 게임 보고서는 변경하지 않았다.

기존 flat `engine/rendering.rs` 경로는 elevation을 draw sort key에만 사용한다. `Camera2D`와
`createDataSceneView`는 XY/groundYScale의 평면 변환이며 기존 15-float/60-byte command에는
최종 화면 사각형만 있고 world elevation·camera depth·terrain triangle 정보는 없다.
따라서 heightSpan, 지면 Y 압축, 발 정렬과 alpha 그림자를 실제 입체 지형/깊이 처리로 해석하지 않는다.

sprite command의 Y만 빼는 수정으로 완료 처리하지 않는다. 그렇게 바꾸면 평면 pointer 역변환,
entity label, shadow receiver와 cache, 지형 culling이 같은 높이를 따라가지 못한다.
기존 flat 경로의 heightSpan을 화면 pixel offset으로 암묵적으로 재해석하지 않는다.
새 spatial 경로에서 동일 native elevation을 투영·depth·picking·표시 anchor에 함께 연결한다.

## 첫 구현의 검증 상태

현재 개발 소스는 사각 terrain의 top/side/bottom mesh와 기존 tile height metadata를 함께 만들고,
직교/원근 camera의 snapshot을 WebGL2 depth와 native terrain picking에 공유한다. cylindrical
billboard·anchored bitmap label은 같은 native entity의 heightSpan elevation을 사용한다.
`spatial` authoring/JSON 재적용, 기존 15-float ABI 보존과 명시적 미지원 renderer 거절을 포함한다.

packed consumer smoke는 가로/세로·DPR 1/2에서 계단 0→16→32, 다리 가림·제출 순서 역전,
alpha 구멍·camera tilt/투영·offset canvas 클릭, postprocess depth, reset와 GPU 자원 해제를 통과했다.
100/500/1000 billboard의 구조적 draw/upload/할당 상한과 CPU submission을 기록했다.
`pnpm smoke:spatial-scene`과 `artifacts/spatial-scene-consumer-*/report.json`이 근거다.

2026-10-15 후속은 authored billboard의 XY/heightSpan/floor와 현재 camera를 공간 진행 v6으로 저장한다.
stable instance/surface ID로 fresh handle을 연결하며, 잘못된 pose/camera/surface는 activation 전에
거절하고 native progress 전체 batch를 검증한 뒤 commit한다. 일반 capture는 v5를 유지해 기존 flat
replay hash를 바꾸지 않는다. 가로/세로·DPR 1/2의 fresh engine/renderer 복원 후 framebuffer 픽셀 차이 0을 확인했다.
runtime terrain/billboard/actor 재설정 뒤 원래 문서로 저장하는 것은 거절하며 camera-only 변경은 지원한다.

같은 날 P0-E 화면 검증 후속으로 atlas 2 frame·상하좌우 flip·비중앙 발 pivot과 native 시간 진행/pause,
화면 밖 pivot, near plane 부분 절단·완전 cull·복귀, eye plane(w=0) 교차를 추가했다.
packed consumer의 가로/세로·DPR 1/2에서 실제 픽셀·geometry 수·draw/upload 비용을 함께 통과했다.
회전한 pivot/bounds는 native 회귀로 확인했다. 해당 조건에서 renderer 수정이 필요한 오류는 재현되지 않았다.
이 단계는 화면 검증 fixture 보강이다.

이후 P0-E의 surface 단위 terrain chunk culling을 구현했다. Rust가 전체 top/side/bottom bounds를
보수적으로 판정하고 ABI v2의 bulk u32 draw ranges로 전달한다. static mesh/physics/picking 원본은 유지하고
camera-only 변경 때 range만 갱신한다. 256 surface의 7개 camera 조건 × 가로/세로·DPR 1/2에서
v1 전체 제출과 framebuffer 차이 0(채널당 허용 3), steady terrain upload 0을 확인했다.
가로 기본 시점은 256→60 surface/3072→720 제출 삼각형, 세로 기본은 256→22/3072→264였다.
실제 GL draw/upload 호출을 통계와 대조하며, far plane 부근 float32 상쇄로 지형이 사라지던
경계 오류도 원래 camera 행렬의 오차량을 반영해 수정하고 native·GPU 회귀로 검증했다.
첫 구현의 chunk는 authored surface 하나이며 자동 grid 분할·LOD·streaming은 제공하지 않는다.
새 reader는 v1 full packet도 지원하지만 구 JS와 새 v2 Wasm을 혼합하지 않는다.

다음 후속으로 기본 꺼짐의 공간 debug geometry를 구현했다. 지형 외곽/빌보드 quad·발/native heightSpan을
같은 camera로 표시하며 depth test와 가려진 선 표시를 선택한다. 독립 optional debug v1 확장과
최대 16,384 line 예산, 별도 draw/upload/truncation 통계를 제공한다. 실제 GL 호출·가림/overlay 픽셀·
물리 높이/camera anchor·disable 화면 복귀는 packed consumer gate로 확인한다.
당시 기본 진단은 terrain/billboard/heightSpan 범위였으며 아래 후속에서 physics 표시를 확장했다.

이후 P0 층 연결 후속으로 optional `spatial.connections`의 명시적 양방향 shared-edge 연결을 구현했다.
실제 경계를 넘는 같은 entity의 floor/elevation을 갱신하고 source/destination 충돌·초기 겹침·폭·step/drop을
검사한다. 연결되지 않은 다리 underpass는 유지한다. native topology/rollback/미세 이동/다중 경계 회귀와
public consumer의 직접 이동·WASD·fresh v6 restore 화면 검증을 연결했다.
자동 연결 추론/overlap portal은 구현 범위에 포함하지 않는다.

다음 후속으로 `moveDataSceneSpatialActorTo`의 목적지 XY/floor 기반 native 경로 탐색·추종을 구현했다.
같은 floor 인접 지형과 명시적 층 연결을 4방향 격자 A*로 탐색하며 collision/step/drop을 실제 이동 경로로
검사한다. node/probe/중첩 sweep·sort 작업량에 상한을 두고 실패 요청은 기존 route와 actor pose/velocity를 보존한다.
동적 solid는 blocked로 멈추고 새 요청으로 재탐색한다. WASD 취소·pause·걷기/idle·f64 미세 이동량을 연결했다.
route는 저장하지 않으며 공간 v6 fresh restore 후 idle에서 새 요청으로 이동한다.
packed consumer gate에서 다리 위→같은 XY 아래층·입력·동적 장애물 우회·fresh restore와 비용 상한을 검사한다.
대규모 navmesh·다수 actor 목적지 이동·자동 replan은 이번 구현 범위 밖이다.

다음 P0-E 후속으로 native collider wireframe·접촉 진단과 floor ID stroke 표시를 추가했다.
모든 현재 collider shape와 compound/chain child의 offset·회전·enabled·heightSpan을 재사용한다.
접촉은 실제 spatial 이동 hit와 기존 rigid impulse snapshot을 읽으며 render 때 재충돌 검사하지 않는다.
경로 탐색/gateway 가상 이동과 rollback hit를 제외하고 entity/shape/hit/vertex 생성량을 제한한다.
packed consumer gate에서 depth/overlay·층 문자·wall 접촉 픽셀, 실제 GL draw/upload·probe 격리를 검사한다.
캡슐/edge는 기존 debug glyph이며 전체 resting/trigger/gateway contact manifold·joint/CCD 공간 진단은 후속이다.

2026-10-16 푸시 전 리뷰에서 순수 HEAD와 비교해 투사체 tile-impact FSM 회귀를 수정했다.
이전 비교는 HEAD에 미커밋 변경이 포함되어 기존 실패로 잘못 분류했다. Data Scene의 solver-owned
이동 정책을 기존 World/슈터 경로와 분리했고, v5 capture로 의도적으로 바뀐 replay fixture는 버전과
관련 hash만 갱신했다. 원본 v3 save/hash는 별도 legacy fixture의 실제 Wasm 복원 테스트로 보존한다.
순수 HEAD·수정 전 재현과 비교한 최종 수정·검증 결과는 이 절의 기록과 회귀 테스트를 기준으로 한다.

P0 전체 roadmap을 닫지는 않는다. 대규모 경로 확장,
전체 contact manifold·joint/CCD 진단 확장,
실제 대상 GPU 예산과 WebGPU parity는 남아 있다. 임의 mesh·3D rigid-body solver는 제공하지 않는다.
P1의 최대 4개 점광원과 실제 표면 normal, 단일 광원 6면 depth cube 그림자를 구현했다.
지형의 top/side/under와 cutout billboard가 receiver/caster이며 화면 밖 caster·물리 높이·atlas alpha를 재사용한다.
P2의 실제 view distance DOF(최대 13 samples), HDR 노출/톤 매핑/색 보정·거리 안개를 구현했다.
공간 효과는 HUD 이전에 composite하며 환경 진행 v7을 새 엔진에 복원한다. 환경 없는 v5/v6 해시는 유지한다.
`EXT_color_buffer_float` 필수, 1,024 caster·면당 64 batch·HDR 8M pixel·blur 12 CSS px의 첫 구현이다.
이 시점의 잔여 후보는 아래 2026-10-16 강화 기록으로 갱신한다. PCSS·여러 point shadow light·물리적 bokeh·WebGPU parity·실제 대상 GPU 예산은 후속이다.

## 2026-10-16 외부 프로젝트 비교와 강화 후보

상태: **2026-10-16 다섯 강화 항목 구현·회귀 검증 완료**. 확정 사용 계약은 [공간 기능 문서](../engine/data-scene-spatial.md)를 따른다. 아래는 조사 당시의 근거와 범위 결정 기록이다. 비교 기준은 `feat/hd2d-enhancements`의
`5f0acc5`이며, 완료된 P0/P1/P2 slice를 다시 미완료로 분류하지 않는다. 아래 순서는 자료와
현재 코드를 대조한 Ferrum2D 적용 제안이다. 외부 엔진과의 기능·성능 동등성을 의미하지 않는다.
공식 문서와 공개 소스를 확인했으며 `stable`/`main` URL의 내용은 이후 바뀔 수 있다.

### 다섯 항목의 완료 기록

| 항목 | 구현한 범위 | 확인한 결과 |
| --- | --- | --- |
| 그림자 cache/culling | Rust 광원 면별 제출 범위·revision, TS GPU cache·texture 변경 감지 | 정지 장면 shadow draw/upload 0, 전체 제출과 픽셀 일치. 점광원+태양 사례는 168→108 shadow triangle, 잘못된 범위 5종은 draw 전에 거절 |
| 픽셀 안정화 | 고정 내부 해상도·nearest 정수 확대·여백, 직교 표시 camera snap | 160×90 내부 화면의 가로/세로·DPR 1/2에서 픽셀 블록 불일치 0. picking·label은 표시 camera/viewport 공유 |
| normal atlas | billboard paired atlas·flip 방향, material sidecar, cast/receive 선택 | 광원 방향·flip 반응과 sRGB/mismatched atlas 거절. 기본 material의 기존 texture bind 비용 유지 |
| 태양·PCF | 방향광 1개·유한 범위의 texel-snapped shadow map, hard/3×3 PCF | 지형 차폐·cast/receive, 점광원과 동시 사용, PCF self-shadow 회귀. 비차폐 지면의 밝기 유지 |
| DOF·초점 추적 | 기존 13 sample 유지, 고급 25 sample 전경/배경 CoC 합성, native actor view-axis 초점 | 전경 coverage·계단 높이 추적·HUD 제외, fresh v7 복원 후 초점 일치. 추가 중간 texture 없이 1회 composite |

`node tests/smoke/spatial-scene-browser-smoke.mjs`의 packed consumer 4조건은 모두 통과했다.
당시 공간 screenshot 56장(신규 품질 증거 20장 포함)을 확인했다. 평면 presentation smoke의
WebGL2 8조건·WebGPU 2조건, 기존 gameplay replay 17건도 통과했다.
Rust 1,366건·웹 857건과 lint/clippy/build/package 검증을 통과했다. 변경 이유·제한은 이 절에 요약했으며,
완료된 당시 로컬 검증 산출물은 삭제했다. 재검증은 현재 smoke 스크립트를 실행해 새 산출물을 만든다.

이번 완료는 위 다섯 항목의 WebGL2 구현과 정확성·제출량·자원 회귀 기준이다. 실제 대상 GPU의
시간 예산, 공간 WebGPU parity, PCSS/CSM·여러 point shadow light·GI·광선·물리적 bokeh는
포함하지 않는다. 고급 DOF도 단일 depth의 opaque/cutout 근사이며 숨은 배경 복원이나 다층
반투명을 해결하지 않는다. 아래의 "현재/후보/검토" 표현은 조사 당시 상태를 보존한 것이다.

### 완료 후 코드 리뷰

같은 날 전체 미커밋 차분을 다시 검토해 세 가지를 수정했다.

- 개별 필드는 유효하지만 태양 shadow matrix를 만들 수 없는 camera/environment 조합이 저장 복원
  후반에 거절되면 기존 장면이 먼저 교체될 수 있었다. read-only native preflight를 authoring과
  저장 camera 모두에 연결해 activation 전에 거절하고 기존 entity handle을 보존한다.
- 일부 태양 방향을 f32로 저장한 뒤 재정규화하면 numeric buffer가 달라졌다. 이미 정규화된
  f32 방향을 보존해 반복 저장·복원에서도 동일하게 유지한다.
- 그림자 target 재생성 때 texture revision 수집이 생략되어 다음 프레임에 다시 그리던 경우를
  수정했다. 첫 렌더 직후 cache hit와 shadow draw/upload 0을 실제 GPU 호출로 검사한다.

수정 내용과 재현·재검증 결과는 이 절에 요약했다.
수정 후 Rust 1,367건·웹 858건, packed 공간 4조건·평면 WebGL2 8조건/WebGPU 2조건,
기존 golden replay 17건과 build/lint/package 검증을 통과했다. 재검토 범위에서 미해결 차단 이슈는 없다.
위 첫 완료 기록의 검증 산출물과 구분하며 실제 하드웨어 GPU 시간·공간 WebGPU 잔여 범위는 유지한다.

### 비교 근거

| 참고 프로젝트·근거 | 확인한 방식 | Ferrum2D에서 강화할 부분 |
| --- | --- | --- |
| [PlayCanvas local shadow renderer 소스](https://github.com/playcanvas/engine/blob/main/src/scene/renderer/shadow-renderer-local.js), [광원 API](https://api.playcanvas.com/engine/classes/LightComponent.html) | shadow face별 camera frustum으로 caster를 cull하고, 그림자 갱신을 매 프레임/1회/정지로 선택 | 광원·면 기준 caster culling과 변경 감지 기반 shadow cache |
| [Bevy pixel grid 예제와 코드](https://bevy.org/examples/2d-rendering/pixel-grid-snap/) | 저해상도 render target, nearest sampling, 정수 배율 확대와 별도 고해상도 layer | 공간 장면의 선택적 고정 내부 해상도·정수 확대와 고해상도 HUD |
| [Unity URP secondary textures](https://docs.unity3d.com/6000.0/Documentation/Manual/urp/SecondaryTextures.html) | sprite와 같은 UV를 쓰는 normal/mask texture, normal 데이터의 sRGB 해제 | spatial billboard의 paired normal atlas와 asset 검증 |
| [Godot 3D 조명·그림자](https://docs.godotengine.org/en/stable/tutorials/3d/lights_and_shadows.html), [SpriteBase3D](https://docs.godotengine.org/en/stable/classes/class_spritebase3d.html) | 태양용 directional light, caster mask, 변경된 shadow만 재계산; billboard와 alpha mode의 명시적 계약 | 야외용 방향광과 cast/receive 선택, cutout/반투명 계약 구분 |
| [pmndrs/postprocessing DOF 소스](https://github.com/pmndrs/postprocessing/blob/main/src/effects/DepthOfFieldEffect.js) | 전경/배경의 CoC·색 버퍼 분리, 전경 CoC blur와 background mask, 초점 target | 전경 경계 품질을 선택하는 DOF와 native entity 초점 추적 |

Bevy 예제와 Unity URP 자료는 2D 경로다. 여기서는 해상도 합성과 atlas 계약을 참고하며,
Ferrum2D 공간 장면의 투영·depth·가림을 이 예제들이 해결한다고 해석하지 않는다.

### 1. 그림자 제출량과 갱신 비용

현재 [공간 pass](../../packages/ferrum-web/src/webgl2SpatialPass.ts)는 shadow caster bulk를
매 프레임 업로드하고, [환경 pass](../../packages/ferrum-web/src/webgl2SpatialEnvironmentPass.ts)는
선택한 점광원의 cube 6면마다 전체 지형·caster를 제출한다. 기존 camera terrain culling은
main scene 경로이며 shadow face별 culling과 다르다. 따라서 다음 첫 slice를 권장한다.

- 광원 radius와 각 face frustum으로 caster를 보수적으로 제외한다. 화면 밖에서 화면 안으로
  그림자를 드리우는 개체는 유지한다. 카메라에 안 보인다는 이유로 shadow caster를 제거하지 않는다.
- 광원·지형·caster 내용이 같으면 cube 재계산과 caster 재업로드를 건너뛴다. 첫 구현은 cube
  전체의 갱신 여부부터 결정하고, face별 dirty cache와 static/dynamic map 분리는 실측 후 검토한다.
- cache 무효화에는 위치·높이·추가/삭제·enabled, atlas frame/flip/alpha texture 변경, billboard의
  camera 방향, 광원 위치/radius, shadow 해상도와 GPU 자원 재생성을 포함한다. XY만 비교하지 않는다.
- caster bounds/revision과 제출 범위는 Rust에서 만들고 TS는 GPU 자원·cache를 소유한다.
  entity마다 JS/Wasm을 왕복하거나 TS에 별도 simulation 상태를 만들지 않는다.

완료 gate: 강제 전체 재계산과 cache/culling 경로의 픽셀 일치, 정지 장면의 shadow draw/upload 0,
움직임·애니메이션·camera 회전의 즉시 갱신, offscreen caster·다리 아래 광원·reset/context restore.
cache hit/rebuild, face별 제출 삼각형, 실제 draw/upload를 보고한다. culling만 켠 경우에는
6면 clear 자체가 없어지는 것으로 주장하지 않는다. 실제 GPU 시간 단축은 별도로 측정한다.

### 2. 픽셀 표현의 안정성

현재 nearest sampling과 `unitsPerPixel`은 있지만 고정 내부 해상도·정수 확대 정책은 없다.
opt-in 공간 render target과 정수 nearest upscale을 검토하고 HUD는 최종 해상도로 합성한다.
창이 내부 해상도보다 작거나 종횡비가 다를 때의 축소/여백 정책도 명시한다.
물리 pose를 반올림하지 않으며 camera quantization은 선택적 표시 정책으로 설계한다.

완료 gate: 느린 camera 이동, 직교 zoom·원근 tilt, 가로/세로·DPR 1/2·resize에서 픽셀 패턴과
viewport 여백을 검사한다. terrain picking·label anchor는 실제 표시 viewport와 동일한 변환을
사용하고 기존 projection round-trip을 유지한다. 원근 장면의 모든 world pixel 크기가 같아진다고
보장하지 않는다. DOF의 CSS px 반경과 내부 해상도·upscale의 관계도 함께 확정한다.

### 3. 캐릭터·소품의 normal atlas

현재 spatial shader의 normal은 triangle 표면에서 계산하므로 sprite 내부의 얼굴·옷·나무 질감을
조명으로 구분하지 못한다. 기존 C1-N의 paired atlas 후보를 spatial billboard부터 적용하는 안이다.
color/normal의 frame·UV·trim/pivot·padding을 맞추고, flip과 billboard basis를 normal 방향에
반영한다. normal은 linear 데이터로 읽으며 미지정 시 기존 평면 normal을 유지한다.
추가 texture pair에 따른 batch 증가와 material 참조의 버전 있는 bulk 계약을 먼저 설계한다.

완료 gate: 광원 방향 4종, frame/flip, elevation·camera 회전, missing map·잘못된 atlas 진단,
기능을 끈 기존 화면, texture bytes/sample/batch 예산. normal map 제작은 게임 에셋 작업이다.
[PlayCanvas의 emissive map](https://api.playcanvas.com/engine/classes/StandardMaterial.html#emissiveMap)도
별도 후보다. 발광은 HDR 합성에 연결하되 주변 물체를 자동으로 비추는 GI로 설명하지 않는다.

### 4. 야외 조명과 그림자 품질 선택

현재 최대 4개 point light와 단일 hard cube shadow에 더해 태양용 directional light 1개와
제한된 orthographic shadow map을 검토한다. 넓은 야외 장면의 빛 방향을 일정하게 작성하는 것이
목적이며, directional shadow가 항상 point shadow보다 빠르다고 가정하지 않는다.
첫 범위는 유한 shadow distance·안정적인 투영으로 제한하고 cascade는 필요성이 확인되면 분리한다.

[PlayCanvas shadow 설정](https://developer.playcanvas.com/user-manual/graphics/lighting/shadows/)의
cast/receive 분리와 PCF 품질 선택을 참고해 개체별 수신/생성 선택과 bounded PCF를 검토한다.
기존 개체의 기본 cast/receive는 유지한다. cube PCF에는 face 경계의 sampling 연속성도 필요하다.
PCSS·다중 shadow light·atlas 전체 구조를 한 slice에 포함하지 않는다.

완료 gate: top/side/bottom·billboard의 방향 반응, 다리 차폐, cast/receive 조합, camera 이동의
그림자 떨림·acne·분리 현상, hard/PCF 비용·기능 off 회귀와 실제 대상 GPU 측정.

### 5. 전경 경계를 보존하는 DOF와 초점 추적

현재 최대 13 sample DOF는 첫 opaque/cutout depth와 깊이 차이 rejection을 사용한다.
고급 품질 후보는 부호 있는 CoC(초점에서 벗어나 흐려지는 정도)를 전경/배경으로 분리하고
전경 coverage 확장·배경 mask를 제한적으로 합성한다. 기존 모드는 유지하며 추가 pass와
texture bytes에 상한을 둔다. 참고 소스도 일부 버퍼는 full resolution이므로 모든 중간 결과를
단순히 half resolution으로 내릴 수 있다고 가정하지 않는다.

초점 target은 별도 작은 slice로 개발할 수 있다. stable entity ID와 elevation을 Rust에서
view-axis depth로 계산하고 bulk 환경 값으로 전달한다. 참고 소스의 target 기능을 그대로 복사해
기존 focusDistance를 유클리드 거리로 바꾸지 않는다. target 삭제·복원·camera 뒤쪽의 정책도 정한다.

완료 gate: 전경 나무·얇은 난간·alpha 구멍·다리 뒤 캐릭터의 halo/색 번짐, 계단 이동 중 초점,
HUD 제외, quality 전환·resize·destroy와 메모리 예산. 단일 depth의 고급 DOF만으로 여러 겹의
반투명 복원을 보장하지 않는다. blend 재질은 sorting/depth-write/그림자/DOF를 별도 설계한다.

### 적용 순서와 공통 측정

우선순위는 **그림자 cache/culling → 픽셀 안정성 → normal atlas → 야외 조명 → 고급 DOF**다.
초점 target은 기존 DOF를 사용하는 게임에서 필요하면 고급 DOF보다 먼저 분리한다.
각 단계의 개발 범위는 별도 task/이슈로 확정하며 새 production 의존성을 전제하지 않는다.
기존 잔여 gate인 실제 대상 GPU 예산과 WebGPU parity는 이 후보 목록으로 대체하지 않는다.
실제 GPU에서 frame/render p95·draw/upload·GPU texture 추정량을 함께 기록하며 software Chromium의
정확성·작업량 검증을 모바일 성능 검증으로 해석하지 않는다. HDR capability 미지원 시에는
현재의 명시적 오류 계약을 유지하고 품질 저하나 효과 제거를 조용히 적용하지 않는다.

## 개발 우선순위

| 단계 | 범위 | 통과 조건 |
| --- | --- | --- |
| **P0 공간 기반** | 높이가 있는 지형, 직교/원근 camera, 공통 elevation와 GPU depth, billboard | 계단·다리·카메라 변경·terrain 클릭을 하나의 장면에서 검증 |
| **P1 높이 기반 조명·그림자** | 광원 위치/높이, 표면 방향, 지면·벽·다리 receiver와 차폐 | 다리 아래 광원이 위쪽 지형을 관통해 밝히지 않음 |
| **P2 분위기** | 실제 view depth DOF, 노출/톤 매핑/색 보정, 거리 안개 | 초점·거리 변화 검증과 HUD 제외, HDR/하이라이트·과도한 bloom 제어 |
| **공통** | spec 작성·저장/복원·debug·성능 예산 | stable ID, 데이터 왕복, pixel/좌표/자원 회귀와 실제 GPU 측정 |

공간 normal atlas와 고급 DOF·actor 초점은 2026-10-16 보강 범위다. 실제 depth·높이 계약을 공유한다.
B2 alpha 그림자와 기존 게임의 진행·저장·UI는 현재 구현된 경로에서 계속 사용할 수 있다.

## P0: 첫 공간 장면의 범위

첫 장면은 낮은 바닥, 높이가 다른 계단, 절벽 옆면, 위/아래가 겹치는 다리,
같은 native entity의 캐릭터, 투명 구멍이 있는 나무, entity label, 화면 HUD로 구성한다.
지형은 처음부터 높이가 있는 top/side surface와 삼각형 geometry로 작성한다.
2D quad의 그림 교체나 수동 layer 전환을 입체 지형의 대체 검증으로 사용하지 않는다.

### 축·단위·물리 높이

- 기존 게임 simulation의 `x/y`는 지면 좌표, `heightSpan.elevation`은 위쪽 높이다.
  제안하는 render 축 변환은 `(x, elevation, -groundY)`로 고정하고 camera/mesh/normal/picking에서
  같은 변환을 사용한다. 구현 전에 handedness·winding·clip depth를 fixture로 확정한다.
- XY와 elevation은 하나의 world 단위를 사용한다. world 단위와 atlas pixel 밀도의 관계를
  명시적으로 작성하며 DPR/zoom에 따라 물리 height를 바꾸지 않는다.
- body가 있는 캐릭터의 elevation source는 Rust heightSpan이다. 앱에서 sprite Y나 별도 시각 높이를
  매 프레임 복제하지 않는다. body가 없는 장식의 높이는 정적 scene placement 데이터로 작성한다.
- `floorId`는 충돌/이동 구역의 identity이며 높이나 렌더 layer 번호가 아니다. 가림은 world geometry와
  depth로 결정한다. 한 좌표의 upper/lower 개체를 floor painter sort로 분리하지 않는다.
- 첫 이동은 기존 kinematic controller의 step/ramp/bridge 높이 결과를 재사용한다.
  임의 mesh와 충돌하는 새 3D rigid body solver는 범위에 포함하지 않는다.

### 지형 surface와 작성 계약

- 바닥·계단·절벽 옆면·다리는 stable surface ID, footprint/geometry, elevation,
  재질/texture reference, walkability와 연결 floor를 갖는 spec 데이터로 작성한다.
- 지형 surface를 원천으로 top/side render geometry와 기존 height/floor 이동 metadata를 낮은 빈도로
  생성한다. mesh와 physics 높이를 두 파일에서 수동으로 맞추는 구조는 피한다.
- 첫 schema는 높이가 있는 면/간단한 삼각형 geometry로 한정한다. surface ID 중복, 잘못된 vertex/index,
  winding, 비유한 좌표, 지원하지 않는 겹침/경사와 연결 오류는 JSON 경로 진단으로 거절한다.
- 첫 collision 지원 범위는 기존 controller로 검증 가능한 step/ramp/bridge로 제한한다.
  임의 mesh를 그릴 수 있다는 이유로 그 mesh의 모든 물리 충돌을 지원한다고 설명하지 않는다.
- full visual editor, mesh 모델링 UI, skeletal animation 또는 glTF import는 첫 장면의 필수 기능이 아니다.
  AI가 inspect/replay할 수 있는 Scene 데이터와 validation을 우선한다.

### Camera·projection·terrain picking

- position/target/up, orthographic 크기 또는 perspective FOV, near/far, aspect를 작성한다.
  position과 target이 같음, up이 forward와 평행함, 잘못된 near/far/FOV, 비유한 행렬은 거절한다.
- Rust가 camera state와 view/projection 및 inverse view-projection을 같은 frame snapshot으로 확정한다.
  TypeScript는 DOM의 client 좌표를 canvas-local/NDC로 변환하고 낮은 빈도 bulk 요청을 전달한다.
- 클릭은 camera ray와 실제 surface의 가장 가까운 hit로 계산한다. ground XY뿐 아니라 elevation,
  surface ID와 hit normal을 반환해야 한다. 가려진 다리 아래를 평면 역변환으로 선택하지 않는다.
- 걷기 입력은 visible hit와 walkability를 확인한 뒤 해당 floor/height의 기존 이동 요청으로 연결한다.
  화면 클릭만으로 body elevation을 순간 변경하지 않는다. 벽/비이동 surface hit는 진단 가능한 결과로 반환한다.
- 표시한 frame과 다른 camera/resize/zoom snapshot으로 클릭을 처리하지 않는다.
  orthographic/perspective 모두 projection→screen→ray hit의 왕복 오차를 검증한다.

### Geometry/depth와 billboard

- 기존 15-float sprite ABI와 2D/UI 경로를 보존한다. 별도 opt-in geometry/billboard bulk buffer와
  versioned frame camera metadata를 설계한다. 기존 command의 effect flag나 texture ID에 depth를 숨기지 않는다.
- Rust는 terrain·entity·camera·animation state, world bounds, render command 생성과 query math를 소유한다.
  TS는 typed array/matrix를 소비해 WebGL2/WebGPU 자원과 draw/depth pipeline을 관리한다.
  entity별 JS/Wasm frame 왕복, per-entity texture/FBO/scene callback은 추가하지 않는다.
- mesh 정점/인덱스는 생성/변경 때 전달하고 변하지 않는 GPU geometry를 프레임마다 재업로드하지 않는다.
  새 shared struct는 `repr(C)`와 크기/stride/version 검증을 갖춘다. 버퍼 재할당 시 view를 갱신한다.
- opaque terrain과 alpha-cutout billboard는 같은 depth attachment에서 검사/기록한다.
  투명 구멍은 discard하여 뒷면을 가리지 않는다. 반투명 sprite는 별도 blend/depth 정책과 정렬 제한을 명시한다.
- 첫 billboard는 수직축을 유지한 cylindrical 방식으로 발을 world anchor에 고정한다.
  full-facing 방식은 별도 명시 옵션 후보이며 camera pitch에 따라 나무가 눕는 현상을 피한다.
- atlas UV/clip/flip, 발 pivot, texture density와 nearest sampling 정책을 함께 보존한다.
  perspective에서 크기가 변해도 pixel-art edge/alpha seam 검증을 통과해야 한다.
- entity label, shadow caster/receiver, particles와 debug anchor도 같은 spatial 좌표를 사용한다.
  화면 HUD는 geometry depth/lighting/DOF에 들어가지 않는 별도 마지막 pass다.
- culling은 3D bounds/frustum과 실제 projected geometry를 사용한다. 평면 tile visible bounds만으로
  절벽이나 높은 sprite를 선제 제외하지 않는다. near-plane 교차와 화면 밖 pivot도 검증한다.

### 저장·호환·성능

- static terrain/camera/material/billboard 설정과 runtime state를 구분하여 Scene schema로 작성한다.
  stable authored ID를 저장하며 raw entity handle이나 GPU resource ID를 저장하지 않는다.
- 공간 progress v6는 authored billboard의 XY/heightSpan과 runtime camera를 저장하며 height/surface
  연결을 native preflight한다. 일반 v5 capture/legacy 읽기는 보존한다. 전체 physics world의
  velocity/rotation/FSM/spawn 저장은 이 계약에 포함하지 않는다.
  기존 PhysicsBodyStateBuffer를 쓰는 세션 복구와 디스크 progress 저장을 혼동하지 않는다.
- spatial mode는 opt-in이다. 미지원 renderer/버전에는 명시적으로 실패하거나 앱이 요청한 flat
  fallback만 사용한다. 화면을 flat로 그린 결과를 spatial 성공으로 집계하지 않는다.
- WebGL2를 기본 기준으로 개발하고 WebGPU 지원 범위/미지원 사유를 기록한다.
  두 API의 clip depth 차이와 uniform layout을 fixture로 검증한다.
- budget은 terrain triangles/draw calls, billboard 수와 batch/texture switches, depth/color target bytes,
  upload bytes, picking candidate 수, Rust/CPU/GPU frame cost와 resource lifetime을 포함한다.
  캐스터·샘플·mesh·질의 상한을 설계하고 초과 정책을 명시한다. 임의 FPS를 성능 보장으로 쓰지 않는다.
  100/500/1000 billboard와 고정 terrain fixture를 비교하고 실제 대상 GPU에서 허용 예산을 확정한다.

## 화면 기준 완료 gate

| 장면/변경 | 완료 증거 | 단계 |
| --- | --- | --- |
| 계단 0→32→64 | 같은 entity ID/generation의 native elevation과 camera 투영 위치가 함께 변하고 label/debug anchor가 일치 | P0 |
| 다리 upper/lower | 같은 XY의 가림이 geometry depth로 결정되며 수동 layer 교체/제출 순서 역전에도 픽셀이 유지 | P0 |
| camera tilt·zoom·projection 변경 | top/side 면이 보이고 가림이 유지되며 화면 클릭이 실제 surface와 높이에 도달 | P0 |
| 투명 나뭇잎·atlas flip/clip | alpha 구멍은 뒤를 보이고 발 pivot/픽셀 선명도/깊이 판정이 유지 | P0 |
| 높은 지형·화면 밖 pivot·near plane | pop/잘못된 cull 없이 projected visibility와 clip이 일치 | P0 |
| 다리 아래 광원 | top/side/under receiver와 차폐가 맞고 윗면에 빛이 관통하지 않음 | P1 |
| focus/거리·노출·안개 변경 | world depth로 효과가 달라지고 HUD는 픽셀 동일, 하이라이트/alpha halo를 제어 | P2 |

실제 packed public `/core`·`/authoring` consumer에서 1280×720 / 390×844, DPR 1/2,
orthographic/perspective와 camera tilt/zoom 변경을 검사한다. screenshot만 남기지 않고
height·matrix·surface hit·depth/alpha 픽셀·draw/upload/resource 비용을 assert한다.
world label/HUD, reset/despawn/fresh engine restore, WebGL2와 명시적 WebGPU 경로를 포함한다.
소프트웨어 GPU smoke는 정합성 근거이며 실제 모바일 GPU 성능 검증을 대체하지 않는다.

## 실행 단위와 작업 경계

1. **P0-A 좌표/지형/높이 데이터 계약**: elevation 재현을 positive fixture로 전환하고 surface와
   existing step/ramp/bridge의 공통 원천, version/default/migration 진단을 확정한다.
2. **P0-B camera·ray picking**: 직교/원근 행렬, frame snapshot과 surface hit를 native math로 검증한다.
3. **P0-C geometry/depth·billboard 통합 장면**: 위 B의 camera를 소비하는 WebGL2 depth pipeline,
   terrain mesh와 cutout billboard/label/culling을 조합한다. A/B 단독 테스트 통과를 P0 전체 완료로 집계하지 않는다.
4. **P0-D 공간 진행 저장·fresh restore**: 개발 소스에서 authored billboard XY/heightSpan/floor·native
   camera를 v6로 저장하고 stable ID로 새 handle에 복원한다. native preflight·전체 batch 검증과
   가로/세로·DPR 1/2의 픽셀 동일성 검증을 통과했다. 일반 capture v5와 legacy 읽기를 유지한다.
5. **P0-E 잔여 화면·규모 gate (부분 완료)**: atlas/flip/pivot·near/eye-plane 픽셀 fixture와 surface 단위
   terrain chunk culling과 지형/빌보드/native heightSpan의 기본 공간 debug를 구현했다.
   collider/접촉 snapshot/floor ID 표시를 구현했다. 전체 contact manifold·joint/CCD 진단과 실제 대상 GPU 예산은 남아 있다.
   명시적 shared-edge floor 전환과 목적지 다층 경로를 구현했다. 대규모 경로 확장·WebGPU parity는 남아 있다.
6. **P1 공간 조명·receiver (첫 구현 완료)**: 실제 surface normal과 광원 높이, 지형/cutout depth cube 그림자를 연결했다.
   다리 아래 광원의 윗면 비조명, 다리/벽 차폐·alpha 구멍·이동/화면 밖 caster를 packed pixel gate로 검증한다.
7. **P2 depth DOF·색감·공기감 (첫 구현 완료)**: 직교/원근 depth·runtime refocus·HDR/톤 매핑·fog와 HUD 분리를 연결했다.
   가로/세로·DPR 1/2의 pixel/state/resource gate와 환경 진행 v7 fresh restore를 검증한다.

범용 3D 엔진 전체나 3D physics로 확장하는 범위가 아니다. 이 문서는 2D pixel sprite와 제한된
입체 지형을 결합하는 rendering 확장의 설계안이다. 저장소의 3D production 변경은 별도 설계·검토
기준을 유지한다. 첫 WebGL2 구현 외의 확장 완료, 원격 이슈 생성, 릴리스나 게임 패키지 반영을 주장하지 않는다.

픽셀 아트 디테일·팔레트·텍스처 밀도·장면 구도는 게임 제작의 책임이다. 현재 SVG 기반 에셋의
미술 개선을 엔진 geometry/depth 기능의 완료와 혼합하지 않는다.

## 공간 기반 이후의 효과 후보

아래 C1-N/R/L/D는 기존 #73 C1의 **평면 경로 설계 초안 기록**이다. 현재 공개 공간 계약은
[공간 기능 문서](../engine/data-scene-spatial.md)가 우선이며 아래 필드를 그대로 구현한 API가 아니다.
C1-N의 forward normal atlas, C1-R의 높이·수신 요구, C1-D의 실제 depth/DOF는 현재 spatial 경로로
보강했다. 독립 평면 receiver API·화면 공간 광선 mask(C1-L)·반투명 다중 depth·물리적 bokeh는
이번 다섯 slice에 포함하지 않는다. 과거 prototype 제안을 완료된 공간 API와 혼합하지 않는다.

## C1-N: sprite normal map과 조명

첫 prototype은 **forward sprite lighting**으로 한다. sprite shader가 색 texture 외에 normal
texture를 한 번 더 읽으며 광원 수를 명시적으로 제한한다. G-buffer 방식은 여러 attachment,
투명 sprite의 겹침, 별도 합성 pass를 요구하므로 첫 범위에 넣지 않는다. 먼저 방향광 1개를 검증하고
점광원 상한 4개의 추가 비용을 측정한다. 상한은 성능 검증을 위한 초기 제안이며 현재 API 보장이 아니다.

필요한 asset 계약:

- color/normal atlas는 frame 개수·UV·padding·trim/pivot이 같아야 한다. 누락 시 flat normal을
  사용하고 어긋난 frame metadata는 authoring diagnostic으로 거부한다.
- normal은 linear 데이터로 읽는다. RGB의 [0,1]을 [-1,1]로 복원하고 정규화하며 색 관리의 sRGB
  decode를 적용하지 않는다. 기준은 sprite-local +X 오른쪽, +Y 위쪽, +Z 보는 쪽이다.
- flipX는 normal X, flipY는 normal Y 부호에도 반영한다. image rotation과 ground/upright의
  basis를 변환해야 하며 `groundYScale`로 normal 길이를 찌그러뜨리지 않는다.
- diffuse alpha를 coverage 기준으로 공유한다. 반투명 가장자리와 alpha 그림자는 normal RGB를
  opacity로 사용하지 않는다. 원본 normal/색 atlas를 asset provider가 함께 검사한다.

Rust는 entity의 material/asset 참조와 변환, TS는 asset loading·GPU binding을 담당한다. 초기
material 등록은 cold path, 광원은 frame 공통 numeric buffer, frame loop는 기존 bulk command로
유지한다. 기존 15-float command에 texture ID를 몰래 포장하거나 RGB 필드를 덮어쓰지 않는다.
추가 material 참조가 필요하면 버전·크기 검증이 있는 buffer/side-table 계약을 먼저 제안한다.

기존 point/sun fullscreen additive pass와 normal lighting을 함께 적용하면 이중 조명 위험이 있다.
prototype은 normal 대상과 flat 대상의 조명 경로를 구분하는 방법까지 포함해야 한다. 별도 scene
pass를 무조건 추가하거나 전체 화면의 flat 조명을 끄고 성공으로 처리해서는 안 된다.

완료 조건: 방향 4종, frame/flip/rotation, legacy/linear-sRGB, 투명 sprite 겹침, atlas load 실패,
missing normal fallback, reset/destroy, normal 기능을 끈 기존 픽셀·draw 수 회귀. normal texture
수와 bytes, 추가 sample/light 연산, texture-pair batch 증가, Rust/render 시간의 p95를 기록한다.

## C1-R: receiver 평면과 높이

현재 floorId/elevation/heightSpan은 물리·정렬 데이터이며 자동 shadow receiver나 픽셀 깊이가 아니다.
첫 범위는 명시적인 **수평 receiver plane**이다. plane ID, ground elevation, 받을 수 있는 caster
layer와 불투명 coverage를 authoring 데이터로 정의한다. 다리 위·아래 사례 하나로 계약을 검증한다.
화면의 Y 또는 sprite 그림을 보고 높이를 추정하지 않는다.

현재 B2의 direction/lengthScale에는 빛의 수직 성분이 없다. 다른 높이로 투영하려면 caster의
기준 높이와 빛의 elevation, receiver와의 높이 차이가 필요하다. 기존 lengthScale 의미를 바꾸지
않고 opt-in 높이 조명 계약으로 분리한다. receiver보다 낮은 caster, 같은 높이, floor 간 수신 금지,
범위 밖 receiver의 처리와 빛이 수평에 가까울 때 길이 상한을 명시한다.

첫 prototype은 receiver별 mask와 제한된 plane 수(검증 시작값 2)를 비교한다. 수신 평면마다
caster를 무제한 복제하지 않고 전체 caster×receiver 예산을 둔다. 반투명 multi-layer의 실제
3D 차폐는 다음 범위다. 미지원 renderer/자료 누락 시 단일 지면 경로를 명시적으로 선택한다.

완료 조건: 다리 위/아래, 같은 화면 Y의 다른 plane, floor 이동, owner가 화면 밖인 경우,
reset/stale handle, receiver 삭제, layer 정렬, culling·pair budget. 물리 query 결과와 rendering
receiver 판정을 서로 다른 근거로 기록한다.

## C1-L: 태양 광선 차폐

첫 범위는 opt-in 화면 공간 light mask와 저해상도 radial/directional blur다. 실제 volumetric
scattering 또는 화면 밖 지오메트리의 광선 추적이라고 부르지 않는다. 입력은 명시적 occluder와
alpha coverage이며 CSS sun-rays, vignette, bloom과 구분한다. receiver 높이에 의존하지 않는
평면 mask prototype은 C1-R과 독립 실행할 수 있다.

mask 해상도는 backbuffer 가로·세로의 1/2에서 시작하고 sample 수·광선 수·출력 강도의 상한을
둔다. 화면 밖 광원/차폐물, camera 이동과 경계, UI 제외, alpha-hole 누수, 색 관리와 투명 canvas를
검증한다. mask+blur 임시 texture는 frame 간 재사용하고 disable/destroy/resize 시 회수한다.
미지원 환경은 효과를 끈다. 장식용 앱 overlay를 자동 추가하는 fallback은 만들지 않는다.

## C1-D: view depth와 DOF

화면 Y에 따라 blur를 다르게 주는 tilt-shift나 전체 화면 blur는 **screen-space 근사**이며 depth DOF가
아니다. 현재 render layer, foot-Y 정렬, physics heightSpan 하나만으로 광학 깊이를 결정할 수 없다.
실제 DOF 후보는 authoring이 지정한 view-depth 단위, camera focus distance/range, sprite의
coverage를 일관된 depth buffer로 기록하는 계약부터 시작한다. perspective renderer는 필요하지
않지만 orthographic 2.5D의 깊이 의미를 별도로 정해야 한다.

색/깊이 buffer와 제한된 separable blur/composite를 사용하고 foreground/background halo,
투명 sprite 경계, additive VFX, HUD 제외, 초점 이동·resize·zoom을 검사한다. 첫 버전은 opaque
coverage와 단순 cutout으로 한정하는 안을 검증하며 반투명 여러 층은 완료했다고 주장하지 않는다.
depth 입력이 없거나 renderer가 지원하지 않으면 DOF를 끄고, 근사 blur로 조용히 바꾸지 않는다.

## 비용과 공통 gate

아래는 계산으로 얻은 추가 texture의 하한 예시다. 실측 GPU 메모리·성능 수치가 아니다.
RGBA8 1장에 대해 `CSS width × CSS height × DPR² × 4 bytes`를 사용하며 mipmap/MSAA/padding은 제외했다.

| 추가 자원 | 1280×720, DPR 1 | 1280×720, DPR 2 |
| --- | --- | --- |
| full-resolution RGBA8 1장 | 약 3.52 MiB | 약 14.06 MiB |
| half-width/half-height RGBA8 1장 | 약 0.88 MiB | 약 3.52 MiB |
| full-resolution R16F depth 1장 | 약 1.76 MiB | 약 7.03 MiB |

따라서 광선용 half-resolution ping-pong 2장만 추가해도 DPR 2에서는 약 7.03 MiB다. 실제 지원
attachment format과 precision은 WebGL2/WebGPU capability로 확인한다. 형식 미지원 시 효과를
끄거나 문서화한 다른 경로를 선택하며 JS에서 매 frame 이미지 readback으로 대체하지 않는다.
normal atlas의 추가 메모리는 atlas 크기에 비례하며 화면 크기 표와 별도로 집계한다.

각 후속 작업에는 1280×720/390×844 × DPR 1/2, zoom/resize, legacy/linear-sRGB, WebGL2와
실제 WebGPU 결과 및 fallback 사유를 남긴다. 현재 WebGPU linear-sRGB 미지원 정책은 계속 유지한다.
100/500/1000 sprite 비교에서 상태·규모·draw/texture/resource 비용과 render/Rust p95를 측정하고
사용할 실제 GPU에서 예산을 정한다. 소프트웨어 adapter 측정을 모바일 성능 보장으로 해석하지 않는다.

## 효과별 후속 이슈 초안

아래 네 항목은 공간 기반 이후의 후보이며 독립 구현 이슈로 옮길 수 있다. 아직 원격 이슈를 생성하거나 릴리스 일정을 정한 것은 아니다.

1. **C1-N — opt-in sprite normal map lighting**: paired atlas 계약, 방향광 1개 prototype,
   기존 flat light와 중복 적용 방지, 위 픽셀·자원·batch gate. 범용 material 전면 교체는 제외한다.
2. **C1-R — 평면 shadow receiver의 높이·층 계약**: explicit plane과 light elevation,
   다리 2층 최소 사례, pair budget·fallback. 임의 3D mesh receiver는 제외한다.
3. **C1-L — mask 기반 태양 광선 차폐**: half-resolution mask/blur, bounded samples,
   alpha-hole·화면 경계·UI 제외·자원 해제. volumetric renderer는 제외한다.
4. **C1-D — 2.5D view-depth authoring와 선택적 DOF**: depth 단위부터 결정하고
   opaque/cutout prototype, halo·초점·depth 부재 fallback을 검증한다. screen-space blur와 별개다.

## 2026-10-16 검토: Blender 정적 배경 모델 연결

검토 기준 소스는 `4775bacc70cc29d7818701a32b7ab749bedce25f`다. 아래는 **검토 당시의 설계 후보**이며
현재 구현된 M1 subset은 마지막 개발 기록과 확정 공간 문서를 따른다. 아래 전체 계약의 구현 완료를 뜻하지 않는다. 다음 목표는 나무·바위·건물의 정적 모델을
기존 공간 렌더링·2.5D 물리·진행 저장에 연결하는 것이다. 범용 3D 엔진, triangle mesh 물리,
skeletal animation, visual editor로 확대하지 않는다. 구현 착수 때 별도 task에 범위와 gate를 확정한다.

### 재사용할 기반과 새로 필요한 경로

| 영역 | 현재 코드에서 확인한 상태 | 필요한 변경 |
| --- | --- | --- |
| 자원 | `assetLoader.ts`의 manifest/release는 texture·sound·JSON | 모델 파싱·검증, asset identity, 공유·해제 계약 |
| 메시 | `dataSceneSpatial.ts`의 정점은 XYZ/UV/RGBA/texture/cutoff의 11-float이며 `webgl2SpatialPass.ts`는 `drawArrays` 사용 | indexed mesh, 정점 normal/tangent, material/instance 참조와 bounds |
| 음영 | `webgl2SpatialShaders.ts`는 미분으로 면 normal과 billboard normal basis 계산 | smooth normal·tangent 변환, 모델 재질용 입력. 기존 camera/light/HDR/depth/DOF/fog 합성은 재사용 |
| 그림자 | `spatial_scene/shadows.rs`의 source는 terrain 0·billboard 1 | 모델 caster의 point/sun 제출·alpha coverage·revision/culling 확장 |
| 물리·저장 | authored terrain/heightSpan/floor·연결·진행 v5/v6/v7 | 모델 instance와 명시적 collider/보행면 참조의 검증·저장·fresh restore |

따라서 loader만 추가하는 작업으로 완료할 수 없다. 기존 15-float flat command와 44-byte spatial
정점의 의미를 바꾸지 않고, 버전·stride·크기 검증이 있는 별도 bulk mesh/instance 확장을 설계한다.
기존 shadow v1의 source 값도 구 reader가 잘못 해석하지 않도록 버전을 명시한다.
모델은 지형·캐릭터와 같은 HDR/depth target에 그리며, 별도 합성 화면으로 가림을 흉내 내지 않는다.

Rust는 instance의 배치·부모 관계·물리 상태·가시성/그림자 제출 데이터를 소유한다. TS는 파일
fetch/decode와 불변 asset/GPU 자원을 관리한다. asset 등록과 bounds 전달은 cold path에서 수행하고,
매 frame에는 bulk instance/range buffer를 소비한다. entity별 JS/Wasm 왕복이나 정적 메시 재전송은 금지한다.

### 첫 입력 형식과 좌표 계약

[Blender 5.1 문서](https://docs.blender.org/manual/en/5.1/addons/import_export/scene_gltf2.html)는
GLB에 메시·이미지를 함께 담는 방식과 외부 파일을 사용하는 glTF를 구분하고, +Y up 내보내기를 제공한다.
첫 범위는 **glTF 2.0의 자체 완결 GLB, 정적 TRIANGLES, PNG/JPEG, 명시적으로 제한한 재질**로 권고한다.
외부 `.gltf`/`.bin`/image URI, 압축 확장, skin/morph/animation은 후속이다. 미지원 필수 확장은 거절하고,
허용하지 않는 primitive/accessor 형식은 진단한다. 파일·노드·정점·이미지 크기와 accessor/index/stride
범위를 GPU 등록 전에 검사하며, 중단·실패 시 staging 자원을 회수한다.

[Khronos glTF 2.0 명세](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)의 좌표는 오른손계,
+Y up, 거리 단위는 meter다. 엔진의 렌더 좌표는 이미 `(x, elevation, -groundY)`이므로 정상적인
Blender glTF export에 Z-up 보정을 다시 적용하지 않는다. 변환 배율을 `s` world units/meter로 두면
asset `(X,Y,Z)`를 authoring `(x=sX, y=-sZ, elevation=sY)`로 대응한다. 1 m 축 fixture로 검증한다.
node 원점과 부모 변환을 보존하고 자동 중심 정렬은 하지 않는다.

첫 배치 계약은 root 위치·높이·yaw·양수 균일 배율로 제한하는 안이 적절하다. imported 정적
node TRS/행렬은 계층 합성 후 보존하거나 등록 시 bake한다. 특이 행렬·음수 scale·shear의
허용/거절 정책과 normal/winding 처리를 명시해야 한다. 보행면이 있는 모델의 root는 기존 축 정렬
surface로 정확히 변환되는 경우부터 허용하고, 임의 기울기·회전 보행면은 지원한다고 주장하지 않는다.

### 첫 재질과 작성·저장 계약

- 기본색·normal·emissive, `OPAQUE`/`MASK`, 양면 여부를 첫 완료 범위로 잡는다. 동일 cutoff와 UV를
  color/depth/point/sun shadow에 적용한다. base color·emissive의 색 데이터와 linear normal을 구분한다.
  tangent handedness, node 변환, 뒤집힌 면과 UV 변환이 normal에 일관되게 반영되어야 한다.
- 현재 조명은 glTF metallic/roughness PBR 전체를 구현하지 않는다. 지원하지 않는 표현은 진단하고
  명시적인 변환 프로파일을 둔다. Blender의 모든 shader node와 같은 외관을 보장하지 않는다.
  emissive는 발광 표면이며 주변을 비추는 광원이나 GI가 아니다. 반투명 `BLEND`는 후속이다.
- 현재 공간 sampler는 nearest/clamp다. 모델에는 필터·wrap·UV 반복/크기 계약이 추가로 필요하다.
  픽셀용 nearest는 명시적 선택이며 GLB sampler 설정을 조용히 덮어쓰지 않는다. UV 변환을 쓸 경우
  `KHR_texture_transform` 등 지원할 입력과 채널별 texcoord 범위를 정한다.
- stable asset/content identity와 instance ID를 구분한다. glTF node 이름을 유일 ID로 가정하지 않는다.
  imported hierarchy와 authored instance 부모 관계를 구분하고, cycle·깊이·부모 변환 제한을 검사한다.
  prefab 확장에는 모델·물리 proxy를 함께 포함하며 renderer handle을 authoring 데이터로 저장하지 않는다.
- 진행 저장은 변경 가능한 instance 참조·pose·enabled·부모·cast/receive 상태만 저장하고 메시/GPU
  bytes를 넣지 않는다. 모델 상태를 담을 새 버전은 구현 시 확정하되, 기존 flat v5·spatial v6·환경 v7의
  capture/hash를 유지한다. asset/pose/physics 사전 검증과 비동기 준비 후 commit하여 실패 복원이
  현재 씬을 파괴하지 않게 한다. authoring 재적용과 fresh engine 복원도 별도 검증한다.

### 충돌·보행면과 자원 관리는 첫 단계부터

모델 geometry에서 충돌체·층·계단을 자동 추론하지 않는다. 같은 local 원점·단위·변환을 사용하는
명시적 collider/heightSpan/floor/보행 surface·connection proxy를 sidecar 등 검증 가능한 데이터로 둔다.
나무는 줄기 collider, 바위는 단순/compound collider, 건물은 벽·문 통로와 평면/계단 proxy를 작성한다.
기존 native 높이 이동·충돌·길찾기를 연결하며 임의 mesh navmesh/삼각형 충돌 solver는 첫 범위가 아니다.

자원 공유·해제와 bounds culling은 우선순위 6까지 미루지 않는다. 첫 loader부터 mesh/material/image의
공유 수명, 취소·부분 실패·destroy·context 복구를 설계한다. 같은 나무마다 전체 정점을 복사하지 않고
정적 GPU buffer와 변경 instance를 분리한다. main camera 밖 caster는 light culling으로 별도 처리한다.
GPU instancing 최적화는 정합성 확보 뒤 적용하되, 실제 draw/instance/triangle/upload/texture bytes와
자원 수를 처음부터 기록한다. 추가 production parser 의존성은 자체 제한 parser 등 대안과 비교 후 선택한다.

### 함께 확인한 다층 길찾기 예산 재현

사용자의 `game-test/tests/repros/spatial-navigation-budget.json`과 설치된 실제 Wasm을 격리 실행해
같은 제한을 확인했다. 버전은 `0.1.0-local.20261016121034815.3cfd3c71`, terrain 7개·entity 15개다.
출발 `(648.5919189453125, 440.9655456542969, floor 0)`에서 `(1030, 410, floor 3)`으로 요청했다.

| 항목 | 설치 Wasm 재검증 | 해석 |
| --- | --- | --- |
| cellSize 32 요청 | `accepted=false` | 미해결 제한 재현이며 성공한 새 경로가 아님 |
| expanded / edge probes | 522 / 569 | node 4,096·probe 32,768 상한에 도달한 것이 아님 |
| probe work | 7,997,440 / 8,000,000 | 잔여 2,560으로 다음 probe 비용을 수용하지 못함 |
| waypointCount 9 | 이전 accepted route의 planned 값 | 거부된 새 요청의 부분 경로로 해석하면 안 됨 |

위 설치 버전의 `spatial_scene/navigation.rs::work`는 substep × `(전체 alive entity + surface)` × 정렬 계수 × 64를
보수적으로 청구했다. 이 장면의 최소 probe 청구는 7,040으로 잔여 예산보다 컸다. work unit은
실제 CPU/GPU 시간이 아니다. 당시 계산은 충돌체 없는 장식 entity까지 포함했으며 아래 N0에서 보강했다.

1. 마지막 요청의 실패 사유와 탐색 비용을 active route 상태와 분리한다. budget/no-path/invalid 등을
   구분하고, 실패 시 actor pose·velocity·기존 경로를 보존하는 계약을 유지한다.
2. 요청 내 native collision proxy/broadphase 준비를 재사용하고 floor/height 후보를 제한한다.
   계산에서 장식 entity를 제외할 때 실제 native sweep·충돌 검증을 빠뜨리거나 과소 청구하지 않는다.
3. surface/connection coarse graph와 세부 탐색 구간 제한을 검토한다. static cache는 revision과
   actor footprint·step/drop에 묶고, 동적 장애물의 통과 결과를 그대로 재사용하지 않는다.
4. 동일 장면의 cellSize 32·floor 0→3 성공, 장애물 차단·실패 원자성, 장식 모델 증가의 비용 영향과
   follower frame 상한을 검증한다. 800만 상한 해제나 게임의 64 설정을 엔진 개선으로 대체하지 않는다.

격리 스크립트의 기존 공간 기능 10개 check도 통과했다. 이는 길찾기 수정이나 새 GPU 성능 검증이 아니다.
원본 게임 소스·package·재현/플레이 보고서의 해시는 실행 전후 같았다. 검토 당시 게임은
cellSize 64를 사용했고 JS 경로 탐색 fallback을 사용하지 않았다. 이 제한은 아래 N0에서 보강했다.

### 2026-10-17 재검토: 정적 모델 연결을 계속할 조건

**다음 개발로 진행하는 것이 적절하다.** 기존 카메라·깊이·조명·그림자·후처리를 실제 배경 자산에
연결하는 공백이 남아 있고, 작은 격자 길찾기 재현은 N0에서 해결했다. coarse graph나 추가 화면 효과를
먼저 늘리기보다 모델 한 개로 기존 게임 장면의 렌더링·물리·저장을 함께 검증한다. Blender는 외부 자산
제작 도구로 사용하며, 엔진 내 visual editor나 별도 3D 게임 상태 계층을 만들지 않는다.

기존 M1의 화면 출력과 M2의 물리·저장을 완전히 분리하면 모델이 보이기만 하는 중간 결과가 길어진다.
따라서 **M1에 불투명 바위 1종의 최소 authoring·충돌 proxy·저장을 포함**하고, 나무의 alpha 재질과
건물의 계층·보행면 및 재질 확장을 M2에서 검증한다. 첫 바위에는 base color·정점 normal을 적용하고,
normal map·emissive 등은 M2에서 완성한다. 세 모델의 전체 완료 목표는 유지한다.

- 같은 spatial camera/depth/HDR 경로에서 캐릭터 가림·point/sun cast/receive·DOF/fog를 확인한다.
  기울기·줌 변경 후 기존 지형 picking과 화면의 대응도 검증한다.
- asset 참조·배치와 명시적 AABB proxy를 authoring에 함께 작성한다. 같은 원점·단위·지원 변환을
  적용하고 캐릭터 차단을 검사한다. 모델의 정점에서 삼각형 물리나 보행층을 자동 생성하지 않는다.
- 새 engine으로 저장을 복원해 asset identity·pose·충돌·화면이 같음을 검사한다. 잘못된 GLB나
  로드 실패는 기존 씬을 보존하고, 공유 자원 해제와 draw/triangle/upload/자원 수를 처음부터 기록한다.

검토한 엔진 파일과 game-test의 `public/`·`src/`에서는 `.glb`·`.gltf`·`.blend` 입력을 찾지 못했다.
디스크 전체나 별도 미술 작업 폴더의 부재를 뜻하지 않는다. 최소 fixture로 입력 계약을 검증한 뒤,
실제 Blender export를 같은 경로에 넣어 축·단위·pivot·재질과 화면을 확인해야 실사용 완료로 판단한다.
현재 glTF 재질 전체를 렌더링하지 않으므로 지원/변환 프로파일과 미지원 진단이 필요하다.

### 권고 개발 순서와 완료 gate

1. **N0 계약·예산**: 길찾기 실패 진단·비용 기반 보강은 아래 첫 slice 구현. 모델 asset/좌표/bulk ABI/재질 subset·물리 proxy의 상세 계약은 M1 착수 전에 확정.
2. **M1 바위 1종 통합**: 제한 GLB·공유 indexed geometry·base color/정점 normal, 기존 depth/light/shadow/postprocess, 최소 authoring·AABB proxy·fresh save restore를 함께 검증.
3. **M2 세 모델 완성**: 나무의 MASK/양면, normal map·emissive·sampler, prefab·건물 계층/보행면·다층 이동과 아래 세 모델의 packed consumer gate.
4. **M3 규모·형식 확장**: instancing, 외부 glTF 입력과 추가 포맷/재질. 실제 대상 GPU에서 예산 확정.

| 모델/검증 | 단계별 완료 조건 |
| --- | --- |
| 바위 (M1) | base color·smooth normal, 지원 회전·배율·접촉, 캐릭터 가림·AABB 충돌, point/sun cast/receive와 DOF/fog |
| 나무 (M2) | 발 pivot/단위, 잎 alpha 구멍과 양면·depth/shadow 일치, 캐릭터 가림, 줄기 native 충돌 |
| 건물 (M2) | node hierarchy, 문 통과·벽 차단, 보행면/계단·다층 이동, 위/아래 가림·그림자 |
| 저장·실패 (M1부터 매 단계) | 새 engine/handle의 동일 pose·physics·화면 복원, 잘못된 asset/extension/transform 거절과 현재 씬 보존 |
| 공통 회귀 (M1부터) | 가로/세로·DPR 1/2, camera tilt/zoom/picking·HUD 분리, 공유 자원 해제·실제 draw/triangle/upload/자원 수 |
| 규모 (M3) | 100/500/1000 공유 모델의 draw/upload/자원 증감·해제, instancing 전후 비교와 실제 GPU 예산 |

첫 지원 renderer는 기존 spatial WebGL2 범위로 명시하고, 미지원 renderer의 명시적 거절을 유지한다.
현재 spatial WebGPU parity와 실제 하드웨어 성능 gate는 별도 잔여 항목이다. 물 표현·고급 음영은
이 세 모델의 연결과 회귀 검증을 통과한 뒤 검토한다.

현재 상태는 N0·M1 구현/회귀 완료, M2 부분 완료다. 자체 제작 바위·나무·건물의 packed 통합과
모델 GPU 준비 후 활성화와 정적 로컬 proxy 묶음 배치·자식 계층을 구현했다. 실제 Blender export acceptance와
일반 runtime parenting/동적 proxy 추종은 남아 있으며 GLB node hierarchy는 static bake다. 환경/FBO와 arbitrary callback까지 포함한
전체 scene GPU transaction은 별도 후속이다. M3는 공유 인스턴싱·외부 glTF·CPU 모델 캐시를 구현했으며 청크 활성화/LOD와 추가 형식·재질·실제 GPU 예산은 남아 있다.

### N0 첫 개발 기록: 길찾기 예산·요청 진단

모델 연결에 앞서 `artifacts/hd2d-navigation-budget/task.json`의 한 작업으로 native 길찾기 기반을 보강했다.
모델 importer/renderer/material/authoring API는 이 slice에서 구현하지 않았다. 현재 공개 동작은
[공간 목적지 이동](../engine/data-scene-spatial.md)의 통계·예산 계약을 따른다.

- 동기 탐색 요청/추종 frame마다 target AABB 목록을 한 번 준비·정렬하고 같은 native sweep/overlap에서
  재사용한다. 정상/거절/blocked/cancel 경로에서 snapshot을 해제하며 다음 요청/frame은 동적 변경을 반영한다.
- 반복 probe의 work는 실제 enabled target AABB·surface 수와 substep/candidate 정렬에 근거한다.
  최초 alive 순회·정렬 비용도 요청/frame 예산에 포함하고, 8M/1M·node/probe/iteration 상한은 유지한다.
- 독립 v1 u32 진단 확장으로 `SpatialMoveStats.lastRequest`에 수락/입력/actor/경로 없음/예산 거절을
  구분한다. 마지막 요청 통계를 초기화하되 기존 route·XY/span/velocity는 실패 시 보존한다.
  기존 6개 u32 통계·flat/spatial save와 render ABI는 유지하고 구 Wasm에는 새 진단 필드를 생략한다.
- 고속/큰 delta 검증에서 전체 32-unit edge는 두 번의 substep으로 통과하지만 26.75-unit frame 조각은
  한 step에서 높이 변화 12.84가 허용량 12를 넘어 막히는 사례를 발견했다. 현재/다음 surface slope와
  step/drop으로 follower 조각을 제한하고 native 50 ms·혼합 delta 왕복 회귀를 추가했다.

실제 game-test authoring JSON을 읽는 격리 Wasm 검증의 결과는 다음과 같다. game-test의 설치 패키지나
원본 재현/플레이 보고서는 변경하지 않는다. 아래 수치는 work unit이며 경과 시간·GPU 성능이 아니다.

| cellSize 32 / floor 0→3 | entity 수 | 확장 node / edge probe | work / 8M | 결과 |
| --- | --- | --- | --- | --- |
| 기존 실제 게임 씬 | 15 | 591 / 656 | 3,353,619 | 수락 후 `(1030,410, floor 3, elevation 96)` 도착 |
| 장식 1,500개 추가 | 1,515 | 591 / 656 | 3,355,119 | 같은 경로로 도착. 최초 순회 비용만 1,500 증가 |

잘못된 목적지 floor 재요청은 `noPath`와 기존 waypoint 46개를 구분하며 진행 중 경로를 보존한다.
환경 진행 v7의 새 engine 복원은 floor 3 pose를 보존하고 route/요청 진단은 idle/notRequested로 초기화한다.
native 회귀는 장식과 실제 충돌체 증가를 구분하고, frame admission 실패 뒤 수동 이동의 새 장애물 및
수락 후 frame 예산 초과 정지도 검사한다. packed browser gate는 가로/세로·DPR 1/2에서 같은 32 격자와
장식 증가·요청 진단·도착 상태를 검사한다. 검증 보고서는 `artifacts/hd2d-navigation-budget/`에 둔다.

surface coarse graph, revision을 사용하는 장기 topology cache와 incremental search는 구현하지 않았다.
정적 GLB·bulk mesh를 연결한 다음 M1 개발 기록으로 이어진다. spatial WebGPU·실제 하드웨어 성능 gate는 계속 남아 있다.

### GLB 게임 적용 후 보강: 소수 크기 proxy 접촉과 목적지 이동

2026-10-17 game-test `plan/hd2d-models.md`의 첫 보강 항목을 수정했다. 18개 모델 장면에서 수동으로
상자에 밀착한 `(582,745.1749877929688)`은 center 거리 기반 contact 계산의 반올림으로 작은 양수
penetration이 생겨 `noPath`로 거절됐다. native sweep의 접촉 분리와 spatial pose 검사를 같은 f32
최소/최대 모서리 비교로 맞췄다. 고정 epsilon을 늘리거나 actor 위치를 보정하지 않는다.

- native 회귀: 실제 상자 규격의 밀착→요청→도착, 안쪽 이동 차단과 실패한 목적지 재요청의 route 보존.
  네 방향·collider offset 유무 8조합에서 접선 이동과 한 ULP의 실제 모서리 겹침 거절을 검사한다.
- 공식 packed browser navigation fixture에도 같은 접촉→도착 회귀를 연결했다. render/save/authoring
  ABI와 기존 탐색/frame 예산, floor/height 필터는 유지한다.
- 게임 원본과 설치 엔진을 수정하지 않은 임시 복사본에 새 packed 엔진을 넣고 모델 검사 13개를 통과했다.
  수동 이격 없이 `(650,780)`에 도착하며 접촉 요청은 probe 1개·work 27,026으로 수락된다.
- 모델 18개 장면의 cellSize 32는 여전히 work 7,992,466에서 `workBudgetExceeded`다. cellSize 64의
  다층 도착·새 엔진 저장 복원·8회 장면 왕복·자원 해제는 계속 통과한다. 밀집 다층 탐색 비용과 동적
  모델/proxy 추적·자유 회전 assembly·표현 확장은 이번 수정의 완료 범위에 넣지 않는다.

후속 검증 근거는 `artifacts/hd2d-navigation-budget/contact-boundary/`에 모은다. 실제 게임 설치본은
기존 버전을 유지하므로 새 엔진을 게임에 동기화하기 전에는 기존 접촉 제한이 그대로 남는다.

### M1 첫 개발 기록: 불투명 정적 GLB 바위 통합

`artifacts/hd2d-static-model/task.json` 범위로 기존 spatial WebGL2 pass에 정적 모델을 연결했다.
사용 계약과 수치 제한의 source of truth는 [정적 GLB 배경 모델](../engine/data-scene-spatial.md)이다.
새 production 의존성을 추가하지 않았으며 기존 평면/공간 정점·shadow ABI와 v5/v6/v7 저장 포맷을 보존한다.

- 제한 GLB·PNG/JPEG·정적 node bake·smooth normal·base color/sampler, content identity와 공유 indexed GPU 자원.
- Rust의 native XY/heightSpan·root yaw/scale·camera/light bounds 제출을 독립 80-byte bulk instance 확장으로 연결.
- 기존 authoring/prefab instance의 명시적 world 단위 AABB·heightSpan과 v6/v7 진행 복원을 사용한다.
  proxy를 모델 yaw/scale/시각 offset으로 자동 변형하지 않으며, 실제 Blender export 외관은 아직 검증하지 않았다.
- malformed 입력·누락/다른 content·큰 좌표/변환·잘못된 복원을 activation/commit 전에 거절한다.
  GPU allocation 실패는 staging 자원을 회수한다. GPU 사전 업로드를 포함한 씬 전환 원자성은 후속이다.

현재 검증은 자체 제작한 textured 8-triangle GLB fixture를 사용한다. 최종 명령·packed browser 결과는
같은 task의 verification과 browser report에 기록한다. 이 fixture는 Blender에서 만든 실제 게임 모델이 아니다.

다음 개발은 M2의 잎 MASK/양면·normal map/emissive·재질 확장과 나무·건물 통합이다.
실제 Blender 출력물의 축·단위·pivot·proxy 정합성 검증을 함께 수행하고, 부모/보행면·GPU 준비 후 활성화
계약을 확장한다. instancing·외부 glTF·대량 모델·실제 GPU 성능은 M3로 유지한다.

최종 검증은 Rust 1,374개·웹 866개, fmt/clippy·Wasm·전체 lint/build·package/tarball·문서/API 검사를
통과했다. packed browser 1280×720/390×844·DPR 1/2의 4건에서 model 1개/8 triangles·warm 정적 upload 0,
AABB 차단 X=-12·높이 분리 통과·직교/원근 picking·그림자/DOF/fog·fresh restore 픽셀 차이 0·자원 회수를 확인했다.
화면 밖 모델의 light-face 제출도 native 회귀로 검사했다. 현재 증거는 `artifacts/hd2d-static-model/`에 모았고
중간 실패/반복 실행 사본은 제거했다. 테스트 입력과 실제 Blender 출력물 gate를 구분한다.

M1 코드 리뷰에서 복원 불가능한 모델 pose의 capture, 모델 anchor world text의 평면 경로 잔류,
caller unpack/PBO에 영향받는 texture upload, GPU 오류 후 잘못된 cache 등록, raw packet의 실제 geometry
예산 누락을 수정했다. 작은/큰 node scale의 normal 변환과 bounded stream/ArrayBuffer 소유권도 보강했다.
native·웹 회귀와 공개 패키지 browser probe로 재검증하며 리뷰 결과와 최종 증거를 같은 artifact root에 갱신한다.

### M2 첫 개발 기록: 나무 MASK·양면 재질

M1에 이어 **나무 잎 재질의 color/depth·shadow 일치**를 한 slice로 구현했다. M2 전체 완료는 아니다.
정적 모델의 native pose·80-byte ABI·authoring instance와 v6/v7 저장 계약은 유지한다.

- GLB OPAQUE/MASK, cutoff 기본 0.5·factor alpha 곱·이상 비교, primitive별 양면 culling과 뒷면 normal 반전.
  기존 attr3 cutoff를 main/point/sun pass에 공통 적용하고 BLEND·잘못된 타입/음수·f32 overflow는 거절한다.
- 자체 제작 `tree.glb`는 foot pivot·정적 node bake·opaque 줄기/MASK 잎의 2 primitives/14 triangles다.
  PNG alpha 0/128/255·sampler와 단면/양면 변형을 공개 GLB loader로 준비하며 미술 자산으로 제공하지 않는다.
- 실제 browser는 구멍 뒤 캐릭터와 불투명 잎의 depth, factor alpha·cutoff equality, 양면/단면 뒷면,
  양쪽 점광원/태양광의 지면 그림자 구멍을 검사한다. 지면 샘플을 잎이 가리지 않는 camera로 배치한다.
- 줄기 world 단위 AABB 차단 X=-6, native 높이·fresh engine의 동일 픽셀 복원, warm mesh upload 0,
  GPU buffer 4개/texture 1개 해제와 malformed 재질 거절을 같은 CI 공간 gate에 연결했다.

source of truth는 [정적 GLB 배경 모델](../engine/data-scene-spatial.md)이다. 검증 증거는 기존
`artifacts/hd2d-static-model/`에 갱신하며 중간 실패·추출 package와 반복 이미지 사본은 최종본으로 대체한다.
다음 M2 항목은 normal map/emissive·건물 계층/보행면·GPU 준비 후 활성화다. 실제 Blender export와
하드웨어 GPU acceptance, WebGPU spatial 및 M3 규모·형식 확장은 아직 남아 있다.

이 slice의 최종 검증은 Rust 1,374개·웹 868개, fmt/clippy·Wasm 포함 전체 lint/build·package/tarball·문서/API
검사와 packed browser 4조합을 통과했다. 각 조합에서 나무 2 draw/14 triangles·warm mesh upload 0,
양쪽 점광원·태양광의 hole 대비 0·solid 대비 64/80, fresh restore 픽셀 차이 0·최종 GPU 자원 0을 확인했다.

M2 코드 리뷰에서 Canvas 2D 왕복의 투명 RGB 손실을 실제 browser로 재현했다. 임시 WebGL2 readback으로
straight RGBA·행 방향을 보존하며 각 이미지의 다음 await 전에 자원을 해제한다. 4개 병렬 asset×2 images도
동시 임시 context 최대 1개와 전량 해제를 검사한다. decode 직후 취소는 bitmap을 닫고 GPU 준비를 시작하지 않는다.
cutoff의 1 바로 위·양수 underflow 경계, 여러 GPU 오류 이후 재시도, HTTP/size 오류의 cancel 실패 진단도 보강했다.
현재 리뷰·최종 검증은 같은 artifact root의 `m2-review-report.md`와 verification으로 갱신한다.
리뷰 후 Rust 1,374개·웹 872개, fmt/clippy·Wasm 포함 전체 lint/build·package/tarball·문서/API 검사와
packed browser 4조합을 통과했다. 문제 4건을 수정하고 재검토했으며 현재 MASK/양면 범위의 미해결 P0/P1은 발견하지 못했다.


### M2 후속: GLB normal map·발광 재질

정적 GLB의 normalTexture·emissiveTexture/emissiveFactor를 기존 WebGL2 공간 pass에 연결했다.
Blender에서 내보낸 UV0/TANGENT VEC4를 사용하며 tangent가 없는 normal map은 명시적으로 거절한다.
MikkTSpace 자동 생성이나 PBR 확장은 이번 범위가 아니다. node의 비균일 변환에서도 normal/tangent를
정규직교화하고 handedness·normal scale·양면 최종 normal을 적용한다. 지원 계약은 [공간 기능 문서](../engine/data-scene-spatial.md)를 따른다.

색상 텍스처와 linear normal을 구분하고 각 sampler를 적용한다. 발광은 scene light를 생성하지 않으며
기존 HDR 노출/톤 매핑·DOF·fog 경로를 사용한다. native pose ABI·저장 버전은 유지한다.
`tree-material.glb`는 자체 제작 회귀 fixture이며 실제 Blender 출력물의 수용 검증을 대신하지 않는다.
가로/세로·DPR 1/2의 packed consumer gate에 재질 픽셀/색 공간·shadow·복원·자원 검사를 연결했다.

다음 M2는 건물 hierarchy/보행면·다층 이동 통합, GPU 사전 준비 후 활성화 및 실제 Blender 출력물 검증이다.
이번 normal/emissive 구현으로 M2 전체를 완료 처리하지 않는다.


### M2 재질 후속 리뷰

GLB base/emissive의 LINEAR 필터를 색 경계 텍스처로 검사해 renderer 색상 모드에 따른 차이를 재현했다.
기본 모드도 sRGB GPU format을 사용하도록 수정해 보간 전에 linear 값을 사용하고 셰이더의 이중 decode를 제거했다.
normal/color의 동일 이미지 자원은 모드와 관계없이 구분한다. packed gate에 base/emissive 필터 경계 회귀를 추가했다.
단일 mesh의 primitive 제한도 문서의 asset 한도인 32와 맞췄으며 HTTP chunk 참조 누적을 연속 버퍼로 대체했다.
추가 오류 주입에서 null GPU allocation의 OOM flag가 다음 재시도에 남는 경우를 재현하고,
texture/buffer/sampler 할당 실패도 오류를 정리하도록 수정했다.
이 수정은 기존 N0 예산, native model instance ABI, 저장 버전 및 남은 M2 범위를 바꾸지 않는다.


### M2 후속: 건물 GLB·보행면·다층 충돌 통합

`SpatialTerrainSurface.render:false`를 추가해 모델 바닥과 겹치는 보행면의 중복 렌더링을 제거했다.
Rust 물리·층 연결·picking·debug는 유지하며 main/depth/shadow 제출만 제외한다. cold metadata bit 4와
선택 native capability v1로 오래된 Wasm은 활성화 전에 거절하고 frame/model ABI·기존 저장 hash를 유지한다.

열린 문·경사로·상층 바닥·벽을 가진 자체 제작 `building.glb`를 기존 fragment include/prefab과 명시적
world-unit AABB·보행면·층 연결에 조합했다. 같은 actor의 문 통과/높이·층 전환과 벽 차단/아래 통과,
모델 depth·point/sun shadow, 직교/원근 picking, 목적지 도착·fresh v7 복원·GPU 해제를 기존 packed gate에서 검사한다.
이 fixture는 실제 Blender 출력물 검증을 대신하지 않으며 imported node 계층은 static bake다.

남은 M2는 GPU 사전 준비 후 활성화, 실제 Blender 출력물의 축·단위·pivot·proxy 수용 검증,
일반 runtime parenting/모델 로컬 proxy 변환의 별도 계약이다. instancing·외부 glTF·대규모 모델·실제 GPU
시간 예산은 M3로 유지한다. 이번 slice로 전체 Blender 모델 파이프라인 완료를 선언하지 않는다.

건물 slice의 최종 검증은 Rust 1,376개·웹 881개, fmt/clippy·Wasm·전체 lint/build·package/tarball·문서/API 검사와
packed 가로/세로·DPR 1/2의 4조건을 통과했다. fresh 복원 framebuffer 차이 0, warm model upload 0·
8 draw/96 triangles, 보행 proxy main/shadow 제외와 최종 GPU 자원 0을 확인했다. 기존
`artifacts/hd2d-static-model/`에 최신 보고서와 88개 PNG를 갱신하고 추출 package/중간 실행 사본은 남기지 않았다.


### M2 후속: 모델 GPU 준비 후 씬 활성화

선택 `spatialModelPreparer`를 authoring apply/restore에 연결했다. CPU/content/pose 검증 뒤 기존 씬을
교체하기 전에 모델 전체 batch의 texture·vertex/index buffer·sampler와 기본 공간 shader를 준비한다.
준비 실패는 기존 native scene/progress와 GPU 자원을 유지하고, 성공한 native 적용 뒤 commit한다.
lease는 finally dispose하며 저장 버전·frame/native ABI를 바꾸지 않는다. 기존 lazy 경로도 유지한다.

cache는 immutable CPU resource identity를 사용한다. pending과 기존 자원을 함께 유지하고 실패 시
새 batch를 회수하며 새 engine ID의 동일 asset도 공유한다. 성공한 첫 render의 model upload는 0이다.
오류 주입·다중 asset 원자성·caller GL state·기존 handle/snapshot/framebuffer 보존·재시도·첫 frame 비용·
fresh restore·cancel/stale/destroy를 기존 packed 공간 CI gate에 연결했다.

현재 보호 범위는 모델 GPU 준비다. environment HDR/shadow FBO·postprocess target·동적 frame buffer,
runtime context loss와 arbitrary callback/native 적용 전체의 rollback은 별도 scene transaction 후속이다.
M2의 runtime 부모/모델 로컬 proxy 변환 계약과 실제 Blender 출력물 acceptance도 남아 있다.
M3 instancing·외부 glTF·규모·실제 GPU 성능과 WebGPU 공간 지원/검증은 유지한다.

최종 검증은 Rust 1,376개·웹 885개, fmt/clippy·Wasm 포함 전체 lint/build·package/tarball·문서/API 검사와
packed 가로/세로·DPR 1/2의 4조건을 통과했다. 각 조건에서 오류 4종의 기존 scene/progress/framebuffer·GPU 수
보존, cold pipeline 실패·재시도, 준비 8,712 bytes·첫 render 10 draw/110 triangles·model upload 0,
fresh engine의 준비 bytes/픽셀 차이 0과 최종 GPU 자원 0을 확인했다. 최신 증거는 기존
`artifacts/hd2d-static-model/`에 96개 PNG와 함께 갱신하며 추출 package/중간 실행 사본은 제거한다.

### M2 후속: 정적 모델 로컬 proxy 묶음 배치

모델과 로컬 AABB·보행면·연결을 root 위치/높이/90도 yaw/균일 scale로 한 번에 생성하는
`addSpatialModelAssembly` authoring API를 구현했다. 결과는 일반 Scene JSON이며 저장 포맷을 유지한다.
회전한 계단을 위해 native X ramp의 물리·층 연결·길찾기 slope 제한·mesh/pick/debug를 함께 연결했다.
확정 계약은 [모델 묶음 배치](../engine/data-scene-spatial.md#정적-모델-로컬-proxy-묶음-배치)를 따른다.

이는 정적 authoring 변환 slice다. runtime parent graph·움직이는 플랫폼/동적 proxy 추종,
일반 각도/비균일 scale의 복합 collider, 실제 Blender export acceptance, M3 instancing/streaming·
공간 WebGPU·실제 하드웨어 GPU 예산은 계속 남아 있다. 전체 모델 개발을 완료 처리하지 않는다.

최종 검증은 Rust 1,380개·웹 892개, fmt/clippy·전체 lint/build/Wasm·package/tarball·문서/API 검사를
통과했다. packed 가로/세로·DPR 1/2의 4조건에서 16개 배치 모두 native 도착·fresh v7 픽셀 차이 0,
첫 모델 frame upload 0과 최종 GPU 객체 0을 확인했다. 회전한 계단 경계의 아래층 오선택,
cardinal yaw 잔차, flat frame의 새 준비 제거와 삭제된 VAO index buffer 복원을 수정했다.
최신 증거는 기존 `artifacts/hd2d-static-model/`에 104개 PNG·소스 해시·검토 기록으로 갱신했다.

### M2 정적 모델 묶음 배치 재검토

지형 검증의 JS double/native f32 차이로 유효한 경계를 거절하거나 잘못된 경계를 뒤늦게 거절해
기존 씬을 제거하는 문제를 수정했다. 모델 로컬 정규화와 월드 검증을 분리하고, 실제 numeric buffer와
같은 f32 연산으로 범위·겹침을 검사한다. 폭·깊이가 f32에서 소실되는 면은 활성화 전에 거절한다.
native도 기존 지형을 교체하기 전에 같은 입력을 거절한다.

공개 공간 frame의 모델 자원은 내부 vertex/index·RGBA 배열 대신 불투명 asset handle만 전달한다.
위조 handle은 GPU 작업 전에 거절하며 기존 resource identity 기반 공유는 유지한다.
`constructor`·`__proto__`·`toString` 모델 ID의 기본 origin도 own property만 읽도록 수정했다.
이전 packed package와 수정본의 실제 Wasm 비교로 잘못된 배치의 기존 씬 보존과 해당 ID 적용을 확인했다.

발견 사항 3건(P1 2건·P2 1건)을 수정하고 재검토했으며 이 범위의 추가 P0/P1은 재현하지 못했다.
Rust 1,381개·웹 897개와 fmt/clippy·전체 lint/build/Wasm·package/tarball·문서/API 검사를 통과했다.
최종 packed browser 결과와 검증 한계는 기존 `artifacts/hd2d-static-model/assembly-review-report.md`에 기록한다.
공간 draw buffer ABI·저장 버전 및 남은 M2/M3 범위는 유지한다.

### M2 후속: 정적 assembly 자식 계층

`SpatialModelAssemblySpec.children`을 추가해 건물·부속 모델의 부모 기준 위치/높이·cardinal yaw·균일 scale을
모델·AABB·보행면에 함께 적용한다. 자식/손자도 일반 Scene JSON으로 평탄화하며 기존 저장 버전을 유지한다.
완성된 전체 결과를 검증해 자식 terrain으로 actor 계약을 완성할 수 있고, 실패 시 입력은 변경하지 않는다.
root 포함 깊이 8·64 assembly, namespace·순환/공유 객체 구분·합성 범위를 검사한다.
지원 계약은 [모델 묶음 배치](../engine/data-scene-spatial.md#정적-모델-로컬-proxy-묶음-배치)를 따른다.

검증 상태는 `artifacts/hd2d-static-model/hierarchy-report.md`와 같은 task의 verification에 기록한다.
원본 정적 계층은 작성 입력이며 runtime parent graph·움직이는 모델의 proxy 추종은 계속 후속이다.
실제 Blender export acceptance·전체 scene GPU transaction·M3와 WebGPU/하드웨어 성능 gate도 남아 있다.

최종 검증은 Rust 1,381개·웹 904개, fmt/clippy·전체 lint/build/Wasm·package/tarball·문서/API 검사를
통과했다. packed 가로/세로·DPR 1/2의 4조건에서 단일 배치 16개와 3단계 계층 16개의 native 도착·
fresh v7 픽셀 차이 0·첫 모델 upload 0과 최종 GPU 객체 0을 확인했다. 계층/독립 배치의 원래·복원 PNG
8쌍도 바이트 단위로 일치한다. 기존 `artifacts/hd2d-static-model/`에 112개 PNG·505개 배포 파일의
패키지 일치 검증·소스 해시를 갱신하고 중간 실행/추출 사본은 제거했다.

### M2 정적 자식 계층 리뷰

잘못된 proxy 배열을 빈 목록으로 처리해 충돌체/보행면/연결이 누락되는 문제와, f32에서 퇴화하거나
overflow하는 최종 collider 경계·높이를 허용하는 문제를 수정했다. 배열 생략과 null·빈 칸을 구분하고
월드 AABB의 최소/최대 경계·폭/깊이·높이 구간을 native 적용 전에 검증한다.

이전 packed package와 수정본의 CPU/실제 Wasm 비교 및 기존 handle·snapshot 보존 회귀를 추가했다.
3단계 browser 계층도 부모 transform이 상쇄되지 않게 변경해 yaw 90/scale 1.5의 중간 부모와
자식의 실제 native matrix basis를 검사한다. 회귀 gate는 기존 `smoke:spatial-scene` CI 경로를 사용한다.
검증·재검토 기록은 `artifacts/hd2d-static-model/hierarchy-review-report.md`와 같은 task의 verification을 따른다.
정적 작성 범위·render ABI·저장 버전 및 남은 runtime parent graph/실제 Blender/M3 범위는 유지한다.

P2 2건을 수정하고 재검토했으며 이 범위의 추가 P0/P1은 재현하지 못했다. Rust 1,381개·웹 907개,
fmt/clippy·전체 lint/build/Wasm·package/tarball·문서/API 검사와 packed browser 4조건을 통과했다.
각 조건에서 잘못된 proxy 10종의 사전 거절·기존 handle/hash/GPU 자원 보존, 부모/자식 native 행렬,
단일 배치 16개·계층 배치 16개의 fresh 복원 픽셀 차이 0과 최종 GPU 객체 0을 확인했다.
독립/계층 PNG 8쌍과 최종 배포 파일 505개의 바이트 일치를 검증하고 기존 artifact root를 갱신했다.


## M3 첫 규모 확장: 정적 모델 GPU 인스턴싱 (2026-10-17)

연속 동일 모델 자원의 main/point/sun draw를 WebGL2 instancing으로 묶고, 80-byte native bulk ABI와 저장 버전은
유지했다. 입력은 최대 1,024 instance/4,096 제출 primitive/262,144 triangles로 확장하며 구 Wasm의 확장 한도는
cold capability로 구분한다. main draw·triangle·asset upload와 별도로 실제 instanced draw·전체 pass 행렬 upload를 표시한다.
100/500/1,000개 공유 바위의 draw 1회/geometry 공유, native culling, fresh 저장 복원, 재질/그림자 픽셀 비교와
buffer storage 실패 재시도를 packed browser gate에서 검증한다. 확정 계약은 [공간 모델](../engine/data-scene-spatial.md)과
[smoke 기준](../development/quality/smoke-check.md)을 따른다.

M3 전체 완료는 아니다. 외부 glTF(.gltf + buffer/image) 입력·streaming·추가 재질/형식과 실제 대상 GPU 예산은 남아 있다.
M2의 runtime 부모/동적 proxy 추종·실제 Blender 출력물 acceptance·전체 scene GPU transaction, WebGPU 공간 지원도 별도다.


### M3 인스턴싱 코드 리뷰 보강 (2026-10-17)

공유 모델의 재질 검증을 개체마다 반복한 CPU 비용과 첫 frame의 native output Vec 용량 증가를 재현해 수정했다.
프레임당 자원별 재질 검사와 cold output 예약으로 옮기되 행렬/metadata·전체 예산 검증은 각 instance에 유지한다.
직접 작성한 renderer packet이 자원 등록 한도를 우회하지 않도록 참조 자원 수/bytes를 GPU 업로드 전에 검사한다.
서로 다른 회전/배율/높이의 normal/emissive 모델을 실제 개별 draw와 비교하고 shadow GL 호출·행렬 bytes·warm
cache hit를 같은 packed browser gate에서 검사한다. 지원 범위·ABI·저장 버전 및 남은 M2/M3 gate는 유지한다.


## M3 후속: 분리형 glTF 입력 (2026-10-17)

`loadSpatialGltf`로 HTTP glTF JSON과 최대 16 binary/16 PNG/JPEG의 제한된 정적 입력을 지원한다.
원래 bufferView 범위를 검증하고 자체 포함 bundle로 정규화해 기존 GLB decoder·모델 등록/렌더/물리 proxy·저장에 연결한다.
contentId는 종속 bytes를 포함하며 문서 2 MiB·전체 고유 전송/정규화 bundle 32 MiB와 취소/누락 파일을 검사한다.
확정 계약은 [분리형 glTF](../engine/data-scene-spatial.md#분리형-gltf-배경-모델), 운영 gate는
[smoke 기준](../development/quality/smoke-check.md)을 따른다.

같은 origin의 HTTP(S) dependency만 지원하며 redirect/data URI·streaming/LOD·추가 재질/포맷은 이번 slice 밖이다.
실제 Blender export acceptance·runtime parenting/동적 proxy·전체 scene GPU transaction, WebGPU 및 실제 대상 GPU gate는 남아 있다.

### 분리형 glTF 코드 리뷰 보강 (2026-10-17)

이미지 view를 추가하면 원래 범위 밖 accessor 참조가 유효해지는 입력 검증 누락과,
압축된 HTTP Content-Length를 decoded binary 길이와 비교해 정상 입력을 거절하는 문제를 재현해 수정했다.
원래 accessor/image 참조를 재배치 전에 검사하고, 압축/CORS 응답은 실제 decoded stream 상한을 적용한다.
실제 gzip 및 Content-Encoding이 숨겨진 cross-origin CORS 응답의 contentId 동일성과
잘못된 accessor 입력의 기존 씬 보존을 packed browser gate에 추가했다.
최종 검증과 재현 근거는 `artifacts/hd2d-static-model/external-gltf-review-report.md`에 기록한다.
입력 subset·ABI·저장 버전 및 남은 실제 Blender/streaming/WebGPU/hardware 범위는 유지한다.

## M3 후속: 공유 모델 preload 자원 수명 (2026-10-17)

`SpatialModelAssetCache`로 같은 URL/형식/content revision의 GLB/glTF 로드를 공유하고 독립 소비자 lease를 제공한다.
사용 중인 자원은 보존하며 idle LRU·entry/decoded bytes·동시 로드 상한을 적용한다. 한 소비자의 취소는 다른 소비자의
요청을 중단하지 않으며 마지막 대기자/전체 destroy는 로드를 취소한다. 실패·늦은 완료와 같은 key 재요청도 격리한다.
같은 불투명 handle을 기존 등록/preparer/renderer/진행 복원에 연결해 GPU resource identity 공유를 유지한다.
확정 계약은 [공유 모델 캐시](../engine/data-scene-spatial.md#공유-모델-캐시와-preload-수명),
운영 검증은 [smoke 기준](../development/quality/smoke-check.md)을 따른다.

자동 spatial chunk 선택·지형/물리 활성화·geometry streaming/LOD까지 구현한 것은 아니다. 실제 Blender 출력물·
runtime parent/proxy·전체 scene GPU transaction·추가 형식/재질·WebGPU/hardware gate도 남아 있다.
최종 검증은 기존 `artifacts/hd2d-static-model/model-asset-cache-report.md`에 기록한다.

## 실제 모델 적용 후속 1~6 (2026-10-17)

위 M2/M3 기록 이후 다층 길찾기 segment 후보 재사용, 큰 소스 primitive의 재질 batch 병합,
Blender unlit/emissive strength, native model yaw·attachment/proxy 동기화와 저장 v8,
자유 각도 OBB sweep/길찾기, 사전 등록한 CPU LOD의 native 선택·visual 청크 GPU 수명을 추가했다.
이전 기록의 runtime parent/proxy·추가 재질·LOD 미지원 상태는 해당 범위에서 해소됐다.
진행과 실제 입력/packed 검증은 [후속 1~6 기록](hd2d-models-followups.md)을 따른다.

자동 네트워크 geometry 스트리밍, 움직이는 보행면/탑승자 운반, 전체 scene GPU transaction,
WebGPU 공간 모델 지원·실제 대상 기기 GPU 시간 예산은 계속 별도 범위다.
