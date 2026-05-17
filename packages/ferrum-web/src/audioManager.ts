import type { AudioEventView } from "./wasmBridge";
import { AudioAssetLoader } from "./audioAssetLoader.js";
import { audioPlaybackError, diagnosticError } from "./diagnostics.js";

type AudioContextConstructor = new () => AudioContext;

interface WindowWithWebkitAudioContext extends Window {
  webkitAudioContext?: AudioContextConstructor;
}

export class AudioManager {
  private readonly buffersById = new Map<number, AudioBuffer>();
  private readonly assetLoader = new AudioAssetLoader(() => this.audioContext());
  private context?: AudioContext;
  private destroyed = false;

  async loadSound(soundId: number, url: string): Promise<AudioBuffer> {
    this.assertAlive();
    const buffer = await this.assetLoader.load(soundId, url);
    this.assertAlive();
    this.buffersById.set(soundId, buffer);
    return buffer;
  }

  play(soundId: number, volume = 1.0, pitch = 1.0): void {
    this.assertAlive();
    if (soundId <= 0) {
      return;
    }

    const buffer = this.buffersById.get(soundId);
    if (!buffer) {
      throw audioPlaybackError({
        kind: "sound",
        id: soundId,
        detail: "Sound is not loaded. Check the sounds manifest passed to loadAssets().",
      });
    }

    const context = this.audioContext();
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.01, pitch);
    gain.gain.value = Math.max(0.0, volume);
    source.connect(gain);
    gain.connect(context.destination);

    if (context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }
    source.start();
  }

  playEvents(events: readonly AudioEventView[]): void {
    this.assertAlive();
    for (const event of events) {
      this.play(event.soundId, event.volume, event.pitch);
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    const context = this.context;
    this.context = undefined;
    this.buffersById.clear();
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
  }

  private audioContext(): AudioContext {
    this.assertAlive();
    if (this.context) {
      return this.context;
    }

    const constructor = window.AudioContext ?? (window as WindowWithWebkitAudioContext).webkitAudioContext;
    if (!constructor) {
      throw diagnosticError("Audio context error", {
        kind: "sound",
        detail: "Web Audio API is not available in this browser",
      });
    }

    this.context = new constructor();
    return this.context;
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("AudioManager has been destroyed.");
    }
  }
}
