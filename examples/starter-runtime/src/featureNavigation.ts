import catalog from "../../shared/featureCatalog.json";

export function createFeatureNavigation(selected: string): { element: HTMLElement; destroy(): void } {
  const lifetime = new AbortController(), { signal } = lifetime;
  const element = document.createElement("nav");
  element.className = "feature-topics";
  element.setAttribute("aria-label", "엔진 기능 선택");
  const categories = document.createElement("div"), links = document.createElement("div");
  categories.className = "feature-categories"; links.className = "feature-topic-links";
  const mobile = document.createElement("label"), select = document.createElement("select");
  mobile.className = "feature-topic-picker"; mobile.textContent = "기능 선택 ";
  select.setAttribute("aria-label", "실험 선택"); mobile.append(select);
  const selectedGroup = catalog.find(item => item.id === selected)!.group;
  const chooseGroup = (group: string) => {
    for (const button of categories.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.textContent === group));
    for (const a of links.querySelectorAll<HTMLAnchorElement>("a")) a.hidden = a.dataset.group !== group;
  };
  for (const group of new Set(catalog.map(item => item.group))) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = group;
    button.addEventListener("click", () => chooseGroup(group), { signal }); categories.append(button);
    const optgroup = document.createElement("optgroup"); optgroup.label = group; select.append(optgroup);
    for (const item of catalog.filter(item => item.group === group)) {
      const url = new URL(location.href); url.search = ""; url.searchParams.set("feature", item.id);
      if (new URLSearchParams(location.search).get("renderer") === "webgpu") url.searchParams.set("renderer", "webgpu");
      const a = document.createElement("a"); a.href = url.href; a.textContent = item.title; a.dataset.group = group;
      if (item.id === selected) a.setAttribute("aria-current", "page"); links.append(a);
      const option = document.createElement("option"); option.value = url.href; option.textContent = item.title; option.selected = item.id === selected; optgroup.append(option);
    }
  }
  select.addEventListener("change", () => location.assign(select.value), { signal });
  chooseGroup(selectedGroup); element.append(categories, links, mobile);
  return { element, destroy: () => lifetime.abort() };
}
