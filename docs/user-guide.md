# Ferrum2D 사용자 설명서

Ferrum2D는 브라우저에서 실행되는 2D 게임을 만들기 위한 Rust + WebAssembly 기반 게임 엔진 MVP다. 현재는 `Top-down Shooter` 예제를 중심으로 엔진 기능을 검증하고 있으며, 사용자는 JSON 설정 파일을 바꿔 게임 속도, 적 등장 방식, 무기 성능, 충돌 크기 등을 조정할 수 있다.

이 문서는 게임 엔진을 잘 모르는 사용자가 Ferrum2D를 실행하고, 게임을 수정하고, AI 에이전트에게 개발 보조 작업을 맡길 수 있도록 정리한 안내서다.

## 현재 할 수 있는 일

- 브라우저에서 Top-down Shooter 예제를 실행한다.
- `game.json`을 수정해서 게임 난이도와 규칙을 바꾼다.
- 적 이동 방식, 적 스폰 위치, 체력, 점수 보상, 총알 성능을 조정한다.
- 설정 파일이 올바른지 검증한다.
- 미리 준비된 preset으로 게임 변형 파일을 만든다.
- AI 에이전트가 Game Spec을 수정하고 검증하도록 작업을 맡긴다.

## 예제 실행하기

처음 실행하거나 Rust core를 수정한 뒤에는 Wasm package를 먼저 빌드한다.

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/topdown-shooter dev
```

명령을 실행하면 Vite가 로컬 주소를 출력한다. 기본 주소는 다음과 같다.

```text
http://localhost:5173
```

디버그 오버레이를 숨기고 싶으면 주소 뒤에 `?debug=false`를 붙인다.

```text
http://localhost:5173?debug=false
```

## 조작법

| 입력 | 동작 |
| --- | --- |
| `Enter` 또는 `Space` | 타이틀 화면에서 게임 시작 |
| `W/A/S/D` | 플레이어 이동 |
| `Mouse Left` 또는 `Space` | 마우스 방향으로 발사 |
| `Space` | 게임 오버 화면에서 재시작 |

## 가장 먼저 볼 파일

게임을 바꾸고 싶다면 먼저 이 파일을 수정한다.

```text
examples/topdown-shooter/public/game.json
```

이 파일은 Top-down Shooter의 `Game Spec`이다. Game Spec은 "게임을 어떤 규칙으로 실행할지 적어둔 설정표"라고 보면 된다. Rust나 TypeScript 코드를 직접 고치지 않아도 많은 게임 변형을 만들 수 있다.

## Game Spec 구조

현재 기본 설정은 다음 형태다.

```json
{
  "world": {
    "width": 1600,
    "height": 960
  },
  "player": {
    "speed": 180
  },
  "enemies": {
    "speed": 72,
    "spawnInterval": 1.0,
    "behavior": "chase",
    "spawnPattern": "edge",
    "health": 1,
    "scoreReward": 1
  },
  "weapons": {
    "bulletSpeed": 360,
    "cooldown": 0.12,
    "lifetime": 1.8,
    "damage": 1
  },
  "prefabs": {
    "player": { "width": 36, "height": 36 },
    "enemy": { "width": 24, "height": 24 },
    "bullet": { "width": 8, "height": 8 }
  }
}
```

## 주요 설정 설명

| 항목 | 설명 |
| --- | --- |
| `world.width`, `world.height` | 게임 월드의 가로/세로 크기다. 값이 크면 더 넓은 맵이 된다. |
| `player.speed` | 플레이어 이동 속도다. 값이 클수록 빠르게 움직인다. |
| `enemies.speed` | 적 이동 속도다. 값이 클수록 적이 빠르게 접근한다. |
| `enemies.spawnInterval` | 적이 새로 등장하는 시간 간격이다. 값이 작을수록 적이 자주 나온다. |
| `enemies.behavior` | 적이 어떻게 움직일지 정하는 preset이다. |
| `enemies.spawnPattern` | 적이 어디에서 등장할지 정하는 preset이다. |
| `enemies.health` | 적 체력이다. 값이 크면 여러 번 맞아야 죽는다. |
| `enemies.scoreReward` | 적을 죽였을 때 얻는 점수다. |
| `weapons.bulletSpeed` | 총알 속도다. 값이 클수록 빠르게 날아간다. |
| `weapons.cooldown` | 발사 간격이다. 값이 작을수록 빠르게 연사한다. |
| `weapons.lifetime` | 총알이 사라지기 전까지 유지되는 시간이다. |
| `weapons.damage` | 총알 한 발의 피해량이다. |
| `prefabs.*.width`, `prefabs.*.height` | 플레이어, 적, 총알의 표시 크기와 충돌 기준 크기다. |

## 적 행동 preset

| 값 | 설명 |
| --- | --- |
| `"chase"` | 적이 플레이어를 따라온다. 기본 슈터에 가장 가까운 동작이다. |
| `"drift"` | 적이 월드 중앙 쪽으로 이동한다. 군집형 패턴을 만들 때 좋다. |
| `"static"` | 적이 등장한 뒤 움직이지 않는다. 타겟 연습 모드에 적합하다. |

## 적 등장 preset

| 값 | 설명 |
| --- | --- |
| `"edge"` | 적이 월드 가장자리에서 등장한다. 기본값이다. |
| `"corners"` | 적이 네 모서리에서 등장한다. 방향 예측이 쉬운 패턴이다. |
| `"center"` | 적이 월드 중앙에서 등장한다. 실험이나 타겟 모드에 적합하다. |

## 난이도 조정 예시

쉬운 게임을 만들고 싶다면 적 속도와 등장 빈도를 낮추고, 플레이어 속도나 총알 피해량을 높인다.

```json
{
  "player": { "speed": 220 },
  "enemies": {
    "speed": 50,
    "spawnInterval": 1.5,
    "health": 1
  },
  "weapons": {
    "cooldown": 0.1,
    "damage": 2
  }
}
```

어려운 게임을 만들고 싶다면 적을 더 빠르고 자주 등장하게 한다.

```json
{
  "enemies": {
    "speed": 120,
    "spawnInterval": 0.45,
    "health": 2,
    "scoreReward": 2
  },
  "weapons": {
    "cooldown": 0.18,
    "damage": 1
  }
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
node scripts/validate-game-spec.mjs path/to/game.json
```

검증에 실패하면 보통 다음 중 하나다.

| 오류 유형 | 의미 |
| --- | --- |
| positive number | `0`보다 큰 숫자가 필요하다. |
| positive integer | `1`, `2`, `3`처럼 양의 정수가 필요하다. |
| invalid behavior | `chase`, `drift`, `static` 중 하나만 사용할 수 있다. |
| invalid spawnPattern | `edge`, `corners`, `center` 중 하나만 사용할 수 있다. |

## 게임 변형 만들기

준비된 preset으로 새 Game Spec 파일을 만들 수 있다.

```bash
pnpm create:game-variant fast-enemies
pnpm create:game-variant drift-swarm
pnpm create:game-variant static-targets
```

출력 경로를 직접 지정할 수도 있다.

```bash
pnpm create:game-variant drift-swarm /tmp/game.drift-swarm.json
```

만든 파일은 검증한 뒤 `examples/topdown-shooter/public/game.json`에 반영해서 실행해볼 수 있다.

## AI 에이전트로 개발 보조하기

Ferrum2D는 AI 에이전트가 게임을 조정하기 좋은 방향으로 Game Spec과 검증 도구를 제공한다. 현재 추천 흐름은 다음과 같다.

1. AI 에이전트에게 목표를 설명한다.
2. 에이전트가 `examples/topdown-shooter/public/game.json`을 수정한다.
3. `pnpm validate:game-spec`로 설정을 검증한다.
4. 필요하면 `pnpm create:game-variant ...`로 변형 파일을 만든다.
5. 브라우저에서 플레이 감각을 확인한다.

예시 요청:

```text
AI 에이전트가 사용하기 좋은 drift-swarm 변형을 만들어줘.
적은 작고 빠르게, 총알은 약하지만 연사가 빠르게 조정해줘.
수정 후 pnpm validate:game-spec도 실행해줘.
```

AI 에이전트에게 게임 밸런스 작업을 맡길 때는 가능하면 Rust/TypeScript 코드보다 `game.json`을 먼저 수정하게 하는 것이 좋다. 코드 변경은 새로운 엔진 기능이 필요할 때만 진행한다.

## 현재 지원하지 않는 것

Ferrum2D는 아직 MVP 단계이므로 다음 기능은 사용자 기능으로 제공하지 않는다.

- WebGPU 렌더러
- 3D 게임
- 에디터
- 멀티플레이어
- Web Worker 또는 Wasm threads
- 복잡한 물리 엔진
- 사용자 스크립트/plugin runtime
- 스켈레탈 애니메이션

## 관련 문서와 파일

| 경로 | 용도 |
| --- | --- |
| `README.md` | 설치, 빌드, 프로젝트 전체 개요 |
| `docs/game-spec.md` | Game Spec 필드의 개발자용 상세 설명 |
| `docs/agent-workflow.md` | AI 에이전트 작업 흐름 |
| `docs/agent-review-checklist.md` | AI 변경 검토 체크리스트 |
| `examples/topdown-shooter/public/game.json` | 실제 예제가 읽는 게임 설정 파일 |
| `schemas/shooter-game-spec.schema.json` | Game Spec JSON Schema |
| `scripts/validate-game-spec.mjs` | Game Spec 검증 스크립트 |
| `scripts/create-game-variant.mjs` | preset 기반 변형 생성 스크립트 |
| `.agents/skills/ferrum-game-designer/SKILL.md` | AI 에이전트용 Ferrum2D 게임 디자인 skill |

## 개발자용 기본 검증

게임 설정만 바꿨다면 보통 다음 검증이면 충분하다.

```bash
pnpm validate:game-spec
```

TypeScript나 Rust 코드를 바꿨다면 더 넓은 검증을 실행한다.

```bash
cargo test --manifest-path crates/ferrum-core/Cargo.toml
pnpm test
pnpm lint
pnpm build
```

Wasm 브리지 API를 바꿨다면 반드시 Wasm package도 다시 빌드한다.

```bash
pnpm build:wasm
pnpm build
```
