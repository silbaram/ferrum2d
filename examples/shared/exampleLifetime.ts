/** Page-owned initialization and resource lifetime; simulation stays in the runtime. */
export function createExampleLifetime() {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  let ready = false;
  const check = () => {
    if (controller.signal.aborted) throw new DOMException("Example initialization cancelled", "AbortError");
  };
  const dispose = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    cleanupRuntimeDemoResources(cleanups);
  };
  window.addEventListener("pagehide", event => {
    if (event.persisted && ready) return;
    dispose();
    if (event.persisted) {
      // A cached page whose startup was cancelled needs a fresh initialization.
      const restore = (shown: PageTransitionEvent) => {
        if (!shown.persisted) return;
        window.removeEventListener("pageshow", restore);
        location.reload();
      };
      window.addEventListener("pageshow", restore);
    }
  }, { signal: controller.signal });
  return {
    signal: controller.signal,
    get disposed() { return controller.signal.aborted; },
    own(cleanup: () => void) {
      if (controller.signal.aborted) {
        cleanupRuntimeDemoResources([cleanup]);
        check();
      }
      cleanups.push(cleanup);
    },
    check,
    ready() { check(); ready = true; },
    dispose,
  };
}

export function cleanupRuntimeDemoResources(cleanups: Array<() => void>): void {
  for (const cleanup of cleanups.splice(0).reverse()) {
    try { cleanup(); }
    catch (error) { console.warn("Ferrum2D cleanup failed", error); }
  }
}
