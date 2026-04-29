export interface Renderer {
  render(): void;
  resize(): void;
  destroy(): void;
}
