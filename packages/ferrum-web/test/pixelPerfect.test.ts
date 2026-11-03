import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { resolvePixelPerfectOptions as options, resolvePixelPerfectPresentation as layout, pixelPerfectPointToViewport as point } from "../src/pixelPerfect.js";
import { resolveSceneDisplay } from "../src/sceneDisplay.js";
import { resolveSceneAuthoringDocument } from "../src/sceneAuthoringDocument.js";
import { createDataSceneView } from "../src/dataSceneView.js";
import { resolveRendererPixelPerfect } from "../src/createRenderer.js";
import type { FerrumEngine } from "../src/engineTypes.js";
test("pixelPerfect is opt-in, bounded and snapshots caller-owned settings", () => {
    equal(options(undefined), undefined);
    equal(options(false), undefined);
    const input = { width: 320, height: 180, background: [.1, .2, .3] };
    const copy = options(input)!;
    input.background[0] = 1;
    input.width = 64;
    equal(copy.width, 320);
    equal(copy.background![0], .1);
    ok(Object.isFrozen(copy) && Object.isFrozen(copy.background));
    for (const invalid of [null, true, {}, { width: 0, height: 1 }, { width: 1.5, height: 1 }, { width: 2049, height: 1 }, { width: 2048, height: 2048 },
        { width: 1, height: 1, background: null }, { width: 1, height: 1, background: new Array(3) }, { width: 1, height: 1, background: [0, 0] }, { width: 1, height: 1, background: [0, 0, NaN] }, { width: 1, height: 1, background: [2, 0, 0] }, { width: 1, height: 1, typo: true }])
        throws(() => options(invalid));
});
test("pixel snap is optional, strictly boolean and retained through scene validation", () => {
    equal(options({ width: 32, height: 24 })!.snap, undefined);
    for (const snap of [false, true]) {
        equal(options({ width: 32, height: 24, snap })!.snap, snap);
        const display = resolveSceneDisplay({ pixelPerfect: { width: 32, height: 24, snap } });
        ok(display?.pixelPerfect && display.pixelPerfect.snap === snap);
    }
    for (const snap of [0, 1, "true", null, {}, []]) {
        throws(() => options({ width: 32, height: 24, snap }), /snap must be a boolean/);
        throws(() => resolveSceneDisplay({ pixelPerfect: { width: 32, height: 24, snap } }), /snap/);
    }
});
test("shared/backend settings treat omitted snap as false and reject real conflicts", () => {
    const plain = { width: 32, height: 24 }, off = { ...plain, snap: false }, on = { ...plain, snap: true };
    equal(resolveRendererPixelPerfect({ pixelPerfect: off, webgl2: { pixelPerfect: plain } })!.snap, false);
    equal(resolveRendererPixelPerfect({ pixelPerfect: plain, webgpu: { pixelPerfect: off } })!.snap, undefined);
    throws(() => resolveRendererPixelPerfect({ pixelPerfect: on, webgl2: { pixelPerfect: off } }), /Conflicting/);
});
test("integer device pixels, centered odd margins, fractional DPR and nearest small-window fallback", () => {
    for (const dpr of [1, 1.5, 2]) {
        const width = Math.floor(713 * dpr), height = Math.floor(471 * dpr), p = layout(width, height, { width: 320, height: 180 });
        equal(p.scale, Math.floor(Math.min(width / 320, height / 180)));
        ok(p.integerScale);
        equal(p.width, 320 * p.scale);
        equal(p.height, 180 * p.scale);
        ok(Math.abs(width - p.width - 2 * p.x) <= 1);
        const center = point(p, 713 / 2, 471 / 2, 713, 471);
        ok(Math.abs(center.x - 160) <= 1);
        ok(center.inside);
        equal(point(p, -1, 0, 713, 471).inside, false);
    }
    const small = layout(100, 70, { width: 320, height: 180 });
    ok(!small.integerScale);
    ok(small.width <= 100 && small.height <= 70);
    throws(() => layout(0, 1, { width: 1, height: 1 }));
    throws(() => layout(1, 1, { width: 0, height: 1 }));
});
test("letterbox pointer boundaries use the actual rounded rectangle", () => {
    const p = layout(703, 407, { width: 320, height: 180 });
    const inside = point(p, (p.x + .5) * 703 / p.canvasWidth, (p.y + .5) * 407 / p.canvasHeight, 703, 407);
    ok(inside.inside);
    equal(point(p, p.x + p.width, p.y, 703, 407).inside, false);
    equal(point(p, p.x, p.y + p.height, 703, 407).inside, false);
    deepEqual(point(p, p.x, p.y, 703, 407), { x: 0, y: 0, inside: true });
});
test("scene display validation retains false and rejects spatial/flat ambiguity", () => {
    equal(resolveSceneDisplay(undefined), undefined);
    deepEqual(resolveSceneDisplay({ pixelPerfect: false }), { pixelPerfect: false });
    const doc = { format: "ferrum2d.consumer.scene-authoring", version: 1, sceneComposition: { prefabs: {}, fragments: { main: { instances: [] } }, initialFragment: "main" }, behaviorRecipes: { entities: {} }, display: { pixelPerfect: { width: 320, height: 180 } } };
    equal(resolveSceneAuthoringDocument(doc).display!.pixelPerfect && resolveSceneAuthoringDocument(doc).display!.pixelPerfect !== false, true);
    throws(() => resolveSceneDisplay({ pixelperfect: { width: 320, height: 180 } }));
    throws(() => resolveSceneAuthoringDocument({ ...doc, spatial: { camera: { projection: "orthographic", position: { x: 0, y: -100, elevation: 100 }, target: { x: 0, y: 0, elevation: 0 }, height: 100, near: .1, far: 1000 }, terrain: [], billboards: {} } }), /pixelPerfect/);
});
test("Data Scene view round-trips CSS/client/world with zoom, ground projection and bars", () => {
    let zoom = 1;
    const p = layout(1200, 800, { width: 320, height: 180 });
    const renderer = { setViewportZoom: (z: number) => { zoom = z; }, setGroundYScale: () => { }, viewportSize: () => ({ width: 320 / zoom, height: 180 / zoom }), pixelPerfectPresentation: () => p };
    const engine = { setDataSceneCamera: () => true, setDataSceneGroundYScale: () => true, setViewportSize: () => { }, cameraX: () => 40, cameraY: () => 60, cameraGroundYScale: () => .5 } as unknown as FerrumEngine;
    const canvas = { clientWidth: 800, clientHeight: 533.333, width: 1200, height: 800, getBoundingClientRect: () => ({ left: 17, top: 21, width: 400, height: 266.6665 }) } as unknown as HTMLCanvasElement;
    const view = createDataSceneView(engine, renderer, canvas, { zoom: 2, groundYScale: .5 }), snapshot = view.snapshot();
    throws(()=>view.worldToScreen({x:NaN,y:0}));
    throws(()=>view.worldToScreen({x:0,y:Infinity}));
    equal(snapshot.worldWidth, 160);
    equal(snapshot.worldHeight, 180);
    for (const world of [{ x: 0, y: 0 }, { x: 40, y: 60 }, { x: -10, y: 100 }]) {
        const screen = view.worldToScreen(world), round = view.screenToWorld(screen);
        ok(Math.abs(round.x - world.x) < 1e-8 && Math.abs(round.y - world.y) < 1e-8);
        const client = { x: 17 + screen.x * .5, y: 21 + screen.y * .5 }, mapped = view.pointerToWorld(client);
        ok(Math.abs(mapped.x - world.x) < 1e-8 && Math.abs(mapped.y - world.y) < 1e-8);
    }
});

test("Data Scene view preflights pixel settings/capabilities before camera or projection mutation",()=>{
  const calls:string[]=[];
  const engine={setDataSceneCamera:()=>{calls.push('camera');return true;},setDataSceneGroundYScale:()=>{calls.push('ground');return true;},setViewportSize:()=>{calls.push('viewport');}} as unknown as FerrumEngine;
  const renderer={setViewportZoom:()=>{calls.push('zoom');},viewportSize:()=>({width:320,height:180})};
  const canvas={} as HTMLCanvasElement;
  throws(()=>createDataSceneView(engine,renderer,canvas,{pixelPerfect:{width:0,height:180}}));deepEqual(calls,[]);
  throws(()=>createDataSceneView(engine,renderer,canvas,{pixelPerfect:{width:320,height:180}}),/support pixelPerfect/);deepEqual(calls,[]);
  const custom={...renderer,setPixelPerfect:()=>{calls.push('pixel');},pixelPerfectPresentation:()=>undefined};
  const view=createDataSceneView(engine,custom,canvas);calls.length=0;
  throws(()=>view.setPixelPerfect({width:0,height:1}));deepEqual(calls,[]);
});
