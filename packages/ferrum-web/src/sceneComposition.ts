import { sceneCompositionDiagnosticError } from "./diagnostics.js";

export type SceneCompositionJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly SceneCompositionJsonValue[]
  | { readonly [key: string]: SceneCompositionJsonValue };

export type SceneCompositionProps = Readonly<Record<string, SceneCompositionJsonValue>>;

export interface SceneCompositionTransformSpec {
  x?: number;
  y?: number;
  rotationRadians?: number;
  scale?: number;
  layer?: number;
}

export interface ResolvedSceneCompositionTransform {
  x: number;
  y: number;
  rotationRadians: number;
  scale: number;
  layer: number;
}

export interface SceneCompositionPrefabSpec {
  props?: SceneCompositionProps;
  variants?: Readonly<Record<string, SceneCompositionPrefabVariantSpec>>;
}

export interface SceneCompositionPrefabVariantSpec {
  extends?: string;
  props?: SceneCompositionProps;
}

export interface SceneCompositionFragmentInstanceSpec extends SceneCompositionTransformSpec {
  id?: string;
  prefab: string;
  variant?: string;
  props?: SceneCompositionProps;
}

export interface SceneCompositionFragmentIncludeSpec extends SceneCompositionTransformSpec {
  fragment: string;
  idPrefix?: string;
  props?: SceneCompositionProps;
}

export interface SceneCompositionFragmentSpec {
  include?: readonly SceneCompositionFragmentIncludeSpec[];
  instances?: readonly SceneCompositionFragmentInstanceSpec[];
}

export interface SceneCompositionSpec {
  initialFragment?: string;
  prefabs: Readonly<Record<string, SceneCompositionPrefabSpec>>;
  fragments?: Readonly<Record<string, SceneCompositionFragmentSpec>>;
}

export interface ResolveSceneCompositionOptions {
  path?: string;
}

export interface InstantiateSceneFragmentOptions extends SceneCompositionTransformSpec {
  fragment?: string;
  idPrefix?: string;
  props?: SceneCompositionProps;
  maxDepth?: number;
  path?: string;
}

export interface ApplySceneCompositionOptions extends InstantiateSceneFragmentOptions {}

export interface ResolvedSceneCompositionPrefabVariant {
  id: string;
  extends?: string;
  props: SceneCompositionProps;
}

export interface ResolvedSceneCompositionPrefab {
  id: string;
  props: SceneCompositionProps;
  variants: Readonly<Record<string, ResolvedSceneCompositionPrefabVariant>>;
}

export interface ResolvedSceneCompositionFragmentInstance extends ResolvedSceneCompositionTransform {
  id?: string;
  prefab: string;
  variant?: string;
  props: SceneCompositionProps;
}

export interface ResolvedSceneCompositionFragmentInclude extends ResolvedSceneCompositionTransform {
  fragment: string;
  idPrefix: string;
  props: SceneCompositionProps;
}

export interface ResolvedSceneCompositionFragment {
  id: string;
  include: readonly ResolvedSceneCompositionFragmentInclude[];
  instances: readonly ResolvedSceneCompositionFragmentInstance[];
}

export interface ResolvedSceneCompositionSpec {
  initialFragment: string;
  prefabs: Readonly<Record<string, ResolvedSceneCompositionPrefab>>;
  fragments: Readonly<Record<string, ResolvedSceneCompositionFragment>>;
}

export interface ResolvedSceneCompositionInstance extends ResolvedSceneCompositionTransform {
  id: string;
  sourceId: string;
  prefab: string;
  variant?: string;
  props: SceneCompositionProps;
}

export interface SceneCompositionTarget {
  spawnSceneInstance(instance: ResolvedSceneCompositionInstance): unknown;
}

export interface SceneCompositionApplyResult {
  fragment: string;
  instances: readonly ResolvedSceneCompositionInstance[];
  spawnResults: readonly unknown[];
}

const DEFAULT_TRANSFORM: ResolvedSceneCompositionTransform = Object.freeze({
  x: 0,
  y: 0,
  rotationRadians: 0,
  scale: 1,
  layer: 0,
});

export function resolveSceneCompositionSpec(
  spec: SceneCompositionSpec,
  options: ResolveSceneCompositionOptions = {},
): ResolvedSceneCompositionSpec {
  const path = options.path ?? "sceneComposition";
  if (!isRecord(spec)) {
    throw sceneCompositionDiagnosticError(path, "must be an object");
  }

  const prefabs = resolvePrefabs(requiredRecord(spec.prefabs, `${path}.prefabs`), `${path}.prefabs`);
  const fragmentSource = spec.fragments ?? { main: {} };
  const fragments = resolveFragments(requiredRecord(fragmentSource, `${path}.fragments`), prefabs, `${path}.fragments`);
  const initialFragment = optionalString(spec.initialFragment, `${path}.initialFragment`, Object.keys(fragments)[0] ?? "main");
  if (fragments[initialFragment] === undefined) {
    throw sceneCompositionDiagnosticError(`${path}.initialFragment`, `references unknown fragment '${initialFragment}'`);
  }
  validateFragmentIncludes(fragments, path);

  return {
    initialFragment,
    prefabs,
    fragments,
  };
}

export function instantiateSceneFragment(
  spec: SceneCompositionSpec | ResolvedSceneCompositionSpec,
  options: InstantiateSceneFragmentOptions = {},
): ResolvedSceneCompositionInstance[] {
  const path = options.path ?? "sceneComposition";
  const composition = isResolvedSceneCompositionSpec(spec)
    ? spec
    : resolveSceneCompositionSpec(spec as SceneCompositionSpec, { path });
  const fragment = options.fragment ?? composition.initialFragment;
  if (composition.fragments[fragment] === undefined) {
    throw sceneCompositionDiagnosticError(`${path}.fragment`, `references unknown fragment '${fragment}'`);
  }
  const maxDepth = positiveInteger(options.maxDepth ?? 16, `${path}.maxDepth`);
  const rootTransform = resolveTransform(options, path);
  const rootProps = propsObject(options.props, `${path}.props`);
  const instances = collectFragmentInstances(composition, fragment, {
    transform: rootTransform,
    props: rootProps,
    idPrefix: optionalString(options.idPrefix, `${path}.idPrefix`, ""),
    maxDepth,
    path,
    stack: [],
  });

  const seen = new Set<string>();
  for (const instance of instances) {
    if (seen.has(instance.id)) {
      throw sceneCompositionDiagnosticError(`${path}.instances.${instance.id}`, "resolved instance id must be unique");
    }
    seen.add(instance.id);
  }
  return instances;
}

export function applySceneCompositionFragment(
  target: SceneCompositionTarget,
  spec: SceneCompositionSpec | ResolvedSceneCompositionSpec,
  options: ApplySceneCompositionOptions = {},
): SceneCompositionApplyResult {
  const path = options.path ?? "sceneComposition";
  if (!isRecord(target) || typeof target.spawnSceneInstance !== "function") {
    throw sceneCompositionDiagnosticError(`${path}.target`, "must expose spawnSceneInstance(instance)");
  }
  const composition = isResolvedSceneCompositionSpec(spec)
    ? spec
    : resolveSceneCompositionSpec(spec as SceneCompositionSpec, { path });
  const fragment = options.fragment ?? composition.initialFragment;
  const instances = instantiateSceneFragment(composition, { ...options, fragment, path });
  return {
    fragment,
    instances,
    spawnResults: instances.map((instance) => target.spawnSceneInstance(instance)),
  };
}

interface CollectFragmentContext {
  transform: ResolvedSceneCompositionTransform;
  props: SceneCompositionProps;
  idPrefix: string;
  maxDepth: number;
  path: string;
  stack: readonly string[];
}

function resolvePrefabs(
  input: Readonly<Record<string, unknown>>,
  path: string,
): Record<string, ResolvedSceneCompositionPrefab> {
  const prefabs: Record<string, ResolvedSceneCompositionPrefab> = {};
  for (const [prefabId, prefabSpec] of Object.entries(input)) {
    const prefabPath = `${path}.${prefabId}`;
    if (!isRecord(prefabSpec)) {
      throw sceneCompositionDiagnosticError(prefabPath, "must be an object");
    }
    const props = propsObject(prefabSpec.props, `${prefabPath}.props`);
    prefabs[prefabId] = {
      id: prefabId,
      props,
      variants: resolvePrefabVariants(prefabId, props, requiredRecord(prefabSpec.variants ?? {}, `${prefabPath}.variants`), prefabPath),
    };
  }
  return prefabs;
}

function resolvePrefabVariants(
  prefabId: string,
  prefabProps: SceneCompositionProps,
  input: Readonly<Record<string, unknown>>,
  prefabPath: string,
): Record<string, ResolvedSceneCompositionPrefabVariant> {
  const rawVariants: Record<string, SceneCompositionPrefabVariantSpec> = {};
  for (const [variantId, variantSpec] of Object.entries(input)) {
    const variantPath = `${prefabPath}.variants.${variantId}`;
    if (!isRecord(variantSpec)) {
      throw sceneCompositionDiagnosticError(variantPath, "must be an object");
    }
    rawVariants[variantId] = {
      extends: optionalString(variantSpec.extends, `${variantPath}.extends`, undefined),
      props: propsObject(variantSpec.props, `${variantPath}.props`),
    };
  }

  const resolved: Record<string, ResolvedSceneCompositionPrefabVariant> = {};
  for (const variantId of Object.keys(rawVariants)) {
    resolved[variantId] = resolvePrefabVariant(prefabId, prefabProps, rawVariants, variantId, [], `${prefabPath}.variants`);
  }
  return resolved;
}

function resolvePrefabVariant(
  prefabId: string,
  prefabProps: SceneCompositionProps,
  variants: Readonly<Record<string, SceneCompositionPrefabVariantSpec>>,
  variantId: string,
  stack: readonly string[],
  path: string,
): ResolvedSceneCompositionPrefabVariant {
  const variant = variants[variantId];
  if (variant === undefined) {
    throw sceneCompositionDiagnosticError(`${path}.${variantId}`, `prefab '${prefabId}' variant is not defined`);
  }
  if (stack.includes(variantId)) {
    throw sceneCompositionDiagnosticError(`${path}.${variantId}.extends`, "variant inheritance must not contain cycles");
  }
  const inheritedProps = variant.extends === undefined
    ? prefabProps
    : resolvePrefabVariant(prefabId, prefabProps, variants, variant.extends, [...stack, variantId], path).props;
  return {
    id: variantId,
    ...(variant.extends === undefined ? {} : { extends: variant.extends }),
    props: mergeProps(inheritedProps, variant.props ?? {}),
  };
}

function resolveFragments(
  input: Readonly<Record<string, unknown>>,
  prefabs: Readonly<Record<string, ResolvedSceneCompositionPrefab>>,
  path: string,
): Record<string, ResolvedSceneCompositionFragment> {
  const fragments: Record<string, ResolvedSceneCompositionFragment> = {};
  for (const [fragmentId, fragmentSpec] of Object.entries(input)) {
    const fragmentPath = `${path}.${fragmentId}`;
    if (!isRecord(fragmentSpec)) {
      throw sceneCompositionDiagnosticError(fragmentPath, "must be an object");
    }
    fragments[fragmentId] = {
      id: fragmentId,
      include: arrayOf(fragmentSpec.include ?? [], `${fragmentPath}.include`).map((include, index) =>
        resolveFragmentInclude(include, `${fragmentPath}.include.${index}`),
      ),
      instances: arrayOf(fragmentSpec.instances ?? [], `${fragmentPath}.instances`).map((instance, index) =>
        resolveFragmentInstance(instance, prefabs, `${fragmentPath}.instances.${index}`),
      ),
    };
  }
  return fragments;
}

function resolveFragmentInclude(
  value: unknown,
  path: string,
): ResolvedSceneCompositionFragmentInclude {
  if (!isRecord(value)) {
    throw sceneCompositionDiagnosticError(path, "must be an object");
  }
  return {
    fragment: requiredString(value.fragment, `${path}.fragment`),
    idPrefix: optionalString(value.idPrefix, `${path}.idPrefix`, ""),
    ...resolveTransform(value, path),
    props: propsObject(value.props, `${path}.props`),
  };
}

function resolveFragmentInstance(
  value: unknown,
  prefabs: Readonly<Record<string, ResolvedSceneCompositionPrefab>>,
  path: string,
): ResolvedSceneCompositionFragmentInstance {
  if (!isRecord(value)) {
    throw sceneCompositionDiagnosticError(path, "must be an object");
  }
  const prefab = requiredString(value.prefab, `${path}.prefab`);
  const resolvedPrefab = prefabs[prefab];
  if (resolvedPrefab === undefined) {
    throw sceneCompositionDiagnosticError(`${path}.prefab`, `references unknown prefab '${prefab}'`);
  }
  const variant = optionalString(value.variant, `${path}.variant`, undefined);
  if (variant !== undefined && resolvedPrefab.variants[variant] === undefined) {
    throw sceneCompositionDiagnosticError(`${path}.variant`, `references unknown variant '${variant}' for prefab '${prefab}'`);
  }
  return {
    id: optionalString(value.id, `${path}.id`, undefined),
    prefab,
    ...(variant === undefined ? {} : { variant }),
    ...resolveTransform(value, path),
    props: propsObject(value.props, `${path}.props`),
  };
}

function validateFragmentIncludes(
  fragments: Readonly<Record<string, ResolvedSceneCompositionFragment>>,
  path: string,
): void {
  for (const fragment of Object.values(fragments)) {
    for (const include of fragment.include) {
      if (fragments[include.fragment] === undefined) {
        throw sceneCompositionDiagnosticError(`${path}.fragments.${fragment.id}.include.${include.fragment}`, `references unknown fragment '${include.fragment}'`);
      }
    }
  }
}

function collectFragmentInstances(
  composition: ResolvedSceneCompositionSpec,
  fragmentId: string,
  context: CollectFragmentContext,
): ResolvedSceneCompositionInstance[] {
  if (context.stack.length >= context.maxDepth) {
    throw sceneCompositionDiagnosticError(`${context.path}.fragments.${fragmentId}`, "fragment include depth exceeded maxDepth");
  }
  if (context.stack.includes(fragmentId)) {
    throw sceneCompositionDiagnosticError(`${context.path}.fragments.${fragmentId}`, "fragment includes must not contain cycles");
  }
  const fragment = composition.fragments[fragmentId];
  if (fragment === undefined) {
    throw sceneCompositionDiagnosticError(`${context.path}.fragments.${fragmentId}`, `references unknown fragment '${fragmentId}'`);
  }
  const nextStack = [...context.stack, fragmentId];
  const instances: ResolvedSceneCompositionInstance[] = [];
  for (const include of fragment.include) {
    instances.push(...collectFragmentInstances(composition, include.fragment, {
      transform: composeTransform(context.transform, include),
      props: mergeProps(context.props, include.props),
      idPrefix: `${context.idPrefix}${include.idPrefix}`,
      maxDepth: context.maxDepth,
      path: context.path,
      stack: nextStack,
    }));
  }
  fragment.instances.forEach((instance, index) => {
    const prefab = composition.prefabs[instance.prefab];
    if (prefab === undefined) {
      throw sceneCompositionDiagnosticError(`${context.path}.fragments.${fragmentId}.instances.${index}.prefab`, `references unknown prefab '${instance.prefab}'`);
    }
    const variant = instance.variant === undefined ? undefined : prefab.variants[instance.variant];
    const prefabProps = variant?.props ?? prefab.props;
    const sourceId = instance.id ?? `${fragmentId}.${index}`;
    instances.push({
      id: `${context.idPrefix}${sourceId}`,
      sourceId,
      prefab: instance.prefab,
      ...(instance.variant === undefined ? {} : { variant: instance.variant }),
      ...composeTransform(context.transform, instance),
      props: mergeProps(prefabProps, context.props, instance.props),
    });
  });
  return instances;
}

function composeTransform(
  parent: ResolvedSceneCompositionTransform,
  child: ResolvedSceneCompositionTransform,
): ResolvedSceneCompositionTransform {
  const cos = Math.cos(parent.rotationRadians);
  const sin = Math.sin(parent.rotationRadians);
  const scaledX = child.x * parent.scale;
  const scaledY = child.y * parent.scale;
  return {
    x: parent.x + scaledX * cos - scaledY * sin,
    y: parent.y + scaledX * sin + scaledY * cos,
    rotationRadians: parent.rotationRadians + child.rotationRadians,
    scale: parent.scale * child.scale,
    layer: parent.layer + child.layer,
  };
}

function resolveTransform(
  value: { x?: unknown; y?: unknown; rotationRadians?: unknown; scale?: unknown; layer?: unknown },
  path: string,
): ResolvedSceneCompositionTransform {
  return {
    x: finiteNumber(value.x ?? DEFAULT_TRANSFORM.x, `${path}.x`),
    y: finiteNumber(value.y ?? DEFAULT_TRANSFORM.y, `${path}.y`),
    rotationRadians: finiteNumber(value.rotationRadians ?? DEFAULT_TRANSFORM.rotationRadians, `${path}.rotationRadians`),
    scale: positiveNumber(value.scale ?? DEFAULT_TRANSFORM.scale, `${path}.scale`),
    layer: finiteNumber(value.layer ?? DEFAULT_TRANSFORM.layer, `${path}.layer`),
  };
}

function propsObject(value: unknown, path: string): SceneCompositionProps {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw sceneCompositionDiagnosticError(path, "must be an object");
  }
  return cloneJsonObject(value, path);
}

function mergeProps(...entries: readonly SceneCompositionProps[]): SceneCompositionProps {
  let result: Record<string, SceneCompositionJsonValue> = {};
  for (const entry of entries) {
    result = mergeJsonObjects(result, entry);
  }
  return result;
}

function mergeJsonObjects(
  base: Readonly<Record<string, SceneCompositionJsonValue>>,
  override: Readonly<Record<string, SceneCompositionJsonValue>>,
): Record<string, SceneCompositionJsonValue> {
  const result: Record<string, SceneCompositionJsonValue> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const previous = result[key];
    result[key] = key !== "components" && isJsonObject(previous) && isJsonObject(value)
      ? mergeJsonObjects(previous, value)
      : cloneJsonValue(value, key);
  }
  return result;
}

function cloneJsonObject(value: Readonly<Record<string, unknown>>, path: string): Record<string, SceneCompositionJsonValue> {
  const result: Record<string, SceneCompositionJsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = cloneJsonValue(child, `${path}.${key}`);
  }
  return result;
}

function cloneJsonValue(value: unknown, path: string): SceneCompositionJsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return finiteNumber(value, path);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => cloneJsonValue(entry, `${path}.${index}`));
  }
  if (isRecord(value)) {
    return cloneJsonObject(value, path);
  }
  throw sceneCompositionDiagnosticError(path, "must be JSON-compatible");
}

function arrayOf(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw sceneCompositionDiagnosticError(path, "must be an array");
  }
  return value;
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw sceneCompositionDiagnosticError(path, "must be an object");
  }
  return value;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw sceneCompositionDiagnosticError(path, "must be a non-empty string");
  }
  return value;
}

function optionalString<T extends string | undefined>(value: unknown, path: string, fallback: T): string | T {
  if (value === undefined) {
    return fallback;
  }
  return requiredString(value, path);
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw sceneCompositionDiagnosticError(path, "must be a positive integer");
  }
  return value;
}

function positiveNumber(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (number <= 0) {
    throw sceneCompositionDiagnosticError(path, "must be greater than 0");
  }
  return number;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw sceneCompositionDiagnosticError(path, "must be a finite number");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isJsonObject(value: unknown): value is Readonly<Record<string, SceneCompositionJsonValue>> {
  return isRecord(value);
}

function isResolvedSceneCompositionSpec(
  value: SceneCompositionSpec | ResolvedSceneCompositionSpec,
): value is ResolvedSceneCompositionSpec {
  const firstPrefab = Object.values(value.prefabs ?? {})[0];
  const firstFragment = Object.values(value.fragments ?? {})[0];
  return isRecord(firstPrefab)
    && typeof firstPrefab.id === "string"
    && isRecord(firstPrefab.variants)
    && isRecord(firstFragment)
    && typeof firstFragment.id === "string"
    && Array.isArray(firstFragment.instances)
    && Array.isArray(firstFragment.include);
}
