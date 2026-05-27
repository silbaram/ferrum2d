import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { UiOverlay } from "../src/uiOverlay.js";
import type { UiOverlayActionEvent } from "../src/uiOverlay.js";

type Listener = () => void;

class FakeElement {
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  className = "";
  textContent = "";
  type = "";
  disabled = false;
  private parent?: FakeElement;
  private readonly listeners = new Map<string, Listener[]>();

  append(...children: FakeElement[]): void {
    for (const child of children) {
      this.appendChild(child);
    }
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    for (const child of this.children) {
      child.parent = undefined;
    }
    this.children.length = 0;
    this.append(...children);
  }

  remove(): void {
    if (!this.parent) {
      return;
    }

    const index = this.parent.children.indexOf(this);
    if (index >= 0) {
      this.parent.children.splice(index, 1);
    }
    this.parent = undefined;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) {
      listener();
    }
  }
}

function installFakeDocument(run: (body: FakeElement) => void): void {
  const previousDocument = (globalThis as unknown as { document?: unknown }).document;
  const body = new FakeElement();
  const fakeDocument = {
    body,
    createElement: () => new FakeElement(),
  };
  (globalThis as unknown as { document: unknown }).document = fakeDocument;

  try {
    run(body);
  } finally {
    (globalThis as unknown as { document?: unknown }).document = previousDocument;
  }
}

function textOf(element: FakeElement): string {
  return [element.textContent, ...element.children.map(textOf)].join(" ");
}

function findButton(element: FakeElement, label: string): FakeElement | undefined {
  if (element.type === "button" && element.textContent === label) {
    return element;
  }
  for (const child of element.children) {
    const result = findButton(child, label);
    if (result) {
      return result;
    }
  }
  return undefined;
}

function findByAttribute(element: FakeElement, name: string, value: string): FakeElement | undefined {
  if (element.attributes.get(name) === value) {
    return element;
  }
  for (const child of element.children) {
    const result = findByAttribute(child, name, value);
    if (result) {
      return result;
    }
  }
  return undefined;
}

test("UiOverlay renders HUD panels and dialog text", () => {
  installFakeDocument((body) => {
    const overlay = new UiOverlay(body as unknown as HTMLElement);
    overlay.update({
      panels: [
        {
          id: "hud",
          title: "HUD",
          lines: [
            { id: "score", label: "Score", value: 12 },
            { text: "Press Start", tone: "accent" },
          ],
        },
      ],
      dialog: {
        id: "pause",
        title: "Paused",
        body: "Resume when ready.",
        actions: [{ id: "resume", label: "Resume", tone: "primary" }],
      },
    });

    equal(body.children.length, 1);
    const rendered = textOf(body);
    equal(rendered.includes("HUD"), true);
    equal(rendered.includes("Score"), true);
    equal(rendered.includes("12"), true);
    equal(rendered.includes("Paused"), true);
    equal(rendered.includes("Resume when ready."), true);
  });
});

test("UiOverlay forwards panel and dialog action events", () => {
  installFakeDocument((body) => {
    const events: UiOverlayActionEvent[] = [];
    const overlay = new UiOverlay(body as unknown as HTMLElement, {
      onAction: (event) => events.push(event),
    });
    overlay.update({
      panels: [{
        id: "menu",
        actions: [{ id: "start", label: "Start", tone: "primary" }],
      }],
      dialog: {
        id: "confirm",
        title: "Quit",
        actions: [{ id: "cancel", label: "Cancel" }],
      },
    });

    findButton(body, "Start")?.click();
    findButton(body, "Cancel")?.click();

    deepEqual(events, [
      { id: "start", panelId: "menu" },
      { id: "cancel", dialogId: "confirm" },
    ]);
  });
});

test("UiOverlay renders meter lines with theme and accessibility attributes", () => {
  installFakeDocument((body) => {
    const overlay = new UiOverlay(body as unknown as HTMLElement, { theme: "light" });
    overlay.update({
      panels: [{
        id: "stats",
        title: "Stats",
        ariaLive: "polite",
        lines: [{
          id: "hp",
          label: "HP",
          value: "50%",
          meter: { value: 5, max: 10 },
          ariaLabel: "Health",
        }],
        actions: [{ id: "pause", label: "Pause", ariaLabel: "Pause game" }],
      }],
    });

    equal(body.children[0].style.color, "#0f172a");
    const panel = findByAttribute(body, "data-ferrum-ui-panel", "stats");
    equal(panel?.attributes.get("role"), "region");
    equal(panel?.attributes.get("aria-label"), "Stats");
    equal(panel?.attributes.get("aria-live"), "polite");
    const meter = findByAttribute(body, "role", "progressbar");
    equal(meter?.attributes.get("aria-valuenow"), "5");
    equal(meter?.attributes.get("aria-valuemax"), "10");
    equal(meter?.attributes.get("aria-label"), "Health");
    equal(meter?.children[0].style.width, "50%");
    equal(findButton(body, "Pause")?.attributes.get("aria-label"), "Pause game");
  });
});

test("UiOverlay destroy is idempotent and prevents later updates", () => {
  installFakeDocument((body) => {
    const overlay = new UiOverlay(body as unknown as HTMLElement);
    equal(body.children.length, 1);

    overlay.destroy();
    overlay.destroy();
    overlay.update({ panels: [{ id: "late", title: "Late" }] });

    equal(body.children.length, 0);
  });
});

test("UiOverlay disabled option skips DOM creation", () => {
  installFakeDocument((body) => {
    const overlay = new UiOverlay(body as unknown as HTMLElement, { enabled: false });
    overlay.update({ panels: [{ id: "hidden", title: "Hidden" }] });

    equal(body.children.length, 0);
  });
});
