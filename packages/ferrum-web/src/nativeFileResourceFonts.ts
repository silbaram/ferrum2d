/** @internal Actual SDK font bytes. The standard browser loader constructs the
 * same FontFace from retained bytes; an old CSS/system face is never identified
 * by refetching a URL. Custom/source-less hosts require typed host bindings. */
import type { FontFaceSetLike, ResolvedWebFontPolicy } from "./localization.js";
import { ResourceBudget, resourceInteger, resourceKeys, NativeFileResourceError } from "./nativeFileResourceBudget.js";
import { captureResourceSource, fileResourceBlob, type ResourceSourceBytes } from "./nativeFileResourceOwners.js";
interface Source {
    readonly id: string;
    readonly url: string;
    readonly blob: Blob;
    readonly policyIds?: readonly string[];
}
interface State {
    generation: number;
    pending: number;
    requested: Map<string, ResolvedWebFontPolicy>;
}
const sources = new WeakMap<FontFace, Source>();
const sets = new WeakMap<object, State>();
function stateFor(set: object): State {
    let state = sets.get(set);
    if (!state) {
        state = { generation: 0, pending: 0, requested: new Map() };
        sets.set(set, state);
    }
    return state;
}
function nativeSet(set: FontFaceSetLike): set is FontFaceSet {
    // Chromium exposes document.fonts without a global FontFaceSet constructor.
    // Use the actual standard platform owner identity, not a constructor guess.
    return typeof FontFace !== "undefined" && (typeof document !== "undefined" && set === document.fonts
        || typeof FontFaceSet !== "undefined" && set instanceof FontFaceSet || Reflect.get(globalThis, "fonts") === set);
}
/** Preserve the old load-only host path, while standard declared URL fonts now
 * have an actual SDK-owned Face/source. No new package-facing API signature. */
export async function loadResourceFont(policy: ResolvedWebFontPolicy, set: FontFaceSetLike): Promise<void> {
    const font = Object.freeze({ id: policy.id, family: policy.family, sources: Object.freeze([...policy.sources]), weight: policy.weight, style: policy.style,
        display: policy.display, preload: policy.preload, cssFontFace: policy.cssFontFace, loadExpression: policy.loadExpression });
    const state = stateFor(set);
    state.pending++;
    state.generation++;
    let candidate: FontFace | undefined, added = false;
    try {
        if (font.sources.length && nativeSet(set)) {
            let last: unknown;
            let source: Source | undefined;
            for (const url of font.sources) {
                try {
                    const response = await fetch(url);
                    if (!response.ok) {
                        try {
                            await response.body?.cancel();
                        }
                        catch { /* Preserve load error. */ }
                        throw Error(`Font HTTP ${response.status}`);
                    }
                    const blob = await response.blob(), bytes = await blob.arrayBuffer();
                    candidate = new FontFace(font.family, bytes, { weight: font.weight, style: font.style, display: font.display });
                    await candidate.load();
                    source = { id: font.id, url, blob };
                    break;
                }
                catch (error) {
                    last = error;
                    candidate = undefined;
                }
            }
            if (!candidate || !source)
                throw last ?? Error("Font source unavailable");
            set.add(candidate);
            added = true;
            await set.load(font.loadExpression);
            // Only replace faces previously created by this SDK owner/id. Existing CSS
            // faces and other applications' FontFaces are not removed or relabeled.
            for (const previous of set)
                if (previous !== candidate) {
                    const retained = sources.get(previous);
                    if (!retained)
                        continue;
                    const aliases = retained.policyIds ?? [retained.id];
                    if (!aliases.includes(font.id))
                        continue;
                    const remaining = aliases.filter(id => id !== font.id);
                    if (remaining.length)
                        sources.set(previous, { ...retained, policyIds: Object.freeze(remaining) });
                    else {
                        set.delete(previous);
                        sources.delete(previous);
                    }
                }
            sources.set(candidate, source);
        }
        else
            await set.load(font.loadExpression);
        state.requested.set(font.id, font);
    }
    catch (error) {
        if (candidate && added && nativeSet(set))
            set.delete(candidate);
        if (candidate)
            sources.delete(candidate);
        throw error;
    }
    finally {
        state.pending--;
        state.generation++;
    }
}
export interface ResourceFontEntry {
    readonly id: string;
    readonly descriptors: Readonly<Record<string, string>>;
    readonly source: ResourceSourceBytes;
    readonly policyIds: readonly string[];
}
export interface ResourceFontData {
    readonly generation: number;
    readonly entries: readonly ResourceFontEntry[];
    /** All actual successful SDK requests, including presently materialized ones. */
    readonly requests: readonly ResolvedWebFontPolicy[];
    /** Actual successful requests that need the external host participant. */
    readonly externalPolicies: readonly ResolvedWebFontPolicy[];
}
const descriptorKeys = ["family", "style", "weight", "stretch", "display", "unicodeRange", "featureSettings",
    "variationSettings", "ascentOverride", "descentOverride", "lineGapOverride"] as const;
const faceGetters = new Map<string, (this: FontFace) => unknown>();
if (typeof FontFace !== "undefined")
    for (const key of [...descriptorKeys, "status"]) {
        const get = Object.getOwnPropertyDescriptor(FontFace.prototype, key)?.get;
        if (get)
            faceGetters.set(key, get);
    }
function faceField(face: FontFace, key: string): unknown { return faceGetters.get(key)?.call(face); }
function descriptors(face: FontFace, b: ResourceBudget): Readonly<Record<string, string>> {
    const result: Record<string, string> = {};
    b.work(descriptorKeys.length);
    for (const key of descriptorKeys) {
        const value: unknown = faceField(face, key);
        if (value === undefined)
            continue; // Older browser may lack a new descriptor.
        if (typeof value !== "string")
            return b.fail("DATA", "font descriptor");
        b.metadata(value);
        result[key] = value;
    }
    return Object.freeze(result);
}
export function fontFileRevision(set: object): number { return sets.get(set)?.generation ?? 0; }
export async function captureResourceFonts(set: FontFaceSetLike, b: ResourceBudget): Promise<ResourceFontData> {
    const state = sets.get(set);
    if (!state)
        return Object.freeze({ generation: 0, entries: Object.freeze([]), requests: Object.freeze([]), externalPolicies: Object.freeze([]) });
    if (state.pending)
        return b.fail("BUSY", "font loading");
    const generation = state.generation;
    b.work(state.requested.size);
    b.charge("resources", state.requested.size);
    const owned = [], present = new Set<string>();
    if (nativeSet(set)) {
        b.work(set.size);
        for (const face of set) {
            const source = sources.get(face);
            if (!source)
                continue;
            b.charge("resources", 1);
            if (faceField(face, "status") !== "loaded")
                return b.fail("DATA", "owned font status");
            const policyIds = source.policyIds ?? [source.id];
            b.work(policyIds.length);
            for (const id of policyIds) {
                b.metadata(id);
                present.add(id);
            }
            b.metadata(source.id);
            owned.push({ id: source.id, policyIds: Object.freeze([...policyIds]), descriptors: descriptors(face, b), source });
        }
    }
    const requests = [], externalPolicies = [];
    for (const [id, policy] of state.requested) {
        b.metadata(id);
        b.metadata(policy.family);
        b.metadata(policy.weight);
        b.metadata(policy.style);
        b.metadata(policy.display);
        b.metadata(policy.cssFontFace);
        b.metadata(policy.loadExpression);
        b.work(policy.sources.length);
        for (const url of policy.sources)
            b.metadata(url);
        const copy = Object.freeze({ ...policy, sources: Object.freeze([...policy.sources]) });
        requests.push(copy);
        if (!present.has(id))
            externalPolicies.push(copy);
    }
    const entries = [];
    for (const entry of owned)
        entries.push(Object.freeze({ id: entry.id, policyIds: entry.policyIds, descriptors: entry.descriptors, source: await captureResourceSource(entry.source, b) }));
    if (state.generation !== generation || state.pending)
        return b.fail("STALE", "font capture");
    return Object.freeze({ generation, entries: Object.freeze(entries), requests: Object.freeze(requests), externalPolicies: Object.freeze(externalPolicies) });
}
/** Declared sfnt output size, charged before browser font decode. This is a
 * logical payload quota, not all platform shaping/cache/allocator memory. */
function fontDecodedBytes(bytes: Uint8Array, b: ResourceBudget): number {
    if (bytes.length < 12)
        return b.fail("DATA", "font header");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), magic = view.getUint32(0);
    if (magic === 0x774f4632 || magic === 0x774f4646) {
        if (bytes.length < (magic === 0x774f4632 ? 48 : 44) || view.getUint32(8) !== bytes.length || view.getUint16(14) !== 0)
            return b.fail("DATA", "WOFF header");
        const count = resourceInteger(view.getUint16(12), "font table count", 1, 4096);
        const declared = resourceInteger(view.getUint32(16), "font sfnt bytes", 12 + count * 16);
        b.work(count);
        return declared;
    }
    if (magic !== 0x00010000 && magic !== 0x4f54544f && magic !== 0x74727565)
        return b.fail("DATA", "font sfnt format");
    const count = resourceInteger(view.getUint16(4), "font table count", 1, 4096);
    if (12 + count * 16 > bytes.length)
        return b.fail("DATA", "font directory");
    b.work(count);
    let decoded = 12 + count * 16;
    for (let i = 0; i < count; i++) {
        const offset = view.getUint32(12 + i * 16 + 8), length = view.getUint32(12 + i * 16 + 12);
        if (offset + length > bytes.length)
            return b.fail("DATA", "font table range");
        decoded += Math.ceil(length / 4) * 4;
    }
    return decoded;
}
/** Header/declared-size checks do not claim total browser decoder memory. */
export function validateResourceFontEncoding(bytes: Uint8Array, b: ResourceBudget): void { fontDecodedBytes(bytes, b); }
export interface PreparedResourceFonts {
    readonly kind: "prepared-resource-fonts";
}
interface PreparedFontPlan {
    faces: FontFace[];
    disposed: boolean;
    adopted: boolean;
    publication: boolean;
    origin: number;
    requested: Map<string, ResolvedWebFontPolicy>;
}
const prepared = new WeakMap<PreparedResourceFonts, PreparedFontPlan>();
/** Pure file admission, before a host adapter or browser font allocation. */
export function copyResourceFontData(data: ResourceFontData, b: ResourceBudget): ResourceFontData {
    resourceKeys(data, ["generation", "entries", "requests", "externalPolicies"], b);
    resourceInteger(data.generation, "font source generation", 0, Number.MAX_SAFE_INTEGER);
    if (!Array.isArray(data.entries) || !Array.isArray(data.requests) || !Array.isArray(data.externalPolicies))
        return b.fail("DATA", "font collections");
    b.work(data.entries.length + data.requests.length + data.externalPolicies.length);
    b.charge("resources", data.entries.length + data.requests.length);
    const policyCopies = new WeakMap<object, ResolvedWebFontPolicy>();
    const copyPolicy = (policy: ResolvedWebFontPolicy): ResolvedWebFontPolicy => {
        const previous = policyCopies.get(policy);
        if (previous)
            return previous;
        resourceKeys(policy, ["id", "family", "sources", "weight", "style", "display", "preload", "cssFontFace", "loadExpression"], b);
        for (const key of ["id", "family", "weight", "style", "display", "cssFontFace", "loadExpression"] as const)
            b.metadata(policy[key]);
        if (typeof policy.preload !== "boolean" || !Array.isArray(policy.sources) || !["auto", "block", "swap", "fallback", "optional"].includes(policy.display))
            return b.fail("DATA", "font request metadata");
        b.work(policy.sources.length);
        const urls = policy.sources.map((url: string) => { b.metadata(url); return url; });
        const result = Object.freeze({ ...policy, sources: Object.freeze(urls) });
        policyCopies.set(policy, result);
        return result;
    };
    const requestedIds = new Set<string>(), requests = data.requests.map(policy => { const result = copyPolicy(policy); if (requestedIds.has(result.id))
        return b.fail("DATA", "duplicate font request ID"); requestedIds.add(result.id); return result; });
    const ids = new Set<string>(), copies = new Map<object, ResourceSourceBytes>(), present = new Set<string>();
    const entries = data.entries.map(entry => {
        resourceKeys(entry, ["id", "policyIds", "descriptors", "source"], b);
        resourceKeys(entry.descriptors, descriptorKeys, b);
        resourceKeys(entry.source, ["url", "mime", "bytes"], b);
        b.metadata(entry.id);
        if (ids.has(entry.id) || !Array.isArray(entry.policyIds) || !entry.policyIds.length)
            return b.fail("DATA", "font entry identity/policies");
        ids.add(entry.id);
        b.work(entry.policyIds.length);
        const aliases = new Set<string>(), policyIds = entry.policyIds.map((id: string) => { b.metadata(id); if (aliases.has(id) || !requestedIds.has(id))
            return b.fail("DATA", "font policy reference"); aliases.add(id); present.add(id); return id; });
        const d: Record<string, string> = {};
        for (const key of descriptorKeys)
            if (entry.descriptors[key] !== undefined) {
                b.metadata(entry.descriptors[key]);
                d[key] = entry.descriptors[key];
            }
        if (typeof d.family !== "string")
            return b.fail("DATA", "font family");
        let source = copies.get(entry.source);
        if (!source) {
            b.metadata(entry.source.url);
            b.metadata(entry.source.mime);
            source = Object.freeze({ url: entry.source.url, mime: entry.source.mime, bytes: b.bytes(entry.source.bytes, "sourceBytes") });
            copies.set(entry.source, source);
        }
        b.charge("decodedBytes", fontDecodedBytes(source.bytes, b));
        return Object.freeze({ id: entry.id, policyIds: Object.freeze(policyIds), descriptors: Object.freeze(d), source });
    });
    const expected = requests.filter(p => !present.has(p.id));
    if (expected.length !== data.externalPolicies.length)
        return b.fail("DATA", "external font request relation");
    const externalPolicies = data.externalPolicies.map((p, i) => {
        const q = copyPolicy(p), e = expected[i];
        b.work(9 + q.sources.length);
        for (const key of ["id", "family", "weight", "style", "display", "cssFontFace", "loadExpression"] as const) {
            b.work(q[key].length + e[key].length);
            if (q[key] !== e[key])
                return b.fail("DATA", "external font request facts");
        }
        if (q.preload !== e.preload || q.sources.length !== e.sources.length)
            return b.fail("DATA", "external font request facts");
        for (let j = 0; j < q.sources.length; j++) {
            b.work(q.sources[j].length + e.sources[j].length);
            if (q.sources[j] !== e.sources[j])
                return b.fail("DATA", "external font request source");
        }
        return q;
    });
    return Object.freeze({ generation: data.generation, entries: Object.freeze(entries), requests: Object.freeze(requests), externalPolicies: Object.freeze(externalPolicies) });
}
export async function prepareResourceFonts(input: ResourceFontData, b: ResourceBudget): Promise<PreparedResourceFonts> {
    const data = copyResourceFontData(input, b);
    if (data.externalPolicies.length)
        return b.fail("CAPABILITY", "external font host binding required");
    if (typeof FontFace === "undefined")
        return b.fail("CAPABILITY", "FontFace unavailable");
    const faces: FontFace[] = [];
    try {
        const blobs = new Map<object, Blob>();
        for (const entry of data.entries) {
            const d = entry.descriptors, bytes = entry.source.bytes;
            b.charge("sourceBytes", bytes.byteLength);
            b.work(bytes.byteLength);
            const face = new FontFace(d.family, bytes, d);
            faces.push(face);
            await face.load();
            for (const key of descriptorKeys)
                if (d[key] !== undefined && faceField(face, key) !== d[key])
                    return b.fail("CAPABILITY", "font descriptor support/canonical value");
            let blob = blobs.get(entry.source);
            if (!blob) {
                blob = fileResourceBlob(bytes, entry.source.mime, b);
                blobs.set(entry.source, blob);
            }
            sources.set(face, { id: entry.id, url: entry.source.url, blob, policyIds: entry.policyIds });
        }
        b.work(data.requests.length);
        b.charge("metadataBytes", data.requests.length * 16);
        const requested = new Map(data.requests.map(row => [row.id, row]));
        const token = Object.freeze({ kind: "prepared-resource-fonts" as const });
        prepared.set(token, { faces, disposed: false, adopted: false, publication: false, origin: data.generation, requested });
        return token;
    }
    catch (error) {
        for (const face of faces)
            sources.delete(face);
        faces.length = 0;
        if (error instanceof NativeFileResourceError)
            throw error;
        throw new NativeFileResourceError("DATA", "font decode/descriptor");
    }
}
export function disposeResourceFonts(token: PreparedResourceFonts): void {
    const plan = prepared.get(token);
    if (!plan || plan.disposed)
        return;
    plan.disposed = true;
    if (!plan.adopted) {
        for (const face of plan.faces)
            sources.delete(face);
        plan.requested.clear();
    }
    plan.faces.length = 0;
    prepared.delete(token);
}
/** @internal Inspection exposes no mutable FontFace before Root publication. */
export function preparedResourceFontCount(token: PreparedResourceFonts): number {
    const plan = prepared.get(token);
    if (!plan || plan.disposed)
        throw new NativeFileResourceError("STALE", "font preparation");
    return plan.faces.length;
}
/** @internal Shared document FontFaceSet publication is a platform mutation,
 * not resource preparation or Ready. Root must apply/commit in its synchronous
 * publication section with no await, frame or application callbacks in between.
 * Preparation only loads unattached faces. An apply fault deletes new faces;
 * old membership/order and same-family matching remain untouched. */
const defaultSet = typeof document === "undefined" ? undefined : document.fonts;
const setPrototype = defaultSet && Object.getPrototypeOf(defaultSet);
const setAdd = setPrototype?.add as ((this: FontFaceSet, face: FontFace) => FontFaceSet) | undefined;
const setDelete = setPrototype?.delete as ((this: FontFaceSet, face: FontFace) => boolean) | undefined;
const setHas = setPrototype?.has as ((this: FontFaceSet, face: FontFace) => boolean) | undefined;
const setValues = setPrototype?.values as ((this: FontFaceSet) => IterableIterator<FontFace>) | undefined;
const setSize = setPrototype && Object.getOwnPropertyDescriptor(setPrototype, "size")?.get;
export interface ResourceFontPublication {
    readonly savedOrigin: Readonly<{
        version: 1;
        generation: number;
    }>;
    apply(): void;
    commit(): void;
    rollback(): void;
}
export function prepareResourceFontPublication(token: PreparedResourceFonts, set: FontFaceSet, b: ResourceBudget): ResourceFontPublication {
    const plan = prepared.get(token);
    if (!plan || plan.disposed || plan.adopted || plan.publication)
        throw new NativeFileResourceError("STALE", "font publication token");
    if (set !== defaultSet || !setAdd || !setDelete || !setHas || !setValues || !setSize)
        return b.fail("CAPABILITY", "default font Set publication; external host binding required");
    const size = resourceInteger(setSize.call(set), "font Set size"), state = stateFor(set), generation = state.generation;
    if (state.pending)
        return b.fail("BUSY", "font publication loads");
    resourceInteger(generation, "fresh font Set generation", 0, Number.MAX_SAFE_INTEGER - 2);
    b.work(size * 15 + plan.faces.length * 4 + 4);
    b.charge("metadataBytes", size * 32 + plan.faces.length);
    const previous = [...setValues.call(set)], priorOwned = previous.filter(face => sources.has(face));
    const fingerprints = priorOwned.map(face => descriptors(face, b)), added = new Uint8Array(plan.faces.length);
    for (const fingerprint of fingerprints)
        for (const key of descriptorKeys)
            b.work(fingerprint[key]?.length ?? 0);
    const savedOrigin = Object.freeze({ version: 1 as const, generation: plan.origin });
    plan.publication = true;
    let phase: "prepared" | "applied" | "committed" | "rolled-back" = "prepared";
    const rollback = () => {
        if (phase === "committed")
            throw new NativeFileResourceError("STALE", "font publication committed");
        let failed = false;
        for (let i = plan.faces.length - 1; i >= 0; i--)
            if (added[i]) {
                try {
                    setDelete.call(set, plan.faces[i]);
                    added[i] = 0;
                }
                catch {
                    failed = true;
                }
            }
        if (failed)
            throw new NativeFileResourceError("CAPABILITY", "font rollback; retry before releasing host fence");
        phase = "rolled-back";
        previous.length = 0;
        priorOwned.length = 0;
        fingerprints.length = 0;
    };
    return Object.freeze({ savedOrigin, apply: () => {
            if (phase !== "prepared" || plan.disposed || prepared.get(token) !== plan || state.generation !== generation || state.pending || setSize.call(set) !== size)
                throw new NativeFileResourceError("STALE", "font publication fence");
            // Membership and every descriptor compared here were precharged above.
            for (const face of previous)
                if (!setHas.call(set, face))
                    throw new NativeFileResourceError("STALE", "font Set membership");
            for (let i = 0; i < priorOwned.length; i++)
                for (const key of descriptorKeys) {
                    const actual: unknown = faceField(priorOwned[i], key);
                    if (actual !== fingerprints[i][key])
                        throw new NativeFileResourceError("STALE", "font descriptor fence");
                }
            try {
                for (let i = 0; i < plan.faces.length; i++) {
                    setAdd.call(set, plan.faces[i]);
                    added[i] = 1;
                }
                phase = "applied";
            }
            catch {
                rollback();
                throw new NativeFileResourceError("CAPABILITY", "font publication add");
            }
        }, commit: () => {
            if (phase !== "applied" || plan.disposed || state.generation !== generation || state.pending)
                throw new NativeFileResourceError("STALE", "font publication commit");
            // These are native methods with validated actual FontFace arguments. Root
            // performs no callback/await between apply and this final retirement step.
            for (const face of priorOwned) {
                setDelete.call(set, face);
                sources.delete(face);
            }
            state.requested = plan.requested;
            state.generation++;
            plan.adopted = true;
            phase = "committed";
            previous.length = 0;
            priorOwned.length = 0;
            fingerprints.length = 0;
        }, rollback });
}
/** @internal Native current facts; ordinary file records never provide a Face. */
export function resourceFontFaceFacts(face: FontFace, b: ResourceBudget): Readonly<{
    status: string;
    descriptors: Readonly<Record<string, string>>;
}> {
    const status = faceField(face, "status");
    if (typeof status !== "string")
        return b.fail("DATA", "actual FontFace identity");
    return Object.freeze({ status, descriptors: descriptors(face, b) });
}
export interface ResourceNativeFontSetFence {
    readonly kind: "resource-native-font-set-fence";
}
const nativeFontFences = new WeakMap<ResourceNativeFontSetFence, {
    set: object;
    members: FontFace[];
    details: readonly Readonly<Record<string, string>>[];
    statuses: readonly string[];
    generation: number;
}>();
/** Native membership/descriptor observation supplements the trusted host's
 * actual revision; it does not turn a virtual OS font source into readable bytes. */
export function captureResourceNativeFontSetFence(set: FontFaceSetLike, b: ResourceBudget): ResourceNativeFontSetFence | undefined {
    if (!nativeSet(set) || !setValues || !setSize)
        return;
    const size = resourceInteger(setSize.call(set), "native font Set size");
    b.work(size * 5);
    b.charge("metadataBytes", size * 24);
    const members = [...setValues.call(set)], details = members.map(face => descriptors(face, b)), statuses = members.map(face => { const status = faceField(face, "status"); if (typeof status !== "string")
        return b.fail("DATA", "native font status"); b.metadata(status); return status; });
    for (const d of details)
        for (const key of descriptorKeys)
            b.work(d[key]?.length ?? 0);
    const token = Object.freeze({ kind: "resource-native-font-set-fence" as const });
    nativeFontFences.set(token, { set, members, details, statuses, generation: fontFileRevision(set) });
    return token;
}
export function resourceNativeFontSetFenceUnchanged(set: FontFaceSetLike, token: ResourceNativeFontSetFence | undefined): boolean {
    if (!token)
        return !nativeSet(set);
    const f = nativeFontFences.get(token);
    if (!f || f.set !== set || fontFileRevision(set) !== f.generation || !setValues || !setSize || setSize.call(set) !== f.members.length)
        return false;
    let i = 0;
    for (const face of setValues.call(set as FontFaceSet)) {
        if (face !== f.members[i] || faceField(face, "status") !== f.statuses[i])
            return false;
        for (const key of descriptorKeys)
            if (faceField(face, key) !== f.details[i][key])
                return false;
        i++;
    }
    return i === f.members.length;
}
/** Links private new runtime Face IDs to source policy IDs before any Set add. */
export function associatePreparedResourceFontPolicies(token: PreparedResourceFonts, policyIds: readonly (readonly string[])[], b: ResourceBudget): void {
    const plan = prepared.get(token);
    if (!plan || plan.disposed || plan.adopted || plan.publication || policyIds.length !== plan.faces.length)
        throw new NativeFileResourceError("STALE", "prepared font policy association");
    b.work(policyIds.length);
    const rows = policyIds.map(ids => { b.work(ids.length); for (const id of ids)
        b.metadata(id); return Object.freeze([...ids]); });
    for (let i = 0; i < plan.faces.length; i++) {
        const source = sources.get(plan.faces[i]);
        if (!source)
            throw new NativeFileResourceError("STALE", "prepared font source");
        sources.set(plan.faces[i], { ...source, policyIds: rows[i] });
    }
}
/** Release captured native references after the last cold fence check. */
export function forgetResourceNativeFontSetFence(token: ResourceNativeFontSetFence | undefined): void { if (token)
    nativeFontFences.delete(token); }
