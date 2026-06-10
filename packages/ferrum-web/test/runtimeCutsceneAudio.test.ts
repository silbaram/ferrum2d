import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  resolveCutsceneSequenceSpec,
} from "../src/cutsceneSequence.js";
import type {
  CutsceneAudioCommandSpec,
  ResolvedCutsceneAudioCommand,
} from "../src/cutsceneSequence.js";
import type { LoadedAssets } from "../src/assetLoader.js";
import type { PlayBgmOptions, StopBgmOptions } from "../src/audioManager.js";
import type { AssetHost } from "../src/engineTypes.js";
import { playRuntimeCutsceneAudio } from "../src/runtimeCutsceneAudio.js";

test("playRuntimeCutsceneAudio preserves BGM loop and fade controls", () => {
  const bgmCalls: Array<{ soundId: number; options?: PlayBgmOptions }> = [];
  const audioEvents: unknown[] = [];
  const command = audioCommand({
    kind: "audio",
    sound: "intro",
    bus: "bgm",
    volume: 0.65,
    loop: false,
    fadeSeconds: 0.4,
  });

  playRuntimeCutsceneAudio(command, {
    ...baseAssetHost(),
    soundId: (name) => name === "intro" ? 9 : 0,
    hasSound: (soundId) => soundId === 9,
    playBgm: (soundId, options) => bgmCalls.push({ soundId, options }),
    playAudioEvents: (events) => audioEvents.push(...events),
  });

  equal(audioEvents.length, 0);
  deepEqual(bgmCalls, [{
    soundId: 9,
    options: {
      volume: 0.65,
      loop: false,
      fadeInSeconds: 0.4,
    },
  }]);
});

test("playRuntimeCutsceneAudio stops BGM with fade without emitting a play event", () => {
  const stopCalls: StopBgmOptions[] = [];
  const audioEvents: unknown[] = [];
  const command = audioCommand({
    kind: "audio",
    sound: "intro",
    action: "stop",
    bus: "bgm",
    fadeSeconds: 0.25,
  });

  playRuntimeCutsceneAudio(command, {
    ...baseAssetHost(),
    stopBgm: (options) => stopCalls.push(options ?? {}),
    playAudioEvents: (events) => audioEvents.push(...events),
  });

  deepEqual(stopCalls, [{ fadeOutSeconds: 0.25 }]);
  equal(audioEvents.length, 0);
});

test("playRuntimeCutsceneAudio keeps SFX and legacy BGM hosts on audio events", () => {
  const audioEvents: unknown[] = [];
  const sfxCommand = audioCommand({
    kind: "audio",
    sound: 12,
    bus: "sfx",
    volume: 0.75,
  });
  const legacyBgmCommand = audioCommand({
    kind: "audio",
    sound: 14,
    bus: "bgm",
    volume: 0.5,
    loop: true,
    fadeSeconds: 0.1,
  });

  const assetHost = {
    ...baseAssetHost(),
    hasSound: (soundId: number) => soundId === 12 || soundId === 14,
    playAudioEvents: (events: readonly unknown[]) => audioEvents.push(...events),
  };
  playRuntimeCutsceneAudio(sfxCommand, assetHost);
  playRuntimeCutsceneAudio(legacyBgmCommand, assetHost);

  deepEqual(audioEvents, [
    { soundId: 12, volume: 0.75, pitch: 1, channelId: 1 },
    { soundId: 14, volume: 0.5, pitch: 1, channelId: 0 },
  ]);
});

function audioCommand(spec: CutsceneAudioCommandSpec): ResolvedCutsceneAudioCommand {
  const sequence = resolveCutsceneSequenceSpec({ commands: [spec] });
  const command = sequence.commands[0];
  if (command?.kind !== "audio") {
    throw new Error("Expected resolved audio command.");
  }
  return command;
}

function baseAssetHost(): AssetHost {
  return {
    loadAssets: async () => ({
      textures: {},
      sounds: {},
      json: {},
      progress: { loaded: 0, total: 0, ratio: 1 },
    } as LoadedAssets),
    textureId: () => 0,
  };
}
