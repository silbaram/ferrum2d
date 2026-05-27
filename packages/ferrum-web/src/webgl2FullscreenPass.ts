import type { ResolvedPostProcessPass } from "./cameraPostProcessing";

export interface WebGL2FullscreenRenderTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

export interface WebGL2FullscreenPassStats {
  drawCalls: number;
  passCount: number;
}

export interface WebGL2FullscreenPassOptions {
  sourceTexture: WebGLTexture;
  passes: readonly ResolvedPostProcessPass[];
  resolution: [number, number];
  scratchTargets: readonly [WebGL2FullscreenRenderTarget, WebGL2FullscreenRenderTarget];
}

const POST_PROCESS_KIND = {
  fade: 1,
  bloom: 2,
  crt: 3,
  vignette: 4,
  glitch: 5,
} as const;

export class WebGL2FullscreenPass {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly sceneLocation: WebGLUniformLocation;
  private readonly texelSizeLocation: WebGLUniformLocation;
  private readonly kindLocation: WebGLUniformLocation;
  private readonly colorLocation: WebGLUniformLocation;
  private readonly paramsLocation: WebGLUniformLocation;
  private destroyed = false;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = this.createProgram();
    const vao = this.gl.createVertexArray();
    if (!vao) {
      throw new Error("Fullscreen pass VAO 생성 실패");
    }
    this.vao = vao;
    this.sceneLocation = this.requireUniform("u_scene");
    this.texelSizeLocation = this.requireUniform("u_texelSize");
    this.kindLocation = this.requireUniform("u_kind");
    this.colorLocation = this.requireUniform("u_color");
    this.paramsLocation = this.requireUniform("u_params");
  }

  draw(options: WebGL2FullscreenPassOptions): WebGL2FullscreenPassStats {
    this.assertAlive();
    const passes = options.passes;
    if (passes.length === 0) {
      return { drawCalls: 0, passCount: 0 };
    }

    const wasDepthTestEnabled = this.gl.isEnabled(this.gl.DEPTH_TEST);
    const wasCullFaceEnabled = this.gl.isEnabled(this.gl.CULL_FACE);
    const wasBlendEnabled = this.gl.isEnabled(this.gl.BLEND);
    this.gl.disable(this.gl.DEPTH_TEST);
    this.gl.disable(this.gl.CULL_FACE);
    this.gl.disable(this.gl.BLEND);
    this.gl.useProgram(this.program);
    this.gl.bindVertexArray(this.vao);
    this.gl.uniform1i(this.sceneLocation, 0);
    this.gl.uniform2f(
      this.texelSizeLocation,
      1 / Math.max(1, options.resolution[0]),
      1 / Math.max(1, options.resolution[1]),
    );

    let sourceTexture = options.sourceTexture;
    let drawCalls = 0;
    let passCount = 0;
    try {
      for (const pass of passes) {
        const isLastPass = passCount === passes.length - 1;
        const destination = isLastPass ? undefined : options.scratchTargets[passCount % 2];
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, destination?.framebuffer ?? null);
        this.gl.viewport(0, 0, options.resolution[0], options.resolution[1]);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, sourceTexture);
        this.writePassUniforms(pass);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
        sourceTexture = destination?.texture ?? sourceTexture;
        drawCalls += 1;
        passCount += 1;
      }
    } finally {
      this.gl.bindTexture(this.gl.TEXTURE_2D, null);
      this.gl.bindVertexArray(null);
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      this.restoreCapability(this.gl.DEPTH_TEST, wasDepthTestEnabled);
      this.restoreCapability(this.gl.CULL_FACE, wasCullFaceEnabled);
      this.restoreCapability(this.gl.BLEND, wasBlendEnabled);
    }

    return { drawCalls, passCount };
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
  }

  private writePassUniforms(pass: ResolvedPostProcessPass): void {
    this.gl.uniform1i(this.kindLocation, POST_PROCESS_KIND[pass.kind]);
    if (pass.kind === "fade") {
      this.gl.uniform4f(this.colorLocation, pass.color[0], pass.color[1], pass.color[2], pass.color[3]);
      this.gl.uniform4f(this.paramsLocation, 0, 0, 0, 0);
      return;
    }
    if (pass.kind === "bloom") {
      this.gl.uniform4f(this.colorLocation, 0, 0, 0, 0);
      this.gl.uniform4f(this.paramsLocation, pass.threshold, pass.intensity, pass.radius, 0);
      return;
    }
    if (pass.kind === "crt") {
      this.gl.uniform4f(this.colorLocation, 0, 0, 0, 0);
      this.gl.uniform4f(this.paramsLocation, pass.curvature, pass.scanlineIntensity, pass.chromaticAberration, 0);
      return;
    }
    if (pass.kind === "vignette") {
      this.gl.uniform4f(this.colorLocation, pass.color[0], pass.color[1], pass.color[2], pass.color[3]);
      this.gl.uniform4f(this.paramsLocation, pass.intensity, pass.radius, pass.softness, 0);
      return;
    }
    this.gl.uniform4f(this.colorLocation, 0, 0, 0, 0);
    this.gl.uniform4f(this.paramsLocation, pass.intensity, pass.chromaticAberration, pass.seed, 0);
  }

  private createProgram(): WebGLProgram {
    const vert = this.compile(this.gl.VERTEX_SHADER, `#version 300 es
      precision mediump float;
      const vec2 POSITIONS[3] = vec2[3](
        vec2(-1.0, -1.0),
        vec2(3.0, -1.0),
        vec2(-1.0, 3.0)
      );
      out vec2 v_uv;
      void main() {
        vec2 position = POSITIONS[gl_VertexID];
        v_uv = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }`);
    const frag = this.compile(this.gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float;
      uniform sampler2D u_scene;
      uniform vec2 u_texelSize;
      uniform int u_kind;
      uniform vec4 u_color;
      uniform vec4 u_params;
      in vec2 v_uv;
      out vec4 outColor;

      float luminance(vec3 color) {
        return dot(color, vec3(0.2126, 0.7152, 0.0722));
      }

      vec3 bloomSample(vec2 uv, float threshold, float radius) {
        vec3 sum = vec3(0.0);
        float weightSum = 0.0;
        for (int y = -2; y <= 2; y += 1) {
          for (int x = -2; x <= 2; x += 1) {
            vec2 offset = vec2(float(x), float(y)) * u_texelSize * radius;
            vec3 color = texture(u_scene, clamp(uv + offset, vec2(0.0), vec2(1.0))).rgb;
            float bright = smoothstep(threshold, 1.0, luminance(color));
            float distanceWeight = 1.0 / (1.0 + length(vec2(float(x), float(y))));
            sum += color * bright * distanceWeight;
            weightSum += distanceWeight;
          }
        }
        return weightSum <= 0.0 ? vec3(0.0) : sum / weightSum;
      }

      float hash(float value) {
        return fract(sin(value * 12.9898) * 43758.5453);
      }

      vec4 applyCrt(vec2 uv) {
        vec2 centered = uv * 2.0 - 1.0;
        float radius = dot(centered, centered);
        vec2 warped = uv + centered * radius * u_params.x;
        if (warped.x < 0.0 || warped.x > 1.0 || warped.y < 0.0 || warped.y > 1.0) {
          return vec4(0.0, 0.0, 0.0, 1.0);
        }
        float chroma = u_params.z;
        vec3 color;
        color.r = texture(u_scene, warped + vec2(chroma, 0.0)).r;
        color.g = texture(u_scene, warped).g;
        color.b = texture(u_scene, warped - vec2(chroma, 0.0)).b;
        float scanline = 1.0 - u_params.y * (0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159265));
        return vec4(color * scanline, texture(u_scene, warped).a);
      }

      vec4 applyGlitch(vec2 uv) {
        float band = floor(uv.y * 48.0);
        float noise = hash(band + u_params.z);
        float offset = (noise - 0.5) * u_params.x;
        vec2 shifted = clamp(uv + vec2(offset, 0.0), vec2(0.0), vec2(1.0));
        float chroma = u_params.y + abs(offset) * 0.25;
        vec4 base = texture(u_scene, shifted);
        base.r = texture(u_scene, clamp(shifted + vec2(chroma, 0.0), vec2(0.0), vec2(1.0))).r;
        base.b = texture(u_scene, clamp(shifted - vec2(chroma, 0.0), vec2(0.0), vec2(1.0))).b;
        return base;
      }

      void main() {
        vec4 scene = texture(u_scene, v_uv);
        if (u_kind == 1) {
          outColor = vec4(mix(scene.rgb, u_color.rgb, u_color.a), scene.a);
          return;
        }
        if (u_kind == 2) {
          vec3 bloom = bloomSample(v_uv, u_params.x, max(0.0, u_params.z));
          outColor = vec4(scene.rgb + bloom * u_params.y, scene.a);
          return;
        }
        if (u_kind == 3) {
          outColor = applyCrt(v_uv);
          return;
        }
        if (u_kind == 4) {
          float distanceFromCenter = distance(v_uv, vec2(0.5));
          float inner = max(0.0, u_params.y - u_params.z);
          float edge = smoothstep(inner, u_params.y, distanceFromCenter);
          float amount = edge * u_params.x * u_color.a;
          outColor = vec4(mix(scene.rgb, u_color.rgb, amount), scene.a);
          return;
        }
        if (u_kind == 5) {
          outColor = applyGlitch(v_uv);
          return;
        }
        outColor = scene;
      }`);
    const program = this.gl.createProgram();
    if (!program) {
      throw new Error("Fullscreen shader program 생성 실패");
    }
    this.gl.attachShader(program, vert);
    this.gl.attachShader(program, frag);
    this.gl.linkProgram(program);
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      throw new Error(this.gl.getProgramInfoLog(program) ?? "Fullscreen shader 링크 실패");
    }
    this.gl.deleteShader(vert);
    this.gl.deleteShader(frag);
    return program;
  }

  private compile(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) {
      throw new Error("Fullscreen shader 생성 실패");
    }
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      throw new Error(this.gl.getShaderInfoLog(shader) ?? "Fullscreen shader 컴파일 실패");
    }
    return shader;
  }

  private requireUniform(name: string): WebGLUniformLocation {
    const location = this.gl.getUniformLocation(this.program, name);
    if (location === null) {
      throw new Error(`Fullscreen pass uniform location 조회 실패: ${name}`);
    }
    return location;
  }

  private restoreCapability(capability: number, enabled: boolean): void {
    if (enabled) {
      this.gl.enable(capability);
      return;
    }
    this.gl.disable(capability);
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("WebGL2FullscreenPass has been destroyed.");
    }
  }
}
