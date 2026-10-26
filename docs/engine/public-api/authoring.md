# Authoring Public API

`@ferrum2d/ferrum-web/authoring`은 preview authoring entrypoint다. AI agent와
template이 scene, behavior, projectile/weapon, FSM, physics authoring data를 검증하고
낮은 빈도로 runtime command를 적용할 때 사용한다.

```ts
import {
  resolveSceneCompositionSpec,
  resolveDataSceneComponentsSpec,
  DATA_SCENE_PRIMITIVE_TEXTURES,
  dataSceneObjectVisualBounds,
  applyBuiltInSceneAuthoringDocument,
  applyDataSceneAuthoringDocument,
  attachDataSceneVariableRuntimeEngineAdapter,
  compileDataSceneVariableRuntimeIds,
  createDataSceneRuntimeTarget,
  createSceneInstanceHandleRegistry,
  createScenePlacementAssetProvider,
  createScenePlacementAssetProviderFromProjectAssets,
  createScenePlacementAgentHandoff,
  createScenePlacementViewport,
  createScenePlacementViewer,
  createScenePlacementPatchStore,
  mergeScenePlacementPatch,
  previewScenePlacementBindingMigration,
  saveScenePlacementPatch,
  SCENE_PLACEMENT_AGENT_HANDOFF_FORMAT,
  screenToSceneWorld,
  worldToSceneScreen,
  sceneScreenToBackbuffer,
  sceneBackbufferToScreen,
  snapSceneWorldPoint,
  classifySceneInstance,
  resolveBehaviorRecipeDocument,
  compileWeaponProfiles,
  applyGameplayBehaviorCommands,
  resolvePhysicsSpec,
} from "@ferrum2d/ferrum-web/authoring";
```

## Aseprite Atlas Import

기존 compatibility root의 `importAsepriteAtlas`, `importAsepriteAtlasFrames`를 authoring subpath에서도 제공한다.
동일 함수의 재노출이며 기존 입력·정규화·오류 동작은 바꾸지 않는다.

```ts
import { importAsepriteAtlas, type AsepriteAtlasImportOptions } from "@ferrum2d/ferrum-web/authoring";
const options: AsepriteAtlasImportOptions = { texture: "hero", stripFrameExtension: false };
const imported = importAsepriteAtlas(json, options);
```

`AsepriteAtlasFrameSizeSource`, `AsepriteAtlasImportOptions`, `AsepriteAtlasImportResult`도 같은 경로에 재노출한다.
함수는 atlas metadata를 변환하며 파일 읽기·GPU 업로드·씬 변경·프로젝트 저장은 수행하지 않는다.
공식 app의 PNG 확인/trim 거절·revision·재import·export는 [Aseprite Assets 흐름](../data-scene-authoring.md#aseprite-assets-가져오기재import)의 별도 host 정책이다.

## Sprite Normal Asset Binding

생성된 paired atlas를 project 이름으로 저장하고 기존 scene patch·agent handoff로 전달한다.
상세 예제와 진단 계약은 [노멀맵 binding](../data-scene-spatial.md#생성-에셋-binding과-패치handoff)을 따른다.

| API | 계약 |
| --- | --- |
| `createSpriteNormalAssetBinding(options)` | 완료 CLI/Worker report·선택형 descriptor/실제 descriptorSha256과 colorAsset/normalAsset에서 binding v1을 만든다. |
| `resolveSpriteNormalAssetBinding(value)` | 저장한 binding의 이름·hash·색 공간·UV·clip·provenance를 검증하고 복사한다. |
| `diagnoseSpriteNormalAssetBinding(binding, assets)` | host가 측정한 실제 texture metadata의 누락·중복·색 공간·크기·hash·선택형 UV layout을 진단한다. |
| `createSceneSpriteNormalPatch(document, binding, options)` | instanceId와 검증한 assets에서 deterministic combined patch와 evidence를 만든다. source·파일·GPU는 수정하지 않는다. |

공개 타입은 `SpriteNormalAssetBinding`, `SpriteNormalTextureReference`, `SpriteNormalTextureAsset`,
`SpriteNormalBindingDiagnostic`, `CreateSpriteNormalAssetBindingOptions`, `CreateSceneSpriteNormalPatchOptions`,
`SceneSpriteNormalBindingEvidence`다. binding 자체에는 runtime numeric ID가 없다.
`createScenePlacementAgentHandoff`의 선택형 `normalBindings`는 최종 문서와 참조·clip·초기 frame이 일치해야 하며,
`normalAssetDiagnostics`는 적용하지 않은 후보의 진단을 보관한다. generation 설정과 input/output hash를 복사한다.

## Sprite Normal Worker

선택형 asset 생성 API다. generator binary는 별도 build/hosting하며 첫 요청에서만 검증·로드한다.
[브라우저 Worker 계약](../data-scene-spatial.md#선택형-브라우저-노멀맵-worker)에 bundle 준비와 예제가 있다.

| API | 계약 |
| --- | --- |
| `createSpriteNormalWorkerClient(options)` | pinned manifest에서 module Worker client를 만든다. caller 입력을 복사하며 게임 상태·파일·GPU는 수정하지 않는다. |
| `SPRITE_NORMAL_WORKER_LIMITS` | 입력 16 MiB·4M pixel·256 source frame·256 MiB Wasm memory, 결과 40 MiB·metadata 256 KiB와 cache/timeout 상한이다. |
| `SpriteNormalWorkerError` | `code: SpriteNormalWorkerErrorCode`로 설정·환경·취소·timeout·generator/result 오류를 구분한다. |

`SpriteNormalGeneratorSource`는 HTTP(S) `manifestUrl`과 빌드 시 고정한 `manifestSha256`이다.
`CreateSpriteNormalWorkerClientOptions`는 필수 `generator`, 선택형 `cacheBytes`(0..8 MiB)와 `workerFactory`를 받는다.
`SpriteNormalWorkerPort`는 message/error/messageerror listener·postMessage·terminate 계약이며 반환 Worker는 client 소유다.
`SpriteNormalGenerationSettings`는 CLI와 같은 7개 설정과 균일 `frameSize`다.
`SpriteNormalWorkerInput`은 basename `name`, owned `bytes: Uint8Array`, 선택형 settings와 `animation: {loop, clipId?}`다.
브라우저 v1은 원본 color/normal frame grid를 공유하며 별도 packing/padding/rotation 설정은 거절한다.
`SpriteNormalWorkerGenerateOptions`는 `signal?: AbortSignal`, `timeoutMs?`(1..120000, 기본 30000)를 받는다.

`SpriteNormalWorkerClient.generate`는 최신 유효 요청만 유지한다. `cancel()`/abort/timeout은 Worker를 종료하며
`clearCache()`는 진행 중 요청과 compiled/result cache를 버린다. `destroy()`는 영구 종료하고 반복 호출할 수 있다.
실패 후 다음 요청은 새 Worker를 만들며 오래된 응답을 적용하지 않는다. main-thread 동기 fallback은 없다.
`SpriteNormalWorkerResult`는 owned `colorPng`/`normalPng` ArrayBuffer, `metadataJson`, CLI 호환 `report`,
선택형 `descriptor`/`descriptorSha256`, `elapsedMs`와 `stats`다. 기존 binding API로 명시적으로 연결한다.
`SpriteNormalWorkerStats`는 cacheHit/cacheEntries/cacheBytes, wasmMemoryBytes, generatorCalls/freedResults다.
정상 결과는 free 후 반환하고 cache에 보관한 bytes는 transfer하지 않는다. linear memory 용량은 전체 JS heap 측정값이 아니다.
`SpriteNormalWorkerErrorCode`는 invalidInput/unavailable/aborted/superseded/timeout/destroyed/
generatorInvalid/generationFailed/resultInvalid를 지원한다. CSP·Wasm/Worker 요구 사항과 자원 상한은 상세 계약을 따른다.

## Scene And Behavior

| API | 계약 |
| --- | --- |
| `resolveSceneAuthoringDocument(...)` | data scene authoring envelope를 검증한다. |
| `resolveSceneCompositionSpec(...)` | prefab, fragment, instance 배치를 정규화한다. |
| `instantiateSceneFragment(...)` | fragment를 deterministic instance list로 펼친다. |
| `resolveDataSceneComponentsSpec(...)` | `props.components` v1 `visual` 또는 legacy `sprite`, collider, layer, template descriptor를 검증하고 정규화한다. |
| `DATA_SCENE_PRIMITIVE_TEXTURES`, `dataSceneObjectVisualBounds(...)` | primitive visual fallback texture id와 placement/picking용 resolved visual bounds를 노출한다. |
| `applyDataSceneAuthoringDocument(...)` | scene-authoring envelope와 optional 변수 선언을 검증하고 Data Scene runtime target으로 spawn한 뒤 behavior recipe command를 적용한다. 결과의 `variables`로 선언된 값을 접근한다. |
| `applyBuiltInSceneAuthoringDocument(...)` | 활성 Shooter/Platformer/Breakout scene이 소유한 기존 entity handle에 위치와 Behavior Recipe를 적용한다. generic Data Scene spawn과 분리된 저빈도 adapter다. |
| `createDataSceneRuntimeTarget(...)` | `FerrumEngine`을 Data Scene spawn target으로 감싸 `applySceneBehaviorRecipes(...)`에 넘길 수 있게 한다. |
| `compileDataSceneVariableRuntimeIds(...)` | 선언 이름을 고유한 `1..64` numeric slot으로 컴파일한다. 명시적 `ids.variables`도 같은 범위와 완전성을 검증한다. |
| `attachDataSceneVariableRuntimeEngineAdapter(...)` | custom `FerrumEngine` host에 낮은 빈도 Rust variable slab `clear/configure/get/set` adapter를 연결한다. `createEngine(...)` 결과에는 이미 연결돼 있다. |
| `DATA_SCENE_RUNTIME_MAX_VARIABLES` | Rust gameplay variable slab과 authoring compiler가 공유하는 최대 slot 수 `64`를 노출한다. |
| `createSceneInstanceHandleRegistry(...)` | scene apply/reload 뒤 `instance.id`와 live entity handle을 양방향으로 조회한다. |
| `createScenePlacementAssetProvider(...)` | placement viewer/agent용 sprite asset id, atlas frame, 기본 size, thumbnail, missing reference diagnostic provider를 만든다. |
| `createScenePlacementAssetProviderFromProjectAssets(...)` | project `AssetManifest.textures`, loaded `TextureRegistry.entries()`, Game Spec `atlas.frames`를 placement asset provider로 변환한다. |
| `createScenePlacementAgentHandoff(...)` | viewer state, draft patch, binding migration preview, asset diagnostic을 agent handoff envelope로 묶는다. |
| `createScenePlacementViewport(...)` | Scene Placement Authoring Viewer의 CSS/backbuffer/camera/zoom 좌표계를 만든다. |
| `createScenePlacementViewer(...)` | scene-authoring 문서를 read-only viewer state로 감싸 선택/호버 객체, role, entity handle, pointer world 좌표와 screen-coordinate picking method를 노출한다. |
| `createScenePlacementPatchStore(...)` | viewer가 만든 `ScenePlacementPatch`를 export-only 상태로 보관한다. |
| `mergeScenePlacementPatch(...)` | placement patch를 scene-authoring document clone에 병합하고 원본 문서는 수정하지 않는다. |
| `previewScenePlacementBindingMigration(...)` | rename/remove patch가 agent-owned behavior recipe 참조에 미칠 수 있는 migration 후보를 보고한다. |
| `saveScenePlacementPatch(...)` | host가 명시적으로 허용한 save adapter로 placement patch merge 결과를 전달한다. |
| `screenToSceneWorld(...)`, `worldToSceneScreen(...)` | pointer/screen 좌표와 scene world 좌표를 상호 변환한다. |
| `snapSceneWorldPoint(...)` | grid origin과 snap mode에 맞춰 world 좌표를 정렬한다. |
| `classifySceneInstance(...)` | resolved instance를 저장 필드 없이 `worldObject` 또는 `actor` authoring role로 파생한다. |
| `resolveBehaviorRecipeDocument(...)` | entity behavior recipe를 검증하고 정규화한다. |
| `behaviorRecipeCommandsForEntity(...)` | 특정 entity에 적용할 `BehaviorRecipeCommand[]`를 만든다. |
| `applyGameplayBehaviorCommands(...)` | command를 `FerrumEngine` gameplay facade로 낮은 빈도 적용한다. |

Behavior recipe는 health, damage, faction, pickup, interaction, projectile action,
dash/melee/spawn action, timer, collision reaction, movement 같은 데이터를 표현한다.
매 frame TypeScript callback을 등록하는 API가 아니다.
movement recipe의 새 target canonical 값은 `primaryActor` / `nearestPrimaryActor`다.
`chase`와 `seekTarget`에서 `target`을 생략하면 `primaryActor`로 정규화된다. `player` /
`nearestPlayer`는 1.x 동안 기존 authoring data 호환 alias로 유지하지만 신규 문서, 예제,
agent-generated behavior data의 canonical target으로 쓰지 않는다. 이 정책은 movement target 이름에만
적용되며 Shooter Game Spec의 `player` key, layer/faction `player`, texture id `player` 같은
starter-scene 표면은 별도 호환 계약으로 유지한다.

`applyDataSceneAuthoringDocument(engine, document, options?)`는 full `ferrum2d.consumer.scene-authoring`
문서를 Data Scene runtime에 적용하는 package-facing 조립 경로다. 기본값은
`validateBindings: true`, `validateComponents: true`이며, `componentTemplates`를 넘기면
`allowComponentTemplates`도 기본 활성화된다. resolver/component validation은 runtime activation 전에
끝나므로 검증 실패만으로 기존 scene을 비우지 않는다. 적용 시에는 문서의 `ids`를 behavior command id
해석에 사용하고, `options.ids`가 있으면 caller override를 우선한다.
validation이 성공한 full apply는 initial fragment의 instance가 0개여도 `useDataScene()`을 호출한다.
따라서 빈 문서는 이전 scene의 runtime state를 정리하는 유효한 전환이며 `activateDataScene: false`에서만
자동 activation을 생략한다.

optional `variables` 선언은 `name`, `scope: "global" | "scene"`,
`type: "integer" | "real" | "bool"`, 타입에 맞는 `default`를 가진다.
적용 결과의 `DataSceneVariableStore`는 선언된 이름만 `get`/`set`할 수 있다. 같은 엔진에 다음 문서를
apply하면 동일 이름·동일 타입의 global 값만 유지하고 scene 값은 항상 다음 선언의 default로
초기화한다. 이름과 declaration metadata는 낮은 빈도 TypeScript authoring 경계에 남고 실제 값은
Rust `World`의 고정 64-slot slab에 저장된다. `setVariable`/`incrementVariable` recipe, collision·interaction·timer
guard, FSM `variableComparison`은 load 시 컴파일된 numeric slot만 Rust frame 안에서 읽고 쓰며
entity별 TypeScript callback이나 frame hot-path 문자열 조회를 추가하지 않는다.

`createDataSceneRuntimeTarget(engine)`은 기본적으로 첫 번째 유효한 spawn 직전에 `engine.useDataScene()`을
한 번 호출해 Data Scene runtime을 활성화한 뒤, 각
`ResolvedSceneCompositionInstance.props.components` inline descriptor를 raw Wasm
`spawn_data_scene_entity(...)`로 컴파일한다. authoring validation 실패나 target 생성만으로 기존 scene을
비우지 않는다. asset texture id는 `engine.textureId(name)` 또는 `options.textureId(name)`으로 해석한다.
consumer는 generated Wasm `pkg/*`, `dist/*`, `src/*` 내부 경로를 직접 import하지 않는다.

`applyBuiltInSceneAuthoringDocument(engine, scene, document, options?)`는 새 entity를 spawn하지 않는다.
`props.runtimeEntity`를 `builtinShooterPlayer`, `builtinPlatformerPlayer`,
`builtinBreakoutPaddle`, `builtinBreakoutBall` 중 scene에 허용된 값으로 preflight한 뒤
`builtIn*Handle()`과 `setBuiltInSceneEntityPosition(...)`을 사용하고 behavior command를 같은 handle에 적용한다.
같은 runtime entity의 중복 binding, 비활성 scene handle, Data Scene 변수/component, 0이 아닌 회전·layer,
1이 아닌 scale은 mutation 전에 diagnostic으로 거부한다. built-in scene이 소유한 entity 수명을 보호하기
위해 health, `lifetime`, pickup-despawn, collision-despawn command도 preflight에서 거부한다. 생성
프로젝트는 첫 Playing frame과 명시적 reset 뒤에만 이 adapter를 호출하므로 frame loop에 entity별
JS/Wasm 왕복을 추가하지 않는다.

default target은 `components.visual` 또는 legacy `components.sprite`, `collider`, `layer` inline descriptor를 spawn한다.
`visual.kind: "primitive"`는 resolved visual 의미를 유지하면서 WebGL2 runtime path에는
`DATA_SCENE_PRIMITIVE_TEXTURES.rect|circle|point` fallback sprite로 컴파일된다.
`visual.kind: "sprite"`는 `texture` 또는 `asset` texture reference를 같은 runtime sprite path로 컴파일한다.
`options.componentTemplates`를 제공하면 `components.template` catalog reference도 inline descriptor로 해소해
spawn한다. catalog entry는 다시 template을 가리킬 수 없고, 최종적으로 `visual` 또는 legacy `sprite`, `collider`, `layer`를
제공해야 한다. instance `rotationRadians`는 visible sprite rotation과 collider geometry/offset에 반영된다.
instance `layer`는 Data Scene entity render band의 sort layer로 전달된다. 이 값은 render/sort layer이며,
`components.layer` collision layer와 별도다.

`classifySceneInstance(instance)`는 `props.behaviorRecipes` 바인딩 존재 여부로 authoring role만
파생한다. behavior binding이 없으면 `worldObject`, 하나 이상 있으면 `actor`다. 이 값은 저장되는
schema 필드나 Rust runtime class가 아니며, UI/agent가 배치 객체와 기능 객체를 설명할 때 쓰는
낮은 빈도 authoring helper다. `props.components`가 있는지 여부는 `hasDataSceneComponents`로
함께 확인할 수 있다.

`createSceneInstanceHandleRegistry({ entityExists })`는
`applySceneBehaviorRecipes(..., { instanceHandleRegistry })`와 함께 사용한다.
scene apply 결과의 `ResolvedSceneCompositionInstance.id`와
`GameplayEntityHandle`을 동기화하고, `get(id)`, `require(id)`, `instanceIdForHandle(handle)`로
양방향 조회를 제공한다. `entityExists`를 넘기면 `validateLive: true` 조회나 `sync(...)` 시 stale
handle을 제거한다. 이 registry는 scene load, reload, reapply, agent patch 같은 낮은 빈도 경로용이며,
frame loop에서 entity별 JS/Wasm 호출을 추가하지 않는다. 배치 UI나 agent 타겟팅처럼 안정 id가 필요한
경로는 `requireExplicitInstanceIds: true`로 fallback id 의존을 막을 수 있다.

Scene Placement Authoring Viewer의 viewport helper는 TypeScript authoring layer의 순수 좌표 변환
도구다. `createScenePlacementViewport(...)`는 CSS logical canvas 크기, optional DPR/backbuffer
크기, camera center, zoom을 정규화한다. `screenToSceneWorld(...)`는 pointer 좌표를 Rust camera와
같은 center-based world 좌표로 바꾸고, `worldToSceneScreen(...)`은 overlay 위치 계산에 사용한다.
`sceneScreenToBackbuffer(...)`와 `sceneBackbufferToScreen(...)`은 WebGL backbuffer smoke나 DPR
검증에서만 필요한 변환이다. 이 helper들은 picking/selection의 낮은 빈도 authoring 경로용이며,
frame hot path에 Wasm entity query를 추가하지 않는다.

`createScenePlacementViewer(...)`는 ObjectDefinition/Prefab catalog summary, resolved scene instance 목록,
선택/호버 id, pointer world 좌표,
`classifySceneInstance(...)` role, optional `SceneInstanceHandleRegistry` entity handle, resolved
`visual`/`collider`/collision `componentLayer` summary를 하나의 read-only state로 노출한다.
`validateLiveHandles` 기본값은 `false`라 `state()` 호출만으로 stale
handle 검증용 entity query가 돌지 않는다. `pointerAtScreen(point)`는 pointer world 좌표만 갱신하고,
`pickInstanceAtScreen(point)`, `hoverInstanceAtScreen(point)`, `selectInstanceAtScreen(point)`는
resolved `visual.bounds`, sprite origin, transform scale/rotation을 반영한 회전 사각형 cache로 screen coordinate 기반 instance id를 찾는다. 원점은 sprite pivot이며 primitive는 중심을 사용한다. 이 picking
경로는 pointer/click 같은 낮은 빈도 authoring interaction용이며 frame loop에 entity별 Wasm query를
추가하지 않는다.

`state().selectedInstanceIds`는 중복 없는 ordered selection이며 마지막 ID가 기존
`selectedInstanceId`/`selected`의 대표 객체다. `selectInstances(ids)`는 전체 ID를 검증한 뒤 집합을 교체하고,
기존 `selectInstance(id?)`는 한 객체 또는 빈 집합을 선택한다. 반환 배열은 독립 복사본이다.
선택 집합은 문서/patch에 쓰지 않고 이력을 만들지 않는다.

`updateInstanceTransforms([{ instanceId, transform }, ...])`와 `removeInstances(ids)`는 모든 대상·중복·잠금과
값/작성 제약을 먼저 검증하고 한 번에 적용한다. 기존 operation 배열과 composition 순서로 export하며 patch version은 유지한다.
transaction 밖에서는 집합 전체를 한 건의 Undo로 기록한다. 중간 항목이 잘못돼도 앞 항목만 적용하지 않는다.
포함 인스턴스의 transform은 기존 `updateResolvedTransform`을 사용하며 포함 인스턴스 삭제는 집합 전체를 거부한다.
빈 batch와 patch가 바뀌지 않는 호출은 이력을 만들지 않는다. 기존 단일 transform/remove API는 같은 경로를 사용한다.

`setInstancesLocked(ids, locked)`는 viewer 안의 일시적 편집 잠금을 변경하고 `state().lockedInstanceIds`로 노출한다.
진행 중인 edit transaction은 먼저 commit/cancel해야 한다. 잠긴 객체는 canvas picking/hover에서 건너뛰지만,
명시적 `selectInstance(s)`로 검사할 수 있다. 직접 instance transform/components/binding/rename/remove는 잠금을
해제하기 전까지 거부하며, 잠긴 항목이 섞인 batch도 전부 거부한다. ObjectDefinition 변경·전체 Revert·Undo/Redo나
외부 JSON writer를 통제하는 권한 경계는 아니다.
잠금은 문서/patch/history에 저장하지 않는다. 원본 객체와 추가 초안의 내부 identity를 사용해 rename Undo/Redo를 따라가며,
사라진 객체의 잠금은 정리한다. 과거 문서를 Undo로 복원할 수 있지만 그때 폐기된 UI 잠금까지 복원하지는 않는다.
기존 factory 호출과 단일 선택 사용법은 유지한다. `ScenePlacementViewer` wrapper를 직접 구현하거나 state fixture를
구성하는 consumer는 새 메서드 위임과 두 배열 필드를 추가해야 한다. module export 이름은 바뀌지 않는다.

`scenePlacementVisualGeometry(visual, transform)`는 같은 visual 사각형의 world 중심 `x/y`,
scale 적용 `width/height`, `rotationRadians`를 반환한다. 공식 viewer와 생성 프로젝트의
selection/draft 표시는 이 helper를 사용한다. picking은 회전 사각형 내부를 검사하며
collider 형태나 텍스처 투명도는 검사하지 않는다.

`updateInstanceTransform(instanceId, transform)`, `updateInstanceComponents(instanceId, components)`,
`updateBehaviorBinding(target, behaviorRecipes)`, `renameInstance(instanceId, nextInstanceId)`,
`addObjectDefinition(id, definition)`, `addInstance(fragment, instance)`,
`removeInstance(instanceId)`는 원본 scene-authoring 문서를 직접 수정하지 않고 viewer 내부 draft
overlay만 갱신한다. `state().instances`, `state().selected`, screen-coordinate picking bounds,
`state().draftPatch`, `exportPatch()`는 이 draft를 반영한다. transform draft가 원본 transform과
같아지면 해당 operation은 자동 제거된다. component draft는 UI-owned `props.components` 전체를
교체하는 낮은 빈도 authoring patch이며, draft add instance의 component edit은 해당 `addInstance`
operation 안으로 접힌다. object definition draft도 UI-owned `props.components`만 쓸 수 있고,
같은 draft 안에서 새 ObjectDefinition/Prefab을 참조하는 instance를 추가할 수 있다.
behavior binding draft는 `props.behaviorRecipes` 참조만 attach/detach하고 `behaviorRecipes.entities`
본문은 수정하지 않는다. target은 instance 또는 ObjectDefinition이며, `null`은 effective binding
해제를 뜻한다. `clearDraftPatch()`는 draft를 모두 버린다.
`createScenePlacementPatchStore(...)`는 이 patch를 JSON export용으로 보관하는 export-only store다.

`ScenePlacementViewer`는 문서 인스턴스마다 독립적인 Undo/Redo 이력을 유지한다.
`historyState(): ScenePlacementHistoryState`는 `undoCount`, `redoCount`, 직렬화 snapshot의 `bytes`,
진행 중인 `transactionLabel?`을 반환한다. `beginEdit(label)` → 여러 draft 변경 → `commitEdit()`는
한 건으로 기록하고, `cancelEdit()`는 시작 초안을 복원한다. 중첩 transaction과 빈 label은 거부한다.
transaction 안의 draft 변경이 실패하면 전체 transaction을 취소한다. host가 취소까지 거절하면
직전 정상 초안과 열린 transaction을 유지한다. 열린 transaction에서 `undo()`는
현재 작업만 취소하며 이전 이력을 추가로 되돌리지 않는다. `redo()`는 열린 transaction 중에는 변경하지 않는다.
`commitEdit()`, `cancelEdit()`, `undo()`, `redo()`는 복원된 `ScenePlacementViewerState`를 반환한다.

선택 `CreateScenePlacementViewerOptions.validateDraft(state)`는 저빈도 host 검증 callback이다.
최종 문서 계약 검사 뒤 편집을 기록하기 전과 Undo/Redo/취소 snapshot 복원 시 호출한다.
예외를 던지면 변경을 거절하고, 이력 위치와 정상 초안을 복구한다. 복구도 실패하면 그 오류를 전달하며
거절된 후보를 새 정상 초안으로 다시 적용하지 않는다. callback은 실패 시 외부 preview를 마지막 정상 상태로
복구해야 한다. 반환 뒤 native handle이 갱신될 수 있어 편집 결과는 최신 registry를 반영한다.
callback 안에서 draft 편집 또는 begin/commit/cancel/undo/redo를 다시 호출하면 거절한다.
이 callback은 runtime frame hook이나 게임 상태 snapshot이 아니다.

transaction 밖의 transform/components/binding/rename/add/remove/ObjectDefinition/revert는 각각 한 건이다.
선택·hover·viewport 탐색과 patch가 바뀌지 않는 호출은 이력을 만들거나 redo를 지우지 않는다.
새 변경은 redo 분기를 제거한다. 각 snapshot은 draft와 복원에 필요한 선택 ID를 복사하므로
삭제 취소 시 안정 ID·component·binding이 함께 돌아온다. camera와 runtime 상태는 복원하지 않는다.
최대 100건 또는 snapshot 합계 8 MiB까지 오래된 이력을 유지한다. 단일 변경이 8 MiB를 넘으면
변경은 적용하되 이전 이력도 비워 불연속 복원을 막는다. asset binary·원본 문서·게임 상태의 보관 예산이 아니다.

fragment include의 resolved instance transform은 patch version 2의 `updateResolvedTransform`을 사용한다.
operation target에는 root fragment, include index, included fragment와 include 내부 상대 instance id가
들어가며 world transform을 include parent-local transform으로 역변환해
`include[].instanceTransforms[relativeInstanceId]`에 저장한다. 같은 fragment를 여러 번 include해도 선택한
occurrence만 바뀐다. patch version 1의 flat `updateTransform`은 계속 merge할 수 있으며, nested instance의
component/binding/rename/remove patch는 잘못된 flat target을 만들지 않도록 명시적으로 거부한다.

`addInstance(...)`는 명시 `instance.id`를 요구하고 invalid/duplicate id를 거절한다. Core viewer API는
id를 자동 생성하지 않으며, 공식 host가 사용자 입력이 비어 있을 때 deterministic id를 채운 뒤 호출한다.
`apps/placement-viewer`는 primitive/prefab/sprite prefix 기반 id를 만들고, generated create-game
viewer는 `sprite-*`/`object-*` prefix helper를 사용한다. `renameInstance(...)`와
`removeInstance(...)`는 behavior recipe 본문을 직접 갱신하지 않고 draft patch만 만든다. 저장 host는
`previewScenePlacementBindingMigration(...)` reference report를 표시하고, agent-owned reference가 남아
있으면 save를 막거나 handoff evidence로 넘긴다.

`createScenePlacementAssetProvider(...)`는 sprite asset 목록을 정규화하고 `listSpriteAssets()`,
`resolveSpriteAsset(id)`, `listSpriteFrames(assetId)`, `resolveSpriteFrame(assetId, frameId)`,
`diagnoseSpriteAssetReference(...)`를 제공한다. frame metadata는 atlas picker가 선택한 UV rect와
frame별 기본 size/thumbnail을 전달하기 위한 authoring 계약이다. missing asset/frame diagnostic은
저장 전 UI와 agent handoff에서 보고하며, PNG import나 atlas packing 자체를 수행하지 않는다.

`createScenePlacementAssetProviderFromProjectAssets(...)`는 host adapter용 helper다. Consumer host는
`AssetManifest.textures`, runtime `TextureRegistry.entries()`, 또는 Game Spec `atlas.frames`를 넘겨
같은 provider contract를 만들 수 있다. atlas frame의 `texture`가 string이면 해당 texture asset 아래
frame으로 묶고, numeric texture frame은 기본적으로 건너뛴다. 이미지 decode나 파일 import를 수행하지
않으며, width/height는 texture metadata나 atlas frame size에 명시된 값만 사용한다.
create-game 공유 placement viewer는 이 helper로 optional `public/game.json` atlas와
`public/assets/texture-atlas.input.json`을 Project Assets 패널에 노출하고, `object` prefab 기반 Add
Sprite draft patch를 생성한다.

`createScenePlacementAgentHandoff(...)`는 `SCENE_PLACEMENT_AGENT_HANDOFF_FORMAT` envelope를 생성한다.
envelope에는 선택 instance, pointer world 좌표, draft patch, rename/remove binding migration preview,
asset folder evidence, asset diagnostics가 포함된다. `assetFolder`는 desktop host가 지정한
asset folder path, 이미지 파일 목록, `texture-atlas.input.json` 경로, missing/not-directory diagnostic을
전달하는 선택 필드다. desktop host가 local image를 viewer preview에 노출할 수 있으면
`assetFolder.images[].runtimeUrl`에 `ferrum-asset://...` virtual URL을 함께 남긴다. 이 값은 WebView
preview/custom protocol evidence이며, absolute file path 대신 runtime fetch URL을 agent가 확인할 수
있게 하는 보조 필드다. official viewer의 TypeScript browser platform layer는 이 URL을 저빈도
asset-folder load 경로에서 `createImageBitmap(...)`으로 decode하고 실제 pixel `width`/`height`를
같은 image evidence에 추가한다.
UI는 이 handoff를 agent가 behavior recipe 본문, prefab binding, schema
migration이나 asset reference를 수정할 때 참고하도록 노출하지만, handoff 생성 자체가 scene-authoring
문서를 수정하지는 않는다.
agent co-authoring 검증에서는 이 envelope의 `selectedInstanceId`를 기존 gameplay authoring dry-run report의
`agentAttachment`와 비교해, 선택된 배치 object가 실제 behavior profile/command로 해석되는지 확인할 수 있다.
기본 `pnpm validate:gameplay-authoring:report`는 committed placement handoff fixture를 읽어 이 연결을 검증하고,
다른 scene에서는 `--placement-handoff <path>`로 같은 `SceneComposition`에서 export한 handoff를 넘긴다.

대표 public type surface는 다음 범위다. 이 타입들은 `@ferrum2d/ferrum-web/authoring`과 root
compatibility aggregate에서 명시 export되며, consumer는 내부 `src/*` 경로를 import하지 않는다.

| Type | 계약 |
| --- | --- |
| `ScenePlacementAssetProvider` | placement viewer/agent가 sprite asset과 atlas frame을 조회하는 host adapter 계약이다. |
| `ScenePlacementSpriteAsset`, `ScenePlacementSpriteFrameAsset` | sprite asset id, 기본 size, thumbnail, frame UV/size metadata를 표현한다. |
| `ScenePlacementSpriteAssetReference` | scene component가 참조한 sprite asset/frame 위치를 diagnostic path와 함께 표현한다. |
| `ScenePlacementAssetDiagnostic`, `ScenePlacementAssetDiagnosticCode` | missing asset/frame 같은 저장 전 diagnostic을 UI와 handoff에 전달한다. |
| `CreateScenePlacementAssetProviderOptions` | 직접 asset provider를 만들 때 diagnostic path 같은 authoring option을 전달한다. |
| `CreateScenePlacementProjectAssetProviderOptions` | project manifest, texture registry, atlas frame metadata를 provider로 변환하는 host adapter option이다. |
| `ScenePlacementAgentHandoff`, `CreateScenePlacementAgentHandoffOptions` | 선택/draft/migration/asset diagnostic을 agent용 envelope로 만드는 계약이다. |
| `ScenePlacementAgentHandoffAssetFolder`, `ScenePlacementAgentHandoffAssetFile`, `ScenePlacementAgentHandoffAssetFolderDiagnostic` | desktop/local host가 선택한 asset folder 상태와 이미지 파일의 runtime URL·pixel size evidence를 handoff에 전달하는 계약이다. |

공식 `apps/placement-viewer` host는 이 public surface 위에 numeric x/y/scale/rotation/layer input,
snap toggle/grid, arrow-key nudge, pointer drag, draft revert, Add Rect/Circle/Point/Sprite/Prefab
palette, asset provider 기반 sprite/frame select/thumbnail, Behavior Binding inspector,
Visual/Collider/Layer inspector control,
ObjectDefinition 생성 action, collider overlay를 붙인다. Add Rect/Circle/Point/Sprite는 `object`
prefab instance에 inline `props.components.visual`을 넣고, Add Prefab은 기존 prefab reference를
추가한다. 선택 instance에서 Create Definition을 실행하면 resolved visual/collider/layer를 새
ObjectDefinition/Prefab `props.components`로 추출하고 `addObjectDefinition` patch를 만든다. Add 버튼은 pending mode를 켜고 canvas hover preview를 표시한 뒤 click 위치에 자동 id 또는
`new id` 입력값으로 instance를 만든다. 선택 overlay의 resize handle은 primitive rect/circle visual과
기본 aabb/circle collider size를 `props.components` patch로 기록한다. Collider inspector는
`none`/`aabb`/`circle`/`capsule`/`orientedBox`/`convexPolygon` descriptor를 numeric/JSON field로
수정하고, collider overlay offset handle은 offset X/Y를
`props.components.collider.offsetX/offsetY` patch로 기록한다. Behavior Binding inspector는
이미 정의된 recipe id 목록을 선택 instance에 attach/detach하는 `updateBehaviorBinding` patch만
만들며, recipe command/FSM/script 본문을 편집하지 않는다.
Tauri desktop host가 제공하는 `ScenePlacementAgentHandoffAssetFile.runtimeUrl`은 Add Sprite thumbnail과
handoff evidence에 쓰이며, project open 초기에는 같은 image list에서 파생한 texture manifest를
`runtime.engine.loadAssets(...)`에 병합한다. 따라서 scene-authoring의 `visual.kind: "sprite"` asset
reference가 local asset id를 가리키면 Rust/Wasm render command 생성 전 기존 TypeScript asset loader
경로로 texture id가 등록된다. `width`/`height`가 확인된 local asset의 Add Sprite draft는 실제 pixel 크기를
visual 기본 크기로 사용하고 AABB collider half-size를 함께 계산한다. WebView가 metadata decode API를
지원하지 않거나 URL fetch/decode가 실패하면 기존 default object size로 fallback한다. Add Sprite pending/draft marker와 draft handoff는
같은 local asset thumbnail/size/id를 사용하지만, 저장 전 원본 scene-authoring 문서를 자동 수정하지 않는다. app bootstrap
이후 asset folder를 교체하면 official host는 새 image manifest를 낮은 빈도
`runtime.engine.loadAssets(...)` refresh로 등록하고 handoff/Inspector 상태를 갱신한다. refresh 실패는
`ScenePlacementAgentHandoffAssetFolderDiagnostic.code: "runtimeTextureLoadFailed"`로 남기며 frame loop는
계속 유지한다.
Transform 조작은 `updateInstanceTransform(...)`, Visual/Collider
조작은 `updateInstanceComponents(...)`, behavior binding 조작은 `updateBehaviorBinding(...)`,
palette 추가는 `addInstance(...)`, rename/remove는 각각
`renameInstance(...)`/`removeInstance(...)`로 draft patch를 만들며 Rust runtime entity를 직접 수정하지
않는다. 따라서 authoring preview/picking/export 경로는 낮은 빈도 TS tooling state에 머물고, runtime frame
loop나 Wasm ABI에는 새 per-entity mutation 경로를 추가하지 않는다.

`mergeScenePlacementPatch(document, patch, options?)`는 `ScenePlacementPatch`의
`updateTransform`, `updateResolvedTransform`, `updateComponents`, `updateBehaviorBinding`, `renameInstance`, `addObjectDefinition`,
`addInstance`, `removeInstance` operation을
scene-authoring document clone에 적용한다. 원본 문서는 수정하지 않고, `behaviorRecipes`, prefab
catalog의 agent-owned props 같은 영역은 그대로 보존한다. `updateBehaviorBinding`은
instance/ObjectDefinition의 `props.behaviorRecipes` 참조만 바꾸고 `behaviorRecipes.entities` 본문은
보존한다. `addObjectDefinition`은 `props.components`
기반 ObjectDefinition/Prefab 추가만 허용하고, patch 순서상 뒤따르는 `addInstance`가 새 definition을
참조할 수 있다. `updateComponents`는 대상 instance의
`props.components` 전체를 교체하므로 legacy `components.sprite`와 신규 `components.visual`이
부분 merge로 섞이는 상태를 만들지 않는다. `allowedFragments`를 넘기면 host가 허용한 fragment 외의
수정도 거절한다.

`previewScenePlacementBindingMigration(document, patch)`는 `renameInstance`와 `removeInstance`가
`behaviorRecipes` 내부 string value 또는 object key와 정확히 일치하는 경우를 agent-owned migration
후보로 보고한다. viewer/save helper가 behavior recipe 본문을 직접 수정하지 않도록 분리한 preview이며,
공식 placement viewer host는 이 reference report를 inspector에 표시하고 reference가 남아 있는 동안
Save를 비활성화한다. agent는 이 결과를 보고 필요한 behavior target/profile rename을 별도 patch로 처리한다.

`saveScenePlacementPatch(document, patch, options)`는 engine package가 직접 파일 시스템 권한을 갖는 API가
아니다. 저장은 `allowSave: true`, host-owned `ScenePlacementSaveAdapter`, optional
`allowedAdapterIds` allowlist가 모두 통과한 낮은 빈도 authoring 경로에서만 실행된다. 공식 placement
viewer host는 dev server 또는 `VITE_FERRUM_PLACEMENT_VIEWER_SAVE=true` opt-in build에서만 host-owned save
endpoint를 호출하며, 기본 production 실행은 patch export와 disabled save gate만 제공한다.
공식 app chrome은 이 상태를 `Export Only`로 표시하며 Clean/Changes 초안 상태와 구분한다.
공유 viewer의 기존 `labels.readOnly` override와 `data-status="readonly"`는 호환성을 위해 유지한다.

공식 app의 웹 endpoint와 Tauri `save_placement_scene_document`는 병합된 `document`와 마지막으로 읽은
`expectedDocument`를 필수로 받는다. host는 현재 디스크 JSON과 기준 JSON의 의미를 비교하고 다르면 거부한다.
웹 충돌 응답은 HTTP 409이며 초안·이력·외부 파일을 유지한다. 공백과 object key 순서만 달라도 저장할 수 있다.
Rust host는 브라우저가 `1.0`을 `1`로 보내는 숫자 정규화도 허용하며, 큰 정수 비교를 일괄 f64 변환하지 않는다.
같은 host의 저장은 직렬화하고 같은 디렉터리의 임시 파일을 sync한 뒤 기준을 재확인하고 교체한다.
기존 파일 권한을 유지한다. 독립 외부 writer와 비교/교체 사이의 경쟁까지 원자적으로 잠그는 계약은 아니다.
`ScenePlacementSaveAdapter` 공용 인터페이스는 유지되며 다른 host는 자체 정합성 정책을 구현한다.

### HD-2D spatial placement patch

`createScenePlacementViewer({ document, viewport })`는 spatial 원본도 보관한다.
`state().spatial`은 base와 draft를 합친 복사본이다. composition만 전달한 viewer에는 spatial 변경을 적용할 수 없다.
`updateSpatial(operations)`는 대상 ID·필드를 검사하고 전체 batch의 최종 문서를 검증한 뒤
기존 history에 한 번 기록한다. 실패 시 열린 gesture 전체를 복원한다.

기존 flat patch는 계속 v2로 export하며 v1/v2를 merge한다. spatial 변경을 포함한 patch만 v3이고
`spatial: { format: "ferrum2d.scene-spatial.patch", version: 1 | 2 | 3 | 4, operations: [...] }`를 추가한다.
spatial v1은 기존 대상 갱신, v2는 billboard/model 참조 추가도 허용한다. 갱신만 있는 export는 v1을 유지한다.
새 참조가 포함된 export만 v2를 사용하며 이전 spatial reader는 이를 거절한다.
이전 reader는 v3를 거절하므로 spatial 변경을 무시하고 일부만 저장하지 않는다.
공개 타입은 `SceneSpatialPatch`, `SceneSpatialPatchOperation`이다.

| operation | 허용 changes |
| --- | --- |
| updateTerrainSurface | x, y, width, depth, elevation, endElevation, baseElevation, floorId |
| updateBillboard | elevation, unitsPerPixel, castShadow, receiveShadow |
| updateModel | elevation, yawDegrees, scale, castShadow, receiveShadow |
| addBillboard (spatial v2) | elevation, unitsPerPixel, castShadow, receiveShadow. 빈 `{}` 허용 |
| addModel (spatial v2) | 필수 asset/contentId와 선택 elevation, yawDegrees, scale, castShadow, receiveShadow |
| setBillboardNormalTexture (spatial v4) | normalTexture: stable project 이름 또는 null(참조 해제). 기존 numeric ID도 제거 |

Add는 같은 ID의 billboard/model 중 어느 참조라도 이미 있으면 거절하며 upsert로 처리하지 않는다.
spatial v3는 아래 identity/reimport operation을 추가한다. 이전 reader는 v3를 거절한다.
spatial v4는 normal 이름 교체/해제를 추가하고 v1~v3 operation도 받는다. 이전 reader는 v4를 거절한다.
`viewer.updateSpatial`은 normal 변경의 Undo/Redo와 v4 sparse export를 지원한다.

| operation (spatial v3) | changes / 경계 |
| --- | --- |
| renameReference | target: billboard/model, nextId. 같은 outer renameInstance와 정확히 대응 |
| removeReference | target: billboard/model. 같은 outer removeInstance와 정확히 대응 |
| copyReference | target: billboard/model, sourceId. 같은 outer addInstance와 정확히 대응 |
| replaceModelAsset | asset, contentId. 기존 asset ID와 LOD 구조를 유지하고 일치하는 root/LOD SHA만 교체 |

identity 변경은 normal/alpha/chunk/LOD 등 기존 visual metadata 전체를 보존한다.
`duplicateInstances(ids, offset?)`는 기본 XY +16/+16으로 같은 fragment에 복제하고 한 번의 검증·Undo를 사용한다.
복제 원본 identity를 명시적으로 추적하며 metadata가 비슷한 다른 객체를 추정하지 않는다.
UI 소유 component/binding 외의 custom instance props override는 조용히 생략하지 않고 agent-owned 복제로 거절한다. prefab/variant 기본 props는 같은 reference로 유지한다.
삭제·rename한 원본 ID는 저장 전까지 예약하며 새 instance에 재사용할 수 없다. 자동 복제 ID는 예약명을 건너뛴다.
chunk/LOD 구조·attachment·camera/environment의 임의 변경은 placement patch 범위 밖이다.
`addInstance(fragment, instance, spatial?)`의 선택 세 번째 인자는 `{ kind: "addBillboard", changes: {...} }` 또는
`{ kind: "addModel", changes: {...} }`다. ID는 새 instance에서 가져온다. composition instance와 spatial 참조를
하나의 edit에서 만들고 전체 문서/host 검증을 거친 뒤 한 번 기록한다. 실패하면 둘 다 복원한다.
기존 두 인자 호출은 유지한다. `updateSpatial`로 참조만 추가할 때도 적용 fragment에 해당 instance가 있어야 한다.
XY는 기존 composition transform, 물리 높이·층은 `props.components.body.heightSpan`,
spatial elevation은 추가 시각 offset이 소유한다. 모델 pose는 collider/proxy를 자동 변형하지 않는다.
공식 app의 Collision Proxy 입력은 같은 객체의 Undo/Redo·component 변경에도 실제 설정으로 갱신한다.
설정이 바뀌지 않은 잠금 등 UI 갱신에서는 미적용 입력을 보존한다. Apply는 유효한 치수·층을 요구하며,
Remove Proxy는 미적용 입력 오류와 독립적으로 기존 collider/body를 제거하고 시각 높이를 유지한다.
잠금·attachment 편집 제한은 삭제에도 적용된다.
Terrain 높이 전체 이동은 top/end/base를 명시적으로 함께 변경한다.
visual-only billboard/model map의 rename/remove/copy는 composition과 함께 원자 처리한다.
behaviorRecipes/gameplay/navigation/actor/attachment에 agent-owned ID 참조가 있으면 명시적 agent migration을 요구한다.
imported patch가 spatial envelope를 생략해도 outer identity 변경 보호를 적용한다. 기존 flat recipe migration preview는 유지한다.
Spatial patch에 `allowedFragments`를 지정하면 전역 spatial 데이터의 fragment 권한을 추정하지 않고 거절한다.
Merge/save는 composition과 spatial을 복제 문서에 적용하고 전체 문서를 검증한다.
수정하지 않은 원문 필드는 정규화 기본값으로 덮어쓰지 않는다.

Handoff의 optional `authoringEvidence`는 선택 원본 JSON pointer 경로와 before/after 변경 evidence,
`changeCount`·`truncated`를 제공한다. 공식 app은 화면에 최대 200건, handoff evidence에는 최대 512건을 담고
전체 변경은 기존 `draftPatch`에 유지한다. 런타임 진행 상태는 저장/patch에 복제하지 않는다.
공식 app의 Selected Runtime은 펼친 동안 선택 entity의 FSM state ID·health·timer/action cooldown을
`gameplayEntityDiagnostics`로 최대 4 Hz 조회한다. global/scene 변수는 32개, action은 16개,
최근 gameplay event는 64개로 제한한다. timer event도 포함하며 선택·문서·모드·native 적용 문맥이 바뀌면 비운다.
기록은 owned copy이며 저장/patch에 넣지 않는다. recipe/FSM 본문은 편집하지 않는다.
표시는 주요 값 요약을 우선하며 변수·event 목록과 Raw JSON은 접어서 제공한다. 요약을 위한 추가 native query는 없다.

`assetFolder.images[].contentRevision`과 `models[].contentRevision`은 host session cache fingerprint이며 모델 SHA-256 contentId나 보안 digest가 아니다.

세부 primitive와 검증 기준은 [Runtime Extensibility](../runtime-extensibility.md)와
[Data Scene Authoring](../data-scene-authoring.md)을 따른다.

## Projectile And Weapon

| API | 계약 |
| --- | --- |
| `projectile(id)` | projectile speed, damage, lifetime, aim, collision target, tile impact를 정의한다. |
| `weapon(id)` | action id, cooldown, projectile fire rule을 묶는다. |
| `compileWeaponProfiles(...)` | weapon/projectile definition을 behavior recipe document로 컴파일한다. |

`compileWeaponProfiles(...)` 결과는 runtime simulation object가 아니다. agent나
template이 생성한 data를 검증하고, scene load 또는 profile 변경 같은 낮은 빈도
타이밍에 command로 적용한다.

## Gameplay Runtime Apply

`FerrumEngine`은 authoring apply용 gameplay facade를 제공한다.

| Method | 계약 |
| --- | --- |
| `registerGameplayPrefabs(...)` | runtime prefab id와 component source를 등록한다. |
| `applyGameplayBehaviorCommands(...)` | resolved command를 Rust-owned gameplay component에 적용한다. |
| `applyFactionRelationTable(...)` | session 단위 faction relation table을 적용한다. |
| `installBehaviorStateMachineRuntime(...)` | FSM document를 numeric runtime plan으로 설치한다. |
| `preflightBehaviorStateMachineStateCommands(...)` | state command apply 가능성을 mutation 없이 검사한다. |
| `applyBehaviorStateMachineStateCommands(...)` | 검증된 state command subset을 적용한다. |

이 API들은 scene load, agent patch, replay setup 같은 낮은 빈도 경로용이다. frame hot path에
entity별 JS/Wasm callback을 추가하지 않는다.

## Atomic Apply And Rollback

단일 command가 Rust에서 atomic setter를 제공하는 경우, 해당 component와 reaction은 한 번의
검증 결과로 반영된다. 예를 들어 `configureDamage`는 damage component와 damage collision
reaction을 같은 setter 결과로 적용한다.

전체 `BehaviorRecipeCommand[]` batch는 full engine transaction이 아니다. 실패 시 facade는
JSON path와 원인 후보를 포함한 diagnostic을 반환하거나 throw한다. agent loop에서는
`dryRunSceneBehaviorRecipes(...)`, preflight helper, replay/smoke를 먼저 통과한 plan을
runtime에 적용한다.

## Raw Wasm Boundary

raw Wasm `set_gameplay_*` setter는 public API가 아니다. 테스트 harness나 내부 bridge 검증에
필요한 구현 detail이며, consumer는 `FerrumEngine` gameplay facade와 authoring helper를
사용한다.

이 경계는 Rust/Wasm bulk buffer 원칙을 지키기 위한 것이다. TypeScript는 authoring data를
숫자형 command로 컴파일하고, Rust core가 frame update와 gameplay state mutation을 수행한다.

## Physics Authoring Facade

Authoring subpath는 Physics Spec helper도 노출한다.

| API | 계약 |
| --- | --- |
| `resolvePhysicsSpec(...)` | physics namespace를 resolved spec으로 정규화한다. |
| `compilePhysicsAuthoringDocument(...)` | editor/AI metadata를 runtime spec으로 변환한다. |
| `createRigidBody(...)`, `createCollider(...)`, `createJoint(...)` | TypeScript authoring helper다. |
| `createVehicleRig(...)` | body/joint 조합을 빠르게 만들기 위한 helper다. |
| `validatePhysicsAuthoringDocument(...)` | authoring document 구조를 검증한다. |

Physics solver와 runtime query 계약은 [Core Runtime](core.md)과
[Physics Spec](../physics-spec.md)을 기준으로 한다.


## Data Scene native runtime

`createDataSceneView`, `DataSceneView`, `DataSceneViewOptions`, `DataSceneViewSnapshot`,
`DataSceneCameraOptions`는 `/core`에서 제공한다. `CameraRigController`, `resolveCameraRigSpec`,
`clampCameraToBounds`도 `/core`에서 사용할 수 있다. `/authoring`의 `DataSceneBodySpec`은 optional
static/kinematic body와 sprite의 같은 핸들 연결을 정의한다.
[Data Scene native runtime](../data-scene-native-runtime.md)에서 정렬·원점·색 공간·카메라·좌표·조명 계약을 확인한다.

## Data Scene 표현 확장 (#68~#70, 0.1.0-beta.3)

`/core`, `/authoring`은 `DataSceneSpriteAnimationSetSpec`, `DataSceneSpriteAnimationUpdate`,
`DataSceneSpriteAnimationState`, `resolveDataSceneSpriteAnimationSet`, `DirectionalLight2D`,
`resolveDirectionalLight2D`, `DataSceneGroundShadowSpec`, `DataSceneGroundShadowStats`를 제공한다.
`FerrumEngine.configureDataSceneSpriteAnimation`, `updateDataSceneSpriteAnimations`,
`dataSceneSpriteAnimationState`, `setDataSceneGroundYScale`, `cameraGroundYScale`, `setDataSceneSun`,
`dataSceneGroundShadowStats`와 `view.setGroundYScale/setSun`의 사용법은
[애니메이션·투영·태양 그림자](../data-scene-presentation.md)에 정리했다.

#73 B2는 optional `visual.shadow.shape`에 `"alpha"`를 추가한다. width/height/opacity/layer의
기존 기본값과 instance scale 적용은 유지하며 새로운 texture나 collider 정의는 필요 없다.
ellipse/box authoring은 변경 없이 동작한다. alpha는 `0.1.0-beta.5`부터 제공한다.


## 탐험 gameplay / navigation 설정 (beta.7부터)

`SceneAuthoringDocumentSpec`의 optional `gameplay` / `navigation`과
`resolveDataSceneGameplaySpec`, `resolveDataSceneNavigationSpec`은
[Data Scene 계약](../data-scene-authoring.md)의 주인공·조사·수집·단일 평면 경로 설정을 검증한다.
`applyDataSceneAuthoringDocument`는 새 instance handle에 gameplay를 연결하고 navigation을 설치한다.
`gameplay`가 명시된 문서의 미지원 executor 및 actor/grid 오류는 activation 전에 거절한다.
`applyBuiltInSceneAuthoringDocument`는 Data Scene 전용 gameplay/navigation 필드를 거절한다.
`0.1.0-beta.7`부터 제공한다. beta.6 이하에는 이 필드만 추가해도 기능이 설치되지 않는다.

## 공간 지형·카메라·빌보드 (개발 소스)

`SceneAuthoringDocumentSpec.spatial`은 `DataSceneSpatialSpec`이다. `/authoring`은
`resolveDataSceneSpatialSpec`, `resolveSpatialCameraSpec`, `createDataSceneSpatialView`와
`SpatialCameraSpec`, `SpatialPoint`, `SpatialTerrainSurface`, `SpatialSurfaceConnection`, `SpatialBillboardSpec`,
`SpatialMoveOptions`, `SpatialMoveStats`, `SpatialRenderBufferView`, `SpatialSurfaceHit`, `FerrumSpatialApi` 타입도 제공한다.
선택 fragment의 billboard 참조와 native actor의 enabled kinematic/AABB/heightSpan 요구를 검증한다.
`applyBuiltInSceneAuthoringDocument`는 spatial을 명시 거절한다.
[공간 계약](../data-scene-spatial.md)의 WebGL2 지원 범위·저장 제한을 확인한다.
선택 `spatial.connections`는 서로 다른 floor의 walkable surface를 shared edge로 양방향 연결한다.
unknown ID/겹침/간격/모서리만 접촉/중복/모호한 연결은 activation 전에 경로 diagnostic으로 거절한다.
생략/빈 배열은 기존 연결 없음이며 연결은 authoring JSON과 함께 저장된다.
`moveDataSceneSpatialActorTo`는 runtime 목적지 요청이며 새 authoring 필드를 추가하지 않는다.
x/y/floorId/speed와 선택 cellSize/arrivalRadius/cancelOnInput을 받고 명시적 연결로 다층 경로를 탐색한다.
상태/취소/통계·예산·장애물 정지 계약은 [core 공간 API](core.md)의 대응 메서드를 따른다.
route 자체는 저장하지 않고 공간 v6의 pose만 복원한 뒤 idle로 시작한다.
`DataSceneSpatialPoseSnapshot`, `DataSceneSpatialProgressSnapshot`은 `/authoring`과 `/core`에서 제공한다.
공간 진행 v6는 native camera와 live authored billboard XY/heightSpan을 stable ID로 저장하며
일반 capture v5와 기존 v2~v5 해시/읽기를 유지한다.

선택 `spatial.environment`는 `SpatialEnvironmentSpec`이며 `resolveSpatialEnvironmentSpec`으로 검증한다.
관련 공개 타입은 `SpatialRgb`, `SpatialPointLightSpec`, `SpatialDirectionalLightSpec`, `SpatialLightingSpec`, `SpatialDepthOfFieldSpec`,
`SpatialColorGradingSpec`, `SpatialFogSpec`, `SpatialEnvironmentBufferView`다.
최대 4개 점광원과 1개 태양 방향광, hard/PCF 그림자, 고정 내부 해상도·표시 스냅, normal atlas와
개체별 cast/receive, 실제 view depth DOF·actor 초점·HDR 색 보정·안개를 작성한다.
새 품질 설정은 환경 v2 numeric112이며 기존 v1 numeric80과 저장 v7 계약을 유지한다.
field/default/range와 WebGL2 capability·caster/draw/메모리 상한은 [공간 계약](../data-scene-spatial.md)을 따른다.
runtime setter로 바꾼 효과도 native progress에 저장하며 environment 진행이 있는 capture만 v7이다.
null은 authored 효과의 해제, 생략은 authored 기본값 유지다. 기존 flat v5·공간 pose/camera v6 해시는 유지한다.
잘못된 environment는 activation 전 거절하고 native도 전체 scene/progress batch 검증 후 commit한다.

`ApplyDataSceneAuthoringDocumentOptions.spatialModelPreparer`는 선택 `SpatialModelPreparer`다.
반환 `SpatialModelPreparation`을 native 적용 전에 준비하고 성공 뒤 commit하며 finally dispose한다.
[모델 GPU 준비 계약](../data-scene-spatial.md#모델-gpu-준비-후-활성화)에 따라 실패 시 기존 씬을 보존한다.
옵션은 문서/저장 JSON에 직렬화하지 않는다.

`addSpatialModelAssembly(document, assembly)`와 `SpatialModelAssemblySpec`, `SpatialModelColliderProxy`는
정적 모델의 로컬 AABB·보행면·층 연결을 한 번의 위치/높이/90도 yaw/균일 scale로 생성한다.
결과는 기존 authoring JSON이며 입력을 변경하지 않는다. 생성 ID·지원 변환·전역 floorId·최대 개수와
runtime 이동 시 proxy가 따라가지 않는 제한은 [모델 묶음 배치 계약](../data-scene-spatial.md#정적-모델-로컬-proxy-묶음-배치)을 따른다.
선택 `children?: readonly SpatialModelAssemblySpec[]`은 부모 기준 위치·높이·cardinal yaw·균일 scale을
정적 합성한다. 자식 ID는 `parentId/children/localId`이며 root 포함 최대 64개·깊이 8을 검증한다.
생략한 기존 호출 결과와 저장 버전은 유지하며 원본 계층은 runtime/저장 데이터로 전달하지 않는다.
proxy 배열의 null·빈 칸과 f32에서 퇴화/overflow하는 월드 collider 경계·높이는 반환 전에 거절한다.
`SpatialTerrainSurface.rampAxis`는 ramp에만 허용하는 선택 X/Y 축이며 생략 기본은 Y다.

`addSpatialModelAssembly`는 `motion:"kinematic"`으로 native root와 부착 child model/collider를 생성한다.
일반 각도 collider는 OBB이며 보행면이 있는 묶음의 최종 world yaw는 90도 배수다.
움직이는 terrain/connection은 거절한다. model 옵션에 chunk/lods를 함께 작성할 수 있다.
[공간 authoring의 지원 범위](../data-scene-spatial.md)를 따른다.


### Data Scene 전투 opt-in (개발 소스)

`DataSceneGameplaySpec.combat` / `DataSceneGameplayOptions.combat`은 기본 false인 optional boolean이다.
true이면 primaryActor를 지정하고 새 combat Wasm을 사용한다. `configureDataSceneGameplay`가 원자적으로 설정한다.
`dataSceneCombatEnabled()`와 저빈도 `dataSceneCombatStats(): DataSceneCombatStats | undefined`로 실행 여부와
AI/발사/명중/사망/상한을 확인한다. 구형 Wasm의 stats는 undefined이며 authoring은 사전에 거절한다.
`supportsDataSceneInputProjectiles(): boolean`은 별도 native v1 기능을 검사한다. 이전 combat Wasm에서는
false이며 primaryActor의 input/enemies projectile 문서를 적용하기 전에 필요하다.
같은 action ID의 `setInputActionBinding`으로 pressed/down 발사를 연결한다.
`supportsDataSceneCombatActions(): boolean`은 native melee/dash v1 실행·checkpoint 기능 검사다.
primaryActor의 enemies melee/input dash와 targetPlayer dash/player melee timer를 지원한다.
타이머와 프리팹 참조·저장 검증은 같은 entity/action ID의 마지막 액션 종류를 따른다.
dash는 부착되지 않은 회전0 enabled kinematic AABB, 공간 문서는 body.heightSpan을 요구한다.
`supportsDataSceneSpawnPrefabs()`는 별도 actor catalog v1 + checkpoint codec v3/v4 + native v7 설정을 검사한다.
`supportsDataSceneCombatProgress(): boolean`은 별도 checkpoint codec v1/v2/v3/v4 지원 여부다. 전투 저장은
`includeDataSceneState`·`includeDataSceneProgress`·동일 전체 문서를 요구하며 nested v9 `progress.combat`으로 기록한다.
기존 v1/v2의 `DataSceneCombatActorSnapshot`/`DataSceneCombatProjectileSnapshot`은
고정 instance ID를 사용한다. 입력/통계/VFX와 fixed-step 잔여시간은 재설정하는 checkpoint이며 replay는 아니다.
지원 action/collision subset, 반복 timer, 공간 높이, 저장 제한은 [전투 계약](../data-scene-authoring.md#선택적-hd-2d-전투-실행-개발-소스)을 따른다.

`DataSceneSpawnPrefabSpec`/`DataSceneSpawnPrefabBinding`은 `/authoring` 및 `/core`의 공개 타입이다.
`gameplay.spawnPrefabs`는 기존 독립 instance를 원본으로 지정하고 `ids.prefabs`에 고유 positive uint32 ID를 선언한다.
입력/타이머 `spawnPrefabAction`은 원본 제거 후에도 생성하며 부착물·모델 트리 복제는 지원하지 않는다.
`DataSceneCombatProgressSnapshot`은 version으로 구분하는 기존 v1/v2와 새 `DataSceneCombatSpawnProgressSnapshot` v3 및 `DataSceneCombatVisualProgressSnapshot` v4의 union이다.
`DataSceneCombatLegacyProgressSnapshot`은 `/core`에서 기존 저장 타입을 명시할 때 사용한다.
v3 공개 타입 `DataSceneCombatActorReference`, `DataSceneCombatSpawnedActorSnapshot`, `DataSceneCombatSpawnedActorState`,
`DataSceneCombatSpawnProjectileSnapshot`은 stable instance ID 또는 spawn serial과 prefab 이름으로 저장한다.
원본 생존/제거, 상한, 지원 컴포넌트와 필드는 [생성 actor 계약](../data-scene-authoring.md#생성-actor-프리팹-개발-소스)을 따른다.

`DataSceneProjectilePrefabSpec`과 `DataSceneProjectilePrefabBinding`은 `/authoring` 및 `/core`에서 import한다.
`DataSceneGameplaySpec.projectilePrefabs`와 `projectileAction.projectilePrefab`으로 이름 기반 정적 외형을 공유한다.
`supportsDataSceneProjectilePrefabs()`는 native catalog v1 + progress v2/v3/v4를 검사한다. 새 catalog는 combat을 요구하며,
미지원 Wasm·누락 asset·잘못된 UV/크기/참조는 activation 전에 거절한다. 기본 문서와 이전 v1 저장은 유지한다.
`DataSceneGameplayOptions`의 `projectilePrefabs`/`projectileBindings`/`colorManagement`는 직접 runtime 설정에도 사용한다.
숫자 slot 대신 이름을 저장하는 checkpoint v2, collider world unit과 지원 범위는
[탄환 외형 계약](../data-scene-authoring.md#탄환-프리팹외형-개발-소스)을 따른다.


`DataSceneCombatNavigationSpec.movementPatterns?: "chase" | "all"`은 생략/`"chase"`일 때
기존 Chase 경로 소유권을 유지한다. `"all"`은 final Chase/SeekTarget/Accelerate를 함께 검증하고
`supportsDataSceneCombatMovement()`가 있는 native v6 설정으로 적용한다. 선택 crowd 회피와
전체 agent/frame 예산을 공유하며 SeekTarget의 turnRate와 Accelerate의 substep 가속 의미를 유지한다.
[이동·저장 계약](../data-scene-authoring.md#seektargetaccelerate-공간-이동-개발-소스)을 따른다.

`DataSceneProjectileAnimationSpec`은 `/authoring`·`/core`에서 import하며 선택적 `sprite.animation`에 사용한다.
1..32 UV frame·fps 0.001..1000·기본 반복 재생과 별도 `rotateToVelocity`(기본 false)를 제공한다.
`supportsDataSceneProjectileVisuals()`는 visual v1 + progress v4 + native v8 설정을 검사한다.
`DataSceneProjectileAnimationProgress`·`DataSceneCombatVisualProjectileSnapshot`·`DataSceneCombatVisualProgressSnapshot`은
같은 공개 경로의 v4 저장 타입이다. 정적 shot의 animation은 null이며 회전은 복원된 속도/카메라에서 파생한다.
[탄환 animation·회전 계약](../data-scene-authoring.md#탄환-atlas-animation이동-방향-회전-개발-소스)을 따른다.
