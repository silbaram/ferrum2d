import {nativeFileEngineOwner} from "./nativeFileEngineOwner.js";
import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import type { FerrumEngine } from "./engineTypes.js";

export const DATA_SCENE_VARIABLES_SNAPSHOT_KEY = "ferrum2d.variables" as const;
export const DATA_SCENE_RUNTIME_MAX_VARIABLES = 64 as const;

export type DataSceneVariableScope = "global" | "scene";
export type DataSceneVariableType = "integer" | "real" | "bool";
export type DataSceneVariableValue = number | boolean;
export type DataSceneVariableValues = Readonly<Record<string, DataSceneVariableValue>>;

interface DataSceneVariableDeclarationBaseSpec {
  name: string;
  scope: DataSceneVariableScope;
}

export type DataSceneVariableDeclarationSpec =
  | (DataSceneVariableDeclarationBaseSpec & { type: "integer"; default: number })
  | (DataSceneVariableDeclarationBaseSpec & { type: "real"; default: number })
  | (DataSceneVariableDeclarationBaseSpec & { type: "bool"; default: boolean });

export type ResolvedDataSceneVariableDeclaration = Readonly<DataSceneVariableDeclarationSpec>;

export interface ResolveDataSceneVariableDeclarationsOptions {
  path?: string;
}

export interface DataSceneVariableStore {
  declarations(): readonly ResolvedDataSceneVariableDeclaration[];
  has(name: string): boolean;
  get(name: string): DataSceneVariableValue;
  set(name: string, value: DataSceneVariableValue): void;
  values(scope: DataSceneVariableScope): DataSceneVariableValues;
  restore(scope: DataSceneVariableScope, values: DataSceneVariableValues): void;
}

interface MutableDataSceneVariableStore extends DataSceneVariableStore {
  reapply(
    declarations: readonly ResolvedDataSceneVariableDeclaration[],
    path: string,
    ids: Readonly<Record<string, number>>,
  ): void;
  runtimeSnapshot(): DataSceneVariableRuntimeSnapshot;
  bindingsSnapshot(): DataSceneVariableBindingsSnapshot;
  restoreRuntimeSnapshot(snapshot: DataSceneVariableRuntimeSnapshot, path: string): void;
}

interface DataSceneVariableEntry {
  declaration: ResolvedDataSceneVariableDeclaration;
  slot: number;
}

export interface DataSceneVariableRuntimeSnapshot {
  readonly path: string;
  readonly entries: readonly {
    readonly declaration: ResolvedDataSceneVariableDeclaration;
    readonly slot: number;
    readonly value: DataSceneVariableValue;
  }[];
}

/** @internal File metadata only. Native values belong to the separate Engine payload. */
export interface DataSceneVariableBindingsSnapshot {
  readonly path: string;
  readonly entries: readonly {
    readonly declaration: ResolvedDataSceneVariableDeclaration;
    readonly slot: number;
  }[];
}
/** @internal Supplied by the already-admitted candidate native variable layout. */
export interface NativeDataSceneVariableLayoutEntry {
  readonly slot: number;
  readonly type: DataSceneVariableType;
  readonly scope: DataSceneVariableScope;
  readonly default: DataSceneVariableValue;
}
/** @internal Opaque, target-bound metadata prepared after DTO/layout validation. */
export interface PreparedDataSceneVariableBindings {
  readonly kind: "data-scene-variable-bindings";
}

const DATA_SCENE_VARIABLE_STORE = Symbol("ferrum2d.dataSceneVariableStore");
const DATA_SCENE_VARIABLE_RUNTIME_ENGINE_ADAPTER = Symbol("ferrum2d.dataSceneVariableRuntimeEngineAdapter");

interface DataSceneVariableEngine {
  [DATA_SCENE_VARIABLE_STORE]?: MutableDataSceneVariableStore;
  [DATA_SCENE_VARIABLE_RUNTIME_ENGINE_ADAPTER]?: DataSceneVariableRuntimeEngineAdapter;
}

export interface DataSceneVariableRuntimeEngineAdapter {
  clear(): void;
  configure(
    slot: number,
    type: DataSceneVariableType,
    scope: DataSceneVariableScope,
    defaultValue: DataSceneVariableValue,
    value: DataSceneVariableValue,
  ): boolean;
  get(slot: number): number;
  set(slot: number, value: DataSceneVariableValue): boolean;
}

export function resolveDataSceneVariableDeclarations(
  input: unknown,
  options: ResolveDataSceneVariableDeclarationsOptions = {},
): readonly ResolvedDataSceneVariableDeclaration[] {
  const path = options.path ?? "sceneAuthoring.variables";
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an array");
  }

  const seen = new Map<string, number>();
  const declarations = input.map((entry, index) => {
    const entryPath = `${path}.${index}`;
    if (!isRecord(entry)) {
      throw gameplayAuthoringDiagnosticError(entryPath, "must be an object");
    }
    const name = variableName(entry.name, `${entryPath}.name`);
    const firstIndex = seen.get(name);
    if (firstIndex !== undefined) {
      throw gameplayAuthoringDiagnosticError(
        `${entryPath}.name`,
        `duplicates variable '${name}' declared at ${path}.${firstIndex}.name`,
      );
    }
    seen.set(name, index);

    const scope = variableScope(entry.scope, `${entryPath}.scope`);
    const type = variableType(entry.type, `${entryPath}.type`);
    return resolvedVariableDeclaration(name, scope, type, entry.default, `${entryPath}.default`);
  });
  if (declarations.length > DATA_SCENE_RUNTIME_MAX_VARIABLES) {
    throw gameplayAuthoringDiagnosticError(
      path,
      `must declare at most ${DATA_SCENE_RUNTIME_MAX_VARIABLES} variables`,
    );
  }
  return declarations;
}

export function compileDataSceneVariableRuntimeIds(
  declarations: readonly ResolvedDataSceneVariableDeclaration[],
  ids?: Readonly<Record<string, number>>,
  path = "sceneAuthoring.ids.variables",
): Readonly<Record<string, number>> {
  if (declarations.length > DATA_SCENE_RUNTIME_MAX_VARIABLES) {
    throw gameplayAuthoringDiagnosticError(
      path,
      `must declare at most ${DATA_SCENE_RUNTIME_MAX_VARIABLES} variables`,
    );
  }
  const declarationNames = new Set(declarations.map((declaration) => declaration.name));
  if (ids === undefined) {
    return Object.freeze(Object.fromEntries(
      declarations.map((declaration, index) => [declaration.name, index + 1]),
    ));
  }
  const resultEntries: [string, number][] = [];
  const assignedNames = new Set<string>();
  const usedSlots = new Map<number, string>();
  for (const [name, rawSlot] of Object.entries(ids)) {
    if (!declarationNames.has(name)) {
      throw gameplayAuthoringDiagnosticError(`${path}.${name}`, `references undeclared variable '${name}'`);
    }
    const slot = variableRuntimeSlot(rawSlot, `${path}.${name}`);
    const previous = usedSlots.get(slot);
    if (previous !== undefined) {
      throw gameplayAuthoringDiagnosticError(
        `${path}.${name}`,
        `duplicates variable slot ${slot} already assigned to '${previous}'`,
      );
    }
    usedSlots.set(slot, name);
    assignedNames.add(name);
    resultEntries.push([name, slot]);
  }
  for (const declaration of declarations) {
    if (!assignedNames.has(declaration.name)) {
      throw gameplayAuthoringDiagnosticError(
        `${path}.${declaration.name}`,
        `must assign a runtime slot for declared variable '${declaration.name}'`,
      );
    }
  }
  return Object.freeze(Object.fromEntries(resultEntries));
}

export function attachDataSceneVariableRuntimeEngineAdapter(
  engine: FerrumEngine,
  adapter: DataSceneVariableRuntimeEngineAdapter,
): FerrumEngine {
  Object.defineProperty(engine, DATA_SCENE_VARIABLE_RUNTIME_ENGINE_ADAPTER, {
    configurable: false,
    enumerable: false,
    value: adapter,
  });
  return engine;
}

interface PreparedVariableBindingsEntry {
  target: DataSceneVariableEngine;
  adapter: DataSceneVariableRuntimeEngineAdapter;
  previous: MutableDataSceneVariableStore | undefined;
  declarations: readonly ResolvedDataSceneVariableDeclaration[] | undefined;
  store: MutableDataSceneVariableStore | undefined;
}

const preparedVariableBindings = new WeakMap<PreparedDataSceneVariableBindings, PreparedVariableBindingsEntry>();

/** @internal Captures names/slots without reading or re-entering native values. */
export function captureDataSceneVariableBindings(
  engine: FerrumEngine,
): DataSceneVariableBindingsSnapshot | undefined {
  return (engine as DataSceneVariableEngine)[DATA_SCENE_VARIABLE_STORE]?.bindingsSnapshot();
}

/** @internal Validates detached metadata against a candidate layout; never calls native methods. */
export function prepareDataSceneVariableBindings(
  engine: FerrumEngine,
  snapshot: unknown,
  nativeLayout: unknown,
  path = "nativeFile.variables",
): PreparedDataSceneVariableBindings {
  const target = engine as DataSceneVariableEngine;
  const adapter = target[DATA_SCENE_VARIABLE_RUNTIME_ENGINE_ADAPTER];
  if (!adapter) {
    throw gameplayAuthoringDiagnosticError(`${path}.engine`, "requires a native variable adapter");
  }
  const descriptor = Object.getOwnPropertyDescriptor(target, DATA_SCENE_VARIABLE_STORE);
  if (descriptor && (!("value" in descriptor) || !descriptor.configurable)) {
    throw gameplayAuthoringDiagnosticError(`${path}.engine`, "variable metadata cannot be replaced");
  }
  if (!descriptor && !Object.isExtensible(target)) {
    throw gameplayAuthoringDiagnosticError(`${path}.engine`, "variable metadata cannot be attached");
  }
  const previous = descriptor?.value as MutableDataSceneVariableStore | undefined;
  if (previous !== undefined && !(previous instanceof DefaultDataSceneVariableStore)) {
    throw gameplayAuthoringDiagnosticError(`${path}.engine`, "requires canonical variable metadata");
  }
  const metadata=normalizeFileVariableBindings(snapshot,nativeLayout,path);
  const store=metadata===undefined?undefined:DefaultDataSceneVariableStore.metadataOnly(adapter,metadata);
  const prepared: PreparedDataSceneVariableBindings = Object.freeze({ kind: "data-scene-variable-bindings" });
  preparedVariableBindings.set(prepared, {
    target, adapter, previous, declarations: previous?.declarations(), store,
  });
  return prepared;
}

/** @internal One-use metadata publication. It never clears/configures/writes native slots. */
export function attachPreparedDataSceneVariableBindings(
  engine: FerrumEngine,
  prepared: PreparedDataSceneVariableBindings,
): DataSceneVariableStore | undefined {
  const target = engine as DataSceneVariableEngine;
  const entry = preparedVariableBindings.get(prepared);
  const descriptor = Object.getOwnPropertyDescriptor(target, DATA_SCENE_VARIABLE_STORE);
  if (
    !entry || entry.target !== target || target[DATA_SCENE_VARIABLE_RUNTIME_ENGINE_ADAPTER] !== entry.adapter
    || (descriptor !== undefined && (!("value" in descriptor) || !descriptor.configurable))
    || (!descriptor && !Object.isExtensible(target)) || descriptor?.value !== entry.previous
    || entry.previous?.declarations() !== entry.declarations
  ) {
    throw gameplayAuthoringDiagnosticError(
      "nativeFile.variables", "prepared variable metadata is foreign, stale, or already attached",
    );
  }
  if (entry.store === undefined) {
    if (descriptor) delete target[DATA_SCENE_VARIABLE_STORE];
  } else {
    Object.defineProperty(target, DATA_SCENE_VARIABLE_STORE, {
      configurable: true, enumerable: false, value: entry.store,
    });
  }
  preparedVariableBindings.delete(prepared);
  return entry.store;
}

function normalizeFileVariableBindings(snapshot:unknown,nativeLayout:unknown,path:string):DataSceneVariableBindingsSnapshot|undefined {
  const nativeEntries = bindingArray(nativeLayout, `${path}.nativeLayout`);
  const layout = new Map<number, NativeDataSceneVariableLayoutEntry>();
  nativeEntries.forEach((input, index) => {
    const at = `${path}.nativeLayout.${index}`;
    const entry = bindingRecord(input, ["slot", "type", "scope", "default"], at);
    const slot = variableRuntimeSlot(entry.slot, `${at}.slot`);
    const type = variableType(entry.type, `${at}.type`);
    const scope = variableScope(entry.scope, `${at}.scope`);
    const value = variableValue(entry.default, type, `${at}.default`);
    if (layout.has(slot)) {
      throw gameplayAuthoringDiagnosticError(`${at}.slot`, "duplicates native variable slot");
    }
    layout.set(slot, { slot, type, scope, default: value });
  });
  let metadata: DataSceneVariableBindingsSnapshot | undefined;
  if (snapshot !== undefined) {
    const input = bindingRecord(snapshot, ["path", "entries"], path);
    if (typeof input.path !== "string") {
      throw gameplayAuthoringDiagnosticError(`${path}.path`, "must be a string");
    }
    const entries = bindingArray(input.entries, `${path}.entries`).map((raw, index) => {
      const at = `${path}.entries.${index}`;
      const entry = bindingRecord(raw, ["declaration", "slot"], at);
      return {
        declaration: bindingRecord(entry.declaration, ["name", "type", "scope", "default"], `${at}.declaration`),
        slot: variableRuntimeSlot(entry.slot, `${at}.slot`),
      };
    });
    const declarations = resolveDataSceneVariableDeclarations(
      entries.map(entry => entry.declaration), { path: `${path}.entries` },
    );
    compileDataSceneVariableRuntimeIds(
      declarations,
      Object.fromEntries(entries.map((entry, index) => [declarations[index].name, entry.slot])),
      `${path}.slots`,
    );
    const normalized = Object.freeze({
      path: input.path,
      entries: Object.freeze(entries.map((entry, index) => {
        const declaration = declarations[index];
        const native = layout.get(entry.slot);
        if (
          !native || native.type !== declaration.type || native.scope !== declaration.scope
          || native.default !== declaration.default
        ) {
          throw gameplayAuthoringDiagnosticError(
            `${path}.entries.${index}`, "does not match the admitted native slot layout",
          );
        }
        return Object.freeze({ declaration, slot: entry.slot });
      })),
    });
    metadata = normalized;
  }
  return metadata;
}

export interface NativeFileVariableAdmissionLimits {
    readonly maxWork: number;
    readonly maxStringCodeUnits: number;
    readonly maxTotalStringCodeUnits: number;
}
const VARIABLE_FILE_LIMITS: NativeFileVariableAdmissionLimits = Object.freeze({ maxWork: 4096, maxStringCodeUnits: 65536, maxTotalStringCodeUnits: 1048576 });
export interface AdmittedNativeFileVariableBindings {
    readonly kind: "admitted-native-file-variable-bindings";
}
const canonicalVariableAdapters = new WeakMap<FerrumEngine, {
    readonly adapter: DataSceneVariableRuntimeEngineAdapter;
    readonly native: object;
}>();
const admittedVariablePlans = new WeakMap<AdmittedNativeFileVariableBindings, {
    readonly owner: object;
    readonly metadata: DataSceneVariableBindingsSnapshot | undefined;
}>();
/** Called once by the actual SDK factory after its canonical adapters/owner exist. */
export function markNativeFileCanonicalVariableAdapter(engine: FerrumEngine): void {
    const owner = nativeFileEngineOwner(engine), adapter = (engine as DataSceneVariableEngine)[DATA_SCENE_VARIABLE_RUNTIME_ENGINE_ADAPTER];
    if (!adapter || canonicalVariableAdapters.has(engine))
        throw gameplayAuthoringDiagnosticError("nativeFile.variables", "canonical variable adapter missing/already marked");
    canonicalVariableAdapters.set(engine, { adapter, native: owner.native });
}
/** No Engine/facade/native method access. owner is the private target native
 * placeholder identity; Root installs the admitted native payload there later. */
export function admitNativeFileVariableBindings(owner: object, snapshot: unknown, nativeLayout: unknown, overrides: Partial<NativeFileVariableAdmissionLimits> = {}): AdmittedNativeFileVariableBindings {
    if (!owner || typeof owner !== "object")
        throw gameplayAuthoringDiagnosticError("nativeFile.variables", "requires target owner identity");
    const limits = { ...VARIABLE_FILE_LIMITS };
    bindingRecordPartialLimits(overrides, limits);
    let work = 0, units = 0;
    const charge = (n: number) => { if (n > limits.maxWork - work)
        throw gameplayAuthoringDiagnosticError("nativeFile.variables", "metadata work limit exceeded"); work += n; };
    const string = (value: unknown) => { if (typeof value !== "string")
        return; charge(1); if (value.length > limits.maxStringCodeUnits || value.length > limits.maxTotalStringCodeUnits - units)
        throw gameplayAuthoringDiagnosticError("nativeFile.variables", "metadata string limit exceeded"); units += value.length; };
    const layout = bindingArray(nativeLayout, "nativeFile.variables.nativeLayout");
    charge(layout.length * 8 + 1);
    if (snapshot !== undefined) {
        const root = bindingRecord(snapshot, ["path", "entries"], "nativeFile.variables");
        string(root.path);
        const entries = bindingArray(root.entries, "nativeFile.variables.entries");
        charge(entries.length * 16 + 1);
        for (const item of entries) {
            const entry = bindingRecord(item, ["declaration", "slot"], "nativeFile.variables.entry"), d = bindingRecord(entry.declaration, ["name", "type", "scope", "default"], "nativeFile.variables.declaration");
            string(d.name);
            string(d.type);
            string(d.scope);
            if (Object.is(d.default, -0))
                throw gameplayAuthoringDiagnosticError("nativeFile.variables", "metadata defaults must use the producer canonical positive zero");
        }
    }
    const metadata = normalizeFileVariableBindings(snapshot, layout, "nativeFile.variables"), token: AdmittedNativeFileVariableBindings = Object.freeze({ kind: "admitted-native-file-variable-bindings" });
    admittedVariablePlans.set(token, { owner, metadata });
    return token;
}
function bindingRecordPartialLimits(input: Partial<NativeFileVariableAdmissionLimits>, result: NativeFileVariableAdmissionLimits): void {
    if (!isRecord(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
        throw gameplayAuthoringDiagnosticError("nativeFile.variables", "invalid limits");
    for (const key of Reflect.ownKeys(input)) {
        const d = Object.getOwnPropertyDescriptor(input, key);
        if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(result, key) || !d || !("value" in d) || !Number.isSafeInteger(d.value) || d.value < 0 || d.value > result[key as keyof NativeFileVariableAdmissionLimits])
            throw gameplayAuthoringDiagnosticError("nativeFile.variables", "invalid limits");
        Object.defineProperty(result, key, { value: d.value, enumerable: true, configurable: true, writable: true });
    }
}
/** After A.install and actual detached facade construction only. One-use,
 * actual canonical target binding; no slot reads/configures/clears/writes. */
export function attachAdmittedNativeFileVariableBindings(owner: object, engine: FerrumEngine, token: AdmittedNativeFileVariableBindings): DataSceneVariableStore | undefined {
    const plan = admittedVariablePlans.get(token);
    if (!plan || plan.owner !== owner)
        throw gameplayAuthoringDiagnosticError("nativeFile.variables", "foreign or consumed admission");
    admittedVariablePlans.delete(token);
    const actual = nativeFileEngineOwner(engine), target = engine as DataSceneVariableEngine, canonical = canonicalVariableAdapters.get(engine), adapter = target[DATA_SCENE_VARIABLE_RUNTIME_ENGINE_ADAPTER];
    if (actual.native !== owner || canonical?.native !== owner || canonical?.adapter !== adapter || !adapter)
        throw gameplayAuthoringDiagnosticError("nativeFile.variables", "canonical actual target identity mismatch");
    if (Object.getOwnPropertyDescriptor(target, DATA_SCENE_VARIABLE_STORE) !== undefined || !Object.isExtensible(target))
        throw gameplayAuthoringDiagnosticError("nativeFile.variables", "requires unpublished metadata-empty target");
    if (plan.metadata === undefined)
        return undefined;
    const store = DefaultDataSceneVariableStore.metadataOnly(adapter, plan.metadata);
    Object.defineProperty(target, DATA_SCENE_VARIABLE_STORE, { configurable: true, enumerable: false, value: store });
    return store;
}

function bindingRecord(input: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!isRecord(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw gameplayAuthoringDiagnosticError(path, "must be a plain data object");
  }
  const fields = Object.getOwnPropertyDescriptors(input);
  if (
    Reflect.ownKeys(fields).length !== keys.length
    || keys.some(key => !Object.prototype.hasOwnProperty.call(fields, key))
    || Reflect.ownKeys(fields).some(key =>
      typeof key !== "string" || !keys.includes(key) || !("value" in fields[key]),
    )
  ) {
    throw gameplayAuthoringDiagnosticError(path, "must contain exactly the expected data properties");
  }
  return Object.fromEntries(keys.map(key => [key, fields[key].value]));
}

function bindingArray(input: unknown, path: string): unknown[] {
  if (!Array.isArray(input) || input.length > DATA_SCENE_RUNTIME_MAX_VARIABLES) {
    throw gameplayAuthoringDiagnosticError(path, "requires an array of at most 64 entries");
  }
  const entries: unknown[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const entry = Object.getOwnPropertyDescriptor(input, String(index));
    if (!entry || !("value" in entry)) {
      throw gameplayAuthoringDiagnosticError(`${path}.${index}`, "must be an own data entry");
    }
    entries.push(entry.value);
  }
  return entries;
}

export function preflightDataSceneVariableRuntime(
  engine: FerrumEngine,
  declarations: readonly ResolvedDataSceneVariableDeclaration[],
  path = "dataScene.variables",
): void {
  if (
    declarations.length > 0
    && (engine as DataSceneVariableEngine)[DATA_SCENE_VARIABLE_RUNTIME_ENGINE_ADAPTER] === undefined
  ) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.engine`,
      "must be a FerrumEngine created by createEngine() from @ferrum2d/ferrum-web",
    );
  }
}

export function captureDataSceneVariableRuntimeSnapshot(
  engine: FerrumEngine,
): DataSceneVariableRuntimeSnapshot | undefined {
  return (engine as DataSceneVariableEngine)[DATA_SCENE_VARIABLE_STORE]?.runtimeSnapshot();
}

export function restoreDataSceneVariableRuntimeSnapshot(
  engine: FerrumEngine,
  snapshot: DataSceneVariableRuntimeSnapshot | undefined,
  path = "dataScene.variables",
): void {
  const target = engine as DataSceneVariableEngine;
  const adapter = target[DATA_SCENE_VARIABLE_RUNTIME_ENGINE_ADAPTER];
  if (snapshot === undefined) {
    adapter?.clear();
    delete target[DATA_SCENE_VARIABLE_STORE];
    return;
  }
  if (adapter === undefined || target[DATA_SCENE_VARIABLE_STORE] === undefined) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.engine`,
      "cannot restore the previous Rust variable store",
    );
  }
  target[DATA_SCENE_VARIABLE_STORE].restoreRuntimeSnapshot(snapshot, path);
}

export function synchronizeDataSceneVariableStore(
  engine: FerrumEngine,
  declarations: readonly ResolvedDataSceneVariableDeclaration[],
  path = "dataScene.variables",
  ids?: Readonly<Record<string, number>>,
): DataSceneVariableStore {
  preflightDataSceneVariableRuntime(engine, declarations, path);
  const target = engine as DataSceneVariableEngine;
  const adapter = target[DATA_SCENE_VARIABLE_RUNTIME_ENGINE_ADAPTER];
  if (adapter === undefined) {
    if (declarations.length === 0) {
      return emptyDataSceneVariableStore(path);
    }
    throw gameplayAuthoringDiagnosticError(
      `${path}.engine`,
      "must be a FerrumEngine created by createEngine() from @ferrum2d/ferrum-web",
    );
  }
  const runtimeIds = compileDataSceneVariableRuntimeIds(declarations, ids, `${path}.ids`);
  const existing = target[DATA_SCENE_VARIABLE_STORE];
  if (existing !== undefined) {
    existing.reapply(declarations, path, runtimeIds);
    return existing;
  }

  const store = DefaultDataSceneVariableStore.configured(adapter, declarations, path, runtimeIds);
  Object.defineProperty(target, DATA_SCENE_VARIABLE_STORE, {
    configurable: true,
    enumerable: false,
    value: store,
  });
  return store;
}

function emptyDataSceneVariableStore(path: string): DataSceneVariableStore {
  return {
    declarations: () => [],
    has: () => false,
    get: (name) => {
      throw gameplayAuthoringDiagnosticError(`${path}.${name}`, `references undeclared variable '${name}'`);
    },
    set: (name) => {
      throw gameplayAuthoringDiagnosticError(`${path}.${name}`, `references undeclared variable '${name}'`);
    },
    values: (scope) => {
      variableScope(scope, `${path}.scope`);
      return {};
    },
    restore: (scope, values) => {
      resolvedDataSceneVariableValues([], scope, values, `${path}.${scope}`);
    },
  };
}

export function dataSceneVariableStoreForEngine(
  engine: FerrumEngine,
): DataSceneVariableStore | undefined {
  return (engine as DataSceneVariableEngine)[DATA_SCENE_VARIABLE_STORE];
}

export function validateDataSceneVariableValues(
  declarations: readonly ResolvedDataSceneVariableDeclaration[],
  scope: DataSceneVariableScope,
  values: DataSceneVariableValues,
  path: string,
): void {
  resolvedDataSceneVariableValues(declarations, scope, values, path);
}

class DefaultDataSceneVariableStore implements MutableDataSceneVariableStore {
  private resolvedDeclarations: readonly ResolvedDataSceneVariableDeclaration[] = [];
  private entries = new Map<string, DataSceneVariableEntry>();
  private path: string;
  private readonly adapter: DataSceneVariableRuntimeEngineAdapter;

  private constructor(adapter: DataSceneVariableRuntimeEngineAdapter, path: string) {
    this.adapter = adapter;
    this.path = path;
  }

  static configured(
    adapter: DataSceneVariableRuntimeEngineAdapter,
    declarations: readonly ResolvedDataSceneVariableDeclaration[],
    path: string,
    ids: Readonly<Record<string, number>>,
  ): DefaultDataSceneVariableStore {
    const store = new DefaultDataSceneVariableStore(adapter, path);
    store.reapply(declarations, path, ids);
    return store;
  }

  static metadataOnly(
    adapter: DataSceneVariableRuntimeEngineAdapter,
    snapshot: DataSceneVariableBindingsSnapshot,
  ): DefaultDataSceneVariableStore {
    const store = new DefaultDataSceneVariableStore(adapter, snapshot.path);
    store.resolvedDeclarations = Object.freeze(snapshot.entries.map(entry => entry.declaration));
    store.entries = new Map(snapshot.entries.map(entry => [entry.declaration.name, entry]));
    return store;
  }

  bindingsSnapshot(): DataSceneVariableBindingsSnapshot {
    return Object.freeze({
      path: this.path,
      entries: Object.freeze(this.resolvedDeclarations.map(declaration => {
        const entry = this.requireEntry(declaration.name);
        return Object.freeze({ slot: entry.slot, declaration: Object.freeze({ ...declaration }) });
      })),
    });
  }

  declarations(): readonly ResolvedDataSceneVariableDeclaration[] {
    return this.resolvedDeclarations;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  get(name: string): DataSceneVariableValue {
    const entry = this.requireEntry(name);
    return runtimeVariableValue(
      this.adapter.get(entry.slot),
      entry.declaration.type,
      `${this.path}.${name}`,
    );
  }

  set(name: string, value: DataSceneVariableValue): void {
    const entry = this.requireEntry(name);
    const resolved = variableValue(value, entry.declaration.type, `${this.path}.${name}`);
    if (!this.adapter.set(entry.slot, resolved)) {
      throw gameplayAuthoringDiagnosticError(`${this.path}.${name}`, "failed to update Rust variable slot");
    }
  }

  values(scope: DataSceneVariableScope): DataSceneVariableValues {
    variableScope(scope, `${this.path}.scope`);
    return Object.fromEntries(
      this.resolvedDeclarations
        .filter((declaration) => declaration.scope === scope)
        .map((declaration) => [declaration.name, this.get(declaration.name)]),
    );
  }

  restore(scope: DataSceneVariableScope, values: DataSceneVariableValues): void {
    variableScope(scope, `${this.path}.scope`);
    const restored = resolvedDataSceneVariableValues(
      this.resolvedDeclarations,
      scope,
      values,
      `${this.path}.${scope}`,
    );

    for (const [name, value] of restored) {
      this.set(name, value);
    }
  }

  runtimeSnapshot(): DataSceneVariableRuntimeSnapshot {
    return {
      path: this.path,
      entries: Object.freeze(this.resolvedDeclarations.map((declaration) => {
        const entry = this.entries.get(declaration.name);
        if (entry === undefined) {
          throw gameplayAuthoringDiagnosticError(
            `${this.path}.${declaration.name}`,
            "is missing its Rust variable slot",
          );
        }
        return Object.freeze({
          declaration,
          slot: entry.slot,
          value: this.get(declaration.name),
        });
      })),
    };
  }

  restoreRuntimeSnapshot(snapshot: DataSceneVariableRuntimeSnapshot, path: string): void {
    const next = new Map<string, DataSceneVariableEntry>();
    this.adapter.clear();
    for (const entry of snapshot.entries) {
      if (!this.adapter.configure(
        entry.slot,
        entry.declaration.type,
        entry.declaration.scope,
        entry.declaration.default,
        entry.value,
      )) {
        throw gameplayAuthoringDiagnosticError(
          `${path}.${entry.declaration.name}`,
          `failed to restore Rust variable slot ${entry.slot}`,
        );
      }
      next.set(entry.declaration.name, {
        declaration: entry.declaration,
        slot: entry.slot,
      });
    }
    this.path = snapshot.path;
    this.resolvedDeclarations = Object.freeze(
      snapshot.entries.map((entry) => entry.declaration),
    );
    this.entries = next;
  }

  reapply(
    declarations: readonly ResolvedDataSceneVariableDeclaration[],
    path: string,
    ids: Readonly<Record<string, number>>,
  ): void {
    const previous = this.entries;
    const preservedGlobals = new Map<string, DataSceneVariableValue>();
    for (const declaration of declarations) {
      const previousEntry = previous.get(declaration.name);
      if (
        declaration.scope === "global"
        && previousEntry?.declaration.scope === "global"
        && previousEntry.declaration.type === declaration.type
      ) {
        preservedGlobals.set(
          declaration.name,
          runtimeVariableValue(
            this.adapter.get(previousEntry.slot),
            declaration.type,
            `${path}.${declaration.name}`,
          ),
        );
      }
    }
    const next = new Map<string, DataSceneVariableEntry>();
    this.adapter.clear();
    for (const declaration of declarations) {
      const slot = variableRuntimeSlot(ids[declaration.name], `${path}.ids.${declaration.name}`);
      const value = preservedGlobals.get(declaration.name) ?? declaration.default;
      if (!this.adapter.configure(slot, declaration.type, declaration.scope, declaration.default, value)) {
        throw gameplayAuthoringDiagnosticError(
          `${path}.${declaration.name}`,
          `failed to configure Rust variable slot ${slot}`,
        );
      }
      next.set(declaration.name, { declaration, slot });
    }
    this.path = path;
    this.resolvedDeclarations = Object.freeze([...declarations]);
    this.entries = next;
  }

  private requireEntry(name: string): DataSceneVariableEntry {
    const entry = this.entries.get(name);
    if (entry === undefined) {
      throw gameplayAuthoringDiagnosticError(
        `${this.path}.${name}`,
        `references undeclared variable '${name}'`,
      );
    }
    return entry;
  }
}

function runtimeVariableValue(
  value: number,
  type: DataSceneVariableType,
  path: string,
): DataSceneVariableValue {
  if (!Number.isFinite(value)) {
    throw gameplayAuthoringDiagnosticError(path, "references an unconfigured Rust variable slot");
  }
  if (type === "bool") {
    if (value !== 0 && value !== 1) {
      throw gameplayAuthoringDiagnosticError(path, "contains an invalid Rust bool variable value");
    }
    return value === 1;
  }
  return variableValue(value, type, path);
}

function resolvedDataSceneVariableValues(
  declarations: readonly ResolvedDataSceneVariableDeclaration[],
  scope: DataSceneVariableScope,
  values: DataSceneVariableValues,
  path: string,
): ReadonlyMap<string, DataSceneVariableValue> {
  variableScope(scope, `${path}.scope`);
  if (!isRecord(values)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  }

  const scopedDeclarations = declarations.filter((declaration) => declaration.scope === scope);
  const declarationsByName = new Map(
    scopedDeclarations.map((declaration) => [declaration.name, declaration]),
  );
  for (const name of Object.keys(values)) {
    if (declarationsByName.get(name) === undefined) {
      throw gameplayAuthoringDiagnosticError(
        `${path}.${name}`,
        `references undeclared ${scope} variable '${name}'`,
      );
    }
  }

  const resolved = new Map<string, DataSceneVariableValue>();
  for (const declaration of scopedDeclarations) {
    if (!Object.prototype.hasOwnProperty.call(values, declaration.name)) {
      throw gameplayAuthoringDiagnosticError(
        `${path}.${declaration.name}`,
        `must provide declared ${scope} variable '${declaration.name}'`,
      );
    }
    resolved.set(
      declaration.name,
      variableValue(
        values[declaration.name],
        declaration.type,
        `${path}.${declaration.name}`,
      ),
    );
  }
  return resolved;
}

function variableName(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-empty string without surrounding whitespace");
  }
  return value;
}

function variableScope(value: unknown, path: string): DataSceneVariableScope {
  if (value !== "global" && value !== "scene") {
    throw gameplayAuthoringDiagnosticError(path, "must be 'global' or 'scene'");
  }
  return value;
}

function variableType(value: unknown, path: string): DataSceneVariableType {
  if (value !== "integer" && value !== "real" && value !== "bool") {
    throw gameplayAuthoringDiagnosticError(path, "must be 'integer', 'real', or 'bool'");
  }
  return value;
}

function resolvedVariableDeclaration(
  name: string,
  scope: DataSceneVariableScope,
  type: DataSceneVariableType,
  defaultInput: unknown,
  path: string,
): ResolvedDataSceneVariableDeclaration {
  const defaultValue = variableValue(defaultInput, type, path);
  if (type === "bool") {
    if (typeof defaultValue !== "boolean") {
      throw gameplayAuthoringDiagnosticError(path, "must be a boolean");
    }
    return Object.freeze({ name, scope, type, default: defaultValue });
  }
  if (typeof defaultValue !== "number") {
    throw gameplayAuthoringDiagnosticError(path, "must be a finite number");
  }
  if (type === "integer") {
    return Object.freeze({ name, scope, type, default: defaultValue });
  }
  return Object.freeze({ name, scope, type, default: defaultValue });
}

function variableValue(
  value: unknown,
  type: DataSceneVariableType,
  path: string,
): DataSceneVariableValue {
  if (type === "bool") {
    if (typeof value !== "boolean") {
      throw gameplayAuthoringDiagnosticError(path, "must be a boolean");
    }
    return value;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be a finite number");
  }
  if (type === "integer" && !Number.isSafeInteger(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be a safe integer");
  }
  return Object.is(value, -0) ? 0 : value;
}

function variableRuntimeSlot(value: unknown, path: string): number {
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < 1
    || value > DATA_SCENE_RUNTIME_MAX_VARIABLES
  ) {
    throw gameplayAuthoringDiagnosticError(
      path,
      `must be an integer between 1 and ${DATA_SCENE_RUNTIME_MAX_VARIABLES}`,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
