import { accessibilityDiagnosticError } from "./diagnostics.js";
import { HUD_THEME_PRESETS, resolveHudTheme } from "./hudToolkit.js";
import type { CameraRigSpec, ScreenFadeTransitionSpec } from "./cameraPostProcessing";
import type { HudThemeInput, ResolvedHudThemeTokens } from "./hudToolkit";
import type { UiOverlayRegion, UiPanel } from "./uiOverlay";

export type AccessibilityReducedMotionPreference = boolean | "system";
export type AccessibilityContrastPaletteName = "default" | "high-contrast" | "deuteranopia" | "protanopia" | "tritanopia";
export type AccessibilityContrastColorRole =
  | "background"
  | "text"
  | "muted"
  | "accent"
  | "danger"
  | "success"
  | "warning"
  | "focus";

export interface AccessibilityContrastPaletteSpec {
  id: string;
  hudTheme?: HudThemeInput;
  colors?: Partial<Record<AccessibilityContrastColorRole, string>>;
}

export interface ResolvedAccessibilityContrastPalette {
  id: string;
  hudTheme: ResolvedHudThemeTokens;
  colors: Record<AccessibilityContrastColorRole, string>;
}

export interface AccessibilityInputAssistSpec {
  holdToToggleActions?: readonly string[];
  minimumTouchTargetPx?: number;
}

export interface ResolvedAccessibilityInputAssist {
  holdToToggleActions: readonly string[];
  minimumTouchTargetPx: number;
}

export interface AccessibilityOptionsSpec {
  reducedMotion?: AccessibilityReducedMotionPreference;
  subtitles?: boolean;
  contrastPalette?: AccessibilityContrastPaletteName | AccessibilityContrastPaletteSpec;
  inputAssist?: AccessibilityInputAssistSpec;
}

export interface ResolvedAccessibilityOptions {
  reducedMotion: boolean;
  subtitles: boolean;
  contrastPalette: ResolvedAccessibilityContrastPalette;
  inputAssist: ResolvedAccessibilityInputAssist;
}

export interface AccessibilityEnvironment {
  prefersReducedMotion?: boolean;
}

export interface AccessibilityMediaQueryListLike {
  matches: boolean;
}

export interface AccessibilityMediaQuerySource {
  matchMedia?: (query: string) => AccessibilityMediaQueryListLike;
}

export interface ResolveAccessibilityOptionsOptions {
  environment?: AccessibilityEnvironment;
  path?: string;
}

export interface AccessibilitySubtitleSpec {
  id?: string;
  speaker?: string;
  text: string;
  region?: UiOverlayRegion;
  visible?: boolean;
  ariaLive?: "off" | "polite" | "assertive";
}

export interface AccessibilitySubtitlePanelOptions extends ResolveAccessibilityOptionsOptions {
  accessibility?: AccessibilityOptionsSpec | ResolvedAccessibilityOptions;
  title?: string;
}

const DEFAULT_ACCESSIBILITY_COLORS: Record<AccessibilityContrastColorRole, string> = Object.freeze({
  background: "#0f172a",
  text: "#f8fafc",
  muted: "#94a3b8",
  accent: "#7dd3fc",
  danger: "#fca5a5",
  success: "#86efac",
  warning: "#fde68a",
  focus: "#38bdf8",
});

export const ACCESSIBILITY_CONTRAST_PALETTES: Readonly<Record<
  AccessibilityContrastPaletteName,
  ResolvedAccessibilityContrastPalette
>> = Object.freeze({
  default: freezePalette({
    id: "default",
    hudTheme: HUD_THEME_PRESETS.dark,
    colors: DEFAULT_ACCESSIBILITY_COLORS,
  }),
  "high-contrast": freezePalette({
    id: "high-contrast",
    hudTheme: HUD_THEME_PRESETS["high-contrast"],
    colors: {
      background: "#000000",
      text: "#ffffff",
      muted: "#e5e7eb",
      accent: "#67e8f9",
      danger: "#fecaca",
      success: "#bbf7d0",
      warning: "#fef08a",
      focus: "#ffffff",
    },
  }),
  deuteranopia: freezePalette({
    id: "deuteranopia",
    hudTheme: {
      ...HUD_THEME_PRESETS.dark,
      accentTextColor: "#56b4e9",
      dangerTextColor: "#e69f00",
      primaryButtonBackground: "#0072b2",
      dangerButtonBackground: "#d55e00",
    },
    colors: {
      ...DEFAULT_ACCESSIBILITY_COLORS,
      accent: "#56b4e9",
      danger: "#d55e00",
      success: "#009e73",
      warning: "#f0e442",
      focus: "#0072b2",
    },
  }),
  protanopia: freezePalette({
    id: "protanopia",
    hudTheme: {
      ...HUD_THEME_PRESETS.dark,
      accentTextColor: "#56b4e9",
      dangerTextColor: "#f0e442",
      primaryButtonBackground: "#0072b2",
      dangerButtonBackground: "#e69f00",
    },
    colors: {
      ...DEFAULT_ACCESSIBILITY_COLORS,
      accent: "#56b4e9",
      danger: "#e69f00",
      success: "#009e73",
      warning: "#f0e442",
      focus: "#0072b2",
    },
  }),
  tritanopia: freezePalette({
    id: "tritanopia",
    hudTheme: {
      ...HUD_THEME_PRESETS.dark,
      accentTextColor: "#009e73",
      dangerTextColor: "#cc79a7",
      primaryButtonBackground: "#009e73",
      dangerButtonBackground: "#cc79a7",
    },
    colors: {
      ...DEFAULT_ACCESSIBILITY_COLORS,
      accent: "#009e73",
      danger: "#cc79a7",
      success: "#0072b2",
      warning: "#e69f00",
      focus: "#009e73",
    },
  }),
});

export function readAccessibilityEnvironment(
  source: AccessibilityMediaQuerySource = globalThis as unknown as AccessibilityMediaQuerySource,
): AccessibilityEnvironment {
  if (typeof source.matchMedia !== "function") {
    return {};
  }
  try {
    return {
      prefersReducedMotion: source.matchMedia("(prefers-reduced-motion: reduce)").matches === true,
    };
  } catch {
    return {};
  }
}

export function resolveAccessibilityOptions(
  spec: AccessibilityOptionsSpec = {},
  options: ResolveAccessibilityOptionsOptions = {},
): ResolvedAccessibilityOptions {
  const path = options.path ?? "accessibility";
  if (!isRecord(spec)) {
    throw invalid(path, "must be an object");
  }
  const input = spec as AccessibilityOptionsSpec;
  return {
    reducedMotion: resolveReducedMotion(input.reducedMotion, options.environment, `${path}.reducedMotion`),
    subtitles: booleanValue(input.subtitles, `${path}.subtitles`, true),
    contrastPalette: resolveAccessibilityContrastPalette(input.contrastPalette, `${path}.contrastPalette`),
    inputAssist: resolveInputAssist(input.inputAssist, `${path}.inputAssist`),
  };
}

export function resolveAccessibilityContrastPalette(
  input: AccessibilityOptionsSpec["contrastPalette"] = "default",
  path = "accessibility.contrastPalette",
): ResolvedAccessibilityContrastPalette {
  if (input === undefined) {
    return clonePalette(ACCESSIBILITY_CONTRAST_PALETTES.default);
  }
  if (typeof input === "string") {
    const preset = ACCESSIBILITY_CONTRAST_PALETTES[input];
    if (preset === undefined) {
      throw invalid(path, `must be one of ${Object.keys(ACCESSIBILITY_CONTRAST_PALETTES).join(", ")}`);
    }
    return clonePalette(preset);
  }
  if (!isRecord(input)) {
    throw invalid(path, "must be a palette name or object");
  }
  return {
    id: stringValue(input.id, `${path}.id`),
    hudTheme: resolveHudTheme(input.hudTheme),
    colors: resolvePaletteColors(input.colors, `${path}.colors`),
  };
}

export function resolveAccessibilityHudTheme(
  accessibility: AccessibilityOptionsSpec | ResolvedAccessibilityOptions = {},
  options: ResolveAccessibilityOptionsOptions = {},
): ResolvedHudThemeTokens {
  const resolved = isResolvedAccessibilityOptions(accessibility)
    ? accessibility
    : resolveAccessibilityOptions(accessibility, options);
  return { ...resolved.contrastPalette.hudTheme };
}

export function applyAccessibilityToCameraRigSpec(
  spec: CameraRigSpec = {},
  accessibility: AccessibilityOptionsSpec | ResolvedAccessibilityOptions = {},
  options: ResolveAccessibilityOptionsOptions = {},
): CameraRigSpec {
  const resolved = isResolvedAccessibilityOptions(accessibility)
    ? accessibility
    : resolveAccessibilityOptions(accessibility, options);
  if (!resolved.reducedMotion) {
    return { ...spec };
  }
  return {
    ...spec,
    smoothTimeSeconds: 0,
  };
}

export function applyAccessibilityToScreenFadeSpec(
  spec: ScreenFadeTransitionSpec = {},
  accessibility: AccessibilityOptionsSpec | ResolvedAccessibilityOptions = {},
  options: ResolveAccessibilityOptionsOptions = {},
): ScreenFadeTransitionSpec {
  const resolved = isResolvedAccessibilityOptions(accessibility)
    ? accessibility
    : resolveAccessibilityOptions(accessibility, options);
  if (!resolved.reducedMotion) {
    return { ...spec };
  }
  return {
    ...spec,
    durationSeconds: 0,
  };
}

export function accessibilitySubtitlePanel(
  subtitle: AccessibilitySubtitleSpec,
  options: AccessibilitySubtitlePanelOptions = {},
): UiPanel | undefined {
  const path = options.path ?? "accessibility.subtitle";
  if (!isRecord(subtitle)) {
    throw invalid(path, "must be an object");
  }
  const accessibility = options.accessibility === undefined
    ? resolveAccessibilityOptions({}, options)
    : isResolvedAccessibilityOptions(options.accessibility)
      ? options.accessibility
      : resolveAccessibilityOptions(options.accessibility, options);
  if (!accessibility.subtitles || subtitle.visible === false) {
    return undefined;
  }
  const text = stringValue(subtitle.text, `${path}.text`);
  const speaker = subtitle.speaker === undefined
    ? undefined
    : stringValue(subtitle.speaker, `${path}.speaker`);
  return {
    id: subtitle.id ?? "subtitles",
    title: options.title,
    region: subtitle.region ?? "bottom-left",
    role: "status",
    ariaLabel: options.title ?? "Subtitles",
    ariaLive: subtitle.ariaLive ?? "polite",
    lines: [
      ...(speaker === undefined ? [] : [{ id: "speaker", label: "Speaker", value: speaker, tone: "accent" as const }]),
      { id: "text", text },
    ],
  };
}

function resolveReducedMotion(
  input: AccessibilityReducedMotionPreference | undefined,
  environment: AccessibilityEnvironment | undefined,
  path: string,
): boolean {
  if (input === undefined) {
    return false;
  }
  if (typeof input === "boolean") {
    return input;
  }
  if (input === "system") {
    return environment?.prefersReducedMotion === true;
  }
  throw invalid(path, "must be a boolean or system");
}

function resolveInputAssist(
  input: AccessibilityInputAssistSpec | undefined,
  path: string,
): ResolvedAccessibilityInputAssist {
  if (input === undefined) {
    return {
      holdToToggleActions: [],
      minimumTouchTargetPx: 44,
    };
  }
  if (!isRecord(input)) {
    throw invalid(path, "must be an object");
  }
  return {
    holdToToggleActions: stringArray(input.holdToToggleActions, `${path}.holdToToggleActions`),
    minimumTouchTargetPx: positiveNumber(input.minimumTouchTargetPx, `${path}.minimumTouchTargetPx`, 44),
  };
}

function resolvePaletteColors(
  input: AccessibilityContrastPaletteSpec["colors"],
  path: string,
): Record<AccessibilityContrastColorRole, string> {
  if (input === undefined) {
    return { ...DEFAULT_ACCESSIBILITY_COLORS };
  }
  if (!isRecord(input)) {
    throw invalid(path, "must be an object");
  }
  return {
    ...DEFAULT_ACCESSIBILITY_COLORS,
    background: colorString(input.background, `${path}.background`, DEFAULT_ACCESSIBILITY_COLORS.background),
    text: colorString(input.text, `${path}.text`, DEFAULT_ACCESSIBILITY_COLORS.text),
    muted: colorString(input.muted, `${path}.muted`, DEFAULT_ACCESSIBILITY_COLORS.muted),
    accent: colorString(input.accent, `${path}.accent`, DEFAULT_ACCESSIBILITY_COLORS.accent),
    danger: colorString(input.danger, `${path}.danger`, DEFAULT_ACCESSIBILITY_COLORS.danger),
    success: colorString(input.success, `${path}.success`, DEFAULT_ACCESSIBILITY_COLORS.success),
    warning: colorString(input.warning, `${path}.warning`, DEFAULT_ACCESSIBILITY_COLORS.warning),
    focus: colorString(input.focus, `${path}.focus`, DEFAULT_ACCESSIBILITY_COLORS.focus),
  };
}

function booleanValue(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw invalid(path, "must be a boolean");
  }
  return value;
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalid(path, "must be an array");
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = stringValue(value[index], `${path}.${index}`);
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

function colorString(value: unknown, path: string, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }
  return stringValue(value, path);
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(path, "must be a non-empty string");
  }
  return value;
}

function positiveNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw invalid(path, "must be greater than 0");
  }
  return value;
}

function isResolvedAccessibilityOptions(value: unknown): value is ResolvedAccessibilityOptions {
  return isRecord(value)
    && typeof value.reducedMotion === "boolean"
    && typeof value.subtitles === "boolean"
    && isRecord(value.contrastPalette)
    && isRecord(value.contrastPalette.hudTheme)
    && isRecord(value.inputAssist);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function freezePalette(palette: ResolvedAccessibilityContrastPalette): ResolvedAccessibilityContrastPalette {
  return Object.freeze({
    id: palette.id,
    hudTheme: Object.freeze({ ...palette.hudTheme }),
    colors: Object.freeze({ ...palette.colors }),
  });
}

function clonePalette(palette: ResolvedAccessibilityContrastPalette): ResolvedAccessibilityContrastPalette {
  return {
    id: palette.id,
    hudTheme: { ...palette.hudTheme },
    colors: { ...palette.colors },
  };
}

function invalid(path: string, detail: string): Error {
  return accessibilityDiagnosticError(path, detail);
}
