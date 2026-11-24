import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { fitDataSceneZoom } from "../src/dataSceneView.js";
import { resolveSceneAuthoringDocument } from "../src/sceneAuthoringDocument.js";
import { resolveSceneDisplay } from "../src/sceneDisplay.js";

test("scene display normalizes fit dimensions, offsets and explicit disable", () => {
  const fit = { width: 640, height: 384 };
  deepEqual(resolveSceneDisplay({ fit }), { fit: { ...fit, x: 0, y: 0 } });
  deepEqual(resolveSceneDisplay({ fit: { width: 0.5, height: 100_000, x: -12, y: 4 }, pixelPerfect: false }), {
    fit: { width: 0.5, height: 100_000, x: -12, y: 4 },
    pixelPerfect: false,
  });
  deepEqual(resolveSceneDisplay({ fit: false }), { fit: false });
  deepEqual(resolveSceneDisplay({}), {});
  for (const width of [0, -1, Infinity, NaN, 100_001, "640", undefined]) {
    throws(() => resolveSceneDisplay({ fit: { width, height: 384 } }, "document.display"), /document\.display\.fit\.width/);
  }
  throws(() => resolveSceneDisplay({ fit: { ...fit, height: null } }), /display\.fit\.height/);
  throws(() => resolveSceneDisplay({ fit: { ...fit, x: Infinity } }), /display\.fit\.x/);
  throws(() => resolveSceneDisplay({ fit: { ...fit, y: null } }), /display\.fit\.y/);
  throws(() => resolveSceneDisplay({ fit: { ...fit, depth: 3 } }), /display\.fit\.depth/);
  throws(() => resolveSceneDisplay({ fit: true }), /display\.fit/);
  throws(() => resolveSceneDisplay({ fit, pixelPerfect: { width: 320, height: 180 } }), /display\.fit.*pixelPerfect/);
});

test("authored fit rejects spatial scenes and permits an explicit disable", () => {
  const spatial = {
    camera: { projection: "orthographic", position: { x: 0, y: -100, elevation: 100 }, target: { x: 0, y: 0, elevation: 0 }, height: 200 },
    terrain: [], billboards: {},
  };
  const document = {
    format: "ferrum2d.consumer.scene-authoring", version: 1, spatial,
    sceneComposition: { initialFragment: "main", prefabs: {}, fragments: { main: { instances: [] } } },
    behaviorRecipes: { entities: {} },
  };
  throws(() => resolveSceneAuthoringDocument({ ...document, display: { fit: { width: 640, height: 384 } } }), /display\.fit.*spatial/);
  equal(resolveSceneAuthoringDocument({ ...document, display: { fit: false } }).display?.fit, false);
});

test("fit zoom honors the supported range and skips zero-size canvases", () => {
  const canvas = { clientWidth: 1000, clientHeight: 500 } as HTMLCanvasElement;
  equal(fitDataSceneZoom(canvas, { width: 640, height: 384 }), 500 / 384);
  equal(fitDataSceneZoom(canvas, { width: Number.MIN_VALUE, height: Number.MIN_VALUE }), 10000);
  equal(fitDataSceneZoom({ clientWidth: 1, clientHeight: 1 } as HTMLCanvasElement, { width: 100_000, height: 100_000 }), 0.0001);
  equal(fitDataSceneZoom({ clientWidth: 1000, clientHeight: 0 } as HTMLCanvasElement, { width: 640, height: 384 }), undefined);
});
