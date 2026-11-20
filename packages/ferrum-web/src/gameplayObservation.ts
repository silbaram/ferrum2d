import type { Engine } from "../pkg/ferrum_core.js";
import type { GameplayEntityHandle } from "./gameplayAuthoring.js";
import { physicsEntityHandleBuffer } from "./physicsHandles.js";

export interface GameplayPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BuiltInShooterProgress {
  readonly activeWaveIndex: number;
  readonly waveElapsedSeconds: number;
  readonly waveSpawnedCount: number;
}

export interface FerrumGameplayObservationApi {
  /** One bulk query, preserving order and duplicates. Stale/missing handles yield
   * undefined. Native bodies use simulation XYZ; other entities use authored XY/Z=0.
   * Results are owned copies, independent of render offsets and interpolation.
   */
  queryGameplayPositions(handles: readonly GameplayEntityHandle[]): readonly (GameplayPosition | undefined)[];
  /** Read-only native or legacy Shooter progress; undefined in other scenes.
   * Does not capture or restore a legacy snapshot, step physics, or consume input.
   */
  builtInShooterProgress(): BuiltInShooterProgress | undefined;
  /** Current built-in player's primary projectile/input dash bindings, without a
   * legacy snapshot. Missing/other-scene players yield undefined; missing bindings
   * are omitted. This is a cold authoring/diagnostic query, not a per-frame API.
   */
  builtInShooterPlayerActions(): BuiltInShooterPlayerActions | undefined;
}

export interface BuiltInShooterPlayerActions {
  readonly primaryAction?: {
    readonly actionId: number; readonly cooldownSeconds: number; readonly remainingCooldownSeconds: number;
    readonly speed: number; readonly damage: number; readonly lifetimeSeconds: number;
  };
  readonly dashAction?: {
    readonly actionId: number; readonly cooldownSeconds: number; readonly remainingCooldownSeconds: number; readonly distance: number;
  };
}

type Native = Pick<Engine, "query_gameplay_positions" | "built_in_shooter_progress" | "built_in_shooter_player_actions">;
const MAX_POSITIONS = 65_536;

export function createGameplayObservationApi(native: Native, requireAlive: () => void): FerrumGameplayObservationApi {
  return {
    queryGameplayPositions(handles) {
      requireAlive();
      if (!Array.isArray(handles) || handles.length > MAX_POSITIONS) {
        throw new Error("Gameplay positions require at most 65536 entity handles.");
      }
      const rows = native.query_gameplay_positions(physicsEntityHandleBuffer(handles));
      if (rows.length !== handles.length * 4) throw new Error("Invalid gameplay position output.");
      return handles.map((_, index) => {
        const offset = index * 4;
        const valid = rows[offset], x = rows[offset + 1], y = rows[offset + 2], z = rows[offset + 3];
        if ((valid !== 0 && valid !== 1) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          throw new Error("Invalid gameplay position row.");
        }
        return valid === 1 ? { x, y, z } : undefined;
      });
    },
    builtInShooterProgress() {
      requireAlive();
      const values = native.built_in_shooter_progress();
      if (values.length === 0) return undefined;
      const [activeWaveIndex, waveElapsedSeconds, waveSpawnedCount] = values;
      if (values.length !== 3 || !uint32(activeWaveIndex) || !uint32(waveSpawnedCount)
        || !Number.isFinite(waveElapsedSeconds) || waveElapsedSeconds < 0) {
        throw new Error("Invalid built-in Shooter progress.");
      }
      return { activeWaveIndex, waveElapsedSeconds, waveSpawnedCount };
    },
    builtInShooterPlayerActions() {
      requireAlive();
      const values = native.built_in_shooter_player_actions();
      if (values.length === 0) return undefined;
      if (values.length !== 10 || !values.every(v => Number.isFinite(v) && v >= 0)
        || !uint32(values[0]) || !uint32(values[6])) throw new Error("Invalid built-in Shooter player actions.");
      return {
        ...(values[0] === 0 ? {} : { primaryAction: { actionId: values[0], cooldownSeconds: values[1], remainingCooldownSeconds: values[2], speed: values[3], damage: values[4], lifetimeSeconds: values[5] } }),
        ...(values[6] === 0 ? {} : { dashAction: { actionId: values[6], cooldownSeconds: values[7], remainingCooldownSeconds: values[8], distance: values[9] } }),
      };
    },
  };
}

function uint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}
