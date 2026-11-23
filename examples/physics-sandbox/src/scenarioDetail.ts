import { createExampleCode, exampleDocsUrl } from "../../shared/exampleCode";
import { createExampleAbout } from "../../shared/exampleHeader";
import { createStageHead, moreBlock, type StageHead } from "../../shared/exampleFrame";
import "../../shared/exampleDetail.css";

const APP_DIR = "examples/physics-sandbox/";

/** What the detail frame shows for one scenario. */
export interface DetailScenario {
  id: string;
  title: string;
  category: string;
  summary: string;
  /** Known engine limitation, marked in the list and beside the title. */
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
  /** "더 보기": description, Physics Spec, API, sources and the engine numbers. */
  code: HTMLElement;
  /** Previous and next scenario, one line under the stage. */
  pager: HTMLElement;
  /** Show the scenario in the page's title row; called once with the title row. */
  attachHead(toolbar: HTMLElement): StageHead;
  /** Show a scenario once its world is running. */
  select(id: string): void;
  /** Open "더 보기" on a tab, such as the engine numbers after an error. */
  open(key: string): void;
  destroy(): void;
}

/** Same frame as the feature lab and the game demos. Scenario links keep a real `?demo=` URL;
 * a plain click asks the page to switch in place through `onChoose`. `engine` holds the run state,
 * physics settings and signals for "더 보기 › 엔진 수치". */
export function createScenarioDetail(
  scenarios: readonly DetailScenario[],
  initial: string,
  onChoose: (id: string) => void,
  engine: HTMLElement,
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
    const note = document.createElement("span"); note.className = "example-item-note"; note.textContent = scenario.category;
    a.append(image, title, note);
    if (scenario.issue) {
      // A red dot; the text is the tooltip and part of the link's name.
      const dot = document.createElement("span"); dot.className = "example-item-issue";
      dot.setAttribute("role", "img"); dot.setAttribute("aria-label", "알려진 문제");
      a.title = `알려진 문제: ${scenario.issue}`; a.dataset.issue = "true";
      a.append(dot);
    }
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

  const pager = document.createElement("nav"); pager.className = "example-pager"; pager.setAttribute("aria-label", "이전·다음 시나리오");
  // The two links are updated in place so keyboard focus survives a switch.
  const pagerLinks = (["prev", "next"] as const).map(rel => {
    const a = document.createElement("a"); a.rel = rel; a.className = `example-pager-${rel}`;
    const small = document.createElement("small"), title = document.createElement("span");
    small.textContent = rel === "prev" ? "이전" : "다음";
    a.append(small, title); inPlace(a); pager.append(a);
    return { a, title };
  });

  // Description: the lab's purpose and related experiments, and the scenario's known issue in full.
  const about = createExampleAbout("physics-sandbox");
  const issueText = document.createElement("p");
  const issueBlock = moreBlock("알려진 문제", issueText);
  const description = document.createElement("div"); description.className = "example-more-grid";
  description.append(moreBlock("이 실험실", about), issueBlock);

  const specData = (scenario: DetailScenario) => ({ label: "Physics Spec", path: `${APP_DIR}public/${scenario.physicsSpec}`, url: scenario.specUrl });
  const first = scenarios.find(scenario => scenario.id === initial) ?? scenarios[0];
  const code = createExampleCode({
    leading: [{ key: "about", label: "설명", content: description }],
    trailing: [{ key: "engine", label: "엔진 수치", content: engine }],
    data: specData(first),
    api: "createFerrumRuntime · resolvePhysicsSpec · createPhysicsWorldFromSpec · createDataSceneView · stepRigidBodies · "
      + "setPhysicsDebugLinesEnabled · setPhysicsBodyMaterial · applyPhysicsBodyImpulse · queryBodyContacts · "
      + "queryRigidContactImpulses · raycastBodies · queryNearestBody · DebugGizmoLineBufferWriter",
    apiNote: "이 실험실이 쓰는 공개 API입니다. 인자와 반환값은 API 문서에서 확인하세요.",
    sources: [`${APP_DIR}src/main.ts`, `${APP_DIR}public/catalog.json`],
    sourcesNote: "시나리오를 불러와 물리를 진행하는 실험실 코드, 시나리오 목록, 지금 시나리오의 Physics Spec입니다.",
    docsUrl: exampleDocsUrl("physics-sandbox/"),
  });
  let shown = first.id, current = first;
  let head: StageHead | undefined;

  function select(id: string): void {
    const index = Math.max(0, scenarios.findIndex(scenario => scenario.id === id));
    const scenario = scenarios[index];
    current = scenario;
    links.forEach(link => {
      if (link.dataset.scenario === scenario.id) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    });
    choice.value = scenario.id;
    head?.set(scenario.title, scenario.summary, scenario.issue);
    issueText.textContent = scenario.issue ?? "";
    issueBlock.hidden = !scenario.issue;
    for (const [slot, other] of [[pagerLinks[0], scenarios[index - 1]], [pagerLinks[1], scenarios[index + 1]]] as const) {
      slot.a.hidden = !other;
      if (!other) { slot.a.removeAttribute("href"); delete slot.a.dataset.scenario; continue; }
      slot.a.href = scenarioUrl(other.id); slot.a.dataset.scenario = other.id;
      slot.title.textContent = other.title;
    }
    if (shown !== scenario.id) { shown = scenario.id; code.setData(specData(scenario)); }
  }
  select(first.id);
  return {
    sidebar, code: code.element, pager, select, open: key => code.open(key),
    attachHead(toolbar) {
      head = createStageHead(toolbar);
      head.set(current.title, current.summary, current.issue);
      return head;
    },
    destroy: () => { lifetime.abort(); code.destroy(); },
  };
}
