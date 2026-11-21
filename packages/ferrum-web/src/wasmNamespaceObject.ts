/** @internal Guard SDK-owned generated objects from one isolated namespace.
 * Default singleton objects never pass through this cold ownership adapter. */
import type { WasmNamespace } from "./wasmNamespace.js";

interface Entry {
  readonly namespace: WasmNamespace;
  readonly native: object;
  proxy: object;
  released: boolean;
}
const owners = new WeakMap<object, Entry>();
const nativeClasses = ["Engine", "EngineRuntimeCheckpoint", "NativeQuestLog", "NativeDialogueSession", "NativePixelMaskTerrain", "NativeFilePrepare"];

/** The caller creates native inside namespace.call(); file records are never
 * accepted here as ownership proof. Method receivers remain the actual generated
 * objects, including finalizer unregister and consuming __destroy_into_raw. */
export function guardWasmNamespaceObject<T extends object>(namespace: WasmNamespace, native: T): T {
  const existing = owners.get(native);
  if (existing) {
    if (existing.namespace !== namespace) throw new Error("Native object belongs to another Wasm namespace");
    return existing.proxy as T;
  }
  const entry: Entry = { namespace, native, proxy: native, released: false };
  const methods = new Map<PropertyKey, (...args: unknown[]) => unknown>();
  const proxy = new Proxy(native, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function" || key === "constructor") return value;
      let method = methods.get(key);
      if (!method) {
        method = (...args: unknown[]) => {
          const disposal = key === "free" || key === Symbol.dispose;
          if (disposal) {
            if (entry.released) return;
            entry.released = true;
            // A trapped/disposed target cannot safely execute any native free.
            if (namespace.state().state !== "ready") return;
          } else if (entry.released) throw new Error("Native object has been released");
          const actual = args.map(argument => {
            if (argument === null || typeof argument !== "object") return argument;
            const owner = owners.get(argument);
            if (!owner) return argument;
            if (owner.namespace !== namespace || owner.released) throw new Error("Foreign or released native argument");
            return owner.native;
          });
          return namespace.call(bindings => {
            const result: unknown = Reflect.apply(value, target, actual);
            if (result !== null && typeof result === "object") {
              const exports = bindings as unknown as Record<string, unknown>;
              for (const name of nativeClasses) {
                const constructor = exports[name];
                if (typeof constructor === "function" && result instanceof constructor)
                  return guardWasmNamespaceObject(namespace, result);
              }
            }
            return result;
          });
        };
        methods.set(key, method);
      }
      return method;
    },
  });
  entry.proxy = proxy; owners.set(native, entry); owners.set(proxy, entry);
  return proxy;
}

/** Used only by cold constructors/static generated methods in the same owner.
 * Never returns an object from a different namespace or a released pointer. */
export function nativeWasmNamespaceObject<T extends object>(namespace: WasmNamespace, proxy: T): T {
  const entry = owners.get(proxy);
  if (!entry || entry.namespace !== namespace || entry.released) throw new Error("Foreign or released native object");
  return namespace.call(() => entry.native as T);
}

/** Resolve only actual registered generated-object ownership. Unregistered
 * default singleton objects have no isolated owner; file metadata is not proof. */
export function wasmNamespaceForObject(native: object): WasmNamespace | undefined {
  const entry = owners.get(native);
  if (!entry) return undefined;
  if (entry.released) throw new Error("Native object has been released");
  return entry.namespace.call(() => entry.namespace);
}
