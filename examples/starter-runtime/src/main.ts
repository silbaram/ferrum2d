import {
  captureGameStateSnapshot,
  createFerrumRuntime,
  hashGameStateSnapshot,
  type FerrumRuntime,
  type FerrumRuntimeEnvironment,
  type GameStateSnapshot,
} from "@ferrum2d/ferrum-web/core";
import {
  behaviorRecipeCommandsForEntity,
  compileWeaponProfiles,
  projectile,
  weapon,
  type ProjectileDefinition,
  type WeaponDefinition,
} from "@ferrum2d/ferrum-web/authoring";
import {
  compareGameplayReplayRuns,
  createGameplayReplayRun,
  diagnosticReport,
  type GameplayReplayComparison,
  type GameplayReplayRun,
} from "@ferrum2d/ferrum-web/quality";

import {
  createRuntimeDemoShell,
  renderRuntimeDemoError,
} from "../../shared/runtimeDemoShell";
import "../../shared/runtimeDemoShell.css";
import "./styles.css";

const STARTER_RUNTIME_REPORT_FORMAT = "ferrum2d.starter-runtime.report";
const STARTER_RUNTIME_REPORT_VERSION = 1;
const STARTER_PRIMARY_ACTION = "primary";
const STARTER_PRIMARY_ACTION_ID = 1;
const STARTER_WEAPON_PROFILE_IDS = ["standard", "piercing", "bounce"] as const;
type StarterWeaponProfileId = typeof STARTER_WEAPON_PROFILE_IDS[number];

const STARTER_WEAPON_PROFILE_ACTION_IDS: Record<typeof STARTER_PRIMARY_ACTION, number> = {
  [STARTER_PRIMARY_ACTION]: STARTER_PRIMARY_ACTION_ID,
};

type StarterWeaponProfileDefinition = WeaponDefinition & {
  readonly id: StarterWeaponProfileId;
  readonly action: typeof STARTER_PRIMARY_ACTION;
  readonly projectile: ProjectileDefinition;
};

interface StarterProjectileVisual {
  readonly textureId: number;
  readonly label: string;
  readonly accentColor: string;
  readonly width: number;
  readonly height: number;
}

interface StarterWeaponProfileCatalogEntry {
  readonly id: StarterWeaponProfileId;
  readonly label: string;
  readonly summary: string;
  readonly cooldownSeconds: number;
  readonly projectile: Required<Pick<ProjectileDefinition, "speed" | "damage" | "lifetimeSeconds">>
    & Pick<ProjectileDefinition, "collisionTarget" | "tileImpact">;
  readonly visual: StarterProjectileVisual;
}

const STARTER_WEAPON_PROFILE_CATALOG: Record<StarterWeaponProfileId, StarterWeaponProfileCatalogEntry> = {
  standard: {
    id: "standard",
    label: "Standard",
    summary: "Tiny rapid pellet with the fastest fire rate.",
    cooldownSeconds: 0.055,
    projectile: {
      speed: 920,
      damage: 1,
      lifetimeSeconds: 1.25,
      collisionTarget: "enemies",
      tileImpact: "despawn",
    },
    visual: {
      textureId: 21,
      label: "Tiny green pellet",
      accentColor: "#7ddc9d",
      width: 6,
      height: 6,
    },
  },
  piercing: {
    id: "piercing",
    label: "Piercing",
    summary: "Long spear projectile with a slower deliberate cadence.",
    cooldownSeconds: 0.22,
    projectile: {
      speed: 640,
      damage: 1,
      lifetimeSeconds: 2.1,
      collisionTarget: "enemies",
      tileImpact: "passThrough",
    },
    visual: {
      textureId: 22,
      label: "Long cyan spear",
      accentColor: "#67e8f9",
      width: 20,
      height: 5,
    },
  },
  bounce: {
    id: "bounce",
    label: "Bounce",
    summary: "Large slow orb with the heaviest hit and bounce behavior.",
    cooldownSeconds: 0.42,
    projectile: {
      speed: 260,
      damage: 3,
      lifetimeSeconds: 1.6,
      collisionTarget: "enemies",
      tileImpact: "bounce",
    },
    visual: {
      textureId: 23,
      label: "Large amber orb",
      accentColor: "#f59e0b",
      width: 18,
      height: 18,
    },
  },
};

const STARTER_RUNTIME_WEAPON_PROFILE_DEFINITIONS: readonly StarterWeaponProfileDefinition[] =
  STARTER_WEAPON_PROFILE_IDS.map((profileId) => starterWeaponProfileDefinition(profileId));

const STARTER_RUNTIME_WEAPON_PROFILES = compileWeaponProfiles(STARTER_RUNTIME_WEAPON_PROFILE_DEFINITIONS, {
  path: "starterRuntime.weaponProfiles",
  actionIds: STARTER_WEAPON_PROFILE_ACTION_IDS,
});

const STARTER_WEAPON_PROFILE_DEFAULT: StarterWeaponProfileId = "standard";

type StarterRuntimeReportLabel = "bootstrap" | "manual" | "smoke";

interface StarterRuntimeReport {
  readonly format: typeof STARTER_RUNTIME_REPORT_FORMAT;
  readonly version: typeof STARTER_RUNTIME_REPORT_VERSION;
  readonly label: StarterRuntimeReportLabel;
  readonly frame: number;
  readonly timeSeconds: number;
  readonly snapshotHash: string;
  readonly baselineReplayHash: string;
  readonly replayHash: string;
  readonly comparison: GameplayReplayComparison;
  readonly weaponProfile: StarterWeaponProfileId;
  readonly weaponProfileSummary: string;
  readonly projectileVisual: string;
  readonly projectileTextureId: number;
  readonly projectileWidth: number;
  readonly projectileHeight: number;
  readonly fireCooldownSeconds: number;
  readonly profileSwitchCount: number;
  readonly captureCount: number;
  readonly lastPanelAction: string;
  readonly snapshot: GameStateSnapshot;
  readonly replay: GameplayReplayRun;
}

interface StarterRuntimeReportHooks {
  publish(label: StarterRuntimeReportLabel): StarterRuntimeReport;
  uninstall(): void;
}

interface StarterRuntimeWindow extends Window {
  ferrumStarterRuntimeReport?: StarterRuntimeReport;
  ferrumStarterRuntimeCaptureReport?: () => StarterRuntimeReport;
  ferrumStarterRuntimeApplyWeaponProfile?: (profile: string) => StarterRuntimeReport;
  ferrumStarterRuntimeWeaponProfile?: StarterWeaponProfileId;
}

interface StarterRuntimeDemoState {
  selectedProfile: StarterWeaponProfileId;
  latestReport?: StarterRuntimeReport;
  profileSwitchCount: number;
  captureCount: number;
  lastPanelAction: string;
}

interface StarterRuntimeControlPanel {
  readonly element: HTMLElement;
  update(): void;
  destroy(): void;
}

async function bootstrap(): Promise<void> {
  const shell = createRuntimeDemoShell({
    title: "Starter Runtime",
    frameProperty: "ferrumStarterRuntimeFrame",
  });
  let runtime: FerrumRuntime | undefined;
  let reportHooks: StarterRuntimeReportHooks | undefined;
  let controlPanel: StarterRuntimeControlPanel | undefined;
  let smokeReportCaptured = false;

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const debugParam = searchParams.get("debug");
    const environment: FerrumRuntimeEnvironment = searchParams.get("environment") === "production"
      ? "production"
      : "development";
    const preserveDrawingBuffer = searchParams.get("preserveDrawingBuffer") === "true";
    const profilerSmoke = searchParams.get("profilerSmoke") === "true";
    const reportSmoke = searchParams.get("reportSmoke") === "true";
    const weaponProfile = resolveStarterWeaponProfile(searchParams);
    const demoState: StarterRuntimeDemoState = {
      selectedProfile: weaponProfile,
      profileSwitchCount: 0,
      captureCount: 0,
      lastPanelAction: `${STARTER_WEAPON_PROFILE_CATALOG[weaponProfile].label} loaded`,
    };

    runtime = await createFerrumRuntime({
      canvas: shell.canvas,
      debugParent: shell.debugRoot,
      debug: { enabled: debugParam === "true" },
      environment,
      gameStateLabel: starterRuntimeStateLabel,
      profiler: profilerSmoke,
      webgl2: {
        clearColor: [0.09, 0.11, 0.1, 1],
        preserveDrawingBuffer,
      },
      uiParent: shell.stage,
      ui: {
        onAction: (event) => {
          if (event.id === "start") {
            shell.queueStart();
          }
        },
      },
      uiState: () => ({ dialog: shell.uiState().dialog }),
      inputTransform: shell.inputTransform,
      onFrame: (frame) => {
        shell.updateFrame(frame);
        if (
          reportSmoke
          && runtime !== undefined
          && reportHooks !== undefined
          && !smokeReportCaptured
          && frame.frame.timeSeconds > 0
        ) {
          reportHooks.publish("smoke");
          smokeReportCaptured = true;
        }
      },
    });

    await loadStarterRuntimeProjectileTextures(runtime);
    controlPanel = createStarterRuntimeControlPanel(demoState, {
      onProfile: (profile) => {
        if (runtime === undefined) {
          return;
        }
        switchStarterRuntimeWeaponProfile(runtime, demoState, profile);
        if (reportHooks?.publish("manual") === undefined) {
          controlPanel?.update();
        }
      },
      onCapture: () => {
        demoState.captureCount += 1;
        demoState.lastPanelAction = `Report captured #${demoState.captureCount}`;
        if (reportHooks?.publish("manual") === undefined) {
          controlPanel?.update();
        }
      },
    });
    shell.stage.append(controlPanel.element);

    requireInputActionBinding(runtime, STARTER_PRIMARY_ACTION_ID, 0, {
      control: "space",
      activation: "down",
    });
    requireInputActionBinding(runtime, STARTER_PRIMARY_ACTION_ID, 1, {
      control: "mouseLeft",
      activation: "down",
    });
    applyStarterRuntimeWeaponProfile(runtime, weaponProfile);
    shell.attachRuntime(runtime);
    reportHooks = installStarterRuntimeReportHooks(runtime, demoState, () => controlPanel?.update());
    runtime.start();
    shell.queueStart();
    reportHooks.publish("bootstrap");
  } catch (error) {
    controlPanel?.destroy();
    reportHooks?.uninstall();
    runtime?.destroy();
    shell.destroy();
    throw error;
  }
}

function installStarterRuntimeReportHooks(
  runtime: FerrumRuntime,
  demoState: StarterRuntimeDemoState,
  onReportUpdated?: () => void,
): StarterRuntimeReportHooks {
  const target = window as StarterRuntimeWindow;
  const baselineReplayByProfile: Partial<Record<StarterWeaponProfileId, GameplayReplayRun>> = {};
  target.ferrumStarterRuntimeWeaponProfile = demoState.selectedProfile;

  const publish = (label: StarterRuntimeReportLabel): StarterRuntimeReport => {
    const weaponProfile = demoState.selectedProfile;
    const baselineReplay = baselineReplayByProfile[weaponProfile];
    const hasBaselineReplay = baselineReplay !== undefined;
    const report = createStarterRuntimeReport(runtime, label, baselineReplay, demoState);
    if (!hasBaselineReplay) {
      baselineReplayByProfile[weaponProfile] = report.replay;
    }
    demoState.latestReport = report;
    target.ferrumStarterRuntimeReport = report;
    onReportUpdated?.();
    return report;
  };
  target.ferrumStarterRuntimeCaptureReport = () => publish("manual");
  target.ferrumStarterRuntimeApplyWeaponProfile = (profile: string) => {
    const nextProfile = parseStarterWeaponProfile(profile);
    if (nextProfile === undefined) {
      throw new Error(`starter-runtime: unknown weapon profile '${profile}'.`);
    }
    switchStarterRuntimeWeaponProfile(runtime, demoState, nextProfile);
    return publish("manual");
  };
  return {
    publish,
    uninstall: () => {
      delete target.ferrumStarterRuntimeReport;
      delete target.ferrumStarterRuntimeCaptureReport;
      delete target.ferrumStarterRuntimeApplyWeaponProfile;
      delete target.ferrumStarterRuntimeWeaponProfile;
    },
  };
}

function createStarterRuntimeReport(
  runtime: FerrumRuntime,
  label: StarterRuntimeReportLabel,
  baselineReplay: GameplayReplayRun | undefined,
  demoState: StarterRuntimeDemoState,
): StarterRuntimeReport {
  const weaponProfile = demoState.selectedProfile;
  const profile = STARTER_WEAPON_PROFILE_CATALOG[weaponProfile];
  const timeSeconds = runtime.engine.time();
  const frame = runtimeFrameIndex(timeSeconds);
  const snapshot = captureGameStateSnapshot(runtime.engine, {
    frame,
    includeBuiltInShooterState: true,
    customState: {
      example: "starter-runtime",
      label,
      weaponProfile,
      profileSwitchCount: demoState.profileSwitchCount,
      captureCount: demoState.captureCount,
      lastPanelAction: demoState.lastPanelAction,
      projectileVisual: profile.visual.label,
      projectileTextureId: profile.visual.textureId,
      projectileWidth: profile.visual.width,
      projectileHeight: profile.visual.height,
      fireCooldownSeconds: profile.cooldownSeconds,
      renderer: starterRuntimeRendererName(runtime),
      stateLabel: starterRuntimeStateLabel(runtime.engine.gameState()),
    },
  });
  const replay = createGameplayReplayRun([snapshot], {
    path: "starterRuntime.replay",
  });
  const resolvedBaselineReplay = baselineReplay ?? replay;

  return {
    format: STARTER_RUNTIME_REPORT_FORMAT,
    version: STARTER_RUNTIME_REPORT_VERSION,
    label,
    frame,
    timeSeconds,
    snapshotHash: hashGameStateSnapshot(snapshot),
    baselineReplayHash: resolvedBaselineReplay.replayHash,
    replayHash: replay.replayHash,
    comparison: compareGameplayReplayRuns(resolvedBaselineReplay, replay),
    weaponProfile,
    weaponProfileSummary: profile.summary,
    projectileVisual: profile.visual.label,
    projectileTextureId: profile.visual.textureId,
    projectileWidth: profile.visual.width,
    projectileHeight: profile.visual.height,
    fireCooldownSeconds: profile.cooldownSeconds,
    profileSwitchCount: demoState.profileSwitchCount,
    captureCount: demoState.captureCount,
    lastPanelAction: demoState.lastPanelAction,
    snapshot,
    replay,
  };
}

function runtimeFrameIndex(timeSeconds: number): number {
  if (!Number.isFinite(timeSeconds) || timeSeconds <= 0) {
    return 0;
  }
  return Math.round(timeSeconds * 60);
}

function starterRuntimeRendererName(runtime: FerrumRuntime): "webgpu" | "webgl2" {
  return "gpuDevice" in runtime.renderer ? "webgpu" : "webgl2";
}

function starterRuntimeStateLabel(code: number): string {
  switch (code) {
    case 0:
      return "title";
    case 1:
      return "playing";
    case 2:
      return "game-over";
    default:
      return `state-${code}`;
  }
}

function applyStarterRuntimeWeaponProfile(runtime: FerrumRuntime, profile: StarterWeaponProfileId): void {
  applyStarterRuntimeWeaponVisual(runtime, profile);
  const profileCommands = behaviorRecipeCommandsForEntity(
    STARTER_RUNTIME_WEAPON_PROFILES,
    profile,
  );
  const builtInPlayerHandle = runtime.engine.builtInShooterPlayerHandle();
  if (builtInPlayerHandle === undefined) {
    throw new Error("starter-runtime: builtInShooterPlayerHandle is not available for weapon profile setup.");
  }
  runtime.engine.applyGameplayBehaviorCommands(profileCommands, {
    [profile]: builtInPlayerHandle,
  }, {
    path: "starterRuntime.weaponProfiles.apply",
  });
}

function applyStarterRuntimeWeaponVisual(runtime: FerrumRuntime, profile: StarterWeaponProfileId): void {
  const visual = STARTER_WEAPON_PROFILE_CATALOG[profile].visual;
  runtime.engine.setShooterAtlasFrame("bullet", {
    texture: visual.textureId,
    width: visual.width,
    height: visual.height,
  });
}

function switchStarterRuntimeWeaponProfile(
  runtime: FerrumRuntime,
  demoState: StarterRuntimeDemoState,
  profile: StarterWeaponProfileId,
): void {
  const nextProfile = STARTER_WEAPON_PROFILE_CATALOG[profile];
  if (demoState.selectedProfile === profile) {
    demoState.lastPanelAction = `${nextProfile.label} already active`;
    return;
  }
  applyStarterRuntimeWeaponProfile(runtime, profile);
  demoState.selectedProfile = profile;
  demoState.profileSwitchCount += 1;
  demoState.lastPanelAction = `${nextProfile.label} applied`;
  (window as StarterRuntimeWindow).ferrumStarterRuntimeWeaponProfile = profile;
}

function createStarterRuntimeControlPanel(
  demoState: StarterRuntimeDemoState,
  options: {
    onProfile(profile: StarterWeaponProfileId): void;
    onCapture(): void;
  },
): StarterRuntimeControlPanel {
  const element = document.createElement("section");
  element.className = "starter-profile-panel";
  element.setAttribute("aria-label", "Starter Runtime weapon profile");
  element.setAttribute("data-starter-runtime-profile-panel", "true");

  const update = (): void => {
    const profile = STARTER_WEAPON_PROFILE_CATALOG[demoState.selectedProfile];
    const report = demoState.latestReport;
    const title = document.createElement("h2");
    const summary = document.createElement("p");
    const details = document.createElement("dl");
    const actions = document.createElement("div");

    title.textContent = "Weapon Profile";
    summary.textContent = profile.summary;
    details.className = "starter-profile-details";
    actions.className = "starter-profile-actions";

    appendStarterProfileDetail(details, "Status", demoState.lastPanelAction);
    appendStarterProfileDetail(details, "Profile", profile.label);
    appendStarterProfileDetail(details, "Shot", `${profile.projectile.speed} / dmg ${profile.projectile.damage}`);
    appendStarterProfileDetail(details, "Rate", starterFireRateLabel(profile.cooldownSeconds));
    appendStarterProfileDetail(details, "Size", `${profile.visual.width}x${profile.visual.height}`);
    appendStarterProfileDetail(details, "Tile", profile.projectile.tileImpact ?? "despawn");
    appendStarterProfileVisualDetail(details, "Visual", profile.visual);
    appendStarterProfileDetail(details, "Replay", report === undefined ? "pending" : shortHash(report.replayHash));
    appendStarterProfileDetail(details, "Reports", demoState.captureCount);

    for (const profileId of STARTER_WEAPON_PROFILE_IDS) {
      actions.appendChild(starterControlButton(
        STARTER_WEAPON_PROFILE_CATALOG[profileId].label,
        profileId === demoState.selectedProfile,
        () => options.onProfile(profileId),
        { "data-starter-profile-button": profileId },
      ));
    }
    actions.appendChild(starterControlButton("Capture Report", false, options.onCapture, {
      "data-starter-capture-button": "true",
      "aria-label": "Capture runtime report",
    }));
    element.replaceChildren(title, summary, details, actions);
  };

  update();
  return {
    element,
    update,
    destroy: () => element.remove(),
  };
}

function appendStarterProfileDetail(parent: HTMLElement, label: string, value: string | number): void {
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = String(value);
  parent.append(term, description);
}

function appendStarterProfileVisualDetail(parent: HTMLElement, label: string, visual: StarterProjectileVisual): void {
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  const swatch = document.createElement("span");
  const text = document.createElement("span");
  term.textContent = label;
  description.className = "starter-profile-visual";
  swatch.className = "starter-profile-swatch";
  swatch.style.background = visual.accentColor;
  text.textContent = visual.label;
  description.append(swatch, text);
  parent.append(term, description);
}

function starterControlButton(
  label: string,
  active: boolean,
  onClick: () => void,
  attributes: Readonly<Record<string, string>> = {},
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = active ? "starter-profile-button is-active" : "starter-profile-button";
  button.setAttribute("aria-pressed", String(active));
  for (const [name, value] of Object.entries(attributes)) {
    button.setAttribute(name, value);
  }
  button.addEventListener("click", onClick);
  return button;
}

async function loadStarterRuntimeProjectileTextures(runtime: FerrumRuntime): Promise<void> {
  await Promise.all(STARTER_WEAPON_PROFILE_IDS.map(async (profileId) => {
    const profile = STARTER_WEAPON_PROFILE_CATALOG[profileId];
    await runtime.renderer.loadTexture(
      profile.visual.textureId,
      starterRuntimeProjectileTextureDataUrl(profileId),
    );
  }));
}

function starterRuntimeProjectileTextureDataUrl(profileId: StarterWeaponProfileId): string {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("starter-runtime: failed to create projectile texture canvas.");
  }
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (profileId === "standard") {
    context.fillStyle = "#14532d";
    context.fillRect(12, 12, 8, 8);
    context.fillStyle = "#7ddc9d";
    context.fillRect(14, 10, 4, 12);
    context.fillRect(10, 14, 12, 4);
    context.fillStyle = "#dcfce7";
    context.fillRect(15, 15, 2, 2);
  } else if (profileId === "piercing") {
    context.fillStyle = "#164e63";
    context.fillRect(2, 13, 24, 6);
    context.fillStyle = "#67e8f9";
    context.fillRect(4, 14, 20, 4);
    context.beginPath();
    context.moveTo(24, 10);
    context.lineTo(31, 16);
    context.lineTo(24, 22);
    context.closePath();
    context.fill();
    context.fillStyle = "#ecfeff";
    context.fillRect(18, 15, 8, 2);
  } else {
    context.fillStyle = "#7c2d12";
    context.beginPath();
    context.arc(16, 16, 15, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#f59e0b";
    context.beginPath();
    context.arc(16, 16, 13, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#451a03";
    context.beginPath();
    context.arc(16, 16, 5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#fef3c7";
    context.fillRect(21, 7, 4, 4);
  }

  return canvas.toDataURL("image/png");
}

function starterFireRateLabel(cooldownSeconds: number): string {
  return `${(1 / cooldownSeconds).toFixed(1)} /s`;
}

function starterWeaponProfileDefinition(profileId: StarterWeaponProfileId): StarterWeaponProfileDefinition {
  const profile = STARTER_WEAPON_PROFILE_CATALOG[profileId];
  const projectileDefinition = projectile(`${profile.id}-shot`)
    .speed(profile.projectile.speed)
    .damage(profile.projectile.damage)
    .lifetime(profile.projectile.lifetimeSeconds)
    .collisionTarget(profile.projectile.collisionTarget ?? "enemies")
    .tileImpact(profile.projectile.tileImpact ?? "despawn");
  return weapon(profile.id)
    .action(STARTER_PRIMARY_ACTION)
    .actionId(STARTER_PRIMARY_ACTION_ID)
    .cooldown(profile.cooldownSeconds)
    .fire(projectileDefinition)
    .build() as StarterWeaponProfileDefinition;
}

function resolveStarterWeaponProfile(searchParams: URLSearchParams): StarterWeaponProfileId {
  const raw = searchParams.get("profile");
  if (raw === null) {
    return STARTER_WEAPON_PROFILE_DEFAULT;
  }
  return parseStarterWeaponProfile(raw) ?? STARTER_WEAPON_PROFILE_DEFAULT;
}

function parseStarterWeaponProfile(value: string): StarterWeaponProfileId | undefined {
  const normalized = value.trim().toLowerCase();
  return isStarterWeaponProfileId(normalized) ? normalized : undefined;
}

function isStarterWeaponProfileId(value: string): value is StarterWeaponProfileId {
  return (STARTER_WEAPON_PROFILE_IDS as readonly string[]).includes(value);
}

function shortHash(value: string): string {
  return value.length <= 8 ? value : value.slice(0, 8);
}

function requireInputActionBinding(
  runtime: FerrumRuntime,
  actionId: number,
  bindingIndex: number,
  binding: Parameters<FerrumRuntime["engine"]["setInputActionBinding"]>[2],
): void {
  const bound = runtime.engine.setInputActionBinding(actionId, bindingIndex, binding);
  if (!bound) {
    throw new Error(`starter-runtime: failed to bind actionId=${actionId} at index=${bindingIndex}`);
  }
}

void bootstrap().catch((error) => {
  renderRuntimeDemoError(error, {
    title: "Starter Runtime",
    diagnosticReport,
  });
});
