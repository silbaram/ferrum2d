import {
  ACCESSIBILITY_CONTRAST_PALETTES,
  BREAKOUT_INPUT_ACTION_PROFILE,
  DEFAULT_INPUT_ACTION_PROFILE,
  DEFAULT_VIRTUAL_CONTROL_BUTTONS,
  HUD_THEME_PRESETS,
  INPUT_ACTION_PROFILES,
  PLATFORMER_INPUT_ACTION_PROFILE,
  TOPDOWN_SHOOTER_INPUT_ACTION_PROFILE,
  VirtualControls,
  accessibilitySubtitlePanel,
  applyAccessibilityToCameraRigSpec,
  applyAccessibilityToScreenFadeSpec,
  applyVirtualControlStateToSnapshot,
  createHudOverlayState,
  equal,
  readAccessibilityEnvironment,
  resolveAccessibilityContrastPalette,
  resolveAccessibilityHudTheme,
  resolveAccessibilityOptions,
  resolveHudTheme,
  resolveInputActionState,
  test,
} from "./publicApiTypes.shared.js";

import type {
  AccessibilityContrastColorRole,
  AccessibilityContrastPaletteName,
  AccessibilityContrastPaletteSpec,
  AccessibilityEnvironment,
  AccessibilityInputAssistSpec,
  AccessibilityMediaQueryListLike,
  AccessibilityMediaQuerySource,
  AccessibilityOptionsSpec,
  AccessibilityReducedMotionPreference,
  AccessibilitySubtitlePanelOptions,
  AccessibilitySubtitleSpec,
  CameraRigSpec,
  CreateHudOverlayStateOptions,
  FerrumRuntimeEnvironment,
  GamepadInputMapping,
  HudComponentBase,
  HudComponentSpec,
  HudCounterSpec,
  HudMessageSpec,
  HudMeterSpec,
  HudPromptSpec,
  HudThemeInput,
  HudThemePresetName,
  HudThemeTokens,
  InputActionBinding,
  InputActionProfile,
  InputActionProfileId,
  InputActionState,
  InputAxisBinding,
  InputDigitalControl,
  InputManagerOptions,
  PublicApi,
  ResolveAccessibilityOptionsOptions,
  ResolvedAccessibilityContrastPalette,
  ResolvedAccessibilityInputAssist,
  ResolvedAccessibilityOptions,
  ResolvedHudThemeTokens,
  ScreenFadeTransitionSpec,
  UiAction,
  UiDialog,
  UiMeter,
  UiOverlayActionEvent,
  UiOverlayActionTone,
  UiOverlayOptions,
  UiOverlayRegion,
  UiOverlayState,
  UiOverlayStateProvider,
  UiOverlayTone,
  UiPanel,
  UiTextLine,
  VirtualButtonOptions,
  VirtualControlsOptions,
  VirtualControlsState,
  VirtualJoystickOptions,
} from "./publicApiTypes.shared.js";

test("public API input, virtual controls, HUD, accessibility, and UI types", () => {
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
  const gamepadMapping: GamepadInputMapping = inputManagerOptions.gamepadMapping ?? {};
  const inputDigitalControl: InputDigitalControl = "space";
  const inputActionBinding: InputActionBinding = { control: inputDigitalControl };
  const inputAxisBinding: InputAxisBinding = { negative: "left", positive: "right" };
  const inputActionProfile: InputActionProfile = {
    actions: {
      left: [{ control: "a" }],
      right: [{ control: "d" }],
      fire: [inputActionBinding, { virtualButton: "fire" }],
    },
    axes: {
      horizontal: inputAxisBinding,
    },
  };
  const publicResolveInputActionState: PublicApi["resolveInputActionState"] = resolveInputActionState;
  const publicDefaultInputActionProfile: PublicApi["DEFAULT_INPUT_ACTION_PROFILE"] = DEFAULT_INPUT_ACTION_PROFILE;
  const publicTopdownInputActionProfile: PublicApi["TOPDOWN_SHOOTER_INPUT_ACTION_PROFILE"] =
    TOPDOWN_SHOOTER_INPUT_ACTION_PROFILE;
  const publicPlatformerInputActionProfile: PublicApi["PLATFORMER_INPUT_ACTION_PROFILE"] =
    PLATFORMER_INPUT_ACTION_PROFILE;
  const publicBreakoutInputActionProfile: PublicApi["BREAKOUT_INPUT_ACTION_PROFILE"] =
    BREAKOUT_INPUT_ACTION_PROFILE;
  const publicInputActionProfiles: PublicApi["INPUT_ACTION_PROFILES"] = INPUT_ACTION_PROFILES;
  const inputActionProfileId: InputActionProfileId = "topdownShooter";
  const virtualJoystickOptions: VirtualJoystickOptions = { deadzone: 0.25, maxDistance: 48 };
  const virtualButtonOptions: VirtualButtonOptions = { id: "fire", label: "Fire", controls: ["space"], virtualButton: "fire" };
  const virtualControlsOptions: VirtualControlsOptions = {
    joystick: virtualJoystickOptions,
    buttons: [virtualButtonOptions],
  };
  const virtualControlsState: VirtualControlsState = {
    w: false,
    a: false,
    s: false,
    d: true,
    buttons: { fire: true },
    virtualButtons: { fire: true },
  };
  const publicVirtualControls: PublicApi["VirtualControls"] = VirtualControls;
  const publicDefaultVirtualControlButtons: PublicApi["DEFAULT_VIRTUAL_CONTROL_BUTTONS"] =
    DEFAULT_VIRTUAL_CONTROL_BUTTONS;
  const publicApplyVirtualControlStateToSnapshot: PublicApi["applyVirtualControlStateToSnapshot"] =
    applyVirtualControlStateToSnapshot;
  const inputActionState: InputActionState = publicResolveInputActionState(
    {
      w: false,
      a: false,
      s: false,
      d: true,
      space: false,
      enter: false,
      mouseLeft: false,
      mouseX: 0,
      mouseY: 0,
    },
    inputActionProfile,
    { virtualButtons: { fire: true } },
  );
  const virtualInputSnapshot = publicApplyVirtualControlStateToSnapshot({
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
    enter: false,
    mouseLeft: false,
    mouseX: 0,
    mouseY: 0,
  }, virtualControlsState, [virtualButtonOptions]);
  const hudThemeName: HudThemePresetName = "high-contrast";
  const hudThemeInput: HudThemeInput = { textColor: "#ffffff" };
  const hudThemeTokens: HudThemeTokens = {
    ...HUD_THEME_PRESETS.dark,
    textColor: "#ffffff",
  };
  const publicHudThemePresets: PublicApi["HUD_THEME_PRESETS"] = HUD_THEME_PRESETS;
  const publicResolveHudTheme: PublicApi["resolveHudTheme"] = resolveHudTheme;
  const publicCreateHudOverlayState: PublicApi["createHudOverlayState"] = createHudOverlayState;
  const resolvedHudTheme: ResolvedHudThemeTokens = publicResolveHudTheme(hudThemeInput);
  const accessibilityReducedMotion: AccessibilityReducedMotionPreference = "system";
  const accessibilityPaletteName: AccessibilityContrastPaletteName = "deuteranopia";
  const accessibilityColorRole: AccessibilityContrastColorRole = "focus";
  const accessibilityInputAssist: AccessibilityInputAssistSpec = { holdToToggleActions: ["fire"] };
  const accessibilityPaletteSpec: AccessibilityContrastPaletteSpec = {
    id: "custom",
    colors: { [accessibilityColorRole]: "#ffffff" },
  };
  const accessibilitySpec: AccessibilityOptionsSpec = {
    reducedMotion: accessibilityReducedMotion,
    subtitles: true,
    contrastPalette: accessibilityPaletteName,
    inputAssist: accessibilityInputAssist,
  };
  const accessibilityEnvironment: AccessibilityEnvironment = { prefersReducedMotion: true };
  const accessibilityMediaQueryList: AccessibilityMediaQueryListLike = { matches: true };
  const accessibilityMediaQuerySource: AccessibilityMediaQuerySource = {
    matchMedia: () => accessibilityMediaQueryList,
  };
  const resolveAccessibilityOptionsOptions: ResolveAccessibilityOptionsOptions = {
    environment: accessibilityEnvironment,
  };
  const accessibilitySubtitleSpec: AccessibilitySubtitleSpec = {
    speaker: "Guide",
    text: "Move carefully.",
  };
  const accessibilitySubtitleOptions: AccessibilitySubtitlePanelOptions = {
    accessibility: accessibilitySpec,
  };
  const publicAccessibilityPalettes: PublicApi["ACCESSIBILITY_CONTRAST_PALETTES"] =
    ACCESSIBILITY_CONTRAST_PALETTES;
  const publicReadAccessibilityEnvironment: PublicApi["readAccessibilityEnvironment"] =
    readAccessibilityEnvironment;
  const publicResolveAccessibilityOptions: PublicApi["resolveAccessibilityOptions"] =
    resolveAccessibilityOptions;
  const publicResolveAccessibilityContrastPalette: PublicApi["resolveAccessibilityContrastPalette"] =
    resolveAccessibilityContrastPalette;
  const publicResolveAccessibilityHudTheme: PublicApi["resolveAccessibilityHudTheme"] =
    resolveAccessibilityHudTheme;
  const publicApplyAccessibilityToCameraRigSpec: PublicApi["applyAccessibilityToCameraRigSpec"] =
    applyAccessibilityToCameraRigSpec;
  const publicApplyAccessibilityToScreenFadeSpec: PublicApi["applyAccessibilityToScreenFadeSpec"] =
    applyAccessibilityToScreenFadeSpec;
  const publicAccessibilitySubtitlePanel: PublicApi["accessibilitySubtitlePanel"] =
    accessibilitySubtitlePanel;
  const resolvedAccessibilityOptions: ResolvedAccessibilityOptions =
    publicResolveAccessibilityOptions(accessibilitySpec, resolveAccessibilityOptionsOptions);
  const resolvedAccessibilityPalette: ResolvedAccessibilityContrastPalette =
    publicResolveAccessibilityContrastPalette(accessibilityPaletteSpec);
  const resolvedAccessibilityInputAssist: ResolvedAccessibilityInputAssist =
    resolvedAccessibilityOptions.inputAssist;
  const accessibilityHudTheme: ResolvedHudThemeTokens =
    publicResolveAccessibilityHudTheme(resolvedAccessibilityOptions);
  const accessibilityCameraSpec: CameraRigSpec =
    publicApplyAccessibilityToCameraRigSpec({ smoothTimeSeconds: 0.2 }, resolvedAccessibilityOptions);
  const accessibilityFadeSpec: ScreenFadeTransitionSpec =
    publicApplyAccessibilityToScreenFadeSpec({ durationSeconds: 0.8 }, resolvedAccessibilityOptions);
  const accessibilitySubtitlePanelState: UiPanel | undefined =
    publicAccessibilitySubtitlePanel(accessibilitySubtitleSpec, accessibilitySubtitleOptions);
  const detectedAccessibilityEnvironment: AccessibilityEnvironment =
    publicReadAccessibilityEnvironment(accessibilityMediaQuerySource);
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
  const hudComponentBase: HudComponentBase = { id: "hp", label: "HP" };
  const hudMeterSpec: HudMeterSpec = { ...hudComponentBase, type: "meter", value: 3, max: 5 };
  const hudCounterSpec: HudCounterSpec = { id: "score", type: "counter", value: 12 };
  const hudPromptSpec: HudPromptSpec = { id: "start", type: "prompt", text: "Press Start", action: uiAction };
  const hudMessageSpec: HudMessageSpec = { id: "hint", type: "message", text: "Ready" };
  const hudComponentSpec: HudComponentSpec = hudMeterSpec;
  const createHudOptions: CreateHudOverlayStateOptions = {
    panelId: "game-hud",
    title: "Stats",
    region: uiOverlayRegion,
  };
  const hudOverlayState: UiOverlayState =
    publicCreateHudOverlayState([hudMeterSpec, hudCounterSpec, hudPromptSpec, hudMessageSpec], createHudOptions);
  const uiOptions: UiOverlayOptions = {
    theme: hudThemeName,
    onAction: (event: UiOverlayActionEvent) => {
      equal(event.id.length > 0, true);
    },
  };
  const uiState: UiOverlayState = {
    panels: [uiPanel],
    dialog: uiDialog,
  };
  const uiStateProvider: UiOverlayStateProvider = () => uiState;
  const runtimeEnvironment: FerrumRuntimeEnvironment = "production";
  equal(publicHudThemePresets[hudThemeName].panelBorder, "#ffffff");
  equal(resolvedHudTheme.textColor, "#ffffff");
  equal(hudThemeTokens.textColor, "#ffffff");
  equal(publicAccessibilityPalettes["high-contrast"].colors.text, "#ffffff");
  equal(resolvedAccessibilityOptions.reducedMotion, true);
  equal(resolvedAccessibilityPalette.id, "custom");
  equal(resolvedAccessibilityInputAssist.holdToToggleActions[0], "fire");
  equal(accessibilityHudTheme.primaryButtonBackground, "#0072b2");
  equal(accessibilityCameraSpec.smoothTimeSeconds, 0);
  equal(accessibilityFadeSpec.durationSeconds, 0);
  equal(accessibilitySubtitlePanelState?.lines?.[1]?.text, "Move carefully.");
  equal(detectedAccessibilityEnvironment.prefersReducedMotion, true);
  equal(hudOverlayState.panels?.[0].id, "game-hud");
  equal(hudOverlayState.panels?.[0].lines?.[0].meter?.max, 5);
  equal(hudOverlayState.panels?.[0].actions?.[0].id, "pause");
  equal(hudComponentSpec.type, "meter");
  equal(uiPanel.ariaLive, "polite");
  equal(uiDialog.title, "Paused");
  equal(uiOptions.theme, hudThemeName);
  equal(gamepadMapping.actionButtons?.[1], 2);
  equal(publicDefaultInputActionProfile.axes?.moveX.positive, "moveRight");
  equal(publicTopdownInputActionProfile.actions.fire[0]?.control, "space");
  equal(publicPlatformerInputActionProfile.axes?.moveX.positive, "moveRight");
  equal(publicBreakoutInputActionProfile.axes?.paddleX.negative, "moveLeft");
  equal(publicInputActionProfiles[inputActionProfileId].actions.primary[0]?.control, "space");
  equal(inputActionState.actions.fire, true);
  equal(inputActionState.axes.horizontal, 1);
  equal(virtualControlsOptions.joystick, virtualJoystickOptions);
  equal(publicDefaultVirtualControlButtons[0]?.id, "primary");
  equal(virtualInputSnapshot.d, true);
  equal(virtualInputSnapshot.space, true);
  equal(typeof publicVirtualControls, "function");
});
