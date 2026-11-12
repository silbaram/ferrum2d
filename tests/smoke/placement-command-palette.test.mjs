import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const ts=createRequire(new URL('../../apps/studio/package.json',import.meta.url))('typescript');
async function moduleUrl(name,imports={}) {
  let code=ts.transpileModule(await readFile(new URL('../../apps/studio/src/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  for(const [from,to] of Object.entries(imports))code=code.replaceAll(JSON.stringify(from),JSON.stringify(to));
  return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
}
async function checked(url){try{return await import(url);}catch(error){process.exitCode=1;console.error('Command test bootstrap failed:',String(error?.message??error).slice(0,400));throw error;}}
const messages=await moduleUrl('placementLocaleMessages'),locale=await moduleUrl('placementLocale',{'./placementLocaleMessages':messages});
const chrome=await moduleUrl('placementViewportChrome',{'./placementLocale':locale});
const keyHints=await moduleUrl('placementKeyHints',{'./placementLocale':locale});
const {searchPlacementCommands}=await checked(await moduleUrl('placementCommandPalette',{'./placementLocale':locale,'./placementViewportChrome':chrome,'./placementKeyHints':keyHints}));
const preferences=await moduleUrl('placementWorkspacePreferences');
const {placementWorkspaceCommands}=await checked(await moduleUrl('placementWorkspaceCommands',{'./placementWorkspacePreferences':preferences}));
const commands=[
  {id:'pan',label:'Pan',category:'Viewport'},
  {id:'frame',label:'Frame Selected',category:'Viewport'},
  {id:'properties',label:'Properties',category:'Panels',keywords:['rotation','회전','scale']},
  {id:'camera',label:'Game Camera',category:'Workspace'},
];
test('command search finds both locales, categories and explicit aliases',()=>{
  assert.deepEqual(searchPlacementCommands(commands,'PAN').map(c=>c.id),['pan','properties']); // Panels also matches; the tool label ranks first.
  for(const query of ['화면 이동','Ｖｉｅｗｐｏｒｔ pan'])assert.deepEqual(searchPlacementCommands(commands,query).map(c=>c.id),['pan']);
  assert.deepEqual(searchPlacementCommands(commands,'회전').map(c=>c.id),['properties']);
  assert.deepEqual(searchPlacementCommands(commands,'패널 scale').map(c=>c.id),['properties']);
  assert.deepEqual(searchPlacementCommands(commands,'카메라').map(c=>c.id),['camera']);
});
test('command search requires all terms and ranks a label prefix stably',()=>{
  const values=[{id:'alias',label:'Pan',category:'Viewport',keywords:['camera']},...commands];
  assert.deepEqual(searchPlacementCommands(values,'game camera').map(c=>c.id),['camera']);
  assert.deepEqual(searchPlacementCommands(values,'camera').map(c=>c.id),['alias','camera']);
  assert.deepEqual(searchPlacementCommands(commands,'unmatched'),[]);
  assert.deepEqual(searchPlacementCommands(commands,'   '),commands);
});
test('search never queries availability, executes actions or mutates its inputs',()=>{
  const original=structuredClone(commands),values=commands.map(c=>({...c,enabled(){throw Error('not presentation metadata');},run(){throw Error('must not execute');}}));
  searchPlacementCommands(values,'pan');assert.deepEqual(commands,original);
});
function fixture(){
  const nodes=new Map(),events=[];let mode='2d',pixel=false;
  const root={querySelector:selector=>nodes.get(selector)};
  const control=selector=>{const value={isConnected:true,hidden:false,disabled:false,matches:()=>value.disabled,click:()=>events.push(selector)};nodes.set(selector,value);return value;};
  return {nodes,events,control,mode:value=>{mode=value;},pixel:value=>{pixel=value;},commands:()=>placementWorkspaceCommands({root,documentRoot:()=>root,mode:()=>mode,pixelOpen:()=>pixel,reveal:dock=>events.push('reveal:'+dock)})};
}
test('navigation delegates to the current owner and checks disabled state at dispatch',()=>{
  const f=fixture(),flat=f.control('[data-placement-view-action="pan"]'),spatial=f.control('[data-placement-spatial-navigation="pan"]');
  const command=f.commands().find(c=>c.id==='pan');assert(command.enabled());command.run();
  flat.disabled=true;assert(!command.enabled());command.run();assert.equal(f.events.length,1);
  f.mode('spatial');assert(command.enabled());command.run();assert.equal(f.events.at(-1),'[data-placement-spatial-navigation="pan"]');
  spatial.isConnected=false;assert(!command.enabled());
});
test('game and pixel contexts cannot dispatch scene navigation',()=>{
  const f=fixture();f.control('[data-placement-view-action="select"]');f.control('[data-placement-spatial-navigation="select"]');
  const command=f.commands().find(c=>c.id==='select');f.mode('game');assert(!command.enabled());command.run();
  f.mode('2d');f.pixel(true);assert(!command.enabled());command.run();assert.deepEqual(f.events,[]);
});
test('panel actions reveal their dock before delegating to the real tab',()=>{
  const f=fixture(),selector='.placement-runtime-dock [data-placement-panel-tab="assets"]';f.control(selector);
  const command=f.commands().find(c=>c.id==='assets');assert(command.enabled());command.run();assert.deepEqual(f.events,['reveal:runtime',selector]);
  f.nodes.delete(selector);assert(!command.enabled());command.run();assert.equal(f.events.length,2);
});
test('pixel actions require the open pixel workspace and retain their source disabled guard',()=>{
  const f=fixture(),button=f.control('#placement-pixel-workspace [data-pixel-action="undo"]'),command=f.commands().find(c=>c.id==='pixel-undo');
  assert(!command.enabled());command.run();f.pixel(true);assert(command.enabled());button.disabled=true;assert(!command.enabled());command.run();
  assert.deepEqual(f.events,[]);button.disabled=false;command.run();assert.equal(f.events.length,1);
});
test('document panel commands select the active owner, not the first cached document',()=>{
  const calls=[],selector='.placement-inspector [data-placement-panel-tab="properties"]';
  const node=id=>({isConnected:true,hidden:false,matches:()=>false,click:()=>calls.push(id)});
  const old=node('old'),next=node('next');let current=next;
  const commands=placementWorkspaceCommands({root:{querySelector:()=>old},documentRoot:()=>({querySelector:()=>current}),mode:()=> '2d',pixelOpen:()=>false,reveal(){}});
  const command=commands.find(c=>c.id==='properties');command.run();current=old;command.run();
  assert.deepEqual(calls,['next','old']);assert.equal(command.id,'properties');
});
test('layout commands use the existing profile buttons and their disabled guard',()=>{
  const f=fixture(),selector='[data-placement-layout-preset="assets"]',button=f.control(selector);
  const command=f.commands().find(c=>c.id==='layout-assets');assert(command.enabled());command.run();
  button.disabled=true;assert(!command.enabled());command.run();assert.deepEqual(f.events,[selector]);
  assert.equal(searchPlacementCommands(f.commands(),'레이아웃 씬 배치')[0].id,'layout-scene');
});
