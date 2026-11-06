import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {showPlacementAssetPanel} from './placement-panel-navigation.mjs';

/** Native clipboard keyboard events and browser file-drop routing, using the real importer. */
export async function smokePixelImportTransfer(page,mode,run,{file,source,original}) {
  const workspace=page.locator('#placement-pixel-workspace'),launcher=page.locator('[data-pixel-launcher]');
  const canvas=workspace.locator('[data-pixel-canvas]'),dialog=page.locator('[data-pixel-import-dialog]');
  const action=key=>workspace.locator('[data-pixel-action="'+key+'"]');
  const bytes=[...file.buffer];
  async function ready(){await dialog.waitFor();await page.waitForFunction(()=>document.querySelector('[data-pixel-import-action=apply]')?.disabled===false);}
  async function cancel(){await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);}
  async function drop(target,files=[{name:file.name,type:'image/png',bytes}],kind='drop',text){
    return target.evaluate((element,{files,kind,text})=>{
      const data=new DataTransfer();
      for(const file of files)data.items.add(new File([Uint8Array.from(file.bytes)],file.name,{type:file.type}));
      if(text)data.setData(text.type,text.value);
      const event=new DragEvent(kind,{bubbles:true,cancelable:true,dataTransfer:data});element.dispatchEvent(event);return event.defaultPrevented;
    },{files,kind,text});
  }
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  try {
    await page.evaluate(async bytes=>navigator.clipboard.write([new ClipboardItem({'image/png':new Blob([Uint8Array.from(bytes)],{type:'image/png'})})]),bytes);
    await canvas.focus();await page.keyboard.press('Control+v');await ready();await cancel();
    assert.deepEqual(await source(),original,'external paste waits for explicit Apply');
    // Existing internal pixel copy/paste retains precedence, independent of the OS image.
    await workspace.evaluate(element=>{
      const measure=element.getClientRects;window.pixelDropLayoutReads=0;
      element.getClientRects=function(){window.pixelDropLayoutReads++;return measure.call(this);};
      window.restorePixelDropMeasurement=()=>{element.getClientRects=measure;};
    });
    await canvas.focus();await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');await page.keyboard.press('Control+v');
    await page.waitForFunction(()=>document.querySelector('[data-pixel-canvas]')?.dataset.pixelSelectionPending==='true');
    assert.equal(await page.evaluate(()=>{window.restorePixelDropMeasurement();delete window.restorePixelDropMeasurement;return window.pixelDropLayoutReads;}),0,'ordinary pixel editing must not measure the inactive drop target');
    assert.equal(await dialog.count(),0);assert.equal(await canvas.getAttribute('data-pixel-selection-pending'),'true');
    assert.equal(await drop(workspace),true,'pending selection rejects drop without browser navigation');
    assert.equal(await dialog.count(),0);await page.keyboard.press('Escape');
    await action('import-image').focus();await page.keyboard.press('Control+v');await ready();await cancel();
    // Native text fields keep ordinary text paste; they must never open the image dialog.
    const name=workspace.locator('[data-pixel-layer-name]');
    const oldName=await name.inputValue();
    await page.evaluate(()=>navigator.clipboard.writeText('native text paste'));
    await name.focus();await page.keyboard.press('Control+a');await page.keyboard.press('Control+v');
    assert.equal(await name.inputValue(),'native text paste');assert.equal(await dialog.count(),0);await name.fill(oldName);
    // Text/URL-only paste gets a useful diagnostic, without following the URL.
    await action('import-image').focus();await page.keyboard.press('Control+v');
    assert.equal(await dialog.count(),0);assert.match(await workspace.locator('[data-pixel-status]').textContent(),/image itself/);
    await page.evaluate(async bytes=>navigator.clipboard.write([new ClipboardItem({'image/png':new Blob([Uint8Array.from(bytes)],{type:'image/png'})})]),bytes);
    await action('back').click();await showPlacementAssetPanel(page,'pixel');await launcher.focus();
    await page.keyboard.press('Control+v');await ready();await cancel();
    assert.equal(await drop(launcher,undefined,'dragover'),true);assert.equal(await launcher.getAttribute('data-pixel-image-drop'),'true');
    await page.screenshot({path:resolve(run,mode+'-pixel-image-drop.png'),fullPage:true});
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal(await launcher.getAttribute('data-pixel-image-drop'),null);
    assert.equal(await drop(launcher),true);await ready();await cancel();assert.equal(await launcher.getAttribute('data-pixel-image-drop'),null);
    await page.locator('[role=tab][aria-controls=placement-pixel-workspace]').click();await workspace.waitFor({state:'visible'});
    assert.equal(await drop(workspace,[],'drop',{type:'text/uri-list',value:'https://invalid.example/image.png'}),false,'URL/scene drags remain outside this route');
    for(const files of [[{name:'photo.jpg',type:'image/jpeg',bytes:[1]}],[{name:'a.png',type:'image/png',bytes},{name:'b.png',type:'image/png',bytes}]]) {
      assert.equal(await drop(workspace,files),true);assert.equal(await dialog.count(),0);
    }
    assert.equal(await drop(workspace),true);await ready();
    const oldDialog=await dialog.elementHandle();assert.equal(await drop(dialog,undefined,'dragover'),true);assert.equal(await drop(dialog),true);assert.equal(await drop(workspace),true);assert(await oldDialog.evaluate(e=>e.isConnected),'another drop cannot replace an open modal');await oldDialog.dispose();await cancel();
    assert.deepEqual(await source(),original,'all rejected/cancelled transfers preserve the complete document');
    await page.screenshot({path:resolve(run,mode+'-pixel-image-input-workspace.png'),fullPage:true});
    // Korean diagnostics and drag feedback use the same production UI.
    await page.locator('[data-placement-language]').selectOption('ko');
    await drop(workspace,[{name:'x.txt',type:'text/plain',bytes:[1]}]);assert.match(await workspace.locator('[data-pixel-status]').textContent(),/PNG 이미지만/);
    await page.locator('[data-placement-language]').selectOption('en');
    return {nativeClipboard:true,internalClipboardPriority:true,explicitImagePaste:true,textInputPaste:true,launcherPaste:true,fileDrop:true,invalidDrop:true,modalGuard:true,pendingSelectionGuard:true,dragFeedback:true,koreanDiagnostic:true};
  } finally {
    await page.evaluate(()=>navigator.clipboard.writeText(''));
    await page.context().clearPermissions();
  }
}
