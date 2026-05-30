import { equal } from "node:assert/strict";
import { test } from "node:test";
import { drainAudioEvents } from "../src/engineFrameAudio.js";

function bridgeWithAudioEventCount(eventCount: number) {
  return {
    readAudioEventBuffer: () => ({
      buffer: new Float32Array(eventCount * 5),
      eventCount,
      floatsPerEvent: 5,
    }),
    decodeAudioEvents: () => [
      { soundId: 1, volume: 0.5, playbackRate: 1, channelId: 1 },
    ],
  };
}

function engineWithClearCounter() {
  let clearCount = 0;
  return {
    engine: {
      clear_audio_events: () => {
        clearCount += 1;
      },
    },
    clearCount: () => clearCount,
  };
}

test("drainAudioEvents skips clear_audio_events for an empty buffer", () => {
  const { engine, clearCount } = engineWithClearCounter();

  const result = drainAudioEvents(
    bridgeWithAudioEventCount(0) as unknown as Parameters<typeof drainAudioEvents>[0],
    engine as unknown as Parameters<typeof drainAudioEvents>[1],
    undefined,
    true,
  );

  equal(result.audioEventCount, 0);
  equal(result.audioEvents.length, 0);
  equal(clearCount(), 0);
});

test("drainAudioEvents clears non-empty buffers after playback", () => {
  const { engine, clearCount } = engineWithClearCounter();

  const result = drainAudioEvents(
    bridgeWithAudioEventCount(1) as unknown as Parameters<typeof drainAudioEvents>[0],
    engine as unknown as Parameters<typeof drainAudioEvents>[1],
    {
      loadAssets: async () => ({
        textures: {} as never,
        sounds: {} as never,
        json: {},
        progress: { loaded: 0, total: 0, ratio: 1 },
      }),
      textureId: () => 0,
      playAudioEventBuffer: () => {},
    },
    false,
  );

  equal(result.audioEventCount, 1);
  equal(result.audioEvents.length, 0);
  equal(clearCount(), 1);
});
