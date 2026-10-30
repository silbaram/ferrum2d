import { startSpatialAudioVoice, setAudioListenerPose, setAudioListenerPosition, validateSpatialAudioOptions, audioNumber, validateAudioListenerPose } from "./spatialAudio.js";
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

export class AudioManager {
  private readonly buffersById = new Map<number, AudioBuffer>();
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
      this.buffersById.set(soundId, buffer);
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
    return this.buffersById.delete(normalizedSoundId);
  }

  setBusVolume(bus: AudioBus, volume: number): void {
    this.assertAlive();
    const gain = Math.max(0, volume);
    this.volumes[bus] = gain;
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
    source.start();
  }

  /** A bounded, explicitly stoppable spatial SFX voice; unavailable PannerNode falls back to SFX. */
  playSpatial(soundId: number, spatial: SpatialAudioOptions, volume = 1, pitch = 1): SpatialAudioVoice | undefined {
    this.assertAlive();
    if (soundId <= 0) return undefined;
    if (this.spatialVoices.size >= 64) throw new Error("Spatial audio voice limit 64 exceeded.");
    validateSpatialAudioOptions(spatial); audioNumber(volume, "volume", 0, 16); audioNumber(pitch, "pitch", .01, 16);
    const buffer = this.requireBuffer(soundId), context = this.audioContext(), mixer = this.ensureMixer(context);
    const voice = startSpatialAudioVoice(context, buffer, mixer.sfx, spatial, volume, pitch, v => this.spatialVoices.delete(v));
    if (voice.active) this.spatialVoices.set(voice, soundId);
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
    source.start();
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
  }

  /** Forward defaults -Z, up defaults +Y, matching Web Audio's default listener. */
  setListenerPose(x: number, y: number, z: number, fx = 0, fy = 0, fz = -1, ux = 0, uy = 1, uz = 0): void {
    this.assertAlive();
    validateAudioListenerPose(x, y, z, fx, fy, fz, ux, uy, uz);
    setAudioListenerPose(this.audioContext(), x, y, z, fx, fy, fz, ux, uy, uz);
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
    this.buffersById.clear();
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
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
