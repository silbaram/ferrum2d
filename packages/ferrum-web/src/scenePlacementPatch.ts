import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import { resolveDataSceneComponentsSpec } from "./dataSceneComponents.js";
import { GAMEPLAY_BEHAVIOR_BINDING_PROP } from "./gameplayAuthoring.js";
import {
  SCENE_AUTHORING_DOCUMENT_FORMAT,
  SCENE_AUTHORING_DOCUMENT_VERSION,
  type SceneAuthoringDocumentSpec,
} from "./sceneAuthoringDocument.js";
import type {
  SceneCompositionFragmentInstanceSpec,
  SceneCompositionFragmentSpec,
  SceneCompositionJsonValue,
  SceneCompositionPrefabSpec,
  SceneCompositionSpec,
} from "./sceneComposition.js";
import {
  SCENE_PLACEMENT_PATCH_FORMAT,
  SCENE_PLACEMENT_PATCH_VERSION,
  type ScenePlacementPatch,
  type ScenePlacementPatchOperation,
  type ScenePlacementBehaviorBindingPatch,
  type ScenePlacementBehaviorBindingTarget,
  type ScenePlacementTransform,
} from "./scenePlacementViewer.js";

export interface MergeScenePlacementPatchOptions {
  path?: string;
  allowedFragments?: readonly string[];
}

export const SCENE_PLACEMENT_BINDING_MIGRATION_PREVIEW_FORMAT =
  "ferrum2d.scene-placement.binding-migration-preview" as const;
export const SCENE_PLACEMENT_BINDING_MIGRATION_PREVIEW_VERSION = 1 as const;

export interface ScenePlacementPatchMergeResult {
  document: SceneAuthoringDocumentSpec;
  operationCount: number;
  changedInstanceIds: readonly string[];
}

export type ScenePlacementBindingMigrationOperationKind = "renameInstance" | "removeInstance";
export type ScenePlacementBindingMigrationReferenceKind = "stringValue" | "objectKey";

export interface ScenePlacementBindingMigrationReference {
  operationIndex: number;
  operationKind: ScenePlacementBindingMigrationOperationKind;
  instanceId: string;
  nextInstanceId?: string;
  owner: "agent";
  path: string;
  referenceKind: ScenePlacementBindingMigrationReferenceKind;
  value: string;
  suggestedValue?: string;
}

export interface ScenePlacementBindingMigrationRename {
  operationIndex: number;
  instanceId: string;
  nextInstanceId: string;
}

export interface ScenePlacementBindingMigrationPreview {
  format: typeof SCENE_PLACEMENT_BINDING_MIGRATION_PREVIEW_FORMAT;
  version: typeof SCENE_PLACEMENT_BINDING_MIGRATION_PREVIEW_VERSION;
  renamedInstanceIds: readonly ScenePlacementBindingMigrationRename[];
  removedInstanceIds: readonly string[];
  references: readonly ScenePlacementBindingMigrationReference[];
}

export interface ScenePlacementSaveAdapter {
  readonly id: string;
  saveScenePlacementPatch(
    request: ScenePlacementSaveAdapterRequest,
  ): ScenePlacementSaveAdapterResult | Promise<ScenePlacementSaveAdapterResult>;
}

export interface ScenePlacementSaveAdapterRequest {
  sourceDocument: SceneAuthoringDocumentSpec;
  patch: ScenePlacementPatch;
  mergedDocument: SceneAuthoringDocumentSpec;
  operationCount: number;
  changedInstanceIds: readonly string[];
  path: string;
}

export interface ScenePlacementSaveAdapterResult {
  saved: boolean;
  document?: SceneAuthoringDocumentSpec;
}

export interface SaveScenePlacementPatchOptions extends MergeScenePlacementPatchOptions {
  allowSave?: boolean;
  adapter?: ScenePlacementSaveAdapter;
  allowedAdapterIds?: readonly string[];
}

export interface ScenePlacementPatchSaveResult extends ScenePlacementPatchMergeResult {
  saved: boolean;
  adapterId: string;
}

type MutableSceneCompositionFragmentSpec = Omit<SceneCompositionFragmentSpec, "instances"> & {
  instances?: SceneCompositionFragmentInstanceSpec[];
};

type MutableSceneCompositionSpec = Omit<SceneCompositionSpec, "fragments" | "prefabs"> & {
  prefabs: Record<string, SceneCompositionPrefabSpec>;
  fragments?: Record<string, MutableSceneCompositionFragmentSpec>;
};

interface MutableInstanceRef {
  fragmentId: string;
  instances: SceneCompositionFragmentInstanceSpec[];
  index: number;
  instance: SceneCompositionFragmentInstanceSpec;
}

export function mergeScenePlacementPatch(
  document: SceneAuthoringDocumentSpec,
  patch: ScenePlacementPatch,
  options: MergeScenePlacementPatchOptions = {},
): ScenePlacementPatchMergeResult {
  const path = options.path ?? "scenePlacementPatch";
  validateSceneAuthoringDocumentEnvelope(document, `${path}.document`);
  validateScenePlacementPatchEnvelope(patch, `${path}.patch`);
  const nextDocument = cloneValue(document);
  const composition = nextDocument.sceneComposition as MutableSceneCompositionSpec;
  const fragments = mutableFragments(composition);
  const changedInstanceIds: string[] = [];

  patch.operations.forEach((operation, index) => {
    const operationPath = `${path}.patch.operations.${index}`;
    switch (operation.kind) {
      case "updateTransform": {
        const ref = findUniqueInstanceRef(fragments, operation.instanceId, operationPath);
        assertAllowedFragment(ref.fragmentId, options.allowedFragments, `${operationPath}.fragment`);
        const transform = validatedTransformPatch(operation.transform, `${operationPath}.transform`);
        ref.instances[ref.index] = {
          ...ref.instance,
          ...transform,
        };
        pushUnique(changedInstanceIds, operation.instanceId);
        break;
      }
      case "updateComponents": {
        const ref = findUniqueInstanceRef(fragments, operation.instanceId, operationPath);
        assertAllowedFragment(ref.fragmentId, options.allowedFragments, `${operationPath}.fragment`);
        const components = validatedComponentsPatch(operation.components, `${operationPath}.components`);
        ref.instances[ref.index] = {
          ...ref.instance,
          props: {
            ...(ref.instance.props ?? {}),
            components,
          },
        };
        pushUnique(changedInstanceIds, operation.instanceId);
        break;
      }
      case "updateBehaviorBinding": {
        const target = validatedBehaviorBindingTarget(operation.target, `${operationPath}.target`);
        const behaviorRecipes = validatedBehaviorBindingPatch(
          operation.behaviorRecipes,
          `${operationPath}.behaviorRecipes`,
        );
        if (target.kind === "instance") {
          const ref = findUniqueInstanceRef(fragments, target.instanceId, `${operationPath}.target.instanceId`);
          assertAllowedFragment(ref.fragmentId, options.allowedFragments, `${operationPath}.fragment`);
          ref.instances[ref.index] = instanceWithBehaviorBinding(ref.instance, behaviorRecipes);
          pushUnique(changedInstanceIds, target.instanceId);
          break;
        }
        const definition = composition.prefabs[target.id];
        if (definition === undefined) {
          throw gameplayAuthoringDiagnosticError(
            `${operationPath}.target.id`,
            `references unknown object definition '${target.id}'`,
          );
        }
        composition.prefabs[target.id] = objectDefinitionWithBehaviorBinding(definition, behaviorRecipes);
        break;
      }
      case "renameInstance": {
        const ref = findUniqueInstanceRef(fragments, operation.instanceId, operationPath);
        assertAllowedFragment(ref.fragmentId, options.allowedFragments, `${operationPath}.fragment`);
        const nextInstanceId = requiredPlacementId(operation.nextInstanceId, `${operationPath}.nextInstanceId`);
        if (nextInstanceId !== operation.instanceId) {
          assertUniqueNextInstanceId(fragments, nextInstanceId, ref, `${operationPath}.nextInstanceId`);
          ref.instances[ref.index] = {
            ...ref.instance,
            id: nextInstanceId,
          };
          pushUnique(changedInstanceIds, operation.instanceId);
          pushUnique(changedInstanceIds, nextInstanceId);
        }
        break;
      }
      case "addObjectDefinition": {
        const id = requiredPlacementId(operation.id, `${operationPath}.id`);
        if (composition.prefabs[id] !== undefined) {
          throw gameplayAuthoringDiagnosticError(`${operationPath}.id`, `object definition '${id}' already exists`);
        }
        composition.prefabs[id] = validateAddObjectDefinition(operation.definition, `${operationPath}.definition`);
        break;
      }
      case "addInstance": {
        const fragmentId = requiredPlacementId(operation.fragment, `${operationPath}.fragment`);
        assertAllowedFragment(fragmentId, options.allowedFragments, `${operationPath}.fragment`);
        const fragment = fragments[fragmentId];
        if (fragment === undefined) {
          throw gameplayAuthoringDiagnosticError(`${operationPath}.fragment`, `references unknown fragment '${fragmentId}'`);
        }
        const instance = validateAddInstance(composition, operation.instance, `${operationPath}.instance`);
        assertUniqueNextInstanceId(fragments, instance.id, undefined, `${operationPath}.instance.id`);
        if (fragment.instances === undefined) {
          fragment.instances = [];
        }
        fragment.instances.push(instance);
        pushUnique(changedInstanceIds, instance.id);
        break;
      }
      case "removeInstance": {
        const ref = findUniqueInstanceRef(fragments, operation.instanceId, operationPath);
        assertAllowedFragment(ref.fragmentId, options.allowedFragments, `${operationPath}.fragment`);
        ref.instances.splice(ref.index, 1);
        pushUnique(changedInstanceIds, operation.instanceId);
        break;
      }
    }
  });

  return {
    document: nextDocument,
    operationCount: patch.operations.length,
    changedInstanceIds,
  };
}

export function previewScenePlacementBindingMigration(
  document: SceneAuthoringDocumentSpec,
  patch: ScenePlacementPatch,
  options: Pick<MergeScenePlacementPatchOptions, "path"> = {},
): ScenePlacementBindingMigrationPreview {
  const path = options.path ?? "scenePlacementBindingMigration";
  validateSceneAuthoringDocumentEnvelope(document, `${path}.document`);
  validateScenePlacementPatchEnvelope(patch, `${path}.patch`);
  const renamedInstanceIds: ScenePlacementBindingMigrationRename[] = [];
  const removedInstanceIds: string[] = [];
  const references: ScenePlacementBindingMigrationReference[] = [];

  patch.operations.forEach((operation, operationIndex) => {
    if (operation.kind === "renameInstance") {
      const instanceId = requiredPlacementId(operation.instanceId, `${path}.patch.operations.${operationIndex}.instanceId`);
      const nextInstanceId = requiredPlacementId(operation.nextInstanceId, `${path}.patch.operations.${operationIndex}.nextInstanceId`);
      renamedInstanceIds.push({ operationIndex, instanceId, nextInstanceId });
      references.push(...findAgentOwnedReferences(document.behaviorRecipes, {
        operationIndex,
        operationKind: "renameInstance",
        instanceId,
        nextInstanceId,
        path: `${path}.document.behaviorRecipes`,
      }));
      return;
    }
    if (operation.kind === "removeInstance") {
      const instanceId = requiredPlacementId(operation.instanceId, `${path}.patch.operations.${operationIndex}.instanceId`);
      removedInstanceIds.push(instanceId);
      references.push(...findAgentOwnedReferences(document.behaviorRecipes, {
        operationIndex,
        operationKind: "removeInstance",
        instanceId,
        path: `${path}.document.behaviorRecipes`,
      }));
    }
  });

  return {
    format: SCENE_PLACEMENT_BINDING_MIGRATION_PREVIEW_FORMAT,
    version: SCENE_PLACEMENT_BINDING_MIGRATION_PREVIEW_VERSION,
    renamedInstanceIds,
    removedInstanceIds,
    references,
  };
}

export async function saveScenePlacementPatch(
  document: SceneAuthoringDocumentSpec,
  patch: ScenePlacementPatch,
  options: SaveScenePlacementPatchOptions = {},
): Promise<ScenePlacementPatchSaveResult> {
  const path = options.path ?? "scenePlacementSave";
  if (options.allowSave !== true) {
    throw gameplayAuthoringDiagnosticError(`${path}.allowSave`, "must be true to save a scene placement patch");
  }
  const adapter = options.adapter;
  if (adapter === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.adapter`, "must provide a host-owned save adapter");
  }
  if (
    options.allowedAdapterIds !== undefined
    && !options.allowedAdapterIds.includes(adapter.id)
  ) {
    throw gameplayAuthoringDiagnosticError(`${path}.adapter.id`, `adapter '${adapter.id}' is not allowed`);
  }

  const merge = mergeScenePlacementPatch(document, patch, options);
  const result = await adapter.saveScenePlacementPatch({
    sourceDocument: document,
    patch,
    mergedDocument: merge.document,
    operationCount: merge.operationCount,
    changedInstanceIds: merge.changedInstanceIds,
    path,
  });
  return {
    ...merge,
    document: result.document ?? merge.document,
    saved: result.saved,
    adapterId: adapter.id,
  };
}

function validateSceneAuthoringDocumentEnvelope(document: SceneAuthoringDocumentSpec, path: string): void {
  if (document.format !== SCENE_AUTHORING_DOCUMENT_FORMAT) {
    throw gameplayAuthoringDiagnosticError(path, `format must be ${SCENE_AUTHORING_DOCUMENT_FORMAT}`);
  }
  if (document.version !== SCENE_AUTHORING_DOCUMENT_VERSION) {
    throw gameplayAuthoringDiagnosticError(path, `version must be ${SCENE_AUTHORING_DOCUMENT_VERSION}`);
  }
}

function validateScenePlacementPatchEnvelope(patch: ScenePlacementPatch, path: string): void {
  if (patch.format !== SCENE_PLACEMENT_PATCH_FORMAT) {
    throw gameplayAuthoringDiagnosticError(path, `format must be ${SCENE_PLACEMENT_PATCH_FORMAT}`);
  }
  if (patch.version !== SCENE_PLACEMENT_PATCH_VERSION) {
    throw gameplayAuthoringDiagnosticError(path, `version must be ${SCENE_PLACEMENT_PATCH_VERSION}`);
  }
}

function mutableFragments(
  composition: MutableSceneCompositionSpec,
): Record<string, MutableSceneCompositionFragmentSpec> {
  if (composition.fragments === undefined) {
    composition.fragments = { [composition.initialFragment ?? "main"]: {} };
  }
  return composition.fragments;
}

function findUniqueInstanceRef(
  fragments: Record<string, MutableSceneCompositionFragmentSpec>,
  instanceId: string,
  path: string,
): MutableInstanceRef {
  const matches: MutableInstanceRef[] = [];
  for (const [fragmentId, fragment] of Object.entries(fragments)) {
    const instances = fragment.instances ?? [];
    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index];
      if (instance?.id === instanceId) {
        matches.push({
          fragmentId,
          instances,
          index,
          instance,
        });
      }
    }
  }
  if (matches.length === 0) {
    throw gameplayAuthoringDiagnosticError(path, `references unknown scene instance '${instanceId}'`);
  }
  if (matches.length > 1) {
    throw gameplayAuthoringDiagnosticError(path, `references ambiguous scene instance '${instanceId}'`);
  }
  return matches[0] as MutableInstanceRef;
}

function assertAllowedFragment(
  fragmentId: string,
  allowedFragments: readonly string[] | undefined,
  path: string,
): void {
  if (allowedFragments !== undefined && !allowedFragments.includes(fragmentId)) {
    throw gameplayAuthoringDiagnosticError(path, `fragment '${fragmentId}' is not allowed`);
  }
}

function assertUniqueNextInstanceId(
  fragments: Record<string, MutableSceneCompositionFragmentSpec>,
  instanceId: string,
  current: MutableInstanceRef | undefined,
  path: string,
): void {
  for (const [fragmentId, fragment] of Object.entries(fragments)) {
    const instances = fragment.instances ?? [];
    for (let index = 0; index < instances.length; index += 1) {
      if (
        current !== undefined
        && current.fragmentId === fragmentId
        && current.index === index
      ) {
        continue;
      }
      if (instances[index]?.id === instanceId) {
        throw gameplayAuthoringDiagnosticError(path, `scene instance '${instanceId}' already exists`);
      }
    }
  }
}

function validateAddInstance(
  composition: MutableSceneCompositionSpec,
  instance: SceneCompositionFragmentInstanceSpec,
  path: string,
): SceneCompositionFragmentInstanceSpec & { id: string } {
  const copy = copySceneCompositionFragmentInstance(instance);
  const instanceId = requiredPlacementId(copy.id, `${path}.id`);
  const prefabId = requiredPlacementId(copy.prefab, `${path}.prefab`);
  validatePlacementInstanceProps(copy.props, `${path}.props`);
  const prefab = composition.prefabs[prefabId];
  if (prefab === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.prefab`, `references unknown prefab '${prefabId}'`);
  }
  if (copy.variant !== undefined) {
    const variants = prefab.variants ?? {};
    if (variants[copy.variant] === undefined) {
      throw gameplayAuthoringDiagnosticError(
        `${path}.variant`,
        `references unknown variant '${copy.variant}' for prefab '${prefabId}'`,
      );
    }
  }
  const transform = validatedTransformPatch(copy, path);
  return {
    ...copy,
    id: instanceId,
    prefab: prefabId,
    ...transform,
  };
}

function validateAddObjectDefinition(
  definition: SceneCompositionPrefabSpec,
  path: string,
): SceneCompositionPrefabSpec {
  const copy = copySceneCompositionPrefabSpec(definition);
  validatePlacementDefinitionProps(copy.props, `${path}.props`);
  const variants = copy.variants ?? {};
  for (const [variantId, variant] of Object.entries(variants)) {
    requiredPlacementId(variantId, `${path}.variants.${variantId}`);
    if (variant.extends !== undefined) {
      requiredPlacementId(variant.extends, `${path}.variants.${variantId}.extends`);
    }
    validatePlacementDefinitionProps(variant.props, `${path}.variants.${variantId}.props`);
  }
  return copy;
}

function validatePlacementInstanceProps(
  props: Readonly<Record<string, SceneCompositionJsonValue>> | undefined,
  path: string,
): void {
  if (props === undefined) {
    return;
  }
  for (const key of Object.keys(props)) {
    if (key !== "components") {
      throw gameplayAuthoringDiagnosticError(
        `${path}.${key}`,
        "placement patches may only write UI-owned props.components",
      );
    }
  }
}

function validatePlacementDefinitionProps(
  props: Readonly<Record<string, SceneCompositionJsonValue>> | undefined,
  path: string,
): void {
  if (props === undefined) {
    return;
  }
  validatePlacementInstanceProps(props, path);
  const components = props.components;
  if (components !== undefined) {
    validatedComponentsPatch(components, `${path}.components`);
  }
}

function requiredPlacementId(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-empty string");
  }
  return value;
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

interface ReferenceScanContext {
  operationIndex: number;
  operationKind: ScenePlacementBindingMigrationOperationKind;
  instanceId: string;
  nextInstanceId?: string;
  path: string;
}

function findAgentOwnedReferences(
  value: unknown,
  context: ReferenceScanContext,
): ScenePlacementBindingMigrationReference[] {
  const references: ScenePlacementBindingMigrationReference[] = [];
  collectAgentOwnedReferences(value, context, references);
  return references;
}

function collectAgentOwnedReferences(
  value: unknown,
  context: ReferenceScanContext,
  references: ScenePlacementBindingMigrationReference[],
): void {
  if (typeof value === "string") {
    if (value === context.instanceId) {
      references.push(bindingMigrationReference(context, "stringValue", context.path));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectAgentOwnedReferences(entry, { ...context, path: `${context.path}.${index}` }, references);
    });
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const childPath = `${context.path}.${key}`;
    if (key === context.instanceId) {
      references.push(bindingMigrationReference(context, "objectKey", childPath));
    }
    collectAgentOwnedReferences(entry, { ...context, path: childPath }, references);
  }
}

function bindingMigrationReference(
  context: ReferenceScanContext,
  referenceKind: ScenePlacementBindingMigrationReferenceKind,
  path: string,
): ScenePlacementBindingMigrationReference {
  return {
    operationIndex: context.operationIndex,
    operationKind: context.operationKind,
    instanceId: context.instanceId,
    ...(context.nextInstanceId === undefined ? {} : { nextInstanceId: context.nextInstanceId }),
    owner: "agent",
    path,
    referenceKind,
    value: context.instanceId,
    ...(context.operationKind === "renameInstance" && context.nextInstanceId !== undefined
      ? { suggestedValue: context.nextInstanceId }
      : {}),
  };
}

function validatedTransformPatch(
  transform: Partial<ScenePlacementTransform>,
  path: string,
): Partial<ScenePlacementTransform> {
  const patch: Partial<ScenePlacementTransform> = {};
  if (transform.x !== undefined) {
    patch.x = finiteTransformNumber(transform.x, `${path}.x`);
  }
  if (transform.y !== undefined) {
    patch.y = finiteTransformNumber(transform.y, `${path}.y`);
  }
  if (transform.rotationRadians !== undefined) {
    patch.rotationRadians = finiteTransformNumber(transform.rotationRadians, `${path}.rotationRadians`);
  }
  if (transform.scale !== undefined) {
    patch.scale = positiveTransformNumber(transform.scale, `${path}.scale`);
  }
  if (transform.layer !== undefined) {
    patch.layer = finiteTransformNumber(transform.layer, `${path}.layer`);
  }
  return patch;
}

function finiteTransformNumber(value: number, path: string): number {
  if (!Number.isFinite(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be a finite number");
  }
  return value;
}

function positiveTransformNumber(value: number, path: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a positive finite number");
  }
  return value;
}

function validatedComponentsPatch(
  components: SceneCompositionJsonValue,
  path: string,
): SceneCompositionJsonValue {
  const copy = cloneValue(components);
  try {
    resolveDataSceneComponentsSpec(copy, {
      allowTemplate: false,
      path,
    });
  } catch (error) {
    throw gameplayAuthoringDiagnosticError(path, error instanceof Error ? error.message : String(error));
  }
  return copy;
}

function validatedBehaviorBindingTarget(
  target: ScenePlacementBehaviorBindingTarget,
  path: string,
): ScenePlacementBehaviorBindingTarget {
  if (target?.kind === "instance") {
    return {
      kind: "instance",
      instanceId: requiredPlacementId(target.instanceId, `${path}.instanceId`),
    };
  }
  if (target?.kind === "objectDefinition") {
    return {
      kind: "objectDefinition",
      id: requiredPlacementId(target.id, `${path}.id`),
    };
  }
  throw gameplayAuthoringDiagnosticError(`${path}.kind`, "must be instance or objectDefinition");
}

function validatedBehaviorBindingPatch(
  behaviorRecipes: ScenePlacementBehaviorBindingPatch,
  path: string,
): ScenePlacementBehaviorBindingPatch {
  if (behaviorRecipes === null) {
    return null;
  }
  if (typeof behaviorRecipes === "string") {
    if (behaviorRecipes.length === 0) {
      throw gameplayAuthoringDiagnosticError(path, "must be a non-empty behavior profile string");
    }
    return behaviorRecipes;
  }
  if (Array.isArray(behaviorRecipes)) {
    return behaviorRecipes.map((entry, index) => {
      if (typeof entry !== "string" || entry.length === 0) {
        throw gameplayAuthoringDiagnosticError(`${path}.${index}`, "must be a non-empty behavior profile string");
      }
      return entry;
    });
  }
  throw gameplayAuthoringDiagnosticError(path, "must be null, a behavior profile string, or a string array");
}

function behaviorBindingPropsValue(
  behaviorRecipes: ScenePlacementBehaviorBindingPatch,
): SceneCompositionJsonValue {
  if (behaviorRecipes === null) {
    return [];
  }
  return typeof behaviorRecipes === "string" ? behaviorRecipes : [...behaviorRecipes];
}

function instanceWithBehaviorBinding(
  instance: SceneCompositionFragmentInstanceSpec,
  behaviorRecipes: ScenePlacementBehaviorBindingPatch,
): SceneCompositionFragmentInstanceSpec {
  return {
    ...instance,
    props: {
      ...(instance.props ?? {}),
      [GAMEPLAY_BEHAVIOR_BINDING_PROP]: behaviorBindingPropsValue(behaviorRecipes),
    },
  };
}

function objectDefinitionWithBehaviorBinding(
  definition: SceneCompositionPrefabSpec,
  behaviorRecipes: ScenePlacementBehaviorBindingPatch,
): SceneCompositionPrefabSpec {
  const props = { ...(definition.props ?? {}) };
  if (behaviorRecipes === null) {
    delete props[GAMEPLAY_BEHAVIOR_BINDING_PROP];
  } else {
    props[GAMEPLAY_BEHAVIOR_BINDING_PROP] = behaviorBindingPropsValue(behaviorRecipes);
  }
  return {
    ...definition,
    props,
  };
}

function cloneValue<T>(value: T): T {
  return cloneUnknown(value) as T;
}

function copySceneCompositionFragmentInstance(
  instance: SceneCompositionFragmentInstanceSpec,
): SceneCompositionFragmentInstanceSpec {
  return cloneValue(instance);
}

function copySceneCompositionPrefabSpec(
  definition: SceneCompositionPrefabSpec,
): SceneCompositionPrefabSpec {
  return cloneValue(definition);
}

function cloneUnknown(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(cloneUnknown);
  }
  if (typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      copy[key] = cloneUnknown(entry);
    }
    return copy;
  }
  return value;
}
