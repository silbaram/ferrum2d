/** @internal Complete typed portable audio payload admission before graph creation. */
import { ResourceBudget, resourceInteger, resourceFinite, resourceKeys } from "./nativeFileResourceBudget.js";
import { validateAudioListenerPose, validateSpatialAudioOptions } from "./spatialAudio.js";
import type { ResourceAudioData, ResourceSourceBytes } from "./nativeFileResourceOwners.js";
export function copyFileAudioData(data: ResourceAudioData, b: ResourceBudget): ResourceAudioData {
    resourceKeys(data, ["generation", "entries", "volumes", "playback"], b);
    resourceInteger(data.generation, "audio saved generation", 0, Number.MAX_SAFE_INTEGER);
    if (!Array.isArray(data.entries) || !Array.isArray(data.volumes) || data.volumes.length !== 4)
        b.fail("DATA", "audio collections");
    b.charge("resources", data.entries.length);
    b.work(data.entries.length + 4);
    const volumes = data.volumes.map((v: number) => resourceFinite(v, "audio bus volume", 0));
    const ids = new Set<number>(), sourceCopies = new Map<object, ResourceSourceBytes>();
    const entries = data.entries.map(entry => {
        resourceKeys(entry, ["ids", "generation", "sampleRate", "frames", "channels", "source"], b);
        resourceInteger(entry.generation, "audio buffer generation", 0, data.generation);
        if (!Array.isArray(entry.ids) || !Array.isArray(entry.channels))
            b.fail("DATA", "audio aliases/channels");
        b.work(entry.ids.length);
        b.charge("metadataBytes", entry.ids.length * 8);
        const aliases = entry.ids.map((id: number) => { resourceFinite(id, "sound id"); if (ids.has(id))
            b.fail("DATA", "duplicate sound id"); ids.add(id); return id; });
        const frames = resourceInteger(entry.frames, "audio frames", 1), count = resourceInteger(entry.channels.length, "audio channels", 1, 32);
        const sampleRate = resourceFinite(entry.sampleRate, "audio sample rate", 3000, 384000);
        b.work(count);
        const channels = entry.channels.map((samples: Float32Array) => b.floats(samples, frames));
        let source;
        if (entry.source) {
            source = sourceCopies.get(entry.source);
            if (!source) {
                resourceKeys(entry.source, ["url", "mime", "bytes"], b);
                b.metadata(entry.source.url);
                b.metadata(entry.source.mime);
                source = Object.freeze({ url: entry.source.url, mime: entry.source.mime, bytes: b.bytes(entry.source.bytes, "sourceBytes") });
                sourceCopies.set(entry.source, source);
            }
        }
        return Object.freeze({ ids: Object.freeze(aliases), generation: entry.generation, frames, sampleRate, channels: Object.freeze(channels), ...(source === undefined ? {} : { source }) });
    });
    const p = data.playback;
    resourceKeys(p, ["contextCreated", "contextState", "voices", "listener"], b);
    if (typeof p.contextCreated !== "boolean" || !["none", "running", "suspended", "closed", "interrupted"].includes(p.contextState)
        || !Array.isArray(p.voices) || !Array.isArray(p.listener) || p.listener.length !== 9)
        b.fail("DATA", "audio playback metadata");
    if (!p.contextCreated && (entries.length || p.voices.length || p.contextState !== "none") || p.contextCreated && p.contextState === "none")
        b.fail("DATA", "audio context relation");
    b.work(9);
    b.charge("metadataBytes", 72);
    const listener = p.listener.map((v: number) => resourceFinite(v, "audio listener"));
    try {
        validateAudioListenerPose(listener[0], listener[1], listener[2], listener[3], listener[4], listener[5], listener[6], listener[7], listener[8]);
    }
    catch {
        return b.fail("DATA", "listener pose");
    }
    b.charge("resources", p.voices.length);
    b.work(p.voices.length * 25);
    const referenced = new Set<number>();
    let bgms = 0, spatialCount = 0;
    const voices = p.voices.map(voice => {
        resourceKeys(voice, ["kind", "soundId", "buffer", "currentBgm", "loop", "pitch", "nominalPitch", "nominalVolume", "cursorSeconds", "gain", "targetGain", "fadeRemainingSeconds",
            "stopRemainingSeconds", "ended", "finishedAtCut", "spatialized", "spatial"], b);
        if (!["sfx", "ui", "bgm", "spatial"].includes(voice.kind) || typeof voice.loop !== "boolean" || typeof voice.currentBgm !== "boolean"
            || typeof voice.ended !== "boolean" || typeof voice.finishedAtCut !== "boolean")
            b.fail("DATA", "audio voice tags");
        resourceFinite(voice.soundId, "voice sound id");
        const buffer = resourceInteger(voice.buffer, "voice buffer", 0, entries.length - 1);
        referenced.add(buffer);
        const duration = entries[buffer].frames / entries[buffer].sampleRate;
        resourceFinite(voice.cursorSeconds, "voice cursor", 0, duration);
        resourceFinite(voice.pitch, "voice pitch", 0);
        resourceFinite(voice.nominalPitch, "voice nominal pitch", .01);
        if (!Number.isFinite(Math.fround(voice.nominalPitch)) || voice.pitch !== Math.fround(voice.nominalPitch))
            b.fail("DATA", "voice rate/intent relation");
        for (const v of [voice.nominalVolume, voice.gain, voice.targetGain, voice.fadeRemainingSeconds])
            resourceFinite(v, "voice gain/fade", 0);
        if (voice.stopRemainingSeconds !== null)
            resourceFinite(voice.stopRemainingSeconds, "voice stop", 0);
        if (voice.finishedAtCut !== (voice.ended || voice.stopRemainingSeconds === 0 || !voice.loop && voice.cursorSeconds >= duration))
            b.fail("DATA", "voice terminal relation");
        if (voice.currentBgm && (voice.kind !== "bgm" || ++bgms > 1))
            b.fail("DATA", "current BGM");
        if (voice.kind !== "bgm" && (voice.fadeRemainingSeconds !== 0 || voice.gain !== voice.targetGain))
            b.fail("DATA", "non-BGM envelope");
        let spatial;
        if (voice.kind === "spatial") {
            if (++spatialCount > 64)
                b.fail("DATA", "spatial voice count");
            if (!voice.spatial || typeof voice.spatialized !== "boolean")
                b.fail("DATA", "spatial voice");
            resourceKeys(voice.spatial, ["x", "y", "z", "refDistance", "maxDistance", "rolloffFactor", "distanceModel", "panningModel", "direction", "coneInnerAngle", "coneOuterAngle", "coneOuterGain", "loop"], b);
            if (voice.spatial.direction)
                resourceKeys(voice.spatial.direction, ["x", "y", "z"], b);
            try {
                validateSpatialAudioOptions(voice.spatial);
            }
            catch {
                return b.fail("DATA", "spatial pose/options");
            }
            if ((voice.spatial.loop ?? false) !== voice.loop || voice.nominalVolume > 16 || voice.nominalPitch < .01 || voice.nominalPitch > 16)
                b.fail("DATA", "spatial source relation");
            spatial = Object.freeze({ ...voice.spatial, ...(voice.spatial.direction === undefined ? {} : { direction: Object.freeze({ ...voice.spatial.direction }) }) });
        }
        else if (voice.spatial !== undefined || voice.spatialized !== undefined)
            b.fail("DATA", "nonspatial fields");
        return Object.freeze({ ...voice, ...(spatial === undefined ? {} : { spatial }) });
    });
    for (let i = 0; i < entries.length; i++)
        if (!entries[i].ids.length && !referenced.has(i))
            b.fail("DATA", "unowned audio buffer");
    // Fixed tuple shape was admitted above; copy is private/stable for this plan.
    return Object.freeze({ generation: data.generation, entries: Object.freeze(entries), volumes: Object.freeze([volumes[0], volumes[1], volumes[2], volumes[3]] as const),
        playback: Object.freeze({ contextCreated: p.contextCreated, contextState: p.contextState, listener: Object.freeze(listener), voices: Object.freeze(voices) }) });
}
