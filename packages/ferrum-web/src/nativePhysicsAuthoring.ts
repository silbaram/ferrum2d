import type { FerrumEngine } from "./engineTypes.js";

/** Internal cold authoring bridge. It never exposes native pointers to consumers. */
interface NativeAuthoringRuntime {
  run<T>(operation: () => T): T;
  finalize(): void;
  supported(): boolean;
}
const runtimes = new WeakMap<FerrumEngine, NativeAuthoringRuntime>();

export function attachNativePhysicsAuthoring(engine: FerrumEngine, runtime: NativeAuthoringRuntime): void {
  runtimes.set(engine, runtime);
}
export function supportsNativePhysicsAuthoring(engine: FerrumEngine): boolean {
  return runtimes.get(engine)?.supported() === true;
}
export function finalizeNativePhysicsAuthoring(engine: FerrumEngine): void {
  const runtime = runtimes.get(engine);
  if (!runtime) return; // A custom facade owns its own admission contract.
  if (!runtime?.supported()) throw new Error("Native scene authoring requires Wasm scene authoring version 1.");
  runtime.finalize();
}
export function withNativePhysicsAuthoring<T>(engine: FerrumEngine, operation: () => T, required = false): T {
  const runtime = runtimes.get(engine);
  // Custom facades keep their existing apply semantics. Canonical SDK engines
  // always register here and require the complete native rollback capability.
  if (!runtime) {
    if (required) throw new Error("Native scene authoring requires the canonical FerrumEngine runtime.");
    return operation();
  }
  return runtime.run(operation);
}
