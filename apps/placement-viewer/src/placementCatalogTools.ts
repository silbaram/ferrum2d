import { setUiText, uiMessage } from "./placementLocale";
import type { PlacementSpriteRevision } from "./placementSpriteRevisions";

/** Session revision budget management; persisted project catalogs remain protected. */
export function installPlacementCatalogTools<T extends PlacementSpriteRevision>(options: {
  root: HTMLElement;
  store: { entries(): T[]; collectUnused(retained: ReadonlySet<string>): Promise<{ removed: number; bytes: number }> };
  canEdit(): boolean;
  retains(id: string): boolean;
  changed(): void;
}) {
  const section = document.createElement("details"), summary = document.createElement("summary"),
    info = document.createElement("output"), clean = document.createElement("button"), status = document.createElement("output");
  section.dataset.placementCatalog = "true";
  clean.type = "button"; clean.dataset.placementCatalogClean = "true";
  status.setAttribute("aria-live", "polite");
  setUiText(summary, "Catalog"); setUiText(clean, "Clean Unused");
  const hint = document.createElement("p");
  setUiText(hint, "Scene, Undo/Redo, import drafts and saved project assets are preserved.");
  section.append(summary, info, clean, status, hint); options.root.append(section);
  let busy = false;
  function sync() {
    const entries = options.store.entries();
    setUiText(info, uiMessage("{0} revisions · {1} bytes", entries.length, entries.reduce((sum, a) => sum + a.bytes, 0)));
    clean.disabled = busy || !options.canEdit() || !entries.some(a => !a.persisted);
  }
  clean.addEventListener("click", () => void (async () => {
    if (busy || !options.canEdit()) return;
    busy = true; sync();
    try {
      const retained = new Set(options.store.entries().filter(a => options.retains(a.id)).map(a => a.id));
      const result = await options.store.collectUnused(retained);
      setUiText(status, uiMessage("Removed {0} revisions · Freed {1} bytes", result.removed, result.bytes));
      options.changed();
    } catch (error) {
      setUiText(status, uiMessage("Cleanup failed. {0}", error instanceof Error ? error.message : String(error)));
    } finally { busy = false; sync(); }
  })());
  return { sync };
}
