export { createEngine } from "./createEngine";
export { createRenderer } from "./createRenderer";
export type {
  AssetHost,
  AudioBusConfig,
  CreateEngineOptions,
  EngineLifecycleHooks,
  EngineLifecycleSnapshot,
  FerrumEngine,
  FrameHandler,
  FrameState,
  InputProvider,
  ShooterSoundIds,
  ShooterTextureIds,
  ViewportSnapshot,
  ViewportProvider,
} from "./createEngine";
export { applyShooterGameSpec, resolveShooterGameSpec } from "./gameSpec";
export { FerrumDiagnosticError, diagnosticReport, formatDiagnosticReport, isFerrumDiagnosticError } from "./diagnostics";
export type { DiagnosticCode, DiagnosticContext, DiagnosticKind, DiagnosticReport } from "./diagnostics";
export type {
  ApplyShooterGameSpecOptions,
  ResolvedShooterAtlasFrame,
  ResolvedShooterGameSpec,
  ResolvedShooterWave,
  ShooterAudioEventPolicySpec,
  ShooterAudioSpec,
  ShooterAtlasFrameSpec,
  ShooterAtlasSpec,
  ShooterCameraPreset,
  ShooterCameraSpec,
  ShooterEnemyBehaviorPreset,
  ShooterEnemyOrbitSpec,
  ShooterEnemyPresetSpec,
  ShooterGameSpec,
  ShooterGameSpecTarget,
  ShooterPrefabSpec,
  ShooterTileLayerSpec,
  ShooterTilemapSpec,
  ShooterTileSpec,
  ResolvedShooterTileDefinition,
  ResolvedShooterTileLayer,
  ResolvedShooterTilemap,
  ShooterWaveSpec,
} from "./gameSpec";
export type { Renderer, RendererStats } from "./renderer";
export type { CreateRendererOptions, RendererFallbackInfo } from "./createRenderer";
export { WebGL2Renderer } from "./webgl2Renderer";
export { BrowserPlatformHost } from "./browserPlatformHost";
export { WebGPURenderer } from "./webgpuRenderer";
export { TextureManager } from "./textureManager";
export { AudioManager } from "./audioManager";
export type { AudioManagerConfig } from "./audioManager";
export { AudioAssetLoader } from "./audioAssetLoader";
export { AssetLoader } from "./assetLoader";
export { DebugOverlay } from "./debugOverlay";
export { TextureRegistry } from "./textureRegistry";
export { SoundRegistry } from "./soundRegistry";
export { SpriteBatch } from "./spriteBatch";
export { InputManager } from "./inputManager";
export { generateTextureAtlasLayout } from "./textureAtlas";
export type { InputSnapshot } from "./inputManager";
export type { SpriteDrawOptions } from "./spriteBatch";
export type { AtlasSpriteInput, AtlasSpritePlacement, TextureAtlasLayout, TextureAtlasOptions } from "./textureAtlas";
export type {
  AssetLoadProgress,
  AssetLoadProgressCallback,
  AssetManifest,
  LoadedAssets,
  SoundAssetManager,
  TextureAssetManager,
} from "./assetLoader";
export type { TextureRegistryEntry } from "./textureRegistry";
export type { SoundRegistryEntry } from "./soundRegistry";
export type { DebugOverlayMetrics, DebugOverlayOptions } from "./debugOverlay";
export type { AudioEventBufferView, AudioEventView, RenderCommandBufferView, RenderCommandView } from "./wasmBridge";
export { decodeRenderCommands } from "./wasmBridge";
