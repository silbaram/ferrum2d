import assert from "node:assert/strict";

export function assertVillageRenderBudget(stats, { empty = false } = {}) {
  const { drawCalls, spatial } = stats;
  const shadowDraws = spatial.shadowDrawCalls;
  const sceneDraws = drawCalls - shadowDraws;
  assert(sceneDraws > 0 && sceneDraws <= 160, `Village scene draw calls: ${sceneDraws}`);
  assert(shadowDraws >= 0 && shadowDraws <= 128, `Village shadow draw calls: ${shadowDraws}`);
  if (empty) assert.equal(spatial.modelTriangleCount, 0, "Empty grid rendered model triangles");
  else assert(spatial.modelTriangleCount > 0 && spatial.modelTriangleCount <= 60_000,
    `Village model triangles: ${spatial.modelTriangleCount}`);
}
