import type {WasmNamespace} from "./wasmNamespace.js";

// A unique receiver carries a context through the unchanged WasmBridge.init()
// signature. It is never a shared ambient current namespace, including across await.
const bridgeReceivers = new WeakMap<object,WasmNamespace>();
export function wasmNamespaceForBridge(receiver: object): WasmNamespace | undefined { return bridgeReceivers.get(receiver); }
export async function initializeBridgeInWasmNamespace<T>(namespace: WasmNamespace, initialize: () => Promise<T>): Promise<T> {
  const receiver = Object.freeze({}); bridgeReceivers.set(receiver,namespace);
  try { return await initialize.call(receiver); }
  finally { bridgeReceivers.delete(receiver); }
}
