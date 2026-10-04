import {
  DEFAULT_INPUT_ACTION_PROFILE, INPUT_DIGITAL_CONTROLS, evaluateInputActionState,
  keyboardCode, resolveInputActionProfile,
} from "./inputProfile.js";
import type { InputActionProfile, InputActionState, InputDigitalControl } from "./inputProfile.js";
import type { VirtualControls } from "./virtualControls.js";

export interface InputSnapshot {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  space: boolean;
  enter: boolean;
  mouseLeft: boolean;
  mouseX: number;
  mouseY: number;
}

export interface InputActionSnapshot extends InputActionState {
  /** Legacy input sampled at the same instant; pressedActions retains its held-list meaning. */
  input: InputSnapshot;
  /** Transitions since the previous actionSnapshot(), including short DOM taps. */
  justPressedActions: readonly string[];
  releasedActions: readonly string[];
}

export interface VirtualInputState {
  controls?: Partial<Record<InputDigitalControl, boolean>>;
  buttons?: Readonly<Record<string, boolean>>;
}

export type InputKeyBindings = Partial<Record<InputDigitalControl, readonly string[]>>;

export interface InputManagerOptions {
  /** Starts enabled by default. Disabled input is neutral and does not consume DOM events. */
  enabled?: boolean;
  /** Omitted controls retain their existing keyboard binding; [] disables that binding. */
  keyBindings?: InputKeyBindings;
  /** JSON-friendly named actions and axes; copied and validated before attaching listeners. */
  actionProfile?: InputActionProfile;
  /** Optional externally owned controls, included in snapshots and released on clear. */
  virtualControls?: VirtualControls;
  /** Enables polling of the first connected standard gamepad. Default: true. */
  gamepad?: boolean;
  /** Optional fixed slot; otherwise the first connected gamepad is used. */
  gamepadIndex?: number;
  /** JSON-friendly mapping for gamepad axes and buttons. */
  gamepadMapping?: GamepadInputMapping;
  /** Stick magnitude threshold for digital movement. Default: 0.25. */
  gamepadDeadzone?: number;
  /** Enables touch/pen drag movement. Default: true. */
  pointerGestures?: boolean;
  /** Drag distance in CSS pixels. Default: 18. */
  pointerGestureThreshold?: number;
}

export interface GamepadInputMapping {
  moveXAxis?: number;
  moveYAxis?: number;
  actionButtons?: readonly number[];
  menuButtons?: readonly number[];
  pointerButtons?: readonly number[];
}

interface Point { x: number; y: number }
const DEFAULT_KEYS: Record<InputDigitalControl, readonly string[]> = {
  w: ["KeyW"], a: ["KeyA"], s: ["KeyS"], d: ["KeyD"],
  space: ["Space"], enter: ["Enter"], mouseLeft: [],
};
const DEFAULT_GAMEPAD_MAPPING: Required<GamepadInputMapping> = {
  moveXAxis: 0, moveYAxis: 1, actionButtons: [0], menuButtons: [9], pointerButtons: [5, 7],
};

export class InputManager {
  private readonly keys = new Set<string>();
  private readonly keyBindings: Record<InputDigitalControl, readonly string[]>;
  private readonly managedCodes = new Set<string>();
  private readonly profile: InputActionProfile;
  private readonly virtualSources = new Map<string, VirtualInputState>();
  private virtualButtons: Record<string, boolean> = {};
  private readonly pendingPressed = new Set<string>();
  private readonly pendingReleased = new Set<string>();
  private actionState: InputActionState;
  private isEnabled: boolean;
  private focused = true;
  private destroyed = false;
  private clearing = false;
  private readonly unsubscribeVirtual?: () => void;
  private mouseDown = false;
  private pointerDown = false;
  private touchDown = false;
  private mouseX = 0;
  private mouseY = 0;
  private activePointerId: number | undefined;
  private activePointerType: string | undefined;
  private activePointerOrigin: Point | undefined;
  private activeTouchId: number | undefined;
  private activeTouchOrigin: Point | undefined;
  private gesture = { w: false, a: false, s: false, d: false };
  private readonly gamepadMapping: Required<GamepadInputMapping>;
  private gamepadNeedsNeutral = false;
  private lastGamepad: string | undefined;
  private readonly eventWindow: Window;
  private readonly eventDocument: Document | undefined;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.managedCodes.has(event.code) || this.destroyed) return;
    if (!this.active || isEditableEvent(event)) {
      this.keys.delete(event.code);
      this.sample();
      return;
    }
    event.preventDefault();
    // A non-repeat keydown is a fresh press even if keyup happened outside this window.
    if (event.repeat && !this.keys.has(event.code)) return;
    this.keys.add(event.code);
    this.sample();
  };
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!this.managedCodes.has(event.code) || this.destroyed) return;
    this.keys.delete(event.code);
    if (this.active && !isEditableEvent(event)) event.preventDefault();
    this.sample();
  };
  private readonly onMouseMove = (event: MouseEvent): void => {
    if (this.active) this.updatePosition(event.clientX, event.clientY);
  };
  private readonly onMouseDown = (event: MouseEvent): void => {
    // Pointer events already own their compatibility mouse events.
    if (!this.active || event.button !== 0 || this.activePointerId !== undefined || this.activeTouchId !== undefined) return;
    this.mouseDown = true;
    this.sample();
  };
  private readonly onMouseUp = (event: MouseEvent): void => {
    if (this.destroyed || event.button !== 0) return;
    this.mouseDown = false;
    if (this.activePointerType === "mouse") this.releasePointer();
    this.sample();
  };
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.active || event.isPrimary === false || this.activePointerId !== undefined || this.activeTouchId !== undefined
      || (event.button !== 0 && event.pointerType !== "touch" && event.pointerType !== "pen")) return;
    const position = this.updatePosition(event.clientX, event.clientY);
    this.pointerDown = true;
    this.activePointerId = event.pointerId;
    this.activePointerType = event.pointerType;
    if (this.options.pointerGestures !== false && event.pointerType !== "mouse") this.activePointerOrigin = position;
    try { this.canvas.setPointerCapture?.(event.pointerId); } catch { /* Capture can fail after cancellation. */ }
    event.preventDefault();
    this.sample();
  };
  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.active || event.isPrimary === false) return;
    const position = this.updatePosition(event.clientX, event.clientY);
    // Chord changes use pointermove: releasing the primary button does not
    // produce pointerup until all mouse buttons have been released.
    if (event.pointerId === this.activePointerId && typeof event.buttons === "number"
      && this.activePointerType === "mouse" && (event.buttons & 1) === 0) {
      this.releasePointer();
      this.sample();
      return;
    }
    if (event.pointerId === this.activePointerId && this.activePointerOrigin) {
      this.updateGesture(this.activePointerOrigin, position);
      event.preventDefault();
      this.sample();
    }
  };
  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (this.destroyed || event.pointerId !== this.activePointerId) return;
    this.releasePointer();
    this.sample();
  };
  private readonly onTouchStart = (event: TouchEvent): void => {
    if (!this.active || this.activePointerId !== undefined || this.activeTouchId !== undefined) return;
    const touch = event.changedTouches.item(0);
    if (!touch) return;
    const position = this.updatePosition(touch.clientX, touch.clientY);
    this.touchDown = true;
    this.activeTouchId = touch.identifier;
    if (this.options.pointerGestures !== false) this.activeTouchOrigin = position;
    event.preventDefault();
    this.sample();
  };
  private readonly onTouchMove = (event: TouchEvent): void => {
    if (!this.active || this.activeTouchId === undefined) return;
    const touch = findTouch(event.changedTouches, this.activeTouchId);
    if (!touch) return;
    const position = this.updatePosition(touch.clientX, touch.clientY);
    if (this.activeTouchOrigin) this.updateGesture(this.activeTouchOrigin, position);
    event.preventDefault();
    this.sample();
  };
  private readonly onTouchEnd = (event: TouchEvent): void => {
    if (this.destroyed || this.activeTouchId === undefined || !findTouch(event.changedTouches, this.activeTouchId)) return;
    this.releaseTouch();
    this.sample();
  };
  private readonly onBlur = (): void => { this.focused = false; this.clear(); };
  private readonly onFocus = (): void => { this.focused = true; this.clear(); };
  private readonly onVisibility = (): void => { this.clear(); };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly options: InputManagerOptions = {}) {
    this.options = { ...options };
    this.keyBindings = resolveKeyBindings(options.keyBindings);
    this.profile = resolveInputActionProfile(options.actionProfile === undefined ? DEFAULT_INPUT_ACTION_PROFILE : options.actionProfile);
    if (options.enabled !== undefined && typeof options.enabled !== "boolean") throw new Error("input.enabled must be a boolean.");
    this.isEnabled = options.enabled !== false;
    this.gamepadMapping = resolveGamepadMapping(options.gamepadMapping);
    for (const codes of Object.values(this.keyBindings)) for (const code of codes) this.managedCodes.add(code);
    for (const bindings of Object.values(this.profile.actions)) for (const binding of bindings) {
      if (binding.code !== undefined) this.managedCodes.add(binding.code);
    }
    this.actionState = evaluateInputActionState(emptyInputSnapshot(0, 0), this.profile);
    this.eventDocument = canvas.ownerDocument ?? (typeof document === "undefined" ? undefined : document);
    this.eventWindow = this.eventDocument?.defaultView ?? window;
    this.focused = this.eventDocument?.hasFocus?.() ?? true;
    this.unsubscribeVirtual = options.virtualControls?.subscribe(() => {
      if (!this.clearing && !this.destroyed) this.sample();
    });
    this.eventWindow.addEventListener("keydown", this.onKeyDown);
    this.eventWindow.addEventListener("keyup", this.onKeyUp);
    this.eventWindow.addEventListener("blur", this.onBlur);
    this.eventWindow.addEventListener("focus", this.onFocus);
    this.eventDocument?.addEventListener("visibilitychange", this.onVisibility);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mousedown", this.onMouseDown);
    this.eventWindow.addEventListener("mouseup", this.onMouseUp);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("lostpointercapture", this.onPointerEnd);
    this.eventWindow.addEventListener("pointerup", this.onPointerEnd);
    this.eventWindow.addEventListener("pointercancel", this.onPointerEnd);
    canvas.addEventListener("touchstart", this.onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", this.onTouchMove, { passive: false });
    this.eventWindow.addEventListener("touchend", this.onTouchEnd);
    this.eventWindow.addEventListener("touchcancel", this.onTouchEnd);
  }

  get enabled(): boolean { return this.isEnabled && !this.destroyed; }
  private get active(): boolean { return this.enabled && !this.clearing && this.focused && this.eventDocument?.hidden !== true; }

  /** Legacy snapshot does not consume action edges. Coordinates remain canvas-local CSS pixels. */
  snapshot(): InputSnapshot { return this.sample(); }

  /** Call once per application input update; subsequent calls consume no previous edges. */
  actionSnapshot(): InputActionSnapshot {
    const input = this.sample();
    const result = {
      input, actions: { ...this.actionState.actions }, axes: { ...this.actionState.axes },
      pressedActions: [...this.actionState.pressedActions],
      justPressedActions: [...this.pendingPressed], releasedActions: [...this.pendingReleased],
    };
    this.pendingPressed.clear();
    this.pendingReleased.clear();
    return result;
  }

  /** A single gameplay input gate. UI can handle DOM input while this manager is disabled. */
  setEnabled(enabled: boolean): void {
    this.assertAlive();
    if (typeof enabled !== "boolean") throw new Error("input.enabled must be a boolean.");
    if (this.isEnabled === enabled) return;
    this.isEnabled = enabled;
    this.clear();
  }

  /** Cancel held input and pending edges without synthesizing release events. */
  clear(): void {
    if (!this.destroyed) this.resetInput();
  }

  private resetInput(): void {
    if (this.clearing) return;
    this.clearing = true;
    try {
      this.keys.clear();
      this.mouseDown = false;
      this.releasePointer();
      this.releaseTouch();
      this.virtualSources.clear();
      this.virtualButtons = {};
      this.gamepadNeedsNeutral = true;
      this.pendingPressed.clear();
      this.pendingReleased.clear();
      this.actionState = evaluateInputActionState(emptyInputSnapshot(this.mouseX, this.mouseY), this.profile);
      this.options.virtualControls?.releaseAll();
    } finally {
      this.clearing = false;
    }
  }

  /** Replace one virtual source's state; omitting state removes only that source. */
  setVirtualInput(sourceId: string, state?: VirtualInputState): void {
    this.assertAlive();
    if (typeof sourceId !== "string" || sourceId.trim().length === 0) throw new Error("input source id must be non-empty.");
    const resolved = state === undefined ? undefined : resolveVirtualInput(state);
    if (resolved === undefined || !this.active) this.virtualSources.delete(sourceId);
    else this.virtualSources.set(sourceId, resolved);
    this.sample();
  }

  destroy(): void {
    if (this.destroyed) return;
    // Mark destroyed before notifying external controls so callbacks cannot
    // create fresh input while this manager is being disposed.
    this.destroyed = true;
    try {
      this.resetInput();
    } finally {
      this.unsubscribeVirtual?.();
      this.eventWindow.removeEventListener("keydown", this.onKeyDown);
      this.eventWindow.removeEventListener("keyup", this.onKeyUp);
      this.eventWindow.removeEventListener("blur", this.onBlur);
      this.eventWindow.removeEventListener("focus", this.onFocus);
      this.eventDocument?.removeEventListener("visibilitychange", this.onVisibility);
      this.canvas.removeEventListener("mousemove", this.onMouseMove);
      this.canvas.removeEventListener("mousedown", this.onMouseDown);
      this.eventWindow.removeEventListener("mouseup", this.onMouseUp);
      this.canvas.removeEventListener("pointerdown", this.onPointerDown);
      this.canvas.removeEventListener("pointermove", this.onPointerMove);
      this.canvas.removeEventListener("lostpointercapture", this.onPointerEnd);
      this.eventWindow.removeEventListener("pointerup", this.onPointerEnd);
      this.eventWindow.removeEventListener("pointercancel", this.onPointerEnd);
      this.canvas.removeEventListener("touchstart", this.onTouchStart);
      this.canvas.removeEventListener("touchmove", this.onTouchMove);
      this.eventWindow.removeEventListener("touchend", this.onTouchEnd);
      this.eventWindow.removeEventListener("touchcancel", this.onTouchEnd);
    }
  }

  private sample(): InputSnapshot {
    const input = this.readSnapshot();
    const next = evaluateInputActionState(input, this.profile, {
      keys: this.active ? this.keys : undefined, virtualButtons: this.virtualButtons,
    });
    for (const [action, held] of Object.entries(next.actions)) {
      if (held && !this.actionState.actions[action]) this.pendingPressed.add(action);
      if (!held && this.actionState.actions[action]) this.pendingReleased.add(action);
    }
    this.actionState = next;
    return input;
  }

  private readSnapshot(): InputSnapshot {
    this.virtualButtons = {};
    if (!this.active) return emptyInputSnapshot(this.mouseX, this.mouseY);
    let input = this.readGamepad();
    for (const control of INPUT_DIGITAL_CONTROLS) input[control] ||= this.keyBindings[control].some((code) => this.keys.has(code));
    for (const control of ["w", "a", "s", "d"] as const) input[control] ||= this.gesture[control];
    input.mouseLeft ||= this.mouseDown || this.pointerDown || this.touchDown;
    if (this.options.virtualControls) {
      input = this.options.virtualControls.applyToSnapshot(input);
      this.virtualButtons = { ...this.options.virtualControls.virtualButtons() };
    }
    const buttonEntries = Object.entries(this.virtualButtons);
    for (const source of this.virtualSources.values()) {
      for (const control of INPUT_DIGITAL_CONTROLS) input[control] ||= source.controls?.[control] === true;
      for (const [button, held] of Object.entries(source.buttons ?? {})) if (held) buttonEntries.push([button, true]);
    }
    this.virtualButtons = Object.fromEntries(buttonEntries);
    return input;
  }

  private updatePosition(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = clientX - rect.left;
    this.mouseY = clientY - rect.top;
    return { x: this.mouseX, y: this.mouseY };
  }

  private updateGesture(origin: Point, position: Point): void {
    const configured = this.options.pointerGestureThreshold ?? 18;
    const threshold = Number.isFinite(configured) && configured >= 0 ? configured : 18;
    this.gesture = {
      w: position.y - origin.y < -threshold, a: position.x - origin.x < -threshold,
      s: position.y - origin.y > threshold, d: position.x - origin.x > threshold,
    };
  }

  private releasePointer(): void {
    const id = this.activePointerId;
    this.activePointerId = undefined;
    this.activePointerType = undefined;
    this.activePointerOrigin = undefined;
    this.pointerDown = false;
    if (this.activeTouchId === undefined) this.gesture = { w: false, a: false, s: false, d: false };
    if (id !== undefined) try { this.canvas.releasePointerCapture?.(id); } catch { /* Capture may already be lost. */ }
  }

  private releaseTouch(): void {
    this.activeTouchId = undefined;
    this.activeTouchOrigin = undefined;
    this.touchDown = false;
    if (this.activePointerId === undefined) this.gesture = { w: false, a: false, s: false, d: false };
  }

  private readGamepad(): InputSnapshot {
    const input = emptyInputSnapshot(this.mouseX, this.mouseY);
    const source = this.eventWindow.navigator ?? (typeof navigator === "undefined" ? undefined : navigator);
    if (this.options.gamepad === false || typeof source?.getGamepads !== "function") return input;
    let pads: (Gamepad | null)[];
    try { pads = source.getGamepads(); } catch { return input; }
    const pad = this.options.gamepadIndex === undefined
      ? pads.find((item) => item?.connected === true) : pads[this.options.gamepadIndex];
    if (!pad?.connected) {
      if (this.lastGamepad !== undefined) this.gamepadNeedsNeutral = true;
      this.lastGamepad = undefined;
      return input;
    }
    const id = `${pad.index}:${pad.id}`;
    if (this.lastGamepad !== undefined && this.lastGamepad !== id) this.gamepadNeedsNeutral = true;
    this.lastGamepad = id;
    const configured = this.options.gamepadDeadzone ?? 0.25;
    const deadzone = Number.isFinite(configured) ? Math.min(Math.max(configured, 0), 1) : 0.25;
    const mapping = this.gamepadMapping;
    const x = pad.axes[mapping.moveXAxis] ?? 0, y = pad.axes[mapping.moveYAxis] ?? 0;
    const pressed = (indices: readonly number[]): boolean => indices.some((index) => pad.buttons[index]?.pressed === true || (pad.buttons[index]?.value ?? 0) > 0.5);
    input.w = y < -deadzone; input.a = x < -deadzone;
    input.s = y > deadzone; input.d = x > deadzone;
    input.space = pressed(mapping.actionButtons); input.enter = pressed(mapping.menuButtons);
    input.mouseLeft = pressed(mapping.pointerButtons);
    if (this.gamepadNeedsNeutral) {
      if (INPUT_DIGITAL_CONTROLS.every((control) => !input[control])) this.gamepadNeedsNeutral = false;
      return emptyInputSnapshot(this.mouseX, this.mouseY);
    }
    return input;
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error("InputManager has been destroyed.");
  }
}

function emptyInputSnapshot(mouseX: number, mouseY: number): InputSnapshot {
  return { w: false, a: false, s: false, d: false, space: false, enter: false, mouseLeft: false, mouseX, mouseY };
}

function resolveKeyBindings(bindings: InputKeyBindings = {}): Record<InputDigitalControl, readonly string[]> {
  if (typeof bindings !== "object" || bindings === null || Array.isArray(bindings)) throw new Error("input.keyBindings must be an object.");
  for (const name of Object.keys(bindings)) if (!INPUT_DIGITAL_CONTROLS.some((control) => control === name)) throw new Error(`input.keyBindings contains unknown control '${name}'.`);
  const result = { ...DEFAULT_KEYS };
  for (const control of INPUT_DIGITAL_CONTROLS) {
    const codes = bindings[control] === undefined ? DEFAULT_KEYS[control] : bindings[control];
    if (!Array.isArray(codes)) throw new Error(`input.keyBindings.${control} must be an array.`);
    result[control] = Array.from(codes, (code, index) => keyboardCode(code, `input.keyBindings.${control}.${index}`));
  }
  return result;
}

function resolveVirtualInput(state: VirtualInputState): VirtualInputState {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("virtual input must be an object.");
  const copy = (values: Readonly<Record<string, boolean>> | undefined, controls: boolean): Record<string, boolean> => {
    if (values === undefined) return {};
    if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("virtual input values must be an object.");
    return Object.fromEntries(Object.entries(values).map(([id, held]) => {
      if (id.trim().length === 0 || typeof held !== "boolean" || (controls && !INPUT_DIGITAL_CONTROLS.some((control) => control === id))) {
        throw new Error(`Invalid virtual input '${id}'.`);
      }
      return [id, held];
    }));
  };
  return { controls: copy(state.controls, true), buttons: copy(state.buttons, false) };
}

function resolveGamepadMapping(mapping: GamepadInputMapping = {}): Required<GamepadInputMapping> {
  const axis = (value: number | undefined, fallback: number): number => value !== undefined && Number.isInteger(value) && value >= 0 ? value : fallback;
  const buttons = (values: readonly number[] | undefined, fallback: readonly number[]): readonly number[] => {
    const valid = values?.filter((value) => Number.isInteger(value) && value >= 0);
    return valid?.length ? valid : [...fallback];
  };
  return {
    moveXAxis: axis(mapping.moveXAxis, 0), moveYAxis: axis(mapping.moveYAxis, 1),
    actionButtons: buttons(mapping.actionButtons, DEFAULT_GAMEPAD_MAPPING.actionButtons),
    menuButtons: buttons(mapping.menuButtons, DEFAULT_GAMEPAD_MAPPING.menuButtons),
    pointerButtons: buttons(mapping.pointerButtons, DEFAULT_GAMEPAD_MAPPING.pointerButtons),
  };
}

function findTouch(touches: TouchList, identifier: number): Touch | undefined {
  for (let index = 0; index < touches.length; index++) {
    const touch = touches.item(index);
    if (touch?.identifier === identifier) return touch;
  }
  return undefined;
}

function isEditableEvent(event: KeyboardEvent): boolean {
  // Open shadow roots retarget event.target to their host. The composed path
  // retains the actual focused element without cross-window instanceof checks.
  const target = (event.composedPath?.()[0] ?? event.target) as HTMLElement | null;
  return typeof target?.closest === "function"
    && (target.isContentEditable === true || target.closest("input,textarea,select,button") !== null);
}
