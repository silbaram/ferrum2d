import {
  createFerrumRuntime, type CollisionEventView, type PhysicsEntityHandle,
} from "@ferrum2d/ferrum-web/core";
import type { SceneAuthoringDocumentSpec } from "@ferrum2d/ferrum-web/authoring";
import { createOwner, type ExampleHost, type ExampleSession } from "../../example";
import { el, setUiText, uiText, type LocalizedText } from "../../locale";
import { breakoutControls as text } from "./messages";
import scene from "./scene.json";

// Breakout: the first game demo. The engine moves and bounces the ball, stops the paddle at the walls and
// reports contacts; this code keeps the rules: bricks, score, lives, the paddle's bounce angle, winning and
// losing. The art is drawn by scripts/assets/build-example-breakout.mjs.

const WORLD = { width: 640, height: 384 };
const FIRST = { speed: 300, paddle: "normal", rows: 5 };
type Values = typeof FIRST;
const PADDLE = { y: 344, speed: 560, widths: { narrow: 56, normal: 80, wide: 112 } as Record<string, number> };
const BALL_RADIUS = 6;
const LIVES = 3;
/** Points for a brick by row, top row first. */
const POINTS = [50, 40, 30, 20, 10];
/** The steepest paddle bounce from straight up, and the flattest the ball may fly. */
const MAX_BOUNCE = 60 * Math.PI / 180, MIN_RISE = 0.35;

type Phase = "ready" | "playing" | "won" | "lost";

/** The part of the scene document this example edits. */
interface Instance {
  id: string;
  x: number;
  y: number;
  props: { components: { visual: { width: number }; collider: { halfWidth?: number } } };
}
interface SceneDocument { sceneComposition: { fragments: { main: { instances: Instance[] } } } }

/** A new game with these settings: the paddle's width and how many rows of bricks. */
function documentFor(values: Values): SceneDocument {
  const document = structuredClone(scene) as unknown as SceneDocument;
  const fragment = document.sceneComposition.fragments.main;
  fragment.instances = fragment.instances.filter(instance => !instance.id.startsWith("brick_") || row(instance.id) < values.rows);
  const paddle = fragment.instances.find(instance => instance.id === "paddle")!;
  const width = PADDLE.widths[values.paddle]!;
  paddle.props.components.visual.width = width;
  paddle.props.components.collider.halfWidth = width / 2;
  return document;
}
const spec = (document: SceneDocument) => document as unknown as SceneAuthoringDocumentSpec;
const row = (id: string) => Number(id.split("_")[1]);

const KEYS: Record<string, number> = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };

export default async function start(host: ExampleHost): Promise<ExampleSession> {
  const { canvas, overlay, signal, controls } = host;
  const owner = createOwner(signal);
  try {
    const clearColor: [number, number, number, number] = [0.027, 0.039, 0.059, 1];
    const url = (file: string) => new URL(`examples/breakout/${file}`, document.baseURI).href;
    let values: Values = { ...FIRST }, phase: Phase = "ready", paused = false;
    let score = 0, lives = LIVES, last = 0, ready = false;
    let bricks = new Set<string>();
    let handles: Record<string, PhysicsEntityHandle> = {};
    let names = new Map<string, string>();
    const nameOf = (id: number, generation: number) => names.get(`${id}:${generation}`);

    const runtime = await createFerrumRuntime({
      canvas, rendererPreference: host.renderer, signal, releaseCanvasContext: true,
      webgl2: { clearColor }, webgpu: { clearColor },
      assets: { textures: Object.fromEntries(["field", "wall", "brick", "paddle", "ball", "miss"].map(name => [name, url(`${name}.png`)])) },
      dataScene: spec(documentFor(values)), autostart: false,
      engine: { includeCollisionEvents: true, fixedTimestep: { enabled: true, stepSeconds: 1 / 60 } },
      physicsDebugLines: { colliders: true },
      onFrame: ({ frame, rendererStats, fps }) => {
        if (!ready) return;
        for (const event of frame.collisionEvents) collide(event);
        if (!paused) update();
        const now = performance.now();
        if (now - last < 200) return;
        last = now;
        const resources = runtime.renderer.resourceStats?.();
        host.report({
          renderer, fps, entities: frame.entityCount, commands: rendererStats.renderCommandCount,
          drawCalls: rendererStats.drawCalls, textures: resources?.textureCount, textureBytes: resources?.textureBytes,
          extra: [{ label: text.score, value: score }, { label: text.lives, value: lives }, { label: text.bricks, value: bricks.size }],
        });
      },
    });
    owner.own(() => runtime.destroy());
    signal.throwIfAborted();
    const { engine, dataScene, rendererBackend } = runtime;
    if (!dataScene || rendererBackend === "custom") throw new Error("Expected a Data Scene and an owned renderer.");
    const renderer = rendererBackend;
    const { view } = dataScene;

    const debug = { colliders: false, contacts: false };
    const showDebug = () => engine.setPhysicsDebugLinesEnabled(debug.colliders || debug.contacts ? { ...debug } : false);
    const physicsSetup = () => {
      handles = dataScene.result.entityHandles;
      names = new Map(Object.entries(handles).map(([name, handle]) => [`${handle.entityId}:${handle.entityGeneration}`, name]));
      bricks = new Set(Object.keys(handles).filter(name => name.startsWith("brick_")));
      engine.configureAutoRigidBodyStep({ gravityX: 0, gravityY: 0, continuous: true });
      showDebug();
    };
    physicsSetup();

    // Score, lives and the start, pause and end messages are drawn over the picture by this page.
    const scoreValue = el("b", undefined, "0");
    const scoreBox = el("span", "game-score"); scoreBox.append(uiText(text.score), " ", scoreValue);
    const livesBox = el("span", "game-lives");
    const lifeMarks = Array.from({ length: LIVES }, () => el("i", "game-life"));
    livesBox.append(...lifeMarks);
    const banner = el("div", "game-banner"); const bannerText = uiText(text.messages.ready); banner.append(bannerText);
    overlay.append(scoreBox, livesBox, banner);
    const showHud = () => {
      scoreValue.textContent = String(score);
      lifeMarks.forEach((mark, index) => mark.toggleAttribute("data-lost", index >= lives));
      const message: LocalizedText | undefined = paused ? text.messages.paused : phase === "playing" ? undefined : text.messages[phase];
      banner.hidden = !message;
      if (message) setUiText(bannerText, message);
    };
    const place = () => {
      if (canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;
      const at = (box: HTMLElement, x: number, y: number) => {
        const point = view.worldToScreen({ x, y });
        box.style.left = `${point.x}px`; box.style.top = `${point.y}px`;
      };
      at(scoreBox, 40, 40); at(livesBox, 600, 40); at(banner, WORLD.width / 2, 250);
    };
    const resize = new ResizeObserver(place);
    resize.observe(canvas);
    owner.own(() => resize.disconnect());
    place(); showHud();

    const position = (name: string) => handles[name] ? engine.getPhysicsEntity(handles[name]) : undefined;
    const aim = (angle: number) => {
      if (handles.ball) engine.setPhysicsBodyVelocity(handles.ball, values.speed * Math.sin(angle), -values.speed * Math.cos(angle));
    };
    const degrees = (angle: number) => `${Math.round(angle * 180 / Math.PI)}°`;

    /** The rules: what a contact means for this game. */
    function collide(event: CollisionEventView): void {
      const a = nameOf(event.aId, event.aGeneration), b = nameOf(event.bId, event.bGeneration);
      const other = a === "ball" ? b : b === "ball" ? a : undefined;
      if (!other || phase !== "playing") return;
      if (event.kind === "enter" && bricks.has(other)) {
        bricks.delete(other);
        engine.despawnPhysicsEntity(handles[other]!);
        const points = POINTS[row(other)] ?? 10;
        score += points;
        host.event({ kind: text.events.brick, detail: `ball ↔ ${other} · +${points}`, tone: "enter" });
        if (!bricks.size) end("won");
      } else if (event.kind === "enter" && other === "paddle") {
        // Where the ball meets the paddle sets the angle: the center sends it up, the ends send it wide.
        const ball = position("ball"), paddle = position("paddle");
        if (!ball || !paddle) return;
        const reach = PADDLE.widths[values.paddle]! / 2 + BALL_RADIUS;
        const angle = Math.max(-1, Math.min(1, (ball.x - paddle.x) / reach)) * MAX_BOUNCE;
        aim(angle);
        host.event({ kind: text.events.paddle, detail: `ball ↔ paddle · ${degrees(angle)}`, tone: "info" });
      } else if (event.kind === "trigger-enter" && other === "miss") {
        lives -= 1;
        host.event({ kind: text.events.miss, detail: `ball ↔ miss · ${lives}/${LIVES}`, tone: "exit" });
        if (lives <= 0) end("lost"); else phase = "ready";
      }
      showHud();
    }
    function end(result: "won" | "lost"): void {
      phase = result;
      if (handles.ball) engine.setPhysicsBodyVelocity(handles.ball, 0, 0);
      host.event({ kind: text.events[result], detail: text.finalScore(score), tone: "info" });
    }

    // Input: the mouse's x over the canvas, or the arrow keys and A/D; a click or Space launches.
    const held = new Set<string>();
    let target: number | undefined, facing = 1;
    const typing = (node: EventTarget | null, space: boolean) => node instanceof Element && node !== canvas
      && node.closest(space ? "input, select, textarea, button, [role=separator], [role=tab], [role=menu]" : "input, select, textarea, [role=separator], [role=tab], [role=menu]") !== null;
    addEventListener("keydown", event => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code === "Space") {
        if (typing(event.target, true)) return;
        event.preventDefault();
        if (!event.repeat) act();
      } else if (event.code in KEYS && !typing(event.target, false)) {
        event.preventDefault();
        held.add(event.code); target = undefined;
      }
    }, { signal });
    addEventListener("keyup", event => { held.delete(event.code); }, { signal });
    addEventListener("blur", () => held.clear(), { signal });
    const worldX = (event: PointerEvent) => view.pointerToWorld({ x: event.clientX, y: event.clientY }).x;
    canvas.tabIndex = 0;
    canvas.addEventListener("pointermove", event => { target = worldX(event); }, { signal });
    canvas.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      target = worldX(event);
      canvas.focus({ preventScroll: true });
      act();
    }, { signal });

    /** Launch from the paddle, or start a new game after the last one ended. */
    function act(): void {
      if (paused) return;
      if (phase === "ready") {
        phase = "playing";
        const angle = 18 * Math.PI / 180 * facing;
        aim(angle);
        host.event({ kind: text.events.launch, detail: `ball · ${degrees(angle)}`, tone: "info" });
        showHud();
      } else if (phase !== "playing") newGame();
    }

    /** Each frame: move the paddle, hold the ball on it before launch, and keep the ball's speed. */
    function update(): void {
      const paddle = position("paddle"), ball = position("ball");
      if (!paddle || !ball) return;
      let velocity = 0;
      const keys = [...held].reduce((sum, code) => sum + KEYS[code]!, 0);
      if (keys) velocity = Math.sign(keys) * PADDLE.speed;
      else if (target !== undefined && Math.abs(target - paddle.x) > 1) velocity = Math.max(-900, Math.min(900, (target - paddle.x) * 12));
      if (velocity) facing = Math.sign(velocity);
      engine.setPhysicsBodyVelocity(handles.paddle!, velocity, 0);

      if (phase !== "playing") {
        engine.setPhysicsBodyPosition(handles.ball!, paddle.x, PADDLE.y - 6 - BALL_RADIUS - 1);
        engine.setPhysicsBodyVelocity(handles.ball!, 0, 0);
        return;
      }
      // The engine bounces the ball; keep its speed and keep it from flying nearly flat.
      const speed = values.speed, length = Math.hypot(ball.velocityX, ball.velocityY);
      let vx = length > 1 ? ball.velocityX / length * speed : 0, vy = length > 1 ? ball.velocityY / length * speed : -speed;
      if (Math.abs(vy) < MIN_RISE * speed) {
        vy = Math.sign(vy || -1) * MIN_RISE * speed;
        vx = Math.sign(vx || 1) * Math.sqrt(speed * speed - vy * vy);
      }
      if (Math.abs(vx - ball.velocityX) > 0.5 || Math.abs(vy - ball.velocityY) > 0.5) engine.setPhysicsBodyVelocity(handles.ball!, vx, vy);
    }

    // A new game applies the document again: all bricks back, the paddle in the middle.
    let queued = 0;
    const newGame = () => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        if (signal.aborted) return;
        const document = documentFor(values);
        dataScene.reapply(spec(document));
        if (paused) dataScene.pause();
        physicsSetup();
        phase = "ready"; score = 0; lives = LIVES;
        place(); showHud();
        host.showScene(document, "ball");
      });
    };
    owner.own(() => cancelAnimationFrame(queued));

    const speed = controls.slider({ label: text.speed, min: 180, max: 480, step: 20, value: FIRST.speed, onInput: value => { values = { ...values, speed: value }; } });
    const paddle = controls.choice({ label: text.paddle, value: FIRST.paddle, onChange: value => { values = { ...values, paddle: value }; newGame(); },
      options: [{ value: "narrow", text: text.narrow }, { value: "normal", text: text.normal }, { value: "wide", text: text.wide }] });
    const rows = controls.choice({ label: text.rows, value: String(FIRST.rows), onChange: value => { values = { ...values, rows: Number(value) }; newGame(); },
      options: [3, 5].map(count => ({ value: String(count), text: text.rowCount(count) })) });
    controls.hint(text.hint);
    host.display([
      { label: text.colliders, value: debug.colliders, onChange: value => { debug.colliders = value; showDebug(); } },
      { label: text.contacts, value: debug.contacts, onChange: value => { debug.contacts = value; showDebug(); } },
    ]);

    host.showScene(documentFor(values), "ball");
    ready = true;
    runtime.start();

    return {
      reset() {
        values = { ...FIRST };
        speed.set(FIRST.speed); paddle.set(FIRST.paddle); rows.set(String(FIRST.rows));
        newGame();
      },
      setPaused(next) {
        paused = next;
        if (next) dataScene.pause(); else dataScene.resume();
        held.clear();
        showHud();
      },
      destroy: owner.destroy,
    };
  } catch (error) {
    owner.destroy();
    throw error;
  }
}
