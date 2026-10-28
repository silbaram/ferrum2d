import { registerUiRoot, setUiText, uiMessage, type UiContent } from "./placementLocale";
import { compareUpdateVersions, fetchUpdateReleases, safeReleasePage } from "./placementReleaseVersions";
declare const __FERRUM_VIEWER_SOURCE_VERSION__: string;
type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
interface AppInfo { viewerVersion: string; bundledEngineVersion: string; repository: string; os: string; arch: string; configured: boolean; canInstall: boolean; reason?: string }
interface ProjectInfo { ok: boolean; projectPath: string; currentVersion: string; latestVersion?: string; available: boolean; manager: string; releaseUrl?: string }
interface PreparedUpdate { available: boolean; version?: string; token?: string }
export function createPlacementUpdates(options: {
  root: HTMLElement;
  invoke(): Invoke | undefined;
  projectPath(): string | undefined;
  guard(): void;
}) {
  const dialog = document.createElement("dialog"), heading = document.createElement("h2"), close = document.createElement("button"), check = document.createElement("button");
  dialog.className = "placement-updates"; dialog.dataset.placementUpdates = "true";
  heading.id = "placement-updates-title"; setUiText(heading, "Versions and updates"); dialog.setAttribute("aria-labelledby", heading.id);
  const toolbar = document.createElement("div"); toolbar.className = "placement-update-actions";
  close.type = check.type = "button"; setUiText(close, "Close"); setUiText(check, "Check updates");
  close.dataset.updateAction = "close"; check.dataset.updateAction = "check";
  toolbar.append(check, close); dialog.append(heading, toolbar);
  function section(title: string, id: string) {
    const element = document.createElement("section"), label = document.createElement("h3"), versions = document.createElement("p"), status = document.createElement("p"), action = document.createElement("button"), link = document.createElement("a");
    element.className = "placement-update-section"; element.dataset.updateSection = id;
    setUiText(label, title); status.setAttribute("role", "status");
    action.type = "button"; action.dataset.updateAction = id;
    setUiText(action, "Update"); setUiText(link, "Release notes"); link.target = "_blank"; link.rel = "noopener noreferrer"; link.hidden = true;
    link.addEventListener("click", event => {
      const invoke = options.invoke();
      if (!invoke) return;
      event.preventDefault();
      void invoke("open_placement_release_page", { url: safeReleasePage(link.href) }).catch(error => setUiText(status, uiMessage("Cannot open release page: {0}", errorMessage(error))));
    });
    const actions = document.createElement("div"); actions.className = "placement-update-actions"; actions.append(action, link);
    element.append(label, versions, status, actions); dialog.append(element);
    return { element, versions, status, action, link };
  }
  const editor = section("Editor app", "viewer"), project = section("Project engine", "project");
  const note = document.createElement("p"); note.className = "placement-update-note";
  setUiText(note, "Updates install published releases. A Git push is not a new release. Project checks and game migrations remain separate.");
  dialog.append(note); document.body.append(dialog); registerUiRoot(dialog);
  let active = false, busy = false, applying = false, priorInert = false, token = 0, controller: AbortController | undefined;
  let app: AppInfo | undefined, installed: ProjectInfo | undefined, prepared: PreparedUpdate | undefined;
  let sourceProject: string | undefined, restart = false;
  function controls() {
    check.disabled = busy; close.disabled = applying;
    editor.action.disabled = busy || (!restart && !prepared?.token);
    project.action.disabled = busy || !installed?.available;
    setUiText(editor.action, restart ? "Restart" : "Update");
    dialog.setAttribute("aria-busy", String(busy));
  }
  function status(target: typeof editor, message: UiContent) { setUiText(target.status, message); }
  function link(target: typeof editor, value?: string) {
    target.link.hidden = !value;
    if (value) target.link.href = safeReleasePage(value); else target.link.removeAttribute("href");
  }
  function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
  async function refresh() {
    if (busy) return;
    const serial = ++token; controller?.abort(); controller = new AbortController();
    const abort = controller;
    const timeout = setTimeout(() => abort.abort(), 35_000);
    const invoke = options.invoke(); sourceProject = options.projectPath();
    installed = undefined; prepared = undefined; busy = true; controls();
    status(editor, "Checking versions…"); status(project, sourceProject ?? "Open a project to check its engine version");
    link(editor); link(project);
    try {
      const results = await Promise.allSettled([
        (async () => {
          const info = invoke ? await invoke<AppInfo>("placement_update_info") : undefined;
          if (serial !== token || !active) return;
          if (info && (typeof info.viewerVersion !== "string" || typeof info.bundledEngineVersion !== "string" || typeof info.canInstall !== "boolean" || !["linux", "windows", "macos"].includes(info.os) || !["x64", "arm64", "unsupported"].includes(info.arch))) throw Error("Invalid editor update response");
          app = info;
          const bundled = app?.bundledEngineVersion ?? import.meta.env.VITE_FERRUM_RELEASE_VERSION ?? __FERRUM_VIEWER_SOURCE_VERSION__;
          setUiText(editor.versions, uiMessage("Current {0} · Embedded engine {1}", app?.viewerVersion ?? bundled, bundled));
          if (restart) { status(editor, "Editor updated. Restart to use the new version."); return; }
          const releases = await fetchUpdateReleases(abort.signal);
          if (serial !== token || !active) return;
          const latest = app ? releases.find(row => {
            const base = `ferrum2d-placement-viewer-${row.version}-${app!.os}-${app!.arch}`;
            const extension = app!.os === "linux" ? "deb" : app!.os === "windows" ? "exe" : "dmg";
            return row.assets.includes(`viewer-updater-${app!.os}-${app!.arch}.json`) || row.assets.includes(base + "." + extension) || (app!.os === "linux" && row.assets.includes(base + ".AppImage"));
          }) : releases[0];
          if (!latest) { status(editor, "No editor update has been published for this platform"); return; }
          link(editor, latest.pageUrl);
          if (!invoke || !app) { status(editor, "Browser builds update when the site is deployed. Use the desktop app for installation."); return; }
          setUiText(editor.versions, uiMessage("Current {0} · Latest {1} · Embedded engine {2}", app.viewerVersion, latest.version, bundled));
          if (compareUpdateVersions(latest.version, app.viewerVersion) <= 0) { status(editor, "No newer editor release is available"); return; }
          if (!app.canInstall) { status(editor, uiMessage("{0} · Install manually from the release page", uiMessage(app.reason ?? "Automatic updates are unavailable in this build"))); return; }
          if (!latest.assets.includes(`viewer-updater-${app.os}-${app.arch}.json`)) { status(editor, "Install manually from the release page. This release has no signed updater for this platform."); return; }
          const result = await invoke<PreparedUpdate>("check_placement_viewer_update", { version: latest.version });
          if (serial === token && active) {
            if (typeof result?.available !== "boolean" || (result.available && (result.version !== latest.version || typeof result.token !== "string" || !result.token))) throw Error("Invalid editor update response");
            prepared = result; status(editor, prepared.available ? "Update available · Signature is verified before installation" : "No newer editor release is available");
          }
        })(),
        (async () => {
          if (!invoke) { status(project, "Open a project in the desktop app to update its engine packages"); return; }
          if (!sourceProject) { status(project, "Open a project to check its engine version"); return; }
          const result = await invoke<ProjectInfo>("check_placement_project_update", { projectPath: sourceProject });
          if (serial !== token || !active) return;
          if (result?.ok !== true || result.projectPath !== sourceProject || typeof result.currentVersion !== "string" || typeof result.available !== "boolean" || !["npm", "pnpm"].includes(result.manager) ||
            (result.available && (typeof result.latestVersion !== "string" || compareUpdateVersions(result.latestVersion, result.currentVersion) <= 0))) throw Error("Invalid project update response");
          if (result.releaseUrl) safeReleasePage(result.releaseUrl);
          setUiText(project.versions, uiMessage("Current {0} · Latest {1}", result.currentVersion, result.latestVersion ?? "—"));
          link(project, result.releaseUrl);
          installed = result;
          status(project, result.available ? "Update available · Project metadata and lock file will be backed up" : "No newer engine release is available");
        })(),
      ]);
      if (serial !== token || !active) return;
      results.forEach((result, index) => { if (result.status === "rejected") status(index === 0 ? editor : project, uiMessage("Update check failed: {0}", uiMessage(errorMessage(result.reason)))); });
    } finally { clearTimeout(timeout); if (serial === token) { busy = false; controls(); } }
  }
  async function apply(kind: "viewer" | "project") {
    if (busy) return;
    const target = kind === "viewer" ? editor : project, invoke = options.invoke();
    if (!invoke) return;
    try { options.guard(); } catch (error) { status(target, uiMessage("Update blocked: {0}", uiMessage(errorMessage(error)))); return; }
    if (kind === "project" && (!installed?.available || sourceProject !== options.projectPath())) { status(project, "Project changed. Check updates again."); return; }
    if (kind === "viewer" && !restart && !prepared?.token) return;
    busy = applying = true; controls(); status(target, "Updating… Keep the application open.");
    let unlisten: (() => void) | undefined;
    try {
      if (kind === "viewer") {
        if (restart) await invoke("restart_placement_viewer_after_update");
        else {
          const events = (window as unknown as { __TAURI__?: { event?: { listen(name: string, listener: (event: { payload: { phase?: string; received?: number; total?: number } }) => void): Promise<() => void> } } }).__TAURI__?.event;
          if (events) unlisten = await events.listen("ferrum-update-progress", event => {
            if (!active || !applying) return;
            const value = event.payload;
            status(editor, value.phase === "install" ? "Installing… The application may close." : uiMessage("Downloading {0} / {1} KiB", Math.round((value.received ?? 0) / 1024), value.total ? Math.round(value.total / 1024) : "—"));
          });
          const result = await invoke<{ installed: boolean; restartRequired: boolean }>("apply_placement_viewer_update", { token: prepared!.token });
          if (result?.installed !== true || result.restartRequired !== true) throw Error("Invalid editor update response");
          prepared = undefined; restart = true; status(editor, "Editor updated. Restart to use the new version.");
        }
      } else {
        const result = await invoke<{ ok: boolean; version: string; backup: string }>("apply_placement_project_update", { projectPath: sourceProject, version: installed!.latestVersion, expectedVersion: installed!.currentVersion });
        if (result?.ok !== true || result.version !== installed!.latestVersion || typeof result.backup !== "string") throw Error("Invalid project update response");
        installed = { ...installed!, currentVersion: result.version, available: false };
        setUiText(project.versions, uiMessage("Current {0}", result.version));
        status(project, uiMessage("Engine updated. Run project checks before playing. Backup: {0}", result.backup));
      }
    } catch (error) { if (kind === "viewer" && !restart) prepared = undefined; status(target, uiMessage("Update failed: {0}", uiMessage(errorMessage(error)))); }
    finally { unlisten?.(); busy = applying = false; controls(); }
  }
  function hide() {
    if (applying) return;
    active = false; busy = false; token++; controller?.abort(); options.root.inert = priorInert; dialog.close();
  }
  close.addEventListener("click", hide); check.addEventListener("click", () => void refresh());
  editor.action.addEventListener("click", () => void apply("viewer")); project.action.addEventListener("click", () => void apply("project"));
  dialog.addEventListener("cancel", event => { event.preventDefault(); hide(); });
  window.addEventListener("beforeunload", event => { if (applying) { event.preventDefault(); event.returnValue = ""; } });
  controls();
  return {
    show() {
      if (active) return; active = true; priorInert = options.root.inert; options.root.inert = true;
      dialog.showModal();
      void refresh();
    },
  };
}
