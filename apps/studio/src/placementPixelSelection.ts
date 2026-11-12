import { pixelRegionContains, type createPixelEditor, type PixelBlock, type PixelRegion } from "./placementPixelDocument";
import { clipPixelArea, copyPixelArea, combinePixelAreas, colorPixelArea, polygonPixelArea, type PixelSelectionOperation } from "./placementPixelMask";
import { transformPixelBlock, type PixelTransform } from "./placementPixelTransform";

type Editor = ReturnType<typeof createPixelEditor>;
type Floating = { rect: PixelRegion; block: PixelBlock; clear?: PixelRegion; previous?: PixelRegion };
const copyBlock = (block: PixelBlock): PixelBlock => ({ ...block, pixels: block.pixels.slice(), ...(block.mask ? { mask: block.mask.slice() } : {}) });
export function intersectPixelRegion(a: PixelRegion, b: PixelRegion): PixelRegion | undefined { return clipPixelArea(a, b); }
function clippedPixels(rect: PixelRegion, domain: PixelRegion) {
  if (rect.mask) return rect.mask.some((selected, i) => !!selected && !pixelRegionContains(domain, rect.x + i % rect.width, rect.y + Math.floor(i / rect.width)));
  return rect.x < domain.x || rect.y < domain.y || rect.x + rect.width > domain.x + domain.width || rect.y + rect.height > domain.y + domain.height;
}
/** UI selection and bounded internal clipboard. Only confirmed pixel operations mutate the source. */
export function createPixelSelection(options: { editor(): Editor; canEdit(): boolean }) {
  let editor: Editor | undefined, stamp = "", selected: PixelRegion | undefined;
  let floating: Floating | undefined, clipboard: PixelBlock | undefined, preview: Uint8Array | undefined, sequence = 0;
  function signature(value: Editor) { return JSON.stringify([value.revision(), value.selectedFrame(), value.selectedLayer(), value.selectedAtlasFrame()]); }
  function sync() {
    const current = options.editor(), next = signature(current);
    if (editor !== current || stamp !== next) {
      if (editor !== current) clipboard = undefined;
      selected = undefined; floating = undefined; preview = undefined; editor = current; stamp = next; sequence++;
    }
    if (floating && (!options.canEdit() || !current.canPaint())) cancel();
    return current;
  }
  function cancel() {
    if (floating) { selected = copyPixelArea(floating.previous); sequence++; }
    floating = undefined; preview = undefined;
  }
  function editable() { return options.canEdit() && sync().canPaint(); }
  function area() { sync(); return copyPixelArea(floating?.rect ?? selected); }
  function bounds() { sync(); const rect = floating?.rect ?? selected; return rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; }
  function select(rect?: PixelRegion, operation: PixelSelectionOperation = "replace", base?: { area?: PixelRegion }) {
    const current = sync(), next = rect ? clipPixelArea(rect, current.region()) : undefined;
    const combined = combinePixelAreas(base ? base.area : selected, next, operation, current.region());
    cancel(); selected = combined; sequence++;
  }
  function beginMove() {
    const current = sync(); if (!editable() || (!selected && !floating)) return false;
    if (!floating) { floating = { rect: copyPixelArea(selected!)!, block: current.readRegion(selected!), clear: copyPixelArea(selected!), previous: copyPixelArea(selected!) }; sequence++; }
    return true;
  }
  function copy() {
    const current = sync(); if (!selected && !floating) return false;
    clipboard = floating ? copyBlock(floating.block) : current.readRegion(selected!); return true;
  }
  function remove() {
    const current = sync(); if (!editable() || !selected || floating) return false;
    const rect = copyPixelArea(selected)!;
    const changed = current.editRegion(rect, new Uint8Array(rect.width * rect.height * 4));
    stamp = signature(current); selected = rect; sequence++; return changed;
  }
  return {
    sync, bounds, area, select, cancel, copy, remove,
    version() { sync(); return sequence; },
    contains(x: number, y: number) { sync(); const r = floating?.rect ?? selected; return !!r && pixelRegionContains(r, x, y); },
    selectColor(x: number, y: number, tolerance: number, connected: boolean, diagonal: boolean, operation: PixelSelectionOperation) {
      const current = sync(); select(colorPixelArea(current.layerBytes(current.selectedLayer()), current.width, current.height, current.region(), x, y, tolerance, connected, diagonal), operation);
    },
    selectPath(points: readonly { x: number; y: number }[], operation: PixelSelectionOperation, previous?: PixelRegion) {
      select(polygonPixelArea(sync().region(), points), operation, { area: previous });
    },
    reset() { selected = undefined; floating = undefined; preview = undefined; clipboard = undefined; editor = undefined; stamp = ""; sequence++; },
    all() { select(sync().region()); },
    clear() { sync(); floating = undefined; selected = undefined; preview = undefined; sequence++; },
    pending() { sync(); return floating !== undefined; },
    hasClipboard() { sync(); return clipboard !== undefined; },
    editable, beginMove,
    beginFreeTransform() {
      const current = sync();
      if (!editable() || current.active() || (!selected && !floating)) throw Error("Select editable pixels before transforming");
      const rect = copyPixelArea(floating?.rect ?? selected)!;
      const source = floating ? copyBlock(floating.block) : current.readRegion(rect);
      const clear = copyPixelArea(floating ? floating.clear : selected), version = sequence;
      let closed = false;
      const valid = () => !closed && sync() === current && sequence === version && options.canEdit() && current.canPaint() && !current.active();
      function plan(settings: PixelTransform) {
        if (!valid()) throw Error("Pixel transform context changed");
        const block = transformPixelBlock(source, settings);
        const next: PixelRegion = { x: rect.x + Math.floor((rect.width - block.width) / 2), y: rect.y + Math.floor((rect.height - block.height) / 2),
          width: block.width, height: block.height, ...(block.mask ? { mask: block.mask } : {}) };
        return { block, rect: next, clipped: clippedPixels(next, current.region()) };
      }
      return {
        valid, cancel() { closed = true; },
        preview(settings: PixelTransform) {
          const value = plan(settings);
          return { width: value.block.width, height: value.block.height, clipped: value.clipped, canvasWidth: current.width, canvasHeight: current.height,
            pixels: current.previewRegion(value.rect, value.block.pixels, clear) };
        },
        apply(settings: PixelTransform) {
          const value = plan(settings), changed = current.editRegion(value.rect, value.block.pixels, clear);
          closed = true; floating = undefined; preview = undefined; selected = clipPixelArea(value.rect, current.region()); stamp = signature(current); sequence++;
          return changed;
        },
      };
    },
    moveBy(dx: number, dy: number) {
      if (![dx, dy].every(Number.isSafeInteger)) throw Error("Invalid pixel selection offset");
      const current = area(); if (!current) return false;
      const x = current.x + dx, y = current.y + dy;
      if (Math.abs(x) > 1_048_576 || Math.abs(y) > 1_048_576) throw Error("Invalid pixel selection offset");
      if (!beginMove()) return false;
      floating!.rect = { ...floating!.rect, x, y }; preview = undefined; sequence++; return true;
    },
    cut() { sync(); if (!editable() || floating || !selected) return false; copy(); return remove(); },
    paste() {
      const current = sync(); if (!editable() || !clipboard || floating) return false;
      const block = copyBlock(clipboard), anchor = selected ?? current.region();
      floating = { rect: { x: anchor.x, y: anchor.y, width: block.width, height: block.height, ...(block.mask ? { mask: block.mask.slice() } : {}) }, block, previous: copyPixelArea(selected) };
      preview = undefined; sequence++; return true;
    },
    transform(operation: "flip-x" | "flip-y" | "rotate") {
      if (!beginMove()) return false;
      const source = floating!.block, rotate = operation === "rotate";
      const width = rotate ? source.height : source.width, height = rotate ? source.width : source.height;
      const pixels = new Uint8Array(width * height * 4), mask = source.mask && new Uint8Array(width * height);
      for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
        const nx = rotate ? source.height - y - 1 : operation === "flip-x" ? source.width - x - 1 : x;
        const ny = rotate ? x : operation === "flip-y" ? source.height - y - 1 : y;
        pixels.set(source.pixels.subarray((y * source.width + x) * 4, (y * source.width + x + 1) * 4), (ny * width + nx) * 4);
        if (mask) mask[ny * width + nx] = source.mask![y * source.width + x];
      }
      floating!.block = { width, height, pixels, ...(mask ? { mask } : {}) };
      floating!.rect = { ...floating!.rect, width, height, ...(mask ? { mask: mask.slice() } : {}) }; preview = undefined; sequence++; return true;
    },
    clipped() {
      const current = sync(); if (!floating) return false;
      return clippedPixels(floating.rect, current.region());
    },
    preview() {
      const current = sync(); if (!floating) return undefined;
      return preview ??= current.previewRegion(floating.rect, floating.block.pixels, floating.clear);
    },
    confirm() {
      const current = sync(); if (!floating || !editable()) return false;
      const pending = floating, changed = current.editRegion(pending.rect, pending.block.pixels, pending.clear);
      floating = undefined; preview = undefined; selected = clipPixelArea(pending.rect, current.region()); stamp = signature(current); sequence++; return changed;
    },
  };
}
