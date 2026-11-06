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

test("drainAudioEvents consumes non-empty native buffers for playback", () => {
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

test("audio host native growth cannot invalidate decoded events or erase newly queued audio", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const buffer = new Float32Array(memory.buffer, 0, 4);
  buffer.set([7, 0.5, 1, 1]);
  let queued = 1;
  const result = drainAudioEvents({
    readAudioEventBuffer: () => ({ buffer, eventCount: 1, floatsPerEvent: 4 }),
    decodeAudioEvents(view: { buffer: Float32Array }) {
      equal(view.buffer.length, 4);
      return [{ soundId: view.buffer[0], volume: view.buffer[1], pitch: 1, channelId: 1 }];
    },
  } as unknown as Parameters<typeof drainAudioEvents>[0], {
    clear_audio_events() { queued = 0; buffer.fill(0); },
  } as unknown as Parameters<typeof drainAudioEvents>[1], {
    playAudioEventBuffer(view: { buffer: Float32Array }) {
      equal(queued, 0);
      memory.grow(1);
      equal(view.buffer[0], 7);
      queued = 2;
    },
  } as unknown as Parameters<typeof drainAudioEvents>[2], true);
  equal(result.audioEvents[0].soundId, 7);
  equal(result.audioEventCount, 1);
  equal(queued, 2);
});


test("audio host accessors run once before borrowing and retain their receiver", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  new Float32Array(memory.buffer)[0] = 7;
  let accessCount = 0;
  let played = 0;
  const host = {
    get playAudioEventBuffer() {
      accessCount++;
      memory.grow(1);
      return function (this: unknown, view: { buffer: Float32Array }) {
        equal(this, host);
        equal(view.buffer[0], 7);
        played++;
      };
    },
  };
  drainAudioEvents({
    readAudioEventBuffer: () => ({ buffer: new Float32Array(memory.buffer, 0, 4), eventCount: 1, floatsPerEvent: 4 }),
  } as unknown as Parameters<typeof drainAudioEvents>[0], {
    clear_audio_events() {},
  } as unknown as Parameters<typeof drainAudioEvents>[1], host as unknown as Parameters<typeof drainAudioEvents>[2], false);
  equal(accessCount, 1);
  equal(played, 1);
});
