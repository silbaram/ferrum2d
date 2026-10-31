import { placementNormalHash, placementNormalRead } from "./placementNormalAssets";
import { readPixelDocument, pixelAtlasLayout, pixelFrames, PIXEL_LIMITS } from "./placementPixelDocument";
import { verifyPixelPng } from "./placementPixelPng";
import type { PixelAsset } from "./placementPixelAssets";

interface PixelMetadata {
  assetId: string; identityDocument: string; jsonSha256: string; pngSha256: string;
  width: number; height: number;
}
export interface PixelProjectCatalog {
  format: "ferrum2d.pixel.project"; version: 1; catalogRevision: string;
  assets: { metadata: PixelMetadata; jsonUrl: string; pngUrl: string }[];
}
export interface PixelProjectHost {
  readonly project: string;
  load(signal: AbortSignal): Promise<PixelProjectCatalog>;
  save(assets: readonly PixelAsset[], signal: AbortSignal): Promise<PixelProjectCatalog>;
}
function revision(value: PixelProjectCatalog) {
  if (value?.format !== "ferrum2d.pixel.project" || value.version !== 1 ||
    typeof value.catalogRevision !== "string" || !/^(?:[a-f0-9]{64})?$/.test(value.catalogRevision) ||
    !Array.isArray(value.assets) || value.assets.length > 8 || (!value.catalogRevision && value.assets.length))
    throw Error("Invalid project pixel catalog");
  return value.catalogRevision;
}
function base64(bytes: Uint8Array) {
  let result = "";
  for (let i = 0; i < bytes.length; i += 16384) result += String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(result);
}
export async function pixelProjectBundle(assets: readonly PixelAsset[]) {
  if (!assets.length || assets.length > 8) throw Error("Pixel project requires 1–8 revisions");
  // Capture every caller-owned field before the first digest yields.
  const snapshots = assets.map(asset => ({
    id: asset.id, identityDocument: asset.identityDocument, sha256: asset.sha256,
    width: asset.width, height: asset.height, png: asset.png.slice(0),
    sourceJson: asset.sourceJson, source: readPixelDocument(JSON.stringify(asset.source)),
  }));
  const revisions: PixelMetadata[] = [], files: {path:string;mediaType:string;sha256:string;base64:string}[] = [];
  for (const asset of snapshots) {
    const source = asset.sourceJson;
    if (JSON.stringify(readPixelDocument(source)) !== JSON.stringify(asset.source))
      throw Error("Saved pixel source or revision metadata differs");
    const jsonSha256 = await placementNormalHash(source);
    revisions.push({assetId:asset.id,identityDocument:asset.identityDocument,jsonSha256,pngSha256:asset.sha256,width:asset.width,height:asset.height});
    files.push({path:asset.id+".json",mediaType:"application/json",sha256:jsonSha256,base64:base64(new TextEncoder().encode(source))},
      {path:asset.id+".png",mediaType:"image/png",sha256:asset.sha256,base64:base64(new Uint8Array(asset.png))});
  }
  return {format:"ferrum2d.pixel-project.assets",version:1,overwrite:false,revisions,files,
    manifest:{textures:Object.fromEntries(snapshots.map(a=>[a.id,a.id+".png"])),textureOptions:Object.fromEntries(snapshots.map(a=>[a.id,{colorSpace:"srgb"}]))}};
}
/** Desktop-only host, with an optimistic catalog token captured by the last successful load/save. */
export function createDesktopPixelProjectHost(invoke: <T>(command:string,args?:Record<string,unknown>)=>Promise<T>, project:string): PixelProjectHost {
  let expected: string | undefined;
  return {
    project,
    async load(signal) {
      signal.throwIfAborted();
      const result = await invoke<PixelProjectCatalog>("load_placement_pixel_assets",{projectPath:project});
      signal.throwIfAborted(); expected = revision(result); return result;
    },
    async save(assets,signal) {
      signal.throwIfAborted();
      if (expected === undefined) throw Error("Reopen the project before saving pixels");
      const baseline = expected, bundle = await pixelProjectBundle(assets);
      signal.throwIfAborted();
      const result = await invoke<PixelProjectCatalog>("save_placement_pixel_assets",{projectPath:project,bundle:{...bundle,expectedCatalogRevision:baseline}});
      signal.throwIfAborted(); expected = revision(result); return result;
    },
  };
}
function durableUrl(value: string) {
  if (typeof value !== "string" || !value) throw Error("Project host must return durable pixel URLs");
  const url = new URL(value,location.href);
  if (!["http:","https:","ferrum-asset:"].includes(url.protocol) || url.username || url.password)
    throw Error("Project host must return durable pixel URLs");
  return url.href;
}
/** Source identity, PNG bytes and straight-alpha pixels are checked before trusting durability. */
export async function readPixelProject(value: PixelProjectCatalog, document: string, project: string, signal: AbortSignal): Promise<PixelAsset[]> {
  revision(value);
  const restored: PixelAsset[] = [], seen = new Set<string>(); let total = 0;
  for (const entry of value.assets) {
    signal.throwIfAborted();
    const meta = entry?.metadata;
    if (!meta || !/^pixel\.[a-f0-9]{24}$/.test(meta.assetId) || seen.has(meta.assetId) ||
      typeof meta.identityDocument !== "string" || !meta.identityDocument.length || meta.identityDocument.length > 1024 ||
      !/^[a-f0-9]{64}$/.test(meta.jsonSha256) || !/^[a-f0-9]{64}$/.test(meta.pngSha256))
      throw Error("Invalid project pixel metadata");
    seen.add(meta.assetId);
    const json = await placementNormalRead(await fetch(durableUrl(entry.jsonUrl),{signal,cache:"no-store"}),PIXEL_LIMITS.sourceBytes);
    const png = await placementNormalRead(await fetch(durableUrl(entry.pngUrl),{signal,cache:"no-store"}),PIXEL_LIMITS.pngBytes);
    total += json.byteLength + png.byteLength;
    if (total > 64*1024*1024) throw Error("Pixel project exceeds 64 MiB");
    const raw = new TextDecoder("utf-8",{fatal:true}).decode(json);
    const source = readPixelDocument(raw);
    const layout=pixelAtlasLayout(source,pixelFrames(source).length);
    const [jsonHash,pngHash,identity] = await Promise.all([placementNormalHash(json),placementNormalHash(png),placementNormalHash(JSON.stringify([meta.identityDocument,raw]))]);
    if (meta.jsonSha256 !== jsonHash || meta.pngSha256 !== pngHash || meta.assetId !== "pixel."+identity.slice(0,24) ||
      meta.width !== layout.width || meta.height !== layout.height)
      throw Error("Saved pixel source or revision metadata differs");
    await verifyPixelPng(png,source); signal.throwIfAborted();
    restored.push({id:meta.assetId,identityDocument:meta.identityDocument,document,project,persisted:true,committed:true,
      source,sourceJson:raw,png,sha256:pngHash,name:source.name,width:layout.width,height:layout.height,bytes:json.byteLength+png.byteLength,uploaded:false});
  }
  return restored;
}
