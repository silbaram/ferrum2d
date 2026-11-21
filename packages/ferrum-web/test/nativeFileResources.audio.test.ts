import { deepEqual, equal, rejects, ok } from "node:assert/strict";
import { test } from "node:test";
import { AudioManager } from "../src/audioManager.js";
import { audioFileOwner, type ResourceAudioData } from "../src/nativeFileResourceOwners.js";
import { ResourceBudget } from "../src/nativeFileResourceBudget.js";
// Host mocks exercise the real AudioAssetLoader/AudioManager and detach input
// exactly as decodeAudioData may do. Browser WebAudio is a separate probe.
class Pcm {
    readonly samples: Float32Array[];
    constructor(readonly numberOfChannels = 2, readonly length = 4, readonly sampleRate = 48000) {
        this.samples = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    }
    getChannelData(channel: number): Float32Array { return this.samples[channel]; }
    copyToChannel(samples: Float32Array, channel: number): void { this.samples[channel].set(samples); }
}
class Context {
    static readonly all: Context[] = [];
    state: AudioContextState = "suspended";
    closed = false;
    creates = 0;
    readonly source = new Pcm();
    constructor() { Context.all.push(this); this.source.samples[0].set([-0, .25, -.5, 2]); }
    async decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
        structuredClone(bytes, { transfer: [bytes] });
        equal(bytes.byteLength, 0);
        return this.source as unknown as AudioBuffer;
    }
    createBuffer(channels: number, frames: number, rate: number): AudioBuffer {
        this.creates++;
        return new Pcm(channels, frames, rate) as unknown as AudioBuffer;
    }
    async close(): Promise<void> { this.closed = true; this.state = "closed"; }
}
async function fixture(run: (manager: AudioManager, buffer: AudioBuffer) => Promise<void>) {
    const originalFetch = globalThis.fetch;
    const globals = globalThis as unknown as {
        window?: Window;
    };
    const originalWindow = globals.window;
    globals.window = { AudioContext: Context } as unknown as Window;
    let fetches = 0;
    globalThis.fetch = async () => { fetches++; return new Response(new Uint8Array([82, 73, 70, 70, 1, 2])); };
    const manager = new AudioManager();
    try {
        const buffer = await manager.loadSound(.5, "original.wav");
        equal(fetches, 1);
        globalThis.fetch = async () => { throw Error("original URL unavailable after load"); };
        await run(manager, buffer);
    }
    finally {
        manager.destroy();
        globalThis.fetch = originalFetch;
        if (originalWindow === undefined)
            delete globals.window;
        else
            globals.window = originalWindow;
    }
}
function budget(): ResourceBudget { return new ResourceBudget(); }
test("resource audio captures actual mutable PCM and retained encoding without refetch", async () => {
    await fixture(async (manager, buffer) => {
        buffer.getChannelData(0)[1] = .75;
        const b = budget(), data = await audioFileOwner(manager).capture(b);
        equal(data.entries.length, 1);
        deepEqual(data.entries[0].ids, [.5]);
        deepEqual([...data.entries[0].source!.bytes], [82, 73, 70, 70, 1, 2]);
        deepEqual([...data.entries[0].channels[0]], [-0, .75, -.5, 2]);
        ok(Object.is(data.entries[0].channels[0][0], -0));
        buffer.getChannelData(0)[1] = .125;
        equal(data.entries[0].channels[0][1], .75);
        const lease = await audioFileOwner(manager).prepare(data, budget());
        try {
            const restored = await audioFileOwner(lease.owner).capture(budget());
            deepEqual(restored.entries[0].channels, data.entries[0].channels);
            deepEqual(restored.entries[0].source, data.entries[0].source);
            equal(Context.all[Context.all.length - 1].state, "suspended");
            data.entries[0].channels[0][1] = .5;
            const again = await audioFileOwner(lease.owner).capture(budget());
            equal(again.entries[0].channels[0][1], .75);
        }
        finally {
            await lease.dispose();
        }
        equal(Context.all[Context.all.length - 1].closed, true);
    });
});
test("resource audio exact cumulative quota and one-below failures leave current PCM intact", async () => {
    await fixture(async (manager, buffer) => {
        const first = budget();
        await audioFileOwner(manager).capture(first);
        const usage = first.usage();
        const exact = { maxResources: usage.resources, maxWork: usage.work, maxMetadataBytes: usage.metadataBytes,
            maxSourceBytes: usage.sourceBytes, maxDecodedBytes: usage.decodedBytes, maxGpuBytes: usage.gpuBytes };
        const b = new ResourceBudget(exact);
        await audioFileOwner(manager).capture(b);
        deepEqual(b.usage(), usage);
        for (const key of ["maxResources", "maxWork", "maxMetadataBytes", "maxSourceBytes", "maxDecodedBytes"] as const) {
            await rejects(audioFileOwner(manager).capture(new ResourceBudget({ ...exact, [key]: exact[key] - 1 })), /Native-file resource rejected/);
            deepEqual([...buffer.getChannelData(0)], [-0, .25, -.5, 2]);
        }
    });
});
test("resource audio malformed typed data and partial prepare dispose detached owner only", async () => {
    await fixture(async (manager, buffer) => {
        const original = await audioFileOwner(manager).capture(budget());
        const entry = original.entries[0];
        for (const bad of [
            { ...entry, sampleRate: Infinity }, { ...entry, frames: 2 }, { ...entry, ids: [NaN] },
            { ...entry, channels: [new Float32Array([NaN, 0, 0, 0])] },
        ]) {
            const data: ResourceAudioData = { ...original, entries: [bad] };
            const beforeContexts = Context.all.length;
            await rejects(audioFileOwner(manager).prepare(data, budget()), /Native-file resource rejected/);
            equal(Context.all.length, beforeContexts); // Full typed admission precedes any new context.
            deepEqual([...buffer.getChannelData(0)], [-0, .25, -.5, 2]);
            equal(manager.hasSound(.5), false); // existing lookup truncates; do not normalize stored key
            deepEqual((await audioFileOwner(manager).capture(budget())).entries[0].channels, original.entries[0].channels);
        }
    });
});
