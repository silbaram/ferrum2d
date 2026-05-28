import {
  CameraRigController,
  SPRITE_MATERIAL_PRESETS,
  ScreenFadeTransition,
  buildDebugGizmoLineBuffer,
  buildDebugGizmoLines,
  clampCameraToBounds,
  debugGizmoLinesToBuffer,
  deriveTileOccludersFromTilemapGrid,
  equal,
  fadePostProcessPass,
  normalizeLightingScene,
  resolveCameraRigSpec,
  resolvePostProcessPasses,
  resolveSpriteMaterialPreset,
  spriteMaterialPasses,
  test,
} from "./publicApiTypes.shared.js";

import type {
  BloomPostProcessPassInput,
  CameraBounds,
  CameraDeadZone,
  CameraPoint,
  CameraRigSnapshot,
  CameraRigSpec,
  CameraRigStepOptions,
  CameraViewport,
  CrtPostProcessPassInput,
  DebugGizmoBoundsSpec,
  DebugGizmoCategory,
  DebugGizmoColor,
  DebugGizmoLine,
  DebugGizmoLineBufferResult,
  DebugGizmoOptions,
  DebugGizmoPathSpec,
  DebugGizmoPoint,
  DebugGizmoSceneSpec,
  DebugGizmoSpawnSpec,
  DiagnosticCode,
  DiagnosticContext,
  DiagnosticReport,
  FadePostProcessPassInput,
  GlitchPostProcessPassInput,
  LightingScene2D,
  LightingSceneProvider,
  LightingShadowOptions,
  PointLight2D,
  PostProcessColor,
  PostProcessPassInput,
  PostProcessPassKind,
  PostProcessProvider,
  PostProcessStackInput,
  PostProcessingConfigInput,
  PublicApi,
  ResolveCameraRigOptions,
  ResolvePostProcessOptions,
  ResolvedBloomPostProcessPass,
  ResolvedCameraBounds,
  ResolvedCameraDeadZone,
  ResolvedCameraRigSpec,
  ResolvedCrtPostProcessPass,
  ResolvedDebugGizmoColor,
  ResolvedFadePostProcessPass,
  ResolvedGlitchPostProcessPass,
  ResolvedLightingScene2D,
  ResolvedLightingShadowOptions,
  ResolvedPostProcessColor,
  ResolvedPostProcessPass,
  ResolvedSpriteMaterialColorMix,
  ResolvedSpriteMaterialOutline,
  ResolvedSpriteMaterialPreset,
  ResolvedVignettePostProcessPass,
  ScreenFadeTransitionSnapshot,
  ScreenFadeTransitionSpec,
  ShadowClipRect,
  ShadowProjectionOptions,
  SpriteMaterialBlendMode,
  SpriteMaterialColor,
  SpriteMaterialColorMix,
  SpriteMaterialOutlineDirections,
  SpriteMaterialOutlineOptions,
  SpriteMaterialPass,
  SpriteMaterialPreset,
  SpriteMaterialPresetInput,
  SpriteMaterialPresetName,
  SpriteMaterialProvider,
  TileOccluder2D,
  TileOccluderGridInput,
  VignettePostProcessPassInput,
} from "./publicApiTypes.shared.js";

test("public API sprite material, lighting, camera, post process, and debug gizmo types", () => {
  const spriteMaterialName: SpriteMaterialPresetName = "outline";
  const spriteMaterialColor: SpriteMaterialColor = [1, 1, 1, 1];
  const spriteMaterialColorMix: SpriteMaterialColorMix = {
    color: spriteMaterialColor,
    amount: 0.25,
    preserveAlpha: true,
  };
  const resolvedSpriteMaterialColorMix: ResolvedSpriteMaterialColorMix = {
    color: spriteMaterialColor,
    amount: 0.25,
    preserveAlpha: true,
  };
  const spriteMaterialOutlineDirections: SpriteMaterialOutlineDirections = "cardinal";
  const spriteMaterialOutlineOptions: SpriteMaterialOutlineOptions = {
    color: [0, 0, 0, 0.9],
    thickness: 2,
    directions: spriteMaterialOutlineDirections,
  };
  const resolvedSpriteMaterialOutline: ResolvedSpriteMaterialOutline = {
    color: [0, 0, 0, 0.9],
    thickness: 2,
    directions: "cardinal",
  };
  const spriteMaterialBlendMode: SpriteMaterialBlendMode = "alpha";
  const spriteMaterialPreset: SpriteMaterialPreset = {
    name: "custom",
    blendMode: spriteMaterialBlendMode,
    colorMix: spriteMaterialColorMix,
    outline: spriteMaterialOutlineOptions,
  };
  const spriteMaterialInput: SpriteMaterialPresetInput = spriteMaterialPreset;
  const publicResolveSpriteMaterialPreset: PublicApi["resolveSpriteMaterialPreset"] = resolveSpriteMaterialPreset;
  const publicSpriteMaterialPresets: PublicApi["SPRITE_MATERIAL_PRESETS"] = SPRITE_MATERIAL_PRESETS;
  const publicSpriteMaterialPasses: PublicApi["spriteMaterialPasses"] = spriteMaterialPasses;
  const resolvedSpriteMaterial: ResolvedSpriteMaterialPreset =
    publicResolveSpriteMaterialPreset(spriteMaterialInput);
  const firstSpriteMaterialPass: SpriteMaterialPass | undefined =
    publicSpriteMaterialPasses(publicResolveSpriteMaterialPreset(spriteMaterialName))[0];
  const pointLight: PointLight2D = { x: 24, y: 32, radius: 96, color: [1, 0.9, 0.65], intensity: 1 };
  const tileOccluderGrid: TileOccluderGridInput = { width: 1, height: 1, tileSize: 16, data: [1] };
  const tileOccluder: TileOccluder2D = deriveTileOccludersFromTilemapGrid(tileOccluderGrid)[0];
  const lightingShadows: LightingShadowOptions = { enabled: true, projectionLength: 128 };
  const lightingScene: LightingScene2D = {
    ambient: [0, 0, 0, 0.4],
    pointLights: [pointLight],
    tileOccluders: [tileOccluder],
    shadows: lightingShadows,
    debug: { tileOccluders: true },
  };
  const resolvedLightingScene: ResolvedLightingScene2D = normalizeLightingScene(lightingScene);
  const resolvedLightingShadows: ResolvedLightingShadowOptions = resolvedLightingScene.shadows;
  const shadowClipRect: ShadowClipRect = { x: 0, y: 0, width: 320, height: 180 };
  const shadowProjectionOptions: ShadowProjectionOptions = { clipRect: shadowClipRect };
  const lightingSceneProvider: LightingSceneProvider = (frame) => ({
    ...lightingScene,
    pointLights: [{ ...pointLight, x: frame.mouseX }],
  });
  const cameraPoint: CameraPoint = { x: 10, y: 12 };
  const cameraViewport: CameraViewport = { width: 320, height: 180 };
  const cameraBounds: CameraBounds = { minX: 0, minY: 0, maxX: 640, maxY: 360 };
  const cameraDeadZone: CameraDeadZone = { width: 96, height: 64 };
  const cameraRigSpec: CameraRigSpec = {
    x: cameraPoint.x,
    y: cameraPoint.y,
    bounds: cameraBounds,
    deadZone: cameraDeadZone,
    smoothTimeSeconds: 0.15,
  };
  const cameraRigOptions: ResolveCameraRigOptions = { path: "camera" };
  const publicResolveCameraRigSpec: PublicApi["resolveCameraRigSpec"] = resolveCameraRigSpec;
  const publicClampCameraToBounds: PublicApi["clampCameraToBounds"] = clampCameraToBounds;
  const publicCameraRigController: PublicApi["CameraRigController"] = CameraRigController;
  const resolvedCameraRig: ResolvedCameraRigSpec = publicResolveCameraRigSpec(cameraRigSpec, cameraRigOptions);
  const resolvedCameraBounds: ResolvedCameraBounds = resolvedCameraRig.bounds ?? cameraBounds;
  const resolvedCameraDeadZone: ResolvedCameraDeadZone = resolvedCameraRig.deadZone;
  const cameraRigStepOptions: CameraRigStepOptions = { viewport: cameraViewport };
  const cameraRig = publicCameraRigController.create(cameraRigSpec);
  const cameraRigSnapshot: CameraRigSnapshot = cameraRig.step({ x: 100, y: 80 }, 1 / 60, cameraRigStepOptions);
  const postProcessKind: PostProcessPassKind = "fade";
  const postProcessColor: PostProcessColor = [0, 0, 0, 0.25];
  const fadePassInput: FadePostProcessPassInput = { kind: postProcessKind, color: postProcessColor };
  const bloomPassInput: BloomPostProcessPassInput = { kind: "bloom", threshold: 0.8, intensity: 0.4 };
  const crtPassInput: CrtPostProcessPassInput = { kind: "crt", scanlineIntensity: 0.2 };
  const vignettePassInput: VignettePostProcessPassInput = { kind: "vignette", intensity: 0.25 };
  const glitchPassInput: GlitchPostProcessPassInput = { kind: "glitch", intensity: 0.02 };
  const postProcessConfigInput: PostProcessingConfigInput = { bloom: { intensity: 0.3 }, vignette: { intensity: 0.2 } };
  const postProcessPassInput: PostProcessPassInput = fadePassInput;
  const postProcessStackInput: PostProcessStackInput = [
    postProcessPassInput,
    bloomPassInput,
    crtPassInput,
    vignettePassInput,
    glitchPassInput,
  ];
  const postProcessOptions: ResolvePostProcessOptions = { path: "screen" };
  const publicResolvePostProcessPasses: PublicApi["resolvePostProcessPasses"] = resolvePostProcessPasses;
  const publicFadePostProcessPass: PublicApi["fadePostProcessPass"] = fadePostProcessPass;
  const resolvedPostProcessPasses: readonly ResolvedPostProcessPass[] =
    publicResolvePostProcessPasses(postProcessStackInput, postProcessOptions);
  const resolvedPostProcessPass: ResolvedFadePostProcessPass =
    resolvedPostProcessPasses[0] as ResolvedFadePostProcessPass;
  const resolvedBloomPostProcessPass: ResolvedBloomPostProcessPass =
    publicResolvePostProcessPasses(postProcessConfigInput)[0] as ResolvedBloomPostProcessPass;
  const resolvedCrtPostProcessPass: ResolvedCrtPostProcessPass =
    publicResolvePostProcessPasses(crtPassInput)[0] as ResolvedCrtPostProcessPass;
  const resolvedVignettePostProcessPass: ResolvedVignettePostProcessPass =
    publicResolvePostProcessPasses(vignettePassInput)[0] as ResolvedVignettePostProcessPass;
  const resolvedGlitchPostProcessPass: ResolvedGlitchPostProcessPass =
    publicResolvePostProcessPasses(glitchPassInput)[0] as ResolvedGlitchPostProcessPass;
  const resolvedPostProcessColor: ResolvedPostProcessColor = resolvedPostProcessPass.color;
  equal(resolvedBloomPostProcessPass.kind, "bloom");
  equal(resolvedCrtPostProcessPass.kind, "crt");
  equal(resolvedVignettePostProcessPass.kind, "vignette");
  equal(resolvedGlitchPostProcessPass.kind, "glitch");
  const fadeTransitionSpec: ScreenFadeTransitionSpec = { durationSeconds: 1, fromOpacity: 1, toOpacity: 0 };
  const publicScreenFadeTransition: PublicApi["ScreenFadeTransition"] = ScreenFadeTransition;
  const fadeTransition = publicScreenFadeTransition.create(fadeTransitionSpec);
  const fadeTransitionSnapshot: ScreenFadeTransitionSnapshot = fadeTransition.update(0.5);
  const postProcessProvider: PostProcessProvider = () => fadeTransition.postProcessPasses();
  const spriteMaterialProvider: SpriteMaterialProvider = (frame) => (frame.gameState > 0 ? "flash" : false);
  const publicNormalizeLightingScene: PublicApi["normalizeLightingScene"] = normalizeLightingScene;
  const publicDeriveTileOccludersFromTilemapGrid: PublicApi["deriveTileOccludersFromTilemapGrid"] =
    deriveTileOccludersFromTilemapGrid;
  equal(resolvedSpriteMaterial.name, "custom");
  equal(resolvedSpriteMaterial.colorMix?.amount, resolvedSpriteMaterialColorMix.amount);
  equal(resolvedSpriteMaterial.outline?.thickness, resolvedSpriteMaterialOutline.thickness);
  equal(publicSpriteMaterialPresets.additive.blendMode, "additive");
  equal(firstSpriteMaterialPass?.kind, "outline");
  equal(typeof spriteMaterialProvider, "function");
  const diagnosticCode: DiagnosticCode = "FERRUM_ASSET_LOAD";
  const diagnosticContext: DiagnosticContext = {
    kind: "texture",
    name: "player",
    url: "/assets/player.png",
    detail: "HTTP 404 Not Found",
  };
  const diagnosticReport: DiagnosticReport = {
    code: diagnosticCode,
    message: "Asset load error",
    context: diagnosticContext,
  };
  const debugGizmoCategory: DebugGizmoCategory = "collider";
  const debugGizmoColor: DebugGizmoColor = [1, 0, 0, 0.75];
  const resolvedDebugGizmoColor: ResolvedDebugGizmoColor = [1, 0, 0, 0.75];
  const debugGizmoPoint: DebugGizmoPoint = { x: 0, y: 0 };
  const debugGizmoPath: DebugGizmoPathSpec = {
    id: "route",
    points: [debugGizmoPoint, { x: 8, y: 0 }],
    color: debugGizmoColor,
  };
  const debugGizmoSpawn: DebugGizmoSpawnSpec = { id: "spawn", x: 4, y: 4 };
  const debugGizmoBounds: DebugGizmoBoundsSpec = { id: "hitbox", x: 0, y: 0, width: 8, height: 8 };
  const debugGizmoScene: DebugGizmoSceneSpec = {
    paths: [debugGizmoPath],
    spawns: [debugGizmoSpawn],
    colliders: [debugGizmoBounds],
  };
  const debugGizmoOptions: DebugGizmoOptions = { categories: { [debugGizmoCategory]: true } };
  const publicBuildDebugGizmoLines: PublicApi["buildDebugGizmoLines"] = buildDebugGizmoLines;
  const publicDebugGizmoLinesToBuffer: PublicApi["debugGizmoLinesToBuffer"] = debugGizmoLinesToBuffer;
  const publicBuildDebugGizmoLineBuffer: PublicApi["buildDebugGizmoLineBuffer"] =
    buildDebugGizmoLineBuffer;
  const debugGizmoLines: readonly DebugGizmoLine[] =
    publicBuildDebugGizmoLines(debugGizmoScene, debugGizmoOptions);
  const firstDebugGizmoLine: DebugGizmoLine = debugGizmoLines[0] as DebugGizmoLine;
  const debugGizmoLineBufferResult: DebugGizmoLineBufferResult =
    publicBuildDebugGizmoLineBuffer(debugGizmoScene);
  const debugGizmoLineBuffer = publicDebugGizmoLinesToBuffer(debugGizmoLines);
  equal(publicNormalizeLightingScene(lightingScene).pointLights.length, 1);
  equal(publicDeriveTileOccludersFromTilemapGrid(tileOccluderGrid).length, 1);
  equal(resolvedLightingScene.tileOccluders[0]?.width, 16);
  equal(resolvedLightingShadows.projectionLength, 128);
  equal(shadowProjectionOptions.clipRect?.width, 320);
  equal(resolvedCameraBounds.maxX, 640);
  equal(resolvedCameraDeadZone.width, 96);
  equal(publicClampCameraToBounds(cameraPoint, resolvedCameraBounds, cameraViewport).x, 160);
  equal(cameraRigSnapshot.targetX, 100);
  equal(resolvedPostProcessColor[3], 0.25);
  equal(publicFadePostProcessPass(0.5).color[3], 0.5);
  equal(fadeTransitionSnapshot.opacity, 0.5);
  equal(firstDebugGizmoLine.category, "path");
  equal(resolvedDebugGizmoColor[3], 0.75);
  equal(debugGizmoLineBuffer.lineCount, debugGizmoLines.length);
  equal(debugGizmoLineBufferResult.bufferView.floatsPerLine, 8);
});
