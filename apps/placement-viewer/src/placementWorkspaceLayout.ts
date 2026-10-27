import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
import { createPlacementControlMenu } from "./placementControlMenu";
import { decorateViewportAction } from "./placementViewportChrome";
type Dock = "scene" | "inspector" | "runtime";
type Layout = {
  scene: number;
  inspector: number;
  runtime: number;
  hidden: Dock[];
};
const DEFAULTS: Layout = {
  scene: 240,
  inspector: 320,
  runtime: 168,
  hidden: [],
};
const LIMITS = {
  scene: [160, 400],
  inspector: [240, 480],
  runtime: [64, 280],
} as const;
const LABELS = {
  scene: "Scene",
  inspector: "Inspector",
  runtime: "Panels",
} as const;

/** UI preferences only; authored documents and edit history never enter storage. */
export function installPlacementWorkspaceLayout(
  root: HTMLElement,
  projectKey: string,
) {
  const storageKey = `ferrum.placement.layout.v1:${projectKey}`;
  let layout = loadLayout(storageKey);
  let focused = false;
  let compactPanel: Dock | undefined;
  let returnFocus: HTMLElement | undefined;
  const compact = () => root.clientWidth <= 860;
  const viewportTab = document.createElement("button"),
    drawerHeader = document.createElement("div"),
    drawerTitle = document.createElement("span"),
    closeDrawer = document.createElement("button");
  viewportTab.type = "button";
  setUiText(viewportTab, "Viewport");
  viewportTab.dataset.placementCompactViewport = "true";
  drawerHeader.className = "placement-drawer-header";
  closeDrawer.type = "button";
  setUiText(closeDrawer, "Close");
  closeDrawer.dataset.placementDrawerClose = "true";
  setUiAttribute(closeDrawer, "aria-label", "Close panel");
  drawerHeader.append(drawerTitle, closeDrawer);
  root.append(drawerHeader);
  const close = () => {
    compactPanel = undefined;
    sync(false);
    returnFocus?.focus({ preventScroll: true });
  };
  closeDrawer.addEventListener("click", close);
  viewportTab.addEventListener("click", () => {
    compactPanel = undefined;
    sync(false);
  });
  let drag:
    | {
        dock: Dock;
        pointerId: number;
        origin: number;
        size: number;
        target: HTMLElement;
      }
    | undefined;
  const controls = document.createElement("div");
  controls.className = "placement-layout-controls";
  setUiAttribute(controls, "aria-label", "Workspace panels");
  const layoutMenu = createPlacementControlMenu("layout", "Layout", "layout");
  const panelToggles = document.createElement("div");
  panelToggles.className = "placement-panel-toggles";
  layoutMenu.panel.append(panelToggles);
  const buttons = new Map<Dock, HTMLButtonElement>();
  const handles = new Map<Dock, HTMLDivElement>();
  controls.append(viewportTab);
  for (const dock of ["scene", "inspector", "runtime"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    setUiText(button, LABELS[dock]);
    button.dataset.placementDockToggle = dock;
    setUiAttribute(
      button,
      "title",
      uiMessage("Toggle {0}", uiMessage(LABELS[dock])),
    );
    button.addEventListener("click", () => {
      if (compact()) {
        returnFocus = button;
        compactPanel = compactPanel === dock ? undefined : dock;
        sync(false);
        return;
      }
      focused = false;
      layout.hidden = layout.hidden.includes(dock)
        ? layout.hidden.filter((item) => item !== dock)
        : [...layout.hidden, dock];
      sync(true);
    });
    panelToggles.append(button);
    buttons.set(dock, button);
    const handle = document.createElement("div");
    handle.className = `placement-dock-separator placement-dock-separator-${dock}`;
    handle.dataset.placementDockResize = dock;
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    setUiAttribute(
      handle,
      "aria-label",
      uiMessage("Resize {0}", uiMessage(LABELS[dock])),
    );
    handle.setAttribute(
      "aria-orientation",
      dock === "runtime" ? "horizontal" : "vertical",
    );
    handle.setAttribute("aria-valuemin", String(LIMITS[dock][0]));
    handle.setAttribute("aria-valuemax", String(LIMITS[dock][1]));
    setUiAttribute(handle, "title", "Drag to resize; arrows for fine adjustment");
    handle.setAttribute("aria-controls", `placement-${dock}-dock`);
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || root.inert) return;
      drag = {
        dock,
        pointerId: event.pointerId,
        origin: dock === "runtime" ? event.clientY : event.clientX,
        size: layout[dock],
        target: handle,
      };
      handle.focus({ preventScroll: true });
      handle.setPointerCapture(event.pointerId);
      root.dataset.resizingDock = dock;
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (drag?.pointerId !== event.pointerId) return;
      const position = dock === "runtime" ? event.clientY : event.clientX;
      layout[dock] = clamp(
        dock,
        drag.size + (position - drag.origin) * (dock === "scene" ? 1 : -1),
      );
      sync(false);
    });
    const finish = (event: PointerEvent, cancel: boolean) => {
      if (drag?.pointerId !== event.pointerId) return;
      if (cancel) layout[dock] = drag.size;
      drag = undefined;
      delete root.dataset.resizingDock;
      if (handle.hasPointerCapture(event.pointerId))
        handle.releasePointerCapture(event.pointerId);
      sync(true);
    };
    handle.addEventListener("pointerup", (event) => finish(event, false));
    handle.addEventListener("pointercancel", (event) => finish(event, true));
    handle.addEventListener("lostpointercapture", (event) =>
      finish(event, true),
    );
    handle.addEventListener("keydown", (event) => {
      if (event.code === "Escape" && drag) {
        handle.dispatchEvent(
          new PointerEvent("pointercancel", { pointerId: drag.pointerId }),
        );
        event.preventDefault();
        return;
      }
      const negative = dock === "runtime" ? "ArrowDown" : "ArrowLeft";
      const positive = dock === "runtime" ? "ArrowUp" : "ArrowRight";
      if (![negative, positive, "Home", "End"].includes(event.code)) return;
      event.preventDefault();
      const direction = event.code === positive ? 1 : -1;
      const sign = dock === "inspector" ? -1 : 1;
      layout[dock] =
        event.code === "Home"
          ? LIMITS[dock][0]
          : event.code === "End"
            ? LIMITS[dock][1]
            : clamp(
                dock,
                layout[dock] + direction * sign * (event.shiftKey ? 32 : 8),
              );
      sync(true);
    });
    handles.set(dock, handle);
    root.append(handle);
  }
  const focus = document.createElement("button");
  focus.type = "button";
  setUiText(focus, "Focus");
  setUiAttribute(focus, "title", "Focus viewport");
  focus.dataset.placementAction = "focus-viewport";
  const expand = root.querySelector<HTMLButtonElement>(
    "[data-placement-viewport-expand]",
  );
  const viewportSize = root.querySelector<HTMLElement>(
    "[data-placement-viewport-size]",
  );
  const canvas = root.querySelector<HTMLCanvasElement>("canvas.demo-canvas");
  const toggleFocus = () => {
    if (compact()) {
      compactPanel = undefined;
      sync(false);
      return;
    }
    focused = !focused;
    sync(false);
  };
  focus.addEventListener("click", toggleFocus);
  expand?.addEventListener("click", toggleFocus);
  const reset = document.createElement("button");
  reset.type = "button";
  setUiText(reset, "Reset Layout");
  reset.dataset.placementAction = "reset-layout";
  reset.addEventListener("click", () => {
    layout = { ...DEFAULTS, hidden: [] };
    focused = false;
    compactPanel = undefined;
    sync(true);
  });
  layoutMenu.panel.append(focus, reset);
  controls.append(panelToggles, layoutMenu.element);
  focus.addEventListener("click", () => layoutMenu.close(true));
  reset.addEventListener("click", () => layoutMenu.close(true));
  controls.addEventListener("keydown", (event) => {
    if (
      !compact() ||
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.code)
    )
      return;
    const tabs = [viewportTab, ...buttons.values()],
      index = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.code === "Home"
        ? 0
        : event.code === "End"
          ? tabs.length - 1
          : (index + (event.code === "ArrowRight" ? 1 : -1) + tabs.length) %
            tabs.length;
    tabs[next].click();
    tabs[next].focus({ preventScroll: true });
  });
  window.addEventListener("keydown", (event) => {
    if (
      event.code !== "Escape" ||
      event.defaultPrevented ||
      !compact() ||
      !compactPanel ||
      root.inert ||
      (event.target instanceof Element &&
        event.target.closest("input, textarea, select, [contenteditable=true]"))
    )
      return;
    event.preventDefault();
    close();
  });
  const observer = new ResizeObserver(() => sync(false));
  const observedRows = new Set<Element>();
  observer.observe(root);
  if (canvas) observer.observe(canvas);
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) observer.disconnect();
  });
  function sync(persist: boolean) {
    const width = root.clientWidth;
    const isCompact = compact();
    root.dataset.compact = String(isCompact);
    const toggleHome = isCompact ? controls : layoutMenu.panel;
    if (panelToggles.parentElement !== toggleHome) {
      layoutMenu.close();
      if (isCompact) controls.insertBefore(panelToggles, layoutMenu.element);
      else toggleHome.insertBefore(panelToggles, focus);
    }
    root.dataset.compactPanel = compactPanel ?? "none";
    viewportTab.hidden = !isCompact;
    drawerHeader.hidden = !isCompact || !compactPanel;
    setUiText(drawerTitle, compactPanel ? LABELS[compactPanel] : "");
    let fixedHeight = 0;
    for (const selector of [
      ".demo-toolbar",
      ".placement-workspace-strip",
      ".placement-viewport-toolbar",
      ".placement-status-bar",
    ]) {
      const row = root.querySelector(selector);
      if (!row) continue;
      if (selector === ".placement-viewport-toolbar" && row.closest(".placement-workspace-strip")) continue;
      fixedHeight += row.getBoundingClientRect().height;
      if (!observedRows.has(row)) {
        observedRows.add(row);
        observer.observe(row);
      }
    }
    const drawerHeight =
      isCompact && compactPanel
        ? Math.max(
            0,
            Math.min(
              260,
              root.clientHeight * 0.34,
              // Include the viewport's 1px border so its drawable canvas retains 128px.
              root.clientHeight - fixedHeight - 129,
            ),
          )
        : 0;
    root.style.setProperty(
      "--compact-drawer-height",
      `${Math.floor(drawerHeight)}px`,
    );
    controls.setAttribute("role", "group");
    panelToggles.setAttribute("role", isCompact ? "tablist" : "group");
    setUiAttribute(panelToggles, "aria-label", "Workspace panels");
    const tabHome = isCompact ? panelToggles : controls;
    if (viewportTab.parentElement !== tabHome) tabHome.prepend(viewportTab);
    if (isCompact) viewportTab.setAttribute("role", "tab");
    else viewportTab.removeAttribute("role");
    viewportTab.setAttribute("aria-selected", String(!compactPanel));
    viewportTab.setAttribute("aria-controls", "placement-viewport");
    viewportTab.tabIndex = compactPanel ? -1 : 0;
    // Desktop reserves 360px for the viewport. Collapse is always explicit.
    const hidden = focused ? ["scene", "inspector", "runtime"] : layout.hidden;
    const available = Math.max(0, width - 360 - 16);
    let scene = hidden.includes("scene") ? 0 : layout.scene;
    let inspector = hidden.includes("inspector") ? 0 : layout.inspector;
    const total = scene + inspector;
    if (total > available && total > 0) {
      const sceneMinimum = scene > 0 ? LIMITS.scene[0] : 0;
      const inspectorMinimum = inspector > 0 ? LIMITS.inspector[0] : 0;
      const minimum = sceneMinimum + inspectorMinimum;
      if (available >= minimum && total > minimum) {
        const ratio = (available - minimum) / (total - minimum);
        scene = sceneMinimum + (scene - sceneMinimum) * ratio;
        inspector = inspectorMinimum + (inspector - inspectorMinimum) * ratio;
      } else {
        scene *= available / total;
        inspector *= available / total;
      }
    }
    root.style.setProperty("--scene-dock-width", `${Math.round(scene)}px`);
    root.style.setProperty(
      "--inspector-dock-width",
      `${Math.round(inspector)}px`,
    );
    root.style.setProperty("--runtime-dock-height", `${layout.runtime}px`);
    for (const dock of ["scene", "inspector", "runtime"] as const) {
      root.dataset[`${dock}DockHidden`] = String(hidden.includes(dock));
      const button = buttons.get(dock)!;
      const candidates = [
        ...root.querySelectorAll<HTMLElement>(
          dock === "scene"
            ? ".placement-scene-dock"
            : dock === "inspector"
              ? ".placement-inspector"
              : ".placement-runtime-dock",
        ),
      ];
      // Documents hide their wrapper, not the nested Scene/Inspector panels.
      const panel = candidates.find(
        (candidate) => !candidate.closest("[hidden]"),
      );
      for (const inactive of candidates)
        if (inactive !== panel) inactive.removeAttribute("id");
      if (panel) {
        panel.id = "placement-" + dock + "-dock";
        button.setAttribute("aria-controls", panel.id);
      }
      if (isCompact) {
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(compactPanel === dock));
        button.removeAttribute("aria-pressed");
        button.tabIndex = compactPanel === dock ? 0 : -1;
      } else {
        button.removeAttribute("role");
        button.removeAttribute("aria-selected");
        button.setAttribute("aria-pressed", String(!hidden.includes(dock)));
        button.tabIndex = 0;
      }
      handles
        .get(dock)
        ?.setAttribute(
          "aria-valuenow",
          String(
            dock === "scene"
              ? Math.round(scene)
              : dock === "inspector"
                ? Math.round(inspector)
                : layout.runtime,
          ),
        );
    }
    focus.setAttribute("aria-pressed", String(focused));
    if (expand) {
      expand.hidden = isCompact;
      expand.setAttribute("aria-pressed", String(focused));
      const label = focused ? "Restore View" : "Expand View";
      if (expand.dataset.caption !== label) {
        decorateViewportAction(expand, focused ? "layout" : "fit", label, undefined, true);
        expand.dataset.caption = label;
      }
      setUiAttribute(
        expand,
        "title",
        focused ? "Restore workspace panels" : "Expand viewport by hiding panels",
      );
    }
    if (viewportSize && canvas) {
      const text = `${canvas.clientWidth} × ${canvas.clientHeight}`;
      if (viewportSize.textContent !== text)
        setUiText(viewportSize, uiMessage("{0}", text));
    }
    Object.assign(window, {
      ferrumPlacementWorkspaceLayout: {
        ...layout,
        hidden: [...layout.hidden],
        focused,
        compact: isCompact,
        compactPanel: compactPanel ?? "none",
      },
    });
    if (persist) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(layout));
      } catch {
        /* Storage may be unavailable. */
      }
    }
  }
  sync(false);
  return {
    controls,
    sync: () => sync(false),
    reveal(dock: Dock) {
      if (compact()) compactPanel = dock;
      else {
        focused = false;
        layout.hidden = layout.hidden.filter((value) => value !== dock);
      }
      sync(false);
    },
  };
}

function clamp(dock: Dock, value: number) {
  return Math.max(
    LIMITS[dock][0],
    Math.min(LIMITS[dock][1], Math.round(value)),
  );
}
function loadLayout(key: string): Layout {
  const layout = { ...DEFAULTS, hidden: [] as Dock[] };
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!value || typeof value !== "object") return layout;
    for (const dock of ["scene", "inspector", "runtime"] as const) {
      const size: unknown = Reflect.get(value, dock);
      if (typeof size === "number" && Number.isFinite(size))
        layout[dock] = clamp(dock, size);
    }
    const hidden: unknown = Reflect.get(value, "hidden");
    if (Array.isArray(hidden))
      layout.hidden = (["scene", "inspector", "runtime"] as const).filter(
        (dock) => hidden.includes(dock),
      );
  } catch {
    /* Malformed preferences use defaults. */
  }
  return layout;
}
