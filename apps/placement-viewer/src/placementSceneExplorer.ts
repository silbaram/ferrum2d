import { createPlacementPanelTabs } from "./placementPanelTabs";
import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
import type { PlacementSceneCatalog, PlacementSceneEntry } from "./placementSceneCatalog";

interface OpenScene { source: string; key: string; dirty: boolean }
export function createPlacementSceneExplorer(options: {
  load(): Promise<PlacementSceneCatalog | undefined>;
  chooseFolder(): Promise<PlacementSceneCatalog | undefined>;
  open(entry: PlacementSceneEntry, run: boolean): Promise<void>;
  match(entry: PlacementSceneEntry, doc: OpenScene): boolean;
}) {
  const element = document.createElement("section");
  element.className = "placement-scene-explorer";
  const actions = document.createElement("div"), label = document.createElement("div"),
    search = document.createElement("input"), list = document.createElement("div"),
    status = document.createElement("p"), footer = document.createElement("div");
  actions.className = footer.className = "placement-scene-explorer-actions";
  label.className = "placement-scene-explorer-root";
  search.type = "search";
  search.dataset.placementSceneSearch = "true";
  setUiAttribute(search, "aria-label", "Search project scenes");
  setUiAttribute(search, "placeholder", "Search project scenes");
  list.className = "placement-scene-explorer-list";
  list.setAttribute("role", "listbox");
  setUiAttribute(list, "aria-label", "Project scenes");
  status.className = "placement-scene-explorer-status";
  status.setAttribute("role", "status");
  function button(title: string, action: string, click: () => void) {
    const button = document.createElement("button"); button.type = "button";
    setUiText(button, title); button.dataset.placementSceneAction = action;
    button.addEventListener("click", click); return button;
  }
  const choose = button("Choose folder", "choose", () => void load(true)),
    refresh = button("Refresh", "refresh", () => void load()),
    open = button("Open", "open", () => void openSelected(false)),
    run = button("Run scene", "run", () => void openSelected(true));
  actions.append(choose, refresh); footer.append(open, run);
  const hint = document.createElement("p"); hint.className = "placement-scene-explorer-hint";
  setUiText(hint, "Double-click or Enter to open. Run scene plays the selected Scene Authoring document.");
  element.append(actions, label, search, list, status, footer, hint);
  let catalog: PlacementSceneCatalog | undefined, selected: string | undefined, loading = false,
    busy = false, version = 0, loaded = false, tab: "objects" | "project" = "objects",
    documents: readonly OpenScene[] = [], activeKey = "", mounted: HTMLElement | undefined;
  let currentTabs: ReturnType<typeof createPlacementPanelTabs<"objects" | "project">> | undefined;
  const wrappers = new WeakMap<HTMLElement, ReturnType<typeof createPlacementPanelTabs<"objects" | "project">>>();
  let message: unknown, signature = "";
  function visible() {
    const query = search.value.trim().toLocaleLowerCase();
    return catalog?.scenes.filter(entry => entry.relativePath.toLocaleLowerCase().includes(query)) ?? [];
  }
  function controls() {
    const entry = catalog?.scenes.find(entry => entry.id === selected);
    const warning = catalog?.diagnostics?.[0];
    status.title = catalog?.diagnostics?.map(item => `${item.relativePath}: ${item.code}`).join("\n") ?? "";
    choose.disabled = refresh.disabled = loading || busy;
    open.disabled = run.disabled = loading || busy || !entry || entry.mode === "invalid";
    element.setAttribute("aria-busy", String(loading || busy));
    if (message) setUiText(status, message instanceof Error ? message.message : String(message));
    else setUiText(status, loading ? "Loading scenes…" : !catalog ? "Choose a project folder or refresh the scene list." :
      entry?.mode === "invalid" ? uiMessage("Cannot open this scene: {0}", entry.diagnostic ?? "Invalid document") :
      warning ? uiMessage("{0} scenes · Could not read {1} ({2})", visible().length, warning.relativePath, warning.code) :
      catalog.truncated ? "Scene scan reached its limit. Some files are not listed." : visible().length ?
      uiMessage("{0} of {1} scenes", visible().length, catalog.scenes.length) : "No Scene Authoring documents found.");
  }
  function render() {
    setUiText(label, catalog?.hosted ? uiMessage("Provided scenes · {0}", catalog.label) : uiMessage("{0}", catalog?.label ?? ""));
    label.title = catalog?.label ?? "";
    list.replaceChildren();
    const entries = visible();
    if (!entries.some(entry => entry.id === selected)) selected = entries[0]?.id;
    let folder = "";
    for (const entry of entries) {
      const parent = entry.relativePath.split("/").slice(0, -1).join("/");
      if (parent !== folder) {
        folder = parent;
        const heading = document.createElement("div"); heading.className = "placement-scene-folder";
        heading.textContent = folder; list.append(heading);
      }
      const row = document.createElement("button"); row.type = "button";
      row.className = "placement-project-scene"; row.dataset.placementProjectScene = entry.id;
      row.setAttribute("role", "option"); row.setAttribute("aria-selected", String(entry.id === selected));
      row.dataset.invalid = String(entry.mode === "invalid");
      row.tabIndex = entry.id === selected ? 0 : -1;
      row.title = entry.relativePath + (entry.diagnostic ? `\n${entry.diagnostic}` : "");
      const name = document.createElement("span"), meta = document.createElement("span"), badge = document.createElement("span");
      name.textContent = entry.relativePath.split("/").pop()!;
      const doc = documents.find(doc => options.match(entry, doc));
      meta.textContent = entry.mode === "hd2d" ? "HD-2D" : entry.mode === "2d" ? "2D" : "!";
      if (doc) setUiText(badge, doc.dirty ? "Modified" : doc.key === activeKey ? "Current" : "Open");
      row.dataset.active = String(doc?.key === activeKey);
      row.append(name, meta, badge);
      row.addEventListener("click", () => { selected = entry.id; selectRow(); });
      row.addEventListener("dblclick", () => { selected = entry.id; void openSelected(false); });
      row.addEventListener("keydown", event => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          const index = entries.findIndex(e => e.id === selected);
          selected = entries[event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 :
            (index + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length]?.id;
          selectRow(true);
        } else if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void openSelected(false); }
      });
      list.append(row);
    }
    setUiText(hint, catalog?.folderSnapshot ? "Folder files are read-only snapshots. Refresh reselects the folder. Assets must already be available to the viewer." :
      "Double-click or Enter to open. Run scene plays the selected Scene Authoring document.");
    controls();
  }
  function selectRow(focus = false) {
    for (const row of list.querySelectorAll<HTMLButtonElement>("[data-placement-project-scene]")) {
      const isSelected = row.dataset.placementProjectScene === selected;
      row.setAttribute("aria-selected", String(isSelected)); row.tabIndex = isSelected ? 0 : -1;
      if (isSelected && focus) row.focus({ preventScroll: false });
    }
    controls();
  }
  async function load(chooseFolder = false) {
    const token = ++version; loading = true; message = undefined; render();
    try {
      const result = await (chooseFolder ? options.chooseFolder() : options.load());
      if (token !== version) return;
      if (result) { catalog = result; loaded = true; }
    } catch (error) { if (token === version) { catalog = undefined; message = error; loaded = false; } }
    finally { if (token === version) { loading = false; render(); } }
  }
  async function openSelected(play: boolean) {
    const entry = catalog?.scenes.find(entry => entry.id === selected);
    if (!entry || entry.mode === "invalid" || busy || loading) return;
    busy = true; message = undefined; controls();
    try { await options.open(entry, play); }
    catch (error) { message = error; }
    finally { busy = false; render(); }
  }
  search.addEventListener("input", render);
  function show() {
    tab = "project"; currentTabs?.select("project");
    if (!loaded && !loading) void load();
  }
  return {
    element, show,
    invalidate() { version++; loading = false; loaded = false; catalog = undefined; message = undefined; if (tab === "project") void load(); else render(); },
    sync(docs: readonly OpenScene[], active: string, dock: HTMLElement) {
      documents = docs; activeKey = active;
      const nextSignature = JSON.stringify([docs, active]);
      const changed = signature !== nextSignature || mounted !== dock;
      signature = nextSignature;
      if (mounted !== dock) {
        let tabs = wrappers.get(dock);
        if (!tabs) {
          tabs = createPlacementPanelTabs("Scene dock sections", [["objects", "Objects"], ["project", "Project scenes"]], key => {
            tab = key; if (key === "project" && !loaded && !loading) void load();
          });
          tabs.panels.get("objects")!.append(...dock.childNodes);
          dock.append(tabs.element); wrappers.set(dock, tabs);
        }
        mounted = dock; currentTabs = tabs;
        tabs.panels.get("project")!.append(element); tabs.select(tab, false, false);
      }
      if (changed) render();
    },
  };
}
