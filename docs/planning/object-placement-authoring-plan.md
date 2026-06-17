# 오브젝트 배치 UI · 데이터 씬 authoring 보강 계획

이 문서는 "사람이 UI로 오브젝트 **위치**를 배치하고, AI agent가 그 위에 **기능(behavior)** 을 붙이는" 개발 흐름을 가능하게 하기 위해 Ferrum2D의 World/Scene 구성에서 무엇을 먼저 보강해야 하는지를 정리하는 planning 문서다. 구현 착수 전 개념과 순서를 합의하는 문서이며, 실제 public API와 운영 계약은 `docs/engine`·`docs/development` 확정 문서가 우선한다.

기본 언어는 한국어다. 이 문서는 배치 authoring 유스케이스의 개념과 진행 순서만 책임진다. 여기서 구조 리팩토링 task가 파생되면, 착수 시점에 별도 task 또는 이슈로 범위와 검증 기준을 확정한다.

관련 확정/계획 문서:

- 데이터 씬 authoring 최소 계약: [Data Scene Authoring Contract](../engine/data-scene-authoring.md)
- 런타임 확장성 확정 계약: [Runtime Extensibility](../engine/runtime-extensibility.md)
- 엔진 구조/책임 경계: [Architecture](../development/architecture/architecture.md)
- 데모 노출 구조: [데모 게임 포트폴리오 보강 계획](demo-game-showcase-plan.md)

기술 스택 검토 참고(2026-06-16 기준):

- Vite 공식 가이드: dev server/HMR, production static build, `vite preview`
- MDN File System API: secure context, user-granted file/directory handle, OPFS
- Chrome File System Access API: Chromium 계열 로컬 파일 열기/저장 지원과 feature detection
- Electron Security: Node integration/context isolation/sandbox/custom protocol 보안 체크리스트
- Tauri v2 Architecture/Security: WRY WebView, Rust core와 WebView IPC/capability 경계

## 결론

- 목표 흐름: **사람 → 위치(spatial placement)**, **agent → 기능(behavior)**. 둘은 하나의 `ferrum2d.consumer.scene-authoring` 문서를 공유한다.
- 이 분담은 새 아키텍처가 아니다. `sceneComposition`(위치) 와 `behaviorRecipes`(기능) 는 이미 파일 구조로 분리돼 있다(`docs/engine/samples/data-scene-minimum.scene-authoring.json` 참조).
- 기존에 가장 큰 끊어진 다리였던 **`SceneComposition` instance → 실행되는 `World` 엔티티** 경로는 Slice 1A/1B에서 해결했다. `props.components` v1 schema, Rust/Wasm raw spawn hook, package-facing `createDataSceneRuntimeTarget(...)`, `classifySceneInstance(...)`, 샘플 spawn smoke, visible sprite rotation/render layer 연결이 현재 기준이다.
- **`instance.id` ↔ `Entity` 지속 매핑**은 Slice 2에서 해결했다. `createSceneInstanceHandleRegistry(...)`가 scene apply/reload 뒤 id↔handle 양방향 조회, stale handle pruning, reorder 안정성을 제공한다.
- 따라서 남은 보강 순서는 다음과 같다.
  1. **정식 Scene Placement Authoring Viewer**: UI가 위치 키를 선택/수정하고 agent-owned behavior를 보존한다.
  2. **agent 기능 부착 루프 검증**: 배치된 id에 behavior를 붙이는 replay/smoke를 고정한다.
  3. **`World` 장르 누수 정리**: `World.player` → marker/tag, `primaryActor`/`nearestPrimaryActor` generic target, `GameplayPrefabRegistry` 네이밍, `player_entity()` accessor 제거 완료. `player`/`nearestPlayer`는 authoring 호환 alias로 유지한다.
- Scene Placement Authoring Viewer는 Ferrum2D의 정식 authoring/tooling surface로 도입한다. 단, 엔진 core에 런타임 scene-graph/GameObject/Node를 도입하지 않고, 시뮬레이션 source of truth는 계속 Rust `World`가 가진다.
- **승인된 범위**: agent-first 배치/선택/좌표 수정/patch 저장/behavior id 전달 흐름은 정식 제품 기능으로 진행한다. 노드 트리 편집, 풀 prefab 에디터, 멀티유저 동시 편집 같은 full visual editor 제품화는 이 문서의 범위 밖이며 별도 설계 승인이 필요하다.

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
- **primary actor 호환 경로.** 범용 `World`의 내부 단일 플레이어 저장소는 `primary_actor`로 중립화했고, engine-owned reserved `GameplayTags` marker와 동기화한다. movement authoring은 `primaryActor`/`nearestPrimaryActor` generic target을 canonical 표면으로 쓰며 `chase`/`seekTarget` 생략 target도 `primaryActor`로 정규화한다. `player`/`nearestPlayer`는 legacy alias로 유지한다. prefab registry/registration 계층은 `GameplayPrefabRegistry`로 중립화했고, `World`의 `player_entity()` 호환 accessor는 제거했다.
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

### Scene Placement Authoring Viewer

질문에서 말한 화면은 단순 preview보다 구체적인 **Scene Placement Authoring Viewer**로 정의한다. 목적은 사람이 화면을 보며 객체를 선택하거나 위치를 조정하고, agent는 같은 `instance.id`와 machine-readable inspector state를 기준으로 scene-authoring 문서를 수정하는 것이다.

이 화면은 Ferrum2D의 정식 엔진 기능이지만 full visual editor는 아니다. v1은 agent-first authoring viewer이며, 다음 흐름을 제품 계약으로 만든다.

| 흐름 | 사용자 행동 | agent/엔진 동작 | 저장 범위 |
| --- | --- | --- | --- |
| 위치 확인 | scene-authoring 문서를 viewer로 연다 | `useDataScene()` + `createDataSceneRuntimeTarget(...)`로 placed instance를 spawn한다 | 없음 |
| 객체 식별 | 캔버스에서 hover/click하거나 id를 말한다 | screen→world 변환과 picking 결과를 `instance.id`, prefab, role, entity handle로 노출한다 | 없음 |
| 위치 조정 | 선택 객체를 드래그하거나 좌표/snap 값을 입력한다 | draft patch를 만들고 live preview에 반영한다 | `sceneComposition.fragments[].instances[]`의 위치 키 |
| 이름 변경 | selected id를 rename한다 | id 중복을 검증하고 binding reference migration 후보를 만든다 | instance `id`, 필요한 binding reference |
| agent 기능 부착 | 사용자가 "`turret_left`에 기능을 붙여"라고 지시한다 | agent가 `behaviorRecipes`와 prefab binding을 수정한다 | agent-owned behavior 영역 |
| 저장 | 사용자가 저장 또는 patch export를 실행한다 | 비충돌 merge로 UI-owned key만 갱신하고 behavior 본문을 보존한다 | scene-authoring JSON |

정식 public surface는 `@ferrum2d/ferrum-web/authoring`에서 제공한다. viewer를 쓰는 게임 프로젝트는 package 내부 `src/*`, `dist/*`, generated `pkg/*`를 import하지 않는다.

초기 public API 후보:

```ts
import {
  createScenePlacementViewer,
  createScenePlacementPatchStore,
  type ScenePlacementViewer,
  type ScenePlacementViewerState,
  type ScenePlacementPatch,
} from "@ferrum2d/ferrum-web/authoring";
```

`createScenePlacementViewer(...)`는 canvas/runtime/overlay parent와 scene-authoring document를 받아 viewer controller를 만든다. `createScenePlacementPatchStore(...)`는 viewer가 만든 patch를 JSON export, File System Access API, 또는 host-provided save adapter로 연결한다. 저장 adapter는 public interface로 받되, Node/Electron/Tauri 권한은 engine package 안에 직접 묶지 않는다.

v1 inspector state는 browser smoke와 agent가 읽기 쉬운 JSON으로 노출한다. 예시는 다음 shape를 기준으로 한다.

```ts
type ScenePlacementViewerState = {
  selectedInstanceId?: string;
  hoveredInstanceId?: string;
  pointerWorld?: { x: number; y: number };
  selected?: {
    instanceId: string;
    prefab: string;
    variant?: string;
    role: "worldObject" | "actor";
    entity?: { entityId: number; entityGeneration: number };
    transform: { x: number; y: number; scale?: number; rotationRadians?: number };
  };
  draftPatch?: ScenePlacementPatch;
};
```

browser smoke와 agent 연동을 위해 viewer instance는 `state()`와 `exportPatch()`를 제공한다. `window.__ferrumPlacementViewer` 같은 전역 노출은 예제/테스트 host가 선택적으로 붙이는 smoke hook일 뿐이며, 정식 계약은 viewer object와 authoring package 타입이다.

### View 기술 스택 판단

정식 viewer도 **일반 웹(Vite + TypeScript + 기존 Ferrum canvas/runtime + DOM overlay)** 로 만든다. 여기서 "일반 웹"은 임시 예제가 아니라 Ferrum2D가 공식 지원하는 browser authoring surface라는 뜻이다. Electron/Tauri는 viewer 구현 기술이 아니라, 같은 viewer를 desktop app처럼 포장해야 할 때의 wrapper 후보로 둔다.

판단 근거:

- Ferrum2D 예제와 create-game 템플릿은 이미 Vite `dev`/`build --base=./`/`preview` 흐름을 사용한다.
- viewer는 기존 WebGL2 canvas, input, asset, Wasm 로딩, browser smoke를 그대로 재사용해야 한다.
- Pages/showcase와 Playwright smoke에서 같은 화면을 검증하려면 브라우저 route가 가장 단순하다.
- Electron은 파일 시스템 접근이 쉽지만 Chromium+Node 권한을 함께 포장하므로 보안 surface와 packaging QA가 늘어난다. 로컬/신뢰 콘텐츠만 로드하고 `nodeIntegration: false`, `contextIsolation: true`, sandbox, CSP, custom protocol 같은 보안 기준을 지켜야 한다.
- Tauri v2는 Rust core와 WebView IPC/capability 모델이 Ferrum2D 철학과 잘 맞지만, OS별 WebView 차이와 desktop packaging smoke가 새 작업 범위로 생긴다.
- 브라우저 File System Access API는 로컬 파일 저장 UX를 줄 수 있지만 secure context, user gesture, browser support 제약이 있다. 따라서 v1 저장은 "patch export 또는 host-provided save adapter"를 기본으로 보고, File System Access API는 선택 enhancement로 둔다.

v1 권장 스택:

| 계층 | 선택 | 이유 |
| --- | --- | --- |
| 실행 환경 | `packages/ferrum-web` authoring viewer API + Vite 기반 viewer host | 정식 package surface와 browser smoke 재사용 |
| 렌더 | 기존 Ferrum runtime WebGL2 canvas | 실제 Data Scene spawn 결과와 동일 경로 검증 |
| UI overlay | vanilla TypeScript + CSS DOM overlay | 새 framework 의존성 없이 선택/패널/입력 구현 가능 |
| 입력 | Pointer Events + canvas 좌표 변환 | mouse/touch/pen 통합, grid/snap 적용 쉬움 |
| picking | TS authoring instance bounds cache 우선, 필요 시 low-frequency Rust point query | frame hot path의 entity별 JS/Wasm 왕복 차단 |
| 저장 | patch export + host-provided save adapter + 선택적 File System Access API | browser 보안 제약과 agent-first workflow를 동시에 만족 |
| desktop wrapper | Tauri/Electron spike는 별도 배포 planning | Slice 3~4 목표와 분리 |

저장 adapter는 다음 순서로 확장한다.

1. **Patch export**: UI가 `PlacementScenePatch` JSON을 만들고 agent가 workspace 파일에 적용한다.
2. **Host-provided save adapter**: create-game template 또는 엔진 repo viewer host가 allowlist 파일만 저장한다. 기본 비활성이고 `FERRUM_PLACEMENT_WRITE=1` 같은 명시 opt-in이 필요하다.
3. **File System Access API**: 지원 브라우저에서 사용자가 직접 선택한 파일/디렉터리에 저장한다. 미지원 브라우저는 patch export로 fallback한다.
4. **Desktop wrapper**: 로컬 앱 배포 요구가 확정되면 Tauri 우선 spike, Electron은 빠른 prototype 후보로 비교한다.

### 구체화 대상 개념과 위치

| 개념 | 위치 | 성격 |
| --- | --- | --- |
| ① `props.components` typed schema + resolver diagnostic | TS authoring | 신규(핵심 토대) |
| ② 제네릭 prefab catalog + spawn resolver (`props.components` → `World`) | Rust core(`EntityTemplate` 승격) + TS authoring | 신규 |
| ③ package public data-scene spawn facade/default target | TS facade + 낮은 빈도 Wasm API | 신규 |
| ③-1 `worldObject`/`actor` authoring role 파생 | TS authoring | 완료(`classifySceneInstance(...)`) |
| ④ `instance.id` ↔ `Entity` 지속 매핑/조회 | TS authoring/runtime | 완료(`createSceneInstanceHandleRegistry(...)`) |
| ④-1 Scene Placement Authoring Viewer | `@ferrum2d/ferrum-web/authoring` + viewer host | 신규(정식 제품 surface) |
| ⑤ 비충돌 save/merge (UI 소유 키만 갱신) | TS editor-only | 신규 |
| ⑥ selection/picking (screen point → instance) | TS editor-only (+ 기존 point query) | 신규(UI) |
| ⑦ de-genre `World` (`player`→tag, 네이밍) | Rust core | 정리 |

## 구현 Slice

현재 상태:

- **Slice 0 완료**: 사람/agent 소유 경계, `instance.id` 계약, visual editor 승인 게이트를 문서화했다.
- **Slice 1A 완료**: `props.components` v1 schema/resolver, public export, sample validator, docs contract를 추가했다.
- **Slice 1B 완료**: Rust/Wasm raw data-scene spawn hook, TS package default `spawnSceneInstance` target, public API/docs, `worldObject`/`actor` authoring classification helper, 샘플 spawn smoke test를 완료했다.
- **Slice 2 완료**: TS authoring registry로 `instance.id`↔`GameplayEntityHandle` 양방향 조회, explicit id 검증, stale handle pruning, reapply/reorder 안정성 테스트를 추가했다.
- **Slice 3A 완료**: `createScenePlacementViewport(...)`, screen↔world, CSS↔backbuffer, snap helper를 `@ferrum2d/ferrum-web/authoring` public surface에 추가했다.
- **Slice 3B 완료**: `createScenePlacementViewer(...)` read-only controller, viewer state/options/patch 타입, selected id↔entity handle state 테스트를 추가했다.
- **Slice 3C 완료**: 정식 `examples/placement-viewer` host와 root `pnpm dev:placement-viewer` 실행 경로를 추가하고, Data Scene preview + selected id/entity handle inspector hook을 연결했다.
- **Slice 3D 완료**: screen-coordinate hover/click picking API와 공식 `pnpm smoke:placement-viewer` browser smoke를 추가해 inspector state, canvas nonblank, Data Scene preview metric을 고정했다.
- **Slice 4A 완료**: viewer 내부 draft transform overlay, `updateInstanceTransform(...)`, `clearDraftPatch()`, `exportPatch()`, export-only `createScenePlacementPatchStore(...)`와 browser smoke draft patch 검증을 추가했다.
- **Slice 4B 완료**: 공식 placement viewer에 numeric transform input, snap toggle/grid, arrow-key nudge, pointer drag, draft revert UI를 연결하고 browser smoke가 실제 DOM 입력/키보드/드래그로 snapped `ScenePlacementPatch` export를 검증한다.
- **Slice 4C 완료**: transform-only `mergeScenePlacementPatch(...)`, host-owned `saveScenePlacementPatch(...)` adapter, adapter allowlist/env opt-in gate, public API/docs, save-disabled browser smoke gate를 추가했다.
- **Slice 4D 완료**: viewer draft rename/add/remove operation, `mergeScenePlacementPatch(...)` rename/add/remove 적용, `previewScenePlacementBindingMigration(...)` agent-owned behavior reference preview, 관련 public API/docs/unit regression을 추가했다.
- **Slice 5 완료**: selected placed id 기반 behavior attachment unit regression, `gameplayAuthoringDryRun.agentAttachment` report summary, variant `expected.agentAttachment` drift check를 추가해 배치 id→agent-owned behavior→runtime command target 루프를 고정했다.
- **Slice 5A 완료**: create-game shared harness의 consumer `ferrum:authoring-report`에 `placementAuthoring.instances[]` summary를 추가하고, consumer agent shared gameplay skill/harness에 "배치→기능 부착" 워크플로우를 반영했다.
- **Slice 5B 완료**: create-game shared template에 `placement-viewer.html`, `src/ferrum-placement-viewer.ts`, `npm run ferrum:placement-viewer`를 추가해 generated consumer project에서도 placement patch/export와 agent handoff JSON을 공식 실행 경로로 제공한다.

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
- Slice 1B 이전 public Wasm에는 physics body spawn API와 gameplay component setter만 있었고, sprite+collider+layer를 설치하고 `GameplayEntityHandle`을 반환하는 generic data-scene spawn API는 없었다(`packages/ferrum-web/src/wasm.d.ts`).
- TS 선례는 physics authoring이다. 넓은 numeric Wasm spawn method가 `bool`을 반환하고, 성공 후 snapshot getter로 `{ entityId, entityGeneration }`을 읽는다(`packages/ferrum-web/src/physicsBodySpawning.ts`, `packages/ferrum-web/src/physicsHandles.ts`). Slice 1B도 같은 low-frequency scene load/apply 패턴을 따르는 것이 현재 구조와 가장 잘 맞는다.
- Rust/Wasm hook은 `Engine::spawn_data_scene_entity(...)`로 추가했다. 이 hook은 Data Scene mode에서만 `EntityTemplate`/`PrefabEntitySpawnRequest`를 통해 sprite, optional horizontal animation, collider shape, layer를 설치하고, 성공 후 `data_scene_entity_id()`/`data_scene_entity_generation()`으로 최신 handle을 읽는다. `collider: none`은 `World::clear_collider(...)`로 실제 no-collider entity를 만든다.
- TS package facade는 `createDataSceneRuntimeTarget(engine, options?)`로 추가했다. 이 helper는 resolved inline `props.components`를 raw Wasm spawn 인자로 컴파일해 `applySceneBehaviorRecipes(...)`에 넘길 수 있는 `spawnSceneInstance(instance)` target을 제공한다.
- TS authoring helper는 `classifySceneInstance(instance)`로 추가했다. 이 helper는 runtime 저장 필드나 `Actor`/`GameObject` class를 만들지 않고, `props.behaviorRecipes` 존재 여부만 보고 `worldObject`/`actor` role을 파생한다.
- default target은 첫 번째 유효한 spawn 직전에만 `engine.useDataScene()`을 lazy activation한다. authoring validation 실패나 target 생성만으로 기존 scene을 비우지 않는다.
- default target은 `components.template`을 `componentTemplates` 옵션으로 inline descriptor에 해소할 수 있고, instance `rotationRadians`를 visible sprite rotation과 collider geometry/offset에 반영한다. instance `layer`는 Data Scene entity render band의 sort layer로 연결된다.

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

### Slice 3: Scene Placement Authoring Viewer v1

placed instance를 화면 좌표에 렌더해 위치를 눈으로 확인하고 선택 상태를 정식 viewer state로 노출한다. v1은 `useDataScene()` 라이브 preview를 기본으로 하며, headless math 테스트만 별도 helper로 분리한다. 이 단계는 저장 기능 없이 **정식 read-only authoring viewer**를 만든다.

산출물:

- `@ferrum2d/ferrum-web/authoring` public export: `createScenePlacementViewer(...)`, viewer state/option 타입(완료)
- `ScenePlacementViewport` helper: canvas CSS pixel, backbuffer pixel, DPR, camera center, zoom, world bounds 변환(완료)
- `screenToSceneWorld(...)`, `worldToSceneScreen(...)`, `snapSceneWorldPoint(...)` 단위 테스트(완료)
- `examples/placement-viewer`에서 data scene preview 실행(완료)
- repo root 실행 명령: `pnpm dev:placement-viewer`(완료)
- generated consumer project 실행 명령: `npm run ferrum:placement-viewer`(완료)
- `createSceneInstanceHandleRegistry(...)`를 연결해 selected id ↔ entity handle 확인(완료)
- hover/click picking: TS authoring instance bounds cache 우선, 필요 시 click 시점의 low-frequency Rust point query만 사용(완료, v1은 TS bounds cache)
- 선택/호버 표시: DOM overlay 또는 debug-line buffer로 bounding box, id label, role badge 표시(완료, v1은 selected box + selected/hovered inspector)
- viewer object `state()`/`selectInstance(id)`/`exportPatch()` 제공(완료)
- optional smoke hook `window.__ferrumPlacementViewer.state()` 노출(완료)
- 수동 체크리스트: canvas nonblank, grid 정렬, hover id, click selected id, camera pan/zoom, DPR resize

검증:

- 예제 앱 수동 확인 체크리스트
- 신규: headless 좌표 변환 단위 테스트
- 신규: browser smoke에서 `selectedInstanceId`, `hoveredInstanceId`, `pointerWorld`, canvas nonblank 단언(완료, `pnpm smoke:placement-viewer`)
- `pnpm --filter @ferrum2d/ferrum-web test`
- `pnpm validate:public-api-surface`
- `pnpm validate:data-scene-authoring`

성능 요구사항:

- pointer move마다 Wasm entity query를 호출하지 않는다.
- 매 프레임 DOM label을 모든 instance 수만큼 갱신하지 않는다. 기본 label은 hover/selected 중심으로 제한하고, 전체 id 표시 모드는 viewer option으로 둔다.
- instance bounds cache는 scene apply/reload 또는 draft patch 변경 시에만 재계산한다.
- 1,000개 placed instance preview에서도 frame loop에 O(N) DOM mutation이 들어가지 않아야 한다.

### Slice 4: Scene Placement Authoring Viewer write path

정식 viewer 위에 위치 수정/write path를 추가한다. 캔버스 위 선택/드래그/좌표 입력 → draft patch 생성 → preview 반영 → patch export 또는 host-provided save adapter로 `scene-authoring.json`을 갱신한다.

산출물:

- `createScenePlacementPatchStore(...)` public export(완료, export-only)
- `ScenePlacementSaveAdapter` interface(완료, host-owned adapter)
- 오버레이 UI: 선택 패널, id/prefab/variant/role 표시, x/y/scale/rotation 입력, snap toggle(완료), duplicate id diagnostic(완료, public viewer draft API)
- 이동 UX: drag, arrow-key nudge, numeric input, snap-to-grid, cancel/revert draft(완료)
- 이름 변경 UX: explicit id rename, 중복 id 차단, binding reference migration preview(완료, API/merge 단위)
- patch model: `ScenePlacementPatch`로 add/update/rename/remove 후보를 표현(완료, viewer draft export)
- merge model: 소유 키만 갱신하는 저장기(완료, update/rename/add/remove merge)
- 단일 fragment 평면 편집(중첩 fragment 역변환은 v1 제외)
- 새 instance 생성 시 explicit id 자동 부여와 중복 id 방지(부분 완료, explicit id add API와 중복 차단; 자동 naming UI는 후속)
- reorder/rename/save가 agent-owned `behaviorRecipes` 본문과 prefab catalog를 보존하는 merge 정책(완료, unit regression)
- 저장 adapter:
  - 기본: patch export를 agent가 적용(완료)
  - opt-in: host-provided save adapter(완료, allowlist/env opt-in)
  - File System Access API는 별도 enhancement 후보
  - desktop wrapper 저장은 제외하고 별도 spike로 분리

검증:

- 저장 후 `pnpm validate:data-scene-authoring`
- 저장이 `behaviorRecipes` 영역을 보존하는지 단언하는 smoke(완료, transform merge unit)
- 저장이 explicit id를 보존하고 중복 id를 만들지 않는지 단언하는 smoke(완료, merge unit)
- rename이 필요한 binding reference 후보를 누락하지 않는지 단언하는 unit test(완료)
- save adapter를 만들 경우 allowlist/env opt-in이 없으면 저장이 실패하는 보안 테스트(완료)
- `pnpm validate:public-api-surface`

### Slice 5: agent 기능 부착 루프 검증

배치된 오브젝트에 agent가 recipe를 붙이는 end-to-end 루프를 회귀로 고정한다. 이 단계에서 viewer는 사람이 id를 선택해 전달하는 정식 도구이고, behavior authoring 자체는 계속 agent 소유다.

산출물:

- 배치(위치) + agent 부착(behavior) 결과를 고정하는 gameplay authoring dry-run report(완료, `agentAttachment`)
- consumer/agent 템플릿에 "배치→기능 부착" 워크플로우 반영(완료, `placementAuthoring.instances[]` report + shared agent skill/harness)
- inspector state 또는 patch export를 입력으로 받아 agent가 `behaviorRecipes`와 binding만 수정하는 recipe 작성 지침(완료, generated viewer handoff JSON + report evidence 기준)
- selected id 기반 behavior 적용 후 replay/hash/report가 drift를 잡는 fixture(완료, unit regression + variant expected + replay manifest link)

검증:

- `pnpm smoke:gameplay-replay`
- 신규: 배치+behavior fixture의 결정론 검증(부분 완료, 기존 authored replay link와 dry-run report drift check)
- `pnpm validate:gameplay-authoring:report`
- `pnpm --filter @ferrum2d/ferrum-web test`

### Slice 6: `World` 장르 누수 정리 (non-blocking)

`World.player` 내부 저장소와 prefab spawn marker는 `primary_actor` / `primary_actor_marker`로 정리했고, primary actor 지정/해제는 reserved `GameplayTags` marker를 동기화한다. `MovementTarget`과 raw movement setter에는 `primaryActor` / `nearestPrimaryActor` generic path를 추가했고, TS behavior recipe의 `chase`/`seekTarget` 기본 target도 `primaryActor`로 정규화했다. 기존 `player` / `nearestPlayer`는 legacy alias로 유지한다. prefab registry/registration/resolved-components 계층은 `GameplayPrefabRegistry` / `GameplayPrefabRegistration` / `GameplayPrefabResolvedComponents`로 중립화했고 snapshot layout은 유지한다. 기존 shooter/platformer 호환 accessor인 `player_entity()`는 제거했고, built-in scene 내부는 `primary_actor_entity()`를 호출한 뒤 로컬 변수명으로만 player 개념을 유지한다.

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
- 프리뷰: v1은 `useDataScene()` 라이브 spawn을 기본값으로 한다. 경량 editor 전용 렌더는 headless math 테스트나 fallback 후보로만 둔다.
- prefab 정의 소스: `EntityTemplate` 승격(권장) vs 신규 generic catalog 신설?
- `primary_actor` marker/tag 동기화 이후 public starter-scene API의 `player` 명칭을 어디까지 compatibility surface로 유지할지?
- viewer host 위치: engine repo 정식 host는 `examples/placement-viewer`로 확정했고, generated consumer project에는 `npm run ferrum:placement-viewer` route/script를 포함한다.
- 저장 adapter: patch export만으로 충분한지, host-provided save adapter를 둘지, File System Access API를 선택 enhancement로 둘지?
- desktop wrapper: 로컬 앱 배포 요구가 확정되면 Tauri 우선 spike와 Electron 비교를 `deployment-roadmap.md`의 desktop wrapper slice로 분리한다.
- 이 문서의 Slice 1~2를 별도 구조 리팩토링 task로 분리할지, 이 문서의 Slice를 그대로 task source로 둘지?

## 별도 승인 필요 범위

- full visual editor 제품화: 노드 트리, 풀 prefab editor, 멀티유저 동시 편집, behavior UI 편집은 별도 승인.
- Scene 추상화 승격 / `World.player` 계약 변경처럼 엔진 코어 구조·snapshot 계약에 닿는 변경: 별도 task 또는 이슈로 설계 합의 선행.
- public API/export surface 추가: `docs/engine/public-api.md`, `docs/engine/public-api-surface.json`, 관련 reference 문서 갱신을 같은 변경에 포함한다.

## 검증 기준

- Rust core 변경: `cargo fmt --manifest-path crates/ferrum-core/Cargo.toml -- --check`, `cargo clippy --manifest-path crates/ferrum-core/Cargo.toml -- -D warnings`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
- TypeScript 변경: `pnpm --filter @ferrum2d/ferrum-web lint`, `pnpm --filter @ferrum2d/ferrum-web test`
- Wasm/API 변경: `wasm-pack build crates/ferrum-core --target web --out-dir ../../packages/ferrum-web/pkg`, `pnpm build`, `pnpm validate:public-api-surface`
- 데이터 씬 authoring: `pnpm validate:data-scene-authoring`
- placement viewer UI: `pnpm smoke:placement-viewer`
- 결정론 회귀: `pnpm smoke:gameplay-replay`
- 문서 변경: `pnpm validate:docs-links`, `pnpm build:pages`

## 다음 작업 추천

1. placement viewer의 새 instance id 자동 부여/rename migration 정책을 editor-only 후속으로 확정한다.
2. public starter-scene API의 `player` 명칭을 유지/alias/제거 중 어떤 release policy로 가져갈지 정한다.
