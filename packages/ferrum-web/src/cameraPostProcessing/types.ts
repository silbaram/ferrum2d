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
