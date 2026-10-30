import type { FerrumRuntime } from "@ferrum2d/ferrum-web/core";
import type { SceneAuthoringDocumentSpec, ScenePlacementPatch, ScenePlacementViewer } from "@ferrum2d/ferrum-web/authoring";
import { setUiAttribute, setUiText, registerUiRoot, uiMessage, type UiContent } from "./placementLocale";
import { createPixelEditor, newPixelDocument, readPixelDocument, pixelColor, pixelHex,
  pixelDocumentFromRgba, PIXEL_LIMITS, type PixelDocument, type PixelColor } from "./placementPixelDocument";
import { createPixelCanvas, type PixelTool } from "./placementPixelCanvas";
import { createPixelAssets, pixelComponentPatch } from "./placementPixelAssets";
import { pixelPng } from "./placementPixelPng";
import { placementNormalRead } from "./placementNormalAssets";
import { readPixelProject, type PixelProjectHost } from "./placementPixelProject";
import { canUsePlacementAsset } from "./placementAssetScope";
import { createPixelLayers } from "./placementPixelLayers";

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
  header.append(title, info);
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
  const assets = options.assets ?? createPixelAssets(options);
  const surface = createPixelCanvas({
    editor: () => editor!, tool: () => tool, color: () => color,
    pick(value) { color = value; syncColor(); render(); },
    changed() { if (editor) { render(); options.tabsChanged(); } },
  });
  area.append(surface.element);
  const imageLayers = createPixelLayers({
    editor:()=>editor!,busy:()=>busy,cancelStroke:()=>surface.cancel(),report,
    changed:()=>{render();surface.refresh();options.tabsChanged();},
  });
  body.append(imageLayers.element);
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
  function replace(value: PixelDocument, exported = false) {
    invalidate();
    editor = createPixelEditor(value); owner = options.context().key;
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
    create.disabled = open.disabled = busy || !options.context().canEdit;
    setUiText(launchStatus, message);
    if (!editor || !active) return;
    title.textContent = editor.name + (dirty() ? " •" : "");
    info.textContent = editor.width + " × " + editor.height;
    workspace.dataset.pixelDirty = String(dirty());
    workspace.dataset.pixelBusy = String(busy);
    const history = editor.history();
    for (const [key, node] of toolButtons) {
      node.setAttribute("aria-pressed", String(key === tool)); node.disabled = busy;
    }
    colorInput.disabled = alpha.disabled = busy;
    surface.element.inert = busy;
    imageLayers.sync();
    for (const node of [source, png, save, register, apply, bundle, clean, undo, redo]) node.disabled = busy || editor.active();
    save.disabled ||= !options.projectHost?.() || !options.context().canEdit || owner !== options.context().key;
    setUiAttribute(save, "title", options.projectHost?.() ? "Save pixel sources and scene" : "Open a desktop project folder to save");
    undo.disabled ||= history.undo === 0; redo.disabled ||= history.redo === 0;
    apply.disabled ||= !options.context().canEdit || owner !== options.context().key;
    register.disabled ||= !options.context().canEdit || owner !== options.context().key;
    bundle.disabled ||= assets.providerAssets(owner, options.context().project).length === 0;
    clean.disabled ||= assets.providerAssets(owner, options.context().project).length === 0;
    if (!apply.disabled) {
      try { pixelComponentPatch(options.context().document, options.viewer.state(), "pixel.pending"); }
      catch (error) { apply.disabled = true; setUiAttribute(apply, "title", error instanceof Error ? error.message : String(error)); }
    }
    back.disabled = false;
    if (!apply.disabled) setUiAttribute(apply, "title", "Replace the selected sprite image");
    setUiText(status, message);
  }
  async function task(run: (signal: AbortSignal, token: number) => Promise<void>) {
    if (busy || disposed || !editor) return;
    surface.cancel();
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
  function publish(applyToSelection: boolean) {
    const context = options.context(), selection = options.viewer.state().selectedInstanceId;
    if (!context.canEdit || owner !== context.key) return;
    const signature = JSON.stringify(context.document);
    if (applyToSelection) {
      try { pixelComponentPatch(context.document, options.viewer.state(), "pixel.pending"); }
      catch (error) { report(error); return; }
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
          options.apply(pixelComponentPatch(now.document, options.viewer.state(), asset.id), "Apply Pixel Sprite");
        assets.commit(asset);
        message = applyToSelection ? "Pixel sprite applied. Scene Undo restores the previous image." : "Pixel asset registered. Choose it in Assets to place it.";
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
      message = "Assets saved · Saving scene…"; render();
      await options.saveScene?.(); current(signal,token);
      message = "Project saved · Pixel sources preserved";
      } finally { projectSaving = false; }
    });
  };
  bundle.onclick = () => {
    if (busy) return;
    try {
      download(new Blob([JSON.stringify(assets.bundle(owner, options.context().document, options.context().project), null, 2) + "\n"], { type: "application/json" }), filename() + ".pixel-assets.json");
      message = "Assets exported. Install the PNGs and manifest before saving the scene."; render();
    } catch (error) { report(error); }
  };
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
    disposed = true; invalidate(); surface.destroy(); assets.destroy();
    for (const url of downloads) URL.revokeObjectURL(url);
    downloads.clear(); workspace.remove(); delete options.stage.dataset.pixelEditor;
    editor = undefined; imageLayers.clear();
  }
  return {
    element, workspace, activate, suspend, isOpen: () => active,
    isBusy: () => busy,
    ownsGesture: () => editor?.active() ?? false,
    openAsset(name: string, url: string, id?: string) {
      if (busy || disposed || !options.context().canEdit) return;
      invalidate(); controller = new AbortController();
      const signal = controller.signal, key = options.context().key, token = ++serial;
      void (async () => {
        const asset = assets.entries().find(a => a.id === id && canUsePlacementAsset(a,key,options.context().project));
        if (asset) {
          const previous = editor;
          if (await confirmDiscard() && token === serial && !disposed && previous === editor && key === options.context().key)
            replace(asset.source, asset.persisted === true);
          return;
        }
        const bytes = await placementNormalRead(await fetch(url, { signal }), 4 * 1024 * 1024);
        signal.throwIfAborted();
        if (token !== serial || disposed || key !== options.context().key) return;
        openFile(new File([bytes], shortPixelName(name, 60) + ".png", { type: "image/png" }));
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
      suspend(); editor = undefined; imageLayers.clear(); palette.replaceChildren(); options.tabsChanged();
    },
    sync() {
      if (active && (options.context().mode === "game" || owner !== options.context().key)) suspend();
      render();
    },
    providerAssets: () => assets.providerAssets(options.context().key, options.context().project),
    has: assets.has,
    blocksSave: (document: unknown) => assets.blocksSave(document,options.context().key,options.context().project),
    assertDocumentAssets: assets.assertDocumentAssets,
    closeScene(key: string) {
      if (owner === key) suspend();
      assets.close(key);
    },
    destroy,
  };
}
