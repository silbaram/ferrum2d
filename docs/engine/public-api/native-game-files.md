# Native 게임 파일

`@ferrum2d/ferrum-web/core`의 `createNativeGameFileSession`은 Engine과 SDK 작성 정보·변수·자원을
하나의 파일로 저장하고 새 Engine으로 복원한다. 기존 실행을 유지한 채 새 대상을 준비하고, 검사가 끝나면
세션의 현재 Engine을 교체한다. 저장된 Native 시간·상태·출력 큐를 초기 설정으로 덮어쓰지 않는다.

파일은 같은 Rust/SDK 빌드에서 사용한다. 형식·빌드·길이·CRC 검사는 인증이나 버전 간 마이그레이션이 아니다.
현재 물리 snapshot은 내부 버전 8이다. 외부 F2DFILE v1의 7개 section과 Engine checkpoint 코덱 버전 2를 유지한다.
복원 검사는 저장된 collider 형상과 local pose에 공개 생성 API와 같은 범위(크기 0.0001~10000, PlanarXy Z 30000,
Y축 capsule, 평면 밖 offset 금지)를 다시 적용하고, 저장된 solver hint가 contact graph와 맞는지 확인한다.
범위를 벗어나거나 맞지 않는 파일은 현재 게임을 바꾸지 않고 `prepare` 단계에서 거부된다.
기존 JSON 진행 저장과 같은 Engine의 `RuntimeCheckpoint`는 각자의 계약을 유지한다.

## 기본 사용

```ts
import {
  createEngine,
  createNativeGameFileSession,
  NativeGameFileError,
} from "@ferrum2d/ferrum-web/core";

const initial = await createEngine(undefined, undefined, undefined, undefined, {
  physicsBackend: "unified",
});
initial.useDataScene();
const files = await createNativeGameFileSession(initial);

const bytes = await files.capture();
try {
  const ready = await files.prepare(bytes); // 파일 선택기의 File/Blob도 받는다.
  await files.commit(ready);
  files.current().start();
} catch (error) {
  if (error instanceof NativeGameFileError) {
    console.error(error.phase, error.code, error.cause);
  }
}
await files.dispose();
initial.destroy(); // 초기 Engine은 기본적으로 호출자 소유다.
```

기본 `wasm`은 설치한 package의 배포 URL이다. Headless/custom loader는 같은 배포본의 `Uint8Array`나
`URL`을 `options.wasm`으로 전달한다. 세션은 Wasm bytes를 자체 보관하며 기본 모듈 초기화를 다시 하지 않는다.
저장·복원에 쓰는 별도 Wasm 모듈은 대상의 선형 메모리 한도를 적용한 뒤 비동기로 컴파일한다.
무옵션 생성은 planar native·가변 시간·자동 실행이다. 예제의 명시 `physicsBackend: "unified"`는 기존 고정 시간 기본 선택을 유지한다.
파일 복원은 저장된 실제 backend와 기본 정책을 유지하며 저장된 legacy world를 새 native 기본값으로 변환하지 않는다.

## 실행 전환

| API | 동작 |
| --- | --- |
| `current()` | 현재 게시된 실제 `FerrumEngine` |
| `epoch()` | 성공한 교체 횟수. 파일의 저장 counter와 별개 |
| `capture()` | Native와 SDK 자원의 동일 cut을 검증해 `Uint8Array` 반환 |
| `prepare(bytesOrBlob)` | 기존 실행을 유지하며 새 대상 준비, 일회용 `NativeGameFileReady` 반환 |
| `commit(ready)` | source fence를 다시 확인하고 교체. 결과에 epoch·audio 상태·cleanup 오류 포함 |
| `discard(ready)` | 준비한 새 대상만 폐기 |
| `registry()` | 현재 복원된 Scene Instance handle registry |
| `dialogueQuest()` | 등록·복원된 대화/퀘스트 graph |
| `dispose()` | 세션이 만든 대상과 미사용 준비 대상을 정리 |

Capture/prepare/commit은 실제 실행 루프와 frame/authoring callback이 끝난 상태에서 호출한다. 앱은 먼저
`files.current().stop()`으로 루프를 정지한다. 복원된 루프도 정지 상태다. 성공 뒤 `current()`를 다시 읽어
사용하고, 필요하면 시작한다. 이전 Engine이나 그 Engine의 accessor/checkpoint를 새 Engine에 넘기지 않는다.

Ready는 세션·source epoch·자원 fence에 묶인다. 다른 세션의 token, 재사용한 token, 준비 후 source가 변한
token은 거절된다. 실패한 준비/교체는 기존 세션을 유지한다. 초기 Engine/platform은 차용하며, 소유권을
이전하려면 `initialCleanup`을 제공한다. 이 정리는 교체 성공 뒤에만 실행한다. 정리 오류는 성공한 교체를
취소하지 않고 `cleanupErrors`에 남긴다.

## Renderer·입력·에셋이 있는 앱

원래 Engine에 frame/input/viewport/lifecycle/effect callback이 있으면 `preparePlatform(context)`가
파일에서 요구한 role마다 명시적인 adapter를 제공해야 한다. `context.requiredRoles`를 확인한다.
Source callback을 SDK가 자동으로 새 renderer에 이식하지 않는다. 기존 renderer를 닫아 둔 closure를
재사용하지 말고 새 platform scope를 만드는 방식으로 연결한다. 같은 stateless 함수를 명시 제공하는 것은 가능하다.

```ts
const files = await createNativeGameFileSession(initialEngine, {
  async preparePlatform(context) {
    const target = await createTargetPlatform(); // 앱이 소유하는 새 canvas/renderer/host/input
    return {
      assetHost: target.host,
      callbacks: {
        "frame.onFrame": frame => target.render(frame),
        "frame.inputProvider": () => target.input.snapshot(),
        "frame.viewportProvider": () => target.renderer.viewportSize(),
      },
      validate() {
        // 자원 adopt 뒤, 세션 교체 전이다. 실패하면 새 대상만 폐기된다.
        target.acceptGameData(target.host.getJsonAsset("game"));
      },
      dispose() { target.destroy(); },
    };
  },
  initialCleanup() { initialScope.destroy(); },
});
```

위 예의 `createTargetPlatform`/`acceptGameData`는 앱의 renderer 구성과 데이터 검증 함수다.
실제 필요한 callback role만 반환한다. Render-only callback의 `NativeGameFileRenderFrame`은 기존
`RenderCommandBufferView` 전체 데이터 계약을 사용하고 native Engine/bridge를 노출하지 않는다.

- `configure(engine, budget)`는 자원 준비 전 외부 font/host binding을 등록하는 단계다.
- `validate(engine, budget)`는 자원 adopt 후, 실제 복원된 앱 자료를 읽고 검사하는 동기 단계다.
- 두 단계에서 저장된 게임에 `loadAssets`·spec 재적용·reset·루프 시작을 수행하지 않는다.
- `assertCurrent()`는 준비한 platform의 외부 변경을 검사한다.
- `dispose()`는 새 host/renderer/input/observer를 정리한다. 새 Engine은 세션이 정리한다.

성공 후 앱은 canvas·입력·renderer·accessor 등의 참조도 같은 새 scope를 사용해야 한다.
기존 `FerrumRuntime.engine` 속성만 바꾸면 이미 만들어진 callback과 콘텐츠 객체는 전환되지 않는다.
연결 예는 Top-down Shooter의 `?nativeFiles=true` 모드에서 제공한다.

## 외부 바인딩

`registerQuest(symbol, QuestLog)`와 `registerDialogue(symbol, DialogueSession)`으로 파일에 포함할 공개
콘텐츠 객체를 등록한다. 실제 native 공유 관계와 같은 값의 별개 owner를 구분해 보존한다.
`bindTextureResolver`/`bindEntityExists`는 opaque 함수의 실제 identity와 신뢰된 adapter를 명시 등록한다.
파일은 symbol/type/version만 저장하며 callback을 실행하거나 함수 내용을 직렬화하지 않는다.
SDK의 canonical texture/entity resolver는 실제 owner identity로 구분한다.
외부 adapter는 `files.current()`처럼 게시된 scope를 기준으로 동작하게 구성한다. 준비 중인 대상 변수를 바꾸는
것만으로 기존 scope의 callback이 새 대상으로 따라가게 만들면 실패 복구 계약을 앱이 깨뜨릴 수 있다.

`bindFontFace`/`bindFontSet`은 직접 등록한 외부 font에 사용한다. `configure`에 전달된 새 Engine을 마지막
인수로 주어 새 대상의 실제 font owner에 등록할 수 있다. 일반 callback registry와 font 자원 registry는 분리한다.
Font adapter는 필요한 필드를 own data property로 가진 `Object.freeze`한 객체로 등록한다.
외부 closure·OS font·custom host의 내부 상태는 신뢰된 adapter의 계약을 따른다.

## 한도와 오류

| 한도 | 기본값 |
| --- | --- |
| 전체 파일 | 64 MiB |
| Native Engine 구역 | 64 MiB |
| 작성 metadata 구역 | 16 MiB |
| 변수·자원 manifest·host 구역 | 각각 4 MiB |
| 자원 data 구역 | 64 MiB |
| 대화/퀘스트 구역 | 8 MiB |
| 대상 Wasm linear memory | 8,192 pages, 512 MiB |
| SDK 자원 수 | 4,096 |

전체 파일 한도가 구역별 한도보다 우선한다. `nativeLimits`와 `resourceLimits`의 이름 있는 한도는 기본값을
낮출 때 사용한다. 원시 word buffer나 candidate 설치 API를 공개하지 않는다. Blob은 크기와 같은 누적 budget을
검사한 뒤 읽으며, Wasm 생성의 중복 복사도 생성 budget에 누적한다.
SDK budget은 논리 작업·복사·GPU 요청량이고, Wasm memory 한도도 JS/GPU/driver/process RSS 한도가 아니다.

공개 오류는 `NativeGameFileError`이며 `phase`, `code`, 원래 `cause`를 제공한다. 오류 code는
`LIMITS`, `LIMIT`, `DATA`, `STALE`, `BUSY`, `CAPABILITY`, `ALLOCATION`, `GPU`, `IO`, `NATIVE`다.
지원하지 않는 외부 resource/backend를 조용히 빼거나 초기화해 복원하지 않는다.
