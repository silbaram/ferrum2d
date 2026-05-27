export const AUDIO_CHANNEL_BGM = 0;
export const AUDIO_CHANNEL_SFX = 1;
export const AUDIO_CHANNEL_UI = 2;
export const FLOATS_PER_AUDIO_EVENT = 4;

export interface AudioEventView {
  soundId: number;
  volume: number;
  pitch: number;
  channelId?: number;
}

export interface AudioEventBufferView {
  buffer: Float32Array;
  eventCount: number;
  floatsPerEvent: number;
}

export const EMPTY_AUDIO_EVENTS: readonly AudioEventView[] = Object.freeze([]);

export function decodeAudioEvents(view: AudioEventBufferView): readonly AudioEventView[] {
  if (view.eventCount === 0) {
    return EMPTY_AUDIO_EVENTS;
  }

  const events: AudioEventView[] = [];
  for (let i = 0; i < view.eventCount; i += 1) {
    const offset = i * view.floatsPerEvent;
    const rawChannelId = view.floatsPerEvent > 3
      ? view.buffer[offset + 3]
      : AUDIO_CHANNEL_SFX;
    events.push({
      soundId: Math.trunc(view.buffer[offset]),
      volume: view.buffer[offset + 1],
      pitch: view.buffer[offset + 2],
      channelId: Number.isFinite(rawChannelId)
        ? Math.trunc(rawChannelId)
        : AUDIO_CHANNEL_SFX,
    });
  }
  return events;
}
