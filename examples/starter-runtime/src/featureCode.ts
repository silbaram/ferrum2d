import lucide from "../../shared/gallery/lucideIcons.json";
import { exampleSiteRoot } from "../../shared/exampleHeader";

const REPOSITORY = "https://github.com/silbaram/ferrum2d/blob/main/";
const LAB_DIR = "examples/starter-runtime/";
const icons: Record<string, string> = lucide.icons;

export interface FeatureCodeOptions {
  id: string;
  /** Public API names separated by `·`, as written in the feature catalog. */
  api: string;
  /** Lab source files that apply this experiment's settings, relative to the lab package. */
  sources: readonly string[];
  /** Public API reference: the suite's docs page, or the repository file when standalone. */
  docsUrl: string;
}

/** The public API reference inside the published suite, or the repository file when standalone. */
export function featureDocsUrl(): string {
  const site = document.querySelector('meta[name="ferrum-example-suite"][content="1"]')
    ? exampleSiteRoot(new URL(location.href), "starter-runtime/") : undefined;
  return site ? new URL("docs/engine/public-api.html", site).href : `${REPOSITORY}docs/engine/public-api.md`;
}

function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ class: "feature-icon", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": "1.75", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(key, value);
  svg.innerHTML = icons[name] ?? "";
  return svg;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function externalLink(href: string, label: string, iconName = "external-link"): HTMLAnchorElement {
  const a = element("a", "feature-code-button"); a.href = href; a.target = "_blank"; a.rel = "noreferrer";
  a.append(icon(iconName), label);
  return a;
}

/** Pretty JSON that keeps any value fitting the line width on one line and wraps long arrays
 * of plain values (grids, costs, frames), so tile-heavy scenes stay readable. */
export function formatSceneJson(value: unknown, width = 96): string {
  const inline = (node: unknown): string => {
    if (node === null || typeof node !== "object") return JSON.stringify(node);
    if (Array.isArray(node)) return `[${node.map(inline).join(", ")}]`;
    const entries = Object.entries(node);
    return entries.length ? `{ ${entries.map(([key, item]) => `${JSON.stringify(key)}: ${inline(item)}`).join(", ")} }` : "{}";
  };
  // `lead` is the width already used on this line by the indent and an object key.
  const write = (node: unknown, indent: string, lead: number): string => {
    if (node === null || typeof node !== "object") return JSON.stringify(node);
    const single = inline(node);
    if (lead + single.length <= width) return single;
    const inner = `${indent}  `;
    if (Array.isArray(node)) {
      if (node.every(item => item === null || typeof item !== "object")) {
        const lines: string[] = [];
        let line = "";
        for (const part of node.map(item => JSON.stringify(item))) {
          const next = line ? `${line}, ${part}` : part;
          if (line && inner.length + next.length + 1 > width) { lines.push(`${line},`); line = part; } else line = next;
        }
        lines.push(line);
        return `[\n${lines.map(text => inner + text).join("\n")}\n${indent}]`;
      }
      return `[\n${node.map(item => inner + write(item, inner, inner.length)).join(",\n")}\n${indent}]`;
    }
    return `{\n${Object.entries(node).map(([key, item]) => {
      const prefix = `${inner}${JSON.stringify(key)}: `;
      return prefix + write(item, inner, prefix.length);
    }).join(",\n")}\n${indent}}`;
  };
  return write(value, "", 0);
}

/** Colorize one pretty-printed JSON line: keys, strings, numbers and literals. */
function highlightLine(line: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const pattern = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    fragment.append(line.slice(last, match.index));
    const [text, string, colon, number, literal] = match;
    const kind = string ? (colon ? "key" : "string") : number ? "number" : literal ? "literal" : "";
    const span = element("span", `json-${kind}`, string ?? text);
    fragment.append(span);
    if (string && colon) fragment.append(colon);
    last = match.index! + text.length;
  }
  fragment.append(line.slice(last));
  return fragment;
}

/** Code view under the stage: the experiment's scene file, its public API and the lab sources. */
export function createFeatureCode(options: FeatureCodeOptions): { element: HTMLElement; destroy(): void } {
  const lifetime = new AbortController(), { signal } = lifetime;
  const root = element("section", "feature-code"); root.setAttribute("aria-labelledby", "feature-code-title");
  const head = element("div", "feature-code-head");
  const title = element("h2", undefined, "코드 보기"); title.id = "feature-code-title";
  const tablist = element("div", "feature-code-tabs"); tablist.setAttribute("role", "tablist"); tablist.setAttribute("aria-label", "코드 보기");
  head.append(title, tablist);
  root.append(head);

  const scenePath = `${LAB_DIR}public/features/${options.id}.json`;
  const sceneUrl = `./features/${options.id}.json`;
  const panels: { tab: HTMLButtonElement; panel: HTMLElement; open?: () => void }[] = [];
  const addTab = (key: string, label: string, panel: HTMLElement, open?: () => void) => {
    const tab = element("button", "feature-code-tab", label); tab.type = "button";
    tab.id = `feature-code-tab-${key}`; tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", `feature-code-${key}`);
    panel.id = `feature-code-${key}`; panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", tab.id);
    panel.className = "feature-code-panel"; panel.tabIndex = 0;
    tablist.append(tab); root.append(panel);
    panels.push({ tab, panel, open });
  };
  const select = (index: number, focus = false) => {
    panels.forEach((entry, i) => {
      const selected = i === index;
      entry.tab.setAttribute("aria-selected", String(selected));
      entry.tab.tabIndex = selected ? 0 : -1;
      entry.panel.hidden = !selected;
    });
    panels[index].open?.();
    if (focus) panels[index].tab.focus();
  };

  // Scene JSON: the file this experiment loads, fetched when the tab opens.
  const scene = element("div");
  const sceneBar = element("div", "feature-code-bar");
  const sceneFile = element("code", "feature-code-path", scenePath);
  const sceneLines = element("span", "feature-code-lines", "불러오는 중…");
  const copy = element("button", "feature-code-button"); copy.type = "button"; copy.append(icon("copy"), "복사");
  const download = element("a", "feature-code-button"); download.href = sceneUrl; download.download = `${options.id}.json`;
  download.append(icon("download"), "내려받기");
  sceneBar.append(sceneFile, sceneLines, copy, download, externalLink(`${REPOSITORY}${scenePath}`, "GitHub", "github"));
  const pre = element("pre", "feature-code-json"); const code = element("code"); pre.append(code);
  const status = element("p", "feature-code-status"); status.setAttribute("role", "status");
  scene.append(sceneBar, pre, status);
  let sceneText: string | undefined, loading: Promise<void> | undefined;
  const loadScene = () => {
    loading ??= fetch(sceneUrl, { signal }).then(response => {
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      return response.text();
    }).then(text => {
      // Copy keeps the exact file; the view packs plain-value arrays to stay readable.
      sceneText = text;
      const lines = formatSceneJson(JSON.parse(text)).split("\n");
      sceneLines.textContent = `${lines.length}줄`;
      const fragment = document.createDocumentFragment();
      lines.forEach((line, index) => {
        const row = element("span", "json-line"); row.append(highlightLine(line));
        fragment.append(row, index < lines.length - 1 ? "\n" : "");
      });
      code.replaceChildren(fragment);
      root.dataset.sceneLines = String(lines.length);
    }).catch(error => {
      if (signal.aborted) return;
      sceneLines.textContent = "";
      status.textContent = `씬 파일을 불러오지 못했습니다. ${error instanceof Error ? error.message : String(error)}`;
    });
  };
  copy.addEventListener("click", () => {
    if (!sceneText) return;
    navigator.clipboard.writeText(sceneText)
      .then(() => { status.textContent = "씬 JSON을 복사했습니다."; })
      .catch(() => { status.textContent = "복사하지 못했습니다. 내려받기를 사용하세요."; });
  }, { signal });
  addTab("scene", "씬 JSON", scene, loadScene);

  // Public API used by this experiment, with the reference page.
  const api = element("div");
  api.append(element("p", "feature-code-note", "이 실험이 쓰는 공개 API입니다. 인자와 반환값은 API 문서에서 확인하세요."));
  const names = element("ul", "feature-code-api");
  for (const name of options.api.split("·").map(text => text.trim()).filter(Boolean)) {
    const item = element("li"); item.append(element("code", undefined, name)); names.append(item);
  }
  api.append(names, externalLink(options.docsUrl, "공개 API 문서", "book-open"));
  addTab("api", "API", api);

  // Lab sources that apply the controls, and the scene file they edit.
  const sources = element("div");
  sources.append(element("p", "feature-code-note", "설정을 엔진에 적용하는 실험실 코드와, 처음 불러오는 씬 파일입니다."));
  const files = element("ul", "feature-code-files");
  for (const path of [...options.sources.map(source => `${LAB_DIR}${source}`), scenePath]) {
    const item = element("li"); const a = element("a"); a.href = `${REPOSITORY}${path}`; a.target = "_blank"; a.rel = "noreferrer";
    a.append(icon(path.endsWith(".json") ? "file-json" : "file-code"), element("code", undefined, path));
    item.append(a); files.append(item);
  }
  sources.append(files);
  addTab("sources", "코드 위치", sources);

  tablist.addEventListener("click", event => {
    const index = panels.findIndex(entry => entry.tab === (event.target as Element).closest("[role=tab]"));
    if (index >= 0) select(index);
  }, { signal });
  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  tablist.addEventListener("keydown", event => {
    const index = panels.findIndex(entry => entry.tab === document.activeElement);
    const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1
      : event.key === "Home" ? 0 : event.key === "End" ? panels.length - 1 : undefined;
    if (index < 0 || next === undefined) return;
    event.preventDefault();
    select((next + panels.length) % panels.length, true);
  }, { signal });
  select(0);
  return { element: root, destroy: () => lifetime.abort() };
}
