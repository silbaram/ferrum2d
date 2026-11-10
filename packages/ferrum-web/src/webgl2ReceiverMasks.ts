import {SpriteBatch,type SpriteTextureSource} from './spriteBatch.js';
import type {RenderCommandBufferView} from './renderCommandDecoder.js';
import type {ResolvedSpriteMaterialPreset} from './spriteMaterial.js';

/** Optional raw RGBA8 receiver identity, independent of the four-MRT Surface pass. */
export class WebGL2ReceiverMasks {
  private readonly batch:SpriteBatch;
  texture?:WebGLTexture;
  private framebuffer?:WebGLFramebuffer;
  private width=0;private height=0;
  private readonly neutral=new Float32Array([1,1,0,0]);
  constructor(private readonly gl:WebGL2RenderingContext){this.batch=new SpriteBatch(gl,false,false,false,false,'masks');}
  prepare(width:number,height:number):void{
    if(this.width===width&&this.height===height&&this.texture)return;
    const gl=this.gl,priorTexture=gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture|null,priorFramebuffer=gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer|null;
    const restoreTexture=priorTexture===this.texture?null:priorTexture,restoreFramebuffer=priorFramebuffer===this.framebuffer?null:priorFramebuffer;
    let texture:WebGLTexture|null=null,framebuffer:WebGLFramebuffer|null=null;
    try{
      texture=gl.createTexture();framebuffer=gl.createFramebuffer();if(!texture||!framebuffer)throw Error('Receiver mask target allocation failed');
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete receiver mask target');
      this.clearTarget();this.texture=texture;this.framebuffer=framebuffer;this.width=width;this.height=height;
    }catch(error){if(texture)gl.deleteTexture(texture);if(framebuffer)gl.deleteFramebuffer(framebuffer);throw error;}
    finally{gl.bindTexture(gl.TEXTURE_2D,restoreTexture);gl.bindFramebuffer(gl.FRAMEBUFFER,restoreFramebuffer);}
  }
  draw(source:SpriteTextureSource,commands:RenderCommandBufferView,resolution:[number,number],material:ResolvedSpriteMaterialPreset,offset:readonly[number,number],snap:number,ground:number,skip:boolean){
    const gl=this.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer!);gl.viewport(0,0,this.width,this.height);gl.clearBufferfv(gl.COLOR,0,this.neutral);
    this.batch.pixelSnap=snap;this.batch.groundYScale=ground;this.batch.skipGroundShadows=skip;
    return this.batch.drawLitBatches(source,commands,resolution,material,offset);
  }
  clearTarget():void{if(this.texture)this.gl.deleteTexture(this.texture);if(this.framebuffer)this.gl.deleteFramebuffer(this.framebuffer);this.texture=undefined;this.framebuffer=undefined;this.width=this.height=0;}
  destroy():void{this.clearTarget();this.batch.destroy();}
  resourceStats(){const batch=this.batch.resourceStats();return {...batch,renderTargetCount:this.texture?1:0,textureBytes:this.width*this.height*4};}
}
