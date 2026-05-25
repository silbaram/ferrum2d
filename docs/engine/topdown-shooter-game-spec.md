# Top-down Shooter Game Spec

이 문서는 Ferrum2D 엔진 전체의 범용 설정 포맷이 아니라, 공식 Top-down Shooter 예제의 데이터 설정 계약을 설명한다. 실제 기준 파일은 `examples/topdown-shooter/public/game.json`이고, 검증/기본값/적용 로직의 코드 기준은 `packages/ferrum-web/src/gameSpec.ts`다.

AI agent는 가능한 한 이 파일을 수정해서 shooter 변형을 만들고, Rust/TypeScript 코드는 검증기나 엔진 기능이 부족할 때만 변경한다.

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
  },
  "physics": {
    "mode": "arcade",
    "solver": {
      "fixedTimestep": false
    }
  }
}
```

모든 필드는 선택 사항이다. 누락된 값은 `packages/ferrum-web/src/gameSpec.ts`의 기본값으로 채운다. 위 예시는 player에 state animation을 적용하고 bullet과 tilemap은 atlas frame metadata를 통해 texture/UV/size를 받는 형태다. 실제 예제 `game.json`은 10x6 tilemap에 `floor`, `panel`, `accent`, `block` tile과 `collision: true` obstacle layer를 포함한다. `prefabs.player`, `prefabs.enemy`, `prefabs.bullet`은 같은 animation 구조, atlas frame binding, AABB/circle/capsule/oriented-box/convex-polygon collider metadata를 지원한다.

`schemas/shooter-game-spec.schema.json`은 편집기와 authoring 도구를 위한 구조 보조 schema다. 런타임/CLI에서 최종 판정에 쓰는 기준은 `resolveShooterGameSpec(...)`이며, atlas frame 참조, tile id 참조, `u1 > u0`, layer data 길이처럼 교차 필드 검증은 TypeScript validator를 기준으로 한다.

`physics` namespace는 Top-down Shooter 전용 설정이 아니라 범용 [Physics Spec](physics-spec.md) 계약이다. 예제는 built-in shooter scene의 현재 동작을 유지하기 위해 `"arcade"` mode와 `fixedTimestep: false`를 명시한다.

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
| `prefabs.player.width` | positive number | `36` | player sprite width and default collider base |
| `prefabs.player.height` | positive number | `36` | player sprite height and default collider base |
| `prefabs.enemy.width` | positive number | `24` | enemy sprite width and default collider base |
| `prefabs.enemy.height` | positive number | `24` | enemy sprite height and default collider base |
| `prefabs.bullet.width` | positive number | `8` | bullet sprite width and default collider base |
| `prefabs.bullet.height` | positive number | `8` | bullet sprite height and default collider base |
| `prefabs.*.collider.type` | string enum | `"aabb"` | collider shape: `"aabb"`, `"circle"`, `"capsule"`, `"orientedBox"`, `"convexPolygon"` |
| `prefabs.*.collider.halfWidth` | positive number | display width / 2 | AABB collider half width |
| `prefabs.*.collider.halfHeight` | positive number | display height / 2 | AABB collider half height |
| `prefabs.*.collider.radius` | positive number | shape dependent | circle/capsule radius |
| `prefabs.*.collider.start.x` | finite number | required for capsule | capsule segment start local x |
| `prefabs.*.collider.start.y` | finite number | required for capsule | capsule segment start local y |
| `prefabs.*.collider.end.x` | finite number | required for capsule | capsule segment end local x |
| `prefabs.*.collider.end.y` | finite number | required for capsule | capsule segment end local y |
| `prefabs.*.collider.rotationRadians` | finite number | `0` | oriented-box 또는 convex-polygon local rotation |
| `prefabs.*.collider.vertices` | point array | required for convexPolygon | 3-16 convex polygon local vertices |
| `prefabs.*.collider.offset.x` | finite number | `0` | collider local x offset from entity transform |
| `prefabs.*.collider.offset.y` | finite number | `0` | collider local y offset from entity transform |
| `prefabs.*.collider.enabled` | boolean | `true` | whether this prefab collider participates in collision/query paths |
| `prefabs.*.collider.trigger` | boolean | `true` | whether this prefab collider is trigger-only |
| `prefabs.*.collider.material.restitution` | non-negative number | `0` | collider material restitution override |
| `prefabs.*.collider.material.friction` | non-negative number | `0.4` | collider material friction override |
| `prefabs.*.collider.material.surfaceVelocity.x` | finite number | `0` | collider material tangent surface velocity x |
| `prefabs.*.collider.material.surfaceVelocity.y` | finite number | `0` | collider material tangent surface velocity y |
| `prefabs.*.collider.material.density` | positive number | `1` | collider material density metadata |
| `prefabs.*.collider.material.contactBaumgarteBiasScale` | non-negative number | `1` | material-specific Baumgarte bias scale |
| `prefabs.*.collider.material.maxContactBaumgarteBiasVelocityScale` | non-negative number | `1` | material-specific max Baumgarte bias velocity scale |
| `prefabs.*.collider.material.contactPositionCorrectionScale` | non-negative number | `1` | material-specific split position correction scale |
| `prefabs.*.collider.material.contactPositionCorrectionSlopScale` | non-negative number | `1` | material-specific position correction slop scale |
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
| `prefabs.*.animation.atlas.idle.frames` | string array | required | idle atlas animation frame names from `atlas.frames`; max 32 |
| `prefabs.*.animation.atlas.idle.fps` | positive number | required | idle atlas animation playback speed |
| `prefabs.*.animation.atlas.move.frames` | string array | idle frames | moving atlas animation frame names from `atlas.frames`; max 32 |
| `prefabs.*.animation.atlas.move.fps` | positive number | idle fps | moving atlas animation playback speed |
| `prefabs.*.frame` | string | unset | `atlas.frames`에 정의된 frame name |
| `atlas.frames.*.texture` | string or non-negative integer | required | texture manifest name 또는 numeric texture id |
| `atlas.frames.*.uv.u0` | number `0..1` | required | normalized UV left |
| `atlas.frames.*.uv.v0` | number `0..1` | required | normalized UV top |
| `atlas.frames.*.uv.u1` | number `0..1` | required | normalized UV right, `u0`보다 커야 한다 |
| `atlas.frames.*.uv.v1` | number `0..1` | required | normalized UV bottom, `v0`보다 커야 한다 |
| `atlas.frames.*.size.width` | positive number | required | frame display width and default collider base width |
| `atlas.frames.*.size.height` | positive number | required | frame display height and default collider base height |
| `tilemap.tileWidth` | positive number | `32` | default tile render width |
| `tilemap.tileHeight` | positive number | `32` | default tile render height |
| `tilemap.origin.x` | finite number | `0` | default tilemap world origin x |
| `tilemap.origin.y` | finite number | `0` | default tilemap world origin y |
| `tilemap.tiles.*.frame` | string | required | atlas frame used by this positive tile id |
| `tilemap.tiles.*.color` | `[r,g,b,a]` normalized numbers | `[1,1,1,1]` | tile tint color |
| `tilemap.tiles.*.slope` | object | unset | tile-local slope segment descriptor used by Rust `TileSlopeDefinition` |
| `tilemap.tiles.*.slope.x0/y0/x1/y1` | normalized number | required when `slope` is set | tile-local segment endpoints; `x1` must differ from `x0` |
| `tilemap.tiles.*.oneWayPlatform` | boolean | `false` | 위에서 내려오는 tilemap movement/ground probe만 막는 one-way platform tile 표시 |
| `tilemap.layers.*.name` | string | `layer-{index}` | tile layer label for diagnostics/authoring |
| `tilemap.layers.*.columns` | positive integer | required | tile layer column count |
| `tilemap.layers.*.rows` | positive integer | required | tile layer row count |
| `tilemap.layers.*.tileWidth` | positive number | `tilemap.tileWidth` | layer-specific tile width |
| `tilemap.layers.*.tileHeight` | positive number | `tilemap.tileHeight` | layer-specific tile height |
| `tilemap.layers.*.origin.x` | finite number | `tilemap.origin.x` | layer-specific world origin x |
| `tilemap.layers.*.origin.y` | finite number | `tilemap.origin.y` | layer-specific world origin y |
| `tilemap.layers.*.collision` | boolean | `false` | `true`이면 양수 tile id를 player/enemy가 통과할 수 없는 정적 AABB 장애물이자 chase enemy navigation 장애물로 사용 |
| `tilemap.layers.*.collisionOnly` | boolean | `false` | 렌더 tile definition 없이 양수 solid id를 허용하는 collision-only layer |
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
| `physics.mode` | string enum | `"arcade"` | 범용 physics mode: `"none"`, `"arcade"`, `"rigid"` |
| `physics.solver.fixedTimestep` | boolean | mode default | physics mode가 fixed timestep을 적용할지 여부 |
| `physics.solver.stepSeconds` | positive number | `1/60` | fixed timestep step seconds |
| `physics.gravity` | `[x, y]` | mode default | generic physics world gravity |
| `physics.materials/layers/bodies/joints` | object maps | `{}` | 범용 physics authoring metadata. 세부 구조는 [Physics Spec](physics-spec.md)에 둔다. |

## Sprite Animation

Prefab animation supports three forms. The short form uses a single horizontal sprite sheet: `frames` is the number of equal-width frames across the texture, and `fps` is the playback speed. When `frames` is greater than `1`, `fps` must also be provided.

The state form uses `columns`, `rows`, and `states`. Currently supported states are `idle` and `move`. `idle` is required when `states` is present; `move` is optional and falls back to `idle`. Rust selects `move` when the entity has velocity and otherwise selects `idle`; it then updates `Sprite.u0/u1/v0/v1` over time and TypeScript renders the resulting UV range from the existing render command buffer.

The atlas form uses `animation.atlas.idle.frames` and optional `animation.atlas.move.frames` to reference named `atlas.frames`. TypeScript resolves frame names and sends packed UV buffers to Rust once at Game Spec application time. Rust owns per-frame animation state and writes UVs into the existing render command buffer. All frames in one atlas animation must use the same texture and size, and each state can contain at most 32 frames.

```json
{
  "atlas": {
    "frames": {
      "player.idle.0": {
        "texture": "sprites",
        "uv": { "u0": 0, "v0": 0, "u1": 0.25, "v1": 0.5 },
        "size": { "width": 16, "height": 24 }
      },
      "player.move.0": {
        "texture": "sprites",
        "uv": { "u0": 0, "v0": 0.5, "u1": 0.25, "v1": 1 },
        "size": { "width": 16, "height": 24 }
      },
      "player.move.1": {
        "texture": "sprites",
        "uv": { "u0": 0.25, "v0": 0.5, "u1": 0.5, "v1": 1 },
        "size": { "width": 16, "height": 24 }
      }
    }
  },
  "prefabs": {
    "player": {
      "animation": {
        "atlas": {
          "idle": { "frames": ["player.idle.0"], "fps": 1 },
          "move": { "frames": ["player.move.0", "player.move.1"], "fps": 8 }
        }
      }
    }
  }
}
```

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

## Prefab Collider Metadata

`prefabs.player`, `prefabs.enemy`, `prefabs.bullet`은 선택적 `collider` object로 AABB/circle/capsule/oriented-box/convex-polygon collider shape, local offset, enable flag, trigger flag, collider material override를 지정할 수 있다. `collider.type`이 없으면 `"aabb"`로 해석한다. `collider`가 없으면 display size 또는 atlas frame size의 절반을 AABB half extents 기본값으로 사용하고, offset은 `(0, 0)`, enabled/trigger는 `true`가 된다.

```json
{
  "prefabs": {
    "player": {
      "width": 36,
      "height": 36,
      "collider": {
        "type": "aabb",
        "halfWidth": 14,
        "halfHeight": 16,
        "offset": { "x": 0, "y": 2 },
        "enabled": true,
        "trigger": true,
        "material": {
          "restitution": 0,
          "friction": 0.5,
          "surfaceVelocity": { "x": 0, "y": 0 },
          "density": 1,
          "contactBaumgarteBiasScale": 1,
          "maxContactBaumgarteBiasVelocityScale": 1,
          "contactPositionCorrectionScale": 1,
          "contactPositionCorrectionSlopScale": 1
        }
      }
    }
  }
}
```

Circle collider는 `radius`를 사용한다. `radius`가 없으면 display size 또는 atlas frame size의 짧은 변 절반을 기본값으로 사용한다.

```json
{
  "prefabs": {
    "bullet": {
      "width": 8,
      "height": 8,
      "collider": {
        "type": "circle",
        "radius": 4,
        "trigger": true
      }
    }
  }
}
```

Capsule collider는 local `start`, `end`, `radius`를 모두 명시해야 한다. Oriented box는 `halfWidth`, `halfHeight`, `rotationRadians`를 사용하며, half extents와 rotation은 AABB 기본값 및 `0`으로 fallback된다. Convex polygon은 3개 이상 16개 이하의 local vertex와 optional `rotationRadians`를 사용한다.

```json
{
  "prefabs": {
    "enemy": {
      "width": 32,
      "height": 28,
      "collider": {
        "type": "capsule",
        "start": { "x": -10, "y": 0 },
        "end": { "x": 10, "y": 0 },
        "radius": 9
      }
    },
    "player": {
      "width": 36,
      "height": 36,
      "collider": {
        "type": "orientedBox",
        "halfWidth": 12,
        "halfHeight": 16,
        "rotationRadians": 0.35
      }
    }
  }
}
```

TypeScript는 shape별 치수를 positive finite number로, `offset`, `rotationRadians`, vertex 좌표와 `material.surfaceVelocity`를 finite number로, material density를 positive finite number로 검증한다. 나머지 material tuning scale은 non-negative finite number여야 한다. Rust에는 Game Spec 적용 시 shape별 `set_shooter_prefab_*_collider(...)`로 prefab code와 숫자/boolean/material/vertex 값만 전달되며, 기존 player/enemy/bullet entity와 이후 spawn되는 entity template에 같은 collider metadata가 적용된다.

현재 Game Spec collider metadata는 Top-down Shooter prefab collider 범위다. Generic rigid body/joint authoring metadata, compound collider authoring, per-frame collider streaming은 포함하지 않는다.

### Aseprite Metadata Import

Product Beta Asset pipeline v2의 첫 범위는 Aseprite JSON export를 `atlas.frames`로 변환하는 TypeScript authoring helper다. `importAsepriteAtlasFrames(...)`는 hash/array 형식의 Aseprite `frames`, `meta.size`, 각 frame rect를 읽어 normalized UV와 frame size를 만든다.

```ts
import { importAsepriteAtlasFrames, type ShooterGameSpec } from "@ferrum2d/ferrum-web";

const loaded = await engine.loadAssets({
  textures: { sprites: "/assets/sprites.png" },
  json: { sprites: "/assets/sprites.json" },
});

const spec: ShooterGameSpec = {
  atlas: {
    frames: importAsepriteAtlasFrames(loaded.json.sprites, {
      texture: "sprites",
      frameNamePrefix: "player.",
    }),
  },
  prefabs: {
    player: { frame: "player.idle.0" },
  },
};
```

기본적으로 파일 확장자는 frame name에서 제거된다. rotated frame은 현재 `SpriteRenderCommand`와 prefab 계약에서 표현할 수 없으므로 진단 오류로 거부한다. trimmed frame의 원본 크기를 display/collider 기준으로 쓰려면 `sizeSource: "source"`를 지정한다.

같은 prefab에 static `frame`과 `animation`을 동시에 지정하면 TypeScript 검증에서 실패한다. 기존 horizontal sprite sheet animation과 state animation은 그대로 사용할 수 있으며, atlas animation은 `animation.atlas`만 단독으로 사용한다.

## Tilemap Runtime

`tilemap`은 정적 tile layer를 렌더링하고 선택적으로 단순 AABB 장애물, tile-local slope descriptor, one-way platform tile을 만들기 위한 설정이다. TypeScript는 positive tile id, atlas frame 참조, tint color, slope endpoint, one-way flag, layer 크기, `collision` boolean, row-major `data` 길이와 tile id 참조를 검증한다. Rust에는 tile id, texture id, UV, color, slope endpoint, one-way tile id, layer dimension, tile size, origin, collision flag, `Uint32Array` tile data만 전달된다.

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
      "1": { "frame": "tiles.floor", "color": [0.2, 0.3, 0.25, 1] },
      "2": { "frame": "tiles.floor", "slope": { "x0": 0, "y0": 1, "x1": 1, "y1": 0 } },
      "3": { "frame": "tiles.floor", "oneWayPlatform": true }
    },
    "layers": [
      { "name": "floor", "columns": 4, "rows": 2, "data": [1, 1, 0, 1, 1, 0, 1, 1] },
      { "name": "walls", "columns": 4, "rows": 2, "collision": true, "data": [0, 0, 3, 0, 0, 2, 0, 0] }
    ]
  }
}
```

`tilemap.tiles`의 key는 positive integer string이어야 한다. `0`은 빈 타일로 예약되어 layer data에서만 사용할 수 있다. 일반 layer의 양수 tile id는 `tilemap.tiles`에 존재해야 렌더링할 수 있다. `collisionOnly: true` layer는 반드시 `collision: true`여야 하며, 양수 tile id가 `tilemap.tiles`에 없어도 렌더링하지 않는 solid cell로 허용한다. 이 경로는 LDtk raw `IntGrid`처럼 충돌 그리드만 있는 데이터를 표현하기 위한 것이다. `collision: true` layer의 양수 tile은 player/enemy 이동을 막는 정적 AABB로 해석되고, Rust는 인접 solid tile run을 merged AABB obstacle로 캐시해 충돌 후보 검사를 줄인다. 런타임 단일 cell 변경은 Game Spec 필드가 아니라 `FerrumEngine.setShooterTilemapTile(...)` API로 수행하며, collision layer 변경 시 Rust가 해당 cache를 즉시 refresh한다. 단, `tilemap.tiles.*.slope`가 정의된 tile id는 Rust `TileSlopeDefinition`으로 등록되고 merged AABB solid에서는 제외된다. `tilemap.tiles.*.oneWayPlatform: true`가 정의된 tile id도 merged AABB solid에서는 제외되고, 위에서 내려오는 swept movement와 ground probe만 막는다. `slope`와 `oneWayPlatform: true`는 같은 tile definition에 함께 사용할 수 없다. slope endpoint는 tile-local normalized 좌표이며 `x1`은 `x0`와 달라야 한다. chase enemy는 같은 collision layer의 원본 tile grid를 4방향 navigation 장애물로 사용한다. Navigation v1은 Rust core 내부에서 계산되며 새 Game Spec 필드를 추가하지 않는다. bullet-wall 충돌, 자동 타일링, editor, per-tile script, navmesh, crowd simulation은 포함하지 않는다.

`extractTilemapBoundaryChains(...)`는 resolved tilemap의 `collision: true` layer를 generic Physics Spec의 static `chain` body map으로 변환하는 helper다. 이 helper는 Game Spec 필드가 아니며, slope/one-way tile은 regular solid boundary에서 제외한다. `PixelMaskTerrain`은 alpha mask를 collision-only tilemap layer로 변환한 뒤 같은 chain boundary 추출 경로를 재사용할 수 있다.

### Tiled JSON Import

`importTiledGameSpec(...)`는 Tiled finite orthogonal JSON map을 Game Spec `atlas`/`tilemap` 조각으로 변환한다. embedded tileset image metadata를 frame UV로 바꾸고, tile layer `data`의 global tile id를 그대로 Game Spec tile id로 사용한다.

```ts
import { importTiledGameSpec } from "@ferrum2d/ferrum-web";

const tiled = importTiledGameSpec(loaded.json.map, {
  collisionLayerNames: ["walls"],
});

const spec: ShooterGameSpec = {
  atlas: { frames: { ...tiled.atlas?.frames } },
  tilemap: tiled.tilemap,
};
```

지원 범위:

- `orientation: "orthogonal"`
- finite map과 finite `tilelayer`
- embedded tileset image metadata: `firstgid`, `name`, `tilewidth`, `tileheight`, `columns`, `tilecount`, `imagewidth`, `imageheight`
- `data: number[]` tile layer
- Tiled custom property `collision: true` 또는 `collisionLayerNames` 옵션을 통한 collision layer 지정
- embedded tileset `tiles.*.properties`의 `slopeX0`, `slopeY0`, `slopeX1`, `slopeY1` numeric custom property를 통한 Game Spec `tilemap.tiles.*.slope` 생성
- embedded tileset `tiles.*.properties`의 `oneWayPlatform: true` boolean custom property를 통한 Game Spec `tilemap.tiles.*.oneWayPlatform` 생성

현재 제외 범위:

- external `.tsx` tileset source 자동 로딩
- infinite/chunked map
- base64/compressed layer data
- flipped/rotated tile gid
- object layer, image layer, per-tile script, Wang/autotile metadata

### LDtk JSON Import

`importLDtkGameSpec(...)`는 LDtk project JSON의 embedded level 또는 `externalLevels` 옵션으로 전달한 external `.ldtkl` level을 Game Spec `atlas`/`tilemap` 조각으로 변환한다. LDtk tileset definition의 pixel metadata를 frame UV로 바꾸고, `Tiles`/`AutoLayer` layer의 tile instances를 row-major tile layer data로 변환한다.

```ts
import { importLDtkGameSpec } from "@ferrum2d/ferrum-web";

const ldtk = importLDtkGameSpec(loaded.json.world, {
  levelIdentifier: "Level_0",
  collisionLayerNames: ["walls"],
});

const spec: ShooterGameSpec = {
  atlas: { frames: { ...ldtk.atlas?.frames } },
  tilemap: ldtk.tilemap,
};
```

지원 범위:

- LDtk project JSON 안에 `layerInstances`가 포함된 embedded level
- 앱이 미리 로드해 `externalLevels[externalRelPath]`로 전달한 external `.ldtkl` level
- `levelIdentifier`, `levelIid`, `levelIndex` 중 하나를 통한 level 선택
- LDtk `Tiles`, `AutoLayer`, rendered `IntGrid` auto tiles
- `collisionLayerNames`에 포함된 raw `IntGrid`의 `intGridCsv`를 Game Spec `collisionOnly: true` layer로 변환
- tileset definition: `uid`, `identifier`, `tileGridSize`, `pxWid`, `pxHei`, `padding`, `spacing`, `relPath`
- `collisionLayerNames` 옵션을 통한 collision layer 지정
- `frameNameForTile`과 `texture` callback을 통한 frame/texture name 조정
- tileset `customData`의 JSON 문자열 `{"slope":{"x0":0,"y0":1,"x1":1,"y1":0}}`를 통한 Game Spec `tilemap.tiles.*.slope` 생성
- tileset `customData`의 JSON 문자열 `{"oneWayPlatform":true}`를 통한 Game Spec `tilemap.tiles.*.oneWayPlatform` 생성

현재 제외 범위:

- external `.ldtkl` level 자동 fetch/loading
- 한 grid cell에 여러 tile이 쌓인 LDtk tile stack
- flipped tile
- entity layer, field instance, rule metadata, per-tile script

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

JSON Schema는 구조 검토와 편집기 보조용으로 유지한다. 새 필드를 추가할 때는 `schemas/shooter-game-spec.schema.json`도 갱신하되, 실제 기본값과 오류 메시지는 TypeScript validator에 맞춘다.

## Variant 생성

```bash
pnpm create:game-variant fast-enemies
```

출력 경로를 지정할 수도 있다.

```bash
pnpm create:game-variant drift-swarm /tmp/game.drift-swarm.json
```

현재 지원 preset은 `fast-enemies`, `drift-swarm`, `static-targets`, `orbit-ring`이며 `scripts/create-game-variant.mjs`에서 관리한다.
