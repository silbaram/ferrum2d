import { createWebGL2Program } from "./webgl2ShaderPrograms.js";
import type { RenderCommandBufferView } from "./renderCommandDecoder.js";

/** One bulk triangle upload/draw for every admitted native volume in the frame. */
export class WebGL2VolumeShadowBatch {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;
  private readonly resolution: WebGLUniformLocation;
  private readonly offset: WebGLUniformLocation;
  private readonly snap: WebGLUniformLocation;
  private bytes=0;
  private destroyed=false;
  constructor(private readonly gl: WebGL2RenderingContext) {
    const program=createWebGL2Program(gl,"volumeShadow"),vao=gl.createVertexArray(),buffer=gl.createBuffer();
    try{
      if(!vao||!buffer)throw Error("Volume shadow buffer allocation failed");
      const resolution=gl.getUniformLocation(program,"u_resolution"),offset=gl.getUniformLocation(program,"u_screen_offset"),snap=gl.getUniformLocation(program,"u_pixel_snap");
      if(!resolution||!offset||!snap)throw Error("Missing volume shadow uniforms");
      this.program=program;this.vao=vao;this.buffer=buffer;this.resolution=resolution;this.offset=offset;this.snap=snap;
      gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,12,0);gl.bindVertexArray(null);
    }catch(error){gl.deleteProgram(program);if(vao)gl.deleteVertexArray(vao);if(buffer)gl.deleteBuffer(buffer);throw error;}
  }
  draw(volumes:NonNullable<RenderCommandBufferView["groundShadowVolumes"]>,resolution:readonly[number,number],offset:readonly[number,number],pixelSnap:number):number {
    if(!volumes.vertexCount)return 0;
    const gl=this.gl;gl.useProgram(this.program);gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    const bytes=volumes.buffer.byteLength;
    if(this.bytes<bytes){this.bytes=2**Math.ceil(Math.log2(Math.max(16,bytes)));gl.bufferData(gl.ARRAY_BUFFER,this.bytes,gl.DYNAMIC_DRAW);}
    gl.bufferSubData(gl.ARRAY_BUFFER,0,volumes.buffer);
    gl.uniform2f(this.resolution,resolution[0],resolution[1]);gl.uniform2f(this.offset,offset[0],offset[1]);gl.uniform1f(this.snap,pixelSnap);
    gl.enable(gl.BLEND);gl.blendEquation(gl.MAX);gl.blendFunc(gl.ONE,gl.ONE);
    try{gl.drawArrays(gl.TRIANGLES,0,volumes.vertexCount);}finally{gl.bindVertexArray(null);gl.blendEquation(gl.FUNC_ADD);}
    return 1;
  }
  resourceStats(){return {bufferCount:this.destroyed?0:1,programCount:this.destroyed?0:1,bufferBytes:this.bytes};}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.gl.deleteBuffer(this.buffer);this.gl.deleteVertexArray(this.vao);this.gl.deleteProgram(this.program);this.bytes=0;}
}
