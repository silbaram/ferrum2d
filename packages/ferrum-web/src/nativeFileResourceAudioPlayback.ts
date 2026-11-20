/** @internal Portable WebAudio intent, measured at one observed context clock.
 * This is not a DSP state/phase or waveform serialization. No frame polling. */
import { ResourceBudget, resourceFinite } from "./nativeFileResourceBudget.js";
import type { SpatialAudioOptions } from "./spatialAudio.js";
export interface ResourceAudioVoice {
    readonly kind: "sfx" | "ui" | "bgm" | "spatial";
    readonly soundId: number;
    readonly buffer: number;
    readonly currentBgm: boolean;
    readonly loop: boolean;
    readonly pitch: number;
    readonly nominalPitch: number;
    readonly nominalVolume: number;
    readonly cursorSeconds: number;
    readonly gain: number;
    readonly targetGain: number;
    readonly fadeRemainingSeconds: number;
    readonly stopRemainingSeconds: number | null;
    readonly ended: boolean;
    readonly finishedAtCut: boolean;
    readonly spatialized?: boolean;
    readonly spatial?: SpatialAudioOptions;
}
export interface ResourceAudioPlayback {
    readonly contextCreated: boolean;
    readonly contextState: string;
    readonly voices: readonly ResourceAudioVoice[];
    /** Last validated listener command, not a serialized browser AudioListener. */
    readonly listener: readonly number[];
}
export interface PlaybackRecord {
    readonly source: AudioBufferSourceNode;
    readonly gain: GainNode;
    readonly buffer: AudioBuffer;
    readonly kind: ResourceAudioVoice["kind"];
    readonly soundId: number;
    readonly nominalVolume: number;
    readonly nominalPitch: number;
    startedAt: number;
    offset: number;
    ended: boolean;
    stopAt?: number;
    ramp?: {
        readonly start: number;
        readonly end: number;
        readonly from: number;
        readonly to: number;
    };
    readonly spatial?: () => {
        readonly options: SpatialAudioOptions;
        readonly spatialized: boolean;
        readonly nominalVolume: number;
    };
}
export class AudioPlaybackTracker {
    private readonly records = new Map<AudioBufferSourceNode, PlaybackRecord>();
    private readonly cleanups = new Map<AudioBufferSourceNode, () => void>();
    constructor(private readonly currentBgm: (source: AudioBufferSourceNode) => boolean, private readonly changed: () => void, private readonly retained: (buffer: AudioBuffer) => void, private readonly released: (buffer: AudioBuffer) => void) { }
    track(input: Omit<PlaybackRecord, "ended">, ended = false): PlaybackRecord {
        const record = { ...input, ended };
        this.records.set(input.source, record);
        this.retained(record.buffer);
        const callback = () => {
            record.ended = true;
            this.changed();
            if (!this.currentBgm(record.source))
                this.remove(record.source);
        };
        const source = record.source;
        if (typeof source.addEventListener === "function") {
            source.addEventListener("ended", callback, { once: true });
            this.cleanups.set(source, () => source.removeEventListener("ended", callback));
        }
        else {
            // Test/custom AudioContext hosts can implement the legacy handler only.
            const previous = source.onended;
            const handler: NonNullable<AudioBufferSourceNode["onended"]> = event => { previous?.call(source, event); callback(); };
            source.onended = handler;
            this.cleanups.set(source, () => { if (source.onended === handler)
                source.onended = previous; });
        }
        this.changed();
        return record;
    }
    get(source: AudioBufferSourceNode): PlaybackRecord | undefined { return this.records.get(source); }
    stop(source: AudioBufferSourceNode, when: number): void {
        const record = this.records.get(source);
        if (!record)
            return;
        record.stopAt = when;
        this.changed();
        if (record.ended && !this.currentBgm(source))
            this.remove(source);
    }
    end(source: AudioBufferSourceNode): void {
        const record = this.records.get(source);
        if (!record)
            return;
        record.ended = true;
        this.changed();
        if (!this.currentBgm(source))
            this.remove(source);
    }
    remove(source: AudioBufferSourceNode): void {
        const record = this.records.get(source);
        if (!record)
            return;
        this.records.delete(source);
        this.cleanups.get(source)?.();
        this.cleanups.delete(source);
        this.released(record.buffer);
    }
    hasBuffer(buffer: AudioBuffer): boolean { for (const record of this.records.values())
        if (record.buffer === buffer)
            return true; return false; }
    *buffers(): IterableIterator<AudioBuffer> { for (const record of this.records.values())
        yield record.buffer; }
    clear(): void {
        for (const cleanup of this.cleanups.values())
            cleanup();
        this.cleanups.clear();
        for (const record of this.records.values())
            this.released(record.buffer);
        this.records.clear();
        this.changed();
    }
    snapshot(time: number, group: (buffer: AudioBuffer) => number, b: ResourceBudget): readonly ResourceAudioVoice[] {
        resourceFinite(time, "audio context time", 0);
        b.charge("resources", this.records.size);
        b.charge("metadataBytes", this.records.size * 25 * 8);
        b.work(this.records.size * 25);
        const voices: ResourceAudioVoice[] = [];
        for (const record of this.records.values()) {
            const pitch = resourceFinite(record.source.playbackRate.value, "audio pitch", 0);
            const duration = resourceFinite(record.buffer.length / record.buffer.sampleRate, "audio duration", Number.MIN_VALUE);
            const now = record.stopAt === undefined ? time : Math.min(time, record.stopAt);
            const rawCursor = record.offset + Math.max(0, now - record.startedAt) * pitch;
            resourceFinite(rawCursor, "audio cursor", 0);
            const loop = record.source.loop;
            const cursorSeconds = loop ? rawCursor % duration : Math.min(duration, rawCursor);
            const finishedAtCut = record.ended || record.stopAt !== undefined && record.stopAt <= time || !loop && rawCursor >= duration;
            const ramp = record.ramp;
            const fadeRemainingSeconds = ramp === undefined ? 0 : Math.max(0, ramp.end - time);
            const gain = ramp === undefined ? record.gain.gain.value : ramp.end <= ramp.start || time >= ramp.end ? ramp.to : time <= ramp.start ? ramp.from
                : ramp.from + (ramp.to - ramp.from) * ((time - ramp.start) / (ramp.end - ramp.start));
            const spatial = record.spatial?.();
            for (const value of [record.soundId, record.nominalVolume, gain, ramp?.to ?? gain, fadeRemainingSeconds,
                ...(record.stopAt === undefined ? [] : [Math.max(0, record.stopAt - time)])])
                resourceFinite(value, "audio intent");
            voices.push(Object.freeze({ kind: record.kind, soundId: record.soundId, buffer: group(record.buffer), currentBgm: this.currentBgm(record.source), loop, pitch,
                nominalVolume: spatial?.nominalVolume ?? record.nominalVolume, nominalPitch: record.nominalPitch, cursorSeconds, gain, targetGain: ramp?.to ?? gain, fadeRemainingSeconds,
                stopRemainingSeconds: record.stopAt === undefined ? null : Math.max(0, record.stopAt - time), ended: record.ended, finishedAtCut,
                ...(spatial === undefined ? {} : { spatialized: spatial.spatialized, spatial: { ...spatial.options,
                        ...(spatial.options.direction === undefined ? {} : { direction: { ...spatial.options.direction } }) } }) }));
        }
        return Object.freeze(voices);
    }
}
