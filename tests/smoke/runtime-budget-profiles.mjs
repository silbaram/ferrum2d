export const DEPLOYMENT_RUNTIME_SAMPLE_FRAMES = 12;
export const DEPLOYMENT_CANVAS_READBACK_MAX_ATTEMPTS = 8;

export const RUNTIME_BUDGET_PROFILES = Object.freeze({
  minimal: freezeBudget({
    maxFrameTimeMs: 250,
    maxRustUpdateTimeMs: 100,
    maxRenderTimeMs: 100,
    maxDrawCalls: 8,
    maxRenderCommandCount: 64,
    maxTextureSwitchCount: 16,
    maxPhysicsFixedSteps: 8,
    maxPhysicsSolidCandidateChecks: 10_000,
    maxPhysicsTileCandidateChecks: 10_000,
    maxPhysicsCcdChecks: 0,
    maxPhysicsDebugLineCount: 0,
    maxCollisionPairCount: 1_000,
    maxAssetLoadElapsedMs: 100,
    maxJsHeapUsedBytes: 512 * 1024 * 1024,
  }),
  "minimal-lighting": freezeBudget({
    maxFrameTimeMs: 250,
    maxRustUpdateTimeMs: 100,
    maxRenderTimeMs: 100,
    maxDrawCalls: 16,
    maxRenderCommandCount: 64,
    maxTextureSwitchCount: 16,
    maxPhysicsFixedSteps: 8,
    maxPhysicsSolidCandidateChecks: 10_000,
    maxPhysicsTileCandidateChecks: 10_000,
    maxPhysicsCcdChecks: 0,
    maxPhysicsDebugLineCount: 0,
    maxCollisionPairCount: 1_000,
    maxAssetLoadElapsedMs: 100,
    maxJsHeapUsedBytes: 512 * 1024 * 1024,
  }),
  "minimal-preload": freezeBudget({
    maxFrameTimeMs: 250,
    maxRustUpdateTimeMs: 100,
    maxRenderTimeMs: 100,
    maxDrawCalls: 8,
    maxRenderCommandCount: 64,
    maxTextureSwitchCount: 16,
    maxPhysicsFixedSteps: 8,
    maxPhysicsSolidCandidateChecks: 10_000,
    maxPhysicsTileCandidateChecks: 10_000,
    maxPhysicsCcdChecks: 0,
    maxPhysicsDebugLineCount: 0,
    maxCollisionPairCount: 1_000,
    maxAssetLoadElapsedMs: 250,
    maxJsHeapUsedBytes: 512 * 1024 * 1024,
  }),
  topdown: freezeBudget({
    maxFrameTimeMs: 250,
    maxRustUpdateTimeMs: 100,
    maxRenderTimeMs: 100,
    maxDrawCalls: 16,
    maxRenderCommandCount: 160,
    maxTextureSwitchCount: 32,
    maxPhysicsFixedSteps: 8,
    maxPhysicsSolidCandidateChecks: 20_000,
    maxPhysicsTileCandidateChecks: 20_000,
    maxPhysicsCcdChecks: 0,
    maxPhysicsDebugLineCount: 0,
    maxCollisionPairCount: 2_000,
    maxAssetLoadElapsedMs: 150,
    maxJsHeapUsedBytes: 512 * 1024 * 1024,
  }),
  "topdown-mass-objects": freezeBudget({
    maxFrameTimeMs: 250,
    maxRustUpdateTimeMs: 125,
    maxRenderTimeMs: 125,
    maxDrawCalls: 8,
    maxRenderCommandCount: 1_100,
    maxTextureSwitchCount: 8,
    maxPhysicsFixedSteps: 8,
    maxPhysicsSolidCandidateChecks: 20_000,
    maxPhysicsTileCandidateChecks: 20_000,
    maxPhysicsCcdChecks: 0,
    maxPhysicsDebugLineCount: 0,
    maxCollisionPairCount: 2_000,
    maxAssetLoadElapsedMs: 150,
    maxJsHeapUsedBytes: 768 * 1024 * 1024,
  }),
  "topdown-tilemap": freezeBudget({
    maxFrameTimeMs: 250,
    maxRustUpdateTimeMs: 125,
    maxRenderTimeMs: 125,
    maxDrawCalls: 8,
    maxRenderCommandCount: 2_100,
    maxTextureSwitchCount: 8,
    maxPhysicsFixedSteps: 8,
    maxPhysicsSolidCandidateChecks: 20_000,
    maxPhysicsTileCandidateChecks: 20_000,
    maxPhysicsCcdChecks: 0,
    maxPhysicsDebugLineCount: 0,
    maxCollisionPairCount: 2_000,
    maxAssetLoadElapsedMs: 150,
    maxJsHeapUsedBytes: 768 * 1024 * 1024,
  }),
  breakout: freezeBudget({
    maxFrameTimeMs: 250,
    maxRustUpdateTimeMs: 100,
    maxRenderTimeMs: 100,
    maxDrawCalls: 16,
    maxRenderCommandCount: 256,
    maxTextureSwitchCount: 32,
    maxPhysicsFixedSteps: 8,
    maxPhysicsSolidCandidateChecks: 10_000,
    maxPhysicsTileCandidateChecks: 10_000,
    maxPhysicsCcdChecks: 0,
    maxPhysicsDebugLineCount: 0,
    maxCollisionPairCount: 2_000,
    maxAssetLoadElapsedMs: 150,
    maxJsHeapUsedBytes: 512 * 1024 * 1024,
  }),
  platformer: freezeBudget({
    maxFrameTimeMs: 250,
    maxRustUpdateTimeMs: 100,
    maxRenderTimeMs: 100,
    maxDrawCalls: 16,
    maxRenderCommandCount: 192,
    maxTextureSwitchCount: 32,
    maxPhysicsFixedSteps: 8,
    maxPhysicsSolidCandidateChecks: 20_000,
    maxPhysicsTileCandidateChecks: 20_000,
    maxPhysicsCcdChecks: 0,
    maxPhysicsDebugLineCount: 0,
    maxCollisionPairCount: 2_000,
    maxAssetLoadElapsedMs: 150,
    maxJsHeapUsedBytes: 512 * 1024 * 1024,
  }),
  "physics-sandbox": freezeBudget({
    maxFrameTimeMs: 250,
    maxRustUpdateTimeMs: 125,
    maxRenderTimeMs: 125,
    maxDrawCalls: 32,
    maxRenderCommandCount: 256,
    maxTextureSwitchCount: 48,
    maxPhysicsFixedSteps: 16,
    maxPhysicsSolidCandidateChecks: 25_000,
    maxPhysicsTileCandidateChecks: 25_000,
    maxPhysicsCcdChecks: 1_000,
    maxPhysicsDebugLineCount: 512,
    maxCollisionPairCount: 5_000,
    maxAssetLoadElapsedMs: 150,
    maxJsHeapUsedBytes: 768 * 1024 * 1024,
  }),
  // 64-agent dense Native crowd. Max bounds tolerate a cold first frame; the
  // warm p95 bounds are a regression guard at ~1.5x the 2026-11-22 local
  // Chromium measurement after the wasm32 hardware square root (53.2-54.0 ms
  // per 5-step frame, 10.6-10.8 ms per step). That still misses real time;
  // these bounds do not certify 60 fps.
  "native-crowd": freezeBudget({
    maxFrameTimeMs: 250,
    maxRustUpdateTimeMs: 125,
    maxRustUpdateTimeMsP95: 80,
    maxRustUpdateMsPerNativeStepP95: 16,
    maxRenderTimeMs: 125,
    maxDrawCalls: 32,
    maxRenderCommandCount: 256,
    maxTextureSwitchCount: 48,
    maxPhysicsFixedSteps: 16,
    maxPhysicsSolidCandidateChecks: 25_000,
    maxPhysicsTileCandidateChecks: 25_000,
    maxPhysicsCcdChecks: 1_000,
    maxPhysicsDebugLineCount: 512,
    maxCollisionPairCount: 5_000,
    maxAssetLoadElapsedMs: 150,
    maxJsHeapUsedBytes: 768 * 1024 * 1024,
  }),
});

export const BROWSER_SMOKE_BUDGET_PROFILE_BY_MODE = Object.freeze({
  render: "minimal",
  lighting: "minimal-lighting",
  preload: "minimal-preload",
  "virtual-controls": "minimal",
  "topdown-effects": "topdown",
  "topdown-mass-objects": "topdown-mass-objects",
  "topdown-tilemap-budget": "topdown-tilemap",
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
  "maxPhysicsSolidCandidateChecks",
  "maxPhysicsTileCandidateChecks",
  "maxPhysicsCcdChecks",
  "maxPhysicsDebugLineCount",
  "maxCollisionPairCount",
  "maxAssetLoadElapsedMs",
  "maxJsHeapUsedBytes",
]);

const OPTIONAL_BUDGET_FIELDS = Object.freeze(["maxRustUpdateTimeMsP95","maxRustUpdateMsPerNativeStepP95","maxSpatialBloomDrawCalls","maxSpatialBloomTextureBytes","maxSpatialBloomTexelFetchBudget","maxPointShadowGeometryUploadBytes", "maxPointShadowGeometryVertexCount"]);

export function runtimeBudgetProfile(profileId) {
  const profile = RUNTIME_BUDGET_PROFILES[profileId];
  if (profile === undefined) {
    throw new Error(`unknown runtime budget profile: ${profileId}`);
  }
  return { ...profile };
}

export function runtimeBudgetForSmokeMode(mode, explicitProfileId) {
  return runtimeBudgetProfile(runtimeBudgetProfileIdForSmokeMode(mode, explicitProfileId));
}

export function runtimeBudgetProfileIdForSmokeMode(mode, explicitProfileId) {
  const profileId = explicitProfileId ?? BROWSER_SMOKE_BUDGET_PROFILE_BY_MODE[mode];
  if (profileId === undefined) {
    throw new Error(`no runtime budget profile mapped for browser smoke mode: ${mode}`);
  }
  return profileId;
}

export function runtimeBudgetProfileIds() {
  return Object.keys(RUNTIME_BUDGET_PROFILES);
}

export function validateRuntimeBudgetProfiles() {
  const errors = [];
  for (const [profileId, profile] of Object.entries(RUNTIME_BUDGET_PROFILES)) {
    for (const field of [...BUDGET_FIELDS, ...OPTIONAL_BUDGET_FIELDS]) {
      if (profile[field] === undefined && OPTIONAL_BUDGET_FIELDS.includes(field)) continue;
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
