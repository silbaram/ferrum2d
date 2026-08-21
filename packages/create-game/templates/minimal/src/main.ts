import {
  createFerrumRuntime,
  type FerrumEngine,
  type FerrumRuntime,
} from "@ferrum2d/ferrum-web/core";
import {
  behaviorRecipeCommandsForEntity,
  compileWeaponProfiles,
  type ProjectileDefinition,
  type WeaponDefinition,
} from "@ferrum2d/ferrum-web/authoring";
import {
  createMinimalTemplateShell,
  minimalTemplateUiState,
  renderMinimalTemplateStartupError,
} from "./minimal-template-shell";

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

async function bootstrap(): Promise<void> {
  const shell = createMinimalTemplateShell();
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
    uiState: ({ frame, rendererStats, fps }) => minimalTemplateUiState(
      frame,
      rendererStats.renderCommandCount,
      fps,
      weaponProfile,
    ),
    inputTransform: (snapshot) => shell.inputSnapshot(snapshot),
    onFrame: ({ frame, rendererStats, fps }) => {
      shell.updateMetrics(frame, rendererStats.renderCommandCount, fps, weaponProfile);
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

void bootstrap().catch(renderMinimalTemplateStartupError);
