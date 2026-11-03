import type {
  BloomPostProcessPassInput,
  CrtPostProcessPassInput,
  FadePostProcessPassInput,
  GlitchPostProcessPassInput,
  PostProcessColor,
  PostProcessingConfigInput,
  PostProcessPassInput,
  PostProcessStackInput,
  PixelArtPostProcessPassInput,
  ResolvedPixelArtPostProcessPass,
  ResolvedBloomPostProcessPass,
  ResolvedCrtPostProcessPass,
  ResolvedFadePostProcessPass,
  ResolvedGlitchPostProcessPass,
  ResolvedPostProcessColor,
  ResolvedPostProcessPass,
  ResolvedVignettePostProcessPass,
  ResolvePostProcessOptions,
  VignettePostProcessPassInput,
} from "./types.js";
import {
  finiteNumber,
  invalid,
  isRecord,
  nonNegativeNumber,
  resolveColor,
  unitNumber,
} from "./validation.js";

export const DEFAULT_FADE_COLOR: ResolvedPostProcessColor = [0, 0, 0, 1];
const DEFAULT_VIGNETTE_COLOR: ResolvedPostProcessColor = [0, 0, 0, 1];
const PASS_FIELDS = {
  fade: ["color", "opacity"],
  bloom: ["threshold", "intensity", "radius"],
  crt: ["curvature", "scanlineIntensity", "chromaticAberration"],
  vignette: ["color", "intensity", "radius", "softness"],
  glitch: ["intensity", "chromaticAberration", "seed"],
  pixelArt: ["levels", "dither", "scanlineIntensity"],
} as const;
const CONFIG_FIELDS = ["enabled", "passes", ...Object.keys(PASS_FIELDS)];

function assertKnownFields(input: object, fields: readonly string[], path: string, allowKind = false): void {
  for (const key of Object.keys(input)) {
    if (!(allowKind && key === "kind") && !fields.includes(key)) {
      throw invalid(`${path}.${key}`, "is not a supported field for this post-process configuration");
    }
  }
}

export function resolvePostProcessPasses(
  input: PostProcessStackInput = undefined,
  options: ResolvePostProcessOptions = {},
): readonly ResolvedPostProcessPass[] {
  if (input === undefined || input === false) {
    return [];
  }
  const path = options.path ?? "postProcess";
  const resolved: ResolvedPostProcessPass[] = [];
  appendResolvedPostProcessPasses(resolved, input, path);
  return resolved;
}

export function fadePostProcessPass(
  opacity: number,
  color: PostProcessColor = DEFAULT_FADE_COLOR,
): ResolvedFadePostProcessPass {
  return {
    kind: "fade",
    color: resolveColor(color, "postProcess.fade.color", opacity),
  };
}

function resolvePostProcessPass(input: PostProcessPassInput, path: string): ResolvedPostProcessPass {
  if (!isRecord(input)) {
    throw invalid(path, "must be an object");
  }
  const pass = input as PostProcessPassInput;
  const kind = pass.kind === undefined ? "fade" : pass.kind;
  if (typeof kind !== "string" || !Object.prototype.hasOwnProperty.call(PASS_FIELDS, kind)) {
    throw invalid(`${path}.kind`, "must be fade, bloom, crt, vignette, glitch, or pixelArt");
  }
  assertKnownFields(pass, PASS_FIELDS[kind], path, true);
  if (kind === "fade") {
    return resolveFadePass(pass as FadePostProcessPassInput, path);
  }
  if (kind === "bloom") {
    return resolveBloomPass(pass as BloomPostProcessPassInput, path);
  }
  if (kind === "crt") {
    return resolveCrtPass(pass as CrtPostProcessPassInput, path);
  }
  if (kind === "vignette") {
    return resolveVignettePass(pass as VignettePostProcessPassInput, path);
  }
  if (kind === "glitch") {
    return resolveGlitchPass(pass as GlitchPostProcessPassInput, path);
  }
  if (kind === "pixelArt") return resolvePixelArtPass(pass as PixelArtPostProcessPassInput, path);
  throw invalid(`${path}.kind`, "must be fade, bloom, crt, vignette, glitch, or pixelArt");
}

function resolvePixelArtPass(
  pass: Omit<PixelArtPostProcessPassInput, "kind">,
  path: string,
): ResolvedPixelArtPostProcessPass {
  const levels = finiteNumber(pass.levels, `${path}.levels`, 8);
  if (!Number.isInteger(levels) || levels < 2 || levels > 256) {
    throw invalid(`${path}.levels`, "must be an integer in [2, 256]");
  }
  return { kind: "pixelArt", levels,
    dither: unitNumber(pass.dither, `${path}.dither`, 0),
    scanlineIntensity: unitNumber(pass.scanlineIntensity, `${path}.scanlineIntensity`, 0) };
}

function resolveFadePass(pass: FadePostProcessPassInput, path: string): ResolvedFadePostProcessPass {
  return {
    kind: "fade",
    color: resolveColor(pass.color === undefined ? DEFAULT_FADE_COLOR : pass.color, `${path}.color`, pass.opacity),
  };
}

function resolveBloomPass(
  pass: BloomPostProcessPassInput | Omit<BloomPostProcessPassInput, "kind">,
  path: string,
): ResolvedBloomPostProcessPass {
  return {
    kind: "bloom",
    threshold: unitNumber(pass.threshold, `${path}.threshold`, 0.72),
    intensity: nonNegativeNumber(pass.intensity, `${path}.intensity`, 0.45),
    radius: nonNegativeNumber(pass.radius, `${path}.radius`, 1.5),
  };
}

function resolveCrtPass(
  pass: CrtPostProcessPassInput | Omit<CrtPostProcessPassInput, "kind">,
  path: string,
): ResolvedCrtPostProcessPass {
  return {
    kind: "crt",
    curvature: nonNegativeNumber(pass.curvature, `${path}.curvature`, 0.08),
    scanlineIntensity: unitNumber(pass.scanlineIntensity, `${path}.scanlineIntensity`, 0.18),
    chromaticAberration: nonNegativeNumber(pass.chromaticAberration, `${path}.chromaticAberration`, 0.0015),
  };
}

function resolveVignettePass(
  pass: VignettePostProcessPassInput | Omit<VignettePostProcessPassInput, "kind">,
  path: string,
): ResolvedVignettePostProcessPass {
  return {
    kind: "vignette",
    color: resolveColor(pass.color === undefined ? DEFAULT_VIGNETTE_COLOR : pass.color, `${path}.color`),
    intensity: unitNumber(pass.intensity, `${path}.intensity`, 0.35),
    radius: unitNumber(pass.radius, `${path}.radius`, 0.55),
    softness: unitNumber(pass.softness, `${path}.softness`, 0.35),
  };
}

function resolveGlitchPass(
  pass: GlitchPostProcessPassInput | Omit<GlitchPostProcessPassInput, "kind">,
  path: string,
): ResolvedGlitchPostProcessPass {
  return {
    kind: "glitch",
    intensity: nonNegativeNumber(pass.intensity, `${path}.intensity`, 0.04),
    chromaticAberration: nonNegativeNumber(pass.chromaticAberration, `${path}.chromaticAberration`, 0.003),
    seed: finiteNumber(pass.seed, `${path}.seed`, 0),
  };
}

function appendResolvedPostProcessPasses(
  resolved: ResolvedPostProcessPass[],
  input: Exclude<PostProcessStackInput, false | undefined>,
  path: string,
): void {
  if (Array.isArray(input)) {
    appendPassArray(resolved, input, path);
    return;
  }
  if (!isRecord(input)) {
    throw invalid(path, "must be an object or array");
  }
  if (!isPostProcessingConfigInput(input)) {
    appendEnabledPass(resolved, resolvePostProcessPass(input as PostProcessPassInput, `${path}[0]`));
    return;
  }
  const config = input as PostProcessingConfigInput;
  assertKnownFields(config, CONFIG_FIELDS, path);
  if (config.enabled !== undefined && typeof config.enabled !== "boolean") {
    throw invalid(`${path}.enabled`, "must be a boolean");
  }
  // Disabled stacks still validate their shape and numeric bounds, like the JSON schema.
  const start = resolved.length;
  let index = 0;
  if (config.passes !== undefined) {
    if (!Array.isArray(config.passes)) {
      throw invalid(`${path}.passes`, "must be an array");
    }
    index = appendPassArray(resolved, config.passes, path, index);
  }
  if (config.fade !== undefined && config.fade !== false) {
    const passPath = `${path}[${index}]`;
    appendEnabledPass(resolved, resolveFadePass(requireConfigPass(config.fade, passPath, "fade"), passPath));
    index += 1;
  }
  if (config.bloom !== undefined && config.bloom !== false) {
    const passPath = `${path}[${index}]`;
    appendEnabledPass(resolved, resolveBloomPass(requireConfigPass(config.bloom, passPath, "bloom"), passPath));
    index += 1;
  }
  if (config.crt !== undefined && config.crt !== false) {
    const passPath = `${path}[${index}]`;
    appendEnabledPass(resolved, resolveCrtPass(requireConfigPass(config.crt, passPath, "crt"), passPath));
    index += 1;
  }
  if (config.vignette !== undefined && config.vignette !== false) {
    const passPath = `${path}[${index}]`;
    appendEnabledPass(resolved, resolveVignettePass(requireConfigPass(config.vignette, passPath, "vignette"), passPath));
    index += 1;
  }
  if (config.glitch !== undefined && config.glitch !== false) {
    const passPath = `${path}[${index}]`;
    appendEnabledPass(resolved, resolveGlitchPass(requireConfigPass(config.glitch, passPath, "glitch"), passPath));
    index += 1;
  }
  if (config.pixelArt !== undefined && config.pixelArt !== false) {
    const passPath = `${path}[${index}]`;
    appendEnabledPass(resolved, resolvePixelArtPass(requireConfigPass(config.pixelArt, passPath, "pixelArt"), passPath));
  }
  if (config.enabled === false) resolved.length = start;
}

function appendPassArray(
  resolved: ResolvedPostProcessPass[],
  passes: readonly PostProcessPassInput[],
  path: string,
  startIndex = 0,
): number {
  for (let offset = 0; offset < passes.length; offset += 1) {
    appendEnabledPass(
      resolved,
      resolvePostProcessPass(passes[offset] as PostProcessPassInput, `${path}[${startIndex + offset}]`),
    );
  }
  return startIndex + passes.length;
}

function appendEnabledPass(resolved: ResolvedPostProcessPass[], pass: ResolvedPostProcessPass): void {
  if (postProcessPassEnabled(pass)) {
    resolved.push(pass);
  }
}

function requireConfigPass<T>(input: T, path: string, kind: keyof typeof PASS_FIELDS): T {
  if (!isRecord(input)) {
    throw invalid(path, "must be an object");
  }
  assertKnownFields(input, PASS_FIELDS[kind], path, kind === "fade");
  if (kind === "fade" && input.kind !== undefined && input.kind !== "fade") {
    throw invalid(`${path}.kind`, "must be fade");
  }
  return input;
}

function isPostProcessingConfigInput(input: Record<string, unknown>): boolean {
  return hasOwnKey(input, "enabled")
    || hasOwnKey(input, "passes")
    || hasOwnKey(input, "fade")
    || hasOwnKey(input, "bloom")
    || hasOwnKey(input, "crt")
    || hasOwnKey(input, "vignette")
    || hasOwnKey(input, "glitch")
    || hasOwnKey(input, "pixelArt");
}

function postProcessPassEnabled(pass: ResolvedPostProcessPass): boolean {
  if (pass.kind === "pixelArt") return true;
  if (pass.kind === "fade") {
    return pass.color[3] > 0;
  }
  if (pass.kind === "bloom") {
    return pass.intensity > 0 && pass.radius > 0;
  }
  if (pass.kind === "crt") {
    return pass.curvature > 0 || pass.scanlineIntensity > 0 || pass.chromaticAberration > 0;
  }
  if (pass.kind === "vignette") {
    return pass.intensity > 0 && pass.softness > 0;
  }
  return pass.intensity > 0 || pass.chromaticAberration > 0;
}

function hasOwnKey(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}
