# Three.js 소스 대조 기반 물리 고도화

기준일: 2026-10-29 · Ferrum2D 기준 `bd2016b`
상태: 1단계와 HD-2D 보행 물리 적용·버그 수정 완료. 후속 뷰어 고도화에서 카메라 잘림도 수정했고 전체 마을 회귀를 검증했다. 탐색 비용·표시 보간·회전 CCD 후보는 미착수다.

## 분석 기준

공식 Three.js 저장소를 `/tmp/ferrum2d-threejs-source-review`에 shallow clone했다.
분석 ref는 `83f6bd095356c68334df7d9b7ec03a0abebff3fc`다.
임시 clone이 없어져도 아래 링크와 ref로 재현할 수 있다.

- [RapierPhysics](https://github.com/mrdoob/three.js/blob/83f6bd095356c68334df7d9b7ec03a0abebff3fc/examples/jsm/physics/RapierPhysics.js): 외부 물리 world와 mesh 연결, collider 생성, transform 동기화.
- [JoltPhysics](https://github.com/mrdoob/three.js/blob/83f6bd095356c68334df7d9b7ec03a0abebff3fc/examples/jsm/physics/JoltPhysics.js): 정적/동적 broadphase layer 구분.
- [AmmoPhysics](https://github.com/mrdoob/three.js/blob/83f6bd095356c68334df7d9b7ec03a0abebff3fc/examples/jsm/physics/AmmoPhysics.js): 외부 solver와 instancing 동기화.
- [RapierHelper](https://github.com/mrdoob/three.js/blob/83f6bd095356c68334df7d9b7ec03a0abebff3fc/examples/jsm/helpers/RapierHelper.js): physics world의 debug geometry를 시각화하는 별도 helper.
- [Octree](https://github.com/mrdoob/three.js/blob/83f6bd095356c68334df7d9b7ec03a0abebff3fc/examples/jsm/math/Octree.js): triangle 기반 공간 query. 현재 XY+층/높이 물리에 직접 이식하지 않는다.

Three.js의 해당 코드는 물리 solver 본체가 아닌 예제 adapter다. 독립 `setInterval`, CDN 로딩,
body별 JS/Wasm 호출과 Jolt wrapper의 미완성 setter는 Ferrum2D 실행 구조에 가져오지 않는다.
Rust가 시뮬레이션과 충돌 상태를 소유하고 TypeScript는 bulk buffer를 소비하는 경계를 유지한다.
Three.js나 다른 물리 엔진을 production 의존성으로 추가하지 않는다.

## 확인한 현재 상태

- 이미 강체, 복합 collider, 8종 joint, sleep/island, warm start, CCD, fixed timestep,
  snapshot/replay와 물리 debug buffer가 있다. [기능 맵](../development/architecture/physics-engine.md) 참고.
- 수정 전 `cargo test --manifest-path crates/ferrum-core/Cargo.toml --offline physics:: --quiet`는 259개 통과했다.
- 수정 전 별도 Rust 진단에서 60 Hz, 속도 600, 이동량 10으로 검사했다. 벽 중심은 x=5,
  양쪽 collider 반폭은 0.2다. 기본 collider는 x=4.6에서 멈추지만 moving/target의
  두 번째 collider만 경로에 있는 경우 둘 다 x=10까지 통과하고 CCD hit는 0이다.
- 수정 전 CCD 후보는 compound/chain을 순회한 뒤 entity index로 축약하고, 실제 sweep과 재질 선택은
  primary collider로 돌아갔다. 1단계에서 이 identity 손실과 primary sensor의 body 전체 solver 차단을 수정했다.
- 회전만 하는 긴 OBB를 한 fixed step에서 180도 돌리는 진단은 중간 장애물을 지나친다.
  선형 CCD의 현재 한계이며, 회전 sweep 구현은 1단계 범위에 포함하지 않는다.
- broadphase는 proxy를 재구성·정렬하며 CCD query마다 대상 proxy를 만든다.
  정적/동적 분리의 효과는 아직 측정하지 않았으므로 성능 향상을 단정하지 않는다.
- fixed timestep은 alpha를 계산하지만 현재 render command 생성에는 world의 최신 transform이 사용된다.
  표시 보간은 후보이며 물리 상태를 JS로 복제해 구현하지 않는다.

## 순서와 완료 조건

| 순서 | 범위 | 완료 조건 |
| --- | --- | --- |
| 1 · 완료 | 기존 선형 CCD의 compound/chain identity 보존 | moving/target의 모든 유효한 non-trigger collider·segment를 검사하고 가장 이른 hit를 선택. collider별 mask·재질·enable, body 높이·sleep/wake, tie 순서 보존. Rust 회귀와 Wasm/웹 검증 통과 |
| 2 · 후보 | 충돌 탐색 비용 측정과 정적 대상 재사용 | body/collider 수·배치·CCD 비율을 고정한 baseline, 후보/정렬/좁은 판정 비용 측정. mutation/teleport/despawn 이후 invalidation 검증 후 최적화 선택 |
| 3 · 후보 | 렌더 표시 보간 | 30/60 Hz 물리와 60/120 Hz 표시, 회전·카메라·picking·teleport·restore 경계 검증. simulation transform과 render pose 분리 |
| 4 · 완료 | HD-2D 물리 적용·진단과 실제 게임 검증 | 실제 공간 보행 API의 원형·캡슐·convex·compound/chain 충돌, 층/높이·sensor·mask·cached 비용·gateway 검증 완료. 마을 우물·보행·다리·강·경사로 적용 및 카메라 잘림 수정 후 전체 마을 DPR 1/2 회귀 통과 |
| 5 · 별도 설계 | 회전 CCD·외부 solver 비교 | 각속도/회전 반경/최소 두께별 실패 fixture, substep 상한·비용·기존 snapshot/API 영향 확정. 범용 3D 물리로 자동 확대하지 않음 |

## 1단계 검증

- moving secondary / target secondary / 양쪽 secondary / primary disabled·trigger.
- compound collider별 filter override, 다른 층·높이, 가장 이른 collider·chain segment,
  collider별 restitution, dynamic target wake, 동일 hit time의 안정적 선택.
- 기존 collision/physics/core 전체 테스트, fmt/clippy.
- Wasm 재생성, 웹 SDK build/test, 기존 physics browser sandbox smoke.
- public API와 Wasm ABI를 바꾸지 않는 내부 Rust 수정으로 제한한다.

신규 Rust 회귀 14개를 추가했다. Core 1,538개와 public component API 통합 테스트 1개, SDK 전체 테스트, 물리 smoke와
실제 Wasm 5개 사례, 브라우저 물리 demo suite, fmt/clippy, Wasm 포함 전체 빌드를 통과했다.
수정 후 실제 Wasm에서 기본/secondary moving/secondary target/양쪽 filter override/primary sensor의
모든 사례가 x≈4.6에서 정지한다. 분석·검증 로그는 `artifacts/physics-threejs-review/`에 남긴다.

문서 링크 검사와 Pages 생성, 이 계획의 새 HTML 페이지 생성은 통과했다. 전체
`validate:pages-artifact`는 기존 문서에서 연결한 `apps/placement-viewer-desktop/index.html`,
`packages/create-game/index.html`, `apps/placement-viewer/index.html`의 생성 누락 3건으로 실패한다.
이번 물리 변경과 별개인 docs routing 후속 항목이며, 링크 검증 전체 통과로 보고하지 않는다.

완료한 지원 범위는 [기능 맵](../development/architecture/physics-engine.md)과
[검증 기준](../development/quality/smoke-check.md)에 반영했다. 미착수 후보를 현재 지원 계약으로
문서화하지 않는다. 전체 계획 완료 시 이 문서를 삭제한다.

## HD-2D 적용 범위와 검증

HD-2D는 기존 Rust 보행 controller와 XY+층/높이 판정을 사용한다. 일반 강체 CCD만 고쳐서는
이 경로에 적용되지 않았다. `KinematicSweepScratch`와 broadphase를 collider/segment key 기반으로
바꿔 원·캡슐·convex·edge·chain과 secondary collider를 실제 sweep과 gateway overlap까지 연결했다.
캐시의 proxy 수와 비활성 child 방문 비용을 함께 계산하고, combat navigation/action의 준비 비용
상한도 동기화했다. 기존 frame 예산을 늘리거나 테스트 상한을 완화하지 않았다.

공식 마을 `village_well`에 반지름 20의 원형 collider를 적용했다. Blender 문서 생성 함수도
동기화했고 기존 manifest로 이 함수만 실행한 JSON이 예제와 의미적으로 같은지 확인했다.
geometry·texture·Blender 원본은 바뀌지 않아 전체 Blender export는 재실행하지 않았다.

- Core 1,543개·public component API 통합 테스트 1개, SDK 전체 테스트, fmt/clippy, Wasm 포함 전체 build 통과.
- `pnpm smoke:physics`: 새 공간 장애물·cached 비용·gateway 회귀 포함 통과.
- 공식 viewer browser 전체 회귀 통과.
- `placement-village-smoke.mjs --physics-only`: 실제 Play/WASD의 우물 x=-44 정지,
  12개 장애물/필터 사례, 다리 위 elevation 2→반대 둑 0, 강 앞 x=169.5 차단,
  경사로 13.5→정원 24→지면 0, Stop/Undo 후 작성 문서 보존 통과.
- 전체 마을 smoke는 패널/창 크기에 맞춘 편집 카메라 보정 후 DPR 1/2의 geometry clip·격자·이동 검사를 통과했다.
  기본 렌더링은 102 draw calls, model triangles 13,812로 기존 상한을 유지한다. 작성 게임 카메라와 이력도 보존한다.
- WebGPU/desktop GUI는 해당 코드 변경이 없어 재실행하지 않았다. 물리의 GPU별 차이를 주장하지 않는다.

현재 단계의 로그와 대조 근거는 `artifacts/hd2d-physics-application/`에 남긴다.
Actor의 단일 AABB 제한, mesh 삼각형 충돌 제외, 고속 회전 CCD 별도 설계는 유지한다.
