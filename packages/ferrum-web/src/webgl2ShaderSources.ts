// Internal shader sources shared by synchronous construction and async preparation.
export const WEBGL2_SHADER_SOURCES = {
  sprite: { vertex: `#version 300 es
      layout(location=0) in vec2 a_corner;layout(location=1) in vec4 a_rect;layout(location=2) in vec4 a_uv_rect;layout(location=3) in vec4 a_color;layout(location=4) in float a_rotation;layout(location=5) in float a_flags;
      uniform vec2 u_resolution;uniform vec2 u_screen_offset;uniform bool u_texture_flip_y;uniform float u_ground_y_scale;uniform vec3 u_ground_shadow_projection;out vec2 v_uv;out vec4 v_color;out vec2 v_corner;flat out float v_flags;
      void main(){vec2 corner=a_corner;vec2 local=(corner-vec2(0.5))*a_rect.zw;float c=cos(a_rotation);float s=sin(a_rotation);vec2 rotated=vec2(local.x*c-local.y*s,local.x*s+local.y*c);if((int(a_flags)&32)!=0){vec3 sun=u_ground_shadow_projection;rotated=vec2(sun.y*rotated.x-sun.x*rotated.y*sun.z,-sun.x*rotated.x-sun.y*rotated.y*sun.z);}if((int(a_flags)&4)!=0){rotated.y*=u_ground_y_scale;}vec2 position=a_rect.xy+u_screen_offset+a_rect.zw*0.5+rotated;vec2 z=position/u_resolution;vec2 clip=(z*2.0)-1.0;gl_Position=vec4(clip*vec2(1.0,-1.0),0.0,1.0);v_uv=mix(a_uv_rect.xy,a_uv_rect.zw,corner);if(u_texture_flip_y){v_uv.y=1.0-v_uv.y;}v_color=a_color;v_corner=corner;v_flags=a_flags;}`, fragment: `#version 300 es
      precision mediump float;in vec2 v_uv;in vec4 v_color;in vec2 v_corner;flat in float v_flags;uniform sampler2D u_texture;out vec4 outColor;
      void main(){if((int(v_flags)&32)!=0){outColor=vec4(v_color.rgb,texture(u_texture,v_uv).a*v_color.a);}else if((int(v_flags)&24)!=0){vec2 q=(v_corner-vec2(0.5))*2.0;if((int(v_flags)&8)!=0&&dot(q,q)>1.0){discard;}outColor=v_color;}else{outColor=texture(u_texture,v_uv)*v_color;}}` },
  debug: { vertex: `#version 300 es
      layout(location=0) in vec2 a_position;
      layout(location=1) in vec4 a_color;
      uniform vec2 u_resolution;
      out vec4 v_color;
      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 clip = (zeroToOne * 2.0) - 1.0;
        gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
        v_color = a_color;
      }`, fragment: `#version 300 es
      precision mediump float;
      in vec4 v_color;
      out vec4 outColor;
      void main() {
        outColor = v_color;
      }` },
  lighting: { vertex: `#version 300 es
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
      }`, fragment: `#version 300 es
      precision mediump float;
      in vec2 v_position;
      uniform int u_mode;
      uniform vec4 u_color;
      uniform vec2 u_light_center;
      uniform float u_light_radius;
      uniform float u_light_y_scale;
      uniform float u_light_falloff;
      out vec4 outColor;
      void main() {
        if (u_mode == 1) {
          float distanceToLight = length((v_position-u_light_center)/vec2(1.0,u_light_y_scale));
          float attenuation = max(1.0 - (distanceToLight / u_light_radius), 0.0);
          float alpha = pow(attenuation, u_light_falloff) * u_color.a;
          outColor = vec4(u_color.rgb, alpha);
        } else {
          outColor = u_color;
        }
      }` },
  shadow: { vertex: `#version 300 es
      precision mediump float;
      layout(location = 0) in vec2 a_position;
      uniform vec2 u_resolution;
      out vec2 v_position;
      void main() {
        vec2 clip = ((a_position / u_resolution) * 2.0) - 1.0;
        gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
        v_position = a_position;
      }`, fragment: `#version 300 es
      precision mediump float;
      in vec2 v_position;
      uniform vec4 u_color;
      uniform vec2 u_light_center;
      uniform float u_light_radius;
      uniform float u_light_y_scale;
      out vec4 outColor;
      void main() {
        float distanceToLight = length((v_position-u_light_center)/vec2(1.0,u_light_y_scale));
        float clippedAlpha = u_color.a * (1.0 - smoothstep(u_light_radius * 0.86, u_light_radius, distanceToLight));
        if (clippedAlpha <= 0.0) {
          discard;
        }
        outColor = vec4(u_color.rgb, clippedAlpha);
      }` },
  fullscreen: { vertex: `#version 300 es
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
      }`, fragment: `#version 300 es
      precision mediump float;
      uniform sampler2D u_scene;
      uniform vec2 u_texelSize;
      uniform int u_kind;
      uniform vec4 u_color;
      uniform vec4 u_params;
      uniform bool u_encode_srgb;
      uniform bool u_linear_working_space;
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

      vec4 applyPass() {
        vec4 scene = texture(u_scene, v_uv);
        if (u_kind == 1) {
          vec3 fadeColor = u_linear_working_space ? u_color.rgb * scene.a : u_color.rgb;
          return vec4(mix(scene.rgb, fadeColor, u_color.a), scene.a);
        }
        if (u_kind == 2) {
          vec3 bloom = bloomSample(v_uv, u_params.x, max(0.0, u_params.z));
          return vec4(scene.rgb + bloom * u_params.y, scene.a);
        }
        if (u_kind == 3) {
          return applyCrt(v_uv);
        }
        if (u_kind == 4) {
          float distanceFromCenter = distance(v_uv, vec2(0.5));
          float inner = max(0.0, u_params.y - u_params.z);
          float edge = smoothstep(inner, u_params.y, distanceFromCenter);
          float amount = edge * u_params.x * u_color.a;
          vec3 vignetteColor = u_linear_working_space ? u_color.rgb * scene.a : u_color.rgb;
          return vec4(mix(scene.rgb, vignetteColor, amount), scene.a);
        }
        if (u_kind == 5) {
          return applyGlitch(v_uv);
        }
        return scene;
      }

      vec3 linearToSrgb(vec3 value) {
        vec3 rgb = clamp(value, 0.0, 1.0);
        return mix(12.92 * rgb, 1.055 * pow(rgb, vec3(1.0 / 2.4)) - 0.055,
          step(vec3(0.0031308), rgb));
      }

      void main() {
        vec4 color = applyPass();
        // Sampling the sRGB targets yields premultiplied linear RGB; canvas expects premultiplied sRGB.
        if (u_encode_srgb) {
          color.rgb = color.a > 0.0 ? linearToSrgb(color.rgb / color.a) * color.a : vec3(0.0);
        }
        outColor = color;
      }` }
} as const;

export type WebGL2ShaderName = keyof typeof WEBGL2_SHADER_SOURCES;
