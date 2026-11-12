import { readPixelPng } from "./placementPixelPng";
import { writeAsepriteNormalPixels } from "./placementAsepriteNormalPng";

export interface AsepriteSourceFrame {
  id: string; x: number; y: number; width: number; height: number;
  offsetX: number; offsetY: number; sourceWidth: number; sourceHeight: number;
}
export interface AsepriteTrimPlan {
  frames: AsepriteSourceFrame[];
  restored?: { width: number; height: number; columns: number; cellWidth: number; cellHeight: number; order: string[] };
}
function fail(message:string):never {throw Error("Aseprite trim: "+message);}
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:fail("Expected frame metadata");
function integer(value:unknown,min:number,max:number) {
  return typeof value==="number"&&Number.isInteger(value)&&value>=min&&value<=max?value:fail("Frame dimensions and offsets must be bounded integers");
}
/** Pack by UTF-8 ID, but retain source ordering for frameTags and provider cards. */
export function asepriteTrimPlan(raw:readonly (readonly [unknown,unknown])[],width:number,height:number):AsepriteTrimPlan {
  if(!raw.length||raw.length>256)fail("Aseprite requires 1–256 frames");
  let trimmed=false;
  const ids=new Set<string>();
  const frames=Array.from(raw,([id,input])=>{
    if(typeof id!=="string"||!id.length||id.length>256||ids.has(id)||["__proto__","prototype","constructor"].includes(id))fail("Unsupported or duplicate frame name");
    for(const c of id){const n=c.charCodeAt(0);if(c.length===1&&n>=0xd800&&n<=0xdfff)fail("Frame names require well-formed Unicode");}
    ids.add(id);
    const value=record(input);
    for(const key of ["trimmed","rotated"])if(value[key]!==undefined&&typeof value[key]!=="boolean")fail("Invalid frame flags");
    if(value.rotated===true)fail("Rotated frames are unsupported");
    const rect=record(value.frame),w=integer(rect.w,1,width),h=integer(rect.h,1,height);
    const x=integer(rect.x,0,width-w),y=integer(rect.y,0,height-h);
    const source=value.sourceSize==null?undefined:record(value.sourceSize),offset=value.spriteSourceSize==null?undefined:record(value.spriteSourceSize);
    if(value.trimmed===true&&(!source||!offset))fail("Trimmed frames require sourceSize and spriteSourceSize");
    const sourceWidth=source?integer(source.w,1,4096):w,sourceHeight=source?integer(source.h,1,4096):h;
    const offsetX=offset?integer(offset.x,0,sourceWidth):0,offsetY=offset?integer(offset.y,0,sourceHeight):0;
    if(offset&&(offset.w!==w||offset.h!==h)||offsetX+w>sourceWidth||offsetY+h>sourceHeight)fail("Trimmed frame exceeds its source canvas");
    if(value.trimmed!==true&&(sourceWidth!==w||sourceHeight!==h||offsetX!==0||offsetY!==0))fail("Trim offsets require trimmed:true");
    trimmed ||= value.trimmed===true;
    return {id,x,y,width:w,height:h,offsetX,offsetY,sourceWidth,sourceHeight};
  });
  if(!trimmed)return {frames};
  const cellWidth=frames[0].sourceWidth,cellHeight=frames[0].sourceHeight;
  if(frames.some(f=>f.sourceWidth!==cellWidth||f.sourceHeight!==cellHeight))fail("Trimmed animation frames require a shared source canvas size");
  let best:{width:number;height:number;columns:number}|undefined;
  for(let columns=1;columns<=frames.length;columns++){
    const w=columns*cellWidth,h=Math.ceil(frames.length/columns)*cellHeight;
    if(w>4096||h>4096||w*h>4_194_304)continue;
    if(!best||Math.max(w,h)<Math.max(best.width,best.height)||Math.max(w,h)===Math.max(best.width,best.height)&&(w*h<best.width*best.height||w*h===best.width*best.height&&w<best.width))best={width:w,height:h,columns};
  }
  if(!best)fail("Restored atlas exceeds the 4096 side / 4 megapixel limit");
  const encoded=new Map(frames.map(f=>[f.id,new TextEncoder().encode(f.id)]));
  const order=frames.map(f=>f.id).sort((a,b)=>{const x=encoded.get(a)!,y=encoded.get(b)!;for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;});
  return {frames,restored:{...best,cellWidth,cellHeight,order}};
}
export function asepriteRestoredFrames(plan:AsepriteTrimPlan) {
  const r=plan.restored;
  return plan.frames.map(frame=>{
    const index=r?.order.indexOf(frame.id)??0;
    const x=r?index%r.columns*r.cellWidth:frame.x,y=r?Math.floor(index/r.columns)*r.cellHeight:frame.y;
    const width=r?.cellWidth??frame.width,height=r?.cellHeight??frame.height;
    return {id:frame.id,x,y,width,height};
  });
}
export async function restoreAsepriteTrim(png:ArrayBuffer,width:number,height:number,plan:AsepriteTrimPlan,signal:AbortSignal) {
  signal.throwIfAborted();
  const r=plan.restored;if(!r)return;
  // Lossless RGBA decoding preserves RGB under zero alpha and avoids Canvas premultiplication.
  let source:Awaited<ReturnType<typeof readPixelPng>>;
  try{source=await readPixelPng(png,4096,16*1024*1024);}catch{signal.throwIfAborted();fail("Trim restoration requires a valid RGBA8 PNG export");}
  signal.throwIfAborted();
  if(source.width!==width||source.height!==height)fail("Decoded source PNG dimensions differ");
  const pixels=new Uint8Array(r.width*r.height*4),placed=asepriteRestoredFrames(plan);
  for(const [i,frame] of plan.frames.entries())for(let row=0;row<frame.height;row++){
    const start=((frame.y+row)*width+frame.x)*4;
    pixels.set(source.pixels.subarray(start,start+frame.width*4),((placed[i].y+frame.offsetY+row)*r.width+placed[i].x+frame.offsetX)*4);
  }
  const result=await writeAsepriteNormalPixels(r.width,r.height,pixels,signal);
  if(result.byteLength>16*1024*1024)fail("Restored PNG exceeds the 16 MiB limit");
  signal.throwIfAborted();return result;
}
