import type { FerrumEngine } from "./engineTypes.js";
import type { ResolvedPhysicsSpec } from "./physicsSpec.js";
import { physicsSpecDiagnosticError } from "./diagnostics.js";

// A cold platform-metadata callback, not simulation state or a public Engine API.
// Legacy JSON restoration must not call the normal Physics Spec setup, which now
// selects the native backend for both fixed and variable arcade/rigid specs.
const legacyRuntimeSetups = new WeakMap<object, (spec: ResolvedPhysicsSpec) => void>();

export function registerLegacyJsonPhysicsRuntime(owner: object, setup: (spec: ResolvedPhysicsSpec) => void): void {
  legacyRuntimeSetups.set(owner, setup);
}

export function configureLegacyJsonPhysicsRuntime(engine: FerrumEngine, spec: ResolvedPhysicsSpec): void {
  if (engine.physicsBackend?.() !== "legacy"
    || !(spec.mode === "none" || (spec.mode === "arcade" && spec.solver.fixedTimestep === false))) {
    throw physicsSpecDiagnosticError("physics.snapshot.spec", "legacy JSON setup requires a legacy backend and none or explicit variable-step arcade");
  }
  const setup = legacyRuntimeSetups.get(engine);
  if (setup) setup(spec);
  else {
    // Custom legacy facades can apply their old clock without a native setup.
    engine.configureFixedTimestep({ enabled: spec.solver.fixedTimestep, stepSeconds: spec.solver.stepSeconds });
    if (spec.debug.enabled) engine.setPhysicsDebugLinesEnabled({ ...spec.debug });
  }
}
