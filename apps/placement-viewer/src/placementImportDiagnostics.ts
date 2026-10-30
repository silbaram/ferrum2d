import { setUiText } from "./placementLocale";

export interface PlacementImportDiagnostic {
  severity: "error";
  message: string;
  document: string;
  source: { file: string; pointer: string; item?: string };
  scenePaths: string[];
  scenePathsTruncated?: boolean;
  assetId?: string;
  hint: string;
}

const reports = new Map<string, readonly PlacementImportDiagnostic[]>();

/** Replayable state: the Problems panel may mount after an import panel's first sync. */
export function readPlacementImportDiagnostics(): readonly PlacementImportDiagnostic[] {
  return structuredClone([...reports.values()].flat());
}

/** JSON pointer evidence is exact for authored references; inherited references keep their prefab path. */
export function createPlacementImportDiagnostic(error: unknown, context: {
  document: string; sourceFile: string; scene: unknown; assetId?: string;
}): PlacementImportDiagnostic {
  const detail = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const rawSource = detail.importSource;
  const source = rawSource && typeof rawSource === "object" ? rawSource as Record<string, unknown> : {};
  const paths: string[] = [];
  const id = typeof detail.assetId === "string" ? detail.assetId : context.assetId;
  let truncated = false;
  if (id) {
    type Frame = { value: unknown; path: string; exit?: boolean };
    const stack: Frame[] = [{ value: context.scene, path: "" }];
    const ancestors = new WeakSet<object>();
    let visited = 0;
    while (stack.length) {
      if (visited++ >= 65_536 || paths.length >= 64) { truncated = true; break; }
      const { value, path, exit } = stack.pop()!;
      if (exit && value && typeof value === "object") { ancestors.delete(value); continue; }
      if (path.length > 4096) { truncated = true; continue; }
      if (typeof value === "string" && value === id) paths.push(path);
      else if (value && typeof value === "object") {
        if (ancestors.has(value)) { truncated = true; continue; }
        ancestors.add(value); stack.push({ value, path, exit: true });
        const keys = Object.keys(value);
        const count = Math.min(keys.length, Math.max(0, 65_536 - visited - stack.length));
        if (count < keys.length) truncated = true;
        for (let i = count - 1; i >= 0; i--) {
          const key = keys[i];
          stack.push({ value: (value as Record<string, unknown>)[key], path: path + "/" + key.replace(/~/g, "~0").replace(/\//g, "~1") });
        }
      }
    }
  }
  return { severity: "error", message: error instanceof Error ? error.message : String(error), document: context.document,
    source: { file: typeof source.file === "string" ? source.file : context.sourceFile,
      pointer: typeof source.pointer === "string" ? source.pointer : "",
      ...(typeof source.item === "string" ? { item: source.item } : {}) },
    scenePaths: paths, ...(truncated ? { scenePathsTruncated: true } : {}), ...(id ? { assetId: id } : {}),
    hint: /frame/i.test(error instanceof Error ? error.message : String(error))
      ? "Restore the source frame or apply an explicit replacement. Existing scene references were preserved."
      : "Check source JSON, image and import options. Existing scene references were preserved." };
}

export function installPlacementImportDiagnostics(root: HTMLElement, channel: string) {
  const section = document.createElement("details"), summary = document.createElement("summary"), report = document.createElement("pre");
  setUiText(summary, "Import Diagnostics"); section.dataset.placementImportDiagnostics = channel;
  section.append(summary, report); root.append(section);
  let signature = "";
  return { update(diagnostics: readonly PlacementImportDiagnostic[]) {
    const next = JSON.stringify(diagnostics);
    if (signature === next) return;
    signature = next; section.hidden = !diagnostics.length;
    if (diagnostics.length) reports.set(channel, structuredClone(diagnostics));
    else reports.delete(channel);
    report.textContent = JSON.stringify(diagnostics, null, 2);
    section.open = diagnostics.length > 0;
    window.dispatchEvent(new CustomEvent("ferrum-placement-import-diagnostics", { detail: { channel, diagnostics } }));
  }, clear() {
    signature = ""; reports.delete(channel); section.hidden = true;
    report.textContent = "";
    window.dispatchEvent(new CustomEvent("ferrum-placement-import-diagnostics"));
  } };
}
