import { examples, groups, links, tools, type GroupId, type SiteExample, type SiteLink } from "./catalog";
import { icon } from "./icons";
import "./tokens.css";
import "./site.css";

/** The site shell: top bar, example list, the main area and the status bar. Examples run inside the
 * main area and are added one at a time; until then the main area shows the home page. */

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
/** Opens in a new window: other sites, and tools that are their own apps. Says so to assistive technology. */
const newWindow = (a: HTMLAnchorElement) => {
  a.target = "_blank"; a.rel = "noreferrer";
  a.append(el("span", "sr-only", " (새 창)"));
  return a;
};
const link = (href: string, className: string, ...content: (Node | string)[]) => {
  const a = el("a", className); a.href = href; a.append(...content);
  if (/^https?:/.test(href)) newWindow(a);
  return a;
};
const toolLink = (tool: SiteLink, className: string, ...content: (Node | string)[]) => {
  const a = el("a", className); a.href = tool.href; a.append(...content);
  return newWindow(a);
};

const app = document.querySelector<HTMLElement>("#app")!;
app.className = "app";

// Top bar: brand, where you are, search, docs and source.
const bar = el("header", "tb");
const menu = el("button", "tb-menu"); menu.type = "button";
menu.setAttribute("aria-label", "예제 목록"); menu.setAttribute("aria-controls", "site-browser"); menu.setAttribute("aria-expanded", "false");
menu.append(icon("menu"));
const brand = link("./", "brand", el("i", "brand-mark"), "FERRUM2D", el("span", undefined, "예제"));
brand.setAttribute("aria-label", "Ferrum2D 예제 첫 화면");
const crumbs = el("nav", "crumbs"); crumbs.setAttribute("aria-label", "현재 위치");
const search = el("label", "search");
const query = el("input"); query.type = "search"; query.placeholder = "예제 검색"; query.setAttribute("aria-label", "예제 검색");
search.append(icon("search"), query, el("kbd", undefined, "/"));
const docs = link(links.docs, "tb-link", icon("book-open"), el("span", undefined, "문서"));
const github = link(links.repository, "tb-link", icon("github"), el("span", undefined, "GitHub"));
bar.append(menu, brand, crumbs, search, docs, github);

// Body: example list beside the main area.
const body = el("div", "body");
const browser = el("nav", "panel browser"); browser.id = "site-browser"; browser.setAttribute("aria-label", "예제 목록");
const browserHead = el("div", "panel-head", "예제");
const browserCount = el("span", "count", String(examples.length));
browserHead.append(browserCount);
const tree = el("div", "tree");
browser.append(browserHead, tree);
const main = el("main", "main"); main.id = "site-main"; main.tabIndex = -1;
const scrim = el("div", "scrim"); scrim.hidden = true;
body.append(browser, main, scrim);

// Status bar.
const status = el("footer", "sb");

app.append(bar, body, status);

type Entry = { kind: "example"; item: SiteExample } | { kind: "tool"; item: SiteLink };
const entries: Entry[] = [...examples.map(item => ({ kind: "example" as const, item })), ...tools.map(item => ({ kind: "tool" as const, item }))];
const groupOf = (entry: Entry): GroupId => entry.kind === "tool" ? "tools" : entry.item.group;
const matches = (entry: Entry, text: string) => !text || `${entry.item.title} ${entry.item.summary}`.toLocaleLowerCase("ko").includes(text);
const exampleHref = (id: string) => `?example=${encodeURIComponent(id)}`;

const selected = new URLSearchParams(location.search).get("example");

function renderTree(text: string): void {
  tree.replaceChildren();
  for (const group of groups) {
    const items = entries.filter(entry => groupOf(entry) === group.id);
    const shown = items.filter(entry => matches(entry, text));
    if (text && !shown.length) continue;
    const section = el("section", "group");
    const head = el("button", "row group-row"); head.type = "button";
    const list = el("ul", "group-items"); list.id = `group-${group.id}`;
    head.setAttribute("aria-expanded", "true"); head.setAttribute("aria-controls", list.id);
    head.append(icon("chevron-down", "i chev"), icon(group.icon), el("span", "t", group.title), el("span", "n", String(items.length)));
    head.addEventListener("click", () => {
      const open = head.getAttribute("aria-expanded") !== "true";
      head.setAttribute("aria-expanded", String(open)); list.hidden = !open;
    });
    for (const entry of shown) {
      const item = el("li");
      const a = entry.kind === "example"
        ? link(exampleHref(entry.item.id), "row item-row", el("span", "t", entry.item.title))
        : toolLink(entry.item, "row item-row", el("span", "t", entry.item.title), icon("external-link", "i ext"));
      a.title = entry.item.summary;
      if (entry.kind === "example" && entry.item.id === selected) a.setAttribute("aria-current", "page");
      item.append(a); list.append(item);
    }
    if (!items.length) list.append(el("li", "row empty-row", "준비 중"));
    section.append(head, list);
    tree.append(section);
  }
  if (!tree.childElementCount) tree.append(el("p", "tree-empty", "찾는 예제가 없습니다."));
}

function setCrumbs(items: readonly { text: string; href?: string }[]): void {
  crumbs.replaceChildren();
  items.forEach((item, index) => {
    if (index) crumbs.append(icon("chevron-right"));
    const node = item.href ? link(item.href, "crumb", item.text) : el("span", "crumb", item.text);
    if (index === items.length - 1) node.setAttribute("aria-current", "page");
    crumbs.append(node);
  });
}

function card(entry: Entry): HTMLElement {
  const thumb = entry.kind === "tool" && entry.item.thumbnail
    ? Object.assign(el("img"), { src: entry.item.thumbnail, alt: "", loading: "lazy", decoding: "async" })
    : el("span", "card-code");
  if (thumb.classList.contains("card-code")) thumb.append(icon("file-code", "i card-code-icon"));
  const text = el("span", "card-text");
  text.append(el("b", undefined, entry.item.title), el("span", undefined, entry.item.summary));
  if (entry.kind === "example") return link(exampleHref(entry.item.id), "card", thumb, text);
  return toolLink(entry.item, "card", thumb, text, icon("external-link", "i card-ext"));
}

function renderHome(text: string): void {
  // The brand already names this page; the path starts below it.
  setCrumbs([]);
  const page = el("div", "home");
  const head = el("header", "home-head");
  const title = el("div");
  title.append(el("h1", undefined, "Ferrum2D 예제"), el("p", undefined, "엔진 기능을 하나씩 바꿔 보는 실험과 게임 데모를 이 화면에서 실행합니다."));
  head.append(title);
  page.append(head);
  const shown = entries.filter(entry => matches(entry, text));
  for (const group of groups) {
    const items = shown.filter(entry => groupOf(entry) === group.id);
    if (group.id !== "tools" && !examples.length) continue;
    if (!items.length) continue;
    const section = el("section", "home-group");
    const h2 = el("h2"); h2.append(icon(group.icon), group.title);
    const grid = el("div", "cards"); grid.append(...items.map(card));
    section.append(h2, grid);
    page.append(section);
  }
  if (!examples.length && !text) {
    // Until the first example lands, say so and point to what already works.
    const empty = el("section", "empty");
    empty.setAttribute("aria-labelledby", "empty-title");
    const h2 = el("h2", undefined, "예제를 하나씩 다시 만들고 있습니다."); h2.id = "empty-title";
    const p = el("p", undefined, "새 화면에 맞춰 예제를 차례로 추가합니다. 엔진 문서와 Studio는 지금 열 수 있고, 이전 예제 코드는 GitHub에 남아 있습니다.");
    const actions = el("div", "empty-actions");
    actions.append(
      link(links.docs, "btn primary", icon("book-open"), "문서 열기"),
      toolLink(tools[0], "btn", icon("wrench"), "Studio 열기"),
      link(links.previousExamples, "btn", icon("github"), "이전 예제 코드"),
    );
    empty.append(icon("construction", "i empty-icon"), h2, p, actions);
    page.insertBefore(empty, page.children[1] ?? null);
  }
  if (text && !shown.length) page.append(el("p", "home-none", "찾는 예제가 없습니다."));
  main.replaceChildren(page);
}

function renderMissing(id: string): void {
  setCrumbs([{ text: "예제", href: "./" }, { text: id }]);
  const page = el("div", "missing");
  const h1 = el("h1", undefined, "예제를 찾을 수 없습니다.");
  const p = el("p"); p.append(el("code", undefined, id), " 예제는 아직 없거나 이름이 바뀌었습니다.");
  page.append(h1, p, link("./", "btn", "첫 화면으로"));
  main.replaceChildren(page);
}

function renderStatus(): void {
  const count = (group: GroupId) => examples.filter(item => item.group === group).length;
  status.replaceChildren(
    el("span", undefined, `예제 ${examples.length}`),
    el("span", undefined, `게임 ${count("games")} · 기능 ${count("features")} · 물리 ${count("physics")} · 도구 ${tools.length}`),
    el("span", "sb-right", "Ferrum2D 개발 소스"),
  );
}

function render(): void {
  const text = query.value.trim().toLocaleLowerCase("ko");
  renderTree(text);
  if (selected && !examples.some(item => item.id === selected)) renderMissing(selected);
  else renderHome(text);
}

// Narrow screens: the list is a drawer.
const setDrawer = (open: boolean) => {
  app.dataset.drawer = open ? "open" : "closed";
  menu.setAttribute("aria-expanded", String(open));
  scrim.hidden = !open;
  if (open) browser.querySelector<HTMLElement>("a, button")?.focus();
};
menu.addEventListener("click", () => setDrawer(app.dataset.drawer !== "open"));
scrim.addEventListener("click", () => setDrawer(false));
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && app.dataset.drawer === "open") { setDrawer(false); menu.focus(); }
  const typing = event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable=true]");
  if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); query.focus(); }
});
query.addEventListener("input", render);

setDrawer(false);
renderStatus();
render();
