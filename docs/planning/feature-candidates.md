# Ferrum2D 차기 기능 후보 및 개발 방향 (Feature Candidates)

이 문서는 MVP 개발 완료 이후, 다른 주요 게임 엔진들과의 비교를 바탕으로 도출된 Ferrum2D의 차기 개선 기능 후보 리스트와 Codex 에이전트 등 AI 개발자가 수행할 수 있는 구체적인 개발 명세를 기록합니다.

---

## 1. 런타임 비주얼 퀄리티 향상 (WebGL2 포스트 프로세싱 파이프라인)

### 구현 상태
2026-05-27 기준 **구현 완료**.

* WebGL2 렌더러는 post-processing pass가 있을 때 scene FBO에 먼저 렌더링하고, fullscreen source-texture pass로 메인 캔버스에 합성합니다.
  * 구현: [webgl2Renderer.ts](file:///Users/qoo10/projects/ferrum2d/packages/ferrum-web/src/webgl2Renderer.ts), [webgl2FullscreenPass.ts](file:///Users/qoo10/projects/ferrum2d/packages/ferrum-web/src/webgl2FullscreenPass.ts)
* `fade`, `bloom`, `crt`, `vignette`, `glitch` pass resolver와 shader path를 제공합니다.
  * 구현: [cameraPostProcessing.ts](file:///Users/qoo10/projects/ferrum2d/packages/ferrum-web/src/cameraPostProcessing.ts)
* Shooter Game Spec의 `postProcessing` 필드와 JSON Schema가 추가되었고, `BrowserPlatformHost`를 통해 renderer `setPostProcess(...)`로 적용됩니다.
  * 구현: [gameSpec.ts](file:///Users/qoo10/projects/ferrum2d/packages/ferrum-web/src/gameSpec.ts), [browserPlatformHost.ts](file:///Users/qoo10/projects/ferrum2d/packages/ferrum-web/src/browserPlatformHost.ts), [shooter-game-spec.schema.json](file:///Users/qoo10/projects/ferrum2d/schemas/shooter-game-spec.schema.json)
* Rust render command ABI는 `effect_flags` 컬럼을 포함하도록 14-float로 확장되었습니다. 현재 기본 sprite/tile/particle command는 `SPRITE_EFFECT_NONE`을 기록합니다.
  * 구현: [render_command.rs](file:///Users/qoo10/projects/ferrum2d/crates/ferrum-core/src/render_command.rs), [wasmBridge.ts](file:///Users/qoo10/projects/ferrum2d/packages/ferrum-web/src/wasmBridge.ts)
* 검증: `pnpm smoke:camera-postprocess`에서 `postProcessDrawCalls=4`, `postProcessPassCount=4`를 확인했습니다.

### 📌 개발 목표
Rust Core는 물리/시뮬레이션과 렌더 커맨드 생성에만 집중하고, TypeScript WebGL2 렌더러가 화면을 메인 캔버스에 그리기 전 중간 버퍼(Framebuffer Object, FBO)를 거쳐 가며 특수 효과(Bloom, CRT, Vignette)를 입히는 파이프라인을 구축합니다.

### 🛠️ 구체적 개발 Task 및 대상 파일
1. **WebGL2 Framebuffer Object (FBO) 연동**
   * [webgl2Renderer.ts](file:///Users/qoo10/projects/ferrum2d/packages/ferrum-web/src/webgl2Renderer.ts)에 Offscreen Framebuffer 생성 및 바인딩 로직을 추가합니다.
   * 모든 스프라이트 드로우 콜을 FBO 텍스처에 먼저 그린 후, 최종 패스에서 전체 화면 쿼드(Fullscreen Quad)를 그려 메인 캔버스에 출력하도록 렌더 루프를 수정합니다.
2. **포스트 프로세싱 셰이더(Post-processing Shader) 작성**
   * **Bloom (블룸)**: 고휘도 영역 추출 -> 가우시안 블러(Gaussian Blur) 패스 -> 원본 이미지와 합성 단계를 거치는 셰이더를 개발합니다.
   * **CRT / Scanline**: 화면 왜곡(Lens Distortion) 효과 및 스캔라인 노이즈 셰이더를 작성합니다.
   * **Vignette (비네팅)**: 화면 가장자리를 어둡게 표현하는 그라데이션 계산식을 적용합니다.
3. **Game Spec 및 Wasm ABI 확장**
   * [gameSpec.ts](file:///Users/qoo10/projects/ferrum2d/packages/ferrum-web/src/gameSpec.ts) 및 [shooter-game-spec.schema.json](file:///Users/qoo10/projects/ferrum2d/schemas/shooter-game-spec.schema.json)에 `postProcessing` 스키마 설정을 추가합니다.
     * 예: `postProcessing: { bloom: { intensity: 1.5 }, vignette: { intensity: 0.5 } }`
   * Rust core에서 화면 페이드(Fade in/out), 글리치(Glitch) 효과를 렌더 버퍼를 통해 트리거할 수 있도록 ABI에 효과 플래그 컬럼을 추가합니다.

### 🧪 검증 방법
* [minimal-game](file:///Users/qoo10/projects/ferrum2d/examples/minimal-game) 예제 혹은 [topdown-shooter](file:///Users/qoo10/projects/ferrum2d/examples/topdown-shooter)의 `game.json`에서 옵션을 활성화했을 때, 화면에 블룸이나 비네팅 효과가 정상 적용되는지 브라우저에서 육안으로 검증합니다.

---

## 2. 에셋 압축/최적화 툴링 (자동 텍스처 아틀라스 패킹 스크립트)

### 구현 상태
2026-05-27 기준 **구현 완료**.

* `scripts/pack-textures.mjs`가 지정 폴더의 PNG를 재귀적으로 읽고 MaxRects 방식으로 배치해 `atlas.png`를 생성합니다. 외부 이미지 처리 의존성은 추가하지 않고 Node.js 표준 `zlib` 기반 8-bit PNG decode/encode를 사용합니다.
  * 구현: [pack-textures.mjs](file:///Users/qoo10/projects/ferrum2d/scripts/pack-textures.mjs)
* 생성된 atlas frame metadata를 `atlas.frames` 형식으로 만들고, `--game-json` 지정 시 기존 `game.json`의 `atlas.frames`와 병합합니다.
  * 검증: [pack-textures-smoke.mjs](file:///Users/qoo10/projects/ferrum2d/scripts/pack-textures-smoke.mjs)
* 루트 `build`/`dev:*`와 Top-down Shooter `build`/`dev` 전에 `pack:textures:if-present`가 선행 실행됩니다. config가 없으면 no-op입니다.
  * 구현: [package.json](file:///Users/qoo10/projects/ferrum2d/package.json), [examples/topdown-shooter/package.json](file:///Users/qoo10/projects/ferrum2d/examples/topdown-shooter/package.json)
* 기존 metadata-only packer도 MaxRects layout helper를 사용하도록 갱신되었습니다.
  * 구현: [textureAtlas.ts](file:///Users/qoo10/projects/ferrum2d/packages/ferrum-web/src/textureAtlas.ts)
* 검증: `pnpm smoke:texture-atlas`에서 JSON metadata packer와 PNG atlas packer smoke를 모두 확인했습니다.

### 📌 개발 목표
개발자가 개별 PNG 파일들을 두고 유연하게 작업하더라도, 빌드 타임에 자동으로 이를 하나로 병합(Packing)하고 이에 맞춰 `game.json`의 `atlas.frames` 좌표 정보를 자동 갱신해주는 Node.js 빌드 스크립트를 작성합니다.

### 🛠️ 구체적 개발 Task 및 대상 파일
1. **Node.js 기반 아틀라스 패커 스크립트 개발**
   * [scripts/](file:///Users/qoo10/projects/ferrum2d/scripts) 폴더 아래 `pack-textures.mjs` 스크립트를 작성합니다.
   * 지정된 폴더(예: `assets/sprites/*.png`)의 모든 이미지를 읽어 **MaxRects 알고리즘** 등을 사용해 조밀하게 배치한 단일 `atlas.png`를 생성합니다.
   * 이미지 파일 처리를 위해 `sharp` 등의 경량/고속 Node.js 모듈 활용을 검토합니다.
2. **Game Spec Atlas Metadata 자동 갱신**
   * 생성된 좌표 정보(UV 시작점 `u0, v0` 및 끝점 `u1, v1`, 픽셀 크기)를 계산하여 `game.json` 내 `atlas.frames` 객체 포맷에 맞추어 JSON 파일을 갱신 또는 생성합니다.
3. **로컬 개발 서버(Watcher) 및 빌드 파이프라인 통합**
   * [package.json](file:///Users/qoo10/projects/ferrum2d/package.json)의 `pnpm dev` 및 `pnpm build` 실행 전에 자동으로 해당 스크립트가 선행 동작하도록 스크립트 트리거 체인을 수정합니다.

### 🧪 검증 방법
* 새로운 PNG 이미지를 `sprites/` 디렉터리에 추가하고 빌드를 수행했을 때, 병합된 아틀라스 이미지와 `game.json` 내부의 `atlas.frames` 정보가 자동으로 추가/갱신되는지 확인하고, 게임 상에서 깨짐 없이 올바른 영역이 렌더링되는지 확인합니다.

---

## 3. 오디오 믹서 고도화 (BGM/SFX 다중 채널 및 페이드 컨트롤)

### 구현 상태
2026-05-27 기준 **구현 완료**.

* `AudioManager`는 `master`, `bgm`, `sfx`, `ui` gain bus를 구성하고, BGM fade API는 기존 seconds 옵션과 `fadeMs` alias를 함께 지원합니다.
  * 구현: [audioManager.ts](file:///Users/qoo10/projects/ferrum2d/packages/ferrum-web/src/audioManager.ts)
* Rust `AudioEvent` ABI는 `channel_id`를 포함한 4-float 구조이며, shooter 이벤트는 기본 SFX channel(1)로 기록됩니다.
  * 구현: [audio_event.rs](file:///Users/qoo10/projects/ferrum2d/crates/ferrum-core/src/audio_event.rs), [shooter_scene.rs](file:///Users/qoo10/projects/ferrum2d/crates/ferrum-core/src/shooter_scene.rs)
* TypeScript audio event decoder와 Wasm bridge가 `channelId`를 읽고, `AudioManager`가 `0=BGM`, `1=SFX`, `2=UI`로 라우팅합니다. legacy 3-float buffer는 SFX로 fallback합니다.
  * 구현: [audioEventDecoder.ts](file:///Users/qoo10/projects/ferrum2d/packages/ferrum-web/src/audioEventDecoder.ts), [wasmBridge.ts](file:///Users/qoo10/projects/ferrum2d/packages/ferrum-web/src/wasmBridge.ts)
* 검증: `pnpm smoke:audio-system`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml`, `pnpm --filter @ferrum2d/ferrum-web test`를 통과했습니다.

### 📌 개발 목표
단순한 단발성 오디오 재생 수준을 넘어, 배경음악(BGM)과 효과음(SFX), UI 효과음 등의 음량을 독립적으로 제어하고 자연스러운 화면/씬 전환을 위한 오디오 페이딩(Fade-in/out) 시스템을 구현합니다.

### 🛠️ 구체적 개발 Task 및 대상 파일
1. **Web Audio API 오디오 노드 그래프 구조화**
   * [audioManager.ts](file:///Users/qoo10/projects/ferrum2d/packages/ferrum-web/src/audioManager.ts) 내 오디오 구조를 `AudioContext -> Master Gain -> (BGM Gain, SFX Gain, UI Gain) -> BufferSource` 형태로 확장 설계합니다.
2. **BGM 크로스페이드 및 페이드 아웃 API 구현**
   * `playBgm(assetName, options: { fadeMs?: number })` 및 `stopBgm(options: { fadeMs?: number })` 함수를 구현합니다.
   * Web Audio API의 `gainNode.gain.linearRampToValueAtTime` 또는 `exponentialRampToValueAtTime`을 활용하여 부드러운 사운드 감쇠 및 증폭을 구현합니다.
3. **Rust Core 오디오 이벤트와 채널 매핑 연동**
   * Rust 오디오 ABI([audio_event.rs](file:///Users/qoo10/projects/ferrum2d/crates/ferrum-core/src/audio_event.rs))에 `channel_id` (0: BGM, 1: SFX, 2: UI) 필드를 추가합니다.
   * Rust Core에서 오디오 이벤트를 발생시킬 때 특정 채널 ID를 함께 지정하도록 개선하고, TypeScript `AudioManager`가 이를 수신하여 해당 Gain 노드에서 개별 연산되도록 연동합니다.

### 🧪 검증 방법
* 씬이 전환될 때 배경음악이 자연스럽게 페이드아웃/페이드인되는지 확인합니다.
* `game.json`에서 전체 볼륨을 조정하거나 BGM 볼륨만 0으로 설정했을 때, SFX는 정상 재생되고 BGM만 음소거되는지 채널 격리 음량 테스트를 수행합니다.
