import { loadSpatialGlb } from "../src/spatialModel.js";
import { captureModelResources } from "../src/nativeFileResourceModels.js";
import { ResourceBudget } from "../src/nativeFileResourceBudget.js";
import { nativeFileModelFixture } from "./nativeFileResourceModelFixtures.js";
import { readNativeFileJson } from "../src/nativeFileJson.js";
import "./nativeRuntimeTestHelper.js";
import { test } from "node:test";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { createEngine } from "../src/createEngine.js";
import type { FerrumEngine } from "../src/engineTypes.js";
import { nativeFileEngineOwner } from "../src/nativeFileEngineOwner.js";
import { admitNativeFileAuthoringBindings, attachAdmittedNativeFileAuthoringBindings, captureNativeFileAuthoringBindingsFromFacts, captureNativeFileAuthoringBindings, type NativeFileAuthoringBindings, type NativeFileAuthoringResources } from "../src/nativeFileAuthoringBindings.js";
import { admitNativeFileVariableBindings, attachAdmittedNativeFileVariableBindings, captureDataSceneVariableBindings, dataSceneVariableStoreForEngine, synchronizeDataSceneVariableStore, resolveDataSceneVariableDeclarations, markNativeFileCanonicalVariableAdapter, type DataSceneVariableBindingsSnapshot } from "../src/dataSceneVariables.js";
import { inspectDataSceneAuthoringMetadata, attachDataSceneProgressAdapter, markNativeFileCanonicalAuthoringAdapter, captureDataSceneProgress } from "../src/dataSceneProgress.js";
import { resolveSceneAuthoringDocument } from "../src/sceneAuthoringDocument.js";
import { applyDataSceneAuthoringDocument, createDataSceneRuntimeTarget } from "../src/dataSceneRuntimeTarget.js";
import { SceneInstanceHandleRegistry } from "../src/sceneInstanceHandles.js";
import { fixtureFacts, factWords } from "./nativeFileMetadataFixture.js";
const resources: NativeFileAuthoringResources = { textures: [{ id: 11, names: ["old"], contentId: "a".repeat(64) }, { id: 12, names: ["new"], contentId: "b".repeat(64) }], models: [] };
const clip = (id: number) => ({ clips: [{ id, fps: 4, frames: [{ u0: 0, v0: 0, u1: 1, v1: 1 }] }] });
function document(id = 3) { return { format: "ferrum2d.consumer.scene-authoring", version: 1, sceneComposition: { initialFragment: "main", prefabs: { body: {} }, fragments: { main: { instances: [{ id: "hero", prefab: "body", props: { components: { visual: { kind: "sprite", texture: 11, width: 2, height: 3, animationSet: clip(id) }, collider: "none", layer: "wall" } } }] } } }, behaviorRecipes: { entities: {} } }; }
function empty() { return { version: 1, progress: null, continuity: null, registry: null, resources }; }
function nativeState(e: FerrumEngine) { const n = nativeFileEngineOwner(e).native; return { epoch: n.data_scene_epoch(), configuration: n.spatial_configuration_revision(), raw: n.spatial_terrain_revision(), count: e.entityCount(), time: e.time() }; }
function registry() { return new SceneInstanceHandleRegistry(); }
test("pure admission needs no Engine/native access and preserves manual data scene with no document", async () => {
    const e = await createEngine();
    try {
        e.useDataScene();
        const f = fixtureFacts(e), owner = nativeFileEngineOwner(e).native, before = nativeState(e), token = admitNativeFileAuthoringBindings(owner, empty(), f.facts, resources);
        equal(inspectDataSceneAuthoringMetadata(e).progress, undefined);
        equal(attachAdmittedNativeFileAuthoringBindings(owner, e, token), undefined);
        deepEqual(nativeState(e), before);
        let calls = 0;
        const opaque = new Proxy({}, { get() { calls++; throw Error("no engine before install"); } });
        admitNativeFileAuthoringBindings(opaque, empty(), f.facts, resources);
        admitNativeFileVariableBindings(opaque, undefined, []);
        equal(calls, 0);
    }
    finally {
        e.destroy();
    }
});
test("real runtime clip edits remain separate from original document and continuation metadata", async () => {
    const e = await createEngine(), target = await createEngine();
    try {
        const r = registry(), doc = document(), applied = applyDataSceneAuthoringDocument(e, doc, { instanceHandleRegistry: r }), h = applied.entityHandles.hero;
        ok(e.configureDataSceneSpriteAnimation(h, clip(4)));
        const before = e.dataSceneSpriteAnimationState(h), f = fixtureFacts(e, [h], { clips: [4], textures: [11] });
        throws(() => captureNativeFileAuthoringBindings(e, r, { scene: "data", epoch: f.facts.dataSceneEpoch, spatialRevision: f.facts.configurationRevision, entities: [{ handle: h, kind: "data-scene", state: "live", animationClipIds: [4], textureIds: [11], modelIds: [] }], resources }), /animation IDs/);
        const snapshot = captureNativeFileAuthoringBindingsFromFacts(e, r, f.facts, resources);
        equal(snapshot.continuity!.metadata.animations.hero.clips[0].id, 3);
        deepEqual(e.dataSceneSpriteAnimationState(h), before);
        target.useDataScene();
        const owner = nativeFileEngineOwner(target).native, token = admitNativeFileAuthoringBindings(owner, snapshot, f.facts, resources);
        attachAdmittedNativeFileAuthoringBindings(owner, target, token);
        equal(inspectDataSceneAuthoringMetadata(target).continuity!.metadata.animations.hero.clips[0].id, 3);
        deepEqual(e.dataSceneSpriteAnimationState(h), before);
    }
    finally {
        e.destroy();
        target.destroy();
    }
});
test("real despawn/reuse keeps independent current registry and original baseline handles", async () => {
    const e = await createEngine();
    try {
        const r = registry(), applied = applyDataSceneAuthoringDocument(e, document(), { instanceHandleRegistry: r }), old = applied.entityHandles.hero;
        ok(e.despawnPhysicsEntity(old));
        const nextDoc = document();
        nextDoc.sceneComposition.fragments.main.instances[0].props.components.visual.texture = 12;
        const instance = resolveSceneAuthoringDocument(nextDoc, { validateBindings: true, validateComponents: true }).bindingPlan!.instances[0], next = createDataSceneRuntimeTarget(e, { activateDataScene: false }).spawnSceneInstance(instance);
        ok(next);
        r.set("hero", next!);
        r.set("unknown", { entityId: 999, entityGeneration: 77 });
        const f = fixtureFacts(e, [next!], { textures: [12] }), snapshot = captureNativeFileAuthoringBindingsFromFacts(e, r, f.facts, resources);
        deepEqual({ ...snapshot.progress!.handles[0].handle }, old);
        deepEqual({ ...snapshot.registry![0].handle }, next);
        equal(f.facts.classify(old), "stored-slot-not-current");
        equal(f.facts.classify(snapshot.registry![1].handle), "unknown-slot");
        const owner = {};
        admitNativeFileAuthoringBindings(owner, snapshot, f.facts, resources);
        deepEqual(r.get("hero"), next);
    }
    finally {
        e.destroy();
    }
});
test("same-engine Native checkpoint rollback preserves stale future authoring metadata and unknown handles", async () => {
    for (const dataScene of [false, true]) {
        const e = await createEngine(), target = await createEngine();
        try {
            if (dataScene)
                e.useDataScene();
            const checkpoint = e.captureRuntimeCheckpoint(), r = registry(), doc = document();
            applyDataSceneAuthoringDocument(e, doc, { instanceHandleRegistry: r });
            const baseline = inspectDataSceneAuthoringMetadata(e).progress!;
            e.restoreRuntimeCheckpoint(checkpoint);
            checkpoint.dispose();
            const f = fixtureFacts(e), snapshot = captureNativeFileAuthoringBindingsFromFacts(e, r, f.facts, resources);
            ok(baseline.epoch !== f.facts.dataSceneEpoch);
            equal(snapshot.progress!.epoch, baseline.epoch);
            equal(f.facts.classify(snapshot.progress!.handles[0].handle), dataScene ? "unknown-slot" : "stored-slot-not-current");
            throws(() => captureDataSceneProgress(e, doc));
            if (dataScene)
                target.useDataScene();
            const owner = nativeFileEngineOwner(target).native, token = admitNativeFileAuthoringBindings(owner, snapshot, f.facts, resources);
            attachAdmittedNativeFileAuthoringBindings(owner, target, token);
            equal(inspectDataSceneAuthoringMetadata(target).progress!.epoch, baseline.epoch);
            throws(() => captureDataSceneProgress(target, doc));
            equal(target.entityCount(), dataScene ? 0 : 1);
        }
        finally {
            e.destroy();
            target.destroy();
        }
    }
});
test("actual canonical adapter/target identity and one-use guard reject forged/foreign/stale plans", async () => {
    const a = await createEngine(), b = await createEngine();
    try {
        const f = fixtureFacts(a).facts, owner = nativeFileEngineOwner(a).native, token = admitNativeFileAuthoringBindings(owner, empty(), f, resources);
        throws(() => attachAdmittedNativeFileAuthoringBindings(owner, b, token), /identity/);
        throws(() => attachAdmittedNativeFileAuthoringBindings(owner, a, token), /consumed/);
        const good = admitNativeFileAuthoringBindings(owner, empty(), f, resources);
        throws(() => attachAdmittedNativeFileAuthoringBindings({}, a, good), /foreign/);
        attachAdmittedNativeFileAuthoringBindings(owner, a, good);
        throws(() => attachAdmittedNativeFileAuthoringBindings(owner, a, good), /consumed/);
        throws(() => markNativeFileCanonicalAuthoringAdapter(a), /already marked/);
        throws(() => markNativeFileCanonicalVariableAdapter(a), /already marked/);
        const another = admitNativeFileAuthoringBindings(owner, empty(), f, resources);
        const current = inspectDataSceneAuthoringMetadata(a).adapter!;
        attachDataSceneProgressAdapter(a, { ...current });
        throws(() => attachAdmittedNativeFileAuthoringBindings(owner, a, another), /canonical/);
    }
    finally {
        a.destroy();
        b.destroy();
    }
});
test("pure variable metadata binds sparse native7/2/64 without clearing or resetting current native values", async () => {
    const e = await createEngine();
    try {
        const owner = nativeFileEngineOwner(e).native;
        ok(owner.configure_gameplay_variable(7, 0, 0, 1, 91));
        ok(owner.configure_gameplay_variable(2, 1, 1, 1.25, 2.75));
        ok(owner.configure_gameplay_variable(64, 2, 0, 0, 1));
        const snapshot: DataSceneVariableBindingsSnapshot = { path: "", entries: [{ slot: 7, declaration: { name: "__proto__", type: "integer", scope: "global", default: 1 } }, { slot: 2, declaration: { name: "speed", type: "real", scope: "scene", default: 1.25 } }, { slot: 64, declaration: { name: "ready", type: "bool", scope: "global", default: false } }] }, layout = [{ slot: 64, type: "bool", scope: "global", default: false }, { slot: 7, type: "integer", scope: "global", default: 1 }, { slot: 2, type: "real", scope: "scene", default: 1.25 }], before = [7, 2, 64].map(slot => owner.gameplay_variable_value(slot)), token = admitNativeFileVariableBindings(owner, snapshot, layout);
        equal(dataSceneVariableStoreForEngine(e), undefined);
        const store = attachAdmittedNativeFileVariableBindings(owner, e, token)!;
        deepEqual([7, 2, 64].map(slot => owner.gameplay_variable_value(slot)), before);
        equal(store.get("speed"), 2.75);
        equal(store.get("ready"), true);
        deepEqual(captureDataSceneVariableBindings(e), snapshot);
        throws(() => attachAdmittedNativeFileVariableBindings(owner, e, token), /consumed/);
    }
    finally {
        e.destroy();
    }
});
test("metadata-only variable attach rejects unavailable, foreign and noncanonical targets", async () => {
    const e = await createEngine(), other = await createEngine();
    try {
        const owner = nativeFileEngineOwner(e).native, t = admitNativeFileVariableBindings(owner, undefined, []);
        throws(() => attachAdmittedNativeFileVariableBindings(owner, other, t), /identity/);
        throws(() => attachAdmittedNativeFileVariableBindings(owner, e, t), /consumed/);
        const good = admitNativeFileVariableBindings(owner, { path: "", entries: [] }, []);
        attachAdmittedNativeFileVariableBindings(owner, e, good);
        const again = admitNativeFileVariableBindings(owner, undefined, []);
        throws(() => attachAdmittedNativeFileVariableBindings(owner, e, again), /metadata-empty/);
    }
    finally {
        e.destroy();
        other.destroy();
    }
});
test("pure guards reject codec-shaped corruption and limits without using getters or native methods", async () => {
    const e = await createEngine();
    try {
        const f = fixtureFacts(e).facts, owner = {};
        for (const invalid of [{ ...empty(), resources: { textures: [], models: [] } }, { ...empty(), version: 2 }, { ...empty(), registry: [{ instanceId: "x", handle: { entityId: -1, entityGeneration: 0 } }] }])
            throws(() => admitNativeFileAuthoringBindings(owner, readNativeFileJson(new TextEncoder().encode(JSON.stringify(invalid))).value, f, resources));
        let calls = 0;
        const get = Object.defineProperty({}, "progress", { enumerable: true, get() { calls++; throw Error("getter"); } });
        throws(() => admitNativeFileAuthoringBindings(owner, get, f, resources));
        throws(() => admitNativeFileAuthoringBindings(owner, empty(), f, resources, { maxNodes: 1 }), /budget/);
        throws(() => admitNativeFileVariableBindings(owner, { path: "long", entries: [] }, [], { maxStringCodeUnits: 1 }), /limit/);
        throws(() => admitNativeFileVariableBindings(owner, undefined, [], { maxWork: 0 }), /work/);
        throws(() => admitNativeFileVariableBindings(owner, { path: "x", entries: [] }, [{ slot: 1, type: "integer", scope: "scene", default: .5 }]));
        equal(calls, 0);
    }
    finally {
        e.destroy();
    }
});
test("actual moving-platform raw revision differs from configuration revision and baseline metadata remains valid", async () => {
    const e = await createEngine();
    try {
        const doc = { ...document(), spatial: { camera: { projection: "orthographic", position: { x: 20, y: -100, elevation: 100 }, target: { x: 20, y: 20, elevation: 0 }, height: 100, near: .1, far: 1000 }, terrain: [{ id: "lift", x: 0, y: 0, width: 40, depth: 40, elevation: 0 }], billboards: {}, movingPlatforms: [{ surfaceId: "lift", offsetElevation: 32, durationSeconds: 2 }] } };
        const r = registry(), applied = applyDataSceneAuthoringDocument(e, doc, { instanceHandleRegistry: r }), native = nativeFileEngineOwner(e).native, baseline = inspectDataSceneAuthoringMetadata(e).progress!;
        for (let i = 0; i < 6; i++)
            native.update(1 / 60);
        const current = nativeState(e);
        ok(current.raw !== current.configuration);
        equal(current.configuration, baseline.spatialRevision);
        const { facts } = fixtureFacts(e, [applied.entityHandles.hero], { clips: [3], textures: [11] });
        equal(facts.spatialRevision, current.raw);
        equal(facts.configurationRevision, current.configuration);
        const snapshot = captureNativeFileAuthoringBindingsFromFacts(e, r, facts, resources), owner = {};
        admitNativeFileAuthoringBindings(owner, snapshot, facts, resources);
        equal(snapshot.progress!.spatialRevision, baseline.spatialRevision);
        deepEqual(nativeState(e), current);
    }
    finally {
        e.destroy();
    }
});
test("native pending continuity ordinals stay unkeyed and do not require a manual scene document", async () => {
    const e = await createEngine();
    try {
        e.useDataScene();
        const native = nativeFileEngineOwner(e).native, token = native.begin_data_scene_authoring_continuity(new Uint32Array([999, 77]), new Uint32Array([3]));
        ok(token);
        const { facts } = fixtureFacts(e, [], { continuity: [factWords(token, token, native.data_scene_epoch(), 1), factWords(0, 0, 0, 0, 0), new Uint8Array(0), new Uint8Array(0)] });
        equal(facts.table(10).u32(0, 0), 0);
        equal(facts.classify({ entityId: 999, entityGeneration: 77 }), "unknown-slot");
        const snapshot = captureNativeFileAuthoringBindingsFromFacts(e, undefined, facts, resources), owner = {};
        equal(snapshot.progress, null);
        equal(snapshot.continuity, null);
        admitNativeFileAuthoringBindings(owner, snapshot, facts, resources);
        equal(native.cancel_data_scene_authoring_continuity(token), true);
    }
    finally {
        e.destroy();
    }
});
test("actual model reconfiguration preserves original model content configuration and SDK baseline revision", async () => {
    const e = await createEngine();
    try {
        const first = await loadSpatialGlb(nativeFileModelFixture(), { materialProfile: "diffuse" }), bytes = nativeFileModelFixture(), view = new DataView(bytes);
        view.setFloat32(28 + view.getUint32(12, true), .25, true);
        const second = await loadSpatialGlb(bytes, { materialProfile: "diffuse" });
        ok(first.contentId !== second.contentId);
        ok(e.registerDataSceneSpatialModel("mesh", first));
        ok(e.registerDataSceneSpatialModel("far", second));
        const spatial = { camera: { projection: "orthographic" as const, position: { x: 0, y: -10, elevation: 10 }, target: { x: 0, y: 0, elevation: 0 }, height: 20 }, terrain: [], billboards: {}, models: { hero: { asset: "mesh", contentId: first.contentId } } }, doc = { ...document(), spatial }, r = registry(), applied = applyDataSceneAuthoringDocument(e, doc, { instanceHandleRegistry: r }), baseline = inspectDataSceneAuthoringMetadata(e).progress!, current = { ...spatial, models: { hero: { asset: "far", contentId: second.contentId } } };
        ok(e.configureDataSceneSpatial(current, applied.entityHandles));
        const modelData = await captureModelResources(nativeFileEngineOwner(e).native, new ResourceBudget()), actualResources = { ...resources, models: modelData.registry.map(row => ({ id: row.id, asset: row.key, contentId: modelData.assets[row.group].resource.contentId })) }, far = actualResources.models.find(row => row.asset === "far")!, f = fixtureFacts(e, [applied.entityHandles.hero], { clips: [3], textures: [11], models: [far.id] }).facts, snapshot = captureNativeFileAuthoringBindingsFromFacts(e, r, f, actualResources);
        ok(f.configurationRevision !== baseline.spatialRevision);
        equal(snapshot.progress!.spatialRevision, baseline.spatialRevision);
        equal(snapshot.continuity!.metadata.models!.hero.contentId, first.contentId);
        admitNativeFileAuthoringBindings({}, snapshot, f, actualResources);
        equal(inspectDataSceneAuthoringMetadata(e).progress, baseline);
    }
    finally {
        e.destroy();
    }
});
test("unloaded original document resource references remain opaque baseline declarations, not loaded proof", async () => {
    const e = await createEngine();
    try {
        const r = registry(), applied = applyDataSceneAuthoringDocument(e, document(), { instanceHandleRegistry: r });
        const f = fixtureFacts(e, [applied.entityHandles.hero], { clips: [3], textures: [12] }).facts, onlyCurrent = { textures: [resources.textures[1]], models: [] };
        const snapshot = captureNativeFileAuthoringBindingsFromFacts(e, r, f, onlyCurrent);
        equal(snapshot.resources.textures.length, 1);
        equal(snapshot.resources.textures[0].id, 12);
        admitNativeFileAuthoringBindings({}, snapshot, f, onlyCurrent);
        ok(JSON.stringify(snapshot.progress!.document).includes('"texture":11'));
    }
    finally {
        e.destroy();
    }
});
test("pure variable exact work boundary is monotone and typed corrupt metadata never normalizes defaults", () => {
    const snapshot = { path: "project", entries: [{ slot: 7, declaration: { name: "score", type: "integer", scope: "global", default: 1 } }] }, layout = [{ slot: 7, type: "integer", scope: "global", default: 1 }], before = JSON.stringify(snapshot);
    let low = 0, high = 4096;
    while (low < high) {
        const at = Math.floor((low + high) / 2);
        try {
            admitNativeFileVariableBindings({}, snapshot, layout, { maxWork: at });
            high = at;
        }
        catch (error) {
            ok(String(error).includes("work"));
            low = at + 1;
        }
    }
    ok(low > 0);
    admitNativeFileVariableBindings({}, snapshot, layout, { maxWork: low });
    throws(() => admitNativeFileVariableBindings({}, snapshot, layout, { maxWork: low - 1 }), /work/);
    equal(JSON.stringify(snapshot), before);
    for (const value of [NaN, Infinity, .5, Number.MAX_SAFE_INTEGER + 1, -0]) {
        const bad = { path: "project", entries: [{ slot: 7, declaration: { ...snapshot.entries[0].declaration, default: value } }] };
        throws(() => admitNativeFileVariableBindings({}, bad, layout));
    }
    const nativeZero = [{ slot: 7, type: "real", scope: "scene", default: -0 }], metadataZero = { path: "", entries: [{ slot: 7, declaration: { name: "zero", type: "real", scope: "scene", default: 0 } }] };
    admitNativeFileVariableBindings({}, metadataZero, nativeZero);
    ok(Object.is(nativeZero[0].default, -0));
});
test("unused loaded GPU ID domain is distinct from document and native reference domains", async () => {
    const e = await createEngine();
    try {
        const f = fixtureFacts(e).facts, loaded = { textures: [{ id: 16777215, names: ["render-target"], contentId: "c".repeat(64) }, { id: Number.MAX_SAFE_INTEGER, names: ["host-only"], contentId: "d".repeat(64) }], models: [] }, snapshot = { ...empty(), resources: loaded };
        admitNativeFileAuthoringBindings({}, snapshot, f, loaded);
        const owner = nativeFileEngineOwner(e).native, token = admitNativeFileAuthoringBindings(owner, snapshot, f, loaded);
        equal(attachAdmittedNativeFileAuthoringBindings(owner, e, token), undefined);
    }
    finally {
        e.destroy();
    }
});
test("Native-only checkpoint rollback with stale current JS variable slots fails file admission without repair", async () => {
    const e = await createEngine();
    try {
        const checkpoint = e.captureRuntimeCheckpoint(), store = synchronizeDataSceneVariableStore(e, resolveDataSceneVariableDeclarations([{ name: "future", type: "integer", scope: "global", default: 1 }]), "future", { future: 7 });
        store.set("future", 9);
        e.restoreRuntimeCheckpoint(checkpoint);
        checkpoint.dispose();
        const metadata = captureDataSceneVariableBindings(e)!, before = JSON.stringify(metadata), native = nativeFileEngineOwner(e).native;
        ok(Number.isNaN(native.gameplay_variable_value(7)));
        throws(() => store.get("future"));
        throws(() => admitNativeFileVariableBindings({}, metadata, []), /admitted native slot layout/);
        equal(dataSceneVariableStoreForEngine(e), store);
        equal(JSON.stringify(captureDataSceneVariableBindings(e)), before);
        ok(Number.isNaN(native.gameplay_variable_value(7)));
    }
    finally {
        e.destroy();
    }
});
