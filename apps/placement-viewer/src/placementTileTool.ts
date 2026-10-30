import { installPlacementCatalogTools } from "./placementCatalogTools";
import { createPlacementImportDiagnostic, installPlacementImportDiagnostics } from "./placementImportDiagnostics";
import { tileMapPlacementPatch } from "./placementTileMap";
import {
  setUiAttribute,
  setUiText,
  type UiContent,
  uiMessage,
  uiText,
} from "./placementLocale";

import { resolveTileDependencies, tileJson } from "./placementTileDependencies";
import {
  readTileSourceChoices,
  tileSourceChoices,
  type PlacementTileSourceChoice,
} from "./placementTileSelection";
import type { FerrumRuntime } from "@ferrum2d/ferrum-web/core";
import type {
  SceneAuthoringDocumentSpec,
  ScenePlacementViewer,
  ScenePlacementPatch,
} from "@ferrum2d/ferrum-web/authoring";
import { createPlacementPanelTabs } from "./placementPanelTabs";
import { canUsePlacementAsset } from "./placementAssetScope";
import {
  createPlacementTileAssets,
  readPlacementTileProject,
  type PlacementTileProjectHost,
} from "./placementTileProject";
import {
  inspectTileAsset,
  tileComponentPatch,
  tileProviderAsset,
  tileEvidence,
  tileBundle,
  tileAssetReferenced,
  type PlacementTileAsset,
  type TileSourceKind,
} from "./placementTileAssets";

interface Draft {
  name: string;
  kind: TileSourceKind;
  levelIndex: number;
  tilesetKey?: string;
  choices: PlacementTileSourceChoice[];
  json?: File;
  dependencies?: File[];
  png?: File;
  candidate?: PlacementTileAsset;
  mapOptions?: string;
  dirty: boolean;
  status: UiContent;
  importFailure?: ReturnType<typeof createPlacementImportDiagnostic>;
}
export function createPlacementTileTool(options: {
  engine: FerrumRuntime["engine"];
  viewer: ScenePlacementViewer;
  context(): {
    key: string;
    project?: string;
    document: SceneAuthoringDocumentSpec;
    mode: string;
    canEdit: boolean;
  };
  taken(id: string): boolean;
  retainsAsset?(id: string): boolean;
  assets?: ReturnType<typeof createPlacementTileAssets>;
  projectHost?(): PlacementTileProjectHost | undefined;
  saveScene?(): Promise<void>;
  changed(): void;
  apply(patch: ScenePlacementPatch, label: string): void;
}) {
  const assets =
      options.assets ??
      createPlacementTileAssets(options.engine, options.taken),
    drafts = new Map<string, Draft>();
  const element = document.createElement("details"),
    summary = document.createElement("summary"),
    body = document.createElement("div"),
    actions = document.createElement("div");
  element.className = "placement-normal-tool placement-tile-tool";
  element.dataset.placementTileTool = "true";
  setUiText(summary, "Import Tile Frames");
  actions.className = "placement-normal-actions";
  const button = (label: string, action: string) => {
    const el = document.createElement("button");
    el.type = "button";
    setUiText(el, label);
    el.dataset.tileAction = action;
    actions.append(el);
    return el;
  };
  const inspect = button("Inspect", "inspect"),
    register = button("Register", "register"),
    apply = button("Apply Frame", "apply"),
    reimport = button("Reimport", "reimport"),
    map = button("Apply Map", "map"),
    save = button("Save Project", "save"),
    cancel = button("Cancel", "cancel"),
    exportButton = button("Export Assets", "export");
  const status = document.createElement("output"),
    hint = document.createElement("p"),
    info = document.createElement("output"),
    diff = document.createElement("output");
  status.dataset.tileStatus = "true";
  status.setAttribute("aria-live", "polite");
  setUiText(
    hint,
    "Select a tileset and its PNG; other tiles are excluded from the converted map. Save Project or Export Assets preserves the original source. For external Tiled tilesets, choose all referenced TSJ files; filenames must match the source paths.",
  );
  info.dataset.tileInfo = "true";
  diff.dataset.tileDiff = "true";
  const tabs = createPlacementPanelTabs("Tile Import", [
      ["source", "Source"],
      ["preview", "Preview"],
    ] as const),
    source = tabs.panels.get("source")!,
    preview = tabs.panels.get("preview")!;
  const mapOptions = document.createElement("textarea");
  mapOptions.rows=3;mapOptions.value="{}";
  const format = document.createElement("select"),
    name = document.createElement("input"),
    level = document.createElement("input"),
    tileset = document.createElement("select"),
    json = document.createElement("input"),
    png = document.createElement("input"),
    dependencies = document.createElement("input"),
    frame = document.createElement("select");
  for (const value of ["tiled", "ldtk"]) {
    const option = document.createElement("option");
    option.value = value;
    setUiText(option, value === "tiled" ? "Tiled" : "LDtk");
    format.append(option);
  }
  name.type = "text";
  name.maxLength = 48;
  level.type = "number";
  level.min = "0";
  level.max = "63";
  level.step = "1";
  json.type = png.type = dependencies.type = "file";
  dependencies.accept = ".tsj";
  dependencies.multiple = true;
  json.accept = ".json,.tmj,.ldtk";
  png.accept = ".png";
  const field = (label: string, input: HTMLElement, parent: HTMLElement) => {
    const el = document.createElement("label");
    setUiAttribute(input, "aria-label", label);
    el.append(uiText(label), input);
    parent.append(el);
  };
  field("Tile source format", format, source);
  field("Tile asset name", name, source);
  field("LDtk level index", level, source);
  field("Tile JSON", json, source);
  const mapSettings=document.createElement("details"),mapSummary=document.createElement("summary");
  setUiText(mapSummary,"Map Options");mapSettings.append(mapSummary);
  field("Map placement options (JSON)",mapOptions,mapSettings);source.append(mapSettings);
  field("External TSJ Files", dependencies, source);
  field("Tileset", tileset, source);
  field("Tileset PNG", png, source);
  source.append(info);
  field("Tile frame", frame, preview);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 160;
  canvas.className = "placement-aseprite-preview";
  setUiAttribute(canvas, "aria-label", "Tile frame preview");
  preview.append(canvas, diff);
  body.append(actions, status, hint, tabs.element);
  element.append(summary, body);
  let key = "",
    mode = "",
    serial = 0,
    busy = false,
    disposed = false,
    controller: AbortController | undefined,
    previewSerial = 0,
    commitInFlight: Promise<void> | undefined;
  const draft = () => drafts.get(key)!;
  const catalog = installPlacementCatalogTools({
    root: body, store: assets,
    canEdit: () => !disposed && !busy && options.context().canEdit,
    retains: id => (options.retainsAsset?.(id) ?? true) || [...drafts.values()].some(d => d.candidate?.id === id),
    changed: options.changed,
  });
  const importDiagnostics = installPlacementImportDiagnostics(body, "tile");

  const registered = () =>
    assets.entries().filter((a) => canUsePlacementAsset(a, key, options.context().project) && a.uploaded);
  const plan = (next: PlacementTileAsset, selected: boolean) =>
    tileComponentPatch(
      options.context().document,
      options.viewer.state(),
      registered(),
      next,
      selected
        ? {
            instance: options.viewer.state().selectedInstanceId ?? "",
            frame: frame.value,
          }
        : undefined,
    );
  const planMap = (next: PlacementTileAsset) => {
    if(options.context().mode!=="2d")throw Error("Whole map placement requires 2D mode");
    return tileMapPlacementPatch(options.context().document, options.viewer.state(),next,JSON.parse(draft().mapOptions??"{}"),registered());
  };
  mapOptions.addEventListener("input",()=>{draft().mapOptions=mapOptions.value;render();});
  function stop(message = "Cancelled") {
    serial++;
    controller?.abort();
    controller = undefined;
    if (busy && drafts.has(key)) draft().status = uiMessage(message);
    busy = false;
  }
  const alive = (token: number) =>
    !disposed && token === serial && key === options.context().key;
  function render() {
    if (disposed || !drafts.has(key)) return;
    const d = draft(),
      context = options.context(),
      valid = !!d.candidate && !d.dirty;
    inspect.disabled =
      busy ||
      !d.json ||
      !d.png ||
      !d.tilesetKey ||
      !d.choices.length ||
      !context.canEdit;
    register.disabled = busy || !valid || !context.canEdit;
    name.disabled = format.disabled = json.disabled = png.disabled = busy;
    level.disabled = busy || d.kind !== "ldtk";
    dependencies.disabled = busy || d.kind !== "tiled";
    tileset.disabled = busy || d.choices.length < 2;
    frame.disabled = busy || !valid;
    mapOptions.disabled=busy||!context.canEdit;
    let mapError="Inspect a map";
    if(valid)try{planMap(d.candidate!);mapError="";}catch(error){mapError=String(error);}
    map.disabled=busy||!valid||!context.canEdit||!!mapError;setUiAttribute(map,"title",mapError||"Replace the imported map as one Undo transaction");
    cancel.disabled = !busy;
    exportButton.disabled = busy || !registered().length;
    save.disabled =
      busy ||
      !registered().length ||
      !context.canEdit ||
      !options.projectHost?.() ||
      !options.saveScene;
    setUiAttribute(
      save,
      "title",
      options.projectHost?.()
        ? "Save original tile sources and scene"
        : "Open the project in the desktop host to save tile sources",
    );
    catalog.sync();
    let reimportCause: unknown;
    let applyError = "Inspect an atlas",
      reimportError = applyError;
    if (valid) {
      try {
        plan(d.candidate!, true);
        applyError = "";
      } catch (error) {
        applyError = error instanceof Error ? error.message : String(error);
      }
      try {
        plan(d.candidate!, false);
        reimportError = "";
      } catch (error) {
        reimportError = error instanceof Error ? error.message : String(error);
        reimportCause = error;
      }
    }
    importDiagnostics.update(reimportCause && d.candidate ? [createPlacementImportDiagnostic(reimportCause, {
      document: key, scene: context.document, sourceFile: d.candidate.jsonName,
      assetId: registered().find(a => a.name === d.candidate!.name && a.id !== d.candidate!.id)?.id,
    })] : d.importFailure ? [d.importFailure] : []);
    apply.disabled = busy || !valid || !context.canEdit || !!applyError;
    reimport.disabled = busy || !valid || !context.canEdit || !!reimportError;
    setUiAttribute(
      apply,
      "title",
      applyError || "Apply selected static tile frame",
    );
    setUiAttribute(
      reimport,
      "title",
      reimportError || "Migrate references in the active fragment",
    );
    setUiText(status, d.status);
    setUiText(
      info,
      uiMessage(
        "{0} · {1}{2}",
        d.json?.name ?? uiMessage("Choose JSON"),
        d.png?.name ?? uiMessage("Choose PNG"),
        d.candidate
          ? uiMessage(
              " · {0} frames · {1} layers{2} · {3} · {4}",
              d.candidate.frames.length,
              d.candidate.imported.layerNames.length,
              d.candidate.selection
                ? uiMessage(
                    " · {0} of {1} tilesets · {2} other tiles excluded",
                    d.candidate.selection.name,
                    d.candidate.selection.sourceTilesets,
                    d.candidate.selection.omittedTileInstances,
                  )
                : uiMessage(""),
              (d.candidate.dependencies ?? [])
                .map((f) => `${f.source} ← ${f.name}`)
                .join(", ") || "embedded",
              d.candidate?.persisted
                ? uiMessage("project assets")
                : uiMessage("session assets"),
            )
          : uiMessage(""),
      ),
    );
    element.dataset.tileBusy = String(busy);
    element.dataset.tileReady = String(valid);
  }
  async function draw() {
    const token = ++previewSerial,
      d = draft(),
      candidate = d.candidate,
      selected = candidate?.frames.find((f) => f.id === frame.value),
      context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, 160, 160);
    if (!candidate || !selected) return;
    const bitmap = await createImageBitmap(
      new Blob([candidate.png], { type: "image/png" }),
    );
    try {
      if (
        token !== previewSerial ||
        disposed ||
        candidate !== draft()?.candidate
      )
        return;
      const scale = Math.min(144 / selected.width, 144 / selected.height);
      context.imageSmoothingEnabled = false;
      context.drawImage(
        bitmap,
        selected.uv.u0 * candidate.width,
        selected.uv.v0 * candidate.height,
        selected.width,
        selected.height,
        (160 - selected.width * scale) / 2,
        (160 - selected.height * scale) / 2,
        selected.width * scale,
        selected.height * scale,
      );
    } finally {
      bitmap.close();
    }
  }
  function fields() {
    const d = draft(),
      selected = frame.value;
    if(d.mapOptions===undefined&&d.candidate){
      const saved=options.context().document.sceneComposition.fragments?.[options.viewer.state().fragment]?.instances?.find(i=>{
        const m=i.props?.tileMapImport as {name?:string;options?:unknown}|undefined;return m?.name===d.name&&m.options!==undefined;
      })?.props?.tileMapImport as {options?:unknown}|undefined;
      if(saved?.options)d.mapOptions=JSON.stringify(saved.options);
    }
    mapOptions.value=d.mapOptions??"{}";
    name.value = d.name;
    format.value = d.kind;
    level.value = String(d.levelIndex);
    tileset.replaceChildren();
    for (const choice of d.choices) {
      const option = document.createElement("option");
      option.value = choice.key;
      option.textContent = `${choice.name} · ${choice.image.split(/[\\/]/u).at(-1)}`;
      tileset.append(option);
    }
    tileset.value = d.tilesetKey ?? "";
    frame.replaceChildren();
    for (const item of d.candidate?.frames ?? []) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.id;
      frame.append(option);
    }
    if ([...frame.options].some((o) => o.value === selected))
      frame.value = selected;
    const old = registered()
        .filter(
          (a) =>
            a.name === d.name && a.kind === d.kind && a.id !== d.candidate?.id,
        )
        .at(-1),
      next = d.candidate;
    if (next) {
      const added = next.frames.filter(
          (f) => !old?.frames.some((o) => o.id === f.id),
        ),
        removed =
          old?.frames.filter((f) => !next.frames.some((o) => o.id === f.id)) ??
          [],
        changed = next.frames.filter((f) => {
          const prior = old?.frames.find((o) => o.id === f.id);
          return prior && JSON.stringify(prior) !== JSON.stringify(f);
        });
      setUiText(
        diff,
        uiMessage(
          "{0} added · {1} changed · {2} removed · {3}",
          added.length,
          changed.length,
          removed.length,
          old?.pngSha256 === next.pngSha256
            ? uiMessage("PNG unchanged")
            : uiMessage("PNG changed"),
        ),
      );
    } else setUiText(diff, "");
    void draw().catch((error) => {
      if (!disposed && drafts.has(key)) {
        draft().status = String(error);
        render();
      }
    });
    render();
  }
  function dirty() {
    stop();
    const d = draft();
    d.name = name.value;
    d.kind = format.value === "ldtk" ? "ldtk" : "tiled";
    d.levelIndex = level.valueAsNumber;
    d.dirty = true;
    d.status = uiMessage("Source changed · Inspect again");
    render();
  }
  json.addEventListener("change", () => {
    draft().json = json.files?.[0];
    dirty();
    void refreshChoices();
  });
  dependencies.addEventListener("change", () => {
    draft().dependencies = [...(dependencies.files ?? [])];
    dirty();
    void refreshChoices();
  });
  png.addEventListener("change", () => {
    draft().png = png.files?.[0];
    dirty();
    // A file picker may finish while source metadata is still being read.
    if (draft().json && !draft().choices.length) void refreshChoices();
  });
  async function refreshChoices() {
    const d = draft(),
      previous = d.tilesetKey;
    stop();
    const token = serial;
    controller = new AbortController();
    busy = true;
    d.choices = [];
    d.status = uiMessage("Reading tilesets…");
    fields();
    try {
      if (!d.json) return;
      const choices = await readTileSourceChoices(
        d.json,
        d.kind,
        controller.signal,
        d.dependencies,
      );
      if (!alive(token)) return;
      d.choices = choices;
      d.tilesetKey =
        choices.find((c) => c.key === previous)?.key ?? choices[0]?.key;
      d.status = uiMessage("Choose a tileset and PNG · Inspect to continue");
    } catch (error) {
      if (alive(token))
        d.status = uiMessage(
          "Tileset list failed. {0}",
          error instanceof Error ? error.message : String(error),
        );
    } finally {
      if (alive(token)) {
        busy = false;
        fields();
      }
    }
  }
  format.addEventListener("change", () => {
    draft().dependencies = [];
    dependencies.value = "";
    dirty();
    void refreshChoices();
  });
  tileset.addEventListener("change", () => {
    draft().tilesetKey = tileset.value;
    dirty();
  });
  for (const field of [name, level])
    field.addEventListener("change", () => {
      dirty();
      // A late blur event must not leave an interrupted metadata read without choices.
      if (draft().json && !draft().choices.length) void refreshChoices();
    });
  name.addEventListener("input", () => {
    if (!busy && drafts.has(key)) {
      draft().name = name.value;
      draft().dirty = true;
      render();
    }
  });
  frame.addEventListener("change", () => {
    void draw().catch(() => {});
    render();
  });
  inspect.addEventListener("click", async () => {
    if (inspect.disabled) return;
    const d = draft();
    stop();
    const token = serial;
    controller = new AbortController();
    const signal = controller.signal;
    busy = true;
    d.importFailure = undefined;
        d.status = uiMessage("Inspecting tile source…");
    render();
    try {
      await commitInFlight?.catch(() => {});
      signal.throwIfAborted();
      const next = await inspectTileAsset(
        key,
        d.name,
        d.kind,
        d.levelIndex,
        d.json!,
        d.png!,
        signal,
        d.tilesetKey,
        d.dependencies,
      );
      if (!alive(token)) return;
      // Keep the accepted candidate when a replacement fails budget/validation.
      const candidate = assets.adopt(next),
        old = d.candidate;
      d.candidate = candidate;
      d.dirty = false;
      d.status = uiMessage("Inspected · Register or apply a frame");
      if (old && old !== candidate && !old.uploaded) assets.discard(old);
      options.changed();
    } catch (error) {
      if (alive(token)) {
        d.importFailure = createPlacementImportDiagnostic(error, { document: key, sourceFile: d.json?.name ?? "", scene: options.context().document, assetId: d.candidate?.id });
        d.status = uiMessage(
          "Inspect failed. {0}",
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      if (alive(token)) {
        busy = false;
        fields();
      }
    }
  });
  function commit(kind: "register" | "apply" | "reimport" | "map") {
    if ({ register, apply, reimport, map }[kind].disabled) return;
    const previous = commitInFlight;
    const task = (async () => {
      const d = draft(),
        candidate = d.candidate!,
        context = options.context(),
        signature = JSON.stringify(context.document),
        selected = options.viewer.state().selectedInstanceId;
      stop();
      const token = serial;
      controller = new AbortController();
      const signal = controller.signal;
      busy = true;
      d.status = uiMessage("Uploading tileset…");
      render();
      const wasUploaded = candidate.uploaded;
      let url: string | undefined,
        committed = false;
      try {
        await previous?.catch(() => {});
        signal.throwIfAborted();
        if (kind === "map")planMap(candidate);
        else if (kind !== "register") plan(candidate, kind === "apply");
        url = await assets.upload(candidate, signal);
        if (!alive(token)) return;
        if (
          !options.context().canEdit ||
          signature !== JSON.stringify(options.context().document) ||
          (kind === "apply" &&
            selected !== options.viewer.state().selectedInstanceId)
        )
          throw Error("Document or selection changed. Apply again.");
        if (kind !== "register")
          options.apply(
            kind === "map"?planMap(candidate):plan(candidate, kind === "apply"),
            kind === "map"?"Apply Tile Map":kind === "apply" ? "Apply Tile Frame" : "Reimport Tile Frames",
          );
        committed = true;
        d.status =
          kind === "register"
            ? uiMessage("Registered · Scene unchanged")
            : uiMessage("Applied · One Undo restores previous tile frames");
        options.changed();
        fields();
      } catch (error) {
        if (alive(token)) {
          d.status = uiMessage(
            "Apply failed. {0}",
            error instanceof Error ? error.message : String(error),
          );
          options.changed();
        }
      } finally {
        if (!wasUploaded && url && !committed) assets.release(candidate, url);
        if (alive(token)) {
          busy = false;
          render();
        }
      }
    })();
    commitInFlight = task;
    void task.finally(() => {
      if (commitInFlight === task) commitInFlight = undefined;
    });
  }
  for (const kind of ["register", "apply", "reimport", "map"] as const)
    ({ register, apply, reimport, map })[kind].addEventListener("click", () =>
      commit(kind),
    );
  cancel.addEventListener("click", () => {
    stop();
    render();
  });
  exportButton.addEventListener("click", () => {
    if (exportButton.disabled) return;
    const bundle = {
      ...tileBundle(key, registered()),
      sceneDocument: structuredClone(options.context().document),
      patch: options.viewer.exportPatch(),
    };
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(bundle, null, 2) + "\n"], {
          type: "application/json",
        }),
      ),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "tile-assets.json";
    anchor.click();
    URL.revokeObjectURL(url);
    draft().status = uiMessage(
      "Exported · Install the catalog and scene patch before reopening",
    );
    render();
  });
  save.addEventListener(
    "click",
    () =>
      void (async () => {
        const host = options.projectHost?.();
        if (save.disabled || !host) return;
        const d = draft(),
          context = options.context(),
          signature = JSON.stringify(context.document),
          candidates = registered();
        stop();
        const token = serial;
        controller = new AbortController();
        const signal = controller.signal;
        busy = true;
        d.status = uiMessage("Saving project assets…");
        render();
        try {
          const saved = await readPlacementTileProject(
            await host.save(tileBundle(key, candidates), signal),
            key,
            host.project,
            signal,
          );
          if (!alive(token) || host !== options.projectHost?.()) return;
          for (const asset of candidates) {
            if (
              !saved.some(
                (a) =>
                  a.id === asset.id &&
                  a.jsonSha256 === asset.jsonSha256 &&
                  a.pngSha256 === asset.pngSha256,
              )
            )
              throw Error("Project host did not register all tile sources");
          }
          for (const asset of candidates) {
            asset.persisted = true;
            asset.project = host.project;
          }
          options.changed();
          if (
            signature !== JSON.stringify(options.context().document) ||
            !options.context().canEdit
          )
            throw Error("Assets saved. Scene changed; save the project again.");
          d.status = uiMessage("Assets saved · Saving scene…");
          render();
          await options.saveScene!();
          if (alive(token))
            d.status = uiMessage("Project saved · Original sources preserved");
        } catch (error) {
          if (alive(token))
            d.status = uiMessage(
              "Project save failed. {0}",
              error instanceof Error ? error.message : String(error),
            );
        } finally {
          if (alive(token)) {
            busy = false;
            render();
          }
        }
      })(),
  );
  function sync() {
    if (disposed) return;
    const context = options.context();
    if (key !== context.key) {
      stop("Cancelled · Document changed");
      previewSerial++;
      key = context.key;
      if (!drafts.has(key)) {
        const restored = registered().at(-1);
        const choices = restored
          ? tileSourceChoices(
              resolveTileDependencies(
                tileJson(restored.json),
                restored.kind,
                restored.dependencies ?? [],
              ).input,
              restored.kind,
            )
          : [];
        drafts.set(
          key,
          restored
            ? {
                name: restored.name,
                kind: restored.kind,
                levelIndex: restored.levelIndex,
                choices,
                tilesetKey: restored.selection?.key ?? choices[0]?.key,
                json: new File([restored.json], restored.jsonName),
                dependencies: (restored.dependencies ?? []).map(
                  (d) => new File([d.json], d.name),
                ),
                png: new File([restored.png], restored.pngName),
                candidate: restored,
                dirty: false,
                status: uiMessage("Project tile sources restored"),
              }
            : {
                name: "tiles",
                kind: "tiled",
                levelIndex: 0,
                choices: [],
                dirty: true,
                status: uiMessage("Choose a Tiled/LDtk JSON and tileset PNG"),
              },
        );
      }
      json.value = png.value = dependencies.value = "";
      fields();
    }
    if (mode !== context.mode) {
      stop("Cancelled · Workspace changed");
      mode = context.mode;
    }
    render();
  }
  function destroy() {
    if (disposed) return;
    stop();
    disposed = true;
    importDiagnostics.clear();
    previewSerial++;
    assets.destroy();
    drafts.clear();
    window.removeEventListener("pagehide", pagehide, true);
    window.removeEventListener("pageshow", sync);
  }
  function pagehide(event: PageTransitionEvent) {
    if (event.persisted) {
      stop();
      render();
    } else destroy();
  }
  window.addEventListener("pagehide", pagehide, true);
  window.addEventListener("pageshow", sync);
  sync();
  return {
    element,
    sync,
    destroy,
    has: (id: string) => assets.entries().some((a) => a.id === id),
    close(document: string) {
      if (document === key) {
        stop();
        previewSerial++;
      }
      drafts.delete(document);
      assets.close(document);
    },
    providerAssets: () =>
      assets
        .entries()
        .filter((a) => canUsePlacementAsset(a, options.context().key, options.context().project) && a.uploaded)
        .reverse()
        .map(tileProviderAsset),
    evidence: (document: SceneAuthoringDocumentSpec) =>
      assets
        .entries()
        .filter(
          (a) =>
            canUsePlacementAsset(a, options.context().key, options.context().project) &&
            a.uploaded &&
            tileAssetReferenced(document, a),
        )
        .map(tileEvidence),
    blocksSave: (document: SceneAuthoringDocumentSpec) =>
      assets
        .entries()
        .some(
          (a) =>
            (!canUsePlacementAsset(a, options.context().key, options.context().project) || !a.persisted) &&
            tileAssetReferenced(document, a),
        ),
    assertDocumentAssets(
      document: SceneAuthoringDocumentSpec,
      documentKey: string,
      project?: string,
    ) {
      if (
        assets
          .entries()
          .some(
            (a) =>
              !canUsePlacementAsset(a, documentKey, project) && tileAssetReferenced(document, a),
          )
      )
        throw Error(
          "Install imported tile assets before copying them to another document",
        );
    },
  };
}
