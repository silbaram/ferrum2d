import catalog from "../../shared/featureCatalog.json";
import topics from "../../shared/featureTopics.json";
import physics from "../../shared/physicsExamples.json";
import lucide from "../../shared/gallery/lucideIcons.json";
import { exampleSiteRoot } from "../../shared/exampleHeader";

// Gallery thumbnails are bundled so the standalone lab shows the same pictures.
const thumbnails = import.meta.glob<string>("../../shared/thumbnails/feature-*.jpg", { eager: true, query: "?url", import: "default" });
const thumbnail = (name: string): string | undefined => thumbnails[`../../shared/thumbnails/${name}`];
const icons: Record<string, string> = lucide.icons;

function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ class: "feature-icon", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": "1.75", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(key, value);
  svg.innerHTML = icons[name] ?? "";
  return svg;
}
function dot(domain: string): HTMLElement {
  const span = document.createElement("span"); span.className = "feature-dot"; span.dataset.domain = domain;
  return span;
}

/** Experiments in navigation order: topics as listed, then each topic's catalog order. */
const ordered = topics.flatMap(topic => catalog.filter(item => item.topic === topic.id));

export interface FeatureNavigation {
  /** Topic list with thumbnails on wide screens; a compact picker on narrow ones. */
  element: HTMLElement;
  /** Previous and next experiment links, placed under the stage. */
  pager: HTMLElement;
  destroy(): void;
}

/** Page-owned navigation; native simulation and existing feature URLs stay unchanged. */
export function createFeatureNavigation(selected: string): FeatureNavigation {
  const lifetime = new AbortController(), { signal } = lifetime;
  const element = document.createElement("nav");
  element.className = "feature-topics"; element.setAttribute("aria-label", "엔진 기능 선택");
  const current = catalog.find(item => item.id === selected)!;
  const site = document.querySelector('meta[name="ferrum-example-suite"][content="1"]')
    ? exampleSiteRoot(new URL(location.href), "starter-runtime/") : undefined;
  const featureUrl = (id: string): URL => {
    const url = new URL(location.href); url.search = ""; url.hash = ""; url.searchParams.set("feature", id);
    if (new URLSearchParams(location.search).get("renderer") === "webgpu") url.searchParams.set("renderer", "webgpu");
    return url;
  };

  const label = document.createElement("p"); label.className = "feature-sidebar-label";
  const total = document.createElement("span"); total.textContent = String(catalog.length);
  label.append("기능 실험 ", total);
  const list = document.createElement("div"); list.className = "feature-topic-list";
  const mobile = document.createElement("label"), select = document.createElement("select");
  mobile.className = "feature-topic-picker"; mobile.textContent = "기능 선택 ";
  select.setAttribute("aria-label", "실험 선택"); mobile.append(select);

  const groups: { topic: string; button: HTMLButtonElement; links: HTMLElement }[] = [];
  const openTopic = (topic: string | undefined) => {
    for (const group of groups) {
      const open = group.topic === topic;
      group.button.setAttribute("aria-expanded", String(open));
      group.links.hidden = !open;
    }
  };
  const link = (title: string, url: URL, topic: string, image: string | undefined, active: boolean) => {
    const a = document.createElement("a"); a.href = url.href; a.dataset.topic = topic;
    if (active) a.setAttribute("aria-current", "page");
    const picture = document.createElement("img"); picture.alt = ""; picture.loading = "lazy"; picture.decoding = "async";
    if (image) picture.src = image;
    const text = document.createElement("span"); text.className = "feature-link-title"; text.textContent = title;
    a.append(picture, text);
    return a;
  };
  for (const topic of topics) {
    const items = catalog.filter(item => item.topic === topic.id);
    const group = document.createElement("div"); group.className = "feature-topic"; group.dataset.topic = topic.id;
    const button = document.createElement("button"); button.type = "button"; button.dataset.topic = topic.id;
    button.setAttribute("aria-controls", `feature-topic-${topic.id}`);
    const name = document.createElement("span"); name.className = "feature-topic-title"; name.textContent = topic.title;
    const count = document.createElement("span"); count.className = "feature-topic-count"; count.textContent = String(items.length);
    button.append(dot(topic.domain), icon(topic.icon), name, count);
    const links = document.createElement("div"); links.className = "feature-topic-links"; links.id = `feature-topic-${topic.id}`;
    links.setAttribute("role", "group"); links.setAttribute("aria-label", `${topic.title} 실험`);
    const optgroup = document.createElement("optgroup"); optgroup.label = topic.title; select.append(optgroup);
    for (const item of items) {
      const url = featureUrl(item.id), active = item.id === selected;
      links.append(link(item.title, url, topic.id, thumbnail(`feature-${item.id}.jpg`), active));
      optgroup.append(new Option(item.title, url.href, false, active));
    }
    // The physics lab is a separate app. One row marked as a new page leads there instead of
    // mixing its scenarios in with this lab's experiments; the gallery lists each scenario.
    if (site && topic.id === "physics") {
      const url = new URL("physics-sandbox/", site);
      const a = document.createElement("a"); a.href = url.href; a.dataset.topic = topic.id; a.className = "feature-topic-external";
      const title = document.createElement("span"); title.className = "feature-link-title"; title.textContent = "물리 심화 실험실";
      const note = document.createElement("span"); note.className = "feature-link-note"; note.textContent = `시나리오 ${physics.length}개 · 새 화면`;
      a.append(icon("external-link"), title, note);
      links.append(a);
      optgroup.append(new Option(`물리 심화 실험실 · 시나리오 ${physics.length}개 (새 화면)`, url.href));
    }
    button.addEventListener("click", () => openTopic(button.getAttribute("aria-expanded") === "true" ? undefined : topic.id), { signal });
    groups.push({ topic: topic.id, button, links });
    group.append(button, links); list.append(group);
  }
  select.addEventListener("change", () => location.assign(select.value), { signal });
  element.addEventListener("focusin", event => {
    const item = event.target instanceof Element ? event.target.closest<HTMLElement>("a,button") : null;
    if (item && list.contains(item)) item.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, { signal });
  openTopic(current.topic);
  element.append(label, list, mobile);

  const pager = document.createElement("nav"); pager.className = "feature-pager"; pager.setAttribute("aria-label", "이전·다음 실험");
  const index = ordered.findIndex(item => item.id === selected);
  for (const [rel, item, caption] of [["prev", ordered[index - 1], "이전"], ["next", ordered[index + 1], "다음"]] as const) {
    if (!item) { pager.append(document.createElement("span")); continue; }
    const a = document.createElement("a"); a.href = featureUrl(item.id).href; a.rel = rel; a.className = `feature-pager-${rel}`;
    const small = document.createElement("small"); small.textContent = `${caption} · ${topics.find(topic => topic.id === item.topic)!.title}`;
    const title = document.createElement("span"); title.textContent = item.title;
    a.append(small, title); pager.append(a);
  }
  return { element, pager, destroy: () => lifetime.abort() };
}

/** Place the topic list beside the stage and the pager under it. */
export function mountFeatureNavigation(root: HTMLElement, stage: HTMLElement, navigation: FeatureNavigation): void {
  root.querySelector(".demo-stage-layout")!.prepend(navigation.element);
  stage.append(navigation.pager);
}
