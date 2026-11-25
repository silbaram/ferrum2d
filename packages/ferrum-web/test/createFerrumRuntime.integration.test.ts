import "./nativeRuntimeTestHelper.js";
import { BrowserPlatformHost } from "../src/browserPlatformHost.js";
import { DialogueSession } from "../src/dialogueQuest.js";
import { WasmBridge } from "../src/wasmBridge.js";
import { deepEqual, equal, ok, throws, rejects } from "node:assert/strict";
import process from "node:process";
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
import { VirtualControls } from "../src/virtualControls.js";
import type { AssetLoadProgress, AssetReleasePayload, LoadedAssets } from "../src/assetLoader.js";
import type { PlayBgmOptions } from "../src/audioManager.js";
import type { DataSceneGameState } from "../src/gameState.js";
import { resolvePixelPerfectOptions, resolvePixelPerfectPresentation, type PixelPerfectPresentation } from "../src/pixelPerfect.js";
import { emptyRendererStats } from "../src/renderer.js";
import { WebGPURenderer } from "../src/webgpuRenderer.js";
import {
  attachDataSceneRuntimeEngineAdapter,
  type DataSceneRuntimeSpawnRequest,
} from "../src/dataSceneRuntimeTarget.js";
import { attachMemoryDataSceneVariableRuntime } from "./dataSceneVariableRuntimeTestAdapter.js";

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

test("createFerrumRuntime applies and reapplies data scene authoring documents", async () => {
  const engineCalls: string[] = [];
  const flow: MutableDataSceneFlow = { state: "playing" };
  const adapter = new RuntimeDataSceneAdapter(flow);
  const runtime = await createFerrumRuntime({
    canvas: {} as HTMLCanvasElement,
    engineInstance: attachMemoryDataSceneVariableRuntime(
      attachDataSceneRuntimeEngineAdapter(fakeEngine(engineCalls, flow), adapter),
    ),
    renderer: fakeRuntimeRenderer(),
    input: {} as InputManager,
    assetHost: fakeAssetHost([]),
    ui: false,
    dataScene: {
      document: runtimeDataSceneDocument("crate", 32, 48),
      path: "runtimeDataScene",
    },
  });

  try {
    if (runtime.dataScene === undefined) {
      throw new Error("Expected createFerrumRuntime to expose dataScene handle.");
    }
    equal(adapter.useDataSceneCalls, 1);
    equal(runtime.dataScene.result.spawnResults.length, 1);
    equal(runtime.dataScene.document().sceneComposition.fragments.main?.instances[0]?.id, "crate-1");
    equal(adapter.requests[0].x, 32);
    equal(adapter.requests[0].y, 48);
    equal(adapter.requests[0].textureId, 77);
    equal(runtime.dataScene.variables.get("campaign.coins"), 0);
    equal(runtime.dataScene.variables.get("wave.index"), 1);
    equal(runtime.dataScene.state(), "playing");
    runtime.dataScene.variables.set("campaign.coins", 12);
    runtime.dataScene.variables.set("wave.index", 4);

    throws(
      () => runtime.dataScene?.reapply({
        ...runtimeDataSceneDocument("invalid", 0, 0),
        variables: [
          { name: "campaign.coins", scope: "global", type: "integer", default: 0 },
          { name: "campaign.coins", scope: "scene", type: "integer", default: 0 },
        ],
      }),
      /duplicates variable/,
    );
    equal(adapter.useDataSceneCalls, 1);
    equal(runtime.dataScene.variables.get("campaign.coins"), 12);
    equal(runtime.dataScene.variables.get("wave.index"), 4);

    const retriedResult = runtime.dataScene.reapply();
    equal(retriedResult.variables, runtime.dataScene.variables);
    equal(retriedResult.document.sceneComposition.fragments.main?.instances[0]?.id, "crate-1");
    equal(runtime.dataScene.variables.get("campaign.coins"), 12);
    equal(runtime.dataScene.variables.get("wave.index"), 1);

    equal(runtime.dataScene.pause(), true);
    equal(runtime.dataScene.pause(), false);
    equal(runtime.dataScene.state(), "paused");
    equal(runtime.dataScene.resume(), true);
    equal(runtime.dataScene.state(), "playing");
    equal(runtime.dataScene.complete(), true);
    equal(runtime.dataScene.complete(), false);
    equal(runtime.dataScene.state(), "levelComplete");

    const nextResult = runtime.dataScene.transition(runtimeDataSceneDocument("barrel", 96, 112, 100, 2));
    equal(adapter.useDataSceneCalls, 3);
    equal(nextResult.spawnResults[0]?.entityId, 103);
    equal(nextResult.variables, runtime.dataScene.variables);
    equal(runtime.dataScene.result.document.sceneComposition.fragments.main?.instances[0]?.id, "barrel-1");
    equal(adapter.requests[2].x, 96);
    equal(adapter.requests[2].y, 112);
    equal(runtime.dataScene.variables.get("campaign.coins"), 12);
    equal(runtime.dataScene.variables.get("wave.index"), 2);
    equal(runtime.dataScene.state(), "playing");
    throws(
      () => runtime.dataScene?.transition(
        runtimeDataSceneDocument("blocked", 0, 0),
        { activateDataScene: false } as never,
      ),
      /cannot disable Data Scene activation/,
    );
    equal(adapter.useDataSceneCalls, 3);
  } finally {
    runtime.destroy();
  }
  deepEqual(engineCalls, []);
});

test("createFerrumRuntime transition overrides startup activation opt-out", async () => {
  const engineCalls: string[] = [];
  const flow: MutableDataSceneFlow = { state: "playing" };
  const adapter = new RuntimeDataSceneAdapter(flow);
  const runtime = await createFerrumRuntime({
    canvas: {} as HTMLCanvasElement,
    engineInstance: attachMemoryDataSceneVariableRuntime(
      attachDataSceneRuntimeEngineAdapter(fakeEngine(engineCalls, flow), adapter),
    ),
    renderer: fakeRuntimeRenderer(),
    input: {} as InputManager,
    assetHost: fakeAssetHost([]),
    ui: false,
    dataScene: {
      document: runtimeDataSceneDocument("prepared", 16, 16),
      activateDataScene: false,
    },
  });

  try {
    equal(adapter.useDataSceneCalls, 0);
    runtime.dataScene?.transition(runtimeDataSceneDocument("next", 32, 32));
    equal(adapter.useDataSceneCalls, 1);
  } finally {
    runtime.destroy();
  }
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

function fakeEngine(calls: string[], flow?: MutableDataSceneFlow): FerrumEngine {
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
    dataSceneState: () => flow?.state,
    pauseDataScene: () => {
      if (flow?.state !== "playing") {
        return false;
      }
      flow.state = "paused";
      return true;
    },
    resumeDataScene: () => {
      if (flow?.state !== "paused") {
        return false;
      }
      flow.state = "playing";
      return true;
    },
    completeDataScene: () => {
      if (flow?.state !== "playing") {
        return false;
      }
      flow.state = "levelComplete";
      return true;
    },
  } as unknown as FerrumEngine;
}

interface MutableDataSceneFlow {
  state: DataSceneGameState;
}

class RuntimeDataSceneAdapter {
  readonly requests: DataSceneRuntimeSpawnRequest[] = [];
  useDataSceneCalls = 0;

  constructor(private readonly flow?: MutableDataSceneFlow) {}

  useDataScene(): void {
    this.useDataSceneCalls += 1;
    if (this.flow !== undefined) {
      this.flow.state = "playing";
    }
  }

  textureId(): number {
    return 77;
  }

  spawnDataSceneEntity(request: DataSceneRuntimeSpawnRequest): { entityId: number; entityGeneration: number } {
    this.requests.push(request);
    return {
      entityId: 100 + this.requests.length,
      entityGeneration: 1,
    };
  }
}

function runtimeDataSceneDocument(
  prefabId: string,
  x: number,
  y: number,
  globalDefault = 0,
  sceneDefault = 1,
) {
  return {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    variables: [
      { name: "campaign.coins", scope: "global", type: "integer", default: globalDefault },
      { name: "wave.index", scope: "scene", type: "integer", default: sceneDefault },
    ],
    sceneComposition: {
      initialFragment: "main",
      prefabs: {
        [prefabId]: {
          props: {
            components: {
              sprite: { texture: prefabId, width: 16, height: 12 },
              collider: "none",
              layer: "enemy",
            },
          },
        },
      },
      fragments: {
        main: {
          instances: [{ id: `${prefabId}-1`, prefab: prefabId, x, y }],
        },
      },
    },
    behaviorRecipes: { entities: {} },
  } as const;
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
  };
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


// EventTarget adapters keep ownership tests independent of a browser or Wasm.
class RuntimeInputSurface extends EventTarget {
  getBoundingClientRect() { return { left: 0, top: 0 }; }
}

test("runtime destroys owned assets after an input cancellation callback throws", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = new RuntimeInputSurface() as unknown as Window & typeof globalThis;
  const virtual = new VirtualControls({} as HTMLElement, { enabled: false });
  try {
    const calls: string[] = [];
    const renderer = fakeRuntimeRenderer();
    renderer.destroy = () => { calls.push("renderer destroy"); };
    const runtime = await createFerrumRuntime({
      canvas: new RuntimeInputSurface() as unknown as HTMLCanvasElement,
      engineInstance: fakeEngine(calls), renderer, ui: false, debug: false, profiler: false,
      inputOptions: { virtualControls: virtual, gamepad: false },
    });
    virtual.setButtonPressed("primary", true);
    virtual.subscribe(() => { throw new Error("input cancellation failed"); });
    throws(() => runtime.destroy(), /input cancellation failed/);
    throws(() => runtime.assetHost.hasSound?.(1), /destroyed/);
    equal(runtime.input.enabled, false);
    runtime.destroy();
    deepEqual(calls, []); // Injected engine/renderer remain externally owned.
  } finally {
    virtual.destroy();
    globalThis.window = previousWindow;
  }
});

test("runtime startup keeps the original failure if input cleanup also fails", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = new RuntimeInputSurface() as unknown as Window & typeof globalThis;
  const virtual = new VirtualControls({} as HTMLElement, { enabled: false });
  try {
    virtual.setButtonPressed("primary", true);
    virtual.subscribe(() => { throw new Error("cleanup failure"); });
    const renderer = fakeRuntimeRenderer();
    renderer.resize = () => { throw new Error("startup failure"); };
    let caught: unknown;
    try {
      await createFerrumRuntime({
        canvas: new RuntimeInputSurface() as unknown as HTMLCanvasElement,
        engineInstance: fakeEngine([]), renderer, ui: false, debug: false, profiler: false,
        inputOptions: { virtualControls: virtual, gamepad: false },
      });
    } catch (error) { caught = error; }
    equal(caught instanceof Error ? caught.message : String(caught), "startup failure");
    equal(virtual.state().buttons.primary, false);
  } finally {
    virtual.destroy();
    globalThis.window = previousWindow;
  }
});

test("runtime startup failure clears its physics scene without destroying injected resources", async () => {
  const calls: string[] = [];
  const engine = fakeEngine(calls);
  const startupError = new Error("engine start failed");
  const body = { entityId: 7, entityGeneration: 1 };
  let bodyPresent = false;
  let autoStep = false;
  engine.start = () => { throw startupError; };
  engine.configurePhysicsRuntime = (spec) => spec;
  engine.validatePhysicsRuntime = () => {};
  engine.configureAutoRigidBodyStep = (options) => { autoStep = options !== false; };
  engine.spawnRigidBody = () => { bodyPresent = true; return body; };
  engine.despawnPhysicsEntity = (handle) => {
    deepEqual(handle, body);
    bodyPresent = false;
    return true;
  };
  const renderer = fakeRuntimeRenderer();
  renderer.destroy = () => { calls.push("renderer destroy"); };
  let caught: unknown;
  try {
    await createFerrumRuntime({
      canvas: {} as HTMLCanvasElement,
      engineInstance: engine, renderer, input: {} as InputManager, assetHost: fakeAssetHost([]),
      ui: false, autostart: true,
      physicsScene: {
        physics: {
          mode: "rigid",
          bodies: { crate: { type: "dynamic", collider: { shape: "box", size: [16, 16] } } },
        },
      },
    });
  } catch (error) { caught = error; }
  equal(caught, startupError);
  equal(bodyPresent, false);
  equal(autoStep, false);
  deepEqual(calls, []);
});


test("pixel display defaults, scene overrides, failed reapply and injected renderer ownership", async () => {
  const flow: MutableDataSceneFlow={state:"playing"};
  const engine=attachMemoryDataSceneVariableRuntime(attachDataSceneRuntimeEngineAdapter(fakeEngine([],flow),new RuntimeDataSceneAdapter(flow)));
  const sizes: unknown[]=[];engine.setViewportSize=(width,height)=>{sizes.push([width,height]);};
  const renderer=fakeRuntimeRenderer();let presentation: PixelPerfectPresentation | undefined;
  renderer.setPixelPerfect=value=>{const config=resolvePixelPerfectOptions(value);presentation=config?resolvePixelPerfectPresentation(1280,720,config):undefined;};
  renderer.pixelPerfectPresentation=()=>presentation;
  renderer.viewportSize=()=>({width:presentation?.sourceWidth??640,height:presentation?.sourceHeight??360});
  const document=runtimeDataSceneDocument("crate",32,48);
  const runtime=await createFerrumRuntime({canvas:{} as HTMLCanvasElement,engineInstance:engine,renderer,input:{} as InputManager,assetHost:fakeAssetHost([]),ui:false,
    pixelPerfect:{width:320,height:180},dataScene:document});
  try {
    equal(presentation?.sourceWidth,320);
    runtime.dataScene!.reapply({...document,display:{pixelPerfect:false}});equal(presentation,undefined);
    runtime.dataScene!.reapply({...document,display:{pixelPerfect:{width:160,height:90}}});equal(renderer.pixelPerfectPresentation()?.sourceWidth,160);
    const viewportWritesBeforeFailure=sizes.length;
    // Display must roll back even when a later, unrelated scene validation fails.
    throws(()=>runtime.dataScene!.reapply({...document,display:{pixelPerfect:{width:64,height:48}},sceneComposition:{...document.sceneComposition,initialFragment:"missing"}}));
    equal(renderer.pixelPerfectPresentation()?.sourceWidth,160);
    equal(sizes.length,viewportWritesBeforeFailure);
    runtime.dataScene!.reapply();equal(renderer.pixelPerfectPresentation()?.sourceWidth,160);
    runtime.dataScene!.transition(document);equal(renderer.pixelPerfectPresentation()?.sourceWidth,320);
    equal(sizes.length>0,true);
  }finally{runtime.destroy();}
  equal(renderer.pixelPerfectPresentation()?.sourceWidth,320); // Caller still owns the renderer.
});

test("pixel display preflights capability and conflicts, and restores injected display on startup failure", async () => {
  const renderer=fakeRuntimeRenderer(),base={canvas:{} as HTMLCanvasElement,engineInstance:fakeEngine([]),renderer,input:{} as InputManager,assetHost:fakeAssetHost([]),ui:false as const};
  await rejects(createFerrumRuntime({...base,pixelPerfect:{width:320,height:180}}),/support pixelPerfect/);
  await rejects(createFerrumRuntime({...base,pixelPerfect:false,webgl2:{pixelPerfect:{width:320,height:180}}}),/Conflicting/);
  let presentation: PixelPerfectPresentation | undefined=resolvePixelPerfectPresentation(640,360,{width:64,height:48});
  renderer.pixelPerfectPresentation=()=>presentation;
  renderer.setPixelPerfect=value=>{const config=resolvePixelPerfectOptions(value);presentation=config?resolvePixelPerfectPresentation(640,360,config):undefined;};
  let viewportWrites=0;base.engineInstance.setViewportSize=()=>{viewportWrites++;};
  renderer.resize=()=>{throw Error("startup resize failed");};
  await rejects(createFerrumRuntime({...base,pixelPerfect:{width:320,height:180}}),/startup resize failed/);
  equal(renderer.pixelPerfectPresentation()?.sourceWidth,64);
  equal(viewportWrites,0);
});


test("pixel display updates an injected native viewport without a Data Scene document",async()=>{
  const renderer=fakeRuntimeRenderer(),engine=fakeEngine([]);let presentation: PixelPerfectPresentation | undefined;
  const sizes: number[][]=[];engine.setViewportSize=(width,height)=>{sizes.push([width,height]);};
  renderer.pixelPerfectPresentation=()=>presentation;
  renderer.setPixelPerfect=value=>{const config=resolvePixelPerfectOptions(value);presentation=config?resolvePixelPerfectPresentation(640,360,config):undefined;};
  renderer.viewportSize=()=>({width:presentation?.sourceWidth??640,height:presentation?.sourceHeight??360});
  const base={canvas:{} as HTMLCanvasElement,engineInstance:engine,renderer,input:{} as InputManager,assetHost:fakeAssetHost([]),ui:false as const};
  const pixel=await createFerrumRuntime({...base,pixelPerfect:{width:320,height:180}});pixel.destroy();
  const plain=await createFerrumRuntime({...base,pixelPerfect:false});plain.destroy();
  deepEqual(sizes,[[320,180],[640,360]]);
});

test("failed display rollback reports both failures and retains the last successful document",async()=>{
  const engine=attachMemoryDataSceneVariableRuntime(attachDataSceneRuntimeEngineAdapter(fakeEngine([]),new RuntimeDataSceneAdapter()));
  engine.setViewportSize=()=>{};
  const renderer=fakeRuntimeRenderer();let presentation:PixelPerfectPresentation|undefined,blockRollback=false;
  renderer.pixelPerfectPresentation=()=>presentation;
  renderer.viewportSize=()=>({width:presentation?.sourceWidth??640,height:presentation?.sourceHeight??360});
  const rollbackError=new Error('injected rollback allocation failure');
  renderer.setPixelPerfect=value=>{const config=resolvePixelPerfectOptions(value);if(blockRollback&&config?.width===320)throw rollbackError;presentation=config?resolvePixelPerfectPresentation(640,360,config):undefined;};
  const document={...runtimeDataSceneDocument('crate',32,48),display:{pixelPerfect:{width:320,height:180}}};
  const runtime=await createFerrumRuntime({canvas:{} as HTMLCanvasElement,engineInstance:engine,renderer,input:{} as InputManager,assetHost:fakeAssetHost([]),ui:false,dataScene:document});
  try{
    const previous=runtime.dataScene!.document();blockRollback=true;let caught:unknown;
    try{runtime.dataScene!.reapply({...document,display:{pixelPerfect:{width:160,height:90}},sceneComposition:{...document.sceneComposition,initialFragment:'missing'}});}catch(error){caught=error;}
    if(!(caught instanceof Error)||!('cause' in caught)||!('displayRollbackError' in caught))throw Error('both failures must be exposed');
    equal(caught.displayRollbackError,rollbackError);
    equal(caught.cause instanceof Error,true);equal(caught.message.includes('display rollback also failed'),true);
    equal(runtime.dataScene!.document(),previous);
  }finally{blockRollback=false;runtime.destroy();}
});


test("runtime releases its native dialogue while injected sessions remain caller-owned", async () => {
  const graph = { initialNode: "start", nodes: { start: { text: "Hello", end: true } } };
  const options = {
    canvas: {} as HTMLCanvasElement,
    engineInstance: fakeEngine([]), renderer: fakeRuntimeRenderer(),
    input: {} as InputManager, assetHost: fakeAssetHost([]), ui: false as const,
  };
  const owned = await createFerrumRuntime({ ...options, dialogue: { graph } });
  const ownedSession = owned.dialogue!.session;
  owned.destroy();
  owned.destroy();
  throws(() => ownedSession.snapshot(), /destroyed/);
  const session = new DialogueSession(graph);
  const injected = await createFerrumRuntime({ ...options, dialogue: { graph, session } });
  injected.destroy();
  equal(session.snapshot().nodeId, "start");
  session.destroy();
});

test("runtime startup failure frees an already-created native dialogue", async () => {
  const graph = { initialNode: "start", nodes: { start: { text: "Hello", end: true } } };
  let freed = 0;
  const original = DialogueSession.prototype.destroy;
  DialogueSession.prototype.destroy = function () { freed++; original.call(this); };
  try {
    await rejects(createFerrumRuntime({
      canvas: {} as HTMLCanvasElement,
      engineInstance: { ...fakeEngine([]), start: () => { throw new Error("startup failure"); } }, renderer: fakeRuntimeRenderer(),
      input: {} as InputManager, assetHost: fakeAssetHost([]), ui: false,
      dialogue: { graph },
      autostart: true,
    }), /startup failure/);
    equal(freed, 1);
  } finally {
    DialogueSession.prototype.destroy = original;
  }
});


test("dialogue ownership follows the captured resource despite option or public handle replacement", async () => {
  const graph = { initialNode: "start", nodes: { start: { text: "Hello", end: true } } };
  const external = new DialogueSession(graph);
  const dialogue: { graph: typeof graph; session?: DialogueSession } = { graph };
  const pending = createFerrumRuntime({
    canvas: {} as HTMLCanvasElement, engineInstance: fakeEngine([]), renderer: fakeRuntimeRenderer(),
    input: {} as InputManager, assetHost: fakeAssetHost([]), ui: false, dialogue,
  });
  dialogue.session = external;
  const runtime = await pending;
  const owned = runtime.dialogue!.session;
  equal(owned === external, false);
  runtime.dialogue!.session = external;
  runtime.destroy();
  throws(() => owned.snapshot(), /destroyed/);
  equal(external.snapshot().nodeId, "start");
  external.destroy();
});


test("owned createFerrumRuntime without physics options selects the same native variable backend", async () => {
  const runtime = await createFerrumRuntime({
    canvas: {} as HTMLCanvasElement, renderer: fakeRuntimeRenderer(),
    input: {} as InputManager, assetHost: fakeAssetHost([]), ui: false,
  });
  try {
    equal(runtime.engine.physicsBackend(), "unified-3d");
    runtime.engine.useDataScene();
    equal(runtime.engine.physicsBackend(), "unified-3d");
    runtime.engine.usePlatformerGame();
    equal(runtime.engine.physicsBackend(), "unified-3d");
  } finally { runtime.destroy(); }
});

function startupOptions(renderer = fakeRuntimeRenderer()) {
  return { canvas: {} as HTMLCanvasElement, renderer, input: {} as InputManager, ui: false as const };
}

test("releaseCanvasContext rejects a caller-owned renderer before touching the canvas or renderer", async (t) => {
  const renderer = fakeRuntimeRenderer();
  const releaseContext = renderer.releaseContext = t.mock.fn();
  const resize = t.mock.method(renderer, "resize");
  const getContext = t.mock.fn();
  await rejects(createFerrumRuntime({
    ...startupOptions(renderer), canvas: { getContext } as unknown as HTMLCanvasElement,
    releaseCanvasContext: true,
  }), /releaseCanvasContext requires a runtime-owned renderer/);
  equal(getContext.mock.callCount(), 0);
  equal(resize.mock.callCount(), 0);
  equal(releaseContext.mock.callCount(), 0);
});

for (const releaseCanvasContext of [undefined, false, true]) {
  test(`runtime destroys before releasing its canvas (opt-in: ${releaseCanvasContext})`, async (t) => {
    const calls: string[] = [];
    const renderer = Object.assign(fakeRuntimeRenderer(), {
      destroy: () => { calls.push("destroy"); },
      releaseContext: () => { calls.push("release"); },
    });
    t.mock.method(WebGPURenderer, "create", async () => renderer as unknown as WebGPURenderer);
    const runtime = await createFerrumRuntime({
      ...startupOptions(), renderer: undefined, rendererPreference: "webgpu", releaseCanvasContext,
      engineInstance: fakeEngine([]), assetHost: fakeAssetHost([]),
    });
    runtime.destroy();
    runtime.destroy();
    deepEqual(calls, releaseCanvasContext ? ["destroy", "release"] : ["destroy"]);
  });
}

test("startup cleanup releases the canvas after a renderer destroy error and preserves the startup failure", async (t) => {
  const calls: string[] = [];
  const startupError = new Error("start failed");
  const engine = fakeEngine([]);
  engine.start = () => { throw startupError; };
  const renderer = Object.assign(fakeRuntimeRenderer(), {
    destroy: () => { calls.push("destroy"); throw new Error("destroy failed"); },
    releaseContext: () => { calls.push("release"); },
  });
  t.mock.method(WebGPURenderer, "create", async () => renderer as unknown as WebGPURenderer);
  await rejects(createFerrumRuntime({
    ...startupOptions(), renderer: undefined, rendererPreference: "webgpu", releaseCanvasContext: true,
    engineInstance: engine, assetHost: fakeAssetHost([]), autostart: true,
  }), error => error === startupError);
  deepEqual(calls, ["destroy", "release"]);
});

function fitFixture(width = 1000, height = 500) {
  const size = { clientWidth: width, clientHeight: height, width, height };
  const canvas = Object.assign(size, {
    getBoundingClientRect: () => ({ left: 30, top: 40, width: size.clientWidth, height: size.clientHeight }),
  }) as unknown as HTMLCanvasElement;
  const renderer = fakeRuntimeRenderer();
  const zooms: number[] = [];
  let zoom = 1;
  let presentation: PixelPerfectPresentation | undefined;
  renderer.setViewportZoom = (next) => { zoom = next; zooms.push(next); };
  renderer.viewportSize = () => ({
    width: (presentation?.sourceWidth ?? size.clientWidth) / zoom,
    height: (presentation?.sourceHeight ?? size.clientHeight) / zoom,
  });
  renderer.pixelPerfectPresentation = () => presentation;
  renderer.setPixelPerfect = (value) => {
    const next = resolvePixelPerfectOptions(value);
    presentation = next ? resolvePixelPerfectPresentation(size.width, size.height, next) : undefined;
  };
  const document = {
    format: "ferrum2d.consumer.scene-authoring", version: 1,
    behaviorRecipes: { entities: {} },
    sceneComposition: {
      initialFragment: "main",
      prefabs: { hero: { props: { components: {
        visual: { kind: "sprite", texture: "hero", width: 16, height: 12 },
        layer: "enemy",
        collider: { type: "aabb", halfWidth: 8, halfHeight: 6, isTrigger: false },
        body: { type: "kinematic" },
      } } } },
      fragments: { main: { instances: [{ id: "hero-1", prefab: "hero", x: 80, y: 40 }] } },
    },
  } as const;
  return {
    size, renderer, zooms,
    options: {
      ...startupOptions(renderer), canvas, assets: { textures: { hero: "/hero.png" } }, dataScene: document,
    },
    document,
  };
}

test("runtime fit zoom is responsive and keeps one view across document updates", async () => {
  const previousWindow = globalThis.window;
  const windowSurface = new RuntimeInputSurface();
  globalThis.window = windowSurface as unknown as Window & typeof globalThis;
  try {
    const { options, size, zooms, renderer, document } = fitFixture();
    const runtime = await createFerrumRuntime({ ...options, fit: { width: 640, height: 384 } });
    try {
      const scene = runtime.dataScene!;
      const view = scene.view;
      equal(zooms[zooms.length - 1], 500 / 384);
      deepEqual([view.snapshot().cameraX, view.snapshot().cameraY], [320, 192]);
      const screenCenter = view.worldToScreen({ x: 320, y: 192 });
      const worldCenter = view.pointerToWorld({ x: 530, y: 290 });
      ok(Math.abs(screenCenter.x - 500) < 1e-8 && Math.abs(screenCenter.y - 250) < 1e-8);
      ok(Math.abs(worldCenter.x - 320) < 1e-8 && Math.abs(worldCenter.y - 192) < 1e-8);

      renderer.setViewportZoom!(2);
      equal(view.snapshot().zoom, 2);
      view.setZoom(3);
      equal(view.snapshot().zoom, 3);
      view.setCamera({ x: 400, y: 240 });
      size.clientWidth = size.width = 640;
      size.clientHeight = size.height = 640;
      windowSurface.dispatchEvent(new Event("resize"));
      equal(view.snapshot().zoom, 1);
      deepEqual([view.snapshot().cameraX, view.snapshot().cameraY], [400, 240]);
      deepEqual(view.pointerToWorld({ x: 350, y: 360 }), { x: 400, y: 240 });

      scene.reapply({ ...document, display: { fit: { width: 320, height: 160, x: -32, y: 20 } } });
      equal(scene.view, view);
      equal(view.snapshot().zoom, 2);
      deepEqual([view.snapshot().cameraX, view.snapshot().cameraY], [128, 100]);
      scene.reapply();
      equal(view.snapshot().zoom, 2);
      scene.transition({ ...document, display: { fit: false } });
      equal(scene.view, view);
      equal(view.snapshot().zoom, 1);
      view.setZoom(2);
      windowSurface.dispatchEvent(new Event("resize"));
      equal(view.snapshot().zoom, 2);
      scene.transition(document);
      equal(view.snapshot().zoom, 1);
      equal(scene.view, view);
    } finally {
      runtime.destroy();
    }
  } finally {
    globalThis.window = previousWindow;
  }
});

test("runtime fit defers zoom on a hidden canvas and preserves the new camera when shown", async () => {
  const previousWindow = globalThis.window;
  const windowSurface = new RuntimeInputSurface();
  globalThis.window = windowSurface as unknown as Window & typeof globalThis;
  try {
    const { options, size, zooms } = fitFixture(0, 0);
    const runtime = await createFerrumRuntime({ ...options, fit: { width: 640, height: 384 } });
    try {
      const { view } = runtime.dataScene!;
      deepEqual(zooms, []);
      throws(() => view.snapshot(), /visible canvas/);
      view.setCamera({ x: 96, y: 96 });
      size.clientWidth = size.width = 320;
      size.clientHeight = size.height = 240;
      windowSurface.dispatchEvent(new Event("resize"));
      deepEqual(zooms, [0.5]);
      deepEqual(view.worldToScreen({ x: 96, y: 96 }), { x: 160, y: 120 });
    } finally {
      runtime.destroy();
    }
  } finally {
    globalThis.window = previousWindow;
  }
});

test("runtime resolves fit and pixelPerfect defaults after document overrides", async () => {
  const { options, renderer, document } = fitFixture();
  const fit = { width: 640, height: 384 };
  const pixelPerfect = { width: 320, height: 180 };
  await rejects(createFerrumRuntime({ ...options, fit, dataScene: { ...document, display: { pixelPerfect } } }), /dataScene\.display\.fit.*pixelPerfect/);
  await rejects(createFerrumRuntime({ ...options, pixelPerfect, dataScene: { ...document, display: { fit } } }), /dataScene\.display\.fit.*pixelPerfect/);
  const spatial = { terrain: [], billboards: {}, camera: {
    projection: "orthographic" as const, position: { x: 0, y: -100, elevation: 100 }, target: { x: 0, y: 0, elevation: 0 }, height: 200,
  } };
  await rejects(createFerrumRuntime({ ...options, fit, dataScene: { ...document, spatial } }), /dataScene\.display\.fit.*spatial/);
  await rejects(createFerrumRuntime({ ...options, fit, renderer: fakeRuntimeRenderer() }), /display\.fit.*viewport zoom/);
  const runtime = await createFerrumRuntime({
    ...options, fit, pixelPerfect, dataScene: { ...document, display: { pixelPerfect: false } },
  });
  try {
    equal(renderer.pixelPerfectPresentation?.(), undefined);
    const scene = runtime.dataScene!;
    scene.transition({ ...document, display: { fit: false } });
    equal(renderer.pixelPerfectPresentation?.()?.sourceWidth, 320);
    equal(scene.view.snapshot().zoom, 1);
  } finally {
    runtime.destroy();
  }
});

test("runtime rolls back fit, scene and camera follow when display commit fails", async () => {
  const { options, document, renderer } = fitFixture();
  const runtime = await createFerrumRuntime({ ...options, fit: { width: 640, height: 384 } });
  try {
    const scene = runtime.dataScene!;
    const prior = scene.result;
    const view = scene.view;
    const actor = prior.entityHandles["hero-1"];
    view.setZoom(2);
    view.setCamera({ follow: actor, bounds: { minX: -600, minY: -600, maxX: 600, maxY: 600 } });
    const previous = view.snapshot();
    const rejectedCamera = runtime.engine.setDataSceneCamera;
    runtime.engine.setDataSceneCamera = () => false;
    try {
      throws(() => scene.reapply({ ...document, display: { fit: { width: 320, height: 180 } } }), /Data Scene camera requires/);
    } finally {
      runtime.engine.setDataSceneCamera = rejectedCamera;
    }
    equal(scene.result, prior);
    equal(scene.view, view);
    deepEqual(view.snapshot(), previous);
    ok(runtime.engine.getPhysicsEntity(actor));
    ok(runtime.engine.setPhysicsBodyPosition(actor, 200, 160));
    const viewport = renderer.viewportSize();
    runtime.engine.setViewportSize(viewport.width, viewport.height);
    deepEqual([view.snapshot().cameraX, view.snapshot().cameraY], [200, 160]);
  } finally {
    runtime.destroy();
  }
});

test("startup failure restores the injected renderer's previous zoom at the upper limit", async () => {
  const { options, renderer, zooms } = fitFixture(169, 500);
  renderer.setViewportZoom!(10000);
  const started = new Error("autostart denied");
  const inputMock = fakeEngine([]);
  inputMock.setViewportSize = () => {};
  inputMock.setDataSceneCamera = () => true;
  inputMock.start = () => { throw started; };
  const engine = attachMemoryDataSceneVariableRuntime(attachDataSceneRuntimeEngineAdapter(inputMock, new RuntimeDataSceneAdapter()));
  await rejects(createFerrumRuntime({
    ...options, fit: { width: 640, height: 384 }, engineInstance: engine, autostart: true,
  }), (error) => error === started);
  deepEqual(zooms, [10000, 169 / 640, 10000]);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function isStartupAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

test("runtime loads its manifest alongside engine creation before applying a named-texture scene", async (t) => {
  const renderer = fakeRuntimeRenderer();
  const options = {
    ...startupOptions(renderer), dataScene: runtimeDataSceneDocument("hero", 40, 30), profiler: true,
  };
  await rejects(createFerrumRuntime(options), /Texture is not registered/);

  const texture = deferred<void>();
  const textureStarted = deferred<void>();
  const engineStarted = deferred<void>();
  const originalInit = WasmBridge.init.bind(WasmBridge);
  t.mock.method(WasmBridge, "init", async () => {
    engineStarted.resolve();
    return originalInit();
  });
  renderer.loadTexture = async () => {
    textureStarted.resolve();
    await texture.promise;
    return undefined;
  };
  const progress: AssetLoadProgress[] = [];
  const pending = createFerrumRuntime({
    ...options,
    assets: { textures: { hero: "/hero.png" } },
    onAssetProgress: (sample) => progress.push(sample),
  });
  await Promise.all([textureStarted.promise, engineStarted.promise]);
  texture.resolve();
  const runtime = await pending;
  try {
    equal(runtime.dataScene?.state(), "playing");
    equal(runtime.rendererBackend, "custom");
    equal(runtime.assets?.textures.textureId("hero"), runtime.assetHost.textureId("hero"));
    deepEqual(progress.map((sample) => sample.loaded), [0, 1]);
    equal(runtime.profiler?.snapshot().assetSampleCount, 2);
    equal(runtime.profiler?.snapshot().latestAsset?.loaded, 1);
  } finally {
    runtime.destroy();
  }
});

test("an engine finishing after a startup asset failure is freed exactly once", async (t) => {
  const bridge = await WasmBridge.init();
  const free = t.mock.method(bridge.engine(), "free");
  const init = deferred<WasmBridge>();
  t.mock.method(WasmBridge, "init", () => init.promise);
  const failure = new Error("asset unavailable");
  t.mock.method(BrowserPlatformHost.prototype, "loadAssets", async () => { throw failure; });
  await rejects(createFerrumRuntime({
    ...startupOptions(), assets: { textures: { hero: "/hero.png" } },
  }), (error) => error === failure);
  init.resolve(bridge);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  equal(free.mock.callCount(), 1);
});

test("a pre-aborted runtime startup creates no renderer, host or engine", async (t) => {
  const controller = new AbortController();
  controller.abort(new Error("custom reason"));
  const getContext = t.mock.fn();
  const createEngine = t.mock.method(WasmBridge, "init");
  const load = t.mock.method(BrowserPlatformHost.prototype, "loadAssets");
  await rejects(createFerrumRuntime({
    canvas: { getContext } as unknown as HTMLCanvasElement,
    assets: { textures: { hero: "/hero.png" } },
    signal: controller.signal,
  }), isStartupAbort);
  equal(getContext.mock.callCount(), 0);
  equal(createEngine.mock.callCount(), 0);
  equal(load.mock.callCount(), 0);
});

test("abort during startup texture loading destroys the owned host without applying the scene", async (t) => {
  const previousWindow = globalThis.window;
  const windowSurface = new RuntimeInputSurface();
  globalThis.window = windowSurface as unknown as Window & typeof globalThis;
  try {
    const renderer = fakeRuntimeRenderer();
    const resize = t.mock.method(renderer, "resize");
    const destroyRenderer = t.mock.method(renderer, "destroy");
    const load = t.mock.method(BrowserPlatformHost.prototype, "loadAssets");
    const destroyHost = t.mock.method(BrowserPlatformHost.prototype, "destroy");
    const started = deferred<void>();
    renderer.loadTexture = async (_id, _url, options) => new Promise((_, reject) => {
      options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
      started.resolve();
    });
    const controller = new AbortController();
    const calls: string[] = [];
    const engine = fakeEngine(calls);
    const adapter = new RuntimeDataSceneAdapter();
    attachDataSceneRuntimeEngineAdapter(engine, adapter);
    const pending = createFerrumRuntime({
      ...startupOptions(renderer), engineInstance: engine,
      assets: { textures: { hero: "/hero.png" } },
      dataScene: runtimeDataSceneDocument("hero", 40, 30), autostart: true, signal: controller.signal,
    });
    await started.promise;
    windowSurface.dispatchEvent(new Event("resize"));
    equal(resize.mock.callCount(), 1);
    const rejection = rejects(pending, isStartupAbort);
    controller.abort(new Error("custom reason"));
    await rejection;
    windowSurface.dispatchEvent(new Event("resize"));
    equal(resize.mock.callCount(), 1);
    equal(load.mock.calls[0].arguments[2]?.signal, controller.signal);
    equal(destroyHost.mock.callCount(), 1);
    equal(destroyRenderer.mock.callCount(), 0);
    equal(adapter.useDataSceneCalls, 0);
    deepEqual(calls, []);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("the first startup failure releases owned resources and observes a later engine rejection", async (t) => {
  const previousWindow = globalThis.window;
  const windowSurface = new RuntimeInputSurface();
  globalThis.window = windowSurface as unknown as Window & typeof globalThis;
  const unhandled: unknown[] = [];
  const recordUnhandled = (error: unknown) => unhandled.push(error);
  process.on("unhandledRejection", recordUnhandled);
  try {
    const renderer = fakeRuntimeRenderer();
    const resize = t.mock.method(renderer, "resize");
    const asset = deferred<LoadedAssets>();
    const init = deferred<WasmBridge>();
    t.mock.method(WasmBridge, "init", () => init.promise);
    t.mock.method(BrowserPlatformHost.prototype, "loadAssets", () => asset.promise);
    const destroyHost = t.mock.method(BrowserPlatformHost.prototype, "destroy");
    const pending = createFerrumRuntime({
      ...startupOptions(renderer), assets: { textures: { hero: "/hero.png" } },
    });
    const first = new Error("asset failed first");
    const rejection = rejects(pending, (error) => error === first);
    asset.reject(first);
    await rejection;
    init.reject(new Error("engine failed second"));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    windowSurface.dispatchEvent(new Event("resize"));
    equal(resize.mock.callCount(), 1);
    equal(destroyHost.mock.callCount(), 1);
    deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", recordUnhandled);
    globalThis.window = previousWindow;
  }
});

test("startup catches up canvas size and leaves injected assets alive after a late abort", async (t) => {
  const previousWindow = globalThis.window;
  const windowSurface = new RuntimeInputSurface();
  globalThis.window = windowSurface as unknown as Window & typeof globalThis;
  try {
    const renderer = fakeRuntimeRenderer();
    const resize = t.mock.method(renderer, "resize");
    const destroy = t.mock.fn();
    const assetHost = { ...fakeAssetHost([]), destroy };
    const loaded = await assetHost.loadAssets({});
    const asset = deferred<LoadedAssets>();
    const load = t.mock.method(assetHost, "loadAssets", () => asset.promise);
    const canvas = { clientWidth: 640, clientHeight: 360 };
    const controller = new AbortController();
    const calls: string[] = [];
    const pending = createFerrumRuntime({
      ...startupOptions(renderer), canvas: canvas as HTMLCanvasElement, engineInstance: fakeEngine(calls),
      assetHost, assets: {}, signal: controller.signal, assetLoadOptions: { concurrency: 2 }, autostart: true,
    });
    canvas.clientWidth = 800;
    windowSurface.dispatchEvent(new Event("resize"));
    equal(resize.mock.callCount(), 1);
    asset.resolve(loaded);
    const runtime = await pending;
    try {
      deepEqual(load.mock.calls[0].arguments[2], { signal: controller.signal, concurrency: 2 });
      equal(runtime.assetHost, assetHost);
      equal(runtime.assets, loaded);
      equal(resize.mock.callCount(), 2);
      controller.abort();
      windowSurface.dispatchEvent(new Event("resize"));
      equal(resize.mock.callCount(), 3);
      runtime.pause();
    } finally {
      runtime.destroy();
    }
    deepEqual(calls, ["start", "pause"]);
    windowSurface.dispatchEvent(new Event("resize"));
    equal(resize.mock.callCount(), 3);
    equal(destroy.mock.callCount(), 0);
  } finally {
    globalThis.window = previousWindow;
  }
});
