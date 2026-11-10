import { WebGpuLightingCookies, type WebGpuLightingCookieSource } from "./webgpuLightingCookies.js";
import { writePointLightSpot } from "./lightingSpot.js";
import type { WebGpuSpriteNormalBindings } from "./webgpuSpriteNormals.js";
import type { WebGpuSunShadowBindings } from "./webgpuSunShadowMask.js";
import { beginWebGpuRenderPass } from "./webgpuGpuTimer.js";
import { webGpuResources } from "./webgpuResources.js";
import { LightingShadowGeometryCache } from "./lightingShadowGeometryCache.js";
import { SPATIAL_SPECULAR_WGSL } from "./spatialSpecular.js";
import type {
  ResolvedLightingScene2D,
  ResolvedPointLight2D,
  ResolvedPointLightSpot2D,
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
const FLOATS_PER_LIGHTING_INSTANCE = 14;
const LIGHTING_INSTANCE_STRIDE_BYTES = FLOATS_PER_LIGHTING_INSTANCE * BYTES_PER_F32;
const FLOATS_PER_SHADOW_VERTEX = 10;
const SHADOW_VERTEX_STRIDE_BYTES = FLOATS_PER_SHADOW_VERTEX * BYTES_PER_F32;

export class WebGpuLightingPass {
  private readonly lightingInstanceFloats: number;
  private readonly lightingInstanceStride: number;
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
  private surfaceAmbientPipeline?:GPURenderPipeline;
  private sunMaskedPipeline?:GPURenderPipeline;
  private sunMaskedNormalPipeline?:GPURenderPipeline;
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
  private cookies?: WebGpuLightingCookies;
  private emptyLayout?: GPUBindGroupLayout;
  private readonly cookiePipelines = new Map<string, GPURenderPipeline>();
  private destroyed = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
    private readonly pipelineLayout: GPUPipelineLayout,
    private readonly resolutionBindGroup: GPUBindGroup,
    private readonly irradiance=false,
    private readonly surface=false,
    private readonly surfaceAlbedoSrgb=false,
    private readonly receiverMaskInput=false,
  ) {
    this.lightingInstanceFloats = FLOATS_PER_LIGHTING_INSTANCE + (irradiance ? 4 : 0);
    this.lightingInstanceStride = this.lightingInstanceFloats * BYTES_PER_F32;
    this.lightingInstanceCapacityBytes = this.lightingInstanceStride;
    this.lightingInstanceBuffer = webGpuResources(this.device).createBuffer({
      size: this.lightingInstanceStride,
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
    sunMask?: WebGpuSunShadowBindings,
    cookieSource?: WebGpuLightingCookieSource,
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
    const hasCookies = activePointLights.some(light => light.cookie !== undefined);
    if (hasCookies) {
      if (!cookieSource || !this.irradiance) throw Error("Cookie textures require a lit renderer texture source");
      (this.cookies ??= new WebGpuLightingCookies(this.device)).prepare(activePointLights, cookieSource);
    }

    const receiverMaskBit=normals?.hasReceiverMasks?65536:0;
    const ambientInstanceCount = scene.ambient[3] > 0 ? 1 : 0;
    const debugTileOccluderCount = scene.debug.tileOccluders ? scene.tileOccluders.length : 0;
    const sun = scene.directionalLight;
    const sunCount = sun !== undefined && sun.intensity > 0 ? 1 : 0;
    const lightingInstanceCount = ambientInstanceCount + activePointLights.length + sunCount + debugTileOccluderCount;
    const pointLightFirstInstance = ambientInstanceCount;
    const debugFirstInstance = pointLightFirstInstance + activePointLights.length + sunCount;
    if (lightingInstanceCount > 0) {
      this.ensureLightingStaging(lightingInstanceCount * this.lightingInstanceFloats);
      let lightingOffset = 0;
      if (ambientInstanceCount > 0) {
        lightingOffset = this.writeLightingInstance(
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
        this.lightColorScratch[2] = sun.color[2]; this.lightColorScratch[3] = this.irradiance?1:sun.intensity;
        if(this.irradiance){this.lightColorScratch[0]*=sun.intensity;this.lightColorScratch[1]*=sun.intensity;this.lightColorScratch[2]*=sun.intensity;}
        const elevation=sun.elevationRadians??Math.PI/4,c=Math.cos(elevation);
        lightingOffset = this.writeLightingInstance(lightingOffset, 0, 0, viewportWidth, viewportHeight,
          this.lightColorScratch,normals?-sun.directionX*c:0,normals?-sun.directionY*c:0,normals?Math.sin(elevation):1,normals?0:1,normals?-1:0,(sun.lightMask??255)+((sun.shadowMask??255)<<8)+receiverMaskBit);
      }
      for (const light of activePointLights) {
        const radius = light.radius;
        this.lightColorScratch[0] = light.color[0] * light.intensity;
        this.lightColorScratch[1] = light.color[1] * light.intensity;
        this.lightColorScratch[2] = light.color[2] * light.intensity;
        this.lightColorScratch[3] = light.color[3];
        lightingOffset = this.writeLightingInstance(
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
          (light.lightMask??255)+((light.shadowMask??255)<<8)+receiverMaskBit,
          light.spot,
        );
      }

      if (scene.debug.tileOccluders) {
        for (const occluder of scene.tileOccluders) {
          lightingOffset = this.writeLightingInstance(
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

    const drawAdditive = (drawPass: GPURenderPassEncoder, pipeline: GPURenderPipeline, count: number, start: number, mask?: GPUBindGroup) => {
      if (!hasCookies) return this.drawLightingInstances(drawPass, pipeline, count, start, normals?.bindGroup, mask);
      let draws = 0, first = start;
      for (let instance = start; instance < start + count; instance++) {
        const index = instance - ambientInstanceCount - sunCount;
        if (index < 0 || !activePointLights[index]?.cookie) continue;
        draws += this.drawLightingInstances(drawPass, pipeline, instance - first, first, normals?.bindGroup, mask);
        const key = `${Number(!!normals)}:${Number(!!mask)}`;
        let variant = this.cookiePipelines.get(key);
        if (!variant) {
          variant = this.createLightingPipeline("additive", normals?.layout, mask ? this.maskLayout : undefined, this.cookies!.layout);
          this.cookiePipelines.set(key, variant);
        }
        draws += this.drawLightingInstances(drawPass, variant, 1, instance, normals?.bindGroup, mask, this.cookies!.binding(index));
        first = instance + 1;
      }
      return draws + this.drawLightingInstances(drawPass, pipeline, start + count - first, first, normals?.bindGroup, mask);
    };
    let drawCalls = 0;
    if (ambientInstanceCount > 0) {
      drawCalls += this.drawLightingInstances(
        pass,
        this.surface && normals ? (this.surfaceAmbientPipeline??=this.createLightingPipeline("normal",normals.layout)) : this.solidPipeline,
        ambientInstanceCount,
        0,
        this.surface ? normals?.bindGroup : undefined,
      );
    }

    const ranges = this.prepareShadows(scene, activePointLights, viewportWidth, viewportHeight);
    const additive = normals
      ? (this.normalAdditivePipeline ??= this.createLightingPipeline("additive", normals.layout))
      : this.additivePipeline;
    let first = pointLightFirstInstance;
    if(sunMask&&sunCount){
      const masked=normals
        ?(this.sunMaskedNormalPipeline??=this.createLightingPipeline("additive",normals.layout,sunMask.layout))
        :(this.sunMaskedPipeline??=this.createLightingPipeline("additive",undefined,sunMask.layout));
      drawCalls+=this.drawLightingInstances(pass,masked,1,first,normals?.bindGroup,sunMask.bindGroup);
      first+=sunCount;
    }
    for (const range of ranges) {
      const next = pointLightFirstInstance + sunCount + range.lightIndex;
      drawCalls += drawAdditive(pass, additive, next - first, first);
      first = next + 1;
    }
    drawCalls += drawAdditive(pass, additive, debugFirstInstance - first, first);

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
          drawCalls += drawAdditive(lightPass, masked, 1,
            pointLightFirstInstance + sunCount + range.lightIndex, this.maskBindGroup);
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

  private writeLightingInstance(
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
    channels=65535,
    spot?: ResolvedPointLightSpot2D,
  ): number {
    const buffer = this.lightingStaging;
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
    buffer[offset + 13] = channels;
    if (this.irradiance) writePointLightSpot(buffer, offset + 14, spot, height / width);
    return offset + this.lightingInstanceFloats;
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

  clearTargets(): void { this.releaseMask(); }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.releaseMask();
    this.cookies?.destroy();
    for (const pipeline of this.cookiePipelines.values()) webGpuResources(this.device).releasePipeline(pipeline);
    this.cookiePipelines.clear();
    webGpuResources(this.device).destroy(this.lightingInstanceBuffer);
    webGpuResources(this.device).destroy(this.shadowVertexBuffer);
    this.lightingInstanceCapacityBytes = 0;
    this.shadowVertexCapacityBytes = 0;
    this.lightingStaging = new Float32Array(0);
    this.shadowStaging = new Float32Array(0);
    this.activePointLightScratch.length = 0;
  }

  private createLightingPipeline(blendMode: "normal" | "additive",normalLayout?:GPUBindGroupLayout,maskLayout?:GPUBindGroupLayout,cookieLayout?:GPUBindGroupLayout): GPURenderPipeline {
    const surface=this.surface && !!normalLayout;
    const channels=this.receiverMaskInput&&!!normalLayout;
    const module = this.device.createShaderModule({
      code: `
        struct Resolution {
          size: vec2f,
        };
        @group(0) @binding(0) var<uniform> resolution: Resolution;
        ${normalLayout?"@group(1) @binding(0) var normalBuffer:texture_2d<f32>;@group(1) @binding(1) var normalCoverage:texture_2d<f32>;":""}
        ${surface?"@group(1) @binding(2) var surfaceAlbedo:texture_2d<f32>;":""}
        ${channels?`@group(1) @binding(${surface?3:2}) var receiverMasks:texture_2d<f32>;`:""}
        ${surface?SPATIAL_SPECULAR_WGSL:""}
        ${cookieLayout ? `struct Cookie { uv:vec4f, rotation:vec4f };
        @group(3) @binding(0) var cookieImage:texture_2d<f32>;
        @group(3) @binding(1) var<uniform> cookie:Cookie;
        fn cookieWeight(position:vec2f, light:vec4f, scale:f32)->f32{
          let q=(position-light.xy)/vec2f(light.z,light.z*scale);
          let cs=cookie.rotation.xy;let local=vec2f(cs.x*q.x+cs.y*q.y,-cs.y*q.x+cs.x*q.y)*.5+.5;
          if(any(local<vec2f(0.))||any(local>vec2f(1.))){return 0.;}
          let size=textureDimensions(cookieImage);let maximum=vec2i(size)-vec2i(1);
          let lo=clamp(vec2i(floor(min(cookie.uv.xy,cookie.uv.zw)*vec2f(size))),vec2i(0),maximum);
          let hi=clamp(vec2i(ceil(max(cookie.uv.xy,cookie.uv.zw)*vec2f(size)))-vec2i(1),lo,maximum);
          let uv=mix(cookie.uv.xy,cookie.uv.zw,local);let value=textureLoad(cookieImage,clamp(vec2i(floor(uv*vec2f(size))),lo,hi),0);return value.r*value.a;
        }` : ""}

        ${maskLayout ? `@group(${normalLayout ? 2 : 1}) @binding(0) var shadowMask:texture_2d<f32>;
        @group(${normalLayout ? 2 : 1}) @binding(1) var<uniform> shadowTint:vec4f;` : ""}

        struct VertexInput {
          @location(0) rect: vec4f,
          @location(1) color: vec4f,
          @location(2) light: vec4f,
          @location(3) mode: f32,
          @location(4) channels:f32,
          ${this.irradiance ? "@location(5) spot:vec4f," : ""}
          @builtin(vertex_index) vertexIndex: u32,
        };

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) pixelPosition: vec2f,
          @location(1) color: vec4f,
          @location(2) light: vec4f,
          @location(3) mode: f32,
          @location(4) scaleY: f32,
          @location(5) @interpolate(flat) channels:f32,
          ${this.irradiance ? "@location(6) @interpolate(flat) spot:vec4f," : ""}
        };

        ${normalLayout?`
        fn normalResponse(input:VertexOutput,direction:vec3f)->f32 {
          let pixel=vec2i(input.position.xy);let coverage=clamp(${surface?"textureLoad(normalBuffer,pixel,0).a":"textureLoad(normalCoverage,pixel,0).r"},0.,1.);
          let raw=textureLoad(normalBuffer,pixel,0).rgb*2.-1.;var n=vec3f(0.,0.,1.);if(length(raw)>=0.02){n=normalize(raw);}
          return mix(1.,max(dot(n,direction),0.),coverage);
        }`:""}
        ${surface?`fn surfaceResponse(input:VertexOutput,direction:vec3f,direct:bool)->vec3f{
          let pixel=vec2i(input.position.xy);let material=textureLoad(normalCoverage,pixel,0).rgb;
          if(material.g<=.000001){return vec3f(0.);}
          var albedo=textureLoad(surfaceAlbedo,pixel,0).rgb/material.g;
          ${this.surfaceAlbedoSrgb?"albedo=select(albedo/12.92,pow((albedo+.055)/1.055,vec3f(2.4)),albedo>=vec3f(.04045));":""}
          if(!direct){return albedo;}
          let raw=textureLoad(normalBuffer,pixel,0).rgb*2.-1.;var n=vec3f(0.,0.,1.);if(length(raw)>=.02){n=normalize(raw);}
          var reflection=vec3f(0.);if(material.r>0.){reflection=directSpecular(n,direction,vec3f(0.,0.,1.),vec3f(.04),material.b/material.g)*(material.r/material.g);}
          return albedo*normalResponse(input,direction)+reflection;
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
          output.mode = input.mode;output.channels=input.channels;
          ${this.irradiance ? "output.spot=input.spot;" : ""}
          output.scaleY = input.rect.w / input.rect.z;
          return output;
        }

        @fragment
        fn fs_main(input: VertexOutput) -> @location(0) vec4f {
          ${channels?`var receiveShadow=true;
          if(input.mode>.5||input.mode<-.5){let channels=u32(input.channels);var receiver=vec2u(255u);
            if((channels&65536u)!=0u){receiver=vec2u(round(textureLoad(receiverMasks,vec2i(input.position.xy),0).rg*255.));}
            if((receiver.x&(channels&255u))==0u){return vec4f(0.);}
            receiveShadow=(receiver.y&((channels>>8u)&255u))!=0u;
          }`:""}
          if (input.mode > 0.5) {
            let distanceToLight = length((input.pixelPosition-input.light.xy)/vec2f(1.0,input.scaleY));
            let attenuation = max(1.0 - (distanceToLight / input.light.z), 0.0);
            var alpha = pow(attenuation, input.light.w) * input.color.a;
            ${this.irradiance ? `if(input.spot.z>=-1. && distanceToLight>.000001){
              let angle=dot((input.pixelPosition-input.light.xy)/vec2f(1.,input.scaleY)/distanceToLight,input.spot.xy);
              var cone=step(input.spot.z,angle);if(input.spot.w>input.spot.z+.0000001){cone=smoothstep(input.spot.z,input.spot.w,angle);}alpha*=cone;
            }` : ""}
            ${cookieLayout ? "alpha*=cookieWeight(input.pixelPosition,input.light,input.scaleY);" : ""}
            ${normalLayout?`let delta=vec3f(input.light.x-input.pixelPosition.x,(input.light.y-input.pixelPosition.y)/input.scaleY,max(input.mode-2.,0.));
            var direction=vec3f(0.,0.,1.);if(length(delta)>0.0001){direction=normalize(delta);}
            ${surface?"let response=surfaceResponse(input,direction,true);":"alpha *= normalResponse(input,direction);"}`:""}
            ${maskLayout ? `let transmission=mix(vec3f(1.),shadowTint.rgb,${channels?"select(0.,textureLoad(shadowMask,vec2i(input.position.xy),0).r,receiveShadow)":"textureLoad(shadowMask,vec2i(input.position.xy),0).r"});
            let visibility=max(max(transmission.r,transmission.g),transmission.b);
            if(visibility<=0.){return vec4f(0.);}
            return vec4f(${this.irradiance?"input.color.rgb":"clamp(input.color.rgb,vec3f(0.),vec3f(1.))"}*${surface?"response*":""}transmission/visibility,alpha*visibility);`
            : `return vec4f(input.color.rgb${surface?"*response":""},alpha);`}
          }
          var alpha=input.color.a;
          ${normalLayout&&!surface?"if(input.mode < -0.5){alpha*=normalResponse(input,input.light.xyz);}":""}
          ${maskLayout?`alpha*=1.-${channels?"select(0.,textureLoad(shadowMask,vec2i(input.position.xy),0).r,receiveShadow)":"textureLoad(shadowMask,vec2i(input.position.xy),0).r"};`:""}
          return vec4f(input.color.rgb${surface?"*surfaceResponse(input,input.light.xyz,input.mode<-.5)":""},alpha);
        }
      `,
    });

    return webGpuResources(this.device).createRenderPipeline({
      layout: cookieLayout ? this.device.createPipelineLayout({bindGroupLayouts:[this.solidPipeline.getBindGroupLayout(0),normalLayout??(this.emptyLayout??=this.device.createBindGroupLayout({entries:[]})),maskLayout??(this.emptyLayout??=this.device.createBindGroupLayout({entries:[]})),cookieLayout]}) : normalLayout || maskLayout ? this.device.createPipelineLayout({bindGroupLayouts:[this.solidPipeline.getBindGroupLayout(0),...(normalLayout?[normalLayout]:[]),...(maskLayout?[maskLayout]:[])]}):this.pipelineLayout,
      vertex: {
        module,
        entryPoint: "vs_main",
        buffers: [{
          arrayStride: this.lightingInstanceStride,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x4" },
            { shaderLocation: 1, offset: 4 * BYTES_PER_F32, format: "float32x4" },
            { shaderLocation: 2, offset: 8 * BYTES_PER_F32, format: "float32x4" },
            { shaderLocation: 3, offset: 12 * BYTES_PER_F32, format: "float32" },
            { shaderLocation: 4, offset: 13 * BYTES_PER_F32, format: "float32" },
            ...(this.irradiance ? [{ shaderLocation: 5, offset: 14 * BYTES_PER_F32, format: "float32x4" as const }] : []),
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
    cookie?: {group:GPUBindGroup;offset:number},
  ): number {
    if (instanceCount <= 0) {
      return 0;
    }

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.resolutionBindGroup);
    if(normals)pass.setBindGroup(1,normals);
    if(mask)pass.setBindGroup(normals?2:1,mask);
    if(cookie)pass.setBindGroup(3,cookie.group,[cookie.offset]);
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
