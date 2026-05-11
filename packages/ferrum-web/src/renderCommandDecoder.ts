export interface RenderCommandView {
  x: number;
  y: number;
  width: number;
  height: number;
  textureId: number;
  uv: [number, number, number, number];
  color: [number, number, number, number];
}

export interface RenderCommandBufferView {
  buffer: Float32Array;
  commandCount: number;
  floatsPerCommand: number;
}

export function decodeRenderCommands(view: RenderCommandBufferView): RenderCommandView[] {
  const commands: RenderCommandView[] = [];
  for (let i = 0; i < view.commandCount; i += 1) {
    const offset = i * view.floatsPerCommand;
    commands.push({
      x: view.buffer[offset],
      y: view.buffer[offset + 1],
      width: view.buffer[offset + 2],
      height: view.buffer[offset + 3],
      uv: [view.buffer[offset + 4], view.buffer[offset + 5], view.buffer[offset + 6], view.buffer[offset + 7]],
      color: [view.buffer[offset + 8], view.buffer[offset + 9], view.buffer[offset + 10], view.buffer[offset + 11]],
      textureId: Math.trunc(view.buffer[offset + 12]),
    });
  }
  return commands;
}
