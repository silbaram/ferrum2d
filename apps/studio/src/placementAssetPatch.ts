import { mergeScenePlacementPatch, type SceneAuthoringDocumentSpec, type ScenePlacementPatch } from "@ferrum2d/ferrum-web/authoring";

/** Asset edits keep component scope local; only matching normal bindings cross into spatial data. */
export function validatePlacementAssetPatch(document:SceneAuthoringDocumentSpec,patch:ScenePlacementPatch,fragment:string) {
  mergeScenePlacementPatch(document,{format:patch.format,version:2,operations:patch.operations},{allowedFragments:[fragment]});
  if(patch.lighting!==undefined)throw Error("Asset edits cannot change scene lighting");
  const targets=new Set(patch.operations.flatMap(operation=>operation.kind==="updateComponents"?[operation.instanceId]:[]));
  if(patch.spatial?.operations.some(operation=>operation.kind!=="setBillboardNormalTexture"||!targets.has(operation.id)))
    throw Error("Asset spatial edits require a matching sprite component update");
  mergeScenePlacementPatch(document,patch);
}
