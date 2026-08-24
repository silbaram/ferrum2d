import {
  createFerrumRuntime,
  type FerrumEngine,
  type FerrumRuntimeEnvironment,
} from "@ferrum2d/ferrum-web/core";
import { diagnosticReport } from "@ferrum2d/ferrum-web/quality";

import {
  createRuntimeDemoShell,
  renderRuntimeDemoError,
} from "../../shared/runtimeDemoShell";
import "../../shared/runtimeDemoShell.css";
import "./styles.css";

function gameStateLabel(code: number): string {
  if (code === 0) return "Title";
  if (code === 1) return "Playing";
  if (code === 2) return "GameOver";
  return `State ${code}`;
}

async function bootstrap(): Promise<void> {
  const shell = createRuntimeDemoShell({
    title: "Ferrum2D Breakout",
    gameStateLabel,
    metrics: [
      { key: "state", label: "state" },
      { key: "score", label: "score" },
      { key: "entityCount", label: "entities" },
      { key: "renderCommandCount", label: "commands" },
      { key: "particles", label: "particles" },
      { key: "hits", label: "hits" },
      { key: "fps", label: "fps" },
    ],
  });

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const debugParam = searchParams.get("debug");
    const environment: FerrumRuntimeEnvironment = searchParams.get("environment") === "production"
      ? "production"
      : "development";
    const preserveDrawingBuffer = searchParams.get("preserveDrawingBuffer") === "true";
    const physicsDebugLines = searchParams.get("physicsDebugLines") === "true";
    const profilerSmokeEnabled = searchParams.get("profilerSmoke") === "true";
    let runtimeEngine: FerrumEngine | undefined;
    const runtime = await createFerrumRuntime({
      canvas: shell.canvas,
      debugParent: shell.debugRoot,
      debug: debugParam === null ? undefined : { enabled: debugParam !== "false" },
      physicsDebugLines,
      environment,
      profiler: profilerSmokeEnabled,
      webgl2: { clearColor: [0.05, 0.06, 0.08, 1], preserveDrawingBuffer },
      inputTransform: (snapshot) => shell.inputTransform(snapshot),
      gameStateLabel,
      onFrame: ({ frame, rendererStats, fps }) => {
        shell.updateFrame({ frame, rendererStats, fps });
        shell.setMetric("score", frame.score);
        shell.setMetric("particles", runtimeEngine?.particleCount() ?? 0);
        shell.setMetric("hits", frame.physics.collisionHitEvents);
      },
    });

    shell.attachRuntime(runtime);
    runtime.engine.useBreakoutGame();
    runtimeEngine = runtime.engine;
    runtime.start();
    shell.queueStart();
  } catch (error) {
    shell.destroy();
    throw error;
  }
}

void bootstrap().catch((error) => renderRuntimeDemoError(error, {
  title: "Ferrum2D Breakout",
  summary: "Startup failed.",
  diagnosticReport,
}));
