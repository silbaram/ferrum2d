import {
  captureGameStateSnapshot,
  compareGameplayReplayRuns,
  behaviorRecipeCommandsForEntity,
  createFerrumRuntime,
  createGameplayReplayRun,
  diagnosticReport,
  compileWeaponProfiles,
  hashGameStateSnapshot,
  type FerrumRuntime,
  type FerrumRuntimeEnvironment,
  type GameStateSnapshot,
  type GameplayReplayComparison,
  type GameplayReplayRun,
  type ProjectileDefinition,
  type WeaponDefinition,
} from "@ferrum2d/ferrum-web";

import {
  createRuntimeDemoShell,
  renderRuntimeDemoError,
} from "../../shared/runtimeDemoShell";
import "../../shared/runtimeDemoShell.css";
import "./styles.css";

const STARTER_RUNTIME_REPORT_FORMAT = "ferrum2d.starter-runtime.report";
const STARTER_RUNTIME_REPORT_VERSION = 1;
type StarterWeaponProfileId = "standard" | "piercing" | "bounce";

const STARTER_WEAPON_PROFILE_ACTION_IDS: Record<StarterWeaponProfileId, number> = {
  standard: 1,
  piercing: 2,
  bounce: 3,
};

type StarterWeaponProfileDefinition = WeaponDefinition & {
  readonly action: StarterWeaponProfileId;
  readonly projectile: ProjectileDefinition;
};

const STARTER_RUNTIME_WEAPON_PROFILE_DEFINITIONS: readonly StarterWeaponProfileDefinition[] = [
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
  ferrumStarterRuntimeWeaponProfile?: StarterWeaponProfileId;
}

async function bootstrap(): Promise<void> {
  const shell = createRuntimeDemoShell({
    title: "Starter Runtime",
    frameProperty: "ferrumStarterRuntimeFrame",
  });
  let runtime: FerrumRuntime | undefined;
  let reportHooks: StarterRuntimeReportHooks | undefined;
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
    const weaponActionId = STARTER_WEAPON_PROFILE_ACTION_IDS[weaponProfile];

    runtime = await createFerrumRuntime({
      canvas: shell.canvas,
      debugParent: shell.debugRoot,
      debug: debugParam === null ? undefined : { enabled: debugParam !== "false" },
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
      uiState: () => shell.uiState(),
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

    runtime.engine.setTextureIds({ player: 0, enemy: 0, bullet: 0 });
    requireInputActionBinding(runtime, weaponActionId, 0, {
      control: "space",
      activation: "down",
    });
    requireInputActionBinding(runtime, weaponActionId, 1, {
      control: "mouseLeft",
      activation: "down",
    });
    applyStarterRuntimeWeaponProfile(runtime, weaponProfile);
    shell.attachRuntime(runtime);
    reportHooks = installStarterRuntimeReportHooks(runtime, weaponProfile);
    runtime.start();
    shell.queueStart();
    reportHooks.publish("bootstrap");
  } catch (error) {
    reportHooks?.uninstall();
    runtime?.destroy();
    shell.destroy();
    throw error;
  }
}

function installStarterRuntimeReportHooks(
  runtime: FerrumRuntime,
  weaponProfile: StarterWeaponProfileId,
): StarterRuntimeReportHooks {
  const target = window as StarterRuntimeWindow;
  let baselineReplay: GameplayReplayRun | undefined;
  target.ferrumStarterRuntimeWeaponProfile = weaponProfile;

  const publish = (label: StarterRuntimeReportLabel): StarterRuntimeReport => {
    const hasBaselineReplay = baselineReplay !== undefined;
    const report = createStarterRuntimeReport(runtime, label, baselineReplay, weaponProfile);
    if (!hasBaselineReplay) {
      baselineReplay = report.replay;
    }
    target.ferrumStarterRuntimeReport = report;
    return report;
  };
  target.ferrumStarterRuntimeCaptureReport = () => publish("manual");
  return {
    publish,
    uninstall: () => {
      delete target.ferrumStarterRuntimeReport;
      delete target.ferrumStarterRuntimeCaptureReport;
      delete target.ferrumStarterRuntimeWeaponProfile;
    },
  };
}

function createStarterRuntimeReport(
  runtime: FerrumRuntime,
  label: StarterRuntimeReportLabel,
  baselineReplay: GameplayReplayRun | undefined,
  weaponProfile: StarterWeaponProfileId,
): StarterRuntimeReport {
  const timeSeconds = runtime.engine.time();
  const frame = runtimeFrameIndex(timeSeconds);
  const snapshot = captureGameStateSnapshot(runtime.engine, {
    frame,
    includeBuiltInShooterState: true,
    customState: {
      example: "starter-runtime",
      label,
      weaponProfile,
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

function resolveStarterWeaponProfile(searchParams: URLSearchParams): StarterWeaponProfileId {
  const raw = searchParams.get("profile");
  if (raw === null) {
    return STARTER_WEAPON_PROFILE_DEFAULT;
  }
  const normalized = raw.trim().toLowerCase();
  if (isStarterWeaponProfileId(normalized)) {
    return normalized;
  }
  return STARTER_WEAPON_PROFILE_DEFAULT;
}

function isStarterWeaponProfileId(value: string): value is StarterWeaponProfileId {
  return value === "standard" || value === "piercing" || value === "bounce";
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
