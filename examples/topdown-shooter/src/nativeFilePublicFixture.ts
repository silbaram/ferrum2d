/** Browser QA only: imports the public package and observes actual app objects. */
import { BrowserPlatformHost, InputManager, WebGL2Renderer, UNIFIED_PHYSICS_STATE_LAYOUT, type FerrumEngine } from "@ferrum2d/ferrum-web/core";

const calls = new WeakMap<object, number>();
for (const prototype of [BrowserPlatformHost.prototype, InputManager.prototype, WebGL2Renderer.prototype]) {
  const original = prototype.destroy;
  prototype.destroy = function (this: typeof prototype) {
    calls.set(this, (calls.get(this) ?? 0) + 1);
    return original.call(this as never);
  };
}
export const destroyCalls = (value: object) => calls.get(value) ?? 0;
export function playerX(engine: FerrumEngine): number {
  const handle = engine.builtInShooterPlayerHandle();
  if (!handle) throw new Error("Native Shooter player handle is missing");
  const state = engine.queryUnifiedPhysicsBodyStates(new Uint32Array([handle.entityId, handle.entityGeneration]));
  if (state.count !== 1) throw new Error("Native Shooter player body row is missing");
  return state.floats[UNIFIED_PHYSICS_STATE_LAYOUT.position];
}
export function observeEngine(engine: FerrumEngine): void {
  if (calls.has(engine)) return;
  calls.set(engine, 0);
  const original = engine.destroy;
  engine.destroy = () => { calls.set(engine, (calls.get(engine) ?? 0) + 1); original(); };
}
export function textureZeroPresent(renderer: WebGL2Renderer): boolean {
  try {
    const accidental = renderer.createRenderTexture(0, { width: 1, height: 1 });
    renderer.destroyRenderTexture(accidental);
    return false;
  } catch (error) {
    return error instanceof Error && /already|reserved|use|loaded/i.test(error.message);
  }
}
