import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir,mkdtemp,readFile,writeFile } from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {chromium} from 'playwright-core';
import {installSpatialGpuTarget} from './spatial-webgpu-capture.mjs';
const surfaceOnly=process.argv.includes('--surface-only');
const hdrOnly=process.argv.includes('--hdr-only'),managedOnly=process.argv.includes('--managed-only'),colorOnly=process.argv.includes('--color-only');
const cases=managedOnly?[['webgl2','linear-srgb'],['webgpu','linear-srgb']]:[['webgl2','legacy'],['webgpu','legacy'],['webgl2','linear-srgb'],['webgpu','linear-srgb']];
const root=resolve('.'),parent=resolve(surfaceOnly?'artifacts/lighting-remaining/m4b':managedOnly||colorOnly?'artifacts/lighting-remaining/m3c':hdrOnly?'artifacts/lighting-remaining/m3b':'artifacts/flat-lit-m2a');
await mkdir(parent,{recursive:true});const run=await mkdtemp(resolve(parent,'gpu-'));
const html='<script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/packages/ferrum-web/dist/core.js","@ferrum2d/ferrum-web/labs":"/packages/ferrum-web/dist/labs.js","@ferrum2d/ferrum-web/authoring":"/packages/ferrum-web/dist/authoring.js"}}</script><script type="module">import{probeFlatLit}from"/tests/smoke/flat-lit-browser-fixture.mjs";window.probeFlatLit=probeFlatLit;import{probeFlatHdr}from"/tests/smoke/flat-hdr-browser-fixture.mjs";window.probeFlatHdr=probeFlatHdr;import{probeManagedColor}from"/tests/smoke/webgpu-linear-browser-fixture.mjs";window.probeManagedColor=probeManagedColor;import{probeFlatSurface}from"/tests/smoke/flat-surface-browser-fixture.mjs";window.probeFlatSurface=probeFlatSurface;</script>';
const server=createServer((req,res)=>void(async()=>{
 const url=new URL(req.url,'http://localhost');if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 const path=resolve(root,'.'+decodeURIComponent(url.pathname));if(!path.startsWith(root+sep)||! /\.(?:m?js|wasm)$/.test(path)){res.writeHead(403).end();return;}
 const content=await readFile(path);res.setHeader('Content-Type',path.endsWith('.wasm')?'application/wasm':'application/javascript');res.end(content);
})().catch(()=>res.writeHead(404).end()));
let browser;const results=[],errors=[];let failure;
try{
 await new Promise((r,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',r);});
 const options={headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--use-vulkan=swiftshader']};
 browser=await chromium.launch(process.env.FERRUM_BROWSER_EXECUTABLE?{...options,executablePath:process.env.FERRUM_BROWSER_EXECUTABLE}:options);
 for(const dpr of [1,2]){
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:dpr});
  try{
   await page.addInitScript(installSpatialGpuTarget);page.on('pageerror',e=>errors.push(e.message));const bootFailure=new Promise((_,reject)=>page.once('pageerror',reject));
   await page.goto('http://127.0.0.1:'+server.address().port);await Promise.race([page.waitForFunction(()=>window.probeFlatLit&&window.probeFlatHdr&&window.probeManagedColor&&window.probeFlatSurface),bootFailure]);
   for(const fixture of (surfaceOnly?['surface']:colorOnly?[]:hdrOnly?['hdr']:['sdr','hdr','surface'])){
    const measured=[];
    for(const [backend,mode]of cases){
     const result=await page.evaluate(([backend,mode,fixture])=>(fixture==='surface'?window.probeFlatSurface:fixture==='hdr'?window.probeFlatHdr:window.probeFlatLit)(backend,mode),[backend,mode,fixture]);
     results.push({...result,fixture});measured.push(result);
     await writeFile(resolve(run,'partial.json'),JSON.stringify({results,errors},null,2));assert(result.ok,JSON.stringify(result.failure));
     for(const key of ['textureCount','bufferCount','programCount','renderTargetCount'])assert.equal(result.afterDestroy[key],0,key);
    }
    for(const mode of ['legacy','linear-srgb']){
     const gl=measured.find(r=>r.preferred==='webgl2'&&r.colorManagement===mode),gpu=measured.find(r=>r.preferred==='webgpu'&&r.colorManagement===mode);
     if(!gl||!gpu)continue;
     for(const a of gl.results){
      const b=gpu.results.find(r=>r.name===a.name);assert(b,'Missing '+mode+' '+a.name);
      const channels=mode==='linear-srgb'||fixture==='hdr'?4:3;
      const pixels=fixture==='hdr'?[a.rgba]:a.rgba,other=fixture==='hdr'?[b.rgba]:b.rgba;
      const delta=Math.max(...pixels.flatMap((pixel,j)=>pixel.slice(0,channels).map((v,k)=>Math.abs(v-other[j][k]))));
      assert(delta<=3,fixture+' '+mode+' '+a.name+' parity '+delta);
     }
    }
   }
   if(!hdrOnly&&!surfaceOnly){
    const measured=[];
    for(const backend of ['webgl2','webgpu']){
     const result=await page.evaluate(backend=>window.probeManagedColor(backend),backend);results.push({...result,fixture:'managed-color'});measured.push(result);
     await writeFile(resolve(run,'partial.json'),JSON.stringify({results,errors},null,2));assert(result.ok,JSON.stringify(result.failure));
     for(const key of ['textureCount','bufferCount','programCount','renderTargetCount'])assert.equal(result.afterDestroy[key],0,key);
    }
    for(const a of measured[0].results){const b=measured[1].results.find(r=>r.name===a.name);assert(b,'Missing managed color state '+a.name);assert.equal(a.pixels.length,b.pixels.length);const delta=Math.max(...a.pixels.map((v,k)=>Math.abs(v-b.pixels[k])));assert(delta<=3,a.name+' managed color RGBA parity '+delta);}
   }
   assert.deepEqual(errors,[]);
  }finally{await page.close();}
 }
}catch(error){failure={message:error.message,stack:error.stack};}
finally{
 await browser?.close();await new Promise(r=>server.close(r));const report={ok:!failure,results,errors,...(failure?{failure}:{})};
 await writeFile(resolve(run,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,report:resolve(run,'verification.json'),failure}));
}
if(failure)process.exitCode=1;
