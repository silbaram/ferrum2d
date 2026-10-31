import { SpriteBatch, type SpriteTextureSource, type SpriteBatchStats } from "./spriteBatch.js";
import type { RenderCommandBufferView } from "./renderCommandDecoder.js";
import type { ResolvedSpriteMaterialPreset } from "./spriteMaterial.js";

export interface WebGL2SpriteNormalTargets { normal:WebGLTexture; coverage:WebGLTexture; }
/** Two data MRTs: normal direction and mapped coverage, preserving foreground alpha/order. */
export class WebGL2SpriteNormals {
  private readonly batch:SpriteBatch;
  private framebuffer?:WebGLFramebuffer;
  private targets?:WebGL2SpriteNormalTargets;
  private width=0;private height=0;
  private readonly neutral=new Float32Array([0.5,0.5,0.5,0]);
  private readonly empty=new Float32Array(4);
  constructor(private readonly gl:WebGL2RenderingContext){this.batch=new SpriteBatch(gl,true,true);}
  draw(source:SpriteTextureSource,commands:RenderCommandBufferView,width:number,height:number,resolution:[number,number],material:ResolvedSpriteMaterialPreset,offset:readonly[number,number],restore:()=>void):SpriteBatchStats {
    const gl=this.gl, capabilities=[gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST], enabled=capabilities.map(capability=>gl.isEnabled(capability)), mask=gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
    try{
      gl.colorMask(true,true,true,true);
      this.resize(width,height);this.batch.groundYScale=commands.groundYScale??1;
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer!);gl.viewport(0,0,width,height);
      gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.SCISSOR_TEST);
      gl.clearBufferfv(gl.COLOR,0,this.neutral);gl.clearBufferfv(gl.COLOR,1,this.empty);
      return this.batch.drawNormalBatches(source,commands,resolution,material,offset);
    }finally{
      capabilities.forEach((capability,index)=>{if(enabled[index])gl.enable(capability);else gl.disable(capability);});
      gl.colorMask(mask[0],mask[1],mask[2],mask[3]);restore();
    }
  }
  get buffers():WebGL2SpriteNormalTargets {if(!this.targets)throw Error("Sprite normal targets not allocated");return this.targets;}
  resourceStats(){const batch=this.batch.resourceStats();return {...batch,textureCount:this.targets?2:0,renderTargetCount:this.targets?2:0,textureBytes:this.width*this.height*8,estimatedBytes:this.width*this.height*8+batch.bufferBytes};}
  clearTargets(){this.release();}
  destroy(){this.release();this.batch.destroy();}
  private release(){if(this.targets){this.gl.deleteTexture(this.targets.normal);this.gl.deleteTexture(this.targets.coverage);}if(this.framebuffer)this.gl.deleteFramebuffer(this.framebuffer);this.targets=undefined;this.framebuffer=undefined;this.width=this.height=0;}
  private resize(width:number,height:number){
    if(this.width===width&&this.height===height)return;
    const gl=this.gl,limit=gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>limit||height>limit)throw Error("Invalid sprite normal target size");
    const textures:WebGLTexture[]=[],framebuffer=gl.createFramebuffer();
    try{
      if(!framebuffer)throw Error("Sprite normal framebuffer allocation failed");
      gl.activeTexture(gl.TEXTURE0);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
      for(let i=0;i<2;i++){
        const texture=gl.createTexture();if(!texture)throw Error("Sprite normal texture allocation failed");textures.push(texture);
        gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,texture,0);
      }
      gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error("Sprite normal MRT is incomplete");
    }catch(error){for(const texture of textures)gl.deleteTexture(texture);if(framebuffer)gl.deleteFramebuffer(framebuffer);throw error;}
    this.release();this.targets={normal:textures[0],coverage:textures[1]};this.framebuffer=framebuffer!;this.width=width;this.height=height;
  }
}
