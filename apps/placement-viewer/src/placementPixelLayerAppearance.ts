import { PIXEL_BLEND_MODES, type PixelBlendMode, type createPixelEditor } from "./placementPixelDocument";
import { setUiText, setUiAttribute, registerUiRoot, uiMessage } from "./placementLocale";

// Keep byte endpoints distinct in both the button and input; 1 is not 0%.
const percent = (opacity: number) => Math.round(opacity * 10000 / 255) / 100;

/** A bounded, non-mutating preview; Apply creates one model history entry. */
export function createPixelLayerAppearance(options: {
  editor(): ReturnType<typeof createPixelEditor>;
  disabled(): boolean;
  changed(): void;
}) {
  const modeLabel = (mode: PixelBlendMode) => ({ normal: "Normal Blend", multiply: "Multiply", screen: "Screen" })[mode];
  const button = document.createElement("button"); button.type = "button"; button.dataset.pixelLayerOpacity = "true"; button.dataset.pixelLayerAppearance = "true";
  let popup: HTMLDialogElement | undefined, preview: HTMLCanvasElement | undefined, stamp: (() => boolean) | undefined, serial = 0;
  function cancel() { serial++; popup?.close(); popup?.remove(); popup = undefined; if (preview) preview.width = preview.height = 0; preview = undefined; stamp = undefined; }
  function blocker() {
    if (!button.isConnected || button.closest("[hidden]") || options.disabled()) return "Finish the current edit before changing layer appearance";
    const editor = options.editor();
    if (editor.atlas()) return "Atlas layout is fixed. Edit pixels within a frame.";
    if (editor.layers().find(layer => layer.id === editor.selectedLayer())?.locked) return "Unlock the image layer before changing layer appearance";
    return undefined;
  }
  button.onclick = () => {
    if (button.disabled || blocker()) return;
    cancel();
    const editor = options.editor(), revision = editor.revision(), layer = editor.selectedLayer(), frame = editor.selectedFrame(), token = serial;
    const current = () => token === serial && editor === options.editor() && revision === editor.revision() && layer === editor.selectedLayer() && frame === editor.selectedFrame() && !blocker();
    stamp = current;
    const dialog = document.createElement("dialog"); popup = dialog; dialog.className = "placement-pixel-dialog placement-pixel-opacity-dialog"; dialog.dataset.pixelOpacityDialog = "true";
    setUiAttribute(dialog, "aria-label", "Layer Appearance");
    const title = document.createElement("h3"), hint = document.createElement("p"); setUiText(title, "Layer Appearance");setUiText(hint, "Applies to all frames. Source pixels are preserved.");dialog.append(title,hint);
    const canvas = document.createElement("canvas"); preview = canvas; canvas.dataset.pixelOpacityPreview = "true"; canvas.width = editor.width; canvas.height = editor.height; dialog.append(canvas);
    const row = document.createElement("label"), text = document.createElement("span");setUiText(text,"Opacity (%)");
    const number = document.createElement("input"), slider = document.createElement("input");
    number.type="number";slider.type="range";
    for (const input of [number,slider]) { input.min="0";input.max="100";input.step="any";setUiAttribute(input,"aria-label", input===number?"Opacity (%)":"Adjust Layer Opacity"); }
    number.dataset.pixelOpacityValue="true";slider.dataset.pixelOpacitySlider="true";row.append(text,number);dialog.append(row,slider);
    const error = document.createElement("output");error.setAttribute("role","status");error.dataset.pixelOpacityStatus="true";dialog.append(error);
    const apply = document.createElement("button"), dismiss = document.createElement("button");apply.type=dismiss.type="button";
    apply.dataset.pixelOpacityApply="true";dismiss.dataset.pixelOpacityCancel="true";setUiText(apply,"Apply");setUiText(dismiss,"Cancel");dialog.append(apply,dismiss);
    const active = editor.layers().find(value=>value.id===layer)!;
    let opacity = active.opacity??255;
    const blendRow = document.createElement("label"), blendLabel = document.createElement("span"), blend = document.createElement("select");
    setUiText(blendLabel, "Blend Mode"); setUiAttribute(blend, "aria-label", "Layer Blend Mode"); blend.dataset.pixelLayerBlend = "true";
    for (const mode of PIXEL_BLEND_MODES) { const option = document.createElement("option"); option.value=mode; setUiText(option,modeLabel(mode)); blend.append(option); }
    blend.value=active.blendMode??"normal"; blendRow.append(blendLabel,blend); dialog.insertBefore(blendRow,row);
    const blendHint=document.createElement("p"); blendHint.dataset.pixelBlendHint="true"; dialog.insertBefore(blendHint,row);
    number.value=slider.value=String(percent(opacity));
    function update() {
      if (!current()) return;
      try {
        const percent=number.valueAsNumber;
        if (!Number.isFinite(percent)||percent<0||percent>100) throw Error("Layer opacity must be from 0 to 100 percent");
        opacity=Math.round(percent*255/100);
        const context=canvas.getContext("2d");if(!context)throw Error("Canvas image processing unavailable");
        context.putImageData(new ImageData(new Uint8ClampedArray(editor.previewLayerAppearance(layer,{opacity,blendMode:blend.value as PixelBlendMode},frame)),editor.width,editor.height),0,0);
        setUiText(blendHint, blend.value === "multiply" ? "Multiply darkens overlapping colors for shadows." : blend.value === "screen" ? "Screen lightens overlapping colors for highlights." : "Normal covers lower layers with the source color.");
        setUiText(error,"");apply.disabled=false;
      } catch(value) { setUiText(error,value instanceof Error?value.message:String(value));apply.disabled=true; }
    }
    blend.onchange=update;
    number.oninput=()=>{slider.value=number.value;update();};slider.oninput=()=>{number.value=slider.value;update();};
    apply.onclick=()=>{
      if (!current()||apply.disabled) return;
      try { editor.setLayerAppearance(layer,{opacity,blendMode:blend.value as PixelBlendMode});cancel();options.changed(); }
      catch(value) { if(token===serial)setUiText(error,value instanceof Error?value.message:String(value)); }
    };
    dismiss.onclick=()=>{if(current())cancel();};
    dialog.addEventListener("cancel",event=>{event.preventDefault();if(current())cancel();});
    dialog.addEventListener("keydown",event=>{event.stopPropagation();if(event.isComposing)return;if(event.code==="Enter"&&event.target===number){event.preventDefault();apply.click();}});
    registerUiRoot(dialog);document.body.append(dialog);dialog.showModal();update();number.focus();
  };
  return {button,cancel,sync(){
    if (popup && !stamp?.()) cancel();
    const editor=options.editor(),layer=editor.layers().find(layer=>layer.id===editor.selectedLayer())!;
    setUiText(button,uiMessage("{0} · {1}%",uiMessage(modeLabel(layer.blendMode??"normal")),percent(layer.opacity??255)));
    const reason=blocker();button.disabled=!!reason;setUiAttribute(button,"title",reason??"Adjust Layer Appearance");
  }};
}
