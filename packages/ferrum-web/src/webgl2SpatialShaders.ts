export const spatialVertexSource = `#version 300 es
layout(location=0) in vec3 a_position;layout(location=1) in vec2 a_uv;
layout(location=2) in vec4 a_color;layout(location=3) in float a_cutoff;layout(location=4) in vec3 a_normal;layout(location=5) in vec4 a_tangent;
layout(location=6) in mat4 a_instanceModel;
uniform mat4 u_model;uniform bool u_mesh,u_instanced;uniform vec4 u_modelColor;uniform float u_modelCutoff;out vec3 v_normal;out vec4 v_tangent;
uniform mat4 u_camera;out vec2 v_uv;out vec4 v_color;flat out float v_cutoff;out vec3 v_world;
void main(){mat4 model=u_instanced?a_instanceModel:u_model;vec4 world=u_mesh?model*vec4(a_position,1.):vec4(a_position,1.);gl_Position=u_camera*world;v_uv=a_uv;v_color=u_mesh?u_modelColor:a_color;v_cutoff=u_mesh?u_modelCutoff:a_cutoff;v_world=world.xyz;v_normal=u_mesh?mat3(model)*a_normal:vec3(0.);v_tangent=vec4(u_mesh?mat3(model)*a_tangent.xyz:vec3(0.),a_tangent.w);}`;
export const spatialFragmentSource = `#version 300 es
precision highp float;precision highp samplerCube;
in vec2 v_uv;in vec4 v_color;flat in float v_cutoff;in vec3 v_world;in vec3 v_normal;in vec4 v_tangent;uniform bool u_mesh;
uniform sampler2D u_emissiveMap;uniform bool u_hasEmissive,u_modelUnlit;uniform vec3 u_emissiveFactor;uniform float u_modelNormalScale;
uniform highp sampler2D u_texture;uniform sampler2D u_normalMap;uniform bool u_hasNormal,u_receiveShadow;uniform samplerCube u_shadowMap;
uniform bool u_textured,u_flip_y,u_environment,u_linearInput,u_lighting,u_fog,u_debug;
uniform vec3 u_ambient,u_eye,u_forward,u_fogColor;
uniform vec2 u_fogRange;uniform vec4 u_lightPosition[4],u_lightColor[4],u_lightCone[8];
uniform int u_lightCount,u_shadowIndex,u_shadowFilter;uniform float u_shadowBias;
uniform vec3 u_sunDirection,u_sunParams;uniform vec4 u_sunColor;uniform bool u_sunShadow;uniform mat4 u_sunMatrix;uniform sampler2D u_sunMap;
uniform vec4 u_hemisphereDirection;uniform vec3 u_hemisphereSky,u_hemisphereGround;uniform vec2 u_shadowNormalBias;
out vec4 outColor;
vec3 linearize(vec3 c){return mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c));}
vec3 encodeModel(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
void main(){vec2 uv=vec2(v_uv.x,u_flip_y?1.0-v_uv.y:v_uv.y);
vec4 texel=u_textured?texture(u_texture,uv):vec4(1.0);vec4 c=texel*v_color;
if(c.a<v_cutoff)discard;
if(u_debug){outColor=vec4(u_environment && !u_linearInput?linearize(c.rgb):c.rgb,c.a);return;}
vec3 albedo=u_mesh?texel.rgb*v_color.rgb:(u_linearInput?c.rgb:linearize(c.rgb)),color=albedo;
vec3 emission=vec3(0.);
if(u_mesh && !u_modelUnlit){vec3 e=u_hasEmissive?texture(u_emissiveMap,uv).rgb:vec3(1.);emission=e*u_emissiveFactor;}
if(!u_environment){vec3 modelColor=albedo+emission;outColor=vec4(u_mesh?(u_linearInput?modelColor:encodeModel(modelColor)):c.rgb,1.0);return;}
if(u_lighting && !(u_mesh && u_modelUnlit)){
 vec3 n=cross(dFdx(v_world),dFdy(v_world));float nl=length(n);n=nl>0.000001?n/nl:vec3(0.,1.,0.);vec3 geometricNormal=n;if(u_mesh && length(v_normal)>0.000001)n=normalize(v_normal)*(gl_FrontFacing?1.:-1.);
 if(u_hasNormal && u_mesh && length(v_normal)>0.000001){
  vec3 normal=normalize(v_normal),t=v_tangent.xyz-normal*dot(normal,v_tangent.xyz);
  vec3 sampleNormal=texture(u_normalMap,uv).rgb*2.-1.;sampleNormal.xy*=u_modelNormalScale;
  if(length(t)>0.000001 && length(sampleNormal)>0.000001){
   t=normalize(t);vec3 bt=cross(normal,t)*v_tangent.w;
   n=normalize(mat3(t,bt,normal)*sampleNormal)*(gl_FrontFacing?1.:-1.);
  }
 }
 else if(u_hasNormal && !u_mesh){
  vec2 a=dFdx(uv),b=dFdy(uv);float det=a.x*b.y-a.y*b.x;
  vec3 dx=dFdx(v_world),dy=dFdy(v_world);
  if(abs(det)>0.00000001){
   vec3 t=(dx*b.y-dy*a.y)/det,bt=-(dy*a.x-dx*b.x)/det;
   vec3 sampleNormal=texture(u_normalMap,uv).rgb*2.0-1.0;
   if(length(t)>0.000001 && length(bt)>0.000001 && length(sampleNormal)>0.000001)
    n=normalize(normalize(t)*sampleNormal.x+normalize(bt)*sampleNormal.y+n*sampleNormal.z);
  }
 }
 vec3 illumination=u_ambient;
 if(u_hemisphereDirection.w>0.){
  float weight=clamp(dot(n,normalize(u_hemisphereDirection.xyz))*.5+.5,0.,1.);
  illumination+=mix(u_hemisphereGround,u_hemisphereSky,weight)*u_hemisphereDirection.w;
 }
 for(int i=0;i<4;i++){if(i>=u_lightCount)break;
  vec3 delta=u_lightPosition[i].xyz-v_world;float d=length(delta),radius=u_lightPosition[i].w;
  float falloff=max(1.0-(d*d)/(radius*radius),0.0);falloff*=falloff;
  float lambert=d>0.000001?max(dot(n,delta/d),0.0):1.0;
  vec4 cone=u_lightCone[i*2],coneParams=u_lightCone[i*2+1];
  if(coneParams.y>0. && d>.000001){float angle=dot(-delta/d,cone.xyz);falloff*=coneParams.x>cone.w+.000001?smoothstep(cone.w,coneParams.x,angle):step(cone.w,angle);}
  float visibility=1.0;
  if(u_receiveShadow && i==u_shadowIndex){
   vec3 shadowDelta=delta-geometricNormal*u_shadowNormalBias.x;float shadowDistance=length(shadowDelta);
   if(shadowDistance>max(u_shadowBias,.000001)){
   float nearest=texture(u_shadowMap,-shadowDelta).r*radius;
   // A world-space bias alone cannot cover a grazing receiver's cubemap texel footprint.
   float incidence=max(dot(geometricNormal,shadowDelta/shadowDistance),0.);
   float slope=min(sqrt(max(1.0-incidence*incidence,0.0))/max(incidence,0.2),2.0);
   float receiverBias=u_shadowBias+2.0*shadowDistance/float(textureSize(u_shadowMap,0).x)*slope*(u_shadowFilter==1?3.:1.);
   visibility=nearest+receiverBias<shadowDistance?0.0:1.0;
   if(u_shadowFilter==1){
    vec3 axis=normalize(-shadowDelta),up=abs(axis.y)>.99?vec3(0.,0.,1.):vec3(0.,1.,0.);
    vec3 tangent=normalize(cross(axis,up)),bitangent=cross(axis,tangent);float stepSize=2./float(textureSize(u_shadowMap,0).x);
    visibility=0.;
    for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
     float value=texture(u_shadowMap,axis+(tangent*float(x)+bitangent*float(y))*stepSize).r*radius;
     visibility+=value+receiverBias<shadowDistance?0.:1.;
    }visibility/=9.;
   }
  }}
  illumination+=u_lightColor[i].rgb*u_lightColor[i].a*falloff*lambert*visibility;
 }
 if(u_sunColor.a>0.){
  float lambert=max(dot(n,normalize(u_sunDirection)),0.),visibility=1.;
  if(u_sunShadow && u_receiveShadow){
   vec4 clip=u_sunMatrix*vec4(v_world+geometricNormal*u_shadowNormalBias.y,1.);vec3 q=clip.xyz/clip.w*.5+.5;
   if(all(greaterThanEqual(q,vec3(0.))) && all(lessThanEqual(q,vec3(1.)))){
    vec2 texel=1./vec2(textureSize(u_sunMap,0));
    float incidence=max(dot(geometricNormal,normalize(u_sunDirection)),0.);
    float slope=min(sqrt(max(1.-incidence*incidence,0.))/max(incidence,.2),2.);
    float bias=(u_sunParams.y+2.*u_sunParams.z*texel.x*slope*(u_shadowFilter==1?3.:1.))/u_sunParams.x;
    visibility=texture(u_sunMap,q.xy).r+bias<q.z?0.:1.;
    if(u_shadowFilter==1){visibility=0.;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++) visibility+=texture(u_sunMap,q.xy+vec2(x,y)*texel).r+bias<q.z?0.:1.;visibility/=9.;}
   }
  }
  illumination+=u_sunColor.rgb*u_sunColor.a*lambert*visibility;
 }
 color=albedo*illumination;
}
color+=emission;
if(u_fog){float z=max(dot(v_world-u_eye,u_forward),0.0);float amount=clamp((z-u_fogRange.x)/(u_fogRange.y-u_fogRange.x),0.0,1.0);color=mix(color,u_fogColor,amount);}
outColor=vec4(color,1.0);}`;
export const spatialShadowFragmentSource = `#version 300 es
precision highp float;in vec2 v_uv;in vec4 v_color;flat in float v_cutoff;in vec3 v_world;
uniform sampler2D u_texture;uniform bool u_textured,u_flip_y,u_directionalShadow;uniform vec4 u_shadowLight;
void main(){vec2 uv=vec2(v_uv.x,u_flip_y?1.0-v_uv.y:v_uv.y);
float alpha=(u_textured?texture(u_texture,uv).a:1.0)*v_color.a;
if(alpha<v_cutoff)discard;gl_FragDepth=u_directionalShadow?gl_FragCoord.z:clamp(length(v_world-u_shadowLight.xyz)/u_shadowLight.w,0.0,1.0);}`;
export const spatialCompositeVertexSource = `#version 300 es
out vec2 v_uv;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));v_uv=p;gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`;
export const spatialCompositeFragmentSource = `#version 300 es
precision highp float;in vec2 v_uv;out vec4 outColor;
uniform highp sampler2D u_color,u_depth;uniform vec2 u_size,u_nearFar;uniform bool u_perspective,u_dof,u_grade,u_encode,u_highDof;
uniform vec4 u_focus,u_gradeValues,u_bloom,u_ao;uniform vec3 u_tint;uniform float u_projectionSize;
float viewDepth(float d){float n=u_nearFar.x,f=u_nearFar.y;return u_perspective?(2.0*n*f)/(f+n-(d*2.0-1.0)*(f-n)):mix(n,f,d);}
vec3 encode(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c));}
vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
vec3 viewPosition(vec2 uv,float z){float h=u_perspective?tan(u_projectionSize*.5)*z:u_projectionSize*.5;return vec3((uv*2.-1.)*vec2(u_size.x/u_size.y,1.)*h,-z);}
void main(){float depth=texture(u_depth,v_uv).r;vec4 center=texture(u_color,v_uv);if(center.a<=0.0 && (u_bloom.x<=0. || u_bloom.y<=0.))discard;
float z=viewDepth(depth);vec3 color=center.rgb;
if(u_dof && u_highDof){
 float centerDelta=z-u_focus.x;
 float centerRadius=sign(centerDelta)*clamp(max(abs(centerDelta)-u_focus.y,0.)/max(z,.001)*u_focus.z,0.,1.)*u_focus.w;
 vec3 farSum=color,nearSum=vec3(0.);float farWeight=1.,nearWeight=0.,kernelWeight=0.;
 for(int i=0;i<24;i++){
  float angle=float(i)*2.39996323,r=sqrt((float(i)+.5)/24.)*u_focus.w;
  vec2 uv=clamp(v_uv+vec2(cos(angle),sin(angle))*r/u_size,vec2(.5)/u_size,vec2(1.)-vec2(.5)/u_size);
  float kernel=1.-r/max(u_focus.w,.001);kernelWeight+=kernel;
  float d=texture(u_depth,uv).r;if(d>=1.)continue;
  float nz=viewDepth(d),delta=nz-u_focus.x;
  float sampleRadius=sign(delta)*clamp(max(abs(delta)-u_focus.y,0.)/max(nz,.001)*u_focus.z,0.,1.)*u_focus.w;
  vec3 sampleColor=texture(u_color,uv).rgb;
  if(centerRadius>r && sampleRadius>=0. && abs(nz-z)<=max(u_focus.y,z*.02)){farSum+=sampleColor*kernel;farWeight+=kernel;}
  if(sampleRadius < -r){float weight=kernel*smoothstep(0.,1.,-sampleRadius-r);nearSum+=sampleColor*weight;nearWeight+=weight;}
 }
 color=farSum/farWeight;
 if(nearWeight>.00001){float coverage=centerRadius<-.05?1.:clamp(nearWeight/max(kernelWeight,.00001),0.,1.);color=mix(color,nearSum/nearWeight,coverage);}
}
else if(u_dof){
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
// Contact AO from depth-reconstructed view-space normals; background is excluded.
vec3 position=viewPosition(v_uv,z);
if(u_ao.x>0. && u_ao.y>0. && depth<1.) {
 vec2 dx=vec2(2./u_size.x,0.),dy=vec2(0.,2./u_size.y);
 float zl=viewDepth(texture(u_depth,v_uv-dx).r),zr=viewDepth(texture(u_depth,v_uv+dx).r),zd=viewDepth(texture(u_depth,v_uv-dy).r),zu=viewDepth(texture(u_depth,v_uv+dy).r);
 vec3 tangent=abs(zl-z)<abs(zr-z)?position-viewPosition(v_uv-dx,zl):viewPosition(v_uv+dx,zr)-position;
 vec3 bitangent=abs(zd-z)<abs(zu-z)?position-viewPosition(v_uv-dy,zd):viewPosition(v_uv+dy,zu)-position;
 vec3 normal=cross(tangent,bitangent);normal=length(normal)>.00001?normalize(normal):vec3(0.,0.,1.);
 float h=u_perspective?tan(u_projectionSize*.5)*z:u_projectionSize*.5;
 float radius=min(64.,u_ao.z*u_size.y/(2.*max(h,.001))),occlusion=0.;
 for(int i=0;i<12;i++) {
  float angle=float(i)*2.39996323,r=sqrt((float(i)+.5)/12.)*radius;
  vec2 uv=v_uv+vec2(cos(angle),sin(angle))*r/u_size;
  if(any(lessThan(uv,vec2(0.))) || any(greaterThan(uv,vec2(1.))))continue;
  float d=texture(u_depth,uv).r;if(d>=1.)continue;
  vec3 delta=viewPosition(uv,viewDepth(d))-position;float distance=length(delta);
  if(distance>.0001)occlusion+=max((dot(normal,delta)-u_ao.w)/distance,0.)*max(1.-distance/u_ao.z,0.);
 }
 color*=1.-clamp(occlusion/12.*u_ao.y*3.,0.,.9);
}
if(u_bloom.x>0. && u_bloom.y>0.) {
 vec3 glow=vec3(0.);float weight=0.;
 for(int i=0;i<32;i++) {
  float angle=float(i)*2.39996323,r=sqrt((float(i)+.5)/32.),w=exp(-r*r*4.);
  vec2 uv=v_uv+vec2(cos(angle),sin(angle))*r*u_bloom.z/u_size;
  weight+=w;if(any(lessThan(uv,vec2(0.))) || any(greaterThan(uv,vec2(1.))))continue;
  vec3 sampleColor=texture(u_color,uv).rgb;float peak=max(sampleColor.r,max(sampleColor.g,sampleColor.b));
  glow+=sampleColor*(max(peak-u_bloom.w,0.)/max(peak,.00001))*w;
 }
 glow*=u_bloom.y/max(weight,.00001);
 if(center.a<=0. && max(glow.r,max(glow.g,glow.b))<.00001)discard;
 color+=glow;
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
  model: WebGLUniformLocation;
  mesh: WebGLUniformLocation;
  instanced: WebGLUniformLocation;
  modelColor: WebGLUniformLocation;
  modelCutoff: WebGLUniformLocation;
  texture: WebGLUniformLocation;
  textured: WebGLUniformLocation;
  flip: WebGLUniformLocation;
}
