# 오브젝트 배치 UI · 데이터 씬 authoring 보강 계획

이 문서는 "사람이 UI로 오브젝트 **위치**를 배치하고, AI agent가 그 위에 **기능(behavior)** 을 붙이는" 개발 흐름을 가능하게 하기 위해 Ferrum2D의 World/Scene 구성에서 무엇을 먼저 보강해야 하는지를 정리하는 planning 문서다. 구현 착수 전 개념과 순서를 합의하는 문서이며, 실제 public API와 운영 계약은 `docs/engine`·`docs/development` 확정 문서가 우선한다.

기본 언어는 한국어다. 이 문서는 [리팩토링 로드맵 작성본](refactor-roadmap.md)의 후보를 **중복 관리하지 않는다.** 엔진 구조 후보의 canonical 추적은 그 문서에 두고, 이 문서는 위 유스케이스 관점에서 개념을 구체화하고 slice 순서를 정렬한다.

관련 확정/계획 문서:

- 데이터 씬 authoring 최소 계약: [Data Scene Authoring Contract](../engine/data-scene-authoring.md)
- 런타임 확장성 확정 계약: [Runtime Extensibility](../engine/runtime-extensibility.md)
- 엔진 구조/책임 경계: [Architecture](../development/architecture/architecture.md)
- 엔진 구조 후보(데이터 기반 씬 조립, Scene 추상화 승격): [리팩토링 로드맵 작성본](refactor-roadmap.md)
- 데모 노출 구조: [데모 게임 포트폴리오 보강 계획](demo-game-showcase-plan.md)

## 결론

- 목표 흐름: **사람 → 위치(spatial placement)**, **agent → 기능(behavior)**. 둘은 하나의 `ferrum2d.consumer.scene-authoring` 문서를 공유한다.
- 이 분담은 새 아키텍처가 아니다. `sceneComposition`(위치) 와 `behaviorRecipes`(기능) 는 이미 파일 구조로 분리돼 있다(`docs/engine/samples/data-scene-minimum.scene-authoring.json` 참조).
- 끊어진 다리는 정확히 하나다: **`SceneComposition` instance → 실행되는 `World` 엔티티로 가는 제네릭 spawn 경로가 없다.** 현재 `spawnSceneInstance`은 템플릿마다 손으로 구현하고, topdown 템플릿은 `builtinShooterPlayer` 한 종류만 받고 엔티티 `{1,0}`을 하드코딩으로 반환한다(`packages/create-game/templates/topdown/scripts/ferrum-harness.mjs`).
- 따라서 보강 순서는 다음과 같다.
  1. **제네릭 data-scene spawn**: `props.components` → `World` 엔티티 resolver (`EntityTemplate` 승격).
  2. **`instance.id` ↔ `Entity` 지속 매핑**: 선택·프리뷰·agent 타겟팅의 토대.
  3. **`World` 장르 누수 정리**: `World.player` → marker/tag, `nearestPlayer`/`ShooterPrefabRegistry` 네이밍 (목표를 막지 않으므로 마지막).
- 배치 UI 자체는 위 1~2 위에 올라가는 **얇은 editor-only 계층**이며, 엔진 core에 런타임 scene-graph/GameObject/Node를 도입하지 않는다.
- **승인 게이트**: 배치 UI는 visual editor 계열 기능이다. AGENTS.md상 visual editor는 기본 제품 목표가 아니며 별도 승인이 필요하다. 이 문서의 Slice 1~2(엔진 enabler)는 데이터 씬 조립 후보의 일부로 진행 가능하지만, Slice 4(배치 오버레이) 착수 전 승인을 받는다.

## 현재 상태 진단 (리뷰)

### 이미 있어서 재사용할 것

| 유스케이스 요소 | 기존 자산 | 위치 |
| --- | --- | --- |
| 엔티티 핸들 | `Entity { id, generation }` (generational index) | `crates/ferrum-core/src/entity.rs` |
| 컴포넌트 저장소 | `World` (SoA), spawn/despawn 생성 검증 | `crates/ferrum-core/src/world.rs`, `world/entity_lifecycle.rs` |
| spawn 정의(=prefab 본체 후보) | `EntityTemplate` (sprite 크기 + collider shape/size + frame + animation) | `crates/ferrum-core/src/world/templates.rs` |
| 배치된 오브젝트(=위치) | `SceneCompositionFragmentInstanceSpec` `{id?, prefab, variant?, props, transform}` | `packages/ferrum-web/src/sceneComposition.ts` |
| 오브젝트 종류 | `SceneCompositionPrefabSpec` (+ variant 상속) | `packages/ferrum-web/src/sceneComposition.ts` |
| 그룹/계층 | `Fragment` + `include` + transform 합성 | `packages/ferrum-web/src/sceneComposition.ts` |
| 행동(기능) 정의 | `behaviorRecipes.entities` | `packages/ferrum-web/src/behaviorRecipes.ts` |
| 문서 + 검증 | `ferrum2d.consumer.scene-authoring` envelope + `resolveSceneAuthoringDocument(...)` | `packages/ferrum-web/src/sceneAuthoringDocument.ts` |
| 엔티티 참조 핸들 | `GameplayEntityHandle { entityId, entityGeneration }` | `packages/ferrum-web/src/gameplayAuthoring.ts` |
| 피킹용 쿼리 | Rust point/nearest/area query (이미 존재) | core query API |

### 끊어진 곳 / 장르 누수

- **제네릭 instance→entity spawn 없음.** `applySceneCompositionFragment(target, ...)`은 `target.spawnSceneInstance(instance)`에 위임만 하고, 그 구현은 consumer 몫이다. 패키지가 주는 generic resolver가 없다. 결과적으로 `props.components: { sprite, collider }` 라는 *배치 의도*가 샘플에 적혀 있어도(`data-scene-minimum.scene-authoring.json`), 이를 실제 `World` 컴포넌트로 설치하는 런타임이 없다.
- **`World.player` 장르 누수.** 범용 `World`가 단일 플레이어 역할을 필드로 안다(`world.rs`). 같은 엔진이 `GameplayTags`/`GameplayFaction` 범용 분류를 이미 가지므로, "player"는 tag/marker가 일관적이다.
- **built-in scene 이중 구조.** Shooter/Breakout/Platformer는 하드코딩 Rust scene이고, 제네릭 Data Scene(`useDataScene()`)은 별도 generic ECS tick이다(`engine/scenes.rs`). 배치 UI + agent 흐름은 본질적으로 **Data Scene** 경로다.

### 기존 로드맵과의 관계

이 문서의 엔진 enabler는 [리팩토링 로드맵 작성본](refactor-roadmap.md)의 다음 후보가 토대다.

- **데이터 기반 씬 조립 경로** (P2~P4, ⬜ 미착수): Slice 1~2가 이 후보의 첫 실현 단위에 해당한다.
- **Scene 추상화 승격** (P4, 승인 필요): Slice 6(장르 누수 정리)과 방향이 같다.

→ 후보의 상태/롤백/영향 파일 추적은 리팩토링 로드맵에 남기고, 이 문서는 placement 유스케이스의 개념·순서만 책임진다.

## 개념 모델

### 사람 ↔ agent 소유 경계

한 파일을 둘이 편집하므로 **필드 단위로 겹치지 않게** 나눈다. 아래대로면 충돌이 거의 0이다.

| `scene-authoring.json` 영역 | 소유자 | 내용 |
| --- | --- | --- |
| `sceneComposition.fragments[].instances[]` | **사람(UI)** | `id`, `prefab`, `variant`, `x`/`y`/`rotation`/`scale`/`layer` |
| `sceneComposition.prefabs[].props.components` | 공유 prefab catalog | `sprite`, `collider`, `size` |
| `sceneComposition.prefabs[].props.behaviorRecipes` (바인딩) | **AI agent** | 어떤 recipe를 붙일지 |
| `behaviorRecipes.entities` | **AI agent** | 실제 기능 정의 |

핵심 계약: UI는 파일을 저장할 때 **자기가 소유하지 않는 키(특히 `behaviorRecipes` 관련)를 보존**한다.

### `instance.id` = 사람↔agent 공용 어휘

배치 UI의 진짜 가치는 "말로 위치를 설명"하는 비용 제거다. 사람이 박스를 놓고 `turret_left` 라고 이름 붙이면, agent에게 좌표 대신 **이름**으로 지시한다("`turret_left`가 플레이어를 조준해 2초마다 발사"). 따라서 `instance.id`(와 prefab/variant 이름)는 두 작업자 사이의 안정 계약이며, UI는 의미 있는 id 부여/이름 변경을 지원해야 한다.

### 구체화 대상 개념과 위치

| 개념 | 위치 | 성격 |
| --- | --- | --- |
| ① 제네릭 prefab catalog + spawn resolver (`props.components` → `World`) | Rust core(`EntityTemplate` 승격) + TS authoring | 신규(핵심 토대) |
| ② `instance.id` ↔ `Entity` 지속 매핑/조회 | TS authoring/runtime | 신규 |
| ③ 비충돌 save/merge (UI 소유 키만 갱신) | TS editor-only | 신규 |
| ④ selection/picking (screen point → instance) | TS editor-only (+ 기존 point query) | 신규(UI) |
| ⑤ de-genre `World` (`player`→tag, 네이밍) | Rust core | 정리 |

## 구현 Slice

### Slice 0: 개념·소유 경계 확정 (이 문서)

산출물:

- 이 planning 문서와 planning README 링크
- 사람/agent 소유 경계표와 `instance.id` 계약 합의

검증:

- `pnpm validate:docs-links`
- `pnpm build:pages`

### Slice 1: 제네릭 data-scene spawn resolver (핵심 토대)

`props.components`(sprite/collider/size/기본 컴포넌트)를 읽어 `World` 엔티티를 만드는 제네릭 resolver를 Data Scene 경로에 추가한다. spawn 정의는 `EntityTemplate`을 authorable catalog(prefab id → template)로 승격해 재사용한다. 렌더러 변경은 불필요하다 — `World`에 `Sprite`/`Transform`을 설치하면 기존 render command 경로로 그려진다.

산출물:

- prefab id → spawn 정의(catalog) 계약과 `props.components` 매핑 규칙
- `useDataScene()`에서 resolved instance를 `World` 엔티티로 설치하는 제네릭 spawn 경로
- 패키지 제공 default `spawnSceneInstance` target(템플릿별 하드코딩 대체)

검증:

- `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
- `pnpm build`
- `pnpm validate:data-scene-authoring`
- 신규: 샘플 scene을 spawn해 entity/sprite count를 단언하는 smoke

### Slice 2: `instance.id` ↔ `Entity` 지속 매핑

Slice 1 spawn이 반환하는 `GameplayEntityHandle`을 `instance.id`별로 모아 양방향 조회(이름→엔티티, 엔티티→이름)를 제공한다.

산출물:

- 매핑 레지스트리와 조회 API(편집/재적용 시 재동기 포함)
- agent behavior 바인딩이 이 id로 대상 엔티티를 찾는 경로

검증:

- `pnpm --filter @ferrum2d/ferrum-web test`
- 신규: id→entity 왕복과 despawn 후 stale 처리 단언

### Slice 3: 배치 프리뷰 (위치 확인)

placed instance를 화면 좌표에 렌더해 위치를 눈으로 확인한다. 풀 게임 런타임 없이 sprite 배치만으로 충분하며, Slice 1이 있으면 `useDataScene()` 라이브 프리뷰로 대체 가능하다.

산출물:

- editor camera(게임 카메라와 분리), screen↔world 변환, grid/snap
- 선택/호버 표시(기즈모는 debug-line buffer 또는 DOM overlay 재사용)

검증:

- 예제 앱 수동 확인 체크리스트
- 신규: headless 좌표 변환 단위 테스트

### Slice 4: dev-only 배치 오버레이 프로토타입 (승인 후)

별도 에디터 패키지를 짓지 않고, 데모/example 앱 안의 dev 전용 오버레이로 시작한다. 캔버스 위 드래그 → `instances` 갱신 → `scene-authoring.json` 저장(비충돌 머지).

산출물:

- 오버레이 UI(배치/이동/이름 부여), 소유 키만 갱신하는 저장기
- 단일 fragment 평면 편집(중첩 fragment 역변환은 v1 제외)

검증:

- 저장 후 `pnpm validate:data-scene-authoring`
- 저장이 `behaviorRecipes` 영역을 보존하는지 단언하는 smoke

### Slice 5: agent 기능 부착 루프 검증

배치된 오브젝트에 agent가 recipe를 붙이는 end-to-end 루프를 회귀로 고정한다.

산출물:

- 배치(위치) + agent 부착(behavior) 결과를 고정하는 gameplay replay fixture
- consumer/agent 템플릿에 "배치→기능 부착" 워크플로우 반영 여부 결정

검증:

- `pnpm smoke:gameplay-replay`
- 신규: 배치+behavior fixture의 결정론 검증

### Slice 6: `World` 장르 누수 정리 (non-blocking)

`World.player` → marker/tag 컴포넌트, `nearestPlayer`/`ShooterPrefabRegistry` 네이밍을 제네릭으로. 목표를 막지 않으므로 마지막. Slice 1에서 제네릭 prefab으로 player를 만들면 자연히 드러나니 함께 풀 기회가 있다. snapshot 버전/테스트 영향은 [리팩토링 로드맵](refactor-roadmap.md)의 Scene 후보와 조정한다.

검증:

- `cargo test`, snapshot/replay 회귀, `pnpm smoke:gameplay-replay`

## 제외 범위

- full visual editor(노드 트리 편집, 풀 prefab 에디팅, 멀티유저 동시 편집)
- 엔진 core의 런타임 scene-graph / `GameObject` / `Actor` / `Node` 도입
- behavior 자체의 UI 편집(기능은 agent 소유) 및 behavior undo
- 중첩 fragment 절대→상대 transform 역변환(v1 단일 fragment 평면 편집으로 제한)
- frame hot path의 entity별 JS/Wasm callback

## 열린 질문

- 편집 단위: 단일 fragment 평면 편집(권장, v1) vs fragment 계층 보존 편집?
- 프리뷰: `useDataScene()` 라이브 spawn(권장) vs 경량 editor 전용 렌더?
- prefab 정의 소스: `EntityTemplate` 승격(권장) vs 신규 generic catalog 신설?
- `World.player`→tag를 Slice 1과 묶을지, Slice 6으로 분리할지?
- 배치 오버레이를 `examples/*` dev 모드에 둘지, 별도 패키지로 둘지?
- 이 문서의 Slice 1~2와 리팩토링 로드맵 "데이터 기반 씬 조립" 후보의 상태 추적을 어떻게 단일화할지(중복 관리 방지)?

## 별도 승인 필요 범위

- 배치 UI(visual editor 계열) 제품화: Slice 4 착수 전 승인.
- Scene 추상화 승격 / `World.player` 계약 변경처럼 엔진 코어 구조·snapshot 계약에 닿는 변경: [리팩토링 로드맵](refactor-roadmap.md) 기준 설계 합의 선행.

## 검증 기준

- Rust core 변경: `cargo fmt --manifest-path crates/ferrum-core/Cargo.toml -- --check`, `cargo clippy --manifest-path crates/ferrum-core/Cargo.toml -- -D warnings`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
- TypeScript 변경: `pnpm --filter @ferrum2d/ferrum-web lint`, `pnpm --filter @ferrum2d/ferrum-web test`
- Wasm/API 변경: `pnpm build`
- 데이터 씬 authoring: `pnpm validate:data-scene-authoring`
- 결정론 회귀: `pnpm smoke:gameplay-replay`
- 문서 변경: `pnpm validate:docs-links`, `pnpm build:pages`

## 다음 작업 추천

1. 소유 경계표와 `instance.id` 계약을 확정한다(Slice 0).
2. Slice 1(제네릭 spawn resolver, `EntityTemplate` 승격)을 리팩토링 로드맵 "데이터 기반 씬 조립" 후보의 첫 task로 분리한다.
3. Slice 2(`instance.id`↔`Entity` 매핑)를 이어서 진행한다.
4. 배치 오버레이(Slice 4)는 승인 후 `examples/*` dev 모드 프로토타입으로 시작한다.
5. `World` 장르 누수 정리(Slice 6)는 토대 안정화 후 별도 task로 진행한다.
