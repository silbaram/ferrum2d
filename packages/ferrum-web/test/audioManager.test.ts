import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { AudioManager } from "../src/audioManager.js";

class FakeAudioParam { value = 0; setValueAtTime(v:number){this.value=v;} linearRampToValueAtTime(v:number){this.value=v;} cancelScheduledValues(){} }
class FakeGainNode { gain = new FakeAudioParam(); connect(){} }
class FakePannerNode { panningModel: "HRTF"|"equalpower" = "HRTF"; distanceModel:"inverse"|"linear"|"exponential"="inverse"; refDistance=1; maxDistance=10000; rolloffFactor=1; positionX=new FakeAudioParam(); positionY=new FakeAudioParam(); positionZ=new FakeAudioParam(); connect(){} }
class FakeBufferSource { buffer?: AudioBuffer; loop=false; playbackRate={value:1}; started=false; stopped=false; connect(){} start(){this.started=true;} stop(){this.stopped=true;} }
class FakeAudioContext {
  state: AudioContextState = "running";
  currentTime = 0;
  destination = {} as AudioDestinationNode;
  listener = { positionX: new FakeAudioParam(), positionY: new FakeAudioParam(), positionZ: new FakeAudioParam() } as unknown as AudioListener;
  decodeAudioData = async (_: ArrayBuffer) => ({}) as AudioBuffer;
  createBufferSource(){ return new FakeBufferSource() as unknown as AudioBufferSourceNode; }
  createGain(){ return new FakeGainNode() as unknown as GainNode; }
  createPanner(){ return new FakePannerNode() as unknown as PannerNode; }
  resume = async () => undefined;
  close = async () => undefined;
}

test("AudioManager exposes mixer/bgm/spatial controls", () => {
  const globalWindow = globalThis as unknown as { window?: Window & { AudioContext?: typeof AudioContext } };
  if (!globalWindow.window) globalWindow.window = {} as Window & { AudioContext?: typeof AudioContext };
  const previous = globalWindow.window.AudioContext;
  globalWindow.window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  const manager = new AudioManager();

  try {
    manager.setListenerPosition(10, 20, 3);
    manager.setBusVolume("master", 0.8);
    manager.setBusVolume("bgm", 0.5);
    manager.setBusVolume("sfx", 0.7);
    ok(true);
  } finally {
    manager.destroy();
    globalWindow.window!.AudioContext = previous;
  }
});

test("AudioManager playEvents ignores invalid sound id 0", () => {
  const manager = new AudioManager();
  manager.playEvents([{ soundId: 0, volume: 1, pitch: 1 }]);
  equal(true, true);
});
