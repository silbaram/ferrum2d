import { cameraPostProcessingDiagnosticError } from "./diagnostics.js";

export interface CameraPoint {
  x: number;
  y: number;
}

export interface CameraViewport {
  width: number;
  height: number;
}

export interface CameraBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CameraDeadZone {
  width?: number;
  height?: number;
}

export interface CameraRigSpec {
  x?: number;
  y?: number;
  bounds?: CameraBounds;
  deadZone?: CameraDeadZone;
  smoothTimeSeconds?: number;
}

export interface ResolvedCameraBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ResolvedCameraDeadZone {
  width: number;
  height: number;
}

export interface ResolvedCameraRigSpec {
  x: number;
  y: number;
  bounds?: ResolvedCameraBounds;
  deadZone: ResolvedCameraDeadZone;
  smoothTimeSeconds: number;
}

export interface CameraRigStepOptions {
  viewport?: CameraViewport;
}

export interface CameraRigSnapshot {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  desiredX: number;
  desiredY: number;
}

export type PostProcessPassKind = "fade" | "bloom" | "crt" | "vignette" | "glitch";
export type PostProcessColor = readonly [number, number, number] | readonly [number, number, number, number];
export type ResolvedPostProcessColor = readonly [number, number, number, number];

export interface FadePostProcessPassInput {
  kind?: "fade";
  color?: PostProcessColor;
  opacity?: number;
}

export interface ResolvedFadePostProcessPass {
  kind: "fade";
  color: ResolvedPostProcessColor;
}

export interface BloomPostProcessPassInput {
  kind: "bloom";
  threshold?: number;
  intensity?: number;
  radius?: number;
}

export interface ResolvedBloomPostProcessPass {
  kind: "bloom";
  threshold: number;
  intensity: number;
  radius: number;
}

export interface CrtPostProcessPassInput {
  kind: "crt";
  curvature?: number;
  scanlineIntensity?: number;
  chromaticAberration?: number;
}

export interface ResolvedCrtPostProcessPass {
  kind: "crt";
  curvature: number;
  scanlineIntensity: number;
  chromaticAberration: number;
}

export interface VignettePostProcessPassInput {
  kind: "vignette";
  color?: PostProcessColor;
  intensity?: number;
  radius?: number;
  softness?: number;
}

export interface ResolvedVignettePostProcessPass {
  kind: "vignette";
  color: ResolvedPostProcessColor;
  intensity: number;
  radius: number;
  softness: number;
}

export interface GlitchPostProcessPassInput {
  kind: "glitch";
  intensity?: number;
  chromaticAberration?: number;
  seed?: number;
}

export interface ResolvedGlitchPostProcessPass {
  kind: "glitch";
  intensity: number;
  chromaticAberration: number;
  seed: number;
}

export interface PostProcessingConfigInput {
  enabled?: boolean;
  passes?: readonly PostProcessPassInput[];
  fade?: false | FadePostProcessPassInput;
  bloom?: false | Omit<BloomPostProcessPassInput, "kind">;
  crt?: false | Omit<CrtPostProcessPassInput, "kind">;
  vignette?: false | Omit<VignettePostProcessPassInput, "kind">;
  glitch?: false | Omit<GlitchPostProcessPassInput, "kind">;
}

export type PostProcessPassInput =
  | FadePostProcessPassInput
  | BloomPostProcessPassInput
  | CrtPostProcessPassInput
  | VignettePostProcessPassInput
  | GlitchPostProcessPassInput;
export type ResolvedPostProcessPass =
  | ResolvedFadePostProcessPass
  | ResolvedBloomPostProcessPass
  | ResolvedCrtPostProcessPass
  | ResolvedVignettePostProcessPass
  | ResolvedGlitchPostProcessPass;
export type PostProcessStackInput =
  | false
  | PostProcessPassInput
  | readonly PostProcessPassInput[]
  | PostProcessingConfigInput
  | undefined;

export interface ResolveCameraRigOptions {
  path?: string;
}

export interface ResolvePostProcessOptions {
  path?: string;
}

export interface ScreenFadeTransitionSpec {
  durationSeconds?: number;
  fromOpacity?: number;
  toOpacity?: number;
  color?: PostProcessColor;
}

export interface ScreenFadeTransitionSnapshot {
  active: boolean;
  elapsedSeconds: number;
  durationSeconds: number;
  progress: number;
  opacity: number;
  color: ResolvedPostProcessColor;
}

const DEFAULT_CAMERA_RIG: ResolvedCameraRigSpec = {
  x: 0,
  y: 0,
  deadZone: { width: 0, height: 0 },
  smoothTimeSeconds: 0,
};

const DEFAULT_FADE_COLOR: ResolvedPostProcessColor = [0, 0, 0, 1];
const DEFAULT_VIGNETTE_COLOR: ResolvedPostProcessColor = [0, 0, 0, 1];

export function resolveCameraRigSpec(
  spec: CameraRigSpec = {},
  options: ResolveCameraRigOptions = {},
): ResolvedCameraRigSpec {
  const path = options.path ?? "cameraRig";
  if (!isRecord(spec)) {
    throw invalid(path, "must be an object");
  }
  const input = spec as CameraRigSpec;

  const deadZone = input.deadZone === undefined
    ? DEFAULT_CAMERA_RIG.deadZone
    : resolveDeadZone(input.deadZone, `${path}.deadZone`);
  const resolved: ResolvedCameraRigSpec = {
    x: finiteNumber(input.x, `${path}.x`, DEFAULT_CAMERA_RIG.x),
    y: finiteNumber(input.y, `${path}.y`, DEFAULT_CAMERA_RIG.y),
    deadZone,
    smoothTimeSeconds: nonNegativeNumber(
      input.smoothTimeSeconds,
      `${path}.smoothTimeSeconds`,
      DEFAULT_CAMERA_RIG.smoothTimeSeconds,
    ),
  };

  if (input.bounds !== undefined) {
    resolved.bounds = resolveBounds(input.bounds, `${path}.bounds`);
  }

  return resolved;
}

export function clampCameraToBounds(
  point: CameraPoint,
  bounds: ResolvedCameraBounds | undefined,
  viewport?: CameraViewport,
): CameraPoint {
  if (bounds === undefined) {
    return { x: point.x, y: point.y };
  }

  if (viewport === undefined) {
    return {
      x: clamp(point.x, bounds.minX, bounds.maxX),
      y: clamp(point.y, bounds.minY, bounds.maxY),
    };
  }

  const width = nonNegativeFinite(viewport.width, "camera viewport.width");
  const height = nonNegativeFinite(viewport.height, "camera viewport.height");
  return {
    x: clampViewportAxis(point.x, bounds.minX, bounds.maxX, width),
    y: clampViewportAxis(point.y, bounds.minY, bounds.maxY, height),
  };
}

export class CameraRigController {
  private readonly spec: ResolvedCameraRigSpec;
  private current: CameraRigSnapshot;

  constructor(spec: CameraRigSpec = {}) {
    this.spec = resolveCameraRigSpec(spec);
    this.current = {
      x: this.spec.x,
      y: this.spec.y,
      targetX: this.spec.x,
      targetY: this.spec.y,
      desiredX: this.spec.x,
      desiredY: this.spec.y,
    };
  }

  static create(spec: CameraRigSpec = {}): CameraRigController {
    return new CameraRigController(spec);
  }

  step(target: CameraPoint, deltaSeconds: number, options: CameraRigStepOptions = {}): CameraRigSnapshot {
    const targetX = finiteNumber(target.x, "camera target.x", this.current.targetX);
    const targetY = finiteNumber(target.y, "camera target.y", this.current.targetY);
    const delta = nonNegativeFinite(deltaSeconds, "camera deltaSeconds");
    const desired = clampCameraToBounds(
      applyDeadZone(
        { x: this.current.x, y: this.current.y },
        { x: targetX, y: targetY },
        this.spec.deadZone,
      ),
      this.spec.bounds,
      options.viewport,
    );
    const blend = this.spec.smoothTimeSeconds <= 0
      ? 1
      : 1 - Math.exp(-delta / this.spec.smoothTimeSeconds);
    const next = clampCameraToBounds(
      {
        x: lerp(this.current.x, desired.x, blend),
        y: lerp(this.current.y, desired.y, blend),
      },
      this.spec.bounds,
      options.viewport,
    );

    this.current = {
      x: next.x,
      y: next.y,
      targetX,
      targetY,
      desiredX: desired.x,
      desiredY: desired.y,
    };
    return this.snapshot();
  }

  setPosition(point: CameraPoint): CameraRigSnapshot {
    const next = clampCameraToBounds(
      {
        x: finiteNumber(point.x, "camera position.x", this.current.x),
        y: finiteNumber(point.y, "camera position.y", this.current.y),
      },
      this.spec.bounds,
    );
    this.current = {
      ...this.current,
      x: next.x,
      y: next.y,
      desiredX: next.x,
      desiredY: next.y,
    };
    return this.snapshot();
  }

  snapshot(): CameraRigSnapshot {
    return { ...this.current };
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
  const entries = postProcessEntries(input, path);
  return entries
    .map((entry, index) => resolvePostProcessPass(entry, `${path}[${index}]`))
    .filter(postProcessPassEnabled);
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

export class ScreenFadeTransition {
  private spec: Required<Pick<ScreenFadeTransitionSpec, "durationSeconds" | "fromOpacity" | "toOpacity">> & {
    color: ResolvedPostProcessColor;
  };
  private elapsedSeconds = 0;

  constructor(spec: ScreenFadeTransitionSpec = {}) {
    this.spec = resolveScreenFadeTransitionSpec(spec);
  }

  static create(spec: ScreenFadeTransitionSpec = {}): ScreenFadeTransition {
    return new ScreenFadeTransition(spec);
  }

  reset(spec?: ScreenFadeTransitionSpec): ScreenFadeTransitionSnapshot {
    if (spec !== undefined) {
      this.spec = resolveScreenFadeTransitionSpec(spec);
    }
    this.elapsedSeconds = 0;
    return this.snapshot();
  }

  update(deltaSeconds: number): ScreenFadeTransitionSnapshot {
    this.elapsedSeconds = Math.min(
      this.spec.durationSeconds,
      this.elapsedSeconds + nonNegativeFinite(deltaSeconds, "screen fade deltaSeconds"),
    );
    return this.snapshot();
  }

  finish(): ScreenFadeTransitionSnapshot {
    this.elapsedSeconds = this.spec.durationSeconds;
    return this.snapshot();
  }

  postProcessPasses(): readonly ResolvedPostProcessPass[] {
    const snapshot = this.snapshot();
    if (snapshot.opacity <= 0) {
      return [];
    }
    return [{ kind: "fade", color: snapshot.color }];
  }

  snapshot(): ScreenFadeTransitionSnapshot {
    const progress = this.spec.durationSeconds <= 0
      ? 1
      : clamp(this.elapsedSeconds / this.spec.durationSeconds, 0, 1);
    const opacity = lerp(this.spec.fromOpacity, this.spec.toOpacity, progress);
    const color: ResolvedPostProcessColor = [
      this.spec.color[0],
      this.spec.color[1],
      this.spec.color[2],
      opacity,
    ];
    return {
      active: progress < 1,
      elapsedSeconds: this.elapsedSeconds,
      durationSeconds: this.spec.durationSeconds,
      progress,
      opacity,
      color,
    };
  }
}

function resolvePostProcessPass(input: PostProcessPassInput, path: string): ResolvedPostProcessPass {
  if (!isRecord(input)) {
    throw invalid(path, "must be an object");
  }
  const pass = input as PostProcessPassInput;
  const kind = pass.kind ?? "fade";
  if (kind === "fade") {
    const fade = pass as FadePostProcessPassInput;
    return {
      kind: "fade",
      color: resolveColor(fade.color ?? DEFAULT_FADE_COLOR, `${path}.color`, fade.opacity),
    };
  }
  if (kind === "bloom") {
    const bloom = pass as BloomPostProcessPassInput;
    return {
      kind: "bloom",
      threshold: unitNumber(bloom.threshold, `${path}.threshold`, 0.72),
      intensity: nonNegativeNumber(bloom.intensity, `${path}.intensity`, 0.45),
      radius: nonNegativeNumber(bloom.radius, `${path}.radius`, 1.5),
    };
  }
  if (kind === "crt") {
    const crt = pass as CrtPostProcessPassInput;
    return {
      kind: "crt",
      curvature: nonNegativeNumber(crt.curvature, `${path}.curvature`, 0.08),
      scanlineIntensity: unitNumber(crt.scanlineIntensity, `${path}.scanlineIntensity`, 0.18),
      chromaticAberration: nonNegativeNumber(crt.chromaticAberration, `${path}.chromaticAberration`, 0.0015),
    };
  }
  if (kind === "vignette") {
    const vignette = pass as VignettePostProcessPassInput;
    return {
      kind: "vignette",
      color: resolveColor(vignette.color ?? DEFAULT_VIGNETTE_COLOR, `${path}.color`),
      intensity: unitNumber(vignette.intensity, `${path}.intensity`, 0.35),
      radius: unitNumber(vignette.radius, `${path}.radius`, 0.55),
      softness: unitNumber(vignette.softness, `${path}.softness`, 0.35),
    };
  }
  if (kind === "glitch") {
    const glitch = pass as GlitchPostProcessPassInput;
    return {
      kind: "glitch",
      intensity: nonNegativeNumber(glitch.intensity, `${path}.intensity`, 0.04),
      chromaticAberration: nonNegativeNumber(glitch.chromaticAberration, `${path}.chromaticAberration`, 0.003),
      seed: finiteNumber(glitch.seed, `${path}.seed`, 0),
    };
  }
  throw invalid(`${path}.kind`, "must be fade, bloom, crt, vignette, or glitch");
}

function postProcessEntries(input: Exclude<PostProcessStackInput, false | undefined>, path: string): PostProcessPassInput[] {
  if (Array.isArray(input)) {
    return [...input];
  }
  if (!isRecord(input)) {
    throw invalid(path, "must be an object or array");
  }
  if (!isPostProcessingConfigInput(input)) {
    return [input as PostProcessPassInput];
  }
  const config = input as PostProcessingConfigInput;
  if (config.enabled === false) {
    return [];
  }
  const entries: PostProcessPassInput[] = [];
  if (config.passes !== undefined) {
    if (!Array.isArray(config.passes)) {
      throw invalid(`${path}.passes`, "must be an array");
    }
    entries.push(...config.passes);
  }
  if (config.fade !== undefined && config.fade !== false) {
    entries.push({ ...config.fade, kind: "fade" });
  }
  if (config.bloom !== undefined && config.bloom !== false) {
    entries.push({ ...config.bloom, kind: "bloom" });
  }
  if (config.crt !== undefined && config.crt !== false) {
    entries.push({ ...config.crt, kind: "crt" });
  }
  if (config.vignette !== undefined && config.vignette !== false) {
    entries.push({ ...config.vignette, kind: "vignette" });
  }
  if (config.glitch !== undefined && config.glitch !== false) {
    entries.push({ ...config.glitch, kind: "glitch" });
  }
  return entries;
}

function isPostProcessingConfigInput(input: Record<string, unknown>): boolean {
  return "enabled" in input
    || "passes" in input
    || "fade" in input
    || "bloom" in input
    || "crt" in input
    || "vignette" in input
    || "glitch" in input;
}

function postProcessPassEnabled(pass: ResolvedPostProcessPass): boolean {
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

function resolveScreenFadeTransitionSpec(spec: ScreenFadeTransitionSpec): Required<
  Pick<ScreenFadeTransitionSpec, "durationSeconds" | "fromOpacity" | "toOpacity">
> & { color: ResolvedPostProcessColor } {
  if (!isRecord(spec)) {
    throw invalid("screenFade", "must be an object");
  }
  const input = spec as ScreenFadeTransitionSpec;
  const color = resolveColor(input.color ?? DEFAULT_FADE_COLOR, "screenFade.color");
  return {
    durationSeconds: nonNegativeNumber(input.durationSeconds, "screenFade.durationSeconds", 1),
    fromOpacity: unitNumber(input.fromOpacity, "screenFade.fromOpacity", 1),
    toOpacity: unitNumber(input.toOpacity, "screenFade.toOpacity", 0),
    color,
  };
}

function resolveBounds(bounds: CameraBounds, path: string): ResolvedCameraBounds {
  if (!isRecord(bounds)) {
    throw invalid(path, "must be an object");
  }
  const input = bounds as CameraBounds;
  const resolved = {
    minX: finiteNumber(input.minX, `${path}.minX`),
    minY: finiteNumber(input.minY, `${path}.minY`),
    maxX: finiteNumber(input.maxX, `${path}.maxX`),
    maxY: finiteNumber(input.maxY, `${path}.maxY`),
  };
  if (resolved.minX > resolved.maxX) {
    throw invalid(path, "minX must be less than or equal to maxX");
  }
  if (resolved.minY > resolved.maxY) {
    throw invalid(path, "minY must be less than or equal to maxY");
  }
  return resolved;
}

function resolveDeadZone(deadZone: CameraDeadZone, path: string): ResolvedCameraDeadZone {
  if (!isRecord(deadZone)) {
    throw invalid(path, "must be an object");
  }
  const input = deadZone as CameraDeadZone;
  return {
    width: nonNegativeNumber(input.width, `${path}.width`, 0),
    height: nonNegativeNumber(input.height, `${path}.height`, 0),
  };
}

function applyDeadZone(
  current: CameraPoint,
  target: CameraPoint,
  deadZone: ResolvedCameraDeadZone,
): CameraPoint {
  return {
    x: deadZone.width <= 0
      ? target.x
      : desiredAxisForDeadZone(current.x, target.x, deadZone.width),
    y: deadZone.height <= 0
      ? target.y
      : desiredAxisForDeadZone(current.y, target.y, deadZone.height),
  };
}

function desiredAxisForDeadZone(current: number, target: number, size: number): number {
  const half = size * 0.5;
  if (target < current - half) {
    return target + half;
  }
  if (target > current + half) {
    return target - half;
  }
  return current;
}

function resolveColor(color: PostProcessColor, path: string, opacity?: number): ResolvedPostProcessColor {
  if (!Array.isArray(color) || (color.length !== 3 && color.length !== 4)) {
    throw invalid(path, "must be an RGB or RGBA array");
  }
  const alpha = unitNumber(color.length === 4 ? color[3] : 1, `${path}[3]`, 1)
    * unitNumber(opacity, `${path}.opacity`, 1);
  return [
    unitNumber(color[0], `${path}[0]`, 0),
    unitNumber(color[1], `${path}[1]`, 0),
    unitNumber(color[2], `${path}[2]`, 0),
    alpha,
  ];
}

function finiteNumber(value: number | undefined, path: string, fallback?: number): number {
  if (value === undefined) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw invalid(path, "must be a finite number");
  }
  if (!Number.isFinite(value)) {
    throw invalid(path, "must be a finite number");
  }
  return value;
}

function nonNegativeNumber(value: number | undefined, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  return nonNegativeFinite(value, path);
}

function nonNegativeFinite(value: number, path: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw invalid(path, "must be a non-negative finite number");
  }
  return value;
}

function unitNumber(value: number | undefined, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw invalid(path, "must be a finite number between 0 and 1");
  }
  return value;
}

function clampViewportAxis(point: number, min: number, max: number, viewportSize: number): number {
  const halfViewport = viewportSize * 0.5;
  const minCenter = min + halfViewport;
  const maxCenter = max - halfViewport;
  if (minCenter > maxCenter) {
    return (min + max) * 0.5;
  }
  return clamp(point, minCenter, maxCenter);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(path: string, detail: string): Error {
  return cameraPostProcessingDiagnosticError(path, detail);
}
