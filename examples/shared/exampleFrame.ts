import { exampleIcon } from "./exampleIcons";

/** Sentences of a short description, so each one becomes its own "볼 것" line. */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map(item => item.trim()).filter(Boolean);
}

/** Icon-only playback button. The name stays available to assistive technology and as a tooltip. */
export function iconButton(icon: string, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button"; button.className = "example-icon-button";
  setIconButton(button, icon, label);
  return button;
}

/** Swap the icon and name of an icon button, such as pause and resume. */
export function setIconButton(button: HTMLButtonElement, icon: string, label: string): void {
  if (button.dataset.icon === icon && button.getAttribute("aria-label") === label) return;
  button.dataset.icon = icon;
  button.setAttribute("aria-label", label); button.title = label;
  button.replaceChildren(exampleIcon(icon));
}

export interface StageHead {
  /** The page's title row, now at the top of the stage column. */
  element: HTMLElement;
  title: HTMLHeadingElement;
  /** One sentence under the title: what this shows. */
  summary: HTMLParagraphElement;
  /** Small known-issue mark beside the title; hidden without an issue. */
  issue: HTMLSpanElement;
  set(title: string, summary: string, issue?: string): void;
}

/** Turn a page's `.demo-toolbar` (an h1 and its buttons) into the head of the stage column: the title
 * and one sentence on the left, the buttons on the right. The toolbar node itself is kept, so pages and
 * the runtime shell that already hold its buttons keep working. */
export function createStageHead(toolbar: HTMLElement): StageHead {
  const title = toolbar.querySelector("h1")!;
  const heading = document.createElement("div"); heading.className = "example-heading";
  const summary = toolbar.querySelector<HTMLParagraphElement>(".example-subtitle") ?? document.createElement("p");
  summary.className = "example-subtitle";
  const issue = document.createElement("span"); issue.className = "example-issue"; issue.hidden = true;
  title.before(heading);
  heading.append(title, summary);
  const set = (text: string, line: string, known?: string) => {
    title.replaceChildren(text);
    summary.textContent = line;
    issue.hidden = !known;
    if (known) { issue.textContent = "알려진 문제"; issue.title = known; issue.setAttribute("aria-label", `알려진 문제: ${known}`); title.append(" ", issue); }
  };
  return { element: toolbar, title, summary, issue, set };
}

/** Put the stage head over the stage, and the previous/next line under it, in one grid column. */
export function mountStageColumn(stage: HTMLElement, head: HTMLElement, pager?: HTMLElement): HTMLElement {
  const column = document.createElement("div"); column.className = "example-stage-column";
  stage.before(column);
  column.append(head, stage);
  if (pager) column.append(pager);
  return column;
}

/** "해 보기": buttons, keys and settings that change what the stage shows. */
export function createTrySection(): HTMLElement {
  const section = document.createElement("section");
  section.className = "example-try"; section.setAttribute("aria-label", "해 보기");
  const title = document.createElement("h2"); title.textContent = "해 보기";
  section.append(title);
  return section;
}

/** A short note under the controls, such as what the pointer does on the canvas. */
export function hint(text: string): HTMLParagraphElement {
  const p = document.createElement("p"); p.className = "example-hint"; p.textContent = text;
  return p;
}

/** Secondary settings folded inside "해 보기". */
export function fold(label: string, ...content: Node[]): HTMLDetailsElement {
  const details = document.createElement("details"); details.className = "example-fold";
  const summary = document.createElement("summary"); summary.append(exampleIcon("chevron-right"), label);
  details.append(summary, ...content);
  return details;
}

export interface WatchSection {
  element: HTMLElement;
  set(lines: readonly string[]): void;
}

/** "볼 것": two or three short lines on what changes on the stage. */
export function createWatchSection(): WatchSection {
  const element = document.createElement("section");
  element.className = "example-watch"; element.setAttribute("aria-label", "볼 것");
  const title = document.createElement("h2"); title.textContent = "볼 것";
  const list = document.createElement("ul");
  element.append(title, list);
  return {
    element,
    set(lines) {
      list.replaceChildren(...lines.map(text => { const item = document.createElement("li"); item.textContent = text; return item; }));
    },
  };
}

/** A titled block inside a "더 보기" tab. */
export function moreBlock(title: string, ...content: Node[]): HTMLElement {
  const section = document.createElement("section"); section.className = "example-more-block";
  const heading = document.createElement("h3"); heading.textContent = title;
  section.append(heading, ...content);
  return section;
}
