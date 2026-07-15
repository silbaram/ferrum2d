import {
  createFerrumRuntime,
  type FerrumEngine,
  type FerrumRuntime,
  type InputSnapshot,
  type UiOverlayState,
} from "@ferrum2d/ferrum-web/core";
import {
  behaviorRecipeCommandsForEntity,
  compileWeaponProfiles,
  type ProjectileDefinition,
  type WeaponDefinition,
} from "@ferrum2d/ferrum-web/authoring";
import {
  diagnosticReport,
  type DiagnosticContext,
  type DiagnosticReport,
} from "@ferrum2d/ferrum-web/quality";

import "./styles.css";

type TemplateWeaponProfileId = "standard" | "piercing" | "bounce";

type TemplateWeaponProfileDefinition = WeaponDefinition & {
  readonly action: TemplateWeaponProfileId;
  readonly projectile: ProjectileDefinition;
};

const TEMPLATE_WEAPON_ACTION_IDS: Record<TemplateWeaponProfileId, number> = {
  standard: 1,
  piercing: 4,
  bounce: 5,
};

const TEMPLATE_WEAPON_PROFILE_DEFINITIONS: readonly TemplateWeaponProfileDefinition[] = [
  {
    id: "standard",
    action: "standard",
    cooldownSeconds: 0.08,
    projectile: {
      id: "standard-shot",
      speed: 720,
      damage: 1,
      lifetimeSeconds: 1.6,
    },
  },
  {
    id: "piercing",
    action: "piercing",
    projectile: {
      id: "piercing-shot",
      speed: 520,
      collisionTarget: "enemies",
      tileImpact: "passThrough",
    },
  },
  {
    id: "bounce",
    action: "bounce",
    cooldownSeconds: 0.1,
    projectile: {
      id: "bounce-shot",
      speed: 420,
      damage: 2,
      lifetimeSeconds: 1,
      tileImpact: "bounce",
    },
  },
] as const;

const TEMPLATE_WEAPON_PROFILES = compileWeaponProfiles(TEMPLATE_WEAPON_PROFILE_DEFINITIONS, {
  path: "template.weaponProfiles",
  actionIds: TEMPLATE_WEAPON_ACTION_IDS,
});

const TEMPLATE_WEAPON_PROFILE_DEFAULT: TemplateWeaponProfileId = "standard";

interface MinimalTemplateWindow extends Window {
  ferrumEngine?: FerrumEngine;
  ferrumRuntime?: FerrumRuntime;
  ferrumTemplateWeaponProfile?: TemplateWeaponProfileId;
}

function gameStateLabel(code: number): string {
  if (code === 0) return "Title";
  if (code === 1) return "Playing";
  return "GameOver";
}

function diagnosticRows(report: DiagnosticReport): Array<[string, string]> {
  const rows: Array<[string, string]> = [["code", report.code], ["message", report.message]];
  if (report.context) appendDiagnosticContext(rows, report.context);
  return rows;
}

function appendDiagnosticContext(rows: Array<[string, string]>, context: DiagnosticContext): void {
  rows.push(["kind", context.kind]);
  if (context.name !== undefined) rows.push(["name", context.name]);
  if (context.id !== undefined) rows.push(["id", String(context.id)]);
  if (context.url !== undefined) rows.push(["url", context.url]);
  if (context.path !== undefined) rows.push(["path", context.path]);
  rows.push(["detail", context.detail]);
}

function renderStartupError(error: unknown): void {
  console.error("Ferrum2D startup failed", error);
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  const report = diagnosticReport(error);
  const container = document.createElement("main");
  const title = document.createElement("h1");
  const summary = document.createElement("p");
  const list = document.createElement("dl");
  container.className = "error-shell";
  title.textContent = "__PROJECT_TITLE__";
  summary.textContent = "Startup failed.";

  for (const [label, value] of diagnosticRows(report)) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    list.append(term, description);
  }

  container.append(title, summary, list);
  app.replaceChildren(container);
}

function createButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function createShell(): {
  canvas: HTMLCanvasElement;
  canvasFrame: HTMLElement;
  debugRoot: HTMLElement;
  stateValue: HTMLElement;
  entityValue: HTMLElement;
  commandValue: HTMLElement;
  fpsValue: HTMLElement;
  weaponValue: HTMLElement;
  setEngine(engine: FerrumEngine): void;
  queueStart(): void;
  inputSnapshot(snapshot: InputSnapshot): InputSnapshot;
} {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("Missing #app root element.");
  }

  let engine: FerrumEngine | undefined;
  let startQueued = false;
  let restartQueued = false;
  const shell = document.createElement("main");
  const toolbar = document.createElement("section");
  const title = document.createElement("h1");
  const actions = document.createElement("div");
  const stage = document.createElement("section");
  const canvasFrame = document.createElement("div");
  const canvas = document.createElement("canvas");
  const metrics = document.createElement("dl");
  const debugRoot = document.createElement("div");
  const stateValue = document.createElement("dd");
  const entityValue = document.createElement("dd");
  const commandValue = document.createElement("dd");
  const fpsValue = document.createElement("dd");
  const weaponValue = document.createElement("dd");

  shell.className = "app-shell";
  toolbar.className = "toolbar";
  actions.className = "actions";
  stage.className = "stage";
  canvasFrame.className = "canvas-frame";
  canvas.className = "game-canvas";
  metrics.className = "metrics";
  debugRoot.className = "debug-root";

  title.textContent = "__PROJECT_TITLE__";
  canvas.width = 800;
  canvas.height = 480;

  actions.append(
    createButton("Start", () => {
      if (engine?.gameState() === 2) {
        restartQueued = true;
      } else {
        startQueued = true;
      }
    }),
    createButton("Pause", () => engine?.pause()),
    createButton("Resume", () => engine?.resume()),
  );

  appendMetric(metrics, "state", stateValue);
  appendMetric(metrics, "entities", entityValue);
  appendMetric(metrics, "commands", commandValue);
  appendMetric(metrics, "fps", fpsValue);
  appendMetric(metrics, "weapon", weaponValue);

  toolbar.append(title, actions);
  canvasFrame.append(canvas);
  stage.append(canvasFrame, metrics);
  shell.append(toolbar, stage, debugRoot);
  app.replaceChildren(shell);

  return {
    canvas,
    canvasFrame,
    debugRoot,
    stateValue,
    entityValue,
    commandValue,
    fpsValue,
    weaponValue,
    setEngine(nextEngine) {
      engine = nextEngine;
    },
    queueStart() {
      startQueued = true;
    },
    inputSnapshot(snapshot) {
      if (startQueued) {
        startQueued = false;
        return { ...snapshot, enter: true };
      }
      if (restartQueued) {
        restartQueued = false;
        return { ...snapshot, space: true };
      }
      return snapshot;
    },
  };

  function appendMetric(parent: HTMLElement, label: string, value: HTMLElement): void {
    const term = document.createElement("dt");
    term.textContent = label;
    value.textContent = "-";
    parent.append(term, value);
  }
}

function runtimeUiState(
  frame: { gameState: number; score: number; entityCount: number },
  renderCommandCount: number,
  fps: number,
  weaponProfile: TemplateWeaponProfileId,
): UiOverlayState {
  return {
    panels: [{
      id: "starter-hud",
      title: "Runtime HUD",
      region: "top-left",
      lines: [
        { id: "state", label: "State", value: gameStateLabel(frame.gameState) },
        { id: "score", label: "Score", value: frame.score },
        { id: "entities", label: "Entities", value: frame.entityCount },
        { id: "commands", label: "Commands", value: renderCommandCount },
        { id: "fps", label: "FPS", value: fps.toFixed(1), tone: "accent" },
        { id: "weapon", label: "Weapon", value: weaponProfile },
      ],
    }],
    dialog: frame.gameState === 0
      ? {
        id: "title",
        title: "Ready",
        body: "Start the runtime loop.",
        actions: [{ id: "start", label: "Start", tone: "primary" }],
      }
      : undefined,
  };
}

async function bootstrap(): Promise<void> {
  const shell = createShell();
  const searchParams = new URLSearchParams(window.location.search);
  const weaponProfile = resolveTemplateWeaponProfile(searchParams);
  const weaponActionId = TEMPLATE_WEAPON_ACTION_IDS[weaponProfile];
  const runtime = await createFerrumRuntime({
    canvas: shell.canvas,
    debugParent: shell.debugRoot,
    environment: "development",
    webgl2: {
      clearColor: [0.07, 0.09, 0.11, 1],
    },
    uiParent: shell.canvasFrame,
    ui: {
      onAction: (event) => {
        if (event.id === "start") shell.queueStart();
      },
    },
    uiState: ({ frame, rendererStats, fps }) => runtimeUiState(
      frame,
      rendererStats.renderCommandCount,
      fps,
      weaponProfile,
    ),
    inputTransform: (snapshot) => shell.inputSnapshot(snapshot),
    onFrame: ({ frame, rendererStats, fps }) => {
      shell.stateValue.textContent = gameStateLabel(frame.gameState);
      shell.entityValue.textContent = String(frame.entityCount);
      shell.commandValue.textContent = String(rendererStats.renderCommandCount);
      shell.fpsValue.textContent = fps.toFixed(1);
      shell.weaponValue.textContent = weaponProfile;
    },
  });

  runtime.engine.setTextureIds({ player: 0, enemy: 0, bullet: 0 });
  requireInputActionBinding(runtime, weaponActionId, 0, {
    control: "space",
    activation: "down",
  });
  requireInputActionBinding(runtime, weaponActionId, 1, {
    control: "mouseLeft",
    activation: "down",
  });
  applyTemplateWeaponProfile(runtime.engine, weaponProfile);
  shell.setEngine(runtime.engine);
  runtime.start();
  shell.queueStart();

  const runtimeWindow = window as MinimalTemplateWindow;
  runtimeWindow.ferrumEngine = runtime.engine;
  runtimeWindow.ferrumRuntime = runtime;
  runtimeWindow.ferrumTemplateWeaponProfile = weaponProfile;
  window.addEventListener("beforeunload", () => runtime.destroy(), { once: true });
}

function applyTemplateWeaponProfile(engine: FerrumEngine, profile: TemplateWeaponProfileId): void {
  const commands = behaviorRecipeCommandsForEntity(TEMPLATE_WEAPON_PROFILES, profile);
  const player = engine.builtInShooterPlayerHandle();
  if (player === undefined) {
    throw new Error("minimal template: builtInShooterPlayerHandle is not available for weapon profile setup.");
  }
  engine.applyGameplayBehaviorCommands(
    commands,
    { [profile]: player },
    { path: "template.weaponProfiles.apply" },
  );
}

function resolveTemplateWeaponProfile(searchParams: URLSearchParams): TemplateWeaponProfileId {
  const raw = searchParams.get("profile");
  if (raw === null) {
    return TEMPLATE_WEAPON_PROFILE_DEFAULT;
  }
  const normalized = raw.trim().toLowerCase();
  return isTemplateWeaponProfileId(normalized) ? normalized : TEMPLATE_WEAPON_PROFILE_DEFAULT;
}

function isTemplateWeaponProfileId(value: string): value is TemplateWeaponProfileId {
  return value === "standard" || value === "piercing" || value === "bounce";
}

function requireInputActionBinding(
  runtime: FerrumRuntime,
  actionId: number,
  bindingIndex: number,
  binding: Parameters<FerrumEngine["setInputActionBinding"]>[2],
): void {
  const bound = runtime.engine.setInputActionBinding(actionId, bindingIndex, binding);
  if (!bound) {
    throw new Error(`minimal template: failed to bind actionId=${actionId} at index=${bindingIndex}`);
  }
}

void bootstrap().catch(renderStartupError);
