import {
  createFerrumRuntime, type CollisionEventView, type PhysicsEntityHandle,
} from "@ferrum2d/ferrum-web/core";
import type { SceneAuthoringDocumentSpec } from "@ferrum2d/ferrum-web/authoring";
import { createOwner, type ExampleHost, type ExampleSession } from "../../example";
import { collisionControls as text } from "./messages";
import scene from "./scene.json";

// Collisions and triggers: a kinematic robot among static walls, trigger energy cells and a trigger zone.
// The example only sets the robot's velocity; the engine blocks, slides, reports and collects.
// The art is Ferrum2D's own, drawn by scripts/assets/build-example-collision.mjs: floor, wall (a nine-slice),
// zone and a four-frame energy cell, plus the Engine Playground robot sheet.

const WORLD = { width: 640, height: 384 };
const START = { x: 96, y: 248 };
const FIRST = { speed: 160, shape: "box", inner: "solid" };
type Values = typeof FIRST;
const INNER_WALLS = ["inner_a", "inner_b"];
const ZONE = { x: 520, y: 104, width: 112, height: 96 };

/** The part of the scene document this example edits. */
interface Instance {
  id: string;
  x: number;
  y: number;
  props: { components: { visual: { tint?: string }; collider: unknown } };
}
interface SceneDocument { sceneComposition: { fragments: { main: { instances: Instance[] } } } }

/** Where the robot is and what it has collected carry over when a setting changes the document. */
interface Progress { robot: { x: number; y: number }; collected: Set<string> }

function documentFor(values: Values, progress: Progress): SceneDocument {
  const document = structuredClone(scene) as unknown as SceneDocument;
  const fragment = document.sceneComposition.fragments.main;
  fragment.instances = fragment.instances.filter(instance => !progress.collected.has(instance.id));
  for (const instance of fragment.instances) {
    if (instance.id === "robot") {
      instance.x = Math.round(progress.robot.x);
      instance.y = Math.round(progress.robot.y);
      instance.props.components.collider = values.shape === "circle"
        ? { type: "circle", radius: 18, isTrigger: false }
        : { type: "aabb", halfWidth: 14, halfHeight: 20, isTrigger: false };
    } else if (INNER_WALLS.includes(instance.id) && values.inner === "trigger") {
      // A trigger wall looks see-through so it reads differently from the solid ones.
      instance.props.components.collider = { ...instance.props.components.collider as object, isTrigger: true };
      instance.props.components.visual.tint = "#ffffff59";
    }
  }
  return document;
}
const spec = (document: SceneDocument) => document as unknown as SceneAuthoringDocumentSpec;

const pose = (clip: number) => ({ up: { clip }, down: { clip }, left: { clip, flipX: true }, right: { clip } });
const POSES = { idle: pose(0), walk: pose(1) };

const KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
};

export default async function start(host: ExampleHost): Promise<ExampleSession> {
  const { canvas, overlay, signal, controls } = host;
  const owner = createOwner(signal);
  try {
    const clearColor: [number, number, number, number] = [0.027, 0.039, 0.059, 1];
    const url = (file: string) => new URL(`examples/collision/${file}`, document.baseURI).href;
    let values: Values = { ...FIRST };
    const progress: Progress = { robot: { ...START }, collected: new Set() };
    const debug = { colliders: true, contacts: false };
    let last = 0, ready = false;
    // Pairs touching or overlapping now, counted from the begin and end events this example reads.
    const contacts = new Set<string>(), overlaps = new Set<string>();
    // Entity handles change with every apply; names come back from them for the event log.
    let handles: Record<string, PhysicsEntityHandle> = {};
    let names = new Map<string, string>();
    const nameOf = (id: number, generation: number) => names.get(`${id}:${generation}`);
    const runtime = await createFerrumRuntime({
      canvas, rendererPreference: host.renderer, signal, releaseCanvasContext: true,
      webgl2: { clearColor }, webgpu: { clearColor },
      assets: { textures: {
        robot: url("robot.png"), floor: url("floor.png"), wall: url("wall.png"), energy: url("energy.png"), zone: url("zone.png"),
      } },
      dataScene: spec(documentFor(values, progress)), autostart: false,
      engine: { includeCollisionEvents: true, includeGameplayEvents: true, fixedTimestep: { enabled: true, stepSeconds: 1 / 60 } },
      // The renderer draws the engine's physics lines; the "표시" menu chooses which ones the engine writes.
      physicsDebugLines: { colliders: true },
      onFrame: ({ frame, rendererStats, fps }) => {
        if (!ready) return;
        steer();
        for (const event of frame.collisionEvents) logCollision(event);
        for (const event of frame.gameplayEvents) {
          if (event.kind !== "pickupCollected") continue;
          const name = nameOf(event.sourceId, event.sourceGeneration);
          if (name) { progress.collected.add(name); pop(name); }
          host.event({ kind: text.events.pickup, detail: `${nameOf(event.actorId, event.actorGeneration) ?? "?"} ← ${name ?? "?"}`, tone: "info" });
        }
        const now = performance.now();
        if (now - last < 200) return;
        last = now;
        const resources = runtime.renderer.resourceStats?.();
        host.report({
          renderer, fps, entities: frame.entityCount, commands: rendererStats.renderCommandCount,
          drawCalls: rendererStats.drawCalls, textures: resources?.textureCount, textureBytes: resources?.textureBytes,
          extra: [
            { label: text.contactCount, value: contacts.size },
            { label: text.triggerCount, value: overlaps.size },
            { label: text.energy, value: `${progress.collected.size} / 3` },
          ],
        });
      },
    });
    owner.own(() => runtime.destroy());
    signal.throwIfAborted();
    const { engine, dataScene, rendererBackend } = runtime;
    if (!dataScene || rendererBackend === "custom") throw new Error("Expected a Data Scene and an owned renderer.");
    const renderer = rendererBackend;
    const { view } = dataScene;
    const physicsSetup = () => {
      handles = dataScene.result.entityHandles;
      names = new Map(Object.entries(handles).map(([name, handle]) => [`${handle.entityId}:${handle.entityGeneration}`, name]));
      engine.configureAutoRigidBodyStep({ gravityX: 0, gravityY: 0 });
      // The engine picks the robot's walk or idle clip from how far it actually moved in each step.
      if (!engine.configureDataSceneMovementAnimation({ idle: POSES.idle, walk: POSES.walk })) throw new Error("The robot's walk animation was not accepted.");
      engine.setPhysicsDebugLinesEnabled(debug.colliders || debug.contacts ? { colliders: debug.colliders, contacts: debug.contacts } : false);
    };
    physicsSetup();

    // The red zone lights up while the robot is inside it, straight from the trigger events.
    const zone = document.createElement("span"); zone.className = "zone-mark";
    overlay.append(zone);
    const place = () => {
      if (canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;
      const from = view.worldToScreen({ x: ZONE.x - ZONE.width / 2, y: ZONE.y - ZONE.height / 2 });
      const to = view.worldToScreen({ x: ZONE.x + ZONE.width / 2, y: ZONE.y + ZONE.height / 2 });
      Object.assign(zone.style, { left: `${from.x}px`, top: `${from.y}px`, width: `${to.x - from.x}px`, height: `${to.y - from.y}px` });
    };
    // A small "+1" rises where a cell was collected. It is page decoration; the engine already removed the cell.
    const cells = new Map((scene as unknown as SceneDocument).sceneComposition.fragments.main.instances
      .filter(instance => instance.id.startsWith("energy_")).map(instance => [instance.id, instance]));
    function pop(name: string): void {
      const cell = cells.get(name);
      if (!cell || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;
      const at = view.worldToScreen({ x: cell.x, y: cell.y - 14 });
      const label = document.createElement("span"); label.className = "pickup-pop"; label.textContent = "+1";
      label.style.left = `${at.x}px`; label.style.top = `${at.y}px`;
      label.addEventListener("animationend", () => label.remove(), { once: true });
      overlay.append(label);
    }
    const resize = new ResizeObserver(place);
    resize.observe(canvas);
    owner.own(() => resize.disconnect());
    place();

    const kinds: Partial<Record<CollisionEventView["kind"], { label: typeof text.events.enter; tone: "enter" | "exit" | "info" }>> = {
      enter: { label: text.events.enter, tone: "enter" },
      exit: { label: text.events.exit, tone: "exit" },
      hit: { label: text.events.hit, tone: "info" },
      "trigger-enter": { label: text.events.triggerEnter, tone: "enter" },
      "trigger-exit": { label: text.events.triggerExit, tone: "exit" },
    };
    function logCollision(event: CollisionEventView): void {
      const kind = kinds[event.kind];
      if (!kind) return;
      const a = nameOf(event.aId, event.aGeneration) ?? `#${event.aId}`, b = nameOf(event.bId, event.bGeneration) ?? `#${event.bId}`;
      // The robot first reads better: "robot ↔ zone".
      const [first, second] = b === "robot" ? [b, a] : [a, b];
      const pair = `${first} ↔ ${second}`;
      if (event.kind === "enter") contacts.add(pair); else if (event.kind === "exit") contacts.delete(pair);
      if (event.kind === "trigger-enter") overlaps.add(pair); else if (event.kind === "trigger-exit") overlaps.delete(pair);
      host.event({ kind: kind.label, detail: pair, tone: kind.tone });
      if (second === "zone" && event.kind.startsWith("trigger-")) zone.dataset.inside = String(event.kind === "trigger-enter");
    }

    // Input: arrow keys or WASD while nothing else takes them, or the held pointer as a target.
    const held = new Set<string>();
    let target: { x: number; y: number } | undefined, pointer: number | undefined;
    const typing = (node: EventTarget | null) => node instanceof Element && node !== canvas && node.closest("input, select, textarea, [role=separator], [role=tab], [role=menu], [contenteditable=true]") !== null;
    addEventListener("keydown", event => {
      if (!(event.code in KEYS) || typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      held.add(event.code);
      event.preventDefault();
    }, { signal });
    addEventListener("keyup", event => { held.delete(event.code); }, { signal });
    addEventListener("blur", () => held.clear(), { signal });
    const world = (event: PointerEvent) => view.pointerToWorld({ x: event.clientX, y: event.clientY });
    canvas.tabIndex = 0;
    canvas.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      pointer = event.pointerId; target = world(event);
      canvas.setPointerCapture(event.pointerId);
      canvas.focus({ preventScroll: true });
      event.preventDefault();
    }, { signal });
    canvas.addEventListener("pointermove", event => { if (event.pointerId === pointer) target = world(event); }, { signal });
    const release = (event: PointerEvent) => { if (event.pointerId === pointer) { pointer = undefined; target = undefined; } };
    canvas.addEventListener("pointerup", release, { signal });
    canvas.addEventListener("pointercancel", release, { signal });

    /** Gives the robot a velocity for the next physics step. Walls stop and slide it inside the engine. */
    function steer(): void {
      const robot = handles.robot;
      if (!robot) return;
      let dx = 0, dy = 0;
      const at = engine.getPhysicsEntity(robot);
      if (at) progress.robot = { x: at.x, y: at.y };
      if (target && at) {
        dx = target.x - at.x; dy = target.y - at.y;
        if (Math.hypot(dx, dy) < 4) dx = dy = 0;
      } else for (const code of held) { dx += KEYS[code]![0]; dy += KEYS[code]![1]; }
      const length = Math.hypot(dx, dy);
      const speed = length ? values.speed / length : 0;
      engine.setPhysicsBodyVelocity(robot, dx * speed, dy * speed);
    }

    // Settings change the scene document, which is applied again at most once a frame. The robot keeps its place
    // and collected cells stay collected.
    let queued = 0;
    const apply = () => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        if (signal.aborted) return;
        const document = documentFor(values, progress);
        dataScene.reapply(spec(document));
        // The new entities report their own begin events; the old pairs end with the old entities.
        contacts.clear(); overlaps.clear();
        physicsSetup();
        zone.dataset.inside = "false";
        place();
        host.showScene(document, "robot");
      });
    };
    owner.own(() => cancelAnimationFrame(queued));
    const set = (patch: Partial<Values>) => { values = { ...values, ...patch }; apply(); };

    // Speed only changes the velocity the example sets, so it needs no new document.
    const speed = controls.slider({ label: text.speed, min: 40, max: 320, step: 10, value: FIRST.speed, onInput: value => { values = { ...values, speed: value }; } });
    const shape = controls.choice({ label: text.shape, value: FIRST.shape, onChange: value => set({ shape: value }),
      options: [{ value: "box", text: text.box }, { value: "circle", text: text.circle }] });
    const inner = controls.choice({ label: text.inner, value: FIRST.inner, onChange: value => set({ inner: value }),
      options: [{ value: "solid", text: text.solid }, { value: "trigger", text: text.trigger }] });
    controls.hint(text.moveHint);

    const showDebug = () => engine.setPhysicsDebugLinesEnabled(debug.colliders || debug.contacts ? { colliders: debug.colliders, contacts: debug.contacts } : false);
    host.display([
      { label: text.colliders, value: debug.colliders, onChange: value => { debug.colliders = value; showDebug(); } },
      { label: text.contacts, value: debug.contacts, onChange: value => { debug.contacts = value; showDebug(); } },
    ]);

    host.showScene(documentFor(values, progress), "robot");
    ready = true;
    runtime.start();

    return {
      reset() {
        values = { ...FIRST };
        progress.robot = { ...START };
        progress.collected.clear();
        speed.set(FIRST.speed); shape.set(FIRST.shape); inner.set(FIRST.inner);
        apply();
      },
      destroy: owner.destroy,
    };
  } catch (error) {
    owner.destroy();
    throw error;
  }
}
