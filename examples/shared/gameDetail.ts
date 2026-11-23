import catalog from "./exampleCatalog.json";
import { exampleSiteRoot } from "./exampleHeader";
import { createExampleCode, exampleDocsUrl, type ExampleCodeData } from "./exampleCode";
import "./exampleDetail.css";

// Gallery thumbnails are bundled so a standalone game shows the same picture.
const thumbnails = import.meta.glob<string>("./thumbnails/game-*.jpg", { eager: true, query: "?url", import: "default" });
const games = catalog.filter(item => item.kind === "game");

/** One thing to try in a game. Actions use the running game's public API only. */
export interface GameTopic {
  id: string;
  title: string;
  action: string;
  observe: string;
  /** Moves the game to where this topic is easiest to see. */
  start?: () => void;
}

export interface GameDetailOptions {
  /** Example catalog id of the game. */
  id: string;
  topics: readonly GameTopic[];
  /** Game canvas that keyboard input needs; page controls hand focus back to it on pointer use. */
  canvas?: HTMLCanvasElement;
  /** Offer the reload link that toggles collision outlines. */
  physicsDebugLink?: boolean;
  code: { data?: ExampleCodeData; api: string; sources: readonly string[] };
}

export interface GameDetail {
  /** Catalog title, `<game> · <what it teaches>`, used for the page heading. */
  title: string;
  /** Game list with this game's topics on wide screens; a topic picker on narrow ones. */
  sidebar: HTMLElement;
  /** Topic line over the stage. */
  intro: HTMLElement;
  /** How to try the selected topic, at the top of the panel. */
  guide: HTMLElement;
  code: HTMLElement;
  /** Previous and next game; only inside the published suite, where the other games exist. */
  pager: HTMLElement | undefined;
  destroy(): void;
}

/** Page-owned detail frame for a game demo. It never touches the simulation beyond `topic.start`. */
export function createGameDetail(options: GameDetailOptions): GameDetail {
  const lifetime = new AbortController(), { signal } = lifetime;
  const entry = games.find(item => item.id === options.id);
  if (!entry) throw Error(`Unknown game example: ${options.id}`);
  const site = document.querySelector('meta[name="ferrum-example-suite"][content="1"]')
    ? exampleSiteRoot(new URL(location.href), entry.path) : undefined;
  const { topics } = options;
  const topicUrl = (id: string): URL => { const url = new URL(location.href); url.searchParams.set("topic", id); url.hash = ""; return url; };

  if (options.canvas) {
    // InputManager suppresses the pointer's default focus action. Restore game focus
    // explicitly after using the page controls so keyboard movement can resume.
    const { canvas } = options;
    canvas.tabIndex = 0;
    if (!canvas.hasAttribute("aria-label")) canvas.setAttribute("aria-label", "게임 실험 화면");
    canvas.addEventListener("pointerdown", event => {
      if (event.button === 0 || event.pointerType === "touch") canvas.focus({ preventScroll: true });
    }, { signal });
  }

  // Sidebar: every game inside the suite (only this one when standalone) and this game's topics.
  const sidebar = document.createElement("nav");
  sidebar.className = "example-sidebar"; sidebar.setAttribute("aria-label", "게임 데모와 체험할 기능");
  const label = document.createElement("p"); label.className = "example-sidebar-label";
  const listed = site ? games : [entry];
  const count = document.createElement("span"); count.textContent = String(listed.length);
  label.append("게임 데모 ", count);
  const list = document.createElement("div"); list.className = "example-sidebar-list";
  const topicLinks: HTMLAnchorElement[] = [];
  for (const game of listed) {
    const [name, learn] = game.title.split(" · ");
    const a = document.createElement("a"); a.className = "example-item example-item-parent"; a.dataset.example = game.id;
    a.href = site ? new URL(game.path, site).href : new URL("./", location.href).href;
    const image = document.createElement("img"); image.alt = ""; image.decoding = "async";
    const src = thumbnails[`./thumbnails/game-${game.id}.jpg`]; if (src) image.src = src;
    const title = document.createElement("span"); title.className = "example-item-title"; title.textContent = name;
    const note = document.createElement("span"); note.className = "example-item-note"; note.textContent = learn ?? "";
    a.append(image, title, note);
    list.append(a);
    if (game.id !== entry.id) continue;
    a.setAttribute("aria-current", "page");
    const group = document.createElement("div"); group.className = "example-subitems";
    group.setAttribute("role", "group"); group.setAttribute("aria-label", `${name}에서 체험할 기능`);
    for (const topic of topics) {
      const link = document.createElement("a"); link.className = "example-subitem"; link.dataset.topic = topic.id;
      link.href = topicUrl(topic.id).href; link.textContent = topic.title;
      // Links keep a real ?topic= URL; a plain click switches the topic in place.
      link.addEventListener("click", event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        select(topics.indexOf(topic), true);
      }, { signal });
      topicLinks.push(link); group.append(link);
    }
    list.append(group);
  }
  const picker = document.createElement("label"), choice = document.createElement("select");
  picker.className = "example-picker"; picker.textContent = "체험할 기능 ";
  choice.setAttribute("aria-label", "체험할 기능");
  topics.forEach(topic => choice.add(new Option(topic.title, topic.id)));
  choice.addEventListener("change", () => select(choice.selectedIndex, true), { signal });
  picker.append(choice);
  sidebar.append(label, list, picker);

  // Topic line over the stage.
  const intro = document.createElement("div"); intro.className = "example-intro";
  const step = document.createElement("span"), heading = document.createElement("h2");
  intro.append(step, heading);

  // Guide card at the top of the panel.
  const guide = document.createElement("section");
  guide.className = "example-guide"; guide.setAttribute("aria-label", "체험 방법");
  const guideTitle = document.createElement("h2"); guideTitle.textContent = "체험 방법";
  const action = document.createElement("p"), observe = document.createElement("p");
  const actions = document.createElement("div"); actions.className = "example-guide-actions";
  const start = document.createElement("button"); start.type = "button"; start.textContent = "이 위치에서 실험";
  start.addEventListener("click", () => topics[current].start?.(), { signal });
  actions.append(start);
  const debugEnabled = new URLSearchParams(location.search).get("physicsDebugLines") === "true";
  const debug = document.createElement("a");
  debug.textContent = debugEnabled ? "충돌 영역 끄고 다시 시작" : "충돌 영역 켜고 다시 시작";
  if (options.physicsDebugLink !== false) actions.append(debug);
  guide.append(guideTitle, action, observe, actions);

  let current = Math.max(0, topics.findIndex(topic => topic.id === new URLSearchParams(location.search).get("topic")));
  function select(index: number, fromUser = false): void {
    current = index;
    const topic = topics[index];
    topicLinks.forEach((link, i) => { if (i === index) link.setAttribute("aria-current", "true"); else link.removeAttribute("aria-current"); });
    choice.selectedIndex = index;
    step.textContent = `체험할 기능 · ${index + 1} / ${topics.length}`;
    heading.textContent = topic.title;
    for (const [element, title, text] of [[action, "조작", topic.action], [observe, "관찰", topic.observe]] as const) {
      const strong = document.createElement("strong"); strong.textContent = title;
      element.replaceChildren(strong, text);
    }
    start.hidden = !topic.start;
    if (fromUser) history.replaceState(history.state, "", topicUrl(topic.id));
    const reload = new URL(location.href); reload.searchParams.set("physicsDebugLines", String(!debugEnabled));
    debug.href = reload.href;
  }
  select(current);

  const code = createExampleCode({
    ...options.code,
    apiNote: "이 게임이 쓰는 공개 API입니다. 인자와 반환값은 API 문서에서 확인하세요.",
    sourcesNote: options.code.data ? "게임을 구성하는 예제 코드와, 처음 불러오는 데이터 파일입니다." : "게임을 구성하는 예제 코드입니다.",
    docsUrl: exampleDocsUrl(entry.path),
  });

  let pager: HTMLElement | undefined;
  if (site) {
    pager = document.createElement("nav"); pager.className = "example-pager"; pager.setAttribute("aria-label", "이전·다음 게임");
    const index = games.indexOf(entry);
    for (const [rel, game, caption] of [["prev", games[index - 1], "이전 게임"], ["next", games[index + 1], "다음 게임"]] as const) {
      if (!game) { pager.append(document.createElement("span")); continue; }
      const a = document.createElement("a"); a.href = new URL(game.path, site).href; a.rel = rel; a.className = `example-pager-${rel}`;
      const small = document.createElement("small"); small.textContent = caption;
      const title = document.createElement("span"); title.textContent = game.title;
      a.append(small, title); pager.append(a);
    }
  }
  return { title: entry.title, sidebar, intro, guide, code: code.element, pager, destroy: () => { lifetime.abort(); code.destroy(); } };
}

export interface GameDetailParts {
  root: HTMLElement;
  heading: HTMLElement;
  layout: HTMLElement;
  stage: HTMLElement;
  panel: HTMLElement;
}

/** Place the frame around a game page: list first in the layout, topic line over the stage,
 * guide at the top of the panel, and the code view and pager after the layout. */
export function mountGameDetail(detail: GameDetail, parts: GameDetailParts): void {
  parts.root.classList.add("example-detail", "example-game");
  parts.heading.textContent = detail.title;
  parts.layout.prepend(detail.sidebar);
  parts.stage.prepend(detail.intro);
  parts.panel.classList.add("example-panel");
  parts.panel.prepend(detail.guide);
  parts.layout.after(detail.code);
  if (detail.pager) detail.code.after(detail.pager);
}

/** runtimeDemoShell pages: the panel wraps the shell's metrics list unless the page brings its own. */
export function mountShellGameDetail(detail: GameDetail, stage: HTMLElement, panel?: HTMLElement): void {
  const root = stage.closest<HTMLElement>(".demo-shell")!;
  const layout = root.querySelector<HTMLElement>(".demo-stage-layout")!;
  if (!panel) {
    const metrics = layout.querySelector(".demo-metrics")!;
    panel = document.createElement("aside");
    panel.setAttribute("aria-label", "체험 방법과 실행 상태");
    metrics.replaceWith(panel);
    panel.append(metrics);
  }
  mountGameDetail(detail, { root, heading: root.querySelector<HTMLElement>(".demo-toolbar h1")!, layout, stage, panel });
}
