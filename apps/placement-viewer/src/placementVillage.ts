import type {
  FerrumRuntime,
  SceneAuthoringDocumentSpec,
} from "@ferrum2d/ferrum-web";

interface VillageAsset {
  file: string;
  sha256: string;
  imageWidth?: number;
  imageHeight?: number;
}
interface VillageManifest {
  format: string;
  version: number;
  models: Record<string, VillageAsset>;
  textures: Record<string, VillageAsset>;
}
let catalog: VillageManifest | undefined;
const assetUrl = (file: string) =>
  new URL(`./assets/rpg-village/${file}`, document.baseURI).href;

/** Example assets are app-owned. Desktop imports retain their existing host contract. */
export async function ensureVillageAssets(
  scene: SceneAuthoringDocumentSpec,
): Promise<void> {
  if (catalog || !isVillageScene(scene)) return;
  const response = await fetch(assetUrl("manifest.json"));
  if (!response.ok)
    throw new Error(`Village asset manifest: HTTP ${response.status}`);
  // This is the checked-in Blender generator's private manifest, validated before use.
  const value = (await response.json()) as VillageManifest;
  if (
    value.format !== "ferrum2d.example.village-assets" ||
    value.version !== 1 || !value.models || !value.textures
  )
    throw new Error("Invalid village asset manifest");
  for (const [id, entry] of Object.entries({ ...value.models, ...value.textures })) {
    if (
      !/^village_[a-z_]+$/.test(id) ||
      !/^[a-z_]+\.(glb|png)$/.test(entry.file) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    )
      throw new Error(`Invalid village asset: ${id}`);
  }
  catalog = value;
}
export function isVillageScene(scene: SceneAuthoringDocumentSpec): boolean {
  return Object.values(scene.spatial?.models ?? {}).some(
    (model) => model.asset === "village_landscape",
  );
}
export function villageModelUrl(id: string): string | undefined {
  const entry = catalog?.models[id];
  return entry ? assetUrl(entry.file) : undefined;
}
export function villageTextures(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(catalog?.textures ?? {}).map(([id, item]) => [
      id, assetUrl(item.file),
    ]),
  );
}
export function villageTextureMetadata() {
  return Object.fromEntries(
    Object.entries(catalog?.textures ?? {}).map(([id, item]) => [id, {
      label: id,
      thumbnailUrl: assetUrl(item.file),
      width: item.imageWidth,
      height: item.imageHeight,
    }]),
  );
}
export function villageAtlasFrames() {
  if (!catalog) return {};
  return Object.fromEntries(
    ["down", "up", "left", "right"].map((direction, row) => [
      `village_hero_${direction}`,
      {
        texture: "village_hero",
        uv: { u0: 0, v0: row / 4, u1: 1 / 4, v1: (row + 1) / 4 },
        size: { width: 21, height: 31.5 },
      },
    ]),
  );
}
/** Animation decisions and all movement stay in the native runtime. Called only on apply. */
export function configureVillageActor(
  engine: FerrumRuntime["engine"],
  scene: SceneAuthoringDocumentSpec,
): void {
  if (!isVillageScene(scene) || scene.spatial?.actor?.instanceId !== "village_hero")
    return;
  engine.configureDataSceneMovementAnimation({
    idle: {
      up: { clip: 0 }, down: { clip: 1 }, left: { clip: 2 }, right: { clip: 3 },
    },
    walk: {
      up: { clip: 4 }, down: { clip: 5 }, left: { clip: 6 }, right: { clip: 7 },
    },
    initialDirection: "down",
  });
}
