import type { PhysicsDebugLineBufferView } from "./physicsDebugLineDecoder.js";
import type { PhysicsDebugLineCamera } from "./physicsDebugLineBatch.js";

const FLOATS_PER_DEBUG_VERTEX = 6;
const BYTES_PER_F32 = Float32Array.BYTES_PER_ELEMENT;
const DEBUG_VERTEX_STRIDE_BYTES = FLOATS_PER_DEBUG_VERTEX * BYTES_PER_F32;
const MIN_DEBUG_LINE_BUFFER_BYTES = DEBUG_VERTEX_STRIDE_BYTES * 2;

export class WebGpuDebugLinePass {
  private readonly pipelineLayout: GPUPipelineLayout;
  private readonly pipeline: GPURenderPipeline;
  private vertexBuffer: GPUBuffer;
  private vertexCapacityBytes = MIN_DEBUG_LINE_BUFFER_BYTES;
  private staging = new Float32Array(0);
  private destroyed = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
    pipelineLayout: GPUPipelineLayout,
    private readonly resolutionBindGroup: GPUBindGroup,
  ) {
    this.pipelineLayout = pipelineLayout;
    this.vertexBuffer = this.device.createBuffer({
      size: MIN_DEBUG_LINE_BUFFER_BYTES,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.pipeline = this.createPipeline();
  }

  draw(
    lines: PhysicsDebugLineBufferView,
    camera: PhysicsDebugLineCamera,
    viewportWidth: number,
    viewportHeight: number,
  ): number {
    this.assertAlive();
    if (lines.lineCount === 0) {
      return 0;
    }

    const vertexCount = lines.lineCount * 2;
    const floatCount = vertexCount * FLOATS_PER_DEBUG_VERTEX;
    const byteCount = floatCount * BYTES_PER_F32;
    this.ensureStaging(floatCount);
    this.writeStaging(lines, camera, viewportWidth, viewportHeight);
    this.ensureVertexCapacity(byteCount);
    this.device.queue.writeBuffer(
      this.vertexBuffer,
      0,
      this.staging.buffer,
      this.staging.byteOffset,
      byteCount,
    );

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        loadOp: "load",
        storeOp: "store",
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.resolutionBindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.draw(vertexCount, 1, 0, 0);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    return 1;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.vertexBuffer.destroy();
    this.vertexCapacityBytes = 0;
    this.staging = new Float32Array(0);
  }

  private createPipeline(): GPURenderPipeline {
    const module = this.device.createShaderModule({
      code: `
        struct Resolution {
          size: vec2f,
        };
        @group(0) @binding(0) var<uniform> resolution: Resolution;

        struct VertexInput {
          @location(0) position: vec2f,
          @location(1) color: vec4f,
        };

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) color: vec4f,
        };

        @vertex
        fn vs_main(input: VertexInput) -> VertexOutput {
          let zeroToOne = input.position / resolution.size;
          let clip = zeroToOne * 2.0 - vec2f(1.0, 1.0);
          var output: VertexOutput;
          output.position = vec4f(clip * vec2f(1.0, -1.0), 0.0, 1.0);
          output.color = input.color;
          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4f {
          return input.color;
        }
      `,
    });

    return this.device.createRenderPipeline({
      layout: this.pipelineLayout,
      vertex: {
        module,
        entryPoint: "vs_main",
        buffers: [{
          arrayStride: DEBUG_VERTEX_STRIDE_BYTES,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 2 * BYTES_PER_F32, format: "float32x4" },
          ],
        }],
      },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{
          format: this.format,
          blend: {
            color: {
              srcFactor: "src-alpha",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
          },
        }],
      },
      primitive: { topology: "line-list" },
    });
  }

  private writeStaging(
    lines: PhysicsDebugLineBufferView,
    camera: PhysicsDebugLineCamera,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const originX = viewportWidth * 0.5 - camera.x;
    const originY = viewportHeight * 0.5 - camera.y;
    let vertexOffset = 0;
    for (let lineIndex = 0; lineIndex < lines.lineCount; lineIndex += 1) {
      const lineOffset = lineIndex * lines.floatsPerLine;
      const x0 = lines.buffer[lineOffset] + originX;
      const y0 = lines.buffer[lineOffset + 1] + originY;
      const x1 = lines.buffer[lineOffset + 2] + originX;
      const y1 = lines.buffer[lineOffset + 3] + originY;
      const r = lines.buffer[lineOffset + 4];
      const g = lines.buffer[lineOffset + 5];
      const b = lines.buffer[lineOffset + 6];
      const a = lines.buffer[lineOffset + 7];
      vertexOffset = writeDebugVertex(this.staging, vertexOffset, x0, y0, r, g, b, a);
      vertexOffset = writeDebugVertex(this.staging, vertexOffset, x1, y1, r, g, b, a);
    }
  }

  private ensureVertexCapacity(byteCount: number): void {
    if (this.vertexCapacityBytes >= byteCount) {
      return;
    }
    const nextSize = nextPowerOfTwo(byteCount);
    this.vertexBuffer.destroy();
    this.vertexBuffer = this.device.createBuffer({
      size: nextSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.vertexCapacityBytes = nextSize;
  }

  private ensureStaging(floatCount: number): void {
    if (this.staging.length >= floatCount) {
      return;
    }
    this.staging = new Float32Array(nextPowerOfTwo(floatCount));
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("WebGpuDebugLinePass has been destroyed.");
    }
  }
}

function writeDebugVertex(
  buffer: Float32Array,
  offset: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
): number {
  buffer[offset] = x;
  buffer[offset + 1] = y;
  buffer[offset + 2] = r;
  buffer[offset + 3] = g;
  buffer[offset + 4] = b;
  buffer[offset + 5] = a;
  return offset + FLOATS_PER_DEBUG_VERTEX;
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(value, 1)));
}
