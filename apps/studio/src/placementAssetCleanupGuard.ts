/** Lazily read state of one open scene document. */
export interface PlacementCleanupDocumentState {
  hasDraft(): boolean;
  history(): { undoCount: number; redoCount: number; transactionLabel?: string };
  hasPendingEdits(): boolean;
}

/** Workspace state read in the same order as the checks, so later readers are skipped once blocked. */
export interface PlacementCleanupGuardState {
  /** An edit gesture, load, scene switch or running Game Preview owns the workspace. */
  workspaceBusy(): boolean;
  documents(): Iterable<PlacementCleanupDocumentState>;
  /** An asset tool holds prepared work that a mandatory reopen would discard. */
  assetToolsBusy(): boolean;
}

/**
 * Throws the first reason that blocks catalog cleanup. Read-only analysis only needs an idle
 * workspace; a write additionally needs saved, history-free scenes and no pending asset work.
 */
export function assertPlacementAssetCleanupAllowed(state: PlacementCleanupGuardState, write: boolean): void {
  if (state.workspaceBusy()) throw Error("Finish the current edit, load or running scene before cleanup");
  if (!write) return;
  const documents = [...state.documents()];
  if (documents.some(entry => entry.hasDraft())) throw Error("Save all scene changes before catalog cleanup");
  if (documents.some(entry => {
    const history = entry.history();
    return history.undoCount || history.redoCount || history.transactionLabel;
  })) throw Error("Reopen saved scenes to clear Undo and Redo before catalog cleanup");
  if (documents.some(entry => entry.hasPendingEdits()))
    throw Error("Apply or revert pending component inputs before catalog cleanup");
  if (state.assetToolsBusy()) throw Error("Save prepared assets or reopen the project before catalog cleanup");
}
