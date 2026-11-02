import { deepEqual, equal, throws, rejects } from "node:assert/strict";
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
import type { AssetReleasePayload, LoadedAssets } from "../src/assetLoader.js";
import type { PlayBgmOptions } from "../src/audioManager.js";
import type { DataSceneGameState } from "../src/gameState.js";
import { resolvePixelPerfectOptions, resolvePixelPerfectPresentation, type PixelPerfectPresentation } from "../src/pixelPerfect.js";
import { emptyRendererStats } from "../src/renderer.js";
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
