import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";

import {
  createScenePlacementViewport,
  sceneBackbufferToScreen,
  sceneScreenToBackbuffer,
  screenToSceneWorld,
  snapSceneWorldPoint,
  worldToSceneScreen,
} from "../src/authoring.js";

test("ScenePlacementViewport maps screen and world coordinates like the runtime camera", () => {
  const viewport = createScenePlacementViewport({
    cssWidth: 800,
    cssHeight: 480,
  });

  deepEqual(screenToSceneWorld(viewport, { x: 0, y: 0 }), { x: 0, y: 0 });
  deepEqual(screenToSceneWorld(viewport, { x: 400, y: 240 }), { x: 400, y: 240 });
  deepEqual(worldToSceneScreen(viewport, { x: 800, y: 480 }), { x: 800, y: 480 });
  equal(viewport.worldMinX, 0);
  equal(viewport.worldMinY, 0);
  equal(viewport.worldMaxX, 800);
  equal(viewport.worldMaxY, 480);
});

test("ScenePlacementViewport supports camera center, zoom, and DPR backbuffer conversion", () => {
  const viewport = createScenePlacementViewport({
    cssWidth: 800,
    cssHeight: 600,
    dpr: 2,
    cameraX: 1_000,
    cameraY: 500,
    zoom: 2,
  });

  deepEqual(screenToSceneWorld(viewport, { x: 0, y: 0 }), { x: 800, y: 350 });
  deepEqual(screenToSceneWorld(viewport, { x: 400, y: 300 }), { x: 1_000, y: 500 });
  deepEqual(worldToSceneScreen(viewport, { x: 1_200, y: 650 }), { x: 800, y: 600 });
  deepEqual(sceneScreenToBackbuffer(viewport, { x: 125, y: 50 }), { x: 250, y: 100 });
  deepEqual(sceneBackbufferToScreen(viewport, { x: 250, y: 100 }), { x: 125, y: 50 });
  equal(viewport.backbufferWidth, 1_600);
  equal(viewport.backbufferHeight, 1_200);
});

test("snapSceneWorldPoint snaps to grid with optional origin and mode", () => {
  deepEqual(snapSceneWorldPoint({ x: 21, y: 23 }, { gridSize: 16, originX: 4 }), {
    x: 20,
    y: 16,
  });
  deepEqual(snapSceneWorldPoint({ x: 21, y: 23 }, { gridSize: 16, mode: "floor" }), {
    x: 16,
    y: 16,
  });
  deepEqual(snapSceneWorldPoint({ x: 21, y: 23 }, { gridSize: 16, mode: "ceil" }), {
    x: 32,
    y: 32,
  });
});

test("ScenePlacementViewport rejects invalid numeric inputs", () => {
  throwsMatching(
    () => createScenePlacementViewport({ cssWidth: 0, cssHeight: 480 }),
    /scenePlacementViewport\.cssWidth must be greater than 0/u,
  );
  throwsMatching(
    () => createScenePlacementViewport({ cssWidth: 800, cssHeight: 480, zoom: Number.NaN }),
    /scenePlacementViewport\.zoom must be a finite number/u,
  );
  throwsMatching(
    () => screenToSceneWorld(createScenePlacementViewport({ cssWidth: 800, cssHeight: 480 }), {
      x: Number.POSITIVE_INFINITY,
      y: 0,
    }),
    /scenePlacement\.screen\.x must be a finite number/u,
  );
  throwsMatching(
    () => snapSceneWorldPoint({ x: 1, y: 2 }, { gridSize: 0 }),
    /scenePlacement\.snap\.gridSize must be greater than 0/u,
  );
});

function throwsMatching(action: () => void, pattern: RegExp): void {
  try {
    action();
  } catch (error) {
    if (!(error instanceof Error)) {
      throw new Error("expected thrown value to be an Error");
    }
    ok(pattern.test(error.message), `expected ${JSON.stringify(error.message)} to match ${pattern}`);
    return;
  }
  throw new Error(`expected function to throw ${pattern}`);
}
