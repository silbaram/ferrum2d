# Ferrum2D Parry3D 수정 기록

Parry3D 0.31.1 원본은 `UPSTREAM.json`의 crates.io archive SHA-256와 파일별 해시로 고정한다.
기존 Rapier 의존성의 동일 버전을 local path로 연결하며 새 물리 backend나 production library를 추가하지 않는다.
Apache-2.0 라이선스와 원본의 개별 저작권·라이선스 고지를 보존한다.
현재(2026-11-22 확인) 상류 `src`의 Rust 파일 344개 중 30개를 수정했고 Rust 파일 11개를 추가했다.
수정한 파일은 모두 첫 줄에 Ferrum2D 수정 고지를 둔다. 추가한 파일은 Ferrum2D 원본이다.

- `src/query/ray/ray_ball.rs`: 구 중심에서 시작하는 solid ray의 TOI0에서 0 벡터를 정규화해 NaN 법선을
  반환하던 실제 공개 조회 오류를 수정한다. Capsule ray와 같은 `normalize_or_zero`를 사용하며, 기존 정규화가
  유한한 일반 경로의 법선 비트·TOI·inside 의미는 유지한다. 필터·결과 정렬·저장 형식·solver는 바꾸지 않는다.

- `src/utils/array2.rs`: 독립적으로 저장된 차원과 데이터 길이를 checked multiplication으로 검증한다.
- `src/utils/vec_map.rs`: 저장된 원소 수와 실제 occupied slot 수가 일치하는지 검증한다.
- `src/shape/heightfield3.rs`: 2×2 이상 height grid, 일치하는 status grid·삼각형 수, 유한한 값과 bounds,
  유효한 flag와 양수 수평 cell scale을 검사한다. bounds를 재계산하거나 저장된 shape를 교체하지 않는다.
- `src/partitioning/bvh/bvh_tree.rs`, `bvh/mod.rs`, `bvh_serde.rs`: Deserialize 반환 전에 free slot,
  부모/자식·leaf map, count와 유한한 bounds를 검증한다. 원본 wire, optimization cursor와 재사용 순서를
  보존한다. owned candidate의 parent index에서 정상 값이 사용할 수 없는 상위 bit를 임시 표식으로 쓰고,
  성공 전에 원래 bit를 복원한다. 부모 연결을 따라가는 stackless 순회로 rooted graph의 순환·잘못된 참조를
  재귀나 추가 scratch 할당 없이 거부한다. 최적화가 남긴 unreachable 이전 노드와 pending refit 상태를 보존한다.
- `src/partitioning/bvh/bvh_binned_build.rs`: 전체 rebuild는 rooted graph의 leaf만 원래 저장 순서로 모은다.
  이전 raw scan은 정상 최적화 후 retired 노드를 되살려 실제 16개 leaf를 41개로 늘렸다.
  기존 workspace `traversal_stack`을 node별 mask로 재사용하며 O(node storage)의 순회와 최대 4 bytes/node
  예약 공간이 추가된다. 일반 insert/remove/query/solver 계산은 바꾸지 않는다.
- `src/partitioning/bvh/bvh_geometry.rs`: immutable mesh/compound tree에는 연속 part ID, 정확한
  leaf 수·최소 저장 크기, 형상을 포함하는 leaf bounds와 refit된 ancestor bounds를 추가로 검사한다.
  generic dynamic BVH의 정상 pending refit·retired node 계약은 바꾸지 않는다.
- `src/shape/trimesh/serde_state.rs`: index 범위, topology의 3개 서로 다른 half edge·next/twin·vertex
  상호 참조, component range/color/face permutation, optional pseudo-normal 길이·유한값과 flag를 검사한다.
- `src/shape/convex_polyhedron/serde_state.rs`: vertex/edge/face incidence range와 reciprocal outgoing edge,
  live edge의 두 면·중복 참조, packed feature ID 범위, 유한한 정점과 unit normal/direction을 검사한다.
  저장된 deleted coplanar edge는 유지한다. owned candidate edge의 사용 불가능한 face 상위 bit를 임시
  표식으로 사용한 뒤 성공 전에 복원하며 추가 scratch를 할당하지 않는다. 전체 기하학적 볼록성 증명은 아니다.
- `src/shape/compound/serde_state.rs`: part pose·rotation, child composite 금지, part/전체/BVH bounds,
  flag와 optional normal-cone 저장 길이·유한값을 검사한다. 정상 cache를 재생성하거나 저장 순서를 바꾸지 않는다.
- `src/shape/serde_validation.rs`, `shared_shape.rs`, `shape/mod.rs`: SharedShape의 primitive 반지름·half extent,
  좌표와 rounded border의 유효성, half-space unit normal을 Arc 생성 전에 검사한다. Polyline/Voxels 등
  모든 variant의 완전한 검증을 제공하지는 않는다.
- `src/shape/convex_polyhedron.rs`: 비균일 scale의 face normal은 inverse transpose로 변환한다.
  반사는 face winding과 vertex의 outgoing edge를 갱신하되 feature ID를 유지한다. singular/non-finite scale과
  표현 불가능한 결과는 None을 반환한다. 기존 normal 곱셈이 면의 tangent와 수직이 아닌 실제 오류를 수정한다.
- `src/shape/trimesh.rs`: scaled pseudo-normal을 실제 정점에서 다시 계산한다. 기존 곱셈·정규화는
  비균일 scale의 각도 변화와 반사 방향, angle-weighted vertex normal의 크기를 잃었다.
  optional cache가 있는 cold shape scaling에 O(vertex + triangle) 재계산 비용이 추가된다.
- `src/partitioning/bvh/bvh_traverse_bvtt.rs`: 자기 교차 검색은 부모 링크를 사용한 postorder로,
  두 subtree의 교차 검색은 기존 workspace의 3-word frame으로 반복 순회한다. 기존 left-self/right-self/
  cross 및 LL/LR/RL/RR callback 순서와 change filter를 유지한다. leaf-subtree 순회는 caller의 frame prefix를
  보존한다. 이전 재귀는 유효한 깊이 16,384 저장 트리에서 기본 스택을 소진했다.
  자기 순회에는 추가 scratch가 없고 pair 순회는 pending depth마다 12 bytes와 leaf 순회의 기존 4-byte
  stack entry를 재사용한다. Vec는 부족할 때만 성장하므로 최초/최대 깊이 증가 비용은 별도 고려한다.
- `src/partitioning/bvh/bvh_tree.rs`: `subtree_depth`도 부모 링크로 순회해 추가 scratch와 깊이별 호출 스택을
  제거한다. empty/singleton·임의 subtree의 기존 depth 의미는 유지한다. 형식이나 트리 구조는 바꾸지 않는다.
- `src/utils/interval.rs`: cfg(test)의 scalar trig oracle을 generic interval과 같은 ComplexField backend로
  맞춘다. enhanced-determinism에서 host inherent f32 trig와 1 ULP 차이가 나는 원본 테스트 실패를
  pristine archive에서도 재현했다. production 수식·endpoint·exact equality assertion은 바꾸지 않는다.
- `src/partitioning/bvh/bvh_refit.rs`: 일반 트리는 최대32단계의 bounded 재귀로 기존 indexed preorder 경로를
  사용하고, 깊은 tail만 기존 destination buffer의 pending child ID·새 parent link로 반복 순회한다.
  in-place도 같은 고정 재귀 한도 뒤 parent link 반복 순회를 사용한다. 트리 전체 깊이에 비례하는 호출 스택이나
  별도 traversal scratch를 추가하지 않고 기존 preorder layout·flags·leaf mapping을 보존한다.
  기존 재귀 3종은 유효한 깊이 16,384 트리에서 기본 스택을 소진했다.
  optional parallel refit은 raw pointer로 전체 가변 Vec/VecMap을 공유하던 구조를 제거하고 분리된 mutable
  slice와 최대7단계 task 분할을 사용한다. 작은 subtree는 순차 처리하고 순차 tail에도 위의 고정 재귀 한도를 적용한다.
  기존 순회에서 layout 변경 여부를 함께 수집해, sparse leaf map은 index가 이동했거나 deep tail이 있는 경우에만
  join 후 한 번의 O(node count) scan으로 갱신한다. 변경되지 않은 preorder tree는 별도 scan을 실행하지 않는다.
  순회용 별도 scratch는 없으며 기존 target/parent buffer는 필요할 때 성장한다.
  버퍼가 충분한 순차 refit은 추가 할당이 없고 Rayon runtime 초기화 비용은 별개다.
  기존의 사용하지 않는 root-parent metadata와 in-place root-leaf flag 동작도 조용히 정규화하지 않는다.

- `src/query/gjk/gjk.rs`: 선형 ray/shape cast가 아직 lower bound 0에 있을 때 거의 coplanar한
  simplex의 upper bound가 증가하면 마지막 유효 projection 방향의 signed dominant axis로 독립적인
  support plane을 구한다. 그 면이 수치 허용 오차보다 큰 양의 분리를 증명하고 ray가 접근할 때만
  이전 simplex의 유효 witness를 초기점으로 한 번 재시작한다. 새 면은 기존 halfspace clipping을
  반드시 거쳐 lower bound를 앞으로 진행시키며 실제 ray·형상·skin과 원래 수렴·분리 검사를 보존한다.
  재시작도 기존 100-iteration 예산을 소비하며 초기 support를 포함해 최대101 support pair다.
  비정체 fast path에는 support query가 추가되지 않으며 강제 TOI 0·collider 제외·할당을 사용하지 않는다.
  큰 box 위 capsule의 유효 gap 0.0101·target 0.01·비스듬한 접근이 None이 되던 실제 오류를 수정한다.
- `src/query/shape_cast/shape_cast_support_map_support_map.rs`: cfg(test) 회귀로 분석적 양의 TOI,
  witness/normal, scale·shape 순서·rotation·다른 convex 쌍, 짧은 max TOI·tangent·moving-away·진짜 miss,
  실제 penetration/skin 경계 정책과 support 호출 상한을 검증한다. 이 파일의 production 수식은 바꾸지 않는다.

저장 구조 검증은 cold Deserialize에 적용한다. 위에 명시한 rebuild·shape scaling·BVTT/refit 순회·GJK cast 수정을 제외하고
삽입·삭제·refit·solver·query 계산식을 바꾸지 않는다.
이 검증이 모든 형상·cross-arena·수치 연산·실제 할당 예산과 외부 파일 importer를 완성했다는 의미는 아니다.
BVH build의 다른 재귀 경로와 모든 query/작업 예산까지 해결했다는 의미도 아니다.
상류 업그레이드 시 원본 archive diff, Serde 비활성/활성, dirty/free slot 왕복·continuation, 기존 snapshot
portability와 실제 WASI/브라우저 replay를 다시 검증해야 한다.


## 저장 contact workspace의 내부 참조와 geometry context

지원5종 contact workspace의 raw manifold correspondence를 검사하는 숨김 vendor API
`query::validate_stored_contact_workspace`와 `StoredWorkspaceLimits/Usage/Error`를 추가했다.
5개 workspace의 private readonly accessor와 query module 연결은 필드/Serde 순서를 바꾸지 않는다.
기존 Voxels/Custom을 포함하는 범용 vendor Serde 계약도 그대로 유지한다.

4개 map workspace는 raw capacity/entry/manifold/scratch를 먼저 charge하고 timestamp·index 완전bijection·
key/owner/변환 pose를 검사한다. Comp–Comp key는 원래 shape 순서, Heightfield–Comp는 heightfield-first
순서다. 저장 map/배열을 정렬·수정하지 않고 fallible scratch만 사용하며 반복 attacker hash lookup이 없다.
Pose equality는 물리적인 translation/rotation만 비교하고 읽지 않는 u32 padding은 보존한다.
Whole-shape placeholder0과 decomposed triangle/part0의 의미를 구분해 heightfield의 삭제 cell도 허용한다.

TriMesh는 canonical empty invalid AABB와 유한 ordered AABB를 구분하고, drain이 끝난 old_interferences가
빈 상태인지·ID/실제 manifold row 대응·중복·현재 immutable geometry의 교차 leaf set 완전성을 확인한다.
현행 binary BVH가 실제 leaf ID를 내보내는 소스와 fixture를 사용하며 예전 SIMD padding 주석을 불변식으로
오인하지 않는다. 직접 validated leaf lookup과 fallible bitmap으로 uncharged traversal stack 할당을 피한다.
SHAPE pending이면 다음 updater가 cache를 버리므로 현재 replacement geometry와 old key/pose를 대조하지 않고
old 내부 correspondence만 검사한다. 이는 shared topology/전체 decoder hash work/실제 allocator/RSS 증명이 아니다.

정상5종×flipped·sleep/recycling·codec/원본6step·64shape pair 중48개 actual workspace와 malformed guard-only
회귀를 `artifacts/physics-3d/goal-closure/native-contact-workspaces`에서 추적한다.
## Workspace None의 primitive root metadata admission

숨김 `validate_stored_contact_manifolds_without_workspace`를 추가했다. 이미 query된 current primitive pair는
raw manifold가 하나이며 양쪽 subshape 0/subpose None이어야 한다. 아직 접촉 검사되지 않은 empty pair는 허용한다.
Known pending SHAPE에서는 이전 history를 보존하고 다음 producer reset을 기다린다. 저장 field/Serde/tag는
바꾸지 않으며, 현재 context의 root 역할을 검사한다. 정상 shape replacement를 막는 무조건 None 거절은 없다.


## File-only SharedShape same-value alias proof

`shape/file_aliases.rs`와 `shape/file_aliases/encoding.rs`는 지원7개 actual concrete type의
저장 Serde-event를 float bits/field names/BVH/flags/topology까지 bounded byte 비교한다.
Custom Shape의 overridable tag를 신뢰하지 않으며 nested/nonconvex compound child는 거절한다.
새 비교 encoding은 scratch 전용이고 기존 SharedShape/Compound memory Serde 형식은 유지한다.
Equality token은 양쪽 Arc를 pin하며 apply 시 원래 Arc identity를 확인해 COW 이후 stale token을 거절한다.
`Compound::rebind_saved_child`는 private owner hook으로 증명된 같은 값의 Arc만 연결하고 pose/BVH/flags를
변경하지 않는다. 부모는 unique Arc여야 하며 clone/rebuild로 history를 수리하지 않는다.
Work에 emitted/compared bytes도 포함하고 scratch는 누적 requested payload다. Actual allocator/RSS bound나
전체 Engine/file admission으로 간주하지 않는다. Production dependency/public Ferrum ABI/wire 변경 없음.
소스·패치·정상 shared producer/손상 guard-only·COW/replay/예산 증거는
`artifacts/physics-3d/goal-closure/native-file-shape-aliases/reports`에서 추적한다.

## 실제 trajectory query의 원래 local witness

- `query/sweep_toi/proxy_distance.rs`, `mod.rs`: 별도 3D readonly variant가 기존 simplex의 원래 A/B indices와 weights로 local core witness를 반환한다. Affine anchor+weighted differences로 공통 source plane을 보존하며 좌표 snap이나 radius/clearance 변경은 하지 않는다.
- 원래 `proxy_distance` API/결과/Serialize wire는 그대로이며 `const LOCAL_WITNESS=false` 경로는 추가 local-witness 계산을 실행하지 않는다. 새 variant는 힙 할당/iteration 증가 없이 최대4개 simplex point만 읽는다.
- Core가 A-relative로 이미 반올림된 B witness를 다시 world로 옮기면서 실제 접촉을 작은 양수 gap으로 만들던 오류를 막기 위해 각 원래 pose에 local witness를 적용한다.

## 실제 contact의 기존 Cuboid/Capsule SAT 명시 사용

- `query/contact_manifolds/mod.rs`: 기존 `contact_manifold_cuboid_capsule(_shapes)` module/export를 활성화한다. 일반 `DefaultQueryDispatcher` 선택은 변경하지 않고 Core actual fullshape contact census에서만 명시 호출한다.
- 원래 SAT face/edge 선택과 finite-feature clipping의 full shape/radius/normal을 유지해 평면 접선에서 generic smooth-GJK normal 오차가 tiny upward impulse를 만들지 않도록 한다.
- 이 기존 비활성 module의3D API 호출을 현재 `Cuboid::support_face`와 `PolygonalFeature::contacts(pos12,pos21,n1,n2,feature1,feature2,...)` signature에만 맞춘다. SAT separation/prediction 검사·radius 조정·finite feature clipping의 수학은 변경하지 않는다.

## Original cuboid local support witnesses

- Cuboid-cuboid SAT face contacts retain each actual support witness in its
  original shape-local frame. The other witness is projected as before.
  This avoids inverse-transforming a rounded relative-frame witness back into
  its original shape, which can create a spurious in-plane gap near contact.
- No shape expansion, coordinate snapping, clearance or prediction acceptance
  threshold changes; the original edge-edge algorithm and public API remain.

## Selected finite SAT face for cuboid penetration

- When SAT selects a penetrating cuboid face, project its opposing original
  support vertex onto that selected finite face, clamping the other face
  coordinates to the original extents. Projecting onto the nearest arbitrary
  boundary can return the same vertex on an unrelated edge and erase the
  negative signed support gap.
- Separated face/vertex and edge/edge paths retain their existing closest-point
  behavior; no prediction threshold, shape, solver, wire or public API changes.

- `src/query/sweep_toi/proxy_distance.rs`, `sweep_toi/mod.rs`: 3D original-core GJK에
  `proxy_distance_with_local_witness_metered`의 fallible 사전 admission을 추가한다.
  Bootstrap/cache(최대3), 실제 각 simplex body(최대32), 원 A→B cloud support scan,
  Finish/witness/cache publish 직전에만 callback을 호출한다. Err면 외부 SimplexCache는
  변경하지 않는다. 기존 두 API는 const METERED=false/Infallible specialization으로
  callback 경로 없이 원 F32 문장/연산/iteration/반환/cache 순서를 보존한다.
  Core는 실제 simplex 크기의 bounded fixed phase와 실제 점 방문을 분리 청구하며
  BoxBox/BoxCapsule 특수 finite query에는 실행하지 않은 GJK32 reserve를 청구하지 않는다.
  별도 Native contact fallback의 원32 reserve는 실행 전에 계속 보존한다. 이 reserve는
  Native GJK100/EPA/heap/silhouette의 전체 작업 상한을 증명하지 않으며, 전체 fallback
  metering은 필수 후속 A29로 남긴다. 저장/World/Wasm ABI/원 shape/skin/iteration cap은 불변이다.

- `src/query/{native_work,gjk/gjk,epa/epa3,contact/metered}.rs`: A29는 위 Native
  fallback을 원 point-cloud leaf dispatcher와 같은 순서로 계량한다. GJK는 원
  단일 private core에서 const-false/true 경로를 사용하며 perturb `continue`를 포함한
  매 loop를 실행 전에 승인한다. EPA도 단일 core를 유지하고 모든 bootstrap support,
  invalid-face를 포함한 heap pop, 확장, silhouette edge, 새 face, 종료 witness를
  승인한다. metered silhouette만 fallible local DFS stack을 사용해 원 adj1→adj2
  방문 순서를 보존한다. 기존 API의 recursive 경로/F32 식/100 counter와 EPA의
  `niter > 100` 종료는 그대로다.
- `contact_point_cloud_metered`는 `ToiProxy`의 전체 leaf 목록만 받는다. Ball의
  primitive PointQuery와 convex/round PointQuery 내부 GJK/EPA 및 feature lookup까지
  포함하며 composite/custom은 원 Core leaf 입구와 같이 범위 밖이다. 공개 entry는
  immutable pose/shape와 callback만 받고 simplex/EPA를 새 local 소유로 만들어 Err
  때 원 World/shape/cache에 설치하지 않는다. 기본 일반 `contact` 계약은 유지한다.
- 저장소 증가는 원 local Vec/heap의 target requested backing bytes와 relocation bytes를
  기존 shared Work ledger에 **예약 전에** 합산한 뒤 `try_reserve_exact`를 사용한다.
  새 기본 allowance/필드/TLS/dependency는 없다. 논리 요청 byte/방문 단위는 allocator
  actual capacity, 물리 메모리/RSS, scalar 명령 수 또는 elapsed 상한이 아니다.
  metered 저장소의 요청 target은 checked `max(len+1, 2*capacity, 4)`로 정해 원
  amortized 성장에 없던 원소당 exact 재할당을 도입하지 않는다. target bytes와
  relocation bytes 승인 후에만 `try_reserve_exact(target-len)`을 실행한다.
  기본 경로는 const false에서 원 push/allocation 순서로 동작하며 compiler 성능은
  이 source patch만으로 실측했다고 주장하지 않는다. EPA/단순체 struct와 wire는 불변이다.

## 고정 틱 복원용 BVH 복사

`Bvh::step_credit_bytes`와 `try_copy_step_credit`는 노드, 부모, 희소 leaf 슬롯,
재사용 목록과 최적화 위치를 보존한다. 상한 확인 뒤 호출자가 소유한 배열을 재사용해
일괄 복사하며 트리 깊이에 따른 재귀와 직렬화가 필요 없다.
