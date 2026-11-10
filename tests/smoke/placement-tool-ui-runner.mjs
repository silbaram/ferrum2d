import { smokePlacementFlatLighting } from "./placement-flat-lighting-smoke.mjs";
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {smokeAuthoringUpgrades} from './placement-authoring-upgrades-smoke.mjs';
import {smokePlacementUiPolish} from './placement-ui-polish-smoke.mjs';
import {smokePlacementUiReviewFixes} from './placement-ui-review-fixes-smoke.mjs';
import {placementSpatialWorkspaceSource} from './placement-spatial-workspace-smoke.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright-core';
import {preparePlacementTestBuild} from './placement-test-build.mjs';
import {smokePlacementToolUi} from './placement-tool-ui-smoke.mjs';
import {smokePlacementUpdates} from './placement-updates-smoke.mjs';
import {smokePlacementGameCamera} from './placement-game-camera-smoke.mjs';
import {showPlacementAssetPanel,showPlacementBottom,showPlacementInspector} from './placement-panel-navigation.mjs';
const base=await preparePlacementTestBuild(resolve('apps/placement-viewer/dist'));
const server=createServer(async(request,response)=>{
 try{const path=new URL(request.url,'http://localhost').pathname,file=resolve(base,'.'+(path==='/'?'/index.html':decodeURIComponent(path)));assert(file.startsWith(base+sep));response.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');response.end(await readFile(file));}
 catch{response.writeHead(404);response.end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.FERRUM_BROWSER_EXECUTABLE,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const parent=await browser.newPage();await parent.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'networkidle'});
 const results=[];
 if(process.argv.includes('--flat-lit')) results.push(await smokePlacementFlatLighting(parent));
 else if(process.argv.includes('--spatial-fields')){
  await parent.setViewportSize({width:1440,height:960});
  const initialKey=await parent.evaluate(()=>window.ferrumPlacementWorkspaceActiveDocument);
  await showPlacementAssetPanel(parent,'model');
  await parent.locator('[data-placement-model-key]:visible').fill('rock');
  await parent.evaluate(()=>{window.__fieldModelImported=false;window.addEventListener('ferrum-placement-model-import',()=>{window.__fieldModelImported=true;},{once:true});});
  await parent.locator('[data-placement-model-file]:visible').setInputFiles('examples/data-scene-native/assets/rock.glb');
  await parent.waitForFunction(()=>window.__fieldModelImported);
  const source=placementSpatialWorkspaceSource(createHash('sha256').update(await readFile('examples/data-scene-native/assets/rock.glb')).digest('hex'));
  await parent.locator('[data-placement-document-file]').setInputFiles({name:'spatial.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});
  await parent.waitForFunction(()=>window.ferrumPlacementWorkspaceMode==='spatial'&&!document.querySelector('.demo-shell').inert);
  await showPlacementInspector(parent);
  const spatialKey=await parent.evaluate(()=>window.ferrumPlacementWorkspaceActiveDocument);
  const snapshot=()=>parent.evaluate(()=>JSON.stringify({doc:window.ferrumPlacementSpatialExportDocument(),patch:window.ferrumPlacementViewerExportPatch(),history:window.ferrumPlacementViewerHistory}));
  const before=await snapshot();
  for(const target of ['surface:ground','billboard:sprite','model:rock','surface:bridge','model:rock']){
   await parent.locator('[data-placement-spatial-target]:visible').selectOption(target);
   if(target.startsWith('model:'))assert(await parent.locator('[data-placement-spatial-field="yaw"]').isVisible(),'Model yaw must be visible after target change');
   assert(await parent.locator('[data-placement-spatial-field="x"]').isVisible());
   assert(await parent.locator('.placement-inspector:visible [data-section="transform"]').isHidden(),'Filtering must not expose the 2D section in spatial mode');
   assert(await parent.locator('[data-placement-spatial-field]').evaluateAll(nodes=>nodes.every(input=>{const row=input.closest('.placement-property-row');return row&&!row.parentElement.closest('.placement-property-row')&&row.querySelectorAll('[data-placement-property-reset]').length===1;})),'Shared fields have one filter row and reset action');
  }
  for(let i=0;i<2;i++){
   for(const key of [initialKey,spatialKey]){await parent.locator(`[data-placement-document-key=${JSON.stringify(key)}]`).click();await parent.waitForFunction(key=>window.ferrumPlacementWorkspaceActiveDocument===key,key);}
   await showPlacementInspector(parent);assert(await parent.locator('[data-placement-spatial-field="yaw"]').isVisible());
   assert.equal(await parent.locator('[data-placement-spatial-field="yaw"]').evaluate(input=>{let count=0;for(let node=input.parentElement;node;node=node.parentElement)if(node.classList.contains('placement-property-row'))count++;return count;}),1);
  }
  assert.equal(await snapshot(),before,'Target and cached-document navigation preserve source and history');
  results.push({ok:true,spatialFieldTransitions:true,documentRoundTrips:2,singleFilterOwner:true,sourcePreserved:true});
 }
 else if(process.argv.includes('--updates'))results.push(await smokePlacementUpdates(parent,30000));
 else if(process.argv.includes('--game-camera'))results.push(await smokePlacementGameCamera(parent,30000));
 else if(process.argv.includes('--spatial-authoring')){
  const source=placementSpatialWorkspaceSource(createHash('sha256').update(await readFile('examples/data-scene-native/assets/rock.glb')).digest('hex'));
  results.push(await smokeAuthoringUpgrades(parent,source,30000));results.push(await smokePlacementUiPolish(parent,source,30000));results.push(await smokePlacementUiReviewFixes(parent,source,30000));
 }
 else for(const mode of ['2d','spatial'])results.push(await smokePlacementToolUi(parent,mode));
 console.log(JSON.stringify({ok:true,results},null,2));
}finally{await browser?.close();await new Promise(done=>server.close(done));}
