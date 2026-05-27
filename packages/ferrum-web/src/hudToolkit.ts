import type {
  UiAction,
  UiOverlayRegion,
  UiOverlayState,
  UiOverlayTone,
  UiTextLine,
} from "./uiOverlay";

export type HudThemePresetName = "dark" | "light" | "high-contrast";

export interface HudThemeTokens {
  textColor: string;
  mutedTextColor: string;
  accentTextColor: string;
  dangerTextColor: string;
  panelBackground: string;
  panelBorder: string;
  panelShadow: string;
  buttonBackground: string;
  primaryButtonBackground: string;
  dangerButtonBackground: string;
  meterTrackBackground: string;
  borderRadius: string;
  font: string;
}

export type HudThemeInput = HudThemePresetName | Partial<HudThemeTokens>;
export type ResolvedHudThemeTokens = HudThemeTokens;

export type HudComponentSpec = HudMeterSpec | HudCounterSpec | HudPromptSpec | HudMessageSpec;

export interface HudComponentBase {
  id: string;
  label?: string;
  tone?: UiOverlayTone;
}

export interface HudMeterSpec extends HudComponentBase {
  type: "meter";
  value: number;
  max: number;
}

export interface HudCounterSpec extends HudComponentBase {
  type: "counter";
  value: string | number;
}

export interface HudPromptSpec extends HudComponentBase {
  type: "prompt";
  text: string;
  action?: UiAction;
}

export interface HudMessageSpec extends HudComponentBase {
  type: "message";
  text: string;
}

export interface CreateHudOverlayStateOptions {
  panelId?: string;
  title?: string;
  region?: UiOverlayRegion;
  ariaLabel?: string;
  ariaLive?: "off" | "polite" | "assertive";
}

export const HUD_THEME_PRESETS: Readonly<Record<HudThemePresetName, ResolvedHudThemeTokens>> = Object.freeze({
  dark: Object.freeze({
    textColor: "#f8fafc",
    mutedTextColor: "#94a3b8",
    accentTextColor: "#7dd3fc",
    dangerTextColor: "#fca5a5",
    panelBackground: "rgba(15, 23, 42, 0.82)",
    panelBorder: "rgba(148, 163, 184, 0.36)",
    panelShadow: "0 8px 24px rgba(2, 6, 23, 0.28)",
    buttonBackground: "#1e293b",
    primaryButtonBackground: "#2563eb",
    dangerButtonBackground: "#991b1b",
    meterTrackBackground: "rgba(148, 163, 184, 0.24)",
    borderRadius: "6px",
    font: "13px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  }),
  light: Object.freeze({
    textColor: "#0f172a",
    mutedTextColor: "#475569",
    accentTextColor: "#0369a1",
    dangerTextColor: "#b91c1c",
    panelBackground: "rgba(248, 250, 252, 0.92)",
    panelBorder: "rgba(100, 116, 139, 0.32)",
    panelShadow: "0 8px 24px rgba(15, 23, 42, 0.16)",
    buttonBackground: "#e2e8f0",
    primaryButtonBackground: "#2563eb",
    dangerButtonBackground: "#b91c1c",
    meterTrackBackground: "rgba(100, 116, 139, 0.22)",
    borderRadius: "6px",
    font: "13px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  }),
  "high-contrast": Object.freeze({
    textColor: "#ffffff",
    mutedTextColor: "#e5e7eb",
    accentTextColor: "#67e8f9",
    dangerTextColor: "#fecaca",
    panelBackground: "#000000",
    panelBorder: "#ffffff",
    panelShadow: "none",
    buttonBackground: "#111827",
    primaryButtonBackground: "#1d4ed8",
    dangerButtonBackground: "#dc2626",
    meterTrackBackground: "#374151",
    borderRadius: "4px",
    font: "13px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  }),
});

export function resolveHudTheme(theme: HudThemeInput | undefined = "dark"): ResolvedHudThemeTokens {
  if (theme === undefined) {
    return { ...HUD_THEME_PRESETS.dark };
  }
  if (typeof theme === "string") {
    const preset = HUD_THEME_PRESETS[theme];
    if (preset === undefined) {
      throw new Error(`Unknown HUD theme preset '${theme}'.`);
    }
    return { ...preset };
  }
  return {
    ...HUD_THEME_PRESETS.dark,
    ...theme,
  };
}

export function createHudOverlayState(
  components: readonly HudComponentSpec[],
  options: CreateHudOverlayStateOptions = {},
): UiOverlayState {
  const lines: UiTextLine[] = [];
  const actions: UiAction[] = [];
  for (const component of components) {
    switch (component.type) {
      case "meter":
        lines.push({
          id: component.id,
          label: component.label,
          value: `${Math.round(ratio(component.value, component.max) * 100)}%`,
          tone: component.tone ?? meterTone(component.value, component.max),
          meter: {
            value: component.value,
            max: component.max,
          },
        });
        break;
      case "counter":
        lines.push({
          id: component.id,
          label: component.label ?? component.id,
          value: component.value,
          tone: component.tone,
        });
        break;
      case "prompt":
        lines.push({
          id: component.id,
          text: component.text,
          tone: component.tone ?? "accent",
        });
        if (component.action) {
          actions.push(component.action);
        }
        break;
      case "message":
        lines.push({
          id: component.id,
          text: component.text,
          tone: component.tone,
        });
        break;
    }
  }

  return {
    panels: [{
      id: options.panelId ?? "hud",
      title: options.title,
      region: options.region ?? "top-left",
      ariaLabel: options.ariaLabel ?? options.title ?? "HUD",
      ariaLive: options.ariaLive ?? "polite",
      lines,
      actions,
    }],
  };
}

function ratio(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) {
    return 0;
  }
  return Math.min(Math.max(value / max, 0), 1);
}

function meterTone(value: number, max: number): UiOverlayTone {
  const amount = ratio(value, max);
  if (amount <= 0.25) {
    return "danger";
  }
  if (amount <= 0.5) {
    return "accent";
  }
  return "default";
}
