export type UiOverlayRegion = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
export type UiOverlayTone = "default" | "muted" | "accent" | "danger";
export type UiOverlayActionTone = "default" | "primary" | "danger";

export interface UiTextLine {
  id?: string;
  label?: string;
  value?: string | number;
  text?: string;
  tone?: UiOverlayTone;
}

export interface UiAction {
  id: string;
  label: string;
  disabled?: boolean;
  tone?: UiOverlayActionTone;
}

export interface UiPanel {
  id: string;
  title?: string;
  region?: UiOverlayRegion;
  visible?: boolean;
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
  onAction?: (event: UiOverlayActionEvent) => void;
}

const REGIONS: readonly UiOverlayRegion[] = ["top-left", "top-right", "bottom-left", "bottom-right", "center"];

export class UiOverlay {
  private readonly root?: HTMLElement;
  private readonly regions = new Map<UiOverlayRegion, HTMLElement>();
  private destroyed = false;

  constructor(
    private readonly parent: HTMLElement = document.body,
    private readonly options: UiOverlayOptions = {},
  ) {
    if (options.enabled === false) {
      return;
    }

    const root = document.createElement("div");
    root.className = options.className ?? "ferrum-ui-overlay";
    applyRootStyle(root);
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
    section.setAttribute("data-ferrum-ui-panel", panel.id);
    applyPanelStyle(section);
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
    applyDialogStyle(section);
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
    applyLineStyle(row, line.tone ?? "default");
    if (line.id) {
      row.setAttribute("data-ferrum-ui-line", line.id);
    }
    if (line.text !== undefined) {
      row.textContent = line.text;
      return row;
    }

    const label = document.createElement("span");
    const value = document.createElement("strong");
    applyLineLabelStyle(label);
    applyLineValueStyle(value);
    label.textContent = line.label ?? "";
    value.textContent = line.value === undefined ? "" : String(line.value);
    row.append(label, value);
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
      applyActionStyle(button, action.tone ?? "default");
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

function applyRootStyle(root: HTMLElement): void {
  root.style.position = "absolute";
  root.style.inset = "0";
  root.style.zIndex = "20";
  root.style.pointerEvents = "none";
  root.style.overflow = "hidden";
  root.style.color = "#f8fafc";
  root.style.font = "13px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
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

function applyPanelStyle(panel: HTMLElement): void {
  panel.style.minWidth = "168px";
  panel.style.maxWidth = "100%";
  panel.style.padding = "10px 12px";
  panel.style.border = "1px solid rgba(148, 163, 184, 0.36)";
  panel.style.borderRadius = "6px";
  panel.style.background = "rgba(15, 23, 42, 0.82)";
  panel.style.boxShadow = "0 8px 24px rgba(2, 6, 23, 0.28)";
  panel.style.pointerEvents = "auto";
}

function applyDialogStyle(dialog: HTMLElement): void {
  applyPanelStyle(dialog);
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

function applyLineStyle(row: HTMLElement, tone: UiOverlayTone): void {
  row.style.display = "flex";
  row.style.justifyContent = "space-between";
  row.style.gap = "12px";
  row.style.color = colorForTone(tone);
}

function applyLineLabelStyle(label: HTMLElement): void {
  label.style.color = "#94a3b8";
}

function applyLineValueStyle(value: HTMLElement): void {
  value.style.fontWeight = "650";
  value.style.textAlign = "right";
}

function applyActionsStyle(container: HTMLElement): void {
  container.style.display = "flex";
  container.style.flexWrap = "wrap";
  container.style.gap = "8px";
  container.style.marginTop = "10px";
}

function applyActionStyle(button: HTMLButtonElement, tone: UiOverlayActionTone): void {
  button.style.minWidth = "72px";
  button.style.height = "32px";
  button.style.border = "1px solid rgba(148, 163, 184, 0.42)";
  button.style.borderRadius = "6px";
  button.style.color = "#f8fafc";
  button.style.background = backgroundForActionTone(tone);
  button.style.font = "inherit";
  button.style.cursor = "pointer";
  button.style.pointerEvents = "auto";
}

function colorForTone(tone: UiOverlayTone): string {
  if (tone === "muted") return "#94a3b8";
  if (tone === "accent") return "#7dd3fc";
  if (tone === "danger") return "#fca5a5";
  return "#f8fafc";
}

function backgroundForActionTone(tone: UiOverlayActionTone): string {
  if (tone === "primary") return "#2563eb";
  if (tone === "danger") return "#991b1b";
  return "#1e293b";
}
