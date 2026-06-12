import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  createFerrumRuntime,
} from "../src/createFerrumRuntime.js";
import type {
  FerrumRuntimeFrame,
  FerrumRuntimeRenderer,
} from "../src/createFerrumRuntime.js";
import type { AssetHost, FerrumEngine } from "../src/engineTypes.js";
import type { InputManager } from "../src/inputManager.js";
import type { AssetReleasePayload, LoadedAssets } from "../src/assetLoader.js";
import type { PlayBgmOptions } from "../src/audioManager.js";
import { emptyRendererStats } from "../src/renderer.js";

test("createFerrumRuntime wires opt-in content handles without DOM overlay ownership", async () => {
  const bgmCalls: Array<{ soundId: number; options?: PlayBgmOptions }> = [];
  const engineCalls: string[] = [];
  const runtime = await createFerrumRuntime({
    canvas: {} as HTMLCanvasElement,
    engineInstance: fakeEngine(engineCalls),
    renderer: fakeRuntimeRenderer(),
    input: {} as InputManager,
    assetHost: fakeAssetHost(bgmCalls),
    ui: false,
    hud: {
      panelId: "runtime-hud",
      title: "Runtime HUD",
      components: (frame) => [
        { type: "counter", id: "score", label: "Score", value: frame.frame.score },
        { type: "counter", id: "commands", label: "Commands", value: frame.rendererStats.renderCommandCount },
      ],
    },
    accessibility: {
      spec: {
        subtitles: true,
        contrastPalette: "high-contrast",
        reducedMotion: false,
      },
      title: "Runtime Subtitles",
      subtitle: (frame) => ({
        id: "runtime-subtitles",
        speaker: "Guide",
        text: `Score ${frame.frame.score}`,
      }),
    },
    localization: {
      locale: "ko",
      document: {
        defaultLocale: "en",
        fallbackLocale: "en",
        locales: {
          en: { strings: { "intro.ready": "Ready, {name}?" } },
          ko: { strings: { "intro.ready": "준비됐나요, {name}?" } },
        },
      },
    },
    animationTimeline: {
      timeline: {
        initialState: "idle",
        states: {
          idle: {
            frames: ["idle.0"],
            fps: 1,
            transitions: [{ on: "move", to: "move" }],
          },
          move: {
            frames: ["move.0"],
            fps: 1,
          },
        },
      },
      signals: (frame) => frame.frame.score > 0 ? ["move"] : [],
    },
    cutscene: {
      sequence: {
        id: "intro",
        commands: [
          { kind: "audio", sound: "intro-bgm", bus: "bgm", loop: false, volume: 0.7, fadeSeconds: 0.25 },
          { kind: "dialogue", speaker: "Guide", text: "intro.ready", durationSeconds: 1 },
        ],
      },
      dialogue: {
        title: "Intro",
        textMode: "localizationKey",
        values: { name: "Ferrum2D" },
      },
    },
  });

  try {
    const frame = runtimeFrame();
    const { hud, accessibility, localization, animationTimeline, cutscene } = runtime;
    if (!hud || !accessibility || !localization || !animationTimeline || !cutscene) {
      throw new Error("Expected createFerrumRuntime to expose all opt-in content handles.");
    }
    equal(runtime.uiOverlay, undefined);
    equal(localization.t("intro.ready", { values: { name: "Ferrum2D" } }), "준비됐나요, Ferrum2D?");

    const hudState = hud.uiState(frame);
    deepEqual(hudState?.panels?.[0]?.lines?.map((line) => [line.id, line.value]), [
      ["score", 42],
      ["commands", 3],
    ]);

    const subtitleState = accessibility.uiState(frame);
    deepEqual(subtitleState?.panels?.[0]?.lines?.map((line) => [line.id, line.value ?? line.text]), [
      ["speaker", "Guide"],
      ["text", "Score 42"],
    ]);

    const animationResult = animationTimeline.update(frame);
    equal(animationResult?.snapshot.state, "move");

    const cutsceneResult = cutscene.update(frame);
    equal(cutsceneResult?.events.some((event) => event.command.kind === "audio"), true);
    equal(cutscene.uiState()?.dialog?.body, "준비됐나요, Ferrum2D?");
    deepEqual(bgmCalls, [{
      soundId: 7,
      options: {
        volume: 0.7,
        loop: false,
        fadeInSeconds: 0.25,
      },
    }]);
  } finally {
    runtime.destroy();
  }
  deepEqual(engineCalls, []);
});

test("createFerrumRuntime forwards injected engine lifecycle without taking ownership", async () => {
  const engineCalls: string[] = [];
  const runtime = await createFerrumRuntime({
    canvas: {} as HTMLCanvasElement,
    engineInstance: fakeEngine(engineCalls),
    renderer: fakeRuntimeRenderer(),
    input: {} as InputManager,
    assetHost: fakeAssetHost([]),
    ui: false,
    autostart: true,
  });

  runtime.pause();
  runtime.resume();
  runtime.stop();
  runtime.destroy();
  runtime.destroy();

  deepEqual(engineCalls, ["start", "pause", "resume", "stop"]);
});

test("createFerrumRuntime forwards level streaming released assets to target and asset host", async () => {
  const engineCalls: string[] = [];
  const releaseCalls: AssetReleasePayload[] = [];
  const targetReleaseCalls: AssetReleasePayload[] = [];
  let viewportX = 0;
  const runtime = await createFerrumRuntime({
    canvas: {} as HTMLCanvasElement,
    engineInstance: fakeEngine(engineCalls),
    renderer: fakeRuntimeRenderer(),
    input: {} as InputManager,
    assetHost: fakeAssetHost([], releaseCalls),
    ui: false,
    levelStreaming: {
      manifest: {
        id: "runtime-map",
        tileWidth: 16,
        tileHeight: 16,
        chunkColumns: 4,
        chunkRows: 4,
        chunks: [
          {
            id: "0,0",
            chunkX: 0,
            chunkY: 0,
            tilemap: { url: "/chunks/0-0.json" },
            assets: {
              textures: { local: "/textures/local.png", shared: "/textures/shared.png" },
              sounds: { wind: "/sounds/wind.ogg" },
            },
          },
          {
            id: "1,0",
            chunkX: 1,
            chunkY: 0,
            tilemap: { url: "/chunks/1-0.json" },
            assets: {
              textures: { shared: "/textures/shared.png" },
            },
          },
        ],
      },
      assetLifetime: { preloadMarginChunks: 0, retainMarginChunks: 0 },
      viewport: () => ({ x: viewportX, y: 0, width: 32, height: 32 }),
      preload: false,
      target: {
        releaseAssets: (assets, context) => {
          equal(context.result.releasedAssets, assets);
          targetReleaseCalls.push(assets);
        },
      },
    },
  });

  try {
    const first = runtime.levelStreaming?.update(runtimeFrame());
    deepEqual(first?.loadChunkIds, ["0,0"]);
    equal(first?.releasedAssets, undefined);

    viewportX = 80;
    const second = runtime.levelStreaming?.update(runtimeFrame());
    deepEqual(second?.unloadChunkIds, ["0,0"]);
    deepEqual(second?.releasedAssets?.entries.map(releasedAssetLabel), [
      "texture:local:/textures/local.png",
      "sound:wind:/sounds/wind.ogg",
      "json:0,0:tilemap:/chunks/0-0.json",
    ]);
    equal(second?.releasedAssets?.entries.some((entry) => entry.name === "shared"), false);
    equal(targetReleaseCalls[0], releaseCalls[0]);
    deepEqual(releaseCalls.map((assets) => assets.entries.map(releasedAssetLabel)), [[
      "texture:local:/textures/local.png",
      "sound:wind:/sounds/wind.ogg",
      "json:0,0:tilemap:/chunks/0-0.json",
    ]]);
  } finally {
    runtime.destroy();
  }
  deepEqual(engineCalls, []);
});

function fakeEngine(calls: string[]): FerrumEngine {
  return {
    start: () => {
      calls.push("start");
    },
    pause: () => {
      calls.push("pause");
    },
    resume: () => {
      calls.push("resume");
    },
    stop: () => {
      calls.push("stop");
    },
    destroy: () => {
      calls.push("destroy");
    },
  } as unknown as FerrumEngine;
}

function fakeRuntimeRenderer(): FerrumRuntimeRenderer {
  return {
    render: () => undefined,
    resize: () => undefined,
    stats: () => emptyRendererStats(),
    destroy: () => undefined,
    loadTexture: async () => undefined,
    renderCommands: () => ({
      ...emptyRendererStats(),
      drawCalls: 1,
      batchCount: 1,
      renderCommandCount: 3,
    }),
    renderPhysicsDebugLines: () => emptyRendererStats(),
    viewportSize: () => ({ width: 640, height: 360 }),
    renderPostProcess: () => ({
      ...emptyRendererStats(),
      drawCalls: 1,
      batchCount: 1,
      renderCommandCount: 3,
    }),
  } as unknown as FerrumRuntimeRenderer;
}

function fakeAssetHost(
  bgmCalls: Array<{ soundId: number; options?: PlayBgmOptions }>,
  releaseCalls: AssetReleasePayload[] = [],
): AssetHost {
  return {
    loadAssets: async () => ({
      textures: {},
      sounds: {},
      json: {},
      progress: { loaded: 0, total: 0, ratio: 1 },
    } as LoadedAssets),
    textureId: () => 0,
    soundId: (name) => name === "intro-bgm" ? 7 : 0,
    hasSound: (soundId) => soundId === 7,
    playBgm: (soundId, options) => bgmCalls.push({ soundId, options }),
    releaseAssets: (assets) => {
      releaseCalls.push(assets);
    },
  };
}

function releasedAssetLabel(entry: AssetReleasePayload["entries"][number]): string {
  return `${entry.kind}:${entry.name}:${entry.url}`;
}

function runtimeFrame(): FerrumRuntimeFrame {
  return {
    frame: {
      score: 42,
      frameTimeMs: 16,
    },
    rendererStats: {
      ...emptyRendererStats(),
      renderCommandCount: 3,
    },
    debugMetrics: {},
    fps: 60,
    renderTimeMs: 1,
  } as FerrumRuntimeFrame;
}
