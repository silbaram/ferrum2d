import { awaitPlacementAssetRead, capturePlacementUsageDocuments, collectPlacementAssetUsage, type AssetUsageReport, type UsageAsset, type UsageDocument } from "./placementAssetUsage";
import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
import type { PlacementSceneCatalog } from "./placementSceneCatalog";

/** Explicit snapshots only: no file writes, scene activation, texture uploads or automatic scans. */
export function createPlacementAssetUsagePanel(options: {
  load(signal?: AbortSignal): Promise<PlacementSceneCatalog | undefined>;
  assets(): readonly UsageAsset[];
  documents(): Iterable<UsageDocument>;
  context(): string;
  canScan(): boolean;
}) {
  const element = document.createElement("details"), summary = document.createElement("summary"),
    actions = document.createElement("div"), scan = document.createElement("button"),
    download = document.createElement("button"), search = document.createElement("input"),
    status = document.createElement("output"), scope = document.createElement("p"),
    hint = document.createElement("p"), list = document.createElement("div"), diagnostics = document.createElement("details"),
    diagnosticTitle = document.createElement("summary"), diagnosticList = document.createElement("div");
  const filterLabel = document.createElement("p"), clearFilter = document.createElement("button");
  clearFilter.type = "button"; clearFilter.dataset.placementUsageClearFilter = "true";
  setUiText(clearFilter, "Clear Asset Filter");
  element.className = "placement-asset-usage"; element.dataset.placementAssetUsage = "true";
  actions.className = "placement-asset-usage-actions";
  list.className = "placement-asset-usage-list";
  scan.type = download.type = "button"; scan.dataset.placementUsageScan = "true"; download.dataset.placementUsageExport = "true";
  status.dataset.placementUsageStatus = "true"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  search.type = "search"; search.dataset.placementUsageSearch = "true";
  setUiText(summary, "Asset Usage"); setUiText(scan, "Scan References"); setUiText(download, "Export Report");
  setUiAttribute(search, "placeholder", "Search assets, scenes or objects"); setUiAttribute(search, "aria-label", "Search asset usage");
  setUiText(hint, "Scene references and open workspace snapshots only. Code, external manifests, GLB contents and Undo history are not scanned. No references found does not mean safe to delete.");
  setUiText(diagnosticTitle, "Scan Issues");
  diagnostics.append(diagnosticTitle, diagnosticList);
  actions.append(scan, download); element.append(summary, actions, status, scope, filterLabel, search, clearFilter, list, diagnostics, hint);
  let focusedAsset: { id: string; kind: UsageAsset["kind"] } | undefined;
  let report: AssetUsageReport | undefined, generation = 0, busy = false, context = options.context(), scannedAt = "";
  let scanController: AbortController | undefined;
  const source = { disk: "Scene File", saved: "Open · Saved", draft: "Open · Draft" } as const;
  const issueLabels: Record<string, string> = {
    read: "Could not read scene", document: "Unsupported scene document",
    limit: "Scan limit reached", unresolved: "Asset reference could not be resolved",
  };
  function render() {
    list.replaceChildren(); diagnosticList.replaceChildren();
    clearFilter.hidden = filterLabel.hidden = !focusedAsset;
    if (focusedAsset) setUiText(filterLabel, uiMessage("Asset filter · {0}", focusedAsset.id));
    search.hidden = !report; diagnostics.hidden = !report?.issues.length;
    scope.hidden = !report;
    if (!report) return;
    setUiText(scope, uiMessage("{0} · {1} · Snapshot {2}", report.label,
      uiMessage(report.snapshot === "folder" ? "Selected Folder" : report.snapshot === "hosted" ? "Provided Scenes" : "Project Scenes"), scannedAt));
    const query = search.value.trim().toLocaleLowerCase();
    const values = report.assets.filter(asset => (!focusedAsset || asset.id === focusedAsset.id && asset.kind === focusedAsset.kind) && (asset.id + " " + asset.references.map(ref => `${ref.scene} ${ref.owner ?? ""} ${ref.pointer}`).join(" ")).toLocaleLowerCase().includes(query));
    for (const asset of values.slice(0, 200)) {
      const row = document.createElement("details"), title = document.createElement("summary"), refs = document.createElement("ul");
      row.dataset.placementUsageAsset = asset.kind + ":" + asset.id;
      setUiText(title, uiMessage("{0} · {1} · {2} references{3}", asset.id, uiMessage(asset.kind === "model" ? "Model" : "Texture"), asset.references.length,
        asset.registered ? "" : uiMessage(" · Not in viewer")));
      row.append(title, refs);
      if (!asset.references.length) {
        const note = document.createElement("p"); setUiText(note, "No references found in this snapshot"); row.append(note);
      }
      for (const reference of asset.references.slice(0, 100)) {
        const item = document.createElement("li"), location = document.createElement("div"), pointer = document.createElement("code");
        setUiText(location, uiMessage("{0} · {1}{2}", uiMessage(source[reference.source]), reference.scene, reference.owner ? " · " + reference.owner : ""));
        pointer.textContent = reference.pointer; item.append(location, pointer); refs.append(item);
      }
      if (asset.references.length > 100) {
        const note = document.createElement("p"); setUiText(note, "Showing first 100 references. Export the report for all collected references."); row.append(note);
      }
      list.append(row);
    }
    if (values.length > 200) {
      const note = document.createElement("p"); setUiText(note, "Showing first 200 assets. Refine search or export the report."); list.append(note);
    } else if (!values.length) {
      const note = document.createElement("p"); setUiText(note, "No matching assets"); list.append(note);
    }
    for (const issue of report.issues) {
      const row = document.createElement("p"); setUiText(row, uiMessage("{0} · {1}{2}", uiMessage(issueLabels[issue.code]), issue.scene, issue.pointer ? " · " + issue.pointer : ""));
      diagnosticList.append(row);
    }
  }
  function sync() {
    const next = options.context();
    if (next !== context) {
      scanController?.abort(new DOMException("Asset usage context changed", "AbortError")); scanController = undefined;
      context = next; generation++; busy = false; report = undefined; render();
      setUiText(status, "Workspace changed. Scan references again.");
    }
    scan.disabled = busy || !options.canScan(); download.disabled = busy || !report;
    element.setAttribute("aria-busy", String(busy));
  }
  scan.addEventListener("click", () => void (async () => {
    sync(); if (busy || !options.canScan()) return;
    const token = ++generation, scopeKey = context, controller = new AbortController();
    scanController = controller;
    const current = () => !controller.signal.aborted && token === generation && scopeKey === options.context();
    busy = true; report = undefined; render(); sync(); setUiText(status, "Scanning references…");
    try {
      const snapshot = capturePlacementUsageDocuments(options.documents());
      const assets = options.assets();
      const catalog = await awaitPlacementAssetRead(options.load(controller.signal), controller.signal);
      if (!current()) return;
      if (!catalog) throw new Error("Choose a project folder before scanning references");
      const result = await collectPlacementAssetUsage({ catalog, assets, ...snapshot, current, signal: controller.signal });
      if (!current()) return;
      report = result; scannedAt = new Date().toLocaleTimeString(); render();
      setUiText(status, uiMessage("{0}/{1} scene files · {2} assets · {3}", result.scanned, result.total, result.assets.length,
        uiMessage(result.limited || result.issues.length ? "Partial scan · Review issues" : "Snapshot ready")));
    } catch (error) {
      if (current()) setUiText(status, uiMessage("Usage scan failed. {0}", error instanceof Error ? error.message : String(error)));
    } finally { if (token === generation) { scanController = undefined; busy = false; sync(); } }
  })());
  download.addEventListener("click", () => {
    sync(); if (!report || busy) return;
    const value = { format: "ferrum2d.asset-usage", version: 1, deletionAllowed: false, ...report };
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "ferrum-asset-usage.json"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  search.addEventListener("input", () => { focusedAsset = undefined; render(); });
  clearFilter.addEventListener("click", () => { focusedAsset = undefined; search.value = ""; render(); if (!search.hidden) search.focus(); });
  setUiText(status, "Scan scene references without opening or changing scenes."); render(); sync();
  return { element, sync, showAsset(id: string, kind: UsageAsset["kind"]) {
    sync(); focusedAsset = {id, kind}; search.value = id; element.open = true; render();
    element.scrollIntoView({block:"nearest"}); (search.hidden ? scan : search).focus({preventScroll:true});
  } };
}
