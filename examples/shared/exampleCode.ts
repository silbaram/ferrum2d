import { exampleSiteRoot } from "./exampleHeader";
import { exampleIcon } from "./exampleIcons";

const REPOSITORY = "https://github.com/silbaram/ferrum2d/blob/main/";

export interface ExampleCodeData {
  /** Tab label, such as "씬 JSON" or "Game Spec". */
  label: string;
  /** Repository path shown above the file and linked on GitHub. */
  path: string;
  /** URL the page fetches and offers for download. */
  url: string;
}

export interface ExampleCodeOptions {
  /** The data file this page loads, shown in the first tab when present. */
  data?: ExampleCodeData;
  /** Public API names separated by `·`. */
  api: string;
  apiNote: string;
  /** Repository paths of the example code that uses the API. */
  sources: readonly string[];
  sourcesNote: string;
  /** Public API reference: the suite's docs page, or the repository file when standalone. */
  docsUrl: string;
}

/** The public API reference inside the published suite, or the repository file when standalone. */
export function exampleDocsUrl(appPath: string): string {
  const site = document.querySelector('meta[name="ferrum-example-suite"][content="1"]')
    ? exampleSiteRoot(new URL(location.href), appPath) : undefined;
  return site ? new URL("docs/engine/public-api.html", site).href : `${REPOSITORY}docs/engine/public-api.md`;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function externalLink(href: string, label: string, iconName = "external-link"): HTMLAnchorElement {
  const a = element("a", "example-code-button"); a.href = href; a.target = "_blank"; a.rel = "noreferrer";
  a.append(exampleIcon(iconName), label);
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

export interface ExampleCode {
  element: HTMLElement;
  /** Show another data file, for pages that switch scenes in place. Ignored without an initial data file. */
  setData(data: ExampleCodeData): void;
  destroy(): void;
}

function sourceItem(path: string): HTMLLIElement {
  const item = element("li"); const a = element("a"); a.href = `${REPOSITORY}${path}`; a.target = "_blank"; a.rel = "noreferrer";
  a.append(exampleIcon(path.endsWith(".json") ? "file-json" : "file-code"), element("code", undefined, path));
  item.append(a);
  return item;
}

/** Code view under the stage: the page's data file, its public API and the example sources. */
export function createExampleCode(options: ExampleCodeOptions): ExampleCode {
  const lifetime = new AbortController(), { signal } = lifetime;
  const root = element("section", "example-code"); root.setAttribute("aria-labelledby", "example-code-title");
  const head = element("div", "example-code-head");
  const title = element("h2", undefined, "코드 보기"); title.id = "example-code-title";
  const tablist = element("div", "example-code-tabs"); tablist.setAttribute("role", "tablist"); tablist.setAttribute("aria-label", "코드 보기");
  head.append(title, tablist);
  root.append(head);

  const panels: { tab: HTMLButtonElement; panel: HTMLElement; open?: () => void }[] = [];
  const addTab = (key: string, label: string, panel: HTMLElement, open?: () => void) => {
    const tab = element("button", "example-code-tab", label); tab.type = "button";
    tab.id = `example-code-tab-${key}`; tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", `example-code-${key}`);
    panel.id = `example-code-${key}`; panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", tab.id);
    panel.className = "example-code-panel"; panel.tabIndex = 0;
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

  // Data file: the scene or Game Spec this page loads, fetched when the tab opens.
  let data = options.data;
  let setData = (_next: ExampleCodeData): void => {};
  let dataSource: HTMLLIElement | undefined;
  if (data) {
    const file = element("div");
    const bar = element("div", "example-code-bar");
    const path = element("code", "example-code-path");
    const lines = element("span", "example-code-lines");
    const copy = element("button", "example-code-button"); copy.type = "button"; copy.append(exampleIcon("copy"), "복사");
    const download = element("a", "example-code-button"); download.append(exampleIcon("download"), "내려받기");
    const github = externalLink("", "GitHub", "github");
    bar.append(path, lines, copy, download, github);
    const pre = element("pre", "example-code-json"); const code = element("code"); pre.append(code);
    const status = element("p", "example-code-status"); status.setAttribute("role", "status");
    file.append(bar, pre, status);
    let text: string | undefined, request: AbortController | undefined;
    signal.addEventListener("abort", () => request?.abort(), { once: true });
    const show = (next: ExampleCodeData) => {
      data = next;
      path.textContent = next.path; lines.textContent = "불러오는 중…";
      download.href = next.url; download.download = next.path.split("/").at(-1)!;
      github.href = `${REPOSITORY}${next.path}`;
      code.replaceChildren(); status.textContent = ""; text = undefined;
      delete root.dataset.dataLines;
    };
    const load = () => {
      if (request || signal.aborted) return;
      // Each file gets its own request, so a slow earlier file never replaces a later one.
      const current = data!, own = new AbortController();
      request = own;
      fetch(current.url, { signal: own.signal }).then(response => {
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        return response.text();
      }).then(body => {
        if (request !== own) return;
        // Copy keeps the exact file; the view packs plain-value arrays to stay readable.
        text = body;
        const rows = formatSceneJson(JSON.parse(body)).split("\n");
        lines.textContent = `${rows.length}줄`;
        const fragment = document.createDocumentFragment();
        rows.forEach((row, index) => {
          const span = element("span", "json-line"); span.append(highlightLine(row));
          fragment.append(span, index < rows.length - 1 ? "\n" : "");
        });
        code.replaceChildren(fragment);
        root.dataset.dataLines = String(rows.length);
      }).catch(error => {
        if (request !== own || own.signal.aborted) return;
        lines.textContent = "";
        status.textContent = `${current.label} 파일을 불러오지 못했습니다. ${error instanceof Error ? error.message : String(error)}`;
      });
    };
    show(data);
    setData = next => {
      request?.abort(); request = undefined;
      show(next);
      const item = sourceItem(next.path);
      dataSource?.replaceWith(item); dataSource = item;
      if (!file.hidden) load();
    };
    copy.addEventListener("click", () => {
      if (!text) return;
      navigator.clipboard.writeText(text)
        .then(() => { status.textContent = `${data!.label}을 복사했습니다.`; })
        .catch(() => { status.textContent = "복사하지 못했습니다. 내려받기를 사용하세요."; });
    }, { signal });
    addTab("data", data.label, file, load);
  }

  // Public API used here, with the reference page.
  const api = element("div");
  api.append(element("p", "example-code-note", options.apiNote));
  const names = element("ul", "example-code-api");
  for (const name of options.api.split("·").map(text => text.trim()).filter(Boolean)) {
    const item = element("li"); item.append(element("code", undefined, name)); names.append(item);
  }
  api.append(names, externalLink(options.docsUrl, "공개 API 문서", "book-open"));
  addTab("api", "API", api);

  // Example code that applies the API, and the data file it loads.
  const sources = element("div");
  sources.append(element("p", "example-code-note", options.sourcesNote));
  const files = element("ul", "example-code-files");
  files.append(...options.sources.map(sourceItem));
  if (data) { dataSource = sourceItem(data.path); files.append(dataSource); }
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
  return { element: root, setData: next => setData(next), destroy: () => lifetime.abort() };
}
