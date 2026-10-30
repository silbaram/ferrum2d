import { throwIfAssetLoadAborted } from "./assetLoadTasks.js";
import { audioDecodeError, audioLoadError, describeError } from "./diagnostics.js";

export type AudioContextProvider = () => AudioContext;

export class AudioAssetLoader {
  constructor(private readonly audioContextProvider: AudioContextProvider) {}

  async load(soundId: number, url: string, options: { signal?: AbortSignal } = {}): Promise<AudioBuffer> {
    const signal = options.signal;
    throwIfAssetLoadAborted(signal);
    const bytes = await this.loadBytes(soundId, url, signal);
    try {
      throwIfAssetLoadAborted(signal);
      const buffer = await this.audioContextProvider().decodeAudioData(bytes);
      throwIfAssetLoadAborted(signal);
      return buffer;
    } catch (error) {
      throwIfAssetLoadAborted(signal);
      throw audioDecodeError({
        kind: "sound",
        id: soundId,
        url,
        detail: describeError(error),
      });
    }
  }

  private async loadBytes(soundId: number, url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    let response: Response;
    try {
      response = await fetch(url, { signal });
      throwIfAssetLoadAborted(signal);
    } catch (error) {
      throwIfAssetLoadAborted(signal);
      throw audioLoadError({
        kind: "sound",
        id: soundId,
        url,
        detail: describeError(error),
      });
    }
    if (!response.ok) {
      // A failed response may still be streaming. Release it before settling the load.
      try { await response.body?.cancel(); }
      catch { /* Preserve the HTTP failure when cleanup itself fails. */ }
      throwIfAssetLoadAborted(signal);
      throw audioLoadError({
        kind: "sound",
        id: soundId,
        url,
        detail: `HTTP ${response.status} ${response.statusText}`.trim(),
      });
    }

    try {
      const bytes = await response.arrayBuffer();
      throwIfAssetLoadAborted(signal);
      return bytes;
    } catch (error) {
      throwIfAssetLoadAborted(signal);
      throw audioLoadError({
        kind: "sound",
        id: soundId,
        url,
        detail: describeError(error),
      });
    }
  }
}
