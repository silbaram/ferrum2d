import {
  createShadowProjectionScratch,
  MAX_TILE_OCCLUDER_SHADOW_TRIANGLE_FLOATS,
  writeTileOccluderShadowTrianglesInto,
} from "./lightingShadows.js";
import { distanceSquaredToTileOccluder } from "./lightingTileOccluders.js";
import type {
  ResolvedLightingScene2D,
  ResolvedPointLight2D,
  TileOccluder2D,
} from "./lightingTypes.js";

export interface WebGpuLightingPassStats {
  drawCalls: number;
  pointLightCount: number;
  tileOccluderCount: number;
  shadowDrawCalls: number;
  shadowCasterCount: number;
}

const BYTES_PER_F32 = Float32Array.BYTES_PER_ELEMENT;
const FLOATS_PER_LIGHTING_INSTANCE = 13;
const LIGHTING_INSTANCE_STRIDE_BYTES = FLOATS_PER_LIGHTING_INSTANCE * BYTES_PER_F32;
const FLOATS_PER_SHADOW_VERTEX = 9;
const SHADOW_VERTEX_STRIDE_BYTES = FLOATS_PER_SHADOW_VERTEX * BYTES_PER_F32;

export class WebGpuLightingPass {
  private readonly solidPipeline: GPURenderPipeline;
  private readonly additivePipeline: GPURenderPipeline;
  private readonly shadowPipeline: GPURenderPipeline;
  private lightingInstanceBuffer: GPUBuffer;
  private shadowVertexBuffer: GPUBuffer;
  private lightingInstanceCapacityBytes = LIGHTING_INSTANCE_STRIDE_BYTES;
  private shadowVertexCapacityBytes = SHADOW_VERTEX_STRIDE_BYTES;
  private lightingStaging = new Float32Array(0);
  private shadowStaging = new Float32Array(0);
  private shadowTrianglePositions = new Float32Array(MAX_TILE_OCCLUDER_SHADOW_TRIANGLE_FLOATS);
  private readonly activePointLightScratch: ResolvedPointLight2D[] = [];
  private readonly lightColorScratch: [number, number, number, number] = [0, 0, 0, 0];
  private readonly shadowProjectionScratch = createShadowProjectionScratch();
  private readonly shadowClipRect = { x: 0, y: 0, width: 0, height: 0 };
  private destroyed = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
    private readonly pipelineLayout: GPUPipelineLayout,
    private readonly resolutionBindGroup: GPUBindGroup,
  ) {
    this.lightingInstanceBuffer = this.device.createBuffer({
      size: LIGHTING_INSTANCE_STRIDE_BYTES,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.shadowVertexBuffer = this.device.createBuffer({
      size: SHADOW_VERTEX_STRIDE_BYTES,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.solidPipeline = this.createLightingPipeline("normal");
    this.additivePipeline = this.createLightingPipeline("additive");
    this.shadowPipeline = this.createShadowPipeline();
  }

  draw(
    pass: GPURenderPassEncoder,
    scene: ResolvedLightingScene2D,
    viewportWidth: number,
    viewportHeight: number,
  ): WebGpuLightingPassStats {
    this.assertAlive();
    if (!scene.enabled || viewportWidth <= 0 || viewportHeight <= 0) {
      return emptyStats();
    }

    const activePointLights = this.activePointLightScratch;
    let activePointLightCount = 0;
    for (const light of scene.pointLights) {
      if (light.intensity <= 0) {
        continue;
      }
      activePointLights[activePointLightCount] = light;
      activePointLightCount += 1;
    }
    activePointLights.length = activePointLightCount;

    const ambientInstanceCount = scene.ambient[3] > 0 ? 1 : 0;
    const debugTileOccluderCount = scene.debug.tileOccluders ? scene.tileOccluders.length : 0;
    const lightingInstanceCount = ambientInstanceCount + activePointLights.length + debugTileOccluderCount;
    const pointLightFirstInstance = ambientInstanceCount;
    const debugFirstInstance = pointLightFirstInstance + activePointLights.length;
    if (lightingInstanceCount > 0) {
      this.ensureLightingStaging(lightingInstanceCount * FLOATS_PER_LIGHTING_INSTANCE);
      let lightingOffset = 0;
      if (ambientInstanceCount > 0) {
        lightingOffset = writeLightingInstance(
          this.lightingStaging,
          lightingOffset,
          0,
          0,
          viewportWidth,
          viewportHeight,
          scene.ambient,
          0,
          0,
          1,
          1,
          0,
        );
      }

      for (const light of activePointLights) {
        const radius = light.radius;
        this.lightColorScratch[0] = light.color[0] * light.intensity;
        this.lightColorScratch[1] = light.color[1] * light.intensity;
        this.lightColorScratch[2] = light.color[2] * light.intensity;
        this.lightColorScratch[3] = light.color[3];
        lightingOffset = writeLightingInstance(
          this.lightingStaging,
          lightingOffset,
          light.x - radius,
          light.y - radius,
          radius * 2,
          radius * 2,
          this.lightColorScratch,
          light.x,
          light.y,
          radius,
          light.falloff,
          1,
        );
      }

      if (scene.debug.tileOccluders) {
        for (const occluder of scene.tileOccluders) {
          lightingOffset = writeLightingInstance(
            this.lightingStaging,
            lightingOffset,
            occluder.x,
            occluder.y,
            occluder.width,
            occluder.height,
            scene.debug.color,
            0,
            0,
            1,
            1,
            0,
          );
        }
      }
      this.uploadLightingInstances(lightingOffset);
    }

    let drawCalls = 0;
    if (ambientInstanceCount > 0) {
      drawCalls += this.drawLightingInstances(
        pass,
        this.solidPipeline,
        ambientInstanceCount,
        0,
      );
    }

    if (activePointLights.length > 0) {
      drawCalls += this.drawLightingInstances(
        pass,
        this.additivePipeline,
        activePointLights.length,
        pointLightFirstInstance,
      );
    }

    const shadowStats = this.drawShadows(
      pass,
      scene,
      scene.tileOccluders,
      activePointLights,
      viewportWidth,
      viewportHeight,
    );
    drawCalls += shadowStats.drawCalls;

    if (debugTileOccluderCount > 0) {
      drawCalls += this.drawLightingInstances(
        pass,
        this.solidPipeline,
        debugTileOccluderCount,
        debugFirstInstance,
      );
    }

    return {
      drawCalls,
      pointLightCount: activePointLights.length,
      tileOccluderCount: debugTileOccluderCount,
      shadowDrawCalls: shadowStats.drawCalls,
      shadowCasterCount: shadowStats.casterCount,
    };
  }

  private uploadLightingInstances(floatCount: number): void {
    const byteCount = floatCount * BYTES_PER_F32;
    this.ensureLightingInstanceCapacity(byteCount);
    this.device.queue.writeBuffer(
      this.lightingInstanceBuffer,
      0,
      this.lightingStaging.buffer,
      this.lightingStaging.byteOffset,
      byteCount,
    );
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.lightingInstanceBuffer.destroy();
    this.shadowVertexBuffer.destroy();
    this.lightingInstanceCapacityBytes = 0;
    this.shadowVertexCapacityBytes = 0;
    this.lightingStaging = new Float32Array(0);
    this.shadowStaging = new Float32Array(0);
    this.shadowTrianglePositions = new Float32Array(0);
    this.activePointLightScratch.length = 0;
  }

  private createLightingPipeline(blendMode: "normal" | "additive"): GPURenderPipeline {
    const module = this.device.createShaderModule({
      code: `
        struct Resolution {
          size: vec2f,
        };
        @group(0) @binding(0) var<uniform> resolution: Resolution;

        struct VertexInput {
          @location(0) rect: vec4f,
          @location(1) color: vec4f,
          @location(2) light: vec4f,
          @location(3) mode: f32,
          @builtin(vertex_index) vertexIndex: u32,
        };

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) pixelPosition: vec2f,
          @location(1) color: vec4f,
          @location(2) light: vec4f,
          @location(3) mode: f32,
        };

        fn cornerForVertex(vertexIndex: u32) -> vec2f {
          if (vertexIndex == 0u) { return vec2f(0.0, 0.0); }
          if (vertexIndex == 1u) { return vec2f(1.0, 0.0); }
          if (vertexIndex == 2u) { return vec2f(0.0, 1.0); }
          if (vertexIndex == 3u) { return vec2f(0.0, 1.0); }
          if (vertexIndex == 4u) { return vec2f(1.0, 0.0); }
          return vec2f(1.0, 1.0);
        }

        @vertex
        fn vs_main(input: VertexInput) -> VertexOutput {
          let corner = cornerForVertex(input.vertexIndex % 6u);
          let pixelPosition = input.rect.xy + corner * input.rect.zw;
          let zeroToOne = pixelPosition / resolution.size;
          let clip = zeroToOne * 2.0 - vec2f(1.0, 1.0);
          var output: VertexOutput;
          output.position = vec4f(clip * vec2f(1.0, -1.0), 0.0, 1.0);
          output.pixelPosition = pixelPosition;
          output.color = input.color;
          output.light = input.light;
          output.mode = input.mode;
          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4f {
          if (input.mode > 0.5) {
            let distanceToLight = distance(input.pixelPosition, input.light.xy);
            let attenuation = max(1.0 - (distanceToLight / input.light.z), 0.0);
            let alpha = pow(attenuation, input.light.w) * input.color.a;
            return vec4f(input.color.rgb, alpha);
          }
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
          arrayStride: LIGHTING_INSTANCE_STRIDE_BYTES,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x4" },
            { shaderLocation: 1, offset: 4 * BYTES_PER_F32, format: "float32x4" },
            { shaderLocation: 2, offset: 8 * BYTES_PER_F32, format: "float32x4" },
            { shaderLocation: 3, offset: 12 * BYTES_PER_F32, format: "float32" },
          ],
        }],
      },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{
          format: this.format,
          blend: blendMode === "additive"
            ? {
                color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
              }
            : {
                color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
              },
        }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  private createShadowPipeline(): GPURenderPipeline {
    const module = this.device.createShaderModule({
      code: `
        struct Resolution {
          size: vec2f,
        };
        @group(0) @binding(0) var<uniform> resolution: Resolution;

        struct VertexInput {
          @location(0) position: vec2f,
          @location(1) color: vec4f,
          @location(2) light: vec3f,
        };

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) pixelPosition: vec2f,
          @location(1) color: vec4f,
          @location(2) light: vec3f,
        };

        @vertex
        fn vs_main(input: VertexInput) -> VertexOutput {
          let zeroToOne = input.position / resolution.size;
          let clip = zeroToOne * 2.0 - vec2f(1.0, 1.0);
          var output: VertexOutput;
          output.position = vec4f(clip * vec2f(1.0, -1.0), 0.0, 1.0);
          output.pixelPosition = input.position;
          output.color = input.color;
          output.light = input.light;
          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4f {
          let distanceToLight = distance(input.pixelPosition, input.light.xy);
          let clippedAlpha = input.color.a * (1.0 - smoothstep(input.light.z * 0.86, input.light.z, distanceToLight));
          if (clippedAlpha <= 0.0) {
            discard;
          }
          return vec4f(input.color.rgb, clippedAlpha);
        }
      `,
    });

    return this.device.createRenderPipeline({
      layout: this.pipelineLayout,
      vertex: {
        module,
        entryPoint: "vs_main",
        buffers: [{
          arrayStride: SHADOW_VERTEX_STRIDE_BYTES,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 2 * BYTES_PER_F32, format: "float32x4" },
            { shaderLocation: 2, offset: 6 * BYTES_PER_F32, format: "float32x3" },
          ],
        }],
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

  private drawLightingInstances(
    pass: GPURenderPassEncoder,
    pipeline: GPURenderPipeline,
    instanceCount: number,
    firstInstance: number,
  ): number {
    if (instanceCount <= 0) {
      return 0;
    }

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.resolutionBindGroup);
    pass.setVertexBuffer(0, this.lightingInstanceBuffer);
    pass.draw(6, instanceCount, 0, firstInstance);
    return 1;
  }

  private drawShadows(
    pass: GPURenderPassEncoder,
    scene: ResolvedLightingScene2D,
    occluders: readonly TileOccluder2D[],
    lights: readonly ResolvedPointLight2D[],
    viewportWidth: number,
    viewportHeight: number,
  ): { drawCalls: number; casterCount: number } {
    const shadows = scene.shadows;
    if (!shadows.enabled || shadows.color[3] <= 0 || occluders.length === 0 || lights.length === 0) {
      return { drawCalls: 0, casterCount: 0 };
    }

    this.ensureShadowTrianglePositionCapacity(MAX_TILE_OCCLUDER_SHADOW_TRIANGLE_FLOATS);
    this.shadowClipRect.x = 0;
    this.shadowClipRect.y = 0;
    this.shadowClipRect.width = viewportWidth;
    this.shadowClipRect.height = viewportHeight;
    let offset = 0;
    let casterCount = 0;
    for (const light of lights) {
      const maxDistance = shadows.maxDistance ?? light.radius;
      const maxDistanceSquared = maxDistance * maxDistance;
      const projectionLength = Math.max(shadows.projectionLength, light.radius);
      for (const occluder of occluders) {
        if (distanceSquaredToTileOccluder(light, occluder) > maxDistanceSquared) {
          continue;
        }

        const shadowPositionFloatCount = writeTileOccluderShadowTrianglesInto(
          this.shadowTrianglePositions,
          0,
          occluder,
          light,
          projectionLength,
          this.shadowProjectionScratch,
          this.shadowClipRect,
        );
        if (shadowPositionFloatCount === 0) {
          continue;
        }

        const shadowVertexCount = shadowPositionFloatCount / 2;
        this.ensureShadowStaging(offset + shadowVertexCount * FLOATS_PER_SHADOW_VERTEX);
        for (let index = 0; index < shadowPositionFloatCount; index += 2) {
          offset = writeShadowVertex(
            this.shadowStaging,
            offset,
            this.shadowTrianglePositions[index],
            this.shadowTrianglePositions[index + 1],
            shadows.color,
            light,
          );
        }
        casterCount += 1;
      }
    }

    if (casterCount === 0) {
      return { drawCalls: 0, casterCount: 0 };
    }

    const vertexCount = offset / FLOATS_PER_SHADOW_VERTEX;
    const byteCount = offset * BYTES_PER_F32;
    this.ensureShadowVertexCapacity(byteCount);
    this.device.queue.writeBuffer(
      this.shadowVertexBuffer,
      0,
      this.shadowStaging.buffer,
      this.shadowStaging.byteOffset,
      byteCount,
    );
    pass.setPipeline(this.shadowPipeline);
    pass.setBindGroup(0, this.resolutionBindGroup);
    pass.setVertexBuffer(0, this.shadowVertexBuffer);
    pass.draw(vertexCount, 1, 0, 0);
    return { drawCalls: 1, casterCount };
  }

  private ensureLightingInstanceCapacity(byteCount: number): void {
    if (this.lightingInstanceCapacityBytes >= byteCount) {
      return;
    }
    const nextSize = nextPowerOfTwo(byteCount);
    this.lightingInstanceBuffer.destroy();
    this.lightingInstanceBuffer = this.device.createBuffer({
      size: nextSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.lightingInstanceCapacityBytes = nextSize;
  }

  private ensureShadowVertexCapacity(byteCount: number): void {
    if (this.shadowVertexCapacityBytes >= byteCount) {
      return;
    }
    const nextSize = nextPowerOfTwo(byteCount);
    this.shadowVertexBuffer.destroy();
    this.shadowVertexBuffer = this.device.createBuffer({
      size: nextSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.shadowVertexCapacityBytes = nextSize;
  }

  private ensureLightingStaging(floatCount: number): void {
    if (this.lightingStaging.length >= floatCount) {
      return;
    }
    this.lightingStaging = new Float32Array(nextPowerOfTwo(floatCount));
  }

  private ensureShadowStaging(floatCount: number): void {
    if (this.shadowStaging.length >= floatCount) {
      return;
    }
    const nextStaging = new Float32Array(nextPowerOfTwo(floatCount));
    nextStaging.set(this.shadowStaging);
    this.shadowStaging = nextStaging;
  }

  private ensureShadowTrianglePositionCapacity(floatCount: number): void {
    if (this.shadowTrianglePositions.length >= floatCount) {
      return;
    }
    this.shadowTrianglePositions = new Float32Array(nextPowerOfTwo(floatCount));
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("WebGpuLightingPass has been destroyed.");
    }
  }
}

function emptyStats(): WebGpuLightingPassStats {
  return { drawCalls: 0, pointLightCount: 0, tileOccluderCount: 0, shadowDrawCalls: 0, shadowCasterCount: 0 };
}

function writeLightingInstance(
  buffer: Float32Array,
  offset: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: readonly [number, number, number, number],
  lightX: number,
  lightY: number,
  lightRadius: number,
  lightFalloff: number,
  mode: number,
): number {
  buffer[offset] = x;
  buffer[offset + 1] = y;
  buffer[offset + 2] = width;
  buffer[offset + 3] = height;
  buffer[offset + 4] = color[0];
  buffer[offset + 5] = color[1];
  buffer[offset + 6] = color[2];
  buffer[offset + 7] = color[3];
  buffer[offset + 8] = lightX;
  buffer[offset + 9] = lightY;
  buffer[offset + 10] = lightRadius;
  buffer[offset + 11] = lightFalloff;
  buffer[offset + 12] = mode;
  return offset + FLOATS_PER_LIGHTING_INSTANCE;
}

function writeShadowVertex(
  buffer: Float32Array,
  offset: number,
  x: number,
  y: number,
  color: readonly [number, number, number, number],
  light: ResolvedPointLight2D,
): number {
  buffer[offset] = x;
  buffer[offset + 1] = y;
  buffer[offset + 2] = color[0];
  buffer[offset + 3] = color[1];
  buffer[offset + 4] = color[2];
  buffer[offset + 5] = color[3];
  buffer[offset + 6] = light.x;
  buffer[offset + 7] = light.y;
  buffer[offset + 8] = light.radius;
  return offset + FLOATS_PER_SHADOW_VERTEX;
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(value, 1)));
}
