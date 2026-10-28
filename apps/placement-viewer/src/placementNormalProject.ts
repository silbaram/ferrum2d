import {
  asepriteNormalLayout,
  asepriteUvKey,
} from "./placementAsepriteAnimation";
import {
  createSpriteNormalAssetBinding,
  resolveSpriteNormalAssetBinding,
  createScenePlacementAgentHandoff,
  instantiateSceneFragment,
  type SceneAuthoringDocumentSpec,
  type ScenePlacementViewerState,
  type SceneSpriteNormalBindingEvidence,
} from "@ferrum2d/ferrum-web/authoring";
import type { FerrumRuntime } from "@ferrum2d/ferrum-web/core";
import {
  placementNormalHash,
  placementNormalRead,
  placementNormalMeasure,
  type PlacementNormalAssetBundle,
  type PlacementNormalAssetHost,
} from "./placementNormalAssets";

interface Catalog {
  format: "ferrum2d.sprite-normal.project";
  version: 1;
  registered: true;
  entries: { sha256: string; metadataUrl: string }[];
  textures: Record<string, string>;
}
interface Pair {
  bundle: PlacementNormalAssetBundle;
  pngs: ArrayBuffer[];
}
type Invoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;
const fail = (message: string): never => {
  throw Error("Normal project: " + message);
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("expected an object");
  return value as Record<string, unknown>;
}
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
};
function url(value: unknown) {
  if (typeof value !== "string" || !value) return fail("missing durable URL");
  const result = new URL(value, location.href);
  if (
    !["http:", "https:", "ferrum-asset:"].includes(result.protocol) ||
    result.username ||
    result.password
  )
    fail("expected a durable asset URL");
  return result.href;
}

/** Bound to the already authorized project; cancellation never claims to undo committed files. */
export function createDesktopNormalProjectHost(
  invoke: Invoke,
  project: string,
): PlacementNormalAssetHost & {
  load(signal: AbortSignal): Promise<Catalog>;
} {
  return {
    async load(signal) {
      signal.throwIfAborted();
      const value = await invoke<Catalog>("load_placement_normal_assets", {
        projectPath: project,
      });
      signal.throwIfAborted();
      return value;
    },
    async saveAssets(bundle, { signal }) {
      signal.throwIfAborted();
      await validateBundle({ ...bundle, files: [] }, signal);
      // Preserve JSON key order for descriptor/config hashes across Rust serde round trips.
      const metadataJson = JSON.stringify({ ...bundle, files: [] });
      if (new TextEncoder().encode(metadataJson).length > 4 * 1024 * 1024)
        fail("metadata exceeds 4 MiB");
      const result = await invoke<Catalog>("save_placement_normal_assets", {
        projectPath: project,
        metadataJson,
        files: bundle.files,
      });
      signal.throwIfAborted();
      const restored = await readPlacementNormalProject(result, signal);
      if (
        !restored.pairs.some(
          (pair) =>
            canonical(pair.bundle.binding) === canonical(bundle.binding),
        )
      )
        fail("host did not register the requested pair");
      return { registered: true, textures: result.textures };
    },
  };
}

/** Validate provenance claims against measured PNGs; do not treat report paths as file permissions. */
async function validateBundle(value: unknown, signal: AbortSignal) {
  const bundle = record(value);
  if (
    bundle.format !== "ferrum2d.sprite-normal.assets" ||
    bundle.version !== 1 ||
    bundle.overwrite !== false ||
    !Array.isArray(bundle.files) ||
    bundle.files.length ||
    typeof bundle.document !== "string" ||
    !bundle.document ||
    typeof bundle.metadataJson !== "string"
  )
    fail("invalid saved bundle metadata");
  const binding = resolveSpriteNormalAssetBinding(bundle.binding),
    report = record(bundle.report);
  JSON.parse(bundle.metadataJson as string);
  if (report.format === "ferrum2d.aseprite-normal.report") {
    const { config, ...content } = report,
      source = record(report.source),
      output = record(report.output),
      generation = binding.generation;
    const frames = report.frames;
    if (
      report.version !== 1 ||
      report.pipeline !== "aseprite-rects-v1" ||
      canonical(JSON.parse(bundle.metadataJson as string)) !==
        canonical(report) ||
      record(config).sha256 !== generation.configSha256 ||
      (await placementNormalHash(JSON.stringify(content))) !==
        generation.configSha256 ||
      source.assetId !== binding.textures.color.asset ||
      source.pngSha256 !== binding.textures.color.sha256 ||
      source.pngSha256 !== generation.input.sha256 ||
      source.jsonSha256 !== generation.settings.jsonSha256 ||
      output.sha256 !== binding.textures.normal.sha256 ||
      output.width !== binding.width ||
      output.height !== binding.height ||
      !Array.isArray(frames) ||
      !frames.length ||
      frames.length > 256
    )
      fail("Aseprite normal provenance differs");
    for (const frame of frames as unknown[]) {
      const entry = record(frame),
        generated = record(entry.report),
        generator = record(generated.generator),
        rect = entry.rect;
      if (
        generated.ok !== true ||
        generated.format !== "ferrum2d.sprite-normals.report" ||
        generated.normalFormat !== "opengl" ||
        generated.colorSpace !== "none" ||
        generator.repository !== generation.repository ||
        generator.revision !== generation.revision ||
        generator.binarySha256 !== generation.binarySha256 ||
        !Array.isArray(rect) ||
        rect.length !== 4 ||
        rect.some((n) => !Number.isInteger(n) || n < 0) ||
        rect[2] < 1 ||
        rect[3] < 1 ||
        rect[0] + rect[2] > binding.width ||
        rect[1] + rect[3] > binding.height
      )
        fail("invalid per-frame normal provenance");
    }
  } else {
    const descriptorSha256 =
      bundle.descriptor === undefined
        ? undefined
        : await placementNormalHash(
            JSON.stringify(bundle.descriptor, null, 2) + "\n",
          );
    const actual = createSpriteNormalAssetBinding({
      report,
      descriptor: bundle.descriptor,
      descriptorSha256,
      colorAsset: binding.textures.color.asset,
      normalAsset: binding.textures.normal.asset,
    });
    if (canonical(actual) !== canonical(binding))
      fail("generation report/descriptor differs from binding");
  }
  signal.throwIfAborted();
  const manifest = record(bundle.manifest),
    textures = record(manifest.textures),
    options = record(manifest.textureOptions);
  if (Object.keys(textures).length !== 2 || Object.keys(options).length !== 2)
    fail("unexpected manifest entries");
  for (const texture of Object.values(binding.textures)) {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,255}$/.test(texture.asset) ||
      textures[texture.asset] !== texture.asset + ".png" ||
      record(options[texture.asset]).colorSpace !== texture.colorSpace
    )
      fail("invalid texture manifest");
  }
  return { ...bundle, binding } as unknown as PlacementNormalAssetBundle;
}

export async function readPlacementNormalProject(
  value: Catalog,
  signal: AbortSignal,
) {
  if (
    value?.format !== "ferrum2d.sprite-normal.project" ||
    value.version !== 1 ||
    value.registered !== true ||
    !Array.isArray(value.entries) ||
    value.entries.length > 8
  )
    fail("invalid project catalog");
  record(value.textures);
  const pairs: Pair[] = [],
    seen = new Set<string>(),
    textures = new Map<
      string,
      {
        sha256: string;
        colorSpace: "srgb" | "none";
        width: number;
        height: number;
        url: string;
      }
    >();
  let bytes = 0,
    pixels = 0;
  for (const entry of value.entries) {
    signal.throwIfAborted();
    if (
      !entry ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      seen.has(entry.sha256)
    )
      fail("duplicate or invalid metadata identity");
    seen.add(entry.sha256);
    const metadata = await placementNormalRead(
      await fetch(url(entry.metadataUrl), { signal, cache: "no-store" }),
      4 * 1024 * 1024,
    );
    if ((await placementNormalHash(metadata)) !== entry.sha256)
      fail("metadata SHA-256 differs");
    const bundle = await validateBundle(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(metadata)),
        signal,
      ),
      pngs: ArrayBuffer[] = [];
    pixels += bundle.binding.width * bundle.binding.height * 2;
    if (pixels > 8_388_608) fail("decoded pixel budget exceeds 8 MP");
    for (const texture of Object.values(bundle.binding.textures)) {
      const durable = url(value.textures[texture.asset]),
        png = await placementNormalRead(
          await fetch(durable, { signal, cache: "no-store" }),
          16 * 1024 * 1024,
        );
      bytes += png.byteLength;
      if (bytes > 64 * 1024 * 1024) fail("PNG budget exceeds 64 MiB");
      const actual = await placementNormalMeasure(png),
        existing = textures.get(texture.asset);
      const measured = {
        ...actual,
        colorSpace: texture.colorSpace,
        url: durable,
      };
      if (
        actual.sha256 !== texture.sha256 ||
        actual.width !== bundle.binding.width ||
        actual.height !== bundle.binding.height ||
        (existing && canonical(existing) !== canonical(measured))
      )
        fail("saved texture hash, dimensions or name conflict");
      textures.set(texture.asset, measured);
      pngs.push(png);
    }
    pairs.push({ bundle, pngs });
  }
  if (Object.keys(value.textures).length !== textures.size)
    fail("unexpected registered textures");
  signal.throwIfAborted();
  return { pairs, textures };
}

/** Own only textures absent from the source atlas store. Scene/runtime state stays in the engine. */
export function createPlacementNormalProjectAssets(
  engine: FerrumRuntime["engine"],
  documentKey: string,
  projectPath?: string,
) {
  const available = (key: string, project?: string) => projectPath ? projectPath === project : key === documentKey;
  let restored:
      | Awaited<ReturnType<typeof readPlacementNormalProject>>
      | undefined,
    disposed = false;
  const lifetime = new AbortController();
  const owned = new Map<string, string>();
  let bindingCache:
    | {
        signature: string;
        fragment: string;
        result: SceneSpriteNormalBindingEvidence[];
      }
    | undefined;
  function destroy() {
    if (disposed) return;
    disposed = true;
    lifetime.abort();
    const textures = [...owned].map(([name, url]) => ({
      kind: "texture" as const,
      name,
      url,
    }));
    try {
      engine.releaseAssets({
        entries: textures,
        textures,
        sounds: [],
        json: [],
        total: textures.length,
      });
    } catch {
      /* Engine shutdown may have already released the platform textures. */
    }
    owned.clear();
    restored = undefined;
    bindingCache = undefined;
    window.removeEventListener("pagehide", pagehide, true);
  }
  function pagehide(event: PageTransitionEvent) {
    if (!event.persisted) destroy();
  }
  window.addEventListener("pagehide", pagehide, true);
  return {
    has(id: string) {
      return restored?.textures.has(id) ?? false;
    },
    async load(
      value: Catalog,
      shared: Map<string, { sha256: string; colorSpace: "srgb" | "none" }>,
      taken: (id: string) => boolean,
      externalSignal: AbortSignal,
    ) {
      const signal = AbortSignal.any([externalSignal, lifetime.signal]);
      const next = await readPlacementNormalProject(value, signal);
      if (disposed) fail("assets closed");
      for (const [id, texture] of next.textures) {
        const existing = shared.get(id);
        if (existing) {
          if (
            texture.sha256 !== existing.sha256 ||
            texture.colorSpace !== existing.colorSpace
          )
            fail("source atlas and normal catalog conflict");
          continue;
        }
        if (taken(id)) fail("existing texture name conflict");
        owned.set(id, texture.url);
      }
      try {
        await engine.loadAssets({
          textures: Object.fromEntries(owned),
          textureOptions: Object.fromEntries(
            [...owned].map(([id]) => [
              id,
              { colorSpace: next.textures.get(id)!.colorSpace, signal },
            ]),
          ),
        });
        signal.throwIfAborted();
        if (disposed) fail("assets closed");
        restored = next;
        bindingCache = undefined;
      } catch (error) {
        destroy();
        throw error;
      }
    },
    browserEntries(key: string, project?: string) {
      if (!available(key, project) || !restored) return [];
      return [
        ...new Set(
          restored.pairs.map((p) => p.bundle.binding.textures.color.asset),
        ),
      ].map((id) => ({ id, ...restored!.textures.get(id)! }));
    },
    bundles(key: string, current: SceneAuthoringDocumentSpec, project?: string) {
      if (!available(key, project)) return [];
      const references = new Set(
        Object.values(current.spatial?.billboards ?? {}).map(
          (b) => b.normalTexture,
        ),
      );
      return (restored?.pairs ?? [])
        .filter((p) => references.has(p.bundle.binding.textures.normal.asset))
        .map((pair) => ({
          ...pair.bundle,
          files: Object.values(pair.bundle.binding.textures).map(
            (texture, index) => {
              const bytes = new Uint8Array(pair.pngs[index]);
              let text = "";
              for (let i = 0; i < bytes.length; i += 16384)
                text += String.fromCharCode(...bytes.subarray(i, i + 16384));
              return {
                path: texture.asset + ".png",
                mediaType: "image/png" as const,
                sha256: texture.sha256,
                base64: btoa(text),
              };
            },
          ),
        }));
    },
    bindings(
      key: string,
      current: SceneAuthoringDocumentSpec,
      state: ScenePlacementViewerState,
      project?: string,
    ) {
      const result: SceneSpriteNormalBindingEvidence[] = [];
      if (!available(key, project) || !restored) return result;
      const signature = JSON.stringify(current);
      if (
        bindingCache?.signature === signature &&
        bindingCache.fragment === state.fragment
      )
        return bindingCache.result;
      for (const instance of instantiateSceneFragment(
        current.sceneComposition,
        { fragment: state.fragment },
      )) {
        const components = instance.props.components as
            | Record<string, unknown>
            | undefined,
          visual = components?.visual as Record<string, unknown> | undefined;
        if (!visual) continue;
        const candidates: SceneSpriteNormalBindingEvidence[] = [];
        for (const pair of restored.pairs) {
          if (
            pair.bundle.binding.textures.color.asset !==
              (visual.texture ?? visual.asset) ||
            pair.bundle.binding.textures.normal.asset !==
              current.spatial?.billboards[instance.id]?.normalTexture
          )
            continue;
          let binding = pair.bundle.binding;
          try {
            if (
              pair.bundle.report.format === "ferrum2d.aseprite-normal.report"
            ) {
              const layout = asepriteNormalLayout(visual),
                known = new Set(
                  (pair.bundle.report.frames as { rect: number[] }[]).map(
                    ({ rect: [x, y, w, h] }) =>
                      asepriteUvKey({
                        u0: x / binding.width,
                        v0: y / binding.height,
                        u1: (x + w) / binding.width,
                        v1: (y + h) / binding.height,
                      }),
                  ),
                );
              if (
                !layout.frames.every((frame) => known.has(asepriteUvKey(frame)))
              )
                continue;
              binding = resolveSpriteNormalAssetBinding({
                ...binding,
                ...layout,
              });
            }
            const evidence = { instanceId: instance.id, binding };
            createScenePlacementAgentHandoff({
              document: current,
              state: { ...state, draftPatch: undefined },
              normalBindings: [evidence],
            });
            candidates.push(evidence);
          } catch {
            /* Edited scenes do not retain stale imported provenance. */
          }
        }
        if (
          candidates.length &&
          candidates.every(
            (item) =>
              canonical(item.binding) === canonical(candidates[0].binding),
          )
        )
          result.push(candidates[0]);
      }
      bindingCache = { signature, fragment: state.fragment, result };
      return result;
    },
    assertDocumentAssets(current: SceneAuthoringDocumentSpec, key: string, project?: string) {
      if (
        !available(key, project) &&
        restored &&
        [...restored.textures.keys()].some((id) =>
          JSON.stringify(current).includes(JSON.stringify(id)),
        )
      )
        fail(
          "install generated assets before copying them to another document",
        );
    },
    close(key: string) {
      if (!projectPath && key === documentKey) destroy();
    },
    destroy,
  };
}
