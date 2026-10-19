import type { ColorManagementMode } from "./colorManagement.js";
import { resolveColorManagementMode } from "./colorManagement.js";
import type { DataSceneSpriteFrameSpec, DataSceneTextureRefSpec } from "./dataSceneComponents.js";
import { dataSceneVisualColor } from "./dataSceneVisualColor.js";
import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import type { GameplayEntityHandle } from "./gameplayAuthoring.js";

/** A bounded atlas sequence. Frames may reverse UV endpoints; time is per projectile. */
export interface DataSceneProjectileAnimationSpec {
  frames: readonly DataSceneSpriteFrameSpec[];
  fps: number;
  loop?: boolean;
}
/** Reusable projectile presentation. Collider dimensions are world units. */
export interface DataSceneProjectilePrefabSpec {
  sprite: {
    texture: DataSceneTextureRefSpec;
    width: number;
    height: number;
    frame?: DataSceneSpriteFrameSpec;
    animation?: DataSceneProjectileAnimationSpec;
  };
  /** Local +X follows projected velocity. Visual only; collider and simulation rotation are unchanged. */
  rotateToVelocity?: boolean;
  collider: { halfWidth: number; halfHeight: number };
  /** Upright camera-facing sprite; elevation is relative to the source visual elevation. */
  billboard?: { unitsPerPixel?: number; alphaCutoff?: number; elevation?: number };
  /** sRGB hex, converted to the apply renderer's working space. Defaults to white. */
  color?: string;
}

export interface DataSceneProjectilePrefabBinding {
  source: GameplayEntityHandle;
  actionId: number;
  prefab: string;
}

export const MAX_DATA_SCENE_PROJECTILE_PREFABS = 256;
export const MAX_DATA_SCENE_PROJECTILE_BINDINGS = 8192;

function object(value: unknown, allowed: readonly string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result))
    if (!allowed.includes(key))
      throw gameplayAuthoringDiagnosticError(`${path}.${key}`, "is not supported");
  return result;
}
function number(
  value: unknown,
  path: string,
  minimum: number,
  maximum = Infinity,
  positive = false,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isFinite(Math.fround(value)) ||
    value < minimum ||
    value > maximum ||
    (positive && Math.fround(value) <= 0)
  ) {
    throw gameplayAuthoringDiagnosticError(path, "must fit the supported finite float32 range");
  }
  return value;
}
function u32(value: unknown, path: string, minimum = 0): number {
  const result = number(value, path, minimum, 0xffffffff);
  if (!Number.isInteger(result))
    throw gameplayAuthoringDiagnosticError(path, "must be a uint32 integer");
  return result;
}

function texture(value: unknown, path: string): number {
  const id = u32(value, path);
  if (id > 0xffffff)
    throw gameplayAuthoringDiagnosticError(
      path,
      "texture ID must be in 0..16777215 for exact spatial vertex storage",
    );
  return id;
}

function atlasFrame(value: unknown, path: string): Required<DataSceneSpriteFrameSpec> {
  const frame = object(value, ["u0", "v0", "u1", "v1"], path);
  const u0 = number(frame.u0 ?? 0, `${path}.u0`, 0, 1),
    v0 = number(frame.v0 ?? 0, `${path}.v0`, 0, 1);
  const u1 = number(frame.u1 ?? 1, `${path}.u1`, 0, 1),
    v1 = number(frame.v1 ?? 1, `${path}.v1`, 0, 1);
  if (Math.fround(u0) === Math.fround(u1) || Math.fround(v0) === Math.fround(v1))
    throw gameplayAuthoringDiagnosticError(
      path,
      "must retain non-zero UV area in float32; reversed endpoints are allowed",
    );
  return { u0, v0, u1, v1 };
}

export function projectileVisualsRequired(
  catalog: Readonly<Record<string, DataSceneProjectilePrefabSpec>> | undefined,
): boolean {
  return Object.values(catalog ?? {}).some(
    (prefab) => prefab.sprite.animation !== undefined || prefab.rotateToVelocity === true,
  );
}

export function resolveDataSceneProjectilePrefabs(
  value: unknown,
  path: string,
): Readonly<Record<string, DataSceneProjectilePrefabSpec>> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw gameplayAuthoringDiagnosticError(path, "must be a prefab catalog");
  const entries = Object.entries(value);
  if (entries.length > MAX_DATA_SCENE_PROJECTILE_PREFABS)
    throw gameplayAuthoringDiagnosticError(path, "supports at most 256 projectile prefabs");
  return Object.fromEntries(
    entries.map(([name, input]) => {
      if (!name.trim())
        throw gameplayAuthoringDiagnosticError(path, "prefab names must be non-empty");
      const p = `${path}.${name}`,
        prefab = object(input, ["sprite", "collider", "billboard", "color", "rotateToVelocity"], p);
      const sprite = object(
        prefab.sprite,
        ["texture", "width", "height", "frame", "animation"],
        `${p}.sprite`,
      );
      if (typeof sprite.texture === "string") {
        if (!sprite.texture.trim())
          throw gameplayAuthoringDiagnosticError(
            `${p}.sprite.texture`,
            "must be a non-empty asset name",
          );
      } else texture(sprite.texture, `${p}.sprite.texture`);
      const width = number(sprite.width, `${p}.sprite.width`, 0, 10_000, true),
        height = number(sprite.height, `${p}.sprite.height`, 0, 10_000, true);
      let animation: DataSceneProjectileAnimationSpec | undefined;
      if (sprite.animation !== undefined) {
        const a = object(sprite.animation, ["frames", "fps", "loop"], `${p}.sprite.animation`);
        if (!Array.isArray(a.frames) || a.frames.length < 1 || a.frames.length > 32)
          throw gameplayAuthoringDiagnosticError(
            `${p}.sprite.animation.frames`,
            "requires 1..32 atlas frames",
          );
        if (a.loop !== undefined && typeof a.loop !== "boolean")
          throw gameplayAuthoringDiagnosticError(`${p}.sprite.animation.loop`, "must be a boolean");
        animation = {
          frames: Array.from(a.frames, (frame, index) =>
            atlasFrame(frame, `${p}.sprite.animation.frames.${index}`),
          ),
          fps: number(a.fps, `${p}.sprite.animation.fps`, 0.001, 1000),
          loop: a.loop === undefined ? true : (a.loop as boolean),
        };
      }
      const frame = atlasFrame(sprite.frame ?? animation?.frames[0] ?? {}, `${p}.sprite.frame`);
      if (
        animation &&
        ["u0", "v0", "u1", "v1"].some(
          (key) =>
            Math.fround(frame[key as keyof typeof frame]) !==
            Math.fround(animation!.frames[0][key as keyof typeof frame]!),
        )
      )
        throw gameplayAuthoringDiagnosticError(
          `${p}.sprite.frame`,
          "must match the animation's first frame when supplied",
        );
      if (prefab.rotateToVelocity !== undefined && typeof prefab.rotateToVelocity !== "boolean")
        throw gameplayAuthoringDiagnosticError(`${p}.rotateToVelocity`, "must be a boolean");
      const collider = object(prefab.collider, ["halfWidth", "halfHeight"], `${p}.collider`);
      const halfWidth = number(collider.halfWidth, `${p}.collider.halfWidth`, 0, 10_000, true),
        halfHeight = number(collider.halfHeight, `${p}.collider.halfHeight`, 0, 10_000, true);
      const billboard =
        prefab.billboard === undefined
          ? {}
          : object(
              prefab.billboard,
              ["unitsPerPixel", "alphaCutoff", "elevation"],
              `${p}.billboard`,
            );
      const unitsPerPixel = number(
        billboard.unitsPerPixel ?? 1,
        `${p}.billboard.unitsPerPixel`,
        0,
        10_000,
        true,
      );
      const alphaCutoff = number(billboard.alphaCutoff ?? 0.01, `${p}.billboard.alphaCutoff`, 0, 1),
        elevation = number(
          billboard.elevation ?? 0,
          `${p}.billboard.elevation`,
          -1_000_000,
          1_000_000,
        );
      if (prefab.color !== undefined && typeof prefab.color !== "string")
        throw gameplayAuthoringDiagnosticError(`${p}.color`, "must be an sRGB hex string");
      const color = prefab.color as string | undefined; // checked above; color parser validates its hex syntax.
      dataSceneVisualColor(color, `${p}.color`);
      return [
        name,
        {
          sprite: {
            texture: sprite.texture as DataSceneTextureRefSpec,
            width,
            height,
            frame,
            ...(animation === undefined ? {} : { animation }),
          },
          collider: { halfWidth, halfHeight },
          billboard: { unitsPerPixel, alphaCutoff, elevation },
          ...(color === undefined ? {} : { color }),
          ...(prefab.rotateToVelocity === undefined
            ? {}
            : { rotateToVelocity: prefab.rotateToVelocity as boolean }),
        },
      ];
    }),
  );
}

/** Resolve all assets and numeric bounds before authoring activation can replace the current scene. */
export function resolveDataSceneProjectileTextures(
  catalog: Readonly<Record<string, DataSceneProjectilePrefabSpec>>,
  textureId: (name: string) => number,
): Readonly<Record<string, DataSceneProjectilePrefabSpec>> {
  return Object.fromEntries(
    Object.entries(catalog).map(([name, prefab]) => {
      const textureIdValue = texture(
        typeof prefab.sprite.texture === "number"
          ? prefab.sprite.texture
          : textureId(prefab.sprite.texture),
        `projectilePrefabs.${name}.sprite.texture`,
      );
      return [name, { ...prefab, sprite: { ...prefab.sprite, texture: textureIdValue } }];
    }),
  );
}

/** Cold configuration ABI v1: definition metadata stride 2, values 15, bindings 4. */
export function compileDataSceneProjectilePrefabs(
  catalog: Readonly<Record<string, DataSceneProjectilePrefabSpec>>,
  bindings: readonly DataSceneProjectilePrefabBinding[],
  colorManagement: ColorManagementMode = "legacy",
) {
  resolveColorManagementMode(colorManagement);
  const resolved = resolveDataSceneProjectilePrefabs(
      catalog,
      "dataScene.gameplay.projectilePrefabs",
    ),
    names = Object.keys(resolved).sort();
  if (bindings.length > MAX_DATA_SCENE_PROJECTILE_BINDINGS)
    throw gameplayAuthoringDiagnosticError(
      "dataScene.gameplay.projectileBindings",
      "supports at most 8192 bindings",
    );
  const metadata = new Uint32Array(names.length * 2),
    values = new Float32Array(names.length * 15),
    bindingValues = new Uint32Array(bindings.length * 4);
  names.forEach((name, index) => {
    const p = resolved[name],
      s = p.sprite,
      f = s.frame!,
      b = p.billboard!;
    metadata.set(
      [index + 1, texture(s.texture, `projectilePrefabs.${name}.sprite.texture`)],
      index * 2,
    );
    values.set(
      [
        s.width,
        s.height,
        f.u0!,
        f.v0!,
        f.u1!,
        f.v1!,
        p.collider.halfWidth,
        p.collider.halfHeight,
        b.unitsPerPixel!,
        b.alphaCutoff!,
        b.elevation!,
        ...dataSceneVisualColor(p.color, `projectilePrefabs.${name}.color`, colorManagement),
      ],
      index * 15,
    );
  });
  const seen = new Set<string>();
  bindings.forEach((binding, index) => {
    const path = `dataScene.gameplay.projectileBindings.${index}`,
      id = names.indexOf(binding.prefab) + 1;
    if (id === 0)
      throw gameplayAuthoringDiagnosticError(
        `${path}.prefab`,
        "must reference a declared projectile prefab",
      );
    const sourceId = u32(binding.source.entityId, `${path}.source.entityId`),
      generation = u32(binding.source.entityGeneration, `${path}.source.entityGeneration`),
      action = u32(binding.actionId, `${path}.actionId`, 1);
    const key = `${sourceId}:${generation}:${action}`;
    if (seen.has(key))
      throw gameplayAuthoringDiagnosticError(path, "must bind each source/action only once");
    seen.add(key);
    bindingValues.set([sourceId, generation, action, id], index * 4);
  });
  if (!projectileVisualsRequired(resolved)) return { metadata, values, bindings: bindingValues };
  const visualMetadata = new Uint32Array(names.length * 4),
    fps = new Float32Array(names.length);
  const frames = new Float32Array(
    names.reduce((sum, name) => sum + (resolved[name].sprite.animation?.frames.length ?? 0) * 4, 0),
  );
  let offset = 0;
  names.forEach((name, index) => {
    const prefab = resolved[name],
      a = prefab.sprite.animation;
    visualMetadata.set(
      [
        index + 1,
        a?.frames.length ?? 0,
        +(a !== undefined && a.loop !== false),
        +(prefab.rotateToVelocity ?? false),
      ],
      index * 4,
    );
    fps[index] = a?.fps ?? 0;
    for (const frame of a?.frames ?? []) {
      frames.set([frame.u0!, frame.v0!, frame.u1!, frame.v1!], offset);
      offset += 4;
    }
  });
  return {
    metadata,
    values,
    bindings: bindingValues,
    visuals: { metadata: visualMetadata, fps, frames },
  };
}
