import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const ts=createRequire(new URL('../../apps/placement-viewer/package.json',import.meta.url))('typescript');
async function moduleUrl(name,imports={}){
 let code=ts.transpileModule(await readFile(new URL('../../apps/placement-viewer/src/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 for(const [from,to] of Object.entries(imports))code=code.replaceAll(JSON.stringify(from),JSON.stringify(to));
 return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
}
const messages=await moduleUrl('placementLocaleMessages'),locale=await moduleUrl('placementLocale',{'./placementLocaleMessages':messages});
const {placementKeyHints,isCommandSearchShortcut,commandSearchShortcut}=await import(await moduleUrl('placementKeyHints',{'./placementLocale':locale}));
const {koreanMessages}=await import(messages);
const keys=context=>placementKeyHints(context).map(([key])=>key);

test('hints list only keys the current viewport handlers act on', () => {
 assert.deepEqual(keys({mode:'2d',selected:0,locked:false,mac:false}),['Ctrl+K','Ctrl+A','Space','Home']);
 assert.deepEqual(keys({mode:'2d',selected:2,locked:false,mac:false}),['Ctrl+K','↑↓←→','Delete','F','Esc']);
 assert.deepEqual(keys({mode:'2d',selected:1,locked:true,mac:false}),['Ctrl+K','F','Esc'],'locked selections cannot move or be removed');
 // HD-2D has no box select or keyboard nudge, but duplicates with Ctrl+D.
 assert.deepEqual(keys({mode:'spatial',selected:0,locked:false,mac:false}),['Ctrl+K','Space','Home']);
 assert.deepEqual(keys({mode:'spatial',selected:1,locked:false,mac:false}),['Ctrl+K','Ctrl+D','Delete','F']);
 assert.deepEqual(keys({mode:'2d',selected:0,locked:false,mac:true}).slice(0,2),['⌘K','⌘A']);
});

test('every hint label has a Korean message', () => {
 for(const mode of ['2d','spatial'])for(const selected of [0,1])for(const locked of [false,true])
  for(const [,label] of placementKeyHints({mode,selected,locked,mac:false}))assert.ok(koreanMessages[label],`missing ko: ${label}`);
});

test('Ctrl+K on Windows/Linux and Cmd+K on Mac; Mac Ctrl+K stays kill-line', () => {
 const key=(init)=>({code:'KeyK',altKey:false,shiftKey:false,ctrlKey:false,metaKey:false,...init});
 assert.equal(isCommandSearchShortcut(key({ctrlKey:true}),false),true);
 assert.equal(isCommandSearchShortcut(key({metaKey:true}),false),false);
 assert.equal(isCommandSearchShortcut(key({metaKey:true}),true),true);
 assert.equal(isCommandSearchShortcut(key({ctrlKey:true}),true),false);
 assert.equal(isCommandSearchShortcut(key({ctrlKey:true,shiftKey:true}),false),false);
 assert.equal(isCommandSearchShortcut({...key({ctrlKey:true}),code:'KeyJ'},false),false);
 assert.equal(commandSearchShortcut(true),'⌘K');
});
