/** @internal External font bytes are supplied by an actual pre-registered host
 * owner. The SDK checks descriptors, ordinals, immutable copies and fences; it
 * cannot independently inspect an OS font's private storage or prove that a
 * trusted adapter's Blob corresponds to an opaque FontFace. No file-defined code. */
import { defineNativeFileHostBindingType, registerNativeFileHostBinding, captureNativeFileHostBinding, resolveNativeFileHostBinding, captureNativeFileHostBindingFence, nativeFileHostBindingFenceUnchanged, prepareNativeFileHostBindings, resolvePreparedNativeFileHostBinding, consumePreparedNativeFileHostBindings, discardPreparedNativeFileHostBindings, type NativeFileHostBindingReference, type NativeFileHostBindingRequest, } from "./nativeFileHostBindings.js";
import { ResourceBudget, resourceKeys, resourceInteger, NativeFileResourceError } from "./nativeFileResourceBudget.js";
import { captureResourceSource, type ResourceSourceBytes } from "./nativeFileResourceOwners.js";
import { captureResourceFonts, prepareResourceFonts, disposeResourceFonts, copyResourceFontData, prepareResourceFontPublication, associatePreparedResourceFontPolicies, captureResourceNativeFontSetFence, resourceNativeFontSetFenceUnchanged, forgetResourceNativeFontSetFence, type ResourceNativeFontSetFence, resourceFontFaceFacts, validateResourceFontEncoding, type ResourceFontData, type ResourceFontPublication, } from "./nativeFileResourceFonts.js";
import type { FontFaceSetLike, ResolvedWebFontPolicy } from "./localization.js";
export interface ResourceHostFontSelection {
    readonly faces: readonly {
        /** Actual host-owned identity; equal-valued distinct owners remain distinct. */
        readonly identity: object;
        readonly face?: FontFace;
        /** Virtual OS/custom owner needs these actual bytes/facts from its adapter. */
        readonly descriptors?: Readonly<Record<string, string>>;
        readonly source?: {
            readonly blob: Blob;
            readonly url: string;
        };
    }[];
    readonly bindings: readonly {
        readonly policyId: string;
        readonly faces: readonly number[];
    }[];
}
export interface ResourceFontSetHostAdapter {
    readonly fontSet: FontFaceSetLike;
    readRevision(): number | string;
    captureCurrent(policies: readonly ResolvedWebFontPolicy[], budget: ResourceBudget): Promise<ResourceHostFontSelection>;
    /** Trusted target authority may restrict the embedded fonts it can accept.
     * It runs during detached preparation, never during default Set publication. */
    acceptFile(data: ResourceExternalFonts, budget: ResourceBudget): void | Promise<void>;
}
export interface ResourceFontFaceHostAdapter {
    readonly face: FontFace;
    readonly source: {
        readonly blob: Blob;
        readonly url: string;
    };
    readRevision(): number | string;
}
function frozenFields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (!value || typeof value !== "object" || !Object.isFrozen(value))
        return false;
    return keys.every(key => { const d = Object.getOwnPropertyDescriptor(value, key); return d && "value" in d; });
}
export const RESOURCE_FONT_SET_BINDING = defineNativeFileHostBindingType<ResourceFontSetHostAdapter>("ferrum.resource.font-set", 1, (value, identity): value is ResourceFontSetHostAdapter => frozenFields(value, ["fontSet", "readRevision", "captureCurrent", "acceptFile"]) && value.fontSet === identity
    && typeof value.readRevision === "function" && typeof value.captureCurrent === "function" && typeof value.acceptFile === "function");
function actualFontFace(value: unknown): boolean {
    try {
        const get = typeof FontFace === "undefined" ? undefined : Object.getOwnPropertyDescriptor(FontFace.prototype, "status")?.get;
        return !!get && typeof get.call(value) === "string";
    }
    catch {
        return false;
    }
}
export const RESOURCE_FONT_FACE_BINDING = defineNativeFileHostBindingType<ResourceFontFaceHostAdapter>("ferrum.resource.font-face", 1, (value, identity): value is ResourceFontFaceHostAdapter => frozenFields(value, ["face", "source", "readRevision"]) && value.face === identity && actualFontFace(value.face) && typeof value.readRevision === "function"
    && !!value.source && typeof value.source === "object" && Object.isFrozen(value.source)
    && Object.getOwnPropertyDescriptor(value.source, "blob")?.value instanceof Blob
    && typeof Object.getOwnPropertyDescriptor(value.source, "url")?.value === "string");
export function registerResourceFontSetBinding(owner: object, symbol: string, adapter: ResourceFontSetHostAdapter): void {
    registerNativeFileHostBinding(owner, RESOURCE_FONT_SET_BINDING, symbol, adapter, adapter.fontSet);
}
export function registerResourceFontFaceBinding(owner: object, symbol: string, adapter: ResourceFontFaceHostAdapter): void {
    registerNativeFileHostBinding(owner, RESOURCE_FONT_FACE_BINDING, symbol, adapter, adapter.face);
}
export interface ResourceExternalFontFace {
    readonly reference?: NativeFileHostBindingReference;
    readonly descriptors: Readonly<Record<string, string>>;
    readonly source: ResourceSourceBytes;
}
export interface ResourceExternalFonts {
    readonly reference: NativeFileHostBindingReference;
    readonly originRevision: number | string;
    readonly faces: readonly ResourceExternalFontFace[];
    readonly bindings: readonly {
        readonly policyId: string;
        readonly faces: readonly number[];
    }[];
}
export interface ResourceBoundFontData {
    readonly version: 1;
    readonly fonts: ResourceFontData;
    readonly external?: ResourceExternalFonts;
}
const descriptorKeys = ["family", "style", "weight", "stretch", "display", "unicodeRange", "featureSettings", "variationSettings", "ascentOverride", "descentOverride", "lineGapOverride"] as const;
function revision(value: number | string, b: ResourceBudget): number | string {
    if (typeof value === "number")
        return resourceInteger(value, "actual font owner revision", 0, Number.MAX_SAFE_INTEGER);
    if (typeof value !== "string" || value.length > 1024)
        return b.fail("DATA", "font owner revision");
    b.metadata(value);
    return value;
}
function descriptors(value: Readonly<Record<string, string>>, b: ResourceBudget): Readonly<Record<string, string>> {
    resourceKeys(value, descriptorKeys, b);
    const result: Record<string, string> = {};
    for (const key of descriptorKeys)
        if (value[key] !== undefined) {
            b.metadata(value[key]);
            result[key] = value[key];
        }
    if (typeof result.family !== "string")
        return b.fail("DATA", "external font family");
    return Object.freeze(result);
}
function sameDescriptors(a: Readonly<Record<string, string>>, c: Readonly<Record<string, string>>, b: ResourceBudget): boolean {
    b.work(descriptorKeys.length);
    for (const key of descriptorKeys) {
        b.work((a[key]?.length ?? 0) + (c[key]?.length ?? 0));
        if (a[key] !== c[key])
            return false;
    }
    return true;
}
function bindings(value: ResourceExternalFonts["bindings"], policies: readonly ResolvedWebFontPolicy[], count: number, b: ResourceBudget): ResourceExternalFonts["bindings"] {
    if (!Array.isArray(value) || value.length !== policies.length)
        return b.fail("DATA", "font policy binding count");
    b.work(value.length + count);
    const used = new Uint8Array(count);
    const rows = value.map((row, i) => {
        resourceKeys(row, ["policyId", "faces"], b);
        b.metadata(row.policyId);
        if (row.policyId !== policies[i].id || !Array.isArray(row.faces) || !row.faces.length)
            return b.fail("DATA", "font policy binding order");
        b.work(row.faces.length);
        b.charge("metadataBytes", row.faces.length * 8);
        const unique = new Set<number>();
        const faces = row.faces.map((n: number) => { resourceInteger(n, "font face ordinal", 0, count - 1); if (unique.has(n))
            return b.fail("DATA", "duplicate face within font policy"); unique.add(n); used[n] = 1; return n; });
        return Object.freeze({ policyId: row.policyId, faces: Object.freeze(faces) });
    });
    for (const n of used)
        if (!n)
            return b.fail("DATA", "unowned external font face");
    return Object.freeze(rows);
}
const active = new WeakMap<object, {
    reentered: boolean;
}>();
function enter(set: object): () => void {
    const previous = active.get(set);
    if (previous) {
        previous.reentered = true;
        throw new NativeFileResourceError("BUSY", "font adapter reentrancy");
    }
    active.set(set, { reentered: false });
    return () => active.delete(set);
}
function reentrancy(set: object, b: ResourceBudget): void { if (active.get(set)?.reentered)
    b.fail("BUSY", "font adapter reentered"); }
/** Actual SDK request history is read by captureResourceFonts, not supplied by
 * the caller. Only external unreadable sources use the registered authority. */
export async function captureBoundResourceFonts(owner: object, set: FontFaceSetLike, b: ResourceBudget): Promise<ResourceBoundFontData> {
    const leave = enter(set);
    let nativeFence: ResourceNativeFontSetFence | undefined;
    try {
        const registryFence = captureNativeFileHostBindingFence(owner);
        nativeFence = captureResourceNativeFontSetFence(set, b);
        const fonts = await captureResourceFonts(set, b);
        if (!fonts.externalPolicies.length) {
            if (!resourceNativeFontSetFenceUnchanged(set, nativeFence) || !nativeFileHostBindingFenceUnchanged(owner, registryFence))
                return b.fail("STALE", "font capture fence");
            return Object.freeze({ version: 1, fonts });
        }
        const reference = captureNativeFileHostBinding(owner, RESOURCE_FONT_SET_BINDING, set), adapter = resolveNativeFileHostBinding(owner, RESOURCE_FONT_SET_BINDING, reference), before = revision(adapter.readRevision(), b);
        const selected = await adapter.captureCurrent(fonts.externalPolicies, b);
        reentrancy(set, b);
        resourceKeys(selected, ["faces", "bindings"], b);
        if (!Array.isArray(selected.faces))
            return b.fail("DATA", "actual font selection");
        b.charge("resources", selected.faces.length);
        b.work(selected.faces.length);
        const identities = new Set<object>(), faceRevisions: {
            adapter: ResourceFontFaceHostAdapter;
            revision: number | string;
        }[] = [];
        // Observe all mutable host/native facts synchronously before immutable Blob awaits.
        const rows = selected.faces.map(row => {
            resourceKeys(row, ["identity", "face", "descriptors", "source"], b);
            if (!row.identity || typeof row.identity !== "object" || identities.has(row.identity))
                return b.fail("DATA", "font source identity");
            identities.add(row.identity);
            if (row.face !== undefined) {
                if (row.identity !== row.face)
                    return b.fail("DATA", "actual face identity");
                const ref = captureNativeFileHostBinding(owner, RESOURCE_FONT_FACE_BINDING, row.face), binding = resolveNativeFileHostBinding(owner, RESOURCE_FONT_FACE_BINDING, ref), facts = resourceFontFaceFacts(row.face, b);
                if (facts.status !== "loaded")
                    return b.fail("BUSY", "external FontFace load");
                faceRevisions.push({ adapter: binding, revision: revision(binding.readRevision(), b) });
                return { reference: ref, descriptors: facts.descriptors, source: binding.source };
            }
            if (!row.descriptors || !row.source || !(row.source.blob instanceof Blob))
                return b.fail("DATA", "virtual host font bytes/facts");
            resourceKeys(row.source, ["blob", "url"], b);
            b.metadata(row.source.url);
            return { descriptors: descriptors(row.descriptors, b), source: row.source };
        });
        const bound = bindings(selected.bindings, fonts.externalPolicies, rows.length, b), faces = [];
        for (const row of rows) {
            const source = await captureResourceSource(row.source, b);
            validateResourceFontEncoding(source.bytes, b);
            faces.push(Object.freeze({ ...row, source }));
        }
        reentrancy(set, b);
        for (const row of faceRevisions)
            if (revision(row.adapter.readRevision(), b) !== row.revision)
                return b.fail("STALE", "FontFace owner revision");
        if (revision(adapter.readRevision(), b) !== before || !resourceNativeFontSetFenceUnchanged(set, nativeFence) || !nativeFileHostBindingFenceUnchanged(owner, registryFence))
            return b.fail("STALE", "external font capture fence");
        return Object.freeze({ version: 1, fonts, external: Object.freeze({ reference, originRevision: before, faces: Object.freeze(faces), bindings: bound }) });
    }
    catch (error) {
        if (error instanceof NativeFileResourceError)
            throw error;
        throw new NativeFileResourceError("CAPABILITY", "external font owner binding/capture");
    }
    finally {
        forgetResourceNativeFontSetFence(nativeFence);
        leave();
    }
}
/** Copies typed external data; opaque host identities/callbacks never enter it. */
function copyExternal(data: ResourceExternalFonts, policies: readonly ResolvedWebFontPolicy[], b: ResourceBudget): ResourceExternalFonts {
    resourceKeys(data, ["reference", "originRevision", "faces", "bindings"], b);
    revision(data.originRevision, b);
    resourceKeys(data.reference, ["kind", "version", "symbol"], b);
    b.metadata(data.reference.kind);
    b.metadata(data.reference.symbol);
    if (data.reference.kind !== RESOURCE_FONT_SET_BINDING.kind || data.reference.version !== 1 || !Array.isArray(data.faces))
        return b.fail("DATA", "external font section");
    b.work(data.faces.length);
    b.charge("resources", data.faces.length);
    const sources = new Map<object, ResourceSourceBytes>();
    const faces = data.faces.map(row => {
        resourceKeys(row, ["reference", "descriptors", "source"], b);
        const d = descriptors(row.descriptors, b);
        if (row.reference) {
            resourceKeys(row.reference, ["kind", "version", "symbol"], b);
            b.metadata(row.reference.kind);
            b.metadata(row.reference.symbol);
            if (row.reference.kind !== RESOURCE_FONT_FACE_BINDING.kind || row.reference.version !== 1)
                return b.fail("DATA", "font face reference");
        }
        let source = sources.get(row.source);
        if (!source) {
            resourceKeys(row.source, ["url", "mime", "bytes"], b);
            b.metadata(row.source.url);
            b.metadata(row.source.mime);
            source = Object.freeze({ url: row.source.url, mime: row.source.mime, bytes: b.bytes(row.source.bytes, "sourceBytes") });
            validateResourceFontEncoding(source.bytes, b);
            sources.set(row.source, source);
        }
        return Object.freeze({ ...(row.reference ? { reference: Object.freeze({ ...row.reference }) } : {}), descriptors: d, source });
    });
    return Object.freeze({ reference: Object.freeze({ ...data.reference }), originRevision: data.originRevision, faces: Object.freeze(faces), bindings: bindings(data.bindings, policies, faces.length, b) });
}
export interface PreparedBoundResourceFonts {
    readonly savedOrigin: Readonly<{
        version: 1;
        generation: number;
        externalRevision?: number | string;
    }>;
    /** Runs host revision callbacks before entering the synchronous publication section. */
    assertCurrent(): void;
    publication(budget: ResourceBudget): ResourceFontPublication;
    dispose(): void;
}
export async function prepareBoundResourceFonts(owner: object, set: FontFaceSet, data: ResourceBoundFontData, b: ResourceBudget): Promise<PreparedBoundResourceFonts> {
    resourceKeys(data, ["version", "fonts", "external"], b);
    if (data.version !== 1)
        return b.fail("DATA", "bound font version");
    const fonts = copyResourceFontData(data.fonts, b);
    const external = data.external ? copyExternal(data.external, fonts.externalPolicies, b) : undefined;
    if (!!external !== !!fonts.externalPolicies.length)
        return b.fail("DATA", "external font request/data relation");
    b.work(1 + (external?.faces.length ?? 0));
    b.charge("metadataBytes", (external?.faces.length ?? 0) * 16);
    const requests: NativeFileHostBindingRequest[] = [];
    if (external) {
        requests.push({ type: RESOURCE_FONT_SET_BINDING, reference: external.reference });
        for (const row of external.faces)
            if (row.reference)
                requests.push({ type: RESOURCE_FONT_FACE_BINDING, reference: row.reference });
    }
    let batch: ReturnType<typeof prepareNativeFileHostBindings>;
    try {
        batch = prepareNativeFileHostBindings(owner, requests, b);
    }
    catch {
        throw new NativeFileResourceError("CAPABILITY", "target font binding reference");
    }
    const registryFence = captureNativeFileHostBindingFence(owner), nativeFence = captureResourceNativeFontSetFence(set, b), leave = enter(set);
    let token: Awaited<ReturnType<typeof prepareResourceFonts>> | undefined;
    try {
        const adapter = external ? resolvePreparedNativeFileHostBinding(owner, batch, RESOURCE_FONT_SET_BINDING, external.reference.symbol) : undefined;
        if (adapter && adapter.fontSet !== set)
            return b.fail("CAPABILITY", "actual target FontFaceSet identity");
        const before = adapter ? revision(adapter.readRevision(), b) : undefined, faceRevisions: {
            adapter: ResourceFontFaceHostAdapter;
            revision: number | string;
        }[] = [];
        if (external) {
            for (const row of external.faces)
                if (row.reference) {
                    const binding = resolvePreparedNativeFileHostBinding(owner, batch, RESOURCE_FONT_FACE_BINDING, row.reference.symbol), rev = revision(binding.readRevision(), b), facts = resourceFontFaceFacts(binding.face, b);
                    const current = await captureResourceSource(binding.source, b);
                    b.work(current.bytes.length);
                    if (facts.status !== "loaded" || !sameDescriptors(facts.descriptors, row.descriptors, b) || current.bytes.length !== row.source.bytes.length || current.bytes.some((v, i) => v !== row.source.bytes[i]))
                        return b.fail("DATA", "registered target FontFace/source mismatch");
                    faceRevisions.push({ adapter: binding, revision: rev });
                }
            await adapter!.acceptFile(external, b);
            reentrancy(set, b);
        }
        b.work(fonts.entries.length);
        b.charge("metadataBytes", fonts.entries.length * 16);
        const entries = [...fonts.entries], policyIds: string[][] = fonts.entries.map(row => [...row.policyIds]);
        if (external) {
            const count = external.faces.length;
            b.work(count);
            b.charge("metadataBytes", count * 16);
            const aliases: string[][] = Array.from({ length: count }, () => []);
            for (const row of external.bindings) {
                b.work(row.faces.length);
                b.charge("metadataBytes", row.faces.length * 8);
                for (const ordinal of row.faces)
                    aliases[ordinal].push(row.policyId);
            }
            const longest = fonts.entries.reduce((n, row) => Math.max(n, row.id.length), 0), prefixLength = longest + 1;
            b.work(prefixLength);
            b.charge("metadataBytes", prefixLength * 2);
            const prefix = "\u0000".repeat(prefixLength);
            for (let i = 0; i < count; i++) {
                // New private runtime identity. Original policy IDs and source ordinals
                // are preserved separately; no original source ID is overwritten.
                const suffix = String(i);
                b.work(prefixLength + suffix.length);
                b.charge("metadataBytes", (prefixLength + suffix.length) * 2);
                const id = prefix + suffix, row = external.faces[i];
                entries.push({ id, descriptors: row.descriptors, source: row.source, policyIds: aliases[i] });
                policyIds.push(aliases[i]);
            }
        }
        b.work(entries.length);
        token = await prepareResourceFonts({ generation: fonts.generation, entries, requests: fonts.requests, externalPolicies: [] }, b);
        associatePreparedResourceFontPolicies(token, policyIds, b);
        reentrancy(set, b);
        if (!resourceNativeFontSetFenceUnchanged(set, nativeFence) || !nativeFileHostBindingFenceUnchanged(owner, registryFence))
            return b.fail("STALE", "font preparation native/registry fence");
        const assertCurrent = () => {
            if (adapter && revision(adapter.readRevision(), b) !== before)
                throw new NativeFileResourceError("STALE", "font Set adapter revision");
            for (const row of faceRevisions)
                if (revision(row.adapter.readRevision(), b) !== row.revision)
                    throw new NativeFileResourceError("STALE", "font Face adapter revision");
            if (!nativeFileHostBindingFenceUnchanged(owner, registryFence))
                throw new NativeFileResourceError("STALE", "font binding registry");
        };
        assertCurrent();
        let disposed = false, published = false, publication: ResourceFontPublication | undefined;
        const savedOrigin = Object.freeze({ version: 1 as const, generation: fonts.generation, ...(external ? { externalRevision: external.originRevision } : {}) });
        return Object.freeze({ savedOrigin, assertCurrent: () => { if (disposed || published)
                throw new NativeFileResourceError("STALE", "bound font lease"); assertCurrent(); },
            publication: (budget: ResourceBudget) => {
                if (disposed || published || publication)
                    throw new NativeFileResourceError("STALE", "bound font publication");
                assertCurrent();
                const native = prepareResourceFontPublication(token!, set, budget);
                publication = Object.freeze({ savedOrigin: native.savedOrigin,
                    apply: () => { if (!nativeFileHostBindingFenceUnchanged(owner, registryFence))
                        throw new NativeFileResourceError("STALE", "font publication registry"); native.apply(); },
                    commit: () => { consumePreparedNativeFileHostBindings(owner, batch); native.commit(); published = true; }, rollback: () => native.rollback() });
                return publication;
            }, dispose: () => { if (disposed)
                return; if (publication && !published)
                publication.rollback(); disposeResourceFonts(token!); discardPreparedNativeFileHostBindings(owner, batch); disposed = true; }
        });
    }
    catch (error) {
        if (token)
            disposeResourceFonts(token);
        discardPreparedNativeFileHostBindings(owner, batch);
        if (error instanceof NativeFileResourceError)
            throw error;
        throw new NativeFileResourceError("CAPABILITY", "external font target preparation");
    }
    finally {
        forgetResourceNativeFontSetFence(nativeFence);
        leave();
    }
}
