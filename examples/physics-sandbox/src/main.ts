import {
  createFerrumRuntime,
  createPhysicsWorldFromSpec,
  diagnosticReport,
  resolvePhysicsSpec,
  type DiagnosticContext,
  type DiagnosticReport,
  type FerrumEngine,
  type FerrumRuntime,
  type FerrumRuntimeEnvironment,
  type PhysicsDebugOptions,
  type PhysicsSpec,
  type PhysicsWorldApplyResult,
  type PhysicsWorldApplyWarning,
  type ResolvedPhysicsSpec,
} from "@ferrum2d/ferrum-web";

import "./styles.css";

interface PhysicsDemoEntry {
  id: string;
  label: string;
  path: string;
}

interface PhysicsSandboxSmokeFrame {
  demoId: string;
  bodyCount: number;
  jointCount: number;
  warningCount: number;
  entityCount: number;
  renderCommandCount: number;
  physicsDebugLineCount: number;
  fixedStepSeconds: number;
  frameCount: number;
}

interface SandboxWindow extends Window {
  ferrumEngine?: FerrumEngine;
  ferrumRuntime?: FerrumRuntime;
  ferrumPhysicsSandboxLoadDemo?: (id: string) => Promise<void>;
  ferrumPhysicsSandboxSmokeFrame?: PhysicsSandboxSmokeFrame;
}

interface SandboxShell {
  canvas: HTMLCanvasElement;
  debugRoot: HTMLElement;
  demoSelect: HTMLSelectElement;
  statusValue: HTMLElement;
  bodyValue: HTMLElement;
  jointValue: HTMLElement;
  lineValue: HTMLElement;
  fpsValue: HTMLElement;
  warningValue: HTMLElement;
  setPaused(paused: boolean): void;
  setStatus(status: string): void;
  setError(error: unknown): void;
  setWarnings(warnings: readonly PhysicsWorldApplyWarning[]): void;
}

const DEMOS: readonly PhysicsDemoEntry[] = [
  { id: "sandbox", label: "Sandbox", path: "physics.json" },
  { id: "joint-playground", label: "Joint Playground", path: "demos/joint-playground.json" },
  { id: "projectile-ccd", label: "Projectile CCD", path: "demos/projectile-ccd.json" },
  { id: "platformer-physics", label: "Platformer Physics", path: "demos/platformer-physics.json" },
  { id: "compound-collider", label: "Compound Collider", path: "demos/compound-collider.json" },
  { id: "weld-joint", label: "Weld Joint", path: "demos/weld-joint.json" },
];

const DEBUG_CATEGORIES: Array<{ key: keyof PhysicsDebugOptions; label: string }> = [
  { key: "colliders", label: "Colliders" },
  { key: "contacts", label: "Contacts" },
  { key: "broadphase", label: "Broadphase" },
  { key: "joints", label: "Joints" },
  { key: "sleeping", label: "Sleeping" },
];

function publicAssetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

function diagnosticRows(report: DiagnosticReport): Array<[string, string]> {
  const rows: Array<[string, string]> = [["code", report.code], ["message", report.message]];
  if (report.context) appendDiagnosticContext(rows, report.context);
  return rows;
}

function appendDiagnosticContext(rows: Array<[string, string]>, context: DiagnosticContext): void {
  rows.push(["kind", context.kind]);
  if (context.name !== undefined) rows.push(["name", context.name]);
  if (context.id !== undefined) rows.push(["id", String(context.id)]);
  if (context.url !== undefined) rows.push(["url", context.url]);
  if (context.path !== undefined) rows.push(["path", context.path]);
  rows.push(["detail", context.detail]);
}

function createButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function createShell(
  demos: readonly PhysicsDemoEntry[],
  onDemoChange: (id: string) => void,
  onReset: () => void,
  onRun: () => void,
  onPause: () => void,
  onStep: () => void,
  onDebugChange: (options: PhysicsDebugOptions) => void,
  initialDebugOptions: PhysicsDebugOptions,
): SandboxShell {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("Missing #app root element.");
  }

  const shell = document.createElement("main");
  const toolbar = document.createElement("section");
  const title = document.createElement("h1");
  const controls = document.createElement("div");
  const demoSelect = document.createElement("select");
  const runButton = createButton("Run", onRun);
  const pauseButton = createButton("Pause", onPause);
  const resetButton = createButton("Reset", onReset);
  const stepButton = createButton("Step", onStep);
  const debugControls = document.createElement("div");
  const stage = document.createElement("section");
  const canvasWrap = document.createElement("div");
  const canvas = document.createElement("canvas");
  const metrics = document.createElement("dl");
  const debugRoot = document.createElement("div");
  const statusValue = document.createElement("dd");
  const bodyValue = document.createElement("dd");
  const jointValue = document.createElement("dd");
  const lineValue = document.createElement("dd");
  const fpsValue = document.createElement("dd");
  const warningValue = document.createElement("dd");
  const errorBox = document.createElement("div");
  const debugOptions: PhysicsDebugOptions = { ...initialDebugOptions };

  shell.className = "app-shell";
  toolbar.className = "toolbar";
  controls.className = "controls";
  demoSelect.className = "demo-select";
  debugControls.className = "debug-controls";
  stage.className = "stage";
  canvasWrap.className = "canvas-wrap";
  canvas.className = "physics-canvas";
  metrics.className = "metrics";
  debugRoot.className = "debug-root";
  errorBox.className = "error-box";
  errorBox.hidden = true;

  title.textContent = "Ferrum2D Physics Sandbox";
  canvas.width = 800;
  canvas.height = 480;

  for (const demo of demos) {
    const option = document.createElement("option");
    option.value = demo.id;
    option.textContent = demo.label;
    demoSelect.append(option);
  }
  demoSelect.addEventListener("change", () => onDemoChange(demoSelect.value));

  for (const { key, label } of DEBUG_CATEGORIES) {
    const item = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(debugOptions[key]);
    checkbox.addEventListener("change", () => {
      debugOptions[key] = checkbox.checked;
      onDebugChange({ ...debugOptions });
    });
    item.append(checkbox, label);
    debugControls.append(item);
  }

  appendMetric(metrics, "status", statusValue);
  appendMetric(metrics, "bodies", bodyValue);
  appendMetric(metrics, "joints", jointValue);
  appendMetric(metrics, "debug lines", lineValue);
  appendMetric(metrics, "fps", fpsValue);
  appendMetric(metrics, "warnings", warningValue);

  controls.append(demoSelect, runButton, pauseButton, stepButton, resetButton);
  toolbar.append(title, controls);
  canvasWrap.append(canvas);
  stage.append(canvasWrap, metrics);
  shell.append(toolbar, debugControls, stage, errorBox, debugRoot);
  app.replaceChildren(shell);

  return {
    canvas,
    debugRoot,
    demoSelect,
    statusValue,
    bodyValue,
    jointValue,
    lineValue,
    fpsValue,
    warningValue,
    setPaused(paused) {
      pauseButton.disabled = paused;
      runButton.disabled = !paused;
    },
    setStatus(status) {
      statusValue.textContent = status;
      errorBox.hidden = true;
      errorBox.replaceChildren();
    },
    setError(error) {
      const report = diagnosticReport(error);
      const titleElement = document.createElement("strong");
      const list = document.createElement("dl");
      titleElement.textContent = "Error";
      for (const [label, value] of diagnosticRows(report)) {
        const term = document.createElement("dt");
        const description = document.createElement("dd");
        term.textContent = label;
        description.textContent = value;
        list.append(term, description);
      }
      errorBox.hidden = false;
      errorBox.replaceChildren(titleElement, list);
      statusValue.textContent = "error";
    },
    setWarnings(warnings) {
      warningValue.textContent = String(warnings.length);
    },
  };

  function appendMetric(parent: HTMLElement, label: string, value: HTMLElement): void {
    const term = document.createElement("dt");
    term.textContent = label;
    value.textContent = "-";
    parent.append(term, value);
  }
}

async function loadPhysicsSpec(url: string): Promise<PhysicsSpec> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Physics fixture load failed: ${response.status} ${response.statusText}`);
  }
  return await response.json() as PhysicsSpec;
}

async function bootstrap(): Promise<void> {
  const searchParams = new URLSearchParams(window.location.search);
  const environment: FerrumRuntimeEnvironment = searchParams.get("environment") === "production"
    ? "production"
    : "development";
  const preserveDrawingBuffer = searchParams.get("preserveDrawingBuffer") === "true";
  const profilerSmoke = searchParams.get("profilerSmoke") === "true";
  const initialDemo = demoById(searchParams.get("demo") ?? "sandbox").id;
  const debugOptions: PhysicsDebugOptions = {
    colliders: true,
    contacts: true,
    joints: true,
    sleeping: true,
    broadphase: searchParams.get("broadphase") === "true",
  };

  let runtime: FerrumRuntime | undefined;
  let currentWorld: PhysicsWorldApplyResult | undefined;
  let currentSpec: ResolvedPhysicsSpec | undefined;
  let currentDemoId = initialDemo;
  let paused = false;
  let stepQueued = false;
  let frameCount = 0;

  const shell = createShell(
    DEMOS,
    (id) => {
      void loadDemo(id);
    },
    () => {
      void loadDemo(currentDemoId);
    },
    () => {
      paused = false;
      shell.setPaused(false);
      shell.setStatus("running");
    },
    () => {
      paused = true;
      shell.setPaused(true);
      shell.setStatus("paused");
    },
    () => {
      paused = true;
      stepQueued = true;
      shell.setPaused(true);
      shell.setStatus("step");
    },
    (options) => {
      runtime?.engine.setPhysicsDebugLinesEnabled(options);
    },
    debugOptions,
  );

  async function loadDemo(id: string): Promise<void> {
    const demo = demoById(id);
    if (!runtime) {
      throw new Error("Physics runtime is not ready.");
    }
    try {
      shell.setStatus("loading");
      const rawSpec = await loadPhysicsSpec(publicAssetUrl(demo.path));
      const resolved = resolvePhysicsSpec(rawSpec, { path: "physics" });
      currentWorld = createPhysicsWorldFromSpec(runtime.engine, resolved, {
        replace: currentWorld,
        onWarning: (warning) => {
          console.warn(warning.message);
        },
      });
      currentSpec = resolved;
      currentDemoId = demo.id;
      shell.demoSelect.value = demo.id;
      shell.bodyValue.textContent = String(currentWorld.bodyCount);
      shell.jointValue.textContent = String(currentWorld.jointCount);
      shell.setWarnings(currentWorld.warnings);
      paused = false;
      shell.setPaused(false);
      shell.setStatus("running");
    } catch (error) {
      console.error("Ferrum2D physics sandbox demo load failed", error);
      shell.setError(error);
      throw error;
    }
  }

  runtime = await createFerrumRuntime({
    canvas: shell.canvas,
    debugParent: shell.debugRoot,
    debug: searchParams.get("debug") === "true",
    physicsDebugLines: debugOptions,
    physicsMode: "rigid",
    profiler: profilerSmoke,
    environment,
    autostart: false,
    webgl2: { clearColor: [0.09, 0.1, 0.11, 1], preserveDrawingBuffer },
    engine: {
      enablePhysicsDebugLines: debugOptions,
      includePhysicsDebugLines: true,
      physicsDebugOptions: debugOptions,
    },
    onFrame: ({ frame, rendererStats, fps }) => {
      frameCount += 1;
      if (currentWorld && (!paused || stepQueued)) {
        runtime?.engine.stepRigidBodies(currentWorld.stepSeconds, currentWorld.stepOptions);
        stepQueued = false;
      }
      const debugLineCount = rendererStats.physicsDebugLineCount || frame.physicsDebugLineBuffer.lineCount;
      shell.bodyValue.textContent = String(currentWorld?.bodyCount ?? 0);
      shell.jointValue.textContent = String(currentWorld?.jointCount ?? 0);
      shell.lineValue.textContent = String(debugLineCount);
      shell.fpsValue.textContent = fps.toFixed(1);
      (window as SandboxWindow).ferrumPhysicsSandboxSmokeFrame = {
        demoId: currentDemoId,
        bodyCount: currentWorld?.bodyCount ?? 0,
        jointCount: currentWorld?.jointCount ?? 0,
        warningCount: currentWorld?.warningCount ?? 0,
        entityCount: frame.entityCount,
        renderCommandCount: rendererStats.renderCommandCount,
        physicsDebugLineCount: debugLineCount,
        fixedStepSeconds: currentSpec?.solver.stepSeconds ?? 0,
        frameCount,
      };
    },
  });

  shell.demoSelect.value = initialDemo;
  const sandboxWindow = window as SandboxWindow;
  sandboxWindow.ferrumEngine = runtime.engine;
  sandboxWindow.ferrumRuntime = runtime;
  sandboxWindow.ferrumPhysicsSandboxLoadDemo = loadDemo;

  await loadDemo(initialDemo);
  runtime.start();

  window.addEventListener("beforeunload", () => {
    runtime?.destroy();
  }, { once: true });
}

function demoById(id: string): PhysicsDemoEntry {
  return DEMOS.find((demo) => demo.id === id) ?? DEMOS[0];
}

function renderBootstrapError(error: unknown): void {
  console.error("Ferrum2D physics sandbox failed", error);
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  const report = diagnosticReport(error);
  const container = document.createElement("main");
  const title = document.createElement("h1");
  const list = document.createElement("dl");
  container.className = "error-shell";
  title.textContent = "Ferrum2D Physics Sandbox";
  for (const [label, value] of diagnosticRows(report)) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    list.append(term, description);
  }
  container.append(title, list);
  app.replaceChildren(container);
}

void bootstrap().catch(renderBootstrapError);
