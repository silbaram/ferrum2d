import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { FerrumEngine } from "../src/engineTypes.js";
import { attachDataSceneProgressAdapter, rememberDataSceneProgressContext, forgetDataSceneProgressContext, inspectDataSceneAuthoringMetadata, dataSceneAuthoringContinuityContext, captureDataSceneProgress, type DataSceneProgressAdapter } from "../src/dataSceneProgress.js";
import { SceneInstanceHandleRegistry } from "../src/sceneInstanceHandles.js";
import { captureNativeFileAuthoringBindings, prepareNativeFileAuthoringBindings, attachPreparedNativeFileAuthoringBindings, type AdmittedNativeFileAuthoringRoster, type NativeFileAuthoringBindings } from "../src/nativeFileAuthoringBindings.js";
import { resolveDataSceneSpriteAnimationSet } from "../src/dataSceneSpriteAnimation.js";
import { readNativeFileJson } from "../src/nativeFileJson.js";
import { createEngine, initializeFerrumWasm } from "../src/core.js";
import { applyDataSceneAuthoringDocument } from "../src/dataSceneRuntimeTarget.js";
import { resolveSceneAuthoringDocument } from "../src/sceneAuthoringDocument.js";
const animation = resolveDataSceneSpriteAnimationSet({ clips: [{ id: 3, fps: 4, frames: [{ u0: 0, v0: 0, u1: 1, v1: 1 }] }] });
const h = { entityId: 7, entityGeneration: 2 }, removed = { entityId: 8, entityGeneration: 5 };
function document(model = false) {
    return { format: "ferrum2d.consumer.scene-authoring", version: 1,
        sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: { instances: ["hero", "removed"].map(id => ({ id, prefab: "object", props: { components: { visual: { kind: "sprite", texture: "hero-texture", width: 2, height: 3, animationSet: animation }, collider: "none", layer: "wall" } } })) } } }, behaviorRecipes: { entities: {} },
        ...(model ? { spatial: { camera: { projection: "orthographic", position: { x: 0, y: -10, elevation: 10 }, target: { x: 0, y: 0, elevation: 0 }, height: 20 }, terrain: [], billboards: {}, models: { hero: { asset: "mesh", contentId: "a".repeat(64), lods: [{ asset: "far", contentId: "b".repeat(64), minDistance: 100 }] } } } } : {}),
    };
}
function memory(epoch = 4, revision = 9) {
    const native = { epoch, revision, value: 17, queue: [3, 9] }, calls: {
        writes: number;
        progress: number;
    } = { writes: 0, progress: 0 };
    const unexpected = (): never => { calls.progress++; throw Error("metadata staging must not read/write simulation progress"); };
    const adapter: DataSceneProgressAdapter = { epoch: () => native.epoch, spatialRevision: () => native.revision, capture: unexpected, navigation: unexpected, obstacles: unexpected, animations: unexpected, viewport: unexpected, spatial: unexpected, preflightSpatial: unexpected, restore: unexpected };
    // Deliberately invalid simulation methods ensure staging never replays authoring.
    const engine = { useDataScene: unexpected, configureDataSceneSpatial: unexpected, step: unexpected, force: unexpected } as unknown as FerrumEngine;
    attachDataSceneProgressAdapter(engine, adapter);
    return { engine, native, calls, adapter };
}
function roster(model = false): AdmittedNativeFileAuthoringRoster {
    return { scene: "data", epoch: 4, spatialRevision: 9,
        resources: { textures: [{ id: 11, names: ["hero-texture", "shared-alias"], contentId: "c".repeat(64) }], models: model ? [{ id: 21, asset: "mesh", contentId: "a".repeat(64) }, { id: 22, asset: "far", contentId: "b".repeat(64) }] : [] },
        entities: [{ handle: h, kind: "data-scene", state: "live", animationClipIds: [3], textureIds: [11], modelIds: model ? [21, 22] : [] },
            { handle: removed, kind: "data-scene", state: "removed", animationClipIds: [], textureIds: [], modelIds: [] }],
    };
}
function source(model = false) {
    const m = memory(), doc = document(model), registry = new SceneInstanceHandleRegistry();
    registry.set("hero", h);
    const resolved = model ? resolveSceneAuthoringDocument(doc, {validateBindings:true,validateComponents:true}) : undefined;
    rememberDataSceneProgressContext(m.engine, doc, { hero: h, removed }, {}, { animations: { hero: animation, removed: animation }, ...(model ? { models: resolved!.spatial!.models } : {}) });
    return { ...m, doc, registry, roster: roster(model) };
}
function snapshot(model = false) { const s = source(model); return { source: s, data: captureNativeFileAuthoringBindings(s.engine, s.registry, s.roster) }; }
function wire(value: unknown) { return readNativeFileJson(new TextEncoder().encode(JSON.stringify(value))).value; }
function json(value: unknown): unknown { return JSON.parse(JSON.stringify(value)); }
function changed(value: NativeFileAuthoringBindings, modify: (x: Record<string, unknown>) => void) { const copy = json(value) as Record<string, unknown>; modify(copy); return copy; }
function noChanges(s: ReturnType<typeof source>, before: string, guard: ReturnType<typeof inspectDataSceneAuthoringMetadata>) { equal(JSON.stringify(s.native), before); equal(s.calls.progress, 0); equal(s.calls.writes, 0); const after = inspectDataSceneAuthoringMetadata(s.engine); equal(after.progress, guard.progress); equal(after.continuity, guard.continuity); equal(after.revision, guard.revision); }
test("authoring file capture contains detached immutable actual metadata and retained removal relation", () => {
    const s = source(true), before = JSON.stringify(s.native), guard = inspectDataSceneAuthoringMetadata(s.engine), data = captureNativeFileAuthoringBindings(s.engine, s.registry, s.roster);
    equal(data.version, 1);
    equal(data.progress!.handles.length, 2);
    equal(data.registry!.length, 1);
    equal(Object.is(data.progress!.document, s.doc), false);
    ok(Object.isFrozen(data));
    ok(Object.isFrozen(data.progress!.document));
    ok(Object.isFrozen(data.continuity!.metadata.animations.hero.clips));
    const saved = JSON.stringify(data);
    s.doc.sceneComposition.fragments.main.instances[0].id = "mutated";
    s.registry.clear();
    equal(JSON.stringify(data), saved);
    noChanges(s, before, guard);
});
test("serialized metadata prepares actual new contexts/registry and preserves shared native bindings", () => {
    const { source: s, data } = snapshot(true), candidate = memory(), before = JSON.stringify(candidate.native);
    const token = prepareNativeFileAuthoringBindings(candidate.engine, wire(data), wire(s.roster));
    equal(inspectDataSceneAuthoringMetadata(candidate.engine).progress, undefined);
    const registry = attachPreparedNativeFileAuthoringBindings(candidate.engine, token)!;
    const context = inspectDataSceneAuthoringMetadata(candidate.engine);
    equal(context.progress!.document, inspectDataSceneAuthoringMetadata(s.engine).progress!.document);
    deepEqual(registry.get("hero"), h);
    equal(registry.get("removed"), undefined);
    deepEqual(json(context.progress!.handles), json(context.continuity!.handles));
    equal(context.progress!.textureId!("hero-texture"), 11);
    equal(context.progress!.textureId!("shared-alias"), 11);
    deepEqual(json(dataSceneAuthoringContinuityContext(candidate.engine).metadata), json(data.continuity!.metadata));
    const recaptured = captureNativeFileAuthoringBindings(candidate.engine, registry, wire(s.roster));
    deepEqual(json(recaptured), json(data));
    equal(JSON.stringify(candidate.native), before);
    equal(candidate.calls.progress, 0);
});
test("prepared plans reject forged aliases, foreign engines and reuse without changing metadata/native", () => {
    const { data, source: s } = snapshot(), a = memory(), b = memory(), token = prepareNativeFileAuthoringBindings(a.engine, data, s.roster), guard = inspectDataSceneAuthoringMetadata(a.engine);
    throws(() => attachPreparedNativeFileAuthoringBindings(a.engine, { ...token }), /foreign\/aliased\/reused/);
    throws(() => attachPreparedNativeFileAuthoringBindings(b.engine, token), /foreign\/aliased\/reused/);
    equal(inspectDataSceneAuthoringMetadata(a.engine).revision, guard.revision);
    equal(b.calls.progress, 0);
    attachPreparedNativeFileAuthoringBindings(a.engine, token);
    const attached = inspectDataSceneAuthoringMetadata(a.engine);
    throws(() => attachPreparedNativeFileAuthoringBindings(a.engine, token), /foreign\/aliased\/reused/);
    equal(inspectDataSceneAuthoringMetadata(a.engine).progress, attached.progress);
});
test("attach guards metadata ABA, adapter replacement, native epoch and spatial revision", () => {
    for (const mutate of [(m: ReturnType<typeof memory>) => forgetDataSceneProgressContext(m.engine), (m: ReturnType<typeof memory>) => attachDataSceneProgressAdapter(m.engine, { ...m.adapter }),
        (m: ReturnType<typeof memory>) => { m.native.epoch++; }, (m: ReturnType<typeof memory>) => { m.native.revision++; }]) {
        const { data, source: s } = snapshot(), m = memory(), token = prepareNativeFileAuthoringBindings(m.engine, data, s.roster);
        mutate(m);
        const before = inspectDataSceneAuthoringMetadata(m.engine);
        throws(() => attachPreparedNativeFileAuthoringBindings(m.engine, token), /stale/);
        equal(inspectDataSceneAuthoringMetadata(m.engine).progress, before.progress);
        equal(m.calls.progress, 0);
    }
});
test("prepare detaches caller DTO/roster aliases before attach", () => {
    const { data, source: s } = snapshot(), m = memory(), dto = json(data) as {
        registry: {
            instanceId: string;
        }[];
    }, native = json(s.roster) as {
        epoch: number;
    };
    const token = prepareNativeFileAuthoringBindings(m.engine, dto, native);
    dto.registry[0].instanceId = "corrupted";
    native.epoch = 123;
    const registry = attachPreparedNativeFileAuthoringBindings(m.engine, token)!;
    deepEqual(registry.get("hero"), h);
    equal(registry.get("corrupted"), undefined);
});
test("prepare rejects entity kind/generation/state and missing roster facts", () => {
    const { data, source: s } = snapshot(), before = JSON.stringify(s.native), guard = inspectDataSceneAuthoringMetadata(s.engine);
    for (const mutate of [(r: Record<string, unknown>) => { r.epoch = 5; }, (r: Record<string, unknown>) => { r.scene = "none"; }, (r: Record<string, unknown>) => { r.entities = []; },
        (r: Record<string, unknown>) => { (r.entities as {
            kind: string;
        }[])[0].kind = "projectile"; }, (r: Record<string, unknown>) => { (r.entities as {
            state: string;
        }[])[0].state = "unknown"; },
        (r: Record<string, unknown>) => { (r.entities as {
            handle: {
                entityGeneration: number;
            };
        }[])[0].handle.entityGeneration++; }]) {
        const r = json(s.roster) as Record<string, unknown>;
        mutate(r);
        const m = memory();
        throws(() => prepareNativeFileAuthoringBindings(m.engine, data, r));
        equal(inspectDataSceneAuthoringMetadata(m.engine).progress, undefined);
    }
    noChanges(s, before, guard);
});
test("prepare rejects resource content/ID/alias/native binding mismatches", () => {
    const { data, source: s } = snapshot(true);
    const modifications = [(r: Record<string, unknown>) => { ((r.resources as {
            textures: {
                contentId: string;
            }[];
        }).textures[0]).contentId = "d".repeat(64); },
        (r: Record<string, unknown>) => { (r.resources as {
            textures: {
                id: number;
            }[];
        }).textures[0].id = 12; },
        (r: Record<string, unknown>) => { (r.resources as {
            textures: {
                names: string[];
            }[];
        }).textures[0].names = ["wrong"]; },
        (r: Record<string, unknown>) => { (r.entities as {
            textureIds: number[];
        }[])[0].textureIds = []; },
        (r: Record<string, unknown>) => { (r.entities as {
            modelIds: number[];
        }[])[0].modelIds = [21]; },
        (r: Record<string, unknown>) => { (r.entities as {
            animationClipIds: number[];
        }[])[0].animationClipIds = [4]; }];
    for (const mutate of modifications) {
        const r = json(s.roster) as Record<string, unknown>;
        mutate(r);
        throws(() => prepareNativeFileAuthoringBindings(memory().engine, data, r));
    }
});
test("prepare rejects duplicate/split registry and continuity aliases before attachment", () => {
    const { data, source: s } = snapshot();
    const invalid = [changed(data, x => { x.registry = [...(x.registry as unknown[]), ...(x.registry as unknown[])]; }),
        changed(data, x => { (x.continuity as {
            handles: {
                handle: typeof h;
            }[];
        }).handles[0].handle = removed; }),
        changed(data, x => { (x.continuity as {
            metadata: {
                animations: {
                    hero: {
                        clips: {
                            id: number;
                        }[];
                    };
                };
            };
        }).metadata.animations.hero.clips[0].id = 4; }),
        changed(data, x => { x.progress = null; })];
    for (const dto of invalid) {
        const m = memory();
        throws(() => prepareNativeFileAuthoringBindings(m.engine, dto, s.roster));
        equal(inspectDataSceneAuthoringMetadata(m.engine).progress, undefined);
    }
});
test("length and tree budgets reject before getters/semantic resolution or huge sparse traversal", () => {
    const { data, source: s } = snapshot();
    let calls = 0;
    const wide = Object.defineProperty(new Array(100000), "0", { enumerable: true, get() { calls++; return null; } });
    throws(() => prepareNativeFileAuthoringBindings(memory().engine, wide, s.roster), /collection budget/);
    const getter = Object.defineProperty({ version: 1 }, "progress", { enumerable: true, get() { calls++; return null; } });
    throws(() => prepareNativeFileAuthoringBindings(memory().engine, getter, s.roster), /getter/);
    let deep: unknown = 0;
    for (let i = 0; i < 40; i++)
        deep = { child: deep };
    throws(() => prepareNativeFileAuthoringBindings(memory().engine, deep, s.roster), /deep/);
    throws(() => prepareNativeFileAuthoringBindings(memory().engine, data, s.roster, { maxInstances: 1 }), /collection limit/);
    throws(() => prepareNativeFileAuthoringBindings(memory().engine, data, s.roster, { maxStringCodeUnits: 3 }), /string budget/);
    throws(() => prepareNativeFileAuthoringBindings(memory().engine, data, s.roster, { maxNodes: 1 }), /node budget/);
    throws(() => prepareNativeFileAuthoringBindings(memory().engine, data, s.roster, { maxMembers: 0 }), /collection budget/);
    equal(calls, 0);
});
test("symbolic fragment expansion and variant chains are bounded before resolver allocation", () => {
    const { data, source: s } = snapshot();
    const dto = json(data) as {
        progress: {
            document: {
                sceneComposition: {
                    fragments: Record<string, unknown>;
                    prefabs: Record<string, unknown>;
                };
            };
        };
    };
    const fragments: Record<string, unknown> = {};
    for (let i = 0; i < 25; i++)
        fragments[i ? `f${i}` : "main"] = { include: [{ fragment: `f${i + 1}` }, { fragment: `f${i + 1}` }], instances: [] };
    fragments.f25 = { instances: [] };
    dto.progress.document.sceneComposition.fragments = fragments;
    throws(() => prepareNativeFileAuthoringBindings(memory().engine, dto, s.roster), /expanded fragment|resolution work/);
    const variants: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++)
        variants[`v${i}`] = i === 39 ? {} : { extends: `v${i + 1}` };
    const other = json(data) as typeof dto;
    other.progress.document.sceneComposition.prefabs = { object: { variants } };
    throws(() => prepareNativeFileAuthoringBindings(memory().engine, other, s.roster), /variant reference/);
});
test("exact instance/resource budgets admit and one below rejects without native mutation", () => {
    const { data, source: s } = snapshot(true), m = memory();
    const token = prepareNativeFileAuthoringBindings(m.engine, data, s.roster, { maxInstances: 2, maxResources: 2 });
    attachPreparedNativeFileAuthoringBindings(m.engine, token);
    throws(() => prepareNativeFileAuthoringBindings(memory().engine, data, s.roster, { maxResources: 1 }), /collection limit/);
    throws(() => captureNativeFileAuthoringBindings(s.engine, s.registry, s.roster, { maxDocumentBytes: 1 }), /document byte budget/);
    equal(s.calls.progress, 0);
});
test("callbacks and missing materialized documents fail capability without invoking callbacks", () => {
    const s = source();
    let calls = 0;
    const registry = new SceneInstanceHandleRegistry({ entityExists: () => { calls++; return true; } });
    registry.set("hero", h);
    throws(() => captureNativeFileAuthoringBindings(s.engine, registry, s.roster), /entityExists callback/);
    rememberDataSceneProgressContext(s.engine, s.doc, { hero: h, removed }, { textureId: () => { calls++; return 11; } }, { animations: { hero: animation, removed: animation } });
    throws(() => captureNativeFileAuthoringBindings(s.engine, s.registry, s.roster), /host binding/);
    forgetDataSceneProgressContext(s.engine);
    rememberDataSceneProgressContext(s.engine, s.doc, { hero: h, removed }, { componentTemplates: () => { calls++; return undefined; } }, { animations: { hero: animation, removed: animation } });
    throws(() => captureNativeFileAuthoringBindings(s.engine, s.registry, s.roster), /materialized document unavailable/);
    equal(calls, 0);
});
test("empty session metadata roundtrips without manufacturing authoring or live callbacks", () => {
    const source = memory(0, 0), target = memory(0, 0), native = { scene: "none", epoch: 0, spatialRevision: 0, entities: [], resources: { textures: [], models: [] } };
    const data = captureNativeFileAuthoringBindings(source.engine, undefined, native);
    equal(data.progress, null);
    equal(data.registry, null);
    equal(attachPreparedNativeFileAuthoringBindings(target.engine, prepareNativeFileAuthoringBindings(target.engine, wire(data), native)), undefined);
    equal(inspectDataSceneAuthoringMetadata(target.engine).progress, undefined);
});
test("actual reused Wasm authoring capture preserves native playback and existing physics progress rejection", async () => {
    await initializeFerrumWasm(await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)));
    const e = await createEngine();
    try {
        // Normal source setup only: staging never calls this authoring/native path.
        const doc = { format: "ferrum2d.consumer.scene-authoring", version: 1, sceneComposition: { initialFragment: "main", prefabs: { object: {} }, fragments: { main: { instances: [{ id: "hero", prefab: "object", props: { components: { visual: { kind: "sprite", texture: 11, width: 2, height: 3, animationSet: animation }, collider: "none", layer: "wall" } } }] } } }, behaviorRecipes: { entities: {} } };
        const registry = new SceneInstanceHandleRegistry(), applied = applyDataSceneAuthoringDocument(e, doc, { instanceHandleRegistry: registry });
        ok(e.updateDataSceneSpriteAnimations([{ entity: applied.entityHandles.hero, paused: true, flipX: true }]));
        const state = inspectDataSceneAuthoringMetadata(e), before = { time: e.time(), count: e.entityCount(), playback: e.dataSceneSpriteAnimationState(applied.entityHandles.hero) };
        const native = { scene: "data", epoch: state.epoch, spatialRevision: state.spatialRevision, entities: [{ handle: applied.entityHandles.hero, kind: "data-scene", state: "live", animationClipIds: [3], textureIds: [11], modelIds: [] }], resources: roster().resources };
        const captured = captureNativeFileAuthoringBindings(e, registry, native);
        equal(captured.progress!.handles.length, 1);
        deepEqual({ time: e.time(), count: e.entityCount(), playback: e.dataSceneSpriteAnimationState(applied.entityHandles.hero) }, before);
        throws(() => captureDataSceneProgress(e, { ...doc, physics: { space: "spatial" } }), /native physics snapshots/);
        equal(inspectDataSceneAuthoringMetadata(e).progress, state.progress);
    }
    finally {
        e.destroy();
    }
});

test("JSON staging rejects cycles/functions/nonfinite values and never uses substituted array methods", () => {
    const {data,source:s}=snapshot();let calls=0;
    const cyclic:Record<string,unknown>={};cyclic.child=cyclic;
    for(const invalid of [cyclic,()=>0,{value:NaN},{value:Infinity},[undefined]])
        throws(()=>prepareNativeFileAuthoringBindings(memory().engine,invalid,s.roster));
    const dto=json(data) as {registry:unknown[]};
    Object.defineProperty(dto.registry,"map",{get(){calls++;throw Error("caller array map must not execute");}});
    const target=memory();attachPreparedNativeFileAuthoringBindings(target.engine,prepareNativeFileAuthoringBindings(target.engine,dto,s.roster));
    const limit=Object.defineProperty({},"maxNodes",{get(){calls++;return 1;}});
    throws(()=>prepareNativeFileAuthoringBindings(memory().engine,data,s.roster,limit),/invalid limit/);equal(calls,0);
});

test("capture rejects stale native epoch and prepare refuses replacing existing metadata",()=>{
    const s=source(),before=inspectDataSceneAuthoringMetadata(s.engine);s.native.epoch++;
    throws(()=>captureNativeFileAuthoringBindings(s.engine,s.registry,s.roster),/capture metadata\/epoch changed/);
    equal(inspectDataSceneAuthoringMetadata(s.engine).progress,before.progress);
    const fresh=snapshot();throws(()=>prepareNativeFileAuthoringBindings(fresh.source.engine,fresh.data,fresh.source.roster),/metadata-empty candidate/);
});
