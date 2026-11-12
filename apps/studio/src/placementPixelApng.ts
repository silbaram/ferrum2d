import { joinPixelExport, pixelExportYield, type PixelExportFrame } from "./placementPixelGif";

import { pixelPngChunk as chunk } from "./placementPixelPng";

/** Full RGBA frames, SOURCE blend, exact millisecond delays and explicit plays count. */
export async function encodePixelApng(width:number,height:number,frames:readonly PixelExportFrame[],loop:boolean,signal?:AbortSignal,progress?:(frame:number)=>void):Promise<ArrayBuffer> {
  const header=new Uint8Array(13),view=new DataView(header.buffer);view.setUint32(0,width);view.setUint32(4,height);header[8]=8;header[9]=6;
  const animation=new Uint8Array(8),control=new DataView(animation.buffer);control.setUint32(0,frames.length);control.setUint32(4,loop?0:1);
  const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("sRGB",new Uint8Array([0])),chunk("acTL",animation)];let sequence=0;
  for(let f=0;f<frames.length;f++){
    await pixelExportYield(signal);const frame=frames[f],body=new Uint8Array(26),ctl=new DataView(body.buffer);ctl.setUint32(0,sequence++);ctl.setUint32(4,width);ctl.setUint32(8,height);ctl.setUint16(20,frame.durationMs);ctl.setUint16(22,1000);
    parts.push(chunk("fcTL",body));const stride=width*4,rows=new Uint8Array((stride+1)*height);
    for(let y=0;y<height;y++)rows.set(frame.pixels.subarray(y*stride,(y+1)*stride),y*(stride+1)+1);
    const stream=new Blob([rows]).stream().pipeThrough(new CompressionStream("deflate"),{signal});
    const compressed=new Uint8Array(await new Response(stream).arrayBuffer());signal?.throwIfAborted();
    if(f===0)parts.push(chunk("IDAT",compressed));else{const payload=new Uint8Array(compressed.length+4);new DataView(payload.buffer).setUint32(0,sequence++);payload.set(compressed,4);parts.push(chunk("fdAT",payload));}
    progress?.(f+1);
  }
  signal?.throwIfAborted();parts.push(chunk("IEND",new Uint8Array()));return joinPixelExport(parts);
}
