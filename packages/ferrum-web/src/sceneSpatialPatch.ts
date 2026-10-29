import {
  resolveDataSceneSpatialSpec,
  resolveSpatialCameraSpec,
  type DataSceneSpatialSpec,
  type SpatialCameraSpec,
  type SpatialTerrainSurface,
  type SpatialBillboardSpec,
  type SpatialModelInstanceSpec,
} from "./dataSceneSpatial.js";
import { resolveSpatialEnvironmentSpec, type SpatialEnvironmentSpec } from "./spatialEnvironment.js";

export type SceneSpatialPatchOperation =
  | {
      /** Scene-level environment replacement; null removes all environment settings. */
      kind: "setEnvironment";
      changes: { environment: SpatialEnvironmentSpec | null; lightBindings?: DataSceneSpatialSpec["lightBindings"] };
    }
  | {
      /** Scene-level camera replacement; no instance identity is involved. */
      kind: "setCamera";
      changes: { camera: SpatialCameraSpec };
    }
  | {
      kind: "setBillboardNormalTexture";
      id: string;
      /** null detaches either the stable reference or the legacy numeric ID. */
      changes: { normalTexture: string | null };
    }
  | {
      kind: "replaceModelAsset";
      id: string;
      changes: { asset: string; contentId: string };
    }
  | {
      kind: "renameReference";
      id: string;
      changes: { target: "billboard" | "model"; nextId: string };
    }
  | {
      kind: "removeReference";
      id: string;
      changes: { target: "billboard" | "model" };
    }
  | {
      kind: "copyReference";
      id: string;
      changes: { target: "billboard" | "model"; sourceId: string };
    }
  | {
      kind: "addBillboard";
      id: string;
      changes: Pick<
        SpatialBillboardSpec,
        "elevation" | "unitsPerPixel" | "castShadow" | "receiveShadow"
      >;
    }
  | {
      kind: "addModel";
      id: string;
      changes: Pick<
        SpatialModelInstanceSpec,
        | "asset"
        | "contentId"
        | "elevation"
        | "yawDegrees"
        | "scale"
        | "castShadow"
        | "receiveShadow"
      >;
    }
  | {
      kind: "updateTerrainSurface";
      id: string;
      changes: Partial<
        Pick<
          SpatialTerrainSurface,
          | "x"
          | "y"
          | "width"
          | "depth"
          | "elevation"
          | "endElevation"
          | "baseElevation"
          | "floorId"
        >
      >;
    }
  | {
      kind: "updateBillboard";
      id: string;
      changes: Partial<
        Pick<
          SpatialBillboardSpec,
          "elevation" | "unitsPerPixel" | "castShadow" | "receiveShadow"
        >
      >;
    }
  | {
      kind: "updateModel";
      id: string;
      changes: Partial<
        Pick<
          SpatialModelInstanceSpec,
          "elevation" | "yawDegrees" | "scale" | "castShadow" | "receiveShadow"
        >
      >;
    };

export interface SceneSpatialPatch {
  format: "ferrum2d.scene-spatial.patch";
  version: 1 | 2 | 3 | 4 | 5 | 6;
  operations: readonly SceneSpatialPatchOperation[];
}

const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
const fields = {
  setEnvironment: ["environment", "lightBindings"],
  setCamera: ["camera"],
  setBillboardNormalTexture: ["normalTexture"],
  replaceModelAsset: ["asset", "contentId"],
  renameReference: ["target", "nextId"],
  removeReference: ["target"],
  copyReference: ["target", "sourceId"],
  addBillboard: ["elevation", "unitsPerPixel", "castShadow", "receiveShadow"],
  addModel: [
    "asset",
    "contentId",
    "elevation",
    "yawDegrees",
    "scale",
    "castShadow",
    "receiveShadow",
  ],
  updateTerrainSurface: [
    "x",
    "y",
    "width",
    "depth",
    "elevation",
    "endElevation",
    "baseElevation",
    "floorId",
  ],
  updateBillboard: [
    "elevation",
    "unitsPerPixel",
    "castShadow",
    "receiveShadow",
  ],
  updateModel: [
    "elevation",
    "yawDegrees",
    "scale",
    "castShadow",
    "receiveShadow",
  ],
} as const;

/** Cold authoring operation: clone, apply the complete batch, then validate once. */
export function applySceneSpatialPatch(
  source: DataSceneSpatialSpec | undefined,
  patch: SceneSpatialPatch,
): DataSceneSpatialSpec {
  if (!source)
    throw new Error("spatial patch requires a spatial scene document");
  if (
    !patch ||
    patch.format !== "ferrum2d.scene-spatial.patch" ||
    (patch.version !== 1 &&
      patch.version !== 2 &&
      patch.version !== 3 &&
      patch.version !== 4 &&
      patch.version !== 5 &&
      patch.version !== 6) ||
    !Array.isArray(patch.operations)
  )
    throw new Error(
      "spatial patch requires format ferrum2d.scene-spatial.patch version 1, 2, 3, 4, 5 or 6 operations",
    );
  if (
    Object.keys(patch).some(
      (key) => !["format", "version", "operations"].includes(key),
    )
  )
    throw new Error("Unknown spatial patch field");
  const next = structuredClone(source);
  const operations: readonly SceneSpatialPatchOperation[] = patch.operations;
  for (const operation of operations) {
    if (
      !operation ||
      !hasOwn(fields, operation.kind) ||
      (operation.kind !== "setCamera" && operation.kind !== "setEnvironment" &&
        (typeof operation.id !== "string" || !operation.id.length)) ||
      !operation.changes ||
      typeof operation.changes !== "object" ||
      Array.isArray(operation.changes) ||
      (!Object.keys(operation.changes).length &&
        operation.kind !== "addBillboard") ||
      Object.keys(operation).some(
        (key) => !(["setCamera", "setEnvironment"].includes(operation.kind) ? ["kind", "changes"] : ["kind", "id", "changes"]).includes(key),
      )
    )
      throw new Error("Invalid spatial patch operation");
    if (operation.kind === "setEnvironment") {
      if (patch.version < 6 || Object.keys(operation.changes).some(key=>!["environment","lightBindings"].includes(key)) ||
          !hasOwn(operation.changes, "environment"))
        throw new Error("Environment replacement requires spatial patch version 6 and environment");
      if (operation.changes.environment === null) delete next.environment;
      else next.environment = resolveSpatialEnvironmentSpec(operation.changes.environment, "spatialPatch.environment");
      if (hasOwn(operation.changes, "lightBindings")) next.lightBindings = structuredClone(operation.changes.lightBindings);
      continue;
    }
    if (operation.kind === "setCamera") {
      if (patch.version < 5 || Object.keys(operation.changes).length !== 1 ||
          !hasOwn(operation.changes, "camera"))
        throw new Error("Camera replacement requires spatial patch version 5 and camera");
      next.camera = resolveSpatialCameraSpec(operation.changes.camera, "spatialPatch.camera");
      continue;
    }
    const addition =
      operation.kind === "addBillboard" || operation.kind === "addModel";
    if (addition && !operation.id.trim())
      throw new Error("Invalid spatial patch operation");
    if (addition && patch.version < 2)
      throw new Error(
        "Adding spatial references requires spatial patch version 2",
      );
    const allowed: readonly string[] = fields[operation.kind];
    const changes = operation.changes;
    if (operation.kind === "setBillboardNormalTexture") {
      const value = operation.changes.normalTexture;
      if (
        patch.version < 4 ||
        Object.keys(changes).length !== 1 ||
        !hasOwn(changes, "normalTexture") ||
        (value !== null &&
          (typeof value !== "string" ||
            !value.trim() ||
            value.trim() !== value ||
            value.length > 256))
      )
        throw new Error(
          "Normal texture reference requires spatial patch version 4 and a name or null",
        );
      if (!hasOwn(next.billboards, operation.id))
        throw new Error("Unknown billboard normal texture target");
      const target = next.billboards[operation.id];
      delete target.normalTexture;
      delete target.normalTextureId;
      if (value !== null) target.normalTexture = value;
      continue;
    }
    if (operation.kind === "replaceModelAsset") {
      if (
        patch.version < 3 ||
        Object.keys(changes).some((key) => !allowed.includes(key)) ||
        typeof operation.changes.asset !== "string" ||
        typeof operation.changes.contentId !== "string"
      )
        throw new Error(
          "Model reimport requires spatial patch version 3 asset/contentId",
        );
      const model = next.models?.[operation.id];
      if (!model) throw new Error("Unknown model reimport target");
      let changed = model.asset === operation.changes.asset;
      const lods = model.lods?.map((lod) => {
        if (lod.asset !== operation.changes.asset) return lod;
        changed = true;
        return { ...lod, contentId: operation.changes.contentId };
      });
      if (!changed)
        throw new Error("Model reimport cannot replace an unrelated asset ID");
      next.models = {
        ...next.models,
        [operation.id]: {
          ...model,
          ...(model.asset === operation.changes.asset
            ? { contentId: operation.changes.contentId }
            : {}),
          ...(lods ? { lods } : {}),
        },
      };
      continue;
    }
    if (
      operation.kind === "renameReference" ||
      operation.kind === "removeReference" ||
      operation.kind === "copyReference"
    ) {
      if (
        patch.version < 3 ||
        Object.keys(changes).some((key) => !allowed.includes(key)) ||
        (operation.changes.target !== "model" &&
          operation.changes.target !== "billboard")
      )
        throw new Error(
          "Invalid spatial reference migration; requires version 3",
        );
      const map =
        operation.changes.target === "billboard"
          ? next.billboards
          : (next.models ?? {});
      const sourceId =
        operation.kind === "copyReference"
          ? operation.changes.sourceId
          : operation.id;
      if (typeof sourceId !== "string" || !hasOwn(map, sourceId))
        throw new Error("Unknown spatial reference migration source");
      if (operation.kind === "removeReference")
        Reflect.deleteProperty(map, sourceId);
      else {
        const targetId =
          operation.kind === "renameReference"
            ? operation.changes.nextId
            : operation.id;
        if (
          typeof targetId !== "string" ||
          !targetId.trim() ||
          hasOwn(next.billboards, targetId) ||
          hasOwn(next.models ?? {}, targetId)
        )
          throw new Error(
            "Spatial reference migration destination already exists or is invalid",
          );
        const entry = structuredClone(map[sourceId]);
        if (operation.kind === "renameReference")
          Reflect.deleteProperty(map, sourceId);
        Object.defineProperty(map, targetId, {
          value: entry,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      continue;
    }
    for (const [key, value] of Object.entries(changes)) {
      if (!allowed.includes(key))
        throw new Error(
          `spatial.${operation.id}.${key}: unsupported placement field`,
        );
      if (key === "asset" || key === "contentId") {
        if (typeof value !== "string" || !value.trim())
          throw new Error(
            `spatial.${operation.id}.${key}: must be a nonempty string`,
          );
      } else if (key === "castShadow" || key === "receiveShadow") {
        if (typeof value !== "boolean")
          throw new Error(`spatial.${operation.id}.${key}: must be boolean`);
      } else if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`spatial.${operation.id}.${key}: must be finite`);
    }
    if (addition) {
      if (
        hasOwn(next.billboards, operation.id) ||
        hasOwn(next.models ?? {}, operation.id)
      )
        throw new Error(
          `spatial.${operation.id}: spatial reference already exists`,
        );
      if (operation.kind === "addBillboard")
        next.billboards = {
          ...next.billboards,
          [operation.id]: structuredClone(operation.changes),
        };
      else
        next.models = {
          ...next.models,
          [operation.id]: structuredClone(operation.changes),
        };
      continue;
    }
    const target =
      operation.kind === "updateTerrainSurface"
        ? next.terrain.find((surface) => surface.id === operation.id)
        : operation.kind === "updateBillboard"
          ? hasOwn(next.billboards, operation.id)
            ? next.billboards[operation.id]
            : undefined
          : next.models && hasOwn(next.models, operation.id)
            ? next.models[operation.id]
            : undefined;
    if (!target)
      throw new Error(
        `spatial.${operation.id}: unknown ${operation.kind} target`,
      );
    Object.assign(target, changes);
  }
  resolveDataSceneSpatialSpec(next, "spatialPatch.spatial");
  return next;
}

/** Stable sparse operations; returning to the baseline removes dirty state. */
export function diffSceneSpatialPatch(
  source: DataSceneSpatialSpec | undefined,
  next: DataSceneSpatialSpec | undefined,
  renames: ReadonlyMap<string, string> = new Map(),
  copySources: ReadonlyMap<string, string> = new Map(),
): SceneSpatialPatch | undefined {
  if (!source || !next) return undefined;
  const stable = (value: unknown): string =>
    JSON.stringify(
      value && typeof value === "object" && "billboards" in value
        ? { ...value, camera: resolveSpatialCameraSpec(Reflect.get(value, "camera")),
            environment: Reflect.get(value, "environment") === undefined ? undefined : resolveSpatialEnvironmentSpec(Reflect.get(value, "environment")),
            ...(!Object.keys(Reflect.get(value, "models") ?? {}).length ? { models: undefined } : {}),
            ...(!Object.keys(Reflect.get(value, "lightBindings") ?? {}).length ? { lightBindings: undefined } : {}) }
        : value,
      function (_key, item: unknown) {
        if (item && typeof item === "object" && !Array.isArray(item))
          return Object.fromEntries(
            Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
          );
        return item;
      },
    );
  const operations: SceneSpatialPatchOperation[] = [];
  const environment = next.environment === undefined ? null : resolveSpatialEnvironmentSpec(next.environment);
  const sourceEnvironment = source.environment === undefined ? null : resolveSpatialEnvironmentSpec(source.environment);
  if (stable(sourceEnvironment) !== stable(environment) || stable(source.lightBindings??{})!==stable(next.lightBindings??{}))
    operations.push({ kind: "setEnvironment", changes: { environment, ...(stable(source.lightBindings??{})!==stable(next.lightBindings??{})?{lightBindings:next.lightBindings??{}}:{}) } });
  const camera = resolveSpatialCameraSpec(next.camera);
  if (stable(resolveSpatialCameraSpec(source.camera)) !== stable(camera))
    operations.push({ kind: "setCamera", changes: { camera } });
  for (const target of ["billboard", "model"] as const) {
    const before =
      target === "billboard" ? source.billboards : (source.models ?? {});
    const after =
      target === "billboard" ? next.billboards : (next.models ?? {});
    const updateKind =
      target === "billboard" ? "updateBillboard" : "updateModel";
    const addKind = target === "billboard" ? "addBillboard" : "addModel";
    const editable: readonly string[] = fields[updateKind];
    const metadata = (value: object) =>
      JSON.stringify(
        Object.entries(value)
          .filter(
            ([key]) =>
              !editable.includes(key) &&
              key !== "contentId" &&
              (target !== "billboard" ||
                !["normalTexture", "normalTextureId"].includes(key)),
          )
          .map(([key, value]) => [
            key,
            key === "lods" && Array.isArray(value)
              ? value.map((lod) => ({ ...lod, contentId: undefined }))
              : value,
          ])
          .sort(([a], [b]) => String(a).localeCompare(String(b))),
      );
    // Copy immutable source metadata before any rename/removal consumes its key.
    for (const [id, entry] of Object.entries(after)) {
      if (
        hasOwn(before, id) ||
        [...renames].some(([old, name]) => name === id && hasOwn(before, old))
      )
        continue;
      const allowed: readonly string[] = fields[addKind];
      const addition =
        target === "billboard"
          ? Object.fromEntries(
              Object.entries(entry).filter(([key]) => key !== "normalTexture"),
            )
          : entry;
      if (Object.keys(addition).some((key) => !allowed.includes(key))) {
        const sourceId = copySources.get(id);
        const origin =
          sourceId && hasOwn(before, sourceId)
            ? ([sourceId, before[sourceId]] as const)
            : undefined;
        if (!origin)
          throw new Error("Spatial addition cannot invent source metadata");
        operations.push({
          kind: "copyReference",
          id,
          changes: { target, sourceId: origin[0] },
        });
        if (metadata(origin[1]) !== metadata(entry))
          throw new Error("Spatial copy cannot alter source metadata");
        appendUpdate(id, origin[1], entry, updateKind, editable);
      } else {
        operations.push({
          kind: addKind,
          id,
          changes: structuredClone(addition),
        } as SceneSpatialPatchOperation);
        if (target === "billboard")
          appendUpdate(id, {}, entry, "updateBillboard", []);
      }
    }
    for (const [id, entry] of Object.entries(before)) {
      const current = renames.get(id) ?? id;
      const value = after[current];
      if (!hasOwn(after, current)) {
        operations.push({ kind: "removeReference", id, changes: { target } });
        continue;
      }
      if (id !== current)
        operations.push({
          kind: "renameReference",
          id,
          changes: { target, nextId: current },
        });
      appendUpdate(current, entry, value, updateKind, editable);
    }
  }
  for (const surface of source.terrain) {
    const value = next.terrain.find((next) => next.id === surface.id);
    if (!value) throw new Error("Spatial placement cannot remove terrain");
    appendUpdate(
      surface.id,
      surface,
      value,
      "updateTerrainSurface",
      fields.updateTerrainSurface,
    );
  }
  function appendUpdate(
    id: string,
    before: object,
    after: object,
    kind: "updateBillboard" | "updateModel" | "updateTerrainSurface",
    editable: readonly string[],
  ) {
    if (
      kind === "updateBillboard" &&
      (Reflect.get(before, "normalTexture") !==
        Reflect.get(after, "normalTexture") ||
        Reflect.get(before, "normalTextureId") !==
          Reflect.get(after, "normalTextureId"))
    ) {
      if (Reflect.get(after, "normalTextureId") !== undefined)
        throw new Error(
          "Normal material edits require a stable texture name or detachment",
        );
      operations.push({
        kind: "setBillboardNormalTexture",
        id,
        changes: { normalTexture: Reflect.get(after, "normalTexture") ?? null },
      });
    }
    if (kind === "updateModel") {
      const refs = (value: object): object[] => [
        value,
        ...(Array.isArray(Reflect.get(value, "lods"))
          ? Reflect.get(value, "lods")
          : []),
      ];
      const previous = refs(before),
        next = refs(after);
      if (previous.length !== next.length)
        throw new Error("Model reimport cannot change LOD structure");
      const replacements = new Map<string, string>();
      previous.forEach((ref, index) => {
        const value = next[index];
        if (Reflect.get(ref, "asset") !== Reflect.get(value, "asset"))
          throw new Error("Model reimport preserves authored asset IDs");
        if (Reflect.get(ref, "contentId") !== Reflect.get(value, "contentId"))
          replacements.set(
            Reflect.get(value, "asset"),
            Reflect.get(value, "contentId"),
          );
      });
      for (const [asset, contentId] of replacements)
        operations.push({
          kind: "replaceModelAsset",
          id,
          changes: { asset, contentId },
        });
    }
    const changes: Record<string, number | boolean> = {};
    for (const key of editable) {
      const value: unknown = Reflect.get(after, key);
      if (
        value !== Reflect.get(before, key) &&
        (typeof value === "number" || typeof value === "boolean")
      )
        changes[key] = value;
    }
    if (Object.keys(changes).length)
      operations.push({ kind, id, changes } as SceneSpatialPatchOperation);
  }
  if (!operations.length) {
    if (stable(source) !== stable(next))
      throw new Error("Spatial draft contains unsupported metadata changes");
    return undefined;
  }
  const version = operations.some((op) => op.kind === "setEnvironment") ? 6 : operations.some((op) => op.kind === "setCamera") ? 5 : operations.some(
    (op) => op.kind === "setBillboardNormalTexture",
  )
    ? 4
    : operations.some((op) =>
          [
            "renameReference",
            "removeReference",
            "copyReference",
            "replaceModelAsset",
          ].includes(op.kind),
        )
      ? 3
      : operations.some(
            (op) => op.kind === "addBillboard" || op.kind === "addModel",
          )
        ? 2
        : 1;
  const patch: SceneSpatialPatch = {
    format: "ferrum2d.scene-spatial.patch",
    version,
    operations,
  };
  const applied = applySceneSpatialPatch(source, patch);
  if (stable(applied) !== stable(next))
    throw new Error("Spatial draft contains unsupported metadata changes");
  return patch;
}

export function sceneSpatialReferencesInstance(
  spatial: DataSceneSpatialSpec,
  id: string,
): boolean {
  return (
    hasOwn(spatial.billboards, id) ||
    hasOwn(spatial.models ?? {}, id) ||
    spatial.actor?.instanceId === id ||
    hasOwn(spatial.attachments ?? {}, id) ||
    hasOwn(spatial.lightBindings ?? {}, id) ||
    Object.values(spatial.attachments ?? {}).some(
      (attachment) => attachment.parent === id,
    )
  );
}
