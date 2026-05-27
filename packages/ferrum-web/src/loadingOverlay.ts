import type { AssetLoadProgress } from "./assetLoader.js";

export type LoadingOverlayStatus = "idle" | "loading" | "complete" | "error";

export interface LoadingOverlayOptions {
  enabled?: boolean;
  className?: string;
  title?: string;
  completeTitle?: string;
  errorTitle?: string;
  showDetail?: boolean;
  autoHideOnComplete?: boolean;
}

export interface LoadingOverlayState {
  status: LoadingOverlayStatus;
  progress: AssetLoadProgress;
  title: string;
  detail: string;
}

const EMPTY_PROGRESS: AssetLoadProgress = Object.freeze({
  loaded: 0,
  total: 0,
  ratio: 1,
  elapsedMs: 0,
});

export class LoadingOverlay {
  private root?: HTMLDivElement;
  private titleElement?: HTMLHeadingElement;
  private detailElement?: HTMLDivElement;
  private barElement?: HTMLDivElement;
  private status: LoadingOverlayStatus = "idle";
  private progress: AssetLoadProgress = EMPTY_PROGRESS;
  private title = "";
  private detail = "";
  private destroyed = false;

  constructor(
    parent: HTMLElement = document.body,
    private readonly options: LoadingOverlayOptions = {},
  ) {
    this.title = options.title ?? "Loading";
    this.detail = "Preparing assets";
    if (options.enabled === false) {
      return;
    }

    const root = document.createElement("div");
    root.className = options.className ?? "ferrum-loading-overlay";
    root.setAttribute("data-ferrum-loading-overlay", "true");
    styleRoot(root);

    const panel = document.createElement("section");
    panel.setAttribute("role", "status");
    panel.setAttribute("aria-live", "polite");
    stylePanel(panel);

    const title = document.createElement("h2");
    title.setAttribute("data-ferrum-loading-title", "true");
    styleTitle(title);

    const track = document.createElement("div");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("data-ferrum-loading-progress", "true");
    styleTrack(track);

    const bar = document.createElement("div");
    bar.setAttribute("data-ferrum-loading-progress-bar", "true");
    styleBar(bar);
    track.appendChild(bar);

    const detail = document.createElement("div");
    detail.setAttribute("data-ferrum-loading-detail", "true");
    styleDetail(detail);

    panel.append(title, track, detail);
    root.appendChild(panel);
    parent.appendChild(root);

    this.root = root;
    this.titleElement = title;
    this.detailElement = detail;
    this.barElement = bar;
    this.render();
  }

  update(progress: AssetLoadProgress): void {
    if (this.destroyed) {
      return;
    }
    this.status = "loading";
    this.progress = normalizeProgress(progress);
    this.title = this.options.title ?? "Loading";
    this.detail = progressDetail(this.progress);
    this.show();
    this.render();
  }

  complete(title = this.options.completeTitle ?? "Ready"): void {
    if (this.destroyed) {
      return;
    }
    this.status = "complete";
    this.progress = normalizeProgress({ ...this.progress, loaded: this.progress.total, ratio: 1 });
    this.title = title;
    this.detail = "Assets loaded";
    this.render();
    if (this.options.autoHideOnComplete === true) {
      this.hide();
    }
  }

  fail(error: unknown, title = this.options.errorTitle ?? "Load failed"): void {
    if (this.destroyed) {
      return;
    }
    this.status = "error";
    this.title = title;
    this.detail = error instanceof Error ? error.message : String(error);
    this.show();
    this.render();
  }

  state(): LoadingOverlayState {
    return {
      status: this.status,
      progress: this.progress,
      title: this.title,
      detail: this.detail,
    };
  }

  hide(): void {
    if (this.root) {
      this.root.style.display = "none";
    }
  }

  show(): void {
    if (this.root) {
      this.root.style.display = "";
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.root?.remove();
    this.root = undefined;
    this.titleElement = undefined;
    this.detailElement = undefined;
    this.barElement = undefined;
  }

  private render(): void {
    const ratio = ratioFor(this.progress);
    const percent = Math.round(ratio * 100);
    if (this.titleElement) {
      this.titleElement.textContent = this.title;
    }
    if (this.detailElement) {
      this.detailElement.textContent = this.options.showDetail === false ? "" : this.detail;
    }
    if (this.barElement) {
      this.barElement.style.width = `${percent}%`;
      const track = this.barElement.parentElement;
      track?.setAttribute("aria-valuenow", String(percent));
      track?.setAttribute("aria-valuetext", `${percent}%`);
    }
    this.root?.setAttribute("data-ferrum-loading-status", this.status);
  }
}

function progressDetail(progress: AssetLoadProgress): string {
  const loaded = Math.max(0, progress.loaded);
  const total = Math.max(0, progress.total);
  const prefix = progress.kind && progress.name
    ? `Loading ${progress.kind} ${progress.name}`
    : "Preparing assets";
  const cached = progress.cached === true ? " cached" : "";
  return `${prefix} (${loaded}/${total})${cached}`;
}

function normalizeProgress(progress: AssetLoadProgress): AssetLoadProgress {
  const loaded = clampFinite(progress.loaded, 0, Number.MAX_SAFE_INTEGER);
  const total = clampFinite(progress.total, 0, Number.MAX_SAFE_INTEGER);
  return {
    ...progress,
    loaded,
    total,
    ratio: ratioFor({ ...progress, loaded, total }),
    elapsedMs: Number.isFinite(progress.elapsedMs) ? progress.elapsedMs : 0,
  };
}

function ratioFor(progress: AssetLoadProgress): number {
  if (Number.isFinite(progress.ratio)) {
    return clampFinite(progress.ratio ?? 0, 0, 1);
  }
  if (progress.total <= 0) {
    return 1;
  }
  return clampFinite(progress.loaded / progress.total, 0, 1);
}

function clampFinite(value: number | undefined, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value ?? min));
}

function styleRoot(root: HTMLDivElement): void {
  root.style.position = "absolute";
  root.style.inset = "0";
  root.style.zIndex = "25";
  root.style.display = "flex";
  root.style.alignItems = "center";
  root.style.justifyContent = "center";
  root.style.padding = "18px";
  root.style.pointerEvents = "none";
  root.style.color = "#f8fafc";
  root.style.background = "rgba(2, 6, 23, 0.58)";
  root.style.font = "13px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
}

function stylePanel(panel: HTMLElement): void {
  panel.style.width = "min(360px, calc(100% - 24px))";
  panel.style.padding = "14px 16px";
  panel.style.border = "1px solid rgba(148, 163, 184, 0.36)";
  panel.style.borderRadius = "6px";
  panel.style.background = "rgba(15, 23, 42, 0.88)";
  panel.style.boxShadow = "0 8px 24px rgba(2, 6, 23, 0.3)";
}

function styleTitle(title: HTMLElement): void {
  title.style.margin = "0 0 10px";
  title.style.fontSize = "15px";
  title.style.fontWeight = "700";
  title.style.letterSpacing = "0";
}

function styleTrack(track: HTMLElement): void {
  track.style.width = "100%";
  track.style.height = "8px";
  track.style.overflow = "hidden";
  track.style.borderRadius = "999px";
  track.style.background = "rgba(148, 163, 184, 0.28)";
}

function styleBar(bar: HTMLElement): void {
  bar.style.width = "0%";
  bar.style.height = "100%";
  bar.style.borderRadius = "999px";
  bar.style.background = "#22c55e";
  bar.style.transition = "width 120ms ease";
}

function styleDetail(detail: HTMLElement): void {
  detail.style.minHeight = "18px";
  detail.style.marginTop = "8px";
  detail.style.color = "#cbd5e1";
  detail.style.fontSize = "12px";
}
