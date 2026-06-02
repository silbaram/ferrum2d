import {
  createFerrumRuntime,
  diagnosticReport,
  type FerrumRuntimeEnvironment,
} from "@ferrum2d/ferrum-web";

import {
  createRuntimeDemoShell,
  renderRuntimeDemoError,
} from "../../shared/runtimeDemoShell";
import "../../shared/runtimeDemoShell.css";
import "./styles.css";

async function bootstrap(): Promise<void> {
  const shell = createRuntimeDemoShell({
    title: "Starter Runtime",
    frameProperty: "ferrumStarterRuntimeFrame",
  });

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const debugParam = searchParams.get("debug");
    const environment: FerrumRuntimeEnvironment = searchParams.get("environment") === "production"
      ? "production"
      : "development";
    const preserveDrawingBuffer = searchParams.get("preserveDrawingBuffer") === "true";
    const profilerSmoke = searchParams.get("profilerSmoke") === "true";

    const runtime = await createFerrumRuntime({
      canvas: shell.canvas,
      debugParent: shell.debugRoot,
      debug: debugParam === null ? undefined : { enabled: debugParam !== "false" },
      environment,
      profiler: profilerSmoke,
      webgl2: {
        clearColor: [0.09, 0.11, 0.1, 1],
        preserveDrawingBuffer,
      },
      uiParent: shell.stage,
      ui: {
        onAction: (event) => {
          if (event.id === "start") {
            shell.queueStart();
          }
        },
      },
      uiState: () => shell.uiState(),
      inputTransform: shell.inputTransform,
      onFrame: shell.updateFrame,
    });

    runtime.engine.setTextureIds({ player: 0, enemy: 0, bullet: 0 });
    shell.attachRuntime(runtime);
    runtime.start();
    shell.queueStart();
  } catch (error) {
    shell.destroy();
    throw error;
  }
}

void bootstrap().catch((error) => {
  renderRuntimeDemoError(error, {
    title: "Starter Runtime",
    diagnosticReport,
  });
});
