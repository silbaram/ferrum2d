import { readPixelAtlas, pixelAtlasRect, type PixelAtlasMetadata } from "./placementPixelAtlas";
import type { PixelDrawMask, PixelRepeat } from "./placementPixelDrawing";

/** Ferrum-owned editing source. Runtime assets contain flattened PNGs only. */
export const PIXEL_LIMITS = {
  side: 256, layers: 8, frames: 64, legacyFrames: 16, atlasSide: 2048, tags: 16, pixels: 2_097_152,
  documentBytes: 400_000,
  layerSourceBytes: 3 * 1024 * 1024,
  sourceBytes: 12 * 1024 * 1024,
  pngBytes: 16 * 1024 * 1024,
  historySteps: 64,
  historyBytes: 16 * 1024 * 1024,
} as const;
export type PixelColor = readonly [number, number, number, number];
export type PixelColorScope = "cel" | "selection" | "document";
export type PixelBatchTransform = { kind: "move"; dx: number; dy: number } | { kind: "flip-x" | "flip-y" };
export const PIXEL_CANVAS_ANCHORS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const;
export type PixelCanvasAnchor = typeof PIXEL_CANVAS_ANCHORS[number];
export interface PixelRegion { x: number; y: number; width: number; height: number; mask?: Uint8Array; }
export interface PixelBlock { width: number; height: number; pixels: Uint8Array; mask?: Uint8Array; }
/** UI-only selection membership; omitted mask means a full rectangle. */
export function pixelRegionContains(r: PixelRegion, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height && (!r.mask || r.mask[(y - r.y) * r.width + x - r.x] === 1);
}
interface PixelDocumentBase {
  format: "ferrum2d.pixel-document";
  name: string; width: number; height: number; colorSpace: "srgb";
  palette: string[];
}
export interface PixelDocumentV1 extends PixelDocumentBase {
  version: 1;
  frame: PixelFrameInfo;
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
  frame: PixelFrameInfo;
  /** Bottom to top. Selection and history are not serialized. */
  layers: PixelImageLayer[];
}
export interface PixelFrameInfo { id: string; durationMs: number; }
export type PixelLayerInfo = Omit<PixelImageLayer, "rgba">;
export interface PixelDocumentV3 extends PixelDocumentBase {
  version: 3;
  layers: PixelLayerInfo[];
  frames: (PixelFrameInfo & { cels: { layerId: string; rgba: string }[] })[];
}
/** A fixed external atlas. Pixels cover the entire image; rects never repack. */
export interface PixelDocumentV4 extends Omit<PixelDocumentV1, "version"> {
  version: 4;
  atlas: PixelAtlasMetadata;
}
export type PixelTagDirection = "forward" | "reverse" | "pingpong";
export interface PixelFrameTag {
  id: string; name: string; clipId: number; frameIds: string[]; loop: boolean; direction?: PixelTagDirection;
}
/** Tagged cels use a new version so older editors cannot silently discard clips. */
export interface PixelDocumentV5 extends Omit<PixelDocumentV3, "version"> {
  version: 5;
  tags: PixelFrameTag[];
  initialTag: string;
  /** Monotonic allocation; deleted clip IDs are never reused. */
  nextClipId: number;
}
/** Expanded cel sheets. The tag metadata group is either complete or absent. */
export interface PixelDocumentV6 extends Omit<PixelDocumentV3, "version"> {
  version: 6;
  tags?: PixelFrameTag[];
  initialTag?: string;
  nextClipId?: number;
}
/** Direction-aware clips; v1–v6 sources retain their original serialization. */
export interface PixelDocumentV7 extends Omit<PixelDocumentV5, "version"> { version: 7; }
export type PixelDocument = PixelDocumentV1 | PixelDocumentV2 | PixelDocumentV3 | PixelDocumentV4 | PixelDocumentV5 | PixelDocumentV6 | PixelDocumentV7;
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
/** Metadata-only validation; never serialize cel pixels for UI previews. */
export function readPixelTags(input: unknown, frames: readonly PixelFrameInfo[], maxFrames: number = PIXEL_LIMITS.frames, allowDirection = true): PixelFrameTag[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > PIXEL_LIMITS.tags) return fail("Pixel tags require 1–16 entries");
  const ids = new Set<string>(), names = new Set<string>(), clips = new Set<number>(), validFrames = new Set(frames.map(frame => frame.id));
  return Array.from(input, (raw: unknown) => {
    const value = object(raw), id = text(value.id), name = text(value.name);
    const clipId = integer(value.clipId, 0, 65535, "Invalid pixel clip ID");
    if (ids.has(id) || names.has(name) || clips.has(clipId)) fail("Duplicate pixel tag ID, name or clip ID");
    ids.add(id); names.add(name); clips.add(clipId);
    if (!Array.isArray(value.frameIds) || value.frameIds.length < 1 || value.frameIds.length > maxFrames ||
        value.frameIds.some(frame => typeof frame !== "string" || !validFrames.has(frame)) || new Set(value.frameIds).size !== value.frameIds.length)
      return fail(`Pixel tags must reference 1–${maxFrames} unique frames`);
    if (value.direction !== undefined && (!allowDirection || typeof value.direction !== "string" || !["forward", "reverse", "pingpong"].includes(value.direction)))
      fail("Invalid pixel tag direction");
    return { ...(value.direction !== undefined ? {direction: value.direction as PixelTagDirection} : {}), id, name, clipId, frameIds: value.frameIds.map((id: unknown) => text(id)), loop: boolean(value.loop) };
  });
}
export function pixelPaletteColors(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 256) return fail("Invalid pixel palette");
  return Array.from(value, (color: unknown) => typeof color === "string" && /^#[\da-f]{8}$/i.test(color) ? color : fail("Invalid pixel palette"));
}
export function readPixelDocument(input: string): PixelDocument {
  const size = new TextEncoder().encode(input).length;
  if (size > PIXEL_LIMITS.sourceBytes) fail("Pixel document exceeds the byte limit");
  const value = object(JSON.parse(input));
  if (value.format !== "ferrum2d.pixel-document" || (value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4 && value.version !== 5 && value.version !== 6 && value.version !== 7) || value.colorSpace !== "srgb")
    fail("Unsupported pixel document format or version");
  if ((value.version === 1 || value.version === 4) && size > PIXEL_LIMITS.documentBytes) fail("Pixel document exceeds the byte limit");
  if (value.version === 2 && size > PIXEL_LIMITS.layerSourceBytes) fail("Pixel document exceeds the byte limit");
  if (value.version !== 4 && value.atlas !== undefined) fail("Invalid pixel atlas version");
  if (value.version !== 3 && value.version !== 5 && value.version !== 6 && value.version !== 7 && value.frames !== undefined) fail("Invalid pixel frame version");
  if (value.version !== 5 && value.version !== 6 && value.version !== 7 && ["tags", "initialTag", "nextClipId"].some(key => value[key] !== undefined)) fail("Invalid pixel tag version");
  const width = integer(value.width, 1, PIXEL_LIMITS.side), height = integer(value.height, 1, PIXEL_LIMITS.side);
  const palette = pixelPaletteColors(value.palette);
  const common: PixelDocumentBase = {
    format: "ferrum2d.pixel-document", name: text(value.name), width, height, colorSpace: "srgb",
    palette,
  };
  const frameInfo = (raw: unknown): PixelFrameInfo => {
    const frame = object(raw);
    return { id: text(frame.id), durationMs: integer(frame.durationMs, 1, 60000, "Frame duration must be an integer from 1 to 60000") };
  };
  const expected = width * height * 4;
  if (value.version === 3 || value.version === 5 || value.version === 6 || value.version === 7) {
    const maxFrames = (value.version === 6 || value.version === 7) ? PIXEL_LIMITS.frames : PIXEL_LIMITS.legacyFrames;
    if (value.frame !== undefined || value.layer !== undefined || value.rgba !== undefined)
      fail("Invalid pixel frame version");
    if (!Array.isArray(value.layers) || value.layers.length < 1 || value.layers.length > PIXEL_LIMITS.layers)
      return fail("Image layers require 1–8 entries");
    if (!Array.isArray(value.frames) || value.frames.length < 1 || value.frames.length > maxFrames)
      return fail(`Pixel frames require 1–${maxFrames} entries`);
    if (width * height * value.layers.length * value.frames.length > PIXEL_LIMITS.pixels) fail("Pixel cel budget exceeded");
    const ids = new Set<string>();
    const layers = value.layers.map((raw: unknown) => {
      const layer = object(raw), id = text(layer.id);
      if (ids.has(id) || layer.rgba !== undefined) fail("Invalid image layer metadata");
      ids.add(id);
      return { id, name: text(layer.name), visible: boolean(layer.visible), locked: boolean(layer.locked) };
    });
    const frameIds = new Set<string>();
    const frames = value.frames.map((raw: unknown) => {
      const value = object(raw), info = frameInfo(raw);
      if (frameIds.has(info.id)) fail("Duplicate pixel frame ID");
      frameIds.add(info.id);
      if (!Array.isArray(value.cels) || value.cels.length !== layers.length) return fail("Pixel cels must match image layers");
      const cels = value.cels.map((raw: unknown, index: number) => {
        const cel = object(raw);
        if (cel.layerId !== layers[index].id) fail("Pixel cels must match image layers");
        return { layerId: layers[index].id, rgba: rgba(cel.rgba, expected) };
      });
      return { ...info, cels };
    });
    const result: PixelDocumentV3 = { ...common, version: 3, layers, frames };
    if (value.version === 3) return result;
    if (value.version === 6 && value.tags === undefined) {
      if (value.initialTag !== undefined || value.nextClipId !== undefined) fail("Invalid pixel tag references");
      return { ...result, version: 6 };
    }
    const tags = readPixelTags(value.tags, frames, maxFrames, value.version === 7);
    const initialTag = text(value.initialTag), nextClipId = integer(value.nextClipId, 1, 65536, "Invalid next pixel clip ID");
    if (!tags.some(tag => tag.id === initialTag) || tags.some(tag => tag.clipId >= nextClipId)) fail("Invalid pixel tag references");
    return { ...result, version: value.version === 7 ? 7 : value.version === 6 ? 6 : 5, tags, initialTag, nextClipId };
  }
  const frame = frameInfo(value.frame);
  if (value.version === 1 || value.version === 4) {
    if (value.layers !== undefined) fail("Invalid image layer version");
    const layer = object(value.layer);
    // Preserve the v1 property order used by existing immutable revision identities.
    const single: PixelDocumentV1 = { format: common.format, version: 1, name: common.name, width, height, colorSpace: common.colorSpace,
      layer: { id: text(layer.id), name: text(layer.name) }, frame, palette, rgba: rgba(value.rgba, expected) };
    return value.version === 4 ? { ...single, version: 4, atlas: readPixelAtlas(value.atlas, width, height) } : single;
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
  return { format: common.format, version: 2, name: common.name, width, height, colorSpace: "srgb", frame, palette, layers };
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
export function pixelFrames(document: PixelDocument): PixelFrameInfo[] {
  return (document.version === 3 || document.version === 5 || document.version === 6 || document.version === 7) ? document.frames.map(({id,durationMs}) => ({id,durationMs})) : [{...document.frame}];
}
function sourceLayers(document: PixelDocument, frameIndex = 0): LayerPixels[] {
  if (document.version === 1 || document.version === 4) return [{...document.layer,visible:true,locked:false,pixels:decodeRgba(document.rgba)}];
  if (document.version === 2) return document.layers.map(({rgba,...layer}) => ({...layer,pixels:decodeRgba(rgba)}));
  const frame = document.frames[frameIndex];
  if (!frame) return fail("Pixel frame not found");
  return document.layers.map((layer,index) => ({...layer,pixels:decodeRgba(frame.cels[index].rgba)}));
}
/** Near-square atlas; frame order is source order. Empty trailing cells remain zero RGBA. */
export function pixelAtlasLayout(document: Pick<PixelDocument, "width"|"height">, count: number) {
  integer(count,1,PIXEL_LIMITS.frames,"Pixel frames require 1–64 entries");
  const columns = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / columns);
  return {width:document.width*columns,height:document.height*rows,columns,
    frames:Array.from({length:count},(_,index) => ({u0:(index%columns)/columns,v0:Math.floor(index/columns)/rows,
      u1:(index%columns+1)/columns,v1:(Math.floor(index/columns)+1)/rows}))};
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
/** Flatten one frame; the bottom visible layer retains its transparent RGB. */
export function pixelBytes(document: PixelDocument, frameIndex = 0): Uint8Array { return composite(sourceLayers(document,frameIndex)); }
export function pixelAtlas(document: PixelDocument) {
  const layout=pixelAtlasLayout(document,pixelFrames(document).length),pixels=new Uint8Array(layout.width*layout.height*4);
  for(let i=0;i<layout.frames.length;i++) {
    const frame=pixelBytes(document,i),x=(i%layout.columns)*document.width,y=Math.floor(i/layout.columns)*document.height;
    for(let row=0;row<document.height;row++)pixels.set(frame.subarray(row*document.width*4,(row+1)*document.width*4),((y+row)*layout.width+x)*4);
  }
  return {...layout,pixels};
}
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((n,i) => n === b[i]);
interface FramePixels extends PixelFrameInfo { pixels: Uint8Array[]; }
interface ImageState { width: number; height: number; version: 1 | 2 | 3 | 4 | 5 | 6 | 7; palette: string[]; tags: PixelFrameTag[]; initialTag: string; nextClipId: number; layers: PixelLayerInfo[]; frames: FramePixels[]; selected: string; selectedFrame: string; }
function clone(state: ImageState): ImageState {
  return {...state,palette:[...state.palette],tags:structuredClone(state.tags),layers:state.layers.map(layer=>({...layer})),frames:state.frames.map(frame=>({...frame,pixels:frame.pixels.map(bytes=>bytes.slice())}))};
}
function same(a: ImageState, b: ImageState): boolean {
  return a.width===b.width && a.height===b.height && a.version===b.version && JSON.stringify(a.palette)===JSON.stringify(b.palette) && JSON.stringify([a.tags,a.initialTag,a.nextClipId])===JSON.stringify([b.tags,b.initialTag,b.nextClipId]) && JSON.stringify(a.layers)===JSON.stringify(b.layers) && a.frames.length===b.frames.length && a.frames.every((frame,i)=>{
    const other=b.frames[i];return frame.id===other.id && frame.durationMs===other.durationMs && frame.pixels.every((bytes,j)=>equal(bytes,other.pixels[j]));
  });
}
const stateBytes = (state: ImageState) => state.frames.reduce((sum,frame)=>sum+frame.pixels.reduce((n,bytes)=>n+bytes.byteLength,0),0);
function newId(prefix:string,ids:readonly string[]) {
  const id=prefix+"-"+Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16).padStart(8,"0")).join("");
  if(ids.includes(id))fail("Pixel ID creation failed");return id;
}
/** Pixel, layer and frame edits share one bounded history. Selection stays UI-only. */
export function createPixelEditor(source: PixelDocument) {
  const document=readPixelDocument(JSON.stringify(source)),first=sourceLayers(document);
  const layers=first.map(({pixels,...layer})=>layer),frames=pixelFrames(document).map((frame,index)=>({...frame,pixels:sourceLayers(document,index).map(layer=>layer.pixels)}));
  const tagged = document.version === 5 || document.version === 6 || document.version === 7 ? document : undefined;
  let state:ImageState={width:document.width,height:document.height,version:document.version,palette:[...document.palette],tags:structuredClone(tagged?.tags??[]),
    initialTag:tagged?.initialTag??"",nextClipId:tagged?.nextClipId??0,layers,frames,selected:[...layers].reverse().find(l=>l.visible&&!l.locked)?.id??layers.at(-1)!.id,selectedFrame:frames[0].id};
  let revision=0;
  let checkpoint=clone(state),pending:ImageState|undefined,dirtyCache:boolean|undefined=false;
  // Current frame plus up to eight onion neighbours (2.25 MiB at 256²); pan/zoom must not recompose every layer.
  const flattened=new Map<string,Uint8Array>();
  type Step={before:ImageState;after:ImageState;bytes:number};
  const undo:Step[]=[],redo:Step[]=[];
  const selectedLayer=()=>state.layers.find(l=>l.id===state.selected)!;
  const frameById=(id:string)=>state.frames.find(f=>f.id===id)??fail("Pixel frame not found");
  const currentFrame=()=>frameById(state.selectedFrame);
  const layerIndex=(id:string)=>{const i=state.layers.findIndex(l=>l.id===id);if(i<0)fail("Image layer not found");return i;};
  let atlasFrame = document.version === 4 ? document.atlas.frames[0].id : "";
  const atlasRegion = () => document.version === 4
    ? pixelAtlasRect(state.width, state.height, document.atlas.frames.find(frame => frame.id === atlasFrame)!.frame)
    : { x: 0, y: 0, width: state.width, height: state.height };
  let activeRegion = atlasRegion();
  const region = () => ({ ...activeRegion });
  const validPoint=(x:number,y:number)=>{const r=activeRegion;return Number.isInteger(x)&&Number.isInteger(y)&&x>=r.x&&y>=r.y&&x<r.x+r.width&&y<r.y+r.height;};
  const changed=()=>{if(document.version!==4&&(activeRegion.width!==state.width||activeRegion.height!==state.height))activeRegion={x:0,y:0,width:state.width,height:state.height};revision++;dirtyCache=undefined;flattened.clear();};
  function budget(layers=state.layers.length,frames=state.frames.length) {
    if(state.width*state.height*layers*frames>PIXEL_LIMITS.pixels)fail("Pixel cel budget exceeded");
  }
  function paintPixels() {
    const layer=selectedLayer();if(!layer.visible||layer.locked)fail("Show and unlock the image layer before painting");
    return currentFrame().pixels[layerIndex(layer.id)];
  }
  function bytes(id=state.selectedFrame) {
    let output=flattened.get(id);
    if(!output) {
      const frame=frameById(id);
      output=composite(state.layers.map((layer,index)=>({...layer,pixels:frame.pixels[index]})));
    }
    flattened.delete(id);flattened.set(id,output);
    if(flattened.size>9)flattened.delete(flattened.keys().next().value!);
    return output;
  }
  function begin(){if(pending)fail("Finish the pixel stroke first");paintPixels();pending=clone(state);}
  function cancel(){if(pending){state=pending;changed();}pending=undefined;}
  function commit(){
    if(!pending)return false;const before=pending;pending=undefined;if(same(before,state))return false;
    redo.length=0;const after=clone(state);undo.push({before,after,bytes:stateBytes(before)+stateBytes(after)});
    while(undo.length>PIXEL_LIMITS.historySteps||undo.reduce((n,s)=>n+s.bytes,0)>PIXEL_LIMITS.historyBytes)undo.shift();return true;
  }
  function mutate(run:()=>void, atlasAllowed=false){if(document.version===4&&!atlasAllowed)fail("Atlas layout is fixed. Edit pixels within a frame.");if(pending)fail("Finish the pixel stroke first");pending=clone(state);try{run();changed();return commit();}catch(error){cancel();throw error;}}
  const layerVersion=()=>{if(state.version===1)state.version=2;};
  const frameVersion=()=>{if(state.version===7)return;if(state.frames.length>PIXEL_LIMITS.legacyFrames)state.version=6;else if(state.version!==5&&state.version!==6)state.version=3;};
  function put(x:number,y:number,color:PixelColor){if(!pending)fail("Start a pixel transaction first");if(validPoint(x,y)){paintPixels().set(color,(y*state.width+x)*4);changed();}}
  function samplePixels(pixels:Uint8Array,x:number,y:number):PixelColor|undefined {if(!validPoint(x,y))return;const i=(y*state.width+x)*4;return [pixels[i],pixels[i+1],pixels[i+2],pixels[i+3]];}
  function createFrame(duplicate:boolean) {
    if(state.frames.length>=PIXEL_LIMITS.frames)fail("Pixel frame limit reached");budget(state.layers.length,state.frames.length+1);
    const current=currentFrame(),id=newId("frame",state.frames.map(f=>f.id)),pixels=current.pixels.map(bytes=>duplicate?bytes.slice():new Uint8Array(bytes.length));
    mutate(()=>{state.frames.splice(state.frames.indexOf(current)+1,0,{id,durationMs:current.durationMs,pixels});frameVersion();state.selectedFrame=id;});return id;
  }
  function checkRegion(rect: PixelRegion, inside = false) {
    const r = region();
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger) ||
        Math.abs(rect.x) > 1_048_576 || Math.abs(rect.y) > 1_048_576 ||
        rect.width < 1 || rect.height < 1 || rect.width > PIXEL_LIMITS.side || rect.height > PIXEL_LIMITS.side ||
        (rect.mask !== undefined && (!(rect.mask instanceof Uint8Array) || rect.mask.length !== rect.width * rect.height || rect.mask.some(v => v > 1))) ||
        (inside && (rect.x < r.x || rect.y < r.y || rect.x + rect.width > r.x + r.width || rect.y + rect.height > r.y + r.height)))
      fail("Invalid pixel selection region");
  }
  function regionPixels(rect: PixelRegion, pixels: Uint8Array, clear?: PixelRegion, target?: Uint8Array) {
    checkRegion(rect);
    if (!(pixels instanceof Uint8Array) || pixels.length !== rect.width * rect.height * 4)
      fail("Invalid pixel selection bytes");
    if (clear) checkRegion(clear, true);
    const output = (target ?? paintPixels()).slice(), r = region();
    if (clear) for (let y = clear.y; y < clear.y + clear.height; y++) for (let x = clear.x; x < clear.x + clear.width; x++)
      if (pixelRegionContains(clear, x, y)) output.fill(0, (y * state.width + x) * 4, (y * state.width + x + 1) * 4);
    for (let y = Math.max(rect.y, r.y); y < Math.min(rect.y + rect.height, r.y + r.height); y++) {
      const left = Math.max(rect.x, r.x), right = Math.min(rect.x + rect.width, r.x + r.width);
      if (right <= left) continue;
      for (let x = left; x < right; x++) if (pixelRegionContains(rect, x, y)) {
        const offset = ((y - rect.y) * rect.width + x - rect.x) * 4;
        output.set(pixels.subarray(offset, offset + 4), (y * state.width + x) * 4);
      }
    }
    return output;
  }
  function checkMask(mask: PixelDrawMask, color: PixelColor) {
    checkRegion(mask.region, true); pixelHex(color);
    if (!(mask.pixels instanceof Uint8Array) || mask.pixels.length !== mask.region.width * mask.region.height) fail("Invalid pixel drawing mask");
  }
  function drawMask(target: Uint8Array, mask: PixelDrawMask, color: PixelColor) {
    const r = mask.region; let edited = false;
    for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
      if (!mask.pixels[y * r.width + x]) continue;
      const offset = ((r.y + y) * state.width + r.x + x) * 4;
      if (target[offset] === color[0] && target[offset + 1] === color[1] && target[offset + 2] === color[2] && target[offset + 3] === color[3]) continue;
      target.set(color, offset); edited = true;
    }
    return edited;
  }
  function colorTargets(scope: PixelColorScope, clip?: PixelRegion) {
    if (!["cel", "selection", "document"].includes(scope)) fail("Invalid color replacement scope");
    if (scope === "document") {
      if (document.version === 4) fail("Atlas colors are limited to the selected frame");
      return state.frames.flatMap(frame => state.layers.flatMap((layer, index) => layer.visible && !layer.locked ? [{ pixels: frame.pixels[index], rect: region() }] : []));
    }
    if (scope === "selection") { if (!clip) fail("Select pixels before replacing colors"); checkRegion(clip!, true); }
    return [{ pixels: paintPixels(), rect: scope === "selection" ? clip! : region() }];
  }
  function visitColor(from: PixelColor, targets: ReturnType<typeof colorTargets>, to?: PixelColor) {
    let count = 0;
    for (const target of targets) for (let y = target.rect.y; y < target.rect.y + target.rect.height; y++) for (let x = target.rect.x; x < target.rect.x + target.rect.width; x++) {
      if (!pixelRegionContains(target.rect, x, y)) continue;
      const i = (y * state.width + x) * 4, pixels = target.pixels;
      if (pixels[i] !== from[0] || pixels[i + 1] !== from[1] || pixels[i + 2] !== from[2] || pixels[i + 3] !== from[3]) continue;
      count++; if (to) pixels.set(to, i);
    }
    return count;
  }
  function resizePlan(width: number, height: number, anchor: PixelCanvasAnchor) {
    integer(width, 1, PIXEL_LIMITS.side); integer(height, 1, PIXEL_LIMITS.side);
    if (document.version === 4) fail("Atlas layout is fixed. Edit pixels within a frame.");
    if (width * height * state.layers.length * state.frames.length > PIXEL_LIMITS.pixels) fail("Pixel cel budget exceeded");
    const index = PIXEL_CANVAS_ANCHORS.indexOf(anchor); if (index < 0) fail("Invalid canvas anchor");
    return { width, height, offsetX: Math.floor((width - state.width) * (index % 3) / 2), offsetY: Math.floor((height - state.height) * Math.floor(index / 3) / 2), cropped: width < state.width || height < state.height };
  }
  function resizedPixels(pixels: Uint8Array, plan: ReturnType<typeof resizePlan>) {
    const output = new Uint8Array(plan.width * plan.height * 4);
    const x = Math.max(0, -plan.offsetX), right = Math.min(state.width, plan.width - plan.offsetX);
    if (right <= x) return output;
    for (let y = Math.max(0, -plan.offsetY); y < Math.min(state.height, plan.height - plan.offsetY); y++) {
      output.set(pixels.subarray((y * state.width + x) * 4, (y * state.width + right) * 4), ((y + plan.offsetY) * plan.width + x + plan.offsetX) * 4);
    }
    return output;
  }
  function batchPlan(frameIds: readonly string[], layerId: string, clip: PixelRegion | undefined, operation: PixelBatchTransform) {
    if (!Array.isArray(frameIds) || frameIds.length < 1 || frameIds.length > PIXEL_LIMITS.frames || new Set(frameIds).size !== frameIds.length ||
        Array.from(frameIds).some(id => typeof id !== "string" || !state.frames.some(frame => frame.id === id))) fail("Invalid frame range");
    const layer = layerIndex(layerId), area: PixelRegion = clip ?? region(); checkRegion(area, true);
    if (!operation || !["move", "flip-x", "flip-y"].includes(operation.kind) || (operation.kind === "move" && ![operation.dx, operation.dy].every(v => Number.isSafeInteger(v) && Math.abs(v) <= 1_048_576))) fail("Invalid batch transform");
    const x = (px: number) => operation.kind === "flip-x" ? area.width - px - 1 : px;
    const y = (py: number) => operation.kind === "flip-y" ? area.height - py - 1 : py;
    const mask = area.mask && new Uint8Array(area.mask.length);
    if (mask) for (let py = 0; py < area.height; py++) for (let px = 0; px < area.width; px++) mask[y(py) * area.width + x(px)] = area.mask![py * area.width + px];
    const destination: PixelRegion = { x: area.x + (operation.kind === "move" ? operation.dx : 0), y: area.y + (operation.kind === "move" ? operation.dy : 0), width: area.width, height: area.height, ...(mask ? { mask } : {}) }; checkRegion(destination);
    let clipped = false;
    for (let py = 0; py < destination.height; py++) for (let px = 0; px < destination.width; px++)
      if ((!mask || mask[py * destination.width + px]) && !pixelRegionContains(region(), destination.x + px, destination.y + py)) clipped = true;
    const frames = state.frames.filter(frame => frameIds.includes(frame.id)), editable = state.layers[layer].visible && !state.layers[layer].locked;
    const changes = editable ? frames.map(frame => {
      const source = frame.pixels[layer], pixels = new Uint8Array(area.width * area.height * 4);
      for (let py = 0; py < area.height; py++) for (let px = 0; px < area.width; px++) {
        const offset = ((area.y + py) * state.width + area.x + px) * 4;
        pixels.set(source.subarray(offset, offset + 4), (y(py) * area.width + x(px)) * 4);
      }
      const next = regionPixels(destination, pixels, area, source); return { id: frame.id, next, changed: !equal(next, source) };
    }) : [];
    return { changes, layer, destination, clipped, skipped: editable ? [] : frames.map(frame => frame.id) };
  }
  return {
    revision:()=>revision,
    paintMask(mask: PixelDrawMask, color: PixelColor) {
      checkMask(mask, color); if (!pending) fail("Start a pixel transaction first");
      if (drawMask(paintPixels(), mask, color)) changed();
    },
    paintStrokeMask(mask: PixelDrawMask, color: PixelColor) {
      checkMask(mask, color);
      if (!pending || pending.selected !== state.selected || pending.selectedFrame !== state.selectedFrame) fail("Start a pixel transaction first");
      const target = paintPixels(), original = pending!.frames.find(frame => frame.id === state.selectedFrame)!.pixels[layerIndex(state.selected)];
      let edited = false;
      for (let y = 0; y < mask.region.height; y++) for (let x = 0; x < mask.region.width; x++) {
        const i = ((y + mask.region.y) * state.width + x + mask.region.x) * 4, selected = mask.pixels[y * mask.region.width + x];
        for (let c = 0; c < 4; c++) { const value = selected ? color[c] : original[i + c]; if (target[i + c] !== value) { target[i + c] = value; edited = true; } }
      }
      if (edited) changed();
    },
    previewPaint(mask: PixelDrawMask, color: PixelColor) {
      checkMask(mask, color); const next = paintPixels().slice(); drawMask(next, mask, color);
      return composite(state.layers.map((layer, index) => ({ ...layer, pixels: layer.id === state.selected ? next : currentFrame().pixels[index] })));
    },
    editPaint(mask: PixelDrawMask, color: PixelColor) {
      checkMask(mask, color); if (pending) fail("Finish the pixel stroke first");
      const target = paintPixels(), next = target.slice(); if (!drawMask(next, mask, color)) return false;
      begin(); try { currentFrame().pixels[layerIndex(state.selected)] = next; changed(); return commit(); }
      catch (error) { cancel(); throw error; }
    },
    get version(){return state.version;},get width(){return state.width;},get height(){return state.height;},name:document.name,get palette(){return [...state.palette];},begin,commit,cancel,region,
    setPalette(value: readonly string[]) {
      const next = pixelPaletteColors(value); if (JSON.stringify(next) === JSON.stringify(state.palette)) return false;
      return mutate(() => { state.palette = next; }, true);
    },
    countColor(from: PixelColor, scope: PixelColorScope, clip?: PixelRegion) { pixelHex(from); return visitColor(from, colorTargets(scope, clip)); },
    replaceColor(from: PixelColor, to: PixelColor, scope: PixelColorScope, clip?: PixelRegion) {
      pixelHex(from); pixelHex(to); const targets = colorTargets(scope, clip);
      if (from.every((value, i) => value === to[i]) || !visitColor(from, targets)) return false;
      return mutate(() => { visitColor(from, targets, to); }, true);
    },
    previewResize(width: number, height: number, anchor: PixelCanvasAnchor = "center") {
      const plan = resizePlan(width, height, anchor); return { ...plan, pixels: resizedPixels(bytes(), plan) };
    },
    resizeCanvas(width: number, height: number, anchor: PixelCanvasAnchor = "center") {
      const plan = resizePlan(width, height, anchor);
      if (width === state.width && height === state.height) return false;
      if (pending) fail("Finish the pixel stroke first");
      const frames = state.frames.map(frame => ({ ...frame, pixels: frame.pixels.map(pixels => resizedPixels(pixels, plan)) }));
      return mutate(() => { state.frames = frames; state.width = width; state.height = height; });
    },
    previewBatchTransform(frameIds: readonly string[], layerId: string, clip: PixelRegion | undefined, operation: PixelBatchTransform, previewFrameId?: string) {
      if (pending) fail("Finish the pixel stroke first");
      const plan = batchPlan(frameIds, layerId, clip, operation), id = previewFrameId ?? (frameIds.includes(state.selectedFrame) ? state.selectedFrame : frameIds[0]);
      if (!frameIds.includes(id)) fail("Invalid batch preview frame");
      const frame = frameById(id), replacement = plan.changes.find(change => change.id === id)?.next;
      const pixels = composite(state.layers.map((layer, i) => ({ ...layer, pixels: i === plan.layer && replacement ? replacement : frame.pixels[i] })));
      return { pixels, frameId: id, targetIds: plan.changes.map(change => change.id), skippedIds: [...plan.skipped], changedFrames: plan.changes.filter(change => change.changed).length, clipped: plan.clipped,
        area: { ...plan.destination, ...(plan.destination.mask ? { mask: plan.destination.mask.slice() } : {}) } };
    },
    batchTransform(frameIds: readonly string[], layerId: string, clip: PixelRegion | undefined, operation: PixelBatchTransform) {
      if (pending) fail("Finish the pixel stroke first");
      const plan = batchPlan(frameIds, layerId, clip, operation);
      if (!plan.changes.some(change => change.changed)) return false;
      return mutate(() => { for (const change of plan.changes) frameById(change.id).pixels[plan.layer] = change.next; }, true);
    },
    atlas:()=>document.version===4?structuredClone(document.atlas):undefined,
    selectedAtlasFrame:()=>atlasFrame,
    selectAtlasFrame(id:string){if(document.version!==4||!document.atlas.frames.some(frame=>frame.id===id))fail("Pixel frame not found");cancel();atlasFrame=id;activeRegion=atlasRegion();},
    active:()=>pending!==undefined,canPaint:()=>selectedLayer().visible&&!selectedLayer().locked,
    sample:(x:number,y:number,id?:string)=>samplePixels(bytes(id),x,y),bytes:(id?:string)=>bytes(id).slice(),
    readRegion(rect: PixelRegion): PixelBlock {
      checkRegion(rect, true);
      const source = currentFrame().pixels[layerIndex(state.selected)], pixels = new Uint8Array(rect.width * rect.height * 4);
      for (let y = 0; y < rect.height; y++) {
        const offset = ((rect.y + y) * state.width + rect.x) * 4;
        pixels.set(source.subarray(offset, offset + rect.width * 4), y * rect.width * 4);
      }
      return { width: rect.width, height: rect.height, pixels, ...(rect.mask ? { mask: rect.mask.slice() } : {}) };
    },
    previewRegion(rect: PixelRegion, pixels: Uint8Array, clear?: PixelRegion) {
      const next = regionPixels(rect, pixels, clear), current = currentFrame();
      return composite(state.layers.map((layer, index) => ({ ...layer, pixels: layer.id === state.selected ? next : current.pixels[index] })));
    },
    paintRegion(rect: PixelRegion, pixels: Uint8Array) {
      if (!pending) fail("Start a pixel transaction first");
      const next = regionPixels(rect, pixels); if (equal(next, paintPixels())) return;
      currentFrame().pixels[layerIndex(state.selected)] = next; changed();
    },
    editRegion(rect: PixelRegion, pixels: Uint8Array, clear?: PixelRegion) {
      const next = regionPixels(rect, pixels, clear);
      if (pending) fail("Finish the pixel stroke first");
      if (equal(next, paintPixels())) return false;
      begin();
      try { currentFrame().pixels[layerIndex(state.selected)] = next; changed(); return commit(); }
      catch (error) { cancel(); throw error; }
    },
    dirty:()=>dirtyCache??=!same(state,checkpoint),markExported(){checkpoint=clone(state);dirtyCache=false;},
    layers:()=>state.layers.map(layer=>({...layer})),selectedLayer:()=>state.selected,
    selectLayer(id:string){layerIndex(id);cancel();state.selected=id;},layerBytes(id:string){return currentFrame().pixels[layerIndex(id)].slice();},
    frames:()=>state.frames.map(({id,durationMs})=>({id,durationMs})),selectedFrame:()=>state.selectedFrame,
    selectFrame(id:string){frameById(id);cancel();state.selectedFrame=id;},
    tags:()=>structuredClone(state.tags),initialTag:()=>state.initialTag,
    addTag(name:string,frameIds:string[]) {
      if(state.tags.length>=PIXEL_LIMITS.tags)fail("Pixel tag limit reached");
      if(state.nextClipId>65535)fail("Pixel clip ID limit reached");
      const id=newId("tag",state.tags.map(tag=>tag.id));
      const tag={id,name,clipId:state.nextClipId,frameIds:[...frameIds],loop:true};
      readPixelTags([...state.tags,tag],state.frames);
      mutate(()=>{if(state.version!==6&&state.version!==7)state.version=5;state.tags.push(tag);state.nextClipId++;if(!state.initialTag)state.initialTag=id;});return id;
    },
    updateTag(id:string,update:Pick<PixelFrameTag,"name"|"frameIds"|"loop"|"direction">) {
      const index=state.tags.findIndex(tag=>tag.id===id);if(index<0)fail("Pixel tag not found");
      const tags=structuredClone(state.tags);tags[index]={...tags[index],name:update.name,loop:update.loop,frameIds:[...update.frameIds]};
      if(update.direction!==undefined) {
        if(update.direction==="forward")delete tags[index].direction;
        else tags[index].direction=update.direction;
      }
      readPixelTags(tags,state.frames);
      if(JSON.stringify(tags)===JSON.stringify(state.tags))return false;
      return mutate(()=>{state.tags=tags;if(tags.some(tag=>tag.direction&&tag.direction!=="forward"))state.version=7;});
    },
    removeTag(id:string) {
      if(!state.tags.some(tag=>tag.id===id))fail("Pixel tag not found");
      if(state.tags.length===1)fail("Keep at least one pixel tag");
      return mutate(()=>{state.tags=state.tags.filter(tag=>tag.id!==id);if(state.initialTag===id)state.initialTag=state.tags[0].id;});
    },
    setInitialTag(id:string) {
      if(!state.tags.some(tag=>tag.id===id))fail("Pixel tag not found");
      if(state.initialTag===id)return false;return mutate(()=>{state.initialTag=id;});
    },
    addFrame:()=>createFrame(false),duplicateFrame:()=>createFrame(true),
    setFrameDuration(id:string,durationMs:number){integer(durationMs,1,60000,"Frame duration must be an integer from 1 to 60000");if(frameById(id).durationMs===durationMs)return false;return mutate(()=>{frameVersion();frameById(id).durationMs=durationMs;});},
    moveFrame(id:string,direction:-1|1){
      if(direction!==-1&&direction!==1)fail("Invalid pixel frame direction");const from=state.frames.indexOf(frameById(id)),to=from+direction;
      if(to<0||to>=state.frames.length)return false;return mutate(()=>{frameVersion();[state.frames[from],state.frames[to]]=[state.frames[to],state.frames[from]];});
    },
    removeFrame(id:string){const frame=frameById(id);
      if(state.tags.some(tag=>tag.frameIds.includes(id)))fail("Remove the frame from its tags before deleting it");if(state.frames.length===1)fail("Keep at least one pixel frame");return mutate(()=>{const index=state.frames.indexOf(frame);state.frames.splice(index,1);frameVersion();if(state.selectedFrame===id)state.selectedFrame=state.frames[Math.min(index,state.frames.length-1)].id;});},
    addLayer(name="Layer") {
      text(name);if(state.layers.length>=PIXEL_LIMITS.layers)fail("Image layer limit reached");budget(state.layers.length+1);
      const id=newId("layer",state.layers.map(l=>l.id));
      mutate(()=>{layerVersion();state.layers.push({id,name,visible:true,locked:false});for(const frame of state.frames)frame.pixels.push(new Uint8Array(state.width*state.height*4));state.selected=id;});return id;
    },
    renameLayer(id:string,name:string){text(name);const layer=state.layers[layerIndex(id)];if(layer.name===name)return false;return mutate(()=>{layer.name=name;});},
    setLayerVisible(id:string,visible:boolean){boolean(visible);const layer=state.layers[layerIndex(id)];if(layer.visible===visible)return false;return mutate(()=>{layerVersion();layer.visible=visible;});},
    setLayerLocked(id:string,locked:boolean){boolean(locked);const layer=state.layers[layerIndex(id)];if(layer.locked===locked)return false;return mutate(()=>{layerVersion();layer.locked=locked;});},
    moveLayer(id:string,direction:-1|1){
      if(direction!==-1&&direction!==1)fail("Invalid image layer direction");const from=layerIndex(id),to=from+direction;if(to<0||to>=state.layers.length)return false;
      return mutate(()=>{layerVersion();[state.layers[from],state.layers[to]]=[state.layers[to],state.layers[from]];for(const frame of state.frames)[frame.pixels[from],frame.pixels[to]]=[frame.pixels[to],frame.pixels[from]];});
    },
    removeLayer(id:string){const index=layerIndex(id);if(state.layers.length===1)fail("Keep at least one image layer");return mutate(()=>{state.layers.splice(index,1);for(const frame of state.frames)frame.pixels.splice(index,1);layerVersion();if(state.selected===id)state.selected=state.layers[Math.min(index,state.layers.length-1)].id;});},
    document():PixelDocument {
      const common={format:document.format,name:document.name,width:state.width,height:state.height,colorSpace:document.colorSpace,palette:[...state.palette]},frame=state.frames[0];
      if(state.version===1||state.version===4){const layer=state.layers[0];return {...structuredClone(document) as PixelDocumentV1|PixelDocumentV4,width:state.width,height:state.height,palette:[...state.palette],layer:{id:layer.id,name:layer.name},frame:{id:frame.id,durationMs:frame.durationMs},rgba:base64(frame.pixels[0])};}
      if(state.version===2)return {format:document.format,version:2,name:document.name,width:state.width,height:state.height,colorSpace:"srgb",frame:{id:frame.id,durationMs:frame.durationMs},palette:[...state.palette],layers:state.layers.map((layer,i)=>({...layer,rgba:base64(frame.pixels[i])}))};
      const result:PixelDocumentV3={...common,version:3,layers:state.layers.map(layer=>({...layer})),frames:state.frames.map(frame=>({id:frame.id,durationMs:frame.durationMs,cels:state.layers.map((layer,i)=>({layerId:layer.id,rgba:base64(frame.pixels[i])}))}))};
      if(state.version===7)return {...result,version:7,tags:structuredClone(state.tags),initialTag:state.initialTag,nextClipId:state.nextClipId};
      if(state.version===6)return {...result,version:6,...(state.tags.length?{tags:structuredClone(state.tags),initialTag:state.initialTag,nextClipId:state.nextClipId}:{})};
      return state.version===5?{...result,version:5,tags:structuredClone(state.tags),initialTag:state.initialTag,nextClipId:state.nextClipId}:result;
    },
    history:()=>({undo:undo.length,redo:redo.length,bytes:[...undo,...redo].reduce((n,s)=>n+s.bytes,0)}),
    undo(){cancel();const step=undo.pop();if(step){state=clone(step.before);changed();redo.push(step);}},
    redo(){cancel();const step=redo.pop();if(step){state=clone(step.after);changed();undo.push(step);}},
    line(x0: number, y0: number, x1: number, y1: number, color: PixelColor) {
      pixelHex(color);
      if ([x0, y0, x1, y1].some(n => !Number.isInteger(n) || Math.abs(n) > 1_048_576))
        fail("Invalid stroke coordinates");
      // Clip before rasterizing so pointer capture outside the image has bounded cost.
      const dx = x1 - x0, dy = y1 - y0, r = region();
      let low = 0, high = 1;
      for (const [p, q] of [[-dx, x0 - r.x], [dx, r.x + r.width - 1 - x0], [-dy, y0 - r.y], [dy, r.y + r.height - 1 - y0]]) {
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
    fill(x: number, y: number, color: PixelColor, clip?: PixelRegion, repeat?: PixelRepeat) {
      pixelHex(color);
      if (repeat && (typeof repeat.x !== "boolean" || typeof repeat.y !== "boolean" || (document.version === 4 && (repeat.x || repeat.y)))) fail("Invalid repeat settings");
      if (clip) checkRegion(clip, true);
      if (!pending) fail("Start a pixel transaction first");
      const pixels = paintPixels();
      const target = samplePixels(pixels, x, y);
      const inClip = (px: number, py: number) => !clip || pixelRegionContains(clip, px, py);
      if (!target || !inClip(x, y) || target.every((n, i) => n === color[i])) return;
      // Enqueue each pixel at most once; neither recursion nor an unbounded work list.
      const queue = new Uint32Array(state.width * state.height);
      const visited = new Uint8Array(queue.length);
      let head = 0, tail = 0;
      const enqueue = (px: number, py: number) => {
        if (repeat?.x) px = activeRegion.x + ((px - activeRegion.x) % activeRegion.width + activeRegion.width) % activeRegion.width;
        if (repeat?.y) py = activeRegion.y + ((py - activeRegion.y) % activeRegion.height + activeRegion.height) % activeRegion.height;
        if (!validPoint(px, py) || !inClip(px, py)) return;
        const index = py * state.width + px;
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
        const index = queue[head++], px = index % state.width, py = Math.floor(index / state.width);
        put(px, py, color);
        enqueue(px - 1, py); enqueue(px + 1, py); enqueue(px, py - 1); enqueue(px, py + 1);
      }
    },
  };
}
