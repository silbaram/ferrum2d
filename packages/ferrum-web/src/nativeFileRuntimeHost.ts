/** @internal Actual facade HostBindings. Capabilities are explicit host symbols;
 * this participant neither executes callbacks nor publishes a Ready session. */
import type { DetachedEngineMetadata } from "./nativeFileEngineOwner.js";
import { captureDetachedEngineMetadata, nativeFileEngineOwner } from "./nativeFileEngineOwner.js";
import type { FerrumEngine } from "./engineTypes.js";
import { ResourceBudget, NativeFileResourceError } from "./nativeFileResourceBudget.js";
import { decodeNativeFileResourceGraph, encodeNativeFileResourceGraph } from "./nativeFileResourceCodec.js";
import {
  captureNativeFileHostBinding, captureNativeFileHostBindingFence, consumePreparedNativeFileHostBindings,
  defineNativeFileHostBindingType, discardPreparedNativeFileHostBindings, nativeFileHostBindingFenceUnchanged,
  prepareNativeFileHostBindings, registerNativeFileHostBinding, resolvePreparedNativeFileHostBinding,
  type NativeFileHostBindingReference, type NativeFileHostBindingType, type PreparedNativeFileHostBindings,
} from "./nativeFileHostBindings.js";
import { HOST_EFFECT_CALLBACKS, HOST_EFFECT_DATA, HOST_FRAME, HOST_LIFECYCLE, HOST_OPTIONS, HOST_ROLES,
  validateRuntimeHostDocument, type NativeFileRuntimeHostRole, type RuntimeHostDocument } from "./nativeFileRuntimeHostData.js";
import type { HostRecord } from "./nativeFileRuntimeHostPhysics.js";
export type { NativeFileRuntimeHostRole } from "./nativeFileRuntimeHostData.js";

export const NATIVE_FILE_RUNTIME_HOST_TYPES: Readonly<Record<NativeFileRuntimeHostRole, NativeFileHostBindingType<object>>> = Object.freeze(Object.fromEntries(
  HOST_ROLES.map(role => [role, defineNativeFileHostBindingType<object>(`runtime-host.${role.toLowerCase()}`, 1,
    (value, identity): value is object => role === "options.effectEvents.target"
      ? value !== null && typeof value === "object" && identity !== null && typeof identity === "object"
      : typeof value === "function" && typeof identity === "function")]),
) as Record<NativeFileRuntimeHostRole, NativeFileHostBindingType<object>>);
/** Trusted registration only. A different value/identity is an explicit adapter. */
export function registerNativeFileRuntimeHostBinding(owner: object, role: NativeFileRuntimeHostRole, symbol: string, value: object, identity: object = value): void {
  const type = NATIVE_FILE_RUNTIME_HOST_TYPES[role]; if (!type) throw new NativeFileResourceError("CAPABILITY", "host role");
  registerNativeFileHostBinding(owner, type, symbol, value, identity);
}
const CODEC = Object.freeze({ maxManifestBytes: 4 * 1024 * 1024, maxDataBytes: 16 });
// Existing ResourceCodec F2DRES\0\0 header, version1, zero payload.
const EMPTY_DATA = new Uint8Array([70, 50, 68, 82, 69, 83, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
const FRAME_OWNER_KEYS = ["isAlive", "bridge", "rustEngine", "physicsSpec", "physicsSpecScene", "synchronizePhysicsMetadata", ...HOST_FRAME, "assetHost", "particlePresetExists", "lastViewportWidth", "lastViewportHeight", "viewportDirty", "options"];
interface Observation { readonly value: object; readonly prototype: object | null; readonly keys: readonly PropertyKey[]; readonly descriptors: readonly PropertyDescriptor[] }
/** Descriptor-only source cut, under ResourceCodec's ordinary-owner/trusted-
 * intrinsics premise, not a hostile Proxy sandbox. Logical clone/fence requests
 * are precharged; reflection/structuredClone are not a process/RSS bound. */
class SourceObservation {
  private readonly rows: Observation[] = [];
  private readonly copies = new WeakMap<object, HostRecord>();
  private readonly visited = new WeakSet<object>();
  private readonly active = new WeakSet<object>();
  private members = 0;
  constructor(private readonly b: ResourceBudget) {}
  record(value: unknown, allowed?: readonly string[], array = false): HostRecord {
    this.b.work(1);
    if (!value || typeof value !== "object" || Array.isArray(value) !== array) return this.b.fail("CAPABILITY", "ordinary source data");
    const prior = this.copies.get(value); if (prior) return prior;
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) this.b.fail("CAPABILITY", "source prototype");
    if (this.rows.length >= 65536) this.b.fail("LIMIT", "source nodes");
    this.b.charge("decodedBytes", 96);
    const keys = Reflect.ownKeys(value); this.b.work(keys.length); this.b.charge("decodedBytes", keys.length * 64);
    if (keys.length > 262144 - this.members) this.b.fail("LIMIT", "source members"); this.members += keys.length;
    const descriptors: PropertyDescriptor[] = [], copy: HostRecord = Object.create(null);
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== "string" || !d || !("value" in d) || (array && key === "length" ? false : !d.enumerable)
        || (allowed && !allowed.includes(key))) this.b.fail("CAPABILITY", "source field/accessor");
      this.b.metadata(key); descriptors.push(d); Object.defineProperty(copy, key, { value: d.value, enumerable: true });
    }
    this.rows.push({ value, prototype, keys, descriptors }); this.copies.set(value, copy); return copy;
  }
  graph(value: unknown, depth = 0): void {
    this.b.work(1); if (depth > 64) this.b.fail("LIMIT", "source depth");
    if (value === undefined || value === null || typeof value === "boolean") return;
    if (typeof value === "number") { if (!Number.isFinite(value)) this.b.fail("DATA", "source finite number"); return; }
    if (typeof value === "string") { this.b.metadata(value); this.b.charge("decodedBytes", value.length * 2); return; }
    if (typeof value !== "object") this.b.fail("CAPABILITY", "source data value");
    if (this.active.has(value)) this.b.fail("DATA", "source cycle"); if (this.visited.has(value)) return;
    this.active.add(value); const a = Array.isArray(value), copy = this.record(value, undefined, a);
    if (a) {
      const length = copy.length as number; if (Object.keys(copy).length !== length + 1) this.b.fail("DATA", "source dense array");
      for (let i = 0; i < length; i++) { if (!Object.prototype.hasOwnProperty.call(copy, String(i))) this.b.fail("DATA", "source dense array"); this.graph(copy[i], depth + 1); }
    } else for (const v of Object.values(copy)) this.graph(v, depth + 1);
    this.active.delete(value); this.visited.add(value);
  }
  /** Each structuredClone is a separate allocation domain even when its input
   * shares objects with the other spec. This is a logical request allowance. */
  cloneAllowance(value: unknown, seen = new WeakSet<object>()): void {
    this.b.work(1);
    if (typeof value === "string") { this.b.charge("decodedBytes", value.length * 2); return; }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    this.b.charge("decodedBytes", 48); seen.add(value);
    const copy = this.copies.get(value); if (!copy) this.b.fail("DATA", "unobserved clone input");
    const keys = Object.keys(copy); this.b.work(keys.length); this.b.charge("decodedBytes", keys.length * 24);
    for (const key of keys) this.cloneAllowance(copy[key], seen);
  }
  assertCurrent(): void {
    for (const row of this.rows) {
      this.b.work(1 + row.keys.length); this.b.charge("decodedBytes", row.keys.length * 8);
      if (Object.getPrototypeOf(row.value) !== row.prototype) this.b.fail("STALE", "source prototype");
      const keys = Reflect.ownKeys(row.value); if (keys.length !== row.keys.length) this.b.fail("STALE", "source keys");
      for (let i = 0; i < keys.length; i++) {
        const d = Object.getOwnPropertyDescriptor(row.value, keys[i]), saved = row.descriptors[i];
        if (keys[i] !== row.keys[i] || !d || !("value" in d) || !Object.is(d.value, saved.value)
          || d.enumerable !== saved.enumerable || d.writable !== saved.writable || d.configurable !== saved.configurable) this.b.fail("STALE", "source field");
      }
    }
  }
}
export interface CapturedNativeFileRuntimeHost { readonly bytes: Uint8Array<ArrayBuffer>; assertCurrent(): void }
export interface ResolvedNativeFileRuntimeHostReference {
  readonly role: NativeFileRuntimeHostRole; readonly reference: NativeFileHostBindingReference;
  /** Host-owned opaque value for the trusted target platform factory. The reader
   * never invokes or installs it on a new renderer/asset host. */
  readonly value: object;
}
type ReadonlyData<T> = T extends object ? { readonly [K in keyof T]: ReadonlyData<T[K]> } : T;
export interface InspectedNativeFileRuntimeHost {
  readonly metadata: ReadonlyData<DetachedEngineMetadata>;
  /** Capability slots are null markers. Explicit undefined and absence survive;
   * casting/merging this object into CreateEngineOptions is invalid. */
  readonly optionsData: Readonly<HostRecord>; readonly frameData: Readonly<HostRecord>;
  readonly resolvedReferences: readonly ResolvedNativeFileRuntimeHostReference[];
}
export interface AdmittedNativeFileRuntimeHost { readonly kind: "native-file-runtime-host" }
interface Plan { readonly owner: object; readonly budget: ResourceBudget; readonly bindings: PreparedNativeFileHostBindings; readonly registryFence: ReturnType<typeof captureNativeFileHostBindingFence>; readonly inspected: InspectedNativeFileRuntimeHost }
const plans = new WeakMap<AdmittedNativeFileRuntimeHost, Plan>();
function capability<T>(b: ResourceBudget, action: () => T): T {
  try { return action(); } catch (error) { if (error instanceof NativeFileResourceError) throw error; return b.fail("CAPABILITY", "host binding"); }
}
function allocation<T>(b: ResourceBudget, action: () => T): T { try { return action(); } catch { return b.fail("ALLOCATION", "host output"); } }
function freezeData(v: unknown, b: ResourceBudget, seen = new WeakSet<object>()): void {
  b.work(1); if (!v || typeof v !== "object" || seen.has(v)) return;
  b.charge("decodedBytes", 16); seen.add(v);
  for (const key of Object.keys(v)) { b.work(1); freezeData((v as HostRecord)[key], b, seen); } Object.freeze(v);
}
export function captureNativeFileRuntimeHost(actualEngine: FerrumEngine, budget: ResourceBudget, bindingOwner: object = actualEngine): CapturedNativeFileRuntimeHost {
  const owner = nativeFileEngineOwner(actualEngine), observation = new SourceObservation(budget);
  budget.charge("decodedBytes", 256 + HOST_ROLES.length * 96);
  const registryFence = captureNativeFileHostBindingFence(bindingOwner);
  const frame = observation.record(owner.frame, FRAME_OWNER_KEYS), options = observation.record(owner.options, HOST_OPTIONS);
  if (frame.options !== owner.options || frame.bridge !== owner.bridge || frame.rustEngine !== owner.native) budget.fail("STALE", "actual frame owner");
  const bindings: { role: NativeFileRuntimeHostRole; reference: NativeFileHostBindingReference }[] = [];
  const slot = (v: unknown, role: NativeFileRuntimeHostRole): unknown => {
    if (v === undefined) return undefined;
    const type = NATIVE_FILE_RUNTIME_HOST_TYPES[role];
    if (role === "options.effectEvents.target" ? !v || typeof v !== "object" : typeof v !== "function") budget.fail("CAPABILITY", role);
    budget.work(1); budget.charge("decodedBytes", 96);
    const reference = capability(budget, () => captureNativeFileHostBinding(bindingOwner, type, v as object));
    budget.metadata(reference.kind); budget.metadata(reference.symbol); bindings.push({ role, reference }); return null;
  };
  const optionsData: HostRecord = {}, frameData: HostRecord = {};
  for (const [k, value] of Object.entries(options)) {
    if (k === "lifecycle" && value !== undefined) {
      const lifecycle = observation.record(value, HOST_LIFECYCLE), data: HostRecord = {};
      for (const [k, v] of Object.entries(lifecycle)) data[k] = slot(v, `options.lifecycle.${k}` as NativeFileRuntimeHostRole); optionsData[k] = data;
    } else if (k === "effectEvents" && value !== undefined && value !== false) {
      const effect = observation.record(value, [...HOST_EFFECT_DATA, ...HOST_EFFECT_CALLBACKS]), data: HostRecord = {};
      for (const [k, v] of Object.entries(effect)) {
        data[k] = (HOST_EFFECT_CALLBACKS as readonly string[]).includes(k) ? slot(v, `options.effectEvents.${k}` as NativeFileRuntimeHostRole) : v;
        if (!(HOST_EFFECT_CALLBACKS as readonly string[]).includes(k)) observation.graph(v);
      } optionsData[k] = data;
    } else { observation.graph(value); optionsData[k] = value; }
  }
  for (const k of HOST_FRAME) if (Object.prototype.hasOwnProperty.call(frame, k)) frameData[k] = k === "needsFrameState" || k === "needsPhysicsDebugLineBuffer" ? frame[k] : slot(frame[k], `frame.${k}` as NativeFileRuntimeHostRole);
  // Inspect and precharge before the actual-owner helper clones the two specs.
  observation.graph(owner.initialPhysicsSpec); observation.graph(frame.physicsSpec);
  observation.cloneAllowance(owner.initialPhysicsSpec); observation.cloneAllowance(frame.physicsSpec);
  const presets = owner.particlePresetIds;
  if (Object.getPrototypeOf(presets) !== Set.prototype || Reflect.ownKeys(presets).length) budget.fail("CAPABILITY", "actual preset set");
  const size = Object.getOwnPropertyDescriptor(Set.prototype, "size")!.get!.call(presets) as number;
  budget.work(size); budget.charge("decodedBytes", 64 + size * 24);
  const presetIds = Array.from(Set.prototype.values.call(presets) as SetIterator<number>);
  const metadata = allocation(budget, () => captureDetachedEngineMetadata(owner));
  const document: RuntimeHostDocument = { format: "ferrum-native-runtime-host", version: 1, metadata: metadata as unknown as HostRecord, options: optionsData, frame: frameData, bindings };
  validateRuntimeHostDocument(document, budget);
  const encoded = encodeNativeFileResourceGraph(document, budget, CODEC);
  const assertCurrent = (): void => {
    if (nativeFileEngineOwner(actualEngine) !== owner) budget.fail("STALE", "actual owner");
    if (!nativeFileHostBindingFenceUnchanged(bindingOwner, registryFence)) budget.fail("STALE", "host registry"); observation.assertCurrent(); budget.work(size + 1);
    if (Object.getPrototypeOf(presets) !== Set.prototype || Reflect.ownKeys(presets).length
      || Object.getOwnPropertyDescriptor(Set.prototype, "size")!.get!.call(presets) !== size) budget.fail("STALE", "preset set");
    let i = 0; for (const id of Set.prototype.values.call(presets) as SetIterator<number>) if (!Object.is(id, presetIds[i++])) budget.fail("STALE", "preset order");
  }; assertCurrent(); return Object.freeze({ bytes: encoded.manifestBytes, assertCurrent });
}
export function admitNativeFileRuntimeHost(owner: object, bytes: Uint8Array, budget: ResourceBudget): AdmittedNativeFileRuntimeHost {
  budget.charge("decodedBytes", 256 + HOST_ROLES.length * 128);
  const document = validateRuntimeHostDocument(decodeNativeFileResourceGraph(bytes, EMPTY_DATA, budget, CODEC), budget);
  const requests = document.bindings.map(row => ({ type: NATIVE_FILE_RUNTIME_HOST_TYPES[row.role], reference: row.reference }));
  const bindings = capability(budget, () => prepareNativeFileHostBindings(owner, requests, budget));
  try {
    const resolvedReferences = Object.freeze(document.bindings.map(row => Object.freeze({ role: row.role, reference: row.reference,
      value: capability(budget, () => resolvePreparedNativeFileHostBinding(owner, bindings, NATIVE_FILE_RUNTIME_HOST_TYPES[row.role], row.reference.symbol)) })));
    freezeData(document, budget);
    const inspected = Object.freeze({ metadata: document.metadata as unknown as ReadonlyData<DetachedEngineMetadata>, optionsData: document.options, frameData: document.frame, resolvedReferences });
    const token = Object.freeze({ kind: "native-file-runtime-host" as const });
    plans.set(token, { owner, budget, bindings, registryFence: captureNativeFileHostBindingFence(owner), inspected }); return token;
  } catch (error) { discardPreparedNativeFileHostBindings(owner, bindings); throw error; }
}
function plan(owner: object, token: AdmittedNativeFileRuntimeHost): Plan {
  const p = plans.get(token); if (!p || p.owner !== owner) throw new NativeFileResourceError("CAPABILITY", "foreign or consumed host token");
  p.budget.work(1); if (!nativeFileHostBindingFenceUnchanged(owner, p.registryFence)) p.budget.fail("STALE", "host registry"); return p;
}
export function inspectNativeFileRuntimeHost(owner: object, token: AdmittedNativeFileRuntimeHost): InspectedNativeFileRuntimeHost { return plan(owner, token).inspected; }
/** One-use handoff, without callback invocation, target installation or publish. */
export function consumeNativeFileRuntimeHost(owner: object, token: AdmittedNativeFileRuntimeHost): InspectedNativeFileRuntimeHost {
  const p = plan(owner, token); capability(p.budget, () => consumePreparedNativeFileHostBindings(owner, p.bindings)); plans.delete(token); return p.inspected;
}
export function discardNativeFileRuntimeHost(owner: object, token: AdmittedNativeFileRuntimeHost): void {
  const p = plans.get(token); if (!p) return;
  if (p.owner !== owner) throw new NativeFileResourceError("CAPABILITY", "foreign host token");
  discardPreparedNativeFileHostBindings(owner, p.bindings); plans.delete(token);
}
