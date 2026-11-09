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
| `display` | 아니오 | flat 2D의 선택 `pixelPerfect` 표시 설정. 가상 해상도·정수 확대·여백을 정의한다. |
| `lighting` | 아니오 | world 좌표의 flat `LightingScene2D`. 공간 문서와 동시 지정 불가. [조명 작성·patch 계약](public-api/authoring.md#2d-scene-lighting-placement-patch)을 따른다. |

최소 scene은 `sceneComposition.prefabs`, `sceneComposition.fragments`, `behaviorRecipes.entities`만으로 검증 가능해야 한다. starter scene adapter가 쓰는 `runtimeEntity`, `builtinShooterPlayer`, `builtinBreakoutPaddle` 같은 binding은 create-game 템플릿용 확장이지 최소 Data Scene 계약이 아니다.

공간 sprite의 color는 기존 `props.components.visual.texture` 문자열, normal은 선택형
`spatial.billboards[id].normalTexture` 문자열로 저장할 수 있다. numeric `normalTextureId`와 동시 지정할 수 없으며,
적용 전에 현재 texture registry에서 해석한다. 별도 생성 binding JSON에는 provenance를 보관하고
scene에는 에셋 이름·UV/animation만 넣는다. 생성 binding/combined patch/handoff는
[노멀맵 binding 계약](data-scene-spatial.md#생성-에셋-binding과-패치handoff)을 따른다.

## 기본 2D 표시 설정

```json
{
  "display": {
    "pixelPerfect": { "width": 320, "height": 180, "snap": true, "background": [0, 0, 0] }
  }
}
```

위 설정을 기존 Scene Authoring v1 문서의 root에 추가한다. `SceneDisplaySpec`와 `resolveSceneDisplay`는
`/core`와 `/authoring`에서 제공한다. 한 변은 1~2048 정수, 총 1,048,576픽셀 이하이며 RGB는 각 0~1이다.
`display`/`pixelPerfect`의 알 수 없는 필드는 오류다. `false`는 runtime 기본 표시 설정을 해제하며,
생략하면 runtime 기본값을 사용한다. `spatial` 문서에서는 flat 설정을 켤 수 없다.

선택 `snap`은 boolean이며 생략·`false`는 기존 출력을 유지한다. `true`는 카메라 변환 후의
스프라이트·타일 화면 경계를 가상 픽셀에 정렬한다. 회전·투영 그림자는 원점 이동만 정렬한다.
게임 좌표·충돌·저장 형식·render command ABI는 유지하며 atlas 번짐 방지는 별도 범위다.
광원·물리 debug·포인터/world 변환은 연속 좌표를 사용한다. 정렬 경계와 작은 객체의 처리 등은
[Core 표시 계약](public-api/core.md#기본-2d-픽셀-퍼펙트-표시)을 따른다.

공식 뷰어에서 JSON을 열고 **게임 미리보기** 또는 **실행**을 누르면 표시 설정을 적용한다.
2D 편집 화면에서는 넓은 편집 viewport를 유지하며 돌아오면 편집 카메라 위치·zoom과 객체 선택 좌표계를 함께 복원한다.
flat 미리보기의 기본 카메라 중심과 zoom 1을 사용한다. 게임 코드가 별도로 설치하는 카메라 follow/스크립트는
프로젝트 런타임에서 설정해야 한다. 표시 설정을 바꾸는 전용 Inspector UI는 아직 없으며 JSON으로 작성한다.
기본 예제의 표시 설정은 변경하지 않는다.

창이 작으면 nearest 축소(`integerScale: false`)를 사용한다. 포인터 변환과 여백 클릭 처리는
[Core API](public-api/core.md#기본-2d-픽셀-퍼펙트-표시)를 따른다. 저수준 apply 함수는 문서를 검증·적용하며
renderer 설정은 호출자가 연결한다. `createFerrumRuntime({dataScene})`는 이 연결을 자동 수행한다.

## Object Definition And Instance

Ferrum2D authoring 문서에서 `sceneComposition.prefabs`는 재사용 가능한
`ObjectDefinition` catalog 역할을 한다. 기존 타입명 `SceneCompositionPrefabSpec`은 호환을 위해 유지하지만,
문서와 placement tool에서는 `Prefab/ObjectDefinition`을 병기한다.

`sceneComposition.fragments[].instances[]`의 각 항목은 `ObjectInstance`다. instance는 안정적인
`instance.id`, 참조할 `prefab`, transform, optional `variant`, 제한된 `props.components` override를 가진다.
공식 placement viewer가 저장하는 patch는 UI-owned transform, add/remove/rename, `props.components`
전체 교체만 수행한다. behavior recipe 본문, FSM command, gameplay sequence는 agent-owned 영역으로 남기고,
rename/remove 시에는 binding migration preview 또는 conflict diagnostic을 먼저 노출한다.

공식 뷰어의 선택·화면 이동은 2D/HD-2D 뷰포트 왼쪽 도구 모음에 둔다.
**Ctrl+K(Mac `⌘K`)·F3 / 명령 검색**은 한국어·영문 이름으로 기존 도구·보기·패널·도트 동작을 찾는 앱 UI다.
현재 문서/모드와 버튼의 사용 가능 상태를 실행 직전에 확인하며, 저장·gesture·미확정 도트 편집·다른 modal을 우회하지 않는다.
검색/취소는 원본과 Undo를 바꾸지 않고, 명령 실행은 기존 authoring/패널 동작에 위임한다. 별도 JSON 필드를 추가하지 않는다.
`보기 → 화면 구성`의 내 구성·씬 배치·자산 작업·게임 검토는 프로젝트별 UI 패널 프리셋이다.
F3의 `레이아웃` 검색에서도 전환하며 구성별 크기·숨김을 기억한다. 현재 구성 초기화는 다른 구성을 덮어쓰지 않는다.
뷰 모드·게임 재생·활성 문서·선택·초안·Undo와 도트 편집 상태를 유지하며 진행 중 gesture/저장/미확정 편집에서는 전환하지 않는다.
Inspector는 변형·시각 입력을 먼저 표시하고 식별/진단 정보는 기본으로 접는다. 2D의 회전은 rad, 크기는 배수이며 공간 회전은 도 단위를 유지한다.
선택/잠금/다중 선택/게임 안내는 기존 control의 capability를 설명할 뿐 새 편집 권한이나 patch 필드를 추가하지 않는다.
속성 검색·변경 필터·고급 표시는 입력 DOM과 미확정 값을 유지하는 보기 설정이다. 지원 필드의 복귀는 현재 문서를 열거나 저장한 원본값으로 한 Undo에 반영한다.
구성 요소의 복귀는 해당 leaf만 바꿔 노멀·애니메이션·그림자·바디와 다른 입력을 보존한다. 원본 없는 객체·구조 변경·제거 미지원 optional 값은 임의 기본값으로 복귀하지 않는다.
에셋 카드 클릭은 검사 대상만 바꾼다. 상세의 배치·도트·노멀·사용처는 기존 작업에 위임하며 씬 객체 선택을 자산 검사와 구분한다.
가져오기/노멀의 주 동작·다른 작업과 단계 표시는 등록·씬 적용·파일 저장을 자동 연쇄 실행하지 않는다. 저장·참조·stale 가드는 그대로 유지한다.

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
이 절의 Frame/Reimport는 프레임 참조를 다룬다. 타일/객체 일괄 배치는 아래 Apply Map의 명시적 옵션과 지원 범위를 따른다.

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
Tiled/LDtk와 Aseprite Import 패널의 **Catalog → Clean Unused**(자산 목록 → 미사용 정리)는
열린 문서의 원본·현재 draft·Undo/Redo·transaction, 모든 Import 후보와 업로드 중 revision을 보존하고
나머지 **미저장 세션 revision**의 source bytes·Blob URL·GPU texture를 명시적으로 정리한다.
문자열 자산명과 현재 runtime의 숫자 texture alias를 모두 확인한다. 숫자 reference는 세션 내 보존 근거이며 원본 ID의 저장·이식 보장을 추가하지 않는다.
정리로 기존 8건/64 MiB 예산을 회수하며 예산을 자동 확대하지 않는다. GPU 해제 실패 시 원본/등록 항목을 유지하고 texture 복원을 시도한다.
프로젝트에 저장·검증한 revision은 보호한다. 디스크 catalog/원본 파일 GC 기능은 아니다.
공식 앱의 **Assets → Manage → Asset Usage**는 씬 탐색기 범위의 닫힌 씬과 열린 작업공간 원본/draft에서
texture·normal·model/LOD의 authored 문자열 참조를 읽고 씬 경로·정의/객체 ID·JSON pointer를 표시한다.
정의/variant·비활성 fragment/include도 포함하며 prefab 상속은 원본 정의의 경로로 남긴다.
숫자 texture·외부 template은 해소하지 않으며 파일/분석 한도·읽기 실패를 명시한다.
참조 영역의 composition/components/spatial은 기존 SDK parser로 구문을 검사하되 include를 전개하거나 전체 게임의 실행 가능성을 판정하지 않는다.
잘못된 영역의 원본 참조도 근거로 보존한다. 원문 UTF-8 바이트(공백 포함)를 세며 열린 snapshot은 복제 전에 제한한다.
참조 owner는 선언된 instance/surface ID 또는 prefab/model/billboard key만 사용한다. `props.id`를 객체 ID로 간주하지 않으며 식별자 한도 초과는 잘린 ID 대신 문제로 기록한다.
결과는 조회 당시 근거이며 코드·외부 manifest·GLB 내부·Undo 이력이나 전체 디스크를 검증하지 않는다.
등록되지 않은 참조도 표시하지만 참조 미발견은 삭제 허가가 아니다. 별도 SDK/schema/GC API가 아니라 앱 전용 조회다.
보고서는 `ferrum2d.asset-usage` v1과 `deletionAllowed:false`를 사용한다.
상한·폴더 snapshot·검색/내보내기 사용법은 `apps/placement-viewer/README.md`의 에셋 사용처 조회 절을 따른다.

데스크톱의 **Assets → Manage → Catalog Cleanup**은 별도의 관리 원본 정리 흐름이다.
명시적으로 연 프로젝트의 pixel/Aseprite/tile/normal Catalog를 기존 parser로 검증하고,
닫힌 씬을 포함한 public JSON·관리 원본/metadata와 열린 저장/초안의 보수적 문자열 참조를 보호한다.
사용자가 한 Catalog의 미참조 revision을 선택하면 전체 원본을 `.ferrum-asset-backups/<작업 ID>/`에 보관하고
live Catalog와 다른 revision이 공유하지 않는 파일을 정리한다. 일반 파일·씬·백업의 영구 삭제는 하지 않는다.
동적 코드·GLB 내부·외부 파일의 미사용 판정은 아니며 SDK/schema/GC API를 추가하지 않는다.
쓰기 직전 전체 fingerprint와 Catalog bytes를 재검사하고 충돌 시 새 편집을 보존한다.
미저장 씬·Undo/Redo·미적용 속성·도트/에셋 초안·실행/로딩/gesture를 보호하고, 쓰기 시도 뒤 프로젝트 재열기를 요구한다.
복구는 완전한 백업과 Catalog의 before/after hash가 일치할 때만 허용한다.
백업 목록은 현재 JSON 분석과 독립적으로 조회하므로 닫힌 JSON의 손상에도 복구에 진입할 수 있다.
리비전 ID도 참조로 보호하며 숫자 `texture`/`normalTexture`는 이름을 확정할 수 없어 모든 후보를 보호한다.
참조/용량 한도와 백업 비용은 [호스트 구조](../development/architecture/architecture.md#프로젝트-관리-catalog의-복구-가능한-정리)를 따른다.
메뉴별 복구 절차는 앱 안내(`apps/placement-viewer/README.md`)의 프로젝트 디스크 Catalog 정리 절을 따른다.

실제 참조 frame 누락은 **Import Diagnostics**와 **Problems**에 원본 JSON 파일·collection pointer·frame ID와
현재 씬의 정확한 JSON pointer를 표시한다. prefab 상속은 해당 prefab의 원본 경로를 표시하며 경로는 최대 64개다.
진단 수집은 순회 65,536단계·pointer 4,096자 상한을 사용하고 제한/순환 참조로 일부를 생략하면 `scenePathsTruncated:true`를 표시한다.
최신 진단은 이벤트 수신 시점과 무관하게 읽을 수 있어 Problems 패널이 나중에 열려도 오류가 누락되지 않는다.
Inspect 오류도 원본 파일과 함께 표시하고 실패한 import가 기존 씬을 변경하지 않는다. 진단 payload의 ID/경로는 번역하지 않는다.
문서/모드 전환은 진행 작업을 취소하고 문서 닫기는 그 문서의 미저장 URL/texture를 해제한다.
검증·저장된 같은 프로젝트 에셋은 다른 씬에서 계속 참조하도록 작업공간 종료까지 유지한다.
브라우저의 미설치 참조는 scene Save를 막는다. native Open Project의 기본 문서는 아래 Save Project 경로를 사용하고,
그 밖의 host/문서는 agent가 export의 hash·manifest와 동반 scene/patch를 확인해 프로젝트에 설치한다.

### Tiled/LDtk 전체 맵 적용 (개발 소스)

2D 문서의 **Import Tile Frames → Apply Map / 전체 맵 적용**은 검증한 원본의 타일/객체를 활성 fragment에 배치한다.
같은 논리 에셋 이름으로 다시 적용하면 그 맵이 소유하는 그룹만 교체하며 한 번의 Undo/Redo로 되돌린다.
기존 **Reimport**는 프레임 참조만 교체한다. 원본의 셀 배치·객체를 다시 반영할 때는 **Apply Map**을 사용한다.

**Map Options / 맵 배치 설정**의 JSON은 아래 선택 필드만 받는다. 숫자 위치는 활성 fragment 좌표이며 기본 원점/레이어는 0이다.

```json
{
  "originX": 0,
  "originY": 0,
  "layerBase": -100,
  "collisionLayers": ["walls"],
  "objectPrefabs": { "Spawn": "hero" }
}
```

- 한 맵/LDtk embedded level과 PNG 한 장에서 시작하며, 최대 2,048 instance다.
  선택 때문에 제외된 타일이 있으면 전체 맵인 것처럼 적용하지 않고 거절한다.
  다른 tileset·TSX·외부 level·IntGrid·flip/회전의 기존 제한을 확대하지 않는다.
- Tiled의 직교 셀·레이어 offset과 원래 앞뒤 순서를 반영한다. Group은 먼저 평탄화해야 한다.
  LDtk는 원래 layer 순서와 offset을 반영하며 Entities의 x/y와 필드를 보존한다.
  타일 이미지 크기는 셀 크기와 같아야 하고, Tiled tileset offset·반투명/tint/parallax layer,
  slope/one-way/공간 높이 metadata는 전용 adapter가 필요한 항목으로 거절한다.
- `collisionLayers`는 정확한 layer 이름이다. 명시적 collision/blocksMovement 셀과 함께 static AABB를 생성한다. 셀의 `blocksMovement:false`는 collision layer에서도 비충돌로 보존한다.
  다른 셀은 collider가 없다. 게임의 충돌 그룹은 `wall`이고 그리기 레이어 번호와 구분한다.
- Tiled rectangle/point object의 class/type, LDtk entity identifier는 `objectPrefabs`의 기존 prefab에 명시적으로 연결한다.
  회전·tile object·polygon/ellipse·template는 지원하지 않으며, 미지정 mapping도 거절한다.
  Prefab의 게임 동작은 기존 프로젝트 정의를 사용하고 import UI가 behavior 본문을 만들지 않는다.
- 생성 instance/정의의 `props.tileMapImport`는 이름·source lineage·셀/객체 key와 선택 배치 설정·읽기 전용 원본 필드를 보관한다.
  source가 그 그룹의 pose/components를 소유하므로 재적용은 수동 변경을 교체한다. 잠긴 그룹과 다른 source identity는 거절한다.
  명시적으로 연결/해제한 instance behavior binding은 기존 binding patch로 보존한다. override가 없으면 대상 prefab의 binding을 상속하고, 같은 prefab의 variant는 유지한다.
  이 범위 밖의 추가 authored prop은 조용히 버리지 않고 적용을 거절한다. include된 맵은 소유 fragment에서 연다.
- 새 타일의 ID는 layer·grid column/row를 기준으로 대응하므로 맵 너비가 바뀌어도 같은 셀은 같은 ID를 유지한다.
  구형 index key는 저장된 `assetId`의 원본 revision이 catalog에 있어야 재적용할 수 있다. 기존 ID/key는 유지하고 `cell` 좌표를 추가한다.
  원본이 없으면 원본 catalog를 다시 열거나 agent가 명시적으로 migration하도록 진단하며 편집된 pose로 추측하지 않는다.
  게임 로직은 이 provenance를 해석하지 않는다. [패치 경계](public-api/authoring.md#타일-맵-provenance)를 따른다.
- GPU 업로드·문서/선택/잠금 재검증과 기존 asset transaction을 재사용한다. 실패하면 전체 초안을 취소한다.
  원본 PNG/JSON/TSJ와 이 metadata는 기존 Save Project·Export Assets·새 세션 재열기 경로를 따른다.
  저장 완료 시 새 기준 문서와 깨끗한 viewer를 함께 교체해 add-definition 패치가 중복 적용되지 않는다.

### 작성 시점 오토타일과 맵 미리보기

2D의 **Map Options → Preview Map / 맵 미리보기**는 원본 격자를 계산한 뒤 타일 이미지와 객체 위치를 보여준다.
주황색 테두리는 충돌 셀이다. 미리보기는 GPU 자산 등록·씬 편집·Undo 기록을 만들지 않으며,
설정·원본·문서가 바뀌면 이전 이미지를 무효화한다. **Apply Map**으로 결과를 명시적으로 적용한다.
맵 미리보기 이미지 디코딩은 한 번에 하나만 진행하며 준비 중에는 미리보기 버튼이 비활성화된다.
준비 중 설정을 바꾸거나 도구를 종료하면 늦게 완성된 이미지는 표시하지 않고 해제한다.

Map Options의 선택적 `autotile`은 레이어 이름별 규칙을 받는다.
아래 예는 `ground` 레이어에서 위쪽이 빈 타일을 `terrain.1` 프레임으로 바꾼다.

```json
{
  "collisionLayers": ["ground"],
  "autotile": {
    "ground": {
      "rules": [
        { "match": "filled", "neighbors": { "n": "empty" }, "output": "terrain.1" }
      ],
      "preserveUnmatched": true,
      "emptyOutOfBounds": true
    }
  }
}
```

- `output`: 선택 tileset의 프레임 이름 또는 `null`(빈 셀). source GID가 바뀌어도 프레임 이름으로 다시 대응한다.
  원본 맵에서 아직 사용하지 않은 타일도 `tileset이름.로컬타일번호`로 참조할 수 있다.
  원본 importer로 해당 타일의 UV·충돌 metadata를 검증하며 기존 프레임과 규칙 참조의 합계는 256개까지다.
  개별 프레임 목록이나 원본 catalog를 늘리지 않으며, 이런 맵의 갱신은 **Apply Map**을 사용한다.
- `match`: 프레임 이름, 이름 목록(1~16개), `any`/`empty`/`filled`. 생략하면 `filled`다.
- `neighbors`: `n/e/s/w/ne/se/sw/nw`별 같은 조건을 지정한다. 이웃에는 현재 **원본** 타일과 같은 `same`도 허용한다.
- 원본 격자에서 처음 일치하는 규칙 하나만 적용한다. 결과를 같은 실행의 다음 규칙 입력으로 사용하지 않는다.
  불일치 셀은 기본적으로 보존하며 `preserveUnmatched:false`면 비운다.
  맵 밖은 기본적으로 빈 셀이며 `emptyOutOfBounds:false`면 해당 이웃 조건이 일치하지 않는다.
- 결과 타일의 `blocksMovement`와 기존 `collisionLayers` 정책으로 collider를 생성한다.
  이미지 규칙을 바꾸면 충돌도 달라질 수 있으므로 미리보기의 충돌 셀 수를 확인한다.
- 최대 16 레이어·전체 64규칙, 규칙 JSON UTF-8 8KiB, 계산 비용 2,000,000 단위다.
  Map Options 입력 전체는 UTF-8 16KiB까지 허용한다.
  비용은 원본 셀 수 × 규칙별 기본 비교 및 이웃/목록 비교량으로 제한한다.
  기존 2,048 instance 제한과 미지원 타일 속성 거절은 유지하며 전체가 빈 결과도 거절한다.
- 원본 JSON/PNG/TSJ와 revision identity는 그대로다. 규칙은 기존 `tileMapImport.options.autotile`에 저장하고,
  결과는 기존 sprite/AABB로 저장한다. 게임은 규칙을 다시 계산하지 않는다.
  기존 옵션 없는 씬·catalog와 호환되고 schema/ABI 버전을 바꾸지 않는다.
- 저장·재열기에서 설정을 복원하며 재적용은 같은 셀의 ID·behavior binding과 단일 Undo/Redo를 유지한다.
  HD-2D 전체 맵 적용과 런타임 지형 편집은 포함하지 않는다. 이미지 재생은 아래 타일 애니메이션을 사용한다.

### 타일 애니메이션과 고정 충돌

2D **Map Options**의 선택적 `animations`는 기준 타일 이름을 기존 sprite `animationSet`에 연결한다.
게임의 **실행**에서 Rust가 시간을 진행하고 **일시정지**하면 함께 멈춘다. 각 타일은 clip 0 하나를 가지며
맵을 다시 적용하거나 게임을 다시 시작하면 첫 프레임에서 재생한다. 설치된 SDK/Wasm에 프레임별 시간 지원이 필요하다.

```json
{
  "collisionLayers": ["ground"],
  "animations": {
    "terrain.0": {
      "frames": [
        { "frame": "terrain.0", "durationMs": 90 },
        { "frame": "terrain.1", "durationMs": 180 }
      ],
      "loop": true
    }
  }
}
```

- Tiled/LDtk 공통으로 선택 tileset의 프레임 이름을 사용한다. 오토타일을 함께 지정하면 **오토타일 결과**의 이름으로 clip을 고른다.
  아직 사용하지 않은 프레임도 원본 importer로 검증한다. 모든 재생 프레임은 같은 PNG와 기준 타일 크기를 사용한다.
- 순서는 `frames` 그대로, `durationMs`는 1~1,000,000ms 정수다. `loop` 기본값은 true이고 false면 마지막 프레임에서 멈춘다.
  프레임을 반복 복제하지 않는다. 방향 전환·재생 이벤트·시작 offset은 이 옵션에 포함하지 않는다.
- Tiled의 embedded/외부 TSJ 원본 animation은 `"animations": "source"`로 명시적으로 가져온다.
  [Tiled Frame](https://doc.mapeditor.org/en/stable/reference/json-map-format/#frame)의 tileset-local `tileid`와 ms `duration`을 사용하며 반복 재생한다.
  LDtk에서는 이름별 직접 설정을 사용한다. 원본에 animation이 있으면 옵션 없이 정적 타일로 묵살하지 않고 거절한다.
  직접 설정으로 덮어쓰려면 원본의 모든 animated tile에 대응하는 clip을 지정한다. clip 참조는 재귀적으로 확장하지 않는다.
- collider/body/위치/크기/ID는 **기준 타일**의 충돌과 배치 결과로 고정한다. 재생 프레임의 `blocksMovement`·높이 등은 물리에 반영하지 않는다.
  물의 그림만 움직인다고 통과 가능 여부가 바뀌지 않는다. 게임 로직으로 바뀌는 지형·문은 별도 behavior/spec으로 작성한다.
- **맵 미리보기 시간 (ms)**에 0~3,600,000 정수를 입력하고 **맵 미리보기**를 눌러 그 시점의 이미지를 확인한다.
  이 값은 보기 상태이며 저장·Undo·게임의 시작 시간을 바꾸지 않는다. 0ms가 첫 프레임이다. 주황색 충돌 테두리는 어느 시점에도 유지된다.
  정수 밀리초로 프레임을 고르므로 1,001ms 같은 정확한 전환 경계에서도 다음 프레임이 표시된다. 반복 구간의 끝은 첫 프레임으로 돌아간다.
- 설정은 최대 64 clips, clip당 256 frames, 전체 1,024 frame steps다. 배치된 애니메이션 타일의 frame 수 합계는 8,192 이하다.
  기존 Map Options 16KiB, palette 합계 256 frames, 맵 2,048 instances 및 history 예산도 함께 적용한다.
  저장되는 source 식별자·셀 좌표·옵션을 합친 `tileMapImport` 메타데이터도 16KiB 이하여야 하며, 초과하면 미리보기·적용 전에 거절한다.
- 원본 JSON/PNG/TSJ와 catalog 버전은 유지하고, 설정은 기존 `tileMapImport.options.animations`, 실행 데이터는 기존 `visual.animationSet`에 저장한다.
  **Apply Map** 재적용은 같은 셀의 ID·명시적 behavior binding과 단일 Undo를 유지한다. source가 소유한 clip 수동 수정은 교체한다.
  animated map에 일반 **Apply Frame/Reimport**를 사용하면 animation 손실을 막기 위해 **Apply Map** 사용을 안내한다.
  source 애니메이션이 없는 기존 정적 맵은 옵션 생략 시 같은 동작을 유지한다.

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

## 에디터 내장 도트 제작

**이미지 가져오기**는 웹 등에서 받은 로컬 정적 PNG를 원본/결과 미리보기로 비교하고 새 도트 문서로 변환한다.
드래그·수치 자르기, 비율 유지, 긴 변32/64/128/256 프리셋과1~256 직접 크기 입력, 최근접/알파 가중 영역 평균을 지원한다.
원본 색상 유지·자동8~256 RGB 색 제한·현재 도트 문서 팔레트 매핑을 선택한다. 별도 프로젝트 공통 팔레트를 의미하지 않는다.
색 제한은 투명도가 아닌 RGB를 제한하고, 완전 투명 팔레트 항목은 매핑 대상에서 제외한다. RGBA 원본 포맷은 변경하지 않는다.
입력 상한은16 MiB·한 변4096·4,194,304픽셀이며 디코딩 전 크기/정적 PNG 구조를 확인한다. 애니메이션 PNG는 거절한다.
PNG 디코드의 색 관리·알파 반올림은 브라우저 기준이다. 기본 **새 도트 문서** 출력은 기존 v1 단일 레이어·단일 프레임 원본이다. 저장/등록/씬 적용은 기존 명시적 동작을 사용한다.
가져오기 화면의 미리보기는 기존 문서·씬·Undo를 바꾸지 않는다. 새 문서로 교체할 때 미저장 변경 확인을 거치며, 취소·오류·문서/프로젝트 전환 후 늦은 결과는 폐기한다.
**새 레이어 · 현재 프레임**은 현재 캔버스 위 합성 미리보기와 X/Y 배치를 제공한다. 초기 크기는 원본을 확대하지 않고 캔버스에 맞춰 축소하며 중앙에 놓는다. 출력 크기·좌표가 캔버스 밖이면 적용을 거절하고, 임의 잘림/캔버스 확대는 하지 않는다.
적용은 현재 프레임의 최상단 새 레이어에 RGBA를 복사하고 다른 프레임의 새 cel은 투명하게 만든다. 기존 레이어/cel·팔레트·문서명·프레임 시간·태그/재생 방향을 유지하며, 미저장 변경을 버리지 않고 한 Undo로 추가한다. 원본 v1만 v2로 승격하고 기존 다중 프레임/태그 버전은 유지한다.
고정 atlas·8레이어·전체 cel 픽셀 예산은 model과 UI 양쪽에서 거절한다. 같은 문서에서도 revision/선택 프레임이 바뀌면 이전 가져오기 결과를 적용하지 않는다. 새 저장 포맷·runtime API는 없다.
도트 제작 영역/편집기의 PNG 파일 드롭과 네이티브 paste 이벤트의 PNG File도 같은 변환·취소·미저장 확인 경로를 사용한다.
제작 영역의 Ctrl/Cmd+V는 외부 이미지 입력이다. 편집기는 내부 복사본을 우선하며, 내부 복사본이 없거나 **이미지 가져오기** 버튼에 초점이 있으면 외부 이미지를 받는다.
텍스트 입력·씬 에셋 드래그는 가로채지 않는다. 재생·저장·포인터 편집·미확정 선택·열린 모달 중에는 새 입력을 거절하며, 거절한 파일 드롭도 브라우저 탐색을 막는다.
파일은 이벤트 안에서 읽고, 클립보드 상시 접근·URL/HTML 다운로드는 하지 않는다. 원본 교체는 항상 변환 화면의 명시적 적용을 거친다.
큰 PNG를 기존 열기에서 선택하면 같은 변환 화면으로 전환한다. 작은 PNG 직접 열기와 `.pixel.json` 복원은 기존 동작을 유지한다.
생성 API 연결·배경 자동 제거·레이어/애니메이션 추론·원본 PNG의 자동 재가져오기는 포함하지 않는다.

**내보내기 → PNG 복사**는 기존 lossless PNG encoder의 전체 sheet/fixed atlas 결과를 `image/png` ClipboardItem으로 전달한다. 사용자 클릭 안에서 PNG Promise를 write에 전달하고, 쓰기 완료 뒤에만 성공을 표시한다. 클립보드를 읽거나 permission을 미리 요청하지 않는다.
확정 원본 snapshot을 복사하며 dirty/checkpoint/history/scene은 변경하지 않는다. 내부 선택 복사·붙여넣기와 단축키는 별도 경로를 유지한다. 재생·stroke·미확정 선택·다른 작업 중에는 버튼을 차단한다.
문서/씬 전환과 종료는 PNG 결과 전달 전 signal/context를 확인하고 대기 상태를 해제한다. 이미 OS에 전달한 write 자체는 취소할 수 없으므로 늦은 결과는 UI에 반영하지 않는다. 보안 컨텍스트·ClipboardItem/write/image/png 미지원 및 권한 실패는 PNG 파일 내보내기로 대체하도록 안내한다.
OS/대상 앱의 재인코딩은 엔진 원본 보존 계약에 포함하지 않는다. JSON 편집 원본을 저장하는 동작은 별도로 실행한다. 브라우저 요구사항은 [Clipboard.write](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write)를 따른다. native command·의존성·source format을 추가하지 않는다.

**이미지 레이어 → 레이어 병합**은 전체 프레임을 단일 Undo transaction으로 변경한다. 아래 병합은 선택 레이어와 바로 아래 visible/unlocked 레이어를 결합하고 아래 레이어 ID·이름·순서를 유지한다. 보이는 레이어 병합은 모든 visible/unlocked 레이어를 결합하고 가장 아래 visible 레이어를 남긴다.
숨긴 레이어는 metadata·잠금·각 frame의 RGBA를 유지하지만, 다시 표시할 때는 병합 후 남은 레이어 순서로 합성한다. 보이는 레이어 병합은 선택 레이어와 관계없이 모든 병합 대상의 잠금을 확인한다.
기존 RGBA8 source-over 합성을 재사용한다. 중간 두 레이어의 반올림 순서와 backdrop에 의존하는 합성 모드가 최종 RGBA를 바꿀 수 있으므로 아래 병합은 모든 프레임의 변경 전후 전체 visible 결과를 비교하며, 다르면 mutation 없이 거절하고 visible 병합을 안내한다. 보이는 레이어 병합은 기존 visible 합성 bytes를 그대로 저장한다.
문서 버전·크기·팔레트·frame ID/시간·태그/방향은 유지한다. 합성 모드와 불투명도를 픽셀에 한 번 반영한 뒤 남은 레이어는 normal·opacity255로 설정한다. frame별 개별 병합과 숨긴 원본 삭제는 하지 않는다. 고정 atlas·stroke·미확정 선택·재생·읽기 전용 상태는 차단하고 UI에 이유를 표시한다.

**픽셀 퍼펙트**는 1픽셀 사각 연필의 자유 그리기에서 L자 모서리의 중간 점을 보정한다. 보정점은 stroke 이전 RGBA로 복원하고, 전체 stroke는 한 Undo다.
큰/이미지 브러시 조합은 이유를 표시하고 비활성화한다. 대칭과 선택 마스크는 보정한 픽셀의 최종 쓰기 범위에 적용한다.
캔버스나 반복 미리보기 밖으로 나갔다 재진입하면 경로를 분리해 가장자리의 기존 끝점을 보존한다. 선택 마스크는 이 경로 경계와 별개로 보정 후 적용한다.

**선택**은 사각형·색상·마술봉·자유형·다각형과 교체/추가/빼기/교차를 제공한다. Shift는 추가, Alt는 빼기, Shift+Alt는 교차다.
색상 선택은 현재 레이어의 정확한 RGBA가 기본이며 투명 RGB도 비교한다. 허용 오차0~255, 마술봉의4방향/대각선 연결은 명시적 옵션이다.
자유형/다각형은 최대1,024점이다. 다각형은 꼭짓점을 클릭하고 Enter/더블클릭으로 선택하며 Backspace로 마지막 점을 제거하고 Escape/blur로 취소한다.
선택 픽셀은 방향키로 이동한다. 사각형·교체 모드에서는 선택 안을 드래그해 이동한다. 마스크의 구멍은 복사/이동/반전/90도 회전·그리기·채우기·색 교체에서 보존한다.
**선택 → 자유 변형**은 -360~360도 회전과 가로/세로1~1600% 배율, 비율 고정을 제공한다. 기본 최근접 픽셀은 도트 경계를 유지하고 부드러운 보간은 premultiplied alpha로 투명 경계 색 번짐을 줄인다. 미리보기는 항상 선택 원본에서 다시 계산하며 적용 한 번이 Undo 한 단계다. 취소/Escape는 기존 선택과 미확정 이동을 유지한다. 회전 후 영역은 최대256×256이며 활성 프레임 밖의 실제 선택 픽셀은 잘림 경고 후 적용 시 잘린다. 문서/프레임/레이어 변경은 이전 미리보기의 적용 권한을 해제한다.
선택 자체는 UI 상태이며 원본/Undo에 저장하지 않는다. 경계 Path2D는 선택 revision별로 재사용한다.

왼쪽 **효과 → 외곽선**은 현재 cel의 alpha>0 실루엣에1픽셀 안쪽/바깥쪽 테두리와4/8방향 이웃을 적용한다.
선택 마스크가 있으면 최종 쓰기 범위를 제한한다. 미리보기·취소는 원본을 바꾸지 않고 확정은 한 Undo다. 프레임 밖 잘림을 표시하며 크기를 자동 확장하지 않는다.

왼쪽 **이미지 브러시**에서 선택 영역을 세션 브러시로 등록하고 중심점 X/Y와 찍기 간격1~32를 지정한다.
최대32×32·8슬롯·RGBA/마스크 합계64KiB이며, 등록 성공 후 선택을 해제하고 연필로 전환한다.
투명·비선택 픽셀은 바탕을 유지하고 겹치는 stamp는 마지막 raw RGBA를 사용한다. 알파를 반복 합성하지 않는다.
빠른 드래그도 경로와 끝점을 찍으며 대칭·선택 마스크·프레임 경계를 따른다. hover 미리보기는 원본을 바꾸지 않고 stroke는 한 Undo다.
브러시 목록은 원본 교체/종료 시 해제되며 원본 JSON에 저장하지 않는다.

하단 **보기**의 가로/세로 반복은 한 원본을 최대3×3으로 표시한다. 중앙 타일에서 시작한 stroke는 경계를 넘으면 지정 축의 반대편으로 이어진다.
연필·픽셀 퍼펙트·이미지 브러시·도형·채우기에 적용하며, 최종 선택 마스크는 wrap 이후 적용한다.3×3 미리보기 밖의 경로는 잘라낸다.
**맞춤**은 반복 영역을 포함하고 PNG 내보내기는 원본 한 장을 유지한다. 반복 설정 자체는 원본/dirty/Undo를 바꾸지 않으며 별도 원본·GPU 자산·재생 시계를 만들지 않는다.
고정 atlas v4는 반복 편집을 비활성화하고 이유를 표시한다.

프레임 막대의 **프레임 범위**에서 현재/모든 프레임 또는 개별 체크로 대상을 고르고 이동 X/Y·좌우/상하 반전을 검토한다.
인라인 범위 패널은 캔버스 작업 중 유지되며 제목·Escape·변경 검토로 접는다.
현재 레이어와 선택 마스크를 모든 대상 프레임에 적용한다. 마스크가 없으면 전체 프레임을 사용한다.
확인창은 레이어 ID, 대상/제외/변경 cel 수와 잘림을 표시하고, 선택한 프레임별 결과를 보여준다. 미리보기 프레임 변경은 편집 프레임을 바꾸지 않는다.
숨김·잠금 레이어는 제외하고 변경이 없으면 확정을 비활성화한다. 확정 전체가 한 Undo이며 비대상 cel·frame/layer/tag/clip ID와 시간 metadata를 보존한다.
잘못된 대상·이동 값은 부분 적용 전에 거절한다. 재생·원본/선택 대상·씬/프로젝트 전환은 오래된 확인창을 폐기한다.
범위 선택은 UI 전용이며 원본 교체·종료 시 해제한다. 픽셀 확정은 노멀을 무효화하고 기존 복구·원본 내보내기·프로젝트 저장 경로를 사용한다.

브러시 크기는 1~32픽셀 사각형이며 좌우/상하 대칭은 활성 프레임의 중앙 축을 사용한다.
선택 영역은 그리기의 최종 마스크이고 채우기도 선택 영역 밖으로 전파하지 않는다.
**도형 도구**의 직선(L)·사각형(R)·타원(O)은 드래그로 미리보고 포인터를 놓을 때 한 Undo로 확정한다.
사각형/타원은 윤곽선·채움과 Shift의 정사각형/원을 지원한다. Escape·blur·포인터 취소·대상 변경은 미리보기를 폐기한다.
미리보기는 원본/revision/dirty/Undo·씬·GPU 자산을 변경하지 않는다. 고정 atlas는 현재 frame rect만 수정한다.
짝수 브러시는 포인터 픽셀에서 오른쪽/아래로 한 픽셀 더 차지하며 대칭은 브러시의 실제 픽셀을 반전한다.

**팔레트 편집**은 색 추가·수정·삭제·순서 변경을 원본 metadata와 Undo에 기록한다. 색 목록 편집은 픽셀 색을 바꾸지 않는다.
팔레트 가져오기는 `ferrum2d.pixel-palette` v1 JSON, `.gpl`, `.hex`를 지원한다(16KiB·256색 상한).
[GPL v1/v2](https://developer.gimp.org/core/standards/gpl/)는 RGB를 불투명 RGBA로 읽으며 이름·열 수는 가져오지 않는다.
HEX는 한 줄에 `RRGGBB` 또는 `RRGGBBAA` 하나와 선택적 `#` 접두사, 빈 줄·`//` 주석을 받는다.
외부 파일은 최소 한 색이 필요하고 잘못된 행은 전체 가져오기를 거절한다. 순서·중복·투명 RGB를 유지하며 한 번의 Undo로 복원한다.
내보내기는 RGBA를 보존하는 기존 JSON 형식을 유지한다. 최근 선택색12개는 UI 전용이다.
**픽셀 색 교체**는 정확히 일치하는 RGBA의 개수를 확인하고 현재 셀/선택 영역/문서 전체 중 지정한 범위에 한 Undo로 적용한다.
문서 전체는 모든 프레임의 표시·잠금 해제 레이어이며 숨김·잠금은 보호한다. 고정 atlas는 선택 frame rect만 교체한다.
투명 픽셀도 RGB까지 일치해야 교체된다. 늦은 파일 읽기·확인창은 원본/revision과 편집 대상을 다시 확인한다.

**캔버스 크기**는 기준점9개로 여백을 늘리거나 자른다. 미리보기·취소는 원본을 바꾸지 않으며 픽셀 보간은 하지 않는다.
자르기는 원본에서 제거될 영역을 색으로 표시하고 변경 결과를 별도로 보여준다.
확정하면 숨김·잠금을 포함한 모든 프레임/레이어의 치수와 offset을 함께 변경하고 한 Undo로 복원한다.
한 변1~256·전체2,097,152 cel 픽셀 예산을 먼저 확인하며 frame/layer/tag/clip ID와 straight-alpha RGBA를 보존한다.
중앙 기준의 홀수 차이는 offset을 내림한다. 고정 atlas v4는 크기 변경을 차단한다.
치수·팔레트 변경도 원본 revision을 갱신하므로 이전 노멀은 재생성/검증 전 적용할 수 없다.
씬의 크기·pivot·collider/body는 자동 수정하지 않으며 UV/animation 변경은 기존 명시적 자산 적용에서 확인한다.

편집 화면 우측 **실제 크기**는 접이식1×/2× 합성 미리보기다. DPR과 관계없이 원본1픽셀을 CSS1픽셀 또는2픽셀로 표시한다.
편집·Undo·레이어 표시와 선택 프레임/태그 재생을 따라가며 기존 재생 시계를 공유한다. 별도 게임 runtime이나 노멀 job은 만들지 않는다.
접기·탭 비활성·창 blur·종료 시 canvas/예약 RAF를 해제하며 포커스 복귀 후 다시 표시한다.
이 보기의 조작은 원본/이력을 바꾸지 않는다. 게임 카메라와 객체 크기는 기존 **게임 미리보기**로 확인한다.

공식 Placement Viewer의 Assets에서 **가져오기 → 도트 제작 → 새 도트 만들기**를 선택하면 에셋 편집 탭을 연다.
기본 32×32이며 1~256의 정수 크기를 선택할 수 있다. 원본 문서나 PNG로 시작하려면 **도트 원본 / PNG 열기**,
기존 sprite 자산은 **도트 편집**을 사용한다. 이미지 레이어 1~8개·프레임 1~16개를 지원한다.

- 연필(B), 지우개(E), 연결 영역 채우기(G), 스포이트(I), 팔레트·색상·알파를 제공한다.
- **이미지 레이어** 패널에서 추가·삭제·이름·앞뒤 순서·표시·잠금을 편집한다. 목록 위쪽이 앞이며 마지막 레이어는 삭제할 수 없다.
  선택 레이어에만 그리고 숨김·잠금이면 그리기를 차단한다. 잠금은 픽셀 편집에 적용하며 이름·순서·삭제 등의 레이어 관리에는 적용하지 않는다.
  채우기는 선택 레이어의 원본 픽셀, 스포이트는 화면의 합성 색을 사용한다. 이미지 레이어와 씬 객체의 그리기 레이어는 별개다.
  Tab·Enter의 레이어 선택과 Space의 체크박스 전환에서 포커스를 유지하고, 한글 조합 중 Enter/Escape는 이름 확정/취소로 처리하지 않는다.
- 휠과 확대/축소 버튼, H 또는 Space+드래그로 화면을 탐색한다. 좌표는 CSS 크기·DPR·배율·이동을 반영한다.
- **도트 프레임** 막대에서 추가·복제·삭제·순서·시간(ms)을 편집한다. 레이어 metadata는 공통이며 픽셀은 프레임/레이어별로 독립적이다.
  프레임 선택과 재생 위치는 UI 상태다. 재생 중 편집을 막고 정지하면 편집 프레임으로 돌아간다. 창 blur·탭 전환·문서 종료에서 RAF를 정리한다.
  프레임 버튼의 좌우 방향키와 Undo/Redo에서도 도트 편집기 포커스를 보존한다.
  순서·삭제 등의 프레임/레이어 도구가 경계에서 비활성화되면 선택 항목으로 포커스를 복원해 다음 Undo가 씬 이력에 전달되지 않게 한다.
- 프레임 막대의 **어니언 스킨**에서 표시·이전/다음과 불투명도(0~100%, 기본30%)를 설정한다. 기본 표시는 꺼짐이다.
  이전/다음 각각 1~4프레임(기본1)을 코랄/청록으로 현재 프레임 뒤에 표시하고 경계에서 순환하지 않는다. 먼 프레임부터 그리며 거리가 두 배면 불투명도는 절반이다. 합성 cache는 현재 프레임 포함 최대9장(256px에서2.25 MiB)이다. 현재의 불투명 픽셀은 ghost를 덮는다.
  보이는 이미지 레이어를 합성하며 잠금은 ghost 표시를 막지 않는다. 그리기·fill·스포이트는 현재 프레임만 사용한다.
  재생 중에는 ghost를 숨기고 정지 시 복원한다. 동일 문서의 탭 전환은 설정을 유지하고 원본 교체·닫기·도구 해제는 기본값으로 초기화한다.
  설정은 UI 전용으로 source·PNG/atlas·자산·프로젝트 저장·Undo·dirty에 포함하지 않는다. 설정 메뉴는 Escape 또는 바깥 클릭으로 닫는다.
- 한 번의 stroke/fill은 한 Undo다. Ctrl/Cmd+Z·Shift+Z와 Ctrl+Y는 도트 문서 이력에 적용되며 Esc/포인터 취소는 진행 중 stroke를 복원한다.
  마지막 pointerup 좌표도 선에 포함하며 창 포커스를 잃으면 진행 stroke·임시 Space 이동 상태를 취소한다. 빈 값·범위 밖 알파 입력은 마지막 유효한 색을 유지한다.
- **도형·채색 도구**에서 **디더(D)**와 **그라데이션(J)**을 선택한다. 디더는 기본색과 두 번째 색의 RGBA를 그대로 사용하며 4×4 패턴의 밀도를 0~16으로 조절한다.
  그라데이션은 드래그 방향을 따라 두 색 RGBA 보간, 두 색 디더, 팔레트 순서의 세 방식을 제공한다. 팔레트 방식은 두 색 이상이 필요하다.
  드래그 중에는 미리보기만 표시하며 놓으면 한 Undo로 확정한다. Escape·창 blur는 취소한다. 선택 마스크·좌우/상하 대칭·잠금·고정 atlas의 현재 프레임 경계를 유지하며, 게임 후처리와 달리 원본 픽셀을 편집한다.
- **선택(M)**은 현재 frame/layer를 대상으로 하며 사각형 모드에서는 드래그로 범위를 잡는다. 선택·전체 선택·해제는 원본/dirty/Undo에 포함하지 않는다.
  드래그·방향키(Shift는10픽셀)의 이동, 좌우/상하 반전·시계 방향90도 회전과 붙여넣기는 원본을 바꾸지 않는 미리보기다.
  **확정** 또는 캔버스의 Enter로 한 Undo에 적용하고 **취소/Escape**·창 blur·탭 전환에서 폐기한다. 겹치는 이동은 원본 snapshot으로 계산한다.
  버튼·메뉴의 Enter는 해당 제어를 실행한다. 포인터 드래그 중에는 Escape·Ctrl/Cmd+Z/Y 취소만 처리하고 다른 편집 단축키는 무시한다.
  **선택** 메뉴와 Ctrl/Cmd+A/C/X/V, Delete를 제공한다. 복사본은 현재 레이어의 raw RGBA이며 내부 클립보드로 다른 frame/layer에 붙인다.
  붙여넣기는 마스크에 포함된 픽셀의 투명 RGB/알파까지 교체하고 구멍을 보존한다. 반전/90도 회전은 픽셀 보간 없이 처리한다. 고정 atlas는 활성 rect로 자르고 경고한다.
  잠금·숨김·재생 중 수정을 차단하며 원본 교체/종료에서 클립보드를 비운다. 미리보기 중 저장·내보내기·씬 적용과 구조 편집은 확정/취소 후 사용한다.
  그리기 도구로 전환해도 선택을 유지하며 선택 영역 안에만 그린다. Escape로 선택을 해제한다. 임의 각도 회전·확대와 편집 원본의 OS 클립보드 전달은 제공하지 않는다. 외부 PNG 붙여넣기는 위의 이미지 가져오기, PNG 복사는 내보내기 메뉴를 사용한다.
- **내보내기 → 편집 원본 내보내기**는 편집 가능한 `.pixel.json`, **PNG 내보내기**는 게임용 RGBA 이미지를 다운로드한다.
  닫기/새 원본으로 교체할 때 변경이 있으면 원본 내보내기·폐기·취소를 선택한다. 씬 탭 전환은 원본을 유지한다.
- **복구** 메뉴는 확정한 원본의 로컬 임시 저장과 명시적 복원/폐기를 제공한다. 600ms debounce 후 IndexedDB transaction이 완료된 자료만 저장 성공으로 표시한다.
  복원은 v1~v6 원본·프레임/레이어/태그 ID·팔레트·투명 RGB를 유지하며 새 편집 세션의 미저장 원본으로 연다. Undo·선택·GPU 자산·씬은 복원하지 않는다.
  각 탭과 복원 작업은 새 저장 ID를 써서 다른 작업을 덮어쓰지 않는다. 복원 원본 항목은 명시적 폐기 전 유지한다.
  현재 작업의 원본 내보내기 시작·성공한 프로젝트 저장·도트 문서 폐기는 해당 임시 원본만 지우며, 프로젝트 저장 중단/실패와 씬·도트 탭 이동은 마지막 완료본을 보존한다.
  브라우저 다운로드의 최종 파일 보관 여부는 기존 원본 내보내기/dirty 계약처럼 앱에서 확인하지 않는다.
  원본별 기존 상한과 별개로 origin당 8개·합계32MiB·7일을 제한하고 오래된 항목을 정리한다. desktop 프로젝트/씬 경로와 웹 origin/path·씬 source로 격리한다.
  브라우저의 일반 JSON 파일은 전체 경로가 없어 같은 이름의 복구 목록을 공유한다. 저장소 접근 거부/용량 초과/손상 자료는 원본과 씬을 바꾸지 않고 오류를 표시한다.
  미리보기는 임시 저장하지 않는다. 종료 시 에디터를 해제하기 전에 마지막 확정 원본을 캡처하고, 진행 중인 이전 쓰기 뒤에 저장한다.
  이 종료 flush는 best effort이며 transaction 완료를 보장하지 않는다. 마지막 완료본 이후 변경, 브라우저 데이터 삭제, origin 변경은 복구 범위 밖이다.
  복원한 원본도 기존 노멀 source/hash와 재검증해야 하며 게임 자산 적용·프로젝트 저장은 기존 명시적 경로를 따른다.
- **자산 등록**은 세션 Assets에 새 불변 revision을 추가한다. **선택 객체에 적용**은 이미지/UV와 다중 프레임의 `animationSet`을 바꾸는 placement v2 patch를 한 번의 씬 Undo로 적용한다.
  크기·pivot·transform·collider/body·layer·behavior를 보존한다. 기존 단일 clip은 같은 도트 revision에서 생성한 설정과 일치할 때 교체하고 loop 정책은 유지한다.
  한 프레임으로 적용하면 검증된 기존 도트 animationSet을 제거한다. 다른 자산의 애니메이션·legacy animation·normal binding은 보호한다. 소유한 도트의 수동 clip 변경은 아래 확인 절차를 거친다.
- **미사용 정리**는 열린 씬·Undo/Redo·현재 배치 도구에서 참조하지 않는 도트 세션 revision의 URL/GPU 자원만 해제한다.
  원본 씬을 닫을 때도 다른 열린 씬·이력이 참조하는 revision은 보존한다.

PNG 생성·업로드는 검증된 원본 snapshot으로 시작한다. 적용 확정 전에 실패하거나 선택/씬이 바뀌면 미확정 revision만 해제하고,
기존 확정 자산과 실제 참조 중인 자산은 유지한다. 닫기/새 원본 선택은 이전 파일 읽기·확인창의 권한을 취소해 늦은 결과가 다른 문서를 닫거나 교체하지 못하게 한다.
미저장 도트 또는 진행 중인 픽셀 편집/업로드가 있으면 에디터·엔진 업데이트와 재시작을 차단한다.

**내보내기 → 애니메이션 내보내기**는 APNG/GIF와 전체/태그 범위·반복을 선택한다. APNG는 RGBA 프레임을 SOURCE blend로 교체하며 원본 ms 시간과 반투명도를 보존한다. GIF는 alpha128 기준 이진 투명도, 최소20ms·10ms 단위 시간을 사용한다. 표시 RGB 최대255색은 그대로 유지하고 그보다 많으면 기본은 거절한다. **GIF 색상 축소 허용**을 켜면216색 RGB cube로 명시적으로 매핑한다. 태그의 정/역/왕복 순서와 loop override가 같은 프레임 순서 규칙을 사용한다. 출력 최대127프레임·4,194,304픽셀·16MiB다. 작업 중 취소·문서 전환은 생성/다운로드를 중단하며 source/Undo/dirty는 바꾸지 않는다. 고정 외부 atlas는 PNG 내보내기를 사용한다. GIF/APNG 가져오기는 이 기능 범위가 아니다.

도트 원본은 app 전용 `ferrum2d.pixel-document` v1/v2/v3/v4/v5/v6/v7/v8/v9다. stable layer/frame ID·팔레트·sRGB straight-alpha RGBA8 base64를 보관하며
UI·Undo log나 게임 simulation state는 포함하지 않는다. 한 변 최대 256, v1 JSON 400,000 bytes, v2 JSON 3 MiB, v3/v5/v6/v7/v8/v9 JSON 12 MiB로 제한한다.
이름과 layer/frame ID는 올바른 Unicode 문자열·UTF-16 최대 64단위이며 JavaScript `trim` 기준으로 빈 값이면 거절한다.
짝이 없는 surrogate는 자산 등록 전에 진단한다. 편집 원본의 정수 필드는 표기가 아닌 값으로 검사하므로 `1.0`·`1e0`도 정수 1로 읽는다.
v1의 단일 `layer`·`rgba` 표현은 계속 읽고 그대로 저장한다. v1에서 레이어 추가·삭제·순서·표시·잠금 편집은 v2로 전환하며 Undo로 원래 v1까지 복원할 수 있다. v3/v5/v6/v7/v8/v9 레이어 편집은 해당 버전을 유지한다.
v2는 아래→위 순서의 `layers` 배열(1~8개)에 고유 `id`·`name`·`visible`·`locked`·`rgba`를 보관한다.
각 레이어는 문서와 같은 치수이며 `frame`·`palette`는 문서 전체가 공유한다. 선택 레이어는 UI 상태여서 선택만 바꿔도 원본이나 dirty 상태는 바뀌지 않는다.
프레임 추가/복제/삭제/순서/시간 편집은 v3로 전환하고 Undo로 이전 형식까지 복원한다.
v3는 공통 `layers[{id,name,visible,locked}]`와 `frames[{id,durationMs,cels:[{layerId,rgba}]}]`를 담는다.
frame ID는 고유하며 cel 순서/ID는 공통 layers와 정확히 일치해야 한다. 시간은 1~60000ms 정수다.
현재 편집기는 최대64프레임·8레이어다. 모든 cel의 합계가 2,097,152픽셀(8 MiB RGBA)을 넘으면 편집·읽기를 거절한다.
v3/v5 읽기 한도16은 유지하고 17번째 프레임 추가·복제부터 v6로 전환한다. Undo는 정확한 이전 버전까지 복원하며,
v6에서 프레임을 줄여도 자동으로 이전 버전으로 내려가지 않는다. v6는 v3의 cel 구조를 사용하고 v5의 태그 묶음
(`tags`·`initialTag`·`nextClipId`)은 모두 함께 있거나 모두 생략해야 한다. 이전 앱/호스트는 v6를 거절하므로 함께 업데이트한다.
v6는16프레임 이하에서도 원본 프레임별 시간을 유지한다. 화면 적용·노멀 연결·자산 내보내기가 같은 시간 형식을 사용하며, 같은 원본을 재적용할 때는 클립 변경 확인이 필요하지 않다.
PNG는 프레임 개수의 제곱근을 올림한 열 수로 배치한 최대8×8 atlas다. v6 출력은 한 변2048·PNG16 MiB 이내이며,
기존 v3/v5 출력은 한 변1024·PNG8 MiB 한도를 유지한다. 남은 마지막 칸은 RGBA0이며 프레임별 원본 치수/UV와 시간을 자산에서 확인할 수 있다.
**이미지 레이어 → 보통 · 100%** 버튼은 **레이어 합성** 창을 연다. 합성 모드(보통·곱하기·스크린)와 선택 레이어의0~100%를 숫자·슬라이더와 읽기 전용 합성 미리보기로 조절한다. 적용은 모든 프레임의 공통 속성 한 작업이며 Cancel/Escape는 원본을 바꾸지 않는다. 잠금·고정 아틀라스·읽기 전용·재생/미확정 편집 중에는 차단하고 닫기·문서 전환은 미리보기와 늦은 적용 권한을 해제한다.
보통 모드에서 실제 불투명도만 변경하면 **v8**로 전환하며 이미 v9인 원본은 유지한다. v8은 v6와 같은 cel·선택적 태그 묶음과64프레임 한도를 사용하며 v7 재생 방향도 허용한다. 모든 `layers[]`에 정수 `opacity: 0..255`가 필수다. 태그가 있으면 `tags`·`initialTag`·`nextClipId`를 모두 작성한다.
합성 alpha는 `round(rawAlpha * opacity / 255)`이며 원본 RGB/alpha 바이트는 보존한다. opacity0은 합성에서 제외하고255는 기존 출력을 유지한다. 전체가 숨김 또는0이면 RGBA0이다. 병합 결과는 이미 반영된 픽셀과 남은 레이어의 opacity255로 저장한다. 숨긴 원본은 보존한다.
v1~v7는 opacity 필드를 거절하며 실제 값이 같으면 버전/이력을 바꾸지 않는다. Undo는 이전 원본 형식까지 복원한다. v8은 v6/v7의12 MiB 원본·16 MiB/2048px PNG와 기존 cel·Undo 예산을 유지한다. 이전 앱/호스트는 v8을 거절하므로 함께 업데이트한다. PNG·복사·씬 적용·노멀 입력·복구·native 저장/재열기가 같은 결과를 사용한다.

곱하기·스크린을 실제 적용하면 **v9**로 전환한다. 모든 레이어에 `blendMode: "normal" | "multiply" | "screen"`과 `opacity`가 필수다. 미리보기/취소/보통 no-op은 기존 v1~v8을 유지한다. 합성 모드와 불투명도를 함께 적용해도 Undo 한 단계이며, v9에서 보통으로 되돌려도 자동 강등하지 않는다. 새 레이어·이미지 가져오기는 normal·255로 초기화한다. 크기·cel·태그/방향·메모리 제한은 v8과 같다. 이전 앱/호스트는 v9를 거절하므로 함께 업데이트한다.
곱하기는 그림자, 스크린은 빛 표현에 사용한다. 색 계산은 [W3C의 source-over와 separable blending](https://www.w3.org/TR/compositing-1/#blending)을 바탕으로 sRGB byte 공간에서 수행한다. alpha를 불투명도로 보정한 뒤, 투명한 바탕의 피복률도 포함해 색을 계산하고 최종 byte에서 한 번 반올림한다. 아래 레이어가 없거나 완전히 투명하면 원본 색이 유지된다. 보통 모드의 기존 RGBA8 결과와 맨 아래 레이어의 투명 RGB 보존 규칙은 바꾸지 않는다.
원본 RGBA·태그·시간은 유지하며 PNG/클립보드/어니언/노멀 입력/복구/native 저장은 같은 합성 결과를 사용한다. 게임은 평탄화 PNG를 읽으므로 런타임 레이어 합성이나 새로운 Wasm API는 추가하지 않는다.

**팔레트 편집 → 색상 모드 → 인덱스 팔레트**는 v10 원본으로 전환한다. v10은 `colorMode: "indexed"`, 공통 `palette`(중복 없는 RGBA 최대256색), 레이어별 `opacity`/`blendMode`, 각 프레임의 `cels[].indices`(픽셀당1바이트 base64)를 보관한다. 같은 cel에 `rgba`를 함께 쓸 수 없다. index0은 `#00000000`으로 고정한다. 나머지 항목은 반투명과 투명 RGB도 보존하며 범위 밖 index·중복 색·잘못된 byte 수는 거절한다. 태그 묶음은 v9처럼 선택 사항이며 프레임64개·레이어8개·전체2,097,152픽셀·JSON12MiB 한도를 유지한다.

전환은 모든 cel의 실제 사용 색으로 팔레트를 만들며 손실 양자화를 하지 않는다. 투명색 포함256색 초과면 거절한다. 이후 새 색은 여유가 있을 때만 자동 추가하고 초과 편집은 전체 취소한다. **색 수정**은 해당 index를 쓰는 모든 프레임과 숨김·잠금 레이어에도 적용한다. 팔레트 순서 변경은 index를 재배치해 외형을 보존하고, 사용 중인 항목 삭제는 막는다. 이미 있는 색과 합치려면 **픽셀 색 교체**를 사용한 뒤 비사용 항목을 삭제한다. 팔레트 가져오기도 현재 사용 색을 제거할 수 없다.

RGBA로 돌아가면 현재 픽셀·레이어·태그를 유지한 v9이며 전환과 팔레트 편집은 각각 Undo 한 단계다. 고정 atlas(v4)는 색상 모드를 바꾸지 않는다. 기존 v1~v9를 열거나 no-op하면 기존 형식을 유지한다. v10은 최신 브라우저 앱과 native 호스트를 함께 사용해야 한다. PNG/노멀/게임 runtime은 기존 평탄화 이미지이며 팔레트 번호를 새 Wasm ABI로 전달하지 않는다.


PNG는 표시 중인 레이어를 encoded sRGB RGBA8에서 정수 반올림하는 straight-alpha source-over로 합성한다.
맨 아래 표시 레이어의 투명 RGB도 보존하고 모두 숨기면 RGBA 0을 출력한다. 숨긴 레이어의 원본 픽셀은 JSON에 남는다.
픽셀·레이어·프레임 편집은 같은 Undo/Redo를 사용하며 합계 최대64단계/이력 RGBA16 MiB다.
크기·레이어/프레임 metadata가 같은 픽셀 편집은 변경된 cel별 사각 영역의 before/after RGBA만 저장한다. 한 픽셀 수정은 원본 크기와 관계없이8바이트이며 최대8 MiB 원본에서도64개의 작은 수정 이력을 유지할 수 있다. 영역 안의 투명 RGB도 정확히 복원한다.
레이어 합성·팔레트·태그·프레임 시간 등의 metadata, 레이어/프레임 구조 또는 캔버스 크기 변경은 전체 snapshot으로 복원한다. 넓은 영역 수정·전체 snapshot이 예산을 채우면 오래된 이력부터 제거하며, 최대 원본의 전체 snapshot은 한 작업이16 MiB다. 선택만 바꾸거나 값이 같은 편집은 이력을 추가하지 않고 남은 Redo도 유지한다. 이력 byte는 RGBA payload 기준이며 JS metadata·현재 원본·저장 checkpoint·합성 cache의 메모리는 별도다.
PNG 열기는 4 MiB/한 변 256을 decode 전에 검사하며 원본 PNG를 덮어쓰지 않는다.
파일명에서 도트 이름을 만들 때는 Unicode 문자 경계를 보존해 64단위로 줄이며, 긴 제목은 작업 공간 안에서 생략 표시한다.

**프레임 태그**는 프레임 막대의 접이식 메뉴에서 편집한다. 태그 추가 후 이름·프레임·반복을 설정하고 **초기 클립**으로 게임 진입 시 재생할 태그를 선택한다.
미리보기 태그는 UI 상태다. 프레임 체크 순서가 재생 순서이며 각 행의 `#` 번호로 확인한다. 체크 해제 후 다시 선택하면 마지막에 추가한다.
**모든 프레임**은 원본 순서로 반복 재생하며 선택 태그는 해당 순서·loop 정책으로 재생한다. 비반복 태그는 마지막 프레임을 유지한다.

태그 추가는 기존 원본을 **v5**로 전환하고 v6/v7/v8/v9은 유지한다. Undo로 기존 형식까지 돌아간다. v5는 v3의 layers/frames에 다음 필수 필드를 추가한다.

- `tags`: 1~16개의 `{id,name,clipId,frameIds,loop}`. ID·이름·clip ID는 각각 고유하며 이름/ID는 기존64단위 문자열 규칙을 따른다.
- `frameIds`: 1~16개의 중복 없는 stable frame ID. 목록 순서가 재생 순서이며 원본 프레임 순서 이동과 독립적이다. 여러 태그가 같은 프레임을 사용할 수 있다.
- `clipId`: 0~65535의 정수. `nextClipId`는 다음 할당 번호(1~65536)로 모든 현재 clip ID보다 커야 한다. 삭제한 번호를 재사용하지 않는다.
- `initialTag`: 존재하는 태그 ID. 이름·프레임 편집으로 clip ID는 바뀌지 않으며 태그가 사용하는 프레임 삭제와 마지막 태그 삭제는 차단한다.

태그의 **재생 방향**은 정방향·역방향·왕복이다. 역방향 또는 왕복을 선택하면 v1~v6 원본을 **v7**로 전환하며 v8/v9는 유지한다. Undo는 이전 버전까지 복원한다.
v7은 v6의64프레임·12 MiB 원본·2048px/16 MiB PNG 한도와 v5의 필수 태그 묶음을 사용한다.
`tags[].direction?: "forward" | "reverse" | "pingpong"`은 생략 시 정방향이다. v5/v6에 이 필드를 넣으면 거절한다.
방향을 정방향으로 되돌리거나 프레임 수를 줄여도 v7을 자동 강등하지 않는다. 이전 앱/호스트는 v7을 거절하므로 함께 업데이트한다.
태그 재생 미리보기는 해당 방향의 첫 프레임에서 시작한다. 왕복 반복은 양 끝을 중복하지 않고, 비반복 왕복은 처음으로 돌아온 프레임의 표시 시간까지 재생한 뒤 유지한다.
한 프레임 왕복은 그 프레임만 사용하며, 프레임별 시간은 역방향/왕복에서도 원래 프레임을 따라간다.

각 태그는 runtime `animationSet`의 한 clip으로 출력한다. v6/v7/v8/v9은 `frameDurationsMs`를 사용해 원본 UV와 시간 배열을 그대로 전달한다.
기존 유효 v1~v5의 GCD/FPS 변환은 유지하며, 32 tick을 초과해 과거 거절되던 시간은 native 원본 프레임 시간으로 출력한다.
새 시간 형식은 PX-04 v2 configure를 지원하는 SDK/Wasm이 필요하다.
기존 도트 애니메이션에 태그를 적용하거나 소유 clip을 수동 변경한 경우 **클립 변경 검토 → 클립 변경 적용**으로 전후 ID/초기 clip을 확인한다.
취소는 revision 등록·씬 변경을 하지 않으며 승인은 해당 자산과 정확한 전후 animationSet에만 유효하다. 기존 clip ID가 새 출력에서 사라지면 적용을 차단한다.
기존 ID를 유지하며 프레임·초기 clip·반복을 변경하고 한 씬 Undo로 복원한다. 닫힌 씬·외부 게임 코드의 참조는 자동 수정하지 않는다.
v1–v4는 계속 읽고 해당 형식으로 저장한다. 이전 앱/호스트는 v5를 거절하므로 최신 앱/호스트를 함께 사용한다. v1–v4에 태그 필드를 붙이는 입력도 거절한다.

고정된 외부 atlas는 **Assets → 프레임 카드 → 도트 편집**으로 연다. 전체 시트 원본을 보관하고 선택한 rect만 표시·수정한다.
상단 **시트 프레임** 선택은 UI 상태여서 source·dirty·Undo를 바꾸지 않는다. 픽셀 Undo는 다른 frame을 선택해도 같은 문서 이력을 복원한다.
v4는 v1의 단일 `layer`·`frame`·전체 `rgba`에 필수 `atlas:{texture,frames:[{id,frame:{u0,v0,u1,v1}}]}`를 추가한다.
`atlas.texture`는 원래 texture 이름(UTF-16 최대256단위), frame ID는 고유한64단위 문자열이고 최대256개다.
UV×시트 치수는 정수 픽셀 경계(허용 오차1e-7px)여야 하며 시트 밖·빈 영역·중복/중첩을 거절한다. 회전/trimmed atlas 변환은 제공하지 않는다.
원본 상한400,000 bytes·한 변256px·PNG4 MiB를 유지한다. RGBA8와 sRGB/표준 gamma를 검증하며 색 공간 변환이나 canvas premultiplication을 거치지 않아 투명 RGB도 보존한다.
그리기·지우기·fill·스포이트는 선택 rect로 제한하며 layer/frame 구조 변경·재배치를 제공하지 않는다.
게임 적용은 같은 atlas metadata와 선택 UV를 사용하는 정적 sprite만 허용한다. texture/asset만 새 revision으로 교체하며 UV·다른 객체·원본 파일은 보존한다.
현재 normal pair와 animation은 거절한다. 새 revision은 전체 시트와 모든 프레임을 Assets에 제공한다. v1/v2/v3만 지원하는 이전 앱/호스트는 v4를 거절하므로 최신 앱/호스트를 함께 사용한다.

**자산 내보내기**의 `ferrum2d.pixel-assets` v1 bundle에는 원본·PNG base64/SHA-256·texture manifest·현재 scene document가 있다.
각 PNG를 `assets[].path`에 설치하고 manifest의 자산 이름과 `srgb` 옵션을 게임 프로젝트에 등록한 뒤 동반 scene을 사용한다.
세션 store는 최대 8 revision/64 MiB다. 브라우저 내보내기를 프로젝트 저장 완료로 표시하지 않는다.
태그가 없는 다중 프레임의 bundle은 `animationSet` 단일 clip0을, 태그가 있는 v5/v6/v7/v8/v9 bundle은 태그별 clip과 초기 clip을 포함한다. v6는 원본 UV를 복제하지 않으며 기존 유효 GCD 변환의 owned animation 비교·재적용을 유지한다.
색상 애니메이션은 편집기의 원본64프레임을 지원한다. v6/v7/v8/v9와 기존 고정 FPS 변환에서 반복 UV32개를 넘는 경우에는 `frameDurationsMs`로 원본 시간과 UV를 전달한다. 노멀 연결의 고유 UV32개 한도는 별도다. 시간·UV 검증에 실패하면 프레임 패널에서 진단하고 게임 적용을 막으며, 편집 원본/PNG 저장과 bundle의 `animationDiagnostic`은 유지한다.
편집 미리보기는 원본 ms 기준이며 게임 재생은 Rust sprite playback이 담당한다. 원본 시간 클립은 `frameDurationsMs`, 유효한 기존 FPS 클립은 f32 FPS를 사용하며 타이밍 검증은 각 경로의 수치 정밀도를 구분한다.
미설치 도트 자산·다른 프로젝트의 자산이나 runtime 숫자 texture 참조가 남은 씬 Save는 차단한다.

### 도트 노멀 생성과 조명 미리보기

도트 탭 왼쪽의 **노멀맵** 메뉴에서 강도(0~8, 기본1.5)를 설정하고 **노멀 생성**을 실행한다.
현재 보이는 레이어 합성을 source frame별 독립 rect로 잘라 기존 Sprite Normal Worker로 처리한다.
v1/v2는 한 rect, v3/v5/v6/v7/v8/v9는 source frame 순서의 atlas rect, v4는 고정 atlas의 rect를 사용한다. 노멀은 게임의 모든 태그가 사용하는 고유 UV32개 한도를 유지한다. 사용하지 않는 cel은 예산에서 제외하고, 초과 시 색상 시트 편집·적용은 유지하며 생성 버튼에서 안내한다.
태그의 반복 UV는 중복 생성하지 않으며 빈 atlas 칸은 flat normal `(128,128,255,0)`로 남긴다.
결과는 `ferrum2d.pixel-normal.report` v1·`pixel-rects-v1` provenance로 color/source/normal SHA-256·stable frame ID/rect·생성 설정을 연결한다. 외부 Aseprite 파일이 필요하지 않다.

- **생성**은 자산 준비이며 씬·게임 카메라를 바꾸지 않는다. 실패·취소 시 기존 pair와 씬을 유지한다.
- **조명 미리보기**는 별도 dialog에서 Color/Normal/Flat 비교와 움직이는 조명을 표시한다. 2D에서도 사용할 수 있고 닫기·탭 전환·원본 교체 시 GL/RAF/bitmap을 해제한다.
- 픽셀·레이어·frame/tag 편집 또는 Undo 뒤에는 결과를 재검증하기 전까지 **재생성 필요**로 표시하고 미리보기/적용을 막는다. 원본이 이전과 같으면 다시 생성할 때 불변 cache를 재사용한다.
- 씬 전환만으로 임시 color/normal의 소유 문서가 바뀌지 않는다. 다른 씬에서는 재생성이 필요하며, 검증해 저장한 프로젝트 pair만 같은 프로젝트의 다른 씬에서 재사용한다. 원본 씬으로 돌아오면 살아 있는 결과를 다시 사용할 수 있다. 닫힌 씬에서 폐기한 결과는 최신으로 표시하지 않는다.
- **노멀과 함께 적용**은 선택한 일반 2D sprite 또는 HD-2D billboard에 color와 normal을 한 번의 씬 Undo로 적용한다. 태그/clip 변경은 기존 명시적 migration 확인을 따른다.
- 외부 normal 또는 숫자 normal 참조는 자동 교체하지 않는다. 소유하고 검증한 이전 도트 pair만 교체하며 collider/body/layer/크기/카메라는 보존한다.
- normal은 `colorSpace: "none"`, color는 `srgb`로 등록한다. 일반 color 적용은 normal이 연결된 sprite를 덮어쓰지 않는다.
- 일반 2D는 `components.visual.normalTexture`에 이름을 저장하며 기존 `components.sprite.normalTexture`도 지원한다. HD-2D는 기존 `spatial.billboards[id].normalTexture`를 사용한다.
- 2D 게임은 기존 `lighting`의 point/sun 조명이 켜져 있어야 normal 방향에 따른 차이가 보인다. 조명이 없거나 꺼져 있으면 기존 색상 렌더링을 유지한다.
- 두 renderer에서 같은 color/frame UV·반전·회전을 사용한다. normal PNG의 alpha 대신 color alpha가 형상/가림 기준이며 앞쪽의 normal 없는 sprite도 뒤 normal을 가린다.

**자산 내보내기**에는 현재 유효한 생성 결과의 normal PNG·manifest와 provenance도 담긴다. source `.pixel.json`은 color/frame의 편집 원본이며 normal PNG는 재생성 가능한 파생 자산이다.
optional generator가 설치되지 않은 host는 기존 생성기 unavailable 진단을 표시한다. 생성기 설치/검증은 [Sprite Normals Worker](data-scene-spatial.md#선택형-브라우저-노멀맵-worker)를 따른다.
최신 app/desktop host가 새 pixel normal provenance를 함께 지원해야 하며 이전 normal host는 새 format을 거절한다. 기존 Aseprite/Worker normal report와 도트 v1–v5는 유지한다.

도트 편집기의 참고 기준은 Aseprite commit `3669f4774d181d77deb3e6db95fe6df8ca347410`이다.
`src/app/tools`·`transaction.cpp`의 stroke/확정·취소, `src/doc`의 layer/cel/frame 책임,
`src/doc/algorithm/floodfill.cpp`의 연결 영역과 `src/render`의 어니언 합성 원리를 참고했다.
자체 TS 문서·정수 선 보간/clip·bounded queue·편집 이력과 view-only 어니언으로 구현하며 C++ 코드를 복사하거나 외부 앱 실행을 요구하지 않는다.

### 일반 2D 노멀 재질과 조명

```json
{
  "visual": {
    "kind": "sprite", "texture": "hero.color", "normalTexture": "hero.normal",
    "width": 32, "height": 48
  },
  "collider": "none", "layer": "player"
}
```

`normalTexture`는 color와 동일한 크기/atlas layout의 OpenGL 방향 normal이다. manifest의 normal `colorSpace`는
`none` 또는 `linear`이며 `srgb`와 크기 불일치는 렌더 시 거절한다. 기존 animation/animationSet의 현재 UV를 공유한다.
회전·UV 반전이 없는 스프라이트에서 OpenGL 노멀의 +Y(녹색 채널 증가)는 화면 위쪽을 뜻한다. PNG 행 좌표가 아래로 증가하므로
직접 생성한 둥근 표면은 위쪽에서 G가 128보다 크고 아래쪽에서 작아야 한다. 반대 방향의 노멀은 상하 광원이 뒤집혀 보인다.
Data Scene texture와 같은 문자열/숫자 참조를 허용하지만 도트 적용·내보내기·저장은 안정적인 자산 이름을 사용한다.
새 material ABI를 제공하지 않는 구 Wasm은 normal이 없는 씬을 실행하며, normal을 요청한 씬은 활성화 전에 거절한다.
한 번의 씬 적용에서 normal이 연결된 instance는 최대 65,536개다. 초과하면 기존 씬을 변경하기 전에 거절한다.

2D `lighting.pointLights[].height`는 선택형 조명 Z 거리(0..1,000,000, 기본 `radius*0.5`)이고 물리 높이와 무관하다.
`directionalLight.elevationRadians`는 선택형 태양 고도(0..π/2, 기본 π/4)이며 XY 입사 방향은 기존 그림자 방향의 반대다.
기존 ambient/additive light·tile shadow 의미는 유지하고 normal이 있는 픽셀에만 Lambert 응답을 적용한다.
건물은 `visual.shadow.shape:"volume"`과 필수 `width/depth/height`, 선택형 `roofHeight/offsetX/offsetY`로
고정 바닥과 벽·지붕의 그림자를 작성할 수 있다. sprite 이미지 크기와 physics 높이는 별개이며
각 필드의 기본값·scale·지원 범위는 [건물 그림자 계약](data-scene-presentation.md#건물의-입체-그림자-도형)을 따른다.
반투명 겹침은 방향/coverage를 합성하는 deferred 근사이며 각 투명 layer의 물리 광학 합성을 제공하지 않는다.

WebGL2/WebGPU는 활성 normal 프레임에서 명령 순서대로 두 RGBA8 target(physical pixel당8 bytes)을 추가로 그린다.
`RendererStats.normalDrawCalls`와 전체 draw/bind/switch/resource 통계에 비용을 포함한다.
normal이 없거나 lighting이 꺼지면 추가 target/pass가 없고 이전 target을 해제한다. `renderToTexture`의 sprite-only 경로에는 조명을 적용하지 않는다.

### 도트 프로젝트 저장과 재열기

데스크톱의 Open Project에서 연 프로젝트는 **프로젝트 저장** 또는 도트 탭의 Ctrl/Cmd+S를 지원한다.
현재 도트를 자산으로 등록하고 원본·PNG를 저장한 뒤 기존 씬 초안을 저장한다. 그림 등록/저장이 객체의 이미지를 자동 교체하지는 않으며 **선택 객체에 적용**은 별도 동작이다.
위치·크기·collider/body·behavior와 씬/픽셀 Undo의 경계를 유지한다.

- `public/assets/.ferrum-pixels/<assetId>.json`: 편집 가능한 `ferrum2d.pixel-document` v1/v2/v3/v4/v5/v6/v7/v8/v9 원본.
- 같은 위치의 `<assetId>.png`: 원본의 모든 프레임에서 보이는 레이어를 합성한 RGBA8 PNG.
- `catalog.json`: `ferrum2d.pixel.catalog` v1의 revisions와 게임용 texture manifest.

desktop 전용 `load_placement_pixel_assets`/`save_placement_pixel_assets`는 허가된 프로젝트에만 접근한다.
저장 요청은 `ferrum2d.pixel-project.assets` v1로 원본/PNG의 base64·SHA-256·identityDocument·치수와 `expectedCatalogRevision`을 전달한다.
이 값은 마지막 load/save에서 확인한 catalog 원본 bytes의 SHA-256이며 최초 catalog 부재는 빈 문자열이다.
외부 catalog 변경, 링크/경로 이탈, 원본/PNG 불일치와 기존 불변 파일의 다른 bytes는 저장을 거절한다.
상한은 catalog 8 revision/64 MiB, 원본 v1/v4 400,000 bytes/v2 3 MiB/v3·v5·v6·v7·v8·v9 12 MiB다. PNG는 기존4 MiB/한 변256, v3/v5는8 MiB/한 변1024, v6/v7/v8/v9은16 MiB/한 변2048다. cel·Undo 예산은 확대하지 않는다.
v3 metadata의 width/height는 atlas 치수이며 편집 프레임 치수는 원본 width/height를 사용한다.
native 호스트는 숨긴 레이어까지 검증하고 TypeScript와 같은 합성 규칙으로 PNG를 대조한다. Pixel 전용 원본 상한이며 Aseprite/타일 원본 상한은 확대하지 않는다.

호스트는 모든 입력을 검증하고 immutable 파일 생성·catalog 교체·protocol 등록을 수행한다.
프런트엔드는 `ferrum2d.pixel.project` v1 응답과 revision URL을 다시 읽어 원본/hash/identity·PNG checksum·투명 RGB까지 확인한 뒤 persisted로 표시한다.
공백·키 순서가 다른 유효한 JSON도 원본 bytes를 별도로 보존해 재저장 시 기존 ID/hash가 바뀌지 않는다.
같은 문서의 의미가 같은 저장 원본은 기존 revision을 재사용해 서식만 다른 canonical JSON 복제본을 추가하지 않는다.
native는 검증된 치수 metadata를 정수로 정규화해 `2.0`을 읽은 브라우저가 `2`로 재전송해도 같은 revision을 재저장할 수 있다. 편집 원본 bytes는 정규화하지 않는다.
PNG는 RGBA8의 기본 필터·분할 IDAT·Adam7을 지원하며 전체 끝 청크/CRC를 검사한다.
sRGB 원본과 충돌하는 감마·색도 정보와 ICC/HDR 프로필은 거절해 브라우저 색 변환으로 다른 그림이 표시되지 않게 한다.
저장 bundle은 모든 revision 필드·원본·PNG를 첫 비동기 hash 전에 snapshot으로 고정한다.
다시 연 프로젝트의 자산 카드는 편집 원본을 복원하며 같은 프로젝트의 다른 씬에서도 사용할 수 있다.
게임 로더는 catalog의 manifest 상대 경로를 catalog 디렉터리 기준으로 해석하고 기존 AssetLoader·scene-authoring 경로로 읽는다.

자산과 씬은 별도 저장 경계다. 자산 저장 성공 후 씬 충돌이 발생하면 저장된 원본과 기존 디스크 씬을 보존하고 씬 초안을 유지한다.
처리 중 탭 전환·종료로 결과 확인이 중단되면 이미 저장된 파일을 취소됐다고 표시하지 않고 프로젝트 재열기를 안내한다.
세션 미사용 정리는 persisted 프로젝트 자산을 삭제하지 않는다. 프로젝트의 관리 Catalog 정리는 별도 명시적 흐름을 따른다.
문자열 이름과 runtime 숫자 ID를 모두 검사해 저장·다른 씬 열기의 경계를 유지한다.
bundle은 prefab/variant/fragment/include의 실제 sprite texture와 billboard normal ID를 안정적인 자산 이름으로 변환한 scene 사본을 내보낸다.
다른 metadata는 바꾸지 않으며 지원하지 않는 위치의 숫자 texture 참조는 조용히 이식하지 않고 진단한다.
기존 가져오기 기능과 별개의 자체 제작 도구이며 Aseprite 설치·파일·CLI가 필요하지 않다.

## Aseprite Assets 가져오기·재import

공식 Placement Viewer는 Aseprite JSON+PNG를 검증하고 Assets catalog에 연결한다.
`Inspect`는 PNG 서명·실제 decode 크기·SHA-256과 metadata/frame rect를 확인하며 씬을 바꾸지 않는다.
`Register`는 문서 세션에 atlas/frame을 등록한다. `Apply Frame`과 `Reimport`는 기존 `updateComponents` patch를
한 번의 Undo transaction으로 적용하며, 작성한 size/pivot/transform/collider/body/behavior는 유지한다.

공식 UI는 비회전 정수 rect, 1~256 frame과 trim 프레임 복원을 지원한다. frame ID는 확장자까지 유지한다.
JSON hash/array 형식을 받으며 `meta.image` basename과 선택 PNG 파일명을 대조한다. 외부 파일/URL을 자동으로 읽지 않는다.
`trimmed:true`에는 `sourceSize`와 `spriteSourceSize`가 필요하다. [Aseprite 개발자 설명](https://community.aseprite.org/t/checking-trim-in-export-sprite-sheet-window-cause-the-sprite-to-move-in-the-sheet/1248/2)의 원본 canvas·offset 의미를 따른다. 원본 canvas 안의 정수 offset에 RGBA를 복사해 투명 여백을 복원한다.
trim 원본은 sRGB RGBA8 PNG(Adam7 포함)이며 모든 프레임의 원본 canvas 크기가 같아야 한다. 누락/초과 offset·회전·색 공간 변경·복원 예산 초과는 거절한다.
배치 위치는 UTF-8 frame ID 순으로 결정하지만 목록과 frameTags는 원본 순서를 유지한다. 기존 객체의 크기·origin·transform은 바꾸지 않는다.
frameTags/duration은 아래 명시적 animation import/migration으로 연결한다.
일반 Apply Frame/Reimport는 animated/legacy sprite 교체를 거절한다. normal binding이 있는 대상의 일반 Apply Frame/Reimport는 차단하고,
정적 대상은 Generate Normals/Reimport Normals, 애니메이션 대상은 Apply Paired/Reimport Paired로 color/UV와 노멀을 함께 교체한다.
이는 app 정책이며 기존 standalone importer의 옵션/정규화 동작을 변경하지 않는다.

재import는 활성 fragment가 참조하는 이전 revision의 UV를 frame 이름에 대응시킨 뒤 새 UV로 교체한다.
누락되거나 동일 UV의 이름이 여러 개라 모호하면 해당 인스턴스를 진단하고 갱신을 막는다.
`Apply Frame`으로 프레임을 명시할 수 있다. 다른 fragment·Undo/Redo의 이전 revision은 유지한다.
revision별 내용 기반 texture 이름으로 새 이미지를 별도 업로드하므로 실패/취소가 이전 GPU 이미지를 덮어쓰지 않는다.
잠금/문서/선택 변경은 적용 직전에 다시 확인한다. 문서 전환·Game Preview 진입은 진행 작업을 취소한다.

JSON 1 MiB, 원본/복원 PNG 각각16 MiB·한 변4096/4 megapixel, session revision 합계8건/64 MiB 상한이다. 합계에는 별도로 보존한 원본 PNG도 포함한다.
문서 닫기는 미저장 Blob URL·GPU texture를 해제한다. 검증·저장된 프로젝트 에셋은 같은 프로젝트의 다른 씬을 위해 유지하고 작업공간 종료 때 해제한다.
2D 작성 overlay와 HD-2D preview를 재사용하며 실제 2D native 결과는 Game Preview에서 확인한다.

app 전용 `asepriteImports[]` handoff 확장은 현재 씬이 참조하는 논리 asset 이름·revision ID·원본명·hash·frame을 제공한다.
engine `ScenePlacementAgentHandoff` 반환 계약과 scene JSON schema에 이 필드를 추가하지 않는다.
`Export Assets`의 `ferrum2d.aseprite.assets` v1 bundle은 문서 키·revisions·manifest·원본 JSON/PNG files를 담는다.
trim revision은 `<id>.json`에 원본 JSON, `<id>.source.png`에 원본 packed PNG, `<id>.png`에 복원된 게임용 atlas를 담는다.
optional `revisions[].sourcePng: {sha256,width,height}`는 원본 PNG를 가리키며 반드시 해당 파일과 함께 제공한다. revision ID는 원본 JSON/packed PNG hash를 사용한다.
게임은 manifest의 `<id>.png`와 씬 patch의 복원 UV를 사용한다. 원본 JSON을 별도 importer로 읽을 때는 `<id>.source.png`를 짝지어 사용한다.
파일별 base64/SHA-256을 검증하고 프로젝트 안에 `overwrite:false`로 설치한 뒤, manifest의 stable 이름과 `srgb`를 catalog에 등록한다.
동반 Copy Patch/handoff를 씬에 반영하고 새 세션에서 catalog를 먼저 로드해 다시 연다. bundle 자체에는 씬 JSON이 없다.
설치 전 imported reference의 scene-only Save와 문서 간 복사를 막으며, export를 실제 저장 완료로 간주하지 않는다.
세부 UI 절차는 저장소의 `apps/placement-viewer/README.md`를 따른다. browser-only 파일 쓰기와 백그라운드 normal 자동 재생성은 제공하지 않는다.

노멀 pair는 기존 `public/assets/.ferrum-normals/`에 불변 저장한다. **프로젝트 저장**은 color/source 저장·재읽기 검증 → 현재 미리보기/씬 참조 normal pair 저장·검증 → 씬 저장 순서다.
앞 단계가 실패하면 씬을 저장하지 않고 기존 파일/씬을 보존한다. 취소가 디스크 commit 뒤 도착한 경우에는 파일 저장 가능성을 안내하고 재열기를 요구한다.
새 세션은 도트 JSON/PNG와 normal metadata/PNG를 각각 읽고 source SHA-256·frame ID/rect가 모두 일치해야 pair를 활성화한다.
color texture는 pixel store와 공유하고 normal texture만 normal store가 소유한다. 저장된 pair와 같은 설정의 재생성은 업로드된 normal을 빌려 중복 등록/해제하지 않는다.

### 영역(slice) 메타데이터와 명시적 기준점 적용

`Inspect` 후 Preview의 **Slice and Origin / 영역·기준점**을 펼치면 이름 있는 slice와 원본 key frame을 선택할 수 있다.
미리보기에는 bounds, pivot 십자와 9-slice center 점선을 표시한다. 선택과 미리보기는 씬을 바꾸지 않는다.
프레임에 자산을 적용한 뒤 **Apply Origin / 기준점 적용**을 누르면 선택한 unlocked sprite의 `visual.originX/Y`만 바뀐다.
기존 크기·UV·위치·회전·scale·collider/body·normal·animation 설정은 보존하며 한 번의 Undo/Redo로 되돌린다.
일반 Apply Frame/Reimport/Animation migration은 현재 origin을 계속 보존한다. 새 원본의 pivot을 쓰려면 다시 명시적으로 적용한다.

- `meta.slices` 최대64개, keys 합계256개. 이름은 고유한 비어 있지 않은 최대256자 문자열이고 key.frame은0..65535의 중복 없는 오름차순 정수다. 원본에 keys가 없는 slice도 표시한다.
- [Aseprite 좌표 규칙](https://www.aseprite.org/api/slice)에 따라 bounds는 원본 canvas 기준, pivot/center는 bounds 좌상단 기준이다. 좌표는 정수이며 bounds x/y·pivot x/y는-4096..4096, w/h는1..4096이다. center는 bounds 안의 양수 사각형이어야 한다.
- 적용 origin은 `(bounds.x + pivot.x) / frameCanvasWidth`, `(bounds.y + pivot.y) / frameCanvasHeight`다. trim 복원 canvas에도 같은 규칙을 쓴다. 적용할 bounds가 canvas 밖이면 거절한다. pivot 자체는 canvas 밖의 유한 origin도 허용한다.
- [원본 exporter의 key.frame](https://github.com/aseprite/aseprite/blob/main/src/app/doc_exporter.cpp)은 원본 timeline 번호다. 내보낸 frame 목록 순서와 같다고 추정하지 않고 직접 고른다. 키 선택은 시간별 pivot 애니메이션을 만들지 않는다.
- 정적 sprite는 Preview에서 현재 사용 중인 frame을 골라야 한다. animated sprite는 같은 원본 canvas 크기의 알려진 frame들을 사용할 때 하나의 공통 origin을 적용한다. 여러 frame ID가 같은 rect를 공유해도 허용한다.
- pivot 없는 key와 center는 읽기 전용이다. 잘못되거나 미지원인 slice metadata는 이 기능에서 진단하고 일반 frame/animation import를 막지 않는다. 이 Slice 가져오기 UI는 9-slice 설정·resize/crop을 자동 적용하지 않는다. 일반 2D의 실제 9-slice 렌더링은 [별도 authoring/API 설정](public-api/core.md#2d-9-slice-렌더링-개발-소스)을 사용한다.

원본 JSON 안의 slice metadata와 씬의 origin을 기존 자산·씬 저장 경로로 보존하고, 재열기에서 메타데이터를 다시 해석한다.
선택 중인 slice/key는 임시 UI 상태다. 새 scene schema/native catalog/runtime 필드는 없으며 standalone importer API도 바꾸지 않는다.

### Aseprite 애니메이션 import와 migration

`Inspect` 후 Preview의 **Aseprite initial animation**과 **Aseprite loop new clips**를 선택하고
**Apply Animation**을 누르면 선택한 unlocked 정적 sprite에 모든 태그를 `visual.animationSet`으로 연결한다.
같은 논리 atlas의 기존 animationSet에 적용할 때는 기존 clip ID·initialClip·loop를 유지하며 새 clip에만 loop 설정을 적용한다.
Apply Frame은 정적 교체이고 이 action은 명시적 애니메이션 변환이다. timeline/클립 본문 편집은 제공하지 않는다.

- `meta.frameTags` 1..64개, 고유한 비어 있지 않은 이름(최대 256자), 유효한 from/to 인덱스를 요구한다.
- `forward`, `reverse`, `pingpong`, `pingpong_reverse`를 지원한다. pingpong은 양 끝을 중복하지 않는 한 주기로 펼친다.
- frame 인덱스는 원본 JSON의 array/hash 순서를 따른다. 태그에 포함된 frame의 duration은 양의 uint32 정수 ms다.
- duration의 정수 GCD를 tick으로 삼아 UV를 반복한다. 예: 90ms/180ms는 90ms tick 3개가 된다.
  이 변환 경로의 기존 32 frame·FPS 0.001..1000 제한을 넘으면 근사하지 않고 거절한다.
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
  문서 닫기는 미저장 메모리/GPU 자원만 해제한다. 저장·복원된 프로젝트 pair는 같은 프로젝트의 다른 씬에 제공하며
  작업공간 종료 때 해제한다. 디스크 catalog는 문서 닫기로 줄이지 않는다.

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
trim host는 원본에서 pixels·rect·UV를 독립 복원해 게임용 PNG를 검증하고, 원본 PNG도 exclusive create·protocol 등록·정리/백업/복원 대상으로 포함한다.
재열기는 source sidecar hash/identity와 게임용 PNG의 전체 RGBA를 확인한 뒤 저장된 PNG를 재사용한다. 압축 bytes가 달라도 원본 ID가 바뀌지 않는다.
trim 저장 metadata의 `sourcePng`는 지원하는 세 필드로, frame rect/UV는 검증된 값과 UTF-8 ID 순으로 정규화한다. UI와 태그의 원본 순서는 유지한다. 기존 untrim v1 자산은 원본 PNG와 JSON 두 파일을 그대로 사용한다.
새 trim 자산은 최신 앱/desktop host를 함께 사용해야 하며 이전 호스트는 trim 원본을 거절한다. Data Scene schema·Rust/Wasm ABI는 바꾸지 않는다.
기존 export v1에 identityDocument가 없으면 native import는 bundle.document에서 이를 복원한다.
프로젝트 재개방 시 원본을 검증·로드하고 frame browser/재import를 복원한다. handoff의 `persisted`는 실제 파일 확인 뒤 true가 된다.
첫 catalog 예산은 8 revision/원본 64 MiB이며 자동 정리하지 않는다.
검증·저장된 에셋은 명시적으로 같은 프로젝트로 연 씬 간에 공유하고, 미저장 세션 에셋과 다른 프로젝트/임의 문서의 참조는 차단한다.
기본 문서를 닫아도 프로젝트 에셋의 GPU 자원을 유지하며, 새 catalog 쓰기 권한은 기존 기본 문서 경계를 유지한다.

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

비교 preview에서 문서를 다시 적용하면서 같은 객체의 재생 단계와 거리 LOD를 유지하려면
`{ preserveAnimationAndLod: true }`를 선택한다. 기본값은 false이며 첫 적용·일반 씬 전환은 기존처럼 초기화한다.
이 옵션은 이전에 완전한 기본 binding 옵션으로 적용한 문맥과 새 Wasm의 cold handoff 기능이 필요하고,
`activateDataScene: false`와 함께 사용할 수 없다. 지원하지 않는 Wasm이나 문맥은 activation 전에 거절한다.

- TS는 stable authored ID를 맞추고 정규화한 animationSet(초기 clip 포함)과 asset/contentId·LOD 목록을 비교한다.
  실제 elapsed time·flip·pause·선택 LOD는 JS로 전달하지 않고 Rust가 한 번 사용할 token 안에 보관한다.
- 같은 animationSet은 clip·elapsed time·flip·개별 pause를 그대로 유지한다. 명시적으로 초기 clip/프레임이나
  clip 구성을 바꾸면 새 설정이 우선한다. 다른 객체의 sprite/GLB 교체는 유지 가능한 애니메이션에 영향을 주지 않는다.
- 같은 모델과 LOD policy는 선택 이력을 유지하고 새 카메라·배치에서 native hysteresis를 다시 평가한다.
  바뀐 asset/거리 policy는 새 설정으로 시작한다. chunk residency 상태는 보존하지 않는다.
- source handle이 제거됐거나 구성이 호환되지 않으면 해당 값은 넘기지 않는다. 문서 적용은 여전히 entity를 재구성하며
  physics·FSM·경로·씬 lifecycle 전체를 보존하는 옵션이 아니다. 씬 일시정지는 caller가 별도로 유지한다.
- handoff는 최대 10,000개 instance의 bulk handle/mask로 처리하고 성공·실패 후 임시 참조를 해제한다.
  기존 render ABI와 game-state JSON 저장 형식은 바뀌지 않는다. LOD 이력은 여전히 영속 저장 데이터가 아니다.

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
movement?}`를 저장한다. frame과 finished·pingpong 진행 방향은 authored clip의 시간·재생 순서와 경과 phase에서 다시 계산한다.
명시적 `animationSet`의 프레임별 ms·방향·256프레임·이벤트 계약은 [런타임 클립](data-scene-presentation.md#캐릭터별-atlas-클립)을 따른다.
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

전체 맵의 `objectPrefabs` 대상은 유효한 inline `props.components`가 있는 기존 정의여야 한다. 빈 정의나 template-only 정의는 배치 전에 거절한다.


### 2D 창·패널의 9-slice 테두리

sprite visual에 `nineSlice: {sourceWidth:16, sourceHeight:12, left:2, right:4, top:3, bottom:1}`을 지정하면
width/height를 변경해도 모서리와 테두리 폭을 보존한다. sourceWidth/Height는 전체 atlas가 아닌 현재 frame의 pixel 크기다.
`borderScale`(기본1)은 테두리 크기에만 적용되고 instance `scale`은 전체 크기와 borderScale 양쪽에 곱한다.
`flipX/flipY`는 기본false이며 비대칭 경계도 함께 뒤집는다. 타깃이 너무 작으면 테두리를 비례 축소한다.
기존 sprite shorthand도 같은 속성을 지원하며 bounds·선택·collider는 전체 object 기준이다.
현재 flat2D용이며 spatial billboard/model 및 alpha silhouette shadow 조합은 diagnostic으로 거절한다.
Aseprite Slice 도구의 center는 여전히 가져오기 metadata이며 자동으로 이 설정으로 변환하지 않는다.
[공개 API 계약](public-api/core.md#2d-9-slice-렌더링-개발-소스)과 `pnpm smoke:sprite-nine-slice`를 참고한다.
