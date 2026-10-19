import {
  validateProjectileAnimationProgress,
  type DataSceneProjectileAnimationProgress,
  type DataSceneCombatVisualProgressSnapshot,
} from "./dataSceneProjectileVisualProgress.js";
import { projectileVisualsRequired } from "./dataSceneProjectilePrefabs.js";
import {
  actorContract,
  array,
  combatProgressValues,
  decodeCombatProgress,
  fail,
  f32,
  integer,
  record,
  validateCombatActorState,
  validateLegacyCombatProgress,
  type DataSceneCombatActorSnapshot,
  type DataSceneCombatProjectileSnapshot,
} from "./dataSceneCombatProgress.js";
import { bindSceneBehaviorRecipes } from "./gameplayAuthoring.js";
import { resolveSceneAuthoringDocument } from "./sceneAuthoringDocument.js";
import { resolveDataSceneInstanceComponents } from "./dataSceneComponents.js";
import { resolveCombatNavigation } from "./dataSceneCombatNavigation.js";
import type { DataSceneProgressSnapshot } from "./dataSceneProgress.js";

export type DataSceneCombatActorReference =
  | { readonly instanceId: string; readonly spawnSerial?: never }
  | { readonly spawnSerial: number; readonly instanceId?: never };
export interface DataSceneCombatSpawnedActorState extends Omit<DataSceneCombatActorSnapshot, "id"> {
  readonly interactionConsumed: boolean;
  readonly bodyEnabled: boolean | null;
  readonly colliderEnabled: readonly boolean[];
  readonly animation: {
    readonly clip: number;
    readonly elapsedSeconds: number;
    readonly paused: boolean;
    readonly flipX: boolean;
    readonly flipY: boolean;
  } | null;
  readonly legacyAnimation: {
    readonly state: "idle" | "moving";
    readonly frame: number;
    readonly elapsedSeconds: number;
  } | null;
  readonly visualElevation: number;
  readonly origin: { readonly x: number; readonly y: number };
}
export type DataSceneCombatSpawnedActorSnapshot =
  | { readonly serial: number; readonly prefab: string; readonly removed: true }
  | {
      readonly serial: number;
      readonly prefab: string;
      readonly removed: false;
      readonly state: DataSceneCombatSpawnedActorState;
    };
export interface DataSceneCombatSpawnProjectileSnapshot
  extends Omit<DataSceneCombatProjectileSnapshot, "sourceInstanceId"> {
  readonly sourceInstanceId?: never;
  readonly source: DataSceneCombatActorReference;
}
export interface DataSceneCombatSpawnProgressSnapshot {
  readonly version: 3;
  readonly actors: readonly DataSceneCombatActorSnapshot[];
  readonly spawnedActors: readonly DataSceneCombatSpawnedActorSnapshot[];
  /** Last issued serial, retained even when no spawned actors remain. */
  readonly lastSpawnSerial: number;
  readonly projectiles: readonly DataSceneCombatSpawnProjectileSnapshot[];
  readonly contacts: readonly (readonly [
    DataSceneCombatActorReference,
    DataSceneCombatActorReference,
  ])[];
}

const ACTOR = 72,
  SPAWN = 89,
  SHOT = 26;
const actorFields = [
  "pose",
  "velocityX",
  "velocityY",
  "angularVelocityRadiansPerSecond",
  "health",
  "lifetimeSeconds",
  "timer",
  "actionCooldowns",
  "reactionCooldowns",
];
const stateFields = [
  ...actorFields,
  "interactionConsumed",
  "bodyEnabled",
  "colliderEnabled",
  "animation",
  "legacyAnimation",
  "visualElevation",
  "origin",
];
function refKey(ref: DataSceneCombatActorReference): string {
  return ref.instanceId === undefined ? `s${ref.spawnSerial}` : `a${ref.instanceId}`;
}
function reference(value: unknown, path: string): DataSceneCombatActorReference {
  const ref = record(value, ["instanceId", "spawnSerial"], path);
  if (typeof ref.instanceId === "string" && Object.keys(ref).length === 1)
    return { instanceId: ref.instanceId };
  if (Object.keys(ref).length !== 1 || ref.spawnSerial === undefined)
    fail(`${path} requires exactly one actor reference.`);
  return { spawnSerial: integer(ref.spawnSerial, `${path}.spawnSerial`, 0xffffffff, 1) };
}
function time(value: unknown, path: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum)
    fail(`${path} exceeds the animation duration.`);
  return value as number; // Validated finite number with a bounded duration.
}

/** All semantic checks precede authoring activation. Native restore repeats definition checks. */
export function validateSpawnProgress(
  value: unknown,
  source: unknown,
  instances: DataSceneProgressSnapshot["instances"],
): asserts value is DataSceneCombatSpawnProgressSnapshot | DataSceneCombatVisualProgressSnapshot {
  const object = record(
    value,
    ["version", "actors", "spawnedActors", "lastSpawnSerial", "projectiles", "contacts"],
    "snapshot",
  );
  if (object.version !== 3 && object.version !== 4) fail("requires version 3 or 4.");
  const document = resolveSceneAuthoringDocument(source),
    catalog = document.gameplay?.spawnPrefabs ?? {};
  const visuals = projectileVisualsRequired(document.gameplay?.projectilePrefabs);
  if (
    document.gameplay?.combat !== true ||
    (object.version === 4) !== visuals ||
    (object.version === 3 && !Object.keys(catalog).length)
  )
    fail("version 3 requires actor prefabs; projectile animation/rotation requires version 4.");
  const plan = bindSceneBehaviorRecipes(document.sceneComposition, document.behaviorRecipes);
  const counter = integer(object.lastSpawnSerial, "lastSpawnSerial"),
    spawned = array(object.spawnedActors, "spawnedActors", 1024);
  if (!Object.keys(catalog).length && (spawned.length !== 0 || counter !== 0))
    fail("spawn state requires an actor catalog.");
  const shots = array(object.projectiles, "projectiles", 512),
    contacts = array(object.contacts, "contacts", 4096);
  const sources = new Map(
    instances.map((instance) => [refKey({ instanceId: instance.id }), instance.id]),
  );
  const live = new Set(
    instances
      .filter((instance) => !instance.removed)
      .map((instance) => refKey({ instanceId: instance.id })),
  );
  const dead = new Set<string>(),
    referred = new Set<string>();
  let previous = 0,
    liveSpawns = 0;
  const moving = new Set(
    plan.commands
      .filter((command) =>
        ["configureChase", "configureSeekTarget", "configureAccelerate"].includes(command.type),
      )
      .map((command) => command.entity),
  );
  const managed = new Set(
    plan.commands
      .filter(
        (command) =>
          command.type === "configureChase" ||
          (document.gameplay?.combatNavigation?.movementPatterns === "all" &&
            (command.type === "configureSeekTarget" || command.type === "configureAccelerate")),
      )
      .map((command) => command.entity),
  );
  let movementCount = instances.filter(
    (instance) => !instance.removed && moving.has(instance.id),
  ).length;
  let managedCount = instances.filter(
    (instance) =>
      !instance.removed &&
      instance.id !== document.gameplay?.primaryActor &&
      managed.has(instance.id),
  ).length;
  for (const [index, raw] of spawned.entries()) {
    const path = `spawnedActors.${index}`,
      item = record(raw, ["serial", "prefab", "removed", "state"], path),
      serial = integer(item.serial, `${path}.serial`, counter, 1);
    if (
      serial <= previous ||
      typeof item.prefab !== "string" ||
      !Object.prototype.hasOwnProperty.call(catalog, item.prefab) ||
      typeof item.removed !== "boolean"
    )
      fail(`${path} requires ordered unique serials and a catalog prefab.`);
    previous = serial;
    const id = catalog[item.prefab as string].prototypeInstanceId,
      key = refKey({ spawnSerial: serial }); // Catalog key validated above.
    sources.set(key, id);
    if (item.removed) {
      if (Object.prototype.hasOwnProperty.call(item, "state"))
        fail(`${path} removed records cannot have state.`);
      dead.add(key);
      continue;
    }
    live.add(key);
    liveSpawns++;
    movementCount += +moving.has(id);
    managedCount += +managed.has(id);
    const state = record(item.state, stateFields, `${path}.state`),
      instance = plan.instances.find((instance) => instance.id === id)!;
    const component = resolveDataSceneInstanceComponents(instance);
    if (component.mode !== "inline" || state.pose === null)
      fail(`${path} requires standalone inline components and a pose.`);
    validateCombatActorState(state, path, component, actorContract(plan, document, id, true));
    const pose = state.pose as NonNullable<DataSceneCombatActorSnapshot["pose"]>; // Shared actor validation established the pose shape.
    if ((pose.heightSpan !== null) !== (component.body?.heightSpan !== undefined))
      fail(`${path}.pose.heightSpan must match the prototype.`);
    let interactionOnce = false;
    for (const command of plan.commands)
      if (command.entity === id && command.type === "configureInteraction")
        interactionOnce = command.once;
    if (
      typeof state.interactionConsumed !== "boolean" ||
      (state.interactionConsumed && !interactionOnce)
    )
      fail(`${path}.interactionConsumed requires a once interaction.`);
    if (
      (state.bodyEnabled === null) !== (component.body === undefined) ||
      (state.bodyEnabled !== null && typeof state.bodyEnabled !== "boolean")
    )
      fail(`${path}.bodyEnabled must match the prototype.`);
    const colliders = array(state.colliderEnabled, `${path}.colliderEnabled`, 16);
    if (
      colliders.length !== (component.collider.type === "none" ? 0 : 1) ||
      [...colliders].some((flag) => typeof flag !== "boolean")
    )
      fail(`${path}.colliderEnabled must match the prototype.`);
    const animation = component.sprite.animationSet;
    if ((state.animation === null) !== (animation === undefined))
      fail(`${path}.animation must match the prototype.`);
    if (state.animation !== null) {
      const playback = record(
          state.animation,
          ["clip", "elapsedSeconds", "paused", "flipX", "flipY"],
          `${path}.animation`,
        ),
        clip = animation!.clips.find((clip) => clip.id === playback.clip);
      if (
        !clip ||
        [playback.paused, playback.flipX, playback.flipY].some((flag) => typeof flag !== "boolean")
      )
        fail(`${path}.animation has an unknown clip or invalid flag.`);
      const duration = clip.frames.length / Math.fround(clip.fps),
        elapsed = time(playback.elapsedSeconds, path, duration);
      if (clip.loop !== false && elapsed >= duration)
        fail(`${path}.animation looping time must remain below duration.`);
    }
    const legacy =
      component.sprite.animation && component.sprite.animation.frameCount > 1
        ? component.sprite.animation
        : undefined;
    if ((state.legacyAnimation === null) !== (legacy === undefined))
      fail(`${path}.legacyAnimation must match the prototype.`);
    if (state.legacyAnimation !== null) {
      const playback = record(
        state.legacyAnimation,
        ["state", "frame", "elapsedSeconds"],
        `${path}.legacyAnimation`,
      );
      if (playback.state !== "idle" && playback.state !== "moving")
        fail(`${path}.legacyAnimation state is unsupported.`);
      integer(playback.frame, path, legacy!.frameCount - 1);
      if (
        Math.fround(f32(playback.elapsedSeconds, path, 0)) >=
        Math.fround(1 / Math.fround(legacy!.fps))
      )
        fail(`${path}.legacyAnimation elapsed time exceeds a frame.`);
    }
    const elevation = f32(state.visualElevation, `${path}.visualElevation`);
    if (!document.spatial?.billboards[id] && elevation !== 0)
      fail(`${path}.visualElevation requires an authored billboard.`);
    f32(
      Math.fround(pose.heightSpan?.elevation ?? 0) + Math.fround(elevation),
      `${path}.visualElevation.top`,
    );
    const origin = record(state.origin, ["x", "y"], `${path}.origin`);
    for (const axis of ["x", "y"]) {
      f32(origin[axis], `${path}.origin.${axis}`, -1e6, 1e6);
      f32(pose[axis as "x" | "y"], `${path}.pose.${axis}`, -1e6, 1e6);
    }
  }
  if (liveSpawns > 512 || live.size + shots.length > 2048 || movementCount > 512)
    fail("exceeds the native actor capacity.");
  if (
    document.gameplay.combatNavigation &&
    managedCount >
      resolveCombatNavigation(document.gameplay.combatNavigation, "combatNavigation").maxAgents
  )
    fail("exceeds combat navigation maxAgents.");
  const visualStates: (DataSceneProjectileAnimationProgress | null)[] = [];
  const legacyShots = shots.map((raw, index) => {
    const path = `projectiles.${index}`,
      shot = record(
        raw,
        [
          ...(object.version === 4 ? ["animation"] : []),
          "source",
          "prefab",
          "x",
          "y",
          "velocityX",
          "velocityY",
          "heightSpan",
          "lifetimeSeconds",
          "damage",
          "collisionTarget",
          "sprite",
          "collider",
          "billboard",
          "faction",
        ],
        path,
      ),
      ref = reference(shot.source, `${path}.source`),
      key = refKey(ref),
      sourceInstanceId = sources.get(key);
    if (sourceInstanceId === undefined) fail(`${path} references an unknown actor.`);
    referred.add(key);
    if (object.version === 4) {
      const prefab =
        typeof shot.prefab === "string"
          ? document.gameplay?.projectilePrefabs?.[shot.prefab]
          : undefined;
      validateProjectileAnimationProgress(shot.animation, prefab, `${path}.animation`);
      visualStates.push(shot.animation);
    }
    const { source: _source, animation: _animation, ...fields } = shot;
    return { ...fields, sourceInstanceId };
  });
  if ([...dead].some((key) => !referred.has(key)))
    fail("removed spawned sources require a live projectile reference.");
  const pairs = new Set<string>();
  for (const [index, raw] of contacts.entries()) {
    if (!Array.isArray(raw) || raw.length !== 2)
      fail(`contacts.${index} requires two actor references.`);
    const keys = raw.map((ref, side) => refKey(reference(ref, `contacts.${index}.${side}`))).sort();
    if (keys[0] === keys[1] || keys.some((key) => !live.has(key)))
      fail("contacts require distinct live actors.");
    const key = JSON.stringify(keys);
    if (pairs.has(key)) fail("contains duplicate contact pairs.");
    pairs.add(key);
  }
  validateLegacyCombatProgress(
    { version: 2, actors: object.actors, projectiles: legacyShots, contacts: [] },
    source,
    instances,
    object.version === 4 ? visualStates : undefined,
  );
}

/** Sorted sparse semantic IDs from the document; no runtime handle is persisted. */
export function combatSpawnPrefabNames(source: unknown): ReadonlyMap<number, string> {
  const document = resolveSceneAuthoringDocument(source);
  return new Map(
    Object.keys(document.gameplay?.spawnPrefabs ?? {}).map((name) => [
      document.ids!.prefabs![name],
      name,
    ]),
  );
}

/** Reuse the unchanged v2 actor/projectile codec using temporary unambiguous reference keys. */
export function spawnProgressValues(
  progress: DataSceneCombatSpawnProgressSnapshot | DataSceneCombatVisualProgressSnapshot,
  ids: readonly string[],
  projectilePrefabs: readonly string[],
  spawnPrefabs: ReadonlyMap<number, string>,
): Float64Array {
  const refs: DataSceneCombatActorReference[] = [
      ...ids.map((instanceId) => ({ instanceId })),
      ...progress.spawnedActors.map((actor) => ({ spawnSerial: actor.serial })),
    ],
    keys = refs.map(refKey);
  const packet = combatProgressValues(
    {
      version: 2,
      actors: [
        ...progress.actors.map((actor) => ({ ...actor, id: refKey({ instanceId: actor.id }) })),
        ...progress.spawnedActors.flatMap((actor) =>
          actor.removed ? [] : [{ ...actor.state, id: refKey({ spawnSerial: actor.serial }) }],
        ),
      ],
      projectiles: progress.projectiles.map(({ source, sourceInstanceId: _id, ...shot }) => ({
        ...shot,
        sourceInstanceId: refKey(source),
      })),
      contacts: progress.contacts.map((pair) => [refKey(pair[0]), refKey(pair[1])]),
    },
    keys,
    projectilePrefabs,
  );
  const header = progress.version === 4 ? 7 : 6,
    shotStride = progress.version === 4 ? 32 : SHOT;
  const values = new Float64Array(
    header +
      ids.length * ACTOR +
      progress.spawnedActors.length * SPAWN +
      progress.projectiles.length * shotStride +
      progress.contacts.length * 2,
  );
  values.set([
    progress.version,
    ids.length,
    progress.projectiles.length,
    progress.contacts.length,
    progress.spawnedActors.length,
    progress.lastSpawnSerial,
  ]);
  if (progress.version === 4) values[6] = +(spawnPrefabs.size !== 0);
  values.set(packet.subarray(4, 4 + ids.length * ACTOR), header);
  const names = new Map([...spawnPrefabs].map(([id, name]) => [name, id]));
  let offset = header + ids.length * ACTOR;
  progress.spawnedActors.forEach((actor, index) => {
    const prefab = names.get(actor.prefab);
    if (prefab === undefined) fail("spawn prefab is missing from the authored catalog.");
    values.set([actor.serial, prefab], offset);
    if (!actor.removed) {
      const s = actor.state,
        mask = s.colliderEnabled.reduce((mask, flag, i) => mask | (+flag << i), 0);
      values[offset + 2] =
        1 |
        (+s.interactionConsumed << 1) |
        (+(s.bodyEnabled !== null) << 2) |
        (+(s.bodyEnabled === true) << 3) |
        (+(s.colliderEnabled.length === 1) << 4) |
        (+(s.colliderEnabled.length === 1 && s.colliderEnabled[0]) << 5);
      values.set(
        packet.subarray(4 + (ids.length + index) * ACTOR, 4 + (ids.length + index + 1) * ACTOR),
        offset + 3,
      );
      const a = s.animation,
        l = s.legacyAnimation;
      values.set(
        [
          +(a !== null),
          a?.clip ?? 0,
          a?.elapsedSeconds ?? 0,
          +(a?.paused ?? false),
          +(a?.flipX ?? false),
          +(a?.flipY ?? false),
          +(l !== null),
          +(l?.state === "moving"),
          l?.frame ?? 0,
          l?.elapsedSeconds ?? 0,
          s.visualElevation,
          s.origin.x,
          s.origin.y,
          mask,
        ],
        offset + 75,
      );
    }
    offset += SPAWN;
  });
  if (progress.version === 3) values.set(packet.subarray(4 + keys.length * ACTOR), offset);
  else {
    progress.projectiles.forEach((shot, index) => {
      const start = 4 + keys.length * ACTOR + index * SHOT,
        a = shot.animation;
      values.set(packet.subarray(start, start + SHOT), offset);
      values.set(
        [
          +(a !== null),
          0,
          a?.elapsedSeconds ?? 0,
          +(a?.paused ?? false),
          +(a?.flipX ?? false),
          +(a?.flipY ?? false),
        ],
        offset + SHOT,
      );
      offset += shotStride;
    });
    values.set(
      packet.subarray(4 + keys.length * ACTOR + progress.projectiles.length * SHOT),
      offset,
    );
  }
  return values;
}

export function decodeSpawnProgress(
  values: Float64Array,
  ids: readonly string[],
  projectilePrefabs: readonly string[],
  spawnPrefabs: ReadonlyMap<number, string>,
): DataSceneCombatSpawnProgressSnapshot | DataSceneCombatVisualProgressSnapshot {
  const version = values[0] === 4 ? 4 : 3,
    header = version === 4 ? 7 : 6,
    shotStride = version === 4 ? 32 : SHOT;
  const count = integer(values[4], "native spawn count", 1024),
    counter = integer(values[5], "native last serial"),
    shots = integer(values[2], "native projectile count", 512),
    contacts = integer(values[3], "native contact count", 4096);
  if (
    values[1] !== ids.length ||
    values.length !==
      header + ids.length * ACTOR + count * SPAWN + shots * shotStride + contacts * 2
  )
    fail("has an unsupported native spawn codec layout.");
  if (
    version === 4 &&
    (values[6] !== +(spawnPrefabs.size !== 0) ||
      (values[6] === 0 && (count !== 0 || counter !== 0)))
  )
    fail("native actor catalog presence does not match authoring.");
  const records = Array.from({ length: count }, (_, index) =>
    values.subarray(
      header + ids.length * ACTOR + index * SPAWN,
      header + ids.length * ACTOR + (index + 1) * SPAWN,
    ),
  );
  const refs: DataSceneCombatActorReference[] = [
      ...ids.map((instanceId) => ({ instanceId })),
      ...records.map((r) => ({ spawnSerial: integer(r[0], "native serial", counter, 1) })),
    ],
    keys = refs.map(refKey);
  const packet = new Float64Array(4 + keys.length * ACTOR + shots * SHOT + contacts * 2);
  packet.set([2, keys.length, shots, contacts]);
  packet.set(values.subarray(header, header + ids.length * ACTOR), 4);
  records.forEach((r, i) => packet.set(r.subarray(3, 75), 4 + (ids.length + i) * ACTOR));
  const shotOffset = header + ids.length * ACTOR + count * SPAWN;
  for (let index = 0; index < shots; index++)
    packet.set(
      values.subarray(shotOffset + index * shotStride, shotOffset + index * shotStride + SHOT),
      4 + keys.length * ACTOR + index * SHOT,
    );
  packet.set(
    values.subarray(shotOffset + shots * shotStride),
    4 + keys.length * ACTOR + shots * SHOT,
  );
  const legacy = decodeCombatProgress(packet, keys, projectilePrefabs);
  if (legacy.version === 3 || legacy.version === 4) fail("internal v2 decode changed version.");
  const actors = new Map(legacy.actors.map((actor) => [actor.id, actor])),
    references = new Map(keys.map((key, index) => [key, refs[index]!]));
  const result: DataSceneCombatSpawnProgressSnapshot = {
    version: 3,
    lastSpawnSerial: counter,
    actors: ids.flatMap((id) => {
      const a = actors.get(refKey({ instanceId: id }));
      return a ? [{ ...a, id }] : [];
    }),
    spawnedActors: records.map((r, index) => {
      const prefab = spawnPrefabs.get(r[1]!);
      if (prefab === undefined) fail("native spawn prefab is out of bounds.");
      const serial = r[0]!;
      if (r[2] === 0) return { serial, prefab, removed: true };
      const actor = actors.get(keys[ids.length + index]!)!;
      if (!actor) fail("native live spawn is missing actor state.");
      const { id: _id, ...state } = actor,
        flags = r[2]!;
      // Public inline components have at most one collider; native also supports internal compounds.
      if (r[88]! > 1) fail("native compound spawn colliders are not publicly authored.");
      return {
        serial,
        prefab,
        removed: false,
        state: {
          ...state,
          interactionConsumed: (flags & 2) !== 0,
          bodyEnabled: flags & 4 ? (flags & 8) !== 0 : null,
          colliderEnabled: flags & 16 ? [(flags & 32) !== 0] : [],
          animation:
            r[75] === 0
              ? null
              : {
                  clip: r[76]!,
                  elapsedSeconds: r[77]!,
                  paused: r[78] === 1,
                  flipX: r[79] === 1,
                  flipY: r[80] === 1,
                },
          legacyAnimation:
            r[81] === 0
              ? null
              : { state: r[82] === 0 ? "idle" : "moving", frame: r[83]!, elapsedSeconds: r[84]! },
          visualElevation: r[85]!,
          origin: { x: r[86]!, y: r[87]! },
        },
      };
    }),
    projectiles: legacy.projectiles.map(({ sourceInstanceId, ...shot }) => ({
      ...shot,
      source: references.get(sourceInstanceId!)!,
    })),
    contacts: legacy.contacts.map((pair) => [references.get(pair[0])!, references.get(pair[1])!]),
  };
  if (version === 3) return result;
  return {
    ...result,
    version: 4,
    projectiles: result.projectiles.map((shot, index) => {
      const p = values.subarray(
        shotOffset + index * shotStride + SHOT,
        shotOffset + (index + 1) * shotStride,
      );
      if (
        (p[0] !== 0 && p[0] !== 1) ||
        p[1] !== 0 ||
        p[2]! < 0 ||
        !Number.isFinite(p[2]) ||
        p.subarray(3).some((flag) => flag !== 0 && flag !== 1) ||
        (p[0] === 0 && p.subarray(1).some((value) => value !== 0))
      )
        fail("native projectile playback is invalid.");
      return {
        ...shot,
        animation:
          p[0] === 0
            ? null
            : { elapsedSeconds: p[2]!, paused: p[3] === 1, flipX: p[4] === 1, flipY: p[5] === 1 },
      };
    }),
  };
}
