import type { WebGpuSpriteNormalBindings } from "./webgpuSpriteNormals.js";
import { beginWebGpuRenderPass } from "./webgpuGpuTimer.js";
import { webGpuResources } from "./webgpuResources.js";
import { LightingShadowGeometryCache } from "./lightingShadowGeometryCache.js";
import type {
  ResolvedLightingScene2D,
  ResolvedPointLight2D,
} from "./lightingTypes.js";

export interface WebGpuLightingPassStats {
  drawCalls: number;
  pointLightCount: number;
  tileOccluderCount: number;
  shadowDrawCalls: number;
  shadowCasterCount: number;
  /** The caller-owned base pass was ended to record per-light mask passes. */
  passEnded?: true;
}

interface LightingTarget {
  encoder: GPUCommandEncoder;
  view: GPUTextureView;
  width: number;
  height: number;
}
interface ShadowRange { firstVertex: number; vertexCount: number; lightIndex: number; casterCount: number; }

const BYTES_PER_F32 = Float32Array.BYTES_PER_ELEMENT;
const FLOATS_PER_LIGHTING_INSTANCE = 13;
const LIGHTING_INSTANCE_STRIDE_BYTES = FLOATS_PER_LIGHTING_INSTANCE * BYTES_PER_F32;
const FLOATS_PER_SHADOW_VERTEX = 10;
const SHADOW_VERTEX_STRIDE_BYTES = FLOATS_PER_SHADOW_VERTEX * BYTES_PER_F32;

export class WebGpuLightingPass {
  private readonly solidPipeline: GPURenderPipeline;
  private readonly additivePipeline: GPURenderPipeline;
  private shadowPipeline?: GPURenderPipeline;
  private maskedAdditivePipeline?: GPURenderPipeline;
  private maskedNormalPipeline?: GPURenderPipeline;
  private maskLayout?: GPUBindGroupLayout;
  private maskTexture?: GPUTexture;
  private maskView?: GPUTextureView;
  private maskBindGroup?: GPUBindGroup;
  private maskTintBuffer?: GPUBuffer;
  private maskWidth = 0;
  private maskHeight = 0;
  private readonly maskTint = new Float32Array(4);
  private readonly shadowRanges: ShadowRange[] = [];
  private normalAdditivePipeline?:GPURenderPipeline;
  private lightingInstanceBuffer: GPUBuffer;
  private shadowVertexBuffer: GPUBuffer;
  private lightingInstanceCapacityBytes = LIGHTING_INSTANCE_STRIDE_BYTES;
  private shadowVertexCapacityBytes = SHADOW_VERTEX_STRIDE_BYTES;
  private lightingStaging = new Float32Array(0);
  private shadowStaging = new Float32Array(0);
  private readonly activePointLightScratch: ResolvedPointLight2D[] = [];
  private readonly lightColorScratch: [number, number, number, number] = [0, 0, 0, 0];
  private readonly shadowGeometryCache = new LightingShadowGeometryCache();
  private readonly shadowClipRect = { x: 0, y: 0, width: 0, height: 0 };
  private destroyed = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
    private readonly pipelineLayout: GPUPipelineLayout,
    private readonly resolutionBindGroup: GPUBindGroup,
  ) {
    this.lightingInstanceBuffer = webGpuResources(this.device).createBuffer({
      size: LIGHTING_INSTANCE_STRIDE_BYTES,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.shadowVertexBuffer = webGpuResources(this.device).createBuffer({
      size: SHADOW_VERTEX_STRIDE_BYTES,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.solidPipeline = this.createLightingPipeline("normal");
    this.additivePipeline = this.createLightingPipeline("additive");
  }

  draw(
    pass: GPURenderPassEncoder,
    scene: ResolvedLightingScene2D,
    viewportWidth: number,
    viewportHeight: number,
    normals?:WebGpuSpriteNormalBindings,
    target?: LightingTarget,
  ): WebGpuLightingPassStats {
    this.assertAlive();
    if (!scene.enabled || viewportWidth <= 0 || viewportHeight <= 0) {
      this.releaseMask();
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
    const sun = scene.directionalLight;
    const sunCount = sun !== undefined && sun.intensity > 0 ? 1 : 0;
    const lightingInstanceCount = ambientInstanceCount + activePointLights.length + sunCount + debugTileOccluderCount;
    const pointLightFirstInstance = ambientInstanceCount;
    const debugFirstInstance = pointLightFirstInstance + activePointLights.length + sunCount;
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

      if (sun !== undefined && sunCount > 0) {
        this.lightColorScratch[0] = sun.color[0]; this.lightColorScratch[1] = sun.color[1];
        this.lightColorScratch[2] = sun.color[2]; this.lightColorScratch[3] = sun.intensity;
        const elevation=sun.elevationRadians??Math.PI/4,c=Math.cos(elevation);
        lightingOffset = writeLightingInstance(this.lightingStaging, lightingOffset, 0, 0, viewportWidth, viewportHeight,
          this.lightColorScratch,normals?-sun.directionX*c:0,normals?-sun.directionY*c:0,normals?Math.sin(elevation):1,normals?0:1,normals?-1:0);
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
          light.y - (light.radiusY ?? radius),
          radius * 2,
          (light.radiusY ?? radius) * 2,
          this.lightColorScratch,
          light.x,
          light.y,
          radius,
          light.falloff,
          normals?2+(light.height??light.radius*0.5):1,
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

    const ranges = this.prepareShadows(scene, activePointLights, viewportWidth, viewportHeight);
    const additive = normals
      ? (this.normalAdditivePipeline ??= this.createLightingPipeline("additive", normals.layout))
      : this.additivePipeline;
    let first = pointLightFirstInstance;
    for (const range of ranges) {
      const next = pointLightFirstInstance + sunCount + range.lightIndex;
      drawCalls += this.drawLightingInstances(pass, additive, next - first, first, normals?.bindGroup);
      first = next + 1;
    }
    drawCalls += this.drawLightingInstances(pass, additive, debugFirstInstance - first, first, normals?.bindGroup);

    let casterCount = 0;
    if (ranges.length) {
      if (!target) throw Error("Shadowed lighting requires the caller-owned encoder and destination");
      this.ensureMask(target.width, target.height);
      this.maskTint.set(scene.shadows.color);
      this.device.queue.writeBuffer(this.maskTintBuffer!, 0, this.maskTint.buffer);
      const masked = normals
        ? (this.maskedNormalPipeline ??= this.createLightingPipeline("additive", normals.layout, this.maskLayout!))
        : (this.maskedAdditivePipeline ??= this.createLightingPipeline("additive", undefined, this.maskLayout!));
      pass.end();
      for (const range of ranges) {
        const maskPass = beginWebGpuRenderPass(this.device, target.encoder, {
          colorAttachments: [{ view: this.maskView!, loadOp: "clear", storeOp: "store", clearValue: {r:0,g:0,b:0,a:0} }],
        });
        try {
          maskPass.setPipeline(this.shadowPipeline!);
          maskPass.setBindGroup(0, this.resolutionBindGroup);
          maskPass.setVertexBuffer(0, this.shadowVertexBuffer);
          maskPass.draw(range.vertexCount, 1, range.firstVertex, 0);
        } finally { maskPass.end(); }
        casterCount += range.casterCount;
        const lightPass = beginWebGpuRenderPass(this.device, target.encoder, {
          colorAttachments: [{ view: target.view, loadOp: "load", storeOp: "store" }],
        });
        try {
          drawCalls += this.drawLightingInstances(lightPass, masked, 1,
            pointLightFirstInstance + sunCount + range.lightIndex, normals?.bindGroup, this.maskBindGroup);
          if (range === ranges[ranges.length - 1]) {
            drawCalls += this.drawLightingInstances(lightPass, this.solidPipeline, debugTileOccluderCount, debugFirstInstance);
          }
        } finally { lightPass.end(); }
      }
      drawCalls += ranges.length;
    } else {
      this.releaseMask();
      drawCalls += this.drawLightingInstances(pass, this.solidPipeline, debugTileOccluderCount, debugFirstInstance);
    }
    return {
      drawCalls,
      pointLightCount: activePointLights.length,
      tileOccluderCount: debugTileOccluderCount,
      shadowDrawCalls: ranges.length,
      shadowCasterCount: casterCount,
      ...(ranges.length ? { passEnded: true as const } : {}),
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
    this.releaseMask();
    webGpuResources(this.device).destroy(this.lightingInstanceBuffer);
    webGpuResources(this.device).destroy(this.shadowVertexBuffer);
    this.lightingInstanceCapacityBytes = 0;
    this.shadowVertexCapacityBytes = 0;
    this.lightingStaging = new Float32Array(0);
    this.shadowStaging = new Float32Array(0);
    this.activePointLightScratch.length = 0;
  }

  private createLightingPipeline(blendMode: "normal" | "additive",normalLayout?:GPUBindGroupLayout,maskLayout?:GPUBindGroupLayout): GPURenderPipeline {
    const module = this.device.createShaderModule({
      code: `
        struct Resolution {
          size: vec2f,
        };
        @group(0) @binding(0) var<uniform> resolution: Resolution;
        ${normalLayout?"@group(1) @binding(0) var normalBuffer:texture_2d<f32>;@group(1) @binding(1) var normalCoverage:texture_2d<f32>;":""}

        ${maskLayout ? `@group(${normalLayout ? 2 : 1}) @binding(0) var shadowMask:texture_2d<f32>;
        @group(${normalLayout ? 2 : 1}) @binding(1) var<uniform> shadowTint:vec4f;` : ""}

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
          @location(4) scaleY: f32,
        };

        ${normalLayout?`
        fn normalResponse(input:VertexOutput,direction:vec3f)->f32 {
          let pixel=vec2i(input.position.xy);let coverage=clamp(textureLoad(normalCoverage,pixel,0).r,0.,1.);
          let raw=textureLoad(normalBuffer,pixel,0).rgb*2.-1.;var n=vec3f(0.,0.,1.);if(length(raw)>=0.02){n=normalize(raw);}
          return mix(1.,max(dot(n,direction),0.),coverage);
        }`:""}
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
          output.scaleY = input.rect.w / input.rect.z;
          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4f {
          if (input.mode > 0.5) {
            let distanceToLight = length((input.pixelPosition-input.light.xy)/vec2f(1.0,input.scaleY));
            let attenuation = max(1.0 - (distanceToLight / input.light.z), 0.0);
            var alpha = pow(attenuation, input.light.w) * input.color.a;
            ${normalLayout?`let delta=vec3f(input.light.x-input.pixelPosition.x,(input.light.y-input.pixelPosition.y)/input.scaleY,max(input.mode-2.,0.));
            var direction=vec3f(0.,0.,1.);if(length(delta)>0.0001){direction=normalize(delta);}
            alpha *= normalResponse(input,direction);`:""}
            ${maskLayout ? `let transmission=mix(vec3f(1.),shadowTint.rgb,textureLoad(shadowMask,vec2i(input.position.xy),0).r);
            let visibility=max(max(transmission.r,transmission.g),transmission.b);
            if(visibility<=0.){return vec4f(0.);}
            return vec4f(clamp(input.color.rgb,vec3f(0.),vec3f(1.))*transmission/visibility,alpha*visibility);`
            : "return vec4f(input.color.rgb,alpha);"}
          }
          ${normalLayout?"if(input.mode < -0.5){return vec4f(input.color.rgb,input.color.a*normalResponse(input,input.light.xyz));}":""}
          return input.color;
        }
      `,
    });

    return webGpuResources(this.device).createRenderPipeline({
      layout: normalLayout || maskLayout ? this.device.createPipelineLayout({bindGroupLayouts:[this.solidPipeline.getBindGroupLayout(0),...(normalLayout?[normalLayout]:[]),...(maskLayout?[maskLayout]:[])]}):this.pipelineLayout,
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
          @location(2) light: vec4f,
        };

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) pixelPosition: vec2f,
          @location(1) color: vec4f,
          @location(2) light: vec4f,
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
          let distanceToLight = length((input.pixelPosition-input.light.xy)/vec2f(1.0,input.light.w));
          let clippedAlpha = input.color.a * (1.0 - smoothstep(input.light.z * 0.86, input.light.z, distanceToLight));
          if (clippedAlpha <= 0.0) {
            discard;
          }
          return vec4f(clippedAlpha,0.,0.,1.);
        }
      `,
    });

    return webGpuResources(this.device).createRenderPipeline({
      layout: this.pipelineLayout,
      vertex: {
        module,
        entryPoint: "vs_main",
        buffers: [{
          arrayStride: SHADOW_VERTEX_STRIDE_BYTES,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 2 * BYTES_PER_F32, format: "float32x4" },
            { shaderLocation: 2, offset: 6 * BYTES_PER_F32, format: "float32x4" },
          ],
        }],
      },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{
          format: "r8unorm",
          blend: {
            color: { srcFactor: "one", dstFactor: "one", operation: "max" },
            alpha: { srcFactor: "one", dstFactor: "one", operation: "max" },
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
    normals?:GPUBindGroup,
    mask?:GPUBindGroup,
  ): number {
    if (instanceCount <= 0) {
      return 0;
    }

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.resolutionBindGroup);
    if(normals)pass.setBindGroup(1,normals);
    if(mask)pass.setBindGroup(normals?2:1,mask);
    pass.setVertexBuffer(0, this.lightingInstanceBuffer);
    pass.draw(6, instanceCount, 0, firstInstance);
    return 1;
  }

  private prepareShadows(
    scene: ResolvedLightingScene2D,
    lights: readonly ResolvedPointLight2D[],
    viewportWidth: number,
    viewportHeight: number,
  ): ShadowRange[] {
    const ranges = this.shadowRanges;
    ranges.length = 0;
    const shadows = scene.shadows, occluders = scene.tileOccluders;
    if (!shadows.enabled || shadows.color[3] <= 0 || occluders.length === 0 || lights.length === 0) {
      return ranges;
    }

    this.shadowClipRect.x = 0;
    this.shadowClipRect.y = 0;
    this.shadowClipRect.width = viewportWidth;
    this.shadowClipRect.height = viewportHeight;
    const occluderVersion = this.shadowGeometryCache.syncOccluders(occluders);
    let offset = 0;
    for (let lightIndex = 0; lightIndex < lights.length; lightIndex += 1) {
      const light = lights[lightIndex];
      const shadowGeometry = this.shadowGeometryCache.resolveLightGeometry(
        lightIndex,
        occluderVersion,
        occluders,
        light,
        shadows,
        this.shadowClipRect,
      );
      if (shadowGeometry.floatCount === 0) {
        continue;
      }

      const shadowVertexCount = shadowGeometry.floatCount / 2;
      ranges.push({firstVertex:offset/FLOATS_PER_SHADOW_VERTEX,vertexCount:shadowVertexCount,lightIndex,casterCount:shadowGeometry.casterCount});
      this.ensureShadowStaging(offset + shadowVertexCount * FLOATS_PER_SHADOW_VERTEX);
      for (let index = 0; index < shadowGeometry.floatCount; index += 2) {
        offset = writeShadowVertex(
          this.shadowStaging,
          offset,
          shadowGeometry.positions[index],
          shadowGeometry.positions[index + 1],
          shadows.color,
          light,
        );
      }
    }

    if (ranges.length === 0) {
      return ranges;
    }

    const byteCount = offset * BYTES_PER_F32;
    this.ensureShadowVertexCapacity(byteCount);
    this.device.queue.writeBuffer(
      this.shadowVertexBuffer,
      0,
      this.shadowStaging.buffer,
      this.shadowStaging.byteOffset,
      byteCount,
    );
    return ranges;
  }

  private ensureMask(width: number, height: number): void {
    if (this.maskTexture && width === this.maskWidth && height === this.maskHeight) return;
    const device = this.device;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        width > device.limits.maxTextureDimension2D || height > device.limits.maxTextureDimension2D) {
      throw Error("Invalid lighting shadow mask dimensions");
    }
    const resources = webGpuResources(device);
    let texture: GPUTexture | undefined, tint: GPUBuffer | undefined;
    try {
      this.maskLayout ??= device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ] });
      this.shadowPipeline ??= this.createShadowPipeline();
      texture = resources.createTexture({size:[width,height,1],format:"r8unorm",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
      const view = texture.createView();
      tint = resources.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      const group = device.createBindGroup({layout:this.maskLayout,entries:[{binding:0,resource:view},{binding:1,resource:{buffer:tint}}]});
      this.releaseMask();
      this.maskTexture=texture;this.maskView=view;this.maskTintBuffer=tint;this.maskBindGroup=group;
      this.maskWidth=width;this.maskHeight=height;
    } catch(error) { resources.destroy(texture);resources.destroy(tint);throw error; }
  }

  private releaseMask(): void {
    const resources=webGpuResources(this.device);
    resources.destroy(this.maskTexture);resources.destroy(this.maskTintBuffer);
    this.maskTexture=undefined;this.maskView=undefined;this.maskTintBuffer=undefined;this.maskBindGroup=undefined;
    this.maskWidth=this.maskHeight=0;
  }

  private ensureLightingInstanceCapacity(byteCount: number): void {
    if (this.lightingInstanceCapacityBytes >= byteCount) {
      return;
    }
    const nextSize = nextPowerOfTwo(byteCount);
    const next = webGpuResources(this.device).createBuffer({size:nextSize,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    webGpuResources(this.device).destroy(this.lightingInstanceBuffer);
    this.lightingInstanceBuffer = next;
    this.lightingInstanceCapacityBytes = nextSize;
  }

  private ensureShadowVertexCapacity(byteCount: number): void {
    if (this.shadowVertexCapacityBytes >= byteCount) {
      return;
    }
    const nextSize = nextPowerOfTwo(byteCount);
    const next = webGpuResources(this.device).createBuffer({size:nextSize,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    webGpuResources(this.device).destroy(this.shadowVertexBuffer);
    this.shadowVertexBuffer = next;
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
  buffer[offset + 9] = (light.radiusY ?? light.radius) / light.radius;
  return offset + FLOATS_PER_SHADOW_VERTEX;
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(value, 1)));
}
