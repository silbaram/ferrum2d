import { AssetLoader, createDataSceneView, createFerrumRuntime, createRenderer, type DataSceneView } from "@ferrum2d/ferrum-web/core";
import type { SceneAuthoringDocumentSpec } from "@ferrum2d/ferrum-web/authoring";
import { createOwner, type ExampleHost, type ExampleSession } from "../../example";
import { spriteControls as text } from "./messages";
import scene from "./scene.json";

// Sprite drawing: one picture's position, rotation, scale, color and opacity.
// robot.png (a 32×40 four-frame sheet) and panel.png (a 9-slice border) are Ferrum2D's own demo art,
// copied from examples/starter-runtime/public/playground (rebuilt by scripts/assets/build-engine-playground.mjs).

const WORLD = { width: 640, height: 384 };
const SPRITE = { width: 96, height: 120 };
const FIRST = { x: 320, y: 192, rotation: 0, scale: 1, origin: "center", color: "#ffffff", opacity: 100, ghost: true };
type Values = typeof FIRST;

const COLORS = [
  { value: "#ffffff", text: text.original },
  { value: "#ff8a80", text: text.red },
  { value: "#ffd180", text: text.orange },
  { value: "#b9f6ca", text: text.green },
  { value: "#80d8ff", text: text.blue },
];

/** The part of the scene document this example edits. */
interface Instance {
  id: string;
  x: number;
  y: number;
  rotationRadians?: number;
  scale?: number;
  props: { components: { visual: { originY?: number; tint?: string } } };
}
interface SceneDocument { sceneComposition: { fragments: { main: { instances: Instance[] } } } }

/** The scene with these values: drawing properties are scene data, the engine draws them. */
function documentFor(values: Values): SceneDocument {
  const document = structuredClone(scene) as unknown as SceneDocument;
  const fragment = document.sceneComposition.fragments.main;
  const robot = fragment.instances.find(instance => instance.id === "robot")!;
  robot.x = values.x;
  robot.y = values.y;
  robot.rotationRadians = Number((values.rotation * Math.PI / 180).toFixed(4));
  robot.scale = values.scale;
  const visual = robot.props.components.visual;
  visual.originY = values.origin === "feet" ? 1 : 0.5;
  visual.tint = values.color + Math.round(values.opacity / 100 * 255).toString(16).padStart(2, "0");
  if (!values.ghost) fragment.instances = fragment.instances.filter(instance => instance.id !== "origin");
  return document;
}
const spec = (document: SceneDocument) => document as unknown as SceneAuthoringDocumentSpec;

export default async function start(host: ExampleHost): Promise<ExampleSession> {
  const { canvas, overlay, signal, controls } = host;
  const owner = createOwner(signal);
  try {
    const clearColor: [number, number, number, number] = [0.027, 0.039, 0.059, 1];
    const renderer = await createRenderer(canvas, { preferred: host.renderer, webgl2: { clearColor }, webgpu: { clearColor } });
    owner.own(() => renderer.destroy());
    owner.check();
    const backend = "gpuDevice" in renderer ? "webgpu" : "webgl2";

    // Two small textures, read once. Changing a setting never reloads them.
    const assets = new AssetLoader(renderer);
    const url = (file: string) => new URL(`examples/sprite/${file}`, document.baseURI).href;
    await assets.loadAssets({ textures: { robot: url("robot.png"), panel: url("panel.png") } }, undefined, { signal });
    owner.check();

    let values: Values = { ...FIRST }, last = 0;
    const runtime = await createFerrumRuntime({
      canvas, renderer, assetHost: assets, dataScene: spec(documentFor(values)), autostart: false,
      onFrame: ({ frame, rendererStats, fps }) => {
        const now = performance.now();
        if (now - last < 200) return;
        last = now;
        const resources = renderer.resourceStats?.();
        host.report({ renderer: backend, fps, entities: frame.entityCount, commands: rendererStats.renderCommandCount,
          drawCalls: rendererStats.drawCalls, textures: resources?.textureCount, textureBytes: resources?.textureBytes });
      },
    });
    owner.own(() => runtime.destroy());
    owner.check();

    // Fit the 640 × 384 world to the canvas and keep the camera on its center.
    let view: DataSceneView = createDataSceneView(runtime.engine, renderer, canvas, { x: WORLD.width / 2, y: WORLD.height / 2 });
    const fit = () => {
      if (canvas.clientWidth > 0 && canvas.clientHeight > 0) view.setZoom(Math.min(canvas.clientWidth / WORLD.width, canvas.clientHeight / WORLD.height));
    };

    // The pivot: position, rotation and scale all apply around this point.
    const pivot = document.createElement("span"); pivot.className = "pivot";
    overlay.append(pivot);
    const place = () => {
      if (canvas.clientWidth <= 0) return;
      const point = view.worldToScreen({ x: values.x, y: values.y });
      pivot.style.transform = `translate(${point.x}px, ${point.y}px)`;
    };
    const resize = new ResizeObserver(() => { fit(); place(); });
    resize.observe(canvas);
    owner.own(() => resize.disconnect());
    fit(); place();

    // Setting changes edit the scene document and apply it again, at most once a frame.
    let queued = 0;
    const apply = () => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        if (signal.aborted) return;
        const document = documentFor(values);
        runtime.dataScene!.reapply(spec(document));
        view = createDataSceneView(runtime.engine, renderer, canvas, { x: WORLD.width / 2, y: WORLD.height / 2 });
        fit(); place();
        host.showScene(document, "robot");
      });
    };
    owner.own(() => cancelAnimationFrame(queued));
    const set = (patch: Partial<Values>) => { values = { ...values, ...patch }; apply(); };

    const x = controls.slider({ label: text.x, min: 0, max: WORLD.width, step: 1, value: FIRST.x, onInput: value => set({ x: value }) });
    const y = controls.slider({ label: text.y, min: 0, max: WORLD.height, step: 1, value: FIRST.y, onInput: value => set({ y: value }) });
    const rotation = controls.slider({ label: text.rotation, min: -180, max: 180, step: 1, unit: "°", value: FIRST.rotation, onInput: value => set({ rotation: value }) });
    const scale = controls.slider({ label: text.scale, min: 0.25, max: 2.5, step: 0.05, unit: "×", value: FIRST.scale, onInput: value => set({ scale: value }) });
    const origin = controls.choice({ label: text.pivot, value: FIRST.origin, onChange: value => set({ origin: value }),
      options: [{ value: "center", text: text.center }, { value: "feet", text: text.feet }] });
    const color = controls.choice({ label: text.tint, value: FIRST.color, onChange: value => set({ color: value }),
      options: COLORS.map(item => ({ ...item, color: item.value })) });
    const opacity = controls.slider({ label: text.opacity, min: 0, max: 100, step: 1, unit: "%", value: FIRST.opacity, onInput: value => set({ opacity: value }) });
    const ghost = controls.toggle({ label: text.ghost, value: FIRST.ghost, onChange: value => set({ ghost: value }) });
    controls.hint(text.dragHint);

    // Drag the robot: hit-test in its own rotated, scaled box.
    const inside = (point: { x: number; y: number }) => {
      const angle = -values.rotation * Math.PI / 180, dx = point.x - values.x, dy = point.y - values.y;
      const localX = (dx * Math.cos(angle) - dy * Math.sin(angle)) / values.scale;
      const localY = (dx * Math.sin(angle) + dy * Math.cos(angle)) / values.scale;
      const top = values.origin === "feet" ? -SPRITE.height : -SPRITE.height / 2;
      return Math.abs(localX) <= SPRITE.width / 2 && localY >= top && localY <= top + SPRITE.height;
    };
    const world = (event: PointerEvent) => view.pointerToWorld({ x: event.clientX, y: event.clientY });
    let drag: { id: number; dx: number; dy: number } | undefined;
    canvas.addEventListener("pointerdown", event => {
      const point = world(event);
      if (!inside(point)) return;
      drag = { id: event.pointerId, dx: values.x - point.x, dy: values.y - point.y };
      canvas.setPointerCapture(event.pointerId);
      canvas.dataset.cursor = "grabbing";
      event.preventDefault();
    }, { signal });
    canvas.addEventListener("pointermove", event => {
      const point = world(event);
      if (!drag) { canvas.dataset.cursor = inside(point) ? "grab" : ""; return; }
      if (event.pointerId !== drag.id) return;
      const next = { x: Math.round(Math.min(WORLD.width, Math.max(0, point.x + drag.dx))), y: Math.round(Math.min(WORLD.height, Math.max(0, point.y + drag.dy))) };
      x.set(next.x); y.set(next.y); set(next);
    }, { signal });
    const end = (event: PointerEvent) => { if (drag?.id === event.pointerId) { drag = undefined; canvas.dataset.cursor = "grab"; } };
    canvas.addEventListener("pointerup", end, { signal });
    canvas.addEventListener("pointercancel", end, { signal });

    host.showScene(documentFor(values), "robot");
    runtime.start();

    return {
      reset() {
        values = { ...FIRST };
        x.set(FIRST.x); y.set(FIRST.y); rotation.set(FIRST.rotation); scale.set(FIRST.scale);
        origin.set(FIRST.origin); color.set(FIRST.color); opacity.set(FIRST.opacity); ghost.set(FIRST.ghost);
        apply();
      },
      destroy: owner.destroy,
    };
  } catch (error) {
    owner.destroy();
    throw error;
  }
}
