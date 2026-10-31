import { visitNormalReferences } from "./placementNormalReferences";
import type { FerrumRuntime } from "@ferrum2d/ferrum-web/core";
import type { SceneAuthoringDocumentSpec, ScenePlacementPatch, ScenePlacementViewer } from "@ferrum2d/ferrum-web/authoring";
import { setUiAttribute, setUiText, registerUiRoot, uiMessage, type UiContent } from "./placementLocale";
import { createPixelEditor, newPixelDocument, readPixelDocument, pixelColor, pixelHex,
  pixelDocumentFromRgba, PIXEL_LIMITS, type PixelDocument, type PixelColor } from "./placementPixelDocument";
import { createPixelCanvas, type PixelTool } from "./placementPixelCanvas";
import { createPixelAssets, pixelComponentPatch, pixelAtlasComponentPatch, PixelClipMigrationRequired } from "./placementPixelAssets";
import { pixelPng, readPixelPng } from "./placementPixelPng";
import { placementNormalRead, type PlacementNormalAssetHost, type PlacementNormalAssetBundle } from "./placementNormalAssets";
import { readPixelProject, type PixelProjectHost } from "./placementPixelProject";
import { canUsePlacementAsset } from "./placementAssetScope";
import { createPixelLayers } from "./placementPixelLayers";
import { createPixelNormals, pixelNormalSource, pixelNormalPatch } from "./placementPixelNormals";
import { createPlacementNormalPreview } from "./placementNormalPreview";
import type { SpriteNormalGenerationSettings } from "@ferrum2d/ferrum-web/authoring";
import { createPixelFrames } from "./placementPixelFrames";
import { readPixelAtlas, type PixelAtlasMetadata } from "./placementPixelAtlas";

export const PIXEL_TAB = "ferrum:pixel-document";
type Editor = ReturnType<typeof createPixelEditor>;
function shortPixelName(value: string, max = 64) {
  let result = "";
  for (const character of value) {
    if (result.length + character.length > max) break;
    result += character;
  }
  return result || "sprite";
}
export function createPlacementPixelTool(options: {
  engine: FerrumRuntime["engine"];
  viewer: ScenePlacementViewer;
  stage: HTMLElement;
  context(): { key: string; project?: string; document: SceneAuthoringDocumentSpec; canEdit: boolean; mode: string };
  assets?: ReturnType<typeof createPixelAssets>;
  projectHost?(): PixelProjectHost | undefined;
  normalHost?(): PlacementNormalAssetHost | undefined;
  normalBundles?(): PlacementNormalAssetBundle[];
  normalClaims?(): Pick<PlacementNormalAssetBundle,"binding"|"report">[];
  normalSettings?(): SpriteNormalGenerationSettings;
  saveScene?(): Promise<void>;
  taken(id: string): boolean;
  retains(id: string): boolean;
  apply(patch: ScenePlacementPatch, label: string): void;
  changed(): void;
  tabsChanged(): void;
  beforeOpen(): void;
}) {
  const element = document.createElement("section"), workspace = document.createElement("section");
  element.className = "placement-pixel-launcher"; element.dataset.pixelLauncher = "true";
  workspace.className = "placement-pixel-workspace"; workspace.hidden = true;
  workspace.id = "placement-pixel-workspace"; workspace.setAttribute("role", "tabpanel");
  setUiAttribute(workspace, "aria-label", "Pixel Editor");
  options.stage.append(workspace);
  const heading = document.createElement("h3");
  setUiText(heading, "Pixel Art");
  function button(label: string, action: string, parent: HTMLElement) {
    const node = document.createElement("button");
    node.type = "button"; node.dataset.pixelAction = action;
    setUiText(node, label); parent.append(node); return node;
  }
  const launchActions = document.createElement("div"); launchActions.className = "placement-pixel-actions";
  const create = button("New Pixel", "new", launchActions);
  const open = button("Open Pixel / PNG", "open", launchActions);
  element.append(heading, launchActions);
  const hint = document.createElement("p");
  setUiText(hint, "Draw sprites here, then register or apply them.");
  element.append(hint);
  const file = document.createElement("input"); file.type = "file"; file.hidden = true;
  file.accept = ".json,.png,application/json,image/png"; file.dataset.pixelFile = "true";
  element.append(file);
  const header = document.createElement("div"); header.className = "placement-pixel-header";
  const title = document.createElement("strong"), info = document.createElement("output");
  const atlasSelect = document.createElement("select"); atlasSelect.dataset.pixelAtlasFrame = "true";
  setUiAttribute(atlasSelect, "aria-label", "Atlas frame"); atlasSelect.hidden = true;
  const atlasHint = document.createElement("span"); setUiText(atlasHint, "Fixed Atlas · Other frames and UVs are preserved");
  atlasHint.hidden = true; header.append(title, info, atlasSelect, atlasHint);
  const actions = document.createElement("div"); actions.className = "placement-pixel-actions";
  const undo = button("Undo", "undo", actions), redo = button("Redo", "redo", actions);
  const source = button("Export Source", "export-source", actions);
  const png = button("Export PNG", "export-png", actions);
  const save = button("Save Project", "save-project", actions);
  const register = button("Register Asset", "register", actions);
  const apply = button("Apply To Selection", "apply", actions);
  const bundle = button("Export Assets", "export-assets", actions);
  const clean = button("Clean Unused", "cleanup", actions);
  const back = button("Back To Scene", "back", actions);
  const exports = document.createElement("details"); exports.className = "placement-pixel-export-menu";
  const exportSummary = document.createElement("summary"); setUiText(exportSummary, "Export");
  const exportPanel = document.createElement("div"); exportPanel.append(source, png, bundle);
  exports.append(exportSummary, exportPanel); actions.insertBefore(exports, register);
  const body = document.createElement("div"); body.className = "placement-pixel-body";
  const tools = document.createElement("div"); tools.className = "placement-pixel-tools";
  tools.setAttribute("role", "toolbar"); setUiAttribute(tools, "aria-label", "Pixel tools");
  const toolButtons = new Map<PixelTool, HTMLButtonElement>();
  let tool: PixelTool = "pencil", color: PixelColor = [245, 167, 66, 255];
  for (const [key, label] of [
    ["pencil", "Pencil (B)"], ["eraser", "Eraser (E)"], ["fill", "Fill (G)"],
    ["eyedropper", "Eyedropper (I)"], ["pan", "Pan (H)"],
  ] as const) {
    const node = button(label, "tool-" + key, tools);
    node.addEventListener("click", () => { surface.cancel(); tool = key; render(); surface.element.focus(); });
    toolButtons.set(key, node);
  }
  const colorInput = document.createElement("input"); colorInput.type = "color";
  setUiAttribute(colorInput, "aria-label", "Pixel color"); colorInput.dataset.pixelColor = "true";
  const alpha = document.createElement("input"); alpha.type = "number"; alpha.min = "0"; alpha.max = "255";
  alpha.value = "255"; alpha.dataset.pixelAlpha = "true"; setUiAttribute(alpha, "aria-label", "Pixel alpha");
  const palette = document.createElement("div"); palette.className = "placement-pixel-palette";
  const alphaLabel = document.createElement("label"); setUiText(alphaLabel, "Alpha"); alphaLabel.append(alpha);
  tools.append(colorInput, alphaLabel, palette);
  const normalMenu=document.createElement("details");normalMenu.className="placement-pixel-normal-menu";
  const normalSummary=document.createElement("summary");setUiText(normalSummary,"Normal Map");
  const normalControls=document.createElement("div");normalControls.className="placement-pixel-normal-actions";
  const normalStrength=document.createElement("input");normalStrength.type="number";normalStrength.min="0";normalStrength.max="8";normalStrength.step="0.1";normalStrength.value="1.5";
  normalStrength.dataset.pixelNormalStrength="true";setUiAttribute(normalStrength,"aria-label","Pixel Normal Strength");
  const strengthLabel=document.createElement("label");setUiText(strengthLabel,"Strength");strengthLabel.append(normalStrength);normalControls.append(strengthLabel);
  const generateNormal=button("Generate Normals","normal-generate",normalControls),previewNormal=button("Lighting Preview","normal-preview",normalControls);
  const applyNormal=button("Apply With Normals","normal-apply",normalControls),cancelNormal=button("Cancel","normal-cancel",normalControls);
  const normalStatus=document.createElement("output");normalStatus.dataset.pixelNormalStatus="true";
  normalMenu.append(normalSummary,normalControls,normalStatus);tools.append(normalMenu);
  const area = document.createElement("div"); area.className = "placement-pixel-area";
  const footer = document.createElement("div"); footer.className = "placement-pixel-footer";
  const zoomOut = button("Zoom Out", "zoom-out", footer), zoomIn = button("Zoom In", "zoom-in", footer);
  const fit = button("Fit", "fit", footer);
  const status = document.createElement("output"); status.setAttribute("role", "status"); status.dataset.pixelStatus = "true";
  const launchStatus = document.createElement("output"); launchStatus.setAttribute("role", "status"); element.append(launchStatus);
  footer.append(status);
  workspace.append(header, actions, body, footer); body.append(tools, area);
  let editor: Editor | undefined, owner = "", active = false, disposed = false, busy = false;
  let sourceExported = false;
  let projectSaving = false;
  const dirty = () => !!editor && (!sourceExported || editor.dirty());
  let serial = 0, controller: AbortController | undefined, message: UiContent = "";
  let dismissConfirmation: (() => void) | undefined;
  let createDialog: HTMLDialogElement | undefined;
  const downloads = new Set<string>();
  let normals:ReturnType<typeof createPixelNormals>|undefined;
  const assets = options.assets ?? createPixelAssets({...options,retains:id=>options.retains(id)||(normals?.retainsColor(id)??false)});
  normals=createPixelNormals({engine:options.engine,host:()=>options.normalHost?.(),project:()=>options.context().project,
    settings:()=>({...options.normalSettings?.(),normalStrength:normalStrength.valueAsNumber}),taken:options.taken,restored:()=>options.normalBundles?.()??[]});
  type NormalEntry=Awaited<ReturnType<NonNullable<typeof normals>["prepare"]>>["entry"];
  let generated:{asset:Awaited<ReturnType<typeof assets.prepare>>;entry:NormalEntry;editor:Editor;revision:number;strength:number}|undefined;
  let normalInFlight=false,normalDialog:HTMLDialogElement|undefined,normalPreview:Awaited<ReturnType<typeof createPlacementNormalPreview>>|undefined;
  function closeNormalPreview(){normalPreview?.destroy();normalPreview=undefined;normalDialog?.close();normalDialog?.remove();normalDialog=undefined;}
  function freshNormal(){return !!generated&&generated.editor===editor&&generated.revision===editor?.revision()&&generated.strength===normalStrength.valueAsNumber&&
    assets.entries().includes(generated.asset)&&canUsePlacementAsset(generated.asset,owner,options.context().project)&&normals!.available(generated.entry,owner);}
  function normalBundles(){return [...(normals?.bundles(owner,options.context().document)??[]),...(options.normalBundles?.()??[])].filter(bundle=>bundle.report.format==="ferrum2d.pixel-normal.report");}
  const normalClaims=()=>[...(normals?.claims(owner)??[]),...(options.normalClaims?.()??[])];
  function pairedPatch(approval?:string){
    if(!generated||!freshNormal())throw Error("Pixels changed. Regenerate normals.");
    return pixelNormalPatch(options.context().document,options.viewer.state(),generated.asset,generated.entry,assets.entries(),normalClaims(),editor!.selectedAtlasFrame(),approval);
  }
  let framePanel:ReturnType<typeof createPixelFrames>|undefined;
  const surface = createPixelCanvas({
    editor: () => editor!, tool: () => tool, color: () => color,
    frame:()=>framePanel?.frameId()??editor!.selectedFrame(),readOnly:()=>framePanel?.isPlaying()??false,
    onion:()=>framePanel!.onion(),
    pick(value) { color = value; syncColor(); render(); },
    changed() { if (editor && !disposed) { render(); options.tabsChanged(); } },
  });
  area.append(surface.element);
  const imageLayers = createPixelLayers({
    editor:()=>editor!,busy:()=>busy||(framePanel?.isPlaying()??false),cancelStroke:()=>surface.cancel(),report,
    changed:()=>{render();surface.refresh();options.tabsChanged();},
  });
  body.append(imageLayers.element);
  framePanel=createPixelFrames({editor:()=>editor!,busy:()=>busy,cancelStroke:()=>surface.cancel(),report,
    changed:()=>{render();surface.refresh();options.tabsChanged();},viewChanged:()=>surface.refresh()});
  workspace.insertBefore(framePanel.element,footer);
  function componentPatch(texture:string,migrationApproval?:string) {
    const atlas = editor!.atlas();
    return atlas ? pixelAtlasComponentPatch(options.context().document, options.viewer.state(), texture,
      { atlas }, editor!.selectedAtlasFrame(), assets.entries()) : pixelComponentPatch(options.context().document,
      options.viewer.state(), texture, animationInput(), assets.entries(),migrationApproval);
  }
  const animationInput=()=>({width:editor!.width,height:editor!.height,frames:editor!.frames(),...(editor!.tags().length?{tags:editor!.tags(),initialTag:editor!.initialTag()}:{})});
  function syncColor() { colorInput.value = pixelHex(color).slice(0, 7); alpha.value = String(color[3]); }
  syncColor();
  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob); downloads.add(url);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename;
    anchor.click();
    setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 1000);
  }
  const filename = () => (editor?.name.replace(/[^a-zA-Z0-9_.-]/g, "_") || "sprite").slice(0, 64);
  function invalidate() {
    if (projectSaving) message = "Project save interrupted. Files may be saved; reopen the project before retrying.";
    controller?.abort(); serial++;
    closeNormalPreview();
    dismissConfirmation?.();
    if (createDialog) { createDialog.close(); createDialog.remove(); createDialog = undefined; }
  }
  function exportSource() {
    if (!editor || busy || editor.active()) return;
    download(new Blob([JSON.stringify(editor.document(), null, 2) + "\n"], { type: "application/json" }), filename() + ".pixel.json");
    editor.markExported();
    sourceExported = true;
    message = "Source exported. Project files were not changed.";
    render(); options.tabsChanged();
  }
  async function confirmDiscard(): Promise<boolean> {
    framePanel?.stop(false);
    surface.cancel();
    if (!dirty()) return true;
    const dialog = document.createElement("dialog"); dialog.className = "placement-pixel-dialog";
    const text = document.createElement("p"); setUiText(text, "Export pixel changes before closing?");
    dialog.append(text);
    return new Promise(resolve => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        if (dismissConfirmation === dismiss) dismissConfirmation = undefined;
        dialog.close(); dialog.remove(); resolve(value);
      };
      const dismiss = () => finish(false);
      dismissConfirmation = dismiss;
      button("Export Source", "confirm-export", dialog).onclick = () => { exportSource(); finish(true); };
      button("Discard", "confirm-discard", dialog).onclick = () => finish(true);
      const cancel = button("Cancel", "confirm-cancel", dialog);
      cancel.onclick = () => finish(false);
      dialog.addEventListener("cancel", event => { event.preventDefault(); finish(false); });
      registerUiRoot(dialog); document.body.append(dialog); dialog.showModal(); cancel.focus();
    });
  }
  function suspend() {
    invalidate();
    framePanel?.stop(false);
    surface.cancel(); active = false; workspace.hidden = true;
    delete options.stage.dataset.pixelEditor;
    options.tabsChanged();
  }
  function activate() {
    if (!editor || busy || disposed || options.context().mode === "game") return;
    invalidate();
    owner = options.context().key;
    options.beforeOpen(); active = true; workspace.hidden = false;
    options.stage.dataset.pixelEditor = "true";
    render(); options.tabsChanged();
    requestAnimationFrame(() => { if (active) { surface.fit(); surface.element.focus(); } });
  }
  function replace(value: PixelDocument, exported = false, frameId?: string) {
    const next = createPixelEditor(value);
    if (frameId) {
      if (value.version === 4) next.selectAtlasFrame(frameId);
      else next.selectFrame(frameId);
    }
    invalidate();
    if(generated&&!generated.entry.committed)normals?.discard(generated.entry);generated=undefined;
    editor = next;
    atlasSelect.replaceChildren();
    for (const frame of editor.atlas()?.frames ?? []) {
      const option = document.createElement("option"); option.value = frame.id; option.textContent = frame.id; atlasSelect.append(option);
    }
    owner = options.context().key;
    sourceExported = exported;
    palette.replaceChildren();
    for (const hex of editor.palette) {
      const swatch = document.createElement("button"); swatch.type = "button";
      swatch.style.background = hex; setUiAttribute(swatch, "aria-label", uiMessage("Color {0}", hex));
      swatch.dataset.pixelSwatch = hex; swatch.addEventListener("click", () => {
        color = pixelColor(hex); syncColor(); surface.element.focus();
      });
      palette.append(swatch);
    }
    message = "Pencil B · Eraser E · Fill G · Pick I · Space + drag to pan";
    activate();
  }
  function report(error: unknown) {
    message = error instanceof Error ? error.message : String(error); render();
  }
  function render() {
    if (disposed) return;
    create.disabled = open.disabled = busy || !options.context().canEdit;
    setUiText(launchStatus, message);
    if (!editor || !active) return;
    title.textContent = editor.name + (dirty() ? " •" : "");
    const region = editor.region(), atlas = editor.atlas();
    info.textContent = region.width + " × " + region.height + (atlas ? " / Atlas " + editor.width + " × " + editor.height : "");
    atlasSelect.hidden = atlasHint.hidden = !atlas;
    atlasSelect.value = editor.selectedAtlasFrame(); atlasSelect.disabled = busy;
    imageLayers.element.hidden = !!atlas; framePanel!.element.hidden = !!atlas;
    workspace.dataset.pixelAtlas = String(!!atlas);
    workspace.dataset.pixelDirty = String(dirty());
    workspace.dataset.pixelBusy = String(busy);
    const history = editor.history(),editing=busy||(framePanel?.isPlaying()??false);
    for (const [key, node] of toolButtons) {
      node.setAttribute("aria-pressed", String(key === tool)); node.disabled = editing;
    }
    colorInput.disabled = alpha.disabled = editing;
    for(const swatch of palette.querySelectorAll<HTMLButtonElement>("button"))swatch.disabled=editing;
    surface.element.inert = busy;
    imageLayers.sync();
    framePanel?.sync();
    for (const node of [source, png, save, register, apply, bundle, clean, undo, redo]) node.disabled = editing || editor.active();
    save.disabled ||= !options.projectHost?.() || !options.context().canEdit || owner !== options.context().key;
    setUiAttribute(save, "title", options.projectHost?.() ? "Save pixel sources and scene" : "Open a desktop project folder to save");
    undo.disabled ||= history.undo === 0; redo.disabled ||= history.redo === 0;
    apply.disabled ||= !options.context().canEdit || owner !== options.context().key;
    register.disabled ||= !options.context().canEdit || owner !== options.context().key;
    bundle.disabled ||= assets.providerAssets(owner, options.context().project).length === 0;
    clean.disabled ||= assets.providerAssets(owner, options.context().project).length === 0;
    if (!apply.disabled) {
      try { componentPatch("pixel.pending"); }
      catch (error) { apply.disabled = !(error instanceof PixelClipMigrationRequired); setUiAttribute(apply, "title", error instanceof Error ? error.message : String(error)); }
    }
    back.disabled = false;
    if (!apply.disabled) setUiAttribute(apply, "title", editor.frames().length>1?"Replace the selected sprite animation":"Replace the selected sprite image");
    normalStrength.disabled=editing||editor.active();
    generateNormal.disabled=editing||editor.active();
    previewNormal.disabled=editing||editor.active()||!freshNormal();
    cancelNormal.hidden=!normalInFlight;cancelNormal.disabled=!normalInFlight;
    applyNormal.disabled=editing||editor.active()||!freshNormal()||!options.context().canEdit||owner!==options.context().key;
    if(!applyNormal.disabled){try{pairedPatch();}catch(error){applyNormal.disabled=!(error instanceof PixelClipMigrationRequired);setUiAttribute(applyNormal,"title",error instanceof Error?error.message:String(error));}}
    setUiText(normalStatus,generated?(freshNormal()?"Normals Ready":"Pixels changed. Regenerate normals."):"Generate normals from the current frames.");
    normalStatus.dataset.stale=String(!!generated&&!freshNormal());
    if(generated&&!freshNormal())closeNormalPreview();
    setUiText(status, message);
  }
  async function task(run: (signal: AbortSignal, token: number) => Promise<void>) {
    if (busy || disposed || !editor) return;
    framePanel?.stop(false);surface.cancel();
    controller?.abort(); controller = new AbortController();
    const token = ++serial; busy = true; render();
    options.tabsChanged();
    try { await run(controller.signal, token); }
    catch (error) { if (token === serial && !disposed) report(error); }
    finally { if (!disposed) { busy = false; render(); options.tabsChanged(); } }
  }
  function current(signal: AbortSignal, token: number) {
    signal.throwIfAborted();
    if (disposed || token !== serial || !active || owner !== options.context().key)
      throw Error("Pixel editing context changed");
  }
  async function confirmClipMigration(migration:PixelClipMigrationRequired):Promise<boolean> {
    const dialog=document.createElement("dialog");dialog.className="placement-pixel-dialog";
    const title=document.createElement("strong"),description=document.createElement("p"),details=document.createElement("p");
    setUiText(title,"Review Clip Changes");setUiText(description,"Keep clip IDs and replace their frames? Scene Undo restores the previous animation.");
    setUiText(details,uiMessage("Clips {0} → {1} · Initial {2} → {3}",migration.beforeIds.join(", "),migration.afterIds.join(", "),migration.beforeInitial,migration.afterInitial));
    dialog.append(title,description,details);
    return new Promise(resolve=>{
      let settled=false;
      const finish=(value:boolean)=>{if(settled)return;settled=true;if(dismissConfirmation===dismiss)dismissConfirmation=undefined;dialog.close();dialog.remove();resolve(value);};
      const dismiss=()=>finish(false);dismissConfirmation=dismiss;
      button("Migrate Clips","confirm-migrate",dialog).onclick=()=>finish(true);
      const cancel=button("Cancel","confirm-cancel",dialog);cancel.onclick=()=>finish(false);
      dialog.addEventListener("cancel",event=>{event.preventDefault();finish(false);});
      registerUiRoot(dialog);document.body.append(dialog);dialog.showModal();cancel.focus();
    });
  }
  async function publish(applyToSelection: boolean) {
    const context = options.context(), selection = options.viewer.state().selectedInstanceId;
    if (!context.canEdit || owner !== context.key) return;
    const signature = JSON.stringify(context.document),previousEditor=editor,metadata=JSON.stringify(animationInput()),baseline=serial;
    let migrationApproval:string|undefined;
    if (applyToSelection) {
      try { componentPatch("pixel.pending"); }
      catch (error) {
        if(!(error instanceof PixelClipMigrationRequired)){report(error);return;}
        if(!await confirmClipMigration(error))return;
        if(disposed||baseline!==serial||editor!==previousEditor||owner!==options.context().key||
          JSON.stringify(options.context().document)!==signature||JSON.stringify(animationInput())!==metadata||options.viewer.state().selectedInstanceId!==selection)return;
        migrationApproval=error.approval;
      }
    }
    void task(async (signal, token) => {
      let asset: Awaited<ReturnType<typeof assets.prepare>> | undefined;
      try {
        asset = await assets.prepare(owner, editor!.document(), signal);
        current(signal, token);
        const now = options.context();
        if (!now.canEdit || JSON.stringify(now.document) !== signature ||
          (applyToSelection && options.viewer.state().selectedInstanceId !== selection))
          throw Error("Scene or selection changed. Apply again.");
        // Providers must know the uploaded name before the runtime consumes the patch.
        options.changed();
        if (applyToSelection)
          options.apply(componentPatch(asset.id,migrationApproval), "Apply Pixel Sprite");
        assets.commit(asset);
        message = applyToSelection ? (editor!.frames().length>1?"Pixel animation applied. Scene Undo restores the previous clip.":"Pixel sprite applied. Scene Undo restores the previous image.") : "Pixel asset registered. Choose it in Assets to place it.";
        options.changed();
      } catch (error) {
        try { if (asset) assets.discardUncommitted(asset); }
        catch (cleanup) { throw new AggregateError([error, cleanup], "Pixel asset rollback failed"); }
        finally { if (!disposed) options.changed(); }
        throw error;
      }
    });
  }
  create.addEventListener("click", () => {
    if (create.disabled || disposed) return;
    invalidate();
    const key = options.context().key, token = serial, previous = editor;
    const dialog = document.createElement("dialog"); dialog.className = "placement-pixel-dialog";
    createDialog = dialog;
    const form = document.createElement("form"); form.method = "dialog";
    const name = document.createElement("input"); name.value = "sprite"; name.maxLength = 64;
    const width = document.createElement("input"), height = document.createElement("input");
    for (const input of [width, height]) { input.type = "number"; input.min = "1"; input.max = "256"; input.value = "32"; input.required = true; }
    for (const [label, input] of [["Name", name], ["Width", width], ["Height", height]] as const) {
      const row = document.createElement("label"); setUiText(row, label); row.append(input);
      setUiAttribute(input, "aria-label", uiMessage("Pixel {0}", uiMessage(label))); form.append(row);
    }
    const createError = document.createElement("output"); createError.setAttribute("role", "status"); form.append(createError);
    const submit = button("Create", "create", form); submit.type = "submit";
    const removeDialog = () => {
      dialog.close(); dialog.remove();
      if (createDialog === dialog) createDialog = undefined;
    };
    const cancel = button("Cancel", "cancel-new", form); cancel.onclick = removeDialog;
    form.addEventListener("submit", event => {
      event.preventDefault();
      try {
        const value = newPixelDocument(Number(width.value), Number(height.value), name.value);
        removeDialog();
        if (token !== serial || key !== options.context().key || disposed) return;
        void confirmDiscard().then(ok => {
          if (ok && !disposed && token === serial && editor === previous &&
            key === options.context().key && options.context().canEdit) replace(value);
        });
      } catch (error) { setUiText(createError, error instanceof Error ? error.message : String(error)); }
    });
    dialog.addEventListener("cancel", removeDialog);
    dialog.append(form); registerUiRoot(dialog); document.body.append(dialog); dialog.showModal(); name.focus();
  });
  open.addEventListener("click", () => { if (!open.disabled) file.click(); });
  function openFile(chosen: File) {
    if (busy || disposed || !options.context().canEdit) return;
    invalidate();
    const key = options.context().key, token = serial, previous = editor;
    void (async () => {
      let value: PixelDocument;
      if (/\.png$/i.test(chosen.name)) {
        if (chosen.size > 4 * 1024 * 1024) throw Error("PNG exceeds the pixel editor limit");
        const header = new Uint8Array(await chosen.slice(0, 24).arrayBuffer());
        if (header.length !== 24 || [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82].some((n, i) => n !== header[i]))
          throw Error("Choose a valid PNG");
        const view = new DataView(header.buffer), width = view.getUint32(16), height = view.getUint32(20);
        newPixelDocument(width, height);
        const bitmap = await createImageBitmap(chosen), canvas = document.createElement("canvas");
        try {
          if (bitmap.width !== width || bitmap.height !== height) throw Error("PNG dimensions differ");
          canvas.width = width; canvas.height = height;
          const context = canvas.getContext("2d"); if (!context) throw Error("Canvas image processing unavailable");
          context.drawImage(bitmap, 0, 0);
          const pixels = context.getImageData(0, 0, width, height).data;
          value = pixelDocumentFromRgba(width, height, shortPixelName(chosen.name.replace(/\.png$/i, "")), new Uint8Array(pixels));
        } finally { bitmap.close(); canvas.width = canvas.height = 0; }
      } else {
        if (chosen.size > PIXEL_LIMITS.sourceBytes) throw Error("Pixel document exceeds the byte limit");
        value = readPixelDocument(await chosen.text());
      }
      if (token !== serial || disposed || key !== options.context().key || !options.context().canEdit) return;
      if (await confirmDiscard()) {
        if (token === serial && !disposed && editor === previous &&
          key === options.context().key && options.context().canEdit)
          replace(value, !/\.png$/i.test(chosen.name));
      }
    })().catch(error => { if (token === serial) report(error); });
  }
  file.addEventListener("change", () => {
    const chosen = file.files?.[0]; file.value = "";
    if (chosen) openFile(chosen);
  });
  atlasSelect.onchange = () => {
    if (!editor || busy) return;
    const id = atlasSelect.value;
    surface.cancel(); editor.selectAtlasFrame(id); render(); surface.fit();
  };
  source.onclick = exportSource;
  png.onclick = () => void task(async (signal, token) => {
    const bytes = await pixelPng(editor!.document()); current(signal, token);
    download(new Blob([bytes], { type: "image/png" }), filename() + ".png");
    message = "PNG exported. Export Source to keep editing data.";
  });
  register.onclick = () => publish(false); apply.onclick = () => publish(true);
  save.onclick = () => {
    const host = options.projectHost?.();
    if (save.disabled || !host || !editor) return;
    const context = options.context(), signature = JSON.stringify(context.document), previous = editor;
    void task(async (signal,token) => {
      projectSaving = true;
      try {
      // Saving the current source registers it; applying its image remains explicit.
      const asset = await assets.prepare(owner, previous.document(), signal);
      try { current(signal,token); assets.commit(asset); }
      catch (error) { assets.discardUncommitted(asset); throw error; }
      if (host !== options.projectHost?.()) throw Error("Pixel editing context changed");
      options.changed();
      const candidates = assets.entries().filter(a => a.committed && canUsePlacementAsset(a,context.key,context.project));
      message = "Saving project assets…"; render();
      const catalog = await host.save(candidates,signal);
      const verified = await readPixelProject(catalog,context.key,host.project,signal);
      current(signal,token);
      if (host !== options.projectHost?.()) throw Error("Pixel editing context changed");
      for (const candidate of candidates)
        if (!verified.some(a => a.id === candidate.id && a.sha256 === candidate.sha256 && JSON.stringify(a.source) === JSON.stringify(candidate.source)))
          throw Error("Project host did not register all pixel sources");
      for (const candidate of candidates) { candidate.persisted = true; candidate.project = host.project; }
      previous.markExported(); sourceExported = true; options.changed(); options.tabsChanged();
      if (signature !== JSON.stringify(options.context().document)) throw Error("Assets saved. Scene changed; save the project again.");
      await normals!.save(options.context().document,owner,signal,freshNormal()?generated?.entry:undefined);current(signal,token);
      message = "Assets saved · Saving scene…"; render();
      await options.saveScene?.(); current(signal,token);
      message = "Project saved · Pixel sources preserved";
      } finally { projectSaving = false; }
    });
  };
  bundle.onclick = () => {
    if (busy) return;
    try {
      download(new Blob([JSON.stringify(pixelBundle(), null, 2) + "\n"], { type: "application/json" }), filename() + ".pixel-assets.json");
      message = "Assets exported. Install the PNGs and manifest before saving the scene."; render();
    } catch (error) { report(error); }
  };
  function pixelBundle(){
    const bundle=assets.bundle(owner,options.context().document,options.context().project);
    const pairs=normalBundles();
    if(generated&&freshNormal()&&!pairs.some(pair=>pair.binding.textures.normal.asset===generated!.entry.binding.textures.normal.asset))pairs.push(normals!.bundle(generated.entry));
    const aliases=new Map<number,string>();
    for(const pair of pairs){const name=pair.binding.textures.normal.asset;try{aliases.set(options.engine.textureId(name),name);}catch{/* Not uploaded. */}}
    visitNormalReferences(bundle.sceneDocument,(owner,key)=>{if(typeof owner[key]!=="number"||!aliases.has(owner[key] as number))return;const name=aliases.get(owner[key] as number)!;if(key==="normalTextureId"){if(owner.normalTexture!==undefined&&owner.normalTexture!==name)throw Error("Conflicting normal texture references");owner.normalTexture=name;delete owner[key];}else owner[key]=name;});
    const textureOptions:Record<string,{colorSpace:"srgb"|"none"}>=Object.fromEntries(Object.keys(bundle.manifest.textures).map(id=>[id,{colorSpace:"srgb" as const}]));
    const extra:{id:string;sha256:string;path:string;pngBase64:string}[]=[];
    for(const pair of pairs)for(const file of pair.files){
      const texture=Object.values(pair.binding.textures).find(texture=>texture.path===file.path)!;
      if(bundle.assets.some(asset=>asset.id===texture.asset)||extra.some(asset=>asset.id===texture.asset))continue;
      extra.push({id:texture.asset,sha256:file.sha256,path:file.path,pngBase64:file.base64});
      bundle.manifest.textures[texture.asset]=file.path;textureOptions[texture.asset]={colorSpace:texture.colorSpace};
    }
    return {...bundle,manifest:{...bundle.manifest,textureOptions},assets:[...bundle.assets,...extra],normalBindings:pairs.map(pair=>({binding:pair.binding,report:pair.report}))};
  }
  generateNormal.onclick=()=>{
    if(!editor||generateNormal.disabled)return;
    const previous=editor;
    void task(async(signal,token)=>{
      normalInFlight=true;render();
      let asset:Awaited<ReturnType<typeof assets.prepare>>|undefined,prepared:Awaited<ReturnType<NonNullable<typeof normals>["prepare"]>>|undefined,accepted=false;
      try{
        const revision=previous.revision(),strength=normalStrength.valueAsNumber;
        asset=await assets.prepare(owner,previous.document(),signal);current(signal,token);
        prepared=await normals!.prepare(await pixelNormalSource(asset),signal,progress=>{if(token===serial&&!disposed){message=progress;render();}});
        current(signal,token);
        if(previous!==editor||previous.revision()!==revision||strength!==normalStrength.valueAsNumber)throw Error("Pixels changed. Regenerate normals.");
        const old=generated;generated={asset,entry:prepared.entry,editor:previous,revision,strength};assets.commit(asset);accepted=true;
        if(old&&old.entry!==prepared.entry&&!old.entry.committed)normals!.discard(old.entry);
        message="Normals generated. Preview or apply explicitly.";options.changed();
      }finally{
        if(!accepted){if(prepared?.created&&!prepared.entry.committed)normals!.discard(prepared.entry);if(asset)assets.discardUncommitted(asset);}
        normalInFlight=false;
      }
    });
  };
  cancelNormal.onclick=()=>{if(normalInFlight){invalidate();message="Normal generation cancelled. Previous assets preserved.";render();}};
  normalStrength.onchange=()=>{if(!Number.isFinite(normalStrength.valueAsNumber)||normalStrength.valueAsNumber<0||normalStrength.valueAsNumber>8)normalStrength.value=String(generated?.strength??1.5);render();};
  previewNormal.onclick=()=>{
    if(previewNormal.disabled||!generated)return;
    const value=generated;
    void task(async(signal,token)=>{
      closeNormalPreview();const dialog=document.createElement("dialog"),root=document.createElement("div");dialog.className="placement-pixel-normal-dialog";
      normalDialog=dialog;const close=button("Close","normal-preview-close",dialog);dialog.append(root);
      const dismiss=()=>closeNormalPreview();close.onclick=dismiss;dialog.addEventListener("cancel",event=>{event.preventDefault();dismiss();});
      registerUiRoot(dialog);document.body.append(dialog);dialog.showModal();close.focus();
      let preview:Awaited<ReturnType<typeof createPlacementNormalPreview>>|undefined;
      try{preview=await createPlacementNormalPreview(root,value.asset.png,value.entry.png);current(signal,token);
        if(normalDialog!==dialog)throw Error("Normal preview closed");normalPreview=preview;preview.setMoving(true);
      }catch(error){const cancelled=signal.aborted||normalDialog!==dialog;preview?.destroy();if(normalDialog===dialog)closeNormalPreview();if(cancelled)return;throw error;}
    });
  };
  applyNormal.onclick=()=>void(async()=>{
    if(applyNormal.disabled||!freshNormal()||!generated)return;
    const value=generated,context=options.context(),signature=JSON.stringify(context.document),selection=options.viewer.state().selectedInstanceId,baseline=serial;
    let approval:string|undefined;
    try{pairedPatch();}catch(error){
      if(!(error instanceof PixelClipMigrationRequired)){report(error);return;}
      if(!await confirmClipMigration(error))return;
      if(disposed||baseline!==serial||value!==generated||signature!==JSON.stringify(options.context().document)||selection!==options.viewer.state().selectedInstanceId||!freshNormal())return;
      approval=error.approval;
    }
    void task(async(signal,token)=>{
      await normals!.upload(value.entry,signal);current(signal,token);
      if(!options.context().canEdit||signature!==JSON.stringify(options.context().document)||selection!==options.viewer.state().selectedInstanceId||value!==generated||!freshNormal())throw Error("Scene or selection changed. Apply again.");
      const patch=pairedPatch(approval);
      normals!.activate(value.entry,options.context().document,patch,()=>options.apply(patch,"Apply Pixel Normals"),owner);
      message="Pixel color and normals applied. Scene Undo restores both.";options.changed();
    });
  })();
  clean.onclick = () => void task(async (signal, token) => {
    const result = await assets.collectUnused(); current(signal, token);
    message = uiMessage("Removed {0} revisions · Freed {1} bytes", result.removed, result.bytes);
    options.changed();
  });
  undo.onclick = () => { surface.cancel(); editor?.undo(); render(); surface.refresh(); options.tabsChanged(); };
  redo.onclick = () => { surface.cancel(); editor?.redo(); render(); surface.refresh(); options.tabsChanged(); };
  back.onclick = () => { suspend(); options.stage.querySelector<HTMLCanvasElement>(".demo-canvas")?.focus(); };
  zoomIn.onclick = () => surface.zoomBy(1); zoomOut.onclick = () => surface.zoomBy(-1); fit.onclick = () => surface.fit();
  colorInput.oninput = alpha.oninput = () => {
    const opacity = alpha.valueAsNumber;
    if (!Number.isInteger(opacity) || opacity < 0 || opacity > 255) return;
    color = pixelColor(colorInput.value + opacity.toString(16).padStart(2, "0"));
  };
  alpha.addEventListener("change", syncColor);
  workspace.addEventListener("keydown", event => {
    event.stopPropagation();
    if (busy || !editor || (event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable=true]"))) return;
    if(framePanel?.isPlaying()) {
      if(event.code==="Escape"){event.preventDefault();framePanel.stop();}
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      if (event.code === "KeyZ" || event.code === "KeyY") {
        event.preventDefault();
        if (editor.active()) surface.cancel();
        else if (event.shiftKey || event.code === "KeyY") redo.click(); else undo.click();
      } else if (event.code === "KeyS") { event.preventDefault(); if (options.projectHost?.()) save.click(); else exportSource(); }
      return;
    }
    if (event.code === "Escape") { event.preventDefault(); surface.cancel(); }
    const map: Record<string, PixelTool> = { KeyB: "pencil", KeyE: "eraser", KeyG: "fill", KeyI: "eyedropper", KeyH: "pan" };
    if (map[event.code]) { event.preventDefault(); surface.cancel(); tool = map[event.code]; render(); }
  });
  workspace.addEventListener("pointerdown", event => event.stopPropagation());
  window.addEventListener("pagehide", event => { if (!event.persisted) destroy(); });
  registerUiRoot(element); registerUiRoot(workspace);
  function destroy() {
    if (disposed) return;
    disposed = true; active = false; invalidate(); framePanel?.destroy(); surface.destroy(); normals?.destroy(); assets.destroy();
    for (const url of downloads) URL.revokeObjectURL(url);
    downloads.clear(); workspace.remove(); delete options.stage.dataset.pixelEditor;
    editor = undefined; imageLayers.clear();
  }
  return {
    element, workspace, activate, suspend, isOpen: () => active,
    isBusy: () => busy||(framePanel?.isPlaying()??false),
    ownsGesture: () => editor?.active() ?? false,
    openAsset(name: string, url: string, id?: string, frameId?: string, atlas?: PixelAtlasMetadata) {
      if (busy || disposed || !options.context().canEdit) return;
      invalidate(); controller = new AbortController();
      const signal = controller.signal, key = options.context().key, token = ++serial;
      void (async () => {
        const asset = assets.entries().find(a => a.id === id && canUsePlacementAsset(a,key,options.context().project));
        if (asset) {
          const previous = editor;
          if (await confirmDiscard() && token === serial && !disposed && previous === editor && key === options.context().key)
            replace(asset.source, asset.persisted === true, frameId);
          return;
        }
        const bytes = await placementNormalRead(await fetch(url, { signal }), 4 * 1024 * 1024);
        signal.throwIfAborted();
        if (token !== serial || disposed || key !== options.context().key) return;
        if (atlas?.frames.length) {
          if (!frameId) throw Error("Choose an atlas frame to edit pixels");
          const image = await readPixelPng(bytes);
          signal.throwIfAborted();
          if (token !== serial || disposed || key !== options.context().key || !options.context().canEdit) return;
          const metadata = readPixelAtlas(atlas, image.width, image.height);
          if (!metadata.frames.some(frame => frame.id === frameId)) throw Error("Pixel frame not found");
          const value: PixelDocument = { ...pixelDocumentFromRgba(image.width, image.height, shortPixelName(name), image.pixels), version: 4, atlas: metadata };
          const previous = editor;
          if (await confirmDiscard() && token === serial && !disposed && previous === editor && key === options.context().key && options.context().canEdit)
            replace(value, false, frameId);
        } else openFile(new File([bytes], shortPixelName(name, 60) + ".png", { type: "image/png" }));
      })().catch(error => { if (token === serial && !signal.aborted) report(error); });
    },
    dirty,
    tab: () => editor ? { key: PIXEL_TAB, label: editor.name + ".pixel", source: editor.name,
      dirty: dirty(), controls: workspace.id, closable: !busy } : undefined,
    async close() {
      if (busy || disposed) return;
      invalidate();
      const token = serial, previous = editor;
      if (!await confirmDiscard() || disposed || token !== serial || editor !== previous) return;
      suspend();if(generated&&!generated.entry.committed)normals?.discard(generated.entry);generated=undefined; editor = undefined; imageLayers.clear(); framePanel?.clear(); palette.replaceChildren(); options.tabsChanged();
    },
    sync() {
      if (active && (options.context().mode === "game" || owner !== options.context().key)) suspend();
      render();
    },
    providerAssets: () => assets.providerAssets(options.context().key, options.context().project),
    has: assets.has,
    retainsColor: (id:string) => normals?.retainsColor(id)??false,
    normalBindings: () => normals?.bindings(options.context().key,options.context().document,options.viewer.state())??[],
    blocksSave: (document: SceneAuthoringDocumentSpec) => assets.blocksSave(document,options.context().key,options.context().project)||(normals?.blocksSave(document,options.context().key)??false),
    assertDocumentAssets(document:SceneAuthoringDocumentSpec,key:string,project?:string){assets.assertDocumentAssets(document,key,project);normals?.assertDocumentAssets(document,key,project);},
    closeScene(key: string) {
      if (owner === key) suspend();
      normals?.close(key);assets.close(key);
    },
    destroy,
  };
}
