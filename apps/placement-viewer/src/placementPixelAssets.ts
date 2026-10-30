import {
  instantiateSceneFragment,
  type SceneAuthoringDocumentSpec,
  type ScenePlacementPatch,
  type ScenePlacementViewerState,
} from "@ferrum2d/ferrum-web/authoring";
import type { FerrumRuntime } from "@ferrum2d/ferrum-web/core";
import { placementNormalHash } from "./placementNormalAssets";
import { createPlacementSpriteRevisions, type PlacementSpriteRevision } from "./placementSpriteRevisions";
import { readPixelDocument, type PixelDocument } from "./placementPixelDocument";
import { pixelPng } from "./placementPixelPng";

interface PixelAsset extends PlacementSpriteRevision {
  committed: boolean;
  source: PixelDocument;
  sha256: string;
  width: number;
  height: number;
}
export function pixelComponentPatch(
  document: SceneAuthoringDocumentSpec,
  state: ScenePlacementViewerState,
  texture: string,
): ScenePlacementPatch {
  const instance = instantiateSceneFragment(document.sceneComposition, { fragment: state.fragment })
    .find(value => value.id === state.selectedInstanceId);
  if (!instance) throw Error("Select a static sprite to apply pixels");
  if (state.lockedInstanceIds.includes(instance.id)) throw Error("Unlock the selected sprite first");
  const value = instance.props.components;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Select a static sprite to apply pixels");
  // Instantiated props have been narrowed to an object; fields are still unknown.
  const components = value as Record<string, unknown>;
  const visualValue = components.visual;
  if (!visualValue || typeof visualValue !== "object" || Array.isArray(visualValue))
    throw Error("Select a static sprite to apply pixels");
  // The same object guard applies to the visual payload.
  const visual = visualValue as Record<string, unknown>;
  if (!visual || visual.kind !== "sprite" || components?.sprite)
    throw Error("Select a static sprite to apply pixels");
  if (visual.animation || visual.animationSet)
    throw Error("Animated sprites require frame editing");
  const billboard = document.spatial?.billboards?.[instance.id];
  if (billboard?.normalTexture !== undefined || billboard?.normalTextureId !== undefined)
    throw Error("Regenerate paired normals before replacing this sprite");
  return {
    format: "ferrum2d.scene-placement.patch", version: 2,
    operations: [{
      kind: "updateComponents", instanceId: instance.id,
      // Preserve the instantiated payload. The host validates the composed patch
      // before committing it; only texture aliases and full-image UVs change here.
      components: {
        ...components,
        visual: { ...visual, texture, asset: texture, frame: { u0: 0, v0: 0, u1: 1, v1: 1 } },
      } as Extract<ScenePlacementPatch["operations"][number], { kind: "updateComponents" }>["components"],
    }],
  };
}
/** Separate from Aseprite import. Immutable, bounded, session-owned PNG revisions. */
export function createPixelAssets(options: {
  engine: FerrumRuntime["engine"];
  taken(id: string): boolean;
  retains(id: string): boolean;
}) {
  const store = createPlacementSpriteRevisions<PixelAsset>(options.engine, options.taken, {
    entries: 8, bytes: 64 * 1024 * 1024,
  });
  function textureAlias(id: string): number | undefined {
    try {
      const value = options.engine.textureId(id);
      if (Number.isInteger(value) && value >= 0 && value <= 0xffffffff) return value;
    } catch { /* A staged or released revision may not have a runtime alias. */ }
  }
  function numericReference(serialized: string, id: number): boolean {
    return new RegExp('"(?:texture|textureId|normalTexture|normalTextureId|asset)":' + id + '(?=[,}])').test(serialized);
  }
  function referenced(serialized: string | undefined, asset: PixelAsset): boolean {
    if (serialized === undefined) return false;
    const alias = textureAlias(asset.id);
    return serialized.includes(JSON.stringify(asset.id)) ||
      (alias !== undefined && numericReference(serialized, alias));
  }
  function assertScope(serialized: string | undefined, key: string) {
    if (store.entries().some(asset => asset.document !== key && referenced(serialized, asset)))
      throw Error("Export and install pixel assets before opening them in another scene");
  }
  function portableScene(scene: SceneAuthoringDocumentSpec, assets: readonly PixelAsset[]): SceneAuthoringDocumentSpec {
    const copy = structuredClone(scene), aliases = new Map<number, string>();
    for (const asset of assets) {
      const alias = textureAlias(asset.id);
      if (alias !== undefined) aliases.set(alias, asset.id);
    }
    const record = (value: unknown): Record<string, unknown> | undefined => {
      // Only explicitly narrowed JSON objects are inspected.
      if (value && typeof value === "object" && !Array.isArray(value))
        return value as Record<string, unknown>;
    };
    function normalizeProps(props: unknown) {
      const components = record(record(props)?.components);
      for (const visual of [record(components?.visual), record(components?.sprite)]) {
        if (!visual) continue;
        for (const key of ["texture", "asset"]) {
          const alias = visual[key];
          if (typeof alias === "number" && aliases.has(alias)) visual[key] = aliases.get(alias);
        }
      }
    }
    for (const prefab of Object.values(copy.sceneComposition.prefabs)) {
      normalizeProps(prefab.props);
      for (const variant of Object.values(prefab.variants ?? {})) normalizeProps(variant.props);
    }
    for (const fragment of Object.values(copy.sceneComposition.fragments ?? {})) {
      for (const instance of fragment.instances ?? []) normalizeProps(instance.props);
      for (const include of fragment.include ?? []) normalizeProps(include.props);
    }
    for (const billboard of Object.values(copy.spatial?.billboards ?? {})) {
      const normal = billboard.normalTextureId;
      if (normal !== undefined && aliases.has(normal)) {
        const named = aliases.get(normal)!;
        if (billboard.normalTexture !== undefined && billboard.normalTexture !== named)
          throw Error("Conflicting pixel normal texture references");
        billboard.normalTexture = named;
        delete billboard.normalTextureId;
      }
    }
    const serialized = JSON.stringify(copy);
    if ([...aliases.keys()].some(alias => numericReference(serialized, alias)))
      throw Error("Use named pixel texture references before exporting");
    return copy;
  }
  return {
    async prepare(document: string, source: PixelDocument, signal: AbortSignal) {
      signal.throwIfAborted();
      const snapshot = readPixelDocument(JSON.stringify(source));
      const serialized = JSON.stringify(snapshot);
      const png = await pixelPng(snapshot);
      const [identity, sha256] = await Promise.all([
        placementNormalHash(JSON.stringify([document, serialized])), placementNormalHash(png),
      ]);
      signal.throwIfAborted();
      const id = "pixel." + identity.slice(0, 24);
      const existing = store.entries().find(entry => entry.id === id);
      const asset = store.adopt({
        id, document, name: snapshot.name, png, source: snapshot,
        width: snapshot.width, height: snapshot.height, sha256, committed: false,
        bytes: png.byteLength + new TextEncoder().encode(serialized).length, uploaded: false,
      });
      try { await store.upload(asset, signal); return asset; }
      catch (error) { if (!existing) store.discard(asset); throw error; }
    },
    commit(asset: PixelAsset) {
      if (!asset.uploaded || !store.entries().includes(asset))
        throw Error("Pixel revision is no longer available");
      asset.committed = true;
    },
    discardUncommitted(asset: PixelAsset) {
      if (asset.committed || !store.entries().includes(asset) || options.retains(asset.id)) return false;
      store.discard(asset);
      return true;
    },
    providerAssets: (key: string) => store.entries()
      .filter(asset => asset.document === key && asset.uploaded)
      .map(asset => ({
        id: asset.id, label: asset.name + " @" + asset.id.slice(-6),
        width: asset.width, height: asset.height, thumbnailUrl: asset.url,
      })),
    has: (id: string) => store.entries().some(asset => asset.id === id),
    blocksSave(document: unknown) {
      const serialized = JSON.stringify(document);
      return store.entries().some(asset => referenced(serialized, asset));
    },
    assertDocumentAssets(document: unknown, key: string) {
      assertScope(JSON.stringify(document), key);
    },
    bundle(key: string, scene: SceneAuthoringDocumentSpec) {
      const assets = store.entries().filter(asset => asset.document === key && asset.uploaded && asset.committed);
      assertScope(JSON.stringify(scene), key);
      return {
        format: "ferrum2d.pixel-assets", version: 1, overwrite: false,
        sceneDocument: portableScene(scene, assets),
        manifest: {
          textures: Object.fromEntries(assets.map(asset => [asset.id, asset.id + ".png"])),
          textureOptions: Object.fromEntries(assets.map(asset => [asset.id, { colorSpace: "srgb" }])),
        },
        assets: assets.map(asset => {
          let binary = "";
          const bytes = new Uint8Array(asset.png);
          for (let i = 0; i < bytes.length; i += 16384)
            binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
          return { id: asset.id, sha256: asset.sha256, source: structuredClone(asset.source),
            pngBase64: btoa(binary), path: asset.id + ".png" };
        }),
      };
    },
    collectUnused() {
      return store.collectUnused(new Set(store.entries().filter(asset => options.retains(asset.id)).map(asset => asset.id)));
    },
    close(key: string) {
      // The host removes the closing scene before querying remaining references.
      for (const asset of store.entries())
        if (asset.document === key && !options.retains(asset.id)) store.discard(asset);
    },
    destroy: store.destroy,
  };
}
