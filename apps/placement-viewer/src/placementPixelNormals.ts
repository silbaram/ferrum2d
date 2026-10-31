import { createSceneSpriteNormalPatch, mergeScenePlacementPatch, instantiateSceneFragment, resolveSpriteNormalAssetBinding,
  type SceneAuthoringDocumentSpec, type ScenePlacementViewerState, type ScenePlacementPatch } from "@ferrum2d/ferrum-web/authoring";
import { createPlacementFrameNormals } from "./placementFrameNormals";
import { pixelAtlasLayout, pixelFrames, type PixelDocument } from "./placementPixelDocument";
import { pixelAnimationInput } from "./placementPixelAnimation";
import { pixelComponentPatch, pixelAtlasComponentPatch, type PixelAsset } from "./placementPixelAssets";
import { placementNormalHash, type PlacementNormalAssetBundle } from "./placementNormalAssets";
import { asepriteNormalLayout } from "./placementAsepriteAnimation";

/** Exact source IDs and independent rects; atlas padding is never treated as a frame. */
export function pixelNormalFrames(source: PixelDocument) {
  if (source.version === 4) return source.atlas.frames.map(({id,frame}) => ({ id,
    x:Math.round(frame.u0*source.width),y:Math.round(frame.v0*source.height),
    width:Math.round((frame.u1-frame.u0)*source.width),height:Math.round((frame.v1-frame.v0)*source.height) }));
  const frames=pixelFrames(source),layout=pixelAtlasLayout(source,frames.length);
  return frames.map((frame,index)=>({id:frame.id,x:(index%layout.columns)*source.width,y:Math.floor(index/layout.columns)*source.height,width:source.width,height:source.height}));
}
export async function pixelNormalSource(asset: PixelAsset) {
  const snapshot={id:asset.id,document:asset.document,width:asset.width,height:asset.height,png:asset.png.slice(0),
    sourceJson:asset.sourceJson,pngSha256:asset.sha256,pngName:asset.id+".png",frames:pixelNormalFrames(asset.source)};
  return {...snapshot,jsonSha256:await placementNormalHash(snapshot.sourceJson)};
}
export function createPixelNormals(options: Omit<Parameters<typeof createPlacementFrameNormals>[0],"kind">) {
  return createPlacementFrameNormals({...options,kind:"pixel"});
}
function object(value:unknown):Record<string,unknown>|undefined {
  // Scene JSON may be a readonly array; inspect only explicitly guarded records.
  return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
}
type NormalEntry = Awaited<ReturnType<ReturnType<typeof createPixelNormals>["prepare"]>>["entry"];
/** Generate a single color+normal patch while preserving unrelated components and clip checks. */
export function pixelNormalPatch(document:SceneAuthoringDocumentSpec,state:ScenePlacementViewerState,asset:PixelAsset,
  entry:NormalEntry,revisions:readonly PixelAsset[],known:readonly Pick<PlacementNormalAssetBundle,"binding"|"report">[],frameId:string,migrationApproval?:string):ScenePlacementPatch {
  const id=state.selectedInstanceId,billboard=id&&document.spatial?.billboards[id];
  if(!id||!billboard)throw Error("Normal application requires an HD-2D billboard");
  if(entry.source.id!==asset.id||entry.source.pngSha256!==asset.sha256||entry.source.sourceJson!==asset.sourceJson||JSON.stringify(entry.source.frames)!==JSON.stringify(pixelNormalFrames(asset.source)))throw Error("Pixel normal source differs");
  const instance=instantiateSceneFragment(document.sceneComposition,{fragment:state.fragment}).find(value=>value.id===id);
  const visual=object(object(instance?.props.components)?.visual);
  const color=visual?.texture??visual?.asset;
  if(billboard.normalTextureId!==undefined||billboard.normalTexture!==undefined&&!known.some(bundle=>
    bundle.report.format==="ferrum2d.pixel-normal.report"&&bundle.binding.textures.normal.asset===billboard.normalTexture&&bundle.binding.textures.color.asset===color))
    throw Error("Existing normals are not owned by this pixel source");
  const copy=structuredClone(document),clean=copy.spatial!.billboards[id];
  delete clean.normalTexture;delete clean.normalTextureId;
  const patch=asset.source.version===4?pixelAtlasComponentPatch(copy,state,asset.id,asset.source,frameId,revisions):
    pixelComponentPatch(copy,state,asset.id,pixelAnimationInput(asset.source),revisions,migrationApproval);
  const next=mergeScenePlacementPatch(copy,patch).document;
  const updated=instantiateSceneFragment(next.sceneComposition,{fragment:state.fragment}).find(value=>value.id===id)!;
  const components=object(updated.props.components);
  const nextVisual=object(components?.visual);
  if(!nextVisual)throw Error("Select a sprite to apply pixels");
  const binding=resolveSpriteNormalAssetBinding({...entry.binding,...asepriteNormalLayout(nextVisual)});
  return createSceneSpriteNormalPatch(next,binding,{instanceId:id,assets:[
    {id:asset.id,width:asset.width,height:asset.height,sha256:asset.sha256,colorSpace:"srgb"},
    {id:binding.textures.normal.asset,width:asset.width,height:asset.height,sha256:binding.textures.normal.sha256,colorSpace:"none"},
  ]}).patch;
}
