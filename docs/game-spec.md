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
    "scoreReward": 1,
    "orbit": { "radius": 180, "radialBand": 24 },
    "presets": {
      "runner": { "speed": 96, "behavior": "chase", "health": 1, "scoreReward": 1 },
      "bruiser": { "speed": 54, "behavior": "drift", "spawnPattern": "corners", "health": 3, "scoreReward": 4 },
      "orbiter": { "speed": 84, "behavior": "orbit", "health": 2, "scoreReward": 3 }
    },
    "waves": [
      { "enemy": "runner", "duration": 18, "spawnInterval": 0.85, "enemyCount": 18 },
      { "enemy": "bruiser", "duration": 16, "spawnInterval": 1.25, "enemyCount": 10, "spawnPattern": "corners" },
      { "enemy": "orbiter", "duration": 18, "spawnInterval": 1.1, "enemyCount": 12 }
    ]
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
    "bullet": { "frame": "bullet.default" }
  },
  "atlas": {
    "frames": {
      "bullet.default": {
        "texture": "bullet",
        "uv": { "u0": 0, "v0": 0, "u1": 1, "v1": 1 },
        "size": { "width": 8, "height": 8 }
      },
      "tiles.floor": {
        "texture": 0,
        "uv": { "u0": 0, "v0": 0, "u1": 1, "v1": 1 },
        "size": { "width": 160, "height": 160 }
      }
    }
  },
  "tilemap": {
    "tileWidth": 160,
    "tileHeight": 160,
    "tiles": {
      "1": { "frame": "tiles.floor", "color": [0.16, 0.22, 0.2, 0.42] }
    },
    "layers": [
      { "name": "arena-floor", "columns": 2, "rows": 2, "data": [1, 1, 1, 1] }
    ]
  },
  "camera": {
    "preset": "look-ahead",
    "lookAhead": { "distance": 96 },
    "deadZone": { "width": 160, "height": 96 },
    "shake": { "amplitude": 6, "frequency": 8 }
  },
  "audio": {
    "masterVolume": 1,
    "sfxVolume": 0.85,
    "events": {
      "shoot": { "volume": 0.28, "pitch": 1.05 },
      "hit": { "volume": 0.48, "pitch": 0.95 },
      "gameOver": { "volume": 0.7, "pitch": 0.8 }
    }
  }
}
```

모든 필드는 선택 사항이다. 누락된 값은 `packages/ferrum-web/src/gameSpec.ts`의 기본값으로 채운다. 위 예시는 player에 state animation을 적용하고 bullet과 tilemap은 atlas frame metadata를 통해 texture/UV/size를 받는 형태다. `prefabs.player`, `prefabs.enemy`, `prefabs.bullet`은 같은 animation 구조와 atlas frame binding을 지원한다.

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
| `enemies.orbit.radius` | positive number | `180` | target distance used by `"orbit"` behavior |
| `enemies.orbit.radialBand` | non-negative number | `24` | distance tolerance before orbit enemies correct inward/outward |
| `enemies.presets.*.speed` | positive number | `enemies.speed` | named enemy preset movement speed |
| `enemies.presets.*.behavior` | string enum | `enemies.behavior` | named enemy preset movement behavior |
| `enemies.presets.*.spawnPattern` | string enum | `enemies.spawnPattern` | named enemy preset spawn position |
| `enemies.presets.*.health` | positive number | `enemies.health` | named enemy preset health |
| `enemies.presets.*.scoreReward` | positive integer | `enemies.scoreReward` | named enemy preset score reward |
| `enemies.waves.*.enemy` | string | `"default"` | enemy preset name used by this wave |
| `enemies.waves.*.duration` | positive number | `20` | wave duration in seconds |
| `enemies.waves.*.spawnInterval` | positive number | preset interval | wave spawn interval in seconds |
| `enemies.waves.*.enemyCount` | positive integer | `12` | maximum enemies spawned by this wave before advancing |
| `enemies.waves.*.spawnPattern` | string enum | preset pattern | wave-specific spawn position override |
| `weapons.bulletSpeed` | positive number | `360` | bullet movement speed |
| `weapons.cooldown` | positive number | `0.12` | fire cooldown in seconds |
| `weapons.lifetime` | positive number | `1.8` | bullet lifetime in seconds |
| `weapons.damage` | positive number | `1` | damage dealt by one bullet |
| `prefabs.player.width` | positive number | `36` | player sprite width and collider base |
| `prefabs.player.height` | positive number | `36` | player sprite height and collider base |
| `prefabs.enemy.width` | positive number | `24` | enemy sprite width and collider base |
| `prefabs.enemy.height` | positive number | `24` | enemy sprite height and collider base |
| `prefabs.bullet.width` | positive number | `8` | bullet sprite width and collider base |
| `prefabs.bullet.height` | positive number | `8` | bullet sprite height and collider base |
| `prefabs.*.animation.frames` | positive integer | `1` | horizontal sprite sheet frame count |
| `prefabs.*.animation.fps` | positive number | `0` | animation playback speed; required when `frames` is greater than `1` |
| `prefabs.*.animation.columns` | positive integer | `1` | sprite sheet column count for state animation; required when `states` is used |
| `prefabs.*.animation.rows` | positive integer | `1` | sprite sheet row count for state animation; required when `states` is used |
| `prefabs.*.animation.states.idle.row` | non-negative integer | `0` | idle animation row; idle state is required when `states` is used |
| `prefabs.*.animation.states.idle.frames` | positive integer | `1` | idle animation frame count |
| `prefabs.*.animation.states.idle.fps` | positive number | `1` | idle animation playback speed |
| `prefabs.*.animation.states.move.row` | non-negative integer | idle row | moving animation row |
| `prefabs.*.animation.states.move.frames` | positive integer | idle frames | moving animation frame count |
| `prefabs.*.animation.states.move.fps` | positive number | idle fps | moving animation playback speed |
| `prefabs.*.frame` | string | unset | `atlas.frames`에 정의된 frame name |
| `atlas.frames.*.texture` | string or non-negative integer | required | texture manifest name 또는 numeric texture id |
| `atlas.frames.*.uv.u0` | number `0..1` | required | normalized UV left |
| `atlas.frames.*.uv.v0` | number `0..1` | required | normalized UV top |
| `atlas.frames.*.uv.u1` | number `0..1` | required | normalized UV right, `u0`보다 커야 한다 |
| `atlas.frames.*.uv.v1` | number `0..1` | required | normalized UV bottom, `v0`보다 커야 한다 |
| `atlas.frames.*.size.width` | positive number | required | frame display/collider base width |
| `atlas.frames.*.size.height` | positive number | required | frame display/collider base height |
| `tilemap.tileWidth` | positive number | `32` | default tile render width |
| `tilemap.tileHeight` | positive number | `32` | default tile render height |
| `tilemap.origin.x` | finite number | `0` | default tilemap world origin x |
| `tilemap.origin.y` | finite number | `0` | default tilemap world origin y |
| `tilemap.tiles.*.frame` | string | required | atlas frame used by this positive tile id |
| `tilemap.tiles.*.color` | `[r,g,b,a]` normalized numbers | `[1,1,1,1]` | tile tint color |
| `tilemap.layers.*.name` | string | `layer-{index}` | tile layer label for diagnostics/authoring |
| `tilemap.layers.*.columns` | positive integer | required | tile layer column count |
| `tilemap.layers.*.rows` | positive integer | required | tile layer row count |
| `tilemap.layers.*.tileWidth` | positive number | `tilemap.tileWidth` | layer-specific tile width |
| `tilemap.layers.*.tileHeight` | positive number | `tilemap.tileHeight` | layer-specific tile height |
| `tilemap.layers.*.origin.x` | finite number | `tilemap.origin.x` | layer-specific world origin x |
| `tilemap.layers.*.origin.y` | finite number | `tilemap.origin.y` | layer-specific world origin y |
| `tilemap.layers.*.collision` | boolean | `false` | `true`이면 양수 tile id를 player/enemy가 통과할 수 없는 정적 AABB 장애물이자 chase enemy navigation 장애물로 사용 |
| `tilemap.layers.*.data` | non-negative integer array | required | row-major tile id list; `0` means empty |
| `camera.preset` | string enum | `"follow"` | camera movement preset |
| `camera.deadZone.width` | non-negative number | `160` | dead-zone width in world units |
| `camera.deadZone.height` | non-negative number | `96` | dead-zone height in world units |
| `camera.lookAhead.distance` | non-negative number | `96` | look-ahead distance in velocity direction |
| `camera.shake.amplitude` | non-negative number | `6` | time-based shake amplitude in world units |
| `camera.shake.frequency` | positive number | `8` | time-based shake frequency in cycles per second |
| `audio.masterVolume` | non-negative number | `1` | Web Audio master bus volume |
| `audio.sfxVolume` | non-negative number | `1` | Web Audio SFX bus volume |
| `audio.events.shoot.volume` | non-negative number | `0.35` | shoot audio event volume |
| `audio.events.shoot.pitch` | positive number | `1` | shoot audio event pitch |
| `audio.events.hit.volume` | non-negative number | `0.45` | hit audio event volume |
| `audio.events.hit.pitch` | positive number | `1` | hit audio event pitch |
| `audio.events.gameOver.volume` | non-negative number | `0.65` | game over audio event volume |
| `audio.events.gameOver.pitch` | positive number | `0.9` | game over audio event pitch |

## Sprite Animation

Prefab animation supports two forms. The short form uses a single horizontal sprite sheet: `frames` is the number of equal-width frames across the texture, and `fps` is the playback speed. When `frames` is greater than `1`, `fps` must also be provided.

The state form uses `columns`, `rows`, and `states`. Currently supported states are `idle` and `move`. `idle` is required when `states` is present; `move` is optional and falls back to `idle`. Rust selects `move` when the entity has velocity and otherwise selects `idle`; it then updates `Sprite.u0/u1/v0/v1` over time and TypeScript renders the resulting UV range from the existing render command buffer.

Single-image textures should omit `animation` or keep `frames` as `1`. If `frames` or `columns` is greater than `1`, the source image must contain matching equal-sized frames.

## Texture Atlas Metadata

`atlas.frames`는 frame name을 texture/UV/size metadata로 매핑한다. `prefabs.*.frame`이 frame name을 참조하면 TypeScript가 frame 존재 여부, texture name/id, normalized UV rect, size를 검증하고 Rust에는 numeric texture id와 UV/size만 전달한다.

```json
{
  "atlas": {
    "frames": {
      "bullet.default": {
        "texture": "bullet",
        "uv": { "u0": 0, "v0": 0, "u1": 1, "v1": 1 },
        "size": { "width": 8, "height": 8 }
      }
    }
  },
  "prefabs": {
    "bullet": { "frame": "bullet.default" }
  }
}
```

`texture`가 string이면 runtime `createEngine()`이 연결된 `AssetHost.textureId(name)`으로 id를 해석한다. CLI `pnpm validate:game-spec`는 texture name 형식과 frame 참조까지만 검증하고 실제 asset loading은 브라우저 runtime에서 확인한다. `texture`에 numeric id를 직접 넣을 수도 있지만, 예제와 일반 사용 경로에서는 asset manifest name을 권장한다.

현재 atlas frame binding은 static frame용이다. 같은 prefab에 `frame`과 `animation`을 동시에 지정하면 TypeScript 검증에서 실패한다. 기존 horizontal sprite sheet animation은 그대로 사용할 수 있으며, atlas 기반 animation binding은 별도 단계에서 확장한다.

## Tilemap Runtime

`tilemap`은 정적 tile layer를 렌더링하고 선택적으로 단순 AABB 장애물을 만들기 위한 설정이다. TypeScript는 positive tile id, atlas frame 참조, tint color, layer 크기, `collision` boolean, row-major `data` 길이와 tile id 참조를 검증한다. Rust에는 tile id, texture id, UV, color, layer dimension, tile size, origin, collision flag, `Uint32Array` tile data만 전달된다.

```json
{
  "atlas": {
    "frames": {
      "tiles.floor": {
        "texture": 0,
        "uv": { "u0": 0, "v0": 0, "u1": 1, "v1": 1 },
        "size": { "width": 32, "height": 32 }
      }
    }
  },
  "tilemap": {
    "tileWidth": 32,
    "tileHeight": 32,
    "tiles": {
      "1": { "frame": "tiles.floor", "color": [0.2, 0.3, 0.25, 1] }
    },
    "layers": [
      { "name": "floor", "columns": 4, "rows": 2, "data": [1, 1, 0, 1, 1, 0, 1, 1] },
      { "name": "walls", "columns": 4, "rows": 2, "collision": true, "data": [0, 0, 1, 0, 0, 1, 0, 0] }
    ]
  }
}
```

`tilemap.tiles`의 key는 positive integer string이어야 한다. `0`은 빈 타일로 예약되어 layer data에서만 사용할 수 있다. `collision: true` layer의 양수 tile은 player/enemy 이동을 막는 정적 AABB로 해석되며, chase enemy는 같은 collision layer를 4방향 grid navigation 장애물로 사용한다. Navigation v1은 Rust core 내부에서 계산되며 새 Game Spec 필드를 추가하지 않는다. bullet-wall 충돌, 자동 타일링, editor, per-tile script, navmesh, crowd simulation은 포함하지 않는다.

## Enemy Behavior

- `"chase"`: enemies move toward the player. `collision: true` tilemap layer가 있으면 Rust navigation grid의 다음 waypoint를 향해 이동하고, 경로가 없으면 기존처럼 player를 직접 추적한다.
- `"drift"`: enemies move toward the world center.
- `"static"`: enemies stay still after spawning.
- `"orbit"`: enemies circle around the player with radial correction based on `enemies.orbit.radius` and `enemies.orbit.radialBand`. navigation grid를 사용하지 않는다.

Behavior and global orbit tuning are validated in TypeScript and sent to Rust as numeric values through `set_shooter_resolved_config(...)`.

## Enemy Spawn Pattern

- `"edge"`: enemies spawn around the world edges.
- `"corners"`: enemies spawn from the four world corners.
- `"center"`: enemies spawn from the world center.

Spawn pattern is validated in TypeScript and sent to Rust as a numeric code through `set_shooter_resolved_config(...)`.

## Enemy Wave Spec

`enemies.presets`는 이름이 붙은 enemy 설정 묶음이다. 각 preset은 speed, behavior, spawnPattern, health, scoreReward를 부분적으로 덮어쓸 수 있고 누락된 값은 `enemies.*` 기본값을 따른다. `default` preset은 항상 `enemies.*` 값으로 생성된다.

`enemies.waves`가 있으면 Rust `ShooterScene`이 wave 진행 상태, spawn timer, wave별 spawn count를 소유한다. TypeScript는 wave와 preset 이름을 검증한 뒤 `set_shooter_wave(...)`로 duration, spawnInterval, enemyCount, enemySpeed, behavior code, spawnPattern code, health, scoreReward 숫자만 전달한다. 모든 wave가 끝나면 첫 wave부터 반복된다.

## Combat

Enemy health, bullet damage, score reward, and global orbit tuning are validated in TypeScript and sent to Rust through `set_shooter_resolved_config(...)`.

- Bullets despawn on the first enemy hit.
- Enemies despawn only when health reaches `0` or below.
- Score is added only when an enemy dies.

## Camera Preset

Camera preset은 TypeScript에서 검증한 뒤 `set_shooter_camera_preset(...)`로 numeric code와 수치만 Rust에 전달한다. 프레임 중 카메라 위치 계산은 Rust core가 담당한다.

- `"follow"`: camera center가 player 위치를 직접 따라간다.
- `"dead-zone"`: player가 camera 중심 주변 dead-zone을 벗어날 때만 camera가 이동한다.
- `"look-ahead"`: player velocity 방향으로 `camera.lookAhead.distance`만큼 앞을 본다.
- `"shake"`: player-follow 위치에 시간 기반 sine/cosine offset을 더한다.

`camera.deadZone`, `camera.lookAhead`, `camera.shake` 값은 해당 preset에서만 사용되지만, 같은 spec 안에 함께 둘 수 있다. 예제 기본 spec은 `"look-ahead"`를 사용한다.

## Audio Policy

`audio.masterVolume`과 `audio.sfxVolume`은 `BrowserPlatformHost`가 `AudioManager` bus volume으로 적용한다. `audio.events.*`는 Rust audio event buffer에 들어갈 volume/pitch 기본값을 정한다. 브라우저 autoplay 제한은 `AudioManager.unlock()` 또는 예제의 첫 key/pointer 입력 unlock 경로로 처리한다.

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
