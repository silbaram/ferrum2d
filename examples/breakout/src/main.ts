import {
  createFerrumRuntime,
  VirtualControls,
  type FerrumEngine,
  type FerrumRuntimeOptions,
} from "@ferrum2d/ferrum-web/core";
import { diagnosticReport } from "@ferrum2d/ferrum-web/quality";

import {
  createRuntimeDemoShell,
  renderRuntimeDemoError,
} from "../../shared/runtimeDemoShell";
import "../../shared/runtimeDemoShell.css";
import "./styles.css";
import { createGuidedGameSurface } from "../../shared/guidedGameSurface";
import { createExampleGuide } from "../../shared/exampleGuide";
import { createExampleLifetime } from "../../shared/exampleLifetime";

function gameStateLabel(code: number): string {
  if (code === 0) return "Title";
  if (code === 1) return "Playing";
  if (code === 2) return "GameOver";
  return `State ${code}`;
}

async function bootstrap(): Promise<void> {
  const lifetime = createExampleLifetime();
  const shell = createRuntimeDemoShell({
    exampleId: "breakout",
    title: "Ferrum2D · 충돌 반응 실험",
    gameStateLabel,
    locale: "ko",
    metrics: [
      { key: "state", label: "상태" },
      { key: "score", label: "점수" },
      { key: "entityCount", label: "객체" },
      { key: "renderCommandCount", label: "렌더 명령" },
      { key: "particles", label: "파티클" },
      { key: "hits", label: "현재 충돌" },
      { key: "fps", label: "FPS" },
    ],
  });
  lifetime.own(() => shell.destroy());
  const root = shell.stage.closest<HTMLElement>(".demo-shell")!;
  root.classList.add("example-guided");
  root.querySelector(".demo-toolbar")!.after(createExampleGuide([
    { title: "공 · 벽 · 패들 충돌", action: "A/D 또는 방향키로 패들을 움직여 공을 받아보세요.", observe: "충돌면에 따라 공이 반사합니다. 충돌 영역을 켜면 실제 판정 형태를 비교할 수 있습니다." },
    { title: "충돌 이벤트 · 파티클", action: "공이 벽돌에 닿을 때 score와 particles를 확인하세요.", observe: "벽돌 충돌이 점수·제거·파티클로 이어집니다. hits는 현재 프레임의 hit 이벤트 수입니다." },
  ], shell.canvas));

  const surface = createGuidedGameSurface(shell.stage, "breakout", (parent, buttons) => new VirtualControls(parent, { joystick: false, buttons }));
  lifetime.own(() => surface.destroy());

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const debugParam = searchParams.get("debug");
    const environment: FerrumRuntimeOptions["environment"] = searchParams.get("environment") === "production"
      ? "production"
      : "development";
    const preserveDrawingBuffer = searchParams.get("preserveDrawingBuffer") === "true";
    const physicsDebugLines = searchParams.get("physicsDebugLines") === "true";
    const profilerSmokeEnabled = searchParams.get("profilerSmoke") === "true";
    let runtimeEngine: FerrumEngine | undefined;
    const runtime = await createFerrumRuntime({
      autostart: false,
      canvas: shell.canvas,
      debugParent: shell.debugRoot,
      debug: { enabled: debugParam === "true", layout: "inline" },
      physicsDebugLines,
      environment,
      profiler: profilerSmokeEnabled,
      webgl2: { clearColor: [0.05, 0.06, 0.08, 1], preserveDrawingBuffer },
      inputOptions: { virtualControls: surface.controls, pointerGestures: false },
      inputTransform: (snapshot) => shell.inputTransform(snapshot),
      gameStateLabel,
      onFrame: ({ frame, rendererStats, fps }) => {
        shell.updateFrame({ frame, rendererStats, fps });
        shell.setMetric("score", frame.score);
        shell.setMetric("particles", runtimeEngine?.particleCount() ?? 0);
        shell.setMetric("hits", frame.physics.collisionHitEvents);
      },
    });
    lifetime.own(() => runtime.destroy());

    if (!runtime.renderer.setPixelPerfect) throw new Error("This demo requires a fixed logical viewport.");
    runtime.renderer.setPixelPerfect({ width: 800, height: 480, snap: false });
    runtime.engine.setViewportSize(800, 480);
    shell.attachRuntime(runtime);
    await runtime.renderer.loadTexture(0, new URL("../../shared/solid-white.png", import.meta.url).href, { signal: lifetime.signal });
    lifetime.check();
    runtime.engine.useBreakoutGame();
    runtimeEngine = runtime.engine;
    lifetime.ready();
    runtime.start();
    shell.queueStart();
  } catch (error) {
    const cancelled = lifetime.disposed;
    lifetime.dispose();
    if (!cancelled) throw error;
  }
}

void bootstrap().catch((error) => renderRuntimeDemoError(error, {
  title: "Ferrum2D Breakout",
  summary: "Startup failed.",
  diagnosticReport,
}));
