# Data Scene 코드 레시피

공개 API(`@ferrum2d/ferrum-web/core`, `/authoring`)만으로 Data Scene을 구성하는 코드 예시 모음이다.
메뉴에 나오는 실행 앱은 아니며, 엔진 문서가 사용 예시로 링크하고 브라우저 검사가 같은 코드를 실행한다.
게임에 필요할 때만 복사해 쓴다. 초기 설치나 업그레이드만 요청받은 경우에는 프로젝트에 넣지 않는다.

| 파일 | 진입 함수 | 보여 주는 것 | 안내 문서 |
| --- | --- | --- | --- |
| `main.mjs` | `startNativeScene(canvas)` | 불투명 배경·나무·발 기준 actor, 점광원·타일 차폐 그림자, bitmap label | [Data Scene Native 런타임](../../docs/engine/data-scene-native-runtime.md) |
| `presentation.mjs` | `startPresentationScene(canvas, { colorManagement, groundYScale, backend })` | 공유 atlas의 두 actor, 지면·나무, label·particle, 태양·점광원과 debug, WebGL2/WebGPU | [화면 표현](../../docs/engine/data-scene-presentation.md) |
| `spatial.mjs` | `startSpatialScene(canvas, { audio, movingPlatforms })` | HD-2D 높이 지형과 깊이 테스트 sprite, Rust 입력 이동, bitmap label·DOM HUD, 공간 오디오(`audio: true`) | [HD-2D 공간](../../docs/engine/data-scene-spatial.md), [Core API](../../docs/engine/public-api/core.md) |
| `moving-platforms.mjs` | `startMovingPlatformScene(canvas)` | `spatial.mjs` 위의 승강 바닥·이동 다리 탑승과 `save()`/`restore()` 위치 복원 | [HD-2D 공간](../../docs/engine/data-scene-spatial.md) |
| `spatial-audio.json` | — | `spatial.mjs`의 청취자·음원 배치 | — |
| `assets/` | — | 레시피와 검사가 쓰는 glTF 모델(`tree`, `building`, `rock`)·오디오 | — |

`assets/`의 glTF는 `tests/smoke/generate-spatial-*-fixture.mjs`로 만든 검증용 자체 제작 모델이다.
문서와 검사가 이 경로를 직접 참조하므로 파일 이름과 위치를 바꾸지 않는다.

## 검사

- `tests/smoke/data-scene-browser-smoke.mjs`: `main.mjs`
- `tests/smoke/data-scene-presentation-browser-smoke.mjs`: `presentation.mjs`
- `tests/smoke/spatial-scene-browser-smoke.mjs`, `spatial-audio-browser-smoke.mjs`: `spatial.mjs`
- 배치·Studio 검사(`placement-*`, `native-authoring-studio-smoke.mjs` 등)는 `assets/`의 모델을 쓴다.
