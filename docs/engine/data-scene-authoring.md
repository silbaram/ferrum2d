# Data Scene Authoring Contract

상태: P2 최소 계약

이 문서는 Top-down Shooter, Breakout, Platformer 같은 built-in starter scene을 복사하지 않고도
작은 data-driven scene을 설명하기 위한 최소 authoring 계약을 정리한다. 확정 source of truth는
`packages/ferrum-web/src/sceneAuthoringDocument.ts`, `packages/ferrum-web/src/dataSceneVariables.ts`,
`packages/ferrum-web/src/sceneComposition.ts`, `packages/ferrum-web/src/dataSceneComponents.ts`,
`packages/ferrum-web/src/behaviorRecipes.ts`와 샘플 fixture다.

## 최소 문서 형식

Data Scene authoring 문서는 다음 envelope를 사용한다.

| 필드 | 필수 | 역할 |
| --- | --- | --- |
| `format` | 예 | `ferrum2d.consumer.scene-authoring` |
| `version` | 예 | 현재 `1` |
| `sceneComposition` | 예 | prefab, fragment, instance 배치를 정의한다. |
| `behaviorRecipes` | 예 | instance에 바인딩할 gameplay behavior profile을 정의한다. |
| `ids` | 아니오 | action/item/timer 같은 이름을 runtime numeric id로 고정할 때 사용한다. |
| `variables` | 아니오 | 선언된 정수·실수·불리언 값을 `global` 또는 `scene` 생존 스코프로 정의한다. |
| `spatial` | 아니오 | 개발 소스의 opt-in 입체 지형·camera·billboard·native actor와 선택 shared-edge `connections` 설정. [공간 계약](data-scene-spatial.md)을 따른다. |
| `lighting` | 아니오 | world 좌표의 flat `LightingScene2D`. 공간 문서와 동시 지정 불가. [조명 작성·patch 계약](public-api/authoring.md#2d-scene-lighting-placement-patch)을 따른다. |

최소 scene은 `sceneComposition.prefabs`, `sceneComposition.fragments`, `behaviorRecipes.entities`만으로 검증 가능해야 한다. starter scene adapter가 쓰는 `runtimeEntity`, `builtinShooterPlayer`, `builtinBreakoutPaddle` 같은 binding은 create-game 템플릿용 확장이지 최소 Data Scene 계약이 아니다.

공간 sprite의 color는 기존 `props.components.visual.texture` 문자열, normal은 선택형
`spatial.billboards[id].normalTexture` 문자열로 저장할 수 있다. numeric `normalTextureId`와 동시 지정할 수 없으며,
적용 전에 현재 texture registry에서 해석한다. 별도 생성 binding JSON에는 provenance를 보관하고
scene에는 에셋 이름·UV/animation만 넣는다. 생성 binding/combined patch/handoff는
[노멀맵 binding 계약](data-scene-spatial.md#생성-에셋-binding과-패치handoff)을 따른다.

## Object Definition And Instance

Ferrum2D authoring 문서에서 `sceneComposition.prefabs`는 재사용 가능한
`ObjectDefinition` catalog 역할을 한다. 기존 타입명 `SceneCompositionPrefabSpec`은 호환을 위해 유지하지만,
문서와 placement tool에서는 `Prefab/ObjectDefinition`을 병기한다.

`sceneComposition.fragments[].instances[]`의 각 항목은 `ObjectInstance`다. instance는 안정적인
`instance.id`, 참조할 `prefab`, transform, optional `variant`, 제한된 `props.components` override를 가진다.
공식 placement viewer가 저장하는 patch는 UI-owned transform, add/remove/rename, `props.components`
전체 교체만 수행한다. behavior recipe 본문, FSM command, gameplay sequence는 agent-owned 영역으로 남기고,
rename/remove 시에는 binding migration preview 또는 conflict diagnostic을 먼저 노출한다.

## 최소 동작 계약

- `sceneComposition.initialFragment`는 생성할 root fragment를 가리킨다.
- 각 instance는 `prefab`을 참조하고, `id`가 없으면 resolver가 deterministic id를 만든다.
- prefab/variant/instance `props.behaviorRecipes`는 `behaviorRecipes.entities`의 key를 참조한다.
- spawn 가능한 Data Scene fixture는 prefab/variant/instance merge 후 `props.components`를 가져야 하며, `resolveDataSceneComponentsSpec(...)`가 통과해야 한다.
- `resolveSceneAuthoringDocument(..., { validateBindings: true, validateComponents: true, missingBehavior: "error" })`가 통과해야 한다.
- instance가 있는 문서는 `instantiateSceneFragment(...)` 결과를 deterministic spawn list로 사용한다.
- instance가 0개인 initial fragment도 유효하다. full document apply에서는 빈 scene 전환으로 취급해 기존 runtime state를 정리한다.
- 문서 안에 장르 전용 Game Spec 필드나 built-in starter runtime entity binding을 섞지 않는다.

## Authoring Role

Data Scene은 `Actor`/`GameObject` 같은 별도 runtime class나 저장 필드를 추가하지 않는다.
authoring 도구가 구분이 필요할 때는 `classifySceneInstance(instance)`로 role을 파생한다.

- `worldObject`: `props.behaviorRecipes` 바인딩이 없는 배치 객체다. `props.components`가 있으면
  `applyDataSceneAuthoringDocument(...)` 또는 `createDataSceneRuntimeTarget(...)`으로 `World` entity는
  spawn되지만 gameplay behavior command는 생성되지 않는다.
- `actor`: `props.behaviorRecipes` 바인딩이 하나 이상 있는 객체다. spawn 뒤 해당 behavior recipe가
  `applySceneBehaviorRecipes(...)`를 통해 gameplay component command로 적용된다.

이 구분은 UI/agent 설명용 authoring helper이며 Rust `World`의 별도 저장소나 상속 구조가 아니다.

## Variables v1

`variables`는 optional 선언 배열이다. 배열이 없는 기존 v1 문서는 이전과 동일하게 통과한다.
각 이름은 문서 전체에서 한 번만 선언할 수 있으며 runtime에서 선언되지 않은 이름을 생성하거나
읽고 쓰는 것은 허용하지 않는다.

```json
{
  "variables": [
    { "name": "campaign.coins", "scope": "global", "type": "integer", "default": 0 },
    { "name": "player.speed", "scope": "global", "type": "real", "default": 1.25 },
    { "name": "wave.complete", "scope": "scene", "type": "bool", "default": false }
  ]
}
```

| 필드 | 값 | 계약 |
| --- | --- | --- |
| `name` | 비어 있지 않고 앞뒤 공백이 없는 문자열 | `global`/`scene`을 합쳐 유일해야 한다. |
| `scope` | `global` 또는 `scene` | scene apply/reapply 경계에서의 생존 여부를 정한다. |
| `type` | `integer`, `real`, `bool` | `integer`는 JavaScript safe integer, `real`은 finite number만 허용한다. |
| `default` | 선언 타입과 일치하는 값 | 최초 apply와 reset 값이다. `NaN`/무한대는 허용하지 않는다. |

`resolveSceneAuthoringDocument(...)`는 선언 배열, 필드, 기본값 타입, 중복 이름을 검증하고 선언 순서대로 `1..64` runtime slot을 만든다. `ids.variables`를 명시하면 모든 선언 이름에 고유한 `1..64` slot을 제공해야 한다.
`applyDataSceneAuthoringDocument(...)` 결과의 `variables`와
`createFerrumRuntime(...).dataScene.variables`는 `has(name)`, `get(name)`, `set(name, value)`,
`values(scope)`, `restore(scope, values)`를 제공한다. `get`/`set`/`restore`는 선언되지 않은 이름과
타입이 맞지 않는 값을 diagnostic error로 거절하며 runtime 임의 변수 생성 API는 제공하지 않는다.

생존 계약은 다음과 같다.

- 최초 문서 apply에서는 모든 변수가 `default`로 시작한다.
- `runtime.dataScene.reapply(...)`와 같은 다음 문서 apply에서 이름·타입이 같은 `global` 변수는 현재 값을 유지한다.
- 모든 `scene` 변수는 다음 문서의 `default`로 초기화한다.
- global 선언이 제거되거나 scope/type이 달라지면 이전 값은 유지하지 않고, 다음 선언이 있다면 그 `default`를 사용한다.
- 다음 문서에서도 값을 읽으려면 그 문서에 같은 이름을 다시 선언해야 한다. 현재 문서에 없는 이름은 존재하지 않는다.

이 규칙은 Issue #38의 scene/level 전환 생존 축과 공유하는 Y0 계약이다. 현재 runtime 값은 TypeScript `Map`이 아니라 Rust `World`의 고정 64-slot slab에 저장된다. `DataSceneVariableStore`는 낮은 빈도 facade로 같은 Rust slot을 읽고 쓰며, custom `FerrumEngine`을 주입하는 host는 `attachDataSceneVariableRuntimeEngineAdapter(...)`로 `clear/configure/get/set` adapter를 연결해야 한다. 변수 선언이 없는 기존 custom runtime은 adapter 없이도 호환된다.

Behavior Recipe의 `setVariable`/`incrementVariable`은 gameplay event에 반응해 Rust frame 안에서 값을 바꾼다. recipe 소유 entity가 event의 `actor` 또는 `source`와 generation까지 일치하면 trigger가 발화하므로 damage source의 명중 횟수, damage actor의 피격 횟수, collector 또는 pickup에 붙인 수집 상태를 모두 표현할 수 있다. actor와 source가 같은 event는 한 번만 적용한다. collision reaction, `interaction`, `timerTrigger`의 `guard`와 FSM의 `variableComparison` transition도 같은 numeric slot을 사용한다. 비교식은 한 개의 literal 또는 다른 변수만 RHS로 받을 수 있으며 논리식/산술식 nesting은 거절된다. Scene Authoring resolver는 변수 이름/slot 존재 여부, bool increment, literal 타입, bool ordering 비교를 runtime activation 전에 검사한다.

## `props.components` v1

`props.components`는 `SceneCompositionProps` 안의 reserved key다. `SceneCompositionProps` 자체는 계속 JSON-compatible object지만, Data Scene runtime spawn 대상은 아래 contract를 따른다.

| 필드 | 필수 | 역할 |
| --- | --- | --- |
| `visual` | `visual` 또는 `sprite` 중 하나 | `primitive` 또는 `sprite` object visual descriptor. 신규 authoring 도구는 이 필드를 우선 사용한다. |
| `sprite` | `visual` 또는 `sprite` 중 하나 | legacy sprite shorthand. `visual`이 없을 때 `visual.kind: "sprite"`로 정규화된다. |
| `collider` | 예 | `"none"` 또는 `aabb`/`circle`/`capsule`/`orientedBox`/`convexPolygon` descriptor |
| `layer` | 예 | `player`, `enemy`, `bullet`, `wall`, `pickup` 또는 layer code `0..4` |
| `template` | 아니오 | catalog template reference. 있으면 `visual`/`sprite`/`collider`/`layer`와 함께 쓰지 않는다. |

`components.visual.kind: "primitive"`는 placement tool과 agent가 이미지 asset 없이 배치할 수 있는 editor/runtime debug visual이다. v1 shape는 `rect`, `circle`, `point`이며 `width`/`height`, `radius`, `color`를 가진다. Runtime target은 primitive 의미를 resolved visual에 보존하면서 현재 WebGL2 render path에는 `DATA_SCENE_PRIMITIVE_TEXTURES.rect|circle|point` fallback sprite로 컴파일한다. 공식 host는 이 texture id들을 로드해야 한다.

`components.visual.kind: "sprite"`는 `texture` 또는 `asset` texture reference, `width`/`height`, optional `frame`, `animation`, `originX`/`originY`, `layer`, `sortOrder`, `tint`/`color`를 가진다. `components.sprite`는 기존 문서 호환용 shorthand이고 `visual`과 동시에 쓰면 resolver가 diagnostic error를 낸다.

`components.template`은 catalog reference mode이고, `components.visual` 또는 legacy `components.sprite`/`collider`/`layer`는 inline descriptor mode다. 두 mode를 섞으면 resolver가 diagnostic error를 낸다.
`createDataSceneRuntimeTarget(engine, { componentTemplates })`는 catalog template id를 inline component spec으로 해소해 spawn할 수 있다. catalog entry는 `visual` 또는 legacy `sprite`, `collider`, `layer`를 가진 inline descriptor여야 하며, nested `components.template` reference는 runtime target에서 거절된다. `componentTemplates`를 제공하지 않으면 runtime spawn 검증(`resolveSceneAuthoringDocument(..., { validateComponents: true })` 기본값 포함)에서는 `allowComponentTemplates: true`를 명시하지 않는 한 template mode를 거절한다.

`props.components`는 prefab/variant/instance merge와 placement `updateComponents` patch에서 하나의 component set으로 취급한다. 일반 `props` 값은 기존처럼 JSON object merge를 사용할 수 있지만, `components` 내부만 부분 deep merge하지 않고 전체 교체한다. 이 정책은 legacy `components.sprite`와 신규 `components.visual`이 동시에 남거나 collider/layer 일부만 stale 값으로 유지되는 authoring 충돌을 막기 위한 것이다. 공식 placement viewer의 Visual/Collider/Layer inspector도 이 계약에 맞춰 selected instance의 `props.components` 전체를 낮은 빈도 draft patch로 교체하고, runtime entity를 직접 수정하지 않는다.

`SceneComposition`의 instance `x`/`y`/`scale`/`rotationRadians`/`layer`는 default Data Scene runtime target이 반영한다. instance `rotationRadians`는 visible sprite rotation으로 `SpriteRenderCommand`에 기록되고 collider runtime geometry에도 합성된다. 예를 들어 rotated AABB는 oriented-box collider로 컴파일되고, collider offset/capsule endpoint는 instance rotation을 반영해 회전된다. render layer는 `visual.layer ?? instance.layer`를 사용하고 Data Scene entity render band 안에서 `1000 + layer` sort key로 저장되어 같은 Data Scene entity끼리 render 순서를 정한다. `components.layer`는 collision layer이며 render/sort layer가 아니다.

### 2D 레이어 관리

공식 뷰어의 씬 도크 **그리기 레이어**는 실제 `visual.layer ?? instance.layer`를 기준으로 객체 수와 선택 상태를 표시한다. 위쪽 행이 앞 레이어이며 숫자가 클수록 앞에 그린다. 행을 선택하면 씬 목록을 필터링하고, **레이어 선택**은 그 레이어 객체들을 선택한다. **선택 객체 이동**은 선택 객체를 해당 레이어로 옮긴다. 앞/뒤 버튼과 행 드래그는 두 레이어의 객체들을 서로의 숫자 레이어로 교환하며 한 번의 Undo로 되돌린다. 개별 잠금 객체가 섞였거나 숨김·잠금 레이어를 대상으로 하면 전체 변경을 거부한다.

레이어 값은 정수 `[-2147483648, 2147482647]`이다. 이동은 기존 transform/components patch를 사용하며 명시적 `visual.layer` override가 있으면 함께 바꾼다. Collider·충돌 그룹·body·animation·shadow 설정은 유지한다. **속성 → 변형**의 **그리기 레이어**도 같은 기준으로 동작한다. 스프라이트의 **레이어 내 순서**는 `sortOrder`, **발 위치 정렬**은 `depthSort`를 편집한다. 발 위치 정렬이 켜지면 같은 레이어 안에서 floor/elevation/발 위치가 먼저 적용되고 같은 깊이에서 `sortOrder`로 순서를 정한다.

눈 아이콘은 2D 편집 화면에서 스프라이트와 소유 그림자를 숨기며 피킹·범위 선택에서도 제외한다. **이 레이어만 표시**를 다시 누르면 그전 숨김 상태로 복원한다. 편집 잠금은 레이어의 새 객체에도 적용하고 개별 객체 잠금과 독립적이다. **레이어 잠금 해제**는 개별 잠금을 풀지 않는다. **전체 표시**는 숨김만 해제한다. 숨김·레이어 잠금은 탭과 저장 rebase 동안 유지하는 UI 상태이며 초안·Undo·게임 JSON·collider·simulation을 바꾸지 않는다. HD-2D/게임 미리보기에서는 2D 정책을 일시 중단하고 2D 편집 복귀 시 복원한다.

단독 보기 중 새 숫자 레이어를 추가해도 선택한 레이어만 표시하며 Undo 후에도 일관되게 유지한다. 단독 표시한 레이어 자체가 사라지면 그전 숨김 상태로 복원한다. 단독 보기의 복원 상태와 목록에서 선택한 레이어는 저장 rebase에서도 유지한다. HD-2D의 지형/레이어 목록 필터는 2D로 돌아올 때 2D 패널의 레이어 선택으로 복원한다.

숨김·잠금 적용 도중 preview 오류가 발생하면 이전 레이어 정책과 객체 선택·hover를 함께 복원한다. 피킹 정렬은 Rust 렌더러와 같은 f32 정밀도를 사용하므로, native에서 같은 값이 되는 미세한 소수 차이로 뒤 객체를 잘못 고르지 않는다.

별칭은 **레이어 번호의 로컬 이름표**다. 같은 source 문서 경로를 기준으로 이 브라우저/앱의 local storage에만 보관하며 게임 JSON에는 포함하지 않는다. 새 영구 layer ID나 이름 기반 런타임 레이어를 만드는 기능은 아니다. 파일을 공유할 때는 기존 숫자 레이어가 기준이다.

UI 구성은 [Godot의 z-index/Y-sort](https://docs.godotengine.org/en/stable/classes/class_canvasitem.html), [Unity의 Sorting Layer/Order in Layer](https://docs.unity3d.com/Manual/2d-renderer-sorting.html), [Tiled의 눈·잠금 레이어 목록](https://docs.mapeditor.org/en/stable/manual/layers/)을 참고했다. Ferrum2D는 기존 numeric layer/patch 계약을 유지하며 이 authoring 보조 범위에 적용한다.

## Tiled/LDtk 타일 프레임 Assets

공식 app의 **Import Tile Frames**는 기존 public `starter-scenes`의 `importTiledTilemap`/`importLDtkTilemap`을 사용한다.
map/project JSON에서 tileset을 이름으로 고르고 해당 PNG 1개를 명시적으로 선택하며 metadata의 경로를 자동 fetch하지 않는다.
등록된 used tile frames는 일반 sprite asset provider의 이름/UV/크기/thumbnail이 되어 기존 2D/HD-2D 배치에서 사용할 수 있다.
tile painting이나 전체 map/level/collision/LDtk entity의 Data Scene 자동 적용 기능은 아니다.

지원 입력은 finite orthogonal Tiled JSON의 embedded 또는 명시적으로 선택한 외부 TSJ tileset과 비압축 `data` 배열, LDtk embedded level의
Tiles/AutoLayer 및 entity metadata다. 원본에 tileset 1..8개를 허용하고 한 import는 선택 tileset 1개/PNG 1개를 소유한다. LDtk Level Index는 0부터 시작한다.
외부 TSX·LDtk external level, IntGrid, flipped/rotated tile은 진단 후 거절한다.
map + TSJ 원본 JSON 합계 1 MiB, PNG 16 MiB·한 변 4096·4 megapixel, used frame 1..256, 최대 16 layer·전체 65,536 grid cell을 제한한다.
LDtk level 목록은 최대 64개, 원본 Tiled group nesting 한도는 8이다. 다중 tileset 선택에서는 public importer가 변환하지 않는 group layer를 먼저 평탄화하도록 진단한다. PNG header/실제 decode 크기, 원본 SHA-256,
tileset 이미지 파일명/크기와 frame의 정수 pixel rect를 확인한 뒤 등록한다.

다중 tileset은 **Tileset** 목록에서 이름과 이미지 파일명을 확인해 선택한다. metadata의 이미지 경로를 자동 fetch하지 않는다.
Tiled의 선택 key는 `tiled:<name>`, LDtk는 `ldtk:<uid>`이며 중복 key는 거절한다. 선택한 이미지의 파일명/크기만 PNG와 대응시킨다.
원본 JSON bytes는 그대로 보존하고 public importer에만 선택 범위로 투영한 입력을 전달한다.
Tiled는 다른 tileset의 cell을 0으로, LDtk는 다른 tileset layer의 tile 배열을 빈 배열로 바꾼다.
LDtk entity metadata와 원본 layer 순서는 유지한다. **변환 map은 선택한 tileset의 부분 결과**이며 전체 원본 map을 뜻하지 않는다.
선택한 이름·원본 tileset 수·제외한 tile instance 수를 화면과 `selection` evidence에 표시한다.
지원하지 않는 TSX·flip/회전과 모호한 Tiled GID/LDtk UID는 제외 범위에서도 진단한다.
여러 tileset을 각각 가져올 때는 논리 asset 이름을 구분해 재가져오기 그룹을 유지한다.

외부 Tiled tileset은 **External TSJ Files**에서 map이 참조하는 `.tsj`를 모두 명시적으로 선택한다(최대 8개).
`../tiles/terrain.tsj`처럼 상대 참조를 허용하며 파일의 basename을 대소문자까지 일치시켜 연결한다.
서로 다른 참조가 같은 basename을 쓰거나 참조/파일이 중복·누락·추가된 경우 거절한다. 폴더 경로는 파일 접근 권한이 아니며 자동 filesystem/network 읽기를 하지 않는다.
절대 경로·URL·TSX·중첩 외부 TSJ는 지원하지 않는다. map·TSJ 원본 bytes는 수정하지 않고 검사 시에만 embedded 형태로 해석한다.
선택한 PNG는 TSJ 내부 image의 basename/크기와 검증하며, 다른 tileset의 PNG는 선택할 필요가 없다.

내용/문서/포맷/선택 level·다중 tileset 선택 key와 외부 TSJ의 source별 SHA-256을 포함한 immutable revision 이름 `tile.<tiled|ldtk>.<logicalName>.<digest>`를 쓴다.
**Register**는 catalog/GPU만 바꾸며 **Apply Frame**은 선택한 unlocked sprite에 texture/UV를 적용한다.
**Reimport**는 같은 포맷·논리 이름의 이전 revision을 쓰는 활성 fragment만 처리한다.
기존 UV를 이전 frame 이름에 유일하게 대응시킨 뒤 새 원본의 같은 이름을 찾는다. Tiled firstgid나 LDtk 내부 game tile 순서에 의존하지 않는다.
Tiled tileset 이름 또는 LDtk tileset UID/level IID(없으면 identifier)가 달라지면 batch migration을 거부한다.
누락/모호한 frame, animated/legacy sprite, normal binding, 잠긴 대상도 거부한다. 변경은 기존 placement v2 `updateComponents` patch의 한 Undo/Redo transaction이다.
pose/size/pivot/collider/body/layer/behavior와 spatial 설정은 유지한다. 마지막 문서/선택/잠금 검사와 실패/취소 rollback도 적용한다.

app 전용 export `ferrum2d.tile-import.assets` v1은 `overwrite:false`, 문서 key, `revisions`, `manifest`, `files`,
현재 `sceneDocument`와 선택형 `patch`를 담는다. revision에는 포맷/lineage/선택 level·원본 이름/hash·frame rect와
기존 importer의 `imported` 결과(atlas/tilemap·LDtk entities)가 있다. 다중 tileset revision의 `tilesetKey`와 `selection`(key/name/sourceTilesets/omittedTileInstances)은 부분 변환 범위를 명시한다. `files`는 generated asset 이름의 map JSON/PNG와 선택형 `<revision>.dep.<index>.tsj` 원본 bytes·SHA-256이다. 외부 revision의 `dependencies[]`에는 source/name/sha256을 담고 source의 UTF-16 순서로 정렬한다.
manifest의 texture URL은 bundle 기준 상대 경로이며 color=`srgb`를 명시한다.
현재 씬의 참조와 일치하는 source evidence는 app handoff의 `tileImports[]`로 전달한다. engine handoff/schema/public API는 바꾸지 않는다.

원본 세션 예산은 staged/등록 revision 총 8건·64 MiB다. Undo/다른 fragment에 필요한 이전 revision은 유지한다.
문서/모드 전환은 진행 작업을 취소하고 문서 닫기/종료는 그 문서의 소유 URL/texture를 해제한다.
브라우저의 미설치 참조는 scene Save를 막는다. native Open Project의 기본 문서는 아래 Save Project 경로를 사용하고,
그 밖의 host/문서는 agent가 export의 hash·manifest와 동반 scene/patch를 확인해 프로젝트에 설치한다.

### 타일 자산의 native 저장·재열기

명시적으로 **Open Project**한 기본 문서에서 **Import Tile Frames → Save Project**를 누르면
`public/assets/.ferrum-tiles/`에 원본 `<revision>.json`·`<revision>.png`와 외부 TSJ의 `<revision>.dep.<index>.tsj`를 보존한다.
`catalog.json`은 app 전용 `ferrum2d.tile-import.catalog` v1이며 원본 identity/hash/크기/선택 level과 선택형 `tilesetKey`/`dependencies`(source/name/sha256), 상대 manifest만 저장한다.
변환 map/frames/lineage는 catalog에 저장하지 않고 재열기 때 public importer로 원본에서 다시 계산한다.
`identityDocument`는 최초 import 문서 key를 유지하므로 재열기나 unchanged 재검사로 revision이 중복되지 않는다.
기존 단일 tileset의 ID 계산과 key 없는 v1 catalog는 유지한다. 다중 선택에서는 hash 입력에 선택 key를 추가하고 외부 TSJ가 있으면 정렬한 source/hash 목록을 추가한다. map/PNG가 같아도 TSJ bytes 변경은 새 revision이다. 재열기 때 key로 tileset을 다시 찾아 선택과 scope를 복원한다.

host의 `load_placement_tile_assets`/`save_placement_tile_assets`는 승인된 프로젝트에만 접근한다.
map + TSJ JSON 합계 1 MiB/PNG 16 MiB·실제 decode·bounded map shape·SHA-256·revision ID를 확인하고,
파일 exclusive create·기존 byte 일치·catalog 교체 전 비교·symlink 거절·자신이 만든 파일만 rollback을 적용한다.
Aseprite와 공유하는 native sprite storage의 8 revision·원본 합계 64 MiB 제한을 tile catalog에도 적용한다.
반환값은 `ferrum2d.tile-import.project` v1과 revision이 지정된 protocol URL이다.
반환 자산의 선택형 `dependencies[]`는 source와 revision이 지정된 jsonUrl을 제공한다. frontend가 실제 map·TSJ·PNG를 다시 읽어 기존 importer의 전체 지원 계약을 재검증한 뒤 `persisted`를 표시하고 scene CAS 저장을 호출한다.
원본 자산은 scene 적용 전에 preload되며 앱 handoff `tileImports`에 재계산한 frame/source 근거를 남긴다.

Cancel·탭/모드 전환·잘못된 응답은 뒤따르는 씬 저장을 막는다. native 쓰기가 이미 끝났다면 원본 파일은 남을 수 있으며 retry는 idempotent다.
씬이 외부에서 바뀌면 scene CAS는 그 변경을 보존하고 검증된 원본 자산은 유지한다.
다른 종류의 미저장 Aseprite/normal 자산이 함께 있으면 해당 도구에서 먼저 저장해야 한다.
이 경로는 전체 project transaction이나 OS 외부 writer를 잠그는 기능은 아니다. 일반 scene-only 열기와 추가 탭에는 project 자산 쓰기 권한을 추가하지 않는다.
기존 standalone importer가 지원하는 더 넓은 입력 옵션은 이 app의 초기 UI 지원 범위와 구분한다.

## Aseprite Assets 가져오기·재import

공식 Placement Viewer는 기존 `importAsepriteAtlas`를 사용해 Aseprite JSON+PNG를 Assets catalog에 연결한다.
`Inspect`는 PNG 서명·실제 decode 크기·SHA-256과 metadata/frame rect를 확인하며 씬을 바꾸지 않는다.
`Register`는 문서 세션에 atlas/frame을 등록한다. `Apply Frame`과 `Reimport`는 기존 `updateComponents` patch를
한 번의 Undo transaction으로 적용하며, 작성한 size/pivot/transform/collider/body/behavior는 유지한다.

공식 UI의 첫 지원 범위는 비회전·비트림 정수 rect, 1~256 frame이다. frame ID는 확장자까지 유지한다.
JSON hash/array 형식을 받으며 `meta.image` basename과 선택 PNG 파일명을 대조한다. 외부 파일/URL을 자동으로 읽지 않는다.
frameTags/duration은 아래 명시적 animation import/migration으로 연결한다.
일반 Apply Frame/Reimport는 animated/legacy sprite 교체를 거절한다. normal binding이 있는 대상의 일반 Apply Frame/Reimport는 차단하고,
정적 대상은 Generate Normals/Reimport Normals, 애니메이션 대상은 Apply Paired/Reimport Paired로 color/UV와 노멀을 함께 교체한다.
이는 app 정책이며 기존 standalone importer의 옵션/정규화 동작을 변경하지 않는다.

재import는 활성 fragment가 참조하는 이전 revision의 UV를 frame 이름에 대응시킨 뒤 새 UV로 교체한다.
누락되거나 동일 UV의 이름이 여러 개라 모호하면 해당 인스턴스를 진단하고 갱신을 막는다.
`Apply Frame`으로 프레임을 명시할 수 있다. 다른 fragment·Undo/Redo의 이전 revision은 유지한다.
revision별 내용 기반 texture 이름으로 새 이미지를 별도 업로드하므로 실패/취소가 이전 GPU 이미지를 덮어쓰지 않는다.
잠금/문서/선택 변경은 적용 직전에 다시 확인한다. 문서 전환·Game Preview 진입은 진행 작업을 취소한다.

JSON 1 MiB, PNG 16 MiB·한 변 4096/4 megapixel, session revision 합계 8건/64 MiB 상한이다.
문서 닫기/종료에서 Blob URL·GPU texture를 해제한다. 2D 작성 overlay와 HD-2D preview를 재사용하며 실제 2D native 결과는 Game Preview에서 확인한다.

app 전용 `asepriteImports[]` handoff 확장은 현재 씬이 참조하는 논리 asset 이름·revision ID·원본명·hash·frame을 제공한다.
engine `ScenePlacementAgentHandoff` 반환 계약과 scene JSON schema에 이 필드를 추가하지 않는다.
`Export Assets`의 `ferrum2d.aseprite.assets` v1 bundle은 문서 키·revisions·manifest·원본 JSON/PNG files를 담는다.
파일별 base64/SHA-256을 검증하고 프로젝트 안에 `overwrite:false`로 설치한 뒤, manifest의 stable 이름과 `srgb`를 catalog에 등록한다.
동반 Copy Patch/handoff를 씬에 반영하고 새 세션에서 catalog를 먼저 로드해 다시 연다. bundle 자체에는 씬 JSON이 없다.
설치 전 imported reference의 scene-only Save와 문서 간 복사를 막으며, export를 실제 저장 완료로 간주하지 않는다.
세부 UI 절차는 저장소의 `apps/placement-viewer/README.md`를 따른다. browser-only 파일 쓰기와 백그라운드 normal 자동 재생성은 제공하지 않는다.

### Aseprite 애니메이션 import와 migration

`Inspect` 후 Preview의 **Aseprite initial animation**과 **Aseprite loop new clips**를 선택하고
**Apply Animation**을 누르면 선택한 unlocked 정적 sprite에 모든 태그를 `visual.animationSet`으로 연결한다.
같은 논리 atlas의 기존 animationSet에 적용할 때는 기존 clip ID·initialClip·loop를 유지하며 새 clip에만 loop 설정을 적용한다.
Apply Frame은 정적 교체이고 이 action은 명시적 애니메이션 변환이다. timeline/클립 본문 편집은 제공하지 않는다.

- `meta.frameTags` 1..64개, 고유한 비어 있지 않은 이름(최대 256자), 유효한 from/to 인덱스를 요구한다.
- `forward`, `reverse`, `pingpong`, `pingpong_reverse`를 지원한다. pingpong은 양 끝을 중복하지 않는 한 주기로 펼친다.
- frame 인덱스는 원본 JSON의 array/hash 순서를 따른다. 태그에 포함된 frame의 duration은 양의 uint32 정수 ms다.
- duration의 정수 GCD를 tick으로 삼아 UV를 반복한다. 예: 90ms/180ms는 90ms tick 3개가 된다.
  기존 native clip의 32 frame·FPS 0.001..1000 제한을 넘으면 근사하지 않고 거절한다.
- native FPS는 float32이므로 미세한 시간 오차가 있다. evidence의 sourceCycleMs/nativeFps/nativeCycleMs/nativeCycleErrorMs로 공개한다.
- Aseprite의 유한 repeat 횟수는 native loop boolean으로 보존할 수 없으므로 거절한다. repeat 생략/0/문자열 `"0"`만 허용하며
  loop 여부는 UI에서 명시한다. [원본 repeat 의미](https://www.aseprite.org/api/tag#tagrepeats)와 native loop는 다른 계약이다.

**Reimport Animation**은 활성 fragment의 같은 논리 atlas에 연결된 이전 animated revision만 갱신한다.
기존 원본의 UV 순서/FPS와 씬의 clip을 대응시켜 태그 이름을 유일하게 식별한 뒤 새 원본으로 바꾼다.
태그 순서 변경·추가에도 기존 numeric ID·initialClip·loop는 유지하며 새 태그는 사용하지 않는 가장 작은 ID를 받는다.
기존 태그 누락/이름 변경, 동일 UV/timing 태그의 모호함, 원본과 대응하지 않는 수동 수정 clip, legacy animation, 잠긴 대상은 거절한다.
정적 대상은 기존 Reimport를 사용한다. pose/size/pivot/collider/body/behavior는 보존하고 전체 변경은 한 Undo/Redo transaction이다.

애니메이션 원본은 기존 JSON/PNG bytes로 저장하고 씬에는 기존 animationSet만 저장한다. 새 runtime/schema/native catalog version은 없다.
Save Project 후 재열기에서도 원본과 씬으로 연결을 다시 확인하므로 세션 메모리의 이름 매핑에 의존하지 않는다.
app handoff의 `asepriteImports[].animations[]`와 Export Assets의 `animations[]`는 현재 활성 fragment의 검증된
tag 이름/clip ID·source duration·native timing 근거다. 수동 수정/모호한 clip에는 import provenance를 주장하지 않는다.
bundle과 동반 patch를 함께 설치하는 기존 규칙은 유지한다.

normalTexture/유효한 normalTextureId가 연결된 대상의 일반 Apply Animation/Reimport Animation은 차단한다.
노멀을 함께 재생성하려면 아래 Apply Paired/Reimport Paired를 사용한다.
지원하지 않는 animation 메타데이터가 있어도 정적 Inspect/Register/Apply Frame은 기존 제한 안에서 사용할 수 있다.

### Aseprite 노멀 재생성

HD-2D의 Generate Normals는 선택한 unlocked billboard의 선택 frame을, Reimport Normals는 활성 fragment의 이전 atlas 참조들을 처리한다.
기존 Normal tool의 수치 설정으로 각 Aseprite rect를 독립 생성하고 원래 위치에 RGBA8 바이트로 합성한다.
투명 RGB·원본 color PNG·frame UV·작성한 visual 크기/pivot·pose/collider/body/billboard 설정을 유지한다.
완전히 같은 rect는 공유하지만 서로 다른 rect가 겹치면 거절한다. Generate Normals/Reimport Normals는 정적 frame용이다.
combined placement v3/spatial v4 patch를 한 Undo로 적용하고, 실패/취소와 마지막 lock/문서 검사 실패는 기존 씬을 유지한다.
정상 생성도 project 파일 저장을 뜻하지 않는다. Aseprite 노멀은 별도 8 revision/64 MiB/8,388,608 pixel 예산을 사용한다.

**Apply Paired**는 선택 HD-2D billboard에 모든 frameTag 애니메이션과 생성 노멀을 함께 적용한다.
**Reimport Paired**는 활성 fragment에서 같은 논리 atlas 이름의 이전 animated revision을 모두 migration한다.
위 animation migration과 같은 태그 대응·numeric ID·initialClip·loop 보존 규칙을 따르며 정적 대상은 포함하지 않는다.
Preview의 시작 태그/loop는 새 애니메이션·새 clip에만 적용한다. 기존 애니메이션의 시작 clip과 loop는 보존한다.
모든 대상의 billboard·잠금·태그 대응과 clip 전체의 최대 **32 unique UV**를 생성 전에 확인한다.
각 clip의 GCD 반복 frame은 같은 layout 항목을 공유하며 32 unique UV를 넘으면 근사하지 않고 거부한다.
실제 rect별 Worker 생성과 GPU upload 후에도 문서·선택·잠금을 다시 확인하고 combined patch를 한 번 적용한다.
한 Undo/Redo로 color/animation/normal 참조를 함께 복원하며 취소·실패 시 provisional texture만 해제한다.

paired `normalBindings[].binding`에는 현재 animationSet과 중복을 제거한 UV layout이 포함된다.
`normalAssets[].binding`은 합성 atlas 전체의 생성 근거이며 instance의 시작 clip/layout은 동반 씬과 normalBindings에 있다.
native 저장 format은 바꾸지 않는다. 재열기 시 실제 PNG/report를 검증한 뒤 현재 씬의 모든 animation UV가
report의 생성 rect와 일치할 때만 instance binding evidence를 복원한다. 알 수 없는 UV/잘못된 초기 frame에는 근거를 주장하지 않는다.

Aseprite export v1의 optional `normalAssets[]`는 기존 sprite-normal assets v1 bundle이며 원본 color PNG와 합성 normal PNG를 담는다.
report는 app 전용 `ferrum2d.aseprite-normal.report` v1로 원본 hash·설정·rect별 실제 Worker report·합성 hash를 포함한다.
`report.config.sha256`은 config 필드 추가 전 report JSON의 SHA-256이며 binding의 generation.configSha256과 같다.
`normalBindings[]`에는 현재 씬과 일치하는 instance별 binding만 보관한다. 이전 이력의 texture/provenance는 세션에 유지하며 stale evidence는 export에서 제외한다.
report 종류를 기존 단일 Worker report로 해석하지 않는다. agent는 합성 report와 각 frame report·파일 hash를 확인하고,
normal manifest를 `none`, color manifest를 `srgb`로 등록한 뒤 동반 patch/handoff를 반영한다.

Save Normals와 Save Project의 normal 저장은 normal asset host가 파일/catalog 등록을 완료하고 durable URL의 실제 bytes를 검증해야 한다.
기본 Tauri project host는 아래 노멀 catalog 저장·복원을 제공한다. browser-only/custom host에서 저장 기능이 없으면 export/agent 설치가 필요하며 미설치 normal 참조의 scene Save는 차단한다.
브라우저 PNG 수치 합성에는 CompressionStream/DecompressionStream이 필요하다. engine public API/scene schema·native ABI는 추가하지 않는다.

### 생성 노멀의 native 프로젝트 저장·재열기

명시적으로 **Open Project**로 연 기본 프로젝트 문서에는 기본 `PlacementNormalAssetHost.saveAssets`를 제공한다.
기존 Normal tool의 **Save Assets**, Aseprite의 **Save Normals**가 같은 writer를 사용한다.
Aseprite **Save Project**는 참조 중인 미저장 Aseprite 노멀을 먼저 저장·검증한 뒤 원본/catalog와 씬을 저장한다.
Normal tool에서 만든 pair는 Save Assets를 실행한 뒤 씬을 저장한다. custom `ferrumPlacementNormalAssetHost`를 지정하면 그 host가 우선한다.

- `load_placement_normal_assets`/`save_placement_normal_assets`는 이미 연 project root 안에서만 작동한다.
  직접 연 임의 scene 파일이나 다른 문서 탭에는 기본 normal 파일 저장 권한을 확장하지 않는다.
- `public/assets/.ferrum-normals/normal-<PNG SHA-256>.png`, `<metadata SHA-256>.json`을 독점 생성한다.
  같은 bytes는 재사용하고 다른 bytes·symlink를 덮어쓰지 않는다. metadata는 기존 assets v1 bundle의 files를 빈 배열로 만든 원문 JSON이다.
  원문 key 순서와 `metadataJson`/animation descriptor를 보존해 재열기 후 provenance 해시가 바뀌지 않는다.
- 별도 `catalog.json`은 app 전용 `ferrum2d.sprite-normal.catalog` v1이다. `entries`는 metadata SHA-256 배열이고
  `manifest.textures`는 catalog URL 기준 상대 PNG 경로다. color=`srgb`, normal=`none`을 명시한다.
  이 manifest를 Aseprite manifest와 함께 `loadAssets`에 넘기면 일반 게임에서도 같은 texture 이름을 사용할 수 있다.
- native는 PNG decode·SHA-256·dimensions·binding/manifest와 report 참조를 확인한다. app은 추가로 기존 binding resolver와
  report/descriptor 재구성, Aseprite aggregate config 해시를 확인한다. 저장 완료는 native 등록과 durable URL의 실제 bytes를 다시 검사한 뒤에만 인정한다.
- 파일 준비와 catalog publication을 host 안에서 직렬화하고, 교체 직전 외부 catalog 변경을 다시 검사한다.
  실패 시 식별 가능한 이번 작업의 미확정 파일만 정리한다. 외부 writer 전체를 잠그는 filesystem transaction은 아니다.
  Cancel/문서 전환은 늦은 UI 성공과 후속 씬 저장을 막지만 이미 확정한 파일 transaction은 완료될 수 있다.
- 프로젝트 한도는 8 pair revision, 전체 pair의 color+normal PNG 합계 64 MiB, decoded color+normal 합계 8,388,608 pixel이다.
  PNG 한 파일은 16 MiB/4 MP 이하, metadata 한 파일은 4 MiB다. catalog 자동 삭제/정리는 제공하지 않는다.
  문서 닫기는 메모리/GPU 자원만 해제하고 디스크 catalog를 줄이지 않는다.

새 실행은 catalog/metadata/PNG를 다시 검증하고 **씬 적용 전에** 로드한다. Aseprite 원본 catalog와 color ID를 공유하면
hash·색 공간이 일치할 때 GPU texture를 공유하며 새 normal texture만 별도로 소유한다.
Assets 색상 항목과 현재 씬에 맞는 normal binding evidence를 복원하고, Aseprite Export Assets에도 참조 중인 저장 pair를 포함한다.
수동 변경된 clip/UV에는 stale generation evidence를 붙이지 않는다. 이 근거는 scene/fragment 변경 시 갱신하며 선택·hover만으로 재구성하지 않는다.
원본 GIF/APNG 입력과 생성 도구의 파일 선택/설정 폼 전체를 복원하는 기능은 아니다. 생성한 PNG pair·report·animationSet/descriptor를 보존한다.
optional 생성기가 없어도 저장한 PNG를 재생할 수 있다. 새 노멀 생성에는 계속 별도의 생성기 설치/manifest가 필요하다.

### Aseprite 프로젝트 저장과 runtime 로딩

Tauri에서 `Open Project`로 연 기본 프로젝트 문서의 `Save Project`는 원본 파일·catalog/manifest를 먼저 확정한 뒤
기존 씬 저장의 기준 JSON 비교를 실행한다. 쓰기는 승인된 프로젝트의 `public/assets/.ferrum-aseprite/`에 한정한다.
원본명/path를 저장 경로로 해석하지 않고 content revision ID로 PNG/JSON 파일명을 만든다.
SHA-256·PNG decode·frame rect/UV·sRGB를 host/app 양쪽에서 확인한다. 파일 충돌·symlink·catalog 외부 변경은 거절한다.
씬 저장 실패 시 외부 scene은 유지하고 이미 확정한 immutable 에셋은 다음 재시도에 사용한다.
Cancel은 후속 씬 저장과 오래된 UI 적용을 차단하지만 이미 시작한 native transaction은 완료될 수 있다.

`catalog.json`은 app 전용 `ferrum2d.aseprite.catalog` v1이다. `revisions[]`에 원본명/hash/frame과 ID 생성에 쓴
`identityDocument`를 보존하며, `manifest.textures`의 PNG 경로는 **catalog URL 기준 상대 경로**다.
`manifest.textureOptions`는 `srgb`를 명시한다. 원본 Aseprite JSON의 `meta.image`는 바꾸지 않는다.
기존 export v1에 identityDocument가 없으면 native import는 bundle.document에서 이를 복원한다.
프로젝트 재개방 시 원본을 검증·로드하고 frame browser/재import를 복원한다. handoff의 `persisted`는 실제 파일 확인 뒤 true가 된다.
첫 catalog 예산은 8 revision/원본 64 MiB이며 자동 정리하지 않는다. 문서 간 참조 정책과 session 예산은 유지한다.

게임은 저장 catalog의 manifest를 로드한 뒤 씬을 적용한다. 생성 프로젝트의 기존 runtime bootstrap을 자동 수정하지 않는다.

```ts
const catalogUrl = new URL("assets/.ferrum-aseprite/catalog.json", location.href);
const catalog = await (await fetch(catalogUrl)).json();
await engine.loadAssets({
  textures: Object.fromEntries(Object.entries(catalog.manifest.textures)
    .map(([id, path]) => [id, new URL(path as string, catalogUrl).href])),
  textureOptions: catalog.manifest.textureOptions,
});
// 그 뒤 기존 applyDataSceneAuthoringDocument(engine, scene)를 실행한다.
```

이 catalog는 authoring 부가 데이터다. Data Scene JSON schema·Rust render ABI·engine public API를 확장하지 않는다.

## Runtime Spawn Hook

Rust/Wasm에는 낮은 빈도 scene load/apply 전용 raw hook인 `Engine::spawn_data_scene_entity(...)`가 있다. 이 hook은 Data Scene mode에서만 inline sprite, optional horizontal animation, collider shape, layer를 `World` entity로 설치하고, 성공 후 `data_scene_entity_id()`/`data_scene_entity_generation()`으로 최신 handle을 노출한다.

package-facing full document apply helper는 `applyDataSceneAuthoringDocument(engine, document, options?)`다.
이 helper는 `resolveSceneAuthoringDocument(...)`를 `validateBindings: true`,
`validateComponents: true` 기본값으로 실행하고, 검증이 끝난 문서를 `createDataSceneRuntimeTarget(...)`과
`applySceneBehaviorRecipes(...)`로 연결한다. 문서의 `ids`는 behavior command id 해석에 사용하며,
`options.ids`가 있으면 caller override를 우선한다. `componentTemplates`를 넘기면
`allowComponentTemplates`도 기본 활성화된다. 검증 실패는 runtime activation 전에 발생하므로 기존
built-in/data scene state를 reset하지 않는다.

package-facing default `spawnSceneInstance` target은 `createDataSceneRuntimeTarget(engine, options?)`가 제공한다. 기본값은 첫 번째 유효한 spawn 직전에 한 번 `engine.useDataScene()`을 호출한다. full `applyDataSceneAuthoringDocument(...)`는 spawn 결과가 0개여도 validation 성공 뒤 `useDataScene()`을 호출하므로 빈 문서도 실제 cleanup/reset 전환이다. full apply는 Rust variable slot을 guarded recipe보다 먼저 구성하며, 이후 spawn/recipe apply가 실패하면 이전 변수 declaration/slot/current value를 복원한다. authoring validation 실패나 target 생성만으로 기존 scene을 비우지 않으며, 이 자동 활성화가 싫으면 `activateDataScene: false`를 넘긴다. consumer 코드는 generated Wasm `pkg/*`나 `@ferrum2d/ferrum-web/src/*` 내부 경로를 직접 import하지 않는다.

`createFerrumRuntime({ dataScene })`은 같은 document apply helper를 startup 단계에 연결한다.
`dataScene` 값은 문서 자체이거나 `{ document, ...applyOptions }` object일 수 있다.
runtime은 적용 결과를 `runtime.dataScene.result`로 노출한다. 같은 handle의 필수 문서 인자
`transition(document, options?)`는 A→B scene/level 전환을, `reapply(document?, options?)`는 현재 문서의
낮은 빈도 reload를 표현한다. `transition(...)`은 startup option이 `activateDataScene: false`였더라도
activation/reset을 강제하며 per-call option에서는 `activateDataScene`을 받지 않는다. `reapply(...)`는
기존 low-level opt-out 호환을 위해 이 option을 유지한다. 두 method 모두
`applyDataSceneAuthoringDocument(...)`와 같은 validation/spawn/binding 경로를 사용한다. resolver 단계에서
실패하면 현재 document/result/variable store를 교체하지 않으며, 이후 인자 없는 `reapply()`는 마지막으로
성공한 문서를 다시 사용한다.

## Scene/Level Flow v1

Data Scene lifecycle은 Rust가 소유하는 고정 상태 집합이다. 임의 문자열 상태나 runtime scene graph를
추가하지 않으며 public `GAME_STATE_CODE`와 `gameStateName(...)`으로 숫자 ABI를 해석한다.

| 상태 | 코드 | 진행 계약 |
| --- | ---: | --- |
| `playing` | `1` | normal simulation을 진행한다. |
| `paused` | `3` | render는 유지하고 tween, rigid physics, gameplay timer/FSM, particle simulation을 진행하지 않는다. |
| `levelComplete` | `4` | 완료 화면/다음 문서 선택을 위해 `paused`와 같은 simulation freeze를 유지한다. |

`runtime.dataScene.state()`, `pause()`, `resume()`, `complete()`가 상위 API이며 저수준
`FerrumEngine`은 `dataSceneState()`, `pauseDataScene()`, `resumeDataScene()`,
`completeDataScene()`을 제공한다. `pause`는 `playing → paused`, `resume`은 `paused → playing`,
`complete`는 `playing|paused → levelComplete`에서만 `true`를 반환한다. Data Scene이 아니거나 허용되지
않은 전이는 `false`이고 상태를 바꾸지 않는다. `transition(...)`, 기본 `reapply(...)`, `useDataScene()` 성공은
새 Data Scene을 `playing`으로 시작한다. `reapply(..., { activateDataScene: false })`는 caller가 이미 준비한
Data Scene에 문서를 적용하는 low-level 호환 경로이므로 전환/reset 계약으로 취급하지 않는다.

문서 A에서 B로 전환할 때의 생존 계약은 다음과 같다.

| 상태 | A→B 결과 |
| --- | --- |
| 같은 이름·타입의 `global` 변수 | 현재 값을 유지한다. B에도 같은 선언이 있어야 한다. |
| `scene` 변수 | B 선언의 `default`로 초기화한다. |
| World entity/component, tilemap, particle, tween | 제거하고 B에서 다시 구성한다. |
| physics contact/history, fixed-step accumulator와 input latch | 제거한다. 첫 B frame은 A의 접촉/input edge를 상속하지 않는다. |
| collision/gameplay/effect/render/audio event buffer | 제거한다. A의 frame event를 B에서 소비하지 않는다. |
| pending spawn/deferred despawn queue | 제거한다. A에서 예약된 구조 변경을 B에 적용하지 않는다. |
| lifecycle state | `playing`으로 초기화한다. |

이 전환은 낮은 빈도 document apply 경계다. additive scene load, runtime scene graph, visual FSM/action graph,
내장 3-slot save UI는 이 계약 범위가 아니다.

## Snapshot/Restore

`GameStateSnapshot.dataScene`은 optional `authoringDocument` JSON payload를 가질 수 있다.
`captureGameStateSnapshot(engine, { includeDataSceneState: true, dataSceneAuthoringDocument })`는
실제 Data Scene mode에서만 허용되며 이 문서를 clone해서 snapshot hash 범위에 포함한다. built-in scene에서
Data Scene payload capture를 요청하면 자체 복원 불가능한 snapshot을 만들지 않고 즉시 거절한다.

`0.1.0-beta.7`의 `GameStateSnapshot` version은 `2`, 신규 `DataSceneStateSnapshot` version은 `3`다.
기존 Data Scene v2도 읽는다. lifecycle state가
snapshot/replay hash 범위에 들어가므로 같은 scene이라도 `playing`, `paused`, `levelComplete` snapshot은
서로 다른 hash를 가진다. version `1` snapshot은 자동 추론하지 않고 validation에서 거절한다. 저장 데이터를
유지해야 하는 consumer는 원래 authoring document와 custom/variable payload로 새 snapshot을 다시
캡처하거나 명시적 migration을 수행해야 한다.

`restoreGameStateSnapshot(...)`은 `DataSceneStateSnapshot.authoringDocument`가 있으면 기본적으로
`applyDataSceneAuthoringDocument(...)`를 실행해 Data Scene entity와 behavior binding을 다시 조립한 뒤
global/scene 변수와 `playing|paused|levelComplete` lifecycle을 복원하고
`applyDataSceneCustomState` callback을 호출한다. 따라서 callback은 최종 lifecycle state를 관찰한다.
restore의 `dataSceneAuthoringApplyOptions.activateDataScene: false`는 기존 World 위에 snapshot entity를
겹칠 수 있으므로 mutation 전에 거절한다.
`restoreDataSceneAuthoringDocument: false`를 넘기면
문서를 재적용하지 않고 빈 Data Scene mode만 활성화한다. 이 필드는 optional이므로 기존 snapshot은
문서 payload 없이도 동작하며, runtime 전체 `World` binary snapshot을 새로 추가하는 계약은 아니다.
이 capture/restore 경로는 `pnpm smoke:gameplay-replay -- --scenario data-scene-authoring-snapshot-restore`의
committed golden fixture로도 검증한다.

선언 변수가 있는 Data Scene을 apply한 엔진에서
`captureGameStateSnapshot(..., { includeDataSceneState: true })`를 호출하면 두 scope를 다음 custom slot에
넣는다. Data Scene state를 opt-in하지 않은 일반/built-in snapshot에는 이전 Data Scene 변수 저장소를
자동으로 주입하지 않는다.

- `global`: `snapshot.custom["ferrum2d.variables"]`
- `scene`: `snapshot.dataScene.custom["ferrum2d.variables"]`

두 custom 슬롯은 기존 Data Scene snapshot hash 범위다. Built-in Shooter snapshot version `19`는 같은 Rust slab을 header에 exact bit로 포함하므로 gameplay replay hash에도 직접 반영된다.
Scene/Level Flow v1은 Data Scene snapshot v2부터 지원한다. 현재 소스는 일반 physics/obstacle/animation 진행에 v5,
공간 진행에 v6를 사용하며,
같은 문서와 같은 최종 변수 값은 변수 설정 순서와 무관하게 같은 snapshot hash를 만든다.
기존 custom state와 함께 캡처할 때는 custom state가 object여야 하며
`"ferrum2d.variables"`는 consumer가 직접 쓰지 않는 reserved key이며 public
`DATA_SCENE_VARIABLES_SNAPSHOT_KEY` 상수로도 노출한다. 변수가 없는 문서는 custom payload shape에
변수 slot을 추가하지 않는다. v3로 새로 캡처하면 version 필드 변경으로 전체 snapshot hash는 갱신된다.

restore는 authoring document와 변수 payload의 선언·타입 정합성을 runtime activation/spawn 전에
검사하고, 문서를 재적용해 선언 저장소를 구성한 뒤 global/scene 값을 복원한다. snapshot에 선언되지
않은 이름, 누락된 선언 값, 타입이 맞지 않는 값이 있으면 복원을 거절한다. reserved 변수 payload는
엔진이 소비하며 `applyCustomState`/`applyDataSceneCustomState` callback에는 나머지 consumer custom
payload만 전달한다.
`GameStateSnapshotRestoreResult`는 `dataSceneVariables`, `globalVariablesApplied`,
`sceneVariablesApplied`로 적용 결과를 보고한다.

`restoreDataSceneState: false`이면 `scene` 변수 복원은 건너뛰지만, 별도 global slot의 `global` 변수는
복원한다. authoring document를 적용하지 않는 snapshot이나 `restoreDataSceneAuthoringDocument: false`
상태에서 변수 payload를 복원하려면 엔진에 같은 이름·scope·type의 호환 가능한 선언 저장소가 이미
연결되어 있어야 한다.

## Instance Handle Registry

배치 UI, 선택 상태, agent 타겟팅처럼 authoring id로 runtime entity를 다시 찾아야 하는 경로는
`createSceneInstanceHandleRegistry(...)`를 사용한다. registry는 `applySceneBehaviorRecipes(...)`의
`instanceHandleRegistry` option으로 전달하면 scene apply 결과를 `instance.id` 기준으로 동기화한다.

- `get(id)` / `require(id)`는 `instance.id`에서 `GameplayEntityHandle`을 찾는다.
- `instanceIdForHandle(handle)`은 generational handle에서 authoring id를 역조회한다.
- `sync(instances, handles)`는 scene reload/reapply 뒤 사라진 id를 제거하고 새 handle로 교체한다.
- `entityExists` callback을 제공하면 stale handle은 `validateLive: true` 조회 또는 sync 시 제거된다.

이 registry는 TypeScript authoring layer의 낮은 빈도 cache다. Rust `World`에 `Actor`/`GameObject`
저장소를 추가하지 않고, frame loop에서 entity별 JS/Wasm 왕복 호출을 하지 않는다. UI가 저장하는
문서는 명시적 `instance.id`를 부여해야 하며, apply 경로에서는 `requireExplicitInstanceIds: true`로
resolver fallback id(`fragment.index`) 의존을 거절할 수 있다.

## 샘플

검증 샘플은 `docs/engine/samples/data-scene-minimum.scene-authoring.json`이다. 이 샘플은 global/scene 변수 선언, 두 개의 generic `agent` instance와 `health`, `faction`, `seekTarget` behavior recipe만 사용한다.

```bash
pnpm validate:data-scene-authoring
```

이 명령은 ferrum-web public package를 빌드한 뒤 샘플을 resolver로 검증한다. 검증 범위는 envelope, fragment/behavior binding, `props.components` schema, starter scene 전용 runtime binding 금지를 포함한다. 샘플은 ferrum-web test suite에서도 `createEngine(...)`과 `applyDataSceneAuthoringDocument(...)`를 통해 실제 Data Scene entity spawn smoke로 검증한다.

## create-game 연결

`packages/create-game/templates/*/public/scene-authoring.json`은 같은 `ferrum2d.consumer.scene-authoring` envelope를 사용한다. 템플릿 파일은 built-in starter scene과 연결하기 위해 `runtimeEntity` 같은 adapter prop을 사용할 수 있지만, 이는 template surface contract이며 최소 Data Scene contract와 분리해서 다룬다.

## Native runtime 연결 (#62~#65)

`visual`의 origin/tint/layer/sortOrder는 실제 Rust render command에 반영된다. `visual.layer`가 instance.layer보다 우선하며, `visual.depthSort: "hd2d"`는 같은 layer 안에서만 floor/elevation/발 위치 정렬을 활성화한다. Data Scene에서는 heightSpan 추가만으로 전역 정렬 모드가 바뀌지 않는다.

optional `components.body: { type: "static" | "kinematic" | "dynamic", heightSpan? }`는 sprite와 같은 entity에 물리 바디를 설치한다. 생략한 기존 collider-only 객체는 그대로다. [계약·공개 API recipe·검증](data-scene-native-runtime.md)을 참고한다. static/kinematic 연결은 `0.1.0-beta.2`부터 제공하며 dynamic은 현재 개발 소스에 추가되어 있다. dynamic에는 명시적 mass와 gravityScale/damping/canSleep/마찰·반발계수를 작성할 수 있고 stepping 정책은 별도로 설정한다. 같은 authored handle을 collider obstacle과 progress 저장에 연결할 수 있으며 일반 v5 progress는 물리 pose를 포함하지 않으며 공간 v6 billboard pose는 [공간 저장](data-scene-spatial.md) 계약을 따른다.


## Data Scene 탐험 gameplay와 navigation (beta.7부터)

이 절은 `0.1.0-beta.7`부터 제공하는 계약이다. beta.6 이하 tarball에는 아래 API가 없다. 설치된 타입에
`configureDataSceneGameplay` / `configureDataSceneNavigation`이 있는지 먼저 확인한다.

문서에 optional `gameplay`와 `navigation`을 선언한다. 기존 필드만 있는 배치 문서는 그대로 적용된다.
`interaction`, `pickup`, `collisionPickup`을 실행하려면 `gameplay`를 명시해야 하며, 누락하면
씬 활성화 전에 경로가 있는 diagnostic으로 거절한다. 기존에 이 recipe가 성공으로 저장되지만 실행되지
않던 Data Scene은 이 진단을 받을 수 있으므로 아래 설정을 추가한다.

```json
{
  "gameplay": { "primaryActor": "player", "interactionInputActionId": 91 },
  "navigation": {
    "columns": 5, "rows": 5, "cellWidth": 24, "cellHeight": 24,
    "originX": 0, "originY": 0,
    "costs": [1,1,1,1,1, 1,1,1,1,1, 1,1,0,1,1, 1,1,1,1,1, 1,1,1,1,1]
  }
}
```

위 조각을 `format/version/sceneComposition/behaviorRecipes`가 있는 문서에 병합한다.
`primaryActor`는 적용할 fragment의 instance ID다. `player` collision layer만으로 주인공을 추론하지
않으며, apply/reapply마다 새 generation handle에 연결한다. pickup만 쓰면 `gameplay: {}`도 가능하다.

- `interactionInputActionId` 생략: 반경 안의 모든 유효한 interaction이 자동 발생한다. `once: true`이면
  해당 entity 생존 기간 중 한 번만 발생하고, false이면 출력 frame마다 최대 한 번이다.
- 지정: `engine.setInputActionBinding(91, 0, { control: "space", activation: "pressed" })`처럼
  **엔진 input action**을 별도로 등록한다. 활성 입력에서 가장 가까운 interaction 한 곳을 선택한다.
  같은 거리면 entity 순서로 결정한다. `InputManager`의 문자열 action 이름과 자동 연결되는 것은 아니다.
  E 키를 쓰려면 `InputManager`의 `keyBindings.space: ["KeyE"]`처럼 control에 매핑할 수 있다.
- recipe의 `action`/`actionId`는 이벤트 식별자이고 입력 gate ID와 독립적이다.
  pause/complete에서 실행을 멈추며, 잘못된/stale actor handle은 기존 설정을 바꾸지 않고 거절한다.
  fixed step 사이의 짧은 누름은 다음 step에 한 번 전달하며 연속한 step의 별도 누름도 유지한다.
  gameplay 재설정과 pause/resume은 이전에 대기하던 입력을 버린다. 계속 누르는 `down` 바인딩은
  재개 이후에도 활성 상태이며, 한 번씩 조사하려면 `pressed`를 사용한다.
- `collisionPickup`은 실제 collider overlap/filter/heightSpan 검사 뒤 동작한다. collider-only와 native
  body 모두 사용 가능하며 `includeCollisionEvents` 옵션에 의존하지 않는다. `target: "other"`이면 상대
  entity의 `pickup`을 수집한다. `target: "self"`이면 recipe 소유 pickup을 상대가 수집한다.
- Data Scene pickup은 양수 uint32 item ID와 count, `despawn: true`를 지원한다. 수집 이벤트의
  actorId/actorGeneration=collector, sourceId/sourceGeneration=pickup, tokenId=item ID, payloadBits=count를 전달하고 entity를 한 번 제거한다. 모든 ID는 Data Scene에서
  게임이 정의하는 아이템이며 자동 점수 증가는 없다. 기존 Shooter는 점수 ID 1 전용 계약을 유지한다.
  `despawn: false`는 반복 지급 방지 상태를 제공하지 않으므로 거절한다.
- `gameplay.combat`을 생략하거나 false인 문서는 interaction/pickup/timer와 변수 이벤트 처리 및 metadata 저장만 지원한다.
  health/damage/faction/tags/lifetime/scoreReward는 기존 component 저장 계약을 따른다. chase/seekTarget/
  accelerate, projectile/dash/melee/spawn action 및 pickup 이외 collision reaction은 executor가 없으므로
  적용 전에 거절한다. 이 모드의 변수 이벤트 조건은 interaction/timer/pickupCollected로 한정한다.
  timer는 이벤트 발생만 지원하므로 action 실행 설정은 거절한다. metadata 저장도 기존 adapter의
  제약(health의 start=max, damage cooldown=0 등)을 적용 전에 검사한다. 변수 이벤트 trigger는
  entity별 고유 event/token/variable/operation 조합 최대 16개이며 같은 조합 재설정은 한 칸을 사용한다.
  apply 옵션으로 variable ID를 바꾸더라도 실제 선언 타입·참조를 다시 검사한다.
  `gameplay` 없는 기존 authoring primitive 문서의 component 저장 성공을 실행 지원으로 해석하지 않는다.

navigation은 렌더링·물리 collider와 별도인 **단일 XY 평면 격자**다. 최대 4096칸, 양수 float32 셀 크기,
행 우선 `costs` 배열을 사용한다. 비용 0은 통행 불가, 1..65535는 통행 비용이다. 맵 이미지나 body에서
기본 격자와 캐릭터 여유 폭은 게임이 작성한다. 선언한 collider 장애물은 아래 opt-in으로 자동 계산한다.
`queryTilemapNavigationPath/Waypoint`를 그대로 사용하고 `setDataSceneNavigationCost(column,row,cost)`로
기본 지형 비용을 바꾼다. 동일 기본값 또는 범위 밖 수정은 false다. 높이 span을 전달해도 동일 XY 격자의
장애물과 비용을 사용한다. 서로 다른 시작/도착 heightSpan을 연결하는 경사로·층간 portal은 지원하지 않는다.
경로 조회는 waypoint 반환까지다. 아래 목적지 이동 API로 주인공의 경로 추종을 실행할 수 있다.
NaN/Infinity가 들어간 좌표 조회는 경로·waypoint를 반환하지 않는다.

현재 소스의 `navigation.obstacles`는 문 같은 장애물의 고정 칸 또는 live collider 경계를 격자와 선언적으로 연결한다.
이 확장은 배포된 beta.7에 포함되지 않으며 새 엔진 패키지가 필요하다.

```json
{
  "columns": 3, "rows": 1, "cellWidth": 24, "cellHeight": 24,
  "costs": [1, 9, 1],
  "obstacles": [{ "instanceId": "lighthouse-gate", "cells": [{ "column": 1, "row": 0 }] }]
}
```

- `obstacles`는 optional이며 생략한 기존 격자는 종전처럼 물리와 독립적이다. `instanceId`는 적용하는
  fragment의 inline collider instance를 참조한다. 한 instance당 선언 하나, 중복 없는 nonempty `cells`,
  `cells` 대신 `collider: true`를 선택할 수 있다. 두 필드는 동시에 쓸 수 없다.
  고정 cell reference와 자동 obstacle 수의 합은 최대 4096, 자동 obstacle은 최대 64개다. 다른 장애물이 같은 칸을 공유할 수 있다.
  fragment 선택, `idPrefix`, root props 등 적용 옵션으로 결정된 instance를 검증한다. collider 없는
  선택 instance와 빈 슬롯이 있는 `obstacles`/`cells` 배열은 씬 초기화 전에 거절해 기존 상태를 보존한다.
- 기본 `costs`에는 문이 열렸을 때의 지형 비용을 넣는다. 닫힌 문 때문에 기존에 0으로 쓴 칸은 양수로
  옮기고 obstacle로 선언한다. 원래 지형 비용 0인 칸은 문이 열려도 통행 불가다.
- Rust가 현재 generation의 개체·body·단일 solid collider 활성 상태를 확인한다. collider-only 개체도
  지원하며 trigger는 칸을 막지 않는다. 개체 제거, `setPhysicsBodyEnabled(handle, false)`,
  `setPhysicsColliderEnabled(handle, false)`는 해당 장애물의 차단을 해제하고 다시 활성화하면 차단한다.
  collider-only 개체의 collider 변경도 성공하면 `true`를 반환한다. body snapshot이 없다는 이유로
  실패를 반환하지 않으며, stale handle이나 collider 없는 개체는 `false`로 거절한다.
  겹친 장애물이 모두 해제되어야 기본 비용이 드러난다. 별도 비용 setter 호출은 필요 없다.
- 경로/waypoint 조회와 이동 명령 전에 즉시 동기화하고, 이동 중에는 simulation step에서 변경을 감지해
  경로를 다시 계산한다. 이미 blocked인 이동은 목적지를 다시 요청한다. 재사용된 entity ID의 다른
  generation은 이전 장애물로 연결되지 않는다.
- 런타임에서 직접 격자를 교체할 때는 `engine.configureDataSceneNavigation(spec, entityHandles)`로
  apply 결과의 stable ID→handle map을 전달한다. 전체 문서 apply와 진행 복원은 이 연결을 자동 수행한다.
  잘못된 handle/칸/중복/compound binding은 기존 격자와 경로를 보존하고 거절한다.
- `cells`는 고정 칸이다. `{"instanceId":"lighthouse-gate","collider":true}`는 collider의 현재 XY
  AABB 경계와 양의 면적으로 겹치는 모든 칸을 막는다. offset/위치/크기/회전 변경과 형상 교체를
  Rust에서 따라가며 격자 밖은 잘라낸다. 원·회전 box·capsule·polygon은 보수적인 bounding box를
  사용한다. 칸 경계에 닿기만 하는 인접 칸은 막지 않는다. collider 활성 상태 변화도 같은 overlay에
  반영한다. 캐릭터 반경 팽창, 이미지에서 전체 지형 생성, 다층 navigation은 포함하지 않는다.
  교체/clear/reset은 이전 binding도 제거한다.

`useDataScene`, reset, transition은 navigation과 gameplay binding을 초기화한다. 문서 reapply는 새
격자와 주인공을 다시 설치한다. invalid grid/actor/지원하지 않는 opted-in recipe는 기존 씬을 지우기 전에
거절한다. `activateDataScene: false`는 기존 씬을 유지하는 저수준 apply로, 생략한 gameplay/navigation은
기존 설정을 유지한다. Shooter tile 설정 API는 Data Scene에서 씬을 전환하지 않고 false 또는 void no-op로
거절한다. 실제 Shooter 전환은 `setGameSpec` 등 명시적인 씬 구성 경로를 사용한다.

### 목적지 이동 (beta.7부터)

`gameplay.primaryActor`와 `navigation`을 적용한 뒤 월드 좌표를 지정한다.
주인공은 활성 native `kinematic` body와 활성 non-trigger AABB 하나를 가져야 한다.

```ts
import type { DataSceneMoveOptions } from "@ferrum2d/ferrum-web/core";

const destination: DataSceneMoveOptions = {
  x: 108, y: 60, speed: 120, arrivalRadius: 0.5, cancelOnInput: true,
};
const accepted = engine.moveDataSceneActorTo(destination);
// "idle" | "moving" | "arrived" | "blocked" | "cancelled"
const status = engine.dataSceneMoveStatus();
// 사용자 취소 버튼 등에서 호출한다. 이동 중일 때만 true다.
engine.cancelDataSceneMove();
```

클릭 이동은 `DataSceneView.pointerToWorld({ x: event.clientX, y: event.clientY })`의 결과를
목적지로 전달한다. 카메라·줌·지면 투영을 반영하므로 화면 좌표를 직접 목적지로 쓰지 않는다.

- `speed`는 simulation 초당 월드 거리이며 양수 float32다. `x/y`와 `arrivalRadius`도 유한 float32이고
  반경은 0 이상이다. 반경 기본값은 0.5이며 마지막 구간에만 적용한다. 0이면 float32 목적지까지 이동한다.
  `solidMaskBits`는 uint32이며 기본값은 모든 layer다. 0이면 물리 solid 검사를 제외하지만 grid는 유지한다.
- 성공한 명령은 이전 경로를 교체하고 주인공 velocity를 0으로 만든다. 잘못된 JS 옵션은 throw,
  씬/주인공 조건 불충족·격자 밖·경로 없음·완료된 씬은 false이며 기존 경로를 보존한다.
  `dataSceneMoveStatus()`는 Data Scene 밖에서 undefined다. 이미 도착한 곳도 명령 직후 moving이며 다음 step에 판정한다.
- Rust가 셀 중심을 순서대로 지나 마지막 목적지로 이동한다. 큰 delta에서도 구간을 건너뛰지 않으며,
  작은 셀의 중간 코너도 정확히 거친다. 매우 느린 이동의 미소 거리는 다음 step으로 누적한다.
  큰 원점/작은 셀 조합에서 float32 셀 중심이 다른 칸으로 반올림되는 경로는 이동 요청을 false로 거절한다.
  기존 경로는 보존하며 이동 중 재탐색이 이런 경로를 만나면 blocked다. 월드 원점이나 셀 크기를 조정해야 한다.
  비용은 경로 선택에만 사용하며 속도 배율이 아니다.
- 실제 이동은 기존 AABB sweep으로 primary AABB solid를 검사한다. collision filter·heightSpan을 따르고
  trigger와 비활성 body를 차단물로 취급하지 않는다. 원/다각형·compound의 추가 collider를 장애물로 추출하거나
  회피하지 않는다. 격자에 캐릭터 폭과 장애물 여유를 반영해야 한다. 물리 solid에 막히면 blocked로 정지한다.
- grid 교체/비용 수정/clear 또는 외부 위치 변경은 다음 simulation step에 경로를 다시 계산한다.
  경로가 없어지면 blocked다. 이미 blocked인 이동은 자동 재시도하지 않으므로 목적지를 다시 지정한다.
- pause는 경로를 보존하고 resume 후 이어간다. complete, gameplay 재설정, actor 제거/세대 변경은
  이동을 취소한다. reset/문서 전체 reapply는 idle로 초기화한다.
  기본 `cancelOnInput: true`는 W/A/S/D control 중 하나가 활성화되면 취소하며, 같은 입력 sample에서
  게임이 설정한 수동 velocity를 보존한다. false일 때 이동 중 velocity는 엔진이 0으로 유지한다.
- 한 씬의 primary actor 한 명만 지원한다. 애니메이션/방향 전환은 아래 opt-in 설정으로 연결한다.
  pickup/interaction은 각 simulation step 끝의 실제 overlap/거리로 처리하며 지나친 trigger의 연속 감지는 제공하지 않는다.
  진행 snapshot에는 경로·이동 상태·현재 위치를 저장하지 않는다. 문서를 포함한 복원은 authored 위치와 idle로 시작한다.

### 이동·애니메이션 자동 연결 (beta.7부터)

`gameplay.primaryActor`와 캐릭터의 `visual.animationSet`을 적용한 뒤 아래 설정으로 연결한다.
`configureDataSceneSpriteAnimation`으로 먼저 설치한 clip도 사용할 수 있다. clip ID는 게임이 정하며,
아래 숫자는 예시다. 각 상태에 네 방향을 모두 지정해야 하지만 같은 clip을 여러 방향에 재사용할 수 있다.

```ts
import type { DataSceneMovementAnimationSpec } from "@ferrum2d/ferrum-web/core";

const movementAnimation: DataSceneMovementAnimationSpec = {
  idle: {
    up: { clip: 0 }, down: { clip: 1 },
    left: { clip: 2, flipX: true }, right: { clip: 2 },
  },
  walk: {
    up: { clip: 4 }, down: { clip: 5 },
    left: { clip: 7, flipX: true }, right: { clip: 7 },
  },
  initialDirection: "down",
};
const bound = engine.configureDataSceneMovementAnimation(movementAnimation);
// 해제는 현재 clip/시간/flip을 보존한다.
engine.configureDataSceneMovementAnimation(false);
```

- 주인공에 sprite와 기존 clip playback이 필요하다. 잘못된 JS 필드/clip ID 범위는 throw한다.
  Data Scene 밖, 주인공/playback 없음, 등록하지 않은 clip 참조는 false이며 기존 설정을 보존한다.
  `clip`은 0..65535 정수, `flipX/flipY`는 optional boolean이다. 초기 방향은 down, flip 기본값은 false다.
- 활성화 즉시 초기 방향의 idle을 선택하고 playback pause를 해제한다. 씬의 paused/complete 상태는 바꾸지 않는다.
  Rust가 다음 simulation step부터 경로 이동은 walk, 도착·막힘은 idle로 선택한다.
  도착 step에 여러 코너를 지나도 마지막 실제 이동 구간의 방향을 유지한다.
- 경로 추종 중이 아니면 해당 step의 실제 위치 변화를 기준으로 walk/idle을 고른다. 따라서 게임이
  설정한 수동 velocity도 연결된다. step 사이의 teleport와 step 시작 전 tween 변경은 이동으로 세지 않는다.
  별도 키 입력이나 수동 이동 controller를 만드는 API는 아니다.
- 월드 +Y는 down이며, 대각선은 큰 축을 선택하고 양축 크기가 같으면 좌우를 선택한다.
  같은 clip의 방향/flip만 바뀌면 경과 시간을 유지한다. 다른 clip으로 바뀌면 첫 프레임부터 시작해
  다음 simulation step부터 시간을 진행한다. playback 시간을 한 step에 두 번 증가시키지 않는다.
- pause와 delta 0에서는 자동 전환/시간 진행이 멈춘다. 명시적 이동 취소와 complete는 즉시 idle로
  전환한다. W/A/S/D가 경로를 취소한 step에 수동 velocity가 실제로 움직이면 walk로 이어진다.
- 주인공에 성공한 `updateDataSceneSpriteAnimations` 명령을 보내거나 clip을 재설정하면 자동 연결을
  해제한다. 실패한 batch, 빈 batch, 필드 없는 명령, 다른 entity 명령은 연결을 유지한다.
  공격·대화 등의 수동 연출이 끝나면 위 설정을 다시 호출해 자동 연결을 켠다.
- `false`는 Data Scene에서 이미 해제되어도 true다. gameplay 재설정은 기존 주인공을 idle로 바꾼 뒤
  연결을 해제한다. reset/전체 reapply/씬 전환도 연결을 초기화한다. 대상은 primary actor 한 명이다.
- 진행 snapshot v5는 authored `visual.animationSet`의 runtime clip/시간/pause/flip과 이 이동 pose 설정·방향을
  함께 복원한다. 복원 직후 설정을 다시 호출하면 재생 시점이 바뀔 수 있으므로 저장된 연결을 유지한다.
  playback이 없는 이전 v2/v3/v4 저장은 위 설정을 다시 호출한다. runtime에서만 설치한 clip은 저장 범위에 포함하지 않는다.

### 진행 저장·복원 (beta.7부터)

기본 Data Scene snapshot은 문서 재적용 + variables/custom 복원이다. 탐험 진행 상태도 저장하려면
`includeDataSceneProgress: true`를 명시한다. 수집 등으로 제거된 authored entity, `once` interaction의
consumed 상태, `bodyEnabled`/단일 `colliderEnabled`, 현재 navigation 전체(크기·원점·기본 지형 비용·
장애물 binding 또는 clear)를 함께 저장한다. 문을 제거하지 않고 충돌만 비활성화한 상태도 새 엔진에 복원된다.

```ts
import { captureGameStateSnapshot, restoreGameStateSnapshot } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";

applyDataSceneAuthoringDocument(engine, document);
const saved = captureGameStateSnapshot(engine, {
  includeDataSceneState: true,
  includeDataSceneProgress: true,
  dataSceneAuthoringDocument: document,
});
// saved는 JSON 직렬화/저장 후 새 engine에서도 복원할 수 있다.
restoreGameStateSnapshot(engine, saved);
```

저장 payload의 `dataScene.progress`는 stable instance ID를 사용한다. 새 handle/generation은 문서 재적용
결과에서 다시 연결하며 제거 상태를 복원할 때 수집 이벤트나 변수 증가를 재실행하지 않는다.
제거된 instance에는 physics flag나 animation playback을 담지 않는다. body가 없는 instance에 `bodyEnabled`를 저장하거나
collider가 없는 instance에 `colliderEnabled`를 저장하면 복원 전에 거절한다. 장애물은 먼저 새 handle에
연결한 뒤 제거/physics flag를 적용하므로 닫힌 문·열린 문·제거된 문 모두 격자 상태가 일치한다.
`animationSet`을 가진 live instance에는 `animation: {clip, elapsedSeconds, paused, flipX, flipY,
movement?}`를 저장한다. frame과 finished는 authored clip/fps와 경과 시간에서 다시 계산한다.
`movement`는 runtime에 연결한 idle/walk pose와 현재 `initialDirection`을 저장한다. 생략된
movement는 수동 playback의 해제 상태를 보존하며, 저장된 연결은 새 primaryActor에 자동 복원한다.
정적 clip 정의는 authoring 문서에서 재설치하고 재생 상태만 bulk numeric buffer로 Rust에 전달한다.
clip/시간/flag/pose가 잘못되면 씬 교체 전에 거절한다. legacy 단일-strip `animation`은 저장 대상이 아니다.
문서 apply → 진행 상태 → 변수 → lifecycle → custom callback 순서로 복원한다. 입력 바인딩은 게임이
새 엔진에 다시 설치한다. 일반 v5 진행에는 위치·카메라가 포함되지 않는다. 공간 문서의 v6 진행은
[공간 저장 계약](data-scene-spatial.md)에 따라 live authored billboard의 XY/heightSpan과 runtime camera를 저장한다.
속도·회전·타이머 경과·FSM·추가 spawn·임의 JS 상태는 포함하지 않는다.
필요한 게임 데이터는 기존 variables/custom 또는 별도 physics snapshot 정책으로 관리한다.

이번 진행 저장은 **기본 binding 옵션으로 전체 apply한 단일 문서**를 대상으로 한다. 같은 원본 문서를
capture에 전달해야 한다. fragment/idPrefix/transform/ids/kinds override, 외부 componentTemplates,
`activateDataScene: false` 누적 apply 뒤에는 진행 capture를 거절한다. 설정을 문서에 넣고 전체 적용한다.
`path`, `textureId`, `colorManagement`, `instanceHandleRegistry` 옵션은 허용한다.
reset/씬 전환 뒤 이전 apply 메타데이터로 모든 객체가 제거됐다고 저장하지 않도록 epoch를 확인한다.
진행 payload가 있으면 `restoreDataSceneAuthoringDocument: false`를 거절한다.
`restoreDataSceneState: false`는 문서와 진행 복원 모두 건너뛴다.

최신 지원 Data Scene state version은 `9`이며 바깥 GameStateSnapshot version은 `2`를 유지한다.
v8은 모델 회전·부모 연결/streaming/LOD 문서의 진행 계약이며, v9는 아래 전투 checkpoint를 추가한다.
탐험 capture는 필요한 기존 v5/v6/v7/v8을 유지하고 과거 파일의 hash를 변경하지 않는다.
공간 pose/camera capture는 v6, authored/runtime environment 진행이 있는 capture는 v7이며 일반 capture는 v5다.
v7은 현재 조명·그림자·DOF·색 보정·안개의 `progress.spatial.environment`를 추가한다. null은 authored 효과 해제,
생략은 authored 기본값 유지다. v6 이하에 이 environment progress를 넣으면 거절한다.
v6는 `progress.spatial.camera`와
`instances[].spatialPose`(x/y/heightSpan/선택 surfaceId)를 추가한다. v5 이하에 이 필드를 넣으면 거절한다.
기존 Data Scene v2/v3/v4/v5/v6 파일은 해시를 변경하지 않고 읽는다. v2는 progress 없이, v3는 제거/consumed와
독립 격자를 종전처럼 복원하며 생략된 physics flag는 authored 기본값을 유지한다. 과거 v3에 저장되지
않은 열린 문 상태를 엔진이 추측하지 않으므로 게임의 기존 migration 정책은 유지해야 한다.
v4는 physics flag와 고정 obstacle을 종전처럼 복원한다. 재생 상태가 없는 과거 파일은 초기 clip으로 복원한다.
v2/v3/v4 엔진은 새 v5 파일을 거절한다. v3에 physics flag/obstacle을, v3/v4에
animation playback/자동 collider obstacle을 끼워 넣어도 버전 계약 위반으로 거절한다.
잘못된 progress ID/중복/consumed 조합/grid/버전은 씬 초기화 전에 거절하며 payload도 snapshot hash에 포함된다.
잘못된 공간 pose/camera/surface 관계도 씬 초기화 전에 native preflight한다. 네이티브 progress commit은
physics flag·animation·pose·camera 전체를 검증한 뒤 적용한다. 문서 적용 전체/custom callback의 rollback 계약은 아니다.

실행 검증: `pnpm smoke:data-scene-gameplay`. 실제 packed package의 `/core`와 `/authoring`만 사용해
입력·수집·변수·navigation·실패 시 씬 보존·generation reset을 검증한다.


## 선택적 HD-2D 전투 실행 (개발 소스)

`gameplay: { primaryActor: "actor", combat: true }`로 Rust의 Data Scene 전투 실행을 켠다.
`combat`은 optional boolean이며 기본값 false다. true는 같은 fragment의 `primaryActor`를 요구한다.
배포된 탐험 전용 Wasm에는 이 실행기가 없다. 새 Wasm과 TS를 함께 사용해야 하며 미지원 runtime은
activation/spawn 전에 거절된다. 기존 네 인자 native 설정 ABI는 유지하고, 전투는 별도의 v2 설정으로 전달한다.

- `chase`/`seekTarget`/`accelerate`, health/damage/faction/lifetime과 기존 탐험 레시피를 실행한다.
  health start=max, damage cooldown=0 등 기존 component 제약은 그대로다. AI는 직접 추적이며
  기본 직접 추적의 공간 terrain step/drop 한도는 각각 1 world unit이다. 아래 `combatNavigation`을 켜면
  Chase는 작성한 step/drop과 실제 층간 경로를 사용한다. 선택 `movementPatterns: "all"`은 SeekTarget과 Accelerate에도 공간 이동을 연결한다.
- 적의 `projectileAction`은 `aim: "targetPlayer"`, `collisionTarget: "player"`를 사용한다.
  `timerTrigger`의 action은 같은 entity에 등록된 targetPlayer projectile/dash, player melee 또는 spawnPrefab action을 가리켜야 한다.
  전투에서 action이 연결된 timer는 `seconds` 간격으로 반복하며 substep/source당 최대 한 번 실행한다.
  action 없는 이벤트 timer는 기존대로 한 번 발생한다.
- 플레이어는 `primaryActor`에 `projectileAction`의 `aim: "input"`, `collisionTarget: "enemies"`를 작성한다.
  두 값은 생략 시에도 input/enemies다. 동일 action ID를 `engine.setInputActionBinding`으로
  `mouseLeft`/`space`/`enter`의 `pressed` 또는 `down`에 연결한다. substep당 최대 한 입력 공격을 실행한다.
  `pressed`는 누르는 순간, `down`은 유지 중 cooldown 간격으로 발사한다. 입력 action을 timer에 연결하거나
  primaryActor 외 개체에 작성하면 activation 전에 거절한다. 두 projectile 모드 모두 `tileImpact: "despawn"`만 지원한다.
  melee/dash와 spawnPrefab은 아래 별도 기능 검사를 사용한다.
  `engine.supportsDataSceneInputProjectiles()`는 별도 native v1 기능 검사를 수행하며 이전 combat Wasm에서는 false다.
  입력 projectile 문서는 이 검사를 통과해야 적용된다. 기존 적 자동 사격 문서에는 이 새 기능을 요구하지 않는다.
- 입력 좌표는 engine의 logical viewport 픽셀이다. 기본 renderer/InputManager 조합에서는 CSS 좌표를 그대로 사용하고
  DPR을 곱하지 않는다. renderer viewport zoom이나 CSS transform을 적용했다면 `inputTransform`/input provider에서
  `mouseX/Y * renderer.viewportSize().width/height / canvas.getBoundingClientRect().width/height`로 각각 변환한다.
  Rust가 현재 viewport와 pixelArt letterbox/snap을 반영해 카메라 ray를 발사 높이 평면과 교차시킨다.
  높이는 발사자 body의 `elevation + height / 2`와 billboard의 visual elevation 합이다. 전용 탄환의 상대 visual elevation도 이 조준 평면에 더한다. 탄환은 이 높이를 유지하는 수평 사격이다.
  여백·화면 밖·유효하지 않은 교점에서는 발사와 cooldown 소비를 하지 않는다.
- 피해, area damage, knockback, despawn, particle, sound, emit effect collision reaction을 실행한다.
  `collisionParticle.presetId`는 `engine.setParticlePreset`으로 등록한다. 시뮬레이션은 Rust가 소유하며
  동적 탄환·파티클은 공간 깊이와 발사/충돌 지점 높이를 공유한다. 탄환은 발사자의 atlas/frame을
  작은 기본 quad로 사용한다. 선택적 전용 외형은 아래 `projectilePrefabs` 계약을 사용한다.
- 한 장면의 authored entity는 모델 marker 포함 2048개, movement actor는 512개 이하로 검증한다.
  동적 projectile은 최대 512개이며 기존 authored entity와 전체 capacity를 공유한다.
- pause/complete는 AI·발사·수명·파티클을 멈춘다. reset/scene 교체는 동적 개체와 진단을 정리한다.
- `engine.dataSceneCombatEnabled()`는 현재 활성 여부를 반환한다.
  `engine.dataSceneCombatStats()`는 저빈도 진단용 복사본이며 구형 Wasm에서는 undefined다.
  actors는 최근 step에서 처리한 주인공 외 movement 개체 수, projectiles는 생존 탄환 수다.
  aiSteps/spawned/hits/kills/expired/capped/particlesSpawned는
  재설정 이후 누적 uint32 포화 카운터다. capped는 실행 상한에 걸린 요청 수다.
- 전투 저장은 아래 v9 checkpoint로 제공한다. 생성 actor는 아래 combat codec v3를 사용한다.

### 생성 actor 프리팹 (개발 소스)

`engine.supportsDataSceneSpawnPrefabs()`가 true인 Wasm에서 `gameplay.spawnPrefabs`를 사용한다.
optional catalog는 최대256개이며 이름별 `{ prototypeInstanceId: "seed" }`를 작성한다.
각 이름은 `ids.prefabs`의 고유 positive uint32 ID를 요구한다. sparse ID와 uint32 최댓값도 유지한다.
`spawnPrefabAction.prefab`은 catalog 이름이며 별도 `prefabId`가 있으면 같은 ID여야 한다.
일반 gameplay facade의 explicit ID 우선순위에는 이 Data Scene 계약을 적용하지 않는다.

```json
{
  "gameplay": {
    "combat": true,
    "primaryActor": "player",
    "spawnPrefabs": { "minion": { "prototypeInstanceId": "seed" } }
  },
  "ids": { "actions": { "summon": 77 }, "prefabs": { "minion": 100 } }
}
```

같은 문서의 `player` 레시피에 `{ "kind": "spawnPrefabAction", "action": "summon", "prefab": "minion", "cooldownSeconds": 1, "offsetX": 32 }`를 추가한다.
primaryActor는 같은 ID의 입력 binding으로 생성하고, 다른 개체도 같은 entity/action의 timer로 생성할 수 있다.
원본은 applied fragment의 독립 inline static/kinematic actor다. attachment/model·dynamic body·joint·FSM·
projectile override는 지원하지 않는다. 공간 body는 heightSpan을 함께 작성한다.
원본 instance는 적용 후에도 일반 개체로 남는다. 숨겨진 정의 전용 instance를 자동 생성하거나 원본을 자동 제거하지 않는다.
원하면 전체 문서 적용 후 첫 update 전에 `despawnPhysicsEntity`로 원본을 제거한다. native cold 정의는 이후에도 유지한다.

sprite·개별 atlas/legacy 재생·체력·수명·충돌·faction/tag·이동·액션·타이머·변수 트리거를 이어받는다.
primary marker는 새 개체에 복사하지 않는다. 원본 billboard/탄환 prefab과 Chase 정지 거리를 공유하며
높이·보행면·벽/타일·maxAgents·그림자 예산을 생성 전에 검사한다. 실패하면 성공 이벤트·cooldown·serial을 추가하지 않는다.
생성 actor 최대512개, 소유 기록1024개, 전체 World2048개다. melee/dash와 별도 action1M/frame·128시도 예산을 공유한다.

전투 checkpoint v3는 `DataSceneCombatSpawnProgressSnapshot`으로 저장한다. 기존 outer snapshot v2 / nested Data Scene v9는 유지한다.
`spawnedActors`에는 고정 이름 `prefab`, `serial`, `removed` 및 살아 있는 개체의 `state`를 기록한다.
state에는 pose/velocity·체력·수명·타이머·cooldown·body/collider 활성·상호작용 소비·재생 시간/뒤집기·visualElevation·birth origin을 포함한다.
`lastSpawnSerial`은 마지막 발급 번호이며 생성 기록이 비어도 보존한다. v3 탄환 `source`와 contact는
`{ instanceId: "player" }` 또는 `{ spawnSerial: 1 }`을 사용한다. GPU slot이나 과거 World handle은 저장하지 않는다.
제거된 생성 발사자는 살아 있는 탄환이 참조할 때만 기록을 남기며 contact는 살아 있는 두 개체만 허용한다.
프리팹·상태·출처·관리 이동/그림자 한도는 씬 교체 전에 검증한다. 복원은 새로운 handle로 실행한다.
기존 v1/v2의 `sourceInstanceId`와 문자열 contact 쌍, byte layout은 유지한다.
직접 runtime 설정은 `DataSceneGameplayOptions.spawnPrefabs`에 `DataSceneSpawnPrefabBinding[]`을 전달한다.
이 handle binding 자체를 JSON에 저장하는 API는 아니다.

### Native melee·dash (개발 소스)

`engine.supportsDataSceneCombatActions(): boolean`은 melee/dash 실행과 checkpoint를 제공하는
native action v1 기능을 검사한다. 문서 적용과 저장·복원 전에 검사하며 구형 Wasm은 activation 전에 거절한다.
새 authoring 필드 없이 기존 레시피를 사용한다.

```json
[
  { "kind": "meleeAction", "action": "slash", "range": 24, "damage": 2, "cooldownSeconds": 0.5 },
  { "kind": "dashAction", "action": "dash", "distance": 64, "cooldownSeconds": 0.8 }
]
```

- `meleeAction.target` 기본값 `"enemies"`와 `dashAction.aim` 기본값 `"input"`은 primaryActor 전용이다.
  `ids.actions`와 같은 ID로 `setInputActionBinding`의 pressed/down을 연결한다. 모든 입력 전투 액션은
  작성 순서를 공유하며 substep당 최대 한 번 시도한다. 타이머는 `target: "player"` melee 또는
  `aim: "targetPlayer"` dash를 실행한다. 같은 entity/action ID의 마지막 종류와 값이 유효하다.
- melee는 물리 이동 뒤, 사망 제거 전에 범위 내 실제 collider의 원 겹침·상호 mask·floor/height·faction을 검사한다.
  발사 개체는 enabled inline collider를 요구하고 공간 문서는 body.heightSpan도 작성해야 한다.
  collider offset을 포함한 중심까지 WALL과 projectile 차단 지형의 시야를 검사한다.
  지면 아래 표면을 장애물로 오인하지 않도록 겹치는 body 높이의 중간을 사용한다.
  체력이 없는 장식은 건드리지 않으며 기존 피해·사망·gameplay event 경로를 공유한다.
- dash는 부착되지 않은 enabled kinematic 단일 AABB와 회전0 instance를 요구한다. 공간 문서는
  body.heightSpan도 필수다. WASD 방향을 우선하고, 방향 입력이 없으면 body midpoint + billboard elevation
  평면의 현재 카메라 ray를 사용한다. 실제 native sweep으로 벽·층·경사·지면 단절을 검사한다.
  공간 primary actor는 spatial.actor의 step/drop, 그 외에는 combatNavigation의 step/drop을 사용하며
  둘 다 없으면 각각1이다. 긴 이동도 이 한도에 따라 중간에서 멈출 수 있다.
- 평면 타일맵에서는 collider 중심 경로가 지나는 타일 경계를 계산하고 각 구간 내부와 경계를 검사한다.
  높은 타일·지면 틈의 짧은 대각선 교차도 검사한다. 최대129개 경계 후보를 넘으면 이동 전에 거절한다.
  공간 대시는 기존 terrain/gateway 이동을 재사용한다. 원래 velocity는 유지한다.
- 별도의 outer update당 액션 예산1M work와 최대128회 melee/dash 시도를 사용한다.
  collider와 타일 metadata 검사부터 비용을 예약하고, melee는 전체 후보 처리를 승인한 뒤 피해를 적용한다.
  예산/용량 거절은 cooldown을 소비하지 않는다. 부분적으로 이동한 dash는 cooldown을 소비하고,
  완전히 막힌 dash는 blocked placement를 보고한다. 기존 failure reason/진단 ABI를 유지하며
  예산 거절도 기존 spawn queue full과 capped 카운터에 기록한다. navigation의1M 예산과는 별도다.
- v9 checkpoint의 기존 actor cooldown·위치·높이·velocity·체력 필드를 재사용한다. pause 중 입력은 폐기하고,
  restore 뒤 pending melee와 액션 예산은 초기화한다. 생성 actor의 추가 저장 계약은 아래 spawnPrefab 절을 따른다.

```ts
// 문서의 ids.actions.fire와 primaryActor projectileAction의 action: "fire"가 같은 ID를 사용한다.
if (!engine.supportsDataSceneInputProjectiles()) throw new Error("입력 발사를 지원하는 엔진이 필요합니다");
engine.setInputActionBinding(41, 0, { control: "mouseLeft", activation: "pressed" });
engine.setInputActionBinding(41, 1, { control: "space", activation: "down" });
```

`pnpm smoke:hd2d-combat`는 공개 tarball의 실제 Wasm으로 배경 모델 216개 + 적 0/32/128개의
AI 이동·반복 발사·명중·사망·파티클·pause·checkpoint 저장/복원·reset을 검증한다.
동일 gate의 `inputCases`는 네 viewport/DPR에서 실제 브라우저 마우스·키보드 입력,
직교/원근·픽셀 여백·논리 viewport 변환·resize 조준, 다른 층 제외·벽 차단·피해/사망·pause 입력 폐기를 검증한다.
`pnpm benchmark:hd2d-combat`는 같은 fixture를 20초 예열 + 60초 측정 × 3회 실행한다.
GPU 시간이 준비되지 않은 환경은 실제 기기 GPU 측정으로 인정하지 않는다.

### 탄환 프리팹·외형 (개발 소스)

`gameplay.projectilePrefabs`는 최대 256개 이름의 탄환 정의다. `combat: true`와
`engine.supportsDataSceneProjectilePrefabs()`를 요구한다. 기존 문서는 이 기능을 요구하지 않으며
기본 4×4/발사자 texture/atlas 표현을 유지한다. 해당 기능은 일반 `spawnPrefabAction` 실행과 별개다.

```json
{
  "gameplay": {
    "primaryActor": "actor",
    "combat": true,
    "projectilePrefabs": {
      "spark": {
        "sprite": { "texture": "spark-atlas", "width": 12, "height": 8,
          "frame": { "u0": 0.5, "v0": 0, "u1": 0, "v1": 1 } },
        "collider": { "halfWidth": 3, "halfHeight": 2 },
        "billboard": { "unitsPerPixel": 0.75, "alphaCutoff": 0.2, "elevation": 5 },
        "color": "#40c0ff"
      }
    }
  },
  "behaviorRecipes": {
    "entities": {
      "actor": { "recipes": [
        { "kind": "projectileAction", "action": "fire", "projectilePrefab": "spark" }
      ] }
    }
  }
}
```

위 내용은 기존 문서의 해당 필드에 합친다. `ids.actions.fire`와 actor의 recipe binding은 기존 방식으로 작성한다.
`projectile("spark-shot").prefab("spark")`도 weapon profile 컴파일 시 같은 참조를 만든다.

- `sprite.texture`는 기존 texture asset 이름 또는 0..16777215의 숫자 slot이다. asset은 `textureId` apply 옵션이나
  engine asset host에서 해석하며, 모든 참조를 scene activation 전에 확인한다. slot 상한은 공간 정점 f32에서 ID를 정확히 유지한다.
- `sprite.width/height`와 AABB `collider.halfWidth/halfHeight`는 필수 양수다. sprite 크기는 pixel 단위,
  collider 크기는 world unit이다. `unitsPerPixel`은 collider 크기를 바꾸지 않는다.
- `frame` 생략 시 animation의 첫 frame이며, animation도 없으면 전체 UV다. 0..1 범위의 반전 endpoint로 flip을 표현하며, f32에서 면적이 0이 되면 거절한다.
- `billboard`는 선택적이다. 기본값은 `unitsPerPixel: 1`, `alphaCutoff: 0.01`, `elevation: 0`이다.
  elevation은 발사자의 billboard visual elevation에 더해지는 상대값이다. 물리 높이는 기존 source body midpoint를 유지한다.
  입력 ray는 같은 visual elevation을 사용해 직교/원근·pixelArt/resize 조준을 유지한다.
- `color`는 선택적 sRGB hex이며 기본 흰색이다. apply의 `colorManagement`와 renderer 설정을 일치시킨다.
  sprite 크기·collider 반크기·unitsPerPixel은 최대 10000, 상대 elevation은 ±1000000이며 모두 유효한 f32여야 한다.
- 최종 source/action binding은 최대 8192개다. 동일 source/action을 recipe에서 덮어쓰면 마지막 정의를 사용하고,
  prefab 참조가 없는 마지막 정의는 기본 탄환으로 돌아간다. 다른 source가 같은 action ID를 사용해도 독립적이다.
- `applyDataSceneAuthoringDocument`가 named ref를 수집하고 native batch로 전달한다. standalone gameplay command apply에
  `projectilePrefab`을 전달하면 전체 문서 적용을 요구하며 거절한다. UI나 frame별 JS callback은 필요하지 않다.
- 저수준 `configureDataSceneGameplay`는 숫자 texture로 준비한 `projectilePrefabs`와
  `{ source: GameplayEntityHandle, actionId, prefab }[]`의 `projectileBindings`를 함께 받을 수 있다.
  에셋 host가 있으면 이름도 해석한다. 성공한 재설정은 기존 탄환과 checkpoint metadata를 정리한다.
- 이번 계약은 sprite/trigger AABB·중앙 pivot·camera-facing billboard다. 임의 collider·normal map·독립 shadow 설정은
  포함하지 않으며, 지원하지 않는 prefab 필드는 사전에 거절한다. 피해·수명·속도·faction은 기존 action/source가 소유한다.

`report.prefabCases`는 viewport/DPR 4조건에서 실제 정점의 UV·색상·크기·cutoff를 확인하고,
비행 중 저장 후 asset slot을 바꿔 복원해 새 slot 렌더와 실제 피해를 확인한다.

### 탄환 atlas animation·이동 방향 회전 (개발 소스)

`supportsDataSceneProjectileVisuals()`가 true인 Wasm에서 선택적 `sprite.animation`과
`rotateToVelocity`를 사용한다. 기존 정적 catalog는 이전 기능 검사와 codec v2/v3를 유지한다.

```json
{
  "sprite": {
    "texture": "bolt-atlas", "width": 24, "height": 8,
    "animation": { "fps": 6, "loop": true, "frames": [
      { "u0": 0, "v0": 0, "u1": 0.5, "v1": 1 },
      { "u0": 1, "v0": 0, "u1": 0.5, "v1": 1 }
    ] }
  },
  "rotateToVelocity": true,
  "collider": { "halfWidth": 2, "halfHeight": 1 }
}
```

위 객체는 `gameplay.projectilePrefabs`의 한 정의다. animation은 1..32 frame, fps 0.001..1000,
선택적 boolean `loop`(기본 true)를 받는다. UV는 0..1이며 반전 endpoint를 허용한다.
함께 지정한 `sprite.frame`은 animation의 첫 frame과 f32 값이 같아야 한다.
각 탄환의 시계는 0에서 독립적으로 시작하며, one-shot은 마지막 frame에서 멈춘다.
immutable clip은 native에서 공유하고 시간·pause·flip은 기존 Rust sprite playback이 소유한다.

`rotateToVelocity`는 기본 false다. 켜면 sprite의 local +X를 **현재 화면에 투영한 속도 방향**에 맞춘다.
평면 groundYScale, 직교/원근·pixelArt camera를 반영하며 카메라 변경 후에도 다시 계산한다.
정지하거나 투영이 퇴화하면 회전0을 사용한다. 회전은 render command에만 적용하므로
physics pose/속도·AABB·피해 판정은 바꾸지 않는다. 사용자 회전 offset은 제공하지 않는다.

해당 필드가 하나라도 활성화된 catalog는 combat progress **v4**를 선택한다. 각 projectile은
`animation: { elapsedSeconds, paused, flipX, flipY }`를 저장하며 정적·회전 전용·기본 탄환은 `null`이다.
clock·UV·정의가 일치해야 하며, 무한/음수/clip 밖 시간이나 잘못된 playback presence는 기존 씬 교체 전에 거절한다.
v4의 source/contact는 v3와 같은 `{ instanceId } | { spawnSerial }`을 사용한다.
actor catalog가 없으면 `spawnedActors: []`, `lastSpawnSerial: 0`이다. catalog가 있으면 v3의 생성·제거 source 계약을 유지한다.
회전 각도는 저장하지 않고 복원된 속도와 현재 camera에서 계산한다. texture slot과 native handle은 저장하지 않는다.

이 기능은 별도 visual capability v1·최대 combat codec4·cold gameplay v8 설정을 함께 요구한다.
구형 build는 apply/assets/save/restore 전에 거절한다. TS와 Wasm을 함께 업데이트한다.
바깥 snapshot v2/nested Data Scene v9, 기존 numeric codec1/2/3와 15-float flat/spatial render ABI는 유지한다.
`report.visualCases`는 실제 화면의 atlas 색·투영 회전·각 탄환 시계, fresh handle/texture remap 복원 픽셀 일치와 pause를 검사한다.

### 전투 checkpoint 저장·복원 (개발 소스)

`engine.supportsDataSceneCombatProgress()`는 native codec v1/v2/v3/v4를 검사한다. 이전 자동/입력 사격 Wasm에서는
false이며 전투 capture/restore를 변경 전에 거절한다. TS와 Wasm을 함께 최신화한다.

```ts
import { captureGameStateSnapshot, stringifyGameStateSnapshot, parseGameStateSnapshot, restoreGameStateSnapshot } from "@ferrum2d/ferrum-web/core";

const checkpoint = captureGameStateSnapshot(engine, {
  includeDataSceneState: true,
  includeDataSceneProgress: true,
  dataSceneAuthoringDocument: document,
});
const json = stringifyGameStateSnapshot(checkpoint);
restoreGameStateSnapshot(engine, parseGameStateSnapshot(json), {
  dataSceneAuthoringApplyOptions: { spatialModelPreparer: renderer },
});
```

전투 문서는 `includeDataSceneProgress`와 전체 기본 authoring apply 문서가 필요하다. nested Data Scene v9의
`progress.combat`은 `version`, `actors`, `projectiles`, `contacts`를 갖는다. 기본 탄환은 version 1이며,
정적 projectile prefab catalog는 version 2, actor catalog는 version 3, 탄환 animation/회전 catalog는 version 4다. 바깥 snapshot version 2/nested Data Scene v9는 유지한다. 탐험 문서에 combat payload를 넣거나
v8 이하 전투 저장·진행 없는 전투 저장을 전달하면 거절한다. 별도의 `physicsWorld` snapshot과 결합하지 않는다.

- `actors`: 살아 있는 authored instance의 고정 ID, pose/heightSpan/회전·선형/각속도, 체력·남은 수명,
  timer ID/남은 시간/fired, action ID별 cooldown, collision reaction 슬롯별 cooldown을 저장한다.
  제거 상태·상호작용 consumed·animationSet·공간 카메라/환경·선언 변수는 기존 progress/custom 경로를 함께 사용한다.
  부모에 연결된 자식 pose는 저장하지 않고 authored 부모 관계에서 계산한다.
- `projectiles`: 발사자의 고정 ID, 위치/속도/높이, 남은 수명·피해·collision target, atlas UV,
  sprite/AABB 크기·billboard 선명도/시각 높이·faction을 저장한다. version 2의 전용 탄환은 `prefab` 이름도 저장하며
  크기·UV·collider·선명도는 원문의 정의와 일치해야 한다. texture와 색상은 복원한 catalog에서 해석한다.
  JSON에는 native handle이나 texture slot을 담지 않는다. 발사자가 이미 제거됐어도 원래 ID를 사용하고,
  복원 시 새 authored sprite 또는 prefab catalog의 texture slot을 확보한 뒤 제거 상태와 탄환을 복원한다.
- `contacts`: 이전 step에서 접촉한 살아 있는 authored ID 쌍을 보존한다. 복원 직후 enter-only 효과를 다시 발생시키지 않는다.
- inline static/kinematic body를 지원한다. dynamic body·joint·FSM, authored 외 추가 개체,
  저장 형식이 다루지 않는 정적 레시피/콜라이더/시각 정의 변경은 capture를 거절한다.
  `configureDataSceneGameplay`로 실행 구성을 다시 설정하면 저장 metadata를 무효화하므로 문서 전체를 재적용한다.
  체력/수명/timer/cooldown의 존재·범위·ID/슬롯을 원문 레시피와 대조하고 native가 전체 batch를 검사한 뒤 적용한다.
- 입력 상태/latch, fixed-step accumulator, route, collision 진단, 파티클/RNG·tween·audio/effect/event buffer,
  누적 전투 통계는 재설정한다. runtime fixed-step 설정은 유지하며 프레임 단위 deterministic replay 계약은 아니다.
  `playing`/`paused`/`levelComplete`는 기존 lifecycle 저장을 따른다. legacy strip animation 재생 시각은 저장하지 않는다.

새 engine에서는 모델/텍스처와 particle preset을 먼저 준비하고 입력 binding을 다시 설치한다.
입력 관리자에서 누른 상태가 남았다면 `input.clear()` 후 재개한다.
authoring 전체 적용 및 사용자 custom callback 전체의 rollback 계약은 기존과 같다.
전투 actor/projectile 전체는 최대 2048개, 생존 projectile은 512개, contact는 4096쌍이며 capacity 초과를 거절한다.

`smoke:hd2d-combat`는 기존 부하 12조건에서 JSON roundtrip 후 저장 상태 일치를 검증한다.
같은 gate의 `checkpointCases`는 viewport/DPR 4조건에서 비행 중 탄환을 저장하고 새 generation으로 복원해
실제 피해가 이어지는지, 잘못된 체력 payload가 기존 장면을 보존하며 거절되는지 확인한다.


### 다층 전투 AI 길찾기 (개발 소스)

`gameplay.combatNavigation`을 선언하면 combat의 `chase`가 기존 공간 지형과 `spatial.connections`를 따라 이동한다.
`combat: true`, `primaryActor`, spatial terrain/카메라와 `engine.supportsDataSceneCombatNavigation()`을 요구한다.
설정을 생략한 장면은 기존 직접 추적을 유지한다. `movementPatterns` 생략 또는 `"chase"`는 Chase만 관리한다.
`"all"`은 아래 계약에 따라 `seekTarget`·`accelerate`도 관리하며 별도 native 기능 검사를 요구한다.

```json
{
  "gameplay": {
    "primaryActor": "actor",
    "combat": true,
    "combatNavigation": {
      "cellSize": 8,
      "maxStepHeight": 8,
      "maxDropHeight": 40,
      "repathIntervalSeconds": 0.5,
      "arrivalRadius": 4,
      "maxAgents": 32
    }
  }
}
```

각 필드는 생략 시 위 기본값이다. cellSize는 0 초과~4096, step/drop은 0~65536,
repath는 0.05~60초, radius는 0~4096, maxAgents는 정수 1~64이며 모두 f32로 표현 가능해야 한다.
cellSize는 지도 크기와 경사에 맞춰 정한다. cellSize를 과도하게 줄이면 4096개 grid node(별도 출발/도착 node 2개) 또는 작업 예산에 걸릴 수 있다.
경사에서 한 cell을 이동할 수 있도록 maxStepHeight/maxDropHeight도 함께 지정한다.

- 추적 source는 primaryActor를 제외한 활성 inline kinematic body + heightSpan + 단일 enabled AABB다.
  trigger AABB도 허용한다. attachment source는 거절하며 모든 authored Chase 수를 maxAgents가 수용해야 한다.
- primaryActor/명시적 target은 inline heightSpan body가 필요하다. nearest layer/faction/tag는 heightSpan이 있는
  실제 entity를 고르며 자기 자신을 제외한다. 최근접 거리는 평면 좌표와 elevation을 함께 사용한다.
- 같은 XY의 다른 층도 실제 connection을 통해 이동한다. source/target generation·floor·지형 연결 변경,
  외부 위치 수정·동적 벽으로 막힌 경우는 캐시를 취소하거나 다시 탐색한다. 벽은 WALL category와 양방향
  collision mask·height를 함께 적용한다. 선택적 군중 회피는 아래 설정을 따른다.
- outer update당 A* slice 또는 군중 보강 검색 1회, 전체 agent의 검색/준비/이동에 1,000,000 work를 허용한다.
  정적 경로는 slice 목표262,144·요청 전체8,000,000 work로 프레임을 나눠 탐색한다.
  큰 query 준비 또는 분할할 수 없는 단일 edge에는 기존600,000 slice 상한을 유지한다. 선택적 군중 보강은 기존600,000 상한이다.
  fixed substep도 이 예산을 공유한다. round robin으로 처리하며 경로 실패·예산 보류 시 멈춘다.
  계단을 직접 가로지르는 fallback은 없다. 큰 장면은 지형 분할/적 수/cellSize를 함께 조정한다.
- target이 이동하면 repath 간격 이후 경로를 갱신한다. 이 간격은 최소 재시도 대기 시간이며, agent 수와 공유 예산에 따라 더 늦어질 수 있다. target generation/floor 변경은 즉시 기존 경로를 취소한다.
  pause는 경로 진행/재탐색 시간을 멈추며, checkpoint는 기존 v9 형식의 authoring과 위치/높이를 복원한 뒤 새 경로를 만든다.
  캐시·탐색 순서·진단은 저장하지 않으므로 동일 프레임 replay를 보장하지 않는다.

`engine.dataSceneCombatNavigationStats()`는 enabled/agents/moving/waitingOrBlocked,
searches/failed/deferred, frameSearches/frameWorkUnits와 최근 request status/nodes/probes의 복사본이다.
status는 기존 spatial request의 0~8 code이며, deferred는 agent-step별 보류 누계다.
work unit은 보수적인 CPU 탐색·충돌 비용 단위로 GPU 시간이나 ms가 아니다.
이 진단은 구형 Wasm에서 undefined다. 기능을 사용하는 문서는 구형 Wasm에서 apply/restore 전에 거절한다.


### SeekTarget·Accelerate 공간 이동 (개발 소스)

`combatNavigation.movementPatterns: "all"`을 선언하면 primaryActor를 제외한 유효한 최종
Chase/SeekTarget/Accelerate 전체가 같은 최대 agent 수와 outer frame 작업 예산을 공유한다.
생략/`"chase"`는 종전 설정·소유권을 유지한다. 새 모드는
`engine.supportsDataSceneCombatMovement()`가 true인 Wasm을 요구하며, 구형 build는 문서 적용과
checkpoint capture/restore 전에 거절한다. source는 모두 inline kinematic 단일 enabled AABB와
heightSpan을 가져야 하며 attachment/소유 탄환은 지원하지 않는다. 최대64개다.

- SeekTarget은 기존 target query로 목표를 정하고 공유 A* route의 waypoint로 방향을 계산한다.
  `turnRate`는 기존과 같이 매 simulation substep의 0~1 보간 계수이며 초당 회전 각도가 아니다.
  0은 이전 velocity를 유지하고, 정지 상태에서는 출발하지 않는다. 1은 즉시 방향을 맞춘다.
  계산된 0 속도나 벽에서 거절된 방향도 다음 substep에 이어져 반전·회전이 누적된다.
  실제 이동은 native 벽/heightSpan/양방향 mask·보행면·층간 gateway 검사를 통과해야 한다.
  작은 중간 waypoint는 검증된 다음 edge로 진행할 수 있으며 최종 목표의 같은 support에서만
  arrivalRadius에 정지한다. 한 step이 도착 원을 관통해도 최초 진입에서 자른다.
- SeekTarget은 공통 `arrivalRadius`를 사용한다. `chase.stopDistance` 바인딩은 Chase 전용이다.
  `crowdAvoidance`를 켜면 세 이동 패턴 모두 같은 peer AABB·padding 검사를 받는다.
- Accelerate는 이전 velocity에 `accelerationX/Y`를 매 simulation substep 더하고 `maxSpeed`로 제한한다.
  기존과 같이 가속 값은 초당 단위가 아니다. 방향을 계획하거나 목표를 자동 탐색하지 않으며,
  해당 velocity로 작성한 step/drop과 실제 층 연결을 따라 이동한다. 막힌 경우 통과하지 않고
  이동 의도를 유지한다. 별도 A* 검색 token은 소비하지 않으나 준비/충돌/이동 work는 공유한다.
- 예산 전에 보류된 source는 기존 velocity를 보존한다. 실제 이동은 native가 한 번만 적분한다.
  pause는 pose와 velocity 모두 유지한다. 기존 v9 checkpoint는 authoring 모드·실제 위치/높이와
  velocity를 저장하고 fresh handle로 복원하며 경로/job/cache는 다시 만든다. 동일 frame replay는 보장하지 않는다.

새 native v6 설정은 기존 v5 buffer에 mode flag를 추가하며 모든 source/설정을 검증한 뒤 적용한다.
기존 v4/v5·navigation13u32/crowd7u32/scheduler10u32 진단·공간/render ABI와 저장 버전은 유지한다.

### 공유 경로·프레임 분할 탐색 (개발 소스)

combatNavigation의 정적 A*는 한 개의 scene 소유 job으로 이어서 실행한다. 노드 생성·heap·현재 edge 진행을
유지하고 매 slice가 끝날 때 transform/heightSpan/velocity와 query scratch를 복원한다. 4096 grid node,
32768 probe 상한은 유지한다. 기본 slice에서 진전이 없는 단일 edge는 기존600K slice로 한 번 확대한다. 이 상한에도 들어가지 않으면
무한 대기 대신 frame-budget 실패로 거절한다. work unit 상한은 wall-clock 시간 보증이 아니다.

같은 target generation/goal pose·높이·source AABB/offset/mask/height·cell/radius/step/drop·terrain revision의
정적 경로를 최대8개 공유한다. 같은 support에서 2cell 이내 경로 진입점을 native sweep으로 검증한 뒤
복사하며, 이후 edge도 follower가 실제 벽/높이를 다시 검사한다. 동적 벽으로 막히면 공유 캐시를 비운다.
군중 보강 경로는 공유하지 않는다. 경계 밖 peer corner에는 같은 floor의 경계 안 점과
명시적 connection으로 연결된 인접 보행면의 원래 corner를 최대8개/peer로 추가한다. 전체4096 node와
600K 보강 예산을 유지하며, 두 지점 사이도 native gateway/peer sweep을 통과해야 한다. 처리 순서는 실제 simulation outer frame에서만 순환하며,
취소된 job의 owner는 같은 순회에서 즉시 재시작하지 않아 다른 source에게 차례를 준다.

pending 중 같은 층 target의 XY 이동은 현재 요청의 목표로 합쳐 처리하고 완료 후 repath 간격에 따라 갱신한다.
target generation/floor/height, source pose/footprint/speed, terrain revision 변경은 job을 취소한다.
pause는 job도 정지한다. checkpoint는 authoring/실제 pose만 저장하며 pending job·공유 경로·진단은
저장하지 않고 fresh handle로 다시 탐색한다. v4/v5 설정과 기존13u32 navigation 진단은 유지한다.

`supportsDataSceneCombatNavigationScheduler()`와 `dataSceneCombatNavigationSchedulerStats()`를 추가했다.
후자는 enabled/pendingSearches/cachedRoutes/cacheHits/searchSlices/yieldedSlices/cancelledSearches,
frameSearchWorkUnits/peakSearchWorkUnits의 복사본이며 구형 Wasm에서는 undefined다. 별도 version1의
10u32 ABI를 사용한다. pending slice는 실패로 세지 않고 기존 lastRequestStatus는0이다.
기존 searches는 시작한 요청 수, frameSearches는 해당 outer의 검색 slice/보강 횟수다.

### 군중 회피·적별 정지 거리 (개발 소스)

`combatNavigation.crowdAvoidance: { padding: 0.25 }`를 추가하면 관리 중인 최대64개 source(기본 Chase, all 모드에서는 SeekTarget/Accelerate 포함)가
같은 층·겹치는 높이와 양방향 충돌 mask를 확인해 서로의 AABB를 피한다. padding 기본값은0이며
0~4096의 유한한 f32 값이다. 설정을 생략하면 기존 겹침 동작을 유지한다.
기존 `chase.stopDistance`(0~4096)를 개체별 도착 반경으로 사용하며, 목표와 같은 층·보행면에서만
정지한다. 거리 기준은 entity transform의 XY다. 시야/공격 가능 여부를 판정하는 기능은 아니다.

```json
{
  "gameplay": {
    "primaryActor": "actor", "combat": true,
    "combatNavigation": { "crowdAvoidance": { "padding": 0.25 } }
  },
  "behaviorRecipes": {
    "entities": {
      "archer": { "recipes": [{ "kind": "chase", "speed": 64, "stopDistance": 24 }] }
    }
  }
}
```

- crowd 문서는 모든 유효 Chase의 stopDistance를 사용한다. crowd가 없으면 양수 stopDistance만 개별
  반경으로 지정하고 나머지는 기존 `arrivalRadius`를 사용한다. 모두0인 기존 문서의 도착 동작은 유지한다.
  원문 recipe를 전체 Data Scene에 적용해야 한다. standalone movement setter는 여전히0만 받는다.
- 매 follower substep에 최대8개 방향 후보를 native 벽·보행면·step/drop·층간 gateway sweep으로
  시험한다. peer lookahead는 같은 평탄한 보행면에서만 적용해 층 전환 너머의 높이를 오인하지 않는다.
  겹친 spawn은 점진적으로 빠져나오며, 정지한 적을 강제로 밀지는 않는다.
  중간 경로점은 같은 보행면 또는 연결된 인접 보행면의 한 cell 이내에서 다음 점으로 진행할 수 있다.
  다음 점까지 전체 native sweep이 통과해야 하므로 벽의 필수 코너는 보존한다. 최종 정지 거리는 유지한다.
- 최초/목표 변경은 기존 지형 경로를 계산한다. crowd는 repath 간격마다 현재 peer를 피하는 경로로
  보강한다. peer AABB 모서리와 도착 원의 보조 node를 기존4096 node/작업 상한 안에 추가해
  큰 grid 사이의 좁은 틈도 표현한다. 보강 탐색이 실패해도 같은 목표의 유효한 기존 경로는 유지하며
  실제 이동은 매번 crowd sweep을 통과한다. 목표·층·지형이 바뀐 기존 경로는 취소한다.
- 목표 중심 자체가 막혀 있어도 같은 보행면의 도착 반경에 들어가는 지점을 탐색할 수 있다.
  이동 선분이 도착 원에 진입할 때 prefix를 잘라 거리 오차를 줄인다. 층 진입 시 이미 반경 안이거나
  저장/외부 배치가 반경 안이면 그 위치에서 멈춘다. 큰 f32 좌표에서 이상적인 경계점을 표현할 수 없으면
  실제로 표현 가능한 반경 안 점을 사용하며, 반경 밖 위치를 도착으로 처리하지 않는다.
  시야나 공격 line-of-sight 계약은 아니다.
- 기존 outer update 전체1M work를 공유하며 neighbor 검사도 비용에 포함한다. 좁은 입구/서로 막는 적은
  기다릴 수 있다. 전역 군중 최적화나 모든 배치의 도착 시간을 보장하는 solver는 아니다.
- 새 `supportsDataSceneCombatCrowd()`가 true여야 새 설정·저장 복원이 가능하다.
  `dataSceneCombatCrowdStats()`는 enabled, stoppedAgents, yieldedMoves, neighborTests,
  frameNeighborTests, frameAvoidanceMoves를 반환한다. 두 누계는 reset/configure/restore 때 초기화된다.
  기존 navigation 진단 ABI와 checkpoint v9는 유지하며, 원문 설정과 fresh handle을 복원한 뒤 재탐색한다.

저수준 `DataSceneGameplayOptions.chaseBindings`는 generation-safe source/stopDistance를 받는
cold 설정이다. 전체 문서는 이를 자동 생성한다. 중복 source·잘못된 거리·stale/primary/탄환 source는
원자적 native batch 적용 전에 거절한다. render ABI와 프레임별 JS/Wasm 호출 수는 바뀌지 않는다.
