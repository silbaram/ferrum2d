# 오브젝트 배치 UI · 데이터 씬 authoring 보강 계획

이 문서는 "사람이 UI로 오브젝트 **위치**를 배치하고, AI agent가 그 위에 **기능(behavior)** 을 붙이는" 개발 흐름을 가능하게 하기 위해 Ferrum2D의 World/Scene 구성에서 무엇을 먼저 보강해야 하는지를 정리하는 planning 문서다. 구현 착수 전 개념과 순서를 합의하는 문서이며, 실제 public API와 운영 계약은 `docs/engine`·`docs/development` 확정 문서가 우선한다.

기본 언어는 한국어다. 이 문서는 배치 authoring 유스케이스의 개념과 진행 순서만 책임진다. 여기서 구조 리팩토링 task가 파생되면, 착수 시점에 별도 task 또는 이슈로 범위와 검증 기준을 확정한다.

관련 확정/계획 문서:

- 데이터 씬 authoring 최소 계약: [Data Scene Authoring Contract](../engine/data-scene-authoring.md)
- 런타임 확장성 확정 계약: [Runtime Extensibility](../engine/runtime-extensibility.md)
- 엔진 구조/책임 경계: [Architecture](../development/architecture/architecture.md)
- 데모 노출 구조: [데모 게임 포트폴리오 보강 계획](demo-game-showcase-plan.md)

## 결론

- 목표 흐름: **사람 → 위치(spatial placement)**, **agent → 기능(behavior)**. 둘은 하나의 `ferrum2d.consumer.scene-authoring` 문서를 공유한다.
- 이 분담은 새 아키텍처가 아니다. `sceneComposition`(위치) 와 `behaviorRecipes`(기능) 는 이미 파일 구조로 분리돼 있다(`docs/engine/samples/data-scene-minimum.scene-authoring.json` 참조).
- 기존에 가장 큰 끊어진 다리였던 **`SceneComposition` instance → 실행되는 `World` 엔티티** 경로는 Slice 1A/1B에서 해결했다. `props.components` v1 schema, Rust/Wasm raw spawn hook, package-facing `createDataSceneRuntimeTarget(...)`, `classifySceneInstance(...)`, 샘플 spawn smoke가 현재 기준이다.
- **`instance.id` ↔ `Entity` 지속 매핑**은 Slice 2에서 해결했다. `createSceneInstanceHandleRegistry(...)`가 scene apply/reload 뒤 id↔handle 양방향 조회, stale handle pruning, reorder 안정성을 제공한다.
- 따라서 남은 보강 순서는 다음과 같다.
  1. **배치 프리뷰와 editor-only 저장/merge**: UI가 위치 키만 갱신하고 agent-owned behavior를 보존한다.
  2. **agent 기능 부착 루프 검증**: 배치된 id에 behavior를 붙이는 replay/smoke를 고정한다.
  3. **`World` 장르 누수 정리**: `World.player` → marker/tag, `nearestPlayer`/`ShooterPrefabRegistry` 네이밍 (목표를 막지 않으므로 마지막).
- 배치 UI 자체는 위 1~3 위에 올라가는 **얇은 editor-only 계층**이며, 엔진 core에 런타임 scene-graph/GameObject/Node를 도입하지 않는다.
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
| 배치 role 파생 | `classifySceneInstance(...)` (`worldObject`/`actor`) | `packages/ferrum-web/src/gameplayAuthoring.ts` |
| 피킹용 쿼리 | Rust point/nearest/area query (이미 존재) | core query API |

### 남은 끊어진 곳 / 장르 누수

- **명시 id 운영 정책 필요.** Slice 2에서 `requireExplicitInstanceIds` 검증과 registry는 추가됐지만, 배치 UI 저장기가 새 instance id를 어떻게 자동 부여하고 rename을 어떻게 migration할지는 editor-only 단계에서 확정해야 한다.
- **Data Scene default target의 transform 지원은 제한적.** `x`/`y`/`scale`과 inline `props.components`는 spawn되지만, instance `rotationRadians`, instance `layer`, `components.template` catalog spawn은 아직 default target 범위 밖이다.
- **`World.player` 장르 누수.** 범용 `World`가 단일 플레이어 역할을 필드로 안다(`world.rs`). 같은 엔진이 `GameplayTags`/`GameplayFaction` 범용 분류를 이미 가지므로, "player"는 tag/marker가 일관적이다.
- **built-in scene 이중 구조.** Shooter/Breakout/Platformer는 하드코딩 Rust scene이고, 제네릭 Data Scene(`useDataScene()`)은 별도 generic ECS tick이다(`engine/scenes.rs`). 배치 UI + agent 흐름은 본질적으로 **Data Scene** 경로다.

### 구조 리팩토링과의 관계

이 문서의 엔진 enabler는 다음 구조 후보와 연결된다. 실제 착수 task는 아래 후보 중 무엇을 다루는지 명시하고, public/snapshot 영향이 있는 변경은 별도 설계 합의를 거친다.

- **데이터 기반 씬 조립 경로**: Slice 1~2가 이 후보의 첫 실현 단위에 해당한다.
- **Scene 추상화 승격**: Slice 6(장르 누수 정리)과 방향이 같다. 이 변경은 public/snapshot 영향이 크므로 별도 설계 합의가 필요하다.

→ 후보의 상태/롤백/영향 파일 추적은 실제 task 또는 이슈에 남기고, 이 문서는 placement 유스케이스의 개념·순서만 책임진다.

## 개념 모델

### 사람 ↔ agent 소유 경계

한 파일을 둘이 편집하므로 **필드 단위로 겹치지 않게** 나눈다. 아래대로면 충돌이 거의 0이다.

| `scene-authoring.json` 영역 | 소유자 | 내용 |
| --- | --- | --- |
| `sceneComposition.fragments[].instances[]` | **사람(UI)** | `id`, `prefab`, `variant`, `x`/`y`/`rotation`/`scale`/`layer` |
| `sceneComposition.prefabs[].props.components` | 공유 prefab catalog | Slice 1에서 확정할 typed sprite/collider/template descriptor |
| `sceneComposition.prefabs[].props.behaviorRecipes` (바인딩) | **AI agent** | 어떤 recipe를 붙일지 |
| `behaviorRecipes.entities` | **AI agent** | 실제 기능 정의 |

핵심 계약: UI는 파일을 저장할 때 **자기가 소유하지 않는 키(특히 `behaviorRecipes` 관련)를 보존**한다.

### `instance.id` = 사람↔agent 공용 어휘

배치 UI의 진짜 가치는 "말로 위치를 설명"하는 비용 제거다. 사람이 박스를 놓고 `turret_left` 라고 이름 붙이면, agent에게 좌표 대신 **이름**으로 지시한다("`turret_left`가 플레이어를 조준해 2초마다 발사"). 따라서 `instance.id`(와 prefab/variant 이름)는 두 작업자 사이의 안정 계약이며, UI는 의미 있는 id 부여/이름 변경을 지원해야 한다.

### 구체화 대상 개념과 위치

| 개념 | 위치 | 성격 |
| --- | --- | --- |
| ① `props.components` typed schema + resolver diagnostic | TS authoring | 신규(핵심 토대) |
| ② 제네릭 prefab catalog + spawn resolver (`props.components` → `World`) | Rust core(`EntityTemplate` 승격) + TS authoring | 신규 |
| ③ package public data-scene spawn facade/default target | TS facade + 낮은 빈도 Wasm API | 신규 |
| ③-1 `worldObject`/`actor` authoring role 파생 | TS authoring | 완료(`classifySceneInstance(...)`) |
| ④ `instance.id` ↔ `Entity` 지속 매핑/조회 | TS authoring/runtime | 완료(`createSceneInstanceHandleRegistry(...)`) |
| ⑤ 비충돌 save/merge (UI 소유 키만 갱신) | TS editor-only | 신규 |
| ⑥ selection/picking (screen point → instance) | TS editor-only (+ 기존 point query) | 신규(UI) |
| ⑦ de-genre `World` (`player`→tag, 네이밍) | Rust core | 정리 |

## 구현 Slice

현재 상태:

- **Slice 0 완료**: 사람/agent 소유 경계, `instance.id` 계약, visual editor 승인 게이트를 문서화했다.
- **Slice 1A 완료**: `props.components` v1 schema/resolver, public export, sample validator, docs contract를 추가했다.
- **Slice 1B 완료**: Rust/Wasm raw data-scene spawn hook, TS package default `spawnSceneInstance` target, public API/docs, `worldObject`/`actor` authoring classification helper, 샘플 spawn smoke test를 완료했다.
- **Slice 2 완료**: TS authoring registry로 `instance.id`↔`GameplayEntityHandle` 양방향 조회, explicit id 검증, stale handle pruning, reapply/reorder 안정성 테스트를 추가했다.

### Slice 0: 개념·소유 경계 확정 (이 문서)

산출물:

- 이 planning 문서와 planning README 링크
- 사람/agent 소유 경계표와 `instance.id` 계약 합의

검증:

- `pnpm validate:docs-links`
- `pnpm build:pages`

### Slice 1: 제네릭 data-scene spawn resolver (핵심 토대)

`props.components`(sprite/collider/size/기본 컴포넌트)를 읽어 `World` 엔티티를 만드는 제네릭 resolver를 Data Scene 경로에 추가한다. 단, 첫 산출물은 Rust spawn 코드가 아니라 **authoring schema와 public API 경계**다. `SceneCompositionProps` 자체는 계속 generic JSON props로 유지하되, package가 해석하는 reserved key인 `props.components`에만 typed contract를 둔다.

진행 단위:

- **Slice 1A**: authoring schema/resolver, diagnostic, public export, sample validation.
- **Slice 1B**: resolved descriptor를 `EntityTemplate`/`World` spawn으로 컴파일하는 runtime hook과 package facade.

Rust 사전 조사 결과:

- 기존 `EntityTemplate`는 sprite size, `SpriteFrame`, horizontal `SpriteAnimation`, collider enabled/trigger/offset/material, AABB/circle/capsule/oriented-box/edge/convex-polygon shape를 이미 담는다(`crates/ferrum-core/src/world/templates.rs`).
- `World`에는 `spawn_prefab_entity_from_request(...)`와 `apply_prefab_entity_spawn_request(...)`가 이미 있고, sprite/transform/velocity/layer/collider/gameplay 기본 컴포넌트를 한 번에 설치한다(`crates/ferrum-core/src/world/spawning.rs`). 단, 이 경로는 현재 `pub(crate)`라 Wasm/public TS API에서 직접 사용할 수 없다.
- Data Scene mode는 `use_data_scene()`에서 빈 `World`로 reset되고, update는 generic `World` cooldown/update/tilemap dynamic collision만 실행한다(`crates/ferrum-core/src/engine/scenes.rs`). 별도 scene loop를 만들 필요는 없다.
- public Wasm에는 physics body spawn API와 gameplay component setter는 있지만, sprite+collider+layer를 설치하고 `GameplayEntityHandle`을 반환하는 generic data-scene spawn API는 아직 없다(`packages/ferrum-web/src/wasm.d.ts`).
- TS 선례는 physics authoring이다. 넓은 numeric Wasm spawn method가 `bool`을 반환하고, 성공 후 snapshot getter로 `{ entityId, entityGeneration }`을 읽는다(`packages/ferrum-web/src/physicsBodySpawning.ts`, `packages/ferrum-web/src/physicsHandles.ts`). Slice 1B도 같은 low-frequency scene load/apply 패턴을 따르는 것이 현재 구조와 가장 잘 맞는다.
- Rust/Wasm hook은 `Engine::spawn_data_scene_entity(...)`로 추가했다. 이 hook은 Data Scene mode에서만 `EntityTemplate`/`PrefabEntitySpawnRequest`를 통해 sprite, optional horizontal animation, collider shape, layer를 설치하고, 성공 후 `data_scene_entity_id()`/`data_scene_entity_generation()`으로 최신 handle을 읽는다. `collider: none`은 `World::clear_collider(...)`로 실제 no-collider entity를 만든다.
- TS package facade는 `createDataSceneRuntimeTarget(engine, options?)`로 추가했다. 이 helper는 resolved inline `props.components`를 raw Wasm spawn 인자로 컴파일해 `applySceneBehaviorRecipes(...)`에 넘길 수 있는 `spawnSceneInstance(instance)` target을 제공한다.
- TS authoring helper는 `classifySceneInstance(instance)`로 추가했다. 이 helper는 runtime 저장 필드나 `Actor`/`GameObject` class를 만들지 않고, `props.behaviorRecipes` 존재 여부만 보고 `worldObject`/`actor` role을 파생한다.
- default target은 첫 번째 유효한 spawn 직전에만 `engine.useDataScene()`을 lazy activation한다. authoring validation 실패나 target 생성만으로 기존 scene을 비우지 않는다.
- default target은 runtime이 아직 완전하게 반영하지 못하는 `components.template`, instance `rotationRadians`, instance `layer`를 diagnostic error로 거절한다. collider descriptor 자체의 `rotationRadians`는 지원한다.

최소 계약:

- `components.sprite`: texture authoring id 또는 resolved numeric texture id, sprite size, optional atlas frame/animation descriptor를 명시한다.
- `components.collider`: `none` 또는 shape descriptor(AABB 우선, circle/capsule/oriented-box/convex-polygon은 기존 `EntityTemplateColliderShape` 지원 범위에 맞춰 확장)를 명시한다.
- `components.layer`: Rust `CollisionLayer`로 컴파일 가능한 authoring name/code를 명시한다.
- `components.template`: inline descriptor와 catalog reference 중 하나만 허용한다. 둘을 동시에 쓰면 diagnostic error다.
- authoring id(`"agent"`, `"body"` 같은 이름)와 runtime numeric 값(texture id, layer code, tag/faction id)은 resolver 단계에서 분리한다.

public API 경계:

- `@ferrum2d/ferrum-web/authoring`에 `createDataSceneRuntimeTarget(...)`를 제공해 `SceneBehaviorRuntimeTarget`을 만든다.
- consumer는 `@ferrum2d/ferrum-web/src/*`, generated `pkg/*`, `dist/*`, Rust `World` 내부를 import하지 않는다.
- raw Wasm spawn hook이 필요하면 낮은 빈도 scene load/apply 경로 전용으로 두고, package-facing facade에서 typed descriptor를 숫자형 인자로 컴파일한다.
- `spawnSceneInstance(instance)`는 성공 시 `GameplayEntityHandle`을 반환하고, 실패 시 JSON path가 포함된 diagnostic을 던진다.

spawn 정의는 `EntityTemplate`을 authorable catalog(prefab id → template)로 승격해 재사용한다. 렌더러 변경은 불필요하다 — `World`에 `Sprite`/`Transform`을 설치하면 기존 render command 경로로 그려진다.

산출물:

- prefab id → spawn 정의(catalog) 계약과 `props.components` 매핑 규칙
- `props.components` resolver와 validation diagnostic
- `useDataScene()`에서 resolved instance를 `World` 엔티티로 설치하는 제네릭 spawn 경로
- 패키지 제공 default `spawnSceneInstance` target(템플릿별 하드코딩 대체)
- 저장 필드 없이 `worldObject`/`actor` role을 파생하는 authoring helper
- public API surface manifest/docs 반영(`authoring` subpath 기준)
- 샘플 scene을 `createEngine(...)` + `createDataSceneRuntimeTarget(...)` + `applySceneBehaviorRecipes(...)`로 spawn하는 ferrum-web test

검증:

- `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
- `wasm-pack build crates/ferrum-core --target web --out-dir ../../packages/ferrum-web/pkg`
- `pnpm build`
- `pnpm validate:public-api-surface`
- `pnpm validate:data-scene-authoring`
- 샘플 scene을 spawn해 `entityCount`, spawn handle, behavior apply result를 단언하는 smoke
- passive `worldObject`는 spawn만 되고 behavior command가 없으며, `actor`만 behavior command를 받는 smoke

### Slice 2: `instance.id` ↔ `Entity` 지속 매핑

Slice 1 spawn이 반환하는 `GameplayEntityHandle`을 `instance.id`별로 모아 양방향 조회(이름→엔티티, 엔티티→이름)를 제공한다. UI가 작성한 placed instance는 **명시적 `id`를 필수**로 한다. resolver의 deterministic fallback id(`fragment.index`)는 fixture/read-only 문서 호환용으로만 보고, UI 저장기는 fallback id에 의존하지 않는다.

구현 상태:

- `createSceneInstanceHandleRegistry(...)`를 `@ferrum2d/ferrum-web/authoring` public facade에 추가했다.
- `applySceneBehaviorRecipes(..., { instanceHandleRegistry })`가 spawn 결과를 registry에 동기화한다.
- `requireExplicitInstanceIds: true`가 UI/agent 타겟팅 경로에서 fallback id 의존을 거절한다.
- registry는 optional `entityExists` callback으로 stale handle을 낮은 빈도 조회/sync 경로에서만 제거한다.

지속성 규칙:

- 같은 `instance.id`를 재적용하면 기존 handle이 live인지 `gameplayEntityExists(...)`로 확인한다.
- live handle이 stale이면 registry에서 제거하고 새 entity handle로 교체한다.
- despawn/scene reset/reload 후 registry는 재동기화한다.
- rename은 단순 string replace가 아니라 mapping migration이다. UI는 `sceneComposition.fragments[].instances[].id`를 바꾸면서 agent-owned behavior profile 본문은 보존하고, 필요한 binding reference만 명시적으로 갱신한다.
- 배열 reorder는 `instance.id`가 유지되는 한 agent behavior target을 바꾸지 않아야 한다.

산출물:

- 매핑 레지스트리와 조회 API(편집/재적용 시 재동기 포함)
- agent behavior 바인딩이 이 id로 대상 엔티티를 찾는 경로
- explicit id validation 또는 UI 저장기 id 부여 정책
- rename/reapply/despawn stale handle 처리 정책

검증:

- `pnpm --filter @ferrum2d/ferrum-web test`
- id→entity 왕복과 stale 처리 단언
- instances 배열 reorder 후 behavior target이 유지되는지 단언

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
- 새 instance 생성 시 explicit id 자동 부여와 중복 id 방지
- reorder/rename/save가 agent-owned `behaviorRecipes` 본문과 prefab catalog를 보존하는 merge 정책

검증:

- 저장 후 `pnpm validate:data-scene-authoring`
- 저장이 `behaviorRecipes` 영역을 보존하는지 단언하는 smoke
- 저장이 explicit id를 보존하고 중복 id를 만들지 않는지 단언하는 smoke

### Slice 5: agent 기능 부착 루프 검증

배치된 오브젝트에 agent가 recipe를 붙이는 end-to-end 루프를 회귀로 고정한다.

산출물:

- 배치(위치) + agent 부착(behavior) 결과를 고정하는 gameplay replay fixture
- consumer/agent 템플릿에 "배치→기능 부착" 워크플로우 반영 여부 결정

검증:

- `pnpm smoke:gameplay-replay`
- 신규: 배치+behavior fixture의 결정론 검증

### Slice 6: `World` 장르 누수 정리 (non-blocking)

`World.player` → marker/tag 컴포넌트, `nearestPlayer`/`ShooterPrefabRegistry` 네이밍을 제네릭으로. 목표를 막지 않으므로 마지막. Slice 1에서 제네릭 prefab으로 player를 만들면 자연히 드러나니 함께 풀 기회가 있다. snapshot 버전/테스트 영향은 별도 구조 리팩토링 task에서 조정한다.

검증:

- `cargo test`, snapshot/replay 회귀, `pnpm smoke:gameplay-replay`

## 제외 범위

- full visual editor(노드 트리 편집, 풀 prefab 에디팅, 멀티유저 동시 편집)
- 엔진 core의 런타임 scene-graph / `GameObject` / `Actor` / `Node` 도입
- behavior 자체의 UI 편집(기능은 agent 소유) 및 behavior undo
- 중첩 fragment 절대→상대 transform 역변환(v1 단일 fragment 평면 편집으로 제한)
- frame hot path의 entity별 JS/Wasm callback

## 열린 질문

- `props.components` v1 schema: inline descriptor 중심으로 갈지, catalog reference 중심으로 갈지, 둘을 어떤 migration 규칙으로 병행할지?
- texture authoring id 해석: `AssetHost.textureId(name)` 기반으로 둘지, scene-authoring 문서 안에 별도 asset registry를 둘지?
- generated fallback id(`fragment.index`)는 read-only/import 호환용으로 남기고, UI/agent 타겟팅 apply 경로는 `requireExplicitInstanceIds: true`를 사용한다.
- 편집 단위: 단일 fragment 평면 편집(권장, v1) vs fragment 계층 보존 편집?
- 프리뷰: `useDataScene()` 라이브 spawn(권장) vs 경량 editor 전용 렌더?
- prefab 정의 소스: `EntityTemplate` 승격(권장) vs 신규 generic catalog 신설?
- `World.player`→tag를 Slice 1과 묶을지, Slice 6으로 분리할지?
- 배치 오버레이를 `examples/*` dev 모드에 둘지, 별도 패키지로 둘지?
- 이 문서의 Slice 1~2를 별도 구조 리팩토링 task로 분리할지, 이 문서의 Slice를 그대로 task source로 둘지?

## 별도 승인 필요 범위

- 배치 UI(visual editor 계열) 제품화: Slice 4 착수 전 승인.
- Scene 추상화 승격 / `World.player` 계약 변경처럼 엔진 코어 구조·snapshot 계약에 닿는 변경: 별도 task 또는 이슈로 설계 합의 선행.
- public API/export surface 추가: `docs/engine/public-api.md`, `docs/engine/public-api-surface.json`, 관련 reference 문서 갱신을 같은 변경에 포함한다.

## 검증 기준

- Rust core 변경: `cargo fmt --manifest-path crates/ferrum-core/Cargo.toml -- --check`, `cargo clippy --manifest-path crates/ferrum-core/Cargo.toml -- -D warnings`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
- TypeScript 변경: `pnpm --filter @ferrum2d/ferrum-web lint`, `pnpm --filter @ferrum2d/ferrum-web test`
- Wasm/API 변경: `wasm-pack build crates/ferrum-core --target web --out-dir ../../packages/ferrum-web/pkg`, `pnpm build`, `pnpm validate:public-api-surface`
- 데이터 씬 authoring: `pnpm validate:data-scene-authoring`
- 결정론 회귀: `pnpm smoke:gameplay-replay`
- 문서 변경: `pnpm validate:docs-links`, `pnpm build:pages`

## 다음 작업 추천

1. Slice 3(배치 프리뷰)을 진행해 screen↔world 좌표 변환과 선택/호버 표시를 검증한다.
2. 배치 오버레이(Slice 4)는 승인 후 `examples/*` dev 모드 프로토타입으로 시작한다.
3. agent 기능 부착 replay(Slice 5)를 추가해 placed id 기반 behavior 적용을 end-to-end로 고정한다.
4. `World` 장르 누수 정리(Slice 6)는 토대 안정화 후 별도 task로 진행한다.
