# Ferrum2D 게임 개발 기능 안내서

게임 요구사항을 엔진 기능으로 연결할 때 먼저 읽는 consumer 안내서다. API 전체 명세는 아니며,
필요한 기능을 고른 다음 설치된 공개 타입과 같은 버전의 상세 문서로 정확한 인자를 확인한다.
아래 기능 설명의 기준은 **엔진 `0.1.0-beta.5`**다. 이 안내서가 있다는 사실만으로 설치된
엔진이 모든 기능을 지원한다고 판단하지 않는다. guide/agents와 runtime은 각각 확인한다.
안내서는 **agents `0.1.0-beta.6`부터 제공**한다. beta.6은 AI 안내서/지침 배포이며 runtime API는 beta.5와 같다.

## 1. 개발 전 확인 순서

1. **요청 범위:** 설치만 요청했으면 의존성·도구·AI 지침 확인 후 종료한다. 이 안내서의 예제나
   게임 템플릿, `src/`, `public/`, viewer, 서버를 자동 생성하지 않는다. 기존 게임은 보존한다.
2. **실제 버전:** `npm ls @ferrum2d/ferrum-web --depth=0`과 설치된
   `node_modules/@ferrum2d/ferrum-web/package.json`을 확인한다. 프로젝트 `package.json`의
   dependency URL, `ferrumGithubRelease`, `FERRUM_INSTALL.md`는 배포 출처와 대조한다.
   서로 다르면 설치/lockfile 상태부터 확인하며, 임의로 재설치하거나 최신 API를 가정하지 않는다.
3. **공개 계약:** 설치 패키지 `package.json.exports`의 `types`가 가리키는 `.d.ts`를 읽어
   함수·옵션·주석을 확인한다. `dist/*.d.ts`를 파일로 읽는 것은 허용하지만 게임에서
   `@ferrum2d/ferrum-web/dist/*`, `/pkg/*`, `/src/*`를 import하거나 수정하지 않는다.
4. **기능 선택:** 아래 표에서 요구사항을 찾아 엔진이 이미 제공하는 기능을 먼저 조합한다.
   필요한 입력값·에셋·지원 범위와 선택한 API를 짧게 기록한다. 모든 문서를 한꺼번에 읽을
   필요는 없으며 해당 기능의 reference를 확인한다.
5. **버전별 상세 문서:** 아래 링크는 beta.5에 고정돼 있다. 다른 릴리즈라면 출처가 확인된
   저장소와 tag의 동일 문서 경로를 사용한다. 공식 tag 형식은 `ferrum-web-v<version>`이다.
   `main`이나 planning 문서를 설치 버전의 기능 증거로 삼지 않는다. 로컬 `0.1.0` 빌드는
   특정 beta로 환산하지 말고 설치 타입과 빌드 출처 commit을 확인한다.
6. **검증:** 프로젝트에 있는 검증 명령과 브라우저 조작으로 결과를 확인한다. 네트워크가 없으면
   로컬 타입·README·기존 예제를 근거로 삼고, 동작 의미를 확인하지 못한 부분은 미확인으로 남긴다.
   타입 검사는 실제 화면·성능·플레이 경험 검증을 대신하지 않는다.

`ferrum:report`는 프로젝트의 파일·의존성·입력/검증 상태를 요약하는 명령이다. 엔진의 모든 기능을
검색하는 명령이 아니며, 초기 설정 프로젝트에는 없을 수 있다.

## 2. 공개 import 경로 선택

| 경로 | 용도와 지원 수준 |
| --- | --- |
| `@ferrum2d/ferrum-web/core` | 런타임, 입력, 에셋·오디오, 물리, 카메라, 저장. stable: 1.0 계약 후보이며 현재 배포는 beta다. |
| `@ferrum2d/ferrum-web/authoring` | Data Scene, 오브젝트 구성, 행동·FSM, 콘텐츠·연출. preview: 공개 기능이지만 1.0 전에 변경될 수 있다. |
| `@ferrum2d/ferrum-web/starter-scenes` | Shooter 설정과 내장 게임/에셋 import helper. preview이며 범용 장르 구현과 구분한다. |
| `@ferrum2d/ferrum-web/labs` | 선택적 WebGPU, material/VFX, atlas/terrain helper. preview이며 기능별 환경 제약을 확인한다. |
| `@ferrum2d/ferrum-web/quality` | 프로파일러, 진단, replay, 스크린샷. preview이며 검증 보조 도구다. |

표의 `/core` 등은 위 package subpath를 줄인 표현이다. root `@ferrum2d/ferrum-web`은 기존 코드
호환용 aggregate다. 신규 코드는 목적별 subpath를 사용한다. 표의 `engine.*`, `runtime.*`,
`view.*`, `input.*`, `renderer.*`는 객체의 메서드이며 독립된 named export가 아니다.

## 3. 요구사항으로 기능 찾기

### 게임 구조와 캐릭터

| 하고 싶은 일 | 기능과 시작 API/설정 | 준비할 것·주의할 점 | 상세 문서 |
| --- | --- | --- | --- |
| 게임을 시작·종료하기 | `/core` `createFerrumRuntime`, `createEngine` | 일반 브라우저 게임은 canvas·입력·오디오·renderer를 묶는 runtime부터 검토. 직접 loop가 필요할 때 저수준 engine 사용 | [Core][core] |
| 탐험 등 고유한 게임 씬 만들기 | `/authoring` `resolveSceneAuthoringDocument`, `applyDataSceneAuthoringDocument`; `createFerrumRuntime({ dataScene })` | ObjectDefinition/prefab과 instance, components, behavior를 구성. Shooter 설정을 범용 씬으로 가정하지 않음 | [Data Scene][scene] |
| 방/레벨 전환·일시정지 | `runtime.dataScene.transition`, `reapply`, `pause`, `resume`, `complete` | `dataScene` 옵션으로 시작한 runtime인지 확인. 전환/reapply reset 뒤 새 handle로 카메라·행동 연결 | [Core][core] |
| 이미지·색·크기·피벗·가림 순서 | `/authoring` `resolveDataSceneComponentsSpec`, `components.visual` | `texture`, `width/height`, `originX/Y`, `tint`, `layer`, `depthSort`. 배경과 월드 band를 구분 | [Native actor][native] |
| 캐릭터 이미지와 충돌체를 같이 이동 | `components.visual`, `collider`, `body`; `/core` 물리 API | sprite와 body를 같은 entity에 조립. body 종류·충돌 layer·heightSpan 설정. TS에서 별도 좌표를 매 프레임 복제하지 않음 | [Native actor][native], [Physics][physics] |
| 대기·걷기·방향별 애니메이션 | `visual.animationSet`; `engine.configureDataSceneSpriteAnimation`, `updateDataSceneSpriteAnimations` | atlas UV frame, clip id/fps, flip, pause/seek를 사용. 재생 시간은 Rust가 진행; 여러 actor 변경은 batch | [표현 확장][presentation] |
| 추적·순찰·발사·상태 전환 | `/authoring` `resolveBehaviorRecipeDocument`, `resolveBehaviorStateMachineDocument`, `applyGameplayBehaviorCommands` | 지원 recipe/FSM 조건·action으로 구성. 복잡한 NPC 판단이 자동 제공된다고 가정하지 않음 | [Authoring][authoring], [Runtime 확장][runtime] |
| 무기·투사체·쿨다운 구성 | `/authoring` `ProjectileDefinition`, `WeaponDefinition`, `compileWeaponProfiles`, `behaviorRecipeCommandsForEntity` | 정의를 runtime command로 변환해 적용. TS frame loop에서 충돌·피해 판정을 중복 구현하지 않음 | [Authoring][authoring] |
| 내장 슈터·플랫포머·벽돌깨기에서 시작 | `/starter-scenes` `resolveShooterGameSpec`; `engine.usePlatformerGame`, `useBreakoutGame` | 해당 starter의 입력·상태·spec 계약을 따른다. `setGameSpec`은 진행 상태를 초기화할 수 있음 | [Starter scenes][starters] |

### 입력·카메라·표현

| 하고 싶은 일 | 기능과 시작 API/설정 | 준비할 것·주의할 점 | 상세 문서 |
| --- | --- | --- | --- |
| E 조사·Shift 달리기·키 변경 | `/core` `InputManager`, `resolveInputActionProfile`; `input.actionSnapshot()` | `KeyboardEvent.code` 형식, held와 justPressed/released 구분. update당 한 번 읽어 공유 | [입력][input] |
| 메뉴에서 게임 입력 차단·복구 | `input.setEnabled`, `clear` | gameplay/UI context는 앱이 전환하며 manager를 차단·복구. 입력 차단과 씬 pause는 별개이고 기존 이동 목표도 별도 취소 | [입력][input] |
| 터치·게임패드 조작 | `/core` `VirtualControls`, `InputManager`의 gamepad/touch 설정 | 지원할 입력을 명시하고 실제 기기/viewport에서 확인. PC 키보드 검증으로 대체하지 않음 | [사용자 설명서][user] |
| 캐릭터 추적·zoom·클릭 월드 좌표 | `/core` `createDataSceneView`; `view.setCamera`, `setZoom`, `pointerToWorld`, `snapshot` | 표시된 frame의 카메라/좌표 snapshot을 공유. CSS 픽셀·DPR·물리 좌표 구분 | [Native actor][native] |
| HD-2D처럼 지면과 직립 캐릭터 표현 | `visual.projection: "ground" / "upright"`, `depthSort: "hd2d"`; `view.setGroundYScale` | 2.5D 지면 Y 압축이다. 물리 좌표 유지, 발 피벗 권장. 3D 원근·카메라 회전 아님 | [표현 확장][presentation] |
| 태양과 캐릭터/나무 지면 그림자 | `view.setSun`, `view.lighting`; `visual.shadow.shape`의 `ellipse`, `box`, `alpha` | 태양과 caster를 함께 설정. alpha는 현재 frame의 투명도 사용. 3D 높이·receiver 모델 아님 | [표현 확장][presentation] |
| 횃불·점광원·차폐물 | `/labs` `normalizeLightingScene`; `renderer.setLighting`, `view.lighting` | light/occluder를 같은 좌표계로 변환. 태양의 sprite 그림자와 별도 경로 | [사용자 설명서][user], [Labs][labs] |
| 피격 flash·outline·파티클·화면 연출 | `/labs` `resolveSpriteMaterialPreset`, `ParticleVfxEmitter`; `/authoring` `resolvePostProcessPasses` | gameplay 결과와 presentation 분리. 전역 sprite material은 지면 그림자에도 영향. WebGPU의 post-process 지원 범위 확인 | [Labs][labs], [사용자 설명서][user] |
| 이름표·데미지 숫자·HUD | `engine.loadBitmapFont`, `setWorldText`; `/core` `UiOverlay` 또는 앱 HTML/CSS | 월드 글자와 화면 고정 HUD 구분. `ui: false`는 기본 overlay만 끄며 앱 HUD·입력·canvas를 제거하지 않음 | [Core][core], [사용자 설명서][user] |
| 별도 화면에 렌더링 | `/core` `WebGL2Renderer`의 RenderTexture API | WebGL2 범위, texture 수명/feedback 금지 확인. 프레임을 보관하면 command와 projection metadata 모두 복사 | [Core][core] |

### 물리·에셋·콘텐츠·검증

| 하고 싶은 일 | 기능과 시작 API/설정 | 준비할 것·주의할 점 | 상세 문서 |
| --- | --- | --- | --- |
| 충돌·센서·강체·조인트·공간 질의 | `/core` `resolvePhysicsSpec`, `createPhysicsWorldFromSpec`; `engine` body/query API | 지원 collider, raycast/shape cast, timestep/CCD/layer 범위를 확인. 3D 또는 무제한 복잡 물리 아님 | [Physics][physics] |
| PNG/atlas·Tiled·LDtk·Aseprite 가져오기 | `/core` `AssetLoader`; `/labs` `packTextureAtlas`; `/starter-scenes` `importAsepriteAtlas`, `importTiledGameSpec`, `importLDtkGameSpec` | 원본 → 지원 manifest/spec 변환 → 검증 → 로딩. 각 도구의 모든 포맷 기능을 지원하는 것은 아님 | [Starter scenes][starters], [Labs][labs] |
| 로딩 화면·압축 텍스처·캐시 | `/core` `preloadAssetManifest`, `LoadingOverlay`, `createKtx2Transcoder`; `/labs` `IndexedDbAssetCache` | URL·배포 base·압축 형식/renderer 지원·cache 무효화 정책 확인 | [Core][core], [Labs][labs] |
| 효과음·배경음·음량 | `/core` `AudioAssetLoader`, `AudioManager`, `SoundRegistry` | sound manifest/ID, audio bus 설정. 브라우저 오디오는 사용자 조작 후 재생 가능 여부 확인 | [사용자 설명서][user] |
| 다국어·대화 선택·퀘스트·컷신 | `/authoring` `LocalizationBundle`, `DialogueSession`, `resolveDialogueGraph`, `resolveQuestDocument`, `resolveCutsceneSequenceSpec` | 콘텐츠 데이터와 presentation 구성. Shooter의 `content`는 `/starter-scenes` `createShooterContentRuntimeOptions`로 연결 | [Authoring][authoring], [사용자 설명서][user] |
| 씬 변수·세이브/로드 | Scene Authoring `variables`; `/core` `captureGameStateSnapshot`, `restoreGameStateSnapshot`, `saveGameStateSnapshotToStorage` | snapshot 지원 상태와 앱 소유 UI/외부 상태 구분. arbitrary JS object나 네트워크 저장이 자동 포함되지 않음 | [Authoring][authoring], [Core][core] |
| 넓은 맵의 구역별 로딩 | `/authoring` `LevelChunkStreamer`, `createRuntimeLevelStreaming` | opt-in manifest/chunk와 load/unload 수명 정책 구성. 무제한 오픈월드 성능을 보장하지 않음 | [Authoring][authoring], [사용자 설명서][user] |
| 픽셀 지형 일부 지우기 | `/labs` `createPixelMaskTerrain`, `createPixelMaskTerrainRuntime` | alpha patch와 collider 갱신 보조 기능. 대규모 파괴 지형은 별도 범위/성능 검증 필요 | [Labs][labs] |
| 오류·성능·replay 확인 | `/quality` `RuntimeProfiler`, `diagnosticReport`, `createGameplayReplayRun`, `compareGameplayReplayRuns` | 실제 metric·시드·입력·snapshot을 기록. report 생성과 플레이 경험 검수 구분 | [Quality][quality] |

오브젝트 배치를 눈으로 확인할 때는 프로젝트에 준비된 `ferrum:placement-viewer`와 authoring report를
사용한다. 위치·visual/collider/layer·ObjectDefinition·기존 recipe 참조를 다루는 보조 도구이며,
행동/FSM 본문을 편집하는 전체 visual editor는 아니다. 설치만 요청받았을 때 추가하지 않는다.

## 4. 최근 기능의 최소 버전

| 기능 | 제공 시작 | 이전 버전에서의 처리 |
| --- | --- | --- |
| native sprite/body 연결, Data Scene camera/view | `0.1.0-beta.2` | 해당 타입·메서드가 없으면 적용 전에 업그레이드 범위를 설명 |
| actor별 animationSet, ground/upright 투영, 태양·도형 그림자 | `0.1.0-beta.3` | 최신 설정을 구버전 spec에 넣지 않음 |
| 임의 키 code, action edge, input context/차단 | `0.1.0-beta.4` | legacy 입력을 새 계약으로 오인하지 않음 |
| sprite alpha 윤곽 지면 그림자 | `0.1.0-beta.5` | ellipse/box 사용 또는 사용자 요청 범위 안에서 업그레이드 |

모든 API의 도입 버전 목록은 아니다. 나머지 기능도 설치된 타입과 같은 버전의 문서를 확인한다.
업그레이드할 때 JS/Wasm을 같은 runtime 패키지로 교체하고, agents의 기존 파일은 자동으로
덮어써지지 않으므로 새 지침을 빈 임시 디렉터리에 풀어 사용자 수정과 비교·병합한다.

## 5. 짧은 설정 예시

아래 코드는 **요청한 게임 기능에 넣을 설정 조각**이다. 실행 가능한 완성 게임이나 설치 시 생성할
템플릿이 아니다. 숫자 texture ID는 실제 로드 결과로 연결해야 한다.

### 캐릭터 그림자 설정

```ts
import { resolveDataSceneComponentsSpec } from "@ferrum2d/ferrum-web/authoring";

const components = resolveDataSceneComponentsSpec({
  visual: {
    kind: "sprite", texture: 1, width: 32, height: 48,
    originX: 0.5, originY: 1, depthSort: "hd2d",
    projection: "upright", shadow: { shape: "alpha", opacity: 0.8 },
  },
  collider: "none", layer: "wall",
});
```

이 예시는 visual만 검증한다. 이동 가능한 캐릭터는 collider/body를 별도로 구성한다.
검증 결과를 scene에 적용하고 태양을 `view.setSun(...)`, lighting을 `view.lighting(...)`으로
연결해야 실제 그림자가 보인다. collider의 `layer: "wall"` 분류와 visual의 숫자 `layer`
렌더 순서는 별개다. 배경은 그림자보다 낮은 render layer에 둔다.

### 조사·달리기 액션 설정

```ts
import { resolveInputActionProfile } from "@ferrum2d/ferrum-web/core";

const actionProfile = resolveInputActionProfile({
  actions: {
    interact: [{ code: "KeyE" }],
    sprint: [{ code: "ShiftLeft" }, { code: "ShiftRight" }],
  },
});
```

기존 `InputManager` 설정에 병합하고 입력 update에서 `actionSnapshot()` 결과를 한 번 공유한다.
`justPressedActions`의 `interact`는 한 번 누른 조사, `actions.sprint`는 유지 중 달리기에 사용한다.
액션 이름만 추가해도 조사/이동 속도 게임 규칙이 생기는 것은 아니다. 엔진이 지원하는 행동
설정/command에 연결한다. runtime이 소유한 입력과 중복된 DOM listener/manager를 만들지 않는다.

### 애니메이션 클립 설정

```ts
import { resolveDataSceneSpriteAnimationSet } from "@ferrum2d/ferrum-web/core";

const animationSet = resolveDataSceneSpriteAnimationSet({
  initialClip: 0,
  clips: [
    { id: 0, fps: 1, frames: [{ u0: 0, v0: 0, u1: 0.25, v1: 1 }] },
    { id: 1, fps: 8, loop: true, frames: [
      { u0: 0.25, v0: 0, u1: 0.5, v1: 1 },
      { u0: 0.5, v0: 0, u1: 0.75, v1: 1 },
    ] },
  ],
});
```

실제 atlas UV로 바꿔 `visual.animationSet` 또는 `engine.configureDataSceneSpriteAnimation`에
전달한다. 이동/방향이 바뀔 때 `engine.updateDataSceneSpriteAnimations` batch를 사용한다.
방향별 이미지가 다르면 해당 clip을 정의하고, 대칭 이미지라면 `flipX`를 사용한다.
이미지 생성이나 이동 상태에 따른 clip 선택 규칙까지 자동으로 만들어주는 API는 아니다.

## 6. 지원하지 않거나 별도 설계가 필요한 것

- 범용 3D mesh/model 렌더링, 원근 3D 카메라, 3D 물리, skeletal animation.
- normal map 조명, 높이·층별 shadow receiver, 차폐 광선, view-depth 기반 DOF는 C1 후속 설계다.
  기존 2D light/occluder, `depthSort`, post-process blur와 구분하고 구현된 것으로 보고하지 않는다.
- multiplayer/netcode, 전체 게임 루프 Worker 이전, Wasm threads. `PhysicsReplayWorkerClient`는
  별도 replay 도구이며 전체 게임 Worker 지원을 뜻하지 않는다.
- 완성된 범용 RPG·인벤토리·제작·퀘스트 게임. 제공 primitive/content를 조합해 게임 규칙과 UI를
  설계해야 한다. 목록에 없는 기능은 바로 미지원으로 단정하지 말고 타입/reference를 검색한다.

필요한 동작을 공개 API로 표현할 수 없다면 요구사항, 설치 버전, 확인한 API, 부족한 동작,
소비자 측에서 가능한 범위를 기록한다. 존재하지 않는 옵션/함수를 만들어 쓰거나 설치된 엔진을
패치하지 않는다. 게임 소유 설정·UI·저빈도 조합과 엔진 소유 시뮬레이션의 경계를 유지한다.

## 7. 검증과 완료 보고

- **초기 설정:** 프로젝트에 정의된 `ferrum:setup-check` 등 설치 확인만 실행한다.
- **게임 변경:** `package.json.scripts`를 확인해 실제 존재하는 `ferrum:check` 또는
  `ferrum:validate`/`ferrum:smoke`/`build`를 선택한다. 데이터·행동은 authoring/replay report도 확인한다.
- **화면·입력:** 브라우저에서 조작, resize/zoom, 캐릭터·배경 가림, HUD 입력 차단, 에셋 실패를 확인한다.
- **보고:** 설치 버전, 선택한 기능/API, 변경한 게임 파일, 실행 명령/결과, 미검수 항목을 남긴다.

엔진 저장소 전용 `pnpm smoke:*`, Rust 빌드나 엔진 소스를 일반 게임 프로젝트에 요구하지 않는다.
상세 개발 절차는 `.agents/harness/ferrum-game-development.md`, 화면 검수는
`.agents/harness/ferrum-game-presentation.md`, replay는 `.agents/harness/ferrum-runtime-replay.md`를 따른다.

[core]: https://github.com/silbaram/ferrum2d/blob/ferrum-web-v0.1.0-beta.5/docs/engine/public-api/core.md
[authoring]: https://github.com/silbaram/ferrum2d/blob/ferrum-web-v0.1.0-beta.5/docs/engine/public-api/authoring.md
[starters]: https://github.com/silbaram/ferrum2d/blob/ferrum-web-v0.1.0-beta.5/docs/engine/public-api/starter-scenes.md
[labs]: https://github.com/silbaram/ferrum2d/blob/ferrum-web-v0.1.0-beta.5/docs/engine/public-api/labs.md
[quality]: https://github.com/silbaram/ferrum2d/blob/ferrum-web-v0.1.0-beta.5/docs/engine/public-api/quality.md
[scene]: https://github.com/silbaram/ferrum2d/blob/ferrum-web-v0.1.0-beta.5/docs/engine/data-scene-authoring.md
[native]: https://github.com/silbaram/ferrum2d/blob/ferrum-web-v0.1.0-beta.5/docs/engine/data-scene-native-runtime.md
[presentation]: https://github.com/silbaram/ferrum2d/blob/ferrum-web-v0.1.0-beta.5/docs/engine/data-scene-presentation.md
[input]: https://github.com/silbaram/ferrum2d/blob/ferrum-web-v0.1.0-beta.5/docs/engine/input-actions.md
[physics]: https://github.com/silbaram/ferrum2d/blob/ferrum-web-v0.1.0-beta.5/docs/engine/physics-spec.md
[runtime]: https://github.com/silbaram/ferrum2d/blob/ferrum-web-v0.1.0-beta.5/docs/engine/runtime-extensibility.md
[user]: https://github.com/silbaram/ferrum2d/blob/ferrum-web-v0.1.0-beta.5/docs/engine/user-guide.md
