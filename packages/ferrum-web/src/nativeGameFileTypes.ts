import type { AssetHost, FerrumEngine, FrameHandler, FrameState, InputProvider, ViewportProvider, EngineLifecycleHooks, EffectEventRuntimeOptions } from "./engineTypes.js";
import type { RenderCommandBufferView, PhysicsDebugLineBufferView } from "./wasmBridge.js";
import type { ResolvedPhysicsSpec } from "./physicsSpec.js";
import type { SceneInstanceHandleRegistry } from "./sceneInstanceHandles.js";
import type { GameplayEntityHandle } from "./gameplayAuthoringTypes.js";
import type { DialogueSession, QuestLog } from "./dialogueQuest.js";
import type { ResolvedWebFontPolicy, FontFaceSetLike } from "./localization.js";

export type NativeGameFileErrorCode = "LIMITS" | "LIMIT" | "DATA" | "STALE" | "BUSY" | "CAPABILITY" | "ALLOCATION" | "GPU" | "IO" | "NATIVE";
export type NativeGameFilePhase = "create" | "capture" | "prepare" | "commit" | "discard" | "dispose" | "binding";
/** Every public operation preserves its original rejection in cause. */
export class NativeGameFileError extends Error {
  constructor(readonly code: NativeGameFileErrorCode, readonly phase: NativeGameFilePhase, readonly cause: unknown) {
    super(`Native game file ${phase} rejected (${code})`); this.name = "NativeGameFileError";
  }
}
/** Logical JavaScript/SDK quotas; these are not actual heap/driver/RSS limits. */
export interface NativeGameFileResourceLimits {
  readonly maxResources: number; readonly maxWork: number; readonly maxMetadataBytes: number;
  readonly maxSourceBytes: number; readonly maxDecodedBytes: number; readonly maxGpuBytes: number;
}
export interface NativeGameFileUsage {
  readonly resources: number; readonly work: number; readonly metadataBytes: number;
  readonly sourceBytes: number; readonly decodedBytes: number; readonly gpuBytes: number;
}
export interface NativeGameFileBudget {
  work(amount: number): void;
  metadata(value: string): void;
  charge(kind: keyof NativeGameFileUsage, amount: number): void;
  bytes(value: Uint8Array, kind: "sourceBytes" | "decodedBytes", expectedBytes?: number): Uint8Array<ArrayBuffer>;
  floats(value: Float32Array, expectedLength?: number): Float32Array<ArrayBuffer>;
  usage(): NativeGameFileUsage;
  remaining(): NativeGameFileResourceLimits;
  fail(code: Exclude<NativeGameFileErrorCode, "IO" | "NATIVE">, field: string): never;
}
/** Named lower-only native quotas. Schema version/word buffers are internal. */
export interface NativeGameFileNativeLimits {
  readonly maxFileBytes: number; readonly maxChecksumBytes: number;
  readonly maxEngineSectionBytes: number; readonly maxVariablesSectionBytes: number;
  readonly maxAuthoringSectionBytes: number; readonly maxResourceManifestSectionBytes: number;
  readonly maxResourceDataSectionBytes: number; readonly maxDialogueQuestSectionBytes: number;
  readonly maxHostBindingsSectionBytes: number; readonly maxDecodeInputBytes: number;
  readonly maxDecodeAllocationWork: number; readonly maxDecodeValues: number;
  readonly maxDecodeDepth: number; readonly maxDecodeCollection: number;
  readonly maxDecodeZeroSizedElements: number; readonly maxChecksumWork: number;
  readonly maxAllocationWork: number; readonly maxPostDecodeWork: number;
  readonly maxPostDecodeScratchBytes: number; readonly maxEntitySlots: number;
  readonly maxJointSlots: number; readonly maxNestedItems: number;
  readonly maxAliasRoots: number; readonly maxAliasCompareBytes: number;
  readonly maxOutputBytes: number; readonly maxMetadataBytes: number;
}
/** Render-only views contain data, never a bridge/native Engine. Copy views
 * before retaining them across a frame or any Wasm memory growth. */
export interface NativeGameFileRenderFrame {
  readonly renderCommandBuffer: RenderCommandBufferView;
  readonly physicsDebugLineBuffer?: PhysicsDebugLineBufferView;
  readonly cameraX: number; readonly cameraY: number; readonly frameState?: FrameState;
}
export interface NativeGameFileCallbacks {
  readonly "frame.onFrame"?: FrameHandler;
  readonly "frame.onRenderFrame"?: (frame: NativeGameFileRenderFrame) => void;
  readonly "frame.inputProvider"?: InputProvider;
  readonly "frame.viewportProvider"?: ViewportProvider;
  readonly "options.lifecycle.onStart"?: NonNullable<EngineLifecycleHooks["onStart"]>;
  readonly "options.lifecycle.onPause"?: NonNullable<EngineLifecycleHooks["onPause"]>;
  readonly "options.lifecycle.onResume"?: NonNullable<EngineLifecycleHooks["onResume"]>;
  readonly "options.lifecycle.onStop"?: NonNullable<EngineLifecycleHooks["onStop"]>;
  readonly "options.lifecycle.onDestroy"?: NonNullable<EngineLifecycleHooks["onDestroy"]>;
  readonly "options.effectEvents.hasSoundEffect"?: NonNullable<EffectEventRuntimeOptions["hasSoundEffect"]>;
  readonly "options.effectEvents.hasParticlePreset"?: NonNullable<EffectEventRuntimeOptions["hasParticlePreset"]>;
  readonly "options.effectEvents.target"?: NonNullable<EffectEventRuntimeOptions["target"]>;
  readonly "options.effectEvents.shakeCameraEffect"?: NonNullable<EffectEventRuntimeOptions["shakeCameraEffect"]>;
  readonly "options.effectEvents.applyCustomEffect"?: NonNullable<EffectEventRuntimeOptions["applyCustomEffect"]>;
  readonly "options.effectEvents.onDispatchSummary"?: NonNullable<EffectEventRuntimeOptions["onDispatchSummary"]>;
}
export type NativeGameFileRuntimeRole = keyof NativeGameFileCallbacks;
export type NativeGameFileData = undefined | null | boolean | number | string | readonly NativeGameFileData[] | { readonly [key: string]: NativeGameFileData };
export type NativeGameFileReadonly<T> = T extends object ? { readonly [K in keyof T]: NativeGameFileReadonly<T[K]> } : T;
export interface NativeGameFileHostMetadata {
  readonly initialPhysicsSpec: NativeGameFileReadonly<ResolvedPhysicsSpec>;
  readonly physicsSpec: NativeGameFileReadonly<ResolvedPhysicsSpec>;
  readonly physicsSpecScene?: number; readonly particlePresetIds: readonly number[];
  readonly lastViewportWidth?: number; readonly lastViewportHeight?: number; readonly viewportDirty?: boolean;
}
export interface NativeGameFilePlatformContext {
  readonly requiredRoles: readonly NativeGameFileRuntimeRole[];
  readonly metadata: NativeGameFileHostMetadata;
  /** Callback slots are null markers. Never cast/merge into creation options. */
  readonly creationData: Readonly<Record<string, NativeGameFileData>>;
  readonly frameData: Readonly<Record<string, NativeGameFileData>>;
  readonly budget: NativeGameFileBudget;
}
export interface NativeGameFilePlatform {
  readonly assetHost?: AssetHost;
  /** Explicit adapters for every required role. Nothing is automatically copied
   * from the old renderer. A stateless function may be explicitly reused. */
  readonly callbacks?: NativeGameFileCallbacks;
  /** Before resource preparation: register target external font/host bindings. */
  configure?(engine: FerrumEngine, budget: NativeGameFileBudget): void | Promise<void>;
  /** After resource adoption, before publication: read/validate restored app data.
   * Do not reapply specs, reset the saved native state, or start its loop. */
  validate?(engine: FerrumEngine, budget: NativeGameFileBudget): void;
  assertCurrent?(): void;
  /** Dispose only the newly created host/renderer/input/observers. The session
   * destroys its own new Engine. Never dispose a borrowed old platform here. */
  dispose(): void | Promise<void>;
}
export interface NativeGameFileSessionOptions {
  /** Trusted deployed bytes or URL. Default is the package's deployed Wasm URL. */
  readonly wasm?: Uint8Array | URL;
  readonly registry?: SceneInstanceHandleRegistry;
  readonly nativeLimits?: Partial<NativeGameFileNativeLimits>;
  readonly resourceLimits?: Partial<NativeGameFileResourceLimits>;
  /** Target Wasm linear-memory pages (64KiB), not total JS/GPU/RSS. */
  readonly maximumMemoryPages?: number;
  readonly preparePlatform?: (context: NativeGameFilePlatformContext) => NativeGameFilePlatform | Promise<NativeGameFilePlatform>;
  /** Initial scope is borrowed. Explicitly destroy its Engine/platform here if
   * ownership is transferred; this runs only after successful publication. */
  readonly initialCleanup?: () => void | Promise<void>;
}
declare const readyBrand: unique symbol;
export interface NativeGameFileReady { readonly [readyBrand]: true }
export interface NativeGameFileCommit {
  readonly epoch: number;
  readonly audio?: { readonly started: number; readonly contextState: string; readonly waitingForGesture: boolean };
  readonly cleanupErrors: readonly unknown[];
}
export interface NativeGameFileDialogueQuestGraph {
  readonly quests: readonly QuestLog[]; readonly dialogues: readonly DialogueSession[];
  readonly bindings: readonly { readonly kind: "quest" | "dialogue"; readonly symbol: string; readonly value: QuestLog | DialogueSession }[];
}
export interface NativeGameFileFontSelection {
  readonly faces: readonly { readonly identity: object; readonly face?: FontFace; readonly descriptors?: Readonly<Record<string,string>>; readonly source?: { readonly blob: Blob; readonly url: string } }[];
  readonly bindings: readonly { readonly policyId: string; readonly faces: readonly number[] }[];
}
export interface NativeGameFileExternalFonts {
  readonly reference: { readonly kind: string; readonly version: number; readonly symbol: string };
  readonly originRevision: number | string;
  readonly faces: readonly { readonly reference?: { readonly kind: string; readonly version: number; readonly symbol: string }; readonly descriptors: Readonly<Record<string,string>>; readonly source: { readonly mime: string; readonly url: string; readonly bytes: Uint8Array<ArrayBuffer> } }[];
  readonly bindings: readonly { readonly policyId: string; readonly faces: readonly number[] }[];
}
export interface NativeGameFileFontSetAdapter {
  readonly fontSet: FontFaceSetLike;
  readRevision(): number | string;
  captureCurrent(policies: readonly ResolvedWebFontPolicy[], budget: NativeGameFileBudget): Promise<NativeGameFileFontSelection>;
  acceptFile(data: NativeGameFileExternalFonts, budget: NativeGameFileBudget): void | Promise<void>;
}
export interface NativeGameFileFontFaceAdapter {
  readonly face: FontFace; readonly source: { readonly blob: Blob; readonly url: string };
  readRevision(): number | string;
}
export interface NativeGameFileSession {
  current(): FerrumEngine; epoch(): number; registry(): SceneInstanceHandleRegistry | undefined;
  dialogueQuest(): NativeGameFileDialogueQuestGraph | undefined;
  capture(): Promise<Uint8Array>;
  prepare(file: Uint8Array | Blob): Promise<NativeGameFileReady>;
  commit(ready: NativeGameFileReady): Promise<NativeGameFileCommit>;
  discard(ready: NativeGameFileReady): Promise<void>;
  dispose(): Promise<void>;
  registerQuest(symbol: string, value: QuestLog): void;
  registerDialogue(symbol: string, value: DialogueSession): void;
  bindTextureResolver(symbol: string, identity: (name: string) => number, adapter?: (name: string) => number): void;
  bindEntityExists(symbol: string, identity: (handle: GameplayEntityHandle) => boolean, adapter?: (handle: GameplayEntityHandle) => boolean): void;
  /** Font owner remains the actual Engine key, separately from general callback
   * bindings. Pass the configure hook's target Engine when preparing a new host. */
  bindFontFace(symbol: string, adapter: NativeGameFileFontFaceAdapter, engine?: FerrumEngine): void;
  bindFontSet(symbol: string, adapter: NativeGameFileFontSetAdapter, engine?: FerrumEngine): void;
}
