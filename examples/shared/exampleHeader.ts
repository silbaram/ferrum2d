import catalog from "./exampleCatalog.json";
import features from "./featureCatalog.json";
import "./exampleTheme.css";

const groups: Record<string, string> = { lab: "기능 학습", game: "게임 응용", tool: "제작 도구", reference: "참고·검증" };

/** A marked suite may resolve cross-example links under its deployment prefix. */
export function exampleSiteRoot(url: URL, path: string): URL | undefined {
  const folder = path.split("?")[0];
  const pathname = url.pathname.replace(/index\.html$/, "");
  if (!pathname.endsWith(`/${folder}`)) return;
  const root = new URL(url);
  root.pathname = pathname.slice(0, -folder.length);
  root.search = ""; root.hash = "";
  return root;
}

/** One step of the path in a detail page's top bar. `link` is relative to the suite root. */
export interface ExampleTrailItem {
  text: string;
  link?: string;
}

/** The gallery filtered to one group (`games`, `features`, `topic:<id>`, `physics`). Without
 * JavaScript the hash still jumps to that section. */
export function galleryLink(group: string): string {
  const anchor = group.startsWith("topic:") ? `topic-${group.slice(6)}` : group;
  return `?group=${encodeURIComponent(group)}#${anchor}`;
}

function suiteRoot(path: string): URL | undefined {
  // A standalone host may use the exact same folder name. Only the suite builder
  // can establish that sibling examples exist; paths alone cannot prove this.
  return document.querySelector('meta[name="ferrum-example-suite"][content="1"]')
    ? exampleSiteRoot(new URL(location.href), path) : undefined;
}

/** Presentation only: native links and a small page-owned listener; no runtime state. Detail pages
 * (labs and games) show their place as a path; their guide lives in the page itself. Reference pages
 * keep the folded "예제 안내". `trail` adds steps after the page's own place, such as the lab topic. */
export function createExampleHeader(id: string, trail: readonly ExampleTrailItem[] = []): HTMLElement {
  const entry = catalog.find(item => item.id === id);
  if (!entry) throw Error(`Unknown example: ${id}`);
  const site = suiteRoot(entry.path);
  const root = document.createElement("header");
  root.className = "example-header";
  root.dataset.exampleId = entry.id;
  const nav = document.createElement("nav"); nav.className = "example-navigation"; nav.setAttribute("aria-label", "예제 탐색");
  // Inside the published suite the brand returns to the example gallery at the site root.
  const brand = document.createElement(site ? "a" : "span"); brand.className = "example-brand"; brand.textContent = "Ferrum2D 예제";
  if (site) { (brand as HTMLAnchorElement).href = site.href; brand.dataset.exampleHome = "true"; }
  nav.append(brand);
  if (entry.kind === "reference") {
    const group = document.createElement("span"); group.className = "example-breadcrumb"; group.textContent = groups[entry.kind];
    nav.append(group);
  }
  const detail = entry.kind === "lab" || entry.kind === "game";
  if (detail) {
    // The page's place, as the gallery groups it. An app that extends a lab topic sits under that topic.
    const parent = "parent" in entry ? entry.parent : undefined;
    const steps: ExampleTrailItem[] = entry.kind === "game"
      ? [{ text: "게임 데모", link: galleryLink("games") }, { text: entry.title.split(" · ")[0] }]
      : parent
        ? [{ text: "기능 실험", link: galleryLink("features") }, { text: parent.label, link: `${parent.id}/?feature=${parent.feature}` }, { text: entry.title }]
        : [{ text: "기능 실험", link: galleryLink("features") }];
    const path = document.createElement("span"); path.className = "example-trail";
    if (parent) path.dataset.exampleParent = parent.id;
    for (const step of [...steps, ...trail]) {
      const item = document.createElement(site && step.link ? "a" : "span");
      item.textContent = step.text;
      if (site && step.link) (item as HTMLAnchorElement).href = new URL(step.link, site).href;
      path.append(item);
    }
    path.lastElementChild?.setAttribute("aria-current", "page");
    nav.append(path);
  }
  // Right side of the bar: docs (suite only), this example's source on GitHub, and the switcher.
  const links = document.createElement("div"); links.className = "example-links";
  const source = document.createElement("a");
  source.href = `https://github.com/silbaram/ferrum2d/tree/main/${entry.source.replace(/\/dist$/, "")}`;
  source.textContent = "소스"; source.target = "_blank"; source.rel = "noreferrer"; source.dataset.exampleSource = "true";
  source.setAttribute("aria-label", `${entry.title} 소스 (GitHub)`);
  if (site) {
    const docs = document.createElement("a"); docs.href = new URL("docs/", site).href; docs.textContent = "문서"; docs.dataset.exampleDocs = "true";
    const label = document.createElement("label"), select = document.createElement("select");
    label.className = "example-switcher"; label.textContent = "예제 이동 "; select.setAttribute("aria-label", "예제 이동");
    for (const kind of ["lab", "game", "tool"]) {
      const options = document.createElement("optgroup"); options.label = groups[kind];
      for (const item of catalog.filter(item => item.kind === kind)) {
        const url = new URL(item.path, site);
        const option = new Option(item.title, url.href, false, item.id === entry.id); options.append(option);
      }
      select.append(options);
    }
    if (entry.kind === "reference") select.prepend(new Option(entry.title, location.href, true, true));
    select.addEventListener("change", () => location.assign(select.value));
    label.append(select); links.append(docs, source, label);
  } else links.append(source);
  nav.append(links);
  if (detail) root.append(nav);
  else {
    const purpose = document.createElement("p"); purpose.className = "example-purpose"; purpose.textContent = entry.summary;
    const details = document.createElement("details"); details.className = "example-learning";
    const summary = document.createElement("summary"); summary.textContent = "예제 안내";
    const list = document.createElement("dl");
    for (const [title, text] of [["직접 해보기", entry.action], ["관찰할 결과", entry.observe]]) {
      const term = document.createElement("dt"), description = document.createElement("dd"); term.textContent = title; description.textContent = text; list.append(term, description);
    }
    details.append(summary, purpose, list, ...exampleLinks(entry, site));
    root.append(nav, details);
  }
  // Game input listens on Window. Keep UI key presses local; keyup still reaches
  // the engine so a game key held before focusing this header can be released.
  root.addEventListener("keydown", event => {
    const summary = event.target instanceof HTMLElement && event.target.closest("summary");
    if (summary && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      const details = summary.parentElement as HTMLDetailsElement;
      if (!event.repeat) details.open = !details.open;
    }
    event.stopPropagation();
  });
  return root;
}

type CatalogEntry = (typeof catalog)[number];

/** Related lab experiments and, when standalone, how to open the whole suite. */
function exampleLinks(entry: CatalogEntry, site: URL | undefined): HTMLElement[] {
  const parts: HTMLElement[] = [];
  const related = document.createElement("div"); related.className = "example-related";
  for (const id of entry.features) {
    const feature = features.find(item => item.id === id)!;
    // Cross-app routes on a standalone server would silently load the wrong app.
    if (!site && entry.id !== "starter-runtime") continue;
    const link = document.createElement("a"), url = site ? new URL(`starter-runtime/?feature=${id}`, site) : new URL(location.href);
    url.search = `?feature=${id}`;
    if (new URLSearchParams(location.search).get("renderer") === "webgpu") url.searchParams.set("renderer", "webgpu");
    link.href = url.href; link.textContent = feature.title; related.append(link);
  }
  if (related.childElementCount) { related.setAttribute("aria-label", "관련 기능 실험"); parts.push(related); }
  if (!site) {
    const note = document.createElement("p"); note.className = "example-standalone";
    note.append("단독 실행 중 · 예제 간 이동은 저장소에서 "); const command = document.createElement("code"); command.textContent = "pnpm preview:examples"; note.append(command, "로 실행합니다."); parts.push(note);
  }
  return parts;
}

/** What a detail page's "더 보기 › 설명" says about the whole example: its purpose, the related lab
 * experiments and, when standalone, how to open the whole suite. */
export function createExampleAbout(id: string): HTMLElement {
  const entry = catalog.find(item => item.id === id);
  if (!entry) throw Error(`Unknown example: ${id}`);
  const root = document.createElement("div"); root.className = "example-about";
  const purpose = document.createElement("p"); purpose.className = "example-purpose"; purpose.textContent = entry.summary;
  root.append(purpose);
  const links = exampleLinks(entry, suiteRoot(entry.path));
  const related = links.find(item => item.classList.contains("example-related"));
  if (related) {
    const label = document.createElement("p"); label.className = "example-about-label"; label.textContent = "관련 기능 실험";
    root.append(label);
  }
  root.append(...links);
  return root;
}
