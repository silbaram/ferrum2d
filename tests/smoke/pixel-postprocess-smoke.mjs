import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { installSpatialGpuTarget } from './spatial-webgpu-capture.mjs';

const root=resolve('.'),parent=resolve('artifacts/pixel-postprocess');await mkdir(parent,{recursive:true});
const run=await mkdtemp(resolve(parent,'run-'));
const html='<!doctype html><script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/packages/ferrum-web/dist/core.js"}}</script><script type="module">import{probePixelPostProcess,probePixelPostProcessRuntime,probePixelPostProcessAlpha}from"/tests/smoke/pixel-postprocess-fixture.mjs";Object.assign(window,{probePixelPostProcess,probePixelPostProcessRuntime,probePixelPostProcessAlpha});</script>';
const server=createServer((req,res)=>void(async()=>{
  const url=new URL(req.url,'http://localhost');if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const path=resolve(root,'.'+decodeURIComponent(url.pathname));if(!path.startsWith(root+sep)||!/\.(?:m?js|wasm)$/.test(path)){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',path.endsWith('.wasm')?'application/wasm':'application/javascript');res.end(await readFile(path));
})().catch(()=>res.writeHead(404).end()));
let browser;const results=[],native=[],alpha=[],references=new Map();
const compare=(a,b)=>{assert.equal(a.length,b.length);let delta=0;for(let i=0;i<a.length;i++)delta=Math.max(delta,Math.abs(a[i]-b[i]));assert(delta<=2,'virtual RGB/alpha parity '+delta);return delta;};
try {
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  browser=await chromium.launch({headless:true,executablePath:process.env.FERRUM_BROWSER_EXECUTABLE,args:['--no-sandbox','--enable-unsafe-webgpu','--use-vulkan=swiftshader']});
  for(const dpr of [1,2]) {
    const page=await browser.newPage({viewport:{width:600,height:400},deviceScaleFactor:dpr});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(installSpatialGpuTarget);await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.probePixelPostProcess);
    try {
      for(const virtual of [false,true])for(const backend of ['webgl2','webgpu']){
        const entry=await page.evaluate(([b,v])=>window.probePixelPostProcess(b,'legacy',v),[backend,virtual]);
        if(virtual){if(references.size)entry.parityMaxDelta=compare(references.values().next().value,entry.reference);references.set(backend+dpr,entry.reference);delete entry.reference;}
        results.push({dpr,...entry});
      }
      for(const backend of ['webgl2','webgpu'])native.push({dpr,...await page.evaluate(b=>window.probePixelPostProcessRuntime(b),backend)});
      alpha.push({dpr,...await page.evaluate(()=>window.probePixelPostProcessAlpha())});
      if(dpr===1)for(const virtual of [false,true]){const entry=await page.evaluate(v=>window.probePixelPostProcess('webgl2','linear-srgb',v),virtual);delete entry.reference;results.push({dpr,...entry});}
      assert.deepEqual(errors,[]);
    } catch(error){await page.screenshot({path:resolve(run,'failure-'+dpr+'.png')});throw error;}finally{await page.close();}
  }
  const report={ok:true,run,browser:browser.version(),target:'Real shaders on WebGL2/software WebGPU offscreen; no physical GPU/compositor claims',results,native,alpha};
  await writeFile(resolve(run,'verification.json'),JSON.stringify(report,null,2)+'\n');await writeFile(resolve(parent,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
} catch(error){const report={ok:false,run,results,native,error:String(error.stack??error)};await writeFile(resolve(run,'verification.json'),JSON.stringify(report,null,2));throw error;}
finally{await browser?.close();await new Promise(done=>server.close(done));}
