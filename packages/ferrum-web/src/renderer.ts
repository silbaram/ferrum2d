export interface RendererStats {
  drawCalls: number;
  batchCount: number;
  spriteCount: number;
}

export interface Renderer {
  render(): void;
  resize(): void;
  stats(): RendererStats;
  destroy(): void;
}
