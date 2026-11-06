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
  isAlive?: () => boolean,
): AudioDrainResult {
  // Property access can itself execute host code. Resolve it before borrowing.
  const playBuffer = assetHost?.playAudioEventBuffer;
  const playEvents = assetHost?.playAudioEvents;
  if (isAlive?.() === false) return { audioEventCount: 0, audioEvents: EMPTY_AUDIO_EVENTS };
  const audioEventBuffer = bridge.readAudioEventBuffer();
  let decodedAudioEvents: readonly AudioEventView[] | undefined;
  let playbackBuffer: typeof audioEventBuffer | undefined;

  try {
    if (audioEventBuffer.eventCount > 0) {
      if (includeAudioEvents || (!playBuffer && playEvents)) {
        decodedAudioEvents = bridge.decodeAudioEvents(audioEventBuffer);
      }
      if (playBuffer) {
        playbackBuffer = { ...audioEventBuffer, buffer: audioEventBuffer.buffer.slice() };
      }
    }
  } finally {
    if (audioEventBuffer.eventCount > 0) {
      rustEngine.clear_audio_events();
    }
  }
  // The host may allocate native memory or enqueue audio for the next frame.
  // Finish native reads/consumption first and only hand owned data to the host.
  if (playbackBuffer !== undefined) {
    playBuffer!.call(assetHost, playbackBuffer);
  } else if (audioEventBuffer.eventCount > 0 && playEvents) {
    playEvents.call(assetHost, decodedAudioEvents ?? EMPTY_AUDIO_EVENTS);
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
