import type { InputDigitalControl } from "./inputProfile.js";
import type { InputSnapshot } from "./inputManager.js";

export interface VirtualJoystickOptions {
  id?: string;
  label?: string;
  deadzone?: number;
  maxDistance?: number;
}

export interface VirtualButtonOptions {
  id: string;
  label: string;
  controls?: readonly InputDigitalControl[];
  virtualButton?: string;
}

export interface VirtualControlsOptions {
  enabled?: boolean;
  className?: string;
  joystick?: VirtualJoystickOptions | false;
  buttons?: readonly VirtualButtonOptions[];
}

export interface VirtualControlsState {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  buttons: Record<string, boolean>;
  virtualButtons: Record<string, boolean>;
}

interface Point {
  x: number;
  y: number;
}

const DEFAULT_JOYSTICK_ID = "movement";
const DEFAULT_JOYSTICK_LABEL = "Move";
const DEFAULT_JOYSTICK_DEADZONE = 0.32;
const DEFAULT_JOYSTICK_MAX_DISTANCE = 42;

export const DEFAULT_VIRTUAL_CONTROL_BUTTONS: readonly VirtualButtonOptions[] = Object.freeze([
  Object.freeze({
    id: "primary",
    label: "A",
    controls: Object.freeze(["space", "mouseLeft"] as const),
    virtualButton: "primary",
  }),
  Object.freeze({
    id: "menu",
    label: "Menu",
    controls: Object.freeze(["enter"] as const),
    virtualButton: "menu",
  }),
]);

export class VirtualControls {
  private root?: HTMLDivElement;
  private joystickKnob?: HTMLDivElement;
  private joystickElement?: HTMLDivElement;
  private joystickPointerId: number | undefined;
  private joystickVector: Point = { x: 0, y: 0 };
  private readonly buttons = new Map<string, VirtualButtonOptions>();
  private readonly pressedButtons = new Set<string>();
  private readonly buttonPointers = new Map<string, { id: number; element: HTMLElement }>();
  private readonly listeners = new Set<() => void>();
  private destroyed = false;

  constructor(
    parent: HTMLElement = document.body,
    private readonly options: VirtualControlsOptions = {},
  ) {
    for (const button of options.buttons ?? DEFAULT_VIRTUAL_CONTROL_BUTTONS) {
      this.buttons.set(button.id, button);
    }
    if (options.enabled === false) {
      return;
    }

    const root = document.createElement("div");
    root.className = options.className ?? "ferrum-virtual-controls";
    root.setAttribute("data-ferrum-virtual-controls", "true");
    styleRoot(root);

    if (options.joystick !== false) {
      root.appendChild(this.createJoystick(options.joystick ?? {}));
    }

    const buttonGroup = document.createElement("div");
    buttonGroup.setAttribute("data-ferrum-virtual-buttons", "true");
    styleButtonGroup(buttonGroup);
    for (const button of this.buttons.values()) {
      buttonGroup.appendChild(this.createButton(button));
    }
    root.appendChild(buttonGroup);
    parent.appendChild(root);
    this.root = root;
  }

  /** Observe input transitions, including taps between frame polls. The caller owns unsubscription. */
  subscribe(listener: () => void): () => void {
    this.assertAlive();
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  state(): VirtualControlsState {
    const virtualButtons = new Map<string, boolean>();
    for (const [id, button] of this.buttons) {
      const pressed = this.buttonPressed(id);
      const name = button.virtualButton ?? id;
      virtualButtons.set(name, virtualButtons.get(name) === true || pressed);
    }
    return {
      ...directionsFromVector(this.joystickVector, joystickDeadzone(this.options.joystick)),
      buttons: Object.fromEntries([...this.buttons.keys()].map((id) => [id, this.buttonPressed(id)])),
      virtualButtons: Object.fromEntries(virtualButtons),
    };
  }

  virtualButtons(): Record<string, boolean> {
    return this.state().virtualButtons;
  }

  applyToSnapshot(snapshot: InputSnapshot): InputSnapshot {
    return applyVirtualControlStateToSnapshot(snapshot, this.state(), [...this.buttons.values()]);
  }

  setJoystickVector(x: number, y: number): void {
    this.assertAlive();
    this.joystickVector = {
      x: clampFinite(x, -1, 1),
      y: clampFinite(y, -1, 1),
    };
    this.updateJoystickKnob();
    this.notify();
  }

  setButtonPressed(id: string, pressed: boolean): void {
    this.assertAlive();
    if (!this.buttons.has(id)) {
      throw new Error(`Unknown virtual button '${id}'.`);
    }
    if (pressed) {
      this.pressedButtons.add(id);
    } else {
      this.pressedButtons.delete(id);
    }
    this.updateButtonAria(id);
    this.notify();
  }

  releaseAll(): void {
    if (!this.destroyed) this.resetState();
  }

  private resetState(): void {
    const changed = this.joystickPointerId !== undefined || this.buttonPointers.size > 0
      || this.pressedButtons.size > 0 || this.joystickVector.x !== 0 || this.joystickVector.y !== 0;
    const joystickId = this.joystickPointerId;
    const pointers = [...this.buttonPointers.values()];
    this.joystickPointerId = undefined;
    this.buttonPointers.clear();
    this.joystickVector = { x: 0, y: 0 };
    this.pressedButtons.clear();
    if (joystickId !== undefined && this.joystickElement) releasePointer(this.joystickElement, joystickId);
    for (const pointer of pointers) releasePointer(pointer.element, pointer.id);
    this.updateJoystickKnob();
    for (const id of this.buttons.keys()) {
      this.updateButtonAria(id);
    }
    if (changed) this.notify();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    try {
      this.resetState();
    } finally {
      // A consumer callback may throw during cancellation; DOM and subscriptions
      // must still be released, and setters must remain unusable after destroy.
      this.listeners.clear();
      this.root?.remove();
      this.root = undefined;
      this.joystickKnob = undefined;
      this.joystickElement = undefined;
    }
  }

  private createJoystick(options: VirtualJoystickOptions): HTMLDivElement {
    const joystick = document.createElement("div");
    joystick.setAttribute("role", "application");
    joystick.setAttribute("aria-label", options.label ?? DEFAULT_JOYSTICK_LABEL);
    joystick.setAttribute("data-ferrum-virtual-joystick", options.id ?? DEFAULT_JOYSTICK_ID);
    styleJoystick(joystick);

    const knob = document.createElement("div");
    knob.setAttribute("data-ferrum-virtual-joystick-knob", "true");
    styleJoystickKnob(knob);
    joystick.appendChild(knob);
    this.joystickKnob = knob;
    this.joystickElement = joystick;

    joystick.addEventListener("pointerdown", (event) => {
      if (this.destroyed || this.joystickPointerId !== undefined || (event.pointerType === "mouse" && event.button !== 0)) {
        return;
      }
      this.joystickPointerId = event.pointerId;
      capturePointer(joystick, event.pointerId);
      event.preventDefault();
      this.updateJoystickFromPointer(joystick, event.clientX, event.clientY);
    });
    joystick.addEventListener("pointermove", (event) => {
      if (this.destroyed || event.pointerId !== this.joystickPointerId) {
        return;
      }
      // A mouse chord releases the primary button through pointermove before
      // pointerup fires for the final button. Pen/touch retain their own rules.
      if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
        this.releaseJoystickPointer(event.pointerId);
        return;
      }
      this.updateJoystickFromPointer(joystick, event.clientX, event.clientY);
      event.preventDefault();
    });
    joystick.addEventListener("pointerup", (event) => this.releaseJoystickPointer(event.pointerId));
    joystick.addEventListener("pointercancel", (event) => this.releaseJoystickPointer(event.pointerId));
    joystick.addEventListener("lostpointercapture", (event) => this.releaseJoystickPointer(event.pointerId));
    return joystick;
  }

  private createButton(button: VirtualButtonOptions): HTMLButtonElement {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = button.label;
    element.setAttribute("aria-pressed", "false");
    element.setAttribute("data-ferrum-virtual-button", button.id);
    styleButton(element, button.id);

    element.addEventListener("pointerdown", (event) => {
      if (this.destroyed || this.buttonPointers.has(button.id) || (event.pointerType === "mouse" && event.button !== 0)) return;
      this.buttonPointers.set(button.id, { id: event.pointerId, element });
      this.updateButtonAria(button.id);
      capturePointer(element, event.pointerId);
      event.preventDefault();
      this.notify();
    });
    const release = (event: PointerEvent): void => {
      if (this.destroyed || this.buttonPointers.get(button.id)?.id !== event.pointerId) return;
      this.buttonPointers.delete(button.id);
      releasePointer(element, event.pointerId);
      this.updateButtonAria(button.id);
      this.notify();
    };
    element.addEventListener("pointerup", release);
    element.addEventListener("pointercancel", release);
    element.addEventListener("lostpointercapture", release);
    element.addEventListener("pointermove", (event) => {
      if (event.pointerType === "mouse" && (event.buttons & 1) === 0) release(event);
    });
    element.addEventListener("pointerleave", (event) => {
      if (event.buttons === 0) release(event);
    });
    return element;
  }

  private updateJoystickFromPointer(element: HTMLElement, clientX: number, clientY: number): void {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width * 0.5;
    const centerY = rect.top + rect.height * 0.5;
    const maxDistance = joystickMaxDistance(this.options.joystick);
    this.setJoystickVector((clientX - centerX) / maxDistance, (clientY - centerY) / maxDistance);
  }

  private releaseJoystickPointer(pointerId: number): void {
    if (pointerId !== this.joystickPointerId) {
      return;
    }
    this.joystickPointerId = undefined;
    this.joystickVector = { x: 0, y: 0 };
    this.updateJoystickKnob();
    if (this.joystickElement) releasePointer(this.joystickElement, pointerId);
    this.notify();
  }

  private buttonPressed(id: string): boolean {
    return this.pressedButtons.has(id) || this.buttonPointers.has(id);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private updateJoystickKnob(): void {
    if (!this.joystickKnob) {
      return;
    }
    const maxDistance = joystickMaxDistance(this.options.joystick);
    this.joystickKnob.style.transform = `translate(${this.joystickVector.x * maxDistance}px, ${this.joystickVector.y * maxDistance}px)`;
  }

  private updateButtonAria(id: string): void {
    const button = this.root?.querySelector<HTMLButtonElement>(`[data-ferrum-virtual-button="${cssEscape(id)}"]`);
    button?.setAttribute("aria-pressed", this.buttonPressed(id) ? "true" : "false");
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("VirtualControls has been destroyed.");
    }
  }
}

export function applyVirtualControlStateToSnapshot(
  snapshot: InputSnapshot,
  state: VirtualControlsState,
  buttons: readonly VirtualButtonOptions[] = DEFAULT_VIRTUAL_CONTROL_BUTTONS,
): InputSnapshot {
  const merged = {
    ...snapshot,
    w: snapshot.w || state.w,
    a: snapshot.a || state.a,
    s: snapshot.s || state.s,
    d: snapshot.d || state.d,
  };
  for (const button of buttons) {
    const pressed = state.buttons[button.id] === true || state.virtualButtons[button.virtualButton ?? button.id] === true;
    if (!pressed) {
      continue;
    }
    for (const control of button.controls ?? []) {
      merged[control] = true;
    }
  }
  return merged;
}

function directionsFromVector(vector: Point, deadzone: number): Pick<VirtualControlsState, "w" | "a" | "s" | "d"> {
  return {
    w: vector.y < -deadzone,
    a: vector.x < -deadzone,
    s: vector.y > deadzone,
    d: vector.x > deadzone,
  };
}

function joystickDeadzone(options: VirtualControlsOptions["joystick"]): number {
  const deadzone = typeof options === "object" ? options.deadzone : undefined;
  return Number.isFinite(deadzone) && deadzone !== undefined && deadzone >= 0 && deadzone < 1
    ? deadzone
    : DEFAULT_JOYSTICK_DEADZONE;
}

function joystickMaxDistance(options: VirtualControlsOptions["joystick"]): number {
  const maxDistance = typeof options === "object" ? options.maxDistance : undefined;
  return Number.isFinite(maxDistance) && maxDistance !== undefined && maxDistance > 0
    ? maxDistance
    : DEFAULT_JOYSTICK_MAX_DISTANCE;
}

function clampFinite(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(min, Math.min(max, value));
}

function capturePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // Pointer capture is best effort for test DOM and cancelled browser gestures.
  }
}

function releasePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.releasePointerCapture?.(pointerId);
  } catch {
    // Matching capture may not exist after cancellation.
  }
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/"/g, "\\\"");
}

function styleRoot(root: HTMLDivElement): void {
  root.style.position = "absolute";
  root.style.inset = "0";
  root.style.zIndex = "30";
  root.style.pointerEvents = "none";
  root.style.touchAction = "none";
}

function styleJoystick(joystick: HTMLDivElement): void {
  joystick.style.position = "absolute";
  joystick.style.left = "18px";
  joystick.style.bottom = "18px";
  joystick.style.width = "108px";
  joystick.style.height = "108px";
  joystick.style.borderRadius = "999px";
  joystick.style.border = "1px solid rgba(226, 232, 240, 0.42)";
  joystick.style.background = "rgba(15, 23, 42, 0.42)";
  joystick.style.pointerEvents = "auto";
  joystick.style.touchAction = "none";
}

function styleJoystickKnob(knob: HTMLDivElement): void {
  knob.style.position = "absolute";
  knob.style.left = "34px";
  knob.style.top = "34px";
  knob.style.width = "40px";
  knob.style.height = "40px";
  knob.style.borderRadius = "999px";
  knob.style.background = "rgba(248, 250, 252, 0.76)";
  knob.style.boxShadow = "0 4px 14px rgba(2, 6, 23, 0.32)";
}

function styleButtonGroup(group: HTMLDivElement): void {
  group.style.position = "absolute";
  group.style.right = "18px";
  group.style.bottom = "20px";
  group.style.display = "flex";
  group.style.alignItems = "flex-end";
  group.style.gap = "10px";
  group.style.pointerEvents = "none";
}

function styleButton(button: HTMLButtonElement, id: string): void {
  const primary = id === "primary";
  button.style.width = primary ? "64px" : "56px";
  button.style.height = primary ? "64px" : "44px";
  button.style.borderRadius = "999px";
  button.style.border = "1px solid rgba(226, 232, 240, 0.46)";
  button.style.background = primary ? "rgba(37, 99, 235, 0.72)" : "rgba(15, 23, 42, 0.58)";
  button.style.color = "#f8fafc";
  button.style.font = "600 13px/1 ui-sans-serif, system-ui, sans-serif";
  button.style.pointerEvents = "auto";
  button.style.touchAction = "none";
}
