import { readPixelAtlas, pixelAtlasRect, type PixelAtlasMetadata } from "./placementPixelAtlas";

/** Ferrum-owned editing source. Runtime assets contain flattened PNGs only. */
export const PIXEL_LIMITS = {
  side: 256, layers: 8, frames: 16, tags: 16, pixels: 2_097_152,
  documentBytes: 400_000,
  layerSourceBytes: 3 * 1024 * 1024,
  sourceBytes: 12 * 1024 * 1024,
  pngBytes: 8 * 1024 * 1024,
  historySteps: 64,
  historyBytes: 16 * 1024 * 1024,
} as const;
export type PixelColor = readonly [number, number, number, number];
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
export interface PixelFrameTag {
  id: string; name: string; clipId: number; frameIds: string[]; loop: boolean;
}
/** Tagged cels use a new version so older editors cannot silently discard clips. */
export interface PixelDocumentV5 extends Omit<PixelDocumentV3, "version"> {
  version: 5;
  tags: PixelFrameTag[];
  initialTag: string;
  /** Monotonic allocation; deleted clip IDs are never reused. */
  nextClipId: number;
}
export type PixelDocument = PixelDocumentV1 | PixelDocumentV2 | PixelDocumentV3 | PixelDocumentV4 | PixelDocumentV5;
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
export function readPixelTags(input: unknown, frames: readonly PixelFrameInfo[]): PixelFrameTag[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > PIXEL_LIMITS.tags) return fail("Pixel tags require 1–16 entries");
  const ids = new Set<string>(), names = new Set<string>(), clips = new Set<number>(), validFrames = new Set(frames.map(frame => frame.id));
  return input.map((raw: unknown) => {
    const value = object(raw), id = text(value.id), name = text(value.name);
    const clipId = integer(value.clipId, 0, 65535, "Invalid pixel clip ID");
    if (ids.has(id) || names.has(name) || clips.has(clipId)) fail("Duplicate pixel tag ID, name or clip ID");
    ids.add(id); names.add(name); clips.add(clipId);
    if (!Array.isArray(value.frameIds) || value.frameIds.length < 1 || value.frameIds.length > PIXEL_LIMITS.frames ||
        value.frameIds.some(frame => typeof frame !== "string" || !validFrames.has(frame)) || new Set(value.frameIds).size !== value.frameIds.length)
      return fail("Pixel tags must reference 1–16 unique frames");
    return { id, name, clipId, frameIds: value.frameIds.map((id: unknown) => text(id)), loop: boolean(value.loop) };
  });
}
export function readPixelDocument(input: string): PixelDocument {
  const size = new TextEncoder().encode(input).length;
  if (size > PIXEL_LIMITS.sourceBytes) fail("Pixel document exceeds the byte limit");
  const value = object(JSON.parse(input));
  if (value.format !== "ferrum2d.pixel-document" || (value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4 && value.version !== 5) || value.colorSpace !== "srgb")
    fail("Unsupported pixel document format or version");
  if ((value.version === 1 || value.version === 4) && size > PIXEL_LIMITS.documentBytes) fail("Pixel document exceeds the byte limit");
  if (value.version === 2 && size > PIXEL_LIMITS.layerSourceBytes) fail("Pixel document exceeds the byte limit");
  if (value.version !== 4 && value.atlas !== undefined) fail("Invalid pixel atlas version");
  if (value.version !== 3 && value.version !== 5 && value.frames !== undefined) fail("Invalid pixel frame version");
  if (value.version !== 5 && ["tags", "initialTag", "nextClipId"].some(key => value[key] !== undefined)) fail("Invalid pixel tag version");
  const width = integer(value.width, 1, PIXEL_LIMITS.side), height = integer(value.height, 1, PIXEL_LIMITS.side);
  const paletteValue = value.palette;
  if (!Array.isArray(paletteValue) || paletteValue.length > 256) return fail("Invalid pixel palette");
  const palette = paletteValue.map((color: unknown) =>
    typeof color === "string" && /^#[\da-f]{8}$/i.test(color) ? color : fail("Invalid pixel palette"));
  const common: PixelDocumentBase = {
    format: "ferrum2d.pixel-document", name: text(value.name), width, height, colorSpace: "srgb",
    palette,
  };
  const frameInfo = (raw: unknown): PixelFrameInfo => {
    const frame = object(raw);
    return { id: text(frame.id), durationMs: integer(frame.durationMs, 1, 60000, "Frame duration must be an integer from 1 to 60000") };
  };
  const expected = width * height * 4;
  if (value.version === 3 || value.version === 5) {
    if (value.frame !== undefined || value.layer !== undefined || value.rgba !== undefined)
      fail("Invalid pixel frame version");
    if (!Array.isArray(value.layers) || value.layers.length < 1 || value.layers.length > PIXEL_LIMITS.layers)
      return fail("Image layers require 1–8 entries");
    if (!Array.isArray(value.frames) || value.frames.length < 1 || value.frames.length > PIXEL_LIMITS.frames)
      return fail("Pixel frames require 1–16 entries");
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
    const tags = readPixelTags(value.tags, frames);
    const initialTag = text(value.initialTag), nextClipId = integer(value.nextClipId, 1, 65536, "Invalid next pixel clip ID");
    if (!tags.some(tag => tag.id === initialTag) || tags.some(tag => tag.clipId >= nextClipId)) fail("Invalid pixel tag references");
    return { ...result, version: 5, tags, initialTag, nextClipId };
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
  return (document.version === 3 || document.version === 5) ? document.frames.map(({id,durationMs}) => ({id,durationMs})) : [{...document.frame}];
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
  integer(count,1,PIXEL_LIMITS.frames,"Pixel frames require 1–16 entries");
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
interface ImageState { version: 1 | 2 | 3 | 4 | 5; tags: PixelFrameTag[]; initialTag: string; nextClipId: number; layers: PixelLayerInfo[]; frames: FramePixels[]; selected: string; selectedFrame: string; }
function clone(state: ImageState): ImageState {
  return {...state,tags:structuredClone(state.tags),layers:state.layers.map(layer=>({...layer})),frames:state.frames.map(frame=>({...frame,pixels:frame.pixels.map(bytes=>bytes.slice())}))};
}
function same(a: ImageState, b: ImageState): boolean {
  return a.version===b.version && JSON.stringify([a.tags,a.initialTag,a.nextClipId])===JSON.stringify([b.tags,b.initialTag,b.nextClipId]) && JSON.stringify(a.layers)===JSON.stringify(b.layers) && a.frames.length===b.frames.length && a.frames.every((frame,i)=>{
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
  let state:ImageState={version:document.version,tags:document.version===5?structuredClone(document.tags):[],
    initialTag:document.version===5?document.initialTag:"",nextClipId:document.version===5?document.nextClipId:0,layers,frames,selected:[...layers].reverse().find(l=>l.visible&&!l.locked)?.id??layers.at(-1)!.id,selectedFrame:frames[0].id};
  let revision=0;
  let checkpoint=clone(state),pending:ImageState|undefined,dirtyCache:boolean|undefined=false;
  // Current frame plus two onion neighbours; pan/zoom must not recompose every layer.
  const flattened=new Map<string,Uint8Array>();
  type Step={before:ImageState;after:ImageState;bytes:number};
  const undo:Step[]=[],redo:Step[]=[];
  const selectedLayer=()=>state.layers.find(l=>l.id===state.selected)!;
  const frameById=(id:string)=>state.frames.find(f=>f.id===id)??fail("Pixel frame not found");
  const currentFrame=()=>frameById(state.selectedFrame);
  const layerIndex=(id:string)=>{const i=state.layers.findIndex(l=>l.id===id);if(i<0)fail("Image layer not found");return i;};
  let atlasFrame = document.version === 4 ? document.atlas.frames[0].id : "";
  const atlasRegion = () => document.version === 4
    ? pixelAtlasRect(document.width, document.height, document.atlas.frames.find(frame => frame.id === atlasFrame)!.frame)
    : { x: 0, y: 0, width: document.width, height: document.height };
  let activeRegion = atlasRegion();
  const region = () => ({ ...activeRegion });
  const validPoint=(x:number,y:number)=>{const r=activeRegion;return Number.isInteger(x)&&Number.isInteger(y)&&x>=r.x&&y>=r.y&&x<r.x+r.width&&y<r.y+r.height;};
  const changed=()=>{revision++;dirtyCache=undefined;flattened.clear();};
  function budget(layers=state.layers.length,frames=state.frames.length) {
    if(document.width*document.height*layers*frames>PIXEL_LIMITS.pixels)fail("Pixel cel budget exceeded");
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
    if(flattened.size>3)flattened.delete(flattened.keys().next().value!);
    return output;
  }
  function begin(){if(pending)fail("Finish the pixel stroke first");paintPixels();pending=clone(state);}
  function cancel(){if(pending){state=pending;changed();}pending=undefined;}
  function commit(){
    if(!pending)return false;const before=pending;pending=undefined;if(same(before,state))return false;
    redo.length=0;const after=clone(state);undo.push({before,after,bytes:stateBytes(before)+stateBytes(after)});
    while(undo.length>PIXEL_LIMITS.historySteps||undo.reduce((n,s)=>n+s.bytes,0)>PIXEL_LIMITS.historyBytes)undo.shift();return true;
  }
  function mutate(run:()=>void){if(document.version===4)fail("Atlas layout is fixed. Edit pixels within a frame.");if(pending)fail("Finish the pixel stroke first");pending=clone(state);try{run();changed();return commit();}catch(error){cancel();throw error;}}
  const layerVersion=()=>{if(state.version===1)state.version=2;};
  const frameVersion=()=>{if(state.version!==5)state.version=3;};
  function put(x:number,y:number,color:PixelColor){if(!pending)fail("Start a pixel transaction first");if(validPoint(x,y)){paintPixels().set(color,(y*document.width+x)*4);changed();}}
  function samplePixels(pixels:Uint8Array,x:number,y:number):PixelColor|undefined {if(!validPoint(x,y))return;const i=(y*document.width+x)*4;return [pixels[i],pixels[i+1],pixels[i+2],pixels[i+3]];}
  function createFrame(duplicate:boolean) {
    if(state.frames.length>=PIXEL_LIMITS.frames)fail("Pixel frame limit reached");budget(state.layers.length,state.frames.length+1);
    const current=currentFrame(),id=newId("frame",state.frames.map(f=>f.id)),pixels=current.pixels.map(bytes=>duplicate?bytes.slice():new Uint8Array(bytes.length));
    mutate(()=>{frameVersion();state.frames.splice(state.frames.indexOf(current)+1,0,{id,durationMs:current.durationMs,pixels});state.selectedFrame=id;});return id;
  }
  return {
    revision:()=>revision,
    width:document.width,height:document.height,name:document.name,palette:[...document.palette],begin,commit,cancel,region,
    atlas:()=>document.version===4?structuredClone(document.atlas):undefined,
    selectedAtlasFrame:()=>atlasFrame,
    selectAtlasFrame(id:string){if(document.version!==4||!document.atlas.frames.some(frame=>frame.id===id))fail("Pixel frame not found");cancel();atlasFrame=id;activeRegion=atlasRegion();},
    active:()=>pending!==undefined,canPaint:()=>selectedLayer().visible&&!selectedLayer().locked,
    sample:(x:number,y:number,id?:string)=>samplePixels(bytes(id),x,y),bytes:(id?:string)=>bytes(id).slice(),
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
      mutate(()=>{state.version=5;state.tags.push(tag);state.nextClipId++;if(!state.initialTag)state.initialTag=id;});return id;
    },
    updateTag(id:string,update:Pick<PixelFrameTag,"name"|"frameIds"|"loop">) {
      const index=state.tags.findIndex(tag=>tag.id===id);if(index<0)fail("Pixel tag not found");
      const tags=structuredClone(state.tags);tags[index]={...tags[index],name:update.name,loop:update.loop,frameIds:[...update.frameIds]};
      readPixelTags(tags,state.frames);
      if(JSON.stringify(tags)===JSON.stringify(state.tags))return false;
      return mutate(()=>{state.tags=tags;});
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
      mutate(()=>{layerVersion();state.layers.push({id,name,visible:true,locked:false});for(const frame of state.frames)frame.pixels.push(new Uint8Array(document.width*document.height*4));state.selected=id;});return id;
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
      const common={format:document.format,name:document.name,width:document.width,height:document.height,colorSpace:document.colorSpace,palette:[...document.palette]},frame=state.frames[0];
      if(state.version===1||state.version===4){const layer=state.layers[0];return {...structuredClone(document) as PixelDocumentV1|PixelDocumentV4,layer:{id:layer.id,name:layer.name},frame:{id:frame.id,durationMs:frame.durationMs},rgba:base64(frame.pixels[0])};}
      if(state.version===2)return {format:document.format,version:2,name:document.name,width:document.width,height:document.height,colorSpace:"srgb",frame:{id:frame.id,durationMs:frame.durationMs},palette:[...document.palette],layers:state.layers.map((layer,i)=>({...layer,rgba:base64(frame.pixels[i])}))};
      const result:PixelDocumentV3={...common,version:3,layers:state.layers.map(layer=>({...layer})),frames:state.frames.map(frame=>({id:frame.id,durationMs:frame.durationMs,cels:state.layers.map((layer,i)=>({layerId:layer.id,rgba:base64(frame.pixels[i])}))}))};
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
    fill(x: number, y: number, color: PixelColor) {
      pixelHex(color);
      if (!pending) fail("Start a pixel transaction first");
      const pixels = paintPixels();
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
