/** Only verified, persisted assets carry a project scope. Draft assets stay document-owned. */
export interface PlacementAssetScope {
  document: string;
  persisted?: boolean;
  project?: string;
}
export function isPlacementProjectAsset(asset: PlacementAssetScope): boolean {
  return asset.persisted === true && !!asset.project;
}
export function canUsePlacementAsset(asset: PlacementAssetScope, key: string, project?: string): boolean {
  return isPlacementProjectAsset(asset) ? asset.project === project : asset.document === key;
}
