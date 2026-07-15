#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEPLOYMENT_RUNTIME_SAMPLE_FRAMES,
  runtimeBudgetProfile,
} from "../../tests/smoke/runtime-budget-profiles.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_ARTIFACT_DIR = "artifacts/consumer-smoke";
const REPORT_FORMAT = "ferrum2d.package.consumer-smoke.report";
const REPORT_VERSION = 1;
const EXPECTED_AGENT_FILES_CHECKED = 41;
const REQUIRED_TEMPLATE_CHECKS = Object.freeze([
  "createGame",
  "agentsDryRun",
  "agentsInstall",
  "install",
  "publicImportSmoke",
  "publicTypeSmoke",
  "validate",
  "report",
  "smoke",
  "build",
  "deployReport",
  "deployBrowserSmoke",
  "placementViewerSmoke",
]);
const FORBIDDEN_SNAPSHOT_DIRS = Object.freeze(["node_modules", "dist", ".pnpm"]);

const options = parseArgs(process.argv.slice(2));
const report = JSON.parse(await readFile(options.reportPath, "utf8"));
const errors = [];

validateTopLevelReport(report, errors);
validateTemplates(report, errors);
validateTemplateMatrixConsistency(report, errors);
if (options.validateArtifacts) {
  await validateArtifacts(report, errors);
}

const validationReport = {
  format: "ferrum2d.package.consumer-smoke.report.validation",
  version: 1,
  ok: errors.length === 0,
  reportPath: options.reportPath,
  artifactDir: options.artifactDir,
  expectedStatus: options.expectStatus,
  status: report.status,
  templateCount: Array.isArray(report.templates) ? report.templates.length : 0,
  errors,
};
console.log(JSON.stringify(validationReport, null, 2));
if (!validationReport.ok) {
  process.exitCode = 1;
}

function validateTopLevelReport(value, reportErrors) {
  if (!isRecord(value)) {
    reportErrors.push("report must be an object");
    return;
  }
  if (value.format !== REPORT_FORMAT) {
    reportErrors.push(`format must be ${REPORT_FORMAT}`);
  }
  if (value.version !== REPORT_VERSION) {
    reportErrors.push(`version must be ${REPORT_VERSION}`);
  }
  if (!["passed", "failed"].includes(value.status)) {
    reportErrors.push("status must be passed or failed");
  }
  if (options.expectStatus !== undefined && value.status !== options.expectStatus) {
    reportErrors.push(`status must be ${options.expectStatus}`);
  }
  if (!isIsoTimestamp(value.startedAt)) {
    reportErrors.push("startedAt must be an ISO timestamp");
  }
  if (!isIsoTimestamp(value.completedAt)) {
    reportErrors.push("completedAt must be an ISO timestamp");
  }
  if (!Number.isFinite(value.durationMs) || value.durationMs < 0) {
    reportErrors.push("durationMs must be a non-negative number");
  }
  if (typeof value.packageManager !== "string" || value.packageManager.length === 0) {
    reportErrors.push("packageManager must be a non-empty string");
  }
  if (!["online", "offline"].includes(value.installMode)) {
    reportErrors.push("installMode must be online or offline");
  }
  if (!isRecord(value.options)) {
    reportErrors.push("options must be an object");
  }
  if (!isRecord(value.tarballs)) {
    reportErrors.push("tarballs must be an object");
  } else if (value.status === "passed") {
    validateTarballName(value.tarballs.authoringViewer, "tarballs.authoringViewer", reportErrors);
    validateTarballName(value.tarballs.ferrumWeb, "tarballs.ferrumWeb", reportErrors);
    validateTarballName(value.tarballs.createGame, "tarballs.createGame", reportErrors);
    validateTarballName(value.tarballs.agents, "tarballs.agents", reportErrors);
  }
  if (!Array.isArray(value.requestedTemplates) || value.requestedTemplates.length === 0) {
    reportErrors.push("requestedTemplates must include at least one template");
  } else if (!value.requestedTemplates.every((template) => typeof template === "string" && template.length > 0)) {
    reportErrors.push("requestedTemplates entries must be non-empty strings");
  }
  validateCreateGameCatalog(value.createGameCatalog, "createGameCatalog", value.status, reportErrors);
  if (!Array.isArray(value.templates)) {
    reportErrors.push("templates must be an array");
  }
  if (value.status === "passed" && isRecord(value.error)) {
    reportErrors.push("passed report must not include error");
  }
  if (value.status === "failed" && !isRecord(value.error)) {
    reportErrors.push("failed report must include error");
  } else if (value.status === "failed") {
    validateErrorSummary(value.error, "error", reportErrors);
  }
}

function validateCreateGameCatalog(value, label, reportStatus, reportErrors) {
  if (!isRecord(value)) {
    if (reportStatus === "passed") {
      reportErrors.push(`${label} must be an object`);
    }
    return;
  }
  if (value.format !== "ferrum-create-game-template-list") {
    reportErrors.push(`${label}.format must be ferrum-create-game-template-list`);
  }
  if (value.version !== 1) {
    reportErrors.push(`${label}.version must be 1`);
  }
  if (typeof value.defaultTemplate !== "string" || value.defaultTemplate.length === 0) {
    reportErrors.push(`${label}.defaultTemplate must be a non-empty string`);
  }
  if (!Number.isInteger(value.templateCount) || value.templateCount <= 0) {
    reportErrors.push(`${label}.templateCount must be a positive integer`);
  }
  if (!Array.isArray(value.templates) || value.templates.length === 0) {
    reportErrors.push(`${label}.templates must be a non-empty array`);
    return;
  }
  if (Number.isInteger(value.templateCount) && value.templates.length !== value.templateCount) {
    reportErrors.push(`${label}.templates length must match templateCount`);
  }
  const ids = new Set();
  for (const [index, template] of value.templates.entries()) {
    const templateLabel = `${label}.templates[${index}]`;
    if (!isRecord(template)) {
      reportErrors.push(`${templateLabel} must be an object`);
      continue;
    }
    if (typeof template.id !== "string" || template.id.length === 0) {
      reportErrors.push(`${templateLabel}.id must be a non-empty string`);
    } else if (ids.has(template.id)) {
      reportErrors.push(`${label}.templates must not include duplicate template id ${template.id}`);
    } else {
      ids.add(template.id);
    }
    for (const key of ["sceneAuthoringConfigured", "gameplayReplayConfigured", "runtimeGameplayReplayConfigured"]) {
      if (typeof template[key] !== "boolean") {
        reportErrors.push(`${templateLabel}.${key} must be a boolean`);
      }
    }
  }
  if (typeof value.defaultTemplate === "string" && value.defaultTemplate.length > 0 && !ids.has(value.defaultTemplate)) {
    reportErrors.push(`${label}.defaultTemplate must be included in templates`);
  }
}

function validateTemplates(value, reportErrors) {
  if (!Array.isArray(value.templates)) {
    return;
  }
  const requestedTemplates = Array.isArray(value.requestedTemplates) ? value.requestedTemplates : [];
  if (value.status === "passed" && value.templates.length !== requestedTemplates.length) {
    reportErrors.push("passed report templates length must match requestedTemplates length");
  }

  for (const [index, template] of value.templates.entries()) {
    const label = `templates[${index}]`;
    if (!isRecord(template)) {
      reportErrors.push(`${label} must be an object`);
      continue;
    }
    if (typeof template.template !== "string" || template.template.length === 0) {
      reportErrors.push(`${label}.template must be a non-empty string`);
    }
    if (!["running", "passed", "failed"].includes(template.status)) {
      reportErrors.push(`${label}.status must be running, passed, or failed`);
    }
    if (value.status === "passed" && template.status !== "passed") {
      reportErrors.push(`${label}.status must be passed when report status is passed`);
    }
    if (value.status === "failed" && template.status === "failed") {
      validateErrorSummary(template.error, `${label}.error`, reportErrors);
    }
    validateTemplateChecks(template, label, value.status, reportErrors);
    validateTemplateAgents(template, label, value.status, reportErrors);
    validateTemplateReports(template, label, value.status, reportErrors);
    validateTopdownMutationChecks(template, label, value.status, reportErrors);
  }
}

function validateTemplateMatrixConsistency(value, reportErrors) {
  if (value.status !== "passed") {
    return;
  }
  if (
    !Array.isArray(value.requestedTemplates) ||
    !Array.isArray(value.templates) ||
    !isRecord(value.createGameCatalog) ||
    !Array.isArray(value.createGameCatalog.templates)
  ) {
    return;
  }
  const requested = new Set(value.requestedTemplates.filter((template) => typeof template === "string"));
  const reported = new Set();
  for (const template of value.templates) {
    if (isRecord(template) && typeof template.template === "string") {
      if (reported.has(template.template)) {
        reportErrors.push(`passed report templates must not include duplicate template ${template.template}`);
      }
      reported.add(template.template);
    }
  }
  const catalog = new Set();
  for (const template of value.createGameCatalog.templates) {
    if (isRecord(template) && typeof template.id === "string") {
      catalog.add(template.id);
    }
  }
  for (const template of requested) {
    if (!reported.has(template)) {
      reportErrors.push(`passed report templates must include requested template ${template}`);
    }
    if (!catalog.has(template)) {
      reportErrors.push(`createGameCatalog.templates must include requested template ${template}`);
    }
  }
  for (const template of reported) {
    if (!requested.has(template)) {
      reportErrors.push(`passed report templates must not include unrequested template ${template}`);
    }
  }
}

function validateTemplateChecks(template, label, reportStatus, reportErrors) {
  if (!isRecord(template.checks)) {
    reportErrors.push(`${label}.checks must be an object`);
    return;
  }
  for (const checkName of REQUIRED_TEMPLATE_CHECKS) {
    if (typeof template.checks[checkName] !== "boolean") {
      reportErrors.push(`${label}.checks.${checkName} must be a boolean`);
    } else if (reportStatus === "passed" && template.checks[checkName] !== true) {
      reportErrors.push(`${label}.checks.${checkName} must be true`);
    }
  }
}

function validateTemplateAgents(template, label, reportStatus, reportErrors) {
  if (!isRecord(template.agents)) {
    if (reportStatus === "passed") {
      reportErrors.push(`${label}.agents must be an object`);
    }
    return;
  }
  if (!Array.isArray(template.agents.tools) || !sameMembers(template.agents.tools, ["codex", "claude", "gemini"])) {
    reportErrors.push(`${label}.agents.tools must include codex, claude, and gemini`);
  }
  if (template.agents.expectedFilesChecked !== EXPECTED_AGENT_FILES_CHECKED) {
    reportErrors.push(`${label}.agents.expectedFilesChecked must be ${EXPECTED_AGENT_FILES_CHECKED}`);
  }
  if (template.agents.unsupportedGeminiWrappersAbsent !== true) {
    reportErrors.push(`${label}.agents.unsupportedGeminiWrappersAbsent must be true`);
  }
}

function validateTemplateReports(template, label, reportStatus, reportErrors) {
  if (!isRecord(template.reports)) {
    if (reportStatus === "passed") {
      reportErrors.push(`${label}.reports must be an object`);
    }
    return;
  }
  if (reportStatus !== "passed") {
    return;
  }
  validateProjectSummary(template.reports.project, `${label}.reports.project`, reportErrors);
  validateStatusString(template.reports.authoring?.status, `${label}.reports.authoring.status`, reportErrors);
  validateGameplayReplaySummary(template.reports.gameplayReplay, `${label}.reports.gameplayReplay`, reportErrors);
  validateRuntimeReplaySummary(template.reports.runtimeReplay, `${label}.reports.runtimeReplay`, reportErrors);
  validateRuntimeRecipeSummary(template.reports.runtimeReplayRecipe, `${label}.reports.runtimeReplayRecipe`, reportErrors);
  validateDeploymentSummary(template.reports.deployment, `${label}.reports.deployment`, reportErrors);
  validateDeploymentBrowserSummary(
    template.reports.deploymentBrowser,
    `${label}.reports.deploymentBrowser`,
    reportErrors,
    template.template,
  );
  validatePlacementViewerSummary(
    template.reports.placementViewer,
    `${label}.reports.placementViewer`,
    reportErrors,
  );
  if (!isRecord(template.buildOutput)) {
    reportErrors.push(`${label}.buildOutput must be an object`);
  } else {
    if (typeof template.buildOutput.distIndexHtml !== "string" || !template.buildOutput.distIndexHtml.endsWith("/dist/index.html")) {
      reportErrors.push(`${label}.buildOutput.distIndexHtml must point to dist/index.html`);
    }
    if (
      typeof template.buildOutput.distPlacementViewerHtml !== "string" ||
      !template.buildOutput.distPlacementViewerHtml.endsWith("/dist/placement-viewer.html")
    ) {
      reportErrors.push(`${label}.buildOutput.distPlacementViewerHtml must point to dist/placement-viewer.html`);
    }
    if (template.buildOutput.preservedInArtifactSnapshot !== false) {
      reportErrors.push(`${label}.buildOutput.preservedInArtifactSnapshot must be false`);
    }
    if (template.buildOutput.deployReady !== true) {
      reportErrors.push(`${label}.buildOutput.deployReady must be true`);
    }
    if (template.buildOutput.browserSmoke !== true) {
      reportErrors.push(`${label}.buildOutput.browserSmoke must be true`);
    }
  }
}

function validatePlacementViewerSummary(value, label, reportErrors) {
  if (!isRecord(value)) {
    reportErrors.push(`${label} must be an object`);
    return;
  }
  if (value.status !== "validated") reportErrors.push(`${label}.status must be validated`);
  if (!Array.isArray(value.projectAssets) || !value.projectAssets.includes("atlas")) {
    reportErrors.push(`${label}.projectAssets must include atlas`);
  }
  for (const field of ["instanceCount", "objectDefinitionCount", "draftOperationCount"]) {
    if (!Number.isInteger(value[field]) || value[field] <= 0) {
      reportErrors.push(`${label}.${field} must be a positive integer`);
    }
  }
  for (const field of [
    "selectedInstanceId",
    "addedInstanceId",
    "objectDefinitionId",
    "objectDefinitionInstanceId",
  ]) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      reportErrors.push(`${label}.${field} must be a non-empty string`);
    }
  }
  if (value.addedPrefab !== "object") reportErrors.push(`${label}.addedPrefab must be object`);
  if (value.addedAsset !== "atlas") reportErrors.push(`${label}.addedAsset must be atlas`);
  if (value.objectDefinitionVisualKind !== "sprite") {
    reportErrors.push(`${label}.objectDefinitionVisualKind must be sprite`);
  }
  if (value.objectDefinitionInstancePrefab !== value.objectDefinitionId) {
    reportErrors.push(`${label}.objectDefinitionInstancePrefab must match objectDefinitionId`);
  }

  const binding = value.behaviorBinding;
  if (!isRecord(binding)) {
    reportErrors.push(`${label}.behaviorBinding must be an object`);
  } else {
    for (const field of ["targetInstanceId", "recipeId"]) {
      if (typeof binding[field] !== "string" || binding[field].length === 0) {
        reportErrors.push(`${label}.behaviorBinding.${field} must be a non-empty string`);
      }
    }
    if (!["attach-detach", "detach-reattach"].includes(binding.mode)) {
      reportErrors.push(`${label}.behaviorBinding.mode must be attach-detach or detach-reattach`);
    }
    if (binding.attachOperationKind !== "updateBehaviorBinding") {
      reportErrors.push(`${label}.behaviorBinding.attachOperationKind must be updateBehaviorBinding`);
    }
    if (binding.cleared !== true) reportErrors.push(`${label}.behaviorBinding.cleared must be true`);
  }

  const handoff = value.handoffUi;
  if (!isRecord(handoff)) {
    reportErrors.push(`${label}.handoffUi must be an object`);
  } else {
    if (handoff.draftCount !== String(value.draftOperationCount)) {
      reportErrors.push(`${label}.handoffUi.draftCount must match draftOperationCount`);
    }
    if (handoff.blockedReferenceCount !== "0") {
      reportErrors.push(`${label}.handoffUi.blockedReferenceCount must be 0`);
    }
    if (handoff.assetDiagnosticCount !== "0") {
      reportErrors.push(`${label}.handoffUi.assetDiagnosticCount must be 0`);
    }
    for (const field of ["copyPatchDisabled", "copyHandoffDisabled", "saveDraftDisabled"]) {
      if (handoff[field] !== false) reportErrors.push(`${label}.handoffUi.${field} must be false`);
    }
    if (typeof handoff.status !== "string" || handoff.status.length === 0) {
      reportErrors.push(`${label}.handoffUi.status must be a non-empty string`);
    }
  }

  const inspector = value.inspectorUi;
  if (!isRecord(inspector)) {
    reportErrors.push(`${label}.inspectorUi must be an object`);
  } else {
    if (!sameMembers(inspector.groups, ["identity", "visual", "collider", "behavior"])) {
      reportErrors.push(`${label}.inspectorUi.groups must include identity, visual, collider, and behavior`);
    }
    for (const field of ["selectedId", "selectedPrefab", "visual", "collider", "behaviorProfiles"]) {
      if (typeof inspector[field] !== "string" || inspector[field].length === 0) {
        reportErrors.push(`${label}.inspectorUi.${field} must be a non-empty string`);
      }
    }
    if (inspector.selectedId !== value.selectedInstanceId) {
      reportErrors.push(`${label}.inspectorUi.selectedId must match selectedInstanceId`);
    }
  }
}

function validateProjectSummary(value, label, reportErrors) {
  if (!isRecord(value)) {
    reportErrors.push(`${label} must be an object`);
    return;
  }
  if (value.status !== "validated") {
    reportErrors.push(`${label}.status must be validated`);
  }
  if (typeof value.packageName !== "string" || value.packageName.length === 0) {
    reportErrors.push(`${label}.packageName must be a non-empty string`);
  }
  if (typeof value.authoringViewer !== "string" || value.authoringViewer.length === 0) {
    reportErrors.push(`${label}.authoringViewer must be a non-empty string`);
  }
  if (typeof value.ferrumWeb !== "string" || value.ferrumWeb.length === 0) {
    reportErrors.push(`${label}.ferrumWeb must be a non-empty string`);
  }
  if (!isRecord(value.files)) {
    reportErrors.push(`${label}.files must be an object`);
  } else {
    if (value.files.main !== true) {
      reportErrors.push(`${label}.files.main must be true`);
    }
  }
  if (value.internalImports !== 0) {
    reportErrors.push(`${label}.internalImports must be 0`);
  }
  if (value.rootAggregateImports !== 0) {
    reportErrors.push(`${label}.rootAggregateImports must be 0`);
  }
  if (!isRecord(value.deployment)) {
    reportErrors.push(`${label}.deployment must be an object`);
  } else {
    if (value.deployment.target !== "static-web") reportErrors.push(`${label}.deployment.target must be static-web`);
    if (value.deployment.outputDirectory !== "dist") reportErrors.push(`${label}.deployment.outputDirectory must be dist`);
    if (value.deployment.basePath !== "relative") reportErrors.push(`${label}.deployment.basePath must be relative`);
    if (value.deployment.fileProtocolSupported !== false) reportErrors.push(`${label}.deployment.fileProtocolSupported must be false`);
  }
  if (!Array.isArray(value.recommendedCommands)) {
    reportErrors.push(`${label}.recommendedCommands must be an array`);
  } else {
    for (const command of [
      "npm run ferrum:report",
      "npm run ferrum:validate",
      "npm run ferrum:authoring-report",
      "npm run ferrum:replay-report",
      "npm run ferrum:runtime-replay-report",
      "npm run ferrum:smoke",
      "npm run ferrum:deploy-report",
      "npm run build",
      "npm run preview",
    ]) {
      if (!value.recommendedCommands.includes(command)) {
        reportErrors.push(`${label}.recommendedCommands must include ${command}`);
      }
    }
  }
  if (value.reports !== 0) {
    reportErrors.push(`${label}.reports must be 0`);
  }
  if (value.errors !== 0) {
    reportErrors.push(`${label}.errors must be 0`);
  }
}

function validateDeploymentSummary(value, label, reportErrors) {
  if (!isRecord(value)) {
    reportErrors.push(`${label} must be an object`);
    return;
  }
  if (value.status !== "ready") reportErrors.push(`${label}.status must be ready`);
  if (value.target !== "static-web") reportErrors.push(`${label}.target must be static-web`);
  if (value.outputDirectory !== "dist") reportErrors.push(`${label}.outputDirectory must be dist`);
  if (value.basePath !== "relative") reportErrors.push(`${label}.basePath must be relative`);
  if (value.fileProtocolSupported !== false) reportErrors.push(`${label}.fileProtocolSupported must be false`);
  if (value.recommendedProtocol !== "http(s)") reportErrors.push(`${label}.recommendedProtocol must be http(s)`);
  if (!isRecord(value.checks)) {
    reportErrors.push(`${label}.checks must be an object`);
  } else {
    for (const check of ["build", "indexHtml", "relativeAssetReferences", "referencedFiles", "httpServe", "previewHttp", "wasmMime"]) {
      if (value.checks[check] !== true) reportErrors.push(`${label}.checks.${check} must be true`);
    }
    if (value.checks.smokeBasePath !== "/__ferrum2d_deploy_smoke__/") {
      reportErrors.push(`${label}.checks.smokeBasePath must be /__ferrum2d_deploy_smoke__/`);
    }
    if (!Number.isInteger(value.checks.servedFileCount) || value.checks.servedFileCount <= 0) {
      reportErrors.push(`${label}.checks.servedFileCount must be a positive integer`);
    }
    if (!Number.isInteger(value.checks.wasmFileCount) || value.checks.wasmFileCount <= 0) {
      reportErrors.push(`${label}.checks.wasmFileCount must be a positive integer`);
    }
  }
  if (value.reports !== 0) reportErrors.push(`${label}.reports must be 0`);
  if (value.errors !== 0) reportErrors.push(`${label}.errors must be 0`);
}

function validateDeploymentBrowserSummary(value, label, reportErrors, templateName) {
  if (!isRecord(value)) {
    reportErrors.push(`${label} must be an object`);
    return;
  }
  if (value.status !== "validated") reportErrors.push(`${label}.status must be validated`);
  if (value.basePath !== "/__ferrum2d_consumer_smoke__/") {
    reportErrors.push(`${label}.basePath must be /__ferrum2d_consumer_smoke__/`);
  }
  if (value.indexStatus !== 200) reportErrors.push(`${label}.indexStatus must be 200`);
  if (!isRecord(value.canvas)) {
    reportErrors.push(`${label}.canvas must be an object`);
  } else {
    if (value.canvas.webgl2 !== true) reportErrors.push(`${label}.canvas.webgl2 must be true`);
    if (value.canvas.nonblank !== true) reportErrors.push(`${label}.canvas.nonblank must be true`);
    if (value.canvas.readbackSource !== "same-raf-after-render") {
      reportErrors.push(`${label}.canvas.readbackSource must be same-raf-after-render`);
    }
    if (!Number.isInteger(value.canvas.varyingPixelSamples) || value.canvas.varyingPixelSamples <= 0) {
      reportErrors.push(`${label}.canvas.varyingPixelSamples must be a positive integer`);
    }
  }
  if (!isRecord(value.runtime)) {
    reportErrors.push(`${label}.runtime must be an object`);
  } else {
    if (value.runtime.gameState !== 1) reportErrors.push(`${label}.runtime.gameState must be Playing (1)`);
    for (const field of ["entityCount", "spriteCount", "renderCommandCount", "drawCalls"]) {
      if (!Number.isInteger(value.runtime[field]) || value.runtime[field] <= 0) {
        reportErrors.push(`${label}.runtime.${field} must be a positive integer`);
      }
    }
    if (
      !Number.isInteger(value.runtime.sampledFrameCount) ||
      value.runtime.sampledFrameCount !== DEPLOYMENT_RUNTIME_SAMPLE_FRAMES
    ) {
      reportErrors.push(
        `${label}.runtime.sampledFrameCount must be ${DEPLOYMENT_RUNTIME_SAMPLE_FRAMES}`,
      );
    }
    if (value.runtime.statsSource !== "renderer.stats-after-frame") {
      reportErrors.push(`${label}.runtime.statsSource must be renderer.stats-after-frame`);
    }
  }
  if (!isRecord(value.budgets)) {
    reportErrors.push(`${label}.budgets must be an object`);
  } else {
    if (value.budgets.profileId !== templateName) {
      reportErrors.push(`${label}.budgets.profileId must match template ${templateName}`);
    }
    if (
      !Number.isInteger(value.budgets.sampleFrames) ||
      value.budgets.sampleFrames !== DEPLOYMENT_RUNTIME_SAMPLE_FRAMES
    ) {
      reportErrors.push(
        `${label}.budgets.sampleFrames must be ${DEPLOYMENT_RUNTIME_SAMPLE_FRAMES}`,
      );
    } else if (
      isRecord(value.runtime) &&
      value.runtime.sampledFrameCount !== value.budgets.sampleFrames
    ) {
      reportErrors.push(`${label}.runtime.sampledFrameCount must equal budgets.sampleFrames`);
    }
    const expectedBudget = deploymentRuntimeBudget(templateName, label, reportErrors);
    if (!Number.isInteger(value.budgets.maxDrawCalls) || value.budgets.maxDrawCalls <= 0) {
      reportErrors.push(`${label}.budgets.maxDrawCalls must be a positive integer`);
    } else {
      if (expectedBudget !== undefined && value.budgets.maxDrawCalls !== expectedBudget.maxDrawCalls) {
        reportErrors.push(
          `${label}.budgets.maxDrawCalls must match runtime budget profile ${templateName} (${expectedBudget.maxDrawCalls})`,
        );
      }
      if (isRecord(value.runtime) && value.runtime.drawCalls > value.budgets.maxDrawCalls) {
        reportErrors.push(`${label}.runtime.drawCalls must not exceed budgets.maxDrawCalls`);
      }
    }
  }
  if (value.wasmLoaded !== true) reportErrors.push(`${label}.wasmLoaded must be true`);
  if (value.wasmMimeValid !== true) reportErrors.push(`${label}.wasmMimeValid must be true`);
  if (!Number.isInteger(value.wasmResponseCount) || value.wasmResponseCount <= 0) {
    reportErrors.push(`${label}.wasmResponseCount must be a positive integer`);
  }
  if (value.browserErrors !== 0) reportErrors.push(`${label}.browserErrors must be 0`);
}

function deploymentRuntimeBudget(templateName, label, reportErrors) {
  if (typeof templateName !== "string" || templateName.length === 0) return undefined;
  try {
    return runtimeBudgetProfile(templateName);
  } catch {
    reportErrors.push(`${label}.budgets.profileId must reference known runtime budget profile ${templateName}`);
    return undefined;
  }
}

function validateGameplayReplaySummary(value, label, reportErrors) {
  if (!isRecord(value)) {
    reportErrors.push(`${label} must be an object`);
    return;
  }
  validateStatusString(value.status, `${label}.status`, reportErrors);
  if (typeof value.configured !== "boolean") {
    reportErrors.push(`${label}.configured must be a boolean`);
  }
  if (value.configured === true) {
    if (typeof value.scenario !== "string" || value.scenario.length === 0) {
      reportErrors.push(`${label}.scenario must be a non-empty string when configured`);
    }
    if (!Array.isArray(value.coverageTags) || value.coverageTags.length === 0) {
      reportErrors.push(`${label}.coverageTags must be a non-empty array when configured`);
    }
    if (typeof value.expectedHash !== "string" || value.expectedHash.length === 0) {
      reportErrors.push(`${label}.expectedHash must be a non-empty string when configured`);
    }
    if (typeof value.actualHash !== "string" || value.actualHash.length === 0) {
      reportErrors.push(`${label}.actualHash must be a non-empty string when configured`);
    }
    if (value.comparisonPassed !== true) {
      reportErrors.push(`${label}.comparisonPassed must be true when configured`);
    }
  } else if (value.configured === false) {
    if (value.status !== "not-configured") {
      reportErrors.push(`${label}.status must be not-configured when configured is false`);
    }
    if (!Number.isFinite(value.reports) || value.reports <= 0) {
      reportErrors.push(`${label}.reports must include at least one diagnostic when not configured`);
    }
  }
}

function validateRuntimeReplaySummary(value, label, reportErrors) {
  if (!isRecord(value)) {
    reportErrors.push(`${label} must be an object`);
    return;
  }
  validateStatusString(value.status, `${label}.status`, reportErrors);
  if (typeof value.configured !== "boolean") {
    reportErrors.push(`${label}.configured must be a boolean`);
  }
  if (typeof value.scenario !== "string" || value.scenario.length === 0) {
    reportErrors.push(`${label}.scenario must be a non-empty string`);
  }
  if (!Array.isArray(value.coverageTags) || value.coverageTags.length === 0) {
    reportErrors.push(`${label}.coverageTags must be a non-empty array`);
  }
  if (value.configured === true) {
    if (typeof value.expectedHash !== "string" || value.expectedHash.length === 0) {
      reportErrors.push(`${label}.expectedHash must be a non-empty string when configured`);
    }
    if (typeof value.actualHash !== "string" || value.actualHash.length === 0) {
      reportErrors.push(`${label}.actualHash must be a non-empty string when configured`);
    }
    if (value.comparisonPassed !== true) {
      reportErrors.push(`${label}.comparisonPassed must be true when configured`);
    }
  } else if (value.configured === false) {
    if (value.status !== "not-configured") {
      reportErrors.push(`${label}.status must be not-configured when configured is false`);
    }
    if (!Number.isFinite(value.reports) || value.reports <= 0) {
      reportErrors.push(`${label}.reports must include at least one diagnostic when not configured`);
    }
  }
}

function validateRuntimeRecipeSummary(value, label, reportErrors) {
  if (!isRecord(value)) {
    reportErrors.push(`${label} must be an object`);
    return;
  }
  validateStatusString(value.status, `${label}.status`, reportErrors);
  if (typeof value.scenario !== "string" || value.scenario.length === 0) {
    reportErrors.push(`${label}.scenario must be a non-empty string`);
  }
  if (!Array.isArray(value.coverageTags) || value.coverageTags.length === 0) {
    reportErrors.push(`${label}.coverageTags must be a non-empty array`);
  }
  if (!Number.isFinite(value.fixedDelta) || value.fixedDelta <= 0) {
    reportErrors.push(`${label}.fixedDelta must be a positive number`);
  }
  if (!Array.isArray(value.captureFrames) || value.captureFrames.length === 0) {
    reportErrors.push(`${label}.captureFrames must be a non-empty array`);
  }
}

function validateTopdownMutationChecks(template, label, reportStatus, reportErrors) {
  if (reportStatus !== "passed" || template.template !== "topdown") {
    return;
  }
  const mutationChecks = template.mutationChecks;
  if (!isRecord(mutationChecks)) {
    reportErrors.push(`${label}.mutationChecks must be an object`);
    return;
  }
  validateRejectedSummary(mutationChecks.staleReplayFixtureRejected, `${label}.mutationChecks.staleReplayFixtureRejected`, reportErrors);
  validateFixtureUpdateSummary(mutationChecks.staleReplayFixtureUpdate, `${label}.mutationChecks.staleReplayFixtureUpdate`, reportErrors);
  validateRejectedSummary(mutationChecks.gameSpecDriftRejected, `${label}.mutationChecks.gameSpecDriftRejected`, reportErrors);
  validateFixtureUpdateSummary(mutationChecks.gameSpecDriftFixtureUpdate, `${label}.mutationChecks.gameSpecDriftFixtureUpdate`, reportErrors);
}

function validateRejectedSummary(value, label, reportErrors) {
  if (!isRecord(value)) {
    reportErrors.push(`${label} must be an object`);
    return;
  }
  if (value.rejected !== true) {
    reportErrors.push(`${label}.rejected must be true`);
  }
  if (typeof value.code !== "string" || value.code.length === 0) {
    reportErrors.push(`${label}.code must be a non-empty string`);
  }
  if (typeof value.message !== "string" || value.message.length === 0) {
    reportErrors.push(`${label}.message must be a non-empty string`);
  }
}

function validateFixtureUpdateSummary(value, label, reportErrors) {
  if (!isRecord(value)) {
    reportErrors.push(`${label} must be an object`);
    return;
  }
  if (value.status !== "updated") {
    reportErrors.push(`${label}.status must be updated`);
  }
  if (typeof value.replayHash !== "string" || value.replayHash.length === 0) {
    reportErrors.push(`${label}.replayHash must be a non-empty string`);
  }
  if (!Number.isFinite(value.snapshotCount) || value.snapshotCount <= 0) {
    reportErrors.push(`${label}.snapshotCount must be a positive number`);
  }
}

async function validateArtifacts(value, reportErrors) {
  await requireDirectory(options.artifactDir, reportErrors);
  await requireFile(options.reportPath, reportErrors);
  if (isRecord(value.tarballs)) {
    await requireTarball(value.tarballs.authoringViewer, reportErrors);
    await requireTarball(value.tarballs.ferrumWeb, reportErrors);
    await requireTarball(value.tarballs.createGame, reportErrors);
    await requireTarball(value.tarballs.agents, reportErrors);
  }
  const requireSnapshots = value.status === "passed";
  await assertSnapshotHasNoForbiddenDirs(resolve(options.artifactDir, "tool-consumer"), "tool-consumer", reportErrors, {
    required: requireSnapshots,
  });
  await assertSnapshotHasNoForbiddenDirs(resolve(options.artifactDir, "sample-games"), "sample-games", reportErrors, {
    required: requireSnapshots,
  });
}

async function requireTarball(tarballName, reportErrors) {
  if (typeof tarballName !== "string" || tarballName.length === 0) {
    return;
  }
  await requireFile(resolve(options.artifactDir, "tarballs", tarballName), reportErrors);
}

async function requireDirectory(directoryPath, reportErrors) {
  try {
    const stats = await stat(directoryPath);
    if (!stats.isDirectory()) {
      reportErrors.push(`required artifact path must be a directory: ${relativePath(directoryPath)}`);
    }
  } catch (error) {
    reportErrors.push(`required artifact directory is missing: ${relativePath(directoryPath)} (${errorSummary(error)})`);
  }
}

async function requireFile(filePath, reportErrors) {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      reportErrors.push(`required artifact path must be a file: ${relativePath(filePath)}`);
    }
  } catch (error) {
    reportErrors.push(`required artifact file is missing: ${relativePath(filePath)} (${errorSummary(error)})`);
  }
}

async function assertSnapshotHasNoForbiddenDirs(snapshotRoot, label, reportErrors, { required }) {
  try {
    const stats = await stat(snapshotRoot);
    if (!stats.isDirectory()) {
      reportErrors.push(`${label} snapshot must be a directory`);
      return;
    }
  } catch (error) {
    if (required) {
      reportErrors.push(`${label} snapshot is missing (${errorSummary(error)})`);
    }
    return;
  }

  const forbiddenPaths = [];
  await walk(snapshotRoot, (entry) => {
    const relative = relativePath(entry, snapshotRoot);
    const parts = relative.split(sep);
    if (parts.some((part) => FORBIDDEN_SNAPSHOT_DIRS.includes(part))) {
      forbiddenPaths.push(relative);
    }
  });
  if (forbiddenPaths.length > 0) {
    reportErrors.push(`${label} snapshot must not include ${FORBIDDEN_SNAPSHOT_DIRS.join(", ")}: ${forbiddenPaths.slice(0, 5).join(", ")}`);
  }
}

async function walk(root, visit) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = resolve(root, entry.name);
    visit(entryPath);
    if (entry.isDirectory()) {
      await walk(entryPath, visit);
    }
  }
}

function parseArgs(args) {
  let artifactDir = resolve(REPO_ROOT, DEFAULT_ARTIFACT_DIR);
  let reportPath;
  let expectStatus;
  let validateArtifacts = true;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--artifact-dir") {
      artifactDir = resolve(REPO_ROOT, requiredArg(args, ++index, arg));
      continue;
    }
    if (arg.startsWith("--artifact-dir=")) {
      artifactDir = resolve(REPO_ROOT, arg.slice("--artifact-dir=".length));
      continue;
    }
    if (arg === "--report") {
      reportPath = resolve(REPO_ROOT, requiredArg(args, ++index, arg));
      continue;
    }
    if (arg.startsWith("--report=")) {
      reportPath = resolve(REPO_ROOT, arg.slice("--report=".length));
      continue;
    }
    if (arg === "--expect-status") {
      expectStatus = requiredStatus(args, ++index, arg);
      continue;
    }
    if (arg.startsWith("--expect-status=")) {
      expectStatus = parseStatus(arg.slice("--expect-status=".length), arg);
      continue;
    }
    if (arg === "--skip-artifacts") {
      validateArtifacts = false;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return {
    artifactDir,
    reportPath: reportPath ?? resolve(artifactDir, "consumer-smoke-report.json"),
    expectStatus,
    validateArtifacts,
  };
}

function requiredArg(args, index, flag) {
  const value = args[index];
  if (value === undefined || value.length === 0) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function requiredStatus(args, index, flag) {
  return parseStatus(requiredArg(args, index, flag), flag);
}

function parseStatus(value, flag) {
  if (!["passed", "failed"].includes(value)) {
    throw new Error(`${flag} must be passed or failed`);
  }
  return value;
}

function validateStatusString(value, label, reportErrors) {
  if (typeof value !== "string" || value.length === 0) {
    reportErrors.push(`${label} must be a non-empty string`);
  }
}

function validateTarballName(value, label, reportErrors) {
  if (typeof value !== "string" || !value.endsWith(".tgz")) {
    reportErrors.push(`${label} must be a .tgz filename`);
  }
}

function validateErrorSummary(value, label, reportErrors) {
  if (!isRecord(value)) {
    reportErrors.push(`${label} must be an object`);
    return;
  }
  if (typeof value.message !== "string" || value.message.length === 0) {
    reportErrors.push(`${label}.message must be a non-empty string`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function sameMembers(value, expected) {
  if (!Array.isArray(value) || value.length !== expected.length) {
    return false;
  }
  const set = new Set(value);
  return expected.every((entry) => set.has(entry));
}

function relativePath(value, from = REPO_ROOT) {
  return value.startsWith(REPO_ROOT) ? value.slice(from.length + 1) : value;
}

function errorSummary(error) {
  return error instanceof Error ? error.message : String(error);
}

function printHelp() {
  console.log(`Usage:
  node scripts/validate/validate-consumer-smoke-report.mjs [options]

Options:
  --artifact-dir <path>     Artifact directory. Default: ${DEFAULT_ARTIFACT_DIR}
  --report <path>           Report JSON path. Default: <artifact-dir>/consumer-smoke-report.json
  --expect-status <status>  Require passed or failed
  --skip-artifacts          Validate JSON only, without checking tarballs/snapshots
  -h, --help                Show this help
`);
}
