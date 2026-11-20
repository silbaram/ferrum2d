import {createFerrumWasmBindings, type FactoryOptions, type FactoryState} from "../pkg/ferrum_core_factory.js";
import type * as Core from "../pkg/ferrum_core.js";
import {limitWasmMemory} from "./wasmMemoryLimit.js";

/** Package-internal cold target owner. No public barrel, Ready or Engine publication.
 * Returned native objects must be used only through call() and share this lifetime.
 * Disposal drops this owner's references, without promising GC timing or RSS release. */
export class WasmNamespace {
  private readonly factory;
  private module: WebAssembly.Module | undefined;
  private nativeMemory: WebAssembly.Memory | undefined;
  private initialization: Promise<void> | undefined;

  constructor(bytes: Uint8Array, maximumPages: number, options?: FactoryOptions) {
    const module = new WebAssembly.Module(limitWasmMemory(bytes,maximumPages));
    if (WebAssembly.Module.imports(module).some(value => value.kind === "memory")) throw new Error("Imported Wasm memory is unsupported");
    this.module = module;
    this.factory = createFerrumWasmBindings(options);
  }

  initialize(): Promise<void> {
    const state = this.factory.state().state;
    if (state === "disposed" || state === "poisoned") return Promise.reject(new Error(`Wasm namespace is ${state}`));
    this.initialization ??= this.factory.bindings.default({module_or_path:this.module!}).then(output => {
      if (this.factory.state().state !== "ready") throw new Error("Wasm namespace initialization cancelled");
      this.nativeMemory = output.memory;
    }).catch(error => { this.clearReferences(); throw error; });
    return this.initialization;
  }

  /** Synchronous native boundary. A trap poisons this target before caller cleanup. */
  call<T>(operation: (bindings: typeof Core) => T): T {
    try { return this.factory.invoke(bindings => {
      if (this.nativeMemory === undefined) throw new Error("Wasm namespace initialization not settled");
      return operation(bindings);
    }); }
    catch (error) {
      if (this.factory.state().state === "poisoned") { this.clearReferences(); }
      throw error;
    }
  }

  // Read the existing export without invoking a Rust getter, which can itself allocate.
  memory(): WebAssembly.Memory { return this.call(() => this.nativeMemory!); }
  state(): FactoryState {
    const state = this.factory.state();
    if (state.state === "poisoned" || state.state === "disposed") this.clearReferences();
    return Object.freeze({...state,state:state.state === "ready" && this.nativeMemory === undefined ? "initializing" : state.state,retainsModule:state.retainsModule || this.module !== undefined,retainsWasm:state.retainsWasm || this.nativeMemory !== undefined});
  }
  dispose(): void {
    this.factory.dispose(); this.clearReferences();
  }
  private clearReferences(): void { this.module = undefined; this.nativeMemory = undefined; this.initialization = undefined; }
}

export {initializeBridgeInWasmNamespace} from "./wasmNamespaceContext.js";
