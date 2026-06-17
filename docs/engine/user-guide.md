# Ferrum2D 사용자 설명서

Ferrum2D는 브라우저에서 실행되는 2D 게임을 만들기 위한 Rust + WebAssembly 기반 게임 엔진이다. 현재 단계는 **MVP 개발 완료, 상용제품 기능 개발** 이며, `examples/starter-runtime`, `examples/topdown-shooter`, `examples/breakout`, `examples/platformer`, `examples/physics-sandbox`, `examples/placement-viewer` 예제를 기준으로 runtime, 입력, 충돌, 렌더링, 에셋, 효과음, 물리 authoring, 배치 authoring 표시와 위치 draft patch를 검증한다.

이 문서는 실행과 간단한 게임 수정 흐름을 안내한다. Top-down Shooter 예제 설정의 전체 필드, 기본값, 검증 규칙은 [Top-down Shooter Game Spec](../examples/topdown-shooter/game-spec.md)을 기준으로 삼는다.

## 현재 할 수 있는 일

- 브라우저에서 Top-down Shooter 예제를 실행한다.
- 브라우저에서 Breakout 예제를 실행해 shooter와 다른 장르 흐름을 확인한다.
- 브라우저에서 Platformer 예제를 실행해 kinematic platformer controller, coyote/jump buffering, step offset, one-way/moving platform 경로를 확인한다.
- `examples/starter-runtime`에서 `createFerrumRuntime()` 기반 starter 흐름과 `UiOverlay` HUD/dialog를 확인한다.
- `examples/placement-viewer`에서 Data Scene 기반 오브젝트 배치, selected id/entity inspector, drag/numeric/snap 기반 위치 draft patch를 확인한다.
- `examples/topdown-shooter/public/game.json`을 수정해 난이도, 적 등장 방식, 무기 성능, prefab 크기와 collider, camera, tilemap, audio policy를 조정한다.
- Aseprite JSON metadata를 `importAsepriteAtlasFrames(...)`로 Game Spec `atlas.frames`에 연결한다.
- Tiled orthogonal JSON map을 `importTiledGameSpec(...)`로 Game Spec `atlas`/`tilemap`에 연결한다.
- LDtk project JSON embedded level 또는 미리 로드한 external `.ldtkl` level을 `importLDtkGameSpec(...)`로 Game Spec `atlas`/`tilemap`에 연결한다.
- `pnpm validate:game-spec`로 설정 파일을 검증한다.
- `pnpm create:game-variant`로 준비된 preset 기반 변형 파일을 만든다.
- AI agent에게 Game Spec 수정과 검증을 맡긴다.

## 예제 실행하기

가장 작은 starter 예제는 별도 asset 없이 실행된다.

```bash
pnpm dev:starter-runtime
```

Breakout 예제도 별도 asset 없이 실행된다.

```bash
pnpm dev:breakout
```

Platformer 예제도 별도 asset 없이 실행된다.

```bash
pnpm dev:platformer
```

Data Scene placement authoring viewer는 다음 명령으로 실행한다.

```bash
pnpm dev:placement-viewer
```

처음 실행하거나 Rust core를 수정한 뒤에는 Wasm package를 먼저 빌드한다.

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/topdown-shooter dev
```

Vite가 출력하는 로컬 주소를 브라우저에서 연다. 기본 포트라면 다음 주소다.

```text
http://localhost:5173
```

DebugOverlay를 표시하려면 URL에 `?debug=true`를 붙인다.

```text
http://localhost:5173?debug=true
```

## 조작법

| 입력 | 동작 |
| --- | --- |
| `Enter` 또는 `Space` | Title에서 Playing으로 진입 |
| `W/A/S/D` | 플레이어 이동 |
| `Mouse Left` 또는 `Space` | 마우스 방향으로 발사 |
| `Space` | GameOver에서 재시작 |
| touch/pen drag | 드래그 방향을 `W/A/S/D` 이동으로 합성 |
| gamepad left stick / A / Start / right trigger | 이동 / Space action / Enter action / 발사 입력으로 합성 |
| `VirtualControls` DOM preset | 화면 joystick과 `primary`/`menu` button을 `InputSnapshot` 또는 action profile virtual button으로 합성 |

`InputManagerOptions.gamepadMapping`으로 standard gamepad axis/button index를 다시 매핑할 수 있다. `resolveInputActionState(...)`와 `DEFAULT_INPUT_ACTION_PROFILE`은 `InputSnapshot`을 action/axis state로 바꾸는 public helper다. `VirtualControls`는 browser DOM joystick/button preset이며, `applyToSnapshot(...)`으로 raw snapshot에 합성하거나 `virtualButtons()`를 action profile에 주입한다.

## 로딩 화면과 Asset Preload

웹 배포에서 시작 전 asset URL을 미리 가져오려면 `resolveAssetPreloadPlan(...)`과 `preloadAssetManifest(...)`를 사용한다. `createAssetPreloadCachePolicy(...)`는 manifest URL 목록과 release salt에서 cache version을 만들고, `LoadingOverlay`는 `AssetLoadProgress`를 바로 표시하는 DOM preset이다.

```ts
const loading = new LoadingOverlay(canvas.parentElement ?? document.body);
const cache = new IndexedDbAssetCache();
const cachePolicy = createAssetPreloadCachePolicy(manifest, {
  versionSalt: "game-v1",
  ttlMs: 7 * 24 * 60 * 60 * 1000,
});

await preloadAssetManifest(manifest, {
  cache,
  cachePolicy,
  onProgress: (progress) => loading.update(progress),
});

loading.complete();
```

`IndexedDbAssetCache`는 JSON과 texture/sound URL body를 opt-in으로 저장한다. decoded WebGL texture는 renderer runtime에서 다시 생성하므로, cache 정책은 네트워크 fetch와 loading screen 진행률을 안정화하는 용도로 사용한다. asset URL이나 `versionSalt`가 바뀌면 `createAssetPreloadCachePolicy(...)`가 새 cache version을 만들고, 수동 삭제가 필요하면 `invalidatePreloadedAssetCache(manifest, cache, { policy: cachePolicy })`로 같은 manifest entry를 무효화한다.

## 가장 먼저 볼 파일

게임을 바꾸고 싶다면 먼저 이 파일을 수정한다.

```text
examples/topdown-shooter/public/game.json
```

이 파일은 Top-down Shooter의 Game Spec이다. Rust나 TypeScript 코드를 직접 고치지 않아도 많은 게임 변형을 만들 수 있다.

현재 예제 설정의 기준은 실제 `game.json`이고, 문서용 필드 설명의 기준은 [Top-down Shooter Game Spec](../examples/topdown-shooter/game-spec.md)이다. 실제 예제는 runner/bruiser/orbiter wave와 10x6 tilemap obstacle layer를 포함한다. 아래는 구조를 빠르게 보기 위한 축약 예시다.

```json
{
  "world": { "width": 1600, "height": 960 },
  "player": { "speed": 180 },
  "enemies": {
    "speed": 72,
    "spawnInterval": 1.0,
    "behavior": "chase",
    "spawnPattern": "edge",
    "health": 1,
    "scoreReward": 1,
    "orbit": { "radius": 180, "radialBand": 24 },
    "presets": {
      "runner": { "speed": 96, "behavior": "chase", "health": 1 },
      "bruiser": { "speed": 54, "behavior": "drift", "health": 3, "scoreReward": 4 },
      "orbiter": { "speed": 84, "behavior": "orbit", "health": 2, "scoreReward": 3 }
    },
    "waves": [
      { "enemy": "runner", "duration": 18, "spawnInterval": 0.85, "enemyCount": 18 },
      { "enemy": "bruiser", "duration": 16, "spawnInterval": 1.25, "enemyCount": 10 },
      { "enemy": "orbiter", "duration": 18, "spawnInterval": 1.1, "enemyCount": 12 }
    ]
  },
  "weapons": { "bulletSpeed": 360, "cooldown": 0.12, "lifetime": 1.8, "damage": 1 },
  "prefabs": {
    "player": { "width": 36, "height": 36 },
    "enemy": { "width": 24, "height": 24 },
    "bullet": { "frame": "bullet.default" }
  },
  "atlas": {
    "frames": {
      "bullet.default": {
        "texture": "bullet",
        "uv": { "u0": 0, "v0": 0, "u1": 1, "v1": 1 },
        "size": { "width": 8, "height": 8 }
      }
    }
  },
  "camera": { "preset": "look-ahead", "lookAhead": { "distance": 96 } },
  "audio": { "masterVolume": 1, "sfxVolume": 0.85 }
}
```

## 주요 조정 항목

| 항목 | 설명 |
| --- | --- |
| `world.width`, `world.height` | 게임 월드의 크기다. |
| `player.speed` | 플레이어 이동 속도다. |
| `enemies.speed`, `enemies.spawnInterval` | 적 이동 속도와 등장 간격이다. |
| `enemies.behavior` | `"chase"`, `"drift"`, `"static"`, `"orbit"` 중 하나다. |
| `enemies.spawnPattern` | `"edge"`, `"corners"`, `"center"` 중 하나다. |
| `enemies.orbit` | orbit behavior의 목표 반경과 접근/이탈 보정 폭이다. |
| `enemies.presets`, `enemies.waves` | 적 설정 묶음과 wave timeline이다. |
| `weapons.*` | 총알 속도, 발사 간격, lifetime, 피해량이다. |
| `prefabs.*.width`, `prefabs.*.height` | 표시 크기와 충돌 기준 크기다. |
| `prefabs.*.collider` | player/enemy/bullet AABB/circle/capsule/oriented-box/convex-polygon collider의 shape, offset, enable/trigger, material metadata다. |
| `prefabs.*.animation` | horizontal sprite sheet 또는 `idle`/`move` state animation 설정이다. |
| `prefabs.*.frame`, `atlas.frames` | static atlas frame의 texture, UV, size metadata다. |
| `tilemap.tiles`, `tilemap.layers` | 정적 tile layer, 선택적 collision/collision-only layer, chase enemy navigation 장애물이다. |
| `camera.*` | follow, dead-zone, look-ahead, shake preset 설정이다. |
| `audio.*` | Web Audio master/sfx bus와 shoot/hit/gameOver event volume/pitch 설정이다. |

필드별 타입, 기본값, 검증 조건은 [Top-down Shooter Game Spec](../examples/topdown-shooter/game-spec.md)의 `필드` 표를 확인한다.

## 자주 쓰는 예시

쉬운 게임을 만들고 싶다면 적 속도와 등장 빈도를 낮추고, 플레이어 속도나 총알 피해량을 높인다.

```json
{
  "player": { "speed": 220 },
  "enemies": { "speed": 50, "spawnInterval": 1.5, "health": 1 },
  "weapons": { "cooldown": 0.1, "damage": 2 }
}
```

어려운 게임을 만들고 싶다면 적을 더 빠르고 자주 등장하게 한다.

```json
{
  "enemies": { "speed": 120, "spawnInterval": 0.45, "health": 2, "scoreReward": 2 },
  "weapons": { "cooldown": 0.18, "damage": 1 }
}
```

타겟 연습 모드를 만들고 싶다면 적을 움직이지 않게 하고 중앙 또는 모서리에서 등장시킨다.

```json
{
  "enemies": {
    "behavior": "static",
    "spawnPattern": "center",
    "spawnInterval": 0.8
  }
}
```

## 설정 검증하기

예제 Game Spec이 올바른지 확인하려면 다음 명령을 사용한다.

```bash
pnpm validate:game-spec
```

다른 파일을 검증하려면 다음처럼 경로를 넘긴다.

```bash
pnpm --filter @ferrum2d/ferrum-web build
node scripts/validate/validate-game-spec.mjs path/to/game.json
```

검증에 실패하면 오류 메시지의 `path`와 `detail`을 먼저 확인한다. 예를 들어 `path='weapons.cooldown' detail='must be a positive finite number'`는 해당 필드에 0보다 큰 숫자가 필요하다는 뜻이다.

## 게임 변형 만들기

준비된 preset으로 새 Game Spec 파일을 만들 수 있다.

```bash
pnpm create:game-variant fast-enemies
pnpm create:game-variant drift-swarm
pnpm create:game-variant static-targets
pnpm create:game-variant orbit-ring
```

출력 경로를 직접 지정할 수도 있다.

```bash
pnpm create:game-variant drift-swarm /tmp/game.drift-swarm.json
```

만든 파일은 검증한 뒤 `examples/topdown-shooter/public/game.json`에 반영해서 실행해볼 수 있다.

## AI 에이전트로 개발하기

Ferrum2D는 비주얼 에디터 중심 엔진이 아니라 AI agent-first 2D game engine을 목표로 한다. AI 에이전트가 Game Spec, Physics Spec, template, validation, smoke check를 반복하며 게임을 생성하고 수정하는 흐름을 우선한다.

권장 흐름은 다음과 같다.

1. 목표를 설명한다.
2. 에이전트가 `@ferrum2d/create-game` 템플릿 또는 예제 프로젝트에서 시작한다.
3. 에이전트가 Game Spec, Physics Spec, asset metadata, TypeScript glue code를 수정한다.
4. `pnpm validate:game-spec`, `pnpm validate:physics-authoring`, smoke check로 결과를 검증한다.
5. 브라우저에서 플레이 감각을 확인하고 다시 반복한다.

`@ferrum2d/create-game`으로 만든 프로젝트는 다음 하네스 명령을 제공한다.

```bash
npm run ferrum:report
npm run ferrum:validate
npm run ferrum:smoke
```

AI 도구별 개발 지침은 명시적으로 설치한다. Codex/Claude는 공식 subagent와 skill 경로를 사용하고, Gemini CLI는 공식 `GEMINI.md` context file과 `.gemini/commands/*.toml` custom command를 사용한다.

```bash
npx @ferrum2d/agents init --tools codex,claude,gemini
```

AI 에이전트에게 게임 밸런스 작업을 맡길 때는 가능하면 Rust/TypeScript 코드보다 `game.json`을 먼저 수정하게 하는 것이 좋다. 코드 변경은 새로운 엔진 기능이 필요할 때만 진행한다.

## 현재 지원하지 않는 것

MVP 개발 완료 이후 상용제품 기능 개발 단계에서도 다음 기능은 아직 사용자 기능으로 제공하지 않는다.

- 3D 게임
- 비주얼 에디터
- 멀티플레이어
- 전체 게임 루프의 Web Worker 이전 또는 Wasm threads
- 복잡한 물리 엔진
- 사용자 스크립트/plugin runtime
- 스켈레탈 애니메이션

일부 이름은 deprecated compatibility shim으로 코드에 남아 있을 수 있지만 제품 런타임 기능을 제공하지 않는다. public API의 정확한 정책은 [Public API](public-api.md)를 따른다.

## 관련 문서와 파일

| 경로 | 용도 |
| --- | --- |
| `README.md` | 설치, 빌드, 프로젝트 전체 개요 |
| `docs/README.md` | 문서 지도와 기준 소스 |
| `docs/examples/topdown-shooter/game-spec.md` | Top-down Shooter 예제 설정 필드의 상세 설명 |
| `docs/engine/public-api.md` | package entrypoint import 계약 |
| `docs/development/quality/smoke-check.md` | 자동/CI/수동 검증 정책 |
| `docs/development/quality/topdown-shooter-smoke-checklist.md` | 브라우저 수동 점검 상세 항목 |
| `examples/topdown-shooter/public/game.json` | 실제 예제가 읽는 게임 설정 파일 |
| `schemas/shooter-game-spec.schema.json` | Game Spec 구조 보조 JSON Schema |
| `scripts/validate/validate-game-spec.mjs` | Game Spec 검증 스크립트 |
| `scripts/tools/create-game-variant.mjs` | preset 기반 변형 생성 스크립트 |
| `.agents/skills/ferrum-game-designer/SKILL.md` | AI 에이전트용 Ferrum2D 게임 디자인 skill |

## 개발자용 기본 검증

게임 설정만 바꿨다면 보통 다음 검증이면 충분하다.

```bash
pnpm validate:game-spec
```

TypeScript나 Rust 코드를 바꿨다면 더 넓은 검증을 실행한다.

```bash
cargo test --manifest-path crates/ferrum-core/Cargo.toml
pnpm lint
pnpm test
pnpm build
```

Wasm 브리지 API를 바꿨다면 반드시 Wasm package도 다시 빌드한다.

```bash
pnpm build:wasm
pnpm build
```
