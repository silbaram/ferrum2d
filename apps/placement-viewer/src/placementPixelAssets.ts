import {
  instantiateSceneFragment,
  resolveDataSceneSpriteAnimationSet,
  type SceneAuthoringDocumentSpec,
  type ScenePlacementPatch,
  type ScenePlacementViewerState,
} from "@ferrum2d/ferrum-web/authoring";
import type { FerrumRuntime } from "@ferrum2d/ferrum-web/core";
import { placementNormalHash } from "./placementNormalAssets";
import { createPlacementSpriteRevisions, type PlacementSpriteRevision } from "./placementSpriteRevisions";
import { readPixelDocument, pixelAtlasLayout, pixelFrames, type PixelDocument } from "./placementPixelDocument";
import { pixelAnimation, pixelAnimationInput, type PixelAnimationInput } from "./placementPixelAnimation";
import { pixelPng } from "./placementPixelPng";
import { canUsePlacementAsset, isPlacementProjectAsset } from "./placementAssetScope";
import type { PixelDocumentV4 } from "./placementPixelDocument";

/** Fixed atlas replacement changes only the selected static sprite's texture. */
export function pixelAtlasComponentPatch(
  document: SceneAuthoringDocumentSpec, state: ScenePlacementViewerState, texture: string,
  source: Pick<PixelDocumentV4, "atlas">, frameId: string, revisions: readonly PixelAsset[],
): ScenePlacementPatch {
  const frame = source.atlas.frames.find(frame => frame.id === frameId);
  const instance = instantiateSceneFragment(document.sceneComposition, { fragment: state.fragment })
    .find(instance => instance.id === state.selectedInstanceId);
  const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
  const components = object(instance?.props.components);
  const visual = object(components?.visual);
  if (!frame || !instance || !visual || visual.kind !== "sprite" || visual.animation || visual.animationSet)
    throw Error("Select a static sprite using this atlas frame");
  // Match resolveSpriteFrame defaults without revalidating unrelated components.
  const authoredFrame = visual.frame === undefined ? {} : object(visual.frame);
  const uv = authoredFrame && { u0: authoredFrame.u0 ?? 0, v0: authoredFrame.v0 ?? 0,
    u1: authoredFrame.u1 ?? 1, v1: authoredFrame.v1 ?? 1 };
  const reference = visual.texture ?? visual.asset;
  const previous = revisions.find(asset => asset.id === reference);
  const sameAtlas = previous?.source.version === 4 && JSON.stringify(previous.source.atlas) === JSON.stringify(source.atlas);
  if ((reference !== source.atlas.texture && !sameAtlas) ||
    !uv || ["u0", "v0", "u1", "v1"].some(key => uv[key as keyof typeof uv] !== frame.frame[key as keyof typeof frame.frame]))
    throw Error("Select a static sprite using this atlas frame");
  const patch = pixelComponentPatch(document, state, texture);
  const operation = patch.operations[0] as Extract<ScenePlacementPatch["operations"][number], { kind: "updateComponents" }>;
  const payload = object(operation.components), next = object(payload?.visual);
  if (!payload || !next || next.kind !== "sprite") throw Error("Select a static sprite using this atlas frame");
  // pixelComponentPatch already validated these JSON component fields.
  operation.components = { ...payload, visual: { ...next, frame: { ...frame.frame } } } as typeof operation.components;
  return patch;
}

export interface PixelAsset extends PlacementSpriteRevision {
  identityDocument: string;
  committed: boolean;
  source: PixelDocument;
  /** Exact immutable source bytes used by the native revision identity. */
  sourceJson: string;
  sha256: string;
  width: number;
  height: number;
}
/** Approval is bound to the exact before/after sets and selected asset reference. */
export class PixelClipMigrationRequired extends Error {
  constructor(readonly approval: string, readonly beforeIds: number[], readonly afterIds: number[],
    readonly beforeInitial: number, readonly afterInitial: number) {
    super("Pixel animation was changed. Migrate it explicitly.");
  }
}
export function pixelComponentPatch(
  document: SceneAuthoringDocumentSpec,
  state: ScenePlacementViewerState,
  texture: string,
  input?: PixelAnimationInput,
  revisions: readonly PixelAsset[] = [],
  migrationApproval?: string,
): ScenePlacementPatch {
  const instance = instantiateSceneFragment(document.sceneComposition, { fragment: state.fragment })
    .find(value => value.id === state.selectedInstanceId);
  if (!instance) throw Error("Select a sprite to apply pixels");
  if (state.lockedInstanceIds.includes(instance.id)) throw Error("Unlock the selected sprite first");
  const value = instance.props.components;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Select a sprite to apply pixels");
  // Instantiated props have been narrowed to an object; fields are still unknown.
  const components = value as Record<string, unknown>;
  const visualValue = components.visual;
  if (!visualValue || typeof visualValue !== "object" || Array.isArray(visualValue))
    throw Error("Select a sprite to apply pixels");
  // The same object guard applies to the visual payload.
  const visual = visualValue as Record<string, unknown>;
  if (!visual || visual.kind !== "sprite" || components?.sprite)
    throw Error("Select a sprite to apply pixels");
  if (visual.animation || (visual.animationSet && !input))
    throw Error("Animated sprites require frame editing");
  const billboard = document.spatial?.billboards?.[instance.id];
  if (billboard?.normalTexture !== undefined || billboard?.normalTextureId !== undefined)
    throw Error("Regenerate paired normals before replacing this sprite");
  const animation=input&&(input.frames.length>1||input.tags)?pixelAnimation(input):undefined;
  let nextSet=animation?.set;
  if(visual.animationSet) {
    const reference=visual.texture??visual.asset,previous=revisions.find(asset=>asset.id===reference);
    if(!previous)throw Error("Only owned pixel animations can be replaced");
    const actual=resolveDataSceneSpriteAnimationSet(visual.animationSet),expected=pixelAnimation(pixelAnimationInput(previous.source)).set;
    // Legacy one-clip sources allowed an authored loop override. Keep that contract.
    if(!input?.tags&&nextSet&&previous.source.version!==5)
      nextSet={...nextSet,clips:nextSet.clips.map(clip=>({...clip,loop:actual.clips[0]?.loop??true}))};
    const afterIds=nextSet?.clips.map(clip=>clip.id)??[];
    if((input?.tags||previous.source.version===5)&&actual.clips.some(clip=>!afterIds.includes(clip.id)))
      throw Error("Keep existing clip IDs before applying pixel tags");
    const legacyExpected=previous.source.version===5?expected:{...expected,clips:expected.clips.map(clip=>({...clip,loop:actual.clips[0]?.loop??true}))};
    const requiresMigration=JSON.stringify(actual)!==JSON.stringify(legacyExpected)||
      (!!input?.tags&&JSON.stringify(actual)!==JSON.stringify(nextSet));
    if(requiresMigration) {
      const approval=JSON.stringify([reference,actual,nextSet]);
      if(migrationApproval!==approval)throw new PixelClipMigrationRequired(approval,actual.clips.map(clip=>clip.id),afterIds,
        actual.initialClip??actual.clips[0].id,nextSet?.initialClip??nextSet?.clips[0].id??-1);
    }
  }
  const nextVisual:Record<string,unknown>={...visual,texture,asset:texture,frame:nextSet?.clips.find(clip=>clip.id===nextSet!.initialClip)?.frames[0]??{u0:0,v0:0,u1:1,v1:1}};
  delete nextVisual.animationSet;
  if(nextSet)nextVisual.animationSet=nextSet;
  return {
    format: "ferrum2d.scene-placement.patch", version: 2,
    operations: [{
      kind: "updateComponents", instanceId: instance.id,
      // Preserve the instantiated payload. The host validates the composed patch
      // before committing it; only imagery and verified owned animation change here.
      components: {
        ...components,
        visual: nextVisual,
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
  function assertScope(serialized: string | undefined, key: string, project?: string) {
    if (store.entries().some(asset => !canUsePlacementAsset(asset, key, project) && referenced(serialized, asset)))
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
    entries: store.entries,
    async restore(restored: PixelAsset[], signal: AbortSignal) {
      const added: PixelAsset[] = [];
      try {
        for (const asset of restored) {
          signal.throwIfAborted();
          const existing = store.entries().find(a => a.id === asset.id);
          const adopted = store.adopt(asset);
          if (!existing) added.push(adopted);
          await store.upload(adopted, signal);
        }
      } catch (error) {
        for (const asset of added) store.discard(asset);
        throw error;
      }
    },
    async prepare(document: string, source: PixelDocument, signal: AbortSignal) {
      signal.throwIfAborted();
      const snapshot = readPixelDocument(JSON.stringify(source));
      const serialized = JSON.stringify(snapshot);
      // Reopening a formatted immutable source must not create a canonical-JSON twin.
      const unchanged=store.entries().find(entry=>entry.identityDocument===document&&JSON.stringify(entry.source)===serialized);
      if(unchanged){await store.upload(unchanged,signal);return unchanged;}
      const layout=pixelAtlasLayout(snapshot,pixelFrames(snapshot).length);
      const png = await pixelPng(snapshot);
      const [identity, sha256] = await Promise.all([
        placementNormalHash(JSON.stringify([document, serialized])), placementNormalHash(png),
      ]);
      signal.throwIfAborted();
      const id = "pixel." + identity.slice(0, 24);
      const existing = store.entries().find(entry => entry.id === id);
      const asset = store.adopt({
        id, document, identityDocument: document, name: snapshot.name, png, source: snapshot, sourceJson: serialized,
        width: layout.width, height: layout.height, sha256, committed: false,
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
    providerAssets: (key: string, project?: string) => store.entries()
      .filter(asset => canUsePlacementAsset(asset, key, project) && asset.uploaded)
      .map(asset => {
        const frames=pixelFrames(asset.source),layout=pixelAtlasLayout(asset.source,frames.length);
        return {
        id: asset.id, label: asset.name + " @" + asset.id.slice(-6),
        width: asset.width, height: asset.height, thumbnailUrl: asset.url,
        ...((asset.source.version===3||asset.source.version===5)?{frames:frames.map((frame,index)=>({
          id:frame.id,label:"Frame "+(index+1)+" · "+frame.durationMs+" ms",width:asset.source.width,height:asset.source.height,
          frame:layout.frames[index],
        }))}:asset.source.version===4?{frames:asset.source.atlas.frames.map(frame=>({
          ...frame,label:frame.id,width:Math.round((frame.frame.u1-frame.frame.u0)*asset.width),
          height:Math.round((frame.frame.v1-frame.frame.v0)*asset.height),
        }))}:{}),
      };}),
    has: (id: string) => store.entries().some(asset => asset.id === id),
    blocksSave(document: unknown, key = "", project?: string) {
      const serialized = JSON.stringify(document);
      return store.entries().some(asset => referenced(serialized, asset) &&
        (!isPlacementProjectAsset(asset) || !canUsePlacementAsset(asset, key, project) ||
          (serialized !== undefined && textureAlias(asset.id) !== undefined && numericReference(serialized, textureAlias(asset.id)!))));
    },
    assertDocumentAssets(document: unknown, key: string, project?: string) {
      assertScope(JSON.stringify(document), key, project);
    },
    bundle(key: string, scene: SceneAuthoringDocumentSpec, project?: string) {
      const assets = store.entries().filter(asset => canUsePlacementAsset(asset, key, project) && asset.uploaded && asset.committed);
      assertScope(JSON.stringify(scene), key, project);
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
          let animationSet,animationDiagnostic;
          if(pixelFrames(asset.source).length>1||asset.source.version===5) {
            try {animationSet=pixelAnimation(pixelAnimationInput(asset.source)).set;}
            catch(error){animationDiagnostic=error instanceof Error?error.message:String(error);}
          }
          return { id: asset.id, sha256: asset.sha256, source: structuredClone(asset.source),
            ...(animationSet?{animationSet}:{}),...(animationDiagnostic?{animationDiagnostic}:{}),
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
        if (asset.document === key && !isPlacementProjectAsset(asset) && !options.retains(asset.id)) store.discard(asset);
    },
    destroy: store.destroy,
  };
}
