import type { createPixelEditor } from "./placementPixelDocument";
import { createPixelRecoveryStore, PIXEL_RECOVERY_LIMITS, type PixelCheckpointInfo, type PixelRecoveryStore } from "./placementPixelRecovery";

type Editor = ReturnType<typeof createPixelEditor>;
/** One independent checkpoint per editing lifetime; queued deletes follow all old writes. */
export function createPixelRecoverySession(options: {
  changed(): void;
  canCapture(): boolean;
  store?: PixelRecoveryStore;
  delay?: number;
}) {
  const store = options.store ?? createPixelRecoveryStore();
  let session: { id: string; scope: string; editor: Editor; stamp?: string; queued?: boolean; again?: boolean } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, queue = Promise.resolve();
  let scope = "", request = 0, disposed = false, entries: PixelCheckpointInfo[] = [], status = "";
  function changed() { if (!disposed) options.changed(); }
  function error(value: unknown) {
    status = value instanceof DOMException && value.name === "QuotaExceededError"
      ? "Local recovery storage is full. Export Source to keep your work."
      : "Local recovery unavailable. Export Source to keep your work.";
    changed();
  }
  function enqueue(run: () => Promise<void>) {
    queue = queue.then(run).catch(error); return queue;
  }
  async function refresh(value = scope) {
    if (scope !== value) { entries = []; status = ""; }
    scope = value; const token = ++request;
    try {
      const next = await store.list(value);
      if (!disposed && token === request) { entries = next; if (status.startsWith("Local recovery")) status = ""; changed(); }
    } catch (value) { if (!disposed && token === request) error(value); }
  }
  function cancelTimer() { clearTimeout(timer); timer = undefined; }
  function flush() {
    cancelTimer(); const current = session;
    if (!current || current.editor.active() || !options.canCapture()) { if (current) current.stamp = undefined; return queue; }
    if (current.queued) { current.again = true; return queue; }
    current.queued = true;
    return enqueue(async () => {
      try {
        if (session !== current) return;
        if (current.editor.active() || !options.canCapture()) { current.stamp = undefined; return; }
        // Capture only when the writer can start: a stalled store cannot accumulate JSON snapshots.
        const source = JSON.stringify(current.editor.document());
        await store.put({ id: current.id, scope: current.scope, name: current.editor.name, source,
          bytes: new TextEncoder().encode(source).length, updatedAt: Date.now() });
        if (session === current) { status = "Draft saved locally"; changed(); }
        await refresh(scope);
      } finally {
        current.queued = false;
        if (current.again && session === current && !disposed) {
          current.again = false; timer = setTimeout(() => { void flush(); }, 0);
        }
      }
    });
  }
  function forget() {
    cancelTimer(); const previous = session; session = undefined; status = "";
    if (previous) return enqueue(async () => { await store.remove(previous.scope, previous.id); await refresh(scope); });
    return queue;
  }
  return {
    refresh, flush, forget,
    observe(editor: Editor, key: string, dirty: boolean) {
      if (disposed || editor.active() || !options.canCapture()) return;
      if (!dirty) { if (session?.editor === editor) void forget(); return; }
      if (!session || session.editor !== editor) session = { id: crypto.randomUUID(), scope: key, editor };
      const stamp = editor.revision() + ":" + dirty;
      if (session.stamp === stamp) return;
      session.stamp = stamp; cancelTimer();
      timer = setTimeout(() => { void flush(); }, options.delay ?? PIXEL_RECOVERY_LIMITS.delay);
    },
    state: () => ({ entries: entries.filter(row => row.id !== session?.id), status }),
    async read(id: string, key = scope) { return store.read(key, id); },
    async discard(id: string) { try { await store.remove(scope, id); await refresh(scope); } catch (value) { error(value); } },
    retry() { if (session) { session.stamp = undefined; void flush(); } void refresh(scope); },
    destroy() { void flush(); disposed = true; request++; cancelTimer(); void queue.then(() => store.close()); },
  };
}
