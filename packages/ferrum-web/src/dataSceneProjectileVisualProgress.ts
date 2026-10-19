import { fail, record } from "./dataSceneCombatProgress.js";
import type { DataSceneProjectilePrefabSpec } from "./dataSceneProjectilePrefabs.js";
import type {
  DataSceneCombatSpawnProgressSnapshot,
  DataSceneCombatSpawnProjectileSnapshot,
} from "./dataSceneSpawnProgress.js";
import type { DataSceneSpriteFrameSpec } from "./dataSceneComponents.js";

export interface DataSceneProjectileAnimationProgress {
  readonly elapsedSeconds: number;
  readonly paused: boolean;
  readonly flipX: boolean;
  readonly flipY: boolean;
}
export interface DataSceneCombatVisualProjectileSnapshot
  extends DataSceneCombatSpawnProjectileSnapshot {
  /** null for a static image, including velocity-only rotation. */
  readonly animation: DataSceneProjectileAnimationProgress | null;
}
export interface DataSceneCombatVisualProgressSnapshot
  extends Omit<DataSceneCombatSpawnProgressSnapshot, "version" | "projectiles"> {
  readonly version: 4;
  readonly projectiles: readonly DataSceneCombatVisualProjectileSnapshot[];
}

/** Definition/clock agreement is validated before the active scene can be replaced. */
export function validateProjectileAnimationProgress(
  value: unknown,
  prefab: DataSceneProjectilePrefabSpec | undefined,
  path: string,
): asserts value is DataSceneProjectileAnimationProgress | null {
  const animation = prefab?.sprite.animation;
  if ((value === null) !== (animation === undefined))
    fail(`${path} must match its projectile prefab animation.`);
  if (value === null) return;
  const state = record(value, ["elapsedSeconds", "paused", "flipX", "flipY"], path);
  const duration = animation!.frames.length / Math.fround(animation!.fps),
    elapsed = state.elapsedSeconds;
  if (
    typeof elapsed !== "number" ||
    !Number.isFinite(elapsed) ||
    elapsed < 0 ||
    elapsed > duration ||
    (animation!.loop !== false && elapsed >= duration)
  )
    fail(`${path}.elapsedSeconds exceeds the clip duration.`);
  if ([state.paused, state.flipX, state.flipY].some((flag) => typeof flag !== "boolean"))
    fail(`${path} requires boolean playback flags.`);
}

/** Serialization contract only; the actual runtime clock and UV selection remain in Rust. */
export function projectileProgressFrame(
  prefab: DataSceneProjectilePrefabSpec,
  state?: DataSceneProjectileAnimationProgress | null,
): DataSceneSpriteFrameSpec {
  if (!prefab.sprite.animation || !state) return prefab.sprite.frame!;
  const a = prefab.sprite.animation,
    index = Math.min(
      a.frames.length - 1,
      Math.floor(state.elapsedSeconds * Math.fround(a.fps) + 1e-9),
    ),
    frame = a.frames[index];
  return {
    u0: state.flipX ? frame.u1 : frame.u0,
    u1: state.flipX ? frame.u0 : frame.u1,
    v0: state.flipY ? frame.v1 : frame.v0,
    v1: state.flipY ? frame.v0 : frame.v1,
  };
}
