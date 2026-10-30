import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,readdir} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {runReleaseCommand} from './github-release-command.mjs';
await mkdir('artifacts/village-game-quality',{recursive:true});
const out=await mkdtemp(resolve('artifacts/village-game-quality/run-'));
await runReleaseCommand('pnpm',['pack','--pack-destination',out],{cwd:resolve('packages/ferrum-web')});
await runReleaseCommand('tar',['-xzf',resolve(out,(await readdir(out)).find(n=>n.endsWith('.tgz'))),'-C',out]);
const html=`<!doctype html><style>body{margin:0}canvas{width:960px;height:640px}button{position:fixed;right:0;top:0}</style><button>Audio</button><canvas></canvas><script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/package/dist/core.js","@ferrum2d/ferrum-web/authoring":"/package/dist/authoring.js","@ferrum2d/ferrum-web/quality":"/package/dist/quality.js"}}</script><script type="module">import{startVillageQuality}from'/village-game-quality-fixture.mjs';window.startVillageQuality=startVillageQuality;</script>`;
const fixtures={
 '/village-game-quality-fixture.mjs':'tests/smoke/village-game-quality-fixture.mjs',
 '/hd2d-combat-browser-fixture.mjs':'tests/smoke/hd2d-combat-browser-fixture.mjs',
 '/village.scene.json':'apps/placement-viewer/public/placement.village.scene-authoring.json',
 '/rock.glb':'examples/data-scene-native/assets/rock.glb',
 '/audio/water.wav':'examples/data-scene-native/assets/audio/water.wav',
 '/audio/fire.wav':'examples/data-scene-native/assets/audio/fire.wav',
};
const fixtureBytes=new Map();
for(const [url,file] of Object.entries(fixtures))fixtureBytes.set(url,await readFile(resolve(file)));
const server=createServer((req,res)=>{void(async()=>{
 const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(path==='/'){res.setHeader('content-type','text/html');res.end(html);return;}
 if(path==='/favicon.ico'){res.writeHead(204).end();return;}
 const root=path.startsWith('/village/')?resolve('apps/placement-viewer/public/assets/rpg-village'):path.startsWith('/lod/')?resolve('tests/fixtures/village-lod'):resolve(out,'package');
 const file=fixtures[path]?resolve(fixtures[path]):resolve(root,'.'+(path.startsWith('/lod/')?path.slice(4):path.slice(8)));
 if(!fixtures[path]&&(!file.startsWith(root+sep)||!path.startsWith('/village/')&&!path.startsWith('/lod/')&&!path.startsWith('/package/'))){res.writeHead(403).end();return;}
 res.setHeader('content-type',({'.js':'application/javascript','.mjs':'application/javascript','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.glb':'model/gltf-binary','.wav':'audio/wav'})[extname(file)]??'application/octet-stream');res.end(fixtureBytes.get(path)??await readFile(file));
})().catch(e=>{res.writeHead(404).end();});});
const report={status:'running',cases:[],sourceHashes:{},wasmSha256:createHash('sha256').update(await readFile(resolve(out,'package/pkg/ferrum_core_bg.wasm'))).digest('hex'),modelLoaderSha256:createHash('sha256').update(await readFile(resolve(out,'package/dist/spatialModel.js'))).digest('hex')};
for(const file of Object.values(fixtures).concat(['apps/placement-viewer/public/assets/rpg-village/manifest.json','tests/fixtures/village-lod/manifest.json','tests/fixtures/village-lod/tree.glb','tests/fixtures/village-lod/pine.glb']))report.sourceHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const villageManifest=JSON.parse(await readFile('apps/placement-viewer/public/assets/rpg-village/manifest.json','utf8'));
for(const entry of [...Object.values(villageManifest.models),...Object.values(villageManifest.textures)]){
 const file='apps/placement-viewer/public/assets/rpg-village/'+entry.file;
 const actual=createHash('sha256').update(await readFile(file)).digest('hex');
 assert.equal(actual,entry.sha256,'village manifest hash mismatch: '+file);report.sourceHashes[file]=actual;
}
report.packageSha256=createHash('sha256').update(await readFile(resolve(out,(await readdir(out)).find(n=>n.endsWith('.tgz'))))).digest('hex');

let browser;
const summary=values=>{const v=values.filter(Number.isFinite).sort((a,b)=>a-b);return {count:v.length,p50:v[Math.floor(v.length*.5)],p95:v[Math.min(v.length-1,Math.floor(v.length*.95))],max:v.at(-1)};};
try{
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 browser=await chromium.launch({headless:true,executablePath:process.env.FERRUM_BROWSER_EXECUTABLE,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 report.browser=browser.version();
 for(const effects of [false,true])for(const lod of [false,true])for(let repeat=0;repeat<2;repeat++){
  const page=await browser.newPage({viewport:{width:1040,height:720},deviceScaleFactor:1}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.startVillageQuality);
  await page.evaluate(async ({effects,lod})=>{window.demo=await window.startVillageQuality(document.querySelector('canvas'),{effects,lod,audio:true});document.querySelector('button').onclick=()=>window.demo.audio.unlock();},{effects,lod});
  await page.click('button');
  assert.equal(await page.evaluate(()=>window.demo.audio.unlock()),true);
  const adapter=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {vendor:gl.getParameter(ext?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)};});
  const modelEvidence=await page.evaluate(()=>window.demo.modelEvidence);
  const result=await page.evaluate(()=>window.demo.sample({warmupMs:1000,durationMs:2500}));
  assert.deepEqual(result.errors,[]);assert(result.frames>=10);assert.equal(result.modelCount,42);assert(result.after.spawned>result.before.spawned,'native combat must fire');assert(result.elevationRange.max>=20&&result.elevationRange.min===0,'live input must traverse the village ramp');assert(result.frameTrace.captures.length>0,'slow-frame windows missing');
  assert(result.maxParticles>0,'native combat VFX missing');
  const audioState=await page.evaluate(()=>window.demo.audio.state());assert.equal(audioState.spatialVoiceCount,2,'live spatial ambience missing');
  assert(result.rows.every(r=>r.drawCalls<=256&&r.modelUploadBytes===0&&r.rustMs<250&&r.renderMs<1000),'village work budget exceeded');
  for(const field of ['bufferCount','textureCount','programCount'])assert.equal(result.resources[field],result.resourceBaseline[field],'warm resource growth: '+field);
  assert(result.wasmMemoryBytes>0&&result.wasmMemoryBytes<=128*1024*1024,'village Wasm memory budget exceeded');
  assert(result.resources.bufferBytes<=16*1024*1024&&result.resources.estimatedBytes<=64*1024*1024,'village storage budget exceeded');
  await page.screenshot({path:resolve(out,`village-effects-${effects}-lod-${lod}-${repeat}.png`)});
  const saved=await page.evaluate(()=>window.demo.saveCheck());
  const cleanup=await page.evaluate(()=>window.demo.destroy());
  assert.equal(cleanup.voices,0);for(const field of ['bufferCount','textureCount','programCount','renderTargetCount'])assert.equal(cleanup.gpu[field],0,'owned GPU resource leaked: '+field);assert.deepEqual(errors,[]);
  report.cases.push({effects,lod,repeat,adapter,cleanup,modelEvidence,audioState,conditions:{environmentEffects:effects,combatVfx:true,spatialAudio:true},viewport:{width:960,height:640,dpr:1},saved,...result,summary:{rust:summary(result.rows.map(r=>r.rustMs)),render:summary(result.rows.map(r=>r.renderMs)),interval:summary(result.rows.map(r=>r.intervalMs)),audio:summary(result.rows.map(r=>r.audioMs)),gpu:summary(result.gpuSamples.map(r=>r.elapsedMs))}});
  await page.close();
 }
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);throw error;}
finally{await browser?.close();await new Promise(done=>server.close(done));await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(resolve(out,'report.json'));}
