import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { decodePng, encodePngRgba } from './pack-textures.mjs';
const require=createRequire(import.meta.url);
const encoderDir=path.resolve(process.argv[2] ?? '/tmp/ferrum-basis-encoder');
const dir=path.resolve(process.argv[3] ?? '/tmp/ferrum-ktx2-measure')+'/';
await mkdir(dir, {recursive:true});
const start=performance.now();
const module=await require(path.join(encoderDir,'basis_encoder.js'))({wasmBinary:await readFile(path.join(encoderDir,'basis_encoder.wasm')),print:()=>{},printErr:()=>{}});
module.initializeBasis();
console.log(JSON.stringify({encoderInitMs:performance.now()-start}));
const width=512,height=512,pixels=new Uint8Array(width*height*4);
let random=1234567;
for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
 const i=(y*width+x)*4;random=(Math.imul(random,1664525)+1013904223)>>>0;
 const tile=(x>>6)+(y>>6)*8;
 pixels[i]=Math.min(255,Math.max(0,40+(tile*31)%160+40*Math.sin(x/11)+((random>>>24)%17-8)));
 pixels[i+1]=Math.min(255,Math.max(0,50+(tile*17)%160+35*Math.cos(y/13)));
 pixels[i+2]=Math.min(255,Math.max(0,30+(tile*11)%180+30*Math.sin((x+y)/9)));
 pixels[i+3]=255;
}
const atlas=encodePngRgba(width,height,pixels); await writeFile(dir+'atlas.png',atlas);
const smallPng=await readFile('examples/topdown-shooter/public/assets/player.png');
const small=decodePng(smallPng);
const samples=[{name:'atlas',width,height,pixels,png:atlas},{name:'pixel-sprite',...small,png:smallPng}];
const reports=[];
for (const sample of samples) for(const uastc of [false,true]) {
 const e=new module.BasisEncoder();
 try {
 e.setCreateKTX2File(true);e.setUASTC(uastc);e.setQualityLevel(200);e.setMipGen(false);e.setPerceptual(true);e.setKTX2AndBasisSRGBTransferFunc(true);e.setKTX2UASTCSupercompression(true);
 e.setSliceSourceImage(0,sample.pixels,sample.width,sample.height,0);
 const output=new Uint8Array(sample.width*sample.height*8+65536);
 const t=performance.now(),len=e.encode(output),encodeMs=performance.now()-t;
 if(!len) throw Error('encode failed');
 const bytes=output.slice(0,len);await writeFile(dir+sample.name+(uastc?'-uastc':'-etc1s')+'.ktx2',bytes);
 const f=new module.KTX2File(bytes);try{
 if(!f.isValid()||!f.startTranscoding())throw Error('badfile');
 const n=f.getImageTranscodedSizeInBytes(0,0,0,13),rgba=new Uint8Array(n);
 const t1=performance.now();if(!f.transcodeImage(rgba,0,0,0,13,0,-1,-1))throw Error('rgba transcode');
 const rgbaMs=performance.now()-t1;
 let err=0;for(let i=0;i<rgba.length;i++) err+=(rgba[i]-sample.pixels[i])**2;
 const fmt=module.transcoder_texture_format.cTFBC7_RGBA.value;
 const gpu=new Uint8Array(f.getImageTranscodedSizeInBytes(0,0,0,fmt));const t2=performance.now();if(!f.transcodeImage(gpu,0,0,0,fmt,0,-1,-1))throw Error('bc7 transcode');
 reports.push({sample:sample.name,format:uastc?'UASTC+Zstd':'ETC1S',width:sample.width,height:sample.height,pngBytes:sample.png.length,ktx2Bytes:len,gpuRgbaBytes:sample.width*sample.height*4,gpuBc7Bytes:gpu.length,encodeMs,rgbaMs,bc7Ms:performance.now()-t2,rgbaPsnr:err===0?null:10*Math.log10(255*255/(err/rgba.length))});
 }finally{f.close();f.delete();}
 }finally{e.delete();}
}
const js=await readFile('packages/ferrum-web/vendor/basis/basis_transcoder.js'),wasm=await readFile('packages/ferrum-web/vendor/basis/basis_transcoder.wasm');
const report={decoder:{jsBytes:js.length,wasmBytes:wasm.length,gzipBytes:gzipSync(js).length+gzipSync(wasm).length},reports};await writeFile(dir+'report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
