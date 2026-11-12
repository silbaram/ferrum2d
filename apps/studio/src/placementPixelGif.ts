export interface PixelExportFrame { pixels: Uint8Array; durationMs: number; }
const MAX_BYTES = 16 * 1024 * 1024;
export async function pixelExportYield(signal?: AbortSignal) {
  signal?.throwIfAborted(); await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted();
}
export function joinPixelExport(parts: readonly Uint8Array[]): ArrayBuffer {
  const size=parts.reduce((sum,part)=>sum+part.length,0);
  if(size>MAX_BYTES)throw Error("Animation export exceeds 16 MiB");
  const output=new Uint8Array(size);let offset=0;for(const part of parts){output.set(part,offset);offset+=part.length;}return output.buffer;
}
function rgb(pixels: Uint8Array,i: number){return pixels[i]*65536+pixels[i+1]*256+pixels[i+2];}
/** Literal LZW with bounded clear intervals: valid 9-bit codes without an unbounded dictionary. */
function literalLzw(indices: Uint8Array): Uint8Array {
  const bytes=new Uint8Array(Math.ceil((indices.length+Math.ceil(indices.length/128)+1)*9/8));
  let bits=0,value=0,offset=0;
  function code(code: number){value|=code<<bits;bits+=9;while(bits>=8){bytes[offset++]=value&255;value>>>=8;bits-=8;}}
  for(let i=0;i<indices.length;i++){if(i%128===0)code(256);code(indices[i]);}code(257);if(bits)bytes[offset++]=value&255;
  return bytes.subarray(0,offset);
}
/** GIF89a, global palette and full-frame disposal. See docs/planning/pixel-tools-and-demo-plan.md. */
export async function encodePixelGif(width:number,height:number,frames:readonly PixelExportFrame[],loop:boolean,reduceColors:boolean,signal?:AbortSignal,progress?:(frame:number)=>void):Promise<ArrayBuffer> {
  let reduced=false;const colors=new Map<number,number>();
  for(const frame of frames){
    await pixelExportYield(signal);
    for(let i=0;i<frame.pixels.length;i+=4){
      if(frame.pixels[i+3]<128)continue;const color=rgb(frame.pixels,i);if(colors.has(color))continue;
      if(colors.size===255){if(!reduceColors)throw Error("GIF requires at most 255 visible colors. Enable color reduction or export APNG.");reduced=true;break;}
      colors.set(color,colors.size+1);
    }
    if(reduced)break;
  }
  const palette=new Uint8Array(768);
  if(reduced){for(let r=0;r<6;r++)for(let g=0;g<6;g++)for(let b=0;b<6;b++)palette.set([r*51,g*51,b*51],(1+r*36+g*6+b)*3);}
  else for(const [color,index]of colors)palette.set([color>>16,(color>>8)&255,color&255],index*3);
  const header=new Uint8Array(13),view=new DataView(header.buffer);header.set(new TextEncoder().encode("GIF89a"));view.setUint16(6,width,true);view.setUint16(8,height,true);header[10]=0xf7;
  const parts:Uint8Array[]=[header,palette];
  if(loop)parts.push(new Uint8Array([0x21,0xff,11,...new TextEncoder().encode("NETSCAPE2.0"),3,1,0,0,0]));
  for(let f=0;f<frames.length;f++){
    await pixelExportYield(signal);const frame=frames[f],indices=new Uint8Array(width*height);
    for(let i=0;i<indices.length;i++)if(frame.pixels[i*4+3]>=128){
      indices[i]=reduced?1+Math.round(frame.pixels[i*4]/51)*36+Math.round(frame.pixels[i*4+1]/51)*6+Math.round(frame.pixels[i*4+2]/51):colors.get(rgb(frame.pixels,i*4))!;
    }
    const delay=Math.max(2,Math.round(frame.durationMs/10));parts.push(new Uint8Array([0x21,0xf9,4,9,delay&255,delay>>8,0,0]));
    parts.push(new Uint8Array([0x2c,0,0,0,0,width&255,width>>8,height&255,height>>8,0,8]));
    const data=literalLzw(indices);for(let i=0;i<data.length;i+=255)parts.push(new Uint8Array([Math.min(255,data.length-i)]),data.subarray(i,i+255));parts.push(new Uint8Array([0]));progress?.(f+1);
  }
  signal?.throwIfAborted();parts.push(new Uint8Array([0x3b]));return joinPixelExport(parts);
}
