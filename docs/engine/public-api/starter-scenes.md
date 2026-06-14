# Starter Scenes Public API

`@ferrum2d/ferrum-web/starter-scenes`는 official example과 create-game template이 공유하는
preview entrypoint다. Shooter, Breakout, Platformer 같은 starter scene을 그대로 사용하거나
Game Spec 기반으로 조정할 때 사용한다.

```ts
import {
  resolveShooterGameSpec,
  applyShooterGameSpec,
  createShooterContentRuntimeOptions,
} from "@ferrum2d/ferrum-web/starter-scenes";
```

## Shooter Game Spec

| API | 계약 |
| --- | --- |
| `resolveShooterGameSpec(...)` | Shooter Game Spec JSON을 resolved spec으로 정규화한다. |
| `applyShooterGameSpec(...)` | resolved Shooter spec을 runtime scene setup에 적용한다. |
| `createShooterContentRuntimeOptions(...)` | content runtime selection을 browser runtime 옵션으로 바꾼다. |
| `resolveShooterContentRuntimeSelection(...)` | content option set에서 선택값을 검증한다. |

Game Spec 필드와 기본값의 상세 기준은
[Top-down Shooter Game Spec](../../examples/topdown-shooter/game-spec.md)이다. 이 문서는
package import와 runtime API 계약만 다룬다.

## Runtime Scene Mutation

`FerrumEngine`의 starter scene method는 reset 성격을 기준으로 구분한다.

| Method | 상태 영향 |
| --- | --- |
| `setGameSpec(spec)` | Shooter scene config를 다시 적용한다. wave, tilemap, prefab config가 바뀌면 진행 상태가 초기화될 수 있다. |
| `setShooterAtlasFrame(prefab, frame)` | `player`, `enemy`, `bullet` prefab의 texture id, 크기, UV만 교체한다. enemy와 wave 진행 상태를 유지한다. |
| `setShooterTilemapTile(...)` | 단일 tile을 낮은 빈도로 바꾼다. |
| `setShooterTilemapTilesRect(...)` | tile rect를 낮은 빈도로 바꾼다. |
| HD-2D tile metadata helper | tile height span, kind, ramp, bridge portal, navigation cost를 변경한다. |

플레이 중 무기 visual/profile만 바꿀 때 `setGameSpec(...)`을 호출하면 scene reset처럼 보일 수
있다. 이 경우 `setShooterAtlasFrame("bullet", frame)`처럼 필요한 runtime frame만 교체한다.

## Built-in Snapshot

| API | 계약 |
| --- | --- |
| `captureShooterStateSnapshot()` | built-in Shooter state snapshot을 반환한다. |
| `restoreShooterStateSnapshot(snapshot)` | snapshot을 현재 runtime에 복원한다. |
| `validateBuiltInShooterStateSnapshot(...)` | snapshot shape와 version을 검증한다. |

`BuiltInShooterStateSnapshot`은 official starter scene replay와 smoke를 위한 format이다.
generic game save format으로 확장하기 전에 snapshot version과 migration을 별도 설계한다.

## Asset Import Helpers

| API | 계약 |
| --- | --- |
| `importAsepriteAtlas(...)` | Aseprite atlas JSON을 Ferrum atlas data로 변환한다. |
| `importTiledGameSpec(...)` | Tiled map data에서 Shooter Game Spec 일부를 만든다. |
| `importLDtkGameSpec(...)` | LDtk data에서 Shooter Game Spec 일부를 만든다. |
| `textureAtlasDocumentToShooterAtlas(...)` | packed atlas document를 Shooter atlas format으로 변환한다. |

이 helper들은 template/import pipeline용이다. runtime frame마다 asset tool output을 다시
해석하지 않는다.

## Starter Scene 범위

Starter scene API는 빠른 시작과 공식 예제 검증을 위한 surface다. 장기적으로 게임별 고유
규칙이 커지면 `@ferrum2d/ferrum-web/authoring`의 data scene, behavior recipe, Physics Spec
경로로 옮기는 것을 우선한다.
