# 보류된 물리 기능

이 문서는 Ferrum2D 물리엔진에서 아직 구현하지 않거나 prototype 이후 제품화 판단을 남긴 항목만 정리한다. 완료된 Physics Spec, runtime apply, debug, snapshot/replay, compound collider, weld joint, destructible terrain rect edit prototype의 기준 문서는 `docs/engine`과 `docs/development`에 둔다.

## 현재 보류 목록

| 항목 | 현재 상태 | 보류 이유 | 다음 진입 조건 |
| --- | --- | --- | --- |
| Worker physics | 보류 | Worker/Wasm threads는 현재 milestone 금지 범위이고, browser header/transfer/determinism 비용이 확정되지 않았다. | transferable buffer prototype benchmark와 main-thread replay hash 일치 |
| Wasm threads / SharedArrayBuffer | 보류 | COOP/COEP 운영 요구와 package 복잡도가 크다. | Worker benchmark에서 복사 비용이 병목으로 확인되고 별도 제품 승인을 받은 경우 |
| Dirty chunk destructible terrain | 후속 제품화 | 현재 rect edit prototype은 collision layer cache 전체 재빌드 기준이다. 큰 맵/빈번한 지형 변경에서 병목이 확인될 때 최적화가 필요하다. | tile 수/edit 빈도별 rebuild p50/p95 측정과 chunk cache 설계 |
| Pixel mask destructible terrain | 보류 | runtime texture update, contour extraction, collider rebuild, render 동기화가 동시에 필요하다. | tile 기반 제품화 이후 별도 prototype 목표와 성능 budget 확정 |
| Destructible terrain browser demo | 후속 | 현재 smoke는 Rust/engine deterministic 검증 중심이다. shooter tilemap mutation용 browser fixture는 별도 예제 설계가 필요하다. | deterministic tile 제거 이벤트와 debug summary UI 설계 |
| Wheel / suspension joint | 보류 | 차량/플랫폼 데모 가치는 있지만 solver tuning, ground contact fixture, debug 기준이 필요하다. | wheel을 core joint로 둘지 helper/preset으로 둘지 결정 |
| Pulley joint | 보류 | 사용 사례가 좁고 solver/debug/sandbox 비용 대비 우선순위가 낮다. | 실제 게임 예제 요구가 생기고 joint stress fixture가 정의된 경우 |
| Vehicle helper API | 보류 | core joint primitive보다 authoring helper/preset 성격이 강하다. | wheel/suspension 최소 primitive와 데모 목표 확정 |
| Dedicated chain collider storage | 보류 | 현재 Physics Spec `chain`은 edge segment로 낮춰 적용된다. 별도 runtime storage는 query/debug/serialization 계약이 추가로 필요하다. | tilemap boundary extraction 또는 edge segment 수 병목 확인 |
| Tilemap boundary extraction | 보류 | collision layer를 외곽선/chain으로 변환하려면 dirty rebuild와 collider ownership 정책이 필요하다. | chain runtime storage 또는 chunked terrain cache 설계 |
| CCD hit marker debug ABI | 보류 | 현재 CCD는 metric으로 확인한다. per-hit 위치 marker는 debug line buffer ABI 확장이 필요하다. | CCD 튜닝/레벨 제작에서 위치 표시가 필요해진 경우 |
| Full visual editor | 보류 | 현재는 `physicsEditor` metadata와 authoring schema까지만 지원한다. UI/editor 본체는 제품 범위가 크다. | editor 제품 목표와 저장 포맷/undo/preview 기준 확정 |
| Soft body | 보류 | rigid body solver와 다른 mesh/constraint/render/authoring 요구가 크다. | 별도 package/plugin prototype 승인 |
| Cloth | 보류 | pin/tear/self-collision/constraint graph가 필요하다. | `cloth-strip` 같은 단일 제한 prototype 목표 확정 |
| Fluid / particle physics | 보류 | gameplay physics보다 VFX 성격이 강하고 CPU/GPU 성능 리스크가 높다. | VFX preset으로 충분한지 먼저 검증 |

## 다음 개발 우선순위 후보

1. Dirty chunk destructible terrain
2. Worker physics transferable buffer benchmark
3. Wheel/suspension helper 또는 vehicle demo spike
4. Dedicated chain collider storage와 tilemap boundary extraction
5. Cloth-strip plugin spike

## 공통 진입 조건

- 현재 `pnpm smoke:physics`, `pnpm smoke:physics-replay`, `pnpm smoke:destructible-terrain`, `pnpm smoke:physics-demo-suite`가 통과해야 한다.
- 새 기능이 public API를 바꾸면 `docs/engine/public-api.md`와 `docs/engine/physics-spec.md`를 먼저 갱신한다.
- Rust/Wasm 경계를 바꾸면 `pnpm build:wasm`, `pnpm build`, 관련 browser smoke를 실행한다.
- Worker, WebGPU, Wasm threads, complex physics는 별도 설계/승인 없이 production path에 넣지 않는다.

## 중단 기준

- replay/snapshot 기준을 만들 수 없으면 gameplay physics 기능으로 취급하지 않는다.
- 60 FPS 기준 성능 budget을 설명할 수 없으면 core 기능으로 넣지 않는다.
- Physics Spec이 특정 장르나 실험 기능 때문에 복잡해지면 core 대신 별도 package/plugin으로 분리한다.
- browser 보안 header, worker lifecycle, GPU 요구가 사용자 배포를 어렵게 만들면 optional/experimental 범위로 제한한다.
