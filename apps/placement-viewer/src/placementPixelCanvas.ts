import { setUiAttribute } from "./placementLocale";
import { type createPixelEditor, type PixelColor } from "./placementPixelDocument";
import { pixelOnionFrames, PIXEL_ONION_DEFAULTS, type PixelOnionSettings } from "./placementPixelOnion";
import type { createPixelSelection } from "./placementPixelSelection";
import type { PixelRegion } from "./placementPixelDocument";

export type PixelTool = "pencil" | "eraser" | "fill" | "eyedropper" | "pan" | "select";
/** View state only. Pixel mutations and Undo belong to the document model. */
export function createPixelCanvas(options: {
  editor(): ReturnType<typeof createPixelEditor>;
  tool(): PixelTool;
  color(): PixelColor;
  frame?(): string;
  readOnly?(): boolean;
  onion?(): PixelOnionSettings;
  selection?: ReturnType<typeof createPixelSelection>;
  pick(color: PixelColor): void;
  changed(): void;
}) {
  const element = document.createElement("canvas"), image = document.createElement("canvas");
  element.className = "placement-pixel-canvas";
  element.dataset.pixelCanvas = "true";
  element.tabIndex = 0;
  setUiAttribute(element, "aria-label", "Pixel canvas");
  const context = element.getContext("2d"), imageContext = image.getContext("2d");
  if (!context || !imageContext) throw Error("Canvas image processing unavailable");
  let zoom = 16, panX = 0, panY = 0, space = false, frame = 0, disposed = false;
  let gesture: {
    id: number; x: number; y: number; mode: "paint" | "pan" | "select" | "move";
    panX: number; panY: number; color: PixelColor;
    previous?: PixelRegion;
  } | undefined;
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
    const { rect, left, top, region } = dimensions(), editor = options.editor();
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
    context!.beginPath(); context!.rect(left, top, region.width * zoom, region.height * zoom); context!.clip();
    const tile = Math.max(4, zoom);
    for (let y = Math.max(0, Math.floor(-top / tile)); y < Math.min(Math.ceil(region.height * zoom / tile), Math.ceil((rect.height - top) / tile)); y++)
      for (let x = Math.max(0, Math.floor(-left / tile)); x < Math.min(Math.ceil(region.width * zoom / tile), Math.ceil((rect.width - left) / tile)); x++) {
        context!.fillStyle = (x + y) % 2 ? background : foreground;
        context!.fillRect(left + x * tile, top + y * tile, tile, tile);
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
      context!.drawImage(image,left,top,editor.width*zoom,editor.height*zoom);
    }
    context!.globalAlpha=1;
    imageContext!.putImageData(new ImageData(new Uint8ClampedArray(options.selection?.preview() ?? editor.bytes(options.frame?.())), editor.width, editor.height), 0, 0);
    context!.drawImage(image, region.x, region.y, region.width, region.height, left, top, region.width * zoom, region.height * zoom);
    context!.restore();
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
    const selection = options.selection?.bounds();
    element.dataset.pixelSelection = JSON.stringify(selection ?? null);
    element.dataset.pixelSelectionPending = String(options.selection?.pending() ?? false);
    if (selection) {
      context!.save(); context!.beginPath(); context!.rect(left, top, region.width * zoom, region.height * zoom); context!.clip();
      const x = left + (selection.x - region.x) * zoom, y = top + (selection.y - region.y) * zoom;
      context!.lineWidth = 1; context!.strokeStyle = style.getPropertyValue("--bg-1").trim() || background;
      context!.strokeRect(x, y, selection.width * zoom, selection.height * zoom);
      context!.setLineDash([4, 4]); context!.strokeStyle = style.getPropertyValue("--accent").trim() || foreground;
      context!.strokeRect(x, y, selection.width * zoom, selection.height * zoom); context!.restore();
    }
  }
  function refresh() { if (!frame && !disposed) frame = requestAnimationFrame(render); }
  function cancel(cancelFloating = true) {
    if (gesture?.mode === "paint") options.editor().cancel();
    if (gesture?.mode === "select") options.selection?.select(gesture.previous);
    if (cancelFloating || gesture?.mode === "move") options.selection?.cancel();
    const id = gesture?.id;
    gesture = undefined;
    if (id !== undefined && element.hasPointerCapture(id)) element.releasePointerCapture(id);
    options.changed(); refresh();
  }
  function marquee(x: number, y: number) {
    const r = options.editor().region(), g = gesture!;
    const left = Math.max(r.x, Math.min(g.x, x)), top = Math.max(r.y, Math.min(g.y, y));
    const right = Math.min(r.x + r.width, Math.max(g.x, x) + 1), bottom = Math.min(r.y + r.height, Math.max(g.y, y) + 1);
    options.selection?.select(right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : undefined);
  }
  function finish(event: PointerEvent, commit: boolean) {
    if (gesture?.id !== event.pointerId) return;
    if (gesture.mode === "paint") {
      if (commit) {
        const p = point(event);
        options.editor().line(gesture.x, gesture.y, p.x, p.y, gesture.color);
        options.editor().commit();
      } else options.editor().cancel();
    } else if (gesture.mode === "select") {
      if (commit) { const p = point(event); marquee(p.x, p.y); }
      else options.selection?.select(gesture.previous);
    } else if (gesture.mode === "move") {
      if (commit) { const p = point(event); options.selection?.moveBy(p.x - gesture.x, p.y - gesture.y); }
      else options.selection?.cancel();
    }
    gesture = undefined;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    options.changed(); refresh();
  }
  element.addEventListener("pointerdown", event => {
    if (gesture || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault(); element.focus({ preventScroll: true });
    const editor = options.editor(), tool = options.tool(), p = point(event);
    if (tool === "pan" || space || event.button === 1) {
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
        mode: "pan", panX, panY, color: options.color() };
    } else {
      if (!editor.sample(p.x, p.y, options.frame?.())) return;
      if (tool === "eyedropper" || event.altKey) {
        options.pick(editor.sample(p.x, p.y, options.frame?.())!); return;
      }
      if (tool === "select" && options.selection && !options.readOnly?.()) {
        const selection = options.selection, bounds = selection.bounds();
        const inside = bounds && p.x >= bounds.x && p.y >= bounds.y && p.x < bounds.x + bounds.width && p.y < bounds.y + bounds.height;
        if (inside && !selection.beginMove()) return;
        gesture = { id: event.pointerId, ...p, mode: inside ? "move" : "select", panX, panY, color: options.color(), previous: bounds };
        if (!inside) marquee(p.x, p.y);
        element.setPointerCapture(event.pointerId); options.changed(); refresh(); return;
      }
      if (!editor.canPaint() || options.readOnly?.()) return;
      const color: PixelColor = tool === "eraser" ? [0, 0, 0, 0] : options.color();
      editor.begin();
      if (tool === "fill") { editor.fill(p.x, p.y, color); editor.commit(); options.changed(); refresh(); return; }
      editor.line(p.x, p.y, p.x, p.y, color);
      gesture = { id: event.pointerId, ...p, mode: "paint", panX, panY, color };
    }
    element.setPointerCapture(event.pointerId); refresh();
  });
  element.addEventListener("pointermove", event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (gesture.mode === "pan") {
      panX = gesture.panX + event.clientX - gesture.x;
      panY = gesture.panY + event.clientY - gesture.y;
    } else if (gesture.mode === "select") {
      const p = point(event); marquee(p.x, p.y);
    } else if (gesture.mode === "move") {
      const p = point(event); options.selection?.moveBy(p.x - gesture.x, p.y - gesture.y); gesture.x = p.x; gesture.y = p.y;
    } else {
      const p = point(event);
      options.editor().line(gesture.x, gesture.y, p.x, p.y, gesture.color);
      gesture.x = p.x; gesture.y = p.y;
    }
    refresh();
  });
  element.addEventListener("pointerup", event => finish(event, true));
  element.addEventListener("pointercancel", event => finish(event, false));
  element.addEventListener("lostpointercapture", event => finish(event, false));
  element.addEventListener("keydown", event => {
    if (event.code === "Space") { event.preventDefault(); space = true; }
  });
  element.addEventListener("keyup", event => { if (event.code === "Space") { event.preventDefault(); space = false; } });
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
    fit() {
      const rect = element.getBoundingClientRect(), region = options.editor().region();
      zoom = Math.max(1, Math.min(32, Math.floor(Math.min((rect.width - 48) / region.width, (rect.height - 48) / region.height))));
      panX = panY = 0; refresh();
    },
    destroy() {
      cancel(); disposed = true; observer.disconnect();
      window.removeEventListener("blur", loseFocus);
      if (frame) cancelAnimationFrame(frame);
      image.width = image.height = 0;
      element.width = element.height = 0;
    },
  };
}
