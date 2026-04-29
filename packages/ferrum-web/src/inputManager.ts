export interface InputSnapshot {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  space: boolean;
  mouseLeft: boolean;
  mouseX: number;
  mouseY: number;
}

export class InputManager {
  private state: InputSnapshot = {
    w: false, a: false, s: false, d: false, space: false,
    mouseLeft: false, mouseX: 0, mouseY: 0,
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => this.setKey(e.code, true);
  private readonly onKeyUp = (e: KeyboardEvent): void => this.setKey(e.code, false);
  private readonly onMouseMove = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.state.mouseX = e.clientX - rect.left;
    this.state.mouseY = e.clientY - rect.top;
  };
  private readonly onMouseDown = (e: MouseEvent): void => { if (e.button === 0) this.state.mouseLeft = true; };
  private readonly onMouseUp = (e: MouseEvent): void => { if (e.button === 0) this.state.mouseLeft = false; };

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
  }

  snapshot(): InputSnapshot { return { ...this.state }; }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
  }

  private setKey(code: string, pressed: boolean): void {
    if (code === "KeyW") this.state.w = pressed;
    else if (code === "KeyA") this.state.a = pressed;
    else if (code === "KeyS") this.state.s = pressed;
    else if (code === "KeyD") this.state.d = pressed;
    else if (code === "Space") this.state.space = pressed;
  }
}
