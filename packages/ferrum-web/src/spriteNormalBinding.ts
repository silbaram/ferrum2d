import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import {
  resolveDataSceneSpriteAnimationSet,
  type DataSceneSpriteAnimationSetSpec,
} from "./dataSceneSpriteAnimation.js";
import {
  resolveSceneAuthoringDocument,
  type SceneAuthoringDocumentSpec,
} from "./sceneAuthoringDocument.js";
import { mergeScenePlacementPatch } from "./scenePlacementPatch.js";
import type { ScenePlacementPatch } from "./scenePlacementViewer.js";
import type { SceneCompositionJsonValue } from "./sceneComposition.js";
import type { TextureColorSpace } from "./colorManagement.js";

export interface SpriteNormalTextureReference {
  asset: string;
  /** Generator report path only. The host chooses URLs and owns loading/writing. */
  path: string;
  sha256: string;
  colorSpace: "srgb" | "none";
}
export interface SpriteNormalAssetBinding {
  format: "ferrum2d.sprite-normal.binding";
  version: 1;
  width: number;
  height: number;
  textures: {
    color: SpriteNormalTextureReference;
    normal: SpriteNormalTextureReference;
  };
  frames: readonly { u0: number; v0: number; u1: number; v1: number }[];
  animationSet?: DataSceneSpriteAnimationSetSpec;
  generation: {
    repository: string;
    revision: string;
    binarySha256: string;
    configSha256: string;
    settings: Record<string, SceneCompositionJsonValue>;
    animation?: Record<string, SceneCompositionJsonValue>;
    input: { path: string; sha256: string };
    descriptorSha256?: string;
  };
}
export interface CreateSpriteNormalAssetBindingOptions {
  report: unknown;
  descriptor?: unknown;
  /** SHA-256 measured by the host from the descriptor file bytes. Required for animation exports. */
  descriptorSha256?: string;
  resultIndex?: number;
  colorAsset: string;
  normalAsset: string;
}
/** Metadata measured by the host from actual decoded/uploaded texture bytes, never inferred from a filename. */
export interface SpriteNormalTextureAsset {
  id: string;
  width: number;
  height: number;
  colorSpace: TextureColorSpace;
  sha256: string;
  frames?: SpriteNormalAssetBinding["frames"];
}
export interface SpriteNormalBindingDiagnostic {
  severity: "error";
  code:
    | "missingTexture"
    | "duplicateTexture"
    | "colorSpaceMismatch"
    | "dimensionsMismatch"
    | "contentHashMismatch"
    | "frameLayoutMismatch";
  path: string;
  assetId: string;
  message: string;
}
export interface SceneSpriteNormalBindingEvidence {
  instanceId: string;
  binding: SpriteNormalAssetBinding;
}
export interface CreateSceneSpriteNormalPatchOptions {
  instanceId: string;
  assets: readonly SpriteNormalTextureAsset[];
}

function fail(path: string, message: string): never {
  throw sceneCompositionDiagnosticError(`spriteNormal.${path}`, message);
}
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(path, "must be an object");
  return value as Record<string, unknown>;
}
function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail(path, "contains unsupported fields");
}
function resolveBindingFrames(
  value: unknown,
): SpriteNormalAssetBinding["frames"] {
  if (!Array.isArray(value)) fail("frames", "must be an array");
  for (const entry of value) {
    const frame = record(entry, "frame");
    keys(frame, ["u0", "v0", "u1", "v1"], "frame");
    if (["u0", "v0", "u1", "v1"].some((key) => typeof frame[key] !== "number"))
      fail("frames", "must provide all four UV coordinates");
  }
  return resolveDataSceneSpriteAnimationSet({
    clips: [{ id: 0, fps: 1, frames: value }],
  }).clips[0].frames.map((f) => ({
    u0: f.u0!,
    v0: f.v0!,
    u1: f.u1!,
    v1: f.v1!,
  }));
}
function text(value: unknown, path: string, max = 4096): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim() !== value ||
    value.length > max
  )
    fail(path, `must be a nonempty string of at most ${max} characters`);
  return value;
}
function hash(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^[a-f0-9]{64}$/.test(result)) fail(path, "must be lowercase SHA-256");
  return result;
}
function size(value: unknown, path: string): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 4096
  )
    fail(path, "must be an integer in 1..4096");
  return value as number;
}
function settings(
  value: unknown,
  path = "generation.settings",
): Record<string, SceneCompositionJsonValue> {
  record(value, path);
  let serialized: string;
  try {
    serialized = JSON.stringify(value, (_, item: unknown) => {
      if (
        (typeof item === "number" && !Number.isFinite(item)) ||
        item === undefined ||
        typeof item === "function" ||
        typeof item === "symbol" ||
        typeof item === "bigint"
      )
        throw new Error("Invalid JSON");
      return item;
    });
  } catch {
    fail(path, "must be finite JSON data");
  }
  if (serialized.length > 65536) fail(path, "exceeds 64 KiB");
  return record(JSON.parse(serialized), path) as Record<
    string,
    SceneCompositionJsonValue
  >;
}
function sameFrames(
  a: SpriteNormalAssetBinding["frames"],
  b: SpriteNormalAssetBinding["frames"],
): boolean {
  return (
    a.length === b.length &&
    a.every((frame, i) =>
      ["u0", "v0", "u1", "v1"].every(
        (key) =>
          Math.fround(frame[key as keyof typeof frame]) ===
          Math.fround(b[i][key as keyof typeof frame]),
      ),
    )
  );
}

/** Validate a persisted binding independently of session texture IDs. No I/O or scene mutations. */
export function resolveSpriteNormalAssetBinding(
  value: unknown,
): SpriteNormalAssetBinding {
  const input = record(value, "binding"),
    textures = record(input.textures, "textures");
  keys(
    input,
    [
      "format",
      "version",
      "width",
      "height",
      "textures",
      "frames",
      "animationSet",
      "generation",
    ],
    "binding",
  );
  keys(textures, ["color", "normal"], "textures");
  if (input.format !== "ferrum2d.sprite-normal.binding" || input.version !== 1)
    fail("binding", "requires ferrum2d.sprite-normal.binding version 1");
  const width = size(input.width, "width"),
    height = size(input.height, "height");
  if (width * height > 4_194_304) fail("binding", "exceeds 4,194,304 pixels");
  const texture = (kind: "color" | "normal"): SpriteNormalTextureReference => {
    const entry = record(textures[kind], `textures.${kind}`),
      colorSpace = kind === "color" ? "srgb" : "none";
    keys(entry, ["asset", "path", "sha256", "colorSpace"], `textures.${kind}`);
    if (entry.colorSpace !== colorSpace)
      fail(`textures.${kind}.colorSpace`, `must be ${colorSpace}`);
    return {
      asset: text(entry.asset, `textures.${kind}.asset`, 256),
      path: text(entry.path, `textures.${kind}.path`),
      sha256: hash(entry.sha256, `textures.${kind}.sha256`),
      colorSpace,
    };
  };
  const color = texture("color"),
    normal = texture("normal");
  if (color.asset === normal.asset)
    fail("textures", "color and normal must have different project names");
  const frames = resolveBindingFrames(input.frames);
  for (const f of frames)
    for (const [coordinate, extent] of [
      [f.u0, width],
      [f.u1, width],
      [f.v0, height],
      [f.v1, height],
    ])
      if (
        Math.abs(coordinate * extent - Math.round(coordinate * extent)) > 1e-4
      )
        fail("frames", "UV edges must lie on pixel boundaries");
  const animationSet =
    input.animationSet === undefined
      ? undefined
      : resolveDataSceneSpriteAnimationSet(input.animationSet);
  if (
    animationSet?.clips.some((clip) =>
      clip.frames.some(
        (frame) =>
          !frames.some((f) =>
            sameFrames(
              [f],
              [{ u0: frame.u0!, v0: frame.v0!, u1: frame.u1!, v1: frame.v1! }],
            ),
          ),
      ),
    )
  )
    fail("animationSet", "clip UVs must match the shared atlas frame layout");
  const generation = record(input.generation, "generation"),
    source = record(generation.input, "generation.input");
  keys(
    generation,
    [
      "repository",
      "revision",
      "binarySha256",
      "configSha256",
      "settings",
      "animation",
      "input",
      "descriptorSha256",
    ],
    "generation",
  );
  keys(source, ["path", "sha256"], "generation.input");
  const revision = text(generation.revision, "generation.revision");
  if (!/^[a-f0-9]{40}$/.test(revision))
    fail("generation.revision", "must be a full lowercase Git revision");
  return {
    format: "ferrum2d.sprite-normal.binding",
    version: 1,
    width,
    height,
    textures: { color, normal },
    frames,
    ...(animationSet ? { animationSet } : {}),
    generation: {
      repository: text(generation.repository, "generation.repository"),
      revision,
      binarySha256: hash(generation.binarySha256, "generation.binarySha256"),
      configSha256: hash(generation.configSha256, "generation.configSha256"),
      settings: settings(generation.settings),
      ...(generation.animation === undefined
        ? {}
        : {
            animation: settings(generation.animation, "generation.animation"),
          }),
      input: {
        path: text(source.path, "generation.input.path"),
        sha256: hash(source.sha256, "generation.input.sha256"),
      },
      ...(generation.descriptorSha256 === undefined
        ? {}
        : {
            descriptorSha256: hash(
              generation.descriptorSha256,
              "generation.descriptorSha256",
            ),
          }),
    },
  };
}

/** Report digests are provenance claims; diagnose against host-measured texture metadata before use. */
export function createSpriteNormalAssetBinding(
  options: CreateSpriteNormalAssetBindingOptions,
): SpriteNormalAssetBinding {
  const report = record(options.report, "report");
  if (
    report.format !== "ferrum2d.sprite-normals.report" ||
    report.version !== 1 ||
    report.ok !== true ||
    report.normalFormat !== "opengl" ||
    report.colorSpace !== "none"
  )
    fail(
      "report",
      "requires a completed OpenGL non-color generation report v1",
    );
  const index = options.resultIndex ?? 0;
  if (
    !Array.isArray(report.results) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= report.results.length
  )
    fail("resultIndex", "must select an existing report result");
  const result = record(report.results[index], "result"),
    generator = record(report.generator, "generator"),
    config = record(report.config, "config"),
    source = record(result.input, "input");
  if (!Array.isArray(result.outputs)) fail("outputs", "must be an array");
  const outputs = result.outputs.map((entry: unknown) =>
    record(entry, "outputs"),
  );
  const digest = (path: unknown): string => {
    const name = text(path, "output.path"),
      matches = outputs.filter((entry) => entry.path === name);
    if (matches.length !== 1)
      fail("outputs", `must uniquely contain '${name}'`);
    return hash(matches[0].sha256, "output.sha256");
  };
  let width = result.width,
    height = result.height,
    colorPath = result.color,
    normalPath = result.normal;
  let colorHash = source.sha256,
    normalHash = digest(normalPath),
    frames: unknown = [{ u0: 0, v0: 0, u1: 1, v1: 1 }],
    animationSet: unknown,
    descriptorSha256: string | undefined;
  if (result.ferrumAnimation !== undefined) {
    const files = record(result.ferrumAnimation, "ferrumAnimation"),
      descriptor = record(options.descriptor, "descriptor");
    if (
      descriptor.format !== "ferrum2d.sprite-normal.animation" ||
      descriptor.version !== 1
    )
      fail("descriptor", "requires animation descriptor v1");
    const atlas = record(descriptor.atlas, "descriptor.atlas"),
      textureRefs = record(descriptor.textures, "descriptor.textures"),
      raw = record(descriptor.source, "descriptor.source");
    const color = record(textureRefs.color, "descriptor.color"),
      normal = record(textureRefs.normal, "descriptor.normal");
    if (
      atlas.format !== "ferrum-texture-atlas-pack" ||
      atlas.version !== 1 ||
      atlas.texture !== "color" ||
      color.path !== files.color ||
      normal.path !== files.normal ||
      color.colorSpace !== "srgb" ||
      normal.colorSpace !== "none" ||
      atlas.image !== files.color ||
      raw.colorSha256 !== digest(result.color) ||
      raw.normalSha256 !== digest(result.normal)
    )
      fail(
        "descriptor",
        "color/normal paths, color spaces or source hashes differ from report",
      );
    width = atlas.width;
    height = atlas.height;
    colorPath = files.color;
    normalPath = files.normal;
    colorHash = digest(colorPath);
    normalHash = digest(normalPath);
    descriptorSha256 = digest(files.descriptor);
    if (hash(options.descriptorSha256, "descriptorSha256") !== descriptorSha256)
      fail("descriptorSha256", "descriptor bytes differ from report");
    const atlasFrames = record(atlas.frames, "descriptor.frames");
    frames = Object.keys(atlasFrames)
      .sort()
      .map((name) => {
        const frame = record(atlasFrames[name], "descriptor.frame"),
          uv = record(frame.uv, "descriptor.frame.uv"),
          dimensions = record(frame.size, "descriptor.frame.size");
        if (
          frame.texture !== "color" ||
          Math.abs(
            ((uv.u1 as number) - (uv.u0 as number)) * (width as number) -
              size(dimensions.width, "frame.width"),
          ) > 1e-4 ||
          Math.abs(
            ((uv.v1 as number) - (uv.v0 as number)) * (height as number) -
              size(dimensions.height, "frame.height"),
          ) > 1e-4
        )
          fail("descriptor.frames", "frame sizes and shared UVs must agree");
        return frame.uv;
      });
    animationSet = descriptor.animationSet;
    if (animationSet === undefined)
      fail("descriptor.animationSet", "is required");
  } else if (
    options.descriptor !== undefined ||
    options.descriptorSha256 !== undefined ||
    result.frames !== undefined
  )
    fail(
      "descriptor",
      "animated inputs require a Ferrum animation export; generate with animation.loop",
    );
  return resolveSpriteNormalAssetBinding({
    format: "ferrum2d.sprite-normal.binding",
    version: 1,
    width,
    height,
    textures: {
      color: {
        asset: options.colorAsset,
        path: colorPath,
        sha256: colorHash,
        colorSpace: "srgb",
      },
      normal: {
        asset: options.normalAsset,
        path: normalPath,
        sha256: normalHash,
        colorSpace: "none",
      },
    },
    frames,
    ...(animationSet === undefined ? {} : { animationSet }),
    generation: {
      repository: generator.repository,
      revision: generator.revision,
      binarySha256: generator.binarySha256,
      configSha256: config.sha256,
      settings: report.settings,
      ...(report.animation === undefined
        ? {}
        : { animation: report.animation }),
      input: { path: source.path, sha256: source.sha256 },
      ...(descriptorSha256 ? { descriptorSha256 } : {}),
    },
  });
}

export function diagnoseSpriteNormalAssetBinding(
  value: unknown,
  assets: readonly SpriteNormalTextureAsset[],
): readonly SpriteNormalBindingDiagnostic[] {
  const binding = resolveSpriteNormalAssetBinding(value),
    diagnostics: SpriteNormalBindingDiagnostic[] = [];
  for (const kind of ["color", "normal"] as const) {
    const ref = binding.textures[kind],
      path = `textures.${kind}`,
      matches = assets.filter((asset) => asset.id === ref.asset);
    const add = (
      code: SpriteNormalBindingDiagnostic["code"],
      message: string,
    ) =>
      diagnostics.push({
        severity: "error",
        code,
        path,
        assetId: ref.asset,
        message,
      });
    if (matches.length !== 1) {
      add(
        matches.length ? "duplicateTexture" : "missingTexture",
        `Expected one loaded texture '${ref.asset}'`,
      );
      continue;
    }
    const asset = matches[0];
    if (
      kind === "normal"
        ? asset.colorSpace !== "none" && asset.colorSpace !== "linear"
        : asset.colorSpace !== "srgb"
    )
      add("colorSpaceMismatch", `${kind} texture colorSpace is incompatible`);
    if (asset.width !== binding.width || asset.height !== binding.height)
      add(
        "dimensionsMismatch",
        "Decoded dimensions differ from the paired atlas",
      );
    if (asset.sha256 !== ref.sha256)
      add(
        "contentHashMismatch",
        "Loaded bytes differ from generation provenance; regenerate/rebind explicitly",
      );
    if (asset.frames !== undefined) {
      try {
        if (!sameFrames(resolveBindingFrames(asset.frames), binding.frames))
          add(
            "frameLayoutMismatch",
            "Texture UV layout differs from the shared frame layout",
          );
      } catch {
        add("frameLayoutMismatch", "Texture UV layout is invalid");
      }
    }
  }
  return diagnostics;
}

export function createSceneSpriteNormalPatch(
  document: SceneAuthoringDocumentSpec,
  value: unknown,
  options: CreateSceneSpriteNormalPatchOptions,
): { patch: ScenePlacementPatch; evidence: SceneSpriteNormalBindingEvidence } {
  const binding = resolveSpriteNormalAssetBinding(value),
    diagnostics = diagnoseSpriteNormalAssetBinding(binding, options.assets);
  if (diagnostics.length)
    fail(
      diagnostics[0].path,
      `${diagnostics[0].code}: ${diagnostics[0].message}`,
    );
  const resolved = resolveSceneAuthoringDocument(document, {
      validateBindings: true,
      validateComponents: true,
    }),
    instance = resolved.bindingPlan?.instances.find(
      (entry) => entry.id === options.instanceId,
    );
  if (!instance)
    fail("instanceId", "requires an existing applied sprite instance");
  const billboard = document.spatial?.billboards[options.instanceId];
  const components = structuredClone(
    record(instance.props.components, "components"),
  );
  const visual = record(components.visual, "components.visual");
  if (visual.kind !== "sprite")
    fail("components.visual", "requires a sprite visual");
  const initial =
    binding.animationSet?.clips.find(
      (clip) => clip.id === binding.animationSet!.initialClip,
    )?.frames[0] ?? binding.frames[0];
  components.visual = {
    ...visual,
    texture: binding.textures.color.asset,
    frame: { ...initial },
  };
  const nextVisual = components.visual as Record<string, unknown>;
  delete nextVisual.asset;
  if (billboard) delete nextVisual.normalTexture;
  else nextVisual.normalTexture = binding.textures.normal.asset;
  delete nextVisual.animation;
  delete nextVisual.animationSet;
  if (binding.animationSet)
    nextVisual.animationSet = structuredClone(binding.animationSet);
  const patch: ScenePlacementPatch = {
    format: "ferrum2d.scene-placement.patch",
    version: billboard ? 3 : 2,
    operations: [
      {
        kind: "updateComponents",
        instanceId: options.instanceId,
        components: components as SceneCompositionJsonValue,
      },
    ],
    ...(billboard ? { spatial: {
      format: "ferrum2d.scene-spatial.patch",
      version: 4,
      operations: [
        {
          kind: "setBillboardNormalTexture",
          id: options.instanceId,
          changes: { normalTexture: binding.textures.normal.asset },
        },
      ],
    } } : {}),
  };
  // Existing merge guards reject ambiguous/includes-only component targets before returning an applicable patch.
  mergeScenePlacementPatch(document, patch);
  return { patch, evidence: { instanceId: options.instanceId, binding } };
}

/** Internal handoff guard: reject provenance that no longer describes the emitted document/patch. */
export function resolveSceneSpriteNormalBindingEvidence(
  document: SceneAuthoringDocumentSpec,
  value: SceneSpriteNormalBindingEvidence,
): SceneSpriteNormalBindingEvidence {
  const binding = resolveSpriteNormalAssetBinding(value.binding),
    instanceId = text(value.instanceId, "instanceId", 256);
  const instance = resolveSceneAuthoringDocument(document, {
    validateBindings: true,
    validateComponents: true,
  }).bindingPlan?.instances.find((entry) => entry.id === instanceId);
  if (!instance) fail("handoff.instanceId", "binding instance is missing");
  const components = record(instance.props.components, "handoff.components"),
    visual = record(components.visual, "handoff.visual");
  if (
    visual.kind !== "sprite" ||
    (visual.texture ?? visual.asset) !== binding.textures.color.asset ||
    (document.spatial?.billboards[instanceId]
      ? document.spatial.billboards[instanceId].normalTexture : visual.normalTexture) !==
      binding.textures.normal.asset
  )
    fail("handoff", "asset references differ from the emitted document");
  const actual =
    visual.animationSet === undefined
      ? undefined
      : resolveDataSceneSpriteAnimationSet(visual.animationSet);
  if (JSON.stringify(actual) !== JSON.stringify(binding.animationSet))
    fail("handoff", "animation differs from generation evidence");
  const initial =
    binding.animationSet?.clips.find(
      (c) => c.id === binding.animationSet!.initialClip,
    )?.frames[0] ?? binding.frames[0];
  const frame = resolveDataSceneSpriteAnimationSet({
    clips: [{ id: 0, fps: 1, frames: [visual.frame ?? {}] }],
  }).clips[0].frames[0];
  if (
    !sameFrames(
      [{ u0: frame.u0!, v0: frame.v0!, u1: frame.u1!, v1: frame.v1! }],
      [{ u0: initial.u0!, v0: initial.v0!, u1: initial.u1!, v1: initial.v1! }],
    )
  )
    fail("handoff", "initial frame differs from generation evidence");
  return { instanceId, binding };
}
