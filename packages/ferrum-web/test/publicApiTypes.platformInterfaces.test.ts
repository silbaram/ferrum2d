import {
  equal,
  test,
} from "./publicApiTypes.shared.js";

import type {
  AssetHost,
  AudioAssetLoader,
  BrowserPlatformHost,
  InputManagerOptions,
  InputProvider,
  Renderer,
  RendererStats,
  UiAction,
  UiDialog,
  UiMeter,
  UiOverlay,
  UiOverlayActionTone,
  UiOverlayRegion,
  UiOverlayState,
  UiOverlayTone,
  UiPanel,
  UiTextLine,
  ViewportProvider,
} from "./publicApiTypes.shared.js";

test("public API platform interface types", () => {
  const inputManagerOptions: InputManagerOptions = {
    gamepad: true,
    gamepadDeadzone: 0.3,
    gamepadMapping: {
      moveXAxis: 0,
      moveYAxis: 1,
      actionButtons: [0, 2],
      menuButtons: [9],
      pointerButtons: [5, 7],
    },
    pointerGestures: true,
    pointerGestureThreshold: 16,
  };
  const uiOverlayTone: UiOverlayTone = "accent";
  const uiOverlayActionTone: UiOverlayActionTone = "primary";
  const uiOverlayRegion: UiOverlayRegion = "top-right";
  const uiMeter: UiMeter = { value: 3, max: 5 };
  const uiTextLine: UiTextLine = {
    id: "hp",
    label: "HP",
    value: "60%",
    tone: uiOverlayTone,
    meter: uiMeter,
  };
  const uiAction: UiAction = {
    id: "pause",
    label: "Pause",
    ariaLabel: "Pause game",
    tone: uiOverlayActionTone,
  };
  const uiPanel: UiPanel = {
    id: "hud",
    title: "HUD",
    region: uiOverlayRegion,
    ariaLive: "polite",
    lines: [uiTextLine],
    actions: [uiAction],
  };
  const uiDialog: UiDialog = {
    id: "pause",
    title: "Paused",
    actions: [uiAction],
  };
  const uiState: UiOverlayState = {
    panels: [uiPanel],
    dialog: uiDialog,
  };
  const uiOverlay: Pick<UiOverlay, "update" | "destroy"> = {
    update: () => undefined,
    destroy: () => undefined,
  };
  const inputProvider: InputProvider = () => ({
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
    enter: false,
    mouseLeft: false,
    mouseX: 0,
    mouseY: 0,
  });
  const viewportProvider: ViewportProvider = () => ({ width: 800, height: 480 });
  const stats: RendererStats = {
    drawCalls: 0,
    batchCount: 0,
    spriteCount: 0,
    renderCommandCount: 0,
    textureBindCount: 0,
    textureSwitchCount: 0,
    physicsDebugLineCount: 0,
    lightingDrawCalls: 0,
    pointLightCount: 0,
    tileOccluderCount: 0,
    shadowDrawCalls: 0,
    shadowCasterCount: 0,
    postProcessDrawCalls: 0,
    postProcessPassCount: 0,
  };
  const renderer: Pick<Renderer, "stats"> = { stats: () => stats };
  const assetHost: Pick<AssetHost, "textureId" | "hasSound"> = { textureId: () => 1, hasSound: () => true };
  const browserPlatformHost: Pick<BrowserPlatformHost, "textureId" | "hasSound" | "destroy"> = {
    textureId: () => 1,
    hasSound: () => true,
    destroy: () => undefined,
  };
  const audioAssetLoader: Pick<AudioAssetLoader, "load"> = {
    load: async () => ({}) as AudioBuffer,
  };
  uiOverlay.update(uiState);
  uiOverlay.destroy();
  equal(inputManagerOptions.pointerGestures, true);
  equal(inputProvider().mouseX, 0);
  equal(viewportProvider().height, 480);
  equal(renderer.stats().drawCalls, 0);
  equal(assetHost.textureId("player"), 1);
  equal(assetHost.hasSound?.(1), true);
  equal(browserPlatformHost.textureId("player"), 1);
  equal(browserPlatformHost.hasSound(1), true);
  equal(typeof audioAssetLoader.load, "function");
});
