import { createWebGL2Program } from "./webgl2ShaderPrograms";
import type {
  ResolvedLightingScene2D,
  ResolvedLightingShadowOptions,
  ResolvedPointLight2D,
  TileOccluder2D,
} from "./lightingTypes.js";
import { LightingShadowGeometryCache } from "./lightingShadowGeometryCache.js";
import { setSpriteBlend } from "./webgl2Blend.js";
import type { WebGL2SpriteNormalTargets } from "./webgl2SpriteNormals.js";

export interface WebGL2LightingPassStats {
  drawCalls: number;
  pointLightCount: number;
  tileOccluderCount: number;
  shadowDrawCalls: number;
  shadowCasterCount: number;
}
interface LightingTarget {
  width: number;
  height: number;
  restore: () => void;
}
interface MaskState { scissor: boolean; colorMask: boolean[]; }

const MODE_SOLID = 0;
const MODE_POINT_LIGHT = 1;

export class WebGL2LightingPass {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly shadowProgram: WebGLProgram;
  private readonly shadowVao: WebGLVertexArrayObject;
  private readonly shadowBuffer: WebGLBuffer;
  private readonly resolutionLocation: WebGLUniformLocation;
  private readonly rectLocation: WebGLUniformLocation;
  private readonly colorLocation: WebGLUniformLocation;
  private readonly modeLocation: WebGLUniformLocation;
  private readonly lightCenterLocation: WebGLUniformLocation;
  private readonly lightYScaleLocation: WebGLUniformLocation;
  private readonly shadowLightYScaleLocation: WebGLUniformLocation;
  private readonly lightRadiusLocation: WebGLUniformLocation;
  private readonly lightFalloffLocation: WebGLUniformLocation;
  private readonly shadowResolutionLocation: WebGLUniformLocation;
  private readonly shadowColorLocation: WebGLUniformLocation;
  private readonly shadowLightCenterLocation: WebGLUniformLocation;
  private readonly shadowLightRadiusLocation: WebGLUniformLocation;
  private shadowVertexData = new Float32Array(12);
  private readonly activePointLightScratch: ResolvedPointLight2D[] = [];
  private readonly shadowGeometryCache = new LightingShadowGeometryCache();
  private readonly shadowClipRect = { x: 0, y: 0, width: 0, height: 0 };
  private destroyed = false;
  private maskTexture?: WebGLTexture;
  private maskFramebuffer?: WebGLFramebuffer;
  private maskWidth = 0;
  private maskHeight = 0;
  private readonly emptyMask = new Float32Array(4);
  private readonly maskUniforms: { has: WebGLUniformLocation; texture: WebGLUniformLocation; tint: WebGLUniformLocation };
  private readonly normalUniforms:{has:WebGLUniformLocation;normal:WebGLUniformLocation;coverage:WebGLUniformLocation;height:WebGLUniformLocation;direction:WebGLUniformLocation};

  constructor(private readonly gl: WebGL2RenderingContext, private readonly linearTarget = false) {
    const programs: WebGLProgram[] = [];
    const vaos: WebGLVertexArrayObject[] = [];
    const buffers: WebGLBuffer[] = [];
    try {
      this.program = createWebGL2Program(this.gl, "lighting");
      programs.push(this.program);
      this.shadowProgram = createWebGL2Program(this.gl, "shadow");
      programs.push(this.shadowProgram);
      const vao = this.gl.createVertexArray();
      if (vao) vaos.push(vao);
      if (!vao) {
        throw new Error("Lighting pass VAO 생성 실패");
      }
      this.vao = vao;
      const shadowVao = this.gl.createVertexArray();
      if (shadowVao) vaos.push(shadowVao);
      const shadowBuffer = this.gl.createBuffer();
      if (shadowBuffer) buffers.push(shadowBuffer);
      if (!shadowVao || !shadowBuffer) {
        throw new Error("Lighting shadow buffer 생성 실패");
      }
      this.shadowVao = shadowVao;
      this.shadowBuffer = shadowBuffer;

      const resolutionLocation = this.gl.getUniformLocation(this.program, "u_resolution");
      const rectLocation = this.gl.getUniformLocation(this.program, "u_rect");
      const colorLocation = this.gl.getUniformLocation(this.program, "u_color");
      const modeLocation = this.gl.getUniformLocation(this.program, "u_mode");
      const lightCenterLocation = this.gl.getUniformLocation(this.program, "u_light_center");
      const lightRadiusLocation = this.gl.getUniformLocation(this.program, "u_light_radius");
      const lightFalloffLocation = this.gl.getUniformLocation(this.program, "u_light_falloff");
      const shadowResolutionLocation = this.gl.getUniformLocation(this.shadowProgram, "u_resolution");
      const shadowColorLocation = this.gl.getUniformLocation(this.shadowProgram, "u_color");
      const shadowLightCenterLocation = this.gl.getUniformLocation(this.shadowProgram, "u_light_center");
      const shadowLightRadiusLocation = this.gl.getUniformLocation(this.shadowProgram, "u_light_radius");
      if (
        !resolutionLocation ||
        !rectLocation ||
        !colorLocation ||
        !modeLocation ||
        !lightCenterLocation ||
        !lightRadiusLocation ||
        !lightFalloffLocation ||
        !shadowResolutionLocation ||
        !shadowColorLocation ||
        !shadowLightCenterLocation ||
        !shadowLightRadiusLocation
      ) {
        throw new Error("Lighting pass uniform location 조회 실패");
      }

      this.resolutionLocation = resolutionLocation;
      this.rectLocation = rectLocation;
      this.colorLocation = colorLocation;
      this.modeLocation = modeLocation;
      this.lightCenterLocation = lightCenterLocation;
      const lightYScaleLocation = this.gl.getUniformLocation(this.program, "u_light_y_scale");
      const shadowLightYScaleLocation = this.gl.getUniformLocation(this.shadowProgram, "u_light_y_scale");
      if (!lightYScaleLocation || !shadowLightYScaleLocation) throw new Error("Missing light projection uniforms");
      this.lightYScaleLocation = lightYScaleLocation;
      this.shadowLightYScaleLocation = shadowLightYScaleLocation;
      this.lightRadiusLocation = lightRadiusLocation;
      this.lightFalloffLocation = lightFalloffLocation;
      this.shadowResolutionLocation = shadowResolutionLocation;
      this.shadowColorLocation = shadowColorLocation;
      this.shadowLightCenterLocation = shadowLightCenterLocation;
      this.shadowLightRadiusLocation = shadowLightRadiusLocation;
      const uniform=(name:string)=>{const location=gl.getUniformLocation(this.program,name);if(!location)throw Error("Missing lighting uniform "+name);return location;};
      this.normalUniforms={has:uniform("u_has_normals"),normal:uniform("u_normal_buffer"),coverage:uniform("u_normal_coverage"),height:uniform("u_light_height"),direction:uniform("u_light_direction")};
      this.maskUniforms={has:uniform("u_has_shadow"),texture:uniform("u_shadow_mask"),tint:uniform("u_shadow_tint")};

      this.gl.bindVertexArray(this.shadowVao);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.shadowBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.shadowVertexData.byteLength, this.gl.DYNAMIC_DRAW);
      this.gl.enableVertexAttribArray(0);
      this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
      this.gl.bindVertexArray(null);
    } catch (error) {
      for (const buffer of buffers) gl.deleteBuffer(buffer);
      for (const vao of vaos) gl.deleteVertexArray(vao);
      for (const program of programs) gl.deleteProgram(program);
      throw error;
    }
  }

  draw(scene: ResolvedLightingScene2D, resolution: [number, number],normals?:WebGL2SpriteNormalTargets,target?:LightingTarget,sunMask?:WebGLTexture): WebGL2LightingPassStats {
    this.assertAlive();
    if (!scene.enabled || resolution[0] <= 0 || resolution[1] <= 0) {
      this.releaseMask();
      return { drawCalls: 0, pointLightCount: 0, tileOccluderCount: 0, shadowDrawCalls: 0, shadowCasterCount: 0 };
    }

    this.gl.disable(this.gl.DEPTH_TEST);
    this.gl.disable(this.gl.CULL_FACE);
    this.gl.enable(this.gl.BLEND);
    this.gl.blendEquation(this.gl.FUNC_ADD);
    this.bindRectProgram(resolution);
    this.gl.uniform1i(this.normalUniforms.has,normals?1:0);this.gl.uniform1i(this.normalUniforms.normal,1);this.gl.uniform1i(this.normalUniforms.coverage,2);
    this.gl.uniform1i(this.maskUniforms.has,0);this.gl.uniform1i(this.maskUniforms.texture,3);
    this.gl.uniform3f(this.maskUniforms.tint,scene.shadows.color[0],scene.shadows.color[1],scene.shadows.color[2]);
    if(normals){this.gl.activeTexture(this.gl.TEXTURE1);this.gl.bindTexture(this.gl.TEXTURE_2D,normals.normal);this.gl.activeTexture(this.gl.TEXTURE2);this.gl.bindTexture(this.gl.TEXTURE_2D,normals.coverage);this.gl.activeTexture(this.gl.TEXTURE0);}

    let drawCalls = 0;
    if (scene.ambient[3] > 0) {
      setSpriteBlend(this.gl, this.linearTarget);
      drawCalls += this.drawSolidRect(0, 0, resolution[0], resolution[1], scene.ambient);
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
    setSpriteBlend(this.gl, this.linearTarget, true);
    const sun = scene.directionalLight;
    if (sun !== undefined && sun.intensity > 0) {
      if(sunMask){this.gl.uniform1i(this.maskUniforms.has,1);this.gl.activeTexture(this.gl.TEXTURE3);this.gl.bindTexture(this.gl.TEXTURE_2D,sunMask);this.gl.activeTexture(this.gl.TEXTURE0);}
      const elevation=sun.elevationRadians??Math.PI/4,c=Math.cos(elevation);
      this.gl.uniform3f(this.normalUniforms.direction,-sun.directionX*c,-sun.directionY*c,Math.sin(elevation));
      drawCalls += this.drawSolidRect(0, 0, resolution[0], resolution[1], [sun.color[0], sun.color[1], sun.color[2], sun.intensity],2);
      this.gl.uniform1i(this.maskUniforms.has,0);
    }
    const shadowsActive = scene.shadows.enabled && scene.shadows.color[3] > 0 &&
      scene.tileOccluders.length > 0 && activePointLights.length > 0;
    const occluderVersion = shadowsActive ? this.shadowGeometryCache.syncOccluders(scene.tileOccluders) : -1;
    this.shadowClipRect.width = resolution[0];this.shadowClipRect.height = resolution[1];
    let shadowDrawCalls=0,shadowCasterCount=0;
    let maskState: MaskState | undefined;
    for (let index=0;index<activePointLights.length;index++) {
      const light=activePointLights[index];
      const geometry=shadowsActive
        ? this.shadowGeometryCache.resolveLightGeometry(index,occluderVersion,scene.tileOccluders,light,scene.shadows,this.shadowClipRect):undefined;
      if(geometry && geometry.floatCount>0){
        if(!target)throw Error("Shadowed lighting requires a destination restore callback");
        // Capture caller state once, even when many lights reuse the mask.
        maskState ??= {scissor:this.gl.isEnabled(this.gl.SCISSOR_TEST),colorMask:this.gl.getParameter(this.gl.COLOR_WRITEMASK) as boolean[]};
        this.drawMask(geometry.positions,geometry.floatCount,light,scene.shadows,resolution,target,maskState);
        this.bindRectProgram(resolution);
        this.gl.uniform1i(this.maskUniforms.has,1);
        this.gl.activeTexture(this.gl.TEXTURE3);this.gl.bindTexture(this.gl.TEXTURE_2D,this.maskTexture!);this.gl.activeTexture(this.gl.TEXTURE0);
        setSpriteBlend(this.gl,this.linearTarget,true);
        shadowDrawCalls++;shadowCasterCount+=geometry.casterCount;
      }else this.gl.uniform1i(this.maskUniforms.has,0);
      drawCalls += this.drawPointLight(light);
    }
    if(!shadowDrawCalls)this.releaseMask();
    drawCalls += shadowDrawCalls;

    let tileOccluderCount = 0;
    if (scene.debug.tileOccluders) {
      this.bindRectProgram(resolution);
      setSpriteBlend(this.gl, this.linearTarget);
      for (const occluder of scene.tileOccluders) {
        drawCalls += this.drawTileOccluderDebug(occluder, scene.debug.color);
        tileOccluderCount += 1;
      }
    }

    this.gl.bindVertexArray(null);
    setSpriteBlend(this.gl, this.linearTarget);
    return {
      drawCalls,
      pointLightCount: activePointLights.length,
      tileOccluderCount,
      shadowDrawCalls,
      shadowCasterCount,
    };
  }

  /** Internal allocation summary; no GPU queries or per-command work. */
  resourceStats() {
    return {
      bufferCount: this.destroyed ? 0 : 1,
      programCount: this.destroyed ? 0 : 2,
      bufferBytes: this.destroyed ? 0 : this.shadowVertexData.byteLength,
      textureCount:this.maskTexture?1:0,renderTargetCount:this.maskTexture?1:0,textureBytes:this.maskWidth*this.maskHeight,
    };
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.releaseMask();
    this.gl.deleteBuffer(this.shadowBuffer);
    this.gl.deleteVertexArray(this.shadowVao);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.shadowProgram);
    this.gl.deleteProgram(this.program);
  }

  private bindRectProgram(resolution: [number, number]): void {
    this.gl.useProgram(this.program);
    this.gl.bindVertexArray(this.vao);
    this.gl.uniform2f(this.resolutionLocation, resolution[0], resolution[1]);
  }

  private drawPointLight(light: ResolvedPointLight2D): number {
    const radius = light.radius;
    this.gl.uniform1i(this.modeLocation, MODE_POINT_LIGHT);
    this.gl.uniform4f(
      this.rectLocation,
      light.x - radius,
      light.y - (light.radiusY ?? radius),
      light.x + radius,
      light.y + (light.radiusY ?? radius),
    );
    this.gl.uniform4f(
      this.colorLocation,
      light.color[0] * light.intensity,
      light.color[1] * light.intensity,
      light.color[2] * light.intensity,
      light.color[3],
    );
    this.gl.uniform2f(this.lightCenterLocation, light.x, light.y);
    this.gl.uniform1f(this.lightRadiusLocation, radius);
    this.gl.uniform1f(this.lightYScaleLocation, (light.radiusY ?? radius) / radius);
    this.gl.uniform1f(this.lightFalloffLocation, light.falloff);
    this.gl.uniform1f(this.normalUniforms.height,light.height??light.radius*0.5);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    return 1;
  }

  private drawTileOccluderDebug(occluder: TileOccluder2D, color: readonly [number, number, number, number]): number {
    return this.drawSolidRect(occluder.x, occluder.y, occluder.width, occluder.height, color);
  }

  private drawMask(positions:Float32Array,floatCount:number,light:ResolvedPointLight2D,shadows:ResolvedLightingShadowOptions,resolution:[number,number],target:LightingTarget,state:MaskState):void {
    const gl=this.gl,{scissor,colorMask}=state;
    try {
      this.ensureMask(target.width,target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.maskFramebuffer!);gl.viewport(0,0,target.width,target.height);
      gl.disable(gl.SCISSOR_TEST);gl.colorMask(true,true,true,true);
      gl.clearBufferfv(gl.COLOR,0,this.emptyMask);
      gl.useProgram(this.shadowProgram);gl.bindVertexArray(this.shadowVao);gl.bindBuffer(gl.ARRAY_BUFFER,this.shadowBuffer);
      gl.uniform2f(this.shadowResolutionLocation,resolution[0],resolution[1]);
      gl.uniform4f(this.shadowColorLocation,0,0,0,shadows.color[3]);
      gl.uniform2f(this.shadowLightCenterLocation,light.x,light.y);gl.uniform1f(this.shadowLightRadiusLocation,light.radius);
      gl.uniform1f(this.shadowLightYScaleLocation,(light.radiusY??light.radius)/light.radius);
      gl.blendEquation(gl.MAX);gl.blendFunc(gl.ONE,gl.ONE);
      this.ensureShadowVertexDataCapacity(floatCount);
      gl.bufferSubData(gl.ARRAY_BUFFER,0,positions,0,floatCount);gl.drawArrays(gl.TRIANGLES,0,floatCount/2);
    } finally {
      target.restore();gl.blendEquation(gl.FUNC_ADD);
      if(scissor)gl.enable(gl.SCISSOR_TEST);else gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(colorMask[0],colorMask[1],colorMask[2],colorMask[3]);gl.activeTexture(gl.TEXTURE0);
    }
  }
  private ensureMask(width:number,height:number):void {
    if(this.maskTexture && width===this.maskWidth && height===this.maskHeight)return;
    const gl=this.gl,limit=gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>limit||height>limit)throw Error("Invalid lighting shadow mask dimensions");
    const framebuffer=gl.createFramebuffer(),texture=gl.createTexture();
    try {
      if(!framebuffer||!texture)throw Error("Lighting shadow mask allocation failed");
      gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,width,height,0,gl.RED,gl.UNSIGNED_BYTE,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error("Lighting shadow mask is incomplete");
    } catch(error) {if(framebuffer)gl.deleteFramebuffer(framebuffer);if(texture)gl.deleteTexture(texture);throw error;}
    this.releaseMask();this.maskTexture=texture!;this.maskFramebuffer=framebuffer!;this.maskWidth=width;this.maskHeight=height;
  }
  private releaseMask():void {
    if(this.maskTexture)this.gl.deleteTexture(this.maskTexture);
    if(this.maskFramebuffer)this.gl.deleteFramebuffer(this.maskFramebuffer);
    this.maskTexture=undefined;this.maskFramebuffer=undefined;this.maskWidth=this.maskHeight=0;
  }

  private ensureShadowVertexDataCapacity(floatCount: number): void {
    if (this.shadowVertexData.length >= floatCount) {
      return;
    }
    this.shadowVertexData = new Float32Array(nextPowerOfTwo(floatCount));
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.shadowVertexData.byteLength, this.gl.DYNAMIC_DRAW);
  }

  private drawSolidRect(
    x: number,
    y: number,
    width: number,
    height: number,
    color: readonly [number, number, number, number],
    mode = MODE_SOLID,
  ): number {
    this.gl.uniform1i(this.modeLocation, mode);
    this.gl.uniform4f(this.rectLocation, x, y, x + width, y + height);
    this.gl.uniform4f(this.colorLocation, color[0], color[1], color[2], color[3]);
    this.gl.uniform2f(this.lightCenterLocation, 0, 0);
    this.gl.uniform1f(this.lightRadiusLocation, 1);
    this.gl.uniform1f(this.lightYScaleLocation, 1);
    this.gl.uniform1f(this.lightFalloffLocation, 1);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    return 1;
  }


  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("WebGL2LightingPass has been destroyed.");
    }
  }
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(value, 1)));
}
