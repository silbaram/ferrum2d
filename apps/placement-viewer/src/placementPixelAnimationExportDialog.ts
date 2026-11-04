import { type createPixelEditor, type PixelDocument } from "./placementPixelDocument";
import { exportPixelAnimation, pixelAnimationExportPlan, type PixelAnimationExportOptions } from "./placementPixelAnimationExport";
import { registerUiRoot, setUiAttribute, setUiText, uiMessage } from "./placementLocale";

export function createPixelAnimationExportDialog(options:{editor():ReturnType<typeof createPixelEditor>;key():string;download(bytes:ArrayBuffer,format:"gif"|"apng"):void;exported():void;report(error:unknown):void}) {
  const button=document.createElement("button");button.type="button";button.dataset.pixelAction="export-animation";setUiText(button,"Export Animation");
  let popup:HTMLDialogElement|undefined,controller:AbortController|undefined,serial=0,blocked=true,disposed=false,context:(()=>boolean)|undefined;
  function cancel(){serial++;controller?.abort();controller=undefined;popup?.close();popup?.remove();popup=undefined;context=undefined;}
  const visible=()=>button.isConnected&&!button.closest("[hidden]");
  button.onclick=()=>{
    if(disposed||blocked||button.disabled||!visible())return;cancel();
    const editor=options.editor(),stamp=JSON.stringify([options.key(),editor.revision(),editor.selectedFrame(),editor.selectedLayer(),editor.selectedAtlasFrame()]),token=serial;
    let snapshot:PixelDocument;try{snapshot=editor.document();}catch(error){options.report(error);return;}
    const current=()=>!disposed&&!blocked&&token===serial&&visible()&&editor===options.editor()&&stamp===JSON.stringify([options.key(),editor.revision(),editor.selectedFrame(),editor.selectedLayer(),editor.selectedAtlasFrame()]);context=current;
    const dialog=document.createElement("dialog");popup=dialog;dialog.className="placement-pixel-dialog";dialog.dataset.pixelAnimationExportDialog="true";setUiAttribute(dialog,"aria-label","Export Animation");
    const title=document.createElement("h3");setUiText(title,"Export Animation");dialog.append(title);
    function select(label:string,key:string,entries:readonly (readonly [string,string])[]){const row=document.createElement("label"),text=document.createElement("span"),select=document.createElement("select");setUiText(text,label);setUiAttribute(select,"aria-label",label);select.dataset.pixelAnimationExport=key;for(const [value,label]of entries){const option=document.createElement("option");option.value=value;setUiText(option,label);select.append(option);}row.append(text,select);dialog.append(row);return select;}
    const format=select("Animation Format","format",[["apng","APNG"],["gif","GIF"]]),range=select("Frame Range","range",[["all","All Frames"]]);
    const tags="tags" in snapshot?snapshot.tags:undefined;
    for(const tag of tags??[]){const option=document.createElement("option");option.value="tag:"+tag.id;option.textContent=tag.name;range.append(option);}
    function check(label:string,key:string){const row=document.createElement("label"),input=document.createElement("input"),text=document.createElement("span");input.type="checkbox";input.dataset.pixelAnimationExport=key;setUiText(text,label);row.append(input,text);dialog.append(row);return {row,input};}
    const loop=check("Loop Animation","loop"),reduce=check("Reduce GIF Colors","reduce");loop.input.checked=true;
    const hint=document.createElement("p"),status=document.createElement("output");status.setAttribute("role","status");status.dataset.pixelAnimationExportStatus="true";dialog.append(hint,status);
    const apply=document.createElement("button"),dismiss=document.createElement("button");apply.type=dismiss.type="button";apply.dataset.pixelAnimationExportDownload="true";dismiss.dataset.pixelAnimationExportCancel="true";setUiText(apply,"Export");setUiText(dismiss,"Cancel");dialog.append(apply,dismiss);
    let working=false;
    function settings():PixelAnimationExportOptions{return {format:format.value as "gif"|"apng",...(range.value.startsWith("tag:")?{tagId:range.value.slice(4)}:{}),loop:loop.input.checked,reduceColors:reduce.input.checked};}
    function update(){
      if(token!==serial)return;if(!current()){cancel();return;}
      for(const input of [format,range,loop.input,reduce.input])input.disabled=working;apply.disabled=working;reduce.row.hidden=format.value!=="gif";
      setUiText(hint,format.value==="gif"?"GIF uses binary transparency and 10 ms steps (minimum 20 ms). Over 255 colors requires explicit reduction to 216 RGB colors. Use APNG to preserve RGBA and timing.":"APNG preserves RGBA and original frame timing. Export does not save the editable source.");
      if(!working)try{const plan=pixelAnimationExportPlan(snapshot,settings());setUiText(status,uiMessage("{0} frames · {1} × {2} · {3} ms",plan.frames.length,plan.width,plan.height,plan.durationMs));}catch(error){apply.disabled=true;setUiText(status,error instanceof Error?error.message:String(error));}
    }
    format.onchange=loop.input.onchange=reduce.input.onchange=update;
    range.onchange=()=>{loop.input.checked=tags?.find(tag=>"tag:"+tag.id===range.value)?.loop??true;update();};
    apply.onclick=()=>{
      if(!current()||working||apply.disabled)return;const settingsValue=settings();working=true;controller=new AbortController();const signal=controller.signal;update();
      void exportPixelAnimation(snapshot,settingsValue,signal,(frame,total)=>{if(current())setUiText(status,uiMessage("Exporting frame {0}/{1}",frame,total));}).then(bytes=>{
        if(!current()||signal.aborted)return;options.download(bytes,settingsValue.format);cancel();options.exported();
      }).catch(error=>{if(current()&&!signal.aborted){working=false;update();setUiText(status,error instanceof Error?error.message:String(error));}});
    };
    dismiss.onclick=()=>{if(token===serial)cancel();};dialog.addEventListener("cancel",event=>{event.preventDefault();if(token===serial)cancel();});dialog.addEventListener("keydown",event=>event.stopPropagation());
    registerUiRoot(dialog);document.body.append(dialog);dialog.showModal();update();format.focus();
  };
  return {button,cancel,sync(disabled:boolean){blocked=disabled;button.disabled=disabled||!!options.editor().atlas();setUiAttribute(button,"title",options.editor().atlas()?"Fixed atlases export PNG only":"Export GIF or APNG animation");if(popup&&!context?.())cancel();},destroy(){disposed=true;cancel();}};
}
