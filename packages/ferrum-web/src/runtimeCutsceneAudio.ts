import { AUDIO_CHANNEL_BGM, AUDIO_CHANNEL_SFX } from "./audioEventDecoder.js";
import type { ResolvedCutsceneAudioCommand } from "./cutsceneSequence.js";
import type { AssetHost } from "./engineTypes.js";

export function playRuntimeCutsceneAudio(command: ResolvedCutsceneAudioCommand, assetHost: AssetHost): void {
  if (command.action === "stop") {
    if (command.bus === "bgm") {
      assetHost.stopBgm?.({ fadeOutSeconds: command.fadeSeconds });
    }
    return;
  }

  const soundId = resolveCutsceneSoundId(command, assetHost);
  if (soundId === undefined || assetHost.hasSound?.(soundId) === false) {
    return;
  }

  if (command.bus === "bgm" && assetHost.playBgm !== undefined) {
    assetHost.playBgm(soundId, {
      volume: command.volume,
      loop: command.loop,
      fadeInSeconds: command.fadeSeconds,
    });
    return;
  }

  assetHost.playAudioEvents?.([{
    soundId,
    volume: command.volume,
    pitch: 1,
    channelId: command.bus === "bgm" ? AUDIO_CHANNEL_BGM : AUDIO_CHANNEL_SFX,
  }]);
}

function resolveCutsceneSoundId(
  command: ResolvedCutsceneAudioCommand,
  assetHost: AssetHost,
): number | undefined {
  return typeof command.sound === "number"
    ? Math.trunc(command.sound)
    : assetHost.soundId?.(command.sound);
}
