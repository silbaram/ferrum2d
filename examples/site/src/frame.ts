import { groups, links, type SiteExample } from "./catalog";
import { createControls } from "./controls";
import type { DisplayOption, EngineNumbers, ExampleEvent, ExampleSession, RendererChoice } from "./example";
import { icon } from "./icons";
import { applyPanelSize, foldButton, panelSplitter, railButton } from "./layout";
import { el, setUiText, translate, uiAttribute, uiText, type LocalizedText } from "./locale";
import { frameText as text, siteText } from "./messages";

/** The example screen: play bar, viewport, bottom dock and inspector around one example module
 * (docs/planning/example-site-rebuild-plan.md, "예제 화면 상세"). It owns the session lifecycle:
 * every start gets a new canvas and signal, and leaving or switching renderers aborts it. */

const labelButton = (button: HTMLButtonElement, label: LocalizedText) => {
  uiAttribute(button, "aria-label", label);
  uiAttribute(button, "title", label);
};
const iconButton = (name: string, label: LocalizedText, className = "pb-btn") => {
  const button = el("button", className); button.type = "button";
  labelButton(button, label);
  button.append(icon(name));
  return button;
};
const newWindowLink = (href: string, className: string, ...content: (Node | string)[]) => {
  const a = el("a", className); a.href = href; a.target = "_blank"; a.rel = "noreferrer";
  a.append(...content, el("span", "sr-only", siteText.newWindow));
  return a;
};

export type RunState = "loading" | "running" | "error";
/** The viewport keeps at least this much room when the inspector or the dock grows (site.css agrees). */
const MIN_VIEW = { width: 320, height: 160 };
const rendererNames: Record<RendererChoice, string> = { webgl2: "WebGL2", webgpu: "WebGPU" };

export interface FrameOptions {
  example: SiteExample;
  previous?: SiteExample;
  next?: SiteExample;
  /** Moves to another example inside the site. */
  open(id: string): void;
  /** The site's status bar, written while the example is on screen. */
  status: HTMLElement;
}

export function mountExample(main: HTMLElement, options: FrameOptions): { refreshLanguage(): void; destroy(): void } {
  const { example, status } = options;
  const group = groups.find(item => item.id === example.group)!;
  const params = new URLSearchParams(location.search);
  let renderer: RendererChoice = params.get("renderer") === "webgpu" ? "webgpu" : "webgl2";

  const root = el("div", "ex");
  root.style.setProperty("--ex-aspect", `${example.world.width} / ${example.world.height}`);
  applyPanelSize(root, "inspector");
  applyPanelSize(root, "dock");

  // Play bar.
  const bar = el("div", "playbar"); bar.setAttribute("role", "toolbar"); uiAttribute(bar, "aria-label", text.playback);
  const reset = iconButton("rotate-ccw", text.reset);
  // Pause and resume, for examples that run a game; hidden until a session offers it.
  const pause = iconButton("pause", text.pause); pause.hidden = true;
  pause.setAttribute("aria-pressed", "false");
  let paused = false;
  const showPaused = () => {
    pause.setAttribute("aria-pressed", String(paused));
    labelButton(pause, paused ? text.resume : text.pause);
    pause.replaceChildren(icon(paused ? "play" : "pause"));
  };
  const tab = el("div", "pb-tab");
  const dot = el("span", "dot"); dot.setAttribute("aria-hidden", "true");
  const runState = el("span", "sr-only");
  const runStateLabel = document.createTextNode(""); runState.append(runStateLabel);
  tab.append(dot, el("span", "t", example.title), runState);
  const select = el("select", "pb-select"); uiAttribute(select, "aria-label", text.renderer);
  const gpu = "gpu" in navigator;
  for (const choice of ["webgl2", "webgpu"] as const) {
    const option = el("option", undefined, choice === "webgpu" && !gpu ? text.webgpuUnavailable : rendererNames[choice]);
    option.value = choice; option.disabled = choice === "webgpu" && !gpu;
    select.append(option);
  }
  if (renderer === "webgpu" && !gpu) renderer = "webgl2";
  select.value = renderer;
  const previous = iconButton("chevron-left", text.previous(options.previous?.title));
  const next = iconButton("chevron-right", text.next(options.next?.title));
  previous.disabled = !options.previous; next.disabled = !options.next;
  const fullscreen = iconButton("maximize", text.fullscreen);
  // "표시" menu: check items the example offers for reading the picture, such as collision shapes.
  const displayWrap = el("div", "pb-menu"); displayWrap.hidden = true;
  const displayButton = el("button", "pb-menu-btn"); displayButton.type = "button";
  const displayMenu = el("div", "menu"); displayMenu.id = "display-menu"; displayMenu.setAttribute("role", "menu"); displayMenu.hidden = true;
  uiAttribute(displayMenu, "aria-label", text.displayMenu);
  displayButton.setAttribute("aria-haspopup", "menu"); displayButton.setAttribute("aria-expanded", "false");
  displayButton.setAttribute("aria-controls", displayMenu.id);
  displayButton.append(icon("eye"), el("span", "pb-menu-t", text.display), icon("chevron-down", "i chev"));
  displayWrap.append(displayButton, displayMenu);
  bar.append(reset, pause, tab, el("span", "pb-space"), displayWrap, select, el("span", "pb-sep"), previous, next, fullscreen);

  const menuItems = () => [...displayMenu.querySelectorAll<HTMLButtonElement>("[role=menuitemcheckbox]")];
  const setMenu = (open: boolean, focus = false) => {
    displayMenu.hidden = !open;
    displayButton.setAttribute("aria-expanded", String(open));
    if (open && focus) menuItems()[0]?.focus();
  };
  displayButton.addEventListener("click", event => setMenu(displayMenu.hidden, event.detail === 0));
  displayButton.addEventListener("keydown", event => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault(); setMenu(true, true);
  });
  displayMenu.addEventListener("keydown", event => {
    const items = menuItems(), at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault(); setMenu(false); displayButton.focus();
    } else if (event.key === "Tab") setMenu(false);
  });
  const closeMenu = (event: PointerEvent) => { if (!displayWrap.contains(event.target as Node)) setMenu(false); };
  document.addEventListener("pointerdown", closeMenu);
  const showDisplay = (options: readonly DisplayOption[]) => {
    setMenu(false);
    displayMenu.replaceChildren(...options.map(option => {
      const item = el("button", "menu-item"); item.type = "button"; item.tabIndex = -1;
      item.setAttribute("role", "menuitemcheckbox");
      item.append(icon("check", "i menu-check"), el("span", undefined, option.label));
      let value = option.value;
      const show = () => item.setAttribute("aria-checked", String(value));
      item.addEventListener("click", () => { value = !value; show(); option.onChange(value); });
      show();
      return item;
    }));
    displayWrap.hidden = !options.length;
  };

  // Viewport: the canvas keeps the world's aspect ratio on a grid.
  const viewport = el("div", "viewport");
  const stage = el("div", "stage");
  const message = el("div", "vp-state"); message.setAttribute("role", "status");
  viewport.append(stage, message);

  // Bottom dock: tabs only until one is chosen.
  const dock = el("div", "dock"); dock.dataset.open = "false";
  const tabs = el("div", "dock-tabs"); tabs.setAttribute("role", "tablist"); uiAttribute(tabs, "aria-label", text.materials);
  const panel = el("div", "dock-panel"); panel.id = "dock-panel"; panel.setAttribute("role", "tabpanel"); panel.tabIndex = 0; panel.hidden = true;
  type TabId = keyof typeof text.tabs;
  // The "이벤트" tab is there for examples that report events.
  const tabIds: readonly TabId[] = example.events ? ["about", "events", "scene", "api", "source", "engine"] : ["about", "scene", "api", "source", "engine"];
  const eventCount = el("span", "dock-count");
  const tabButtons = tabIds.map((id, index) => {
    const button = el("button", "dock-tab", text.tabs[id]); button.type = "button"; button.id = `dock-tab-${id}`;
    if (id === "events") button.append(eventCount);
    button.dataset.tab = id;
    button.setAttribute("role", "tab"); button.setAttribute("aria-controls", panel.id); button.setAttribute("aria-selected", "false");
    button.tabIndex = index ? -1 : 0;
    return button;
  });
  const toggle = iconButton("chevron-up", text.openPanel, "dock-toggle");
  toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-controls", panel.id);
  tabs.append(...tabButtons, el("span", "pb-space"), toggle);
  // The open dock grows upward from the line above its tabs.
  const dockSplitter = panelSplitter({
    panel: "dock", axis: "y", grow: -1, label: text.panelHeight, controls: panel.id, host: root,
    measure: () => panel.offsetHeight,
    room: () => panel.offsetHeight + viewport.clientHeight - MIN_VIEW.height,
  });
  dockSplitter.classList.add("dock-splitter");
  dock.append(dockSplitter, tabs, panel);

  // Inspector: a bar with the example's group and the fold button, then the name, what to try and what to
  // look at. Folded, it is a rail with one icon per section.
  const inspector = el("aside", "inspector"); inspector.id = "example-inspector"; uiAttribute(inspector, "aria-label", text.inspector);
  const inspectorBody = el("div", "insp-body"); inspectorBody.id = "example-inspector-body";
  const fold = foldButton({
    panel: "inspector", host: root, controls: inspectorBody.id,
    labels: { fold: text.collapseInspector, unfold: text.expandInspector },
    icons: { fold: "panel-right-close", unfold: "panel-right-open" },
  });
  const inspectorBar = el("div", "insp-bar");
  const path = el("div", "insp-path"); path.append(icon(group.icon), uiText(group.title));
  inspectorBar.append(path, fold.button);
  const head = el("header", "insp-head");
  head.append(el("h1", "insp-name", example.title), el("p", "insp-summary", example.summary));
  const section = (title: LocalizedText, id: string, ...content: Node[]) => {
    const node = el("section", "sec");
    const h2 = el("h2"); const button = el("button", "sec-h"); button.type = "button";
    const body = el("div", "sec-body"); body.id = `sec-${id}`;
    button.setAttribute("aria-expanded", "true"); button.setAttribute("aria-controls", body.id);
    button.append(icon("chevron-down", "i chev"), uiText(title));
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open)); body.hidden = !open;
    });
    h2.append(button); body.append(...content); node.append(h2, body);
    return node;
  };
  const fields = el("div", "fields");
  const observe = el("ul", "observe");
  observe.append(...example.observe.map(text => el("li", undefined, text)));
  inspectorBody.append(head, section(text.try, "try", fields), section(text.observe, "observe", observe));
  const rail = el("div", "rail");
  for (const [id, name, title] of [["try", "sliders-horizontal", text.try], ["observe", "eye", text.observe]] as const) {
    rail.append(railButton(name, title, () => {
      fold.set(false);
      const heading = inspectorBody.querySelector<HTMLButtonElement>(`[aria-controls="sec-${id}"]`)!;
      if (heading.getAttribute("aria-expanded") === "false") heading.click();
      heading.scrollIntoView({ block: "nearest" });
      heading.focus();
    }));
  }
  inspector.append(inspectorBar, rail, inspectorBody);
  const inspectorSplitter = panelSplitter({
    panel: "inspector", axis: "x", grow: -1, label: text.inspectorWidth, controls: inspector.id, host: root,
    measure: () => inspector.offsetWidth,
    room: () => inspector.offsetWidth + viewport.clientWidth - MIN_VIEW.width,
  });
  inspectorSplitter.classList.add("insp-splitter");

  root.append(bar, viewport, dock, inspector, inspectorSplitter);
  main.replaceChildren(root);

  // Status bar and the engine tab show the same numbers.
  let numbers: EngineNumbers | undefined, state: RunState = "loading", failure = "";
  const renderStatus = () => {
    const parts: (string | Node)[] = [];
    const lamp = el("span", "sb-dot"); lamp.dataset.state = state;
    if (state === "error") parts.push(el("span", "sb-error", translate(text.runState.error)));
    else if (!numbers) parts.push(state === "running" ? rendererNames[renderer] : translate(text.runState.loading));
    else parts.push(rendererNames[numbers.renderer], `${Math.round(numbers.fps)} FPS`, `${translate(text.entities)} ${numbers.entities}`,
      `${translate(text.commands)} ${numbers.commands}`, `${translate(text.drawCalls)} ${numbers.drawCalls}`,
      ...(numbers.textures === undefined ? [] : [`${translate(text.textures)} ${numbers.textures}`]),
      ...(numbers.extra ?? []).map(item => `${translate(item.label)} ${item.value}`));
    status.replaceChildren(lamp, ...parts.map(part => typeof part === "string" ? el("span", undefined, part) : part),
      el("span", "sb-right", translate(siteText.build)));
  };
  const setState = (next: RunState, detail = "") => {
    state = next; failure = detail;
    dot.dataset.state = next;
    const label = text.runState[next];
    setUiText(runStateLabel, { ko: ` (${label.ko})`, en: ` (${label.en})` });
    message.replaceChildren();
    message.hidden = next === "running";
    if (next === "loading") message.append(icon("loader-circle", "i spin"), uiText(text.runState.loading));
    if (next === "error") {
      const retry = el("button", "btn", text.retry); retry.type = "button";
      retry.addEventListener("click", () => void start());
      message.append(icon("triangle-alert", "i warn"), el("b", undefined, text.startError), el("span", undefined, failure), retry);
    }
    renderStatus();
    if (current === "engine") renderTab();
  };

  // The "이벤트" tab keeps the latest lines of this session; the tab shows how many arrived.
  const MAX_EVENTS = 200;
  let events: (ExampleEvent & { time: number })[] = [], eventTotal = 0, eventsQueued = 0, startedAt = performance.now();
  const pushEvent = (entry: ExampleEvent) => {
    events.unshift({ ...entry, time: (performance.now() - startedAt) / 1000 });
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
    eventTotal++;
    eventsQueued ||= requestAnimationFrame(() => {
      eventsQueued = 0;
      eventCount.textContent = eventTotal ? String(eventTotal) : "";
      if (current === "events") renderTab();
    });
  };

  // Dock tabs.
  let current: TabId | undefined, scene: { text: string; focus?: string } | undefined, code: string | undefined;
  const renderScene = () => {
    const wrap = el("div", "dock-scene");
    const tools = el("div", "dock-tools");
    tools.append(el("span", undefined, text.liveScene));
    const copy = el("button", "btn small"); copy.type = "button";
    const copyLabel = uiText(text.copy); copy.append(icon("copy"), copyLabel);
    copy.addEventListener("click", () => {
      void navigator.clipboard?.writeText(scene?.text ?? "").then(
        () => setUiText(copyLabel, text.copied), () => setUiText(copyLabel, text.copyFailed),
      );
    });
    tools.append(copy);
    const pre = el("pre", "code");
    const lines = (scene?.text ?? "").split("\n");
    // Mark the focused instance: from its opening brace to the matching close.
    let from = -1, to = -1;
    if (scene?.focus) {
      const at = lines.findIndex(line => line.trim() === `"id": ${JSON.stringify(scene!.focus)},`);
      if (at > 0) {
        const indent = (line: string) => line.length - line.trimStart().length;
        from = at - 1; while (from > 0 && !(lines[from]!.trim() === "{" && indent(lines[from]!) < indent(lines[at]!))) from--;
        to = at; while (to < lines.length - 1 && !(lines[to]!.trim().startsWith("}") && indent(lines[to]!) === indent(lines[from]!))) to++;
      }
    }
    lines.forEach((line, index) => {
      const span = el("span", index >= from && index <= to && from >= 0 ? "ln hl" : "ln", line);
      pre.append(span, "\n");
    });
    wrap.append(tools, pre);
    panel.replaceChildren(wrap);
    // Bring the marked instance to the top of the panel without scrolling anything around it.
    const marked = pre.querySelector<HTMLElement>(".hl");
    if (marked) panel.scrollTop = Math.max(0, marked.offsetTop - wrap.offsetTop - 8);
  };
  const renderTab = () => {
    if (!current) return;
    if (current === "about") {
      const body = el("div", "dock-text");
      const steps = el("ol"); steps.append(...example.about.steps.map(text => el("li", undefined, text)));
      const part = (title: LocalizedText, content: Node) => { const div = el("div"); div.append(el("h3", undefined, title), content); return div; };
      body.append(part(text.useCase, el("p", undefined, example.about.useCase)), part(text.steps, steps),
        part(text.reading, el("p", undefined, example.about.reading)));
      panel.replaceChildren(body);
    } else if (current === "events") {
      const wrap = el("div", "dock-events");
      const tools = el("div", "dock-tools");
      const clear = el("button", "btn small", text.clearEvents); clear.type = "button";
      clear.addEventListener("click", () => { events = []; eventTotal = 0; eventCount.textContent = ""; renderTab(); });
      tools.append(el("span", undefined, text.eventsIntro), clear);
      wrap.append(tools);
      if (!events.length) wrap.append(el("p", "dock-empty", text.noEvents));
      else {
        const table = el("table", "event-log");
        const head = el("tr");
        head.append(el("th", undefined, text.eventTime), el("th", undefined, text.eventKind), el("th", undefined, text.eventDetail));
        const thead = el("thead"); thead.append(head);
        const body = el("tbody");
        for (const event of events) {
          const row = el("tr"); row.dataset.tone = event.tone ?? "info";
          row.append(el("td", "ev-time", event.time.toFixed(2)), el("td", "ev-kind", event.kind), el("td", "ev-detail", event.detail));
          body.append(row);
        }
        table.append(thead, body);
        wrap.append(table);
      }
      panel.replaceChildren(wrap);
    } else if (current === "scene") renderScene();
    else if (current === "api") {
      const list = el("dl", "dock-api");
      for (const item of example.api) list.append(el("dt", undefined, item.name), el("dd", undefined, item.text));
      panel.replaceChildren(list);
    } else if (current === "source") {
      const body = el("div", "dock-source");
      const files = el("div", "dock-tools");
      for (const source of example.sources) files.append(newWindowLink(links.source(source), "src-link", icon("github"), source));
      const pre = el("pre", "code");
      const content = code === undefined ? uiText(text.runState.loading) : document.createTextNode(code);
      pre.append(content);
      body.append(files, pre);
      panel.replaceChildren(body);
      if (code === undefined) void example.code().then(source => {
        code = source;
        setUiText(content, source);
      }, () => setUiText(content, text.sourceError));
    } else {
      const list = el("dl", "dock-engine");
      const canvas = stage.querySelector("canvas");
      const rows: [string, string][] = [
        [translate(text.status), translate(text.runState[state]) + (state === "error" ? ` · ${failure}` : "")],
        [translate(text.renderer), numbers ? rendererNames[numbers.renderer] + (numbers.renderer === renderer ? "" : translate(text.rendererFallback(rendererNames[renderer]))) : "—"],
        ["FPS", numbers ? numbers.fps.toFixed(1) : "—"],
        [translate(text.entities), numbers ? String(numbers.entities) : "—"],
        [translate(text.commands), numbers ? String(numbers.commands) : "—"],
        [translate(text.drawCalls), numbers ? String(numbers.drawCalls) : "—"],
        [translate(text.textures), numbers?.textures === undefined ? "—" : translate(text.textureCount(numbers.textures))
          + (numbers.textureBytes === undefined ? "" : ` · ${(numbers.textureBytes / 1024).toFixed(1)} KiB`)],
        ...(numbers?.extra ?? []).map(item => [translate(item.label), String(item.value)] as [string, string]),
        [translate(text.world), `${example.world.width} × ${example.world.height}`],
        [translate(text.canvas), canvas ? `${canvas.clientWidth} × ${canvas.clientHeight} CSS px · ${canvas.width} × ${canvas.height} px` : "—"],
      ];
      for (const [key, value] of rows) list.append(el("dt", undefined, key), el("dd", undefined, value));
      panel.replaceChildren(list);
    }
  };
  const setTab = (id: TabId | undefined) => {
    // Another tab starts at its top; the scene tab then scrolls to its marked lines.
    if (id !== current) panel.scrollTop = 0;
    current = id;
    dock.dataset.open = String(Boolean(id));
    panel.hidden = !id;
    for (const button of tabButtons) {
      const selected = button.dataset.tab === id;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected || (!id && button === tabButtons[0]) ? 0 : -1;
    }
    if (id) panel.setAttribute("aria-labelledby", `dock-tab-${id}`); else panel.removeAttribute("aria-labelledby");
    toggle.setAttribute("aria-expanded", String(Boolean(id)));
    labelButton(toggle, id ? text.closePanel : text.openPanel);
    renderTab();
  };
  for (const button of tabButtons) {
    button.addEventListener("click", () => setTab(current === button.dataset.tab ? undefined : button.dataset.tab as TabId));
    button.addEventListener("keydown", event => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const target = tabButtons[(tabButtons.indexOf(button) + step + tabButtons.length) % tabButtons.length]!;
      target.focus(); setTab(target.dataset.tab as TabId);
    });
  }
  toggle.addEventListener("click", () => setTab(current ? undefined : "about"));

  // Fit the canvas into the viewport at the world's aspect ratio.
  const fit = () => {
    const pad = innerWidth <= 900 && !document.fullscreenElement ? 8 : 16;
    const width = viewport.clientWidth - pad * 2, height = viewport.clientHeight - pad * 2;
    if (width <= 0 || height <= 0) return;
    const scale = Math.min(width / example.world.width, height / example.world.height);
    stage.style.width = `${Math.floor(example.world.width * scale)}px`;
    stage.style.height = `${Math.floor(example.world.height * scale)}px`;
  };
  const resize = new ResizeObserver(fit);
  resize.observe(viewport);
  fit();

  // Session lifecycle. A renderer's destroy() frees its GPU objects but keeps the context for reuse; every
  // start here uses a new canvas, so the frame lets go of the old context once its session has ended.
  // Otherwise moving between examples would pile up contexts toward the browser's limit.
  const releaseCanvas = (canvas: HTMLCanvasElement) => {
    try { canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* not a WebGL canvas */ }
  };
  interface Run { controller: AbortController; canvas: HTMLCanvasElement; settled: boolean; session?: ExampleSession }
  let active: Run | undefined, lastReport = 0;
  const stop = () => {
    const run = active; active = undefined;
    if (!run) return;
    run.controller.abort();
    // A start still in flight releases its canvas itself when it settles.
    if (run.settled) { run.session?.destroy(); releaseCanvas(run.canvas); }
  };
  async function start(): Promise<void> {
    stop();
    const canvas = el("canvas", "ex-canvas"); uiAttribute(canvas, "aria-label", text.liveView(example.title));
    const attempt: Run = { controller: new AbortController(), canvas, settled: false };
    active = attempt;
    const { signal } = attempt.controller;
    numbers = undefined;
    events = []; eventTotal = 0; eventCount.textContent = ""; startedAt = performance.now();
    if (current === "events") renderTab();
    showDisplay([]);
    const overlay = el("div", "ex-overlay");
    stage.replaceChildren(canvas, overlay);
    paused = false; showPaused(); pause.hidden = true;
    fields.replaceChildren();
    setState("loading");
    try {
      const run = await example.load();
      if (signal.aborted) { attempt.settled = true; return; }
      const started = await run({
        canvas, overlay, renderer, signal,
        controls: createControls(fields, signal),
        showScene(document, focus) {
          scene = { text: JSON.stringify(document, null, 2), ...(focus ? { focus } : {}) };
          if (current === "scene") renderScene();
        },
        display(options) {
          if (!signal.aborted) showDisplay(options);
        },
        event(entry) {
          if (!signal.aborted && example.events) pushEvent(entry);
        },
        report(next) {
          if (signal.aborted) return;
          numbers = next;
          renderStatus();
          const now = performance.now();
          if (current === "engine" && now - lastReport > 180) { lastReport = now; renderTab(); }
        },
      });
      attempt.settled = true;
      if (signal.aborted) { started.destroy(); releaseCanvas(canvas); return; }
      attempt.session = started;
      pause.hidden = !started.setPaused;
      setState("running");
    } catch (error) {
      // The example released what it made before rejecting.
      attempt.settled = true;
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) { releaseCanvas(canvas); return; }
      console.error(error);
      setState("error", error instanceof Error ? error.message : String(error));
    }
  }

  reset.addEventListener("click", () => {
    const session = active?.session;
    if (!session) return;
    // A reset starts over running.
    if (paused) { paused = false; showPaused(); session.setPaused?.(false); }
    session.reset();
  });
  pause.addEventListener("click", () => {
    const session = active?.session;
    if (!session?.setPaused) return;
    paused = !paused; showPaused();
    session.setPaused(paused);
  });
  select.addEventListener("change", () => {
    renderer = select.value as RendererChoice;
    const url = new URL(location.href);
    if (renderer === "webgl2") url.searchParams.delete("renderer"); else url.searchParams.set("renderer", renderer);
    history.replaceState(history.state, "", url);
    void start();
  });
  previous.addEventListener("click", () => options.previous && options.open(options.previous.id));
  next.addEventListener("click", () => options.next && options.open(options.next.id));
  const fullscreenChange = () => {
    const on = document.fullscreenElement === viewport;
    labelButton(fullscreen, on ? text.exitFullscreen : text.fullscreen);
    fullscreen.replaceChildren(icon(on ? "minimize" : "maximize"));
    fit();
  };
  fullscreen.addEventListener("click", () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void viewport.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener("fullscreenchange", fullscreenChange);

  void start();

  return {
    refreshLanguage() {
      renderStatus();
      if (current === "engine") renderTab();
    },
    destroy() {
      stop();
      resize.disconnect();
      document.removeEventListener("fullscreenchange", fullscreenChange);
      document.removeEventListener("pointerdown", closeMenu);
      cancelAnimationFrame(eventsQueued);
      if (document.fullscreenElement === viewport) void document.exitFullscreen();
    },
  };
}
