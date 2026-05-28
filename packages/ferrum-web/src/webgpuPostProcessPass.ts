import { resolvePostProcessPasses } from "./cameraPostProcessing.js";
import type {
  PostProcessStackInput,
  ResolvedFadePostProcessPass,
  ResolvedPostProcessPass,
} from "./cameraPostProcessing.js";
import { cameraPostProcessingDiagnosticError } from "./diagnostics.js";

const POST_PROCESS_UNIFORM_BYTES = 16;

export interface WebGpuPostProcessStats {
  drawCalls: number;
  passCount: number;
}

export class WebGpuPostProcessPass {
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly pipelineLayout: GPUPipelineLayout;
  private readonly uniformBuffer: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformStaging = new Float32Array(4);
  private passes: readonly ResolvedFadePostProcessPass[] = [];
  private destroyed = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
    postProcess: PostProcessStackInput = undefined,
  ) {
    this.bindGroupLayout = this.createBindGroupLayout();
    this.pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });
    this.uniformBuffer = this.device.createBuffer({
      size: POST_PROCESS_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    this.pipeline = this.createPipeline();
    this.setPostProcess(postProcess);
  }

  setPostProcess(postProcess: PostProcessStackInput): void {
    this.assertAlive();
    this.passes = resolveWebGpuPostProcessPasses(postProcess);
  }

  drawPasses(): WebGpuPostProcessStats {
    this.assertAlive();
    const passes = this.passes;
    if (passes.length === 0) {
      return { drawCalls: 0, passCount: 0 };
    }

    let drawCalls = 0;
    let passCount = 0;
    for (const pass of passes) {
      if (pass.color[3] <= 0) {
        continue;
      }
      this.uniformStaging[0] = pass.color[0];
      this.uniformStaging[1] = pass.color[1];
      this.uniformStaging[2] = pass.color[2];
      this.uniformStaging[3] = pass.color[3];
      this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformStaging);

      const encoder = this.device.createCommandEncoder();
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.context.getCurrentTexture().createView(),
          loadOp: "load",
          storeOp: "store",
        }],
      });
      renderPass.setPipeline(this.pipeline);
      renderPass.setBindGroup(0, this.bindGroup);
      renderPass.draw(3, 1, 0, 0);
      renderPass.end();
      this.device.queue.submit([encoder.finish()]);
      drawCalls += 1;
      passCount += 1;
    }

    return { drawCalls, passCount };
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.uniformBuffer.destroy();
  }

  private createBindGroupLayout(): GPUBindGroupLayout {
    return this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      }],
    });
  }

  private createPipeline(): GPURenderPipeline {
    const module = this.device.createShaderModule({
      code: `
        struct Fade {
          color: vec4f,
        };
        @group(0) @binding(0) var<uniform> fade: Fade;

        struct VertexOutput {
          @builtin(position) position: vec4f,
        };

        @vertex
        fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
          var positions = array<vec2f, 3>(
            vec2f(-1.0, -1.0),
            vec2f(3.0, -1.0),
            vec2f(-1.0, 3.0)
          );
          var output: VertexOutput;
          output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
          return output;
        }

        @fragment
        fn fs_main() -> @location(0) vec4f {
          return fade.color;
        }
      `,
    });

    return this.device.createRenderPipeline({
      layout: this.pipelineLayout,
      vertex: {
        module,
        entryPoint: "vs_main",
      },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          },
        }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("WebGpuPostProcessPass has been destroyed.");
    }
  }
}

export function resolveWebGpuPostProcessPasses(input: PostProcessStackInput): readonly ResolvedFadePostProcessPass[] {
  const passes = resolvePostProcessPasses(input);
  const unsupported = passes.find((pass) => pass.kind !== "fade");
  if (unsupported !== undefined) {
    throw cameraPostProcessingDiagnosticError(
      "webgpu.postProcess",
      `WebGPU renderer currently supports only fade post-process passes; '${unsupported.kind}' requires the WebGL2 renderer.`,
    );
  }
  return passes as readonly ResolvedFadePostProcessPass[];
}
