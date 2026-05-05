# Shooter Game Spec

Ferrum2D Top-down Shooter는 `examples/topdown-shooter/public/game.json`을 데이터 기반 설정 파일로 사용한다. AI agent는 가능한 한 이 파일을 수정해서 게임 변형을 만들고, Rust/TypeScript 코드는 검증기나 엔진 기능이 부족할 때만 변경한다.

## 구조

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
    "player": {
      "width": 36,
      "height": 36,
      "animation": {
        "columns": 4,
        "rows": 2,
        "states": {
          "idle": { "row": 0, "frames": 1, "fps": 1 },
          "move": { "row": 1, "frames": 4, "fps": 8 }
        }
      }
    },
    "enemy": { "width": 24, "height": 24 },
    "bullet": { "width": 8, "height": 8 }
  }
}
```

모든 필드는 선택 사항이다. 누락된 값은 `packages/ferrum-web/src/gameSpec.ts`의 기본값으로 채운다.

## 필드

| 경로 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `world.width` | positive number | `1600` | simulation world width |
| `world.height` | positive number | `960` | simulation world height |
| `player.speed` | positive number | `180` | player movement speed |
| `enemies.speed` | positive number | `72` | enemy movement speed |
| `enemies.spawnInterval` | positive number | `1.0` | enemy spawn interval in seconds |
| `enemies.behavior` | string enum | `"chase"` | enemy movement preset |
| `enemies.spawnPattern` | string enum | `"edge"` | enemy spawn position preset |
| `enemies.health` | positive number | `1` | enemy health points |
| `enemies.scoreReward` | positive integer | `1` | score added when an enemy dies |
| `weapons.bulletSpeed` | positive number | `360` | bullet movement speed |
| `weapons.cooldown` | positive number | `0.12` | fire cooldown in seconds |
| `weapons.lifetime` | positive number | `1.8` | bullet lifetime in seconds |
| `weapons.damage` | positive number | `1` | damage dealt by one bullet |
| `prefabs.player.width` | positive number | `36` | player sprite width and collider base |
| `prefabs.player.height` | positive number | `36` | player sprite height and collider base |
| `prefabs.player.animation.frames` | positive integer | `1` | horizontal sprite sheet frame count |
| `prefabs.player.animation.fps` | positive number | `0` | animation playback speed; ignored when frames is `1` |
| `prefabs.player.animation.columns` | positive integer | `1` | sprite sheet column count for state animation |
| `prefabs.player.animation.rows` | positive integer | `1` | sprite sheet row count for state animation |
| `prefabs.player.animation.states.idle.row` | non-negative integer | `0` | idle animation row |
| `prefabs.player.animation.states.idle.frames` | positive integer | `1` | idle animation frame count |
| `prefabs.player.animation.states.idle.fps` | positive number | `1` | idle animation playback speed |
| `prefabs.player.animation.states.move.row` | non-negative integer | idle row | moving animation row |
| `prefabs.player.animation.states.move.frames` | positive integer | idle frames | moving animation frame count |
| `prefabs.player.animation.states.move.fps` | positive number | idle fps | moving animation playback speed |
| `prefabs.enemy.width` | positive number | `24` | enemy sprite width and collider base |
| `prefabs.enemy.height` | positive number | `24` | enemy sprite height and collider base |
| `prefabs.enemy.animation.frames` | positive integer | `1` | horizontal sprite sheet frame count |
| `prefabs.enemy.animation.fps` | positive number | `0` | animation playback speed; ignored when frames is `1` |
| `prefabs.bullet.width` | positive number | `8` | bullet sprite width and collider base |
| `prefabs.bullet.height` | positive number | `8` | bullet sprite height and collider base |
| `prefabs.bullet.animation.frames` | positive integer | `1` | horizontal sprite sheet frame count |
| `prefabs.bullet.animation.fps` | positive number | `0` | animation playback speed; ignored when frames is `1` |

## Sprite Animation

Prefab animation supports two forms. The short form uses a single horizontal sprite sheet: `frames` is the number of equal-width frames across the texture, and `fps` is the playback speed. When `frames` is greater than `1`, `fps` must also be provided.

The state form uses `columns`, `rows`, and `states`. Currently supported states are `idle` and `move`. Rust selects `move` when the entity has velocity and otherwise selects `idle`; it then updates `Sprite.u0/u1/v0/v1` over time and TypeScript renders the resulting UV range from the existing render command buffer.

Single-image textures should omit `animation` or keep `frames` as `1`. If `frames` or `columns` is greater than `1`, the source image must contain matching equal-sized frames.

## Enemy Behavior

- `"chase"`: enemies move toward the player.
- `"drift"`: enemies move toward the world center.
- `"static"`: enemies stay still after spawning.

Behavior is validated in TypeScript and sent to Rust as a numeric code through `set_shooter_resolved_config(...)`.

## Enemy Spawn Pattern

- `"edge"`: enemies spawn around the world edges.
- `"corners"`: enemies spawn from the four world corners.
- `"center"`: enemies spawn from the world center.

Spawn pattern is validated in TypeScript and sent to Rust as a numeric code through `set_shooter_resolved_config(...)`.

## Combat

Enemy health, bullet damage, and score reward are validated in TypeScript and sent to Rust through `set_shooter_resolved_config(...)`.

- Bullets despawn on the first enemy hit.
- Enemies despawn only when health reaches `0` or below.
- Score is added only when an enemy dies.

## 검증

예제 spec 검증:

```bash
pnpm validate:game-spec
```

임의 파일 검증:

```bash
pnpm --filter @ferrum2d/ferrum-web build
node scripts/validate-game-spec.mjs path/to/game.json
```

검증기는 `resolveShooterGameSpec(...)`와 같은 경로를 사용하므로 브라우저 런타임과 CLI의 판정이 일치한다.

## Variant 생성

```bash
pnpm create:game-variant fast-enemies
```

출력 경로를 지정할 수도 있다.

```bash
pnpm create:game-variant drift-swarm /tmp/game.drift-swarm.json
```

지원 preset은 `scripts/create-game-variant.mjs`에서 관리한다.
