import {admittedResourceRoster} from "./nativeFileResourceRoster.js";
import type {NativeFileAuthoringResources} from "./nativeFileAuthoringBindings.js";
/** @internal Resource-only participant. Root owns native candidate, session
 * epoch/fence, Ready, and the single publication. No public importer/runner. */
import { ResourceBudget, resourceKeys, NativeFileResourceError } from "./nativeFileResourceBudget.js";
import { encodeNativeFileResourceGraph, decodeNativeFileResourceGraph } from "./nativeFileResourceCodec.js";
import { inspectResourceFacade, platformAssetFileOwner, textureFileOwner, audioFileOwner, adoptPlatformFileAudio, assertResourceCaptureFence, type ResourceAssetData, type ResourceTextureData, type ResourceAudioData, type DetachedResourceOwner, type DetachedAudioResourceOwner } from "./nativeFileResourceOwners.js";
import { captureModelResources, prepareModelResources, prepareResourceModelRegistry, prepareResourceModelCache, disposeResourceModels, type ResourceModelData } from "./nativeFileResourceModels.js";
import { resourceModelCacheOwner } from "./nativeFileResourceModelCaches.js";
import { renderTextureFileOwner, type ResourceRenderTextureData, type PreparedRenderTextures } from "./nativeFileResourceRenderTextures.js";
import { captureBoundResourceFonts, prepareBoundResourceFonts, type ResourceBoundFontData, type PreparedBoundResourceFonts } from "./nativeFileResourceFontBindings.js";
import { captureNativeFileHostBindingFence, nativeFileHostBindingFenceUnchanged } from "./nativeFileHostBindings.js";
interface ResourceSessionData {
    readonly version: 1;
    readonly assets?: ResourceAssetData;
    readonly textures?: ResourceTextureData;
    readonly audio?: ResourceAudioData;
    readonly renderTextures?: ResourceRenderTextureData;
    readonly models: ResourceModelData;
    readonly fonts?: ResourceBoundFontData;
}
/** These are private owned section bytes; caller must not mutate/share them. */
export interface CapturedResourceSession {
    readonly manifestBytes: Uint8Array;
    readonly dataBytes: Uint8Array;
    readonly authoringResources:NativeFileAuthoringResources;
    assertCurrent(): void;
}
export async function captureNativeFileResourceSession(engine: object, b: ResourceBudget): Promise<CapturedResourceSession> {
    const state = inspectResourceFacade(engine), host = state.assetHost, assets = host === undefined ? undefined : platformAssetFileOwner(host), renderer = assets?.textureOwner, texture = renderer === undefined ? undefined : textureFileOwner(renderer), audio = assets?.audioOwner === undefined ? undefined : audioFileOwner(assets.audioOwner);
    const assetRevision = assets?.revision(), textureRevision = texture?.revision(), audioRevision = audio?.revision(), rt = renderer === undefined ? undefined : renderTextureFileOwner(renderer), rtRevision = rt?.revision(), cache = renderer === undefined ? undefined : resourceModelCacheOwner(renderer)?.capture(b), hostFence = captureNativeFileHostBindingFence(engine);
    const assetData = await assets?.capture(b), textureData = await texture?.capture(b), audioData = await audio?.capture(b), renderData = rt?.capture(b), models = await captureModelResources(state.rustEngine, b, renderer), fonts = state.fontFaceSet === undefined ? undefined : await captureBoundResourceFonts(engine, state.fontFaceSet, b);
    const assertCurrent = () => { const now = inspectResourceFacade(engine); if (now.rustEngine !== state.rustEngine || now.assetHost !== host || now.fontFaceSet !== state.fontFaceSet || assets && assets.revision() !== assetRevision || texture && texture.revision() !== textureRevision || audio && audio.revision() !== audioRevision || rt && rt.revision() !== rtRevision || !nativeFileHostBindingFenceUnchanged(engine, hostFence))
        return b.fail("STALE", "resource session capture cut"); cache?.assertCurrent(); if (assetData)
        assertResourceCaptureFence(assetData, b); if (audioData)
        assertResourceCaptureFence(audioData, b); if (textureData?.backend === "webgl2")
        assertResourceCaptureFence(textureData, b); };
    assertCurrent();
    const graph: ResourceSessionData = { version: 1, models, ...(assetData === undefined ? {} : { assets: assetData }), ...(textureData === undefined ? {} : { textures: textureData }), ...(audioData === undefined ? {} : { audio: audioData }), ...(renderData === undefined ? {} : { renderTextures: renderData }), ...(fonts === undefined ? {} : { fonts }) };
    const authoringResources=await admittedResourceRoster(graph,b);
    const sections = encodeNativeFileResourceGraph(graph, b);
    assertCurrent();
    return Object.freeze({ ...sections, authoringResources,assertCurrent });
}
/** Caller passes a fresh, stopped, unpublished SDK facade. All preparation and
 * failures concern that new target only; dispose its whole host/renderer after
 * any adoption failure. Publication/old-live disposal remain Root-owned. */
export async function prepareNativeFileResourceSession(engine: object, manifestBytes: Uint8Array, dataBytes: Uint8Array, b: ResourceBudget) {
    const state = inspectResourceFacade(engine), host = state.assetHost, assets = host === undefined ? undefined : platformAssetFileOwner(host), renderer = assets?.textureOwner;
    const data = decodeNativeFileResourceGraph(manifestBytes, dataBytes, b) as ResourceSessionData;
    resourceKeys(data, ["version", "assets", "textures", "audio", "renderTextures", "models", "fonts"], b);
    if (data.version !== 1 || !data.models)
        return b.fail("DATA", "resource session version/model owner");
    if ((data.assets !== undefined) !== (assets !== undefined) || (data.textures !== undefined) !== (renderer !== undefined) || (data.audio !== undefined) !== (assets?.audioOwner !== undefined) || (data.fonts !== undefined) !== (state.fontFaceSet !== undefined))
        return b.fail("CAPABILITY", "actual target resource owner roster");
    const rt = renderer === undefined ? undefined : renderTextureFileOwner(renderer);
    if ((data.renderTextures !== undefined) !== (rt !== undefined))
        return b.fail("CAPABILITY", "target render texture owner");
    if (data.textures && data.renderTextures) {
        b.work(data.textures.entries.length + data.renderTextures.entries.length);
        const ids = new Set<number>();
        for (const row of data.textures.entries) {
            b.work(row.ids.length);
            for (const id of row.ids)
                ids.add(id);
        }
        for (const row of data.renderTextures.entries)
            if (ids.has(row.id))
                return b.fail("DATA", "asset/render texture ID collision");
    }
    let asset: DetachedResourceOwner | undefined, texture: DetachedResourceOwner | undefined, audio: DetachedAudioResourceOwner | undefined, render: PreparedRenderTextures | undefined, font: PreparedBoundResourceFonts | undefined, models: Awaited<ReturnType<typeof prepareModelResources>> | undefined, registry: ReturnType<typeof prepareResourceModelRegistry> | undefined, cache: Awaited<ReturnType<typeof prepareResourceModelCache>> | undefined, adopted = false, disposed = false;
    const cleanup = async () => { if (disposed)
        return; let error: unknown; for (const item of [font, render, texture, asset, audio, registry])
        try {
            await item?.dispose();
        }
        catch (e) {
            error ??= e;
        } if (models)
        disposeResourceModels(models); if (error)
        throw error; disposed = true; };
    try {
        models = await prepareModelResources(data.models, b);
        registry = prepareResourceModelRegistry(models, state.rustEngine, b);
        if (data.assets)
            asset = await assets!.prepare(data.assets, b);
        if (data.textures)
            texture = await textureFileOwner(renderer!).prepare(data.textures, b);
        if (data.audio)
            audio = await audioFileOwner(assets!.audioOwner!).prepare(data.audio, b);
        if (data.renderTextures)
            render = rt!.prepare(data.renderTextures, b);
        if (renderer)
            cache = await prepareResourceModelCache(models, renderer, b);
        if (data.fonts)
            font = await prepareBoundResourceFonts(engine, state.fontFaceSet!, data.fonts, b);
        const authoringResources=await admittedResourceRoster(data,b);
        const assertCurrent = () => { if (disposed || adopted)
            return b.fail("STALE", "resource preparation lease"); const now = inspectResourceFacade(engine); if (now.rustEngine !== state.rustEngine || now.assetHost !== host || now.fontFaceSet !== state.fontFaceSet)
            return b.fail("STALE", "new target facade binding"); registry!.assertCurrent(); cache?.assertCurrent(); render?.assertCurrent(); font?.assertCurrent(); };
        assertCurrent();
        return Object.freeze({ assertCurrent, authoringResources,renderTextureHandles: render?.handles,
            /** Call before Root's synchronous shared-platform publication. */
            adopt: () => { assertCurrent(); texture?.adopt?.(); render?.adopt(); if (audio)
                adoptPlatformFileAudio(host!, audio); asset?.adopt?.(); registry!.adopt(); adopted = true; },
            fontPublication: () => { if (disposed)
                return b.fail("STALE", "resource font lease"); return font?.publication(b); },
            /** After Root publication, starts portable intents only. Never drains Rust audio. */
            activateAudio: () => { if (!adopted || disposed)
                return b.fail("STALE", "resource activation order"); return audio?.activate(); },
            dispose: cleanup });
    }
    catch (error) {
        await cleanup();
        if (error instanceof NativeFileResourceError)
            throw error;
        throw new NativeFileResourceError("CAPABILITY", "resource target preparation");
    }
}
