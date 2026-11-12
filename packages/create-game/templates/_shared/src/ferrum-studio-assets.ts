import {
  createScenePlacementAssetProviderFromProjectAssets,
  type SceneAuthoringDocumentSpec,
  type ScenePlacementAssetProvider,
} from "@ferrum2d/ferrum-web/authoring";

export interface PlacementViewerAssetUrls {
  readonly sceneAuthoring: string;
  readonly gameSpec: string;
  readonly textureAtlasInput: string;
}

export interface PlacementViewerAssets {
  readonly document: SceneAuthoringDocumentSpec;
  readonly assetProvider: ScenePlacementAssetProvider;
}

type PlacementProjectAtlas = NonNullable<
  Parameters<typeof createScenePlacementAssetProviderFromProjectAssets>[0]["atlas"]
>;

export async function loadPlacementViewerAssets(
  urls: PlacementViewerAssetUrls,
): Promise<PlacementViewerAssets> {
  const [document, assetProvider] = await Promise.all([
    loadSceneAuthoringDocument(urls.sceneAuthoring),
    loadProjectPlacementAssetProvider(urls),
  ]);
  return { document, assetProvider };
}

async function loadSceneAuthoringDocument(url: string): Promise<SceneAuthoringDocumentSpec> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  return json as SceneAuthoringDocumentSpec;
}

async function loadProjectPlacementAssetProvider(
  urls: Pick<PlacementViewerAssetUrls, "gameSpec" | "textureAtlasInput">,
): Promise<ScenePlacementAssetProvider> {
  const [gameSpec, textureAtlasInput] = await Promise.all([
    loadOptionalJson(urls.gameSpec),
    loadOptionalJson(urls.textureAtlasInput),
  ]);
  return createScenePlacementAssetProviderFromProjectAssets({
    textures: textureAtlasInputTextures(textureAtlasInput),
    atlas: gameSpecAtlas(gameSpec),
    path: "placementViewer.projectAssets",
  });
}

async function loadOptionalJson(url: string): Promise<unknown | undefined> {
  const response = await fetch(url, { cache: "no-cache" });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

function textureAtlasInputTextures(value: unknown): Record<string, string> | undefined {
  const input = optionalRecord(value);
  if (input === undefined) {
    return undefined;
  }
  const texture = typeof input.texture === "string"
    ? input.texture.trim()
    : typeof input.texture === "number"
      ? String(input.texture)
      : "";
  const image = typeof input.image === "string" ? input.image.trim() : "";
  if (texture.length === 0 || image.length === 0) {
    return undefined;
  }
  return { [texture]: image };
}

function gameSpecAtlas(value: unknown): PlacementProjectAtlas | undefined {
  const spec = optionalRecord(value);
  const atlas = optionalRecord(spec?.atlas);
  const frames = optionalRecord(atlas?.frames);
  return frames === undefined ? undefined : { frames: frames as PlacementProjectAtlas["frames"] };
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
