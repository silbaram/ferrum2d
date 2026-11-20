import { assertNativeFileResolverCapture, prepareAuthoringResolvers, nativeFileApplySource, attachNativeFileApplySource,
  type NativeFileAuthoringResolverTable, type NativeFileAuthoringResolverContext, type NativeFileAuthoringResolverCapture,
  type NativeFileApplySource, type PreparedAuthoringResolvers } from "./nativeFileAuthoringResolvers.js";
import type {NativeFileNativeFacts} from "./nativeFileNativeFacts.js";
import {nativeFileEngineOwner} from "./nativeFileEngineOwner.js";
import {inspectNativeFileCanonicalAuthoringMetadata} from "./dataSceneProgress.js";
/** @internal Cold metadata only. Requires an unpublished facade, the caller's
 * capture fence and a same-cut, already-admitted native/resource roster. This is
 * not roster introspection, host-binding resolution, or a complete file importer. */
import type { FerrumEngine } from "./engineTypes.js";
import type { GameplayEntityHandle } from "./gameplayAuthoringTypes.js";
import { attachDataSceneAuthoringMetadata, inspectDataSceneAuthoringMetadata, type DataSceneProgressContextMetadata, type DataSceneContinuityContextMetadata, type DataSceneAuthoringContinuityMetadata } from "./dataSceneProgress.js";
import { SceneInstanceHandleRegistry, captureSceneInstanceRegistryMetadata, sceneInstanceRegistryMetadataUnchanged } from "./sceneInstanceHandles.js";
import { readNativeFileJson } from "./nativeFileJson.js";
import { resolveSceneAuthoringDocument } from "./sceneAuthoringDocument.js";
import { resolveDataSceneInstanceComponents, resolveDataSceneComponentsSpec, type ResolvedDataSceneTextureRef } from "./dataSceneComponents.js";
import { resolveDataSceneSpriteAnimationSet } from "./dataSceneSpriteAnimation.js";
import type { SceneCompositionJsonValue } from "./sceneComposition.js";
type Json = SceneCompositionJsonValue;
type Dict = Record<string, Json>;
interface Binding {
    readonly instanceId: string;
    readonly handle: GameplayEntityHandle;
}
export interface NativeFileAuthoringLimits {
    readonly maxNodes: number;
    readonly maxMembers: number;
    readonly maxDepth: number;
    readonly maxStringCodeUnits: number;
    readonly maxTotalStringCodeUnits: number;
    readonly maxInstances: number;
    readonly maxResources: number;
    readonly maxResolveWork: number;
    readonly maxDocumentBytes: number;
}
export const DEFAULT_NATIVE_FILE_AUTHORING_LIMITS: NativeFileAuthoringLimits = Object.freeze({
    maxNodes: 65536, maxMembers: 65536, maxDepth: 32, maxStringCodeUnits: 65536,
    maxTotalStringCodeUnits: 1048576, maxInstances: 4096, maxResources: 4096,
    maxResolveWork: 1048576, maxDocumentBytes: 4194304,
});
export interface NativeFileAuthoringResources {
    readonly textures: readonly {
        readonly id: number;
        readonly names: readonly string[];
        readonly contentId: string;
    }[];
    readonly models: readonly {
        readonly id: number;
        readonly asset: string;
        readonly contentId: string;
    }[];
}
/** Actual serializable metadata, never an identity/token substitute for file data. */
export interface NativeFileAuthoringBindings {
    readonly version: 1;
    readonly progress: null | {
        readonly epoch: number;
        readonly spatialRevision: number;
        readonly document: Json;
        readonly handles: readonly Binding[];
    };
    readonly continuity: null | {
        readonly epoch: number;
        readonly metadata: DataSceneAuthoringContinuityMetadata;
        readonly handles: readonly Binding[];
    };
    readonly registry: readonly Binding[] | null;
    readonly resources: NativeFileAuthoringResources;
    readonly resolvers?: NativeFileAuthoringResolverTable;
    readonly applySource?: NativeFileApplySource | null;
}
/** Trusted admitted facts for authored handles, including retained removed handles.
 * Resource content and aliases must already have been verified by the resource
 * participant. This table is never used as a future live entityExists callback. */
export interface AdmittedNativeFileAuthoringRoster {
    readonly scene: "data" | "none";
    readonly epoch: number;
    readonly spatialRevision: number;
    readonly entities: readonly {
        readonly handle: GameplayEntityHandle;
        readonly kind: "data-scene";
        readonly state: "live" | "removed";
        readonly animationClipIds: readonly number[];
        readonly textureIds: readonly number[];
        readonly modelIds: readonly number[];
    }[];
    readonly resources: NativeFileAuthoringResources;
}
export interface PreparedNativeFileAuthoringBindings {
    readonly kind: "native-file-authoring-bindings";
}
interface Plan {
    engine: FerrumEngine;
    guard: ReturnType<typeof inspectDataSceneAuthoringMetadata>;
    progress: DataSceneProgressContextMetadata | undefined;
    continuity: DataSceneContinuityContextMetadata | undefined;
    registry: SceneInstanceHandleRegistry | undefined;
}
const plans = new WeakMap<PreparedNativeFileAuthoringBindings, Plan>();
// Only resolvers constructed here from admitted data may be captured again.
const resolverResources = new WeakMap<(name: string) => number, string>();
function fail(message: string): never { throw new Error(`Native-file authoring metadata: ${message}`); }
function limitsFor(input: Partial<NativeFileAuthoringLimits>): NativeFileAuthoringLimits {
    if (!input || typeof input !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
        fail("invalid limits");
    const result = { ...DEFAULT_NATIVE_FILE_AUTHORING_LIMITS };
    for (const key in input) {
        if (!Object.prototype.hasOwnProperty.call(result, key))
            fail("unknown limit");
    }
    for (const key of Object.keys(DEFAULT_NATIVE_FILE_AUTHORING_LIMITS)) {
        const d = Object.getOwnPropertyDescriptor(input, key), k = key as keyof NativeFileAuthoringLimits;
        if (d === undefined)
            continue;
        if (!d || !("value" in d) || !Number.isSafeInteger(d.value) || d.value < 0 || d.value > result[k])
            fail("invalid limit");
        result[k] = d.value;
    }
    return result;
}
/** Check before clone/resolve. Arrays charge length before iteration; object
 * members charge before descriptor inspection without an unbounded ownKeys list.
 * Ordinary owned JSON data only: no hostile Proxy/global intrinsic guarantees.
 * Symbols/nonenumerables are outside JSON's enumerable data projection. */
function detach(input: unknown, limits: NativeFileAuthoringLimits): {
    value: Json;
    nodes: number;
} {
    let nodes = 0, members = 0, units = 0;
    const active = new WeakSet<object>(), keys = new WeakMap<object, string[]>();
    function string(s: string) { if (s.length > limits.maxStringCodeUnits || s.length > limits.maxTotalStringCodeUnits - units)
        fail("string budget exceeded"); units += s.length; }
    function scan(value: unknown, depth: number): void {
        if (nodes >= limits.maxNodes)
            fail("node budget exceeded");
        nodes++;
        if (typeof value === "string") {
            string(value);
            return;
        }
        if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value))
            return;
        if (!value || typeof value !== "object" || depth >= limits.maxDepth || active.has(value))
            fail("invalid/deep/cyclic JSON");
        if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
            fail("requires plain JSON data");
        active.add(value);
        if (Array.isArray(value)) {
            if (value.length > limits.maxMembers - members || value.length > limits.maxNodes - nodes)
                fail("collection budget exceeded");
            members += value.length;
            for (let i = 0; i < value.length; i++) {
                const d = Object.getOwnPropertyDescriptor(value, String(i));
                if (!d || !("value" in d))
                    fail("array hole/getter");
                scan(d.value, depth + 1);
            }
            for (const k in value)
                if (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= value.length)
                    fail("extra array property");
        }
        else {
            const names: string[] = [];
            keys.set(value, names);
            for (const k in value) {
                if (members >= limits.maxMembers)
                    fail("collection budget exceeded");
                members++;
                string(k);
                const d = Object.getOwnPropertyDescriptor(value, k);
                if (!d || !("value" in d))
                    fail("object getter/inherited property");
                names.push(k);
                scan(d.value, depth + 1);
            }
        }
        active.delete(value);
    }
    function clone(value: unknown): Json {
        if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number")
            return value;
        if (Array.isArray(value)) {
            const result: Json[] = new Array(value.length);
            for (let i = 0; i < value.length; i++)
                result[i] = clone(Object.getOwnPropertyDescriptor(value, String(i))!.value);
            return Object.freeze(result);
        }
        const result: Dict = Object.create(null);
        for (const k of keys.get(value as object)!)
            result[k] = clone(Object.getOwnPropertyDescriptor(value, k)!.value);
        return Object.freeze(result);
    }
    scan(input, 0);
    return { value: clone(input), nodes };
}
function record(value: unknown, fields?: readonly string[]): Dict {
    if (!value || typeof value !== "object" || Array.isArray(value))
        fail("expected object");
    const result = value as Dict;
    if (fields && (Object.keys(result).length !== fields.length || fields.some(k => !Object.prototype.hasOwnProperty.call(result, k))))
        fail("unexpected/missing fields");
    return result;
}
function array(value: unknown, max: number): readonly Json[] { if (!Array.isArray(value) || value.length > max)
    fail("collection limit exceeded"); return value; }
function text(value: unknown): string { if (typeof value !== "string" || !value.trim())
    fail("expected nonempty string"); return value; }
function uint(value: unknown, max = 0xffffffff): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max)
    fail("expected bounded uint32"); return value; }
function handle(value: unknown): GameplayEntityHandle { const e = record(value, ["entityId", "entityGeneration"]); return Object.freeze({ entityId: uint(e.entityId), entityGeneration: uint(e.entityGeneration) }); }
function key(h: GameplayEntityHandle): string { return `${h.entityId}:${h.entityGeneration}`; }
function bindings(value: unknown, limits: NativeFileAuthoringLimits): readonly Binding[] {
    const ids = new Set<string>(), hs = new Set<string>();
    return Object.freeze(array(value, limits.maxInstances).map(raw => {
        const e = record(raw, ["instanceId", "handle"]), id = text(e.instanceId), h = handle(e.handle);
        if (ids.has(id) || hs.has(key(h)))
            fail("duplicate instance/native handle");
        ids.add(id);
        hs.add(key(h));
        return Object.freeze({ instanceId: id, handle: h });
    }));
}
function handles(list: readonly Binding[]): Readonly<Record<string, GameplayEntityHandle>> { const result: Record<string, GameplayEntityHandle> = Object.create(null); for (const e of list)
    result[e.instanceId] = e.handle; return Object.freeze(result); }
function ownBindings(value: Readonly<Record<string, GameplayEntityHandle>>, limits: NativeFileAuthoringLimits): readonly Binding[] {
    const result: Binding[] = [];
    for (const id in value) {
        if (result.length >= limits.maxInstances)
            fail("instance budget exceeded");
        const d = Object.getOwnPropertyDescriptor(value, id);
        if (!d || !("value" in d))
            fail("instance getter");
        result.push({ instanceId: id, handle: d.value });
    }
    return result;
}
function canonical(value: unknown): string { return JSON.stringify(value, (_k, v: unknown) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, Object.getOwnPropertyDescriptor(v, k)!.value])) : v); }
function equal(a: unknown, b: unknown): boolean { return canonical(a) === canonical(b); }
function sameGuard(a: ReturnType<typeof inspectDataSceneAuthoringMetadata>, b: ReturnType<typeof inspectDataSceneAuthoringMetadata>): boolean { return a.adapter === b.adapter && a.revision === b.revision && a.progress === b.progress && a.continuity === b.continuity && a.epoch === b.epoch && a.spatialRevision === b.spatialRevision; }
export function captureNativeFileAuthoringBindings(engine: FerrumEngine, registry: SceneInstanceHandleRegistry | undefined, admittedRoster: unknown, overrides: Partial<NativeFileAuthoringLimits> = {}, facts?:NativeFileNativeFacts): NativeFileAuthoringBindings {
    const limits = limitsFor(overrides), guard = facts===undefined?inspectDataSceneAuthoringMetadata(engine):inspectNativeFileCanonicalAuthoringMetadata(engine,nativeFileEngineOwner(engine).native);
    if (!guard.adapter)
        fail("requires canonical progress adapter");
    if (guard.continuity && !guard.progress)
        fail("materialized document unavailable");
    const roster = detach(admittedRoster, limits).value, resourceIndex = resources(record(roster).resources, limits,!!facts);
    if (guard.progress?.textureId && resolverResources.get(guard.progress.textureId) !== canonical(resourceIndex.canonical))
        fail("textureId callback requires declarative host binding");
    let document: Json | undefined;
    if (guard.progress) {
        const source = guard.progress.document;
        if (source.length > limits.maxDocumentBytes)
            fail("document byte budget exceeded");
        let bytes = 0;
        for (let i = 0; i < source.length; i++) {
            const c = source.charCodeAt(i);
            bytes += c < 128 ? 1 : c < 2048 ? 2 : c >= 0xd800 && c <= 0xdbff && source.charCodeAt(i + 1) >= 0xdc00 && source.charCodeAt(i + 1) <= 0xdfff ? (i++, 4) : 3;
            if (bytes > limits.maxDocumentBytes)
                fail("document byte budget exceeded");
        }
        // The reader owns this new, bounded JSON tree; no caller callbacks are used.
        document = readNativeFileJson(new TextEncoder().encode(source), { maxBytes: limits.maxDocumentBytes, maxDepth: limits.maxDepth, maxValues: limits.maxNodes, maxMembers: limits.maxMembers, maxStringCodeUnits: limits.maxStringCodeUnits, maxTotalStringCodeUnits: limits.maxTotalStringCodeUnits }).value as Json;
    }
    const state = registry && captureSceneInstanceRegistryMetadata(registry, limits.maxInstances);
    const snapshot = detach({ version: 1, progress: guard.progress ? { epoch: guard.progress.epoch, spatialRevision: guard.progress.spatialRevision, document, handles: ownBindings(guard.progress.handles, limits) } : null,
        continuity: guard.continuity ? { epoch: guard.continuity.epoch, metadata: guard.continuity.metadata, handles: ownBindings(guard.continuity.handles, limits) } : null, registry: state?.entries ?? null, resources: record(roster).resources }, limits).value;
    const next = validate(snapshot, roster, limits,facts);
    if (guard.epoch !== next.epoch || guard.spatialRevision !== next.spatialRevision || !sameGuard(guard, inspectDataSceneAuthoringMetadata(engine)) || registry && !sceneInstanceRegistryMetadataUnchanged(registry, state!.revision))
        fail("capture metadata/epoch changed");
    return snapshot as unknown as NativeFileAuthoringBindings;
}
export function prepareNativeFileAuthoringBindings(engine: FerrumEngine, snapshot: unknown, admittedRoster: unknown, overrides: Partial<NativeFileAuthoringLimits> = {}): PreparedNativeFileAuthoringBindings {
    const limits = limitsFor(overrides), guard = inspectDataSceneAuthoringMetadata(engine);
    if (!guard.adapter || guard.progress || guard.continuity)
        fail("requires unpublished metadata-empty candidate");
    const next = validate(detach(snapshot, limits).value, detach(admittedRoster, limits).value, limits);
    if (guard.epoch !== next.epoch || guard.spatialRevision !== next.spatialRevision)
        fail("candidate epoch/revision mismatch");
    const token: PreparedNativeFileAuthoringBindings = Object.freeze({ kind: "native-file-authoring-bindings" });
    plans.set(token, { engine, guard, progress: next.progress, continuity: next.continuity, registry: next.registry });
    return token;
}
export function attachPreparedNativeFileAuthoringBindings(engine: FerrumEngine, token: PreparedNativeFileAuthoringBindings): SceneInstanceHandleRegistry | undefined {
    const plan = plans.get(token);
    if (!plan || plan.engine !== engine)
        fail("foreign/aliased/reused preparation");
    attachDataSceneAuthoringMetadata(engine, plan.guard, plan.progress, plan.continuity);
    plans.delete(token);
    return plan.registry;
}

export interface AdmittedNativeFileAuthoringBindings {
    readonly kind: "admitted-native-file-authoring-bindings";
}
interface AdmittedAuthoringPlan {
    readonly owner: object;
    readonly epoch: number;
    readonly spatialRevision: number;
    readonly progress: DataSceneProgressContextMetadata | undefined;
    readonly continuity: DataSceneContinuityContextMetadata | undefined;
    readonly registry: SceneInstanceHandleRegistry | undefined;
    readonly resolvers?: PreparedAuthoringResolvers;
    readonly applySource?: NativeFileApplySource;
}
const admittedAuthoringPlans = new WeakMap<AdmittedNativeFileAuthoringBindings, AdmittedAuthoringPlan>();
function factsRoster(facts: NativeFileNativeFacts, admittedResources: NativeFileAuthoringResources) {
    return { scene: facts.scene === "data" ? "data" : "none", epoch: facts.dataSceneEpoch, spatialRevision: facts.configurationRevision, entities: [], resources: admittedResources };
}
/** Pure admission. owner is the private native placeholder identity, not an
 * Engine getter capability. Facts describe the admitted candidate, never prior
 * existence. Baseline document/configuration and current native values differ. */
export function admitNativeFileAuthoringBindings(owner: object, snapshot: unknown, facts: NativeFileNativeFacts, admittedResources: NativeFileAuthoringResources, overrides: Partial<NativeFileAuthoringLimits> = {}, resolverContext?: NativeFileAuthoringResolverContext): AdmittedNativeFileAuthoringBindings {
    if (!owner || typeof owner !== "object") fail("requires target owner identity");
    const limits = limitsFor(overrides), detached = detach(snapshot, limits).value;
    const dto = record(detached), extended = Object.prototype.hasOwnProperty.call(dto,"resolvers");
    let resolvers: PreparedAuthoringResolvers | undefined;
    try {
      if (extended) {
        record(dto,["version","progress","continuity","registry","resources","resolvers","applySource"]);
        if (!resolverContext) fail("resolver admission requires shared budget/host owner");
        resolvers = prepareAuthoringResolvers(resolverTable(dto.resolvers), resolverContext);
      }
      const {next,applySource} = extended
        ? validateExtended(dto, facts, admittedResources, limits)
        : {next:validate(detached, detach(factsRoster(facts, admittedResources), limits).value, limits, facts),applySource:undefined};
      if (resolvers) {
        const table = resolvers.table;
        if ((next.progress===undefined && applySource===undefined)!==(table.texture.kind==="none")
          || dto.registry===null && table.entityExists.kind!=="none") fail("resolver/context relation mismatch");
      }
      const token: AdmittedNativeFileAuthoringBindings = Object.freeze({ kind: "admitted-native-file-authoring-bindings" });
      admittedAuthoringPlans.set(token, { owner, ...next, resolvers, applySource });
      return token;
    } catch(error) { resolvers?.discard(); throw error; }
}
/** Only after Root A.install and real detached facade creation. Canonical
 * actual native identity+readers must match the same admitted facts. Failed
 * actual-target attach consumes this token; Root discards only that new target. */
export function attachAdmittedNativeFileAuthoringBindings(owner: object, engine: FerrumEngine, token: AdmittedNativeFileAuthoringBindings): SceneInstanceHandleRegistry | undefined {
    const plan = admittedAuthoringPlans.get(token);
    if (!plan || plan.owner !== owner)
        fail("foreign or consumed authoring admission");
    admittedAuthoringPlans.delete(token);
    try {
    const guard = inspectNativeFileCanonicalAuthoringMetadata(engine, owner);
    if (guard.progress || guard.continuity || guard.epoch !== plan.epoch || guard.spatialRevision !== plan.spatialRevision)
        fail("actual canonical target epoch/revision or metadata mismatch");
    const callbacks = plan.resolvers?.attach(engine);
    const progress = plan.progress && { ...plan.progress, ...(callbacks ? { textureId: callbacks.texture } : {}) };
    let registry = plan.registry;
    if (registry && callbacks?.exists) {
      const old = captureSceneInstanceRegistryMetadata(registry,4096);
      registry = new SceneInstanceHandleRegistry({entityExists:callbacks.exists});
      for(const e of old.entries)registry.set(e.instanceId,e.handle);
    }
    attachDataSceneAuthoringMetadata(engine, guard, progress, plan.continuity);
    attachNativeFileApplySource(engine,plan.applySource,callbacks?.texture);
    return registry;
    } catch(error) { plan.resolvers?.discard(); throw error; }
}
/** Current source only; capture still rejects opaque texture resolver callbacks
 * without canonical proof and never executes/serializes one to infer bindings. */
export function captureNativeFileAuthoringBindingsFromFacts(engine: FerrumEngine, registry: SceneInstanceHandleRegistry | undefined, facts: NativeFileNativeFacts, admittedResources: NativeFileAuthoringResources, overrides: Partial<NativeFileAuthoringLimits> = {}, resolverCapture?: NativeFileAuthoringResolverCapture): NativeFileAuthoringBindings {
    if(!resolverCapture)return captureNativeFileAuthoringBindings(engine, registry, factsRoster(facts, admittedResources), overrides, facts);
    assertNativeFileResolverCapture(engine,resolverCapture);
    const limits=limitsFor(overrides), guard=inspectNativeFileCanonicalAuthoringMetadata(engine,nativeFileEngineOwner(engine).native);
    if(guard.epoch!==facts.dataSceneEpoch||guard.spatialRevision!==facts.configurationRevision)fail("source facts cut epoch/revision mismatch");
    const state=registry&&captureSceneInstanceRegistryMetadata(registry,limits.maxInstances,true);
    const source=nativeFileApplySource(engine);
    const snapshot=detach({version:1,
      progress:guard.progress?{epoch:guard.progress.epoch,spatialRevision:guard.progress.spatialRevision,document:readSourceDocument(guard.progress.document,limits),handles:ownBindings(guard.progress.handles,limits)}:null,
      continuity:guard.continuity?{epoch:guard.continuity.epoch,metadata:guard.continuity.metadata,handles:ownBindings(guard.continuity.handles,limits)}:null,
      registry:state?.entries??null,resources:admittedResources,resolvers:resolverCapture.table,applySource:source??null},limits).value;
    validateExtended(record(snapshot),facts,admittedResources,limits);
    assertNativeFileResolverCapture(engine,resolverCapture);
    if(!sameGuard(guard,inspectDataSceneAuthoringMetadata(engine)) || registry&&!sceneInstanceRegistryMetadataUnchanged(registry,state!.revision))fail("capture metadata changed");
    return snapshot as unknown as NativeFileAuthoringBindings;
}
function readSourceDocument(source:string,limits:NativeFileAuthoringLimits):Json {
  if(source.length>limits.maxDocumentBytes)fail("document byte budget exceeded");
  let size=0;
  for(let i=0;i<source.length;i++){const c=source.charCodeAt(i);size+=c<128?1:c<2048?2:c>=0xd800&&c<=0xdbff&&source.charCodeAt(i+1)>=0xdc00&&source.charCodeAt(i+1)<=0xdfff?(i++,4):3;if(size>limits.maxDocumentBytes)fail("document byte budget exceeded");}
  const bytes=new TextEncoder().encode(source);
  return readNativeFileJson(bytes,{maxBytes:limits.maxDocumentBytes,maxDepth:limits.maxDepth,maxValues:limits.maxNodes,maxMembers:limits.maxMembers,maxStringCodeUnits:limits.maxStringCodeUnits,maxTotalStringCodeUnits:limits.maxTotalStringCodeUnits}).value as Json;
}
function resolverTable(value:Json):NativeFileAuthoringResolverTable {
  const t=record(value,["version","textureNamespace","texture","entityExists"]);
  for(const key of ["texture","entityExists"]){const e=record(t[key]);if(e.kind==="host")record(e,["kind","reference"]);else record(e,["kind"]);}
  if(t.textureNamespace!==null)for(const e of array(t.textureNamespace,4096))record(e,["name","id"]);
  return t as unknown as NativeFileAuthoringResolverTable;
}
/** Validate the original baseline JSON without mapping it to current slots.
 * Runtime component values may already differ from this authored history. */
function originalProgress(value:Json,limits:NativeFileAuthoringLimits,facts:NativeFileNativeFacts):DataSceneProgressContextMetadata {
  const p=record(value,["epoch","spatialRevision","document","handles"]),list=bindings(p.handles,limits),doc=record(p.document);
  preflightResolution(doc,limits);
  const resolved=resolveSceneAuthoringDocument(doc,{validateBindings:true,validateComponents:true});
  const ids=new Set(list.map(e=>e.instanceId));
  if(resolved.bindingPlan!.instances.length!==list.length||resolved.bindingPlan!.instances.some(e=>!ids.has(e.id)))fail("original progress/instance census mismatch");
  for(const e of list)facts.classify(e.handle);
  return {epoch:uint(p.epoch),spatialRevision:uint(p.spatialRevision),document:canonical(doc),handles:handles(list)};
}
function validateExtended(dto:Dict,facts:NativeFileNativeFacts,admittedResources:NativeFileAuthoringResources,limits:NativeFileAuthoringLimits) {
  const base={version:dto.version,progress:dto.progress,continuity:dto.continuity,registry:dto.registry,resources:dto.resources};
  let applySource:NativeFileApplySource|undefined;
  if(dto.applySource!==null){
    if(dto.continuity===null)fail("apply source requires actual continuity context");
    const a=record(dto.applySource,["epoch","spatialRevision","document","templates","handles"]),doc=record(a.document),templates=record(a.templates);
    const effective={...doc,componentTemplates:{...(doc.componentTemplates===undefined?{}:record(doc.componentTemplates)),...templates}};
    base.progress={epoch:a.epoch,spatialRevision:a.spatialRevision,document:effective as Json,handles:a.handles};
    applySource={epoch:uint(a.epoch),spatialRevision:uint(a.spatialRevision),document:a.document,templates:a.templates,handles:bindings(a.handles,limits)};
    if(dto.progress!==null){const p=record(dto.progress);if(p.epoch!==a.epoch||p.spatialRevision!==a.spatialRevision||!equal(p.document,a.document)||!equal(p.handles,a.handles))fail("progress/apply source writer relation mismatch");}
  }
  const next=validate(base,detach(factsRoster(facts,admittedResources),limits).value,limits,facts);
  if(applySource)next.progress=dto.progress===null?undefined:originalProgress(dto.progress,limits,facts);
  return {next,applySource};
}

function resources(value: Json, limits: NativeFileAuthoringLimits,ownerIds=false) {
    const raw = record(value, ["textures", "models"]), textures = new Map<number, string>(), names = new Map<string, number>(), models = new Map<number, string>(), assets = new Map<string, {
        id: number;
        contentId: string;
    }>();
    function hash(v: Json) { const h = text(v); if (!/^[a-f0-9]{64}$/.test(h))
        fail("resource content identity must be SHA-256"); return h; }
    for (const item of array(raw.textures, limits.maxResources)) {
        const e = record(item, ["id", "names", "contentId"]), id = uint(e.id, ownerIds?Number.MAX_SAFE_INTEGER:16777214);
        if (textures.has(id))
            fail("duplicate texture ID");
        textures.set(id, hash(e.contentId));
        for (const n of array(e.names, limits.maxResources)) {
            const name = text(n);
            if (names.has(name))
                fail("duplicate texture alias");
            names.set(name, id);
        }
    }
    for (const item of array(raw.models, limits.maxResources)) {
        const e = record(item, ["id", "asset", "contentId"]), id = uint(e.id), asset = text(e.asset), contentId = hash(e.contentId);
        if (models.has(id) || assets.has(asset))
            fail("duplicate model ID/asset");
        models.set(id, contentId);
        assets.set(asset, { id, contentId });
    }
    return { textures, names, models, assets, canonical: { textures: [...textures].sort((a, b) => a[0] - b[0]), names: [...names].sort(), models: [...models].sort((a, b) => a[0] - b[0]), assets: [...assets].sort() } };
}
function validate(snapshot: Json, roster: Json, limits: NativeFileAuthoringLimits, facts?:NativeFileNativeFacts) {
    const dto = record(snapshot, ["version", "progress", "continuity", "registry", "resources"]);
    if (dto.version !== 1)
        fail("unsupported version");
    const native = record(roster, ["scene", "epoch", "spatialRevision", "entities", "resources"]);
    if (native.scene !== "data" && native.scene !== "none")
        fail("native scene kind mismatch");
    const epoch = uint(native.epoch), spatialRevision = uint(native.spatialRevision), index = resources(dto.resources, limits,!!facts), nativeResources = resources(native.resources, limits,!!facts);
    if (!equal(index.canonical, nativeResources.canonical))
        fail("resource ID/content/alias mismatch");
    const entities = new Map<string, {
        state: string;
        clips: readonly number[];
        textures: readonly number[];
        models: readonly number[];
    }>();
    for (const raw of array(native.entities, limits.maxInstances)) {
        const e = record(raw, ["handle", "kind", "state", "animationClipIds", "textureIds", "modelIds"]), h = handle(e.handle);
        if (e.kind !== "data-scene" || e.state !== "live" && e.state !== "removed" || entities.has(key(h)))
            fail("native identity/type/state mismatch");
        const numbers = (v: Json, max: number) => { const result = array(v, max).map(n => uint(n)); if (new Set(result).size !== result.length)
            fail("duplicate native binding"); return result; };
        const textures = numbers(e.textureIds, limits.maxResources), models = numbers(e.modelIds, limits.maxResources), clips = numbers(e.animationClipIds, 64);
        if (textures.some(id => !index.textures.has(id)) || models.some(id => !index.models.has(id)))
            fail("unknown native resource ID");
        entities.set(key(h), { state: e.state, clips, textures, models });
    }
    const shared = new Map<string, GameplayEntityHandle>(), reverse = new Map<string, string>();
    function bound(v: Json) { const list = bindings(v, limits); for (const e of list) {
        const old = shared.get(e.instanceId), other = reverse.get(key(e.handle));
        if ((!facts&&!entities.has(key(e.handle))) || old && key(old) !== key(e.handle) || other && other !== e.instanceId)
            fail("instance/native generation/shared relation mismatch");
        // Facts classify current slots only; retained handles are never relabeled removed/live.
        facts?.classify(e.handle);
        shared.set(e.instanceId, e.handle);
        reverse.set(key(e.handle), e.instanceId);
    } return list; }
    let progress: DataSceneProgressContextMetadata | undefined, continuity: DataSceneContinuityContextMetadata | undefined;
    let list: readonly Binding[] = [], resolved: ReturnType<typeof resolveSceneAuthoringDocument> | undefined;
    const animations: Record<string, unknown> = Object.create(null);
    if (dto.progress !== null) {
        const p = record(dto.progress, ["epoch", "spatialRevision", "document", "handles"]);
        if (!facts&&(native.scene !== "data" || epoch === 0 || p.epoch !== epoch || p.spatialRevision !== spatialRevision))
            fail("authoring epoch/revision mismatch");
        uint(p.epoch);uint(p.spatialRevision);
        list = bound(p.handles);
        const doc = record(p.document);
        preflightResolution(doc, limits);
        resolved = resolveSceneAuthoringDocument(doc, { validateBindings: true, validateComponents: true });
        const instances = resolved.bindingPlan!.instances;
        if (instances.length !== list.length)
            fail("document/instance census mismatch");
        const byId = new Map(list.map(e => [e.instanceId, e.handle]));
        for (const instance of instances) {
            const h = byId.get(instance.id);
            if (!h)
                fail("document instance missing native binding");
            const declared = resolveDataSceneInstanceComponents(instance, { allowTemplate: true });
            const c = declared.mode === "inline" ? declared : resolveDataSceneComponentsSpec(resolved.componentTemplates?.[declared.template], { allowTemplate: false });
            if (c.mode !== "inline")
                fail("materialized component catalog required");
            const entity = entities.get(key(h));
            const refs = [c.sprite.texture, c.sprite.normalTexture, c.sprite.surface?.emissionTexture, c.sprite.surface?.specularTexture, c.sprite.surface?.roughnessTexture].filter((v): v is ResolvedDataSceneTextureRef => v !== undefined);
            for (const ref of refs) {
                const id = ref.kind === "id" ? ref.id ?? Number(ref.value) : index.names.get(ref.name ?? String(ref.value));
                if (!facts&&(id === undefined || !index.textures.has(id) || entity?.state === "live" && !entity.textures.includes(id)))
                    fail("instance texture binding mismatch");
            }
            if (c.sprite.animationSet) {
                animations[instance.id] = c.sprite.animationSet;
                const ids = c.sprite.animationSet.clips.map(v => v.id).sort((a, b) => a - b);
                if (!facts&&entity?.state === "live" && !equal(ids, [...entity.clips].sort((a, b) => a - b)))
                    fail("native animation IDs mismatch");
            }
            else if (!facts&&entity?.state === "live" && entity.clips.length)
                fail("unexpected native animation configuration");
        }
        // Check resource-bearing schema subtrees, without treating arbitrary application props as assets.
        for (const subtree of [doc.componentTemplates, doc.spatial, doc.lighting, doc.gameplay === undefined ? undefined : record(doc.gameplay).projectilePrefabs])
            if (subtree !== undefined&&!facts)
                checkTextureReferences(subtree, index);
        const resolver = (name: string) => { const id = index.names.get(name); if (id === undefined)
            fail("unbound texture name"); return id; };
        resolverResources.set(resolver, canonical(index.canonical));
        progress = { epoch:facts?uint(p.epoch):epoch, spatialRevision:facts?uint(p.spatialRevision):spatialRevision, document: canonical(p.document), handles: handles(list), textureId: resolver };
    }
    if (dto.continuity !== null) {
        if (!progress || !resolved)
            fail("continuity requires complete materialized document");
        const c = record(dto.continuity, ["epoch", "metadata", "handles"]);
        if (c.epoch !== (facts?progress.epoch:epoch))
            fail("continuity epoch mismatch");
        const links = bound(c.handles);
        if (!equal(links, list))
            fail("continuity/progress instance relation mismatch");
        const metadata = record(c.metadata);
        if (Object.keys(metadata).some(k => k !== "animations" && k !== "models"))
            fail("unknown continuity field");
        const actual = record(metadata.animations);
        if (Object.keys(actual).length !== Object.keys(animations).length)
            fail("animation continuity census mismatch");
        for (const [id, spec] of Object.entries(actual))
            if (!animations[id] || !equal(resolveDataSceneSpriteAnimationSet(spec), animations[id]))
                fail("animation continuity configuration mismatch");
        if (!equal(metadata.models, resolved.spatial?.models))
            fail("model continuity configuration mismatch");
        for (const [id, spec] of Object.entries(resolved.spatial?.models ?? {})) {
            const h = shared.get(id);
            if (!h)
                fail("model missing native binding");
            const entity = entities.get(key(h));
            for (const model of [spec, ...(spec.lods ?? [])]) {
                const r = index.assets.get(model.asset);
                if (!facts&&(!r || r.contentId !== model.contentId || entity?.state === "live" && !entity.models.includes(r.id)))
                    fail("model resource binding mismatch");
            }
        }
        continuity = { epoch:facts?uint(c.epoch):epoch, handles: handles(links), metadata: metadata as unknown as DataSceneAuthoringContinuityMetadata };
    }
    else if (Object.keys(animations).length || Object.keys(resolved?.spatial?.models ?? {}).length)
        fail("missing continuity metadata");
    let registry: SceneInstanceHandleRegistry | undefined;
    if (dto.registry !== null) {
        // Registry is a separately mutable current owner. Its public set can
        // rebind a reused slot while baseline contexts retain original handles.
        const stored = facts?bindings(dto.registry,limits):bound(dto.registry);
        if(facts)for(const entry of stored)facts.classify(entry.handle);
        if (!facts&&!progress && stored.length)
            fail("registry missing complete document");
        const ids = new Set(list.map(e => e.instanceId));
        for (const e of stored)
            if (!facts&&!ids.has(e.instanceId))
                fail("registry instance absent from document");
        registry = new SceneInstanceHandleRegistry();
        for (const e of stored)
            registry.set(e.instanceId, e.handle);
    }
    if (!facts&&!progress && (entities.size || native.scene !== "none"))
        fail("native authoring state missing document metadata");
    return { epoch, spatialRevision, progress, continuity, registry };
}
function checkTextureReferences(value: Json, index: ReturnType<typeof resources>): void {
    if (!value || typeof value !== "object")
        return;
    if (Array.isArray(value)) {
        for (const v of value)
            checkTextureReferences(v, index);
        return;
    }
    for (const [k, v] of Object.entries(value)) {
        if (["texture", "textureId", "normalTexture", "normalTextureId", "emissionTexture", "specularTexture", "roughnessTexture"].includes(k)) {
            const id = typeof v === "string" ? index.names.get(v) : typeof v === "number" ? v : undefined;
            if (id === undefined || !index.textures.has(id))
                fail("document texture reference mismatch");
        }
        else
            checkTextureReferences(v, index);
    }
}
/** Bound graph/reference work before the existing resolver clones or expands it. */
function preflightResolution(document: Dict, limits: NativeFileAuthoringLimits): void {
    const count = detach(document, limits).nodes, composition = record(document.sceneComposition), prefabs = record(composition.prefabs);
    let work = 0;
    function charge(n: number) { if (n > Math.floor(limits.maxResolveWork / Math.max(1, count)) - work)
        fail("resolution work budget exceeded"); work += n; }
    for (const prefab of Object.values(prefabs)) {
        const source = record(prefab).variants;
        if (source === undefined)
            continue;
        const variants = record(source);
        for (const id of Object.keys(variants)) {
            const seen = new Set<string>();
            let at: string | undefined = id;
            while (at !== undefined) {
                charge(1);
                if (seen.size >= limits.maxDepth || seen.has(at))
                    fail("variant reference depth/cycle");
                seen.add(at);
                const v = record(variants[at]);
                at = v.extends === undefined ? undefined : text(v.extends);
            }
        }
    }
    const fragments: Record<string, unknown> = composition.fragments === undefined ? { main: {} } : record(composition.fragments), active = new Set<string>(), memo = new Map<string, {
        visits: number;
        instances: number;
        depth: number;
    }>();
    function visit(id: string, depth: number): {
        visits: number;
        instances: number;
        depth: number;
    } {
        if (depth >= limits.maxDepth || active.has(id))
            fail("fragment reference depth/cycle");
        const cached = memo.get(id);
        if (cached) {
            if (depth + cached.depth > limits.maxDepth)
                fail("fragment reference depth");
            return cached;
        }
        const fragment = record(fragments[id]);
        active.add(id);
        let visits = 1, instances = fragment.instances === undefined ? 0 : array(fragment.instances, limits.maxInstances).length, height = 1;
        for (const raw of fragment.include === undefined ? [] : array(fragment.include, limits.maxMembers)) {
            const child = visit(text(record(raw).fragment), depth + 1);
            if (child.visits > limits.maxResolveWork - visits || child.instances > limits.maxInstances - instances)
                fail("expanded fragment budget exceeded");
            visits += child.visits;
            instances += child.instances;
            height = Math.max(height, child.depth + 1);
        }
        if (instances > limits.maxInstances)
            fail("expanded instance budget exceeded");
        active.delete(id);
        const result = { visits, instances, depth: height };
        memo.set(id, result);
        return result;
    }
    for (const id of Object.keys(fragments))
        charge(visit(id, 0).visits);
}
