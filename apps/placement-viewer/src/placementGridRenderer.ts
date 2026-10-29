import {
  WebGL2Renderer,
  type RenderCommandBufferView,
  type RendererStats,
} from "@ferrum2d/ferrum-web/core";
import type { PlacementGrid } from "./placementGrid";
/** App-only preview adapter. Existing bulk line formats and GPU ownership remain unchanged. */
export class PlacementGridRenderer extends WebGL2Renderer {
  grid?: PlacementGrid;
  measureGpuTiming = false;
  private flatGridCalls = 0;
  private merged = new Float32Array(0);
  constructor(private readonly gridCanvas: HTMLCanvasElement) {
    super(gridCanvas, {
      clearColor: [0.06, 0.08, 0.075, 1],
      preserveDrawingBuffer: true,
      gpuTiming: true,
    });
  }
  override render() {
    this.flatGridCalls = 0;
    super.render();
  }
  override beginGpuTiming() { if (this.measureGpuTiming) super.beginGpuTiming(); }
  override endGpuTiming() { super.endGpuTiming(); }
  override gpuTimingStats() {
    const stats = super.gpuTimingStats();
    return this.measureGpuTiming ? stats : { status: "disabled" as const, pendingQueryCount: stats.pendingQueryCount };
  }
  override stats(): RendererStats {
    const stats = super.stats();
    stats.drawCalls += this.flatGridCalls;
    return stats;
  }
  override renderCommands(commands: RenderCommandBufferView): RendererStats;
  override renderCommands(
    texture: WebGLTexture,
    commands: RenderCommandBufferView,
  ): RendererStats;
  override renderCommands(
    first: RenderCommandBufferView | WebGLTexture,
    second?: RenderCommandBufferView,
  ): RendererStats {
    // The overload with a second argument always carries a texture in its first argument.
    let commands = second ?? (first as RenderCommandBufferView);
    if (commands.spatial) {
      const spatial = commands.spatial,
        presentation = spatial.presentation,
        width =
          this.gridCanvas.clientWidth *
          (presentation && presentation[4] > 0 ? presentation[2] : 1),
        height =
          this.gridCanvas.clientHeight *
          (presentation && presentation[4] > 0 ? presentation[3] : 1),
        grid = this.grid?.spatial(spatial.camera, width, height),
        native = spatial.debug;
      if (grid?.lineCount && (!native || native.depthTest)) {
        const nativeFloats = native?.vertices.length ?? 0,
          available = Math.max(0, 32768 * 11 - nativeFloats),
          added = grid.vertices.subarray(
            0,
            Math.min(grid.vertices.length, Math.floor(available / 22) * 22),
          ),
          length = nativeFloats + added.length;
        this.grid?.submitted(added.length / 22);
        if (this.merged.length < length)
          this.merged = new Float32Array(
            Math.min(
              32768 * 11,
              Math.max(length, this.merged.length * 2, 11264),
            ),
          );
        if (native) this.merged.set(native.vertices);
        this.merged.set(added, nativeFloats);
        commands = {
          ...commands,
          spatial: {
            ...spatial,
            debug: {
              version: 1,
              vertexStride: 11,
              vertices: this.merged.subarray(0, length),
              vertexCount: length / 11,
              depthTest: true,
              truncated: !!native?.truncated,
            },
          },
        };
      } else if (grid?.lineCount) this.grid?.hidden();
    } else {
      if (commands.groundYScale !== undefined)
        this.setGroundYScale(commands.groundYScale);
      const grid = this.grid?.flat();
      if (grid?.lines.lineCount) {
        super.renderPhysicsDebugLines(
          {
            buffer: grid.lines.buffer,
            lineCount: grid.lines.lineCount,
            floatsPerLine: 8,
          },
          grid.camera,
        );
        this.flatGridCalls = 1;
      }
    }
    return second
      ? super.renderCommands(first as WebGLTexture, commands)
      : super.renderCommands(commands);
  }
  override destroy() {
    this.grid?.dispose();
    this.grid = undefined;
    this.merged = new Float32Array(0);
    super.destroy();
  }
}
