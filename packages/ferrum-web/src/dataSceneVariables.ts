import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import type { FerrumEngine } from "./engineTypes.js";

export const DATA_SCENE_VARIABLES_SNAPSHOT_KEY = "ferrum2d.variables" as const;

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
  ): void;
}

interface DataSceneVariableEntry {
  declaration: ResolvedDataSceneVariableDeclaration;
  value: DataSceneVariableValue;
}

const DATA_SCENE_VARIABLE_STORE = Symbol("ferrum2d.dataSceneVariableStore");

interface DataSceneVariableEngine {
  [DATA_SCENE_VARIABLE_STORE]?: MutableDataSceneVariableStore;
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
  return input.map((entry, index) => {
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
}

export function synchronizeDataSceneVariableStore(
  engine: FerrumEngine,
  declarations: readonly ResolvedDataSceneVariableDeclaration[],
  path = "dataScene.variables",
): DataSceneVariableStore {
  const target = engine as DataSceneVariableEngine;
  const existing = target[DATA_SCENE_VARIABLE_STORE];
  if (existing !== undefined) {
    existing.reapply(declarations, path);
    return existing;
  }

  const store = new DefaultDataSceneVariableStore(declarations, path);
  Object.defineProperty(target, DATA_SCENE_VARIABLE_STORE, {
    configurable: false,
    enumerable: false,
    value: store,
  });
  return store;
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

  constructor(
    declarations: readonly ResolvedDataSceneVariableDeclaration[],
    path: string,
  ) {
    this.path = path;
    this.reapply(declarations, path);
  }

  declarations(): readonly ResolvedDataSceneVariableDeclaration[] {
    return this.resolvedDeclarations;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  get(name: string): DataSceneVariableValue {
    return this.requireEntry(name).value;
  }

  set(name: string, value: DataSceneVariableValue): void {
    const entry = this.requireEntry(name);
    entry.value = variableValue(value, entry.declaration.type, `${this.path}.${name}`);
  }

  values(scope: DataSceneVariableScope): DataSceneVariableValues {
    variableScope(scope, `${this.path}.scope`);
    return Object.fromEntries(
      this.resolvedDeclarations
        .filter((declaration) => declaration.scope === scope)
        .map((declaration) => [declaration.name, this.requireEntry(declaration.name).value]),
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
      this.requireEntry(name).value = value;
    }
  }

  reapply(
    declarations: readonly ResolvedDataSceneVariableDeclaration[],
    path: string,
  ): void {
    const previous = this.entries;
    const next = new Map<string, DataSceneVariableEntry>();
    for (const declaration of declarations) {
      const previousEntry = previous.get(declaration.name);
      const value = declaration.scope === "global"
          && previousEntry?.declaration.scope === "global"
          && previousEntry.declaration.type === declaration.type
        ? previousEntry.value
        : declaration.default;
      next.set(declaration.name, { declaration, value });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
