import type { Engine } from "../pkg/ferrum_core";
import type { AssetHost } from "./engineTypes.js";
import type { AudioEventView, WasmBridge } from "./wasmBridge.js";

export interface AudioDrainResult {
  audioEventCount: number;
  audioEvents: readonly AudioEventView[];
}

const EMPTY_AUDIO_EVENTS: readonly AudioEventView[] = Object.freeze([]);

export function drainAudioEvents(
  bridge: WasmBridge,
  rustEngine: Engine,
  assetHost: AssetHost | undefined,
  includeAudioEvents: boolean,
): AudioDrainResult {
  const audioEventBuffer = bridge.readAudioEventBuffer();
  let decodedAudioEvents: readonly AudioEventView[] | undefined;

  try {
    if (audioEventBuffer.eventCount > 0) {
      if (assetHost?.playAudioEventBuffer) {
        assetHost.playAudioEventBuffer(audioEventBuffer);
      } else if (assetHost?.playAudioEvents) {
        decodedAudioEvents = bridge.decodeAudioEvents(audioEventBuffer);
        assetHost.playAudioEvents(decodedAudioEvents);
      }
    }
    if (includeAudioEvents && audioEventBuffer.eventCount > 0 && decodedAudioEvents === undefined) {
      decodedAudioEvents = bridge.decodeAudioEvents(audioEventBuffer);
    }
  } finally {
    rustEngine.clear_audio_events();
  }
  if (!includeAudioEvents) {
    return {
      audioEventCount: audioEventBuffer.eventCount,
      audioEvents: EMPTY_AUDIO_EVENTS,
    };
  }
  return {
    audioEventCount: audioEventBuffer.eventCount,
    audioEvents: decodedAudioEvents ?? EMPTY_AUDIO_EVENTS,
  };
}
