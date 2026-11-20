/** @internal Callback identity/namespace admission, never callback evaluation.
 * File data names capabilities; trusted application registration supplies code. */
import type { FerrumEngine } from "./engineTypes.js";
import type { GameplayEntityHandle } from "./gameplayAuthoringTypes.js";
import { nativeFileEngineOwner } from "./nativeFileEngineOwner.js";
import { platformAssetFileOwner } from "./nativeFileResourceOwners.js";
import { ResourceBudget } from "./nativeFileResourceBudget.js";
import { inspectDataSceneAuthoringMetadata, nativeFileAuthoringDocumentBaseline } from "./dataSceneProgress.js";
import { SceneInstanceHandleRegistry, captureSceneInstanceRegistryMetadata, sceneInstanceRegistryMetadataUnchanged } from "./sceneInstanceHandles.js";
import {
  defineNativeFileHostBindingType, captureNativeFileHostBinding, captureNativeFileHostBindingFence,
  nativeFileHostBindingFenceUnchanged, prepareNativeFileHostBindings, resolvePreparedNativeFileHostBinding,
  consumePreparedNativeFileHostBindings, discardPreparedNativeFileHostBindings,
  type NativeFileHostBindingReference, type NativeFileHostBindingRequest, type PreparedNativeFileHostBindings,
} from "./nativeFileHostBindings.js";

type Texture = (name: string) => number;
type Exists = (handle: GameplayEntityHandle) => boolean;
export const nativeFileTextureResolverType = defineNativeFileHostBindingType<Texture>("authoring.texture-resolver", 1,
  (v, identity): v is Texture => typeof v === "function" && typeof identity === "function");
export const nativeFileEntityExistsType = defineNativeFileHostBindingType<Exists>("authoring.entity-exists", 1,
  (v, identity): v is Exists => typeof v === "function" && typeof identity === "function");
export interface NativeFileTextureName { readonly name: string; readonly id: number }
type Host = { readonly kind: "host"; readonly reference: NativeFileHostBindingReference };
export interface NativeFileAuthoringResolverTable {
  readonly version: 1;
  readonly textureNamespace: readonly NativeFileTextureName[] | null;
  readonly texture: { readonly kind: "none" | "default" | "canonical" } | Host;
  readonly entityExists: { readonly kind: "none" | "canonical" } | Host;
}
export interface NativeFileAuthoringResolverContext {
  readonly hostBindingOwner: object;
  readonly budget: ResourceBudget;
  readonly targetTextureNamespace?: readonly NativeFileTextureName[] | null;
}
export interface NativeFileAuthoringResolverCapture {
  readonly table: NativeFileAuthoringResolverTable;
  readonly fence: { assertCurrent(): void };
}
const captures = new WeakMap<NativeFileAuthoringResolverCapture, FerrumEngine>();
const marks = new WeakMap<FerrumEngine, { native: object; texture: Texture; exists: Exists }>();
function method(engine: FerrumEngine, key: "textureId" | "gameplayEntityExists"): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(engine, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
/** Factory-only mark after all actual SDK methods/native-owner registration. */
export function markNativeFileCanonicalResolvers(engine: FerrumEngine): void {
  const native = nativeFileEngineOwner(engine).native;
  if (marks.has(engine)) throw Error("Native-file resolvers already marked");
  const texture = method(engine,"textureId"), exists = method(engine,"gameplayEntityExists");
  if(typeof texture!=="function"||typeof exists!=="function")throw Error("Native-file canonical methods unavailable");
  marks.set(engine, { native, texture: texture as Texture, exists: exists as Exists });
}
function actual(engine: FerrumEngine) {
  const owner = nativeFileEngineOwner(engine), mark = marks.get(engine);
  if (!mark || mark.native !== owner.native || mark.texture !== method(engine,"textureId") || mark.exists !== method(engine,"gameplayEntityExists"))
    throw Error("Native-file canonical resolver identity changed");
  return { owner, mark };
}
export function actualNativeFileTextureNamespace(engine: FerrumEngine, budget: ResourceBudget): readonly NativeFileTextureName[] | null {
  const { owner } = actual(engine);
  budget.work(1);
  if (!owner.frame.assetHost) return null;
  const data = platformAssetFileOwner(owner.frame.assetHost).captureTextureNamespace(budget);
  budget.work(data.entries.length);
  return Object.freeze(data.entries.map(e => Object.freeze({ name: e.name, id: e.id })));
}
export function sameNativeFileTextureNamespace(a: readonly NativeFileTextureName[] | null, b: readonly NativeFileTextureName[] | null): boolean {
  return a === null ? b === null : b !== null && a.length === b.length && a.every((e, i) => e.name === b[i].name && e.id === b[i].id);
}
/** All data already produced by normal apply. No provider/callback retained in
 * the serialized payload, and no extra JSON progress capability is invented. */
export interface NativeFileApplySource {
  readonly epoch: number;
  readonly spatialRevision: number;
  readonly document: unknown;
  readonly templates: unknown;
  readonly handles: readonly { readonly instanceId: string; readonly handle: GameplayEntityHandle }[];
}
interface ApplyState { source: NativeFileApplySource; texture?: Texture; continuity: unknown }
const applySources = new WeakMap<FerrumEngine, ApplyState>();
export function rememberNativeFileApplySource(engine: FerrumEngine, document: unknown, templates: unknown, texture?: Texture): void {
  const guard = inspectDataSceneAuthoringMetadata(engine);
  if (!guard.continuity || guard.epoch === undefined || guard.spatialRevision === undefined) return;
  // Apply is cold and has already parsed these documents/specs. Keep its own
  // copy so caller/provider mutations after success cannot change file history.
  const detached = structuredClone({ document, templates });
  const source: NativeFileApplySource = { epoch: guard.continuity.epoch, spatialRevision: guard.spatialRevision,
    document: guard.progress ? JSON.parse(guard.progress.document) as unknown : nativeFileAuthoringDocumentBaseline(detached.document),
    templates: nativeFileAuthoringDocumentBaseline(detached.templates),
    handles: Object.entries(guard.continuity.handles).map(([instanceId, handle]) => ({ instanceId, handle: { ...handle } })) };
  applySources.set(engine, { source, texture, continuity: guard.continuity });
}
export function nativeFileApplySource(engine: FerrumEngine): NativeFileApplySource | undefined {
  const state = applySources.get(engine);
  return state?.continuity === inspectDataSceneAuthoringMetadata(engine).continuity ? state?.source : undefined;
}
export function attachNativeFileApplySource(engine: FerrumEngine, source: NativeFileApplySource | undefined, texture: Texture | undefined): void {
  if (!source) { applySources.delete(engine); return; }
  applySources.set(engine, { source, texture, continuity: inspectDataSceneAuthoringMetadata(engine).continuity });
}
export function captureNativeFileAuthoringResolverBindings(engine: FerrumEngine, registry: SceneInstanceHandleRegistry | undefined, budget: ResourceBudget, hostOwner: object = engine): NativeFileAuthoringResolverCapture {
  const { owner, mark } = actual(engine), guard = inspectDataSceneAuthoringMetadata(engine), revision = guard.revision;
  const host = owner.frame.assetHost, asset = host && platformAssetFileOwner(host), assetRevision = asset?.textureNamespaceRevision();
  const hostFence = captureNativeFileHostBindingFence(hostOwner), namespace = actualNativeFileTextureNamespace(engine, budget);
  budget.work(4);
  const state = registry && captureSceneInstanceRegistryMetadata(registry, 4096, true), apply = applySources.get(engine);
  const classifyTexture = (present: boolean, texture?: Texture) => !present ? { kind: "none" as const } : texture === undefined ? { kind: "default" as const }
    : texture === mark.texture ? { kind: "canonical" as const }
    : { kind: "host" as const, reference: captureNativeFileHostBinding(hostOwner, nativeFileTextureResolverType, texture) };
  const hasApply = apply !== undefined && apply.continuity === guard.continuity;
  const texture = classifyTexture(!!guard.progress || hasApply, guard.progress ? guard.progress.textureId : hasApply ? apply.texture : undefined);
  const entityExists = !state?.entityExists ? { kind: "none" as const } : state.entityExists === mark.exists ? { kind: "canonical" as const }
    : { kind: "host" as const, reference: captureNativeFileHostBinding(hostOwner, nativeFileEntityExistsType, state.entityExists) };
  for (const entry of [texture, entityExists]) if (entry.kind === "host") { budget.metadata(entry.reference.kind); budget.metadata(entry.reference.symbol); }
  const table = Object.freeze({ version: 1 as const, textureNamespace: namespace, texture: Object.freeze(texture), entityExists: Object.freeze(entityExists) });
  const fence = Object.freeze({ assertCurrent() {
    actual(engine);
    if (host !== owner.frame.assetHost || host && platformAssetFileOwner(host) !== asset || asset?.textureNamespaceRevision() !== assetRevision
      || !nativeFileHostBindingFenceUnchanged(hostOwner, hostFence) || revision !== inspectDataSceneAuthoringMetadata(engine).revision
      || registry && !sceneInstanceRegistryMetadataUnchanged(registry, state!.revision)
      || !sameNativeFileTextureNamespace(namespace, actualNativeFileTextureNamespace(engine, budget))) budget.fail("STALE", "authoring source resolver");
  } });
  const result = Object.freeze({ table, fence }); captures.set(result, engine); fence.assertCurrent(); return result;
}
export function assertNativeFileResolverCapture(engine: FerrumEngine, capture: NativeFileAuthoringResolverCapture): void {
  if (captures.get(capture) !== engine) throw Error("Native-file foreign resolver capture");
  capture.fence.assertCurrent();
}
export interface PreparedAuthoringResolvers {
  readonly table: NativeFileAuthoringResolverTable;
  attach(engine: FerrumEngine): { texture?: Texture; exists?: Exists };
  discard(): void;
}
/** Caller has detached and structurally bounded the DTO first. Same common
 * budget is passed through: no per-participant allowance reset. */
export function prepareAuthoringResolvers(table: NativeFileAuthoringResolverTable, context: NativeFileAuthoringResolverContext): PreparedAuthoringResolvers {
  const { budget, hostBindingOwner } = context;
  budget.work(1);
  if (table.version !== 1) budget.fail("DATA", "resolver table version");
  const rows = table.textureNamespace;
  if (rows !== null) {
    if (!Array.isArray(rows) || rows.length > 4096) budget.fail("DATA", "texture namespace");
    budget.work(rows.length * 3);
    const names = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const e = rows[i];
      if (typeof e.name !== "string" || !e.name.trim() || e.id !== i + 1 || names.has(e.name)) budget.fail("DATA", "texture namespace row");
      budget.metadata(e.name); names.add(e.name);
    }
  }
  if (context.targetTextureNamespace !== undefined) {
    budget.work((context.targetTextureNamespace?.length ?? 0) + (rows?.length ?? 0));
    if (!sameNativeFileTextureNamespace(rows, context.targetTextureNamespace)) budget.fail("DATA", "target texture namespace");
  }
  const requests: NativeFileHostBindingRequest[] = [];
  for (const [entry, type, valid] of [[table.texture, nativeFileTextureResolverType, ["none", "default", "canonical", "host"]], [table.entityExists, nativeFileEntityExistsType, ["none", "canonical", "host"]]] as const) {
    if (!entry || !valid.some(v => v === entry.kind)) budget.fail("DATA", "resolver kind");
    if (entry.kind === "host") requests.push({ type, reference: entry.reference });
  }
  let batch: PreparedNativeFileHostBindings | undefined = prepareNativeFileHostBindings(hostBindingOwner, requests, budget);
  return { table, discard() { if (batch) discardPreparedNativeFileHostBindings(hostBindingOwner, batch); batch = undefined; }, attach(engine) {
    if (!batch) budget.fail("STALE", "resolver preparation consumed");
    const admitted = batch!;
    const { mark } = actual(engine), current = actualNativeFileTextureNamespace(engine, budget);
    budget.work((current?.length ?? 0) + (rows?.length ?? 0));
    if (!sameNativeFileTextureNamespace(rows, current)) budget.fail("STALE", "actual target texture namespace");
    const texture = table.texture.kind === "canonical" ? mark.texture : table.texture.kind === "host" ? resolvePreparedNativeFileHostBinding(hostBindingOwner, admitted, nativeFileTextureResolverType, table.texture.reference.symbol) : undefined;
    const exists = table.entityExists.kind === "canonical" ? mark.exists : table.entityExists.kind === "host" ? resolvePreparedNativeFileHostBinding(hostBindingOwner, admitted, nativeFileEntityExistsType, table.entityExists.reference.symbol) : undefined;
    consumePreparedNativeFileHostBindings(hostBindingOwner, admitted); batch = undefined;
    return { texture, exists };
  } };
}
