# Ferrum2D Smoke Check

이 문서는 릴리스 후보나 큰 변경 후 실행할 smoke check 기준을 고정한다. 자동 검증은 빠른 회귀 확인을 담당하고, WebGL2 실제 렌더링/입력/오디오는 브라우저 수동 확인으로 보완한다.

## 로컬 자동 sanity check

권장 명령:

```bash
pnpm smoke:check
```

이 명령은 다음 순서로 실행한다.

1. `pnpm lint`
2. `pnpm test`
3. `pnpm validate:game-spec`
4. `pnpm validate:physics-authoring`
5. `pnpm smoke:physics`
6. `pnpm smoke:headless`
7. `pnpm build`

`pnpm smoke:check`는 WebGL2 실제 화면, 키보드/마우스 입력, 브라우저 오디오 unlock 상태를 확인하지 않는다. 이 항목은 아래 browser render smoke check와 수동 smoke check에서 확인한다.

WebGL2 실제 화면의 black-frame 회귀만 자동 확인하려면 별도 browser smoke check를 실행한다.

```bash
pnpm smoke:browser
```

Minimal Game의 실제 browser runtime에서 profiler frame/render/asset budget 회귀까지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:browser-budget
pnpm smoke:runtime-budgets
pnpm smoke:topdown-budget
pnpm smoke:breakout-budget
pnpm smoke:platformer-budget
pnpm smoke:physics-sandbox-budget
```

Minimal Game의 loading overlay, asset preload progress, IndexedDB JSON/texture body cache 회귀를 확인하려면 다음을 실행한다. Top-down Shooter의 실제 asset manifest preload/cache 적용은 `pnpm smoke:topdown` production build 경로에서 함께 검증한다.

```bash
pnpm smoke:preload
```

WebGL2 lighting pass가 ambient overlay, point light, tile occluder debug draw, shadow projection을 실제 canvas에 반영하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:lighting
```

WebGPU lighting pass가 같은 lighting/shadow stats를 보고하는지 확인하려면 다음을 실행한다. WebGPU를 사용할 수 없거나 renderer가 WebGL2로 fallback한 환경에서는 capability-aware skip 결과를 낸다.

```bash
pnpm smoke:lighting-webgpu
```

Sprite material preset의 outline/additive fallback pass가 WebGL2/WebGPU renderer에서 동작하는지 확인하려면 다음을 실행한다. WebGPU를 사용할 수 없거나 renderer가 WebGL2로 fallback한 환경에서는 WebGPU smoke가 skip 결과를 낸다.

```bash
pnpm smoke:material
pnpm smoke:material-webgpu
```

Particle/VFX preset의 trail emitter가 runtime particle burst와 render command로 이어지는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:particle-vfx
```

Animation timeline의 frame event와 signal/atEnd transition helper가 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:animation-timeline
```

Scene composition의 prefab variant/override 검증과 reusable fragment apply path가 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:scene-composition
```

Behavior recipe schema가 common gameplay command를 만들고 runtime adapter target으로 전달하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:behavior-recipes
```

HUD toolkit의 theme token과 meter/counter/prompt component preset이 public overlay state로 변환되는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:hud-toolkit
```

Audio System v2의 BGM loop/fade와 master/bgm/sfx/ui bus 상태가 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:audio-system
```

Camera/post-processing pack의 camera bounds/dead-zone helper와 fullscreen post-processing pass가 public package/browser runtime에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:camera-postprocess
```

Cutscene/sequence helper의 wait/camera/audio/dialogue command 진행과 adapter hook이 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:cutscene-sequence
```

Localization/text helper의 string table fallback, text wrapping, font loading policy가 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:localization
```

Dialogue/quest helper의 graph 진행, UI overlay hook, save-state snapshot restore가 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:dialogue-quest
```

Generic Physics Scene Integration의 scene profile apply와 runtime auto-step option 연결이 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:physics-scene
```

Texture Atlas Packing의 deterministic atlas JSON CLI와 public conversion helper가 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:texture-atlas
```

Level Streaming/Chunking의 chunk manifest, viewport 기반 load/unload plan, asset lifetime policy가 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:level-streaming
```

In-game Debug Gizmos의 path/spawn/prefab/collider category가 physics debug line buffer로 변환되는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:debug-gizmos
```

Accessibility Options의 reduced motion adapter, subtitle panel, contrast palette hook이 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:accessibility-options
```

Browser smoke screenshot artifact와 screenshot summary threshold 비교 경로를 확인하려면 다음을 실행한다.

```bash
pnpm smoke:screenshot-capture
```

Marketplace-ready template set의 `minimal`, `topdown`, `platformer` create-game template 생성/검증 경로를 확인하려면 다음을 실행한다.

```bash
pnpm smoke:template-set
```

DOM virtual joystick/button preset이 runtime input으로 합성되는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:mobile-input
```

## Physics smoke check

Rust 물리엔진의 대표 solver/CCD/query 회귀를 빠르게 확인하려면 다음을 실행한다.

```bash
pnpm smoke:physics
pnpm smoke:physics-replay
pnpm smoke:destructible-terrain
pnpm smoke:destructible-terrain-browser
```

Tilemap authoring helper의 autotile/animated tile bake와 Tiled/LDtk import fixture 연동 회귀를 확인하려면 다음을 실행한다.

```bash
pnpm smoke:tilemap-authoring
```

이 명령은 `scripts/physics-smoke.mjs`가 canonical Rust test fixture를 scenario 단위로 실행하고, 각 scenario와 전체 suite의 seed/frame/suite hash를 출력한다. 이 hash는 실행한 scenario manifest와 통과 결과를 식별하는 smoke summary 값이다.
`pnpm smoke:physics-replay`는 같은 physics smoke suite를 2회 실행해 suite hash가 안정적으로 일치하는지 확인하고, Web public replay helper가 생성한 snapshot state hash(`stateReplayHash`)도 함께 비교한다. 실패 시 run, seed, frame, suite hash, scenario별 hash 차이를 출력한다.
`stateReplayHash`는 Web replay helper의 snapshot/restore/hash 계약을 Node deterministic harness에서 확인하는 값이며, Wasm physics state 전체를 직렬화한 hash는 아니다.
`pnpm smoke:destructible-terrain`은 tilemap rect edit가 collision query와 render command를 같은 tile occupancy source에서 갱신하고 collision obstacle cache를 dirty chunk 단위로 재빌드하는지 확인하며 seed/frame/suite hash를 출력한다. `pnpm smoke:destructible-terrain-browser`는 Top-down Shooter production build에서 deterministic tile 제거를 실행해 browser query와 render command count가 함께 변하는지 확인한다.
Web public API의 `PhysicsReplayInputStream`은 frame/seed/fixed step/body event와 interval snapshot을 기록해 tooling 단위 rollback 검증에 사용한다.

현재 scenario:

- `physics:stacked-boxes`: stack 안정성, sleep/island stats, block solver
- `physics:joint-chain`: rope/spring/revolute/prismatic/weld joint constraint
- `physics:fast-projectile-ccd`: fast dynamic body CCD matrix
- `physics:tile-edge-snagging`: edge collider pair/contact/cast 회귀
- `physics:moving-platform-character`: moving platform carry와 platformer controller
- `physics:query-cast-matrix`: overlap/raycast/shape-cast matrix
- `physics:hd2d-navigation-combat`: bridge portal multi-floor navigation, projectile arc height span, projectile/tile height filter, render sort

Compound collider runtime apply는 Rust collision/solver unit test, Web physics authoring unit test, `compound-collider` sandbox fixture로 보장한다.
Destructible terrain prototype은 Rust tilemap/engine unit test와 `destructible-terrain:tile-rect-edit` smoke scenario로 보장한다.

개별 scenario 목록은 다음으로 확인한다.

```bash
node scripts/physics-smoke.mjs --list
```

Top-down Shooter의 particle burst와 non-lethal enemy tint flash가 production build의 browser render path에서 감지되는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:topdown
pnpm smoke:topdown-save-load
pnpm smoke:topdown-hd2d
```

Breakout 예제의 두 번째 장르 runtime/render path를 확인하려면 다음을 실행한다. Brick hit particle burst까지 자동 관측하려면 effect smoke를 실행한다.

```bash
pnpm smoke:breakout
pnpm smoke:breakout-effects
```

Platformer 예제의 controller/runtime/render path를 확인하려면 다음을 실행한다. Landing dust까지 자동 관측하려면 effect smoke를 실행한다.

```bash
pnpm smoke:platformer
pnpm smoke:platformer-effects
```

Physics Spec 기반 generic rigid body sandbox와 demo fixture suite를 브라우저에서 확인하려면 다음을 실행한다.

```bash
pnpm smoke:physics-sandbox
pnpm smoke:physics-demo-suite
```

## Headless smoke check

브라우저를 열지 않고 Top-down Shooter 설정과 platform 적용 경로만 확인하려면 다음을 실행한다.

```bash
pnpm smoke:headless
```

이 명령은 Wasm 패키지와 `@ferrum2d/ferrum-web`을 빌드한 뒤 `scripts/headless-smoke.mjs`를 실행한다. 검증 범위는 다음과 같다.

- 예제 `game.json`이 `resolveShooterGameSpec(...)`를 통과한다.
- `applyShooterGameSpec(...)`가 resolved config, orbit tuning, camera, audio policy, tilemap, wave, atlas frame을 fake engine target에 빠짐없이 전달한다.
- `collision: true` layer에 navigation obstacle로 쓸 양수 tile과 walkable `0` tile이 함께 존재한다.
- tilemap 기반 representative render command buffer가 비어 있지 않고 `decodeRenderCommands(...)`, `rendererStatsForCommands(...)` 계약을 통과한다.
- Rust/Wasm runtime을 headless로 로드해 particle preset 등록, shooter hit preset binding, burst spawn, particle count 증가/만료, render command append를 확인한다.

이 검증은 WebGL2 draw를 실행하지 않는다. 실제 화면은 browser render smoke check와 수동 smoke check로 보완한다.

## Browser render smoke check

`pnpm smoke:browser`는 `examples/minimal-game` production build를, `pnpm smoke:topdown`/`pnpm smoke:topdown-hd2d`는 `examples/topdown-shooter` production build를, `pnpm smoke:breakout`/`pnpm smoke:breakout-effects`는 `examples/breakout` production build를, `pnpm smoke:platformer`/`pnpm smoke:platformer-effects`는 `examples/platformer` production build를, `pnpm smoke:physics-sandbox`/`pnpm smoke:physics-demo-suite`는 `examples/physics-sandbox` production build를 정적 서버로 띄운 뒤 Playwright Core로 설치된 Chrome/Chromium을 실행한다. 검증 범위는 다음과 같다.

- `createFerrumRuntime(...)` 또는 예제 bootstrap이 browser runtime을 초기화한다.
- WebGL2 canvas가 생성되고 Rust/Wasm render command를 소비한다.
- canvas pixel readback에서 placeholder texture의 녹색 픽셀이 일정 수 이상 검출된다.
- `pnpm smoke:runtime-budgets`는 `scripts/runtime-budget-profiles.mjs`의 per-example profile과 browser smoke mode mapping을 CI-safe 방식으로 검증한다.
- `pnpm smoke:browser-budget`은 Minimal Game에서 `RuntimeProfiler`를 켜고 frame time, Rust update, render time, draw call, render command, texture switch, physics count, asset load elapsed budget을 구조화된 report로 검증한다.
- `pnpm smoke:topdown-budget`, `pnpm smoke:breakout-budget`, `pnpm smoke:platformer-budget`, `pnpm smoke:physics-sandbox-budget`은 같은 browser budget harness를 각 예제 profile로 실행한다. 직접 `node scripts/browser-render-smoke.mjs --budget --budget-profile=<profile>`을 사용할 수도 있다.
- `pnpm smoke:preload`는 Minimal Game에서 `LoadingOverlay`를 켜고 data URL manifest를 두 번 preload해 첫 실행 fetch와 두 번째 IndexedDB JSON/texture body cache hit를 검증한다.
- `pnpm smoke:mobile-input`은 Minimal Game에서 `VirtualControls` DOM preset을 켜고 joystick/button state가 `W/D/Space/mouseLeft` input으로 합성되고 release되는지 확인한다.
- `pnpm smoke:topdown`은 Top-down Shooter production build에서 실제 asset manifest preload/cache/loading overlay를 거친 뒤 smoke 전용 URL parameter로 deterministic enemy hit를 만들고, particle count와 enemy tint flash render command가 관측되는지 확인한다.
- `pnpm smoke:topdown-save-load`는 Top-down Shooter production build에서 enemy/bullet이 포함된 built-in shooter snapshot을 캡처하고, `resetGame()` 이후 restore 및 재캡처 hash 일치를 확인한다.
- `pnpm smoke:topdown-hd2d`는 Top-down Shooter production build에 smoke 전용 HD-2D spec을 적용해 `weapons.projectileArc`, bridge `toHeightSpan` path, under-pass same-floor path, render command 생성을 확인한다.
- `pnpm smoke:breakout-effects`는 `resetGame()` 이후 자연 ball/brick hit에서 scene-internal particle burst와 render command 증가가 관측되는지 확인한다.
- `pnpm smoke:platformer-effects`는 `resetGame()` 이후 player landing transition에서 scene-internal dust burst와 render command 증가가 관측되는지 확인한다.
- `pnpm smoke:physics-sandbox`는 Physics Spec fixture가 body/joint를 생성하고 physics debug line을 렌더링하는지 확인한다.
- `pnpm smoke:physics-demo-suite`는 sandbox, joint playground, weld joint, projectile CCD, platformer physics, compound collider fixture를 순서대로 로드해 debug line, CCD metric, summary를 확인한다. Rust unit test는 CCD hit marker line을 직접 검증한다.
- `pnpm smoke:destructible-terrain-browser`는 Top-down Shooter의 collision tile 하나를 제거하고 같은 frame 경로에서 query hit 제거와 render command 감소를 확인한다.
- `pnpm smoke:lighting`은 Minimal Game에서 lighting smoke URL을 켜고 renderer stats의 lighting draw/point light/tile occluder/shadow count와 canvas warm pixel을 확인한다.
- `pnpm smoke:lighting-webgpu`는 Minimal Game에서 `renderer=webgpu`와 lighting smoke URL을 켜고 WebGPU renderer stats의 lighting draw/point light/tile occluder/shadow count를 확인한다. WebGPU 미지원 또는 fallback 환경은 실패 대신 skip으로 보고한다.
- `pnpm smoke:material`은 Minimal Game에서 outline sprite material preset을 켜고 WebGL2 canvas pixel과 renderer draw call이 material pass 수만큼 증가하는지 확인한다.
- `pnpm smoke:material-webgpu`는 Minimal Game에서 `renderer=webgpu`와 outline sprite material preset을 켜고 WebGPU renderer stats의 material pass draw call을 확인한다. WebGPU 미지원 또는 fallback 환경은 실패 대신 skip으로 보고한다.
- `pnpm smoke:particle-vfx`는 Minimal Game에서 `ParticleVfxEmitter`의 trail preset을 켜고 particle burst count, live particle count, render command 증가를 확인한다.
- `pnpm smoke:animation-timeline`은 public package build에서 `AnimationTimelinePlayer`의 frame event, signal transition, atEnd transition을 확인한다.
- `pnpm smoke:scene-composition`은 public package build에서 prefab variant props, fragment include transform, idPrefix, target apply 결과를 확인한다.
- `pnpm smoke:behavior-recipes`는 public package build에서 health/damage/pickup/chase recipe가 runtime adapter command로 변환되는지 확인한다.
- `pnpm smoke:hud-toolkit`은 public package build에서 HUD theme token과 meter/counter/prompt overlay state preset을 확인한다.
- `pnpm smoke:audio-system`은 public package build에서 `AudioManager` BGM loop/fade와 master/bgm/sfx/ui bus state를 확인한다.
- `pnpm smoke:camera-postprocess`는 Minimal Game browser runtime에서 renderer fullscreen post-processing pass stats와 camera/post-process public helper를 확인한다.
- `pnpm smoke:cutscene-sequence`는 public package build에서 `CutsceneSequencePlayer`가 wait/camera/audio/dialogue command event를 순서대로 방출하고 target adapter hook을 호출하는지 확인한다.
- `pnpm smoke:localization`은 public package build에서 `LocalizationBundle` fallback/interpolation, text wrapping, web/bitmap font loading policy를 확인한다.
- `pnpm smoke:dialogue-quest`는 public package build에서 `DialogueSession`, `QuestLog`, UI overlay hook, dialogue/quest snapshot restore를 확인한다.
- `pnpm smoke:physics-scene`은 public package build에서 `applyPhysicsSceneProfile(...)`의 runtime profile, auto rigid-body step option, clear 동작을 확인한다.
- `pnpm smoke:texture-atlas`는 public package build에서 atlas packer를 빌드하고, CLI가 입력 순서와 무관한 deterministic atlas JSON, frame UV, placement metadata를 생성하는지 확인한다.
- `pnpm smoke:level-streaming`은 public package build에서 chunk manifest bounds, viewport active/preload selection, load/unload candidate, chunk asset manifest 생성을 확인한다.
- `pnpm smoke:debug-gizmos`는 public package build에서 path/spawn/prefab/collider debug category가 metadata가 있는 line view와 physics debug line buffer로 변환되는지 확인한다.
- `pnpm smoke:accessibility-options`는 public package build에서 reduced motion camera/fade adapter, subtitle panel helper, high-contrast HUD theme hook, input assist metadata 정규화를 확인한다.
- `pnpm smoke:screenshot-capture`는 Minimal Game browser smoke에서 PNG와 `*.summary.json` artifact를 생성하고 screenshot summary threshold helper가 동작하는지 확인한다.
- `pnpm smoke:template-set`은 `@ferrum2d/create-game`의 `minimal`, `topdown`, `platformer` template catalog, 필수 파일, generated project public import, harness script 구성을 확인한다.
- `pnpm smoke:tilemap-authoring`은 `applyTileRules(...)`, `bakeAnimatedTileLayer(...)`, Tiled import 결과 authoring, LDtk entity/tile layer fixture를 함께 확인한다.
- browser console error와 page error가 발생하지 않는다.

새 browser smoke에서 frame/render/physics budget을 검사할 때는 `RuntimeProfiler`를 우선 사용한다. `FerrumRuntimeOptions.profiler`를 켜면 runtime이 `DebugOverlayMetrics`를 profiler에 기록하고, smoke script는 `--budget` 모드에서 profiler snapshot의 frame time, Rust update, render time, draw call, render command, texture switch, physics count, asset load elapsed budget 위반을 구조화된 결과로 확인한다.

기본 브라우저 채널은 `chrome`이다. 환경에 따라 다음 환경 변수를 사용할 수 있다.

```bash
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:browser
FERRUM_BROWSER_EXECUTABLE=/path/to/browser pnpm smoke:browser
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:browser-budget
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:topdown-budget
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:physics-sandbox-budget
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:preload
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:mobile-input
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:lighting
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:lighting-webgpu
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:material
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:material-webgpu
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:particle-vfx
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:topdown
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:topdown-save-load
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:topdown-hd2d
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:breakout-effects
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:platformer-effects
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:physics-demo-suite
```

이 검증은 Web Audio unlock, 키보드/마우스 조작감, 전체 Top-down Shooter 게임플레이를 대체하지 않는다. 해당 항목은 여전히 수동 smoke check에서 확인한다.

Rust 코드나 Rust/Wasm 경계를 바꾼 경우에는 `pnpm smoke:check`와 별도로 다음을 실행한다.

```bash
cargo fmt --manifest-path crates/ferrum-core/Cargo.toml --check
cargo clippy --manifest-path crates/ferrum-core/Cargo.toml -- -D warnings
```

## Package consumer smoke check

npm package 후보가 실제 사용자 프로젝트에서 설치되고 빌드되는지 확인하려면 다음을 실행한다.

```bash
pnpm package:consumer-smoke
```

이 명령은 세 package의 allowlist/pack 검증을 먼저 실행한 뒤 임시 consumer 환경에서 다음을 확인한다.

- `@ferrum2d/create-game` tarball의 bin으로 starter project를 생성한다.
- 생성 프로젝트가 `@ferrum2d/ferrum-web` tarball을 dependency로 설치한다.
- public entrypoint import가 성공하고 `@ferrum2d/ferrum-web/dist/*` 내부 import가 package exports로 차단된다.
- `@ferrum2d/agents` tarball의 bin이 생성 프로젝트에 대해 dry-run으로 파일을 쓰지 않는다.
- 생성 프로젝트의 `ferrum:validate`와 production build가 통과한다.

의존성 store가 준비된 CI 환경에서는 `pnpm package:consumer-smoke -- --offline`으로 registry resolution 없이 실행할 수 있다. 새 머신에서는 일반 실행으로 Vite/TypeScript 범위 의존성을 consumer install과 같은 방식으로 해석한다. 실패 재현용 파일을 보존하려면 `pnpm package:consumer-smoke -- --artifact-dir artifacts/consumer-smoke`를 사용한다.

## CI와 로컬 검증 차이

GitHub Actions CI는 main push/PR에서 headless 환경으로 실행된다. `ferrum-web-v*` tag push에서는 release metadata check와 package consumer smoke gate도 실행한다. 일반 PR에서 consumer smoke가 필요할 때는 CI workflow를 수동 실행하고 `consumer_smoke` input을 켠다.

현재 CI 기준:

1. `pnpm install`
2. `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
3. `pnpm smoke:physics`
4. `wasm-pack build crates/ferrum-core --target web --out-dir ../../packages/ferrum-web/pkg`
5. `pnpm lint`
6. `pnpm test`
7. `pnpm build`
8. tag 또는 수동 opt-in일 때 `pnpm package:consumer-smoke -- --offline --artifact-dir artifacts/consumer-smoke`

로컬 릴리스 후보 검증은 CI 명령에 더해 Game Spec 검증과 브라우저 수동 확인을 포함한다.

- `pnpm lint`로 TypeScript source/test type check를 확인한다.
- `pnpm test`로 TypeScript Node tests와 Rust tests를 모두 실행한다.
- `pnpm validate:game-spec`로 예제 `game.json`이 runtime validator와 같은 경로를 통과하는지 확인한다.
- `pnpm validate:physics-authoring`으로 `physicsEditor` 샘플이 runtime Physics Spec으로 compile되고 resolver를 통과하는지 확인한다.
- `pnpm smoke:physics`로 물리 solver/CCD/query 대표 scenario와 suite hash를 확인한다.
- `pnpm smoke:physics-replay`로 physics smoke suite hash와 Web replay helper state hash 재현성을 확인한다.
- `pnpm smoke:destructible-terrain`으로 tilemap rect edit의 query/render 동기화, dirty chunk collision cache, suite hash를 확인한다.
- `pnpm smoke:destructible-terrain-browser`로 Top-down Shooter browser path의 deterministic tile 제거 demo를 확인한다.
- `pnpm smoke:headless`로 Game Spec 적용 경로, collision/navigation 전제, representative render command buffer를 확인한다.
- `pnpm smoke:topdown`으로 Top-down Shooter production build에서 particle burst와 non-lethal enemy tint flash가 browser render path에 도달하는지 확인한다.
- `pnpm smoke:topdown-save-load`로 built-in shooter save/load snapshot restore가 browser production build에서 재현되는지 확인한다.
- `pnpm smoke:topdown-hd2d`로 bridge portal navigation, projectile arc, HD-2D render path가 Top-down Shooter browser production build에서 재현되는지 확인한다.
- `pnpm smoke:runtime-budgets`로 CI에서 runtime budget profile 계약을 확인하고, 예제별 성능 회귀가 의심되면 해당 `smoke:*-budget` browser smoke를 추가로 실행한다.
- `pnpm smoke:physics-demo-suite`로 Physics Spec apply/sandbox fixture browser path를 확인한다.
- `pnpm package:check`로 runtime package entrypoint, create-game scaffold, agents template, files allowlist, generated Wasm artifact, 실제 `pnpm pack` tarball 구성을 확인한다.
- `pnpm package:consumer-smoke`로 local tarball install, generated game build, agents dry-run을 임시 consumer project에서 확인한다.
- `pnpm release:check`로 changelog, beta version, release tag metadata 구조를 확인한다.
- `pnpm build`로 Wasm package와 Top-down Shooter production build를 확인한다.
- `pnpm build:pages`로 GitHub Pages demo/docs artifact 구성과 문서 HTML 생성을 확인한다.
- 브라우저 수동 smoke check로 WebGL2, 입력, 오디오, DebugOverlay 표시를 확인한다.

CI는 브라우저 실제 렌더링, 사용자 입력, Web Audio 재생, screenshot 갱신을 검증하지 않는다.

## Top-down Shooter 수동 smoke check

사전 조건:

- `pnpm install`이 완료되어 있어야 한다.
- `wasm-pack`과 Rust `wasm32-unknown-unknown` target이 설치되어 있어야 한다.
- WebGL2를 지원하는 브라우저에서 확인한다.

실행:

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/topdown-shooter dev
```

브라우저에서 Vite URL에 접속한 뒤 [Top-down Shooter 수동 체크리스트](topdown-shooter-smoke-checklist.md)를 따른다. 이 문서는 자동/CI/수동 검증의 관계만 유지하고, 실제 브라우저 확인 항목은 체크리스트 문서를 기준으로 한다.

## Screenshot 갱신

README preview용 스크린샷 절차는 [screenshots README](screenshots/README.md)를 따른다. smoke check에서 화면이 바뀐 것을 의도했다면 `docs/development/quality/screenshots/topdown-shooter-title.png` 갱신 여부를 함께 판단한다.

자동 browser smoke artifact가 필요하면 `browser-render-smoke.mjs`에 `--screenshot-artifact-dir <dir>`와 `--screenshot-name <name>`을 전달한다. baseline summary JSON과 비교하려면 `--screenshot-baseline <summary.json>`을 함께 전달하고, 허용 오차는 `--screenshot-max-average-delta`, `--screenshot-max-opaque-ratio-delta`, `--screenshot-max-non-transparent-ratio-delta`로 조정한다.

## 실패 기록 형식

검증 실패가 있으면 작업 결과에 다음을 남긴다.

- 실패 명령 또는 수동 확인 항목
- 실패 원인
- 사용자 영향
- 후속 조치 또는 보류 사유
