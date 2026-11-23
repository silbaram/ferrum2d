import { createExampleCode, exampleDocsUrl } from "../../shared/exampleCode";
import "../../shared/exampleDetail.css";

const APP_DIR = "examples/physics-sandbox/";

/** What the detail frame shows for one scenario. */
export interface DetailScenario {
  id: string;
  title: string;
  category: string;
  summary: string;
  /** Known engine limitation shown in the list and over the stage. */
  issue?: string;
  thumbnail?: string;
  /** Physics Spec path under `public/`, such as `demos/rigid-materials.physics.json`. */
  physicsSpec: string;
  /** URL the page fetches the Physics Spec from. */
  specUrl: string;
}

export interface ScenarioDetail {
  /** Scenario list on wide screens; a picker on narrow ones. */
  sidebar: HTMLElement;
  /** Scenario line over the stage. */
  intro: HTMLElement;
  code: HTMLElement;
  /** Previous and next scenario. */
  pager: HTMLElement;
  /** Show a scenario once its world is running. */
  select(id: string): void;
  destroy(): void;
}

/** Same frame as the feature lab and the game demos. Scenario links keep a real `?demo=` URL;
 * a plain click asks the page to switch in place through `onChoose`. */
export function createScenarioDetail(
  scenarios: readonly DetailScenario[],
  initial: string,
  onChoose: (id: string) => void,
): ScenarioDetail {
  const lifetime = new AbortController(), { signal } = lifetime;
  const scenarioUrl = (id: string): string => {
    const url = new URL(location.href); url.searchParams.set("demo", id); url.hash = "";
    return url.href;
  };
  const inPlace = (link: HTMLAnchorElement) => link.addEventListener("click", event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (link.dataset.scenario) onChoose(link.dataset.scenario);
  }, { signal });

  const sidebar = document.createElement("nav");
  sidebar.className = "example-sidebar"; sidebar.setAttribute("aria-label", "시나리오 선택");
  const label = document.createElement("p"); label.className = "example-sidebar-label";
  const count = document.createElement("span"); count.textContent = String(scenarios.length);
  label.append("시나리오 ", count);
  const list = document.createElement("div"); list.className = "example-sidebar-list";
  const links = scenarios.map(scenario => {
    const a = document.createElement("a"); a.className = "example-item"; a.href = scenarioUrl(scenario.id); a.dataset.scenario = scenario.id;
    const image = document.createElement("img"); image.alt = ""; image.decoding = "async";
    if (scenario.thumbnail) image.src = scenario.thumbnail;
    const title = document.createElement("span"); title.className = "example-item-title"; title.textContent = scenario.title;
    const note = document.createElement("span"); note.className = "example-item-note";
    note.textContent = scenario.issue ? `${scenario.category} · 알려진 문제` : scenario.category;
    if (scenario.issue) { note.dataset.issue = "true"; a.title = scenario.issue; }
    a.append(image, title, note);
    inPlace(a);
    return a;
  });
  list.append(...links);
  const picker = document.createElement("label"), choice = document.createElement("select");
  picker.className = "example-picker"; picker.textContent = "시나리오 ";
  choice.setAttribute("aria-label", "시나리오 선택");
  for (const scenario of scenarios) choice.add(new Option(`${scenario.category} / ${scenario.title}`, scenario.id));
  choice.addEventListener("change", () => onChoose(choice.value), { signal });
  picker.append(choice);
  sidebar.append(label, list, picker);

  const intro = document.createElement("div"); intro.className = "example-intro";
  const step = document.createElement("span"), heading = document.createElement("h2");
  const summary = document.createElement("p"); summary.className = "scenario-summary";
  const issue = document.createElement("p"); issue.className = "scenario-issue";
  intro.append(step, heading, summary, issue);

  const pager = document.createElement("nav"); pager.className = "example-pager"; pager.setAttribute("aria-label", "이전·다음 시나리오");
  // The two links are updated in place so keyboard focus survives a switch.
  const pagerLinks = (["prev", "next"] as const).map(rel => {
    const a = document.createElement("a"); a.rel = rel; a.className = `example-pager-${rel}`;
    const small = document.createElement("small"), title = document.createElement("span");
    a.append(small, title); inPlace(a); pager.append(a);
    return { a, small, title, caption: rel === "prev" ? "이전" : "다음" };
  });

  const specData = (scenario: DetailScenario) => ({ label: "Physics Spec", path: `${APP_DIR}public/${scenario.physicsSpec}`, url: scenario.specUrl });
  const first = scenarios.find(scenario => scenario.id === initial) ?? scenarios[0];
  const code = createExampleCode({
    data: specData(first),
    api: "createFerrumRuntime · resolvePhysicsSpec · createPhysicsWorldFromSpec · createDataSceneView · stepRigidBodies · "
      + "setPhysicsDebugLinesEnabled · setPhysicsBodyMaterial · applyPhysicsBodyImpulse · queryBodyContacts · "
      + "queryRigidContactImpulses · raycastBodies · queryNearestBody · DebugGizmoLineBufferWriter",
    apiNote: "이 실험실이 쓰는 공개 API입니다. 인자와 반환값은 API 문서에서 확인하세요.",
    sources: [`${APP_DIR}src/main.ts`, `${APP_DIR}public/catalog.json`],
    sourcesNote: "시나리오를 불러와 물리를 진행하는 실험실 코드, 시나리오 목록, 지금 시나리오의 Physics Spec입니다.",
    docsUrl: exampleDocsUrl("physics-sandbox/"),
  });
  let shown = first.id;

  function select(id: string): void {
    const index = Math.max(0, scenarios.findIndex(scenario => scenario.id === id));
    const scenario = scenarios[index];
    links.forEach(link => {
      if (link.dataset.scenario === scenario.id) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    });
    choice.value = scenario.id;
    step.textContent = `시나리오 · ${index + 1} / ${scenarios.length} · ${scenario.category}`;
    heading.textContent = scenario.title;
    summary.textContent = scenario.summary;
    issue.textContent = scenario.issue ? `알려진 문제 · ${scenario.issue}` : "";
    issue.hidden = !scenario.issue;
    for (const [slot, other] of [[pagerLinks[0], scenarios[index - 1]], [pagerLinks[1], scenarios[index + 1]]] as const) {
      slot.a.hidden = !other;
      if (!other) { slot.a.removeAttribute("href"); delete slot.a.dataset.scenario; continue; }
      slot.a.href = scenarioUrl(other.id); slot.a.dataset.scenario = other.id;
      slot.small.textContent = `${slot.caption} · ${other.category}`; slot.title.textContent = other.title;
    }
    if (shown !== scenario.id) { shown = scenario.id; code.setData(specData(scenario)); }
  }
  select(first.id);
  return { sidebar, intro, code: code.element, pager, select, destroy: () => { lifetime.abort(); code.destroy(); } };
}
