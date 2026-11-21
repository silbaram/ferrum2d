import {registerRenderTextureFileOwner,copyFileRenderTextures,type ResourceRenderTextureData} from "./nativeFileResourceRenderTextures.js";
import {ResourceBudget,NativeFileResourceError,resourceInteger} from "./nativeFileResourceBudget.js";
import {readFileWebGlTexture} from "./nativeFileResourceWebGl.js";
import type { RenderTexture, RenderTextureOptions } from "./renderTexture";
import { WebGL2RenderTarget } from "./webgl2RenderTarget";

interface RenderTextureEntry {
  target: WebGL2RenderTarget;
  width: number;
  height: number;
  filter: "nearest" | "linear";
}

const RENDER_TEXTURE_UV = Object.freeze([0, 0, 1, 1] as const);

/** Owns GPU images separately from asset textures, avoiding double deletion. */
export class WebGL2RenderTextureStore {
  private entries = new Map<RenderTexture, RenderTextureEntry>();
  private byId = new Map<number, RenderTextureEntry>();
  private textureBytes = 0;
  private readonly retired = new WeakSet<RenderTexture>();

  private fileGeneration=0;
  private fileDisposed=false;
  constructor(private readonly gl: WebGL2RenderingContext, private readonly srgbStorage = false) {
    registerRenderTextureFileOwner(this,{revision:()=>this.fileGeneration,capture:b=>this.captureFile(b),prepare:(data,b)=>this.prepareFile(data,b)});
  }
  /** Called immediately before the first actual render-to-texture write. */
  fileWillWrite():void {this.fileGeneration++;}
  private captureFile(b:ResourceBudget):ResourceRenderTextureData {
    if(this.fileDisposed||this.gl.isContextLost())return b.fail("STALE","render texture lifetime");
    b.work(this.entries.size+this.byId.size);b.charge("resources",this.entries.size);b.charge("metadataBytes",this.entries.size*48);
    const entries=[];
    for(const [handle,row] of this.entries){if(this.byId.get(handle.textureId)!==row||handle.width!==row.width||handle.height!==row.height)return b.fail("DATA","render texture ownership");
      b.charge("gpuBytes",row.width*row.height*4);entries.push(Object.freeze({id:handle.textureId,width:row.width,height:row.height,filter:row.filter,pixels:readFileWebGlTexture(this.gl,row.target.texture,row.width,row.height,false,this.srgbStorage,b)}));}
    return Object.freeze({generation:this.fileGeneration,srgb:this.srgbStorage,entries:Object.freeze(entries)});
  }
  private prepareFile(input:ResourceRenderTextureData,b:ResourceBudget){
    const data=copyFileRenderTextures(input,b),generation=this.fileGeneration;
    if(this.fileDisposed||this.gl.isContextLost()||data.srgb!==this.srgbStorage)return b.fail("CAPABILITY","render texture target");
    const next=new WebGL2RenderTextureStore(this.gl,this.srgbStorage),handles=new Map<number,RenderTexture>();let adopted=false,disposed=false;
    const framebuffers=new WeakSet<WebGLFramebuffer>(),textures=new WeakSet<WebGLTexture>();
    const cleanup=()=>{let failure=false;for(const row of next.entries.values()){
      try{if(!framebuffers.has(row.target.framebuffer)){this.gl.deleteFramebuffer(row.target.framebuffer);framebuffers.add(row.target.framebuffer);}}catch{failure=true;}
      try{if(!textures.has(row.target.texture)){this.gl.deleteTexture(row.target.texture);textures.add(row.target.texture);}}catch{failure=true;}
    }if(failure)throw new NativeFileResourceError("GPU","render texture cleanup; retry dispose");next.entries.clear();next.byId.clear();next.textureBytes=0;next.fileDisposed=true;disposed=true;};
    try{for(const row of data.entries){const handle=next.create(row.id,{width:row.width,height:row.height,filter:row.filter});handles.set(row.id,handle);uploadFileRgba(this.gl,next.target(handle).texture,row.width,row.height,row.pixels);
      const check=readFileWebGlTexture(this.gl,next.target(handle).texture,row.width,row.height,false,this.srgbStorage,b);b.work(check.length);if(check.some((v,i)=>v!==row.pixels[i]))return b.fail("GPU","render texture upload bytes");}}
    catch(error){cleanup();throw error;}
    const preparedGeneration=next.fileGeneration;
    const assertCurrent=()=>{if(adopted||disposed||this.fileDisposed||this.fileGeneration!==generation||next.fileGeneration!==preparedGeneration||this.gl.isContextLost())return b.fail("STALE","render texture target mutation");};
    return Object.freeze({handles:handles as ReadonlyMap<number,RenderTexture>,assertCurrent,adopt:()=>{assertCurrent();const fresh=resourceInteger(Math.max(generation,preparedGeneration),"render texture runtime generation",0,Number.MAX_SAFE_INTEGER-1)+1;
      [this.entries,next.entries]=[next.entries,this.entries];[this.byId,next.byId]=[next.byId,this.byId];[this.textureBytes,next.textureBytes]=[next.textureBytes,this.textureBytes];this.fileGeneration=fresh;adopted=true;cleanup();
    },dispose:()=>{if(!disposed)cleanup();}});
  }

  has(textureId: number): boolean {
    return this.byId.has(textureId);
  }

  texture(textureId: number): WebGLTexture | undefined {
    return this.byId.get(textureId)?.target.texture;
  }

  create(textureId: number, options: RenderTextureOptions): RenderTexture {
    // Texture ids travel as f32 in the existing command ABI.
    if (!Number.isInteger(textureId) || textureId < 1 || textureId > 0xffffff || this.has(textureId)) {
      throw new Error("RenderTexture textureId must be unique and an integer in 1..16777215.");
    }
    const filter = options.filter ?? "nearest";
    if (filter !== "nearest" && filter !== "linear") throw new Error("Invalid RenderTexture filter.");
    const entry: RenderTextureEntry = {
      target: new WebGL2RenderTarget(this.gl, options.width, options.height, filter, this.srgbStorage),
      width: options.width,
      height: options.height,
      filter,
    };
    const handle: RenderTexture = Object.freeze({
      textureId,
      get width() { return entry.width; },
      get height() { return entry.height; },
      uv: RENDER_TEXTURE_UV,
    });
    this.textureBytes += entry.target.allocatedTextureBytes;
    this.fileGeneration++;
    this.entries.set(handle, entry);
    this.byId.set(textureId, entry);
    return handle;
  }

  target(handle: RenderTexture): WebGL2RenderTarget {
    return this.requireEntry(handle).target;
  }

  resize(handle: RenderTexture, width: number, height: number): void {
    const entry = this.requireEntry(handle);
    if (entry.width === width && entry.height === height) return;
    // Allocate first: a failed resize leaves the old image and handle intact.
    const next = new WebGL2RenderTarget(this.gl, width, height, entry.filter, this.srgbStorage);
    this.textureBytes += next.allocatedTextureBytes - entry.target.allocatedTextureBytes;
    entry.target.destroy();
    this.fileGeneration++;
    entry.target = next;
    entry.width = width;
    entry.height = height;
  }

  release(handle: RenderTexture): boolean {
    if (this.retired.has(handle)) return false;
    const target = this.requireEntry(handle).target;
    this.textureBytes -= target.allocatedTextureBytes;
    target.destroy();
    this.fileGeneration++;
    this.entries.delete(handle);
    this.byId.delete(handle.textureId);
    this.retired.add(handle);
    return true;
  }

  resourceStats(): { renderTargetCount: number; textureBytes: number } {
    return { renderTargetCount: this.entries.size, textureBytes: this.textureBytes };
  }

  destroy(): void {
    this.fileDisposed=true;this.fileGeneration++;
    for (const handle of this.entries.keys()) this.release(handle);
  }

  private requireEntry(handle: RenderTexture): RenderTextureEntry {
    const entry = this.entries.get(handle);
    if (!entry) throw new Error("RenderTexture belongs to another renderer or has been destroyed.");
    return entry;
  }
}

function uploadFileRgba(gl:WebGL2RenderingContext,texture:WebGLTexture,width:number,height:number,pixels:Uint8Array):void{
 const binding=gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture|null,buffer=gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING) as WebGLBuffer|null;
 const parameters=[gl.UNPACK_ALIGNMENT,gl.UNPACK_ROW_LENGTH,gl.UNPACK_IMAGE_HEIGHT,gl.UNPACK_SKIP_PIXELS,gl.UNPACK_SKIP_ROWS,gl.UNPACK_SKIP_IMAGES,gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,gl.UNPACK_FLIP_Y_WEBGL,gl.UNPACK_COLORSPACE_CONVERSION_WEBGL],values=parameters.map(p=>gl.getParameter(p) as number);
 try{gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);parameters.forEach(p=>gl.pixelStorei(p,p===gl.UNPACK_ALIGNMENT?1:p===gl.UNPACK_COLORSPACE_CONVERSION_WEBGL?gl.NONE:0));gl.bindTexture(gl.TEXTURE_2D,texture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);if(gl.getError()!==gl.NO_ERROR)throw new NativeFileResourceError("GPU","render texture upload");}
 finally{gl.bindTexture(gl.TEXTURE_2D,binding);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,buffer);parameters.forEach((p,i)=>gl.pixelStorei(p,values[i]));}
}
