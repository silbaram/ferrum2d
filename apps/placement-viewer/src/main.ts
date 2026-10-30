import type { UiContent } from "./placementLocale";
import {
  installPlacementLanguage,
  registerUiRoot,
  setUiAttribute,
  setUiText,
  translateUi,
  uiContent,
  uiMessage,
  uiText,
} from "./placementLocale";
import { bindUiControl } from "./placementLocaleControls";

import { createPlacementGrid } from "./placementGrid";
import {
  configureVillageActor,
  ensureVillageAssets,
  isVillageScene,
  villageAtlasFrames,
  villageModelUrl,
  villageTextures,
  villageTextureMetadata,
} from "./placementVillage";
import { PlacementGridRenderer } from "./placementGridRenderer";
import { ensureGardenAssets, isGardenScene, gardenTextures, gardenAtlasFrames, gardenTextureMetadata, configureGardenActor, createGardenPreview } from "./placementGarden";
import {
  createDesktopTileProjectHost,
  createPlacementTileAssets,
  readPlacementTileProject,
} from "./placementTileProject";
import { tileProviderAsset } from "./placementTileAssets";
import { createPlacementTileTool } from "./placementTileTool";
import type { tileEvidence } from "./placementTileAssets";
import { createPlacementViewportToolbar } from "./placementViewportToolbar";
import { createPlacementDocumentTabs } from "./placementDocumentTabs";
import { installPlacementWorkspaceLayout } from "./placementWorkspaceLayout";
import { installPlacementWorkspaceChrome } from "./placementWorkspaceChrome";
import { createPlacementUpdates } from "./placementUpdates";
import { createPlacementLighting } from "./placementLighting";
import { createPlacementPanelTabs } from "./placementPanelTabs";
import { createPlacementBottomDock } from "./placementBottomDock";
import { createPlacementAssetLoading } from "./placementAssetLoading";
import { createPlacementPerformance } from "./placementPerformance";
import { createPlacementSceneNavigator } from "./placementSceneNavigator";
import { createPlacementSceneExplorer } from "./placementSceneExplorer";
import { canUsePlacementAsset } from "./placementAssetScope";
import { folderSceneCatalog, hostedSceneCatalog, safeSceneRelativePath, fetchSceneJson, readSceneScanDiagnostics, type PlacementSceneCatalog, type PlacementSceneEntry } from "./placementSceneCatalog";
import { createPlacementLayers, type PlacementLayerAction } from "./placementLayers";
import { placementRenderLayer, placementSoloPolicy, type PlacementLayerViewState } from "./placementLayerState";
import { installPlacementDocumentSession } from "./placementDocumentSession";
import {
  installPlacementViewportNavigation,
  type PlacementEditCamera,
} from "./placementViewportNavigation";
import {
  hasLockedSelection,
  installPlacementSelectionTools,
  movePlacementSelectionTo,
  togglePlacementSelection,
} from "./placementSelection";
import {
  installPlacementTransformGizmo,
  transformPlacementSelection,
} from "./placementTransformGizmo";
import { installPlacementSpatialWorkspace } from "./placementSpatialWorkspace";
import { installPlacementDiagnostics } from "./placementDiagnostics";
import { createPlacementPreviewSession } from "./placementPreviewSession";
import { createPlacementNormalTool } from "./placementNormalTool";
import {
  createPlacementAsepriteTool,
  type PlacementAsepriteImportEvidence,
} from "./placementAsepriteTool";
import {
  createPlacementAsepriteAssets,
  asepriteProviderAsset,
} from "./placementAsepriteAssets";
import {
  createDesktopAsepriteProjectHost,
  readPlacementAsepriteProject,
} from "./placementAsepriteProject";
import type { PlacementNormalAssetHost } from "./placementNormalAssets";
import {
  createDesktopNormalProjectHost,
  createPlacementNormalProjectAssets,
} from "./placementNormalProject";
import {
  createPlacementAssetBrowser,
  type PlacementBrowserAsset,
} from "./placementAssetBrowser";
import {
  createPlacementAssetChanges,
  type PlacementAssetRevision,
} from "./placementAssetChanges";
import {
  createFerrumRuntime,
  loadSpatialGlb,
  type SpatialModelAsset,
  type FerrumRuntime,
  type FerrumRuntimeFrame,
} from "@ferrum2d/ferrum-web/core";
import { diagnosticReport } from "@ferrum2d/ferrum-web/quality";
import {
  FERRUM_AUTHORING_VIEWER_TITLE,
  appendAuthoringViewerCheckboxControl,
  appendAuthoringViewerKeyValueRow as appendRawRow,
  appendAuthoringViewerNumberControl,
  appendAuthoringViewerSelectControl,
  appendAuthoringViewerTextControl,
  appendAuthoringViewerTextareaControl,
  createAuthoringViewerAppChrome,
  createAuthoringViewerDisclosureSection,
  formatAuthoringViewerNumber as formatNumber,
  formatAuthoringViewerBehaviorProfiles,
  readAuthoringViewerNumberInput as numberInputValue,
  setAuthoringViewerNumberInputValue as setNumberInputValue,
} from "@ferrum2d/authoring-viewer";
import {
  DATA_SCENE_MAX_CONVEX_POLYGON_VERTICES,
  DATA_SCENE_PRIMITIVE_TEXTURES,
  applySceneBehaviorRecipes,
  applyDataSceneAuthoringDocument,
  createDataSceneRuntimeTarget,
  createScenePlacementAgentHandoff,
  createScenePlacementAssetProvider,
  createScenePlacementAssetProviderFromProjectAssets,
  createSceneInstanceHandleRegistry,
  createScenePlacementViewer,
  dataSceneObjectVisualBounds,
  previewScenePlacementBindingMigration,
  resolveDataSceneInstanceComponents,
  resolveSceneAuthoringDocument,
  saveScenePlacementPatch,
  mergeScenePlacementPatch,
  scenePlacementVisualGeometry,
  snapSceneWorldPoint,
  worldToSceneScreen,
  type DataSceneCollisionLayerName,
  type DataScenePrimitiveVisualShape,
  type ResolvedDataSceneColliderComponent,
  type ResolvedDataSceneObjectVisual,
  type ResolvedDataSceneSpriteFrame,
  type ResolvedSceneAuthoringDocument,
  type SceneAuthoringDocumentSpec,
  type ScenePlacementBehaviorBindingPatch,
  type ScenePlacementBehaviorBindingTarget,
  type ScenePlacementBindingMigrationPreview,
  type ScenePlacementAgentHandoff,
  type SceneSpriteNormalBindingEvidence,
  type ScenePlacementAgentHandoffAssetFile,
  type ScenePlacementAgentHandoffAssetFolder,
  type ScenePlacementAgentHandoffAssetFolderDiagnostic,
  type ScenePlacementAssetDiagnostic,
  type ScenePlacementPatch,
  type ScenePlacementPatchSaveResult,
  type ScenePlacementSaveAdapter,
  type ScenePlacementAssetProvider,
  type ScenePlacementPoint,
  type ScenePlacementProjectTextureMetadata,
  type ScenePlacementSpriteFrameAsset,
  type DataSceneVariableStore,
  type ScenePlacementTransform,
  type ScenePlacementViewer,
  type ScenePlacementViewerInstance,
  type ScenePlacementViewerState,
} from "@ferrum2d/ferrum-web/authoring";

import {
  createRuntimeDemoShell,
  renderRuntimeDemoError,
} from "../../../examples/shared/runtimeDemoShell";
import "./runtimeDemoShell.css";
import "./styles.css";

// Minimal documents exist only in isolated regression builds, never in public assets.
const SCENE_DOCUMENT_URL = import.meta.env.MODE === "test"
  ? "./placement.scene-authoring.json"
  : "./placement.garden.scene-authoring.json";
const HD2D_SCENE_DOCUMENT_URL = import.meta.env.MODE === "test"
  ? "./placement.hd2d.scene-authoring.json"
  : "./placement.village.scene-authoring.json";
let documentSession:
  | ReturnType<typeof installPlacementDocumentSession>
  | undefined;
let placementWorkspaceEvidence: ScenePlacementAgentHandoff["authoringEvidence"];
let openWorkspaceDocument: ((path?: string) => Promise<void>) | undefined;
const SCENE_DOCUMENT_SAVE_ENDPOINT = "/__ferrum-placement-save";
const DESKTOP_INSPECT_ASSET_FOLDER_COMMAND = "inspect_placement_asset_folder";
const DESKTOP_LOAD_PROJECT_FOLDER_COMMAND = "load_placement_project_folder";
const DESKTOP_LOAD_SCENE_DOCUMENT_COMMAND = "load_placement_scene_document";
const DESKTOP_SAVE_AGENT_HANDOFF_COMMAND = "save_placement_agent_handoff";
const DESKTOP_SAVE_SCENE_DOCUMENT_COMMAND = "save_placement_scene_document";
const DESKTOP_PROJECT_QUERY_PARAMS = ["projectPath"] as const;
const DESKTOP_SCENE_DOCUMENT_QUERY_PARAMS = [
  "sceneDocumentPath",
  "documentPath",
] as const;
const DESKTOP_HANDOFF_SYNC_DEBOUNCE_MS = 500;
const DESKTOP_ASSET_METADATA_BATCH_SIZE = 4;
const DEFAULT_SNAP_GRID_SIZE = 16;
const PLACEMENT_ASSET_DRAG_TYPE = "application/x-ferrum-placement-asset";
let placementAssetDrag:
  | { token: string; source: HTMLElement; options: PlacementDraftOptions }
  | undefined;
const KEYBOARD_NUDGE_STEP = 1;
const KEYBOARD_FAST_MULTIPLIER = 10;
const PLACEMENT_RESIZE_MIN_SIZE = 4;
const MASS_AUTHORING_INSTANCE_COUNT = 1024;
const MASS_AUTHORING_COLUMNS = 32;
const MASS_AUTHORING_START_X = 500;
const MASS_AUTHORING_START_Y = 304;
const MASS_AUTHORING_STEP_X = 19;
const MASS_AUTHORING_STEP_Y = 11;
const DEFAULT_PRIMITIVE_COLOR = "#7ddc9d";
const DEFAULT_POINT_COLOR = "#f2c14e";
const PLACEMENT_COLLISION_LAYERS = [
  "player",
  "enemy",
  "bullet",
  "wall",
  "pickup",
] as const satisfies readonly DataSceneCollisionLayerName[];
const PLACEMENT_TEXTURES = {
  floor:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPwCgv6DwAD0gHyPaP/ZQAAAABJRU5ErkJggg==",
  crate:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGM4MsHjPwAGVAKcjTneKQAAAABJRU5ErkJggg==",
  turret:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOI2FL3HwAFfAKKSdpdewAAAABJRU5ErkJggg==",
  agent:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNIWHbnPwAGLgLidJoamwAAAABJRU5ErkJggg==",
} as const;
const PLACEMENT_TEXTURE_METADATA = {
  crate: { label: "Crate", width: 40, height: 40 },
  turret: { label: "Turret", width: 34, height: 42 },
  agent: { label: "Agent", width: 28, height: 28 },
  floor: { label: "Floor", width: 96, height: 64 },
} as const;
const PLACEMENT_ATLAS = {
  frames: {
    full: {
      texture: "crate",
      uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
      size: { width: 40, height: 40 },
    },
    base: {
      texture: "turret",
      uv: { u0: 0, v0: 0, u1: 0.5, v1: 1 },
      size: { width: 34, height: 42 },
    },
    barrel: {
      texture: "turret",
      uv: { u0: 0.5, v0: 0, u1: 1, v1: 1 },
      size: { width: 34, height: 42 },
    },
  },
} as const;
const VIEWER_TEXTURES = {
  ...PLACEMENT_TEXTURES,
  [DATA_SCENE_PRIMITIVE_TEXTURES.rect]:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNIWHbnPwAGLgLidJoamwAAAABJRU5ErkJggg==",
  [DATA_SCENE_PRIMITIVE_TEXTURES.circle]:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOI2FL3HwAFfAKKSdpdewAAAABJRU5ErkJggg==",
  [DATA_SCENE_PRIMITIVE_TEXTURES.point]:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGM4MsHjPwAGVAKcjTneKQAAAABJRU5ErkJggg==",
} as const;
const PLACEMENT_ASSET_PROVIDER =
  createScenePlacementAssetProviderFromProjectAssets({
    textures: PLACEMENT_TEXTURES,
    atlas: PLACEMENT_ATLAS,
    textureMetadata: PLACEMENT_TEXTURE_METADATA,
    frameLabel: ({ frameName }) =>
      ({
        full: "Full",
        base: "Base",
        barrel: "Barrel",
      })[frameName],
    path: "placementViewer.spriteAssets",
  });

type SceneCompositionFragmentInstanceSpec = Parameters<
  ScenePlacementViewer["addInstance"]
>[1];

interface PlacementViewerWindow extends Window {
  ferrumPlacementNormalAssetHost?: PlacementNormalAssetHost;
  __TAURI__?: PlacementViewerDesktopBridge;
  __ferrumPlacementViewer?: ScenePlacementViewer;
  ferrumPlacementViewerState?: ScenePlacementViewerState;
  ferrumPlacementViewerDesktop?: PlacementViewerDesktopState;
  ferrumPlacementViewerRuntimeAssets?: PlacementViewerRuntimeAssetSnapshot;
  ferrumPlacementViewerRuntimeFrame?: {
    entityCount: number;
    renderCommandCount: number;
    drawCalls: number;
    spatial?: {
      terrainVertices: number;
      billboardVertices: number;
      modelDraws: number;
      debugVertices: number;
    };
  };
  ferrumPlacementViewerAgentHandoff?: PlacementViewerAgentHandoff;
  ferrumPlacementViewerSelect?: (
    instanceId?: string,
  ) => ScenePlacementViewerState;
  ferrumPlacementViewerUpdateTransform?: (
    instanceId: string,
    transform: Partial<ScenePlacementTransform>,
  ) => ScenePlacementViewerState;
  ferrumPlacementViewerUpdateComponents?: (
    instanceId: string,
    components: Parameters<ScenePlacementViewer["updateInstanceComponents"]>[1],
  ) => ScenePlacementViewerState;
  ferrumPlacementViewerUpdateBehaviorBinding?: (
    target: ScenePlacementBehaviorBindingTarget,
    behaviorRecipes: ScenePlacementBehaviorBindingPatch,
  ) => ScenePlacementViewerState;
  ferrumPlacementViewerRenameInstance?: (
    instanceId: string,
    nextInstanceId: string,
  ) => ScenePlacementViewerState;
  ferrumPlacementViewerAddInstance?: (
    fragment: string,
    instance: SceneCompositionFragmentInstanceSpec,
  ) => ScenePlacementViewerState;
  ferrumPlacementViewerAddObjectDefinition?: (
    definitionId: string,
    definition: Parameters<ScenePlacementViewer["addObjectDefinition"]>[1],
  ) => ScenePlacementViewerState;
  ferrumPlacementViewerRemoveInstance?: (
    instanceId: string,
  ) => ScenePlacementViewerState;
  ferrumPlacementViewerClearDraft?: () => ScenePlacementViewerState;
  ferrumPlacementViewerExportPatch?: () => ScenePlacementPatch | undefined;
  ferrumPlacementViewerMigrationPreview?: ScenePlacementBindingMigrationPreview;
  ferrumPlacementViewerSaveDraft?: () => Promise<
    ScenePlacementPatchSaveResult | undefined
  >;
  ferrumPlacementViewerOpenSceneDocument?: (sceneDocumentPath?: string) => void;
  ferrumPlacementViewerBrowseSceneDocument?: () => Promise<string | undefined>;
  ferrumPlacementViewerBrowseProjectFolder?: () => Promise<string | undefined>;
  ferrumPlacementViewerOpenAssetFolder?: (
    assetFolderPath: string,
  ) => Promise<string | undefined>;
  ferrumPlacementViewerBrowseAssetFolder?: () => Promise<string | undefined>;
  ferrumPlacementViewerSaveHandoff?: () => Promise<string | undefined>;
  ferrumPlacementViewerRefreshHandoff?: () => void;
  ferrumPlacementViewerSaveEnabled?: boolean;
  ferrumPlacementViewerSavedDocument?: SceneAuthoringDocumentSpec;
  ferrumPlacementViewerLastSave?: ScenePlacementPatchSaveResult;
  ferrumPlacementViewerLastSaveError?: string;
  ferrumPlacementViewerNudgeSelected?: (
    delta: Partial<ScenePlacementPoint>,
  ) => ScenePlacementViewerState | undefined;
  ferrumPlacementViewerSetSnap?: (
    options: Partial<PlacementSnapOptions>,
  ) => PlacementInteractionSnapshot;
  ferrumPlacementViewerInteraction?: PlacementInteractionSnapshot;
}

interface PlacementViewerRuntimeAssetSnapshot {
  textures: Record<string, string>;
  textureIds: Record<string, number>;
}

interface PlacementViewerDesktopBridge {
  core?: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  };
  dialog?: {
    open(options: PlacementDesktopOpenDialogOptions): Promise<unknown>;
  };
}

interface PlacementViewerDesktopState {
  enabled: boolean;
  requestedProjectPath?: string;
  requestedSceneDocumentPath?: string;
  projectPath?: string;
  sceneDocumentPath?: string;
  handoffPath?: string;
  assetFolderPath?: string;
  assetFolderExists?: boolean;
  assetFolderImageCount?: number;
  assetFolderTextureAtlasInputPath?: string;
  assetFolderImages?: readonly ScenePlacementAgentHandoffAssetFile[];
  assetFolderModels?: readonly ScenePlacementAgentHandoffAssetFile[];
  assetFolderDiagnostics?: readonly ScenePlacementAgentHandoffAssetFolderDiagnostic[];
  assetFolderRuntimeStatus?: "loading" | "ready" | "error";
  assetFolderRuntimeTextureCount?: number;
  lastAssetFolderError?: string;
  lastAssetFolderRuntimeError?: string;
  handoffSyncStatus?: "idle" | "pending" | "saved" | "error";
  lastSavePath?: string;
  lastHandoffPath?: string;
  lastHandoffError?: string;
}

interface PlacementDesktopSceneDocumentResponse {
  path: string;
  document: SceneAuthoringDocumentSpec;
}

interface PlacementDesktopProjectDocumentResponse {
  projectPath: string;
  sceneDocumentPath: string;
  handoffPath: string;
  assetFolder: PlacementDesktopAssetFolderResponse;
  document: SceneAuthoringDocumentSpec;
}

interface PlacementDesktopAssetFolderResponse {
  assetFolderPath: string;
  exists: boolean;
  imageCount: number;
  textureAtlasInputPath?: string;
  images: readonly ScenePlacementAgentHandoffAssetFile[];
  models?: readonly ScenePlacementAgentHandoffAssetFile[];
  diagnostics: readonly ScenePlacementAgentHandoffAssetFolderDiagnostic[];
}

interface PlacementDesktopHandoffResponse {
  path: string;
  handoff: PlacementViewerAgentHandoff;
}

interface PlacementDesktopOpenDialogOptions {
  multiple: boolean;
  directory: boolean;
  title?: string;
  filters?: readonly {
    name: string;
    extensions: readonly string[];
  }[];
}

interface PlacementInstanceBounds {
  width: number;
  height: number;
}

interface PlacementSnapOptions {
  enabled: boolean;
  gridSize: number;
}

interface PlacementInteractionSnapshot extends PlacementSnapOptions {
  dragging: boolean;
  pendingAdd?: PlacementAddAction;
  pendingAddPreview?: PlacementPendingAddPreview;
}

interface PlacementInteractionState extends PlacementSnapOptions {
  dragging: boolean;
  pendingAdd?: PlacementAddAction;
  pendingAddPreview?: PlacementPendingAddPreview;
}

interface PlacementPendingAddPreview extends PlacementInstanceBounds {
  rotationRadians?: number;
  action: PlacementAddAction;
  label: string;
  assetId?: string;
  frameId?: string;
  thumbnailUrl?: string;
  uv?: { u0: number; v0: number; u1: number; v1: number };
}

type PlacementViewerAgentHandoff = ScenePlacementAgentHandoff & {
  asepriteImports?: readonly PlacementAsepriteImportEvidence[];
  tileImports?: readonly ReturnType<typeof tileEvidence>[];
};

interface PlacementInspector {
  element: HTMLElement;
  assetMount: HTMLElement;
  layerView(): PlacementLayerViewState;
  review(): void;
  properties(): void;
  setState(
    state: ScenePlacementViewerState,
    migrationPreview?: ScenePlacementBindingMigrationPreview,
    context?: { mode?: string; target?: { kind: string; id: string } },
  ): void;
}

interface PlacementAppChrome {
  setState(
    state: ScenePlacementViewerState,
    migrationPreview?: ScenePlacementBindingMigrationPreview,
  ): void;
  setSaveResult(result: ScenePlacementPatchSaveResult): void;
  setSaveError(error: unknown): void;
}

interface PlacementHandoffControls {
  element: HTMLElement;
  setState(
    state: ScenePlacementViewerState,
    migrationPreview?: ScenePlacementBindingMigrationPreview,
  ): void;
}

interface PlacementOverlay {
  element: HTMLElement;
  selectionBounds(): DOMRect | undefined;
  setState(
    state: ScenePlacementViewerState,
    interaction: PlacementInteractionState,
  ): void;
}

interface PlacementSaveControls {
  saveDraft(): Promise<void>;
}

interface PlacementInspectorOptions {
  signal?: AbortSignal;
  saveEnabled: boolean;
  assetProvider: PlacementAssetProviderGetter;
  sourceDocument: string;
  layerView?: PlacementLayerViewState;
}

type PlacementAssetProviderGetter = () => ScenePlacementAssetProvider;

type PlacementAddAction =
  | "add-rect"
  | "add-circle"
  | "add-point"
  | "add-sprite"
  | "add-prefab";

type PlacementComponentVisualKind = "primitive" | "sprite";
type PlacementComponentColliderType =
  | "none"
  | "aabb"
  | "circle"
  | "capsule"
  | "orientedBox"
  | "convexPolygon";
type PlacementJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly PlacementJsonValue[]
  | { readonly [key: string]: PlacementJsonValue };
type PlacementJsonObject = { readonly [key: string]: PlacementJsonValue };

async function bootstrap(): Promise<void> {
  const shell = createRuntimeDemoShell({
    title: FERRUM_AUTHORING_VIEWER_TITLE,
    frameProperty: "ferrumPlacementViewerFrame",
    gameStateLabel: placementGameStateLabel,
    controls: false,
  });
  const toolbar = shell.stage
    .closest(".demo-shell")
    ?.querySelector<HTMLElement>(".demo-toolbar");
  if (toolbar) {
    const disposeLanguage = installPlacementLanguage(toolbar);
    window.addEventListener("pagehide", (event) => {
      if (!event.persisted) disposeLanguage();
    });
  }
  for (const label of shell.stage
    .closest(".demo-shell")
    ?.querySelectorAll(".demo-metric dt") ?? []) {
    setUiText(label, label.textContent ?? "");
  }
  const metrics = shell.stage
    .closest(".demo-shell")
    ?.querySelector<HTMLElement>(".demo-metrics");
  if (!metrics) throw new Error("Missing runtime metrics");
  const bottomDock = createPlacementBottomDock(metrics);
  const assetLoading = createPlacementAssetLoading();
  let performancePanel: ReturnType<typeof createPlacementPerformance> | undefined;
  window.addEventListener("pagehide",event=>{if(!event.persisted) {assetLoading.destroy(); spatialModels.clear();}});
  let runtime: FerrumRuntime | undefined;
  let gridRenderer: PlacementGridRenderer | undefined;
  let viewportNavigation:
    | ReturnType<typeof installPlacementViewportNavigation>
    | undefined;
  let selectionTools:
    | ReturnType<typeof installPlacementSelectionTools>
    | undefined;
  let transformGizmo:
    | ReturnType<typeof installPlacementTransformGizmo>
    | undefined;
  let spatialWorkspace:
    | ReturnType<typeof installPlacementSpatialWorkspace>
    | undefined;
  let lightingControls: ReturnType<typeof createPlacementLighting> | undefined;
  let gardenPreview: ReturnType<typeof createGardenPreview> | undefined;
  let showColliderBounds = false;
  let workspaceDiagnostics:
    | ReturnType<typeof installPlacementDiagnostics>
    | undefined;
  const spatialModels = new Map<string, SpatialModelAsset>();
  try {
    const sceneDocumentUrl = placementSceneDocumentUrl();
    const requestedDesktopProjectPath = placementDesktopProjectPath();
    const requestedDesktopSceneDocumentPath =
      placementDesktopSceneDocumentPath();
    const loadedDocument = await loadSceneAuthoringDocument(
      sceneDocumentUrl,
      requestedDesktopSceneDocumentPath,
      requestedDesktopProjectPath,
    );
    const document = placementMassAuthoringEnabled()
      ? createPlacementMassAuthoringDocument(loadedDocument)
      : loadedDocument;
    await ensureVillageAssets(document);
    await ensureGardenAssets(document);
    const desktopSceneDocumentPath = (window as PlacementViewerWindow)
      .ferrumPlacementViewerDesktop?.sceneDocumentPath;
    const initialKey = desktopSceneDocumentPath ?? "sample";
    const asepriteProjectPath = (window as PlacementViewerWindow)
      .ferrumPlacementViewerDesktop?.projectPath;
    const asepriteInvoke = placementDesktopInvoke();
    const asepriteProjectHost =
      asepriteProjectPath && asepriteInvoke
        ? createDesktopAsepriteProjectHost(asepriteInvoke, asepriteProjectPath)
        : undefined;
    const nativeNormalHost =
      asepriteProjectPath && asepriteInvoke
        ? createDesktopNormalProjectHost(asepriteInvoke, asepriteProjectPath)
        : undefined;
    const tileProjectHost =
      asepriteProjectPath && asepriteInvoke
        ? createDesktopTileProjectHost(asepriteInvoke, asepriteProjectPath)
        : undefined;
    let tileAssets: ReturnType<typeof createPlacementTileAssets> | undefined;
    let assetDocumentKey = initialKey;
    function currentAssetProject(): string | undefined {
      const desktop = (window as PlacementViewerWindow).ferrumPlacementViewerDesktop;
      return desktop?.enabled ? desktop.projectPath : undefined;
    }
    let normalProjectAssets:
      | ReturnType<typeof createPlacementNormalProjectAssets>
      | undefined;
    let sourceDocument = placementMassAuthoringEnabled()
      ? `${desktopSceneDocumentPath ?? requestedDesktopSceneDocumentPath ?? sceneDocumentUrl}?massAuthoring=true`
      : (desktopSceneDocumentPath ??
        requestedDesktopSceneDocumentPath ??
        sceneDocumentUrl);
    const resolved = resolvePlacementWorkspaceDocument(document);
    const boundsById = placementBoundsById(resolved);
    const selectedInstanceId =
      document.gameplay?.primaryActor ??
      firstActorInstance(resolved) ?? resolved.bindingPlan?.instances[0]?.id;
    let saveEnabled = placementViewerSaveEnabled();
    let normalTool: ReturnType<typeof createPlacementNormalTool> | undefined;
    let asepriteTool:
      | ReturnType<typeof createPlacementAsepriteTool>
      | undefined;
    let asepriteAssets:
      | ReturnType<typeof createPlacementAsepriteAssets>
      | undefined;
    let tileTool: ReturnType<typeof createPlacementTileTool> | undefined;
    let assetBatchEditing = false;
    let previewAssetProvider = createPlacementPreviewAssetProvider();
    let previewAssetSignature = placementPreviewAssetSignature();
    let generatedProvider: ScenePlacementAssetProvider | undefined,
      generatedSignature = "";
    const currentAssetProvider = (): ScenePlacementAssetProvider => {
      const imported = [
        ...(asepriteTool?.providerAssets() ??
          asepriteAssets
            ?.entries()
            .filter((a) => canUsePlacementAsset(a, assetDocumentKey, currentAssetProject()) && a.uploaded)
            .map(asepriteProviderAsset) ??
          []),
        ...(tileTool?.providerAssets() ??
          tileAssets
            ?.entries()
            .filter((a) => canUsePlacementAsset(a, assetDocumentKey, currentAssetProject()) && a.uploaded)
            .map(tileProviderAsset) ??
          []),
      ];
      const used = new Set(imported.map((a) => a.id));
      const entries = [
        ...(normalTool?.browserEntries() ?? []),
        ...(normalProjectAssets?.browserEntries(assetDocumentKey, currentAssetProject()) ?? []),
      ].filter((entry) => {
        if (used.has(entry.id)) return false;
        used.add(entry.id);
        return true;
      });
      if (!entries.length && !imported.length) return previewAssetProvider;
      const signature = JSON.stringify([
        previewAssetSignature,
        entries,
        imported,
      ]);
      if (!generatedProvider || signature !== generatedSignature) {
        generatedSignature = signature;
        generatedProvider = createScenePlacementAssetProvider([
          ...previewAssetProvider.listSpriteAssets(),
          ...entries.map((asset) => ({
            id: asset.id,
            label: asset.id,
            width: asset.width,
            height: asset.height,
            thumbnailUrl: asset.url,
          })),
          ...imported,
        ]);
      }
      return generatedProvider;
    };
    const overlay = createPlacementOverlay(
      shell.stage,
      boundsById,
      currentAssetProvider,
      () => showColliderBounds,
    );
    const initialInspectorLifetime = new AbortController();
    let inspector = createPlacementInspector(resolved, {
      signal: initialInspectorLifetime.signal,
      saveEnabled,
      assetProvider: currentAssetProvider,
      sourceDocument,
    });
    const chromeOptions = { saveEnabled, sourceDocument };
    const appChrome = createPlacementAppChrome(shell, chromeOptions);
    const interaction = createPlacementInteractionState();
    let savedDocument = document;
    let acknowledgedDocument: SceneAuthoringDocumentSpec | undefined;
    const saveAdapter: ScenePlacementSaveAdapter = {
      id: "placement-viewer-memory",
      async saveScenePlacementPatch(request) {
        const result = await savePlacementSceneDocument(
          request.mergedDocument,
          request.sourceDocument,
        );
        if (result.document !== undefined) {
          // Publish the new baseline together with its clean viewer in activateDocument.
          // Add-definition/add-instance patches cannot be reapplied to an acknowledged baseline.
          acknowledgedDocument = result.document;
        }
        return result;
      },
    };

    shell.debugRoot.before(inspector.element);
    gridRenderer = new PlacementGridRenderer(shell.canvas);
    // The host supplies this model-preparation capability; the generic runtime
    // renderer contract also permits renderers that only draw flat commands.
    const spatialModelPreparer = gridRenderer;
    runtime = await createFerrumRuntime({
      renderer: gridRenderer,
      canvas: shell.canvas,
      debugParent: shell.debugRoot,
      debug:
        new URLSearchParams(window.location.search).get("debug") === "true",
      environment: "development",
      lighting: frame => frame.renderCommandBuffer.spatial ? false : viewportNavigation?.lighting(lightingControls?.flatLighting(), frame),
      inputTransform: (snapshot) => {
        const input = shell.inputTransform(snapshot);
        const mode = spatialWorkspace?.mode() ?? "2d";
        return (mode === "2d" && viewportNavigation?.isNavigating()) ||
          mode === "spatial"
          ? {
              ...input,
              w: false,
              a: false,
              s: false,
              d: false,
              space: false,
              mouseLeft: false,
            }
          : input;
      },
      onFrame: (frame) => {
        shell.updateFrame(frame);
        publishFrameStats(frame);
        spatialWorkspace?.frame(frame);
        lightingControls?.frame(frame);
        workspaceDiagnostics?.frame(frame);
        performancePanel?.frame(frame);
      },
    });
    shell.attachRuntime(runtime);
    performancePanel = createPlacementPerformance({ runtime, canvas: shell.canvas, models: spatialModels, visible: () => bottomDock.tabs.active() === "runtime" && metrics.getClientRects().length > 0, measureGpu: enabled => { if (gridRenderer) gridRenderer.measureGpuTiming = enabled; } });
    metrics.after(performancePanel.element);
    window.addEventListener("pagehide", (event) => {
      if (!event.persisted) gridRenderer?.destroy();
    });
    const runtimeEngine = runtime.engine;
    const runtimeTextures = placementRuntimeTextureManifest();
    let runtimeAssetAttemptSignature =
      placementRuntimeAssetSignature(runtimeTextures);
    let runtimeAssetReadySignature = runtimeAssetAttemptSignature;
    let runtimeAssetReloadInFlight = false;
    let runtimeAssetReloadAbort: AbortController | undefined;
    const runtimeLoadedTextures = new Map(Object.entries(runtimeTextures));
    await assetLoading.run("Loading Textures",(signal,progress)=>runtimeEngine.loadAssets({ textures: runtimeTextures, textureOptions: Object.fromEntries(Object.keys(runtimeTextures).map(id=>[id,{signal}])) },progress));
    asepriteAssets = createPlacementAsepriteAssets(
      runtimeEngine,
      (id) =>
        previewAssetProvider.resolveSpriteAsset(id) !== undefined ||
        (normalProjectAssets?.has(id) ?? false) ||
        (tileAssets?.entries().some((a) => a.id === id) ?? false) ||
        (normalTool?.browserEntries().some((a) => a.id === id) ?? false),
    );
    tileAssets = createPlacementTileAssets(
      runtimeEngine,
      (id) =>
        previewAssetProvider.resolveSpriteAsset(id) !== undefined ||
        (asepriteAssets?.entries().some((a) => a.id === id) ?? false) ||
        (normalProjectAssets?.has(id) ?? false) ||
        (normalTool?.browserEntries().some((a) => a.id === id) ?? false),
    );
    if (asepriteProjectHost) {
      const signal = new AbortController().signal;
      try {
        const catalog = await asepriteProjectHost.load(signal);
        const restored = await readPlacementAsepriteProject(
          catalog,
          initialKey,
          asepriteProjectHost.project,
          signal,
        );
        for (const asset of restored)
          await asepriteAssets.upload(asepriteAssets.adopt(asset), signal);
        const tiles = tileProjectHost
          ? await readPlacementTileProject(
              await tileProjectHost.load(signal),
              initialKey,
              tileProjectHost.project,
              signal,
            )
          : [];
        for (const asset of tiles)
          await tileAssets.upload(tileAssets.adopt(asset), signal);
        if (nativeNormalHost) {
          normalProjectAssets = createPlacementNormalProjectAssets(
            runtimeEngine,
            initialKey,
            asepriteProjectPath,
          );
          await normalProjectAssets.load(
            await nativeNormalHost.load(signal),
            new Map(
              [...restored, ...tiles].map((asset) => [
                asset.id,
                { sha256: asset.pngSha256, colorSpace: "srgb" as const },
              ]),
            ),
            (id) =>
              id in runtimeTextures ||
              previewAssetProvider.resolveSpriteAsset(id) !== undefined,
            signal,
          );
        }
      } catch (error) {
        normalProjectAssets?.destroy();
        asepriteAssets.destroy();
        tileAssets.destroy();
        throw error;
      }
    }
    publishPlacementRuntimeAssets(runtimeTextures, runtime.engine);
    publishPlacementRuntimeAssetStatus("ready");
    const loadModels = (scene: SceneAuthoringDocumentSpec, files = (window as PlacementViewerWindow).ferrumPlacementViewerDesktop?.assetFolderModels) =>
      assetLoading.run("Loading Models",(signal,progress)=>loadPlacementSpatialModels(runtimeEngine,scene,spatialModels,files,{signal,progress}),undefined,
        error=> error instanceof TypeError || /HTTP \d+|network|fetch/i.test(error instanceof Error ? error.message : String(error)));
    await loadModels(document);

    const instanceHandleRegistry = createSceneInstanceHandleRegistry({
      entityExists: (handle) =>
        runtime?.engine.gameplayEntityExists(handle) ?? false,
    });
    const target = createDataSceneRuntimeTarget(runtime.engine);
    let appliedRuntimeVariables: DataSceneVariableStore | undefined;
    let runtimeApplyRevision = 0;
    if (document.spatial || document.gameplay || document.variables?.length) {
      appliedRuntimeVariables = applyDataSceneAuthoringDocument(
        runtimeEngine,
        document.spatial ? placementSpatialRuntimeDocument(document) : document,
        {
          instanceHandleRegistry,
          missingBehavior: "ignore",
          spatialModelPreparer,
        },
      ).variables;
      configureVillageActor(runtimeEngine, document);
      configureGardenActor(runtimeEngine, document);
    } else
      applySceneBehaviorRecipes(
        runtime.engine,
        target,
        resolved.sceneComposition,
        resolved.behaviorRecipes,
        {
          instanceHandleRegistry,
          requireExplicitInstanceIds: true,
          missingBehavior: "ignore",
          path: "placementViewer.apply",
        },
      );

    const workspacePreview = createPlacementPreviewSession({
      document,
      registry: instanceHandleRegistry,
      apply: applyNativeWorkspacePreview,
    });
    let currentViewer = createScenePlacementViewer({
      document,
      viewport: viewportForCanvas(shell.canvas, runtime.engine),
      selectedInstanceId,
      instanceHandleRegistry,
      validateDraft: (state) => {
        if (!assetBatchEditing) {
          spatialWorkspace?.sync(state);
          lightingControls?.sync(state);
        }
      },
    });
    if (isGardenScene(document)) currentViewer.setInstancesLocked(currentViewer.state().instances.filter(instance => instance.instanceId.startsWith("ground.")).map(instance => instance.instanceId), true);
    // Stable input bindings delegate cold authoring calls to the active document.
    const viewer: ScenePlacementViewer = {
      historyState: () => currentViewer.historyState(),
      retainsAssetReference: (id, textureId) => currentViewer.retainsAssetReference(id, textureId),
      beginEdit: (label) => currentViewer.beginEdit(label),
      commitEdit: () => currentViewer.commitEdit(),
      cancelEdit: () => currentViewer.cancelEdit(),
      undo: () => currentViewer.undo(),
      redo: () => currentViewer.redo(),
      state: () => currentViewer.state(),
      selectInstance: (id) => currentViewer.selectInstance(id),
      selectInstances: (ids) => currentViewer.selectInstances(ids),
      setInstancesLocked: (ids, locked) =>
        currentViewer.setInstancesLocked(ids, locked),
      setLayerEditing: options => currentViewer.setLayerEditing(options),
      updateInstanceRenderLayers: updates => currentViewer.updateInstanceRenderLayers(updates),
      selectInstanceAtScreen: (point) =>
        currentViewer.selectInstanceAtScreen(point),
      hoverInstance: (id) => currentViewer.hoverInstance(id),
      hoverInstanceAtScreen: (point) =>
        currentViewer.hoverInstanceAtScreen(point),
      pointerAtScreen: (point) => currentViewer.pointerAtScreen(point),
      pickInstanceAtScreen: (point) =>
        currentViewer.pickInstanceAtScreen(point),
      updateInstanceTransform: (id, transform) =>
        currentViewer.updateInstanceTransform(id, transform),
      updateInstanceTransforms: (updates) =>
        currentViewer.updateInstanceTransforms(updates),
      updateSpatial: (operations) => currentViewer.updateSpatial(operations),
      updateLighting: (lighting) => currentViewer.updateLighting(lighting),
      updateInstanceComponents: (id, components) =>
        currentViewer.updateInstanceComponents(id, components),
      updateBehaviorBinding: (target, recipes) =>
        currentViewer.updateBehaviorBinding(target, recipes),
      renameInstance: (id, next) => currentViewer.renameInstance(id, next),
      addInstance: (fragment, instance, spatial) =>
        currentViewer.addInstance(fragment, instance, spatial),
      addObjectDefinition: (id, definition) =>
        currentViewer.addObjectDefinition(id, definition),
      removeInstance: (id) => currentViewer.removeInstance(id),
      removeInstances: (ids) => currentViewer.removeInstances(ids),
      duplicateInstances: (ids, offset) =>
        currentViewer.duplicateInstances(ids, offset),
      clearDraftPatch: () => currentViewer.clearDraftPatch(),
      updateViewport: (viewport) => currentViewer.updateViewport(viewport),
      exportPatch: () => currentViewer.exportPatch(),
    };
    interface WorkspaceDocument {
      key: string;
      source: string;
      document: SceneAuthoringDocumentSpec;
      resolved: ResolvedSceneAuthoringDocument;
      viewer: ScenePlacementViewer;
      registry: ReturnType<typeof createSceneInstanceHandleRegistry>;
      inspector: PlacementInspector;
      lifetime: AbortController;
      saveEnabled: boolean;
      dirty: boolean;
      desktop?: PlacementViewerDesktopState;
      snap: { enabled: boolean; gridSize: number };
      camera?: PlacementEditCamera;
      suspendedLayerEditing?: ScenePlacementViewerState["layerEditing"];
    }
    const documents = new Map<string, WorkspaceDocument>();
    let activeDocument: WorkspaceDocument = {
      key: initialKey,
      source: sourceDocument,
      document,
      resolved,
      viewer: currentViewer,
      registry: instanceHandleRegistry,
      inspector,
      lifetime: initialInspectorLifetime,
      saveEnabled,
      dirty: false,
      desktop: structuredClone(
        (window as PlacementViewerWindow).ferrumPlacementViewerDesktop,
      ),
      snap: { enabled: interaction.enabled, gridSize: interaction.gridSize },
    };
    documents.set(initialKey, activeDocument);
    let tabs: ReturnType<typeof createPlacementDocumentTabs> | undefined;
    let viewportToolbar:
      | ReturnType<typeof createPlacementViewportToolbar>
      | undefined;
    let assetBrowser:
      | ReturnType<typeof createPlacementAssetBrowser>
      | undefined;
    let assetChanges:
      | ReturnType<
          typeof createPlacementAssetChanges<PlacementDesktopAssetFolderResponse>
        >
      | undefined;
    let switching = false;
    let sceneExplorer: ReturnType<typeof createPlacementSceneExplorer> | undefined;
    let lastWorkspaceMode: "2d" | "spatial" | "game" | undefined;
    let layerVisibilitySignature = "";
    const syncTabs = () => {
      const entries = [...documents.values()].map((entry) => ({
          key: entry.key,
          label: entry.source.split(/[\\/]/u).pop() ?? entry.source,
          source: entry.source,
          dirty: entry.dirty,
        }));
      tabs?.setState(entries, activeDocument.key);
      const dock = inspector.element.querySelector<HTMLElement>(".placement-scene-dock");
      if (dock) sceneExplorer?.sync(entries, activeDocument.key, dock);
    };
    const publishCurrentAgentHandoff = (
      state: ScenePlacementViewerState,
      migrationPreview: ScenePlacementBindingMigrationPreview | undefined,
    ): void => {
      const currentDocument = state.draftPatch
        ? mergeScenePlacementPatch(savedDocument, state.draftPatch).document
        : savedDocument;
      publishPlacementAgentHandoff(
        savedDocument,
        state,
        migrationPreview,
        currentAssetProvider(),
        sourceDocument,
        [
          ...(normalTool?.bindings() ?? []),
          ...(asepriteTool?.normalBindings() ?? []),
          ...(normalProjectAssets?.bindings(
            activeDocument.key,
            currentDocument,
            state,
            currentAssetProject(),
          ) ?? []),
        ],
        asepriteTool?.evidence(currentDocument),
        tileTool?.evidence(currentDocument),
      );
    };
    // Manual visibility actions replace Solo; the panel updates its view state
    // after the synchronous action succeeds, so do not reapply old isolation here.
    let applyingLayerPolicy = false;
    const setState = (
      state: ScenePlacementViewerState,
    ): ScenePlacementViewerState => {
      state = spatialWorkspace?.sync(state) ?? state;
      lightingControls?.sync(state);
      gardenPreview?.sync();
      const mode = spatialWorkspace?.mode();
      if (mode !== "2d" && mode !== undefined) {
        if (state.layerEditing && (state.layerEditing.hiddenLayers.length || state.layerEditing.lockedLayers.length)) {
          activeDocument.suspendedLayerEditing = state.layerEditing;
          state = viewer.setLayerEditing({ hiddenLayers: [], lockedLayers: [] });
        }
      } else if (activeDocument.suspendedLayerEditing) {
        state = viewer.setLayerEditing(activeDocument.suspendedLayerEditing);
        activeDocument.suspendedLayerEditing = undefined;
      }
      if (mode === "2d" || mode === undefined) {
        if (!applyingLayerPolicy && !viewer.historyState().transactionLabel) {
          const policy = placementSoloPolicy(state, inspector.layerView());
          if (policy) state = viewer.setLayerEditing(policy);
        }
        const hidden = new Set(state.layerEditing?.hiddenLayers ?? []);
        const hiddenEntities = state.instances.filter(instance => hidden.has(placementRenderLayer(instance))).flatMap(instance => instance.entity ? [instance.entity] : []);
        const signature = JSON.stringify([activeDocument.key, runtimeApplyRevision, hiddenEntities]);
        if (signature !== layerVisibilitySignature) {
          if (!runtimeEngine.setDataSceneSpatialPreviewFilter({ hiddenEntities, hiddenSurfaces: [] }))
            throw new Error("Layer preview visibility rejected");
          layerVisibilitySignature = signature;
        }
      } else layerVisibilitySignature = "";
      // Native apply can reject a mode change. Clear the shared 2D tool only
      // after spatial sync accepts it, so a failed transition retains its tool.
      if (mode !== lastWorkspaceMode) {
        resetPlacementAdd(interaction);
        lastWorkspaceMode = mode;
      }
      const migrationPreview = placementMigrationPreview(
        savedDocument,
        state.draftPatch,
      );
      overlay.setState(state, interaction);
      inspector.setState(state, migrationPreview, {
        mode,
        target: spatialWorkspace?.target(),
      });
      appChrome.setState(state, migrationPreview);
      publishPlacementState(state);
      publishPlacementMigrationPreview(migrationPreview);
      publishPlacementInteraction(interaction);
      documentSession?.sync();
      activeDocument.dirty = state.draftPatch !== undefined;
      syncTabs();
      viewportNavigation?.syncSelection(state);
      selectionTools?.sync(state);
      transformGizmo?.sync(state);
      const assetMount = inspector.assetMount;
      bottomDock.mountAssets(assetMount);
      if (
        assetBrowser &&
        assetMount &&
        assetBrowser.element.parentElement !== assetMount
      )
        assetMount.prepend(assetBrowser.element);
      syncToolState();
      const changesMount = inspector.assetMount;
      if (
        assetChanges &&
        changesMount &&
        assetChanges.element.parentElement !== changesMount
      )
        changesMount.append(assetChanges.element);
      assetChanges?.sync();
      if (
        normalTool &&
        assetMount &&
        normalTool.element.parentElement !== assetMount
      )
        assetMount.append(normalTool.element);
      normalTool?.sync();
      if (
        asepriteTool &&
        assetMount &&
        asepriteTool.element.parentElement !== assetMount
      )
        assetMount.append(asepriteTool.element);
      asepriteTool?.sync();
      if (
        tileTool &&
        assetMount &&
        tileTool.element.parentElement !== assetMount
      )
        assetMount.append(tileTool.element);
      tileTool?.sync();
      placementWorkspaceEvidence = workspaceDiagnostics?.sync(
        state,
        savedDocument,
        sourceDocument,
        placementAssetDiagnosticsForState(state, currentAssetProvider()),
      );
      publishCurrentAgentHandoff(state, migrationPreview);
      return state;
    };
    (window as PlacementViewerWindow).ferrumPlacementViewerRefreshHandoff =
      () => {
        const state = viewer.state();
        publishCurrentAgentHandoff(
          state,
          placementMigrationPreview(savedDocument, state.draftPatch),
        );
      };
    const reloadPlacementRuntimeAssets = async (): Promise<void> => {
      if (runtimeAssetReloadInFlight) {
        return;
      }
      runtimeAssetReloadInFlight = true;
      let attempted = false;
      try {
        // Serialize uploads: an older folder load must not overwrite a newer texture.
        while (true) {
          const nextRuntimeTextures = placementRuntimeTextureManifest();
          const nextRuntimeAssetSignature =
            placementRuntimeAssetSignature(nextRuntimeTextures);
          if (nextRuntimeAssetSignature === runtimeAssetAttemptSignature) {
            if (nextRuntimeAssetSignature === runtimeAssetReadySignature) {
              publishPlacementRuntimeAssets(nextRuntimeTextures, runtimeEngine);
              publishPlacementRuntimeAssetStatus("ready");
              return;
            }
            if (attempted) return;
          }
          attempted = true;
          runtimeAssetAttemptSignature = nextRuntimeAssetSignature;
          const legacy =
            (
              window as PlacementViewerWindow
            ).ferrumPlacementViewerDesktop?.assetFolderImages?.some(
              (image) => !image.contentRevision,
            ) ?? false;
          const changedTextures = Object.fromEntries(
            Object.entries(nextRuntimeTextures).filter(
              ([id, url]) => legacy || runtimeLoadedTextures.get(id) !== url,
            ),
          );
          const controller = new AbortController();
          runtimeAssetReloadAbort = controller;
          publishPlacementRuntimeAssetStatus("loading");
          try {
            if (Object.keys(changedTextures).length)
              await assetLoading.run("Loading Textures",(signal,progress)=>runtimeEngine.loadAssets({
                textures: changedTextures,
                textureOptions: Object.fromEntries(
                  Object.keys(changedTextures).map((id) => [
                    id,
                    { signal },
                  ]),
                ),
              },progress),controller.signal);
            if (
              !controller.signal.aborted &&
              nextRuntimeAssetSignature ===
                placementRuntimeAssetSignature(
                  placementRuntimeTextureManifest(),
                )
            ) {
              for (const [id, url] of Object.entries(changedTextures))
                runtimeLoadedTextures.set(id, url);
              runtimeAssetReadySignature = nextRuntimeAssetSignature;
              publishPlacementRuntimeAssets(nextRuntimeTextures, runtimeEngine);
              publishPlacementRuntimeAssetStatus("ready");
            }
          } catch (error: unknown) {
            if (
              !controller.signal.aborted &&
              nextRuntimeAssetSignature ===
                placementRuntimeAssetSignature(
                  placementRuntimeTextureManifest(),
                )
            ) {
              publishPlacementRuntimeAssetStatus(
                "error",
                placementErrorMessage(error),
              );
            }
          }
          setState(viewer.state());
        }
      } finally {
        runtimeAssetReloadInFlight = false;
      }
    };
    window.addEventListener("ferrum-placement-desktop-statechange", () => {
      if (
        runtimeAssetAttemptSignature !==
        placementRuntimeAssetSignature(placementRuntimeTextureManifest())
      )
        runtimeAssetReloadAbort?.abort();
      const nextAssetSignature = placementPreviewAssetSignature();
      if (nextAssetSignature !== previewAssetSignature) {
        previewAssetSignature = nextAssetSignature;
        previewAssetProvider = createPlacementPreviewAssetProvider();
        setState(viewer.state());
      }
      void reloadPlacementRuntimeAssets();
    });
    installPlacementHooks(viewer, interaction, setState, {
      saveEnabled,
      saveDraft: async () => {
        if (!saveEnabled || switching || documentSession?.isSaving()) return undefined;
        if (
          documentSession?.hasPointerGesture() ||
          spatialWorkspace?.ownsGesture() || lightingControls?.ownsGesture()
        )
          return undefined;
        documentSession?.finishEdit();
        if (spatialWorkspace?.flushCameraInput() === false) return undefined;
        if (lightingControls?.flushInput() === false) return undefined;
        const patch = viewer.exportPatch();
        if (patch === undefined) {
          return undefined;
        }
        if (
          normalTool?.blocksSave(
            mergeScenePlacementPatch(savedDocument, patch).document,
          ) ||
          asepriteTool?.blocksSave(
            mergeScenePlacementPatch(savedDocument, patch).document,
          ) ||
          tileTool?.blocksSave(
            mergeScenePlacementPatch(savedDocument, patch).document,
          )
        ) {
          const error = new Error(
            tileTool?.blocksSave(
              mergeScenePlacementPatch(savedDocument, patch).document,
            )
              ? "Save tile sources with Import Tile Frames → Save Project first, or Export Assets for project installation."
              : "Save or register generated assets and imported atlases before saving the scene. Export Assets preserves the bundle for your agent.",
          );
          publishPlacementSaveError(error);
          appChrome.setSaveError(error);
          return undefined;
        }
        const migrationPreview = placementMigrationPreview(
          savedDocument,
          patch,
        );
        if ((migrationPreview?.references.length ?? 0) > 0) {
          publishPlacementMigrationPreview(migrationPreview);
          publishCurrentAgentHandoff(viewer.state(), migrationPreview);
          return undefined;
        }
        documentSession?.setSaving(true);
        acknowledgedDocument = undefined;
        try {
          const result = await saveScenePlacementPatch(savedDocument, patch, {
            allowSave: saveEnabled,
            adapter: saveAdapter,
            allowedAdapterIds: ["placement-viewer-memory"],
            path: "placementViewer.save",
          });
          publishPlacementSaveResult(result);
          appChrome.setSaveResult(result);
          if (result.saved) {
            const entry = activeDocument;
            const committedDocument = acknowledgedDocument ?? result.document;
            entry.document = committedDocument;
            entry.resolved = resolvePlacementWorkspaceDocument(committedDocument);
            entry.lifetime.abort();
            entry.inspector.element.remove();
            entry.lifetime = new AbortController();
            const editState = viewer.state();
            entry.viewer = createScenePlacementViewer({
              document: committedDocument,
              viewport: viewer.state().viewport,
              selectedInstanceId: viewer.state().selectedInstanceId,
              instanceHandleRegistry: entry.registry,
              validateDraft: (state) => {
                if (!assetBatchEditing) {
                  spatialWorkspace?.sync(state);
                  lightingControls?.sync(state);
                }
              },
            });
            entry.viewer.selectInstances(editState.selectedInstanceIds);
            entry.viewer.setInstancesLocked(editState.individuallyLockedInstanceIds ?? editState.lockedInstanceIds, true);
            if (editState.layerEditing) entry.viewer.setLayerEditing(editState.layerEditing);
            entry.inspector = createDocumentInspector(entry, entry.inspector.layerView());
            activateDocument(entry.key, true);
          }
          return result;
        } catch (error) {
          publishPlacementSaveError(error);
          appChrome.setSaveError(error);
          return undefined;
        } finally {
          documentSession?.setSaving(false);
          lightingControls?.sync(viewer.state());
        }
      },
    });
    installPlacementSelection(inspector.element, viewer, setState);
    installPlacementTransformControls(
      inspector.element,
      viewer,
      interaction,
      setState,
      {
        saveDraft: async () => {
          await (
            window as PlacementViewerWindow
          ).ferrumPlacementViewerSaveDraft?.();
        },
      },
    );
    installPlacementEditControls(
      inspector.element,
      viewer,
      interaction,
      currentAssetProvider,
      setState,
    );
    installPlacementComponentControls(inspector.element, viewer, setState);
    const cancelPlacementTool = () => {
      if (spatialWorkspace?.mode() === "spatial")
        spatialWorkspace.assetPalette.cancel();
      resetPlacementAdd(interaction);
      publishPlacementInteraction(interaction);
      setState(viewer.state());
      shell.canvas.focus({ preventScroll: true });
    };
    viewportToolbar = createPlacementViewportToolbar(
      shell.stage,
      cancelPlacementTool,
      enabled => { showColliderBounds = enabled; setState(viewer.state()); },
    );
    window.addEventListener("keydown", (event) => {
      if (
        event.code !== "Escape" ||
        event.defaultPrevented ||
        spatialWorkspace?.mode() !== "2d" ||
        (!interaction.pendingAdd && !placementAssetDrag) ||
        documentSession?.isSaving() ||
        viewer.historyState().transactionLabel ||
        (event.target instanceof Element &&
          event.target.closest(
            "input, textarea, select, [contenteditable=true]",
          ))
      )
        return;
      event.preventDefault();
      cancelPlacementTool();
    });
    window.addEventListener("ferrum-placement-toolchange", syncToolState);
    viewportNavigation = installPlacementViewportNavigation({
      runtime,
      canvas: shell.canvas,
      stage: shell.stage,
      toolbar: viewportToolbar.navigation,
      navigationSettings: viewportToolbar.flatNavigation,
      viewer,
      onChange: setState,
      isEditing: () =>
        (spatialWorkspace?.mode() ?? "2d") !== "2d" ||
        interaction.dragging ||
        documentSession?.isSaving() === true ||
        viewer.historyState().transactionLabel !== undefined,
    });
    selectionTools = installPlacementSelectionTools({
      canvas: shell.canvas,
      stage: shell.stage,
      viewer,
      onChange: setState,
      isAdding: () =>
        interaction.pendingAdd !== undefined ||
        (spatialWorkspace?.mode() ?? "2d") !== "2d",
      isEditing: () =>
        viewer.historyState().transactionLabel !== undefined ||
        documentSession?.isSaving() === true,
      finishEdit: () => documentSession?.finishEdit(),
    });
    installPlacementPointer(
      shell.canvas,
      () => inspector.element,
      viewer,
      interaction,
      currentAssetProvider,
      setState,
    );
    installPlacementAssetDrop(
      shell.canvas,
      () => inspector.element,
      viewer,
      interaction,
      currentAssetProvider,
      setState,
    );
    installPlacementResizeHandle(
      overlay.element,
      shell.canvas,
      viewer,
      interaction,
      setState,
    );
    installPlacementColliderOffsetHandle(
      overlay.element,
      shell.canvas,
      viewer,
      interaction,
      setState,
    );
    installPlacementKeyboard(shell.canvas, viewer, interaction, setState);
    transformGizmo = installPlacementTransformGizmo({
      canvas: shell.canvas,
      stage: shell.stage,
      viewer,
      onChange: setState,
      isAdding: () =>
        interaction.pendingAdd !== undefined ||
        (spatialWorkspace?.mode() ?? "2d") !== "2d",
      snapEnabled: () => interaction.enabled,
      finishEdit: () => documentSession?.finishEdit(),
      selectionBounds: () => overlay.selectionBounds(),
    });
    documentSession = installPlacementDocumentSession({
      canvas: shell.canvas,
      viewer,
      onChange: setState,
      hasUnsavedChanges: () =>
        [...documents.values()].some(
          (entry) => entry.viewer.exportPatch() !== undefined,
        ),
      canEdit: () => spatialWorkspace?.mode() !== "game",
      canSave: () => activeDocument.saveEnabled,
      hasExternalGesture: () => (spatialWorkspace?.ownsGesture() || lightingControls?.ownsGesture()) ?? false,
      isNavigationGesture: (event) =>
        (spatialWorkspace?.mode() !== undefined &&
          spatialWorkspace.mode() !== "2d") ||
        (viewportNavigation?.isNavigationGesture(event) ?? false),
    });
    spatialWorkspace = installPlacementSpatialWorkspace({
      runtime,
      canvas: shell.canvas,
      stage: shell.stage,
      cameraToolbar: viewportToolbar.camera,
      navigationSettings: viewportToolbar.spatialNavigation,
      viewSettings: viewportToolbar.spatialSettings,
      gridChanged: (state) =>
        gridRenderer?.grid?.sync({
          mode: spatialWorkspace?.mode() ?? "2d",
          viewport: state.viewport,
          size: interaction.gridSize,
          ...(spatialWorkspace?.gridSurfaceState() ?? {
            surfaces: [],
            referencePlane: false,
          }),
        }),
      toolChange: syncToolState,
      viewer,
      models: spatialModels,
      assets: currentAssetProvider,
      assetMount: () => inspector.assetMount,
      document: () => savedDocument,
      apply: (next) => applyWorkspacePreview(next, activeDocument.registry),
      onChange: setState,
      finishEdit: () => documentSession?.finishEdit(),
      snap: () => ({
        enabled: interaction.enabled,
        gridSize: interaction.gridSize,
      }),
      setSnap: (value) => {
        Object.assign(interaction, value);
        publishPlacementInteraction(interaction);
        setState(viewer.state());
      },
      flushSceneSettings: () => lightingControls?.flushInput() ?? true,
      components: (id) => {
        const selected = viewer
          .state()
          .instances.find((instance) => instance.instanceId === id);
        if (!selected) throw new Error("Unknown proxy instance");
        return placementObjectDefinitionFromSelected(selected).props!
          .components;
      },
    });
    lightingControls = createPlacementLighting({
      viewer, engine: runtimeEngine, canvas:shell.canvas,stage:shell.stage,
      clearSelection:()=>{if(spatialWorkspace?.target())spatialWorkspace.clearSelection();},
      hasObjectSelection:()=>spatialWorkspace?.target()!==undefined,
      key: () => activeDocument.key,
      mode: () => spatialWorkspace?.mode() ?? "2d",
      runtimeRevision: () => runtimeApplyRevision,
      busy: () => switching || documentSession?.isSaving() === true || interaction.dragging || viewer.historyState().transactionLabel !== undefined,
      finishEdit: () => documentSession?.finishEdit(),
      onChange: setState,
    });
    viewportToolbar.lightingSettings.append(lightingControls.element);
    gardenPreview = createGardenPreview({
      canvas: shell.canvas, stage: shell.stage, engine: runtimeEngine,
      document: () => savedDocument,
      mode: () => spatialWorkspace?.mode() ?? "2d",
      revision: () => runtimeApplyRevision,
      pointerToWorld: point => viewportNavigation!.pointerToWorld(point),
    });
    gardenPreview.sync();
    gridRenderer.grid = createPlacementGrid(
      viewportToolbar.gridSettings,
      (gridSize) => {
        interaction.gridSize = gridSize;
        publishPlacementInteraction(interaction);
        setState(viewer.state());
      },
    );
    spatialWorkspace.activate(activeDocument.key, inspector.element);
    const root = shell.stage.closest<HTMLElement>(".demo-shell");
    if (!root) throw new Error("Missing workspace shell");
    function currentPlacementTool() {
      const mode = spatialWorkspace?.mode() ?? "2d";
      if (mode === "spatial") return spatialWorkspace?.assetPalette.toolState();
      if (mode !== "2d") return;
      if (placementAssetDrag) {
        const opts = placementAssetDrag.options;
        return {
          kind: "sprite",
          id: opts.spriteAsset,
          label: opts.spriteAsset,
          frameId: opts.spriteFrame,
          dragging: true,
        };
      }
      const preview = interaction.pendingAddPreview;
      if (interaction.pendingAdd)
        return {
          kind:
            interaction.pendingAdd === "add-sprite" ? "sprite" : "primitive",
          id: preview?.assetId,
          frameId: preview?.frameId,
          label: preview?.label ?? placementAddLabel(interaction.pendingAdd),
          dragging: false,
        };
    }
    function syncToolState() {
      const tool = currentPlacementTool();
      viewportToolbar?.sync(
        spatialWorkspace?.mode() ?? "2d",
        tool?.label,
        tool?.dragging,
      );
      assetBrowser?.sync();
    }
    const chooseBrowserSprite = (asset: PlacementBrowserAsset, arm = true) => {
      const control = inspector.element.querySelector<HTMLSelectElement>(
        "[data-placement-add-sprite]",
      );
      const frame = inspector.element.querySelector<HTMLSelectElement>(
        "[data-placement-add-sprite-frame]",
      );
      if (!control || !frame) return;
      control.value = asset.id;
      control.dispatchEvent(new Event("change"));
      frame.value = asset.frameId ?? "";
      frame.dispatchEvent(new Event("change"));
      if (arm)
        inspector.element
          .querySelector<HTMLButtonElement>(
            "[data-placement-action=add-sprite]",
          )
          ?.click();
    };
    const browserModels = (): PlacementBrowserAsset[] => {
      const registered = spatialWorkspace?.assetPalette.browserEntries() ?? [],
        files =
          (window as PlacementViewerWindow).ferrumPlacementViewerDesktop
            ?.assetFolderModels ?? [];
      const refs = Object.values(viewer.state().spatial?.models ?? {}).flatMap(
        (model) => [model, ...(model.lods ?? [])],
      );
      return [
        ...files.map((file) => {
          const ref = refs.find((ref) => ref.asset === file.id),
            loaded = ref
              ? registered.find((asset) => asset.contentId === ref.contentId)
              : [...registered].reverse().find((asset) => asset.id === file.id);
          return {
            ...loaded,
            key: "model-file:" + file.path,
            id: file.id,
            kind: "model" as const,
            label: file.fileName + (loaded ? "" : " · Click to Load"),
          };
        }),
        ...registered.filter(
          (asset) => !files.some((file) => file.id === asset.id),
        ),
      ];
    };
    const loadBrowserModel = async (asset: PlacementBrowserAsset) => {
      if (
        switching ||
        documentSession?.isSaving() ||
        !spatialWorkspace ||
        spatialWorkspace.mode() !== "spatial"
      )
        return;
      const file = (
          window as PlacementViewerWindow
        ).ferrumPlacementViewerDesktop?.assetFolderModels?.find(
          (file) => file.id === asset.id,
        ),
        url = file && placementAssetRuntimeUrl(file);
      if (!url) return;
      const key = activeDocument.key;
      switching = true;
      root.inert = true;
      try {
        const model = await loadSpatialGlb(url, { materialProfile: "diffuse" });
        if (key !== activeDocument.key) return;
        spatialWorkspace.registerModel(asset.id, model);
        spatialWorkspace.assetPalette.choose({
          ...asset,
          contentId: model.contentId,
        });
        setState(viewer.state());
      } catch (error) {
        root.dispatchEvent(
          new CustomEvent("ferrum-placement-document-error", {
            detail: error,
            bubbles: true,
          }),
        );
      } finally {
        switching = false;
        root.inert = false;
      }
    };
    assetBrowser = createPlacementAssetBrowser({
      entries: () => [
        ...currentAssetProvider()
          .listSpriteAssets()
          .flatMap((asset) => [
            {
              key: "sprite:" + asset.id,
              kind: "sprite" as const,
              id: asset.id,
              label: asset.label ?? asset.id,
              thumbnail: asset.thumbnailUrl,
            },
            ...currentAssetProvider()
              .listSpriteFrames(asset.id)
              .map((frame) => ({
                key: "sprite:" + asset.id + "/" + frame.id,
                kind: "sprite" as const,
                id: asset.id,
                frameId: frame.id,
                label:
                  (asset.label ?? asset.id) + " / " + (frame.label ?? frame.id),
                thumbnail: frame.thumbnailUrl ?? asset.thumbnailUrl,
                uv: frame.thumbnailUrl ? undefined : frame.frame,
              })),
          ]),
        ...browserModels(),
      ],
      selected: (asset) => {
        const tool = currentPlacementTool();
        return (
          !!tool &&
          tool.kind === asset.kind &&
          tool.id === asset.id &&
          (tool.frameId ?? "") === (asset.frameId ?? "") &&
          (!("contentId" in tool) ||
            !tool.contentId ||
            tool.contentId === asset.contentId)
        );
      },
      choose: (asset) => {
        if (asset.kind === "model" && !asset.contentId) {
          void loadBrowserModel(asset);
          return;
        }
        if (spatialWorkspace?.mode() === "spatial")
          spatialWorkspace.assetPalette.choose(asset);
        else chooseBrowserSprite(asset);
      },
      drag: (event, asset) => {
        if (asset.kind === "model" && !asset.contentId) {
          event.preventDefault();
          void loadBrowserModel(asset);
          return;
        }
        if (spatialWorkspace?.mode() === "spatial") {
          spatialWorkspace.assetPalette.dragAsset(event, asset);
          return;
        }
        if (
          asset.kind !== "sprite" ||
          spatialWorkspace?.mode() === "game" ||
          !event.dataTransfer
        ) {
          event.preventDefault();
          return;
        }
        chooseBrowserSprite(asset, false);
        placementAssetDrag = {
          token: crypto.randomUUID(),
          source: inspector.element,
          options: placementDraftOptionsFromControls(
            inspector.element,
            "add-sprite",
          ),
        };
        syncToolState();
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(
          PLACEMENT_ASSET_DRAG_TYPE,
          placementAssetDrag.token,
        );
      },
      canUse: (asset) =>
        spatialWorkspace?.mode() !== "game" &&
        (asset.kind === "sprite" || spatialWorkspace?.mode() === "spatial"),
      projectKey: () => activeDocument.desktop?.projectPath ?? sourceDocument,
      normal: (asset) => {
        if (asset.thumbnail)
          void normalTool?.openAsset(asset.id, asset.thumbnail);
      },
    });
    function currentNormalHost(): PlacementNormalAssetHost | undefined {
      return (
        (window as PlacementViewerWindow).ferrumPlacementNormalAssetHost ??
        (activeDocument.key === initialKey &&
        activeDocument.desktop?.projectPath === asepriteProjectPath
          ? nativeNormalHost
          : undefined)
      );
    }
    normalTool = createPlacementNormalTool({
      engine: runtimeEngine,
      viewer,
      context: () => ({
        key: activeDocument.key,
        project: currentAssetProject(),
        source: sourceDocument,
        document: viewer.exportPatch()
          ? mergeScenePlacementPatch(savedDocument, viewer.exportPatch()!)
              .document
          : savedDocument,
        mode: spatialWorkspace?.mode() ?? "2d",
        canEdit:
          !switching &&
          !documentSession?.isSaving() &&
          !runtimeAssetReloadInFlight &&
          spatialWorkspace?.mode() !== "game" &&
          !spatialWorkspace?.ownsGesture() &&
          viewer.historyState().transactionLabel === undefined,
      }),
      host: currentNormalHost,
      taken: (id) =>
        previewAssetProvider.resolveSpriteAsset(id) !== undefined ||
        (normalProjectAssets?.has(id) ?? false) ||
        (tileTool?.has(id) ?? false),
      changed: () => setState(viewer.state()),
      apply: (patch) => applyAssetPatch(patch, "Apply Normal"),
    });
    function applyAssetPatch(patch: ScenePlacementPatch, label: string) {
      if (viewer.historyState().transactionLabel !== undefined)
        throw new Error("Finish the current edit before applying assets");
      mergeScenePlacementPatch(
        viewer.exportPatch() ? mergeScenePlacementPatch(savedDocument, viewer.exportPatch()!).document : savedDocument,
        patch,
        { allowedFragments: [viewer.state().fragment] },
      );
      viewer.beginEdit(label);
      try {
        assetBatchEditing = true;
        for (const operation of patch.operations) {
          switch (operation.kind) {
            case "updateComponents": viewer.updateInstanceComponents(operation.instanceId, operation.components); break;
            case "addObjectDefinition": viewer.addObjectDefinition(operation.id, operation.definition); break;
            case "addInstance": viewer.addInstance(operation.fragment, operation.instance); break;
            case "removeInstance": viewer.removeInstance(operation.instanceId); break;
            case "updateBehaviorBinding": viewer.updateBehaviorBinding(operation.target, operation.behaviorRecipes); break;
            default: throw new Error("Unsupported asset component operation");
          }
        }
        if (patch.spatial) viewer.updateSpatial(patch.spatial.operations);
        if (patch.lighting !== undefined) viewer.updateLighting(patch.lighting);
        assetBatchEditing = false;
        spatialWorkspace?.sync(viewer.state());
        viewer.commitEdit();
      } catch (error) {
        assetBatchEditing = false;
        viewer.cancelEdit();
        throw error;
      } finally {
        assetBatchEditing = false;
      }
    }
    const importedAssetContext = () => ({
      key: activeDocument.key,
      project: currentAssetProject(),
      document: viewer.exportPatch()
        ? mergeScenePlacementPatch(savedDocument, viewer.exportPatch()!)
            .document
        : savedDocument,
      mode: spatialWorkspace?.mode() ?? "2d",
      canEdit:
        !switching &&
        !documentSession?.isSaving() &&
        !runtimeAssetReloadInFlight &&
        spatialWorkspace?.mode() !== "game" &&
        !spatialWorkspace?.ownsGesture() &&
        viewer.historyState().transactionLabel === undefined,
    });
    const retainsImportedAsset = (id: string) => {
      let textureId: number | undefined;
      try { textureId = runtimeEngine.textureId(id); }
      catch { /* Staged revisions may not yet have a runtime texture alias. */ }
      return [...documents.values()].some(entry =>
        entry.viewer.retainsAssetReference(id, textureId) || JSON.stringify(entry.document).includes(JSON.stringify(id)));
    };
    tileTool = createPlacementTileTool({
      engine: runtimeEngine,
      assets: tileAssets,
      projectHost: () =>
        activeDocument.key === initialKey &&
        (window as PlacementViewerWindow).ferrumPlacementViewerDesktop
          ?.projectPath === tileProjectHost?.project
          ? tileProjectHost
          : undefined,
      saveScene: async () => {
        if (!viewer.exportPatch()) return;
        const result = await (
          window as PlacementViewerWindow
        ).ferrumPlacementViewerSaveDraft?.();
        if (!result?.saved)
          throw Error(
            (window as PlacementViewerWindow)
              .ferrumPlacementViewerLastSaveError ??
              "Assets saved. Resolve scene diagnostics and save again.",
          );
      },
      viewer,
      context: importedAssetContext,
      retainsAsset: retainsImportedAsset,
      taken: (id) =>
        previewAssetProvider.resolveSpriteAsset(id) !== undefined ||
        (asepriteAssets?.entries().some((a) => a.id === id) ?? false) ||
        (normalTool?.browserEntries().some((a) => a.id === id) ?? false) ||
        (normalProjectAssets?.has(id) ?? false),
      changed: () => setState(viewer.state()),
      apply: applyAssetPatch,
    });
    asepriteTool = createPlacementAsepriteTool({
      engine: runtimeEngine,
      viewer,
      context: importedAssetContext,
      retainsAsset: retainsImportedAsset,
      taken: (id) =>
        previewAssetProvider.resolveSpriteAsset(id) !== undefined ||
        (normalTool?.browserEntries().some((a) => a.id === id) ?? false) ||
        (tileTool?.has(id) ?? false),
      changed: () => setState(viewer.state()),
      apply: applyAssetPatch,
      normalHost: currentNormalHost,
      normalBundles: () =>
        normalProjectAssets?.bundles(
          activeDocument.key,
          viewer.exportPatch()
            ? mergeScenePlacementPatch(savedDocument, viewer.exportPatch()!)
                .document
            : savedDocument,
          currentAssetProject(),
        ) ?? [],
      normalEvidence: () =>
        normalProjectAssets?.bindings(
          activeDocument.key,
          viewer.exportPatch()
            ? mergeScenePlacementPatch(savedDocument, viewer.exportPatch()!)
                .document
            : savedDocument,
          viewer.state(),
          currentAssetProject(),
        ) ?? [],
      normalSettings: () => normalTool!.generationSettings(),
      assets: asepriteAssets,
      projectHost: () =>
        activeDocument.key === initialKey &&
        (window as PlacementViewerWindow).ferrumPlacementViewerDesktop
          ?.projectPath === asepriteProjectHost?.project
          ? asepriteProjectHost
          : undefined,
      saveScene: async () => {
        if (!viewer.exportPatch()) return;
        const result = await (
          window as PlacementViewerWindow
        ).ferrumPlacementViewerSaveDraft?.();
        if (!result?.saved)
          throw new Error(
            (window as PlacementViewerWindow)
              .ferrumPlacementViewerLastSaveError ??
              "Assets saved, but scene save was not completed. Resolve the scene diagnostics and save again.",
          );
      },
    });
    const assetRevisions = (
      images: readonly ScenePlacementAgentHandoffAssetFile[],
      models: readonly ScenePlacementAgentHandoffAssetFile[],
    ): PlacementAssetRevision[] => [
      ...images.map((file) => ({
        id: file.id,
        kind: "sprite" as const,
        revision: file.contentRevision ?? "",
      })),
      ...models.map((file) => ({
        id: file.id,
        kind: "model" as const,
        revision: file.contentRevision ?? "",
      })),
    ];
    assetChanges = createPlacementAssetChanges({
      path: () =>
        (window as PlacementViewerWindow).ferrumPlacementViewerDesktop
          ?.assetFolderPath,
      baseline: () => {
        const desktop = (window as PlacementViewerWindow)
          .ferrumPlacementViewerDesktop;
        return assetRevisions(
          desktop?.assetFolderImages ?? [],
          desktop?.assetFolderModels ?? [],
        );
      },
      probe: async (path) => {
        const invoke = placementDesktopInvoke();
        if (!invoke) throw new Error("Desktop asset host unavailable");
        const response = await invoke<PlacementDesktopAssetFolderResponse>(
          DESKTOP_INSPECT_ASSET_FOLDER_COMMAND,
          { assetFolderPath: path },
        );
        if (!isPlacementDesktopAssetFolderResponse(response))
          throw new Error("Invalid asset change response");
        return response;
      },
      revisions: (value) => assetRevisions(value.images, value.models ?? []),
      canApply: () =>
        !switching &&
        !documentSession?.isSaving() &&
        !documentSession?.hasPointerGesture() &&
        !spatialWorkspace?.ownsGesture() &&
        spatialWorkspace?.mode() !== "game",
      report: (error) =>
        root.dispatchEvent(
          new CustomEvent("ferrum-placement-document-error", {
            detail: error,
            bubbles: true,
          }),
        ),
      apply: async (value) => {
        documentSession?.finishEdit();
        if (!spatialWorkspace?.cancel())
          throw new Error("Finish the current spatial edit before reimport");
        cancelPlacementTool();
        switching = true;
        root.inert = true;
        const context = activeDocument.key;
        const oldDesktop = (window as PlacementViewerWindow)
          .ferrumPlacementViewerDesktop!;
        const previousFolder: PlacementDesktopAssetFolderResponse = {
          assetFolderPath: oldDesktop.assetFolderPath!,
          exists: oldDesktop.assetFolderExists ?? true,
          imageCount: oldDesktop.assetFolderImageCount ?? 0,
          images: oldDesktop.assetFolderImages ?? [],
          models: oldDesktop.assetFolderModels,
          diagnostics: oldDesktop.assetFolderDiagnostics ?? [],
          textureAtlasInputPath: oldDesktop.assetFolderTextureAtlasInputPath,
        };
        let editing = false,
          published = false;
        try {
          const next =
            await resolvePlacementDesktopAssetFolderImageDimensions(value);
          const previousFiles =
            (window as PlacementViewerWindow).ferrumPlacementViewerDesktop
              ?.assetFolderModels ?? [];
          const doc = viewer.state(),
            operations: Parameters<
              ScenePlacementViewer["updateSpatial"]
            >[0][number][] = [];
          for (const [id, model] of Object.entries(doc.spatial?.models ?? {})) {
            for (const ref of [model, ...(model.lods ?? [])]) {
              const file = next.models?.find((file) => file.id === ref.asset);
              if (!file)
                throw new Error("Referenced GLB is missing: " + ref.asset);
              if (
                file.contentRevision &&
                previousFiles.find((previous) => previous.id === file.id)
                  ?.contentRevision === file.contentRevision
              )
                continue;
              const url = placementAssetRuntimeUrl(file);
              if (!url)
                throw new Error("Model has no runtime URL: " + ref.asset);
              const asset = await loadSpatialGlb(url, {
                materialProfile: "diffuse",
              });
              if (asset.contentId === ref.contentId) continue;
              if (context !== activeDocument.key)
                throw new Error("Document changed during reimport");
              spatialWorkspace.registerModel(ref.asset, asset);
              if (
                !operations.some(
                  (op) =>
                    op.kind === "replaceModelAsset" &&
                    op.id === id &&
                    op.changes.asset === ref.asset,
                )
              )
                operations.push({
                  kind: "replaceModelAsset",
                  id,
                  changes: { asset: ref.asset, contentId: asset.contentId },
                });
            }
          }
          if (context !== activeDocument.key)
            throw new Error("Document changed during reimport");
          viewer.beginEdit("Reimport Assets");
          editing = true;
          if (operations.length) setState(viewer.updateSpatial(operations));
          published = true;
          publishPlacementDesktopAssetFolder(next);
          await reloadPlacementRuntimeAssets();
          const start = performance.now();
          while (
            runtimeAssetReadySignature !==
            placementRuntimeAssetSignature(placementRuntimeTextureManifest())
          ) {
            const status = (window as PlacementViewerWindow)
              .ferrumPlacementViewerDesktop;
            if (status?.assetFolderRuntimeStatus === "error")
              throw new Error(
                status.lastAssetFolderRuntimeError ?? "Texture reimport failed",
              );
            if (performance.now() - start > 30000)
              throw new Error("Asset upload timed out");
            await new Promise((resolve) => window.setTimeout(resolve, 20));
          }
          setState(viewer.commitEdit());
          editing = false;
        } catch (error) {
          if (editing) setState(viewer.cancelEdit());
          if (published) {
            runtimeAssetReadySignature = "";
            runtimeAssetAttemptSignature = "";
            runtimeLoadedTextures.clear();
            publishPlacementDesktopAssetFolder(previousFolder);
            await reloadPlacementRuntimeAssets();
          }
          throw error;
        } finally {
          switching = false;
          root.inert = false;
        }
      },
    });
    setState(viewer.state());
    const runtimeDock = bottomDock.element;
    const reviewSummary = shell.canvas.ownerDocument.createElement("output");
    reviewSummary.dataset.placementReviewSummary = "true";
    workspaceDiagnostics = installPlacementDiagnostics({
      root: runtimeDock,
      visible: () =>
        bottomDock.tabs.active() === "runtime" &&
        (root.dataset.compact === "true"
          ? root.dataset.compactPanel === "runtime"
          : root.dataset.runtimeDockHidden !== "true"),
      counts: (changes, problems) => {
        bottomDock.counts(changes, problems);
        setUiText(
          reviewSummary,
          uiMessage("{0} changes · {1} problems", changes, problems),
        );
      },
      runtime,
      select: (id) => setState(viewer.selectInstance(id)),
      handle: (id) => activeDocument.registry.get(id, { validateLive: true }),
      canReloadAssets: () =>
        !!(window as PlacementViewerWindow).ferrumPlacementViewerDesktop
          ?.assetFolderPath,
      spatialTarget: () => spatialWorkspace?.target(),
      variables: () => appliedRuntimeVariables,
      context: () =>
        activeDocument.key +
        "|" +
        spatialWorkspace?.mode() +
        "|" +
        runtimeApplyRevision,
      mode: () => spatialWorkspace?.mode() ?? "2d",
      reloadAssets: async () => {
        const path = (window as PlacementViewerWindow)
          .ferrumPlacementViewerDesktop?.assetFolderPath;
        if (path) await inspectPlacementAssetFolder(path);
      },
    });
    bottomDock.mountDiagnostics(
      workspaceDiagnostics.panels,
      workspaceDiagnostics.reload,
    );
    shell.stage.id = "placement-viewport";
    shell.stage.setAttribute("role", "tabpanel");
    tabs = createPlacementDocumentTabs({
      activate: (key) => {
        try {
          activateDocument(key);
        } catch (error) {
          tabs?.report(error);
        }
      },
      close: (key) => {
        if (switching || documentSession?.isSaving() || documents.size === 1)
          return;
        const entry = documents.get(key);
        if (!entry) return;
        if (
          entry.viewer.exportPatch() &&
          !window.confirm(
            translateUi(
              uiMessage(
                "Unsaved changes in {0}. Discard and close?",
                entry.source,
              ),
            ),
          )
        )
          return;
        if (entry === activeDocument) {
          const next = [...documents.values()].find(
            (candidate) => candidate !== entry,
          );
          try {
            if (next && !activateDocument(next.key)) return;
          } catch (error) {
            tabs?.report(error);
            return;
          }
        }
        documents.delete(key);
        normalTool?.close(key);
        asepriteTool?.close(key);
        tileTool?.close(key);
        normalProjectAssets?.close(key);
        entry.lifetime.abort();
        entry.inspector.element.remove();
        entry.registry.clear();
        syncTabs();
      },
      open: async (file) => {
        if (switching || documentSession?.isSaving()) return;
        if (file.size > 2 * 1024 * 1024)
          throw new Error("Document exceeds 2 MiB");
        switching = true;
        root.inert = true;
        try {
          await openDocument(
            `file:${crypto.randomUUID()}`,
            file.name,
            JSON.parse(await file.text()) as unknown,
            false,
          );
        } finally {
          switching = false;
          root.inert = false;
        }
      },
    });
    const layout = installPlacementWorkspaceLayout(
      root,
      (window as PlacementViewerWindow).ferrumPlacementViewerDesktop
        ?.projectPath ??
        desktopSceneDocumentPath ??
        "browser",
    );
    // This context belongs to the explicitly opened project, independent of the active tab.
    let sceneProject = structuredClone(activeDocument.desktop);
    const sceneProjectPath = sceneProject?.projectPath;
    const nativeScenePaths = new Set<string>();
    window.addEventListener("ferrum-placement-desktop-statechange", () => {
      const current = (window as PlacementViewerWindow).ferrumPlacementViewerDesktop;
      if (sceneProjectPath && current?.projectPath === sceneProjectPath) sceneProject = structuredClone(current);
    });
    let selectedFolder = false;
    async function chooseSceneFolder(): Promise<PlacementSceneCatalog | undefined> {
      if (placementDesktopInvoke()) {
        if (!placementDesktopOpenDialog()) throw new Error("Open Project using File before browsing project scenes");
        await browsePlacementProjectFolder();
        return undefined;
      }
      const input = window.document.createElement("input");
      input.type = "file"; input.multiple = true; input.setAttribute("webkitdirectory", "");
      input.hidden = true; shell.canvas.ownerDocument.body.append(input);
      try {
        const files = await new Promise<File[] | undefined>(resolve => {
          input.addEventListener("change", () => resolve(input.files?.length ? [...input.files] : undefined), { once: true });
          input.addEventListener("cancel", () => resolve(undefined), { once: true });
          input.click();
        });
        if (!files) return undefined;
        const catalog = await folderSceneCatalog(files, crypto.randomUUID());
        selectedFolder = true;
        return catalog;
      } finally { input.remove(); }
    }
    function sceneMatches(entry: PlacementSceneEntry, doc: { key: string; source: string }) {
      if (entry.id.startsWith("folder:")) return doc.key === entry.id;
      if (nativeScenePaths.has(entry.id)) return doc.key === entry.id;
      if (doc.key.startsWith("file:") || doc.key.startsWith("folder:") || documents.get(doc.key)?.desktop?.enabled) return false;
      try { return new URL(doc.source, window.document.baseURI).href === entry.source; }
      catch { return false; }
    }
    sceneExplorer = createPlacementSceneExplorer({
      async load() {
        if (selectedFolder) return chooseSceneFolder();
        const invoke = placementDesktopInvoke();
        if (!invoke) return hostedSceneCatalog(new URL("./", window.document.baseURI));
        if (!sceneProject?.projectPath) throw new Error("Open Project using File before browsing project scenes");
        const response = await invoke<{ scenes: { path: string; relativePath: string; mode: PlacementSceneEntry["mode"]; diagnostic?: string }[]; truncated: boolean; diagnostics?: unknown }>("list_placement_project_scenes", { projectPath: sceneProject.projectPath });
        if (!response || !Array.isArray(response.scenes) || response.scenes.length > 256) throw new Error("Invalid scene catalog");
        nativeScenePaths.clear();
        const scenes = response.scenes.map(item => {
          if (!item || typeof item.path !== "string" || !safeSceneRelativePath(item.relativePath) || !["2d", "hd2d", "invalid"].includes(item.mode)) throw new Error("Invalid scene catalog entry");
          nativeScenePaths.add(item.path);
          return { id: item.path, source: item.path, relativePath: item.relativePath, mode: item.mode, diagnostic: item.diagnostic,
            read: async () => {
              const result = await invoke<PlacementDesktopSceneDocumentResponse>(DESKTOP_LOAD_SCENE_DOCUMENT_COMMAND, { sceneDocumentPath: item.path });
              if (!isPlacementDesktopSceneDocumentResponse(result) || result.path !== item.path) throw new Error("Invalid scene document response");
              return result.document;
            },
          };
        });
        return { label: sceneProject.projectPath, scenes, truncated: response.truncated === true, diagnostics: readSceneScanDiagnostics(response.diagnostics) };
      },
      chooseFolder: chooseSceneFolder,
      match: sceneMatches,
      async open(entry, run) {
        if (switching || documentSession?.isSaving() || documentSession?.isFinishingPointerEdit())
          throw new Error("Finish the current edit or save before opening a scene");
        const existing = [...documents.values()].find(doc => sceneMatches(entry, doc));
        switching = true; root.inert = true;
        try {
          const native = nativeScenePaths.has(entry.id) ? sceneProject : undefined;
          const key = existing?.key ?? entry.id;
          await openDocument(key, entry.source, existing?.document ?? await entry.read(), !!native,
            native ? { ...native, requestedSceneDocumentPath: entry.id, sceneDocumentPath: entry.id,
              lastSavePath: undefined, lastHandoffPath: undefined, lastHandoffError: undefined, handoffSyncStatus: "idle" } : undefined);
          if (activeDocument.key !== key) throw new Error("Scene activation was not completed");
          switching = false; root.inert = false;
          if (run && !spatialWorkspace?.runScene()) throw new Error("Scene playback could not start; finish the current edit first");
          shell.canvas.focus({ preventScroll: true });
        } finally { switching = false; root.inert = false; }
      },
    });
    const review = shell.canvas.ownerDocument.createElement("button"),
      exportButton = shell.canvas.ownerDocument.createElement("button");
    review.type = exportButton.type = "button";
    setUiText(review, "Review");
    setUiText(exportButton, "Export");
    review.dataset.placementReview = "true";
    exportButton.dataset.placementExport = "true";
    review.addEventListener("click", () => {
      bottomDock.tabs.select("changes");
      layout.reveal("runtime");
    });
    exportButton.addEventListener("click", () => {
      layout.reveal("inspector");
      inspector.review();
    });
    root
      .querySelector(".placement-status-bar")
      ?.append(reviewSummary, review, exportButton);
    root.addEventListener("placement-scene-frame", () => {
      root
        .querySelector<HTMLButtonElement>(
          spatialWorkspace?.mode() === "spatial"
            ? "[data-placement-spatial-frame=true]"
            : "[data-placement-view-action=frame-selection]",
        )
        ?.click();
    });
    root.addEventListener("placement-layer-action", event => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as { action: PlacementLayerAction; report(error?: string): void };
      const before = viewer.state();
      try {
        if (switching || documentSession?.isSaving() || (spatialWorkspace?.mode() ?? "2d") !== "2d" || viewer.historyState().transactionLabel)
          throw new Error("Finish the current edit before changing layers.");
        const action = detail.action;
        if (action.kind === "policy") { applyingLayerPolicy = true; viewer.setLayerEditing(action); }
        else if (action.kind === "select") viewer.selectInstances(action.ids);
        else {
          const ids = new Set(before.selectedInstanceIds);
          const updates = before.instances.flatMap(instance => {
            const layer = placementRenderLayer(instance);
            if (action.kind === "move") return ids.has(instance.instanceId) ? [{ instanceId: instance.instanceId, layer: action.layer }] : [];
            return layer === action.from || layer === action.to ? [{ instanceId: instance.instanceId, layer: layer === action.from ? action.to : action.from }] : [];
          });
          viewer.updateInstanceRenderLayers(updates);
        }
        setState(viewer.state()); detail.report();
      } catch (error) {
        if (detail.action.kind === "policy" && before.layerEditing && !viewer.historyState().transactionLabel) {
          viewer.setLayerEditing(before.layerEditing);
          viewer.selectInstances(before.selectedInstanceIds);
          viewer.hoverInstance(before.hoveredInstanceId);
          setState(viewer.state());
        }
        detail.report(error instanceof Error ? error.message : String(error));
      } finally { applyingLayerPolicy = false; }
    });
    root.addEventListener("placement-scene-surface", (event) => {
      if (event instanceof CustomEvent)
        spatialWorkspace?.selectSurface(String(event.detail));
    });
    root.addEventListener("placement-show-properties", () => {
      inspector.properties();
      layout.reveal("inspector");
    });
    tabs.element.append(layout.controls);
    root.append(tabs.element);
    const updates = createPlacementUpdates({
      root,
      invoke: placementDesktopInvoke,
      projectPath: () => (window as PlacementViewerWindow).ferrumPlacementViewerDesktop?.projectPath,
      guard() {
        if (switching || documentSession?.isSaving() || documentSession?.isFinishingPointerEdit() || runtimeAssetReloadInFlight || spatialWorkspace?.ownsGesture() || viewer.historyState().transactionLabel !== undefined)
          throw new Error("Finish the current edit or save before updating");
        if (spatialWorkspace?.mode() === "game") throw new Error("Stop the running scene before updating");
        if ([...documents.values()].some(entry => entry.viewer.exportPatch())) throw new Error("Save or export unsaved scene changes before updating");
      },
    });
    installPlacementWorkspaceChrome(root, viewportToolbar, name => {
      void (async () => {
        if (switching || documentSession?.isSaving()) return;
        switching = true;
        root.inert = true;
        try {
          const paths = { garden: "./placement.garden.scene-authoring.json", village: "./placement.village.scene-authoring.json" };
          const url = new URL(paths[name], window.document.baseURI);
          const existing = [...documents.values()].find(doc => !doc.desktop?.enabled && !doc.key.startsWith("folder:") && !doc.key.startsWith("file:") && new URL(doc.source, window.document.baseURI).href === url.href);
          await openDocument(existing?.key ?? url.href, url.href, existing?.document ?? await fetchSceneJson(url), false);
        } catch (error) { tabs?.report(error); }
        finally { switching = false; root.inert = false; }
      })();
    }, () => { layout.reveal("scene"); sceneExplorer?.show(); }, () => updates.show());
    if (isGardenScene(savedDocument)) requestAnimationFrame(() => viewportNavigation?.fitScene());
    window.addEventListener("ferrum-placement-document-error", (event) => {
      if (event instanceof CustomEvent) tabs?.report(event.detail);
    });
    syncTabs();
    openWorkspaceDocument = async (path) => {
      const invoke = placementDesktopInvoke();
      if (!invoke || switching || documentSession?.isSaving()) return;
      switching = true;
      root.inert = true;
      try {
        const response = await invoke<PlacementDesktopSceneDocumentResponse>(
          DESKTOP_LOAD_SCENE_DOCUMENT_COMMAND,
          path === undefined ? undefined : { sceneDocumentPath: path },
        );
        if (!isPlacementDesktopSceneDocumentResponse(response))
          throw new Error("Invalid scene document response");
        await openDocument(
          response.path,
          response.path,
          response.document,
          true,
          {
            enabled: true,
            requestedSceneDocumentPath: path,
            sceneDocumentPath: response.path,
          },
        );
      } finally {
        switching = false;
        root.inert = false;
      }
    };

    function createDocumentInspector(
      entry: WorkspaceDocument,
      layerView?: PlacementLayerViewState,
    ): PlacementInspector {
      const next = createPlacementInspector(entry.resolved, {
        saveEnabled: entry.saveEnabled,
        assetProvider: currentAssetProvider,
        sourceDocument: entry.source,
        signal: entry.lifetime.signal,
        layerView,
      });
      next.element.hidden = true;
      shell.debugRoot.before(next.element);
      installPlacementSelection(next.element, viewer, setState);
      installPlacementTransformControls(
        next.element,
        viewer,
        interaction,
        setState,
        {
          saveDraft: async () => {
            await (
              window as PlacementViewerWindow
            ).ferrumPlacementViewerSaveDraft?.();
          },
        },
      );
      installPlacementEditControls(
        next.element,
        viewer,
        interaction,
        currentAssetProvider,
        setState,
      );
      installPlacementComponentControls(next.element, viewer, setState);
      return next;
    }
    function applyDocumentPreview(entry: WorkspaceDocument) {
      const patch = entry.viewer.exportPatch();
      const next =
        patch && entry.document.spatial
          ? mergeScenePlacementPatch(entry.document, patch).document
          : entry.document;
      applyWorkspacePreview(next, entry.registry);
    }
    function applyWorkspacePreview(
      next: SceneAuthoringDocumentSpec,
      registry: ReturnType<typeof createSceneInstanceHandleRegistry>,
    ) {
      workspacePreview.apply(next, registry);
    }
    function applyNativeWorkspacePreview(
      next: SceneAuthoringDocumentSpec,
      registry: ReturnType<typeof createSceneInstanceHandleRegistry>,
    ) {
      runtimeApplyRevision++;
      appliedRuntimeVariables = undefined;
      if (next.spatial || next.gameplay || next.variables?.length) {
        appliedRuntimeVariables = applyDataSceneAuthoringDocument(
          runtimeEngine,
          next.spatial
            ? placementSpatialRuntimeDocument(next, spatialWorkspace?.mode() === "game")
            : next,
          {
            instanceHandleRegistry: registry,
            missingBehavior: "ignore",
            spatialModelPreparer,
          },
        ).variables;
        configureVillageActor(runtimeEngine, next);
        configureGardenActor(runtimeEngine, next);
        return;
      }
      const nextResolved = resolvePlacementWorkspaceDocument(next);
      const target = createDataSceneRuntimeTarget(runtimeEngine, {
        activateDataScene: false,
      });
      // Empty documents must also reset the native scene.
      runtimeEngine.useDataScene();
      registry.clear();
      applySceneBehaviorRecipes(
        runtimeEngine,
        target,
        nextResolved.sceneComposition,
        nextResolved.behaviorRecipes,
        {
          instanceHandleRegistry: registry,
          requireExplicitInstanceIds: true,
          missingBehavior: "ignore",
          path: "placementViewer.workspace.apply",
        },
      );
    }
    function activateDocument(key: string, refresh = false) {
      const next = documents.get(key);
      if (
        !next ||
        (!refresh &&
          (documentSession?.isSaving() || switching || next === activeDocument))
      )
        return false;
      if (documentSession?.isFinishingPointerEdit()) return false;
      if (spatialWorkspace?.cancel() === false)
        throw new Error(
          "Finish or cancel the current spatial edit before switching documents",
        );
      documentSession?.finishEdit();
      if (viewer.historyState().transactionLabel !== undefined)
        throw new Error(
          "Finish or cancel the current edit before switching documents",
        );
      if (lightingControls?.flushInput() === false) return false;
      selectionTools?.cancel();
      transformGizmo?.cancel();
      if (spatialWorkspace?.suspend() === false)
        throw new Error(
          "Finish or cancel the current spatial edit before switching documents",
        );
      viewportNavigation?.cancelGesture();
      activeDocument.camera = viewportNavigation?.snapshot();
      activeDocument.snap = {
        enabled: interaction.enabled,
        gridSize: interaction.gridSize,
      };
      activeDocument.desktop = structuredClone(
        (window as PlacementViewerWindow).ferrumPlacementViewerDesktop,
      );
      const previous = activeDocument;
      try {
        applyDocumentPreview(next);
      } catch (error) {
        applyDocumentPreview(previous);
        viewportNavigation?.restore(previous.camera);
        spatialWorkspace?.activate(previous.key, previous.inspector.element);
        throw error;
      }
      cancelPlacementPendingHandoff();
      previous.inspector.element.hidden = true;
      activeDocument = next;
      assetDocumentKey = next.key;
      currentViewer = next.viewer;
      inspector = next.inspector;
      sourceDocument = next.source;
      savedDocument = next.document;
      saveEnabled = next.saveEnabled;
      chromeOptions.sourceDocument = sourceDocument;
      chromeOptions.saveEnabled = saveEnabled;
      (window as PlacementViewerWindow).ferrumPlacementViewerDesktop =
        structuredClone(next.desktop);
      (window as PlacementViewerWindow).ferrumPlacementViewerSaveEnabled =
        saveEnabled;
      previewAssetProvider = createPlacementPreviewAssetProvider();
      previewAssetSignature = placementPreviewAssetSignature();
      boundsById.clear();
      for (const [id, bounds] of placementBoundsById(next.resolved))
        boundsById.set(id, bounds);
      Object.assign(interaction, next.snap, {
        dragging: false,
        pendingAdd: undefined,
        pendingAddPreview: undefined,
      });
      inspector.element.hidden = false;
      layout.sync();
      tabs?.report();
      window.dispatchEvent(new Event("ferrum-placement-desktop-statechange"));
      publishPlacementSavedDocument(savedDocument);
      viewportNavigation?.restore(next.camera);
      spatialWorkspace?.activate(next.key, inspector.element);
      if (isGardenScene(next.document) && !next.camera) viewportNavigation?.fitScene();
      return true;
    }
    async function openDocument(
      key: string,
      source: string,
      value: unknown,
      canSave: boolean,
      desktop?: PlacementViewerDesktopState,
    ) {
      if (documents.has(key)) {
        switching = false;
        if (!activateDocument(key) && key !== activeDocument.key)
          throw new Error(
            "Wait for the current pointer edit before opening a document",
          );
        return;
      }
      if (documents.size >= 8)
        throw new Error("Close a document before opening another (8 maximum)");
      normalTool?.assertDocumentAssets(
        value as SceneAuthoringDocumentSpec,
        key,
        desktop?.enabled ? desktop.projectPath : undefined,
      );
      asepriteTool?.assertDocumentAssets(
        value as SceneAuthoringDocumentSpec,
        key,
        desktop?.enabled ? desktop.projectPath : undefined,
      );
      tileTool?.assertDocumentAssets(value as SceneAuthoringDocumentSpec, key, desktop?.enabled ? desktop.projectPath : undefined);
      normalProjectAssets?.assertDocumentAssets(
        value as SceneAuthoringDocumentSpec,
        key,
        desktop?.enabled ? desktop.projectPath : undefined,
      );
      const nextResolved = resolvePlacementWorkspaceDocument(value);
      await ensureVillageAssets(value as SceneAuthoringDocumentSpec);
      await ensureGardenAssets(value as SceneAuthoringDocumentSpec);
      if (isVillageScene(value as SceneAuthoringDocumentSpec) || isGardenScene(value as SceneAuthoringDocumentSpec)) {
        await reloadPlacementRuntimeAssets();
        if (
          runtimeAssetReadySignature !==
          placementRuntimeAssetSignature(placementRuntimeTextureManifest())
        )
          throw new Error("Example textures are not ready; retry opening the document");
        previewAssetProvider = createPlacementPreviewAssetProvider();
        previewAssetSignature = placementPreviewAssetSignature();
      }
      await loadModels(
        value as SceneAuthoringDocumentSpec,
        desktop ? (desktop.assetFolderModels ?? []) : undefined,
      );
      await spatialWorkspace?.ensureModels(value as SceneAuthoringDocumentSpec);
      const nextRegistry = createSceneInstanceHandleRegistry({
        entityExists: (handle) => runtimeEngine.gameplayEntityExists(handle),
      });
      const nextViewer = createScenePlacementViewer({
        document: value as SceneAuthoringDocumentSpec,
        viewport: viewer.state().viewport,
        selectedInstanceId:
          (value as SceneAuthoringDocumentSpec).gameplay?.primaryActor ??
          firstActorInstance(nextResolved) ??
          nextResolved.bindingPlan?.instances[0]?.id,
        instanceHandleRegistry: nextRegistry,
        validateDraft: (state) => {
          if (!assetBatchEditing) {
            spatialWorkspace?.sync(state);
            lightingControls?.sync(state);
          }
        },
      });
      // Validation above guarantees this is the original scene-authoring envelope.
      const next: WorkspaceDocument = {
        key,
        source,
        document: value as SceneAuthoringDocumentSpec,
        resolved: nextResolved,
        viewer: nextViewer,
        registry: nextRegistry,
        inspector,
        lifetime: new AbortController(),
        saveEnabled: canSave,
        dirty: false,
        desktop,
        snap: { enabled: false, gridSize: DEFAULT_SNAP_GRID_SIZE },
      };
      if (isGardenScene(value as SceneAuthoringDocumentSpec)) nextViewer.setInstancesLocked(nextViewer.state().instances.filter(instance => instance.instanceId.startsWith("ground.")).map(instance => instance.instanceId), true);
      next.inspector = createDocumentInspector(next);
      documents.set(key, next);
      try {
        switching = false;
        if (!activateDocument(key))
          throw new Error(
            "Wait for the current pointer edit before opening a document",
          );
      } catch (error) {
        documents.delete(key);
        next.lifetime.abort();
        next.inspector.element.remove();
        syncTabs();
        throw error;
      }
    }
    setState(viewer.state());

    runtime.start();
  } catch (error) {
    assetLoading.destroy();
    shell.destroy();
    gridRenderer?.destroy();
    renderRuntimeDemoError(error, {
      title: FERRUM_AUTHORING_VIEWER_TITLE,
      diagnosticReport,
    });
  }
}

function resolvePlacementWorkspaceDocument(
  value: unknown,
): ResolvedSceneAuthoringDocument {
  return resolveSceneAuthoringDocument(value, {
    path: "placementViewer.document",
    validateBindings: true,
    validateComponents: true,
    missingBehavior: "ignore",
  });
}

function placementSceneDocumentUrl(): string {
  const scene = new URLSearchParams(window.location.search).get("scene");
  if (scene === null || scene === "" || scene === "default") {
    return SCENE_DOCUMENT_URL;
  }
  if (scene === "hd2d") return HD2D_SCENE_DOCUMENT_URL;
  if (scene === "village") return "./placement.village.scene-authoring.json";
  if (scene === "garden" || scene === "2d") return "./placement.garden.scene-authoring.json";
  throw new Error(`Unsupported placement scene fixture '${scene}'.`);
}

function placementMassAuthoringEnabled(): boolean {
  return (
    new URLSearchParams(window.location.search).get("massAuthoring") === "true"
  );
}

function placementDesktopProjectPath(): string | undefined {
  const params = new URLSearchParams(window.location.search);
  for (const name of DESKTOP_PROJECT_QUERY_PARAMS) {
    const value = params.get(name)?.trim();
    if (value !== undefined && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function placementDesktopSceneDocumentPath(): string | undefined {
  const params = new URLSearchParams(window.location.search);
  for (const name of DESKTOP_SCENE_DOCUMENT_QUERY_PARAMS) {
    const value = params.get(name)?.trim();
    if (value !== undefined && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function createPlacementMassAuthoringDocument(
  document: SceneAuthoringDocumentSpec,
): SceneAuthoringDocumentSpec {
  const composition = document.sceneComposition;
  const fragments = composition.fragments ?? {};
  const mainFragment = fragments.main ?? {};
  const instances = [...(mainFragment.instances ?? [])];
  const existingIds = new Set(instances.map((instance) => instance.id));
  for (let index = 0; index < MASS_AUTHORING_INSTANCE_COUNT; index += 1) {
    const id = `mass_crate_${index.toString().padStart(4, "0")}`;
    if (existingIds.has(id)) {
      continue;
    }
    const column = index % MASS_AUTHORING_COLUMNS;
    const row = Math.floor(index / MASS_AUTHORING_COLUMNS);
    instances.push({
      id,
      prefab: "crate",
      x: MASS_AUTHORING_START_X + column * MASS_AUTHORING_STEP_X,
      y: MASS_AUTHORING_START_Y + row * MASS_AUTHORING_STEP_Y,
    });
  }
  return {
    ...document,
    sceneComposition: {
      ...composition,
      fragments: {
        ...fragments,
        main: {
          ...mainFragment,
          instances,
        },
      },
    },
  };
}

function createPlacementOverlay(
  stage: HTMLElement,
  boundsById: ReadonlyMap<string, PlacementInstanceBounds>,
  assetProvider: PlacementAssetProviderGetter,
  showColliderBounds: () => boolean,
): PlacementOverlay {
  const element = document.createElement("div");
  const draftLayer = document.createElement("div");
  const selection = document.createElement("div");
  const colliderOverlay = document.createElement("div");
  const colliderLabel = document.createElement("div");
  const resizeHandle = document.createElement("button");
  const colliderOffsetHandle = document.createElement("button");
  element.className = "placement-overlay";
  draftLayer.className = "placement-draft-layer";
  selection.className = "placement-selection";
  colliderOverlay.className = "placement-collider-overlay";
  colliderLabel.className = "placement-collider-caption";
  setUiText(colliderLabel, "Collision Bounds");
  resizeHandle.type = "button";
  resizeHandle.className = "placement-resize-handle";
  resizeHandle.dataset.placementResizeHandle = "se";
  setUiAttribute(resizeHandle, "aria-label", "Resize selected object");
  setUiAttribute(resizeHandle, "title", "Drag corner to resize visual and collider");
  colliderOffsetHandle.type = "button";
  colliderOffsetHandle.className = "placement-collider-offset-handle";
  colliderOffsetHandle.dataset.placementColliderOffsetHandle = "true";
  setUiAttribute(colliderOffsetHandle, "aria-label", "Move collider offset");
  setUiAttribute(colliderOffsetHandle, "title", "Drag to move collision bounds");
  colliderOffsetHandle.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2 8h12M5 5l3-3 3 3M5 11l3 3 3-3M5 5 2 8l3 3M11 5l3 3-3 3"/></svg>';
  colliderOverlay.append(colliderLabel, colliderOffsetHandle);
  selection.append(resizeHandle);
  element.append(draftLayer, colliderOverlay, selection);
  stage.append(element);

  return {
    element,
    selectionBounds: () => selection.dataset.visible === "true" ? selection.getBoundingClientRect() : undefined,
    setState(state, interaction) {
      renderPlacementDraftMarkers(
        draftLayer,
        state,
        boundsById,
        interaction,
        assetProvider(),
      );
      const selected = state.selected;
      if (selected === undefined) {
        selection.dataset.visible = "false";
        selection.dataset.resizable = "false";
        colliderOverlay.dataset.visible = "false";
        return;
      }
      const bounds = placementBoundsForInstance(selected, boundsById);
      if (bounds === undefined) {
        selection.dataset.visible = "false";
        selection.dataset.resizable = "false";
        colliderOverlay.dataset.visible = "false";
        return;
      }
      selection.dataset.visible = "true";
      selection.dataset.locked = String(
        state.lockedInstanceIds.includes(selected.instanceId),
      );
      positionPlacementVisual(selection, selected, state, bounds);
      const resizeKind = placementResizeKindForInstance(selected);
      selection.dataset.resizable = String(
        resizeKind !== undefined &&
          state.selectedInstanceIds.length === 1 &&
          !hasLockedSelection(state),
      );
      if (resizeKind === undefined) {
        delete selection.dataset.resizeKind;
      } else {
        selection.dataset.resizeKind = resizeKind;
      }
      if (showColliderBounds()) updatePlacementColliderOverlay(colliderOverlay, state, selected);
      else { colliderOverlay.dataset.visible = "false"; colliderOverlay.dataset.offsetDraggable = "false"; }
      if (state.selectedInstanceIds.length !== 1 || hasLockedSelection(state))
        colliderOverlay.dataset.offsetDraggable = "false";
    },
  };
}

function positionPlacementVisual(
  element: HTMLElement,
  instance: ScenePlacementViewerInstance,
  state: ScenePlacementViewerState,
  bounds: PlacementInstanceBounds,
): void {
  const geometry =
    instance.visual === undefined
      ? {
          ...instance.transform,
          width: bounds.width * instance.transform.scale,
          height: bounds.height * instance.transform.scale,
        }
      : scenePlacementVisualGeometry(instance.visual, instance.transform);
  const topLeft = worldToSceneScreen(state.viewport, {
    x: geometry.x - geometry.width * 0.5,
    y: geometry.y - geometry.height * 0.5,
  });
  element.style.transformOrigin = "center";
  element.style.transform = `translate(${topLeft.x.toFixed(2)}px, ${topLeft.y.toFixed(2)}px) rotate(${geometry.rotationRadians}rad)`;
  element.style.width = `${(geometry.width * state.viewport.zoom).toFixed(2)}px`;
  element.style.height = `${(geometry.height * state.viewport.zoom).toFixed(2)}px`;
}

function placementResizeKindForInstance(
  selected: ScenePlacementViewerInstance | undefined,
): "rect" | "circle" | undefined {
  const visual = selected?.visual;
  if (visual?.kind !== "primitive") {
    return undefined;
  }
  return visual.shape === "rect" || visual.shape === "circle"
    ? visual.shape
    : undefined;
}

function updatePlacementColliderOverlay(
  element: HTMLElement,
  state: ScenePlacementViewerState,
  selected: ScenePlacementViewerInstance,
): void {
  const collider = selected.collider;
  if (collider === undefined || collider.type === "none") {
    element.dataset.visible = "false";
    element.dataset.offsetDraggable = "false";
    return;
  }
  const bounds = placementColliderOverlayBounds(selected);
  if (bounds === undefined) {
    element.dataset.visible = "false";
    element.dataset.offsetDraggable = "false";
    return;
  }
  const topLeft = worldToSceneScreen(state.viewport, {
    x: bounds.x - bounds.width * 0.5,
    y: bounds.y - bounds.height * 0.5,
  });
  element.dataset.visible = "true";
  element.dataset.colliderType = collider.type;
  element.dataset.offsetDraggable = "true";
  element.style.transform = `translate(${topLeft.x.toFixed(2)}px, ${topLeft.y.toFixed(2)}px)`;
  element.style.width = `${(bounds.width * state.viewport.zoom).toFixed(2)}px`;
  element.style.height = `${(bounds.height * state.viewport.zoom).toFixed(2)}px`;
}

function placementColliderOverlayBounds(
  selected: ScenePlacementViewerInstance,
): { x: number; y: number; width: number; height: number } | undefined {
  const collider = selected.collider;
  if (collider === undefined || collider.type === "none") {
    return undefined;
  }
  const offsetX = collider.offsetX * selected.transform.scale;
  const offsetY = collider.offsetY * selected.transform.scale;
  const x = selected.transform.x + offsetX;
  const y = selected.transform.y + offsetY;
  switch (collider.type) {
    case "aabb":
    case "orientedBox":
      return {
        x,
        y,
        width: collider.halfWidth * 2 * selected.transform.scale,
        height: collider.halfHeight * 2 * selected.transform.scale,
      };
    case "circle":
      return {
        x,
        y,
        width: collider.radius * 2 * selected.transform.scale,
        height: collider.radius * 2 * selected.transform.scale,
      };
    case "capsule": {
      const minX = Math.min(collider.startX, collider.endX) - collider.radius;
      const maxX = Math.max(collider.startX, collider.endX) + collider.radius;
      const minY = Math.min(collider.startY, collider.endY) - collider.radius;
      const maxY = Math.max(collider.startY, collider.endY) + collider.radius;
      return {
        x,
        y,
        width: Math.max(1, maxX - minX) * selected.transform.scale,
        height: Math.max(1, maxY - minY) * selected.transform.scale,
      };
    }
    case "convexPolygon": {
      const xs = collider.vertices.map((vertex) => vertex.x);
      const ys = collider.vertices.map((vertex) => vertex.y);
      return {
        x,
        y,
        width:
          Math.max(1, Math.max(...xs) - Math.min(...xs)) *
          selected.transform.scale,
        height:
          Math.max(1, Math.max(...ys) - Math.min(...ys)) *
          selected.transform.scale,
      };
    }
  }
}

function renderPlacementDraftMarkers(
  layer: HTMLElement,
  state: ScenePlacementViewerState,
  boundsById: ReadonlyMap<string, PlacementInstanceBounds>,
  interaction: PlacementInteractionState,
  assetProvider: ScenePlacementAssetProvider,
): void {
  const draftIds = placementDraftVisibleInstanceIds(state);
  const pendingMarker = createPlacementPendingAddMarker(state, interaction);
  if (draftIds.size === 0 && pendingMarker === undefined) {
    layer.replaceChildren();
    return;
  }
  const markers: HTMLElement[] = [];
  for (const instance of state.instances) {
    if (!draftIds.has(instance.instanceId)) {
      continue;
    }
    const marker = createPlacementDraftMarker(
      instance,
      state,
      boundsById,
      assetProvider,
    );
    if (marker !== undefined) {
      markers.push(marker);
    }
  }
  if (pendingMarker !== undefined) {
    markers.push(pendingMarker);
  }
  layer.replaceChildren(...markers);
}

function placementDraftVisibleInstanceIds(
  state: ScenePlacementViewerState,
): Set<string> {
  const result = new Set<string>();
  for (const operation of state.draftPatch?.operations ?? []) {
    switch (operation.kind) {
      case "updateTransform":
        result.add(operation.instanceId);
        break;
      case "renameInstance":
        result.add(operation.nextInstanceId);
        break;
      case "addInstance":
        result.add(operation.instance.id ?? "");
        break;
      case "updateComponents":
        result.add(operation.instanceId);
        break;
      case "removeInstance":
        break;
    }
  }
  result.delete("");
  return result;
}

function createPlacementDraftMarker(
  instance: ScenePlacementViewerInstance,
  state: ScenePlacementViewerState,
  boundsById: ReadonlyMap<string, PlacementInstanceBounds>,
  assetProvider: ScenePlacementAssetProvider,
): HTMLElement | undefined {
  const bounds = placementBoundsForInstance(instance, boundsById);
  if (bounds === undefined) {
    return undefined;
  }
  const marker = document.createElement("div");
  const label = document.createElement("div");
  marker.className = "placement-draft-marker";
  label.className = "placement-draft-label";
  setUiText(label, uiMessage("{0} draft", instance.instanceId));
  applyPlacementMarkerAssetPreview(marker, instance.visual, assetProvider);
  positionPlacementVisual(marker, instance, state, bounds);
  marker.append(label);
  return marker;
}

function createPlacementPendingAddMarker(
  state: ScenePlacementViewerState,
  interaction: PlacementInteractionState,
): HTMLElement | undefined {
  if (
    interaction.pendingAdd === undefined ||
    state.pointerWorld === undefined
  ) {
    return undefined;
  }
  const preview =
    interaction.pendingAddPreview?.action === interaction.pendingAdd
      ? interaction.pendingAddPreview
      : placementFallbackPendingAddPreview(interaction.pendingAdd);
  const topLeft = worldToSceneScreen(state.viewport, {
    x: state.pointerWorld.x - preview.width * 0.5,
    y: state.pointerWorld.y - preview.height * 0.5,
  });
  const marker = document.createElement("div");
  const label = document.createElement("div");
  marker.className = "placement-draft-marker placement-pending-add-marker";
  marker.dataset.placementPendingAdd = interaction.pendingAdd;
  applyPlacementPendingMarkerPreview(marker, preview);
  label.className = "placement-draft-label";
  setUiText(label, uiMessage("{0} preview", preview.label));
  marker.style.transform = `translate(${topLeft.x.toFixed(2)}px, ${topLeft.y.toFixed(2)}px) rotate(${preview.rotationRadians ?? 0}rad)`;
  marker.style.width = `${(preview.width * state.viewport.zoom).toFixed(2)}px`;
  marker.style.height = `${(preview.height * state.viewport.zoom).toFixed(2)}px`;
  marker.append(label);
  return marker;
}

function applyPlacementMarkerAssetPreview(
  marker: HTMLElement,
  visual: ResolvedDataSceneObjectVisual | undefined,
  assetProvider: ScenePlacementAssetProvider,
): void {
  if (visual?.kind !== "sprite" || visual.texture.kind !== "asset") {
    return;
  }
  const assetId = visual.texture.name ?? String(visual.texture.value);
  const asset = assetProvider.resolveSpriteAsset(assetId);
  applyPlacementPendingMarkerPreview(marker, {
    action: "add-sprite",
    label: asset?.label ?? assetId,
    assetId,
    width: visual.bounds.width,
    height: visual.bounds.height,
    thumbnailUrl: asset?.thumbnailUrl,
    uv: visual.frame,
  });
}

function applyPlacementPendingMarkerPreview(
  marker: HTMLElement,
  preview: PlacementPendingAddPreview,
): void {
  marker.dataset.placementPreviewWidth = String(preview.width);
  marker.dataset.placementPreviewHeight = String(preview.height);
  if (preview.assetId !== undefined) {
    marker.classList.add("placement-sprite-preview-marker");
    marker.dataset.placementAssetId = preview.assetId;
  }
  if (preview.frameId !== undefined) {
    marker.dataset.placementFrameId = preview.frameId;
  }
  if (preview.thumbnailUrl !== undefined) {
    marker.dataset.placementHasThumbnail = "true";
    marker.style.backgroundImage = `url("${preview.thumbnailUrl}")`;
    if (preview.uv) {
      const { u0, v0, u1, v1 } = preview.uv,
        du = u1 - u0,
        dv = v1 - v0;
      if (du > 0 && dv > 0) {
        marker.style.backgroundSize = `${100 / du}% ${100 / dv}%`;
        marker.style.backgroundPosition = `${du === 1 ? 0 : (100 * u0) / (1 - du)}% ${dv === 1 ? 0 : (100 * v0) / (1 - dv)}%`;
      }
    }
  }
}

function createPlacementInspector(
  resolved: ResolvedSceneAuthoringDocument,
  options: PlacementInspectorOptions,
): PlacementInspector {
  const element = document.createElement("section");
  const title = document.createElement("h2");
  const list = document.createElement("div");
  const documentDetails = createPlacementDetailsList();
  const identityDetails = createPlacementDetailsList();
  const transformDetails = createPlacementDetailsList();
  const visualDetails = createPlacementDetailsList();
  const colliderDetails = createPlacementDetailsList();
  const behaviorDetails = createPlacementDetailsList();
  const handoffDetails = createPlacementDetailsList();
  const controls = createPlacementTransformControls({
    saveEnabled: options.saveEnabled,
  });
  const editControls = createPlacementEditControls(
    resolved,
    options.assetProvider,
  );
  const behaviorControls = createPlacementBehaviorBindingControls(resolved);
  const componentControls = createPlacementComponentControls({
    visualDetails,
    colliderDetails,
  });
  const documentControls = createPlacementDocumentControls(
    options.sourceDocument,
  );
  const migrationReport = createPlacementMigrationReport();
  const handoffControls = createPlacementHandoffControls({
    signal: options.signal,
    saveEnabled: options.saveEnabled,
    assetProvider: options.assetProvider,
  });
  const rows = {
    source: appendRow(documentDetails, "source"),
    project: appendRow(documentDetails, "project"),
    handoff: appendRow(documentDetails, "handoff"),
    assetFolder: appendRow(documentDetails, "asset folder"),
    saveMode: appendRow(documentDetails, "save"),
    selected: appendRow(identityDetails, "selected"),
    hovered: appendRow(identityDetails, "hovered"),
    identity: appendRow(identityDetails, "identity"),
    role: appendRow(identityDetails, "role"),
    entity: appendRow(identityDetails, "entity"),
    prefab: appendRow(identityDetails, "prefab"),
    transform: appendRow(transformDetails, "transform"),
    pointer: appendRow(transformDetails, "pointer"),
    draft: appendRow(transformDetails, "draft"),
    visual: appendRow(visualDetails, "visual"),
    collider: appendRow(colliderDetails, "collider"),
    behavior: appendRow(behaviorDetails, "behavior"),
    migration: appendRow(handoffDetails, "migration"),
    patch: appendRow(handoffDetails, "patch"),
    blockers: appendRow(handoffDetails, "blockers"),
    assets: appendRow(handoffDetails, "assets"),
  };

  element.className = "placement-panel";
  registerUiRoot(element);
  list.className = "placement-list";
  setUiText(title, "Inspector");

  for (const instance of resolved.bindingPlan?.instances ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = instance.id;
    button.dataset.instanceId = instance.id;
    list.append(button);
  }

  const detailPanel = document.createElement("section");
  detailPanel.className = "placement-inspector";
  setUiAttribute(detailPanel, "aria-label", "Inspector");
  const inspectorTabs = createPlacementPanelTabs("Inspector sections", [
    ["properties", "Properties"],
    ["placement", "Placement"],
  ] as const);
  const selectionHeader = document.createElement("output");
  selectionHeader.className = "placement-selection-header";
  selectionHeader.dataset.placementSelectionHeader = "true";
  const syncDocumentRows = (): void => {
    rows.source.textContent = placementDocumentSourceLabel(
      options.sourceDocument,
    );
    setUiText(rows.project, placementProjectStatusLabel());
    setUiText(rows.handoff, placementHandoffStatusLabel());
    setUiText(rows.assetFolder, placementAssetFolderStatusLabel());
    setUiText(rows.saveMode, placementSaveStatusLabel(options.saveEnabled));
    documentControls.setState();
  };
  window.addEventListener(
    "ferrum-placement-desktop-statechange",
    syncDocumentRows,
    { signal: options.signal },
  );
  inspectorTabs.panels
    .get("properties")!
    .append(
      createPlacementInspectorSection("Identity", identityDetails),
      createPlacementInspectorSection(
        "Transform",
        createPlacementInspectorSectionBody(transformDetails, controls.element),
      ),
      createPlacementInspectorSection("Object", editControls.element),
      componentControls.element,
      createPlacementInspectorSection(
        "Behavior Binding",
        createPlacementInspectorSectionBody(
          behaviorDetails,
          behaviorControls.element,
        ),
      ),
      createPlacementInspectorSection(
        "Document",
        createPlacementInspectorSectionBody(
          documentDetails,
          documentControls.element,
        ),
        false,
      ),
      createPlacementInspectorSection(
        "Handoff",
        createPlacementInspectorSectionBody(
          handoffDetails,
          migrationReport.element,
          handoffControls.element,
        ),
      ),
    );
  const spatialMount = document.createElement("div"),
    paletteMount = document.createElement("div");
  spatialMount.dataset.placementSpatialProperties = "true";
  paletteMount.dataset.placementSpatialPlacement = "true";
  inspectorTabs.panels.get("properties")!.prepend(spatialMount);
  inspectorTabs.panels
    .get("placement")!
    .append(editControls.placementElement, paletteMount);
  detailPanel.append(title, selectionHeader, inspectorTabs.element);
  const sceneDock = document.createElement("section");
  sceneDock.className = "placement-scene-dock";
  const assetMount = document.createElement("div");
  assetMount.dataset.placementAssetMount = "true";
  const navigator = createPlacementSceneNavigator(list, resolved);
  const layers = createPlacementLayers(options.sourceDocument, layer => navigator.filterLayer(layer), options.layerView);
  sceneDock.append(navigator.element, layers.element, list, assetMount);
  element.append(sceneDock, detailPanel);

  return {
    element,
    assetMount,
    layerView: () => layers.view,
    properties() {
      inspectorTabs.select("properties");
    },
    review() {
      inspectorTabs.select("properties");
      const handoff = detailPanel.querySelector<HTMLDetailsElement>(
        "[data-section=handoff]",
      );
      if (handoff) {
        handoff.open = true;
        handoff.scrollIntoView({ block: "nearest" });
        handoff
          .querySelector<HTMLElement>("summary")
          ?.focus({ preventScroll: true });
      }
    },
    setState(state, migrationPreview, context) {
      syncPlacementInstanceList(list, state);
      navigator.sync(
        state,
        context?.mode === "spatial" ? context.target : undefined,
      );
      layers.sync(state, context?.mode);
      const layerFilter = navigator.element.querySelector<HTMLSelectElement>("[data-placement-scene-layer-filter]");
      if (layerFilter) layerFilter.hidden = (context?.mode ?? "2d") === "2d";
      for (const button of list.querySelectorAll<HTMLButtonElement>(
        "button[data-instance-id]",
      )) {
        button.dataset.selected = String(
          state.selectedInstanceIds.includes(button.dataset.instanceId ?? ""),
        );
        button.dataset.primary = String(
          button.dataset.instanceId === state.selectedInstanceId,
        );
        button.setAttribute("aria-pressed", button.dataset.selected);
      }
      const selected = state.selected;
      const target = context?.target;
      setUiText(
        selectionHeader,
        state.spatial && target && context?.mode === "spatial"
          ? uiMessage(
              "{0} · {1}",
              target.id,
              target.kind === "surface"
                ? uiMessage("Terrain")
                : target.kind === "model"
                  ? uiMessage("Model")
                  : uiMessage("Sprite"),
            )
          : selected
            ? uiMessage(
                "{0} · {1}{2}",
                selected.instanceId,
                state.spatial?.models?.[selected.instanceId]
                  ? uiMessage("Model")
                  : selected.visual?.kind === "sprite"
                    ? uiMessage("Sprite")
                    : uiMessage("Object"),
                state.selectedInstanceIds.length > 1
                  ? uiMessage(
                      " · {0} selected",
                      state.selectedInstanceIds.length,
                    )
                  : uiMessage(""),
              )
            : "No selection",
      );
      setUiAttribute(selectionHeader, "title", uiContent(selectionHeader));
      syncDocumentRows();
      setUiText(
        rows.selected,
        state.selectedInstanceIds.length > 1
          ? uiMessage(
              "{0} objects · {1}",
              state.selectedInstanceIds.length,
              selected?.instanceId,
            )
          : uiMessage("{0}", selected?.instanceId ?? "-"),
      );
      rows.hovered.textContent = state.hoveredInstanceId ?? "-";
      rows.identity.textContent =
        selected === undefined
          ? "-"
          : `${selected.instanceId} / ${selected.prefab}`;
      setUiText(rows.visual, placementVisualLabel(selected));
      setUiText(rows.collider, placementColliderLabel(selected));
      rows.behavior.textContent = formatAuthoringViewerBehaviorProfiles(
        selected?.behaviorProfiles,
      );
      rows.role.textContent = selected?.role ?? "-";
      rows.entity.textContent =
        selected?.entity === undefined
          ? "-"
          : `${selected.entity.entityId}:${selected.entity.entityGeneration}`;
      rows.prefab.textContent =
        selected === undefined
          ? "-"
          : selected.variant === undefined
            ? selected.prefab
            : `${selected.prefab}/${selected.variant}`;
      rows.transform.textContent =
        selected === undefined
          ? "-"
          : `${formatNumber(selected.transform.x)}, ${formatNumber(selected.transform.y)}`;
      rows.pointer.textContent =
        state.pointerWorld === undefined
          ? "-"
          : `${formatNumber(state.pointerWorld.x)}, ${formatNumber(state.pointerWorld.y)}`;
      rows.draft.textContent =
        state.draftPatch === undefined
          ? "-"
          : `${placementPatchOperationCount(state.draftPatch)}`;
      rows.migration.textContent =
        migrationPreview === undefined
          ? "-"
          : `${migrationPreview.references.length}`;
      setUiText(
        rows.patch,
        state.draftPatch === undefined
          ? "clean"
          : uiMessage(
              "{0} operation{1}",
              placementPatchOperationCount(state.draftPatch),
              placementPatchOperationCount(state.draftPatch) === 1
                ? uiMessage("")
                : uiMessage("s"),
            ),
      );
      rows.blockers.textContent = `${migrationPreview?.references.length ?? 0}`;
      rows.assets.textContent = `${placementAssetDiagnosticsForState(state, options.assetProvider()).length}`;
      migrationReport.setPreview(migrationPreview);
      controls.setState(state, migrationPreview);
      editControls.setState(state);
      behaviorControls.setState(state);
      componentControls.setState(state);
      handoffControls.setState(state, migrationPreview);
      if (state.selectedInstanceIds.length !== 1 || hasLockedSelection(state)) {
        for (const control of componentControls.element.querySelectorAll<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >("input, select, textarea"))
          control.disabled = true;
        for (const control of behaviorControls.element.querySelectorAll<
          HTMLInputElement | HTMLSelectElement | HTMLButtonElement
        >("input, select, button"))
          control.disabled = true;
        for (const control of element.querySelectorAll<
          HTMLInputElement | HTMLButtonElement
        >(
          "[data-placement-action=apply-components], [data-placement-action=rename-selected], [data-placement-action=create-object-definition], [data-placement-rename-id], [data-placement-definition-id]",
        ))
          control.disabled = true;
      }
    },
  };
}

function createPlacementDetailsList(): HTMLDListElement {
  const details = document.createElement("dl");
  details.className = "placement-details";
  return details;
}

function createPlacementInspectorSection(
  title: string,
  body: HTMLElement,
  open = true,
): HTMLDetailsElement {
  const section = createAuthoringViewerDisclosureSection({
    title,
    body,
    open,
    className: "placement-inspector-section",
    summaryClassName: "placement-inspector-section-title",
    bodyClassName: "placement-inspector-section-body",
  });
  section.dataset.section = title.toLowerCase().replace(/ /g, "-");
  const caption = section.querySelector("summary span");
  if (caption) setUiText(caption, title);
  return section;
}

function createPlacementInspectorSectionBody(
  ...children: readonly HTMLElement[]
): HTMLElement {
  const body = document.createElement("div");
  body.className = "placement-inspector-section-content";
  body.append(...children);
  return body;
}

function createPlacementAppChrome(
  shell: ReturnType<typeof createRuntimeDemoShell>,
  options: Pick<PlacementInspectorOptions, "saveEnabled" | "sourceDocument">,
): PlacementAppChrome {
  const root = shell.stage.closest<HTMLElement>(".demo-shell");
  const toolbar = root?.querySelector<HTMLElement>(".demo-toolbar") ?? null;
  if (root === null || toolbar === null) {
    return {
      setState: () => undefined,
      setSaveResult: () => undefined,
      setSaveError: () => undefined,
    };
  }

  root.dataset.placementEngineShell = "true";
  const chrome = createAuthoringViewerAppChrome({
    root,
    toolbar,
    title: "Ferrum2D Placement",
    insertBefore: toolbar.querySelector(".demo-actions"),
    classNames: {
      fileStrip: "placement-file-strip",
      fileMeta: "placement-file-meta",
      fileName: "placement-file-name",
      filePath: "placement-file-path",
      stateBadge: "placement-state-badge",
      stateBadgeMuted: "placement-state-badge-muted",
      statusBar: "placement-status-bar",
      statusItem: "placement-status-item",
      statusLabel: "placement-status-label",
      statusValue: "placement-status-value",
    },
  });
  for (const label of chrome.statusBar.querySelectorAll(
    ".placement-status-label",
  )) {
    setUiText(label, label.textContent ?? "");
  }
  const localizeChrome = (draftCount?: number) => {
    const badges = chrome.fileStrip.querySelectorAll(".placement-state-badge");
    const saveBadge = badges[0];
    if (saveBadge) {
      setUiText(saveBadge, saveBadge.textContent ?? "");
      setUiAttribute(
        saveBadge,
        "title",
        options.saveEnabled
          ? "Save document changes"
          : "File saving unavailable. Copy Patch or Handoff to keep changes.",
      );
    }
    const draftBadge = badges[1];
    if (draftBadge && draftCount !== undefined) {
      setUiText(
        draftBadge,
        draftCount
          ? uiMessage(
              draftCount === 1 ? "{0} Change" : "{0} Changes",
              draftCount,
            )
          : "Clean",
      );
    }
    const statusValues = chrome.statusBar.querySelectorAll(
      ".placement-status-item .placement-status-value",
    );
    const saveTarget = statusValues[statusValues.length - 1];
    if (saveTarget)
      setUiText(saveTarget, placementSaveStatusLabel(options.saveEnabled));
  };
  let lastDraftCount = 0;

  const setSnapshot = (
    state: ScenePlacementViewerState | undefined,
    migrationPreview: ScenePlacementBindingMigrationPreview | undefined,
  ): void => {
    const selected = state?.selected;
    const draftCount = placementPatchOperationCount(state?.draftPatch);
    lastDraftCount = draftCount;
    const referenceCount = migrationPreview?.references.length ?? 0;
    chrome.setSnapshot({
      source: placementDocumentSourceLabel(options.sourceDocument),
      selected: selected?.instanceId,
      prefab:
        selected === undefined
          ? undefined
          : selected.variant === undefined
            ? selected.prefab
            : `${selected.prefab}/${selected.variant}`,
      draftCount,
      referenceCount,
      saveEnabled: options.saveEnabled,
      saveTarget: placementSaveStatusLabel(options.saveEnabled),
    });
    localizeChrome(draftCount);
  };

  setSnapshot(undefined, undefined);

  return {
    setState(state, migrationPreview) {
      setSnapshot(state, migrationPreview);
    },
    setSaveResult(result) {
      chrome.setSaveResult(result);
      localizeChrome(lastDraftCount);
    },
    setSaveError(error) {
      chrome.setSaveError(error);
      localizeChrome(lastDraftCount);
    },
  };
}

function createPlacementMigrationReport(): {
  element: HTMLElement;
  setPreview(preview?: ScenePlacementBindingMigrationPreview): void;
} {
  const element = document.createElement("section");
  const title = document.createElement("h3");
  const list = document.createElement("ul");
  element.className = "placement-migration-report";
  element.dataset.placementMigrationReport = "true";
  setUiText(title, "Binding references");
  list.className = "placement-migration-list";
  element.append(title, list);
  return {
    element,
    setPreview(preview) {
      const references = preview?.references ?? [];
      element.dataset.referenceCount = String(references.length);
      element.dataset.blocking = String(references.length > 0);
      if (references.length === 0) {
        const item = document.createElement("li");
        setUiText(item, "No pending binding references");
        list.replaceChildren(item);
        return;
      }
      list.replaceChildren(
        ...references.map((reference) => {
          const item = document.createElement("li");
          item.dataset.referenceKind = reference.referenceKind;
          item.dataset.operationKind = reference.operationKind;
          setUiText(item, placementMigrationReferenceLabel(reference));
          return item;
        }),
      );
    },
  };
}

function createPlacementHandoffControls(options: {
  signal?: AbortSignal;
  saveEnabled: boolean;
  assetProvider: PlacementAssetProviderGetter;
}): PlacementHandoffControls {
  const element = document.createElement("section");
  const actions = document.createElement("div");
  const copyPatch = document.createElement("button");
  const copyHandoff = document.createElement("button");
  const saveHandoff = document.createElement("button");
  const saveDraft = document.createElement("button");
  const status = document.createElement("p");
  let lastState: ScenePlacementViewerState | undefined;

  element.className = "placement-handoff-controls";
  actions.className = "placement-handoff-actions";
  status.className = "placement-handoff-status";
  status.dataset.status = "idle";
  copyPatch.type = "button";
  setUiText(copyPatch, "Copy Patch");
  copyPatch.dataset.placementAction = "copy-patch";
  copyHandoff.type = "button";
  setUiText(copyHandoff, "Copy Handoff");
  copyHandoff.dataset.placementAction = "copy-handoff";
  saveHandoff.type = "button";
  setUiText(saveHandoff, "Save Handoff");
  saveHandoff.dataset.placementAction = "save-handoff";
  saveDraft.type = "button";
  setUiText(saveDraft, "Save Draft");
  saveDraft.dataset.placementAction = "save-draft";
  actions.append(copyPatch, copyHandoff, saveHandoff, saveDraft);
  element.append(actions, status);

  const setStatus = (
    message: UiContent,
    kind: "idle" | "success" | "blocked" | "error",
  ): void => {
    setUiText(status, message);
    status.dataset.status = kind;
  };
  const syncStatus = (): void => {
    if (lastState === undefined) {
      return;
    }
    const desktop = (window as PlacementViewerWindow)
      .ferrumPlacementViewerDesktop;
    const desktopInvoke = placementDesktopInvoke();
    const autoSyncEnabled = placementDesktopHandoffAutoSyncEnabled();
    const draftCount = placementPatchOperationCount(lastState.draftPatch);
    const blockedCount = lastMigrationPreview?.references.length ?? 0;
    const assetDiagnosticCount = placementAssetDiagnosticsForState(
      lastState,
      options.assetProvider(),
    ).length;
    copyPatch.disabled = draftCount === 0;
    copyHandoff.disabled = false;
    saveHandoff.disabled =
      desktopInvoke === undefined || desktop?.enabled !== true;
    saveDraft.disabled =
      draftCount === 0 || !options.saveEnabled || blockedCount > 0;
    saveDraft.dataset.blockedByReferences = String(blockedCount > 0);
    element.dataset.draftCount = String(draftCount);
    element.dataset.blockedReferenceCount = String(blockedCount);
    element.dataset.assetDiagnosticCount = String(assetDiagnosticCount);
    element.dataset.autoHandoffSync =
      desktopInvoke === undefined
        ? "unavailable"
        : autoSyncEnabled
          ? (desktop?.handoffSyncStatus ?? "idle")
          : "disabled";
    if (desktop?.lastHandoffError !== undefined) {
      setStatus(
        uiMessage("Handoff sync failed: {0}", desktop.lastHandoffError),
        "error",
      );
    } else if (autoSyncEnabled && desktop?.handoffSyncStatus === "pending") {
      setStatus("Auto saving handoff", "idle");
    } else if (blockedCount > 0) {
      setStatus(
        uiMessage(
          "{0} blocked reference{1}",
          blockedCount,
          blockedCount === 1 ? uiMessage("") : uiMessage("s"),
        ),
        "blocked",
      );
    } else if (draftCount > 0) {
      setStatus(
        uiMessage(
          "{0} patch operation{1} ready",
          draftCount,
          draftCount === 1 ? uiMessage("") : uiMessage("s"),
        ),
        "idle",
      );
    } else if (autoSyncEnabled && desktop?.handoffSyncStatus === "saved") {
      setStatus("Handoff synced", "success");
    } else if (desktop?.enabled === true && !autoSyncEnabled) {
      setStatus("Open Project to auto sync handoff", "idle");
    } else {
      setStatus("No draft patch", "idle");
    }
  };
  let lastMigrationPreview: ScenePlacementBindingMigrationPreview | undefined;
  const copyJson = async (kind: "patch" | "handoff"): Promise<void> => {
    const value =
      kind === "patch"
        ? lastState?.draftPatch
        : (window as PlacementViewerWindow).ferrumPlacementViewerAgentHandoff;
    if (value === undefined) {
      setStatus(
        kind === "patch" ? "No draft patch to copy" : "No handoff payload yet",
        "blocked",
      );
      return;
    }
    try {
      await copyPlacementText(JSON.stringify(value, null, 2));
      setStatus(
        kind === "patch" ? "Patch copied" : "Handoff copied",
        "success",
      );
    } catch (error) {
      setStatus(placementErrorMessage(error), "error");
    }
  };

  copyPatch.addEventListener("click", () => {
    void copyJson("patch");
  });
  copyHandoff.addEventListener("click", () => {
    void copyJson("handoff");
  });
  saveHandoff.addEventListener("click", () => {
    const documentRevision = placementDocumentRevision;
    void savePlacementAgentHandoffToDesktop()
      .then((path) => {
        if (path === undefined) {
          setStatus("No handoff payload yet", "blocked");
          return;
        }
        setStatus(uiMessage("Handoff saved {0}", path), "success");
      })
      .catch((error: unknown) => {
        if (documentRevision !== placementDocumentRevision) return;
        publishPlacementDesktopState({
          lastHandoffError: placementErrorMessage(error),
        });
        setStatus(placementErrorMessage(error), "error");
      });
  });
  window.addEventListener("ferrum-placement-desktop-statechange", syncStatus, {
    signal: options.signal,
  });

  return {
    element,
    setState(state, migrationPreview) {
      lastState = state;
      lastMigrationPreview = migrationPreview;
      syncStatus();
    },
  };
}

function placementMigrationReferenceLabel(
  reference: ScenePlacementBindingMigrationPreview["references"][number],
): string {
  const next =
    reference.nextInstanceId === undefined
      ? ""
      : ` -> ${reference.nextInstanceId}`;
  return `${reference.operationKind}: ${reference.instanceId}${next} (${reference.referenceKind}) ${reference.path}`;
}

function syncPlacementInstanceList(
  list: HTMLElement,
  state: ScenePlacementViewerState,
): void {
  const currentIds = Array.from(
    list.querySelectorAll<HTMLButtonElement>("button[data-instance-id]"),
  ).map((button) => button.dataset.instanceId ?? "");
  const nextIds = state.instances.map((instance) => instance.instanceId);
  const nextIdSet = new Set(nextIds);
  const same =
    currentIds.length === nextIds.length &&
    currentIds.every((id) => nextIdSet.has(id));
  if (!same || !list.querySelector("[data-placement-lock-instance]"))
    list.replaceChildren(
      ...nextIds.map((instanceId) => {
        const row = document.createElement("div");
        row.className = "placement-instance-row";
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = instanceId;
        button.dataset.instanceId = instanceId;
        const lock = document.createElement("button");
        lock.type = "button";
        lock.dataset.placementLockInstance = instanceId;
        row.append(button, lock);
        return row;
      }),
    );
  const locked = new Set(state.lockedInstanceIds);
  const instances = new Map(state.instances.map(instance => [instance.instanceId, instance]));
  for (const button of list.querySelectorAll<HTMLButtonElement>("[data-instance-id]")) {
    const instance = instances.get(button.dataset.instanceId!);
    if (!instance) continue;
    const hidden = state.layerEditing?.hiddenLayers.includes(placementRenderLayer(instance)) ?? false;
    button.disabled = hidden; button.closest<HTMLElement>(".placement-instance-row")?.setAttribute("data-layer-hidden", String(hidden));
  }
  for (const control of list.querySelectorAll<HTMLButtonElement>(
    "[data-placement-lock-instance]",
  )) {
    const isLocked = locked.has(control.dataset.placementLockInstance ?? "");
    const instance = instances.get(control.dataset.placementLockInstance!);
    control.disabled = !!instance && !!state.layerEditing?.lockedLayers.includes(placementRenderLayer(instance));
    setUiText(control, isLocked ? "Unlock" : "Lock");
    setUiAttribute(
      control,
      "title",
      uiMessage(
        "{0} object",
        isLocked ? uiMessage("Unlock") : uiMessage("Lock"),
      ),
    );
    setUiAttribute(
      control,
      "aria-label",
      uiMessage(
        "{0} {1}",
        isLocked ? uiMessage("Unlock") : uiMessage("Lock"),
        control.dataset.placementLockInstance,
      ),
    );
    control.setAttribute("aria-pressed", String(isLocked));
    control
      .closest<HTMLElement>(".placement-instance-row")
      ?.setAttribute("data-locked", String(isLocked));
  }
}

function createPlacementDocumentControls(sourceDocument: string): {
  element: HTMLFormElement;
  setState(): void;
} {
  const form = document.createElement("form");
  const projectRow = document.createElement("div");
  const assetRow = document.createElement("div");
  const documentRow = document.createElement("div");
  const projectPath = appendTextControl(projectRow, "project", "projectPath");
  const assetFolderPath = appendTextControl(
    assetRow,
    "assets",
    "assetFolderPath",
  );
  const path = appendTextControl(documentRow, "document", "sceneDocumentPath");
  const openProject = document.createElement("button");
  const chooseProject = document.createElement("button");
  const useAssets = document.createElement("button");
  const chooseAssets = document.createElement("button");
  const browse = document.createElement("button");
  const openPath = document.createElement("button");
  const sample = document.createElement("button");

  form.className = "placement-controls placement-document-controls";
  projectRow.className =
    "placement-control-grid placement-document-project-grid";
  assetRow.className = "placement-control-grid placement-document-asset-grid";
  documentRow.className =
    "placement-control-grid placement-document-scene-grid";
  projectPath.value = placementProjectInputValue();
  setUiAttribute(projectPath, "placeholder", "/absolute/path/to/project");
  assetFolderPath.value = placementAssetFolderInputValue();
  setUiAttribute(
    assetFolderPath,
    "placeholder",
    "/absolute/path/to/project/public/assets",
  );
  path.value = sourceDocument;
  setUiAttribute(
    path,
    "placeholder",
    "/absolute/path/to/placement.scene-authoring.json",
  );
  openProject.type = "button";
  setUiText(openProject, "Open Project");
  openProject.dataset.placementAction = "open-project-path";
  chooseProject.type = "button";
  setUiText(chooseProject, "Choose");
  chooseProject.dataset.placementAction = "browse-project-folder";
  useAssets.type = "button";
  setUiText(useAssets, "Use Assets");
  useAssets.dataset.placementAction = "open-asset-folder";
  chooseAssets.type = "button";
  setUiText(chooseAssets, "Choose");
  chooseAssets.dataset.placementAction = "browse-asset-folder";
  browse.type = "button";
  setUiText(browse, "Browse");
  browse.dataset.placementAction = "browse-scene-document";
  openPath.type = "button";
  setUiText(openPath, "Open Path");
  openPath.dataset.placementAction = "open-scene-document-path";
  sample.type = "button";
  setUiText(sample, "Sample");
  sample.dataset.placementAction = "open-sample-scene-document";
  projectRow.append(openProject, chooseProject);
  assetRow.append(useAssets, chooseAssets);
  documentRow.append(browse, openPath, sample);
  form.append(projectRow, assetRow, documentRow);
  const syncControls = () => {
    const currentProject = placementProjectInputValue();
    const currentAssetFolder = placementAssetFolderInputValue();
    const currentSource = placementDocumentSourceLabel(sourceDocument);
    if (document.activeElement !== projectPath) {
      projectPath.value = currentProject;
    }
    if (document.activeElement !== assetFolderPath) {
      assetFolderPath.value = currentAssetFolder;
    }
    if (document.activeElement !== path) {
      path.value = currentSource;
    }
    const desktopEnabled = placementDesktopInvoke() !== undefined;
    const dialogEnabled = placementDesktopOpenDialog() !== undefined;
    projectPath.disabled = !desktopEnabled;
    assetFolderPath.disabled = !desktopEnabled;
    path.disabled = !desktopEnabled;
    openProject.disabled =
      !desktopEnabled || projectPath.value.trim().length === 0;
    chooseProject.disabled = !dialogEnabled;
    useAssets.disabled =
      !desktopEnabled || assetFolderPath.value.trim().length === 0;
    chooseAssets.disabled = !dialogEnabled;
    browse.disabled = !dialogEnabled;
    openPath.disabled = !desktopEnabled || path.value.trim().length === 0;
    sample.disabled = !desktopEnabled;
  };
  form.addEventListener("submit", (event) => event.preventDefault());
  projectPath.addEventListener("input", syncControls);
  assetFolderPath.addEventListener("input", syncControls);
  path.addEventListener("input", syncControls);
  openProject.addEventListener("click", () => {
    const nextProjectPath = projectPath.value.trim();
    if (nextProjectPath.length > 0) {
      openPlacementProjectFolder(nextProjectPath);
    }
  });
  chooseProject.addEventListener("click", () => {
    void browsePlacementProjectFolder();
  });
  useAssets.addEventListener("click", () => {
    const nextAssetFolderPath = assetFolderPath.value.trim();
    if (nextAssetFolderPath.length > 0) {
      void inspectPlacementAssetFolder(nextAssetFolderPath);
    }
  });
  chooseAssets.addEventListener("click", () => {
    void browsePlacementAssetFolder();
  });
  browse.addEventListener("click", () => {
    void browsePlacementSceneDocument();
  });
  openPath.addEventListener("click", () => {
    const nextPath = path.value.trim();
    if (nextPath.length > 0) {
      openPlacementSceneDocument(nextPath);
    }
  });
  sample.addEventListener("click", () => {
    openPlacementSceneDocument();
  });

  return {
    element: form,
    setState: syncControls,
  };
}

function createPlacementTransformControls(
  options: Pick<PlacementInspectorOptions, "saveEnabled">,
): {
  element: HTMLFormElement;
  setState(
    state: ScenePlacementViewerState,
    migrationPreview?: ScenePlacementBindingMigrationPreview,
  ): void;
} {
  const form = document.createElement("form");
  const row = document.createElement("div");
  const snapRow = document.createElement("div");
  const fields = {
    x: appendNumberControl(row, "x", "x", "1"),
    y: appendNumberControl(row, "y", "y", "1"),
    scale: appendNumberControl(row, "scale", "scale", "0.05", "0.01"),
    rotationRadians: appendNumberControl(row, "rot", "rotationRadians", "0.01"),
    layer: appendNumberControl(row, "Render Layer", "layer", "1"),
    sortOrder: appendNumberControl(row, "Order in Layer", "sortOrder", "1"),
    depthSort: appendCheckboxControl(row, "Foot Position Sort", "depthSort"),
  };
  fields.depthSort.dataset.placementTransformField = "depthSort";
  setUiAttribute(fields.depthSort, "title", "Sort sprite feet inside this layer");
  setUiAttribute(fields.sortOrder, "title", "Break ties after foot sorting");
  appendCheckboxControl(snapRow, "snap", "snap");
  const grid = appendNumberControl(snapRow, "grid", "snapGrid", "1", "1");
  const save = document.createElement("button");
  const clear = document.createElement("button");

  form.className = "placement-controls";
  row.className = "placement-control-grid";
  snapRow.className = "placement-control-grid placement-control-grid-secondary";
  save.type = "button";
  setUiText(save, "Save");
  save.dataset.placementAction = "save-draft";
  clear.type = "button";
  setUiText(clear, "Revert");
  clear.dataset.placementAction = "clear-draft";
  grid.value = String(DEFAULT_SNAP_GRID_SIZE);
  grid.dataset.placementSnapGrid = "true";
  snapRow.append(save, clear);
  form.append(row, snapRow);
  form.addEventListener("submit", (event) => event.preventDefault());

  return {
    element: form,
    setState(state, migrationPreview) {
      const selected = state.selected;
      const disabled = selected === undefined || hasLockedSelection(state);
      for (const input of Object.values(fields)) {
        input.disabled = disabled;
      }
      fields.sortOrder.disabled = fields.depthSort.disabled = disabled || state.selectedInstanceIds.length > 1 || state.selected?.visual?.kind !== "sprite";
      const clean = state.draftPatch === undefined;
      const blockedByReferences =
        (migrationPreview?.references.length ?? 0) > 0;
      save.disabled = clean || !options.saveEnabled || blockedByReferences;
      save.dataset.blockedByReferences = String(blockedByReferences);
      clear.disabled = clean;
      if (selected === undefined) {
        fields.depthSort.checked = false;
        for (const input of Object.values(fields)) {
          input.value = "";
        }
        return;
      }
      setNumberInputValue(fields.x, selected.transform.x);
      setNumberInputValue(fields.y, selected.transform.y);
      setNumberInputValue(fields.scale, selected.transform.scale);
      setNumberInputValue(
        fields.rotationRadians,
        selected.transform.rotationRadians,
      );
      setNumberInputValue(fields.layer, placementRenderLayer(selected));
      setNumberInputValue(fields.sortOrder, selected.visual?.kind === "sprite" ? selected.visual.sortOrder ?? 0 : 0);
      fields.depthSort.checked = selected.visual?.kind === "sprite" && selected.visual.depthSort === "hd2d";
    },
  };
}

function createPlacementEditControls(
  resolved: ResolvedSceneAuthoringDocument,
  assetProvider: PlacementAssetProviderGetter,
): {
  element: HTMLFormElement;
  placementElement: HTMLFormElement;
  setState(state: ScenePlacementViewerState): void;
} {
  const form = document.createElement("form");
  const placementForm = document.createElement("form");
  placementForm.className = "placement-controls placement-add-controls";
  placementForm.addEventListener("submit", (event) => event.preventDefault());
  const row = document.createElement("div");
  const definitionRow = document.createElement("div");
  const addOptions = document.createElement("div");
  const palette = document.createElement("div");
  const rename = appendTextControl(row, "id", "rename");
  const definitionId = appendTextControl(
    definitionRow,
    "definition id",
    "definitionId",
  );
  const addId = appendTextControl(addOptions, "new id", "addId");
  const sprite = appendSelectControl(
    addOptions,
    "sprite",
    "addSprite",
    placementSpriteAssetOptions(assetProvider()),
  );
  const spriteFrame = appendSelectControl(
    addOptions,
    "frame",
    "addSpriteFrame",
    [],
  );
  const prefab = appendSelectControl(
    addOptions,
    "prefab",
    "addPrefab",
    placementPrefabOptions(resolved),
  );
  const spritePreview = createPlacementSpriteAssetPreview();
  const renameButton = document.createElement("button");
  const definitionButton = document.createElement("button");
  const removeButton = document.createElement("button");
  const duplicateButton = document.createElement("button");
  duplicateButton.type = "button";
  setUiText(duplicateButton, "Duplicate");
  duplicateButton.dataset.placementAction = "duplicate-selected";
  form.className = "placement-controls placement-edit-controls";
  row.className = "placement-control-grid placement-control-grid-edit";
  definitionRow.className =
    "placement-control-grid placement-control-grid-definition";
  addOptions.className = "placement-control-grid placement-add-options";
  palette.className = "placement-add-palette";
  renameButton.type = "button";
  setUiText(renameButton, "Rename");
  renameButton.dataset.placementAction = "rename-selected";
  definitionButton.type = "button";
  setUiText(definitionButton, "Create Definition");
  definitionButton.dataset.placementAction = "create-object-definition";
  removeButton.type = "button";
  setUiText(removeButton, "Remove");
  removeButton.dataset.placementAction = "remove-selected";
  setUiAttribute(addId, "placeholder", "auto");
  const addRotation = document.createElement("input"),
    addScale = document.createElement("input"),
    addRepeat = document.createElement("input");
  addRotation.type = addScale.type = "number";
  addRotation.value = "0";
  addScale.value = "1";
  addScale.min = "0.01";
  addScale.max = "100";
  addScale.step = "0.1";
  setUiAttribute(addRotation, "aria-label", "Placement rotation degrees");
  setUiAttribute(addScale, "aria-label", "Placement scale");
  addRotation.dataset.placementAddRotation = "true";
  addScale.dataset.placementAddScale = "true";
  addRepeat.type = "checkbox";
  addRepeat.dataset.placementRepeat = "true";
  const repeatLabel = document.createElement("label");
  repeatLabel.append(addRepeat, uiText(" Keep Placing"));
  for (const [title, input] of [
    ["Rotation (°)", addRotation],
    ["Scale (×)", addScale],
  ] as const) {
    const label = document.createElement("label");
    label.className = "placement-field-label";
    label.append(uiText(title), input);
    addOptions.append(label);
  }
  repeatLabel.className = "placement-inline-checkbox";
  addOptions.append(repeatLabel);
  sprite.value = defaultPlacementSpriteAsset(assetProvider());
  syncPlacementSpriteFrameOptions(spriteFrame, assetProvider(), sprite.value);
  updatePlacementSpriteAssetPreview(
    spritePreview,
    assetProvider(),
    sprite.value,
    spriteFrame.value,
  );
  prefab.value =
    prefab.querySelector<HTMLOptionElement>("option[value='crate']") === null
      ? prefab.value
      : "crate";
  for (const [label, action] of [
    ["Rect", "add-rect"],
    ["Circle", "add-circle"],
    ["Point", "add-point"],
    ["Sprite", "add-sprite"],
    ["Prefab", "add-prefab"],
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    setUiText(button, label);
    button.dataset.placementAction = action;
    palette.append(button);
  }
  row.append(renameButton, removeButton, duplicateButton);
  definitionRow.append(definitionButton);
  addOptions.append(spritePreview);
  form.append(row, definitionRow);
  placementForm.append(addOptions, palette);
  spritePreview.draggable = true;
  setUiAttribute(spritePreview, "title", "Drag sprite into the viewport");
  spritePreview.addEventListener("dragstart", (event) => {
    if (
      !event.dataTransfer ||
      !assetProvider().resolveSpriteAsset(sprite.value)
    ) {
      event.preventDefault();
      return;
    }
    placementAssetDrag = {
      token: crypto.randomUUID(),
      source: placementForm,
      options: placementDraftOptionsFromControls(placementForm, "add-sprite"),
    };
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      PLACEMENT_ASSET_DRAG_TYPE,
      placementAssetDrag.token,
    );
  });
  form.addEventListener("submit", (event) => event.preventDefault());
  sprite.addEventListener("change", () => {
    syncPlacementSpriteFrameOptions(spriteFrame, assetProvider(), sprite.value);
    updatePlacementSpriteAssetPreview(
      spritePreview,
      assetProvider(),
      sprite.value,
      spriteFrame.value,
    );
  });
  spriteFrame.addEventListener("change", () => {
    updatePlacementSpriteAssetPreview(
      spritePreview,
      assetProvider(),
      sprite.value,
      spriteFrame.value,
    );
  });

  return {
    element: form,
    placementElement: placementForm,
    setState(state) {
      const currentAssetProvider = assetProvider();
      syncPlacementSpriteAssetOptions(sprite, currentAssetProvider);
      syncPlacementSpriteFrameOptions(
        spriteFrame,
        currentAssetProvider,
        sprite.value,
      );
      updatePlacementSpriteAssetPreview(
        spritePreview,
        currentAssetProvider,
        sprite.value,
        spriteFrame.value,
      );
      const selected = state.selected;
      const disabled = selected === undefined;
      syncPlacementPrefabOptions(prefab, state);
      rename.disabled = disabled;
      definitionId.disabled = disabled;
      renameButton.disabled = disabled;
      definitionButton.disabled = disabled || selected?.visual === undefined;
      removeButton.disabled = disabled || hasLockedSelection(state);
      duplicateButton.disabled = disabled || hasLockedSelection(state);
      addId.disabled = false;
      sprite.disabled = false;
      spriteFrame.disabled = false;
      prefab.disabled = false;
      if (document.activeElement !== rename) {
        rename.value = selected?.instanceId ?? "";
      }
      if (document.activeElement !== definitionId) {
        definitionId.value =
          selected === undefined
            ? ""
            : nextPlacementObjectDefinitionId(state, selected.instanceId);
      }
    },
  };
}

function createPlacementBehaviorBindingControls(
  resolved: ResolvedSceneAuthoringDocument,
): {
  element: HTMLFormElement;
  setState(state: ScenePlacementViewerState): void;
} {
  const form = document.createElement("form");
  const row = document.createElement("div");
  const recipes = Object.keys(resolved.behaviorRecipes.entities);
  const recipe = appendSelectControl(
    row,
    "recipe",
    "behaviorRecipe",
    recipes.length === 0 ? [""] : recipes,
  );
  const attach = document.createElement("button");
  const detach = document.createElement("button");

  form.className = "placement-controls placement-behavior-controls";
  row.className = "placement-control-grid placement-behavior-grid";
  attach.type = "button";
  setUiText(attach, "Attach");
  attach.dataset.placementAction = "attach-behavior-binding";
  detach.type = "button";
  setUiText(detach, "Detach");
  detach.dataset.placementAction = "detach-behavior-binding";
  row.append(attach, detach);
  form.append(row);
  form.addEventListener("submit", (event) => event.preventDefault());

  return {
    element: form,
    setState(state) {
      const selected = state.selected;
      const disabled = selected === undefined || recipes.length === 0;
      recipe.disabled = disabled;
      attach.disabled = disabled;
      detach.disabled =
        selected === undefined || selected.behaviorProfiles.length === 0;
      if (selected === undefined) {
        recipe.value = recipes[0] ?? "";
        return;
      }
      const currentRecipe = selected.behaviorProfiles[0];
      if (currentRecipe !== undefined && recipes.includes(currentRecipe)) {
        recipe.value = currentRecipe;
      } else if (!recipes.includes(recipe.value)) {
        recipe.value = recipes[0] ?? "";
      }
    },
  };
}

function createPlacementSpriteAssetPreview(): HTMLElement {
  const preview = document.createElement("div");
  const image = document.createElement("div");
  const label = document.createElement("span");
  preview.className = "placement-asset-preview";
  preview.dataset.placementSpritePreview = "true";
  image.className = "placement-asset-preview-image";
  label.className = "placement-asset-preview-label";
  preview.append(image, label);
  return preview;
}

function updatePlacementSpriteAssetPreview(
  preview: HTMLElement,
  assetProvider: ScenePlacementAssetProvider,
  assetId: string,
  frameId?: string,
): void {
  const asset = assetProvider.resolveSpriteAsset(assetId);
  const frame =
    frameId === undefined || frameId.length === 0
      ? undefined
      : assetProvider.resolveSpriteFrame(assetId, frameId);
  const image = preview.querySelector<HTMLElement>(
    ".placement-asset-preview-image",
  );
  const label = preview.querySelector<HTMLElement>(
    ".placement-asset-preview-label",
  );
  preview.dataset.assetId = asset?.id ?? "";
  preview.dataset.frameId = frame?.id ?? "";
  if (image !== null) {
    const thumbnailUrl = frame?.thumbnailUrl ?? asset?.thumbnailUrl;
    image.style.backgroundImage =
      thumbnailUrl === undefined ? "" : `url("${thumbnailUrl}")`;
  }
  if (label !== null) {
    const width = frame?.width ?? asset?.width;
    const height = frame?.height ?? asset?.height;
    const size =
      width === undefined || height === undefined ? "" : ` ${width}x${height}`;
    const frameLabel =
      frame === undefined ? "" : ` / ${frame.label ?? frame.id}`;
    label.textContent =
      asset === undefined
        ? "Missing asset"
        : `${asset.label ?? asset.id}${frameLabel}${size}`;
  }
}

function syncPlacementSpriteFrameOptions(
  select: HTMLSelectElement,
  assetProvider: ScenePlacementAssetProvider,
  assetId: string,
): void {
  const frames = assetProvider.listSpriteFrames(assetId);
  const current = select.value;
  const frameIds = frames.map((frame) => frame.id);
  const previous = Array.from(select.options).map((option) => option.value);
  const next = ["", ...frameIds];
  if (
    previous.length === next.length &&
    previous.every((id, index) => id === next[index])
  ) {
    return;
  }
  const options: HTMLOptionElement[] = [];
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  setUiText(defaultOption, "default");
  options.push(defaultOption);
  for (const frame of frames) {
    const option = document.createElement("option");
    option.value = frame.id;
    option.textContent = frame.label ?? frame.id;
    options.push(option);
  }
  select.replaceChildren(...options);
  select.value =
    current.length > 0 && frameIds.includes(current)
      ? current
      : (frames[0]?.id ?? "");
}

function createPlacementComponentControls(summaries: {
  visualDetails: HTMLDListElement;
  colliderDetails: HTMLDListElement;
}): {
  element: HTMLFormElement;
  setState(state: ScenePlacementViewerState): void;
} {
  const form = document.createElement("form");
  const visualRow = document.createElement("div");
  const colliderRow = document.createElement("div");
  const actionRow = document.createElement("div");
  const fields = {
    visualKind: appendComponentSelectControl(
      visualRow,
      "visual",
      "visualKind",
      ["primitive", "sprite"],
    ),
    primitiveShape: appendComponentSelectControl(
      visualRow,
      "shape",
      "primitiveShape",
      ["rect", "circle", "point"],
    ),
    visualWidth: appendComponentNumberControl(
      visualRow,
      "width",
      "visualWidth",
      "1",
      "1",
    ),
    visualHeight: appendComponentNumberControl(
      visualRow,
      "height",
      "visualHeight",
      "1",
      "1",
    ),
    visualRadius: appendComponentNumberControl(
      visualRow,
      "radius",
      "visualRadius",
      "1",
      "1",
    ),
    visualColor: appendComponentColorControl(visualRow, "color", "visualColor"),
    colliderType: appendComponentSelectControl(
      colliderRow,
      "collider",
      "colliderType",
      ["none", "aabb", "circle", "capsule", "orientedBox", "convexPolygon"],
    ),
    colliderWidth: appendComponentNumberControl(
      colliderRow,
      "collider w",
      "colliderWidth",
      "1",
      "1",
    ),
    colliderHeight: appendComponentNumberControl(
      colliderRow,
      "collider h",
      "colliderHeight",
      "1",
      "1",
    ),
    colliderRadius: appendComponentNumberControl(
      colliderRow,
      "collider r",
      "colliderRadius",
      "1",
      "1",
    ),
    colliderStartX: appendComponentNumberControl(
      colliderRow,
      "start x",
      "colliderStartX",
      "1",
    ),
    colliderStartY: appendComponentNumberControl(
      colliderRow,
      "start y",
      "colliderStartY",
      "1",
    ),
    colliderEndX: appendComponentNumberControl(
      colliderRow,
      "end x",
      "colliderEndX",
      "1",
    ),
    colliderEndY: appendComponentNumberControl(
      colliderRow,
      "end y",
      "colliderEndY",
      "1",
    ),
    colliderRotation: appendComponentNumberControl(
      colliderRow,
      "rotation",
      "colliderRotation",
      "0.01",
    ),
    colliderVertices: appendComponentTextareaControl(
      colliderRow,
      "vertices",
      "colliderVertices",
    ),
    colliderOffsetX: appendComponentNumberControl(
      colliderRow,
      "offset x",
      "colliderOffsetX",
      "1",
    ),
    colliderOffsetY: appendComponentNumberControl(
      colliderRow,
      "offset y",
      "colliderOffsetY",
      "1",
    ),
    colliderEnabled: appendComponentCheckboxControl(
      colliderRow,
      "enabled",
      "colliderEnabled",
    ),
    colliderTrigger: appendComponentCheckboxControl(
      colliderRow,
      "trigger",
      "colliderTrigger",
    ),
    layer: appendComponentSelectControl(
      colliderRow,
      "Collision Group",
      "layer",
      PLACEMENT_COLLISION_LAYERS,
    ),
  };
  const apply = document.createElement("button");
  let syncedInstanceId: string | undefined;

  form.className = "placement-controls placement-component-controls";
  visualRow.className = "placement-control-grid placement-component-grid";
  colliderRow.className = "placement-control-grid placement-component-grid";
  actionRow.className = "placement-component-actions";
  apply.type = "button";
  setUiText(apply, "Apply Components");
  apply.dataset.placementAction = "apply-components";
  actionRow.append(apply);
  form.append(
    createPlacementInspectorSection(
      "Visual",
      createPlacementInspectorSectionBody(summaries.visualDetails, visualRow),
    ),
    createPlacementInspectorSection(
      "Collider",
      createPlacementInspectorSectionBody(
        summaries.colliderDetails,
        colliderRow,
      ),
    ),
    actionRow,
  );
  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("input", () =>
    syncPlacementComponentFieldState(fields),
  );
  form.addEventListener("change", () =>
    syncPlacementComponentFieldState(fields),
  );

  return {
    element: form,
    setState(state) {
      const selected = state.selected;
      const disabled = selected === undefined;
      apply.disabled = disabled;
      for (const field of Object.values(fields)) {
        field.disabled = disabled;
      }
      if (selected === undefined) {
        syncedInstanceId = undefined;
        clearPlacementComponentFields(fields);
        return;
      }
      if (
        syncedInstanceId !== selected.instanceId ||
        !form.contains(document.activeElement)
      ) {
        syncedInstanceId = selected.instanceId;
        populatePlacementComponentFields(fields, selected);
      }
      syncPlacementComponentFieldState(fields);
    },
  };
}

interface PlacementComponentControlFields {
  visualKind: HTMLSelectElement;
  primitiveShape: HTMLSelectElement;
  visualWidth: HTMLInputElement;
  visualHeight: HTMLInputElement;
  visualRadius: HTMLInputElement;
  visualColor: HTMLInputElement;
  colliderType: HTMLSelectElement;
  colliderWidth: HTMLInputElement;
  colliderHeight: HTMLInputElement;
  colliderRadius: HTMLInputElement;
  colliderStartX: HTMLInputElement;
  colliderStartY: HTMLInputElement;
  colliderEndX: HTMLInputElement;
  colliderEndY: HTMLInputElement;
  colliderRotation: HTMLInputElement;
  colliderVertices: HTMLTextAreaElement;
  colliderOffsetX: HTMLInputElement;
  colliderOffsetY: HTMLInputElement;
  colliderEnabled: HTMLInputElement;
  colliderTrigger: HTMLInputElement;
  layer: HTMLSelectElement;
}

function populatePlacementComponentFields(
  fields: PlacementComponentControlFields,
  selected: ScenePlacementViewerInstance,
): void {
  const visual = selected.visual;
  if (visual?.kind === "sprite") {
    fields.visualKind.value = "sprite";
    fields.primitiveShape.value = "rect";
    setNumberInputValue(fields.visualWidth, visual.width);
    setNumberInputValue(fields.visualHeight, visual.height);
    setNumberInputValue(
      fields.visualRadius,
      Math.max(1, Math.min(visual.width, visual.height) * 0.5),
    );
    fields.visualColor.value = normalizedPlacementColor(
      visual.tint ?? visual.color ?? DEFAULT_PRIMITIVE_COLOR,
    );
  } else {
    const primitive = visual?.kind === "primitive" ? visual : undefined;
    const shape = primitive?.shape ?? "rect";
    fields.visualKind.value = "primitive";
    fields.primitiveShape.value = shape;
    setNumberInputValue(fields.visualWidth, primitive?.width ?? 48);
    setNumberInputValue(
      fields.visualHeight,
      primitive?.height ?? (shape === "rect" ? 32 : (primitive?.width ?? 48)),
    );
    setNumberInputValue(
      fields.visualRadius,
      primitive?.radius ?? Math.max(1, (primitive?.width ?? 36) * 0.5),
    );
    fields.visualColor.value = normalizedPlacementColor(
      primitive?.color ??
        (shape === "point" ? DEFAULT_POINT_COLOR : DEFAULT_PRIMITIVE_COLOR),
    );
  }

  const collider = selected.collider;
  fields.colliderType.value = placementComponentColliderType(collider);
  populatePlacementDefaultColliderFields(fields, visual);
  if (collider?.type === "aabb") {
    setNumberInputValue(fields.colliderWidth, collider.halfWidth * 2);
    setNumberInputValue(fields.colliderHeight, collider.halfHeight * 2);
    setNumberInputValue(
      fields.colliderRadius,
      Math.max(1, Math.min(collider.halfWidth, collider.halfHeight)),
    );
  } else if (collider?.type === "circle") {
    setNumberInputValue(fields.colliderWidth, collider.radius * 2);
    setNumberInputValue(fields.colliderHeight, collider.radius * 2);
    setNumberInputValue(fields.colliderRadius, collider.radius);
  } else if (collider?.type === "capsule") {
    setNumberInputValue(fields.colliderRadius, collider.radius);
    setNumberInputValue(fields.colliderStartX, collider.startX);
    setNumberInputValue(fields.colliderStartY, collider.startY);
    setNumberInputValue(fields.colliderEndX, collider.endX);
    setNumberInputValue(fields.colliderEndY, collider.endY);
  } else if (collider?.type === "orientedBox") {
    setNumberInputValue(fields.colliderWidth, collider.halfWidth * 2);
    setNumberInputValue(fields.colliderHeight, collider.halfHeight * 2);
    setNumberInputValue(
      fields.colliderRadius,
      Math.max(1, Math.min(collider.halfWidth, collider.halfHeight)),
    );
    setNumberInputValue(fields.colliderRotation, collider.rotationRadians);
  } else if (collider?.type === "convexPolygon") {
    setNumberInputValue(fields.colliderRotation, collider.rotationRadians);
    fields.colliderVertices.value = formatPlacementColliderVertices(
      collider.vertices,
    );
  }
  if (collider !== undefined && collider.type !== "none") {
    setNumberInputValue(fields.colliderOffsetX, collider.offsetX);
    setNumberInputValue(fields.colliderOffsetY, collider.offsetY);
    fields.colliderEnabled.checked = collider.enabled;
    fields.colliderTrigger.checked = collider.isTrigger;
  } else {
    setNumberInputValue(fields.colliderOffsetX, 0);
    setNumberInputValue(fields.colliderOffsetY, 0);
    fields.colliderEnabled.checked = true;
    fields.colliderTrigger.checked = false;
  }
  fields.layer.value = selected.componentLayer?.name ?? "wall";
}

function placementComponentColliderType(
  collider: ResolvedDataSceneColliderComponent | undefined,
): PlacementComponentColliderType {
  if (collider === undefined) {
    return "none";
  }
  return collider.type;
}

function populatePlacementDefaultColliderFields(
  fields: PlacementComponentControlFields,
  visual: ResolvedDataSceneObjectVisual | undefined,
): void {
  const width = visual?.bounds.width ?? 32;
  const height = visual?.bounds.height ?? width;
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;
  const radius = Math.max(1, Math.min(width, height) * 0.5);
  setNumberInputValue(fields.colliderWidth, width);
  setNumberInputValue(fields.colliderHeight, height);
  setNumberInputValue(fields.colliderRadius, radius);
  setNumberInputValue(fields.colliderStartX, 0);
  setNumberInputValue(fields.colliderStartY, -Math.max(1, height * 0.25));
  setNumberInputValue(fields.colliderEndX, 0);
  setNumberInputValue(fields.colliderEndY, Math.max(1, height * 0.25));
  setNumberInputValue(fields.colliderRotation, 0);
  fields.colliderVertices.value = formatPlacementColliderVertices([
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ]);
}

function formatPlacementColliderVertices(
  vertices: readonly { readonly x: number; readonly y: number }[],
): string {
  return JSON.stringify(
    vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
  );
}

function clearPlacementComponentFields(
  fields: PlacementComponentControlFields,
): void {
  fields.visualKind.value = "primitive";
  fields.primitiveShape.value = "rect";
  fields.visualWidth.value = "";
  fields.visualHeight.value = "";
  fields.visualRadius.value = "";
  fields.visualColor.value = DEFAULT_PRIMITIVE_COLOR;
  fields.colliderType.value = "none";
  fields.colliderWidth.value = "";
  fields.colliderHeight.value = "";
  fields.colliderRadius.value = "";
  fields.colliderStartX.value = "";
  fields.colliderStartY.value = "";
  fields.colliderEndX.value = "";
  fields.colliderEndY.value = "";
  fields.colliderRotation.value = "";
  fields.colliderVertices.value = "";
  fields.colliderOffsetX.value = "";
  fields.colliderOffsetY.value = "";
  fields.colliderEnabled.checked = true;
  fields.colliderTrigger.checked = false;
  fields.layer.value = "wall";
}

function syncPlacementComponentFieldState(
  fields: PlacementComponentControlFields,
): void {
  const visualKind = fields.visualKind.value as PlacementComponentVisualKind;
  const primitiveShape = fields.primitiveShape
    .value as DataScenePrimitiveVisualShape;
  const colliderType = fields.colliderType
    .value as PlacementComponentColliderType;
  fields.primitiveShape.disabled =
    fields.visualKind.disabled || visualKind !== "primitive";
  fields.visualWidth.disabled =
    fields.visualKind.disabled ||
    (visualKind === "primitive" && primitiveShape === "circle");
  fields.visualHeight.disabled =
    fields.visualKind.disabled ||
    (visualKind === "primitive" && primitiveShape !== "rect");
  fields.visualRadius.disabled =
    fields.visualKind.disabled ||
    visualKind !== "primitive" ||
    primitiveShape !== "circle";
  fields.colliderWidth.disabled =
    fields.colliderType.disabled ||
    (colliderType !== "aabb" && colliderType !== "orientedBox");
  fields.colliderHeight.disabled =
    fields.colliderType.disabled ||
    (colliderType !== "aabb" && colliderType !== "orientedBox");
  fields.colliderRadius.disabled =
    fields.colliderType.disabled ||
    (colliderType !== "circle" && colliderType !== "capsule");
  fields.colliderStartX.disabled =
    fields.colliderType.disabled || colliderType !== "capsule";
  fields.colliderStartY.disabled =
    fields.colliderType.disabled || colliderType !== "capsule";
  fields.colliderEndX.disabled =
    fields.colliderType.disabled || colliderType !== "capsule";
  fields.colliderEndY.disabled =
    fields.colliderType.disabled || colliderType !== "capsule";
  fields.colliderRotation.disabled =
    fields.colliderType.disabled ||
    (colliderType !== "orientedBox" && colliderType !== "convexPolygon");
  fields.colliderVertices.disabled =
    fields.colliderType.disabled || colliderType !== "convexPolygon";
  fields.colliderOffsetX.disabled =
    fields.colliderType.disabled || colliderType === "none";
  fields.colliderOffsetY.disabled =
    fields.colliderType.disabled || colliderType === "none";
  fields.colliderEnabled.disabled =
    fields.colliderType.disabled || colliderType === "none";
  fields.colliderTrigger.disabled =
    fields.colliderType.disabled || colliderType === "none";
}

function installPlacementSelection(
  root: HTMLElement,
  viewer: ScenePlacementViewer,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }
    if (target.dataset.placementLockInstance) {
      documentSession?.finishEdit();
      const id = target.dataset.placementLockInstance;
      setState(
        viewer.setInstancesLocked(
          [id],
          !viewer.state().lockedInstanceIds.includes(id),
        ),
      );
      return;
    }
    const instanceId = target.dataset.instanceId;
    if (instanceId === undefined) {
      return;
    }
    if (event.shiftKey && viewer.state().selectedInstanceId) {
      const state = viewer.state(),
        ids = state.instances.map((instance) => instance.instanceId);
      const from = ids.indexOf(state.selectedInstanceId!),
        to = ids.indexOf(instanceId);
      setState(
        viewer.selectInstances(
          [
            ...state.selectedInstanceIds,
            ...ids.slice(Math.min(from, to), Math.max(from, to) + 1),
          ]
            .filter((id) => id !== instanceId)
            .concat(instanceId),
        ),
      );
    } else if (event.ctrlKey || event.metaKey)
      setState(togglePlacementSelection(viewer, instanceId));
    else setState(viewer.selectInstance(instanceId));
  });
}

function installPlacementTransformControls(
  root: HTMLElement,
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
  save: PlacementSaveControls,
): void {
  root.addEventListener("input", (event) => {
    try {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }
      if (target.dataset.placementSnapToggle === "true") {
        interaction.enabled = target.checked;
        publishPlacementInteraction(interaction);
        if (interaction.enabled) {
          snapSelectedInstance(viewer, interaction, setState);
        }
        return;
      }
      if (target.dataset.placementSnapGrid === "true") {
        const value = numberInputValue(target);
        if (value !== undefined && value > 0) {
          interaction.gridSize = value;
          publishPlacementInteraction(interaction);
          if (interaction.enabled) {
            snapSelectedInstance(viewer, interaction, setState);
          } else {
            setState(viewer.state());
          }
        }
        return;
      }
      const field = target.dataset.placementTransformField;
      if (field !== undefined) {
        applyTransformInput(viewer, interaction, field, target, setState);
      }
    } catch (error) {
      reportPlacementEditFailure(viewer, setState, error);
    }
  });

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }
    if (target.dataset.placementAction === "clear-draft") {
      try {
        setState(viewer.clearDraftPatch());
      } catch (error) {
        reportPlacementEditFailure(viewer, setState, error);
      }
      return;
    }
    if (target.dataset.placementAction === "save-draft") {
      void save.saveDraft();
    }
  });
}

function installPlacementEditControls(
  root: HTMLElement,
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  assetProvider: PlacementAssetProviderGetter,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  const invalidatePlacementTool = (event: Event) => {
    if (
      !(event.target instanceof Element) ||
      !event.target.matches(
        "[data-placement-add-sprite], [data-placement-add-sprite-frame], [data-placement-add-prefab], [data-placement-add-rotation], [data-placement-add-scale]",
      ) ||
      (!interaction.pendingAdd && !placementAssetDrag)
    )
      return;
    // The ghost and card refer to the captured asset/settings. Require an
    // explicit re-arm rather than committing different live control values.
    resetPlacementAdd(interaction);
    setState(viewer.state());
  };
  root.addEventListener("input", invalidatePlacementTool);
  root.addEventListener("change", invalidatePlacementTool);
  root.addEventListener("click", (event) => {
    try {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) {
        return;
      }
      if (target.dataset.placementAction === "rename-selected") {
        const selected = viewer.state().selected;
        const input = root.querySelector<HTMLInputElement>(
          "input[data-placement-rename-id='true']",
        );
        const nextInstanceId = input?.value.trim();
        if (
          selected !== undefined &&
          nextInstanceId !== undefined &&
          nextInstanceId.length > 0
        ) {
          setState(viewer.renameInstance(selected.instanceId, nextInstanceId));
        }
        return;
      }
      if (target.dataset.placementAction === "create-object-definition") {
        const selected = viewer.state().selected;
        const input = root.querySelector<HTMLInputElement>(
          "input[data-placement-definition-id='true']",
        );
        const definitionId = input?.value.trim();
        if (
          selected === undefined ||
          definitionId === undefined ||
          definitionId.length === 0
        ) {
          return;
        }
        try {
          clearPlacementDefinitionError(root);
          const state = viewer.addObjectDefinition(
            definitionId,
            placementObjectDefinitionFromSelected(selected),
          );
          setState(state);
        } catch (error) {
          reportPlacementDefinitionError(root, error);
        }
        return;
      }
      if (target.dataset.placementAction === "remove-selected") {
        const state = viewer.state();
        if (!hasLockedSelection(state)) {
          setState(viewer.removeInstances(state.selectedInstanceIds));
        }
        return;
      }
      if (target.dataset.placementAction === "duplicate-selected") {
        documentSession?.finishEdit();
        setState(viewer.duplicateInstances(viewer.state().selectedInstanceIds));
        return;
      }
      if (target.dataset.placementAction === "attach-behavior-binding") {
        const selected = viewer.state().selected;
        const recipe = root
          .querySelector<HTMLSelectElement>(
            "select[data-placement-behavior-recipe='true']",
          )
          ?.value.trim();
        if (
          selected !== undefined &&
          recipe !== undefined &&
          recipe.length > 0
        ) {
          setState(
            viewer.updateBehaviorBinding(
              { kind: "instance", instanceId: selected.instanceId },
              recipe,
            ),
          );
        }
        return;
      }
      if (target.dataset.placementAction === "detach-behavior-binding") {
        const selected = viewer.state().selected;
        if (selected !== undefined) {
          setState(
            viewer.updateBehaviorBinding(
              { kind: "instance", instanceId: selected.instanceId },
              null,
            ),
          );
        }
        return;
      }
      const addAction = target.dataset.placementAction;
      if (
        addAction === "add-rect" ||
        addAction === "add-circle" ||
        addAction === "add-point" ||
        addAction === "add-sprite" ||
        addAction === "add-prefab"
      ) {
        const draftOptions = placementDraftOptionsFromControls(root, addAction);
        interaction.pendingAdd = addAction;
        interaction.pendingAddPreview = placementPendingAddPreview(
          addAction,
          assetProvider(),
          draftOptions,
        );
        publishPlacementInteraction(interaction);
        setState(viewer.state());
      }
    } catch (error) {
      reportPlacementEditFailure(viewer, setState, error);
    }
  });
}

function reportPlacementEditFailure(
  viewer: ScenePlacementViewer,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
  error: unknown,
): void {
  setState(viewer.state());
  window.dispatchEvent(
    new CustomEvent("ferrum-placement-document-error", {
      detail: placementErrorMessage(error),
    }),
  );
}

function installPlacementComponentControls(
  root: HTMLElement,
  viewer: ScenePlacementViewer,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (
      !(target instanceof HTMLButtonElement) ||
      target.dataset.placementAction !== "apply-components"
    ) {
      return;
    }
    const selected = viewer.state().selected;
    if (selected === undefined) {
      return;
    }
    try {
      const components = placementComponentsPatchFromControls(root, selected);
      setState(
        viewer.updateInstanceComponents(selected.instanceId, components),
      );
    } catch (error) {
      reportPlacementComponentError(root, error);
    }
  });
}

function placementComponentsPatchFromControls(
  root: HTMLElement,
  selected: ScenePlacementViewerInstance,
): Parameters<ScenePlacementViewer["updateInstanceComponents"]>[1] {
  const visual = placementVisualPatchFromControls(root, selected);
  const collider = placementColliderPatchFromControls(root, selected.collider);
  const layer = selectedPlacementComponentLayer(root);
  return {
    visual,
    collider,
    layer,
    ...placementBodyPatch(selected),
  };
}

function placementVisualPatchFromControls(
  root: HTMLElement,
  selected: ScenePlacementViewerInstance,
): PlacementJsonObject {
  const visualKind = selectedPlacementComponentValue(root, "visualKind") as
    | PlacementComponentVisualKind
    | undefined;
  const width = positivePlacementComponentNumber(
    root,
    "visualWidth",
    "visual width",
  );
  const height = positivePlacementComponentNumber(
    root,
    "visualHeight",
    "visual height",
  );
  const radius = positivePlacementComponentNumber(
    root,
    "visualRadius",
    "visual radius",
  );
  const color =
    selectedPlacementComponentValue(root, "visualColor") ??
    DEFAULT_PRIMITIVE_COLOR;
  if (visualKind === "sprite") {
    return spriteVisualPatch(selected.visual, width, height, color);
  }
  const shape = selectedPlacementComponentValue(root, "primitiveShape") as
    | DataScenePrimitiveVisualShape
    | undefined;
  const primitiveShape = shape ?? "rect";
  if (primitiveShape === "circle") {
    return {
      kind: "primitive",
      shape: primitiveShape,
      radius,
      ...placementVisualColorPatch(selected.visual, color, false),
    };
  }
  if (primitiveShape === "point") {
    return {
      kind: "primitive",
      shape: primitiveShape,
      width,
      ...placementVisualColorPatch(selected.visual, color, false),
    };
  }
  return {
    kind: "primitive",
    shape: "rect",
    width,
    height,
    ...placementVisualColorPatch(selected.visual, color, false),
  };
}

function spriteVisualPatch(
  currentVisual: ResolvedDataSceneObjectVisual | undefined,
  width: number,
  height: number,
  color: string,
): PlacementJsonObject {
  if (currentVisual?.kind === "sprite") {
    const texture: PlacementJsonObject =
      currentVisual.texture.kind === "asset"
        ? {
            asset:
              currentVisual.texture.name ?? String(currentVisual.texture.value),
          }
        : { texture: currentVisual.texture.id ?? currentVisual.texture.value };
    return {
      kind: "sprite",
      ...texture,
      width,
      height,
      frame: spriteFramePatch(currentVisual.frame),
      ...(currentVisual.animation === undefined
        ? {}
        : {
            animation: {
              frameCount: currentVisual.animation.frameCount,
              fps: currentVisual.animation.fps,
            },
          }),
      originX: currentVisual.originX,
      originY: currentVisual.originY,
      ...(currentVisual.layer === undefined
        ? {}
        : { layer: currentVisual.layer }),
      ...(currentVisual.sortOrder === undefined
        ? {}
        : { sortOrder: currentVisual.sortOrder }),
      ...(currentVisual.depthSort === undefined
        ? {}
        : { depthSort: currentVisual.depthSort }),
      ...placementVisualColorPatch(currentVisual, color),
    };
  }
  return {
    kind: "sprite",
    asset: "crate",
    width,
    height,
    originX: 0.5,
    originY: 0.5,
    color,
  };
}

function placementVisualColorPatch(
  visual: ResolvedDataSceneObjectVisual | undefined,
  color: string,
  preserveTint = true,
): PlacementJsonObject {
  const tint = visual?.kind === "sprite" ? visual.tint : undefined;
  const original = tint ?? visual?.color;
  if (color === normalizedPlacementColor(original ?? DEFAULT_PRIMITIVE_COLOR)) {
    if (!preserveTint) return original === undefined ? {} : { color: original };
    return {
      ...(tint === undefined ? {} : { tint }),
      ...(visual?.color === undefined ? {} : { color: visual.color }),
    };
  }
  return { color };
}

function spriteFramePatch(
  frame: ResolvedDataSceneSpriteFrame,
): PlacementJsonObject {
  return {
    u0: frame.u0,
    v0: frame.v0,
    u1: frame.u1,
    v1: frame.v1,
  };
}

function placementColliderPatchFromControls(
  root: HTMLElement,
  currentCollider: ResolvedDataSceneColliderComponent | undefined,
): PlacementJsonValue {
  const type = selectedPlacementComponentValue(root, "colliderType") as
    | PlacementComponentColliderType
    | undefined;
  if (type === "none" || type === undefined) {
    return "none";
  }
  const base = placementColliderBasePatch(root, currentCollider);
  if (type === "circle") {
    return {
      type,
      ...base,
      radius: positivePlacementComponentNumber(
        root,
        "colliderRadius",
        "collider radius",
      ),
    };
  }
  switch (type) {
    case "aabb":
      return {
        type,
        ...base,
        halfWidth:
          positivePlacementComponentNumber(
            root,
            "colliderWidth",
            "collider width",
          ) * 0.5,
        halfHeight:
          positivePlacementComponentNumber(
            root,
            "colliderHeight",
            "collider height",
          ) * 0.5,
      };
    case "capsule":
      return {
        type,
        ...base,
        startX: finitePlacementComponentNumber(
          root,
          "colliderStartX",
          "capsule start x",
          0,
        ),
        startY: finitePlacementComponentNumber(
          root,
          "colliderStartY",
          "capsule start y",
          -8,
        ),
        endX: finitePlacementComponentNumber(
          root,
          "colliderEndX",
          "capsule end x",
          0,
        ),
        endY: finitePlacementComponentNumber(
          root,
          "colliderEndY",
          "capsule end y",
          8,
        ),
        radius: positivePlacementComponentNumber(
          root,
          "colliderRadius",
          "capsule radius",
        ),
      };
    case "orientedBox":
      return {
        type,
        ...base,
        halfWidth:
          positivePlacementComponentNumber(
            root,
            "colliderWidth",
            "oriented box width",
          ) * 0.5,
        halfHeight:
          positivePlacementComponentNumber(
            root,
            "colliderHeight",
            "oriented box height",
          ) * 0.5,
        rotationRadians: finitePlacementComponentNumber(
          root,
          "colliderRotation",
          "oriented box rotation",
          0,
        ),
      };
    case "convexPolygon":
      return {
        type,
        ...base,
        vertices: placementColliderVerticesPatchFromControls(root),
        rotationRadians: finitePlacementComponentNumber(
          root,
          "colliderRotation",
          "convex polygon rotation",
          0,
        ),
      };
  }
}

function placementColliderBasePatch(
  root: HTMLElement,
  currentCollider: ResolvedDataSceneColliderComponent | undefined,
): PlacementJsonObject {
  const enabled = checkedPlacementComponentValue(root, "colliderEnabled", true);
  const isTrigger = checkedPlacementComponentValue(
    root,
    "colliderTrigger",
    false,
  );
  return {
    offsetX: finitePlacementComponentNumber(
      root,
      "colliderOffsetX",
      "collider offset x",
      currentCollider !== undefined && currentCollider.type !== "none"
        ? currentCollider.offsetX
        : 0,
    ),
    offsetY: finitePlacementComponentNumber(
      root,
      "colliderOffsetY",
      "collider offset y",
      currentCollider !== undefined && currentCollider.type !== "none"
        ? currentCollider.offsetY
        : 0,
    ),
    enabled,
    isTrigger,
  };
}

function selectedPlacementComponentLayer(
  root: HTMLElement,
): DataSceneCollisionLayerName {
  const layer = selectedPlacementComponentValue(root, "layer");
  return PLACEMENT_COLLISION_LAYERS.includes(
    layer as DataSceneCollisionLayerName,
  )
    ? (layer as DataSceneCollisionLayerName)
    : "wall";
}

function positivePlacementComponentNumber(
  root: HTMLElement,
  field: string,
  label: string,
): number {
  const input = root.querySelector<HTMLInputElement>(
    `input[data-placement-component-field='${field}']`,
  );
  const value = input === null ? undefined : numberInputValue(input);
  if (value !== undefined && value > 0) {
    input?.setCustomValidity("");
    return value;
  }
  const message = `${label} must be a positive number.`;
  input?.setCustomValidity(message);
  input?.reportValidity();
  throw new Error(message);
}

function finitePlacementComponentNumber(
  root: HTMLElement,
  field: string,
  label: string,
  fallback: number,
): number {
  const input = root.querySelector<HTMLInputElement>(
    `input[data-placement-component-field='${field}']`,
  );
  const rawValue = input?.value.trim();
  if (rawValue === undefined || rawValue === "") {
    input?.setCustomValidity("");
    return fallback;
  }
  const value = Number(rawValue);
  if (Number.isFinite(value)) {
    input?.setCustomValidity("");
    return value;
  }
  const message = `${label} must be a finite number.`;
  input?.setCustomValidity(message);
  input?.reportValidity();
  throw new Error(message);
}

function placementColliderVerticesPatchFromControls(
  root: HTMLElement,
): readonly PlacementJsonObject[] {
  const input = root.querySelector<HTMLTextAreaElement>(
    "textarea[data-placement-component-field='colliderVertices']",
  );
  const rawValue = input?.value.trim();
  if (rawValue === undefined || rawValue === "") {
    const message = "convex polygon vertices must be a JSON array.";
    input?.setCustomValidity(message);
    input?.reportValidity();
    throw new Error(message);
  }
  let value: unknown;
  try {
    value = JSON.parse(rawValue);
  } catch {
    const message = "convex polygon vertices must be valid JSON.";
    input?.setCustomValidity(message);
    input?.reportValidity();
    throw new Error(message);
  }
  if (
    !Array.isArray(value) ||
    value.length < 3 ||
    value.length > DATA_SCENE_MAX_CONVEX_POLYGON_VERTICES
  ) {
    const message = `convex polygon vertices must contain 3-${DATA_SCENE_MAX_CONVEX_POLYGON_VERTICES} points.`;
    input?.setCustomValidity(message);
    input?.reportValidity();
    throw new Error(message);
  }
  const vertices = value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`convex polygon vertex ${index} must be an object.`);
    }
    const object = entry as Record<string, unknown>;
    const x = Number(object.x);
    const y = Number(object.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`convex polygon vertex ${index} must have finite x/y.`);
    }
    return { x, y };
  });
  input?.setCustomValidity("");
  return vertices;
}

function selectedPlacementComponentValue(
  root: HTMLElement,
  field: string,
): string | undefined {
  const control = root.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[data-placement-component-field='${field}']`,
  );
  const value = control?.value.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function checkedPlacementComponentValue(
  root: HTMLElement,
  field: string,
  fallback: boolean,
): boolean {
  const input = root.querySelector<HTMLInputElement>(
    `input[data-placement-component-field='${field}']`,
  );
  return input?.checked ?? fallback;
}

function reportPlacementComponentError(
  root: HTMLElement,
  error: unknown,
): void {
  const button = root.querySelector<HTMLButtonElement>(
    "button[data-placement-action='apply-components']",
  );
  button?.setCustomValidity(
    error instanceof Error ? error.message : String(error),
  );
  button?.reportValidity();
  window.setTimeout(() => button?.setCustomValidity(""), 0);
}

function installPlacementAssetDrop(
  canvas: HTMLCanvasElement,
  controlsRoot: () => HTMLElement,
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  assetProvider: PlacementAssetProviderGetter,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  let previewing = false;
  const accepted = (event: DragEvent) =>
    placementAssetDrag !== undefined &&
    controlsRoot().contains(placementAssetDrag.source) &&
    event.dataTransfer?.types.includes(PLACEMENT_ASSET_DRAG_TYPE);
  const clear = () => {
    // Native HTML drag Escape emits dragend without a DOM keydown and can
    // finish before the canvas was entered. It must clear any old armed tool.
    if (!placementAssetDrag && !previewing) return;
    previewing = false;
    resetPlacementAdd(interaction);
    setState(viewer.state());
  };
  canvas.addEventListener("dragover", (event) => {
    if (!accepted(event) || !placementAssetDrag || !event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    previewing = true;
    interaction.pendingAdd = "add-sprite";
    interaction.pendingAddPreview = placementPendingAddPreview(
      "add-sprite",
      assetProvider(),
      placementAssetDrag.options,
    );
    const rect = canvas.getBoundingClientRect();
    setState(
      viewer.pointerAtScreen({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }),
    );
  });
  canvas.addEventListener("drop", (event) => {
    if (
      !accepted(event) ||
      !placementAssetDrag ||
      event.dataTransfer?.getData(PLACEMENT_ASSET_DRAG_TYPE) !==
        placementAssetDrag.token
    )
      return;
    event.preventDefault();
    documentSession?.finishEdit();
    try {
      const rect = canvas.getBoundingClientRect();
      const state = viewer.pointerAtScreen({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      if (!state.pointerWorld) return;
      const draft = createDraftPlacementInstance(
        state,
        "add-sprite",
        assetProvider(),
        {
          ...placementAssetDrag.options,
          point: snappedPlacementPoint(state.pointerWorld, interaction),
        },
      );
      setState(viewer.addInstance(state.fragment, draft));
      clearPlacementAddError(controlsRoot());
    } catch (error) {
      reportPlacementAddError(controlsRoot(), error);
    } finally {
      clear();
    }
  });
  canvas.addEventListener("dragleave", () => {
    if (!previewing) return;
    interaction.pendingAdd = undefined;
    interaction.pendingAddPreview = undefined;
    setState(viewer.state());
  });
  window.addEventListener("dragend", clear);
}

function installPlacementPointer(
  canvas: HTMLCanvasElement,
  controlsRoot: () => HTMLElement,
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  assetProvider: PlacementAssetProviderGetter,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  let hoverQueued = false;
  let latestPoint: { x: number; y: number } | undefined;
  let drag:
    | {
        pointerId: number;
        instanceId: string;
        offsetX: number;
        offsetY: number;
        latestPoint: ScenePlacementPoint;
        queued: boolean;
        cancelled?: boolean;
        origins: readonly { instanceId: string; x: number; y: number }[];
        anchor: ScenePlacementPoint;
      }
    | undefined;

  canvas.addEventListener("pointerdown", (event) => {
    if (
      canvas.closest<HTMLElement>(".demo-stage")?.dataset.workspaceMode !== "2d"
    )
      return;
    if (event.button !== 0) {
      return;
    }
    canvas.focus({ preventScroll: true });
    const point = pointerScreenPoint(canvas, event);
    if (interaction.pendingAdd !== undefined) {
      const pointerState = viewer.pointerAtScreen(point);
      if (pointerState.pointerWorld !== undefined) {
        const placementPoint = snappedPlacementPoint(
          pointerState.pointerWorld,
          interaction,
        );
        try {
          const draft = createDraftPlacementInstance(
            pointerState,
            interaction.pendingAdd,
            assetProvider(),
            {
              ...placementDraftOptionsFromControls(
                controlsRoot(),
                interaction.pendingAdd,
              ),
              point: placementPoint,
            },
          );
          if (
            !controlsRoot().querySelector<HTMLInputElement>(
              "[data-placement-repeat]",
            )?.checked
          ) {
            interaction.pendingAdd = undefined;
            interaction.pendingAddPreview = undefined;
          } else {
            const id = controlsRoot().querySelector<HTMLInputElement>(
              "[data-placement-add-id]",
            );
            if (id) id.value = "";
          }
          clearPlacementAddError(controlsRoot());
          publishPlacementInteraction(interaction);
          setState(viewer.addInstance(pointerState.fragment, draft));
        } catch (error) {
          reportPlacementAddError(controlsRoot(), error);
          setState(viewer.state());
        }
      }
      event.preventDefault();
      return;
    }
    const picked = viewer.pickInstanceAtScreen(point);
    if (picked && (event.shiftKey || event.ctrlKey || event.metaKey)) {
      setState(togglePlacementSelection(viewer, picked.instanceId));
      event.preventDefault();
      return;
    }
    const before = viewer.state();
    if (picked && before.selectedInstanceIds.includes(picked.instanceId))
      viewer.selectInstances([
        ...before.selectedInstanceIds.filter((id) => id !== picked.instanceId),
        picked.instanceId,
      ]);
    else viewer.selectInstanceAtScreen(point);
    const state = setState(viewer.pointerAtScreen(point));
    if (
      picked === undefined ||
      state.selected === undefined ||
      state.pointerWorld === undefined
    ) {
      return;
    }
    if (hasLockedSelection(state)) return;
    const selectedIds = new Set(state.selectedInstanceIds);
    drag = {
      pointerId: event.pointerId,
      instanceId: state.selected.instanceId,
      offsetX: state.selected.transform.x - state.pointerWorld.x,
      offsetY: state.selected.transform.y - state.pointerWorld.y,
      latestPoint: point,
      queued: false,
      origins: state.instances
        .filter((instance) => selectedIds.has(instance.instanceId))
        .map((instance) => ({
          instanceId: instance.instanceId,
          x: instance.transform.x,
          y: instance.transform.y,
        })),
      anchor: { x: state.selected.transform.x, y: state.selected.transform.y },
    };
    interaction.dragging = true;
    publishPlacementInteraction(interaction);
    canvas.dataset.dragging = "true";
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  canvas.addEventListener("pointermove", (event) => {
    latestPoint = pointerScreenPoint(canvas, event);
    if (drag !== undefined) {
      if ((event.buttons & 1) === 0) {
        finishPlacementDrag(canvas, event.pointerId, interaction);
        drag = undefined;
        return;
      }
      drag.latestPoint = latestPoint;
      queuePlacementDragUpdate(viewer, interaction, drag, setState);
      return;
    }
    if (interaction.pendingAdd !== undefined) {
      setState(viewer.pointerAtScreen(latestPoint));
      return;
    }
    if (hoverQueued) {
      return;
    }
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      if (latestPoint !== undefined) {
        setState(viewer.hoverInstanceAtScreen(latestPoint));
      }
    });
  });

  canvas.addEventListener("pointerup", (event) => {
    if (drag?.pointerId !== event.pointerId) {
      return;
    }
    const point = pointerScreenPoint(canvas, event);
    drag.latestPoint = point;
    queuePlacementDragUpdate(viewer, interaction, drag, setState);
    finishPlacementDrag(canvas, event.pointerId, interaction);
    drag = undefined;
    setState(viewer.hoverInstanceAtScreen(point));
  });

  canvas.addEventListener("pointercancel", (event) => {
    if (drag?.pointerId === event.pointerId) {
      drag.cancelled = true;
      finishPlacementDrag(canvas, event.pointerId, interaction);
      drag = undefined;
    }
  });

  canvas.addEventListener("pointerleave", () => {
    if (drag !== undefined) {
      return;
    }
    latestPoint = undefined;
    setState(viewer.hoverInstanceAtScreen());
  });
}

interface PlacementResizeDrag {
  pointerId: number;
  handle: HTMLElement;
  instance: ScenePlacementViewerInstance;
  latestPoint: ScenePlacementPoint;
  queued: boolean;
  cancelled?: boolean;
}

function installPlacementResizeHandle(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  let drag: PlacementResizeDrag | undefined;

  root.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      target.dataset.placementResizeHandle !== "se" ||
      event.button !== 0
    ) {
      return;
    }
    const selected = viewer.state().selected;
    if (
      selected === undefined ||
      placementResizeKindForInstance(selected) === undefined
    ) {
      return;
    }
    canvas.focus({ preventScroll: true });
    drag = {
      pointerId: event.pointerId,
      handle: target,
      instance: selected,
      latestPoint: pointerScreenPoint(canvas, event),
      queued: false,
    };
    interaction.dragging = true;
    publishPlacementInteraction(interaction);
    root.dataset.resizing = "true";
    target.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });

  root.addEventListener("pointermove", (event) => {
    if (drag === undefined || drag.pointerId !== event.pointerId) {
      return;
    }
    if ((event.buttons & 1) === 0) {
      finishPlacementResizeDrag(root, drag, interaction);
      drag = undefined;
      return;
    }
    drag.latestPoint = pointerScreenPoint(canvas, event);
    queuePlacementResizeUpdate(viewer, drag, setState);
    event.preventDefault();
    event.stopPropagation();
  });

  root.addEventListener("pointerup", (event) => {
    if (drag === undefined || drag.pointerId !== event.pointerId) {
      return;
    }
    drag.latestPoint = pointerScreenPoint(canvas, event);
    queuePlacementResizeUpdate(viewer, drag, setState);
    finishPlacementResizeDrag(root, drag, interaction);
    drag = undefined;
    event.preventDefault();
    event.stopPropagation();
  });

  root.addEventListener("pointercancel", (event) => {
    if (drag === undefined || drag.pointerId !== event.pointerId) {
      return;
    }
    drag.cancelled = true;
    finishPlacementResizeDrag(root, drag, interaction);
    drag = undefined;
  });
}

function queuePlacementResizeUpdate(
  viewer: ScenePlacementViewer,
  drag: PlacementResizeDrag,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  if (drag.queued) {
    return;
  }
  drag.queued = true;
  const documentRevision = placementDocumentRevision;
  requestAnimationFrame(() => {
    drag.queued = false;
    if (drag.cancelled || documentRevision !== placementDocumentRevision)
      return;
    const pointerState = viewer.pointerAtScreen(drag.latestPoint);
    if (pointerState.pointerWorld === undefined) {
      return;
    }
    const components = placementComponentsPatchFromResize(
      drag.instance,
      pointerState.pointerWorld,
    );
    setState(
      viewer.updateInstanceComponents(drag.instance.instanceId, components),
    );
  });
}

function finishPlacementResizeDrag(
  root: HTMLElement,
  drag: PlacementResizeDrag,
  interaction: PlacementInteractionState,
): void {
  if (drag.handle.hasPointerCapture(drag.pointerId)) {
    drag.handle.releasePointerCapture(drag.pointerId);
  }
  interaction.dragging = false;
  publishPlacementInteraction(interaction);
  delete root.dataset.resizing;
}

interface PlacementColliderOffsetDrag {
  pointerId: number;
  handle: HTMLElement;
  instance: ScenePlacementViewerInstance;
  startPointerWorld: ScenePlacementPoint;
  latestPoint: ScenePlacementPoint;
  queued: boolean;
  cancelled?: boolean;
}

function installPlacementColliderOffsetHandle(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  let drag: PlacementColliderOffsetDrag | undefined;

  root.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-placement-collider-offset-handle]") : null;
    if (
      !(target instanceof HTMLButtonElement) ||
      event.button !== 0
    ) {
      return;
    }
    const selected = viewer.state().selected;
    if (!placementColliderOffsetDraggable(selected)) {
      return;
    }
    const point = pointerScreenPoint(canvas, event);
    const pointerState = viewer.pointerAtScreen(point);
    if (pointerState.pointerWorld === undefined) {
      return;
    }
    canvas.focus({ preventScroll: true });
    drag = {
      pointerId: event.pointerId,
      handle: target,
      instance: selected,
      startPointerWorld: pointerState.pointerWorld,
      latestPoint: point,
      queued: false,
    };
    interaction.dragging = true;
    publishPlacementInteraction(interaction);
    root.dataset.movingColliderOffset = "true";
    target.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });

  root.addEventListener("pointermove", (event) => {
    if (drag === undefined || drag.pointerId !== event.pointerId) {
      return;
    }
    if ((event.buttons & 1) === 0) {
      finishPlacementColliderOffsetDrag(root, drag, interaction);
      drag = undefined;
      return;
    }
    drag.latestPoint = pointerScreenPoint(canvas, event);
    queuePlacementColliderOffsetUpdate(viewer, drag, setState);
    event.preventDefault();
    event.stopPropagation();
  });

  root.addEventListener("pointerup", (event) => {
    if (drag === undefined || drag.pointerId !== event.pointerId) {
      return;
    }
    drag.latestPoint = pointerScreenPoint(canvas, event);
    queuePlacementColliderOffsetUpdate(viewer, drag, setState);
    finishPlacementColliderOffsetDrag(root, drag, interaction);
    drag = undefined;
    event.preventDefault();
    event.stopPropagation();
  });

  root.addEventListener("pointercancel", (event) => {
    if (drag === undefined || drag.pointerId !== event.pointerId) {
      return;
    }
    drag.cancelled = true;
    finishPlacementColliderOffsetDrag(root, drag, interaction);
    drag = undefined;
  });
}

function placementColliderOffsetDraggable(
  selected: ScenePlacementViewerInstance | undefined,
): selected is ScenePlacementViewerInstance & {
  visual: ResolvedDataSceneObjectVisual;
  collider: Exclude<ResolvedDataSceneColliderComponent, { type: "none" }>;
} {
  return (
    selected?.visual !== undefined &&
    selected.collider !== undefined &&
    selected.collider.type !== "none"
  );
}

function queuePlacementColliderOffsetUpdate(
  viewer: ScenePlacementViewer,
  drag: PlacementColliderOffsetDrag,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  if (drag.queued) {
    return;
  }
  drag.queued = true;
  const documentRevision = placementDocumentRevision;
  requestAnimationFrame(() => {
    drag.queued = false;
    if (drag.cancelled || documentRevision !== placementDocumentRevision)
      return;
    const pointerState = viewer.pointerAtScreen(drag.latestPoint);
    if (pointerState.pointerWorld === undefined) {
      return;
    }
    const components = placementComponentsPatchFromColliderOffset(
      drag.instance,
      drag.startPointerWorld,
      pointerState.pointerWorld,
    );
    setState(
      viewer.updateInstanceComponents(drag.instance.instanceId, components),
    );
  });
}

function finishPlacementColliderOffsetDrag(
  root: HTMLElement,
  drag: PlacementColliderOffsetDrag,
  interaction: PlacementInteractionState,
): void {
  if (drag.handle.hasPointerCapture(drag.pointerId)) {
    drag.handle.releasePointerCapture(drag.pointerId);
  }
  interaction.dragging = false;
  publishPlacementInteraction(interaction);
  delete root.dataset.movingColliderOffset;
}

function placementComponentsPatchFromColliderOffset(
  selected: ScenePlacementViewerInstance,
  startPointerWorld: ScenePlacementPoint,
  pointerWorld: ScenePlacementPoint,
): Parameters<ScenePlacementViewer["updateInstanceComponents"]>[1] {
  if (!placementColliderOffsetDraggable(selected)) {
    throw new Error(
      "placement collider offset handle requires a selected visual and collider.",
    );
  }
  const scale =
    Math.abs(selected.transform.scale) < 0.0001
      ? 0.0001
      : selected.transform.scale;
  const offset = {
    offsetX: roundPlacementResizeValue(
      selected.collider.offsetX +
        (pointerWorld.x - startPointerWorld.x) / scale,
    ),
    offsetY: roundPlacementResizeValue(
      selected.collider.offsetY +
        (pointerWorld.y - startPointerWorld.y) / scale,
    ),
  };
  return {
    visual: placementVisualPatchFromResolved(selected.visual),
    collider: placementColliderPatchFromResolved(selected.collider, offset),
    layer: selected.componentLayer?.name ?? "wall",
    ...placementBodyPatch(selected),
  };
}

function placementComponentsPatchFromResize(
  selected: ScenePlacementViewerInstance,
  pointerWorld: ScenePlacementPoint,
): Parameters<ScenePlacementViewer["updateInstanceComponents"]>[1] {
  const visual = selected.visual;
  if (
    visual?.kind !== "primitive" ||
    (visual.shape !== "rect" && visual.shape !== "circle")
  ) {
    throw new Error(
      "placement resize handle only supports primitive rect and circle visuals.",
    );
  }
  const scale = Math.max(0.0001, Math.abs(selected.transform.scale));
  const dx = pointerWorld.x - selected.transform.x;
  const dy = pointerWorld.y - selected.transform.y;
  const cos = Math.cos(selected.transform.rotationRadians);
  const sin = Math.sin(selected.transform.rotationRadians);
  const localX = (dx * cos + dy * sin) / scale;
  const localY = (-dx * sin + dy * cos) / scale;
  if (visual.shape === "circle") {
    const radius = roundPlacementResizeValue(
      Math.max(
        PLACEMENT_RESIZE_MIN_SIZE * 0.5,
        Math.max(Math.abs(localX), Math.abs(localY)),
      ),
    );
    return {
      visual: {
        kind: "primitive",
        shape: "circle",
        radius,
        color: visual.color ?? DEFAULT_PRIMITIVE_COLOR,
      },
      collider: placementColliderPatchForResize(selected.collider, {
        shape: "circle",
        radius,
      }),
      layer: selected.componentLayer?.name ?? "wall",
      ...placementBodyPatch(selected),
    };
  }
  const width = roundPlacementResizeValue(
    Math.max(PLACEMENT_RESIZE_MIN_SIZE, Math.abs(localX) * 2),
  );
  const height = roundPlacementResizeValue(
    Math.max(PLACEMENT_RESIZE_MIN_SIZE, Math.abs(localY) * 2),
  );
  return {
    visual: {
      kind: "primitive",
      shape: "rect",
      width,
      height,
      color: visual.color ?? DEFAULT_PRIMITIVE_COLOR,
    },
    collider: placementColliderPatchForResize(selected.collider, {
      shape: "rect",
      width,
      height,
    }),
    layer: selected.componentLayer?.name ?? "wall",
    ...placementBodyPatch(selected),
  };
}

function placementColliderPatchForResize(
  collider: ResolvedDataSceneColliderComponent | undefined,
  resize:
    | { shape: "rect"; width: number; height: number }
    | { shape: "circle"; radius: number },
): PlacementJsonValue {
  if (collider === undefined || collider.type === "none") {
    return "none";
  }
  const base = placementColliderBasePatchFromResolved(collider);
  if (resize.shape === "rect" && collider.type === "aabb") {
    return {
      type: "aabb",
      ...base,
      halfWidth: resize.width * 0.5,
      halfHeight: resize.height * 0.5,
    };
  }
  if (resize.shape === "circle" && collider.type === "circle") {
    return {
      type: "circle",
      ...base,
      radius: resize.radius,
    };
  }
  return placementColliderPatchFromResolved(collider);
}

function placementColliderPatchFromResolved(
  collider: ResolvedDataSceneColliderComponent,
  offset?: { offsetX: number; offsetY: number },
): PlacementJsonValue {
  if (collider.type === "none") {
    return "none";
  }
  const base = placementColliderBasePatchFromResolved(collider, offset);
  switch (collider.type) {
    case "aabb":
      return {
        type: "aabb",
        ...base,
        halfWidth: collider.halfWidth,
        halfHeight: collider.halfHeight,
      };
    case "circle":
      return {
        type: "circle",
        ...base,
        radius: collider.radius,
      };
    case "capsule":
      return {
        type: "capsule",
        ...base,
        startX: collider.startX,
        startY: collider.startY,
        endX: collider.endX,
        endY: collider.endY,
        radius: collider.radius,
      };
    case "orientedBox":
      return {
        type: "orientedBox",
        ...base,
        halfWidth: collider.halfWidth,
        halfHeight: collider.halfHeight,
        rotationRadians: collider.rotationRadians,
      };
    case "convexPolygon":
      return {
        type: "convexPolygon",
        ...base,
        vertices: collider.vertices.map((vertex) => ({
          x: vertex.x,
          y: vertex.y,
        })),
        rotationRadians: collider.rotationRadians,
      };
  }
}

function placementColliderBasePatchFromResolved(
  collider: Exclude<ResolvedDataSceneColliderComponent, { type: "none" }>,
  offset?: { offsetX: number; offsetY: number },
): PlacementJsonObject {
  return {
    offsetX: offset?.offsetX ?? collider.offsetX,
    offsetY: offset?.offsetY ?? collider.offsetY,
    enabled: collider.enabled,
    isTrigger: collider.isTrigger,
  };
}

// Preserve runtime body authoring when editing visual/collider fields in the viewer.
function placementBodyPatch(
  selected: ScenePlacementViewerInstance,
): PlacementJsonObject {
  const body = selected.body;
  return body === undefined
    ? {}
    : {
        body: {
          type: body.type,
          ...(body.heightSpan === undefined
            ? {}
            : { heightSpan: { ...body.heightSpan } }),
        },
      };
}

function placementVisualPatchFromResolved(
  visual: ResolvedDataSceneObjectVisual,
): PlacementJsonObject {
  if (visual.kind === "primitive") {
    const base = {
      kind: "primitive",
      shape: visual.shape,
      ...(visual.color === undefined ? {} : { color: visual.color }),
    };
    if (visual.shape === "circle") {
      return {
        ...base,
        radius: visual.radius ?? visual.width * 0.5,
      };
    }
    if (visual.shape === "point") {
      return {
        ...base,
        width: visual.width,
      };
    }
    return {
      ...base,
      width: visual.width,
      height: visual.height,
    };
  }
  const texture: PlacementJsonObject =
    visual.texture.kind === "asset"
      ? { asset: visual.texture.name ?? String(visual.texture.value) }
      : { texture: visual.texture.id ?? visual.texture.value };
  return {
    kind: "sprite",
    ...texture,
    width: visual.width,
    height: visual.height,
    frame: spriteFramePatch(visual.frame),
    ...(visual.animation === undefined
      ? {}
      : {
          animation: {
            frameCount: visual.animation.frameCount,
            fps: visual.animation.fps,
          },
        }),
    originX: visual.originX,
    originY: visual.originY,
    ...(visual.layer === undefined ? {} : { layer: visual.layer }),
    ...(visual.sortOrder === undefined ? {} : { sortOrder: visual.sortOrder }),
    ...(visual.depthSort === undefined ? {} : { depthSort: visual.depthSort }),
    ...(visual.tint === undefined ? {} : { tint: visual.tint }),
    ...(visual.color === undefined ? {} : { color: visual.color }),
  };
}

function roundPlacementResizeValue(value: number): number {
  return Math.round(value * 10) / 10;
}

function installPlacementKeyboard(
  canvas: HTMLCanvasElement,
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  canvas.tabIndex = 0;
  canvas.addEventListener("keydown", (event) => {
    if (
      canvas.closest<HTMLElement>(".demo-stage")?.dataset.workspaceMode !== "2d"
    )
      return;
    if (
      canvas.closest<HTMLElement>(".demo-stage")?.dataset.navigationTool !==
      "select"
    )
      return;
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const delta = keyboardNudgeDelta(event.code);
    if (delta === undefined) {
      return;
    }
    event.preventDefault();
    const base = interaction.enabled
      ? interaction.gridSize
      : KEYBOARD_NUDGE_STEP;
    const multiplier = event.shiftKey ? KEYBOARD_FAST_MULTIPLIER : 1;
    nudgeSelectedInstance(
      viewer,
      interaction,
      {
        x: delta.x * base * multiplier,
        y: delta.y * base * multiplier,
      },
      setState,
    );
  });
}

function applyTransformInput(
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  field: string,
  input: HTMLInputElement,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  const selected = viewer.state().selected;
  if (selected && (field === "sortOrder" || field === "depthSort")) {
    const value = numberInputValue(input);
    if (hasLockedSelection(viewer.state()) || (field === "sortOrder" && value === undefined)) return;
    setState(viewer.updateInstanceRenderLayers([{ instanceId: selected.instanceId,
      ...(field === "sortOrder" ? { sortOrder: value! } : { depthSort: input.checked ? "hd2d" : "layer" }) }]));
    return;
  }
  const value = numberInputValue(input);
  if (selected === undefined || value === undefined) {
    return;
  }
  if (hasLockedSelection(viewer.state())) return;
  if (field === "x" || field === "y") {
    const point = snappedPlacementPoint(
      {
        x: field === "x" ? value : selected.transform.x,
        y: field === "y" ? value : selected.transform.y,
      },
      interaction,
    );
    setState(movePlacementSelectionTo(viewer, point));
    return;
  }
  if (field === "scale") {
    if (value <= 0) return;
    setState(
      transformPlacementSelection(viewer, viewer.state(), {
        scale: value / selected.transform.scale,
      }),
    );
    return;
  }
  if (field === "rotationRadians") {
    setState(
      transformPlacementSelection(viewer, viewer.state(), {
        rotation: value - selected.transform.rotationRadians,
      }),
    );
    return;
  }
  if (field === "layer") {
    setState(
      viewer.updateInstanceRenderLayers(viewer.state().selectedInstanceIds.map(instanceId => ({ instanceId, layer: value }))),
    );
  }
}

function snapSelectedInstance(
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): ScenePlacementViewerState | undefined {
  const selected = viewer.state().selected;
  if (selected === undefined) {
    return undefined;
  }
  const point = snappedPlacementPoint(selected.transform, interaction);
  return setState(movePlacementSelectionTo(viewer, point));
}

function nudgeSelectedInstance(
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  delta: Partial<ScenePlacementPoint>,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): ScenePlacementViewerState | undefined {
  const selected = viewer.state().selected;
  if (selected === undefined) {
    return undefined;
  }
  const point = snappedPlacementPoint(
    {
      x: selected.transform.x + (delta.x ?? 0),
      y: selected.transform.y + (delta.y ?? 0),
    },
    interaction,
  );
  return setState(movePlacementSelectionTo(viewer, point));
}

function createDraftPlacementInstance(
  state: ScenePlacementViewerState,
  action: PlacementAddAction,
  assetProvider: ScenePlacementAssetProvider,
  options: PlacementDraftOptions = {},
): SceneCompositionFragmentInstanceSpec {
  const angle = options.rotationRadians ?? 0,
    scale = options.scale ?? 1;
  if (
    !Number.isFinite(angle) ||
    !Number.isFinite(scale) ||
    scale < 0.01 ||
    scale > 100
  )
    throw new Error("Placement rotation must be finite and scale 0.01–100");
  const placement = createDraftPlacementBase(
    state,
    action,
    assetProvider,
    options,
  );
  return {
    ...placement,
    ...(options.rotationRadians === undefined
      ? {}
      : { rotationRadians: angle }),
    ...(options.scale === undefined ? {} : { scale }),
  };
}

function createDraftPlacementBase(
  state: ScenePlacementViewerState,
  action: PlacementAddAction,
  assetProvider: ScenePlacementAssetProvider,
  options: PlacementDraftOptions,
): SceneCompositionFragmentInstanceSpec {
  switch (action) {
    case "add-rect":
      return createDraftPrimitiveInstance(state, "rect", options);
    case "add-circle":
      return createDraftPrimitiveInstance(state, "circle", options);
    case "add-point":
      return createDraftPrimitiveInstance(state, "point", options);
    case "add-sprite":
      return createDraftSpriteInstance(state, assetProvider, options);
    case "add-prefab":
      return createDraftPrefabInstance(state, options);
  }
}

interface PlacementDraftOptions {
  rotationRadians?: number;
  scale?: number;
  point?: ScenePlacementPoint;
  instanceId?: string;
  spriteAsset?: string;
  spriteFrame?: string;
  prefabId?: string;
}

function createDraftPrefabInstance(
  state: ScenePlacementViewerState,
  options: PlacementDraftOptions,
): SceneCompositionFragmentInstanceSpec {
  const anchor = draftPlacementAnchor(state, options);
  const prefab = options.prefabId ?? "crate";
  return {
    id: options.instanceId ?? nextPlacementInstanceId(state, prefab),
    prefab,
    x: Math.round(anchor.x),
    y: Math.round(anchor.y),
  };
}

function createDraftSpriteInstance(
  state: ScenePlacementViewerState,
  assetProvider: ScenePlacementAssetProvider,
  options: PlacementDraftOptions,
): SceneCompositionFragmentInstanceSpec {
  const anchor = draftPlacementAnchor(state, options);
  const asset = options.spriteAsset ?? "crate";
  const frame = selectedPlacementSpriteFrame(
    assetProvider,
    asset,
    options.spriteFrame,
  );
  const size = placementSpriteAssetSize(assetProvider, asset, frame);
  return {
    id: options.instanceId ?? nextPlacementInstanceId(state, asset),
    prefab: "object",
    x: Math.round(anchor.x),
    y: Math.round(anchor.y),
    props: {
      components: {
        visual: {
          kind: "sprite",
          asset,
          ...size,
          ...(frame?.frame === undefined ? {} : { frame: { ...frame.frame } }),
          originX: 0.5,
          originY: 0.5,
        },
        collider: {
          type: "aabb",
          halfWidth: size.width * 0.5,
          halfHeight: size.height * 0.5,
        },
        layer: "wall",
      },
    },
  };
}

function createDraftPrimitiveInstance(
  state: ScenePlacementViewerState,
  shape: DataScenePrimitiveVisualShape,
  options: PlacementDraftOptions,
): SceneCompositionFragmentInstanceSpec {
  const anchor = draftPlacementAnchor(state, options);
  const base = {
    prefab: "object",
    x: Math.round(anchor.x),
    y: Math.round(anchor.y),
  };
  if (shape === "circle") {
    return {
      ...base,
      id: options.instanceId ?? nextPlacementInstanceId(state, "circle"),
      props: {
        components: {
          visual: {
            kind: "primitive",
            shape,
            radius: 18,
            color: "#7ddc9d",
          },
          collider: {
            type: "circle",
            radius: 18,
          },
          layer: "wall",
        },
      },
    };
  }
  if (shape === "point") {
    return {
      ...base,
      id: options.instanceId ?? nextPlacementInstanceId(state, "point"),
      props: {
        components: {
          visual: {
            kind: "primitive",
            shape,
            width: 12,
            color: "#f2c14e",
          },
          collider: "none",
          layer: "pickup",
        },
      },
    };
  }
  return {
    ...base,
    id: options.instanceId ?? nextPlacementInstanceId(state, "rect"),
    props: {
      components: {
        visual: {
          kind: "primitive",
          shape,
          width: 48,
          height: 32,
          color: "#7ddc9d",
        },
        collider: {
          type: "aabb",
          halfWidth: 24,
          halfHeight: 16,
        },
        layer: "wall",
      },
    },
  };
}

function draftPlacementAnchor(
  state: ScenePlacementViewerState,
  options: PlacementDraftOptions,
): ScenePlacementPoint {
  if (options.point !== undefined) {
    return options.point;
  }
  if (state.pointerWorld !== undefined) {
    return state.pointerWorld;
  }
  const selected = state.selected?.transform;
  if (selected !== undefined) {
    return {
      x: selected.x + DEFAULT_SNAP_GRID_SIZE,
      y: selected.y + DEFAULT_SNAP_GRID_SIZE,
    };
  }
  return {
    x: (state.viewport.worldMinX + state.viewport.worldMaxX) * 0.5,
    y: (state.viewport.worldMinY + state.viewport.worldMaxY) * 0.5,
  };
}

function placementSpriteAssetSize(
  assetProvider: ScenePlacementAssetProvider,
  asset: string,
  frame?: ScenePlacementSpriteFrameAsset,
): PlacementInstanceBounds {
  const sprite = assetProvider.resolveSpriteAsset(asset);
  return {
    width: frame?.width ?? sprite?.width ?? 40,
    height: frame?.height ?? sprite?.height ?? 40,
  };
}

function selectedPlacementSpriteFrame(
  assetProvider: ScenePlacementAssetProvider,
  asset: string,
  frameId: string | undefined,
): ScenePlacementSpriteFrameAsset | undefined {
  return frameId === undefined || frameId.length === 0
    ? undefined
    : assetProvider.resolveSpriteFrame(asset, frameId);
}

function placementSpriteAssetOptions(
  assetProvider: ScenePlacementAssetProvider,
): readonly string[] {
  const ids = assetProvider.listSpriteAssets().map((asset) => asset.id);
  return ids.length === 0 ? ["crate"] : ids;
}

function defaultPlacementSpriteAsset(
  assetProvider: ScenePlacementAssetProvider,
): string {
  const ids = placementSpriteAssetOptions(assetProvider);
  return ids.includes("crate") ? "crate" : (ids[0] ?? "crate");
}

function syncPlacementSpriteAssetOptions(
  select: HTMLSelectElement,
  assetProvider: ScenePlacementAssetProvider,
): void {
  const ids = placementSpriteAssetOptions(assetProvider);
  const current = select.value;
  const previous = Array.from(select.options).map((option) => option.value);
  if (
    previous.length === ids.length &&
    previous.every((id, index) => id === ids[index])
  ) {
    return;
  }
  select.replaceChildren(
    ...ids.map((id) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = id;
      return option;
    }),
  );
  select.value = ids.includes(current)
    ? current
    : ids.includes("crate")
      ? "crate"
      : (ids[0] ?? "crate");
}

function placementPrefabOptions(
  resolved: ResolvedSceneAuthoringDocument,
): readonly string[] {
  const ids = Object.keys(resolved.sceneComposition.prefabs).filter(
    (id) => id !== "object",
  );
  return ids.length === 0 ? ["object"] : ids;
}

function syncPlacementPrefabOptions(
  select: HTMLSelectElement,
  state: ScenePlacementViewerState,
): void {
  const ids = placementPrefabOptionsFromState(state);
  const current = select.value;
  const previous = Array.from(select.options).map((option) => option.value);
  if (
    previous.length === ids.length &&
    previous.every((id, index) => id === ids[index])
  ) {
    return;
  }
  select.replaceChildren(
    ...ids.map((id) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = id;
      return option;
    }),
  );
  select.value = ids.includes(current)
    ? current
    : ids.includes("crate")
      ? "crate"
      : (ids[0] ?? "object");
}

function placementPrefabOptionsFromState(
  state: ScenePlacementViewerState,
): readonly string[] {
  const ids = state.objectDefinitions
    .map((definition) => definition.id)
    .filter((id) => id !== "object");
  return ids.length === 0 ? ["object"] : ids;
}

function nextPlacementObjectDefinitionId(
  state: ScenePlacementViewerState,
  instanceId: string,
): string {
  const existing = new Set(
    state.objectDefinitions.map((definition) => definition.id),
  );
  const base = `${instanceId.replace(/[^A-Za-z0-9_.-]+/g, "_")}_definition`;
  if (!existing.has(base)) {
    return base;
  }
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}_${index}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return `${base}_${Date.now()}`;
}

function placementObjectDefinitionFromSelected(
  selected: ScenePlacementViewerInstance,
): Parameters<ScenePlacementViewer["addObjectDefinition"]>[1] {
  if (selected.visual === undefined) {
    throw new Error(
      "object definition creation requires selected visual components.",
    );
  }
  return {
    props: {
      components: {
        visual: placementVisualPatchFromResolved(selected.visual),
        collider:
          selected.collider === undefined
            ? "none"
            : placementColliderPatchFromResolved(selected.collider),
        layer: selected.componentLayer?.name ?? "wall",
        ...placementBodyPatch(selected),
      },
    },
  };
}

function pendingPlacementBounds(
  action: PlacementAddAction,
): PlacementInstanceBounds {
  switch (action) {
    case "add-rect":
      return { width: 48, height: 32 };
    case "add-circle":
      return { width: 36, height: 36 };
    case "add-point":
      return { width: 12, height: 12 };
    case "add-sprite":
    case "add-prefab":
      return { width: 40, height: 40 };
  }
}

function placementFallbackPendingAddPreview(
  action: PlacementAddAction,
): PlacementPendingAddPreview {
  return {
    action,
    label: placementAddLabel(action),
    ...pendingPlacementBounds(action),
  };
}

function placementPendingAddPreview(
  action: PlacementAddAction,
  assetProvider: ScenePlacementAssetProvider,
  options: Omit<PlacementDraftOptions, "point">,
): PlacementPendingAddPreview {
  const base = placementPendingAddPreviewBase(action, assetProvider, options),
    scale = options.scale ?? 1;
  return {
    ...base,
    width: base.width * scale,
    height: base.height * scale,
    rotationRadians: options.rotationRadians ?? 0,
  };
}

function placementPendingAddPreviewBase(
  action: PlacementAddAction,
  assetProvider: ScenePlacementAssetProvider,
  options: Omit<PlacementDraftOptions, "point">,
): PlacementPendingAddPreview {
  if (action !== "add-sprite") {
    return placementFallbackPendingAddPreview(action);
  }
  const assetId =
    options.spriteAsset ?? defaultPlacementSpriteAsset(assetProvider);
  const frame = selectedPlacementSpriteFrame(
    assetProvider,
    assetId,
    options.spriteFrame,
  );
  const asset = assetProvider.resolveSpriteAsset(assetId);
  const size = placementSpriteAssetSize(assetProvider, assetId, frame);
  const frameLabel = frame === undefined ? "" : ` / ${frame.label ?? frame.id}`;
  const thumbnailUrl = frame?.thumbnailUrl ?? asset?.thumbnailUrl;
  return {
    action,
    label: `${asset?.label ?? assetId}${frameLabel}`,
    assetId,
    ...(frame?.id === undefined ? {} : { frameId: frame.id }),
    width: size.width,
    height: size.height,
    ...(thumbnailUrl === undefined ? {} : { thumbnailUrl }),
    ...(!frame?.thumbnailUrl && frame?.frame ? { uv: frame.frame } : {}),
  };
}

function placementAddLabel(action: PlacementAddAction): string {
  switch (action) {
    case "add-rect":
      return "Rect";
    case "add-circle":
      return "Circle";
    case "add-point":
      return "Point";
    case "add-sprite":
      return "Sprite";
    case "add-prefab":
      return "Prefab";
  }
}

function placementDraftOptionsFromControls(
  root: HTMLElement,
  action: PlacementAddAction,
): Omit<PlacementDraftOptions, "point"> {
  const options: Omit<PlacementDraftOptions, "point"> = {};
  const rotation = root.querySelector<HTMLInputElement>(
      "[data-placement-add-rotation]",
    ),
    scale = root.querySelector<HTMLInputElement>("[data-placement-add-scale]");
  if (rotation)
    options.rotationRadians = (rotation.valueAsNumber * Math.PI) / 180;
  if (scale) options.scale = scale.valueAsNumber;
  const id = root
    .querySelector<HTMLInputElement>("input[data-placement-add-id='true']")
    ?.value.trim();
  if (id !== undefined && id.length > 0) {
    options.instanceId = id;
  }
  if (action === "add-sprite") {
    const spriteAsset = selectedPlacementOption(root, "placementAddSprite");
    if (spriteAsset !== undefined) {
      options.spriteAsset = spriteAsset;
    }
    const spriteFrame = selectedPlacementOption(
      root,
      "placementAddSpriteFrame",
    );
    if (spriteFrame !== undefined) {
      options.spriteFrame = spriteFrame;
    }
  }
  if (action === "add-prefab") {
    const prefabId = selectedPlacementOption(root, "placementAddPrefab");
    if (prefabId !== undefined) {
      options.prefabId = prefabId;
    }
  }
  return options;
}

function selectedPlacementOption(
  root: HTMLElement,
  key: "placementAddSprite" | "placementAddSpriteFrame" | "placementAddPrefab",
): string | undefined {
  const selector =
    key === "placementAddSprite"
      ? "select[data-placement-add-sprite='true']"
      : key === "placementAddSpriteFrame"
        ? "select[data-placement-add-sprite-frame='true']"
        : "select[data-placement-add-prefab='true']";
  const value = root.querySelector<HTMLSelectElement>(selector)?.value.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function reportPlacementAddError(root: HTMLElement, error: unknown): void {
  const input = root.querySelector<HTMLInputElement>(
    "input[data-placement-add-id='true']",
  );
  if (input === null) {
    throw error;
  }
  input.setCustomValidity(
    error instanceof Error ? error.message : String(error),
  );
  input.reportValidity();
}

function clearPlacementAddError(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>(
    "input[data-placement-add-id='true']",
  );
  input?.setCustomValidity("");
}

function reportPlacementDefinitionError(
  root: HTMLElement,
  error: unknown,
): void {
  const input = root.querySelector<HTMLInputElement>(
    "input[data-placement-definition-id='true']",
  );
  if (input === null) {
    throw error;
  }
  input.setCustomValidity(
    error instanceof Error ? error.message : String(error),
  );
  input.reportValidity();
}

function clearPlacementDefinitionError(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>(
    "input[data-placement-definition-id='true']",
  );
  input?.setCustomValidity("");
}

function nextPlacementInstanceId(
  state: ScenePlacementViewerState,
  prefix: string,
): string {
  const existing = new Set(
    state.instances.map((instance) => instance.instanceId),
  );
  for (const operation of state.draftPatch?.operations ?? [])
    if (
      operation.kind === "removeInstance" ||
      operation.kind === "renameInstance"
    )
      existing.add(operation.instanceId);
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${prefix}_${index}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Unable to allocate ${prefix} instance id.`);
}

function queuePlacementDragUpdate(
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  drag: {
    instanceId: string;
    offsetX: number;
    offsetY: number;
    latestPoint: ScenePlacementPoint;
    queued: boolean;
    cancelled?: boolean;
    origins: readonly { instanceId: string; x: number; y: number }[];
    anchor: ScenePlacementPoint;
  },
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
): void {
  if (drag.queued) {
    return;
  }
  drag.queued = true;
  const documentRevision = placementDocumentRevision;
  requestAnimationFrame(() => {
    drag.queued = false;
    if (drag.cancelled || documentRevision !== placementDocumentRevision)
      return;
    const pointerState = viewer.pointerAtScreen(drag.latestPoint);
    if (pointerState.pointerWorld === undefined) {
      return;
    }
    const point = snappedPlacementPoint(
      {
        x: pointerState.pointerWorld.x + drag.offsetX,
        y: pointerState.pointerWorld.y + drag.offsetY,
      },
      interaction,
    );
    const dx = point.x - drag.anchor.x,
      dy = point.y - drag.anchor.y;
    setState(
      viewer.updateInstanceTransforms(
        drag.origins.map((origin) => ({
          instanceId: origin.instanceId,
          transform: { x: origin.x + dx, y: origin.y + dy },
        })),
      ),
    );
  });
}

function finishPlacementDrag(
  canvas: HTMLCanvasElement,
  pointerId: number,
  interaction: PlacementInteractionState,
): void {
  interaction.dragging = false;
  publishPlacementInteraction(interaction);
  delete canvas.dataset.dragging;
  if (canvas.hasPointerCapture(pointerId)) {
    canvas.releasePointerCapture(pointerId);
  }
}

function keyboardNudgeDelta(code: string): ScenePlacementPoint | undefined {
  switch (code) {
    case "ArrowLeft":
      return { x: -1, y: 0 };
    case "ArrowRight":
      return { x: 1, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -1 };
    case "ArrowDown":
      return { x: 0, y: 1 };
    default:
      return undefined;
  }
}

function snappedPlacementPoint(
  point: ScenePlacementPoint,
  interaction: PlacementInteractionState,
): ScenePlacementPoint {
  if (!interaction.enabled) {
    return point;
  }
  return snapSceneWorldPoint(point, {
    gridSize: interaction.gridSize,
  });
}

function installPlacementHooks(
  viewer: ScenePlacementViewer,
  interaction: PlacementInteractionState,
  setState: (state: ScenePlacementViewerState) => ScenePlacementViewerState,
  save: {
    saveEnabled: boolean;
    saveDraft(): Promise<ScenePlacementPatchSaveResult | undefined>;
  },
): void {
  const target = window as PlacementViewerWindow;
  target.__ferrumPlacementViewer = viewer;
  target.ferrumPlacementViewerSelect = (instanceId?: string) => {
    return setState(viewer.selectInstance(instanceId));
  };
  target.ferrumPlacementViewerUpdateTransform = (
    instanceId: string,
    transform: Partial<ScenePlacementTransform>,
  ) => {
    return setState(viewer.updateInstanceTransform(instanceId, transform));
  };
  target.ferrumPlacementViewerUpdateComponents = (
    instanceId: string,
    components: Parameters<ScenePlacementViewer["updateInstanceComponents"]>[1],
  ) => {
    return setState(viewer.updateInstanceComponents(instanceId, components));
  };
  target.ferrumPlacementViewerUpdateBehaviorBinding = (
    behaviorTarget: ScenePlacementBehaviorBindingTarget,
    behaviorRecipes: ScenePlacementBehaviorBindingPatch,
  ) => {
    return setState(
      viewer.updateBehaviorBinding(behaviorTarget, behaviorRecipes),
    );
  };
  target.ferrumPlacementViewerRenameInstance = (
    instanceId: string,
    nextInstanceId: string,
  ) => {
    return setState(viewer.renameInstance(instanceId, nextInstanceId));
  };
  target.ferrumPlacementViewerAddInstance = (
    fragment: string,
    instance: SceneCompositionFragmentInstanceSpec,
  ) => {
    return setState(viewer.addInstance(fragment, instance));
  };
  target.ferrumPlacementViewerAddObjectDefinition = (
    definitionId: string,
    definition: Parameters<ScenePlacementViewer["addObjectDefinition"]>[1],
  ) => {
    return setState(viewer.addObjectDefinition(definitionId, definition));
  };
  target.ferrumPlacementViewerRemoveInstance = (instanceId: string) => {
    return setState(viewer.removeInstance(instanceId));
  };
  target.ferrumPlacementViewerClearDraft = () => {
    return setState(viewer.clearDraftPatch());
  };
  target.ferrumPlacementViewerExportPatch = () => viewer.exportPatch();
  target.ferrumPlacementViewerSaveEnabled = save.saveEnabled;
  target.ferrumPlacementViewerSaveDraft = save.saveDraft;
  target.ferrumPlacementViewerOpenSceneDocument = openPlacementSceneDocument;
  target.ferrumPlacementViewerBrowseSceneDocument =
    browsePlacementSceneDocument;
  target.ferrumPlacementViewerBrowseProjectFolder =
    browsePlacementProjectFolder;
  target.ferrumPlacementViewerOpenAssetFolder = inspectPlacementAssetFolder;
  target.ferrumPlacementViewerBrowseAssetFolder = browsePlacementAssetFolder;
  target.ferrumPlacementViewerSaveHandoff = savePlacementAgentHandoffToDesktop;
  target.ferrumPlacementViewerNudgeSelected = (
    delta: Partial<ScenePlacementPoint>,
  ) => {
    return nudgeSelectedInstance(viewer, interaction, delta, setState);
  };
  target.ferrumPlacementViewerSetSnap = (
    options: Partial<PlacementSnapOptions>,
  ) => {
    if (options.enabled !== undefined) {
      interaction.enabled = options.enabled;
    }
    if (
      options.gridSize !== undefined &&
      Number.isFinite(options.gridSize) &&
      options.gridSize > 0
    ) {
      interaction.gridSize = options.gridSize;
    }
    publishPlacementInteraction(interaction);
    return placementInteractionSnapshot(interaction);
  };
  publishPlacementInteraction(interaction);
}

function publishPlacementState(state: ScenePlacementViewerState): void {
  (window as PlacementViewerWindow).ferrumPlacementViewerState = state;
}

let placementAgentHandoffTimer: number | undefined;
let placementDesktopHandoffSyncTimer: number | undefined;
let placementDesktopPendingHandoffJson: string | undefined;
let placementDesktopLastSyncedHandoffJson: string | undefined;
let placementDesktopAssetFolderRevision = 0;
let placementDocumentRevision = 0;
let placementAssetInspectionRevision = 0;
let placementAssetInspectionAbort: AbortController | undefined;
let placementAssetInspectionQueue: Promise<unknown> = Promise.resolve();

function cancelPlacementPendingHandoff(): void {
  placementAssetInspectionRevision++;
  placementAssetInspectionAbort?.abort();
  placementDocumentRevision++;
  if (placementAgentHandoffTimer !== undefined)
    window.clearTimeout(placementAgentHandoffTimer);
  if (placementDesktopHandoffSyncTimer !== undefined)
    window.clearTimeout(placementDesktopHandoffSyncTimer);
  placementAgentHandoffTimer = undefined;
  placementDesktopHandoffSyncTimer = undefined;
  placementDesktopPendingHandoffJson = undefined;
  placementDesktopLastSyncedHandoffJson = undefined;
  placementDesktopAssetFolderRevision++;
}

function publishPlacementAgentHandoff(
  document: SceneAuthoringDocumentSpec,
  state: ScenePlacementViewerState,
  migrationPreview: ScenePlacementBindingMigrationPreview | undefined,
  assetProvider: ScenePlacementAssetProvider,
  sourceDocument: string,
  normalBindings: readonly SceneSpriteNormalBindingEvidence[] = [],
  asepriteImports: readonly PlacementAsepriteImportEvidence[] = [],
  tileImports: readonly ReturnType<typeof tileEvidence>[] = [],
): void {
  const handoffOptions = {
    document,
    state,
    sourceDocument,
    assetFolder: placementDesktopAssetFolderHandoff(),
    assetDiagnostics: placementAssetDiagnosticsForState(state, assetProvider),
    authoringEvidence: placementWorkspaceEvidence,
    path: "placementViewer.agentHandoff",
  };
  const verifiedBindings = normalBindings.filter((binding) => {
    try {
      createScenePlacementAgentHandoff({
        ...handoffOptions,
        normalBindings: [binding],
      });
      return true;
    } catch {
      return false; /* Undo, rename or a later visual edit can make prior evidence stale. */
    }
  });
  const currentBindings = verifiedBindings.filter(
    (binding, index, all) =>
      all.findIndex((item) => item.instanceId === binding.instanceId) === index,
  );
  const handoff = createScenePlacementAgentHandoff({
    ...handoffOptions,
    ...(currentBindings.length ? { normalBindings: currentBindings } : {}),
  });
  const published = {
    ...handoff,
    ...(migrationPreview === undefined ? {} : { migrationPreview }),
    ...(asepriteImports.length ? { asepriteImports } : {}),
    ...(tileImports.length ? { tileImports } : {}),
  };
  (window as PlacementViewerWindow).ferrumPlacementViewerAgentHandoff =
    published;
  schedulePlacementDesktopHandoffSync(published);
  if (!import.meta.env.DEV) {
    return;
  }
  if (placementAgentHandoffTimer !== undefined) {
    window.clearTimeout(placementAgentHandoffTimer);
  }
  placementAgentHandoffTimer = window.setTimeout(() => {
    placementAgentHandoffTimer = undefined;
    void fetch("/__ferrum-placement-handoff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(published),
    }).catch(() => {
      // The handoff endpoint exists only in the official dev host.
    });
  }, 120);
}

function placementDesktopHandoffAutoSyncEnabled(): boolean {
  const desktop = (window as PlacementViewerWindow)
    .ferrumPlacementViewerDesktop;
  if (desktop?.enabled !== true || placementDesktopInvoke() === undefined) {
    return false;
  }
  return (
    desktop.projectPath !== undefined ||
    desktop.requestedProjectPath !== undefined ||
    desktop.requestedSceneDocumentPath !== undefined
  );
}

function schedulePlacementDesktopHandoffSync(
  handoff: PlacementViewerAgentHandoff,
): void {
  if (!placementDesktopHandoffAutoSyncEnabled()) {
    return;
  }
  const nextHandoffJson = JSON.stringify(handoff);
  if (nextHandoffJson === placementDesktopLastSyncedHandoffJson) {
    return;
  }
  placementDesktopPendingHandoffJson = nextHandoffJson;
  if (placementDesktopHandoffSyncTimer !== undefined) {
    window.clearTimeout(placementDesktopHandoffSyncTimer);
  }
  publishPlacementDesktopState({
    handoffSyncStatus: "pending",
    lastHandoffError: undefined,
  });
  const documentRevision = placementDocumentRevision;
  placementDesktopHandoffSyncTimer = window.setTimeout(() => {
    placementDesktopHandoffSyncTimer = undefined;
    const pendingHandoffJson = placementDesktopPendingHandoffJson;
    void savePlacementAgentHandoffToDesktop()
      .then((path) => {
        if (documentRevision !== placementDocumentRevision) return;
        if (path === undefined || pendingHandoffJson === undefined) {
          publishPlacementDesktopState({ handoffSyncStatus: "idle" });
          return;
        }
        placementDesktopLastSyncedHandoffJson = pendingHandoffJson;
        publishPlacementDesktopState({
          handoffSyncStatus: "saved",
          lastHandoffError: undefined,
        });
      })
      .catch((error: unknown) => {
        if (documentRevision !== placementDocumentRevision) return;
        publishPlacementDesktopState({
          handoffSyncStatus: "error",
          lastHandoffError: placementErrorMessage(error),
        });
      });
  }, DESKTOP_HANDOFF_SYNC_DEBOUNCE_MS);
}

function placementAssetDiagnosticsForState(
  state: ScenePlacementViewerState,
  assetProvider: ScenePlacementAssetProvider,
): readonly ScenePlacementAssetDiagnostic[] {
  const diagnostics: ScenePlacementAssetDiagnostic[] = [];
  for (const instance of state.instances) {
    const visual = instance.visual;
    if (visual?.kind !== "sprite" || visual.texture.kind !== "asset") {
      continue;
    }
    diagnostics.push(
      ...assetProvider.diagnoseSpriteAssetReference({
        asset: visual.texture.name ?? String(visual.texture.value),
        path: `placementViewer.instances.${instance.instanceId}.visual.asset`,
      }),
    );
  }
  return diagnostics;
}

function placementPatchOperationCount(
  patch: ScenePlacementPatch | undefined,
): number {
  return (
    (patch?.operations.length ?? 0) + (patch?.spatial?.operations.length ?? 0) + (patch?.lighting !== undefined ? 1 : 0)
  );
}

function publishPlacementSavedDocument(
  document: SceneAuthoringDocumentSpec,
): void {
  (window as PlacementViewerWindow).ferrumPlacementViewerSavedDocument =
    document;
}

function publishPlacementMigrationPreview(
  preview: ScenePlacementBindingMigrationPreview | undefined,
): void {
  const target = window as PlacementViewerWindow;
  if (preview === undefined) {
    delete target.ferrumPlacementViewerMigrationPreview;
    return;
  }
  target.ferrumPlacementViewerMigrationPreview = preview;
}

function publishPlacementSaveResult(
  result: ScenePlacementPatchSaveResult,
): void {
  const target = window as PlacementViewerWindow;
  target.ferrumPlacementViewerLastSave = result;
  delete target.ferrumPlacementViewerLastSaveError;
}

function publishPlacementSaveError(error: unknown): void {
  const target = window as PlacementViewerWindow;
  target.ferrumPlacementViewerLastSaveError = placementErrorMessage(error);
}

async function copyPlacementText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  previousFocus?.focus();
  if (!copied) {
    throw new Error("Clipboard copy failed");
  }
}

function placementErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown placement save error";
}

function placementDocumentSourceLabel(fallback: string): string {
  const desktop = (window as PlacementViewerWindow)
    .ferrumPlacementViewerDesktop;
  if (desktop?.enabled === true) {
    return (
      desktop.sceneDocumentPath ??
      desktop.requestedSceneDocumentPath ??
      fallback
    );
  }
  return fallback;
}

function placementProjectInputValue(): string {
  const desktop = (window as PlacementViewerWindow)
    .ferrumPlacementViewerDesktop;
  if (desktop?.enabled !== true) {
    return "";
  }
  return desktop.projectPath ?? desktop.requestedProjectPath ?? "";
}

function placementAssetFolderInputValue(): string {
  const desktop = (window as PlacementViewerWindow)
    .ferrumPlacementViewerDesktop;
  if (desktop?.enabled !== true) {
    return "";
  }
  return (
    desktop.assetFolderPath ??
    placementDefaultAssetFolderPath(
      desktop.projectPath ?? desktop.requestedProjectPath,
    ) ??
    ""
  );
}

function placementProjectStatusLabel(): string {
  const desktop = (window as PlacementViewerWindow)
    .ferrumPlacementViewerDesktop;
  if (desktop?.enabled !== true) {
    return "browser";
  }
  return desktop.projectPath ?? desktop.requestedProjectPath ?? "-";
}

function placementAssetFolderStatusLabel(): string {
  const desktop = (window as PlacementViewerWindow)
    .ferrumPlacementViewerDesktop;
  if (desktop?.enabled !== true) {
    return "browser";
  }
  if (desktop.lastAssetFolderError !== undefined) {
    return `error ${desktop.lastAssetFolderError}`;
  }
  const path =
    desktop.assetFolderPath ??
    placementDefaultAssetFolderPath(
      desktop.projectPath ?? desktop.requestedProjectPath,
    );
  if (path === undefined) {
    return "-";
  }
  if (desktop.assetFolderExists === false) {
    return `missing ${path}`;
  }
  if (desktop.assetFolderExists === true) {
    const count = desktop.assetFolderImageCount ?? 0;
    return `${count} image${count === 1 ? "" : "s"} ${path}${placementAssetFolderRuntimeStatusLabel(desktop)}`;
  }
  return path;
}

function placementAssetFolderRuntimeStatusLabel(
  desktop: PlacementViewerDesktopState,
): string {
  switch (desktop.assetFolderRuntimeStatus) {
    case "loading":
      return " runtime loading";
    case "ready":
      return ` runtime ${desktop.assetFolderRuntimeTextureCount ?? 0}`;
    case "error":
      return desktop.lastAssetFolderRuntimeError === undefined
        ? " runtime error"
        : ` runtime error ${desktop.lastAssetFolderRuntimeError}`;
    default:
      return "";
  }
}

function placementHandoffStatusLabel(): string {
  const desktop = (window as PlacementViewerWindow)
    .ferrumPlacementViewerDesktop;
  if (desktop?.enabled !== true) {
    return "copy only";
  }
  return desktop.lastHandoffPath ?? desktop.handoffPath ?? "-";
}

function placementSaveStatusLabel(saveEnabled: boolean): string {
  if (!saveEnabled) {
    return "export only";
  }
  const desktop = (window as PlacementViewerWindow)
    .ferrumPlacementViewerDesktop;
  if (desktop?.enabled === true) {
    return desktop.lastSavePath === undefined
      ? "desktop file"
      : `saved ${desktop.lastSavePath}`;
  }
  return import.meta.env.DEV ? "dev endpoint" : "enabled";
}

function placementDefaultAssetFolderPath(
  projectPath: string | undefined,
): string | undefined {
  if (projectPath === undefined || projectPath.length === 0) {
    return undefined;
  }
  return `${projectPath.replace(/\/+$/, "")}/public/assets`;
}

function placementAssetRuntimeUrl(
  asset: ScenePlacementAgentHandoffAssetFile,
): string | undefined {
  if (!asset.runtimeUrl || !asset.contentRevision) return asset.runtimeUrl;
  const url = new URL(asset.runtimeUrl, window.location.href);
  if (url.protocol === "data:" || url.protocol === "blob:")
    return asset.runtimeUrl;
  url.searchParams.set("revision", asset.contentRevision);
  return url.href;
}

/** Runtime-only model keys and presentation. Authored assets and environment stay intact. */
function placementSpatialRuntimeDocument(
  source: SceneAuthoringDocumentSpec,
  gamePreview = false,
): SceneAuthoringDocumentSpec {
  if (!source.spatial) return source;
  const document = structuredClone(source);
  // Pixel presentation belongs to the game preview. Authoring uses the entire canvas
  // so dock changes and camera gestures never crop against an invisible inner frame.
  if (!gamePreview && document.spatial!.environment)
    delete document.spatial!.environment.pixelArt;
  for (const model of Object.values(document.spatial!.models ?? {})) {
    model.asset = "placement:" + model.contentId;
    for (const lod of model.lods ?? [])
      lod.asset = "placement:" + lod.contentId;
  }
  return document;
}

async function loadPlacementSpatialModels(
  engine: FerrumRuntime["engine"],
  document: SceneAuthoringDocumentSpec,
  cache: Map<string, SpatialModelAsset>,
  files = (window as PlacementViewerWindow).ferrumPlacementViewerDesktop
    ?.assetFolderModels,
  load?: { signal: AbortSignal; progress(value: {loaded: number; total: number; name?: string}): void },
): Promise<void> {
  const pending = new Map<string, SpatialModelAsset>();
  const seen = new Set<string>();
  const references = Object.values(document.spatial?.models ?? {}).flatMap(
    (model) => [model, ...(model.lods ?? [])],
  ).filter(ref => {
    if (seen.has(ref.contentId)) return false;
    seen.add(ref.contentId);
    return true;
  });
  let loaded = 0;
  for (const ref of references) {
    load?.signal.throwIfAborted();
    load?.progress({loaded,total:references.length,name:ref.asset});
    let asset = cache.get(ref.contentId) ?? pending.get(ref.contentId);
    if (!asset) {
      const source = files?.find((file) => file.id === ref.asset),
        url = (source && placementAssetRuntimeUrl(source)) ??
          villageModelUrl(ref.asset);
      if (!url)
        throw new Error(
          "Import GLB asset '" + ref.asset + "' before opening this document",
        );
      asset = await loadSpatialGlb(url, { materialProfile: "diffuse", signal: load?.signal });
      load?.signal.throwIfAborted();
      if (asset.contentId !== ref.contentId)
        throw new Error(
          "spatial.models." +
            ref.asset +
            ": model contentId differs from source",
        );
      pending.set(asset.contentId, asset);
      if (
        cache.size + pending.size > 16 ||
        [...cache.values(), ...pending.values()].reduce(
          (bytes, value) => bytes + value.byteLength,
          0,
        ) >
          128 * 1024 * 1024
      )
        throw new Error("Spatial model cache exceeds 16 assets or 128 MiB");
    }
    loaded++;
    load?.progress({loaded,total:references.length,name:ref.asset});
  }
  load?.signal.throwIfAborted();
  for (const [id, asset] of pending) {
    if (!engine.registerDataSceneSpatialModel("placement:" + id, asset))
      throw new Error("Spatial model registration rejected");
    cache.set(id, asset);
  }
}

function placementPreviewAssetSignature(): string {
  const desktop = (window as PlacementViewerWindow)
    .ferrumPlacementViewerDesktop;
  if (desktop?.enabled !== true || desktop.assetFolderExists !== true) {
    return JSON.stringify(["browser", villageTextures()]);
  }
  return JSON.stringify([
    (desktop.assetFolderImages ?? []).some((image) => !image.contentRevision)
      ? placementDesktopAssetFolderRevision
      : 0,
    (desktop.assetFolderImages ?? []).map((image) => [
      image.id,
      placementAssetRuntimeUrl(image),
      image.width,
      image.height,
    ]),
  ]);
}

function createPlacementPreviewAssetProvider(): ScenePlacementAssetProvider {
  const desktopTextures = placementDesktopPreviewTextures();
  if (
    desktopTextures === undefined && Object.keys(villageTextures()).length === 0 && Object.keys(gardenTextures()).length === 0
  ) {
    return PLACEMENT_ASSET_PROVIDER;
  }
  return createScenePlacementAssetProviderFromProjectAssets({
    textures: {
      ...PLACEMENT_TEXTURES,
      ...villageTextures(),
      ...gardenTextures(),
      ...desktopTextures?.textures,
    },
    atlas: { frames: { ...PLACEMENT_ATLAS.frames, ...villageAtlasFrames(), ...gardenAtlasFrames() } },
    textureMetadata: {
      ...PLACEMENT_TEXTURE_METADATA,
      ...villageTextureMetadata(),
      ...gardenTextureMetadata(),
      ...desktopTextures?.metadata,
    },
    frameLabel: ({ frameName }) =>
      ({
        full: "Full",
        base: "Base",
        barrel: "Barrel",
      })[frameName],
    path: "placementViewer.previewAssets",
  });
}

function placementDesktopPreviewTextures():
  | {
      textures: Record<string, string>;
      metadata: Record<string, ScenePlacementProjectTextureMetadata>;
    }
  | undefined {
  const desktop = (window as PlacementViewerWindow)
    .ferrumPlacementViewerDesktop;
  if (desktop?.enabled !== true || desktop.assetFolderExists !== true) {
    return undefined;
  }
  const textures: Record<string, string> = {};
  const metadata: Record<string, ScenePlacementProjectTextureMetadata> = {};
  for (const image of desktop.assetFolderImages ?? []) {
    if (image.runtimeUrl === undefined || image.runtimeUrl.length === 0) {
      continue;
    }
    textures[image.id] = placementAssetRuntimeUrl(image)!;
    metadata[image.id] = {
      label: image.fileName,
      thumbnailUrl: placementAssetRuntimeUrl(image)!,
      ...(image.width === undefined ? {} : { width: image.width }),
      ...(image.height === undefined ? {} : { height: image.height }),
    };
  }
  return Object.keys(textures).length === 0
    ? undefined
    : { textures, metadata };
}

function placementRuntimeTextureManifest(): Record<string, string> {
  const desktopTextures = placementDesktopPreviewTextures();
  return desktopTextures === undefined
    ? { ...VIEWER_TEXTURES, ...villageTextures(), ...gardenTextures() }
    : {
        ...VIEWER_TEXTURES,
        ...villageTextures(),
        ...gardenTextures(),
        ...desktopTextures.textures,
      };
}

function placementRuntimeAssetSignature(
  textures: Record<string, string>,
): string {
  return JSON.stringify([
    (
      window as PlacementViewerWindow
    ).ferrumPlacementViewerDesktop?.assetFolderImages?.some(
      (image) => !image.contentRevision,
    )
      ? placementDesktopAssetFolderRevision
      : 0,
    Object.keys(textures)
      .sort()
      .map((name) => [name, textures[name]]),
  ]);
}

function publishPlacementRuntimeAssetStatus(
  status: NonNullable<PlacementViewerDesktopState["assetFolderRuntimeStatus"]>,
  error?: string,
): void {
  const desktop = (window as PlacementViewerWindow)
    .ferrumPlacementViewerDesktop;
  if (desktop?.enabled !== true) {
    return;
  }
  const localTextureCount = Object.keys(
    placementDesktopPreviewTextures()?.textures ?? {},
  ).length;
  publishPlacementDesktopState({
    assetFolderRuntimeStatus: status,
    assetFolderRuntimeTextureCount: localTextureCount,
    lastAssetFolderRuntimeError:
      status === "error"
        ? (error ?? "Failed to load runtime textures")
        : undefined,
  });
}

function placementDesktopAssetFolderHandoff():
  | ScenePlacementAgentHandoffAssetFolder
  | undefined {
  const desktop = (window as PlacementViewerWindow)
    .ferrumPlacementViewerDesktop;
  if (desktop?.enabled !== true || desktop.assetFolderPath === undefined) {
    return undefined;
  }
  const diagnostics = [...(desktop.assetFolderDiagnostics ?? [])];
  if (desktop.lastAssetFolderRuntimeError !== undefined) {
    diagnostics.push({
      severity: "error",
      code: "runtimeTextureLoadFailed",
      path: "assetFolder.runtimeTextures",
      message: desktop.lastAssetFolderRuntimeError,
    });
  }
  return {
    path: desktop.assetFolderPath,
    status:
      desktop.lastAssetFolderError !== undefined ||
      desktop.lastAssetFolderRuntimeError !== undefined
        ? "error"
        : desktop.assetFolderExists === false
          ? "missing"
          : "ready",
    imageCount: desktop.assetFolderImageCount ?? 0,
    ...(desktop.assetFolderTextureAtlasInputPath === undefined
      ? {}
      : { textureAtlasInputPath: desktop.assetFolderTextureAtlasInputPath }),
    images: desktop.assetFolderImages ?? [],
    diagnostics,
  };
}

async function browsePlacementProjectFolder(): Promise<string | undefined> {
  const openDialog = placementDesktopOpenDialog();
  if (openDialog === undefined) {
    return undefined;
  }
  const selected = await openDialog({
    title: "Open Ferrum2D project folder",
    multiple: false,
    directory: true,
  });
  const projectPath = placementDialogSelectedPath(selected);
  if (projectPath === undefined) {
    return undefined;
  }
  openPlacementProjectFolder(projectPath);
  return projectPath;
}

async function browsePlacementAssetFolder(): Promise<string | undefined> {
  const openDialog = placementDesktopOpenDialog();
  if (openDialog === undefined) {
    return undefined;
  }
  const selected = await openDialog({
    title: "Use Ferrum2D asset folder",
    multiple: false,
    directory: true,
  });
  const assetFolderPath = placementDialogSelectedPath(selected);
  if (assetFolderPath === undefined) {
    return undefined;
  }
  return await inspectPlacementAssetFolder(assetFolderPath);
}

async function browsePlacementSceneDocument(): Promise<string | undefined> {
  const openDialog = placementDesktopOpenDialog();
  if (openDialog === undefined) {
    return undefined;
  }
  const selected = await openDialog({
    title: "Open Ferrum2D scene-authoring JSON",
    multiple: false,
    directory: false,
    filters: [
      {
        name: "Ferrum2D scene authoring",
        extensions: ["json"],
      },
    ],
  });
  const sceneDocumentPath = placementDialogSelectedPath(selected);
  if (sceneDocumentPath === undefined) {
    return undefined;
  }
  openPlacementSceneDocument(sceneDocumentPath);
  return sceneDocumentPath;
}

async function inspectPlacementAssetFolder(
  assetFolderPath: string,
): Promise<string | undefined> {
  const revision = ++placementAssetInspectionRevision;
  const documentRevision = placementDocumentRevision;
  placementAssetInspectionAbort?.abort();
  const controller = new AbortController();
  placementAssetInspectionAbort = controller;
  const current = () =>
    revision === placementAssetInspectionRevision &&
    documentRevision === placementDocumentRevision &&
    !controller.signal.aborted;
  const operation = placementAssetInspectionQueue.then(() =>
    current()
      ? performPlacementAssetFolderInspection(
          assetFolderPath,
          controller.signal,
          current,
        )
      : undefined,
  );
  placementAssetInspectionQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

async function performPlacementAssetFolderInspection(
  assetFolderPath: string,
  signal: AbortSignal,
  current: () => boolean,
): Promise<string | undefined> {
  const desktopInvoke = placementDesktopInvoke();
  if (desktopInvoke === undefined) {
    return undefined;
  }
  try {
    const result = await desktopInvoke<PlacementDesktopAssetFolderResponse>(
      DESKTOP_INSPECT_ASSET_FOLDER_COMMAND,
      { assetFolderPath },
    );
    if (!isPlacementDesktopAssetFolderResponse(result)) {
      throw new Error(
        "Failed to inspect placement asset folder: invalid desktop asset folder response",
      );
    }
    if (!current()) return undefined;
    const resolved = await resolvePlacementDesktopAssetFolderImageDimensions(
      result,
      signal,
    );
    if (!current()) return undefined;
    publishPlacementDesktopAssetFolder(resolved);
    refreshPlacementAgentHandoff();
    return resolved.assetFolderPath;
  } catch (error: unknown) {
    if (!current()) return undefined;
    publishPlacementDesktopState({
      assetFolderPath,
      assetFolderExists: false,
      assetFolderImageCount: 0,
      assetFolderTextureAtlasInputPath: undefined,
      assetFolderImages: [],
      assetFolderModels: [],
      assetFolderDiagnostics: [
        {
          severity: "error",
          code: "notDirectoryAssetFolder",
          path: "assetFolder",
          message: placementErrorMessage(error),
        },
      ],
      lastAssetFolderError: placementErrorMessage(error),
      assetFolderRuntimeStatus: undefined,
      assetFolderRuntimeTextureCount: undefined,
      lastAssetFolderRuntimeError: undefined,
    });
    refreshPlacementAgentHandoff();
    throw error;
  }
}

function openPlacementProjectFolder(projectPath: string): void {
  if (!confirmPlacementDocumentSwitch()) {
    return;
  }
  const url = new URL(window.location.href);
  for (const name of DESKTOP_SCENE_DOCUMENT_QUERY_PARAMS) {
    url.searchParams.delete(name);
  }
  for (const name of DESKTOP_PROJECT_QUERY_PARAMS) {
    url.searchParams.delete(name);
  }
  url.searchParams.set("projectPath", projectPath);
  window.location.assign(url.toString());
}

function openPlacementSceneDocument(sceneDocumentPath?: string): void {
  if (openWorkspaceDocument) {
    void openWorkspaceDocument(sceneDocumentPath).catch((error) => {
      window.dispatchEvent(
        new CustomEvent("ferrum-placement-document-error", {
          detail: placementErrorMessage(error),
        }),
      );
    });
    return;
  }
  if (!confirmPlacementDocumentSwitch()) {
    return;
  }
  const url = new URL(window.location.href);
  for (const name of DESKTOP_SCENE_DOCUMENT_QUERY_PARAMS) {
    url.searchParams.delete(name);
  }
  for (const name of DESKTOP_PROJECT_QUERY_PARAMS) {
    url.searchParams.delete(name);
  }
  if (sceneDocumentPath !== undefined) {
    url.searchParams.set("sceneDocumentPath", sceneDocumentPath);
  }
  window.location.assign(url.toString());
}

function confirmPlacementDocumentSwitch(): boolean {
  if (documentSession) return documentSession.confirmNavigation();
  const state = (window as PlacementViewerWindow).ferrumPlacementViewerState;
  if (state?.draftPatch === undefined) {
    return true;
  }
  return window.confirm(
    translateUi("Unsaved changes will be lost. Open another scene?"),
  );
}

function placementDialogSelectedPath(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.find((entry): entry is string => typeof entry === "string");
  }
  return undefined;
}

async function savePlacementAgentHandoffToDesktop(): Promise<
  string | undefined
> {
  const documentRevision = placementDocumentRevision;
  const desktopInvoke = placementDesktopInvoke();
  if (desktopInvoke === undefined) {
    return undefined;
  }
  const handoff = (window as PlacementViewerWindow)
    .ferrumPlacementViewerAgentHandoff;
  if (handoff === undefined) {
    return undefined;
  }
  const desktop = (window as PlacementViewerWindow)
    .ferrumPlacementViewerDesktop;
  if (desktop?.enabled !== true) return undefined;
  const args: Record<string, unknown> = { handoff };
  if (desktop?.projectPath !== undefined) {
    args.projectPath = desktop.projectPath;
  }
  if (desktop?.sceneDocumentPath !== undefined) {
    args.sceneDocumentPath = desktop.sceneDocumentPath;
  }
  const result = await desktopInvoke<PlacementDesktopHandoffResponse>(
    DESKTOP_SAVE_AGENT_HANDOFF_COMMAND,
    args,
  );
  if (!isPlacementDesktopHandoffResponse(result)) {
    throw new Error(
      "Failed to save placement handoff: invalid desktop handoff response",
    );
  }
  if (documentRevision === placementDocumentRevision) {
    publishPlacementDesktopState({
      lastHandoffPath: result.path,
      handoffPath: result.path,
      lastHandoffError: undefined,
    });
  }
  return result.path;
}

async function savePlacementSceneDocument(
  document: SceneAuthoringDocumentSpec,
  expectedDocument: SceneAuthoringDocumentSpec,
): Promise<{ saved: true; document: SceneAuthoringDocumentSpec }> {
  const desktopInvoke = placementDesktopInvoke();
  if (desktopInvoke !== undefined) {
    const sceneDocumentPath = (window as PlacementViewerWindow)
      .ferrumPlacementViewerDesktop?.sceneDocumentPath;
    const args: Record<string, unknown> = { document, expectedDocument };
    if (sceneDocumentPath !== undefined) {
      args.sceneDocumentPath = sceneDocumentPath;
    }
    const result = await desktopInvoke<PlacementDesktopSceneDocumentResponse>(
      DESKTOP_SAVE_SCENE_DOCUMENT_COMMAND,
      args,
    );
    if (!isPlacementDesktopSceneDocumentResponse(result)) {
      throw new Error(
        "Failed to save placement scene document: invalid desktop save response",
      );
    }
    publishPlacementDesktopState({
      lastSavePath: result.path,
      sceneDocumentPath: result.path,
    });
    return { saved: true, document: result.document };
  }

  if (placementSceneDocumentUrl() !== SCENE_DOCUMENT_URL) {
    throw new Error(
      "Sample preview is export-only. Export the scene or patch.",
    );
  }
  const response = await fetch(SCENE_DOCUMENT_SAVE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ document, expectedDocument }),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to save placement scene document: ${response.status} ${await response.text()}`,
    );
  }
  const json = (await response.json()) as unknown;
  if (!isPlacementSaveResponse(json)) {
    throw new Error(
      "Failed to save placement scene document: invalid save response",
    );
  }
  return json;
}

function isPlacementSaveResponse(
  value: unknown,
): value is { saved: true; document: SceneAuthoringDocumentSpec } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { saved?: unknown }).saved === true &&
    typeof (value as { document?: { format?: unknown } }).document?.format ===
      "string"
  );
}

function placementDesktopInvoke():
  | (<T>(command: string, args?: Record<string, unknown>) => Promise<T>)
  | undefined {
  const core = (window as PlacementViewerWindow).__TAURI__?.core;
  return typeof core?.invoke === "function"
    ? core.invoke.bind(core)
    : undefined;
}

function placementDesktopOpenDialog():
  | ((options: PlacementDesktopOpenDialogOptions) => Promise<unknown>)
  | undefined {
  const dialog = (window as PlacementViewerWindow).__TAURI__?.dialog;
  return typeof dialog?.open === "function"
    ? dialog.open.bind(dialog)
    : undefined;
}

function publishPlacementDesktopState(
  update: Partial<PlacementViewerDesktopState>,
): void {
  const target = window as PlacementViewerWindow;
  target.ferrumPlacementViewerDesktop = {
    enabled: placementDesktopInvoke() !== undefined,
    ...target.ferrumPlacementViewerDesktop,
    ...update,
  };
  window.dispatchEvent(new CustomEvent("ferrum-placement-desktop-statechange"));
}

function publishPlacementDesktopAssetFolder(
  result: PlacementDesktopAssetFolderResponse,
): void {
  // Native asset URLs are stable by id even when a different folder supplies new bytes.
  // Every explicit inspection must refresh uploads, including retries at the same path.
  placementDesktopAssetFolderRevision += 1;
  publishPlacementDesktopState({
    assetFolderPath: result.assetFolderPath,
    assetFolderExists: result.exists,
    assetFolderImageCount: result.imageCount,
    assetFolderTextureAtlasInputPath: result.textureAtlasInputPath,
    assetFolderImages: result.images,
    assetFolderModels: result.models,
    assetFolderDiagnostics: result.diagnostics,
    lastAssetFolderError: undefined,
    assetFolderRuntimeStatus: undefined,
    assetFolderRuntimeTextureCount: undefined,
    lastAssetFolderRuntimeError: undefined,
  });
}

async function resolvePlacementDesktopAssetFolderImageDimensions(
  result: PlacementDesktopAssetFolderResponse,
  signal?: AbortSignal,
): Promise<PlacementDesktopAssetFolderResponse> {
  const images: ScenePlacementAgentHandoffAssetFile[] = [];
  for (
    let index = 0;
    index < result.images.length;
    index += DESKTOP_ASSET_METADATA_BATCH_SIZE
  ) {
    images.push(
      ...(await Promise.all(
        result.images
          .slice(index, index + DESKTOP_ASSET_METADATA_BATCH_SIZE)
          .map((image) =>
            resolvePlacementDesktopAssetImageDimensions(image, signal),
          ),
      )),
    );
  }
  return { ...result, images };
}

async function resolvePlacementDesktopAssetImageDimensions(
  image: ScenePlacementAgentHandoffAssetFile,
  signal?: AbortSignal,
): Promise<ScenePlacementAgentHandoffAssetFile> {
  if (
    (image.width !== undefined && image.height !== undefined) ||
    image.runtimeUrl === undefined ||
    typeof createImageBitmap !== "function"
  ) {
    return image;
  }

  let bitmap: ImageBitmap | undefined;
  try {
    const response = await fetch(placementAssetRuntimeUrl(image)!, { signal });
    if (!response.ok) {
      return image;
    }
    bitmap = await createImageBitmap(await response.blob());
    if (bitmap.width <= 0 || bitmap.height <= 0) {
      return image;
    }
    return {
      ...image,
      width: image.width ?? bitmap.width,
      height: image.height ?? bitmap.height,
    };
  } catch {
    return image;
  } finally {
    bitmap?.close();
  }
}

function refreshPlacementAgentHandoff(): void {
  (window as PlacementViewerWindow).ferrumPlacementViewerRefreshHandoff?.();
}

function publishPlacementInteraction(
  interaction: PlacementInteractionState,
): void {
  (window as PlacementViewerWindow).ferrumPlacementViewerInteraction =
    placementInteractionSnapshot(interaction);
  window.dispatchEvent(new Event("ferrum-placement-toolchange"));
}

function resetPlacementAdd(interaction: PlacementInteractionState): void {
  interaction.pendingAdd = undefined;
  interaction.pendingAddPreview = undefined;
  placementAssetDrag = undefined;
}

function placementInteractionSnapshot(
  interaction: PlacementInteractionState,
): PlacementInteractionSnapshot {
  return {
    enabled: interaction.enabled,
    gridSize: interaction.gridSize,
    dragging: interaction.dragging,
    ...(interaction.pendingAdd === undefined
      ? {}
      : { pendingAdd: interaction.pendingAdd }),
    ...(interaction.pendingAddPreview === undefined
      ? {}
      : { pendingAddPreview: { ...interaction.pendingAddPreview } }),
  };
}

function placementMigrationPreview(
  document: SceneAuthoringDocumentSpec,
  patch: ScenePlacementPatch | undefined,
): ScenePlacementBindingMigrationPreview | undefined {
  return patch === undefined
    ? undefined
    : previewScenePlacementBindingMigration(document, patch, {
        path: "placementViewer.migration",
      });
}

function publishFrameStats(frame: FerrumRuntimeFrame): void {
  const target = window as PlacementViewerWindow;
  const spatial = frame.frame.renderCommandBuffer.spatial;
  let terrainVertices = spatial?.terrainVertexCount ?? 0;
  if (spatial?.version === 2) {
    terrainVertices = 0;
    for (let i = 1; i < spatial.terrainDrawRanges.length; i += 2)
      terrainVertices += spatial.terrainDrawRanges[i];
  }
  target.ferrumPlacementViewerRuntimeFrame = {
    ...(spatial
      ? {
          spatial: {
            terrainVertices,
            billboardVertices: spatial.billboardVertexCount,
            modelDraws: (spatial.models?.words.length ?? 0) / 20,
            debugVertices: spatial.debug?.vertexCount ?? 0,
          },
        }
      : {}),
    entityCount: frame.frame.entityCount,
    renderCommandCount: frame.rendererStats.renderCommandCount,
    drawCalls: frame.rendererStats.drawCalls,
  };
}

function publishPlacementRuntimeAssets(
  textures: Record<string, string>,
  engine: FerrumRuntime["engine"],
): void {
  const textureIds: Record<string, number> = {};
  for (const name of Object.keys(textures)) {
    textureIds[name] = engine.textureId(name);
  }
  (window as PlacementViewerWindow).ferrumPlacementViewerRuntimeAssets = {
    textures: { ...textures },
    textureIds,
  };
}

function createPlacementInteractionState(): PlacementInteractionState {
  return {
    enabled: false,
    gridSize: DEFAULT_SNAP_GRID_SIZE,
    dragging: false,
  };
}

function placementViewerSaveEnabled(): boolean {
  return (
    placementDesktopInvoke() !== undefined ||
    (placementSceneDocumentUrl() === SCENE_DOCUMENT_URL &&
      (import.meta.env.DEV ||
        import.meta.env.VITE_FERRUM_PLACEMENT_VIEWER_SAVE === "true"))
  );
}

function placementBoundsById(
  resolved: ResolvedSceneAuthoringDocument,
): Map<string, PlacementInstanceBounds> {
  const bounds = new Map<string, PlacementInstanceBounds>();
  for (const instance of resolved.bindingPlan?.instances ?? []) {
    const components = resolveDataSceneInstanceComponents(instance, {
      allowTemplate: false,
      path: `placementViewer.instances.${instance.id}`,
    });
    if (components.mode !== "inline") {
      continue;
    }
    bounds.set(instance.id, dataSceneObjectVisualBounds(components));
  }
  return bounds;
}

function placementBoundsForInstance(
  instance: ScenePlacementViewerInstance,
  boundsById: ReadonlyMap<string, PlacementInstanceBounds>,
): PlacementInstanceBounds | undefined {
  if (instance.visual !== undefined) {
    return {
      width: instance.visual.bounds.width,
      height: instance.visual.bounds.height,
    };
  }
  return (
    boundsById.get(instance.sourceId) ?? boundsById.get(instance.instanceId)
  );
}

function placementVisualLabel(
  instance: ScenePlacementViewerInstance | undefined,
): string {
  const visual = instance?.visual;
  if (visual === undefined) {
    return "-";
  }
  if (visual.kind === "primitive") {
    return `${visual.shape} ${formatNumber(visual.bounds.width)}x${formatNumber(visual.bounds.height)}`;
  }
  const texture =
    visual.texture.kind === "asset"
      ? (visual.texture.name ?? String(visual.texture.value))
      : `#${visual.texture.id ?? visual.texture.value}`;
  return `${texture} ${formatNumber(visual.bounds.width)}x${formatNumber(visual.bounds.height)}`;
}

function placementColliderLabel(
  instance: ScenePlacementViewerInstance | undefined,
): string {
  const collider = instance?.collider;
  if (collider === undefined) {
    return "-";
  }
  switch (collider.type) {
    case "none":
      return "none";
    case "aabb":
      return `aabb ${formatNumber(collider.halfWidth * 2)}x${formatNumber(collider.halfHeight * 2)}`;
    case "circle":
      return `circle r${formatNumber(collider.radius)}`;
    case "capsule":
      return `capsule r${formatNumber(collider.radius)}`;
    case "orientedBox":
      return `orientedBox ${formatNumber(collider.halfWidth * 2)}x${formatNumber(collider.halfHeight * 2)}`;
    case "convexPolygon":
      return `convexPolygon ${collider.vertices.length}`;
  }
}

function firstActorInstance(
  resolved: ResolvedSceneAuthoringDocument,
): string | undefined {
  for (const binding of resolved.bindingPlan?.bindings ?? []) {
    return binding.instance.id;
  }
  return undefined;
}

function viewportForCanvas(
  canvas: HTMLCanvasElement,
  engine?: FerrumRuntime["engine"],
) {
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(
    1,
    rect.width || canvas.clientWidth || canvas.width,
  );
  const cssHeight = Math.max(
    1,
    rect.height || canvas.clientHeight || canvas.height,
  );
  const viewport = {
    cssWidth,
    cssHeight,
    dpr: window.devicePixelRatio || 1,
    backbufferWidth: Math.max(1, canvas.width),
    backbufferHeight: Math.max(1, canvas.height),
  };
  if (engine === undefined) {
    return viewport;
  }
  return {
    ...viewport,
    cameraX: engine.cameraX(),
    cameraY: engine.cameraY(),
  };
}

function pointerScreenPoint(
  canvas: HTMLCanvasElement,
  event: PointerEvent | MouseEvent,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

async function loadSceneAuthoringDocument(
  url: string,
  sceneDocumentPath?: string,
  projectPath?: string,
): Promise<SceneAuthoringDocumentSpec> {
  const desktopInvoke = placementDesktopInvoke();
  if (desktopInvoke !== undefined) {
    if (projectPath !== undefined) {
      const result =
        await desktopInvoke<PlacementDesktopProjectDocumentResponse>(
          DESKTOP_LOAD_PROJECT_FOLDER_COMMAND,
          { projectPath },
        );
      if (!isPlacementDesktopProjectDocumentResponse(result)) {
        throw new Error(
          "Failed to load placement project folder: invalid desktop project response",
        );
      }
      const assetFolder =
        await resolvePlacementDesktopAssetFolderImageDimensions(
          result.assetFolder,
        );
      publishPlacementDesktopState({
        requestedProjectPath: projectPath,
        projectPath: result.projectPath,
        sceneDocumentPath: result.sceneDocumentPath,
        handoffPath: result.handoffPath,
        assetFolderPath: assetFolder.assetFolderPath,
        assetFolderExists: assetFolder.exists,
        assetFolderImageCount: assetFolder.imageCount,
        assetFolderTextureAtlasInputPath: assetFolder.textureAtlasInputPath,
        assetFolderImages: assetFolder.images,
        assetFolderModels: assetFolder.models,
        assetFolderDiagnostics: assetFolder.diagnostics,
        lastAssetFolderError: undefined,
        assetFolderRuntimeStatus: undefined,
        assetFolderRuntimeTextureCount: undefined,
        lastAssetFolderRuntimeError: undefined,
      });
      return result.document;
    }
    const result = await desktopInvoke<PlacementDesktopSceneDocumentResponse>(
      DESKTOP_LOAD_SCENE_DOCUMENT_COMMAND,
      sceneDocumentPath === undefined ? undefined : { sceneDocumentPath },
    );
    if (!isPlacementDesktopSceneDocumentResponse(result)) {
      throw new Error(
        "Failed to load placement scene document: invalid desktop load response",
      );
    }
    publishPlacementDesktopState({
      requestedSceneDocumentPath: sceneDocumentPath,
      projectPath: undefined,
      sceneDocumentPath: result.path,
      assetFolderPath: undefined,
      assetFolderExists: undefined,
      assetFolderImageCount: undefined,
      assetFolderTextureAtlasInputPath: undefined,
      assetFolderImages: undefined,
      assetFolderModels: undefined,
      assetFolderDiagnostics: undefined,
      lastAssetFolderError: undefined,
      assetFolderRuntimeStatus: undefined,
      assetFolderRuntimeTextureCount: undefined,
      lastAssetFolderRuntimeError: undefined,
    });
    return result.document;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to load ${url}: ${response.status} ${response.statusText}`.trim(),
    );
  }
  return (await response.json()) as SceneAuthoringDocumentSpec;
}

function isPlacementDesktopProjectDocumentResponse(
  value: unknown,
): value is PlacementDesktopProjectDocumentResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { projectPath?: unknown }).projectPath === "string" &&
    typeof (value as { sceneDocumentPath?: unknown }).sceneDocumentPath ===
      "string" &&
    typeof (value as { handoffPath?: unknown }).handoffPath === "string" &&
    isPlacementDesktopAssetFolderResponse(
      (value as { assetFolder?: unknown }).assetFolder,
    ) &&
    typeof (value as { document?: { format?: unknown } }).document?.format ===
      "string"
  );
}

function isPlacementDesktopAssetFolderResponse(
  value: unknown,
): value is PlacementDesktopAssetFolderResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { assetFolderPath?: unknown }).assetFolderPath ===
      "string" &&
    typeof (value as { exists?: unknown }).exists === "boolean" &&
    typeof (value as { imageCount?: unknown }).imageCount === "number" &&
    ((value as { textureAtlasInputPath?: unknown }).textureAtlasInputPath ===
      undefined ||
      typeof (value as { textureAtlasInputPath?: unknown })
        .textureAtlasInputPath === "string") &&
    Array.isArray((value as { images?: unknown }).images) &&
    Array.isArray((value as { diagnostics?: unknown }).diagnostics)
  );
}

function isPlacementDesktopSceneDocumentResponse(
  value: unknown,
): value is PlacementDesktopSceneDocumentResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { path?: unknown }).path === "string" &&
    typeof (value as { document?: { format?: unknown } }).document?.format ===
      "string"
  );
}

function isPlacementDesktopHandoffResponse(
  value: unknown,
): value is PlacementDesktopHandoffResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { path?: unknown }).path === "string" &&
    typeof (value as { handoff?: { format?: unknown } }).handoff?.format ===
      "string"
  );
}

function appendNumberControl(
  parent: HTMLElement,
  label: string,
  field: string,
  step: string,
  min?: string,
): HTMLInputElement {
  return bindUiControl(
    appendAuthoringViewerNumberControl(parent, {
      label,
      className: "placement-control",
      step,
      min,
      dataset:
        field === "snapGrid"
          ? { placementSnapGrid: "true" }
          : { placementTransformField: field },
    }),
    label,
    false,
  );
}

function appendTextControl(
  parent: HTMLElement,
  label: string,
  field: string,
): HTMLInputElement {
  return bindUiControl(
    appendAuthoringViewerTextControl(parent, {
      label,
      className: "placement-control",
      dataset: textControlDataset(field),
    }),
    label,
    false,
  );
}

function appendSelectControl(
  parent: HTMLElement,
  label: string,
  field: string,
  options: readonly string[],
): HTMLSelectElement {
  return bindUiControl(
    appendAuthoringViewerSelectControl(parent, {
      label,
      className: "placement-control",
      options,
      dataset: selectControlDataset(field),
    }),
    label,
    false,
  );
}

function textControlDataset(field: string): Record<string, string> {
  if (field === "rename") {
    return { placementRenameId: "true" };
  }
  if (field === "addId") {
    return { placementAddId: "true" };
  }
  if (field === "definitionId") {
    return { placementDefinitionId: "true" };
  }
  return {};
}

function selectControlDataset(field: string): Record<string, string> {
  if (field === "addSprite") {
    return { placementAddSprite: "true" };
  }
  if (field === "addSpriteFrame") {
    return { placementAddSpriteFrame: "true" };
  }
  if (field === "addPrefab") {
    return { placementAddPrefab: "true" };
  }
  if (field === "behaviorRecipe") {
    return { placementBehaviorRecipe: "true" };
  }
  return {};
}

function appendComponentNumberControl(
  parent: HTMLElement,
  label: string,
  field: string,
  step: string,
  min?: string,
): HTMLInputElement {
  return bindUiControl(
    appendAuthoringViewerNumberControl(parent, {
      label,
      className: "placement-control",
      step,
      min,
      dataset: { placementComponentField: field },
    }),
    label,
    false,
  );
}

function appendComponentColorControl(
  parent: HTMLElement,
  label: string,
  field: string,
): HTMLInputElement {
  const wrapper = document.createElement("label");
  const labelText = document.createElement("span");
  const input = document.createElement("input");
  wrapper.className = "placement-control";
  setUiText(labelText, label);
  input.type = "color";
  input.dataset.placementComponentField = field;
  wrapper.append(labelText, input);
  parent.append(wrapper);
  return input;
}

function appendComponentSelectControl<T extends string>(
  parent: HTMLElement,
  label: string,
  field: string,
  options: readonly T[],
): HTMLSelectElement {
  return bindUiControl(
    appendAuthoringViewerSelectControl(parent, {
      label,
      className: "placement-control",
      options,
      dataset: { placementComponentField: field },
    }),
    label,
    true,
  );
}

function appendComponentTextareaControl(
  parent: HTMLElement,
  label: string,
  field: string,
): HTMLTextAreaElement {
  return bindUiControl(
    appendAuthoringViewerTextareaControl(parent, {
      label,
      className: "placement-control placement-control-textarea",
      rows: 3,
      dataset: { placementComponentField: field },
    }),
    label,
    false,
  );
}

function appendComponentCheckboxControl(
  parent: HTMLElement,
  label: string,
  field: string,
): HTMLInputElement {
  return bindUiControl(
    appendAuthoringViewerCheckboxControl(parent, {
      label,
      className: "placement-control placement-control-checkbox",
      dataset: { placementComponentField: field },
    }),
    label,
    false,
  );
}

function appendCheckboxControl(
  parent: HTMLElement,
  label: string,
  field: string,
): HTMLInputElement {
  return bindUiControl(
    appendAuthoringViewerCheckboxControl(parent, {
      label,
      className: "placement-control placement-control-checkbox",
      dataset: field === "snap" ? { placementSnapToggle: "true" } : {},
    }),
    label,
    false,
  );
}

function normalizedPlacementColor(value: string): string {
  if (/^#[0-9a-fA-F]{3,4}$/.test(value)) {
    return (
      "#" +
      [...value.slice(1, 4)]
        .map((channel) => channel + channel)
        .join("")
        .toLowerCase()
    );
  }
  return /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value)
    ? value.slice(0, 7).toLowerCase()
    : DEFAULT_PRIMITIVE_COLOR;
}

function placementGameStateLabel(code: number): string {
  if (code === 0) return "Ready";
  if (code === 1) return "Preview";
  if (code === 2) return "Stopped";
  if (code === 3) return "Paused";
  if (code === 4) return "Complete";
  return `State ${code}`;
}

void bootstrap();

function appendRow(
  parent: HTMLElement,
  label: string,
  value = "-",
): HTMLElement {
  const result = appendRawRow(parent, label, value);
  if (result.previousElementSibling)
    setUiText(result.previousElementSibling, label);
  return result;
}
