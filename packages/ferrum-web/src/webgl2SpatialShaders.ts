export const spatialVertexSource = `#version 300 es
layout(location=0) in vec3 a_position;layout(location=1) in vec2 a_uv;
layout(location=2) in vec4 a_color;layout(location=3) in float a_cutoff;
uniform mat4 u_camera;out vec2 v_uv;out vec4 v_color;out float v_cutoff;out vec3 v_world;
void main(){gl_Position=u_camera*vec4(a_position,1.0);v_uv=a_uv;v_color=a_color;v_cutoff=a_cutoff;v_world=a_position;}`;
export const spatialFragmentSource = `#version 300 es
precision highp float;precision highp samplerCube;
in vec2 v_uv;in vec4 v_color;in float v_cutoff;in vec3 v_world;
uniform highp sampler2D u_texture;uniform samplerCube u_shadowMap;
uniform bool u_textured,u_flip_y,u_environment,u_linearInput,u_lighting,u_fog;
uniform vec3 u_ambient,u_eye,u_forward,u_fogColor;
uniform vec2 u_fogRange;uniform vec4 u_lightPosition[4],u_lightColor[4];
uniform int u_lightCount,u_shadowIndex;uniform float u_shadowBias;
out vec4 outColor;
vec3 linearize(vec3 c){return mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c));}
void main(){vec2 uv=vec2(v_uv.x,u_flip_y?1.0-v_uv.y:v_uv.y);
vec4 c=(u_textured?texture(u_texture,uv):vec4(1.0))*v_color;
if(c.a<v_cutoff)discard;
if(!u_environment){outColor=vec4(c.rgb,1.0);return;}
vec3 albedo=u_linearInput?c.rgb:linearize(c.rgb),color=albedo;
if(u_lighting){
 vec3 n=cross(dFdx(v_world),dFdy(v_world));float nl=length(n);n=nl>0.000001?n/nl:vec3(0.,1.,0.);
 vec3 illumination=u_ambient;
 for(int i=0;i<4;i++){if(i>=u_lightCount)break;
  vec3 delta=u_lightPosition[i].xyz-v_world;float d=length(delta),radius=u_lightPosition[i].w;
  float falloff=max(1.0-(d*d)/(radius*radius),0.0);falloff*=falloff;
  float lambert=d>0.000001?max(dot(n,delta/d),0.0):1.0;
  float visibility=1.0;
  if(i==u_shadowIndex && d>u_shadowBias){
   float nearest=texture(u_shadowMap,-delta).r*radius;
   // A world-space bias alone cannot cover a grazing receiver's cubemap texel footprint.
   float slope=min(sqrt(max(1.0-lambert*lambert,0.0))/max(lambert,0.2),2.0);
   float receiverBias=u_shadowBias+2.0*d/float(textureSize(u_shadowMap,0).x)*slope;
   visibility=nearest+receiverBias<d?0.0:1.0;
  }
  illumination+=u_lightColor[i].rgb*u_lightColor[i].a*falloff*lambert*visibility;
 }
 color=albedo*illumination;
}
if(u_fog){float z=max(dot(v_world-u_eye,u_forward),0.0);float amount=clamp((z-u_fogRange.x)/(u_fogRange.y-u_fogRange.x),0.0,1.0);color=mix(color,u_fogColor,amount);}
outColor=vec4(color,1.0);}`;
export const spatialShadowFragmentSource = `#version 300 es
precision highp float;in vec2 v_uv;in vec4 v_color;in float v_cutoff;in vec3 v_world;
uniform sampler2D u_texture;uniform bool u_textured,u_flip_y;uniform vec4 u_shadowLight;
void main(){vec2 uv=vec2(v_uv.x,u_flip_y?1.0-v_uv.y:v_uv.y);
float alpha=(u_textured?texture(u_texture,uv).a:1.0)*v_color.a;
if(alpha<v_cutoff)discard;gl_FragDepth=clamp(length(v_world-u_shadowLight.xyz)/u_shadowLight.w,0.0,1.0);}`;
export const spatialCompositeVertexSource = `#version 300 es
out vec2 v_uv;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));v_uv=p;gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`;
export const spatialCompositeFragmentSource = `#version 300 es
precision highp float;in vec2 v_uv;out vec4 outColor;
uniform highp sampler2D u_color,u_depth;uniform vec2 u_size,u_nearFar;uniform bool u_perspective,u_dof,u_grade,u_encode;
uniform vec4 u_focus,u_gradeValues;uniform vec3 u_tint;
float viewDepth(float d){float n=u_nearFar.x,f=u_nearFar.y;return u_perspective?(2.0*n*f)/(f+n-(d*2.0-1.0)*(f-n)):mix(n,f,d);}
vec3 encode(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c));}
vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
void main(){float depth=texture(u_depth,v_uv).r;vec4 center=texture(u_color,v_uv);if(center.a<=0.0)discard;
float z=viewDepth(depth);vec3 color=center.rgb;
if(u_dof){
 float coc=clamp(max(abs(z-u_focus.x)-u_focus.y,0.0)/max(z,0.001)*u_focus.z,0.0,1.0);
 float radius=coc*u_focus.w;
 if(radius>0.05){vec3 sum=color*2.0;float weight=2.0;
  for(int i=0;i<12;i++){float angle=float(i)*2.39996323;float r=sqrt((float(i)+0.5)/12.0)*radius;
   vec2 uv=clamp(v_uv+vec2(cos(angle),sin(angle))*r/u_size,vec2(0.5)/u_size,vec2(1.0)-vec2(0.5)/u_size);
   float d=texture(u_depth,uv).r;if(d>=1.0)continue;
   float nz=viewDepth(d);if(abs(nz-z)>max(u_focus.y,z*0.02))continue;
   sum+=texture(u_color,uv).rgb;weight+=1.0;
  }color=sum/weight;
 }
}
if(u_grade){
 color*=exp2(u_gradeValues.x);
 if(u_gradeValues.w>1.5)color=aces(color);else if(u_gradeValues.w>0.5)color=color/(vec3(1.0)+color);
 float l=dot(color,vec3(0.2126,0.7152,0.0722));color=mix(vec3(l),color,u_gradeValues.z);
 color=max((color-vec3(0.18))*u_gradeValues.y+vec3(0.18),vec3(0.0))*u_tint;
}
outColor=vec4(u_encode?encode(color):color,1.0);}`;

export function createSpatialProgram(
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
): WebGLProgram {
  const p = gl.createProgram(),
    shaders: WebGLShader[] = [];
  if (!p) throw new Error("Spatial program allocation failed");
  try {
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Spatial shader allocation failed");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(
          gl.getShaderInfoLog(shader) ?? "Spatial shader compile failed",
        );
      gl.attachShader(p, shader);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(p) ?? "Spatial shader link failed");
    return p;
  } catch (error) {
    gl.deleteProgram(p);
    throw error;
  } finally {
    for (const s of shaders) gl.deleteShader(s);
  }
}
export function spatialUniform(
  gl: WebGL2RenderingContext,
  p: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(p, name);
  if (location === null) throw new Error(`Missing spatial uniform ${name}`);
  return location;
}
export interface SpatialGeometryUniforms {
  camera: WebGLUniformLocation;
  texture: WebGLUniformLocation;
  textured: WebGLUniformLocation;
  flip: WebGLUniformLocation;
}
