import type { FerrumEngine } from "./engineTypes.js";
import {
  preflightDataSceneSpatialEnvironment,
  type ApplyDataSceneAuthoringDocumentOptions,
} from "./dataSceneRuntimeTarget.js";
import {
  bindSceneBehaviorRecipes,
  type GameplayEntityHandle,
} from "./gameplayAuthoring.js";
import { resolveSceneAuthoringDocument } from "./sceneAuthoringDocument.js";
import {
  resolveDataSceneNavigationSpec,
  type DataSceneNavigationSpec,
} from "./dataSceneNavigation.js";
import {
  compileDataSceneMovementAnimation,
  type DataSceneMovementAnimationSpec,
} from "./dataSceneMovementAnimation.js";
import { resolveDataSceneInstanceComponents } from "./dataSceneComponents.js";
import {
  compileSpatialTerrain,
  type DataSceneSpatialSpec,
} from "./dataSceneSpatial.js";
import {
  compileSpatialEnvironment,
  decodeSpatialEnvironment,
} from "./spatialEnvironment.js";
import {
  decodeSpatialProgressCamera,
  decodeSpatialPose,
  resolveSpatialPose,
  resolveSpatialProgress,
  spatialProgressValues,
  SPATIAL_PROGRESS_CAMERA_VALUES,
  SPATIAL_PROGRESS_POSE_VALUES,
  type DataSceneSpatialPoseSnapshot,
  type DataSceneSpatialProgressSnapshot,
} from "./dataSceneSpatialProgress.js";

/** Authored progress; opt-in spatial poses are included, gameplay timers/dynamic spawns are not. */
export interface DataSceneProgressSnapshot {
  readonly instances: readonly {
    readonly id: string;
    readonly removed: boolean;
    readonly interactionConsumed: boolean;
    /** Absent in legacy snapshots: retain the authored default. */
    readonly bodyEnabled?: boolean;
    /** Single authored collider only; absent retains the authored default. */
    readonly colliderEnabled?: boolean;
    /** Data Scene state v6+: live authored billboard world pose. */
    readonly spatialPose?: DataSceneSpatialPoseSnapshot;
    /** Authored animationSet playback; absent in legacy saves retains initial playback. */
    readonly animation?: {
      readonly clip: number;
      readonly elapsedSeconds: number;
      readonly paused: boolean;
      readonly flipX: boolean;
      readonly flipY: boolean;
      /** Native movement policy and current facing; absent restores explicitly detached playback. */
      readonly movement?: DataSceneMovementAnimationSpec;
    };
  }[];
  /** null explicitly restores a cleared navigation grid. */
  readonly navigation: DataSceneNavigationSpec | null;
  /** Data Scene state v6+; environment progress requires v7. Absent: preserve authored defaults. */
  readonly spatial?: DataSceneSpatialProgressSnapshot;
}

export interface DataSceneProgressAdapter {
  epoch(): number;
  capture(epoch: number, handles: Uint32Array): Uint32Array;
  navigation(): Float64Array;
  obstacles(): Uint32Array;
  animations(epoch: number, handles: Uint32Array): Float64Array;
  spatialRevision(): number;
  viewport(): { width: number; height: number };
  spatial(epoch: number, handles: Uint32Array): Float64Array;
  environment?(): Float32Array | undefined;
  preflightSpatial(
    terrainValues: Float32Array,
    metadata: Uint32Array,
    values: Float64Array,
  ): boolean;
  restore(
    epoch: number,
    handles: Uint32Array,
    states: Uint32Array,
    animations?: Float64Array,
    spatial?: Float64Array,
    environment?: Float32Array,
  ): boolean;
}
const ANIMATION_PROGRESS_STRIDE = 32;
const adapters = new WeakMap<FerrumEngine, DataSceneProgressAdapter>();
const contexts = new WeakMap<
  FerrumEngine,
  {
    epoch: number;
    document: string;
    handles: Readonly<Record<string, GameplayEntityHandle>>;
    spatialRevision: number;
    textureId?: ApplyDataSceneAuthoringDocumentOptions["textureId"];
  }
>();

export function attachDataSceneProgressAdapter(
  engine: FerrumEngine,
  adapter: DataSceneProgressAdapter,
): void {
  adapters.set(engine, adapter);
}

// Metadata only: retain original handles even after entities are removed from the world/registry.
export function forgetDataSceneProgressContext(engine: FerrumEngine): void {
  contexts.delete(engine);
}

export function rememberDataSceneProgressContext(
  engine: FerrumEngine,
  document: unknown,
  handles: Readonly<Record<string, GameplayEntityHandle>>,
  options: ApplyDataSceneAuthoringDocumentOptions,
): void {
  const adapter = adapters.get(engine);
  if (adapter === undefined || unsupportedOptions(options).length > 0) return;
  contexts.set(engine, {
    epoch: adapter.epoch(),
    document: canonicalDocument(document),
    handles: Object.fromEntries(
      Object.entries(handles).map(([id, handle]) => [id, { ...handle }]),
    ),
    spatialRevision: adapter.spatialRevision(),
    textureId: options.textureId,
  });
}

export function captureDataSceneProgress(
  engine: FerrumEngine,
  document: unknown,
): DataSceneProgressSnapshot {
  const adapter = requireAdapter(engine);
  const context = contexts.get(engine);
  if (
    context === undefined ||
    context.epoch === 0 ||
    context.epoch !== adapter.epoch()
  ) {
    throw new Error(
      "Data Scene progress requires a fresh, complete authoring apply with default binding options; reset or incremental apply invalidates it.",
    );
  }
  if (
    document === undefined ||
    canonicalDocument(document) !== context.document
  ) {
    throw new Error(
      "Data Scene progress requires the same authoringDocument used to apply the scene.",
    );
  }
  const ids = Object.keys(context.handles).sort();
  const states = adapter.capture(
    context.epoch,
    handleBuffer(ids, context.handles),
  );
  if (states.length !== ids.length)
    throw new Error("Data Scene progress capture rejected stale handles.");
  const animationValues = adapter.animations(
    context.epoch,
    handleBuffer(ids, context.handles),
  );
  if (animationValues.length !== ids.length * ANIMATION_PROGRESS_STRIDE)
    throw new Error("Data Scene animation progress rejected stale handles.");
  const spatialSpec = resolveSceneAuthoringDocument(document).spatial;
  const nativeSpatial = adapter.spatial(
    context.epoch,
    spatialSpec === undefined
      ? new Uint32Array()
      : handleBuffer(ids, context.handles),
  );
  if (
    spatialSpec === undefined &&
    (nativeSpatial[0] !== 0 ||
      context.spatialRevision !== adapter.spatialRevision())
  ) {
    throw new Error(
      "Data Scene progress cannot save runtime spatial configuration absent from the authored document; reapply a spatial document.",
    );
  }
  const spatialValues = spatialSpec === undefined ? undefined : nativeSpatial;
  const environmentValues = adapter.environment?.();
  if (spatialSpec?.environment !== undefined && environmentValues === undefined)
    throw new Error(
      "Spatial environment progress requires a compatible Wasm build",
    );
  const environment =
    spatialValues?.[0] === 1 &&
    (spatialSpec?.environment !== undefined || environmentValues?.length)
      ? decodeSpatialEnvironment(environmentValues ?? new Float32Array())
      : undefined;
  if (
    spatialValues !== undefined &&
    spatialValues.length !==
      SPATIAL_PROGRESS_CAMERA_VALUES + ids.length * SPATIAL_PROGRESS_POSE_VALUES
  ) {
    throw new Error(
      "Data Scene spatial progress capture rejected native state.",
    );
  }
  if (
    spatialValues?.[0] === 1 &&
    context.spatialRevision !== adapter.spatialRevision()
  ) {
    throw new Error(
      "Data Scene spatial progress requires the original authored terrain/billboard configuration; reapply after reconfiguration. Camera changes are supported.",
    );
  }
  const grid = adapter.navigation();
  const obstacleValues = adapter.obstacles();
  const obstacles: NonNullable<DataSceneNavigationSpec["obstacles"]>[number][] =
    [];
  for (let offset = 0; offset < obstacleValues.length; ) {
    const id = ids.find(
      (id) =>
        context.handles[id]!.entityId === obstacleValues[offset] &&
        context.handles[id]!.entityGeneration === obstacleValues[offset + 1],
    );
    if (id === undefined)
      throw new Error(
        "Data Scene progress obstacles must reference authored instances.",
      );
    const count = obstacleValues[offset + 2]!;
    const cells = Array.from({ length: count }, (_, index) => ({
      column: obstacleValues[offset + 3 + index * 2]!,
      row: obstacleValues[offset + 4 + index * 2]!,
    }));
    obstacles.push(
      count === 0
        ? { instanceId: id, collider: true }
        : { instanceId: id, cells },
    );
    offset += 3 + count * 2;
  }
  const progress: DataSceneProgressSnapshot = {
    instances: ids.map((id, index) => {
      const state = states[index]!;
      const spatialPose =
        spatialValues === undefined
          ? undefined
          : decodeSpatialPose(
              spatialValues.slice(
                SPATIAL_PROGRESS_CAMERA_VALUES +
                  index * SPATIAL_PROGRESS_POSE_VALUES,
                SPATIAL_PROGRESS_CAMERA_VALUES +
                  (index + 1) * SPATIAL_PROGRESS_POSE_VALUES,
              ),
              spatialSpec!,
            );
      return {
        id,
        removed: state === 0,
        interactionConsumed: (state & 2) !== 0,
        ...((state & 4) === 0 ? {} : { bodyEnabled: (state & 8) !== 0 }),
        ...((state & 16) === 0 ? {} : { colliderEnabled: (state & 32) !== 0 }),
        ...(spatialPose === undefined ? {} : { spatialPose }),
        ...(animationValues[index * ANIMATION_PROGRESS_STRIDE] === 0
          ? {}
          : {
              animation: decodeAnimation(
                animationValues.slice(
                  index * ANIMATION_PROGRESS_STRIDE,
                  (index + 1) * ANIMATION_PROGRESS_STRIDE,
                ),
              ),
            }),
      };
    }),
    ...(spatialValues === undefined
      ? {}
      : {
          spatial: {
            camera: decodeSpatialProgressCamera(spatialValues),
            ...(environment === undefined ? {} : { environment }),
          },
        }),
    navigation:
      grid.length === 0
        ? null
        : resolveDataSceneNavigationSpec({
            columns: grid[0],
            rows: grid[1],
            cellWidth: grid[2],
            cellHeight: grid[3],
            originX: grid[4],
            originY: grid[5],
            costs: Array.from(grid.slice(6)),
            ...(obstacles.length === 0 ? {} : { obstacles }),
          }),
  };
  validateDataSceneProgress(progress, document);
  preflightEnvironmentProgress(engine, progress, document, {
    textureId: context.textureId,
  });
  preflightSpatialProgress(adapter, progress, spatialSpec);
  return progress;
}

export function preflightDataSceneProgressRestore(
  engine: FerrumEngine,
  options: ApplyDataSceneAuthoringDocumentOptions = {},
  progress?: DataSceneProgressSnapshot,
  document?: unknown,
): void {
  requireAdapter(engine);
  const unsupported = unsupportedOptions(options);
  if (unsupported.length > 0)
    throw new Error(
      `Data Scene progress restore does not support apply options: ${unsupported.join(", ")}. Put binding configuration in the saved document.`,
    );
  if (progress !== undefined) {
    preflightEnvironmentProgress(engine, progress, document, options);
    preflightSpatialProgress(
      requireAdapter(engine),
      progress,
      resolveSceneAuthoringDocument(document).spatial,
    );
  }
}

export function restoreDataSceneProgress(
  engine: FerrumEngine,
  progress: DataSceneProgressSnapshot,
  handles: Readonly<Record<string, GameplayEntityHandle>>,
): void {
  const adapter = requireAdapter(engine);
  const ids = progress.instances.map((instance) => instance.id);
  const states = Uint32Array.from(progress.instances, (instance) =>
    instance.removed
      ? 0
      : 1 |
        (instance.interactionConsumed ? 2 : 0) |
        (instance.bodyEnabled === undefined
          ? 0
          : 4 | (instance.bodyEnabled ? 8 : 0)) |
        (instance.colliderEnabled === undefined
          ? 0
          : 16 | (instance.colliderEnabled ? 32 : 0)),
  );
  // Bind fresh handles while all authored entities still exist; then restore removals/flags.
  const ok =
    progress.navigation === null
      ? engine.clearDataSceneNavigation()
      : engine.configureDataSceneNavigation(progress.navigation, handles);
  if (!ok) throw new Error("Data Scene progress restore rejected navigation.");
  const animations = progress.instances.some(
    (instance) => instance.animation !== undefined,
  )
    ? Float64Array.from(
        progress.instances.flatMap((instance) => {
          const animation = instance.animation;
          if (animation === undefined)
            return Array<number>(ANIMATION_PROGRESS_STRIDE).fill(0);
          const movement =
            animation.movement === undefined
              ? undefined
              : compileDataSceneMovementAnimation(animation.movement);
          return [
            1,
            animation.clip,
            animation.elapsedSeconds,
            +animation.paused,
            +animation.flipX,
            +animation.flipY,
            movement === undefined ? 0 : 1,
            movement?.facing ?? 0,
            ...Array.from(movement?.poses ?? new Uint32Array(24)),
          ];
        }),
      )
    : undefined;
  const context = contexts.get(engine);
  const spec =
    context === undefined
      ? undefined
      : resolveSceneAuthoringDocument(JSON.parse(context.document)).spatial;
  const spatial =
    progress.spatial === undefined
      ? undefined
      : spatialProgressValues(
          progress.spatial,
          progress.instances,
          spec!,
          adapter.viewport(),
        );
  const environment =
    progress.spatial?.environment === undefined
      ? undefined
      : compileSpatialEnvironment(progress.spatial.environment);
  if (
    !adapter.restore(
      adapter.epoch(),
      handleBuffer(ids, handles),
      states,
      animations,
      spatial,
      environment,
    )
  ) {
    throw new Error("Data Scene progress restore rejected entity state.");
  }
}

export function validateDataSceneProgress(
  value: unknown,
  document: unknown,
): asserts value is DataSceneProgressSnapshot {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => !["instances", "navigation", "spatial"].includes(key),
    ) ||
    !Array.isArray(value.instances)
  ) {
    throw new Error(
      "Data Scene progress must contain instances and navigation.",
    );
  }
  if (document === undefined)
    throw new Error("Data Scene progress requires an authoringDocument.");
  const resolved = resolveSceneAuthoringDocument(document);
  const plan = bindSceneBehaviorRecipes(
    resolved.sceneComposition,
    resolved.behaviorRecipes,
  );
  const expected = new Set(plan.instances.map((instance) => instance.id));
  const components = new Map(
    plan.instances.map((instance) => [
      instance.id,
      resolveDataSceneInstanceComponents(instance),
    ]),
  );
  const spatial =
    value.spatial === undefined
      ? undefined
      : resolveSpatialProgress(value.spatial);
  if (spatial !== undefined && resolved.spatial === undefined)
    throw new Error(
      "Data Scene spatial progress requires an authored spatial scene.",
    );
  const interactions = new Map<string, boolean>();
  for (const binding of plan.bindings) {
    if (binding.command.type === "configureInteraction")
      interactions.set(binding.instance.id, binding.command.once);
  }
  for (const instance of value.instances) {
    if (
      !isRecord(instance) ||
      Object.keys(instance).some(
        (key) =>
          ![
            "id",
            "removed",
            "interactionConsumed",
            "bodyEnabled",
            "colliderEnabled",
            "animation",
            "spatialPose",
          ].includes(key),
      ) ||
      typeof instance.id !== "string" ||
      !expected.delete(instance.id) ||
      typeof instance.removed !== "boolean" ||
      typeof instance.interactionConsumed !== "boolean" ||
      (instance.interactionConsumed &&
        (instance.removed || interactions.get(instance.id) !== true))
    ) {
      throw new Error(
        "Data Scene progress has an unknown/duplicate instance ID or invalid interaction state.",
      );
    }
    const component = components.get(instance.id);
    const needsPose =
      spatial !== undefined &&
      spatial.camera !== null &&
      !instance.removed &&
      Object.prototype.hasOwnProperty.call(
        resolved.spatial!.billboards,
        instance.id,
      );
    if (needsPose !== (instance.spatialPose !== undefined))
      throw new Error(
        "Data Scene spatial progress requires poses for all live authored billboards, and only those billboards.",
      );
    if (instance.spatialPose !== undefined) {
      const pose = resolveSpatialPose(instance.spatialPose);
      if (
        component?.mode !== "inline" ||
        (pose.heightSpan !== null && component.body === undefined) ||
        (resolved.spatial?.actor?.instanceId === instance.id &&
          pose.heightSpan === null)
      ) {
        throw new Error(
          "Data Scene spatial pose heightSpan requires an authored body; the native actor requires a span.",
        );
      }
      if (
        pose.surfaceId !== undefined &&
        !resolved.spatial!.terrain.some((s) => s.id === pose.surfaceId)
      )
        throw new Error("Data Scene spatial pose references unknown terrain.");
    }
    if (
      (instance.bodyEnabled !== undefined &&
        (typeof instance.bodyEnabled !== "boolean" ||
          instance.removed ||
          component?.mode !== "inline" ||
          component.body === undefined)) ||
      (instance.colliderEnabled !== undefined &&
        (typeof instance.colliderEnabled !== "boolean" ||
          instance.removed ||
          component?.mode !== "inline" ||
          component.collider.type === "none"))
    ) {
      throw new Error(
        "Data Scene progress physics flags require a live instance with the authored body/collider.",
      );
    }
    if (instance.animation !== undefined) {
      const animation = instance.animation;
      const clips =
        component?.mode === "inline"
          ? component.sprite.animationSet?.clips
          : undefined;
      const clip = clips?.find(
        (clip) => isRecord(animation) && clip.id === animation.clip,
      );
      if (
        instance.removed ||
        !isRecord(animation) ||
        Object.keys(animation).some(
          (key) =>
            ![
              "clip",
              "elapsedSeconds",
              "paused",
              "flipX",
              "flipY",
              "movement",
            ].includes(key),
        ) ||
        clip === undefined ||
        typeof animation.elapsedSeconds !== "number" ||
        !Number.isFinite(animation.elapsedSeconds) ||
        animation.elapsedSeconds < 0 ||
        typeof animation.paused !== "boolean" ||
        typeof animation.flipX !== "boolean" ||
        typeof animation.flipY !== "boolean"
      ) {
        throw new Error(
          "Data Scene animation progress requires live authored clips and valid playback state.",
        );
      }
      const duration = clip.frames.length / Math.fround(clip.fps);
      if (
        animation.elapsedSeconds > duration ||
        (clip.loop !== false && animation.elapsedSeconds >= duration)
      )
        throw new Error(
          "Data Scene animation progress time exceeds its clip duration.",
        );
      if (animation.movement !== undefined) {
        const movement = compileDataSceneMovementAnimation(animation.movement);
        if (resolved.gameplay?.primaryActor !== instance.id)
          throw new Error(
            "Data Scene movement animation progress requires the authored primaryActor.",
          );
        for (let index = 0; index < movement.poses.length; index += 3) {
          if (!clips!.some((clip) => clip.id === movement.poses[index]))
            throw new Error(
              "Data Scene movement animation progress references an unknown clip.",
            );
        }
      }
    }
  }
  if (expected.size !== 0)
    throw new Error(
      "Data Scene progress must include every authored instance.",
    );
  if (value.navigation !== null) {
    const navigation = resolveDataSceneNavigationSpec(
      value.navigation,
      "dataScene.progress.navigation",
    );
    for (const obstacle of navigation.obstacles ?? []) {
      const component = components.get(obstacle.instanceId);
      if (component?.mode !== "inline" || component.collider.type === "none")
        throw new Error(
          "Data Scene progress obstacle requires an authored collider instance.",
        );
    }
  }
}

function preflightEnvironmentProgress(
  engine: FerrumEngine,
  progress: DataSceneProgressSnapshot,
  document: unknown,
  options: ApplyDataSceneAuthoringDocumentOptions,
): void {
  const resolved = resolveSceneAuthoringDocument(document);
  if (
    !resolved.spatial ||
    !progress.spatial ||
    progress.spatial.camera === null
  )
    return;
  const environment =
    progress.spatial.environment === undefined
      ? resolved.spatial.environment
      : progress.spatial.environment;
  if (!environment?.lighting?.shadows) return;
  const plan = bindSceneBehaviorRecipes(
    resolved.sceneComposition,
    resolved.behaviorRecipes,
  );
  preflightDataSceneSpatialEnvironment(
    engine,
    resolved.spatial,
    plan.instances,
    options,
    environment,
    new Set(
      progress.instances
        .filter((instance) => instance.removed)
        .map((instance) => instance.id),
    ),
  );
}

function preflightSpatialProgress(
  adapter: DataSceneProgressAdapter,
  progress: DataSceneProgressSnapshot,
  spec?: DataSceneSpatialSpec,
): void {
  if (progress.spatial === undefined) return;
  if (spec === undefined)
    throw new Error(
      "Data Scene spatial progress requires an authored spatial scene.",
    );
  const terrain = compileSpatialTerrain(spec.terrain);
  const values = spatialProgressValues(
    progress.spatial,
    progress.instances,
    spec,
    adapter.viewport(),
  );
  if (!adapter.preflightSpatial(terrain.values, terrain.metadata, values))
    throw new Error(
      "Data Scene spatial progress camera/pose/surface preflight rejected saved state.",
    );
}

const DIRECTIONS = ["up", "down", "left", "right"] as const;
function decodeAnimation(
  values: Float64Array,
): NonNullable<DataSceneProgressSnapshot["instances"][number]["animation"]> {
  const poses = (offset: number) =>
    Object.fromEntries(
      DIRECTIONS.map((direction, index) => [
        direction,
        {
          clip: values[offset + index * 3]!,
          flipX: values[offset + index * 3 + 1] === 1,
          flipY: values[offset + index * 3 + 2] === 1,
        },
      ]),
    ) as DataSceneMovementAnimationSpec["idle"];
  return {
    clip: values[1]!,
    elapsedSeconds: values[2]!,
    paused: values[3] === 1,
    flipX: values[4] === 1,
    flipY: values[5] === 1,
    ...(values[6] === 0
      ? {}
      : {
          movement: {
            initialDirection: DIRECTIONS[values[7]!]!,
            idle: poses(8),
            walk: poses(20),
          },
        }),
  };
}

function requireAdapter(engine: FerrumEngine): DataSceneProgressAdapter {
  const adapter = adapters.get(engine);
  if (adapter === undefined)
    throw new Error(
      "Data Scene progress requires a FerrumEngine created by createEngine().",
    );
  return adapter;
}
function handleBuffer(
  ids: readonly string[],
  handles: Readonly<Record<string, GameplayEntityHandle>>,
): Uint32Array {
  return Uint32Array.from(
    ids.flatMap((id) => {
      const handle = handles[id];
      if (handle === undefined)
        throw new Error(`Data Scene progress is missing instance '${id}'.`);
      return [handle.entityId, handle.entityGeneration];
    }),
  );
}
function unsupportedOptions(
  options: ApplyDataSceneAuthoringDocumentOptions,
): string[] {
  return Object.entries(options)
    .filter(
      ([key, value]) =>
        value !== undefined &&
        ![
          "path",
          "textureId",
          "colorManagement",
          "instanceHandleRegistry",
        ].includes(key) &&
        !(
          [
            "activateDataScene",
            "validateBindings",
            "validateComponents",
          ].includes(key) && value === true
        ),
    )
    .map(([key]) => key);
}
function canonicalDocument(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    isRecord(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
