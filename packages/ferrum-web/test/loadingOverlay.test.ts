import { equal } from "node:assert/strict";
import { test } from "node:test";
import { LoadingOverlay } from "../src/loadingOverlay.js";

type Listener = () => void;

class FakeElement {
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  className = "";
  textContent = "";
  private parent?: FakeElement;
  private readonly listeners = new Map<string, Listener[]>();

  get parentElement(): FakeElement | undefined {
    return this.parent;
  }

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

function findByAttribute(element: FakeElement, name: string): FakeElement | undefined {
  if (element.attributes.has(name)) {
    return element;
  }
  for (const child of element.children) {
    const result = findByAttribute(child, name);
    if (result) {
      return result;
    }
  }
  return undefined;
}

test("LoadingOverlay renders progress from AssetLoadProgress", () => {
  installFakeDocument((body) => {
    const overlay = new LoadingOverlay(body as unknown as HTMLElement);
    overlay.update({
      loaded: 1,
      total: 2,
      ratio: 0.5,
      elapsedMs: 12,
      kind: "texture",
      name: "player",
      url: "/player.png",
      cached: true,
    });

    const root = body.children[0];
    const bar = findByAttribute(body, "data-ferrum-loading-progress-bar");
    const track = findByAttribute(body, "data-ferrum-loading-progress");

    equal(root?.attributes.get("data-ferrum-loading-status"), "loading");
    equal(bar?.style.width, "50%");
    equal(track?.attributes.get("aria-valuenow"), "50");
    equal(textOf(body).includes("Loading texture player (1/2) cached"), true);
    equal(overlay.state().progress.ratio, 0.5);
  });
});

test("LoadingOverlay completes and can auto-hide", () => {
  installFakeDocument((body) => {
    const overlay = new LoadingOverlay(body as unknown as HTMLElement, { autoHideOnComplete: true });
    overlay.update({ loaded: 0, total: 1 });
    overlay.complete();

    equal(overlay.state().status, "complete");
    equal(overlay.state().title, "Ready");
    equal(body.children[0]?.style.display, "none");
  });
});

test("LoadingOverlay destroy is idempotent", () => {
  installFakeDocument((body) => {
    const overlay = new LoadingOverlay(body as unknown as HTMLElement);
    equal(body.children.length, 1);

    overlay.destroy();
    overlay.destroy();
    overlay.update({ loaded: 1, total: 1 });

    equal(body.children.length, 0);
  });
});
