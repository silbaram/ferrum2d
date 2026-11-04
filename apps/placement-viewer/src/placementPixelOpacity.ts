import type { createPixelEditor } from "./placementPixelDocument";
import { setUiText, setUiAttribute, registerUiRoot, uiMessage } from "./placementLocale";

// Keep byte endpoints distinct in both the button and input; 1 is not 0%.
const percent = (opacity: number) => Math.round(opacity * 10000 / 255) / 100;

/** A bounded, non-mutating preview; Apply creates one model history entry. */
export function createPixelOpacity(options: {
  editor(): ReturnType<typeof createPixelEditor>;
  disabled(): boolean;
  changed(): void;
}) {
  const button = document.createElement("button"); button.type = "button"; button.dataset.pixelLayerOpacity = "true";
  let popup: HTMLDialogElement | undefined, preview: HTMLCanvasElement | undefined, stamp: (() => boolean) | undefined, serial = 0;
  function cancel() { serial++; popup?.close(); popup?.remove(); popup = undefined; if (preview) preview.width = preview.height = 0; preview = undefined; stamp = undefined; }
  function blocker() {
    if (!button.isConnected || button.closest("[hidden]") || options.disabled()) return "Finish the current edit before changing opacity";
    const editor = options.editor();
    if (editor.atlas()) return "Atlas layout is fixed. Edit pixels within a frame.";
    if (editor.layers().find(layer => layer.id === editor.selectedLayer())?.locked) return "Unlock the image layer before changing opacity";
    return undefined;
  }
  button.onclick = () => {
    if (button.disabled || blocker()) return;
    cancel();
    const editor = options.editor(), revision = editor.revision(), layer = editor.selectedLayer(), frame = editor.selectedFrame(), token = serial;
    const current = () => token === serial && editor === options.editor() && revision === editor.revision() && layer === editor.selectedLayer() && frame === editor.selectedFrame() && !blocker();
    stamp = current;
    const dialog = document.createElement("dialog"); popup = dialog; dialog.className = "placement-pixel-dialog placement-pixel-opacity-dialog"; dialog.dataset.pixelOpacityDialog = "true";
    setUiAttribute(dialog, "aria-label", "Layer Opacity");
    const title = document.createElement("h3"), hint = document.createElement("p"); setUiText(title, "Layer Opacity");setUiText(hint, "Applies to all frames. Source pixels are preserved.");dialog.append(title,hint);
    const canvas = document.createElement("canvas"); preview = canvas; canvas.dataset.pixelOpacityPreview = "true"; canvas.width = editor.width; canvas.height = editor.height; dialog.append(canvas);
    const row = document.createElement("label"), text = document.createElement("span");setUiText(text,"Opacity (%)");
    const number = document.createElement("input"), slider = document.createElement("input");
    number.type="number";slider.type="range";
    for (const input of [number,slider]) { input.min="0";input.max="100";input.step="any";setUiAttribute(input,"aria-label", input===number?"Opacity (%)":"Adjust Layer Opacity"); }
    number.dataset.pixelOpacityValue="true";slider.dataset.pixelOpacitySlider="true";row.append(text,number);dialog.append(row,slider);
    const error = document.createElement("output");error.setAttribute("role","status");error.dataset.pixelOpacityStatus="true";dialog.append(error);
    const apply = document.createElement("button"), dismiss = document.createElement("button");apply.type=dismiss.type="button";
    apply.dataset.pixelOpacityApply="true";dismiss.dataset.pixelOpacityCancel="true";setUiText(apply,"Apply");setUiText(dismiss,"Cancel");dialog.append(apply,dismiss);
    let opacity = editor.layers().find(value=>value.id===layer)!.opacity??255;
    number.value=slider.value=String(percent(opacity));
    function update() {
      if (!current()) return;
      try {
        const percent=number.valueAsNumber;
        if (!Number.isFinite(percent)||percent<0||percent>100) throw Error("Layer opacity must be from 0 to 100 percent");
        opacity=Math.round(percent*255/100);
        const context=canvas.getContext("2d");if(!context)throw Error("Canvas image processing unavailable");
        context.putImageData(new ImageData(new Uint8ClampedArray(editor.previewLayerOpacity(layer,opacity,frame)),editor.width,editor.height),0,0);
        setUiText(error,"");apply.disabled=false;
      } catch(value) { setUiText(error,value instanceof Error?value.message:String(value));apply.disabled=true; }
    }
    number.oninput=()=>{slider.value=number.value;update();};slider.oninput=()=>{number.value=slider.value;update();};
    apply.onclick=()=>{
      if (!current()||apply.disabled) return;
      try { editor.setLayerOpacity(layer,opacity);cancel();options.changed(); }
      catch(value) { if(token===serial)setUiText(error,value instanceof Error?value.message:String(value)); }
    };
    dismiss.onclick=()=>{if(current())cancel();};
    dialog.addEventListener("cancel",event=>{event.preventDefault();if(current())cancel();});
    dialog.addEventListener("keydown",event=>{event.stopPropagation();if(event.isComposing)return;if(event.code==="Enter"&&event.target===number){event.preventDefault();apply.click();}});
    registerUiRoot(dialog);document.body.append(dialog);dialog.showModal();update();number.focus();
  };
  return {button,cancel,sync(){
    if (popup && !stamp?.()) cancel();
    const editor=options.editor(),value=editor.layers().find(layer=>layer.id===editor.selectedLayer())!.opacity??255;
    setUiText(button,uiMessage("Opacity {0}%",percent(value)));
    const reason=blocker();button.disabled=!!reason;setUiAttribute(button,"title",reason??"Adjust Layer Opacity");
  }};
}
