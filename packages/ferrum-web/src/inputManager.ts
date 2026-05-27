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

export interface InputManagerOptions {
  /** Enables polling of the first connected standard gamepad. Default: true. */
  gamepad?: boolean;
  /** Optional fixed gamepad slot. When omitted, the first connected gamepad is used. */
  gamepadIndex?: number;
  /** JSON-friendly mapping for standard gamepad axes and buttons. */
  gamepadMapping?: GamepadInputMapping;
  /** Axis magnitude required before stick input maps to WASD. Default: 0.25. */
  gamepadDeadzone?: number;
  /** Enables touch/pen drag gestures that map to WASD. Default: true. */
  pointerGestures?: boolean;
  /** Drag distance in CSS pixels before a pointer gesture maps to movement. Default: 18. */
  pointerGestureThreshold?: number;
}

export interface GamepadInputMapping {
  moveXAxis?: number;
  moveYAxis?: number;
  actionButtons?: readonly number[];
  menuButtons?: readonly number[];
  pointerButtons?: readonly number[];
}

interface DirectionState {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
}

interface Point {
  x: number;
  y: number;
}

const DEFAULT_GAMEPAD_DEADZONE = 0.25;
const DEFAULT_POINTER_GESTURE_THRESHOLD = 18;
const DEFAULT_GAMEPAD_MAPPING: Required<GamepadInputMapping> = {
  moveXAxis: 0,
  moveYAxis: 1,
  actionButtons: [0],
  menuButtons: [9],
  pointerButtons: [5, 7],
};

export class InputManager {
  private state: InputSnapshot = {
    w: false, a: false, s: false, d: false, space: false,
    enter: false,
    mouseLeft: false, mouseX: 0, mouseY: 0,
  };
  private pointerGesture: DirectionState = { w: false, a: false, s: false, d: false };
  private activePointerId: number | undefined;
  private activePointerOrigin: Point | undefined;
  private activeTouchId: number | undefined;
  private activeTouchOrigin: Point | undefined;
  private destroyed = false;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.destroyed) this.setKey(e, true);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (!this.destroyed) this.setKey(e, false);
  };
  private readonly onMouseMove = (e: MouseEvent): void => {
    if (this.destroyed) return;
    const rect = this.canvas.getBoundingClientRect();
    this.state.mouseX = e.clientX - rect.left;
    this.state.mouseY = e.clientY - rect.top;
  };
  private readonly onMouseDown = (e: MouseEvent): void => {
    if (!this.destroyed && e.button === 0) this.state.mouseLeft = true;
  };
  private readonly onMouseUp = (e: MouseEvent): void => {
    if (!this.destroyed && e.button === 0) this.state.mouseLeft = false;
  };
  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.destroyed || !this.isPrimaryPointer(e) || !this.isPrimaryButton(e)) {
      return;
    }
    const position = this.updatePointerPosition(e.clientX, e.clientY);
    this.state.mouseLeft = true;
    this.activePointerId = e.pointerId;
    if (this.shouldUsePointerGesture(e.pointerType)) {
      this.activePointerOrigin = position;
      this.updatePointerGesture(position, position);
    }
    this.capturePointer(e.pointerId);
    e.preventDefault();
  };
  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.destroyed || !this.isPrimaryPointer(e)) {
      return;
    }
    const position = this.updatePointerPosition(e.clientX, e.clientY);
    if (e.pointerId === this.activePointerId && this.activePointerOrigin) {
      this.updatePointerGesture(this.activePointerOrigin, position);
      e.preventDefault();
    }
  };
  private readonly onPointerUp = (e: PointerEvent): void => {
    if (!this.destroyed) {
      this.releasePointer(e.pointerId);
    }
  };
  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (!this.destroyed) {
      this.releasePointer(e.pointerId);
    }
  };
  private readonly onTouchStart = (e: TouchEvent): void => {
    if (this.destroyed || this.activePointerId !== undefined || this.activeTouchId !== undefined) {
      return;
    }
    const touch = e.changedTouches.item(0);
    if (!touch) {
      return;
    }
    const position = this.updatePointerPosition(touch.clientX, touch.clientY);
    this.state.mouseLeft = true;
    this.activeTouchId = touch.identifier;
    this.activeTouchOrigin = position;
    this.updatePointerGesture(position, position);
    e.preventDefault();
  };
  private readonly onTouchMove = (e: TouchEvent): void => {
    if (this.destroyed || this.activePointerId !== undefined || this.activeTouchId === undefined || !this.activeTouchOrigin) {
      return;
    }
    const touch = this.findTouch(e.changedTouches, this.activeTouchId);
    if (!touch) {
      return;
    }
    const position = this.updatePointerPosition(touch.clientX, touch.clientY);
    this.updatePointerGesture(this.activeTouchOrigin, position);
    e.preventDefault();
  };
  private readonly onTouchEnd = (e: TouchEvent): void => {
    if (!this.destroyed) {
      this.releaseTouch(e.changedTouches);
    }
  };
  private readonly onTouchCancel = (e: TouchEvent): void => {
    if (!this.destroyed) {
      this.releaseTouch(e.changedTouches);
    }
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: InputManagerOptions = {},
  ) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerCancel);
    canvas.addEventListener("touchstart", this.onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", this.onTouchMove, { passive: false });
    window.addEventListener("touchend", this.onTouchEnd);
    window.addEventListener("touchcancel", this.onTouchCancel);
  }

  snapshot(): InputSnapshot {
    const gamepad = this.readGamepadState();
    return {
      w: this.state.w || this.pointerGesture.w || gamepad.w,
      a: this.state.a || this.pointerGesture.a || gamepad.a,
      s: this.state.s || this.pointerGesture.s || gamepad.s,
      d: this.state.d || this.pointerGesture.d || gamepad.d,
      space: this.state.space || gamepad.space,
      enter: this.state.enter || gamepad.enter,
      mouseLeft: this.state.mouseLeft || gamepad.mouseLeft,
      mouseX: this.state.mouseX,
      mouseY: this.state.mouseY,
    };
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("touchstart", this.onTouchStart);
    this.canvas.removeEventListener("touchmove", this.onTouchMove);
    window.removeEventListener("touchend", this.onTouchEnd);
    window.removeEventListener("touchcancel", this.onTouchCancel);
  }

  private setKey(event: KeyboardEvent, pressed: boolean): void {
    if (event.code === "KeyW") this.state.w = pressed;
    else if (event.code === "KeyA") this.state.a = pressed;
    else if (event.code === "KeyS") this.state.s = pressed;
    else if (event.code === "KeyD") this.state.d = pressed;
    else if (event.code === "Space") this.state.space = pressed;
    else if (event.code === "Enter") this.state.enter = pressed;
    else return;

    event.preventDefault();
  }

  private updatePointerPosition(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    const position = {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
    this.state.mouseX = position.x;
    this.state.mouseY = position.y;
    return position;
  }

  private shouldUsePointerGesture(pointerType: string): boolean {
    return this.options.pointerGestures !== false && pointerType !== "mouse";
  }

  private updatePointerGesture(origin: Point, position: Point): void {
    const threshold = this.pointerGestureThreshold();
    const dx = position.x - origin.x;
    const dy = position.y - origin.y;
    this.pointerGesture = {
      w: dy < -threshold,
      a: dx < -threshold,
      s: dy > threshold,
      d: dx > threshold,
    };
  }

  private clearPointerGesture(): void {
    this.pointerGesture = { w: false, a: false, s: false, d: false };
  }

  private pointerGestureThreshold(): number {
    const threshold = this.options.pointerGestureThreshold ?? DEFAULT_POINTER_GESTURE_THRESHOLD;
    return Number.isFinite(threshold) && threshold >= 0 ? threshold : DEFAULT_POINTER_GESTURE_THRESHOLD;
  }

  private isPrimaryPointer(event: PointerEvent): boolean {
    return event.isPrimary !== false;
  }

  private isPrimaryButton(event: PointerEvent): boolean {
    return event.button === 0 || event.pointerType === "touch" || event.pointerType === "pen";
  }

  private capturePointer(pointerId: number): void {
    try {
      this.canvas.setPointerCapture?.(pointerId);
    } catch {
      // Pointer capture can fail after cancellation; input state still remains valid.
    }
  }

  private releasePointer(pointerId: number): void {
    if (pointerId !== this.activePointerId) {
      return;
    }
    this.state.mouseLeft = false;
    this.activePointerId = undefined;
    this.activePointerOrigin = undefined;
    this.clearPointerGesture();
    try {
      this.canvas.releasePointerCapture?.(pointerId);
    } catch {
      // Matching capture may not exist in tests or after browser cancellation.
    }
  }

  private findTouch(touches: TouchList, identifier: number): Touch | undefined {
    for (let index = 0; index < touches.length; index += 1) {
      const touch = touches.item(index);
      if (touch?.identifier === identifier) {
        return touch;
      }
    }
    return undefined;
  }

  private releaseTouch(touches: TouchList): void {
    if (this.activeTouchId === undefined || !this.findTouch(touches, this.activeTouchId)) {
      return;
    }
    this.state.mouseLeft = false;
    this.activeTouchId = undefined;
    this.activeTouchOrigin = undefined;
    this.clearPointerGesture();
  }

  private readGamepadState(): InputSnapshot {
    if (this.options.gamepad === false || typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
      return emptyInputSnapshot(this.state.mouseX, this.state.mouseY);
    }
    const gamepads = navigator.getGamepads();
    const gamepad = this.selectGamepad(gamepads);
    if (!gamepad) {
      return emptyInputSnapshot(this.state.mouseX, this.state.mouseY);
    }
    const deadzone = this.gamepadDeadzone();
    const mapping = this.gamepadMapping();
    const axisX = gamepad.axes[mapping.moveXAxis] ?? 0;
    const axisY = gamepad.axes[mapping.moveYAxis] ?? 0;
    return {
      w: axisY < -deadzone,
      a: axisX < -deadzone,
      s: axisY > deadzone,
      d: axisX > deadzone,
      space: this.isAnyGamepadButtonPressed(gamepad, mapping.actionButtons),
      enter: this.isAnyGamepadButtonPressed(gamepad, mapping.menuButtons),
      mouseLeft: this.isAnyGamepadButtonPressed(gamepad, mapping.pointerButtons),
      mouseX: this.state.mouseX,
      mouseY: this.state.mouseY,
    };
  }

  private selectGamepad(gamepads: readonly (Gamepad | null)[]): Gamepad | undefined {
    if (this.options.gamepadIndex !== undefined) {
      const gamepad = gamepads[this.options.gamepadIndex];
      return gamepad?.connected === true ? gamepad : undefined;
    }
    return gamepads.find((gamepad): gamepad is Gamepad => gamepad?.connected === true);
  }

  private gamepadDeadzone(): number {
    const deadzone = this.options.gamepadDeadzone ?? DEFAULT_GAMEPAD_DEADZONE;
    return Number.isFinite(deadzone) ? Math.min(Math.max(deadzone, 0), 1) : DEFAULT_GAMEPAD_DEADZONE;
  }

  private gamepadMapping(): Required<GamepadInputMapping> {
    const mapping = this.options.gamepadMapping ?? {};
    return {
      moveXAxis: gamepadAxisIndex(mapping.moveXAxis, DEFAULT_GAMEPAD_MAPPING.moveXAxis),
      moveYAxis: gamepadAxisIndex(mapping.moveYAxis, DEFAULT_GAMEPAD_MAPPING.moveYAxis),
      actionButtons: gamepadButtonIndices(mapping.actionButtons, DEFAULT_GAMEPAD_MAPPING.actionButtons),
      menuButtons: gamepadButtonIndices(mapping.menuButtons, DEFAULT_GAMEPAD_MAPPING.menuButtons),
      pointerButtons: gamepadButtonIndices(mapping.pointerButtons, DEFAULT_GAMEPAD_MAPPING.pointerButtons),
    };
  }

  private isAnyGamepadButtonPressed(gamepad: Gamepad, indices: readonly number[]): boolean {
    return indices.some((index) => this.isGamepadButtonPressed(gamepad.buttons[index]));
  }

  private isGamepadButtonPressed(button: GamepadButton | undefined): boolean {
    return button?.pressed === true || (button?.value ?? 0) > 0.5;
  }
}

function gamepadAxisIndex(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function gamepadButtonIndices(values: readonly number[] | undefined, fallback: readonly number[]): readonly number[] {
  if (values === undefined) {
    return fallback;
  }
  const valid = values.filter((value) => Number.isInteger(value) && value >= 0);
  return valid.length === 0 ? fallback : valid;
}

function emptyInputSnapshot(mouseX: number, mouseY: number): InputSnapshot {
  return {
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
    enter: false,
    mouseLeft: false,
    mouseX,
    mouseY,
  };
}
