export function assertPlacementWorkspaceFileSize(bytes: number): void {
  if (bytes > 2 * 1024 * 1024) throw new Error("Document exceeds 2 MiB");
}

export function assertPlacementWorkspaceCanOpen(openCount: number): void {
  if (openCount >= 8)
    throw new Error("Close a document before opening another (8 maximum)");
}
