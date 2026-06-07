import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  AUDIO_CHANNEL_BGM,
  AUDIO_CHANNEL_SFX,
  AUDIO_CHANNEL_UI,
} from "../src/audioEventDecoder.js";
import { AudioManager } from "../src/audioManager.js";

class FakeAudioParam {
  value = 0;
  cancelledAt?: number;
  rampTime?: number;

  setValueAtTime(value: number): void {
    this.value = value;
  }

  linearRampToValueAtTime(value: number, endTime?: number): void {
    this.value = value;
    this.rampTime = endTime;
  }

  cancelScheduledValues(startTime?: number): void {
    this.cancelledAt = startTime;
  }
}

class FakeGainNode {
  gain = new FakeAudioParam();
  connectedTo?: unknown;

  connect(destination?: unknown): void {
    this.connectedTo = destination;
  }
}

class FakeBufferSource {
  buffer?: AudioBuffer;
  loop = false;
  playbackRate = { value: 1 };
  started = false;
  stopped = false;
  stopTime?: number;
  connectedTo?: unknown;

  connect(destination?: unknown): void {
    this.connectedTo = destination;
  }

  start(): void {
    this.started = true;
  }

  stop(when?: number): void {
    this.stopped = true;
    this.stopTime = when;
  }
}

class FakeAudioContext {
  state: AudioContextState = "running";
  currentTime = 0;
  destination = {} as AudioDestinationNode;
  sources: FakeBufferSource[] = [];
  gains: FakeGainNode[] = [];
  listener = {
    positionX: new FakeAudioParam(),
    positionY: new FakeAudioParam(),
    positionZ: new FakeAudioParam(),
  } as unknown as AudioListener;

  decodeAudioData = async (): Promise<AudioBuffer> => ({}) as AudioBuffer;
  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }
  createGain(): GainNode {
    const gain = new FakeGainNode();
    this.gains.push(gain);
    return gain as unknown as GainNode;
  }
  resume = async (): Promise<void> => {
    this.state = "running";
  };
  close = async (): Promise<void> => undefined;
}

interface TestWindow {
  AudioContext?: typeof AudioContext;
}

async function rejectsWithMessage(promise: Promise<unknown>, expected: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    equal(error instanceof Error ? error.message : String(error), expected);
    return;
  }
  throw new Error("Expected promise to reject.");
}

test("AudioManager reports HTTP load failures with diagnostic context", async () => {
  const previousFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async () => ({
    ok: false,
    status: 404,
    statusText: "Not Found",
  } as unknown as Response);

  try {
    const manager = new AudioManager();
    await rejectsWithMessage(
      manager.loadSound(7, "/assets/missing.wav"),
      "Audio load error: kind=sound id=7 url='/assets/missing.wav' detail='HTTP 404 Not Found'.",
    );
    manager.destroy();
    manager.destroy();
  } finally {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = previousFetch;
  }
});

test("AudioManager reports missing playback buffers with diagnostic context", () => {
  const manager = new AudioManager();

  try {
    equal(manager.hasSound(7), false);
    manager.play(7);
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Audio playback error: kind=sound id=7 detail='Sound is not loaded. Check the sounds manifest passed to loadAssets().'.",
    );
    manager.destroy();
    manager.destroy();
    return;
  }
  throw new Error("Expected play() to throw.");
});

test("AudioManager reports loaded sound ids for runtime validation", async () => {
  const previousFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  } as unknown as Response);
  const globalWindow = globalThis as unknown as { window?: TestWindow };
  if (!globalWindow.window) globalWindow.window = {};
  const previous = globalWindow.window.AudioContext;
  globalWindow.window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  const manager = new AudioManager();

  try {
    equal(manager.hasSound(7), false);
    await manager.loadSound(7, "/assets/hit.wav");
    equal(manager.hasSound(7), true);
    equal(manager.hasSound(8), false);
  } finally {
    manager.destroy();
    globalWindow.window.AudioContext = previous;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = previousFetch;
  }
});

test("AudioManager exposes master, bgm, sfx, and ui bus controls", () => {
  const globalWindow = globalThis as unknown as { window?: TestWindow };
  if (!globalWindow.window) globalWindow.window = {};
  const previous = globalWindow.window.AudioContext;
  globalWindow.window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  const manager = new AudioManager();

  try {
    manager.setBusVolume("master", 0.8);
    manager.setBusVolume("bgm", 0.5);
    manager.setBusVolume("sfx", 0.7);
    manager.setBusVolume("ui", 0.6);
    manager.setListenerPosition(10, 20, 3);
    equal(manager.state().masterVolume, 0.8);
    equal(manager.state().bgmVolume, 0.5);
    equal(manager.state().sfxVolume, 0.7);
    equal(manager.state().uiVolume, 0.6);
    ok(true);
  } finally {
    manager.destroy();
    globalWindow.window.AudioContext = previous;
  }
});

test("AudioManager plays looping BGM through the bgm bus with fade control", async () => {
  const previousFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  } as unknown as Response);
  const globalWindow = globalThis as unknown as { window?: TestWindow };
  if (!globalWindow.window) globalWindow.window = {};
  const previous = globalWindow.window.AudioContext;
  let context: FakeAudioContext | undefined;
  class TrackingAudioContext extends FakeAudioContext {
    constructor() {
      super();
      context = this;
    }
  }
  globalWindow.window.AudioContext = TrackingAudioContext as unknown as typeof AudioContext;
  const manager = new AudioManager();

  try {
    await manager.loadSound(2, "/music/theme.ogg");
    manager.setBusVolume("bgm", 0.4);
    manager.playBgm(2, { volume: 0.6, loop: true, fadeInSeconds: 0.5 });

    equal(manager.state().bgmPlaying, true);
    equal(manager.state().bgmSoundId, 2);
    equal(manager.state().bgmLoop, true);
    equal(context?.sources[0].loop, true);
    equal(context?.sources[0].started, true);
    const bgmGain = context?.gains[(context?.gains.length ?? 1) - 1];
    equal(bgmGain?.gain.value, 0.6);
    equal(bgmGain?.gain.rampTime, 0.5);

    context!.currentTime = 1;
    manager.stopBgm({ fadeOutSeconds: 0.25 });
    equal(manager.state().bgmPlaying, false);
    equal(context?.sources[0].stopped, true);
    equal(context?.sources[0].stopTime, 1.25);
  } finally {
    manager.destroy();
    globalWindow.window.AudioContext = previous;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = previousFetch;
  }
});

test("AudioManager supports fadeMs alias for BGM fades", async () => {
  const previousFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  } as unknown as Response);
  const globalWindow = globalThis as unknown as { window?: TestWindow };
  if (!globalWindow.window) globalWindow.window = {};
  const previous = globalWindow.window.AudioContext;
  let context: FakeAudioContext | undefined;
  class TrackingAudioContext extends FakeAudioContext {
    constructor() {
      super();
      context = this;
    }
  }
  globalWindow.window.AudioContext = TrackingAudioContext as unknown as typeof AudioContext;
  const manager = new AudioManager();

  try {
    await manager.loadSound(2, "/music/theme.ogg");
    manager.playBgm(2, { volume: 0.6, loop: true, fadeMs: 500 });

    const bgmGain = context?.gains[(context?.gains.length ?? 1) - 1];
    equal(bgmGain?.gain.rampTime, 0.5);

    context!.currentTime = 1;
    manager.stopBgm({ fadeMs: 250 });
    equal(context?.sources[0].stopTime, 1.25);
  } finally {
    manager.destroy();
    globalWindow.window.AudioContext = previous;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = previousFetch;
  }
});

test("AudioManager routes AudioEvent channel ids to BGM, SFX, and UI buses", async () => {
  const previousFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  } as unknown as Response);
  const globalWindow = globalThis as unknown as { window?: TestWindow };
  if (!globalWindow.window) globalWindow.window = {};
  const previous = globalWindow.window.AudioContext;
  let context: FakeAudioContext | undefined;
  class TrackingAudioContext extends FakeAudioContext {
    constructor() {
      super();
      context = this;
    }
  }
  globalWindow.window.AudioContext = TrackingAudioContext as unknown as typeof AudioContext;
  const manager = new AudioManager();

  try {
    await manager.loadSound(1, "/music/theme.ogg");
    await manager.loadSound(2, "/sfx/hit.wav");
    await manager.loadSound(3, "/ui/click.wav");

    manager.playEvents([
      { soundId: 1, volume: 0.4, pitch: 1, channelId: AUDIO_CHANNEL_BGM },
      { soundId: 2, volume: 0.5, pitch: 1.25, channelId: AUDIO_CHANNEL_SFX },
      { soundId: 3, volume: 0.6, pitch: 0.75, channelId: AUDIO_CHANNEL_UI },
    ]);

    const bgmBus = context?.gains[1];
    const sfxBus = context?.gains[2];
    const uiBus = context?.gains[3];
    equal(context?.sources[0].loop, true);
    equal(context?.sources[0].started, true);
    equal(context?.gains[4].connectedTo, bgmBus);
    equal(context?.gains[5].connectedTo, sfxBus);
    equal(context?.gains[6].connectedTo, uiBus);

    manager.playEventBuffer({
      buffer: new Float32Array([3, 0.7, 1.5, AUDIO_CHANNEL_UI]),
      eventCount: 1,
      floatsPerEvent: 4,
    });
    equal(context?.gains[7].connectedTo, uiBus);

    manager.playEvents([{ soundId: 2, volume: 0.5, pitch: 1 }]);
    equal(context?.gains[8].connectedTo, sfxBus);
  } finally {
    manager.destroy();
    globalWindow.window.AudioContext = previous;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = previousFetch;
  }
});

test("AudioManager configures bus volume and unlocks suspended audio context", async () => {
  class SuspendedAudioContext extends FakeAudioContext {
    override state: AudioContextState = "suspended";
  }

  const globalWindow = globalThis as unknown as { window?: TestWindow };
  if (!globalWindow.window) globalWindow.window = {};
  const previous = globalWindow.window.AudioContext;
  globalWindow.window.AudioContext = SuspendedAudioContext as unknown as typeof AudioContext;
  const manager = new AudioManager();

  try {
    manager.configure({ masterVolume: 0.75, sfxVolume: 0.5, uiVolume: 0.25 });
    equal(manager.state().uiVolume, 0.25);
    equal(await manager.unlock(), true);
  } finally {
    manager.destroy();
    globalWindow.window.AudioContext = previous;
  }
});

test("AudioManager playEvents ignores invalid sound id 0", () => {
  const manager = new AudioManager();
  manager.playEvents([{ soundId: 0, volume: 1, pitch: 1 }]);
  manager.destroy();
  equal(true, true);
});

test("AudioManager playEventBuffer reads raw audio event buffers", () => {
  const manager = new AudioManager();
  manager.playEventBuffer({
    buffer: new Float32Array([0, 0.5, 1.25, AUDIO_CHANNEL_SFX]),
    eventCount: 1,
    floatsPerEvent: 4,
  });
  manager.destroy();
  equal(true, true);
});
