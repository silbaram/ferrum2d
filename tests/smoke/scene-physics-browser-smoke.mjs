#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {showPlacementBottom} from './placement-panel-navigation.mjs';
import {prepareStudioDemoBuild} from './placement-test-build.mjs';
const out=resolve('artifacts/physics-3d/scene-authoring-browser');await mkdir(out,{recursive:true});
// The fixture replaces the default garden scene, which only the web demo build opens.
const root=await prepareStudioDemoBuild(),fixture=await readFile('docs/engine/samples/data-scene-physics.scene-authoring.json');
let servedFixture=fixture;
const types={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm','.json':'application/json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=createServer((req,res)=>{void(async()=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/placement.garden.scene-authoring.json'){res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(servedFixture);return;}
  if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',types[extname(file)]??'application/octet-stream');res.end(await readFile(file));
})().catch(()=>res.writeHead(404).end());});
let browser,page;
const report={status:'running',scope:'Actual Studio build: document physics, render submission, read-only native XYZ diagnostics, play/stop and placement reapply',fixtureSha256:createHash('sha256').update(fixture).digest('hex')};
try{
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const options={headless:true,args:['--no-sandbox','--disable-dev-shm-usage']};
  if(process.env.FERRUM_BROWSER_EXECUTABLE)browser=await chromium.launch({...options,executablePath:process.env.FERRUM_BROWSER_EXECUTABLE});
  else {try{browser=await chromium.launch({...options,channel:process.env.FERRUM_BROWSER_CHANNEL??'chrome'});}catch(e){if(process.env.FERRUM_BROWSER_CHANNEL)throw e;browser=await chromium.launch({...options,channel:'chromium'});}}
  page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const wait=(fn,arg)=>page.waitForFunction(fn,arg,{timeout:45000});
  await wait(()=>window.ferrumPlacementViewerState?.instances.some(i=>i.instanceId==='ball')&&window.ferrumPlacementViewerRuntimeFrame?.drawCalls>0);
  await page.evaluate(()=>window.ferrumPlacementViewerSelect('ball'));
  await showPlacementBottom(page,'runtime');
  await wait(()=>window.ferrumPlacementSelectedRuntime?.shapePhysics?.colliderCount===1);
  report.initial=await page.evaluate(()=>window.ferrumPlacementSelectedRuntime.shapePhysics);
  await page.locator('[data-placement-playback="play"]').click();
  await wait(()=>window.ferrumPlacementSelectedRuntime?.mode==='game'&&window.ferrumPlacementSelectedRuntime.shapePhysics?.position[1]<60);
  await wait(()=>{const b=window.ferrumPlacementSelectedRuntime?.shapePhysics;return b&&Math.abs(b.position[1]-8)<1&&Math.abs(b.velocity[1])<1;});
  report.playing=await page.evaluate(()=>({physics:window.ferrumPlacementSelectedRuntime.shapePhysics,frame:window.ferrumPlacementViewerRuntimeFrame,text:document.querySelector('[data-placement-physics-summary]')?.textContent}));
  assert.equal(report.playing.frame.entityCount,1);assert.equal(report.playing.frame.drawCalls,2);
  assert.equal(report.playing.frame.spatial.billboardVertices,6);assert.equal(report.playing.frame.spatial.terrainVertices,36);
  assert(Number.isFinite(report.playing.frame.rustUpdateTimeMs));
  assert(!report.playing.text.includes('Visual only'));
  await page.screenshot({path:resolve(out,'playing.png')});
  await page.locator('[data-placement-playback="stop"]').click();
  await wait(()=>Math.abs((window.ferrumPlacementSelectedRuntime?.shapePhysics?.position[1]??0)-72)<0.01);
  await page.evaluate(()=>window.ferrumPlacementViewerUpdateTransform('ball',{x:20,scale:1.5}));
  await wait(()=>{const b=window.ferrumPlacementSelectedRuntime?.shapePhysics;return b&&Math.abs(b.position[0]-20)<0.01&&Math.abs(b.position[1]-76)<0.01;});
  report.edited=await page.evaluate(()=>({physics:window.ferrumPlacementSelectedRuntime.shapePhysics,patch:window.ferrumPlacementViewerExportPatch()}));
  assert(report.edited.patch);assert.equal(report.edited.physics.colliderCount,1);assert.deepEqual(errors,[]);
  await page.locator('[data-placement-mode="spatial"]').click();
  await page.selectOption('[data-placement-spatial-target]:visible','billboard:ball');
  const height=page.locator('[data-placement-spatial-field="elevation"]:visible');
  assert.equal(await height.inputValue(),'64');
  await height.fill('96');await page.locator('canvas.demo-canvas').focus();
  await wait(()=>Math.abs((window.ferrumPlacementSelectedRuntime?.shapePhysics?.position[1]??0)-108)<0.01);
  report.heightEdit=await page.evaluate(()=>({body:window.ferrumPlacementViewerState.selected.body,physics:window.ferrumPlacementSelectedRuntime.shapePhysics,patch:window.ferrumPlacementViewerExportPatch()}));
  assert.equal(report.heightEdit.body.elevation,96);assert.equal(report.heightEdit.body.collider.shape.radius,8);
  assert.deepEqual(report.heightEdit.body.renderOffset,[0,-8,0]);
  await page.screenshot({path:resolve(out,'height-edit.png')});
  await page.evaluate(()=>window.ferrumPlacementViewerUndo());
  await wait(()=>Math.abs((window.ferrumPlacementSelectedRuntime?.shapePhysics?.position[1]??0)-76)<0.01);
  // Flat documents must select the full authoring path even with no spatial/lighting/gameplay section.
  const flat=JSON.parse(fixture);delete flat.spatial;
  flat.physics.space='planar-xy';flat.physics.gravity=[0,32,0];
  // Keep the flat fixture inside the default game camera, independently of the edit camera.
  Object.assign(flat.sceneComposition.fragments.main.instances[0],{x:800,y:480});
  Object.assign(flat.sceneComposition.prefabs.ball.props.components.body,{elevation:0,renderOffset:[0,0,0]});
  servedFixture=Buffer.from(JSON.stringify(flat));
  await page.goto(`http://127.0.0.1:${server.address().port}/?physics=flat`);
  await wait(()=>window.ferrumPlacementViewerState?.instances.some(i=>i.instanceId==='ball')&&window.ferrumPlacementViewerRuntimeFrame?.drawCalls>0);
  await page.evaluate(()=>window.ferrumPlacementViewerSelect('ball'));await showPlacementBottom(page,'runtime');
  await wait(()=>window.ferrumPlacementSelectedRuntime?.shapePhysics?.colliderCount===1);
  await page.waitForTimeout(600); // More than two diagnostic refreshes; edit mode must remain paused.
  report.flatInitial=await page.evaluate(()=>({camera:window.ferrumPlacementEditCamera,viewport:window.ferrumPlacementViewerState.viewport,physics:window.ferrumPlacementSelectedRuntime.shapePhysics,frame:window.ferrumPlacementViewerRuntimeFrame}));
  assert.equal(report.flatInitial.physics.position[1],480);assert.equal(report.flatInitial.physics.velocity[1],0);
  await page.locator('[data-placement-playback="play"]').click();
  await wait(()=>window.ferrumPlacementSelectedRuntime?.mode==='game'&&window.ferrumPlacementSelectedRuntime.shapePhysics?.position[1]>481);
  report.flat=await page.evaluate(()=>({physics:window.ferrumPlacementSelectedRuntime.shapePhysics,frame:window.ferrumPlacementViewerRuntimeFrame}));
  assert.equal(report.flat.physics.position[2],0);assert.equal(report.flat.frame.entityCount,1);
  assert(report.flat.frame.renderCommandCount>0&&report.flat.frame.drawCalls>0);
  await page.locator('[data-placement-playback="stop"]').click();
  await wait(()=>Math.abs((window.ferrumPlacementSelectedRuntime?.shapePhysics?.position[1]??Infinity)-480)<0.01);
  await page.evaluate(()=>window.ferrumPlacementViewerUpdateTransform('ball',{x:820,scale:2}));
  await wait(()=>window.ferrumPlacementSelectedRuntime?.shapePhysics?.position[0]===820);
  await page.waitForTimeout(600);
  report.flatEdited=await page.evaluate(()=>({physics:window.ferrumPlacementSelectedRuntime.shapePhysics,patch:window.ferrumPlacementViewerExportPatch()}));
  assert.equal(report.flatEdited.physics.position[1],480);assert.equal(report.flatEdited.physics.velocity[1],0);
  assert(report.flatEdited.patch.operations.some(op=>op.kind==='updateTransform'&&op.transform.scale===2));
  const constraints=await readFile('docs/engine/samples/data-scene-constraints.scene-authoring.json');
  report.constraintsFixtureSha256=createHash('sha256').update(constraints).digest('hex');
  servedFixture=constraints;
  await page.goto(`http://127.0.0.1:${server.address().port}/?physics=constraints`);
  await wait(()=>window.ferrumPlacementViewerState?.instances.some(i=>i.instanceId==='actor')&&window.ferrumPlacementViewerRuntimeFrame?.drawCalls>0);
  await page.evaluate(()=>window.ferrumPlacementViewerSelect('actor'));await showPlacementBottom(page,'runtime');
  await wait(()=>window.ferrumPlacementSelectedRuntime?.shapePhysics?.character!==undefined);
  report.controllerInitial=await page.evaluate(()=>window.ferrumPlacementSelectedRuntime.shapePhysics);
  assert.equal(report.controllerInitial.position[1],2);
  await page.locator('[data-placement-playback="play"]').click();
  await wait(()=>window.ferrumPlacementSelectedRuntime?.shapePhysics?.character?.grounded===true);
  report.controllerPlaying=await page.evaluate(()=>({physics:window.ferrumPlacementSelectedRuntime.shapePhysics,frame:window.ferrumPlacementViewerRuntimeFrame,text:document.querySelector('[data-placement-physics-summary]')?.textContent}));
  assert(Math.abs(report.controllerPlaying.physics.position[1]-0.76)<0.05);
  assert.equal(report.controllerPlaying.frame.entityCount,3);assert(report.controllerPlaying.frame.drawCalls>0&&report.controllerPlaying.frame.drawCalls<=4);
  assert.equal(report.controllerPlaying.frame.spatial.billboardVertices,18);assert.equal(report.controllerPlaying.frame.spatial.terrainVertices,36);
  assert(Number.isFinite(report.controllerPlaying.frame.rustUpdateTimeMs));
  await page.keyboard.down('d');
  try { await wait(()=>window.ferrumPlacementSelectedRuntime?.shapePhysics?.position[0]>0.4); }
  finally { await page.keyboard.up('d'); }
  report.controllerWalked=await page.evaluate(()=>({physics:window.ferrumPlacementSelectedRuntime.shapePhysics,frame:window.ferrumPlacementViewerRuntimeFrame}));
  assert(report.controllerWalked.physics.position[0]>0.4);
  assert(Math.abs(report.controllerWalked.physics.position[1]-0.76)<0.05);
  assert.equal(report.controllerWalked.frame.entityCount,3);
  await page.evaluate(()=>window.ferrumPlacementViewerSelect('slider'));
  await wait(()=>Math.abs((window.ferrumPlacementSelectedRuntime?.shapePhysics?.position[0]??0)-4)<0.2);
  report.jointPlaying=await page.evaluate(()=>window.ferrumPlacementSelectedRuntime.shapePhysics);
  assert(Math.abs(report.jointPlaying.position[1]-2)<0.05);
  await page.screenshot({path:resolve(out,'constraints.png')});
  await page.locator('[data-placement-playback="stop"]').click();
  await wait(()=>Math.abs((window.ferrumPlacementSelectedRuntime?.shapePhysics?.position[0]??0)-3)<0.01);
  await page.evaluate(()=>window.ferrumPlacementViewerSelect('actor'));
  await wait(()=>window.ferrumPlacementSelectedRuntime?.shapePhysics?.position[1]===2);
  await page.evaluate(()=>window.ferrumPlacementViewerUpdateTransform('actor',{scale:1.5,x:1}));
  await wait(()=>window.ferrumPlacementSelectedRuntime?.shapePhysics?.position[0]===1);
  report.controllerEdited=await page.evaluate(()=>({physics:window.ferrumPlacementSelectedRuntime.shapePhysics,body:window.ferrumPlacementViewerState.selected.body,patch:window.ferrumPlacementViewerExportPatch()}));
  assert.equal(report.controllerEdited.physics.position[1],2);assert.equal(report.controllerEdited.body.character.skinWidth,0.01);assert(report.controllerEdited.patch);
  assert.deepEqual(errors,[]);
  Object.assign(report,{status:'passed',browser:browser.version(),errors});
}catch(e){Object.assign(report,{status:'failed',error:String(e)});if(page)await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});throw e;}
finally{await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();await new Promise(done=>server.close(done));}
console.log(JSON.stringify(report));
