import assert from "node:assert/strict";
import {mkdir,readFile,writeFile,mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {showPlacementDock,showPlacementInspector,showPlacementMenu} from "./placement-panel-navigation.mjs";

const assetDocument=()=>({
 format:"ferrum2d.consumer.scene-authoring",version:1,
 sceneComposition:{prefabs:{"closed/tree":{props:{id:"unrelated-gameplay-id",components:{
  visual:{kind:"sprite",asset:"closed-only",normalTexture:"closed-normal",width:16,height:16},collider:"none",layer:"wall",
 }}}}},
 spatial:{camera:{projection:"orthographic",position:{x:160,y:-240,elevation:220},target:{x:0,y:0,elevation:0},height:240},
  terrain:[],billboards:{},models:{tree:{asset:"closed-only",contentId:"a".repeat(64),lods:[{asset:"closed-low",contentId:"b".repeat(64),minDistance:100}]}},
 },
});
const evidence=page=>page.evaluate(()=>JSON.stringify({document:window.ferrumPlacementSpatialExportDocument(),patch:window.ferrumPlacementViewerExportPatch(),history:window.ferrumPlacementViewerHistory,selected:window.ferrumPlacementViewerState.selectedInstanceIds,mode:window.ferrumPlacementWorkspaceMode,tabs:window.ferrumPlacementWorkspaceDocuments}));
const panel=page=>page.locator('[data-placement-asset-usage]');
async function reveal(page){await showPlacementDock(page,'runtime');await page.locator('.placement-runtime-dock [data-placement-panel-tab="assets"]').click();if(!await panel(page).evaluate(e=>e.open))await panel(page).locator(':scope > summary').click();}
async function report(page){const download=page.waitForEvent('download');await panel(page).locator('[data-placement-usage-export]').click();const item=await download;return JSON.parse(await readFile(await item.path(),'utf8'));}
async function scan(page){await reveal(page);await panel(page).locator('[data-placement-usage-scan]').click();await panel(page).locator('[data-placement-usage-export]').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('[data-placement-usage-export]').disabled);return report(page);}

/** Uses actual UI and native Wasm rendering; project IO bridge emulation is labelled separately. */
export async function smokePlacementAssetUsage(parent,mode='2d',timeoutMs=30000){
 const output='artifacts/project-asset-usage';await mkdir(output,{recursive:true});
 const page=await parent.context().browser().newPage({viewport:{width:1440,height:960},deviceScaleFactor:mode==='spatial'?2:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));let folder,emptyFolder,releaseRead;
 await page.addInitScript(()=>{
  const original=window.fetch.bind(window);window.__usageAbortedPaths=[];
  window.fetch=(input,options)=>{const path=new URL(input instanceof Request?input.url:String(input),location.href).pathname;
   if(options?.signal)options.signal.addEventListener('abort',()=>window.__usageAbortedPaths.push(path),{once:true});
   return original(input,options);};
 });
 try{
  const base=new URL('./',parent.url()),url=new URL(base);if(mode==='spatial')url.search='?scene=hd2d';
  await page.goto(url.href,{waitUntil:'networkidle'});await page.waitForFunction(mode=>window.ferrumPlacementWorkspaceMode===mode&&window.ferrumPlacementViewerRuntimeFrame?.drawCalls>0,mode,{timeout:timeoutMs});
  await page.locator('[data-placement-language]').selectOption('en');
  const initialFile=mode==='spatial'?'placement.hd2d.scene-authoring.json':'placement.scene-authoring.json';
  const original=await(await page.request.get(new URL(initialFile,base).href)).json();
  await page.route('**/placement-scenes.json',route=>route.fulfill({json:{version:1,truncated:true,diagnostics:[{relativePath:'locked',code:'EACCES'}],scenes:[{relativePath:initialFile,mode:mode==='spatial'?'hd2d':'2d'},{relativePath:'levels/closed.json',mode:'2d'},{relativePath:'levels/malformed.json',mode:'2d'},{relativePath:'broken.scene-authoring.json',mode:'invalid'},{relativePath:'levels/missing.json',mode:'2d'}]}}));
  await page.route('**/levels/closed.json',route=>route.fulfill({json:assetDocument()}));
  await page.route('**/levels/malformed.json',route=>route.fulfill({json:{format:'ferrum2d.consumer.scene-authoring',version:1,sceneComposition:{prefabs:[]}}}));
  await page.route('**/levels/missing.json',route=>route.fulfill({status:403,body:'denied'}));
  const before=await evidence(page),first=await scan(page);
  assert.equal(await evidence(page),before,'scanning and exporting must preserve source, history, selection, mode and tabs');
  assert.equal(first.deletionAllowed,false);assert.equal(first.snapshot,'hosted');assert.equal(first.limited,true);assert.equal(first.scanned,3);
  assert(first.issues.some(i=>i.code==='document'&&i.pointer==='/sceneComposition'));assert(first.issues.some(i=>i.code==='limit'));assert(first.issues.some(i=>i.code==='read'));assert(first.issues.some(i=>i.code==='document'));
  const texture=first.assets.find(a=>a.id==='closed-only'&&a.kind==='sprite'),model=first.assets.find(a=>a.id==='closed-only'&&a.kind==='model');
  assert.equal(texture.registered,false);assert.equal(texture.references[0].scene,'levels/closed.json');assert.equal(model.references.length,1);
  assert.equal(texture.references[0].pointer,'/sceneComposition/prefabs/closed~1tree/props/components/visual/asset');
  // An empty selected folder still changes scope; it must invalidate a hosted report.
  emptyFolder=await mkdtemp(join(tmpdir(),'ferrum-usage-empty-'));await writeFile(join(emptyFolder,'note.txt'),'No scenes');
  await showPlacementMenu(page,'file');await page.locator('[data-placement-action=scene-explorer]').click();
  const emptyChooser=page.waitForEvent('filechooser');await page.locator('[data-placement-scene-action=choose]:visible').click();await(await emptyChooser).setFiles(emptyFolder);
  await page.waitForFunction(()=>document.querySelectorAll('.placement-scene-explorer [role=option]').length===0);
  await reveal(page);assert.equal(await panel(page).locator('[data-placement-usage-export]').isDisabled(),true);
  const emptyReport=await scan(page);assert.equal(emptyReport.snapshot,'folder');assert.equal(emptyReport.total,0);
  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.ferrumPlacementViewerRuntimeFrame?.drawCalls>0);await scan(page);
  const search=panel(page).locator('[data-placement-usage-search]');await search.fill('closed/tree');
  const row=panel(page).locator('[data-placement-usage-asset="sprite:closed-only"]');await row.locator('summary').click();assert(await row.locator('code').isVisible());
  assert.match(await row.innerText(),/Scene File.*levels\/closed.json/s);assert.equal(await panel(page).locator('[data-placement-usage-asset="model:closed-only"]').count(),0);
  await search.fill('no-such-asset');assert.equal(await panel(page).locator('[data-placement-usage-asset]').count(),0);await search.fill('');
  // Real property edit provides a draft snapshot; scan is still read-only.
  await showPlacementInspector(page);
  const input=page.locator(mode==='2d'?'input[data-placement-transform-field=x]:visible':'[data-placement-spatial-field=elevation]:visible');
  await input.fill(String(Number(await input.inputValue())+8));await input.press('Tab');await page.locator('.placement-inspector:visible [data-placement-selection-header]').click();
  await page.waitForFunction(()=>!!window.ferrumPlacementViewerExportPatch());
  const draftBefore=await evidence(page),draft=await scan(page);
  assert(draft.assets.some(a=>a.references.some(r=>r.source==='draft')));assert(draft.assets.some(a=>a.references.some(r=>r.source==='saved')));assert.equal(await evidence(page),draftBefore);
  await page.locator('[data-placement-language]').selectOption('ko');assert.equal(await panel(page).locator(':scope > summary').textContent(),'에셋 사용처');
  assert.match(await panel(page).locator('[data-placement-usage-status]').textContent(),/일부만 조회됨/);
  await page.screenshot({path:`${output}/${mode}-ko.png`,fullPage:true});
  await page.setViewportSize({width:780,height:760});await reveal(page);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`${output}/${mode}-compact.png`,fullPage:true});
  await page.setViewportSize({width:1440,height:960});await page.locator('[data-placement-language]').selectOption('en');
  // Both a stalled scene body and a stalled catalog must release their scan on document change.
  for(const suffix of ['/levels/closed.json','/placement-scenes.json']){
   const pattern='**'+suffix,previous=await page.evaluate(()=>window.ferrumPlacementWorkspaceActiveDocument);
   const reading=page.waitForRequest(pattern,{timeout:timeoutMs}),gate=new Promise(resolve=>releaseRead=resolve);let aborted=false;
   await page.unroute(pattern);await page.route(pattern,async route=>{await gate;try{await route.fulfill({json:assetDocument()});}catch(error){if(!aborted)throw error;}});
   await reveal(page);await panel(page).locator('[data-placement-usage-scan]').click();await reading;
   await showPlacementMenu(page,'file');await page.locator('[data-placement-document-file]').setInputFiles({name:'new-scene.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original))});
   await page.waitForFunction(previous=>window.ferrumPlacementWorkspaceActiveDocument.startsWith('file:')&&window.ferrumPlacementWorkspaceActiveDocument!==previous&&!document.querySelector('.demo-shell').inert,previous);
   aborted=await page.evaluate(suffix=>window.__usageAbortedPaths.some(path=>path.endsWith(suffix)),suffix);assert.equal(aborted,true,'context changes must abort the actual fetch signal');
   releaseRead();await reveal(page);assert.equal(await panel(page).locator('[data-placement-usage-export]').isDisabled(),true);
   assert.match(await panel(page).locator('[data-placement-usage-status]').textContent(),/Workspace changed/);assert.equal(await panel(page).locator('[data-placement-usage-scan]').isEnabled(),true,'Open JSON must refresh inspection availability after releasing inert');await page.unroute(pattern);
  }
  // A selected folder reuses File snapshots and never opens any of its scenes for inspection.
  folder=await mkdtemp(join(tmpdir(),'ferrum-usage-'));await mkdir(join(folder,'public'));await writeFile(join(folder,'public/closed.json'),JSON.stringify(assetDocument()));
  await showPlacementMenu(page,'file');await page.locator('[data-placement-action=scene-explorer]').click();
  const chooser=page.waitForEvent('filechooser');await page.locator('[data-placement-scene-action=choose]:visible').click();await(await chooser).setFiles(folder);
  await page.waitForFunction(()=>document.querySelectorAll('.placement-scene-explorer [role=option]').length===1);
  const folderBefore=await evidence(page),folderReport=await scan(page);assert.equal(folderReport.snapshot,'folder');assert.equal(folderReport.scanned,1);assert.equal(await evidence(page),folderBefore);
  const frame=await page.evaluate(()=>({entities:window.ferrumPlacementViewerRuntimeFrame.entityCount,draws:window.ferrumPlacementViewerRuntimeFrame.drawCalls}));
  assert(frame.entities>=3&&frame.draws>0&&frame.draws<=32);assert.deepEqual(errors,[]);
  const native=mode==='2d'?await nativeUsage(parent,original):undefined;
  const result={ok:true,mode,dpr:mode==='spatial'?2:1,closedScene:true,referenceKinds:true,readonly:true,draft:true,partialIssues:true,search:true,bilingual:true,compact:true,staleDiscarded:true,stalledReadsAborted:true,emptyFolderInvalidation:true,folderSnapshot:true,frame,native,pageErrors:errors};
  await writeFile(`${output}/${mode}.json`,JSON.stringify(result,null,2)+'\n');return result;
 }finally{releaseRead?.();await page.close();for(const path of [folder,emptyFolder])if(path)await rm(path,{recursive:true,force:true});}
}

async function nativeUsage(parent,document){
 const page=await parent.context().browser().newPage({viewport:{width:1440,height:960}});
 const project='/tmp/ferrum-usage-native',first=project+'/public/scene-authoring.json',closed=project+'/public/levels/closed.json',room=project+'/public/levels/room.json';
 try{
  await page.addInitScript(({project,first,closed,room,document,closedDocument})=>{
   const folder={assetFolderPath:project+'/public/assets',exists:true,imageCount:0,images:[],models:[],diagnostics:[]};
   window.__usageCommands=[];let lists=0;const scenes=new Map([[first,document],[room,document],[closed,closedDocument]]);
   window.__TAURI__={core:{async invoke(command,args){
    window.__usageCommands.push({command,args});
    if(command==='load_placement_project_folder')return{projectPath:project,sceneDocumentPath:first,handoffPath:project+'/.ferrum-placement-handoff.json',assetFolder:folder,document};
    if(command==='inspect_placement_asset_folder')return folder;
    if(command==='load_placement_tile_assets')return{format:'ferrum2d.tile-import.project',version:1,assets:[]};
    if(command==='load_placement_pixel_assets')return{format:'ferrum2d.pixel.project',version:1,catalogRevision:'',assets:[]};
    if(command==='load_placement_aseprite_assets')return{format:'ferrum2d.aseprite.project',version:1,assets:[]};
    if(command==='load_placement_normal_assets')return{format:'ferrum2d.sprite-normal.project',version:1,registered:true,entries:[],textures:{}};
    if(command==='save_placement_agent_handoff')return{path:project+'/.ferrum-placement-handoff.json',handoff:args.handoff};
    if(command==='list_placement_project_scenes')return{truncated:false,scenes:(++lists===1?[first,room,closed]:[first,closed]).map(path=>({path,relativePath:path.slice(project.length+1),mode:'2d'}))};
    if(command==='load_placement_scene_document'&&args.sceneDocumentPath===room)return{path:room,document:structuredClone(scenes.get(room))};
    if(command==='save_placement_scene_document'){scenes.set(args.sceneDocumentPath,structuredClone(args.document));return{path:args.sceneDocumentPath,document:args.document};}
    if(command==='inspect_placement_project_scene'){const value=structuredClone(scenes.get(args.sceneDocumentPath));return{path:args.sceneDocumentPath,document:value,bytes:new TextEncoder().encode(JSON.stringify(value)).length};}
    throw Error('Unexpected native command: '+command);
   }}};
  },{project,first,closed,room,document,closedDocument:assetDocument()});
  const url=new URL('./',parent.url());url.searchParams.set('projectPath',project);
  await page.goto(url.href,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.ferrumPlacementViewerRuntimeFrame?.entityCount===6);
  await page.locator('[data-placement-language]').selectOption('en');
  await showPlacementMenu(page,'file');await page.locator('[data-placement-action=scene-explorer]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.placement-scene-explorer [role=option]').length===3);
  const before=await evidence(page),start=await page.evaluate(()=>window.__usageCommands.length);
  const result=await scan(page);assert.equal(await evidence(page),before);assert.equal(result.snapshot,'project');assert.equal(result.scanned,2);
  assert(result.assets.some(a=>a.id==='closed-only'&&a.references[0].scene==='public/levels/closed.json'));
  const commands=await page.evaluate(start=>window.__usageCommands.slice(start),start);
  assert.equal(commands.filter(c=>c.command==='inspect_placement_project_scene').length,2);
  assert(commands.filter(c=>c.command==='inspect_placement_project_scene').every(c=>c.args.maxBytes>0&&c.args.maxBytes<=2*1024*1024));
  assert(!commands.some(c=>c.command==='load_placement_scene_document'||c.command==='save_placement_scene_document'));
  // The explorer still owns its older room entry after another read-only catalog scan omits it.
  await showPlacementDock(page,'scene');await page.locator(`[data-placement-project-scene=${JSON.stringify(room)}]`).dblclick();
  await page.waitForFunction(path=>window.ferrumPlacementWorkspaceActiveDocument===path,room);
  assert.equal(await page.evaluate(()=>window.ferrumPlacementViewerSaveEnabled),true,'relisting for inspection must not turn a cached native entry into an export-only document');
  assert.equal(await page.evaluate(()=>window.ferrumPlacementViewerDesktop.sceneDocumentPath),room);
  await showPlacementInspector(page);const x=page.locator('input[data-placement-transform-field=x]:visible');
  await x.fill(String(Number(await x.inputValue())+8));await x.press('Tab');await page.locator('.placement-inspector:visible [data-placement-selection-header]').click();
  assert.equal((await page.evaluate(()=>window.ferrumPlacementViewerSaveDraft())).saved,true);
  await reveal(page);assert.equal(await panel(page).locator('[data-placement-usage-scan]').isEnabled(),true,'Save must refresh read availability after releasing inert');
  const afterSave=await evidence(page);await scan(page);assert.equal(await evidence(page),afterSave);
  return{fakeBridge:true,inspectionCommand:true,noDocumentOpenOrSave:true,readonly:true,cachedEntryKeepsNativeContext:true,scanAfterSave:true};
 }finally{await page.close();}
}
