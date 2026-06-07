#!/usr/bin/env node
import assert from "node:assert/strict";
import { AudioManager } from "../../packages/ferrum-web/dist/index.js";

class FakeAudioParam {
  value = 0;
  rampTime;
  setValueAtTime(value) {
    this.value = value;
  }
  linearRampToValueAtTime(value, endTime) {
    this.value = value;
    this.rampTime = endTime;
  }
  cancelScheduledValues() {}
}

class FakeGainNode {
  gain = new FakeAudioParam();
  connect() {}
}

class FakeBufferSource {
  loop = false;
  playbackRate = { value: 1 };
  started = false;
  stopped = false;
  stopTime;
  connect() {}
  start() {
    this.started = true;
  }
  stop(when) {
    this.stopped = true;
    this.stopTime = when;
  }
}

class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  sources = [];
  gains = [];
  async decodeAudioData() {
    return {};
  }
  createBufferSource() {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source;
  }
  createGain() {
    const gain = new FakeGainNode();
    this.gains.push(gain);
    return gain;
  }
  async resume() {}
  async close() {}
}

const previousWindow = globalThis.window;
const previousFetch = globalThis.fetch;
let context;
globalThis.window = {
  AudioContext: class extends FakeAudioContext {
    constructor() {
      super();
      context = this;
    }
  },
};
globalThis.fetch = async () => ({
  ok: true,
  arrayBuffer: async () => new ArrayBuffer(8),
});

try {
  const manager = new AudioManager();
  await manager.loadSound(1, "/music/theme.ogg");
  manager.configure({ masterVolume: 0.9, bgmVolume: 0.4, sfxVolume: 0.7 });
  manager.playBgm(1, { volume: 0.6, loop: true, fadeInSeconds: 0.5 });
  assert.equal(manager.state().bgmPlaying, true);
  assert.equal(manager.state().bgmSoundId, 1);
  assert.equal(context.sources[0].loop, true);
  assert.equal(context.gains.at(-1).gain.value, 0.6);
  context.currentTime = 2;
  manager.stopBgm({ fadeOutSeconds: 0.25 });
  assert.equal(manager.state().bgmPlaying, false);
  assert.equal(context.sources[0].stopTime, 2.25);
  manager.destroy();

  console.log(JSON.stringify({
    audioSystemSmoke: {
      masterVolume: 0.9,
      bgmVolume: 0.4,
      stoppedAt: context.sources[0].stopTime,
    },
  }, null, 2));
} finally {
  globalThis.window = previousWindow;
  globalThis.fetch = previousFetch;
}
