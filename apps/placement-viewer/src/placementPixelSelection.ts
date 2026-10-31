import type { createPixelEditor, PixelBlock, PixelRegion } from "./placementPixelDocument";

type Editor = ReturnType<typeof createPixelEditor>;
type Floating = { rect: PixelRegion; block: PixelBlock; clear?: PixelRegion; previous?: PixelRegion };
const copyRect = (rect?: PixelRegion) => rect && { ...rect };
const copyBlock = (block: PixelBlock): PixelBlock => ({ ...block, pixels: block.pixels.slice() });
export function intersectPixelRegion(a: PixelRegion, b: PixelRegion): PixelRegion | undefined {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x, height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}
/** UI selection and bounded internal clipboard. Only confirm/cut/delete call the document model. */
export function createPixelSelection(options: { editor(): Editor; canEdit(): boolean }) {
  let editor: Editor | undefined, stamp = "", selected: PixelRegion | undefined;
  let floating: Floating | undefined, clipboard: PixelBlock | undefined, preview: Uint8Array | undefined;
  function signature(value: Editor) {
    return JSON.stringify([value.revision(), value.selectedFrame(), value.selectedLayer(), value.selectedAtlasFrame()]);
  }
  function sync() {
    const current = options.editor(), next = signature(current);
    if (editor !== current || stamp !== next) {
      if (editor !== current) clipboard = undefined;
      selected = undefined; floating = undefined; preview = undefined;
      editor = current; stamp = next;
    }
    if (floating && (!options.canEdit() || !current.canPaint())) cancel();
    return current;
  }
  function cancel() {
    if (floating) selected = copyRect(floating.previous);
    floating = undefined; preview = undefined;
  }
  function editable() { return options.canEdit() && sync().canPaint(); }
  function bounds() { sync(); return copyRect(floating?.rect ?? selected); }
  function select(rect?: PixelRegion) {
    const current = sync(); cancel();
    if (rect && (![rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger) || rect.width < 1 || rect.height < 1))
      throw Error("Invalid pixel selection region");
    selected = rect ? intersectPixelRegion(rect, current.region()) : undefined;
  }
  function beginMove() {
    const current = sync();
    if (!editable() || (!selected && !floating)) return false;
    if (!floating) floating = { rect: { ...selected! }, block: current.readRegion(selected!), clear: { ...selected! }, previous: { ...selected! } };
    return true;
  }
  function copy() {
    const current = sync();
    if (!selected && !floating) return false;
    clipboard = floating ? copyBlock(floating.block) : current.readRegion(selected!);
    return true;
  }
  function remove() {
    const current = sync();
    if (!editable() || !selected || floating) return false;
    const rect = { ...selected };
    const changed = current.editRegion(rect, new Uint8Array(rect.width * rect.height * 4));
    stamp = signature(current); selected = rect;
    return changed;
  }
  return {
    sync, bounds, select, cancel, copy, remove,
    reset() { selected = undefined; floating = undefined; preview = undefined; clipboard = undefined; editor = undefined; stamp = ""; },
    all() { select(sync().region()); },
    clear() { sync(); floating = undefined; selected = undefined; preview = undefined; },
    pending() { sync(); return floating !== undefined; },
    hasClipboard() { sync(); return clipboard !== undefined; },
    editable,
    beginMove,
    moveBy(dx: number, dy: number) {
      if (![dx, dy].every(Number.isSafeInteger)) throw Error("Invalid pixel selection offset");
      const current = bounds(); if (!current) return false;
      const x = current.x + dx, y = current.y + dy;
      if (Math.abs(x) > 1_048_576 || Math.abs(y) > 1_048_576) throw Error("Invalid pixel selection offset");
      if (!beginMove()) return false;
      floating!.rect = { ...floating!.rect, x, y }; preview = undefined; return true;
    },
    cut() { sync(); if (!editable() || floating || !selected) return false; copy(); return remove(); },
    paste() {
      const current = sync();
      if (!editable() || !clipboard || floating) return false;
      const block = copyBlock(clipboard), anchor = selected ?? current.region();
      floating = { rect: { x: anchor.x, y: anchor.y, width: block.width, height: block.height }, block, previous: copyRect(selected) };
      preview = undefined; return true;
    },
    transform(operation: "flip-x" | "flip-y" | "rotate") {
      if (!beginMove()) return false;
      const source = floating!.block, rotate = operation === "rotate";
      const width = rotate ? source.height : source.width, height = rotate ? source.width : source.height;
      const pixels = new Uint8Array(width * height * 4);
      for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
        const nx = rotate ? source.height - y - 1 : operation === "flip-x" ? source.width - x - 1 : x;
        const ny = rotate ? x : operation === "flip-y" ? source.height - y - 1 : y;
        pixels.set(source.pixels.subarray((y * source.width + x) * 4, (y * source.width + x + 1) * 4), (ny * width + nx) * 4);
      }
      floating!.block = { width, height, pixels }; floating!.rect = { ...floating!.rect, width, height }; preview = undefined; return true;
    },
    clipped() {
      const current = sync(); if (!floating) return false;
      const visible = intersectPixelRegion(floating.rect, current.region());
      return !visible || visible.width !== floating.rect.width || visible.height !== floating.rect.height;
    },
    preview() {
      const current = sync();
      if (!floating) return undefined;
      return preview ??= current.previewRegion(floating.rect, floating.block.pixels, floating.clear);
    },
    confirm() {
      const current = sync();
      if (!floating || !editable()) return false;
      const pending = floating;
      const changed = current.editRegion(pending.rect, pending.block.pixels, pending.clear);
      floating = undefined; preview = undefined; selected = intersectPixelRegion(pending.rect, current.region()); stamp = signature(current);
      return changed;
    },
  };
}
