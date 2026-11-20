import "./nativeRuntimeTestHelper.js";
import { test } from "node:test";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { NativeFilePrepare } from "../pkg/ferrum_core.js";
import { createEngine, createDetachedEngineFacade } from "../src/createEngine.js";
import { WasmBridge } from "../src/wasmBridge.js";
import { captureDetachedEngineMetadata, nativeFileEngineOwner } from "../src/nativeFileEngineOwner.js";
import { ResourceBudget } from "../src/nativeFileResourceBudget.js";
import { AssetLoader } from "../src/assetLoader.js";
import { assetFileOwner, registerPlatformAssetFileOwner, forgetPlatformAssetFileOwner } from "../src/nativeFileResourceOwners.js";
import { TextureRegistry } from "../src/textureRegistry.js";
import { readNativeFileNativeFacts } from "../src/nativeFileNativeFacts.js";
import { encodeNativeFileResourceGraph, decodeNativeFileResourceGraph } from "../src/nativeFileResourceCodec.js";
import { captureNativeFileAuthoringResolverBindings, nativeFileTextureResolverType, nativeFileEntityExistsType } from "../src/nativeFileAuthoringResolvers.js";
import { admitNativeFileAuthoringBindings, attachAdmittedNativeFileAuthoringBindings, captureNativeFileAuthoringBindingsFromFacts, type NativeFileAuthoringBindings } from "../src/nativeFileAuthoringBindings.js";
import { registerNativeFileHostBinding, unregisterNativeFileHostBinding } from "../src/nativeFileHostBindings.js";
import { SceneInstanceHandleRegistry } from "../src/sceneInstanceHandles.js";
import { applyDataSceneAuthoringDocument } from "../src/dataSceneRuntimeTarget.js";
import { inspectDataSceneAuthoringMetadata } from "../src/dataSceneProgress.js";
import type { FerrumEngine, AssetHost } from "../src/engineTypes.js";
const resources = Object.freeze({ textures: [], models: [] });
function document(template = false, clipId = 3) {
  const spec = { visual: { kind: "sprite" as const, texture: "hero", width: 2, height: 3, animationSet: { clips: [{ id: clipId, fps: 4, frames: [{ u0: 0, v0: 0, u1: 1, v1: 1 }] }] } }, collider: "none" as const, layer: "wall" as const };
  return { spec, doc: { format: "ferrum2d.consumer.scene-authoring", version: 1, sceneComposition: { initialFragment: "main", prefabs: { body: {} }, fragments: { main: { instances: [{ id: "hero", prefab: "body", props: { components: template ? { template: "body" } : spec } }] } } }, behaviorRecipes: { entities: {} } } };
}
function assets() {
  const registry = new TextureRegistry(), manager = { async loadTexture() { return {}; }, evictTexture() { return true; } };
  const loader = new AssetLoader(manager, undefined, registry);
  registry.reserve("hero", "hero.png"); registry.reserve("unloaded", "unloaded.png");
  const host: AssetHost = { loadAssets: (...args) => loader.loadAssets(...args), textureId: name => loader.textureId(name) };
  registerPlatformAssetFileOwner(host, loader, () => true);
  return { loader, registry, host, close() { forgetPlatformAssetFileOwner(host); assetFileOwner(loader).dispose(); } };
}
function nativeBytes(e: FerrumEngine) { return nativeFileEngineOwner(e).native.capture_native_file(new TextEncoder().encode("{}{}{}{}{}{}"), new Uint32Array([2, 2, 2, 2, 2, 2]), 0, 0, new Uint32Array()); }
async function staged(source: FerrumEngine) {
  const file = nativeBytes(source), bridge = await WasmBridge.init(), owner = bridge.engine();
  const prepared = new NativeFilePrepare(owner, file, 0, 0, new Uint32Array());
  const packet = prepared.metadata(), facts = readNativeFileNativeFacts(packet, new ResourceBudget());
  return { file, owner, facts, packet, bridge, prepared };
}
function transfer(value: unknown) { const b = new ResourceBudget(), bytes = encodeNativeFileResourceGraph(value, b); return decodeNativeFileResourceGraph(bytes.manifestBytes, bytes.dataBytes, b) as NativeFileAuthoringBindings; }
async function attachTarget(source: FerrumEngine, stage: Awaited<ReturnType<typeof staged>>, snapshot: NativeFileAuthoringBindings, targetAssets: ReturnType<typeof assets>, bindingOwner: object = source) {
  const budget = new ResourceBudget();
  const token = admitNativeFileAuthoringBindings(stage.owner, transfer(snapshot), stage.facts, resources, {}, { hostBindingOwner: bindingOwner, budget,
    targetTextureNamespace: assetFileOwner(targetAssets.loader).captureTextureNamespace(budget).entries.map(e => ({ id: e.id, name: e.name })) });
  equal(stage.owner.install_native_file_prepare(stage.prepared), 0);
  const target = await createDetachedEngineFacade(stage.bridge, captureDetachedEngineMetadata(nativeFileEngineOwner(source)), {}, undefined, targetAssets.host);
  try { return { target, registry: attachAdmittedNativeFileAuthoringBindings(stage.owner, target, token), token }; }
  catch (error) { target.destroy(); throw error; }
}

test("actual NativePrepare→codec→pure admit→actual detached attach preserves canonical functions and unloaded reservation namespace", async () => {
  const a = assets(), b = assets(), source = await createEngine(undefined, undefined, a.host);
  let target: FerrumEngine | undefined;
  try {
    const registry = new SceneInstanceHandleRegistry({ entityExists: source.gameplayEntityExists });
    const applied = applyDataSceneAuthoringDocument(source, document().doc, { textureId: source.textureId, instanceHandleRegistry: registry });
    registry.set("unknown", { entityId: 999, entityGeneration: 4 });
    const before = nativeBytes(source), stage = await staged(source), cut = captureNativeFileAuthoringResolverBindings(source, registry, new ResourceBudget());
    const snapshot = captureNativeFileAuthoringBindingsFromFacts(source, registry, stage.facts, resources, {}, cut);
    equal(snapshot.resolvers!.texture.kind, "canonical"); equal(snapshot.resolvers!.entityExists.kind, "canonical");
    deepEqual(snapshot.resolvers!.textureNamespace!.map(e => [e.name, e.id]), [["hero", 1], ["unloaded", 2]]);
    deepEqual(snapshot.resources.textures, []); deepEqual(nativeBytes(source), before);
    const result = await attachTarget(source, stage, snapshot, b); target = result.target;
    equal(inspectDataSceneAuthoringMetadata(target).progress!.textureId, target.textureId);
    equal(target.textureId("unloaded"), 2); throws(() => target!.textureId("missing"), /unknown|registered|found/i);
    deepEqual(result.registry!.get("hero", { validateLive: true }), applied.entityHandles.hero);
    equal(result.registry!.get("unknown", { validateLive: true }), undefined);
    deepEqual(nativeBytes(source), before); throws(() => attachAdmittedNativeFileAuthoringBindings(stage.owner, target!, result.token), /consumed/);
  } finally { target?.destroy(); source.destroy(); a.close(); b.close(); }
});

test("default texture resolver absence stays absent and no resource-host remains a distinct namespace", async () => {
  const source = await createEngine(), target = await createEngine();
  try {
    source.useDataScene(); const stage = await staged(source), cut = captureNativeFileAuthoringResolverBindings(source, undefined, new ResourceBudget());
    const snapshot = captureNativeFileAuthoringBindingsFromFacts(source, undefined, stage.facts, resources, {}, cut);
    equal(snapshot.resolvers!.texture.kind, "none"); equal(snapshot.resolvers!.textureNamespace, null);
    const token = admitNativeFileAuthoringBindings(stage.owner, snapshot, stage.facts, resources, {}, { hostBindingOwner: source, budget: new ResourceBudget() });
    throws(() => attachAdmittedNativeFileAuthoringBindings(nativeFileEngineOwner(target).native, target, token), /foreign/);
    stage.prepared.free(); stage.owner.free();
  } finally { source.destroy(); target.destroy(); }
});

test("opaque wrappers require exact typed identity registration, never execute during file phases, and resolve trusted target functions", async () => {
  const a = assets(), b = assets(), source = await createEngine(undefined, undefined, a.host);
  let target: FerrumEngine | undefined, calls = 0;
  const texture = (name: string) => { calls++; return source.textureId(name); }, exists = () => { calls++; return true; }, bindingOwner = {};
  try {
    const registry = new SceneInstanceHandleRegistry({ entityExists: exists });
    applyDataSceneAuthoringDocument(source, document().doc, { textureId: texture, instanceHandleRegistry: registry }); calls = 0;
    throws(() => captureNativeFileAuthoringResolverBindings(source, registry, new ResourceBudget(), bindingOwner), /MISSING/); equal(calls, 0);
    const restoredTexture = (name: string) => b.loader.textureId(name), restoredExists = () => false;
    registerNativeFileHostBinding(bindingOwner, nativeFileTextureResolverType, "texture", restoredTexture, texture);
    registerNativeFileHostBinding(bindingOwner, nativeFileEntityExistsType, "exists", restoredExists, exists);
    const cut = captureNativeFileAuthoringResolverBindings(source, registry, new ResourceBudget(), bindingOwner), stage = await staged(source);
    const snapshot = captureNativeFileAuthoringBindingsFromFacts(source, registry, stage.facts, resources, {}, cut);
    const result = await attachTarget(source, stage, snapshot, b, bindingOwner); target = result.target;
    equal(calls, 0); equal(inspectDataSceneAuthoringMetadata(target).progress!.textureId, restoredTexture);
    equal(result.registry!.get("hero", { validateLive: true }), undefined); equal(calls, 0);
  } finally { target?.destroy(); source.destroy(); a.close(); b.close(); }
});

test("success-time provider materialization survives mutation without provider calls or inventing JSON progress", async () => {
  const a = assets(), b = assets(), source = await createEngine(undefined, undefined, a.host); let target: FerrumEngine | undefined, calls = 0;
  try {
    const { doc, spec } = document(true);
    const supplied = { ...spec, visual: { ...spec.visual, normalTexture: undefined } };
    const applied = applyDataSceneAuthoringDocument(source, { ...doc, spatial: undefined }, { textureId: source.textureId, componentTemplates: () => { calls++; return supplied; } });
    equal(calls, 1); equal(inspectDataSceneAuthoringMetadata(source).progress, undefined); calls = 0;
    spec.visual.animationSet.clips[0].id = 9;
    const stage = await staged(source), before = nativeBytes(source), cut = captureNativeFileAuthoringResolverBindings(source, undefined, new ResourceBudget());
    const snapshot = captureNativeFileAuthoringBindingsFromFacts(source, undefined, stage.facts, resources, {}, cut);
    equal(snapshot.progress, null); ok(snapshot.applySource); equal(snapshot.continuity!.metadata.animations.hero.clips[0].id, 3);
    target = (await attachTarget(source, stage, snapshot, b)).target;
    equal(inspectDataSceneAuthoringMetadata(target).progress, undefined); equal(calls, 0);
    deepEqual(target.dataSceneSpriteAnimationState(applied.entityHandles.hero), source.dataSceneSpriteAnimationState(applied.entityHandles.hero));
    deepEqual(nativeBytes(source), before);
    const stage2 = await staged(target), recut = captureNativeFileAuthoringResolverBindings(target, undefined, new ResourceBudget());
    const again = captureNativeFileAuthoringBindingsFromFacts(target, undefined, stage2.facts, resources, {}, recut);
    deepEqual(again.applySource, snapshot.applySource); stage2.prepared.free(); stage2.owner.free();
  } finally { target?.destroy(); source.destroy(); a.close(); b.close(); }
});

test("later provider-only apply clears prior JSON progress through the actual transaction and keeps its new baseline", async () => {
  const a = assets(), b = assets(), source = await createEngine(undefined, undefined, a.host); let target: FerrumEngine | undefined;
  try {
    applyDataSceneAuthoringDocument(source, document(false, 3).doc, { textureId: source.textureId });
    const old = inspectDataSceneAuthoringMetadata(source).progress!;
    const { doc, spec } = document(true, 8);
    applyDataSceneAuthoringDocument(source, doc, { componentTemplates: () => spec });
    equal(inspectDataSceneAuthoringMetadata(source).progress, undefined);
    const stage = await staged(source), cut = captureNativeFileAuthoringResolverBindings(source, undefined, new ResourceBudget());
    const snapshot = captureNativeFileAuthoringBindingsFromFacts(source, undefined, stage.facts, resources, {}, cut);
    equal(snapshot.resolvers!.texture.kind, "default");
    target = (await attachTarget(source, stage, snapshot, b)).target;
    equal(inspectDataSceneAuthoringMetadata(target).progress, undefined); ok(old.document.length>0);
    equal(inspectDataSceneAuthoringMetadata(target).continuity!.metadata.animations.hero.clips[0].id, 8);
  } finally { target?.destroy(); source.destroy(); a.close(); b.close(); }
});

test("namespace, callback identity, registry ABA, host registration changes and disposal invalidate cuts without callback execution", async () => {
  const a = assets(), source = await createEngine(undefined, undefined, a.host); let calls = 0;
  try {
    const registry = new SceneInstanceHandleRegistry(), cut = captureNativeFileAuthoringResolverBindings(source, registry, new ResourceBudget());
    registry.set("x", { entityId: 0, entityGeneration: 0 }); registry.clear(); throws(cut.fence.assertCurrent, /STALE/);
    const next = captureNativeFileAuthoringResolverBindings(source, undefined, new ResourceBudget()); a.registry.reserve("next", "next.png"); throws(next.fence.assertCurrent, /STALE/);
    const hostCut = captureNativeFileAuthoringResolverBindings(source, undefined, new ResourceBudget()); const fn = () => { calls++; return 1; };
    registerNativeFileHostBinding(source, nativeFileTextureResolverType, "unused", fn); unregisterNativeFileHostBinding(source, nativeFileTextureResolverType, "unused"); throws(hostCut.fence.assertCurrent, /STALE/);
    const identityCut = captureNativeFileAuthoringResolverBindings(source, undefined, new ResourceBudget()); const original = source.textureId; source.textureId = fn;
    throws(identityCut.fence.assertCurrent, /identity/); source.textureId = original;
    Object.defineProperty(source,"textureId",{configurable:true,get(){calls++;return original;}});
    throws(()=>captureNativeFileAuthoringResolverBindings(source,undefined,new ResourceBudget()),/identity/); equal(calls,0);
    Object.defineProperty(source,"textureId",{configurable:true,writable:true,enumerable:true,value:original});
    const disposed = captureNativeFileAuthoringResolverBindings(source, undefined, new ResourceBudget()); assetFileOwner(a.loader).dispose(); throws(disposed.fence.assertCurrent, /STALE/); equal(calls, 0);
  } finally { source.destroy(); a.close(); }
});

test("malformed codec DTO and stale host preparation reject before metadata attach and preserve source bytes", async () => {
  const a = assets(), source = await createEngine(undefined, undefined, a.host), target = await createEngine(undefined, undefined, a.host);
  try {
    applyDataSceneAuthoringDocument(source, document().doc, { textureId: source.textureId });
    const stage = await staged(source), before = nativeBytes(source), cut = captureNativeFileAuthoringResolverBindings(source, undefined, new ResourceBudget());
    const snapshot = captureNativeFileAuthoringBindingsFromFacts(source, undefined, stage.facts, resources, {}, cut);
    for (const change of [
      (s: NativeFileAuthoringBindings) => ({ ...s, resolvers: { ...s.resolvers!, textureNamespace: [{ name: "hero", id: 2 }] } }),
      (s: NativeFileAuthoringBindings) => ({ ...s, resolvers: { ...s.resolvers!, texture: { kind: "none" } } }),
      (s: NativeFileAuthoringBindings) => ({ ...s, applySource: { ...s.applySource!, epoch: 999 } }),
      (s: NativeFileAuthoringBindings) => ({ ...s, applySource: { ...s.applySource!, templates: { broken: { visual: { kind: "invalid" } } } } }),
    ]) throws(() => admitNativeFileAuthoringBindings(stage.owner, transfer(change(snapshot)), stage.facts, resources, {}, { hostBindingOwner: source, budget: new ResourceBudget() }));
    const token = admitNativeFileAuthoringBindings(nativeFileEngineOwner(target).native, snapshot, stage.facts, resources, {}, { hostBindingOwner: source, budget: new ResourceBudget() });
    registerNativeFileHostBinding(source, nativeFileTextureResolverType, "changed", () => 1);
    // Current target does not match admitted epoch either; no partial context may attach.
    throws(() => attachAdmittedNativeFileAuthoringBindings(nativeFileEngineOwner(target).native, target, token));
    equal(inspectDataSceneAuthoringMetadata(target).progress, undefined); deepEqual(nativeBytes(source), before);
    stage.prepared.free(); stage.owner.free();
  } finally { source.destroy(); target.destroy(); a.close(); }
});

test("shared resolver logical budget exact/one-below rejects before owner mutation", async () => {
  const a = assets(), source = await createEngine(undefined, undefined, a.host);
  try {
    const budget = new ResourceBudget(), before = nativeBytes(source);
    captureNativeFileAuthoringResolverBindings(source, undefined, budget);
    const used = budget.usage();
    captureNativeFileAuthoringResolverBindings(source, undefined, new ResourceBudget({ maxWork: used.work, maxMetadataBytes: used.metadataBytes, maxResources: used.resources }));
    throws(() => captureNativeFileAuthoringResolverBindings(source, undefined, new ResourceBudget({ maxWork: used.work - 1 })), /LIMIT/);
    throws(() => captureNativeFileAuthoringResolverBindings(source, undefined, new ResourceBudget({ maxMetadataBytes: used.metadataBytes - 1 })), /LIMIT/);
    deepEqual(nativeBytes(source), before);
  } finally { source.destroy(); a.close(); }
});


test("post-install host and actual namespace fence failures leave new metadata empty and old source bytes intact", async () => {
  const a=assets(),b=assets(),source=await createEngine(undefined,undefined,a.host);
  let target:FerrumEngine|undefined;
  try {
    applyDataSceneAuthoringDocument(source,document().doc,{textureId:source.textureId});
    const stage=await staged(source),before=nativeBytes(source),cut=captureNativeFileAuthoringResolverBindings(source,undefined,new ResourceBudget());
    const snapshot=captureNativeFileAuthoringBindingsFromFacts(source,undefined,stage.facts,resources,{},cut);
    const token=admitNativeFileAuthoringBindings(stage.owner,snapshot,stage.facts,resources,{}, {hostBindingOwner:source,budget:new ResourceBudget()});
    equal(stage.owner.install_native_file_prepare(stage.prepared),0);
    target=await createDetachedEngineFacade(stage.bridge,captureDetachedEngineMetadata(nativeFileEngineOwner(source)),{},undefined,b.host);
    registerNativeFileHostBinding(source,nativeFileTextureResolverType,"after-admit",()=>1);
    throws(()=>attachAdmittedNativeFileAuthoringBindings(stage.owner,target!,token),/STALE/);
    equal(inspectDataSceneAuthoringMetadata(target).progress,undefined);
    const token2=admitNativeFileAuthoringBindings(stage.owner,snapshot,stage.facts,resources,{}, {hostBindingOwner:source,budget:new ResourceBudget()});
    b.registry.reserve("later","later.png");
    throws(()=>attachAdmittedNativeFileAuthoringBindings(stage.owner,target!,token2),/namespace/);
    equal(inspectDataSceneAuthoringMetadata(target).continuity,undefined);
    deepEqual(nativeBytes(source),before);
  }finally{target?.destroy();source.destroy();a.close();b.close();}
});
