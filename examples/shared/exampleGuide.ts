import "./exampleGuide.css";

export interface ExampleTopic {
  title: string;
  action: string;
  observe: string;
  start?: () => void;
}

/** Demo-only help. Topic actions call the existing runtime's public API. */
export function createExampleGuide(topics: readonly ExampleTopic[], canvas: HTMLCanvasElement): HTMLElement {
  // InputManager suppresses the pointer's default focus action. Restore game focus
  // explicitly after using the guide's select so keyboard movement can resume.
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "게임 실험 화면");
  canvas.addEventListener("pointerdown", event => {
    if (event.button === 0 || event.pointerType === "touch") canvas.focus({ preventScroll: true });
  });
  const root = document.createElement("section");
  root.className = "example-guide";
  root.setAttribute("aria-label", "이 예제에서 체험할 기능");
  const label = document.createElement("label");
  label.textContent = "체험할 기능";
  const select = document.createElement("select");
  topics.forEach((topic, i) => select.add(new Option(topic.title, String(i))));
  label.append(select);
  const action = document.createElement("p"), observe = document.createElement("p");
  const start = document.createElement("button");
  start.type = "button";
  start.textContent = "이 위치에서 실험";
  start.addEventListener("click", () => topics[select.selectedIndex].start?.());
  const debug = document.createElement("a");
  const url = new URL(location.href);
  const enabled = url.searchParams.get("physicsDebugLines") === "true";
  url.searchParams.set("physicsDebugLines", String(!enabled));
  debug.href = url.href;
  debug.textContent = enabled ? "충돌 영역 끄고 다시 시작" : "충돌 영역 켜고 다시 시작";
  const links = document.createElement("div");
  links.className = "example-guide-actions";
  links.append(start, debug);
  root.append(label, action, observe, links);
  const update = () => {
    const topic = topics[select.selectedIndex];
    action.replaceChildren(); observe.replaceChildren();
    for (const [el, title, text] of [[action, "조작", topic.action], [observe, "관찰", topic.observe]] as const) {
      const heading = document.createElement("strong");
      heading.textContent = title;
      el.append(heading, document.createTextNode(text));
    }
    start.hidden = !topic.start;
  };
  select.addEventListener("change", update);
  update();
  return root;
}
