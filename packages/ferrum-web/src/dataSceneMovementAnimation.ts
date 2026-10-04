import type { Engine } from "../pkg/ferrum_core.js";
import type { FerrumSceneApi } from "./engineTypes.js";

const DIRECTIONS = ["up", "down", "left", "right"] as const;
export type DataSceneMovementDirection = typeof DIRECTIONS[number];

export interface DataSceneMovementAnimationPose {
  /** An already configured clip ID, 0..65535. */
  clip: number;
  flipX?: boolean;
  flipY?: boolean;
}

/** Opt-in primary-actor animation policy. Explicit playback updates detach it. */
export interface DataSceneMovementAnimationSpec {
  idle: Record<DataSceneMovementDirection, DataSceneMovementAnimationPose>;
  walk: Record<DataSceneMovementDirection, DataSceneMovementAnimationPose>;
  /** Positive world Y faces down. Default down; diagonal ties face horizontally. */
  initialDirection?: DataSceneMovementDirection;
}

type AnimationEngine = Pick<Engine, "configure_data_scene_movement_animation">;

export function createDataSceneMovementAnimationApi(engine: AnimationEngine, requireAlive: () => void): Pick<FerrumSceneApi, "configureDataSceneMovementAnimation"> {
  return {
    configureDataSceneMovementAnimation(spec) {
      requireAlive();
      if (spec === false) return engine.configure_data_scene_movement_animation(new Uint32Array(), 1);
      const input = record(spec, ["idle", "walk", "initialDirection"], "movementAnimation");
      const facing = input.initialDirection === undefined ? "down" : input.initialDirection;
      const index = DIRECTIONS.findIndex(direction => direction === facing);
      if (index < 0) throw new Error("movementAnimation.initialDirection must be up/down/left/right.");
      const poses = new Uint32Array(24);
      let offset = 0;
      for (const state of ["idle", "walk"] as const) {
        const directions = record(input[state], DIRECTIONS, `movementAnimation.${state}`);
        for (const direction of DIRECTIONS) {
          const path = `movementAnimation.${state}.${direction}`;
          const pose = record(directions[direction], ["clip", "flipX", "flipY"], path);
          const clip = pose.clip;
          if (typeof clip !== "number" || !Number.isInteger(clip) || clip < 0 || clip > 65535) {
            throw new Error(`${path}.clip must be an integer in 0..65535.`);
          }
          poses[offset++] = clip;
          poses[offset++] = flag(pose.flipX, `${path}.flipX`);
          poses[offset++] = flag(pose.flipY, `${path}.flipY`);
        }
      }
      return engine.configure_data_scene_movement_animation(poses, index);
    },
  };
}

function record(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${path}.${key} is not supported.`);
  return value as Record<string, unknown>;
}

function flag(value: unknown, path: string): number {
  if (value === undefined) return 0;
  if (typeof value !== "boolean") throw new Error(`${path} must be boolean.`);
  return Number(value);
}
