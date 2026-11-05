import {
  createFerrumRuntime,
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
import { createExampleGuide } from "../../shared/exampleGuide";

function gameStateLabel(code: number): string {
  if (code === 0) return "Title";
  if (code === 1) return "Playing";
  if (code === 2) return "GameOver";
  return `State ${code}`;
}

async function bootstrap(): Promise<void> {
  const shell = createRuntimeDemoShell({
    title: "Ferrum2D · 플랫폼 이동 실험",
    gameStateLabel,
    metrics: [
      { key: "state", label: "state" },
      { key: "score", label: "score" },
      { key: "entityCount", label: "entities" },
      { key: "renderCommandCount", label: "commands" },
      { key: "particles", label: "particles" },
      { key: "kinematic", label: "kinematic" },
      { key: "fps", label: "fps" },
    ],
  });
  let runtimeEngine: FerrumEngine | undefined;
  const jumpTo = (x: number, y: number) => {
    const player = runtimeEngine?.builtInPlatformerPlayerHandle();
    if (player) runtimeEngine!.setBuiltInSceneEntityPosition(player, x, y);
  };
  const root = shell.stage.closest<HTMLElement>(".demo-shell")!;
  root.classList.add("example-guided");
  root.querySelector(".demo-toolbar")!.after(createExampleGuide([
    { title: "점프 · 착지", action: "A/D 또는 방향키로 이동하고 Space로 점프하세요.", observe: "분홍색 플레이어가 파란 발판에 착지합니다. 착지 순간 particles가 증가합니다.", start: () => jumpTo(260, 420) },
    { title: "단방향 발판", action: "노란 발판 위에서 내려온 뒤 아래쪽에서 점프해 보세요.", observe: "노란 발판은 아래에서 통과할 수 있고 위에서는 밟을 수 있습니다.", start: () => jumpTo(610, 272) },
    { title: "이동 발판", action: "청록색 발판 위에 올라가 이동 입력을 멈추세요.", observe: "발판의 이동량이 플레이어에게 전달됩니다. kinematic은 이동/충돌 처리 횟수입니다.", start: () => jumpTo(760, 440) },
  ], shell.canvas));

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const debugParam = searchParams.get("debug");
    const environment: FerrumRuntimeOptions["environment"] = searchParams.get("environment") === "production"
      ? "production"
      : "development";
    const preserveDrawingBuffer = searchParams.get("preserveDrawingBuffer") === "true";
    const physicsDebugLines = searchParams.get("physicsDebugLines") === "true";
    const profilerSmokeEnabled = searchParams.get("profilerSmoke") === "true";
    const runtime = await createFerrumRuntime({
      canvas: shell.canvas,
      debugParent: shell.debugRoot,
      debug: { enabled: debugParam === "true", layout: "inline" },
      physicsDebugLines,
      environment,
      profiler: profilerSmokeEnabled,
      webgl2: { clearColor: [0.08, 0.1, 0.12, 1], preserveDrawingBuffer },
      inputTransform: (snapshot) => shell.inputTransform(snapshot),
      gameStateLabel,
      onFrame: ({ frame, rendererStats, fps }) => {
        shell.updateFrame({ frame, rendererStats, fps });
        shell.setMetric("score", frame.score);
        shell.setMetric("particles", runtimeEngine?.particleCount() ?? 0);
        shell.setMetric("kinematic", `${frame.physics.kinematicMoves}/${frame.physics.kinematicHits}`);
      },
    });

    shell.attachRuntime(runtime);
    // Native fixtures supply their own tint; a white texel preserves those colors.
    await runtime.renderer.loadTexture(0, new URL("../../shared/solid-white.png", import.meta.url).href);
    runtime.engine.usePlatformerGame();
    runtimeEngine = runtime.engine;
    runtime.start();
    shell.queueStart();
  } catch (error) {
    shell.destroy();
    throw error;
  }
}

void bootstrap().catch((error) => renderRuntimeDemoError(error, {
  title: "Ferrum2D Platformer",
  summary: "Startup failed.",
  diagnosticReport,
}));
