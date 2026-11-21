/** @internal Trusted host capabilities for detached file preparation.
 * A file supplies only kind/version/symbol data. It cannot supply code or invoke
 * validators/adapters through this registry. Registration validates an actual
 * host value once; resource owners invoke their typed adapters separately.
 * Registry revisions cover registration changes, not mutations inside a host
 * object, resource GPU generations, Engine epochs, or whole-session publication.
 */

declare const bindingValue: unique symbol;

export interface NativeFileHostBindingType<T extends object> {
  readonly kind: string;
  readonly version: number;
  readonly [bindingValue]?: T;
}

export interface NativeFileHostBindingReference {
  readonly kind: string;
  readonly version: number;
  readonly symbol: string;
}

export type NativeFileHostBindingErrorCode =
  | "TYPE" | "REFERENCE" | "VALUE" | "DUPLICATE" | "MISSING"
  | "AMBIGUOUS" | "LIMIT" | "STALE" | "TOKEN" | "OWNER";

export class NativeFileHostBindingError extends Error {
  readonly code: NativeFileHostBindingErrorCode;
  constructor(code: NativeFileHostBindingErrorCode) {
    super(`Native-file host binding rejected (${code})`);
    this.name = "NativeFileHostBindingError";
    this.code = code;
  }
}

/** The same ledger is passed through other resource participants. */
export interface NativeFileHostBindingBudget {
  work(amount: number): void;
  metadata(value: string): void;
}

export interface NativeFileHostBindingRequest<T extends object = object> {
  readonly type: NativeFileHostBindingType<T>;
  readonly reference: NativeFileHostBindingReference;
}

export interface PreparedNativeFileHostBindings {
  readonly kind: "native-file-host-bindings";
}

export interface NativeFileHostBindingFence {
  readonly kind: "native-file-host-binding-fence";
}

interface TypeState {
  readonly guard: (value: unknown, identity: object) => boolean;
}
interface Entry {
  readonly type: object;
  readonly value: object;
  readonly identity: object;
  readonly reference: NativeFileHostBindingReference;
}
interface OwnerState {
  revision: number;
  readonly entries: Map<string, Entry>;
  reverse: WeakMap<object, Map<object, Set<string>>>;
}
interface FenceState {
  readonly owner: object;
  readonly registry: OwnerState | undefined;
  readonly revision: number | undefined;
}
interface Plan extends FenceState {
  readonly entries: ReadonlyMap<string, Entry>;
}

const MAX_ENTRIES = 65_536;
const MAX_REQUESTS = 4096;
const MAX_SYMBOL_UNITS = 1024;
const types = new WeakMap<object, TypeState>();
const typeNames = new Set<string>();
const owners = new WeakMap<object, OwnerState>();
const fences = new WeakMap<NativeFileHostBindingFence, FenceState>();
const plans = new WeakMap<PreparedNativeFileHostBindings, Plan>();

function fail(code: NativeFileHostBindingErrorCode): never {
  throw new NativeFileHostBindingError(code);
}
function object(value: unknown): value is object {
  return value !== null && (typeof value === "object" || typeof value === "function");
}
function validSymbol(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_SYMBOL_UNITS || !value.trim() || value.includes("\0")) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
function typeState<T extends object>(type: NativeFileHostBindingType<T>): TypeState {
  if (!object(type)) fail("TYPE");
  const state = types.get(type);
  if (!state) fail("TYPE");
  return state;
}
function key(kind: string, version: number, symbol: string): string {
  return `${kind}\0${version}\0${symbol}`;
}
function nextRevision(state: OwnerState): number {
  if (state.revision >= Number.MAX_SAFE_INTEGER) fail("LIMIT");
  return state.revision + 1;
}
function unchanged(state: FenceState): boolean {
  return owners.get(state.owner) === state.registry && state.registry?.revision === state.revision;
}

/** Trusted SDK/host code defines a type once; file metadata never defines types. */
export function defineNativeFileHostBindingType<T extends object>(
  kind: string,
  version: number,
  guard: (value: unknown, identity: object) => value is T,
): NativeFileHostBindingType<T> {
  if (typeof kind !== "string" || !/^[a-z][a-z0-9._:-]{0,95}$/.test(kind)
    || !Number.isInteger(version) || version < 1 || version > 0xffff_ffff || typeof guard !== "function") fail("TYPE");
  const name = `${kind}\0${version}`;
  if (typeNames.has(name)) fail("DUPLICATE");
  const token = Object.freeze({ kind, version });
  types.set(token, { guard });
  typeNames.add(name);
  return token;
}

/** Registration is explicit host work and can call the trusted type guard.
 * A duplicate registration never overwrites a prior live capability. */
export function registerNativeFileHostBinding<T extends object>(
  owner: object,
  type: NativeFileHostBindingType<T>,
  symbol: string,
  value: T,
  identity: object = value,
): void {
  const schema = typeState(type);
  if (!object(owner)) fail("OWNER");
  if (!validSymbol(symbol)) fail("REFERENCE");
  const previous = owners.get(owner), bindingKey = key(type.kind, type.version, symbol);
  if (previous?.entries.has(bindingKey)) fail("DUPLICATE");
  if (previous && previous.entries.size >= MAX_ENTRIES) fail("LIMIT");
  const revision = previous?.revision, next = previous ? nextRevision(previous) : 1;
  if (!object(value) || !object(identity) || !schema.guard(value, identity)) fail("VALUE");
  // A trusted guard may reenter host registration. It cannot silently replace
  // the registry that this outer operation had inspected.
  if (owners.get(owner) !== previous || previous?.revision !== revision) fail("STALE");
  const state = previous ?? { revision: 0, entries: new Map<string, Entry>(), reverse: new WeakMap<object, Map<object, Set<string>>>() };
  const reference = Object.freeze({ kind: type.kind, version: type.version, symbol });
  state.entries.set(bindingKey, { type, value, identity, reference });
  let byType = state.reverse.get(identity);
  if (!byType) { byType = new Map(); state.reverse.set(identity, byType); }
  let symbols = byType.get(type);
  if (!symbols) { symbols = new Set(); byType.set(type, symbols); }
  symbols.add(symbol);
  state.revision = next;
  owners.set(owner, state);
}

export function unregisterNativeFileHostBinding<T extends object>(
  owner: object, type: NativeFileHostBindingType<T>, symbol: string,
): boolean {
  typeState(type);
  if (!validSymbol(symbol)) fail("REFERENCE");
  const state = owners.get(owner), bindingKey = key(type.kind, type.version, symbol);
  const entry = state?.entries.get(bindingKey);
  if (!state || !entry) return false;
  const revision = nextRevision(state);
  state.entries.delete(bindingKey);
  const byType = state.reverse.get(entry.identity), symbols = byType?.get(type);
  symbols?.delete(symbol);
  if (symbols?.size === 0) byType?.delete(type);
  state.revision = revision;
  return true;
}

/** The host owns these capabilities; forgetting a registry never disposes them. */
export function forgetNativeFileHostBindings(owner: object): void {
  const state = owners.get(owner);
  if (!state) return;
  const revision = nextRevision(state);
  state.entries.clear();
  state.reverse = new WeakMap();
  state.revision = revision;
  // Retain an empty tombstone in this weak owner map. Deleting it would turn an
  // initially absent fence back into the same undefined state after register /
  // forget, hiding the intervening registration from an empty prepared plan.
}

/** Capture only an actual registered identity. Ambiguous aliases require the
 * owner to specify which registered symbol its field uses. No guard runs. */
export function captureNativeFileHostBinding<T extends object>(
  owner: object, type: NativeFileHostBindingType<T>, identity: object, symbol?: string,
): NativeFileHostBindingReference {
  typeState(type);
  if (!object(identity)) fail("VALUE");
  const state = owners.get(owner), symbols = state?.reverse.get(identity)?.get(type);
  if (!symbols || symbols.size === 0) fail("MISSING");
  if (symbol === undefined) {
    if (symbols.size !== 1) fail("AMBIGUOUS");
    symbol = symbols.values().next().value;
  }
  if (symbol === undefined || !symbols.has(symbol)) fail("MISSING");
  const entry = state!.entries.get(key(type.kind, type.version, symbol));
  if (!entry || entry.type !== type || entry.identity !== identity) fail("MISSING");
  return entry.reference;
}

function reference<T extends object>(
  type: NativeFileHostBindingType<T>, input: NativeFileHostBindingReference,
): NativeFileHostBindingReference {
  typeState(type);
  if (!object(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail("REFERENCE");
  // This is the enumerable data projection of already-bounded owned JSON.
  // Inspect at most the three allowed members, without an unbounded ownKeys
  // list. Symbols/nonenumerable extras cannot be supplied by file JSON.
  for (const k in input) if (k !== "kind" && k !== "version" && k !== "symbol") fail("REFERENCE");
  const data: Record<string, unknown> = Object.create(null);
  for (const k of ["kind", "version", "symbol"]) {
    const field = Object.getOwnPropertyDescriptor(input, k);
    if (!field || !("value" in field) || !field.enumerable) fail("REFERENCE");
    data[k] = field.value;
  }
  if (data.kind !== type.kind || data.version !== type.version || !validSymbol(data.symbol)) fail("REFERENCE");
  return Object.freeze({ kind: type.kind, version: type.version, symbol: data.symbol });
}

export function resolveNativeFileHostBinding<T extends object>(
  owner: object, type: NativeFileHostBindingType<T>, input: NativeFileHostBindingReference,
): T {
  const ref = reference(type, input), entry = owners.get(owner)?.entries.get(key(ref.kind, ref.version, ref.symbol));
  if (!entry || entry.type !== type) fail("MISSING");
  // The unforgeable type token matches the token used to validate this exact
  // value at registration. Resolution invokes no caller guard or adapter.
  return entry.value as T;
}

export function captureNativeFileHostBindingFence(owner: object): NativeFileHostBindingFence {
  if (!object(owner)) fail("OWNER");
  const state = owners.get(owner), token = Object.freeze({ kind: "native-file-host-binding-fence" as const });
  fences.set(token, { owner, registry: state, revision: state?.revision });
  return token;
}

export function nativeFileHostBindingFenceUnchanged(owner: object, token: NativeFileHostBindingFence): boolean {
  const state = fences.get(token);
  return state !== undefined && state.owner === owner && unchanged(state);
}

/** Resource owners supply expected trusted types, separately from file data.
 * All references and shared metadata/work quota are checked before lookup;
 * preparation never invokes an adapter or changes the source/target registry. */
export function prepareNativeFileHostBindings(
  owner: object,
  requests: readonly NativeFileHostBindingRequest[],
  budget: NativeFileHostBindingBudget,
): PreparedNativeFileHostBindings {
  if (!Array.isArray(requests) || requests.length > MAX_REQUESTS) fail("LIMIT");
  if (!object(owner)) fail("OWNER");
  const state = owners.get(owner), revision = state?.revision;
  budget.work(1 + requests.length * 4);
  const refs = requests.map(request => {
    const ref = reference(request.type, request.reference);
    budget.metadata(ref.kind); budget.metadata(ref.symbol);
    return { type: request.type, reference: ref };
  });
  const entries = new Map<string, Entry>();
  for (const request of refs) {
    const ref = request.reference, bindingKey = key(ref.kind, ref.version, ref.symbol), entry = state?.entries.get(bindingKey);
    if (!entry || entry.type !== request.type) fail("MISSING");
    entries.set(bindingKey, entry);
  }
  if (owners.get(owner) !== state || state?.revision !== revision) fail("STALE");
  const token = Object.freeze({ kind: "native-file-host-bindings" as const });
  plans.set(token, { owner, registry: state, revision, entries });
  return token;
}

export function resolvePreparedNativeFileHostBinding<T extends object>(
  owner: object, token: PreparedNativeFileHostBindings,
  type: NativeFileHostBindingType<T>, symbol: string,
): T {
  const plan = plans.get(token);
  if (!plan) fail("TOKEN");
  if (plan.owner !== owner) fail("OWNER");
  if (!unchanged(plan)) fail("STALE");
  typeState(type);
  const entry = plan.entries.get(key(type.kind, type.version, symbol));
  if (!entry || entry.type !== type) fail("MISSING");
  // As in direct resolution, this is the exact value admitted for this token.
  return entry.value as T;
}

/** Final registry fence only, not Engine/resource publication. Single use. */
export function consumePreparedNativeFileHostBindings(owner: object, token: PreparedNativeFileHostBindings): void {
  const plan = plans.get(token);
  if (!plan) fail("TOKEN");
  if (plan.owner !== owner) fail("OWNER");
  if (!unchanged(plan)) fail("STALE");
  plans.delete(token);
}

/** Idempotent discard releases references without disposing host-owned values. */
export function discardPreparedNativeFileHostBindings(owner: object, token: PreparedNativeFileHostBindings): void {
  const plan = plans.get(token);
  if (plan && plan.owner !== owner) fail("OWNER");
  plans.delete(token);
}
