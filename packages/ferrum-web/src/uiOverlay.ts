import { resolveHudTheme } from "./hudToolkit.js";
import type { HudThemeInput, ResolvedHudThemeTokens } from "./hudToolkit.js";

export type UiOverlayRegion = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
export type UiOverlayTone = "default" | "muted" | "accent" | "danger";
export type UiOverlayActionTone = "default" | "primary" | "danger";

export interface UiMeter {
  value: number;
  max: number;
}

export interface UiTextLine {
  id?: string;
  label?: string;
  value?: string | number;
  text?: string;
  tone?: UiOverlayTone;
  meter?: UiMeter;
  ariaLabel?: string;
}

export interface UiAction {
  id: string;
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
  tone?: UiOverlayActionTone;
}

export interface UiPanel {
  id: string;
  title?: string;
  region?: UiOverlayRegion;
  visible?: boolean;
  role?: "region" | "status" | "menu";
  ariaLabel?: string;
  ariaLive?: "off" | "polite" | "assertive";
  lines?: readonly UiTextLine[];
  actions?: readonly UiAction[];
}

export interface UiDialog {
  id: string;
  title: string;
  body?: string;
  visible?: boolean;
  actions?: readonly UiAction[];
}

export interface UiOverlayState {
  panels?: readonly UiPanel[];
  dialog?: UiDialog;
}

export interface UiOverlayActionEvent {
  id: string;
  panelId?: string;
  dialogId?: string;
}

export interface UiOverlayOptions {
  enabled?: boolean;
  className?: string;
  theme?: HudThemeInput;
  onAction?: (event: UiOverlayActionEvent) => void;
}

const REGIONS: readonly UiOverlayRegion[] = ["top-left", "top-right", "bottom-left", "bottom-right", "center"];

export class UiOverlay {
  private readonly root?: HTMLElement;
  private readonly regions = new Map<UiOverlayRegion, HTMLElement>();
  private readonly theme: ResolvedHudThemeTokens;
  private destroyed = false;

  constructor(
    private readonly parent: HTMLElement = document.body,
    private readonly options: UiOverlayOptions = {},
  ) {
    this.theme = resolveHudTheme(options.theme);
    if (options.enabled === false) {
      return;
    }

    const root = document.createElement("div");
    root.className = options.className ?? "ferrum-ui-overlay";
    applyRootStyle(root, this.theme);
    for (const region of REGIONS) {
      const element = document.createElement("div");
      element.className = `ferrum-ui-region ferrum-ui-region-${region}`;
      applyRegionStyle(element, region);
      root.appendChild(element);
      this.regions.set(region, element);
    }
    parent.appendChild(root);
    this.root = root;
  }

  update(state: UiOverlayState): void {
    if (this.destroyed || !this.root) {
      return;
    }

    for (const region of this.regions.values()) {
      region.replaceChildren();
    }

    for (const panel of state.panels ?? []) {
      if (panel.visible === false) {
        continue;
      }
      const region = panel.region ?? "top-left";
      this.regions.get(region)?.appendChild(this.renderPanel(panel));
    }

    if (state.dialog && state.dialog.visible !== false) {
      this.regions.get("center")?.appendChild(this.renderDialog(state.dialog));
    }
  }

  clear(): void {
    this.update({});
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.root?.remove();
    this.regions.clear();
  }

  private renderPanel(panel: UiPanel): HTMLElement {
    const section = document.createElement("section");
    section.setAttribute("role", panel.role ?? "region");
    section.setAttribute("aria-label", panel.ariaLabel ?? panel.title ?? panel.id);
    if (panel.ariaLive) {
      section.setAttribute("aria-live", panel.ariaLive);
    }
    section.setAttribute("data-ferrum-ui-panel", panel.id);
    applyPanelStyle(section, this.theme);
    if (panel.title) {
      section.appendChild(this.renderTitle(panel.title));
    }
    for (const line of panel.lines ?? []) {
      section.appendChild(this.renderLine(line));
    }
    if (panel.actions && panel.actions.length > 0) {
      section.appendChild(this.renderActions(panel.actions, { panelId: panel.id }));
    }
    return section;
  }

  private renderDialog(dialog: UiDialog): HTMLElement {
    const section = document.createElement("section");
    section.setAttribute("role", "dialog");
    section.setAttribute("aria-label", dialog.title);
    section.setAttribute("data-ferrum-ui-dialog", dialog.id);
    applyDialogStyle(section, this.theme);
    section.appendChild(this.renderTitle(dialog.title));
    if (dialog.body) {
      const body = document.createElement("p");
      applyBodyStyle(body);
      body.textContent = dialog.body;
      section.appendChild(body);
    }
    if (dialog.actions && dialog.actions.length > 0) {
      section.appendChild(this.renderActions(dialog.actions, { dialogId: dialog.id }));
    }
    return section;
  }

  private renderTitle(text: string): HTMLElement {
    const title = document.createElement("h2");
    applyTitleStyle(title);
    title.textContent = text;
    return title;
  }

  private renderLine(line: UiTextLine): HTMLElement {
    const row = document.createElement("div");
    applyLineStyle(row, line.tone ?? "default", this.theme);
    if (line.id) {
      row.setAttribute("data-ferrum-ui-line", line.id);
    }
    if (line.ariaLabel) {
      row.setAttribute("aria-label", line.ariaLabel);
    }
    if (line.text !== undefined) {
      row.textContent = line.text;
      return row;
    }
    if (line.meter) {
      return this.renderMeterLine(row, line);
    }

    const label = document.createElement("span");
    const value = document.createElement("strong");
    applyLineLabelStyle(label, this.theme);
    applyLineValueStyle(value);
    label.textContent = line.label ?? "";
    value.textContent = line.value === undefined ? "" : String(line.value);
    row.append(label, value);
    return row;
  }

  private renderMeterLine(row: HTMLElement, line: UiTextLine): HTMLElement {
    row.style.flexDirection = "column";
    row.style.gap = "4px";
    const header = document.createElement("div");
    applyMeterHeaderStyle(header);
    const label = document.createElement("span");
    const value = document.createElement("strong");
    applyLineLabelStyle(label, this.theme);
    applyLineValueStyle(value);
    label.textContent = line.label ?? "";
    value.textContent = line.value === undefined ? "" : String(line.value);
    header.append(label, value);

    const meter = document.createElement("div");
    const fill = document.createElement("div");
    const current = Math.min(Math.max(line.meter?.value ?? 0, 0), line.meter?.max ?? 0);
    const max = Math.max(line.meter?.max ?? 0, 0);
    const ratio = max <= 0 ? 0 : current / max;
    meter.setAttribute("role", "progressbar");
    meter.setAttribute("aria-valuemin", "0");
    meter.setAttribute("aria-valuemax", String(max));
    meter.setAttribute("aria-valuenow", String(current));
    meter.setAttribute("aria-label", line.ariaLabel ?? line.label ?? line.id ?? "meter");
    applyMeterTrackStyle(meter, this.theme);
    applyMeterFillStyle(fill, line.tone ?? "default", this.theme, ratio);
    meter.appendChild(fill);
    row.append(header, meter);
    return row;
  }

  private renderActions(
    actions: readonly UiAction[],
    source: Pick<UiOverlayActionEvent, "panelId" | "dialogId">,
  ): HTMLElement {
    const container = document.createElement("div");
    applyActionsStyle(container);
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = action.disabled === true;
      button.textContent = action.label;
      button.setAttribute("aria-label", action.ariaLabel ?? action.label);
      button.setAttribute("aria-disabled", String(button.disabled));
      applyActionStyle(button, action.tone ?? "default", this.theme);
      button.addEventListener("click", () => {
        if (!button.disabled) {
          this.options.onAction?.({ id: action.id, ...source });
        }
      });
      container.appendChild(button);
    }
    return container;
  }
}

function applyRootStyle(root: HTMLElement, theme: ResolvedHudThemeTokens): void {
  root.style.position = "absolute";
  root.style.inset = "0";
  root.style.zIndex = "20";
  root.style.pointerEvents = "none";
  root.style.overflow = "hidden";
  root.style.color = theme.textColor;
  root.style.font = theme.font;
}

function applyRegionStyle(element: HTMLElement, region: UiOverlayRegion): void {
  element.style.position = "absolute";
  element.style.display = "flex";
  element.style.flexDirection = "column";
  element.style.gap = "8px";
  element.style.maxWidth = "min(320px, calc(100% - 24px))";
  element.style.pointerEvents = "none";

  if (region.includes("top")) element.style.top = "12px";
  if (region.includes("bottom")) element.style.bottom = "12px";
  if (region.includes("left")) element.style.left = "12px";
  if (region.includes("right")) {
    element.style.right = "12px";
    element.style.alignItems = "flex-end";
  }
  if (region === "center") {
    element.style.inset = "0";
    element.style.justifyContent = "center";
    element.style.alignItems = "center";
    element.style.maxWidth = "none";
  }
}

function applyPanelStyle(panel: HTMLElement, theme: ResolvedHudThemeTokens): void {
  panel.style.minWidth = "168px";
  panel.style.maxWidth = "100%";
  panel.style.padding = "10px 12px";
  panel.style.border = `1px solid ${theme.panelBorder}`;
  panel.style.borderRadius = theme.borderRadius;
  panel.style.background = theme.panelBackground;
  panel.style.boxShadow = theme.panelShadow;
  panel.style.pointerEvents = "auto";
}

function applyDialogStyle(dialog: HTMLElement, theme: ResolvedHudThemeTokens): void {
  applyPanelStyle(dialog, theme);
  dialog.style.width = "min(360px, calc(100% - 32px))";
  dialog.style.padding = "14px 16px";
}

function applyTitleStyle(title: HTMLElement): void {
  title.style.margin = "0 0 8px";
  title.style.fontSize = "15px";
  title.style.fontWeight = "700";
  title.style.letterSpacing = "0";
}

function applyBodyStyle(body: HTMLElement): void {
  body.style.margin = "0 0 12px";
  body.style.color = "#cbd5e1";
}

function applyLineStyle(row: HTMLElement, tone: UiOverlayTone, theme: ResolvedHudThemeTokens): void {
  row.style.display = "flex";
  row.style.justifyContent = "space-between";
  row.style.gap = "12px";
  row.style.color = colorForTone(tone, theme);
}

function applyLineLabelStyle(label: HTMLElement, theme: ResolvedHudThemeTokens): void {
  label.style.color = theme.mutedTextColor;
}

function applyLineValueStyle(value: HTMLElement): void {
  value.style.fontWeight = "650";
  value.style.textAlign = "right";
}

function applyMeterHeaderStyle(header: HTMLElement): void {
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.gap = "12px";
}

function applyMeterTrackStyle(meter: HTMLElement, theme: ResolvedHudThemeTokens): void {
  meter.style.height = "6px";
  meter.style.width = "100%";
  meter.style.borderRadius = "999px";
  meter.style.overflow = "hidden";
  meter.style.background = theme.meterTrackBackground;
}

function applyMeterFillStyle(
  fill: HTMLElement,
  tone: UiOverlayTone,
  theme: ResolvedHudThemeTokens,
  ratio: number,
): void {
  fill.style.height = "100%";
  fill.style.width = `${Math.round(Math.min(Math.max(ratio, 0), 1) * 100)}%`;
  fill.style.borderRadius = "inherit";
  fill.style.background = colorForTone(tone, theme);
}

function applyActionsStyle(container: HTMLElement): void {
  container.style.display = "flex";
  container.style.flexWrap = "wrap";
  container.style.gap = "8px";
  container.style.marginTop = "10px";
}

function applyActionStyle(
  button: HTMLButtonElement,
  tone: UiOverlayActionTone,
  theme: ResolvedHudThemeTokens,
): void {
  button.style.minWidth = "72px";
  button.style.height = "32px";
  button.style.border = "1px solid rgba(148, 163, 184, 0.42)";
  button.style.borderRadius = theme.borderRadius;
  button.style.color = theme.textColor;
  button.style.background = backgroundForActionTone(tone, theme);
  button.style.font = "inherit";
  button.style.cursor = "pointer";
  button.style.pointerEvents = "auto";
}

function colorForTone(tone: UiOverlayTone, theme: ResolvedHudThemeTokens): string {
  if (tone === "muted") return theme.mutedTextColor;
  if (tone === "accent") return theme.accentTextColor;
  if (tone === "danger") return theme.dangerTextColor;
  return theme.textColor;
}

function backgroundForActionTone(tone: UiOverlayActionTone, theme: ResolvedHudThemeTokens): string {
  if (tone === "primary") return theme.primaryButtonBackground;
  if (tone === "danger") return theme.dangerButtonBackground;
  return theme.buttonBackground;
}
