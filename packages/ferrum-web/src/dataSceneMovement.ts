import type { Engine } from "../pkg/ferrum_core";
import type { FerrumSceneApi } from "./engineTypes.js";
import { uint32Number } from "./particlePreset.js";

/** World-space destination for the Data Scene primary actor (one enabled, solid kinematic AABB). */
export interface DataSceneMoveOptions {
  x: number;
  y: number;
  /** World units per simulation second. */
  speed: number;
  /** Final-segment stopping radius. Default 0.5 world units. */
  arrivalRadius?: number;
  /** Candidate solid layers, also subject to collision filters/height span. Default all layers. */
  solidMaskBits?: number;
  /** Cancel on a held W/A/S/D control, allowing manual velocity in that sample. Default true. */
  cancelOnInput?: boolean;
}

export type DataSceneMoveStatus = "idle" | "moving" | "arrived" | "blocked" | "cancelled";
const MOVE_STATUSES = ["idle", "moving", "arrived", "blocked", "cancelled"] as const;

type MovementEngine = Pick<Engine, "move_data_scene_actor_to" | "cancel_data_scene_move" | "data_scene_move_status">;

export function createDataSceneMovementApi(rustEngine: MovementEngine, requireAlive: () => void): Pick<
  FerrumSceneApi, "moveDataSceneActorTo" | "cancelDataSceneMove" | "dataSceneMoveStatus"
> {
  return {
    moveDataSceneActorTo(options) {
      requireAlive();
      if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("dataScene.move must be an object.");
      for (const key of Object.keys(options)) {
        if (!["x", "y", "speed", "arrivalRadius", "solidMaskBits", "cancelOnInput"].includes(key)) {
          throw new Error(`dataScene.move.${key} is not supported.`);
        }
      }
      const x = float32(options.x, "x"), y = float32(options.y, "y");
      const speed = float32(options.speed, "speed");
      const radius = float32(options.arrivalRadius === undefined ? 0.5 : options.arrivalRadius, "arrivalRadius");
      if (speed <= 0) throw new Error("dataScene.move.speed must be positive.");
      if (options.arrivalRadius !== undefined && options.arrivalRadius < 0) throw new Error("dataScene.move.arrivalRadius must be nonnegative.");
      const cancelOnInput = options.cancelOnInput === undefined ? true : options.cancelOnInput;
      if (typeof cancelOnInput !== "boolean") throw new Error("dataScene.move.cancelOnInput must be boolean.");
      const mask = uint32Number(options.solidMaskBits === undefined ? 0xffffffff : options.solidMaskBits, "dataScene.move.solidMaskBits");
      return rustEngine.move_data_scene_actor_to(x, y, speed, radius, mask, cancelOnInput);
    },
    cancelDataSceneMove() { requireAlive(); return rustEngine.cancel_data_scene_move(); },
    dataSceneMoveStatus() {
      requireAlive();
      const code = rustEngine.data_scene_move_status();
      if (code === 0xffffffff) return undefined;
      const status = MOVE_STATUSES[code];
      if (status === undefined) throw new Error(`Unsupported Data Scene move status: ${code}.`);
      return status;
    },
  };
}

function float32(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
    throw new Error(`dataScene.move.${name} must be a finite float32 number.`);
  }
  return Math.fround(value);
}
