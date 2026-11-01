import { setUiAttribute } from "./placementLocale";
import { pixelRegionContains, type createPixelEditor, type PixelColor } from "./placementPixelDocument";
import { pixelOnionFrames, PIXEL_ONION_DEFAULTS, type PixelOnionSettings } from "./placementPixelOnion";
import type { createPixelSelection } from "./placementPixelSelection";
import type { PixelRegion } from "./placementPixelDocument";
import { rasterPixelDrawing, pixelDrawSettings, pixelRepeatDomain, PIXEL_REPEAT_DEFAULTS, PIXEL_DRAW_DEFAULTS, type PixelRepeat, type PixelShape, type PixelDrawSettings } from "./placementPixelDrawing";
import { createPixelPerfectStroke } from "./placementPixelPerfect";
import { PIXEL_SELECTION_DEFAULTS, PIXEL_SELECTION_PATH_LIMIT, type PixelSelectionSettings } from "./placementPixelMask";
import { createPixelImageBrushStroke, type PixelImageBrush } from "./placementPixelImageBrush";

export type PixelTool = "pencil" | "eraser" | "fill" | "eyedropper" | "pan" | "select" | PixelShape;
/** View state only. Pixel mutations and Undo belong to the document model. */
export function createPixelCanvas(options: {
  editor(): ReturnType<typeof createPixelEditor>;
  tool(): PixelTool;
  color(): PixelColor;
  drawing?(): PixelDrawSettings;
  pixelPerfect?(): boolean;
  imageBrush?(): PixelImageBrush | undefined;
  repeat?(): PixelRepeat;
  frame?(): string;
  readOnly?(): boolean;
  onion?(): PixelOnionSettings;
  selection?: ReturnType<typeof createPixelSelection>;
  selectionSettings?(): PixelSelectionSettings;
  report?(error: unknown): void;
  pick(color: PixelColor): void;
  changed(): void;
  viewChanged?(): void;
}) {
  const element = document.createElement("canvas"), image = document.createElement("canvas");
  element.className = "placement-pixel-canvas";
  element.dataset.pixelCanvas = "true";
  element.tabIndex = 0;
  setUiAttribute(element, "aria-label", "Pixel canvas");
  const context = element.getContext("2d"), imageContext = image.getContext("2d");
  if (!context || !imageContext) throw Error("Canvas image processing unavailable");
  let zoom = 16, panX = 0, panY = 0, space = false, frame = 0, disposed = false;
  let shapePreview: Uint8Array | undefined;
  let hover: { x: number; y: number } | undefined;
  let brushPreview: { editor: ReturnType<typeof createPixelEditor>; revision: number; target: string; pixels: Uint8Array } | undefined;
  type Gesture = {
    id: number; x: number; y: number; mode: "paint" | "pan" | "select" | "move" | "shape" | "polygon";
    panX: number; panY: number; color: PixelColor;
    previous?: PixelRegion;
    editor: ReturnType<typeof createPixelEditor>; target: string; revision: number;
    settings: PixelDrawSettings; clip?: PixelRegion; region: PixelRegion;
    shape?: PixelShape; endX?: number; endY?: number; square?: boolean;
    perfect?: ReturnType<typeof createPixelPerfectStroke>;
    brush?: ReturnType<typeof createPixelImageBrushStroke>;
    selectionSettings: PixelSelectionSettings; path?: { x: number; y: number }[];
    repeat: PixelRepeat;
  };
  let gesture: Gesture | undefined;
  let border: { version: number; path: Path2D } | undefined;
  const target = (editor: ReturnType<typeof createPixelEditor>) => JSON.stringify([editor.selectedFrame(), editor.selectedLayer(), editor.selectedAtlasFrame()]);
  const sameTarget = (g: Gesture) => g.editor === options.editor() && g.target === target(g.editor);
  const paintable = (g: Gesture) => sameTarget(g) && g.editor.canPaint() && !options.readOnly?.();
  function retainSelection(g: Gesture) { if (g.clip && sameTarget(g)) options.selection?.select(g.clip); }
  function paint(g: Gesture, x: number, y: number, finish = false) {
    if (g.brush) { const result = g.brush.add(x, y, finish); g.editor.paintRegion(result.region, result.pixels); }
    else if (g.perfect) g.editor.paintStrokeMask(g.perfect.add(x, y), g.color);
    else g.editor.paintMask(rasterPixelDrawing("line", g.region, g, { x, y }, g.settings, g.clip, false, g.repeat), g.color);
    retainSelection(g);
  }
  function previewShape(g: Gesture, x: number, y: number, square: boolean) {
    if (!paintable(g) || g.revision !== g.editor.revision()) { cancel(); return; }
    g.endX = x; g.endY = y; g.square = square;
    shapePreview = g.editor.previewPaint(rasterPixelDrawing(g.shape!, g.region, g, { x, y }, g.settings, g.clip, square, g.repeat), g.color);
  }
  function dimensions() {
    const rect = element.getBoundingClientRect(), region = options.editor().region();
    return { rect, region, left: rect.width / 2 - region.width * zoom / 2 + panX,
      top: rect.height / 2 - region.height * zoom / 2 + panY };
  }
  function point(event: PointerEvent) {
    const { rect, left, top, region } = dimensions();
    return { x: region.x + Math.floor((event.clientX - rect.left - left) / zoom),
      y: region.y + Math.floor((event.clientY - rect.top - top) / zoom) };
  }
  function render() {
    frame = 0;
    if (disposed || !element.isConnected || !element.getBoundingClientRect().width) return;
    if (gesture?.mode === "shape" && (!paintable(gesture) || gesture.revision !== gesture.editor.revision())) { cancel(); return; }
    const { rect, left, top, region } = dimensions(), editor = options.editor();
    const repeat = editor.atlas() ? { ...PIXEL_REPEAT_DEFAULTS } : options.repeat?.() ?? PIXEL_REPEAT_DEFAULTS, domain = pixelRepeatDomain(region, repeat);
    const viewLeft = left + (domain.x - region.x) * zoom, viewTop = top + (domain.y - region.y) * zoom;
    element.dataset.pixelPaintable = String(editor.canPaint() && !options.readOnly?.());
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr));
    if (element.width !== width || element.height !== height) {
      element.width = width; element.height = height;
    }
    context!.setTransform(dpr, 0, 0, dpr, 0, 0);
    context!.clearRect(0, 0, rect.width, rect.height);
    context!.imageSmoothingEnabled = false;
    const style = getComputedStyle(element);
    const background = style.getPropertyValue("--bg-2").trim() || "#19232e";
    const foreground = style.getPropertyValue("--border-strong").trim() || "#2a313b";
    // Checkers belong to the image bounds; the work area stays visually quiet.
    context!.save();
    context!.beginPath(); context!.rect(viewLeft, viewTop, domain.width * zoom, domain.height * zoom); context!.clip();
    const tile = Math.max(4, zoom);
    for (let y = Math.max(0, Math.floor(-viewTop / tile)); y < Math.min(Math.ceil(domain.height * zoom / tile), Math.ceil((rect.height - viewTop) / tile)); y++)
      for (let x = Math.max(0, Math.floor(-viewLeft / tile)); x < Math.min(Math.ceil(domain.width * zoom / tile), Math.ceil((rect.width - viewLeft) / tile)); x++) {
        context!.fillStyle = (x + y) % 2 ? background : foreground;
        context!.fillRect(viewLeft + x * tile, viewTop + y * tile, tile, tile);
      }
    image.width = editor.width; image.height = editor.height;
    const onion=options.onion?.()??PIXEL_ONION_DEFAULTS;
    const ghosts=pixelOnionFrames(editor.frames(),editor.selectedFrame(),onion,options.readOnly?.());
    element.dataset.pixelOnionFrames=JSON.stringify(ghosts);
    for(const ghost of ghosts) {
      imageContext!.putImageData(new ImageData(new Uint8ClampedArray(editor.bytes(ghost.id)),editor.width,editor.height),0,0);
      imageContext!.save();
      imageContext!.globalCompositeOperation="source-in";
      imageContext!.fillStyle=style.getPropertyValue(ghost.side==="previous"?"--red":"--cyan").trim()||(ghost.side==="previous"?"#FF6B6B":"#38D5E8");
      imageContext!.fillRect(0,0,editor.width,editor.height);imageContext!.restore();
      context!.globalAlpha=onion.opacity/100;
      for (let y = repeat.y ? -1 : 0; y <= (repeat.y ? 1 : 0); y++) for (let x = repeat.x ? -1 : 0; x <= (repeat.x ? 1 : 0); x++)
        context!.drawImage(image, region.x, region.y, region.width, region.height, left + x * region.width * zoom, top + y * region.height * zoom, region.width * zoom, region.height * zoom);
    }
    context!.globalAlpha=1;
    brushPreview = undefined;
    const imageBrush = options.tool() === "pencil" && !gesture && !options.readOnly?.() && !element.inert && !options.selection?.pending() ? options.imageBrush?.() : undefined;
    if (imageBrush && hover && pixelRegionContains(region, hover.x, hover.y) && editor.canPaint()) {
      const settings = options.drawing?.() ?? PIXEL_DRAW_DEFAULTS;
      const result = createPixelImageBrushStroke(region, hover, imageBrush, options.selection?.area(), settings.mirrorX, settings.mirrorY, repeat).add(hover.x, hover.y);
      brushPreview = { editor, revision: editor.revision(), target: target(editor), pixels: editor.previewRegion(result.region, result.pixels) };
    }
    element.dataset.pixelBrushPreview = String(!!brushPreview);
    imageContext!.putImageData(new ImageData(new Uint8ClampedArray(shapePreview ?? brushPreview?.pixels ?? options.selection?.preview() ?? editor.bytes(options.frame?.())), editor.width, editor.height), 0, 0);
    for (let y = repeat.y ? -1 : 0; y <= (repeat.y ? 1 : 0); y++) for (let x = repeat.x ? -1 : 0; x <= (repeat.x ? 1 : 0); x++)
      context!.drawImage(image, region.x, region.y, region.width, region.height, left + x * region.width * zoom, top + y * region.height * zoom, region.width * zoom, region.height * zoom);
    context!.restore();
    element.dataset.pixelRepeatX = String(repeat.x); element.dataset.pixelRepeatY = String(repeat.y); element.dataset.pixelRepeatTiles = String((repeat.x ? 3 : 1) * (repeat.y ? 3 : 1));
    if (repeat.x || repeat.y) { context!.strokeStyle = style.getPropertyValue("--accent").trim() || foreground; context!.lineWidth = 1; context!.strokeRect(left, top, region.width * zoom, region.height * zoom); }
    if (zoom >= 6) {
      context!.strokeStyle = style.getPropertyValue("--border").trim() || foreground;
      context!.globalAlpha = 0.55;
      context!.lineWidth = 1 / dpr;
      context!.beginPath();
      for (let x = 0; x <= region.width; x++) {
        const px = left + x * zoom;
        if (px >= 0 && px <= rect.width) { context!.moveTo(px, top); context!.lineTo(px, top + region.height * zoom); }
      }
      for (let y = 0; y <= region.height; y++) {
        const py = top + y * zoom;
        if (py >= 0 && py <= rect.height) { context!.moveTo(left, py); context!.lineTo(left + region.width * zoom, py); }
      }
      context!.stroke(); context!.globalAlpha = 1;
    }
    element.dataset.pixelRegion = JSON.stringify(region);
    element.dataset.pixelZoom = String(zoom);
    element.dataset.pixelOriginX = String(left);
    element.dataset.pixelOriginY = String(top);
    const selection = options.selection?.bounds(), area = options.selection?.area();
    element.dataset.pixelSelection = JSON.stringify(selection ?? null);
    element.dataset.pixelSelectionCount = String(area ? area.mask ? area.mask.reduce((n, v) => n + v, 0) : area.width * area.height : 0);
    element.dataset.pixelSelectionPending = String(options.selection?.pending() ?? false);
    element.dataset.pixelShapePending = String(gesture?.mode === "shape");
    element.dataset.pixelPolygonPending = String(gesture?.mode === "polygon");
    if (selection && area) {
      context!.save(); context!.beginPath(); context!.rect(left, top, region.width * zoom, region.height * zoom); context!.clip();
      const version = options.selection!.version();
      if (!border || border.version !== version) {
        const path = new Path2D();
        if (!area.mask) path.rect(area.x, area.y, area.width, area.height);
        else for (let y = area.y; y < area.y + area.height; y++) for (let x = area.x; x < area.x + area.width; x++) if (pixelRegionContains(area, x, y)) {
          if (!pixelRegionContains(area, x, y - 1)) { path.moveTo(x, y); path.lineTo(x + 1, y); }
          if (!pixelRegionContains(area, x, y + 1)) { path.moveTo(x, y + 1); path.lineTo(x + 1, y + 1); }
          if (!pixelRegionContains(area, x - 1, y)) { path.moveTo(x, y); path.lineTo(x, y + 1); }
          if (!pixelRegionContains(area, x + 1, y)) { path.moveTo(x + 1, y); path.lineTo(x + 1, y + 1); }
        }
        border = { version, path };
      }
      context!.translate(left - region.x * zoom, top - region.y * zoom); context!.scale(zoom, zoom);
      context!.lineWidth = 1 / zoom; context!.strokeStyle = style.getPropertyValue("--bg-1").trim() || background;
      context!.stroke(border.path); context!.setLineDash([4 / zoom, 4 / zoom]); context!.strokeStyle = style.getPropertyValue("--accent").trim() || foreground;
      context!.stroke(border.path); context!.restore();
    } else border = undefined;
  }
  function refresh() { if (!frame && !disposed) frame = requestAnimationFrame(render); options.viewChanged?.(); }
  function cancel(cancelFloating = true) {
    if (gesture?.mode === "paint") { gesture.editor.cancel(); retainSelection(gesture); }
    if ((gesture?.mode === "select" || gesture?.mode === "polygon") && sameTarget(gesture) && gesture.revision === gesture.editor.revision()) options.selection?.select(gesture.previous);
    if (cancelFloating || gesture?.mode === "move") options.selection?.cancel();
    const id = gesture?.id;
    gesture = undefined; shapePreview = undefined; brushPreview = undefined; hover = undefined;
    if (id !== undefined && element.hasPointerCapture(id)) element.releasePointerCapture(id);
    options.changed(); refresh();
  }
  function marquee(x: number, y: number) {
    const r = options.editor().region(), g = gesture!;
    if (!sameTarget(g) || g.revision !== g.editor.revision() || options.readOnly?.()) { cancel(); return; }
    if (g.selectionSettings.shape !== "rectangle") {
      try {
        const path = g.path!, last = path.at(-1);
        if (g.mode !== "polygon" && (!last || last.x !== x || last.y !== y)) {
          if (path.length >= PIXEL_SELECTION_PATH_LIMIT) throw Error("Selection path limit reached");
          path.push({ x, y });
        }
        const preview = g.mode === "polygon" && (!last || last.x !== x || last.y !== y) ? [...path, { x, y }] : path;
        options.selection?.selectPath(preview, g.selectionSettings.operation, g.previous);
      } catch (error) { cancel(); options.report?.(error); }
      return;
    }
    const left = Math.max(r.x, Math.min(g.x, x)), top = Math.max(r.y, Math.min(g.y, y));
    const right = Math.min(r.x + r.width, Math.max(g.x, x) + 1), bottom = Math.min(r.y + r.height, Math.max(g.y, y) + 1);
    options.selection?.select(right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : undefined, g.selectionSettings.operation, { area: g.previous });
  }
  function finishPolygon() {
    const g = gesture; if (g?.mode !== "polygon") return;
    if (!sameTarget(g) || g.revision !== g.editor.revision() || options.readOnly?.()) { cancel(); return; }
    try { options.selection?.selectPath(g.path!, g.selectionSettings.operation, g.previous); gesture = undefined; options.changed(); refresh(); }
    catch (error) { cancel(); options.report?.(error); }
  }
  function finish(event: PointerEvent, commit: boolean) {
    if (gesture?.id !== event.pointerId) return;
    if (gesture.mode === "polygon") { if (!commit) cancel(); return; }
    if (gesture.mode === "paint") {
      if (commit && paintable(gesture) && gesture.editor.active()) {
        const p = point(event);
        paint(gesture, p.x, p.y, true); hover = { ...p }; gesture.editor.commit();
      } else gesture.editor.cancel();
      retainSelection(gesture);
    } else if (gesture.mode === "shape") {
      if (commit && paintable(gesture) && gesture.revision === gesture.editor.revision()) {
        const p = point(event);
        gesture.editor.editPaint(rasterPixelDrawing(gesture.shape!, gesture.region, gesture, p, gesture.settings, gesture.clip, event.shiftKey, gesture.repeat), gesture.color);
        retainSelection(gesture);
      }
    } else if (gesture.mode === "select") {
      if (commit) { const p = point(event); marquee(p.x, p.y); }
      else if (sameTarget(gesture) && gesture.revision === gesture.editor.revision()) options.selection?.select(gesture.previous);
    } else if (gesture.mode === "move") {
      if (commit) { const p = point(event); options.selection?.moveBy(p.x - gesture.x, p.y - gesture.y); }
      else options.selection?.cancel();
    }
    gesture = undefined; shapePreview = undefined;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    options.changed(); refresh();
  }
  element.addEventListener("pointerdown", event => {
    if (gesture?.mode === "polygon" && event.button === 0) {
      const g = gesture, p = point(event); event.preventDefault();
      if (!sameTarget(g) || g.revision !== g.editor.revision()) { cancel(); return; }
      try { const last = g.path!.at(-1); if (!last || last.x !== p.x || last.y !== p.y) { if (g.path!.length >= PIXEL_SELECTION_PATH_LIMIT) throw Error("Selection path limit reached"); g.path!.push(p); } marquee(p.x, p.y); refresh(); }
      catch (error) { cancel(); options.report?.(error); } return;
    }
    if (gesture || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault(); element.focus({ preventScroll: true });
    const editor = options.editor(), tool = options.tool(), p = point(event);
    const selectionSettings = { ...(options.selectionSettings?.() ?? PIXEL_SELECTION_DEFAULTS) };
    if (event.shiftKey || event.altKey) selectionSettings.operation = event.shiftKey && event.altKey ? "intersect" : event.shiftKey ? "add" : "subtract";
    const snapshot = { editor, target: target(editor), revision: editor.revision(), settings: pixelDrawSettings(options.drawing?.() ?? PIXEL_DRAW_DEFAULTS),
      clip: options.selection?.area(), region: editor.region(), selectionSettings, repeat: editor.atlas() ? { ...PIXEL_REPEAT_DEFAULTS } : { ...(options.repeat?.() ?? PIXEL_REPEAT_DEFAULTS) } };
    if (tool === "pan" || space || event.button === 1) {
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
        mode: "pan", panX, panY, color: options.color(), ...snapshot };
    } else {
      if (!editor.sample(p.x, p.y, options.frame?.())) return;
      if (tool === "eyedropper" || (event.altKey && tool !== "select")) {
        options.pick(editor.sample(p.x, p.y, options.frame?.())!); return;
      }
      if (tool === "select" && options.selection && !options.readOnly?.()) {
        const selection = options.selection, previous = selection.area();
        if (selectionSettings.shape === "color" || selectionSettings.shape === "wand") {
          try { selection.selectColor(p.x, p.y, selectionSettings.tolerance, selectionSettings.shape === "wand", selectionSettings.diagonal, selectionSettings.operation); options.changed(); refresh(); }
          catch (error) { options.report?.(error); } return;
        }
        const inside = selectionSettings.shape === "rectangle" && selectionSettings.operation === "replace" && selection.contains(p.x, p.y);
        if (inside && !selection.beginMove()) return;
        gesture = { id: event.pointerId, ...p, mode: inside ? "move" : selectionSettings.shape === "polygon" ? "polygon" : "select", panX, panY, color: options.color(), previous, path: [p], ...snapshot };
        if (!inside) marquee(p.x, p.y);
        if (gesture && gesture.mode !== "polygon") element.setPointerCapture(event.pointerId); options.changed(); refresh(); return;
      }
      if (!editor.canPaint() || options.readOnly?.()) return;
      const color: PixelColor = tool === "eraser" ? [0, 0, 0, 0] : options.color();
      if (tool === "line" || tool === "rectangle" || tool === "ellipse") {
        gesture = { id: event.pointerId, ...p, mode: "shape", shape: tool, panX, panY, color, ...snapshot };
        previewShape(gesture, p.x, p.y, event.shiftKey);
        element.setPointerCapture(event.pointerId); options.changed(); refresh(); return;
      }
      editor.begin();
      if (tool === "fill") { editor.fill(p.x, p.y, color, snapshot.clip, snapshot.repeat); editor.commit(); if (snapshot.clip) options.selection?.select(snapshot.clip); options.changed(); refresh(); return; }
      gesture = { id: event.pointerId, ...p, mode: "paint", panX, panY, color, ...snapshot };
      const imageBrush = tool === "pencil" ? options.imageBrush?.() : undefined;
      if (imageBrush) gesture.brush = createPixelImageBrushStroke(snapshot.region, p, imageBrush, snapshot.clip, snapshot.settings.mirrorX, snapshot.settings.mirrorY, snapshot.repeat);
      else if (tool === "pencil" && snapshot.settings.size === 1 && options.pixelPerfect?.()) gesture.perfect = createPixelPerfectStroke(snapshot.region, p, snapshot.settings, snapshot.clip, snapshot.repeat);
      paint(gesture, p.x, p.y);
    }
    element.setPointerCapture(event.pointerId); options.changed(); refresh();
  });
  element.addEventListener("pointermove", event => {
    if (!gesture && options.tool() === "pencil" && options.imageBrush?.()) { hover = point(event); refresh(); }
    if (!gesture || gesture.id !== event.pointerId) return;
    if (gesture.mode === "pan") {
      panX = gesture.panX + event.clientX - gesture.x;
      panY = gesture.panY + event.clientY - gesture.y;
    } else if (gesture.mode === "select" || gesture.mode === "polygon") {
      const p = point(event); marquee(p.x, p.y);
    } else if (gesture.mode === "move") {
      const p = point(event); options.selection?.moveBy(p.x - gesture.x, p.y - gesture.y); gesture.x = p.x; gesture.y = p.y;
    } else if (gesture.mode === "shape") {
      if (!paintable(gesture) || gesture.revision !== gesture.editor.revision()) { cancel(); return; }
      const p = point(event);
      if (p.x !== gesture.endX || p.y !== gesture.endY || event.shiftKey !== gesture.square) previewShape(gesture, p.x, p.y, event.shiftKey);
    } else {
      if (!paintable(gesture) || !gesture.editor.active()) { cancel(); return; }
      const p = point(event);
      paint(gesture, p.x, p.y);
      hover = { ...p };
      gesture.x = p.x; gesture.y = p.y;
    }
    refresh();
  });
  element.addEventListener("pointerup", event => finish(event, true));
  element.addEventListener("pointercancel", event => finish(event, false));
  element.addEventListener("lostpointercapture", event => finish(event, false));
  element.addEventListener("pointerleave", () => { if (!gesture) { hover = undefined; brushPreview = undefined; refresh(); } });
  element.addEventListener("dblclick", event => { if (gesture?.mode === "polygon") { event.preventDefault(); finishPolygon(); } });
  element.addEventListener("keydown", event => {
    if (gesture?.mode === "polygon" && ["Enter", "Backspace"].includes(event.code)) {
      event.preventDefault(); event.stopPropagation();
      if (event.code === "Enter") finishPolygon();
      else { gesture.path!.pop(); const last = gesture.path!.at(-1); if (last) marquee(last.x, last.y); else options.selection?.select(undefined, gesture.selectionSettings.operation, { area: gesture.previous }); refresh(); }
      return;
    }
    if (event.code === "Space") { event.preventDefault(); space = true; }
    if ((event.code === "ShiftLeft" || event.code === "ShiftRight") && gesture?.mode === "shape") {
      previewShape(gesture, gesture.endX!, gesture.endY!, true); refresh();
    }
  });
  element.addEventListener("keyup", event => {
    if (event.code === "Space") { event.preventDefault(); space = false; }
    if ((event.code === "ShiftLeft" || event.code === "ShiftRight") && gesture?.mode === "shape") { previewShape(gesture, gesture.endX!, gesture.endY!, event.shiftKey); refresh(); }
  });
  element.addEventListener("blur", () => { space = false; cancel(false); });
  const loseFocus = () => { space = false; cancel(); };
  window.addEventListener("blur", loseFocus);
  element.addEventListener("contextmenu", event => event.preventDefault());
  function zoomBy(delta: number) { zoom = Math.max(1, Math.min(64, zoom + delta)); refresh(); }
  element.addEventListener("wheel", event => {
    event.preventDefault();
    if (gesture) return;
    const { rect, left, top, region } = dimensions();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const px = (x - left) / zoom, py = (y - top) / zoom;
    zoom = Math.max(1, Math.min(64, zoom + (event.deltaY < 0 ? 1 : -1)));
    panX = x - rect.width / 2 + region.width * zoom / 2 - px * zoom;
    panY = y - rect.height / 2 + region.height * zoom / 2 - py * zoom;
    refresh();
  }, { passive: false });
  const observer = new ResizeObserver(refresh);
  observer.observe(element);
  return {
    element, refresh, cancel, zoomBy, ownsGesture: () => gesture !== undefined,
    previewBytes() {
      if (gesture?.mode === "shape" && (!paintable(gesture) || gesture.revision !== gesture.editor.revision())) return options.editor().bytes(options.frame?.());
      const preview = brushPreview && brushPreview.editor === options.editor() && brushPreview.revision === options.editor().revision() && brushPreview.target === target(options.editor()) ? brushPreview.pixels : undefined;
      return shapePreview?.slice() ?? preview?.slice() ?? options.selection?.preview()?.slice() ?? options.editor().bytes(options.frame?.());
    },
    fit() {
      const rect = element.getBoundingClientRect(), region = options.editor().region();
      const domain = pixelRepeatDomain(region, options.editor().atlas() ? PIXEL_REPEAT_DEFAULTS : options.repeat?.() ?? PIXEL_REPEAT_DEFAULTS);
      zoom = Math.max(1, Math.min(32, Math.floor(Math.min((rect.width - 48) / domain.width, (rect.height - 48) / domain.height))));
      panX = panY = 0; refresh();
    },
    destroy() {
      cancel(); disposed = true; observer.disconnect();
      window.removeEventListener("blur", loseFocus);
      if (frame) cancelAnimationFrame(frame);
      image.width = image.height = 0;
      border = undefined;
      hover = undefined; brushPreview = undefined;
      element.width = element.height = 0;
    },
  };
}
