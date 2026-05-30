import type {
  ResolvedLightingScene2D,
  ResolvedLightingShadowOptions,
  ResolvedPointLight2D,
  TileOccluder2D,
} from "./lightingTypes.js";
import { LightingShadowGeometryCache } from "./lightingShadowGeometryCache.js";

export interface WebGL2LightingPassStats {
  drawCalls: number;
  pointLightCount: number;
  tileOccluderCount: number;
  shadowDrawCalls: number;
  shadowCasterCount: number;
}

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

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = this.createProgram();
    this.shadowProgram = this.createShadowProgram();
    const vao = this.gl.createVertexArray();
    if (!vao) {
      throw new Error("Lighting pass VAO 생성 실패");
    }
    this.vao = vao;
    const shadowVao = this.gl.createVertexArray();
    const shadowBuffer = this.gl.createBuffer();
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
    this.lightRadiusLocation = lightRadiusLocation;
    this.lightFalloffLocation = lightFalloffLocation;
    this.shadowResolutionLocation = shadowResolutionLocation;
    this.shadowColorLocation = shadowColorLocation;
    this.shadowLightCenterLocation = shadowLightCenterLocation;
    this.shadowLightRadiusLocation = shadowLightRadiusLocation;

    this.gl.bindVertexArray(this.shadowVao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.shadowBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.shadowVertexData.byteLength, this.gl.DYNAMIC_DRAW);
    this.gl.enableVertexAttribArray(0);
    this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
    this.gl.bindVertexArray(null);
  }

  draw(scene: ResolvedLightingScene2D, resolution: [number, number]): WebGL2LightingPassStats {
    this.assertAlive();
    if (!scene.enabled || resolution[0] <= 0 || resolution[1] <= 0) {
      return { drawCalls: 0, pointLightCount: 0, tileOccluderCount: 0, shadowDrawCalls: 0, shadowCasterCount: 0 };
    }

    this.gl.disable(this.gl.DEPTH_TEST);
    this.gl.disable(this.gl.CULL_FACE);
    this.gl.enable(this.gl.BLEND);
    this.bindRectProgram(resolution);

    let drawCalls = 0;
    if (scene.ambient[3] > 0) {
      this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
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
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);
    for (const light of activePointLights) {
      drawCalls += this.drawPointLight(light);
    }

    const shadowStats = this.drawShadows(scene.tileOccluders, activePointLights, scene.shadows, resolution);
    drawCalls += shadowStats.drawCalls;

    let tileOccluderCount = 0;
    if (scene.debug.tileOccluders) {
      this.bindRectProgram(resolution);
      this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
      for (const occluder of scene.tileOccluders) {
        drawCalls += this.drawTileOccluderDebug(occluder, scene.debug.color);
        tileOccluderCount += 1;
      }
    }

    this.gl.bindVertexArray(null);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    return {
      drawCalls,
      pointLightCount: activePointLights.length,
      tileOccluderCount,
      shadowDrawCalls: shadowStats.drawCalls,
      shadowCasterCount: shadowStats.casterCount,
    };
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
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
      light.y - radius,
      light.x + radius,
      light.y + radius,
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
    this.gl.uniform1f(this.lightFalloffLocation, light.falloff);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    return 1;
  }

  private drawTileOccluderDebug(occluder: TileOccluder2D, color: readonly [number, number, number, number]): number {
    return this.drawSolidRect(occluder.x, occluder.y, occluder.width, occluder.height, color);
  }

  private drawShadows(
    occluders: readonly TileOccluder2D[],
    lights: readonly ResolvedPointLight2D[],
    shadows: ResolvedLightingShadowOptions,
    resolution: [number, number],
  ): { drawCalls: number; casterCount: number } {
    if (!shadows.enabled || shadows.color[3] <= 0 || occluders.length === 0 || lights.length === 0) {
      return { drawCalls: 0, casterCount: 0 };
    }

    this.gl.useProgram(this.shadowProgram);
    this.gl.bindVertexArray(this.shadowVao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.shadowBuffer);
    this.gl.uniform2f(this.shadowResolutionLocation, resolution[0], resolution[1]);
    this.gl.uniform4f(this.shadowColorLocation, shadows.color[0], shadows.color[1], shadows.color[2], shadows.color[3]);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    this.shadowClipRect.x = 0;
    this.shadowClipRect.y = 0;
    this.shadowClipRect.width = resolution[0];
    this.shadowClipRect.height = resolution[1];
    const occluderVersion = this.shadowGeometryCache.syncOccluders(occluders);

    let drawCalls = 0;
    let casterCount = 0;
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
      if (shadowGeometry.floatCount > 0) {
        this.ensureShadowVertexDataCapacity(shadowGeometry.floatCount);
        this.gl.uniform2f(this.shadowLightCenterLocation, light.x, light.y);
        this.gl.uniform1f(this.shadowLightRadiusLocation, light.radius);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, shadowGeometry.positions, 0, shadowGeometry.floatCount);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, shadowGeometry.floatCount / 2);
        drawCalls += 1;
        casterCount += shadowGeometry.casterCount;
      }
    }
    return { drawCalls, casterCount };
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
  ): number {
    this.gl.uniform1i(this.modeLocation, MODE_SOLID);
    this.gl.uniform4f(this.rectLocation, x, y, x + width, y + height);
    this.gl.uniform4f(this.colorLocation, color[0], color[1], color[2], color[3]);
    this.gl.uniform2f(this.lightCenterLocation, 0, 0);
    this.gl.uniform1f(this.lightRadiusLocation, 1);
    this.gl.uniform1f(this.lightFalloffLocation, 1);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    return 1;
  }

  private createProgram(): WebGLProgram {
    const vert = this.compile(this.gl.VERTEX_SHADER, `#version 300 es
      precision mediump float;
      uniform vec2 u_resolution;
      uniform vec4 u_rect;
      out vec2 v_position;
      vec2 cornerForVertex(int v) {
        if (v == 0) return vec2(0.0, 0.0);
        if (v == 1) return vec2(1.0, 0.0);
        if (v == 2) return vec2(0.0, 1.0);
        if (v == 3) return vec2(0.0, 1.0);
        if (v == 4) return vec2(1.0, 0.0);
        return vec2(1.0, 1.0);
      }
      void main() {
        vec2 corner = cornerForVertex(gl_VertexID % 6);
        vec2 position = mix(u_rect.xy, u_rect.zw, corner);
        vec2 clip = ((position / u_resolution) * 2.0) - 1.0;
        gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
        v_position = position;
      }`);
    const frag = this.compile(this.gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float;
      in vec2 v_position;
      uniform int u_mode;
      uniform vec4 u_color;
      uniform vec2 u_light_center;
      uniform float u_light_radius;
      uniform float u_light_falloff;
      out vec4 outColor;
      void main() {
        if (u_mode == ${MODE_POINT_LIGHT}) {
          float distanceToLight = distance(v_position, u_light_center);
          float attenuation = max(1.0 - (distanceToLight / u_light_radius), 0.0);
          float alpha = pow(attenuation, u_light_falloff) * u_color.a;
          outColor = vec4(u_color.rgb, alpha);
        } else {
          outColor = u_color;
        }
      }`);
    const program = this.gl.createProgram();
    if (!program) {
      throw new Error("Lighting shader program 생성 실패");
    }
    this.gl.attachShader(program, vert);
    this.gl.attachShader(program, frag);
    this.gl.linkProgram(program);
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      throw new Error(this.gl.getProgramInfoLog(program) ?? "Lighting shader 링크 실패");
    }
    this.gl.deleteShader(vert);
    this.gl.deleteShader(frag);
    return program;
  }

  private createShadowProgram(): WebGLProgram {
    const vert = this.compile(this.gl.VERTEX_SHADER, `#version 300 es
      precision mediump float;
      layout(location = 0) in vec2 a_position;
      uniform vec2 u_resolution;
      out vec2 v_position;
      void main() {
        vec2 clip = ((a_position / u_resolution) * 2.0) - 1.0;
        gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
        v_position = a_position;
      }`);
    const frag = this.compile(this.gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float;
      in vec2 v_position;
      uniform vec4 u_color;
      uniform vec2 u_light_center;
      uniform float u_light_radius;
      out vec4 outColor;
      void main() {
        float distanceToLight = distance(v_position, u_light_center);
        float clippedAlpha = u_color.a * (1.0 - smoothstep(u_light_radius * 0.86, u_light_radius, distanceToLight));
        if (clippedAlpha <= 0.0) {
          discard;
        }
        outColor = vec4(u_color.rgb, clippedAlpha);
      }`);
    const program = this.gl.createProgram();
    if (!program) {
      throw new Error("Lighting shadow shader program 생성 실패");
    }
    this.gl.attachShader(program, vert);
    this.gl.attachShader(program, frag);
    this.gl.linkProgram(program);
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      throw new Error(this.gl.getProgramInfoLog(program) ?? "Lighting shadow shader 링크 실패");
    }
    this.gl.deleteShader(vert);
    this.gl.deleteShader(frag);
    return program;
  }

  private compile(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) {
      throw new Error("Lighting shader 생성 실패");
    }
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      throw new Error(this.gl.getShaderInfoLog(shader) ?? "Lighting shader 컴파일 실패");
    }
    return shader;
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
