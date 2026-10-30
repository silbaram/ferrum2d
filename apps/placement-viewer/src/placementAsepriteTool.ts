import { installPlacementCatalogTools } from "./placementCatalogTools";
import { createPlacementImportDiagnostic, installPlacementImportDiagnostics } from "./placementImportDiagnostics";
import {
  setUiAttribute,
  setUiText,
  type UiContent,
  uiMessage,
  uiText,
} from "./placementLocale";

import type { FerrumRuntime } from "@ferrum2d/ferrum-web/core";
import type {
  SceneAuthoringDocumentSpec,
  ScenePlacementViewer,
  ScenePlacementPatch,
  SceneSpriteNormalBindingEvidence,
} from "@ferrum2d/ferrum-web/authoring";
import { createPlacementPanelTabs } from "./placementPanelTabs";
import { canUsePlacementAsset } from "./placementAssetScope";
import { createPlacementAsepriteNormals } from "./placementAsepriteNormals";
import {
  asepriteAnimationCatalog,
  asepriteAnimationPatch,
  asepriteAnimationEvidence,
} from "./placementAsepriteAnimation";
import type {
  PlacementNormalAssetHost,
  PlacementNormalAssetBundle,
} from "./placementNormalAssets";
import type { SpriteNormalGenerationSettings } from "@ferrum2d/ferrum-web/authoring";
import {
  readPlacementAsepriteProject,
  type PlacementAsepriteProjectHost,
} from "./placementAsepriteProject";
import {
  inspectAseprite,
  asepriteDiff,
  asepriteProviderAsset,
  asepriteComponentPatch,
  asepriteEvidence,
  asepriteBundle,
  createPlacementAsepriteAssets,
  type PlacementAsepriteAsset,
} from "./placementAsepriteAssets";

interface Context {
  key: string;
  project?: string;
  document: SceneAuthoringDocumentSpec;
  mode: string;
  canEdit: boolean;
}
interface Draft {
  json?: File;
  png?: File;
  name: string;
  candidate?: PlacementAsepriteAsset;
  dirty: boolean;
  status: UiContent;
  importFailure?: ReturnType<typeof createPlacementImportDiagnostic>;
}

export function createPlacementAsepriteTool(options: {
  engine: FerrumRuntime["engine"];
  viewer: ScenePlacementViewer;
  context(): Context;
  taken(id: string): boolean;
  retainsAsset?(id: string): boolean;
  changed(): void;
  apply(patch: ScenePlacementPatch, label: string): void;
  assets?: ReturnType<typeof createPlacementAsepriteAssets>;
  projectHost(): PlacementAsepriteProjectHost | undefined;
  saveScene(): Promise<void>;
  normalHost(): PlacementNormalAssetHost | undefined;
  normalSettings(): SpriteNormalGenerationSettings;
  normalBundles?(): PlacementNormalAssetBundle[];
  normalEvidence?(): SceneSpriteNormalBindingEvidence[];
}) {
  const element = document.createElement("details"),
    summary = document.createElement("summary"),
    body = document.createElement("div");
  element.className = "placement-normal-tool placement-aseprite-tool";
  element.dataset.placementAsepriteTool = "true";
  setUiText(summary, "Import Aseprite");
  const actions = document.createElement("div");
  actions.className = "placement-normal-actions";
  const button = (label: string, action: string) => {
    const el = document.createElement("button");
    el.type = "button";
    setUiText(el, label);
    el.dataset.asepriteAction = action;
    actions.append(el);
    return el;
  };
  const inspect = button("Inspect", "inspect"),
    register = button("Register", "register"),
    apply = button("Apply Frame", "apply"),
    reimport = button("Reimport", "reimport"),
    applyAnimation = button("Apply Animation", "animation"),
    reimportAnimation = button("Reimport Animation", "reimport-animation"),
    generateNormals = button("Generate Normals", "normals"),
    reimportNormals = button("Reimport Normals", "reimport-normals"),
    applyPaired = button("Apply Paired", "paired"),
    reimportPaired = button("Reimport Paired", "reimport-paired"),
    saveNormals = button("Save Normals", "save-normals"),
    cancel = button("Cancel", "cancel"),
    save = button("Save Project", "save"),
    exportButton = button("Export Assets", "export");
  const status = document.createElement("output");
  status.dataset.asepriteStatus = "true";
  status.setAttribute("aria-live", "polite");
  const hint = document.createElement("p");
  setUiText(
    hint,
    "Apply Paired imports animation tags and generated normals together (HD-2D, max 32 unique UVs). Normals use Generate Normal settings. Export assets and the scene patch when a save host is unavailable.",
  );
  const sourceFiles = document.createElement("output");
  sourceFiles.dataset.asepriteSource = "true";
  const tabs = createPlacementPanelTabs("Aseprite Import", [
      ["source", "Source"],
      ["preview", "Preview"],
    ] as const),
    source = tabs.panels.get("source")!,
    preview = tabs.panels.get("preview")!;
  const json = document.createElement("input"),
    png = document.createElement("input"),
    name = document.createElement("input"),
    frame = document.createElement("select");
  json.type = png.type = "file";
  json.accept = ".json";
  png.accept = ".png";
  name.type = "text";
  name.maxLength = 48;
  const field = (label: string, input: HTMLElement, parent: HTMLElement) => {
    const el = document.createElement("label");
    setUiAttribute(input, "aria-label", label);
    el.append(uiText(label), input);
    parent.append(el);
  };
  field("Aseprite JSON", json, source);
  field("Aseprite PNG", png, source);
  field("Aseprite asset name", name, source);
  const policy = document.createElement("p");
  setUiText(
    policy,
    "Untrimmed, unrotated frames only. Apply Animation imports frameTags and exact millisecond timing into native clips (max 32 frames per clip). Reimport Animation preserves clip IDs, initial clip and existing loop policy. Use Apply Paired/Reimport Paired to regenerate bound normals with animations.",
  );
  source.append(sourceFiles, policy);
  field("Aseprite frame", frame, preview);
  const initialAnimation = document.createElement("select"),
    animationLoop = document.createElement("input"),
    animationInfo = document.createElement("output");
  animationLoop.type = "checkbox";
  animationLoop.checked = true;
  animationInfo.dataset.asepriteAnimationInfo = "true";
  field("Aseprite initial animation", initialAnimation, preview);
  field("Aseprite loop new clips", animationLoop, preview);
  preview.append(animationInfo);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 160;
  setUiAttribute(canvas, "aria-label", "Aseprite frame preview");
  canvas.className = "placement-aseprite-preview";
  const diff = document.createElement("output"),
    diagnostics = document.createElement("output");
  diff.dataset.asepriteDiff = "true";
  diagnostics.dataset.asepriteDiagnostics = "true";
  preview.append(canvas, diff, diagnostics);
  body.append(actions, status, hint, tabs.element);
  element.append(summary, body);
  const assets =
      options.assets ??
      createPlacementAsepriteAssets(options.engine, options.taken),
    drafts = new Map<string, Draft>(),
    current = new Map<string, string>();
  const normals = createPlacementAsepriteNormals({
    project: () => options.context().project,
    engine: options.engine,
    host: options.normalHost,
    settings: options.normalSettings,
    taken: options.taken,
  });
  let normalInFlight: Promise<void> | undefined;
  for (const asset of assets.entries().filter((a) => a.uploaded))
    current.set(JSON.stringify([asset.document, asset.name]), asset.id);
  let key = "",
    mode = "",
    serial = 0,
    controller: AbortController | undefined,
    busy = false,
    disposed = false,
    previewSerial = 0;
  const draft = () => drafts.get(key)!;
  const catalog = installPlacementCatalogTools({
    root: body, store: assets,
    canEdit: () => !disposed && !busy && options.context().canEdit,
    retains: id => (options.retainsAsset?.(id) ?? true) || [...drafts.values()].some(d => d.candidate?.id === id),
    changed: options.changed,
  });
  const importDiagnostics = installPlacementImportDiagnostics(body, "aseprite");

  const documentAssets = () =>
    assets.entries().filter((a) => canUsePlacementAsset(a, key, options.context().project));
  const registered = () => documentAssets().filter((a) => a.uploaded);
  const prior = (asset: PlacementAsepriteAsset) =>
    assets
      .entries()
      .find((a) => a.id === current.get(JSON.stringify([key, asset.name])));
  const alive = (token: number) =>
    !disposed && token === serial && options.context().key === key;
  function stop(message = "Cancelled") {
    serial++;
    controller?.abort();
    controller = undefined;
    if (busy && drafts.has(key)) draft().status = uiMessage(message);
    busy = false;
  }
  function plan(
    revision: PlacementAsepriteAsset,
    selected = false,
    normalTexture?: string,
  ) {
    return asepriteComponentPatch(
      options.context().document,
      options.viewer.state(),
      registered(),
      revision,
      selected
        ? {
            instance: options.viewer.state().selectedInstanceId ?? "",
            frame: frame.value,
          }
        : undefined,
      normalTexture,
    );
  }
  function animationPlan(
    revision: PlacementAsepriteAsset,
    selected: boolean,
    normalTexture?: string,
  ) {
    return asepriteAnimationPatch(
      options.context().document,
      options.viewer.state(),
      registered(),
      revision,
      {
        initial: initialAnimation.value,
        loop: animationLoop.checked,
        ...(selected
          ? { instance: options.viewer.state().selectedInstanceId ?? "" }
          : {}),
      },
      normalTexture,
    );
  }
  function render() {
    if (disposed || !drafts.has(key)) return;
    const d = draft(),
      context = options.context(),
      valid = !!d.candidate && !d.dirty;
    inspect.disabled = busy || !d.json || !d.png || !context.canEdit;
    register.disabled = busy || !valid || !context.canEdit;
    json.disabled = png.disabled = name.disabled = busy;
    frame.disabled = busy || !valid;
    initialAnimation.disabled = animationLoop.disabled = busy || !valid;
    cancel.disabled = !busy;
    exportButton.disabled = busy || !registered().length;
    save.disabled =
      busy ||
      !context.canEdit ||
      !registered().length ||
      !options.projectHost();
    setUiAttribute(
      save,
      "title",
      options.projectHost()
        ? "Save atlases, catalog, and scene"
        : "Open a desktop project folder to save",
    );
    setUiText(
      sourceFiles,
      uiMessage(
        "{0} · {1}",
        d.json?.name ?? uiMessage("Choose JSON"),
        d.png?.name ?? uiMessage("Choose PNG"),
      ),
    );
    catalog.sync();
    let reimportCause: unknown;
    let applyError = "",
      reimportError = "",
      count = 0;
    if (valid) {
      try {
        plan(d.candidate!, true);
      } catch (error) {
        applyError = String(error instanceof Error ? error.message : error);
      }
      try {
        count = plan(d.candidate!).operations.length;
      } catch (error) {
        reimportError = String(error instanceof Error ? error.message : error);
        reimportCause = error;
      }
    }
    importDiagnostics.update(reimportCause && d.candidate ? [createPlacementImportDiagnostic(reimportCause, {
      document: key, scene: context.document, sourceFile: d.candidate.jsonName,
      assetId: registered().find(a => a.name === d.candidate!.name && a.id !== d.candidate!.id)?.id,
    })] : d.importFailure ? [d.importFailure] : []);
    apply.disabled = busy || !valid || !context.canEdit || !!applyError;
    reimport.disabled =
      busy ||
      !valid ||
      !context.canEdit ||
      !!reimportError ||
      !prior(d.candidate!);
    let animationError = "Inspect a tagged atlas",
      migrationError = animationError,
      animationCount = 0;
    if (valid) {
      try {
        animationPlan(d.candidate!, true);
        animationError = "";
      } catch (error) {
        animationError = error instanceof Error ? error.message : String(error);
      }
      try {
        animationCount = animationPlan(d.candidate!, false).operations.length;
        migrationError = "";
      } catch (error) {
        migrationError = error instanceof Error ? error.message : String(error);
      }
    }
    applyAnimation.disabled =
      busy || !valid || !context.canEdit || !!animationError;
    reimportAnimation.disabled =
      busy || !valid || !context.canEdit || !!migrationError;
    setUiAttribute(
      applyAnimation,
      "title",
      animationError || "Attach tags; preserve existing clip IDs and loop",
    );
    setUiAttribute(
      reimportAnimation,
      "title",
      migrationError ||
        `Migrate ${animationCount} animated references in this fragment`,
    );
    setUiText(
      animationInfo,
      animationError ||
        uiMessage(
          "{0} clips · {1} migration targets · {2}",
          initialAnimation.options.length,
          animationCount,
          migrationError || uiMessage("Numeric clip IDs preserved"),
        ),
    );
    let normalError = "Switch to HD-2D to generate normals",
      reimportNormalError = normalError;
    if (valid && context.mode === "spatial") {
      normalError = reimportNormalError = "";
      try {
        plan(d.candidate!, true, "aseprite-normal.pending");
      } catch (error) {
        normalError = String(error instanceof Error ? error.message : error);
      }
      try {
        if (
          !plan(d.candidate!, false, "aseprite-normal.pending").operations
            .length
        )
          reimportNormalError =
            "No previous atlas references in the active fragment";
      } catch (error) {
        reimportNormalError = String(
          error instanceof Error ? error.message : error,
        );
      }
    }
    generateNormals.disabled =
      busy || !valid || !context.canEdit || !!normalError;
    reimportNormals.disabled =
      busy ||
      !valid ||
      !context.canEdit ||
      !!reimportNormalError ||
      !prior(d.candidate!);
    setUiAttribute(
      generateNormals,
      "title",
      normalError || "Apply frame with generated normals",
    );
    setUiAttribute(
      reimportNormals,
      "title",
      reimportNormalError || "Replace atlas and normals together",
    );
    let pairedError = "Switch to HD-2D to generate paired normals",
      pairedMigrationError = pairedError;
    if (valid && context.mode === "spatial") {
      try {
        animationPlan(d.candidate!, true, "aseprite-normal.pending");
        pairedError = "";
      } catch (error) {
        pairedError = error instanceof Error ? error.message : String(error);
      }
      try {
        animationPlan(d.candidate!, false, "aseprite-normal.pending");
        pairedMigrationError = "";
      } catch (error) {
        pairedMigrationError =
          error instanceof Error ? error.message : String(error);
      }
    }
    applyPaired.disabled = busy || !valid || !context.canEdit || !!pairedError;
    reimportPaired.disabled =
      busy || !valid || !context.canEdit || !!pairedMigrationError;
    setUiAttribute(
      applyPaired,
      "title",
      pairedError || "Apply animation tags with generated normals",
    );
    setUiAttribute(
      reimportPaired,
      "title",
      pairedMigrationError || "Migrate animations and normals together",
    );
    saveNormals.disabled =
      busy ||
      !context.canEdit ||
      !options.normalHost()?.saveAssets ||
      !normals.blocksSave(context.document, key);
    setUiAttribute(
      saveNormals,
      "title",
      options.normalHost()?.saveAssets
        ? "Save generated normal files"
        : "Normal asset save host unavailable",
    );
    setUiText(
      status,
      busy
        ? d.status
        : uiMessage(
            "{0}{1}",
            d.status,
            uiMessage(
              registered().some((a) => !a.persisted) ||
                normals.blocksSave(context.document, key)
                ? " · Save or export required before closing"
                : "",
            ),
          ),
    );
    setUiText(
      diagnostics,
      valid
        ? uiMessage(
            "Active Fragment · {0} references{1}{2}",
            count,
            reimportError ? uiMessage(" · {0}", reimportError) : uiMessage(""),
            applyError
              ? uiMessage(" · Apply Frame: {0}", applyError)
              : uiMessage(""),
          )
        : "Inspect a matching JSON and PNG export",
    );
    element.dataset.asepriteBusy = String(busy);
    element.dataset.asepriteReady = String(valid);
  }
  async function paint() {
    const token = ++previewSerial,
      candidate = draft().candidate,
      rect = candidate?.frames.find((f) => f.id === frame.value),
      ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 160, 160);
    if (!candidate || !rect) return;
    try {
      const bitmap = await createImageBitmap(
        new Blob([candidate.png], { type: "image/png" }),
      );
      try {
        if (disposed || token !== previewSerial) return;
        const scale = Math.min(160 / rect.width, 160 / rect.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          bitmap,
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          (160 - rect.width * scale) / 2,
          (160 - rect.height * scale) / 2,
          rect.width * scale,
          rect.height * scale,
        );
      } finally {
        bitmap.close();
      }
    } catch (error) {
      if (token === previewSerial && !disposed) draft().status = String(error);
    }
  }
  function fields() {
    const d = draft();
    name.value = d.name;
    json.value = png.value = "";
    frame.replaceChildren(
      ...(d.candidate?.frames ?? []).map((f) => {
        const o = document.createElement("option");
        o.value = o.textContent = f.id;
        return o;
      }),
    );
    const selectedTag = initialAnimation.value;
    initialAnimation.replaceChildren();
    if (d.candidate) {
      try {
        initialAnimation.append(
          ...asepriteAnimationCatalog(d.candidate).map((tag) => {
            const option = document.createElement("option");
            option.value = tag.name;
            setUiText(
              option,
              uiMessage(
                "{0} · {1} ticks · {2} ms",
                tag.name,
                tag.clip.frames.length,
                tag.sourceCycleMs,
              ),
            );
            return option;
          }),
        );
        if (
          [...initialAnimation.options].some(
            (option) => option.value === selectedTag,
          )
        )
          initialAnimation.value = selectedTag;
      } catch {
        /* Static import remains available for unsupported animation metadata. */
      }
    }
    if (d.candidate) {
      const delta = asepriteDiff(prior(d.candidate), d.candidate);
      setUiText(
        diff,
        uiMessage(
          "{0} × {1} · {2} frames · Added {3} / Changed {4} / Removed {5} · PNG {6}{7}",
          d.candidate.width,
          d.candidate.height,
          d.candidate.frames.length,
          delta.added.length,
          delta.changed.length,
          delta.removed.length,
          delta.imageChanged ? uiMessage("changed") : uiMessage("unchanged"),
          delta.removed.length
            ? uiMessage(
                " · Removed: {0}",
                delta.removed.slice(0, 20).join(", "),
              )
            : uiMessage(""),
        ),
      );
    } else setUiText(diff, "");
    void paint();
    render();
  }
  const dirty = () => {
    stop();
    draft().name = name.value.trim();
    draft().dirty = true;
    draft().status = uiMessage("Source changed · Inspect before applying");
    render();
  };
  name.addEventListener("input", dirty);
  json.addEventListener("change", () => {
    draft().json = json.files?.[0];
    dirty();
  });
  png.addEventListener("change", () => {
    draft().png = png.files?.[0];
    dirty();
  });
  frame.addEventListener("change", () => {
    void paint();
    render();
  });
  initialAnimation.addEventListener("change", render);
  animationLoop.addEventListener("change", render);
  inspect.addEventListener(
    "click",
    () =>
      void (async () => {
        if (inspect.disabled) return;
        stop();
        const token = serial,
          d = draft(),
          doc = key;
        controller = new AbortController();
        const signal = controller.signal;
        busy = true;
        d.dirty = true;
        d.importFailure = undefined;
        d.status = uiMessage("Inspecting…");
        render();
        try {
          const inspected = await inspectAseprite(
            doc,
            d.name,
            d.json!,
            d.png!,
            signal,
          );
          if (!alive(token)) return;
          const candidate = assets.adopt(inspected),
            previous = d.candidate;
          d.candidate = candidate;
          d.dirty = false;
          d.status = uiMessage("Ready · Register or apply explicitly");
          if (previous && previous !== candidate && !previous.uploaded)
            assets.discard(previous);
          fields();
          tabs.select("preview");
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
            render();
          }
        }
      })(),
  );
  async function commit(
    kind:
      | "register"
      | "apply"
      | "reimport"
      | "animation"
      | "reimport-animation",
  ) {
    const animated = kind === "animation" || kind === "reimport-animation",
      selectedTarget = kind === "apply" || kind === "animation";
    const control =
      kind === "register"
        ? register
        : kind === "apply"
          ? apply
          : kind === "reimport"
            ? reimport
            : kind === "animation"
              ? applyAnimation
              : reimportAnimation;
    if (control.disabled) return;
    const d = draft(),
      candidate = d.candidate!,
      context = options.context(),
      signature = JSON.stringify(context.document),
      selected = options.viewer.state().selectedInstanceId;
    let patch: ScenePlacementPatch | undefined;
    try {
      patch =
        kind === "register"
          ? undefined
          : animated
            ? animationPlan(candidate, selectedTarget)
            : plan(candidate, selectedTarget);
    } catch (error) {
      d.status = uiMessage(
        "Apply failed. {0}",
        error instanceof Error ? error.message : String(error),
      );
      render();
      return;
    }
    const wasUploaded = candidate.uploaded;
    let uploadedUrl: string | undefined;
    stop();
    const token = serial;
    controller = new AbortController();
    const signal = controller.signal;
    busy = true;
    d.status = uiMessage("Preparing atlas…");
    render();
    try {
      uploadedUrl = await assets.upload(candidate, signal);
      if (!alive(token)) {
        if (!wasUploaded) assets.release(candidate, uploadedUrl);
        return;
      }
      if (
        !options.context().canEdit ||
        signature !== JSON.stringify(options.context().document) ||
        (selectedTarget &&
          selected !== options.viewer.state().selectedInstanceId)
      )
        throw new Error("Document or selection changed. Apply again.");
      // Lock changes do not alter the document signature; revalidate immediately before activation.
      if (patch) {
        if (animated) animationPlan(candidate, selectedTarget);
        else plan(candidate, selectedTarget);
      }
      const mapKey = JSON.stringify([key, candidate.name]),
        old = current.get(mapKey);
      current.set(mapKey, candidate.id);
      try {
        if (patch?.operations.length)
          options.apply(
            patch,
            animated
              ? selectedTarget
                ? "Apply Aseprite Animation"
                : "Reimport Aseprite Animation"
              : kind === "apply"
                ? "Apply Aseprite Frame"
                : "Reimport Aseprite",
          );
      } catch (error) {
        if (old) current.set(mapKey, old);
        else current.delete(mapKey);
        throw error;
      }
      d.status =
        kind === "register"
          ? uiMessage("Registered · Scene unchanged")
          : uiMessage(
              "Applied · {0} references",
              patch?.operations.length ?? 0,
            );
      options.changed();
      fields();
    } catch (error) {
      if (!wasUploaded && uploadedUrl) assets.release(candidate, uploadedUrl);
      if (alive(token)) {
        d.status = uiMessage(
          "Apply failed. {0}",
          error instanceof Error ? error.message : String(error),
        );
        options.changed();
      }
    } finally {
      if (alive(token)) {
        busy = false;
        render();
      }
    }
  }
  register.addEventListener("click", () => void commit("register"));
  apply.addEventListener("click", () => void commit("apply"));
  reimport.addEventListener("click", () => void commit("reimport"));
  applyAnimation.addEventListener("click", () => void commit("animation"));
  reimportAnimation.addEventListener(
    "click",
    () => void commit("reimport-animation"),
  );
  function commitNormals(selected: boolean, animated = false) {
    const control = animated
      ? selected
        ? applyPaired
        : reimportPaired
      : selected
        ? generateNormals
        : reimportNormals;
    const pairedPlan = animated ? animationPlan : plan;
    if (control.disabled) return;
    const previous = normalInFlight;
    const task = (async () => {
      const d = draft(),
        candidate = d.candidate!,
        context = options.context(),
        signature = JSON.stringify(context.document),
        selectedId = options.viewer.state().selectedInstanceId;
      stop();
      const token = serial;
      controller = new AbortController();
      const signal = controller.signal;
      busy = true;
      d.status = uiMessage("Preparing normal generation…");
      render();
      let prepared: Awaited<ReturnType<typeof normals.prepare>> | undefined;
      const wasUploaded = candidate.uploaded;
      let uploadedUrl: string | undefined;
      try {
        await previous?.catch(() => {});
        signal.throwIfAborted();
        pairedPlan(candidate, selected, "aseprite-normal.pending");
        prepared = await normals.prepare(candidate, signal, (message) => {
          if (alive(token)) {
            d.status = message;
            render();
          }
        });
        uploadedUrl = await assets.upload(candidate, signal);
        await normals.upload(prepared.entry, signal);
        if (!alive(token)) return;
        if (
          !options.context().canEdit ||
          signature !== JSON.stringify(options.context().document) ||
          (selected && selectedId !== options.viewer.state().selectedInstanceId)
        )
          throw Error("Document or selection changed. Generate again.");
        const patch = pairedPlan(
          candidate,
          selected,
          prepared.entry.binding.textures.normal.asset,
        );
        const mapKey = JSON.stringify([key, candidate.name]),
          old = current.get(mapKey);
        current.set(mapKey, candidate.id);
        try {
          normals.activate(prepared.entry, context.document, patch, () =>
            options.apply(
              patch,
              animated
                ? selected
                  ? "Apply Aseprite Animation and Normals"
                  : "Reimport Aseprite Animation and Normals"
                : selected
                  ? "Apply Aseprite Normals"
                  : "Reimport Aseprite Normals",
            ),
          );
        } catch (error) {
          if (old) current.set(mapKey, old);
          else current.delete(mapKey);
          throw error;
        }
        d.status = uiMessage(
          "Applied normals · {0} references · Undo restores color and normals",
          patch.operations.length,
        );
        options.changed();
        fields();
      } catch (error) {
        if (alive(token)) {
          d.status = uiMessage(
            "Normal generation failed. {0}",
            error instanceof Error ? error.message : String(error),
          );
          options.changed();
        }
      } finally {
        if (prepared?.created && !prepared.entry.committed)
          normals.discard(prepared.entry);
        if (!wasUploaded && uploadedUrl && !prepared?.entry.committed)
          assets.release(candidate, uploadedUrl);
        if (alive(token)) {
          busy = false;
          render();
        }
      }
    })();
    normalInFlight = task;
    void task.finally(() => {
      if (normalInFlight === task) normalInFlight = undefined;
    });
  }
  generateNormals.addEventListener("click", () => commitNormals(true));
  reimportNormals.addEventListener("click", () => commitNormals(false));
  applyPaired.addEventListener("click", () => commitNormals(true, true));
  reimportPaired.addEventListener("click", () => commitNormals(false, true));
  saveNormals.addEventListener(
    "click",
    () =>
      void (async () => {
        if (saveNormals.disabled) return;
        stop();
        const token = serial;
        controller = new AbortController();
        busy = true;
        draft().status = uiMessage("Saving normals…");
        render();
        try {
          await normals.save(
            options.context().document,
            key,
            controller.signal,
          );
          if (alive(token)) {
            draft().status = uiMessage("Normal assets saved and verified");
            options.changed();
          }
        } catch (error) {
          if (alive(token))
            draft().status = uiMessage(
              "Normal save failed. {0}",
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
  cancel.addEventListener("click", () => {
    stop();
    render();
  });
  save.addEventListener(
    "click",
    () =>
      void (async () => {
        const host = options.projectHost();
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
          await normals.save(context.document, key, signal);
          const catalog = await host.save(
            asepriteBundle(key, candidates),
            signal,
          );
          const saved = await readPlacementAsepriteProject(
            catalog,
            key,
            host.project,
            signal,
          );
          if (!alive(token) || host !== options.projectHost()) return;
          for (const asset of candidates) {
            if (
              !saved.some(
                (a) =>
                  a.id === asset.id &&
                  a.jsonSha256 === asset.jsonSha256 &&
                  a.pngSha256 === asset.pngSha256,
              )
            )
              throw new Error(
                "Project host did not register all imported atlases",
              );
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
            throw new Error(
              "Assets saved. Scene changed; save the project again.",
            );
          d.status = uiMessage("Assets saved · Saving scene…");
          render();
          await options.saveScene();
          if (alive(token))
            d.status = uiMessage(
              "Project saved · Sources and reimport metadata preserved",
            );
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
  exportButton.addEventListener("click", () => {
    const normalAssets = [
      ...normals.bundles(key, options.context().document),
      ...(options.normalBundles?.() ?? []),
    ].filter(
      (bundle, index, all) =>
        all.findIndex(
          (item) =>
            item.binding.textures.normal.asset ===
            bundle.binding.textures.normal.asset,
        ) === index,
    );
    const value =
        JSON.stringify(
          {
            ...asepriteBundle(key, registered()),
            animations: asepriteAnimationEvidence(
              options.context().document,
              options.viewer.state(),
              registered(),
            ),
            ...(normalAssets.length
              ? {
                  normalAssets,
                  normalBindings: [
                    ...normals.bindings(
                      key,
                      options.context().document,
                      options.viewer.state(),
                    ),
                    ...(options.normalEvidence?.() ?? []),
                  ].filter(
                    (item, index, all) =>
                      all.findIndex(
                        (other) => other.instanceId === item.instanceId,
                      ) === index,
                  ),
                }
              : {}),
          },
          null,
          2,
        ) + "\n",
      url = URL.createObjectURL(
        new Blob([value], { type: "application/json" }),
      ),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "aseprite-assets.json";
    anchor.click();
    URL.revokeObjectURL(url);
    draft().status = uiMessage(
      "Exported · Install the catalog and scene patch before reopening",
    );
    render();
  });
  function sync() {
    if (disposed) return;
    const context = options.context();
    if (key !== context.key) {
      stop("Cancelled · Document changed");
      previewSerial++;
      key = context.key;
      if (!drafts.has(key)) {
        const restored = registered().at(-1);
        drafts.set(
          key,
          restored
            ? {
                name: restored.name,
                candidate: restored,
                dirty: false,
                json: new File([restored.json], restored.jsonName, {
                  type: "application/json",
                }),
                png: new File([restored.png], restored.pngName, {
                  type: "image/png",
                }),
                status: uiMessage(
                  "Project atlas restored · Select updated files to reimport",
                ),
              }
            : {
                name: "sprite",
                dirty: true,
                status: uiMessage("Choose an Aseprite JSON and PNG export"),
              },
        );
      }
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
    normals.destroy();
    drafts.clear();
    current.clear();
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
  const references = (
    document: SceneAuthoringDocumentSpec,
    a: PlacementAsepriteAsset,
  ) => JSON.stringify(document).includes(JSON.stringify(a.id));
  return {
    element,
    sync,
    destroy,
    close(document: string) {
      if (document === key) stop();
      drafts.delete(document);
      for (const [id] of current)
        if (JSON.parse(id)[0] === document) current.delete(id);
      assets.close(document);
      normals.close(document);
    },
    providerAssets() {
      return assets
        .entries()
        .filter((a) => canUsePlacementAsset(a, options.context().key, options.context().project) && a.uploaded)
        .reverse()
        .map(asepriteProviderAsset);
    },
    evidence(document: SceneAuthoringDocumentSpec) {
      const revisions = assets
        .entries()
        .filter((a) => canUsePlacementAsset(a, options.context().key, options.context().project) && a.uploaded);
      const animations = asepriteAnimationEvidence(
        document,
        options.viewer.state(),
        revisions,
      );
      return revisions
        .filter((a) => references(document, a))
        .map((a) => ({
          ...asepriteEvidence(a),
          animations: animations.filter(
            (animation) => animation.assetId === a.id,
          ),
        }));
    },
    normalBindings() {
      return normals.bindings(key);
    },
    blocksSave(document: SceneAuthoringDocumentSpec) {
      return (
        normals.blocksSave(document, key) ||
        assets.entries().some((a) => (!canUsePlacementAsset(a, key, options.context().project) || !a.persisted) && references(document, a))
      );
    },
    assertDocumentAssets(
      document: SceneAuthoringDocumentSpec,
      documentKey: string,
      project?: string,
    ) {
      normals.assertDocumentAssets(document, documentKey, project);
      if (
        assets
          .entries()
          .some((a) => !canUsePlacementAsset(a, documentKey, project) && references(document, a))
      )
        throw new Error(
          "Install imported assets in the project catalog before opening their references in another document",
        );
    },
  };
}
export type PlacementAsepriteImportEvidence = ReturnType<
  ReturnType<typeof createPlacementAsepriteTool>["evidence"]
>[number];
