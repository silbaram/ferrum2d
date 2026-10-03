import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { createDataSceneView } from "../src/core.js";
import type { FerrumEngine } from "../src/engineTypes.js";

test("Data Scene view uses a common camera for CSS/device round trips and world lights", () => {
  for (const [width, height] of [[1280, 720], [390, 844]]) for (const dpr of [1, 2]) for (const zoom of [0.5, 1, 2]) for (const groundYScale of [1, 0.72]) {
    let viewport = { width, height };
    const engine = { setDataSceneCamera: () => true, setDataSceneGroundYScale: () => true, setViewportSize: (w: number, h: number) => { viewport = { width: w, height: h }; }, cameraX: () => 800, cameraY: () => 600, cameraGroundYScale: () => groundYScale } as unknown as FerrumEngine;
    const renderer = { setGroundYScale: () => {}, viewportSize: () => viewport, setViewportZoom: (z: number) => { viewport = { width: width / z, height: height / z }; } };
    const canvas = { clientWidth: width, clientHeight: height, width: width * dpr, height: height * dpr,
      getBoundingClientRect: () => ({ left: 30, top: 40, width: width * 0.8, height: height * 0.8 }) } as unknown as HTMLCanvasElement;
    const view = createDataSceneView(engine, renderer, canvas, { zoom, groundYScale });
    const snapshot = view.snapshot({ cameraX: 900, cameraY: 650 });
    const world = { x: 970, y: 630 };
    const screen = view.worldToScreen(world, snapshot);
    const round = view.screenToWorld(screen, snapshot);
    ok(Math.abs(round.x - world.x) < 1e-8 && Math.abs(round.y - world.y) < 1e-8);
    const pointer = view.pointerToWorld({ x: 30 + screen.x * 0.8, y: 40 + screen.y * 0.8 }, snapshot);
    ok(Math.abs(pointer.x - world.x) < 0.00001 && Math.abs(pointer.y - world.y) < 0.00001);
    equal(snapshot.backbufferWidth, width * dpr);
    equal(snapshot.worldWidth, width / zoom);
    equal(snapshot.worldHeight, height / zoom / groundYScale);
    const resetFrame = view.snapshot({ cameraX: 900, cameraY: 650, cameraGroundYScale: 1 });
    equal(resetFrame.groundYScale, 1);
    equal(resetFrame.worldHeight, height / zoom);
    const light = view.lighting({ pointLights: [{ ...world, radius: 25 }], tileOccluders: [{ ...world, width: 8, height: 12 }] }, snapshot);
    equal(light.pointLights![0].x, screen.x / zoom);
    equal(light.pointLights![0].radius, 25);
    ok(Math.abs(light.tileOccluders![0].y - screen.y / zoom) < 1e-8);
    equal(light.tileOccluders![0].height, 12 * groundYScale);
    equal(light.pointLights![0].radiusY, 25 * groundYScale);
    throws(() => view.setGroundYScale(0), /groundYScale/);
    throws(() => view.setZoom(0), /zoom/);
  }
});
