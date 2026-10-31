import { normalReferences, referencesNormal } from "./placementNormalReferences";
import { uiMessage, type UiContent } from "./placementLocale";
import { canUsePlacementAsset, isPlacementProjectAsset } from "./placementAssetScope";
import {
  createSpriteNormalWorkerClient,
  createSceneSpriteNormalPatch,
  mergeScenePlacementPatch,
  resolveSpriteNormalAssetBinding,
  createScenePlacementAgentHandoff,
  type SceneAuthoringDocumentSpec,
  type ScenePlacementPatch,
  type ScenePlacementViewerState,
  type SceneSpriteNormalBindingEvidence,
  type SpriteNormalAssetBinding,
  type SpriteNormalGenerationSettings,
  type SpriteNormalWorkerResult,
} from "@ferrum2d/ferrum-web/authoring";
import type { FerrumRuntime } from "@ferrum2d/ferrum-web/core";
export interface PlacementFrameNormalSource {
  id: string; document: string; width: number; height: number; png: ArrayBuffer;
  sourceJson?: string; jsonSha256: string; pngSha256: string; pngName: string;
  frames: { id?: string; x: number; y: number; width: number; height: number }[];
}
import { asepriteNormalLayout } from "./placementAsepriteAnimation";
import {
  readAsepriteNormalPixels,
  writeAsepriteNormalPixels,
} from "./placementAsepriteNormalPng";
import {
  placementNormalHash,
  placementNormalMeasure,
  placementNormalRead,
  PLACEMENT_NORMAL_ASSET_LIMITS,
  type PlacementNormalAssetBundle,
  type PlacementNormalAssetHost,
} from "./placementNormalAssets";

interface Entry {
  key: string;
  document: string;
  source: PlacementFrameNormalSource;
  binding: SpriteNormalAssetBinding;
  png: ArrayBuffer;
  report: Record<string, unknown>;
  uploaded: boolean;
  committed: boolean;
  persisted: boolean;
  project?: string;
  url?: string;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid generator report");
  return value as Record<string, unknown>;
}
async function png(canvas: HTMLCanvasElement, signal: AbortSignal) {
  signal.throwIfAborted();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(Error("PNG encoding failed")),
      "image/png",
    ),
  );
  const bytes = await blob.arrayBuffer();
  signal.throwIfAborted();
  return bytes;
}
function canvas(width: number, height: number) {
  const value = document.createElement("canvas");
  value.width = width;
  value.height = height;
  const context = value.getContext("2d");
  if (!context) throw Error("Canvas image processing unavailable");
  return { canvas: value, context };
}

/** Source stores own color bytes. This shared store owns only immutable normal textures. */
export function createPlacementFrameNormals(options: {
  kind: "aseprite" | "pixel";
  engine: FerrumRuntime["engine"];
  host(): PlacementNormalAssetHost | undefined;
  project?(): string | undefined;
  settings(): SpriteNormalGenerationSettings;
  restored?(): PlacementNormalAssetBundle[];
  taken(id: string): boolean;
}) {
  const pipeline = options.kind + "-rects-v1";
  const entries = new Map<string, Entry>();
  const evidence = new Map<string, SceneSpriteNormalBindingEvidence>();
  let disposed = false;
  const id = (entry: Entry) => entry.binding.textures.normal.asset;
  function discard(entry: Entry, shutdown = false) {
    if (entries.get(entry.key) !== entry) return;
    try {
      if (entry.url) {
        const textures = [
          { kind: "texture" as const, name: id(entry), url: entry.url },
        ];
        options.engine.releaseAssets({
          entries: textures,
          textures,
          sounds: [],
          json: [],
          total: 1,
        });
      }
    } catch (error) {
      if (!shutdown) throw error;
    } finally {
      if (entry.url) URL.revokeObjectURL(entry.url);
      entry.url = undefined;
      entry.uploaded = false;
      entries.delete(entry.key);
    }
  }
  function referenced(entry: Entry, document: SceneAuthoringDocumentSpec, references = normalReferences(document)) {
    return referencesNormal(references, id(entry), name=>options.engine.textureId(name));
  }
  function bundle(entry: Entry): PlacementNormalAssetBundle {
    function base64(bytes: ArrayBuffer) {
      const view = new Uint8Array(bytes);
      let result = "";
      for (let i = 0; i < view.length; i += 16384)
        result += String.fromCharCode(...view.subarray(i, i + 16384));
      return btoa(result);
    }
    const color = entry.binding.textures.color,
      normal = entry.binding.textures.normal;
    return {
      format: "ferrum2d.sprite-normal.assets",
      version: 1,
      overwrite: false,
      document: entry.document,
      binding: structuredClone(entry.binding),
      report: structuredClone(entry.report),
      metadataJson: JSON.stringify(entry.report),
      manifest: {
        textures: {
          [color.asset]: color.asset + ".png",
          [normal.asset]: normal.asset + ".png",
        },
        textureOptions: {
          [color.asset]: { colorSpace: "srgb" },
          [normal.asset]: { colorSpace: "none" },
        },
      },
      files: [
        {
          path: color.asset + ".png",
          mediaType: "image/png",
          sha256: color.sha256,
          base64: base64(entry.source.png),
        },
        {
          path: normal.asset + ".png",
          mediaType: "image/png",
          sha256: normal.sha256,
          base64: base64(entry.png),
        },
      ],
    };
  }
  return {
    bundle,
    available: (entry:Entry,key:string) => !disposed && entries.get(entry.key) === entry && canUsePlacementAsset(entry,key,options.project?.()),
    claims: (key:string) => [...entries.values()].filter(entry=>canUsePlacementAsset(entry,key,options.project?.())).map(entry=>({binding:entry.binding,report:entry.report})),
    retainsColor: (assetId: string) => [...entries.values()].some(entry => entry.source.id === assetId),
    async prepare(
      source: PlacementFrameNormalSource,
      signal: AbortSignal,
      progress: (message: UiContent) => void,
    ) {
      signal.throwIfAborted();
      if (disposed) throw Error("Normal assets disposed");
      // Do not inherit PNG grid/animation controls: Aseprite rects define independent frames.
      const { frameSize: _grid, ...settings } = options.settings();
      const unique = source.frames.filter(
        (f, i, all) =>
          all.findIndex(
            (v) =>
              v.x === f.x &&
              v.y === f.y &&
              v.width === f.width &&
              v.height === f.height,
          ) === i,
      );
      for (let i = 0; i < unique.length; i++)
        for (const b of unique.slice(i + 1)) {
          const a = unique[i];
          if (
            a.x < b.x + b.width &&
            b.x < a.x + a.width &&
            a.y < b.y + b.height &&
            b.y < a.y + a.height
          )
            throw Error(
              "Overlapping frame rectangles require an explicit layout migration",
            );
        }
      let generator = options.host()?.generator;
      if (!generator)
        generator = JSON.parse(
          new TextDecoder().decode(
            await placementNormalRead(
              await fetch(
                new URL(
                  "./__ferrum-normal-generator/config.json",
                  location.href,
                ),
                { signal },
              ),
              65536,
            ),
          ),
        );
      signal.throwIfAborted();
      const key = await placementNormalHash(
        JSON.stringify([
          source.document,
          source.id,
          settings,
          generator,
          pipeline,
        ]),
      );
      signal.throwIfAborted();
      if (disposed) throw Error("Normal assets disposed");
      const existing = entries.get(key);
      if (existing) return { entry: existing, created: false };
      if (entries.size >= PLACEMENT_NORMAL_ASSET_LIMITS.entries) throw Error("Normal revision budget reached. Close a document.");
      const restored = options.restored?.().find(bundle => bundle.binding.textures.normal.asset === options.kind + "-normal." + key.slice(0,24));
      if (restored) {
        const claim=record(restored.report.source),frames=restored.report.frames;
        if (claim.assetId!==source.id||claim.jsonSha256!==source.jsonSha256||claim.pngSha256!==source.pngSha256||
          !Array.isArray(frames)||JSON.stringify(frames.map(raw=>{const f=record(raw);return {id:f.id,rect:f.rect};}))!==
          JSON.stringify(source.frames.map(f=>({id:f.id,rect:[f.x,f.y,f.width,f.height]})))) throw Error("Saved pixel normal source differs");
        const file=restored.files.find(file=>file.path===restored.binding.textures.normal.path);
        if(!file)throw Error("Saved normal PNG unavailable");
        const bytes=Uint8Array.from(atob(file.base64),character=>character.charCodeAt(0)).buffer;
        if(await placementNormalHash(bytes)!==restored.binding.textures.normal.sha256)throw Error("Saved normal PNG differs");
        signal.throwIfAborted();
        if (disposed) throw Error("Normal assets disposed");
        if([...entries.values()].reduce((n,e)=>n+e.png.byteLength,bytes.byteLength)>PLACEMENT_NORMAL_ASSET_LIMITS.bytes ||
          [...entries.values()].reduce((n,e)=>n+e.binding.width*e.binding.height,source.width*source.height)>PLACEMENT_NORMAL_ASSET_LIMITS.pixels)throw Error("Normal asset budget reached. Close a document.");
        const entry:Entry={key,document:source.document,source,binding:structuredClone(restored.binding),png:bytes,
          report:structuredClone(restored.report),uploaded:true,committed:true,persisted:true,project:options.project?.()};
        entries.set(key,entry);return {entry,created:false};
      }
      if (entries.size >= PLACEMENT_NORMAL_ASSET_LIMITS.entries)
        throw Error("Normal revision budget reached. Close a document.");
      const client = createSpriteNormalWorkerClient({ generator: generator! });
      let bitmap: ImageBitmap | undefined;
      const atlas = new Uint8Array(source.width * source.height * 4);
      for (let i = 0; i < atlas.length; i += 4) {
        atlas[i] = atlas[i + 1] = 128;
        atlas[i + 2] = 255;
      }
      const reports: { rect: number[]; id?: string; report: Record<string, unknown> }[] = [];
      let first: SpriteNormalWorkerResult | undefined;
      try {
        bitmap = await createImageBitmap(
          new Blob([source.png], { type: "image/png" }),
        );
        signal.throwIfAborted();
        for (const [index, frame] of unique.entries()) {
          progress(
            uiMessage(
              "Generating normals · {0}/{1} frames",
              index + 1,
              unique.length,
            ),
          );
          const crop = canvas(frame.width, frame.height);
          crop.context.drawImage(
            bitmap,
            frame.x,
            frame.y,
            frame.width,
            frame.height,
            0,
            0,
            frame.width,
            frame.height,
          );
          let bytes: ArrayBuffer;
          try {
            bytes = await png(crop.canvas, signal);
          } finally {
            crop.canvas.width = crop.canvas.height = 0;
          }
          const result = await client.generate(
            {
              name: `frame-${index}.png`,
              bytes: new Uint8Array(bytes),
              settings,
            },
            { signal },
          );
          signal.throwIfAborted();
          first ??= result;
          const pixels = await readAsepriteNormalPixels(
            result.normalPng,
            frame.width,
            frame.height,
            signal,
          );
          for (let row = 0; row < frame.height; row++)
            atlas.set(
              pixels.subarray(
                row * frame.width * 4,
                (row + 1) * frame.width * 4,
              ),
              ((frame.y + row) * source.width + frame.x) * 4,
            );
          reports.push({
            rect: [frame.x, frame.y, frame.width, frame.height],
            ...(options.kind === "pixel" ? { id: frame.id } : {}),
            report: result.report,
          });
        }
        const bytes = await writeAsepriteNormalPixels(
            source.width,
            source.height,
            atlas,
            signal,
          ),
          measured = await placementNormalMeasure(bytes);
        signal.throwIfAborted();
        const metadata = {
          format: "ferrum2d." + options.kind + "-normal.report",
          version: 1,
          pipeline,
          source: {
            assetId: source.id,
            jsonSha256: source.jsonSha256,
            pngSha256: source.pngSha256,
          },
          settings,
          frames: reports,
          output: {
            sha256: measured.sha256,
            width: measured.width,
            height: measured.height,
          },
        };
        const config = {
          path: options.kind + "-normal.config.json",
          sha256: await placementNormalHash(JSON.stringify(metadata)),
        };
        const report = { ...metadata, config };
        const reportJson = JSON.stringify(report);
        if (reportJson.length > 1024 * 1024)
          throw Error("Normal provenance exceeds 1 MiB");
        const normalId = options.kind + "-normal." + key.slice(0, 24);
        if (options.taken(normalId)) throw Error("Normal asset name conflict");
        const generatorMetadata = record(first!.report.generator);
        const binding = resolveSpriteNormalAssetBinding({
          format: "ferrum2d.sprite-normal.binding",
          version: 1,
          width: source.width,
          height: source.height,
          textures: {
            color: {
              asset: source.id,
              path: source.id + ".png",
              sha256: source.pngSha256,
              colorSpace: "srgb",
            },
            normal: {
              asset: normalId,
              path: normalId + ".png",
              sha256: measured.sha256,
              colorSpace: "none",
            },
          },
          frames: [{ u0: 0, v0: 0, u1: 1, v1: 1 }],
          generation: {
            repository: generatorMetadata.repository,
            revision: generatorMetadata.revision,
            binarySha256: generatorMetadata.binarySha256,
            configSha256: config.sha256,
            settings: {
              pipeline,
              ...settings,
              jsonSha256: source.jsonSha256,
            },
            input: { path: source.pngName, sha256: source.pngSha256 },
          },
        });
        signal.throwIfAborted();
        if (disposed) throw Error("Normal assets disposed");
        if (
          entries.size >= PLACEMENT_NORMAL_ASSET_LIMITS.entries ||
          [...entries.values()].reduce(
            (n, e) => n + e.png.byteLength,
            bytes.byteLength,
          ) > PLACEMENT_NORMAL_ASSET_LIMITS.bytes ||
          [...entries.values()].reduce(
            (n, e) => n + e.binding.width * e.binding.height,
            source.width * source.height,
          ) > PLACEMENT_NORMAL_ASSET_LIMITS.pixels
        )
          throw Error("Normal asset budget reached. Close a document.");
        const entry: Entry = {
          key,
          document: source.document,
          source,
          binding,
          png: bytes,
          report,
          uploaded: false,
          committed: false,
          persisted: false,
        };
        entries.set(key, entry);
        return { entry, created: true };
      } finally {
        bitmap?.close();
        client.destroy();
      }
    },
    async upload(entry: Entry, signal: AbortSignal) {
      signal.throwIfAborted();
      if (entry.uploaded) return;
      if (disposed || entries.get(entry.key) !== entry)
        throw Error("Normal assets disposed");
      if (options.taken(id(entry))) throw Error("Normal asset name conflict");
      entry.url = URL.createObjectURL(
        new Blob([entry.png], { type: "image/png" }),
      );
      try {
        await options.engine.loadAssets({
          textures: { [id(entry)]: entry.url },
          textureOptions: { [id(entry)]: { colorSpace: "none", signal } },
        });
        signal.throwIfAborted();
        if (disposed || entries.get(entry.key) !== entry)
          throw Error("Normal assets disposed");
        entry.uploaded = true;
      } catch (error) {
        discard(entry, disposed);
        throw error;
      }
    },
    activate(
      entry: Entry,
      document: SceneAuthoringDocumentSpec,
      patch: ScenePlacementPatch,
      apply: () => void,
      documentKey = entry.document,
    ) {
      if (disposed || entries.get(entry.key) !== entry || !entry.uploaded ||
        !canUsePlacementAsset(entry,documentKey,options.project?.()))
        throw Error("Generated normals belong to another document or were closed");
      const next = mergeScenePlacementPatch(document, patch).document;
      const additions = patch.operations.map((op) => {
        if (op.kind !== "updateComponents")
          throw Error("Unsupported normal component operation");
        const components = record(op.components),
          visual = record(components.visual);
        const binding = resolveSpriteNormalAssetBinding({
          ...entry.binding,
          ...asepriteNormalLayout(visual),
        });
        return createSceneSpriteNormalPatch(next, binding, {
          instanceId: op.instanceId,
          assets: [
            {
              id: binding.textures.color.asset,
              width: binding.width,
              height: binding.height,
              sha256: binding.textures.color.sha256,
              colorSpace: "srgb",
            },
            {
              id: binding.textures.normal.asset,
              width: binding.width,
              height: binding.height,
              sha256: binding.textures.normal.sha256,
              colorSpace: "none",
            },
          ],
        }).evidence;
      });
      const previous = new Map(evidence);
      for (const item of additions)
        evidence.set(
          JSON.stringify([
            documentKey,
            entry.key,
            item.instanceId,
            item.binding.frames,
            item.binding.animationSet,
          ]),
          item,
        );
      try {
        apply();
        entry.committed = true;
      } catch (error) {
        evidence.clear();
        for (const [key, value] of previous) evidence.set(key, value);
        throw error;
      }
    },
    discard,
    bindings(
      document: string,
      current?: SceneAuthoringDocumentSpec,
      state?: ScenePlacementViewerState,
    ) {
      return [...evidence]
        .filter(([key]) => JSON.parse(key)[0] === document)
        .map(([, value]) => value)
        .filter((value) => {
          if (!current || !state) return true;
          try {
            createScenePlacementAgentHandoff({
              document: current,
              state: { ...state, draftPatch: undefined },
              normalBindings: [value],
            });
            return true;
          } catch {
            return false;
          }
        });
    },
    bundles(document: string, current?: SceneAuthoringDocumentSpec) {
      return [...entries.values()]
        .filter(
          (e) =>
            canUsePlacementAsset(e, document, options.project?.()) &&
            e.committed &&
            (!current || referenced(e, current)),
        )
        .map(bundle);
    },
    blocksSave(document: SceneAuthoringDocumentSpec, key: string) {
      const references = normalReferences(document), numeric = new Set([...references].filter(value=>typeof value==="number"));
      return [...entries.values()].some(e => {
        return referencesNormal(numeric,id(e),name=>options.engine.textureId(name)) ||
          ((!canUsePlacementAsset(e,key,options.project?.()) || !e.persisted) && referenced(e,document,references));
      });
    },
    assertDocumentAssets(document: SceneAuthoringDocumentSpec, key: string, project?: string) {
      if (
        [...entries.values()].some(
          (e) => !canUsePlacementAsset(e, key, project) && referenced(e, document),
        )
      )
        throw Error("Generated normals belong to another document");
    },
    async save(
      document: SceneAuthoringDocumentSpec,
      key: string,
      signal: AbortSignal,
      preview?: Entry,
    ) {
      const pending = [...entries.values()].filter(
        (e) => e.document === key && !e.persisted && (referenced(e, document) || e === preview),
      );
      const host = options.host();
      if (pending.length && !host?.saveAssets)
        throw Error(
          "Normal asset save host unavailable. Export assets and patch before closing.",
        );
      for (const entry of pending) {
        const result = await host!.saveAssets!(bundle(entry), { signal });
        signal.throwIfAborted();
        if (
          disposed ||
          entries.get(entry.key) !== entry ||
          host !== options.host()
        )
          throw Error("Normal save context changed");
        if (result.registered !== true)
          throw Error("Host did not register generated normals");
        for (const texture of Object.values(entry.binding.textures)) {
          const rawUrl = result.textures[texture.asset];
          if (typeof rawUrl !== "string" || !rawUrl)
            throw Error("Missing saved normal asset URL");
          const url = new URL(rawUrl, location.href);
          if (
            !["http:", "https:", "ferrum-asset:"].includes(url.protocol) ||
            url.username ||
            url.password
          )
            throw Error("Host must return durable asset URLs");
          const actual = await placementNormalMeasure(
            await placementNormalRead(
              await fetch(url, { signal, cache: "no-store" }),
              40 * 1024 * 1024,
            ),
          );
          if (
            actual.sha256 !== texture.sha256 ||
            actual.width !== entry.binding.width ||
            actual.height !== entry.binding.height
          )
            throw Error("Saved normal asset differs");
        }
        signal.throwIfAborted();
        if (
          disposed ||
          entries.get(entry.key) !== entry ||
          host !== options.host()
        )
          throw Error("Normal save context changed");
        entry.persisted = true;entry.committed = true;
        entry.project = options.project?.();
      }
    },
    close(document: string) {
      for (const entry of entries.values())
        if (entry.document === document && !isPlacementProjectAsset(entry)) discard(entry);
      for (const key of evidence.keys())
        if (JSON.parse(key)[0] === document) evidence.delete(key);
    },
    destroy() {
      disposed = true;
      for (const entry of entries.values()) discard(entry, true);
      evidence.clear();
    },
  };
}
