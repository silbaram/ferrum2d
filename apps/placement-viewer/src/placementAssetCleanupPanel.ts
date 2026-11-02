import { cleanupDirectories, cleanupSelection, protectCleanupDocuments, readCleanupBackups, readCleanupReport, readCleanupResult, type CleanupBackup, type CleanupHost, type CleanupKind, type CleanupReport } from "./placementAssetCleanup";
import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
const kinds: CleanupKind[] = ["pixel", "aseprite", "tile", "normal"];
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
/** Explicit modal maintenance. Native owns file checks, backups, publication and recovery. */
export function createPlacementAssetCleanupPanel(options: {
  host(): CleanupHost | undefined;
  context(): string;
  documents(): Iterable<{
    scene: string;
    document: unknown;
  }>;
  guard(write: boolean): void;
  reopen(project: string): void;
}) {
  const element = document.createElement("div");
  const open = document.createElement("button");
  const availability = document.createElement("p");
  element.className = "placement-asset-cleanup";
  open.type = "button";
  open.dataset.placementCleanupOpen = "true";
  setUiText(open, "Catalog Cleanup");
  element.append(open, availability);
  const dialog = document.createElement("dialog");
  const header = document.createElement("header");
  const title = document.createElement("h2");
  const close = document.createElement("button");
  const scope = document.createElement("p");
  const hint = document.createElement("p");
  const status = document.createElement("output");
  const catalog = document.createElement("select");
  const summary = document.createElement("p");
  const list = document.createElement("div");
  const backups = document.createElement("details");
  const backupTitle = document.createElement("summary");
  const backupList = document.createElement("div");
  const actions = document.createElement("div");
  const scan = document.createElement("button");
  const apply = document.createElement("button");
  const exportPlan = document.createElement("button");
  const reopen = document.createElement("button");
  const reason = document.createElement("p");
  dialog.className = "placement-cleanup-dialog";
  dialog.dataset.placementCleanupDialog = "true";
  title.id = "placement-cleanup-title";
  setUiText(title, "Project Catalog Cleanup");
  dialog.setAttribute("aria-labelledby", title.id);
  setUiText(close, "Close");
  close.type = "button";
  close.dataset.placementCleanupClose = "true";
  header.append(title, close);
  for (const kind of kinds) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = cleanupDirectories[kind];
    catalog.append(option);
  }
  setUiAttribute(catalog, "aria-label", "Managed Catalog");
  catalog.dataset.placementCleanupKind = "true";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.dataset.placementCleanupStatus = "true";
  reason.setAttribute("role", "status");
  reason.id = "placement-cleanup-reason";
  apply.setAttribute("aria-describedby", reason.id);
  list.className = "placement-cleanup-list";
  backupList.className = "placement-cleanup-backups";
  actions.className = "placement-cleanup-actions";
  setUiText(backupTitle, "Recovery Backups");
  backups.append(backupTitle, backupList);
  setUiText(hint, "Only managed revisions are retired. Scene JSON and other managed sources are scanned; dynamic code and GLB contents are not. A complete catalog backup is retained, so total disk usage may increase. Reopen the project after a write; unapplied tool settings are not retained.");
  for (const [button, label, key] of [[scan, "Analyze", "scan"], [apply, "Back Up and Retire", "apply"], [exportPlan, "Export Plan", "export"], [reopen, "Reopen Project", "reopen"]] as const) {
    button.type = "button";
    setUiText(button, label);
    button.dataset.placementCleanupAction = key;
  }
  actions.append(scan, apply, exportPlan, reopen);
  dialog.append(header, scope, hint, status, catalog, summary, list, backups, reason, actions);
  document.body.append(dialog);
  let report: CleanupReport | undefined;
  let recoveryBackups: CleanupBackup[] = [];
  let protectedKeys: string[] = [];
  let selected = new Set<string>();
  let context = options.context();
  let serial = 0;
  let busy: "scan" | "write" | undefined;
  let needsReload = false;
  let disposed = false;
  let operationProject = "";
  const restoreButtons = new Set<HTMLButtonElement>();
  const revisionInputs = new Map<HTMLInputElement, boolean>();
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);
  function blocked(write: boolean) { try {
    options.guard(write);
    return "";
  }
  catch (error) {
    return message(error);
  } }
  function controls() {
    const host = options.host();
    open.disabled = !!busy || !host;
    setUiText(availability, host ? "Managed originals can be reviewed with recoverable backups." : "Open a project in the desktop app to manage disk catalogs.");
    const guardProblem = dialog.open ? blocked(true) : "";
    let problem = guardProblem;
    if (!problem && report?.backups.length === 8)
      problem = "Backup limit reached. Retain or archive existing backups before creating more.";
    if (!problem) {
      try {
        if (!report)
          throw Error("Analyze the current project first");
        cleanupSelection(report, selected, protectedKeys);
      }
      catch (error) {
        problem = message(error);
      }
    }
    scan.disabled = !!busy || needsReload || !host;
    catalog.disabled = !!busy || needsReload;
    apply.disabled = !!busy || needsReload || !host || !!problem;
    exportPlan.disabled = !!busy || !report || needsReload;
    close.disabled = busy === "write" || needsReload;
    reopen.hidden = !needsReload;
    reopen.disabled = !!busy;
    for (const button of restoreButtons)
      button.disabled = !!busy || needsReload || !!guardProblem || button.dataset.invalid === "true";
    for (const [input, protectedEntry] of revisionInputs)
      input.disabled = protectedEntry || !!busy || needsReload;
    reason.hidden = needsReload || !problem;
    if (problem)
      setUiText(reason, uiMessage(problem));
    dialog.setAttribute("aria-busy", String(!!busy));
    if (report) {
      const current = report.catalogs.find(value => value.kind === catalog.value);
      setUiText(summary, uiMessage("{0} JSON files · {1} revisions selected · Full backup {2}", report.jsonFiles, selected.size, size(current?.backupBytes ?? 0)));
    }
  }
  function render() {
    list.replaceChildren();
    backupList.replaceChildren();
    restoreButtons.clear();
    revisionInputs.clear();
    catalog.hidden = summary.hidden = !report;
    backups.hidden = !report && recoveryBackups.length === 0;
    if (report) {
      const entries = report.revisions.filter(value => value.kind === catalog.value);
      for (const revision of entries) {
        const row = document.createElement("div");
        const label = document.createElement("label");
        const check = document.createElement("input");
        const caption = document.createElement("span");
        const details = document.createElement("details");
        const detailTitle = document.createElement("summary");
        const evidence = document.createElement("ul");
        check.type = "checkbox";
        check.disabled = !!revision.references.length;
        check.checked = selected.has(revision.key);
        check.dataset.placementCleanupRevision = revision.key;
        revisionInputs.set(check, !!revision.references.length);
        setUiText(caption, uiMessage("{0} · {1}", revision.id, uiMessage(revision.references.length ? "Protected" : "No references found in this snapshot")));
        label.append(check, caption);
        setUiText(detailTitle, "Files and References");
        details.append(detailTitle, evidence);
        for (const text of [...revision.references, ...revision.files.map(file => `${file.name} · ${size(file.bytes)} · SHA-256 ${file.sha256}`)]) {
          const item = document.createElement("li");
          item.textContent = text;
          evidence.append(item);
        }
        row.append(label, details);
        list.append(row);
        check.addEventListener("change", () => { if (check.checked)
          selected.add(revision.key);
        else
          selected.delete(revision.key); controls(); });
      }
      if (!entries.length) {
        const empty = document.createElement("p");
        setUiText(empty, "No managed revisions in this catalog");
        list.append(empty);
      }
    }
      for (const backup of recoveryBackups) {
        const row = document.createElement("div");
        const text = document.createElement("span");
        const restore = document.createElement("button");
        text.textContent = `${backup.kind ? cleanupDirectories[backup.kind] : backup.id} · ${backup.id.slice(0, 12)}${backup.problem ? " · " + backup.problem : ""}`;
        restore.type = "button";
        setUiText(restore, backup.restored ? "Restored" : "Restore Backup");
        restore.dataset.placementCleanupRestore = backup.id;
        restore.dataset.invalid = String(backup.restored || !!backup.problem);
        row.append(text, restore);
        backupList.append(row);
        restoreButtons.add(restore);
        restore.addEventListener("click", () => void write(backup.id));
      }
    controls();
  }
  function sync() {
    if (disposed)
      return;
    if (!dialog.open) {
      open.disabled = !!busy || !options.host();
      return;
    }
    const next = options.context();
    if (next !== context && !busy && !needsReload) {
      context = next;
      report = undefined;
      recoveryBackups = [];
      selected.clear();
      serial++;
      render();
      if (dialog.open)
        setUiText(status, "Workspace changed. Analyze cleanup again.");
    }
    controls();
  }
  async function analyze() {
    if (busy || needsReload)
      return;
    sync();
    const host = options.host();
    if (!host)
      return;
    const problem = blocked(false);
    if (problem) {
      setUiText(status, uiMessage(problem));
      return;
    }
    const token = ++serial;
    const source = options.context();
    busy = "scan";
    report = undefined;
    recoveryBackups = [];
    protectedKeys = [];
    selected.clear();
    render();
    setUiText(status, "Analyzing managed catalogs…");
    try {
      const result = readCleanupReport(await host.invoke("inspect_placement_asset_cleanup", { projectPath: host.project }));
      if (disposed || serial !== token)
        return;
      if (source !== options.context() || host.project !== options.host()?.project)
        throw Error("Workspace changed. Analyze cleanup again.");
      protectedKeys = protectCleanupDocuments(result, options.documents());
      report = result;
      recoveryBackups = result.backups;
      context = source;
      if (!report.catalogs.some(value => value.kind === catalog.value))
        catalog.value = report.catalogs[0]?.kind ?? "pixel";
      setUiText(status, "Review references and backup cost before selecting revisions.");
      render();
    }
    catch (error) {
      if (disposed || serial !== token) return;
      const current = () => source === options.context() && host.project === options.host()?.project;
      if (!current()) { setUiText(status, "Workspace changed. Analyze cleanup again."); return; }
      const problem = message(error);
      setUiText(status, uiMessage("Cleanup analysis failed: {0}", problem));
      try {
        const recovery = readCleanupBackups(await host.invoke("list_placement_asset_cleanup_backups", {projectPath: host.project}));
        if (disposed || serial !== token) return;
        if (!current()) { setUiText(status, "Workspace changed. Analyze cleanup again."); return; }
        recoveryBackups = recovery;
        context = source;
        render();
        if (recovery.length) setUiText(status, uiMessage("Cleanup analysis failed: {0}. Recovery backups are still available.", problem));
      } catch (recoveryError) {
        if (!disposed && serial === token && current())
          setUiText(status, uiMessage("Cleanup analysis failed: {0}. Recovery backup lookup failed: {1}", problem, message(recoveryError)));
      }
    }
    finally {
      if (serial === token) {
        busy = undefined;
        controls();
      }
    }
  }
  async function write(backupId?: string) {
    if (busy || needsReload)
      return;
    sync();
    const host = options.host();
    if (!host || (!backupId && !report))
      return;
    let request: ReturnType<typeof cleanupSelection> | undefined;
    try {
      options.guard(true);
      if (!backupId && report) {
        protectedKeys = protectCleanupDocuments(report, options.documents());
        request = cleanupSelection(report, selected, protectedKeys);
      } else if (!recoveryBackups.some(value => value.id === backupId && !value.restored && !value.problem))
        throw Error("Invalid recovery backup");
    }
    catch (error) {
      setUiText(status, uiMessage(message(error)));
      return;
    }
    busy = "write";
    operationProject = host.project;
    controls();
    setUiText(status, backupId ? "Restoring verified originals…" : "Backing up and retiring revisions…");
    try {
      const result = readCleanupResult(await host.invoke(backupId ? "restore_placement_asset_cleanup" : "apply_placement_asset_cleanup", { projectPath: host.project, ...(backupId ? { backupId } : { request }) }));
      if (disposed)
        return;
      setUiText(status, uiMessage("Operation completed · Backup {0} · {1} files retired. Reopen the project to refresh catalogs.", result.backupPath, result.removedFiles));
    }
    catch (error) {
      if (!disposed)
        setUiText(status, uiMessage("Catalog operation failed: {0}. Reopen the project before retrying.", message(error)));
    }
    finally {
      if (!disposed) {
        busy = undefined;
        needsReload = true;
        controls();
        reopen.focus();
      }
    }
  }
  open.addEventListener("click", () => { if (!options.host() || busy || disposed)
    return; setUiText(scope, uiMessage("Project · {0}", options.host()!.project)); dialog.showModal(); sync(); scan.focus(); });
  function dismiss() {
    if (busy === "write" || needsReload) return;
    if (busy === "scan") {
      serial++;
      busy = undefined;
      report = undefined;
      recoveryBackups = [];
      selected.clear();
      setUiText(status, "Analysis canceled. No files changed.");
      render();
    }
    dialog.close();
  }
  close.addEventListener("click", dismiss);
  dialog.addEventListener("cancel", event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener("close", () => open.focus({ preventScroll: true }));
  catalog.addEventListener("change", () => { selected.clear(); render(); });
  scan.addEventListener("click", () => void analyze());
  apply.addEventListener("click", () => void write());
  reopen.addEventListener("click", () => { if (needsReload && !busy)
    try {
      options.reopen(operationProject);
    }
    catch (error) {
      setUiText(status, uiMessage(message(error)));
    } });
  exportPlan.addEventListener("click", () => {
    sync();
    if (!report || busy || needsReload)
      return;
    const payload = { ...report, protectedKeys, selected: [...selected].sort(), scope: "Managed catalogs and public JSON; dynamic code and GLB contents excluded" };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ferrum-asset-cleanup-plan.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  const destroy = () => { disposed = true; serial++; dialog.remove(); element.remove(); };
  render();
  return { element, sync, destroy, writing: () => busy === "write" };
}
