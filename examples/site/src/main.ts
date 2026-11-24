import { examples, groups, links, tools, type GroupId, type SiteExample, type SiteLink } from "./catalog";
import { mountExample } from "./frame";
import { icon } from "./icons";
import { el, setSiteLocale, siteLocale, translate, uiAttribute, uiText, type LocalizedText } from "./locale";
import { siteText } from "./messages";
import "./tokens.css";
import "./site.css";

/** The site shell: top bar, example list, the main area and the status bar. The main area shows the
 * home page or one running example; moving between them changes the address, not the shell. */

/** Opens in a new window: other sites, and tools that are their own apps. Says so to assistive technology. */
const newWindow = (a: HTMLAnchorElement) => {
  a.target = "_blank"; a.rel = "noreferrer";
  a.append(el("span", "sr-only", siteText.newWindow));
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
uiAttribute(document.querySelector('meta[name="description"]')!, "content", siteText.description);

// Top bar: brand, where you are, search, docs and source.
const bar = el("header", "tb");
const menu = el("button", "tb-menu"); menu.type = "button";
uiAttribute(menu, "aria-label", siteText.exampleList);
menu.setAttribute("aria-controls", "site-browser"); menu.setAttribute("aria-expanded", "false");
menu.append(icon("menu"));
const brand = link("./", "brand", el("i", "brand-mark"), el("b", undefined, "FERRUM2D"), el("span", undefined, siteText.examples));
uiAttribute(brand, "aria-label", siteText.homeLink);
brand.dataset.route = "";
const crumbs = el("nav", "crumbs"); uiAttribute(crumbs, "aria-label", siteText.breadcrumbs);
const search = el("label", "search");
const query = el("input"); query.type = "search";
uiAttribute(query, "placeholder", siteText.searchPlaceholder); uiAttribute(query, "aria-label", siteText.search);
search.append(icon("search"), query, el("kbd", undefined, "/"));
const docs = docsLink("tb-link", siteText.docs);
const github = link(links.repository, "tb-link", icon("github"), el("span", undefined, "GitHub"));
uiAttribute(github, "aria-label", { ko: "GitHub (새 창)", en: "GitHub (opens in a new window)" });
const language = el("select", "tb-language");
uiAttribute(language, "aria-label", siteText.language);
for (const [value, name] of [["ko", "한국어"], ["en", "English"]]) {
  const option = new Option(name, value); option.lang = value;
  language.add(option);
}
language.value = siteLocale();
bar.append(menu, brand, crumbs, search, docs, github, language);

function docsLink(className: string, label: LocalizedText): HTMLAnchorElement {
  const a = el("a", className);
  a.append(icon("book-open"), el("span", undefined, label));
  uiAttribute(a, "href", siteText.docsHref);
  uiAttribute(a, "hreflang", { ko: "ko", en: "en" });
  uiAttribute(a, "aria-label", label);
  return a;
}

// Body: example list beside the main area.
const body = el("div", "body");
const browser = el("nav", "panel browser"); browser.id = "site-browser";
uiAttribute(browser, "aria-label", siteText.exampleList);
const browserHead = el("div", "panel-head", siteText.examples);
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
const matches = ({ item }: Entry, query: string) => !query || (["ko", "en"] as const).some(
  locale => `${item.title[locale]} ${item.summary[locale]}`.toLocaleLowerCase(locale).includes(query),
);
const exampleHref = (id: string) => `?example=${encodeURIComponent(id)}`;
/** A link inside the site: it changes the address and the main area, not the page. */
const routeLink = (a: HTMLAnchorElement) => { a.dataset.route = ""; return a; };

let selected = new URLSearchParams(location.search).get("example");
let running: ReturnType<typeof mountExample> | undefined;

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
        ? routeLink(link(exampleHref(entry.item.id), "row item-row", el("span", "t", entry.item.title)))
        : toolLink(entry.item, "row item-row", el("span", "t", entry.item.title), icon("external-link", "i ext"));
      uiAttribute(a, "title", entry.item.summary);
      if (entry.kind === "example" && entry.item.id === selected) a.setAttribute("aria-current", "page");
      item.append(a); list.append(item);
    }
    if (!items.length) list.append(el("li", "row empty-row", siteText.comingSoon));
    section.append(head, list);
    tree.append(section);
  }
  if (!tree.childElementCount) tree.append(el("p", "tree-empty", siteText.noMatches));
}

function setCrumbs(items: readonly { text: string | LocalizedText; href?: string }[]): void {
  crumbs.replaceChildren();
  items.forEach((item, index) => {
    if (index) crumbs.append(icon("chevron-right"));
    const node = item.href
      ? routeLink(link(item.href, "crumb", typeof item.text === "string" ? item.text : uiText(item.text)))
      : el("span", "crumb", item.text);
    if (index === items.length - 1) node.setAttribute("aria-current", "page");
    crumbs.append(node);
  });
}

function card(entry: Entry): HTMLElement {
  const thumb = entry.item.thumbnail
    ? Object.assign(el("img"), { src: entry.item.thumbnail, alt: "", loading: "lazy", decoding: "async" })
    : el("span", "card-code");
  if (thumb.classList.contains("card-code")) {
    const group = groups.find(item => item.id === groupOf(entry))!;
    thumb.append(icon(entry.kind === "example" ? group.icon : "file-code", "i card-code-icon"));
  }
  const text = el("span", "card-text");
  text.append(el("b", undefined, entry.item.title), el("span", undefined, entry.item.summary));
  if (entry.kind === "example") return routeLink(link(exampleHref(entry.item.id), "card", thumb, text));
  return toolLink(entry.item, "card", thumb, text, icon("external-link", "i card-ext"));
}

function renderHome(text: string): void {
  // The brand already names this page; the path starts below it.
  setCrumbs([]);
  const page = el("div", "home");
  const head = el("header", "home-head");
  const title = el("div");
  title.append(el("h1", undefined, siteText.title), el("p", undefined, siteText.homeIntro));
  head.append(title);
  page.append(head);
  if (examples.length && !text) {
    // Examples arrive one at a time; say so once, quietly.
    const note = el("p", "home-note");
    const sentence = el("span");
    sentence.append(uiText(siteText.progress(examples.length)),
      link(links.previousExamples, "inline-link", "GitHub"), uiText(siteText.progressEnd));
    note.append(icon("construction"), sentence);
    page.append(note);
  }
  const shown = entries.filter(entry => matches(entry, text));
  for (const group of groups) {
    const items = shown.filter(entry => groupOf(entry) === group.id);
    if (group.id !== "tools" && !examples.length) continue;
    if (!items.length) continue;
    const section = el("section", "home-group");
    const h2 = el("h2"); h2.append(icon(group.icon), uiText(group.title));
    const grid = el("div", "cards"); grid.append(...items.map(card));
    section.append(h2, grid);
    page.append(section);
  }
  if (!examples.length && !text) {
    // Until the first example lands, say so and point to what already works.
    const empty = el("section", "empty");
    empty.setAttribute("aria-labelledby", "empty-title");
    const h2 = el("h2", undefined, siteText.emptyTitle); h2.id = "empty-title";
    const p = el("p", undefined, siteText.emptyIntro);
    const actions = el("div", "empty-actions");
    actions.append(
      docsLink("btn primary", siteText.openDocs),
      toolLink(tools[0], "btn", icon("wrench"), uiText(siteText.openStudio)),
      link(links.previousExamples, "btn", icon("github"), uiText(siteText.previousCode)),
    );
    empty.append(icon("construction", "i empty-icon"), h2, p, actions);
    page.insertBefore(empty, page.children[1] ?? null);
  }
  if (text && !shown.length) page.append(el("p", "home-none", siteText.noMatches));
  main.replaceChildren(page);
}

function renderMissing(id: string): void {
  setCrumbs([{ text: siteText.examples, href: "./" }, { text: id }]);
  const page = el("div", "missing");
  const h1 = el("h1", undefined, siteText.missingTitle);
  const p = el("p"); p.append(el("code", undefined, id), uiText(siteText.missingDetail));
  page.append(h1, p, routeLink(link("./", "btn", uiText(siteText.backHome))));
  main.replaceChildren(page);
}

function renderExample(example: SiteExample): void {
  const group = groups.find(item => item.id === example.group)!;
  setCrumbs([{ text: siteText.examples, href: "./" }, { text: group.title }, { text: example.title }]);
  const index = examples.indexOf(example);
  running = mountExample(main, { example, previous: examples[index - 1], next: examples[index + 1], status, open: id => navigate(exampleHref(id)) });
}

function renderStatus(): void {
  // An example writes its own engine numbers here while it is on screen.
  if (app.dataset.view === "example") return;
  status.replaceChildren(
    el("span", undefined, siteText.exampleCount(examples.length)),
    el("span", undefined, siteText.groupCount(groups.length - 1, tools.length)),
    el("span", "sb-right", siteText.build),
  );
}

const searchText = () => query.value.trim().toLowerCase();
const selectedExample = () => examples.find(item => item.id === selected);
function renderTitle(example: SiteExample | undefined): void {
  const title = translate(siteText.title);
  document.title = example ? `${translate(example.title)} · ${title}` : title;
}

/** Shows what the address names. The running example stops before anything else takes the main area. */
function route(): void {
  running?.destroy(); running = undefined;
  selected = new URLSearchParams(location.search).get("example");
  const example = selectedExample();
  renderTitle(example);
  app.dataset.view = example ? "example" : "page";
  renderTree(searchText());
  renderStatus();
  if (example) renderExample(example);
  else if (selected) renderMissing(selected);
  else renderHome(searchText());
}
function navigate(href: string): void {
  const url = new URL(href, location.href);
  if (url.href !== location.href) history.pushState(null, "", url);
  route();
  main.scrollTop = 0;
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
query.addEventListener("input", () => {
  renderTree(searchText());
  if (!selected) renderHome(searchText());
});
// Links inside the site move without reloading the page; other links and modified clicks behave as usual.
document.addEventListener("click", event => {
  const a = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[data-route]") : null;
  if (!a || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (app.dataset.drawer === "open") setDrawer(false);
  navigate(a.href);
});
addEventListener("popstate", route);
language.addEventListener("change", () => {
  const next = language.value;
  if (next !== "en" && next !== "ko") return;
  setSiteLocale(next);
  renderTitle(selectedExample());
  running?.refreshLanguage();
});

setDrawer(false);
route();
// Fixed-width text lists system fonts before the bundled Korean font, so Hangul drawn before that font
// arrives can keep a fallback. Load it for that text and draw the status bar again.
void document.fonts?.load('11px "Ferrum Example UI"', "예제").then(renderStatus, () => {});
