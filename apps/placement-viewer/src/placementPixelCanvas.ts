import { setUiAttribute } from "./placementLocale";
import { type createPixelEditor, type PixelColor } from "./placementPixelDocument";

export type PixelTool = "pencil" | "eraser" | "fill" | "eyedropper" | "pan";
/** View state only. Pixel mutations and Undo belong to the document model. */
export function createPixelCanvas(options: {
  editor(): ReturnType<typeof createPixelEditor>;
  tool(): PixelTool;
  color(): PixelColor;
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
    id: number; x: number; y: number; pan: boolean;
    panX: number; panY: number; color: PixelColor;
  } | undefined;
  function dimensions() {
    const rect = element.getBoundingClientRect(), editor = options.editor();
    return { rect, left: rect.width / 2 - editor.width * zoom / 2 + panX,
      top: rect.height / 2 - editor.height * zoom / 2 + panY };
  }
  function point(event: PointerEvent) {
    const { rect, left, top } = dimensions();
    return { x: Math.floor((event.clientX - rect.left - left) / zoom),
      y: Math.floor((event.clientY - rect.top - top) / zoom) };
  }
  function render() {
    frame = 0;
    if (disposed || !element.isConnected || !element.getBoundingClientRect().width) return;
    const { rect, left, top } = dimensions(), editor = options.editor();
    element.dataset.pixelPaintable = String(editor.canPaint());
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
    context!.beginPath(); context!.rect(left, top, editor.width * zoom, editor.height * zoom); context!.clip();
    const tile = Math.max(4, zoom);
    for (let y = Math.max(0, Math.floor(-top / tile)); y < Math.min(Math.ceil(editor.height * zoom / tile), Math.ceil((rect.height - top) / tile)); y++)
      for (let x = Math.max(0, Math.floor(-left / tile)); x < Math.min(Math.ceil(editor.width * zoom / tile), Math.ceil((rect.width - left) / tile)); x++) {
        context!.fillStyle = (x + y) % 2 ? background : foreground;
        context!.fillRect(left + x * tile, top + y * tile, tile, tile);
      }
    image.width = editor.width; image.height = editor.height;
    imageContext!.putImageData(new ImageData(new Uint8ClampedArray(editor.bytes()), editor.width, editor.height), 0, 0);
    context!.drawImage(image, left, top, editor.width * zoom, editor.height * zoom);
    context!.restore();
    if (zoom >= 6) {
      context!.strokeStyle = style.getPropertyValue("--border").trim() || foreground;
      context!.globalAlpha = 0.55;
      context!.lineWidth = 1 / dpr;
      context!.beginPath();
      for (let x = 0; x <= editor.width; x++) {
        const px = left + x * zoom;
        if (px >= 0 && px <= rect.width) { context!.moveTo(px, top); context!.lineTo(px, top + editor.height * zoom); }
      }
      for (let y = 0; y <= editor.height; y++) {
        const py = top + y * zoom;
        if (py >= 0 && py <= rect.height) { context!.moveTo(left, py); context!.lineTo(left + editor.width * zoom, py); }
      }
      context!.stroke(); context!.globalAlpha = 1;
    }
    element.dataset.pixelZoom = String(zoom);
    element.dataset.pixelOriginX = String(left);
    element.dataset.pixelOriginY = String(top);
  }
  function refresh() { if (!frame && !disposed) frame = requestAnimationFrame(render); }
  function cancel() {
    if (gesture) options.editor().cancel();
    const id = gesture?.id;
    gesture = undefined;
    if (id !== undefined && element.hasPointerCapture(id)) element.releasePointerCapture(id);
    options.changed(); refresh();
  }
  function finish(event: PointerEvent, commit: boolean) {
    if (gesture?.id !== event.pointerId) return;
    if (!gesture.pan) {
      if (commit) {
        const p = point(event);
        options.editor().line(gesture.x, gesture.y, p.x, p.y, gesture.color);
        options.editor().commit();
      } else options.editor().cancel();
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
        pan: true, panX, panY, color: options.color() };
    } else {
      if (!editor.sample(p.x, p.y)) return;
      if (tool === "eyedropper" || event.altKey) {
        options.pick(editor.sample(p.x, p.y)!); return;
      }
      if (!editor.canPaint()) return;
      const color: PixelColor = tool === "eraser" ? [0, 0, 0, 0] : options.color();
      editor.begin();
      if (tool === "fill") { editor.fill(p.x, p.y, color); editor.commit(); options.changed(); refresh(); return; }
      editor.line(p.x, p.y, p.x, p.y, color);
      gesture = { id: event.pointerId, ...p, pan: false, panX, panY, color };
    }
    element.setPointerCapture(event.pointerId); refresh();
  });
  element.addEventListener("pointermove", event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (gesture.pan) {
      panX = gesture.panX + event.clientX - gesture.x;
      panY = gesture.panY + event.clientY - gesture.y;
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
  element.addEventListener("blur", () => { space = false; cancel(); });
  const loseFocus = () => { space = false; cancel(); };
  window.addEventListener("blur", loseFocus);
  element.addEventListener("contextmenu", event => event.preventDefault());
  function zoomBy(delta: number) { zoom = Math.max(1, Math.min(64, zoom + delta)); refresh(); }
  element.addEventListener("wheel", event => {
    event.preventDefault();
    if (gesture) return;
    const { rect, left, top } = dimensions();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const px = (x - left) / zoom, py = (y - top) / zoom;
    zoom = Math.max(1, Math.min(64, zoom + (event.deltaY < 0 ? 1 : -1)));
    panX = x - rect.width / 2 + options.editor().width * zoom / 2 - px * zoom;
    panY = y - rect.height / 2 + options.editor().height * zoom / 2 - py * zoom;
    refresh();
  }, { passive: false });
  const observer = new ResizeObserver(refresh);
  observer.observe(element);
  return {
    element, refresh, cancel, zoomBy,
    fit() {
      const rect = element.getBoundingClientRect(), editor = options.editor();
      zoom = Math.max(1, Math.min(32, Math.floor(Math.min((rect.width - 48) / editor.width, (rect.height - 48) / editor.height))));
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
