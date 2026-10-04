# #73 C1: 2.5D 그래픽 후속 설계

기준일: 2026-10-04. [추적 이슈 #73](https://github.com/silbaram/ferrum2d/issues/73)의 C1 설계 결론과
후속 작업 초안이다. **아래 네 효과는 아직 구현된 공개 API가 아니다.** 현재 API의 기준은
[Data Scene presentation](../engine/data-scene-presentation.md)이다. B2 alpha 그림자는 별도의
완료 조건으로 검증하며, 이 문서가 A1~A4 게임 이식이나 #73 전체 완료를 의미하지 않는다.

## 범위 결정

현재 섬 게임의 진행·저장·UI·길찾기는 아래 효과를 기다리지 않고 개발할 수 있다. 그래픽은
normal map → 평면 receiver 분리 → 광선 차폐 → depth DOF 순으로 독립 검증한다.
각 효과의 기본값은 비활성화이며 끈 상태의 2D 출력·draw 수·GPU 자원은 기존 경로와 같아야 한다.
새 API/asset 계약은 각 작업의 prototype과 리뷰를 통과한 후 확정한다.

| 후속 단위 | 사용자에게 보이는 변화 | 선택한 첫 범위 | 대체 경로 |
| --- | --- | --- | --- |
| C1-N normal map | 나무·캐릭터 표면의 밝기가 빛 방향을 따름 | opt-in sprite normal, 방향광 1개, 제한된 점광원 | 현재 flat light/unlit |
| C1-R receiver 높이·층 | 다리·지면처럼 다른 평면에 올바른 그림자 | 명시적 평면과 layer/height의 수신 규칙 | 현재 단일 지면 B2/ellipse/box |
| C1-L 차폐 광선 | 차폐물 뒤에서 빛줄기가 가려짐 | 화면 공간 mask 기반 태양 광선 | 효과 끄기, 앱의 장식은 별도 |
| C1-D 깊이 심도 | 초점 거리 밖 오브젝트가 흐려짐 | 명시적 view depth가 있는 선택적 DOF | 효과 끄기, 별도 화면 blur는 근사로 표시 |

3D perspective, camera tilt/yaw, 3D model/mesh, 새 3D renderer는 이 설계의 범위가 아니다.
normal map을 도입해도 2D sprite가 3D 지오메트리가 되거나 B2가 실제 광선 추적을 제공하는 것은 아니다.

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

## 후속 이슈 초안

아래 네 항목을 독립 구현 이슈로 옮길 수 있다. 아직 원격 이슈를 생성하거나 릴리스 일정을 정한 것은 아니다.

1. **C1-N — opt-in sprite normal map lighting**: paired atlas 계약, 방향광 1개 prototype,
   기존 flat light와 중복 적용 방지, 위 픽셀·자원·batch gate. 범용 material 전면 교체는 제외한다.
2. **C1-R — 평면 shadow receiver의 높이·층 계약**: explicit plane과 light elevation,
   다리 2층 최소 사례, pair budget·fallback. 임의 3D mesh receiver는 제외한다.
3. **C1-L — mask 기반 태양 광선 차폐**: half-resolution mask/blur, bounded samples,
   alpha-hole·화면 경계·UI 제외·자원 해제. volumetric renderer는 제외한다.
4. **C1-D — 2.5D view-depth authoring와 선택적 DOF**: depth 단위부터 결정하고
   opaque/cutout prototype, halo·초점·depth 부재 fallback을 검증한다. screen-space blur와 별개다.
