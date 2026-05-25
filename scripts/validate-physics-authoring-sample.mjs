#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { compilePhysicsAuthoringDocument } from "../packages/ferrum-web/dist/physicsAuthoringSchema.js";
import { resolvePhysicsSpec } from "../packages/ferrum-web/dist/physicsSpec.js";

const paths = process.argv.slice(2);

if (paths.length === 0) {
  console.error("Usage: node scripts/validate-physics-authoring-sample.mjs <authoring.json> [...]");
  process.exitCode = 1;
} else {
  for (const path of paths) {
    try {
      const source = await readFile(path, "utf8");
      const parsed = JSON.parse(source);
      const runtimeSpec = compilePhysicsAuthoringDocument(parsed, { path: "physicsAuthoring" });
      const resolved = resolvePhysicsSpec(runtimeSpec, { path: "physics" });
      if (Object.prototype.hasOwnProperty.call(runtimeSpec, "physicsEditor")) {
        throw new Error("runtime Physics Spec still contains physicsEditor metadata");
      }
      console.log(`${path}: ok`);
      console.log(JSON.stringify({
        mode: resolved.mode,
        bodyCount: Object.keys(resolved.bodies).length,
        jointCount: Object.keys(resolved.joints).length,
        debug: resolved.debug,
      }, null, 2));
    } catch (error) {
      console.error(`${path}: failed`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
