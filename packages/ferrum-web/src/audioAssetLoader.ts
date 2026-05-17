import { audioDecodeError, audioLoadError, describeError } from "./diagnostics.js";

export type AudioContextProvider = () => AudioContext;

export class AudioAssetLoader {
  constructor(private readonly audioContextProvider: AudioContextProvider) {}

  async load(soundId: number, url: string): Promise<AudioBuffer> {
    const bytes = await this.loadBytes(soundId, url);
    try {
      return await this.audioContextProvider().decodeAudioData(bytes);
    } catch (error) {
      throw audioDecodeError({
        kind: "sound",
        id: soundId,
        url,
        detail: describeError(error),
      });
    }
  }

  private async loadBytes(soundId: number, url: string): Promise<ArrayBuffer> {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw audioLoadError({
        kind: "sound",
        id: soundId,
        url,
        detail: describeError(error),
      });
    }
    if (!response.ok) {
      throw audioLoadError({
        kind: "sound",
        id: soundId,
        url,
        detail: `HTTP ${response.status} ${response.statusText}`.trim(),
      });
    }

    try {
      return await response.arrayBuffer();
    } catch (error) {
      throw audioLoadError({
        kind: "sound",
        id: soundId,
        url,
        detail: describeError(error),
      });
    }
  }
}
