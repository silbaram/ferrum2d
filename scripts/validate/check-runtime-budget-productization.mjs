import { readFileSync } from "node:fs";
import {
  BROWSER_SMOKE_BUDGET_PROFILE_BY_MODE,
  RUNTIME_BUDGET_PROFILES,
  validateRuntimeBudgetProfiles,
} from "../../tests/smoke/runtime-budget-profiles.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const pagesWorkflow = readFileSync(".github/workflows/pages.yml", "utf8");
const smokeDoc = readFileSync("docs/development/quality/smoke-check.md", "utf8");
const pagesDoc = readFileSync("docs/development/operations/demo-deploy.md", "utf8");
const browserSmoke = readFileSync("tests/smoke/browser-render-smoke.mjs", "utf8");

const requiredScripts = [
  "smoke:runtime-budgets",
  "smoke:mass-objects",
  "smoke:physics",
  "smoke:physics-replay",
  "smoke:starter-runtime",
  "smoke:gameplay-replay",
  "smoke:browser-budget",
  "smoke:topdown-budget",
  "smoke:topdown-mass-objects",
  "smoke:topdown-tilemap-budget",
  "smoke:breakout-budget",
  "smoke:platformer-budget",
  "smoke:physics-sandbox-budget",
  "package:consumer-smoke",
  "validate:consumer-smoke-report",
  "validate:pages-artifact",
  "build:pages",
];
const requiredProfiles = [
  "minimal",
  "minimal-lighting",
  "minimal-preload",
  "topdown",
  "topdown-mass-objects",
  "topdown-tilemap",
  "breakout",
  "platformer",
  "physics-sandbox",
];
const requiredModeMappings = {
  render: "minimal",
  lighting: "minimal-lighting",
  preload: "minimal-preload",
  "topdown-effects": "topdown",
  "topdown-mass-objects": "topdown-mass-objects",
  "topdown-tilemap-budget": "topdown-tilemap",
  "breakout-effects": "breakout",
  "platformer-effects": "platformer",
  "physics-sandbox": "physics-sandbox",
  "physics-demo-suite": "physics-sandbox",
};
const defaultCiGateSnippets = [
  "pnpm smoke:runtime-budgets",
  "pnpm smoke:mass-objects",
  "pnpm smoke:physics",
  "pnpm smoke:topdown-mass-objects",
  "pnpm smoke:topdown-tilemap-budget",
];
const optInCiSnippets = [
  "consumer_smoke",
  "extended_browser_smoke",
  "artifacts/browser-smoke-budgets",
  "pnpm package:consumer-smoke -- --artifact-dir artifacts/consumer-smoke",
];
const smokeDocSnippets = [
  "제품 Runtime Budget Readiness",
  "ferrum2d.browser-smoke.runtime-budget-report",
  "FERRUM_BROWSER_SMOKE_BUDGET_ARTIFACT_DIR",
  "WebGL2 기본 경로",
  "WebGPU optional",
  "CI 기본 gate",
  "tag/manual opt-in",
];
const pagesReadinessSnippets = [
  "Pages demo readiness checklist",
  "pnpm validate:pages-artifact",
  "dist-pages/",
  "/starter-runtime/",
  "/topdown-shooter/",
  "/placement-viewer/",
  "/physics-sandbox/",
  "/breakout/",
  "/platformer/",
];

const errors = [
  ...validateRuntimeBudgetProfiles(),
  ...missingPackageScripts(),
  ...missingProfiles(),
  ...missingModeMappings(),
  ...missingSnippets("CI default gate", ciWorkflow, defaultCiGateSnippets),
  ...missingSnippets("CI opt-in gate", ciWorkflow, optInCiSnippets),
  ...missingSnippets("Smoke Check doc", smokeDoc, smokeDocSnippets),
  ...missingSnippets("Pages deploy doc", pagesDoc, pagesReadinessSnippets),
  ...missingSnippets("Pages workflow", pagesWorkflow, ["pnpm validate:pages-artifact"]),
  ...missingSnippets("Browser smoke budget artifact", browserSmoke, [
    "ferrum2d.browser-smoke.runtime-budget-report",
    "FERRUM_BROWSER_SMOKE_BUDGET_ARTIFACT_DIR",
    "writeRuntimeBudgetArtifact",
  ]),
];

if (errors.length > 0) {
  console.error("runtime budget productization check failed");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  scripts: requiredScripts.length,
  runtimeBudgetProfiles: Object.keys(RUNTIME_BUDGET_PROFILES),
  browserSmokeBudgetModes: Object.keys(BROWSER_SMOKE_BUDGET_PROFILE_BY_MODE),
  ci: {
    defaultGateSnippets: defaultCiGateSnippets.length,
    optInGateSnippets: optInCiSnippets.length,
  },
}, null, 2));

function missingPackageScripts() {
  const scripts = packageJson.scripts ?? {};
  const errors = [];
  for (const scriptName of requiredScripts) {
    if (typeof scripts[scriptName] !== "string" || scripts[scriptName].length === 0) {
      errors.push(`package.json scripts.${scriptName} is missing.`);
    }
  }
  const smokeCheck = scripts["smoke:check"] ?? "";
  if (!smokeCheck.includes("pnpm validate:runtime-budget-product")) {
    errors.push("smoke:check must include pnpm validate:runtime-budget-product.");
  }
  return errors;
}

function missingProfiles() {
  const errors = [];
  for (const profileId of requiredProfiles) {
    if (RUNTIME_BUDGET_PROFILES[profileId] === undefined) {
      errors.push(`runtime budget profile '${profileId}' is missing.`);
    }
  }
  return errors;
}

function missingModeMappings() {
  const errors = [];
  for (const [mode, profileId] of Object.entries(requiredModeMappings)) {
    const actual = BROWSER_SMOKE_BUDGET_PROFILE_BY_MODE[mode];
    if (actual !== profileId) {
      errors.push(`browser smoke mode '${mode}' must map to '${profileId}', got '${actual ?? "missing"}'.`);
    }
  }
  return errors;
}

function missingSnippets(label, source, snippets) {
  return snippets
    .filter((snippet) => !source.includes(snippet))
    .map((snippet) => `${label} is missing '${snippet}'.`);
}
