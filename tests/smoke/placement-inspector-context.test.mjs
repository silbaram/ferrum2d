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
let context,format;
try{({placementInspectorContext:context}=await import(await moduleUrl('placementInspectorContext',{'./placementLocale':locale})));({formatUi:format}=await import(locale));}
catch(error){process.exitCode=1;console.error('Inspector test bootstrap failed:',String(error.message).slice(0,200));throw error;}
test('empty selection has an actionable prompt',()=>{const value=context({mode:'2d',count:0,locked:false});assert.equal(value.state,'empty');assert.match(format(value.message,'en'),/Select an object/);});
test('game context takes priority over selection and lock feedback',()=>{const value=context({mode:'game',count:2,locked:true});assert.equal(value.state,'game');assert.match(format(value.message,'ko'),/정지/);});
test('locked groups cannot be described as editable',()=>{const value=context({mode:'2d',count:3,locked:true});assert.equal(value.state,'locked');assert.match(format(value.message,'en'),/Unlock/);});
test('2D groups describe shared transforms and single-selection components',()=>{const value=context({mode:'2d',count:3,locked:false});assert.equal(value.state,'multiple');assert.match(format(value.message,'en'),/3 objects.*Components need one/);assert.match(format(value.message,'ko'),/객체 3개.*단일 선택/);});
test('spatial surfaces without an instance and spatial groups describe the active target',()=>{for(const input of [{mode:'spatial',count:0,target:'surface',locked:false},{mode:'spatial',count:2,target:'billboard',locked:false}]){const value=context(input);assert.equal(value.state,'spatial');assert.match(format(value.message,'en'),/active target/);}});
test('single selection states units without modifying presentation input',()=>{const input=Object.freeze({mode:'2d',count:1,locked:false}),value=context(input);assert.equal(value.state,'single');assert.match(format(value.message,'en'),/radians/);assert.match(format('Rotation (rad)','ko'),/rad/);assert.match(format('Scale (×)','ko'),/×/);assert.deepEqual(input,{mode:'2d',count:1,locked:false});});
