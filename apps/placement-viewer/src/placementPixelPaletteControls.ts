import { setUiAttribute, setUiText, uiMessage, registerUiRoot } from "./placementLocale";
import { pixelColor, pixelHex, type createPixelEditor, type PixelColor, type PixelRegion } from "./placementPixelDocument";
import { exportPixelPalette, readPixelPalette, PIXEL_PALETTE_BYTES } from "./placementPixelPalette";

export function createPixelPaletteControls(options: {
  editor(): ReturnType<typeof createPixelEditor>; color(): PixelColor; pick(hex: string): void;
  selection(): PixelRegion | undefined; retainSelection(rect: PixelRegion): void; key(): string; disabled(): boolean; cancelStroke(): void;
  selectionKey?(): number;
  changed(): void; report(error: unknown): void; download(json: string): void;
}) {
  const element = document.createElement("details"), summary = document.createElement("summary"), panel = document.createElement("div");
  element.className = "placement-pixel-palette-menu"; setUiText(summary, "Edit Palette"); element.append(summary, panel);
  const modeRow=document.createElement("label"),modeLabel=document.createElement("span"),mode=document.createElement("select");
  setUiText(modeLabel,"Color Mode");setUiAttribute(mode,"aria-label","Color Mode");mode.dataset.pixelColorMode="true";
  for(const [value,label] of [["rgba","RGBA Colors"],["indexed","Indexed Palette"]]){const item=document.createElement("option");item.value=value;setUiText(item,label);mode.append(item);}
  modeRow.append(modeLabel,mode);panel.append(modeRow);
  const list = document.createElement("select"); list.size = 5; list.dataset.pixelPaletteList = "true"; setUiAttribute(list, "aria-label", "Palette Color"); panel.append(list);
  const actions = document.createElement("div"); actions.className = "placement-pixel-palette-actions"; panel.append(actions);
  let previous: ReturnType<typeof createPixelEditor> | undefined, signature = "", selected = 0, request = 0, disposed = false;
  let dialog: HTMLDialogElement | undefined, dialogStamp = "";
  const recent: string[] = [], recents = document.createElement("div"); recents.className = "placement-pixel-palette";
  setUiAttribute(recents, "aria-label", "Recent Colors"); recents.dataset.pixelRecentColors = "true";
  const recentLabel = document.createElement("span"); setUiText(recentLabel, "Recent Colors"); panel.append(recentLabel, recents);
  const buttons: HTMLButtonElement[] = [];
  function button(label: string, action: string, parent: HTMLElement, run: () => void) {
    const node = document.createElement("button"); node.type = "button"; setUiText(node, label); node.dataset.pixelPaletteAction = action;
    node.onclick = run; parent.append(node); buttons.push(node); return node;
  }
  function cancel() { request++; dialog?.close(); dialog?.remove(); dialog = undefined; }
  function stamp() { const editor = options.editor(); return JSON.stringify([options.key(), editor.revision(), editor.selectedFrame(), editor.selectedLayer(), editor.selectedAtlasFrame(), options.selectionKey?.() ?? options.selection()]); }
  function edit(run: () => void) {
    if (disposed || options.disabled()) return;
    const clip = options.selection(); options.cancelStroke(); cancel();
    try { run(); if (clip) options.retainSelection(clip); signature = ""; options.changed(); } catch (error) { options.report(error); sync(); }
  }
  const add = button("Add Color", "add", actions, () => edit(() => { const colors = options.editor().palette; colors.push(pixelHex(options.color())); options.editor().setPalette(colors); selected = colors.length - 1; }));
  const update = button("Update Color", "update", actions, () => edit(() => { options.editor().setPaletteEntry(selected,pixelHex(options.color())); }));
  const remove = button("Remove Color", "remove", actions, () => edit(() => { const colors = options.editor().palette; colors.splice(selected, 1); options.editor().setPalette(colors); selected = Math.min(selected, colors.length - 1); }));
  function move(direction: number) { edit(() => { const colors = options.editor().palette, next = selected + direction; [colors[selected], colors[next]] = [colors[next], colors[selected]]; options.editor().setPalette(colors); selected = next; }); }
  const up = button("Move Up", "up", actions, () => move(-1)), down = button("Move Down", "down", actions, () => move(1));
  const scope = document.createElement("select"); scope.dataset.pixelColorScope = "true"; setUiAttribute(scope, "aria-label", "Color Replacement Scope");
  for (const [value, text] of [["cel", "Current Cel"], ["selection", "Selected Pixels"], ["document", "Whole Document"]]) {
    const option = document.createElement("option"); option.value = value; setUiText(option, text); scope.append(option);
  }
  panel.append(scope);
  const hint = document.createElement("p"); setUiText(hint, "Palette edits do not recolor pixels. Replacement uses exact RGBA in visible unlocked layers."); panel.append(hint);
  mode.onchange=()=>{const value=mode.value;if(value==="rgba"||value==="indexed")edit(()=>options.editor().setColorMode(value));};
  const replace = button("Replace Pixels", "replace", panel, () => {
    if (options.disabled()) return;
    options.cancelStroke(); cancel();
    try {
      const editor = options.editor(), value = scope.value;
      if (value !== "cel" && value !== "selection" && value !== "document") return;
      const from = pixelColor(editor.palette[selected]), to = options.color(), clip = options.selection(), count = editor.countColor(from, value, clip);
      const openedEditor = editor; dialogStamp = stamp();
      const popup = document.createElement("dialog"); popup.className = "placement-pixel-dialog"; dialog = popup;
      const title = document.createElement("h3"), description = document.createElement("p"), details = document.createElement("p");
      setUiText(title, "Replace Pixels"); setUiText(description, uiMessage("Replace {0} pixels", count));
      details.textContent = pixelHex(from) + " → " + pixelHex(to); popup.append(title, description, details);
      const confirm = document.createElement("button"); confirm.type = "button"; confirm.dataset.pixelPaletteConfirm = "true"; setUiText(confirm, "Replace"); confirm.disabled = count === 0;
      confirm.onclick = () => {
        if (disposed || options.disabled() || options.editor() !== openedEditor || stamp() !== dialogStamp) { cancel(); return; }
        edit(() => editor.replaceColor(from, to, value, clip));
      };
      const dismiss = document.createElement("button"); dismiss.type = "button"; setUiText(dismiss, "Cancel"); dismiss.onclick = cancel;
      popup.addEventListener("cancel", event => { event.preventDefault(); cancel(); }); popup.append(confirm, dismiss); registerUiRoot(popup); document.body.append(popup); popup.showModal(); dismiss.focus();
    } catch (error) { options.report(error); }
  });
  const formatHint = document.createElement("p"); setUiText(formatHint, "Import JSON, GPL or HEX. Export preserves RGBA as JSON."); panel.append(formatHint);
  const file = document.createElement("input"); file.type = "file"; file.accept = ".json,.gpl,.hex,application/json,application/x-gimp-palette"; file.hidden = true; file.dataset.pixelPaletteFile = "true"; panel.append(file);
  button("Import Palette", "import", panel, () => file.click());
  button("Export Palette", "export", panel, () => options.download(exportPixelPalette(options.editor().palette)));
  file.onchange = () => {
    const chosen = file.files?.[0]; file.value = ""; if (!chosen || options.disabled()) return;
    const token = ++request, editor = options.editor(), captured = stamp();
    void (async () => {
      if (chosen.size > PIXEL_PALETTE_BYTES) throw Error("Palette file exceeds 16 KiB");
      const colors = readPixelPalette(await chosen.text(), chosen.name);
      if (disposed || token !== request || options.disabled() || editor !== options.editor() || stamp() !== captured) return;
      edit(() => editor.setPalette(colors));
    })().catch(error => { if (!disposed && token === request) options.report(error); });
  };
  list.onchange = () => { selected = list.selectedIndex; const color = options.editor().palette[selected]; if (color) options.pick(color); sync(); };
  scope.onchange = () => sync();
  function remember(hex: string) {
    if (recent[0] === hex) return;
    const index = recent.indexOf(hex); if (index >= 0) recent.splice(index, 1); recent.unshift(hex); recent.length = Math.min(12, recent.length);
    recents.replaceChildren();
    for (const value of recent) { const node = document.createElement("button"); node.type = "button"; node.style.background = value; setUiAttribute(node, "aria-label", uiMessage("Color {0}", value)); node.onclick = () => { options.pick(value); remember(value); }; recents.append(node); }
  }
  function sync() {
    const editor = options.editor(), colors = editor.palette, disabled = options.disabled();
    const indexed=editor.colorMode()==="indexed";mode.value=editor.colorMode();mode.disabled=disabled||!!editor.atlas();
    setUiText(hint,indexed?"Indexed: updating a color recolors all frames and layers, including hidden or locked layers. Index 0 stays transparent. New colors are added exactly, up to 256; no automatic quantization.":"RGBA: palette edits do not recolor pixels. Indexed conversion keeps exact colors and requires at most 256 entries including transparency.");
    if (previous !== editor) { previous = editor; selected = 0; scope.value = "cel"; signature = ""; recent.length = 0; recents.replaceChildren(); cancel(); }
    if (dialog && (disabled || stamp() !== dialogStamp)) cancel();
    const next = JSON.stringify([indexed,colors]);
    if (next !== signature) {
      signature = next; list.replaceChildren();
      colors.forEach((color, i) => { const option = document.createElement("option"); option.textContent = (indexed?i:i+1) + " " + color; list.append(option); });
      selected = Math.max(-1, Math.min(selected, colors.length - 1));
    }
    list.selectedIndex = selected; list.disabled = scope.disabled = disabled;
    for (const node of buttons) node.disabled = disabled;
    for (const node of recents.querySelectorAll<HTMLButtonElement>("button")) node.disabled = disabled;
    const valid = selected >= 0 && selected < colors.length;
    add.disabled ||= colors.length >= 256; update.disabled ||= !valid; remove.disabled ||= !valid; up.disabled ||= selected <= 0; down.disabled ||= !valid || selected >= colors.length - 1;
    if(indexed){update.disabled ||= selected===0;remove.disabled ||= selected===0;up.disabled ||= selected<=1;down.disabled ||= selected===0;}
    scope.options[2].disabled = !!editor.atlas();
    replace.disabled ||= !valid || colors[selected]?.toLowerCase() === pixelHex(options.color()) || (scope.value !== "document" && !editor.canPaint()) || (scope.value === "selection" && !options.selection()) || (scope.value === "document" && !!editor.atlas());
  }
  element.addEventListener("keydown", event => { if (event.code === "Escape" && element.open) { event.preventDefault(); event.stopPropagation(); element.open = false; summary.focus(); } });
  function clear() {
    cancel(); previous = undefined; signature = ""; selected = 0; scope.value = "cel";
    recent.length = 0; list.replaceChildren(); recents.replaceChildren(); element.open = false;
  }
  return { element, sync, remember, cancel, clear, select(index: number) { selected = index; sync(); }, destroy() { disposed = true; clear(); } };
}
