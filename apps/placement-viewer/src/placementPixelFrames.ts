import { PIXEL_LIMITS, type createPixelEditor } from "./placementPixelDocument";
import { createPixelTags } from "./placementPixelTags";
import { pixelAnimation, pixelPreviewFrame } from "./placementPixelAnimation";
import { setUiText, setUiAttribute, uiMessage } from "./placementLocale";
import { PIXEL_ONION_DEFAULTS, type PixelOnionSettings } from "./placementPixelOnion";

/** Asset frame controls and preview clock. This never owns game animation state. */
export function createPixelFrames(options:{
  editor():ReturnType<typeof createPixelEditor>;busy():boolean;cancelStroke():void;
  changed():void;viewChanged():void;report(error:unknown):void;
}) {
  const element=document.createElement("section");element.className="placement-pixel-frames";
  setUiAttribute(element,"aria-label","Pixel Frames");
  const controls=document.createElement("div");controls.className="placement-pixel-frame-actions";
  controls.setAttribute("role","toolbar");setUiAttribute(controls,"aria-label","Frame Controls");
  const list=document.createElement("div");list.className="placement-pixel-frame-list";
  const duration=document.createElement("input");duration.type="number";duration.min="1";duration.max="60000";duration.step="1";
  duration.dataset.pixelFrameDuration="true";setUiAttribute(duration,"aria-label","Frame Duration Milliseconds");
  const label=document.createElement("label");setUiText(label,"Duration");label.append(duration,document.createTextNode(" ms"));
  const status=document.createElement("output"),compatibility=document.createElement("output");compatibility.dataset.pixelFrameCompatibility="true";
  compatibility.setAttribute("role","status");
  let onion:PixelOnionSettings={...PIXEL_ONION_DEFAULTS};
  const onionMenu=document.createElement("details");onionMenu.className="placement-pixel-onion-menu";
  const onionSummary=document.createElement("summary");setUiText(onionSummary,"Onion Skin");
  const onionPanel=document.createElement("div");onionPanel.className="placement-pixel-onion-options";
  onionPanel.setAttribute("role","group");setUiAttribute(onionPanel,"aria-label","Onion Skin Settings");
  const onionChecks=new Map<"enabled"|"previous"|"next",HTMLInputElement>();
  for(const [key,title] of [["enabled","Show Onion Skin"],["previous","Previous Frame"],["next","Next Frame"]] as const) {
    const row=document.createElement("label"),input=document.createElement("input"),text=document.createElement("span");
    input.type="checkbox";input.dataset.pixelOnion=key;setUiText(text,title);row.append(input,text);
    row.dataset.onionSide=key;onionPanel.append(row);onionChecks.set(key,input);
    input.onchange=()=>changeOnion(()=>{onion={...onion,[key]:input.checked};});
  }
  const opacityLabel=document.createElement("label"),opacity=document.createElement("input"),opacityValue=document.createElement("output");
  setUiText(opacityLabel,"Opacity");opacity.type="range";opacity.min="0";opacity.max="100";opacity.step="1";
  opacity.dataset.pixelOnionOpacity="true";setUiAttribute(opacity,"aria-label","Onion Opacity Percent");
  opacityLabel.append(opacity,opacityValue);onionPanel.append(opacityLabel);
  const onionHint=document.createElement("p");onionPanel.append(onionHint);
  opacity.oninput=()=>changeOnion(()=>{
    const value=opacity.valueAsNumber;
    if(!Number.isInteger(value)||value<0||value>100)return;
    onion={...onion,opacity:value};
  });
  onionMenu.append(onionSummary,onionPanel);controls.append(label,onionMenu);element.append(controls,list,status,compatibility);
  onionMenu.addEventListener("keydown",event=>{
    if(event.code!=="Escape"||event.isComposing||!onionMenu.open)return;
    event.preventDefault();event.stopPropagation();onionMenu.open=false;onionSummary.focus({preventScroll:true});
  });
  const closeOnionOutside=(event:PointerEvent)=>{if(event.target instanceof Node&&!onionMenu.contains(event.target))onionMenu.open=false;};
  window.addEventListener("pointerdown",closeOnionOutside,true);
  const tagPanel=createPixelTags({editor:options.editor,disabled:()=>options.busy()||playing||options.editor().active(),
    perform,viewChanged:()=>{stop(false);signature="";options.viewChanged();}});
  controls.append(tagPanel.element);
  let playing=false,request=0,start=0,offset=0,preview=0,signature="";
  let previousEditor:ReturnType<typeof createPixelEditor>|undefined;
  const rows=new Map<string,HTMLButtonElement>(),buttons=new Map<string,HTMLButtonElement>();
  function changeOnion(run:()=>void) {
    if(options.busy()||options.editor().active())return;
    run();signature="";sync();options.viewChanged();
  }
  function syncOnion(disabled:boolean,previewing:boolean,count:number) {
    onionMenu.dataset.enabled=String(onion.enabled);
    for(const [key,input] of onionChecks){input.checked=onion[key];input.disabled=disabled||(key!=="enabled"&&!onion.enabled);}
    opacity.disabled=disabled||!onion.enabled;opacity.value=String(onion.opacity);opacityValue.textContent=onion.opacity+"%";
    setUiText(onionHint,previewing?"Onion skin is hidden during playback.":count<2?"Add frames to compare.":"Previous coral · Next cyan. Opaque pixels cover ghosts.");
  }
  function stop(notify=true) {
    if(request)cancelAnimationFrame(request);request=0;
    if(!playing)return;playing=false;signature="";
    if(notify){options.changed();options.viewChanged();}
  }
  function perform(run:()=>void) {
    if(options.busy()||playing)return;options.cancelStroke();
    try{run();options.changed();options.viewChanged();}catch(error){options.report(error);signature="";sync();}
  }
  function tick(now:number) {
    request=0;if(!playing)return;
    if(options.busy()||previousEditor!==options.editor()){stop();return;}
    const frames=tagPanel.previewFrames(),elapsed=now-start+offset,total=frames.reduce((sum,frame)=>sum+frame.durationMs,0);
    const next=pixelPreviewFrame(frames,!tagPanel.previewLoop()?Math.min(elapsed,total-0.001):elapsed);
    if(preview!==next){preview=next;signature="";sync();options.viewChanged();}
    request=requestAnimationFrame(tick);
  }
  function play() {
    if(playing){stop();return;}
    if(options.busy()||tagPanel.previewFrames().length<1)return;
    options.cancelStroke();const frames=tagPanel.previewFrames();
    preview=Math.max(0,frames.findIndex(frame=>frame.id===options.editor().selectedFrame()));
    offset=frames.slice(0,preview).reduce((sum,frame)=>sum+frame.durationMs,0);start=performance.now();
    playing=true;signature="";options.changed();options.viewChanged();request=requestAnimationFrame(tick);
  }
  for(const [action,title,path,run] of [
    ["add","Add Frame","M12 5v14M5 12h14",()=>options.editor().addFrame()],
    ["duplicate","Duplicate Frame","M8 8h12v12H8zM4 16V4h12",()=>options.editor().duplicateFrame()],
    ["remove","Remove Frame","M5 7h14M10 7V4h4v3M7 7v13h10V7",()=>options.editor().removeFrame(options.editor().selectedFrame())],
    ["left","Previous Frame Order","m14 6-6 6 6 6",()=>options.editor().moveFrame(options.editor().selectedFrame(),-1)],
    ["right","Next Frame Order","m10 6 6 6-6 6",()=>options.editor().moveFrame(options.editor().selectedFrame(),1)],
    ["play","Play Frames","m8 5 11 7-11 7z",play],
  ] as const) {
    const button=document.createElement("button");button.type="button";button.dataset.pixelFrameAction=action;
    button.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="'+path+'"/></svg>';
    setUiAttribute(button,"title",title);setUiAttribute(button,"aria-label",title);
    button.onclick=()=>{if(action==="play")play();else perform(run);};buttons.set(action,button);controls.insertBefore(button,label);
  }
  function changeDuration(){perform(()=>options.editor().setFrameDuration(options.editor().selectedFrame(),duration.valueAsNumber));}
  duration.addEventListener("change",changeDuration);
  duration.addEventListener("keydown",event=>{
    if(event.isComposing)return;
    if(event.code==="Enter"){event.preventDefault();changeDuration();}
    if(event.code==="Escape"){event.preventDefault();signature="";sync();}
  });
  function sync() {
    const editor=options.editor(),frames=editor.frames(),selected=editor.selectedFrame();
    if(previousEditor!==editor){stop(false);rows.clear();list.replaceChildren();signature="";previousEditor=editor;onion={...PIXEL_ONION_DEFAULTS};onionMenu.open=false;}
    tagPanel.sync();
    const previewFrames=tagPanel.previewFrames();
    const disabled=options.busy()||playing||editor.active(),index=frames.findIndex(frame=>frame.id===selected);
    const next=JSON.stringify([frames,selected,disabled,playing,preview,editor.layers().length,onion]);
    if(signature===next)return;
    const focused=document.activeElement,focusId=focused?.getAttribute("data-pixel-frame-select"),restoreFocus=list.contains(focused),controlFocus=controls.contains(focused);
    signature=next;element.dataset.pixelPlaying=String(playing);
    syncOnion(options.busy()||editor.active(),playing,frames.length);
    element.dataset.pixelPreviewFrame=playing?previewFrames[preview].id:selected;
    const canGrow=frames.length<PIXEL_LIMITS.frames&&editor.width*editor.height*editor.layers().length*(frames.length+1)<=PIXEL_LIMITS.pixels;
    for(const key of ["add","duplicate"])buttons.get(key)!.disabled=disabled||!canGrow;
    for(const [key,title] of [["add","Add Frame"],["duplicate","Duplicate Frame"]] as const)
      setUiAttribute(buttons.get(key)!,"title",!canGrow?(frames.length>=PIXEL_LIMITS.frames?"Pixel frame limit reached":"Pixel cel budget exceeded"):title);
    const usedByTag=editor.tags().some(tag=>tag.frameIds.includes(selected));
    buttons.get("remove")!.disabled=disabled||frames.length===1||usedByTag;
    setUiAttribute(buttons.get("remove")!,"title",usedByTag?"Remove the frame from its tags before deleting it":"Remove Frame");
    buttons.get("left")!.disabled=disabled||index===0;buttons.get("right")!.disabled=disabled||index===frames.length-1;
    const playButton=buttons.get("play")!;playButton.disabled=options.busy()||editor.active()||previewFrames.length<1;
    setUiAttribute(playButton,"aria-label",playing?"Stop Frames":"Play Frames");setUiAttribute(playButton,"title",playing?"Stop Frames":"Play Frames");
    playButton.setAttribute("aria-pressed",String(playing));
    playButton.querySelector("path")!.setAttribute("d",playing?"M6 6h12v12H6z":"m8 5 11 7-11 7z");
    duration.disabled=disabled;duration.value=String((playing?previewFrames[preview]:frames[index]).durationMs);
    setUiText(status,uiMessage("Frame {0}/{1}",playing?preview+1:index+1,playing?previewFrames.length:frames.length));
    try{pixelAnimation({width:editor.width,height:editor.height,frames,...(editor.tags().length?{tags:editor.tags(),initialTag:editor.initialTag()}:{})});setUiText(compatibility,"Game Timing Ready");compatibility.dataset.error="false";}
    catch(error){setUiText(compatibility,error instanceof Error?error.message:String(error));compatibility.dataset.error="true";}
    for(const [id,row] of rows)if(!frames.some(frame=>frame.id===id)){row.remove();rows.delete(id);}
    for(const [i,frame] of frames.entries()) {
      let button=rows.get(frame.id);
      if(!button){
        button=document.createElement("button");button.type="button";button.dataset.pixelFrameSelect=frame.id;
        button.onclick=()=>perform(()=>options.editor().selectFrame(frame.id));
        button.addEventListener("keydown",event=>{
          if(event.isComposing||!["ArrowLeft","ArrowRight"].includes(event.code)||playing||options.busy())return;
          event.preventDefault();const current=options.editor().frames(),index=current.findIndex(f=>f.id===frame.id),target=current[index+(event.code==="ArrowLeft"?-1:1)];
          if(target){perform(()=>options.editor().selectFrame(target.id));rows.get(target.id)?.focus();}
        });rows.set(frame.id,button);
      }
      button.textContent=String(i+1)+" · "+frame.durationMs+" ms";button.disabled=disabled;
      button.setAttribute("aria-pressed",String(frame.id===(playing?previewFrames[preview].id:selected)));
      setUiAttribute(button,"aria-label",uiMessage("Pixel Frame {0}",i+1));
      if(list.children[i]!==button)list.insertBefore(button,list.children[i]??null);
    }
    // Disabling the clicked boundary action must not send the next Undo to the scene.
    if(restoreFocus||(controlFocus&&focused instanceof HTMLButtonElement&&focused.disabled)){
      const target=(focusId&&rows.get(focusId))||rows.get(selected);
      if(target&&!target.disabled&&document.activeElement!==target)target.focus({preventScroll:true});
    }
  }
  const loseFocus=()=>stop(),visibility=()=>{if(document.hidden)stop();};
  window.addEventListener("blur",loseFocus);document.addEventListener("visibilitychange",visibility);
  function clear(){stop(false);previousEditor=undefined;signature="";rows.clear();list.replaceChildren();element.dataset.pixelPlaying="false";onion={...PIXEL_ONION_DEFAULTS};onionMenu.open=false;tagPanel.clear();syncOnion(false,false,0);}
  return {element,sync,stop,clear,isPlaying:()=>playing,frameId:()=>playing?tagPanel.previewFrames()[preview].id:options.editor().selectedFrame(),
    onion:()=>({...onion}),
    destroy(){clear();window.removeEventListener("pointerdown",closeOnionOutside,true);window.removeEventListener("blur",loseFocus);document.removeEventListener("visibilitychange",visibility);}};
}
