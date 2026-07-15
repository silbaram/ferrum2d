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
  applyDataSceneAuthoringDocument,
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

## Scene And Behavior

| API | 계약 |
| --- | --- |
| `resolveSceneAuthoringDocument(...)` | data scene authoring envelope를 검증한다. |
| `resolveSceneCompositionSpec(...)` | prefab, fragment, instance 배치를 정규화한다. |
| `instantiateSceneFragment(...)` | fragment를 deterministic instance list로 펼친다. |
| `resolveDataSceneComponentsSpec(...)` | `props.components` v1 `visual` 또는 legacy `sprite`, collider, layer, template descriptor를 검증하고 정규화한다. |
| `DATA_SCENE_PRIMITIVE_TEXTURES`, `dataSceneObjectVisualBounds(...)` | primitive visual fallback texture id와 placement/picking용 resolved visual bounds를 노출한다. |
| `applyDataSceneAuthoringDocument(...)` | scene-authoring envelope를 검증하고 Data Scene runtime target으로 spawn한 뒤 behavior recipe command를 적용한다. |
| `createDataSceneRuntimeTarget(...)` | `FerrumEngine`을 Data Scene spawn target으로 감싸 `applySceneBehaviorRecipes(...)`에 넘길 수 있게 한다. |
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

`createDataSceneRuntimeTarget(engine)`은 기본적으로 첫 번째 유효한 spawn 직전에 `engine.useDataScene()`을
한 번 호출해 빈 Data Scene runtime을 활성화한 뒤, 각
`ResolvedSceneCompositionInstance.props.components` inline descriptor를 raw Wasm
`spawn_data_scene_entity(...)`로 컴파일한다. authoring validation 실패나 target 생성만으로 기존 scene을
비우지 않는다. asset texture id는 `engine.textureId(name)` 또는 `options.textureId(name)`으로 해석한다.
consumer는 generated Wasm `pkg/*`, `dist/*`, `src/*` 내부 경로를 직접 import하지 않는다.

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
viewer 생성 시 계산한 resolved `visual.bounds` 기반 instance bounds cache로 screen coordinate 기반 instance id를 찾는다. 이 picking
경로는 pointer/click 같은 낮은 빈도 authoring interaction용이며 frame loop에 entity별 Wasm query를
추가하지 않는다.

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
`updateTransform`, `updateComponents`, `updateBehaviorBinding`, `renameInstance`, `addObjectDefinition`,
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
