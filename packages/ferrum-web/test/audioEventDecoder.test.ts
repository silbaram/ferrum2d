import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  AUDIO_CHANNEL_SFX,
  AUDIO_CHANNEL_UI,
  decodeAudioEvents,
  FLOATS_PER_AUDIO_EVENT,
} from "../src/audioEventDecoder.js";

test("decodeAudioEvents parses packed audio event floats including channelId", () => {
  const events = decodeAudioEvents({
    buffer: new Float32Array([
      7, 0.5, 1.25, AUDIO_CHANNEL_SFX,
      8, 0.75, 0.875, AUDIO_CHANNEL_UI,
    ]),
    eventCount: 2,
    floatsPerEvent: FLOATS_PER_AUDIO_EVENT,
  });

  equal(events.length, 2);
  deepEqual(events[0], {
    soundId: 7,
    volume: 0.5,
    pitch: 1.25,
    channelId: AUDIO_CHANNEL_SFX,
  });
  deepEqual(events[1], {
    soundId: 8,
    volume: 0.75,
    pitch: 0.875,
    channelId: AUDIO_CHANNEL_UI,
  });
});

test("decodeAudioEvents defaults legacy three-float buffers to SFX channel", () => {
  deepEqual(
    decodeAudioEvents({
      buffer: new Float32Array([9, 0.25, 1.5]),
      eventCount: 1,
      floatsPerEvent: 3,
    }),
    [{
      soundId: 9,
      volume: 0.25,
      pitch: 1.5,
      channelId: AUDIO_CHANNEL_SFX,
    }],
  );
});
