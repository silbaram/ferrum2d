// Arithmetic test only: consume the exact helper bundled with the packed renderer.
import { HEIGHT_FOG_GLSL, HEIGHT_FOG_WGSL } from "/package/dist/spatialHeightFogShaders.js";
import { check } from "/fixture.mjs";
export async function probeHeightFogPrecision(cases){
 const canvas=document.createElement("canvas"),gl=canvas.getContext("webgl2");check(gl&&gl.getExtension("EXT_color_buffer_float"),"Height fog precision needs float target");
 const shaders=[],program=gl.createProgram(),texture=gl.createTexture(),fbo=gl.createFramebuffer(),vao=gl.createVertexArray();let device;
 try{
  for(const [type,source]of [[gl.VERTEX_SHADER,`#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`],[gl.FRAGMENT_SHADER,`#version 300 es\nprecision highp float;uniform vec4 params[3];out vec4 color;\n${HEIGHT_FOG_GLSL}\nvoid main(){color=vec4(heightFogAmount(params[0].x,params[0].y,params[0].z-params[1].y,params[0].w-params[1].y,params[1],params[2].xy),0.,0.,1.);}`]]){
   const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);check(gl.getShaderParameter(shader,gl.COMPILE_STATUS),"Height fog arithmetic GLSL compile",gl.getShaderInfoLog(shader));gl.attachShader(program,shader);
  }
  gl.linkProgram(program);check(gl.getProgramParameter(program,gl.LINK_STATUS),"Height fog arithmetic GLSL link",gl.getProgramInfoLog(program));
  gl.bindTexture(gl.TEXTURE_2D,texture);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32F,1,1);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);check(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,"Height fog float framebuffer incomplete");
  gl.viewport(0,0,1,1);gl.bindVertexArray(vao);gl.useProgram(program);const location=gl.getUniformLocation(program,"params[0]"),pixel=new Float32Array(4),webgl2=[];
  for(const c of cases){gl.uniform4fv(location,new Float32Array(c.values));gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,pixel);webgl2.push({name:c.name,amount:pixel[0]});}check(gl.getError()===gl.NO_ERROR,"Height fog precision GL error");
  const adapter=await navigator.gpu?.requestAdapter();check(adapter,"Height fog precision WebGPU unavailable");device=await adapter.requestDevice();const errors=[];device.addEventListener("uncapturederror",e=>errors.push(e.error.message));device.pushErrorScope("validation");
  const source=`${HEIGHT_FOG_WGSL}\nstruct Params { values:array<vec4f,3> }; @group(0) @binding(0) var<storage,read> inputs:array<Params>; @group(0) @binding(1) var<storage,read_write> results:array<f32>;\n@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id:vec3u){let p=inputs[id.x].values;results[id.x]=heightFogAmount(p[0].x,p[0].y,p[0].z-p[1].y,p[0].w-p[1].y,p[1],p[2].xy);}`;
  const pipeline=await device.createComputePipelineAsync({layout:"auto",compute:{module:device.createShaderModule({code:source}),entryPoint:"main"}});
  const input=device.createBuffer({size:cases.length*48,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),output=device.createBuffer({size:cases.length*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size:cases.length*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{
   device.queue.writeBuffer(input,0,new Float32Array(cases.flatMap(c=>c.values)));
   const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:input}},{binding:1,resource:{buffer:output}}]}),encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(cases.length);pass.end();encoder.copyBufferToBuffer(output,0,read,0,cases.length*4);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
   const values=new Float32Array(read.getMappedRange()).slice();read.unmap();const error=await device.popErrorScope();check(!error&&!errors.length,"Height fog precision GPU errors",{error:error?.message,errors});
   return{webgl2,webgpu:cases.map((c,i)=>({name:c.name,amount:values[i]}))};
  }finally{input.destroy();output.destroy();read.destroy();}
 }finally{device?.destroy();gl.deleteVertexArray(vao);gl.deleteFramebuffer(fbo);gl.deleteTexture(texture);gl.deleteProgram(program);for(const shader of shaders)gl.deleteShader(shader);gl.getExtension("WEBGL_lose_context")?.loseContext();}
}
