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
| `weapons.projectileArc.enabled` | boolean | `false` | bullet height span을 시간에 따라 갱신하는 HD-2D projectile arc 활성화 |
| `weapons.projectileArc.launchHeight` | non-negative number | `0` | 발사 시 bullet base elevation 위의 시작 높이 |
| `weapons.projectileArc.zVelocity` | finite number | `0` | projectile height velocity |
| `weapons.projectileArc.gravity` | non-negative number | `0` | projectile height velocity에 적용할 중력 |
| `weapons.projectileArc.hitHeight` | non-negative number | `0` | bullet hitbox로 사용할 height span 높이 |
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
| `tilemap.tiles.*.floor` | string | `"default"` | HD-2D tile floor id. Runtime에서는 deterministic numeric `floorId`로 변환된다. |
| `tilemap.tiles.*.elevation` | finite number | `0` | HD-2D tile surface elevation |
| `tilemap.tiles.*.height` | non-negative number | `physics.hd2d.defaultHeight` when HD-2D is enabled, otherwise `0` | HD-2D tile obstacle/query height |
| `tilemap.tiles.*.kind` | `flat`, `stair`, `ramp`, `ledge`, `bridge` | `flat` | HD-2D tile authoring kind. `moveHd2dKinematicBodyWithTilemap(...)`에서 step/ramp/ledge/bridge 이동 semantics로 소비된다. |
| `tilemap.tiles.*.ramp.axis` | `x` or `y` | `x` | `kind: "ramp"` tile의 elevation 보간 축 metadata |
| `tilemap.tiles.*.ramp.startElevation` | finite number | tile `elevation` | ramp 시작 elevation metadata |
| `tilemap.tiles.*.ramp.endElevation` | finite number | tile `elevation` | ramp 끝 elevation metadata |
| `tilemap.tiles.*.blocksMovement` | boolean | `true` | `false`이면 양수 collision layer tile이어도 Rust tile obstacle/cache/navigation/boundary extraction에서 이동 장애물로 쓰지 않는다. |
| `tilemap.tiles.*.bridgePortal.lowerFloor` | string | tile `floor` | `kind: "bridge"` tile의 아래 floor id |
| `tilemap.tiles.*.bridgePortal.upperFloor` | string | `"bridge"` | `kind: "bridge"` tile의 위 floor id |
| `tilemap.tiles.*.bridgePortal.lowerElevation` | finite number | tile `elevation` | bridge portal 아래 floor elevation |
| `tilemap.tiles.*.bridgePortal.upperElevation` | finite number | tile `elevation + height` | bridge portal 위 floor elevation |
| `tilemap.tiles.*.bridgePortal.navigationCost` | non-negative integer | `1` | lower/upper floor edge를 이동할 때 사용할 navigation cost |
| `tilemap.tiles.*.blocksProjectile` | boolean | `blocksMovement` | bullet-tile 충돌에서 `heightSpan`과 함께 소비하는 투사체 차단 metadata |
| `tilemap.tiles.*.blocksVision` | boolean | `blocksMovement` | `deriveHd2dTileOccludersFromTilemapGrid(...)`가 lighting occluder 입력으로 변환하는 시야 차단 metadata |
| `tilemap.tiles.*.occluderHeight` | non-negative number | tile `height` | lighting occluder rect 높이에 더하는 HD-2D 높이 metadata |
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

`tilemap`은 정적 tile layer를 렌더링하고 선택적으로 단순 AABB 장애물, HD-2D floor/elevation/height metadata, tile-local slope descriptor, one-way platform tile을 만들기 위한 설정이다. TypeScript는 positive tile id, atlas frame 참조, tint color, HD-2D height metadata, slope endpoint, one-way flag, layer 크기, `collision` boolean, row-major `data` 길이와 tile id 참조를 검증한다. Rust에는 tile id, texture id, UV, color, optional tile height span, slope endpoint, one-way tile id, layer dimension, tile size, origin, collision flag, `Uint32Array` tile data만 전달된다.

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

`tilemap.tiles`의 key는 positive integer string이어야 한다. `0`은 빈 타일로 예약되어 layer data에서만 사용할 수 있다. 일반 layer의 양수 tile id는 `tilemap.tiles`에 존재해야 렌더링할 수 있다. `collisionOnly: true` layer는 반드시 `collision: true`여야 하며, 양수 tile id가 `tilemap.tiles`에 없어도 렌더링하지 않는 solid cell로 허용한다. 이 경로는 LDtk raw `IntGrid`처럼 충돌 그리드만 있는 데이터를 표현하기 위한 것이다. `collision: true` layer의 양수 tile은 player/enemy 이동을 막는 정적 AABB로 해석되고, Rust는 인접 solid tile run을 merged AABB obstacle로 캐시해 충돌 후보 검사를 줄인다. Height span이 다른 solid tile은 같은 run으로 병합하지 않아서 explicit tile query filter가 층/고도를 유지한다. 런타임 단일 cell 변경은 Game Spec 필드가 아니라 `FerrumEngine.setShooterTilemapTile(...)` API로 수행하며, collision layer 변경 시 Rust가 해당 cache를 즉시 refresh한다. Tile height span metadata는 `FerrumEngine.setShooterTileHeightSpan(...)` / `clearShooterTileHeightSpan(...)`로 낮은 빈도 runtime 변경이 가능하다. Rect edit은 `maxCollisionRebuildChunks` 옵션으로 dirty collision chunk budget을 넘는 변경을 거부할 수 있다. 단, `tilemap.tiles.*.slope`가 정의된 tile id는 Rust `TileSlopeDefinition`으로 등록되고 merged AABB solid에서는 제외된다. `tilemap.tiles.*.oneWayPlatform: true`가 정의된 tile id도 merged AABB solid에서는 제외되고, 위에서 내려오는 swept movement와 ground probe만 막는다. `slope`와 `oneWayPlatform: true`는 같은 tile definition에 함께 사용할 수 없다. slope endpoint는 tile-local normalized 좌표이며 `x1`은 `x0`와 달라야 한다. chase enemy는 같은 collision layer의 원본 tile grid를 4방향 navigation 장애물로 사용한다. 낮은 빈도 gameplay/tooling query는 `FerrumEngine.queryTilemapNavigationWaypoint(...)`와 `FerrumEngine.queryTilemapNavigationPath(...)`를 사용하고, 두 query는 optional `heightSpan`이 지정되면 해당 span과 겹치는 solid tile만 장애물로 취급한다. `toHeightSpan`을 함께 지정하면 bridge portal lower/upper floor edge를 포함한 multi-floor path를 반환하며 path point는 `x`, `y`, `heightSpan`을 포함한다. runtime terrain weight는 `FerrumEngine.setShooterTilemapNavigationCost(...)`로 walkable cell에 별도 설정한다. Path query는 전체 waypoint buffer와 debug line buffer를 함께 반환한다. `weapons.projectileArc`가 켜진 bullet과 bullet-tile 충돌은 height span과 `blocksProjectile`을 사용한다. authored projectile의 blocking tile impact는 Game Spec tile field가 아니라 `behaviorRecipes`의 `projectileAction.tileImpact`로 선언하며, 허용값은 기존 Shooter 의미와 같은 `"despawn"`, blocking tile hit를 완전히 무시하는 `"passThrough"`, contact normal로 projectile velocity를 반사하는 `"bounce"`이다. `passThrough`는 tile-side authored sound/particle/despawn reaction도 실행하지 않고 같은 frame의 entity collision phase로 진행한다. `despawn`과 `bounce` blocking hit는 `GameplayEvent.kind = "tileImpact"` telemetry를 남기며 decoded action은 projectile handle, tile impact policy, layer/tile index, normal direction, bounced/identityTruncated/targetRemoved flag를 제공한다. Behavior FSM은 `event: "tileImpact"` predicate로 이 telemetry를 projectile-scoped state transition에 사용할 수 있으며, predicate 값은 실제 telemetry를 emit하는 `despawn`/`bounce` 또는 code `0`/`2`로 제한된다. `passThrough`는 tile impact telemetry를 만들지 않으므로 FSM predicate로 설치하지 않는다. layer/tile identity가 8-u32 event payload의 layer 8비트 + tile index 24비트 범위를 넘으면 packed payload는 하위 비트만 담고 `identityTruncated`가 true가 된다. world/contact `x/y` impact position과 정확한 초대형 tile identity는 별도 detail buffer 설계 대상이다. `bounce`는 tile-side authored self reaction을 additive로 실행하되, 명시 `Despawn(self)`가 있으면 bounce보다 despawn이 우선한다. runtime animated tile, editor, per-tile script, navmesh, crowd simulation, 별도 multi-hitbox/hurtbox authoring DSL은 포함하지 않는다.

`applyTileRules(...)`는 Game Spec 필드가 아니라 authoring helper다. row-major tile layer data와 ordered neighbor rule을 받아 새 layer data를 생성한다. `match`는 `number`, `number[]`, `"empty"`, `"filled"`, `"any"`를 지원하고 neighbor는 `n/e/s/w/ne/se/sw/nw` 방향에서 같은 조건 또는 `"same"`을 사용할 수 있다. 이 helper로 자동 타일링 결과를 미리 bake한 뒤 `tilemap.layers.*.data`에 넣는다.

`resolveAnimatedTileFrame(...)`와 `bakeAnimatedTileLayer(...)`도 authoring helper다. Ferrum2D는 현재 Rust tilemap render path에 animated tile state를 소유시키지 않고, AI/빌드/저빈도 runtime code가 시간값을 기준으로 tile id를 정적 layer data로 bake하는 정책을 사용한다. 이 방식은 tilemap Game Spec ABI를 늘리지 않고 기존 `setShooterTilemapTile(...)`/`setShooterTilemapTilesRect(...)` 경로와 함께 사용할 수 있다. 매 프레임 대량 tile animation을 JS에서 Wasm으로 밀어 넣는 방식은 hot path 경계 원칙상 권장하지 않는다.

`extractTilemapBoundaryChains(...)`는 resolved tilemap의 `collision: true` layer를 generic Physics Spec의 static `chain` body map으로 변환하는 helper다. 이 helper는 Game Spec 필드가 아니며, slope/one-way tile은 regular solid boundary에서 제외한다. HD-2D tile height metadata가 있는 solid tile은 height span별로 boundary를 분리하고 생성된 Physics Spec body에 `floor`, `elevation`, `height`를 보존한다. `PixelMaskTerrain`은 alpha mask를 collision-only tilemap layer로 변환한 뒤 같은 chain boundary 추출 경로를 재사용할 수 있다.

### Tiled JSON Import

`importTiledGameSpec(...)`는 Tiled finite orthogonal JSON map을 Game Spec `atlas`/`tilemap` 조각으로 변환한다. embedded tileset image metadata를 frame UV로 바꾸고, tile layer `data`의 global tile id를 그대로 Game Spec tile id로 사용한다. Map JSON의 `tilesets.*.source`가 external tileset을 가리키면 앱이 미리 로드한 tileset JSON/XML 변환 결과를 `externalTilesets[source]`로 전달한다.

```ts
import { importTiledGameSpec } from "@ferrum2d/ferrum-web";

const tiled = importTiledGameSpec(loaded.json.map, {
  collisionLayerNames: ["walls"],
  externalTilesets: {
    "terrain.tsx": loaded.json.terrainTileset,
  },
});

const spec: ShooterGameSpec = {
  atlas: { frames: { ...tiled.atlas?.frames } },
  tilemap: tiled.tilemap,
};
```

지원 범위:

- `orientation: "orthogonal"`
- finite map과 finite `tilelayer`
- embedded tileset image metadata: `firstgid`, `name`, `tilewidth`, `tileheight`, `columns`, `tilecount`, `imagewidth`, `imageheight`, `margin`, `spacing`
- `externalTilesets` 옵션으로 미리 로드한 external tileset metadata
- `data: number[]` tile layer
- `encoding: "base64"`와 `compression`이 없는 little-endian uint32 tile layer data
- `encoding: "base64"`와 `compression`이 있는 tile layer data는 `decodeCompressedLayerData(bytes, context)` option을 명시한 경우에만 지원한다. Ferrum2D package는 zlib/gzip/zstd decompressor를 production dependency로 포함하지 않는다.
- `visible: false` layer는 기본적으로 제외하고, `includeHiddenLayers: true`일 때만 포함한다.
- Tiled custom property `collision: true` 또는 `collisionLayerNames` 옵션을 통한 collision layer 지정
- embedded tileset `tiles.*.properties`의 `slopeX0`, `slopeY0`, `slopeX1`, `slopeY1` numeric custom property를 통한 Game Spec `tilemap.tiles.*.slope` 생성
- embedded tileset `tiles.*.properties`의 `oneWayPlatform: true` boolean custom property를 통한 Game Spec `tilemap.tiles.*.oneWayPlatform` 생성
- embedded tileset `tiles.*.properties`의 `floor`, `elevation`, `height`, `kind`, `rampAxis`, `rampStartElevation`, `rampEndElevation`, `blocksMovement`, `blocksProjectile`, `blocksVision`, `occluderHeight` custom property를 통한 Game Spec HD-2D tile metadata 생성
- embedded tileset `tiles.*.properties`의 `bridgePortal` JSON custom property를 통한 Game Spec `tilemap.tiles.*.bridgePortal` 생성

현재 제외 범위:

- infinite/chunked map
- decoder hook이 없는 compressed layer data
- flipped/rotated tile gid
- object layer, image layer, per-tile script, Wang/autotile metadata

### LDtk JSON Import

`importLDtkGameSpec(...)`는 LDtk project JSON의 embedded level 또는 `externalLevels` 옵션으로 전달한 external `.ldtkl` level을 Game Spec `atlas`/`tilemap` 조각으로 변환한다. LDtk tileset definition의 pixel metadata와 padding/spacing을 frame UV로 바꾸고, `Tiles`/`AutoLayer` layer의 tile instances를 row-major tile layer data로 변환한다. `importLDtkTilemap(...)` 결과에는 `Entities` layer의 entity 위치와 field metadata도 `entities` 배열로 포함된다.

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
- LDtk `Entities` layer의 entity identifier, iid, defUid, 위치, 크기, field instance value/type metadata
- `collisionLayerNames`에 포함된 raw `IntGrid`의 `intGridCsv`를 Game Spec `collisionOnly: true` layer로 변환
- tileset definition: `uid`, `identifier`, `tileGridSize`, `pxWid`, `pxHei`, `padding`, `spacing`, `relPath`
- `collisionLayerNames` 옵션을 통한 collision layer 지정
- `frameNameForTile`과 `texture` callback을 통한 frame/texture name 조정
- tileset `customData`의 JSON 문자열 `{"slope":{"x0":0,"y0":1,"x1":1,"y1":0}}`를 통한 Game Spec `tilemap.tiles.*.slope` 생성
- tileset `customData`의 JSON 문자열 `{"oneWayPlatform":true}`를 통한 Game Spec `tilemap.tiles.*.oneWayPlatform` 생성
- tileset `customData`의 JSON 문자열 `{"floor":"bridge","elevation":12,"height":8,"kind":"bridge","blocksProjectile":false}`를 통한 Game Spec HD-2D tile metadata 생성
- tileset `customData`의 JSON 문자열 `{"bridgePortal":{"lowerFloor":"ground","upperFloor":"bridge","lowerElevation":0,"upperElevation":12}}`를 통한 Game Spec bridge portal metadata 생성

현재 제외 범위:

- external `.ldtkl` level 자동 fetch/loading
- 한 grid cell에 여러 tile이 쌓인 LDtk tile stack
- flipped tile
- rule metadata, per-tile script

## Game State Snapshot

저장/불러오기는 Game Spec 필드가 아니라 runtime helper API로 제공한다. `captureGameStateSnapshot(engine, { frame, includeBuiltInShooterState: true, physicsWorld, customState })`는 현재 `score`, `gameState`, entity/sprite count, camera position을 읽고, 선택적으로 built-in shooter state, Physics Spec world snapshot, 게임별 custom JSON state를 `GameStateSnapshot` envelope에 담는다. `stringifyGameStateSnapshot(...)`/`parseGameStateSnapshot(...)`는 hash를 검증하는 JSON export/import 경로이고, `saveGameStateSnapshotToStorage(...)`/`loadGameStateSnapshotFromStorage(...)`는 `localStorage`와 같은 storage slot에 저장/로드한다.

`restoreGameStateSnapshot(...)`는 포함된 built-in shooter snapshot과 PhysicsWorld snapshot을 복원하고 `applyCustomState` callback으로 게임별 custom state를 되돌린다. built-in shooter snapshot은 score, game state, spawn/wave timer, camera, player/enemy/bullet position/velocity/health/damage/lifetime/reward를 포함한다. hit flash, particle, tween, pending audio event 같은 순간 효과는 세이브 대상이 아니며 restore 중 정리되는 transient state로 취급한다. 이 경로는 낮은 빈도 save/load API이며 rollback netcode용 hot-path snapshot은 아니다.

## Enemy Behavior

- `"chase"`: enemies move toward the player. `collision: true` tilemap layer가 있으면 Rust navigation grid의 다음 waypoint를 향해 이동하고, 경로가 없으면 기존처럼 player를 직접 추적한다. Behavior recipe의 `configureChase`로 entity target을 지정한 경우에도 같은 tilemap waypoint/cache 경로를 사용한다.
- `"drift"`: enemies move toward the world center.
- `"static"`: enemies stay still after spawning.
- `"orbit"`: enemies circle around the player with radial correction based on `enemies.orbit.radius` and `enemies.orbit.radialBand`. navigation grid를 사용하지 않는다.

Behavior and global orbit tuning are validated in TypeScript and sent to Rust as numeric values through `set_shooter_resolved_config(...)`. `chase` navigation은 runtime enemy movement 내부에서 사용하며, player target과 entity target은 cache target identity를 구분한다. `FerrumEngine.queryTilemapNavigationWaypoint(...)`와 `FerrumEngine.queryTilemapNavigationPath(...)`로 같은 collision tilemap 기반 A* 결과를 낮은 빈도 gameplay query에서도 사용할 수 있다. `FerrumEngine.setShooterTilemapNavigationCost(...)`는 walkable cell별 weighted cost를 설정한다. navmesh와 crowd simulation은 포함하지 않는다.

## Enemy Spawn Pattern

- `"edge"`: enemies spawn around the world edges.
- `"corners"`: enemies spawn from the four world corners.
- `"center"`: enemies spawn from the world center.

Spawn pattern is validated in TypeScript and sent to Rust as a numeric code through `set_shooter_resolved_config(...)`.

## Enemy Wave Spec

`enemies.presets`는 이름이 붙은 enemy 설정 묶음이다. 각 preset은 speed, behavior, spawnPattern, health, scoreReward를 부분적으로 덮어쓸 수 있고 누락된 값은 `enemies.*` 기본값을 따른다. `default` preset은 항상 `enemies.*` 값으로 생성된다.

`enemies.waves`가 있으면 Rust `ShooterScene`이 wave 진행 상태, spawn timer, wave별 spawn count를 소유한다. TypeScript는 wave와 preset 이름을 검증한 뒤 `set_shooter_wave(...)`로 duration, spawnInterval, enemyCount, enemySpeed, behavior code, spawnPattern code, health, scoreReward 숫자만 전달한다. 모든 wave가 끝나면 첫 wave부터 반복된다. 낮은 빈도 Rust/Wasm authoring API `set_shooter_wave_action_trigger(...)`는 특정 wave 진입 시 generation-checked source entity의 action id를 `ActionTriggerQueue`에 넣는 보조 경로다. 이 경로는 wave spawn을 대체하지 않는 additive trigger이며, source entity가 stale이면 queue하지 않는다.

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

## Authored Behavior Variant

`examples/topdown-shooter/public/authored-behavior.variant.json`은 메인 `game.json`에 새 namespace를 넣지 않고, Top-down Shooter가 gameplay authoring 데이터를 어떻게 묶는지 보여주는 예제용 variant다.

이 파일은 편집기 보조와 agent patch review를 위해 `schemas/topdown-authored-behavior-variant.schema.json`을 `$schema`로 참조한다. JSON Schema는 envelope와 주요 authoring field shape를 잡고, semantic drift는 아래 validation/smoke command가 public package helper와 replay manifest를 함께 읽어 검증한다.

이 variant는 다음 데이터를 함께 가진다.

- `extendsGameSpec`: 기준 Top-down Shooter `game.json` 경로
- `semantics.fsmStateEntryMode`: browser smoke/demo가 FSM current state command를 적용하는 방식. 현재 값은 `manualReplaceSupported`이며, 자동 state-enter runtime이 아니라 helper가 현재 state command를 낮은 빈도 경계에서 `replaceSupported`로 적용한다는 뜻이다.
- `semantics.browserPlacement`: replay fixture 좌표를 production browser demo world에 배치하는 별도 계약. 현재는 `anchorReplayBody: "pickup"` instance를 `target: "worldCenter"`에 맞추고 전체 authored fixture 좌표를 `scale: 0.4`로 압축한다.
- `ids`: `items`/`actions`/`timers` runtime token registry. 현재 variant는 `score -> 1`, `primary -> 1`, `dash -> 2`, `collect-score -> 7`, `summon-enemy -> 11`, `wake -> 13`을 선언하고, recipe와 FSM predicate는 가능하면 inline numeric id 대신 이 registry를 참조한다.
- `sceneComposition`: prefab/variant/instance와 instance별 `behaviorRecipes` binding. 대부분의 instance는 browser demo에서 physics body로 spawn되지만, `props.runtimeEntity: "builtinShooterPlayer"`를 가진 instance는 새 body를 만들지 않고 현재 built-in Shooter player handle에 command를 적용한다.
- `behaviorRecipes`: player projectile/dash action, projectile `tileImpact: "despawn"|"passThrough"|"bounce"` policy, pickup, interaction, projectile damage, health, faction damage policy, score reward recipe. `faction`은 gameplay damage mask이며 physics `CollisionLayer`나 tile collision layer를 대체하지 않는다. projectile spawn은 source faction을 bullet에 복사하고 기본 projectile damage gate에서 사용한다. player/authored melee가 enemy를 kill하면 target `scoreReward`를 점수로 반영하고, melee default damage/GameOver도 source/target faction mask를 통과할 때만 적용한다. authored `Damage` reaction과 기본 projectile/melee damage gate가 faction mask로 deny되면 `factionDamageDenied` telemetry가 source/target faction id를 남기고 default hit presentation은 만들지 않는다. full faction relation table은 아직 열지 않는다.
- `behaviorStateMachines`: interaction, collisionDamage, timer, pickupCollected, tileImpact 같은 Rust-owned gameplay event를 받는 최소 FSM. 현재 예제 variant는 필요한 machine만 선언하며, FSM vocabulary 전체가 visual editor나 callback runtime을 의미하지는 않는다.
- `replayScenario`: `tests/fixtures/gameplay-golden/scenarios.json`의 authored behavior scenario id

`sceneComposition`의 instance props는 `replayBody`, `physicsBody`, `behaviorStateMachine`을 명시한다. smoke는 이 값이 replay scenario의 authored body metadata와 일치하는지, FSM machine id가 resolved instance id와 명시적으로 연결되는지 검증한다. `expected.states`는 사람이 읽는 state 문자열을 source of truth로 두며, numeric runtime state id는 smoke가 install plan에서 파생한다.

`tests/fixtures/gameplay-golden/scenarios.json`의 `example-topdown-authored-behavior.variantPath`도 이 파일을 가리킨다. 따라서 replay input/body/component metadata와 variant의 prefab/recipe/FSM metadata가 어긋나면 `pnpm smoke:gameplay-replay`와 `pnpm smoke:topdown-authored-behavior-variant` 중 하나가 실패한다.

검증:

```bash
pnpm validate:topdown-authored-behavior-variant
pnpm smoke:topdown-authored-behavior-variant
```

두 명령은 같은 semantic validator를 실행한다. `resolveShooterGameSpec(...)`, `resolveGameplayBehaviorRuntimeIds(...)`, `resolveSceneCompositionSpec(...)`, `dryRunSceneBehaviorRecipes(...)`, `resolveBehaviorStateMachineDocument(...)`, `createBehaviorStateMachineRuntimeInstallPlan(...)`를 public package build에서 실행하고, `ids.actions`, `semantics.browserPlacement`, replay manifest 연결도 확인한다. 즉 variant는 browser runtime에서 바로 로드되는 메인 Game Spec은 아니지만, agent가 prefab/behavior/FSM/replay 계약을 한 파일에서 patch하고 검증할 수 있는 authoring artifact다. 현재 variant의 FSM은 state transition telemetry를 검증하는 범위이며, state entry마다 behavior profile을 자동 apply/clear하는 runtime을 의미하지 않는다.

Production Top-down Shooter build도 이 variant JSON을 asset manifest로 로드하고, 같은 public authoring API 검증 결과를 `window.ferrumTopdownAuthoredBehaviorVariant` summary로 노출한다. `authoredBehaviorVariantApply=true` query가 켜지면 예제 runtime은 scene load 이후 낮은 빈도 경로에서 variant의 spawn 대상 `SceneComposition` instance를 physics body로 만들고, `runtimeEntity: "builtinShooterPlayer"` instance는 `FerrumEngine.builtInShooterPlayerHandle()`로 현재 player handle을 조회해 같은 handle map에 넣는다. 이후 variant `ids` registry를 `FerrumEngine`의 gameplay authoring facade에 넘겨 `BehaviorRecipeCommand[]`와 FSM install plan을 Rust component storage에 적용한다. browser demo 배치는 production `game.json`의 타일맵 장애물을 피하기 위해 `semantics.browserPlacement`가 선언한 anchor/target/scale로 replay fixture 좌표를 player 중심 주변에 압축 배치한다(`runtimeApply.placementAnchorReplayBody`, `placementTarget`, `placementScale`). browser runtime smoke:

```bash
pnpm smoke:topdown-authored-behavior-runtime
```

이 smoke는 query toggle을 사용해 variant를 실제 gameplay entity로 spawn/apply하고, `runtimeApply` summary의 instance count `8`, command count `15`, FSM initial/current state id와 `applyId`를 확인한다. `builtin-player` binding은 새 body가 아니라 built-in player handle이며, snapshot의 player primary/dash/spawnPrefab action binding이 variant registry의 action id와 recipe 값으로 적용됐는지도 확인한다. 이후 shooter를 Title에서 Playing으로 진입시켜 Rust frame loop가 score pickup, interaction event, collisionDamage/factionDamageDenied event, actionFailed event, timer event, prefabSpawned event, FSM transition을 처리하는지도 확인한다. 검증값은 score `15`, interaction `tokenId=7`/`once`/`consumedThisFrame`, FSM state `2/2/1`, `behaviorStateChanged` event 3건이다.

transition 후 현재 FSM state의 behavior profile 적용도 자동 frame runtime으로 실행하지 않는다. browser smoke/demo는 window-only helper `ferrumTopdownAuthoredBehaviorApplyCurrentStateCommands()`로 `FerrumEngine.createBehaviorStateMachineCurrentStateCommandPlan(...)`과 `applyBehaviorStateMachineStateCommands(..., { mode: "replaceSupported" })`를 낮은 빈도 경계에서 호출한다. 현재 variant의 `triggered`와 `awake` state는 비어 있어 이전 `interaction`/`timer`/action component를 clear하고, `spent` state는 `projectile.spent` profile의 `configureLifetime` 1건을 적용한다. smoke는 clear-only state의 command count `0`/result count `11`과 `spent` command type `configureLifetime`/result count `12`로 clear-only와 non-empty state profile apply가 같은 helper 경계에서 모두 동작하는지 확인하며, supported clear subset에는 faction, timer trigger, action binding, movement, collision reaction도 포함된다.

`resetGame()`은 World를 새로 만들기 때문에 이전 authored instance handle은 World epoch 범위에서만 유효하다. entity id/generation 숫자가 reset 후 재사용될 수 있으므로 browser demo는 public engine API가 아니라 window-only smoke helper `ferrumTopdownAuthoredBehaviorResetAndReapply()`로 smoke frame/state-command summary를 비우고 variant를 다시 적용한다. smoke는 두 번째 `applyId`에서 runtime apply summary가 교체됐는지, 새 frame summary가 같은 `applyId`를 가지는지, 이벤트 payload가 현재 `runtimeApply.handles`와 일치하는지, current-state command apply가 같은 `applyId`에서 다시 동작하는지, one-shot interaction이 재발행되지 않는지까지 확인한다. 이 적용은 scene load/user-triggered/agent apply 같은 낮은 빈도 경로이며, state entry마다 behavior profile을 자동 apply/clear하는 frame runtime이나 per-entity JS callback은 아니다.

## Variant 생성

```bash
pnpm create:game-variant fast-enemies
```

출력 경로를 지정할 수도 있다.

```bash
pnpm create:game-variant drift-swarm /tmp/game.drift-swarm.json
```

현재 지원 preset은 `fast-enemies`, `drift-swarm`, `static-targets`, `orbit-ring`이며 `scripts/create-game-variant.mjs`에서 관리한다.
