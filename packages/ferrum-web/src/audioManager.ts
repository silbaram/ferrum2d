import { AudioAssetLoader } from "./audioAssetLoader.js";
import { audioPlaybackError, diagnosticError } from "./diagnostics.js";
import type { AudioEventBufferView, AudioEventView } from "./wasmBridge";

type AudioContextConstructor = new () => AudioContext;

interface WindowWithWebkitAudioContext extends Window {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
}

/** @deprecated "bgm" bus는 현재 MVP 범위 밖이며 호환 no-op입니다. */
export type AudioBus = "master" | "bgm" | "sfx";

export interface AudioManagerConfig {
  masterVolume?: number;
  /** @deprecated BGM은 현재 MVP 범위 밖이며 호환 no-op입니다. */
  bgmVolume?: number;
  sfxVolume?: number;
}

/** @deprecated spatial audio는 현재 MVP 범위 밖이며 playSpatial은 SFX 재생으로 fallback합니다. */
export interface SpatialAudioOptions {
  x: number;
  y: number;
  z?: number;
  refDistance?: number;
  maxDistance?: number;
  rolloffFactor?: number;
}

export class AudioManager {
  private readonly buffersById = new Map<number, AudioBuffer>();
  private readonly assetLoader = new AudioAssetLoader(() => this.audioContext());
  private context?: AudioContext;
  private masterGain?: GainNode;
  private sfxGain?: GainNode;
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
    if (bus === "bgm") {
      return;
    }

    const gain = Math.max(0, volume);
    const context = this.audioContext();
    const mixer = this.ensureMixer(context);
    const now = context.currentTime;

    if (bus === "master") mixer.master.gain.setValueAtTime(gain, now);
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

  /** @deprecated spatial audio는 현재 MVP 범위 밖이며 일반 SFX로 재생합니다. */
  playSpatial(soundId: number, _spatial: SpatialAudioOptions, volume = 1.0, pitch = 1.0): void {
    this.playSfx(soundId, volume, pitch);
  }

  /** @deprecated BGM은 현재 MVP 범위 밖이며 호환 no-op입니다. */
  playBgm(_soundId: number, _options: { volume?: number; loop?: boolean; fadeInSeconds?: number } = {}): void {
    this.assertAlive();
  }

  /** @deprecated BGM은 현재 MVP 범위 밖이며 호환 no-op입니다. */
  stopBgm(_options: { fadeOutSeconds?: number } = {}): void {
    this.assertAlive();
  }

  /** @deprecated spatial audio는 현재 MVP 범위 밖이며 호환 no-op입니다. */
  setListenerPosition(_x: number, _y: number, _z = 0): void {
    this.assertAlive();
  }

  playEvents(events: readonly AudioEventView[]): void {
    this.assertAlive();
    for (const event of events) {
      this.playSfx(event.soundId, event.volume, event.pitch);
    }
  }

  playEventBuffer(events: AudioEventBufferView): void {
    this.assertAlive();
    for (let i = 0; i < events.eventCount; i += 1) {
      const offset = i * events.floatsPerEvent;
      this.playSfx(
        Math.trunc(events.buffer[offset]),
        events.buffer[offset + 1],
        events.buffer[offset + 2],
      );
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    const context = this.context;
    this.context = undefined;
    this.masterGain = undefined;
    this.sfxGain = undefined;
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

  private ensureMixer(context: AudioContext): { master: GainNode; sfx: GainNode } {
    if (this.masterGain && this.sfxGain) {
      return { master: this.masterGain, sfx: this.sfxGain };
    }

    this.masterGain = context.createGain();
    this.sfxGain = context.createGain();

    this.masterGain.gain.value = 1;
    this.sfxGain.gain.value = 1;

    this.sfxGain.connect(this.masterGain);
    this.masterGain.connect(context.destination);

    return { master: this.masterGain, sfx: this.sfxGain };
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
