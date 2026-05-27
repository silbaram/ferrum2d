export const RUNTIME_BUDGET_PROFILES = Object.freeze({
  minimal: freezeBudget({
    maxFrameTimeMs: 250,
    maxRustUpdateTimeMs: 100,
    maxRenderTimeMs: 100,
    maxDrawCalls: 8,
    maxRenderCommandCount: 64,
    maxTextureSwitchCount: 16,
    maxPhysicsFixedSteps: 8,
    maxPhysicsTileCandidateChecks: 10_000,
    maxCollisionPairCount: 1_000,
    maxAssetLoadElapsedMs: 100,
  }),
  "minimal-lighting": freezeBudget({
    maxFrameTimeMs: 250,
    maxRustUpdateTimeMs: 100,
    maxRenderTimeMs: 100,
    maxDrawCalls: 16,
    maxRenderCommandCount: 64,
    maxTextureSwitchCount: 16,
    maxPhysicsFixedSteps: 8,
    maxPhysicsTileCandidateChecks: 10_000,
    maxCollisionPairCount: 1_000,
    maxAssetLoadElapsedMs: 100,
  }),
  "minimal-preload": freezeBudget({
    maxFrameTimeMs: 250,
    maxRustUpdateTimeMs: 100,
    maxRenderTimeMs: 100,
    maxDrawCalls: 8,
    maxRenderCommandCount: 64,
    maxTextureSwitchCount: 16,
    maxPhysicsFixedSteps: 8,
    maxPhysicsTileCandidateChecks: 10_000,
    maxCollisionPairCount: 1_000,
    maxAssetLoadElapsedMs: 250,
  }),
  topdown: freezeBudget({
    maxFrameTimeMs: 250,
    maxRustUpdateTimeMs: 100,
    maxRenderTimeMs: 100,
    maxDrawCalls: 16,
    maxRenderCommandCount: 160,
    maxTextureSwitchCount: 32,
    maxPhysicsFixedSteps: 8,
    maxPhysicsTileCandidateChecks: 20_000,
    maxCollisionPairCount: 2_000,
    maxAssetLoadElapsedMs: 150,
  }),
  breakout: freezeBudget({
    maxFrameTimeMs: 250,
    maxRustUpdateTimeMs: 100,
    maxRenderTimeMs: 100,
    maxDrawCalls: 16,
    maxRenderCommandCount: 256,
    maxTextureSwitchCount: 32,
    maxPhysicsFixedSteps: 8,
    maxPhysicsTileCandidateChecks: 10_000,
    maxCollisionPairCount: 2_000,
    maxAssetLoadElapsedMs: 150,
  }),
  platformer: freezeBudget({
    maxFrameTimeMs: 250,
    maxRustUpdateTimeMs: 100,
    maxRenderTimeMs: 100,
    maxDrawCalls: 16,
    maxRenderCommandCount: 192,
    maxTextureSwitchCount: 32,
    maxPhysicsFixedSteps: 8,
    maxPhysicsTileCandidateChecks: 20_000,
    maxCollisionPairCount: 2_000,
    maxAssetLoadElapsedMs: 150,
  }),
  "physics-sandbox": freezeBudget({
    maxFrameTimeMs: 250,
    maxRustUpdateTimeMs: 125,
    maxRenderTimeMs: 125,
    maxDrawCalls: 32,
    maxRenderCommandCount: 256,
    maxTextureSwitchCount: 48,
    maxPhysicsFixedSteps: 16,
    maxPhysicsTileCandidateChecks: 25_000,
    maxCollisionPairCount: 5_000,
    maxAssetLoadElapsedMs: 150,
  }),
});

export const BROWSER_SMOKE_BUDGET_PROFILE_BY_MODE = Object.freeze({
  render: "minimal",
  lighting: "minimal-lighting",
  preload: "minimal-preload",
  "virtual-controls": "minimal",
  "topdown-effects": "topdown",
  "topdown-save-load": "topdown",
  "destructible-terrain": "topdown",
  "breakout-effects": "breakout",
  "platformer-effects": "platformer",
  "physics-sandbox": "physics-sandbox",
  "physics-demo-suite": "physics-sandbox",
});

const BUDGET_FIELDS = Object.freeze([
  "maxFrameTimeMs",
  "maxRustUpdateTimeMs",
  "maxRenderTimeMs",
  "maxDrawCalls",
  "maxRenderCommandCount",
  "maxTextureSwitchCount",
  "maxPhysicsFixedSteps",
  "maxPhysicsTileCandidateChecks",
  "maxCollisionPairCount",
  "maxAssetLoadElapsedMs",
]);

export function runtimeBudgetProfile(profileId) {
  const profile = RUNTIME_BUDGET_PROFILES[profileId];
  if (profile === undefined) {
    throw new Error(`unknown runtime budget profile: ${profileId}`);
  }
  return { ...profile };
}

export function runtimeBudgetForSmokeMode(mode, explicitProfileId) {
  const profileId = explicitProfileId ?? BROWSER_SMOKE_BUDGET_PROFILE_BY_MODE[mode];
  if (profileId === undefined) {
    throw new Error(`no runtime budget profile mapped for browser smoke mode: ${mode}`);
  }
  return runtimeBudgetProfile(profileId);
}

export function runtimeBudgetProfileIds() {
  return Object.keys(RUNTIME_BUDGET_PROFILES);
}

export function validateRuntimeBudgetProfiles() {
  const errors = [];
  for (const [profileId, profile] of Object.entries(RUNTIME_BUDGET_PROFILES)) {
    for (const field of BUDGET_FIELDS) {
      const value = profile[field];
      if (!Number.isFinite(value) || value < 0) {
        errors.push(`${profileId}.${field} must be a non-negative finite number.`);
      }
    }
  }
  for (const [mode, profileId] of Object.entries(BROWSER_SMOKE_BUDGET_PROFILE_BY_MODE)) {
    if (RUNTIME_BUDGET_PROFILES[profileId] === undefined) {
      errors.push(`${mode} maps to unknown runtime budget profile '${profileId}'.`);
    }
  }
  return errors;
}

function freezeBudget(budget) {
  return Object.freeze(budget);
}
