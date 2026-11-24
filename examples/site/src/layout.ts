import { icon } from "./icons";
import { el, uiAttribute, type LocalizedText } from "./locale";

/** Panel sizes and folded panels on wide screens: the example list, the inspector and the bottom dock.
 * Sizes snap to 8px (Pixelforge side docks) and are kept for the next visit in this browser when storage
 * allows. Narrow screens stack the panels and ignore all of this (site.css). */

type Sized = "browser" | "inspector" | "dock";
type Foldable = "browser" | "inspector";

/** Starting size, smallest size and largest size in CSS pixels. The largest also gives way to the window:
 * site.css applies the same limits, so a size kept from a wider window never squeezes the viewport. */
const limits: Record<Sized, { initial: number; min: number; max: number }> = {
  browser: { initial: 264, min: 200, max: 480 },
  inspector: { initial: 312, min: 264, max: 560 },
  dock: { initial: 240, min: 120, max: 720 },
};
const SNAP = 8;
const storageKey = "ferrum.examples.layout.v1";

interface Layout { sizes: Record<Sized, number>; folded: Record<Foldable, boolean> }

function load(): Layout {
  const layout: Layout = {
    sizes: { browser: limits.browser.initial, inspector: limits.inspector.initial, dock: limits.dock.initial },
    folded: { browser: false, inspector: false },
  };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (saved && typeof saved === "object") {
      const { sizes, folded } = saved as Partial<Record<keyof Layout, Record<string, unknown>>>;
      for (const key of ["browser", "inspector", "dock"] as const) {
        const size = sizes?.[key];
        if (typeof size === "number" && Number.isFinite(size)) layout.sizes[key] = Math.min(limits[key].max, Math.max(limits[key].min, size));
      }
      for (const key of ["browser", "inspector"] as const) if (typeof folded?.[key] === "boolean") layout.folded[key] = folded[key];
    }
  } catch { /* Panels still resize and fold without storage. */ }
  return layout;
}

const layout = load();
const save = () => { try { localStorage.setItem(storageKey, JSON.stringify(layout)); } catch { /* Optional preference. */ } };

/** Writes a panel's size as `--<panel>-size` on the element whose grid uses it. */
export function applyPanelSize(host: HTMLElement, panel: Sized): void {
  host.style.setProperty(`--${panel}-size`, `${layout.sizes[panel]}px`);
}

export interface SplitterOptions {
  panel: Sized;
  /** "x" sizes a column (drag sideways); "y" sizes a row (drag up and down). */
  axis: "x" | "y";
  /** 1 when moving right or down makes the panel larger, -1 when it makes it smaller. */
  grow: 1 | -1;
  label: LocalizedText;
  /** The id of the panel this splitter sizes. */
  controls: string;
  /** Holds the `--<panel>-size` variable. */
  host: HTMLElement;
  /** The panel's size on screen now. */
  measure(): number;
  /** The largest size the window leaves room for now; never above the panel's own limit. */
  room(): number;
}

/** A splitter on the hairline between two panels (WAI-ARIA window splitter): drag it, use the arrow keys
 * (Shift for larger steps), Home and End, or double-click to return to the starting size. */
export function panelSplitter(options: SplitterOptions): HTMLElement {
  const { panel, axis, grow } = options;
  const { initial, min, max } = limits[panel];
  const node = el("div", `splitter splitter-${axis}`);
  node.tabIndex = 0;
  node.setAttribute("role", "separator");
  node.setAttribute("aria-orientation", axis === "x" ? "vertical" : "horizontal");
  node.setAttribute("aria-controls", options.controls);
  node.setAttribute("aria-valuemin", String(min));
  uiAttribute(node, "aria-label", options.label);

  const largest = () => Math.max(min, Math.min(max, Math.floor(options.room())));
  const describe = (size: number) => {
    node.setAttribute("aria-valuenow", String(size));
    node.setAttribute("aria-valuemax", String(largest()));
  };
  const resize = (size: number, keep = true) => {
    const next = Math.min(largest(), Math.max(min, Math.round(size / SNAP) * SNAP));
    layout.sizes[panel] = next;
    applyPanelSize(options.host, panel);
    describe(next);
    if (keep) save();
  };
  describe(layout.sizes[panel]);
  node.addEventListener("focus", () => describe(Math.round(options.measure())));

  node.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    const at = (pointer: PointerEvent) => axis === "x" ? pointer.clientX : pointer.clientY;
    const start = at(event), from = options.measure();
    const drag = new AbortController();
    node.setPointerCapture(event.pointerId);
    node.dataset.active = "";
    document.documentElement.dataset.resizing = axis;
    node.addEventListener("pointermove", move => resize(from + grow * (at(move) - start), false), { signal: drag.signal });
    node.addEventListener("lostpointercapture", () => {
      drag.abort();
      delete node.dataset.active;
      delete document.documentElement.dataset.resizing;
      save();
    }, { signal: drag.signal });
  });
  node.addEventListener("keydown", event => {
    const step = event.shiftKey ? SNAP * 4 : SNAP;
    const larger = axis === "x" ? (grow > 0 ? "ArrowRight" : "ArrowLeft") : (grow > 0 ? "ArrowDown" : "ArrowUp");
    const smaller = axis === "x" ? (grow > 0 ? "ArrowLeft" : "ArrowRight") : (grow > 0 ? "ArrowUp" : "ArrowDown");
    const now = options.measure();
    const next = event.key === larger ? now + step : event.key === smaller ? now - step
      : event.key === "Home" ? min : event.key === "End" ? largest() : undefined;
    if (next === undefined) return;
    event.preventDefault();
    resize(next);
  });
  node.addEventListener("dblclick", () => resize(initial));
  return node;
}

export interface FoldOptions {
  panel: Foldable;
  /** Holds `data-<panel>="folded" | "open"`; site.css draws the folded panel as a rail. */
  host: HTMLElement;
  /** The id of the content that folds away. */
  controls: string;
  labels: { fold: LocalizedText; unfold: LocalizedText };
  icons: { fold: string; unfold: string };
}

/** The button that folds a side panel to a rail and opens it again. It sits on the panel's outer edge,
 * so it stays under the pointer in both states. */
export function foldButton(options: FoldOptions): { button: HTMLButtonElement; set(folded: boolean): void } {
  const button = el("button", "panel-toggle"); button.type = "button";
  button.setAttribute("aria-controls", options.controls);
  const show = (folded: boolean) => {
    options.host.dataset[options.panel] = folded ? "folded" : "open";
    button.setAttribute("aria-expanded", String(!folded));
    const label = folded ? options.labels.unfold : options.labels.fold;
    uiAttribute(button, "aria-label", label);
    uiAttribute(button, "title", label);
    button.replaceChildren(icon(folded ? options.icons.unfold : options.icons.fold));
  };
  const set = (folded: boolean) => {
    layout.folded[options.panel] = folded;
    save();
    show(folded);
  };
  button.addEventListener("click", () => set(!layout.folded[options.panel]));
  show(layout.folded[options.panel]);
  return { button, set };
}

/** A rail button for a folded panel: an icon that opens the panel at one of its parts. */
export function railButton(name: string, label: LocalizedText, open: () => void): HTMLButtonElement {
  const button = el("button", "rail-btn"); button.type = "button";
  uiAttribute(button, "aria-label", label);
  uiAttribute(button, "title", label);
  button.append(icon(name));
  button.addEventListener("click", open);
  return button;
}
