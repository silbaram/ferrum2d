import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright-core';
import {installSpatialGpuTarget} from './spatial-webgpu-capture.mjs';

const dist=resolve('examples/starter-runtime/dist'),prefix='/nested/starter-runtime/';
const parent=resolve('artifacts/engine-playground');await mkdir(parent,{recursive:true});const run=await mkdtemp(resolve(parent,'run-'));
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.json':'application/json'};
const server=createServer((req,res)=>void(async()=>{
  const url=new URL(req.url,'http://localhost');if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(!url.pathname.startsWith(prefix)){res.writeHead(404).end();return;}
  const path=resolve(dist,decodeURIComponent(url.pathname.slice(prefix.length))||'index.html');
  if(!path.startsWith(dist+sep)){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',mime[extname(path)]??'application/octet-stream');res.end(await readFile(path));
})().catch(()=>res.writeHead(404).end()));
function gpuCapture() {
  const original=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(kind,...args){if(kind==='webgpu')this.dataset.spatialGpuTarget='true';return Reflect.apply(original,this,[kind,...args]);};
  const requestAdapter=navigator.gpu.requestAdapter.bind(navigator.gpu);
  navigator.gpu.requestAdapter=async(...args)=>{const adapter=await requestAdapter(...args);if(!adapter)return adapter;const requestDevice=adapter.requestDevice.bind(adapter);
    adapter.requestDevice=async(...args)=>{const device=await requestDevice(...args);window.playgroundGpuDevice=device;device.addEventListener('uncapturederror',e=>{window.playgroundGpuError=e.error.message;});return device;};return adapter;};
}
async function pixelHash() {
  const canvas=document.querySelector('canvas'),device=window.playgroundGpuDevice;
  let bytes;
  if(!device){const gl=canvas.getContext('webgl2');bytes=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);if(gl.getError())throw Error('GL readback');}
  else {
    await device.queue.onSubmittedWorkDone();const texture=canvas.getContext('webgpu').getCurrentTexture(),stride=Math.ceil(canvas.width*4/256)*256;
    const buffer=device.createBuffer({size:stride*canvas.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:stride,rowsPerImage:canvas.height},{width:canvas.width,height:canvas.height,depthOrArrayLayers:1});device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);bytes=new Uint8Array(buffer.getMappedRange()).slice();buffer.unmap();}finally{buffer.destroy();}
  }
  const colors=new Set();for(let i=0;i<bytes.length;i+=4)colors.add((bytes[i]<<16)|(bytes[i+1]<<8)|bytes[i+2]);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  return {hash,colors:colors.size};
}
let browser,activePage;const results=[];
try {
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  browser=await chromium.launch({headless:true,executablePath:process.env.FERRUM_BROWSER_EXECUTABLE,args:['--no-sandbox','--enable-unsafe-webgpu','--use-vulkan=swiftshader']});
  for(const backend of ['webgl2','webgpu']) {
    const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1}),errors=[];activePage=page;
    page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(!response.ok())errors.push(`HTTP ${response.status()} ${response.url()}`);});
    if(backend==='webgpu')await page.addInitScript({content:`(${installSpatialGpuTarget.toString()})();(${gpuCapture.toString()})();`});
    await page.goto(`http://127.0.0.1:${server.address().port}${prefix}?renderer=${backend}`);
    const snapshot=()=>page.evaluate(()=>window.ferrumEnginePlayground.snapshot());
    const ready=()=>page.waitForFunction(()=>window.ferrumEnginePlayground?.snapshot().state===1,undefined,{timeout:30000}).catch(error=>{throw Error(String(error)+' '+errors.join('\n'));});
    await ready();const initial=await snapshot();assert.equal(initial.backend,backend);assert.equal(initial.cells,0);assert.equal(initial.entities,258);assert(initial.commands>258&&initial.commands<=280);assert(initial.normalDrawCalls>0);assert(initial.drawCalls<=64);
    const image=await page.evaluate(pixelHash);assert(image.colors>40,'actual scene did not render varied pixels');
    if(backend==='webgl2')await page.screenshot({path:resolve(run,'desktop.png'),fullPage:true});
    await page.locator('canvas').focus();await page.keyboard.press('ArrowRight');
    await page.waitForFunction(x=>window.ferrumEnginePlayground.snapshot().actor.x>x+20,initial.actor.x);
    const moving=await snapshot();assert.equal(moving.animation.clip,1);
    // Pause leaves native actor/body positions unchanged while presentation remains interactive.
    await page.locator('[data-lab=pause]').click();const paused=await snapshot();await page.waitForTimeout(250);const still=await snapshot();assert.equal(still.actor.x,paused.actor.x);assert.equal(still.actor.y,paused.actor.y);
    const lit=await page.evaluate(pixelHash);await page.locator('[data-lab=normal]').uncheck();await page.waitForTimeout(100);const flat=await page.evaluate(pixelHash);assert.notEqual(flat.hash,lit.hash,'normal toggle did not affect actual pixels');assert.equal((await snapshot()).normalDrawCalls,0);
    await page.locator('[data-lab=normal]').check();await page.locator('[data-lab=lighting]').selectOption('off');await page.waitForTimeout(100);const unlit=await page.evaluate(pixelHash);assert.notEqual(unlit.hash,lit.hash);assert.equal((await snapshot()).normalDrawCalls,0);
    await page.locator('[data-lab=lighting]').selectOption('lit');await page.locator('[data-lab=effect]').selectOption('glow');await page.waitForFunction(()=>window.ferrumEnginePlayground.snapshot().postProcessPassCount>0);const glow=await page.evaluate(pixelHash);assert.notEqual(glow.hash,lit.hash);
    await page.locator('[data-lab=effect]').selectOption('clean');await page.locator('[data-lab=pause]').click();
    await page.locator('[data-lab=camera]').selectOption('follow');await page.waitForTimeout(400);const follow=await snapshot();assert.equal(follow.zoom,180);assert(Math.abs(follow.cameraX-320)>10,'camera did not follow robot');
    await page.locator('[data-lab=zoom]').fill('220');await page.locator('[data-lab=zoom]').dispatchEvent('input');assert.equal((await snapshot()).zoom,220);
    await page.locator('[data-lab=camera]').selectOption('overview');
    for(let i=0;i<3;i++){await page.locator(`[data-destination="${i}"]`).click();await page.waitForFunction(n=>window.ferrumEnginePlayground.snapshot().cells===n,i+1,{timeout:15000});}
    await page.waitForFunction(()=>document.querySelector('.playground-progress').textContent.includes('가동 완료'));
    assert.match(await page.locator('.playground-progress').textContent(),/가동 완료/);
    await page.locator('[data-lab=launch]').click();await page.waitForFunction(()=>window.ferrumEnginePlayground.snapshot().collisions>0,undefined,{timeout:5000});
    await page.waitForTimeout(250);const rubber=await snapshot();assert(rubber.ball.velocityX!==0||rubber.ball.velocityY!==0);
    await page.locator('[data-lab=pause]').click();const pausedBall=(await snapshot()).ball;await page.waitForTimeout(250);const frozenBall=(await snapshot()).ball;
    assert.equal(frozenBall.x,pausedBall.x);assert.equal(frozenBall.y,pausedBall.y);assert.equal(frozenBall.velocityX,pausedBall.velocityX);assert.equal(frozenBall.velocityY,pausedBall.velocityY);
    await page.locator('[data-lab=pause]').click();await page.waitForFunction(p=>{const b=window.ferrumEnginePlayground.snapshot().ball;return b.x!==p.x||b.y!==p.y;},pausedBall);
    await page.locator('[data-lab=material]').selectOption('clay');await page.locator('[data-lab=launch]').click();await page.waitForTimeout(1300);const clay=await snapshot();assert(Math.hypot(clay.ball.velocityX,clay.ball.velocityY)<Math.hypot(rubber.ball.velocityX,rubber.ball.velocityY)*.5,'material did not change actual velocity loss');
    await page.locator('[data-lab=reset]').click();await page.waitForFunction(()=>window.ferrumEnginePlayground.snapshot().cells===0&&window.ferrumEnginePlayground.snapshot().entities===258);const reset=await snapshot();assert.equal(reset.entities,258);assert.equal(reset.launches,0);assert.equal(reset.actor.x,64);assert.equal(reset.actor.y,296);
    // Screen coordinates must map through the camera into the same native navigation path.
    const target=await page.locator('canvas').evaluate(canvas=>{const r=canvas.getBoundingClientRect(),scale=Math.min(canvas.clientWidth/640,canvas.clientHeight/384);return {x:r.x+r.width/2+(96-320)*scale,y:r.y+r.height/2+(296-192)*scale};});
    await page.mouse.click(target.x,target.y);await page.waitForFunction(()=>window.ferrumEnginePlayground.snapshot().actor.x>84);
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'narrow layout overflows');
    const bounds=await page.locator('canvas').boundingBox();assert(bounds.width>300&&bounds.x>=0&&bounds.x+bounds.width<=390);
    await page.locator('[data-destination="0"]').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.ferrumEnginePlayground.snapshot().cells===1,undefined,{timeout:15000});
    if(backend==='webgl2')await page.screenshot({path:resolve(run,'mobile.png'),fullPage:true});
    assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.playgroundGpuError),undefined);
    const resources=await page.evaluate(()=>window.ferrumEnginePlayground.destroy());assert.equal(resources.textureCount,0);assert.equal(resources.bufferCount,0);assert.equal(resources.programCount,0);assert.equal(resources.renderTargetCount,0);
    results.push({backend,initial,image,movement:true,pointerNavigation:true,nativeCollection:3,paused:true,normals:true,lighting:true,postprocess:true,camera:true,rubberVelocity:Math.hypot(rubber.ball.velocityX,rubber.ball.velocityY),clayVelocity:Math.hypot(clay.ball.velocityX,clay.ball.velocityY),restart:true,keyboardAndNarrow:true,resources,errors});await page.close();
  }
  const report={ok:true,run,browser:browser.version(),webgpu:'Chromium software offscreen target; native canvas presentation not claimed',results};await writeFile(resolve(run,'verification.json'),JSON.stringify(report,null,2)+'\n');await writeFile(resolve(parent,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){
  const state=await activePage?.evaluate(()=>window.ferrumEnginePlayground?.snapshot()).catch(()=>undefined);
  await activePage?.screenshot({path:resolve(run,'failure.png'),fullPage:true}).catch(()=>{});
  await writeFile(resolve(run,'failure.json'),JSON.stringify({ok:false,run,results,state,error:String(error.stack??error)},null,2)+'\n');throw error;
}
finally{await browser?.close();await new Promise(done=>server.close(done));}
