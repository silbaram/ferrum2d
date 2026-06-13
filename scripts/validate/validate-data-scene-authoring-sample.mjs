#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  instantiateSceneFragment,
  resolveSceneAuthoringDocument,
} from "../../packages/ferrum-web/dist/index.js";

const FORBIDDEN_MINIMUM_CONTRACT_PROPS = new Set([
  "runtimeEntity",
  "builtinShooterPlayer",
  "builtinBreakoutPaddle",
  "builtinBreakoutBall",
  "builtinPlatformerPlayer",
]);

const paths = process.argv.slice(2);

if (paths.length === 0) {
  console.error("Usage: node scripts/validate/validate-data-scene-authoring-sample.mjs <scene-authoring.json> [...]");
  process.exitCode = 1;
} else {
  for (const path of paths) {
    try {
      const source = await readFile(path, "utf8");
      const document = JSON.parse(source);
      assertNoStarterRuntimeProps(document);
      const resolved = resolveSceneAuthoringDocument(document, {
        path: "dataSceneAuthoring",
        validateBindings: true,
        missingBehavior: "error",
      });
      const instances = instantiateSceneFragment(resolved.sceneComposition);
      if (instances.length === 0) {
        throw new Error("minimum DataScene authoring fixture must instantiate at least one scene instance");
      }
      console.log(`${path}: ok`);
      console.log(JSON.stringify({
        format: resolved.format,
        version: resolved.version,
        initialFragment: resolved.sceneComposition.initialFragment,
        prefabCount: Object.keys(resolved.sceneComposition.prefabs).length,
        instanceCount: instances.length,
        behaviorProfileCount: Object.keys(resolved.behaviorRecipes.entities).length,
        commandCount: resolved.bindingPlan?.commands.length ?? 0,
      }, null, 2));
    } catch (error) {
      console.error(`${path}: failed`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}

function assertNoStarterRuntimeProps(value, path = "dataSceneAuthoring") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoStarterRuntimeProps(item, `${path}.${index}`));
    return;
  }
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && FORBIDDEN_MINIMUM_CONTRACT_PROPS.has(value)) {
      throw new Error(`${path} must not use starter-scene runtime binding '${value}'`);
    }
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_MINIMUM_CONTRACT_PROPS.has(key)) {
      throw new Error(`${path}.${key} is not part of the minimum DataScene authoring contract`);
    }
    assertNoStarterRuntimeProps(item, `${path}.${key}`);
  }
}
