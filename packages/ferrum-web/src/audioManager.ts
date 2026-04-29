import type { AudioEventView } from "./wasmBridge";

type AudioContextConstructor = new () => AudioContext;

interface WindowWithWebkitAudioContext extends Window {
  webkitAudioContext?: AudioContextConstructor;
}

export class AudioManager {
  private readonly buffersById = new Map<number, AudioBuffer>();
  private context?: AudioContext;

  async loadSound(soundId: number, url: string): Promise<AudioBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Sound asset id ${soundId} failed to load from '${url}' (${response.status} ${response.statusText}).`);
    }

    const bytes = await response.arrayBuffer();
    try {
      const buffer = await this.audioContext().decodeAudioData(bytes);
      this.buffersById.set(soundId, buffer);
      return buffer;
    } catch {
      throw new Error(`Sound asset id ${soundId} failed to decode from '${url}'.`);
    }
  }

  play(soundId: number, volume = 1.0, pitch = 1.0): void {
    if (soundId <= 0) {
      return;
    }

    const buffer = this.buffersById.get(soundId);
    if (!buffer) {
      throw new Error(`Sound id ${soundId} is not loaded. Check the sounds manifest passed to loadAssets().`);
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
    for (const event of events) {
      this.play(event.soundId, event.volume, event.pitch);
    }
  }

  destroy(): void {
    const context = this.context;
    this.context = undefined;
    this.buffersById.clear();
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
  }

  private audioContext(): AudioContext {
    if (this.context) {
      return this.context;
    }

    const constructor = window.AudioContext ?? (window as WindowWithWebkitAudioContext).webkitAudioContext;
    if (!constructor) {
      throw new Error("Web Audio API is not available in this browser.");
    }

    this.context = new constructor();
    return this.context;
  }
}
