import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { test } from "node:test";
import { AudioManager } from "../src/audioManager.js";
import { audioFileOwner, type ResourceAudioData } from "../src/nativeFileResourceOwners.js";
import { ResourceBudget } from "../src/nativeFileResourceBudget.js";
import { copyFileAudioData } from "../src/nativeFileResourceAudio.js";
// AudioParam values use WebIDL float rounding. Context clock/event dispatch is
// explicit: these tests prove intent/lifecycle, not browser DSP output.
class Param {
    private stored = 1;
    readonly ramps: number[][] = [];
    get value() { return this.stored; }
    set value(v: number) { if (!Number.isFinite(Math.fround(v)))
        throw Error("nonfinite AudioParam"); this.stored = Math.fround(v); }
    setValueAtTime(v: number, time: number) { this.value = v; this.ramps.push([v, time]); }
    linearRampToValueAtTime(v: number, time: number) { this.ramps.push([Math.fround(v), time]); }
    cancelScheduledValues(time: number) { this.ramps.push([time]); }
}
class Node {
    disconnected = false;
    connect(_destination: unknown) { }
    disconnect() { this.disconnected = true; }
}
class Gain extends Node {
    readonly gain = new Param();
}
class Pcm {
    readonly samples: Float32Array[];
    constructor(readonly numberOfChannels = 1, readonly length = 48000, readonly sampleRate = 48000) {
        this.samples = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
        this.samples[0][0] = -0;
        this.samples[0][1] = .5;
    }
    getChannelData(i: number) { return this.samples[i]; }
    copyToChannel(values: Float32Array, i: number) { this.samples[i].set(values); }
}
class Source extends Node {
    readonly playbackRate = new Param();
    loop = false;
    buffer?: AudioBuffer;
    onended: (() => void) | null = null;
    readonly starts: number[][] = [];
    readonly stops: number[] = [];
    private readonly listeners = new Set<() => void>();
    constructor(readonly context: Context) { super(); }
    addEventListener(_type: string, callback: () => void) { this.listeners.add(callback); }
    removeEventListener(_type: string, callback: () => void) { this.listeners.delete(callback); }
    start(when = 0, offset = 0) {
        this.context.startAttempts++;
        if (this.context.failStart === this.context.startAttempts)
            throw Error("injected start");
        this.starts.push([when, offset]);
    }
    stop(when = this.context.currentTime) { this.stops.push(when); }
    finish() { this.onended?.(); for (const listener of [...this.listeners])
        listener(); }
}
class Panner extends Node {
    readonly positionX = new Param();
    readonly positionY = new Param();
    readonly positionZ = new Param();
    readonly orientationX = new Param();
    readonly orientationY = new Param();
    readonly orientationZ = new Param();
    distanceModel = "inverse";
    panningModel = "equalpower";
    refDistance = 1;
    maxDistance = 10000;
    rolloffFactor = 1;
    coneInnerAngle = 360;
    coneOuterAngle = 360;
    coneOuterGain = 0;
}
class Context {
    static readonly all: Context[] = [];
    static failBuffer = false;
    static shareDecode = false;
    state: AudioContextState = "suspended";
    currentTime = 0;
    readonly destination = new Node();
    readonly listener = { positionX: new Param(), positionY: new Param(), positionZ: new Param(), forwardX: new Param(), forwardY: new Param(), forwardZ: new Param(), upX: new Param(), upY: new Param(), upZ: new Param() };
    readonly sources: Source[] = [];
    readonly gains: Gain[] = [];
    readonly panners: Panner[] = [];
    readonly decoded = new Pcm();
    closed = false;
    resumes = 0;
    denyResume = false;
    startAttempts = 0;
    failStart = 0;
    constructor() { Context.all.push(this); }
    async decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
        structuredClone(bytes, { transfer: [bytes] });
        return (Context.shareDecode ? this.decoded : new Pcm()) as unknown as AudioBuffer;
    }
    createBuffer(channels: number, frames: number, rate: number) {
        if (Context.failBuffer)
            throw Error("injected buffer");
        return new Pcm(channels, frames, rate) as unknown as AudioBuffer;
    }
    createBufferSource() { const source = new Source(this); this.sources.push(source); return source as unknown as AudioBufferSourceNode; }
    createGain() { const gain = new Gain(); this.gains.push(gain); return gain as unknown as GainNode; }
    createPanner() { const panner = new Panner(); this.panners.push(panner); return panner as unknown as PannerNode; }
    async resume() { this.resumes++; if (this.denyResume)
        throw Error("gesture required"); this.state = "running"; }
    async suspend() { this.state = "suspended"; }
    async close() { this.closed = true; this.state = "closed"; }
}
async function fixture(run: (audio: AudioManager, context: Context) => Promise<void>) {
    const globals = globalThis as unknown as {
        window?: Window;
    };
    const previous = globals.window, fetch = globalThis.fetch;
    globals.window = { AudioContext: Context } as unknown as Window;
    Context.failBuffer = false;
    Context.shareDecode = false;
    globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3, 4]));
    const audio = new AudioManager();
    try {
        await audio.loadSound(1, "one.wav");
        await run(audio, Context.all[Context.all.length - 1]);
    }
    finally {
        audio.destroy();
        Context.failBuffer = false;
        Context.shareDecode = false;
        globalThis.fetch = fetch;
        if (previous === undefined)
            delete globals.window;
        else
            globals.window = previous;
    }
}
const capture = (audio: object) => audioFileOwner(audio).capture(new ResourceBudget());
test("audio intent preserves one-shot/UI, looping BGM fades, spatial pose and raw/f32 pitch", async () => {
    await fixture(async (audio, c) => {
        audio.playSfx(1, .6, .5);
        audio.playUi(1, .3, 2);
        audio.playBgm(1, { volume: .8, loop: true, fadeInSeconds: 2 });
        const spatial = audio.playSpatial(1, { x: 1, y: 2, loop: true }, .4, .01)!;
        spatial.setPose(7, 8, 9, 1, 0, 0);
        spatial.setVolume(.7);
        audio.setListenerPose(3, 4, 5, 2, 0, 0, 0, 2, 0);
        c.currentTime = .5;
        const original = await capture(audio);
        equal(original.playback.voices.length, 4);
        deepEqual(original.playback.voices.map(v => v.cursorSeconds), [.25, 1, .5, .5 * Math.fround(.01)]);
        const bgm = original.playback.voices[2];
        equal(bgm.gain, Math.fround(.8) * .25);
        equal(bgm.fadeRemainingSeconds, 1.5);
        const v = original.playback.voices[3];
        equal(v.pitch, Math.fround(.01));
        equal(v.nominalPitch, .01);
        deepEqual(v.spatial?.direction, { x: 1, y: 0, z: 0 });
        equal(v.spatial?.x, 7);
        equal(v.nominalVolume, .7);
        const lease = await audioFileOwner(audio).prepare(original, new ResourceBudget());
        const next = Context.all[Context.all.length - 1];
        equal(next.state, "suspended");
        equal(next.sources.length, 4);
        equal(next.sources.every(s => s.starts.length === 0), true);
        equal(c.closed, false);
        next.denyResume = true;
        const activation = lease.activate();
        equal(activation.started, 3); // UI reached duration: do not replay its completed intent.
        equal(activation.waitingForGesture, true);
        equal(next.sources[0].starts[0][1], .25);
        equal(next.sources[2].starts[0][1], .5);
        throws(() => lease.activate(), /STALE/);
        equal(c.sources.every(s => !s.stops.length), true);
        const restored = await capture(lease.owner);
        equal(restored.playback.voices.length, 3);
        equal(restored.playback.voices.find(v => v.kind === "spatial")!.pitch, v.pitch);
        deepEqual(restored.playback.listener, original.playback.listener);
        equal(await (lease.owner as AudioManager).unlock(), false);
        next.denyResume = false;
        equal(await (lease.owner as AudioManager).unlock(), true);
        equal(next.state, "running");
        await lease.dispose();
        equal(next.closed, true);
        equal(c.closed, false);
    });
});
test("audio fading former BGM and evicted/replaced voice buffers remain owned with no current IDs", async () => {
    await fixture(async (audio, c) => {
        audio.playBgm(1, { loop: true, volume: .8 });
        audio.playSfx(1);
        c.currentTime = .2;
        await audio.loadSound(1, "replacement.wav");
        audio.playBgm(1, { fadeOutSeconds: 2, loop: true, volume: .5 });
        c.currentTime = .7;
        const data = await capture(audio);
        equal(data.entries.length, 2);
        deepEqual(data.entries.map(e => e.ids), [[1], []]);
        equal(data.playback.voices.filter(v => v.currentBgm).length, 1);
        const fading = data.playback.voices.find(v => v.kind === "bgm" && !v.currentBgm)!;
        equal(fading.stopRemainingSeconds, 1.5000000000000002);
        equal(fading.fadeRemainingSeconds, 1.5000000000000002);
        ok(Math.abs(fading.gain - Math.fround(.8) * .75) < 1e-15);
        const lease = await audioFileOwner(audio).prepare(data, new ResourceBudget());
        const next = Context.all[Context.all.length - 1];
        try {
            equal(lease.activate().started, 3);
            equal(next.sources[0].stops[0], fading.stopRemainingSeconds);
            deepEqual((await capture(lease.owner)).entries.map(e => e.ids), [[1], []]);
            equal(c.closed, false);
        }
        finally {
            await lease.dispose();
        }
        equal(audio.evictSound(1), true);
        const evicted = await capture(audio);
        equal(evicted.entries.every(e => e.ids.length === 0), true);
        equal(evicted.playback.voices.length, 3);
        c.sources[0].finish();
        c.sources[1].finish();
        c.sources[2].finish();
        equal((await capture(audio)).entries.length, 0);
    });
});
test("audio actual AudioBuffer alias is captured once; same values in distinct buffers remain distinct", async () => {
    await fixture(async (audio, c) => {
        Context.shareDecode = true;
        await audio.loadSound(2, "two.wav");
        await audio.loadSound(3, "three.wav");
        const data = await capture(audio);
        equal(data.entries.length, 2);
        deepEqual(data.entries.map(e => e.ids), [[1], [2, 3]]);
        const lease = await audioFileOwner(audio).prepare(data, new ResourceBudget());
        try {
            deepEqual((await capture(lease.owner)).entries.map(e => e.ids), [[1], [2, 3]]);
            equal(c.closed, false);
        }
        finally {
            await lease.dispose();
        }
    });
});
test("audio pending end/current pointer is preserved without replay; explicit spatial stop removes its intent", async () => {
    await fixture(async (audio, c) => {
        audio.playBgm(1, { loop: false });
        const spatial = audio.playSpatial(1, { x: 0, y: 0, loop: true })!;
        spatial.stop();
        c.currentTime = 2;
        const pending = await capture(audio);
        equal(pending.playback.voices.length, 1);
        equal(pending.playback.voices[0].ended, false);
        equal(pending.playback.voices[0].finishedAtCut, true);
        equal(pending.playback.voices[0].cursorSeconds, 1);
        c.sources[0].finish();
        const ended = await capture(audio);
        equal(ended.playback.voices[0].ended, true);
        const lease = await audioFileOwner(audio).prepare(ended, new ResourceBudget());
        try {
            equal(lease.activate().started, 0);
            equal((lease.owner as AudioManager).state().bgmPlaying, true);
            equal((await capture(lease.owner)).playback.voices[0].ended, true);
            equal(Context.all[Context.all.length - 1].resumes, 0);
        }
        finally {
            await lease.dispose();
        }
    });
});
test("audio malformed data is rejected before context creation; detached allocation/activation failures preserve live owner", async () => {
    await fixture(async (audio, c) => {
        audio.playSfx(1);
        audio.playUi(1);
        c.currentTime = .25;
        const original = await capture(audio);
        const before = Context.all.length;
        for (const change of [{ pitch: NaN }, { nominalPitch: .01 }, { buffer: 99 }, { gain: -1 }, { ended: true }, { finishedAtCut: true }]) {
            const malformed: ResourceAudioData = { ...original, playback: { ...original.playback, voices: [{ ...original.playback.voices[0], ...change }] } };
            await rejects(audioFileOwner(audio).prepare(malformed, new ResourceBudget()), /DATA/);
            equal(Context.all.length, before);
        }
        Context.failBuffer = true;
        await rejects(audioFileOwner(audio).prepare(original, new ResourceBudget()), /CAPABILITY/);
        equal(Context.all[Context.all.length - 1].closed, true);
        Context.failBuffer = false;
        const lease = await audioFileOwner(audio).prepare(original, new ResourceBudget());
        const next = Context.all[Context.all.length - 1];
        next.failStart = 2;
        throws(() => lease.activate(), /CAPABILITY/);
        await lease.dispose();
        equal(next.closed, true);
        equal(next.sources[0].starts.length, 1);
        equal(c.closed, false);
        equal(c.sources.every(s => s.stops.length === 0), true);
        deepEqual(await capture(audio), original);
    });
});
test("audio prepared target mutation invalidates activation; saved MAX_SAFE origin never rewinds new runtime", async () => {
    await fixture(async (audio, c) => {
        audio.playSfx(1);
        const original = await capture(audio), saved: ResourceAudioData = { ...original, generation: Number.MAX_SAFE_INTEGER,
            entries: original.entries.map(entry => ({ ...entry, generation: Number.MAX_SAFE_INTEGER })) };
        const lease = await audioFileOwner(audio).prepare(saved, new ResourceBudget());
        try {
            equal(lease.savedOrigin!.generation, Number.MAX_SAFE_INTEGER);
            ok(Number(lease.runtimeGeneration!()) < Number.MAX_SAFE_INTEGER);
            const prior = Number(lease.runtimeGeneration!());
            (lease.owner as AudioManager).setBusVolume("master", .5);
            equal(Number(lease.runtimeGeneration!()), prior + 1);
            throws(() => lease.activate(), /STALE/);
            equal(Context.all[Context.all.length - 1].sources.every(s => !s.starts.length), true);
            equal(c.closed, false);
            equal(original.generation, audioFileOwner(audio).revision());
            equal(saved.generation, Number.MAX_SAFE_INTEGER);
        }
        finally {
            await lease.dispose();
        }
    });
});
test("audio preparation uses one accumulating ledger with exact and one-below limits", async () => {
    await fixture(async (audio, c) => {
        audio.playBgm(1, { fadeInSeconds: 2 });
        audio.playSpatial(1, { x: 0, y: 0, loop: true }, 1, .01);
        const data = await capture(audio), budget = new ResourceBudget();
        const first = await audioFileOwner(audio).prepare(data, budget);
        await first.dispose();
        const u = budget.usage(), limits = { maxResources: u.resources, maxWork: u.work, maxMetadataBytes: u.metadataBytes, maxSourceBytes: u.sourceBytes, maxDecodedBytes: u.decodedBytes, maxGpuBytes: u.gpuBytes };
        const exactBudget = new ResourceBudget(limits), exact = await audioFileOwner(audio).prepare(data, exactBudget);
        deepEqual(exactBudget.usage(), u);
        await exact.dispose();
        for (const key of ["maxResources", "maxWork", "maxMetadataBytes", "maxSourceBytes", "maxDecodedBytes"] as const)
            await rejects(audioFileOwner(audio).prepare(data, new ResourceBudget({ ...limits, [key]: limits[key] - 1 })), /LIMIT/);
        equal(c.closed, false);
        deepEqual(await capture(audio), data);
        const b = new ResourceBudget({ maxWork: 1 });
        throws(() => copyFileAudioData(data, b), /LIMIT/);
    });
});
