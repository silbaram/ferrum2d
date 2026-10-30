import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { runReleaseCommand } from './github-release-command.mjs';
const {chromium}=await import(process.env.FERRUM_PLAYWRIGHT_MODULE??'playwright-core');
const root=resolve('.');await mkdir('artifacts/spatial-audio',{recursive:true});const out=await mkdtemp(resolve('artifacts/spatial-audio/run-'));
await runReleaseCommand('pnpm',['pack','--pack-destination',out],{cwd:resolve('packages/ferrum-web')});
const tgz=(await readdir(out)).find(n=>n.endsWith('.tgz'));assert(tgz);await runReleaseCommand('tar',['-xzf',resolve(out,tgz),'-C',out]);
const html=`<!doctype html><style>canvas{width:800px;height:600px}button{position:fixed;right:0;top:0}</style><button>Enable sound</button><canvas></canvas><script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/package/dist/core.js","@ferrum2d/ferrum-web/authoring":"/package/dist/authoring.js"}}</script><script type="module" src="/probe.mjs"></script>`;
const fixtures={'/probe.mjs':'tests/smoke/spatial-audio-browser-page.mjs','/spatial.mjs':'examples/data-scene-native/spatial.mjs','/spatial-audio.json':'examples/data-scene-native/spatial-audio.json','/assets/audio/water.wav':'examples/data-scene-native/assets/audio/water.wav','/assets/audio/fire.wav':'examples/data-scene-native/assets/audio/fire.wav'};
const server=createServer((request,response)=>{void(async()=>{
 const path=new URL(request.url,'http://localhost').pathname;
 if(path==='/'){response.setHeader('Content-Type','text/html');response.end(html);return;}
 if(path==='/favicon.ico'){response.writeHead(204).end();return;}
 const file=fixtures[path]?resolve(root,fixtures[path]):resolve(out,'.'+decodeURIComponent(path));
 if(!fixtures[path]&&(!file.startsWith(resolve(out,'package')+sep)||!/\.(js|wasm)$/.test(file))){response.writeHead(403).end();return;}
 response.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':file.endsWith('.json')?'application/json':file.endsWith('.wav')?'audio/wav':'application/javascript');response.end(await readFile(file));
})().catch(()=>response.writeHead(404).end());});
const report={status:'running',cases:[],wasmSha256:createHash('sha256').update(await readFile(resolve(out,'package/pkg/ferrum_core_bg.wasm'))).digest('hex')};let browser;
try{
 await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],...(process.env.FERRUM_BROWSER_EXECUTABLE?{executablePath:process.env.FERRUM_BROWSER_EXECUTABLE}:{})});report.browser=browser.version();
 for(const dpr of [1,2]){
  const page=await browser.newPage({viewport:{width:1000,height:720},deviceScaleFactor:dpr}),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.spatialAudioReady!==undefined);
  await page.waitForFunction(()=>window.nativeAudioNeedsUnlock||window.spatialAudioFailure);
  await page.click('button');
  const result=await page.evaluate(()=>window.spatialAudioReady);assert.equal(result.offline.length,12);assert.equal(result.native.voices,2);
  await page.click('button');assert.equal(await page.evaluate(()=>window.nativeAudioUnlock()),true);
  await page.screenshot({path:resolve(out,`native-dpr${dpr}.png`)});
  const cleanup=await page.evaluate(()=>window.nativeAudioCleanup());assert.equal(cleanup.closed,true);assert.deepEqual(errors,[]);report.cases.push({dpr,...result,unlocked:true,destroyed:cleanup.closed});await page.close();
 }
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error?.stack??error);throw error;}
finally{await browser?.close();await new Promise(yes=>server.close(yes));await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('Spatial audio report:',resolve(out,'report.json'));}
