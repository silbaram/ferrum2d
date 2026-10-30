import { equal, ok, rejects } from "node:assert/strict";
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
    equal(manager.evictSound(7), true);
    equal(manager.hasSound(7), false);
    equal(manager.evictSound(7), false);
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


test("AudioManager rejects stale decode results on replace, eviction, abort and destroy", async () => {
  const previousFetch = globalThis.fetch;
  const globalWindow = globalThis as unknown as { window?: TestWindow };
  if (!globalWindow.window) globalWindow.window = {};
  const previousContext = globalWindow.window.AudioContext;
  const pending: { finish: (buffer: AudioBuffer) => void }[] = [];
  let calls = 0;
  class DelayedAudioContext extends FakeAudioContext {
    override decodeAudioData = (): Promise<AudioBuffer> => new Promise(resolve => pending.push({ finish: resolve }));
  }
  globalWindow.window.AudioContext = DelayedAudioContext as unknown as typeof AudioContext;
  globalThis.fetch = async () => { calls++; return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response; };
  const untilDecoding = async (count: number) => {
    for (let i = 0; i < 100 && pending.length < count; i++) await Promise.resolve();
    equal(pending.length, count);
  };
  try {
    for (const action of ["replace", "evict", "abort", "destroy"]) {
      const manager = new AudioManager();
      const controller = new AbortController();
      const index = pending.length;
      const old = manager.loadSound(7, "/old.wav", { signal: controller.signal });
      const checked = rejects(old, /AbortError/);
      await untilDecoding(index + 1);
      if (action === "replace") {
        const fresh = manager.loadSound(7, "/new.wav");
        await untilDecoding(index + 2);
        const freshBuffer = {} as AudioBuffer;
        pending[index + 1].finish(freshBuffer);
        equal(await fresh, freshBuffer);
        pending[index].finish({} as AudioBuffer);
        await checked;
        equal(manager.hasSound(7), true);
        manager.play(7);
        // Playback must retain the replacement, not the late old buffer.
        const context = (manager as unknown as { context: FakeAudioContext }).context;
        equal(context.sources[context.sources.length - 1]?.buffer, freshBuffer);
      } else {
        if (action === "evict") equal(manager.evictSound(7), false);
        if (action === "abort") controller.abort();
        if (action === "destroy") manager.destroy();
        pending[index].finish({} as AudioBuffer);
        await checked;
        if (action !== "destroy") equal(manager.hasSound(7), false);
      }
      manager.destroy();
    }
    const manager = new AudioManager();
    const controller = new AbortController(); controller.abort();
    const before = calls;
    await rejects(manager.loadSound(1, "/never.wav", { signal: controller.signal }), /AbortError/);
    equal(calls, before);
    manager.destroy();
  } finally {
    globalThis.fetch = previousFetch;
    globalWindow.window.AudioContext = previousContext;
  }
});

test("AudioManager eviction aborts an in-flight network request", async () => {
  const previousFetch = globalThis.fetch;
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (_url, options) => {
    signal = options?.signal;
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  };
  const manager = new AudioManager();
  try {
    const checked = rejects(manager.loadSound(1, "/slow.wav"), /AbortError/);
    equal(signal?.aborted, false);
    manager.evictSound(1);
    equal(signal?.aborted, true);
    await checked;
    equal(manager.hasSound(1), false);
  } finally { manager.destroy(); globalThis.fetch = previousFetch; }
});

test("AudioManager keeps a newer same-ID request started by an abort listener", async () => {
  const previousFetch = globalThis.fetch;
  const globalWindow = globalThis as unknown as { window?: TestWindow };
  if (!globalWindow.window) globalWindow.window = {};
  const previousContext = globalWindow.window.AudioContext;
  globalWindow.window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  const manager = new AudioManager(), calls: string[] = [];
  let latest: Promise<AudioBuffer> | undefined;
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    if (url === "/first.wav") return new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => {
        latest = manager.loadSound(7, "/latest.wav");
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    });
    return new Response(new ArrayBuffer(8));
  };
  try {
    const first = rejects(manager.loadSound(7, "/first.wav"), /AbortError/);
    const middle = rejects(manager.loadSound(7, "/middle.wav"), /AbortError/);
    await first;
    await middle;
    ok(latest);
    const latestBuffer = await latest;
    equal(calls.join(), "/first.wav,/latest.wav");
    manager.play(7);
    const context = (manager as unknown as { context: FakeAudioContext }).context;
    equal(context.sources[context.sources.length - 1]?.buffer, latestBuffer);
  } finally {
    manager.destroy(); globalThis.fetch = previousFetch; globalWindow.window.AudioContext = previousContext;
  }
});

test("AudioManager cancels failed HTTP bodies and preserves the HTTP diagnostic if cleanup fails", async () => {
  const previousFetch = globalThis.fetch;
  try {
    for (const cleanupFails of [false, true]) {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array([1])); },
        cancel() { cancelled = true; if (cleanupFails) throw new Error("cleanup failure"); },
      });
      globalThis.fetch = async () => new Response(body, { status: 503, statusText: "Unavailable" });
      const manager = new AudioManager();
      try {
        await rejects(manager.loadSound(7, "/unavailable.wav"), /HTTP 503 Unavailable/);
        equal(cancelled, true);
        equal(body.locked, false);
        equal(manager.hasSound(7), false);
      } finally { manager.destroy(); }
    }
  } finally { globalThis.fetch = previousFetch; }
});
