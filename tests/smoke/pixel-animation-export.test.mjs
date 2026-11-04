import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inflateSync} from 'node:zlib';
import {animationExport as e} from './pixel-animation-export-modules.mjs';
import {pixelDocument as d} from './pixel-editing-modules.mjs';
function source(){return {format:'ferrum2d.pixel-document',version:7,name:'Export',width:2,height:1,colorSpace:'srgb',palette:[],layers:[{id:'body',name:'Body',visible:true,locked:false}],
  frames:[1,93,177].map((durationMs,i)=>({id:'f'+i,durationMs,cels:[{layerId:'body',rgba:Buffer.from([[255,0,0,255,9,8,7,0],[0,255,0,128,2,3,4,255],[0,0,255,255,5,6,7,127]][i]).toString('base64')}]})),
  tags:[{id:'idle',name:'Idle',clipId:4,frameIds:['f2','f0','f1'],loop:true,direction:'pingpong'}],initialTag:'idle',nextClipId:5};}
function apng(bytes){
  const buffer=Buffer.from(bytes);assert.deepEqual([...buffer.subarray(0,8)],[137,80,78,71,13,10,26,10]);let offset=8,sequence=0,plays,frames=[],header;
  while(offset<buffer.length){const length=buffer.readUInt32BE(offset),name=buffer.toString('ascii',offset+4,offset+8),data=buffer.subarray(offset+8,offset+8+length);
    let crc=0xffffffff;for(const byte of buffer.subarray(offset+4,offset+8+length)){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}assert.equal(buffer.readUInt32BE(offset+8+length),(crc^0xffffffff)>>>0);offset+=length+12;
    if(name==='IHDR')header={width:data.readUInt32BE(0),height:data.readUInt32BE(4)};
    if(name==='acTL')plays=data.readUInt32BE(4);
    if(name==='fcTL'){assert.equal(data.readUInt32BE(0),sequence++);assert.equal(data[24],0);assert.equal(data[25],0);frames.push({durationMs:data.readUInt16BE(20)*1000/data.readUInt16BE(22),width:data.readUInt32BE(4),height:data.readUInt32BE(8)});}
    if(name==='IDAT'||name==='fdAT'){if(name==='fdAT')assert.equal(data.readUInt32BE(0),sequence++);const frame=frames.at(-1),raw=inflateSync(name==='fdAT'?data.subarray(4):data),pixels=[];for(let y=0;y<frame.height;y++){assert.equal(raw[y*(frame.width*4+1)],0);pixels.push(...raw.subarray(y*(frame.width*4+1)+1,(y+1)*(frame.width*4+1)));}frame.pixels=pixels;}
    if(name==='IEND')assert.equal(offset,buffer.length);
  }
  return {plays,frames,...header};
}
function gif(bytes){
  const buffer=Buffer.from(bytes);assert.equal(buffer.toString('ascii',0,6),'GIF89a');let offset=13+3*(2**((buffer[10]&7)+1)),loop=false,control,frames=[];
  const blocks=()=>{const values=[];while(buffer[offset]){const size=buffer[offset++];values.push(...buffer.subarray(offset,offset+size));offset+=size;}offset++;return values;};
  while(buffer[offset]!==0x3b){const type=buffer[offset++];if(type===0x21){const label=buffer[offset++];if(label===0xf9){assert.equal(buffer[offset],4);assert.equal(buffer[offset+1],9);control={delay:buffer.readUInt16LE(offset+2)*10};offset+=6;}else{const values=blocks();assert.equal(Buffer.from(values.slice(0,11)).toString(),'NETSCAPE2.0');loop=true;}}
    else{assert.equal(type,0x2c);const width=buffer.readUInt16LE(offset+4),height=buffer.readUInt16LE(offset+6);assert.equal(buffer[offset+8],0);offset+=9;assert.equal(buffer[offset++],8);const data=blocks();assert(data.length>0);frames.push({...control,width,height});}}
  assert.equal(offset+1,buffer.length);return {loop,frames};
}
test('APNG preserves all RGBA bytes, millisecond times and full-frame replacement with valid CRC/sequence',async()=>{
  const input=source(),before=structuredClone(input),result=apng(await e.exportPixelAnimation(input,{format:'apng',loop:false}));
  assert.equal(result.plays,1);assert.equal(result.width,2);assert.equal(result.height,1);assert.deepEqual(result.frames.map(f=>f.durationMs),[1,93,177]);
  for(let i=0;i<3;i++)assert.deepEqual(result.frames[i].pixels,[...Buffer.from(input.frames[i].cels[0].rgba,'base64')]);assert.deepEqual(input,before);
});
test('all/tag, reverse/pingpong and loop override share runtime frame order',async()=>{
  const input=source();for(const direction of ['forward','reverse','pingpong'])for(const loop of [false,true]){
    input.tags[0].direction=direction;const expected=direction==='reverse'?['f1','f0','f2']:direction==='forward'?['f2','f0','f1']:loop?['f2','f0','f1','f0']:['f2','f0','f1','f0','f2'];
    const plan=e.pixelAnimationExportPlan(input,{format:'apng',tagId:'idle',loop});assert.deepEqual(plan.frames.map(f=>f.id),expected);
    const result=apng(await e.exportPixelAnimation(input,{format:'apng',tagId:'idle',loop}));assert.equal(result.plays,loop?0:1);assert.deepEqual(result.frames.map(f=>f.durationMs),expected.map(id=>input.frames.find(f=>f.id===id).durationMs));
  }
});
test('GIF emits explicit full-frame disposal, loop and rounded minimum20ms timing',async()=>{
  const input=source(),result=gif(await e.exportPixelAnimation(input,{format:'gif',loop:true}));assert.equal(result.loop,true);assert.deepEqual(result.frames.map(f=>f.delay),[20,90,180]);assert(result.frames.every(f=>f.width===2&&f.height===1));
  assert.equal(gif(await e.exportPixelAnimation(input,{format:'gif',loop:false})).loop,false);
});
test('GIF rejects lossy conversion by default and only reduces colors after opt-in',async()=>{
  const bytes=Uint8Array.from(Array.from({length:256},(_,i)=>[i,1,2,255]).flat()),input=d.pixelDocumentFromRgba(256,1,'colors',bytes);
  await assert.rejects(()=>e.exportPixelAnimation(input,{format:'gif'}),/255/);const reduced=gif(await e.exportPixelAnimation(input,{format:'gif',reduceColors:true}));assert.equal(reduced.frames.length,1);assert.equal(reduced.frames[0].width,256);
});
test('cancellation before and during encoding rejects without touching editable source',async()=>{
  for(const format of ['gif','apng']){
    const input=source(),before=structuredClone(input),early=new AbortController();early.abort();await assert.rejects(()=>e.exportPixelAnimation(input,{format},early.signal),{name:'AbortError'});
    const active=new AbortController();await assert.rejects(()=>e.exportPixelAnimation(input,{format},active.signal,()=>active.abort()),{name:'AbortError'});assert.deepEqual(input,before);
  }
});
test('invalid options, source limits and fixed atlases fail before encoding',async()=>{
  const input=source();for(const settings of [{format:'jpeg'},{format:'gif',loop:'false'},{format:'gif',reduceColors:1},{format:'apng',tagId:'missing'}])await assert.rejects(()=>e.exportPixelAnimation(input,settings));
  const fixed={...d.newPixelDocument(2,2),version:4,atlas:{texture:'sheet',frames:[{id:'f',frame:{u0:0,v0:0,u1:1,v1:1}}]}};await assert.rejects(()=>e.exportPixelAnimation(fixed,{format:'apng'}),/Fixed/);
  const bad=source();bad.frames[0].durationMs=60001;await assert.rejects(()=>e.exportPixelAnimation(bad,{format:'gif'}),/duration/);
  assert.throws(()=>e.pixelAnimationExportPlan({...input,width:256,height:256,frames:Array.from({length:65},(_,i)=>({...input.frames[0],id:String(i)}))},{format:'apng'}),/limit/);
});
test('indexed source and blending export the same frames as the flattened source',async()=>{
  const editor=d.createPixelEditor(source());editor.setColorMode('indexed');editor.setLayerOpacity(editor.selectedLayer(),128);
  const output=apng(await e.exportPixelAnimation(editor.document(),{format:'apng'}));for(let i=0;i<3;i++)assert.deepEqual(output.frames[i].pixels,[...d.pixelBytes(editor.document(),i)]);
});
