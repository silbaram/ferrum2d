import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pixelDocument as d} from './pixel-editing-modules.mjs';

const label=process.argv[2]??'current';
if(!/^[a-z0-9-]+$/.test(label))throw Error('Invalid profile label');
const directory='artifacts/pixel-history';await mkdir(directory,{recursive:true});
const report={ok:false,label,environment:{node:process.version,platform:process.platform,gc:!!globalThis.gc},
  allocationScope:'Uint8Array explicit new allocations and slice copies during synchronous model operations; excludes strings, metadata, other typed arrays and VM allocations. Memory samples are process observations, not total allocation or browser performance.',
  sourceSha256:createHash('sha256').update(await readFile('apps/studio/src/placementPixelDocument.ts')).digest('hex'),cases:[]};
try { report.historySha256=createHash('sha256').update(await readFile('apps/studio/src/placementPixelHistory.ts')).digest('hex'); } catch(error) { if(error.code!=='ENOENT')throw error; }
const save=()=>writeFile(directory+'/'+label+'.json',JSON.stringify(report,null,2)+'\n');await save();
const Native=Uint8Array,slice=Native.prototype.slice;let allocated=0;
function measure(run){
  allocated=0;const start=performance.now();
  globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const value=Reflect.construct(target,args);if(!(args[0] instanceof ArrayBuffer))allocated+=value.byteLength;return value;}});
  Native.prototype.slice=function(...args){const value=slice.apply(this,args);allocated+=value.byteLength;return value;};
  try{const result=run();return{result,ms:performance.now()-start,allocatedRgbaBytes:allocated};}
  finally{globalThis.Uint8Array=Native;Native.prototype.slice=slice;}
}
function source(side,frames,layers){
  const rgba=Buffer.alloc(side*side*4).toString('base64');
  const metadata=Array.from({length:layers},(_,i)=>({id:'layer-'+i,name:'Layer '+i,visible:true,locked:false}));
  return {format:'ferrum2d.pixel-document',version:6,name:'history-profile',width:side,height:side,colorSpace:'srgb',palette:[],layers:metadata,
    frames:Array.from({length:frames},(_,i)=>({id:'frame-'+i,durationMs:100,cels:metadata.map(layer=>({layerId:layer.id,rgba}))}))};
}
try {
for(const [name,side,frames,layers] of [['small',32,1,1],['maximum',64,64,8]]) {
  const original=source(side,frames,layers);
  for(const action of ['pixel','stroke','fill','resize']) {
    globalThis.gc?.();const editor=d.createPixelEditor(original);editor.selectLayer('layer-0');editor.selectFrame('frame-'+(frames-1));
    const samples=[];
    for(let i=0;i<8;i++)samples.push(measure(()=>{
      if(action==='resize'){editor.resizeCanvas(i%2?side:side-1,side,'top-left');return;}
      editor.begin();
      if(action==='fill')editor.fill(0,0,[i+1,17,33,255]);
      else editor.line(0,0,action==='pixel'?0:side-1,action==='pixel'?0:side-1,[i+1,17,33,255]);
      editor.commit();
    }));
    const after=editor.document(),history=editor.history();
    const undone=measure(()=>editor.undo()),redone=measure(()=>editor.redo());assert.deepEqual(editor.document(),after);
    assert(history.bytes<=d.PIXEL_LIMITS.historyBytes&&history.undo<=64);
    report.cases.push({name,action,sourceRgbaBytes:side*side*frames*layers*4,history,
      edit:{allocatedRgbaBytes:samples.reduce((n,s)=>n+s.allocatedRgbaBytes,0),totalMs:samples.reduce((n,s)=>n+s.ms,0),count:samples.length},
      undo:{ms:undone.ms,allocatedRgbaBytes:undone.allocatedRgbaBytes},redo:{ms:redone.ms,allocatedRgbaBytes:redone.allocatedRgbaBytes},memory:process.memoryUsage()});
  }
}
report.ok=true;await save();
console.log(JSON.stringify({ok:true,label,cases:report.cases.map(({memory,...entry})=>entry)},null,2));
} catch(error) {report.error=String(error.stack??error);await save();throw error;}
