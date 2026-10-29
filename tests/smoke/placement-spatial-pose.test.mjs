import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../apps/placement-viewer/package.json", import.meta.url));
const ts = require("typescript");
const { placementSpatialPose, placementLightAnchor } = await import("data:text/javascript;base64," + Buffer.from(ts.transpileModule(
  await readFile("apps/placement-viewer/src/placementSpatialPose.ts", "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText).toString("base64"));

test("light anchors follow nested attached bodies, adding only the target visual elevation", () => {
  const state = {
    instances: [
      { instanceId: "base", transform: { x: 100, y: -50, rotationRadians: 1, scale: 3 }, body: { heightSpan: { elevation: 20 } } },
      { instanceId: "arm", transform: { x: 999, y: 999 }, body: { heightSpan: { elevation: 999 } } },
      { instanceId: "lamp", transform: { x: -999, y: -999 }, body: { heightSpan: { elevation: 999 } } },
    ],
    spatial: {
      models: { base: { elevation: 200 }, arm: { elevation: 90 }, lamp: { elevation: 7 } }, billboards: {},
      attachments: { arm: { parent: "base", x: 10, y: 0, elevation: 5, yawDegrees: 90 }, lamp: { parent: "arm", x: 10, y: 4, elevation: 3 } },
    },
  };
  assert.deepEqual(placementSpatialPose(state, "lamp"), { x: 106, y: -40, elevation: 28, yaw: Math.PI / 2 });
  assert.deepEqual(placementLightAnchor(state, "lamp"), { x: 106, y: -40, elevation: 35 });
  assert.deepEqual(placementLightAnchor(state), { x: 0, y: 0, elevation: 0 });
  assert.deepEqual(placementLightAnchor(state, "base"), { x: 100, y: -50, elevation: 220 });
  state.spatial.attachments.base = { parent: "lamp" };
  assert.throws(() => placementLightAnchor(state, "lamp"), /cycle/);
  assert.throws(() => placementLightAnchor(state, "missing"), /Unknown/);
});
