# Ferrum2D 개발자 퀵스타트

Ferrum2D는 Rust core, WebAssembly, TypeScript platform layer, WebGL2 renderer로 구성된 2D 웹 게임 엔진이다. Ferrum2D의 개발 흐름은 비주얼 에디터 중심이 아니라 **Game Spec, Physics Spec, 생성 템플릿, AI agent, 검증 스크립트**를 중심으로 한다.

이 페이지는 Ferrum2D를 처음 보는 개발자가 엔진의 방향과 구조를 이해하고, 첫 게임 프로젝트를 실행한 뒤, 어떤 파일을 수정해야 하는지 빠르게 판단하도록 돕는 시작 문서다.

## 이 페이지에서 얻는 것

| 질문 | 답 |
| --- | --- |
| Ferrum2D는 어떤 엔진인가? | Rust/Wasm core와 TypeScript browser runtime을 분리한 AI agent-first 2D web game engine |
| 어떻게 시작하나? | `@ferrum2d/create-game` 템플릿으로 새 프로젝트 생성 |
| 어디를 수정하나? | 먼저 Game Spec, Scene Authoring, asset metadata를 수정하고 필요할 때만 runtime code 수정 |
| 어떻게 검증하나? | `ferrum:report`, `ferrum:validate`, replay report, `ferrum:smoke`, `ferrum:deploy-report`로 확인 |
| 어디까지 지원하나? | Core runtime, data-driven authoring primitive, 검증된 starter scene/template. WebGPU와 일부 visual/asset helper는 optional/lab 성격 |

## 지원 수준 먼저 보기

Ferrum2D의 public package에는 core runtime, starter scene, helper, smoke/report 도구가 함께 들어 있다. 새 게임을 만들 때는 이 구분과 import 경로를 먼저 본다.

| 수준 | 권장 import | 어떻게 쓰나 |
| --- | --- | --- |
| Core runtime | `@ferrum2d/ferrum-web/core` | `createFerrumRuntime(...)`, `createEngine(...)`, WebGL2 renderer, input/audio/asset loading, Physics Spec/API를 게임 실행의 기본으로 사용한다. |
| Authoring primitive | `@ferrum2d/ferrum-web/authoring` | Scene Composition, Behavior Recipe, projectile/weapon authoring, replay/snapshot을 template이나 agent-generated adapter에서 조합한다. |
| Starter scene/template | `@ferrum2d/ferrum-web/starter-scenes` | `minimal`, `topdown`, `platformer`, `breakout`은 검증된 시작점이다. 특정 장르 전체를 자동으로 완성하는 범용 모드는 아니다. |
| Optional/lab/helper | `@ferrum2d/ferrum-web/labs` | WebGPU, HD-2D helper, PixelMaskTerrain, deterministic texture atlas JSON helper는 제약을 확인하고 opt-in으로 사용한다. |
| Quality infrastructure | `@ferrum2d/ferrum-web/quality` | `ferrum:*` report, replay, smoke, runtime budget은 게임 기능이 아니라 변경 결과를 검증하는 도구다. |

## 10분 시작 경로

### 1. 프로젝트 생성

```bash
npm create @ferrum2d/game my-game
cd my-game
npm install
```

### 2. 브라우저 실행

```bash
npm run dev
```

### 3. 프로젝트 구조 확인

```bash
npm run ferrum:report
```

### 4. 설정과 빌드 검증

```bash
npm run ferrum:validate
npm run ferrum:smoke
```

### 5. 배포 산출물 확인

```bash
npm run ferrum:deploy-report
npm run preview
```

`ferrum:deploy-report`가 `status: "ready"`를 반환하면 `dist/`의 HTML 및 정적으로 판별 가능한 runtime/CSS asset 경로가 상대 경로이고, 생성 프로젝트의 실제 `preview` 명령이 localhost에서 정상 응답하며 Wasm을 `application/wasm`으로 제공한다는 뜻이다. 이 단순 정적 배포 계약은 HTML `<base>` 요소를 허용하지 않고, 상대 literal `fetch(...)`를 사용하는 경우 HTML entry가 모두 같은 디렉터리에 있어야 한다. 실제 호스팅 서비스의 MIME과 브라우저 실행은 별도로 확인하며, 로컬 확인은 `file://`가 아니라 출력된 preview URL을 사용한다.

### 6. AI agent 템플릿 설치

```bash
npx @ferrum2d/agents init --tools codex,claude,gemini
```

## 엔진 모델

Ferrum2D는 한 프레임을 다음처럼 처리한다.

```text
Browser input
-> TypeScript input snapshot
-> Wasm Engine.update(delta)
-> Rust simulation / collision / scene logic
-> Rust render command buffer
-> TypeScript renderer / audio / UI
-> browser frame
```

역할 경계는 명확하다.

| 영역 | 책임 | 직접 하지 않는 것 |
| --- | --- | --- |
| Rust core | 게임 상태, entity/component, collision, physics, scene update, render command 생성 | DOM, Canvas, WebGL, Web Audio 호출 |
| Wasm boundary | 낮은 빈도 API와 frame bulk buffer 연결 | entity별 JS/Wasm hot-path 왕복 |
| TypeScript platform | canvas, renderer, input, audio, asset loading, UI/debug overlay | 게임 시뮬레이션 source of truth 소유 |
| Consumer project | Game Spec, Scene Authoring, runtime bootstrap, asset metadata | `dist/*`, `pkg/*`, `src/*` 내부 import |

이 구조 때문에 Ferrum2D에서 좋은 변경은 대부분 다음 중 하나다.

- JSON spec으로 표현할 수 있는 변경
- public API를 통해 낮은 빈도로 적용되는 변경
- replay/smoke로 검증할 수 있는 변경
- frame hot path에 새 JS callback을 만들지 않는 변경

## 템플릿 선택

템플릿 목록은 CLI로 확인한다.

```bash
npx @ferrum2d/create-game --list-templates
npx @ferrum2d/create-game --list-templates --json
```

| 템플릿 | 시작점 | 적합한 작업 |
| --- | --- | --- |
| `minimal` | 가장 작은 runtime starter | public API 연결, HUD/debug metric, projectile/weapon authoring 실험 |
| `topdown` | Game Spec 기반 shooter | world 크기, enemy wave, weapon, prefab, camera 튜닝 |
| `platformer` | built-in platformer starter scene | jump, movement, platform collision, side-scroller starter. 범용 platformer editor는 아님 |
| `breakout` | built-in Breakout starter scene | paddle, ball, brick/session 흐름의 arcade starter. 범용 arcade editor는 아님 |

특정 템플릿으로 시작하려면 다음처럼 만든다.

```bash
npx @ferrum2d/create-game my-shooter --template topdown
npx @ferrum2d/create-game my-platformer --template platformer
npx @ferrum2d/create-game my-breakout --template breakout
```

## 생성 프로젝트 구조

생성 직후 먼저 볼 파일은 다음이다.

| 파일 | 역할 |
| --- | --- |
| `src/main.ts` | browser runtime bootstrap. canvas, input, renderer, HUD, built-in scene 연결 |
| `src/styles.css` | starter layout과 canvas 주변 UI |
| `public/game.json` | `topdown` 템플릿의 Game Spec |
| `public/scene-authoring.json` | [Data Scene Authoring](data-scene-authoring.md) envelope를 사용하는 Scene Composition과 Behavior Recipe fixture |
| `public/gameplay-replay.fixture.json` | template surface replay fixture |
| `public/gameplay-runtime-replay.fixture.json` | generated project runtime replay fixture |
| `scripts/ferrum-harness.mjs` | report, validate, smoke, authoring/replay command harness |
| `scripts/ferrum-runtime-replay.mjs` | runtime replay report/update harness |
| `scripts/ferrum-deploy.mjs` | production build와 정적 웹 배포 준비 상태 report harness |

처음에는 `src/main.ts`보다 `public/game.json`과 `public/scene-authoring.json`을 먼저 본다. `src/main.ts`는 브라우저 runtime 조립 코드이고, 게임 규칙과 밸런스는 가능한 한 spec과 authoring data로 표현하는 것이 Ferrum2D의 기본 방향이다.

## 무엇을 어디서 바꾸나

| 바꾸고 싶은 것 | 우선 수정 위치 | 검증 |
| --- | --- | --- |
| Top-down world 크기 | `public/game.json.world` | `npm run ferrum:validate` |
| 적 속도, spawn 간격, wave | `public/game.json.enemies` | `npm run ferrum:replay-report` |
| 무기 속도, cooldown, damage | `public/game.json.weapons` 또는 behavior recipe | `npm run ferrum:authoring-report` |
| prefab 크기와 collider | `public/game.json.prefabs` | `npm run ferrum:validate` |
| scene composition, behavior recipe, runtime entity binding | `public/scene-authoring.json` | `npm run ferrum:authoring-report` |
| HUD, input, runtime bootstrap | `src/main.ts` | `npm run ferrum:smoke` |
| sprite/audio/localization scaffold | `public/assets/**` | `npm run ferrum:asset-report` |
| replay baseline | `public/gameplay-replay.fixture.json` | `npm run ferrum:replay-report` |

새 기능이 spec이나 public API로 표현되지 않는다면 바로 내부 파일을 import하지 말고, 먼저 public API 승격이 필요한지 판단한다.

## 개발 명령

생성 프로젝트에서 자주 쓰는 명령은 다음이다.

| 명령 | 용도 |
| --- | --- |
| `npm run dev` | Vite dev server로 게임 실행 |
| `npm run ferrum:report` | 프로젝트 구조, package dependency, internal import, authoring surface 요약 |
| `npm run ferrum:validate` | Game Spec과 generated project 기본 계약 검증 |
| `npm run ferrum:asset-report` | asset scaffold와 atlas/audio/localization manifest 요약 |
| `npm run ferrum:asset-validate` | public package helper로 asset metadata 검증 |
| `npm run ferrum:authoring-report` | Scene Authoring과 Behavior Recipe 연결 검증 |
| `npm run ferrum:replay-report` | template gameplay replay fixture 검증 |
| `npm run ferrum:runtime-replay-report` | generated runtime replay fixture 검증 |
| `npm run ferrum:smoke` | validate와 production build를 함께 실행 |
| `npm run ferrum:deploy-report` | production build, 정적 판별 가능한 상대 asset 경로, 참조 파일, 실제 preview HTTP와 Wasm MIME을 검증 |
| `npm run preview` | production `dist/`를 localhost HTTP로 미리 보기 |

변경 후 기본 루프는 다음이면 충분하다.

```bash
npm run ferrum:report
npm run ferrum:validate
npm run ferrum:authoring-report
npm run ferrum:replay-report
npm run ferrum:smoke
npm run ferrum:deploy-report
```

## AI agent와 함께 개발하기

Ferrum2D는 AI agent가 안전하게 수정할 수 있는 파일과 검증 명령을 제공한다. agent를 설치하면 Codex, Claude, Gemini용 consumer 개발 지침과 command가 생성된다.

```bash
npx @ferrum2d/agents init --tools codex,claude,gemini
```

권장 작업 흐름은 다음이다.

1. 사람이 원하는 플레이 변경을 설명한다.
2. agent가 `ferrum:report`와 관련 spec을 읽는다.
3. agent가 Game Spec, Scene Authoring, asset metadata, template source 중 필요한 파일만 수정한다.
4. agent가 validate, authoring report, replay report, smoke를 실행한다.
5. 사람이 브라우저에서 결과를 확인하고 다음 피드백을 준다.

agent에게 요청할 때는 파일명보다 의도를 먼저 말하는 편이 좋다.

```text
topdown 초반 난이도를 낮춰줘.
초반 20초 동안 적 spawn 간격을 늘리고, enemy wave 수를 줄인 뒤 replay report까지 확인해줘.
```

## 엔진 저장소 개발

Ferrum2D 엔진 자체를 수정하려면 다음 순서로 읽는다.

| 순서 | 파일 또는 문서 | 확인할 것 |
| --- | --- | --- |
| 1 | [아키텍처](../development/architecture/architecture.md) | Rust core, Wasm boundary, TypeScript platform 책임 경계 |
| 2 | [Public API](public-api.md) | consumer project가 import해도 되는 API |
| 3 | `packages/ferrum-web/src/index.ts` | 실제 package public entrypoint |
| 4 | `packages/ferrum-web/src/createFerrumRuntime.ts` | browser runtime 조립 |
| 5 | `packages/ferrum-web/src/createEngine.ts` | Wasm engine wrapper와 frame callback |
| 6 | `crates/ferrum-core/src/engine.rs` | Rust `Engine` facade |
| 7 | `crates/ferrum-core/src/world.rs` | entity/component storage |
| 8 | `crates/ferrum-core/src/render_command.rs` | Rust to TypeScript render command ABI |

엔진 저장소의 기본 검증 명령은 다음이다.

```bash
pnpm lint
pnpm test
pnpm build
```

package와 template 표면을 바꿨다면 다음을 추가한다.

```bash
pnpm smoke:create-game-template-catalog
pnpm smoke:create-game-template-reports
pnpm package:check
```

renderer나 browser runtime 표면을 바꿨다면 관련 browser smoke를 실행한다.

```bash
pnpm smoke:browser
pnpm smoke:topdown
pnpm smoke:platformer-effects
pnpm smoke:breakout-effects
```

## 설계 경계

Ferrum2D가 기본 제품 범위로 열지 않는 항목도 명확히 둔다.

| 범위 밖 항목 | 이유 |
| --- | --- |
| full visual editor | Ferrum2D의 기본 authoring surface는 spec, template, validation, replay |
| drag-and-drop object placement editor | AI agent-first 개발 흐름과 별도 승인 필요 |
| multiplayer | runtime/network architecture 별도 설계 필요 |
| 3D rendering | 현재 renderer와 runtime은 2D command buffer 기준 |
| Wasm threads 기반 전체 game loop | SharedArrayBuffer, worker lifecycle, ABI 설계 별도 필요 |
| user scripting/plugin runtime | 보안, sandbox, API 안정성 설계 필요 |
| skeletal animation | 현재 animation surface는 sprite timeline 중심 |
| soft body, cloth, fluid | 현재 physics core 범위를 넘어서는 complex physics |

## 다음 문서

| 목적 | 문서 |
| --- | --- |
| 예제를 실행하고 Game Spec을 바꾸고 싶다 | [사용자 설명서](user-guide.md) |
| public import 계약을 확인하고 싶다 | [Public API](public-api.md) |
| projectile, behavior recipe, event action을 이해하고 싶다 | [Runtime Extensibility](runtime-extensibility.md) |
| physics authoring을 이해하고 싶다 | [Physics Spec](physics-spec.md) |
| Top-down Shooter 설정을 깊게 보고 싶다 | [Top-down Shooter Game Spec](../examples/topdown-shooter/game-spec.md) |
| 엔진 내부 경계를 보고 싶다 | [아키텍처](../development/architecture/architecture.md) |
| 어떤 검증을 돌릴지 고르고 싶다 | [Smoke Check](../development/quality/smoke-check.md) |
