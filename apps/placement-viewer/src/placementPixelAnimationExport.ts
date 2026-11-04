import { pixelBytes, pixelFrames, readPixelDocument, type PixelDocument } from "./placementPixelDocument";
import { pixelTagPreviewFrames } from "./placementPixelAnimation";
import { encodePixelGif, pixelExportYield, type PixelExportFrame } from "./placementPixelGif";
import { encodePixelApng } from "./placementPixelApng";

export interface PixelAnimationExportOptions { format:"gif"|"apng"; tagId?:string; loop?:boolean; reduceColors?:boolean; }
/** Metadata-only description. Callers supply a validated editor snapshot; encoder validates again. */
export function pixelAnimationExportPlan(source:PixelDocument,options:PixelAnimationExportOptions) {
  if(options.format!=="gif"&&options.format!=="apng"||options.loop!==undefined&&typeof options.loop!=="boolean"||options.reduceColors!==undefined&&typeof options.reduceColors!=="boolean")throw Error("Invalid animation export settings");
  if(source.version===4)throw Error("Fixed atlases export PNG only");
  const frames=pixelFrames(source),tags="tags" in source?source.tags:undefined,tag=options.tagId===undefined?undefined:tags?.find(tag=>tag.id===options.tagId);
  if(options.tagId!==undefined&&!tag)throw Error("Pixel tag not found");
  const loop=options.loop??tag?.loop??true,ordered=tag?pixelTagPreviewFrames(frames,{...tag,loop}):frames;
  if(ordered.length>127||source.width*source.height*ordered.length>4_194_304)throw Error("Animation export exceeds the frame or pixel limit");
  const durations=ordered.map(frame=>options.format==="gif"?Math.max(20,Math.round(frame.durationMs/10)*10):frame.durationMs);
  return {width:source.width,height:source.height,frames:ordered,loop,durations,durationMs:durations.reduce((sum,ms)=>sum+ms,0)};
}
export async function exportPixelAnimation(input:PixelDocument,options:PixelAnimationExportOptions,signal?:AbortSignal,progress?:(frame:number,total:number)=>void):Promise<ArrayBuffer> {
  signal?.throwIfAborted();const source=readPixelDocument(JSON.stringify(input)),plan=pixelAnimationExportPlan(source,options),all=pixelFrames(source);
  const cache=new Map<string,Uint8Array>(),frames:PixelExportFrame[]=[];
  for(const frame of plan.frames){await pixelExportYield(signal);let pixels=cache.get(frame.id);if(!pixels){pixels=pixelBytes(source,all.findIndex(value=>value.id===frame.id));cache.set(frame.id,pixels);}frames.push({pixels,durationMs:frame.durationMs});}
  const report=(frame:number)=>progress?.(frame,frames.length);
  return options.format==="gif"?encodePixelGif(plan.width,plan.height,frames,plan.loop,options.reduceColors??false,signal,report):encodePixelApng(plan.width,plan.height,frames,plan.loop,signal,report);
}
