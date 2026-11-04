import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {showPlacementBottom,clickPlacementToolAction} from './placement-panel-navigation.mjs';

/** Chromium's independent image codecs verify the actual downloaded GIF/APNG files. */
async function decode(page,bytes,format){
  return page.evaluate(async({bytes,format})=>{
    const type=format==='gif'?'image/gif':'image/png';if(!await ImageDecoder.isTypeSupported(type))throw Error('Independent image decoder unavailable: '+type);
    const decoder=new ImageDecoder({data:new Uint8Array(bytes),type,preferAnimation:true}),frames=[];
    try{await decoder.tracks.ready;await decoder.completed;const track=decoder.tracks.selectedTrack;
      for(let i=0;i<track.frameCount;i++){const {image}=await decoder.decode({frameIndex:i,completeFramesOnly:true});try{const data=new Uint8Array(image.allocationSize({format:'RGBA'}));await image.copyTo(data,{format:'RGBA'});frames.push({durationMs:image.duration/1000,width:image.displayWidth,height:image.displayHeight,pixels:[...data]});}finally{image.close();}}
      return {loop:track.repetitionCount===Infinity,repetitions:track.repetitionCount===Infinity?'infinite':track.repetitionCount,frames};
    }finally{decoder.close();}
  },{bytes:[...bytes],format});
}
export async function smokePixelAnimationExport(page,mode,run){
  await showPlacementBottom(page,'assets');const workspace=page.locator('#placement-pixel-workspace'),action=k=>workspace.locator('[data-pixel-action="'+k+'"]');
  const dialog=page.locator('[data-pixel-animation-export-dialog]'),field=k=>dialog.locator('[data-pixel-animation-export="'+k+'"]');
  const apply=dialog.locator('[data-pixel-animation-export-download]'),cancel=dialog.locator('[data-pixel-animation-export-cancel]');let serial=0;
  async function load(source){const dirty=await workspace.getAttribute("data-pixel-dirty")==="true";if(await workspace.isVisible()){await action('back').click();await workspace.waitFor({state:'hidden'});}await page.locator('[data-pixel-file]').setInputFiles({name:'export.pixel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});if(dirty)await clickPlacementToolAction(page.locator('dialog[open] [data-pixel-action="confirm-discard"]'));await workspace.waitFor({state:'visible'});}
  async function menu(){const exports=workspace.locator('.placement-pixel-export-menu');if(!await exports.evaluate(e=>e.open))await exports.locator('summary').click();return exports;}
  async function source(){const exports=await menu(),pending=page.waitForEvent('download');await clickPlacementToolAction(action('export-source'));const file=await pending,path=join(run,mode+'-animation-source-'+serial+++'.json');await file.saveAs(path);await exports.locator('summary').click();return JSON.parse(await readFile(path,'utf8'));}
  async function open(){await menu();await action('export-animation').click();await dialog.waitFor({state:'visible'});}
  async function download(format){const pending=page.waitForEvent('download');await apply.click();const file=await pending;assert(file.suggestedFilename().endsWith('.'+format));const path=join(run,mode+'-animation-'+serial+++'.'+format);await file.saveAs(path);await dialog.waitFor({state:'detached'});return decode(page,await readFile(path),format);}
  const initial={format:'ferrum2d.pixel-document',version:7,name:'animation-export',width:16,height:16,colorSpace:'srgb',palette:[],layers:[{id:'body',name:'Body',visible:true,locked:false}],
    frames:[93,124,177].map((durationMs,i)=>{const rgba=Buffer.from(Array(256).fill([[0,0,255,255],[255,0,0,255],[0,255,0,255]][i]).flat());rgba.set([255,0,255,128],4);rgba.set(i===1?[0,255,0,255]:[9,8,7,0],12);return {id:'f'+i,durationMs,cels:[{layerId:'body',rgba:rgba.toString('base64')}]};}),
    tags:[{id:'walk',name:'Walk',clipId:0,frameIds:['f2','f0','f1'],direction:'pingpong',loop:true}],initialTag:'walk',nextClipId:1};
  await load(initial);await action('tool-pencil').click();await workspace.locator('[data-pixel-color]').fill('#ffffff');const canvas=workspace.locator('[data-pixel-canvas]');const point=await canvas.evaluate(e=>{const r=e.getBoundingClientRect(),z=Number(e.dataset.pixelZoom);return{x:r.x+Number(e.dataset.pixelOriginX)+z*.5,y:r.y+Number(e.dataset.pixelOriginY)+z*.5};});await page.mouse.click(point.x,point.y);
  const expected=structuredClone(initial),painted=Buffer.from(expected.frames[0].cels[0].rgba,'base64');painted.set([255,255,255,255]);expected.frames[0].cels[0].rgba=painted.toString('base64');assert.equal(await workspace.getAttribute('data-pixel-dirty'),'true');
  const reports=[];
  for(const format of ['apng','gif'])for(const tag of [false,true]){
    await open();await field('format').selectOption(format);assert.equal(await field('reduce').isVisible(),format==='gif');if(tag)await field('range').selectOption('tag:walk');await field('loop').setChecked(tag);
    const decoded=await download(format),order=tag?[2,0,1,0]:[0,1,2];assert.equal(decoded.loop,tag);assert.equal(decoded.frames.length,order.length);
    for(let f=0;f<order.length;f++){
      const frame=decoded.frames[f],source=expected.frames[order[f]],pixels=Buffer.from(source.cels[0].rgba,'base64');assert.deepEqual([frame.width,frame.height],[16,16]);assert.equal(frame.durationMs,format==='gif'?Math.max(20,Math.round(source.durationMs/10)*10):source.durationMs);
      for(let p=0;p<256;p++){const alpha=format==='gif'?(pixels[p*4+3]>=128?255:0):pixels[p*4+3];assert.equal(frame.pixels[p*4+3],alpha);if(alpha)for(let c=0;c<3;c++)assert(Math.abs(frame.pixels[p*4+c]-pixels[p*4+c])<=1,'decoded color differs '+JSON.stringify({format,f,p,c,actual:frame.pixels[p*4+c],expected:pixels[p*4+c]}));}
    }
    assert.equal(await workspace.getAttribute('data-pixel-dirty'),'true','animation exports do not mark the editing source saved');reports.push({format,tag,frames:order.length,loop:decoded.loop});
  }
  assert.deepEqual(await source(),expected);await action('undo').click();assert.deepEqual(await source(),initial);await action('redo').click();assert.deepEqual(await source(),expected);
  await open();await field('format').selectOption('gif');await page.locator('[data-placement-language]').selectOption('ko');await page.setViewportSize({width:390,height:844});assert.equal(await dialog.getAttribute('aria-label'),'애니메이션 내보내기');const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=390);await page.screenshot({path:join(run,mode+'-animation-export-ko.png'),fullPage:true});await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);await page.setViewportSize({width:1280,height:900});await page.locator('[data-placement-language]').selectOption('en');
  // Only the cancellation route is delayed; successful files above use real compression/codecs.
  const downloads=[];const record=file=>downloads.push(file.suggestedFilename());page.on('download',record);
  try{
    await page.evaluate(()=>{window.pixelExportCompression=CompressionStream;window.CompressionStream=class{constructor(format){const gate=new TransformStream({async transform(chunk,controller){await new Promise(resolve=>window.pixelExportRelease=resolve);controller.enqueue(chunk);}});return {writable:gate.writable,readable:gate.readable.pipeThrough(new window.pixelExportCompression(format))};}};});
    await open();await apply.click();await page.waitForFunction(()=>window.pixelExportRelease,undefined,{polling:20});assert(await apply.isDisabled());
    await page.evaluate(()=>{const button=document.querySelector('[data-pixel-animation-export-download]');window.pixelExportLateApply=()=>button.onclick?.(new MouseEvent('click'));});await cancel.click();
    await open();await page.evaluate(()=>{window.pixelExportLateApply();window.CompressionStream=window.pixelExportCompression;window.pixelExportRelease();});assert.equal(await dialog.count(),1);await cancel.click();assert.equal(await workspace.getAttribute('data-pixel-busy'),'false');
    await open();await page.evaluate(()=>{const button=document.querySelector('[data-pixel-animation-export-download]');window.pixelExportLateApply=()=>button.onclick?.(new MouseEvent('click'));document.querySelector('[data-pixel-action=back]').click();});await workspace.waitFor({state:'hidden'});await page.evaluate(()=>window.pixelExportLateApply());assert.equal(await dialog.count(),0);
    await page.locator('[role=tab][aria-controls=placement-pixel-workspace]').click();await workspace.waitFor({state:'visible'});assert.equal(downloads.length,0,'cancelled work never downloads later');
  }finally{page.off('download',record);await page.evaluate(()=>{if(window.pixelExportCompression)window.CompressionStream=window.pixelExportCompression;window.pixelExportRelease?.();});}
  const many={format:initial.format,version:1,name:'many-colors',width:256,height:2,colorSpace:'srgb',palette:[],layer:{id:'layer',name:'Layer'},frame:{id:'f',durationMs:100},rgba:Buffer.from(Array.from({length:512},(_,i)=>[i%256,Math.floor(i/256)*100,2,255]).flat()).toString('base64')};
  await load(many);await open();await field('format').selectOption('gif');await apply.click();await page.waitForFunction(()=>document.querySelector('[data-pixel-animation-export-status]')?.textContent.includes('255 visible colors'),undefined,{polling:20});assert(await apply.isEnabled());await field('reduce').check();const reduced=await download('gif');assert.equal(reduced.frames.length,1);
  for(let i=0;i<512;i++){const expected=[Math.round((i%256)/51)*51,Math.round(Math.floor(i/256)*100/51)*51,0,255];assert.deepEqual(reduced.frames[0].pixels.slice(i*4,i*4+4),expected);}
  assert.deepEqual(await source(),many);
  return {independentDecoder:'Chromium ImageDecoder',reports,allPixelsChecked:true,transparentDisposal:true,tagDirectionAndLoop:true,sourceDirtyAndUndoPreserved:true,cancelAndStaleDownloadGuard:true,gifReductionOptIn:true,koreanNarrow:true};
}
