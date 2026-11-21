/** @internal Whole-file coordinator prototype. No public barrel/export, default
 * loop migration or file-supplied code. All new targets remain stopped. */
import type { CreateEngineOptions, FerrumEngine, AssetHost, InputProvider, ViewportProvider } from "./engineTypes.js";
import { createDetachedEngineFacade, type EngineFramePipelineHandlers } from "./createEngine.js";
import { nativeFileEngineOwner } from "./nativeFileEngineOwner.js";
import type { DetachedEngineMetadata } from "./nativeFileEngineOwner.js";
import { ResourceBudget, NativeFileResourceError, type NativeFileResourceLimits } from "./nativeFileResourceBudget.js";
import { captureNativeFileCut, NativeFileUnpublishedTarget, type NativeFileSdkSections, type NativeFileNativeOptions } from "./nativeFileRuntimeNative.js";
import { captureNativeFileRuntimeHost, admitNativeFileRuntimeHost, inspectNativeFileRuntimeHost, consumeNativeFileRuntimeHost, discardNativeFileRuntimeHost, registerNativeFileRuntimeHostBinding, type InspectedNativeFileRuntimeHost, type AdmittedNativeFileRuntimeHost, type NativeFileRuntimeHostRole } from "./nativeFileRuntimeHost.js";
import { captureNativeFileResourceSession, prepareNativeFileResourceSession } from "./nativeFileResourceSession.js";
import { captureNativeFileDialogueQuest, nativeFileDialogueQuestFenceUnchanged, prepareNativeFileDialogueQuest, consumePreparedNativeFileDialogueQuest, discardPreparedNativeFileDialogueQuest, registerNativeFileDialogueQuest, type PreparedNativeFileDialogueQuest, type NativeFileDialogueQuestGraph } from "./nativeFileDialogueQuest.js";
import { admitNativeFileAuthoringBindings, attachAdmittedNativeFileAuthoringBindings, captureNativeFileAuthoringBindingsFromFacts, DEFAULT_NATIVE_FILE_AUTHORING_LIMITS, type AdmittedNativeFileAuthoringBindings } from "./nativeFileAuthoringBindings.js";
import { admitNativeFileVariableBindings, attachAdmittedNativeFileVariableBindings, captureDataSceneVariableBindings } from "./dataSceneVariables.js";
import { captureNativeFileAuthoringResolverBindings, nativeFileTextureResolverType, nativeFileEntityExistsType, type NativeFileAuthoringResolverTable } from "./nativeFileAuthoringResolvers.js";
import { resolveNativeFileHostBinding, registerNativeFileHostBinding } from "./nativeFileHostBindings.js";
import type { SceneInstanceHandleRegistry } from "./sceneInstanceHandles.js";
import { encodeRuntimeMetadata, decodeRuntimeMetadata, reserveRuntimeAuthoring, reserveRuntimeVariables, assertRuntimeBytes } from "./nativeFileRuntimeMetadata.js";

type ResourceLease = Awaited<ReturnType<typeof prepareNativeFileResourceSession>>;
type FontPublication = ReturnType<ResourceLease["fontPublication"]>;
const bindingOwners = new WeakMap<object, () => object>();
/** @internal Public facade's trusted registration seam. No Engine/namespace or
 * installation capability is returned and file data cannot manufacture a key. */
export function nativeFileRuntimeSessionBindingOwner(session: object): object {
  const read = bindingOwners.get(session);
  if (!read) throw new NativeFileResourceError("CAPABILITY", "actual runtime session owner");
  return read();
}
export interface NativeFileRuntimePlatform {
  /** Every referenced role needs an explicitly NEW target adapter. Old renderer
   * callbacks/resolved values are never automatically transplanted. */
  readonly callbacks?: Readonly<Partial<Record<NativeFileRuntimeHostRole, object>>>;
  readonly assetHost?: AssetHost;
  /** Register target-only external fonts/capabilities before resource preparation. */
  configure?(engine: FerrumEngine, budget: ResourceBudget): void | Promise<void>;
  /** Trusted readonly check, outside the synchronous publication section. */
  validate?(engine: FerrumEngine, budget: ResourceBudget): void;
  assertCurrent?(): void;
  /** New platform ownership only; never a borrowed old renderer/host. */
  dispose(): void | Promise<void>;
}
export interface NativeFileRuntimeSessionOptions {
  readonly bindingOwner?: object;
  readonly registry?: SceneInstanceHandleRegistry;
  readonly limits?: Partial<NativeFileResourceLimits>;
  /** Shared public creation ledger; absent preserves standalone construction. */
  readonly creationBudget?: ResourceBudget;
  readonly native?: NativeFileNativeOptions;
  readonly preparePlatform?: (host: InspectedNativeFileRuntimeHost, target: NativeFileUnpublishedTarget, budget: ResourceBudget) => NativeFileRuntimePlatform | Promise<NativeFileRuntimePlatform>;
  /** Explicit opt-in for BORROWED initial resources, invoked only after success. */
  readonly initialCleanup?: () => void | Promise<void>;
}
export interface NativeFileRuntimeReady { readonly kind: "native-file-runtime-session-ready" }
export interface NativeFileRuntimeCommit { readonly epoch: number; readonly audio: ReturnType<ResourceLease["activateAudio"]>; readonly cleanupErrors: readonly unknown[] }
interface Scope {
  readonly engine: FerrumEngine; readonly bindingOwner: object; readonly registry?: SceneInstanceHandleRegistry;
  readonly owned?: { target: NativeFileUnpublishedTarget; platform: NativeFileRuntimePlatform; resources: ResourceLease; graph: NativeFileDialogueQuestGraph };
  readonly initialCleanup?: () => void | Promise<void>;
}
interface ReadyPlan {
  readonly target: NativeFileUnpublishedTarget; readonly engine: FerrumEngine; readonly platform: NativeFileRuntimePlatform;
  readonly resources: ResourceLease; readonly host: AdmittedNativeFileRuntimeHost; readonly hostView: InspectedNativeFileRuntimeHost;
  readonly authoring: AdmittedNativeFileAuthoringBindings; readonly resolverTable?: NativeFileAuthoringResolverTable; readonly dialogueQuest: PreparedNativeFileDialogueQuest;
  /** General runtime/authoring/DQ capability owner is distinct from the actual
   * facade's font-resource registry, whose revision is already leased. */
  readonly nextBindingOwner: object; readonly resolver: object; readonly scope: Scope; readonly epoch: number; readonly budget: ResourceBudget;
  readonly fence: () => void; readonly activateLifecycle: () => void;
}
const dummy = (): NativeFileSdkSections => {
  const bytes = new Uint8Array([123,125]);
  return { variables: bytes, authoring: bytes, resourceManifest: bytes, resourceData: bytes, dialogueQuest: bytes, hostBindings: bytes };
};
function destroyGraph(graph: NativeFileDialogueQuestGraph): void {
  for (const d of graph.dialogues) d.destroy(); for (const q of graph.quests) q.destroy();
}
function platformOptions(host: InspectedNativeFileRuntimeHost, platform: NativeFileRuntimePlatform, b: ResourceBudget) {
  b.work(128); b.charge("decodedBytes", 32 * 1024 * 1024);
  const options = { ...host.optionsData } as Record<string, unknown>, frame = { ...host.frameData } as Record<string, unknown>;
  if (options.lifecycle !== undefined) options.lifecycle = { ...options.lifecycle as object };
  if (options.effectEvents && typeof options.effectEvents === "object") options.effectEvents = { ...options.effectEvents as object };
  const expected = new Set(host.resolvedReferences.map(r => r.role));
  for (const key of Object.keys(platform.callbacks ?? {})) if (!expected.has(key as NativeFileRuntimeHostRole)) b.fail("CAPABILITY", "unrequested platform callback");
  let activated = false;
  const registrations: { role: NativeFileRuntimeHostRole; symbol: string; value: object; identity: object }[] = [];
  for (const row of host.resolvedReferences) {
    const descriptor = platform.callbacks && Object.getOwnPropertyDescriptor(platform.callbacks, row.role), value = descriptor && "value" in descriptor ? descriptor.value as unknown : undefined;
    if (row.role === "options.effectEvents.target" ? !value || typeof value !== "object" : typeof value !== "function") b.fail("CAPABILITY", `new target callback ${row.role}`);
    let identity = value as object;
    if (row.role.startsWith("options.lifecycle.")) {
      const callback = value as (...args: unknown[]) => unknown;
      identity = (...args: unknown[]) => { if (activated) return callback(...args); };
    }
    const [root, key, child] = row.role.split(".");
    if (root === "frame") frame[key] = identity;
    else (options[key] as Record<string, unknown>)[child] = identity;
    registrations.push({ role: row.role, symbol: row.reference.symbol, value: value as object, identity });
  }
  return { options: options as CreateEngineOptions, handlers: { onFrame: frame.onFrame, onRenderFrame: frame.onRenderFrame,
    needsFrameState: frame.needsFrameState, needsPhysicsDebugLineBuffer: frame.needsPhysicsDebugLineBuffer } as EngineFramePipelineHandlers,
    input: frame.inputProvider as InputProvider | undefined, viewport: frame.viewportProvider as ViewportProvider | undefined,
    registrations, activateLifecycle: () => { activated = true; } };
}

export function createNativeFileRuntimeSession(initialEngine: FerrumEngine, wasmBytes: Uint8Array, options: NativeFileRuntimeSessionOptions = {}) {
  nativeFileEngineOwner(initialEngine);
  let scope: Scope = { engine: initialEngine, bindingOwner: options.bindingOwner ?? initialEngine, registry: options.registry, initialCleanup: options.initialCleanup };
  let epoch = 0, busy = false, disposed = false;
  const ready = new Map<NativeFileRuntimeReady, ReadyPlan>();
  const cleanupErrors: unknown[] = [];
  // Isolate the supplied binary from later caller mutation. No module eval/import.
  const wasm = (options.creationBudget ?? new ResourceBudget(options.limits)).bytes(wasmBytes, "sourceBytes");
  function error(field: string): never { throw new NativeFileResourceError("STALE", field); }
  const enter = () => { if (disposed) error("session disposed"); if (busy) throw new NativeFileResourceError("BUSY", "session operation"); busy = true; };
  const budget = (b?: ResourceBudget) => b ?? new ResourceBudget(options.limits);
  const clean = async (actions: readonly (() => void | Promise<void>)[]) => { for (const action of actions) try { await action(); } catch (e) { cleanupErrors.push(e); } };
  const cleanupPlan = async (p: ReadyPlan) => {
    discardNativeFileRuntimeHost(p.resolver, p.host);
    await clean([() => discardPreparedNativeFileDialogueQuest(p.resolver, p.dialogueQuest), () => p.resources.dispose(), () => p.engine.destroy(), () => p.platform.dispose(), () => p.target.dispose()]);
  };
  const cleanupScope = async (s: Scope) => {
    if (s.owned) await clean([() => destroyGraph(s.owned!.graph), () => s.owned!.resources.dispose(), () => s.engine.destroy(), () => s.owned!.platform.dispose(), () => s.owned!.target.dispose()]);
    else if (s.initialCleanup) await clean([s.initialCleanup]);
  };
  const sourceCut = async (s: Scope, at: number, b: ResourceBudget, repack: boolean) => {
    const owner = nativeFileEngineOwner(s.engine), dummies = dummy(), before = captureNativeFileCut(owner.native, dummies, b, options.native);
    let target: NativeFileUnpublishedTarget | undefined;
    try {
      target = await NativeFileUnpublishedTarget.prepare(wasm, before, b, options.native);
      const host = captureNativeFileRuntimeHost(s.engine, b, s.bindingOwner), resources = await captureNativeFileResourceSession(s.engine, b), dq = captureNativeFileDialogueQuest(s.bindingOwner, b);
      reserveRuntimeVariables(b); const variables = encodeRuntimeMetadata(captureDataSceneVariableBindings(s.engine), b, "variables");
      const resolverCapture = captureNativeFileAuthoringResolverBindings(s.engine, s.registry, b, s.bindingOwner);
      reserveRuntimeAuthoring(b); const authoring = encodeRuntimeMetadata(captureNativeFileAuthoringBindingsFromFacts(s.engine, s.registry, target.facts, resources.authoringResources, DEFAULT_NATIVE_FILE_AUTHORING_LIMITS, resolverCapture), b, "authoring");
      const facts = target.facts;
      const fence = () => {
        if (scope !== s || epoch !== at || disposed || nativeFileEngineOwner(s.engine) !== owner) b.fail("STALE", "source session/epoch");
        host.assertCurrent(); resources.assertCurrent(); resolverCapture.fence.assertCurrent(); if (!nativeFileDialogueQuestFenceUnchanged(s.bindingOwner, dq.fence, b)) b.fail("STALE", "source dialogue/quest");
        reserveRuntimeVariables(b); assertRuntimeBytes(variables, encodeRuntimeMetadata(captureDataSceneVariableBindings(s.engine), b, "variables"), b, "source variable metadata");
        reserveRuntimeAuthoring(b); assertRuntimeBytes(authoring, encodeRuntimeMetadata(captureNativeFileAuthoringBindingsFromFacts(s.engine, s.registry, facts, resources.authoringResources, DEFAULT_NATIVE_FILE_AUTHORING_LIMITS, resolverCapture), b, "authoring"), b, "source authoring metadata");
        // Last source read after host/resource callbacks: exact original Engine cut.
        assertRuntimeBytes(before, captureNativeFileCut(owner.native, dummies, b, options.native), b, "source native capture cut");
      };
      fence();
      const file = repack ? target.repackSdkSections({ variables, authoring, resourceManifest: resources.manifestBytes, resourceData: resources.dataBytes, dialogueQuest: dq.bytes, hostBindings: host.bytes }) : undefined;
      return { file, fence };
    } finally { target?.dispose(); }
  };
  const api = {
    current: (): FerrumEngine => { if (disposed) error("session disposed"); return scope.engine; },
    epoch: (): number => epoch,
    registry: (): SceneInstanceHandleRegistry | undefined => scope.registry,
    dialogueQuest: (): NativeFileDialogueQuestGraph | undefined => scope.owned?.graph,
    cleanupErrors: (): readonly unknown[] => Object.freeze([...cleanupErrors]),
    async capture(inputBudget?: ResourceBudget): Promise<Uint8Array> {
      enter(); try { const cut = await sourceCut(scope, epoch, budget(inputBudget), true); return cut.file!; } finally { busy = false; }
    },
    async prepare(file: Uint8Array, inputBudget?: ResourceBudget): Promise<NativeFileRuntimeReady> {
      enter(); const b = budget(inputBudget), start = scope, at = epoch;
      let target: NativeFileUnpublishedTarget | undefined, hostToken: AdmittedNativeFileRuntimeHost | undefined, platform: NativeFileRuntimePlatform | undefined, engine: FerrumEngine | undefined, resources: ResourceLease | undefined, dq: PreparedNativeFileDialogueQuest | undefined;
      try {
        if (ready.size) b.fail("BUSY", "discard pending target before preparing another");
        if (epoch >= Number.MAX_SAFE_INTEGER) b.fail("LIMIT", "session epoch exhausted");
        const source = await sourceCut(start, at, b, false);
        target = await NativeFileUnpublishedTarget.prepare(wasm, file, b, options.native); const sections = target.sdkSections(), owner = target.placeholderBridge.engine();
        hostToken = admitNativeFileRuntimeHost(start.bindingOwner, sections.hostBindings, b); const hostView = inspectNativeFileRuntimeHost(start.bindingOwner, hostToken);
        platform = options.preparePlatform ? await options.preparePlatform(hostView, target, b) : { dispose() {} };
        const config = platformOptions(hostView, platform, b);
        engine = await createDetachedEngineFacade(target.placeholderBridge, hostView.metadata as DetachedEngineMetadata, config.handlers, config.input, platform.assetHost, config.viewport, config.options);
        await platform.configure?.(engine, b);
        resources = await prepareNativeFileResourceSession(engine, sections.resourceManifest, sections.resourceData, b);
        reserveRuntimeVariables(b); const variables = admitNativeFileVariableBindings(owner, decodeRuntimeMetadata(sections.variables, b, "variables"), target.facts.variableLayout);
        reserveRuntimeAuthoring(b); const authoringValue = decodeRuntimeMetadata(sections.authoring, b, "authoring"), authoring = admitNativeFileAuthoringBindings(owner, authoringValue, target.facts, resources.authoringResources, DEFAULT_NATIVE_FILE_AUTHORING_LIMITS, { hostBindingOwner: start.bindingOwner, budget: b });
        const resolverTable = (authoringValue as { resolvers?: NativeFileAuthoringResolverTable }).resolvers;
        dq = prepareNativeFileDialogueQuest(start.bindingOwner, sections.dialogueQuest, b, undefined, { targetNamespace: target.namespace });
        // ALL six SDK sections have now passed their actual participants. Only
        // here may the sealed file Engine replace the private placeholder.
        resources.assertCurrent(); inspectNativeFileRuntimeHost(start.bindingOwner, hostToken); source.fence();
        target.installAfterSdkAdmission(); attachAdmittedNativeFileVariableBindings(owner, engine, variables);
        const token = Object.freeze({ kind: "native-file-runtime-session-ready" as const });
        const plan: ReadyPlan = { target, engine, platform, resources, host: hostToken, hostView, authoring, resolverTable, dialogueQuest: dq, nextBindingOwner: {}, resolver: start.bindingOwner, scope: start, epoch: at, budget: b, fence: source.fence, activateLifecycle: config.activateLifecycle };
        // Registrations are deferred until commit and remain new-target-only.
        registrations.set(token, config.registrations); ready.set(token, plan); return token;
      } catch (e) {
        if (hostToken) discardNativeFileRuntimeHost(start.bindingOwner, hostToken);
        await clean([() => { if (dq) discardPreparedNativeFileDialogueQuest(start.bindingOwner, dq); }, () => resources?.dispose(), () => engine?.destroy(), () => platform?.dispose(), () => target?.dispose()]); throw e;
      } finally { busy = false; }
    },
    async commit(token: NativeFileRuntimeReady): Promise<NativeFileRuntimeCommit> {
      enter(); const p = ready.get(token); let publication: FontPublication, graph: NativeFileDialogueQuestGraph | undefined, provisional = false;
      try {
        if (!p || p.scope !== scope || p.epoch !== epoch) error("foreign/consumed/stale ready");
        ready.delete(token);
        p.resources.assertCurrent(); p.platform.assertCurrent?.(); inspectNativeFileRuntimeHost(p.resolver, p.host);
        publication = p.resources.fontPublication(); p.resources.assertCurrent();
        p.resources.adopt();
        p.platform.validate?.(p.engine, p.budget);
        const registry = attachAdmittedNativeFileAuthoringBindings(p.target.placeholderBridge.engine(), p.engine, p.authoring);
        // Opaque custom resolver code remains an explicitly registered borrowed
        // capability. Re-register that admitted identity for future captures;
        // no callback evaluation or implicit target renderer adaptation occurs.
        if (p.resolverTable?.texture.kind === "host") {
          const ref = p.resolverTable.texture.reference, value = resolveNativeFileHostBinding(p.resolver, nativeFileTextureResolverType, ref);
          registerNativeFileHostBinding(p.nextBindingOwner, nativeFileTextureResolverType, ref.symbol, value);
        }
        if (p.resolverTable?.entityExists.kind === "host") {
          const ref = p.resolverTable.entityExists.reference, value = resolveNativeFileHostBinding(p.resolver, nativeFileEntityExistsType, ref);
          registerNativeFileHostBinding(p.nextBindingOwner, nativeFileEntityExistsType, ref.symbol, value);
        }
        graph = consumePreparedNativeFileDialogueQuest(p.resolver, p.dialogueQuest, p.budget);
        for (const row of graph.bindings) registerNativeFileDialogueQuest(p.nextBindingOwner, row.symbol, row.value);
        for (const row of registrations.get(token) ?? []) registerNativeFileRuntimeHostBinding(p.nextBindingOwner, row.role, row.symbol, row.value, row.identity);
        consumeNativeFileRuntimeHost(p.resolver, p.host);
        p.fence();
        const previous = scope, previousEpoch = epoch;
        let audio: ReturnType<ResourceLease["activateAudio"]>;
        try {
          // Synchronous critical section: no await or application callback.
          publication?.apply();
          scope = { engine: p.engine, bindingOwner: p.nextBindingOwner, registry, owned: { target: p.target, platform: p.platform, resources: p.resources, graph } }; epoch = previousEpoch + 1; provisional = true;
          audio = p.resources.activateAudio(); publication?.commit(); p.activateLifecycle();
        } catch (e) {
          scope = previous; epoch = previousEpoch; provisional = false;
          try { publication?.rollback(); } catch (rollbackError) { cleanupErrors.push(rollbackError); } throw e;
        }
        registrations.delete(token);
        await cleanupScope(previous);
        return Object.freeze({ epoch, audio, cleanupErrors: Object.freeze([...cleanupErrors]) });
      } catch (e) {
        if (p && !provisional) { ready.delete(token); if (graph) await clean([() => destroyGraph(graph!)]); await cleanupPlan(p); }
        registrations.delete(token); throw e;
      } finally { busy = false; }
    },
    async discard(token: NativeFileRuntimeReady): Promise<void> {
      enter(); try { const p = ready.get(token); if (!p) error("foreign/consumed ready"); ready.delete(token); registrations.delete(token); await cleanupPlan(p); } finally { busy = false; }
    },
    async dispose(): Promise<void> {
      if (disposed) return; enter(); try { disposed = true; for (const [token, p] of ready) { ready.delete(token); registrations.delete(token); await cleanupPlan(p); } if (scope.owned) await cleanupScope(scope); } finally { busy = false; }
    },
  };
  const registrations = new WeakMap<NativeFileRuntimeReady, ReturnType<typeof platformOptions>["registrations"]>();
  bindingOwners.set(api, () => { if (disposed) error("session disposed"); return scope.bindingOwner; });
  return Object.freeze(api);
}
