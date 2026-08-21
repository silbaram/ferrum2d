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

  const store = new DefaultDataSceneVariableStore(adapter, declarations, path, runtimeIds);
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

  constructor(
    adapter: DataSceneVariableRuntimeEngineAdapter,
    declarations: readonly ResolvedDataSceneVariableDeclaration[],
    path: string,
    ids: Readonly<Record<string, number>>,
  ) {
    this.adapter = adapter;
    this.path = path;
    this.reapply(declarations, path, ids);
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
