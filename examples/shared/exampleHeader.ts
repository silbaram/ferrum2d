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

/** Presentation only: native links and a small page-owned listener; no runtime state. */
export function createExampleHeader(id: string): HTMLElement {
  const entry = catalog.find(item => item.id === id);
  if (!entry) throw Error(`Unknown example: ${id}`);
  // A standalone host may use the exact same folder name. Only the suite builder
  // can establish that sibling examples exist; paths alone cannot prove this.
  const site = document.querySelector('meta[name="ferrum-example-suite"][content="1"]')
    ? exampleSiteRoot(new URL(location.href), entry.path) : undefined;
  const root = document.createElement("header");
  root.className = "example-header";
  root.dataset.exampleId = entry.id;
  const nav = document.createElement("nav"); nav.className = "example-navigation"; nav.setAttribute("aria-label", "예제 탐색");
  const brand = document.createElement("span"); brand.className = "example-brand"; brand.textContent = "Ferrum2D 예제";
  const group = document.createElement("span"); group.className = "example-breadcrumb"; group.textContent = groups[entry.kind];
  nav.append(brand, group);
  if (site) {
    const home = document.createElement("a"); home.href = site.href; home.textContent = "전체 예제"; home.dataset.exampleHome = "true";
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
    label.append(select); nav.append(home, label);
  }
  const purpose = document.createElement("p"); purpose.className = "example-purpose"; purpose.textContent = entry.summary;
  const details = document.createElement("details"); details.className = "example-learning";
  const summary = document.createElement("summary"); summary.textContent = "이 예제에서 배우는 것";
  const list = document.createElement("dl");
  for (const [title, text] of [["직접 해보기", entry.action], ["관찰할 결과", entry.observe]]) {
    const term = document.createElement("dt"), description = document.createElement("dd"); term.textContent = title; description.textContent = text; list.append(term, description);
  }
  details.append(summary, list);
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
  if (related.childElementCount) { related.setAttribute("aria-label", "관련 기능 실험"); details.append(related); }
  if (!site) {
    const note = document.createElement("p"); note.className = "example-standalone";
    note.append("단독 실행 중 · 전체 예제 탐색은 저장소에서 "); const command = document.createElement("code"); command.textContent = "pnpm preview:examples"; note.append(command, "로 실행합니다."); details.append(note);
  }
  root.append(nav, purpose, details);
  // Game input listens on Window. Keep UI key presses local; keyup still reaches
  // the engine so a game key held before focusing this header can be released.
  root.addEventListener("keydown", event => {
    if (event.target === summary && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      if (!event.repeat) details.open = !details.open;
    }
    event.stopPropagation();
  });
  return root;
}
