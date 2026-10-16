# HD-2D 공간 기반과 그래픽 후속 설계

기준일: 2026-10-16. 상태: **P0 WebGL2·층 연결·다층 이동, P1/P2와 아래 다섯 그래픽 보강 구현·회귀 검증 완료. 확장 gate 잔여**.
2026-10-04의 [#73 C1](https://github.com/silbaram/ferrum2d/issues/73) 효과 설계를 보존하되,
사용자 요구와 game-test 재현을 근거로 **입체 지형·카메라·높이/깊이·빌보드**를 먼저 구현한다.
아래 설계의 미구현 후보 필드와 확장 gate는 공개 API가 아니다. 현재 개발 소스의 P0 계약은
[Data Scene 공간 지형·카메라·빌보드](../engine/data-scene-spatial.md)에 정리했다. 기존 배포/평면 계약은
[Data Scene native runtime](../engine/data-scene-native-runtime.md),
[Data Scene presentation](../engine/data-scene-presentation.md),
[Physics Spec](../engine/physics-spec.md)을 따른다.

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
로컬 증거는 `artifacts/hd2d-spatial-foundation/`에 있으며 원본 게임 보고서는 변경하지 않았다.

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
순수 HEAD·수정 전 재현·최종 검증 근거는 `artifacts/hd2d-prepush-review/`에 남긴다.

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
최종 공간 증거는 `artifacts/spatial-scene-consumer-ubrlcF/report.json`과 screenshot 56장
(신규 품질 증거 20장 포함)에 있다. 평면 WebGL2 8조건·WebGPU 2조건은
`artifacts/data-scene-presentation-tsVCGN/report.json`, 기존 replay 17건은
`artifacts/hd2d-quality-review/replay/gameplay-replay-smoke-report.json`에서 확인했다.
Rust 1,366건·웹 857건과 lint/clippy/build/package 검증을 통과했다. 명령·변경 이유·제한은
`artifacts/hd2d-quality-review/review-report.md`에 남긴다. 이 경로들은 로컬 검증 산출물이며 배포 문서에 포함되지 않는다.

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

수정한 소스와 재현·재검증 결과의 최신 기록은 `artifacts/hd2d-code-review/review-report.md`다.
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
