import { PIXEL_LIMITS, type PixelLayerMerge, type createPixelEditor } from "./placementPixelDocument";
import { setUiText, setUiAttribute, uiMessage } from "./placementLocale";
import { createPixelLayerAppearance } from "./placementPixelLayerAppearance";

/** Image metadata controls. Pixel/structure mutations and history stay in the model. */
export function createPixelLayers(options: {
  editor(): ReturnType<typeof createPixelEditor>;
  busy(): boolean;
  readOnly(): boolean;
  cancelStroke(): void;
  changed(): void;
  report(error: unknown): void;
}) {
  const element = document.createElement("section"); element.className = "placement-pixel-layers";
  setUiAttribute(element,"aria-label","Image Layers");
  const heading = document.createElement("h3"); setUiText(heading,"Image Layers");
  const toolbar = document.createElement("div"); toolbar.className = "placement-pixel-layer-actions";
  const list = document.createElement("div"); list.className = "placement-pixel-layer-list";
  const label = document.createElement("label"); setUiText(label,"Layer Name");
  const name = document.createElement("input"); name.maxLength = 64; name.dataset.pixelLayerName = "true";
  setUiAttribute(name,"aria-label","Image Layer Name"); label.append(name);
  const hint = document.createElement("p"); setUiText(hint,"Top layers draw in front. Paint affects the selected layer.");
  const status = document.createElement("output"); status.dataset.pixelLayerStatus = "true";
  const mergeMenu = document.createElement("details"); mergeMenu.className = "placement-pixel-layer-merge";
  const mergeSummary = document.createElement("summary"); setUiText(mergeSummary, "Merge Layers");
  const mergePanel = document.createElement("div"), mergeHint = document.createElement("p");
  mergeMenu.append(mergeSummary, mergePanel);
  const mergeActions = new Map<PixelLayerMerge, { button: HTMLButtonElement; reason: HTMLOutputElement }>();
  for (const [mode, title] of [["down", "Merge Down"], ["visible", "Merge Visible"]] as const) {
    const button = document.createElement("button"); button.type = "button"; button.dataset.pixelLayerMerge = mode; setUiText(button, title);
    const reason = document.createElement("output"); reason.id = "pixel-layer-merge-" + mode + "-reason"; reason.dataset.pixelLayerMergeReason = mode;
    button.setAttribute("aria-describedby", reason.id);
    button.onclick = () => {
      if (!previousEditor || previousEditor !== options.editor() || options.readOnly() || options.busy() || options.editor().active()) return;
      perform(() => { options.editor().mergeLayers(mode); mergeMenu.open = false; mergeSummary.focus({ preventScroll: true }); }, reason);
    };
    mergeActions.set(mode, { button, reason }); mergePanel.append(button, reason);
  }
  mergePanel.append(mergeHint);
  mergeMenu.addEventListener("keydown", event => {
    if (mergeMenu.open && event.code === "Escape") { event.preventDefault(); event.stopPropagation(); mergeMenu.open = false; mergeSummary.focus({ preventScroll: true }); }
  });
  const opacity = createPixelLayerAppearance({ editor: options.editor, disabled: () => !previousEditor || previousEditor !== options.editor() || options.readOnly() || options.busy() || options.editor().active(), changed: options.changed });
  const properties = document.createElement("div"); properties.className = "placement-pixel-layer-properties";
  properties.append(label,opacity.button);
  element.append(heading,toolbar,mergeMenu,list,properties,status,hint);
  function perform(run: () => void, failure?: HTMLOutputElement) {
    // Detached controls can still receive a queued blur/change/click event.
    const editor = options.editor();
    if (!previousEditor || editor !== previousEditor || editor.active() || options.readOnly() || options.busy()) return;
    options.cancelStroke();
    try { run(); options.changed(); } catch (error) { options.report(error); signature="";sync(); if (failure) setUiText(failure, error instanceof Error ? error.message : String(error)); }
  }
  const buttons = new Map<string,HTMLButtonElement>();
  for (const [action,title,path,run] of [
    ["add","Add Image Layer","M12 5v14M5 12h14",() => {options.editor().addLayer("Layer "+(options.editor().layers().length+1));}],
    ["remove","Remove Image Layer","M5 7h14M10 7V4h4v3M7 7v13h10V7",() => {options.editor().removeLayer(options.editor().selectedLayer());}],
    ["up","Bring Layer Forward","m6 14 6-6 6 6",() => {options.editor().moveLayer(options.editor().selectedLayer(),1);}],
    ["down","Send Layer Backward","m6 10 6 6 6-6",() => {options.editor().moveLayer(options.editor().selectedLayer(),-1);}],
  ] as const) {
    const button = document.createElement("button"); button.type="button"; button.dataset.pixelLayerAction=action;
    // Static stroke icon geometry; user names are always textContent.
    button.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="'+path+'"/></svg>';
    setUiAttribute(button,"title",title);setUiAttribute(button,"aria-label",title);
    button.onclick=()=>perform(run);toolbar.append(button);buttons.set(action,button);
  }
  function rename() { perform(()=>{options.editor().renameLayer(options.editor().selectedLayer(),name.value);}); }
  name.addEventListener("change",rename);
  name.addEventListener("keydown",event=>{
    if(event.isComposing||!previousEditor||previousEditor!==options.editor())return;
    if(event.code==="Enter"){event.preventDefault();rename();}
    if(event.code==="Escape"){event.preventDefault();name.value=options.editor().layers().find(l=>l.id===options.editor().selectedLayer())!.name;}
  });
  type Row = {element:HTMLDivElement;select:HTMLButtonElement;visible:HTMLInputElement;locked:HTMLInputElement};
  const rows = new Map<string,Row>();
  function createRow(id:string):Row {
    const row=document.createElement("div");row.className="placement-pixel-layer-row";
    const select=document.createElement("button");select.type="button";select.dataset.pixelLayerSelect=id;
    select.onclick=()=>{if(rows.get(id)?.element===row)perform(()=>options.editor().selectLayer(id));};row.append(select);
    const controls={visible:document.createElement("input"),locked:document.createElement("input")};
    for(const key of ["visible","locked"] as const) {
      const control=controls[key];control.type="checkbox";
      control.setAttribute("data-pixel-layer-"+key,id);
      control.onchange=()=>{if(rows.get(id)?.element!==row)return;perform(()=>{
        if(key==="visible")options.editor().setLayerVisible(id,control.checked);
        else options.editor().setLayerLocked(id,control.checked);
      });};
      const holder=document.createElement("label"),text=document.createElement("span");setUiText(text,key==="visible"?"Show":"Lock");
      holder.append(control,text);row.append(holder);
    }
    return {element:row,select,...controls};
  }
  let signature="", previousEditor: ReturnType<typeof createPixelEditor> | undefined;
  function sync() {
    const editor=options.editor(),layers=editor.layers(),selected=editor.selectedLayer(),readOnly=options.readOnly(),disabled=readOnly||options.busy()||editor.active();
    const changedEditor=previousEditor!==editor;
    if(changedEditor){opacity.cancel();previousEditor=editor;}
    opacity.sync();
    // Pixel edits can invalidate a previous rounding diagnostic, even without metadata edits.
    const next=JSON.stringify([layers,selected,disabled,readOnly,editor.revision(),editor.frames().length,editor.width,editor.height]);
    if(signature===next&&!changedEditor)return;
    const focused=document.activeElement;
    const focusKey=(["select","visible","locked"] as const).find(key=>focused?.hasAttribute("data-pixel-layer-"+key));
    const focusId=focusKey?focused?.getAttribute("data-pixel-layer-"+focusKey):undefined;
    const restoreFocus=list.contains(focused);
    if(changedEditor){list.replaceChildren();rows.clear();mergeMenu.open=false;}
    signature=next;previousEditor=editor;
    const index=layers.findIndex(l=>l.id===selected),active=layers[index];
    for (const [mode, { button, reason }] of mergeActions) {
      const blocker = readOnly ? "Pixel editing is unavailable in this document" : disabled ? "Finish the current edit before merging layers." : editor.mergeLayerBlocker(mode);
      button.disabled = !!blocker;
      setUiText(reason, blocker ?? (mode === "down" ? uiMessage("Merge {0} into {1}", active.name, layers[index - 1].name) : uiMessage("Merge {0} visible layers", layers.filter(layer => layer.visible).length)));
    }
    setUiText(mergeHint, uiMessage("Applies to all {0} frames. Undo restores the layers.", editor.frames().length));
    buttons.get("add")!.disabled=disabled||layers.length>=PIXEL_LIMITS.layers||editor.width*editor.height*(layers.length+1)*editor.frames().length>PIXEL_LIMITS.pixels;
    buttons.get("remove")!.disabled=disabled||layers.length===1;
    buttons.get("up")!.disabled=disabled||index===layers.length-1;
    buttons.get("down")!.disabled=disabled||index===0;
    name.disabled=disabled;name.value=active.name;
    setUiText(status,!active.visible?"Image layer hidden":active.locked?"Image layer locked":"Ready to paint");
    for(const [id,row] of rows) {
      if(!layers.some(layer=>layer.id===id)){row.element.remove();rows.delete(id);}
    }
    for(const [position,layer] of [...layers].reverse().entries()) {
      const row=rows.get(layer.id)??createRow(layer.id);rows.set(layer.id,row);
      row.element.dataset.selected=String(layer.id===selected);
      row.select.textContent=layer.name;row.select.disabled=disabled;row.select.setAttribute("aria-pressed",String(layer.id===selected));
      setUiAttribute(row.select,"title",uiMessage("Select Image Layer {0}",layer.name));
      for(const [key,title] of [["visible","Show Image Layer {0}"],["locked","Lock Image Layer {0}"]] as const) {
        const control=row[key];control.checked=layer[key];control.disabled=disabled;
        setUiAttribute(control,"aria-label",uiMessage(title,layer.name));setUiAttribute(control,"title",uiMessage(title,layer.name));
      }
      // Keep row nodes stable so a name change on blur cannot swallow the next click.
      if(list.children[position]!==row.element)list.insertBefore(row.element,list.children[position]??null);
    }
    const disabledAction=toolbar.contains(focused)&&focused instanceof HTMLButtonElement&&focused.disabled;
    if((restoreFocus&&focusKey&&focusId)||disabledAction) {
      const target=(focusKey&&focusId?rows.get(focusId)?.[focusKey]:undefined)??rows.get(selected)?.select;
      if(target&&!target.disabled&&document.activeElement!==target)target.focus({preventScroll:true});
    }
  }
  function clear() {
    opacity.cancel();previousEditor=undefined;signature="";rows.clear();list.replaceChildren();mergeMenu.open=false;
  }
  return {element,sync,clear,cancel:opacity.cancel};
}
