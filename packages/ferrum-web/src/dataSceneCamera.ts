import type { Engine } from "../pkg/ferrum_core.js";
import type { GameplayEntityHandle } from "./gameplayAuthoring.js";
import type { CameraBounds } from "./cameraPostProcessing.js";
import { resolveCameraRigSpec } from "./cameraPostProcessing.js";
import { physicsEntityHandle } from "./physicsHandles.js";

/** Replaces the Data Scene camera configuration. Omitted follow/bounds clear them. */
export interface DataSceneCameraOptions {
  x?: number;
  y?: number;
  follow?: GameplayEntityHandle;
  bounds?: CameraBounds;
  smoothTimeSeconds?: number;
}

export function configureDataSceneCamera(engine: Engine, options: DataSceneCameraOptions): boolean {
  const spec = resolveCameraRigSpec({ ...options, x: options.x ?? engine.camera_x(), y: options.y ?? engine.camera_y() });
  const follow = options.follow === undefined ? undefined : physicsEntityHandle(options.follow);
  const bounds = spec.bounds;
  return engine.configure_data_scene_camera(spec.x, spec.y, follow?.entityId ?? 0xffffffff,
    follow?.entityGeneration ?? 0, bounds !== undefined, bounds?.minX ?? 0, bounds?.minY ?? 0,
    bounds?.maxX ?? 0, bounds?.maxY ?? 0, spec.smoothTimeSeconds);
}
