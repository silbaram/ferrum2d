// Run the complete packed raymarch shaders with controlled depth textures.
import { LIGHT_SHAFT_GLSL, LIGHT_SHAFT_WGSL, writeLightShaftUniforms } from "/package/dist/spatialLightShaftKernel.js";
import { check } from "/fixture.mjs";
function parameters(c) {
 const camera=new Float32Array(28);camera.set([c.projection,0,0,0,0,0,-1,c.projection?Math.PI/3:2,c.near,c.far,1,1],16);
 const values=new Float32Array(632);values.set([0,0,-c.sunMagnitude],84);values[87]=1;values.fill(1,88,91);values[91]=10000;values[92]=512;values[94]=10000;
 values[617]=1;values[618]=c.density;values[619]=c.maxDistance;values.fill(1,620,623);values[623]=c.anisotropy;
 const shadowMatrices=new Float32Array(16);shadowMatrices[15]=1; // Constant interior UV/depth, visibility 1.
 const result=new Float32Array(52);writeLightShaftUniforms(result,{camera,environment:{values,shadowMatrices}},{width:1,height:1,samples:c.samples},1,1);return result;
}
export async function probeShaftPrecision(cases) {
 const canvas=document.createElement("canvas"),gl=canvas.getContext("webgl2");check(gl&&gl.getExtension("EXT_color_buffer_float"),"Shaft precision needs float target");
 const shaders=[],textures=[],program=gl.createProgram(),target=gl.createFramebuffer(),vao=gl.createVertexArray();let device;
 try {
  for(const [type,source] of [[gl.VERTEX_SHADER,`#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`],[gl.FRAGMENT_SHADER,LIGHT_SHAFT_GLSL]]) {
   const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);check(gl.getShaderParameter(s,gl.COMPILE_STATUS),"Shaft precision shader",gl.getShaderInfoLog(s));gl.attachShader(program,s);
  }
  gl.linkProgram(program);check(gl.getProgramParameter(program,gl.LINK_STATUS),"Shaft precision link",gl.getProgramInfoLog(program));gl.useProgram(program);gl.bindVertexArray(vao);gl.viewport(0,0,1,1);
  const texture=(format,width,height)=>{const t=gl.createTexture();textures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);gl.texStorage2D(gl.TEXTURE_2D,1,format,width,height);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);return t;};
  const color=texture(gl.RGBA32F,1,1);gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,color,0);check(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,"Shaft precision framebuffer");
  gl.activeTexture(gl.TEXTURE0);const depth=texture(gl.R32F,1,1);gl.uniform1i(gl.getUniformLocation(program,"u_depth"),0);
  gl.activeTexture(gl.TEXTURE1);texture(gl.R32F,512,512);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,512,512,gl.RED,gl.FLOAT,new Float32Array(512*512).fill(1));gl.uniform1i(gl.getUniformLocation(program,"u_shadow"),1);
  const location=gl.getUniformLocation(program,"u_p[0]"),pixel=new Float32Array(4),webgl2=[];
  for(const c of cases){gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,depth);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,1,1,gl.RED,gl.FLOAT,new Float32Array([c.depth]));gl.uniform4fv(location,parameters(c));gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,pixel);webgl2.push({name:c.name,amount:pixel[0]});}
  check(gl.getError()===gl.NO_ERROR,"Shaft precision GL error");
  const adapter=await navigator.gpu?.requestAdapter();check(adapter,"Shaft precision WebGPU unavailable");device=await adapter.requestDevice();const errors=[];device.addEventListener("uncapturederror",e=>errors.push(e.error.message));device.pushErrorScope("validation");
  const module=device.createShaderModule({code:LIGHT_SHAFT_WGSL}),pipeline=await device.createRenderPipelineAsync({layout:"auto",vertex:{module,entryPoint:"vs_main"},fragment:{module,entryPoint:"fs_main",targets:[{format:"rgba32float"}]},primitive:{topology:"triangle-list"}});
  const uniform=device.createBuffer({size:208,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),read=device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const output=device.createTexture({size:[1,1],format:"rgba32float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}),depthImage=device.createTexture({size:[1,1],format:"depth32float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),shadowImage=device.createTexture({size:[512,512],format:"depth32float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
  try {
   const depthView=depthImage.createView(),shadowView=shadowImage.createView(),outputView=output.createView(),group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:depthView},{binding:1,resource:shadowView},{binding:2,resource:{buffer:uniform}}]});
   const webgpu=[];
   for(const c of cases){
    device.queue.writeBuffer(uniform,0,parameters(c));const encoder=device.createCommandEncoder();
    for(const [view,value] of [[depthView,Math.fround(c.depth)],[shadowView,1]]){const pass=encoder.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view,depthClearValue:value,depthLoadOp:"clear",depthStoreOp:"store"}});pass.end();}
    const pass=encoder.beginRenderPass({colorAttachments:[{view:outputView,loadOp:"clear",storeOp:"store",clearValue:[0,0,0,0]}]});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();encoder.copyTextureToBuffer({texture:output},{buffer:read,bytesPerRow:256},[1,1,1]);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const amount=new Float32Array(read.getMappedRange())[0];read.unmap();webgpu.push({name:c.name,amount});
   }
   const error=await device.popErrorScope();check(!error&&!errors.length,"Shaft precision GPU errors",{error:error?.message,errors});return {webgl2,webgpu};
  }finally {uniform.destroy();read.destroy();output.destroy();depthImage.destroy();shadowImage.destroy();}
 }finally {device?.destroy();gl.deleteVertexArray(vao);gl.deleteFramebuffer(target);for(const t of textures)gl.deleteTexture(t);gl.deleteProgram(program);for(const s of shaders)gl.deleteShader(s);gl.getExtension("WEBGL_lose_context")?.loseContext();}
}
