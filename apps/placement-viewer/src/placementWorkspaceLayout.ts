import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
import { createPlacementControlMenu } from "./placementControlMenu";
import { decorateViewportAction } from "./placementViewportChrome";
import { WORKSPACE_PRESETS, WORKSPACE_LIMITS as LIMITS, clampWorkspaceSize as clamp,
  defaultWorkspaceLayout, readWorkspacePreferences, serializeWorkspacePresets,
  type WorkspaceDock as Dock, type WorkspacePreset } from "./placementWorkspacePreferences";
const RAIL_SIZE = 26;
/** Collapsed docks leave these entries behind, like IDE tool window stripes. */
const RAIL_TABS = {
  scene: [["objects", "Objects"], ["project", "Project scenes"]],
  inspector: [["properties", "Properties"], ["placement", "Placement"], ["lighting", "Lighting"]],
  runtime: [["assets", "Assets"], ["problems", "Problems"], ["runtime", "Runtime"], ["changes", "Agent Changes"]],
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
  options: { canChange(): boolean } = { canChange: () => true },
) {
  const storageKey = `ferrum.placement.layout.v1:${projectKey}`;
  const presetsKey = `ferrum.placement.layout-presets.v1:${projectKey}`;
  const runtimeTabs = '.placement-runtime-dock > .placement-panel-tabs > .placement-panel-tablist > [data-placement-panel-tab]';
  const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
  const preferences = readWorkspacePreferences(read(storageKey), read(presetsKey));
  let layout = preferences.layouts[preferences.active];
  let focused = false;
  // The pixel editor brings its own side panels, so scene docks yield without
  // touching saved layouts. Docks opened from there stay until the tab changes.
  let pixelActive = false;
  const pixelRevealed = new Set<Dock>();
  // An unpinned bottom dock is a strip whose body overlays the viewport without resizing it.
  let drawerOpen = false, drawerDragging = false, drawerTab: string | undefined, drawerReturn: HTMLElement | undefined;
  const pinned = () => layout.runtimePinned === true;
  const selectedRuntimeTab = () => root.querySelector<HTMLElement>(runtimeTabs + '[aria-selected="true"]')?.dataset.placementPanelTab;
  const defaultPanel = (): Dock | undefined => preferences.active === "scene" ? "scene" : preferences.active === "custom" ? undefined : "runtime";
  const defaultTab = () => preferences.active === "assets" ? "assets" : preferences.active === "review" ? "runtime" : undefined;
  let compactPanel: Dock | undefined = defaultPanel();
  const sessions = new Map<WorkspacePreset, { focused: boolean; compactPanel?: Dock; runtimeTab?: string }>();
  let returnFocus: HTMLElement | undefined;
  const compact = () => root.clientWidth <= 860;
  const pixelYields = (dock: Dock) => pixelActive && dock !== "runtime";
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
        collapse?: boolean;
      }
    | undefined;
  const controls = document.createElement("div");
  controls.className = "placement-layout-controls";
  setUiAttribute(controls, "aria-label", "Workspace panels");
  const layoutMenu = createPlacementControlMenu("layout", "Layout", "layout");
  const presets = document.createElement("fieldset"), legend = document.createElement("legend"), hint = document.createElement("p");
  presets.className = "placement-layout-presets";
  setUiText(legend, "Task Layouts"); setUiText(hint, "View mode and playback stay unchanged");
  presets.append(legend);
  const presetButtons = new Map<WorkspacePreset, HTMLButtonElement>();
  for (const { id, label } of WORKSPACE_PRESETS) {
    const button = document.createElement("button"); button.type = "button";
    button.dataset.placementLayoutPreset = id; setUiText(button, label);
    button.addEventListener("click", () => {
      if (drag || root.inert || !options.canChange()) return;
      if (preferences.active !== id) {
        sessions.set(preferences.active, { focused, compactPanel,
          runtimeTab: root.querySelector<HTMLElement>(runtimeTabs + '[aria-selected="true"]')?.dataset.placementPanelTab });
        preferences.active = id; layout = preferences.layouts[id];
        const session = sessions.get(id);
        focused = session?.focused ?? false;
        compactPanel = session ? session.compactPanel : defaultPanel();
        const tab = session?.runtimeTab ?? defaultTab();
        sync(false); persistPreferences(false); selectRuntimeTab(tab);
      }
      layoutMenu.close(true);
    });
    presetButtons.set(id, button); presets.append(button);
  }
  presets.append(hint); layoutMenu.panel.append(presets);
  function selectRuntimeTab(id?: string) {
    const tab = [...root.querySelectorAll<HTMLButtonElement>(runtimeTabs)]
      .find(button => button.dataset.placementPanelTab === id);
    if (tab && !tab.disabled) tab.click();
  }
  function refreshPresets() {
    const blocked = !!drag || root.inert || !options.canChange();
    for (const [id, button] of presetButtons) {
      button.setAttribute("aria-pressed", String(preferences.active === id));
      button.disabled = blocked;
    }
    reset.disabled = blocked;
  }
  layoutMenu.element.addEventListener("toggle", refreshPresets);
  layoutMenu.summary.addEventListener("click", refreshPresets);
  const panelToggles = document.createElement("div");
  panelToggles.className = "placement-panel-toggles";
  layoutMenu.panel.append(panelToggles);
  const buttons = new Map<Dock, HTMLButtonElement>();
  const handles = new Map<Dock, HTMLDivElement>();
  const rails = new Map<Dock, HTMLDivElement>();
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
      if (pixelYields(dock)) {
        if (!pixelRevealed.delete(dock)) pixelRevealed.add(dock);
        sync(false);
        return;
      }
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
      const size = drag.size + (position - drag.origin) * (dock === "scene" ? 1 : -1);
      // Dragging well past the minimum collapses the dock instead of stopping at it.
      drag.collapse = size < LIMITS[dock][0] - 48;
      layout[dock] = clamp(dock, size);
      sync(false);
    });
    const finish = (event: PointerEvent, cancel: boolean) => {
      if (drag?.pointerId !== event.pointerId) return;
      const collapse = !cancel && drag.collapse === true;
      if (cancel || collapse) layout[dock] = drag.size;
      drag = undefined;
      delete root.dataset.resizingDock;
      if (handle.hasPointerCapture(event.pointerId))
        handle.releasePointerCapture(event.pointerId);
      if (collapse) minimize(dock);
      else sync(true);
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
    const rail = document.createElement("div");
    rail.className = `placement-dock-rail placement-dock-rail-${dock}`;
    rail.dataset.placementDockRail = dock;
    rail.setAttribute("role", "toolbar");
    setUiAttribute(rail, "aria-label", "Tool windows");
    if (dock !== "runtime") rail.setAttribute("aria-orientation", "vertical");
    for (const [id, label] of RAIL_TABS[dock]) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.dataset.placementRailTab = id;
      setUiText(tab, label);
      tab.addEventListener("click", () => openTool(dock, id));
      rail.append(tab);
    }
    rails.set(dock, rail);
    root.append(rail);
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
    if (drag || root.inert || !options.canChange()) return;
    layout = preferences.layouts[preferences.active] = defaultWorkspaceLayout(preferences.active);
    focused = false;
    compactPanel = defaultPanel();
    sessions.delete(preferences.active);
    sync(true);
    selectRuntimeTab(defaultTab());
  });
  const pin = document.createElement("button");
  pin.type = "button";
  pin.className = "placement-dock-pin";
  pin.dataset.placementDockPin = "true";
  root.querySelector(".placement-runtime-dock")?.append(pin);
  pin.addEventListener("click", () => {
    if (drag || root.inert) return;
    layout.runtimePinned = !pinned();
    drawerOpen = drawerDragging = false;
    sync(true);
  });
  function minimize(dock: Dock) {
    if (drag || root.inert) return;
    if (pixelYields(dock)) {
      pixelRevealed.delete(dock);
      sync(false);
      return;
    }
    if (dock === "runtime") {
      // The tab strip is the bottom dock's minimized form.
      layout.runtimePinned = false;
      drawerOpen = drawerDragging = false;
    } else if (!layout.hidden.includes(dock)) layout.hidden = [...layout.hidden, dock];
    sync(true);
  }
  function openTool(dock: Dock, id: string) {
    if (drag || root.inert) return;
    if (dock === "runtime") {
      selectRuntimeTab(id);
      reveal(dock);
    } else {
      reveal(dock);
      root.querySelector<HTMLElement>(`.placement-panel:not([hidden]) [data-placement-panel-tab="${id}"]`)?.click();
    }
    sync(true);
  }
  root.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-placement-dock-minimize]") : null;
    if (button) minimize(button.dataset.placementDockMinimize as Dock);
  });
  function closeBottomDrawer(restoreFocus = false) {
    if (!drawerOpen) return;
    drawerOpen = drawerDragging = false;
    sync(false);
    if (restoreFocus) drawerReturn?.focus({ preventScroll: true });
    drawerReturn = undefined;
  }
  // Tabs select their panel first; this listener only decides whether the drawer stays open.
  root.addEventListener("click", (event) => {
    const tab = event.target instanceof Element ? event.target.closest<HTMLElement>(runtimeTabs) : null;
    if (!tab || pinned() || compact()) return;
    const id = tab.dataset.placementPanelTab;
    // detail is 0 for commands and keyboard activation, which must never close the panel.
    drawerOpen = !(drawerOpen && drawerTab === id && event.detail > 0);
    drawerTab = id;
    sync(false);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!drawerOpen || pinned() || compact()) return;
    if (event.target instanceof Element && event.target.closest(".placement-runtime-dock, dialog, [role=dialog], [role=alertdialog]")) return;
    closeBottomDrawer();
  }, { capture: true });
  // Wait a task so the browser captures the drag image from the visible drawer.
  root.addEventListener("dragstart", (event) => {
    if (!drawerOpen || pinned() || !(event.target instanceof Element) || !event.target.closest(".placement-runtime-dock")) return;
    setTimeout(() => { if (drawerOpen) { drawerDragging = true; sync(false); } });
  });
  window.addEventListener("dragend", () => { if (drawerDragging) closeBottomDrawer(); });
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
  const editingText = (event: KeyboardEvent) => event.target instanceof Element &&
    !!event.target.closest("input, textarea, select, [contenteditable=true]");
  // Inside the drawer Escape dismisses it, after a filled field has had its own Escape.
  const ownsEscape = (event: KeyboardEvent) => event.target instanceof Element && event.target.closest(".placement-runtime-dock")
    ? event.target instanceof HTMLInputElement && event.target.value !== ""
    : editingText(event);
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Escape" || event.defaultPrevented || !drawerOpen || pinned() || compact() || root.inert || ownsEscape(event)) return;
    event.preventDefault();
    closeBottomDrawer(true);
  });
  // Capture: viewport canvases consume Space for panning before the event bubbles here.
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || !event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        event.repeat || event.isComposing || root.inert || compact() || editingText(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (drawerOpen && !pinned()) { closeBottomDrawer(true); return; }
    const active = document.activeElement;
    drawerReturn = active instanceof HTMLElement ? active : undefined;
    selectRuntimeTab("assets");
    reveal("runtime");
    root.querySelector<HTMLElement>("[data-placement-asset-search]")?.focus({ preventScroll: true });
  }, { capture: true });
  function reveal(dock: Dock) {
    if (compact()) compactPanel = dock;
    else {
      focused = false;
      if (pixelYields(dock)) pixelRevealed.add(dock);
      layout.hidden = layout.hidden.filter((value) => value !== dock);
      if (dock === "runtime" && !pinned()) {
        drawerOpen = true;
        drawerTab = selectedRuntimeTab();
      }
    }
    sync(false);
  }
  const stage = root.querySelector<HTMLElement>(".demo-stage");
  const pixelObserver = new MutationObserver(() => {
    const active = stage?.dataset.pixelEditor === "true";
    if (active === pixelActive) return;
    pixelActive = active;
    pixelRevealed.clear();
    sync(false);
  });
  if (stage) pixelObserver.observe(stage, { attributes: true, attributeFilter: ["data-pixel-editor"] });
  const observer = new ResizeObserver(() => sync(false));
  const observedRows = new Set<Element>();
  observer.observe(root);
  if (canvas) observer.observe(canvas);
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) { observer.disconnect(); pixelObserver.disconnect(); }
  });
  function sync(persist: boolean) {
    refreshPresets();
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
    const hidden: readonly Dock[] = focused ? ["scene", "inspector", "runtime"]
      : [...new Set([...layout.hidden, ...(["scene", "inspector"] as const).filter(dock => pixelYields(dock) && !isCompact && !pixelRevealed.has(dock))])];
    if (hidden.includes("runtime") || isCompact) drawerOpen = drawerDragging = false;
    const drawer = isCompact || pinned() ? "pinned" : !drawerOpen ? "closed" : drawerDragging ? "dragging" : "open";
    root.dataset.runtimeDrawer = drawer;
    pin.hidden = isCompact;
    pin.setAttribute("aria-pressed", String(pinned()));
    const pinLabel = pinned() ? "Undock Panel" : "Dock Panel";
    if (pin.dataset.caption !== pinLabel) {
      decorateViewportAction(pin, "pin", pinLabel, undefined, true);
      pin.dataset.caption = pinLabel;
    }
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
    const stripe = (dock: Dock) => !isCompact && !focused && hidden.includes(dock);
    root.style.setProperty("--scene-dock-width", `${stripe("scene") ? RAIL_SIZE : Math.round(scene)}px`);
    root.style.setProperty(
      "--inspector-dock-width",
      `${stripe("inspector") ? RAIL_SIZE : Math.round(inspector)}px`,
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
      rails.get(dock)!.hidden = !stripe(dock);
      for (const candidate of candidates) {
        const host = dock === "inspector" ? candidate.querySelector<HTMLElement>(".placement-inspector-header") : candidate;
        if (!host) continue;
        // Scene tabs adopt the dock's children, so keep the button on the dock itself.
        const existing = host.querySelector<HTMLElement>("[data-placement-dock-minimize]");
        if (existing) { if (existing.parentElement !== host) host.append(existing); continue; }
        const minimizeButton = document.createElement("button");
        minimizeButton.type = "button";
        minimizeButton.className = "placement-dock-minimize";
        minimizeButton.dataset.placementDockMinimize = dock;
        decorateViewportAction(minimizeButton, "minus", "Minimize Panel", undefined, true);
        host.append(minimizeButton);
      }
      if (dock === "runtime") for (const button of root.querySelectorAll<HTMLElement>('[data-placement-dock-minimize="runtime"]'))
        button.hidden = isCompact || drawer === "closed";
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
        preset: preferences.active,
        runtimeDrawer: drawer,
      },
    });
    if (persist) persistPreferences(true);
  }
  function persistPreferences(includeCustom: boolean) {
    try {
      if (includeCustom && preferences.active === "custom") localStorage.setItem(storageKey, JSON.stringify(layout));
      localStorage.setItem(presetsKey, serializeWorkspacePresets(preferences));
    } catch { /* Storage may be unavailable. */ }
  }
  sync(false);
  selectRuntimeTab(defaultTab());
  return {
    controls,
    sync: () => sync(false),
    refreshAvailability: refreshPresets,
    ownsGesture: () => drag !== undefined,
    reveal,
    dismissDrawer: () => closeBottomDrawer(),
  };
}
