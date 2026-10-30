/** Authoring history budgets count serialized snapshots, not asset or runtime memory. */
const MAX_ENTRIES = 100;
const MAX_BYTES = 8 * 1024 * 1024;

export interface ScenePlacementHistoryState {
  readonly undoCount: number;
  readonly redoCount: number;
  readonly bytes: number;
  readonly transactionLabel?: string;
}

interface Entry<T> {
  before: T;
  after: T;
  label: string;
  bytes: number;
}

/** Cold document edits only. Selection and camera navigation do not create entries. */
export class ScenePlacementHistory<T> {
  private entries: Entry<T>[] = [];
  private cursor = 0;
  private bytes = 0;
  private transaction?: { before: T; label: string };

  constructor(
    private readonly capture: () => T,
    private readonly restore: (snapshot: T) => void,
    private readonly signature: (snapshot: T) => string,
  ) {}

  state(): ScenePlacementHistoryState {
    return {
      undoCount: this.cursor,
      redoCount: this.entries.length - this.cursor,
      bytes: this.bytes,
      ...(this.transaction ? { transactionLabel: this.transaction.label } : {}),
    };
  }

  /** Cold resource lifetime query, including redo and an unfinished transaction. */
  someSnapshot(predicate: (snapshot: T) => boolean): boolean {
    return predicate(this.capture()) ||
      (this.transaction !== undefined && predicate(this.transaction.before)) ||
      this.entries.some(entry => predicate(entry.before) || predicate(entry.after));
  }

  edit<R>(label: string, action: () => R): R {
    const before = this.capture();
    if (this.transaction) {
      try {
        return action();
      } catch (error) {
        // The current draft may be rejected. A failed cancellation can only
        // fall back to the accepted state captured before this action.
        this.restoreChecked(this.transaction.before, before);
        this.transaction = undefined;
        throw error;
      }
    }
    try {
      const result = action();
      this.record(before, this.capture(), label);
      return result;
    } catch (error) {
      // Never use the rejected candidate as a recovery snapshot. Even if the
      // host rejects recovery, the authored draft must remain at `before`.
      this.restore(before);
      throw error;
    }
  }

  begin(label: string): void {
    if (this.transaction)
      throw new Error("A placement edit is already in progress.");
    if (!label.trim()) throw new Error("A placement edit requires a label.");
    this.transaction = { before: this.capture(), label };
  }

  commit(): void {
    if (!this.transaction) return;
    const { before, label } = this.transaction;
    const after = this.capture();
    this.transaction = undefined;
    this.record(before, after, label);
  }

  cancel(): void {
    if (!this.transaction) return;
    const { before } = this.transaction;
    this.restoreChecked(before);
    this.transaction = undefined;
  }

  undo(): void {
    if (this.transaction) {
      this.cancel();
      return;
    }
    if (this.cursor === 0) return;
    this.restoreChecked(this.entries[this.cursor - 1].before);
    this.cursor--;
  }

  redo(): void {
    if (this.transaction || this.cursor === this.entries.length) return;
    this.restoreChecked(this.entries[this.cursor].after);
    this.cursor++;
  }

  private restoreChecked(snapshot: T, current = this.capture()): void {
    try {
      this.restore(snapshot);
    } catch (error) {
      this.restore(current);
      throw error;
    }
  }

  private record(before: T, after: T, label: string): void {
    if (this.signature(before) === this.signature(after)) return;
    this.entries.splice(this.cursor);
    this.bytes = this.entries.reduce((sum, entry) => sum + entry.bytes, 0);
    const bytes = new TextEncoder().encode(
      JSON.stringify([before, after]),
    ).byteLength;
    // An oversized edit remains applied, but cannot retain older history across that gap.
    if (bytes > MAX_BYTES) {
      this.entries = [];
      this.cursor = 0;
      this.bytes = 0;
      return;
    }
    this.entries.push({ before, after, label, bytes });
    this.bytes += bytes;
    while (this.entries.length > MAX_ENTRIES || this.bytes > MAX_BYTES) {
      this.bytes -= this.entries.shift()!.bytes;
    }
    this.cursor = this.entries.length;
  }
}
