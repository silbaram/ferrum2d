import { physicsSpecDiagnosticError } from "./diagnostics.js";
import type { PhysicsSpec } from "./physicsSpec.js";

export const PHYSICS_AUTHORING_SCHEMA_VERSION = 1;

export interface PhysicsAuthoringDocument {
  physics: PhysicsSpec;
  physicsEditor?: PhysicsEditorMetadata;
}

export interface PhysicsEditorMetadata {
  version?: typeof PHYSICS_AUTHORING_SCHEMA_VERSION;
  displayName?: string;
  description?: string;
  lockedFields?: readonly string[];
  agentEditableFields?: readonly string[];
  bodies?: Record<string, PhysicsEditorBodyMetadata>;
  joints?: Record<string, PhysicsEditorJointMetadata>;
  presets?: Record<string, PhysicsEditorPresetMetadata>;
}

export interface PhysicsEditorBodyMetadata {
  displayName?: string;
  description?: string;
  gizmo?: PhysicsEditorGizmoKind;
  preset?: string;
  lockedFields?: readonly string[];
  agentEditableFields?: readonly string[];
}

export interface PhysicsEditorJointMetadata {
  displayName?: string;
  description?: string;
  gizmo?: "anchor" | "axis" | "motor";
  lockedFields?: readonly string[];
  agentEditableFields?: readonly string[];
}

export interface PhysicsEditorPresetMetadata {
  displayName?: string;
  description?: string;
  target?: "body" | "collider" | "joint" | "material" | "layer";
}

export type PhysicsEditorGizmoKind = "box" | "circle" | "capsule" | "polygon" | "edge" | "chain";

export interface CompilePhysicsAuthoringOptions {
  path?: string;
}

export function compilePhysicsAuthoringDocument(
  document: PhysicsAuthoringDocument,
  options: CompilePhysicsAuthoringOptions = {},
): PhysicsSpec {
  validatePhysicsAuthoringDocument(document, options);
  return cloneJson(document.physics);
}

export function validatePhysicsAuthoringDocument(
  document: PhysicsAuthoringDocument,
  options: CompilePhysicsAuthoringOptions = {},
): void {
  const path = options.path ?? "physicsAuthoring";
  if (!isObject(document)) {
    throw physicsSpecDiagnosticError(path, "must be an object");
  }
  if (!isObject(document.physics)) {
    throw physicsSpecDiagnosticError(`${path}.physics`, "must be a runtime Physics Spec object");
  }
  validateEditorMetadata(document, path);
}

export function isPhysicsAuthoringDocument(value: unknown): value is PhysicsAuthoringDocument {
  return isObject(value) && isObject(value.physics);
}

function validateEditorMetadata(document: PhysicsAuthoringDocument, path: string): void {
  const rawMetadata = document.physicsEditor;
  if (rawMetadata === undefined) {
    return;
  }
  if (!isObject(rawMetadata)) {
    throw physicsSpecDiagnosticError(`${path}.physicsEditor`, "must be an object");
  }
  const metadata = rawMetadata as PhysicsEditorMetadata;
  if (metadata.version !== undefined && metadata.version !== PHYSICS_AUTHORING_SCHEMA_VERSION) {
    throw physicsSpecDiagnosticError(
      `${path}.physicsEditor.version`,
      `must be ${PHYSICS_AUTHORING_SCHEMA_VERSION}`,
    );
  }
  validateStringList(metadata.lockedFields, `${path}.physicsEditor.lockedFields`, "locked field");
  validateStringList(metadata.agentEditableFields, `${path}.physicsEditor.agentEditableFields`, "agent editable field");
  validateFieldPaths(metadata.lockedFields, `${path}.physicsEditor.lockedFields`);
  validateFieldPaths(metadata.agentEditableFields, `${path}.physicsEditor.agentEditableFields`);
  validateKnownMetadataKeys(metadata.bodies, document.physics.bodies, `${path}.physicsEditor.bodies`, "body");
  validateKnownMetadataKeys(metadata.joints, document.physics.joints, `${path}.physicsEditor.joints`, "joint");
  validateMetadataRecord(metadata.bodies, `${path}.physicsEditor.bodies`, "body metadata");
  validateMetadataRecord(metadata.joints, `${path}.physicsEditor.joints`, "joint metadata");
  validateMetadataRecord(metadata.presets, `${path}.physicsEditor.presets`, "preset metadata");

  for (const [bodyId, bodyMetadata] of Object.entries(metadata.bodies ?? {})) {
    validateStringList(
      bodyMetadata.lockedFields,
      `${path}.physicsEditor.bodies.${bodyId}.lockedFields`,
      "locked field",
    );
    validateStringList(
      bodyMetadata.agentEditableFields,
      `${path}.physicsEditor.bodies.${bodyId}.agentEditableFields`,
      "agent editable field",
    );
    validateFieldPaths(
      bodyMetadata.lockedFields,
      `${path}.physicsEditor.bodies.${bodyId}.lockedFields`,
    );
    validateFieldPaths(
      bodyMetadata.agentEditableFields,
      `${path}.physicsEditor.bodies.${bodyId}.agentEditableFields`,
    );
  }

  for (const [jointId, jointMetadata] of Object.entries(metadata.joints ?? {})) {
    validateStringList(
      jointMetadata.lockedFields,
      `${path}.physicsEditor.joints.${jointId}.lockedFields`,
      "locked field",
    );
    validateStringList(
      jointMetadata.agentEditableFields,
      `${path}.physicsEditor.joints.${jointId}.agentEditableFields`,
      "agent editable field",
    );
    validateFieldPaths(
      jointMetadata.lockedFields,
      `${path}.physicsEditor.joints.${jointId}.lockedFields`,
    );
    validateFieldPaths(
      jointMetadata.agentEditableFields,
      `${path}.physicsEditor.joints.${jointId}.agentEditableFields`,
    );
  }
}

function validateMetadataRecord(
  metadata: Record<string, unknown> | undefined,
  path: string,
  label: string,
): void {
  if (metadata === undefined) {
    return;
  }
  if (!isObject(metadata)) {
    throw physicsSpecDiagnosticError(path, "must be an object");
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (!isObject(value)) {
      throw physicsSpecDiagnosticError(`${path}.${key}`, `${label} must be an object`);
    }
  }
}

function validateKnownMetadataKeys(
  metadata: Record<string, unknown> | undefined,
  runtimeEntries: Record<string, unknown> | undefined,
  path: string,
  label: string,
): void {
  if (metadata === undefined) {
    return;
  }
  for (const key of Object.keys(metadata)) {
    if (runtimeEntries?.[key] === undefined) {
      throw physicsSpecDiagnosticError(`${path}.${key}`, `references unknown ${label} '${key}'`);
    }
  }
}

function validateStringList(
  values: readonly string[] | undefined,
  path: string,
  label: string,
): void {
  if (values === undefined) {
    return;
  }
  if (!Array.isArray(values)) {
    throw physicsSpecDiagnosticError(path, "must be an array");
  }
  values.forEach((value, index) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw physicsSpecDiagnosticError(`${path}.${index}`, `${label} path must be a non-empty string`);
    }
  });
}

function validateFieldPaths(values: readonly string[] | undefined, path: string): void {
  if (values === undefined) {
    return;
  }
  values.forEach((value, index) => {
    if (!value.startsWith("physics.")) {
      throw physicsSpecDiagnosticError(`${path}.${index}`, "must reference a runtime physics path");
    }
    if (value.includes("..") || value.includes("[") || value.includes("]")) {
      throw physicsSpecDiagnosticError(`${path}.${index}`, "must use dot-separated runtime physics path segments");
    }
  });
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
