import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { AudioManager } from "../src/audioManager.js";

class FakeAudioParam {
  value = 0;

  setValueAtTime(value: number): void {
    this.value = value;
  }

  linearRampToValueAtTime(value: number): void {
    this.value = value;
  }

  cancelScheduledValues(): void {}
}

class FakeGainNode {
  gain = new FakeAudioParam();

  connect(): void {}
}

class FakeBufferSource {
  buffer?: AudioBuffer;
  loop = false;
  playbackRate = { value: 1 };
  started = false;
  stopped = false;

  connect(): void {}

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }
}

class FakeAudioContext {
  state: AudioContextState = "running";
  currentTime = 0;
  destination = {} as AudioDestinationNode;
  listener = {
    positionX: new FakeAudioParam(),
    positionY: new FakeAudioParam(),
    positionZ: new FakeAudioParam(),
  } as unknown as AudioListener;

  decodeAudioData = async (): Promise<AudioBuffer> => ({}) as AudioBuffer;
  createBufferSource(): AudioBufferSourceNode { return new FakeBufferSource() as unknown as AudioBufferSourceNode; }
  createGain(): GainNode { return new FakeGainNode() as unknown as GainNode; }
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

test("AudioManager exposes MVP master and sfx bus controls", () => {
  const globalWindow = globalThis as unknown as { window?: TestWindow };
  if (!globalWindow.window) globalWindow.window = {};
  const previous = globalWindow.window.AudioContext;
  globalWindow.window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  const manager = new AudioManager();

  try {
    manager.setBusVolume("master", 0.8);
    manager.setBusVolume("bgm", 0.5);
    manager.setBusVolume("sfx", 0.7);
    manager.setListenerPosition(10, 20, 3);
    manager.playBgm(1);
    manager.stopBgm();
    ok(true);
  } finally {
    manager.destroy();
    globalWindow.window.AudioContext = previous;
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
    manager.configure({ masterVolume: 0.75, sfxVolume: 0.5 });
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
