import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { installSpatialGpuTarget } from './spatial-webgpu-capture.mjs';

const root=resolve('.'), parent=resolve('artifacts/sprite-palette');await mkdir(parent,{recursive:true});
const run=await mkdtemp(resolve(parent,'run-'));
const html='<!doctype html><style>body{margin:0}</style><script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/packages/ferrum-web/dist/core.js"}}</script><script type="module">import{probeSpritePalette,probePaletteRuntime,probePaletteSampling}from"/tests/smoke/sprite-palette-fixture.mjs";Object.assign(window,{probeSpritePalette,probePaletteRuntime,probePaletteSampling});</script>';
const server=createServer((req,res)=>void(async()=>{
  const url=new URL(req.url,'http://localhost');if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const path=resolve(root,'.'+decodeURIComponent(url.pathname));if(!path.startsWith(root+sep)||!/\.(?:m?js|wasm)$/.test(path)){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',path.endsWith('.wasm')?'application/wasm':'application/javascript');res.end(await readFile(path));
})().catch(()=>res.writeHead(404).end()));
let browser;const results=[];
try {
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  browser=await chromium.launch({headless:true,executablePath:process.env.FERRUM_BROWSER_EXECUTABLE,args:['--no-sandbox','--enable-unsafe-webgpu','--use-vulkan=swiftshader']});
  for(const dpr of [1,2]) {
    const page=await browser.newPage({viewport:{width:600,height:400},deviceScaleFactor:dpr});const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(installSpatialGpuTarget);await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.probeSpritePalette);
    try {
      const pair=[];
      for(const backend of ['webgl2','webgpu'])pair.push(await page.evaluate(async backend=>({...await window.probeSpritePalette(backend),runtime:await window.probePaletteRuntime(backend),sampling:await window.probePaletteSampling(backend)}),backend));
      const parity={};assert.deepEqual(Object.keys(pair[0].references),Object.keys(pair[1].references));
      for(const key of Object.keys(pair[0].references)) {
        const a=Buffer.from(pair[0].references[key],'base64'),b=Buffer.from(pair[1].references[key],'base64');assert.equal(a.length,b.length);
        let delta=0;for(let i=0;i<a.length;i++)if(i%4!==3)delta=Math.max(delta,Math.abs(a[i]-b[i]));
        // Legacy targets have different alpha accumulation; assert RGB parity and
        // explicit transparent/half-alpha coverage in the fixture instead.
        assert(delta<=2,`palette ${key} RGB parity at DPR ${dpr}: ${delta}`);parity[key]=delta;
      }
      for(const entry of pair){delete entry.references;results.push({dpr,...entry,parity});}
      if(dpr===1){const linear=await page.evaluate(()=>window.probeSpritePalette('webgl2','linear-srgb'));delete linear.references;results.push({dpr,...linear});}
      assert.deepEqual(errors,[]);
    } catch(error) {await page.screenshot({path:resolve(run,'failure-'+dpr+'.png')});throw error;} finally {await page.close();}
  }
  const report={ok:true,run,browser:browser.version(),target:'Real WebGL2 and software WebGPU offscreen targets; physical GPU performance/native compositor not claimed',results};
  await writeFile(resolve(run,'verification.json'),JSON.stringify(report,null,2)+'\n');await writeFile(resolve(parent,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
} catch(error) {await writeFile(resolve(parent,'verification.json'),JSON.stringify({ok:false,run,results,error:String(error.stack??error)},null,2));throw error;}
finally {await browser?.close();await new Promise(done=>server.close(done));}
