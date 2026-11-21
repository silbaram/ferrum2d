import { copyFileAudioData } from "./nativeFileResourceAudio.js";
import type { ResourceAudioActivation, DetachedAudioResourceOwner } from "./nativeFileResourceOwners.js";
import { AudioPlaybackTracker } from "./nativeFileResourceAudioPlayback.js";
import { retainResourceCaptureFence, registerAudioFileOwner, captureResourceSource, fileResourceBlob, registerAudioSourceRetainer, type ResourceAudioData } from "./nativeFileResourceOwners.js";
import { ResourceBudget, resourceInteger, resourceFinite, NativeFileResourceError } from "./nativeFileResourceBudget.js";
import { startSpatialAudioVoice, spatialAudioFileView, observeSpatialAudioFileVoice, setAudioListenerPose, setAudioListenerPosition, validateSpatialAudioOptions, audioNumber, validateAudioListenerPose } from "./spatialAudio.js";
import type { SpatialAudioOptions, SpatialAudioVoice } from "./spatialAudio.js";
export type { SpatialAudioOptions, SpatialAudioVoice } from "./spatialAudio.js";
import { createAssetLoadScope, throwIfAssetLoadAborted } from "./assetLoadTasks.js";
import { AudioAssetLoader } from "./audioAssetLoader.js";
import {
  AUDIO_CHANNEL_BGM,
  AUDIO_CHANNEL_SFX,
  AUDIO_CHANNEL_UI,
} from "./audioEventDecoder.js";
import { audioPlaybackError, diagnosticError } from "./diagnostics.js";
import type { AudioEventBufferView, AudioEventView } from "./audioEventDecoder.js";

type AudioContextConstructor = new () => AudioContext;

interface WindowWithWebkitAudioContext extends Window {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
}

export type AudioBus = "master" | "bgm" | "sfx" | "ui";

export interface AudioManagerConfig {
  masterVolume?: number;
  bgmVolume?: number;
  sfxVolume?: number;
  uiVolume?: number;
}

export interface PlayBgmOptions {
  volume?: number;
  loop?: boolean;
  fadeMs?: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
}

export interface StopBgmOptions {
  fadeMs?: number;
  fadeOutSeconds?: number;
}

export interface AudioManagerState {
  masterVolume: number;
  bgmVolume: number;
  sfxVolume: number;
  uiVolume: number;
  spatialVoiceCount?: number;
  bgmPlaying: boolean;
  bgmSoundId?: number;
  bgmLoop: boolean;
}


function nonNegativeFinite(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.max(0, value);
}

function resolveFadeSeconds(seconds: number | undefined, fadeMs: number | undefined): number {
  const resolvedSeconds = nonNegativeFinite(seconds);
  if (resolvedSeconds !== undefined) {
    return resolvedSeconds;
  }
  const resolvedMs = nonNegativeFinite(fadeMs);
  return resolvedMs === undefined ? 0 : resolvedMs / 1000;
}

function normalizeAudioChannelId(channelId: number): number {
  if (!Number.isFinite(channelId)) {
    return AUDIO_CHANNEL_SFX;
  }
  const normalized = Math.trunc(channelId);
  if (normalized === AUDIO_CHANNEL_BGM || normalized === AUDIO_CHANNEL_UI) {
    return normalized;
  }
  return AUDIO_CHANNEL_SFX;
}

interface PreparedAudioHandoff {
  readonly source: AudioManager;
  readonly next: AudioManager;
  assertCurrent():void;
  transfer():void;
}
const preparedAudioHandoffs=new WeakMap<DetachedAudioResourceOwner,PreparedAudioHandoff>();
/** @internal Root supplies a new unpublished standard host. A file/caller
 * object cannot forge the lease or replace the tracker's lexical manager. */
export function adoptPreparedFileAudio(lease:DetachedAudioResourceOwner,expectedSource:AudioManager,install:(next:AudioManager)=>void):void {
  const handoff=preparedAudioHandoffs.get(lease);
  if(!handoff||handoff.source!==expectedSource)throw new NativeFileResourceError("STALE","sealed audio target");
  handoff.assertCurrent();install(handoff.next);handoff.transfer();expectedSource.destroy();
}

export class AudioManager {
  private readonly buffersById = new Map<number, AudioBuffer>();
  private retainedSources = new WeakMap<AudioBuffer, { blob: Blob; url: string }>();
  private fileRevision = 0;
  private readonly fileBufferRefs = new Map<AudioBuffer, number>();
  private readonly filePlayback = new AudioPlaybackTracker(source => this.currentBgm?.source === source,
    () => { this.fileRevision++; }, buffer => this.retainFileBuffer(buffer), buffer => this.releaseFileBuffer(buffer));
  private readonly fileListener = [0, 0, 0, 0, 0, -1, 0, 1, 0];
  private closing?: Promise<void>;
  private readonly assetLoader = new AudioAssetLoader(() => this.audioContext());
  private context?: AudioContext;
  private masterGain?: GainNode;
  private bgmGain?: GainNode;
  private sfxGain?: GainNode;
  private uiGain?: GainNode;
  private currentBgm?: {
    soundId: number;
    source: AudioBufferSourceNode;
    gain: GainNode;
    loop: boolean;
    volume: number;
  };
  private readonly volumes: Record<AudioBus, number> = {
    master: 1,
    bgm: 1,
    sfx: 1,
    ui: 1,
  };
  private readonly spatialVoices = new Map<SpatialAudioVoice, number>();
  private destroyed = false;
  private readonly pendingLoads = new Map<number, AbortController>();

  constructor() {
    registerAudioSourceRetainer(this.assetLoader, (buffer, blob, url) => { this.retainedSources.set(buffer, { blob, url }); });
    registerAudioFileOwner(this, {
      capture: budget => this.captureFileAudio(budget),
      prepare: (data, budget) => this.prepareFileAudio(data, budget),
      revision: () => this.fileRevision,
    });
  }

  private async captureFileAudio(budget: ResourceBudget): Promise<ResourceAudioData> {
    this.assertAlive(); if (this.pendingLoads.size) budget.fail("BUSY", "audio loads");
    const generation = this.fileRevision, context = this.context, clock = context?.currentTime ?? 0, contextState = context?.state ?? "none";
    budget.work(this.buffersById.size + this.fileBufferRefs.size + 13); budget.charge("metadataBytes",72);
    const volumes = [this.volumes.master, this.volumes.bgm, this.volumes.sfx, this.volumes.ui] as const;
    for (const value of volumes) resourceFinite(value, "audio volume", 0);
    for (const value of this.fileListener) resourceFinite(value, "audio listener");
    const groups = new Map<AudioBuffer, number>(), owned: { buffer: AudioBuffer; ids: number[] }[] = [];
    const group = (buffer: AudioBuffer): number => {
      let index = groups.get(buffer);
      if (index === undefined) { index = owned.length; groups.set(buffer, index); owned.push({ buffer, ids: [] }); }
      return index;
    };
    for (const [id, buffer] of this.buffersById) { resourceFinite(id, "sound id"); owned[group(buffer)].ids.push(id); }
    const voices = this.filePlayback.snapshot(clock, group, budget);
    budget.charge("resources", owned.length); budget.work(owned.length);
    // Copy every public mutable PCM buffer at the observed clock before awaits.
    const records = owned.map(({ buffer, ids }) => {
      const frames = resourceInteger(buffer.length, "audio frames", 1), count = resourceInteger(buffer.numberOfChannels, "audio channels", 1, 32);
      const sampleRate = resourceFinite(buffer.sampleRate, "sample rate", 3000, 384000);
      budget.work(count + ids.length); budget.charge("metadataBytes", ids.length * 8);
      const channels = [];
      for (let i = 0; i < count; i++) channels.push(budget.floats(buffer.getChannelData(i), frames));
      return { buffer, ids: Object.freeze(ids), frames, sampleRate, channels: Object.freeze(channels) };
    });
    const entries = [];
    for (const record of records) {
      const retained = this.retainedSources.get(record.buffer);
      const source = retained === undefined ? undefined : await captureResourceSource(retained, budget);
      entries.push(Object.freeze({ ids: record.ids, generation, sampleRate: record.sampleRate, frames: record.frames,
        channels: record.channels, ...(source === undefined ? {} : { source }) }));
    }
    this.assertAlive(); if (generation !== this.fileRevision || this.pendingLoads.size || context !== this.context) budget.fail("STALE", "audio capture");
    const assertCurrent=(b:ResourceBudget)=>{this.assertAlive();if(this.fileRevision!==generation||this.pendingLoads.size||this.context!==context)return b.fail("STALE","audio owner cut");
      for(const record of records){b.work(record.channels.length*record.frames);for(let i=0;i<record.channels.length;i++){const actual=record.buffer.getChannelData(i),saved=record.channels[i];for(let j=0;j<saved.length;j++)if(!Object.is(actual[j],saved[j]))return b.fail("STALE","mutable audio PCM cut");}}
    };assertCurrent(budget);
    const data=Object.freeze({ generation, entries: Object.freeze(entries), volumes: Object.freeze(volumes),
      playback: Object.freeze({ contextCreated: context !== undefined, contextState, voices,
        listener: Object.freeze([...this.fileListener]) }) });
    retainResourceCaptureFence(data,assertCurrent);return data;
  }

  private async prepareFileAudio(input: ResourceAudioData, budget: ResourceBudget): Promise<DetachedAudioResourceOwner> {
    this.assertAlive();
    if(this.pendingLoads.size)budget.fail("BUSY","audio target loads");
    const sourceRevision=this.fileRevision;
    const data = copyFileAudioData(input, budget);
    budget.work(data.entries.length); budget.charge("metadataBytes", data.entries.length * 8);
    const savedOrigin = Object.freeze({ version: 1 as const, generation: data.generation,
      resourceGenerations: Object.freeze(data.entries.map(entry => entry.generation)) });
    const next = new AudioManager(), buffers: AudioBuffer[] = [], staged: {
      readonly data: typeof data.playback.voices[number]; readonly source: AudioBufferSourceNode; readonly gain: GainNode;
      readonly spatial?: SpatialAudioVoice;
    }[] = [];
    let disposed = false, activated = false, transferred = false;
    try {
      // Browser allocations are separate from admitted staging PCM/source copies.
      if (data.playback.contextCreated) budget.charge("resources", 1);
      for (const entry of data.entries) {
        budget.charge("decodedBytes", entry.frames * entry.channels.length * 4); budget.work(entry.frames * entry.channels.length);
        const buffer = next.audioContext().createBuffer(entry.channels.length, entry.frames, entry.sampleRate); buffers.push(buffer);
        for (let i = 0; i < entry.channels.length; i++) buffer.copyToChannel(entry.channels[i], i);
        for (const id of entry.ids) { next.buffersById.set(id, buffer); next.retainFileBuffer(buffer); }
        if (entry.source) next.retainedSources.set(buffer, { url: entry.source.url, blob: fileResourceBlob(entry.source.bytes, entry.source.mime, budget) });
      }
      [next.volumes.master, next.volumes.bgm, next.volumes.sfx, next.volumes.ui] = data.volumes;
      for (let i = 0; i < 9; i++) next.fileListener[i] = data.playback.listener[i];
      if (data.playback.contextCreated) {
        const context = next.audioContext();
        if (context.state === "running") await context.suspend();
        if (context.state !== "suspended") budget.fail("CAPABILITY", "new suspended audio context");
        // Default listener is already correct; other commands use the same SDK writer.
        const defaults = [0,0,0,0,0,-1,0,1,0];
        if (next.fileListener.some((value, i) => value !== defaults[i])) {
          const p = next.fileListener; setAudioListenerPose(context,p[0],p[1],p[2],p[3],p[4],p[5],p[6],p[7],p[8]);
        }
        if (data.playback.voices.length) {
          budget.charge("resources", 4); const mixer = next.ensureMixer(context);
          for (const voiceData of data.playback.voices) {
            const buffer = buffers[voiceData.buffer]; budget.charge("resources", voiceData.kind === "spatial" && voiceData.spatialized ? 3 : 2);
            let source: AudioBufferSourceNode, gain: GainNode, spatial: SpatialAudioVoice | undefined;
            if (voiceData.kind === "spatial") {
              let createdSource: AudioBufferSourceNode | undefined;
              spatial = startSpatialAudioVoice(context,buffer,mixer.sfx,voiceData.spatial!,voiceData.nominalVolume,voiceData.nominalPitch,
                ended => { next.spatialVoices.delete(ended); if(createdSource) next.filePlayback.end(createdSource); },
                { deferred: true, forceUnspatialized: !voiceData.spatialized });
              const view = spatialAudioFileView(spatial);
              if (!view || view.spatialized !== voiceData.spatialized) budget.fail("CAPABILITY", "spatial audio target");
              source = view!.source; gain = view!.gain; createdSource = source; source.playbackRate.value = voiceData.pitch;
              next.spatialVoices.set(spatial,voiceData.soundId); observeSpatialAudioFileVoice(spatial,()=>{next.fileRevision++;});
            } else {
              source = context.createBufferSource(); gain = context.createGain(); source.buffer = buffer;
              source.playbackRate.value = voiceData.pitch; source.loop = voiceData.loop;
              source.connect(gain); gain.connect(voiceData.kind === "bgm" ? mixer.bgm : voiceData.kind === "ui" ? mixer.ui : mixer.sfx);
            }
            gain.gain.value = voiceData.gain;
            const currentSpatial = spatial;
            next.filePlayback.track({ source,gain,buffer,kind:voiceData.kind,soundId:voiceData.soundId,nominalVolume:voiceData.nominalVolume,nominalPitch:voiceData.nominalPitch,
              startedAt:context.currentTime,offset:voiceData.cursorSeconds,
              ...(voiceData.kind !== "spatial" ? {} : { spatial:()=>{
                const v = currentSpatial && spatialAudioFileView(currentSpatial);
                return v ?? {options:voiceData.spatial!,spatialized:voiceData.spatialized!,nominalVolume:voiceData.nominalVolume};
              } }) },voiceData.ended);
            if (voiceData.currentBgm) next.currentBgm = {soundId:voiceData.soundId,source,gain,loop:voiceData.loop,volume:voiceData.nominalVolume};
            staged.push({data:voiceData,source,gain,...(spatial === undefined ? {} : {spatial})});
          }
        }
      }
      next.fileRevision++;
      const preparedRevision = next.fileRevision;
      const lease=Object.freeze({owner:next,savedOrigin,runtimeGeneration:()=>next.fileRevision,
        activate:():ResourceAudioActivation=>{
          if(disposed||activated||next.destroyed||next.fileRevision!==preparedRevision||next.pendingLoads.size) throw new NativeFileResourceError("STALE","audio activation");
          let started=0;const context=next.context;
          try{
            for(const row of staged){
              const record=next.filePlayback.get(row.source)!;
              if(row.data.finishedAtCut){
                if(row.spatial) row.spatial.stop(); else { next.filePlayback.end(row.source); if(!row.data.currentBgm){row.source.disconnect();row.gain.disconnect();} }
                continue;
              }
              const now=context!.currentTime;record.startedAt=now;record.offset=row.data.cursorSeconds;
              row.gain.gain.cancelScheduledValues(now);row.gain.gain.setValueAtTime(row.data.gain,now);
              if(row.data.fadeRemainingSeconds>0) row.gain.gain.linearRampToValueAtTime(row.data.targetGain,now+row.data.fadeRemainingSeconds);
              if(row.data.kind==="bgm") record.ramp={start:now,end:now+row.data.fadeRemainingSeconds,from:row.data.gain,to:row.data.targetGain};
              row.source.start(0,row.data.cursorSeconds);started++;
              if(row.data.stopRemainingSeconds!==null){row.source.stop(now+row.data.stopRemainingSeconds);next.filePlayback.stop(row.source,now+row.data.stopRemainingSeconds);}
            }
            activated=true;staged.length=0;if(context&&started) next.resumeIfSuspended(context);
            return Object.freeze({started,contextState:context?.state??"none",waitingForGesture:started>0&&context?.state!=="running"});
          }catch(error){disposed=true;staged.length=0;next.destroy();throw new NativeFileResourceError("CAPABILITY","audio activation");}
        },
        dispose:async()=>{if(!disposed&&!transferred){disposed=true;staged.length=0;next.destroy();}if(disposed||next.destroyed)await next.closing;}
      });
      preparedAudioHandoffs.set(lease,{source:this,next,
        assertCurrent:()=>{
          if(disposed||activated||transferred||this.destroyed||this.pendingLoads.size||this.fileRevision!==sourceRevision
            ||next.destroyed||next.pendingLoads.size||next.fileRevision!==preparedRevision)
            throw new NativeFileResourceError("STALE","audio handoff lifecycle");
        },transfer:()=>{transferred=true;}});
      return lease;
    } catch(error){disposed=true;staged.length=0;next.destroy();await next.closing;if(error instanceof NativeFileResourceError) throw error;throw new NativeFileResourceError("CAPABILITY","audio resource/graph preparation");}
  }

  async loadSound(soundId: number, url: string, options: { signal?: AbortSignal } = {}): Promise<AudioBuffer> {
    this.assertAlive();
    const scope = createAssetLoadScope(options.signal);
    const signal = scope.controller.signal;
    try {
      throwIfAssetLoadAborted(signal);
      const previous = this.pendingLoads.get(soundId);
      // Abort listeners run synchronously and may start a newer load or destroy us.
      // Publish this request first so reentrant work can cancel it, too.
      this.pendingLoads.set(soundId, scope.controller);
      previous?.abort();
      throwIfAssetLoadAborted(signal);
      this.assertAlive();
      const buffer = await this.assetLoader.load(soundId, url, { signal });
      throwIfAssetLoadAborted(signal);
      this.assertAlive();
      const previousBuffer = this.buffersById.get(soundId);
      this.buffersById.set(soundId, buffer);
      this.fileRevision++;
      if (previousBuffer !== buffer) {
        this.retainFileBuffer(buffer);
        if (previousBuffer) this.releaseFileBuffer(previousBuffer);
      }
      return buffer;
    } finally {
      if (this.pendingLoads.get(soundId) === scope.controller) this.pendingLoads.delete(soundId);
      scope.dispose();
    }
  }

  hasSound(soundId: number): boolean {
    this.assertAlive();
    return this.buffersById.has(Math.trunc(soundId));
  }

  evictSound(soundId: number): boolean {
    this.assertAlive();
    const normalizedSoundId = Math.trunc(soundId);
    this.pendingLoads.get(normalizedSoundId)?.abort();
    if (normalizedSoundId <= 0 || !this.buffersById.has(normalizedSoundId)) {
      return false;
    }
    for (const [voice, id] of this.spatialVoices) if (id === normalizedSoundId) voice.stop();
    if (this.currentBgm?.soundId === normalizedSoundId) {
      this.stopBgm();
    }
    const previousBuffer = this.buffersById.get(normalizedSoundId);
    const deleted = this.buffersById.delete(normalizedSoundId);
    this.fileRevision++;
    if (previousBuffer) this.releaseFileBuffer(previousBuffer);
    return deleted;
  }

  setBusVolume(bus: AudioBus, volume: number): void {
    this.assertAlive();
    const gain = Math.max(0, volume);
    this.volumes[bus] = gain;
    this.fileRevision++;
    const context = this.audioContext();
    const mixer = this.ensureMixer(context);
    const now = context.currentTime;

    if (bus === "master") mixer.master.gain.setValueAtTime(gain, now);
    if (bus === "bgm") mixer.bgm.gain.setValueAtTime(gain, now);
    if (bus === "sfx") mixer.sfx.gain.setValueAtTime(gain, now);
    if (bus === "ui") mixer.ui.gain.setValueAtTime(gain, now);
  }

  configure(config: AudioManagerConfig): void {
    this.assertAlive();
    if (config.masterVolume !== undefined) this.setBusVolume("master", config.masterVolume);
    if (config.bgmVolume !== undefined) this.setBusVolume("bgm", config.bgmVolume);
    if (config.sfxVolume !== undefined) this.setBusVolume("sfx", config.sfxVolume);
    if (config.uiVolume !== undefined) this.setBusVolume("ui", config.uiVolume);
  }

  async unlock(): Promise<boolean> {
    this.assertAlive();
    const context = this.audioContext();
    this.ensureMixer(context);
    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch {
        return false;
      }
    }
    return context.state === "running";
  }

  play(soundId: number, volume = 1.0, pitch = 1.0): void {
    this.playSfx(soundId, volume, pitch);
  }

  playSfx(soundId: number, volume = 1.0, pitch = 1.0): void {
    this.playOneShot(soundId, volume, pitch, "sfx");
  }

  playUi(soundId: number, volume = 1.0, pitch = 1.0): void {
    this.playOneShot(soundId, volume, pitch, "ui");
  }

  private playOneShot(soundId: number, volume: number, pitch: number, bus: "sfx" | "ui"): void {
    this.assertAlive();
    if (soundId <= 0) {
      return;
    }

    const buffer = this.requireBuffer(soundId);
    const context = this.audioContext();
    const mixer = this.ensureMixer(context);
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.01, pitch);
    gain.gain.value = Math.max(0.0, volume);
    source.connect(gain);
    gain.connect(bus === "ui" ? mixer.ui : mixer.sfx);

    this.resumeIfSuspended(context);
    this.filePlayback.track({ source, gain, buffer, kind: bus, soundId, nominalVolume: Math.max(0, volume), nominalPitch: Math.max(.01,pitch),
      startedAt: context.currentTime, offset: 0 });
    try { source.start(); }
    catch (error) {
      this.filePlayback.remove(source);
      for (const node of [source, gain]) { try { node.disconnect(); } catch { /* Creation did not publish a voice. */ } }
      throw error;
    }
  }

  /** A bounded, explicitly stoppable spatial SFX voice; unavailable PannerNode falls back to SFX. */
  playSpatial(soundId: number, spatial: SpatialAudioOptions, volume = 1, pitch = 1): SpatialAudioVoice | undefined {
    this.assertAlive();
    if (soundId <= 0) return undefined;
    if (this.spatialVoices.size >= 64) throw new Error("Spatial audio voice limit 64 exceeded.");
    validateSpatialAudioOptions(spatial); audioNumber(volume, "volume", 0, 16); audioNumber(pitch, "pitch", .01, 16);
    const buffer = this.requireBuffer(soundId), context = this.audioContext(), mixer = this.ensureMixer(context);
    let source: AudioBufferSourceNode | undefined;
    const voice = startSpatialAudioVoice(context, buffer, mixer.sfx, spatial, volume, pitch, v => {
      this.spatialVoices.delete(v); if (source) this.filePlayback.end(source);
    });
    if (voice.active) {
      this.spatialVoices.set(voice, soundId);
      const view = spatialAudioFileView(voice);
      if (view) {
        source = view.source;
        this.filePlayback.track({ source: view.source, gain: view.gain, buffer, kind: "spatial", soundId, nominalVolume: volume, nominalPitch: pitch,
          startedAt: view.startedAt, offset: 0, spatial: () => {
            const current = spatialAudioFileView(voice);
            return current === undefined ? { options: spatial, spatialized: voice.spatialized, nominalVolume: volume } : current;
          } });
        observeSpatialAudioFileVoice(voice, () => { this.fileRevision++; });
      }
    }
    this.resumeIfSuspended(context);
    return voice;
  }

  playBgm(soundId: number, options: PlayBgmOptions = {}): void {
    this.assertAlive();
    if (soundId <= 0) {
      return;
    }

    const buffer = this.requireBuffer(soundId);
    const context = this.audioContext();
    const mixer = this.ensureMixer(context);
    const now = context.currentTime;
    this.stopBgm({ fadeOutSeconds: resolveFadeSeconds(options.fadeOutSeconds, options.fadeMs) });

    const source = context.createBufferSource();
    const gain = context.createGain();
    const volume = Math.max(0, options.volume ?? 1);
    const fadeInSeconds = resolveFadeSeconds(options.fadeInSeconds, options.fadeMs);
    source.buffer = buffer;
    source.loop = options.loop ?? true;
    gain.gain.cancelScheduledValues(now);
    if (fadeInSeconds > 0) {
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(volume, now + fadeInSeconds);
    } else {
      gain.gain.setValueAtTime(volume, now);
    }
    source.connect(gain);
    gain.connect(mixer.bgm);

    this.currentBgm = {
      soundId,
      source,
      gain,
      loop: source.loop,
      volume,
    };
    this.resumeIfSuspended(context);
    this.filePlayback.track({ source, gain, buffer, kind: "bgm", soundId, nominalVolume: volume, nominalPitch: 1,
      startedAt: context.currentTime, offset: 0, ramp: { start: now, end: now + fadeInSeconds,
        from: fadeInSeconds > 0 ? 0 : gain.gain.value, to: Math.fround(volume) } });
    try { source.start(); }
    catch (error) {
      this.filePlayback.end(source);
      for (const node of [source, gain]) { try { node.disconnect(); } catch { /* Creation did not publish a voice. */ } }
      throw error;
    }
  }

  stopBgm(options: StopBgmOptions = {}): void {
    this.assertAlive();
    const bgm = this.currentBgm;
    if (!bgm) {
      return;
    }
    this.currentBgm = undefined;
    const context = this.audioContext();
    const now = context.currentTime;
    const fadeOutSeconds = resolveFadeSeconds(options.fadeOutSeconds, options.fadeMs);
    const record = this.filePlayback.get(bgm.source);
    if (record) record.ramp = { start: now, end: now + fadeOutSeconds, from: Math.fround(bgm.volume), to: 0 };
    this.filePlayback.stop(bgm.source, now + fadeOutSeconds);
    try {
      bgm.gain.gain.cancelScheduledValues(now);
      if (fadeOutSeconds > 0) {
        bgm.gain.gain.setValueAtTime(bgm.volume, now);
        bgm.gain.gain.linearRampToValueAtTime(0, now + fadeOutSeconds);
        bgm.source.stop(now + fadeOutSeconds);
      } else {
        bgm.gain.gain.setValueAtTime(0, now);
        bgm.source.stop();
      }
    } catch {
      // AudioBufferSourceNode.stop() can throw if the browser already ended the source.
    }
  }

  setListenerPosition(x: number, y: number, z = 0): void {
    this.assertAlive();
    audioNumber(x, "listener.x"); audioNumber(y, "listener.y"); audioNumber(z, "listener.z");
    setAudioListenerPosition(this.audioContext(), x, y, z);
    this.fileListener[0] = x; this.fileListener[1] = y; this.fileListener[2] = z; this.fileRevision++;
  }

  /** Forward defaults -Z, up defaults +Y, matching Web Audio's default listener. */
  setListenerPose(x: number, y: number, z: number, fx = 0, fy = 0, fz = -1, ux = 0, uy = 1, uz = 0): void {
    this.assertAlive();
    validateAudioListenerPose(x, y, z, fx, fy, fz, ux, uy, uz);
    setAudioListenerPose(this.audioContext(), x, y, z, fx, fy, fz, ux, uy, uz);
    this.fileListener[0] = x; this.fileListener[1] = y; this.fileListener[2] = z;
    this.fileListener[3] = fx; this.fileListener[4] = fy; this.fileListener[5] = fz;
    this.fileListener[6] = ux; this.fileListener[7] = uy; this.fileListener[8] = uz; this.fileRevision++;
  }

  playEvents(events: readonly AudioEventView[]): void {
    this.assertAlive();
    for (const event of events) {
      this.playAudioEvent(event.soundId, event.volume, event.pitch, event.channelId ?? AUDIO_CHANNEL_SFX);
    }
  }

  playEventBuffer(events: AudioEventBufferView): void {
    this.assertAlive();
    for (let i = 0; i < events.eventCount; i += 1) {
      const offset = i * events.floatsPerEvent;
      this.playAudioEvent(
        Math.trunc(events.buffer[offset]),
        events.buffer[offset + 1],
        events.buffer[offset + 2],
        events.floatsPerEvent > 3 ? events.buffer[offset + 3] : AUDIO_CHANNEL_SFX,
      );
    }
  }

  private playAudioEvent(soundId: number, volume: number, pitch: number, channelId: number): void {
    const normalizedChannelId = normalizeAudioChannelId(channelId);
    if (normalizedChannelId === AUDIO_CHANNEL_BGM) {
      this.playBgm(soundId, { volume });
      return;
    }
    if (normalizedChannelId === AUDIO_CHANNEL_UI) {
      this.playUi(soundId, volume, pitch);
      return;
    }
    this.playSfx(soundId, volume, pitch);
  }

  state(): AudioManagerState {
    this.assertAlive();
    return {
      masterVolume: this.volumes.master,
      bgmVolume: this.volumes.bgm,
      sfxVolume: this.volumes.sfx,
      uiVolume: this.volumes.ui,
      spatialVoiceCount: this.spatialVoices.size,
      bgmPlaying: this.currentBgm !== undefined,
      ...(this.currentBgm === undefined ? {} : {
        bgmSoundId: this.currentBgm.soundId,
      }),
      bgmLoop: this.currentBgm?.loop ?? false,
    };
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const controller of this.pendingLoads.values()) controller.abort();
    this.pendingLoads.clear();
    for (const voice of this.spatialVoices.keys()) voice.stop();
    this.spatialVoices.clear();
    const context = this.context;
    this.context = undefined;
    this.masterGain = undefined;
    this.bgmGain = undefined;
    this.sfxGain = undefined;
    this.uiGain = undefined;
    this.currentBgm = undefined;
    this.filePlayback.clear();
    for (const buffer of this.buffersById.values()) this.releaseFileBuffer(buffer);
    this.buffersById.clear();
    this.fileBufferRefs.clear();
    this.retainedSources = new WeakMap();
    this.fileRevision++;
    if (context && context.state !== "closed") {
      this.closing = context.close().catch(() => undefined);
    }
  }

  private retainFileBuffer(buffer: AudioBuffer): void {
    this.fileBufferRefs.set(buffer, (this.fileBufferRefs.get(buffer) ?? 0) + 1);
  }
  private releaseFileBuffer(buffer: AudioBuffer): void {
    const next = (this.fileBufferRefs.get(buffer) ?? 1) - 1;
    if (next > 0) this.fileBufferRefs.set(buffer, next);
    else { this.fileBufferRefs.delete(buffer); this.retainedSources.delete(buffer); }
  }

  private requireBuffer(soundId: number): AudioBuffer {
    const buffer = this.buffersById.get(soundId);
    if (!buffer) {
      throw audioPlaybackError({
        kind: "sound",
        id: soundId,
        detail: "Sound is not loaded. Check the sounds manifest passed to loadAssets().",
      });
    }
    return buffer;
  }

  private audioContext(): AudioContext {
    this.assertAlive();
    if (this.context) {
      return this.context;
    }

    const browserWindow = (globalThis as typeof globalThis & { window?: WindowWithWebkitAudioContext }).window;
    const constructor = browserWindow?.AudioContext ?? browserWindow?.webkitAudioContext;
    if (!constructor) {
      throw diagnosticError("Audio context error", {
        kind: "sound",
        detail: "Web Audio API is not available in this browser",
      }, "FERRUM_AUDIO_CONTEXT");
    }

    this.context = new constructor();
    return this.context;
  }

  private ensureMixer(context: AudioContext): { master: GainNode; bgm: GainNode; sfx: GainNode; ui: GainNode } {
    if (this.masterGain && this.bgmGain && this.sfxGain && this.uiGain) {
      return {
        master: this.masterGain,
        bgm: this.bgmGain,
        sfx: this.sfxGain,
        ui: this.uiGain,
      };
    }

    this.masterGain = context.createGain();
    this.bgmGain = context.createGain();
    this.sfxGain = context.createGain();
    this.uiGain = context.createGain();

    this.masterGain.gain.value = this.volumes.master;
    this.bgmGain.gain.value = this.volumes.bgm;
    this.sfxGain.gain.value = this.volumes.sfx;
    this.uiGain.gain.value = this.volumes.ui;

    this.bgmGain.connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);
    this.uiGain.connect(this.masterGain);
    this.masterGain.connect(context.destination);

    return {
      master: this.masterGain,
      bgm: this.bgmGain,
      sfx: this.sfxGain,
      ui: this.uiGain,
    };
  }

  private resumeIfSuspended(context: AudioContext): void {
    if (context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("AudioManager has been destroyed.");
    }
  }
}
