import catalog from "../../shared/featureCatalog.json";
import topics from "../../shared/featureTopics.json";
import physics from "../../shared/physicsExamples.json";
import { exampleSiteRoot } from "../../shared/exampleHeader";

/** Page-owned navigation; native simulation and existing feature URLs stay unchanged. */
export function createFeatureNavigation(selected: string): { element: HTMLElement; destroy(): void } {
  const lifetime = new AbortController(), { signal } = lifetime;
  const element = document.createElement("nav");
  element.className = "feature-topics"; element.setAttribute("aria-label", "엔진 기능 선택");
  const categories = document.createElement("div"), links = document.createElement("div");
  categories.className = "feature-categories"; links.className = "feature-topic-links";
  const mobile = document.createElement("label"), select = document.createElement("select");
  mobile.className = "feature-topic-picker"; mobile.textContent = "기능 선택 ";
  select.setAttribute("aria-label", "실험 선택"); mobile.append(select);
  const current = catalog.find(item => item.id === selected)!;
  const context = document.createElement("p"); context.className = "feature-current-topic";
  context.textContent = `${current.group} / ${current.title} · ${current.tags.join(" · ")}`;
  const site = document.querySelector('meta[name="ferrum-example-suite"][content="1"]')
    ? exampleSiteRoot(new URL(location.href), "starter-runtime/") : undefined;
  const chooseGroup = (topic: string) => {
    for (const button of categories.querySelectorAll<HTMLButtonElement>("button")) button.setAttribute("aria-pressed", String(button.dataset.topic === topic));
    for (const a of links.querySelectorAll<HTMLAnchorElement>("a")) a.hidden = a.dataset.topic !== topic;
  };
  const append = (title: string, url: URL, topic: string, optgroup: HTMLOptGroupElement, active = false) => {
    const a = document.createElement("a"); a.href = url.href; a.textContent = title; a.dataset.topic = topic;
    if (active) a.setAttribute("aria-current", "page"); links.append(a);
    optgroup.append(new Option(title, url.href, false, active));
  };
  for (const topic of topics) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = topic.title; button.dataset.topic = topic.id;
    button.addEventListener("click", () => chooseGroup(topic.id), { signal }); categories.append(button);
    const optgroup = document.createElement("optgroup"); optgroup.label = topic.title; select.append(optgroup);
    for (const item of catalog.filter(item => item.topic === topic.id)) {
      const url = new URL(location.href); url.search = ""; url.searchParams.set("feature", item.id);
      if (new URLSearchParams(location.search).get("renderer") === "webgpu") url.searchParams.set("renderer", "webgpu");
      append(item.title, url, topic.id, optgroup, item.id === selected);
    }
    if (site && topic.id === "physics") for (const item of physics) append(item.title, new URL(`physics-sandbox/?demo=${item.id}`, site), topic.id, optgroup);
  }
  select.addEventListener("change", () => location.assign(select.value), { signal });
  chooseGroup(current.topic); element.append(context, categories, links, mobile);
  return { element, destroy: () => lifetime.abort() };
}
