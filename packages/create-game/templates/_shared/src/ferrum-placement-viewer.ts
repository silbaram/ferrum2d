import {
  FERRUM_AUTHORING_VIEWER_TITLE,
  createAuthoringViewerShell,
} from "@ferrum2d/authoring-viewer";
import {
  renderObjectDefinitions,
  renderPlacementDetails,
  renderProjectAssets,
  type PlacementObjectPanelOptions,
} from "./ferrum-placement-viewer-object-panels";
import {
  renderPlacementTransformControls,
  type PlacementTransformPanelSettings,
} from "./ferrum-placement-viewer-transform-panel";
import {
  createPlacementSession,
  renderPlacementInstanceList,
  renderPlacementStage,
  selectPlacementInstanceAtPointer,
  updatePlacementViewportForStage,
  type PlacementSession,
  type PlacementStageSessionSettings,
} from "./ferrum-placement-viewer-stage-session";
import {
  publishPlacementSaveResult,
  publishPlacementState,
  publishPlacementViewer,
  renderPlacementAgentOutputs,
} from "./ferrum-placement-viewer-publish";
import { loadPlacementViewerAssets, type PlacementViewerAssetUrls } from "./ferrum-placement-viewer-assets";
import { renderPlacementStartupError } from "./ferrum-placement-viewer-startup-error";

import "./ferrum-placement-viewer.css";

const SCENE_AUTHORING_URL = "./scene-authoring.json";
const GAME_SPEC_URL = "./game.json";
const TEXTURE_ATLAS_INPUT_URL = "./assets/texture-atlas.input.json";
const PLACEMENT_VIEWER_ASSET_URLS: PlacementViewerAssetUrls = Object.freeze({
  sceneAuthoring: SCENE_AUTHORING_URL,
  gameSpec: GAME_SPEC_URL,
  textureAtlasInput: TEXTURE_ATLAS_INPUT_URL,
});
const DEFAULT_OBJECT_SIZE = 48;
const DEFAULT_STAGE_WIDTH = 860;
const DEFAULT_STAGE_HEIGHT = 540;
const SNAP_GRID_SIZE = 16;
const MEMORY_SAVE_ADAPTER_ID = "consumer-placement-viewer-memory";
const OBJECT_PREFAB_ID = "object";
const OBJECT_PANEL_OPTIONS: PlacementObjectPanelOptions = Object.freeze({
  objectPrefabId: OBJECT_PREFAB_ID,
  snapGridSize: SNAP_GRID_SIZE,
  defaultObjectSize: DEFAULT_OBJECT_SIZE,
});
const TRANSFORM_PANEL_SETTINGS: PlacementTransformPanelSettings = Object.freeze({
  memorySaveAdapterId: MEMORY_SAVE_ADAPTER_ID,
  snapGridSize: SNAP_GRID_SIZE,
});
const STAGE_SESSION_SETTINGS: PlacementStageSessionSettings = Object.freeze({
  defaultObjectSize: DEFAULT_OBJECT_SIZE,
  defaultStageWidth: DEFAULT_STAGE_WIDTH,
  defaultStageHeight: DEFAULT_STAGE_HEIGHT,
});

interface PlacementShell {
  status: HTMLElement;
  stage: HTMLElement;
  list: HTMLElement;
  details: HTMLElement;
  controls: HTMLElement;
  definitions: HTMLElement;
  assets: HTMLElement;
  handoff: HTMLTextAreaElement;
  patch: HTMLTextAreaElement;
}

async function bootstrap(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#placement-viewer");
  if (root === null) {
    throw new Error("Missing #placement-viewer root element.");
  }

  try {
    const shell = createShell(root);
    const { document, assetProvider } = await loadPlacementViewerAssets(PLACEMENT_VIEWER_ASSET_URLS);
    let session = createPlacementSession(
      document,
      shell.stage,
      assetProvider,
      STAGE_SESSION_SETTINGS,
    );

    const setSession = (nextSession: PlacementSession): void => {
      session = nextSession;
      publishPlacementViewer(session.viewer);
    };
    const render = (): void => {
      renderPlacement(shell, session, setSession, render);
      publishPlacementState(session.viewer.state());
    };

    shell.stage.addEventListener("pointerdown", (event) => {
      if (event.target !== shell.stage) {
        return;
      }
      selectPlacementInstanceAtPointer(shell.stage, session, event);
      render();
    });

    new ResizeObserver(() => {
      updatePlacementViewportForStage(shell.stage, session, STAGE_SESSION_SETTINGS);
      render();
    }).observe(shell.stage);

    publishPlacementViewer(session.viewer);
    render();
  } catch (error) {
    renderPlacementStartupError(root, error);
  }
}

function createShell(root: HTMLElement): PlacementShell {
  const list = document.createElement("div");
  const details = document.createElement("div");
  const controls = document.createElement("div");
  const definitions = document.createElement("div");
  const assets = document.createElement("div");
  const handoff = document.createElement("textarea");
  const patch = document.createElement("textarea");

  list.className = "placement-list";
  definitions.className = "placement-definitions";
  assets.className = "placement-assets";
  handoff.readOnly = true;
  patch.readOnly = true;

  const shell = createAuthoringViewerShell({
    root,
    title: `__PROJECT_TITLE__ ${FERRUM_AUTHORING_VIEWER_TITLE}`,
    classNames: {
      shell: "placement-shell",
      toolbar: "placement-toolbar",
      status: "placement-status",
      layout: "placement-layout",
      stage: "placement-stage",
      panel: "placement-panel",
      section: "placement-section",
    },
    sections: [
      { id: "instances", title: "Instances", body: list },
      { id: "selected", title: "Selected", body: details },
      { id: "transform", title: "Transform", body: controls },
      { id: "objectDefinitions", title: "Object Definitions", body: definitions },
      { id: "projectAssets", title: "Project Assets", body: assets },
      { id: "agentHandoff", title: "Agent Handoff", body: handoff },
      { id: "patch", title: "Patch", body: patch },
    ],
  });

  return {
    status: shell.status,
    stage: shell.stage,
    list,
    details,
    controls,
    definitions,
    assets,
    handoff,
    patch,
  };
}

function renderPlacement(
  shell: PlacementShell,
  session: PlacementSession,
  setSession: (session: PlacementSession) => void,
  render: () => void,
): void {
  const state = session.viewer.state();
  const patch = session.viewer.exportPatch();
  shell.status.textContent = `${state.instances.length} instances | ${patch?.operations.length ?? 0} draft operations`;
  renderPlacementStage(shell.stage, session, state, render, STAGE_SESSION_SETTINGS);
  renderPlacementInstanceList(shell.list, session, state, render);
  renderPlacementDetails(shell.details, state);
  renderPlacementTransformControls({
    container: shell.controls,
    session,
    settings: TRANSFORM_PANEL_SETTINGS,
    state,
    onDocumentSaved: (document) => {
      setSession(createPlacementSession(
        document,
        shell.stage,
        session.assetProvider,
        STAGE_SESSION_SETTINGS,
      ));
    },
    onSaveResult: publishPlacementSaveResult,
    render,
  });
  renderObjectDefinitions(shell.definitions, session, state, render, OBJECT_PANEL_OPTIONS);
  renderProjectAssets(shell.assets, session, state, render, OBJECT_PANEL_OPTIONS);
  renderPlacementAgentOutputs({
    handoff: shell.handoff,
    patchOutput: shell.patch,
    session,
    state,
    draftPatch: patch,
    sourceDocument: SCENE_AUTHORING_URL,
  });
}

void bootstrap();
