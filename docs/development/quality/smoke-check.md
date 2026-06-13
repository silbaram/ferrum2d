# Ferrum2D Smoke Check

이 문서는 릴리스 후보나 큰 변경 후 실행할 smoke check 기준을 고정한다. 자동 검증은 빠른 회귀 확인을 담당하고, WebGL2 실제 렌더링/입력/오디오는 browser smoke와 수동 확인으로 보완한다.

## 제품 Runtime Budget Readiness

제품 runtime budget 기준은 "빠른 CI gate", "tag/manual opt-in gate", "수동 브라우저 확인"을 분리한다. 성능 회귀는 감각적인 설명보다 아래 matrix의 report, hash, budget artifact로 논의한다.

| 제품 기준 | 명령 | gate 위치 | evidence |
| --- | --- | --- | --- |
| Runtime budget profile 계약 | `pnpm smoke:runtime-budgets` | CI 기본 gate, `smoke:check` | `tests/smoke/runtime-budget-profiles.mjs`의 profile/mode mapping 검증 |
| Rust-side 대량 오브젝트 budget | `pnpm smoke:mass-objects` | CI 기본 gate, `smoke:check` | `ferrum2d.mass-object-stress.smoke-report` JSON과 scenario replay hash |
| Physics solver/query budget | `pnpm smoke:physics`, `pnpm smoke:physics-replay` | CI 기본 gate는 `smoke:physics`, release 후보는 replay까지 실행 | scenario seed/frame/suite hash와 Web replay helper state hash |
| Starter Runtime WebGL2 기본 경로 | `pnpm smoke:starter-runtime`, `pnpm smoke:browser-budget` | `smoke:check`, release 후보 수동/로컬 gate | Browser render smoke report와 `RuntimeProfiler` budget report |
| Top-down Shooter browser budget | `pnpm smoke:topdown-mass-objects`, `pnpm smoke:topdown-tilemap-budget`, `pnpm smoke:topdown-budget` | mass/tilemap은 CI 기본 gate, full topdown budget은 tag/manual opt-in | Playing state, entity/render command 규모, draw/texture/collision budget |
| Breakout/Platformer browser budget | `pnpm smoke:breakout-budget`, `pnpm smoke:platformer-budget` | tag/manual opt-in | 장르별 production build render/runtime budget artifact |
| Physics Sandbox browser budget | `pnpm smoke:physics-sandbox-budget` | tag/manual opt-in | Physics demo browser render path와 debug line/runtime budget artifact |
| Gameplay canonical replay | `pnpm smoke:gameplay-replay`, `pnpm smoke:gameplay-replay:report` | CI는 report, 로컬 quick check는 basic smoke | committed golden fixture hash, machine-actionable replay report |
| Package consumer smoke | `pnpm package:consumer-smoke -- --artifact-dir artifacts/consumer-smoke`, `pnpm validate:consumer-smoke-report -- --expect-status passed` | tag/manual opt-in | local tarball install, generated template build, consumer report artifact |
| Pages demo readiness | `pnpm build`, `pnpm build:pages`, `pnpm validate:pages-artifact` | Pages workflow, release candidate local check | Pages route/link validation과 ignored `dist-pages/` artifact |

browser budget smoke에서 `FERRUM_BROWSER_SMOKE_BUDGET_ARTIFACT_DIR=artifacts/browser-smoke-budgets`를 설정하면 `tests/smoke/browser-render-smoke.mjs`가 `ferrum2d.browser-smoke.runtime-budget-report` JSON artifact를 저장한다. artifact는 `mode`, `budgetProfile`, `distDir`, `url`, `runtimeBudget.budget`, `runtimeBudget.report`, `runtimeBudget.snapshot`을 포함해야 한다. `runtimeBudget.report.passed`가 `false`이면 command는 실패하고, missing metric은 `missingMetric` budget violation으로 다룬다.

WebGL2 기본 경로는 제품 renderer 기준이다. WebGPU optional smoke(`smoke:lighting-webgpu`, `smoke:material-webgpu`)는 capability-aware로 동작하며 WebGPU 미지원 또는 fallback 환경을 제품 실패로 보지 않는다. 단, WebGPU 기능이 사용 가능하다고 보고된 환경에서 해당 renderer stats가 누락되거나 WebGL2 기본 경로까지 깨지면 회귀로 본다.

`pnpm validate:runtime-budget-product`는 package script, runtime budget profile mapping, CI 기본 gate, tag/manual opt-in gate, Pages readiness 문서와 artifact report 경로가 빠지지 않았는지 확인한다.

## 로컬 자동 sanity check

권장 명령:

```bash
pnpm smoke:check
```

이 명령은 다음 순서로 실행한다.

1. `pnpm lint`
2. `pnpm test`
3. `pnpm validate:docs-links`
4. `pnpm validate:public-api-surface`
5. `pnpm release:candidate-check`
6. `pnpm validate:runtime-budget-product`
7. `pnpm validate:rust-test-harness`
8. `pnpm validate:game-spec`
9. `pnpm validate:physics-authoring`
10. `pnpm validate:data-scene-authoring`
11. `pnpm smoke:runtime-budgets`
12. `pnpm smoke:mass-objects`
13. `pnpm smoke:physics`
14. `pnpm smoke:topdown-authored-behavior-variant`
15. `pnpm smoke:level-streaming`
16. `pnpm smoke:level-streaming-browser`
17. `pnpm smoke:asset-pipeline`
18. `pnpm validate:gameplay-authoring:report`
19. `pnpm smoke:gameplay-replay:report`
20. `pnpm validate:gameplay-report-artifacts`
21. `pnpm smoke:create-game-template-catalog`
22. `pnpm smoke:create-game-template-reports`
23. `pnpm smoke:topdown-template-replay-report`
24. `pnpm smoke:topdown-authored-behavior-runtime`
25. `pnpm smoke:topdown-mass-objects`
26. `pnpm smoke:topdown-tilemap-budget`
27. `pnpm smoke:starter-runtime`
28. `pnpm smoke:content-runtime`
29. `pnpm smoke:headless`
30. `pnpm build`
31. `pnpm package:check`

`pnpm smoke:check`는 Starter Runtime, Minimal Game content runtime showcase, Top-down authored behavior runtime의 browser smoke까지 포함하지만, 모든 장르의 WebGL2 화면, 키보드/마우스 입력, 브라우저 오디오 unlock 상태를 전부 확인하지는 않는다. 나머지 항목은 아래 browser render smoke check와 수동 smoke check에서 확인한다.

`pnpm validate:docs-links`는 `docs/**/*.md`의 내부 Markdown 링크와 heading anchor를 확인한다. GitHub Pages 산출물까지 확인하는 문서 전용 작업에서는 `pnpm build:pages` 이후 `pnpm validate:pages-artifact`를 함께 실행한다.

`pnpm validate:game-spec`는 예제 `game.json`을 public package build의 `resolveShooterGameSpec(...)`로 정규화한다. 이 게이트는 shooter gameplay field뿐 아니라 `content.localization`, `content.dialogue.graphs`, `content.cutscenes` namespace도 검증해 agent가 작성한 narrative/content 데이터의 path diagnostic을 고정한다. Runtime option 자동 결선 정책은 ferrum-web test에서 `createShooterContentRuntimeOptions(...)`와 `resolveShooterContentRuntimeSelection(...)`로 검증한다.

`pnpm smoke:gameplay-replay`는 Top-down Shooter golden replay fixture를 비교하고, 각 scenario를 같은 Wasm build에서 두 번 실행해 deterministic hash가 안정적인지 확인한다. 출력의 `actionDiagnostics`와 `spawnDiagnostics`는 replay snapshot hash에 포함되지 않는 agent-facing summary다. Rust-owned action trigger frame telemetry와 decoded `actionFailed` event를 `path`/`expected`/`actual`/`suggestion` report로 변환하고, spawn flush telemetry를 same-frame spawn activity report로 변환하므로, 실패 action/spawn spec을 수정할 때 smoke pass/fail보다 구체적인 JSON path 신호를 제공한다.

agent가 이 summary를 파일로 소비해야 하면 다음 명령을 사용한다.

```bash
pnpm smoke:gameplay-replay:report
```

이 명령은 기본 smoke와 같은 검증을 수행한 뒤 `artifacts/gameplay-replay-smoke/gameplay-replay-smoke-report.json`에 versioned report를 저장한다. report root는 `format: "ferrum2d.gameplay-replay.smoke-report"`, `version`, `ok`, `gameplayReplaySmoke`, 실패 시 `errors`를 포함한다. golden mismatch처럼 command가 실패하는 경우에도 가능한 범위의 scenario summary, replay comparison, `actionDiagnostics`, `spawnDiagnostics`를 artifact로 남긴 뒤 non-zero로 종료한다. scenario가 positive spawn activity를 관측했지만 manifest에 해당 frame/metric expectation이 없으면 summary의 `spawnExpectationPatches`가 `FERRUM_GAMEPLAY_SPAWN_EXPECTATION_PATCH_CANDIDATE` report로 실행 중인 manifest의 `expected.spawnDiagnostics`에 추가할 object 후보를 제공한다. 이미 expectation으로 검증된 metric은 성공 run에서 patch 후보를 만들지 않는다. 기본 `pnpm smoke:gameplay-replay`는 artifact를 만들지 않는다.

agent가 gameplay authoring proposal을 apply 전에 검증해야 하면 다음 명령을 사용한다.

```bash
pnpm validate:gameplay-authoring:report
pnpm smoke:gameplay-replay:report
pnpm validate:gameplay-report-artifacts
```

`pnpm validate:gameplay-authoring:report`는 Top-down authored behavior variant의 Game Spec 참조, runtime id registry, `SceneComposition` + `BehaviorRecipe` binding dry-run, FSM install plan summary, state command preflight summary, replay manifest와 fixture index 연결을 public package build에서 검증하고 `artifacts/gameplay-authoring-dry-run/gameplay-authoring-dry-run-report.json`에 versioned report를 저장한다. fixture index의 `coverageTagDefinitions`가 replay manifest와 다르면 `gameplayAuthoring.replayManifest.fixtureIndex.coverageTagDefinitions` path를 가진 machine-actionable report로 실패한다. report root는 `format: "ferrum2d.gameplay-authoring.dry-run-report"`, `version`, `ok`, `gameplayAuthoringDryRun`, 실패 시 `diagnostics`/`reports`/`errors`를 포함한다. 생성된 report는 출력/저장 전에 `schemas/gameplay-authoring-dry-run-report.schema.json` 계약으로 self-validate한다. `gameplayAuthoringDryRun.stateCommandPreflight`는 machine/state별 target entity, command type, result count, `replaceSupported` clear operation을 mutation 없이 기록한다. `reports`는 `path`, `expected`, `actual`, `suggestion`을 포함해 agent가 JSON patch 후보를 만들 수 있는 신호를 제공한다. 이 명령은 Wasm build나 runtime apply를 수행하지 않으며, frame hot path callback도 추가하지 않는다.

`pnpm smoke:gameplay-replay:report`는 replay smoke report를 `artifacts/gameplay-replay-smoke/gameplay-replay-smoke-report.json`에 저장한다. `pnpm validate:gameplay-report-artifacts`는 이미 존재하는 authoring/replay report artifact가 각각 `schemas/gameplay-authoring-dry-run-report.schema.json`, `schemas/gameplay-replay-smoke-report.schema.json`을 만족하는지 확인하고, 성공 report인지, replay scenario가 비어 있지 않은지, 각 scenario가 `passed: true`인지도 검사한다. freshness가 필요한 경우 `pnpm smoke:check`처럼 `validate:gameplay-authoring:report`와 `smoke:gameplay-replay:report`를 먼저 실행한다.

WebGL2 실제 화면의 black-frame 회귀만 자동 확인하려면 별도 browser smoke check를 실행한다.

```bash
pnpm smoke:browser
```

Starter Runtime의 실제 browser runtime에서 profiler frame/render/asset budget 회귀까지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:browser-budget
pnpm smoke:runtime-budgets
pnpm smoke:mass-objects
pnpm smoke:topdown-mass-objects
pnpm smoke:topdown-tilemap-budget
pnpm smoke:topdown-budget
pnpm smoke:breakout-budget
pnpm smoke:platformer-budget
pnpm smoke:physics-sandbox-budget
```

`pnpm smoke:mass-objects`는 Rust core 내부 `Engine` 테스트를 통해 1,000개 visible enemy와 512개 projectile lane이 한 frame에서 Shooter update/render command 경로를 통과하고, sparse horde 배치에서 collision pair가 폭증하지 않는지 확인한다. 또한 128개 overlapping enemy의 collision lifecycle total/trigger pair budget을 고정해 dense 배치에서 broadphase pair 수가 의도치 않게 바뀌는 회귀를 잡는다. 출력은 `format: "ferrum2d.mass-object-stress.smoke-report"` report와 scenario별 `enemyCount`, `projectileCount`, `entityCount`, `renderCommandCount`, `collisionPairCount`, `collisionSolidPairCount`, `collisionTriggerPairCount`, `shooterBulletEnemy*`, `shooterBulletPlayer*`, `shooterPlayerEnemy*`, `updateMicros` metric을 포함한다. `shooter*ProxyCount` metric은 Shooter 전용 collision/swept pair builder가 실제 대량 레이어 proxy를 통과했는지 고정한다. 이 smoke는 browser GPU frame time을 대체하지 않고, 대량 오브젝트 최적화 전후의 Rust-side 구조 회귀를 빠르게 고정하기 위한 기준이다.

`pnpm smoke:topdown-mass-objects`는 Top-down Shooter production build를 browser에서 열고 smoke-only snapshot restore로 1,024개 enemy entity를 한 번에 복원한다. 이후 일반 frame loop가 Playing 상태에서 Rust render command buffer를 만들고 WebGL2 renderer가 이를 소비하는지 확인하며, `RuntimeProfiler` budget으로 render command count, draw call, texture switch, collision pair count, frame/render time 회귀를 함께 검증한다. 이 smoke는 public spawn API나 새 Wasm ABI를 추가하지 않고 `restoreShooterStateSnapshot()` setup 경로만 사용한다.

`pnpm smoke:topdown-tilemap-budget`은 Top-down Shooter production build를 browser에서 열고 smoke-only 64x32 tilemap Game Spec을 주입한다. 이후 Playing 상태에서 2,048개 이상의 tile render command가 WebGL2 renderer로 소비되는지 확인하고, `RuntimeProfiler` budget으로 draw call, texture switch, render command count, frame/render time 회귀를 함께 검증한다. 이 smoke는 resident dense tile layer의 현재 render cache/batching 성능을 고정하며, 무제한 월드 streaming 검증을 대체하지 않는다.

Minimal Game의 visual/input-ui 실험 표면은 별도 예제로 분리하지 않고 `Minimal Runtime Lab`으로 묶는다. `visual-runtime-lab`은 `smoke:lighting`, `smoke:lighting-webgpu`, `smoke:material`, `smoke:material-webgpu`, `smoke:camera-postprocess`, `smoke:particle-vfx`가 같은 `examples/minimal-game/dist`에 query flag를 켜서 확인한다. `input-ui-lab`은 `smoke:preload`, `smoke:mobile-input`, `smoke:content-runtime`이 LoadingOverlay, VirtualControls, UiOverlay/content runtime 연결을 확인한다. 이 lab profile은 smoke/manual QA용 명칭이며 public portfolio demo나 사용자-facing in-app profile switcher가 아니다.

Minimal Game smoke fixture의 loading overlay, asset preload progress, IndexedDB JSON/texture body cache 회귀를 확인하려면 다음을 실행한다. Top-down Shooter의 실제 asset manifest preload/cache 적용은 `pnpm smoke:topdown` production build 경로에서 함께 검증한다.

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

Cutscene/sequence helper의 wait/camera/audio/dialogue command 진행, target adapter hook, dialogue text localization helper 연결이 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:cutscene-sequence
```

Minimal Game production build에서 `createFerrumRuntime({ localization, cutscene, hud, accessibility, animationTimeline })` opt-in이 실제 browser runtime과 `UiOverlay` dialog/HUD/subtitle DOM, runtime timeline update report까지 연결되는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:content-runtime
```

Localization/text helper의 string table fallback, text wrapping, font loading policy가 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:localization
```

Dialogue/quest helper의 graph 진행, createFerrumRuntime opt-in export, UI overlay hook, save-state snapshot restore가 public package build에서 동작하는지 확인하려면 다음을 실행한다.

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

raw sprite folder에서 texture atlas와 Game Spec atlas metadata를 만들고, Aseprite import helper, localization bundle, audio asset decode 경로까지 함께 검증하려면 다음을 실행한다.

```bash
pnpm smoke:asset-pipeline
```

Level Streaming/Chunking의 chunk manifest, viewport 기반 load/unload plan, asset lifetime policy, runtime preload/load/unload adapter, target apply/unload/releaseAssets, renderer texture eviction 경로가 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:level-streaming
```

Level Streaming/Chunking이 실제 Chromium + WebGL2 renderer + `BrowserPlatformHost` asset release 경로에서 frame budget을 만족하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:level-streaming-browser
```

이 browser smoke는 built `@ferrum2d/ferrum-web` 모듈을 정적 서버로 열고, 두 chunk를 순차 활성화한 뒤 256개 sprite render command, draw call 2회, texture switch 1회, `RuntimeProfiler` budget pass, 공유 텍스처 retain, 이전 chunk 전용 텍스처 eviction, canvas pixel readback을 함께 검증한다.

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

Marketplace-ready template set의 `minimal`, `topdown`, `platformer`, `breakout` gameplay replay fixture와 template catalog/report scaffold를 확인하려면 다음을 실행한다.

```bash
pnpm smoke:create-game-template-catalog
pnpm smoke:create-game-template-reports
pnpm smoke:template-set
```

`pnpm smoke:create-game-template-catalog`는 `@ferrum2d/create-game --list-templates --json` 출력이 `packages/create-game/templates/manifest.json`과 일치하는지 확인한다. 또한 기존 human-readable `--list-templates` 출력이 JSON으로 바뀌지 않았는지, `--json`을 `--list-templates` 없이 사용하면 명확한 오류로 실패하는지, manifest가 잘못된 `sceneAuthoring` 계약을 포함하면 JSON catalog를 출력하기 전에 실패하는지도 검증한다. 이 smoke는 install, tarball pack, template copy, production build를 수행하지 않는다.
`pnpm smoke:create-game-template-reports`는 template별 `ferrum:*` report envelope를 검증한다. `minimal`/`topdown`/`platformer`/`breakout`은 asset report/validate scaffold와 authoring/replay/runtime replay fixture가 `configured`/`validated` 상태여야 한다.

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

이 명령은 `tests/smoke/physics-smoke.mjs`가 canonical Rust test fixture를 scenario 단위로 실행하고, 각 scenario와 전체 suite의 seed/frame/suite hash를 출력한다. 이 hash는 실행한 scenario manifest와 통과 결과를 식별하는 smoke summary 값이다.
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
node tests/smoke/physics-smoke.mjs --list
```

Top-down Shooter의 particle burst와 non-lethal enemy tint flash가 production build의 browser render path에서 감지되는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:topdown
pnpm smoke:topdown-save-load
pnpm validate:topdown-authored-behavior-variant
pnpm validate:gameplay-authoring:report
pnpm smoke:topdown-authored-behavior-variant
pnpm smoke:topdown-authored-behavior-runtime
pnpm smoke:gameplay-replay
pnpm smoke:topdown-hd2d
```

`pnpm validate:topdown-authored-behavior-variant`와 `pnpm smoke:topdown-authored-behavior-variant`는 `examples/topdown-shooter/public/authored-behavior.variant.json`을 읽어 기본 `game.json`이 여전히 `resolveShooterGameSpec(...)`를 통과하는지 확인하고, variant의 `ids` runtime token registry, `SceneComposition`, `BehaviorRecipe`, `BehaviorStateMachine`, `semantics.browserPlacement`, `replayScenario` 연결을 public package API로 검증한다. `pnpm validate:gameplay-authoring:report`는 같은 authoring 입력을 exact assertion smoke 대신 agent-facing report artifact로 요약하며, command count/type, instance binding, FSM transition summary, replay manifest/fixture index link, machine-actionable diagnostics를 제공한다. 이 report는 연결된 fixture index의 coverage tag vocabulary가 manifest와 같은지도 확인한다. 이 파일은 메인 Game Spec에 새 namespace를 넣지 않는 예제용 authoring artifact이며, agent가 prefab/behavior/FSM/replay 계약을 함께 patch할 수 있는 데이터 variant다. 편집기 보조용 구조 계약은 `schemas/topdown-authored-behavior-variant.schema.json`에 있다.

`pnpm smoke:topdown-authored-behavior-runtime`은 production Top-down Shooter build가 같은 variant JSON을 asset manifest로 preload/load하고, browser runtime에서 `window.ferrumTopdownAuthoredBehaviorVariant` summary로 노출하는지 확인한다. smoke URL은 `authoredBehaviorVariantApply=true`를 사용해 scene load 이후 낮은 빈도 경로에서 variant instance를 physics body로 spawn하거나 `runtimeEntity: "builtinShooterPlayer"`를 현재 built-in player handle에 매핑하고, variant `ids` registry를 통해 `FerrumEngine` gameplay authoring facade로 behavior commands와 FSM install plan을 Rust component storage에 적용한다. smoke는 `runtimeApply` summary의 instance count `8`, command count `15`, FSM initial/current state id, `applyId`, `semantics.browserPlacement`에서 온 placement anchor/target/scale, built-in player primary projectile action binding, dash action binding, spawnPrefab action binding(`summon-enemy`)을 검증한다. 또한 browser frame을 실제 Playing 상태로 진행해 score `15`, `interaction`/`collisionDamage`/`factionDamageDenied`/`pickupCollected`/`actionFailed`/`timer`/`prefabSpawned` event payload, one-shot interaction non-repeat, authored FSM state `2/2/1`을 `FrameState.gameplayEvents`와 typed engine query로 검증한다. 그 뒤 window-only helper `ferrumTopdownAuthoredBehaviorApplyCurrentStateCommands()`를 호출해 현재 FSM state command plan을 `replaceSupported` mode로 적용한다. smoke는 clear-only profile과 `test-projectile.spent`의 non-empty profile(`configureLifetime`)을 함께 검증한다. 이후 `ferrumTopdownAuthoredBehaviorResetAndReapply()`를 호출해 `resetGame()` 이후 stale handle을 버리고 variant를 다시 적용한다. 두 번째 run은 frame summary가 새 `applyId`를 갖는지, 이벤트 payload가 현재 `runtimeApply.handles`와 일치하는지, reset 직후 frame/state-command summary가 비워졌는지, state command apply가 두 번째 `applyId`에서도 동작하는지, one-shot interaction과 state change telemetry가 다시 중복 발행되지 않는지 확인한다. 이는 demo apply toggle이지 frame hot path callback이나 state-entry 자동 runtime이 아니다.

`pnpm smoke:gameplay-replay`는 `tests/fixtures/gameplay-golden/scenarios.json` manifest를 읽어 raw Wasm `Engine`을 fixed timestep으로 실행하고, 각 scenario의 `fixturePath`에 있는 golden fixture와 `GameStateSnapshot` replay hash를 비교한다. manifest는 scenario id, human-readable description, kebab-case `coverageTags`, coverage vocabulary path, runner, optional `variantPath`, frame count, capture frame, input event, expected replay hash와 score/event/FSM metadata, optional `expected.spawnDiagnostics` frame metric을 고정하는 scenario 계약이다. `fixtureIndexPath`가 가리키는 `tests/fixtures/gameplay-golden/fixture-index.json`은 agent가 빠르게 읽는 파생 catalog이며, source of truth는 manifest다. coverage vocabulary의 source of truth는 `tests/fixtures/gameplay-golden/coverage-tags.json`이고, active `coverageTagDefinitions`, 빠른 탐색용 `coverageTagGroups`, 폐기 tag 보존용 `deprecatedCoverageTags`를 포함한다. 이 vocabulary는 앞으로 만들 gameplay taxonomy가 아니라 현재 커밋된 golden scenario coverage tag contract다. 따라서 모든 active definition은 최소 하나의 scenario에서 사용되어야 하고, 모든 active tag는 최소 하나의 group에 포함되어야 하며, scenario는 deprecated tag를 사용할 수 없다. 아직 coverage가 없는 계획용 tag는 roadmap에만 둔다. smoke는 index의 coverage vocabulary path, scenario id, description, coverage tags, runner, fixture path, replay hash, frame count, capture frame count가 manifest와 일치하는지 먼저 검증한다. 모든 coverage tag는 active vocabulary에 정의되어야 하며, 현재 smoke는 `spawn-diagnostics`/`action-failure`/`variant` 같은 일부 tag가 관련 manifest field와 함께 쓰이는지도 확인한다. 장르별 setup과 exact payload assertion은 runner가 소유한다. `example-topdown-authored-behavior`는 `variantPath`가 가리키는 Top-down authored behavior variant를 함께 읽어 scene instance, physics body metadata, behavior recipe command, FSM expected state가 replay authoring event와 일치하는지 검증한다. 각 scenario는 같은 build에서 두 번 실행해 actual-vs-actual determinism을 먼저 확인한다. 기본 fixture는 deterministic enemy spawn, projectile travel, enemy damage, score reward를 포함한다. authored behavior fixture는 raw Wasm setter로 설치한 score pickup, interaction event, collisionDamage reaction, source-scoped FSM transition을 exact event payload와 custom JSON state까지 포함해 검증한다. `projectile-tile-impact-fsm-authored` fixture는 raw Wasm authoring setter로 bounce tileImpact policy를 가진 projectile body와 FSM을 설치하고, 같은 Rust frame의 `tileImpact`와 `behaviorStateChanged` event payload를 exact custom state로 검증한다. `projectile-homing-nearest-tag` fixture는 TS `SceneComposition`/`BehaviorRecipe` binding으로 `seekTarget(nearestTag:hostile)`, damage, collision particle, collision despawn, lifetime을 설치한 뒤 Rust projectile movement, tagged target collision, `collisionDamage -> collisionDespawn -> presentationEffect` event payload, score reward, untagged decoy 생존을 exact custom state로 검증한다. `projectile-area-damage-entity-impact` fixture는 같은 TS binding 경로로 `collisionAreaDamage`, `collisionEmitEffect`, `collisionDespawn`, `accelerate`, lifetime을 설치한 뒤 반경 내 direct/splash enemy 제거, 합산 score reward, 반경 밖 enemy 생존, `collisionDamage -> collisionDamage -> collisionDespawn -> presentationEffect` event payload를 exact custom state로 검증한다. `projectile-area-damage-tile-impact` fixture는 TS `SceneComposition`/`BehaviorRecipe` binding으로 `collisionAreaDamage`를 설치한 projectile이 blocking tile에 닿을 때 Rust swept tile contact point 중심으로 direct/splash enemy damage, score reward, terminal `tileImpact` telemetry, 반경 밖 enemy 생존을 검증한다. authored timer spawn, wave action spawn, state-enter spawn/projectile scenario는 `expected.spawnDiagnostics`로 deferred spawn queue drain, projectile spawn, prefab payload/event push count를 검증하며 mismatch는 `gameplayReplay.frames.<frame>.spawnDiagnostics.<metric>` path와 expected/actual/suggestion을 가진 report로 실패한다. expectation 없이 관측된 positive spawn activity는 `spawnExpectationPatches`로 실행 중인 manifest의 patch 후보를 제공한다. `--artifact-dir`로 저장되는 smoke report는 출력/저장 전에 `schemas/gameplay-replay-smoke-report.schema.json` 계약으로 self-validate한다. 비교 범위는 scene metric, built-in shooter snapshot, custom JSON state이며 render/audio/debug/profiler output과 action/spawn diagnostic summary는 golden fixture/hash에서 제외한다. 의도한 gameplay behavior 변경으로 baseline을 갱신해야 할 때는 변경 리뷰 후 다음 명령을 실행해 fixture와 fixture index를 재생성한다.

```bash
pnpm update:gameplay-replay-golden
```

baseline 갱신 PR/commit에는 replay hash 변경 이유와 기대 gameplay 변화가 함께 기록되어야 한다. 입력 stream, frame count, fixed delta, capture frame 목록이 바뀌면 fixture metadata 검증이 실패하므로 먼저 `scenarios.json`, fixture, 문서를 함께 갱신한다. `--update`는 manifest의 `fixtureIndexPath`가 있으면 index를 manifest에서 다시 생성하므로 index를 손으로 patch하지 않는다. 단일 scenario는 `pnpm update:gameplay-replay-golden -- --scenario=<scenario-id>`로 갱신할 수 있고, 실험 manifest는 `node tests/smoke/gameplay-replay-smoke.mjs --manifest <path>`로 실행할 수 있다. Manifest의 `fixturePath`와 `variantPath`는 기본적으로 repo root 기준이다. 실험 manifest가 자기 파일 위치 기준 경로를 쓰려면 `./fixture.json` 또는 `../fixtures/foo.json`처럼 명시적인 relative prefix를 사용한다.

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

`pnpm smoke:physics-sandbox`는 `examples/physics-sandbox/dist` production build를 `demo=sandbox&physicsDebugLines=true`로 열고 `window.ferrumPhysicsSandboxSmokeFrame`을 기다린다. pass 조건은 선택된 demo id가 유지되고, body가 2개 이상 적용되며, physics debug line이 1개 이상 렌더되고, frame이 2회 이상 진행되는 것이다.

`pnpm smoke:physics-demo-suite`는 같은 browser smoke harness에서 `window.ferrumPhysicsSandboxLoadDemo(id)`를 호출해 `sandbox`, `joint-playground`, `projectile-ccd`, `platformer-physics`, `compound-collider`, `weld-joint` fixture를 순회한다. 이 suite는 fixture catalog가 browser selector, Physics Spec apply, debug line render path에 모두 연결됐는지 확인한다. Solver determinism, scenario hash, CCD/query 세부 assertion은 `pnpm smoke:physics`와 `pnpm smoke:physics-replay`가 담당하므로 demo suite에 같은 책임을 중복 배치하지 않는다.

## Headless smoke check

브라우저를 열지 않고 Top-down Shooter 설정과 platform 적용 경로만 확인하려면 다음을 실행한다.

```bash
pnpm smoke:headless
```

이 명령은 Wasm 패키지와 `@ferrum2d/ferrum-web`을 빌드한 뒤 `tests/smoke/headless-smoke.mjs`를 실행한다. 검증 범위는 다음과 같다.

- 예제 `game.json`이 `resolveShooterGameSpec(...)`를 통과한다.
- `applyShooterGameSpec(...)`가 resolved config, orbit tuning, camera, audio policy, tilemap, wave, atlas frame을 fake engine target에 빠짐없이 전달한다.
- `collision: true` layer에 navigation obstacle로 쓸 양수 tile과 walkable `0` tile이 함께 존재한다.
- tilemap 기반 representative render command buffer가 비어 있지 않고 `decodeRenderCommands(...)`, `rendererStatsForCommands(...)` 계약을 통과한다.
- Rust/Wasm runtime을 headless로 로드해 particle preset 등록, shooter hit preset binding, burst spawn, particle count 증가/만료, render command append를 확인한다.

이 검증은 WebGL2 draw를 실행하지 않는다. 실제 화면은 browser render smoke check와 수동 smoke check로 보완한다.

## Browser render smoke check

`pnpm smoke:browser`는 `examples/starter-runtime` production build를, `pnpm smoke:topdown`/`pnpm smoke:topdown-mass-objects`/`pnpm smoke:topdown-hd2d`는 `examples/topdown-shooter` production build를, `pnpm smoke:breakout`/`pnpm smoke:breakout-effects`는 `examples/breakout` production build를, `pnpm smoke:platformer`/`pnpm smoke:platformer-effects`는 `examples/platformer` production build를, `pnpm smoke:physics-sandbox`/`pnpm smoke:physics-demo-suite`는 `examples/physics-sandbox` production build를 정적 서버로 띄운 뒤 Playwright Core로 설치된 Chrome/Chromium을 실행한다. 검증 범위는 다음과 같다.

- `createFerrumRuntime(...)` 또는 예제 bootstrap이 browser runtime을 초기화한다.
- WebGL2 canvas가 생성되고 Rust/Wasm render command를 소비한다.
- 기본 render 경로의 browser smoke는 canvas pixel readback에서 placeholder texture의 녹색 픽셀을 확인한다. mode-specific smoke는 아래 항목의 조건을 추가 또는 대체 pass 조건으로 사용한다.
- `pnpm smoke:browser`는 Starter Runtime의 weapon profile panel, 실제 DOM profile/capture report 버튼 클릭, profile별 projectile visual texture/size/rate, snapshot/replay report hook도 함께 확인한다.
- `pnpm smoke:runtime-budgets`는 `tests/smoke/runtime-budget-profiles.mjs`의 per-example profile과 browser smoke mode mapping을 CI-safe 방식으로 검증한다.
- `pnpm smoke:browser-budget`은 Starter Runtime에서 `RuntimeProfiler`를 켜고 frame time, Rust update, render time, draw call, render command, texture switch, physics count, asset load elapsed budget을 구조화된 report로 검증한다.
- `pnpm smoke:topdown-budget`, `pnpm smoke:breakout-budget`, `pnpm smoke:platformer-budget`, `pnpm smoke:physics-sandbox-budget`은 같은 browser budget harness를 각 예제 profile로 실행한다. 직접 `node tests/smoke/browser-render-smoke.mjs --budget --budget-profile=<profile>`을 사용할 수도 있다.
- `pnpm smoke:preload`는 Minimal Game에서 `LoadingOverlay`를 켜고 data URL manifest를 두 번 preload해 첫 실행 fetch와 두 번째 IndexedDB JSON/texture body cache hit를 검증한다.
- `pnpm smoke:mobile-input`은 Minimal Game에서 `VirtualControls` DOM preset을 켜고 joystick/button state가 `W/D/Space/mouseLeft` input으로 합성되고 release되는지 확인한다.
- Minimal Game의 `visual-runtime-lab`과 `input-ui-lab`은 같은 production build와 smoke-only query flag를 공유한다. 별도 app/package 분리는 public portfolio 승격이 필요할 때만 검토한다.
- `pnpm smoke:topdown`은 Top-down Shooter production build에서 실제 asset manifest preload/cache/loading overlay를 거친 뒤 smoke 전용 URL parameter로 deterministic enemy hit를 만들고, particle count와 enemy tint flash render command가 관측되는지 확인한다.
- `pnpm smoke:topdown-mass-objects`는 Top-down Shooter production build에서 Playing 상태의 1,024개 enemy snapshot restore, 1,000개 이상 Rust render command, WebGL2 batching stats, collision pair budget, runtime budget profile을 확인한다.
- `pnpm smoke:topdown-save-load`는 Top-down Shooter production build에서 enemy/bullet이 포함된 built-in shooter snapshot을 캡처하고, `resetGame()` 이후 restore 및 재캡처 hash 일치를 확인한다. 또한 저장/복원 전후 `GameStateSnapshot`을 `createGameplayReplayRun(...)` / `compareGameplayReplayRuns(...)`로 비교해 첫 mismatch frame과 JSON path를 실패 report에 포함한다.
- `pnpm smoke:gameplay-replay`는 Top-down Shooter raw Wasm runtime을 deterministic input stream으로 실행하고 committed golden fixture의 replay hash와 비교한다. 이 경로는 browser rendering smoke가 아니라 gameplay canonical state 회귀 gate다.
- `pnpm smoke:topdown-hd2d`는 Top-down Shooter production build에 smoke 전용 HD-2D spec을 적용해 `weapons.projectileArc`, bridge `toHeightSpan` path, under-pass same-floor path, render command 생성을 확인한다.
- `pnpm smoke:breakout-effects`는 `resetGame()` 이후 자연 ball/brick hit에서 scene-internal particle burst와 render command 증가가 관측되는지 확인한다.
- `pnpm smoke:platformer-effects`는 `resetGame()` 이후 player landing transition에서 scene-internal dust burst와 render command 증가가 관측되는지 확인한다.
- `pnpm smoke:physics-sandbox`는 기본 `sandbox` fixture가 body를 생성하고 physics debug line을 렌더링하며 frame이 진행되는지 확인한다.
- `pnpm smoke:physics-demo-suite`는 sandbox, joint playground, projectile CCD, platformer physics, compound collider, weld joint fixture를 catalog 순서대로 로드해 demo id, body count, debug line, frame 진행 조건을 확인한다. CCD/query 세부 assertion은 Node physics smoke와 Rust unit test가 담당한다.
- `pnpm smoke:destructible-terrain-browser`는 Top-down Shooter의 collision tile 하나를 제거하고 같은 frame 경로에서 query hit 제거와 render command 감소를 확인한다.
- `pnpm smoke:lighting`은 Minimal Game에서 lighting smoke URL을 켜고 renderer stats의 lighting draw/point light/tile occluder/shadow count와 canvas warm pixel을 확인한다.
- `pnpm smoke:lighting-webgpu`는 Minimal Game에서 `renderer=webgpu`와 lighting smoke URL을 켜고 WebGPU renderer stats의 lighting draw/point light/tile occluder/shadow count를 확인한다. WebGPU 미지원 또는 fallback 환경은 실패 대신 skip으로 보고한다.
- `pnpm smoke:material`은 Minimal Game에서 outline sprite material preset을 켜고 WebGL2 canvas pixel과 renderer draw call이 material pass 수만큼 증가하는지 확인한다.
- `pnpm smoke:material-webgpu`는 Minimal Game에서 `renderer=webgpu`와 outline sprite material preset을 켜고 WebGPU renderer stats의 material pass draw call을 확인한다. WebGPU 미지원 또는 fallback 환경은 실패 대신 skip으로 보고한다.
- `pnpm smoke:particle-vfx`는 Minimal Game에서 `ParticleVfxEmitter`의 trail preset을 켜고 particle burst count, live particle count, render command 증가를 확인한다.
- `pnpm smoke:animation-timeline`은 public package build에서 `AnimationTimelinePlayer`의 frame event, signal transition, atEnd transition을 확인한다.
- `pnpm smoke:scene-composition`은 public package build에서 prefab variant props, fragment include transform, idPrefix, target apply 결과와 scene behavior apply target의 handle-to-command 연결을 확인한다.
- `pnpm smoke:behavior-recipes`는 public package build에서 health/damage/pickup/chase recipe가 runtime adapter command로 변환되는지 확인한다.
- `pnpm smoke:hud-toolkit`은 public package build에서 HUD theme token과 meter/counter/prompt overlay state preset을 확인한다.
- `pnpm smoke:audio-system`은 public package build에서 `AudioManager` BGM loop/fade와 master/bgm/sfx/ui bus state를 확인한다.
- `pnpm smoke:camera-postprocess`는 Minimal Game browser runtime에서 renderer fullscreen post-processing pass stats와 camera/post-process public helper를 확인한다.
- `pnpm smoke:cutscene-sequence`는 public package build에서 `CutsceneSequencePlayer`가 wait/camera/audio/dialogue command event를 순서대로 방출하고 target adapter hook과 `LocalizationBundle` 기반 dialogue text 변환을 호출하는지 확인한다.
- `pnpm validate:game-spec`는 Top-down Shooter `game.json`의 `content` namespace가 localization/dialogue/cutscene resolver path를 통과하는지도 확인한다.
- `pnpm smoke:localization`은 public package build에서 `LocalizationBundle` fallback/interpolation, text wrapping, web/bitmap font loading policy를 확인한다.
- `pnpm smoke:dialogue-quest`는 public package build에서 `DialogueSession`, `QuestLog`, UI overlay hook, dialogue/quest snapshot restore를 확인한다.
- `pnpm smoke:physics-scene`은 public package build에서 `applyPhysicsSceneProfile(...)`의 runtime profile, auto rigid-body step option, clear 동작을 확인한다.
- `pnpm smoke:texture-atlas`는 public package build에서 atlas packer를 빌드하고, CLI가 입력 순서와 무관한 deterministic atlas JSON, frame UV, placement metadata를 생성하는지 확인한다.
- `pnpm smoke:asset-pipeline`은 raw sprite folder를 `pack-textures` CLI로 atlas PNG/JSON/Game Spec frame에 병합하고, public `importAsepriteAtlas(...)`, `resolveShooterGameSpec(...)`, `LocalizationBundle`, `AudioAssetLoader`가 같은 consumer asset import 경로에서 함께 동작하는지 확인한다.
- `pnpm smoke:level-streaming`은 public package build에서 chunk manifest bounds, viewport active/preload selection, load/unload candidate, chunk asset manifest 생성, `createRuntimeLevelStreaming(...)`의 preload/load/unload snapshot 갱신, unload 후 `target.releaseAssets` payload와 renderer texture eviction 연결을 확인한다.
- `pnpm smoke:level-streaming-browser`는 Chromium + WebGL2 renderer에서 runtime streaming chunk 이동 후 256개 render command, draw call 2회, texture switch 1회, `RuntimeProfiler` budget, shared texture retain, old chunk texture eviction, canvas pixel readback을 확인한다.
- `pnpm smoke:debug-gizmos`는 public package build에서 path/spawn/prefab/collider debug category가 metadata가 있는 line view와 physics debug line buffer로 변환되는지 확인한다.
- `pnpm smoke:accessibility-options`는 public package build에서 reduced motion camera/fade adapter, subtitle panel helper, high-contrast HUD theme hook, input assist metadata 정규화를 확인한다.
- `pnpm smoke:screenshot-capture`는 Minimal Game browser smoke에서 PNG와 `*.summary.json` artifact를 생성하고 screenshot summary threshold helper가 동작하는지 확인한다.
- `pnpm smoke:create-game-template-catalog`는 `@ferrum2d/create-game`의 machine-readable template catalog 출력과 CLI option negative path를 확인한다.
- `pnpm smoke:template-set`은 `@ferrum2d/create-game`의 `minimal`, `topdown`, `platformer` template catalog, 필수 파일, generated project public import, harness script 구성을 확인한다.
- `pnpm smoke:tilemap-authoring`은 `applyTileRules(...)`, `bakeAnimatedTileLayer(...)`, Tiled import 결과 authoring, LDtk entity/tile layer fixture를 함께 확인한다.
- browser console error와 page error가 발생하지 않는다.

새 browser smoke에서 frame/render/physics budget을 검사할 때는 `RuntimeProfiler`를 우선 사용한다. `FerrumRuntimeOptions.profiler`를 켜면 runtime이 `DebugOverlayMetrics`를 profiler에 기록하고, smoke script는 `--budget` 모드에서 profiler snapshot의 frame time, Rust update, render time, draw call, render command, texture switch, fixed step, tile candidate check, CCD check, physics debug line, collision pair, asset load elapsed budget 위반을 구조화된 결과로 확인한다.

`tests/smoke/runtime-budget-profiles.mjs`에 budget field를 추가할 때는 `packages/ferrum-web/src/runtimeProfiler.ts`의 `RuntimeDiagnosticsBudget`, `RuntimeProfilerSnapshot`, 단일 frame evaluator, aggregate evaluator, 그리고 `tests/smoke/browser-render-smoke.mjs`의 `RUNTIME_BUDGET_FIELDS`를 함께 동기화한다. field가 profiler snapshot에 없으면 browser smoke는 `missingMetric` 위반으로 실패해야 한다.

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
- public entrypoint import가 성공하고 `@ferrum2d/ferrum-web/dist/*` 내부 import가 package exports로 차단된다. gameplay authoring/replay helper와 `gameplayActionDiagnosticReports(...)` 같은 agent-facing diagnostic helper도 generated project import/type smoke에서 확인한다.
- `@ferrum2d/agents` tarball의 bin이 생성 프로젝트에 대해 dry-run으로 파일을 쓰지 않는다.
- 설치된 consumer agent/skill/command는 projectile/weapon authoring helper와 함께 Game Spec `content.localization`/`content.dialogue.graphs`/`content.cutscenes`, `createShooterContentRuntimeOptions(...)` 기반 content runtime authoring 루프를 문서화해야 한다.
- 생성 프로젝트의 `ferrum:report`, `ferrum:validate`, `ferrum:authoring-report`, `ferrum:replay-report`, `ferrum:runtime-replay-report`, `ferrum:runtime-replay-recipe`, `ferrum:smoke`, production build가 통과한다. consumer smoke는 `ferrum:report`의 `ferrum2d.consumer.project.report` JSON envelope를 파싱해 `format`, `version`, `ok`, project dependency/file/internal-import summary와 최상위 `recommendedCommands`를 확인한다. 모든 template의 authoring report는 configured `public/scene-authoring.json` 또는 `public/game.json`을 검증해 `validated`를 반환해야 한다. 모든 template의 gameplay replay report는 `public/gameplay-replay.fixture.json`과 현재 template contract를 비교해 `validated`를 반환하고, `public/gameplay-replay.coverage-tags.json`의 `coverageTagDefinitions`/`coverageTagGroups`/`deprecatedCoverageTags` registry metadata도 report에 포함해야 한다. Runtime replay configured template(`minimal`/`topdown`/`platformer`/`breakout`)은 `public/gameplay-runtime-replay.fixture.json`과 `public/gameplay-runtime-replay.coverage-tags.json`을 포함하며, public `createEngine(...)` + deterministic `requestAnimationFrame` shim + `captureGameStateSnapshot(...)` 기반 headless runtime replay report가 `validated`를 반환해야 한다. `topdown`은 `resolveShooterGameSpec(...)`와 `captureGameStateSnapshot(..., { includeBuiltInShooterState: true })`로 `public/game.json`과 built-in shooter state를 포함한다. `platformer`는 public `usePlatformerGame()`으로 built-in platformer scene을 boot하고, platformer 전용 built-in snapshot이 없으므로 canonical scene/runtime state를 `custom.platformer` JSON에 포함한다. `breakout`은 public `useBreakoutGame()`으로 built-in Breakout scene을 boot하고, Breakout 전용 built-in snapshot이 없으므로 canonical scene/runtime state를 `custom.breakout` JSON에 포함한다. `breakout` authoring report는 `public/scene-authoring.json`의 built-in paddle/ball runtime entity handle과 Behavior Recipe binding summary를 포함해야 한다. `ferrum:update-replay-fixture`와 `ferrum:update-runtime-replay-fixture`는 runtime replay configured template에서 fixture update report로 성공해야 한다. `ferrum:runtime-replay-recipe`는 `ferrum2d.consumer.runtime-gameplay-replay.recipe` envelope로 fixed timestep, seed/input sequence, capture frame, canonical/excluded state 목록을 반환해야 한다. `topdown` smoke는 fixture hash를 의도적으로 stale 값으로 바꿔 `ferrum:replay-report`가 non-zero와 `FERRUM_CONSUMER_REPLAY_FIXTURE_INVALID` machine-actionable fixture path report를 반환하는지 확인한다. 이어서 `public/game.json`의 player speed를 임시 변경해 유효한 fixture와 현재 Game Spec이 갈라진 drift case가 `FERRUM_CONSUMER_REPLAY_MISMATCH`와 changed JSON path를 반환하는지도 확인한다. 두 실패 경로 모두 `ferrum:update-replay-fixture`와 재실행 replay report로 복구 경로까지 검증한다. `minimal`/`platformer`/`breakout`은 생성 시 바뀌지 않는 template surface contract replay를 기본 제공한다.

Top-down template replay report 계약만 빠르게 확인하려면 `pnpm smoke:topdown-template-replay-report`를 사용한다. 이 smoke는 template을 임시 폴더에 복사하고 workspace `@ferrum2d/ferrum-web` package를 symlink해, install/registry 접근 없이 `replay-report -> drift patch candidate -> update-replay-fixture -> replay-report` 흐름을 검증한다. full tarball install, public import/type smoke, generated production build는 계속 `pnpm package:consumer-smoke`의 책임이다.

create-game template catalog 계약만 빠르게 확인하려면 `pnpm smoke:create-game-template-catalog`를 사용한다. 이 smoke는 CLI JSON report root `format: "ferrum-create-game-template-list"`, `version`, `defaultTemplate`, template별 `sceneAuthoring`/`gameplayReplay`/`runtimeGameplayReplay` entry가 manifest와 같은지 검증한다. 또한 human-readable list fallback, `--json` misuse negative path, invalid manifest가 JSON catalog로 누출되지 않는지도 확인한다. full tarball install, generated project file replacement, harness report execution은 계속 `pnpm package:consumer-smoke`와 `pnpm smoke:create-game-template-reports`의 책임이다.

전체 create-game template이 consumer agent가 읽을 수 있는 report envelope를 내는지만 빠르게 확인하려면 `pnpm smoke:create-game-template-reports`를 사용한다. 이 smoke는 `packages/create-game/templates/manifest.json`의 모든 template을 임시 폴더에 복사하고, `_shared` asset scaffold를 template overlay 전에 합친 뒤 `package.json` placeholder만 temp copy에서 정규화한다. 이후 `ferrum-assets.mjs report`, `ferrum-assets.mjs validate`, `ferrum-harness.mjs report`, `ferrum-harness.mjs authoring-report`와 `replay-report`, `update-replay-fixture`, `ferrum-runtime-replay.mjs report`, `ferrum-runtime-replay.mjs recipe`, `ferrum-runtime-replay.mjs update-fixture`를 직접 실행한다. `ferrum-harness.mjs report`는 `ferrum2d.consumer.project.report` envelope로 project status, package dependency, generated files, internal import count, 최상위 recommended command를 확인한다. manifest의 `sceneAuthoring`, `gameplayReplay`, `runtimeGameplayReplay` entry는 template별 deterministic fixture 제공 여부를 catalog로 고정하며, smoke는 각 harness의 configured 값이 catalog와 일치하는지도 확인한다. Workspace `@ferrum2d/ferrum-web` package를 symlink해 asset public entrypoint validate와 authoring/gameplay/runtime replay fixture를 검증한다. `topdown`은 Game Spec contract replay를, `minimal`/`platformer`/`breakout`은 template surface contract replay를 검증한다. runtime replay는 configured template의 headless runtime fixture/report/update path를 확인한다. 이 명령은 install, tarball pack, create-game CLI token replacement, production build를 검증하지 않는다.

의존성 store가 준비된 CI 환경에서는 `pnpm package:consumer-smoke -- --offline`으로 registry resolution 없이 실행할 수 있다. 새 머신에서는 일반 실행으로 Vite/TypeScript 범위 의존성을 consumer install과 같은 방식으로 해석한다. offline 실행은 generated project의 direct dependency tarball(예: TypeScript)이 pnpm store에 없으면 `ERR_PNPM_NO_OFFLINE_TARBALL`로 실패한다. 성공/실패 report와 재현용 파일을 보존하려면 `pnpm package:consumer-smoke -- --artifact-dir artifacts/consumer-smoke`를 사용한다. 이 artifact는 `pnpm validate:consumer-smoke-report`로 `consumer-smoke-report.json`, tarball, tarball-installed `@ferrum2d/create-game --list-templates --json`에서 얻은 `createGameCatalog`, `requestedTemplates`와 generated template summary의 일치, `node_modules`/`dist` 없는 snapshot 계약을 검증한다. `pnpm smoke:consumer-smoke-report`는 tarball 생성 전 초기 실패처럼 snapshot이 아직 없을 수 있는 failed report를 허용하면서, passed report의 `createGameCatalog` 누락/불일치와 존재하는 snapshot의 `node_modules`/`dist`/`.pnpm` 오염은 계속 실패시키는지 확인한다.

## CI와 로컬 검증 차이

GitHub Actions CI는 main push/PR에서 headless 환경으로 실행된다. `ferrum-web-v*` tag push에서는 release metadata check, package consumer smoke gate, extended browser smoke matrix도 실행한다. 일반 PR에서 consumer smoke나 extended browser smoke가 필요할 때는 CI workflow를 수동 실행하고 각각 `consumer_smoke`, `extended_browser_smoke` input을 켠다.

현재 CI 기준:

1. `pnpm install`
2. `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
3. `pnpm smoke:physics`
4. `pnpm smoke:runtime-budgets`
5. `pnpm validate:runtime-budget-product`
6. `pnpm smoke:mass-objects`
7. `pnpm smoke:topdown-mass-objects`
8. `pnpm smoke:topdown-tilemap-budget`
9. `wasm-pack build crates/ferrum-core --target web --out-dir ../../packages/ferrum-web/pkg`
10. `pnpm lint`
11. `pnpm test`
12. `pnpm build`
13. `pnpm package:check`
14. `pnpm validate:gameplay-authoring:report`
15. `pnpm smoke:gameplay-replay:report`
16. `pnpm validate:gameplay-report-artifacts`
17. `pnpm smoke:consumer-smoke-report`
18. `pnpm smoke:asset-pipeline`
19. `pnpm smoke:create-game-template-catalog`
20. `pnpm smoke:create-game-template-reports`
21. `pnpm smoke:topdown-template-replay-report`
22. tag 또는 수동 opt-in일 때 `pnpm package:consumer-smoke -- --artifact-dir artifacts/consumer-smoke`
23. consumer smoke 직후 `pnpm validate:consumer-smoke-report -- --expect-status passed` 또는 실패 시 `--expect-status failed`
24. tag 또는 수동 opt-in일 때 extended browser smoke matrix: `smoke:preload`, `smoke:mobile-input`, `smoke:lighting(-webgpu)`, `smoke:material(-webgpu)`, `smoke:camera-postprocess`, `smoke:particle-vfx`, `smoke:topdown*`, `smoke:destructible-terrain-browser`, `smoke:breakout-*`, `smoke:platformer-*`, `smoke:physics-sandbox*`, `smoke:physics-demo-suite`

extended browser smoke job은 matrix별 artifact 이름을 분리해 budget smoke의 `runtimeBudget` report를 `artifacts/browser-smoke-budgets`에 남긴다. browser budget profile은 frame/render/Rust update, draw/render command/texture switch, physics/collision, asset load budget을 평가한다. Chromium이 `performance.memory`를 제공하는 환경에서는 absolute JS heap used sample도 artifact에 포함하고 budget 위반 여부를 평가한다.

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
- `pnpm smoke:topdown-mass-objects`로 Top-down Shooter browser path에서 Playing 상태의 1,024개 enemy entity restore, WebGL2 대량 sprite command budget, collision pair budget을 확인한다.
- `pnpm smoke:topdown-save-load`로 built-in shooter save/load snapshot restore가 browser production build에서 재현되는지 확인한다.
- `pnpm smoke:topdown-hd2d`로 bridge portal navigation, projectile arc, HD-2D render path가 Top-down Shooter browser production build에서 재현되는지 확인한다.
- `pnpm smoke:runtime-budgets`로 CI에서 runtime budget profile 계약을 확인하고, 예제별 성능 회귀가 의심되면 해당 `smoke:*-budget` browser smoke를 추가로 실행한다. budget browser smoke는 frame/render/Rust update 지표를 report artifact로 남기고, Chromium이 heap API를 제공하면 heap sample도 함께 기록한다.
- `pnpm smoke:mass-objects`로 1,000개 이상 enemy/projectile Rust frame path와 collision pair budget 회귀를 확인한다.
- `pnpm smoke:physics-demo-suite`로 Physics Sandbox fixture catalog 6개가 browser selector, Physics Spec apply, debug line render path를 통과하는지 확인한다.
- `pnpm package:check`로 runtime package entrypoint, create-game scaffold, agents template, files allowlist, generated Wasm artifact, 실제 `pnpm pack` tarball 구성을 확인한다.
- `pnpm package:consumer-smoke`로 local tarball install, generated game build, agents dry-run을 임시 consumer project에서 확인한다.
- `pnpm release:check`로 changelog, beta version, release tag metadata 구조를 확인한다.
- `pnpm build`로 Wasm package와 Top-down Shooter production build를 확인한다.
- `pnpm build:pages`로 GitHub Pages demo/docs artifact 구성과 문서 HTML 생성을 확인한다.
- 브라우저 수동 smoke check로 WebGL2, 입력, 오디오, DebugOverlay 표시를 확인한다.

기본 validate job은 브라우저 실제 렌더링, 사용자 입력, Web Audio 재생, screenshot 갱신을 검증하지 않는다. extended browser smoke job은 tag 또는 수동 opt-in에서 브라우저 렌더링/입력/WebGPU fallback/예제별 budget을 검증하지만, Web Audio unlock과 screenshot baseline 갱신은 여전히 수동 smoke 범위다.

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

자동 browser smoke artifact가 필요하면 `tests/smoke/browser-render-smoke.mjs`에 `--screenshot-artifact-dir <dir>`와 `--screenshot-name <name>`을 전달한다. baseline summary JSON과 비교하려면 `--screenshot-baseline <summary.json>`을 함께 전달하고, 허용 오차는 `--screenshot-max-average-delta`, `--screenshot-max-opaque-ratio-delta`, `--screenshot-max-non-transparent-ratio-delta`로 조정한다.

## 실패 기록 형식

검증 실패가 있으면 작업 결과에 다음을 남긴다.

- 실패 명령 또는 수동 확인 항목
- 실패 원인
- 사용자 영향
- 후속 조치 또는 보류 사유
