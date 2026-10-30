/** Ferrum-owned editing source. Runtime assets contain flattened PNGs only. */
export const PIXEL_LIMITS = {
  side: 256, layers: 8,
  documentBytes: 400_000,
  sourceBytes: 3 * 1024 * 1024,
  historySteps: 64,
  historyBytes: 16 * 1024 * 1024,
} as const;
export type PixelColor = readonly [number, number, number, number];
interface PixelDocumentBase {
  format: "ferrum2d.pixel-document";
  name: string; width: number; height: number; colorSpace: "srgb";
  frame: { id: string; durationMs: number };
  palette: string[];
}
export interface PixelDocumentV1 extends PixelDocumentBase {
  version: 1;
  layer: { id: string; name: string };
  rgba: string;
}
export interface PixelImageLayer {
  id: string; name: string; visible: boolean; locked: boolean;
  /** Row-major straight-alpha RGBA8, base64. */
  rgba: string;
}
export interface PixelDocumentV2 extends PixelDocumentBase {
  version: 2;
  /** Bottom to top. Selection and history are not serialized. */
  layers: PixelImageLayer[];
}
export type PixelDocument = PixelDocumentV1 | PixelDocumentV2;
export const PIXEL_PALETTE = [
  "#000000ff", "#ffffffff", "#6b7280ff", "#374151ff",
  "#ef4444ff", "#f97316ff", "#f5a742ff", "#fde047ff",
  "#84cc16ff", "#22c55eff", "#14b8a6ff", "#38bdf8ff",
  "#3b82f6ff", "#8b5cf6ff", "#ec4899ff", "#a16207ff",
];
const fail = (message: string): never => { throw Error(message); };
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : fail("Invalid pixel document");
function integer(value: unknown, min: number, max: number,
  message = "Pixel dimensions must be integers from 1 to 256"): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value : fail(message);
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim().length || value.length > 64)
    return fail("Pixel names require 1–64 characters");
  // Native JSON stores Unicode scalar values. Reject lone UTF-16 surrogates early.
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character.length === 1 && code >= 0xd800 && code <= 0xdfff)
      fail("Pixel names require well-formed Unicode");
  }
  return value;
}
function boolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : fail("Invalid image layer flags");
}
export function pixelColor(hex: string): PixelColor {
  if (!/^#[\da-f]{8}$/i.test(hex)) fail("Invalid RGBA color");
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16), parseInt(hex.slice(7, 9), 16)];
}
export function pixelHex(color: PixelColor): string {
  if (color.length !== 4 || color.some(n => !Number.isInteger(n) || n < 0 || n > 255))
    fail("Invalid RGBA color");
  return "#" + color.map(n => n.toString(16).padStart(2, "0")).join("");
}
function base64(bytes: Uint8Array): string {
  let value = "";
  for (let i = 0; i < bytes.length; i += 16384)
    value += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(value);
}
function decodeRgba(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, value => value.charCodeAt(0));
}
function rgba(value: unknown, expected: number): string {
  if (typeof value !== "string" || value.length !== 4 * Math.ceil(expected / 3) ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return fail("Invalid pixel byte length");
  let bytes: Uint8Array;
  try { bytes = decodeRgba(value); } catch { return fail("Invalid pixel encoding"); }
  if (bytes.length !== expected || base64(bytes) !== value) fail("Invalid pixel encoding");
  return value;
}
export function readPixelDocument(input: string): PixelDocument {
  const size = new TextEncoder().encode(input).length;
  if (size > PIXEL_LIMITS.sourceBytes) fail("Pixel document exceeds the byte limit");
  const value = object(JSON.parse(input));
  if (value.format !== "ferrum2d.pixel-document" || (value.version !== 1 && value.version !== 2) || value.colorSpace !== "srgb")
    fail("Unsupported pixel document format or version");
  if (value.version === 1 && size > PIXEL_LIMITS.documentBytes) fail("Pixel document exceeds the byte limit");
  const width = integer(value.width, 1, PIXEL_LIMITS.side), height = integer(value.height, 1, PIXEL_LIMITS.side);
  const frame = object(value.frame), paletteValue = value.palette;
  if (!Array.isArray(paletteValue) || paletteValue.length > 256) return fail("Invalid pixel palette");
  const palette = paletteValue.map((color: unknown) =>
    typeof color === "string" && /^#[\da-f]{8}$/i.test(color) ? color : fail("Invalid pixel palette"));
  const common: PixelDocumentBase = {
    format: "ferrum2d.pixel-document", name: text(value.name), width, height, colorSpace: "srgb",
    frame: { id: text(frame.id), durationMs: integer(frame.durationMs, 1, 60000, "Frame duration must be an integer from 1 to 60000") },
    palette,
  };
  const expected = width * height * 4;
  if (value.version === 1) {
    if (value.layers !== undefined) fail("Invalid image layer version");
    const layer = object(value.layer);
    // Preserve the v1 property order used by existing immutable revision identities.
    return { format: common.format, version: 1, name: common.name, width, height, colorSpace: "srgb",
      layer: { id: text(layer.id), name: text(layer.name) }, frame: common.frame, palette, rgba: rgba(value.rgba, expected) };
  }
  const layerValues = value.layers;
  if (value.layer !== undefined || value.rgba !== undefined || !Array.isArray(layerValues) ||
      layerValues.length < 1 || layerValues.length > PIXEL_LIMITS.layers) return fail("Image layers require 1–8 entries");
  const ids = new Set<string>();
  const layers = layerValues.map((raw: unknown) => {
    const layer = object(raw), id = text(layer.id);
    if (ids.has(id)) fail("Duplicate image layer ID");
    ids.add(id);
    return { id, name: text(layer.name), visible: boolean(layer.visible), locked: boolean(layer.locked), rgba: rgba(layer.rgba, expected) };
  });
  return { format: common.format, version: 2, name: common.name, width, height, colorSpace: "srgb", frame: common.frame, palette, layers };
}
export function newPixelDocument(width = 32, height = 32, name = "sprite"): PixelDocumentV1 {
  integer(width, 1, PIXEL_LIMITS.side); integer(height, 1, PIXEL_LIMITS.side);
  return { format: "ferrum2d.pixel-document", version: 1, name: text(name), width, height, colorSpace: "srgb",
    layer: { id: "layer-1", name: "Layer 1" }, frame: { id: "frame-1", durationMs: 100 },
    palette: [...PIXEL_PALETTE], rgba: base64(new Uint8Array(width * height * 4)) };
}
export function pixelDocumentFromRgba(width: number, height: number, name: string, pixels: Uint8Array): PixelDocumentV1 {
  const document = newPixelDocument(width, height, name);
  if (pixels.length !== width * height * 4) fail("Invalid pixel byte length");
  document.rgba = base64(pixels); return document;
}
interface LayerPixels { id: string; name: string; visible: boolean; locked: boolean; pixels: Uint8Array; }
function sourceLayers(document: PixelDocument): LayerPixels[] {
  return document.version === 1
    ? [{...document.layer,visible:true,locked:false,pixels:decodeRgba(document.rgba)}]
    : document.layers.map(({rgba,...layer}) => ({...layer,pixels:decodeRgba(rgba)}));
}
function composite(layers: readonly LayerPixels[]): Uint8Array {
  let output: Uint8Array | undefined;
  for (const layer of layers) {
    if (!layer.visible) continue;
    if (!output) { output = layer.pixels.slice(); continue; }
    for (let i = 0; i < output.length; i += 4) {
      const alpha = layer.pixels[i+3], previous = output[i+3];
      if (!alpha) continue;
      const denominator = alpha*255 + previous*(255-alpha);
      for (let c = 0; c < 3; c++) output[i+c] = Math.round((layer.pixels[i+c]*alpha*255 + output[i+c]*previous*(255-alpha))/denominator);
      output[i+3] = Math.round(denominator/255);
    }
  }
  return output ?? new Uint8Array(layers[0].pixels.length);
}
/** Flatten visible layers; the bottom visible layer retains its transparent RGB. */
export function pixelBytes(document: PixelDocument): Uint8Array { return composite(sourceLayers(document)); }
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((n,i) => n === b[i]);
interface ImageState { version: 1 | 2; layers: LayerPixels[]; selected: string; }
function clone(state: ImageState): ImageState { return {...state,layers:state.layers.map(layer => ({...layer,pixels:layer.pixels.slice()}))}; }
function same(a: ImageState, b: ImageState): boolean {
  return a.version === b.version && a.layers.length === b.layers.length && a.layers.every((l,i) => {
    const r=b.layers[i]; return l.id===r.id && l.name===r.name && l.visible===r.visible && l.locked===r.locked && equal(l.pixels,r.pixels);
  });
}
const stateBytes = (state: ImageState) => state.layers.reduce((n,l) => n+l.pixels.byteLength,0);
/** Shared bounded pixel/structure history. Layer selection is UI state only. */
export function createPixelEditor(source: PixelDocument) {
  const document = readPixelDocument(JSON.stringify(source)), layers = sourceLayers(document);
  let state: ImageState = {version:document.version,layers,selected:[...layers].reverse().find(l=>l.visible&&!l.locked)?.id ?? layers.at(-1)!.id};
  let checkpoint = clone(state), pending: ImageState | undefined, dirtyCache: boolean | undefined = false;
  let flattened: Uint8Array | undefined;
  type Step = { before: ImageState; after: ImageState; bytes: number };
  const undo: Step[] = [], redo: Step[] = [];
  const selectedLayer = () => state.layers.find(l=>l.id===state.selected)!;
  const validPoint = (x: number,y: number) => Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<document.width&&y<document.height;
  const changed = () => {dirtyCache=undefined;flattened=undefined;};
  function paintLayer() {
    const layer=selectedLayer();
    if (!layer.visible || layer.locked) fail("Show and unlock the image layer before painting");
    return layer;
  }
  function begin() { if(pending)fail("Finish the pixel stroke first");paintLayer();pending=clone(state); }
  function cancel() { if(pending){state=pending;changed();}pending=undefined; }
  function commit() {
    if(!pending)return false;
    const before=pending;pending=undefined;
    if(same(before,state))return false;
    redo.length=0;
    const after=clone(state);undo.push({before,after,bytes:stateBytes(before)+stateBytes(after)});
    while(undo.length>PIXEL_LIMITS.historySteps || undo.reduce((n,s)=>n+s.bytes,0)>PIXEL_LIMITS.historyBytes)undo.shift();
    return true;
  }
  function mutate(run:()=>void) {
    if(pending)fail("Finish the pixel stroke first");
    pending=clone(state);
    try {run();changed();return commit();} catch(error){cancel();throw error;}
  }
  function put(x:number,y:number,color:PixelColor) {
    if(!pending)fail("Start a pixel transaction first");
    if(validPoint(x,y)){paintLayer().pixels.set(color,(y*document.width+x)*4);changed();}
  }
  function samplePixels(pixels:Uint8Array,x:number,y:number):PixelColor|undefined {
    if(!validPoint(x,y))return;
    const i=(y*document.width+x)*4;return [pixels[i],pixels[i+1],pixels[i+2],pixels[i+3]];
  }
  function layerById(id:string) {return state.layers.find(l=>l.id===id) ?? fail("Image layer not found");}
  return {
    width:document.width,height:document.height,name:document.name,palette:[...document.palette],
    begin,commit,cancel,
    active:()=>pending!==undefined,
    canPaint:()=>selectedLayer().visible&&!selectedLayer().locked,
    sample:(x:number,y:number)=>samplePixels(flattened ??= composite(state.layers),x,y),
    dirty:()=>dirtyCache ??= !same(state,checkpoint),
    markExported(){checkpoint=clone(state);dirtyCache=false;},
    bytes:()=> (flattened ??= composite(state.layers)).slice(),
    layers:()=>state.layers.map(({pixels,...meta})=>({...meta})),
    selectedLayer:()=>state.selected,
    selectLayer(id:string){layerById(id);cancel();state.selected=id;},
    layerBytes(id:string){return layerById(id).pixels.slice();},
    addLayer(name="Layer") {
      text(name);if(state.layers.length>=PIXEL_LIMITS.layers)fail("Image layer limit reached");
      // IDs survive rename/order/history and do not recycle after delete/reopen.
      const id="layer-"+Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16).padStart(8,"0")).join("");
      if(state.layers.some(l=>l.id===id))fail("Image layer ID creation failed");
      mutate(()=>{state.version=2;state.layers.push({id,name,visible:true,locked:false,pixels:new Uint8Array(document.width*document.height*4)});state.selected=id;});return id;
    },
    renameLayer(id:string,name:string){text(name);if(layerById(id).name===name)return false;return mutate(()=>{layerById(id).name=name;});},
    setLayerVisible(id:string,visible:boolean){boolean(visible);if(layerById(id).visible===visible)return false;return mutate(()=>{state.version=2;layerById(id).visible=visible;});},
    setLayerLocked(id:string,locked:boolean){boolean(locked);if(layerById(id).locked===locked)return false;return mutate(()=>{state.version=2;layerById(id).locked=locked;});},
    moveLayer(id:string,direction:-1|1){
      if(direction!==-1&&direction!==1)fail("Invalid image layer direction");
      const from=state.layers.findIndex(l=>l.id===id);layerById(id);const to=from+direction;
      if(to<0||to>=state.layers.length)return false;
      return mutate(()=>{state.version=2;[state.layers[from],state.layers[to]]=[state.layers[to],state.layers[from]];});
    },
    removeLayer(id:string){
      layerById(id);if(state.layers.length===1)fail("Keep at least one image layer");
      return mutate(()=>{const index=state.layers.findIndex(l=>l.id===id);state.layers.splice(index,1);state.version=2;
        if(state.selected===id)state.selected=state.layers[Math.min(index,state.layers.length-1)].id;});
    },
    document():PixelDocument {
      if(state.version===1){const layer=state.layers[0];return {...structuredClone(document) as PixelDocumentV1,layer:{id:layer.id,name:layer.name},rgba:base64(layer.pixels)};}
      return {format:document.format,version:2,name:document.name,width:document.width,height:document.height,colorSpace:"srgb",
        frame:{...document.frame},palette:[...document.palette],layers:state.layers.map(({pixels,...layer})=>({...layer,rgba:base64(pixels)}))};
    },
    history:()=>({undo:undo.length,redo:redo.length,bytes:[...undo,...redo].reduce((n,s)=>n+s.bytes,0)}),
    undo(){cancel();const step=undo.pop();if(step){state=clone(step.before);changed();redo.push(step);}},
    redo(){cancel();const step=redo.pop();if(step){state=clone(step.after);changed();undo.push(step);}},
    line(x0: number, y0: number, x1: number, y1: number, color: PixelColor) {
      pixelHex(color);
      if ([x0, y0, x1, y1].some(n => !Number.isInteger(n) || Math.abs(n) > 1_048_576))
        fail("Invalid stroke coordinates");
      // Clip before rasterizing so pointer capture outside the image has bounded cost.
      const dx = x1 - x0, dy = y1 - y0;
      let low = 0, high = 1;
      for (const [p, q] of [[-dx, x0], [dx, document.width - 1 - x0], [-dy, y0], [dy, document.height - 1 - y0]]) {
        if (p === 0) { if (q < 0) return; continue; }
        const t = q / p;
        if (p < 0) low = Math.max(low, t); else high = Math.min(high, t);
        if (low > high) return;
      }
      let x = Math.round(x0 + dx * low), y = Math.round(y0 + dy * low);
      const endX = Math.round(x0 + dx * high), endY = Math.round(y0 + dy * high);
      const ax = Math.abs(endX - x), ay = -Math.abs(endY - y);
      const sx = x < endX ? 1 : -1, sy = y < endY ? 1 : -1;
      let error = ax + ay;
      for (;;) {
        put(x, y, color);
        if (x === endX && y === endY) break;
        const twice = 2 * error;
        if (twice >= ay) { error += ay; x += sx; }
        if (twice <= ax) { error += ax; y += sy; }
      }
    },
    fill(x: number, y: number, color: PixelColor) {
      pixelHex(color);
      if (!pending) fail("Start a pixel transaction first");
      const pixels = paintLayer().pixels;
      const target = samplePixels(pixels, x, y);
      if (!target || target.every((n, i) => n === color[i])) return;
      // Enqueue each pixel at most once; neither recursion nor an unbounded work list.
      const queue = new Uint32Array(document.width * document.height);
      const visited = new Uint8Array(queue.length);
      let head = 0, tail = 0;
      const enqueue = (px: number, py: number) => {
        if (!validPoint(px, py)) return;
        const index = py * document.width + px;
        if (visited[index]) return;
        visited[index] = 1;
        const offset = index * 4;
        const same = target[3] === 0
          ? pixels[offset + 3] === 0
          : target.every((n, i) => n === pixels[offset + i]);
        if (same) queue[tail++] = index;
      };
      enqueue(x, y);
      while (head < tail) {
        const index = queue[head++], px = index % document.width, py = Math.floor(index / document.width);
        put(px, py, color);
        enqueue(px - 1, py); enqueue(px + 1, py); enqueue(px, py - 1); enqueue(px, py + 1);
      }
    },
  };
}
