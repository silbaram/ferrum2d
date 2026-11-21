import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { test } from "node:test";
import { AssetLoader, type AssetReleasePayload } from "../src/assetLoader.js";
import { assetFileOwner, registryFileOwner, type ResourceAssetData } from "../src/nativeFileResourceOwners.js";
import { ResourceBudget } from "../src/nativeFileResourceBudget.js";
class Textures {
    readonly loaded: {
        id: number;
        url: string;
    }[] = [];
    readonly evicted: number[] = [];
    async loadTexture(id: number, url: string) { this.loaded.push({ id, url }); return {}; }
    evictTexture(id: number) { this.evicted.push(id); return true; }
}
class Sounds {
    readonly loaded: {
        id: number;
        url: string;
    }[] = [];
    readonly evicted: number[] = [];
    async loadSound(id: number, url: string) { this.loaded.push({ id, url }); return {} as AudioBuffer; }
    evictSound(id: number) { this.evicted.push(id); return true; }
}
const capture = (owner: object) => assetFileOwner(owner).capture(new ResourceBudget());
async function fixture(run: (loader: AssetLoader, textures: Textures, sounds: Sounds) => Promise<void>) {
    const previous = globalThis.fetch;
    globalThis.fetch = async () => new Response('{"n":1,"neg":-0}', { headers: { "content-type": "application/json" } });
    const textures = new Textures(), sounds = new Sounds(), loader = new AssetLoader(textures, sounds);
    try {
        await run(loader, textures, sounds);
    }
    finally {
        globalThis.fetch = previous;
        assetFileOwner(loader).dispose();
    }
}
test("actual asset owner retains reserved/evicted namespaces, current JSON DAG and original bytes without URL replay", async () => {
    await fixture(async (loader, textures, sounds) => {
        const loaded = await loader.loadAssets({ textures: { hero: "hero.png", enemy: "enemy.png" }, sounds: { cue: "cue.wav" }, json: { a: "a.json", b: "b.json" } });
        const shared = { x: -0 };
        (loaded.json.a as Record<string, unknown>).shared = shared;
        (loaded.json.b as Record<string, unknown>).shared = shared;
        (loaded.json.a as Record<string, unknown>).n = 9;
        const release = { kind: "texture" as const, name: "hero", url: "hero.png" };
        loader.releaseAssets({ textures: [release], sounds: [], json: [], entries: [release], total: 1 });
        const original = await capture(loader);
        equal(original.textures.entries.length, 2);
        deepEqual(textures.evicted, [1]);
        equal(sounds.loaded.length, 1);
        const a = original.json[0].value as Record<string, unknown>, other = original.json[1].value as Record<string, unknown>;
        equal(a.shared, other.shared);
        equal(a.n, 9);
        ok(Object.is((a.shared as Record<string, unknown>).x, -0));
        equal(new TextDecoder().decode(original.json[0].source!.bytes), '{"n":1,"neg":-0}');
        shared.x = 2;
        equal((a.shared as Record<string, unknown>).x, -0);
        globalThis.fetch = async () => { throw Error("original URLs disabled"); };
        const targetTextures = new Textures(), target = new AssetLoader(targetTextures, new Sounds()), lease = await assetFileOwner(target).prepare(original, new ResourceBudget());
        try {
            equal((await capture(target)).textures.entries.length, 0);
            lease.adopt!();
            const restored = await capture(target);
            deepEqual(restored.textures, original.textures);
            deepEqual(restored.sounds, original.sounds);
            deepEqual(restored.json, original.json);
            equal((restored.json[0].value as Record<string, unknown>).shared, (restored.json[1].value as Record<string, unknown>).shared);
            equal(target.textureId("hero"), 1);
            equal(target.soundId("cue"), 1);
            equal(targetTextures.loaded.length, 0);
            await target.loadAssets({ textures: { next: "next.png" } });
            equal(target.textureId("next"), 3);
            equal(targetTextures.loaded.length, 1);
            lease.dispose();
            equal(target.textureId("hero"), 1);
            throws(() => lease.adopt!(), /STALE/);
        }
        finally {
            assetFileOwner(target).dispose();
        }
    });
});
test("actual namespace capture detects public mutable row corruption and preserves producer reservation order", async () => {
    await fixture(async (loader) => {
        const loaded = await loader.loadAssets({ textures: { a: "a.png", b: "b.png" } }), registry = registryFileOwner(loaded.textures);
        const original = registry.capture(new ResourceBudget());
        loaded.textures.entries()[0].name = "wrong";
        throws(() => registry.capture(new ResourceBudget()), /DATA/);
        loaded.textures.entries()[0].name = "a";
        deepEqual(registry.capture(new ResourceBudget()), original);
        loaded.textures.reserve("a", "replacement.png");
        deepEqual(registry.capture(new ResourceBudget()).entries.map(e => e.id), [1, 2]);
        const malformed = { ...original, entries: [original.entries[1], original.entries[0]] };
        throws(() => registry.prepare(malformed, new ResourceBudget()), /DATA/);
    });
});
test("asset malformed payload admission and exhausted quotas preserve both source and unpublished target", async () => {
    await fixture(async (loader) => {
        await loader.loadAssets({ textures: { a: "a.png" }, json: { a: "a.json" } });
        const original = await capture(loader), target = new AssetLoader(new Textures()), before = await capture(target);
        const jsonRow = original.json[0], cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        const variants = [{ ...original, textures: { ...original.textures, nextId: 4 } }, { ...original, textures: { ...original.textures, entries: [{ ...original.textures.entries[0], id: 2 }] } },
            { ...original, json: [{ ...jsonRow, value: { n: NaN } }] }, { ...original, json: [{ ...jsonRow, value: cycle }] }, { ...original, json: [jsonRow, jsonRow] }];
        for (const variant of variants) {
            await rejects(assetFileOwner(target).prepare(variant as ResourceAssetData, new ResourceBudget()), /DATA/);
            deepEqual(await capture(target), before);
            deepEqual(await capture(loader), original);
        }
        let calls = 0;
        const getter = { ...original };
        Object.defineProperty(getter, "json", { get() { calls++; throw Error("called"); } });
        await rejects(assetFileOwner(target).prepare(getter, new ResourceBudget()), /DATA/);
        equal(calls, 0);
        const b = new ResourceBudget(), first = await assetFileOwner(target).prepare(original, b);
        await first.dispose();
        const u = b.usage();
        const limits = { maxResources: u.resources, maxWork: u.work, maxMetadataBytes: u.metadataBytes, maxSourceBytes: u.sourceBytes, maxDecodedBytes: u.decodedBytes, maxGpuBytes: u.gpuBytes };
        const exactBudget = new ResourceBudget(limits), exact = await assetFileOwner(target).prepare(original, exactBudget);
        deepEqual(exactBudget.usage(), u);
        await exact.dispose();
        for (const k of ["maxResources", "maxWork", "maxMetadataBytes", "maxSourceBytes"] as const) {
            await rejects(assetFileOwner(target).prepare(original, new ResourceBudget({ ...limits, [k]: limits[k] - 1 })), /LIMIT/);
            deepEqual(await capture(target), before);
        }
        assetFileOwner(target).dispose();
    });
});
test("asset target load and direct registry reservation invalidate prepared metadata adoption", async () => {
    await fixture(async (loader) => {
        await loader.loadAssets({ json: { a: "a.json" } });
        const original = await capture(loader), target = new AssetLoader(new Textures());
        const loaded = await target.loadAssets({});
        const lease = await assetFileOwner(target).prepare(original, new ResourceBudget());
        loaded.textures.reserve("later", "later.png");
        throws(() => lease.adopt!(), /STALE/);
        lease.dispose();
        equal(target.textureId("later"), 1);
        let release: (value: Response) => void = () => { };
        globalThis.fetch = () => new Promise(resolve => { release = resolve; });
        const next = await assetFileOwner(target).prepare(original, new ResourceBudget()), pending = target.loadAssets({ json: { pending: "pending.json" } });
        await rejects(capture(target), /BUSY/);
        throws(() => next.adopt!(), /STALE/);
        release(new Response('{"ready":true}'));
        await pending;
        throws(() => next.adopt!(), /STALE/);
        next.dispose();
        assetFileOwner(target).dispose();
    });
});
test("asset capture catches a normal registry producer occurring during immutable source await", async () => {
    await fixture(async (loader) => {
        const loaded = await loader.loadAssets({ json: { a: "a.json" } }), read = Blob.prototype.arrayBuffer;
        let fired = false;
        Blob.prototype.arrayBuffer = async function () { if (!fired) {
            fired = true;
            loaded.textures.reserve("late", "late.png");
        } return read.call(this); };
        try {
            await rejects(capture(loader), /STALE/);
            equal(loaded.textures.textureId("late"), 1);
        }
        finally {
            Blob.prototype.arrayBuffer = read;
        }
    });
});
