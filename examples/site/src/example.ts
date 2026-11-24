import type { LocalizedText } from "./locale";

/** The contract between the site frame and one example module
 * (docs/planning/example-site-rebuild-plan.md, "예제 모듈 계약").
 *
 * The frame owns the play bar, the viewport, the inspector shell, the bottom dock and the status bar.
 * An example receives a fresh canvas and fills only what is its own: the "해 보기" rows, the scene
 * document it runs, and the engine numbers it reads. It ends when `signal` aborts. */

export type RendererChoice = "webgl2" | "webgpu";

/** Engine numbers an example reads from its runtime. The status bar and the engine tab show the same values. */
export interface EngineNumbers {
  /** The backend that actually runs, which can differ from the requested one. */
  renderer: RendererChoice;
  fps: number;
  entities: number;
  commands: number;
  drawCalls: number;
  textures?: number;
  textureBytes?: number;
  /** Numbers this example adds after the common ones, such as contact counts. */
  extra?: readonly { label: LocalizedText; value: number | string }[];
}

export interface SliderOptions {
  label: LocalizedText;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Shown after the number field, such as "°" or "%". */
  unit?: string;
  onInput(value: number): void;
}
export interface ChoiceOptions {
  label: LocalizedText;
  options: readonly { value: string; text: LocalizedText; color?: string }[];
  value: string;
  onChange(value: string): void;
}
export interface ToggleOptions {
  label: LocalizedText;
  value: boolean;
  onChange(value: boolean): void;
}
export interface Control<T> {
  set(value: T): void;
}

/** Setting rows in the inspector's "해 보기" section: a 76px name and one control. */
export interface ExampleControls {
  slider(options: SliderOptions): Control<number>;
  choice(options: ChoiceOptions): Control<string>;
  toggle(options: ToggleOptions): Control<boolean>;
  /** One line under the rows about what the canvas itself accepts. */
  hint(text: LocalizedText): void;
}

/** A check item in the play bar's "표시" menu: something drawn over the picture to help read it. */
export interface DisplayOption {
  label: LocalizedText;
  value: boolean;
  onChange(value: boolean): void;
}

/** One line in the "이벤트" tab. */
export interface ExampleEvent {
  /** What happened, such as "trigger enter". */
  kind: LocalizedText;
  /** Between what, such as "robot ↔ zone". */
  detail: string;
  /** "enter" and "exit" pair up visually; "info" is anything else. */
  tone?: "enter" | "exit" | "info";
}

export interface ExampleHost {
  /** A new canvas for every start: a canvas keeps the first context type it was given. */
  canvas: HTMLCanvasElement;
  /** A layer the size of the canvas, for markers over the picture. It does not take pointer input. */
  overlay: HTMLElement;
  renderer: RendererChoice;
  /** Aborts when the example leaves the screen or restarts with another renderer. */
  signal: AbortSignal;
  controls: ExampleControls;
  /** The scene document as it runs now, shown in the "씬 파일" tab; `focus` marks one instance. */
  showScene(document: unknown, focus?: string): void;
  /** Call at a low rate (a few times a second), not every frame. */
  report(numbers: EngineNumbers): void;
  /** Fills the play bar's "표시" menu. Call once while starting. */
  display(options: readonly DisplayOption[]): void;
  /** Adds a line to the "이벤트" tab; the catalog entry must set `events`. Report changes (enter, exit), not every frame. */
  event(entry: ExampleEvent): void;
}

export interface ExampleSession {
  /** The play bar's reset: back to the first values. */
  reset(): void;
  /** Releases everything the example made. Safe to call more than once. */
  destroy(): void;
}

export type ExampleStart = (host: ExampleHost) => Promise<ExampleSession>;

/** Cleanup that also covers resources created after the example already left. */
export function createOwner(signal: AbortSignal) {
  const disposers: (() => void)[] = [];
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    for (const dispose of disposers.splice(0).reverse()) {
      try { dispose(); } catch (error) { console.warn(error); }
    }
  };
  signal.addEventListener("abort", destroy, { once: true });
  return {
    /** Adopts a resource; one that arrives after the abort is released at once. */
    own(dispose: () => void): void {
      if (destroyed) dispose(); else disposers.push(dispose);
    },
    /** Throws when the example already left, so startup stops at the next step. */
    check(): void {
      if (signal.aborted) throw new DOMException("The example left before it started.", "AbortError");
    },
    destroy,
  };
}
