import { AudioAssetLoader } from "./audioAssetLoader.js";
import { audioPlaybackError, diagnosticError } from "./diagnostics.js";
import type { AudioEventView } from "./wasmBridge";

type AudioContextConstructor = new () => AudioContext;

interface WindowWithWebkitAudioContext extends Window {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
}

export interface SpatialAudioOptions {
  x: number;
  y: number;
  z?: number;
  refDistance?: number;
  maxDistance?: number;
  rolloffFactor?: number;
}

export type AudioBus = "master" | "bgm" | "sfx";

export interface AudioManagerConfig {
  masterVolume?: number;
  bgmVolume?: number;
  sfxVolume?: number;
}

export class AudioManager {
  private readonly buffersById = new Map<number, AudioBuffer>();
  private readonly assetLoader = new AudioAssetLoader(() => this.audioContext());
  private context?: AudioContext;
  private masterGain?: GainNode;
  private bgmGain?: GainNode;
  private sfxGain?: GainNode;
  private listenerX = 0;
  private listenerY = 0;
  private listenerZ = 0;
  private bgmSource?: AudioBufferSourceNode;
  private destroyed = false;

  async loadSound(soundId: number, url: string): Promise<AudioBuffer> {
    this.assertAlive();
    const buffer = await this.assetLoader.load(soundId, url);
    this.assertAlive();
    this.buffersById.set(soundId, buffer);
    return buffer;
  }

  setBusVolume(bus: AudioBus, volume: number): void {
    this.assertAlive();
    const gain = Math.max(0, volume);
    const context = this.audioContext();
    const mixer = this.ensureMixer(context);
    const now = context.currentTime;

    if (bus === "master") mixer.master.gain.setValueAtTime(gain, now);
    if (bus === "bgm") mixer.bgm.gain.setValueAtTime(gain, now);
    if (bus === "sfx") mixer.sfx.gain.setValueAtTime(gain, now);
  }

  configure(config: AudioManagerConfig): void {
    this.assertAlive();
    if (config.masterVolume !== undefined) this.setBusVolume("master", config.masterVolume);
    if (config.bgmVolume !== undefined) this.setBusVolume("bgm", config.bgmVolume);
    if (config.sfxVolume !== undefined) this.setBusVolume("sfx", config.sfxVolume);
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
    gain.connect(mixer.sfx);

    this.resumeIfSuspended(context);
    source.start();
  }

  playSpatial(soundId: number, spatial: SpatialAudioOptions, volume = 1.0, pitch = 1.0): void {
    this.assertAlive();
    if (soundId <= 0) {
      return;
    }

    const buffer = this.requireBuffer(soundId);
    const context = this.audioContext();
    const mixer = this.ensureMixer(context);
    const source = context.createBufferSource();
    const gain = context.createGain();
    const panner = context.createPanner();

    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.01, pitch);
    gain.gain.value = Math.max(0.0, volume);

    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = spatial.refDistance ?? 96;
    panner.maxDistance = spatial.maxDistance ?? 2400;
    panner.rolloffFactor = spatial.rolloffFactor ?? 1.2;
    panner.positionX.value = spatial.x;
    panner.positionY.value = spatial.y;
    panner.positionZ.value = spatial.z ?? 0;

    source.connect(gain);
    gain.connect(panner);
    panner.connect(mixer.sfx);

    this.resumeIfSuspended(context);
    source.start();
  }

  playBgm(soundId: number, options: { volume?: number; loop?: boolean; fadeInSeconds?: number } = {}): void {
    this.assertAlive();
    if (soundId <= 0) {
      return;
    }

    const buffer = this.requireBuffer(soundId);
    const context = this.audioContext();
    const mixer = this.ensureMixer(context);

    this.stopBgmInternal(0);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = options.loop ?? true;

    const fade = Math.max(0, options.fadeInSeconds ?? 0);
    const volume = Math.max(0, options.volume ?? 1);
    const now = context.currentTime;

    mixer.bgm.gain.cancelScheduledValues(now);
    if (fade > 0) {
      mixer.bgm.gain.setValueAtTime(0, now);
      mixer.bgm.gain.linearRampToValueAtTime(volume, now + fade);
    } else {
      mixer.bgm.gain.setValueAtTime(volume, now);
    }

    source.connect(mixer.bgm);
    this.resumeIfSuspended(context);
    source.start();
    this.bgmSource = source;
  }

  stopBgm(options: { fadeOutSeconds?: number } = {}): void {
    this.assertAlive();
    this.stopBgmInternal(options.fadeOutSeconds ?? 0);
  }

  setListenerPosition(x: number, y: number, z = 0): void {
    this.assertAlive();
    this.listenerX = x;
    this.listenerY = y;
    this.listenerZ = z;

    const context = this.audioContext();
    context.listener.positionX.value = x;
    context.listener.positionY.value = y;
    context.listener.positionZ.value = z;
  }

  playEvents(events: readonly AudioEventView[]): void {
    this.assertAlive();
    for (const event of events) {
      this.playSfx(event.soundId, event.volume, event.pitch);
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.stopBgmInternal(0);
    this.destroyed = true;
    const context = this.context;
    this.context = undefined;
    this.masterGain = undefined;
    this.bgmGain = undefined;
    this.sfxGain = undefined;
    this.buffersById.clear();
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
  }

  private stopBgmInternal(fadeOutSeconds: number): void {
    if (!this.bgmSource || !this.context || !this.bgmGain) {
      return;
    }

    const fade = Math.max(0, fadeOutSeconds);
    const now = this.context.currentTime;
    const source = this.bgmSource;

    try {
      if (fade > 0) {
        this.bgmGain.gain.cancelScheduledValues(now);
        this.bgmGain.gain.setValueAtTime(this.bgmGain.gain.value, now);
        this.bgmGain.gain.linearRampToValueAtTime(0, now + fade);
        source.stop(now + fade);
      } else {
        source.stop();
        this.bgmGain.gain.setValueAtTime(0, now);
      }
    } finally {
      this.bgmSource = undefined;
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
      });
    }

    this.context = new constructor();
    this.setListenerPosition(this.listenerX, this.listenerY, this.listenerZ);
    return this.context;
  }

  private ensureMixer(context: AudioContext): { master: GainNode; bgm: GainNode; sfx: GainNode } {
    if (this.masterGain && this.bgmGain && this.sfxGain) {
      return { master: this.masterGain, bgm: this.bgmGain, sfx: this.sfxGain };
    }

    this.masterGain = context.createGain();
    this.bgmGain = context.createGain();
    this.sfxGain = context.createGain();

    this.masterGain.gain.value = 1;
    this.bgmGain.gain.value = 1;
    this.sfxGain.gain.value = 1;

    this.bgmGain.connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);
    this.masterGain.connect(context.destination);

    return { master: this.masterGain, bgm: this.bgmGain, sfx: this.sfxGain };
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
